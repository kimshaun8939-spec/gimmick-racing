// 차체 모양: buildF1 (레드 포뮬러 f1 · 주니어 junior). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업: 언더컷 사이드포드, 바지보드, 4단 앞날개, 모양 잡힌 끝판, 조종석 속, 빔 날개, 비 올 때 켜는 등
//   같은 재질 조각은 한 덩어리로 합쳐서(put → flush) 그리는 횟수를 줄임. 예전 파일: .debug/carBody_f1.before-detail.js
import * as THREE from 'three';
import { R, loft, makeHelmet, rodGeometry } from './carModel.js';

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

export function buildF1({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, glass, lamp, numMat, tailMat, metal } = M;
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
      if (mat === tailMat || mat === lamp || mat === dark) mesh.castShadow = false;
    }
  };

  // ============================================================ 노즈 + 모노코크 (예전 윤곽 그대로, 더 매끈하게)
  put(paint, loft([
    { z: 2.78, w: 0.09, h: 0.06, y: 0.27 },
    { z: 2.45, w: 0.15, h: 0.1, y: 0.31 },
    { z: 1.9, w: 0.22, h: 0.15, y: 0.38 },
    { z: 1.25, w: 0.3, h: 0.21, y: 0.47 },
    { z: 0.6, w: 0.37, h: 0.26, y: 0.53 },
    { z: 0.0, w: 0.41, h: 0.29, y: 0.55 },
    { z: -0.55, w: 0.41, h: 0.3, y: 0.55 },
  ], 24));
  // 노즈 끝 포인트 색 + 노즈 위 줄무늬 + 양옆 가는 줄
  put(accent, loft([
    { z: 2.8, w: 0.092, h: 0.062, y: 0.27 },
    { z: 2.55, w: 0.142, h: 0.096, y: 0.3 },
    { z: 2.4, w: 0.166, h: 0.112, y: 0.315 },
  ], 24));
  put(accent, bx(0.1, 0.02, 1.5, 0, 0.645, 1.45, 0.21));
  for (const side of [-1, 1]) {
    put(trim, bx(0.02, 0.016, 1.3, side * 0.085, 0.642, 1.45, 0.21));
    // 노즈 옆 카메라 꼬투리
    put(carbon, loft([R(2.2, 0.03, 0.335, 0.375, 2, side * 0.235), R(2.08, 0.045, 0.33, 0.385, 2, side * 0.25), R(1.95, 0.02, 0.345, 0.375, 2, side * 0.26)], 8));
    put(carbon, bx(0.08, 0.012, 0.1, side * 0.215, 0.355, 2.08));
  }
  // 피토관 + 안테나
  put(carbon, rod([0, 0.6, 1.72], [0, 0.72, 1.7], 0.008));
  put(carbon, rod([0, 0.72, 1.7], [0, 0.72, 1.78], 0.008));
  put(carbon, rod([0.1, 0.8, 0.62], [0.1, 0.9, 0.6], 0.006));

  // ============================================================ 사이드포드: 위는 넓고 아래는 잘록(언더컷), 뒤로 갈수록 콜라병처럼 좁아짐
  // 아래 잘록한 허리
  put(paint, loft([
    R(1.0, 0.3, 0.2, 0.4, 4),
    R(0.4, 0.44, 0.2, 0.44, 4),
    R(-0.5, 0.47, 0.2, 0.46, 4),
    R(-1.25, 0.36, 0.2, 0.44, 4),
    R(-1.98, 0.2, 0.22, 0.42, 4),
  ], 20));
  for (const side of [-1, 1]) {
    // 위쪽 포드
    put(paint, loft([
      R(0.62, 0.2, 0.47, 0.68, 3.5, side * 0.62),
      R(0.35, 0.27, 0.42, 0.715, 4, side * 0.6),
      R(-0.25, 0.3, 0.38, 0.72, 4, side * 0.58),
      R(-0.7, 0.29, 0.36, 0.71, 4, side * 0.55),
      R(-1.0, 0.22, 0.32, 0.66, 4, side * 0.4),
      R(-1.35, 0.18, 0.3, 0.58, 4, side * 0.32),
      R(-1.7, 0.14, 0.3, 0.5, 3.5, side * 0.24),
      R(-1.98, 0.09, 0.34, 0.46, 3, side * 0.16),
    ], 20));
    // 흡입구: 검은 입 + 포인트 색 입술
    put(dark, loft([R(0.632, 0.165, 0.5, 0.655, 3.5, side * 0.62), R(0.6, 0.165, 0.5, 0.655, 3.5, side * 0.62)], 16));
    put(accent, bx(0.36, 0.014, 0.03, side * 0.62, 0.688, 0.615));
    // 옆면 무늬: 비스듬한 포인트 띠 + 아래 가는 줄
    put(accent, plate([[0.32, 0.5], [0.2, 0.63], [-0.5, 0.63], [-0.38, 0.5]], 0.012, side * 0.888, side * -0.03, -0.1));
    put(trim, plate([[0.36, 0.455], [0.34, 0.48], [-0.4, 0.48], [-0.38, 0.455]], 0.012, side * 0.886, side * -0.03, -0.1));
    // 위쪽 냉각 틈 (검은 줄 4개)
    for (let i = 0; i < 4; i++) put(dark, bx(0.2, 0.01, 0.035, side * (0.5 - i * 0.035), 0.688 - i * 0.022, -0.98 - i * 0.1, 0, side * 0.5, 0));
    // 바지보드: 앞바퀴 뒤에서 바람을 옆으로 돌리는 세로 판 3장 + 가로 날개
    put(carbon, plate([[1.18, 0.2], [1.14, 0.47], [1.0, 0.54], [0.74, 0.56], [0.7, 0.2]], 0.018, side * 0.47, side * 0.22, 0.7));
    put(carbon, plate([[1.04, 0.2], [1.0, 0.4], [0.74, 0.45], [0.72, 0.2]], 0.016, side * 0.6, side * 0.3, 0.72));
    put(carbon, plate([[0.94, 0.2], [0.9, 0.32], [0.74, 0.36], [0.72, 0.2]], 0.016, side * 0.72, side * 0.38, 0.72));
    put(accent, plate([[1.14, 0.47], [1.0, 0.54], [0.74, 0.56], [0.74, 0.535], [1.0, 0.515], [1.13, 0.45]], 0.022, side * 0.47, side * 0.22, 0.7));
    put(carbon, bx(0.3, 0.012, 0.1, side * 0.66, 0.47, 0.86, -0.15, side * 0.25, 0));
    // 바닥 가장자리 날개 (포인트 색 줄) + 뒷바퀴 앞 꺾임
    put(accent, bx(0.022, 0.022, 1.5, side * 0.868, 0.192, -0.12));
    put(carbon, bx(0.05, 0.05, 0.22, side * 0.84, 0.215, -0.82, 0.25, 0, 0));
    for (let i = 0; i < 3; i++) put(carbon, plate([[1.22 - i * 0.1, 0.18], [1.2 - i * 0.1, 0.25 - i * 0.012], [1.0 - i * 0.08, 0.27 - i * 0.012], [0.98 - i * 0.08, 0.18]], 0.012, side * (0.36 + i * 0.09), side * 0.35, 1.0));
    // 엔진 덮개 옆 아가미 (검은 틈)
    for (let i = 0; i < 4; i++) put(dark, bx(0.012, 0.075, 0.03, side * (0.298 - i * 0.012), 0.77 - i * 0.02, -0.78 - i * 0.1, 0.5, 0, 0));
  }

  // ============================================================ 엔진 덮개 + 에어박스
  put(paint, loft([
    { z: -0.18, w: 0.2, h: 0.3, y: 0.8, n: 2.6 },
    { z: -0.6, w: 0.3, h: 0.3, y: 0.77, n: 2.6 },
    { z: -1.2, w: 0.24, h: 0.22, y: 0.66, n: 2.6 },
    { z: -1.6, w: 0.17, h: 0.16, y: 0.6, n: 2.6 },
    { z: -1.98, w: 0.1, h: 0.1, y: 0.55, n: 2.6 },
  ], 20));
  put(paint, loft([
    { z: -0.1, w: 0.14, h: 0.115, y: 1.0, n: 2.6 },
    { z: -0.45, w: 0.155, h: 0.125, y: 1.0, n: 2.4 },
    { z: -0.8, w: 0.09, h: 0.08, y: 0.96, n: 2.4 },
    { z: -1.1, w: 0.04, h: 0.05, y: 0.9, n: 2.4 },
  ], 16));
  // 흡입구 구멍 (가운데 기둥으로 둘로 나뉨) + 포인트 색 테
  put(dark, loft([{ z: -0.092, w: 0.115, h: 0.092, y: 1.0, n: 2.6 }, { z: -0.12, w: 0.115, h: 0.092, y: 1.0, n: 2.6 }], 16));
  put(paint, bx(0.022, 0.19, 0.03, 0, 1.0, -0.085));
  put(accent, bx(0.3, 0.02, 0.5, 0, 1.118, -0.4, -0.06));
  // 온보드 카메라 (T자) + 뒤 안테나
  put(carbon, bx(0.05, 0.07, 0.1, 0, 1.15, -0.26));
  put(carbon, bx(0.26, 0.035, 0.07, 0, 1.19, -0.26));
  put(carbon, rod([0, 1.08, -0.62], [0, 1.26, -0.68], 0.007));

  // 샤크핀 (번호판) + 윗줄
  put(paint, plate([[-0.5, 1.06], [-2.08, 1.12], [-2.08, 0.98], [-1.95, 0.58], [-1.1, 0.8], [-0.6, 0.98]], 0.03));
  put(accent, plate([[-0.5, 1.062], [-2.08, 1.122], [-2.08, 1.085], [-0.6, 1.03]], 0.036));
  for (const side of [-1, 1]) {
    const p = add(new THREE.PlaneGeometry(0.32, 0.32), numMat, side * 0.02, 0.9, -1.45);
    p.rotation.y = side * Math.PI / 2;
    p.castShadow = false;
  }

  // ============================================================ 조종석: 구멍, 머리 받침, 핸들, 바람막이, 헬멧
  put(dark, bx(0.5, 0.06, 0.8, 0, 0.82, -0.12));
  put(carbon, bx(0.36, 0.11, 0.2, 0, 0.885, -0.56));
  for (const side of [-1, 1]) put(carbon, bx(0.07, 0.07, 0.5, side * 0.235, 0.868, -0.28));
  put(carbon, bx(0.26, 0.1, 0.03, 0, 0.875, 0.14, -0.5)); // 핸들
  put(lamp, bx(0.09, 0.035, 0.008, 0, 0.885, 0.122, -0.5)); // 핸들 화면
  put(glass, bx(0.4, 0.06, 0.015, 0, 0.865, 0.3, -0.75));
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 0.93, -0.3);

  // 헤일로 (조종석 보호대) + 앞 기둥 + 윗줄
  const haloPts = [
    [-0.33, 0.82, -0.5], [-0.3, 1.04, -0.28], [-0.18, 1.12, 0.05], [0, 1.13, 0.2],
    [0.18, 1.12, 0.05], [0.3, 1.04, -0.28], [0.33, 0.82, -0.5],
  ];
  put(carbon, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(haloPts.map((p) => V(...p))), 28, 0.036, 6, false));
  put(carbon, plate([[0.26, 1.15], [0.46, 0.8], [0.36, 0.8], [0.17, 1.1]], 0.035));
  put(accent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(haloPts.slice(1, 6).map((p) => V(p[0], p[1] + 0.032, p[2]))), 16, 0.014, 4, false));

  // 백미러: 기둥 2개 + 몸통 + 거울면
  for (const side of [-1, 1]) {
    put(carbon, rod([side * 0.38, 0.72, 0.34], [side * 0.52, 0.86, 0.32], 0.012));
    put(carbon, rod([side * 0.4, 0.74, 0.26], [side * 0.58, 0.87, 0.3], 0.01));
    put(paint, bx(0.17, 0.075, 0.06, side * 0.55, 0.89, 0.32, 0, side * -0.15, 0));
    put(dark, bx(0.14, 0.055, 0.01, side * 0.555, 0.89, 0.288, 0, side * -0.15, 0));
    put(accent, bx(0.172, 0.014, 0.062, side * 0.55, 0.93, 0.32, 0, side * -0.15, 0));
  }

  // ============================================================ 바닥판 + 디퓨저 + 뒤 충돌 구조물
  const fpts = [[0.32, 1.25], [0.86, 0.72], [0.88, -0.92], [0.55, -1.05], [0.55, -1.98]];
  put(carbon, slab([...fpts.map(([x, z]) => [-x, z]), ...[...fpts].reverse()], 0.04, 0.18));
  put(carbon, bx(1.16, 0.03, 0.62, 0, 0.275, -2.2, 0.42));
  for (const x of [-0.56, -0.34, -0.12, 0.12, 0.34, 0.56]) put(carbon, plate([[-1.92, 0.15], [-1.95, 0.24], [-2.46, 0.44], [-2.48, 0.15]], 0.018, x));
  put(carbon, loft([R(-1.9, 0.1, 0.3, 0.46, 3), R(-2.2, 0.075, 0.33, 0.46, 3), R(-2.42, 0.055, 0.36, 0.45, 3)], 12));
  // 비 올 때 켜는 등 (가운데 빨간 불) + 테
  put(tailMat, bx(0.085, 0.085, 0.02, 0, 0.405, -2.43));
  put(carbon, bx(0.11, 0.11, 0.015, 0, 0.405, -2.418));
  // 가운데 배기구 (부스트 불꽃이 나오는 곳) + 작은 배기구 2개
  put(metal, new THREE.CylinderGeometry(0.07, 0.08, 0.22, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0.5, -2.03));
  put(dark, new THREE.CircleGeometry(0.068, 12).rotateY(Math.PI).translate(0, 0.5, -2.1));
  for (const side of [-1, 1]) put(metal, new THREE.CylinderGeometry(0.022, 0.022, 0.16, 6).rotateX(Math.PI / 2).translate(side * 0.1, 0.575, -2.04));

  // ============================================================ 앞날개: 뒤로 젖힌 4단 날개 + 모양 잡힌 끝판 (변신 때 통째로 움직임)
  const fWing = new THREE.Group();
  body.add(fWing);
  const SW = 0.11;
  const accelFlaps = [];
  for (const side of [-1, 1]) {
    put(carbon, foil(0, side * 0.985, 2.63, 0.125, 0.44, 0.04, 0.015, SW), fWing);
    for (const [n, row] of [[0,[.13,.975,2.47,.185,.20,.030,.045]], [1,[.15,.970,2.345,.25,.17,.028,.055]], [2,[.19,.965,2.235,.318,.13,.026,.055]]]) {
      const [a,b,z,y,ch,t,rise] = row;
      const flap = new THREE.Group(); flap.position.set(0,y,z); fWing.add(flap);
      put(n===2?accent:paint, foil(side*a,side*b,0,0,ch,t,rise,SW),flap);
      accelFlaps.push(flap);
    }
    // 끝판 + 포인트 줄 + 발판 + 작은 날개
    const ex = side * 0.99;
    put(paint, plate([[2.76, 0.09], [2.74, 0.19], [2.45, 0.36], [2.06, 0.43], [2.02, 0.09]], 0.028, ex, side * -0.06, 2.4), fWing);
    put(accent, plate([[2.45, 0.36], [2.06, 0.43], [2.05, 0.37], [2.42, 0.31]], 0.034, ex, side * -0.06, 2.4), fWing);
    put(carbon, bx(0.12, 0.014, 0.66, side * 1.03, 0.095, 2.39, 0, side * -0.06, 0), fWing);
    put(carbon, bx(0.09, 0.012, 0.2, side * 1.045, 0.26, 2.3, -0.3, side * -0.06, 0), fWing);
    // 노즈 지지대 + 날개 조절 장치
    put(carbon, plate([[2.74, 0.14], [2.7, 0.27], [2.46, 0.3], [2.42, 0.14]], 0.022, side * 0.12), fWing);
    put(metal, bx(0.02, 0.05, 0.03, side * 0.45, 0.25, 2.36), fWing);
  }

  // ============================================================ 뒷날개 (변신할 때 통째로 움직임)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  put(carbon, foil(-0.63, 0.63, -2.17, 1.01, 0.38, 0.05, 0.035), spoiler);
  // 윗판 (DRS: 가속 모드에서 열림). 자기 가운데를 축으로 돎
  const drs = add(foil(-0.625, 0.625, 0, 0, 0.23, 0.035, 0.012), paint, 0, 1.17, -2.3, spoiler);
  drs.rotation.x = 0.45;
  for (const side of [-1, 1]) {
    const ex = side * 0.64;
    // 끝판: 아래가 좁아지는 모양 + 윗띠 + 틈 3개 + 뒤 빨간 불
    put(paint, plate([[-1.86, 1.27], [-2.5, 1.27], [-2.56, 1.12], [-2.56, 0.68], [-2.42, 0.5], [-2.06, 0.5], [-1.9, 0.76]], 0.035, ex), spoiler);
    put(accent, plate([[-1.86, 1.272], [-2.5, 1.272], [-2.53, 1.18], [-1.87, 1.18]], 0.042, ex), spoiler);
    for (let i = 0; i < 3; i++) put(dark, bx(0.04, 0.012, 0.2, ex, 1.14 - i * 0.035, -2.02 - i * 0.012), spoiler);
    put(trim, plate([[-2.1, 0.56], [-2.4, 0.56], [-2.5, 0.7], [-2.2, 0.7]], 0.04, ex), spoiler);
    put(tailMat, bx(0.02, 0.26, 0.03, side * 0.64, 0.92, -2.565), spoiler);
    // 백조목 지지대 (엔진 덮개 끝에서 날개 위로 넘어감)
    put(carbon, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(side * 0.07, 0.56, -1.86), V(side * 0.07, 0.95, -1.9), V(side * 0.07, 1.1, -2.02), V(side * 0.07, 1.05, -2.14)]), 10, 0.024, 5, false), spoiler);
  }
  put(carbon, bx(0.06, 0.05, 0.22, 0, 1.09, -2.2), spoiler); // DRS 작동 장치
  // 아래 빔 날개 2단
  put(carbon, foil(-0.6, 0.6, -2.14, 0.56, 0.2, 0.03, 0.03), spoiler);
  put(carbon, foil(-0.6, 0.6, -2.27, 0.64, 0.14, 0.025, 0.04), spoiler);

  flush();
  return {
    helmet, fWing, spoiler, drs, accelFlaps,
    A: {
      // 가속 모드 통풍구: 새 사이드포드 윗면에 맞춤
      vents: [[0.56, 0.722, -0.2], [0.55, 0.722, -0.46], [0.53, 0.716, -0.72]],
    },
  };
}
