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
//   가속(accel): 1.05초 동안 덮개 열림 → 흡입구·노즐 전개 → 날개·디퓨저 확장 → 잠금
//     carBody_accel.js의 15스타일 장착표, 차체 하강·은은한 빛·짧은 파란 제트. 되돌아갈 때는 0.85초 역순.
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
import { buildWheel } from './carBody_wheels.js';
import { buildCockpit } from './carBody_cockpit.js';
import { applyCarLighting } from './carLighting.js';
import { buildF1 } from './carBody_f1.js';
import { buildGT } from './carBody_gt.js';
import { buildRally } from './carBody_rally.js';
import { buildProto } from './carBody_proto.js';
import { buildRocket } from './carBody_rocket.js';
import { buildBuggy } from './carBody_buggy.js';
import { buildHatch } from './carBody_hatch.js';
import { buildMuscle } from './carBody_muscle.js';
import { buildHyper } from './carBody_hyper.js';
import { buildKart } from './carBody_kart.js';
import { buildRoadster } from './carBody_roadster.js';
import { buildTruck } from './carBody_truck.js';
import { buildEV } from './carBody_ev.js';
import { buildWedge } from './carBody_wedge.js';
import { buildVan } from './carBody_van.js';
import { applyCostume, dressCar } from './carCostumes.js';
import { buildRacingBoat } from './carBody_boat.js';
import { buildAccelKit } from './carBody_accel.js';

const DRIFT_COLORS = [0xffffff, 0x4fc3ff, 0xff9a2e];
const FORM_COLORS = { spike: new THREE.Color('#7dff6a') };
const MODE_COLORS = {
  normal: new THREE.Color('#e8ecf2'),
  accel: new THREE.Color('#6acbff'),
  boat: new THREE.Color('#3fb8ff'),
  fly: new THREE.Color('#9ad8ff'),
};
const BOOST_FLAME = new THREE.Color('#ffb347');
const DRIFT_EXIT_GOLD = new THREE.Color('#ffd34a'); // 깔끔한 드리프트 탈출 (품질 높음)
const DRIFT_EXIT_BLUE = new THREE.Color('#7fd8ff'); // 깔끔한 드리프트 탈출
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
export function loft(sections, M = 12) {
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
export function rodGeometry(a, b, t = 0.035) {
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
  wedge: { style: 'wedge', body: '#c81e3a', accent: '#111317', trim: '#ffb21a', rim: '#d9dde3', wall: null, helmet: '#ffb21a', number: '88', numberBg: '#111317', numberFg: '#ffb21a' },
  van: { style: 'van', body: '#37b6c9', accent: '#fff6e0', trim: '#ff8a3c', rim: '#fff6e0', wall: '#fff6e0', helmet: '#ff8a3c', number: '12', numberBg: '#fff6e0', numberFg: '#37b6c9' },
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
export const R = (z, w, yb, yt, n = 5, x = 0) => ({ z, w, h: (yt - yb) / 2, y: (yb + yt) / 2, n, x });

/** 바퀴를 덮는 휠 아치 (반원 고리를 옆으로 늘린 것). 차 x 방향 폭 width, 바퀴 중심이 원점 */
export function archGeo(rIn, rOut, width, a0 = -0.1) {
  const s = new THREE.Shape();
  const a1 = Math.PI - a0;
  s.absarc(0, 0, rOut, a0, a1, false);
  s.absarc(0, 0, rIn, a1, a0, true);
  return new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 8 })
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
// buildF1 → carBody_f1.js

/** 드라이버 헬멧 (모든 차 같음, 색만 다름) */
export function makeHelmet(add, body, M) {
  const helmet = new THREE.Group();
  body.add(helmet);
  add(new THREE.SphereGeometry(0.17, 12, 8), M.helmetMat, 0, 0, 0, helmet);
  const visorBand = add(new THREE.SphereGeometry(0.172, 12, 4, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.38, Math.PI * 0.16), M.dark, 0, 0, 0, helmet);
  visorBand.castShadow = false;
  add(new THREE.BoxGeometry(0.02, 0.02, 0.3), M.accent, 0, 0.165, -0.02, helmet);
  return helmet;
}

/** 지붕 있는 차의 공통 부품: 휠 아치, 백미러, 문 번호판 */
export function arches(add, M, wheels, inMargin, outMargin, extraW = 0.12, mat = M.paint) {
  for (const [x, z, , r, wd] of wheels) {
    const a = add(archGeo(r + inMargin, r + outMargin, wd + extraW), mat, x, r, z);
    a.castShadow = true;
  }
}
export function doorNumber(add, M, x, y, z, size = 0.46) {
  for (const side of [-1, 1]) {
    const p = add(new THREE.PlaneGeometry(size, size), M.numMat, side * x, y, z);
    p.rotation.y = side * Math.PI / 2;
    p.castShadow = false;
  }
}

// ------------------------------------------------------------------ GT (그랜드 투어러 / 머슬): 긴 보닛, 패스트백 지붕, 쌍줄 스트라이프, 덕테일 날개, 배기구 4개
// buildGT → carBody_gt.js

// ------------------------------------------------------------------ 랠리 (해치백): 짧고 높은 차체, 넓은 휠 아치, 지붕 공기구멍, 앞 보조등 4개, 머드플랩
// buildRally → carBody_rally.js

// ------------------------------------------------------------------ 프로토 (르망 프로토타입): 아주 낮은 차체, 둥근 캐노피, 바퀴를 덮는 펜더, 샤크핀, 백조목 뒷날개
// buildProto → carBody_proto.js

// ------------------------------------------------------------------ 로켓 (드래그스터 + 로켓 엔진): 바늘 같은 긴 노즈, 아주 작은 앞바퀴, 거대한 뒷바퀴, 등 위 로켓, 높은 뒷날개
// buildRocket → carBody_rocket.js

// ------------------------------------------------------------------ 버기 (모래 버기): 드러난 쇠파이프 롤케이지, 울퉁불퉁 큰 타이어, 긴 서스펜션, 지붕 조명, 예비 타이어
// buildBuggy → carBody_buggy.js

// ================================================================== 새 차체 7종 (2026-11-10: 차 등급 15대용)
//   hatch(핫해치) / muscle(머슬카) / hyper(하이퍼카) / kart(카트) / roadster(옛날 로드스터) / truck(트로피 트럭·픽업, look.variant 'pickup') / ev(전기 콘셉트카)
//   다른 차와 똑같이 { helmet, fWing, spoiler, drs, A(변신 부품 자리) }를 돌려줌 → 가속·배·비행·부스터 변신이 모두 그대로 붙음

/** 빛나는 재질 (전기차 라이트 바, 하이퍼카 포인트 줄) */
export function glowMat(color, k = 1.3) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.3 });
}

