// 드라이빙 아카데미 레슨 진행 코드 (2026-11-12): 레슨마다 연습 자리 · 시범 주행 계획 · 따라 하기 판정 · 성적표 줄
//   글자·목록은 academyStore.js, 화면·진행은 academy.js, 시범 주행·코치 화면은 tutorialDemo.js를 같이 씀
//   연습 자리는 레이싱 라인·코너 분석(car.cornerInfo)에서 자동으로 고름 (t 값을 적어 두지 않음 → 코스가 바뀌어도 따라감)
//
//   레슨 하나 = {
//     intro(ctx) → 설명 카드 HTML (그림은 academy.js가 academyArt로 위에 붙임)
//     plan(ctx) → P (tutorialDemo cornerPlan + 레슨별 순간·글자·조작)  · 없으면 null = 이 맵에서 못 함
//     place(ctx, P) → 연습 자리로 차(와 필요하면 앞차)를 옮김
//     task(ctx, P) / goals / cue(P, 순간) → 따라 하기 중 왼쪽 판 글자 · 깜빡일 키
//     judge(ctx, P) → { step(dt, seen) → 'end' | null, prog() → [bool], result() → { rows, respawn } }
//     demo: 시범 주행이 되나 }
import { cornerPlan, createDrill, lineDriver } from './tutorialDemo.js';
import { createBotDriver, BOT_LEVELS } from './bots.js';
import { needOf } from './brakeNeed.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const kmh = (v) => Math.round(Math.abs(v) * 3.6);
const t1 = (x) => Math.abs(x).toFixed(1);

// ------------------------------------------------------------------ 연습 자리 고르기
export function pickSpots(ctx) {
  const { car, track, line, N, W, M, fwd } = ctx;
  if (!line) return {};
  // 코너 분석의 브레이크 시작점은 앞 코너와 붙어 있으면 너무 늦게 잡힐 때가 있음 (그랑프리 T1: 234 → 142 km/h인데 drop 2)
  //   → 속도 계획에서 에이펙스 앞 가장 빠른 곳(감속이 시작되는 곳)을 다시 찾아 brakeI·vBrake·drop을 고친 사본을 씀
  const prof = car._lineProfile || (car.lineSpeed(0), car._lineProfile);
  const fixBrake = (c) => {
    // 뒤로 걸어가며 가장 빠른 곳을 기억, 그보다 3 m/s 넘게 느려지면(앞 코너) 멈춤 (작은 울퉁불퉁은 넘어감)
    let i = W(c.minI != null ? c.minI : c.apexI), best = i, n = 0;
    while (n < M(600)) {
      const j = W(i - 1);
      if (prof.speed[j] > prof.speed[best]) best = j;
      else if (prof.speed[j] < prof.speed[best] - 3) break;
      i = j;
      n++;
    }
    const vB = prof.speed[best];
    return vB - c.vMin > c.drop + 1 ? { ...c, brakeI: best, vBrake: vB, drop: vB - c.vMin, brakeLen: W(c.apexI - best) * ctx.ds, fixed: true } : c;
  };
  const corners = (car.cornerInfo || { corners: [] }).corners.map(fixBrake);
  ctx.corners = corners;
  const inSpace = (i) => !!(track.dimension && track.dimension.inSpaceT && track.dimension.inSpaceT(i / N));
  const nearRunway = (i) => {
    if (!track.runway) return false;
    const p = track.sampleAt(i / N).pos, r = track.runway.start.pos;
    return Math.hypot(p.x - r.x, p.z - r.z) < 150;
  };
  const water = (i) => !!(track.isWaterT && track.isWaterT(i / N));
  const ground = (c) => !inSpace(c.apexI) && !inSpace(c.brakeI) && !nearRunway(c.apexI) && !water(c.apexI) && !water(c.brakeI);
  const clearAt = (i) => {
    const p = track.sampleAt(W(i) / N).pos;
    for (let j = 0; j < N; j += 3) {
      if (Math.abs(W(j - i)) < M(150) || Math.abs(W(i - j)) < M(150)) continue;
      const q = track.sampleAt(j / N).pos;
      if (Math.hypot(q.x - p.x, q.z - p.z) < 30) return false;
    }
    return true;
  };
  const before = (c) => runUp(ctx, c);
  // 탈출 뒤 160 m 안에 우주 포털이 있으면 안 됨 (그랑프리 T5 뒤 포털 기둥에 박힘)
  const ok = (c) => ground(c) && !inSpace(W(c.exitI + M(160))) && !inSpace(W(c.brakeI - M(before(c)))) && !nearRunway(W(c.brakeI - M(before(c)))) && [c.brakeI - M(before(c)), c.brakeI, c.apexI, c.exitI].every(clearAt);
  const good = corners.filter(ok);
  const used = new Set();
  const take = (c) => (c && used.add(c), c || null);
  const lone = (c) => !c.linkedPrev || c.gapPrev > 150; // 앞 코너와 떨어진 코너 (처음 배우기 좋음)
  const hwAt = (i) => (track.halfWidthAt ? track.halfWidthAt(i) : track.width / 2);
  const onKerb = (c) => line.offset[c.apexI] * c.side >= hwAt(c.apexI) - 0.3; // 레이싱 라인이 에이펙스에서 안쪽 끝(연석)까지 감
  // 이 차로 브레이크가 정말 필요한가 (brakeNeed.js, 사용자 요청 2026-11-13 "잘 꺾이는 차인데 브레이크 안 밟는 게 빠른 곳에서 브레이크를 시킴")
  //   kindOf: 'brake' | 'lift' | 'flat', gainOf: 브레이크로 아끼는 시간(초)
  const needC = (c) => {
    try {
      return needOf(car, track, c);
    } catch {
      return null;
    }
  };
  const kindOf = (c) => (needC(c) || { kind: 'brake' }).kind;
  const gainOf = (c) => (needC(c) || { gain: 1 }).gain;
  const sureBrake = (c) => kindOf(c) === 'brake' && gainOf(c) >= 0.25; // 브레이크 연습 = 확실히 브레이크가 이득인 코너만
  const bigAll = good.filter((c) => c.drop > 8).sort((a, b) => (lone(b) ? 1 : 0) - (lone(a) ? 1 : 0) || b.drop - a.drop);
  const bigBrakes = bigAll.filter(sureBrake).length ? bigAll.filter(sureBrake) : bigAll;
  const S = {};
  S.brake = take(bigBrakes[0] || good.slice().sort((a, b) => gainOf(b) - gainOf(a))[0]);
  S.trail = take(bigBrakes.find((c) => !used.has(c) && lone(c)) || bigBrakes.find((c) => !used.has(c)) || S.brake);
  // 리프트오프: 브레이크가 거의 필요 없는(속도를 조금만 줄이는) 빠른 코너, 앞 코너와 떨어진 곳 우선
  //   (200 km/h 아래만 골라 보니 T23 138 km/h = W만 떼서는 못 줄이는 코너가 걸려 더 나빴음 → 줄이는 양 4 m/s에 가까운 것 그대로)
  S.lift = take(
    good
      .filter((c) => !used.has(c) && c.drop > 1.2 && c.drop <= 9 && c.vMin > 28 && c.apexes.length <= 2)
      // + 이 차로 'W 떼기'면 충분한 코너 먼저 (브레이크가 확실히 이득인 코너는 뒤로)
      .sort((a, b) => (kindOf(a) === 'lift' ? 0 : kindOf(a) === 'flat' ? 1 : 2) - (kindOf(b) === 'lift' ? 0 : kindOf(b) === 'flat' ? 1 : 2) || (a.linkedPrev && a.gapPrev < 150 ? 1 : 0) - (b.linkedPrev && b.gapPrev < 150 ? 1 : 0) || Math.abs(a.drop - 4) - Math.abs(b.drop - 4))[0] || null,
  );
  // 늦게 꺾고 빨리 가속: 탈출 뒤 긴 직선이 오는 코너 (직선이 길수록, 느린 코너일수록)
  const nextRun = (c) => {
    const n = corners[(c.k + 1) % corners.length];
    return fwd(c.exitI, n.drop > 1.5 ? n.brakeI : n.startI);
  };
  S.late = take(
    good
      .filter((c) => !used.has(c) && c.drop > 3 && !inSpace(W(c.exitI + M(240))))
      .map((c) => ({ c, s: nextRun(c) * (c.vMin < 42 ? 1.25 : 1) * (lone(c) ? 1 : 0.55) * (onKerb(c) ? 1 : 0.7) * (c.apexes.length === 1 ? 1 : 0.8) * (kindOf(c) === 'brake' ? 1 : 0.4) }))
      .sort((a, b) => b.s - a.s)[0]?.c || null,
  );
  if (S.late) S.late.runAfter = nextRun(S.late);
  // 연속 코너: 앞 코너와 이어진 코너 쌍 (둘 다 땅 위, 브레이크가 조금이라도 있는 곳 우선)
  {
    const pairs = [];
    for (const c of corners) {
      const p = corners[(c.k - 1 + corners.length) % corners.length];
      if (!c.linkedPrev || p === c || !ground(c) || !ground(p)) continue;
      if (![p.apexI, c.apexI, c.exitI, p.brakeI].every(clearAt)) continue;
      if (inSpace(W(p.brakeI - M(before(p)))) || nearRunway(W(p.brakeI - M(before(p))))) continue;
      pairs.push([p, c]);
    }
    const score = ([p, c]) => (p.drop > 1.5 ? 2 : 0) + (c.drop > 1.5 ? 2 : 0) + (p.side !== c.side ? 2 : 0) + (c.vMin < 47 ? 1 : 0) - (used.has(p) || used.has(c) ? 3 : 0) - (c.gapPrev > 150 ? 1 : 0);
    S.chain = pairs.sort((a, b) => score(b) - score(a))[0] || null;
  }
  // 연석: 중간 속도 코너 (그랑프리는 코너 연석이 넓음)
  S.kerb = take(
    good
      .filter((c) => !used.has(c) && !(S.chain && S.chain.includes(c)) && c.vMin > 22 && c.vMin < 52 && onKerb(c))
      .sort((a, b) => (a.apexes.length === 1 ? 0 : 1) - (b.apexes.length === 1 ? 0 : 1) || (lone(a) ? 0 : 1) - (lone(b) ? 0 : 1) || Math.abs(a.vMin - 40) - Math.abs(b.vMin - 40))[0] ||
      good.find((c) => !used.has(c)) || null,
  );
  // 드리프트: 땅 위에서 가장 느린 코너 (헤어핀)
  S.drift = corners.filter((c) => ground(c) && [c.apexI, c.exitI].every(clearAt)).sort((a, b) => a.vMin - b.vMin)[0] || null;
  // 슬립스트림: 땅 위에서 가장 긴 직선 (그다음 긴 직선은 DRS 없는 맵에서 대신)
  S.straight = (() => {
    if (!line.curvature) return null;
    let best = null, run = 0, start = 0;
    for (let j = 0; j < N * 2; j++) {
      const i = j % N;
      const flat = Math.abs(line.curvature[i]) < 1 / 700 && !inSpace(i) && !nearRunway(i) && !water(i);
      if (flat) {
        if (!run) start = i;
        run++;
        if (!best || run > best.len) best = { i0: start, len: run };
      } else run = 0;
      if (run > N / 3) break;
    }
    return best && best.len * ctx.ds > 250 ? { i0: best.i0, i1: W(best.i0 + best.len), m: best.len * ctx.ds } : null;
  })();
  // 물 구간 (바닷가): 가장 긴 것
  S.water = (track.waterRanges || []).slice().sort((a, b) => b.length - a.length)[0] || null;
  return S;
}

/** 연습 시작점: 브레이크 지점 몇 m 앞 (앞 코너 탈출이 가까우면 그 탈출 바로 뒤부터) */
function runUp(ctx, c) {
  const corners = ctx.corners || ctx.car.cornerInfo.corners;
  const p = corners[(c.k - 1 + corners.length) % corners.length];
  const gap = p === c ? 330 : ctx.fwd(p.exitI, c.brakeI);
  // 시작 자리: 110~330 m 앞 중 '곧은 곳' (차는 도로 방향으로 놓이므로 도로도 곧고, 라인도 곧고, 라인이 도로를 비스듬히 가로지르지 않는 곳)
  //   예전엔 앞 코너가 멀면 그냥 탈출 뒤에서 시작 → S자 한가운데에 놓여 시작하자마자 핸들을 끝까지 꺾고도 라인을 놓치는 일이 있었음
  const curv = ctx.line.curvature, off = ctx.line.offset, W = ctx.W, M = ctx.M, S = ctx.track.samples, N = ctx.N;
  const roadK = (i) => {
    if (!S || S.length < N) return 0;
    const a = S[W(i - 2)].pos, b = S[W(i)].pos, d = S[W(i + 2)].pos;
    const h1 = Math.atan2(b.z - a.z, b.x - a.x), h2 = Math.atan2(d.z - b.z, d.x - b.x);
    const dh = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
    return Math.abs(dh) / Math.max(0.5, Math.hypot(d.x - a.x, d.z - a.z) / 2);
  };
  const lo = 110, hi = Math.max(110, Math.min(330, gap - 10 >= 110 ? gap - 10 : 330));
  let best = clamp(gap - 10, 110, 330), bestCost = Infinity;
  for (let d = lo; d <= hi; d += 10) {
    let k = 0, sl = 0;
    for (let e = -20; e <= 20; e += 5) {
      const i = W(c.brakeI - M(d) + M(e));
      k = Math.max(k, Math.abs(curv[i]), roadK(i));
      sl = Math.max(sl, Math.abs(off[W(i + 1)] - off[W(i - 1)]) / (2 * ctx.ds));
    }
    const cost = k * 1000 + sl * 60 + Math.abs(d - 220) / 400;
    if (cost < bestCost) (bestCost = cost), (best = d);
  }
  return best;
}

