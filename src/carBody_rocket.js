// 차체 모양: buildRocket (로켓 드래그). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 업그레이드: 바늘 노즈 + 드러난 V8 엔진(블로워·흡입구 모자·헤더 파이프 8개) + 꼬리 로켓 노즐
//   + 롤케이지 + 낙하산 팩 + 윌리 바 + 질소 통. 뒷날개 높이는 그대로 1.12 m (사용자 요청: 뒤 카메라를 가리지 않게)
//   예전 파일: .debug/carBody_rocket.before-detail.js
import * as THREE from 'three';
import { R, loft, makeHelmet, rodGeometry } from './carModel.js';

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
/** 점들을 부드럽게 잇는 파이프 */
function pipe(pts, r, seg = 8, rad = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, rad, false);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildRocket({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, darkMetal, glass, tailMat, rubber } = M;
  const W = [
    [-0.56, 2.4, true, 0.25, 0.16, 0.14],
    [0.56, 2.4, true, 0.25, 0.16, 0.14],
    [-0.94, -1.6, false, 0.52, 0.58, 0.36],
    [0.94, -1.6, false, 0.52, 0.58, 0.36],
  ];
  // ---------------------------------------------------------------- 몸통: 바늘 노즈 → 조종석 → 낮은 엔진 받침 → 둥근 로켓 덮개
  const S = [
    R(3.3, 0.045, 0.255, 0.305, 2.5), R(3.0, 0.1, 0.22, 0.36, 3), R(2.4, 0.17, 0.2, 0.43, 3), R(1.5, 0.26, 0.2, 0.53, 3.2),
    R(0.5, 0.36, 0.2, 0.63, 3.5), R(-0.25, 0.42, 0.2, 0.69, 3.5), R(-0.62, 0.44, 0.2, 0.7, 3.5), R(-0.78, 0.44, 0.2, 0.6, 4),
    R(-1.62, 0.4, 0.22, 0.58, 4), R(-1.82, 0.34, 0.26, 0.82, 2.6), R(-2.18, 0.3, 0.3, 0.9, 2),
  ];
  add(loft(S, 24), paint, 0, 0, 0);
  // 바닥 카본 판 (옆에서 보면 차체 아래 검은 줄)
  add(loft([R(2.6, 0.16, 0.17, 0.21, 6), R(0.5, 0.39, 0.17, 0.215, 6), R(-0.7, 0.47, 0.17, 0.215, 6), R(-1.7, 0.43, 0.19, 0.235, 6)], 12), carbon, 0, 0, 0);
  // 노즈 끝 (보라) + 흰 띠
  add(loft([R(3.33, 0.03, 0.262, 0.298, 2.5), R(3.05, 0.097, 0.222, 0.352, 3), R(2.9, 0.118, 0.213, 0.371, 3)], 16), trim, 0, 0, 0);
  add(loft([R(2.9, 0.119, 0.212, 0.372, 3), R(2.8, 0.131, 0.207, 0.384, 3)], 16), accent, 0, 0, 0).castShadow = false;
  // 등 줄무늬: 흰 쌍줄 + 바깥 보라 가는 줄 (가운데는 가속 모드 빛줄 자리)
  const stripe = (x, w, mat, lift) => {
    const secs = S.slice(2, 6).map((s) => {
      const top = s.y + s.h * Math.pow(1 - Math.pow(Math.abs(x) / s.w, s.n), 1 / s.n);
      return R(s.z, w, top - 0.02, top + lift, 4, x);
    });
    add(loft(secs, 8), mat, 0, 0, 0).castShadow = false;
  };
  for (const side of [-1, 1]) {
    stripe(side * 0.075, 0.03, accent, 0.006);
    stripe(side * 0.128, 0.011, trim, 0.007);
  }
  // 옆구리 불꽃 띠 (보라 → 흰색, 뒤로 갈수록 넓어짐) + 질소 통
  for (const side of [-1, 1]) {
    const flame = [];
    for (let i = 0; i < 3; i++) flame.push(bx(0.02, 0.045, 1.5 - i * 0.36, side * (0.365 + i * 0.03), 0.5 - i * 0.07, 0.55 - i * 0.2, 0, side * -0.085, 0));
    add(merge([flame[0], flame[2]]), trim, 0, 0, 0).castShadow = false;
    add(flame[1], accent, 0, 0, 0).castShadow = false;
    // 질소 통 (보라 통 + 은색 띠 + 흰 마개)
    const bz = 1.75, bxx = side * 0.3, by = 0.37;
    const b = add(cz(0.07, 0.07, 0.5, 0, 0, 0, 12), trim, bxx, by, bz);
    b.rotation.y = side * -0.09;
    add(merge([cz(0.074, 0.074, 0.03, 0, 0, 0.14, 12), cz(0.074, 0.074, 0.03, 0, 0, -0.14, 12), cz(0.03, 0.03, 0.1, 0, 0, 0.3, 8)]), metal, bxx, by, bz).rotation.y = side * -0.09;
    add(new THREE.SphereGeometry(0.07, 12, 8).translate(0, 0, 0.25), accent, bxx, by, bz).rotation.y = side * -0.09;
  }
  // ---------------------------------------------------------------- 조종석: 검은 안쪽 + 등받이 + 핸들 + 감싼 앞유리 + 롤케이지
  add(merge([bx(0.48, 0.04, 0.8, 0, 0.675, -0.22), bx(0.4, 0.34, 0.06, 0, 0.8, -0.6, 0.18), bx(0.3, 0.05, 0.3, 0, 0.7, 0.3, -0.25)]), dark, 0, 0, 0);
  const wheel = add(new THREE.TorusGeometry(0.085, 0.016, 6, 14), carbon, 0, 0.75, 0.02);
  wheel.rotation.x = -0.5;
  const ws = add(new THREE.CylinderGeometry(0.33, 0.4, 0.2, 14, 1, true, -1.15, 2.3), glass, 0, 0.74, 0.02);
  ws.castShadow = false;
  add(merge([
    new THREE.TorusGeometry(0.31, 0.03, 6, 18, Math.PI).translate(0, 0.66, -0.66), // 큰 고리 (머리 뒤)
    new THREE.TorusGeometry(0.27, 0.024, 6, 14, Math.PI).rotateX(-0.5).translate(0, 0.64, 0.02), // 앞 고리 (앞유리 틀)
    rodGeometry(V(0.2, 0.9, -0.64), V(0.18, 0.84, -0.1), 0.022), rodGeometry(V(-0.2, 0.9, -0.64), V(-0.18, 0.84, -0.1), 0.022),
    rodGeometry(V(0.3, 0.7, -0.66), V(0.3, 0.6, -0.1), 0.02), rodGeometry(V(-0.3, 0.7, -0.66), V(-0.3, 0.6, -0.1), 0.02),
    // 엔진 옆으로 뻗는 뼈대 (긴 레일): 큰 고리 → 로켓 덮개
    rodGeometry(V(0.22, 0.93, -0.66), V(0.27, 0.82, -1.95), 0.022), rodGeometry(V(-0.22, 0.93, -0.66), V(-0.27, 0.82, -1.95), 0.022),
    rodGeometry(V(0.36, 0.56, -0.7), V(0.33, 0.62, -1.85), 0.022), rodGeometry(V(-0.36, 0.56, -0.7), V(-0.33, 0.62, -1.85), 0.022),
    rodGeometry(V(0.36, 0.56, -0.72), V(0.25, 0.88, -1.3), 0.016), rodGeometry(V(-0.36, 0.56, -0.72), V(-0.25, 0.88, -1.3), 0.016),
    rodGeometry(V(0.34, 0.61, -1.8), V(0.25, 0.88, -1.3), 0.016), rodGeometry(V(-0.34, 0.61, -1.8), V(-0.25, 0.88, -1.3), 0.016),
  ]), metal, 0, 0, 0);
  // ---------------------------------------------------------------- 드러난 V8 엔진 (조종석 뒤, 큰 뒷바퀴 사이)
  const EZ = -1.2; // 엔진 가운데 z
  // 엔진 블록 + 기름 받이 + 블로워 받침
  add(merge([bx(0.36, 0.26, 0.74, 0, 0.7, EZ), bx(0.26, 0.06, 0.62, 0, 0.86, EZ), bx(0.3, 0.08, 0.5, 0, 0.6, EZ)]), darkMetal, 0, 0, 0);
  // 밸브 덮개 (V자로 기운 보라색) + 위 은색 줄 + 점화 플러그 선
  for (const side of [-1, 1]) {
    add(bx(0.19, 0.09, 0.7, side * 0.215, 0.83, EZ, 0, 0, side * -0.75), trim, 0, 0, 0);
    add(bx(0.05, 0.02, 0.6, side * 0.25, 0.885, EZ, 0, 0, side * -0.75), accent, 0, 0, 0).castShadow = false;
  }
  // 블로워(슈퍼차저): 은색 몸통 + 가로 주름 + 앞 벨트
  add(merge([bx(0.3, 0.17, 0.56, 0, 0.965, EZ), cz(0.085, 0.085, 0.05, 0, 0.965, EZ - 0.33, 12), cz(0.11, 0.11, 0.05, 0, 0.66, EZ - 0.4, 12)]), metal, 0, 0, 0);
  const ribs = [];
  for (let i = 0; i < 6; i++) ribs.push(bx(0.32, 0.13, 0.025, 0, 0.965, EZ - 0.22 + i * 0.088));
  ribs.push(bx(0.1, 0.36, 0.025, 0, 0.81, EZ - 0.42, -0.2)); // 벨트
  add(merge(ribs), carbon, 0, 0, 0).castShadow = false;
  // 흡입구 모자 (앞이 뚫린 주황 스쿠프) + 검은 입 + 나비 판 3개
  add(loft([R(EZ + 0.36, 0.2, 1.045, 1.175, 4), R(EZ + 0.1, 0.21, 1.045, 1.17, 4), R(EZ - 0.2, 0.18, 1.045, 1.12, 4), R(EZ - 0.36, 0.13, 1.045, 1.075, 4)], 14), paint, 0, 0, 0);
  add(bx(0.33, 0.085, 0.02, 0, 1.11, EZ + 0.366), dark, 0, 0, 0).castShadow = false;
  add(merge([-0.1, 0, 0.1].map((x) => bx(0.075, 0.07, 0.012, x, 1.11, EZ + 0.38, 0.35))), trim, 0, 0, 0).castShadow = false;
  add(bx(0.06, 0.012, 0.6, 0, 1.176, EZ + 0.04, 0.06), accent, 0, 0, 0).castShadow = false;
  // 헤더 파이프 (한쪽에 4개씩, 밖으로 나와 위·뒤로 솟음) + 검은 구멍
  const pipes = [], tips = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = EZ + 0.27 - i * 0.18;
      const end = [side * 0.57, 1.1, z - 0.36];
      pipes.push(pipe([[side * 0.26, 0.76, z], [side * 0.42, 0.74, z - 0.03], [side * 0.53, 0.86, z - 0.16], end], 0.043, 7, 6));
      const dir = V(side * 0.04, 0.24, -0.2).normalize();
      const tip = new THREE.CircleGeometry(0.033, 8);
      tip.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir));
      tips.push(tip.translate(end[0] + dir.x * 0.004, end[1] + dir.y * 0.004, end[2] + dir.z * 0.004));
    }
  }
  add(merge(pipes), metal, 0, 0, 0);
  add(merge(tips), dark, 0, 0, 0).castShadow = false;
  // ---------------------------------------------------------------- 꼬리 로켓: 보라 고리 + 종 모양 노즐 + 안쪽 빛 + 연료관
  const RY = 0.6;
  add(merge([new THREE.TorusGeometry(0.305, 0.03, 6, 22).translate(0, RY, -2.19), new THREE.TorusGeometry(0.33, 0.022, 6, 22).translate(0, RY, -2.66)]), trim, 0, 0, 0);
  add(cz(0.2, 0.34, 0.5, 0, RY, -2.44, 20, true), darkMetal, 0, 0, 0);
  add(merge([cz(0.215, 0.215, 0.03, 0, RY, -2.26, 16), cz(0.275, 0.275, 0.025, 0, RY, -2.44, 16)]), metal, 0, 0, 0);
  add(new THREE.CircleGeometry(0.21, 18).rotateY(Math.PI).translate(0, RY, -2.285), M.glowTrim, 0, 0, 0).castShadow = false;
  add(merge([
    pipe([[0.2, 0.84, -1.9], [0.3, 0.9, -2.1], [0.3, 0.8, -2.3], [0.22, 0.72, -2.4]], 0.02, 6, 5),
    pipe([[-0.2, 0.84, -1.9], [-0.3, 0.9, -2.1], [-0.3, 0.8, -2.3], [-0.22, 0.72, -2.4]], 0.02, 6, 5),
  ]), metal, 0, 0, 0);
  // 덮개 위 작은 지느러미 3개
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 1.05;
    add(bx(0.025, 0.14, 0.4, Math.sin(a) * 0.34, RY + Math.cos(a) * 0.34, -2.0, 0.25, 0, -a), i === 1 ? trim : paint, 0, 0, 0);
  }
  // 낙하산 팩 2개 (흰 통 + 보라 뚜껑 + 빨간 손잡이 고리)
  for (const side of [-1, 1]) {
    add(cz(0.085, 0.085, 0.3, side * 0.44, 0.78, -2.2, 12), accent, 0, 0, 0);
    add(cz(0.09, 0.075, 0.05, side * 0.44, 0.78, -2.37, 12), trim, 0, 0, 0);
    add(new THREE.TorusGeometry(0.03, 0.009, 5, 10).rotateY(Math.PI / 2).translate(side * 0.44, 0.78, -2.42), tailMat, 0, 0, 0).castShadow = false;
  }
  // 윌리 바 (뒤로 길게 뻗은 막대 + 작은 바퀴 2개): 앞이 들려도 뒤로 안 넘어가게
  add(merge([
    rodGeometry(V(0.3, 0.3, -1.95), V(0.2, 0.1, -3.42), 0.022), rodGeometry(V(-0.3, 0.3, -1.95), V(-0.2, 0.1, -3.42), 0.022),
    rodGeometry(V(0.28, 0.56, -2.15), V(0.2, 0.12, -3.36), 0.018), rodGeometry(V(-0.28, 0.56, -2.15), V(-0.2, 0.12, -3.36), 0.018),
    rodGeometry(V(-0.27, 0.09, -3.44), V(0.27, 0.09, -3.44), 0.018), rodGeometry(V(-0.26, 0.24, -2.6), V(0.26, 0.24, -2.6), 0.016),
  ]), metal, 0, 0, 0);
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.085, 0.085, 0.045, 12).rotateZ(Math.PI / 2), rubber, side * 0.27, 0.09, -3.44);
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 8).rotateZ(Math.PI / 2), trim, side * 0.27, 0.09, -3.44).castShadow = false;
  }
  // ---------------------------------------------------------------- 앞날개 (작은 카나드 + 끝판 + 받침)
  const fWing = new THREE.Group();
  body.add(fWing);
  add(bx(1.0, 0.028, 0.22, 0, 0.3, 2.95, 0.08), carbon, 0, 0, 0, fWing);
  add(bx(0.98, 0.02, 0.08, 0, 0.335, 2.84, 0.4), accent, 0, 0, 0, fWing).castShadow = false;
  for (const side of [-1, 1]) add(merge([bx(0.028, 0.14, 0.3, side * 0.5, 0.33, 2.93), bx(0.05, 0.02, 0.3, side * 0.5, 0.405, 2.93)]), trim, 0, 0, 0, fWing);
  // ---------------------------------------------------------------- 뒷날개 (기둥 4개 위, 높이 1.12 m 그대로: 뒤 카메라를 가리지 않게)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  const main = add(new THREE.BoxGeometry(1.9, 0.05, 0.46), carbon, 0, 1.12, -2.45, spoiler);
  main.rotation.x = 0.12;
  add(bx(1.86, 0.012, 0.07, 0, 1.135, -2.27, 0.12), trim, 0, 0, 0, spoiler).castShadow = false; // 앞전 보라 줄
  const drs = add(new THREE.BoxGeometry(1.9, 0.04, 0.24), paint, 0, 1.22, -2.66, spoiler);
  drs.rotation.x = 0.5;
  const plates = [], caps = [], rods = [], lights = [];
  for (const side of [-1, 1]) {
    plates.push(bx(0.04, 0.36, 0.78, side * 0.95, 1.12, -2.5), bx(0.04, 0.12, 0.3, side * 0.95, 0.9, -2.62, 0.5));
    caps.push(bx(0.045, 0.05, 0.78, side * 0.95, 1.31, -2.5));
    lights.push(bx(0.045, 0.2, 0.02, side * 0.95, 1.14, -2.895));
    rods.push(rodGeometry(V(side * 0.27, 0.84, -1.95), V(side * 0.42, 1.1, -2.32), 0.025), rodGeometry(V(side * 0.24, 0.8, -2.15), V(side * 0.42, 1.1, -2.56), 0.025), rodGeometry(V(side * 0.42, 1.1, -2.32), V(side * 0.42, 1.1, -2.56), 0.018));
  }
  add(merge(plates), paint, 0, 0, 0, spoiler);
  add(merge(caps), accent, 0, 0, 0, spoiler).castShadow = false;
  add(merge(rods), metal, 0, 0, 0, spoiler);
  add(merge(lights), tailMat, 0, 0, 0, spoiler).castShadow = false; // 끝판 뒤 빨간 등
  add(bx(0.34, 0.035, 0.02, 0, 1.085, -2.7), tailMat, 0, 0, 0, spoiler).castShadow = false; // 가운데 브레이크등
  const plateL = add(new THREE.PlaneGeometry(0.32, 0.32), M.numMat, 0.975, 1.12, -2.5, spoiler);
  plateL.rotation.y = Math.PI / 2;
  const plateR = add(new THREE.PlaneGeometry(0.32, 0.32), M.numMat, -0.975, 1.12, -2.5, spoiler);
  plateR.rotation.y = -Math.PI / 2;
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 0.82, -0.3);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.48, 0.4], r: [0.9, 0.78] },
      helmet: [0, 0.82, -0.3],
      visor: [0.86, -0.75],
      armor: { y: 0.66, x: 0.46 },
      ram: { y: 0.06, z: 2.05 },
      spines: [[-0.9, 1.22], [-1.2, 1.2], [-1.5, 1.14], [-2.0, 0.94]],
      booster: { x: 0.54, y0: 0.42, y1: 0.66, z0: -0.45, dz: -1.2 },
      lift: { y: 0.86, z: -2.15, h: 0.2 },
      stab: [0.95, 1.12, -2.5],
      tailFin: [0, 1.17, -0.95],
      wing: [0.42, 0.52, 0.25],
      nitro: { x: 0.43, y: 0.4, z: -2.2, dz: -0.35 },
      vents: [[0.36, 0.64, 0.25], [0.38, 0.65, -0.02], [0.4, 0.66, -0.29]],
      glow: { y: 0.535, z: 1.6, len: 1.6, rot: 0.1, w: 0.05 },
      flames: [[0, 0.6, 1.6, -2.7], [0, 0.6, 0.7, -2.7]],
      motor: [0.34, 0.34, -2.55],
      spark: [0.94, 0.3, -2.15],
      seams: [0.45, 0.2, 0.0],
      lean: 0.05,
      drsRest: 0.5,
    },
  };
}
