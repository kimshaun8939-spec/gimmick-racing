// 봇이 그랑프리 마지막 판자 지름길(track.plank)을 타게 하는 길·운전 (2026-11-14, 사용자 요청 "마지막 지름길을 봇이 안 타서 많이 느려짐")
//   사람과 같은 길: 레이싱 라인 → (매끈한 곡선) → 판자 가운데 선 → (매끈한 곡선) → 레이싱 라인
//   차 성능은 그대로, 이 길의 굽은 정도와 이 차의 접지력·제동력으로 속도 계획 (비행 루트 들어가는 길과 같은 방식)
//   길 모양은 트랙마다 한 번 자동으로 찾음 (여러 진입·탈출 거리 중 차 폭이 도로/판자 안에 있고 가장 빠른 것)
//   &plank=0 이면 끔
import * as THREE from 'three';
import { lineCarModel } from './car.js';

const cache = new WeakMap();
/** 시험용 통계: 시작·끝까지·놓침 */
export const stats = { on: 0, done: 0, lost: 0, why: [] };
if (typeof window !== 'undefined') window.__scStats = stats;
const OFF = typeof location !== 'undefined' && /[?&]plank=0\b/.test(location.search);

function hermite(P0, T0, P1, T1, n, out) {
  const chord = Math.hypot(P1.x - P0.x, P1.z - P0.z);
  for (let k = 0; k <= n; k++) {
    const u = k / n, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    out.push(new THREE.Vector3(
      h00 * P0.x + h10 * chord * T0.x + h01 * P1.x + h11 * chord * T1.x,
      P0.y + (P1.y - P0.y) * u,
      h00 * P0.z + h10 * chord * T0.z + h01 * P1.z + h11 * chord * T1.z,
    ));
  }
}
/** 1 m 간격으로 다시 나눔 + 굽은 정도(오른쪽 +) */
function resample(raw) {
  const ap = [raw[0].clone()];
  let carry = 0;
  for (let k = 1; k < raw.length; k++) {
    const a = raw[k - 1], b = raw[k], seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg < 1e-6) continue;
    let u = 1 - carry;
    while (u <= seg) {
      ap.push(a.clone().lerp(b, u / seg));
      u += 1;
    }
    carry = seg - (u - 1);
  }
  const n = ap.length, kap = new Float32Array(n), H = 6;
  for (let k = 0; k < n; k++) {
    const a = ap[Math.max(0, k - H)], b = ap[k], c = ap[Math.min(n - 1, k + H)];
    const t1x = b.x - a.x, t1z = b.z - a.z, t2x = c.x - b.x, t2z = c.z - b.z;
    const l1 = Math.hypot(t1x, t1z) || 1, l2 = Math.hypot(t2x, t2z) || 1;
    kap[k] = Math.atan2((t1x * t2z - t1z * t2x) / (l1 * l2), (t1x * t2x + t1z * t2z) / (l1 * l2)) / Math.max(1, (l1 + l2) / 2);
  }
  const kapS = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0, m = 0;
    for (let q = Math.max(0, k - 5); q <= Math.min(n - 1, k + 5); q++) (s += kap[q]), m++;
    kapS[k] = s / m;
  }
  return { ap, kap: kapS };
}
/** 속도 계획 (m/s): 이 차의 옆 한계(속도에 따라, 다운포스)·제동(×brK)·가속(시작 속도 v0부터) */
function speedPlan(kap, cm, latK = 1, brK = 0.8, v0 = Infinity) {
  const n = kap.length, v = new Float32Array(n), vMax = cm.vMax || 90;
  for (let k = 0; k < n; k++) {
    const kk = Math.max(1e-4, Math.abs(kap[k]));
    let x = 40;
    for (let it = 0; it < 4; it++) x = Math.min(vMax, Math.sqrt((cm.aLat(x) * latK) / kk));
    v[k] = x;
  }
  for (let k = n - 2; k >= 0; k--) v[k] = Math.min(v[k], Math.sqrt(v[k + 1] * v[k + 1] + 2 * cm.aBrake(v[k + 1]) * brK));
  if (v0 < Infinity) {
    v[0] = Math.min(v[0], v0);
    for (let k = 1; k < n; k++) v[k] = Math.min(v[k], Math.sqrt(v[k - 1] * v[k - 1] + 2 * Math.max(0.3, cm.aAcc(v[k - 1]))));
  }
  return v;
}