// ------------------------------------------------------------------ 공통: 코너 판정 기록
/** createDrill(4줄: 바깥·브레이크·에이펙스·탈출) + 레슨별로 더 재는 값 X */
function cornerRec(ctx, P) {
  const { game, car } = ctx;
  const drill = createDrill(game, P);
  const prof = car._lineProfile || (car.lineSpeed(0), car._lineProfile);
  const X = { trailT: 0, hardTurnT: 0, lastBrkD: null, liftT: 0, liftRun: 0, liftMax: 0, brkMax: 0, brkInLift: 0, steerSum: 0, steerN: 0, kerbIn: 0, kerbOut: 0, offT: 0, vEnd: null, vPlan: null, corners: {}, apex2: null, outLat2: null, minV2: Infinity };
  return {
    drill,
    X,
    step(dt, seen) {
      const r = drill.step(dt, seen);
      if (!car.trackInfo) return r;
      const idx = car.trackInfo.index % P.N;
      const m = P.dist(idx), v = Math.abs(car.speed), brk = car.brk, thr = car.thr;
      const lat = car.trackInfo.lateral * P.side; // + = 안쪽
      const st = (car.steerIn || 0) * P.side; // + = 안쪽으로 꺾음
      if (m > P.dB - 40 && m < P.dA + 3 && brk > 0.04 && brk < 0.8 && st > 0.16) X.trailT += dt;
      if (m > P.dB - 40 && m < P.dA && brk >= 0.8 && st > 0.45) X.hardTurnT += dt;
      if (m > P.dB - 200 && m < P.dX && brk > 0.05) X.lastBrkD = m;
      if (m > P.dB - 200 && m < P.dA) X.brkMax = Math.max(X.brkMax, brk);
      if (brk > 0.6 && m > P.dB - 200 && m < P.dB + 0.35 * (P.dA - P.dB)) (X.steerSum += Math.abs(car.steerIn || 0)), X.steerN++; // 브레이크 앞부분(직선)에서만: 라인 자체가 꺾이기 시작하는 뒷부분은 빼고
      if (m > P.dB - 130 && m < P.dA + 5 && thr < 0.35 && brk < 0.2 && v > 12) (X.liftRun += dt), (X.liftT += dt);
      else (X.liftMax = Math.max(X.liftMax, X.liftRun)), (X.liftRun = 0);
      if (m > P.dB - 130 && m < P.dX && brk > 0.25) X.brkInLift += dt;
      if (Math.abs(m - P.dA) < 25 && (car.kerbK || 0) > 0.12 && lat > 0) X.kerbIn += dt;
      if (m > P.dA + 5 && m < P.dX + 45 && (car.kerbK || 0) > 0.12 && lat < 0) X.kerbOut += dt;
      if (m > P.dB - 20 && m < P.end && (car.offK || 0) > 0.6) X.offT += dt;
      if (P.vCheckD != null && X.vEnd == null && m >= P.vCheckD) (X.vEnd = v), (X.vPlan = prof.speed[idx]);
      // 두 번째 코너 (연속 코너 레슨)
      if (P.c2) {
        if (X.outLat2 == null && m >= P.d2Pre) X.outLat2 = car.trackInfo.lateral * P.c2.side;
        if (m > P.d2B && m < P.d2X) X.minV2 = Math.min(X.minV2, v);
      }
      for (const e of seen) {
        if (e === 'corner' && car.lastCornerInfo) X.corners[car.lastCornerInfo.k] = { ...car.lastCornerInfo };
        if (P.c2 && (e === 'apex' || e === 'apexPerfect') && m > P.d2B - 10 && m < P.d2X + 20 && !X.apex2) X.apex2 = e;
      }
      X.liftMax = Math.max(X.liftMax, X.liftRun);
      return r;
    },
    rows() {
      const res = drill.result();
      const by = Object.fromEntries(res.rows.map((r) => [r.id, r]));
      return { res, by };
    },
  };
}
/** 코너 탈출이 왜 좋지 않았는지 */
function exitWhy(ctx, c) {
  const k = ctx.car.cfg.corner || {};
  if (!c) return '코너를 끝까지 못 지났어요';
  if (c.noBrake === false) return '에이펙스 뒤에 브레이크를 밟았어요';
  if (c.thrAvg != null && c.thrAvg < (k.exitThrottle ?? 0.75)) return `에이펙스를 지나면 ${ctx.kbd('throttle')}를 더 일찍, 꾹`;
  if (c.latErr != null && c.latErr > (k.exitTol ?? 2.5)) return '탈출에서 바깥쪽까지 넓게 (라인을 따라)';
  if (c.ratio != null && c.ratio < (k.exitSpeedRatio ?? 0.8)) return '너무 느려요. 브레이크를 조금 덜';
  return '잔디에 닿았어요';
}
const row = (id, ok, title, text) => ({ id, ok, title, text });

/** 계획 속도(0.25초 앞)보다 빠를 때만 브레이크를 꾹 (튜토리얼 시범은 '브레이크' 순간 내내 0.9로 밟아서
 *  감속 구간이 긴 코너(그랑프리 T15 등)에서 너무 일찍 너무 느려졌음) */
const planBrake = (P) => (c, cur, car) => {
  if (!cur || cur.id !== 'brake' || !car.trackInfo) return;
  if (P.brakeKind && P.brakeKind !== 'brake') return; // 브레이크가 필요 없는 코너: 운전사가 'W 떼기' 계획대로 (brakeNeed.js)
  const vt = car.lineSpeed((car.trackInfo.index + Math.round((Math.abs(car.speed) * 0.25) / P.ds)) % P.N);
  if (car.speed > vt + 0.4) (c.throttle = 0), (c.brake = Math.max(c.brake, 0.85));
};
/** 코너 레슨 기본 계획 (cornerPlan + 계획 속도 브레이크) */
function basePlan(ctx, c, before) {
  const P = cornerPlan(ctx.game, c, before);
  P.demoCtl = planBrake(P);
  // 시범 운전: 고속에서 조금 더 멀리 보고 꺾어요 (기본 0.12는 200 km/h 넘는 S자에서 좌우로 흔들려 잔디로 나갔음)
  if (!P.driver) P.driver = () => lineDriver(ctx.game, { look: DEMO_LOOK });
  return P;
}
let DEMO_LOOK = 0.2;
export function _setDemoLook(v) {
  DEMO_LOOK = v;
}

// ------------------------------------------------------------------ 순간 띠 · 글자 만들기
/** 띠의 '브레이크' 칸 이름: 이 차로 브레이크가 필요 없는 코너면 'W 떼기' / '그대로' */
const bName = (P) => (!P.brakeKind || P.brakeKind === 'brake' ? '브레이크' : P.brakeKind === 'lift' ? 'W 떼기' : '그대로');
function stripOf(list) {
  return { ids: list.map((x) => x[0]), names: Object.fromEntries(list), alias: { approach: list[0][0] } };
}

// ------------------------------------------------------------------ 레슨들
const DRV_TXT = {
  rwd: '이 차는 <b>뒷바퀴 굴림</b>이라 W를 확 떼면 꼬리가 조금 더 돌아요. 천천히 떼면 부드러워요.',
  fwd: '이 차는 <b>앞바퀴 굴림</b>이라 코너에서 W를 세게 밟으면 앞이 바깥으로 밀려요. 탈출에선 핸들을 풀면서 밟아요.',
  awd: '이 차는 <b>네 바퀴 굴림</b>이라 떼거나 밟아도 차분한 편이에요.',
};
const drvTxt = (ctx) => DRV_TXT[ctx.car.cfg.drivetrain || 'rwd'] || DRV_TXT.rwd;

export const RUN = {};

// 1) 브레이크 포인트 ---------------------------------------------------------
RUN.brake = {
  demo: true,
  spot: (ctx) => ctx.spots.brake,
  intro: (ctx, c) => `
    <p>코너 전 <b>직선 끝</b>에서 <b>한 번에 세게</b> 밟고, 코너에 들어가기 전에 속도를 다 줄여요. 늦으면 밖으로 밀리고, 일찍이면 시간을 버려요.</p>
    ${steps([['①', `직선에서는 ${ctx.kbd('throttle')} 끝까지`], ['②', `라인이 <b style="color:#ff6b5e">빨개지면</b> ${ctx.kbd('brake')} 꾹`], ['③', '핸들은 <b>곧게</b> (꺾으며 꾹 = 밀림)'], ['④', '코너 속도만큼만 줄이기']])}
    ${why(`브레이크를 밟으면 무게가 <b>앞바퀴</b>로 쏠려서 앞이 땅을 꽉 눌러요 → 잘 서고, 핸들도 잘 들어요. 그래서 <b>곧게 세게</b> 줄이고 꺾기 시작할 때 살살 풀어요.`)}
    <p class="tut-tip">💡 '적당히 밟는' 습관이 있다면: 이번엔 <b>더 늦게, 더 세게, 더 짧게</b> 밟아 봐요. 짧고 센 브레이크가 더 빨라요. 도로 옆 <b>150 · 100 · 50</b> 표지판도 도와줘요.</p>`,
  plan: (ctx, c) => {
    const P = basePlan(ctx, c, runUp(ctx, c));
    P.badge = `🎬 시범 · ${ctx.cname(c)} 브레이크 포인트`;
    return P;
  },
  task: (ctx, P) => `${ctx.cname(P.c)}: 라인이 빨개지면 ${ctx.K('brake')} <b>곧게 세게</b> → 코너 속도까지만`,
  goals: ['브레이크 시점', '한 번에 세게', '코너 속도', '탈출 가속'],
  judge(ctx, P) {
    const R = cornerRec(ctx, P);
    return {
      step: R.step,
      prog: () => [R.drill.R.brakeD != null, R.X.brkMax > 0.8, R.drill.R.minV < Infinity && Math.abs(R.drill.R.minV / P.vMin - 1) < 0.1, !!R.X.corners[P.c.k]],
      result() {
        const { res, by } = R.rows();
        const X = R.X, D = R.drill.R;
        const rows = [by.brake];
        // (핸들 곧게는 판정 안 함: 코너에 따라 레이싱 라인이 브레이크 중에 이미 꺾이기 시작해서 자동 운전도 꺾으며 밟음)
        if (D.brakeD == null) rows.push(row('hard', 'bad', '한 번에 세게', '브레이크를 안 밟았어요'));
        else if (X.brkMax < 0.55) rows.push(row('hard', 'bad', '한 번에 세게', `너무 살살 밟았어요 (${Math.round(X.brkMax * 100)}%). 짧게 꾹!`));
        else if (X.brkMax < 0.8) rows.push(row('hard', 'meh', '한 번에 세게', `조금 약해요 (${Math.round(X.brkMax * 100)}%). 처음엔 끝까지 꾹`));
        else rows.push(row('hard', 'ok', '한 번에 세게', `좋아요! ${Math.round(X.brkMax * 100)}%로 꾹 밟았어요`));
        const ratio = D.minV < Infinity ? D.minV / P.vMin : 0;
        if (!ratio) rows.push(row('speed', 'bad', '코너 속도', '코너까지 못 갔어요'));
        else if (D.offT > 0.4 || res.respawn) rows.push(row('speed', 'bad', '코너 속도', `너무 빨라서 밖으로 나갔어요 (${kmh(D.minV)} km/h). 조금 더 일찍`));
        else if (ratio < 0.78) rows.push(row('speed', 'bad', '코너 속도', `너무 많이 줄였어요: ${kmh(D.minV)} km/h (목표 약 ${kmh(P.vMin)}). 덜 밟아도 돼요`));
        else if (ratio < 0.9) rows.push(row('speed', 'meh', '코너 속도', `조금 많이 줄였어요: ${kmh(D.minV)} km/h (목표 약 ${kmh(P.vMin)})`));
        else rows.push(row('speed', 'ok', '코너 속도', `딱 맞아요: ${kmh(D.minV)} km/h (목표 약 ${kmh(P.vMin)})`));
        rows.push(by.gas);
        return { rows, respawn: res.respawn };
      },
    };
  },
};

