// 차체 모양: buildGT (썬더 GT, 미드나잇 쿠페). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 업그레이드: 보닛 파워 벌지·통풍구, 헤드라이트 뭉치(렌즈 2개 + 주간등), 그릴 살, 문 선·손잡이, 옆 흡입구,
//   창틀·와이퍼, 덕테일 + 백조목 날개, 동그란 후미등 4개 + 빛 띠, 디퓨저 날, 배기구 4개(테 + 검은 속). 예전 파일: .debug/carBody_gt.before-detail.js
import * as THREE from 'three';
import { R, arches, doorNumber, loft, makeHelmet, rodGeometry } from './carModel.js';

// ---- 이 파일 안에서만 쓰는 도우미
/** 여러 조각을 한 덩어리로 (그리는 횟수 줄이기) */
function merge(geos) {
  const pos = [], nor = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}
/** 자리·기울기를 미리 넣은 상자 */
function bx(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
}
/** 앞뒤(z) 방향으로 누운 원통 */
function cz(r0, r1, len, x, y, z, seg = 12, open = false) {
  return new THREE.CylinderGeometry(r0, r1, len, seg, 1, open).rotateX(Math.PI / 2).translate(x, y, z);
}
/** 차체 윗면을 따라가는 얇은 띠 ([z, 윗면 높이] 목록, 가운데 x, 반폭) */
function ribbon(pts, x, hw, th = 0.012) {
  return loft(pts.map(([z, y]) => R(z, hw, y - 0.012, y + th, 4, x)), 8);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildGT({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat } = M;
  const W = [
    [-0.88, 1.62, true, 0.37, 0.3, 0.42],
    [0.88, 1.62, true, 0.37, 0.3, 0.42],
    [-0.9, -1.5, false, 0.4, 0.38, 0.45],
    [0.9, -1.5, false, 0.4, 0.38, 0.45],
  ];
  // 가운데 몸통 (바퀴 안쪽 폭)
  add(loft([R(2.86, 0.5, 0.3, 0.5), R(2.55, 0.68, 0.22, 0.66), R(1.0, 0.7, 0.22, 0.82), R(-1.0, 0.7, 0.24, 0.9), R(-2.3, 0.7, 0.26, 0.92), R(-2.56, 0.58, 0.36, 0.84)], 24), paint, 0, 0, 0);
  // 앞 범퍼 + 앞 펜더 앞부분
  add(loft([R(2.9, 0.6, 0.27, 0.47, 4), R(2.72, 0.9, 0.2, 0.57), R(2.3, 0.97, 0.2, 0.672), R(2.02, 0.97, 0.2, 0.7)], 24), paint, 0, 0, 0);
  // 문 (앞바퀴와 뒷바퀴 사이, 가장 넓음)
  add(loft([R(1.2, 0.96, 0.24, 0.8), R(0.1, 1.0, 0.24, 0.84), R(-1.1, 0.98, 0.24, 0.88)], 24), paint, 0, 0, 0);
  // 뒤 펜더 + 뒤 범퍼
  add(loft([R(-1.92, 0.98, 0.26, 0.9), R(-2.3, 0.96, 0.26, 0.92), R(-2.52, 0.88, 0.3, 0.88), R(-2.6, 0.74, 0.36, 0.8)], 24), paint, 0, 0, 0);
  arches(add, M, W, 0.04, 0.14);
  // 유리 지붕(캐빈) + 차체색 지붕판
  add(loft([R(1.02, 0.68, 0.78, 0.84, 4), R(0.35, 0.7, 0.8, 1.2, 4), R(-0.5, 0.68, 0.84, 1.28, 4), R(-1.3, 0.65, 0.86, 1.12, 4), R(-1.98, 0.62, 0.86, 0.95, 4)], 24), glass, 0, 0, 0);
  add(loft([R(0.3, 0.58, 1.19, 1.235, 3), R(-0.1, 0.645, 1.25, 1.295, 3), R(-0.6, 0.645, 1.26, 1.3, 3), R(-1.05, 0.61, 1.18, 1.23, 3)], 24), paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    // 가운데 기둥(B필러) + 옆 유리 아래 크롬 띠
    const bp = add(new THREE.BoxGeometry(0.05, 0.36, 0.12), paint, side * 0.66, 1.05, -0.6);
    bp.rotation.z = side * -0.12;
    add(new THREE.BoxGeometry(0.02, 0.025, 2.2), metal, side * 0.705, 0.86, -0.45).castShadow = false;
  }
  // 창틀: 앞 기둥(A필러) + 지붕 옆 테 + 와이퍼 + 앞유리 위 색 띠
  add(merge([
    rodGeometry(V(0.66, 0.83, 1.0), V(0.57, 1.17, 0.34), 0.028), rodGeometry(V(-0.66, 0.83, 1.0), V(-0.57, 1.17, 0.34), 0.028),
    rodGeometry(V(0.57, 1.17, 0.34), V(0.56, 1.2, -1.0), 0.024), rodGeometry(V(-0.57, 1.17, 0.34), V(-0.56, 1.2, -1.0), 0.024),
    rodGeometry(V(0.56, 1.2, -1.0), V(0.6, 0.9, -1.95), 0.026), rodGeometry(V(-0.56, 1.2, -1.0), V(-0.6, 0.9, -1.95), 0.026),
    rodGeometry(V(0.05, 0.87, 1.0), V(0.42, 0.95, 0.86), 0.012), rodGeometry(V(-0.45, 0.87, 1.0), V(-0.08, 0.95, 0.86), 0.012),
    bx(0.5, 0.03, 0.16, 0, 0.845, 1.08, 0.1),
  ]), carbon, 0, 0, 0);
  const band = add(bx(1.02, 0.014, 0.16, 0, 1.165, 0.42, 0.52), trim, 0, 0, 0);
  band.castShadow = false;
  // 보닛 가운데 파워 벌지 + 그 위 쌍줄 스트라이프 (보닛 → 지붕 → 트렁크)
  const HOOD = [[2.5, 0.693], [1.6, 0.797], [1.05, 0.853]];
  add(loft([R(2.6, 0.2, 0.6, 0.675, 4), R(2.5, 0.26, 0.6, 0.693, 4), R(1.6, 0.31, 0.7, 0.797, 4), R(1.05, 0.35, 0.76, 0.853, 4)], 14), paint, 0, 0, 0);
  const stripes = [];
  for (const sx of [-0.12, 0.12]) {
    stripes.push(ribbon(HOOD, sx, 0.058), bx(0.116, 0.012, 1.1, sx, 1.303, -0.38), bx(0.116, 0.012, 0.5, sx, 0.928, -2.22));
    stripes.push(ribbon([[2.9, 0.468], [2.74, 0.575], [2.56, 0.69]], sx, 0.058));
  }
  add(merge(stripes), accent, 0, 0, 0).castShadow = false;
  // 보닛 통풍구 (검은 홈 + 차체색 살 3개), 앞바퀴 위 펜더 루버
  const holes = [], slats = [];
  for (const side of [-1, 1]) {
    holes.push(bx(0.26, 0.012, 0.42, side * 0.56, 0.762, 1.42, 0.105));
    for (let i = 0; i < 3; i++) slats.push(bx(0.24, 0.02, 0.035, side * 0.56, 0.757 + i * 0.0125, 1.54 - i * 0.12, 0.45));
    for (let i = 0; i < 3; i++) holes.push(bx(0.16, 0.012, 0.045, side * 0.84, 0.985, 1.74 - i * 0.1));
  }
  add(merge(holes), dark, 0, 0, 0).castShadow = false;
  add(merge(slats), paint, 0, 0, 0).castShadow = false;
  // ---------------------------------------------------------------- 앞: 큰 아래 그릴(살 + 테) + 옆 흡입구 + 헤드라이트 뭉치
  add(merge([bx(0.98, 0.15, 0.04, 0, 0.365, 2.9), bx(0.26, 0.11, 0.04, 0.72, 0.36, 2.79, 0, 0.5), bx(0.26, 0.11, 0.04, -0.72, 0.36, 2.79, 0, -0.5)]), dark, 0, 0, 0);
  add(merge([
    bx(0.94, 0.014, 0.02, 0, 0.335, 2.925), bx(0.94, 0.014, 0.02, 0, 0.395, 2.925),
    bx(1.0, 0.016, 0.03, 0, 0.445, 2.918), bx(1.0, 0.016, 0.03, 0, 0.287, 2.918),
    bx(0.24, 0.014, 0.02, 0.725, 0.36, 2.81, 0, 0.5), bx(0.24, 0.014, 0.02, -0.725, 0.36, 2.81, 0, -0.5),
  ]), trim, 0, 0, 0).castShadow = false;
  add(bx(0.2, 0.07, 0.012, 0, 0.365, 2.93), accent, 0, 0, 0).castShadow = false; // 작은 앞 번호판 자리
  const housings = [], lenses = [], drls = [];
  for (const side of [-1, 1]) {
    // 헤드라이트: 검은 통 속에 둥근 렌즈 2개, 아래에 주간등 한 줄
    housings.push(bx(0.36, 0.03, 0.4, side * 0.62, 0.628, 2.5, 0.25, side * 0.25));
    for (const [dx, dz] of [[0.07, 0.1], [-0.05, -0.07]]) {
      const l = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12).rotateX(0.25).translate(side * (0.62 + dx), 0.648 - dz * 0.25, 2.5 + dz);
      lenses.push(l);
    }
    drls.push(bx(0.34, 0.02, 0.035, side * 0.63, 0.588, 2.71, 0.25, side * 0.3));
    drls.push(bx(0.16, 0.02, 0.03, side * 0.75, 0.47, 2.8, 0, side * 0.5));
  }
  add(merge(housings), dark, 0, 0, 0).castShadow = false;
  add(merge([...lenses, ...drls]), lamp, 0, 0, 0).castShadow = false;
  // ---------------------------------------------------------------- 옆: 펜더 배출구 + 문 선·손잡이 + 뒷바퀴 앞 흡입구 + 사이드 스커트 + 백미러
  const sideDark = [], sideTrim = [], sidePaint = [], sideAccent = [], sideMetal = [], sideCarbon = [];
  for (const side of [-1, 1]) {
    const X = side * 1.0;
    sideDark.push(bx(0.02, 0.16, 0.36, side * 0.996, 0.6, 0.98)); // 앞바퀴 뒤 공기 배출구
    sideAccent.push(bx(0.024, 0.016, 0.34, side * 0.999, 0.635, 0.98), bx(0.024, 0.016, 0.34, side * 0.999, 0.565, 0.98));
    // 문 선 (앞·뒤·아래), 손잡이
    sideDark.push(bx(0.012, 0.5, 0.014, side * 1.002, 0.56, 0.72), bx(0.012, 0.5, 0.014, side * 1.002, 0.56, -0.68), bx(0.012, 0.012, 1.4, side * 1.002, 0.315, 0.02));
    sideMetal.push(bx(0.02, 0.025, 0.14, side * 1.004, 0.78, -0.5));
    // 뒷바퀴 앞 흡입구 (검은 입 + 차체색 날)
    sideDark.push(bx(0.03, 0.2, 0.26, side * 0.99, 0.56, -0.88));
    sidePaint.push(bx(0.05, 0.22, 0.03, side * 1.0, 0.56, -1.02, 0, side * -0.5));
    sideTrim.push(bx(0.024, 0.014, 0.24, side * 1.004, 0.67, -0.88));
    // 사이드 스커트 (카본 + 색 줄) + 뒤 끝 작은 날
    sideCarbon.push(bx(0.05, 0.08, 2.34, X, 0.265, 0.05), bx(0.03, 0.12, 0.18, side * 1.03, 0.3, -1.02));
    sideTrim.push(bx(0.02, 0.02, 2.3, side * 1.028, 0.31, 0.05));
    // 백미러: 받침 + 차체색 통 + 색 띠 + 거울
    sideCarbon.push(bx(0.14, 0.02, 0.05, side * 0.76, 0.94, 0.76), bx(0.02, 0.085, 0.012, side * 0.85, 0.975, 0.705));
    sidePaint.push(bx(0.17, 0.09, 0.11, side * 0.85, 0.975, 0.765));
    sideAccent.push(bx(0.172, 0.02, 0.112, side * 0.85, 1.012, 0.765));
    // 주유구 (오른쪽 뒤 펜더 위)
    if (side > 0) sideMetal.push(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 12).translate(side * 0.74, 0.985, -1.75));
  }
  add(merge(sideDark), dark, 0, 0, 0).castShadow = false;
  add(merge(sideTrim), trim, 0, 0, 0).castShadow = false;
  add(merge(sidePaint), paint, 0, 0, 0);
  add(merge(sideAccent), accent, 0, 0, 0).castShadow = false;
  add(merge(sideMetal), metal, 0, 0, 0).castShadow = false;
  add(merge(sideCarbon), carbon, 0, 0, 0);
  doorNumber(add, M, 1.005, 0.56, 0.05, 0.42);
  // ---------------------------------------------------------------- 뒤: 검은 판 속 동그란 후미등 4개 + 빛 띠, 번호판, 범퍼 통풍구, 디퓨저 날, 배기구 4개
  add(merge([bx(1.56, 0.15, 0.03, 0, 0.73, -2.59), bx(0.3, 0.1, 0.03, 0.56, 0.47, -2.58), bx(0.3, 0.1, 0.03, -0.56, 0.47, -2.58)]), dark, 0, 0, 0).castShadow = false;
  const tails = [bx(0.62, 0.022, 0.02, 0, 0.73, -2.61)];
  for (const x of [-0.66, -0.48, 0.48, 0.66]) tails.push(cz(0.058, 0.058, 0.03, x, 0.73, -2.6, 14));
  tails.push(bx(0.3, 0.02, 0.02, 0, 1.0, -1.93)); // 뒷유리 아래 보조 브레이크등
  add(merge(tails), tailMat, 0, 0, 0).castShadow = false;
  add(bx(0.34, 0.11, 0.02, 0, 0.5, -2.615), accent, 0, 0, 0).castShadow = false; // 뒤 번호판 자리
  const fins = [bx(1.36, 0.04, 0.44, 0, 0.25, -2.45, -0.32)];
  for (const x of [-0.56, -0.19, 0.19, 0.56]) fins.push(bx(0.025, 0.13, 0.4, x, 0.25, -2.5, -0.32));
  fins.push(bx(1.7, 0.1, 0.06, 0, 0.36, -2.6)); // 범퍼 아래 검은 띠
  add(merge(fins), carbon, 0, 0, 0);
  const tipsM = [], tipsD = [];
  for (const x of [-0.45, -0.3, 0.3, 0.45]) {
    tipsM.push(cz(0.062, 0.066, 0.24, x, 0.31, -2.6, 12, true), new THREE.TorusGeometry(0.064, 0.012, 5, 12).translate(x, 0.31, -2.72));
    tipsD.push(new THREE.CircleGeometry(0.058, 12).rotateY(Math.PI).translate(x, 0.31, -2.66));
  }
  add(merge(tipsM), M.darkMetal, 0, 0, 0);
  add(merge(tipsD), dark, 0, 0, 0).castShadow = false;
  // 덕테일 (트렁크 끝이 살짝 들림) + 지붕 안테나
  add(bx(1.62, 0.035, 0.2, 0, 0.935, -2.52, -0.3), paint, 0, 0, 0);
  add(rodGeometry(V(0.25, 1.28, -0.85), V(0.25, 1.5, -1.05), 0.008), carbon, 0, 0, 0).castShadow = false;

  // 앞 립 스포일러 (부스터 충각이 덮을 때 살짝 좁아짐)
  const fWing = new THREE.Group();
  body.add(fWing);
  add(merge([
    bx(1.84, 0.03, 0.34, 0, 0.19, 2.8), bx(0.03, 0.09, 0.3, 0.92, 0.225, 2.76), bx(0.03, 0.09, 0.3, -0.92, 0.225, 2.76),
    bx(0.26, 0.02, 0.15, 0.84, 0.4, 2.68, 0, 0, 0.25), bx(0.26, 0.02, 0.15, -0.84, 0.4, 2.68, 0, 0, -0.25),
    bx(0.03, 0.08, 0.05, 0.3, 0.235, 2.9), bx(0.03, 0.08, 0.05, -0.3, 0.235, 2.9),
  ]), carbon, 0, 0, 0, fWing);
  add(bx(1.8, 0.012, 0.03, 0, 0.207, 2.955), trim, 0, 0, 0, fWing).castShadow = false;

  // 뒷날개 (짧은 기둥 위 넓은 날개)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.76, 0.05, 0.34), carbon, 0, 1.13, -2.3, spoiler);
  const drs = add(new THREE.BoxGeometry(1.76, 0.04, 0.2), paint, 0, 1.22, -2.43, spoiler);
  drs.rotation.x = 0.45;
  add(bx(1.74, 0.03, 0.02, 0, 1.262, -2.515, 0.45), trim, 0, 0, 0, spoiler).castShadow = false; // 거니 플랩 (날개 끝 가는 색 줄)
  const ends = [], necks = [], endTop = [];
  for (const side of [-1, 1]) {
    ends.push(bx(0.035, 0.3, 0.52, side * 0.88, 1.12, -2.34), bx(0.035, 0.1, 0.2, side * 0.88, 0.95, -2.42, 0.4));
    endTop.push(bx(0.04, 0.035, 0.52, side * 0.88, 1.275, -2.34));
    // 받침 (트렁크에서 날개 밑으로)
    necks.push(bx(0.045, 0.24, 0.14, side * 0.45, 1.0, -2.2, 0.25), bx(0.1, 0.02, 0.2, side * 0.45, 0.905, -2.16));
  }
  add(merge(ends), paint, 0, 0, 0, spoiler);
  add(merge(endTop), accent, 0, 0, 0, spoiler).castShadow = false;
  add(merge(necks), carbon, 0, 0, 0, spoiler);
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0.3, 0.98, -0.35);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.8, 0.6], r: [0.9, 0.7] },
      helmet: [0.3, 0.98, -0.35],
      visor: [1.12, -0.8],
      armor: { y: 0.8, x: 0.84 },
      ram: { y: 0.12, z: 1.78 },
      spines: [[-0.1, 1.27], [-0.5, 1.3], [-0.95, 1.22], [-1.4, 1.06]],
      booster: { x: 0.36, y0: 0.6, y1: 1.1, z0: -0.85, dz: -1.15 },
      lift: { y: 0.92, z: -2.22, h: 0.3 },
      stab: [0.88, 1.12, -2.34],
      tailFin: [0, 1.28, -0.7],
      wing: [0.92, 0.6, 0.0],
      nitro: { x: 0.68, y: 0.42, z: -2.2, dz: -0.45 },
      vents: [[0.56, 0.76, 1.54], [0.56, 0.772, 1.42], [0.56, 0.785, 1.3]],
      glow: { y: 0.795, z: 1.78, len: 1.4, rot: 0.108, w: 0.05 },
      flames: [[-0.3, 0.31, 0.45, -2.68], [0.3, 0.31, 0.45, -2.68], [-0.45, 0.31, 0.45, -2.68], [0.45, 0.31, 0.45, -2.68]],
      motor: [0.42, 0.38, -2.68],
      spark: [0.9, 0.25, -2.0],
      seams: [1.0, 0.22, 0.05],
      lean: 0.06,
    },
  };
}
