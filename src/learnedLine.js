// 학습 라인 (2026-11-14 learned, 사용자 "레이싱 라인을 억지로 따라가지 말고, 코너마다 실제로 빠른 방법을 연구"):
//   레이싱 라인(K1999, 가장 덜 휘는 길) + 차 모델 속도 계획은 실제 차 물리로 가장 빠른 길이 아닌 코너가 많음.
//   .debug/line_opt.cjs가 실제 물리(game.simulate) + 봇 운전으로 코너마다 '옆으로 얼마나 비킬지·코너 속도·브레이크 세기'를 찾아
//   data/lines/<맵>.json에 저장 → 봇이 그 맵·차(또는 등급)의 학습 라인을 따라감. 차 성능·물리·견인·슬립스트림·DRS는 그대로.
//   &learned=0 = 예전 (K1999 라인 그대로)
//
// 파일 형식 (data/lines/<맵>.json):
//   { v: 1, map, N, len, hash,            ← 맵의 원래 레이싱 라인 (N·길이·옆 위치 합) — 맵이 바뀌면 hash가 달라져 안 씀
//     sets: { <차 id 또는 등급 A/B/C>: { src: 학습한 차, segs: [ { i0, off: [cm, ...], vs: { hard: [‰...], master: [...] }, bk: { hard: [‰...], ... } } ] } } }
//   off = 원래 라인에서 옆으로 비킨 거리 (cm, + 오른쪽), i0부터 한 칸(샘플)씩
//   vs  = 그 지점 코너 한계 속도 배수 (‰, 1000 = 그대로), bk = 브레이크 감속 배수 (‰)
//   sm  = (선택) 속도 계획 곡률을 잴 창 (m, 앞뒤; 숫자 또는 { hard, master }), 없으면 원래 5 m = 짧은 꺾임을 급코너로 안 봄
//   단계 키가 없으면 가까운 단계 (master → hard → 1000). 쉬움·보통은 set.levels에 있을 때만 (없으면 원래 라인)
//   차 칸 { ref: '<다른 칸>', skip: [단계...] } = 다른 칸을 같이 씀, skip 단계는 원래 라인
import { lineCarModel } from './car.js';