// 2) 트레일 브레이킹 -------------------------------------------------------
RUN.trail = {
  demo: true,
  spot: (ctx) => ctx.spots.trail,
  intro: (ctx, c) => `
    <p>브레이크를 <b>직선에서 거의 다</b> 끝내고, 꺾기 시작할 때 <b>조금만 남겨</b> 두었다가 에이펙스 쪽으로 가며 <b>스르르</b> 풀어요. 이게 트레일 브레이킹이에요.</p>
    ${steps([['①', `직선에서 ${ctx.kbd('brake')} 세게`], ['②', `꺾으면서 ${ctx.kbd('brake')} <b>살짝 남기기</b>`], ['③', '에이펙스 전에 다 떼기'], ['④', `에이펙스 뒤 ${ctx.kbd('throttle')} 꾹`]])}
    ${why(`가속하는 동안엔 앞바퀴 무게가 가벼워져서 <b>핸들이 덜 들어요</b>. 반대로 브레이크를 살짝 남기면 앞이 눌려서 <b>더 잘 돌아요</b>. 대신 꺾으면서 <b>세게</b> 밟으면 앞바퀴가 미끄러져 밖으로 밀려요.`)}
    <p class="tut-tip">💡 코너 입구에서 차가 바깥으로 밀린다면 → 브레이크를 한 번에 다 떼지 말고 <b>조금 남긴 채</b> 꺾어 보세요.</p>`,
  plan: (ctx, c) => {
    const P = cornerPlan(ctx.game, c, runUp(ctx, c));
    P.driver = () => lineDriver(ctx.game, { look: 0.15 }); // 넓은 연석 위 에이펙스: 너무 멀리 보면 안쪽 잔디까지 깎음
    const bEnd = P.dB + Math.max(8, 0.22 * (P.dA - P.dB));
    P.badge = `🎬 시범 · ${ctx.cname(c)} 트레일 브레이킹`;
    P.moments = [
      { id: 'straight', a: -1e9, b: P.dB - 0.3 * P.vB, ts: 1 },
      { id: 'brake', a: P.dB - 0.3 * P.vB, b: bEnd, ts: 1, pulse: { ts: 0.3, sec: 1.1 } },
      { id: 'trail', a: bEnd, b: P.dA - 6, ts: 1, pulse: { ts: 0.25, sec: 1.5 } },
      { id: 'apex', a: P.dA - 6, b: P.dA + 8, ts: 1 },
      { id: 'gas', a: P.dA + 8, b: 1e9, ts: 1 },
    ];
    P.momentAt = (m) => P.moments.find((x) => m >= x.a && m < x.b) || P.moments[0];
    P.strip = stripOf([['straight', '직선'], ['brake', '세게'], ['trail', '살짝 남기기'], ['apex', '에이펙스'], ['gas', '가속']]);
    const B = ctx.kbd('brake'), S = ctx.kbd(P.turnKey), T = ctx.kbd('throttle');
    P.texts = (id, coach) =>
      coach
        ? { straight: [`${T} 꾹`, ''], brake: [`${B} 세게!`, '곧게'], trail: [`${S} + ${B} 살짝`, '조금 남기고 꺾기'], apex: ['브레이크 다 떼기', '안쪽에 붙기'], gas: [`${T} 꾹!`, ''] }[id]
        : {
            straight: [`직선에서는 ${T} 꾹`, `코너 <b>바깥(${P.outName})</b>에서 들어갈 준비`],
            brake: [`먼저 직선에서 ${B} 세게!`, '속도는 여기서 거의 다 줄여요'],
            trail: [`꺾으면서 ${B}는 <b>살짝만</b> 남기기`, '앞바퀴가 눌려서 차 머리가 안쪽으로 잘 들어가요'],
            apex: ['에이펙스 전에 브레이크 다 떼기', `${P.inName} 연석을 스쳐요`],
            gas: [`이제 ${T} 꾹!`, '핸들을 풀면서'],
          }[id];
    // 시범: 브레이크 순간엔 세게, 꺾기 순간엔 0.25에서 0으로 줄이며 남김
    P.demoCtl = (c, cur, car) => {
      if (!cur) return;
      const v = car.speed;
      if (cur.id === 'brake') {
        // 계획 속도보다 빠를 때만 세게 (예전엔 꼭짓점 속도까지 다 줄여서 에이펙스가 느렸음)
        const va = car.lineSpeed((car.trackInfo.index + Math.round((v * 0.3) / P.ds)) % P.N);
        if (v > va + 0.4 && v > P.vMin + 2) (c.throttle = 0), (c.brake = Math.max(c.brake, 0.9));
      }
      if (cur.id === 'trail') {
        const k = clamp((P.dA - 6 - P.dist(car.trackInfo.index % P.N)) / Math.max(10, P.dA - 6 - bEnd), 0, 1);
        const vt = car.lineSpeed((car.trackInfo.index + Math.round((v * 0.25) / P.ds)) % P.N);
        // 계획 속도보다 빠를 때만 조금 더, 계획 속도 근처면 아주 살짝 남기기(보이게), 계획보다 느려지면 브레이크를 떼고 액셀을 살짝 (에이펙스가 너무 느렸음)
        c.throttle = v < vt - 1 ? 0.3 : 0;
        c.brake = v > vt + 0.3 ? Math.max(Math.min(c.brake, 0.6), 0.25 * k) : v > vt - 0.3 ? 0.04 + 0.05 * k : 0; // 계획 속도보다 빠를 때만 조금 더, 아니면 아주 살짝 (보이게)
      }
      if (cur.id === 'apex') c.brake = 0;
    };
    return P;
  },
  task: (ctx, P) => `${ctx.cname(P.c)}: 직선에서 ${ctx.K('brake')} 세게 → 꺾으면서 <b>살짝 남기기</b> → 에이펙스 전에 떼기`,
  goals: ['브레이크 시점', '꺾으며 살짝 남기기', '에이펙스 전에 떼기', '에이펙스'],
  cue: (P, id) => ({ straight: 'throttle', brake: 'brake', trail: P.turnKey, apex: null, gas: 'throttle' })[id],
  judge(ctx, P) {
    const R = cornerRec(ctx, P);
    return {
      step: R.step,
      prog: () => [R.drill.R.brakeD != null, R.X.trailT > 0.3, R.X.lastBrkD != null && R.drill.R.passApexT != null && R.X.lastBrkD <= P.dA + 2, !!R.drill.R.apex],
      result() {
        const { res, by } = R.rows();
        const X = R.X;
        const rows = [by.brake];
        if (X.trailT >= 0.3 && X.hardTurnT < 0.35) rows.push(row('trail', 'ok', '꺾으며 살짝 남기기', `좋아요! ${t1(X.trailT)}초 동안 브레이크를 남기며 꺾었어요`));
        else if (X.hardTurnT >= 0.35) rows.push(row('trail', 'meh', '꺾으며 살짝 남기기', '꺾으면서 너무 세게 밟았어요 → 앞이 밀려요. 꺾을 땐 살짝만'));
        else if (X.trailT >= 0.1) rows.push(row('trail', 'meh', '꺾으며 살짝 남기기', `남긴 시간이 짧아요 (${t1(X.trailT)}초). 핸들을 돌리기 시작할 때까지 살짝 더`));
        else rows.push(row('trail', 'bad', '꺾으며 살짝 남기기', `꺾기 전에 브레이크를 다 뗐어요. 꺾기 시작할 때 ${ctx.kbd('brake')}를 조금 남겨요`));
        const passed = R.drill.R.passApexT != null;
        if (!passed) rows.push(row('release', 'bad', '에이펙스 전에 떼기', '에이펙스까지 못 갔어요'));
        else if (X.lastBrkD != null && X.lastBrkD > P.dA + 2) rows.push(row('release', 'bad', '에이펙스 전에 떼기', '에이펙스를 지나서도 밟았어요. 안쪽 연석에 닿기 전엔 다 떼요'));
        else rows.push(row('release', 'ok', '에이펙스 전에 떼기', '에이펙스 전에 깔끔하게 뗐어요'));
        rows.push(by.apex);
        return { rows, respawn: res.respawn };
      },
    };
  },
};

// 3) 리프트오프 -------------------------------------------------------------
RUN.lift = {
  demo: true,
  spot: (ctx) => ctx.spots.lift,
  intro: (ctx, c) => `
    <p>브레이크까지는 필요 없는 <b>빠른 코너</b>에서는 ${ctx.kbd('throttle')}를 <b>잠깐 떼기만</b> 해도 차 머리가 안쪽으로 조여져요. 라인 밖으로 나갈 것 같을 때 W를 톡 떼는 그 느낌이 바로 이 기술이에요!</p>
    ${steps([['①', `코너 앞에서 ${ctx.kbd('throttle')} 톡 떼기`], ['②', `${ctx.kbd(c.side > 0 ? 'right' : 'left')} 꺾기 (브레이크 없이)`], ['③', '머리가 안쪽으로 들어오면'], ['④', `다시 ${ctx.kbd('throttle')} 꾹`]])}
    ${why(`W를 떼면 무게가 <b>앞으로</b> 쏠려 앞바퀴가 눌리고 <b>더 잘 돌아요</b>. 밟고 있으면 앞이 들려서 덜 돌아요. 오래 꾹 밟다가 코너 한가운데서 <b>확</b> 떼면 뒤가 가벼워져 <b>꼬리가 살짝</b> 돌아요(리프트오프). ${drvTxt(ctx)}`)}
    <p class="tut-tip">💡 W를 <b>자주</b> 떼야 한다면 = 코너에 너무 빨리 들어간 거예요. 그땐 조금 일찍 살짝 브레이크가 더 빨라요.</p>`,
  plan: (ctx, c) => {
    const P = cornerPlan(ctx.game, c, runUp(ctx, c));
    P.driver = () => lineDriver(ctx.game, { look: 0.14 }); // 아주 빠른 스위퍼: 멀리 보면 안쪽을 깎아 잔디로 (0.2 → 동, 0.12~0.14 → 은)
    P.badge = `🎬 시범 · ${ctx.cname(c)} 리프트오프`;
    const liftA = P.dB - 0.35 * P.vB;
    const liftB = Math.max(liftA + 10, Math.min(P.dA - 12, liftA + 0.9 * P.vB)); // 떼는 시간은 약 0.9초 (짧게 톡)
    P.moments = [
      { id: 'straight', a: -1e9, b: liftA, ts: 1 },
      { id: 'lift', a: liftA, b: liftB, ts: 1, pulse: { ts: 0.3, sec: 1.2 } },
      { id: 'apex', a: liftB, b: P.dA + 6, ts: 1 },
      { id: 'gas', a: P.dA + 6, b: 1e9, ts: 1, pulse: { ts: 0.4, sec: 0.9 } },
    ];
    P.momentAt = (m) => P.moments.find((x) => m >= x.a && m < x.b) || P.moments[0];
    P.strip = stripOf([['straight', '직선'], ['lift', 'W 떼기'], ['apex', '에이펙스'], ['gas', '다시 꾹']]);
    const T = ctx.kbd('throttle'), S = ctx.kbd(P.turnKey);
    P.texts = (id, coach) =>
      coach
        ? { straight: [`${T} 꾹`, ''], lift: [`${T} 톡 떼기 + ${S}`, '브레이크 없이'], apex: ['안쪽에 붙기', ''], gas: [`다시 ${T} 꾹!`, ''] }[id]
        : {
            straight: [`${T} 꾹 · 바깥(${P.outName})으로`, '브레이크가 필요 없는 빠른 코너예요'],
            lift: [`${T}만 톡 떼고 ${S} 꺾기`, '앞이 눌려서 차 머리가 안쪽으로 조여져요'],
            apex: ['머리가 들어오면 안쪽에 붙기', '브레이크는 한 번도 안 밟았어요'],
            gas: [`다시 ${T} 꾹!`, '핸들을 풀면서 끝까지'],
          }[id];
    P.demoCtl = (c, cur, car) => {
      // 브레이크 대신 액셀만 뗌
      const wantSlow = c.brake > 0;
      c.brake = 0;
      if (!cur) return;
      if (cur.id === 'lift') c.throttle = car.speed > P.vMin - 1 || wantSlow ? 0 : 0.2;
      else if (wantSlow) c.throttle = 0;
    };
    return P;
  },
  task: (ctx, P) => `${ctx.cname(P.c)}: 브레이크 없이 ${ctx.K('throttle')}만 <b>톡 떼서</b> 돌고, 에이펙스 뒤 다시 꾹`,
  goals: ['W 떼기 (브레이크 없이)', '짧게 떼기', '길 안에서', '다시 가속'],
  cue: (P, id) => ({ straight: 'throttle', lift: P.turnKey, apex: null, gas: 'throttle' })[id],
  judge(ctx, P) {
    const R = cornerRec(ctx, P);
    return {
      step: R.step,
      prog: () => [R.X.liftT > 0.12 && R.X.brkInLift < 0.15, R.X.liftMax > 0.12 && R.X.liftMax < 1.6, R.X.offT < 0.3 && R.drill.R.passApexT != null, !!R.X.corners[P.c.k]],
      result() {
        const { res, by } = R.rows();
        const X = R.X;
        const rows = [];
        if (X.liftT >= 0.12 && X.brkInLift < 0.15) rows.push(row('lift', 'ok', 'W 떼기 (브레이크 없이)', '좋아요! 브레이크 없이 W만 떼서 돌았어요'));
        else if (X.liftT >= 0.12) rows.push(row('lift', 'meh', 'W 떼기 (브레이크 없이)', `W는 뗐는데 브레이크도 ${t1(X.brkInLift)}초 밟았어요. 여긴 떼기만 해도 돼요`));
        else if (X.brkInLift >= 0.15) rows.push(row('lift', 'meh', 'W 떼기 (브레이크 없이)', `브레이크로 돌았어요. 이번엔 ${ctx.kbd('throttle')}만 떼 보세요`));
        else rows.push(row('lift', 'bad', 'W 떼기 (브레이크 없이)', `계속 밟고 있었어요. 코너 앞에서 ${ctx.kbd('throttle')}를 잠깐 떼요`));
        if (X.liftMax <= 0) rows.push(row('short', 'bad', '짧게 떼기', '떼지 않았어요'));
        else if (X.liftMax > 1.6) rows.push(row('short', 'meh', '짧게 떼기', `${t1(X.liftMax)}초나 뗐어요. 길게 떼면 느려져요 (0.3~1초면 충분)`));
        else rows.push(row('short', 'ok', '짧게 떼기', `${t1(X.liftMax)}초만 짧게 뗐어요`));
        if (res.respawn || X.offT > 0.6) rows.push(row('stay', 'bad', '길 안에서', '밖으로 나갔어요. W를 조금 더 일찍 떼요'));
        else if (X.offT > 0.15) rows.push(row('stay', 'meh', '길 안에서', '바퀴가 잔디에 살짝 닿았어요'));
        else rows.push(row('stay', 'ok', '길 안에서', '라인 안에서 잘 돌았어요'));
        rows.push(by.gas);
        return { rows, respawn: res.respawn };
      },
    };
  },
};

