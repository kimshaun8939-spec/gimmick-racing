// 차체 모양: buildTruck (carModel.js에서 떼어 낸 파일, 2026-11-10). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-10 디테일 작업 (고치기 전: .debug/carBody_truck.before-detail.js)
//   공통: 부푼 펜더, 보닛 가운데 돔, 문 틈·손잡이, A필러, 배기구, 번호판
//   trophy: 스키드 플레이트, 파이프 범퍼(보조등 4개), 지붕 조명 막대, 비스듬히 세운 예비 타이어, 굵은 뒤 쇼크, 추격등, 롤케이지, 리버리
//   pickup: 크림색 지붕 투톤, 크롬 그릴·범퍼, 발판, 햇빛 가리개, 나무 울타리 짐칸(상자·건초·우유통)
import * as THREE from 'three';
import { R, arches, doorNumber, loft, makeHelmet, rodGeometry } from './carModel.js';

export function buildTruck({ add, body, M, look }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, lampYellow, tailMat, rubber } = M;
  const pickup = look.variant === 'pickup';
  const r = pickup ? 0.44 : 0.5, wd = pickup ? 0.34 : 0.42, wx = pickup ? 0.92 : 1.0;
  const W = [
    [-wx, 1.7, true, r, wd, 0.3],
    [wx, 1.7, true, r, wd, 0.3],
    [-wx, -1.55, false, r, wd, 0.3],
    [wx, -1.55, false, r, wd, 0.3],
  ];
  const y0 = pickup ? 0.5 : 0.58; // 차체 바닥 높이
  // 이 파일에서만 쓰는 재질 (dispose는 carModel이 같이 함)
  const white = new THREE.MeshStandardMaterial({ color: '#eceef1', roughness: 0.5 });
  const chrome = pickup ? new THREE.MeshStandardMaterial({ color: '#e3e6ea', roughness: 0.22, metalness: 0.5 }) : metal;
  // 도우미
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
  const T = (a, b, rr = 0.035, mat = trim, parent = body) => add(rodGeometry(new THREE.Vector3(...a), new THREE.Vector3(...b), rr), mat, 0, 0, 0, parent);
  // 바퀴 위를 둥글게 덮는 펜더 (아치를 따라가는 덩어리)
  const fender = (x, z, hw, mat, thick = 0.1, out = 0.15) => {
    const Ro = r + out, secs = [];
    for (let a = 12; a <= 168; a += 26) {
      const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
      const yb = r + Ro * s - 0.03;
      secs.push(R(z + Ro * c * 1.04, hw * (0.8 + 0.2 * s), yb, yb + thick * (0.45 + 0.55 * s), 4, x));
    }
    return add(loft(secs, 14), mat, 0, 0, 0);
  };

  // ---------------- 프레임 + 보닛·캐빈 아래 몸통
  box(carbon, 0.8, 0.14, 4.7, 0, y0 - 0.02, 0.05);
  add(loft([R(2.6, 0.78, y0 + 0.04, y0 + 0.42, 6), R(2.35, 0.86, y0, y0 + 0.56), R(0.9, 0.88, y0, y0 + 0.62), R(-0.66, 0.88, y0, y0 + 0.66)], 24), paint, 0, 0, 0);
  // 보닛 가운데 돔
  add(loft([R(2.42, 0.3, y0 + 0.4, y0 + 0.57, 4), R(1.7, 0.36, y0 + 0.5, y0 + 0.655, 4), R(0.82, 0.4, y0 + 0.5, y0 + 0.69, 4)], 16), paint, 0, 0, 0);
  // 캐빈 유리 + 지붕 (픽업은 지붕이 크림색)
  add(loft([R(0.72, 0.84, y0 + 0.6, y0 + 0.66, 6), R(0.4, 0.84, y0 + 0.64, y0 + 1.16, 6), R(-0.5, 0.84, y0 + 0.64, y0 + 1.2, 6), R(-0.64, 0.84, y0 + 0.64, y0 + 1.14, 6)], 24), glass, 0, 0, 0);
  add(loft([R(0.4, 0.8, y0 + 1.13, y0 + 1.2, 5), R(-0.1, 0.83, y0 + 1.16, y0 + 1.24, 5), R(-0.64, 0.82, y0 + 1.14, y0 + 1.22, 5)], 24), pickup ? accent : paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    box(paint, 0.05, 0.54, 0.1, side * 0.86, y0 + 0.9, -0.15); // B필러
    T([side * 0.84, y0 + 0.64, 0.7], [side * 0.82, y0 + 1.15, 0.4], 0.04, paint); // A필러
    box(paint, 0.06, 0.54, 0.1, side * 0.84, y0 + 0.9, -0.6); // 캐빈 뒤 모서리
    deco(pickup ? chrome : dark, 0.03, 0.03, 1.4, side * 0.875, y0 + 0.665, 0.03); // 창문 아래 줄
    // 문 틈 + 손잡이
    deco(dark, 0.012, 0.56, 0.014, side * 0.89, y0 + 0.34, 0.68);
    deco(dark, 0.012, 0.56, 0.014, side * 0.89, y0 + 0.34, -0.5);
    deco(pickup ? chrome : dark, 0.025, 0.03, 0.14, side * 0.895, y0 + 0.52, -0.3);
    // 백미러 (다리 + 거울)
    T([side * 0.86, y0 + 0.72, 0.6], [side * 1.0, y0 + 0.8, 0.6], 0.016, pickup ? chrome : carbon);
    if (pickup) {
      add(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 14).rotateX(Math.PI / 2), chrome, side * 1.04, y0 + 0.82, 0.6);
    } else {
      box(carbon, 0.14, 0.16, 0.06, side * 1.05, y0 + 0.82, 0.6);
    }
    // 와이퍼
    T([side * 0.3 - 0.25, y0 + 0.68, 0.71], [side * 0.3 + 0.1, y0 + 0.86, 0.6], 0.012, dark).castShadow = false;
  }
  // ---------------- 짐칸: 바닥 + 양옆 벽(윗테) + 뒷문
  box(pickup ? dark : carbon, 1.72, 0.05, 1.85, 0, y0 + 0.2, -1.62);
  for (const side of [-1, 1]) {
    box(paint, 0.06, 0.46, 1.9, side * 0.87, y0 + 0.42, -1.6);
    box(pickup ? chrome : carbon, 0.09, 0.035, 1.92, side * 0.87, y0 + 0.665, -1.6);
  }
  box(paint, 1.8, 0.46, 0.06, 0, y0 + 0.42, -2.56);
  box(pickup ? chrome : carbon, 1.8, 0.035, 0.09, 0, y0 + 0.665, -2.56);
  box(paint, 1.74, 0.46, 0.05, 0, y0 + 0.42, -0.68); // 짐칸 앞 벽
  deco(accent, 1.2, 0.1, 0.03, 0, y0 + 0.47, -2.6);
  deco(dark, 0.012, 0.4, 0.02, -0.72, y0 + 0.42, -2.595);
  deco(dark, 0.012, 0.4, 0.02, 0.72, y0 + 0.42, -2.595);
  deco(pickup ? chrome : dark, 0.2, 0.035, 0.03, 0, y0 + 0.58, -2.6); // 뒷문 손잡이
  doorNumber(add, M, 0.9, y0 + 0.36, 0.1, 0.38);
  // 뒤 번호판 + 배기구 2개
  deco(white, 0.4, 0.12, 0.02, 0, y0 + 0.3, -2.6);
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.06, 0.065, 0.32, 12).rotateX(Math.PI / 2), chrome, side * 0.6, y0 + 0.06, -2.5);
    add(new THREE.CircleGeometry(0.048, 12).rotateY(Math.PI), dark, side * 0.6, y0 + 0.06, -2.662).castShadow = false;
  }
  const fWing = new THREE.Group();
  body.add(fWing);
  const spoiler = new THREE.Group();
  body.add(spoiler);
  let drs;

  if (!pickup) {
    // ================= 트로피 트럭
    const cage = new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.4, metalness: 0.3, emissive: '#3a3d42' });
    // 펜더: 카본 아치 + 그 위 차체색 덮개
    arches(add, M, W, 0.03, 0.15, 0.2, carbon);
    for (const [x, z] of W) fender(x, z, (wd + 0.2) / 2 + 0.02, paint, 0.11);
    // 리버리: 옆 아래 띠 + 사선 줄 + 작은 색 조각, 보닛·지붕 줄
    for (const side of [-1, 1]) {
      const sx = side * 0.895;
      deco(accent, 0.02, 0.09, 1.5, sx, y0 + 0.14, 0.08);
      deco(trim, 0.02, 0.03, 1.5, sx + side * 0.002, y0 + 0.21, 0.08);
      deco(accent, 0.02, 0.09, 0.62, sx, y0 + 0.4, -0.3, -0.6);
      deco(white, 0.02, 0.05, 0.56, sx, y0 + 0.4, -0.16, -0.6);
      deco(accent, 0.02, 0.035, 0.5, sx, y0 + 0.4, -0.06, -0.6);
      deco(accent, 0.02, 0.09, 0.5, sx, y0 + 0.42, 0.56, -0.6);
      // 짐칸 옆 색 조각 (후원사 스티커 느낌, 글자 없음)
      deco(white, 0.012, 0.09, 0.3, side * 0.905, y0 + 0.5, -2.2);
      deco(accent, 0.012, 0.09, 0.14, side * 0.905, y0 + 0.5, -2.45);
      deco(trim, 0.012, 0.05, 0.3, side * 0.905, y0 + 0.4, -2.2);
      // 보닛 통풍구
      for (let i = 0; i < 4; i++) deco(dark, 0.2, 0.014, 0.05, side * 0.6, y0 + 0.615, 1.2 + i * 0.11, 0.3);
      // 뒤 머드플랩
      box(dark, 0.46, 0.36, 0.025, side * wx, 0.3, -1.55 - 0.72, -0.1);
      deco(accent, 0.3, 0.05, 0.028, side * wx, 0.36, -1.55 - 0.714, -0.1);
      // 캐빈 옆 발판 파이프
      T([side * 0.95, y0 - 0.04, 0.85], [side * 0.95, y0 - 0.04, -0.6], 0.04, trim);
      // 옆 그물창 느낌의 롤케이지
      T([side * 0.72, y0 + 0.64, -0.5], [side * 0.7, y0 + 1.12, -0.45], 0.03, cage);
      T([side * 0.7, y0 + 1.12, -0.45], [side * 0.7, y0 + 1.08, 0.3], 0.028, cage);
      T([side * 0.7, y0 + 1.08, 0.3], [side * 0.74, y0 + 0.64, 0.62], 0.028, cage);
      T([side * 0.74, y0 + 0.68, 0.55], [side * 0.72, y0 + 0.9, -0.5], 0.024, cage);
    }
    T([-0.7, y0 + 1.12, -0.45], [0.7, y0 + 1.12, -0.45], 0.03, cage);
    T([-0.72, y0 + 0.66, -0.5], [0.7, y0 + 1.12, -0.45], 0.026, cage);
    deco(accent, 0.34, 0.012, 1.4, 0, y0 + 0.672, 1.55, 0.088);
    deco(trim, 0.05, 0.013, 1.4, 0.21, y0 + 0.662, 1.55, 0.088);
    deco(trim, 0.05, 0.013, 1.4, -0.21, y0 + 0.662, 1.55, 0.088);
    deco(accent, 0.34, 0.012, 0.42, 0, y0 + 1.245, -0.42);
    // 앞 얼굴: 검은 그릴(세로 살) + 가는 헤드라이트 + 견인고리
    box(dark, 1.1, 0.26, 0.04, 0, y0 + 0.27, 2.61);
    for (const x of [-0.3, -0.15, 0, 0.15, 0.3]) deco(carbon, 0.025, 0.24, 0.05, x, y0 + 0.27, 2.615);
    for (const side of [-1, 1]) {
      deco(lamp, 0.26, 0.06, 0.03, side * 0.56, y0 + 0.33, 2.625);
      deco(lampYellow, 0.26, 0.025, 0.03, side * 0.56, y0 + 0.265, 2.625);
      add(new THREE.TorusGeometry(0.04, 0.013, 4, 8), accent, side * 0.42, y0 + 0.02, 2.66).rotation.y = Math.PI / 2;
    }
    // 스키드 플레이트 (앞 아래 비스듬한 쇠판 + 볼트 줄)
    box(metal, 1.3, 0.03, 0.8, 0, y0 - 0.1, 2.38, -0.42, 0, 0, fWing);
    for (const x of [-0.42, 0, 0.42]) deco(dark, 0.06, 0.035, 0.6, x, y0 - 0.095, 2.38, -0.42, 0, 0, fWing);
    // 파이프 범퍼 + 보조등 4개
    for (const side of [-1, 1]) {
      T([side * 0.75, y0 + 0.1, 2.75], [side * 0.6, y0 + 0.62, 2.62], 0.04, trim, fWing);
      T([side * 0.75, y0 + 0.1, 2.75], [side * 0.85, y0 + 0.1, 2.4], 0.04, trim, fWing);
      T([side * 0.3, y0 + 0.1, 2.75], [side * 0.3, y0 - 0.22, 2.62], 0.03, trim, fWing);
    }
    T([-0.75, y0 + 0.1, 2.75], [0.75, y0 + 0.1, 2.75], 0.045, trim, fWing);
    T([-0.6, y0 + 0.62, 2.62], [0.6, y0 + 0.62, 2.62], 0.04, trim, fWing);
    for (const x of [-0.42, -0.14, 0.14, 0.42]) {
      add(new THREE.CylinderGeometry(0.105, 0.09, 0.09, 14).rotateX(Math.PI / 2), carbon, x, y0 + 0.74, 2.66, fWing);
      add(new THREE.CircleGeometry(0.085, 14), lamp, x, y0 + 0.74, 2.708, fWing).castShadow = false;
      add(new THREE.TorusGeometry(0.092, 0.011, 4, 10), metal, x, y0 + 0.74, 2.706, fWing).castShadow = false;
    }
    // 지붕 조명 막대 (카본 집 + 전구 6개) + 지붕 흡기구 + 안테나(깃발)
    box(carbon, 1.56, 0.12, 0.14, 0, y0 + 1.29, 0.3);
    for (let i = 0; i < 6; i++) deco(lamp, 0.2, 0.075, 0.02, -0.6 + i * 0.24, y0 + 1.29, 0.372);
    for (const side of [-1, 1]) box(carbon, 0.04, 0.14, 0.2, side * 0.8, y0 + 1.27, 0.26);
    add(loft([R(0.1, 0.2, y0 + 1.22, y0 + 1.25, 3), R(-0.05, 0.24, y0 + 1.22, y0 + 1.37, 3), R(-0.45, 0.24, y0 + 1.22, y0 + 1.36, 3), R(-0.62, 0.2, y0 + 1.2, y0 + 1.27, 3)], 14), paint, 0, 0, 0);
    box(dark, 0.4, 0.09, 0.03, 0, y0 + 1.3, -0.0, -0.2);
    T([0.6, y0 + 1.2, -0.55], [0.63, y0 + 2.0, -0.8], 0.009, carbon);
    deco(accent, 0.01, 0.1, 0.22, 0.63, y0 + 1.9, -0.9, 0.3);
    // 짐칸: 연료통 + 비스듬히 세운 예비 타이어(끈) + 받침 파이프
    box(metal, 1.1, 0.3, 0.4, 0, y0 + 0.38, -0.95);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), trim, 0.35, y0 + 0.55, -0.95);
    const spare = new THREE.Group();
    spare.position.set(0, y0 + 0.72, -1.72);
    spare.rotation.x = Math.PI / 2 - 0.55;
    body.add(spare);
    add(new THREE.TorusGeometry(0.34, 0.15, 7, 16), rubber, 0, 0, 0, spare);
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 14).rotateX(Math.PI / 2), M.rimMat, 0, 0, 0, spare);
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 8).rotateX(Math.PI / 2), dark, 0, 0, 0, spare);
    box(trim, 0.07, 1.0, 0.02, 0, 0, 0.155, 0, 0, 0.78, spare).castShadow = false;
    box(trim, 0.07, 1.0, 0.02, 0, 0, 0.155, 0, 0, -0.78, spare).castShadow = false;
    T([-0.5, y0 + 0.22, -2.1], [0.5, y0 + 0.22, -2.1], 0.035, carbon);
    for (const side of [-1, 1]) {
      // 굵은 뒤 쇼크업소버 2개씩 (가는 축 + 색 스프링 통)
      for (const zz of [-1.2, -1.9]) {
        const a = [side * 0.55, y0 + 0.5, zz], b = [side * 0.9, y0 - 0.12, -1.55];
        T(a, b, 0.028, metal);
        const mid = (k) => a.map((v, i) => v + (b[i] - v) * k);
        T(mid(0.05), mid(0.6), 0.06, accent);
      }
      // 뒤 트레일링 암
      T([side * 0.42, y0 - 0.02, -0.5], [side * 0.86, r - 0.1, -1.55], 0.045, carbon);
      // 캐빈 뒤 롤바 → 짐칸 뒤로
      T([side * 0.75, y0 + 0.66, -0.7], [side * 0.7, y0 + 1.08, -1.2], 0.04, trim, spoiler);
      T([side * 0.7, y0 + 1.08, -1.2], [side * 0.75, y0 + 0.66, -2.45], 0.04, trim, spoiler);
      T([side * 0.7, y0 + 1.08, -1.2], [side * 0.72, y0 + 1.15, -0.6], 0.035, trim, spoiler);
      box(accent, 0.03, 0.16, 0.44, side * 0.81, y0 + 1.14, -1.27, 0, 0, 0, spoiler); // 날개 끝판
    }
    T([-0.72, y0 + 0.9, -1.85], [0.72, y0 + 0.9, -1.85], 0.035, trim, spoiler);
    box(paint, 1.6, 0.05, 0.38, 0, y0 + 1.12, -1.25, 0, 0, 0, spoiler);
    drs = box(accent, 1.6, 0.035, 0.16, 0, y0 + 1.18, -1.42, 0, 0, 0, spoiler);
    // 추격등 (날개 아래, 뒤를 향함: 노랑 2 + 빨강 2)
    box(carbon, 1.0, 0.1, 0.05, 0, y0 + 1.03, -1.4, 0, 0, 0, spoiler);
    for (const [x, m] of [[-0.36, tailMat], [-0.12, lampYellow], [0.12, lampYellow], [0.36, tailMat]]) deco(m, 0.18, 0.065, 0.02, x, y0 + 1.03, -1.43, 0, 0, 0, spoiler);
    // 뒤: 세로 후미등 + 파이프 범퍼
    for (const side of [-1, 1]) {
      box(dark, 0.14, 0.34, 0.03, side * 0.8, y0 + 0.44, -2.595);
      deco(tailMat, 0.1, 0.28, 0.03, side * 0.8, y0 + 0.44, -2.605);
      T([side * 0.5, y0 - 0.02, -2.35], [side * 0.5, y0 + 0.04, -2.72], 0.035, trim);
    }
    T([-0.8, y0 + 0.04, -2.72], [0.8, y0 + 0.04, -2.72], 0.04, trim);
  } else {
    // ================= 팜 픽업
    const wood = new THREE.MeshStandardMaterial({ color: '#a8743f', roughness: 0.8 });
    const woodDark = new THREE.MeshStandardMaterial({ color: '#6f4a26', roughness: 0.85 });
    const hay = new THREE.MeshStandardMaterial({ color: '#d9b84a', roughness: 0.95 });
    // 펜더: 차체색 아치 + 둥근 덮개
    arches(add, M, W, 0.03, 0.12, 0.12);
    for (const [x, z] of W) fender(x, z, (wd + 0.12) / 2 + 0.03, paint, 0.1, 0.12);
    for (const side of [-1, 1]) {
      // 투톤: 옆 크림색 띠 + 크롬 가는 줄
      deco(accent, 0.02, 0.1, 1.5, side * 0.895, y0 + 0.22, 0.08);
      deco(chrome, 0.022, 0.018, 1.5, side * 0.897, y0 + 0.28, 0.08);
      deco(accent, 0.02, 0.1, 0.9, side * 0.905, y0 + 0.4, -2.05);
      // 발판 (크롬) + 받침
      box(chrome, 0.2, 0.035, 1.3, side * 0.99, y0 - 0.02, 0.08);
      deco(dark, 0.14, 0.012, 1.2, side * 0.99, y0 + 0.002, 0.08);
      // 펜더 위 작은 깜빡이
      add(new THREE.SphereGeometry(0.04, 8, 6), lampYellow, side * wx, 2 * r + 0.19, 1.95).castShadow = false;
      // 보닛 옆 통풍 줄 3개
      for (let i = 0; i < 3; i++) deco(chrome, 0.012, 0.02, 0.34, side * 0.885, y0 + 0.4 + i * 0.05, 1.2);
    }
    // 보닛 가운데 크롬 줄 + 코 장식
    deco(chrome, 0.03, 0.02, 1.5, 0, y0 + 0.672, 1.6, 0.075);
    box(chrome, 0.05, 0.07, 0.16, 0, y0 + 0.6, 2.42, 0.2);
    // 앞유리 위 햇빛 가리개
    box(paint, 1.6, 0.03, 0.26, 0, y0 + 1.15, 0.54, -0.3);
    // 앞: 크롬 그릴(테 + 세로 살) + 둥근 헤드라이트(테) + 범퍼(세로 가드 2개) + 번호판
    box(chrome, 1.04, 0.32, 0.05, 0, y0 + 0.3, 2.615, 0, 0, 0, fWing);
    deco(dark, 0.94, 0.24, 0.03, 0, y0 + 0.3, 2.635, 0, 0, 0, fWing);
    for (let i = 0; i < 7; i++) deco(chrome, 0.03, 0.24, 0.03, -0.39 + i * 0.13, y0 + 0.3, 2.65, 0, 0, 0, fWing);
    box(chrome, 1.8, 0.13, 0.12, 0, y0 + 0.02, 2.68, 0, 0, 0, fWing);
    for (const x of [-0.4, 0.4]) box(chrome, 0.07, 0.24, 0.08, x, y0 + 0.05, 2.74, 0, 0, 0, fWing);
    deco(white, 0.36, 0.11, 0.02, 0, y0 + 0.02, 2.745, 0, 0, 0, fWing);
    box(chrome, 1.8, 0.13, 0.12, 0, y0 + 0.08, -2.64);
    for (const side of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 16).rotateX(Math.PI / 2), paint, side * 0.66, y0 + 0.32, 2.58);
      add(new THREE.CircleGeometry(0.092, 16), lamp, side * 0.66, y0 + 0.32, 2.636).castShadow = false;
      add(new THREE.TorusGeometry(0.1, 0.014, 6, 16), chrome, side * 0.66, y0 + 0.32, 2.632).castShadow = false;
      deco(lampYellow, 0.12, 0.04, 0.02, side * 0.66, y0 + 0.14, 2.63);
      // 둥근 후미등
      add(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14).rotateX(Math.PI / 2), chrome, side * 0.76, y0 + 0.46, -2.595);
      add(new THREE.CircleGeometry(0.058, 14).rotateY(Math.PI), tailMat, side * 0.76, y0 + 0.46, -2.613).castShadow = false;
    }
    // 짐칸: 나무 바닥 줄 + 나무 울타리(기둥 3개 + 가로 널 2줄) + 상자·건초·우유통
    for (let i = 0; i < 5; i++) deco(wood, 0.3, 0.012, 1.8, -0.66 + i * 0.33, y0 + 0.23, -1.62);
    for (const side of [-1, 1]) {
      for (const z of [-0.8, -1.6, -2.4]) box(woodDark, 0.05, 0.42, 0.07, side * 0.87, y0 + 0.86, z);
      for (const y of [0.82, 0.98]) box(wood, 0.03, 0.09, 1.86, side * 0.845, y0 + y, -1.6);
    }
    const crate = (w, h, d, x, y, z, ry = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = ry;
      body.add(g);
      add(new THREE.BoxGeometry(w, h, d), wood, 0, 0, 0, g);
      for (const sy of [-0.3, 0.3]) add(new THREE.BoxGeometry(w + 0.02, 0.035, d + 0.02), woodDark, 0, sy * h, 0, g).castShadow = false;
    };
    crate(0.6, 0.4, 0.55, -0.4, y0 + 0.43, -1.15);
    crate(0.5, 0.25, 0.45, -0.35, y0 + 0.76, -1.2, 0.3);
    crate(0.55, 0.3, 0.5, 0.38, y0 + 0.38, -2.15);
    box(hay, 0.62, 0.34, 0.8, 0.36, y0 + 0.4, -1.25);
    for (const z of [-1.05, -1.45]) deco(woodDark, 0.63, 0.35, 0.025, 0.36, y0 + 0.4, z);
    add(new THREE.CylinderGeometry(0.13, 0.15, 0.4, 12), chrome, -0.45, y0 + 0.43, -2.1);
    add(new THREE.CylinderGeometry(0.07, 0.11, 0.12, 12), chrome, -0.45, y0 + 0.69, -2.1);
    // 캐빈 뒤 롤바 (조명 2개)
    for (const side of [-1, 1]) T([side * 0.82, y0 + 0.62, -0.78], [side * 0.82, y0 + 1.26, -0.78], 0.04, chrome, spoiler);
    box(chrome, 1.68, 0.06, 0.08, 0, y0 + 1.26, -0.78, 0, 0, 0, spoiler);
    drs = box(paint, 1.2, 0.035, 0.14, 0, y0 + 1.3, -0.86, 0, 0, 0, spoiler);
    for (const x of [-0.4, 0.4]) {
      add(new THREE.CylinderGeometry(0.085, 0.07, 0.08, 12).rotateX(Math.PI / 2), chrome, x, y0 + 1.36, -0.76, spoiler);
      add(new THREE.CircleGeometry(0.07, 12), lamp, x, y0 + 1.36, -0.718, spoiler).castShadow = false;
    }
  }
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0.35, y0 + 0.9, -0.05);
  const top = y0 + 1.2;
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [wx - 0.1, r + 0.35], r: [wx - 0.1, r + 0.38] },
      helmet: [0.35, y0 + 0.9, -0.05],
      visor: [top + 0.06, -0.4],
      armor: { y: y0 + 0.62, x: 0.88 },
      ram: { y: y0 - 0.1, z: 1.95 },
      spines: [[0.1, top + 0.12], [-0.3, top + 0.12], [-1.2, y0 + 0.75], [-1.9, y0 + 0.75]],
      booster: { x: 0.55, y0: y0 + 0.35, y1: y0 + 0.8, z0: -0.9, dz: -1.25 },
      lift: { y: y0 + 0.62, z: -2.2, h: 0.3 },
      stab: [0.8, y0 + 1.12, -1.25],
      tailFin: [0, top + 0.05, -0.2],
      wing: [0.9, y0 + 0.38, 0.0],
      nitro: { x: 0.6, y: y0 + 0.06, z: -2.55, dz: -0.4 },
      vents: [[0.6, y0 + 0.6, 1.6], [0.6, y0 + 0.61, 1.35], [0.6, y0 + 0.62, 1.1]],
      glow: { y: y0 + 0.69, z: 1.6, len: 1.1, rot: 0.088, w: 0.06 },
      flames: [[-0.6, y0 + 0.06, 0.5, -2.7], [0.6, y0 + 0.06, 0.5, -2.7]],
      motor: [0.42, y0 + 0.1, -2.6],
      spark: [wx, 0.3, -2.0],
      seams: [0.86, y0 - 0.05, 0.0],
      lean: pickup ? 0.1 : 0.12,
      drsRest: 0.2,
    },
  };
}
