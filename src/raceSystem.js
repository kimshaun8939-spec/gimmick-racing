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
import { createBotDriver, BOT_LEVELS, BOT_NAMES, pickBotCars, profileFor, rng, flightPlan } from './bots.js';
import { fmtTime, records } from './records.js';
import { fastTrack } from './fastTrack.js';
import { settings } from './settings.js';
import { createSlipFx } from './slipFx.js';

const CAR_R = 1.05; // 차끼리 충돌: 차 하나 = 앞뒤 원 2개 (반지름)
const CAR_OFF = 1.3; // 원 중심이 차 가운데에서 앞뒤로 떨어진 거리
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
  const seed = o.seed != null ? [...String(o.seed)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0 : (Math.random() * 1e9) | 0;
  const rand = rng(seed);
  const markLen = (laps + 2) * M + 2;
  // 슬립스트림·견인 값 (data/car.json draft·tow, 플레이어 차 cfg 기준). 주소 &slip=old = 예전 슬립스트림(비교용), &tow=0 = 견인 끔
  const SLIP_OLD = QS.get('slip') === 'old';
  const legacyDraft = (cfg) => {
    if (SLIP_OLD && cfg && cfg.draft && cfg.draft.legacy) cfg.draft = { ...cfg.draft, ...cfg.draft.legacy };
  };
  legacyDraft(car.cfg);
  const DC = car.cfg.draft || {};
  const TC = car.cfg.tow || {};
  const TOW_URL_OFF = QS.get('tow') === '0';

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
      const cfg = cfgs[i];
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
  // 칸 k: 출발선에서 (9 + 8k) m 뒤, 왼쪽/오른쪽 번갈아 (2열 엇갈림)
  const halfW = (track.width || 16) / 2;
  const gridLat = Math.min(3.4, halfW * 0.42);
  function slot(k) {
    const dist = 9 + 8 * k;
    let t = 1 - dist / L;
    t -= Math.floor(t);
    return { t, lat: (k % 2 === 0 ? -1 : 1) * gridLat };
  }
  let mySlot = null; // 온라인: 호스트가 정해 주는 칸
  let gridTotal = null;
  let humanSlots = 0; // 온라인: 앞쪽 칸 0..humans-1은 사람 자리 → 봇은 그 뒤부터
  /** 그리드에 놓기. 플레이어 칸 { t, lat } 를 돌려줌 */
  function placeGrid() {
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
    for (const e of [me, ...bots]) Object.assign(e, { draft: 0, slip: 0, slipSrc: null, slings: 0, tow: 0, towUsed: 0, towMax: 0, slingFx: false });
    for (const b of bots) b.car.draft = b.car.assistDraft = b.car.tow = b.car.slingT = 0;
    car.draft = car.tow = car.slingT = 0;
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
  /** a, b = Car (또는 b = 움직이지 않는 상대 모습) */
  function collide(a, b, bStatic) {
    if (Math.abs(a.pos.y - b.pos.y) > 2.2) return;
    const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
    if (dx * dx + dz * dz > 36) return;
    let best = 0;
    for (const sa of [CAR_OFF, -CAR_OFF])
      for (const sb of [CAR_OFF, -CAR_OFF]) {
        const ax = a.pos.x + a.fwd.x * sa, az = a.pos.z + a.fwd.z * sa;
        const bx = b.pos.x + b.fwd.x * sb, bz = b.pos.z + b.fwd.z * sb;
        const ex = ax - bx, ez = az - bz;
        const d = Math.hypot(ex, ez);
        const depth = 2 * CAR_R - d;
        if (depth > best && d > 1e-4) {
          best = depth;
          _n.set(ex / d, 0, ez / d);
        }
      }
    if (best <= 0) return;
    // 옆으로 나란히 닿을 때 (hard2): 앞뒤 원끼리 닿으면 밀어내는 방향에 앞뒤 성분이 많이 섞여서
    //   조금 앞선 차는 앞으로 튕겨 빨라지고 뒤 차는 브레이크가 걸렸음 (옆으로 밀고 들어온 쪽이 늘 이김: 1.5초 밀기에 +15 / −15 km/h) → 앞뒤 성분을 덜어냄 (앞뒤로 1.8 m 안이면 전부)
    let sideHit = false;
    if (!bStatic && Math.abs(a.fwd.x * b.fwd.x + a.fwd.z * b.fwd.z) > 0.8) {
      const fl = Math.hypot(a.fwd.x, a.fwd.z) || 1, fx = a.fwd.x / fl, fz = a.fwd.z / fl;
      const along = Math.abs((b.pos.x - a.pos.x) * fx + (b.pos.z - a.pos.z) * fz); // a 기준 b가 앞뒤로 떨어진 거리
      if (along < 2.6) {
        // 나란히 (뒤에서 박는 경우 = 앞뒤 2.6 m 넘게 떨어짐은 그대로)
        sideHit = true;
        const an = _n.x * fx + _n.z * fz;
        const k = Math.min(1, (2.6 - along) / 0.8);
        _n.x -= fx * an * k;
        _n.z -= fz * an * k;
        if (Math.hypot(_n.x, _n.z) < 0.2) {
          // 거의 겹쳐 있음: a의 옆 방향으로 (b가 있는 반대쪽)
          const sd = (a.pos.x - b.pos.x) * -fz + (a.pos.z - b.pos.z) * fx >= 0 ? 1 : -1;
          _n.set(-fz * sd, 0, fx * sd);
        }
        const nl = Math.hypot(_n.x, _n.z) || 1;
        _n.x /= nl;
        _n.z /= nl;
      }
    }
    stats.contacts++;
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

  const stats = { contacts: 0, hard: 0 }; // 테스트용: 차끼리 닿은 수, 세게 부딪힌 수
  const respawnLog = []; // 테스트용: 봇이 복귀한 이유·위치

  // --- 슬립스트림 (드래프트): 앞차 바로 뒤(minGap~range m, 옆 lat m 안)에 있으면 공기 저항이 줄어듦 → car.draft (0~1) ---
  //   car.js가 car.draft만큼 공기 저항을 줄이고 최고 속도를 올림. 여기서는 값만 계산해서 넣음 (플레이어·봇)
  //   2026-11-12 (사용자 요청 "더 세고 잘 보이게"): 4~45 m, 옆 2.3 m (예전 4~30 m, 2 m), car.json draft 값도 셈.
  //   충전(x.slip 0~1): draft 0.4 넘게 chargeTime초 → ready 이상 충전된 채 옆으로 빠지면 슬링샷 (car.slingT)
  const DRAFT_MIN = DC.minGap ?? 4, DRAFT_MAX = DC.range ?? 30, DRAFT_LAT = DC.lat ?? 2, DRAFT_V = DC.minSpeed ?? 15;
  const SLING = DC.sling !== false && !SLIP_OLD;
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
    const k = want > (x.draft || 0) ? 3 : 5; // 들어갈 땐 천천히, 빠질 땐 빨리
    x.draft = (x.draft || 0) + (want - (x.draft || 0)) * Math.min(1, dt * k);
    // 0 근처 자르기는 원할 때(want)도 0일 때만 (예전엔 매 스텝 잘라서 want < 0.4 = 19 m보다 먼 슬립스트림은 아예 안 생겼음. &slip=old는 예전 그대로)
    if (x.draft < 0.01 && (SLIP_OLD || want < 0.01)) x.draft = 0;
    x.view.draft = x.draft;
    if (x.slipCand) x.slipSrc = x.slipCand;
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
  //   봇 따라잡기(어려움 upMul/upDraft, 마스터)를 받는 봇은 견인 없음 (겹쳐서 고무줄이 너무 세지 않게)
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
  function towWant(x, lead, time) {
    const c = x.view;
    if (!lead || x === lead || x.finished || x.remote || !c || time < (TC.startDelay ?? 8)) return 0;
    if (c.flying || !c.grounded || c.surface === 'water' || c.mode === 'fly' || x.offMain) return 0;
    const ti = c.trackInfo;
    if (towCalm && ti && towCalm[Math.min(towCalm.length - 1, Math.max(0, Math.floor(ti.t * towCalm.length)))]) return 0;
    if (c.gravityScale && c.gravityScale() < 0.95) return 0; // 저중력: 빨라지면 날아감
    if (x !== me) {
      const st = x.driver && x.driver.state;
      if (MASTER || (x.cuDraft || 0) > 0.01 || (st && (st.paceMul > 1.001 || st.calm))) return 0;
    }
    const g = gapBetween(lead, x, time);
    const sec = g.laps ? 99 : g.sec || 0;
    const s0 = TC.startSec ?? 2.5, s1 = TC.fullSec ?? 10;
    return Math.max(0, Math.min(1, (sec - s0) / Math.max(0.1, s1 - s0)));
  }
  function updateTow(dt, time, racing) {
    const on = racing && towOn();
    let lead = null;
    if (on) for (const e of all()) if (!e.finished && (!lead || e.progress > lead.progress)) lead = e;
    for (const x of [me, ...bots]) {
      const want = on ? towWant(x, lead, time) : 0;
      const cur = x.tow || 0;
      const r = want > cur ? TC.rampIn ?? 1.5 : TC.rampOut ?? 0.5;
      x.tow = cur + (want - cur) * Math.min(1, dt / Math.max(0.05, r));
      if (x.tow < 0.01 && want < 0.01) x.tow = 0;
      x.view.tow = x.tow;
      if (x.tow > (x.towMax || 0)) x.towMax = x.tow;
      if (x === me && x.tow > 0 && !x.finished) x.towUsed = (x.towUsed || 0) + x.tow * dt; // 기록 '도움 켬' 판정용 (가장 센 견인 기준 초)
    }
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
  let paceT = 0, racingNow = false;
  /** 물리 한 스텝 (main.js의 고정 스텝마다) */
  function step(dt, phase, time, playerProgress) {
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
        const others = [];
        for (const e of all()) {
          if (e === b || (e.finished && !b.finished && !e.isPlayer)) continue; // 완주하고 천천히 도는 봇은 피하지 않음 (부딪힘도 없음)
          const human = e === me || !!e.remote;
          if (b.offMain || e.offMain) {
            // 둘 중 하나가 비행 루트 위: 진행 거리 대신 실제 위치 차이 (60 m 안만), 내 차 앞 방향 기준 앞뒤·옆
            const ep = e.view.pos, dx = ep.x - bc.pos.x, dy = ep.y - bc.pos.y, dz = ep.z - bc.pos.z;
            if (dx * dx + dy * dy + dz * dz > 3600) continue;
            const fl = Math.hypot(bc.fwd.x, bc.fwd.z) || 1, fx = bc.fwd.x / fl, fz = bc.fwd.z / fl;
            if (Math.abs(dy) > 4 && !(b.offMain && e.offMain)) continue; // 한쪽은 하늘, 한쪽은 땅
            others.push({ progM: dx * fx + dz * fz, lat: (b.lateral || 0) + (fx * dz - fz * dx), speed: Math.abs(e.view.speed || 0), human, pos: ep });
            continue;
          }
          others.push({ progM: near(b, e), lat: e.lateral, speed: e.speed, human, pos: e.view.pos });
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
    const bodies = [car, ...bots.filter((b) => !b.finished).map((b) => b.car)];
    for (let i = 0; i < bodies.length; i++) for (let k = i + 1; k < bodies.length; k++) collide(bodies[i], bodies[k], false);
    for (const e of opponents.entries) {
      if (!e.remote || !e.target) continue;
      e.lateral = track.nearest(e.view.pos).lateral; // 봇이 온라인 상대도 피하게
      collide(car, e.view, true);
      for (const b of bots) collide(b.car, e.view, true);
    }
    // 슬립스트림
    racingNow = racing;
    updateDraft(me, dt, racing);
    for (const b of bots) {
      updateDraft(b, dt, racing);
      b.driver.state.realDraft = b.draft; // 봇 운전사는 진짜 슬립스트림만 봄 (추월 판단)
      // 따라잡기(어려움·마스터)의 보이지 않는 슬립스트림: car.assistDraft (예전 세기 그대로, car.json draft.assistDragCut·assistTopGain), 점프 근처·저중력에서는 안 함
      b.car.assistDraft = b.cuDraft > 0 && racing && !b.driver.state.calm ? b.cuDraft : 0;
    }
    // 견인
    updateTow(dt, time, racing);
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
    if (!B) return;
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
    if (lead && b.progress < lead.progress) {
      const g = gapBetween(lead, b, time);
      const sec = g.laps ? 99 : g.sec || 0;
      if (sec > mc.humanSec) hT = Math.max(hT, Math.min(1, (sec - mc.humanSec) / mc.gain));
    }
    if (time < 3) hT = Math.min(hT, mc.startHelp); // 출발 덩어리에서는 덜
    b.mH += (hT - b.mH) * 0.3;
    if (b.mH < 0.01) b.mH = 0;
    masterHelp(b, b.mH, st.calm);
    return { want: 1 + mc.paceMax * b.mH, draft: mc.draftMax * b.mH };
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
  function catchUp(time, racing) {
    const cu = level.catchUp;
    const lead = racing && (cu || MASTER) ? leadHuman() : null;
    for (const b of bots) {
      const st = b.driver.state;
      let want = 1, draft = 0;
      if (MASTER) {
        if (racing && !b.finished) ({ want, draft } = masterKeeper(b, time, lead));
        else if (b.mH) masterHelp(b, (b.mH = 0), false);
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
      st.paceMul += (want - st.paceMul) * 0.3;
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
  let slipFx = null;
  try {
    slipFx = createSlipFx({ getScene: findScene, draftCfg: DC });
    if (bots.length) slipFx.prepare(); // 공기 줄기 메시를 미리 장면에 넣어 둠 (불러오는 화면에서 셰이더를 미리 만듦)
  } catch (err) {
    console.warn('슬립스트림 연출 만들기 실패', err);
  }

  /** 화면 */
  function update(dt, elapsed, camera) {
    opponents.render(dt, elapsed, camera, (e) => [e.name, `P${e.position || ''}`]);
    if (slipFx) {
      const src = me.slipSrc && me.slipSrc.view && me.draft > 0.03 ? me.slipSrc.view : null;
      slipFx.update(dt, camera, { racing: racingNow && !me.finished, draft: me.draft || 0, charge: me.slip || 0, src, myPos: car.pos, tow: me.tow || 0, towOn: towOn(), sling: !!me.slingFx });
      me.slingFx = false;
    }
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
    /** 견인을 의미 있게 받았는지 (가장 센 견인 기준 tow.assistSec초 넘게) → main.js가 기록에 '도움 켬' */
    towAssisted: () => (me.towUsed || 0) >= (TC.assistSec ?? 3),
    /** 테스트용: 슬립스트림·견인 상태 */
    slipInfo: () => ({ old: SLIP_OLD, towOn: towOn(), me: { draft: me.draft, slip: me.slip, slings: me.slings, tow: me.tow, towUsed: me.towUsed, sling: car.slingT }, bots: bots.map((b) => ({ name: b.name, draft: +(b.draft || 0).toFixed(2), slip: +(b.slip || 0).toFixed(2), slings: b.slings || 0, tow: +(b.tow || 0).toFixed(2), towMax: +(b.towMax || 0).toFixed(2) })) }),
    slipFx,
    _draftFor: (x) => draftFor(x || me),
    /** 마스터 봇 도움 정도: { help: [봇마다 0~1] } */
    master: MASTER ? MASTER.info : null,
  };
}