// 4) 늦게 꺾고 빨리 가속 ---------------------------------------------------
RUN.late = {
  demo: true,
  spot: (ctx) => ctx.spots.late,
  intro: (ctx, c) => `
    <p>코너 뒤에 <b>긴 직선</b>(약 ${Math.round((c.runAfter || 300) / 10) * 10} m)이 있으면, 코너에서 조금 손해를 봐도 <b>탈출 속도</b>가 직선 끝까지 이어져요. 그래서 <b>조금 늦게 꺾고</b>, 에이펙스를 지나면 <b>바로 꾹</b>!</p>
    ${steps([['①', '바깥에서 조금 더 참기'], ['②', '늦게, 한 번에 꺾기'], ['③', '에이펙스 = 코너 뒤쪽'], ['④', `바로 ${ctx.kbd('throttle')} 꾹 → 직선`]])}
    ${why(`에이펙스를 지나 ${ctx.kbd('throttle')}를 꾹 밟고 라인대로 나가면 <b>좋은 탈출</b> 보너스로 살짝 빨라져요. 늦게 꺾으면 핸들을 빨리 풀 수 있어서 더 일찍 밟을 수 있어요. ${(ctx.car.cfg.drivetrain || 'rwd') === 'fwd' ? '앞바퀴 굴림은 밟을 때 앞이 밀리니 핸들을 풀면서 밟아요.' : '너무 일찍 꾹 밟으면 꼬리가 흐를 수 있으니 핸들을 풀면서 밟아요.'}`)}
    <p class="tut-tip">💡 성적표에 <b>직선 끝 속도</b>가 나와요. 코너가 조금 느려도 이 숫자가 높으면 성공이에요.</p>`,
  plan: (ctx, c) => {
    const P = basePlan(ctx, c, runUp(ctx, c));
    P.badge = `🎬 시범 · ${ctx.cname(c)} 탈출`;
    P.vCheckD = P.dX + Math.min(150, Math.max(60, (c.runAfter || 200) - 40));
    P.end = P.vCheckD + 15;
    P.moments = P.moments.map((x) => (x.id === 'out' ? { ...x, b: P.vCheckD - 30 } : x));
    P.moments.push({ id: 'run', a: P.vCheckD - 30, b: 1e9, ts: 1 });
    P.momentAt = (m) => P.moments.find((x) => m >= x.a && m < x.b) || P.moments[0];
    P.strip = stripOf([['straight', '직선'], ['brake', bName(P)], ['turn', '늦게 꺾기'], ['apex', '에이펙스'], ['gas', '바로 꾹'], ['out', '탈출'], ['run', '직선 속도']]);
    const T = ctx.kbd('throttle'), S = ctx.kbd(P.turnKey);
    P.texts = (id, coach) =>
      ({
        turn: coach ? [`늦게 ${S}`, ''] : [`조금 참았다가 ${S} 한 번에`, '늦게 꺾으면 에이펙스 뒤로 핸들을 빨리 풀어요'],
        gas: coach ? [`바로 ${T} 꾹!`, ''] : [`에이펙스 지나자마자 ${T} 꾹!`, '여기서 밟은 만큼 직선이 빨라져요'],
        run: coach ? ['직선 끝 속도!', ''] : ['직선 끝까지 속도가 이어져요', '탈출이 빠르면 직선 전체가 빨라요'],
      })[id] || null;
    return P;
  },
  task: (ctx, P) => `${ctx.cname(P.c)}: 늦게 꺾고, 에이펙스 뒤 <b>바로</b> ${ctx.K('throttle')} → 직선 속도!`,
  goals: ['브레이크', '에이펙스', '바로 가속', '직선 속도'],
  judge(ctx, P) {
    const R = cornerRec(ctx, P);
    return {
      step: R.step,
      prog: () => [P.brakeKind && P.brakeKind !== 'brake' ? R.drill.R.brakeD == null && R.drill.R.passApexT != null : R.drill.R.brakeD != null, !!R.drill.R.apex, R.drill.R.gasDelay != null && R.drill.R.gasDelay < 0.6, R.X.vEnd != null && R.X.vEnd >= R.X.vPlan * 0.97],
      result() {
        const { res, by } = R.rows();
        const X = R.X, D = R.drill.R;
        const rows = [by.brake, by.apex];
        const c = X.corners[P.c.k];
        if (c && c.goodExit && D.gasDelay != null && D.gasDelay < 0.6) rows.push(row('gas', 'ok', '바로 가속', `좋은 탈출! 에이펙스 뒤 ${t1(D.gasDelay)}초에 꾹`));
        else if (c && c.goodExit) rows.push(row('gas', 'meh', '바로 가속', `좋은 탈출이지만 꾹 밟기까지 ${D.gasDelay != null ? t1(D.gasDelay) + '초' : '오래'} 걸렸어요. 더 빨리!`));
        else rows.push(row('gas', 'bad', '바로 가속', exitWhy(ctx, c)));
        if (X.vEnd == null) rows.push(row('run', 'bad', '직선 속도', '직선까지 못 갔어요'));
        else {
          const r = X.vEnd / Math.max(1, X.vPlan);
          const txt = `${kmh(X.vEnd)} km/h (목표 ${kmh(X.vPlan)})`;
          rows.push(r >= 0.93 ? row('run', 'ok', '직선 속도', `빨라요! ${txt}`) : r >= 0.88 ? row('run', 'meh', '직선 속도', `조금 모자라요: ${txt}`) : row('run', 'bad', '직선 속도', `느려요: ${txt}. 탈출에서 더 일찍 꾹`));
        }
        return { rows, respawn: res.respawn };
      },
    };
  },
};

// 5) 연속 코너 잇기 ---------------------------------------------------------
RUN.chain = {
  demo: true,
  spot: (ctx) => ctx.spots.chain,
  label: (ctx, pair) => `${ctx.cname(pair[0])}→${ctx.cname(pair[1])}`,
  intro: (ctx, pair) => {
    const [a, b] = pair;
    const same = a.side === b.side;
    return `
    <p><b>${ctx.cname(a)}</b> 바로 뒤에 <b>${ctx.cname(b)}</b>가 붙어 있어요. 이런 곳은 두 코너를 <b>하나로</b> 생각해요: 첫 코너 탈출이 둘째 코너의 <b>진입 자리</b>가 돼요.</p>
    ${steps([['①', `${ctx.cname(a)}: 에이펙스 + 좋은 탈출`], ['②', same ? '바깥으로 너무 나가지 않기' : `둘째 코너 바깥(${b.side > 0 ? '왼쪽' : '오른쪽'})에 자리 잡기`], ['③', `${ctx.cname(b)}: 에이펙스`], ['④', '둘 다 깔끔 = 연계 ×2']])}
    ${why(`깔끔한 코너(에이펙스 + 좋은 탈출)를 <b>이어서</b> 하면 '연계 ×n' 보너스가 점점 커져요. 첫 코너에서 욕심내서 빨리 들어가면 탈출이 밀려서 둘째 코너까지 망쳐요 → <b>첫 코너는 조금 차분하게</b>.`)}
    <p class="tut-tip">💡 첫 코너 탈출에서 밀린다면 W를 톡 떼서(리프트오프) 머리를 다시 안쪽으로 넣어요.</p>`;
  },
  plan: (ctx, pair) => {
    const [a, b] = pair;
    const P = basePlan(ctx, a, runUp(ctx, a));
    const d = (i) => ((((Math.round(i) - P.i0) % P.N) + P.N) % P.N) * P.ds;
    P.c2 = b;
    P.d2B = d(b.drop > 1.5 ? b.brakeI : b.apexI - Math.round(60 / P.ds));
    P.d2A = d(b.apexI);
    P.d2X = d(b.exitI);
    P.d2Pre = Math.min(P.d2A - 25, P.d2B - 0.3 * Math.max(20, b.vBrake));
    P.end = P.d2X + 35;
    P.badge = `🎬 시범 · ${ctx.cname(a)}→${ctx.cname(b)} 연속 코너`;
    const mid = Math.min(P.dX, P.d2Pre - 5);
    P.moments = [
      { id: 'straight', a: -1e9, b: P.dB - 0.3 * P.vB, ts: 1 },
      { id: 'c1', a: P.dB - 0.3 * P.vB, b: P.dA - 10, ts: 1 },
      { id: 'apex1', a: P.dA - 10, b: Math.max(P.dA + 6, Math.min(mid, P.dA + 30)), ts: 1, pulse: { ts: 0.3, sec: 1.1 } },
      { id: 'link', a: Math.max(P.dA + 6, Math.min(mid, P.dA + 30)), b: P.d2A - 10, ts: 1, pulse: { ts: 0.35, sec: 1.2 } },
      { id: 'apex2', a: P.d2A - 10, b: P.d2A + 6, ts: 1, pulse: { ts: 0.35, sec: 0.9 } },
      { id: 'gas', a: P.d2A + 6, b: 1e9, ts: 1 },
    ];
    P.momentAt = (m) => P.moments.find((x) => m >= x.a && m < x.b) || P.moments[0];
    P.strip = stripOf([['straight', '직선'], ['c1', ctx.cname(a)], ['apex1', '탈출'], ['link', '자리 잡기'], ['apex2', ctx.cname(b)], ['gas', '가속']]);
    const T = ctx.kbd('throttle'), B = ctx.kbd('brake');
    const out2 = b.side > 0 ? '왼쪽' : '오른쪽';
    P.texts = (id, coach) =>
      coach
        ? { straight: [`${T} 꾹`, ''], c1: [`${ctx.cname(a)} · ${P.brakeKind === 'brake' ? B : P.brakeKind === 'lift' ? '톡 떼기' : '그대로'}`, ''], apex1: ['에이펙스 → 탈출', ''], link: [a.side === b.side ? '밖으로 너무 나가지 않기' : `${out2}에 자리 잡기`, ''], apex2: [`${ctx.cname(b)} 에이펙스`, ''], gas: [`${T} 꾹!`, ''] }[id]
        : {
            straight: [`두 코너를 한 번에!`, `${ctx.cname(a)} 다음 바로 ${ctx.cname(b)}`],
            c1: [`${ctx.cname(a)}: ${P.brakeKind === 'brake' ? `${B}로 차분하게` : P.brakeKind === 'lift' ? `${T}를 살짝 떼고 (브레이크 없이)` : `브레이크 없이 그대로`}`, '첫 코너는 욕심내지 않기'],
            apex1: ['에이펙스 → 깔끔한 탈출', '여기서 밀리면 다음 코너도 늦어져요'],
            link: [a.side === b.side ? '바깥 끝까지 나가지 말고' : `다음 코너 바깥(${out2})으로`, `${ctx.cname(b)}에 들어갈 자리를 만들어요`],
            apex2: [`${ctx.cname(b)} 에이펙스`, '안쪽 연석을 스쳐요'],
            gas: [`${T} 꾹! 연계 ×2`, '둘 다 깔끔하면 보너스'],
          }[id];
    return P;
  },
  task: (ctx, P) => `${ctx.cname(P.c)}→${ctx.cname(P.c2)}: 첫 코너 깔끔 → 자리 잡기 → 둘째 코너 깔끔 = <b>연계 ×2</b>`,
  goals: ['첫 코너 탈출', '둘째 코너 자리', '둘째 코너', '연계 ×2'],
  cue: (P, id) => ({ straight: 'throttle', c1: P.brakeKind === 'brake' ? 'brake' : P.turnKey, apex1: 'throttle', link: null, apex2: P.c2.side > 0 ? 'right' : 'left', gas: 'throttle' })[id],
  judge(ctx, P) {
    const R = cornerRec(ctx, P);
    const c2line = ctx.line.offset[P.c2.brakeI] * P.c2.side;
    return {
      step: R.step,
      prog: () => {
        const a = R.X.corners[P.c.k], b = R.X.corners[P.c2.k];
        return [!!(a && a.goodExit), R.X.outLat2 != null && R.X.outLat2 <= Math.max(c2line, -4) + 2, !!(b && b.goodExit), !!(b && b.chain >= 2)];
      },
      result() {
        const { res } = R.rows();
        const X = R.X;
        const a = X.corners[P.c.k], b = X.corners[P.c2.k];
        const rows = [];
        rows.push(a && a.clean ? row('c1', 'ok', `${ctx.cname(P.c)} 탈출`, '깔끔한 코너!') : a && a.goodExit ? row('c1', 'meh', `${ctx.cname(P.c)} 탈출`, '탈출은 좋은데 에이펙스를 놓쳤어요') : row('c1', 'bad', `${ctx.cname(P.c)} 탈출`, exitWhy(ctx, a)));
        if (X.outLat2 == null) rows.push(row('pos', 'bad', '둘째 코너 자리', '둘째 코너까지 못 갔어요'));
        else {
          const want = Math.max(c2line, -4);
          const e = X.outLat2 - want;
          rows.push(e <= 2 ? row('pos', 'ok', '둘째 코너 자리', '좋은 자리에서 들어갔어요') : e <= 4.5 ? row('pos', 'meh', '둘째 코너 자리', `조금 안쪽이었어요 (${t1(e)} m). 첫 코너 탈출을 라인대로`) : row('pos', 'bad', '둘째 코너 자리', `너무 안쪽(${t1(e)} m)에서 들어갔어요. 첫 코너를 차분하게`));
        }
        rows.push(b && b.clean ? row('c2', 'ok', `${ctx.cname(P.c2)}`, X.apex2 === 'apexPerfect' ? '완벽한 에이펙스 + 좋은 탈출!' : '깔끔한 코너!') : b && b.goodExit ? row('c2', 'meh', `${ctx.cname(P.c2)}`, '탈출은 좋은데 에이펙스를 놓쳤어요') : row('c2', 'bad', `${ctx.cname(P.c2)}`, exitWhy(ctx, b)));
        rows.push(b && b.chain >= 2 ? row('chain', 'ok', '연계', `연계 ×${b.chain}! 보너스가 커졌어요`) : a && b && a.goodExit && b.goodExit ? row('chain', 'meh', '연계', '거의 다 왔어요: 두 코너 모두 에이펙스까지 맞히면 연계') : row('chain', 'bad', '연계', '두 코너를 모두 깔끔하게 돌면 연계 ×2'));
        return { rows, respawn: res.respawn };
      },
    };
  },
};

