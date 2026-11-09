// 자동차 겉모습. 도형을 조합해 만들고, 나중에 glTF 모델로 바꿀 수 있습니다.
//
// 차 종류 (look.style, data/cars.json): f1(기본 F1) / gt(그랜드 투어러) / rally(랠리 해치백) / proto(르망 프로토타입)
//   / rocket(로켓 드래그스터) / buggy(모래 버기)
//   2026-11-10 추가: hatch(핫해치) / muscle(머슬카) / hyper(하이퍼카) / kart(카트) / roadster(옛날 로드스터)
//   / truck(트로피 트럭, look.variant 'pickup'이면 픽업) / ev(전기 콘셉트카)
//   차체 모양만 다르고, 아래의 변신 부품(부스터·가속·배·비행)은 모두 같이 씀
//   createCarModel('#e8463a')  ← 예전처럼 색만 주면 F1
//   createCarModel({ style: 'gt', body: '#1d3a8a', ... })  ← look 객체 (빠진 색은 LOOK_DEFAULTS에서)
//   돌려주는 것: { root, sync(car, dt, time), dispose(), look, debugPose(p) }
//   sync 전에는 차·코스 없이도 그냥 서 있는 모습 (홈 화면 미리보기용)
//
// (아래는 F1 기준 설명. 다른 차는 같은 부품이 차체에 맞는 자리에 붙음)
// 차체 좌표: +z 앞, +y 위. 길이 약 5.2m, 폭 약 2m (바퀴 포함)
//   노즈 → 모노코크(조종석, 헤일로) → 사이드포드 → 엔진 커버(에어박스, 샤크핀) → 뒷날개
//   바닥판(플로어), 디퓨저, 앞날개, 바퀴 4개가 차체 밖으로 드러난 오픈휠
//
// E 부스터 (car.form === 'spike', 3초. 스파이크 장갑 크롤러 디자인): 부품이 차례로 움직이며 재조립됨
//   (바퀴는 그대로) 드라이버가 몸을 낮추고 장갑 캐노피가 덮임 → 옆 장갑판 전개
//   → 사이드포드에서 엔진 부스터 2개가 솟아오르고 뒷날개가 올라가 자리를 비켜 줌 → 노즐이 뒤로 늘어나며 점화
//   → 앞 충각이 노즈를 덮음 → 등 가시 솟음
//   0.45초 만에 펼쳐지고 0.35초 만에 접힘. 부스터 중 E를 다시 눌러도(시간만 늘어남) 애니메이션은 다시 시작하지 않음
//
// 주행 모드 (car.mode, 1 일반 / 2 가속 / 3 배 / 4 비행. 부스터와 겹쳐 쓸 수 있음)
//   일반(normal): 기본 모습
//   가속(accel): 차체가 낮게 깔림 → 사이드포드 위 통풍구(주황 빛) 열림 → 뒤에서 니트로 배기관 2개가 미끄러져 나옴
//     → 노즈 위 빛나는 줄 + 뒷날개 DRS 열림 → 바닥 주황 언더글로우, 배기관에서 니트로 불꽃(안쪽 청백, 바깥 주황)
//     불꽃 길이는 가속 페달(car.thr)과 속도에 비례
//   배(boat): 바퀴가 옆으로 눕혀지며(수평) 차체 쪽으로 접혀 올라감 → 아래에서 보트 선체(흰/빨강, 뾰족한 뱃머리)가 솟음
//     → 뒤에 선외기 2개가 나타나 물속으로 내려감 (프로펠러는 car.thr로 회전, 땅 위에선 선외기를 들어 올림)
//     물 위에서는 출렁임(상하·앞뒤·좌우) + 속도가 붙으면 뱃머리가 들림(플레이닝), 뱃머리 물보라와 항적
//   비행(fly): 사이드포드에서 제트기 날개가 펼쳐짐(땅에선 살짝 들림) → 뒷날개 양옆 수평 꼬리날개 + 끝 수직판
//     → 샤크핀 위로 수직 꼬리날개 솟음 → 날개 아래 제트 엔진 2개 (팬 회전, 파란 불꽃은 car.thr에 비례)
//     날개 끝 항법등(왼쪽 빨강, 오른쪽 초록) 깜빡임 + 꼬리 흰 섬광등
//     바퀴는 착륙 장치: 날아오르면(car.flying) 배 모드처럼 접혀 올라가고, 내려앉으면 다시 펴짐
//     빠르게 날면(16~60m/s) 날개 끝에서 비행운이 길게 뻗음. 기울기와 기수 각도는 물리가 정한 방향(car.up/fwd)을 그대로 따름
//   배 모드가 아닌데 물에 빠지면(car.sink 0~1) 차가 기수를 숙이며 물속으로 가라앉음
import * as THREE from 'three';

const DRIFT_COLORS = [0xffffff, 0x4fc3ff, 0xff9a2e];
const FORM_COLORS = { spike: new THREE.Color('#7dff6a') };
const MODE_COLORS = {
  normal: new THREE.Color('#e8ecf2'),
  accel: new THREE.Color('#ff7a2e'),
  boat: new THREE.Color('#3fb8ff'),
  fly: new THREE.Color('#9ad8ff'),
};
const BOOST_FLAME = new THREE.Color('#ffb347');
const SPIKE_FLAME = new THREE.Color('#6dff5a');

// --- 애니메이션 도우미 ---
const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** 전체 진행도 p 중 [a, b] 구간을 0~1로 */
const stage = (p, a, b) => clamp01((p - a) / (b - a));
const easeOutBack = (x) => {
  const c1 = 1.9, c3 = c1 + 1;
  return x <= 0 ? 0 : x >= 1 ? 1 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const easeInOut = (x) => x * x * (3 - 2 * x);

/**
 * 단면을 이어 붙인 매끈한 몸통 (노즈, 사이드포드, 엔진 커버).
 * sections: 앞에서 뒤 순서로 [{ z, w: 반폭, h: 반높이, y: 중심 높이, n: 각진 정도(2=타원, 클수록 네모) }]
 */
function loft(sections, M = 20) {
  const pos = [];
  const idx = [];
  const ring = (s) => {
    const n = s.n || 3;
    for (let j = 0; j < M; j++) {
      const a = (j / M) * Math.PI * 2;
      const c = Math.cos(a), si = Math.sin(a);
      pos.push(
        (s.x || 0) + s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n),
        s.y + s.h * Math.sign(si) * Math.pow(Math.abs(si), 2 / n),
        s.z,
      );
    }
  };
  sections.forEach(ring);
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M), c = a + M, d = b + M;
      idx.push(a, c, b, b, c, d);
    }
  // 앞뒤 마개 (꼭짓점을 따로 두어 모서리가 뭉개지지 않게)
  for (const [si, front] of [[0, true], [sections.length - 1, false]]) {
    const s = sections[si];
    const base = pos.length / 3;
    pos.push(s.x || 0, s.y, s.z);
    ring(s);
    for (let j = 0; j < M; j++) {
      const a = base + 1 + j, b = base + 1 + ((j + 1) % M);
      if (front) idx.push(base, a, b);
      else idx.push(base, b, a);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 두 점을 잇는 막대 (서스펜션 암 등) */
function rodGeometry(a, b, t = 0.035) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const geo = new THREE.CylinderGeometry(t, t, dir.length(), 5);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}

function numberTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = fg;
  g.font = 'italic 900 96px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 가운데가 밝고 가장자리로 갈수록 투명해지는 둥근 빛 (언더글로우, 항적용) */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// =====================================================================================================
// 차 종류 (look.style): 차체(껍데기)만 다르고, 모드 변신 부품(가속·배·비행·부스터)은 모두 같은 것을 씀.
//   각 차체 함수는 차체를 만들고, 변신 부품이 붙을 자리(A = anchors)를 알려 줌
//   (예: 비행 날개 뿌리, 부스터가 솟는 높이, 니트로 배기관 위치, 바퀴 위치·크기)
// =====================================================================================================

/** 차 종류별 기본 색 (cars.json의 look에 적힌 값이 있으면 그것이 우선) */
export const LOOK_DEFAULTS = {
  f1: { style: 'f1', body: '#e8463a', accent: '#f3f4f6', trim: '#16181d', rim: '#2a2d33', wall: '#ffd23a', helmet: '#ffd23a', number: '7', numberBg: '#f3f4f6', numberFg: '#14161b' },
  gt: { style: 'gt', body: '#1d3a8a', accent: '#f4f5f7', trim: '#c9a227', rim: '#c9a227', wall: null, helmet: '#f4f5f7', number: '23', numberBg: '#f4f5f7', numberFg: '#1d3a8a' },
  rally: { style: 'rally', body: '#f5c518', accent: '#18191c', trim: '#1fb85a', rim: '#f1f1f1', wall: null, helmet: '#1fb85a', number: '5', numberBg: '#ffffff', numberFg: '#18191c' },
  proto: { style: 'proto', body: '#0f6fd1', accent: '#eef4ff', trim: '#ffd400', rim: '#1d2026', wall: '#ffd400', helmet: '#eef4ff', number: '8', numberBg: '#ffd400', numberFg: '#0b1f3a' },
  rocket: { style: 'rocket', body: '#ff6a13', accent: '#fafafa', trim: '#7b2cff', rim: '#d9dde3', wall: '#fafafa', helmet: '#7b2cff', number: '1', numberBg: '#fafafa', numberFg: '#7b2cff' },
  buggy: { style: 'buggy', body: '#2fb35c', accent: '#f4f4f4', trim: '#1b1c1f', rim: '#e9e9e9', wall: null, helmet: '#ff7a1a', number: '4', numberBg: '#1b1c1f', numberFg: '#ffd23a', tire: 'knobby' },
  // 2026-11-10 새 차체
  hatch: { style: 'hatch', body: '#e83b6f', accent: '#ffffff', trim: '#1c1d22', rim: '#ffffff', wall: null, helmet: '#ffffff', number: '22', numberBg: '#ffffff', numberFg: '#e83b6f' },
  muscle: { style: 'muscle', body: '#16171b', accent: '#e8b931', trim: '#e8b931', rim: '#b9bec7', wall: null, helmet: '#e8b931', number: '69', numberBg: '#e8b931', numberFg: '#16171b' },
  hyper: { style: 'hyper', body: '#d9dde4', accent: '#101318', trim: '#00c2ff', rim: '#1a1d22', wall: null, helmet: '#101318', number: '16', numberBg: '#101318', numberFg: '#00c2ff' },
  kart: { style: 'kart', body: '#ffd21f', accent: '#1b6dff', trim: '#16181d', rim: '#f2f2f2', wall: null, helmet: '#1b6dff', number: '11', numberBg: '#ffffff', numberFg: '#1b6dff' },
  roadster: { style: 'roadster', body: '#1f6f5c', accent: '#f3ecd8', trim: '#d7d9dc', rim: '#d7d9dc', wall: '#f3ecd8', helmet: '#f3ecd8', number: '62', numberBg: '#f3ecd8', numberFg: '#1f6f5c' },
  truck: { style: 'truck', body: '#ff7a1a', accent: '#1b1d22', trim: '#f2f2f2', rim: '#1b1d22', wall: null, helmet: '#f2f2f2', number: '7', numberBg: '#1b1d22', numberFg: '#ff7a1a', tire: 'knobby', variant: 'trophy' },
  ev: { style: 'ev', body: '#f2f5f8', accent: '#18e0c8', trim: '#18e0c8', rim: '#20242b', wall: null, helmet: '#18e0c8', number: 'E', numberBg: '#18e0c8', numberFg: '#0d1117' },
};
export const CAR_STYLES = Object.keys(LOOK_DEFAULTS);

/** createCarModel 인자: 예전처럼 색 문자열('#e8463a') 또는 look 객체({ style, body, ... }) */
export function normalizeLook(x) {
  if (x == null || typeof x === 'string') return { ...LOOK_DEFAULTS.f1, body: x || LOOK_DEFAULTS.f1.body };
  const style = LOOK_DEFAULTS[x.style] ? x.style : 'f1';
  const out = { ...LOOK_DEFAULTS[style] };
  for (const [k, v] of Object.entries(x)) if (v !== undefined) out[k] = v;
  out.style = style;
  return out;
}

/** 단면 하나 (z 위치, 반폭 w, 아래 높이 yb, 위 높이 yt, 각진 정도 n, 가운데 x) */
const R = (z, w, yb, yt, n = 5, x = 0) => ({ z, w, h: (yt - yb) / 2, y: (yb + yt) / 2, n, x });

/** 바퀴를 덮는 휠 아치 (반원 고리를 옆으로 늘린 것). 차 x 방향 폭 width, 바퀴 중심이 원점 */
function archGeo(rIn, rOut, width, a0 = -0.1) {
  const s = new THREE.Shape();
  const a1 = Math.PI - a0;
  s.absarc(0, 0, rOut, a0, a1, false);
  s.absarc(0, 0, rIn, a1, a0, true);
  return new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 22 })
    .rotateY(Math.PI / 2)
    .translate(-width / 2, 0, 0);
}

/** 기본(F1) 변신 부품 자리. 다른 차는 여기서 바뀐 것만 덮어씀 */
const BASE_ANCHORS = {
  // [x, z, 앞바퀴?, 반지름, 타이어 폭, 서스펜션 안쪽 x]
  wheels: [
    [-0.86, 1.62, true, 0.36, 0.34, 0.2],
    [0.86, 1.62, true, 0.36, 0.34, 0.2],
    [-0.86, -1.45, false, 0.42, 0.44, 0.32],
    [0.86, -1.45, false, 0.42, 0.44, 0.32],
  ],
  tuck: { f: [0.78, 0.5], r: [0.9, 0.62] }, // 접힌 바퀴 [x, y]
  helmet: [0, 0.93, -0.3],
  visor: [0.95, -0.75], // 장갑 캐노피 시작 [y, z] → +0.22, +0.62 만큼 움직임
  armor: { y: 0.72, x: 0.72 }, // 옆 장갑판 경첩
  ram: { y: 0.1, z: 1.55 }, // 앞 충각
  spines: [[-0.32, 1.1], [-0.8, 1.04], [-1.25, 0.88], [-1.65, 0.74]], // 등 가시 [z, y]
  booster: { x: 0.3, y0: 0.4, y1: 0.7, z0: -0.6, dz: -1.25 }, // 엔진 부스터
  lift: { y: 0.56, z: -2.08, h: 0.36 }, // 뒷날개 들어 올리는 기둥
  stab: [0.66, 0.97, -2.2], // 수평 꼬리날개 (뒷날개에 붙음)
  tailFin: [0, 1.06, -0.95], // 수직 꼬리날개
  wing: [0.8, 0.7, 0.0], // 비행 날개 뿌리
  nitro: { x: 0.3, y: 0.44, z: -1.8, dz: -0.5 }, // 가속 모드 배기관
  vents: [[0.5, 0.69, -0.2], [0.5, 0.68, -0.48], [0.5, 0.65, -0.76]], // 가속 모드 통풍구 (오른쪽 것은 자동으로 대칭)
  glow: { y: 0.652, z: 1.45, len: 1.5, rot: 0.21, w: 0.06 }, // 노즈 위 빛나는 줄
  flames: [[0, 0.5, 1, -2.1], [-0.16, 0.56, 0.6, -2.1], [0.16, 0.56, 0.6, -2.1]], // 부스트 불꽃 [x, y, 크기, z]
  motor: [0.38, 0.3, -2.5], // 선외기 경첩
  spark: [0.86, 0.25, -1.95], // 드리프트 불꽃
  seams: [0.88, 0.17, -0.1], // 바닥 빛나는 이음선
  lean: 0.045, // 코너에서 기우는 정도
  drsRest: 0.45, // 뒷날개 윗판 기본 각도
};

// ------------------------------------------------------------------ F1 (기본 차: 예전 모습 그대로)
function buildF1({ add, body, M }) {
  const { paint, accent, carbon, dark, helmetMat, numMat, tailMat, metal } = M;
  // 노즈 + 모노코크
  add(loft([
    { z: 2.78, w: 0.09, h: 0.06, y: 0.27 },
    { z: 2.45, w: 0.15, h: 0.1, y: 0.31 },
    { z: 1.9, w: 0.22, h: 0.15, y: 0.38 },
    { z: 1.25, w: 0.3, h: 0.21, y: 0.47 },
    { z: 0.6, w: 0.37, h: 0.26, y: 0.53 },
    { z: 0.0, w: 0.41, h: 0.29, y: 0.55 },
    { z: -0.55, w: 0.41, h: 0.3, y: 0.55 },
  ]), paint, 0, 0, 0);
  // 노즈 끝 흰색 + 노즈 위 줄무늬
  add(loft([
    { z: 2.8, w: 0.08, h: 0.055, y: 0.27 },
    { z: 2.55, w: 0.135, h: 0.09, y: 0.3 },
    { z: 2.4, w: 0.155, h: 0.102, y: 0.315 },
  ]), accent, 0, 0, 0);
  const noseStripe = add(new THREE.BoxGeometry(0.1, 0.02, 1.5), accent, 0, 0.645, 1.45);
  noseStripe.rotation.x = 0.21;

  // 사이드포드 (콜라병처럼 뒤로 갈수록 잘록)
  add(loft([
    { z: 0.55, w: 0.84, h: 0.2, y: 0.42, n: 4 },
    { z: 0.25, w: 0.9, h: 0.25, y: 0.45, n: 4 },
    { z: -0.4, w: 0.83, h: 0.26, y: 0.46, n: 4 },
    { z: -1.0, w: 0.6, h: 0.22, y: 0.44, n: 4 },
    { z: -1.6, w: 0.36, h: 0.17, y: 0.42, n: 4 },
    { z: -1.98, w: 0.2, h: 0.12, y: 0.42, n: 4 },
  ]), paint, 0, 0, 0);
  // 사이드포드 공기 흡입구 (검은 입)
  for (const side of [-1, 1]) {
    const inlet = add(new THREE.BoxGeometry(0.36, 0.3, 0.06), dark, side * 0.63, 0.45, 0.56);
    inlet.rotation.y = side * 0.12;
    // 옆면 흰 줄
    const stripe = add(new THREE.BoxGeometry(0.02, 0.06, 1.3), accent, side * 0.86, 0.48, -0.15);
    stripe.rotation.y = side * -0.08;
  }

  // 엔진 커버 + 에어박스(드라이버 머리 위 흡입구)
  add(loft([
    { z: -0.18, w: 0.2, h: 0.3, y: 0.8, n: 2.6 },
    { z: -0.6, w: 0.3, h: 0.3, y: 0.77, n: 2.6 },
    { z: -1.2, w: 0.24, h: 0.22, y: 0.66, n: 2.6 },
    { z: -1.95, w: 0.1, h: 0.1, y: 0.55, n: 2.6 },
  ]), paint, 0, 0, 0);
  add(loft([
    { z: -0.12, w: 0.13, h: 0.11, y: 1.0, n: 2.4 },
    { z: -0.45, w: 0.15, h: 0.12, y: 1.0, n: 2.4 },
    { z: -0.7, w: 0.08, h: 0.06, y: 0.98, n: 2.4 },
  ]), paint, 0, 0, 0);
  add(new THREE.CircleGeometry(0.1, 14), dark, 0, 1.0, -0.115); // 흡입구 구멍
  add(new THREE.BoxGeometry(0.16, 0.05, 0.08), carbon, 0, 1.13, -0.25); // 온보드 카메라

  // 샤크핀 (번호판)
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.5, 1.06);
  finShape.lineTo(-2.08, 1.12);
  finShape.lineTo(-2.08, 0.98);
  finShape.lineTo(-1.95, 0.58);
  finShape.lineTo(-1.1, 0.8);
  finShape.lineTo(-0.6, 0.98);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.03, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.015, 0, 0);
  add(finGeo, paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    const plate = add(new THREE.PlaneGeometry(0.32, 0.32), numMat, side * 0.02, 0.92, -1.45);
    plate.rotation.y = side * Math.PI / 2;
    plate.castShadow = false;
  }

  // 조종석: 검은 구멍 + 드라이버 헬멧
  add(new THREE.BoxGeometry(0.5, 0.06, 0.8), dark, 0, 0.82, -0.12);
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 0.93, -0.3);

  // 헤일로 (조종석 보호대)
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.33, 0.82, -0.5),
    new THREE.Vector3(-0.3, 1.04, -0.28),
    new THREE.Vector3(-0.18, 1.12, 0.05),
    new THREE.Vector3(0, 1.13, 0.2),
    new THREE.Vector3(0.18, 1.12, 0.05),
    new THREE.Vector3(0.3, 1.04, -0.28),
    new THREE.Vector3(0.33, 0.82, -0.5),
  ]);
  add(new THREE.TubeGeometry(haloCurve, 30, 0.035, 6, false), carbon, 0, 0, 0);
  add(rodGeometry(new THREE.Vector3(0, 1.13, 0.2), new THREE.Vector3(0, 0.8, 0.42), 0.035), carbon, 0, 0, 0);

  // 백미러
  for (const side of [-1, 1]) {
    add(rodGeometry(new THREE.Vector3(side * 0.38, 0.72, 0.32), new THREE.Vector3(side * 0.5, 0.86, 0.32), 0.015), carbon, 0, 0, 0);
    add(new THREE.BoxGeometry(0.16, 0.07, 0.05), paint, side * 0.52, 0.88, 0.32);
  }

  // 바닥판 (위에서 보면 앞이 좁고 가운데가 넓음, 뒷바퀴 앞에서 다시 좁아짐)
  const floorShape = new THREE.Shape();
  const fpts = [[0.32, 1.25], [0.86, 0.72], [0.88, -0.92], [0.55, -1.05], [0.55, -1.98]];
  floorShape.moveTo(-fpts[0][0], fpts[0][1]);
  for (const [x, z] of fpts) floorShape.lineTo(x, z);
  for (const [x, z] of [...fpts].reverse()) floorShape.lineTo(-x, z);
  const floorGeo = new THREE.ExtrudeGeometry(floorShape, { depth: 0.04, bevelEnabled: false }).rotateX(Math.PI / 2);
  add(floorGeo, carbon, 0, 0.18, 0);
  // 디퓨저: 뒤쪽이 위로 들린 판 + 세로 핀
  const diff = add(new THREE.BoxGeometry(1.05, 0.03, 0.55), carbon, 0, 0.26, -2.18);
  diff.rotation.x = 0.42;
  for (const x of [-0.45, -0.15, 0.15, 0.45]) add(new THREE.BoxGeometry(0.02, 0.22, 0.5), carbon, x, 0.27, -2.16);

  // 앞날개 (3단 + 양끝 판)
  const fWing = new THREE.Group();
  body.add(fWing);
  add(new THREE.BoxGeometry(1.95, 0.035, 0.45), carbon, 0, 0.13, 2.62, fWing);
  const flap1 = add(new THREE.BoxGeometry(1.75, 0.03, 0.24), paint, 0, 0.2, 2.5, fWing);
  flap1.rotation.x = -0.35;
  const flap2 = add(new THREE.BoxGeometry(1.55, 0.03, 0.18), accent, 0, 0.27, 2.43, fWing);
  flap2.rotation.x = -0.6;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.03, 0.26, 0.6), paint, side * 0.985, 0.22, 2.6, fWing);
    add(new THREE.BoxGeometry(0.03, 0.18, 0.12), carbon, side * 0.2, 0.2, 2.62, fWing); // 노즈 지지대
  }

  // 뒷날개 (변신할 때 통째로 움직임)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.24, 0.05, 0.34), carbon, 0, 1.02, -2.17, spoiler);
  const drs = add(new THREE.BoxGeometry(1.24, 0.04, 0.22), paint, 0, 1.17, -2.3, spoiler);
  drs.rotation.x = 0.45;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.035, 0.62, 0.66), paint, side * 0.64, 0.95, -2.2, spoiler);
    add(new THREE.BoxGeometry(0.04, 0.1, 0.66), accent, side * 0.64, 1.22, -2.2, spoiler);
  }
  add(new THREE.BoxGeometry(0.05, 0.48, 0.14), carbon, 0, 0.8, -2.05, spoiler); // 가운데 지지대
  add(new THREE.BoxGeometry(1.1, 0.04, 0.2), carbon, 0, 0.56, -2.15, spoiler); // 아래 빔 날개
  // 후미등 (가운데 비상등)
  add(new THREE.BoxGeometry(0.16, 0.08, 0.04), tailMat, 0, 0.4, -2.12);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.24, 0.04), tailMat, side * 0.665, 0.95, -2.5, spoiler);
  // 가운데 배기구 (부스트 불꽃이 나오는 곳)
  add(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 10).rotateX(Math.PI / 2), metal, 0, 0.5, -2.02);

  return { helmet, fWing, spoiler, drs, A: {} };
}