// ------------------------------------------------------------------ 핫해치: 짧고 통통한 5도어, 투톤 지붕, 벌집 그릴 + 빨간 줄, 지붕 스포일러, 가운데 쌍 배기구
// buildHatch → carBody_hatch.js

// ------------------------------------------------------------------ 머슬카: 긴 보닛을 뚫고 나온 슈퍼차저(블로워), 패스트백, 넓은 뒤 펜더, 금색 쌍줄, 사이드 배기관, 덕테일
// buildMuscle → carBody_muscle.js

// ------------------------------------------------------------------ 하이퍼카: 아주 낮은 쐐기, 물방울 캐노피, 옆 큰 흡입구, 엔진 덮개 루버, 빛나는 포인트 줄, 높은 백조목 날개, 가운데 배기구 3개
// buildHyper → carBody_hyper.js

// ------------------------------------------------------------------ 카트: 쇠파이프 틀, 앞 페어링, 옆 범퍼, 운전석이 그대로 보임(핸들·몸통), 오른쪽 뒤 엔진 + 배기관
// buildKart → carBody_kart.js

// ------------------------------------------------------------------ 레트로 로드스터: 둥근 펜더, 지붕 없는 운전석 + 작은 앞유리, 헤드레스트 혹, 크롬 범퍼, 동그란 등, 원형 번호판
// buildRoadster → carBody_roadster.js
/** 막대 하나 (로드스터 앞유리 틀 등) */
export function T3(add, mat, a, b, r = 0.02) {
  return add(rodGeometry(new THREE.Vector3(...a), new THREE.Vector3(...b), r), mat, 0, 0, 0);
}

// ------------------------------------------------------------------ 트럭: 높은 차체, 큰 바퀴, 캐빈 + 짐칸.
//   trophy(기본, 트로피 트럭): 검은 오버펜더, 지붕 조명 막대, 앞 불바, 짐칸 예비 타이어, 드러난 뒤 쇼크업소버
//   look.variant 'pickup' (팜 픽업): 크롬 그릴, 둥근 등, 짐칸에 나무 상자, 캐빈 뒤 롤바
// buildTruck → carBody_truck.js

// ------------------------------------------------------------------ 전기 콘셉트카: 물방울 모양 한 덩어리, 덮인 뒷바퀴, 앞뒤 빛나는 라이트 바, 떠 있는 칼날 날개
// buildEV → carBody_ev.js

