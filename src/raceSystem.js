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
import { createBotDriver, BOT_LEVELS, BOT_NAMES, pickBotCars, profileFor, rng, masterTarget, flightPlan } from './bots.js';
import { fmtTime, records } from './records.js';
import { fastTrack } from './fastTrack.js';

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
      if (MASTER) masterHelp(b, (b.mH = b.mI = 0), false);
      Object.assign(b, { lastT: s.t, progress: s.t > 0.5 ? s.t - 1 : s.t, lapsDone: 0, lapStart: 0, lap: 1, finished: false, finishTime: null, bestLap: null, lapTimes: [], slowT: 0, offT: 0, wrongT: 0, chkT: 0, chkProg: s.t - 1, grace: 0, respawns: 0 });
      b.marks.fill(NaN);
      b.nextMark = 0;
    }
    Object.assign(me, { finished: false, finishTime: null, bestLap: null, lapTimes: [], progress: p.t - 1, draft: 0 });
    for (const b of bots) b.draft = b.car.draft = 0;
    car.draft = 0;
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

  // --- 슬립스트림 (드래프트): 앞차 바로 뒤(4~30 m, 옆 2 m 안)에 있으면 공기 저항이 줄어듦 → car.draft (0~1) ---
  //   car.js가 car.draft만큼 공기 저항을 줄임 (cars 담당). 여기서는 값만 계산해서 넣음 (플레이어·봇)
  const DRAFT_MIN = 4, DRAFT_MAX = 30, DRAFT_LAT = 2;
  function draftFor(x) {
    const c = x.view;
    if (!c || (c.mode === 'fly' && c.flying) || Math.abs(c.speed || 0) < 15) return 0;
    let best = 0;
    for (const y of all()) {
      if (y === x) continue;
      const d = near(x, y);
      if (d < DRAFT_MIN - 1 || d > DRAFT_MAX) continue;
      const dl = Math.abs((y.lateral || 0) - (x.lateral || 0));
      if (dl > DRAFT_LAT + 0.6) continue;
      if (Math.abs(y.view.pos.y - c.pos.y) > 3) continue; // 위아래로 다른 길
      const kd = d < DRAFT_MIN ? (d - (DRAFT_MIN - 1)) : 1 - Math.pow((d - DRAFT_MIN) / (DRAFT_MAX - DRAFT_MIN), 1.3);
      const kl = dl <= DRAFT_LAT ? 1 : 1 - (dl - DRAFT_LAT) / 0.6;
      const ks = Math.min(1, (Math.abs(c.speed) - 15) / 15);
      best = Math.max(best, Math.max(0, kd) * kl * ks);
    }
    return best;
  }
  function updateDraft(x, dt, racing) {
    const want = racing ? draftFor(x) : 0;
    const k = want > (x.draft || 0) ? 3 : 5; // 들어갈 땐 천천히, 빠질 땐 빨리
    x.draft = (x.draft || 0) + (want - (x.draft || 0)) * Math.min(1, dt * k);
    if (x.draft < 0.01) x.draft = 0;
    x.view.draft = x.draft;
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
  let paceT = 0;
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
    updateDraft(me, dt, racing);
    for (const b of bots) {
      updateDraft(b, dt, racing);
      b.driver.state.realDraft = b.draft; // 봇 운전사는 진짜 슬립스트림만 봄 (추월 판단)
      if (b.cuDraft > 0 && racing && !b.driver.state.calm) b.car.draft = Math.max(b.draft, b.cuDraft); // 따라잡기(어려움), 점프 근처·저중력에서는 안 함
    }
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

  // --- 고수(master) 페이스 지킴이 (bots.js BOT_LEVELS.master 설명 참고) ---
  //   목표 = 내 최고 완주 기록 (주소 &botTarget=초 > 내 기록(records, 같은 등급) > 없음). 온라인(?room=)은 사람마다 기록이 달라서
  //   주소의 botTarget만 씀 (모두 같은 봇이 되게), 없으면 '기록 없음' 방식
  //   시간표: 내 완주 고스트(gimmick.ghost.<맵>.<차>.run)가 있으면 그 진행-시간표를, 없으면 레이싱 라인 속도 계획을 목표 시간에 맞게 늘이거나 줄임
  function setupMaster() {
    const mc = level.master;
    const mapId = QS.get('map') || 'gp';
    const onlineRace = QS.has('room');
    let target = null;
    const qT = parseFloat(QS.get('botTarget'));
    if (qT > 20) target = { sec: qT, car: null, laps, adjusted: false, how: 'url' };
    else if (!onlineRace) {
      target = masterTarget(records.all(), mapId, carId, roster.cars, laps);
      if (target) target.how = 'record';
    }
    // 진행(0~laps) → 시간 비율 (0~1)
    let frac = null, how = 'line';
    if (target && target.car && !onlineRace) {
      try {
        const j = JSON.parse(localStorage.getItem(`gimmick.ghost.${mapId}.${target.car}.run`) || 'null');
        if (j && j.v === 2 && j.laps === laps && j.len === Math.round(L) && Array.isArray(j.marks) && j.total > 0) {
          const mk = j.marks.map((ms) => (ms < 0 ? NaN : ms / 1000));
          for (let k = 1; k < mk.length; k++) if (!(mk[k] >= mk[k - 1])) mk[k] = mk[k - 1]; // 빈 칸·거꾸로는 앞 값으로
          if (isFinite(mk[0]) && mk.length > 10) {
            const tot = j.total, R = mk.length - 1;
            frac = (p) => {
              const x = Math.max(0, Math.min(R, (p / laps) * R)), k = Math.floor(x), u = x - k;
              return (k >= R ? tot : mk[k] + (mk[k + 1] - mk[k]) * u) / tot;
            };
            how = 'ghost';
          }
        }
      } catch {}
    }
    if (!frac) {
      // 레이싱 라인 속도 계획: 한 바퀴의 지점별 누적 시간 (첫 바퀴는 출발 손해 START초를 앞 200 m에 나눠 더함)
      const prof = bots[0].car._lineProfile, N = line.N, ds = L / N;
      const cum = new Float64Array(N + 1);
      // 그랑프리 비행 루트: 활주로 시작~착지점 사이 땅 길 대신 비행 시간 (활주로 ÷ 38 m/s + 하늘 길 ÷ 46 m/s, 실측 어려움 봇과 비슷)
      const fp = flightPlan(track);
      let flyDense = 0;
      if (fp) for (let k = 1; k < fp.dense.length; k++) flyDense += fp.dense[k].distanceTo(fp.dense[k - 1]);
      const inFly = (i) => fp && (fp.landI > fp.rwI ? i > fp.rwI && i <= fp.landI : i > fp.rwI || i <= fp.landI);
      for (let i = 0; i < N; i++) cum[i + 1] = cum[i] + (inFly(i) ? (i === fp.landI ? fp.len / 38 + flyDense / 46 : 0) : ds / Math.max(5, prof.speed[i]));
      const lapT = cum[N], START = 2;
      const T = START + lapT * laps;
      frac = (p) => {
        const q = Math.max(0, Math.min(laps, p)), lp = Math.floor(q), x = (q - lp) * N, k = Math.min(N - 1, Math.floor(x));
        const t = lp * lapT + cum[k] + (cum[k + 1] - cum[k]) * (x - k) + START * Math.min(1, (q * L) / 200);
        return t / T;
      };
    }
    // 봇마다 목표: 내 기록 × (1 − spread) (spread 사이를 고르게 나눔, 씨앗으로 순서를 섞음)
    const order = bots.map((_, i) => i).sort(() => rand() - 0.5);
    const n = bots.length;
    bots.forEach((b, i) => {
      const r = n > 1 ? order.indexOf(i) / (n - 1) : 0.5;
      b.mCut = mc.spread[0] + (mc.spread[1] - mc.spread[0]) * r;
      b.mTarget = target ? target.sec * (1 - b.mCut) : null;
      b.mH = b.mI = 0;
      const cfg = b.car.cfg;
      b.mBase = { lat: cfg.tire.lateral, steerLat: cfg.steerLat, steerRate: cfg.steerRate, trac: cfg.tire.traction, brake: cfg.tire.brakeGrip, power: cfg.engine.power };
    });
    return { target, how, frac, info: { target: target && target.sec, car: target && target.car, how: target ? target.how : 'none', adjusted: !!(target && target.adjusted), schedule: how, bots: bots.map((b) => b.mTarget && +b.mTarget.toFixed(2)) } };
  }
  /** 고수 도움 h(0~1)를 차 성능에 반영 (봇 차의 cfg는 봇마다 따로라 다른 차에 영향 없음) */
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
  /** 0.5초마다: 시간표와 비교해서 도움 정하기 → { want(paceMul), draft } */
  function masterKeeper(b, time, lead) {
    const mc = level.master, st = b.driver.state;
    let hT = 0, ease = false;
    if (b.mTarget) {
      const behind = time - b.mTarget * MASTER.frac(Math.max(0, b.progress)); // + = 시간표보다 늦음
      b.mBehind = behind;
      // 비례 + 적분: 늦은 만큼 바로 돕고(gain초 늦으면 최대), 계속 늦으면 도움을 조금씩 더 쌓음 (비례만으로는 늘 1~3초 늦게 끝났음)
      b.mI = Math.max(0, Math.min(1, (b.mI || 0) + mc.integ * behind));
      hT = Math.max(0, Math.min(1, b.mI + behind / mc.gain));
      ease = behind < -mc.ease;
    } else hT = mc.noTargetHelp;
    if (lead && b.progress < lead.progress) {
      const g = gapBetween(lead, b, time);
      const sec = g.laps ? 99 : g.sec || 0;
      if (sec > mc.humanSec) {
        hT = Math.max(hT, Math.min(1, (sec - mc.humanSec) / mc.gain));
        ease = false;
      }
    }
    if (time < 3) hT = Math.min(hT, mc.noTargetHelp); // 출발 덩어리에서는 덜
    b.mH += (hT - b.mH) * 0.3;
    if (b.mH < 0.01) b.mH = 0;
    masterHelp(b, b.mH, st.calm);
    return { want: ease ? mc.easeMul : 1 + mc.paceMax * b.mH, draft: mc.draftMax * b.mH };
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

  /** 화면 */
  function update(dt, elapsed, camera) {
    opponents.render(dt, elapsed, camera, (e) => [e.name, `P${e.position || ''}`]);
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
    /** 고수 봇 목표 (화면에 "목표: 내 최고 … → 약 …"을 띄울 때): { target, car, how: record|url|none, schedule: ghost|line, bots: [목표 초] } */
    master: MASTER ? MASTER.info : null,
  };
}
