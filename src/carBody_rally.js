// 차체 모양: buildRally (carModel.js에서 떼어 낸 파일, 2026-11-10). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업: 부푼 펜더, 보닛 라이트 포드, 큰 2단 뒷날개, 롤케이지, 리버리 줄무늬, 그릴·디퓨저·견인고리 등
//   (고치기 전: .debug/carBody_rally.before-detail.js)
import * as THREE from 'three';
import { R, archGeo, arches, doorNumber, loft, makeHelmet, rodGeometry } from './carModel.js';

export function buildRally({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat, glowTrim } = M;
  // 이 파일에서만 쓰는 재질 (차를 지울 때 carModel의 dispose가 같이 정리함)
  const white = new THREE.MeshStandardMaterial({ color: '#e9ecf0', roughness: 0.5, metalness: 0.1 });
  const cage = new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.4, metalness: 0.3, emissive: '#3a3d42' });
  // 도우미: 상자 / 그림자 없는 얇은 판 / 막대
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
  const rod = (mat, a, b, r = 0.022, parent) => add(rodGeometry(new THREE.Vector3(...a), new THREE.Vector3(...b), r), mat, 0, 0, 0, parent);

  const W = [
    [-0.85, 1.45, true, 0.37, 0.32, 0.4],
    [0.85, 1.45, true, 0.37, 0.32, 0.4],
    [-0.85, -1.38, false, 0.37, 0.32, 0.4],
    [0.85, -1.38, false, 0.37, 0.32, 0.4],
  ];
  // ---------------- 몸통
  add(loft([R(2.4, 0.5, 0.36, 0.6), R(2.18, 0.66, 0.3, 0.72), R(0.9, 0.68, 0.3, 0.86), R(-1.9, 0.68, 0.3, 0.92), R(-2.18, 0.6, 0.36, 0.9)], 24), paint, 0, 0, 0);
  add(loft([R(2.46, 0.62, 0.33, 0.57, 4), R(2.34, 0.88, 0.28, 0.66), R(1.88, 0.94, 0.28, 0.78)], 24), paint, 0, 0, 0);
  add(loft([R(1.02, 0.94, 0.3, 0.84), R(0.0, 0.96, 0.3, 0.87), R(-0.97, 0.95, 0.3, 0.9)], 24), paint, 0, 0, 0);
  add(loft([R(-1.82, 0.95, 0.3, 0.92), R(-2.12, 0.93, 0.32, 0.92), R(-2.21, 0.84, 0.36, 0.88)], 24), paint, 0, 0, 0);
  // 보닛 (앞으로 갈수록 낮아짐, 기울기 약 0.18)
  const hoodY = (z) => 0.6 + (2.42 - z) * 0.184;
  add(loft([R(2.42, 0.6, 0.45, hoodY(2.42), 4), R(2.2, 0.69, 0.45, hoodY(2.2), 5), R(1.5, 0.7, 0.5, hoodY(1.5), 5), R(0.95, 0.7, 0.5, hoodY(0.95), 5)], 24), paint, 0, 0, 0);
  // 넓게 부푼 휠 아치: 차체색 아치 + 그 위를 덮는 펜더 덩어리 + 검은 테두리
  arches(add, M, W, 0.03, 0.15, 0.16);
  for (const [x, z, , r, wd] of W) {
    add(archGeo(r + 0.15, r + 0.185, wd + 0.2), carbon, x + Math.sign(x) * 0.02, r, z);
    add(loft([R(z + 0.66, 0.2, 0.42, 0.66, 4, x), R(z + 0.52, 0.235, 0.56, 0.78, 4, x), R(z + 0.4, 0.245, 0.7, 0.85, 4, x), R(z + 0.2, 0.25, 0.82, 0.915, 4, x), R(z, 0.25, 0.86, 0.935, 4, x), R(z - 0.2, 0.25, 0.82, 0.92, 4, x), R(z - 0.4, 0.245, 0.7, 0.87, 4, x), R(z - 0.52, 0.235, 0.56, 0.8, 4, x), R(z - 0.66, 0.2, 0.42, 0.7, 4, x)], 12), paint, 0, 0, 0);
  }
  // ---------------- 캐빈: 유리 + 지붕 + 기둥
  add(loft([R(0.98, 0.66, 0.82, 0.87, 4), R(0.4, 0.68, 0.84, 1.3, 4), R(-0.4, 0.69, 0.86, 1.4, 4), R(-1.72, 0.67, 0.88, 1.4, 4), R(-2.1, 0.64, 0.88, 1.35, 4)], 24), glass, 0, 0, 0);
  add(loft([R(0.32, 0.6, 1.31, 1.36, 3), R(-0.3, 0.665, 1.39, 1.44, 3), R(-1.72, 0.665, 1.395, 1.445, 3), R(-2.04, 0.63, 1.35, 1.4, 3)], 24), paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    rod(paint, [side * 0.67, 0.86, 0.95], [side * 0.63, 1.34, 0.3], 0.04); // A필러
    box(paint, 0.05, 0.5, 0.13, side * 0.685, 1.12, -0.62, 0, 0, side * -0.05); // B필러
    box(paint, 0.05, 0.46, 0.2, side * 0.675, 1.1, -1.98, 0, 0, side * -0.04); // C필러 (뒤 옆판)
    deco(dark, 0.03, 0.035, 2.75, side * 0.7, 0.885, -0.42); // 창문 아래 고무 줄
    // 앞유리 와이퍼
    rod(dark, [side * 0.12 - 0.2, 0.87, 0.97], [side * 0.12 + 0.12, 1.06, 0.72], 0.012).castShadow = false;
  }
  // 앞유리 위 햇빛 가리개 띠 (리버리 색)
  deco(accent, 1.2, 0.012, 0.2, 0, 1.305, 0.36, -0.62);
  deco(trim, 1.2, 0.013, 0.035, 0, 1.25, 0.44, -0.62);
  // 뒷유리 와이퍼 + 뒷유리 아래 문 틈
  rod(dark, [-0.3, 0.93, -2.13], [0.15, 1.1, -2.125], 0.012).castShadow = false;
  // 안쪽 롤케이지 (유리 너머로 보임) + 버킷 시트
  for (const side of [-1, 1]) {
    rod(cage, [side * 0.56, 0.86, -0.72], [side * 0.52, 1.33, -0.72], 0.028);
    rod(cage, [side * 0.52, 1.33, -0.72], [side * 0.5, 1.26, 0.2], 0.026);
    rod(cage, [side * 0.5, 1.26, 0.2], [side * 0.56, 0.86, 0.72], 0.026);
    rod(cage, [side * 0.52, 1.33, -0.72], [side * 0.5, 0.9, -1.75], 0.026);
    rod(cage, [side * 0.56, 0.9, 0.6], [side * 0.56, 1.02, -0.72], 0.022); // 문 가로대
  }
  rod(cage, [-0.52, 1.33, -0.72], [0.52, 1.33, -0.72], 0.028);
  rod(cage, [-0.56, 0.88, -0.72], [0.52, 1.33, -0.72], 0.024);
  rod(cage, [-0.5, 1.26, 0.2], [0.5, 1.26, 0.2], 0.024);
  box(dark, 0.42, 0.62, 0.12, 0.3, 0.98, -0.66, -0.12);
  box(dark, 0.42, 0.62, 0.12, -0.3, 0.98, -0.66, -0.12);
  // ---------------- 지붕: 공기구멍(검은 입) + 환기 뚜껑 + 안테나 2개 + 지붕 줄무늬
  add(loft([R(0.25, 0.13, 1.4, 1.42, 3), R(0.07, 0.19, 1.4, 1.55, 3), R(-0.35, 0.19, 1.42, 1.55, 3), R(-0.55, 0.15, 1.42, 1.47, 3)]), paint, 0, 0, 0);
  box(dark, 0.3, 0.1, 0.03, 0, 1.485, 0.075, -0.25);
  deco(carbon, 0.36, 0.02, 0.05, 0, 1.56, 0.07);
  for (const side of [-1, 1]) deco(carbon, 0.2, 0.025, 0.26, side * 0.42, 1.455, -0.95, 0.06);
  rod(carbon, [0.4, 1.44, -1.5], [0.44, 1.98, -1.7], 0.008);
  rod(carbon, [-0.4, 1.44, -1.6], [-0.42, 1.74, -1.72], 0.008);
  deco(accent, 0.3, 0.012, 1.02, -0.36, 1.448, -1.2);
  deco(trim, 0.07, 0.012, 1.02, -0.13, 1.448, -1.2);
  // ---------------- 옆: 리버리, 문 틈, 손잡이, 사이드 스커트, 백미러, 머드플랩
  for (const side of [-1, 1]) {
    const sx = side * 0.968;
    deco(accent, 0.02, 0.12, 1.95, sx, 0.42, 0.02); // 문 아래 굵은 띠
    deco(trim, 0.02, 0.04, 1.95, sx + side * 0.003, 0.5, 0.02);
    // 뒤로 치켜 올라가는 사선 줄 3개
    deco(accent, 0.02, 0.1, 0.62, sx, 0.66, -0.56, 0.62);
    deco(trim, 0.02, 0.05, 0.56, sx, 0.66, -0.4, 0.62);
    deco(accent, 0.02, 0.04, 0.5, sx, 0.66, -0.3, 0.62);
    // 앞 펜더 뒤 사선 (짧게)
    deco(trim, 0.02, 0.05, 0.3, sx, 0.68, 0.72, 0.62);
    deco(accent, 0.02, 0.05, 0.3, sx, 0.68, 0.6, 0.62);
    // 문 틈 (세로 2줄) + 손잡이
    deco(dark, 0.012, 0.5, 0.014, side * 0.972, 0.6, 0.86);
    deco(dark, 0.012, 0.5, 0.014, side * 0.975, 0.6, -0.34);
    deco(dark, 0.02, 0.03, 0.13, side * 0.975, 0.78, -0.18);
    // 사이드 스커트 (카본)
    box(carbon, 0.07, 0.07, 1.86, side * 0.955, 0.3, 0.03);
    // 백미러: 다리 + 몸통(차체색) + 거울면
    rod(carbon, [side * 0.7, 0.93, 0.74], [side * 0.84, 0.99, 0.72], 0.018);
    box(paint, 0.17, 0.11, 0.1, side * 0.9, 1.0, 0.72);
    deco(dark, 0.14, 0.085, 0.01, side * 0.9, 1.0, 0.668);
    // 머드플랩 (바퀴 뒤) + 작은 줄
    for (const z of [1.45 - 0.52, -1.38 - 0.52]) {
      box(trim, 0.36, 0.24, 0.025, side * 0.85, 0.22, z, -0.12);
      deco(white, 0.3, 0.035, 0.027, side * 0.85, 0.25, z + 0.006, -0.12);
    }
  }
  // 주유구 (왼쪽 뒤)
  const cap = add(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 14).rotateZ(Math.PI / 2), metal, -0.7, 1.0, -1.92);
  cap.castShadow = false;
  doorNumber(add, M, 0.975, 0.66, 0.16, 0.4);
  // ---------------- 보닛: 검은 판 + 통풍구 + 핀 + 가운데 줄
  const hoodRot = 0.182;
  deco(accent, 0.86, 0.012, 0.62, 0, hoodY(1.42) + 0.006, 1.42, hoodRot);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) deco(dark, 0.2, 0.014, 0.05, side * 0.24, hoodY(1.28 + i * 0.1) + 0.012, 1.28 + i * 0.1, hoodRot + 0.3);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8), metal, side * 0.5, hoodY(2.05) + 0.012, 2.05).castShadow = false; // 보닛 핀
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8), metal, side * 0.52, hoodY(1.12) + 0.012, 1.12).castShadow = false;
  }
  deco(trim, 0.07, 0.012, 0.6, -0.5, hoodY(1.85) + 0.006, 1.85, hoodRot);
  // ---------------- 앞: 그릴(가로 살), 큰 아래 흡입구, 헤드라이트(검은 집 + 전구 + 빛나는 줄), 견인고리
  box(dark, 0.72, 0.1, 0.04, 0, 0.5, 2.455);
  for (let i = 0; i < 2; i++) deco(metal, 0.68, 0.012, 0.05, 0, 0.475 + i * 0.045, 2.46);
  box(dark, 0.86, 0.1, 0.05, 0, 0.375, 2.435);
  for (const x of [-0.29, 0, 0.29]) deco(carbon, 0.02, 0.1, 0.06, x, 0.375, 2.44);
  for (const side of [-1, 1]) {
    box(dark, 0.34, 0.13, 0.06, side * 0.63, 0.57, 2.375, 0, side * 0.42);
    const hl = deco(lamp, 0.2, 0.075, 0.03, side * 0.6, 0.578, 2.41, 0, side * 0.42);
    hl.renderOrder = 1;
    deco(glowTrim, 0.3, 0.018, 0.03, side * 0.635, 0.518, 2.395, 0, side * 0.42); // 주간등 줄
    box(dark, 0.2, 0.1, 0.05, side * 0.74, 0.4, 2.36, 0, side * 0.5); // 옆 브레이크 흡입구
    add(new THREE.CircleGeometry(0.035, 10), M.lampYellow, side * 0.74, 0.4, 2.39).rotation.y = side * 0.5; // 안개등
    box(carbon, 0.03, 0.12, 0.3, side * 0.875, 0.34, 2.36); // 스플리터 끝판
  }
  // 견인고리 (앞 오른쪽) + 화살표 표시 대신 작은 흰 판
  const hook = add(new THREE.TorusGeometry(0.04, 0.012, 6, 12), trim, 0.33, 0.4, 2.49);
  hook.rotation.y = Math.PI / 2;
  // 보닛 앞 라이트 포드: 카본 집 + 보조등 4개 (쇠 테)
  add(loft([R(2.34, 0.6, 0.63, 0.82, 4), R(2.2, 0.62, 0.64, 0.85, 4), R(2.02, 0.56, 0.67, 0.76, 4)], 16), carbon, 0, 0, 0);
  for (const x of [-0.42, -0.14, 0.14, 0.42]) {
    add(new THREE.CylinderGeometry(0.115, 0.1, 0.1, 12).rotateX(Math.PI / 2), carbon, x, 0.74, 2.36);
    add(new THREE.CircleGeometry(0.092, 12), lamp, x, 0.74, 2.412).castShadow = false;
    add(new THREE.TorusGeometry(0.1, 0.012, 4, 12), metal, x, 0.74, 2.41).castShadow = false;
    deco(metal, 0.2, 0.008, 0.008, x, 0.74, 2.416); // 전구 보호 살
  }
  // ---------------- 뒤: 후미등(검은 집 + ㄱ자 불), 번호판, 범퍼, 디퓨저 날, 굵은 배기구, 견인 끈
  for (const side of [-1, 1]) {
    box(dark, 0.34, 0.24, 0.04, side * 0.64, 0.8, -2.2);
    deco(tailMat, 0.3, 0.06, 0.03, side * 0.64, 0.87, -2.215);
    deco(tailMat, 0.08, 0.2, 0.03, side * 0.75, 0.8, -2.215);
    deco(white, 0.12, 0.05, 0.03, side * 0.56, 0.75, -2.215);
  }
  deco(dark, 1.5, 0.012, 0.012, 0, 0.93, -2.19); // 해치 틈
  deco(white, 0.46, 0.12, 0.02, 0, 0.72, -2.225);
  deco(dark, 0.36, 0.015, 0.022, 0, 0.72, -2.228);
  box(carbon, 1.72, 0.14, 0.1, 0, 0.42, -2.2);
  add(new THREE.CylinderGeometry(0.085, 0.095, 0.28, 14).rotateX(Math.PI / 2), metal, -0.45, 0.32, -2.24);
  add(new THREE.CircleGeometry(0.07, 14).rotateY(Math.PI), dark, -0.45, 0.32, -2.382).castShadow = false;
  box(carbon, 1.3, 0.04, 0.34, 0, 0.3, -2.14, 0.3);
  for (const x of [-0.1, 0.15, 0.4, 0.62]) box(carbon, 0.02, 0.12, 0.32, x, 0.3, -2.16, 0.3);
  box(trim, 0.05, 0.14, 0.02, 0.36, 0.42, -2.26, 0.2); // 견인 끈

  const fWing = new THREE.Group();
  body.add(fWing);
  box(carbon, 1.78, 0.035, 0.3, 0, 0.29, 2.38, 0, 0, 0, fWing);
  deco(trim, 1.78, 0.02, 0.02, 0, 0.29, 2.535, 0, 0, 0, fWing); // 스플리터 앞 끝 색 줄
  for (const x of [-0.5, 0.5]) rod(metal, [x, 0.3, 2.5], [x, 0.4, 2.44], 0.01, fWing);

  // ---------------- 지붕 끝 큰 2단 뒷날개 (끝판 + 받침)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  box(paint, 1.5, 0.05, 0.4, 0, 1.47, -2.18, 0.1, 0, 0, spoiler);
  deco(accent, 1.5, 0.02, 0.05, 0, 1.512, -2.36, 0.1, 0, 0, spoiler); // 뒤 끝 거니 플랩
  const drs = box(accent, 1.5, 0.04, 0.17, 0, 1.56, -2.36, 0.3, 0, 0, spoiler);
  for (const side of [-1, 1]) {
    box(accent, 0.035, 0.16, 0.5, side * 0.765, 1.51, -2.22, 0.1, 0, 0, spoiler);
    deco(trim, 0.04, 0.04, 0.5, side * 0.767, 1.585, -2.23, 0.1, 0, 0, spoiler);
    box(carbon, 0.03, 0.14, 0.26, side * 0.4, 1.4, -2.08, 0.25, 0, 0, spoiler); // 받침
  }
  // 아래 단: 뒷유리 밑 작은 날개
  box(paint, 1.34, 0.035, 0.2, 0, 0.99, -2.24, -0.25, 0, 0, spoiler);
  deco(accent, 1.34, 0.03, 0.03, 0, 1.02, -2.335, -0.25, 0, 0, spoiler);

  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0.3, 1.05, -0.45);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.78, 0.62], r: [0.78, 0.64] },
      helmet: [0.3, 1.05, -0.45],
      visor: [1.27, -0.85],
      armor: { y: 0.86, x: 0.84 },
      ram: { y: 0.2, z: 1.62 },
      spines: [[-0.65, 1.5], [-1.05, 1.5], [-1.45, 1.5], [-1.85, 1.47]],
      booster: { x: 0.86, y0: 0.6, y1: 1.02, z0: -0.55, dz: -1.25 },
      lift: { y: 1.3, z: -2.08, h: 0.22 },
      stab: [0.77, 1.47, -2.2],
      tailFin: [0, 1.44, -0.62],
      wing: [0.9, 0.62, 0.0],
      nitro: { x: 0.22, y: 0.36, z: -2.0, dz: -0.42 },
      vents: [[0.36, hoodY(1.25) + 0.02, 1.25], [0.36, hoodY(1.5) + 0.02, 1.5], [0.36, hoodY(1.75) + 0.02, 1.75]],
      glow: { y: hoodY(1.45) + 0.02, z: 1.45, len: 1.0, rot: hoodRot, w: 0.05 },
      flames: [[-0.45, 0.32, 0.6, -2.4]],
      motor: [0.38, 0.4, -2.3],
      spark: [0.85, 0.25, -1.85],
      seams: [0.96, 0.28, 0.0],
      lean: 0.075,
      drsRest: 0.3,
    },
  };
}
