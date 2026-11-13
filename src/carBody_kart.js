// 차체 모양: buildKart (카트). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업: 쇠파이프 틀(앞으로 모이는 레일), 코 덮개 + 줄무늬 + 앞 범퍼, 핸들 앞 번호판 방패, 옆 포드 + 번호,
//   버킷 시트, 운전자(장갑·신발·페달), 핸들 살, 연료통, 냉각핀 달린 엔진 + 공기통 + 배기 챔버, 체인 덮개·톱니, 브레이크 디스크, 라디에이터, 뒤 범퍼 + 번호판
//   예전 파일: .debug/carBody_kart.before-detail.js
import * as THREE from 'three';
import { R, archGeo, loft, makeHelmet, rodGeometry } from './carModel.js';
import { V, orient, ribbon } from './carBody_buggy.js';

export function buildKart({ add, body, M, look }) {
  const { paint, accent, trim, carbon, dark, metal } = M;
  const W = [
    [-0.72, 1.0, true, 0.25, 0.2, 0.2],
    [0.72, 1.0, true, 0.25, 0.2, 0.2],
    [-0.76, -0.98, false, 0.28, 0.3, 0.2],
    [0.76, -0.98, false, 0.28, 0.3, 0.2],
  ];
  const box = (w, h, d, mat, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
  const T = (a, b, r = 0.025, mat = trim, parent) => add(rodGeometry(V(a), V(b), r), mat, 0, 0, 0, parent);
  const flat = (m) => { m.castShadow = false; return m; };
  // 밝은 알루미늄 색 (엔진·배기관이 잘 보이게)
  const alu = new THREE.MeshStandardMaterial({ color: '#c8cdd6', metalness: 0.55, roughness: 0.32 });

  // ---- 바닥판 + 쇠파이프 틀
  box(0.6, 0.02, 1.5, carbon, 0, 0.1, 0.25);
  for (const s of [-1, 1]) {
    T([s * 0.34, 0.12, -1.12], [s * 0.34, 0.12, 0.35]);
    T([s * 0.34, 0.12, 0.35], [s * 0.2, 0.13, 1.22]);
    T([s * 0.27, 0.13, 0.98], [s * 0.58, 0.2, 1.0], 0.03); // 앞 차축 팔
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 8), metal, s * 0.58, 0.22, 1.0); // 킹핀
    T([0, 0.2, 0.72], [s * 0.56, 0.22, 0.9], 0.012, metal); // 타이로드
    box(0.05, 0.12, 0.1, metal, s * 0.34, 0.24, -0.98); // 뒤 차축 베어링
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10).rotateZ(Math.PI / 2), metal, s * 0.58, 0.28, -0.98); // 허브
    T([s * 0.34, 0.12, 0.3], [s * 0.5, 0.14, 0.3], 0.018); // 옆 포드 받침
    T([s * 0.34, 0.12, -0.25], [s * 0.5, 0.14, -0.25], 0.018);
    T([s * 0.2, 0.13, 0.6], [0, 0.36, 0.43], 0.015); // 핸들 기둥 받침
    T([s * 0.22, 0.5, -0.64], [s * 0.34, 0.26, -0.95], 0.012, metal); // 시트 받침
  }
  T([-0.2, 0.13, 1.22], [0.2, 0.13, 1.22]);
  T([-0.34, 0.12, 0.35], [0.34, 0.12, 0.35]);
  T([-0.34, 0.12, -0.45], [0.34, 0.12, -0.45]);
  T([-0.34, 0.12, -1.12], [0.34, 0.12, -1.12]);
  T([-0.64, 0.28, -0.98], [0.64, 0.28, -0.98], 0.035, metal).userData.wheelJoint = true; // 뒤 차축: 타이어 안쪽 허브에 들어가는 정상 연결

  // ---- 코 덮개 + 줄무늬
  const nose = [R(1.5, 0.32, 0.1, 0.26, 4), R(1.28, 0.46, 0.09, 0.33), R(0.95, 0.42, 0.1, 0.36), R(0.78, 0.3, 0.12, 0.34)];
  add(loft(nose, 20), paint, 0, 0, 0);
  flat(add(ribbon(nose, 0, 0.07, 0.006), accent, 0, 0, 0));
  for (const s of [-1, 1]) flat(add(ribbon(nose, s * 0.13, 0.015, 0.006), trim, 0, 0, 0));
  // 핸들 앞 방패 (번호판)
  const sh = new THREE.Shape();
  sh.moveTo(-0.17, 0);
  sh.lineTo(0.17, 0);
  sh.lineTo(0.19, 0.22);
  sh.quadraticCurveTo(0.19, 0.36, 0, 0.38);
  sh.quadraticCurveTo(-0.19, 0.36, -0.19, 0.22);
  sh.closePath();
  const shGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 6 });
  add(shGeo, paint, 0, 0.3, 0.8).rotation.x = -0.55;
  add(shGeo.clone().scale(1.12, 1.08, 0.6).translate(0, -0.012, -0.012), accent, 0, 0.3, 0.8).rotation.x = -0.55;
  const np = flat(add(new THREE.PlaneGeometry(0.26, 0.26), M.numMat, 0, 0.481, 0.731));
  np.rotation.x = -0.55;

  // ---- 옆 포드 + 번호
  for (const s of [-1, 1]) {
    const x = s * 0.6;
    add(loft([R(0.62, 0.08, 0.1, 0.24, 4, x), R(0.35, 0.13, 0.08, 0.3, 4, x), R(-0.3, 0.13, 0.08, 0.3, 4, x), R(-0.62, 0.08, 0.1, 0.24, 4, x)], 16), accent, 0, 0, 0);
    flat(box(0.02, 0.04, 0.84, paint, s * 0.735, 0.265, 0.0));
    flat(box(0.16, 0.012, 0.7, paint, x, 0.303, 0.0));
    const p = flat(add(new THREE.PlaneGeometry(0.15, 0.15), M.numMat, s * 0.741, 0.165, 0.0));
    p.rotation.y = s * Math.PI / 2;
  }

  // ---- 버킷 시트
  box(0.4, 0.05, 0.36, carbon, 0, 0.17, -0.34);
  box(0.42, 0.46, 0.05, carbon, 0, 0.4, -0.56).rotation.x = -0.35;
  for (const s of [-1, 1]) box(0.04, 0.26, 0.36, carbon, s * 0.22, 0.3, -0.42).rotation.x = -0.2;
  // ---- 운전자 몸통·팔·다리 + 장갑·신발, 페달
  const suit = new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.6 });
  add(new THREE.CylinderGeometry(0.17, 0.2, 0.46, 12), suit, 0, 0.52, -0.38).rotation.x = -0.3;
  flat(box(0.1, 0.3, 0.02, paint, 0, 0.56, -0.2)).rotation.x = -0.3; // 가슴 줄
  for (const s of [-1, 1]) {
    T([s * 0.18, 0.66, -0.3], [s * 0.13, 0.53, 0.16], 0.045, suit);
    T([s * 0.12, 0.22, -0.1], [s * 0.14, 0.2, 0.62], 0.055, suit); // 다리
    add(new THREE.SphereGeometry(0.055, 8, 6), dark, s * 0.13, 0.53, 0.18);
    box(0.09, 0.08, 0.16, dark, s * 0.14, 0.2, 0.68);
    box(0.07, 0.1, 0.015, metal, s * 0.14, 0.2, 0.79).rotation.x = 0.4;
  }
  // ---- 핸들 (기둥 + 바퀴 + 살)
  T([0, 0.16, 0.75], [0, 0.5, 0.2], 0.02, metal);
  const SW = [0, 0.52, 0.18];
  add(new THREE.TorusGeometry(0.14, 0.022, 6, 18), carbon, ...SW).rotation.x = 0.554;
  box(0.26, 0.022, 0.02, carbon, ...SW).rotation.x = 0.554;
  box(0.022, 0.14, 0.02, carbon, 0, 0.46, 0.215).rotation.x = 0.554;
  // 연료통 (다리 사이)
  const tank = new THREE.MeshStandardMaterial({ color: '#eef0ee', roughness: 0.45 });
  box(0.2, 0.12, 0.24, tank, 0, 0.18, 0.36);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), dark, 0, 0.255, 0.4);

  // ---- 오른쪽 뒤 엔진: 크랭크 케이스 + 냉각핀 + 공기통 + 배기 챔버
  box(0.24, 0.18, 0.28, alu, 0.36, 0.24, -0.72);
  box(0.15, 0.17, 0.15, dark, 0.36, 0.41, -0.7);
  for (let i = 0; i < 5; i++) box(0.2, 0.014, 0.2, alu, 0.36, 0.35 + i * 0.03, -0.7);
  box(0.18, 0.03, 0.18, trim, 0.36, 0.5, -0.7);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), accent, 0.36, 0.54, -0.7); // 점화 플러그
  box(0.14, 0.14, 0.2, accent, 0.4, 0.36, -0.47); // 공기통
  add(new THREE.CylinderGeometry(0.04, 0.05, 0.06, 10).rotateX(Math.PI / 2), dark, 0.4, 0.36, -0.35);
  const ex = new THREE.CatmullRomCurve3([V([0.36, 0.44, -0.8]), V([0.3, 0.5, -0.9]), V([0.3, 0.46, -1.0])]);
  add(new THREE.TubeGeometry(ex, 8, 0.03, 6, false), alu, 0, 0, 0);
  add(orient(new THREE.CylinderGeometry(0.03, 0.062, 0.06, 10), V([0.3, 0.46, -1.06]), V([0.3, 0.46, -1.0])), alu, 0, 0, 0);
  add(orient(new THREE.CylinderGeometry(0.062, 0.062, 0.14, 10), V([0.31, 0.44, -1.2]), V([0.3, 0.46, -1.06])), alu, 0, 0, 0);
  add(orient(new THREE.CylinderGeometry(0.062, 0.028, 0.05, 10), V([0.312, 0.435, -1.25]), V([0.31, 0.44, -1.2])), alu, 0, 0, 0);
  add(orient(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 8), V([0.315, 0.43, -1.31]), V([0.312, 0.435, -1.25])), dark, 0, 0, 0);
  // 체인: 톱니 2개 + 덮개 + 체인
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.015, 14).rotateZ(Math.PI / 2), metal, 0.17, 0.28, -0.98);
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8).rotateZ(Math.PI / 2), metal, 0.2, 0.26, -0.72);
  add(archGeo(0.105, 0.13, 0.05), accent, 0.17, 0.28, -0.98);
  box(0.05, 0.03, 0.3, accent, 0.17, 0.395, -0.84).rotation.x = -0.12;
  flat(box(0.012, 0.012, 0.26, dark, 0.17, 0.2, -0.85));
  // 브레이크 디스크 + 캘리퍼
  add(new THREE.CylinderGeometry(0.095, 0.095, 0.012, 14).rotateZ(Math.PI / 2), metal, -0.2, 0.28, -0.98);
  box(0.05, 0.07, 0.09, paint, -0.2, 0.355, -0.95);
  // 왼쪽 라디에이터
  box(0.04, 0.3, 0.26, metal, -0.44, 0.42, -0.52).rotation.x = -0.25;
  flat(box(0.012, 0.25, 0.21, dark, -0.463, 0.42, -0.52)).rotation.x = -0.25;
  flat(box(0.012, 0.25, 0.21, dark, -0.417, 0.42, -0.52)).rotation.x = -0.25;
  T([-0.44, 0.28, -0.5], [-0.34, 0.12, -0.45], 0.012);
  T([-0.42, 0.3, -0.6], [0.24, 0.3, -0.74], 0.015, dark); // 냉각수 호스

  // ---- 앞 범퍼 (파이프 + 검은 턱)
  const fWing = new THREE.Group();
  body.add(fWing);
  T([-0.42, 0.16, 1.52], [0.42, 0.16, 1.52], 0.025, trim, fWing);
  T([-0.4, 0.26, 1.5], [0.4, 0.26, 1.5], 0.018, trim, fWing);
  for (const s of [-1, 1]) {
    T([s * 0.42, 0.16, 1.52], [s * 0.3, 0.13, 1.15], 0.025, trim, fWing);
    T([s * 0.4, 0.26, 1.5], [s * 0.42, 0.16, 1.52], 0.018, trim, fWing);
  }
  box(0.8, 0.025, 0.14, carbon, 0, 0.085, 1.44, fWing);
  // ---- 뒤 범퍼 (넓은 판) + 뒤 번호판 — 변신 때 뒷날개처럼 움직임
  const spoiler = new THREE.Group();
  body.add(spoiler);
  box(1.46, 0.07, 0.12, paint, 0, 0.3, -1.32, spoiler);
  const drs = box(1.2, 0.035, 0.1, accent, 0, 0.36, -1.38, spoiler);
  drs.rotation.x = 0.2;
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.075, 10), paint, s * 0.73, 0.3, -1.48, spoiler);
    box(0.03, 0.12, 0.2, trim, s * 0.75, 0.3, -1.48, spoiler);
    T([s * 0.34, 0.12, -1.12], [s * 0.34, 0.28, -1.3], 0.02, trim, spoiler);
  }
  box(0.02, 0.14, 0.02, trim, 0, 0.4, -1.36, spoiler);
  box(0.24, 0.22, 0.015, accent, 0, 0.52, -1.37, spoiler);
  const rp = flat(add(new THREE.PlaneGeometry(0.2, 0.2), M.numMat, 0, 0.52, -1.379, spoiler));
  rp.rotation.y = Math.PI;
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 0.92, -0.36);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.6, 0.4], r: [0.62, 0.44] },
      helmet: [0, 0.92, -0.36],
      visor: [0.85, -0.55],
      armor: { y: 0.48, x: 0.62 },
      ram: { y: 0.02, z: 0.95 },
      spines: [[-0.62, 0.98], [-0.85, 0.86], [-1.05, 0.7], [-1.25, 0.55]],
      booster: { x: 0.42, y0: 0.3, y1: 0.62, z0: -0.35, dz: -0.95 },
      lift: { y: 0.3, z: -1.25, h: 0.18 },
      stab: [0.74, 0.48, -1.57],
      tailFin: [0, 0.66, -0.85],
      wing: [0.62, 0.3, 0.0],
      nitro: { x: 0.32, y: 0.4, z: -1.1, dz: -0.35 },
      vents: [[0.6, 0.31, 0.3], [0.6, 0.32, 0.05], [0.6, 0.31, -0.2]],
      glow: { y: 0.375, z: 1.2, len: 0.55, rot: 0.2, w: 0.05 },
      flames: [[0.315, 0.43, 0.4, -1.34]],
      motor: [0.32, 0.25, -1.35],
      spark: [0.76, 0.2, -1.25],
      seams: [0.38, 0.08, 0.0],
      lean: 0.05,
      pitch: 0.03, // 카트는 서스펜션이 없어 거의 안 숙임
      hull: [0.8, 0.85, 0.56, -0.15], // 배 모드 선체: 작은 카트에 맞게 [폭, 높이, 길이 배수, 앞뒤 이동 m]
      drsRest: 0.2,
    },
  };
}