// 6) 연석 쓰기 --------------------------------------------------------------
RUN.kerb = {
  demo: true,
  spot: (ctx) => ctx.spots.kerb,
  intro: (ctx, c) => `
    <p>빨강·흰 줄무늬 <b>연석</b>도 달릴 수 있는 길이에요. 안쪽 연석을 밟으면 코너가 <b>덜 휘고</b>, 탈출에서 바깥 연석까지 쓰면 핸들을 <b>더 빨리 풀어요</b>.</p>
    ${steps([['①', '바깥에서 들어가기'], ['②', '에이펙스: <b>안쪽 연석</b> 밟기'], ['③', `${ctx.kbd('throttle')} 꾹 + 바깥 연석까지`], ['④', '잔디(초록)는 밟지 않기']])}
    ${why('연석 위에선 차가 <b>드르륵</b> 떨리고 접지력이 <b>조금</b> 줄어요. 그래서 연석 위에서 급하게 꺾거나 세게 밟지 말고 <b>부드럽게</b>. 연석을 넘어 잔디까지 가면 크게 느려져요.')}
    <p class="tut-tip">💡 에이펙스 판정은 차가 안쪽 끝에 붙을수록 '완벽한 에이펙스'가 돼요.</p>`,
  plan: (ctx, c) => {
    const P = basePlan(ctx, c, runUp(ctx, c));
    P.badge = `🎬 시범 · ${ctx.cname(c)} 연석`;
    P.strip = stripOf([['straight', '직선'], ['brake', bName(P)], ['turn', '꺾기'], ['apex', '안쪽 연석'], ['gas', '가속'], ['out', '바깥 연석']]);
    P.moments = P.moments.map((x) => (x.id === 'out' ? { ...x, pulse: { ts: 0.35, sec: 1.0 } } : x.id === 'brake' ? { ...x, pulse: null } : x));
    P.texts = (id, coach) =>
      ({
        apex: coach ? ['안쪽 연석 밟기', ''] : ['안쪽 연석을 밟아요', `${P.inName} 빨강·흰 줄 위로 바퀴 하나`],
        out: coach ? ['바깥 연석까지', ''] : ['탈출은 바깥 연석까지 넓게', '잔디(초록)는 밟지 않기'],
      })[id] || null;
    return P;
  },
  task: (ctx, P) => `${ctx.cname(P.c)}: <b>안쪽 연석</b> → ${ctx.K('throttle')} → <b>바깥 연석</b>까지, 잔디는 안 밟기`,
  goals: ['안쪽 연석', '에이펙스', '바깥 연석', '잔디 안 밟기'],
  judge(ctx, P) {
    const R = cornerRec(ctx, P);
    return {
      step: R.step,
      prog: () => [R.X.kerbIn > 0.08, !!R.drill.R.apex, R.X.kerbOut > 0.08, R.X.offT < 0.15],
      result() {
        const { res, by } = R.rows();
        const X = R.X;
        const rows = [];
        rows.push(X.kerbIn > 0.08 ? row('kin', 'ok', '안쪽 연석', `안쪽 연석을 ${t1(X.kerbIn)}초 밟았어요`) : row('kin', R.drill.R.apexBest > P.hw - 2.5 ? 'meh' : 'bad', '안쪽 연석', R.drill.R.apexBest > -Infinity ? `연석까지 ${t1(Math.max(0, P.hw - 0.6 - R.drill.R.apexBest))} m 모자라요. 더 ${P.inName}으로` : '에이펙스까지 못 갔어요'));
        rows.push(R.drill.R.apex === 'apexPerfect' ? row('apex', 'ok', '에이펙스', '완벽한 에이펙스!') : R.drill.R.apex ? row('apex', 'meh', '에이펙스', '에이펙스 성공 (안쪽 끝까지 붙으면 완벽)') : by.apex);
        rows.push(X.kerbOut > 0.08 ? row('kout', 'ok', '바깥 연석', '탈출에서 바깥 연석까지 썼어요') : row('kout', 'meh', '바깥 연석', '탈출을 조금 더 넓게: 바깥 연석까지 써도 돼요'));
        rows.push(res.respawn || X.offT > 0.6 ? row('grass', 'bad', '잔디 안 밟기', `잔디에 ${t1(X.offT)}초 있었어요`) : X.offT > 0.15 ? row('grass', 'meh', '잔디 안 밟기', '잔디에 살짝 닿았어요. 연석까지만') : row('grass', 'ok', '잔디 안 밟기', '연석까지만 깔끔하게!'));
        return { rows, respawn: res.respawn };
      },
    };
  },
};

// 7) 슬립스트림 (앞차 = 봇 1대를 아카데미가 '페이스 카'로 몰아요) -------------
function paceCar(ctx) {
  const rs = ctx.game.raceSys;
  return rs && rs.bots && rs.bots[0] ? rs.bots[0] : null;
}
/** 봇 차를 라인 위 i에 놓고 속도 v */
function placeBot(ctx, b, i, v) {
  const { track, N, W } = ctx;
  i = W(i);
  const t = i / N;
  const bc = b.car;
  bc.placeAt(t, ctx.line.offset[i] || 0);
  if (bc.mode !== 'normal' && bc.setMode) bc.setMode('normal', true);
  bc.speed = bc.forwardSpeed = v;
  bc.vel.copy(bc.fwd).multiplyScalar(v);
  if (bc.gearSpeeds) {
    const G = bc.gearSpeeds();
    const g = G.findIndex((x) => x >= v * 1.15);
    bc.gear = g < 0 ? G.length : Math.max(1, g + 1);
  }
  bc.trackInfo = track.nearest(bc.pos);
  bc.events.length = 0;
  bc.draft = bc.slingT = bc.tow = bc.assistDraft = 0;
  Object.assign(b, { lastT: t, progress: t, chkProg: t, chkT: 0, slowT: 0, offT: 0, wrongT: 0, grace: 3 });
  if (b.driver && b.driver.reset) b.driver.reset();
}
/** 페이스 카: 라인을 따라 플레이어 계획 속도의 mul배로 (액셀을 조절해 속도 유지) */
function drivePace(ctx, b, mulFn, keepFn) {
  const car = b.car, L = ctx.line, N = L.N, ds = ctx.ds;
  const pprof = ctx.car._lineProfile || (ctx.car.lineSpeed(0), ctx.car._lineProfile);
  if (!b._origControls) b._origControls = b.driver.controls;
  b.driver.controls = () => {
    const c = { throttle: 1, brake: 0, steer: 0, drift: false, climb: false, dive: false, booster: false, mode: null, shiftUp: false, shiftDown: false };
    if (!car.trackInfo) return c;
    const i0 = car.trackInfo.index % N, v = Math.max(8, Math.abs(car.speed));
    const j = (i0 + Math.round((6 + v * 0.12) / ds)) % N;
    let dx = L.x[j] - car.pos.x, dz = L.z[j] - car.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const fx = car.fwd.x, fz = car.fwd.z, fl = Math.hypot(fx, fz) || 1;
    const cross = (fx * dz - fz * dx) / fl, dot = (fx * dx + fz * dz) / fl;
    const jf = (i0 + Math.round((v * 0.18) / ds)) % N;
    c.steer = clamp((-L.curvature[jf] * v * v) / 24 + 3 * Math.atan2(cross, dot), -1, 1);
    const lead = (i0 + Math.round((v * 0.25) / ds)) % N;
    let target = Math.min((car._lineProfile || pprof).speed[lead], pprof.speed[lead] * mulFn());
    // keepFn() = 플레이어와 지킬 간격(m): 봇 차가 가속이 더 좋아도 너무 멀리 달아나지 않게 (null이면 안 봄)
    const keep = keepFn ? keepFn() : null;
    if (keep != null && ctx.car.trackInfo) {
      let gm = ctx.W(car.trackInfo.index - ctx.car.trackInfo.index) * ds;
      if (gm > ctx.track.length / 2) gm -= ctx.track.length;
      target = Math.min(target, Math.max(8, Math.abs(ctx.car.speed) + (keep - gm) * 0.35));
    }
    const e = target - car.speed;
    if (e < -1.5) (c.throttle = 0), (c.brake = Math.min(1, -e / 4));
    else c.throttle = clamp(0.35 + e * 0.5, 0, 1);
    return c;
  };
}
function releasePace(b) {
  if (b && b._origControls) {
    b.driver.controls = b._origControls;
    b._origControls = null;
  }
}
RUN.slip = {
  // 슬립스트림 (2026-11-13 바뀐 규칙: 슬링샷·충전 게이지 없음. 앞차 바로 뒤에 붙으면 그 자리에서 바로 빨라짐 → 따라잡아서 옆으로 나가 추월)
  //   예전 '슬립스트림 · 슬링샷' 레슨은 .debug/academyLessons.before-slip2.js
  demo: true,
  needsBot: true,
  spot: (ctx) => (ctx.spots.straight && paceCar(ctx) ? ctx.spots.straight : null),
  intro: (ctx) => `
    <p>앞차 <b>바로 뒤</b>는 바람이 막혀서 공기 저항이 줄어요(<b>슬립스트림</b> 💨). 붙어 있는 동안 <b>바로 빨라져서</b> 앞차를 따라잡아요.</p>
    ${steps([['①', '앞차 뒤에 바짝 (줄 맞추기)'], ['②', `💨 붙은 채로 ${ctx.kbd('throttle')} 꾹`], ['③', `거의 닿으면 ${ctx.kbd('left')}/${ctx.kbd('right')} 살짝 옆으로`], ['④', '나란히 → 추월!']])}
    ${why('앞차 뒤 약 45 m 안, 같은 줄에서 받을 수 있고 <b>가까울수록 세요</b>. 옆으로 나가면 바람을 다시 맞아서 효과가 끝나요 → 앞차에 <b>거의 닿을 때까지</b> 붙어 있다가 나가요. 코너 앞에서 나가면 브레이크 때문에 추월하기 어려워요 → <b>직선 중간</b>에.')}
    <p class="tut-tip">💡 이 레슨에서는 앞차(연습용 차)가 일정한 속도로 달려 줘요. 진짜 레이스에서도 똑같이 돼요.</p>`,
  plan(ctx, S) {
    const { N, ds } = ctx;
    const P = {
      c: { num: 0, side: 1 }, N, ds, i0: ctx.W(S.i0 - Math.round(40 / ds)), vMin: 0, side: 1, turnKey: 'right', outKey: 'left',
      badge: '🎬 시범 · 슬립스트림',
    };
    P.dist = (idx) => {
      const m = ctx.W(idx - P.i0) * ds;
      return m > ctx.track.length / 2 ? m - ctx.track.length : m;
    };
    P.end = Math.min(S.m + 20, 900);
    const rs = ctx.game.raceSys;
    const me = () => (rs && rs.me) || {};
    const draftNow = () => Math.max(car(ctx).draft || 0, me().draft || 0);
    P.gap = () => {
      const b = paceCar(ctx);
      return b && b.car.trackInfo && ctx.car.trackInfo ? P.dist(ctx.car.trackInfo.index) - P.dist(b.car.trackInfo.index) : -99; // + = 내가 앞
    };
    let out = false; // 시범·화면: 옆으로 나갔나
    P.state = () => {
      const g = P.gap();
      if (g > 2) return 'pass';
      if (out || g > -7) return 'out';
      if (draftNow() > 0.15) return 'draft';
      return 'chase';
    };
    P.moments = [{ id: 'chase', a: -1e9, b: 1e9, ts: 1 }];
    P._mo = { chase: { id: 'chase', ts: 1 }, draft: { id: 'draft', ts: 1, pulse: { ts: 0.4, sec: 1.0 } }, out: { id: 'out', ts: 1, pulse: { ts: 0.35, sec: 1.2 } }, pass: { id: 'pass', ts: 1 } };
    P.momentAt = () => P._mo[P.state()];
    P.strip = stripOf([['chase', '뒤에 붙기'], ['draft', '💨 빨라짐'], ['out', '옆으로'], ['pass', '추월']]);
    const T = ctx.kbd('throttle'), Lk = ctx.kbd('left'), Rk = ctx.kbd('right');
    P.texts = (id, coach) =>
      coach
        ? { chase: [`앞차 뒤로 · ${T} 꾹`, ''], draft: ['💨 붙어 있기', '빨라지는 중'], out: ['지금 옆으로!', `${Lk} 또는 ${Rk} 살짝`], pass: ['추월!', `${T} 꾹`] }[id]
        : {
            chase: [`앞차 바로 뒤로! ${T} 꾹`, '같은 줄에 맞추면 바람이 막혀요'],
            draft: ['💨 슬립스트림 — 바로 빨라져요', '붙어 있는 만큼 앞차에 가까워져요'],
            out: ['거의 닿았으면 이제 옆으로', `${Lk} 살짝 → 앞차 옆으로`],
            pass: ['추월!', '빨라진 속도 그대로 앞으로'],
          }[id];
    // 시범: 라인 따라 앞차 뒤에 붙어 있다가 6 m까지 따라잡으면 옆(왼쪽 3.4 m)으로
    P.driver = () =>
      lineDriver(ctx.game, {
        offset: () => {
          const g = P.gap();
          if (!out && g > -6 && g < 0) out = true;
          if (out && g > 14) out = false;
          return out ? -3.4 : 0;
        },
      });
    P.demoCtl = (c) => {
      c.brake = 0;
      c.throttle = 1;
    };
    P.place = () => (out = false);
    return P;
  },
  place(ctx, P) {
    const b = paceCar(ctx);
    const i = ctx.W(P.i0);
    const v = 0.82 * ctx.car.lineSpeed(i);
    ctx.placeRolling(i, 0, v);
    if (b) {
      placeBot(ctx, b, i + Math.round(15 / ctx.ds), v); // 15 m 앞
      drivePace(ctx, b, () => 0.93);
    }
    if (P.place) P.place();
  },
  cleanup: (ctx) => releasePace(paceCar(ctx)),
  task: (ctx) => `앞차 뒤에 바짝 붙어 💨 빨라지기 → 거의 닿으면 옆으로 → <b>추월!</b>`,
  goals: ['💨 뒤에 붙기', '따라잡기', '추월'],
  cue: (P, id) => ({ chase: 'throttle', draft: 'throttle', out: 'left', pass: 'throttle' })[id],
  judge(ctx, P) {
    const rs = ctx.game.raceSys, me = () => (rs && rs.me) || {};
    const X = { draftT: 0, maxDraft: 0, closest: null, gap0: null, ahead: null, respawn: false };
    return {
      step(dt, seen) {
        if (seen.includes('respawn') || seen.includes('fall')) return (X.respawn = true), 'end';
        const d = Math.max(ctx.car.draft || 0, me().draft || 0);
        if (d > 0.15) X.draftT += dt;
        X.maxDraft = Math.max(X.maxDraft, d);
        if (!ctx.car.trackInfo) return null;
        const g = P.gap();
        X.ahead = g;
        if (X.gap0 == null && g > -90) X.gap0 = g;
        if (g < 0) X.closest = X.closest == null ? g : Math.max(X.closest, g);
        if (P.dist(ctx.car.trackInfo.index) > P.end || g > 25) return 'end';
        return null;
      },
      prog: () => [X.draftT > 1.2, X.closest != null && X.closest > -8, X.ahead != null && X.ahead > 2],
      result() {
        const rows = [];
        rows.push(X.draftT >= 1.2 ? row('draft', 'ok', '💨 뒤에 붙기', `${t1(X.draftT)}초 동안 슬립스트림을 받았어요`) : X.draftT > 0.3 ? row('draft', 'meh', '💨 뒤에 붙기', `${t1(X.draftT)}초만 받았어요. 줄을 앞차에 맞춰 더 오래`) : row('draft', 'bad', '💨 뒤에 붙기', '앞차 바로 뒤, 같은 줄로 들어가요'));
        const cl = X.ahead != null && X.ahead > 0 ? 0 : X.closest;
        rows.push(cl != null && cl > -8 ? row('close', 'ok', '따라잡기', '앞차 바로 뒤까지 따라잡았어요') : cl != null && cl > -16 ? row('close', 'meh', '따라잡기', `${Math.round(-cl)} m까지 왔어요. 더 오래 붙어 있어요`) : row('close', 'bad', '따라잡기', '앞차와 거리가 줄지 않았어요. 같은 줄로 바짝'));
        rows.push(X.ahead != null && X.ahead > 2 ? row('pass', 'ok', '추월', `앞차보다 ${Math.round(X.ahead)} m 앞!`) : X.ahead != null && X.ahead > -8 ? row('pass', 'meh', '추월', '나란히까지 왔어요. 거의 닿으면 바로 옆으로') : row('pass', 'bad', '추월', '추월하지 못했어요'));
        return { rows, respawn: X.respawn };
      },
    };
  },
};
const car = (ctx) => ctx.car;