/** 드라이버 헬멧 (모든 차 같음, 색만 다름) */
function makeHelmet(add, body, M) {
  const helmet = new THREE.Group();
  body.add(helmet);
  add(new THREE.SphereGeometry(0.17, 16, 12), M.helmetMat, 0, 0, 0, helmet);
  const visorBand = add(new THREE.SphereGeometry(0.172, 16, 6, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.38, Math.PI * 0.16), M.dark, 0, 0, 0, helmet);
  visorBand.castShadow = false;
  add(new THREE.BoxGeometry(0.02, 0.02, 0.3), M.accent, 0, 0.165, -0.02, helmet);
  return helmet;
}

/** 지붕 있는 차의 공통 부품: 휠 아치, 백미러, 문 번호판 */
function arches(add, M, wheels, inMargin, outMargin, extraW = 0.12, mat = M.paint) {
  for (const [x, z, , r, wd] of wheels) {
    const a = add(archGeo(r + inMargin, r + outMargin, wd + extraW), mat, x, r, z);
    a.castShadow = true;
  }
}
function doorNumber(add, M, x, y, z, size = 0.46) {
  for (const side of [-1, 1]) {
    const p = add(new THREE.PlaneGeometry(size, size), M.numMat, side * x, y, z);
    p.rotation.y = side * Math.PI / 2;
    p.castShadow = false;
  }
}

// ------------------------------------------------------------------ GT (그랜드 투어러 / 머슬): 긴 보닛, 패스트백 지붕, 쌍줄 스트라이프, 덕테일 날개, 배기구 4개
function buildGT({ add, body, M }) {
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
  // 쌍줄 스트라이프 (보닛 → 지붕 → 트렁크)
  for (const sx of [-0.14, 0.14]) {
    const h = add(new THREE.BoxGeometry(0.13, 0.014, 1.62), accent, sx, 0.752, 1.76);
    h.rotation.x = 0.106;
    h.castShadow = false;
    add(new THREE.BoxGeometry(0.13, 0.012, 1.1), accent, sx, 1.303, -0.38).castShadow = false;
    const d = add(new THREE.BoxGeometry(0.13, 0.012, 0.5), accent, sx, 0.928, -2.22);
    d.castShadow = false;
  }
  // 보닛 뒤쪽 공기 배출구 (검은 틈 2개, 스트라이프 바깥)
  for (const side of [-1, 1]) {
    const v = add(new THREE.BoxGeometry(0.22, 0.012, 0.32), dark, side * 0.62, 0.77, 1.35);
    v.rotation.x = 0.106;
    v.castShadow = false;
  }
  // 그릴 + 헤드라이트 + 앞 립
  add(new THREE.BoxGeometry(0.9, 0.14, 0.04), dark, 0, 0.38, 2.9);
  for (const side of [-1, 1]) {
    const hl = add(new THREE.BoxGeometry(0.36, 0.05, 0.05), lamp, side * 0.6, 0.555, 2.8);
    hl.rotation.set(-0.35, side * 0.4, 0);
    hl.castShadow = false;
    // 옆 공기구멍 (앞바퀴 뒤)
    add(new THREE.BoxGeometry(0.02, 0.1, 0.3), dark, side * 0.995, 0.6, 0.98);
    // 문 아래 사이드 스커트 (금색 줄)
    add(new THREE.BoxGeometry(0.03, 0.07, 2.3), carbon, side * 1.0, 0.27, 0.05);
    add(new THREE.BoxGeometry(0.02, 0.02, 2.3), trim, side * 1.012, 0.31, 0.05).castShadow = false;
    // 백미러
    add(new THREE.BoxGeometry(0.16, 0.08, 0.12), paint, side * 0.79, 0.97, 0.72);
  }
  doorNumber(add, M, 1.005, 0.56, 0.05, 0.42);
  // 뒤: 후미등 띠 + 디퓨저 + 배기구 4개
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.5, 0.07, 0.04), tailMat, side * 0.5, 0.74, -2.585);
  add(new THREE.BoxGeometry(0.4, 0.04, 0.04), tailMat, 0, 0.78, -2.585);
  const diff = add(new THREE.BoxGeometry(1.3, 0.04, 0.42), carbon, 0, 0.25, -2.45);
  diff.rotation.x = 0.32;
  for (const x of [-0.45, -0.3, 0.3, 0.45]) add(new THREE.CylinderGeometry(0.055, 0.06, 0.22, 12).rotateX(Math.PI / 2), metal, x, 0.31, -2.6);

  // 앞 립 스포일러 (부스터 충각이 덮을 때 살짝 좁아짐)
  const fWing = new THREE.Group();
  body.add(fWing);
  add(new THREE.BoxGeometry(1.8, 0.035, 0.3), carbon, 0, 0.19, 2.8, fWing);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.25, 0.02, 0.14), carbon, side * 0.82, 0.38, 2.7, fWing).rotation.z = side * 0.25;

  // 뒷날개 (짧은 기둥 위 넓은 날개)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.76, 0.05, 0.34), carbon, 0, 1.13, -2.3, spoiler);
  const drs = add(new THREE.BoxGeometry(1.76, 0.04, 0.2), paint, 0, 1.22, -2.43, spoiler);
  drs.rotation.x = 0.45;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.035, 0.3, 0.5), paint, side * 0.88, 1.12, -2.34, spoiler);
    add(new THREE.BoxGeometry(0.05, 0.22, 0.12), carbon, side * 0.45, 1.0, -2.22, spoiler);
  }
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
      vents: [[0.44, 0.79, 1.55], [0.44, 0.81, 1.32], [0.44, 0.83, 1.09]],
      glow: { y: 0.755, z: 1.78, len: 1.5, rot: 0.106, w: 0.05 },
      flames: [[-0.3, 0.31, 0.45, -2.68], [0.3, 0.31, 0.45, -2.68], [-0.45, 0.31, 0.45, -2.68], [0.45, 0.31, 0.45, -2.68]],
      motor: [0.42, 0.38, -2.68],
      spark: [0.9, 0.25, -2.0],
      seams: [1.0, 0.22, 0.05],
      lean: 0.06,
    },
  };
}

// ------------------------------------------------------------------ 랠리 (해치백): 짧고 높은 차체, 넓은 휠 아치, 지붕 공기구멍, 앞 보조등 4개, 머드플랩
function buildRally({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat } = M;
  const W = [
    [-0.85, 1.45, true, 0.37, 0.32, 0.4],
    [0.85, 1.45, true, 0.37, 0.32, 0.4],
    [-0.85, -1.38, false, 0.37, 0.32, 0.4],
    [0.85, -1.38, false, 0.37, 0.32, 0.4],
  ];
  add(loft([R(2.4, 0.5, 0.36, 0.6), R(2.18, 0.66, 0.3, 0.72), R(0.9, 0.68, 0.3, 0.86), R(-1.9, 0.68, 0.3, 0.92), R(-2.18, 0.6, 0.36, 0.9)], 24), paint, 0, 0, 0);
  add(loft([R(2.44, 0.66, 0.33, 0.58, 4), R(2.3, 0.9, 0.28, 0.68), R(1.88, 0.94, 0.28, 0.78)], 24), paint, 0, 0, 0);
  add(loft([R(1.02, 0.94, 0.3, 0.84), R(0.0, 0.96, 0.3, 0.87), R(-0.97, 0.95, 0.3, 0.9)], 24), paint, 0, 0, 0);
  add(loft([R(-1.82, 0.95, 0.3, 0.92), R(-2.12, 0.93, 0.32, 0.92), R(-2.21, 0.84, 0.36, 0.88)], 24), paint, 0, 0, 0);
  // 넓게 부푼 휠 아치 (검은 오버펜더)
  arches(add, M, W, 0.03, 0.15, 0.16);
  for (const [x, z, , r, wd] of W) add(archGeo(r + 0.15, r + 0.2, wd + 0.18), carbon, x + Math.sign(x) * 0.02, r, z);
  // 해치백 유리 캐빈 + 지붕
  add(loft([R(0.98, 0.66, 0.82, 0.87, 4), R(0.4, 0.68, 0.84, 1.3, 4), R(-0.4, 0.69, 0.86, 1.4, 4), R(-1.72, 0.67, 0.88, 1.4, 4), R(-2.1, 0.64, 0.88, 1.35, 4)], 24), glass, 0, 0, 0);
  add(loft([R(0.32, 0.6, 1.31, 1.36, 3), R(-0.3, 0.665, 1.39, 1.44, 3), R(-1.72, 0.665, 1.395, 1.445, 3), R(-2.04, 0.63, 1.35, 1.4, 3)], 24), paint, 0, 0, 0);
  // 지붕 공기구멍 + 안테나
  add(loft([R(0.25, 0.12, 1.4, 1.42, 3), R(0.05, 0.17, 1.4, 1.53, 3), R(-0.35, 0.17, 1.42, 1.53, 3), R(-0.45, 0.14, 1.42, 1.48, 3)]), paint, 0, 0, 0);
  add(new THREE.BoxGeometry(0.26, 0.09, 0.02), dark, 0, 1.48, 0.06);
  add(rodGeometry(new THREE.Vector3(0.4, 1.44, -1.5), new THREE.Vector3(0.44, 1.95, -1.68), 0.008), carbon, 0, 0, 0);
  for (const side of [-1, 1]) {
    const bp = add(new THREE.BoxGeometry(0.05, 0.48, 0.12), dark, side * 0.68, 1.1, -0.6);
    bp.rotation.z = side * -0.05;
    // 옆 리버리: 검은 띠 + 초록 띠 (문 아래)
    add(new THREE.BoxGeometry(0.02, 0.12, 1.95), accent, side * 0.965, 0.42, 0.02).castShadow = false;
    add(new THREE.BoxGeometry(0.02, 0.04, 1.95), trim, side * 0.968, 0.5, 0.02).castShadow = false;
    add(new THREE.BoxGeometry(0.16, 0.1, 0.12), paint, side * 0.78, 0.98, 0.72); // 백미러
    // 머드플랩 (바퀴 뒤)
    for (const z of [1.45 - 0.5, -1.38 - 0.5]) add(new THREE.BoxGeometry(0.34, 0.3, 0.025), trim, side * 0.84, 0.2, z);
  }
  doorNumber(add, M, 0.97, 0.66, 0.0, 0.42);
  // 보닛: 검은 판 + 핀
  const hood = add(new THREE.BoxGeometry(0.9, 0.012, 0.55), accent, 0, 0.75, 1.65);
  hood.rotation.x = 0.11;
  hood.castShadow = false;
  // 앞: 그릴, 헤드라이트, 보조등 4개(막대에 달림), 견인고리
  add(new THREE.BoxGeometry(0.8, 0.13, 0.04), dark, 0, 0.47, 2.44);
  for (const side of [-1, 1]) {
    const hl = add(new THREE.BoxGeometry(0.3, 0.1, 0.05), lamp, side * 0.6, 0.57, 2.38);
    hl.rotation.y = side * 0.3;
    hl.castShadow = false;
  }
  add(new THREE.BoxGeometry(1.4, 0.05, 0.05), carbon, 0, 0.66, 2.5);
  for (const x of [-0.56, -0.19, 0.19, 0.56]) {
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.09, 18).rotateX(Math.PI / 2), carbon, x, 0.66, 2.56);
    add(new THREE.CircleGeometry(0.09, 18), lamp, x, 0.66, 2.61).castShadow = false;
  }
  add(new THREE.BoxGeometry(0.05, 0.05, 0.12), trim, 0.3, 0.36, 2.45);
  // 뒤: 후미등, 굵은 배기구 하나
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.26, 0.2, 0.04), tailMat, side * 0.66, 0.8, -2.2);
  add(new THREE.CylinderGeometry(0.08, 0.09, 0.25, 14).rotateX(Math.PI / 2), metal, -0.45, 0.32, -2.22);
  const diff = add(new THREE.BoxGeometry(1.2, 0.04, 0.3), carbon, 0, 0.3, -2.15);
  diff.rotation.x = 0.3;

  const fWing = new THREE.Group();
  body.add(fWing);
  add(new THREE.BoxGeometry(1.75, 0.035, 0.24), carbon, 0, 0.3, 2.4, fWing);

  // 지붕 끝 뒷날개 (랠리카 루프 스포일러)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.36, 0.05, 0.36), paint, 0, 1.44, -2.16, spoiler).rotation.x = 0.08;
  const drs = add(new THREE.BoxGeometry(1.36, 0.04, 0.16), accent, 0, 1.5, -2.33, spoiler);
  drs.rotation.x = 0.3;
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.035, 0.18, 0.42), accent, side * 0.68, 1.45, -2.2, spoiler);
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
      stab: [0.68, 1.44, -2.2],
      tailFin: [0, 1.44, -0.62],
      wing: [0.9, 0.62, 0.0],
      nitro: { x: 0.22, y: 0.36, z: -2.0, dz: -0.42 },
      vents: [[0.36, 0.83, 1.25], [0.36, 0.81, 1.5], [0.36, 0.79, 1.75]],
      glow: { y: 0.775, z: 1.62, len: 1.1, rot: 0.11, w: 0.05 },
      flames: [[-0.45, 0.32, 0.6, -2.35]],
      motor: [0.38, 0.4, -2.3],
      spark: [0.85, 0.25, -1.85],
      seams: [0.96, 0.28, 0.0],
      lean: 0.075,
      drsRest: 0.3,
    },
  };
}