/** 트랙마다 지름길 길 하나 (없거나 이득이 없으면 null) */
export function shortcutPlan(track, prof, cm) {
  if (OFF) return null;
  if (cache.has(track)) return cache.get(track);
  let best = null;
  try {
    best = build(track, prof, cm);
  } catch (e) {
    console.warn('[botShortcut]', e);
  }
  cache.set(track, best);
  return best;
}

function build(track, prof, cm) {
  const P = track.plank, L = track.racingLine;
  if (!P || !L || !P.samples || P.samples.length < 10 || !track.samples) return null;
  const S = track.samples, N = L.N, ds = track.length / N, HW = (track.width || 17) / 2;
  const W = (i) => ((i % N) + N) % N;
  const ps = P.samples, d0 = ps[0].dist, d1 = ps[ps.length - 1].dist;
  // 판자 양 끝이 코스 어디쯤인지 (근처만 찾아서 빠르게)
  const near = (p, lo, hi) => {
    let bd = Infinity, bi = lo;
    for (let i = lo; i <= hi; i++) {
      const s = S[W(i)].pos, d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2 + 3 * (s.y - p.y) ** 2;
      if (d < bd) (bd = d), (bi = i);
    }
    const s = S[W(bi)];
    return { i: bi, lat: (p.x - s.pos.x) * s.right.x + (p.z - s.pos.z) * s.right.z, dist: Math.hypot(p.x - s.pos.x, p.z - s.pos.z) };
  };
  const g0 = (() => { // 전체에서 한 번
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i++) {
      const s = S[i].pos, d = (s.x - ps[0].pos.x) ** 2 + (s.z - ps[0].pos.z) ** 2 + 3 * (s.y - ps[0].pos.y) ** 2;
      if (d < bd) (bd = d), (bi = i);
    }
    return bi;
  })();
  const ia = g0, ib = near(ps[ps.length - 1].pos, ia, ia + Math.round(400 / ds)).i;
  const lineP = (j) => new THREE.Vector3(L.x[W(j)], S[W(j)].pos.y, L.z[W(j)]);
  const lineT = (j) => new THREE.Vector3(L.x[W(j + 1)] - L.x[W(j - 1)], 0, L.z[W(j + 1)] - L.z[W(j - 1)]).normalize();
  const plankAt = (d) => {
    let k = 0;
    while (k < ps.length - 2 && ps[k + 1].dist < d) k++;
    const a = ps[k], b = ps[k + 1], u = THREE.MathUtils.clamp((d - a.dist) / Math.max(1e-6, b.dist - a.dist), 0, 1);
    return a.pos.clone().lerp(b.pos, u);
  };
  const pdir = ps[ps.length - 1].pos.clone().sub(ps[0].pos).setY(0).normalize();
  // 차 폭(옆 1.1 m)이 도로(연석 포함) 또는 판자 위인가
  const onPlank = (p) => {
    let bd = Infinity;
    for (let k = 0; k < ps.length - 1; k++) {
      const a = ps[k].pos, b = ps[k + 1].pos, abx = b.x - a.x, abz = b.z - a.z;
      const u = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1), 0, 1);
      bd = Math.min(bd, Math.hypot(p.x - (a.x + abx * u), p.z - (a.z + abz * u)));
    }
    return bd < P.half - 0.3;
  };
  const okPoint = (p) => {
    const r = near(p, ia - Math.round(250 / ds), ib + Math.round(250 / ds));
    if (r.dist < HW + track.kerbAt(W(r.i), r.lat < 0 ? -1 : 1) * 0.6) return true;
    return onPlank(p);
  };
  const sp = prof && prof.speed;
  const lineTime = (ja, jb) => {
    let t = 0;
    for (let j = ja; j < jb; j++) {
      const dl = Math.hypot(L.x[W(j + 1)] - L.x[W(j)], L.z[W(j + 1)] - L.z[W(j)]);
      t += dl / Math.max(5, sp ? sp[W(j)] : 40);
    }
    return t;
  };
  let best = null;
  for (const BL of [40, 60, 80, 105, 130, 160]) for (const BX of [35, 55, 80, 110, 140, 175, 210]) for (const E of [4, 10, 18]) {
    const jA = ia - Math.round(BL / ds), jB = ib + Math.round(BX / ds);
    const raw = [];
    for (let j = jA - Math.round(40 / ds); j < jA; j++) raw.push(lineP(j));
    const pIn = plankAt(d0 + E), pOut = plankAt(d1 - E);
    if (pIn.distanceTo(pOut) < 20) continue;
    hermite(lineP(jA), lineT(jA), pIn, pdir, 50, raw);
    for (const q of ps) if (q.dist > d0 + E + 0.5 && q.dist < d1 - E - 0.5) raw.push(q.pos);
    hermite(pOut, pdir, lineP(jB), lineT(jB), 50, raw);
    for (let j = jB + 1; j <= jB + Math.round(30 / ds); j++) raw.push(lineP(j));
    const { ap, kap } = resample(raw);
    // 차 폭 확인 (3 m마다, 가운데와 양옆)
    let ok = true;
    for (let k = 0; k < ap.length && ok; k += 3) {
      const a = ap[Math.max(0, k - 1)], b = ap[Math.min(ap.length - 1, k + 1)];
      const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1, rx = -tz / tl, rz = tx / tl;
      for (const o of [-1.1, 0, 1.1]) if (!okPoint(new THREE.Vector3(ap[k].x + rx * o, ap[k].y, ap[k].z + rz * o))) { ok = false; break; }
    }
    if (!ok) continue;
    // 이 차로 달린 시간 (라인 같은 구간의 계획 시간보다 빨라야 씀)
    const lead = Math.round(40 / ds);
    const v = speedPlan(kap, cm, 0.95, 0.8, sp ? sp[W(jA - lead)] : Infinity);
    let t = 0;
    for (let k = 0; k < ap.length - 1; k++) t += 1 / Math.max(5, v[k]);
    const base = lineTime(jA - lead, jB + Math.round(30 / ds));
    const gain = base - t;
    if (!best || gain > best.gain) best = { gain, ap, kap, jStart: W(jA - lead), jEnd: W(jB), BL, BX, E, len: ap.length };
  }
  if (!best || best.gain < 0.25) return null;
  const mark = (path) => {
    let a = -1, b = -1;
    for (let k = 0; k < path.ap.length; k++) if (onPlank(path.ap[k])) (a < 0 && (a = k)), (b = k);
    path.plankFrom = a < 0 ? 0 : a;
    path.plankTo = b < 0 ? path.ap.length - 1 : b;
    return path;
  };
  mark(best);
  best.ia = ia;
  // 봇마다 지금 자리·방향에서 판자로 가는 길 (옆 차선에 있거나 추월 중이어도 그 자리에서 매끈하게)
  //   차 폭이 도로/판자 밖으로 나가면 null. 탈출 쪽은 위에서 고른 BX 그대로
  const jB = ib + Math.round(best.BX / ds);
  best.jTail = W(jB + Math.round(30 / ds));
  best.fromHere = (pos, dir) => {
    for (const E of [best.E, 10, 18, 4]) {
      const pIn = plankAt(d0 + E), pOut = plankAt(d1 - E);
      if (pIn.distanceTo(pOut) < 20) continue;
      const raw = [];
      hermite(pos, dir, pIn, pdir, 60, raw);
      for (const q of ps) if (q.dist > d0 + E + 0.5 && q.dist < d1 - E - 0.5) raw.push(q.pos);
      hermite(pOut, pdir, lineP(jB), lineT(jB), 50, raw);
      for (let j = jB + 1; j <= jB + Math.round(30 / ds); j++) raw.push(lineP(j));
      const r = resample(raw);
      let ok = true;
      for (let k = 6; k < r.ap.length && ok; k += 3) {
        const a = r.ap[Math.max(0, k - 1)], b = r.ap[Math.min(r.ap.length - 1, k + 1)];
        const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1, rx = -tz / tl, rz = tx / tl;
        for (const o of [-1.1, 0, 1.1]) if (!okPoint(new THREE.Vector3(r.ap[k].x + rx * o, r.ap[k].y, r.ap[k].z + rz * o))) { ok = false; break; }
      }
      if (ok) return mark(r);
    }
    return null;
  };
  best.lineTime = lineTime;
  return best;
}

