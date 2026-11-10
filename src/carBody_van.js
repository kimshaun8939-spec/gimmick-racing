// 차체 모양: buildVan (꼬마 큐브밴). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업: 투톤(허리 크림색 띠 + 앞 얼굴 V자 판), 창틀 기둥·앞유리 가운데 살·와이퍼, 미닫이 문 이음선·레일·손잡이, 발판,
//   크롬 테 둥근 눈 + 깜빡이 + 웃는 그릴, 범퍼 덧쇠, 둥근 백미러, 뒤 예비 바퀴 덮개·사다리·둥근 후미등,
//   지붕 짐칸 바구니 + 여행 가방·상자·돌돌 만 담요·서핑보드. 예전 파일: .debug/carBody_van.before-detail.js
import * as THREE from 'three';
import { R, arches, doorNumber, loft, makeHelmet, rodGeometry } from './carModel.js';
import { V, ribbon } from './carBody_buggy.js';

export function buildVan({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat, rubber } = M;
  const W = [
    [-0.8, 1.3, true, 0.31, 0.26, 0.4],
    [0.8, 1.3, true, 0.31, 0.26, 0.4],
    [-0.8, -1.3, false, 0.31, 0.26, 0.4],
    [0.8, -1.3, false, 0.31, 0.26, 0.4],
  ];
  const box = (w, h, d, mat, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
  const T = (a, b, r = 0.015, mat = metal, parent) => add(rodGeometry(V(a), V(b), r), mat, 0, 0, 0, parent);
  const flat = (m) => { m.castShadow = false; return m; };

  // ---- 아래 몸통 (네모 상자, 모서리만 살짝 둥글게) + 허리 크림색 띠 (투톤)
  add(loft([R(2.02, 0.74, 0.3, 0.8, 7), R(1.9, 0.86, 0.26, 0.9, 8), R(0.0, 0.88, 0.26, 0.92, 9), R(-1.9, 0.86, 0.26, 0.92, 8), R(-2.02, 0.76, 0.32, 0.88, 7)], 24), paint, 0, 0, 0);
  add(loft([R(2.03, 0.748, 0.7, 0.81, 10), R(1.91, 0.868, 0.74, 0.91, 10), R(0.0, 0.888, 0.76, 0.93, 12), R(-1.91, 0.868, 0.76, 0.93, 10), R(-2.03, 0.768, 0.74, 0.89, 10)], 24), accent, 0, 0, 0);
  arches(add, M, W, 0.03, 0.11, 0.1);
  // 큰 유리 캐빈 + 다른 색 지붕
  add(loft([R(1.88, 0.66, 0.86, 0.95, 7), R(1.5, 0.76, 0.88, 1.5, 7), R(0.0, 0.78, 0.88, 1.55, 8), R(-1.8, 0.76, 0.88, 1.52, 7), R(-1.96, 0.7, 0.88, 1.4, 7)], 24), glass, 0, 0, 0);
  add(loft([R(1.52, 0.74, 1.47, 1.56, 7), R(0.0, 0.8, 1.52, 1.62, 8), R(-1.8, 0.78, 1.49, 1.59, 7), R(-1.97, 0.7, 1.4, 1.47, 7)], 24), accent, 0, 0, 0);
  // 좌석 2개 + 계기판 + 핸들
  box(1.4, 0.08, 0.3, dark, 0, 0.94, 1.62);
  for (const x of [-0.32, 0.32]) {
    box(0.38, 0.5, 0.1, dark, x, 1.0, 0.62);
    box(0.2, 0.13, 0.08, dark, x, 1.3, 0.6);
  }
  add(new THREE.TorusGeometry(0.13, 0.02, 6, 14), carbon, 0.32, 1.02, 1.36).rotation.x = 1.0;
  // 앞유리 기둥 + 가운데 살 + 와이퍼
  for (const side of [-1, 1]) {
    T([side * 0.66, 0.92, 1.87], [side * 0.725, 1.49, 1.5], 0.04, accent);
    T([side * 0.04, 0.965, 1.9], [side * 0.48, 1.02, 1.87], 0.012, dark);
  }
  T([0, 0.94, 1.89], [0, 1.5, 1.515], 0.022, accent);

  for (const side of [-1, 1]) {
    // 창틀 기둥 4개 (크림색) + 창문 가운데 살
    for (const z of [1.42, 0.7, -0.6, -1.86]) box(0.05, 0.62, z === 0.7 || z === -0.6 ? 0.12 : 0.1, accent, side * 0.775, 1.2, z);
    flat(box(0.012, 0.58, 0.02, metal, side * 0.782, 1.2, 0.05));
    flat(box(0.012, 0.58, 0.02, metal, side * 0.782, 1.2, -1.25));
    // 주황 가는 줄 (띠 아래) + 미닫이 문 레일
    flat(box(0.012, 0.022, 2.5, trim, side * 0.889, 0.722, 0.72));
    flat(box(0.016, 0.03, 1.36, metal, side * 0.889, 0.722, -1.22));
    // 문 이음선 (앞문·미닫이 문) + 손잡이 + 발판
    for (const z of [0.7, -0.6]) flat(box(0.008, 0.4, 0.014, dark, side * 0.884, 0.52, z));
    flat(box(0.014, 0.03, 0.12, metal, side * 0.888, 0.64, 0.56));
    flat(box(0.014, 0.03, 0.12, metal, side * 0.888, 0.64, -0.46));
    box(0.07, 0.03, 1.1, metal, side * 0.88, 0.265, 0.05);
    // 둥근 백미러 (받침 + 거울)
    T([side * 0.8, 0.98, 1.5], [side * 0.98, 1.06, 1.58], 0.012);
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 12).rotateX(Math.PI / 2), accent, side * 0.99, 1.09, 1.585);
    flat(add(new THREE.CircleGeometry(0.06, 12).rotateY(Math.PI), dark, side * 0.99, 1.09, 1.571));
    // 동그란 눈 헤드라이트: 크롬 테 + 등 + 눈동자 + 주황 깜빡이
    flat(add(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 20).rotateX(Math.PI / 2), metal, side * 0.5, 0.6, 2.035));
    flat(add(new THREE.CircleGeometry(0.125, 18), lamp, side * 0.5, 0.6, 2.062));
    flat(add(new THREE.RingGeometry(0.05, 0.062, 14), metal, side * 0.5, 0.6, 2.064));
    flat(add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 10).rotateX(Math.PI / 2), trim, side * 0.5, 0.4, 2.03));
    // 둥근 후미등 (빨강 + 주황) + 머드플랩
    flat(add(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 12).rotateX(Math.PI / 2), metal, side * 0.6, 0.6, -2.025));
    flat(add(new THREE.CylinderGeometry(0.068, 0.068, 0.04, 12).rotateX(Math.PI / 2), tailMat, side * 0.6, 0.6, -2.03));
    flat(add(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 10).rotateX(Math.PI / 2), trim, side * 0.6, 0.45, -2.025));
    box(0.24, 0.2, 0.02, dark, side * 0.8, 0.2, -1.68);
    // 범퍼 덧쇠 + 둥근 끝
    for (const z of [2.04, -2.04]) {
      box(0.06, 0.2, 0.13, metal, side * 0.42, 0.36, z);
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10), metal, side * 0.8, 0.35, z * 0.99);
    }
  }
  doorNumber(add, M, 0.89, 0.54, 0.05, 0.34);
  // ---- 앞 얼굴: 크림색 V자 판 + 웃는 그릴 + 둥근 배지 + 범퍼 + 번호판
  const vs = new THREE.Shape();
  vs.moveTo(-0.62, 0.72);
  vs.lineTo(0.62, 0.72);
  vs.quadraticCurveTo(0.5, 0.48, 0, 0.4);
  vs.quadraticCurveTo(-0.5, 0.48, -0.62, 0.72);
  flat(add(new THREE.ShapeGeometry(vs, 8), accent, 0, 0, 2.026));
  for (const [y, w] of [[0.5, 0.3], [0.54, 0.36], [0.58, 0.3]]) flat(box(w, 0.018, 0.01, dark, 0, y, 2.03));
  flat(add(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 12).rotateX(Math.PI / 2), metal, 0, 0.66, 2.033));
  box(1.6, 0.12, 0.1, metal, 0, 0.35, 2.02);
  flat(box(1.5, 0.03, 0.012, dark, 0, 0.35, 2.074));
  flat(box(0.3, 0.085, 0.012, accent, 0, 0.35, 2.082));
  // ---- 뒤: 범퍼, 배기구, 예비 바퀴(크림색 덮개), 손잡이, 번호판, 사다리
  box(1.6, 0.12, 0.1, metal, 0, 0.35, -2.02);
  flat(box(1.5, 0.03, 0.012, dark, 0, 0.35, -2.074));
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 12).rotateX(Math.PI / 2), metal, 0.5, 0.26, -2.05);
  add(new THREE.TorusGeometry(0.2, 0.085, 8, 16), rubber, 0, 0.62, -2.09);
  add(new THREE.CylinderGeometry(0.205, 0.205, 0.13, 16).rotateX(Math.PI / 2), accent, 0, 0.62, -2.1);
  flat(add(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12).rotateX(Math.PI / 2), paint, 0, 0.62, -2.168));
  flat(box(0.008, 0.36, 0.014, dark, 0.3, 0.52, -2.022));
  flat(box(0.03, 0.12, 0.02, metal, 0.36, 0.62, -2.03));
  flat(box(0.26, 0.085, 0.012, accent, 0.45, 0.46, -2.026));
  for (const x of [-0.5, -0.3]) T([x, 0.44, -2.08], [x, 1.62, -2.02], 0.014);
  for (let i = 0; i < 6; i++) T([-0.5, 0.56 + i * 0.19, -2.074 + i * 0.0097], [-0.3, 0.56 + i * 0.19, -2.074 + i * 0.0097], 0.011);
  // ---- 지붕 짐칸: 바구니(아래 가로대 + 위 테) + 짐
  const RY = 1.71, RT = 1.8;
  for (const z of [0.82, 0.14, -0.54, -1.22]) T([-0.52, RY, z], [0.52, RY, z], 0.016);
  for (const side of [-1, 1]) {
    T([side * 0.52, RY, 0.82], [side * 0.52, RY, -1.22], 0.016);
    T([side * 0.54, RT, 0.86], [side * 0.54, RT, -1.26], 0.014);
    for (const z of [0.82, 0.14, -0.54, -1.22]) T([side * 0.52, 1.6, z], [side * 0.54, RT, z], 0.013);
  }
  T([-0.54, RT, 0.86], [0.54, RT, 0.86], 0.014);
  T([-0.54, RT, -1.26], [0.54, RT, -1.26], 0.014);
  // 여행 가방 (주황, 끈 2줄, 손잡이)
  box(0.44, 0.2, 0.66, trim, 0.26, 1.83, -0.7);
  for (const z of [-0.5, -0.9]) flat(box(0.45, 0.205, 0.05, dark, 0.26, 1.83, z));
  flat(box(0.02, 0.04, 0.16, metal, 0.49, 1.85, -0.7));
  // 작은 가죽 가방 + 크림색 끈
  const leather = new THREE.MeshStandardMaterial({ color: '#8a5a34', roughness: 0.7 });
  box(0.36, 0.15, 0.4, leather, 0.27, 1.805, -0.1);
  flat(box(0.37, 0.155, 0.045, accent, 0.27, 1.805, -0.1));
  // 돌돌 만 담요
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 12).rotateZ(Math.PI / 2), accent, 0.26, 1.82, 0.45);
  for (const x of [0.14, 0.38]) flat(add(new THREE.CylinderGeometry(0.094, 0.094, 0.03, 12).rotateZ(Math.PI / 2), dark, x, 1.82, 0.45));
  // 서핑보드 (차 색 + 크림색 줄 + 주황 가는 줄 + 지느러미)
  const BX = -0.28;
  const board = [R(1.0, 0.03, 1.745, 1.765, 2, BX), R(0.75, 0.14, 1.74, 1.775, 2, BX), R(-0.3, 0.2, 1.74, 1.78, 2, BX), R(-1.1, 0.16, 1.74, 1.775, 2, BX), R(-1.4, 0.04, 1.745, 1.765, 2, BX)];
  add(loft(board, 14), paint, 0, 0, 0);
  flat(add(ribbon(board, BX, 0.04, 0.004), accent, 0, 0, 0));
  flat(add(ribbon(board, BX, 0.008, 0.006), trim, 0, 0, 0));
  box(0.012, 0.09, 0.14, dark, BX, 1.82, -1.12).rotation.x = -0.4;
  for (const z of [0.4, -0.8]) flat(box(0.46, 0.012, 0.04, dark, BX, 1.782, z));
  // 앞 립
  const fWing = new THREE.Group();
  body.add(fWing);
  box(1.4, 0.03, 0.14, carbon, 0, 0.25, 2.06, fWing);
  // 지붕 끝 작은 날개 + 보조 브레이크등
  const spoiler = new THREE.Group();
  body.add(spoiler);
  box(1.3, 0.04, 0.26, accent, 0, 1.6, -1.98, spoiler).rotation.x = 0.1;
  const drs = box(1.3, 0.03, 0.1, carbon, 0, 1.64, -2.12, spoiler);
  drs.rotation.x = 0.3;
  flat(box(0.3, 0.02, 0.02, tailMat, 0, 1.575, -2.1, spoiler));
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0.32, 1.12, 0.95);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.74, 0.58], r: [0.74, 0.58] },
      helmet: [0.32, 1.12, 0.95],
      visor: [1.4, 0.4],
      armor: { y: 0.95, x: 0.88 },
      ram: { y: 0.2, z: 1.3 },
      spines: [[0.6, 1.64], [0.0, 1.66], [-0.6, 1.66], [-1.2, 1.64]],
      booster: { x: 0.9, y0: 0.6, y1: 1.1, z0: -0.4, dz: -1.2 },
      lift: { y: 1.44, z: -1.96, h: 0.2 },
      stab: [0.66, 1.6, -2.0],
      tailFin: [0, 1.64, -1.5],
      wing: [0.88, 0.75, 0.0],
      nitro: { x: 0.3, y: 0.3, z: -2.0, dz: -0.4 },
      vents: [[0.4, 0.94, 1.75], [0.4, 0.94, 1.6], [0.4, 0.94, 1.45]],
      glow: { y: 1.63, z: 0.2, len: 1.2, rot: 0, w: 0.05 },
      flames: [[-0.3, 0.3, 0.45, -2.14], [0.3, 0.3, 0.45, -2.14]],
      motor: [0.38, 0.4, -2.08],
      spark: [0.8, 0.25, -1.7],
      seams: [0.89, 0.28, 0.0],
      lean: 0.09,
      drsRest: 0.3,
    },
  };
}