// ------------------------------------------------------------------ 프로토 (르망 프로토타입): 아주 낮은 차체, 둥근 캐노피, 바퀴를 덮는 펜더, 샤크핀, 백조목 뒷날개
function buildProto({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, glass, tailMat } = M;
  const W = [
    [-0.86, 1.75, true, 0.36, 0.32, 0.35],
    [0.86, 1.75, true, 0.36, 0.32, 0.35],
    [-0.88, -1.55, false, 0.38, 0.4, 0.38],
    [0.88, -1.55, false, 0.38, 0.4, 0.38],
  ];
  // 가운데 낮은 몸통 (노즈는 아래로 내려감)
  add(loft([R(3.0, 0.3, 0.16, 0.26, 4), R(2.6, 0.5, 0.15, 0.38), R(1.6, 0.6, 0.15, 0.5), R(0.5, 0.68, 0.16, 0.56), R(-1.0, 0.68, 0.18, 0.6), R(-2.2, 0.64, 0.2, 0.62), R(-2.62, 0.58, 0.24, 0.58)], 24), paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    const x = side * 0.86;
    // 앞 펜더: 바퀴 앞(아래로 내려가는 코) + 아치 + 바퀴 뒤 (사이드포드로 이어짐)
    add(loft([R(2.95, 0.12, 0.17, 0.3, 4, x), R(2.6, 0.18, 0.16, 0.6, 4, x), R(2.25, 0.18, 0.18, 0.78, 4, x)]), paint, 0, 0, 0);
    add(loft([R(1.25, 0.18, 0.4, 0.82, 4, x), R(0.8, 0.17, 0.3, 0.68, 4, x), R(0.3, 0.12, 0.3, 0.55, 4, x * 0.92)]), paint, 0, 0, 0);
    // 사이드포드 (흡입구가 앞에 있음)
    add(loft([R(0.6, 0.2, 0.18, 0.5, 4, side * 0.74), R(-0.2, 0.26, 0.18, 0.56, 4, side * 0.74), R(-0.95, 0.24, 0.2, 0.62, 4, side * 0.76)]), paint, 0, 0, 0);
    add(new THREE.BoxGeometry(0.3, 0.2, 0.04), dark, side * 0.74, 0.36, 0.62);
    // 뒤 펜더: 바퀴 앞 + 아치 + 바퀴 뒤 (높게 솟음)
    const xr = side * 0.88;
    add(loft([R(-0.9, 0.22, 0.2, 0.66, 4, xr), R(-1.1, 0.22, 0.42, 0.88, 4, xr)]), paint, 0, 0, 0);
    add(loft([R(-2.0, 0.22, 0.42, 0.9, 4, xr), R(-2.4, 0.22, 0.24, 0.86, 4, xr), R(-2.64, 0.2, 0.26, 0.74, 4, xr)]), paint, 0, 0, 0);
    // 헤드라이트 (노란 LED 줄)
    const hl = add(new THREE.BoxGeometry(0.22, 0.05, 0.3), M.lampYellow, x, 0.55, 2.52);
    hl.rotation.x = 0.55;
    hl.castShadow = false;
    // 옆 줄무늬 (흰색 + 노란색)
    add(new THREE.BoxGeometry(0.02, 0.05, 2.0), accent, side * 0.96, 0.46, -0.2).castShadow = false;
    add(new THREE.BoxGeometry(0.02, 0.025, 2.0), trim, side * 0.962, 0.41, -0.2).castShadow = false;
    // 백미러 (펜더 위)
    add(new THREE.BoxGeometry(0.14, 0.07, 0.1), paint, side * 0.78, 0.86, 1.05);
  }
  arches(add, M, W, 0.03, 0.16, 0.08);
  // 캐노피 (차체색) + 앞 유리
  add(loft([R(1.15, 0.28, 0.5, 0.56, 3), R(0.6, 0.45, 0.54, 0.95, 3), R(-0.2, 0.49, 0.58, 1.08, 3), R(-1.0, 0.42, 0.58, 0.98, 3), R(-1.7, 0.26, 0.56, 0.76, 3)], 24), paint, 0, 0, 0);
  add(loft([R(1.16, 0.29, 0.5, 0.57, 3), R(0.6, 0.46, 0.54, 0.96, 3), R(0.1, 0.495, 0.57, 1.075, 3), R(-0.05, 0.5, 0.575, 1.08, 3)], 24), glass, 0, 0, 0);
  // 옆 창 (캐노피 옆 어두운 유리)
  for (const side of [-1, 1]) {
    const sw = add(new THREE.BoxGeometry(0.02, 0.22, 0.6), glass, side * 0.47, 0.84, -0.45);
    sw.rotation.z = side * 0.35;
  }
  // 엔진 덮개 + 샤크핀 (번호)
  add(loft([R(-1.2, 0.36, 0.56, 0.9, 3), R(-2.0, 0.3, 0.54, 0.78, 3), R(-2.62, 0.22, 0.5, 0.62, 3)]), paint, 0, 0, 0);
  const fin = new THREE.Shape();
  fin.moveTo(-0.3, 1.04);
  fin.lineTo(-2.45, 1.2);
  fin.lineTo(-2.5, 0.62);
  fin.lineTo(-1.2, 0.86);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.03, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.015, 0, 0);
  add(finGeo, paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    const plate = add(new THREE.PlaneGeometry(0.34, 0.34), M.numMat, side * 0.02, 0.98, -1.6);
    plate.rotation.y = side * Math.PI / 2;
    plate.castShadow = false;
  }
  // 앞 스플리터 (+ 다이브 플레인)
  const fWing = new THREE.Group();
  body.add(fWing);
  add(new THREE.BoxGeometry(1.95, 0.03, 0.42), carbon, 0, 0.13, 2.78, fWing);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.22, 0.02, 0.14), trim, side * 0.86, 0.36, 2.86, fWing).rotation.z = side * 0.3;
  // 뒤: LED 후미등, 디퓨저
  add(new THREE.BoxGeometry(1.7, 0.035, 0.04), tailMat, 0, 0.66, -2.66);
  const diff = add(new THREE.BoxGeometry(1.4, 0.03, 0.5), carbon, 0, 0.24, -2.5);
  diff.rotation.x = 0.4;
  for (const x of [-0.5, -0.2, 0.2, 0.5]) add(new THREE.BoxGeometry(0.02, 0.2, 0.45), carbon, x, 0.26, -2.48);
  // 백조목 뒷날개
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.92, 0.05, 0.38), carbon, 0, 1.18, -2.55, spoiler);
  const drs = add(new THREE.BoxGeometry(1.92, 0.04, 0.2), paint, 0, 1.3, -2.7, spoiler);
  drs.rotation.x = 0.4;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.04, 0.5, 0.74), paint, side * 0.97, 1.12, -2.6, spoiler);
    add(new THREE.BoxGeometry(0.045, 0.05, 0.74), trim, side * 0.97, 1.38, -2.6, spoiler).castShadow = false;
    const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(side * 0.3, 0.7, -2.1), new THREE.Vector3(side * 0.3, 1.18, -2.25), new THREE.Vector3(side * 0.3, 1.25, -2.5)]);
    add(new THREE.TubeGeometry(neck, 10, 0.03, 6, false), carbon, 0, 0, 0, spoiler);
  }
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 0.86, -0.3);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.82, 0.48], r: [0.86, 0.58] },
      helmet: [0, 0.86, -0.3],
      visor: [0.96, -0.75],
      armor: { y: 0.66, x: 0.8 },
      ram: { y: 0.06, z: 1.78 },
      spines: [[-0.55, 1.12], [-1.0, 1.15], [-1.45, 1.18], [-1.9, 1.2]],
      booster: { x: 0.42, y0: 0.45, y1: 0.84, z0: -0.55, dz: -1.25 },
      lift: { y: 0.72, z: -2.45, h: 0.28 },
      stab: [0.98, 1.16, -2.6],
      tailFin: [0, 1.1, -0.85],
      wing: [0.8, 0.55, 0.0],
      nitro: { x: 0.3, y: 0.38, z: -2.25, dz: -0.42 },
      vents: [[0.74, 0.57, -0.1], [0.74, 0.58, -0.38], [0.74, 0.6, -0.66]],
      glow: { y: 0.46, z: 2.05, len: 1.3, rot: 0.11, w: 0.06 },
      flames: [[0, 0.42, 0.9, -2.66]],
      motor: [0.38, 0.32, -2.66],
      spark: [0.88, 0.25, -2.05],
      seams: [0.9, 0.17, -0.2],
      lean: 0.04,
      drsRest: 0.4,
    },
  };
}

// ------------------------------------------------------------------ 로켓 (드래그스터 + 로켓 엔진): 바늘 같은 긴 노즈, 아주 작은 앞바퀴, 거대한 뒷바퀴, 등 위 로켓, 높은 뒷날개
function buildRocket({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, darkMetal, glass, tailMat } = M;
  const W = [
    [-0.56, 2.4, true, 0.25, 0.16, 0.14],
    [0.56, 2.4, true, 0.25, 0.16, 0.14],
    [-0.94, -1.6, false, 0.52, 0.58, 0.36],
    [0.94, -1.6, false, 0.52, 0.58, 0.36],
  ];
  add(loft([R(3.25, 0.05, 0.25, 0.31, 2.5), R(2.7, 0.15, 0.2, 0.4, 3), R(1.6, 0.26, 0.22, 0.54, 3), R(0.4, 0.36, 0.22, 0.62, 3), R(-0.6, 0.42, 0.22, 0.66, 3), R(-1.4, 0.46, 0.24, 0.7, 3), R(-2.3, 0.42, 0.26, 0.66, 3), R(-2.5, 0.32, 0.3, 0.58, 3)], 24), paint, 0, 0, 0);
  // 노즈 끝 + 옆 줄무늬 (보라색 불꽃 띠)
  add(loft([R(3.27, 0.05, 0.25, 0.31, 2.5), R(3.0, 0.1, 0.22, 0.36, 3), R(2.85, 0.12, 0.215, 0.375, 3)]), trim, 0, 0, 0);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const s = add(new THREE.BoxGeometry(0.02, 0.05, 1.3 - i * 0.3), i % 2 ? accent : trim, side * (0.36 + i * 0.03), 0.47 - i * 0.07, 0.6 - i * 0.1);
      s.rotation.y = side * -0.07;
      s.castShadow = false;
    }
    // 옆 공기 흡입구
    add(new THREE.BoxGeometry(0.1, 0.18, 0.4), dark, side * 0.44, 0.48, -0.95);
  }
  // 조종석 + 작은 앞 유리 + 롤 후프
  add(new THREE.BoxGeometry(0.46, 0.05, 0.85), dark, 0, 0.66, -0.25);
  const ws = add(new THREE.BoxGeometry(0.5, 0.2, 0.03), glass, 0, 0.74, 0.25);
  ws.rotation.x = -0.6;
  add(new THREE.TorusGeometry(0.3, 0.035, 8, 20, Math.PI), metal, 0, 0.66, -0.68);
  // 등 위 로켓 엔진 (받침대 2개)
  const pod = new THREE.Group();
  pod.position.set(0, 1.02, -1.45);
  body.add(pod);
  add(new THREE.CylinderGeometry(0.27, 0.27, 1.5, 20).rotateX(Math.PI / 2), metal, 0, 0, 0, pod);
  add(new THREE.ConeGeometry(0.27, 0.5, 20).rotateX(Math.PI / 2), paint, 0, 0, 1.0, pod);
  for (const z of [0.45, -0.4]) add(new THREE.TorusGeometry(0.275, 0.025, 6, 22), trim, 0, 0, z, pod);
  add(new THREE.CylinderGeometry(0.2, 0.33, 0.4, 20, 1, true).rotateX(Math.PI / 2), darkMetal, 0, 0, -0.95, pod);
  add(new THREE.CircleGeometry(0.19, 18).rotateY(Math.PI), M.glowTrim, 0, 0, -0.8, pod).castShadow = false;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const f = add(new THREE.BoxGeometry(0.03, 0.3, 0.42), paint, Math.cos(a) * 0.38, Math.sin(a) * 0.38, -0.55, pod);
    f.rotation.z = a - Math.PI / 2;
  }
  for (const z of [-0.95, -1.85]) add(new THREE.BoxGeometry(0.08, 0.36, 0.2), carbon, 0, 0.76, z);
  // 아주 작은 앞날개 (카나드)
  const fWing = new THREE.Group();
  body.add(fWing);
  add(new THREE.BoxGeometry(0.95, 0.03, 0.2), carbon, 0, 0.3, 2.95, fWing);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.12, 0.24), trim, side * 0.47, 0.32, 2.95, fWing);
  // 뒤: 후미등 + 작은 디퓨저
  add(new THREE.BoxGeometry(0.4, 0.06, 0.04), tailMat, 0, 0.47, -2.53);
  const diff = add(new THREE.BoxGeometry(0.8, 0.03, 0.35), carbon, 0, 0.27, -2.4);
  diff.rotation.x = 0.35;
  // 높은 뒷날개 (탑퓨얼 드래그스터처럼 기둥 4개 위)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  const main = add(new THREE.BoxGeometry(2.0, 0.05, 0.5), carbon, 0, 1.72, -2.45, spoiler);
  main.rotation.x = 0.12;
  const drs = add(new THREE.BoxGeometry(2.0, 0.04, 0.26), paint, 0, 1.84, -2.68, spoiler);
  drs.rotation.x = 0.5;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.04, 0.56, 0.86), paint, side * 1.0, 1.7, -2.5, spoiler);
    add(new THREE.BoxGeometry(0.045, 0.06, 0.86), accent, side * 1.0, 1.99, -2.5, spoiler).castShadow = false;
    for (const [z0, z1] of [[-1.95, -2.32], [-2.4, -2.58]]) add(rodGeometry(new THREE.Vector3(side * 0.3, 0.62, z0), new THREE.Vector3(side * 0.45, 1.7, z1), 0.025), metal, 0, 0, 0, spoiler);
  }
  const plateL = add(new THREE.PlaneGeometry(0.5, 0.5), M.numMat, 1.025, 1.72, -2.5, spoiler);
  plateL.rotation.y = Math.PI / 2;
  const plateR = add(new THREE.PlaneGeometry(0.5, 0.5), M.numMat, -1.025, 1.72, -2.5, spoiler);
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
      spines: [[-0.85, 1.3], [-1.25, 1.31], [-1.65, 1.31], [-2.05, 1.3]],
      booster: { x: 0.54, y0: 0.42, y1: 0.66, z0: -0.45, dz: -1.2 },
      lift: { y: 0.66, z: -2.15, h: 0.2 },
      stab: [1.0, 1.72, -2.5],
      tailFin: [0, 1.28, -0.75],
      wing: [0.42, 0.52, 0.25],
      nitro: { x: 0.2, y: 0.36, z: -2.2, dz: -0.35 },
      vents: [[0.36, 0.64, 0.25], [0.38, 0.65, -0.02], [0.4, 0.66, -0.29]],
      glow: { y: 0.53, z: 1.6, len: 1.6, rot: 0.135, w: 0.05 },
      flames: [[0, 1.02, 1.6, -2.55], [0, 0.44, 0.6, -2.55]],
      motor: [0.34, 0.34, -2.55],
      spark: [0.94, 0.3, -2.15],
      seams: [0.45, 0.2, 0.0],
      lean: 0.05,
      drsRest: 0.5,
    },
  };
}

// ------------------------------------------------------------------ 버기 (모래 버기): 드러난 쇠파이프 롤케이지, 울퉁불퉁 큰 타이어, 긴 서스펜션, 지붕 조명, 예비 타이어
function buildBuggy({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, lamp, tailMat, rubber } = M;
  const W = [
    [-0.96, 1.55, true, 0.44, 0.38, 0.28],
    [0.96, 1.55, true, 0.44, 0.38, 0.28],
    [-0.98, -1.45, false, 0.46, 0.42, 0.3],
    [0.98, -1.45, false, 0.46, 0.42, 0.3],
  ];
  // 작은 몸통 (앞은 경사진 보닛)
  add(loft([R(2.35, 0.36, 0.44, 0.56, 4), R(1.95, 0.52, 0.34, 0.68), R(0.6, 0.58, 0.3, 0.72), R(-1.0, 0.58, 0.3, 0.76), R(-1.9, 0.52, 0.34, 0.8), R(-2.15, 0.42, 0.42, 0.76, 4)], 24), paint, 0, 0, 0);
  // 보닛 흰 줄 + 번호판(옆)
  const hs = add(new THREE.BoxGeometry(0.16, 0.012, 1.4), accent, 0, 0.72, 1.35);
  hs.rotation.x = 0.04;
  hs.castShadow = false;
  doorNumber(add, M, 0.585, 0.53, 0.0, 0.36);
  // 바닥 보호판 (앞이 들림)
  const skid = add(new THREE.BoxGeometry(0.9, 0.04, 0.55), metal, 0, 0.36, 2.4);
  skid.rotation.x = -0.55;
  // 롤케이지 (쇠파이프)
  const T = (a, b, r = 0.04) => add(rodGeometry(new THREE.Vector3(...a), new THREE.Vector3(...b), r), trim, 0, 0, 0);
  for (const s of [-1, 1]) {
    T([s * 0.56, 0.72, 0.55], [s * 0.5, 1.55, 0.3]); // 앞 기둥
    T([s * 0.56, 0.74, -0.75], [s * 0.5, 1.62, -0.75]); // 가운데 기둥
    T([s * 0.5, 1.55, 0.3], [s * 0.5, 1.62, -0.75]); // 지붕 옆
    T([s * 0.5, 1.62, -0.75], [s * 0.45, 0.82, -1.95]); // 뒤 버팀
    T([s * 0.56, 0.72, 0.55], [s * 0.36, 0.64, 2.0]); // 앞 범퍼로
    T([s * 0.56, 1.1, -0.75], [s * 0.56, 1.1, 0.5], 0.03); // 옆 보호대
  }
  T([-0.5, 1.55, 0.3], [0.5, 1.55, 0.3]);
  T([-0.5, 1.62, -0.75], [0.5, 1.62, -0.75]);
  T([-0.5, 1.62, -0.75], [0.45, 0.82, -1.95], 0.03); // 대각선
  T([-0.45, 0.82, -1.95], [0.45, 0.82, -1.95]);
  // 지붕 조명 막대 (등 4개)
  add(new THREE.BoxGeometry(1.0, 0.09, 0.1), carbon, 0, 1.63, 0.34);
  for (const x of [-0.36, -0.12, 0.12, 0.36]) add(new THREE.BoxGeometry(0.18, 0.06, 0.02), lamp, x, 1.63, 0.395).castShadow = false;
  // 좌석 + 엔진 + 공기 필터 + 위로 솟은 배기관
  add(new THREE.BoxGeometry(0.5, 0.5, 0.12), dark, 0, 0.9, -0.62).rotation.x = -0.2;
  add(new THREE.BoxGeometry(0.7, 0.32, 0.7), metal, 0, 0.88, -1.45);
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 14).rotateZ(Math.PI / 2), accent, side * 0.42, 0.98, -1.3);
    add(rodGeometry(new THREE.Vector3(side * 0.22, 0.95, -1.75), new THREE.Vector3(side * 0.32, 1.28, -2.08), 0.05), metal, 0, 0, 0);
  }
  // 예비 타이어 (뒤에 세워 매달림)
  const spare = new THREE.Group();
  spare.position.set(0, 1.05, -2.02);
  body.add(spare);
  add(new THREE.TorusGeometry(0.3, 0.12, 10, 22), rubber, 0, 0, 0, spare);
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 14).rotateX(Math.PI / 2), M.rimMat, 0, 0, 0, spare);
  // 앞 범퍼 파이프 + 헤드라이트 2개
  const fWing = new THREE.Group();
  body.add(fWing);
  add(rodGeometry(new THREE.Vector3(-0.62, 0.5, 2.3), new THREE.Vector3(0.62, 0.5, 2.3), 0.045), trim, 0, 0, 0, fWing);
  for (const side of [-1, 1]) {
    add(rodGeometry(new THREE.Vector3(side * 0.62, 0.5, 2.3), new THREE.Vector3(side * 0.45, 0.42, 1.95), 0.04), trim, 0, 0, 0, fWing);
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 16).rotateX(Math.PI / 2), carbon, side * 0.3, 0.64, 2.12);
    add(new THREE.CircleGeometry(0.085, 16), lamp, side * 0.3, 0.64, 2.175).castShadow = false;
    // 후미등 (둥근 등)
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12).rotateX(Math.PI / 2), tailMat, side * 0.36, 0.66, -2.17);
    // 머드플랩
    add(new THREE.BoxGeometry(0.36, 0.3, 0.025), carbon, side * 0.98, 0.26, -2.0);
  }
  // 작은 뒷날개 (케이지 지붕 뒤)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.25, 0.04, 0.32), paint, 0, 1.74, -1.0, spoiler);
  const drs = add(new THREE.BoxGeometry(1.25, 0.035, 0.14), accent, 0, 1.8, -1.16, spoiler);
  drs.rotation.x = 0.3;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.03, 0.2, 0.4), trim, side * 0.63, 1.73, -1.04, spoiler);
    add(new THREE.BoxGeometry(0.04, 0.14, 0.06), trim, side * 0.4, 1.67, -0.92, spoiler);
  }
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 1.08, -0.35);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.84, 0.66], r: [0.86, 0.72] },
      helmet: [0, 1.08, -0.35],
      visor: [1.12, -0.8],
      armor: { y: 0.78, x: 0.62 },
      ram: { y: 0.16, z: 1.62 },
      spines: [[0.15, 1.72], [-0.2, 1.73], [-0.55, 1.73], [-1.55, 1.12]],
      booster: { x: 0.5, y0: 0.6, y1: 0.98, z0: -0.55, dz: -1.25 },
      lift: { y: 1.6, z: -0.95, h: 0.2 },
      stab: [0.63, 1.74, -1.04],
      tailFin: [0, 1.66, -0.3],
      wing: [0.6, 0.66, 0.0],
      nitro: { x: 0.3, y: 0.5, z: -1.95, dz: -0.4 },
      vents: [[0.28, 0.7, 1.15], [0.28, 0.69, 1.4], [0.28, 0.68, 1.65]],
      glow: { y: 0.735, z: 1.35, len: 1.2, rot: 0.04, w: 0.05 },
      flames: [[0.34, 1.3, 0.45, -2.12], [-0.34, 1.3, 0.45, -2.12]],
      motor: [0.36, 0.4, -2.3],
      spark: [0.98, 0.28, -1.95],
      seams: [0.6, 0.28, 0.0],
      lean: 0.085,
      drsRest: 0.3,
    },
  };
}

// ================================================================== 새 차체 7종 (2026-11-10: 차 등급 15대용)
//   hatch(핫해치) / muscle(머슬카) / hyper(하이퍼카) / kart(카트) / roadster(옛날 로드스터) / truck(트로피 트럭·픽업, look.variant 'pickup') / ev(전기 콘셉트카)
//   다른 차와 똑같이 { helmet, fWing, spoiler, drs, A(변신 부품 자리) }를 돌려줌 → 가속·배·비행·부스터 변신이 모두 그대로 붙음