// 8) DRS -------------------------------------------------------------------
RUN.drs = {
  demo: true,
  needsBot: true,
  spot: (ctx) => {
    const rs = ctx.game.raceSys;
    const info = rs && rs.drsInfo ? rs.drsInfo() : null;
    const z = info && info.zones && info.zones.slice().sort((a, b) => (b.len || 0) - (a.len || 0))[0];
    return z && paceCar(ctx) ? z : null;
  },
  intro: (ctx) => `
    <p>도로 위 <b>DRS DETECTION</b> 점선을 지날 때 앞차와 <b>1초 안</b>이면, 다음 <b>DRS ZONE</b> 직선에서 내 차 뒷날개가 <b>저절로 열려요</b> → 공기 저항이 줄어 더 빨라져요.</p>
    ${steps([['①', '감지선 전에 앞차에 1초 안으로'], ['②', "'DRS 가능' 칩 확인"], ['③', `DRS ZONE에서 ${ctx.kbd('throttle')} 꾹 (날개 열림)`], ['④', `${ctx.kbd('brake')}를 밟으면 닫혀요`]])}
    ${why('열린 날개는 바람을 덜 받아서 최고 속도가 조금 올라가요. 브레이크를 밟으면 그 구간에선 다시 닫혀요 → 직선 끝 <b>브레이크 지점까지</b> 꾹. 슬립스트림과 같이 받으면 더 세요.')}
    <p class="tut-tip">💡 DRS는 앞차가 있을 때만 돼요 (혼자·타임 어택에선 없음). 레이스 출발 뒤 15초부터 써요.</p>`,
  plan(ctx, z) {
    const { N, ds, W } = ctx;
    const det = W(Math.round(z.detT * N)), zs = W(Math.round(z.startT * N)), ze = W(Math.round(z.endT * N));
    const P = { c: { num: 0, side: 1 }, N, ds, i0: W(det - Math.round(260 / ds)), vMin: 0, side: 1, turnKey: 'right', outKey: 'left', badge: '🎬 시범 · DRS' };
    P.dist = (idx) => {
      const m = W(idx - P.i0) * ds;
      return m > ctx.track.length / 2 ? m - ctx.track.length : m;
    };
    P.dDet = P.dist(det);
    P.dZs = P.dist(zs);
    P.dZe = P.dist(ze);
    P.end = P.dZe + 30;
    const rs = ctx.game.raceSys;
    P.moments = [
      { id: 'close', a: -1e9, b: P.dDet - 20, ts: 1 },
      { id: 'detect', a: P.dDet - 20, b: P.dDet + 15, ts: 1, pulse: { ts: 0.3, sec: 1.1 } },
      { id: 'wait', a: P.dDet + 15, b: P.dZs, ts: 1 },
      { id: 'open', a: P.dZs, b: P.dZs + 60, ts: 1, pulse: { ts: 0.35, sec: 1.1 } },
      { id: 'zone', a: P.dZs + 60, b: 1e9, ts: 1 },
    ];
    P.momentAt = (m) => P.moments.find((x) => m >= x.a && m < x.b) || P.moments[0];
    P.strip = stripOf([['close', '1초 안으로'], ['detect', '감지선'], ['wait', 'DRS 가능'], ['open', '날개 열림'], ['zone', '끝까지 꾹']]);
    const T = ctx.kbd('throttle'), B = ctx.kbd('brake');
    P.texts = (id, coach) =>
      coach
        ? { close: [`앞차에 붙기 · ${T}`, ''], detect: ['감지선!', '1초 안?'], wait: ['DRS 가능', ''], open: ['날개 열림!', `${T} 꾹`], zone: [`${B} 밟지 않기`, ''] }[id]
        : {
            close: ['앞차와 1초 안으로!', '감지선까지 바짝 따라가요'],
            detect: ['DRS DETECTION 점선', '여기서 앞차와 1초 안이면 DRS 가능'],
            wait: ["'DRS 가능' — 직선을 기다려요", '날개는 DRS ZONE에서 저절로 열려요'],
            open: ['DRS ZONE: 날개 열림!', `${T} 꾹 → 앞차를 따라잡아요`],
            zone: [`${B}를 밟으면 닫혀요`, '직선 끝 브레이크 지점까지 꾹'],
          }[id];
    P.driver = () => lineDriver(ctx.game, { offset: () => (P._side || 0) });
    P.demoCtl = (c, cur, car) => {
      const b = paceCar(ctx);
      if (b && b.car.trackInfo && car.trackInfo && cur && cur.id === 'zone') {
        const g = P.dist(b.car.trackInfo.index) - P.dist(car.trackInfo.index);
        P._side = g < 18 && g > -10 ? -3.4 : 0;
      }
    };
    return P;
  },
  place(ctx, P) {
    const b = paceCar(ctx);
    const i = ctx.W(P.i0);
    const v = 0.85 * ctx.car.lineSpeed(i);
    // DRS는 레이스 출발 뒤 15초부터 → 연습에선 레이스 시계를 그 뒤로
    if (ctx.race.time < 20) ctx.race.time = 20;
    if (ctx.race.clock != null && ctx.race.clock < 20) ctx.race.clock = 20;
    ctx.placeRolling(i, 0, v);
    P._side = 0;
    if (b) {
      placeBot(ctx, b, i + Math.round(Math.max(20, v * 0.55) / ctx.ds), v);
      // 감지선까지는 플레이어 앞 약 0.55초를 지켜 줌 (봇 차 가속이 더 좋으면 1초 밖으로 달아났음) → DRS ZONE부터는 계획 속도 ×0.95로 그냥 달림
      drivePace(ctx, b, () => 0.95, () => (ctx.car.trackInfo && P.dist(ctx.car.trackInfo.index) < P.dDet + 10 ? Math.max(14, Math.abs(ctx.car.speed) * 0.55) : null));
    }
  },
  cleanup: (ctx) => releasePace(paceCar(ctx)),
  task: () => `감지선에서 앞차와 <b>1초 안</b> → DRS ZONE에서 날개 열고 끝까지 꾹`,
  goals: ['1초 안 (DRS 가능)', '날개 열림', '브레이크로 닫지 않기', '따라잡기'],
  cue: (P, id) => ({ close: 'throttle', detect: 'throttle', wait: 'throttle', open: 'throttle', zone: 'throttle' })[id],
  judge(ctx, P) {
    const rs = ctx.game.raceSys;
    const X = { armed: false, open: false, closedByBrake: false, gap0: null, gap1: null, respawn: false };
    const b = paceCar(ctx);
    const gap = () => (b && b.car.trackInfo && ctx.car.trackInfo ? P.dist(ctx.car.trackInfo.index) - P.dist(b.car.trackInfo.index) : null);
    return {
      step(dt, seen) {
        if (seen.includes('respawn') || seen.includes('fall')) return (X.respawn = true), 'end';
        if (!ctx.car.trackInfo) return null;
        const m = P.dist(ctx.car.trackInfo.index);
        const info = rs && rs.drsInfo ? rs.drsInfo() : null;
        if (info && info.me && info.me.armed) X.armed = true;
        if ((ctx.car.drs || 0) > 0.5) X.open = true;
        if (m > P.dZs && m < P.dZe - 60 && ctx.car.brk > 0.3) X.closedByBrake = true;
        if (X.gap0 == null && m >= P.dZs) X.gap0 = gap();
        X.gap1 = gap();
        if (m > P.end) return 'end';
        return null;
      },
      prog: () => [X.armed, X.open, X.open && !X.closedByBrake, X.gap0 != null && X.gap1 != null && X.gap1 > X.gap0 + 5],
      result() {
        const rows = [];
        rows.push(X.armed ? row('arm', 'ok', '1초 안 (DRS 가능)', '감지선에서 1초 안이었어요') : row('arm', 'bad', '1초 안 (DRS 가능)', '감지선에서 앞차와 1초보다 멀었어요. 더 바짝'));
        rows.push(X.open ? row('open', 'ok', '날개 열림', 'DRS가 열렸어요!') : row('open', X.armed ? 'meh' : 'bad', '날개 열림', X.armed ? 'DRS ZONE까지 땅 위에서 꾹 밟아요' : '먼저 감지선에서 1초 안으로'));
        rows.push(X.open && !X.closedByBrake ? row('keep', 'ok', '브레이크로 닫지 않기', '끝까지 열고 달렸어요') : X.closedByBrake ? row('keep', 'bad', '브레이크로 닫지 않기', '직선에서 브레이크를 밟아 닫혔어요') : row('keep', 'meh', '브레이크로 닫지 않기', '날개가 열려야 볼 수 있어요'));
        const g = X.gap0 != null && X.gap1 != null ? X.gap1 - X.gap0 : null;
        rows.push(g != null && X.gap1 > 2 ? row('pass', 'ok', '따라잡기', `추월! (${Math.round(g)} m 따라잡음)`) : g != null && g > 5 ? row('pass', 'ok', '따라잡기', `${Math.round(g)} m 따라잡았어요`) : g != null && g > 0 ? row('pass', 'meh', '따라잡기', `${Math.round(g)} m만 따라잡았어요`) : row('pass', 'bad', '따라잡기', '거리를 못 줄였어요'));
        return { rows, respawn: X.respawn };
      },
    };
  },
};

