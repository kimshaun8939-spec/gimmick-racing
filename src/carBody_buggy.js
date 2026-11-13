// 차체 모양: buildBuggy (모래 버기). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업: 쇠파이프 틀 + 뒤에 드러난 V형 엔진·배기관, 스프링 쇼크업소버 4개, 버킷 시트 2개(운전자는 한쪽 자리),
//   지붕 판 + 둥근 조명 4개, 안테나 깃발, 앞 불바, 옆 발판 파이프. 예전 파일: .debug/carBody_buggy.before-detail.js
// 아래 도우미(V, orient, topY, ribbon, springGeo)는 카트·핫해치·밴 차체 파일(carBody_kart/hatch/van.js)도 같이 씀
import * as THREE from 'three';
import { R, doorNumber, loft, makeHelmet, rodGeometry } from './carModel.js';

export const V = (a) => new THREE.Vector3(...a);
const UP = new THREE.Vector3(0, 1, 0);
/** y축으로 만든 도형을 a→b 방향으로 눕혀 가운데에 놓음 */
export function orient(geo, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}
/** 단면(R)의 윗면 높이 (loft와 같은 다각형 기준) */
export function topY(s, x, seg = 24) {
  const n = s.n || 3, d = Math.abs(x - (s.x || 0));
  let px = s.w, py = s.y;
  for (let j = 1; j <= seg / 4; j++) {
    const a = (j / seg) * Math.PI * 2;
    const qx = s.w * Math.pow(Math.abs(Math.cos(a)), 2 / n), qy = s.y + s.h * Math.pow(Math.sin(a), 2 / n);
    if (d >= qx) return py + (qy - py) * ((px - d) / Math.max(1e-6, px - qx));
    px = qx; py = qy;
  }
  return s.y + s.h;
}
/** 몸통(loft) 윗면에 붙는 줄무늬 띠 (가운데 cx, 반폭 sw, off만큼 띄움) */
export function ribbon(secs, cx, sw, off = 0.008, sub = 3) {
  const pos = [], idx = [];
  const rows = [];
  for (let i = 0; i < secs.length - 1; i++)
    for (let k = 0; k < sub; k++) {
      const t = k / sub, a = secs[i], b = secs[i + 1];
      rows.push({ z: a.z + (b.z - a.z) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t, y: a.y + (b.y - a.y) * t, n: a.n + (b.n - a.n) * t, x: (a.x || 0) + ((b.x || 0) - (a.x || 0)) * t });
    }
  rows.push(secs[secs.length - 1]);
  rows.forEach((s, i) => {
    pos.push(cx - sw, topY(s, cx - sw) + off, s.z, cx + sw, topY(s, cx + sw) + off, s.z);
    if (i < rows.length - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** 스프링 (a→b를 감는 나선) */
export function springGeo(a, b, r = 0.06, wire = 0.014, turns = 6) {
  const L = a.distanceTo(b) * 0.62;
  const pts = [];
  const N = turns * 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N, an = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(an) * r, (t - 0.5) * L, Math.sin(an) * r));
  }
  return orient(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, wire, 4, false), a, b);
}

