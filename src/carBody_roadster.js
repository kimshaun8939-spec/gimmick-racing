// 차체 모양: buildRoadster (carModel.js에서 떼어 낸 파일, 2026-11-10). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업 (고치기 전: .debug/carBody_roadster.before-detail.js)
//   긴 보닛(가운데 크롬 줄 + 통풍 살 + 가죽 끈), 크롬 그릴(세로 살), 스탠드에 달린 둥근 헤드라이트, 작은 바람막이 2개,
//   가죽 좌석·운전석 테두리, 나무 핸들·계기판, 옆 배기관, 보트 꼬리 + 주유구 뚜껑 + 짐받이
import * as THREE from 'three';
import { R, doorNumber, loft, makeHelmet, rodGeometry } from './carModel.js';

export function buildRoadster({ add, body, M }) {
  const { paint, accent, carbon, dark, glass, lamp, lampYellow, tailMat } = M;
  // 이 파일에서만 쓰는 재질 (dispose는 carModel이 같이 함)
  const chrome = new THREE.MeshStandardMaterial({ color: '#e3e6ea', roughness: 0.22, metalness: 0.5 });
  const leather = new THREE.MeshStandardMaterial({ color: '#7a3b22', roughness: 0.7 });
  const leatherDark = new THREE.MeshStandardMaterial({ color: '#4f2413', roughness: 0.75 });
  const wood = new THREE.MeshStandardMaterial({ color: '#9a6a3a', roughness: 0.5 });
  const box = (mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, parent) => {
    const m = add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
    m.rotation.set(rx, ry, rz);
    return m;
  };
  const deco = (...a) => {
    const m = box(...a);
    m.castShadow = false;
    return m;
  };
  const rod = (mat, a, b, r = 0.02, parent) => add(rodGeometry(new THREE.Vector3(...a), new THREE.Vector3(...b), r), mat, 0, 0, 0, parent);

  const W = [
    [-0.84, 1.45, true, 0.34, 0.24, 0.38],
    [0.84, 1.45, true, 0.34, 0.24, 0.38],
    [-0.84, -1.3, false, 0.35, 0.26, 0.4],
    [0.84, -1.3, false, 0.35, 0.26, 0.4],
  ];
  // ---------------- 몸통: 긴 보닛 → 운전석 → 뾰족하게 모이는 보트 꼬리
  add(loft([R(2.32, 0.4, 0.33, 0.6, 3), R(2.2, 0.5, 0.29, 0.68, 3), R(1.9, 0.6, 0.27, 0.72, 3), R(1.0, 0.66, 0.27, 0.75, 3), R(-0.2, 0.68, 0.27, 0.75, 3), R(-1.3, 0.68, 0.28, 0.77, 3), R(-1.85, 0.58, 0.3, 0.74, 3), R(-2.15, 0.42, 0.34, 0.68, 3), R(-2.3, 0.22, 0.4, 0.6, 3)], 24), paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    const xf = side * 0.74, xr = side * 0.76;
    // 물결처럼 흐르는 앞·뒤 펜더
    add(loft([R(2.26, 0.08, 0.38, 0.56, 3, xf), R(2.05, 0.18, 0.3, 0.72, 3, xf), R(1.75, 0.205, 0.3, 0.8, 3, xf), R(1.45, 0.215, 0.3, 0.83, 3, xf), R(1.1, 0.2, 0.3, 0.78, 3, xf), R(0.75, 0.15, 0.3, 0.64, 3, xf), R(0.4, 0.08, 0.3, 0.46, 3, xf)], 20), paint, 0, 0, 0);
    add(loft([R(-0.5, 0.08, 0.3, 0.5, 3, xr), R(-0.8, 0.18, 0.3, 0.72, 3, xr), R(-1.05, 0.205, 0.3, 0.82, 3, xr), R(-1.3, 0.215, 0.3, 0.85, 3, xr), R(-1.65, 0.2, 0.3, 0.8, 3, xr), R(-1.95, 0.15, 0.32, 0.68, 3, xr), R(-2.16, 0.08, 0.36, 0.56, 3, xr)], 20), paint, 0, 0, 0);
    // 펜더 사이 발판 (크롬 테)
    box(paint, 0.2, 0.04, 1.0, side * 0.78, 0.3, -0.05);
    deco(chrome, 0.022, 0.022, 1.0, side * 0.885, 0.32, -0.05);
    // 헤드라이트: 크롬 통 + 테 + 전구, 짧은 다리
    add(new THREE.SphereGeometry(0.135, 14, 10).scale(1, 1, 1.25), chrome, side * 0.47, 0.72, 2.12);
    add(new THREE.CircleGeometry(0.105, 18), lamp, side * 0.47, 0.72, 2.262).castShadow = false;
    add(new THREE.TorusGeometry(0.112, 0.016, 6, 18), chrome, side * 0.47, 0.72, 2.25).castShadow = false;
    rod(chrome, [side * 0.47, 0.6, 2.1], [side * 0.5, 0.5, 2.05], 0.025);
    // 펜더 위 작은 옆등 + 펜더 거울
    add(new THREE.SphereGeometry(0.04, 8, 6), lampYellow, side * 0.76, 0.845, 1.6).castShadow = false;
    rod(chrome, [side * 0.78, 0.82, 1.15], [side * 0.8, 0.94, 1.12], 0.012);
    add(new THREE.CylinderGeometry(0.065, 0.065, 0.025, 12).rotateX(Math.PI / 2), chrome, side * 0.8, 0.97, 1.12);
    // 둥근 후미등 (크롬 테)
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 14).rotateX(Math.PI / 2), chrome, side * 0.76, 0.62, -2.13);
    add(new THREE.CircleGeometry(0.06, 14).rotateY(Math.PI), tailMat, side * 0.76, 0.62, -2.158).castShadow = false;
    // 헤드레스트 혹 (좌석 뒤로 길게)
    add(loft([R(-0.72, 0.15, 0.72, 0.97, 3, side * 0.3), R(-1.0, 0.16, 0.72, 0.98, 3, side * 0.3), R(-1.5, 0.11, 0.72, 0.86, 3, side * 0.3), R(-2.0, 0.04, 0.68, 0.74, 3, side * 0.3)], 16), paint, 0, 0, 0);
    // 문 틈 + 크롬 손잡이 + 원형 번호판 바탕
    deco(dark, 0.012, 0.36, 0.012, side * 0.682, 0.54, 0.5);
    deco(dark, 0.012, 0.36, 0.012, side * 0.69, 0.54, -0.42);
    deco(chrome, 0.02, 0.025, 0.12, side * 0.695, 0.68, -0.28);
    const disc = add(new THREE.CircleGeometry(0.24, 24), accent, side * 0.692, 0.52, 0.06);
    disc.rotation.y = side * Math.PI / 2;
    disc.castShadow = false;
    // 보닛 통풍 살 (양옆 7개씩)
    for (let i = 0; i < 7; i++) deco(dark, 0.2, 0.012, 0.045, side * 0.3, 0.742, 0.82 + i * 0.1, 0.35, 0, side * -0.08);
    // 보닛 옆면 통풍 살 3개
    for (let i = 0; i < 3; i++) deco(dark, 0.012, 0.035, 0.26, side * 0.655, 0.5 + i * 0.07, 1.25);
    // 운전석 옆 가죽 테두리
    rod(leather, [side * 0.56, 0.775, 0.3], [side * 0.6, 0.78, -0.7], 0.04);
    // 작은 바람막이 (좌우 하나씩, 크롬 틀)
    box(glass, 0.44, 0.2, 0.015, side * 0.29, 0.89, 0.36, -0.45);
    rod(chrome, [side * 0.07, 0.79, 0.41], [side * 0.09, 0.97, 0.32], 0.014);
    rod(chrome, [side * 0.51, 0.79, 0.41], [side * 0.49, 0.97, 0.32], 0.014);
    rod(chrome, [side * 0.09, 0.97, 0.32], [side * 0.49, 0.97, 0.32], 0.014);
  }
  doorNumber(add, M, 0.695, 0.52, 0.06, 0.29);
  // ---------------- 운전석: 바닥, 가죽 좌석 2개(등받이 + 방석 + 누빔 줄), 뒤 가죽 테두리, 계기판, 나무 핸들, 기어봉
  box(dark, 1.04, 0.04, 1.0, 0, 0.74, -0.2);
  for (const sx of [-0.3, 0.3]) {
    box(leather, 0.42, 0.44, 0.11, sx, 0.9, -0.72, -0.2);
    box(leather, 0.42, 0.08, 0.4, sx, 0.79, -0.48);
    for (const dx of [-0.1, 0, 0.1]) deco(leatherDark, 0.012, 0.36, 0.012, sx + dx, 0.91, -0.66, -0.2);
  }
  rod(leather, [-0.6, 0.78, -0.72], [0.6, 0.78, -0.72], 0.04);
  rod(leather, [-0.56, 0.775, 0.3], [0.56, 0.775, 0.3], 0.04);
  box(wood, 1.0, 0.14, 0.03, 0, 0.8, 0.25, -0.2);
  for (const [x, rr] of [[0.2, 0.05], [0.4, 0.05], [-0.1, 0.03], [-0.3, 0.04]]) {
    const g = add(new THREE.CylinderGeometry(rr, rr, 0.02, 12).rotateX(Math.PI / 2), chrome, x, 0.81, 0.23);
    g.rotation.x = -0.2;
    g.castShadow = false;
  }
  const wheel = add(new THREE.TorusGeometry(0.15, 0.018, 6, 20), wood, 0.3, 0.9, 0.1);
  wheel.rotation.x = -0.5;
  for (const a of [0, 2.1, 4.2]) {
    const sp = box(chrome, 0.012, 0.15, 0.012, 0.3 + Math.sin(a) * 0.075, 0.9 + Math.cos(a) * 0.066, 0.1 + Math.cos(a) * 0.036, -0.5, 0, -a);
    sp.castShadow = false;
  }
  rod(chrome, [0.3, 0.9, 0.1], [0.3, 0.82, 0.24], 0.014);
  rod(chrome, [0, 0.76, -0.25], [0, 0.9, -0.2], 0.012);
  add(new THREE.SphereGeometry(0.03, 8, 6), wood, 0, 0.91, -0.2);
  // ---------------- 보닛·꼬리 가운데 줄 + 크롬 등뼈 + 가죽 끈(버클)
  deco(accent, 0.24, 0.012, 1.62, 0, 0.748, 1.2);
  deco(accent, 0.24, 0.012, 0.3, 0, 0.72, 2.1, 0.22);
  deco(accent, 0.2, 0.012, 0.95, 0, 0.765, -1.5, -0.04);
  deco(chrome, 0.025, 0.02, 1.7, 0, 0.754, 1.22);
  for (const z of [1.78, 0.62]) {
    deco(leatherDark, 0.62, 0.014, 0.07, 0, 0.757, z);
    for (const side of [-1, 1]) deco(leatherDark, 0.34, 0.014, 0.07, side * 0.455, 0.71, z, 0, 0, side * -0.33);
    deco(chrome, 0.06, 0.02, 0.09, 0.2, 0.762, z);
  }
  // ---------------- 앞: 세워진 크롬 그릴(테 + 세로 살) + 배지 + 크롬 범퍼(세로 가드) + 번호판
  const shell = add(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 22).rotateX(Math.PI / 2), chrome, 0, 0.49, 2.3);
  shell.scale.set(1.25, 0.82, 1);
  const gr = add(new THREE.CylinderGeometry(0.21, 0.21, 0.04, 22).rotateX(Math.PI / 2), dark, 0, 0.49, 2.345);
  gr.scale.set(1.25, 0.8, 1);
  for (let i = -3; i <= 3; i++) {
    const h = 0.32 * Math.sqrt(1 - (i * 0.07 / 0.27) ** 2);
    deco(chrome, 0.018, h, 0.02, i * 0.07, 0.49, 2.37);
  }
  deco(accent, 0.07, 0.07, 0.02, 0, 0.71, 2.33, 0, 0, Math.PI / 4);
  const fWing = new THREE.Group();
  body.add(fWing);
  rod(chrome, [-0.82, 0.36, 2.42], [0.82, 0.36, 2.42], 0.035, fWing);
  for (const x of [-0.3, 0.3]) {
    box(chrome, 0.05, 0.16, 0.05, x, 0.37, 2.45, 0, 0, 0, fWing);
    rod(chrome, [x, 0.36, 2.42], [x, 0.36, 2.2], 0.02, fWing);
  }
  rod(chrome, [-0.82, 0.38, -2.3], [0.82, 0.38, -2.3], 0.035);
  for (const x of [-0.3, 0.3]) {
    box(chrome, 0.05, 0.16, 0.05, x, 0.39, -2.33);
    rod(chrome, [x, 0.38, -2.3], [x, 0.4, -2.1], 0.02);
  }
  // ---------------- 옆 배기관 (오른쪽: 보닛에서 나온 관 3개 → 긴 크롬 관) + 열 가리개
  for (let i = 0; i < 3; i++) rod(chrome, [0.6, 0.5, 1.0 - i * 0.16], [0.72, 0.36, 0.84 - i * 0.16], 0.028);
  add(new THREE.CylinderGeometry(0.055, 0.055, 2.5, 10).rotateX(Math.PI / 2), chrome, 0.735, 0.36, -0.42);
  add(new THREE.CylinderGeometry(0.07, 0.06, 0.16, 10).rotateX(Math.PI / 2), chrome, 0.735, 0.36, -1.72);
  add(new THREE.CircleGeometry(0.05, 10).rotateY(Math.PI), dark, 0.735, 0.36, -1.802).castShadow = false;
  for (let i = 0; i < 5; i++) deco(dark, 0.02, 0.07, 0.1, 0.795, 0.37, 0.2 - i * 0.17);
  // 왼쪽: 뒤 배기구 하나
  add(new THREE.CylinderGeometry(0.05, 0.055, 0.22, 12).rotateX(Math.PI / 2), chrome, -0.4, 0.33, -2.2);
  // ---------------- 꼬리: 덕테일 + 크롬 짐받이 + 큰 주유구 뚜껑
  const spoiler = new THREE.Group();
  body.add(spoiler);
  box(paint, 0.8, 0.035, 0.18, 0, 0.72, -2.14, -0.3, 0, 0, spoiler);
  const drs = box(chrome, 0.8, 0.02, 0.03, 0, 0.83, -1.87, 0.15, 0, 0, spoiler);
  for (const x of [-0.36, -0.12, 0.12, 0.36]) box(chrome, 0.02, 0.02, 0.42, x, 0.825, -1.68, 0, 0, 0, spoiler).castShadow = false;
  box(chrome, 0.8, 0.02, 0.03, 0, 0.825, -1.48, 0, 0, 0, spoiler);
  for (const x of [-0.36, 0.36]) for (const z of [-1.5, -1.85]) rod(chrome, [x, 0.76, z], [x, 0.825, z], 0.012, spoiler);
  add(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 14), chrome, 0, 0.79, -1.22);
  box(chrome, 0.2, 0.015, 0.03, 0, 0.82, -1.22, 0, 0.5);
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0.3, 1.02, -0.45);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.74, 0.56], r: [0.74, 0.58] },
      helmet: [0.3, 1.02, -0.45],
      visor: [0.98, -0.7],
      armor: { y: 0.72, x: 0.74 },
      ram: { y: 0.15, z: 1.5 },
      spines: [[-0.9, 1.0], [-1.25, 0.96], [-1.6, 0.88], [-1.95, 0.8]],
      booster: { x: 0.6, y0: 0.5, y1: 0.86, z0: -0.5, dz: -1.2 },
      lift: { y: 0.72, z: -2.0, h: 0.2 },
      stab: [0.56, 0.78, -2.05],
      tailFin: [0, 0.96, -1.1],
      wing: [0.75, 0.55, 0.0],
      nitro: { x: 0.4, y: 0.32, z: -2.18, dz: -0.4 },
      vents: [[0.32, 0.76, 1.0], [0.32, 0.75, 1.25], [0.32, 0.74, 1.5]],
      glow: { y: 0.77, z: 1.3, len: 1.1, rot: 0.02, w: 0.05 },
      flames: [[-0.4, 0.33, 0.45, -2.34], [0.735, 0.36, 0.45, -1.85]],
      motor: [0.36, 0.38, -2.2],
      spark: [0.84, 0.24, -1.7],
      seams: [0.76, 0.25, 0.0],
      lean: 0.09,
      drsRest: 0.15,
    },
  };
}