/** 빛나는 재질 (전기차 라이트 바, 하이퍼카 포인트 줄) */
function glowMat(color, k = 1.3) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.3 });
}

// ------------------------------------------------------------------ 핫해치: 짧고 통통한 5도어, 투톤 지붕, 벌집 그릴 + 빨간 줄, 지붕 스포일러, 가운데 쌍 배기구
function buildHatch({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat } = M;
  const W = [
    [-0.82, 1.38, true, 0.34, 0.28, 0.4],
    [0.82, 1.38, true, 0.34, 0.28, 0.4],
    [-0.82, -1.3, false, 0.34, 0.28, 0.4],
    [0.82, -1.3, false, 0.34, 0.28, 0.4],
  ];
  add(loft([R(2.22, 0.55, 0.3, 0.55), R(2.05, 0.78, 0.26, 0.66), R(1.0, 0.8, 0.26, 0.8), R(-1.6, 0.8, 0.27, 0.88), R(-2.0, 0.76, 0.3, 0.9), R(-2.08, 0.68, 0.36, 0.86)], 24), paint, 0, 0, 0);
  add(loft([R(2.18, 0.7, 0.3, 0.6, 4), R(2.02, 0.86, 0.27, 0.66), R(1.72, 0.88, 0.27, 0.72)], 24), paint, 0, 0, 0);
  add(loft([R(0.95, 0.88, 0.28, 0.8), R(0.0, 0.9, 0.28, 0.82), R(-0.9, 0.89, 0.28, 0.85)], 24), paint, 0, 0, 0);
  add(loft([R(-1.62, 0.89, 0.29, 0.88), R(-1.95, 0.87, 0.3, 0.89), R(-2.07, 0.8, 0.34, 0.86)], 24), paint, 0, 0, 0);
  arches(add, M, W, 0.03, 0.12, 0.12);
  // 유리 캐빈 + 흰 지붕 (투톤)
  add(loft([R(0.85, 0.66, 0.8, 0.86, 4), R(0.3, 0.69, 0.83, 1.28, 4), R(-0.5, 0.7, 0.85, 1.36, 4), R(-1.7, 0.68, 0.87, 1.34, 4), R(-1.98, 0.64, 0.87, 1.2, 4)], 24), glass, 0, 0, 0);
  add(loft([R(0.25, 0.6, 1.27, 1.32, 3), R(-0.4, 0.665, 1.34, 1.39, 3), R(-1.7, 0.66, 1.33, 1.38, 3), R(-1.92, 0.62, 1.24, 1.3, 3)], 24), accent, 0, 0, 0);
  for (const side of [-1, 1]) {
    // 기둥 2개 (B·C필러), 문 아래 줄, 백미러
    add(new THREE.BoxGeometry(0.05, 0.46, 0.12), dark, side * 0.69, 1.08, -0.35).rotation.z = side * -0.06;
    add(new THREE.BoxGeometry(0.05, 0.42, 0.1), dark, side * 0.68, 1.08, -1.2).rotation.z = side * -0.06;
    add(new THREE.BoxGeometry(0.02, 0.05, 1.9), trim, side * 0.9, 0.36, 0.0).castShadow = false;
    add(new THREE.BoxGeometry(0.02, 0.03, 1.9), accent, side * 0.9, 0.42, 0.0).castShadow = false;
    add(new THREE.BoxGeometry(0.15, 0.09, 0.11), accent, side * 0.78, 0.96, 0.62);
    // 비스듬한 헤드라이트 + 안개등
    const hl = add(new THREE.BoxGeometry(0.34, 0.08, 0.05), lamp, side * 0.55, 0.6, 2.13);
    hl.rotation.set(-0.3, side * 0.35, side * -0.12);
    hl.castShadow = false;
    add(new THREE.CircleGeometry(0.06, 14), lamp, side * 0.62, 0.36, 2.23).castShadow = false;
    // 후미등 (C필러를 따라 세로로 긴 등)
    add(new THREE.BoxGeometry(0.14, 0.3, 0.04), tailMat, side * 0.7, 0.86, -2.07);
  }
  doorNumber(add, M, 0.9, 0.6, -0.15, 0.36);
  // 벌집 그릴 + 그릴 위 빨간 줄 (핫해치 표시) + 앞 범퍼 공기구멍
  add(new THREE.BoxGeometry(0.86, 0.16, 0.04), dark, 0, 0.5, 2.21);
  add(new THREE.BoxGeometry(0.9, 0.025, 0.045), tailMat, 0, 0.6, 2.2).castShadow = false;
  for (let i = -3; i <= 3; i++) add(new THREE.BoxGeometry(0.012, 0.14, 0.05), carbon, i * 0.12, 0.5, 2.22).castShadow = false;
  add(new THREE.BoxGeometry(1.2, 0.1, 0.04), dark, 0, 0.32, 2.22);
  // 보닛 위 작은 볼록 두 줄
  for (const sx of [-0.26, 0.26]) add(new THREE.BoxGeometry(0.06, 0.02, 0.8), paint, sx, 0.74, 1.55).rotation.x = 0.12;
  // 뒤: 해치 유리 아래 손잡이 띠, 디퓨저, 가운데 쌍 배기구
  add(new THREE.BoxGeometry(0.9, 0.05, 0.03), metal, 0, 0.72, -2.09);
  const diff = add(new THREE.BoxGeometry(1.15, 0.04, 0.28), carbon, 0, 0.3, -1.98);
  diff.rotation.x = 0.3;
  for (const x of [-0.12, 0.12]) add(new THREE.CylinderGeometry(0.06, 0.065, 0.2, 14).rotateX(Math.PI / 2), metal, x, 0.32, -2.1);
  // 앞 립
  const fWing = new THREE.Group();
  body.add(fWing);
  add(new THREE.BoxGeometry(1.5, 0.03, 0.2), carbon, 0, 0.27, 2.2, fWing);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.18, 0.02, 0.1), trim, side * 0.66, 0.3, 2.24, fWing);
  // 지붕 스포일러
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.28, 0.05, 0.3), paint, 0, 1.36, -1.98, spoiler).rotation.x = 0.1;
  const drs = add(new THREE.BoxGeometry(1.28, 0.035, 0.12), carbon, 0, 1.4, -2.13, spoiler);
  drs.rotation.x = 0.3;
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.14, 0.34), carbon, side * 0.64, 1.36, -2.02, spoiler);
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
      stab: [0.64, 1.36, -2.0],
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

// ------------------------------------------------------------------ 머슬카: 긴 보닛을 뚫고 나온 슈퍼차저(블로워), 패스트백, 넓은 뒤 펜더, 금색 쌍줄, 사이드 배기관, 덕테일
function buildMuscle({ add, body, M }) {
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
  // 앞: 검은 그릴 + 크롬 범퍼
  add(new THREE.BoxGeometry(1.0, 0.16, 0.04), dark, 0, 0.5, 2.78);
  add(new THREE.BoxGeometry(1.6, 0.07, 0.08), metal, 0, 0.31, 2.8);
  // 뒤: 가로로 긴 후미등, 크롬 범퍼
  add(new THREE.BoxGeometry(1.5, 0.08, 0.04), tailMat, 0, 0.76, -2.6);
  add(new THREE.BoxGeometry(1.6, 0.07, 0.08), metal, 0, 0.36, -2.62);
  // 앞 립
  const fWing = new THREE.Group();
  body.add(fWing);
  add(new THREE.BoxGeometry(1.7, 0.035, 0.22), carbon, 0, 0.22, 2.74, fWing);
  // 덕테일 (트렁크 끝이 오리 꼬리처럼 들림)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  const duck = add(new THREE.BoxGeometry(1.5, 0.06, 0.3), paint, 0, 0.94, -2.48, spoiler);
  duck.rotation.x = -0.35;
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

// ------------------------------------------------------------------ 하이퍼카: 아주 낮은 쐐기, 물방울 캐노피, 옆 큰 흡입구, 엔진 덮개 루버, 빛나는 포인트 줄, 높은 백조목 날개, 가운데 배기구 3개
function buildHyper({ add, body, M, look }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat } = M;
  const neon = glowMat(look.trim, 1.5);
  const W = [
    [-0.9, 1.72, true, 0.36, 0.3, 0.4],
    [0.9, 1.72, true, 0.36, 0.3, 0.4],
    [-0.93, -1.55, false, 0.39, 0.4, 0.42],
    [0.93, -1.55, false, 0.39, 0.4, 0.42],
  ];
  add(loft([R(2.9, 0.5, 0.16, 0.28, 4), R(2.5, 0.72, 0.15, 0.42), R(1.4, 0.78, 0.15, 0.55), R(0, 0.8, 0.16, 0.62), R(-1.3, 0.8, 0.18, 0.66), R(-2.3, 0.76, 0.2, 0.66), R(-2.62, 0.68, 0.24, 0.6)], 24), paint, 0, 0, 0);
  add(loft([R(2.84, 0.8, 0.18, 0.34, 4), R(2.35, 0.98, 0.17, 0.6), R(2.0, 0.98, 0.17, 0.63)], 24), paint, 0, 0, 0);
  add(loft([R(1.25, 0.96, 0.2, 0.58), R(0.2, 0.92, 0.2, 0.58), R(-0.6, 0.94, 0.2, 0.62)], 24), paint, 0, 0, 0);
  add(loft([R(-1.0, 1.02, 0.2, 0.7), R(-2.25, 1.03, 0.22, 0.73), R(-2.62, 0.92, 0.26, 0.66)], 24), paint, 0, 0, 0);
  arches(add, M, W, 0.03, 0.12, 0.08);
  // 아래쪽은 검은색 (투톤) + 빛나는 포인트 줄
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.04, 0.12, 2.3), accent, side * 0.99, 0.27, -0.2);
    add(new THREE.BoxGeometry(0.02, 0.02, 2.3), neon, side * 1.012, 0.34, -0.2).castShadow = false;
    // 옆 큰 흡입구 (문 뒤 → 뒤 펜더 앞)
    const sc = add(new THREE.BoxGeometry(0.06, 0.26, 0.6), dark, side * 1.0, 0.45, -0.72);
    sc.rotation.y = side * 0.25;
    add(new THREE.BoxGeometry(0.02, 0.02, 0.62), neon, side * 1.02, 0.6, -0.72).rotation.y = side * 0.25;
    // 얇은 LED 헤드라이트 (위로 꺾인 화살표)
    const hl = add(new THREE.BoxGeometry(0.38, 0.03, 0.06), lamp, side * 0.6, 0.48, 2.5);
    hl.rotation.set(-0.5, side * 0.45, side * 0.15);
    hl.castShadow = false;
    add(new THREE.BoxGeometry(0.14, 0.03, 0.05), neon, side * 0.82, 0.42, 2.38).rotation.y = side * 0.6;
    // 사이드미러 (가는 기둥 위)
    add(rodGeometry(new THREE.Vector3(side * 0.72, 0.68, 0.95), new THREE.Vector3(side * 0.85, 0.82, 0.9), 0.015), carbon, 0, 0, 0);
    add(new THREE.BoxGeometry(0.15, 0.06, 0.1), paint, side * 0.88, 0.84, 0.9);
  }
  // 물방울 캐노피 (유리) + 지붕 공기구멍
  add(loft([R(1.45, 0.3, 0.55, 0.6, 3), R(0.8, 0.5, 0.6, 0.95, 3), R(0, 0.55, 0.62, 1.08, 3), R(-0.8, 0.5, 0.62, 1.02, 3), R(-1.5, 0.38, 0.62, 0.84, 3)], 24), glass, 0, 0, 0);
  add(loft([R(-0.1, 0.1, 1.06, 1.12, 3), R(-0.6, 0.14, 1.03, 1.16, 3), R(-1.5, 0.12, 0.84, 0.98, 3)]), paint, 0, 0, 0);
  add(new THREE.BoxGeometry(0.2, 0.08, 0.02), dark, 0, 1.11, -0.1);
  // 엔진 덮개 루버 (검은 틈)
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.9, 0.012, 0.06), dark, 0, 0.665 - i * 0.004, -1.65 - i * 0.14).castShadow = false;
  doorNumber(add, M, 0.965, 0.44, 0.25, 0.28);
  // 앞 스플리터 + 가운데 공기 구멍
  add(new THREE.BoxGeometry(0.7, 0.08, 0.04), dark, 0, 0.27, 2.86);
  // 뒤: 가로 라이트 바 + 큰 디퓨저 + 가운데 배기구 3개
  add(new THREE.BoxGeometry(1.75, 0.04, 0.04), tailMat, 0, 0.56, -2.64);
  add(new THREE.BoxGeometry(1.75, 0.012, 0.045), neon, 0, 0.6, -2.64).castShadow = false;
  const diff = add(new THREE.BoxGeometry(1.5, 0.03, 0.55), carbon, 0, 0.24, -2.5);
  diff.rotation.x = 0.45;
  for (const x of [-0.55, -0.3, 0.3, 0.55]) add(new THREE.BoxGeometry(0.02, 0.22, 0.5), carbon, x, 0.26, -2.48);
  for (const x of [-0.13, 0, 0.13]) add(new THREE.CylinderGeometry(0.055, 0.06, 0.2, 12).rotateX(Math.PI / 2), metal, x, 0.4, -2.62);
  const fWing = new THREE.Group();
  body.add(fWing);
  add(new THREE.BoxGeometry(1.95, 0.03, 0.4), carbon, 0, 0.12, 2.76, fWing);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.12, 0.38), trim, side * 0.97, 0.18, 2.76, fWing);
  // 높은 백조목 뒷날개
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.9, 0.05, 0.4), carbon, 0, 1.24, -2.42, spoiler);
  const drs = add(new THREE.BoxGeometry(1.9, 0.04, 0.2), paint, 0, 1.33, -2.58, spoiler);
  drs.rotation.x = 0.35;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.04, 0.36, 0.62), accent, side * 0.96, 1.2, -2.48, spoiler);
    add(new THREE.BoxGeometry(0.045, 0.02, 0.62), neon, side * 0.96, 1.39, -2.48, spoiler).castShadow = false;
    const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(side * 0.35, 0.64, -2.0), new THREE.Vector3(side * 0.35, 1.15, -2.15), new THREE.Vector3(side * 0.35, 1.27, -2.38)]);
    add(new THREE.TubeGeometry(neck, 10, 0.03, 6, false), carbon, 0, 0, 0, spoiler);
  }
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 0.86, -0.25);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.82, 0.48], r: [0.88, 0.58] },
      helmet: [0, 0.86, -0.25],
      visor: [0.98, -0.75],
      armor: { y: 0.64, x: 0.86 },
      ram: { y: 0.06, z: 1.85 },
      spines: [[-0.9, 1.0], [-1.3, 0.95], [-1.7, 0.86], [-2.1, 0.78]],
      booster: { x: 0.45, y0: 0.45, y1: 0.85, z0: -0.6, dz: -1.25 },
      lift: { y: 0.66, z: -2.3, h: 0.3 },
      stab: [0.97, 1.22, -2.48],
      tailFin: [0, 1.06, -0.95],
      wing: [0.85, 0.5, 0.0],
      nitro: { x: 0.3, y: 0.38, z: -2.52, dz: -0.42 },
      vents: [[0.78, 0.6, -1.3], [0.78, 0.61, -1.55], [0.78, 0.62, -1.8]],
      glow: { y: 0.43, z: 2.25, len: 1.1, rot: 0.14, w: 0.06 },
      flames: [[0, 0.4, 0.6, -2.72], [-0.13, 0.4, 0.45, -2.72], [0.13, 0.4, 0.45, -2.72]],
      motor: [0.4, 0.32, -2.66],
      spark: [0.93, 0.25, -2.05],
      seams: [0.95, 0.17, -0.1],
      lean: 0.035,
      drsRest: 0.35,
    },
  };
}

// ------------------------------------------------------------------ 카트: 쇠파이프 틀, 앞 페어링, 옆 범퍼, 운전석이 그대로 보임(핸들·몸통), 오른쪽 뒤 엔진 + 배기관
function buildKart({ add, body, M, look }) {
  const { paint, accent, trim, carbon, dark, metal, rubber } = M;
  const W = [
    [-0.72, 1.0, true, 0.25, 0.2, 0.2],
    [0.72, 1.0, true, 0.25, 0.2, 0.2],
    [-0.76, -0.98, false, 0.28, 0.3, 0.2],
    [0.76, -0.98, false, 0.28, 0.3, 0.2],
  ];
  const T = (a, b, r = 0.025, mat = trim) => add(rodGeometry(new THREE.Vector3(...a), new THREE.Vector3(...b), r), mat, 0, 0, 0);
  // 바닥판 + 쇠파이프 틀
  add(new THREE.BoxGeometry(0.72, 0.03, 2.1), carbon, 0, 0.1, 0.0);
  for (const s of [-1, 1]) {
    T([s * 0.36, 0.12, 1.15], [s * 0.36, 0.12, -1.15]);
    T([s * 0.36, 0.12, 0.9], [s * 0.6, 0.18, 1.0]); // 앞 차축 쪽
    T([s * 0.36, 0.12, -0.9], [s * 0.6, 0.2, -0.98]);
  }
  T([-0.36, 0.12, 1.15], [0.36, 0.12, 1.15]);
  T([-0.36, 0.12, -1.15], [0.36, 0.12, -1.15]);
  T([-0.62, 0.28, -0.98], [0.62, 0.28, -0.98], 0.035, metal); // 뒤 차축
  // 앞 페어링 (노즈 콘) + 번호판
  add(loft([R(1.5, 0.32, 0.1, 0.26, 4), R(1.28, 0.46, 0.09, 0.33), R(0.95, 0.42, 0.1, 0.36), R(0.78, 0.3, 0.12, 0.34)], 20), paint, 0, 0, 0);
  const np = add(new THREE.PlaneGeometry(0.3, 0.26), M.numMat, 0, 0.36, 1.06);
  np.rotation.x = -0.45;
  np.castShadow = false;
  // 옆 범퍼 (사이드 포드)
  for (const s of [-1, 1]) {
    const x = s * 0.6;
    add(loft([R(0.62, 0.08, 0.1, 0.24, 4, x), R(0.35, 0.13, 0.08, 0.3, 4, x), R(-0.3, 0.13, 0.08, 0.3, 4, x), R(-0.62, 0.08, 0.1, 0.24, 4, x)], 16), accent, 0, 0, 0);
    add(new THREE.BoxGeometry(0.02, 0.05, 0.8), paint, s * 0.735, 0.2, 0.0).castShadow = false;
  }
  // 운전석 + 운전자 몸통·팔 + 핸들
  add(new THREE.BoxGeometry(0.44, 0.5, 0.08), dark, 0, 0.42, -0.5).rotation.x = -0.35;
  add(new THREE.BoxGeometry(0.44, 0.08, 0.4), dark, 0, 0.2, -0.3);
  const suit = new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.6 });
  add(new THREE.CylinderGeometry(0.17, 0.2, 0.46, 12), suit, 0, 0.52, -0.38).rotation.x = -0.3;
  for (const s of [-1, 1]) {
    add(rodGeometry(new THREE.Vector3(s * 0.18, 0.66, -0.3), new THREE.Vector3(s * 0.12, 0.52, 0.18), 0.045), suit, 0, 0, 0);
    add(rodGeometry(new THREE.Vector3(s * 0.12, 0.22, -0.1), new THREE.Vector3(s * 0.14, 0.2, 0.62), 0.055), suit, 0, 0, 0); // 다리
  }
  T([0, 0.18, 0.62], [0, 0.48, 0.24], 0.02, carbon); // 핸들 기둥
  const sw = add(new THREE.TorusGeometry(0.14, 0.022, 6, 18), carbon, 0, 0.5, 0.22);
  sw.rotation.x = -0.6;
  // 오른쪽 뒤 엔진 + 공기 필터 + 배기관 (구부러진 관)
  add(new THREE.BoxGeometry(0.28, 0.28, 0.3), metal, 0.34, 0.32, -0.72);
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 14).rotateZ(Math.PI / 2), accent, 0.56, 0.38, -0.62);
  const ex = new THREE.CatmullRomCurve3([new THREE.Vector3(0.3, 0.42, -0.8), new THREE.Vector3(0.22, 0.48, -1.0), new THREE.Vector3(0.3, 0.42, -1.18), new THREE.Vector3(0.32, 0.38, -1.2)]);
  add(new THREE.TubeGeometry(ex, 12, 0.04, 8, false), metal, 0, 0, 0);
  // 앞 범퍼 파이프
  const fWing = new THREE.Group();
  body.add(fWing);
  add(rodGeometry(new THREE.Vector3(-0.42, 0.16, 1.52), new THREE.Vector3(0.42, 0.16, 1.52), 0.025), trim, 0, 0, 0, fWing);
  for (const s of [-1, 1]) add(rodGeometry(new THREE.Vector3(s * 0.42, 0.16, 1.52), new THREE.Vector3(s * 0.36, 0.12, 1.15), 0.025), trim, 0, 0, 0, fWing);
  // 뒤 범퍼 (넓은 판) — 변신 때 뒷날개처럼 움직임
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.5, 0.05, 0.16), paint, 0, 0.3, -1.32, spoiler);
  const drs = add(new THREE.BoxGeometry(1.2, 0.035, 0.1), accent, 0, 0.36, -1.38, spoiler);
  drs.rotation.x = 0.2;
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.12, 0.2), trim, s * 0.75, 0.3, -1.32, spoiler);
  void rubber;
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
      stab: [0.74, 0.32, -1.32],
      tailFin: [0, 0.66, -0.85],
      wing: [0.62, 0.3, 0.0],
      nitro: { x: 0.32, y: 0.4, z: -1.1, dz: -0.35 },
      vents: [[0.6, 0.31, 0.3], [0.6, 0.32, 0.05], [0.6, 0.31, -0.2]],
      glow: { y: 0.37, z: 1.2, len: 0.55, rot: 0.2, w: 0.05 },
      flames: [[0.32, 0.38, 0.4, -1.25]],
      motor: [0.32, 0.25, -1.35],
      spark: [0.76, 0.2, -1.25],
      seams: [0.38, 0.08, 0.0],
      lean: 0.05,
      drsRest: 0.2,
    },
  };
}

