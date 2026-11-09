// 레이싱 라인 계산 (F1 게임의 "주행 라인 보조"처럼)
//
//   1) 모양: 도로 폭(연석 포함) 안에서 가장 덜 휘는 길을 찾음 → 바깥-안쪽(에이펙스)-바깥 라인
//      중심선 각 지점에서 옆으로 얼마나 비킬지(offset)를 반복해서 다듬음 (굵은 간격 → 촘촘한 간격)
//   2) 속도: 라인의 휘는 정도로 코너에서 낼 수 있는 속도를 구하고,
//      앞뒤로 훑어서 "여기서부터 브레이크를 밟아야 다음 코너 속도에 맞출 수 있다"를 계산
//   3) 에이펙스: 라인이 코너 안쪽 끝(연석)에 가장 가깝게 붙는 곳
//
// 트랙 모듈(track.js, gpTrack.js)이 모양을 만들고, 속도는 차 설정을 받아 profile()로 계산합니다.
import * as THREE from 'three';

/**
 * @param {Array<{pos:THREE.Vector3, right:THREE.Vector3}>} samples 닫힌 고리 중심선 (마지막 점이 첫 점과 같으면 빼고 넘길 것)
 * @param {(i:number, side:number) => number} limit 지점 i에서 차 중심이 갈 수 있는 옆 거리 (side -1 왼쪽, 1 오른쪽, 양수 m)
 * @param {number} length 한 바퀴 길이 (m)
 */
