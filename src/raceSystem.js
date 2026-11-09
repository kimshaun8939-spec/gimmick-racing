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
import { createBotDriver, BOT_LEVELS, BOT_NAMES, pickBotCars, profileFor, rng } from './bots.js';
import { fmtTime } from './records.js';
import { fastTrack } from './fastTrack.js';

const CAR_R = 1.05; // 차끼리 충돌: 차 하나 = 앞뒤 원 2개 (반지름)
const CAR_OFF = 1.3; // 원 중심이 차 가운데에서 앞뒤로 떨어진 거리
const RESTITUTION = 0.25;

export async function createRaceSystem(o) {
  const { track, car, scenery, opponents, laps, carId } = o;
  const L = track.length;
  const M = Math.max(100, Math.min(600, Math.round(L / 20))); // 한 바퀴 기록 지점 수
  const level = BOT_LEVELS[o.botLevel] || BOT_LEVELS.normal;
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
  if (nBots > 0) {
    let roster = { cars: [] };
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
    if (track.onShortcut && track.onShortcut(bc.pos)) return;
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
    const loopy = bc.surface === 'magnet' || bc.up.y < 0.8 || (ti && ti.sample && ti.sample.roll);
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
    stats.contacts++;
    if (a === car || b === car) stats.player = (stats.player || 0) + 1; // 플레이어 차가 낀 접촉
    if (stats.time < 8) stats.start = (stats.start || 0) + 1; // 출발 8초 안 (한 덩어리로 출발할 때)
    if (stats.where) {
      const k = a.trackInfo ? Math.floor(a.trackInfo.t * 100) : -1;
      stats.where[k] = (stats.where[k] || 0) + 1;
      stats.pair = [a, b];
    }
    // 겹친 만큼 밀어냄 (반반, 움직이지 않는 상대면 내 차만)
    const share = bStatic ? 1 : 0.5;
    a.pos.addScaledVector(_n, best * share);
    if (!bStatic) b.pos.addScaledVector(_n, -best * share);
    velOf(a, _va);
    if (bStatic) _vb.copy(b.fwd).multiplyScalar(b.speed || 0);
    else velOf(b, _vb);
    const rel = _va.dot(_n) - _vb.dot(_n);
    if (rel >= 0) return;
    const j = (-(1 + RESTITUTION) * rel) * share;
    _va.addScaledVector(_n, j);
    setVel(a, _va);
    if (!bStatic) {
      _vb.addScaledVector(_n, -j);
      setVel(b, _vb);
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
          others.push({ progM: near(b, e), lat: e.lateral, speed: e.speed });
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
    for (const b of bots) updateDraft(b, dt, racing);
    // 간격 기록
    if (racing) {
      mark(me, time);
      for (const b of bots) mark(b, time);
      for (const e of opponents.entries) if (e.remote) mark(e, time);
    }
    // 고무줄 효과 (아주 약하게): 플레이어보다 많이 앞선 봇은 살짝 느리게, 많이 뒤처진 봇은 살짝 빠르게
    paceT += dt;
    if (paceT > 0.5) {
      paceT = 0;
      for (const b of bots) {
        const d = (b.progress - me.progress) * L;
        const want = me.finished ? 1 : d > 250 ? 0.975 : d < -350 ? 1.03 : 1;
        b.driver.state.paceMul += (want - b.driver.state.paceMul) * 0.2;
      }
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
    level: o.botLevel,
  };
}