// ------------------------------------------------------------------ 레트로 로드스터: 둥근 펜더, 지붕 없는 운전석 + 작은 앞유리, 헤드레스트 혹, 크롬 범퍼, 동그란 등, 원형 번호판
function buildRoadster({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat } = M;
  const W = [
    [-0.84, 1.45, true, 0.34, 0.24, 0.38],
    [0.84, 1.45, true, 0.34, 0.24, 0.38],
    [-0.84, -1.3, false, 0.35, 0.26, 0.4],
    [0.84, -1.3, false, 0.35, 0.26, 0.4],
  ];
  add(loft([R(2.32, 0.45, 0.32, 0.52, 3), R(2.1, 0.62, 0.28, 0.66, 3), R(1.0, 0.66, 0.27, 0.74, 3), R(-0.2, 0.68, 0.27, 0.74, 3), R(-1.6, 0.68, 0.28, 0.76, 3), R(-2.1, 0.6, 0.3, 0.72, 3), R(-2.2, 0.45, 0.36, 0.64, 3)], 24), paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    const xf = side * 0.74, xr = side * 0.76;
    // 둥글게 부푼 앞·뒤 펜더
    add(loft([R(2.22, 0.1, 0.36, 0.58, 3, xf), R(1.9, 0.2, 0.3, 0.76, 3, xf), R(1.45, 0.215, 0.3, 0.8, 3, xf), R(1.0, 0.2, 0.3, 0.74, 3, xf), R(0.6, 0.1, 0.32, 0.6, 3, xf)], 20), paint, 0, 0, 0);
    add(loft([R(-0.6, 0.1, 0.32, 0.6, 3, xr), R(-0.95, 0.2, 0.3, 0.78, 3, xr), R(-1.3, 0.215, 0.3, 0.82, 3, xr), R(-1.7, 0.2, 0.3, 0.76, 3, xr), R(-2.08, 0.1, 0.34, 0.6, 3, xr)], 20), paint, 0, 0, 0);
    // 동그란 헤드라이트 (펜더 앞) + 크롬 테
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 18).rotateX(Math.PI / 2), metal, side * 0.74, 0.62, 2.05);
    add(new THREE.CircleGeometry(0.09, 18), lamp, side * 0.74, 0.62, 2.095).castShadow = false;
    // 동그란 후미등
    add(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 14).rotateX(Math.PI / 2), tailMat, side * 0.72, 0.6, -2.08);
    // 헤드레스트 혹 (운전석 뒤로 길게)
    add(loft([R(-0.75, 0.13, 0.72, 0.95, 3, side * 0.3), R(-1.0, 0.14, 0.72, 0.96, 3, side * 0.3), R(-1.85, 0.05, 0.72, 0.78, 3, side * 0.3)], 16), paint, 0, 0, 0);
    // 문 손잡이 크롬 + 원형 번호판 바탕(흰 원)
    add(new THREE.BoxGeometry(0.02, 0.025, 0.12), metal, side * 0.69, 0.68, -0.1).castShadow = false;
    const disc = add(new THREE.CircleGeometry(0.25, 24), accent, side * 0.692, 0.52, 0.2);
    disc.rotation.y = side * Math.PI / 2;
    disc.castShadow = false;
  }
  doorNumber(add, M, 0.695, 0.52, 0.2, 0.3);
  // 운전석 (가죽색 좌석 2개) + 테두리
  add(new THREE.BoxGeometry(1.0, 0.04, 1.0), dark, 0, 0.74, -0.32);
  const leather = new THREE.MeshStandardMaterial({ color: '#7a3b22', roughness: 0.7 });
  for (const sx of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.4, 0.4, 0.1), leather, sx, 0.88, -0.72).rotation.x = -0.2;
  add(new THREE.TorusGeometry(0.15, 0.015, 6, 20), carbon, 0.3, 0.9, 0.18).rotation.x = -0.5; // 나무 핸들
  // 작은 앞유리 + 크롬 틀
  const ws = add(new THREE.BoxGeometry(1.0, 0.3, 0.02), glass, 0, 0.9, 0.38);
  ws.rotation.x = -0.4;
  T3(add, metal, [-0.5, 0.75, 0.42], [-0.5, 1.03, 0.32]);
  T3(add, metal, [0.5, 0.75, 0.42], [0.5, 1.03, 0.32]);
  T3(add, metal, [-0.5, 1.03, 0.32], [0.5, 1.03, 0.32]);
  // 보닛·트렁크 가운데 흰 줄, 보닛 위 공기구멍
  add(new THREE.BoxGeometry(0.22, 0.012, 1.7), accent, 0, 0.745, 1.25).castShadow = false;
  add(new THREE.BoxGeometry(0.22, 0.012, 0.9), accent, 0, 0.755, -1.7).castShadow = false;
  add(new THREE.BoxGeometry(0.3, 0.05, 0.4), dark, 0.32, 0.75, 1.0);
  // 앞: 타원 그릴 + 크롬 범퍼
  const gr = add(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 20).rotateX(Math.PI / 2), dark, 0, 0.47, 2.3);
  gr.scale.set(1.5, 0.75, 1);
  const fWing = new THREE.Group();
  body.add(fWing);
  add(rodGeometry(new THREE.Vector3(-0.8, 0.36, 2.25), new THREE.Vector3(0.8, 0.36, 2.25), 0.035), metal, 0, 0, 0, fWing);
  add(rodGeometry(new THREE.Vector3(-0.8, 0.38, -2.18), new THREE.Vector3(0.8, 0.38, -2.18), 0.035), metal, 0, 0, 0);
  // 트렁크 끝 작은 덕테일 + 짐받이(크롬)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.1, 0.04, 0.2), paint, 0, 0.76, -2.05, spoiler).rotation.x = -0.25;
  const drs = add(new THREE.BoxGeometry(0.9, 0.025, 0.25), metal, 0, 0.8, -1.75, spoiler);
  drs.rotation.x = 0.15;
  for (const x of [-0.3, 0, 0.3]) add(new THREE.BoxGeometry(0.02, 0.02, 0.3), metal, x, 0.82, -1.75, spoiler);
  add(new THREE.CylinderGeometry(0.05, 0.055, 0.2, 12).rotateX(Math.PI / 2), metal, -0.4, 0.32, -2.22);
  add(new THREE.CylinderGeometry(0.05, 0.055, 0.2, 12).rotateX(Math.PI / 2), metal, 0.4, 0.32, -2.22);
  void trim;
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0.3, 1.02, -0.45);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.74, 0.56], r: [0.74, 0.58] },
      helmet: [0.3, 1.02, -0.45],
      visor: [0.98, -0.7],
      armor: { y: 0.72, x: 0.74 },
      ram: { y: 0.15, z: 1.5 },
      spines: [[-0.9, 1.0], [-1.25, 0.96], [-1.6, 0.88], [-1.95, 0.8]],
      booster: { x: 0.6, y0: 0.5, y1: 0.86, z0: -0.5, dz: -1.2 },
      lift: { y: 0.72, z: -2.0, h: 0.2 },
      stab: [0.56, 0.78, -2.05],
      tailFin: [0, 0.96, -1.1],
      wing: [0.75, 0.55, 0.0],
      nitro: { x: 0.4, y: 0.32, z: -2.18, dz: -0.4 },
      vents: [[0.32, 0.76, 1.0], [0.32, 0.75, 1.25], [0.32, 0.74, 1.5]],
      glow: { y: 0.755, z: 1.4, len: 1.1, rot: 0.06, w: 0.05 },
      flames: [[-0.4, 0.32, 0.45, -2.3], [0.4, 0.32, 0.45, -2.3]],
      motor: [0.36, 0.38, -2.2],
      spark: [0.84, 0.24, -1.7],
      seams: [0.76, 0.25, 0.0],
      lean: 0.09,
      drsRest: 0.15,
    },
  };
}
/** 막대 하나 (로드스터 앞유리 틀 등) */
function T3(add, mat, a, b, r = 0.02) {
  return add(rodGeometry(new THREE.Vector3(...a), new THREE.Vector3(...b), r), mat, 0, 0, 0);
}

// ------------------------------------------------------------------ 트럭: 높은 차체, 큰 바퀴, 캐빈 + 짐칸.
//   trophy(기본, 트로피 트럭): 검은 오버펜더, 지붕 조명 막대, 앞 불바, 짐칸 예비 타이어, 드러난 뒤 쇼크업소버
//   look.variant 'pickup' (팜 픽업): 크롬 그릴, 둥근 등, 짐칸에 나무 상자, 캐빈 뒤 롤바
function buildTruck({ add, body, M, look }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat, rubber } = M;
  const pickup = look.variant === 'pickup';
  const r = pickup ? 0.44 : 0.5, wd = pickup ? 0.34 : 0.42, wx = pickup ? 0.92 : 1.0;
  const W = [
    [-wx, 1.7, true, r, wd, 0.3],
    [wx, 1.7, true, r, wd, 0.3],
    [-wx, -1.55, false, r, wd, 0.3],
    [wx, -1.55, false, r, wd, 0.3],
  ];
  const y0 = pickup ? 0.5 : 0.58; // 차체 바닥 높이
  // 프레임 + 보닛·캐빈 아래 몸통
  add(new THREE.BoxGeometry(0.8, 0.14, 4.7), carbon, 0, y0 - 0.02, 0.05);
  add(loft([R(2.6, 0.78, y0 + 0.04, y0 + 0.42, 6), R(2.35, 0.86, y0, y0 + 0.56), R(0.9, 0.88, y0, y0 + 0.62), R(-0.66, 0.88, y0, y0 + 0.66)], 24), paint, 0, 0, 0);
  // 캐빈 유리 + 지붕
  add(loft([R(0.72, 0.84, y0 + 0.6, y0 + 0.66, 6), R(0.4, 0.84, y0 + 0.64, y0 + 1.16, 6), R(-0.5, 0.84, y0 + 0.64, y0 + 1.2, 6), R(-0.64, 0.84, y0 + 0.64, y0 + 1.14, 6)], 24), glass, 0, 0, 0);
  add(loft([R(0.38, 0.8, y0 + 1.14, y0 + 1.2, 6), R(-0.62, 0.8, y0 + 1.16, y0 + 1.22, 6)], 24), paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.05, 0.52, 0.1), paint, side * 0.86, y0 + 0.9, -0.15); // B필러
    add(new THREE.BoxGeometry(0.16, 0.12, 0.08), pickup ? metal : dark, side * 0.95, y0 + 0.74, 0.62); // 백미러
  }
  // 짐칸: 바닥 + 양옆 벽 + 뒷문
  add(new THREE.BoxGeometry(1.72, 0.05, 1.85), dark, 0, y0 + 0.2, -1.62);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.46, 1.9), paint, side * 0.87, y0 + 0.42, -1.6);
  add(new THREE.BoxGeometry(1.8, 0.46, 0.06), paint, 0, y0 + 0.42, -2.56);
  add(new THREE.BoxGeometry(1.2, 0.08, 0.03), accent, 0, y0 + 0.5, -2.6).castShadow = false;
  doorNumber(add, M, 0.885, y0 + 0.4, 0.1, 0.4);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.2, 0.14, 0.04), tailMat, side * 0.75, y0 + 0.48, -2.6);
  // 옆 줄무늬
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.08, 4.0), accent, side * 0.895, y0 + 0.22, -0.3).castShadow = false;
  const fWing = new THREE.Group();
  body.add(fWing);
  const spoiler = new THREE.Group();
  body.add(spoiler);
  let drs;
  const T = (a, b, rr = 0.035, mat = trim, parent = body) => add(rodGeometry(new THREE.Vector3(...a), new THREE.Vector3(...b), rr), mat, 0, 0, 0, parent);
  if (!pickup) {
    // 트로피 트럭: 검은 오버펜더, 앞 불바 + 보조등, 지붕 조명 막대, 지붕 흡기구, 짐칸 예비 타이어, 뒤 쇼크업소버
    arches(add, M, W, 0.03, 0.15, 0.2, carbon);
    for (const side of [-1, 1]) T([side * 0.75, y0 + 0.1, 2.75], [side * 0.6, y0 + 0.62, 2.62], 0.04, trim, fWing);
    T([-0.75, y0 + 0.1, 2.75], [0.75, y0 + 0.1, 2.75], 0.045, trim, fWing);
    T([-0.6, y0 + 0.62, 2.62], [0.6, y0 + 0.62, 2.62], 0.04, trim, fWing);
    for (const x of [-0.3, 0.3]) {
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16).rotateX(Math.PI / 2), carbon, x, y0 + 0.62, 2.7, fWing);
      add(new THREE.CircleGeometry(0.085, 16), lamp, x, y0 + 0.62, 2.745, fWing).castShadow = false;
    }
    add(new THREE.BoxGeometry(1.5, 0.1, 0.12), carbon, 0, y0 + 1.27, 0.32);
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.2, 0.07, 0.02), lamp, -0.6 + i * 0.24, y0 + 1.27, 0.39).castShadow = false;
    add(new THREE.BoxGeometry(0.4, 0.12, 0.5), dark, 0, y0 + 1.28, -0.2);
    add(new THREE.BoxGeometry(0.7, 0.04, 0.03), dark, 0, y0 + 0.4, 2.62); // 그릴
    const spare = new THREE.Group();
    spare.position.set(0, y0 + 0.62, -1.55);
    spare.rotation.x = Math.PI / 2;
    body.add(spare);
    add(new THREE.TorusGeometry(0.34, 0.14, 10, 22), rubber, 0, 0, 0, spare);
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 14).rotateX(Math.PI / 2), M.rimMat, 0, 0, 0, spare);
    for (const side of [-1, 1]) {
      T([side * 0.55, y0 + 0.2, -1.2], [side * 0.9, y0 - 0.1, -1.55], 0.05, accent);
      T([side * 0.55, y0 + 0.2, -1.9], [side * 0.9, y0 - 0.1, -1.55], 0.05, accent);
      // 캐빈 뒤 롤바 → 짐칸 뒤로
      T([side * 0.75, y0 + 0.66, -0.7], [side * 0.7, y0 + 1.08, -1.2], 0.04, trim, spoiler);
      T([side * 0.7, y0 + 1.08, -1.2], [side * 0.75, y0 + 0.66, -2.45], 0.04, trim, spoiler);
    }
    add(new THREE.BoxGeometry(1.6, 0.05, 0.36), paint, 0, y0 + 1.12, -1.25, spoiler);
    drs = add(new THREE.BoxGeometry(1.6, 0.035, 0.16), accent, 0, y0 + 1.18, -1.42, spoiler);
  } else {
    // 픽업: 차체색 펜더, 크롬 그릴·범퍼, 둥근 헤드라이트, 짐칸 나무 상자, 캐빈 뒤 롤바(조명 2개)
    arches(add, M, W, 0.03, 0.12, 0.12);
    add(new THREE.BoxGeometry(1.0, 0.28, 0.05), metal, 0, y0 + 0.3, 2.62, fWing);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.96, 0.025, 0.06), dark, 0, y0 + 0.2 + i * 0.07, 2.64, fWing).castShadow = false;
    add(new THREE.BoxGeometry(1.75, 0.12, 0.12), metal, 0, y0 + 0.02, 2.66, fWing);
    add(new THREE.BoxGeometry(1.75, 0.12, 0.12), metal, 0, y0 + 0.08, -2.62);
    for (const side of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16).rotateX(Math.PI / 2), metal, side * 0.66, y0 + 0.32, 2.6);
      add(new THREE.CircleGeometry(0.085, 16), lamp, side * 0.66, y0 + 0.32, 2.635).castShadow = false;
    }
    const wood = new THREE.MeshStandardMaterial({ color: '#a8743f', roughness: 0.8 });
    add(new THREE.BoxGeometry(0.6, 0.4, 0.55), wood, -0.4, y0 + 0.43, -1.25);
    add(new THREE.BoxGeometry(0.55, 0.3, 0.5), wood, 0.35, y0 + 0.38, -1.95);
    add(new THREE.BoxGeometry(0.5, 0.25, 0.45), wood, -0.35, y0 + 0.75, -1.3).rotation.y = 0.3;
    for (const side of [-1, 1]) T([side * 0.82, y0 + 0.62, -0.78], [side * 0.82, y0 + 1.2, -0.78], 0.04, metal, spoiler);
    add(new THREE.BoxGeometry(1.68, 0.06, 0.08), metal, 0, y0 + 1.2, -0.78, spoiler);
    drs = add(new THREE.BoxGeometry(1.2, 0.035, 0.14), paint, 0, y0 + 1.24, -0.86, spoiler);
    for (const x of [-0.4, 0.4]) add(new THREE.CircleGeometry(0.07, 14).rotateY(Math.PI), lamp, x, y0 + 1.2, -0.83, spoiler).castShadow = false;
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
      vents: [[0.42, y0 + 0.57, 1.6], [0.42, y0 + 0.58, 1.35], [0.42, y0 + 0.59, 1.1]],
      glow: { y: y0 + 0.58, z: 1.8, len: 1.1, rot: 0.08, w: 0.06 },
      flames: [[-0.6, y0 + 0.06, 0.5, -2.65], [0.6, y0 + 0.06, 0.5, -2.65]],
      motor: [0.42, y0 + 0.1, -2.6],
      spark: [wx, 0.3, -2.0],
      seams: [0.86, y0 - 0.05, 0.0],
      lean: pickup ? 0.1 : 0.12,
      drsRest: 0.2,
    },
  };
}

