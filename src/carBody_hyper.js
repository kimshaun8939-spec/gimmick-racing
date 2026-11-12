// 차체 모양: buildHyper (제니스 하이퍼). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업: 바퀴를 감싸는 둥근 펜더 4개, 가운데 좌석 유리 캐노피(안에 좌석·핸들), 옆 큰 흡입구,
//   LED 헤드라이트, 보이는 엔진, 샤크핀, 백조목 액티브 날개, 디퓨저 핀, 가로 후미등 바
//   아래 도우미(bx, merge, kit, kf, pod, hoop, foil, softGlass)는 carBody_wedge.js·carBody_ev.js도 같이 씀
import * as THREE from 'three';
import { R, arches, doorNumber, glowMat, loft, makeHelmet, rodGeometry } from './carModel.js';

// ------------------------------------------------------------------ 도우미
/** 상자 하나 (돌리고 옮긴 뒤의 모양). 여러 개를 merge로 합쳐 한 덩어리로 그림 */
export function bx(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}
/** 모양을 옮김 (원통·고리 등) */
export function at(g, x, y, z) {
  g.translate(x, y, z);
  return g;
}
/** 여러 모양을 하나로 합침 (위치·법선만 남김 → 그림 호출 수를 줄임) */
export function merge(geos) {
  const pos = [], nor = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
/** 면이 각지게 보이도록 (종이접기 느낌) */
export function facet(g) {
  const out = g.toNonIndexed();
  out.computeVertexNormals();
  g.dispose();
  return out;
}
/** 재질별로 모양을 모았다가 한 번에 메시로 만듦 */
export function kit(add, parent) {
  const bins = new Map();
  return {
    put(mat, ...geos) {
      let b = bins.get(mat);
      if (!b) bins.set(mat, (b = []));
      b.push(...geos);
    },
    flush(shadow = true) {
      for (const [mat, list] of bins) add(merge(list), mat, 0, 0, 0, parent).castShadow = shadow;
      bins.clear();
    },
  };
}
/** z에 따라 값이 부드럽게 바뀌는 표. keys = [[z, ...값], ...] (앞 → 뒤, z가 줄어드는 순서) */
export function kf(keys) {
  return (z) => {
    let i = 0;
    while (i < keys.length - 2 && z < keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1];
    let t = Math.min(1, Math.max(0, (a[0] - z) / (a[0] - b[0])));
    t = t * t * (3 - 2 * t);
    return a.map((v, k) => v + (b[k] - v) * t);
  };
}
/**
 * 바퀴를 감싸는 펜더 (아래가 바퀴 모양으로 둥글게 파인 덩어리).
 * f(z) → [z, 반폭, 윗면 높이, 가운데 x, 아랫면 높이, 각진 정도]
 */
export function pod(wz, r, f, zF, zR, { gap = 0.045, seg = 12, nF = 3, nR = 3, arc = 8 } = {}) {
  const Rr = r + gap;
  const zs = [];
  for (let i = 0; i < nF; i++) zs.push(zF + ((wz + Rr - zF) * i) / nF);
  for (let i = 0; i <= arc; i++) zs.push(wz + Rr * Math.cos((Math.PI * i) / arc));
  for (let i = 1; i <= nR; i++) zs.push(wz - Rr + ((zR - (wz - Rr)) * i) / nR);
  const secs = zs.map((z) => {
    const [, w, yt, x, yb0, n] = f(z);
    const dz = z - wz;
    let yb = yb0;
    if (Math.abs(dz) < Rr - 1e-5) yb = Math.max(yb, r + Math.sqrt(Rr * Rr - dz * dz));
    return R(z, w, yb, Math.max(yt, yb + 0.05), n || 5, x);
  });
  return loft(secs, seg);
}
/** 단면(R)의 윗부분을 따라가는 가는 테 (유리 틀, 롤바) */
export function hoop(s, rad = 0.02, a0 = 0, a1 = Math.PI, seg = 14, grow = 0.01) {
  const pts = [];
  const n = s.n || 3;
  for (let j = 0; j <= seg; j++) {
    const a = a0 + ((a1 - a0) * j) / seg;
    const c = Math.cos(a), si = Math.sin(a);
    pts.push(new THREE.Vector3(
      (s.x || 0) + (s.w + grow) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n),
      s.y + (s.h + grow) * Math.sign(si) * Math.pow(Math.abs(si), 2 / n),
      s.z,
    ));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, rad, 5, false);
}
/** 날개 판 (가로로 긴 유선형). half = 반폭, chord = 앞뒤 길이, th = 두께, droop = 끝이 처지는 정도 */
export function foil(half, chord, th, droop = 0, seg = 12) {
  const g = loft([
    R(-half, chord * 0.42, -th / 2 - droop, th / 2 - droop, 2.4),
    R(-half * 0.55, chord / 2, -th / 2, th / 2, 2.4),
    R(half * 0.55, chord / 2, -th / 2, th / 2, 2.4),
    R(half, chord * 0.42, -th / 2 - droop, th / 2 - droop, 2.4),
  ], seg);
  g.rotateY(Math.PI / 2);
  return g;
}
/** 안이 들여다보이는 유리 (공용 유리보다 맑음) */
export function softGlass(color = '#2a3a4c', opacity = 0.5, metalness = 0.7) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness, transparent: true, opacity });
}
/** 옆에서 본 모양(점들 [z, y])을 x 방향으로 얇게 밀어낸 판 (끝판, 지느러미) */
export function sidePlate(pts, th, x = 0) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) sh.lineTo(p[0], p[1]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); // 모양의 x → 차의 z
  g.translate(x + th / 2, 0, 0);
  return g;
}
/** 좌석 하나 (등받이 + 엉덩이 + 머리 받침) */
export function seatGeos(x, y, z, s = 1) {
  return [
    bx(0.36 * s, 0.1 * s, 0.4 * s, x, y, z + 0.1 * s),
    bx(0.36 * s, 0.5 * s, 0.1 * s, x, y + 0.25 * s, z - 0.14 * s, -0.25),
    bx(0.2 * s, 0.14 * s, 0.09 * s, x, y + 0.52 * s, z - 0.2 * s, -0.25),
  ];
}