// ------------------------------------------------------------------ 웨지 (2026-11-10 차고 추가): 종이접기처럼 각진 쐐기 슈퍼카. 낮고 뾰족한 코, 평평한 판, 뒤 창 덮개(루버), 높은 뒷날개, 앞 불빛 한 줄
// buildWedge → carBody_wedge.js

// ------------------------------------------------------------------ 큐브 밴 (2026-11-10 차고 추가): 네모난 꼬마 밴. 큰 창문, 다른 색 지붕, 지붕 짐칸, 동그란 눈 헤드라이트
// buildVan → carBody_van.js

const BUILDERS = { f1: buildF1, gt: buildGT, rally: buildRally, proto: buildProto, rocket: buildRocket, buggy: buildBuggy, hatch: buildHatch, muscle: buildMuscle, hyper: buildHyper, kart: buildKart, roadster: buildRoadster, truck: buildTruck, ev: buildEV, wedge: buildWedge, van: buildVan };

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
  const normalized = normalizeLook(lookOrColor);
  const look = normalized.costume ? applyCostume(normalized, normalized.costume) : normalized;
  const color = look.body;
  const root = new THREE.Group(); // 위치와 방향
  const body = new THREE.Group(); // 기울기 연출
  root.add(body);

  const baseColor = new THREE.Color(color);
  // 가속 모드 차체 빛: 어두운 차체(파랑 등)는 주황빛이 너무 세게 보이므로 밝기에 맞춰 줄임 (빨간 F1 = 1)
  const glowK = Math.min(1, Math.max(0.35, baseColor.getHSL({}).l / 0.56));
  const armorColor = new THREE.Color('#3a3f4a');
  const costumeWhite = new THREE.Color('#ffffff');
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.31, metalness: 0.24, clearcoat: 0.85, clearcoatRoughness: 0.22, emissive: '#000000' });
  const accent = new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.36, metalness: 0.12 });
  const trim = new THREE.MeshStandardMaterial({ color: look.trim, roughness: 0.35, metalness: 0.55 });
  const carbon = new THREE.MeshStandardMaterial({ color: '#20242b', roughness: 0.64, metalness: 0.12 });
  const dark = new THREE.MeshStandardMaterial({ color: '#0b0c0f', roughness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#1a1b1f', roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: '#a1a9b4', roughness: 0.38, metalness: 0.82 });
  const glowGreen = new THREE.MeshStandardMaterial({ color: '#d9ffd0', emissive: '#7dff6a', emissiveIntensity: 1.2, roughness: 0.3 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: '#2b2f37', roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#233d50', roughness: 0.16, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0.91, depthWrite: false });
  const lamp = new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff1c8', emissiveIntensity: 1.4, roughness: 0.2 });
  const lampYellow = new THREE.MeshStandardMaterial({ color: '#fff3b0', emissive: '#ffd84a', emissiveIntensity: 1.5, roughness: 0.2 });
  const glowTrim = new THREE.MeshBasicMaterial({ color: new THREE.Color(look.trim).lerp(new THREE.Color('#ffffff'), 0.35) });
  const helmetMat = new THREE.MeshStandardMaterial({ color: look.helmet, roughness: 0.25, metalness: 0.2 });
  const rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.rim).lerp(new THREE.Color('#aab2bd'), 0.16), metalness: 0.76, roughness: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff1a1a', emissiveIntensity: 1.2 });
  const numTex = numberTexture(String(look.number ?? '7'), look.numberBg || '#f3f4f6', look.numberFg || '#14161b');
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.4 });
  const M = { paint, accent, trim, carbon, dark, rubber, metal, darkMetal, glowGreen, glass, lamp, lampYellow, glowTrim, helmetMat, rimMat, tailMat, numMat };
  applyCarLighting(M);
  // 달리는 동안 값이 바뀌는 재질 (차체 빛·브레이크등·초록 빛) → 묶어 그리기에서 다른 재질과 섞지 않음 (staticBatch.js batchLocal, 렉 줄이기 2)
  for (const m of [paint, glowGreen, tailMat]) m.userData.live = true;

  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // ------------------------------------------------------------------ 차체 (차 종류마다 다름) + 변신 부품 자리(A)
  const shell = (BUILDERS[look.style] || buildF1)({ add, body, root, M, look });
  const shellMeshes = [];
  body.traverse(m => { if (m.isMesh && (m.material === paint || m.material === accent)) shellMeshes.push(m); });
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
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.045, bevelEnabled: false, steps: 1 }).rotateX(Math.PI / 2);
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
    add(new THREE.CylinderGeometry(BR, BR, 1.2, 8).rotateX(Math.PI / 2), metal, 0, 0, 0.6, g);
    add(new THREE.SphereGeometry(BR, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), metal, 0, 0, 1.2, g);
    add(new THREE.CylinderGeometry(BR * 0.55, BR * 0.55, 0.04, 8).rotateX(Math.PI / 2), dark, 0, 0, 1.2 + BR * 0.98, g);
    // 빛나는 띠 2줄 + 옆 받침대
    for (const z of [0.25, 0.85]) add(new THREE.TorusGeometry(BR + 0.005, 0.025, 3, 8), glowGreen, 0, 0, z, g);
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
    add(new THREE.CylinderGeometry(BR * 0.75, BR * 1.25, 0.34, 10, 1, true).rotateX(Math.PI / 2), darkMetal, 0, 0, -0.17, nozzle);
    add(new THREE.TorusGeometry(BR * 1.25, 0.022, 3, 8), glowGreen, 0, 0, -0.34, nozzle);
    const glow = add(new THREE.CircleGeometry(BR * 0.8, 10).rotateY(Math.PI), coreMat, 0, 0, -0.05, nozzle);
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
  const accelGlow = new THREE.MeshStandardMaterial({ color: '#bddfff', emissive: '#54baff', emissiveIntensity: 1.4, roughness: 0.3 });
  accelGlow.userData.live = true;
  const nitroOuter = new THREE.MeshBasicMaterial({ color: '#3f9eff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const nitroCore = new THREE.MeshBasicMaterial({ color: '#bfe4ff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const nitroDisc = new THREE.MeshBasicMaterial({ color: '#e6f4ff' });
  if (look.costume) { accelGlow.color.set(look.accent); accelGlow.emissive.set(look.trim); nitroOuter.color.set('#64bbff'); }
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
    if (['kart', 'buggy', 'van', 'rocket'].includes(look.style)) {
      add(new THREE.BoxGeometry(.035,.12,.28), carbon, 0,.09,.04,g);
      add(new THREE.BoxGeometry(.19,.025,.22), trim, 0,0,.08,g);
    }
    add(new THREE.CylinderGeometry(0.065, 0.075, 0.42, 12).rotateX(Math.PI / 2), darkMetal, 0, 0, 0, g);
    add(new THREE.TorusGeometry(0.075, 0.02, 4, 12), accelGlow, 0, 0, -0.21, g).castShadow = false;
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
    new THREE.MeshBasicMaterial({ map: glowTex, color: look.costume ? look.trim : '#63baff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  underglow.position.y = 0.035;
  root.add(underglow);

  // ------------------------------------------------------------------ 배 모드 부품 (평소엔 숨어 있음)
  // 차체 도장·카본 하부·원래 포인트 색을 이어받는 수륙양용 하부 패널.
  const hull = new THREE.Group();
  const HULL_FULL = [1, 1, 1, 0];
  body.add(hull);
  buildRacingBoat({ add, hull, M, look, A, loft });

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
  const sprayMat = new THREE.MeshBasicMaterial({ map: glowTex, side: THREE.DoubleSide, color: '#ffffff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const sprays = [-1, 1].map((side) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.2).translate(0, 0.4, 0), sprayMat);
    const bs = A.hull || HULL_FULL;
    m.position.set(side * .7 * bs[0], .05 * bs[1], 2 * bs[2] + (bs[3] || 0));
    m.rotation.set(-0.6, 0, -side * 0.9);
    m.userData.side = side;
    body.add(m);
    return m;
  });
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 5).rotateX(-Math.PI / 2).translate(0, 0, -2.5),
    new THREE.MeshBasicMaterial({ map: glowTex, color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  wake.position.set(0, .06, -2.2 * (A.hull?.[2] || 1) + (A.hull?.[3] || 0));
  root.add(wake);

  // ------------------------------------------------------------------ 비행 모드: 제트 엔진, 항법등, 비행운 (날개 뿌리에 붙음)
  const jetOuter = new THREE.MeshBasicMaterial({ color: '#5fb4ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetCore = new THREE.MeshBasicMaterial({ color: '#eef8ff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetDisc = new THREE.MeshBasicMaterial({ color: '#cfeaff' });
  if (look.costume) { jetOuter.color.set(look.trim); jetDisc.color.set(look.accent); }
  const navRed = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
  const navGreen = new THREE.MeshBasicMaterial({ color: '#2aff6a' });
  const strobeMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const m of [navRed, navGreen, strobeMat]) m.userData.live = true;
  const trailMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetGeos = {
    body: new THREE.CylinderGeometry(0.17, 0.14, 0.9, 8).rotateX(Math.PI / 2), // 앞이 굵음
    lip: new THREE.TorusGeometry(0.17, 0.03, 3, 8),
    intake: new THREE.CircleGeometry(0.15, 14),
    blade: new THREE.BoxGeometry(0.03, 0.27, 0.02),
    nozzle: new THREE.CylinderGeometry(0.13, 0.1, 0.2, 10, 1, true).rotateX(Math.PI / 2),
    glow: new THREE.CircleGeometry(0.09, 12).rotateY(Math.PI),
    flame: new THREE.ConeGeometry(0.1, 1.4, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.7),
    core: new THREE.ConeGeometry(0.055, 0.9, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.45),
    pylon: new THREE.BoxGeometry(0.05, 0.14, 0.6),
    nav: new THREE.SphereGeometry(0.065, 6, 4),
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
    buildWheel(add, spin, steer, M, look, r, wd, side);
    // 오프로드 타이어: 둘레에 울퉁불퉁한 돌기
    if (look.tire === 'knobby') add(knobGeometry(r, wd), rubber, 0, 0, 0, spin);
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
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.12, 4, 16).rotateX(Math.PI / 2), fxMat());
  ring.position.y = 0.7;
  root.add(ring);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 8, 12, 1, true).translate(0, 4, 0), fxMat());
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
  function scan(c, clunk = true) {
    sweepT = 0;
    if (clunk) clunkT = 0;
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
  let lean = 0, leanV = 0, pitchNow = 0, pitchV = 0, lastDriftT = null;
  let driftYaw = 0;
  let spikeP = 0; // 스파이크(부스터) 변신 진행도 0~1
  let lastForm = null;
  let accelP = 0; // 가속 모드 변신 진행도 0~1
  let drsP = 0; // DRS(진짜, src/drs.js의 car.drs) 뒷날개 윗판 열림 0~1 (2026-11-12)
  let boatP = 0; // 배 모드 변신 진행도 0~1
  let chopPh = 0, boatRoll = 0; // 배: 물결 타기 위상, 안쪽으로 눕는 정도 (2026-11-10)
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
    const sSquat = easeInOut(stage(p, 0.12, 0.9)); // 차체가 낮게 깔림
    const sVent = easeOutBack(stage(p, 0.20, 0.62)); // 통풍구 열림
    const sPipe = easeOutBack(stage(p, 0.35, 0.82)); // 배기관 미끄러져 나옴
    const sStripe = easeInOut(stage(p, 0.72, 1.0)); // 노즈 줄 빛남
    const sDrs = easeInOut(stage(p, 0.4, 0.9)); // DRS 열림
    const sGlow = stage(p, 0.6, 1.0); // 언더글로우

    body.position.y -= 0.065 * sSquat;
    accelKit.pose(p, Math.max(boatP, flyP, spikeP));
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
      const nozzleSize = ['kart','buggy','van'].includes(look.style) ? 2.25 : look.style === 'rocket' ? 1.9 : 1.45;
      const nozzleK = nozzleSize * (0.5 + 0.5 * Math.max(0.001, sPipe));
      n.g.scale.set(nozzleK, nozzleK, nozzleK * .72);
      n.g.position.x = Math.sign(n.g.position.x) * (A.nitro.x + (look.style === 'van' ? .58 : 0) * sPipe);
    }
    // 2026-11-12 drs: 가속 모드는 윗판을 조금만 (예전 0.33 → 0.1), 진짜 DRS(car.drs)는 크게 열림 → 뒤에서 보면 날개 틈이 확 벌어짐
    drs.rotation.x = A.drsRest - 0.1 * sDrs - (A.drsOpen ?? 1.2) * easeInOut(drsP);
    underglow.visible = sGlow > 0.01;
    underglow.material.opacity = sGlow * (0.18 + 0.025 * Math.sin(time * 3));
    if (costumeFx?.luxury && boatP < .1 && flyP < .1) {
      underglow.visible = true;
      underglow.material.opacity = Math.max(underglow.material.opacity, .065 + .015 * Math.sin(time * 1.3));
    }
  }

  /** 배 모드 진행도 p에 맞춰 부품 배치. tilt: 선외기 각도 (0 근처=물속, 클수록 들어 올림) */
  /** 바퀴 접기 q: 0=평소, 1=수평으로 눕혀 차체 쪽으로 접어 올림 (배 모드, 비행 중 착륙 장치) */
  function poseWheels(q, boat = 0) {
    const sFold = easeInOut(stage(q, 0.0, 0.8)); // 바퀴가 수평으로 눕혀짐
    const sTuck = easeOutBack(stage(q, 0.18, 1.0)); // 차체 쪽으로 접혀 올라감
    for (const w of wheels) {
      // 앞바퀴는 좁은 노즈 옆으로, 뒷바퀴는 사이드포드 위로 비켜 접힘
      const tk = w.front ? A.tuck.f : A.tuck.r;
      const stow = easeInOut(stage(boat, .18, .75));
      const ax = THREE.MathUtils.lerp(w.ax, THREE.MathUtils.lerp(tk[0], Math.min(.4, w.ax * .48), stow), sTuck);
      const y = THREE.MathUtils.lerp(w.r, THREE.MathUtils.lerp(tk[1], .28, stow), sTuck);
      w.steer.visible = boat < .76;
      w.susp.visible = boat < .68;
      w.steer.position.set(w.side * ax, y, w.z);
      w.steer.rotation.z = w.side * (Math.PI / 2) * sFold; // 아래쪽이 바깥으로 들리며 눕혀짐
      w.susp.position.y = y;
      w.susp.scale.x = w.side * (ax - w.inner);
    }
  }

  /** 비행 모드 진행도 p에 맞춰 부품 배치. air: 0=땅(날개 살짝 들림), 1=비행 중 */
  function poseFly(p, air) {
    if (shell.poseFly) shell.poseFly(p);
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
    const hs = A.hull || HULL_FULL; // 차마다 선체 크기 [폭, 높이, 길이, 앞뒤 이동]
    hull.position.z = hs[3] || 0;
    hull.scale.set((0.85 + 0.15 * sHull) * hs[0], Math.max(0.001, sHull) * hs[1], (0.9 + 0.1 * sHull) * hs[2]);
    for (const m of motors) {
      m.g.visible = sMotor > 0.01;
      m.g.scale.setScalar(Math.max(0.001, sMotor));
      m.g.rotation.x = THREE.MathUtils.lerp(1.45, tilt, sDrop);
    }
    // 변신 중 차체가 살짝 들썩임 (변신할 때만)
    if (transformingIn) body.position.y += Math.sin(p * Math.PI) * 0.25;
  }

  const costumeFx = dressCar({ root, body, A, shell, M, look, add, wheels, shellMeshes, loft });
  const accelKit = buildAccelKit({ body, spoiler, A, M, look, add, light: accelGlow });
  const cockpit = buildCockpit({ body, A, M, look, add });

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
    paint.color.copy(look.costume ? costumeWhite : baseColor).lerp(armorColor, 0.15 * sArmor);

    // 변신 중 차체가 살짝 들썩임 (변신할 때만)
    body.position.y = transformingIn ? Math.sin(p * Math.PI) * 0.35 : 0;
  }

  let disposed = false;
  return {
    root,
    /** 1인칭 시점용 (camViews.js, 2026-11-12): 부품 자리(A.helmet = 운전자 머리), 헬멧, 기울기 그룹 */
    fp: { A, helmet, body, eye: cockpit.eye, interior: cockpit.interior },
    /** 이 차의 모습 설정 (style, 색 등) */
    look,
    /** 장면에서 빼고 지오메트리·재질·텍스처를 정리 (홈 화면에서 차를 바꿀 때) */
    dispose() {
      if (disposed) return;
      disposed = true;
      accelKit.dispose();
      if (root.parent) root.parent.remove(root);
      const geos = new Set(), mats = new Set();
      root.traverse((o) => {
        if (o.geometry) geos.add(o.geometry);
        if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
      });
      for (const g of geos) g.dispose();
      const textures = new Set();
      for (const m of mats) {
        for (const key of ['map', 'roughnessMap', 'metalnessMap']) if (m[key]) textures.add(m[key]);
        m.dispose();
      }
      for (const texture of textures) texture.dispose();
    },
    /** 물리 상태(Car)를 보고 모양을 맞춥니다. dt=1이면 즉시 맞춤 */
    sync(car, dt, time) {
      const instant = dt >= 1;
      const mode = car.mode || 'normal';
      const sink = car.sink || 0;
      const spd = Math.abs(car.forwardSpeed);
      const thr = car.thr || 0;

      // --- 주행 모드 진행도 (외형만 변경, 자동 전환 속도는 Car가 결정) ---
      const accelOn = mode === 'accel';
      const boatOn = mode === 'boat';
      const flyOn = mode === 'fly';
      const gearUp = flyOn && !!car.flying;
      if (instant) {
        accelP = accelOn ? 1 : 0;
        drsP = (car.drs || 0) > 0.5 ? 1 : 0;
        boatP = boatOn ? 1 : 0;
        flyP = flyOn ? 1 : 0;
        gearP = gearUp ? 1 : 0;
      } else {
        // 순서 있는 기계 동작 (가속 1.05초 / 풀기 0.85초, 배·비행은 기존 시간)
        accelP = clamp01(accelP + (accelOn ? dt / 1.05 : -dt / 0.85));
        drsP = clamp01(drsP + ((car.drs || 0) > 0.5 ? dt / 0.2 : -dt / 0.15));
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
      // 물결 타기 (2026-11-10, 사용자 요청 "배가 심심해"): 빠를수록 선체가 물결 위에서 통 튀었다가 철썩 내려앉음 (뱃머리가 먼저 들림)
      //   + 도는 쪽으로 몸을 눕혀 돎 (자동차와 반대), 카빙(드리프트 키)이면 더 깊게
      const fast = clamp01((spd - 15) / 30);
      if (!instant) chopPh += dt * (2.0 + 2.8 * fast);
      const hop = float * Math.pow(Math.max(0, Math.sin(chopPh)), 3) * (0.04 + 0.17 * fast) * (0.65 + 0.35 * Math.sin(chopPh * 0.31 + 1.7));
      const cv = car.boatCarve || 0;
      const rollT = float * THREE.MathUtils.clamp(((car.yawRate || 0) * Math.min(spd, 40)) / 22, -1, 1) * (0.13 + 0.12 * cv);
      boatRoll = instant ? rollT : THREE.MathUtils.lerp(boatRoll, rollT, 1 - Math.exp(-5 * dt));
      const heave = (Math.sin(time * 2.1) * 0.035 + Math.sin(time * 3.4 + 1.3) * 0.018) * calm + 0.09 * plane + hop;
      const modePitch = float * (Math.sin(time * 1.7 + 0.4) * 0.025 * calm - 0.085 * plane - 0.55 * hop - 0.04 * (car.surgeT > 0 ? 1 : 0)) + sink * 0.28;
      const modeRoll = float * (Math.sin(time * 1.3) * 0.035 + Math.sin(time * 2.3 + 2.0) * 0.012) * calm + boatRoll;
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
      root.quaternion.slerp(qTarget, instant || car.renderSnap ? 1 : 1 - Math.exp(-25 * dt));

      // 무게 이동 (2026-11-10): 실제로 받는 옆 가속(car.latG)만큼 차체가 코너 바깥으로 기울고(롤),
      //   앞뒤 가속(car.lonG)만큼 브레이크 때 앞이 숙고(다이브) 가속 때 뒤가 주저앉음(스쿼트)
      //   크기 = 모양마다 A.lean / A.pitch (F1·카트는 단단해서 조금, 머슬카·트럭은 출렁) × 차마다 cfg.feel.roll / pitch
      //   스프링처럼 살짝 넘쳤다 돌아옴 (feel.bounce). latG가 없는 차(옛 스냅샷)는 핸들 기준
      const feel = (car.cfg && car.cfg.feel) || {};
      const hasG = typeof car.latG === 'number';
      const rollK = A.lean * (feel.roll ?? 1), pitchK = (A.pitch ?? A.lean * 0.7) * (feel.pitch ?? 1);
      const targetLean = !car.grounded || car.flying || float > 0.5 ? 0 // 물 위의 배는 위의 boatRoll로 안쪽으로 눕힘
        : hasG ? THREE.MathUtils.clamp(car.latG / 17, -1.4, 1.4) * rollK * (car.drifting ? 1.3 : 1)
        : car.steerVisual * Math.min(1, Math.abs(car.forwardSpeed) / 30) * A.lean * (car.drifting ? 1.8 : 1);
      const targetPitch = !car.grounded || car.flying ? THREE.MathUtils.clamp(-car.vel.dot(car.up) * 0.015, -0.3, 0.3)
        : hasG ? THREE.MathUtils.clamp(-car.lonG / 17, -1, 1.4) * pitchK
        : -car.load * 0.03;
      if (instant) (lean = targetLean), (pitchNow = targetPitch), (leanV = pitchV = 0);
      else {
        // 감쇠 스프링 (k: 단단함, c: 감쇠) → 브레이크를 놓으면 앞이 살짝 튀어 올랐다 가라앉음
        const kS = feel.spring ?? 90, cS = (feel.damp ?? 0.6) * 2 * Math.sqrt(kS);
        const h = Math.min(dt, 1 / 30);
        leanV += (kS * (targetLean - lean) - cS * leanV) * h;
        lean += leanV * h;
        pitchV += (kS * (targetPitch - pitchNow) - cS * pitchV) * h;
        pitchNow += pitchV * h;
      }
      body.rotation.z = -lean;
      body.rotation.x = pitchNow;

      // 접힌 바퀴(배 모드, 비행 중)는 멈추고 조향도 풀림
      wheelAngle += (car.forwardSpeed / 0.4) * dt * (1 - wheelQ);
      poseWheels(wheelQ, boatP);
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
      // 깔끔한 드리프트 탈출: 차체에 빛이 한 번 훑고 지나감 (품질이 높으면 금색)
      const di = car.lastDriftInfo;
      if (di && di.t !== lastDriftT) {
        if (di.clean && !instant) scan(di.quality > 0.75 ? DRIFT_EXIT_GOLD : DRIFT_EXIT_BLUE, false);
        lastDriftT = di.t;
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
      costumeFx?.update(time, boatP);
      poseBoat(boatP, boatOn, THREE.MathUtils.lerp(1.25, 0.08, waterK));
      // 변신하는 동안 차체가 살짝 들렸다가 "철컥" 내려앉음 (흔들림 없이 한 번)
      if (clunkT < 1) {
        clunkT = Math.min(1, clunkT + dt / (mode === 'accel' ? 1.05 : .7));
        body.position.y += 0.06 * Math.sin(Math.PI * clunkT) - 0.02 * Math.sin(Math.PI * stage(clunkT, 0.75, 1));
      }
      // 빛 띠: 노즈(+2.7)에서 꼬리(-2.5)까지 훑음
      if (sweepT < 1) {
        sweepT = Math.min(1, sweepT + dt / 0.6);
        sweep.visible = sweepT < 1;
        sweep.position.z = THREE.MathUtils.lerp(2.7, -2.5, easeInOut(sweepT));
        sweep.material.opacity = 0.7 * Math.sin(Math.PI * sweepT);
      }

      cockpit.wheel.rotation.z = -(car.steerVisual || 0) * 0.55;

      // 가속 모드는 차체에 주황빛이 맥박처럼, 비행 모드는 하늘색이 은은하게 (부스터는 초록 부품이 빛나므로 차체 색은 유지)
      if (accelP > 0) paint.emissive.copy(MODE_COLORS.accel).multiplyScalar(accelP * (0.014 + 0.004 * Math.sin(time * 3)) * glowK);
      else if (costumeFx?.luxury) paint.emissive.set('#000000');
      else paint.emissive.setRGB(0, 0, 0);
      // 평소에는 은은한 후미등, 브레이크를 밟으면 밝아진다.
      tailMat.emissiveIntensity = car.brk > 0.05 ? 2.6 : 0.65;

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
      const nitroLit = accelP > 0.86;
      const push = Math.max(0, thr);
      const nk = 0.3 + push * (0.5 + 1.0 * Math.min(1, spd / 57)) + (car.boostTime > 0 ? 0.6 : 0);
      accelGlow.emissiveIntensity *= .85 + .15 * push;
      for (const n of nitros) {
        n.flame.visible = n.core.visible = nitroLit;
        if (!nitroLit) continue;
        const wide = 1 + 0.25 * push;
        n.flame.scale.set(wide, wide, nk * .24 * (0.93 + Math.sin(time * 43) * .07));
        n.core.scale.set(1, 1, nk * .25 * (0.96 + Math.sin(time * 61) * .04));
      }

      // 프로펠러: 공회전은 천천히, 가속 페달을 밟으면 빠르게 (후진이면 반대로)
      if (boatP > 0.5) propAngle += dt * (4 + 45 * Math.abs(thr)) * (thr < 0 ? -1 : 1);
      for (const m of motors) m.prop.rotation.z = propAngle;
      // 물보라와 항적: 물 위에서 달릴 때만
      const showSpray = float > 0.3 && spd > 4;
      sprayMat.opacity = 0.5 * float;
      for (const s of sprays) {
        s.visible = showSpray;
        // 카빙하면 바깥쪽(도는 반대쪽) 물보라가 크게 솟음 (s.userData.side: +1 = 왼쪽)
        const outer = Math.sign(car.yawRate || 0) === s.userData.side ? 1 : 0.35;
        if (showSpray) s.scale.setScalar((0.4 + 0.8 * plane + 0.6 * cv * outer) * (0.85 + Math.random() * 0.3) * Math.min(1, A.hull?.[2] || 1));
      }
      const wakeK = float * Math.min(1, spd / 15 + push * 0.3);
      wake.visible = wakeK > 0.02;
      wake.material.opacity = 0.55 * wakeK;
      wake.scale.set((1 + .3 * plane) * (A.hull?.[0] || 1), 1, (.5 + plane) * (A.hull?.[2] || 1));

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