// ------------------------------------------------------------------ 전기 콘셉트카: 물방울 모양 한 덩어리, 덮인 뒷바퀴, 앞뒤 빛나는 라이트 바, 떠 있는 칼날 날개
function buildEV({ add, body, M, look }) {
  const { paint, accent, trim, carbon, dark, glass, tailMat } = M;
  const neon = glowMat(look.accent, 1.6);
  const W = [
    [-0.88, 1.65, true, 0.36, 0.3, 0.4],
    [0.88, 1.65, true, 0.36, 0.3, 0.4],
    [-0.9, -1.55, false, 0.37, 0.34, 0.4],
    [0.9, -1.55, false, 0.37, 0.34, 0.4],
  ];
  add(loft([R(2.85, 0.5, 0.22, 0.42, 3), R(2.5, 0.85, 0.18, 0.55, 3), R(1.6, 0.98, 0.18, 0.62, 3), R(0.4, 1.0, 0.2, 0.66, 3), R(-1.0, 0.98, 0.22, 0.68, 3), R(-2.0, 0.9, 0.24, 0.66, 3), R(-2.6, 0.62, 0.3, 0.56, 3), R(-2.75, 0.4, 0.36, 0.5, 3)], 28), paint, 0, 0, 0);
  arches(add, M, W.slice(0, 2), 0.03, 0.1, 0.06);
  // 뒷바퀴 덮개 (스커트) + 빛나는 줄
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.05, 0.3, 0.95), paint, side * 0.985, 0.54, -1.55);
    add(new THREE.BoxGeometry(0.02, 0.02, 3.6), neon, side * 0.99, 0.25, 0.0).castShadow = false;
  }
  // 물방울 캐노피 (유리 한 장)
  add(loft([R(1.5, 0.3, 0.6, 0.64, 3), R(0.9, 0.6, 0.62, 1.0, 3), R(0, 0.66, 0.64, 1.15, 3), R(-1.0, 0.6, 0.66, 1.08, 3), R(-2.0, 0.4, 0.64, 0.86, 3), R(-2.5, 0.2, 0.6, 0.7, 3)], 24), glass, 0, 0, 0);
  // 지붕 가운데 빛나는 줄 + 충전구
  add(new THREE.BoxGeometry(0.04, 0.012, 2.6), neon, 0, 1.153, -0.4).castShadow = false;
  add(new THREE.CircleGeometry(0.05, 14).rotateY(Math.PI / 2), neon, 0.99, 0.5, 1.1).castShadow = false;
  // 앞뒤 라이트 바
  add(new THREE.BoxGeometry(1.5, 0.03, 0.04), neon, 0, 0.47, 2.66).castShadow = false;
  add(new THREE.BoxGeometry(1.1, 0.03, 0.04), tailMat, 0, 0.52, -2.74);
  add(new THREE.BoxGeometry(1.15, 0.01, 0.045), neon, 0, 0.555, -2.74).castShadow = false;
  // 아래 검은 띠 (디퓨저 느낌) + 앞 공기 구멍
  add(new THREE.BoxGeometry(1.3, 0.03, 0.5), carbon, 0, 0.22, -2.4).rotation.x = 0.35;
  add(new THREE.BoxGeometry(0.9, 0.06, 0.03), dark, 0, 0.3, 2.7);
  doorNumber(add, M, 0.995, 0.42, 0.1, 0.28);
  // 앞 스플리터 (얇은 칼날)
  const fWing = new THREE.Group();
  body.add(fWing);
  add(new THREE.BoxGeometry(1.7, 0.025, 0.28), carbon, 0, 0.16, 2.7, fWing);
  add(new THREE.BoxGeometry(1.7, 0.01, 0.03), neon, 0, 0.175, 2.84, fWing).castShadow = false;
  // 떠 있는 칼날 뒷날개 (빛나는 기둥 2개)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(new THREE.BoxGeometry(1.75, 0.035, 0.3), paint, 0, 0.98, -2.42, spoiler);
  const drs = add(new THREE.BoxGeometry(1.75, 0.025, 0.14), accent, 0, 1.02, -2.56, spoiler);
  drs.rotation.x = 0.3;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.03, 0.34, 0.08), neon, side * 0.5, 0.82, -2.38, spoiler);
    add(new THREE.BoxGeometry(0.03, 0.12, 0.34), trim, side * 0.875, 0.98, -2.44, spoiler);
  }
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0, 0.92, -0.2);
  return {
    helmet, fWing, spoiler, drs,
    A: {
      wheels: W,
      tuck: { f: [0.8, 0.5], r: [0.84, 0.56] },
      helmet: [0, 0.92, -0.2],
      visor: [1.08, -0.7],
      armor: { y: 0.66, x: 0.92 },
      ram: { y: 0.08, z: 1.85 },
      spines: [[-0.7, 1.12], [-1.1, 1.08], [-1.5, 1.0], [-1.9, 0.9]],
      booster: { x: 0.45, y0: 0.5, y1: 0.92, z0: -0.6, dz: -1.25 },
      lift: { y: 0.66, z: -2.35, h: 0.25 },
      stab: [0.88, 0.98, -2.44],
      tailFin: [0, 1.12, -0.9],
      wing: [0.92, 0.48, 0.0],
      nitro: { x: 0.3, y: 0.36, z: -2.62, dz: -0.42 },
      vents: [[0.6, 0.63, 1.55], [0.6, 0.645, 1.3], [0.6, 0.655, 1.05]],
      glow: { y: 0.6, z: 1.95, len: 1.2, rot: 0.12, w: 0.06 },
      flames: [[0, 0.42, 0.6, -2.82]],
      motor: [0.38, 0.36, -2.72],
      spark: [0.9, 0.25, -2.05],
      seams: [0.98, 0.18, -0.1],
      lean: 0.04,
      drsRest: 0.3,
    },
  };
}

const BUILDERS = { f1: buildF1, gt: buildGT, rally: buildRally, proto: buildProto, rocket: buildRocket, buggy: buildBuggy, hatch: buildHatch, muscle: buildMuscle, hyper: buildHyper, kart: buildKart, roadster: buildRoadster, truck: buildTruck, ev: buildEV };

/** 울퉁불퉁한 오프로드 타이어 돌기 (타이어 둘레에 엇갈린 블록) */
function knobGeometry(r, wd) {
  const parts = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    for (const s of [-1, 1]) {
      const a = (i / N) * Math.PI * 2 + (s > 0 ? Math.PI / N : 0);
      const g = new THREE.BoxGeometry(wd * 0.44, 0.06, 0.1).translate(s * wd * 0.24, r + 0.015, 0);
      g.rotateX(a);
      parts.push(g);
    }
  }
  return mergeGeos(parts);
}