export function buildBuggy({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, lamp, tailMat, helmetMat } = M;
  const W = [
    [-0.96, 1.55, true, 0.44, 0.38, 0.28],
    [0.96, 1.55, true, 0.44, 0.38, 0.28],
    [-0.98, -1.45, false, 0.46, 0.42, 0.3],
    [0.98, -1.45, false, 0.46, 0.42, 0.3],
  ];
  const box = (w, h, d, mat, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
  const T = (a, b, r = 0.04, mat = trim, parent) => add(rodGeometry(V(a), V(b), r), mat, 0, 0, 0, parent);
  const flat = (m) => { m.castShadow = false; return m; };
  // 밝은 은색 (엔진·배기관·쇼크: 공용 metal은 너무 어두워 엔진이 안 보였음)
  const chrome = new THREE.MeshStandardMaterial({ color: '#c8cdd6', metalness: 0.55, roughness: 0.32 });

  // ---- 몸통: 뾰족한 코 → 보닛 → 낮은 운전석 → 좌석 뒤 턱 → 엔진 받침
  const tub = [R(2.32, 0.28, 0.46, 0.58, 4), R(1.98, 0.48, 0.36, 0.67), R(1.2, 0.57, 0.31, 0.75), R(0.55, 0.6, 0.3, 0.8), R(0.36, 0.6, 0.3, 0.64), R(-0.95, 0.6, 0.3, 0.64), R(-1.1, 0.58, 0.3, 0.8), R(-1.3, 0.5, 0.32, 0.62), R(-2.02, 0.36, 0.38, 0.54, 4)];
  add(loft(tub, 24), paint, 0, 0, 0);
  // 보닛 줄무늬 (가운데 굵은 줄 + 양옆 가는 줄)
  const hood = tub.slice(0, 4);
  flat(add(ribbon(hood, 0, 0.085), accent, 0, 0, 0));
  for (const s of [-1, 1]) flat(add(ribbon(hood, s * 0.15, 0.014), trim, 0, 0, 0));
  // 보닛 걸쇠 2개
  for (const s of [-1, 1]) flat(box(0.05, 0.02, 0.09, metal, s * 0.36, 0.765, 0.75));
  // 옆구리 줄 + 번호판
  for (const s of [-1, 1]) flat(box(0.012, 0.06, 1.25, accent, s * 0.603, 0.38, -0.3));
  doorNumber(add, M, 0.606, 0.5, -0.3, 0.26);
  // 바닥 보호판 (앞이 들림)
  box(0.8, 0.035, 0.55, metal, 0, 0.37, 2.36).rotation.x = -0.55;

  // ---- 운전석: 바닥, 계기판, 핸들, 버킷 시트 2개
  flat(box(1.04, 0.02, 1.22, dark, 0, 0.648, -0.3));
  box(1.0, 0.13, 0.07, dark, 0, 0.8, 0.4);
  for (const x of [0.16, 0.38]) flat(add(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10).rotateX(Math.PI / 2), metal, x, 0.81, 0.36));
  const DX = 0.27; // 운전자 자리
  T([DX, 0.74, 0.4], [DX, 0.9, 0.2], 0.02, carbon);
  const sw = add(new THREE.TorusGeometry(0.13, 0.02, 6, 16), carbon, DX, 0.91, 0.19);
  sw.rotation.x = 0.69;
  box(0.24, 0.02, 0.02, carbon, DX, 0.91, 0.19).rotation.x = 0.69;
  for (const x of [-DX, DX]) {
    box(0.42, 0.1, 0.44, dark, x, 0.7, -0.3);
    box(0.42, 0.6, 0.1, dark, x, 0.98, -0.62).rotation.x = -0.15;
    for (const s of [-1, 1]) box(0.05, 0.32, 0.2, carbon, x + s * 0.21, 0.9, -0.54).rotation.x = -0.15;
    box(0.22, 0.16, 0.09, dark, x, 1.33, -0.68);
    flat(box(0.12, 0.5, 0.012, paint, x, 0.988, -0.565)).rotation.x = -0.15;
  }
  // 빈 옆자리 안전벨트
  for (const s of [-1, 1]) flat(box(0.04, 0.5, 0.014, helmetMat, -DX + s * 0.11, 0.99, -0.562)).rotation.x = -0.15;
  // 운전자 몸통 + 팔
  add(new THREE.CylinderGeometry(0.16, 0.19, 0.4, 10), accent, DX, 0.9, -0.44).rotation.x = -0.15;
  for (const s of [-1, 1]) T([DX + s * 0.17, 1.0, -0.4], [DX + s * 0.11, 0.92, 0.15], 0.045, accent);

  // ---- 쇠파이프 틀 (롤케이지)
  for (const s of [-1, 1]) {
    T([s * 0.58, 0.78, 0.5], [s * 0.5, 1.55, 0.3]); // 앞 기둥
    T([s * 0.58, 0.64, -0.82], [s * 0.5, 1.62, -0.82]); // 가운데 고리
    T([s * 0.5, 1.55, 0.3], [s * 0.5, 1.62, -0.82]); // 지붕 옆
    T([s * 0.5, 1.62, -0.82], [s * 0.42, 0.7, -2.0]); // 뒤 버팀
    T([s * 0.58, 0.78, 0.5], [s * 0.38, 0.62, 1.95]); // 보닛 옆
    T([s * 0.6, 0.98, 0.44], [s * 0.6, 0.98, -0.82], 0.03); // 옆 보호대
    T([s * 0.6, 0.66, 0.3], [s * 0.6, 0.98, -0.82], 0.03); // 옆 대각선
    T([s * 0.52, 0.5, -1.2], [s * 0.42, 0.7, -2.0], 0.035); // 엔진 받침 틀
    T([s * 0.5, 0.5, -1.32], [s * 0.467, 1.24, -1.32], 0.03); // 쇼크 받침 기둥
    T([s * 0.5, 1.62, -0.82], [s * -0.58, 0.66, -0.82], 0.028); // 좌석 뒤 X자
    // 옆 발판 파이프
    T([s * 0.74, 0.36, 0.85], [s * 0.74, 0.36, -0.8], 0.035);
    T([s * 0.74, 0.36, 0.85], [s * 0.56, 0.36, 1.0], 0.03);
    T([s * 0.74, 0.36, -0.8], [s * 0.56, 0.36, -0.92], 0.03);
    T([s * 0.74, 0.36, 0.0], [s * 0.58, 0.36, 0.0], 0.025);
    // 앞 쇼크 받침
    T([s * 0.52, 0.6, 1.42], [s * 0.44, 0.98, 1.42], 0.035);
    // 백미러
    box(0.13, 0.08, 0.025, carbon, s * 0.68, 1.1, 0.46);
  }
  T([-0.5, 1.55, 0.3], [0.5, 1.55, 0.3]);
  T([-0.5, 1.62, -0.82], [0.5, 1.62, -0.82]);
  T([-0.42, 0.7, -2.0], [0.42, 0.7, -2.0]);
  T([-0.55, 1.2, -0.82], [0.55, 1.2, -0.82], 0.03);
  T([-0.467, 1.24, -1.32], [0.467, 1.24, -1.32], 0.03);
  T([-0.44, 0.98, 1.42], [0.44, 0.98, 1.42], 0.03);
  // 지붕 판 + 줄
  box(0.98, 0.025, 1.1, paint, 0, 1.6, -0.26).rotation.x = 0.062;
  flat(box(0.2, 0.006, 1.1, accent, 0, 1.616, -0.26)).rotation.x = 0.062;
  // 지붕 조명 (둥근 등 4개)
  box(1.04, 0.05, 0.1, carbon, 0, 1.6, 0.37);
  for (const x of [-0.39, -0.13, 0.13, 0.39]) {
    add(new THREE.CylinderGeometry(0.095, 0.08, 0.12, 12).rotateX(Math.PI / 2), carbon, x, 1.7, 0.37);
    flat(add(new THREE.CircleGeometry(0.078, 12), lamp, x, 1.7, 0.432));
  }

  // ---- 쇼크업소버 (스프링 4개)
  const shock = (a, b) => {
    a = V(a); b = V(b);
    add(orient(new THREE.CylinderGeometry(0.028, 0.028, a.distanceTo(b), 6), a, b), chrome, 0, 0, 0);
    add(springGeo(a, b), helmetMat, 0, 0, 0);
    for (const t of [0.17, 0.83]) {
      const p = a.clone().lerp(b, t), q = a.clone().lerp(b, t + 0.02);
      add(orient(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 8), p, q), dark, 0, 0, 0);
    }
  };
  for (const s of [-1, 1]) {
    shock([s * 0.66, 0.44, -1.45], [s * 0.47, 1.22, -1.34]);
    shock([s * 0.62, 0.42, 1.55], [s * 0.45, 0.96, 1.44]);
    // 뒤 쇼크 가스통
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), chrome, s * 0.53, 1.05, -1.25);
  }

  // ---- 뒤에 드러난 V형 엔진
  box(0.42, 0.26, 0.56, chrome, 0, 0.7, -1.62);
  for (const s of [-1, 1]) {
    box(0.2, 0.16, 0.5, chrome, s * 0.2, 0.88, -1.62).rotation.z = -s * 0.6;
    box(0.17, 0.045, 0.46, paint, s * 0.256, 0.963, -1.62).rotation.z = -s * 0.6; // 밸브 덮개 (차 색)
    // 배기관: 두 줄이 모여 위로 솟음
    const c1 = new THREE.CatmullRomCurve3([V([s * 0.3, 0.9, -1.46]), V([s * 0.46, 0.78, -1.6]), V([s * 0.47, 0.74, -1.9]), V([s * 0.38, 1.0, -2.06]), V([s * 0.34, 1.3, -2.12])]);
    add(new THREE.TubeGeometry(c1, 14, 0.036, 6, false), chrome, 0, 0, 0);
    const c2 = new THREE.CatmullRomCurve3([V([s * 0.3, 0.9, -1.76]), V([s * 0.44, 0.8, -1.84]), V([s * 0.455, 0.76, -1.94])]);
    add(new THREE.TubeGeometry(c2, 6, 0.036, 6, false), chrome, 0, 0, 0);
    add(orient(new THREE.CylinderGeometry(0.052, 0.036, 0.16, 10), V([s * 0.342, 1.27, -2.115]), V([s * 0.332, 1.43, -2.146])), chrome, 0, 0, 0);
    flat(add(orient(new THREE.CylinderGeometry(0.04, 0.04, 0.004, 10), V([s * 0.332, 1.43, -2.146]), V([s * 0.3318, 1.434, -2.1468])), dark, 0, 0, 0));
  }
  box(0.16, 0.1, 0.4, carbon, 0, 0.93, -1.62);
  add(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 14), accent, 0, 1.03, -1.62); // 공기 필터
  add(new THREE.CylinderGeometry(0.185, 0.185, 0.02, 14), chrome, 0, 1.085, -1.62);
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 12).rotateX(Math.PI / 2), dark, 0, 0.72, -1.92); // 벨트 풀리
  add(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 10).rotateX(Math.PI / 2), chrome, 0.17, 0.84, -1.9);
  // 후미등 + 뒤 번호판 + 머드플랩
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 10).rotateX(Math.PI / 2), tailMat, s * 0.3, 0.7, -2.04);
    box(0.36, 0.3, 0.025, carbon, s * 0.98, 0.26, -2.0);
    flat(box(0.3, 0.04, 0.03, accent, s * 0.98, 0.34, -2.0));
  }
  const rp = flat(add(new THREE.PlaneGeometry(0.22, 0.22), M.numMat, 0, 0.5, -2.05));
  rp.rotation.y = Math.PI;
  // 안테나 + 깃발
  T([-0.42, 0.7, -2.0], [-0.46, 2.3, -2.2], 0.012, metal);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute([-0.46, 2.3, -2.2, -0.455, 2.1, -2.175, -0.46, 2.2, -2.56], 3));
  fg.setIndex([0, 1, 2, 0, 2, 1]);
  fg.computeVertexNormals();
  flat(add(fg, helmetMat, 0, 0, 0));

  // ---- 앞 범퍼 파이프(불바) + 헤드라이트 2개
  const fWing = new THREE.Group();
  body.add(fWing);
  T([-0.62, 0.5, 2.34], [0.62, 0.5, 2.34], 0.045, trim, fWing);
  T([-0.34, 0.86, 2.26], [0.34, 0.86, 2.26], 0.03, trim, fWing);
  for (const s of [-1, 1]) {
    T([s * 0.62, 0.5, 2.34], [s * 0.45, 0.42, 1.95], 0.04, trim, fWing);
    T([s * 0.36, 0.5, 2.34], [s * 0.34, 0.86, 2.26], 0.03, trim, fWing);
    add(new THREE.CylinderGeometry(0.105, 0.09, 0.14, 14).rotateX(Math.PI / 2), carbon, s * 0.3, 0.67, 2.14);
    flat(add(new THREE.CircleGeometry(0.085, 14), lamp, s * 0.3, 0.67, 2.212));
  }
  // 작은 뒷날개 (케이지 지붕 뒤)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.25, 0.04, 0.32), paint, 0, 1.76, -1.02, spoiler);
  flat(add(new THREE.BoxGeometry(0.2, 0.006, 0.32), accent, 0, 1.783, -1.02, spoiler));
  const drs = add(new THREE.BoxGeometry(1.25, 0.035, 0.14), accent, 0, 1.82, -1.18, spoiler);
  drs.rotation.x = 0.3;
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.03, 0.22, 0.44), trim, s * 0.63, 1.76, -1.06, spoiler);
    add(new THREE.BoxGeometry(0.04, 0.16, 0.06), trim, s * 0.4, 1.68, -0.94, spoiler);
  }
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(DX, 1.12, -0.38);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.84, 0.66], r: [0.86, 0.72] },
      helmet: [DX, 1.12, -0.38],
      visor: [1.12, -0.8],
      armor: { y: 0.78, x: 0.62 },
      ram: { y: 0.16, z: 1.62 },
      spines: [[0.15, 1.72], [-0.2, 1.73], [-0.55, 1.73], [-1.55, 1.12]],
      booster: { x: 0.5, y0: 0.6, y1: 0.98, z0: -0.55, dz: -1.25 },
      lift: { y: 1.62, z: -0.97, h: 0.2 },
      stab: [0.63, 1.76, -1.06],
      tailFin: [0, 1.66, -0.3],
      wing: [0.6, 0.66, 0.0],
      nitro: { x: 0.3, y: 0.5, z: -1.95, dz: -0.4 },
      vents: [[0.3, 0.72, 1.1], [0.3, 0.71, 1.35], [0.3, 0.69, 1.6]],
      glow: { y: 0.758, z: 1.35, len: 1.2, rot: 0.06, w: 0.05 },
      flames: [[0.33, 1.42, 0.45, -2.16], [-0.33, 1.42, 0.45, -2.16]],
      motor: [0.36, 0.4, -2.3],
      spark: [0.98, 0.28, -1.95],
      seams: [0.6, 0.28, 0.0],
      lean: 0.085,
      drsRest: 0.3,
    },
  };
}