// 9) 드리프트 ---------------------------------------------------------------
RUN.drift = {
  demo: true,
  spot: (ctx) => ctx.spots.drift,
  intro: (ctx, c) => {
    const D = ctx.car.cfg.drift || {};
    const W = Array.isArray(D.holdAngle) ? D.holdAngle : [0.28, 0.75];
    const deg = (r) => Math.round((r * 180) / Math.PI);
    return `
    <p>아주 느린 <b>헤어핀</b>에서는 꼬리를 미끄러뜨려 차 머리를 빨리 돌릴 수 있어요. 꺾으면서 ${ctx.K('drift')}를 누르고, 너무 돌면 <b>반대로 살짝</b> 꺾어(카운터) 각도를 잡아요.</p>
    ${steps([['①', `${ctx.kbd('brake')}로 충분히 줄이기`], ['②', `꺾으면서 ${ctx.K('drift')} 꾹`], ['③', `각도 ${deg(W[0])}~${deg(W[1])}° 버티기`], ['④', '펴면서 놓기 = 깔끔한 탈출']])}
    ${why(`각도가 초록 칸 안이면 오래 버틸 수 있고, 너무 크면(약 ${deg(D.spinAngle || 1.15)}° 넘게) <b>스핀</b>해요. 각도가 작아질 때 놓으면 '깔끔한 탈출'로 잃은 속도를 조금 돌려받아요. 빠른 코너에선 드리프트보다 그냥 라인이 빨라요.`)}
    <p class="tut-tip">💡 너무 돌 때는 핸들을 반대로 <b>톡톡</b>. 꾹 누르면 반대쪽으로 튀어요.</p>`;
  },
  plan: (ctx, c) => {
    const P = cornerPlan(ctx.game, c, Math.min(220, runUp(ctx, c)));
    P.driver = () => lineDriver(ctx.game, { look: DEMO_LOOK });
    P.badge = `🎬 시범 · ${ctx.cname(c)} 드리프트`;
    P.moments = [
      { id: 'straight', a: -1e9, b: P.dB - 0.3 * P.vB, ts: 1 },
      { id: 'brake', a: P.dB - 0.3 * P.vB, b: P.dA - 30, ts: 1 },
      { id: 'kick', a: P.dA - 30, b: P.dA - 8, ts: 1, pulse: { ts: 0.3, sec: 1.2 } },
      { id: 'hold', a: P.dA - 8, b: P.dA + 18, ts: 1, pulse: { ts: 0.35, sec: 1.0 } },
      { id: 'exit', a: P.dA + 18, b: 1e9, ts: 1 },
    ];
    P.momentAt = (m) => P.moments.find((x) => m >= x.a && m < x.b) || P.moments[0];
    P.strip = stripOf([['straight', '직선'], ['brake', '브레이크'], ['kick', '꺾고 드리프트'], ['hold', '각도 버티기'], ['exit', '펴고 놓기']]);
    const Dk = ctx.kbd('drift') || ctx.K('drift'), S = ctx.kbd(P.turnKey), O = ctx.kbd(P.outKey), B = ctx.kbd('brake'), T = ctx.kbd('throttle');
    P.texts = (id, coach) =>
      coach
        ? { straight: [`${T}`, ''], brake: [`${B} 충분히`, ''], kick: [`${S} + ${Dk}`, ''], hold: ['각도 버티기', `너무 돌면 ${O} 살짝`], exit: ['펴면서 놓기', `${T}`] }[id]
        : {
            straight: ['헤어핀이 와요', '먼저 속도를 충분히 줄여요'],
            brake: [`${B}로 충분히 줄이기`, '빠르면 드리프트가 길게 미끄러져요'],
            kick: [`${S} 꺾으면서 ${Dk} 꾹`, '꼬리가 바깥으로 미끄러져요'],
            hold: ['각도 버티기', `너무 돌면 ${O} 쪽으로 살짝 (카운터)`],
            exit: ['핸들을 펴면서 놓기', `${T} 꾹 → 깔끔한 탈출`],
          }[id];
    P.demoCtl = (c, cur, car) => {
      if (!cur) return;
      if (cur.id === 'brake' && car.speed > P.vMin + 1) (c.throttle = 0), (c.brake = Math.max(c.brake, 0.9));
      if (cur.id === 'kick' || cur.id === 'hold') {
        const ang = Math.abs(car.driftAngle || 0);
        c.drift = cur.id === 'kick' || ang < 0.62;
        c.brake = 0;
        c.throttle = ang > 0.7 ? 0.3 : 0.65;
      }
      if (cur.id === 'exit') c.drift = false;
    };
    return P;
  },
  task: (ctx, P) => `${ctx.cname(P.c)}: 꺾으면서 ${ctx.K('drift')} → 각도 버티기 → 펴면서 놓기`,
  goals: ['드리프트 시작', '각도 버티기', '스핀 없이', '깔끔한 탈출'],
  cue: (P, id) => ({ straight: 'throttle', brake: 'brake', kick: P.turnKey, hold: null, exit: 'throttle' })[id],
  gauge: true,
  judge(ctx, P) {
    const car = ctx.car, D = car.cfg.drift || {};
    const W = Array.isArray(D.holdAngle) ? D.holdAngle : [0.28, 0.75];
    const X = { driftT: 0, holdT: 0, spin: false, exit: false, gain: 0, respawn: false };
    return {
      step(dt, seen) {
        if (seen.includes('respawn') || seen.includes('fall')) return (X.respawn = true), 'end';
        if (car.drifting) X.driftT += dt;
        const a = Math.abs(car.driftAngle || 0);
        if (car.drifting && a >= W[0] && a <= W[1]) X.holdT += dt;
        if (seen.includes('driftSpin')) X.spin = true;
        if (seen.includes('driftExit')) (X.exit = true), (X.gain = (car.lastDriftInfo || {}).gain || 0);
        if (!car.trackInfo) return null;
        const m = P.dist(car.trackInfo.index % P.N);
        if (m > P.dX + 40 && !car.drifting) return 'end';
        return null;
      },
      prog: () => [X.driftT > 0.3, X.holdT > 0.6, X.driftT > 0.3 && !X.spin, X.exit],
      result() {
        const rows = [];
        rows.push(X.driftT >= 0.3 ? row('start', 'ok', '드리프트 시작', `${t1(X.driftT)}초 미끄러졌어요`) : X.driftT > 0 ? row('start', 'meh', '드리프트 시작', '아주 짧았어요. 꺾은 채로 드리프트 키를 꾹') : row('start', 'bad', '드리프트 시작', `코너에서 꺾은 채로 ${ctx.K('drift')}`));
        rows.push(X.holdT >= 0.6 ? row('hold', 'ok', '각도 버티기', `초록 각도에서 ${t1(X.holdT)}초!`) : X.holdT >= 0.2 ? row('hold', 'meh', '각도 버티기', `${t1(X.holdT)}초 버텼어요. 반대로 살짝 꺾어 각도를 잡아요`) : row('hold', 'bad', '각도 버티기', '초록 각도에 거의 못 들어갔어요'));
        rows.push(X.spin ? row('spin', 'bad', '스핀 없이', '스핀! 너무 돌면 반대로 살짝 꺾어요') : X.driftT > 0.3 ? row('spin', 'ok', '스핀 없이', '스핀 없이 버텼어요') : row('spin', 'meh', '스핀 없이', '드리프트를 해야 볼 수 있어요'));
        rows.push(X.exit ? row('exit', 'ok', '깔끔한 탈출', X.gain > 0.3 ? `깔끔한 탈출! +${Math.round(X.gain * 3.6)} km/h` : '깔끔한 탈출!') : row('exit', X.driftT > 0.3 ? 'meh' : 'bad', '깔끔한 탈출', '각도가 작아질 때 핸들을 펴면서 놓아요'));
        return { rows, respawn: X.respawn };
      },
    };
  },
};

// 10) 비행 루트 (그랑프리) ---------------------------------------------------
function botDemoDriver(ctx) {
  const { car, track, game } = ctx;
  const prof = car._lineProfile || (car.lineSpeed(0), car._lineProfile);
  let d = null, since = 30;
  return () => {
    if (!d) d = createBotDriver(car, track, prof, BOT_LEVELS.hard, 7, { pack: false });
    since += 1 / 60;
    return d.controls({ since, dt: 1 / 60, me: { progM: 0, lat: car.trackInfo ? car.trackInfo.lateral : 0 }, others: [], finished: false });
  };
}
RUN.fly = {
  demo: true,
  spot: (ctx) => (ctx.track.runway ? ctx.track.runway : null),
  intro: (ctx) => `
    <p>그랑프리 <b>활주로</b>에 올라서면 비행 모드! <b>약 94 km/h</b>가 넘으면 ${ctx.K('climb')}로 이륙해서 하늘의 <b>고리 4개</b>를 지나고 <b>착륙장</b>에 내려요.</p>
    ${steps([['①', `활주로에서 ${ctx.kbd('throttle')} 꾹`], ['②', `${ctx.K('climb')} 이륙`], ['③', `고리 가운데로 (${ctx.K('climb')} 위 · ${ctx.K('dive')} 아래)`], ['④', '착륙장에 부드럽게']])}
    ${why(`비행 중 ${ctx.kbd('left')}/${ctx.kbd('right')}는 날개를 기울여 <b>크게</b> 돌아요(바로 꺾이지 않아요) → 다음 고리를 <b>미리</b> 보고 기울여요. 하늘길에서 50 m 넘게 벗어나면 자동으로 내려와요. 너무 느리면(약 58 km/h 아래) 떨어져요.`)}
    <p class="tut-tip">💡 고리는 가운데를 노리면 위아래 실수를 해도 지나가요.</p>`,
  plan(ctx) {
    const { N, ds, track, car } = ctx;
    const iRun = track.nearest(track.runway.start.pos).index % N;
    const P = { c: { num: 0, side: 1 }, N, ds, i0: ctx.W(iRun - Math.round(260 / ds)), vMin: 0, side: 1, turnKey: 'right', outKey: 'left', badge: '🎬 시범 · 비행 루트' };
    P.dist = (idx) => {
      const m = ctx.W(idx - P.i0) * ds;
      return m > track.length / 2 ? m - track.length : m;
    };
    P.st = { flown: false, landedT: 0 };
    const mo = (id, pulse) => ({ id, ts: 1, pulse });
    const M = { drive: mo('drive'), runway: mo('runway'), takeoff: mo('takeoff', { ts: 0.3, sec: 1.2 }), rings: mo('rings'), land: mo('land', { ts: 0.4, sec: 0.9 }) };
    P.momentAt = () => {
      if (car.flying) {
        P.st.flown = true;
        const aps = track.apron && track.apron.samples;
        const ap = aps && aps.length ? aps[Math.floor(aps.length / 2)].pos : null;
        const apronNear = ap ? Math.hypot(car.pos.x - ap.x, car.pos.z - ap.z) < 220 : false;
        return apronNear ? M.land : car.pos.y > (P.st.y0 ?? car.pos.y) + 2 || P.st.ring ? M.rings : M.takeoff;
      }
      if (P.st.flown) return M.land;
      return car.mode === 'fly' ? M.runway : M.drive;
    };
    P.strip = stripOf([['drive', '활주로로'], ['runway', '가속'], ['takeoff', '이륙'], ['rings', '고리 4개'], ['land', '착륙']]);
    const T = ctx.kbd('throttle'), C = ctx.K('climb'), Dv = ctx.K('dive');
    P.texts = (id, coach) =>
      coach
        ? { drive: ['활주로 쪽으로', ''], runway: [`${T} 꾹`, '94 km/h 넘으면'], takeoff: [`${C} 이륙!`, ''], rings: ['고리 가운데로', `${C} 위 · ${Dv} 아래`], land: ['착륙장에 부드럽게', ''] }[id]
        : {
            drive: ['활주로 입구로!', '본 도로에서 갈라져요'],
            runway: [`활주로 = 비행 모드 · ${T} 꾹`, '약 94 km/h를 넘기면 날 수 있어요'],
            takeoff: [`${C} 이륙!`, '기수를 들어 올려요'],
            rings: ['고리 가운데로', `다음 고리를 미리 보고 기울여요 · ${C} 위 · ${Dv} 아래`],
            land: ['착륙장에 내려요', '땅에 닿으면 저절로 차로 돌아와요'],
          }[id];
    P.driver = () => botDemoDriver(ctx);
    P.demoCtl = () => {};
    P.done = (m, dt) => P.st.flown && !car.flying && car.grounded && (P.st.landedT += dt || 1 / 60) > 0.6;
    P.end = 1e9;
    return P;
  },
  place(ctx, P) {
    P.st = { flown: false, landedT: 0, ring: 0 };
    ctx.placeRolling(P.i0, 0.9);
    P.st.y0 = ctx.car.pos.y;
  },
  task: (ctx) => `활주로에서 ${ctx.K('climb')} 이륙 → <b>고리 4개</b> → 착륙장`,
  goals: ['이륙', '고리 4개', '하늘길 안에서', '착륙'],
  cue: (P, id) => ({ drive: 'throttle', runway: 'throttle', takeoff: 'climb', rings: null, land: null })[id],
  judge(ctx, P) {
    const car = ctx.car;
    const nRings = (ctx.track.rings || []).length || 4;
    const X = { took: false, rings: 0, forced: false, landed: false, landT: 0, flewT: 0, groundT: 0, respawn: false };
    return {
      step(dt, seen) {
        if (seen.includes('respawn') || seen.includes('fall')) return (X.respawn = true), 'end';
        if (seen.includes('takeoff') || car.flying) X.took = true;
        for (const e of seen) if (e === 'ring') (X.rings++), (P.st.ring = X.rings);
        if (seen.includes('forceLand')) X.forced = true;
        if (car.flying) X.flewT += dt;
        if (X.took && !car.flying && car.grounded) {
          X.landT += dt;
          if (X.landT > 1.2) return (X.landed = true), 'end';
        } else X.landT = 0;
        if (!X.took) {
          X.groundT += dt;
          if (X.groundT > 22) return 'end';
        }
        return null;
      },
      prog: () => [X.took, X.rings >= nRings, X.took && !X.forced, X.landed],
      result() {
        const rows = [];
        rows.push(X.took ? row('take', 'ok', '이륙', '이륙 성공!') : row('take', 'bad', '이륙', `활주로에서 ${ctx.K('climb')}를 눌러 이륙해요`));
        rows.push(X.rings >= nRings ? row('ring', 'ok', `고리 ${nRings}개`, `${X.rings}개 모두 통과!`) : X.rings >= Math.ceil(nRings / 2) ? row('ring', 'meh', `고리 ${nRings}개`, `${X.rings} / ${nRings}개. 다음 고리를 미리 보고 기울여요`) : row('ring', 'bad', `고리 ${nRings}개`, `${X.rings} / ${nRings}개`));
        rows.push(!X.took ? row('zone', 'bad', '하늘길 안에서', '날아야 볼 수 있어요') : X.forced ? row('zone', 'bad', '하늘길 안에서', '하늘길을 벗어나 강제 착륙했어요') : row('zone', 'ok', '하늘길 안에서', '하늘길을 잘 따라갔어요'));
        rows.push(X.landed && !X.forced ? row('land', 'ok', '착륙', '부드럽게 착륙!') : X.landed ? row('land', 'meh', '착륙', '내리긴 했어요 (강제 착륙)') : row('land', 'bad', '착륙', '착륙하지 못했어요'));
        return { rows, respawn: X.respawn };
      },
    };
  },
};