export function createCarModel(lookOrColor = '#e8463a') {
  const look = normalizeLook(lookOrColor);
  const color = look.body;
  const root = new THREE.Group(); // 위치와 방향
  const body = new THREE.Group(); // 기울기 연출
  root.add(body);

  const baseColor = new THREE.Color(color);
  // 가속 모드 차체 빛: 어두운 차체(파랑 등)는 주황빛이 너무 세게 보이므로 밝기에 맞춰 줄임 (빨간 F1 = 1)
  const glowK = Math.min(1, Math.max(0.35, baseColor.getHSL({}).l / 0.56));
  const armorColor = new THREE.Color('#3a3f4a');
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.45, emissive: '#000000' });
  const accent = new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.3, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: look.trim, roughness: 0.35, metalness: 0.55 });
  const carbon = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.55, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#0b0c0f', roughness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#1a1b1f', roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: '#4a505c', roughness: 0.35, metalness: 0.85 });
  const glowGreen = new THREE.MeshStandardMaterial({ color: '#d9ffd0', emissive: '#7dff6a', emissiveIntensity: 1.2, roughness: 0.3 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: '#2b2f37', roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: '#1a2431', roughness: 0.06, metalness: 0.75, transparent: true, opacity: 0.8 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff1c8', emissiveIntensity: 1.4, roughness: 0.2 });
  const lampYellow = new THREE.MeshStandardMaterial({ color: '#fff3b0', emissive: '#ffd84a', emissiveIntensity: 1.5, roughness: 0.2 });
  const glowTrim = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.trim).lerp(new THREE.Color('#ffffff'), 0.35) });
  const helmetMat = new THREE.MeshStandardMaterial({ color: look.helmet, roughness: 0.25, metalness: 0.2 });
  const rimMat = new THREE.MeshStandardMaterial({ color: look.rim, metalness: 0.8, roughness: 0.35 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff1a1a', emissiveIntensity: 1.2 });
  const numTex = numberTexture(String(look.number ?? '7'), look.numberBg || '#f3f4f6', look.numberFg || '#14161b');
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.4 });
  const M = { paint, accent, trim, carbon, dark, rubber, metal, darkMetal, glowGreen, glass, lamp, lampYellow, glowTrim, helmetMat, rimMat, tailMat, numMat };

  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // ------------------------------------------------------------------ 차체 (차 종류마다 다름) + 변신 부품 자리(A)
  const shell = (BUILDERS[look.style] || buildF1)({ add, body, root, M, look });
  const { helmet, fWing, spoiler, drs } = shell;
  const A = { ...BASE_ANCHORS, ...shell.A };

  // ------------------------------------------------------------------ 비행 모드: 사이드포드에서 펼쳐지는 날개 (엔진, 항법등, 비행운은 아래에서 붙임)
  // 차체와 같은 도장(paint)으로 칠하고, 흰 앞전·흰 줄무늬·카본 뒷전으로 F1 차체 무늬(흰 노즈 줄, 카본 앞날개)와 맞춤
  const wingMat = paint;
  const wingEdge = accent;
  // 뒤로 젖혀진 제트기 날개 (두께가 있는 판)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.9);
  wingShape.lineTo(3.0, -0.35);
  wingShape.lineTo(3.25, -0.4);
  wingShape.lineTo(3.25, -0.75);
  wingShape.lineTo(0, -1.1);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: false }).rotateX(Math.PI / 2);
  // 날개 윗면 무늬: 앞전과 나란한 흰 줄, 뒷전을 따라 카본 플랩 (윗면 y=0 바로 위에 얇게)
  const band = (pts, y) => {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (const [x, z] of pts.slice(1)) sh.lineTo(x, z);
    return new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, y, 0);
  };
  const wingStripeGeo = band([[0.2, 0.52], [2.95, -0.63], [2.95, -0.75], [0.2, 0.4]], 0.014);
  const wingFlapGeo = band([[0, -0.9], [3.25, -0.6], [3.25, -0.75], [0, -1.1]], 0.012);
  const wings = [-1, 1].map((side) => {
    const pivot = new THREE.Group(); // 날개 뿌리 (rotation.z = 상반각)
    pivot.position.set(side * A.wing[0], A.wing[1], A.wing[2]);
    body.add(pivot);
    const wing = new THREE.Group(); // 펼쳐지는 부분 (scale.x)
    pivot.add(wing);
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.scale.x = side;
    w.castShadow = true;
    wing.add(w);
    // 흰 앞전 + 흰 줄무늬 + 카본 뒷전(플랩) + 카본 날개 끝 수직판
    w.add(new THREE.Mesh(rodGeometry(new THREE.Vector3(0.1, 0.0, 0.88), new THREE.Vector3(3.0, 0.0, -0.33), 0.045), wingEdge));
    w.add(new THREE.Mesh(wingStripeGeo, accent));
    w.add(new THREE.Mesh(wingFlapGeo, carbon));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.55), carbon);
    tip.position.set(3.23, 0.17, -0.52);
    w.add(tip);
    return { pivot, wing, side };
  });
  // 수평 꼬리날개: 뒷날개 끝판 바깥에 붙음 (스파이크 부스터 때 뒷날개와 함께 올라감) + 끝 수직판
  const stabShape = new THREE.Shape();
  stabShape.moveTo(0, 0.25);
  stabShape.lineTo(0.75, -0.12);
  stabShape.lineTo(0.75, -0.4);
  stabShape.lineTo(0, -0.3);
  const stabGeo = new THREE.ExtrudeGeometry(stabShape, { depth: 0.04, bevelEnabled: false }).rotateX(Math.PI / 2);
  const stabs = [-1, 1].map((side) => {
    const g = new THREE.Group();
    g.position.set(side * A.stab[0], A.stab[1], A.stab[2]);
    spoiler.add(g);
    const m = add(stabGeo, wingMat, 0, 0, 0, g);
    m.scale.x = side;
    add(new THREE.BoxGeometry(0.03, 0.34, 0.3), carbon, side * 0.75, 0.13, -0.26, g);
    return g;
  });
  // 샤크핀 위로 솟는 꼬리 날개
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.lineTo(-1.0, 0);
  tailShape.lineTo(-1.3, 0.85);
  tailShape.lineTo(-0.95, 0.85);
  const tailFin = new THREE.Group();
  tailFin.position.set(A.tailFin[0], A.tailFin[1], A.tailFin[2]);
  body.add(tailFin);
  add(new THREE.ExtrudeGeometry(tailShape, { depth: 0.05, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.025, 0, 0), wingMat, 0, 0, 0, tailFin);
  add(rodGeometry(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.85, -0.95), 0.035), wingEdge, 0, 0, 0, tailFin);
  for (const side of [-1, 1]) {
    // 꼬리날개 양면에 차 번호 (상어지느러미의 7과 같은 무늬)
    const plate = add(new THREE.PlaneGeometry(0.34, 0.34), numMat, side * 0.035, 0.42, -0.72, tailFin);
    plate.rotation.y = side * Math.PI / 2;
    plate.castShadow = false;
  }

  // ------------------------------------------------------------------ 부스터(스파이크 디자인) 부품 (평소엔 숨어 있음)
  // 장갑 캐노피: 엔진 커버에서 앞으로 미끄러져 나와 조종석을 덮음 + 초록 눈 슬릿
  const visor = new THREE.Group();
  body.add(visor);
  add(new THREE.BoxGeometry(0.8, 0.07, 1.05), metal, 0, 0, 0, visor);
  const visorFront = add(new THREE.BoxGeometry(0.8, 0.32, 0.07), metal, 0, -0.13, 0.5, visor);
  visorFront.rotation.x = -0.5;
  add(new THREE.BoxGeometry(0.56, 0.05, 0.04), glowGreen, 0, -0.08, 0.55, visor);

  // 옆 장갑판 (경첩이 위쪽, 밖으로 펼쳐짐)
  const sideArmor = [-1, 1].map((side) => {
    const hinge = new THREE.Group();
    hinge.position.set(side * (A.armor.x + 0.08), A.armor.y, 0.0);
    body.add(hinge);
    add(new THREE.BoxGeometry(0.1, 0.5, 1.6), metal, 0, -0.25, 0, hinge);
    add(new THREE.BoxGeometry(0.04, 0.05, 1.4), glowGreen, side * 0.06, -0.38, 0, hinge);
    return { hinge, side };
  });

  // 앞 충각 (쐐기): 노즈와 앞날개를 덮음
  const ramShape = new THREE.Shape();
  ramShape.moveTo(0, 0);
  ramShape.lineTo(1.0, 0.08);
  ramShape.lineTo(0, 0.62);
  const ramGeo = new THREE.ExtrudeGeometry(ramShape, { depth: 2.1, bevelEnabled: false })
    .translate(0, 0, -1.05)
    .rotateY(-Math.PI / 2); // 모양의 x(앞쪽) → 차의 +z
  const ram = add(ramGeo, metal, 0, A.ram.y, A.ram.z + 0.05);
  const ramEdge = add(new THREE.BoxGeometry(2.1, 0.05, 0.05), glowGreen, 0, A.ram.y + 0.08, A.ram.z + 1.05);

  // 등 가시 (에어박스부터 엔진 커버를 따라, 뒤로 살짝 누운 원뿔)
  const spineGeo = new THREE.ConeGeometry(0.15, 0.55, 6);
  const spines = A.spines.map(([z, y], i) => {
    const s = add(spineGeo, glowGreen, 0, y, z);
    s.userData = { y, i };
    return s;
  });

  // 엔진 부스터 2개: 사이드포드 속에 숨어 있다가 솟아올라 뒤로 밀려나고, 노즐이 늘어나며 초록 불꽃 점화
  const coreMat = new THREE.MeshBasicMaterial({ color: '#c8ffb8' });
  const boosterFlameMat = new THREE.MeshBasicMaterial({ color: SPIKE_FLAME, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const boosterFlameCore = new THREE.MeshBasicMaterial({ color: '#f2ffe8', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const BR = 0.17; // 부스터 반지름
  const boosters = [-1, 1].map((side) => {
    const g = new THREE.Group(); // 부스터 전체 (z = 0이 부스터 뒤끝)
    body.add(g);
    // 몸통 + 둥근 앞머리 + 흡입구
    add(new THREE.CylinderGeometry(BR, BR, 1.2, 16).rotateX(Math.PI / 2), metal, 0, 0, 0.6, g);
    add(new THREE.SphereGeometry(BR, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), metal, 0, 0, 1.2, g);
    add(new THREE.CylinderGeometry(BR * 0.55, BR * 0.55, 0.04, 12).rotateX(Math.PI / 2), dark, 0, 0, 1.2 + BR * 0.98, g);
    // 빛나는 띠 2줄 + 옆 받침대
    for (const z of [0.25, 0.85]) add(new THREE.TorusGeometry(BR + 0.005, 0.025, 6, 20), glowGreen, 0, 0, z, g);
    add(new THREE.BoxGeometry(0.16, 0.08, 0.8), darkMetal, -side * 0.12, -0.1, 0.6, g);
    // 위쪽 안정판 (뒤로 젖혀진 지느러미)
    const finS = new THREE.Shape();
    finS.moveTo(0, 0);
    finS.lineTo(-0.55, 0);
    finS.lineTo(-0.6, 0.32);
    finS.lineTo(-0.38, 0.32);
    add(new THREE.ExtrudeGeometry(finS, { depth: 0.03, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.015, BR - 0.02, 0.62), metal, 0, 0, 0, g);
    add(new THREE.BoxGeometry(0.05, 0.03, 0.22), glowGreen, 0, BR + 0.3, 0.13, g);
    // 노즐 (뒤로 늘어남): 종 모양 + 안쪽 빛
    const nozzle = new THREE.Group();
    g.add(nozzle);
    add(new THREE.CylinderGeometry(BR * 0.75, BR * 1.25, 0.34, 18, 1, true).rotateX(Math.PI / 2), darkMetal, 0, 0, -0.17, nozzle);
    add(new THREE.TorusGeometry(BR * 1.25, 0.022, 6, 20), glowGreen, 0, 0, -0.34, nozzle);
    const glow = add(new THREE.CircleGeometry(BR * 0.8, 16).rotateY(Math.PI), coreMat, 0, 0, -0.05, nozzle);
    glow.castShadow = false;
    // 불꽃 (바깥 초록 + 안쪽 흰빛)
    const flame = new THREE.Mesh(new THREE.ConeGeometry(BR * 1.05, 1.8, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.9), boosterFlameMat);
    const flameIn = new THREE.Mesh(new THREE.ConeGeometry(BR * 0.55, 1.0, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5), boosterFlameCore);
    flame.position.z = flameIn.position.z = -0.3;
    nozzle.add(flame, flameIn);
    return { g, nozzle, flame, flameIn, side };
  });
  // 뒷날개를 들어 올리는 유압 기둥 (부스터 불꽃이 지나갈 자리를 비켜 줌)
  const lifts = [-0.16, 0.16].map((x) => add(new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0), metal, x, A.lift.y, A.lift.z));

  // 바닥판 가장자리 빛나는 이음선
  const seams = [-1, 1].map((side) => add(new THREE.BoxGeometry(0.03, 0.04, 1.6), glowGreen, side * A.seams[0], A.seams[1], A.seams[2]));

  // ------------------------------------------------------------------ 가속 모드 부품 (평소엔 숨어 있음)
  const glowTex = glowTexture();
  const accelGlow = new THREE.MeshStandardMaterial({ color: '#ffd2b0', emissive: '#ff7a2e', emissiveIntensity: 1.4, roughness: 0.3 });
  const nitroOuter = new THREE.MeshBasicMaterial({ color: '#ff8a3a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const nitroCore = new THREE.MeshBasicMaterial({ color: '#bfe4ff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const nitroDisc = new THREE.MeshBasicMaterial({ color: '#e6f4ff' });
  // 사이드포드 위 통풍구 (아가미처럼 뒤로 누우며 솟음)
  const ventGeo = new THREE.BoxGeometry(0.3, 0.1, 0.05).translate(0, 0.05, 0);
  const vents = [];
  for (const side of [-1, 1]) {
    for (const [x, y, z] of A.vents) {
      const v = add(ventGeo, accelGlow, side * x, y, z);
      v.castShadow = false;
      vents.push(v);
    }
  }
  // 노즈 위 빛나는 줄 (흰 줄 위에 겹침)
  const glowStripe = add(new THREE.BoxGeometry(A.glow.w, 0.022, A.glow.len), accelGlow, 0, A.glow.y, A.glow.z);
  glowStripe.rotation.x = A.glow.rot;
  glowStripe.castShadow = false;
  // 니트로 배기관 2개: 사이드포드 끝에서 뒤로 미끄러져 나옴 (디퓨저와 뒷날개 아래 빔 사이, 스파이크 부스터보다 낮고 안쪽)
  const nitros = [-1, 1].map((side) => {
    const g = new THREE.Group();
    g.position.set(side * A.nitro.x, A.nitro.y, A.nitro.z);
    body.add(g);
    add(new THREE.CylinderGeometry(0.065, 0.075, 0.42, 12).rotateX(Math.PI / 2), darkMetal, 0, 0, 0, g);
    add(new THREE.TorusGeometry(0.075, 0.02, 6, 16), accelGlow, 0, 0, -0.21, g).castShadow = false;
    add(new THREE.CircleGeometry(0.055, 12).rotateY(Math.PI), nitroDisc, 0, 0, -0.19, g).castShadow = false;
    // 불꽃 (바깥 주황 + 안쪽 청백)
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1.3, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.65), nitroOuter);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.8, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.4), nitroCore);
    flame.position.z = core.position.z = -0.22;
    g.add(flame, core);
    return { g, flame, core };
  });
  // 바닥 언더글로우 (땅에 깔리는 주황 빛)
  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 5.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTex, color: '#ff7a2e', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  underglow.position.y = 0.035;
  root.add(underglow);

  // ------------------------------------------------------------------ 배 모드 부품 (평소엔 숨어 있음)
  // 선체: 모노코크보다 넓은 욕조 모양, 앞은 뾰족하게 들린 뱃머리. 위는 흰색, 아래는 빨간색, 가장자리에 파란 줄
  const hullWhite = new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.35, metalness: 0.1 });
  const hullRed = new THREE.MeshStandardMaterial({ color: '#d8322a', roughness: 0.45, metalness: 0.1 });
  const hullBlue = new THREE.MeshStandardMaterial({ color: '#1f6fd1', roughness: 0.4, metalness: 0.2 });
  const HULL = [
    { z: 3.02, w: 0.03, h: 0.05, y: 0.3 },
    { z: 2.75, w: 0.3, h: 0.13, y: 0.23 },
    { z: 2.3, w: 0.62, h: 0.18, y: 0.17 },
    { z: 1.6, w: 0.86, h: 0.21, y: 0.12 },
    { z: 0.6, w: 0.96, h: 0.22, y: 0.1 },
    { z: -1.1, w: 0.96, h: 0.22, y: 0.1 },
    { z: -2.0, w: 0.9, h: 0.2, y: 0.12 },
    { z: -2.32, w: 0.84, h: 0.18, y: 0.14 },
  ];
  const hull = new THREE.Group();
  body.add(hull);
  add(loft(HULL.map((s) => ({ ...s, n: 2.4 })), 24), hullWhite, 0, 0, 0, hull);
  add(loft(HULL.map((s) => ({ z: s.z, w: s.w + 0.012, h: s.h * 0.55, y: s.y - s.h * 0.5, n: 2.4 })), 24), hullRed, 0, 0, 0, hull);
  add(loft(HULL.map((s) => ({ z: s.z, w: s.w + 0.014, h: 0.02, y: s.y + s.h * 0.35, n: 2.4 })), 24), hullBlue, 0, 0, 0, hull).castShadow = false;

  // 선외기 2개: 선미(트랜섬) 뒤 경첩에 매달림. 경첩 회전(rotation.x)으로 들어 올리거나 물속에 내림
  const motorMat = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.4, metalness: 0.5 });
  const propMat = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.25, metalness: 0.9 });
  const bladeGeo = new THREE.BoxGeometry(0.035, 0.14, 0.07).translate(0, 0.085, 0);
  const motorGeos = {
    bracket: new THREE.BoxGeometry(0.12, 0.14, 0.16),
    cowl: new THREE.BoxGeometry(0.24, 0.3, 0.36),
    cap: new THREE.BoxGeometry(0.25, 0.06, 0.37),
    shaft: new THREE.CylinderGeometry(0.045, 0.045, 0.55, 8),
    plate: new THREE.BoxGeometry(0.22, 0.02, 0.26),
    gear: new THREE.CylinderGeometry(0.065, 0.055, 0.34, 10).rotateX(Math.PI / 2),
    hub: new THREE.ConeGeometry(0.05, 0.12, 8).rotateX(-Math.PI / 2),
  };
  const motors = [-1, 1].map((side) => {
    const g = new THREE.Group(); // 경첩 (선미에 붙는 점)
    g.position.set(side * A.motor[0], A.motor[1], A.motor[2]);
    body.add(g);
    add(motorGeos.bracket, metal, 0, 0, 0.06, g);
    add(motorGeos.cowl, motorMat, 0, 0.12, -0.12, g);
    add(motorGeos.cap, paint, 0, 0.29, -0.12, g);
    add(motorGeos.shaft, metal, 0, -0.27, -0.14, g);
    add(motorGeos.plate, metal, 0, -0.44, -0.16, g);
    add(motorGeos.gear, metal, 0, -0.55, -0.16, g);
    // 프로펠러 (z축으로 회전)
    const prop = new THREE.Group();
    prop.position.set(0, -0.55, -0.35);
    g.add(prop);
    add(motorGeos.hub, propMat, 0, 0, -0.03, prop);
    for (let i = 0; i < 3; i++) {
      const b = add(bladeGeo, propMat, 0, 0, 0, prop);
      b.rotation.order = 'ZYX'; // 날개를 먼저 비틀고 허브 둘레로 돌림
      b.rotation.set(0, 0.6, (i / 3) * Math.PI * 2);
    }
    return { g, prop };
  });

  // 물보라 (뱃머리 양옆) + 항적 (뒤에 남는 흰 물결)
  const sprayMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const sprays = [-1, 1].map((side) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 8, 1, true).translate(0, 0.45, 0), sprayMat);
    m.position.set(side * 0.7, 0.05, 2.0);
    m.rotation.set(-0.6, 0, -side * 0.9);
    body.add(m);
    return m;
  });
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 5).rotateX(-Math.PI / 2).translate(0, 0, -2.5),
    new THREE.MeshBasicMaterial({ map: glowTex, color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  wake.position.set(0, 0.06, -2.2);
  root.add(wake);

  // ------------------------------------------------------------------ 비행 모드: 제트 엔진, 항법등, 비행운 (날개 뿌리에 붙음)
  const jetOuter = new THREE.MeshBasicMaterial({ color: '#5fb4ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetCore = new THREE.MeshBasicMaterial({ color: '#eef8ff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetDisc = new THREE.MeshBasicMaterial({ color: '#cfeaff' });
  const navRed = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
  const navGreen = new THREE.MeshBasicMaterial({ color: '#2aff6a' });
  const strobeMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const trailMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetGeos = {
    body: new THREE.CylinderGeometry(0.17, 0.14, 0.9, 16).rotateX(Math.PI / 2), // 앞이 굵음
    lip: new THREE.TorusGeometry(0.17, 0.03, 6, 18),
    intake: new THREE.CircleGeometry(0.15, 14),
    blade: new THREE.BoxGeometry(0.03, 0.27, 0.02),
    nozzle: new THREE.CylinderGeometry(0.13, 0.1, 0.2, 14, 1, true).rotateX(Math.PI / 2),
    glow: new THREE.CircleGeometry(0.09, 12).rotateY(Math.PI),
    flame: new THREE.ConeGeometry(0.1, 1.4, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.7),
    core: new THREE.ConeGeometry(0.055, 0.9, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.45),
    pylon: new THREE.BoxGeometry(0.05, 0.14, 0.6),
    nav: new THREE.SphereGeometry(0.065, 8, 6),
    trail: new THREE.ConeGeometry(0.07, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5), // 끝이 앞(날개 끝), 뒤로 갈수록 넓어짐
  };
  for (const wg of wings) {
    // 날개 아래 제트 엔진 (z = 0이 엔진 가운데, 앞이 +z)
    const e = new THREE.Group();
    e.position.set(wg.side * 1.15, -0.26, -0.15);
    wg.pivot.add(e);
    add(jetGeos.body, paint, 0, 0, 0, e);
    add(jetGeos.lip, wingEdge, 0, 0, 0.45, e).castShadow = false;
    add(jetGeos.intake, dark, 0, 0, 0.44, e).castShadow = false;
    add(jetGeos.nozzle, darkMetal, 0, 0, -0.55, e);
    add(jetGeos.glow, jetDisc, 0, 0, -0.5, e).castShadow = false;
    add(jetGeos.pylon, carbon, 0, 0.2, 0.05, e);
    // 흡입구 안쪽 팬 (2개 막대가 엇갈려 날개 4장)
    const fan = new THREE.Group();
    fan.position.z = 0.42;
    e.add(fan);
    add(jetGeos.blade, propMat, 0, 0, 0, fan).castShadow = false;
    add(jetGeos.blade, propMat, 0, 0, 0, fan).rotation.z = Math.PI / 2;
    // 불꽃 (바깥 파랑 + 안쪽 흰빛)
    const flame = new THREE.Mesh(jetGeos.flame, jetOuter);
    const core = new THREE.Mesh(jetGeos.core, jetCore);
    flame.position.z = core.position.z = -0.62;
    e.add(flame, core);
    // 항법등: 왼쪽(+x) 빨강, 오른쪽(-x) 초록. 날개 끝 수직판 앞 위쪽
    const nav = new THREE.Mesh(jetGeos.nav, wg.side > 0 ? navRed : navGreen);
    nav.position.set(wg.side * 3.25, 0.36, -0.27);
    wg.pivot.add(nav);
    // 비행운: 날개 끝에서 뒤로 뻗는 흰 줄
    const trail = new THREE.Mesh(jetGeos.trail, trailMat);
    trail.position.set(wg.side * 3.27, 0.02, -0.75);
    wg.pivot.add(trail);
    Object.assign(wg, { engine: e, fan, flame, core, nav, trail });
  }
  // 꼬리 섬광등 (수직 꼬리날개 꼭대기)
  const strobe = add(jetGeos.nav, strobeMat, 0, 0.86, -1.24, tailFin);
  strobe.castShadow = false;

  // ------------------------------------------------------------------ 바퀴 + 서스펜션
  const WHEELS = A.wheels; // [x, z, 앞바퀴?, 반지름, 타이어 폭, 서스펜션 안쪽 x]
  const wallMat = look.wall ? new THREE.MeshStandardMaterial({ color: look.wall, roughness: 0.6 }) : null;
  // 위·아래 위시본 (A자 모양 막대 2쌍). 길이 1 기준으로 만들고 바퀴 위치에 맞춰 늘림
  const wishboneGeo = (() => {
    const parts = [];
    for (const y of [0.1, -0.1]) {
      parts.push(rodGeometry(new THREE.Vector3(0, y, 0.22), new THREE.Vector3(1, y * 0.6, 0), 0.02));
      parts.push(rodGeometry(new THREE.Vector3(0, y, -0.22), new THREE.Vector3(1, y * 0.6, 0), 0.02));
    }
    return mergeGeos(parts);
  })();
  const wheels = [];
  for (const [x, z, front, r, wd, inner] of WHEELS) {
    const side = Math.sign(x);
    const steer = new THREE.Group();
    steer.position.set(x, r, z);
    root.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);
    add(new THREE.CylinderGeometry(r, r, wd, 22).rotateZ(Math.PI / 2), rubber, 0, 0, 0, spin);
    // 오프로드 타이어: 둘레에 울퉁불퉁한 돌기
    if (look.tire === 'knobby') add(knobGeometry(r, wd), rubber, 0, 0, 0, spin);
    // 타이어 옆면 색 띠 + 휠
    if (wallMat)
      for (const s of [-1, 1]) {
        add(new THREE.TorusGeometry(r * 0.8, 0.018, 4, 26).rotateY(Math.PI / 2), wallMat, s * (wd / 2 + 0.002), 0, 0, spin).castShadow = false;
      }
    add(new THREE.CylinderGeometry(r * 0.62, r * 0.62, wd + 0.01, 16).rotateZ(Math.PI / 2), rimMat, 0, 0, 0, spin);
    const cover = add(new THREE.CylinderGeometry(r * 0.5, r * 0.5, wd + 0.02, 10).rotateZ(Math.PI / 2), carbon, 0, 0, 0, spin);
    cover.castShadow = false;
    // 회전이 보이도록 바퀴 커버에 흰 표시
    add(new THREE.BoxGeometry(wd + 0.03, r * 0.12, r * 0.6), accent, 0, r * 0.3, 0, spin).castShadow = false;
    // 평소 서스펜션 (검은 막대)
    const susp = new THREE.Mesh(wishboneGeo, carbon);
    susp.position.set(side * inner, r, z);
    susp.castShadow = true;
    root.add(susp);
    susp.scale.set(side * (Math.abs(x) - inner), 1, 1);
    wheels.push({ steer, spin, front, susp, side, ax: Math.abs(x), r, z, inner });
  }

  // ------------------------------------------------------------------ 효과
  // 드리프트 불꽃 (뒷바퀴 뒤)
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const sparks = [-1, 1].map((side) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), sparkMat);
    m.position.set(side * A.spark[0], A.spark[1], A.spark[2]);
    root.add(m);
    return m;
  });

  // 부스트 불꽃 (가운데 배기구). 부스터(스파이크)가 펼쳐지면 대신 엔진 부스터의 초록 불꽃이 남
  const flameMat = new THREE.MeshBasicMaterial({ color: BOOST_FLAME, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = A.flames.map(([x, y, s, z]) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.16 * s, 1.6 * s, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.8 * s), flameMat);
    m.position.set(x, y, z);
    body.add(m);
    return m;
  });

  // 변신 순간: 퍼지는 고리 + 빛기둥 + 튀는 파편
  const fxMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.12, 8, 32).rotateX(Math.PI / 2), fxMat());
  ring.position.y = 0.7;
  root.add(ring);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 8, 24, 1, true).translate(0, 4, 0), fxMat());
  root.add(pillar);
  const shardGeo = new THREE.TetrahedronGeometry(0.18);
  const shards = Array.from({ length: 22 }, () => {
    const m = new THREE.Mesh(shardGeo, fxMat());
    m.visible = false;
    m.userData.vel = new THREE.Vector3();
    root.add(m);
    return m;
  });
  // 모드 변신: 빛 띠가 앞에서 뒤로 차를 훑고 지나감 (부품이 하나씩 바뀌는 느낌, 번쩍임 없이)
  const sweepMat = fxMat();
  sweepMat.map = glowTexture(); // 가장자리가 부드럽게 사라지는 빛 (판유리처럼 보이지 않게)
  const sweep = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5).translate(0, 0.6, 0), sweepMat);
  sweep.visible = false;
  root.add(sweep);
  let sweepT = 1, clunkT = 1;
  function scan(c) {
    sweepT = 0;
    clunkT = 0;
    sweep.material.color.copy(c);
  }
  let fxT = 1;
  function burst(c) {
    fxT = 0;
    ring.material.color.copy(c);
    pillar.material.color.copy(c);
    for (const s of shards) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 6;
      s.position.set(0, 0.8, 0);
      s.userData.vel.set(Math.cos(a) * sp, 4 + Math.random() * 6, Math.sin(a) * sp);
      s.material.color.copy(c);
      s.visible = true;
    }
  }

  // ------------------------------------------------------------------ 상태
  let wheelAngle = 0;
  let lean = 0;
  let driftYaw = 0;
  let spikeP = 0; // 스파이크(부스터) 변신 진행도 0~1
  let lastForm = null;
  let accelP = 0; // 가속 모드 변신 진행도 0~1
  let boatP = 0; // 배 모드 변신 진행도 0~1
  let flyP = 0; // 비행 모드 변신 진행도 0~1
  let gearP = 0; // 착륙 장치 접힘 0~1 (날고 있을 때 1)
  let trailK = 0; // 비행운 세기 0~1
  let fanAngle = 0;
  let waterK = 0; // 물 위에 떠 있는 정도 (부드럽게 0~1)
  let propAngle = 0;
  let lastMode; // 첫 프레임엔 효과 없이 기억만
  const basis = new THREE.Matrix4();
  const xAxis = new THREE.Vector3();
  const qTarget = new THREE.Quaternion();
  const qDrift = new THREE.Quaternion();
  const qMode = new THREE.Quaternion();
  const eMode = new THREE.Euler();
  const Y = new THREE.Vector3(0, 1, 0);

  /** 가속 모드 진행도 p에 맞춰 부품 배치 (poseSpike 뒤에 불러야 함: body.position.y에 더함) */
  function poseAccel(p, time) {
    const sSquat = easeInOut(stage(p, 0.0, 0.4)); // 차체가 낮게 깔림
    const sVent = easeOutBack(stage(p, 0.0, 0.5)); // 통풍구 열림
    const sPipe = easeOutBack(stage(p, 0.2, 0.7)); // 배기관 미끄러져 나옴
    const sStripe = easeInOut(stage(p, 0.3, 0.8)); // 노즈 줄 빛남
    const sDrs = easeInOut(stage(p, 0.4, 0.9)); // DRS 열림
    const sGlow = stage(p, 0.6, 1.0); // 언더글로우

    body.position.y -= 0.045 * sSquat;
    for (const v of vents) {
      v.visible = sVent > 0.01;
      v.scale.set(1, Math.max(0.001, sVent), 1);
      v.rotation.x = -0.5 * sVent;
    }
    glowStripe.visible = sStripe > 0.01;
    glowStripe.scale.z = Math.max(0.001, sStripe);
    for (const n of nitros) {
      n.g.visible = sPipe > 0.01;
      n.g.position.z = A.nitro.z + A.nitro.dz * sPipe;
      n.g.scale.setScalar(0.5 + 0.5 * Math.max(0.001, sPipe));
    }
    drs.rotation.x = A.drsRest - 0.33 * sDrs;
    underglow.visible = sGlow > 0.01;
    underglow.material.opacity = sGlow * (0.5 + 0.12 * Math.sin(time * 7));
  }

  /** 배 모드 진행도 p에 맞춰 부품 배치. tilt: 선외기 각도 (0 근처=물속, 클수록 들어 올림) */
  /** 바퀴 접기 q: 0=평소, 1=수평으로 눕혀 차체 쪽으로 접어 올림 (배 모드, 비행 중 착륙 장치) */
  function poseWheels(q) {
    const sFold = easeInOut(stage(q, 0.0, 0.8)); // 바퀴가 수평으로 눕혀짐
    const sTuck = easeOutBack(stage(q, 0.18, 1.0)); // 차체 쪽으로 접혀 올라감
    for (const w of wheels) {
      // 앞바퀴는 좁은 노즈 옆으로, 뒷바퀴는 사이드포드 위로 비켜 접힘
      const tk = w.front ? A.tuck.f : A.tuck.r;
      const ax = THREE.MathUtils.lerp(w.ax, tk[0], sTuck);
      const y = THREE.MathUtils.lerp(w.r, tk[1], sTuck);
      w.steer.position.set(w.side * ax, y, w.z);
      w.steer.rotation.z = w.side * (Math.PI / 2) * sFold; // 아래쪽이 바깥으로 들리며 눕혀짐
      w.susp.position.y = y;
      w.susp.scale.x = w.side * (ax - w.inner);
    }
  }

  /** 비행 모드 진행도 p에 맞춰 부품 배치. air: 0=땅(날개 살짝 들림), 1=비행 중 */
  function poseFly(p, air) {
    const sWing = easeOutBack(stage(p, 0.0, 0.55)); // 날개 펼침
    const sTail = easeOutBack(stage(p, 0.25, 0.7)); // 수평 꼬리날개
    const sFin = easeOutBack(stage(p, 0.35, 0.8)); // 수직 꼬리날개
    const sEng = easeOutBack(stage(p, 0.45, 0.9)); // 제트 엔진
    for (const wg of wings) {
      wg.pivot.visible = sWing > 0.02;
      wg.wing.scale.set(Math.max(0.001, sWing), 1, 1);
      wg.pivot.rotation.z = wg.side * THREE.MathUtils.lerp(0.12, 0.04, air) * sWing; // 상반각
      wg.engine.visible = sEng > 0.01;
      wg.engine.position.x = wg.side * 1.15 * sWing;
      wg.engine.scale.setScalar(Math.max(0.001, sEng));
      wg.nav.position.x = wg.trail.position.x = wg.side * 3.25 * sWing;
      wg.nav.visible = sWing > 0.9;
    }
    for (const s of stabs) {
      s.visible = sTail > 0.01;
      s.scale.set(Math.max(0.001, sTail), 1, 1);
    }
    tailFin.visible = sFin > 0.02;
    tailFin.scale.set(1, Math.max(0.001, sFin), 1);
  }

  function poseBoat(p, transformingIn, tilt) {
    const sHull = easeOutBack(stage(p, 0.3, 0.75)); // 선체가 아래에서 솟음
    const sMotor = easeOutBack(stage(p, 0.5, 0.8)); // 선외기 나타남 (들린 채)
    const sDrop = easeInOut(stage(p, 0.7, 1.0)); // 선외기가 내려감
    // (바퀴 접기는 poseWheels에서)
    hull.visible = sHull > 0.01;
    hull.position.y = -0.3 * (1 - sHull);
    hull.scale.set(0.85 + 0.15 * sHull, Math.max(0.001, sHull), 0.9 + 0.1 * sHull);
    for (const m of motors) {
      m.g.visible = sMotor > 0.01;
      m.g.scale.setScalar(Math.max(0.001, sMotor));
      m.g.rotation.x = THREE.MathUtils.lerp(1.45, tilt, sDrop);
    }
    // 변신 중 차체가 살짝 들썩임 (변신할 때만)
    if (transformingIn) body.position.y += Math.sin(p * Math.PI) * 0.25;
  }

  // 처음엔 모드 부품을 숨겨 둠 (첫 sync 전)
  poseAccel(0, 0);
  poseBoat(0, false, 1.45);
  poseWheels(0);
  poseFly(0, 0);
  for (const wg of wings) wg.flame.visible = wg.core.visible = wg.trail.visible = false;
  for (const n of nitros) n.flame.visible = n.core.visible = false;
  for (const s of sprays) s.visible = false;
  wake.visible = false;
  // 부스터(스파이크) 부품·불꽃도 접어 둠 → sync 없이 홈 화면 미리보기로 써도 평소 모습
  poseSpike(0, false);
  for (const fl of flames) fl.visible = false;
  for (const sp of sparks) sp.visible = false;
  for (const bo of boosters) bo.flame.visible = bo.flameIn.visible = false;
  body.position.y = 0;

  /** 스파이크 변신 진행도 p에 맞춰 부품 배치 */
  function poseSpike(p, transformingIn) {
    const sCabin = easeInOut(stage(p, 0.0, 0.3));
    const sVisor = easeOutBack(stage(p, 0.12, 0.42));
    const sArmor = easeOutBack(stage(p, 0.2, 0.5));
    const sRise = easeOutBack(stage(p, 0.25, 0.6)); // 부스터가 솟아오름
    const sSlide = easeInOut(stage(p, 0.4, 0.7)); // 뒤로 밀려나 자리 잡음
    const sLift = easeOutBack(stage(p, 0.3, 0.6)); // 뒷날개 올라감
    const sNozzle = easeOutBack(stage(p, 0.6, 0.85)); // 노즐 늘어남
    const sRam = easeOutBack(stage(p, 0.5, 0.8));

    // 드라이버가 몸을 낮추고, 장갑 캐노피가 엔진 커버에서 앞으로 나와 덮음
    helmet.position.y = A.helmet[1] - 0.13 * sCabin;
    visor.visible = sVisor > 0.01;
    visor.position.set(0, A.visor[0] + 0.22 * sVisor, A.visor[1] + 0.62 * sVisor);
    visor.scale.set(1, Math.max(0.001, sVisor), Math.max(0.001, sVisor));

    // 옆 장갑판: 사이드포드 안쪽에서 밖으로 펼쳐짐
    for (const a of sideArmor) {
      a.hinge.visible = sArmor > 0.01;
      a.hinge.position.x = a.side * (A.armor.x + 0.2 * sArmor);
      a.hinge.rotation.z = a.side * 0.42 * sArmor;
      a.hinge.scale.set(1, Math.max(0.001, sArmor), 1);
    }

    // 앞 충각: 노즈 속에서 앞으로 미끄러져 나와 앞날개까지 덮음
    ram.visible = ramEdge.visible = sRam > 0.01;
    ram.position.z = A.ram.z + 0.8 * sRam;
    ramEdge.position.z = A.ram.z + 1.0 + 0.8 * sRam;
    ram.scale.set(1, Math.max(0.001, sRam), 1);
    fWing.scale.set(1 - 0.15 * sRam, 1, 1);

    // 엔진 부스터: 사이드포드 속(작게)에서 솟아올라 뒤로 밀려나고, 노즐이 늘어남
    for (const bo of boosters) {
      const k = Math.max(0.001, sRise);
      bo.g.visible = sRise > 0.01;
      bo.g.scale.setScalar(0.35 + 0.65 * k);
      bo.g.position.set(bo.side * (A.booster.x + 0.12 * sRise), A.booster.y0 + (A.booster.y1 - A.booster.y0) * sRise, A.booster.z0 + A.booster.dz * sSlide);
      bo.nozzle.position.z = 0.12 - 0.12 * sNozzle;
      bo.nozzle.scale.set(1, 1, Math.max(0.001, sNozzle));
    }
    spoiler.position.y = A.lift.h * sLift;
    for (const l of lifts) {
      l.visible = sLift > 0.01;
      l.scale.y = Math.max(0.001, A.lift.h * sLift + 0.05);
    }

    // 등 가시: 앞에서부터 차례로 솟음
    for (const s of spines) {
      const k = easeOutBack(stage(p, 0.55 + s.userData.i * 0.08, 0.75 + s.userData.i * 0.08));
      s.visible = k > 0.01;
      s.scale.setScalar(Math.max(0.001, k));
      s.position.y = s.userData.y + 0.25 * k;
      s.rotation.x = -0.45;
    }

    for (const s of seams) s.visible = p > 0.05;
    glowGreen.emissiveIntensity = 0.8 + 0.6 * p;
    paint.color.copy(baseColor).lerp(armorColor, 0.15 * sArmor);

    // 변신 중 차체가 살짝 들썩임 (변신할 때만)
    body.position.y = transformingIn ? Math.sin(p * Math.PI) * 0.35 : 0;
  }

  let disposed = false;
  return {
    root,
    /** 이 차의 모습 설정 (style, 색 등) */
    look,
    /** 장면에서 빼고 지오메트리·재질·텍스처를 정리 (홈 화면에서 차를 바꿀 때) */
    dispose() {
      if (disposed) return;
      disposed = true;
      if (root.parent) root.parent.remove(root);
      const geos = new Set(), mats = new Set();
      root.traverse((o) => {
        if (o.geometry) geos.add(o.geometry);
        if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
      });
      for (const g of geos) g.dispose();
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    },
    /** 물리 상태(Car)를 보고 모양을 맞춥니다. dt=1이면 즉시 맞춤 */
    sync(car, dt, time) {
      const instant = dt >= 1;
      const mode = car.mode || 'normal';
      const sink = car.sink || 0;
      const spd = Math.abs(car.forwardSpeed);
      const thr = car.thr || 0;

      // --- 주행 모드 진행도: 가속 0.4초 / 0.3초, 배 0.5초 / 0.4초, 비행 0.5초 / 0.4초, 착륙 장치 0.45초 ---
      const accelOn = mode === 'accel';
      const boatOn = mode === 'boat';
      const flyOn = mode === 'fly';
      const gearUp = flyOn && !!car.flying;
      if (instant) {
        accelP = accelOn ? 1 : 0;
        boatP = boatOn ? 1 : 0;
        flyP = flyOn ? 1 : 0;
        gearP = gearUp ? 1 : 0;
      } else {
        // 변신이 눈에 보이게 천천히 (가속 0.75초 / 풀기 0.5초, 배 0.7 / 0.5, 비행 0.6 / 0.45)
        accelP = clamp01(accelP + (accelOn ? dt / 0.75 : -dt / 0.5));
        boatP = clamp01(boatP + (boatOn ? dt / 0.7 : -dt / 0.5));
        flyP = clamp01(flyP + (flyOn ? dt / 0.6 : -dt / 0.45));
        gearP = clamp01(gearP + (gearUp ? dt / 0.45 : -dt / 0.45));
      }
      // 바퀴 접힘: 배 모드(변신 앞부분에서 접힘)와 비행 중 착륙 장치 중 큰 쪽
      const wheelQ = Math.max(clamp01(boatP / 0.55), gearP);
      const onWater = car.grounded && car.surface === 'water' ? 1 : 0;
      waterK = instant ? onWater : THREE.MathUtils.lerp(waterK, onWater, 1 - Math.exp(-5 * dt));

      // 물 위의 배: 출렁임 + 속도가 붙으면 뱃머리가 들리고 물 위로 솟음(플레이닝)
      // 땅 위의 배: 선체 바닥이 땅에 닿도록 조금 들어 올림
      // 가라앉는 차: 기수를 숙이며 물속으로
      const float = boatP * waterK;
      const plane = Math.min(1, spd / 30);
      const calm = 1 - 0.6 * plane;
      const heave = (Math.sin(time * 2.1) * 0.035 + Math.sin(time * 3.4 + 1.3) * 0.018) * calm + 0.07 * plane;
      const modePitch = float * (Math.sin(time * 1.7 + 0.4) * 0.025 * calm - 0.075 * plane) + sink * 0.28;
      const modeRoll = float * (Math.sin(time * 1.3) * 0.035 + Math.sin(time * 2.3 + 2.0) * 0.012) * calm;
      const offY = float * heave + boatP * (1 - waterK) * 0.13 - 1.4 * sink;
      root.position.copy(car.pos).addScaledVector(car.up, offY);

      // 차의 up/fwd로 방향 결정 (벽, 천장에서도 그대로)
      xAxis.crossVectors(car.up, car.fwd).normalize();
      basis.makeBasis(xAxis, car.up, car.fwd);
      qTarget.setFromRotationMatrix(basis);
      driftYaw = THREE.MathUtils.lerp(driftYaw, car.drifting ? car.driftDir * -0.15 : 0, 1 - Math.exp(-8 * dt));
      qDrift.setFromAxisAngle(Y, driftYaw);
      qTarget.multiply(qDrift);
      // 바퀴(root에 붙음)도 같이 기울도록 모드 기울기는 root에 줌
      qMode.setFromEuler(eMode.set(modePitch, 0, modeRoll));
      qTarget.multiply(qMode);
      root.quaternion.slerp(qTarget, instant ? 1 : 1 - Math.exp(-25 * dt));

      // 코너에서 차체가 바깥으로 기울어짐 (F1은 낮고 단단해서 조금만), 공중에서는 속도 방향으로 기수가 움직임
      const targetLean = car.grounded ? car.steerVisual * Math.min(1, Math.abs(car.forwardSpeed) / 30) * A.lean * (car.drifting ? 1.8 : 1) : 0;
      lean = THREE.MathUtils.lerp(lean, targetLean, 1 - Math.exp(-6 * dt));
      body.rotation.z = -lean;
      // 땅에서는 무게 이동: 가속하면 앞이 들리고, 브레이크를 밟으면 앞이 숙여짐
      const pitch = car.grounded ? -car.load * 0.03 : THREE.MathUtils.clamp(-car.vel.dot(car.up) * 0.015, -0.3, 0.3);
      body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, pitch, 1 - Math.exp(-6 * dt));

      // 접힌 바퀴(배 모드, 비행 중)는 멈추고 조향도 풀림
      wheelAngle += (car.forwardSpeed / 0.4) * dt * (1 - wheelQ);
      poseWheels(wheelQ);
      for (const w of wheels) {
        w.spin.rotation.x = wheelAngle;
        if (w.front) w.steer.rotation.y = -car.steerVisual * 0.42 * (1 - wheelQ);
      }

      // --- 변신 ---
      if (car.form !== lastForm) {
        if (car.form) burst(FORM_COLORS[car.form]);
        lastForm = car.form;
      }
      if (mode !== lastMode) {
        if (lastMode !== undefined && MODE_COLORS[mode]) scan(MODE_COLORS[mode]);
        lastMode = mode;
      }
      // 부스터(스파이크): 0.45초 동안 펼쳐지고, 0.35초 동안 접힘
      // 부스터 중 E를 다시 눌러도 form은 그대로 'spike'라서 진행도는 1에 머묾 (애니메이션 재시작 없음)
      const spikeOn = car.form === 'spike';
      if (instant) spikeP = spikeOn ? 1 : 0;
      else spikeP = clamp01(spikeP + (spikeOn ? dt / 0.45 : -dt / 0.35));
      poseSpike(spikeP, spikeOn && spikeP < 1);
      // 비행 모드 (땅에선 날개가 살짝 들리고, 날면 펴짐)
      poseFly(flyP, gearP);
      // 주행 모드 (스파이크가 정한 body.position.y에 더함)
      poseAccel(accelP, time);
      // 선외기: 물 위에선 물속으로 내리고(살짝 트림), 땅이나 공중에선 들어 올림
      poseBoat(boatP, boatOn, THREE.MathUtils.lerp(1.25, 0.08, waterK));
      // 변신하는 동안 차체가 살짝 들렸다가 "철컥" 내려앉음 (흔들림 없이 한 번)
      if (clunkT < 1) {
        clunkT = Math.min(1, clunkT + dt / 0.7);
        body.position.y += 0.06 * Math.sin(Math.PI * clunkT) - 0.02 * Math.sin(Math.PI * stage(clunkT, 0.75, 1));
      }
      // 빛 띠: 노즈(+2.7)에서 꼬리(-2.5)까지 훑음
      if (sweepT < 1) {
        sweepT = Math.min(1, sweepT + dt / 0.6);
        sweep.visible = sweepT < 1;
        sweep.position.z = THREE.MathUtils.lerp(2.7, -2.5, easeInOut(sweepT));
        sweep.material.opacity = 0.7 * Math.sin(Math.PI * sweepT);
      }

      // 가속 모드는 차체에 주황빛이 맥박처럼, 비행 모드는 하늘색이 은은하게 (부스터는 초록 부품이 빛나므로 차체 색은 유지)
      if (accelP > 0) paint.emissive.copy(MODE_COLORS.accel).multiplyScalar(accelP * (0.05 + 0.03 * Math.sin(time * 10)) * glowK);
      else paint.emissive.setRGB(0, 0, 0);
      // 브레이크등 (밟으면 밝게), 아니면 비상등 깜빡임
      tailMat.emissiveIntensity = car.brk > 0.05 ? 3.2 : Math.sin(time * 12) > 0 ? 1.2 : 0.3;

      // 변신 순간 효과
      if (fxT < 1) {
        fxT = Math.min(1, fxT + dt * 1.6);
        ring.scale.setScalar(0.5 + fxT * 2.2);
        ring.material.opacity = 1 - fxT;
        pillar.scale.set(1 - fxT * 0.6, 0.3 + fxT * 1.2, 1 - fxT * 0.6);
        pillar.material.opacity = 0.22 * (1 - fxT) * (1 - fxT); // 예전 0.7 (효과 줄이기)
        for (const s of shards) {
          if (!s.visible) continue;
          s.userData.vel.y -= 18 * dt;
          s.position.addScaledVector(s.userData.vel, dt);
          s.rotation.x += 9 * dt;
          s.rotation.y += 7 * dt;
          s.material.opacity = 0.5 * (1 - fxT);
          if (fxT >= 1) s.visible = false;
        }
      } else {
        ring.material.opacity = 0;
        pillar.material.opacity = 0;
      }

      const showSpark = car.drifting && car.grounded;
      for (const sp of sparks) {
        sp.visible = showSpark;
        if (showSpark) {
          sp.material.color.setHex(DRIFT_COLORS[car.driftLevel]);
          sp.scale.setScalar(0.6 + car.driftLevel * 0.35 + Math.sin(time * 60 + sp.position.x) * 0.2);
        }
      }
      for (const fl of flames) {
        fl.visible = car.boostTime > 0 && spikeP < 0.6;
        if (fl.visible) fl.scale.set(1, 1, 0.8 + Math.random() * 0.6);
      }
      // 엔진 부스터 불꽃: 노즐이 다 나온 뒤 점화, 부스트 중엔 더 길게
      const lit = spikeP > 0.8;
      const fk = car.boostTime > 0 ? 1.5 : 0.9 + 0.25 * Math.min(1, Math.abs(car.forwardSpeed) / 40);
      for (const bo of boosters) {
        bo.flame.visible = bo.flameIn.visible = lit;
        if (!lit) continue;
        const flick = 0.85 + Math.random() * 0.3;
        bo.flame.scale.set(1, 1, fk * flick);
        bo.flameIn.scale.set(1, 1, fk * (0.9 + Math.random() * 0.2));
      }

      // 니트로 불꽃: 배기관이 다 나온 뒤 점화. 가속 페달과 속도에 비례해 길어지고, 부스트 중엔 더 길게
      const nitroLit = accelP > 0.75;
      const push = Math.max(0, thr);
      const nk = 0.3 + push * (0.5 + 1.0 * Math.min(1, spd / 57)) + (car.boostTime > 0 ? 0.6 : 0);
      accelGlow.emissiveIntensity = 1.2 + 1.2 * push * accelP;
      for (const n of nitros) {
        n.flame.visible = n.core.visible = nitroLit;
        if (!nitroLit) continue;
        const wide = 1 + 0.25 * push;
        n.flame.scale.set(wide, wide, nk * (0.85 + Math.random() * 0.3));
        n.core.scale.set(1, 1, nk * (0.9 + Math.random() * 0.2));
      }

      // 프로펠러: 공회전은 천천히, 가속 페달을 밟으면 빠르게 (후진이면 반대로)
      if (boatP > 0.5) propAngle += dt * (4 + 45 * Math.abs(thr)) * (thr < 0 ? -1 : 1);
      for (const m of motors) m.prop.rotation.z = propAngle;
      // 물보라와 항적: 물 위에서 달릴 때만
      const showSpray = float > 0.3 && spd > 4;
      sprayMat.opacity = 0.5 * float;
      for (const s of sprays) {
        s.visible = showSpray;
        if (showSpray) s.scale.setScalar((0.4 + 0.8 * plane) * (0.85 + Math.random() * 0.3));
      }
      const wakeK = float * Math.min(1, spd / 15 + push * 0.3);
      wake.visible = wakeK > 0.02;
      wake.material.opacity = 0.55 * wakeK;
      wake.scale.set(1 + 0.3 * plane, 1, 0.5 + plane);

      // 제트 엔진: 엔진이 다 나온 뒤 점화. 가속 페달에 비례해 길어지고, 부스트 중엔 더 길게. 팬은 늘 돌고 페달을 밟으면 빨라짐
      const jetLit = flyP > 0.85;
      const jk = 0.35 + push * 1.3 + (car.boostTime > 0 ? 0.6 : 0);
      if (flyP > 0.5) fanAngle += dt * (12 + 70 * push);
      // 비행운: 날고 있을 때 16~60m/s 사이에서 점점 길고 진하게
      const trailTarget = car.flying && !car.grounded && flyP > 0.9 ? clamp01((spd - 16) / 44) : 0;
      trailK = instant ? trailTarget : THREE.MathUtils.lerp(trailK, trailTarget, 1 - Math.exp(-4 * dt));
      trailMat.opacity = 0.45 * trailK;
      // 항법등은 0.8초마다 깜빡, 꼬리 섬광등은 1.2초마다 두 번 번쩍
      const navK = (time * 1.25) % 1 < 0.55 ? 1 : 0.15;
      navRed.color.setRGB(navK, 0.06 * navK, 0.06 * navK);
      navGreen.color.setRGB(0.08 * navK, navK, 0.3 * navK);
      const ph = time % 1.2;
      strobeMat.color.setScalar(ph < 0.06 || (ph > 0.18 && ph < 0.24) ? 1 : 0.12);
      for (const wg of wings) {
        wg.fan.rotation.z = fanAngle;
        wg.flame.visible = wg.core.visible = jetLit;
        if (jetLit) {
          const wide = 1 + 0.2 * push;
          wg.flame.scale.set(wide, wide, jk * (0.85 + Math.random() * 0.3));
          wg.core.scale.set(1, 1, jk * (0.9 + Math.random() * 0.2));
        }
        wg.trail.visible = trailK > 0.02;
        if (wg.trail.visible) wg.trail.scale.set(1 + 1.5 * trailK, 1 + 1.5 * trailK, 2 + 12 * trailK);
      }
    },
    /** 테스트용: 스파이크 변신 진행도를 직접 지정 */
    debugPose(p) {
      spikeP = p;
      poseSpike(p, false);
    },
  };
}

/** 여러 지오메트리를 하나로 (서스펜션 막대 묶음용) */
function mergeGeos(geos) {
  const pos = [], nor = [], idx = [];
  let off = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const gi = g.index;
    for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + off);
    off += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}
