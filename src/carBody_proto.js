// 차체 모양: buildProto (블루 프로토 proto · 노바 프로토 nova). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업: 펜더 위 통풍 틈, LED 헤드라이트 뭉치, 앞유리 틀·와이퍼, 지붕 흡입구, 엔진 덮개 틈,
//   모양 잡힌 뒷날개 끝판, 큰 디퓨저, 세로 LED 후미등. 같은 재질 조각은 한 덩어리로 합침. 예전 파일: .debug/carBody_proto.before-detail.js
import * as THREE from 'three';
import { R, archGeo, loft, makeHelmet, rodGeometry } from './carModel.js';

// ---------------------------------------------------------------- 이 파일 안에서만 쓰는 도우미
/** 여러 지오메트리를 하나로 (위치·법선만) */
function mergeG(list) {
  const pos = [], nor = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
/** 상자 (크기, 위치, 회전 x→y→z 순서) */
function bx(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
}
/** 옆에서 본 모양 [z, y] 점들을 x 방향 두께 t로 세운 판 (끝판, 지느러미, 바지보드). ry = 위에서 본 비틀림 (pz 기준) */
function plate(pts, t, x = 0, ry = 0, pz = 0) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [a, b] of pts.slice(1)) s.lineTo(a, b);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(t / 2, 0, 0);
  if (ry) g.translate(0, 0, -pz).rotateY(ry).translate(0, 0, pz);
  return g.translate(x, 0, 0);
}
/** 위에서 본 모양 [x, z] 점들을 두께 t로 눕힌 판 (윗면 높이 y) */
function slab(pts, t, y) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [a, b] of pts.slice(1)) s.lineTo(a, b);
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, y, 0);
}
/** 날개 단면을 x 방향으로 뽑은 날개판. x0~x1, 가운데 z·y, 폭(chord), 두께, 뒤쪽이 들리는 높이(rise), 뒤로 젖힘(sweep) */
function foil(x0, x1, z, y, chord, t, rise = 0, sweep = 0) {
  const N = 6, up = [], dn = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const zz = chord / 2 - u * chord;
    const mid = rise * Math.pow(u, 1.7);
    const th = t * (0.35 + 2.6 * u * (1 - u)) * 0.5;
    up.push([zz, mid + th]);
    dn.push([zz, mid - th]);
  }
  const pts = [...up, ...dn.reverse()];
  const len = Math.abs(x1 - x0);
  const g = plate(pts, len, 0);
  // x0 쪽 끝을 원점에 두고 젖힌 뒤 제자리로
  const dir = Math.sign(x1 - x0) || 1;
  g.translate(dir * len / 2, 0, 0);
  if (sweep) g.rotateY(dir * sweep);
  return g.translate(x0, y, z);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rod = (a, b, r) => rodGeometry(V(...a), V(...b), r);

