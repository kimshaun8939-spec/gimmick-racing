// 레이스 진행 (봇 레이스 ?mode=race, 온라인 레이스): 출발 그리드, 봇 운전, 차끼리 충돌, 순위·간격, 결과표
//
//   main.js가 부르는 것
//     placeGrid()            출발 그리드에 플레이어·봇 놓기 (2열 엇갈림, 플레이어는 중간~뒤)
//     step(dt, phase, time)  물리 한 스텝: 봇 운전 + 차끼리 충돌 + 진행 거리·간격 기록
//     update(dt, elapsed, camera)  화면: 봇 모델·이름표
//     standings(), hudInfo(), results(time)
//   진행(progress) = 지난 바퀴 수 + 이번 바퀴 위치(0~1). 출발선 뒤 그리드에서는 조금 음수
//   간격: 한 바퀴를 M개 지점으로 나눠 각 차가 지점을 지난 시각을 적어 두고, 같은 지점을 지난 시각 차이 = 간격 (F1 방식)
import * as THREE from 'three';
import { Car } from './car.js';
import { hitboxFor, obbOverlap, advanceHitbox, constrainHitbox } from './carHitbox.js';
import { createBotDriver, BOT_LEVELS, BOT_NAMES, pickBotCars, profileFor, rng, flightPlan, CLOSE, PACK, RUBBER_BAND } from './bots.js';
import { fmtTime, records } from './records.js';
import { fastTrack } from './fastTrack.js';
import { settings } from './settings.js';
import { createSlipFx } from './slipFx.js';
import { createDrs } from './drs.js';

const RESTITUTION = 0.25;
const SIDE_SCRUB = 0.0003; // 옆으로 비빌 때 닿은 스텝마다 두 차가 잃는 앞 속도 비율 (100스텝 ≈ 0.8초 = 3%)