/**
 * 봇 하나의 지름길 운전. controls(ctx) 맨 앞에서 부름 → 지름길 위면 조작(c)을, 아니면 null
 * env = { car, track, cm, level, pace, thrK, st, queueSpeed, i0 → 레이싱 라인 칸, onRelease(i0) }
 */
export function createShortcutDriver(env) {
  const { car, track, level, pace, st } = env;
  const cm = lineCarModel(car.cfg); // 실제 조향 한계에 맞는 차 모델 (마스터 계획 모델은 이 길에서 너무 빨라 못 돌았음)
  if (typeof window !== 'undefined' && window.__plankOff) return null; // 테스트용 비교
  // 쉬움 봇은 안 탐 (처음 하는 사람처럼; 쉬움은 초보가 이길 수 있어야 함). level.plank로 따로 정할 수 있음
  if (env.level.plank === false) return null;
  const plan = shortcutPlan(track, env.prof, cm);
  if (!plan) return null;
  const N = track.racingLine.N, ds = track.length / N;
  const W = (i) => ((i % N) + N) % N;
  const latK = (level.plankLatK ?? (level.master ? 0.95 : 0.9)) * Math.min(1, pace);
  // 쉬움 봇은 직선 속도도 낮게 달리므로 지름길 위에서도 그만큼 (봇마다 실력 차이 유지)
  const topK = level.topK ? Math.min(1, level.topK * (pace / level.pace)) : 1;
  const sp = env.prof && env.prof.speed;
  let A = plan.ap, n = A.length, V = null, P = plan;
  const tmpDir = new THREE.Vector3();
  /** 지금 자리에서 길을 만들고, 라인으로 가는 것보다 빠르면 씀 */
  function tryEngage(i0, speed) {
    const vd = car.vel.lengthSq() > 4 ? tmpDir.set(car.vel.x, 0, car.vel.z) : tmpDir.set(car.fwd.x, 0, car.fwd.z);
    const path = plan.fromHere(car.pos, vd.normalize());
    if (!path) return (stats.noPath = (stats.noPath || 0) + 1), false;
    const v = speedPlan(path.kap, cm, latK, 0.8, Math.max(5, speed));
    let t = 0;
    for (let k = 0; k < path.ap.length - 1; k++) t += 1 / Math.max(5, v[k] * (topK < 1 ? 0.97 : 1));
    // 라인으로 갈 때 시간: 같은 방식(같은 차 모델·같은 시작 속도)으로 계산해서 비교
    const L = track.racingLine, raw = [];
    const jT = plan.jTail < i0 ? plan.jTail + N : plan.jTail;
    for (let j = i0; j <= jT; j++) raw.push(new THREE.Vector3(L.x[W(j)], 0, L.z[W(j)]));
    const lr = resample(raw);
    const lv = speedPlan(lr.kap, cm, latK, 0.8, Math.max(5, speed));
    let tl = 0;
    for (let k = 0; k < lr.ap.length - 1; k++) tl += 1 / Math.max(5, lv[k] * (topK < 1 ? 0.97 : 1));
    if (t > tl - 0.25) return (stats.slower = stats.slower || []).length < 30 && stats.slower.push(`${t.toFixed(2)}/${tl.toFixed(2)}@${Math.round(W(plan.ia - i0) * ds)}`), false;
    P = path;
    A = path.ap;
    n = A.length;
    V = speedPlan(path.kap, cm, latK, 0.8);
    return true;
  }
  /** 이 길 위(가운데 선에서 2.6 m 안)에서 바로 앞에 있는 차 뒤에 줄 섬 (본 도로에서 시케인 제동 중인 차는 안 봄) */
  function pathQueue(ctx, bi, speed) {
    let f = Infinity;
    for (const o of ctx.others) {
      if (!o.pos) continue;
      let od = Infinity, ok = -1;
      for (let k = Math.max(0, bi - 4); k < Math.min(n, bi + 70); k += 2) {
        const d = (A[k].x - o.pos.x) ** 2 + (A[k].z - o.pos.z) ** 2;
        if (d < od) (od = d), (ok = k);
      }
      if (ok < 0 || od > 3.2 * 3.2 || Math.abs(o.pos.y - A[ok].y) > 4) continue;
      const gap = ok - bi; // m (나란히 = 0 근처: 길에서 조금이라도 앞선 차가 먼저 판자에 들어가고 나는 뒤로 빠짐)
      if (gap < 0.5 || gap > 10 + 0.5 * Math.max(0, speed)) continue;
      f = Math.min(f, Math.sqrt(o.speed * o.speed * (level.master ? 1 : 0.8) + 2 * 6 * Math.max(0, gap - 7)), gap < 7 ? o.speed - 2 : Infinity);
    }
    return f;
  }
  return function shortcutControls(ctx, c, i0, speed) {
    if (!st.sc) {
      const dI = W(plan.ia - i0) * ds; // 판자 입구까지 남은 거리 (라인 기준)
      if (dI > 175 || dI < 55 || !car.grounded || !(car.mode === 'normal' || car.mode === 'accel') || st.fly) {
        if (dI > 175) st.scTry = 0;
        return null;
      }
      st.scTry = (st.scTry || 0) - ctx.dt;
      if (st.scTry > 0) return null;
      st.scTry = 0.1;
      if (!tryEngage(i0, speed)) {
        stats.skip = (stats.skip || 0) + (dI < 60 ? 1 : 0);
        return null;
      }
      st.sc = 'on';
      stats.on++;
      st.scI = 0;
      st.scT = 0;
      st.scFx = st.scYaw = null;
    }
    st.scT += ctx.dt;
    let bi = st.scI, bd = Infinity;
    for (let k = Math.max(0, st.scI - 5); k < Math.min(n, st.scI + 60); k++) {
      const d = (A[k].x - car.pos.x) ** 2 + (A[k].z - car.pos.z) ** 2;
      if (d < bd) (bd = d), (bi = k);
    }
    st.scI = bi;
    // 끝 / 밀려남 / 막힘 / 공중이 오래 → 땅 운전으로
    const lost = bd > (bi > P.plankFrom - 15 && bi < P.plankTo ? 4.5 : 12) ** 2;
    if (bi >= n - 12 || lost || st.scT > 12 || car.mode === 'boat' || car.mode === 'fly') {
      st.sc = null;
      if (bi >= n - 12) stats.done++;
      else (stats.lost++, stats.why.push((lost ? 'lost@' : 'time/mode@') + bi + '/' + Math.sqrt(bd).toFixed(1)));
      env.onRelease && env.onRelease(i0);
      return null;
    }
    // 조향: 원하는 회전 속도(길 굽은 정도×속도 + 앞 점 쫓기) ÷ 핸들 1일 때 회전 속도 (bots.js 땅 운전과 같은 식 = 차마다 맞음)
    const v = Math.max(8, Math.abs(speed));
    const look = Math.round(5 + v * 0.3);
    const tp = A[Math.min(n - 1, bi + look)];
    const kf = P.kap[Math.min(n - 1, bi + Math.round(v * 0.12))];
    const fl = Math.hypot(car.fwd.x, car.fwd.z) || 1, fx = car.fwd.x / fl, fz = car.fwd.z / fl;
    const dx = tp.x - car.pos.x, dz = tp.z - car.pos.z, dl = Math.hypot(dx, dz) || 1;
    const hd = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
    const yawDes = kf * v + (2 * v * Math.sin(hd)) / Math.max(6, dl);
    const cfg = car.cfg;
    const dfz = cfg.aero.downforce * Math.min(1.6, (v / cfg.maxSpeed) ** 2);
    const latCap = Math.max(0.5 * cfg.steerLat, cfg.steerLat * (1 + (cfg.steerLatDownforce || 0) * dfz) * (1 - (cfg.steerLatLoad || 0) * (car.load || 0)));
    const perSteer = cfg.steerRate * Math.min(1, v / 8) * Math.min(1, latCap / (cfg.steerRate * v));
    const yawNow = st.scFx == null ? car.yawRate || 0 : Math.atan2(st.scFx * fz - st.scFz * fx, st.scFx * fx + st.scFz * fz) / Math.max(0.001, ctx.dt);
    st.scYaw = (st.scYaw ?? yawNow) + (yawNow - (st.scYaw ?? yawNow)) * Math.min(1, ctx.dt * 14);
    st.scFx = fx;
    st.scFz = fz;
    c.steer = Math.max(-1, Math.min(1, (yawDes + 0.45 * (yawDes - st.scYaw) - 0.8 * (car.slip || 0)) / Math.max(0.05, perSteer)));
    let tgt = Infinity;
    const reach = Math.min(n - 1, bi + Math.round((speed * speed) / (2 * 0.8 * cm.aBrake(30)) + 10));
    for (let k = bi + 2; k <= reach; k++) tgt = Math.min(tgt, Math.sqrt(V[k] * V[k] + 2 * 0.8 * cm.aBrake(V[k]) * (k - bi - 2)));
    tgt = Math.min(tgt, V[bi], pathQueue(ctx, bi, speed));
    if (topK < 1 && env.vTop) tgt = Math.min(tgt, env.vTop * topK);
    if (speed > tgt + 0.4) {
      c.throttle = 0;
      c.brake = Math.max(0, Math.min(1, (speed - tgt) / 3));
    } else c.throttle = Math.min(1, env.thrK);
    st.dbg = { sc: bi, tgt: +tgt.toFixed(1) };
    return c;
  };
}