const Q = (() => { try { return new URLSearchParams((typeof location !== 'undefined' && location.search) || ''); } catch { return new URLSearchParams(''); } })();
export const LEARNED_ON = Q.get('learned') !== '0';
const MAP_FILE = { gp: 'gp', grandprix: 'gp' };
let DATA = null, CLASS_OF = {};
if (LEARNED_ON) {
  const map = Q.get('map');
  if (map && /^[a-z0-9_-]+$/i.test(map)) {
    try {
      const [d, cars] = await Promise.all([
        fetch(new URL(`../data/lines/${MAP_FILE[map] || map}.json`, import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(new URL('../data/cars.json', import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      DATA = d;
      for (const c of (cars && cars.cars) || []) CLASS_OF[c.id] = c.class;
    } catch { DATA = null; }
  }
}

/** 봇 단계 이름 (BOT_LEVELS 객체에서) */
export function levelKey(level) {
  if (!level) return 'hard';
  if (level.master) return 'master';
  if (level.pace >= 1) return 'hard';
  if (level.pace > 0.8) return 'normal';
  return 'easy';
}

/** 원래 라인의 지문 (맵이 바뀌면 달라짐) */
export function lineHash(base) {
  let h = 0;
  for (let i = 0; i < base.N; i++) h += Math.round(base.offset[i] * 100) * ((i % 97) + 1);
  return h;
}

const W = (i, N) => ((i % N) + N) % N;

/**
 * 원래 라인 base에서 옆으로 delta[i] m 비킨 새 라인 (computeRacingLine 결과와 같은 모양)
 *   vs[i] = 코너 한계 속도 배수, bk[i] = 브레이크 감속 배수 (없으면 1)
 */
export function buildLine(track, base, delta, vs, bk, sm) {
  const N = base.N, ds = track.length / N, S = track.samples;
  const offset = new Float32Array(N), x = new Float32Array(N), z = new Float32Array(N);
  let any = false;
  for (let i = 0; i < N; i++) {
    let d = delta ? delta[i] : 0;
    if (d) {
      const o = Math.min(base.hi[i], Math.max(base.lo[i], base.offset[i] + d));
      d = o - base.offset[i];
    }
    offset[i] = base.offset[i] + d;
    x[i] = base.x[i] + S[i].right.x * d;
    z[i] = base.z[i] + S[i].right.z * d;
    if (d) any = true;
  }
  // 곡률·구간 길이: 비킨 곳 근처만 다시 (나머지는 원래 값 = 달 루프처럼 특별히 옮긴 곳도 그대로)
  const k = Math.max(2, Math.round(5 / ds));
  const curvature = Float32Array.from(base.curvature), seg = Float32Array.from(base.seg);
  if (any) {
    const near = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (offset[i] !== base.offset[i]) for (let j = -k - 2; j <= k + 2; j++) near[W(i + j, N)] = 1;
    const head = (i) => { const a = W(i - 1, N), b = W(i + 1, N); return Math.atan2(x[b] - x[a], z[b] - z[a]); };
    for (let i = 0; i < N; i++) {
      if (!near[i]) continue;
      let d = head(W(i + k, N)) - head(W(i - k, N));
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      let Ls = 0;
      for (let j = i - k; j < i + k; j++) Ls += Math.hypot(x[W(j + 1, N)] - x[W(j, N)], z[W(j + 1, N)] - z[W(j, N)]);
      curvature[i] = d / Math.max(0.5, Ls);
      seg[i] = Math.max(0.05, Math.hypot(x[W(i + 1, N)] - x[i], z[W(i + 1, N)] - z[i]));
    }
  }
  // 속도 계획용 곡률 (sm[i] m 창): K1999 라인은 샘플 단위로 살짝 꺾이는 곳이 있어(도로 폭이 바뀌는 곳 등) 그 꺾임이 짧은 급코너로 보임.
  //   실제 차는 그런 짧은 꺾임을 따라가지 않고 매끈하게 지나감 → 그곳은 더 긴 창(앞뒤 sm m)의 방향 변화로 곡률을 잼. 조향용 curvature는 그대로
  let planCurv = curvature;
  if (sm && sm.some((m) => m > 5.5)) {
    planCurv = Float32Array.from(curvature);
    const head = (i) => { const a = W(i - 1, N), b = W(i + 1, N); return Math.atan2(x[b] - x[a], z[b] - z[a]); };
    for (let i = 0; i < N; i++) {
      if (!(sm[i] > 5.5)) continue;
      const kk = Math.max(k, Math.round(sm[i] / ds));
      let d = head(W(i + kk, N)) - head(W(i - kk, N));
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      let Ls = 0;
      for (let j = i - kk; j < i + kk; j++) Ls += Math.hypot(x[W(j + 1, N)] - x[W(j, N)], z[W(j + 1, N)] - z[W(j, N)]);
      planCurv[i] = d / Math.max(0.5, Ls);
    }
  }
  const bank = new Float32Array(N), water = new Uint8Array(N);
  let wet = false;
  for (let i = 0; i < N; i++) {
    bank[i] = S[i].roll ? 0 : S[i].bank || 0;
    if (S[i].water) (water[i] = 1), (wet = true);
  }
  // racingLine.js profile()와 같은 계산 + vs·bk
  function profile(car) {
    const isWet = (i) => wet && !!water[i] && !!car.boat;
    const M = (i) => (isWet(i) ? car.boat : car);
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const c = Math.abs(planCurv[i]);
      const bankLat = car.bankGrip ? 9.81 * Math.sin(bank[i]) * Math.sign(planCurv[i]) * car.bankGrip : 0;
      const m = M(i), bl = isWet(i) ? 0 : bankLat;
      let s = m.vMax;
      for (let r = 0; r < 4; r++) s = Math.min(m.vMax, c > 1e-5 ? Math.sqrt(Math.max(m.aLat(s) * 0.5, m.aLat(s) + bl) / c) : m.vMax);
      v[i] = vs ? Math.min(m.vMax, s * vs[i]) : s;
    }
    const fwd = Float32Array.from(v);
    for (let lap = 0; lap < 2; lap++)
      for (let n = 0; n < N; n++) {
        const p = W(n - 1, N);
        fwd[n] = Math.min(fwd[n], Math.sqrt(fwd[p] * fwd[p] + 2 * M(p).aAcc(fwd[p]) * seg[p]));
      }
    const out = Float32Array.from(fwd);
    for (let lap = 0; lap < 2; lap++)
      for (let n = N - 1; n >= 0; n--) {
        const nx = W(n + 1, N);
        out[n] = Math.min(out[n], Math.sqrt(out[nx] * out[nx] + 2 * M(n).aBrake(out[nx]) * (bk ? bk[n] : 1) * seg[n]));
      }
    const brake = new Uint8Array(N);
    for (let i = 0; i < N; i++) brake[i] = out[i] < fwd[i] - 0.3 ? 1 : 0;
    return { speed: out, brake };
  }
  return { N, offset, lo: base.lo, hi: base.hi, x, z, curvature, planCurv, seg, apexes: base.apexes, profile, learned: true, base, delta, vs, bk, sm };
}

/** 저장 형식(segs) → 지점별 배열 */
export function expandSegs(N, segs, lvl) {
  const delta = new Float32Array(N), vs = new Float32Array(N).fill(1), bk = new Float32Array(N).fill(1), sm = new Float32Array(N);
  const pick = (o) => (o ? o[lvl] || (lvl === 'master' ? o.hard : o.hard || o.master) || null : null); // 없는 단계는 어려움 값 (마스터는 어려움)
  for (const s of segs || []) {
    const v = pick(s.vs), b = pick(s.bk), m = s.sm ? (typeof s.sm === 'number' ? s.sm : pick(s.sm)) : 0;
    for (let j = 0; j < s.off.length; j++) {
      const i = W(s.i0 + j, N);
      delta[i] = s.off[j] / 100;
      if (v) vs[i] = v[j] / 1000;
      if (b) bk[i] = b[j] / 1000;
      if (m) sm[i] = m;
    }
  }
  return { delta, vs, bk, sm };
}

const cache = new WeakMap();
/**
 * 봇이 쓸 학습 라인 (없으면 null = 원래 라인)
 * @param track 트랙, cfg 봇 차 설정 (cfg.carId), level BOT_LEVELS 단계
 */
export function learnedLineFor(track, cfg, level) {
  if (!LEARNED_ON || !DATA || !track || !track.racingLine || !DATA.sets) return null;
  const base = track.racingLine;
  if (DATA.N !== base.N || Math.abs(DATA.len - track.length) > 1 || (DATA.hash != null && DATA.hash !== lineHash(base))) {
    if (!learnedLineFor.warned) { learnedLineFor.warned = true; console.warn('[learnedLine] 맵이 바뀌어 학습 라인을 안 씀 (.debug/line_opt.cjs로 다시 만들 것)'); }
    return null;
  }
  const id = cfg && cfg.carId;
  let key = id in DATA.sets ? id : CLASS_OF[id] in DATA.sets ? CLASS_OF[id] : null; // 차 id가 먼저, 없으면 등급 (null = 원래 라인)
  if (!key) return null;
  const lvl = levelKey(level);
  let set = DATA.sets[key];
  // 차 칸이 { ref: 'A', skip: ['master'] } 처럼 다른 칸을 가리키면 그 칸을 씀 (skip = 이 차에서 손해라 원래 라인을 쓸 단계)
  if (set && set.skip && set.skip.includes(lvl)) return null;
  if (set && set.ref && DATA.sets[set.ref]) { key = set.ref; set = DATA.sets[key]; if (set.skip && set.skip.includes(lvl)) return null; }
  if (!set || !set.segs || !set.segs.length) return null; // 이 차는 원래 라인이 더 빠름
  // 쉬움·보통은 학습한 단계 값이 따로 있을 때만 (없으면 원래 라인 그대로 = 예전 실력·이길 수 있음 유지)
  if ((lvl === 'easy' || lvl === 'normal') && !(set.levels || []).includes(lvl)) return null;
  let byTrack = cache.get(track);
  if (!byTrack) cache.set(track, (byTrack = new Map()));
  const ck = key + '/' + lvl;
  if (!byTrack.has(ck)) {
    const e = expandSegs(base.N, set.segs, lvl);
    byTrack.set(ck, buildLine(track, base, e.delta, e.vs, e.bk, e.sm));
  }
  return byTrack.get(ck);
}

/** 테스트용: 학습 데이터 직접 넣기 (.debug/line_lib.js) */
export function setLearnedData(d) { DATA = d; }
export function learnedData() { return DATA; }
export { lineCarModel };