export async function createRaceSystem(o) {
  const { track, car, scenery, opponents, laps, carId } = o;
  const L = track.length;
  const M = Math.max(100, Math.min(600, Math.round(L / 20))); // 한 바퀴 기록 지점 수
  // 실력: 주소의 &botLevel=이 있으면 그것 (온라인은 방장이 넣어 줌, 혼자일 때는 테스트용), 없으면 설정
  const QS = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
  const levelName = BOT_LEVELS[QS.get('botLevel')] ? QS.get('botLevel') : BOT_LEVELS[o.botLevel] ? o.botLevel : 'normal';
  const level = BOT_LEVELS[levelName];
  const line = track.racingLine;
  const nBots = line && !track.arena ? Math.max(0, Math.min(7, o.botCount | 0)) : 0;
  // 씨앗: 온라인이면 방 코드로 (모든 사람에게 같은 봇 이름·차·성격), 아니면 무작위
  //   (테스트용 &rseed=N: 혼자 봇 레이스에서도 같은 봇 이름·차·성격 = 전/후 비교, close-race)
  if (o.seed == null && QS.get('rseed')) o = { ...o, seed: 'r' + QS.get('rseed') };
  const RAW = QS.get('rawseed'); // 장면 재현용 (sceneSave.js가 저장한 씨앗 숫자 그대로, .debug/scene_play.js)
  const seed = RAW != null && /^\d+$/.test(RAW) ? Number(RAW) >>> 0 : o.seed != null ? [...String(o.seed)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0 : (Math.random() * 1e9) | 0;
  const rand = rng(seed);
  const markLen = (laps + 2) * M + 2;
  // 슬립스트림·견인 값 (data/car.json draft·tow, 플레이어 차 cfg 기준). 주소 &slip=old = 예전 슬립스트림(비교용), &tow=0 = 견인 끔
  const SLIP_OLD = QS.get('slip') === 'old';
  const SLIP_SLING = QS.get('slip') === 'sling'; // 2026-11-13 슬링샷 없앰 전 방식 (충전 + 옆으로 빠지면 슬링샷, 비교용)
  const TOW_OLD = QS.get('towold') === '1';
  const legacyDraft = (cfg) => {
    if (SLIP_OLD && cfg && cfg.draft && cfg.draft.legacy) cfg.draft = { ...cfg.draft, ...cfg.draft.legacy, pullAccel: 0, topMax: 1 };
    if (SLIP_SLING && cfg && cfg.draft && cfg.draft.slingMode) cfg.draft = { ...cfg.draft, ...cfg.draft.slingMode };
    if (TOW_OLD && cfg && cfg.tow) cfg.tow = { ...cfg.tow, startSec: 2.5, fullSec: 8, dragCut: 0.3, topGain: 0.05, powerGain: 0.1, assistSec: 3 }; // 플레이어·봇 차 모두 (car.js도 이 값을 씀)
  };
  legacyDraft(car.cfg);
  const DC = car.cfg.draft || {};
  // 견인: 2026-11-12 drs에서 더 일찍·더 세게 (car.json tow: startSec 2.5 → 1.2, fullSec 8 → 5, 세기 약 1.5배). &towold=1 = 예전 값 (비교 시험용)
  const TC = car.cfg.tow || {};
  const TOW_URL_OFF = QS.get('tow') === '0';
  // 차끼리 몸싸움 (2026-11-12 close-race, 사용자 요청 "몸싸움하면 차가 돌고 감속이 너무 심함 → 도는 것 자체를 없애줘"): data/car.json contact
  //   NOSPIN: 부딪혀도 차 방향·회전·미끄럼각(slip)은 그대로, 옆으로 살짝 밀리기만 (car.cNudge, 금방 사라짐). &nospin=0 = 예전 몸싸움(비교용)
  const CC = car.cfg.contact || {};
  const NOSPIN = QS.get('nospin') !== '0' && CC.nospin !== false;
  // DRS (2026-11-12, src/drs.js): 설정 'DRS' 또는 주소 &drs=0이면 끔
  const DRS_URL_OFF = QS.get('drs') === '0';
  const NO_TRAIN = QS.get('train') === '0'; // 슬립스트림 기차 끔 (비교 시험용)

  function timing(e) {
    if (e.marks) return e;
    e.marks = new Float32Array(markLen).fill(NaN);
    e.nextMark = 0;
    return e;
  }

  // --- 플레이어 ---
  const me = timing({
    id: 'me', name: o.playerName || '나', carName: o.carName || '', color: o.color || '#e8463a', isPlayer: true,
    view: car, progress: 0, lap: 1, finished: false, finishTime: null, bestLap: null, lapTimes: [], speed: 0, lateral: 0, position: 0,
  });

  // --- 봇 ---
  const bots = [];
  const botTrack = nBots > 0 ? (car.track && car.track !== track ? car.track : fastTrack(track)) : track; // 봇 차는 땅 찾기 레이를 격자로 빠르게 (결과는 같음)
  let roster = { cars: [] };
  if (nBots > 0) {
    try {
      roster = await (await fetch('data/cars.json')).json();
    } catch {}
    const picks = pickBotCars(roster, carId, nBots, seed);
    const names = BOT_NAMES.slice().sort(() => rand() - 0.5);
    const cfgs = await Promise.all(picks.map((p) => o.loadCarConfig(p.id)));
    picks.forEach((p, i) => {
      const cfg = cfgs[i]; // cars.json tune 그대로, 사람과 같은 Car 물리
      legacyDraft(cfg);
      const bc = new Car(cfg, botTrack);
      bc.manual = false;
      const prof = profileFor(line, cfg);
      bc._lineProfile = prof; // 복귀할 때 굴러가는 속도 계산용
      const driver = createBotDriver(bc, track, prof, level, seed + i * 101);
      const h = opponents.add(
        { id: `bot${i + 1}`, name: names[i % names.length], look: p.look, carName: cfg.carName || p.name },
        { car: bc, driver, cfg, lastT: 0, lapsDone: 0, lapStart: 0, slowT: 0, offT: 0, wrongT: 0, chkT: 0, chkProg: 0, grace: 0, respawns: 0 },
      );
      bots.push(timing(h.entry));
    });
  }
  const MASTER = level.master && bots.length ? setupMaster() : null;
  // 온라인 상대가 들어오면 기록 배열 준비
  opponents.onChange((kind, e) => kind === 'add' && timing(e));
  for (const e of opponents.entries) timing(e);

  const all = () => [me, ...opponents.entries];

  // --- 출발 그리드 ---
  // 칸 k: 9 + 8k m, 엇갈린 두 열. 사용자가 되돌린 실제 그리드 유지.
  const halfW = (track.width || 16) / 2; // checkStuck의 도로 바깥 판정에도 사용
  function slot(k) {
    const dist = 9 + 8 * k; // 그려진 그리드 칸과 같게 (pack2의 4.2m 촘촘한 배치는 되돌림, 사용자 요청 2026-11-13 '그리드 박스에는 있어야지')
    let t = 1 - dist / L;
    t -= Math.floor(t);
    return { t, lat: (k % 2 === 0 ? -1 : 1) * Math.min(3.4, halfW * 0.42) };
  }
  let mySlot = null; // 온라인: 호스트가 정해 주는 칸
  let gridTotal = null;
  let humanSlots = 0; // 온라인: 앞쪽 칸 0..humans-1은 사람 자리 → 봇은 그 뒤부터
  /** 그리드에 놓기. 플레이어 칸 { t, lat } 를 돌려줌 */
  function placeGrid() {
    stats.byCar = {};
    const total = gridTotal || 1 + bots.length;
    const pIdx = mySlot != null ? mySlot : bots.length ? Math.min(total - 1, Math.ceil(total * 0.6) - 1) : 0;
    const p = slot(pIdx);
    car.placeAt(p.t, p.lat);
    let k = humanSlots;
    for (const b of bots) {
      while (k === pIdx || k < humanSlots) k++;
      const s = slot(k++);
      b.car.placeAt(s.t, s.lat);
      b.car.trackInfo = track.nearest(b.car.pos);
      b.car.events.length = 0;
      b.car.mode = 'normal';
      b.car.manual = false;
      b.driver.reset(true);
      b.driver.state.paceMul = 1; // 따라잡기 효과도 새로
      b.driver.state.cuOn = false;
      b.cuDraft = 0;
      if (MASTER) masterHelp(b, (b.mH = 0), false);
      Object.assign(b, { lastT: s.t, progress: s.t > 0.5 ? s.t - 1 : s.t, lapsDone: 0, lapStart: 0, lap: 1, finished: false, finishTime: null, bestLap: null, lapTimes: [], slowT: 0, offT: 0, wrongT: 0, chkT: 0, chkProg: s.t - 1, grace: 0, respawns: 0 });
      b.marks.fill(NaN);
      b.nextMark = 0;
    }
    Object.assign(me, { finished: false, finishTime: null, bestLap: null, lapTimes: [], progress: p.t - 1, draft: 0 });
    for (const e of [me, ...bots]) Object.assign(e, { draft: 0, _pullSrc: null, _pullT: 0, slip: 0, slipSrc: null, slings: 0, tow: 0, towUsed: 0, towMax: 0, slingFx: false });
    for (const b of bots) b.car.draft = b.car.assistDraft = b.car.tow = b.car.slingT = 0;
    car.draft = car.tow = car.slingT = 0;
    if (drs) drs.reset();
    fastest = null;
    notices.length = 0;
    for (const key in botCornerBest) delete botCornerBest[key];
    me.marks.fill(NaN);
    me.nextMark = 0;
    return p;
  }

  // --- 진행·간격 기록 ---
  function mark(e, time) {
    const k1 = Math.floor(e.progress * M);
    let n = 0;
    while (e.nextMark <= k1 && e.nextMark < markLen && n++ < 50) {
      if (e.nextMark >= 0) e.marks[e.nextMark] = time;
      e.nextMark++;
    }
  }
  function trackBot(b, time) {
    const bc = b.car;
    if (!bc.trackInfo) return;
    if (b.offMain) return; // 지름길·비행 루트 위: 진행 판정 멈춤 (main.js의 플레이어와 같음)
    const t = bc.trackInfo.t;
    let d = t - b.lastT;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    if (Math.abs(d) < 0.25) b.progress += d;
    b.lastT = t;
    // 바퀴 완료
    if (b.progress >= b.lapsDone + 1) {
      const lt = time - b.lapStart;
      b.lapTimes.push(lt);
      b.lapStart = time;
      b.lapsDone++;
      if (b.bestLap == null || lt < b.bestLap) b.bestLap = lt;
      lapSet(b, lt);
      if (b.lapsDone >= laps && !b.finished) {
        b.finished = true;
        b.finishTime = time;
      }
    }
    b.lap = Math.min(laps, b.lapsDone + 1);
    b.speed = Math.abs(bc.speed);
    b.lateral = bc.trackInfo.lateral;
  }

  /** 길이 차이 (m, + = o가 앞). 한 바퀴 앞서도 같은 자리면 가까움으로 봄 (추월·피하기용) */
  const near = (a, b) => {
    let d = ((b.progress - a.progress) % 1) * L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  };

  // --- 봇이 막혔는지 (멈춤·도로 밖·역주행·진행 없음) → 복귀 ---
  function checkStuck(b, dt, since) {
    const bc = b.car;
    if (since < 4 || b.finished) return;
    if (b.grace > 0) {
      b.grace -= dt;
      return;
    }
    const ti = bc.trackInfo;
    // 루프·벽(자석 도로)·뒤집힌 자세에서는 방향·진행 판정이 맞지 않음 → 멈춤만 봄
    //   비행 루트(활주로·하늘·착륙장, track.onShortcut)도 진행 거리가 멈춰 있으므로 같게 (2026-11-10 bots-fly: 안 그러면 5초 '진행 없음' 복귀)
    const loopy = bc.surface === 'magnet' || bc.up.y < 0.8 || (ti && ti.sample && ti.sample.roll) || bc.flying || b.offMain;
    if (loopy) {
      b.wrongT = b.offT = 0;
      b.chkT = 0;
      b.chkProg = b.progress;
    }
    b.slowT = Math.abs(bc.speed) < 3 && (bc.grounded || loopy) ? b.slowT + dt : 0;
    b.offT = !loopy && ti && ti.dist > halfW + 12 && bc.grounded ? b.offT + dt : 0;
    const tan = ti && ti.sample.tan;
    b.wrongT = !loopy && tan && bc.fwd.x * tan.x + bc.fwd.z * tan.z < -0.3 && bc.grounded ? b.wrongT + dt : 0;
    b.chkT += dt;
    let noProg = false;
    if (b.chkT > 5 && !loopy) {
      noProg = (b.progress - b.chkProg) * L < 25;
      b.chkT = 0;
      b.chkProg = b.progress;
    }
    if (b.slowT > 2.5 || b.offT > 1.6 || b.wrongT > 1.8 || noProg) {
      const why = b.slowT > 2.5 ? 'slow' : b.offT > 1.6 ? 'off' : b.wrongT > 1.8 ? 'wrong' : 'noProg';
      respawnLog.push({ name: b.name, why, t: +(ti ? ti.t : -1).toFixed(4), time: +since.toFixed(1), mode: bc.mode });
      bc.respawn();
      bc.events.length = 0;
      b.driver.reset();
      b.respawns++;
      b.slowT = b.offT = b.wrongT = 0;
      b.grace = 1.5;
    }
  }

  // --- 차끼리 충돌 ---
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _n = new THREE.Vector3(), _va = new THREE.Vector3(), _vb = new THREE.Vector3();
  const velOf = (c, out) => (c.grounded && c.moveDir ? out.copy(c.moveDir).multiplyScalar(c.speed) : out.copy(c.vel));
  function setVel(c, v) {
    if (c.grounded && c.setVelocityOnSurface) {
      c.setVelocityOnSurface(v);
      c.vel.copy(c.moveDir).multiplyScalar(c.speed);
    } else c.vel.copy(v);
  }
  const contactRadii = new WeakMap();
  function contactRadius(c) {
    const h = hitboxFor(c);
    return Math.hypot(Math.max(h.front,h.back),h.half,Math.max(Math.abs(h.bottom),Math.abs(h.bottom+h.height)));
  }
  /** a, b = Car (또는 b = 움직이지 않는 상대 모습) */
  function collide(a, b, bStatic) {
    // 각 외형의 실제 크기로 보수적인 구 검사를 먼저 한다. 고정 6m 제한 없음.
    if (a.pos.distanceToSquared(b.pos) > (contactRadius(a)+contactRadius(b))**2) return;
    const contact = obbOverlap(a, b);
    if (!contact.hit || contact.depth <= 1e-7) return;
    a._hitboxMoved=true;if(!bStatic)b._hitboxMoved=true;
    const best = contact.depth;
    _n.copy(contact.normal); // SAT의 겹친 면 b → a. depth와 짝인 법선을 유지.
    let sideHit = false;
    if (Math.abs(a.fwd.dot(b.fwd)) > 0.8) {
      const ah = hitboxFor(a), bh = hitboxFor(b);
      const along = Math.abs(_pa.copy(b.pos).sub(a.pos).dot(a.fwd));
      const sideLimit = Math.min(ah.front + ah.back, bh.front + bh.back) * .55;
      _pb.crossVectors(a.up || car.up, a.fwd).normalize();
      sideHit = Math.abs(_pb.dot(_n)) > .7 && along < sideLimit;
    }
    stats.contacts++;
    const contactKind = Math.abs(_n.dot(a.fwd)) < .7 ? 'side' : 'rear';
    stats[contactKind] = (stats[contactKind] || 0) + 1;
    const hits = stats.byCar || (stats.byCar = {});
    for (const c of bStatic ? [a] : [a,b]) {
      const id = c === car ? 'me' : c.cfg?.carId;
      if (id) hits[id] = (hits[id] || 0) + 1;
    }
    if (NOSPIN) stats.nospin = true;
    if (a === car || b === car) stats.player = (stats.player || 0) + 1; // 플레이어 차가 낀 접촉
    if (stats.time < 8) stats.start = (stats.start || 0) + 1; // 출발 8초 안 (한 덩어리로 출발할 때)
    if (stats.where) {
      const k = a.trackInfo ? Math.floor(a.trackInfo.t * 100) : -1;
      stats.where[k] = (stats.where[k] || 0) + 1;
      stats.pair = [a, b];
    }
    // 겹친 만큼 밀어냄 (반반, 움직이지 않는 상대면 내 차만)
    //   플레이어 대 봇 (hard2): 플레이어가 level.playerPush만큼 (어려움 0.57 = 봇이 조금 더 무거운 것처럼). 예전엔 반반 + 봇이 늘 양보해서 사람이 몸싸움에 항상 이김
    const pp = level.playerPush ?? 0.5;
    const share = bStatic ? 1 : a === car ? pp : b === car ? 1 - pp : 0.5; // a가 받는 몫 (b는 1 − share)
    if (NOSPIN) return softContact(a, b, bStatic, share, sideHit, best);
    a.pos.addScaledVector(_n, best * share);
    if (!bStatic) b.pos.addScaledVector(_n, -best * (1 - share));
    velOf(a, _va);
    if (bStatic) _vb.copy(b.fwd).multiplyScalar(b.speed || 0);
    else velOf(b, _vb);
    const rel = _va.dot(_n) - _vb.dot(_n);
    if (rel >= 0) return;
    const jAll = -(1 + RESTITUTION) * rel; // 두 차 속도 변화의 합 (같은 무게면 반반)
    const sa0 = a.speed, sb0 = b.speed || 0;
    _va.addScaledVector(_n, jAll * share);
    setVel(a, _va);
    if (!bStatic) {
      _vb.addScaledVector(_n, -jAll * (1 - share));
      setVel(b, _vb);
    }
    // 옆으로 비비기: 밀어내기는 옆으로만, 앞 속도는 두 차 모두 같은 비율로 조금씩만 잃음
    //   (예전엔 옆으로 파고드는 차가 부딪힐 때마다 상대의 앞 속도를 가져감: 1.5초 밀기에 +16 / −16 km/h. 늘 들이받는 사람이 이김)
    if (sideHit) {
      const keep = 1 - SIDE_SCRUB;
      a.speed = sa0 * keep;
      a.vel.copy(a.moveDir || a.fwd).multiplyScalar(a.speed);
      if (!bStatic) {
        b.speed = sb0 * keep;
        b.vel.copy(b.moveDir || b.fwd).multiplyScalar(b.speed);
      }
    }
    // 테스트용: 충돌로 플레이어·봇 앞 속도가 얼마나 바뀌었나 (m/s 합)
    if (a === car || b === car) {
      stats.pDv = (stats.pDv || 0) + (a === car ? a.speed - sa0 : b.speed - sb0);
      if (!bStatic) stats.bDv = (stats.bDv || 0) + (a === car ? b.speed - sb0 : a.speed - sa0);
    }
    // 세게 부딪히면 흔들림 + 빙글빙글 돌지 않게 자세 잡기 (벽 충돌과 같은 처리)
    if (rel < -6) {
      stats.hard++;
      a.events.push('bump');
      if (a.afterImpact && a.grounded) a.afterImpact(rel * 0.6);
      if (!bStatic) {
        b.events.push('bump');
        if (b.afterImpact && b.grounded) b.afterImpact(rel * 0.6);
      }
    }
  }

  // --- 부드러운 몸싸움 (NOSPIN) ---
  //   예전: 부딪히면 속도 벡터를 꺾어서(setVelocityOnSurface) 차 방향과 진행 방향이 어긋남(미끄럼각 5~20°) → 다음 스텝부터 타이어(뒤 접지·꼬리 흔들림)가
  //     그 미끄럼을 되돌리며 차 머리를 돌림(최대 110°/s) + 미끄러지는 만큼 감속(slipDrag) + 세게 부딪히면 afterImpact가 머리를 70% 돌리고 마찰로 최대 45% 감속
  //     → 같은 몸싸움이라도 각도·위치·드리프트 상태에 따라 돌거나 크게 느려져서 기준이 안 보였음
  //   지금: 밀어내는 충격(속도 변화)을 차마다 '진행 방향 성분'과 '옆 성분'으로 나눔
  //     옆 성분 → car.cNudge (옆으로 미끄러지듯 밀리는 속도, m/s). 차 방향·slip·yawRate는 안 건드림 → 돌 일이 없음. contact.nudgeDecay로 금방 사라짐 (타이어가 잡아 줌)
  //     진행 방향 성분 → speed만 바꿈 (뒤에서 박으면 뒤차 −, 앞차 +). 나란히 비빌 때(sideHit)는 진행 방향 성분이 없고 앞 속도는 scrub만큼만
  //     afterImpact(벽 충돌용 자세 잡기·감속)는 차끼리는 안 부름. 'bump'(흔들림·소리)는 그대로
  const _fa = new THREE.Vector3(), _wd = new THREE.Vector3(), _wo = new THREE.Vector3();
  function flatDir(c, out) {
    if (c.grounded && c.moveDirTo) c.moveDirTo(out);
    else if (c.vel && c.vel.x * c.vel.x + c.vel.z * c.vel.z > 1) out.copy(c.vel);
    else out.copy(c.fwd);
    out.y = 0;
    const l = Math.hypot(out.x, out.z) || 1;
    out.x /= l;
    out.z /= l;
    return out;
  }
  function velN(c, out) {
    velOf(c, out);
    if (c.cNudge) {
      out.x += c.cNudge.x;
      out.z += c.cNudge.z;
    }
    return out;
  }
  /** c가 받는 속도 변화 _n × j → 진행 방향은 speed, 옆은 cNudge. latOnly = 옆 성분만 (나란히·비스듬히 비빔: 앞 속도는 안 뺏김) */
  function kick(c, j, latOnly) {
    const f = flatDir(c, _fa);
    let dvf = (_n.x * f.x + _n.z * f.z) * j;
    const lx = _n.x * j - f.x * dvf, lz = _n.z * j - f.z * dvf;
    if (latOnly) dvf = 0;
    if (dvf) {
      if (c.grounded && c.moveDir) {
        c.speed += dvf;
        c.moveDirTo(c.vel).multiplyScalar(c.speed);
      } else {
        c.vel.x += f.x * dvf;
        c.vel.z += f.z * dvf;
      }
    }
    if (c.up && c.up.y < 0.7) return; // 벽·루프(자석 도로) 위: 옆 밀림 없음 (수평으로 밀면 벽에서 떨어짐), 위치만 떼어 냄
    if (!c.cNudge) c.cNudge = new THREE.Vector3();
    (c._nPos || (c._nPos = new THREE.Vector3())).copy(c.pos);
    const k = CC.latShare ?? 1;
    c.cNudge.x += lx * k;
    c.cNudge.z += lz * k;
    const m = Math.hypot(c.cNudge.x, c.cNudge.z), mx = CC.nudgeMax ?? 0.8;
    if (m > mx) c.cNudge.multiplyScalar(mx / m);
  }
  function softContact(a, b, bStatic, share, sideHit, depth) {
    velN(a, _va);
    if (bStatic) _vb.copy(b.fwd).multiplyScalar(b.speed || 0);
    else velN(b, _vb);
    const rel = _va.dot(_n) - _vb.dot(_n);
    // 들이받은 쪽이 더 많이 밀려남: 닿는 쪽으로 움직이던 몫(ca, cb)만큼 몫을 옮김 (contact.aggr, 0.5면 ±25%p)
    //   → 비스듬히 파고들면 파고든 차가 옆으로 미끄러지듯 밀려나고, 맞은 차는 살짝만 밀림 (예전엔 맞은 차가 길 밖까지 밀려났음)
    //   (앞뒤 방향 = 두 차 앞 방향의 평균 d. d 방향 속도는 빼고 봄 → 뒤에서 박는 경우는 거의 안 바뀜)
    if (!bStatic && a.fwd.x * b.fwd.x + a.fwd.z * b.fwd.z > 0.5) {
      let dx = a.fwd.x + b.fwd.x, dz = a.fwd.z + b.fwd.z;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const nd = _n.x * dx + _n.z * dz; // n의 앞뒤 성분
      const ca = Math.max(0, -(_va.x * _n.x + _va.z * _n.z - (_va.x * dx + _va.z * dz) * nd));
      const cb = Math.max(0, _vb.x * _n.x + _vb.z * _n.z - (_vb.x * dx + _vb.z * dz) * nd);
      if (ca + cb > 0.5) share = Math.min(0.9, Math.max(0.1, share + (ca / (ca + cb) - 0.5) * (CC.aggr ?? 0.5)));
    }
    // 2 cm 여유: 거의 같은 면에 매 스텝 재진입하며 밀림·마찰을 반복하지 않게 한다.
    const separate = depth + (CC.separationGap ?? 0.02);
    a.pos.addScaledVector(_n, separate * share);
    if (!bStatic) b.pos.addScaledVector(_n, -separate * (1 - share));
    const sa0 = a.speed, sb0 = b.speed || 0;
    if (sideHit) {
      // 나란히 비빔: 앞 속도는 두 차 모두 아주 조금만 (contact.scrub, 닿은 스텝마다)
      const keep = 1 - (CC.scrub ?? SIDE_SCRUB);
      a.speed *= keep;
      if (a.grounded && a.moveDir) a.moveDirTo(a.vel).multiplyScalar(a.speed);
      if (!bStatic) {
        b.speed *= keep;
        if (b.grounded && b.moveDir) b.moveDirTo(b.vel).multiplyScalar(b.speed);
      }
    }
    if (rel < 0) {
      // 거의 같은 쪽을 보는 두 차(앞 방향 차이 37° 안): 똑바로 뒤에서 박은 경우(밀어내는 방향이 앞뒤 성분 70% 넘음)만 앞 속도를 주고받고,
      //   나란히·비스듬히 파고든 경우는 옆으로만 밀어냄 (예전엔 비스듬히 밀면 두 차 모두 스텝마다 앞 속도를 잃어 0.3초에 20~35 km/h 느려졌음)
      const par = Math.abs(a.fwd.x * b.fwd.x + a.fwd.z * b.fwd.z) > 0.8;
      const fa = flatDir(a, _fa), nf = Math.abs(_n.x * fa.x + _n.z * fa.z);
      const latOnly = par && (sideHit || nf < 0.7);
      const jAll = -(1 + (latOnly ? CC.rest ?? 0.15 : CC.restRear ?? 0)) * rel;
      kick(a, jAll * share, latOnly);
      if (!bStatic) kick(b, -jAll * (1 - share), latOnly);
      if (rel < -6) {
        // 흔들림·소리는 0.4초에 한 번만 (계속 비비면 스텝마다 울렸음)
        if (!(a._bumpT > a.simT - 0.4)) {
          stats.hard++;
          a.events.push('bump');
          a._bumpT = a.simT;
        }
        if (!bStatic && !(b._bumpT > b.simT - 0.4)) {
          b.events.push('bump');
          b._bumpT = b.simT;
        }
      }
    }
    // 같은 도로 방향을 뺀 옆 접근으로 맞은 쪽만 알린다. 사람/봇 구별 없음.
    if (!bStatic && a.fwd.dot(b.fwd) > .98) {
      const ta = a.trackInfo?.sample?.tan || a.fwd, tb = b.trackInfo?.sample?.tan || b.fwd;
      const len = Math.hypot(ta.x + tb.x, ta.z + tb.z) || 1, tx = (ta.x + tb.x) / len, tz = (ta.z + tb.z) / len;
      const nd = _n.x * tx + _n.z * tz;
      const ca = Math.max(0, -(_va.x * _n.x + _va.z * _n.z - (_va.x * tx + _va.z * tz) * nd));
      const cb = Math.max(0, _vb.x * _n.x + _vb.z * _n.z - (_vb.x * tx + _vb.z * tz) * nd);
      if (ca + .15 < cb && Math.abs(_n.x * a.fwd.x + _n.z * a.fwd.z) < .7) {
        a._sideContactAt = a.simT; a._sideContactOther = b.pos;
      }
      if (cb + .15 < ca && Math.abs(_n.x * b.fwd.x + _n.z * b.fwd.z) < .7) {
        b._sideContactAt = b.simT; b._sideContactOther = a.pos;
      }
    }
    if (a === car || b === car) {
      stats.pDv = (stats.pDv || 0) + (a === car ? a.speed - sa0 : b.speed - sb0);
      if (!bStatic) stats.bDv = (stats.bDv || 0) + (a === car ? b.speed - sb0 : a.speed - sa0);
    }
  }
  /** 매 스텝: 옆으로 밀리는 속도만큼 위치를 옮기고 줄임. 벽 쪽이면 그 성분은 버림 (레일은 car.keepInsideRail이 다음 스텝에 막음) */
  function applyNudge(c, dt) {
    const n = c.cNudge;
    if (!n || (n.x === 0 && n.z === 0)) return;
    // 충돌 당시의 밀림을 코너에서 앞뒤 힘으로 바꾸지 않고, 현재 진행 방향의 옆 성분만 남긴다.
    const fwd = flatDir(c, _fa), forward = n.x * fwd.x + n.z * fwd.z;
    n.x -= fwd.x * forward;
    n.z -= fwd.z * forward;
    const m = Math.hypot(n.x, n.z);
    const jumped = c._nPos && c._nPos.distanceToSquared(c.pos) > 225; // 복귀·순간이동 (한 스텝에 15 m 넘게) → 밀림 없앰
    if (m < 0.03 || jumped) {
      n.set(0, 0, 0);
      return;
    }
    const step = m * dt;
    _wd.set(n.x / m, 0, n.z / m);
    const tr = c.track || track;
    const hb = hitboxFor(c);
    _pb.crossVectors(c.up, c.fwd).normalize();
    const f = _wd.dot(c.fwd), s = _wd.dot(_pb);
    const reach = Math.max(hb.front * f, -hb.back * f) + hb.half * Math.abs(s);
    const hit = tr.castRay(_wo.copy(c.pos).addScaledVector(c.up, 0.6), _wd, step + reach);
    if (hit && hit.normal && Math.abs(hit.normal.y) < 0.5) {
      // 벽: 벽으로 들어가는 성분을 없앰
      const nx = hit.normal.x, nz = hit.normal.z, nl = Math.hypot(nx, nz) || 1;
      const into = (n.x * nx + n.z * nz) / nl;
      if (into < 0) {
        n.x -= (nx / nl) * into;
        n.z -= (nz / nl) * into;
      }
    } else {
      c.pos.x += n.x * dt;
      c.pos.z += n.z * dt;
    }
    n.multiplyScalar(Math.exp(-(CC.nudgeDecay ?? 8) * dt));
    (c._nPos || (c._nPos = new THREE.Vector3())).copy(c.pos);
  }

  const stats = { contacts: 0, hard: 0 }; // 테스트용: 차끼리 닿은 수, 세게 부딪힌 수
  const respawnLog = []; // 테스트용: 봇이 복귀한 이유·위치

  // --- 슬립스트림 (드래프트): 앞차 바로 뒤(minGap~range m, 옆 lat m 안)에 있으면 공기 저항이 줄어듦 → car.draft (0~1) ---
  //   car.js가 car.draft만큼 공기 저항을 줄이고 최고 속도를 올림. 여기서는 값만 계산해서 넣음 (플레이어·봇)
  //   2026-11-12 (사용자 요청 "더 세고 잘 보이게"): 4~45 m, 옆 2.3 m (예전 4~30 m, 2 m), car.json draft 값도 셈.
  //   충전(x.slip 0~1): draft 0.4 넘게 chargeTime초 → ready 이상 충전된 채 옆으로 빠지면 슬링샷 (car.slingT)
  const DRAFT_MIN = DC.minGap ?? 4, DRAFT_MAX = DC.range ?? 30, DRAFT_LAT = DC.lat ?? 2, DRAFT_V = DC.minSpeed ?? 15;
  //   2026-11-13 슬링샷 없앰: 기본은 충전·슬링샷 없음 (car.json draft.sling false) = 뒤에 붙으면 바로 빨라짐 (car.js pullAccel·topGain). &slip=sling이면 예전 충전+슬링샷
  const SLING = DC.sling === true && !SLIP_OLD;
  function draftFor(x) {
    const c = x.view;
    x.slipCand = null;
    if (!c || (c.mode === 'fly' && c.flying) || Math.abs(c.speed || 0) < DRAFT_V) return 0;
    let best = 0;
    for (const y of all()) {
      if (y === x) continue;
      const d = near(x, y);
      if (d < DRAFT_MIN - 1 || d > DRAFT_MAX) continue;
      const dl = Math.abs((y.lateral || 0) - (x.lateral || 0));
      if (dl > DRAFT_LAT + 0.6) continue;
      if (Math.abs(y.view.pos.y - c.pos.y) > 3) continue; // 위아래로 다른 길
      if (y.view.flying) continue;
      const kd = d < DRAFT_MIN ? (d - (DRAFT_MIN - 1)) : 1 - Math.pow((d - DRAFT_MIN) / (DRAFT_MAX - DRAFT_MIN), 1.3);
      const kl = dl <= DRAFT_LAT ? 1 : 1 - (dl - DRAFT_LAT) / 0.6;
      const ks = Math.min(1, (Math.abs(c.speed) - DRAFT_V) / 15);
      const v = Math.max(0, kd) * kl * ks;
      if (v > best) {
        best = v;
        x.slipCand = y;
      }
    }
    return best;
  }
  function updateDraft(x, dt, racing) {
    const want = racing ? draftFor(x) : 0;
    let k = want > (x.draft || 0) ? 3 : 5; // 들어갈 땐 천천히, 빠질 땐 빨리
    // 2026-11-14 사용자 요청 "빠질 때만 잠깐 유지": 앞차 뒤에서 옆으로 빠져 나란히 서는 동안(앞차가 아직 가까이 있음)은
    //   슬립스트림이 바로 끊기지 않고 약 1초에 걸쳐 줄어듦 (car.json draft.pullOutHold초 동안 k = pullOutK). 사람·봇 같은 규칙. &slip=old면 예전
    if (!SLIP_OLD) {
      if (x.slipCand && (x.draft || 0) > 0.3) { x._pullSrc = x.slipCand; x._pullT = 0; }
      const ps = x._pullSrc;
      if (ps && want < (x.draft || 0)) {
        const d = near(x, ps), dl = Math.abs((ps.lateral || 0) - (x.lateral || 0));
        x._pullT = (x._pullT || 0) + dt;
        if (d > -3 && d < DRAFT_MAX && dl > DRAFT_LAT * 0.8 && x._pullT < (DC.pullOutHold ?? 1)) k = DC.pullOutK ?? 1.2;
        else if (x._pullT >= (DC.pullOutHold ?? 1)) x._pullSrc = null;
      }
    }
    x.draft = (x.draft || 0) + (want - (x.draft || 0)) * Math.min(1, dt * k);
    // 0 근처 자르기는 원할 때(want)도 0일 때만 (예전엔 매 스텝 잘라서 want < 0.4 = 19 m보다 먼 슬립스트림은 아예 안 생겼음. &slip=old는 예전 그대로)
    if (x.draft < 0.01 && (SLIP_OLD || want < 0.01)) x.draft = 0;
    x.view.draft = x.draft;
    if (x.slipCand) x.slipSrc = x.slipCand;
    // 슬립스트림 기차 (2026-11-12 drs): 내 앞차도 (그 앞차의) 슬립스트림을 받고 있으면 내 슬립스트림이 더 셈 (car.draftTrain 1~2, car.json draft.trainGain)
    const tsrc = x.draft > 0.3 ? x.slipCand : null;
    x.train = tsrc ? Math.min(3, 1 + ((tsrc.draft || 0) > 0.3 ? tsrc.train || 1 : 0)) : 0;
    x.view.draftTrain = SLIP_OLD || NO_TRAIN ? 0 : Math.max(0, x.train - 1);
    if (!SLING || !racing) {
      x.slip = 0;
      return;
    }
    // 충전·슬링샷
    const c = x.view, ready = DC.ready ?? 0.9;
    if (x.draft > 0.4) x.slip = Math.min(1, (x.slip || 0) + (dt / (DC.chargeTime ?? 1.6)) * Math.min(1, x.draft / 0.8));
    else if (x.draft < 0.15) {
      if ((x.slip || 0) >= ready && x.slipSrc && pulledOut(x, x.slipSrc)) {
        c.slingT = DC.slingTime ?? 1.5;
        x.slings = (x.slings || 0) + 1;
        x.slip = 0;
        if (x === me) x.slingFx = true;
      }
      x.slip = Math.max(0, (x.slip || 0) - dt / (DC.decayTime ?? 1.2));
    }
    if (!x.slip && x.draft === 0) x.slipSrc = null;
  }
  /** 충전된 채 앞차 옆으로 빠졌는지: 앞차가 아직 가까이(옆 또는 앞 slingAhead m 안) 있고, 옆으로 비켜 있고, 액셀을 밟는 중 */
  function pulledOut(x, y) {
    const c = x.view;
    if (!c || !c.grounded || c.flying || Math.abs(c.speed || 0) < 20 || (c.thr ?? 1) < 0.3) return false;
    const d = near(x, y);
    if (d < -3 || d > (DC.slingAhead ?? 32)) return false;
    return Math.abs((y.lateral || 0) - (x.lateral || 0)) > DRAFT_LAT;
  }

  // --- 견인 (2026-11-12, 사용자 요청 "뒤처지면 끌어당겨 줌"): 1등보다 startSec초 넘게 뒤처진 차를 살짝 밀어 줌 → car.tow (0~1) ---
  //   효과는 car.js (공기 저항 ↓, 최고 속도·힘 살짝 ↑, data/car.json tow). startSec 안으로 들어오면 꺼지므로 1등을 따라잡게 만들지는 않음
  //   봇 레이스·아이템전·챔피언십·온라인(내 차·내 화면의 봇만), 혼자·타임 어택은 없음 (상대가 없으면 꺼짐). 설정 '견인' 또는 &tow=0이면 끔
  //   기본은 마스터를 포함해 사람·봇 같은 조건. &rb=1에서만 예전 따라잡기 중복 제외를 복원
  const towCalm = (() => {
    // 점프 립 80 m 앞 ~ 착지 200 m 뒤 (bots.js jumpCalm과 같은 구간): 견인으로 빨라지면 점프 착지가 어긋남
    const Nn = line && line.N;
    if (!Nn || !track.jumps || !track.jumps.length) return null;
    const arr = new Uint8Array(Nn), ds = L / Nn, W = (i) => ((i % Nn) + Nn) % Nn;
    for (const jp of track.jumps) {
      if (jp.lipI == null) continue;
      let end = (jp.landI != null ? jp.landI : jp.lipI + Math.round(60 / ds)) + Math.round(200 / ds);
      if (end < jp.lipI) end += Nn;
      for (let k = jp.lipI - Math.round(80 / ds); k <= end; k++) arr[W(k)] = 1;
    }
    return arr;
  })();
  const towOn = () => !TOW_URL_OFF && settings.values.tow !== false && (bots.length > 0 || opponents.entries.some((e) => e.remote));
  function towWant(x, ahead, lead, time) {
    const c = x.view;
    // want는 목표 세기, strength는 보간 뒤 실제 세기. 사람/봇 같은 함수를 기록한다.
    const info=x.towInfo||(x.towInfo={}); Object.assign(info,{reason:"active",gLeader:null,gAhead:null,gap:null});
    const zero=reason=>{x.towInfo.reason=reason;return 0;};
    if (!lead || x === lead || x.finished || x.remote || !c || time < (TC.startDelay ?? 8)) return zero(!lead?"noLeader":x===lead?"leader":x.finished?"finished":x.remote?"remote":!c?"noCar":"startDelay");
    if (c.flying || !c.grounded || c.mode === 'fly' || x.offMain) return zero(c.flying?'flying':!c.grounded?'airborne':c.mode==='fly'?'fly':'offMain');
    if (c.surface === 'water' && (TOW_OLD || !(TC.waterGain > 0))) return zero("water");
    const ti = c.trackInfo;
    if (towCalm && ti && towCalm[Math.min(towCalm.length - 1, Math.max(0, Math.floor(ti.t * towCalm.length)))]) return zero("jumpCalm");
    if (c.gravityScale && c.gravityScale() < 0.95) return zero("lowGravity"); // 저중력: 빨라지면 날아감
    if (RUBBER_BAND && x !== me) {
      const st = x.driver && x.driver.state;
      if (MASTER || (x.cuDraft || 0) > 0.01 || (st && (st.paceMul > 1.001 || st.paceMul < 0.999 || st.calm))) return zero("rubberBand"); // 따라잡기로 빨라지거나(어려움 &cu=1) 늦춰지는(쉬움) 봇은 견인 없음
      if (st && st.closeOn && st.eq && st.eq.keep > 1.001) return zero("close"); // 접전(bots.js CLOSE)으로 이미 당겨지는 봇은 견인 없음 (겹치지 않게)
    }
    // 견인 3차 (2026-11-12, 사용자 "그냥 멀수록 속도가 많이 빨라지게"): 간격 = max(바로 앞차와의 간격, 1등과의 간격 × leadShare)
    //   → startSec초부터 fullSec초까지 간격에 비례해서 세짐 (멀수록 그만큼 더 빨라짐). 무리 전체가 1등과 멀어도 1등 몫 때문에 다 같이 빨라짐
    const secOf = (g) => (g.laps ? 99 : g.sec || 0);
    const gL = secOf(gapBetween(lead, x, time));
    const gA = ahead && ahead !== lead ? secOf(gapBetween(ahead, x, time)) : gL;
    const sec = TOW_OLD ? gL : Math.max(gA, gL * (TC.leadShare ?? 0.5));
    Object.assign(x.towInfo,{gLeader:gL,gAhead:gA,gap:sec});
    const s0 = TC.startSec ?? 2.5, s1 = TC.fullSec ?? 10;
    if(sec<=s0)x.towInfo.reason="withinStart";
    const k = Math.max(0, Math.min(1, (sec - s0) / Math.max(0.1, s1 - s0)));
    // curve < 1: 처음 몇 초에서 빨리 세지고 멀수록 계속 커짐 (0.5 = 제곱근: 3초 39%, 5초 55%, 10초 83%, 14초 100%)
    return TOW_OLD ? k : Math.pow(k, TC.curve ?? 1);
  }
  function updateTow(dt, time, racing) {
    const on = racing && towOn();
    let lead = null;
    if (on) for (const e of all()) {
      const p = e.finished ? laps : e.progress, lp = lead ? (lead.finished ? laps : lead.progress) : -Infinity;
      if (!lead || p > lp || (p === lp && e.finished && lead.finished && e.finishTime < lead.finishTime)) lead = e;
    }
    for (const x of [me, ...bots]) {
      // 바로 앞차 (견인 3차: 간격 = max(바로 앞차 간격, 1등 간격 × leadShare), towWant). &towold=1 = 예전(1등 기준만)
      let ref = null;
      if (on && !TOW_OLD) {
        let best = 1;
        for (const y of all()) {
          if (y === x) continue;
          const d = Math.min(laps, y.progress) - x.progress;
          if (d > 0 && d < best) {
            best = d;
            ref = y;
          }
        }
      }
      const want = on ? towWant(x, ref, lead, time) : 0;
      if (!on) x.towInfo = {reason:racing?"disabled":"countdown",gLeader:null,gAhead:null,gap:null};
      x.towInfo.want = want;
      const cur = x.tow || 0;
      const r = want > cur ? TC.rampIn ?? 1.5 : TC.rampOut ?? 0.5;
      x.tow = cur + (want - cur) * Math.min(1, dt / Math.max(0.05, r));
      if (x.tow < 0.01 && want < 0.01) x.tow = 0;
      x.view.tow = x.tow;
      x.towInfo.strength = x.tow;
      if (x.tow > (x.towMax || 0)) x.towMax = x.tow;
      if (x === me && x.tow > 0 && !x.finished) x.towUsed = (x.towUsed || 0) + x.tow * dt; // 기록 '도움 켬' 판정용 (가장 센 견인 기준 초)
    }
  }

  // pack2: 물 위에도 같은 눈에 보이는 슬립스트림/견인. 원본 차 설정은 바꾸지 않음.
  // 파도 점프·후진·제동 중에는 추가 추진 없음. 급류/아이템의 기존 속도를 깎지 않음.
  function waterAero(x, dt, racing) {
    const c=x.view;
    c.waterAeroTop=1;
    if(!racing||x.finished||!c.grounded||c.mode!=='boat'||c.surface!=='water'||c.speed<=0)return;
    const b=c.cfg.modes.boat, dr=c.cfg.draft||{}, tw=c.cfg.tow||{};
    const slip=SLIP_OLD?0:Math.min(1,c.draft||0), tow=TOW_OLD?0:Math.min(1,c.tow||0);
    const train=1+Math.min(2,c.draftTrain||0)*(dr.trainGain||0);
    const gain=Math.min(.12, slip*(dr.topGain||0)*train*(dr.waterGain||0)+tow*(tw.topGain||0)*(tw.waterGain||0));
    c.waterAeroTop=1+gain;
    if(gain<=0)return;
    if((c.brk||0)>.05||(c.thr||0)<=0)return;
    const base=Math.min(b.maxSpeed,Math.sqrt(Math.max(1,b.thrust-b.rolling)/b.drag));
    const cap=base*(1+gain);
    if(c.speed>=cap)return;
    const cut=Math.min(.65,slip*(dr.dragCut||0)*train*(dr.waterGain||0)+tow*(tw.dragCut||0)*(tw.waterGain||0));
    const accel=Math.min(2.5,b.drag*c.speed*c.speed*cut+(c.thr||0)*b.thrust*(tw.powerGain||0)*tow*(tw.waterGain||0));
    c.speed=Math.min(cap,c.speed+accel*dt);
    if(c.moveDirTo)c.moveDirTo(c.vel).multiplyScalar(c.speed);
    x.speed=Math.abs(c.speed);
  }

  // --- 레이스 알림 (main.js가 꺼내 감): 최고 랩 ---
  const notices = [];
  const botCornerBest = {}; // 코너 번호 → 이번 레이스 봇 최고 코너 시간 (결과 화면 코너 분석)
  let fastest = null; // { name, time, isPlayer, color }
  function lapSet(e, lt) {
    if (lt < 5) return;
    if (!fastest || lt < fastest.time) {
      const first = !fastest;
      fastest = { name: e.name, time: lt, isPlayer: e === me, color: e.color };
      if (!first || laps > 1) notices.push({ type: 'fastest', ...fastest });
    }
  }
  const stepOthers = [], otherSlots = [], stepRemotes = [];
  let stepBodies = [];
  const addOther = (id, progM, lat, speed, human, fwd, hitbox, pos, fin) => { const i = stepOthers.length; const slot = otherSlots[i] || (otherSlots[i] = {}); slot.id=id; slot.progM=progM; slot.lat=lat; slot.speed=speed; slot.human=human; slot.fwd=fwd; slot.hitbox=hitbox; slot.pos=pos; slot.fin=fin; stepOthers.push(slot); };
  let paceT = 0, racingNow = false;
  /** 물리 한 스텝 (main.js의 고정 스텝마다) */
  function step(dt, phase, time, playerProgress) {
    // 봇의 첫 간격 판단부터 온라인 상대의 실제 외형을 사용한다.
    for(const e of opponents.entries)if(e.remote)e.view.look=e.look;
    const racing = phase !== 'countdown';
    stats.time = racing ? time : 0;
    // 플레이어 진행
    me.progress = playerProgress;
    me.speed = Math.abs(car.speed);
    me.lateral = (car.trackInfo || (car.trackInfo = track.nearest(car.pos))).lateral;
    // 지름길·비행 루트(활주로·하늘·착륙장) 위인지: 그동안 진행 거리가 멈춰 있어서 '앞뒤 거리'가 틀림 → 봇은 실제 위치로 봄
    for (const e of all()) e.offMain = !!(e.view && (e.view.flying || (track.onShortcut && track.onShortcut(e.view.pos))));
    // 봇 운전
    for (const b of bots) {
      const bc = b.car;
      if (!racing) {
        // 출발 전: 출발선에 묶어 둠
        bc.update(dt, { throttle: 0, brake: 0, steer: 0 });
        bc.speed = 0;
        bc.vel.x = bc.vel.z = 0;
      } else {
        const others = stepOthers;
        others.length = 0;
        for (let ei = -1; ei < opponents.entries.length; ei++) {
          const e = ei < 0 ? me : opponents.entries[ei];
          if (e === b || (e.finished && !b.finished && !e.isPlayer)) continue; // 완주하고 천천히 도는 봇은 피하지 않음 (부딪힘도 없음)
          const human = e === me || !!e.remote;
          if (e.remote) e.view.look = e.look;
          if (b.offMain || e.offMain) {
            // 둘 중 하나가 비행 루트 위: 진행 거리 대신 실제 위치 차이 (60 m 안만), 내 차 앞 방향 기준 앞뒤·옆
            const ep = e.view.pos, dx = ep.x - bc.pos.x, dy = ep.y - bc.pos.y, dz = ep.z - bc.pos.z;
            if (dx * dx + dy * dy + dz * dz > 3600) continue;
            const fl = Math.hypot(bc.fwd.x, bc.fwd.z) || 1, fx = bc.fwd.x / fl, fz = bc.fwd.z / fl;
            if (Math.abs(dy) > 4 && !(b.offMain && e.offMain)) continue; // 한쪽은 하늘, 한쪽은 땅
            addOther(e.id, dx * fx + dz * fz, (b.lateral || 0) + (fx * dz - fz * dx), Math.abs(e.view.speed || 0), human, e.view.fwd, hitboxFor(e.view), ep, !!e.finished);
            continue;
          }
          addOther(e.id, near(b, e), e.lateral, e.speed, human, e.view.fwd, hitboxFor(e.view), e.view.pos, !!e.finished);
        }
        const c = b.driver.controls({ since: time, dt, me: { progM: 0, lat: b.lateral }, others, finished: b.finished });
        bc.update(dt, c);
      }
      scenery.collideCar(bc);
      if (bc.events.length) {
        if (bc.events.includes('respawn')) b.driver.reset();
        // 코너 분석(결과 화면): 봇 중 가장 빠른 코너 시간
        if (racing && !b.finished && bc.events.includes('corner')) {
          const ci = bc.lastCornerInfo;
          if (ci && ci.time != null && ci.num != null && !(botCornerBest[ci.num] <= ci.time)) botCornerBest[ci.num] = ci.time;
        }
        bc.events.length = 0;
      }
      if (racing) {
        trackBot(b, time);
        checkStuck(b, dt, time);
      } else b.lateral = bc.trackInfo ? bc.trackInfo.lateral : 0;
    }
    // 차끼리 충돌 (플레이어 + 봇), 온라인 상대는 움직이지 않는 벽처럼 (내 차만 밀림)
    // 완주한 봇은 (천천히 돌며 길을 막으므로) 다른 차와 부딪히지 않음
    let bodyCount = 1, bodiesChanged = stepBodies[0] !== car;
    for (const b of bots) if (!b.finished) { if (stepBodies[bodyCount] !== b.car) bodiesChanged = true; bodyCount++; }
    if (bodiesChanged || bodyCount !== stepBodies.length) {
      stepBodies = [car];
      for (const b of bots) if (!b.finished) stepBodies.push(b.car);
    }
    const bodies = stepBodies;
    for(const c of bodies)c._hitboxPeers=bodies;
    for (const e of opponents.entries) if (e.remote && e.target) {
      e.view.look=e.look;e.view._hitboxPeers=bodies;
      e.view.hitboxProgress=e.target.accelProgress??e.target.accelP;advanceHitbox(e.view,dt);
    }
    if (NOSPIN) for (const c of bodies) applyNudge(c, dt);
    for (let i = 0; i < bodies.length; i++) for (let k = i + 1; k < bodies.length; k++) collide(bodies[i], bodies[k], false);
    for (const e of opponents.entries) {
      if (!e.remote || !e.target) continue;
      e.lateral = track.nearest(e.view.pos).lateral; // 봇이 온라인 상대도 피하게
      e.view.look = e.look;
      collide(car, e.view, true);
      for (const b of bots) collide(b.car, e.view, true);
    }
    // hitbox2: 3대 이상 연쇄 접촉도 같은 스텝 안에 풀기. 속도/요/잔여 밀림은 재적용하지 않음.
    const remotes=stepRemotes; remotes.length=0;
    for(const e of opponents.entries)if(e.remote&&e.target)remotes.push(e.view);
    for(let pass=0;pass<128;pass++) {
      let remaining=0;
      const separate=(a,b,staticB)=>{
        if(a.pos.distanceToSquared(b.pos)>(contactRadius(a)+contactRadius(b))**2)return;
        const h=obbOverlap(a,b);if(!h.hit||h.depth<.0001)return;
        remaining=Math.max(remaining,h.depth);
        const amount=h.depth+.002,share=staticB?1:.5;
        a._hitboxMoved=true;if(!staticB)b._hitboxMoved=true;
        a.pos.addScaledVector(h.normal,amount*share);
        if(!staticB)b.pos.addScaledVector(h.normal,-amount*(1-share));
      };
      for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)separate(bodies[i],bodies[j],false);
      for(const c of bodies)for(const r of remotes)separate(c,r,true);
      for(const c of bodies)constrainHitbox(c);
      if(remaining<.0001){
        // 레일/벽 보정이 방금 떨어뜨린 다른 쌍을 다시 밀어 붙일 수 있다. 보정 뒤 기준으로 끝낸다.
        let clear=true;
        const check=(a,b)=>{if(a.pos.distanceToSquared(b.pos)<=(contactRadius(a)+contactRadius(b))**2){const h=obbOverlap(a,b);if(h.hit&&h.depth>=.0001)clear=false;}};
        for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)check(bodies[i],bodies[j]);
        for(const c of bodies)for(const r of remotes)check(c,r);
        if(clear)break;
      }
    }
    // 슬립스트림
    racingNow = racing;
    updateDraft(me, dt, racing);
    for (const b of bots) {
      updateDraft(b, dt, racing);
      b.driver.state.realDraft = b.draft; // 봇 운전사는 진짜 슬립스트림만 봄 (추월 판단)
      // 따라잡기(어려움·마스터)의 보이지 않는 슬립스트림: car.assistDraft (예전 세기 그대로, car.json draft.assistDragCut·assistTopGain), 점프 근처·저중력에서는 안 함
      b.car.assistDraft = RUBBER_BAND && b.cuDraft > 0 && racing && !b.driver.state.calm ? b.cuDraft : 0;
    }
    // 견인
    updateTow(dt, time, racing);
    // DRS
    if (drs) drs.step(dt, time, racing);
    for (const x of [me, ...bots]) waterAero(x, dt, racing);
    // 간격 기록
    if (racing) {
      mark(me, time);
      for (const b of bots) mark(b, time);
      for (const e of opponents.entries) if (e.remote) mark(e, time);
    }
    // 따라잡기 효과 (실력별, BOT_LEVELS.catchUp): 0.5초마다
    paceT += dt;
    if (paceT > 0.5) {
      paceT = 0;
      catchUp(time, racing);
    }
  }

  // --- 마스터(master): 봇마다 고정 도움 (bots.js BOT_LEVELS.master 설명 참고, 내 기록은 안 봄) ---
  function setupMaster() {
    const mc = level.master;
    const order = bots.map((_, i) => i).sort(() => rand() - 0.5);
    const n = bots.length;
    bots.forEach((b, i) => {
      const r = n > 1 ? order.indexOf(i) / (n - 1) : 1;
      b.mFix = mc.help[0] + (mc.help[1] - mc.help[0]) * r;
      b.mH = 0;
      const cfg = b.car.cfg;
      b.mBase = { lat: cfg.tire.lateral, steerLat: cfg.steerLat, steerRate: cfg.steerRate, trac: cfg.tire.traction, brake: cfg.tire.brakeGrip, power: cfg.engine.power };
    });
    return { info: { help: bots.map((b) => +b.mFix.toFixed(2)) } };
  }
  /** 마스터 도움 h(0~1)를 차 성능에 반영 (봇 차의 cfg는 봇마다 따로라 다른 차에 영향 없음) */
  function masterHelp(b, h, calm) {
    const mc = level.master, cfg = b.car.cfg, B = b.mBase;
    if (!B || !RUBBER_BAND) return; // 기본은 자기 차 원래 성능. 기존 도움은 rb=1 호환 경로만.
    const g = 1 + mc.gripMax * h;
    cfg.tire.lateral = B.lat * g;
    cfg.steerLat = B.steerLat * g;
    cfg.steerRate = B.steerRate * g; // 느린 헤어핀은 접지보다 핸들 꺾임(회전 속도)이 한계 → 같이 늘려야 빨라진 속도로도 돎 (화산 H1에서 벽에 박혔음)
    cfg.tire.traction = B.trac * g;
    cfg.tire.brakeGrip = B.brake * g;
    cfg.engine.power = B.power * (1 + (calm ? 0 : mc.powerMax * h));
  }
  /** 0.5초마다: 도움 정하기 → { want(paceMul), draft } */
  function masterKeeper(b, time, lead) {
    const mc = level.master, st = b.driver.state;
    let hT = b.mFix || 0;
    if (RUBBER_BAND && lead && b.progress < lead.progress) {
      const g = gapBetween(lead, b, time);
      const sec = g.laps ? 99 : g.sec || 0;
      if (sec > mc.humanSec) hT = Math.max(hT, Math.min(1, (sec - mc.humanSec) / mc.gain));
    }
    if (time < 3) hT = Math.min(hT, mc.startHelp); // 출발 덩어리에서는 덜
    if (RUBBER_BAND) b.mH += (hT - b.mH) * 0.3;
    else b.mH = hT; // 출발 제한 뒤에는 판 시작 때 정한 도움 그대로 (사람과 무관)
    if (b.mH < 0.01) b.mH = 0;
    masterHelp(b, b.mH, st.calm);
    return { want: 1 + mc.paceMax * b.mH, draft: RUBBER_BAND ? mc.draftMax * b.mH : 0 };
  }

  /** 기준 = 가장 앞선 사람 (혼자면 나, 온라인이면 나와 다른 사람 중 1등). 완주한 사람은 빼고, 모두 완주했으면 null */
  function leadHuman() {
    let lead = null;
    for (const e of all()) {
      if (!(e === me || e.remote) || e.finished) continue;
      if (!lead || e.progress > lead.progress) lead = e;
    }
    return lead;
  }
  /**
   * 쉬움: 사람보다 aheadM m 넘게 앞선 봇은 slowMul로 늦춤 → releaseM m 안으로 들어오면 원래대로 (빨라지게는 안 함)
   * 어려움: 사람이 sec초 넘게 앞서면 upMul + 보이지 않는 슬립스트림 upDraft, 봇이 secDown초 넘게 앞서면 downMul
   * 보통: 없음 (항상 1)
   */
  // 접전(bots.js CLOSE)이 켜져 있으면 예전 따라잡기(쉬움 slowMul·어려움 upMul/upDraft)는 안 씀: 사람 기준 당기기·늦추기를 bots.js 무리 유지가 대신 함 (겹치지 않게)
  const CLOSE_ON = RUBBER_BAND && CLOSE.on && !!level.close && PACK.on && PACK.keep.on;
  // 숨은 고무줄은 &rb=1에서만 복원: 쉬움 늦추기·마스터 사람 기준 증가·가짜 슬립스트림.
  //   어려움 따라잡기와 CLOSE는 예전처럼 &cu=1 / &close=1도 필요. 기본은 모두에게 같은 견인·슬립스트림·DRS만.
  const LEGACY_CU = RUBBER_BAND && QS.get('cu') === '1';
  function catchUp(time, racing) {
    const cu = RUBBER_BAND && !CLOSE_ON && level.catchUp && (level.catchUp.aheadM || LEGACY_CU) ? level.catchUp : null;
    const lead = RUBBER_BAND && racing && (cu || MASTER) ? leadHuman() : null;
    for (const b of bots) {
      const st = b.driver.state;
      let want = 1, draft = 0;
      if (MASTER) {
        if (racing && !b.finished) ({ want, draft } = masterKeeper(b, time, lead));
        else if (b.mH) masterHelp(b, (b.mH = 0), false);
      } else if (CLOSE_ON && racing && !b.finished) {
        // 접전: 사람보다 띠(close.behind)+draftAt초 넘게 뒤처진 봇에게만 보이지 않는 슬립스트림 (단계 close.draft 최대, 1.5초에 걸쳐 커짐)
        const C = level.close;
        const d0 = C.behind + (C.draftAt ?? 1);
        if (C.draft && st.closeOn && st.closeSec > d0) draft = Math.min(1, (st.closeSec - d0) / 1.5) * C.draft;
      } else if (lead && !b.finished) {
        if (cu.aheadM) {
          const d = (b.progress - lead.progress) * L; // + = 봇이 앞
          if (d > cu.aheadM) st.cuOn = true;
          else if (d < (cu.releaseM ?? 30)) st.cuOn = false;
          want = st.cuOn ? cu.slowMul : 1;
        } else if (cu.sec) {
          const g = b.progress >= lead.progress ? gapBetween(b, lead, time) : gapBetween(lead, b, time);
          const sec = g.laps ? 99 : g.sec || 0; // 뒤차가 몇 초 뒤인지
          // hard2: 라인 봇 상한(1/pace)은 없앰 (사람이 라인 봇보다 12~15% 빨랐음). 대신 차 물리 한계 안에서만:
          //   코너 속도 배수 upMul + 공기 저항을 줄여 주는 '보이지 않는 슬립스트림' upDraft (car.draft와 같은 효과, 최고 +4%×upDraft)
          if (b.progress < lead.progress && sec > cu.sec) {
            want = cu.upMul;
            draft = cu.upDraft || 0;
          } else if (b.progress > lead.progress && sec > (cu.secDown ?? cu.sec)) want = cu.downMul;
        }
      }
      if (MASTER && !RUBBER_BAND) st.paceMul = want; // 고정 도움의 계획 속도도 즉시 같은 값으로
      else st.paceMul += (want - st.paceMul) * 0.3;
      if (Math.abs(st.paceMul - want) < 0.002) st.paceMul = want;
      b.cuDraft = (b.cuDraft || 0) + (draft - (b.cuDraft || 0)) * 0.3;
      if (b.cuDraft < 0.01) b.cuDraft = 0;
    }
  }

  // --- 순위 ---
  function standings() {
    const list = all().slice();
    list.sort((a, b) => {
      if (a.finished && b.finished) return (a.finishTime ?? 1e9) - (b.finishTime ?? 1e9);
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    list.forEach((e, i) => (e.position = i + 1));
    return list;
  }
  /** b가 a보다 몇 초 뒤인지 (같은 지점을 지난 시각 차이). 한 바퀴 이상 차이면 { laps } */
  function gapBetween(a, b, time) {
    if (a.finished && b.finished && a.finishTime != null && b.finishTime != null) return { sec: b.finishTime - a.finishTime };
    const lapsDown = Math.floor(a.progress - b.progress);
    if (lapsDown >= 1) return { laps: lapsDown };
    const k = b.nextMark - 1;
    if (k >= 0 && isFinite(a.marks[k]) && isFinite(b.marks[k])) return { sec: b.marks[k] - a.marks[k] };
    // 아직 기록 지점이 없으면 거리 ÷ 속도로 어림
    return { sec: ((a.progress - b.progress) * L) / Math.max(10, b.speed || 10) };
  }
  const gapText = (g) => (!g ? '' : g.laps ? `+${g.laps}랩` : `+${g.sec.toFixed(g.sec < 10 ? 3 : 1)}`);

  /** HUD용: 내 순위, 앞·뒤 차와의 간격, 순위표 */
  function hudInfo(time) {
    const list = standings();
    const i = list.indexOf(me);
    const ahead = i > 0 ? list[i - 1] : null, behind = i < list.length - 1 ? list[i + 1] : null;
    const tower = list.map((e, k) => ({
      pos: k + 1, name: e.name, color: e.color, isPlayer: e === me, finished: e.finished, remote: e.remote,
      gap: k === 0 ? (e.finished ? '완주' : `LAP ${Math.min(laps, Math.max(1, e.lap || 1))}`) : time > 0.5 ? gapText(gapBetween(list[0], e, time)) : '',
    }));
    return {
      pos: i + 1, total: list.length,
      ahead: ahead ? { name: ahead.name, gap: time > 0.5 ? gapBetween(ahead, me, time) : null } : null,
      behind: behind ? { name: behind.name, gap: time > 0.5 ? gapBetween(me, behind, time) : null } : null,
      tower,
    };
  }

  /** 결과표: 완주 못 한 차는 지금 평균 속도로 남은 거리를 달린 예상 기록 */
  function results(time) {
    const list = standings();
    const rows = list.map((e) => {
      let total = e.finished ? e.finishTime : null, projected = false;
      if (total == null) {
        const done = Math.max(0.01, e.progress);
        total = time + ((laps - e.progress) * time) / done;
        projected = true;
      }
      return { pos: e.position, id: e.id, name: e.name, carName: e.carName, color: e.color, isPlayer: e === me, remote: !!e.remote, bestLap: e.bestLap, total, projected, finished: e.finished };
    });
    // 예상 기록 차가 완주한 차보다 앞서 보이지 않게 순서대로 정리
    for (let i = 1; i < rows.length; i++) if (rows[i].total < rows[i - 1].total) rows[i].total = rows[i - 1].total + 0.5;
    return rows;
  }

  /** 플레이어 완주 (main.js) */
  function playerFinished(time, lapTimes, best) {
    me.finished = true;
    me.finishTime = time;
    me.lapTimes = lapTimes.slice();
    me.bestLap = best;
    standings();
    return me.position;
  }
  function playerLap(lapTime) {
    if (me.bestLap == null || lapTime < me.bestLap) me.bestLap = lapTime;
    lapSet(me, lapTime);
  }

  // --- 슬립스트림·견인 연출 (slipFx.js): 플레이어 기준 ---
  const findScene = () => {
    for (const e of opponents.entries) if (e.model && e.model.root && e.model.root.parent) return e.model.root.parent;
    return null;
  };
  // DRS: 구간은 기본 차(f1) 속도 계획으로 찾음 → 온라인에서도 모두 같은 구간
  let drs = null;
  try {
    let dcfg = null;
    if (o.loadCarConfig) dcfg = await o.loadCarConfig('f1').catch(() => null);
    const prof = line ? profileFor(line, dcfg || car.cfg) : null;
    drs = createDrs({
      track, line, prof, cfg: car.cfg.drs, me, scene: findScene,
      isOn: () => !DRS_URL_OFF && settings.values.drs !== false && (bots.length > 0 || opponents.entries.some((e) => e.remote)),
      all, local: () => [me, ...bots],
    });
  } catch (err) {
    console.warn('DRS 만들기 실패', err);
  }
  let slipFx = null;
  try {
    slipFx = createSlipFx({ getScene: findScene, draftCfg: DC, sling: SLING });
    if (bots.length) slipFx.prepare(); // 공기 줄기 메시를 미리 장면에 넣어 둠 (불러오는 화면에서 셰이더를 미리 만듦)
  } catch (err) {
    console.warn('슬립스트림 연출 만들기 실패', err);
  }

  /** 화면 */
  function update(dt, elapsed, camera) {
    opponents.render(dt, elapsed, camera, (e) => [e.name, `P${e.position || ''}`]);
    if (slipFx) {
      const src = me.slipSrc && me.slipSrc.view && me.draft > 0.03 ? me.slipSrc.view : null;
      const water = car.mode === 'boat' && car.surface === 'water';
      const gain = Math.min(water ? .12 : DC.topMax ?? 1, (me.draft || 0) * (DC.topGain ?? 0.04) * (1 + Math.min(2, car.draftTrain || 0) * (DC.trainGain ?? 0)) * (water ? SLIP_OLD ? 0 : DC.waterGain || 0 : 1)); // HUD '+n%': 물의 공통 배율도 그대로 표시
      slipFx.update(dt, camera, { racing: racingNow && !me.finished, draft: me.draft || 0, charge: me.slip || 0, gain, src, myPos: car.pos, tow: me.tow || 0, towOn: towOn(), sling: !!me.slingFx });
      me.slingFx = false;
    }
    if (drs) drs.update(dt, racingNow);
  }

  /** 미니맵 점 */
  const dots = () => opponents.entries.map((e) => ({ x: e.view.pos.x, z: e.view.pos.z, color: e.color }));

  return {
    bots, me, M, stats, respawnLog, notices, botCornerBest, get fastest() {
      return fastest;
    },
    active: () => bots.length > 0 || opponents.entries.length > 0, hasGrid: () => bots.length > 0 || gridTotal != null,
    placeGrid, step, update, standings, hudInfo, results, playerFinished, playerLap, dots, gapText, fmtTime,
    /** 온라인: 내 그리드 칸 (0 = 맨 앞)과 전체 수 */
    setGrid(index, total, humans = 0) {
      mySlot = index;
      gridTotal = Math.max(total || 0, (humans || 0) + bots.length, index + 1);
      humanSlots = humans || 0;
    },
    level: levelName,
    seed, // 장면 저장(F8)·재현용
    /** 견인을 의미 있게 받았는지 (가장 센 견인 기준 tow.assistSec초 넘게) → main.js가 기록에 '도움 켬' */
    towAssisted: () => (me.towUsed || 0) >= (TC.assistSec ?? 3),
    /** 테스트용: 슬립스트림·견인 상태 */
    slipInfo: () => ({ old: SLIP_OLD, towOn: towOn(), me: { draft: me.draft, slip: me.slip, slings: me.slings, tow: me.tow, towUsed: me.towUsed, sling: car.slingT }, bots: bots.map((b) => ({ name: b.name, draft: +(b.draft || 0).toFixed(2), slip: +(b.slip || 0).toFixed(2), slings: b.slings || 0, tow: +(b.tow || 0).toFixed(2), towMax: +(b.towMax || 0).toFixed(2) })) }),
    slipFx,
    drs,
    /** 테스트용: DRS 구간·상태 */
    drsInfo: () => ({ ...(drs ? drs.info() : { zones: [] }), me: { drs: +(car.drs || 0).toFixed(2), armed: !!me.drsZ }, bots: bots.map((b) => ({ name: b.name, drs: +(b.car.drs || 0).toFixed(2), armed: !!b.drsZ })) }),
    _draftFor: (x) => draftFor(x || me),
    /** 마스터 봇 도움 정도: { help: [봇마다 0~1] } */
    master: MASTER ? MASTER.info : null,
  };
}
