// 차체 모양: buildHatch (핫해치). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업: 검은 오버펜더 테, 보닛·지붕 쌍줄 스트라이프, 헤드라이트 집 + 주간등, 그릴 벌집 + 안개등 집, 앞 번호판·견인 고리,
//   A필러·지붕 옆 틀, 문 이음선·손잡이·옆 깜빡이·사선 무늬, 와이퍼, 좌석·핸들, 지붕 안테나, 후미등 띠·번호판·반사판·디퓨저 날, 큰 지붕 스포일러 + 보조 브레이크등
//   예전 파일: .debug/carBody_hatch.before-detail.js
import * as THREE from 'three';
import { R, archGeo, arches, doorNumber, loft, makeHelmet, rodGeometry } from './carModel.js';
import { V, ribbon } from './carBody_buggy.js';

export function buildHatch({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, lampYellow, tailMat } = M;
  const W = [
    [-0.82, 1.38, true, 0.34, 0.28, 0.4],
    [0.82, 1.38, true, 0.34, 0.28, 0.4],
    [-0.82, -1.3, false, 0.34, 0.28, 0.4],
    [0.82, -1.3, false, 0.34, 0.28, 0.4],
  ];
  const box = (w, h, d, mat, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
  const T = (a, b, r = 0.03, mat = paint, parent) => add(rodGeometry(V(a), V(b), r), mat, 0, 0, 0, parent);
  const flat = (m) => { m.castShadow = false; return m; };

  // ---- 몸통 (가운데 + 앞 범퍼 + 옆구리 + 뒤)
  const main = [R(2.22, 0.55, 0.3, 0.55), R(2.05, 0.78, 0.26, 0.66), R(1.0, 0.8, 0.26, 0.8), R(-1.6, 0.8, 0.27, 0.88), R(-2.0, 0.76, 0.3, 0.9), R(-2.08, 0.68, 0.36, 0.86)];
  add(loft(main, 24), paint, 0, 0, 0);
  add(loft([R(2.18, 0.7, 0.3, 0.6, 4), R(2.02, 0.86, 0.27, 0.66), R(1.72, 0.88, 0.27, 0.72)], 24), paint, 0, 0, 0);
  add(loft([R(0.95, 0.88, 0.28, 0.8), R(0.0, 0.9, 0.28, 0.82), R(-0.9, 0.89, 0.28, 0.85)], 24), paint, 0, 0, 0);
  add(loft([R(-1.62, 0.89, 0.29, 0.88), R(-1.95, 0.87, 0.3, 0.89), R(-2.07, 0.8, 0.34, 0.86)], 24), paint, 0, 0, 0);
  arches(add, M, W, 0.03, 0.12, 0.12);
  // 검은 오버펜더 테 (아치 바깥 면에만 얇게)
  for (const [x, z, , r, wd] of W) add(archGeo(r + 0.025, r + 0.135, 0.03), trim, Math.sign(x) * (Math.abs(x) + wd / 2 + 0.065), r, z);
  // 유리 캐빈 + 흰 지붕 (투톤)
  add(loft([R(0.85, 0.66, 0.8, 0.86, 4), R(0.3, 0.69, 0.83, 1.28, 4), R(-0.5, 0.7, 0.85, 1.36, 4), R(-1.7, 0.68, 0.87, 1.34, 4), R(-1.98, 0.64, 0.87, 1.2, 4)], 24), glass, 0, 0, 0);
  const roof = [R(0.25, 0.6, 1.27, 1.32, 3), R(-0.4, 0.665, 1.34, 1.39, 3), R(-1.7, 0.66, 1.33, 1.38, 3), R(-1.92, 0.62, 1.24, 1.3, 3)];
  add(loft(roof, 24), accent, 0, 0, 0);
  // 쌍줄 스트라이프: 보닛은 흰 줄, 흰 지붕은 차 색 줄 (운전석 쪽으로 치우침)
  const hood = [main[1], main[2], R(0.86, 0.8, 0.26, 0.805)];
  for (const [cx, sw] of [[0.2, 0.065], [0.33, 0.022]]) {
    flat(add(ribbon(hood, cx, sw), accent, 0, 0, 0));
    flat(add(ribbon(roof, cx, sw, 0.006), paint, 0, 0, 0));
  }
  // 좌석 2개 + 계기판 + 핸들 (유리 너머로 보임)
  box(1.26, 0.07, 0.34, dark, 0, 0.85, 0.52);
  for (const x of [-0.3, 0.3]) {
    box(0.36, 0.5, 0.1, dark, x, 0.98, -0.66).rotation.x = -0.12;
    box(0.2, 0.13, 0.08, dark, x, 1.25, -0.71);
  }
  add(new THREE.TorusGeometry(0.12, 0.02, 6, 14), carbon, 0.3, 0.95, 0.3).rotation.x = 0.5;

  for (const side of [-1, 1]) {
    // A필러 + 지붕 옆 틀 (차 색) + 뒤 기둥
    T([side * 0.655, 0.85, 0.86], [side * 0.615, 1.27, 0.3], 0.035);
    T([side * 0.615, 1.27, 0.3], [side * 0.675, 1.35, -0.42], 0.03);
    T([side * 0.675, 1.35, -0.42], [side * 0.668, 1.34, -1.7], 0.03);
    T([side * 0.668, 1.34, -1.7], [side * 0.65, 0.9, -2.0], 0.045);
    // 기둥 2개 (B·C필러)
    box(0.05, 0.46, 0.12, dark, side * 0.69, 1.08, -0.35).rotation.z = side * -0.06;
    box(0.04, 0.42, 0.08, dark, side * 0.685, 1.08, -1.2).rotation.z = side * -0.06;
    // 문 아래 줄 (옆 치마)
    flat(box(0.03, 0.07, 1.9, trim, side * 0.9, 0.34, 0.0));
    flat(box(0.02, 0.025, 1.9, accent, side * 0.905, 0.4, 0.0));
    // 문 이음선 2개 + 손잡이 + 옆 깜빡이 + 사선 무늬
    for (const z of [0.78, -0.44]) flat(box(0.008, 0.28, 0.014, dark, side * 0.902, 0.57, z));
    flat(box(0.014, 0.03, 0.13, metal, side * 0.905, 0.69, -0.3));
    flat(box(0.01, 0.03, 0.08, lampYellow, side * 0.9, 0.63, 0.87));
    for (const z of [-0.56, -0.66]) flat(box(0.008, 0.26, 0.045, accent, side * 0.903, 0.56, z)).rotation.x = 0.45;
    // 백미러 (받침 + 몸통 + 거울)
    box(0.1, 0.03, 0.05, dark, side * 0.72, 0.92, 0.62);
    box(0.15, 0.09, 0.1, accent, side * 0.8, 0.96, 0.62);
    flat(box(0.13, 0.07, 0.01, dark, side * 0.8, 0.96, 0.567));
    // 헤드라이트: 검은 집 + 비스듬한 등 + 가는 주간등
    const hh = box(0.4, 0.13, 0.04, dark, side * 0.55, 0.595, 2.105);
    hh.rotation.set(-0.3, side * 0.35, side * -0.12);
    const hl = flat(box(0.3, 0.07, 0.05, lamp, side * 0.56, 0.61, 2.125));
    hl.rotation.set(-0.3, side * 0.35, side * -0.12);
    const dl = flat(box(0.34, 0.014, 0.05, lamp, side * 0.545, 0.548, 2.135));
    dl.rotation.set(-0.3, side * 0.35, side * -0.12);
    // 안개등 (검은 집 + 둥근 등)
    box(0.22, 0.12, 0.05, dark, side * 0.6, 0.36, 2.19).rotation.y = side * 0.3;
    flat(add(new THREE.CircleGeometry(0.05, 12), lamp, side * 0.6, 0.36, 2.222)).rotation.y = side * 0.3;
    // 후미등 (세로로 긴 등 + 검은 테) + 반사판
    box(0.18, 0.34, 0.03, dark, side * 0.7, 0.86, -2.062);
    box(0.13, 0.28, 0.04, tailMat, side * 0.7, 0.86, -2.072);
    flat(box(0.14, 0.03, 0.02, tailMat, side * 0.56, 0.44, -2.085));
  }
  doorNumber(add, M, 0.902, 0.6, 0.16, 0.34);
  // 와이퍼 2개 + 지붕 안테나
  T([-0.08, 0.835, 0.89], [0.42, 0.865, 0.85], 0.012, dark);
  T([-0.58, 0.84, 0.87], [-0.14, 0.845, 0.89], 0.012, dark);
  box(0.03, 0.07, 0.16, dark, 0, 1.42, -1.45).rotation.x = -0.35;
  // ---- 앞: 벌집 그릴 + 빨간 줄 (핫해치 표시) + 아래 공기구멍 + 번호판 + 견인 고리
  box(0.86, 0.16, 0.04, dark, 0, 0.5, 2.21);
  flat(box(0.9, 0.025, 0.045, tailMat, 0, 0.6, 2.2));
  for (let i = -3; i <= 3; i++) flat(box(0.012, 0.14, 0.05, carbon, i * 0.12, 0.5, 2.22));
  for (const y of [0.465, 0.535]) flat(box(0.84, 0.01, 0.05, carbon, 0, y, 2.22));
  box(0.9, 0.1, 0.04, dark, 0, 0.32, 2.22);
  flat(box(0.34, 0.085, 0.012, accent, 0, 0.33, 2.245));
  add(new THREE.TorusGeometry(0.035, 0.012, 5, 10), tailMat, -0.52, 0.29, 2.26);
  // ---- 뒤: 후미등 사이 검은 띠, 손잡이, 번호판, 뒤 와이퍼, 디퓨저 + 날, 가운데 쌍 배기구
  flat(box(1.22, 0.05, 0.02, dark, 0, 0.9, -2.078));
  box(0.5, 0.04, 0.03, metal, 0, 0.74, -2.09);
  flat(box(0.36, 0.1, 0.012, accent, 0, 0.58, -2.092));
  T([0.0, 0.93, -2.07], [0.3, 1.08, -2.02], 0.01, dark);
  box(1.3, 0.12, 0.04, dark, 0, 0.36, -2.062);
  const diff = box(1.15, 0.04, 0.28, carbon, 0, 0.3, -1.98);
  diff.rotation.x = 0.3;
  for (const x of [-0.42, -0.28, 0.28, 0.42]) box(0.014, 0.08, 0.26, carbon, x, 0.285, -2.0).rotation.x = 0.3;
  for (const x of [-0.12, 0.12]) {
    add(new THREE.CylinderGeometry(0.06, 0.065, 0.2, 14).rotateX(Math.PI / 2), metal, x, 0.32, -2.1);
    flat(add(new THREE.CircleGeometry(0.048, 12).rotateY(Math.PI), dark, x, 0.32, -2.202));
  }
  // 앞 립 (스플리터 + 옆 작은 날개)
  const fWing = new THREE.Group();
  body.add(fWing);
  box(1.5, 0.03, 0.2, carbon, 0, 0.27, 2.2, fWing);
  for (const side of [-1, 1]) {
    box(0.18, 0.02, 0.1, trim, side * 0.66, 0.3, 2.24, fWing);
    box(0.02, 0.07, 0.16, carbon, side * 0.75, 0.3, 2.2, fWing);
  }
  // 지붕 스포일러 (옆판 + 보조 브레이크등)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  box(1.3, 0.05, 0.36, paint, 0, 1.365, -2.0, spoiler).rotation.x = 0.1;
  const drs = box(1.3, 0.035, 0.12, carbon, 0, 1.41, -2.18, spoiler);
  drs.rotation.x = 0.3;
  for (const side of [-1, 1]) box(0.03, 0.16, 0.42, carbon, side * 0.655, 1.35, -2.04, spoiler);
  flat(box(0.34, 0.02, 0.02, tailMat, 0, 1.335, -2.175, spoiler));
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0.3, 1.0, -0.4);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.76, 0.6], r: [0.76, 0.62] },
      helmet: [0.3, 1.0, -0.4],
      visor: [1.22, -0.85],
      armor: { y: 0.84, x: 0.82 },
      ram: { y: 0.18, z: 1.45 },
      spines: [[-0.5, 1.42], [-0.9, 1.42], [-1.3, 1.41], [-1.7, 1.4]],
      booster: { x: 0.84, y0: 0.58, y1: 1.0, z0: -0.5, dz: -1.2 },
      lift: { y: 1.22, z: -1.95, h: 0.2 },
      stab: [0.655, 1.36, -2.02],
      tailFin: [0, 1.38, -0.55],
      wing: [0.88, 0.6, 0.0],
      nitro: { x: 0.12, y: 0.32, z: -2.08, dz: -0.4 },
      vents: [[0.36, 0.73, 1.2], [0.36, 0.71, 1.45], [0.36, 0.69, 1.7]],
      glow: { y: 0.745, z: 1.5, len: 1.0, rot: 0.12, w: 0.05 },
      flames: [[-0.12, 0.32, 0.45, -2.22], [0.12, 0.32, 0.45, -2.22]],
      motor: [0.38, 0.4, -2.12],
      spark: [0.82, 0.25, -1.75],
      seams: [0.9, 0.28, 0.0],
      lean: 0.08,
      drsRest: 0.3,
    },
  };
}
