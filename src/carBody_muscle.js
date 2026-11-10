// 차체 모양: buildMuscle (블랙 머슬). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 업그레이드: 그릴 살·크롬 테 헤드라이트·방향등, 보닛 핀·블로워 테두리, 펜더 아가미, 옆 줄무늬, 문 선·손잡이,
//   뒷유리 루버(검은 살), 뒤 펜더 흡입구, 세로 후미등 3개씩, 크롬 범퍼 돌기, 배기구, 창틀·와이퍼. 예전 파일: .debug/carBody_muscle.before-detail.js
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


export function buildMuscle({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat } = M;
  const W = [
    [-0.9, 1.7, true, 0.36, 0.3, 0.42],
    [0.9, 1.7, true, 0.36, 0.3, 0.42],
    [-0.93, -1.55, false, 0.42, 0.44, 0.45],
    [0.93, -1.55, false, 0.42, 0.44, 0.45],
  ];
  add(loft([R(2.78, 0.62, 0.3, 0.62, 6), R(2.5, 0.72, 0.24, 0.72), R(1.0, 0.74, 0.24, 0.8), R(-1.0, 0.74, 0.25, 0.86), R(-2.3, 0.74, 0.27, 0.9), R(-2.6, 0.66, 0.32, 0.86, 6)], 24), paint, 0, 0, 0);
  add(loft([R(2.77, 0.86, 0.3, 0.66, 6), R(2.42, 0.97, 0.24, 0.74), R(2.0, 0.97, 0.24, 0.76)], 24), paint, 0, 0, 0);
  add(loft([R(1.25, 0.95, 0.25, 0.8), R(0.1, 0.97, 0.25, 0.82), R(-0.9, 0.98, 0.25, 0.84)], 24), paint, 0, 0, 0);
  // 넓게 부푼 뒤 펜더 (코크병 허리)
  add(loft([R(-1.0, 0.98, 0.26, 0.84), R(-1.6, 1.03, 0.27, 0.9), R(-2.3, 1.04, 0.27, 0.92), R(-2.58, 0.94, 0.32, 0.88, 6)], 24), paint, 0, 0, 0);
  arches(add, M, W, 0.04, 0.14);
  // 패스트백 유리 + 지붕
  add(loft([R(0.75, 0.64, 0.8, 0.86, 4), R(0.15, 0.66, 0.84, 1.22, 4), R(-0.6, 0.64, 0.86, 1.25, 4), R(-1.4, 0.6, 0.88, 1.06, 4), R(-2.1, 0.56, 0.88, 0.93, 4)], 24), glass, 0, 0, 0);
  add(loft([R(0.1, 0.56, 1.2, 1.245, 3), R(-0.6, 0.6, 1.235, 1.275, 3), R(-1.1, 0.56, 1.15, 1.2, 3)], 24), paint, 0, 0, 0);
  // 금색 쌍줄 (블로워 양옆으로 보닛 → 지붕 → 트렁크)
  for (const sx of [-0.4, -0.27, 0.27, 0.4]) {
    const h = add(new THREE.BoxGeometry(0.07, 0.014, 1.75), accent, sx, 0.76, 1.95);
    h.rotation.x = 0.05;
    h.castShadow = false;
  }
  for (const sx of [-0.12, 0.12]) {
    add(new THREE.BoxGeometry(0.12, 0.012, 0.95), accent, sx, 1.27, -0.45).castShadow = false;
    add(new THREE.BoxGeometry(0.12, 0.012, 0.5), accent, sx, 0.93, -2.3).castShadow = false;
  }
  // 슈퍼차저(블로워): 보닛을 뚫고 솟은 은색 상자 + 벨트 + 위 흡입구(나비 판 2개)
  add(new THREE.BoxGeometry(0.42, 0.2, 0.62), metal, 0, 0.88, 1.35);
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.44, 0.015, 0.03), carbon, 0, 0.83 + i * 0.03, 1.66).castShadow = false;
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16).rotateX(Math.PI / 2), carbon, 0, 0.86, 1.7);
  add(new THREE.BoxGeometry(0.5, 0.12, 0.34), carbon, 0, 1.04, 1.4);
  for (const sx of [-0.12, 0.12]) {
    add(new THREE.BoxGeometry(0.2, 0.012, 0.26), metal, sx, 1.105, 1.4).castShadow = false;
    add(new THREE.BoxGeometry(0.03, 0.03, 0.26), trim, sx, 1.12, 1.4).castShadow = false;
  }
  for (const side of [-1, 1]) {
    // 둥근 헤드라이트 4개 + 크롬 테
    for (const hx of [0.56, 0.78]) {
      add(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 16).rotateX(Math.PI / 2), metal, side * hx, 0.5, 2.76);
      add(new THREE.CircleGeometry(0.07, 16), lamp, side * hx, 0.5, 2.79).castShadow = false;
    }
    // 사이드 배기관 (문 아래, 크롬)
    add(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 12).rotateX(Math.PI / 2), metal, side * 1.0, 0.3, 0.15);
    add(new THREE.CylinderGeometry(0.075, 0.06, 0.12, 12).rotateX(Math.PI / 2), dark, side * 1.0, 0.3, -0.66);
    // 백미러, 문 아래 금줄
    add(new THREE.BoxGeometry(0.16, 0.08, 0.12), paint, side * 0.8, 0.95, 0.65);
    add(new THREE.BoxGeometry(0.02, 0.03, 2.0), trim, side * 0.985, 0.46, 0.2).castShadow = false;
  }
  doorNumber(add, M, 1.0, 0.58, 0.1, 0.42);
  // ---------------------------------------------------------------- 디테일 (같은 재질끼리 한 덩어리)
  const dDark = [], dMetal = [], dTrim = [], dAccent = [], dCarbon = [], dPaint = [], dTail = [], dAmber = [];
  // 보닛: 블로워 둘레 검은 구멍 테 + 보닛 핀 2개 + 보닛 끝 선
  dDark.push(bx(0.54, 0.012, 0.8, 0, 0.768, 1.36, 0.05), bx(1.5, 0.01, 0.014, 0, 0.812, 0.86));
  for (const sx of [-0.62, 0.62]) dMetal.push(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 8).translate(sx, 0.765, 2.45), bx(0.07, 0.008, 0.014, sx, 0.782, 2.45));
  // 창틀 (크롬): 앞 기둥 + 지붕 옆 + 뒤 기둥, 와이퍼
  for (const sd of [-1, 1]) {
    dMetal.push(rodGeometry(V(sd * 0.63, 0.86, 0.74), V(sd * 0.56, 1.19, 0.14), 0.024), rodGeometry(V(sd * 0.56, 1.19, 0.14), V(sd * 0.55, 1.2, -0.9), 0.02), rodGeometry(V(sd * 0.55, 1.2, -0.9), V(sd * 0.55, 0.96, -2.0), 0.022));
    dMetal.push(bx(0.016, 0.02, 1.9, sd * 0.665, 0.875, -0.3));
  }
  dCarbon.push(rodGeometry(V(0.05, 0.88, 0.76), V(0.4, 0.96, 0.62), 0.012), rodGeometry(V(-0.43, 0.88, 0.76), V(-0.08, 0.96, 0.62), 0.012));
  // 뒷유리 루버 (검은 살 5개 + 가운데 뼈대)
  for (let i = 0; i < 5; i++) {
    const z = -1.08 - i * 0.2, top = 1.25 + (z + 0.6) * 0.215;
    dCarbon.push(bx(1.0 - i * 0.02, 0.018, 0.15, 0, top + 0.012, z, -0.5));
  }
  dCarbon.push(bx(0.04, 0.02, 1.0, 0.3, 1.075, -1.5, -0.215), bx(0.04, 0.02, 1.0, -0.3, 1.075, -1.5, -0.215));
  // 앞: 그릴 가로 살(크롬) + 가운데 기둥(금색) + 방향등 + 범퍼 돌기 + 번호판
  for (const y of [0.455, 0.5, 0.545]) dMetal.push(bx(0.84, 0.012, 0.02, 0, y, 2.805));
  dTrim.push(bx(0.03, 0.15, 0.03, 0, 0.5, 2.81), bx(1.56, 0.014, 0.02, 0, 0.6, 2.775), bx(1.66, 0.014, 0.03, 0, 0.242, 2.85));
  for (const sd of [-1, 1]) {
    dAmber.push(bx(0.16, 0.035, 0.02, sd * 0.66, 0.4, 2.8));
    dMetal.push(bx(0.05, 0.14, 0.07, sd * 0.36, 0.33, 2.83), bx(0.05, 0.14, 0.07, sd * 0.36, 0.38, -2.65));
  }
  dAccent.push(bx(0.26, 0.085, 0.012, 0, 0.36, 2.845));
  // 옆: 펜더 아가미 3개 + 옆 줄무늬(금색, 앞에서 꺾여 내려옴) + 문 선·손잡이 + 뒤 펜더 흡입구 + 배기관 열판
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 3; i++) dDark.push(bx(0.02, 0.15, 0.035, sd * 0.972, 0.66, 1.12 - i * 0.07, 0.3));
    dAccent.push(bx(0.02, 0.045, 1.5, sd * 0.975, 0.8, -0.02), bx(0.02, 0.012, 1.5, sd * 0.975, 0.755, -0.02), bx(0.02, 0.045, 0.3, sd * 0.975, 0.74, 0.86, 0.45));
    dDark.push(bx(0.012, 0.52, 0.014, sd * 0.978, 0.6, 0.7), bx(0.012, 0.52, 0.014, sd * 0.992, 0.6, -0.72));
    dMetal.push(bx(0.02, 0.025, 0.15, sd * 0.985, 0.845, -0.5));
    dDark.push(bx(0.04, 0.2, 0.2, sd * 1.03, 0.72, -1.02));
    dPaint.push(bx(0.06, 0.24, 0.03, sd * 1.035, 0.72, -1.13, 0, sd * -0.5));
    dTrim.push(bx(0.03, 0.014, 0.2, sd * 1.045, 0.83, -1.02));
    // 배기관 열판 (구멍 뚫린 검은 덮개) + 받침
    for (let i = 0; i < 6; i++) dCarbon.push(bx(0.03, 0.05, 0.12, sd * 1.065, 0.31, 0.72 - i * 0.2));
    dCarbon.push(bx(0.1, 0.03, 0.05, sd * 0.96, 0.33, 0.8), bx(0.1, 0.03, 0.05, sd * 0.96, 0.33, -0.45));
    // 백미러 크롬 받침 + 거울
    dMetal.push(bx(0.1, 0.02, 0.04, sd * 0.74, 0.93, 0.65), bx(0.165, 0.085, 0.012, sd * 0.8, 0.95, 0.585));
  }
  // 뒤: 검은 판 + 세로 후미등 3개씩 + 금색 테 + 가운데 주유구 + 번호판 + 배기구 2개 + 트렁크 선
  dDark.push(bx(1.62, 0.16, 0.03, 0, 0.76, -2.595), bx(1.4, 0.01, 0.014, 0, 0.985, -2.1));
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) dTail.push(bx(0.1, 0.11, 0.02, sd * (0.38 + i * 0.13), 0.76, -2.612));
  dTrim.push(bx(1.64, 0.014, 0.02, 0, 0.845, -2.6), bx(1.64, 0.014, 0.02, 0, 0.675, -2.6));
  dMetal.push(cz(0.065, 0.065, 0.02, 0, 0.76, -2.612, 12));
  dAccent.push(bx(0.3, 0.1, 0.012, 0, 0.52, -2.635));
  dTail.push(bx(0.5, 0.018, 0.02, 0, 1.005, -2.585));
  for (const sx of [-0.55, 0.55]) {
    dMetal.push(cz(0.06, 0.065, 0.22, sx, 0.3, -2.6, 12, true));
    dDark.push(new THREE.CircleGeometry(0.056, 12).rotateY(Math.PI).translate(sx, 0.3, -2.64));
  }
  dCarbon.push(bx(1.5, 0.03, 0.3, 0, 0.26, -2.5, -0.3));
  add(merge(dDark), dark, 0, 0, 0).castShadow = false;
  add(merge(dMetal), metal, 0, 0, 0);
  add(merge(dTrim), trim, 0, 0, 0).castShadow = false;
  add(merge(dAccent), accent, 0, 0, 0).castShadow = false;
  add(merge(dCarbon), carbon, 0, 0, 0);
  add(merge(dPaint), paint, 0, 0, 0);
  add(merge(dTail), tailMat, 0, 0, 0).castShadow = false;
  add(merge(dAmber), M.lampYellow, 0, 0, 0).castShadow = false;
  // 앞: 검은 그릴 + 크롬 범퍼
  add(new THREE.BoxGeometry(1.0, 0.16, 0.04), dark, 0, 0.5, 2.78);
  add(new THREE.BoxGeometry(1.6, 0.07, 0.08), metal, 0, 0.31, 2.8);
  // 뒤: 가로로 긴 후미등, 크롬 범퍼
  add(new THREE.BoxGeometry(1.6, 0.07, 0.08), metal, 0, 0.36, -2.62);
  // 앞 립
  const fWing = new THREE.Group();
  body.add(fWing);
  add(merge([bx(1.74, 0.035, 0.26, 0, 0.21, 2.76), bx(0.03, 0.1, 0.22, 0.86, 0.25, 2.72), bx(0.03, 0.1, 0.22, -0.86, 0.25, 2.72), bx(1.3, 0.1, 0.03, 0, 0.26, 2.82, -0.4)]), carbon, 0, 0, 0, fWing);
  // 덕테일 (트렁크 끝이 오리 꼬리처럼 들림)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  const duck = add(new THREE.BoxGeometry(1.5, 0.06, 0.3), paint, 0, 0.94, -2.48, spoiler);
  duck.rotation.x = -0.35;
  add(merge([bx(0.03, 0.1, 0.3, 0.76, 0.93, -2.47, -0.35), bx(0.03, 0.1, 0.3, -0.76, 0.93, -2.47, -0.35)]), paint, 0, 0, 0, spoiler);
  const drs = add(new THREE.BoxGeometry(1.5, 0.035, 0.1), accent, 0, 1.0, -2.62, spoiler);
  drs.rotation.x = 0.2;
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0.3, 0.98, -0.45);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.82, 0.6], r: [0.9, 0.72] },
      helmet: [0.3, 0.98, -0.45],
      visor: [1.12, -0.85],
      armor: { y: 0.8, x: 0.86 },
      ram: { y: 0.12, z: 1.85 },
      spines: [[-0.2, 1.24], [-0.6, 1.26], [-1.0, 1.2], [-1.45, 1.04]],
      booster: { x: 0.4, y0: 0.6, y1: 1.08, z0: -0.85, dz: -1.15 },
      lift: { y: 0.88, z: -2.4, h: 0.25 },
      stab: [0.76, 0.98, -2.48],
      tailFin: [0, 1.24, -0.75],
      wing: [0.95, 0.6, 0.0],
      nitro: { x: 0.55, y: 0.34, z: -2.6, dz: -0.45 },
      vents: [[0.62, 0.79, 1.6], [0.62, 0.8, 1.35], [0.62, 0.81, 1.1]],
      glow: { y: 0.775, z: 2.25, len: 0.8, rot: 0.05, w: 0.05 },
      flames: [[-0.55, 0.34, 0.5, -2.72], [0.55, 0.34, 0.5, -2.72]],
      motor: [0.42, 0.38, -2.66],
      spark: [0.93, 0.25, -2.05],
      seams: [1.0, 0.22, 0.1],
      lean: 0.07,
      drsRest: 0.2,
    },
  };
}