// 11) 배 카빙 (바닷가) --------------------------------------------------------
RUN.boat = {
  demo: true,
  spot: (ctx) => ctx.spots.water,
  intro: (ctx) => `
    <p>물에 닿으면 저절로 <b>배</b>가 돼요. 배는 옆으로 잘 미끄러져서 크게 돌아요. 꺾으면서 ${ctx.K('drift')}를 누르면 <b>카빙</b>: 물을 파고들며 <b>훨씬 날카롭게</b> 돌아요.</p>
    ${steps([['①', `${ctx.kbd('throttle')}로 물까지`], ['②', '배로 변신 (자동)'], ['③', `굽은 곳에서 꺾으며 ${ctx.K('drift')}`], ['④', '펴지면 놓고 꾹']])}
    ${why('카빙 중엔 약 1.7배 빨리 돌지만 속도가 <b>조금</b> 줄어요. 그래서 <b>굽은 곳에서만 짧게</b> 쓰고 곧은 물에서는 놓아요. 물에서 액셀을 떼면 가라앉을 수 있어요.')}
    <p class="tut-tip">💡 물살 무늬가 휘는 곳 = 미리 카빙 준비.</p>`,
  plan(ctx, wr) {
    const { N, ds, W, track, car } = ctx;
    const iw0 = W(Math.round(wr.t0 * N)), iw1 = W(Math.round(wr.t1 * N));
    const P = { c: { num: 0, side: 1 }, N, ds, i0: W(iw0 - Math.round(150 / ds)), vMin: 0, side: 1, turnKey: 'right', outKey: 'left', badge: '🎬 시범 · 배 카빙' };
    P.dist = (idx) => {
      const m = W(idx - P.i0) * ds;
      return m > track.length / 2 ? m - track.length : m;
    };
    P.dW0 = P.dist(iw0);
    P.dW1 = P.dist(iw1);
    P.end = P.dW1 + 50;
    // 물 구간 목표 시간: 배 속도 계획 합 × 1.1
    const prof = car._lineProfile || (car.lineSpeed(0), car._lineProfile);
    let tt = 0;
    for (let i = iw0, n = 0; n < W(iw1 - iw0); i = W(i + 1), n++) tt += ds / Math.max(5, prof.speed[i]);
    // 계획은 배 최고 속도로 바로 들어간다고 보지만 실제로는 물에 들어가며 속도가 붙어야 해서 ×1.2 + 1초 (시범 운전 16.7초 / 계획 13.5초)
    P.waterTarget = tt * 1.2 + 1;
    const curv = ctx.line.curvature;
    // '굽은 곳' 기준: 이 물 구간에서 가장 많이 휜 곳의 45% 이상 (바닷가 물길은 반지름 90 m보다 완만해서 예전 기준으로는 카빙 순간이 한 번도 안 나왔음)
    let kMax = 0;
    for (let i = iw0, n = 0; n < W(iw1 - iw0); i = W(i + 1), n++) kMax = Math.max(kMax, Math.abs(curv[i]));
    const kTurn = Math.max(1 / 600, kMax * 0.45);
    const turning = () => {
      if (!car.trackInfo) return false;
      const i = car.trackInfo.index % N;
      for (let k = 0; k < Math.round(40 / ds); k++) if (Math.abs(curv[W(i + k)]) > kTurn) return true;
      return false;
    };
    const mo = (id, pulse) => ({ id, ts: 1, pulse });
    const MO = { shore: mo('shore'), splash: mo('splash', { ts: 0.35, sec: 1.0 }), straight: mo('straight'), carve: mo('carve', { ts: 0.35, sec: 1.1 }), out: mo('out') };
    P.momentAt = (m) => {
      if (m < P.dW0 - 15) return MO.shore;
      if (m > P.dW1) return MO.out;
      if (m < P.dW0 + 25) return MO.splash;
      return turning() ? MO.carve : MO.straight;
    };
    P.strip = stripOf([['shore', '물까지'], ['splash', '배 변신'], ['straight', '곧은 물'], ['carve', '카빙'], ['out', '땅으로']]);
    const T = ctx.kbd('throttle'), Dk = ctx.K('drift');
    P.texts = (id, coach) =>
      coach
        ? { shore: [`${T} 꾹`, ''], splash: ['배로 변신!', `${T} 계속`], straight: ['곧은 물 · 놓기', ''], carve: [`꺾으며 ${Dk}`, ''], out: ['땅으로!', ''] }[id]
        : {
            shore: [`${T} 꾹, 바다로!`, '물에 닿으면 저절로 배가 돼요'],
            splash: ['배로 변신!', '물에서는 액셀을 떼지 않아요'],
            straight: ['곧은 물에선 카빙 놓기', '카빙은 속도를 조금 깎아요'],
            carve: [`굽은 곳: 꺾으며 ${Dk} = 카빙`, '물을 파고들며 날카롭게 돌아요'],
            out: ['땅에 올라오면 다시 차로', ''],
          }[id];
    P.driver = () => lineDriver(ctx.game, { look: 0.16 });
    P.demoCtl = (c, cur) => {
      c.brake = 0;
      c.throttle = 1;
      c.drift = !!(cur && cur.id === 'carve' && Math.abs(c.steer) > 0.12);
    };
    return P;
  },
  place(ctx, P) {
    ctx.placeRolling(P.i0, 0.8, 18);
  },
  task: (ctx) => `물에서 굽은 곳마다 꺾으며 ${ctx.K('drift')} (카빙) → 빠르게 건너기`,
  goals: ['배로 변신', '카빙 쓰기', '물 구간 시간', '가라앉지 않기'],
  cue: (P, id) => ({ shore: 'throttle', splash: 'throttle', straight: 'throttle', carve: null, out: 'throttle' })[id],
  judge(ctx, P) {
    const car = ctx.car;
    const X = { boat: false, carveT: 0, tIn: null, tOut: null, t: 0, sink: false, respawn: false };
    return {
      step(dt, seen) {
        X.t += dt;
        if (seen.includes('sink')) X.sink = true;
        if (seen.includes('respawn') || seen.includes('fall')) return (X.respawn = true), 'end';
        if (car.mode === 'boat' || seen.includes('autoBoat')) {
          X.boat = true;
          if (X.tIn == null) X.tIn = X.t;
        }
        if ((car.boatCarve || 0) > 0.5 && car.mode === 'boat') X.carveT += dt;
        if (X.boat && X.tOut == null && car.mode !== 'boat' && car.grounded) X.tOut = X.t;
        if (!car.trackInfo) return null;
        const m = P.dist(car.trackInfo.index % P.N);
        if (m > P.end) return 'end';
        return null;
      },
      prog: () => [X.boat, X.carveT > 1, X.tOut != null && X.tOut - X.tIn <= P.waterTarget, X.boat && !X.sink],
      result() {
        const rows = [];
        rows.push(X.boat ? row('boat', 'ok', '배로 변신', '물에서 배가 됐어요') : row('boat', 'bad', '배로 변신', '물까지 못 갔어요'));
        rows.push(X.carveT >= 1 ? row('carve', 'ok', '카빙 쓰기', `카빙 ${t1(X.carveT)}초!`) : X.carveT >= 0.3 ? row('carve', 'meh', '카빙 쓰기', `${t1(X.carveT)}초만 썼어요. 굽은 곳마다 꺾으며 드리프트 키`) : row('carve', 'bad', '카빙 쓰기', `물 위에서 꺾으며 ${ctx.K('drift')}를 눌러 봐요`));
        const wt = X.tIn != null && X.tOut != null ? X.tOut - X.tIn : null;
        rows.push(wt == null ? row('time', 'bad', '물 구간 시간', '물을 끝까지 못 건넜어요') : wt <= P.waterTarget ? row('time', 'ok', '물 구간 시간', `${t1(wt)}초 (목표 ${t1(P.waterTarget)}초)`) : wt <= P.waterTarget * 1.12 ? row('time', 'meh', '물 구간 시간', `${t1(wt)}초 (목표 ${t1(P.waterTarget)}초). 카빙은 짧게`) : row('time', 'bad', '물 구간 시간', `${t1(wt)}초 (목표 ${t1(P.waterTarget)}초)`));
        rows.push(!X.boat ? row('sink', 'bad', '가라앉지 않기', '물까지 못 갔어요') : X.sink || X.respawn ? row('sink', 'bad', '가라앉지 않기', '가라앉았어요. 물에서는 액셀을 계속') : row('sink', 'ok', '가라앉지 않기', '끝까지 떠서 건넜어요'));
        return { rows, respawn: X.respawn };
      },
    };
  },
};

// 시험 전용: 깔끔한 한 바퀴 (S 라이선스) ------------------------------------------
RUN.lap = {
  demo: false,
  standing: true,
  spot: (ctx) => (ctx.line ? { lap: true } : null),
  intro: (ctx, s, target) => `
    <p>출발 신호부터 <b>한 바퀴</b>. 복귀(R) 없이, 잔디는 거의 밟지 않고, <b>${fmt(target)}</b> 안에 들어오면 합격이에요.</p>
    ${steps([['①', '불이 꺼지면 출발'], ['②', '배운 것 모두: 브레이크·에이펙스·탈출'], ['③', '잔디 · 복귀 없이'], ['④', `목표 ${fmt(target)}`]])}
    <p class="tut-tip">💡 한 바퀴가 끝나면 바로 성적표가 나와요. 무리하지 말고 깔끔하게!</p>`,
  target(ctx) {
    // 목표 = 이 차 레이싱 라인 속도 계획 시간 × 1.06 + 출발 3초 (계획 시간은 '완벽한 운전'이라 사람에게는 빡빡함)
    const prof = ctx.car._lineProfile || (ctx.car.lineSpeed(0), ctx.car._lineProfile);
    let t = 0;
    for (let i = 0; i < ctx.N; i++) t += ctx.ds / Math.max(5, prof.speed[i]);
    return Math.round((t * 1.06 + 3) * 10) / 10;
  },
  plan: (ctx) => ({ lap: true, end: 1e9, N: ctx.N, ds: ctx.ds, i0: 0, dist: () => 0, c: { num: 0, side: 1 }, side: 1 }),
  task: (ctx, P) => `깔끔한 한 바퀴 · 목표 <b>${fmt(P.target)}</b>`,
  goals: ['완주', '복귀 없이', '잔디 거의 없이', '목표 시간'],
  judge(ctx, P) {
    const car = ctx.car, race = ctx.race;
    const X = { respawns: 0, offT: 0, time: null };
    return {
      step(dt, seen) {
        if (seen.includes('respawn') || seen.includes('fall')) X.respawns++;
        if (race.phase === 'racing' && (car.offK || 0) > 0.6 && car.grounded) X.offT += dt;
        if (race.lapTimes && race.lapTimes.length >= 1) return (X.time = race.lapTimes[0]), 'end';
        return null;
      },
      prog: () => [X.time != null, X.respawns === 0, X.offT < 1, X.time != null && X.time <= P.target],
      result() {
        const rows = [];
        rows.push(X.time != null ? row('done', 'ok', '완주', `한 바퀴 ${fmt(X.time)}`) : row('done', 'bad', '완주', '한 바퀴를 못 끝냈어요'));
        rows.push(X.respawns === 0 ? row('resp', 'ok', '복귀 없이', '복귀 없이 달렸어요') : row('resp', 'bad', '복귀 없이', `복귀 ${X.respawns}번`));
        rows.push(X.offT < 1 ? row('off', 'ok', '잔디 거의 없이', `잔디 ${t1(X.offT)}초`) : X.offT < 3 ? row('off', 'meh', '잔디 거의 없이', `잔디 ${t1(X.offT)}초 (1초 안이면 ✓)`) : row('off', 'bad', '잔디 거의 없이', `잔디 ${t1(X.offT)}초`));
        rows.push(X.time == null ? row('time', 'bad', '목표 시간', '—') : X.time <= P.target ? row('time', 'ok', '목표 시간', `${fmt(X.time)} ≤ ${fmt(P.target)}`) : X.time <= P.target * 1.03 ? row('time', 'meh', '목표 시간', `${fmt(X.time)} (목표 ${fmt(P.target)}, ${t1(X.time - P.target)}초 모자람)`) : row('time', 'bad', '목표 시간', `${fmt(X.time)} (목표 ${fmt(P.target)})`));
        return { rows, respawn: false };
      },
    };
  },
};

// ------------------------------------------------------------------ 작은 도우미 (HTML)
export function fmt(t) {
  if (t == null || !isFinite(t)) return '—';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function steps(list) {
  return `<div class="ac-steps">${list.map(([n, t]) => `<div><span>${n}</span><em>${t}</em></div>`).join('')}</div>`;
}
function why(html) {
  return `<div class="ac-why"><b>🔬 차는 이렇게 움직여요</b><p>${html}</p></div>`;
}