export function computeRacingLine(samples, limit, length, opts = {}) {
  const N = samples.length;
  const ds = length / N;
  const off = new Float32Array(N);
  const lo = new Float32Array(N), hi = new Float32Array(N);
  // limit은 음수도 됨 (장애물 때문에 한쪽으로 비켜 가야 할 때: 예) 왼쪽 limit -6.7 → 중심에서 오른쪽 6.7 m 이상)
  for (let i = 0; i < N; i++) {
    lo[i] = -limit(i, -1);
    hi[i] = limit(i, 1);
    if (lo[i] > hi[i]) lo[i] = hi[i] = (lo[i] + hi[i]) / 2;
  }
  const px = new Float32Array(N), pz = new Float32Array(N);
  const cx = samples.map((s) => s.pos.x), cz = samples.map((s) => s.pos.z);
  const rx = samples.map((s) => s.right.x), rz = samples.map((s) => s.right.z);
  const W = (i) => ((i % N) + N) % N;
  const place = () => {
    for (let i = 0; i < N; i++) {
      px[i] = cx[i] + rx[i] * off[i];
      pz[i] = cz[i] + rz[i] * off[i];
    }
  };
  // K1999 방식 (레이싱 AI가 흔히 쓰는 방법): 각 점의 휘는 정도를 앞뒤 점의 휘는 정도의 평균에 맞추도록 옆으로 옮김
  // → 코너 전체에 휘는 정도가 고르게 퍼져서 바깥에서 들어가 안쪽(에이펙스)을 찍고 바깥으로 나가는 라인이 됨
  // 굵은 간격(약 100 m)부터 시작해 점점 촘촘하게 다듬음. 사이 점은 직선으로 이어 채움
  const curv3 = (ax, az, bx, bz, cx, cz) => {
    const x1 = bx - ax, z1 = bz - az, x2 = cx - bx, z2 = cz - bz;
    const cross = x1 * z2 - z1 * x2;
    const d = Math.hypot(x1, z1) * Math.hypot(x2, z2) * Math.hypot(cx - ax, cz - az);
    return d < 1e-9 ? 0 : (2 * cross) / d;
  };
  const P = (i) => [cx[i] + rx[i] * off[i], cz[i] + rz[i] * off[i]];
  const curvAt = (a, i, b, l) => {
    const [ax, az] = P(a), [bx, bz] = P(b);
    return curv3(ax, az, cx[i] + rx[i] * l, cz[i] + rz[i] * l, bx, bz);
  };
  let step = 1;
  while (step * 2 * ds < 100 && step * 8 < N) step *= 2;
  for (; step >= 1; step = step >> 1) {
    const iters = Math.round((step === 1 ? 60 : 90) * (opts.iterScale || 1));
    for (let it = 0; it < iters; it++) {
      for (let i0 = 0; i0 < N; i0 += step) {
        const i = i0, p = W(i - step), pp = W(i - 2 * step), n = W(i + step), nn = W(i + 2 * step);
        const cPrev = curvAt(pp, p, i, off[p]);
        const cNext = curvAt(i, n, nn, off[n]);
        const [pxp, pzp] = P(p), [pxn, pzn] = P(n), [pxi, pzi] = P(i);
        const lp = Math.hypot(pxi - pxp, pzi - pzp), ln = Math.hypot(pxn - pxi, pzn - pzi);
        const target = (cPrev * ln + cNext * lp) / Math.max(1e-6, lp + ln);
        // 옆으로 조금 옮겼을 때 휘는 정도가 얼마나 변하는지 보고 목표에 맞춤
        const h = 0.05;
        const c0 = curvAt(p, i, n, off[i]);
        const c1 = curvAt(p, i, n, off[i] + h);
        const dc = (c1 - c0) / h;
        if (Math.abs(dc) < 1e-7) continue;
        const want = off[i] + (target - c0) / dc;
        off[i] = THREE.MathUtils.clamp(off[i] + (want - off[i]) * 0.7, lo[i], hi[i]);
      }
    }
    // 사이 점 채우기
    if (step > 1)
      for (let i0 = 0; i0 < N; i0 += step) {
        const a = i0, b = W(i0 + step);
        for (let j = 1; j < step && i0 + j < N; j++) {
          const u = j / step;
          off[i0 + j] = THREE.MathUtils.clamp(off[a] * (1 - u) + off[b] * u, lo[i0 + j], hi[i0 + j]);
        }
      }
  }
  place();

  // 곡률 (±k 지점의 방향 차이 / 거리). 양수 = 왼쪽으로 굽음
  const k = Math.max(2, Math.round(5 / ds));
  const curv = new Float32Array(N);
  const head = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = W(i - 1), b = W(i + 1);
    head[i] = Math.atan2(px[b] - px[a], pz[b] - pz[a]);
  }
  for (let i = 0; i < N; i++) {
    let d = head[W(i + k)] - head[W(i - k)];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    let L = 0;
    for (let j = i - k; j < i + k; j++) L += Math.hypot(px[W(j + 1)] - px[W(j)], pz[W(j + 1)] - pz[W(j)]);
    curv[i] = d / Math.max(0.5, L);
  }
  // 라인을 따라 잰 각 구간 길이
  const seg = new Float32Array(N);
  for (let i = 0; i < N; i++) seg[i] = Math.max(0.05, Math.hypot(px[W(i + 1)] - px[i], pz[W(i + 1)] - pz[i]));

  // 에이펙스: 곡률이 충분히 크고 (반지름 < 160 m) 그 주변에서 가장 큰 곳, 라인이 안쪽 끝에 붙어 있을 때
  const apexes = [];
  const win = Math.max(3, Math.round(30 / ds));
  for (let i = 0; i < N; i++) {
    const c = Math.abs(curv[i]);
    if (c < 1 / 160) continue;
    let isMax = true;
    for (let j = -win; j <= win && isMax; j++) if (j && Math.abs(curv[W(i + j)]) > c) isMax = false;
    if (!isMax) continue;
    const inSide = curv[i] > 0 ? -1 : 1; // 왼쪽으로 굽으면 안쪽은 왼쪽
    const edge = inSide < 0 ? lo[i] : hi[i];
    // 라인이 안쪽 끝에서 1.2 m 안에 있는 가장 가까운 지점을 에이펙스로
    let best = -1, bestGap = 1.2;
    for (let j = -win; j <= win; j++) {
      const q = W(i + j);
      const e = inSide < 0 ? lo[q] : hi[q];
      const gap = Math.abs(e - off[q]);
      if (gap < bestGap) (bestGap = gap), (best = q);
    }
    if (best < 0) continue;
    if (apexes.length && Math.abs(apexes[apexes.length - 1].i - best) < win) continue;
    apexes.push({ i: best, side: inSide, radius: 1 / c, edge: Math.abs(edge) });
    void edge;
  }

  /**
   * 속도 계획. car: { vMax, aLat(v), aAcc(v), aBrake(v) } (m/s, m/s²)
   * 결과 speed[i] = 그 지점에서 낼 수 있는 속도, brake[i] = 1이면 그 지점은 감속 구간
   */
  const bank = opts.bank || null;
  function profile(car) {
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const c = Math.abs(curv[i]);
      // v²·c ≤ aLat(v)  →  aLat가 속도에 따라 변하므로 몇 번 반복
      // 경사(뱅크) 코너: 도로가 코너 안쪽으로 기울면 중력이 차를 안쪽으로 눌러 줘서 더 빨리 돌 수 있음 (반대로 기울면 손해)
      //   opts.bank[i] = 도로 기울기 (라디안, + = 오른쪽이 높음 = 왼쪽 코너에 유리), 곡률 + = 왼쪽
      const bankLat = bank && car.bankGrip ? 9.81 * Math.sin(bank[i]) * Math.sign(curv[i]) * car.bankGrip : 0;
      let s = car.vMax;
      for (let r = 0; r < 4; r++) s = Math.min(car.vMax, c > 1e-5 ? Math.sqrt(Math.max(car.aLat(s) * 0.5, car.aLat(s) + bankLat) / c) : car.vMax);
      v[i] = s;
    }
    // 가속 한계 (앞으로), 감속 한계 (뒤로). 고리라서 두 바퀴 돌림
    const fwd = Float32Array.from(v);
    for (let lap = 0; lap < 2; lap++)
      for (let n = 0; n < N; n++) {
        const i = n, p = W(n - 1);
        fwd[i] = Math.min(fwd[i], Math.sqrt(fwd[p] * fwd[p] + 2 * car.aAcc(fwd[p]) * seg[p]));
      }
    const out = Float32Array.from(fwd);
    for (let lap = 0; lap < 2; lap++)
      for (let n = N - 1; n >= 0; n--) {
        const i = n, nx = W(n + 1);
        out[i] = Math.min(out[i], Math.sqrt(out[nx] * out[nx] + 2 * car.aBrake(out[nx]) * seg[i]));
      }
    const brake = new Uint8Array(N);
    for (let i = 0; i < N; i++) brake[i] = out[i] < fwd[i] - 0.3 ? 1 : 0;
    return { speed: out, brake };
  }

  return { N, offset: off, lo, hi, x: px, z: pz, curvature: curv, seg, apexes, profile };
}

/**
 * 차가 도로 가장자리에서 어디쯤 걸쳐 있는지 (차 폭 2 m 기준)
 *   d: 중심선까지 거리, road: 도로 반폭, kerbOut: 연석 바깥 끝
 *   → { kerb: 차 폭 중 연석 위 비율 0~1, off: 연석 밖(잔디 등) 비율 0~1 }
 */
export function edgeFraction(d, road, kerbOut, half = 1.0) {
  const a = d - half, b = d + half;
  const overlap = (x0, x1) => Math.max(0, Math.min(b, x1) - Math.max(a, x0));
  return { kerb: overlap(road, kerbOut) / (2 * half), off: overlap(kerbOut, Infinity) / (2 * half) };
}