// ------------------------------------------------------------------ 제니스 하이퍼
export function buildHyper({ add, body, M, look }) {
  const { paint, accent, trim, carbon, dark, metal, lamp, tailMat } = M;
  const neon = glowMat(look.trim, 1.6);
  const glass = softGlass('#3c5674', 0.74, 0.6);
  const W = [
    [-0.9, 1.72, true, 0.36, 0.3, 0.4],
    [0.9, 1.72, true, 0.36, 0.3, 0.4],
    [-0.93, -1.55, false, 0.39, 0.4, 0.42],
    [0.93, -1.55, false, 0.39, 0.4, 0.42],
  ];
  const K = kit(add, body);

  // --- 가운데 몸통: 낮은 코에서 뒤로 갈수록 살짝 높아짐
  add(loft([
    R(2.92, 0.4, 0.17, 0.29, 4), R(2.55, 0.58, 0.15, 0.43, 4), R(1.72, 0.62, 0.15, 0.55, 4), R(1.0, 0.8, 0.15, 0.62, 4),
    R(0.4, 0.95, 0.16, 0.65, 4), R(-0.45, 0.93, 0.16, 0.68, 4), R(-1.3, 0.78, 0.18, 0.72, 4), R(-2.3, 0.76, 0.2, 0.7, 4), R(-2.66, 0.7, 0.27, 0.62, 4),
  ], 16), paint, 0, 0, 0);

  // --- 펜더 4개 (바퀴 위로 둥글게 솟음)
  const fF = (s) => kf([
    [2.84, 0.15, 0.36, s * 0.64, 0.2, 4], [2.45, 0.3, 0.6, s * 0.69, 0.2, 4], [2.1, 0.34, 0.78, s * 0.71, 0.2, 5],
    [1.72, 0.34, 0.845, s * 0.71, 0.2, 5], [1.3, 0.34, 0.8, s * 0.71, 0.2, 5], [0.9, 0.3, 0.66, s * 0.68, 0.2, 4], [0.5, 0.24, 0.52, s * 0.68, 0.2, 4],
  ]);
  const fR = (s) => kf([
    [-0.42, 0.2, 0.66, s * 0.8, 0.3, 4], [-0.9, 0.34, 0.86, s * 0.76, 0.22, 5], [-1.55, 0.37, 0.935, s * 0.75, 0.22, 5],
    [-2.1, 0.36, 0.88, s * 0.74, 0.22, 5], [-2.66, 0.3, 0.7, s * 0.7, 0.3, 4],
  ]);
  for (const s of [-1, 1]) {
    add(pod(1.72, 0.36, fF(s), 2.84, 0.5), paint, 0, 0, 0);
    add(pod(-1.55, 0.39, fR(s), -0.42, -2.66), paint, 0, 0, 0);
  }
  arches(add, M, W, 0.03, 0.075, 0.1, carbon);

  // --- 유리 캐노피 (가운데 좌석) + 지붕 등뼈 + 유리 틀
  const cs = [R(1.55, 0.3, 0.55, 0.6, 3), R(0.85, 0.5, 0.6, 0.95, 3), R(0.1, 0.56, 0.62, 1.09, 3), R(-0.7, 0.5, 0.62, 1.04, 3), R(-1.5, 0.36, 0.62, 0.86, 3)];
  add(loft(cs, 24), glass, 0, 0, 0).castShadow = false;
  add(loft([R(0.35, 0.12, 1.04, 1.1, 3), R(-0.1, 0.16, 1.07, 1.13, 3), R(-0.7, 0.18, 1.02, 1.09, 3), R(-1.55, 0.14, 0.82, 0.9, 3)], 12), carbon, 0, 0, 0);
  K.put(carbon, hoop(cs[1], 0.022, 0, Math.PI, 9), hoop(cs[3], 0.024, 0, Math.PI, 9), hoop(R(-0.3, 0.545, 0.62, 1.085, 3), 0.018, 0, Math.PI, 9));
  // 지붕 공기 흡입구 (스노클)
  add(loft([R(0.05, 0.13, 1.1, 1.22, 4), R(-0.3, 0.15, 1.1, 1.24, 4), R(-1.0, 0.1, 1.0, 1.12, 4)], 12), paint, 0, 0, 0);
  K.put(dark, bx(0.2, 0.085, 0.02, 0, 1.165, 0.062));
  K.put(neon, bx(0.22, 0.012, 0.02, 0, 1.222, 0.058));
  // 실내: 가운데 운전석 + 뒤로 물러난 옆 좌석 2개, 계기판, 핸들
  K.put(carbon, ...seatGeos(0, 0.42, -0.3), ...seatGeos(-0.32, 0.4, -0.62, 0.9), ...seatGeos(0.32, 0.4, -0.62, 0.9));
  K.put(trim, bx(0.1, 0.42, 0.02, 0, 0.7, -0.38, -0.25), bx(0.08, 0.36, 0.02, -0.32, 0.64, -0.69, -0.25), bx(0.08, 0.36, 0.02, 0.32, 0.64, -0.69, -0.25));
  K.put(dark, bx(0.9, 0.1, 0.3, 0, 0.64, 0.62, 0.2), bx(1.0, 0.03, 1.5, 0, 0.61, -0.3));
  K.put(neon, bx(0.3, 0.05, 0.02, 0, 0.7, 0.5, 0.5));
  K.put(carbon, at(new THREE.TorusGeometry(0.11, 0.016, 5, 14).rotateX(-0.45), 0, 0.76, 0.34), bx(0.03, 0.03, 0.2, 0, 0.72, 0.45, 0.45));

  for (const s of [-1, 1]) {
    // 검은 아랫단(투톤) + 빛나는 줄 + 옆 치마 날
    K.put(accent, bx(0.05, 0.14, 2.25, s * 0.975, 0.26, -0.18));
    K.put(neon, bx(0.02, 0.018, 2.2, s * 1.003, 0.34, -0.18));
    K.put(carbon, bx(0.16, 0.025, 2.1, s * 1.0, 0.165, -0.2), bx(0.02, 0.09, 0.3, s * 1.075, 0.2, -0.95), bx(0.02, 0.09, 0.3, s * 1.075, 0.2, 0.6));
    // 문 옆 파인 통로 (앞바퀴 뒤 → 뒤 흡입구) + 문 선
    K.put(carbon, bx(0.03, 0.2, 1.25, s * 0.955, 0.47, 0.42, 0, s * 0.03), bx(0.05, 0.03, 0.55, s * 0.97, 0.5, 1.02, 0.5));
    K.put(dark, bx(0.012, 0.3, 0.012, s * 0.965, 0.5, 0.92), bx(0.012, 0.3, 0.012, s * 0.955, 0.5, -0.3), bx(0.012, 0.012, 1.2, s * 0.962, 0.652, 0.3));
    K.put(metal, bx(0.014, 0.02, 0.12, s * 0.975, 0.58, -0.12));
    // 뒤 펜더 앞 큰 흡입구: 검은 입 + 안쪽 살 + 빛나는 테
    K.put(dark, bx(0.3, 0.34, 0.06, s * 0.82, 0.5, -0.43, 0, s * 0.3));
    for (let i = 0; i < 3; i++) K.put(carbon, bx(0.3, 0.014, 0.05, s * 0.82, 0.4 + i * 0.09, -0.4, 0, s * 0.3));
    K.put(neon, bx(0.31, 0.014, 0.03, s * 0.82, 0.675, -0.4, 0, s * 0.3), bx(0.014, 0.33, 0.03, s * 0.975, 0.51, -0.35));
    // 뒤 펜더 위 통풍 틈 + 급유구
    for (let i = 0; i < 4; i++) K.put(dark, bx(0.22, 0.012, 0.05, s * 0.76, 0.925 - Math.abs(i - 1.2) * 0.012, -1.3 - i * 0.12));
    K.put(metal, at(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 12), s * 0.62, 0.795, -1.95));
    // 앞 펜더 위 통풍 틈 (바퀴 위 압력 빼기)
    for (let i = 0; i < 4; i++) K.put(dark, bx(0.26, 0.012, 0.045, s * 0.72, 0.842 - Math.abs(i - 1.5) * 0.008, 1.9 - i * 0.11));
    // 헤드라이트: 검은 집 + LED 3알 + 꺾인 주간등
    K.put(dark, bx(0.36, 0.03, 0.34, s * 0.69, 0.555, 2.47, 0.62, 0, s * -0.1));
    for (let i = 0; i < 3; i++) K.put(lamp, bx(0.085, 0.05, 0.1, s * (0.585 + i * 0.105), 0.585, 2.47, 0.62));
    K.put(neon, bx(0.36, 0.02, 0.03, s * 0.69, 0.672, 2.33, 0.62), bx(0.03, 0.02, 0.36, s * 0.87, 0.57, 2.45, 0.62));
    // 앞 모서리 카나드 2장
    K.put(carbon, bx(0.2, 0.014, 0.3, s * 0.99, 0.36, 2.42, 0.3, 0, s * 0.35), bx(0.16, 0.014, 0.24, s * 0.99, 0.48, 2.3, 0.3, 0, s * 0.35));
    // 앞 흡입구 (코 양옆) + 보닛 콧구멍
    K.put(dark, bx(0.3, 0.13, 0.05, s * 0.3, 0.26, 2.83, 0, s * -0.25), bx(0.16, 0.012, 0.42, s * 0.3, 0.535, 1.9, 0.14));
    K.put(carbon, bx(0.3, 0.012, 0.06, s * 0.3, 0.26, 2.84, 0, s * -0.25), bx(0.012, 0.03, 0.42, s * 0.39, 0.54, 1.9, 0.14));
    // 사이드미러 (가는 기둥 + 빛나는 방향등)
    K.put(carbon, rodGeometry(new THREE.Vector3(s * 0.6, 0.72, 0.92), new THREE.Vector3(s * 0.86, 0.88, 0.84), 0.016));
    K.put(paint, loft([R(0.9, 0.09, 0.84, 0.93, 3, s * 0.9), R(0.78, 0.07, 0.85, 0.92, 3, s * 0.9)], 8));
    K.put(neon, bx(0.1, 0.012, 0.012, s * 0.91, 0.88, 0.905));
    // 뒤: 디퓨저 옆 세로 반사등
    K.put(tailMat, bx(0.03, 0.16, 0.03, s * 0.86, 0.36, -2.67));
  }
  // 포인트 줄: 코에서 캐노피까지 가는 두 줄
  for (const s of [-1, 1]) K.put(trim, bx(0.03, 0.01, 1.05, s * 0.1, 0.476, 2.2, 0.155));
  K.put(dark, bx(0.012, 0.012, 1.9, 0, 0.47, 2.0, 0.155)); // 보닛 가운데 선
  // 엔진: 캐노피 뒤로 보이는 흡기통 + 빛나는 줄, 양옆 루버
  K.put(metal, bx(0.5, 0.1, 0.5, 0, 0.74, -1.85), at(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8).rotateX(Math.PI / 2), -0.17, 0.8, -1.85), at(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8).rotateX(Math.PI / 2), 0.17, 0.8, -1.85));
  K.put(trim, bx(0.06, 0.03, 0.5, 0, 0.81, -1.85), bx(0.5, 0.02, 0.03, 0, 0.8, -1.58));
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) K.put(dark, bx(0.2, 0.012, 0.06, s * 0.42, 0.722 - i * 0.004, -1.62 - i * 0.13));
  // 샤크핀 (지붕 → 뒷날개) + 꼭대기 빛나는 줄 + 안테나
  K.put(carbon, sidePlate([[-1.0, 0.98], [-2.3, 1.12], [-2.42, 1.12], [-2.5, 0.7], [-1.0, 0.7]], 0.025));
  K.put(neon, bx(0.03, 0.014, 0.12, 0, 1.125, -2.36));
  K.put(dark, rodGeometry(new THREE.Vector3(0, 1.12, -0.8), new THREE.Vector3(0, 1.38, -0.98), 0.006));
  doorNumber(add, M, 0.983, 0.47, 0.2, 0.26);

  // --- 뒤: 그물 판 + 가로 라이트 바 + 큰 디퓨저 + 가운데 배기구 3개
  K.put(dark, bx(1.5, 0.3, 0.03, 0, 0.47, -2.665));
  for (let i = 0; i < 5; i++) K.put(carbon, bx(1.44, 0.012, 0.03, 0, 0.36 + i * 0.045, -2.672));
  K.put(tailMat, bx(1.96, 0.035, 0.05, 0, 0.615, -2.675), bx(0.1, 0.05, 0.04, 0, 0.24, -2.82));
  K.put(neon, bx(1.96, 0.012, 0.055, 0, 0.652, -2.675));
  for (const s of [-1, 1]) K.put(tailMat, bx(0.3, 0.03, 0.05, s * 0.83, 0.575, -2.67, 0, 0, s * 0.35));
  K.put(carbon, bx(1.7, 0.03, 0.6, 0, 0.25, -2.52, 0.42), bx(0.5, 0.2, 0.06, 0, 0.42, -2.68));
  for (const x of [-0.72, -0.48, -0.24, 0.24, 0.48, 0.72]) K.put(carbon, sidePlate([[-2.2, 0.13], [-2.84, 0.13], [-2.84, 0.4], [-2.3, 0.2]], 0.02, x));
  for (const x of [-0.14, 0, 0.14]) {
    K.put(metal, at(new THREE.CylinderGeometry(0.058, 0.062, 0.22, 12, 1, true).rotateX(Math.PI / 2), x, 0.42, -2.66));
    K.put(dark, at(new THREE.CircleGeometry(0.05, 10).rotateY(Math.PI), x, 0.42, -2.7));
    K.put(neon, at(new THREE.TorusGeometry(0.06, 0.006, 4, 12), x, 0.42, -2.772));
  }
  K.put(trim, bx(0.03, 0.05, 0.1, 0.5, 0.24, -2.8), bx(0.03, 0.05, 0.12, -0.45, 0.2, 2.95)); // 견인 고리
  K.flush();

  // --- 앞 스플리터 (끝판 + 받침 줄)
  const fWing = new THREE.Group();
  body.add(fWing);
  const KF = kit(add, fWing);
  KF.put(carbon, bx(2.04, 0.025, 0.46, 0, 0.115, 2.76), bx(1.2, 0.02, 0.2, 0, 0.115, 3.02));
  KF.put(trim, bx(1.2, 0.022, 0.02, 0, 0.116, 3.125));
  for (const s of [-1, 1]) {
    KF.put(carbon, sidePlate([[2.98, 0.1], [2.56, 0.1], [2.56, 0.21], [2.84, 0.17]], 0.024, s * 1.01));
    KF.put(trim, bx(0.03, 0.02, 0.3, s * 1.012, 0.2, 2.7, 0.14));
    KF.put(metal, rodGeometry(new THREE.Vector3(s * 0.35, 0.125, 3.05), new THREE.Vector3(s * 0.33, 0.22, 2.9), 0.008));
  }
  KF.flush();

  // --- 높은 백조목 뒷날개 (액티브 에어로: 유압 기둥으로 움직이는 윗판)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  const KS = kit(add, spoiler);
  KS.put(carbon, at(foil(0.97, 0.42, 0.05, 0.03), 0, 1.24, -2.42));
  for (const s of [-1, 1]) {
    KS.put(accent, sidePlate([[-2.16, 1.3], [-2.74, 1.42], [-2.76, 1.08], [-2.5, 1.0], [-2.2, 1.06]], 0.035, s * 0.97));
    KS.put(neon, bx(0.04, 0.016, 0.6, s * 0.97, 1.372, -2.45, 0.2));
    const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.38, 0.66, -1.98), new THREE.Vector3(s * 0.38, 1.12, -2.08), new THREE.Vector3(s * 0.38, 1.33, -2.2), new THREE.Vector3(s * 0.38, 1.29, -2.4)]);
    const tube = new THREE.TubeGeometry(neck, 8, 0.035, 5, false);
    tube.scale(0.55, 1, 1).translate(s * 0.38 * 0.45, 0, 0);
    KS.put(carbon, tube);
    KS.put(metal, rodGeometry(new THREE.Vector3(s * 0.38, 0.7, -2.2), new THREE.Vector3(s * 0.38, 1.2, -2.38), 0.012));
  }
  KS.flush();
  const drs = add(merge([foil(0.95, 0.2, 0.03), bx(1.9, 0.02, 0.012, 0, 0.02, -0.1)]), paint, 0, 1.335, -2.6, spoiler);
  drs.rotation.x = 0.35;

  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 0.86, -0.25);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.82, 0.48], r: [0.88, 0.58] },
      helmet: [0, 0.86, -0.25],
      visor: [0.98, -0.75],
      armor: { y: 0.64, x: 0.9 },
      ram: { y: 0.06, z: 1.85 },
      spines: [[-0.9, 1.1], [-1.3, 1.1], [-1.7, 1.1], [-2.1, 1.08]],
      booster: { x: 0.45, y0: 0.45, y1: 0.9, z0: -0.6, dz: -1.25 },
      lift: { y: 0.66, z: -2.3, h: 0.3 },
      stab: [0.99, 1.22, -2.48],
      tailFin: [0, 1.1, -0.95],
      wing: [0.9, 0.5, 0.0],
      nitro: { x: 0.36, y: 0.38, z: -2.52, dz: -0.42 },
      vents: [[0.76, 0.93, -1.3], [0.76, 0.93, -1.5], [0.76, 0.92, -1.7]],
      glow: { y: 0.482, z: 2.2, len: 1.1, rot: 0.155, w: 0.06 },
      flames: [[0, 0.42, 0.6, -2.8], [-0.14, 0.42, 0.45, -2.8], [0.14, 0.42, 0.45, -2.8]],
      motor: [0.4, 0.32, -2.7],
      spark: [0.93, 0.25, -2.05],
      seams: [0.98, 0.17, -0.1],
      lean: 0.035,
      drsRest: 0.35,
    },
  };
}