export function buildProto({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, glass, tailMat, lamp, lampYellow, glowTrim, metal, numMat } = M;
  // 같은 재질·같은 부모끼리 모았다가 한 번에 붙임
  const bins = new Map();
  const put = (mat, geo, parent = body) => {
    let m = bins.get(parent);
    if (!m) bins.set(parent, (m = new Map()));
    if (!m.has(mat)) m.set(mat, []);
    m.get(mat).push(geo);
  };
  const flush = () => {
    for (const [parent, m] of bins) for (const [mat, list] of m) {
      const mesh = add(mergeG(list), mat, 0, 0, 0, parent);
      if (mat === tailMat || mat === lamp || mat === dark || mat === lampYellow || mat === glowTrim) mesh.castShadow = false;
    }
  };


  const W = [
    [-0.86, 1.75, true, 0.36, 0.32, 0.35],
    [0.86, 1.75, true, 0.36, 0.32, 0.35],
    [-0.88, -1.55, false, 0.38, 0.4, 0.38],
    [0.88, -1.55, false, 0.38, 0.4, 0.38],
  ];
  // ============================================================ 가운데 낮은 몸통 (노즈는 아래로 내려감)
  put(paint, loft([R(3.0, 0.3, 0.16, 0.26, 4), R(2.6, 0.5, 0.15, 0.38), R(1.6, 0.6, 0.15, 0.5), R(0.5, 0.68, 0.16, 0.56), R(-1.0, 0.68, 0.18, 0.6), R(-2.2, 0.64, 0.2, 0.62), R(-2.62, 0.58, 0.24, 0.58)], 24));
  // 노즈 위 포인트 줄 (가운데 굵은 줄 + 양옆 가는 줄) + 견인 고리
  put(accent, bx(0.2, 0.012, 0.9, 0, 0.441, 2.12, 0.12));
  for (const side of [-1, 1]) put(trim, bx(0.035, 0.012, 0.9, side * 0.15, 0.441, 2.12, 0.12));
  put(trim, new THREE.TorusGeometry(0.045, 0.012, 5, 10).rotateY(Math.PI / 2).translate(0.2, 0.2, 3.02));
  for (const side of [-1, 1]) {
    const x = side * 0.86;
    // 앞 펜더: 바퀴 앞(아래로 내려가는 코) + 아치 + 바퀴 뒤 (사이드포드로 이어짐)
    put(paint, loft([R(2.95, 0.12, 0.17, 0.3, 4, x), R(2.6, 0.18, 0.16, 0.6, 4, x), R(2.25, 0.18, 0.18, 0.78, 4, x)]));
    put(paint, loft([R(1.25, 0.18, 0.4, 0.82, 4, x), R(0.8, 0.17, 0.3, 0.68, 4, x), R(0.3, 0.12, 0.3, 0.55, 4, x * 0.92)]));
    // 사이드포드 (흡입구가 앞에 있음: 검은 입 + 가로 살 2개)
    put(paint, loft([R(0.6, 0.2, 0.18, 0.5, 4, side * 0.74), R(-0.2, 0.26, 0.18, 0.56, 4, side * 0.74), R(-0.95, 0.24, 0.2, 0.62, 4, side * 0.76)]));
    put(dark, bx(0.3, 0.2, 0.04, side * 0.74, 0.36, 0.62));
    for (const y of [0.32, 0.4]) put(carbon, bx(0.3, 0.014, 0.05, side * 0.74, y, 0.63));
    // 뒤 펜더: 바퀴 앞 + 아치 + 바퀴 뒤 (높게 솟음)
    const xr = side * 0.88;
    put(paint, loft([R(-0.9, 0.22, 0.2, 0.66, 4, xr), R(-1.1, 0.22, 0.42, 0.88, 4, xr)]));
    put(paint, loft([R(-2.0, 0.22, 0.42, 0.9, 4, xr), R(-2.4, 0.22, 0.24, 0.86, 4, xr), R(-2.64, 0.2, 0.26, 0.74, 4, xr)]));
    // 펜더 아치 위 줄무늬 (포인트 색) + 통풍 틈 (검은 줄)
    for (const [wx, wz, , r] of [W[side < 0 ? 0 : 1], W[side < 0 ? 2 : 3]]) {
      put(accent, archGeo(r + 0.155, r + 0.168, 0.1, 0.25).translate(wx - side * 0.06, r, wz));
      for (const a of [-0.62, -0.36, -0.1, 0.16]) {
        put(dark, bx(0.16, 0.014, 0.065, wx + side * 0.1, r + (r + 0.166) * Math.cos(a), wz + (r + 0.166) * Math.sin(a), a));
      }
    }
    // 헤드라이트 뭉치: 검은 집 + 흰 LED 3알 + 노란 주간등(ㄱ자)
    put(dark, bx(0.26, 0.02, 0.5, x, 0.515, 2.56, 0.86));
    for (let i = 0; i < 3; i++) put(lamp, bx(0.095, 0.035, 0.085, x - side * 0.045, 0.418 + i * 0.115, 2.69 - i * 0.1, 0.86));
    put(lampYellow, bx(0.04, 0.035, 0.46, x + side * 0.085, 0.522, 2.56, 0.86));
    put(lampYellow, bx(0.21, 0.035, 0.04, x, 0.675, 2.38, 0.86));
    // 옆 줄무늬 (포인트 색 + 테 색) + 번호 불빛 3알 + 문 이음선
    put(accent, bx(0.02, 0.05, 2.0, side * 0.96, 0.46, -0.2));
    put(trim, bx(0.02, 0.025, 2.0, side * 0.962, 0.41, -0.2));
    for (let i = 0; i < 3; i++) put(glowTrim, bx(0.012, 0.045, 0.045, side * 1.0, 0.5, -0.5 - i * 0.09));
    put(dark, bx(0.012, 0.3, 0.012, side * 0.985, 0.36, 0.25));
    // 앞바퀴 뒤 바람 빠지는 틈 (검은 줄 3개)
    for (let i = 0; i < 3; i++) put(dark, bx(0.012, 0.16 - i * 0.03, 0.035, side * (1.035 - i * 0.012), 0.56 - i * 0.02, 1.12 - i * 0.09));
    // 백미러 (펜더 위): 기둥 + 몸통 + 거울면
    put(carbon, bx(0.03, 0.09, 0.04, side * 0.78, 0.83, 1.05));
    put(paint, bx(0.16, 0.075, 0.09, side * 0.78, 0.9, 1.05));
    put(dark, bx(0.13, 0.055, 0.01, side * 0.78, 0.9, 1.002));
    // 옆 창 (캐노피 옆 어두운 유리) + 문 손잡이
    put(glass, bx(0.02, 0.22, 0.6, side * 0.47, 0.84, -0.45, 0, 0, side * 0.35));
    put(carbon, bx(0.02, 0.025, 0.1, side * 0.505, 0.74, -0.62, 0, 0, side * 0.35));
    // 엔진 덮개 통풍 틈 (샤크핀 양옆, 뒤로 내려가는 5줄)
    for (let i = 0; i < 5; i++) put(dark, bx(0.26, 0.012, 0.055, side * 0.2, 0.894 - i * 0.021, -1.3 - i * 0.14, -0.15));
    // 뒤 펜더 끝 세로 LED 후미등
    put(tailMat, bx(0.05, 0.3, 0.03, side * 0.94, 0.62, -2.648));
    put(tailMat, bx(0.16, 0.035, 0.03, side * 0.86, 0.755, -2.648));
    // 배기구 2개
    put(metal, new THREE.CylinderGeometry(0.05, 0.055, 0.16, 10, 1, true).rotateX(Math.PI / 2).translate(side * 0.13, 0.42, -2.62));
    put(dark, new THREE.CircleGeometry(0.048, 10).rotateY(Math.PI).translate(side * 0.13, 0.42, -2.66));
  }
  for (const [x, z, , r, wd] of W) put(paint, archGeo(r + 0.03, r + 0.16, wd + 0.08).translate(x, r, z));
  // ============================================================ 캐노피 (차체색) + 앞 유리 + 틀 + 와이퍼
  put(paint, loft([R(1.15, 0.28, 0.5, 0.56, 3), R(0.6, 0.45, 0.54, 0.95, 3), R(-0.2, 0.49, 0.58, 1.08, 3), R(-1.0, 0.42, 0.58, 0.98, 3), R(-1.7, 0.26, 0.56, 0.76, 3)], 24));
  put(glass, loft([R(1.16, 0.29, 0.5, 0.57, 3), R(0.6, 0.46, 0.54, 0.96, 3), R(0.1, 0.495, 0.57, 1.075, 3), R(-0.05, 0.5, 0.575, 1.08, 3)], 24));
  for (const side of [-1, 1]) {
    // 앞유리 기둥 (A필러)
    put(carbon, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.2, 0.585, 1.14], [0.36, 0.86, 0.66], [0.42, 1.0, 0.2], [0.4, 1.06, -0.08]].map((p) => new THREE.Vector3(side * p[0], p[1], p[2]))), 10, 0.022, 5, false));
  }
  put(carbon, bx(0.84, 0.03, 0.05, 0, 1.085, -0.07)); // 유리 위 틀
  put(dark, rod([0.02, 0.6, 1.1], [-0.16, 0.9, 0.55], 0.01)); // 와이퍼
  // 지붕 흡입구 (샤크핀으로 이어짐) + 지붕 불빛 + 안테나
  put(paint, loft([R(-0.12, 0.13, 1.05, 1.2, 3), R(-0.5, 0.15, 1.02, 1.2, 3), R(-1.0, 0.09, 0.95, 1.14, 3), R(-1.45, 0.03, 0.9, 1.08, 3)], 14));
  put(dark, loft([R(-0.105, 0.105, 1.075, 1.18, 3), R(-0.13, 0.105, 1.075, 1.18, 3)], 12));
  for (const side of [-1, 1]) put(glowTrim, bx(0.04, 0.02, 0.04, side * 0.22, 1.09, -0.3));
  put(carbon, rod([0.26, 1.05, -0.6], [0.26, 1.24, -0.68], 0.006));
  // 엔진 덮개 + 샤크핀 (번호) + 지느러미 줄
  put(paint, loft([R(-1.2, 0.36, 0.56, 0.9, 3), R(-2.0, 0.3, 0.54, 0.78, 3), R(-2.62, 0.22, 0.5, 0.62, 3)]));
  put(paint, plate([[-0.3, 1.04], [-2.45, 1.2], [-2.5, 0.62], [-1.2, 0.86]], 0.03));
  put(accent, plate([[-0.3, 1.042], [-2.45, 1.202], [-2.46, 1.15], [-0.5, 1.0]], 0.036));
  put(trim, plate([[-2.4, 1.14], [-2.455, 1.14], [-2.5, 0.64], [-2.445, 0.64]], 0.036));
  for (const side of [-1, 1]) {
    const p = add(new THREE.PlaneGeometry(0.34, 0.34), numMat, side * 0.02, 0.95, -1.6);
    p.rotation.y = side * Math.PI / 2;
    p.castShadow = false;
  }
  // ============================================================ 앞 스플리터 + 다이브 플레인 2단 + 세로 판
  const fWing = new THREE.Group();
  body.add(fWing);
  put(carbon, slab([[-0.98, 2.56], [-0.98, 2.92], [-0.4, 3.04], [0.4, 3.04], [0.98, 2.92], [0.98, 2.56]], 0.03, 0.145), fWing);
  put(dark, bx(0.5, 0.07, 0.03, 0, 0.2, 3.0), fWing); // 노즈 아래 공기 구멍
  for (const side of [-1, 1]) {
    put(trim, bx(0.24, 0.02, 0.15, side * 0.9, 0.36, 2.86, -0.2, 0, side * 0.3), fWing);
    put(trim, bx(0.2, 0.02, 0.13, side * 0.93, 0.5, 2.72, -0.3, 0, side * 0.3), fWing);
    put(carbon, plate([[3.0, 0.12], [2.98, 0.24], [2.6, 0.3], [2.56, 0.12]], 0.02, side * 1.0), fWing);
    put(dark, bx(0.16, 0.1, 0.03, side * 0.58, 0.25, 2.72, 0, side * -0.5, 0), fWing); // 노즈 옆 흡입구
  }
  // ============================================================ 뒤: LED 후미등 띠, 큰 디퓨저, 가운데 빨간 불
  put(tailMat, bx(1.36, 0.03, 0.04, 0, 0.66, -2.66));
  put(carbon, bx(1.5, 0.03, 0.56, 0, 0.25, -2.52, 0.4));
  for (const x of [-0.66, -0.4, -0.14, 0.14, 0.4, 0.66]) put(carbon, plate([[-2.24, 0.13], [-2.27, 0.22], [-2.76, 0.42], [-2.78, 0.13]], 0.018, x));
  put(tailMat, bx(0.07, 0.1, 0.02, 0, 0.3, -2.76));
  put(dark, bx(1.1, 0.14, 0.02, 0, 0.5, -2.632));
  // ============================================================ 백조목 뒷날개: 굽은 날개판 + 모양 잡힌 끝판
  const spoiler = new THREE.Group();
  body.add(spoiler);
  put(carbon, foil(-0.96, 0.96, -2.55, 1.17, 0.4, 0.05, 0.035), spoiler);
  const drs = add(foil(-0.955, 0.955, 0, 0, 0.21, 0.035, 0.01), paint, 0, 1.3, -2.7, spoiler);
  drs.rotation.x = 0.4;
  for (const side of [-1, 1]) {
    const ex = side * 0.97;
    put(paint, plate([[-2.22, 1.4], [-2.94, 1.4], [-2.98, 1.26], [-2.98, 0.98], [-2.84, 0.86], [-2.4, 0.86], [-2.26, 1.02]], 0.04, ex), spoiler);
    put(trim, plate([[-2.22, 1.402], [-2.94, 1.402], [-2.96, 1.34], [-2.23, 1.34]], 0.046, ex), spoiler);
    put(accent, plate([[-2.4, 0.9], [-2.84, 0.9], [-2.9, 0.98], [-2.34, 0.98]], 0.046, ex), spoiler);
    for (let i = 0; i < 3; i++) put(dark, bx(0.046, 0.012, 0.22, ex, 1.29 - i * 0.035, -2.4 - i * 0.012), spoiler);
    put(tailMat, bx(0.02, 0.3, 0.03, ex, 1.14, -2.985), spoiler);
    put(carbon, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(side * 0.3, 0.7, -2.1), new THREE.Vector3(side * 0.3, 1.18, -2.25), new THREE.Vector3(side * 0.3, 1.27, -2.5), new THREE.Vector3(side * 0.3, 1.21, -2.62)]), 12, 0.03, 6, false), spoiler);
  }
  put(carbon, bx(1.9, 0.03, 0.012, 0, 1.225, -2.752), spoiler); // 거니 플랩
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 0.86, -0.3);
  flush();
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.82, 0.48], r: [0.86, 0.58] },
      helmet: [0, 0.86, -0.3],
      visor: [0.96, -0.75],
      armor: { y: 0.66, x: 0.8 },
      ram: { y: 0.06, z: 1.78 },
      spines: [[-0.55, 1.12], [-1.0, 1.15], [-1.45, 1.18], [-1.9, 1.2]],
      booster: { x: 0.42, y0: 0.45, y1: 0.84, z0: -0.55, dz: -1.25 },
      lift: { y: 0.72, z: -2.45, h: 0.28 },
      stab: [0.98, 1.16, -2.6],
      tailFin: [0, 1.1, -0.85],
      wing: [0.8, 0.55, 0.0],
      nitro: { x: 0.3, y: 0.38, z: -2.25, dz: -0.42 },
      vents: [[0.74, 0.57, -0.1], [0.74, 0.58, -0.38], [0.74, 0.6, -0.66]],
      glow: { y: 0.46, z: 2.05, len: 1.3, rot: 0.11, w: 0.06 },
      flames: [[0, 0.42, 0.9, -2.66]],
      motor: [0.38, 0.32, -2.66],
      spark: [0.88, 0.25, -2.05],
      seams: [0.9, 0.17, -0.2],
      lean: 0.04,
      drsRest: 0.4,
    },
  };
}
