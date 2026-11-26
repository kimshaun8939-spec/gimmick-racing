// AI 봇 운전사: 자기 차의 원래 물리 + 단계별 운전 실력. 견인·슬립스트림·DRS 조건은 사람과 공통.
//
//   조향 (땅): 원하는 회전 속도 = 라인 곡률×속도 + 방향 오차 + 옆 오차 → 이 차가 핸들 1로 도는 회전 속도로 나눔 (2026-11-10 hard2)
//   조향 (공중·비행·배): 앞 (6 + 속도×0.35) m 라인 점을 향하고, 조금 앞 라인의 곡률만큼 미리 꺾음 (.debug/lineLap.js와 같은 방법)
//   속도: 0.25초 앞 지점의 계획 속도 × 실력(pace). 넘으면 브레이크
//   추월: 앞차가 같은 줄에 있고 내가 더 빠르면 옆 줄(왼쪽/오른쪽 중 넓은 쪽)로 비켜서 지나감. 자리가 없으면 따라감
//   나란히: 얻은 줄은 지키되 상대 줄을 가로질러 밀어내지 않음
//   실수: 실수 동작 코드는 유지하지만 기본 단계에서는 의도적 실수를 끔 (접전 중 사고·복귀 줄이기).
//   부스터(E): 앞에 브레이크 구간이 없는 긴 직선에서 씀 (보통·어려움)
import * as THREE from 'three';
import { lineCarModel, STEER_OLD, steerLatCap, steerLatCapMax, steerLoadFor, latBase } from './car.js';
import { hitboxFor, obbOverlap } from './carHitbox.js';
import { createShortcutDriver } from './botShortcut.js'; // 그랑프리 판자 지름길 (2026-11-14)
import { learnedLineFor } from './learnedLine.js';
import { createPlanner, PL } from './botPlanner.js'; // planner (2026-11-26): 차 사이 판단 = 후보 길을 미리 달려 보고 고르기 (&planner=1) // [learned hook 1] 학습 라인 (2026-11-14, &learned=0 = 예전)

export const BOT_NAMES = ['레오', '미나', '카이', '루나', '준호', '사라', '토르', '하나', '제트', '노바'];

/** 실력 단계 (설정 botLevel) */
export const BOT_LEVELS = {
  // 실력 3단계 (2026-11-10 오후 'hard2' 다시 맞춤). 기준 = 진짜 사람 기록
  //   사용자(잘하는 사람) 블루 프로토: 그랑프리 1바퀴 184.0초, 달 2바퀴 134.7초 → 예전 어려움 봇(220초·166초)을 21초 차로 이김
  //   원인: 봇 조향 방식이 나빴음. 20 m 앞 점을 향해 꺾는 방식은 빠른 코너에서 핸들이 늦게 풀려 안쪽 잔디로 파고들었음
  //     (예전 라인 봇도 그랑프리 1바퀴 중 36초를 잔디 위에서 보냄). 그래서 '라인 봇 = 거의 완벽'이라는 예전 기준이 틀렸음
  //   → 조향을 '원하는 회전 속도' 방식으로 바꿈 (아래 controls의 조향). 같은 차·같은 계획으로 그랑프리 216.7 → 188.9초, 달 156.6 → 142.4초
  //   쉬움: 낮은 pace·topK·thrK로 천천히 달림 (사람 기준 늦추기는 &rb=1에서만)
  //   보통: 처음 하는 사람은 이기기 어려움 (예전 라인 봇과 비슷한 빠르기)
  //   어려움: 잘하는 사람과 비슷 (가장 빠른 봇이 사람 기록 ±2~3%)
  //   실측 (혼자 달림, 블루 프로토, 초): 그랑프리 쉬움 263 / 보통 219 / 어려움 187 (사람 184)
  //                                    달 2바퀴 쉬움 197 / 보통 168 / 어려움 141 (사람 134.7)
  //     예전: 그랑프리 266 / 235 / 220, 달 어려움 166
  //   8대 레이스, 사람 기록 흉내(.debug/hard2_test.js ghostRace): 그랑프리 사람 184초 → 어려움 1등 봇 185.5초 (4대가 190초 안)
  //     달 사람 134.7초 → 어려움 1등 봇 141~143초 (사람이 아직 4~6% 빠름: 무리 속 손해 + 사람이 계획보다 빠름)
  //     처음 하는 사람(예전 라인 봇 +13%, 그랑프리 245초) → 보통 봇 7대 모두 225~233초로 앞섬 / 265초 사람 → 쉬움 1등 봇 266초 (사람이 이김)
  //   다른 맵 (혼자, 어려움/보통/쉬움): 네온 f1 135/156/189 · 바닷가 gt 145/166/198 · 정글 proto 136/160/192 · 그랑프리 hatch 206/245/293
  // pace = 코너·브레이크 속도 배수(계획 속도 기준, 1.03 위로는 차 한계라 거의 안 빨라짐), topK = 직선 최고 속도 배수, thrK = 액셀 최대,
  // brakeK = 브레이크 시작 여유, lateP = 실수 중 '늦은 브레이크' 비율 (뒤엉켜 박기 쉬움), mistakeEvery = 실수 간격(초)
  // jumpK = 점프대 앞 속도 제한(44 m/s) 배수 (어려움은 1.3 = 57 m/s: 조향이 좋아져 착지 뒤 코너를 돎, 달 2바퀴 약 4초 빨라짐. 1.5는 무리에서 제니스 하이퍼가 첫 점프 뒤 t 0.23에서 가끔 밖으로)
  // firm = 옆 자리 지키기. 보통 이상은 사람/봇 모두 같은 판단.
  // playerPush = 플레이어와 부딪힐 때 플레이어가 받는 몫 (0.5 = 반반, 0.57 = 봇이 조금 무거운 것처럼)
  // catchUp = 따라잡기 효과 (raceSystem.js catchUp, 기준 = 가장 앞선 사람):
  //   쉬움 {aheadM, releaseM, slowMul}: 사람보다 aheadM m 넘게 앞선 봇은 slowMul배로 늦춤(코너·직선 모두), releaseM m 안으로 오면 원래대로. 빨라지게는 절대 안 함
  //   어려움 {sec, upMul, upDraft, downMul, secDown}: 사람이 sec초 넘게 앞서면 upMul배 + 보이지 않는 슬립스트림 upDraft(공기 저항 −30%×upDraft),
  //     봇이 secDown초 넘게 앞서면 downMul배
  //   보통: 없음
// fly = 그랑프리 비행 루트 (2026-11-10 bots-fly): speed = 공중 속도(m/s, 비행 최고 55), latK = 활주로로 꺾어 들어갈 때 옆 접지력 여유(낮을수록 일찍·많이 줄임),
//   wobble = 공중에서 핸들·높이 흔들림 (쉬움일수록 큼). 없으면 { speed: 42, latK: 0.85, wobble: 0 }
  easy: { pace: 0.69, topK: 0.71, thrK: 0.8, paceVar: 0.001, react: [0.45, 0.8], noise: 0.05, mistakeEvery: 1e9, lateP: 0.1, boost: 0.15, boostLook: 3.4, lead: 0.3, brakeK: 0.95, firm: 0.15, playerPush: 0.5, catchUp: { aheadM: 120, releaseM: 30, slowMul: 0.85 }, fly: { speed: 38, latK: 0.75, wobble: 0.08 } },
  normal: { pace: 0.85, topK: 0.87, thrK: 0.88, paceVar: 0.001, react: [0.28, 0.5], noise: 0.025, mistakeEvery: 1e9, boost: 0.6, boostLook: 3, lead: 0.26, brakeK: 0.95, firm: 1, playerPush: 0.5, fly: { speed: 44, latK: 0.8, wobble: 0.04 } },
  hard: { pace: 1.04, topK: 1, thrK: 1, paceVar: 0.001, react: [0.17, 0.3], noise: 0.012, mistakeEvery: 1e9, boost: 3, boostLook: 2.2, lead: 0.24, brakeK: 1, jumpK: 1.3, firm: 1, playerPush: 0.5, catchUp: { sec: 2.5, upMul: 1.03, upDraft: 0.6, downMul: 0.97, secDown: 5 }, fly: { speed: 50, flare: 2.6 } },
};

// 마스터(master, 2026-11-10 사용자 요청: 처음엔 "내 기록보다 빠르게" → 고침 "내 기록과 상관없이 그냥 어렵게, 이름은 마스터"):
//   기본은 자기 차의 원래 물리 + 더 적극적인 속도 계획. 아래 기존 물리 도움은 rb=1에서만 복원.
//   도움 h(0~1): 코너 속도 +paceMax·h, 타이어 접지(옆·앞뒤·브레이크)와 핸들 회전 +gripMax·h, 엔진 힘 +powerMax·h,
//     draftMax·h 보이지 않는 슬립스트림은 &rb=1에서만 (기본은 진짜 앞차 뒤 슬립스트림만)
//     + saturBrake: 핸들을 끝까지 꺾어도 모자라면 바로 속도를 줄임 (화산 T7·H1 출구에서 벽에 박혔던 것)
//   점프 근처(봇 st.calm)에서는 코너 속도·힘 도움 없음 (접지 도움만). 저중력 구역은 calmGrav: false라 도움 그대로
//   기본 도움 h는 봇마다 정한 고정값. 사람 기준 humanSec·gain 증가는 &rb=1에서만
//   출발 덩어리(처음 3초)는 startHelp까지만, 이후 고정 h로 (점프 안전 제한은 유지)
BOT_LEVELS.master = {
  ...BOT_LEVELS.hard,
  catchUp: null,
  // 고정 운전 실력만 상향. 차 cfg/숨은 슬립스트림은 바꾸지 않음.
  lead: 0.02, brakeK: 1.03, noise: 0.001, fly: { speed: 55, flare: 0 }, // fly2: 마스터는 착륙장 끝 가까이 내려서 플레어로 뜨면 비행 구역을 지나침 → 안 함
  master: { help: [1, 1], startHelp: 0.45, gain: 1.5, humanSec: 1.5, paceMax: 0.16, gripMax: 0.24, powerMax: 0.25, draftMax: 1, calmGrav: false, saturBrake: 3 },
  jumpTrafficM: [8, 30], // 점프 앞 '다른 차가 있으면 44 m/s' 판단 범위 (어려움은 뒤 15 m ~ 앞 60 m): 무리에서 점프마다 손해가 커서 바로 붙은 차만
};

// --- 접전 (2026-11-12 close-race, 사용자 요청 "한 번 멀어지면 그대로 경기가 진행돼서 재미없음 → 경쟁을 많이 할 수 있게") ---
//   무리 유지(PACK.keep)의 기준을 '봇 무리 가운데'에서 '사람(플레이어)'으로 바꿈: 봇마다 사람과의 시간 차(초)를 보고
//     사람보다 ahead초 넘게 앞서면 1초당 kDown씩(최대 down) 늦추고, behind초 넘게 뒤면 1초당 kUp씩(최대 up) 빠르게, 그 사이(사람 근처)면 그대로 (= 보통 경주)
//   그래서 앞서 나간 봇은 사람이 따라잡을 수 있는 거리에서 기다리고, 뒤처진 봇은 사람 뒤 1~2초까지 다시 붙음. 띠 안에서는 실력대로 → 추월·재추월
//   단계마다 띠(초)와 세기가 다름: 쉬움 = 앞선 봇을 세게 늦춤(이기기 쉬움), 어려움·마스터 = 띠가 넓고 약함(잘 달려야 이김, 못 달리면 앞 봇이 2~3초 앞에서 계속 달림)
//   raceSystem의 예전 따라잡기(쉬움 slowMul·어려움 upMul/upDraft)는 이게 켜져 있으면 안 씀 (겹치지 않게). 마스터 도움은 그대로, 견인은 이걸로 빨라지는 봇은 안 받음
//   사람이 없거나(봇끼리) 사람이 완주했으면 예전 봇 무리 가운데 기준. 점프 근처·저중력·비행 중에는 빨라지지 않음 (PACK.keep과 같음)
//   2026-11-12 drs: 기본 끔 (사용자 "멈춰 주는 게 아니라 시스템으로" → 눈에 보이는 DRS·슬립스트림 기차·견인으로 바꿈, src/drs.js). 주소 &close=1이면 켬
// 숨은 따라잡기·늦추기는 기본 끔. &rb=1만 예전 동작을 허용 (cu·close는 각 플래그도 필요).
export const RUBBER_BAND = (() => {
  try {
    return new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('rb') === '1';
  } catch {
    return false;
  }
})();
export const CLOSE = { on: false };
// 봇 목표 최고 속도에 슬립스트림·견인·DRS 몫을 더하기 (2026-11-12 drs). &botaero=0 = 예전처럼 안 더함 (비교 시험용)
let BOT_AERO = true;
try {
  const q = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
  if (RUBBER_BAND && q.get('close') === '1') CLOSE.on = true;
  if (q.get('botaero') === '0') BOT_AERO = false;
} catch {}
//   draft = 띠보다 draftAt초(기본 1) 넘게 뒤처진 봇에게 (1.5초에 걸쳐 커짐) 주는 보이지 않는 슬립스트림 최대 (raceSystem cuDraft, 예전 어려움 upDraft와 같은 것; 속도 계획 표가 없는 맵(화산)에서도 실제로 빨라지게)
BOT_LEVELS.easy.close = { ahead: 0.6, behind: 0.8, up: 0.12, down: 0.15, kUp: 0.06, kDown: 0.08 };
BOT_LEVELS.easy.plank = false; // 쉬움 봇은 그랑프리 판자 지름길을 안 탐 (botShortcut.js, 2026-11-14)
BOT_LEVELS.normal.close = { ahead: 1.0, behind: 0.6, up: 0.08, down: 0.06, kUp: 0.08, kDown: 0.05, draft: 0.4, draftAt: 0.5 };
BOT_LEVELS.hard.close = { ahead: 1.5, behind: 0.8, up: 0.05, down: 0.03, kUp: 0.05, kDown: 0.03, draft: 0.7, draftAt: 0.4 };
BOT_LEVELS.master.close = { ahead: 2.5, behind: 1.5, up: 0.03, down: 0.02, kUp: 0.02, kDown: 0.015 };

/** 같은 씨앗이면 같은 난수 (봇마다 다른 성격) */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 무리 유지 호환 옵션 (기본 끔, &rb=1) ---
// 차별 성능/목표 랩 평준화는 하지 않는다.
// 실수 난수/성능 편차를 줄이고 추월 성격은 유지. 무리 유지 keep은 &rb=1에서만 복원.
export const PACK = {
  on: true,
  // 무리 유지: 봇끼리만 (사람은 안 봄). 봇 무리 가운데(중앙값)보다 behind초 넘게 뒤면 1초당 perSec씩(최대 up) 빠르게, ahead초 넘게 앞이면 (최대 down) 늦게.
  //   벌어지는 이유는 대부분 첫 바퀴: 맨 앞 그리드 차만 빈 길로 빠져나가고 나머지는 첫 코너에서 엉키고 줄 서서 5~10초 잃음
//   → 무리보다 앞선 차는 늦추고(최대 down) 뒤처진 차는 당김(최대 up) → 다시 한 덩어리가 되어 추월이 일어남
  //   fMax = rb=1일 때 무리 유지 상한. 차별 성능/목표 랩 보정은 없음.
  open: { sec: 25, k: 0.95 }, // 출발 뒤 sec초 동안 바로 앞에 차가 있으면 코너 속도 ×k (어려움·마스터, 예전 그대로)
  keep: { on: RUBBER_BAND, after: 8, behind: 1, ahead: 1, up: 0.07, down: 0.05, perSec: 0.025, fMax: 1.1, bias: 1.015 },
};
try {
  const q = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
  if (q.get('pack') === '0') PACK.on = false;
  if (q.get('keep') === '0') PACK.keep.on = false;
  if (q.get('opensec')) PACK.open.sec = +q.get('opensec');
  if (q.get('openk')) PACK.open.k = +q.get('openk');
} catch {}

/** 봇 차에 보이지 않는 도움 (c = 코너 배수, t = 최고 속도 배수, 1이면 원래대로). 원래 값은 car._packBase에 */
function setCarHelp(car, c, t) {
  const cfg = car.cfg;
  const B = car._packBase || (car._packBase = {
    lat: cfg.tire.lateral, steerLat: cfg.steerLat, steerLatOld: cfg.steerLatOld, steerRate: cfg.steerRate, trac: cfg.tire.traction, brake: cfg.tire.brakeGrip,
    power: cfg.engine.power, maxSpeed: cfg.maxSpeed, gears: cfg.gears.slice(),
    boat: cfg.modes && cfg.modes.boat ? { thrust: cfg.modes.boat.thrust, maxSpeed: cfg.modes.boat.maxSpeed } : null,
  });
  const g = c * c; // 코너 속도 ∝ √접지
  cfg.tire.lateral = B.lat * g;
  cfg.steerLat = B.steerLat * g;
  if (B.steerLatOld != null) cfg.steerLatOld = B.steerLatOld * g;
  cfg.steerRate = B.steerRate * c;
  cfg.tire.traction = B.trac * g;
  cfg.tire.brakeGrip = B.brake * g;
  cfg.maxSpeed = B.maxSpeed * t;
  cfg.gears = B.gears.map((x) => x * t);
  car._accelGears = null; // car.js가 가속 모드 기어를 캐시함 → 다시 계산
  cfg.engine.power = B.power * t * t * Math.sqrt(c); // 기어가 길어진 만큼 + 조금 더 (코너 탈출)
  if (B.boat) {
    cfg.modes.boat.thrust = B.boat.thrust * t * t;
    cfg.modes.boat.maxSpeed = B.boat.maxSpeed * t;
  }
  car._packHelp = [c, t];
}

const profiles = new WeakMap(); // 라인·설정별 캐시: 다른 코스와 같은 id의 다른 성능을 섞지 않음
export function profileFor(line, cfg) {
  let cache = profiles.get(line);
  if (!cache) profiles.set(line, (cache = new WeakMap()));
  if (!cache.has(cfg)) cache.set(cfg, line.profile(lineCarModel(cfg)));
  return cache.get(cfg);
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** 차 물리의 surfGrip 중 봇이 아는 몫 (가속 모드 접지 배수) — steergrip 조향 한계 계산용 */
function botSurf(car) {
  const A = car.cfg.modes && car.cfg.modes.accel;
  return A && car.mode === 'accel' ? A.gripFactor : 1;
}

// --- 비행 루트 (그랑프리 활주로 → 고리 4개 → 착륙장, 2026-11-10 bots-fly) ---
//   사람처럼: 활주로로 들어가면 차가 저절로 비행 모드(car.js autoSwitch) → 활주로 끝에서 Space(climb)로 이륙
//   → 고리를 잇는 매끈한 곡선(.debug/fly.js flyTest와 같은 곡선)을 따라 날고 → 착륙장에 내려 라인으로 돌아감
//   비행 구역(car.flightAllowed) 안에서만 날게 되어 있어서 따로 막을 필요 없음
const planCache = new WeakMap();
const masterPlanCache = new WeakMap();
// 비행 기술 (2026-11-15 fly2, car.js modes.fly.thermal·dive·flare): 봇도 사람과 같은 규칙.
//   봇은 고리 줄 그대로 날고(기류는 지나가며 받는 만큼만), 급강하로 올라간 최고 속도만큼은 브레이크를 안 밟고,
//   어려움은 땅 fly.flare m 위에서 기수를 살짝 들어 부드럽게 내림. &fly2=0 = 예전 봇 비행
const FLY2 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fly2') === '0');
const FLY_DOWN = new THREE.Vector3(0, -1, 0), flyRayP = new THREE.Vector3();
const APPROACH = 170; // 활주로 시작 몇 m 앞부터 활주로로 들어갈 준비 (속도 줄이기)
export function flightPlan(track, master = false) {
  const cache = master ? masterPlanCache : planCache;
  if (cache.has(track)) return cache.get(track);
  let p = null;
  const rw = track.runway, path = track.skyPath;
  if (rw && path && path.length >= 3 && track.racingLine && track.sampleAt) {
    const N = track.racingLine.N, Lm = track.length;
    const rwT = rw.start.t != null ? rw.start.t : track.nearest(rw.start.pos).t;
    const sky = (track.data && track.data.sky) || {};
    const landT = sky.apron ? (sky.apron.t1 + 23 / Lm) % 1 : track.nearest(path[path.length - 1]).t;
    const last = path[path.length - 1];
    const landPt = track.surf ? track.surf(track.sampleAt(landT), -6, 0, new THREE.Vector3()) : last.clone();
    const n = Math.round(path[0].distanceTo(last) * 1.3);
    const route = path.map(v=>v.clone());
    // 고리 뒤부터 도로 쪽으로 합류해 착륙 직후 갓길을 가로지르는 손실을 줄인다.
    if(master){const landing=track.sampleAt(track.nearest(last).t);route[route.length-1].addScaledVector(landing.right,8);route[route.length-1].y+=2;}
    const dense = new THREE.CatmullRomCurve3([...route, landPt], false, 'centripetal').getSpacedPoints(n);
    const dir = rw.end.pos.clone().sub(rw.start.pos).setY(0).normalize();
    const rwI = Math.round(rwT * N) % N;
    // 활주로로 들어가는 길: 활주로 시작 APPROACH m 앞부터 도로 가운데 선 → 활주로 가운데 선 (1 m 간격, 굽은 정도 = 오른쪽 +)
    //   (활주로가 큰 코너 출구에 붙어 있어서, 라인 속도 그대로 들어가면 못 돎: 어려움 봇이 61 m/s로 와서 밖으로 튕겼음)
    const S = track.samples, ds = Lm / N;
    const raw = [];
    //   도로 가운데 선 → (활주로 시작 BLEND m 앞부터) 활주로 25 m 지점까지 매끈한 곡선(Hermite) → 활주로 가운데 선
    //   (그냥 이으면 도로와 활주로 사이 12° 꺾임에서 속도 계획이 24 m/s로 뚝 떨어졌음)
    const BLEND = 45, kB = Math.round(BLEND / ds);
    for (let k = Math.round(APPROACH / ds); k > kB; k--) raw.push(S[(((rwI - k) % N) + N) % N].pos);
    const s0 = S[(((rwI - kB) % N) + N) % N], P0 = s0.pos, T0 = s0.tan.clone().setY(0).normalize();
    const P1 = rw.start.pos.clone().addScaledVector(dir, 25);
    const chord = Math.hypot(P1.x - P0.x, P1.z - P0.z);
    for (let k = 0; k <= 40; k++) {
      const u = k / 40, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      raw.push(new THREE.Vector3(
        h00 * P0.x + h10 * chord * T0.x + h01 * P1.x + h11 * chord * dir.x,
        P0.y + (P1.y - P0.y) * u,
        h00 * P0.z + h10 * chord * T0.z + h01 * P1.z + h11 * chord * dir.z,
      ));
    }
    for (const q of rw.samples) if (q.dist > 25.5) raw.push(q.pos);
    const ap = [raw[0].clone()];
    let carry = 0;
    for (let k = 1; k < raw.length; k++) {
      const a = raw[k - 1], b = raw[k], seg = Math.hypot(b.x - a.x, b.z - a.z);
      let u = 1 - carry;
      while (u <= seg) {
        ap.push(a.clone().lerp(b, u / seg));
        u += 1;
      }
      carry = seg - (u - 1);
    }
    const kap = new Float32Array(ap.length);
    const H = 6; // 앞뒤 6 m 방향 차이로 굽은 정도
    for (let k = 0; k < ap.length; k++) {
      const a = ap[Math.max(0, k - H)], b = ap[k], c = ap[Math.min(ap.length - 1, k + H)];
      const t1x = b.x - a.x, t1z = b.z - a.z, t2x = c.x - b.x, t2z = c.z - b.z;
      const l1 = Math.hypot(t1x, t1z) || 1, l2 = Math.hypot(t2x, t2z) || 1;
      const ang = Math.atan2((t1x * t2z - t1z * t2x) / (l1 * l2), (t1x * t2x + t1z * t2z) / (l1 * l2));
      kap[k] = ang / Math.max(1, (l1 + l2) / 2);
    }
    // 부드럽게 (앞뒤 5 m 평균)
    const kapS = new Float32Array(ap.length);
    for (let k = 0; k < ap.length; k++) {
      let sum = 0, n2 = 0;
      for (let q = Math.max(0, k - 5); q <= Math.min(ap.length - 1, k + 5); q++) (sum += kap[q]), n2++;
      kapS[k] = sum / n2;
    }
    p = {
      rwI, start: rw.start.pos, end: rw.end.pos, dir, half: rw.half, len: rw.end.dist,
      dense, landI: Math.round(track.nearest(last).t * N) % N,
      ap, kap: kapS, apRw: ap.length - Math.round(rw.end.dist - 25),
    };
  }
  cache.set(track, p);
  return p;
}

const gravCache = new WeakMap(); // 트랙마다 지점별 중력 배수 (달·정글 저중력 구역: 브레이크가 덜 듦)
function gravityArray(track) {
  if (gravCache.has(track)) return gravCache.get(track);
  const S = track.samples, n = S.length;
  let g = null;
  if (track.gravityAt || (S[0] && S[0].grav != null)) {
    g = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = S[i].grav;
      if (v == null) v = track.gravityAt ? track.gravityAt(S[i].pos) : 1;
      g[i] = v || 1;
    }
  }
  gravCache.set(track, g);
  return g;
}



/** 마스터 그랑프리 계획 옆 가속 (예전 ×1.16/1.08). steergrip: 새 방식은 무게 이동 최대 한계의 99%까지만 */
function circuitLat(cfg, aLat) {
  if (STEER_OLD) return v => aLat(v) * (1.16 / 1.08);
  const A = cfg.modes.accel;
  return v => Math.min(aLat(v) * (1.16 / 1.08), 0.99 * steerLatCapMax(cfg, v, A && !cfg.modes.manualSelect && v >= A.autoSpeed / 3.6 ? A.gripFactor : 1));
}

function masterDriveModel(cfg) {
  const cm = lineCarModel(cfg), A = cfg.modes.accel;
  const df = v => cfg.aero.downforce * Math.min(1.6, (v / cfg.maxSpeed) ** 2);
  const grip = v => A && !cfg.modes.manualSelect && v >= A.autoSpeed / 3.6 ? A.gripFactor : 1;
  return {
    ...cm,
    // 가속 예측표가 아니라 '지금 속도에서 제동 가능한 상한'을 만든다.
    // 탈출 보상/견인으로 이미 얻은 속도를 옛 가속 표 때문에 버리지 않게 하며,
    // 실제 가속·접지·최고 속도는 원래 Car 물리가 그대로 제한한다.
    aAcc: () => 1e4,
    // 원래 물리는 가속 모드의 gripFactor를 타이어에만 적용한다.
    // 제동 무게 이동으로 더 도는 여유도 계획에만 반영한다 (cfg를 바꾸지 않음).
    // steergrip: 새 방식은 핸들 한계 = 접지 × steerGripUse라 무게 이동으로 더 도는 여유가 뒤 접지(rearGrip)만큼만 → 그 최대값을 넘지 않게
    aLat: STEER_OLD ? v => 1.08 * Math.min(cfg.steerLat * (1 + (cfg.steerLatDownforce || 0) * df(v)), latBase(cfg) * (1 + df(v)) * grip(v))
      : v => Math.min(1.08 * steerLatCap(cfg, v, 0, 0, grip(v)), 0.97 * steerLatCapMax(cfg, v, grip(v))),
    aBrake: v => .96 * Math.min(cfg.brake, cfg.tire.brakeGrip * (1 + df(v)) * grip(v)) + cfg.aero.drag * v * v + cfg.aero.rolling,
  };
}

// 실제로 받은 공통 공력 효과만 계획에 반영한다. 차 cfg/물리는 바꾸지 않는다.
function aeroPlan(line, cfg, base, car, cache, master = false, circuit = false) {
  if (!BOT_AERO || !car.grounded || car.surface === 'magnet' || car.up.y < .8 || (car.gravityScale && car.gravityScale() < .95) || car.mode === 'boat' || car.mode === 'fly') return base;
  const D = cfg.draft || {}, T = cfg.tow || {}, R = cfg.drs || {};
  // 작은 변화마다 전체 코스 계획을 다시 만들지 않도록 아래쪽 1/16 단위로 묶는다.
  // 보간이 0.999999999999...에 수렴한 경우는 1로 취급해 최대 효과 누락을 막는다.
  const q = value => {
    const x = clamp(value || 0, 0, 1);
    return x > 1 - 1e-9 ? 1 : Math.floor(x * 16) / 16;
  };
  const slip = q(car.draft), tow = q(car.tow), drs = q(car.drs);
  const train = 1 + Math.min(2, car.draftTrain || 0) * (D.trainGain || 0);
  if (!slip && !tow && !drs && !(car.slingT > 0)) return base;
  const top = (1 + Math.min(D.topMax ?? 1, slip * (D.topGain ?? .04) * train)) * (1 + tow * (T.topGain || 0)) * (1 + drs * (R.topGain ?? .04)) * (car.slingT > 0 ? 1 + (D.slingTop ?? .06) : 1);
  const drag = (1 - Math.min(.75, slip * (D.dragCut ?? .3) * train)) * (1 - tow * (T.dragCut || 0)) * (1 - drs * (R.dragCut ?? .25));
  const power = 1 + tow * (T.powerGain || 0), pull = slip * (D.pullAccel || 0) * train;
  const key = [slip, tow, drs, train, car.slingT > 0].join('/');
  if (cache.has(key)) return cache.get(key);
  const cm = master ? masterDriveModel(cfg) : lineCarModel(cfg);
  const A = cfg.modes.accel, auto = A && !cfg.modes.manualSelect ? A.autoSpeed / 3.6 : Infinity;
  // 이 profile 계산 동안 cfg는 바뀌지 않는다. 표본마다 같은 기어 배열을 만들지 않는다.
  const accelGears = A ? cfg.gears.map(g => g * A.gearFactor) : cfg.gears;
  const model = {
    ...cm,
    vMax: cm.vMax * top,
    aAcc: master ? cm.aAcc : v => {
      const hi = v >= auto;
      const G = (hi ? accelGears : cfg.gears).find(g => g >= v * 1.06) || cfg.gears.at(-1) * (hi ? A.gearFactor : 1);
      const df = cfg.aero.downforce * Math.min(1.6, (v / cfg.maxSpeed) ** 2), grip = hi ? A.gripFactor : 1;
      const tire = cfg.tire.traction * (cfg.drivetrain === 'awd' ? (cfg.tire.awdTraction ?? 1.12) : cfg.drivetrain === 'fwd' ? .9 : 1) * (1 + df) * grip;
      return Math.min(tire, cm.aAcc(v) + cfg.aero.drag * v * v * (1 - drag) + cfg.engine.power * .9 * (hi ? A.powerFactor : 1) * (power - 1) / G) + pull;
    },
    aBrake: v => Math.max(.1, cm.aBrake(v) - cfg.aero.drag * v * v * (1 - drag)),
  };
  const plan = line.profile(circuit ? {...model,aLat:circuitLat(cfg,model.aLat)} : model);
  if (cache.size >= 48) cache.delete(cache.keys().next().value);
  cache.set(key, plan);
  return plan;
}
/**
 * @param car   Car (봇 차)
 * @param track 트랙 (racingLine 필요)
 * @param prof  이 차의 속도 계획 (profileFor)
 * @param level BOT_LEVELS 중 하나
 * @param seed  성격 씨앗
 */
// 추월하다 막힌 봇이 다시 시도 (2026-11-14, 장면 1분41초: 추월 줄이 내 차와 겹친 채 3초 동안 8 m 뒤에 붙어 있었음). &stuck=0 = 예전
// mastoff (steergrip 3차, 2026-11-24): 마스터 제동을 계획한 감속 곡선에 맞춤. 예전엔 목표보다 3 m/s 넘어야 꽉 밟아서(브레이크 = 넘은 만큼/3)
//   + 페달이 차오르는 0.2초(input.brakeRise) 때문에 늘 곡선보다 약 10 km/h 빠르게 코너에 들어가 핸들 한계에 걸려 밖으로 나갔음.
//   = 곡선 위에 있으면 곡선이 가정한 감속만큼 미리 밟고(앞먹임), 페달이 차오르는 거리만큼 일찍 봄. 차 물리·접지는 그대로. &mbrake=0 = 예전
const MBRAKE = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('mbrake') === '1'; // 시험해 보니 혼자 달리기 코스 밖은 그대로·레이스는 나빠져서 기본 끔 (&mbrake=1 = 켜기)
const PASS_SAT = typeof location === 'undefined' || new URLSearchParams(location.search).get('passsat') !== '0'; // brakecorners: 고속 스위퍼 추월 중 핸들 모자라면 액셀 뗌
// mastoff 2: 제동 거리 계산에 지금 공기 저항 배수(car.dragMul: 슬립스트림·기차·견인·DRS)를 넣음. 예전엔 계획의 aBrake가 늘 공기 저항 전부를 감속으로 쳐서,
//   앞차 뒤(공기 저항 −50~70%)에서 브레이크를 밟으면 생각보다 덜 줄어 코너에 빠르게 들어갔음 (200 km/h에서 약 2~3 m/s² 차이). 모든 단계, &dragbrake=0 = 예전
// mastoff 3: 마스터 계획은 코너를 '무게 이동 0' 한계보다 최대 8% 빠르게 잡음(앞이 눌려야 낼 수 있는 속도) → 액셀을 꽉 밟은 채(하중 +) 빠른 코너에 들어가면
//   핸들 한계에 걸려 밖으로 나갔음. 구름섬(circuit)에만 있던 '코너 전에 액셀을 덜 밟아 앞 하중 남기기'를 모든 맵 마스터로 넓힘 (차 물리 그대로). &mload=0 = 예전
const MLOAD = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('mload') !== '0';
// mastoff 4: 옆 오차 되돌리기 세기(lateralGain 0.15/m)가 속도와 상관없이 같아서 고속(200 km/h 넘음)에서는 출렁임(감쇠비 약 0.47) →
//   라인으로 비스듬히 들어가다 지나쳐 반대편 잔디로 나갔음(구름섬 출발 뒤 240 km/h 굽이 등). 고속에서는 세기를 3.5/속도로 줄여 감쇠비 0.8 이상. &mgain=0 = 예전
const MGAIN = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('mgain') !== '0';
// mastoff 5: 마스터가 코너에서 핸들 끝까지 꺾어도 모자랄 때(satur) '액셀만 떼기'(SAT_LIFT)를 하면 고속에서는 줄어드는 속도가 너무 작아 결국 밖으로 나갔음
//   (레이스 코스 밖 사건 39개 중 24개가 직전에 saturLift). 마스터는 옆 차에 밀리는 중(hold·shove)일 때만 액셀 떼기, 아니면 바로 브레이크
//   (A 차들은 앞이 눌리면 더 잘 돎). &msat=0 = 예전
const MSAT = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('msat') !== '0';
// mastoff 6: 레이스 코스 밖 사건 34개 모두 옆 줄(추월·나란히·복귀)에서. 견인·슬립스트림으로 계획보다 30~40 km/h 빠르게 빠른 굽이에 들어가는데
//   (1) 옆 줄일 땐 '코너 전 액셀 덜 밟기'(MLOAD)를 안 했고 (2) 옆 줄 커브 한계 속도를 앞이 눌린 상태의 계획 접지(무게 이동 0 한계의 최대 108%)로 계산했음
//   → 마스터는 옆 줄에서도 그 줄의 곡률로 필요한 하중을 보고 액셀을 덜 밟고, 옆 줄 한계 속도는 무게 이동 0 한계의 97%로. &mlane=0 = 예전
const MLANE = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('mlane') !== '0';
// mastoff 7: (1) 옆 줄 이동이 일정한 속도(슬링샷 6.5 m/s)로 가다 목표에서 딱 멈춤 → 고속에서 옆으로 움직이던 차가 못 멈추고 줄을 지나쳐 길 밖으로.
//   마스터는 목표 줄에 가까워지면 옆 이동 속도를 sqrt(2 × 3.5 m/s² × 남은 거리)까지 줄임 (멈출 수 있는 만큼)
//   (2) 코너 전 액셀 덜 밟기(MLOAD)가 0.15초 앞 곡률만 봐서 늦음(하중이 옮겨 가는 데 약 0.2초) → 0.15~0.5초 앞 중 가장 큰 곡률. &mlane2=0 = 예전
const MLANE2 = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('mlane2') === '1';
// 시험 결과(m7): 앞 0.5초 곡률 보기는 평균 +1%·복귀 2번이라 기본 끔(&mlook=1 = 켜기), 옆 줄 멈춤 부드럽게만 기본
const MLOOK = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('mlook') === '1';
// 3차 m9 (2026-11-24): 마스터 '도로 끝 지킴'. 0.45초 뒤 차 위치(지금 옆으로 움직이는 속도 그대로)가 라인 한계 + 0.6 m를 넘으면
//   액셀을 떼고, 1 m 넘게 넘으면 그만큼 브레이크. 시험(m9b): 코스 밖 5.8→5.3초지만 평균 +6% 느림·강한 접촉 191→245 → 기본 끔 (&medge=1 = 켜기)
const MEDGE_Q = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
const MEDGE = MEDGE_Q.get('medge') === '1', MEDGE_T = +(MEDGE_Q.get('medget') || 0.45), MEDGE_M = +(MEDGE_Q.get('medgem') || 0.6), MEDGE_B = +(MEDGE_Q.get('medgeb') || 1);
// 3차 실력 점검 (2026-11-24): 마스터가 그랑프리 밖에서는 어려움보다 1~3%만 빠름(gt는 같음) → 그랑프리에서 쓰던 '빈길 전용 계획'(앞에 차가 없고 라인 위일 때 무게 이동 최대 한계의 99%까지)을 모든 맵에. &mcirc=0 = 그랑프리만
const MCIRC = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('mcirc') === '1';
// 3차 실력 점검 (2026-11-24) MTRAIL: 뒤 접지가 약한 차(gt·머슬·버기·로드스터·전갈·미드나잇)는 핸들 한계가 가장 큰 무게 이동 L*가 약 −0.5라
//   코너 안에서 브레이크를 꽉 밟으면(−1) 오히려 핸들 한계가 내려감 → 마스터가 빨리 들어갔다가 꽉 밟고 더 밀려나 어려움보다 느렸음.
//   코너 안(필요한 옆 힘이 L* 한계의 85% 넘음)에서는 브레이크를 L*만큼의 감속까지만 = 차 물리 그대로, 사람이 '살살 밟으며 도는 것'과 같음. &mtrail=0 = 끔
//   시험: gt가 그랑프리 +4초·정글 출발 뒤 코스 밖에 갇힘(감속이 모자라 더 밀려남) → 기본 끔 (&mtrail=1 = 켜기)
const MTRAIL = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('mtrail') === '1';
// MSATL: 위 MSAT(마스터는 핸들이 모자라면 바로 브레이크)를 뒤가 약한 차(L* > −0.95)가 이미 앞으로 쏠려 있을 때는 안 씀 = 예전처럼 도로 끝이 멀면 액셀만 뗌 (꽉 밟으면 핸들 한계가 더 내려가서). &msatl=0 = 끔
const MSATL = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('msatl') === '1';
const DRAG_BRAKE = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('dragbrake') !== '0';
const STUCK_RETRY = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('stuck') !== '0';
// 슬립스트림 추월 (2026-11-14, 사용자 "봇이 내 뒤 슬립스트림에서 옆으로 빠질 때 너무 느림, 내가 할 땐 슝"):
//   예전엔 9~10 m 뒤에서 일찍 빠지기 시작해 옆으로 초당 약 3 m만 움직이고, 다 빠지기 전 '부딪힐 것 같다'고 살짝 브레이크 →
//   옆에 섰을 땐 슬립스트림이 끝나 속도 차이가 0이 되어 나란히 오래 달림.
//   이제 직선에서는 슬립스트림 안에서 더 붙었다가 마지막에 빠르게(초당 SLING_RATE m) 옆으로 빠짐. 차 성능·물리는 그대로. &sling=0 = 예전
const SLING = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('sling') !== '0';
const SLING_RATE = 6.5;
// 바로 뒤에서 앞차 속도만 맞추지 않기 (2026-11-14, 사용자 "내가 브레이크를 밟았는데 뒤 봇이 박지도 추월하지도 않고 간격만 유지"):
//   (1) 범퍼에 거의 붙어 있으면(간격 < 겹침 길이+0.3 m) 추월을 시작하지 않았음 → 붙어 있어도 옆에 자리가 있으면 시작
//   (2) 추월 중에도 옆으로 다 비키기 전엔 앞차 감속을 그대로 따라 해 같이 섰음 → 사람처럼 빠르게 옆으로 빠지고,
//       다 비킬 때까지 범퍼에 안 닿을 만큼만 브레이크 (앞차가 줄이는 몫도 계산). 차 성능·물리는 그대로. &nofollow=0 = 예전
//   (시험했다 뺀 것: 붙어 있을 때 막힌 쪽 바꾸기 허용 = 7봇 빙하 어려움 6판 평균 강한 닿음 7→9로 늘어남)
const DBG_OT = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('dbgot') === '1';
//   앞차가 사람일 때만 (봇끼리는 예전 그대로: 7봇 레이스에서 봇끼리 다 쓰면 닿음 271→996·강한 닿음 5→14로 늘었음). &nofollow=2 = 봇끼리도
const NOFOLLOW_Q = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('nofollow');
const NOFOLLOW = NOFOLLOW_Q !== '0', NOFOLLOW_ALL = NOFOLLOW_Q === '2';
const nfFor = o => NOFOLLOW && !!o && (NOFOLLOW_ALL || !!o.human);
const NF_OFF = new Set((new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('nfoff') || '').split(',')); // (시험) 부분별 끄기: close,evade,wide
// 코너 안 추월 (2026-11-14 cornerpass, 사용자 "코너 안에서도 추월", "내가 한 번 앞서면 뒤 봇들이 못 지나감"). 앞차가 사람이고 주변에 다른 차가 없을 때(nfOK와 같은 조건)만:
//   time  추월 줄이 '너무 느린가'를 속도 대신 시간으로 판단 (안쪽 줄은 길이 짧아 조금 느려도 같은 시간: 예전엔 안쪽 줄을 늘 버려서 코너 진입 추월이 없었음)
//   hug   사람 옆에 나란히 붙어 코너를 돌 때 라인에서 일정 거리(예전)가 아니라 사람 차에서 차 한 대 폭만큼 떨어진 줄 → 출구에서 라인이 바깥으로 갈 때 안쪽으로 갇혀 액셀을 떼던 것
//   merge 코너 안에서도 옆에 차가 없고 바깥쪽으로 돌아오는 거면 라인으로 돌아옴 (예전엔 코너가 끝날 때까지 비킨 줄 그대로 = 좁은 안쪽 줄)
//   clamp 비킨 줄이 길 끝에 눌린 곳의 곡률 계산 꺾임 없애기 (laneCurvature, 추월 줄 고르기·코너 속도 계산 모두)
//   (시험했다 뺀 것: 앞쪽 코너 속도에 '그때 있을 줄'을 쓰기 = 닿음·길 밖이 늘었음)
//   tow   추월 준비 중엔 앞차 줄 뒤에 붙음 (슬립스트림), 예전엔 라인 기준 자리라 앞차가 줄을 바꾸면 슬립스트림이 끊김
//   기본은 꺼짐(예전 그대로): 7봇 레이스 시험에서 닿음·길 밖 시간이 늘어 안전 기준을 못 넘음. &cornerpass=1 = 켜기, &cpoff=time,hug,merge,clamp,tow = 부분별 끄기 (시험)
const CORNERPASS = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('cornerpass') === '1';
const CP_OFF = new Set((new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('cpoff') || '').split(/[,.]/));
const SAT_LIFT = new URLSearchParams((typeof location !== 'undefined' && location.search) || '').get('satlift') !== '0';
// botpush (2026-11-24, 사용자 "봇이 풀 악셀을 밟아도 될 때 계속 밟고 있어?", "내가 브레이킹 실패해도 추월을 안 당함"): 운전(조작)만, 차 성능·물리 그대로
//   lift: 핸들이 모자랄 때(saturLift) 액셀을 0으로 떼지 않고 바깥 도로 끝 여유·모자란 정도·미끄러짐만큼만 줄임 (헤어핀 탈출에서 1초씩 굴러가던 것)
//   top : 직선 최고 속도 상한('top') 때문에는 브레이크를 밟지 않음(액셀만 뗌). 어려움·마스터는 추월 중·슬립스트림을 받은 뒤 1.5초 동안 상한 없음
//   lane: 옆 줄(추월·나란히) 커브 한계 속도를 6 m 간격 대신 매끈한 간격으로 계산 (길 끝에 눌린 꺾임 때문에 라인 계획의 30~40%로 나와 사람보다 1초 먼저 브레이크)
//   &botpush=0 = 예전 전부, &bpoff=lift,top = 부분 끄기, lane은 기본 끔(&bplane=1 사람 추월 중만, &bplane=all 모든 옆 줄)
const BP_Q = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
const BOTPUSH = BP_Q.get('botpush') !== '0', BP_OFF = new Set((BP_Q.get('bpoff') || '').split(/[,.]/));
const BP_LIFT = BOTPUSH && !BP_OFF.has('lift'), BP_TOP = BOTPUSH && !BP_OFF.has('top'), BP_LANE = BOTPUSH && /^(1|human|all)$/.test(BP_Q.get('bplane') || ''); // lane은 기본 끔 (7봇 시험에서 사람 추월 중 새 계산이 강한 접촉을 늘림, gp 마스터 46→64) → &bplane=1로 켬
const BP_TOP_FREE = BP_Q.get('bptopfree') === '1'; // (시험) 슬립스트림 뒤 1.5초·추월 중 상한 없음 — 7봇 시험에서 강한 접촉이 늘어 기본 끔
const BP_LANE_ALL = BP_Q.get('bplane') === 'all'; // (시험) 모든 옆 줄에 새 계산 (&bplane=1: 사람 추월 중일 때만)
const BP_LANE_H = +(BP_Q.get('bplaneh') || 20), BP_LANE_E = +(BP_Q.get('bplanee') || 0.5), BP_LANE_K = +(BP_Q.get('bplanek') || 1); // (시험) 옆 거리 변화 간격(m)·무게·한계 여유
// brakepass (2026-11-25, 사용자 "내가 늦게 밟으면 느리게 도는 걸 공략해 코너/탈출에서 추월, 일찍 밟으면 맞춰 느려지지 말고 빈 쪽으로 가서 늦게 브레이크해 추월"):
//   운전(줄 고르기·브레이크 타이밍)만, 차 성능·물리 그대로. 앞차가 사람이고 옆~앞 45 m에 다른 차가 없을 때만 (nfOK와 같은 조건)
//   early: 앞차가 감속 중(3 m/s² 넘게)이고 그 자리 내 계획 속도보다 확실히 느리면 → 다음 코너 안쪽(아니면 이미 비켜 있는 쪽) 빈 줄로 옮기고,
//          옆으로 다 비킬 때까지는 범퍼에 안 닿을 만큼만 브레이크(예전 evade 식), 다 비키면 내 계획 브레이크 지점까지 밟음(레이트 브레이킹)
//   late : 앞차가 계획 브레이크 구간·코너에서 계획 속도보다 확실히 빠르면(늦게 밟음 → 넓게·느리게 돎) → 사람 줄을 따라가지 않고 사람 안쪽 줄(사람이
//          넓게 나가 라인이 비었으면 라인)을 지켜 에이펙스를 잡고 탈출에서 지나감
//   두 경우 모두: 안쪽 줄은 코너에서 길 안쪽 끝에 눌려도 됨(실제로 안쪽 끝을 따라 돎), 그 줄 커브 한계는 매끈한 계산(laneCurvBP), 옆 이동 속도는 목표에서
//          멈출 수 있는 만큼(glide: 예전 6.5 m/s 그대로 빠지면 230 km/h에서 6 m 넘게 지나쳐 핸들 끝까지 꺾고 브레이크했음)
//   기본 켬 (2026-11-25 마무리: 재현 48경우 추월 9→15·닿음 281→214·강한 5→5·코스 밖 1.7→1.6초, 7봇 12판 복귀·코스 밖·강한 접촉 안 늚). &brakepass=0 = 예전 그대로,
//   &bkoff=early|late|hold|glide|curve|alone|slow = 하나만 끄기, &bpalone=all = 단둘일 때 늘 매끈한 곡률(예전 시험), (시험) &brakepass=2 = 봇 앞차에도
const BK_Q = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
const BRAKEPASS = BK_Q.get('brakepass') !== '0', // 기본 켬 (2026-11-25 마무리 시험 뒤), &brakepass=0 = 예전 그대로
  BK_OFF = new Set((BK_Q.get('bkoff') || '').split(/[,.]/));
const BK_ALONE = BK_Q.get('bpalone') || 'pass'; // 사람과 단둘일 때 매끈한 곡률(laneCurvBP)은 추월 중(pass)일 때만. 늘 쓰면(&bpalone=all) 추월을 그만두고 라인으로 돌아올 때 커브에서 너무 빨라 바깥으로 밀림(재현 코스 밖 1.7→9.5초)
const BK_EARLY = BRAKEPASS && !BK_OFF.has('early'), BK_LATE = BRAKEPASS && !BK_OFF.has('late'), BK_ALL = BK_Q.get('brakepass') === '2';
// dodge (2026-11-25, 사용자 "여기서 봇이 나를 피해서 지나가야 했는데 못함"): 앞 사람이 크게 감속해 빨리 다가갈 때
//   (1) 부딪히기 전에(남은 시간 1.6초 안) 사람이 갈 자리(라인 기준 옆 움직임으로 최대 1초 예측)를 피해 비킬 수 있는 쪽(차 전체 도로 안, 다른 차 없음)으로 일찍 줄을 바꿈,
//       사람이 그쪽으로 다시 들어오면 반대쪽으로(최대 2번)·안 되면 예전처럼 브레이크 (start)
//   (2) 비키는 중 범퍼 보호 브레이크는 비킬 수 있을 때 사람보다 느려지지 않을 만큼만 (follow)
//   (3) 옆 줄이 길 끝에 눌린 곳(6 m 간격 곡률이 꺾여 R16~53 m로 잘못 보임): 눌린 점이 라인 1 m 안이면 라인 곡률 (사람 근처·봇 없을 때),
//       비킨 뒤 라인으로 돌아올 때 줄 이동은 glide 속도로 (curve, back)
//   운전(줄·페달 타이밍)만, 차 성능·물리 그대로. &dodge=0 = 예전 그대로, &dgoff=start,follow,curve,hold,back = 하나만 끄기
//   (시험용) &dgpred=abs = 사람 예측을 절대 옆 속도로, &dgproj=1 = 속도 계획에 돌아오는 옆 거리 미리 반영, &dgt=초 = 시작 남은 시간
// planner (2026-11-26): &planner=1 = 봇의 추월·차 사이 판단을 botPlanner.js로 (예전 follow/lane 차선 바꾸기/dodge/bold/sling/stuck 규칙 대신). 기본 끔
const PLANNER = BK_Q.get('planner') === '1';
const PL_DUMP = BK_Q.get('pldump') === '1'; // (진단) 후보 전부의 점수를 st.plDump.all에
const DODGE = BK_Q.get('dodge') !== '0', DG_OFF = new Set((BK_Q.get('dgoff') || '').split(/[,.]/));
const DG_START = DODGE && !DG_OFF.has('start'), DG_FOLLOW = DODGE && !DG_OFF.has('follow'), DG_CURVE = DODGE && !DG_OFF.has('curve');
const DG_PRED_OV = BK_Q.get('dgpred') !== 'abs', DG_PROJ = BK_Q.get('dgproj') === '1', DG_T = +(BK_Q.get('dgt') || 1.6);
// boldpass (2026-11-25, 사용자 "봇들이 충돌에 너무 쫄지 않게 … 빈틈에서 충돌하면서 들어가면 파고들 수 있는데 통과할 만해도 멈춤"):
//   차끼리 닿아도 스핀이 안 나고(nospin·softContact) 사람·봇 같은 물리 → '닿을 것 같다'는 이유로 브레이크·양보·추월 포기를 덜 함. 운전 판단만 (성능·물리 그대로)
//   (side)  내 앞 끝이 상대 뒤 끝보다 1 m 넘게 앞(= 나란히, 닿아도 옆으로 비빔)이면 그 차 때문에 브레이크 안 함 = 먼저 코를 넣은 쪽이 줄을 지킴
//   (yield) 나란히 코를 넣은 뒤에는 옆 차가 내 줄로 들어와도 양보 브레이크 안 함 (줄은 지금 자리 유지, 밀어내지는 않음)
//   (hold)  사람 옆에서 비켜 있을 줄이 도로 밖이라 뒤로 빠지던 것: 코가 들어가 있고 지금 줄이 도로 안이면 늦추지 않고 지금 줄 유지
//   (rear)  추월 중 뒤에서 다가갈 때: 범퍼가 닿는 순간의 옆 겹침(지금 옆 간격 + 두 차 옆 움직임으로 예측)이 없으면 브레이크 안 함,
//           조금(≤0.9 m, 차 반 대 안)이면 3.5 m/s 넘게 빠르게 닿지 않을 만큼만, 많이 겹치면(뒤에서 정면으로 박음) 예전 그대로
//   조건: 땅 위·위험/좁은 길/합류 위험 아님·12 m/s 넘음·내 차 전체가 앞 0.6초 동안 도로 안. 사람 상대만 (&bold=2 = 봇끼리도, 시험)
//   (dodge) 사용자 "옆으로 피해서 정확한 타이밍에 브레이크를 밟으면 되잖아": 앞차에 크게 빨리 다가가도 먼저 브레이크부터 밟지 않음.
//           옆으로 비킬 줄(차 전체 도로 안, 그 줄 근처·나와 앞차 사이에 다른 차 없음)이 있으면 dodge로 비키고, 브레이크는 내 계획대로(코너 앞이면 그 코너 브레이크 지점).
//           비킬 수 있는지는 핸들 지연(약 0.45초)+옆으로 옮기는 속도로 다 비키는 시간 < 범퍼가 닿을 때까지 시간(아래 예측)으로. 못 비키면 예전처럼 범퍼에 안 닿을 만큼만
//           (예전 dodge는 앞차가 사람이고 앞 45 m에 다른 차가 없을 때만, 비키는 동안에도 사람 속도 −0.5 m/s까지는 줄였음)
//   (bpred) 앞차 예측 (bpPredict, 사용자 추가 요청 2): 앞차가 라인 쪽으로 돌아가며 코너를 돌고, 앞에 브레이크 구간이 있으면 계획 브레이크 지점 근처에서 줄인다고 보고
//           범퍼가 닿을 시간·그때 앞차 줄을 계산 → dodge 시작·비킬 쪽 고르기·추월 중 뒤 겹침 판단에 씀. 매 스텝 실제 위치·속도로 다시 계산
//   (satur) contact2 제안: 사람과 옆으로 닿은 뒤 0.3초는 핸들이 끝까지 꺾여도 브레이크 대신 액셀만 뗌 (바깥 도로 끝 1.5 m 넘게 남고 낭떠러지·용암 아닐 때)
//   &bold=0 = 예전 그대로, &bdoff=side,yield,hold,rear,dodge,satur = 하나만 끄기, &bpred=1 = 앞차 예측 켜기(기본 끔, 끄면 예전 dodge 예측), (시험) &bdnose=·&bdovl=·&bdcv=
const BOLD = BK_Q.get('bold') !== '0', BD_ALL = BK_Q.get('bold') === '2', BD_OFF = new Set((BK_Q.get('bdoff') || '').split(/[,.]/));
const BD_SIDE = BOLD && !BD_OFF.has('side'), BD_YIELD = BOLD && !BD_OFF.has('yield'), BD_HOLD = BOLD && !BD_OFF.has('hold'), BD_REAR = BOLD && !BD_OFF.has('rear');
const BD_DODGE = BOLD && !BD_OFF.has('dodge'), BD_PRED = BOLD && BK_Q.get('bpred') === '1' /* 2026-11-25 기본 끔: gpB 시험에서 큰 속도 차 dodge를 너무 일찍 시작해 코너에서 핸들 한계 감속(satur)이 커짐. &bpred=1이면 켬 */, BD_SATUR = BOLD && !BD_OFF.has('satur');
const BD_NOSE = +(BK_Q.get('bdnose') || 1), BD_OVL = +(BK_Q.get('bdovl') || 0.9), BD_CV = +(BK_Q.get('bdcv') || 3.5);
// boldpass bpred: 앞차가 T초 뒤 어디 있을지 (위치·속도만 보고 사람·봇 같은 방법, 사람 입력은 안 봄)
//   옆: 라인 기준 옆 거리(lane)가 지금 옆 속도(ov)로 움직이다가 점점 라인 쪽으로 돌아감 (ov는 tv초로 줄고, lane은 tr초로 라인에 붙음)
//       → 코너 앞에서 바깥에 있던 앞차가 곧 에이펙스(라인) 쪽으로 꺾어 들어온다는 것을 앎. 도로 안으로 자름
//   앞뒤: 앞차가 지금 '계획 대비 빠르기'(k = 속도 / 그 자리 계획 속도)로 계획 속도를 따라감 = 앞에 브레이크 구간이 있으면 계획 브레이크 지점 근처에서 줄이기 시작
//         실제 감속(acc < −3 m/s²)이 보이면 그걸 우선 (계획보다 더 줄이는 쪽, 처음 속도의 35%까지)
//   매 스텝 지금 위치·속도로 다시 계산 → 예측이 틀리면 바로 실제 움직임으로 고쳐짐. 오차 (미라지 장면 8개, 사람/봇, 옆 m): 0.5초 1.6/1.1, 1초 2.9/1.5, 2초 4.3/1.9 (예전 1.8/1.4, 3.8/2.6, 6.5/3.5)
export function bpPredict(L, sp, ds, j0, lane, ov, v0, acc, T, hb = 1.2, tv = .6, tr = 3, out = {}, each = null) {
  const N = L.N, h = .05, n = Math.max(0, Math.ceil(T / h - 1e-6)), k = Math.min(1.12, Math.max(.7, v0 / Math.max(5, sp[j0])));
  let s = 0, v = Math.max(0, v0), ln = lane, lv = ov;
  for (let q = 0; q < n; q++) {
    const hh = Math.min(h, T - q * h), j = ((j0 + Math.round(s / ds)) % N + N) % N;
    let vn = Math.min(v + 6 * hh, k * sp[j]);
    if (acc < -3) vn = Math.max(.35 * v0, Math.min(vn, v + acc * hh));
    s += (v + vn) * .5 * hh; v = Math.max(0, vn);
    lv *= Math.exp(-hh / tv); ln += (lv - ln / tr) * hh;
    const jj = ((j0 + Math.round(s / ds)) % N + N) % N;
    ln = Math.min(L.hi[jj] - hb - L.offset[jj], Math.max(L.lo[jj] + hb - L.offset[jj], ln));
    if (each && each(s, v, ln, (q + 1) * h - h + hh, hh)) break; // 한 칸마다 (지나간 거리, 속도, 줄, 시간, 칸 길이), true면 멈춤
  }
  out.s = s; out.v = v; out.lane = ln; out.j = ((j0 + Math.round(s / ds)) % N + N) % N; return out;
}
export function createBotDriver(car, track, prof, level, seed = 1, opts = {}) {
  const LL = opts.line !== undefined ? opts.line : learnedLineFor(track, car.cfg, level); // [learned hook 2] 학습 라인이 있으면 그 라인·속도 계획
  if (LL) prof = profileFor(LL, car.cfg);
  const L = LL || track.racingLine, N = L.N, ds = track.length / N, S = track.samples;
  const rand = rng(seed * 7919 + 13);
  const windZones = track.data?.winds || [];
  const forceZones = [...windZones, ...(track.data?.belts || [])];
  const pace = level.pace + (rand() * 2 - 1) * level.paceVar;
  // 같은 단계는 같은 실력 배수, 차 성능은 원본. opts.pack=false는 rb 무리 유지도 끔.
  const packOn = PACK.on && opts.pack !== false;
  const pe = pace > 1 ? 1 + (pace - 1) * 0.25 : pace; // 실제로 먹는 코너 속도 배수 (1 위로는 차 한계라 거의 안 빨라짐)
  const topK0 = level.topK || 1;
  const eq = { keep: 1, kMul: 1, topMul: 1, kCalm: 1, topCalm: 1, src: 'native' };
  /** rb=1 호환용 무리 유지. 기본 주행에서는 호출하지 않는다. */
  function applyEq(physical) {
    const f = Math.min(RUBBER_BAND ? PACK.keep.fMax || 9 : 1, eq.keep);
    eq.kMul = f; // 1 바로 아래에서 코너 목표가 갑자기 3% 떨어지지 않게 연속 배수
    eq.topMul = f;
    // 점프 근처·저중력(st.calm)에서는 무리 유지로 빨라지지 않음 (달 B등급: 뭉친 채 빨리 뛰다 착지에서 코스 밖 복귀가 늘었음)
    const fc = Math.min(RUBBER_BAND ? PACK.keep.fMax || 9 : 1, Math.min(1, eq.keep));
    eq.kCalm = fc;
    eq.topCalm = fc;
    if (physical) {
      // 느린 차를 빠르게: 실력 배수로 모자란 만큼만 차를 도움 (쉬움·보통은 여유가 있어 거의 안 도움)
      const c = Math.max(1, pe * f) / Math.max(1, pe);
      const t = Math.max(1, topK0 * f) / Math.max(1, topK0);
      if (c > 1.0005 || t > 1.0005 || car._packHelp) setCarHelp(car, c, t);
    }
  }
  const exactMaster=!!level.master&&!RUBBER_BAND;
  if(exactMaster)prof=L.profile(masterDriveModel(car.cfg));
  const cm = exactMaster?masterDriveModel(car.cfg):lineCarModel(car.cfg); // 제동력 계산용
  let trailL = -1; { let best = -1; for (let L = -1; L <= 0.001; L += 0.05) { const k = steerLatCap(car.cfg, 30, L, 0, 1); if (k > best + 1e-6) { best = k; trailL = L; } } } // 핸들 한계가 가장 큰 무게 이동 (MTRAIL)
  const aeroPlans = new Map();
  // 구름섬 마스터만 별도 코너 계획. 타이어·엔진·공통 공력 값은 바꾸지 않는다.
  const circuit = exactMaster && (!!track.runway || MCIRC); // MCIRC: 그랑프리 마스터의 '빈길 전용 계획'을 모든 맵에
  // 제동/코스팅으로 앞 하중을 남기는 구간의 목표. 실제 가속과 회전은 Car가 제한한다.
  const circuitProf = circuit ? L.profile({...cm,aLat:circuitLat(car.cfg,cm.aLat)}) : null;
  const circuitAeroPlans = new Map();
  const thrK = level.thrK ? Math.min(1, (level.thrK * pace) / level.pace) : 1; // 봇마다 조금씩 다른 액셀 (실력 차이)
  let vTop = 0;
  for (let i = 0; i < N; i++) vTop = Math.max(vTop, prof.speed[i]);
  const st = {
    circuitClear: false, cornerLoad: 1,
    lane: 0, // 지금 라인에서 옆으로 비킨 거리 (m, + 오른쪽)
    laneTarget: 0,
    laneHold: 0, // 추월 줄을 유지할 남은 시간
    react: level.react[0] + rand() * (level.react[1] - level.react[0]),
    phase: rand() * 10,
    mistake: null, mistakeT: 0, nextMistake: level.mistakeEvery * (0.4 + rand()),
    t: 0, boostCool: 2 + rand() * 4,
    paceMul: 1, // 기본 마스터는 고정 계획 배수; 숨은 고무줄은 rb=1에서만
    blockedT: 0, pushT: 0,
    heldT: 0, passT: 0, // 앞차에 막힌 시간, 추월 시도 남은 시간
    passSide: 0, // 추월하러 빠진 쪽 (앞차 기준 −1 왼쪽 / +1 오른쪽)
    fly: null, // 비행 루트 단계: null(땅) / 'approach'(활주로로) / 'runway' / 'air' / 'out'(착륙 뒤 라인으로)
    flyT: 0, flyI: 0,
    eq, keepT: 0, keepWant: 1, // 같은 단계 봇끼리 비슷하게 (PACK)
  };
  // 성격: 추월을 얼마나 과감하게 하는지 (0.25~1). 씨앗으로 정해져서 같은 봇은 늘 같은 성격
  const aggr = 0.25 + rng(seed * 104729 + 7)() * 0.75;
  st.aggr = aggr;
  const W = (i) => ((i % N) + N) % N;
  const grav = gravityArray(track);
  const gAt = (i) => (grav ? Math.min(1, grav[i % grav.length]) : 1);
  // 점프대(달 기지 등 track.jumps[].lipI): 너무 빨리 뛰면 착지 뒤 코너(T12 헤어핀)에서 못 서고 밖으로 나감 → 립에서 최고 44 m/s (158 km/h, 넘는 데는 126 km/h면 충분)
  const jumpCap = new Map();
  for (const jp of track.jumps || []) if (jp.lipI != null) for (let k = -8; k <= 0; k++) jumpCap.set(W(jp.lipI + k), jp.botSpeed || 44);
  // 어려움은 jumpK배 (조향이 좋아져 더 빨리 뛰어도 착지 뒤 코너를 돎). 단 앞뒤에 차가 붙어 있으면 예전 제한 (빨리 뛰다 공중·착지에서 부딪히면 코스 밖으로)
  const jumpK = level.jumpK || 1;
  // 길 폭(라인이 움직일 수 있는 폭)이 좁은 곳 (점프대 앞 등): 나란히 달리지 말고 한 줄로
  const narrowAt = (i) => L.hi[i] - L.lo[i] < 5.5 || (track.volcano && (S[i].hw ?? track.width/2) < 7.5); // 낭떠러지 산길은 넓어진 구간에서만 추월
  // 점프 구역: 립 80 m 앞부터 착지 30 m 뒤까지는 한 줄로 (나란히 뛰면 공중·착지에서 부딪혀 코스 밖으로 → 달 B 등급 복귀)
  let jumpZone = null, jumpCalm = null;
  for (const jp of track.jumps || []) {
    if (jp.lipI == null) continue;
    jumpZone = jumpZone || new Uint8Array(N);
    let end = (jp.landI != null ? jp.landI : jp.lipI + Math.round(60 / ds)) + Math.round(30 / ds);
    if (end < jp.lipI) end += N; // 출발선을 넘어가는 점프
    for (let k = jp.lipI - Math.round(80 / ds); k <= end; k++) jumpZone[W(k)] = 1;
    // 착지 뒤 200 m까지: 따라잡기로 빨라지지 않음 (달 첫 점프 뒤 빠른 굽이 t 0.23에서 무리 지어 빨리 들어가다 밖으로 나갔음)
    jumpCalm = jumpCalm || new Uint8Array(N);
    for (let k = jp.lipI - Math.round(80 / ds); k <= end + Math.round(170 / ds); k++) jumpCalm[W(k)] = 1;
  }

  // 비행 루트: 실력별 비행 속도·흔들림 (level.fly). 쉬움일수록 느리고 조금 흔들림
  const plan = flightPlan(track, exactMaster);
  const FLY = { speed: 42, look: 22, gain: 2.5, wobble: 0, ...(level.fly || {}) };
  const flyV = FLY.speed * (1 + (pace / level.pace - 1) * 0.5); // 봇마다 조금씩 다름
  // 활주로로 들어가는 길의 속도 계획 (이 차의 옆 접지력으로, 뒤에서부터 제동 거리)
  let apV = null;
  if (plan) {
    const n = plan.ap.length, aLat = cm.aLat(40) * (FLY.latK ?? 0.85) * Math.min(1, pace), aBr = cm.aBrake(40) * 0.8;
    apV = new Float32Array(n);
    for (let k = 0; k < n; k++) apV[k] = k >= plan.apRw ? 80 : Math.min(80, Math.sqrt(aLat / Math.max(1e-4, Math.abs(plan.kap[k]))));
    for (let k = n - 2; k >= 0; k--) apV[k] = Math.min(apV[k], Math.sqrt(apV[k + 1] * apV[k + 1] + 2 * aBr));
  }
  /** 수평으로 그 점을 향하려면 핸들을 얼마나 (fly.js steerTo와 같은 식) */
  function steerToward(x, z, gain) {
    const tx = x - car.pos.x, tz = z - car.pos.z;
    const tl = Math.hypot(tx, tz) || 1;
    const fx = car.fwd.x, fz = car.fwd.z;
    const fl = Math.hypot(fx, fz) || 1;
    return clamp(((fx / fl) * (tz / tl) - (fz / fl) * (tx / tl)) * gain, -1, 1);
  }
  /** 활주로로 가는 길·활주로 위: 바로 앞 같은 줄 차 뒤에 줄 섬 (모두 같은 길로 모여서 예전엔 여기서 많이 부딪힘) */
  function queueSpeed(ctx, speed) {
    const myLat = car.trackInfo ? car.trackInfo.lateral : 0;
    let f = Infinity;
    for (const o of ctx.others) {
      if (o.progM <= 1 || o.progM > 10 + 0.5 * Math.max(0, speed) || Math.abs(o.lat - myLat) > 2.8) continue;
      f = Math.min(f, Math.sqrt(o.speed * o.speed * (level.master?1:0.8) + 2 * 6 * Math.max(0, o.progM - 7)), o.progM < 7 ? o.speed - 2 : Infinity);
    }
    return f;
  }
  /** 비행 루트 조작 (땅 운전 대신). 비행 루트가 아니면 null */
  function flyControls(ctx, c, i0, speed) {
    const dt = ctx.dt;
    const dx = car.pos.x - plan.start.x, dz = car.pos.z - plan.start.z;
    const along = dx * plan.dir.x + dz * plan.dir.z;
    const off = Math.abs(dx * plan.dir.z - dz * plan.dir.x);
    // 시작: 활주로 시작 APPROACH m 앞 (완주한 봇은 그냥 땅으로)
    if (!st.fly) {
      const dI = W(plan.rwI - i0) * ds;
      if (dI > 0 && dI < APPROACH - 5 && !ctx.finished && car.grounded && car.mode !== 'boat') {
        st.fly = 'approach';
        st.flyT = 0;
        st.apI = 0;
      } else return null;
    }
    st.flyT += dt;
    if (st.fly === 'out') {
      if (st.flyT > 1.5 || car.mode !== 'fly') st.fly = null;
      return null; // 땅 운전 (라인으로 돌아감)
    }
    if (car.flying) {
      st.fly = 'air';
      // 매끈한 비행 곡선에서 가장 가까운 점보다 look 칸 앞을 쫓아감
      const D = plan.dense;
      let bi = st.flyI, bd = Infinity;
      for (let k = Math.max(0, st.flyI - 10); k < Math.min(D.length, st.flyI + 60); k++) {
        const d = D[k].distanceToSquared(car.pos);
        if (d < bd) (bd = d), (bi = k);
      }
      st.flyI = bi;
      const tgt = D[Math.min(D.length - 1, bi + FLY.look)];
      const wob = FLY.wobble * Math.sin(st.t * 1.3 + st.phase);
      c.steer = clamp(steerToward(tgt.x, tgt.z, FLY.gain) + wob, -1, 1);
      const dy = tgt.y - car.pos.y - car.vel.y * 0.3 + wob * 2;
      c.climb = dy > 0.5;
      c.dive = dy < -0.5;
      // fly2: 비행 속도는 기류가 밀어 올린 위 속도를 뺀 값(car.speed)으로, 급강하로 올라간 최고 속도만큼은 더 내도 됨
      const FM = car.cfg.modes.fly;
      const vNow = FLY2 ? car.speed : car.vel.length();
      const over = FLY2 ? Math.max(0, (car.diveCap || 0) - FM.maxSpeed) : 0;
      c.throttle = vNow > flyV + over ? 0 : 1;
      c.brake = vNow > flyV + over + 4 ? 0.5 : 0;
      // 바로 앞(14 m 안, 옆 4 m 안)에 다른 차가 날고 있으면 액셀을 뗌 (공중에서 부딪히지 않게)
      for (const o of ctx.others) {
        if (!o.pos) continue;
        const ox = o.pos.x - car.pos.x, oy = o.pos.y - car.pos.y, oz = o.pos.z - car.pos.z;
        const ah = ox * car.fwd.x + oz * car.fwd.z;
        if (ah > 0 && ah < 14 && Math.abs(oy) < 4 && Math.abs(ox * car.fwd.z - oz * car.fwd.x) < 4) c.throttle = 0;
      }
      if (bi > D.length - 45) {
        // 착륙: 내려가는 속도를 6~9 m/s로 (너무 세게 내리면 착지 때 속도를 잃음)
        c.dive = car.vel.y > -6;
        c.climb = car.vel.y < -9;
        c.throttle = level.master ? .65 : .3;
        c.brake = 0;
        // fly2 부드러운 착지 (어려움만, 마스터는 flare 0): 땅 바로 위에서 내려오는 속도를 3~5 m/s로 (사람의 플레어와 같은 조작)
        if (FLY2 && FLY.flare) {
          const h = track.castRay(flyRayP.copy(car.pos).setY(car.pos.y + 0.3), FLY_DOWN, 12);
          if (h && car.pos.y - h.point.y < FLY.flare) {
            c.dive = car.vel.y > -3.2; // 계속 조금씩은 내려감 (수평으로 떠 있으면 착륙장을 지나쳐 강제 착륙)
            c.climb = car.vel.y < -4.8;
          }
        }
      }
      return c;
    }
    if (st.fly === 'air') {
      // 땅에 닿음: 지금 옆 위치에서 천천히 라인으로
      st.fly = 'out';
      st.flyT = 0;
      st.flyI = 0;
      const ti = car.trackInfo;
      if (ti) st.lane = st.laneTarget = clamp(ti.lateral - L.offset[i0], -12, 12);
      st.laneHold = 0;
      return null;
    }
    // 땅 (활주로로 가는 중 / 활주로 위): 활주로 가운데 선 위 25 m 앞을 쫓아감
    if (along > 3) st.fly = 'runway';
    // 활주로에서 밀려났거나(옆으로 벗어남), 너무 오래 걸리면(막힘) 포기하고 땅으로
    const past = W(i0 - plan.rwI);
    if ((st.fly === 'runway' && off > plan.half + 4) || st.flyT > 14 || (st.fly === 'approach' && past < N / 2 && past * ds > 40 && along < 0)) {
      st.fly = null;
      return null;
    }
    if (st.fly === 'runway') {
      c.steer = steerToward(plan.start.x + plan.dir.x * (along + 25), plan.start.z + plan.dir.z * (along + 25), 3);
      c.throttle = 1;
      c.brake = 0;
      const q = queueSpeed(ctx, speed);
      if (speed > q + 0.4) {
        c.throttle = 0;
        c.brake = clamp((speed - q) / 6, 0, 0.6);
      }
      const dEnd = Math.hypot(plan.end.x - car.pos.x, plan.end.z - car.pos.z);
      if (speed > 27 && dEnd < 10) c.climb = true;
      return c;
    }
    // 활주로 앞: 들어가는 길(도로 가운데 → 활주로 가운데)을 따라감 + 그 길의 속도 계획
    const A = plan.ap;
    let bi = st.apI, bd = Infinity;
    for (let k = Math.max(0, st.apI - 5); k < Math.min(A.length, st.apI + 80); k++) {
      const d = (A[k].x - car.pos.x) ** 2 + (A[k].z - car.pos.z) ** 2;
      if (d < bd) (bd = d), (bi = k);
    }
    st.apI = bi;
    if (bd > 30 * 30) {
      st.fly = null; // 길에서 너무 멀어짐 (밀려남 등)
      return null;
    }
    const look = Math.round(6 + Math.max(0, speed) * 0.35);
    const tp = A[Math.min(A.length - 1, bi + look)];
    const kf = plan.kap[Math.min(A.length - 1, bi + Math.round(Math.max(0, speed) * 0.18))];
    c.steer = clamp((kf * speed * speed) / 24 + 2 * Math.atan2(...((dx2, dz2) => {
      const fl = Math.hypot(car.fwd.x, car.fwd.z) || 1, fx = car.fwd.x / fl, fz = car.fwd.z / fl;
      return [fx * dz2 - fz * dx2, fx * dx2 + fz * dz2];
    })(tp.x - car.pos.x, tp.z - car.pos.z)), -1, 1);
    let tgt = Infinity;
    const reach = Math.min(A.length - 1, bi + Math.round((speed * speed) / (2 * 0.8 * cm.aBrake(30)) + 10));
    for (let k = bi + 2; k <= reach; k++) tgt = Math.min(tgt, Math.sqrt(apV[k] * apV[k] + 2 * 0.8 * cm.aBrake(apV[k]) * (k - bi - 2)));
    tgt = Math.min(tgt, apV[bi], queueSpeed(ctx, speed));
    if (speed > tgt + 0.4) {
      c.throttle = 0;
      c.brake = clamp((speed - tgt) / 3, 0, 1);
    } else c.throttle = Math.min(1, thrK);
    if (exactMaster) {
      const h = A[Math.max(0,bi-2)], t = A[Math.min(A.length-1,bi+4)];
      const tx=t.x-h.x,tz=t.z-h.z,tl=Math.hypot(tx,tz)||1;
      const fl=Math.hypot(car.fwd.x,car.fwd.z)||1;
      const hd=Math.atan2((car.fwd.x*tz-car.fwd.z*tx)/fl,(car.fwd.x*tx+car.fwd.z*tz)/fl);
      const side=(tx*(A[bi].z-car.pos.z)-tz*(A[bi].x-car.pos.x))/tl;
      const cfg=car.cfg, v=Math.max(8,speed), df=cfg.aero.downforce*Math.min(1.6,(v/cfg.maxSpeed)**2);
      const lat=steerLatCap(cfg,v,car.load||0,0,botSurf(car));
      const yaw=plan.kap[Math.min(A.length-1,bi+Math.round(v*.2))]*v+3*hd+.15*clamp(side,-6,6);
      const per=cfg.steerRate*Math.min(1,v/8)*Math.min(1,lat/(cfg.steerRate*v));
      c.steer=clamp((yaw+.3*(yaw-(car.yawRate||0))-.8*(car.slip||0))/Math.max(.05,per),-1,1);
    }
    st.dbg = { fly: st.fly, apI: bi, tgt: +tgt.toFixed(1) };
    return c;
  }

  const cmAcc = PLANNER ? lineCarModel(car.cfg) : null;
  const plEdge = (j, side) => { const E = track.EDGE; if (!E || !track.edgeAt) return 1; const e = track.edgeAt(j, side); return e === E.cliff || e === E.lava ? 6 : e === E.wall || e === E.rail ? 2.5 : 1; };
  let planner = null; // laneCurvature는 아래에서 정의됨 (함수 선언이라 여기서 써도 됨)
  if (PLANNER) planner = createPlanner({ L, N, ds, S, prof, laneCurvature: (j, lane) => laneCurvature(j, lane), bpPredict, aLat: (x) => cm.aLat(x), aAcc: (x) => cmAcc.aAcc(x) * Math.min(1, thrK), aBrake: (x) => cm.aBrake(x), bankGrip: cm.bankGrip || 0, edgeK: plEdge });
  st.plT = (seed % 12) / 120; st.plC = null;
  const scDrive = createShortcutDriver({ car, track, cm, level, pace, thrK, st, prof, vTop, queueSpeed: (ctx, v) => queueSpeed(ctx, v),
    onRelease: (i) => { const ti = car.trackInfo; if (ti) st.lane = st.laneTarget = clamp(ti.lateral - L.offset[i % N], -12, 12); st.laneHold = 0; } });
  /** 라인 지점 j에서 옆으로 lane만큼 비킨 목표 점 */
  const magnetDir = new THREE.Vector3(), magnetCross = new THREE.Vector3();
  function target(j, lane) {
    const s = S[j];
    const off = clamp(L.offset[j] + lane, L.lo[j] + 0.2, L.hi[j] - 0.2);
    return [s.pos.x + s.right.x * off, s.pos.z + s.right.z * off];
  }

  // clamp (cornerpass): 비킨 줄이 길 끝에 눌려 잘리는 곳(라인이 끝에 붙는 에이펙스·출구)은 6 m 간격 계산에 꺾임이 생겨 곡률이 크게 나옴
  //   → 잘린 세 점이 모두 라인에서 1 m 안이면 라인과 같은 자리(라인 곡률), 하나라도 잘렸으면 앞뒤 15 m 간격으로 매끈하게 (차도 그렇게 돎)
  function laneCurvature(j, lane) {
    if (CORNERPASS && !CP_OFF.has('clamp')) {
      const h = Math.max(1, Math.round(6 / ds));
      let cut = false, onLine = true;
      for (const k of [W(j - h), j, W(j + h)]) {
        const o = L.offset[k] + lane, c = clamp(o, L.lo[k] + 0.2, L.hi[k] - 0.2);
        if (c !== o) cut = true;
        if (Math.abs(c - L.offset[k]) > 1) onLine = false;
      }
      if (cut) return onLine ? pathCurvature(j, 0) : pathCurvature(j, lane, 15);
    }
    return pathCurvature(j, lane);
  }
  // botpush lane: 옆 줄 곡률 = 라인 곡률(매끈한 값)을 '안쪽으로 비킨 거리'만큼 작은 반지름으로 + 비킨 거리가 바뀌는 몫(앞뒤 20 m, 절반)
  //   예전 pathCurvature(6 m 간격)는 라인이 연석 위(길 끝 −0.2 m 밖)로 가는 곳·비킨 줄이 길 끝에 눌리는 곳에서 꺾임이 생겨
  //   빙하 T1 안쪽 2.7 m 줄 한계가 라인 계획 102 km/h의 64%(65 km/h)로 나왔음 → 이 식은 92~105 km/h
  function laneCurvBP(j, lane) {
    const e = (k) => clamp(L.offset[k] + lane, L.lo[k] + 0.2, L.hi[k] - 0.2) - L.offset[k];
    const k0 = L.curvature[j], a = Math.abs(k0), dIn = -e(j) * Math.sign(k0); // 곡률 < 0 = 오른쪽으로 도는 코너 → 안쪽 = +옆
    const h = Math.max(1, Math.round(BP_LANE_H / ds));
    const e2 = Math.abs(e(W(j - h)) - 2 * e(j) + e(W(j + h))) / (h * ds) ** 2;
    return (Math.sign(k0) || 1) * (a / Math.max(0.3, 1 - dIn * a) + BP_LANE_E * e2);
  }
  function pathCurvature(j, lane, span = 6) {
    const h = Math.max(1, Math.round(span / ds));
    const [ax, az] = target(W(j-h), lane), [bx, bz] = target(j, lane), [cx, cz] = target(W(j+h), lane);
    const ux=bx-ax, uz=bz-az, vx=cx-bx, vz=cz-bz;
    return Math.atan2(uz*vx-ux*vz, ux*vx+uz*vz) / Math.max(1, (Math.hypot(ux,uz)+Math.hypot(vx,vz))/2);
  }



  // 사람에게도 있는 수동 변속/완벽한 변속을 실제 입력으로 얻는다.
  // 점프·특수 노면·활주로 진입 전에는 자동으로 돌려 변속 중 이륙을 피한다.
  function masterShift(c, dt) {
    if (!level.master || RUBBER_BAND) return c;
    st.shiftLock = Math.max(0, (st.shiftLock || 0) - dt);
    const flightEntry = plan && W(plan.rwI - (car.trackInfo?.index || 0)) * ds < APPROACH + 100;
    car.manual = !st.fly && !flightEntry && car.grounded && car.mode !== 'boat' && car.mode !== 'fly' && car.surface !== 'magnet' && car.up.y > .8 && !st.calm && (!car.gravityScale || car.gravityScale() >= .95);
    if (!car.manual || car.shiftTimer > 0 || st.shiftLock > 0 || car.gear < 1) return c;
    const e = car.cfg.engine, G = car.gearSpeeds(), g = car.gear;
    const rpm = e.redline * Math.abs(car.speed) / G[g - 1];
    c.shiftUp = c.throttle > .2 && c.brake < .1 && g < G.length && rpm >= Math.min(e.limiter * .985, e.redline * 1.02) && car.rpm >= e.redline * e.perfectShift;
    c.shiftDown = !c.shiftUp && g > 1 && e.redline * Math.abs(car.speed) / G[g - 2] < e.redline * (st.circuitClear ? .98 : c.brake > .1 ? .92 : .86) && (c.brake > .1 || rpm < e.redline * (st.circuitClear ? .86 : .7));
    if (c.shiftUp || c.shiftDown) st.shiftLock = .25;
    return c;
  }

  /**
   * 매 물리 스텝 조작 명령
   * ctx = { since: 출발 신호 뒤 시간, dt, me: { progM, lat }, others: [{ progM, lat, speed }], finished }
   */
  function controls(ctx) {
    const c = { throttle: 1, brake: 0, steer: 0, climb: false, dive: false, booster: false, mode: null, shiftUp: false, shiftDown: false };
    const dt = ctx.dt;
    st.t += dt;
    const ti = car.trackInfo;
    if (!ti) return c;
    const i0 = ti.index % N;
    const v = Math.max(8, Math.abs(car.speed));
    const speed = car.speed;
    // 실제 차가 라인으로 돌아왔고 주변 차·추월 경로가 없을 때만 적극적인 계획을 쓴다(사람/봇 공통).
    st.circuitClear = circuit && !ctx.finished && !st.overtake && st.laneHold <= 0 && Math.abs(st.lane) < .5 && Math.abs(ti.lateral-L.offset[i0]) < 1.5 && !ctx.others.some(o => !o.fin && o.progM > -15 && o.progM < 70);
    // 비행 루트 (그랑프리): 활주로·공중에서는 땅 운전 대신
    const fc = plan ? flyControls(ctx, c, i0, speed) : null;
    if (fc) {
      if (ctx.since < st.react) c.throttle = c.brake = 0;
      if (st.fly !== 'approach') st.dbg = { fly: st.fly, flyI: st.flyI };
      return masterShift(c,dt);
    }
    // 판자 지름길 (그랑프리 마지막): 사람과 같은 길로 (botShortcut.js)
    const scc = scDrive && !st.fly ? scDrive(ctx, c, i0, speed) : null;
    if (scc) return masterShift(scc, dt);

    // --- 같은 단계 봇끼리 비슷하게 (PACK) ---
    if (packOn && PACK.keep.on) {
      const K = PACK.keep;
      st.keepT -= dt;
      if (st.keepT <= 0) {
        st.keepT = 0.5;
        let want = 1;
        st.closeOn = false;
        // 접전(CLOSE): 가장 가까운(완주 안 한) 사람 기준
        let hum = null;
        if (CLOSE.on && level.close && packOn) for (const o of ctx.others) if (o.human && !o.fin && (!hum || Math.abs(o.progM) < Math.abs(hum.progM))) hum = o;
        if (hum && !ctx.finished && ctx.since > K.after && !st.fly) {
          const C = level.close;
          const sec = hum.progM / Math.max(20, Math.abs(speed)); // + = 사람이 내 앞 (몇 초)
          want = sec > 0 ? K.bias || 1 : 1; // bias(무리 전체 조금 빠르게)는 사람보다 뒤에 있는 봇만
          if (sec > C.behind) want += Math.min(C.up, (sec - C.behind) * C.kUp);
          else if (-sec > C.ahead) want -= Math.min(C.down, (-sec - C.ahead) * C.kDown);
          st.closeOn = true;
          st.closeSec = sec;
        } else if (!ctx.finished && ctx.since > K.after && !st.fly) {
          // 봇 무리 가운데: 다른 봇들(사람 빼고)과 나의 진행 거리 중앙값 (+ = 가운데가 내 앞)
          const ps = [0];
          for (const o of ctx.others) if (!o.human) ps.push(o.progM);
          if (ps.length >= 3) {
            ps.sort((a, b) => a - b);
            const n = ps.length, med = n % 2 ? ps[n >> 1] : (ps[n / 2 - 1] + ps[n / 2]) / 2;
            const sec = med / Math.max(20, Math.abs(speed)); // 몇 초 차이인지 (지금 속도로 어림)
            // bias: 무리로 달리면 앞차는 늦추고 뒤차는 (차 한계 때문에) 덜 빨라져서 단계 평균이 1~2% 느려졌음 → 무리 전체를 조금 빠르게
            want = K.bias || 1;
            if (sec > K.behind) want += Math.min(K.up, (sec - K.behind) * K.perSec);
            else if (-sec > K.ahead && (!(st.paceMul > 1) || level.master)) want -= Math.min(K.down, (-sec - K.ahead) * K.perSec);
          }
        }
        if (want > 1 && st.paceMul < 0.999 && !st.closeOn) want = 1; // 사람 따라잡기로 늦추는 중이면 빠르게 하지 않음
        st.keepWant = want;
      }
      eq.keep += (st.keepWant - eq.keep) * Math.min(1, dt * 0.8);
      if (Math.abs(eq.keep - (eq.keepApplied ?? 1)) > 0.001 || (eq.keep !== eq.keepApplied && Math.abs(eq.keep - st.keepWant) < 1e-4)) {
        eq.keepApplied = eq.keep;
        applyEq(eq.src !== 'off' && !level.master);
      }
    }

    // --- 실수 ---
    const risky = gAt(i0) < 0.9 || narrowAt(W(i0 + Math.round(60 / ds))) || narrowAt(i0) || car.surface === 'magnet' || !car.grounded || !!st.fly;
    if (!ctx.finished && ctx.since > 5) {
      st.nextMistake -= dt;
      // 점프·저중력·좁은 길·자석 도로 근처에서는 실수하지 않음 (거기서 실수하면 떨어지거나 코스 밖으로 나가 복귀만 늘어남)
      if (st.nextMistake <= 0 && risky) st.nextMistake = 1.5;
      else if (st.nextMistake <= 0) {
        const r = rand();
        // 실수 종류: 넓게 / 액셀 뗌 / 늦은 브레이크(뒤차와 엉키기 쉬움). lateP = 늦은 브레이크 비율 (기본 0.3)
        const keep = 1 - (level.lateP ?? 0.3);
        st.mistake = r < keep * (4 / 7) ? 'wide' : r < keep ? 'lift' : 'late';
        st.mistakeT = st.mistake === 'lift' ? 0.5 + rand() * 0.5 : 1.2 + rand();
        st.nextMistake = level.mistakeEvery * (0.5 + rand());
      }
    }
    if (st.mistake && risky) st.mistake = null;
    if (st.mistake) {
      st.mistakeT -= dt;
      if (st.mistakeT <= 0) st.mistake = null;
    }

    // --- pack2: 차 사이의 공간을 먼저 확인하고, 같은 줄 앞차만 따라감 ---
    let follow = Infinity, fsrc = '', busy = false, lateBrake = 0, hold = 0, shove = 0, attack = null;
    // 실제 지상 제동력에는 중력 배수가 없음. 마스터는 그 제동력으로 계획한다.
    // 다른 단계의 기존 여유와 물리는 그대로 둔다.
    const setF = (x, tag) => { const nf = Math.min(follow, x); if (nf !== follow) fsrc = tag; follow = nf; }; // (진단 boldpass) 어느 판단이 앞차 속도 맞추기를 정했나
    const myLat = ti.lateral, gHere = level.master ? 1 : gAt(i0), pushing = st.passT > 0;
    const jumpSoon = !!jumpZone && !!jumpZone[i0];
    const boatQueue = car.mode === 'boat' && car.surface === 'water';
    let narrowSoon = jumpSoon || boatQueue, brakeSoon = false, cornerSoon = false, packAhead = false, jumpTraffic = false;
    for (let q = 0; q < (30 + v) / ds; q += 3) {
      narrowSoon ||= narrowAt(W(i0+q));
      brakeSoon ||= !!prof.brake[W(i0+q)];
      cornerSoon ||= Math.abs(L.curvature[W(i0+q)]) > 1/150;
    }
    if (!st.started) {
      st.started = true;
      st.lane = st.laneTarget = clamp(myLat-L.offset[i0], -6.4, 6.4);
      st.laneHold = 2;
      st.gridLat = myLat;
    }
    const peers = ctx.others.map(o => {
      const dm = o.progM-ctx.me.progM, j=W(i0+Math.round(dm/ds));
      return {...o, dm, lane:o.lat-L.offset[j]};
    }).filter(o=>Math.abs(o.dm)<130);
    const actualLane = myLat-L.offset[i0];
    const ownBox = hitboxFor(car);
    const boxOf = o => o.hitbox || ownBox;
    const tangent = ti.sample?.tan || car.fwd;
    const tl = Math.hypot(tangent.x,tangent.z)||1, tx=tangent.x/tl, tz=tangent.z/tl;
    const projection = (box,fwd,front) => {
      const f=fwd||tangent, fl=Math.hypot(f.x,f.z)||1;
      const along=Math.abs((f.x*tx+f.z*tz)/fl), across=Math.abs((f.x*tz-f.z*tx)/fl);
      return front==null ? box.half*along+Math.max(box.front,box.back)*across : box[front?'front':'back']*along+box.half*across;
    };
    const sideSpace = o => projection(ownBox,car.fwd,null) + projection(boxOf(o),o.fwd,null);
    const rearSpace = o => projection(ownBox,car.fwd,true)+projection(boxOf(o),o.fwd,false);
    const beside = peers.filter(o => Math.abs(o.dm) < (ownBox.front+ownBox.back+boxOf(o).front+boxOf(o).back)*.5);
    // NOFOLLOW는 사람 앞차 말고 내 옆~앞 45 m에 다른 차가 없을 때만 (내 뒤 차는 상관없음: 장면 sea 2분17초도 뒤에 봇 2대). 앞·옆에 다른 차가 있으면 무리 속 = 예전 그대로
    //   (7봇 빙하 마스터에서 무리 속까지 쓰면 사람과 강한 닿음 2.5→5.3). &nfoff=alone = 무리 속에서도
    const nfOK=o=>nfFor(o)&&(NF_OFF.has('alone')||!peers.some(p=>p!==o&&p.dm>-4&&p.dm<45));
    const cpFor=(o,part)=>CORNERPASS&&!CP_OFF.has(part)&&!!o&&!!o.human&&!o.fin&&!peers.some(p=>p!==o&&p.dm>-4&&p.dm<45);
    const crosses = off => beside.some(o => (off-o.lane)*(actualLane-o.lane)<0 || Math.abs(off-o.lane)<sideSpace(o)+.12);
    // 이미 얻은 옆 자리는 지킨다. 상대 쪽으로 계속 조향해 밀어내지는 않는다.
    const yieldTo = o => {
      if(Math.abs(o.lat-myLat)<sideSpace(o)&&Math.abs(o.dm)>.05)return o.dm>0;
      const mine=Math.round(Math.abs(actualLane)*2), theirs=Math.round(Math.abs(o.lane)*2);
      if(mine!==theirs)return mine>theirs;
      return o.dm>0 || (o.dm===0&&myLat>o.lat);
    };
    const fits = (off,seconds=1.1,wide=false) => {
      const margin=wide?Math.max(.2,projection(ownBox,car.fwd,null)-1+.4):Math.max(1,ownBox.half);
      for(let q=0;q<(25+v*seconds)/ds;q+=3){const j=W(i0+q),lat=L.offset[j]+off;if(lat<L.lo[j]+margin||lat>L.hi[j]-margin)return false;}
      return true;
    };
    let front = null;
    for(const o of peers) {
      if(o.dm>0&&o.dm<30&&Math.abs(o.lane-st.lane)<sideSpace(o)+.5)packAhead=true;
      if(o.dm>0&&Math.abs(o.lane-st.lane)<sideSpace(o)+.4&&(!front||o.dm<front.dm))front=o;
      if(jumpSoon&&o.dm>-12&&o.dm<35)jumpTraffic=true;
    }
    st.laneHold=Math.max(0,st.laneHold-dt);
    st.overtakeCool=Math.max(0,(st.overtakeCool||0)-dt);
    const bold = level.pace > .8; // 쉬움만 시도/제동 여유를 더 둔다.
    const intent=(bold ? .88 : .4)+.12*aggr;
    const keyOf=o=>o.id??o.pos;
    const actualGap=o=>{
      if(!o.pos||Math.abs(o.dm)>60)return o.dm;
      const dx=o.pos.x-car.pos.x,dz=o.pos.z-car.pos.z,tan=ti.sample?.tan||car.fwd;
      const gap=(dx*tan.x+dz*tan.z)/Math.max(.01,Math.hypot(tan.x,tan.z));
      return Math.hypot(dx,dz)<65&&Math.abs(o.pos.y-car.pos.y)<5&&Math.abs(gap-o.dm)<10?gap:o.dm;
    };
    const crowded=o=>ctx.others.some(p=>keyOf(p)!==keyOf(o)&&(!p.pos||car.pos.distanceToSquared(p.pos)<(35+v*3)**2));
    let turnSide=0,straightM=30+v*3;
    for(let q=0;q<straightM/ds;q+=3){const j=W(i0+q);if(Math.abs(L.curvature[j])>1/150){turnSide=-Math.sign(L.curvature[j]);straightM=q*ds;break;}}
    // 슬립스트림에서 늦게·빠르게 빠지는 추월: 땅 위 직선이 3.5초 넘게 남았고 브레이크·좁은 길·옆 차가 없을 때만
    const slingOK=SLING&&bold&&car.grounded&&car.mode!=='boat'&&car.mode!=='fly'&&car.surface!=='magnet'&&!cornerSoon&&!brakeSoon&&!narrowSoon&&!risky&&straightM>=30+v*3-1&&v>25;
    // 그 추월 줄로 가면 앞차보다 느려지는가 (2026-11-14 장면 2분24초: 빠른 S자에서 바깥 줄을 골라 243→173 km/h로 스스로 늦춤, 앞차는 240 그대로)
    //   다음 2초 거리 동안 그 줄의 커브 한계 속도가 '앞차 속도와 그 자리 라인 계획 속도 중 낮은 쪽'의 95%보다 낮으면 그 줄은 안 씀. &stuck=0 = 예전
    const slowMemo=new Map(); // 이번 스텝 안에서 같은 줄은 한 번만 계산 (렉 방지)
    const laneTooSlow=(off,leader)=>{
      if(!STUCK_RETRY||Math.abs(off)<.5||car.mode==='boat'||car.surface==='magnet')return false;
      const mk=Math.round(off*20)+':'+Math.round(leader.speed*2)+(cpFor(leader,'time')?'t':'')+(nfOK(leader)?'h':'');if(slowMemo.has(mk))return slowMemo.get(mk);
      const r=laneSlowCalc(off,leader);slowMemo.set(mk,r);return r;
    };
    const laneSlowCalc=(off,leader)=>{
      const lat0=cm.aLat(Math.max(speed,leader.speed)),timeEq=cpFor(leader,'time'),bpCurve=BRAKEPASS&&!BK_OFF.has('curve')&&!BK_OFF.has('slow')&&bold&&nfOK(leader);
      for(let q=0;q<(20+v*2)/ds;q+=3){const j=W(i0+q);if(S[j].roll||S[j].gap)continue;
        const sc=bpCurve?laneCurvBP(j,off):laneCurvature(j,off),c=Math.abs(sc);if(!(c>.001))continue;
        const bankLat=9.81*Math.sin(S[j].bank||0)*Math.sign(sc)*(cm.bankGrip||0);
        let cap=Math.sqrt(Math.max(lat0*.5,lat0+bankLat)/c);
        // 시간 기준: 같은 코너를 도는 줄의 길이는 곡률에 반비례 → 안쪽(곡률 큼)은 느려도 덜 달림. 라인 곡률이 뚜렷할 때만, 0.8~1.25배 안에서
        if(timeEq){const cl=Math.abs(pathCurvature(j,0));if(cl>.004)cap*=clamp(c/cl,.8,1.25);}
        if(cap<Math.min(leader.speed,prof.speed[j])*.95-.5)return true;} // 코너 앞이면 앞차도 그만큼 줄이니 라인 계획 속도와 비교
      return false;
    };
    // brakepass: 사람과 단둘이 코너(앞 30+v m 안)에 있을 때, 이미 사람 한쪽에 1 m 넘게 비켜 있으면 사람 뒤를 가로질러 반대쪽 줄로 가지 않음
    //   (코너 출구에서 바깥 추월 줄로 건너가다 핸들이 끝까지 꺾여 155→78 km/h로 브레이크했음)
    const bpNoCross=(off,o)=>BK_LATE&&bold&&cornerSoon&&nfOK(o)&&Math.abs(actualLane-o.lane)>1&&Math.sign(off-o.lane)!==Math.sign(actualLane-o.lane);
    const options=(leader,side=0,wide=false,secs=wide?2.5:1.1)=>{
      const spread=Math.max(3.1,sideSpace(leader)+(bold?.5:.75));
      const low=L.lo[i0]+Math.max(1,ownBox.half)-L.offset[i0],high=L.hi[i0]-Math.max(1,ownBox.half)-L.offset[i0];
      const choices=[0,-spread,spread,leader.lane-spread,leader.lane+spread,clamp(st.lane,low,high)];
      return choices.filter((off,i)=>(wide||Math.abs(off)<=6.4)&&choices.indexOf(off)===i&&Math.abs(off-leader.lane)>=sideSpace(leader)+.2&&(!side||Math.sign(off-leader.lane)===side)&&fits(off,secs,wide===true)&&!crosses(off)&&!peers.some(o=>o!==leader&&o.dm>-rearSpace(o)-2&&o.dm<rearSpace(o)+12&&Math.abs(o.lane-off)<sideSpace(o)+.15)&&!laneTooSlow(off,leader)&&!bpNoCross(off,leader));
    };
    // brakepass: 비킨 줄은 앞 (25+v*초) m 동안 차 전체가 도로 안이어야 함. 안쪽 방(side 쪽 도로 끝까지)이 모자라면 그만큼 줄여서 씀
    //   (처음엔 안쪽 길 끝에 눌리는 것을 허용했는데, 라인 기준 옆 거리가 잘리는 곳에서 줄이 꺾여 핸들이 좌우로 끝까지 흔들리고 바깥으로 밀려났음)
    const bpRoom=(side,seconds)=>{
      const m=Math.max(1,ownBox.half);let r=side>0?Infinity:-Infinity;
      for(let q=0;q<(25+v*seconds)/ds;q+=3){const j=W(i0+q);r=side>0?Math.min(r,L.hi[j]-m-L.offset[j]):Math.max(r,L.lo[j]+m-L.offset[j]);}
      return r;
    };
    const fitsBP=(off,side,seconds=1.1)=>fits(off,seconds);
    const kRefBP=exactMaster?1:Math.min(1,pace);
    // 그 줄 커브 한계가 라인 계획의 80%보다 낮은 곳이 있으면 안 씀 (헤어핀 아주 안쪽)
    const bpLaneSlow=off=>{
      if(Math.abs(off)<.5)return false;
      const lat0=cm.aLat(speed);
      for(let q=0;q<(30+v*2.5)/ds;q+=3){const j=W(i0+q);if(S[j].roll||S[j].gap)continue;
        const sc=laneCurvBP(j,off),c=Math.abs(sc);if(!(c>.001))continue;
        const bankLat=9.81*Math.sin(S[j].bank||0)*Math.sign(sc)*(cm.bankGrip||0);
        if(Math.sqrt(Math.max(lat0*.5,lat0+bankLat)/c)<.8*prof.speed[j]*kRefBP-.5)return true;}
      return false;
    };
    // 사람 안쪽 줄: 라인(0)이 이미 사람에서 차 폭만큼 떨어져 있으면 라인, 아니면 사람 줄+폭. 안쪽(turnSide) 먼저, 반대쪽은 이미 그쪽에 비켜 있을 때만 (앞차 뒤를 가로지르지 않음)
    const bpChoose=(o,only=0)=>{
      const spread=Math.max(3.1,sideSpace(o)+.55),mySide=Math.sign(actualLane-o.lane);
      const sides=only?[only]:turnSide?[turnSide,-turnSide]:[mySide||1];
      for(const sd of sides){
        if(!only&&sd!==turnSide&&mySide!==sd)continue;
        let cand=sd*(0-o.lane)>=spread?0:o.lane+sd*spread;
        if(cand!==0){const room=bpRoom(sd,.9);cand=sd>0?Math.min(cand,room):Math.max(cand,room);}
        if(sd*(cand-o.lane)<sideSpace(o)+.2&&!(only&&actualGap(o)<0))continue; // 줄였더니 사람 옆을 못 지나가면 안 씀 (이미 앞서 있으면 그대로)
        if(Math.abs(cand)>6.4&&sd!==turnSide)continue;
        if(!fits(cand,.9))continue;
        if(crosses(cand)||bpLaneSlow(cand))continue;
        if(peers.some(p=>p!==o&&p.dm>-rearSpace(p)-2&&p.dm<rearSpace(p)+12&&Math.abs(p.lane-cand)<sideSpace(p)+.15))continue;
        return cand;
      }
      return null;
    };
    // 옆으로 옮길 때 목표 줄에서 멈출 수 있는 속도 (옆 가속 5 m/s², 핸들 지연 0.35초)
    const glide=d=>clamp(Math.sqrt(3.0625+10*Math.max(0,d))-1.75,1.2,SLING_RATE);
    // dodge: 내 가속도(사람 감속과 비교), 사람이 갈 자리 예측, 비킬 줄 고르기
    if(DODGE){
      const tN=car.simT,dA=st.dgPT!=null?tN-st.dgPT:0;if(dA>1e-4&&dA<.1){const a=clamp((speed-st.dgPV)/dA,-60,30);st.dgAcc=(st.dgAcc||0)+(a-(st.dgAcc||0))*Math.min(1,dA*12);}st.dgPT=tN;st.dgPV=speed;
      // 사람의 옆 움직임은 도로 기준(lat)으로 (라인 기준 lane은 라인이 휘는 곳에서 사람이 똑바로 가도 크게 바뀜)
      const lm=st.dgLat||(st.dgLat=new Map()),seen=new Set();
      for(const o of peers){if(!o.human)continue;const k=keyOf(o),old=lm.get(k);seen.add(k);
        const raw=old&&dA>1e-4&&dA<.1?clamp((o.lat-old.lat)/dA,-8,8):0;lm.set(k,{lat:o.lat,lv:old?old.lv+(raw-old.lv)*Math.min(1,dA*10):0});}
      for(const k of lm.keys())if(!seen.has(k))lm.delete(k);
    }
    // boldpass bpred: 앞차 예측(bpPredict) + 내 계획 속도(브레이크 구간이면 내 계획 브레이크 지점에서 줄임)로 범퍼가 닿을 때 T(2.5초 안에 없으면 Infinity)·그때 앞차 줄·속도 차
    const bpMemo=new Map();
    const bpSt=o=>{const sg=st.sideSight?.get(keyOf(o)),g=actualGap(o);return {sg,g,jO:W(i0+Math.round(Math.max(0,g)/ds)),hb:boxOf(o).half+.2};};
    const bpLaneAt=(o,T)=>{const b=bpSt(o);return bpPredict(L,prof.speed,ds,b.jO,o.lane,b.sg?.ov||0,o.speed,b.sg?.acc||0,clamp(T,0,2),b.hb).lane;};
    const bpMeet=o=>{
      const key=keyOf(o);let M=bpMemo.get(key);if(M)return M;
      const b=bpSt(o),rsp=rearSpace(o),kMe=clamp(speed/Math.max(5,prof.speed[i0]),1,1.1);
      let sMe=0,vMe=speed;M={T:Infinity,lane:o.lane,vT:o.speed,closeP:0};
      if(b.g<=rsp)Object.assign(M,{T:0,closeP:speed-o.speed});
      else bpPredict(L,prof.speed,ds,b.jO,o.lane,b.sg?.ov||0,o.speed,b.sg?.acc||0,2.5,b.hb,.6,3,{},(s,vl,ln,t,hh)=>{
        const tv=kMe*prof.speed[W(i0+Math.round(sMe/ds))],vn=tv<vMe?Math.max(tv,vMe-14*hh):Math.min(tv,vMe+5*hh);
        sMe+=(vMe+vn)*.5*hh;vMe=vn;
        if(t<=2.0001){M.lane=ln;M.vT=vl;}
        if(b.g+s-sMe<=rsp){M.T=t;M.lane=ln;M.vT=vl;M.closeP=vMe-vl;return true;}
        return false;
      });
      bpMemo.set(key,M);return M;
    };
    const dgInfo=o=>{
      const sg=st.sideSight?.get(keyOf(o)),acc=sg?.acc||0,lv=st.dgLat?.get(keyOf(o))?.lv||0;
      const gap=actualGap(o),closeV=Math.max(0,speed-o.speed),rel=Math.max(0,(st.dgAcc||0)-acc);
      const T=Math.max(0,gap-rearSpace(o))/Math.max(.5,closeV+Math.min(25,rel)*.4),Tm=Math.min(T,1);
      // 만나는 자리(사람이 Tm초 뒤 갈 곳)의 라인 기준으로 사람 줄 예측
      const jM=W(i0+Math.round((Math.max(0,gap)+Math.max(0,o.speed+acc*Tm*.5)*Tm)/ds)),hb=boxOf(o).half+.2;
      const jO=W(i0+Math.round(Math.max(0,gap)/ds));
      const pred=DG_PRED_OV?clamp(o.lane+(sg?.ov||0)*Tm,L.lo[jO]+hb-L.offset[jO],L.hi[jO]-hb-L.offset[jO]):clamp(o.lat+lv*Tm-L.offset[jM],L.lo[jM]+hb-L.offset[jM],L.hi[jM]-hb-L.offset[jM]);
      if(BD_PRED&&car.grounded){const M=bpMeet(o);return {acc,lv,gap,closeV,rel,T:M.T,pred:M.lane,closeP:M.closeP};}
      return {acc,lv,gap,closeV,rel,T,pred};
    };
    const dgChoose=(o,I,prefer=0)=>{
      const w=sideSpace(o),secs=clamp(I.T+.6,.6,1.8);let best=null;
      for(const sd of [-1,1]){
        const base=sd>0?Math.max(o.lane,I.pred):Math.min(o.lane,I.pred);
        let cand=sd*(0-base)>=w+.6?0:base+sd*(w+.6);
        if(cand!==0){const room=bpRoom(sd,secs);cand=sd>0?Math.min(cand,room):Math.max(cand,room);}
        if(sd*(cand-base)<w+.25)continue;
        if(Math.abs(cand)>6.4&&sd!==turnSide)continue; // 코너 바깥쪽 아주 넓은 줄은 안 씀 (핸들이 모자라 크게 감속)
        if(!fits(cand,secs)||crosses(cand)||bpLaneSlow(cand))continue;
        if(peers.some(p=>p!==o&&p.dm>-rearSpace(p)-2&&p.dm<rearSpace(p)+12&&Math.abs(p.lane-cand)<sideSpace(p)+.15))continue;
        const d=Math.abs(cand-actualLane),tR=d/(.85*glide(d))+.35,atT=actualLane+(cand-actualLane)*Math.min(1,I.T/Math.max(.05,tR));
        const reach=sd*(atT-I.pred)>=w+.1;
        const cost=d+.15*Math.abs(cand)+(reach?0:3)+(prefer&&sd!==prefer?.8:0)+(brakeSoon&&turnSide&&sd!==turnSide?.3:0);
        if(!best||cost<best.cost)best={off:cand,side:sd,reach,cost};
      }
      return best;
    };
    const safeWindow=()=>{for(let q=0;q<(25+v*2.5)/ds;q+=3){const j=W(i0+q);if(narrowAt(j)||jumpZone?.[j]||S[j].roll||S[j].gap||track.isWaterT?.(j/N))return false;}return true;};
    const mergeHazard=!safeWindow();
    // planner: 땅 위·위험/좁은 길/합류 위험/출발 줄 아님·근처(뒤 25 m ~ 앞 max(60, 속도×2.5+30) m)에 차가 있을 때만. 아니면 예전 운전 그대로
    const plNear=!!planner&&peers.some(o=>!(o.fin&&!o.human)&&o.dm>-25&&o.dm<Math.max(60,v*2.5+30));
    const plOn=!!planner&&plNear&&!ctx.finished&&car.grounded&&car.mode!=='boat'&&car.mode!=='fly'&&car.surface!=='magnet'&&!risky&&!narrowSoon&&!mergeHazard&&speed>8&&!(ctx.since<6&&!brakeSoon&&!cornerSoon)&&ctx.since>st.react&&!(PL.noCorner===1&&(brakeSoon||cornerSoon));
    if(plOn){st.overtake=null;st.sideRetreat=null;}else if(planner)st.plC=null;
    let move=st.overtake;
    let leader=move&&peers.find(o=>move.key!=null&&keyOf(o)===move.key);
    if(move&&move.key==null){let best=8;for(const o of peers){const score=Math.abs(o.dm-move.dm)+2*Math.abs(o.lane-move.lane);if(score<best){best=score;leader=o;}}}
    const endMove=(won=false)=>{if(won)st.overtakeWins=(st.overtakeWins||0)+1;st.overtake=null;st.overtakeCool=bold?.35:1.2;st.laneHold=0;move=null;};
    const changeSide=(kind='crossover')=>{const off=options(leader,-move.side,kind==='retry'&&bold)[0];if(off==null)return false;move.off=off;move.side=Math.sign(off-leader.lane);move.switched=true;move.kind=kind;move.wideRetry=kind==='retry'&&bold;move.evadeOff=null;move.noGain=0;st.overtakeSwitches=(st.overtakeSwitches||0)+1;return true;};
    if(move){
      move.age+=dt;
      if(move.phase==='pass')move.passAge=(move.passAge||0)+dt;
      if(!leader||narrowSoon||risky||mergeHazard||ctx.finished||move.age>30)endMove();
      else{
        const gap=actualGap(leader),closing=Math.max(0,speed-leader.speed);
        if(gap<move.bestGap-.5){move.bestGap=gap;move.noGain=0;}else move.noGain=(move.noGain||0)+dt;
        if(gap < -boxOf(leader).front-ownBox.back-2-Math.max(0,leader.speed-speed))endMove(true);
        else if(gap>65 || (move.noGain>(bold?7:3)&&gap>rearSpace(leader)+2))endMove();
        else{
          const safeSwitch=!move.switched&&gap>rearSpace(leader)+.45+closing*.6;
          const defended=(leader.lane-move.startLane)*move.side>.9&&Math.abs(leader.lane-move.off)<sideSpace(leader)+.2;
          // 막힌 쪽을 한 번 바꾸거나 바깥 시도 뒤 탈출에서 안쪽 빈 공간으로 크로스오버.
          const exitCross=bold&&move.phase==='pass'&&!brakeSoon&&move.noGain>1.4&&move.wasCorner;
          if(move.bp==='dodge'){
            // dodge: 매 스텝 다시 고름. 사람이 우리 쪽으로 오면 반대쪽으로 (최대 2번, 0.3초 간격). 이미 옆·앞이면 지금 쪽 유지
            const I=dgInfo(leader);move.dgSwT=(move.dgSwT||0)+dt;
            const c=gap>rearSpace(leader)+.3?dgChoose(leader,I,move.side):null;
            if(c){
              if(c.side!==move.side){if(c.reach&&(move.dgSw||0)<2&&move.dgSwT>.3){move.side=c.side;move.off=c.off;move.dgSw=(move.dgSw||0)+1;move.dgSwT=0;st.dgSwitches=(st.dgSwitches||0)+1;}}
              else{
                // 이미 사람 줄(지금·예측)에서 충분히 비켜 있으면 더 깊이 가지 않음 (깊은 옆 줄은 코너에서 길 끝에 눌려 느려짐)
                const w=sideSpace(leader),sd=c.side,clear=!DG_OFF.has('hold')&&sd*(actualLane-I.pred)>=w+.1&&sd*(actualLane-leader.lane)>=w+.1;
                const off=clear?(sd>0?Math.min(c.off,actualLane):Math.max(c.off,actualLane)):c.off;
                if(Math.abs(off-move.off)>.3)move.off=off;
              }
              move.dgOk=c.reach&&c.side===move.side;move.dgNoneT=0;
            }else if(gap>rearSpace(leader)+.3){move.dgOk=false;move.dgNoneT=(move.dgNoneT||0)+dt;const room=bpRoom(move.side,.6);move.off=move.side>0?Math.min(move.off,room):Math.max(move.off,room);}
            move.dgLoseT=speed<leader.speed-.5&&gap>rearSpace(leader)+3?(move.dgLoseT||0)+dt:0;
            move.bpAge=(move.bpAge||0)+dt;
          }else if(move.bp){
            // 사람이 넓게 나가면 라인 쪽으로, 안쪽으로 오면 더 안쪽으로 (같은 쪽만, 0.5 m 넘게 바뀔 때만)
            const nb=bpChoose(leader,move.side);
            if(nb!=null&&Math.abs(nb-move.off)>.5)move.off=nb;
            else if(nb==null){const room=bpRoom(move.side,.6);move.off=move.side>0?Math.min(move.off,room):Math.max(move.off,room);} // 방이 줄면 같이 줄임 (길 끝에 눌린 꺾인 줄 안 씀)
            move.bpAge=(move.bpAge||0)+dt;
          }
          if(!move.bp&&safeSwitch&&(defended||!fits(move.off)||exitCross))changeSide();
          // 방어로 틈이 줄어도 같은 쪽 바깥에 공간이 남으면 더 벌려 지나간다.
          if(!move.bp&&move.phase==='pass'&&gap>rearSpace(leader)+.4&&Math.abs(move.off-leader.lane)<sideSpace(leader)+.1){
            const wider=options(leader,move.side).sort((a,b)=>Math.abs(a-move.off)-Math.abs(b-move.off))[0];
            if(wider!=null)move.off=wider;
          }
          move.wasCorner ||= cornerSoon;
          if(move.phase==='approach'){
            const off=options(leader,move.side)[0];if(off!=null)move.off=off;
            const sling=slingOK&&move.kind==='slingshot';
            const laneTime=Math.max(0,sideSpace(leader)+.2-Math.abs(leader.lat-myLat))/2.6+.35;
            // 슬립스트림 추월: 핸들을 꺾고 차가 실제로 옆으로 움직이기 시작할 때까지 약 0.45초 (car.json steerRise, 사람도 같음)
            //   아래 '빠지는 중' 판단(toSideS)과 같은 식 + 0.6초 여유 → 빠지는 동안 앞차 속도에 맞춰 브레이크를 안 밟음
            const slingTime=Math.max(0,sideSpace(leader)+.12-Math.abs(leader.lat-myLat))/(SLING_RATE*.7)+.45+.6;
            const pullAt=sling?rearSpace(leader)+.25+Math.max(2,closing*slingTime):rearSpace(leader)+Math.max(bold?3.5:5,closing*laneTime+v*.04);
            if(gap<pullAt&&fits(move.off,move.shortFit&&nfOK(leader)?.6:1.1)) {move.phase='pass';move.kind=brakeSoon&&move.side===turnSide?'dive':cornerSoon?'outside':'slingshot';move.sling=sling&&move.kind==='slingshot';}
          }else if(move.bp?(!(move.side===turnSide||!turnSide?fitsBP(move.off,move.side,.6):fits(move.off,.6))&&gap>rearSpace(leader)+1||move.bpAge>9||move.bp==='dodge'&&(move.dgLoseT>1.2||move.dgNoneT>.8)):(!fits(move.off,move.shortFit?.6:1.1,!!move.wideRetry)||laneTooSlow(move.off,leader))&&gap>rearSpace(leader)+1)endMove();
          // 추월 줄이 앞차와 여전히 겹쳐 뒤에 붙어 있으면 (앞차가 줄을 바꿨거나 굽은 길이라 선택지가 없었음)
          //   0.8초 뒤 같은 쪽을 더 넓게 → 안 되면 반대쪽으로, 짧은 앞(0.6초)만 보고 도로 안에서. 한 추월에 2번까지
          if(move&&move.phase==='pass'){
            const blocked=gap>0&&gap<rearSpace(leader)+10&&Math.abs(leader.lat-myLat)<sideSpace(leader)+.05;
            move.blockT=blocked?(move.blockT||0)+dt:0;
            if(STUCK_RETRY&&blocked&&move.blockT>.8&&(move.retries||0)<2&&bold&&gap>rearSpace(leader)+.45+closing*.6&&!brakeSoon&&!crowded(leader)){
              const off=options(leader,move.side,true,.6)[0]??options(leader,-move.side,true,.6)[0];
              if(off!=null){move.off=off;move.side=Math.sign(off-leader.lane);move.wideRetry=true;move.shortFit=true;move.switched=true;move.kind='retry';move.retries=(move.retries||0)+1;move.blockT=0;move.noGain=0;move.evadeOff=null;st.overtakeSwitches=(st.overtakeSwitches||0)+1;}
            }
          }
        }
      }
    }
    // 실제 옆면 접촉 직후에는 같은 옆줄의 차를 앞차로 오인하지 않는다.
    // 코너 속도 계획/조향 한계와 좁아짐/점프의 안전 제동은 그대로 둔다.
    // 라인 허용 폭에는 이미 차 중심 여유가 들어 있다. 현재 실제 움직임과 차 폭으로 짧은 앞 구간만 확인한다.
    const contactRoom = () => {
      const p = new THREE.Vector3();
      for (const sec of [0, .125, .25]) {
        p.copy(car.pos).addScaledVector(car.vel, sec);
        const near = track.nearest(p), sample = near.sample;
        if (!sample || Math.abs(p.y - sample.pos.y) > 2) return false;
        const tan = sample.tan, tl = Math.hypot(tan.x, tan.z) || 1, fl = Math.hypot(car.fwd.x, car.fwd.z) || 1;
        const along = Math.abs((car.fwd.x * tan.x + car.fwd.z * tan.z) / (fl * tl));
        const across = Math.abs((car.fwd.x * tan.z - car.fwd.z * tan.x) / (fl * tl));
        const reach = ownBox.half * along + Math.max(ownBox.front, ownBox.back) * across;
        const edge = (sample.hw ?? (track.width || 16) / 2) + (track.kerbAt?.(near.index, near.lateral < 0 ? -1 : 1) || 0) - .5;
        if (Math.abs(near.lateral) + reach > edge) return false;
      }
      return true;
    };
    let sideContactAnswer;
    const briefSideContact = o => {
      const age = car.simT - (car._sideContactAt ?? -Infinity);
      if (!o.human || o.pos !== car._sideContactOther || age < 0 || age > 3 || cornerSoon || brakeSoon || risky || mergeHazard || speed < 12) return false;
      if (sideContactAnswer !== undefined) return sideContactAnswer;
      sideContactAnswer = false;
      // 접촉 뒤 판단을 유지하는 3초 안에 다른 차가 닿을 수 있는 무리에서는 원래 제동을 유지한다.
      if (peers.some(p => p !== o && (!p.pos || car.pos.distanceToSquared(p.pos) < (35 + v * 3) ** 2))) return false;
      const f = o.fwd, fl = f && Math.hypot(f.x, f.z), ownFl = Math.hypot(car.fwd.x, car.fwd.z);
      if (!(fl > 0 && ownFl > 0) || (f.x * car.fwd.x + f.z * car.fwd.z) / (fl * ownFl) < .98 ||
          Math.abs(actualGap(o)) > rearSpace(o) + 3 ||
          Math.abs(o.lat - myLat) < (ownBox.half + boxOf(o).half) * .6 || !contactRoom()) return false;
      // 도로 축에 투영한 큰 직사각형 대신 실제 외곽과 짧은 접근을 확인한다.
      // 계속 옆으로 닿는 것은 전방 추돌이 아니다. 앞/뒤 면으로 만날 위험이 있으면 원래 제동.
      const own = { pos: car.pos.clone(), fwd: car.fwd, up: car.up, _displayHitbox: ownBox };
      const other = { pos: o.pos.clone(), fwd: o.fwd, up: car.up, _displayHitbox: boxOf(o) };
      for (const sec of [0, .15, .3]) {
        own.pos.copy(car.pos).addScaledVector(car.vel, sec);
        if (car.cNudge) own.pos.addScaledVector(car.cNudge, sec);
        other.pos.copy(o.pos).addScaledVector(o.fwd, o.speed * sec / fl);
        const hit = obbOverlap(own, other);
        if (hit.hit && Math.abs(hit.normal.x * car.fwd.x + hit.normal.z * car.fwd.z) / ownFl > .7) {
          const closing = (car.vel.x - o.fwd.x * o.speed / fl) * hit.normal.x + (car.vel.z - o.fwd.z * o.speed / fl) * hit.normal.z;
          if (closing < -.1) return false;
        }
      }
      sideContactAnswer = true;
      return true;
    };
    // boldpass: 이 차와는 과감하게 (사람 상대, 땅 위, 내 줄이 앞 0.6초 도로 안)
    let bdRoomA;
    const bdFor = o => BOLD && bold && !!o && !o.fin && (BD_ALL || !!o.human) && car.grounded && car.mode !== 'boat' && car.mode !== 'fly' && car.surface !== 'magnet'
      && !risky && !narrowSoon && !mergeHazard && speed > 12 && (bdRoomA ??= fits(actualLane, .6));
    const noseIn = o => rearSpace(o) - actualGap(o); // + = 내 앞 끝이 상대 뒤 끝보다 그만큼 앞 (나란히)
    let bdTag = '';

    let want=st.laneTarget;
    // merge: 코너 안에서는 바깥쪽으로 라인에 돌아올 때만 (안쪽으로 조이면 핸들이 모자라 크게 감속)
    const mergeOut=CORNERPASS&&!CP_OFF.has('merge')&&!beside.length&&car.grounded&&!risky&&Math.abs(st.lane)>.3&&Math.sign(-st.lane)===Math.sign(L.curvature[i0])&&Math.abs(L.curvature[i0])>1/2000;
    const launchColumns=ctx.since<6&&!narrowSoon&&!brakeSoon&&!cornerSoon;
    if(launchColumns)want=clamp(st.gridLat-L.offset[i0],L.lo[i0]+.35-L.offset[i0],L.hi[i0]-.35-L.offset[i0]);
    else if(narrowSoon||mergeHazard)want=0;
    else if(!plOn){
      st.otWhy=move?'':!front?'nofront':risky?'risky':st.overtakeCool>0?'cool':''; // (진단) 추월을 시작 안 한 이유
      // 시작은 코너 들어가기 전(내 자리가 거의 곧은 곳)에서만 (코너 출구에서 앞차가 조금 줄인 것을 '일찍 밟음'으로 보고 안쪽으로 파고들다 핸들이 모자랐음)
      if((BK_EARLY||BK_LATE)&&bold&&!ctx.finished&&!risky&&!narrowSoon&&!mergeHazard&&car.grounded&&car.mode!=='boat'&&car.mode!=='fly'&&car.surface!=='magnet'&&speed>15&&(brakeSoon||cornerSoon)&&Math.abs(L.curvature[i0])<1/300&&!(move&&move.bp)){
        let o=null,og=45;
        for(const p of peers){if(p.fin||!(BK_ALL||p.human))continue;const g=actualGap(p);if(g>-1&&g<og&&!peers.some(q=>q!==p&&q.dm>-4&&q.dm<45)&&(BK_ALL||nfOK(p))){o=p;og=g;}}
        if(o&&(!move||keyOf(o)===move.key)){
          const jL=W(i0+Math.round(og/ds)),acc=st.sideSight?.get(keyOf(o))?.acc||0;
          const vMine=prof.speed[jL]*kRefBP,vLine=prof.speed[jL]*Math.max(1,kRefBP);
          let kind=null;
          if(BK_EARLY&&acc<-5&&o.speed<vMine-Math.max(2.5,.05*vMine)&&speed>o.speed-1&&prof.speed[i0]*kRefBP>speed-1.5)kind='early';
          else if(BK_LATE&&o.speed>vLine+Math.max(3,.06*vLine)&&(prof.brake[jL]||Math.abs(L.curvature[jL])>1/150))kind='late';
          st.bpSeen=kind||st.bpSeen;
          const off=kind?bpChoose(o):null;
          if(off!=null){
            move=st.overtake={key:keyOf(o),off,side:Math.sign(off-o.lane)||turnSide||1,startLane:o.lane,phase:'pass',base:actualLane,bestGap:og,switched:true,retries:2,age:0,noGain:0,wasCorner:cornerSoon,dm:o.dm,lane:o.lane,sep:Math.abs(o.lat-myLat),sepV:0,kind:'dive',bp:kind,bpAge:0};
            leader=o;st.overtakeStarts=(st.overtakeStarts||0)+1;st.bpStarts=(st.bpStarts||0)+1;
          }
        }
      }
      if(DG_START&&bold&&!ctx.finished&&!risky&&!narrowSoon&&!mergeHazard&&car.grounded&&car.mode!=='boat'&&car.mode!=='fly'&&car.surface!=='magnet'&&speed>15&&ctx.since>2&&!(move&&move.bp==='dodge')){
        let o=null,og=90;
        for(const p of peers){if(p.fin||!(p.human||BD_ALL&&BD_DODGE))continue;const g=actualGap(p);if(g>rearSpace(p)+.3&&g<og&&(nfOK(p)||BD_DODGE&&bdFor(p)&&!peers.some(q=>q!==p&&q.dm>-rearSpace(q)-1&&q.dm<g+3))){o=p;og=g;}}
        if(o&&(!move||keyOf(o)===move.key)){
          const I=dgInfo(o),w=sideSpace(o);
          const urgent=Math.max(I.closeV+Math.min(25,I.rel)*.5,I.closeP||0)>Math.max(6,.08*speed)&&I.T<DG_T&&(Math.abs(I.pred-actualLane)<w+1||Math.abs(o.lat-myLat)<w+1);
          const conflict=!move||move.phase==='approach'||Math.abs(move.off-I.pred)<w+.2||Math.abs(move.off-o.lane)<w+.2;
          if(urgent&&conflict){
            const c=dgChoose(o,I,move?.side||0);st.dgSeen=(st.dgSeen||0)+1;
            if(c&&c.reach){
              if(!move)st.overtakeStarts=(st.overtakeStarts||0)+1;
              move=st.overtake={key:keyOf(o),off:c.off,side:c.side,startLane:o.lane,phase:'pass',base:actualLane,bestGap:I.gap,switched:true,retries:2,age:move?move.age:0,noGain:0,wasCorner:cornerSoon,dm:o.dm,lane:o.lane,sep:move?move.sep:Math.abs(o.lat-myLat),sepV:move?move.sepV:0,passAge:move?.passAge||0,kind:'dodge',bp:'dodge',bpAge:0,dgOk:c.reach,dgSw:0,dgSwT:0,dgLoseT:0,dgNoneT:0};
              leader=o;st.dgStarts=(st.dgStarts||0)+1;
            }
          }
        }
      }
      if(!move&&front&&!ctx.finished&&!risky&&st.overtakeCool<=0){
        // 마스터끼리는 작은 속도 차로 코너에서 싸우지 않고 직선의 뚜렷한 기회를 쓴다.
        // 사람 상대는 기존의 과감한 추월 판단을 유지한다.
        const cooperative=!!level.master&&!front.human;
        const closing=Math.max(0,speed-front.speed),gap=actualGap(front),minClosing=cooperative?1.2:bold?.2:1.1;
        const trapped=gap<25&&st.heldT>(bold?.25:.9)&&st.tgt0>front.speed+.15;
        const closeOK=nfOK(front)&&!NF_OFF.has('close')?rearSpace(front)-.3:rearSpace(front)+.3;
        st.otWhy=!(gap>closeOK)?(DBG_OT?'close'+gap.toFixed(2)+'/'+rearSpace(front).toFixed(2)+'c'+closing.toFixed(1):'close'):!(gap<Math.min(65,Math.max(30,v*1.1)))?'far':!(closing>minClosing||trapped)?'noclose':!(bold||!cornerSoon)?'corner':(cooperative&&!(!brakeSoon&&!cornerSoon&&(closing>1.2||st.heldT>2)))?'coop':'';
        if(gap>closeOK&&gap<Math.min(65,Math.max(30,v*1.1))&&(closing>minClosing||trapped)&&(bold||!cornerSoon)&&(!cooperative||!brakeSoon&&!cornerSoon&&(closing>1.2||st.heldT>2))){
          const choices=options(front).sort((a,b)=>{
            const fP=BD_PRED&&bdFor(front)?bpLaneAt(front,1):null;
            const cost=x=>Math.abs(x-st.lane)+(brakeSoon&&Math.sign(x-front.lane)!==turnSide?1.1:0)+(fP!=null&&Math.abs(x-fP)<sideSpace(front)+.2?1.5:0);
            return cost(a)-cost(b);
          });
          let off=choices[0],short=false;
          // 코너 안·제동 구간에서 앞차가 확 느려졌으면(이 자리 계획 속도의 85%보다 2 m/s 넘게 느림) 0.6초 앞까지만 도로 안이면 됨 (지나가는 데 오래 안 걸림)
          //   이때는 라인에서 6.4 m 넘게 떨어진 넓은 쪽도 씀 (코너에서 라인이 한쪽 끝에 붙으면 반대쪽은 10 m 넘게 비어 있음)
          //   ('safe' = 6.4 m 제한만 풀고 차 전체가 도로 안에 들어가는 자리만: 길 끝 0.4 m 여유로는 사람 근처 봇이 길 밖으로 나갔음)
          if(off==null&&nfOK(front)&&!NF_OFF.has('wide')&&(front.speed<prof.speed[i0]*.85-2||(st.sideSight?.get(keyOf(front))?.acc||0)<-4)){off=options(front,0,'safe',.6).sort((a,b)=>Math.abs(a-st.lane)-Math.abs(b-st.lane))[0];short=off!=null;}
          if(off==null){st.otWhy='nolane';if(DBG_OT){const spread=Math.max(3.1,sideSpace(front)+(bold?.5:.75));st.otWhy+=` L${front.lane.toFixed(1)} sp${spread.toFixed(1)} `+[-spread,spread,front.lane-spread,front.lane+spread].map(o=>o.toFixed(1)+':'+(Math.abs(o)>6.4?'w':'')+(Math.abs(o-front.lane)<sideSpace(front)+.2?'s':'')+(!fits(o,.5)?'f':'')+(crosses(o)?'x':'')+(laneTooSlow(o,front)?'t':'')).join(',')+` lo${(L.lo[i0]-L.offset[i0]).toFixed(1)} hi${(L.hi[i0]-L.offset[i0]).toFixed(1)}`;}}
          if(off!=null){move=st.overtake={key:keyOf(front),off,side:Math.sign(off-front.lane),startLane:front.lane,phase:gap<rearSpace(front)+4?'pass':'approach',base:Math.abs(st.lane)<2?0:Math.round(st.lane/3.1)*3.1,bestGap:gap,switched:false,age:0,noGain:0,wasCorner:cornerSoon,dm:front.dm,lane:front.lane,sep:Math.abs(front.lat-myLat),sepV:0,kind:brakeSoon&&Math.sign(off-front.lane)===turnSide?'dive':cornerSoon?'outside':'slingshot'};leader=front;st.overtakeStarts=(st.overtakeStarts||0)+1;if(short){move.shortFit=true;move.wideRetry=true;}}
        }
      }
      if(move){
        move.dm=leader.dm+(leader.speed-speed)*dt;move.lane=leader.lane;
        const separation=Math.abs(leader.lat-myLat),rate=clamp((separation-move.sep)/Math.max(.001,dt),-8,8);
        move.sepV+=(rate-move.sepV)*Math.min(1,dt*8);move.sep=separation;
        // tow: 사람 뒤 준비 중엔 그 차 줄 뒤(슬립스트림)에 붙음, 직선(코너·제동 구간 아님)·길 안에서만
        want=move.phase==='approach'?(cpFor(leader,'tow')&&!cornerSoon&&!brakeSoon&&fits(leader.lane+move.side*.35)?leader.lane:move.base)+move.side*.35:move.off;
        st.laneHold=1.2;busy=true;attack={dM:leader.dm,o:leader};
        if(move.phase==='pass'&&brakeSoon&&turnSide===move.side&&actualGap(leader)>0&&actualGap(leader)<25&&separation>sideSpace(leader)+.05)lateBrake=intent;
      }else if(st.laneHold<=0&&!crosses(0)&&(!cornerSoon||mergeOut))want=0;
      if(!move&&!fits(want)){want=0;st.laneHold=0;}
    }
    // 레이싱 라인의 이동을 뺀 옆 접근. 다른 차가 없는 두 대의 접전에서만 재시도를 준비한다.
    const oldSight=st.sideSight||new Map(),sight=new Map();
    for(const o of peers){
      const key=keyOf(o),old=oldSight.get(key),sep=o.lat-myLat,side=Math.sign(sep);
      const raw=old?clamp((o.lane-old.lane)/Math.max(.001,dt),-8,8):0;
      const ownRaw=old?clamp((actualLane-old.mine)/Math.max(.001,dt),-8,8):0;
      const ov=(old?.ov||0)+(raw-(old?.ov||0))*Math.min(1,dt*10);
      const mv=(old?.mv||0)+(ownRaw-(old?.mv||0))*Math.min(1,dt*10);
      const acc=old&&old.sp!=null?(old.acc||0)+(clamp((o.speed-old.sp)/Math.max(.001,dt),-60,30)-(old.acc||0))*Math.min(1,dt*12):0;
      sight.set(key,{lane:o.lane,mine:actualLane,ov,mv,sp:o.speed,acc});
      if(!old||!move||leader!==o||o.fin||!o.fwd||crowded(o)||risky||mergeHazard||narrowSoon||!car.grounded||speed<12||car.mode==='fly'||car.mode==='boat'||car.fwd.dot(o.fwd)<.94)continue;
      const gap=actualGap(o),width=sideSpace(o);
      if(gap<-(ownBox.front+ownBox.back)*.25&&Math.abs(gap)<rearSpace(o)+2&&move.phase==='pass'&&Math.abs(sep)>width*.6&&Math.abs(sep)<width+.7&&!cornerSoon&&!brakeSoon&&-ov*side>.45&&(mv-ov)*side>.35){
        const away=move.evadeOff??(move.off-side*(bold?.4:.2));
        if(fits(away,1.1,!!move.wideRetry)&&!crosses(away)){move.evadeOff=away;move.off=away;want=away;st.laneHold=1.2;}
      }
      if(gap>0&&gap<rearSpace(o)+2&&Math.abs(sep)>width*.6&&Math.abs(sep)<width+1.8&&-ov*side>.45&&(mv-ov)*side>.35)
        st.sideRetreat={key,side:move.side,off:move.off,switched:move.switched,until:st.t+4};
    }
    st.sideSight=sight;
    const retreat=st.sideRetreat,peer=retreat&&peers.find(o=>keyOf(o)===retreat.key);
    if(retreat&&(!peer||st.t>retreat.until||risky||mergeHazard))st.sideRetreat=null;
    else if(peer){
      const gap=actualGap(peer),width=sideSpace(peer);
      if(gap<-(ownBox.front+ownBox.back)*.25||Math.abs(peer.lat-myLat)>width+.15)st.sideRetreat=null;
      else if(gap<rearSpace(peer)+2){retreat.clearT=0;}
      else{
        const off=move&&leader===peer?move.off:retreat.off;
        const motion=sight.get(keyOf(peer));
        const opening=motion&&(motion.ov-motion.mv)*Math.sign(peer.lat-myLat)>.3;
        const open=opening||(off!=null&&Math.abs(off-peer.lane)>width+.25&&fits(off,1.1,!!move?.wideRetry));
        retreat.clearT=(retreat.clearT||0)+dt;
        if(!open&&retreat.clearT>=.5&&bold&&!retreat.switched&&!crowded(peer)){
          if(move&&leader===peer&&!move.switched){if(changeSide('retry')){move.phase='pass';want=move.off;}}
          else if(!move){
            const next=options(peer,-retreat.side,true)[0];
            if(next!=null){
              move=st.overtake={key:keyOf(peer),off:next,side:Math.sign(next-peer.lane),startLane:peer.lane,phase:'pass',base:actualLane,bestGap:gap,switched:true,age:0,noGain:0,wasCorner:cornerSoon,dm:peer.dm,lane:peer.lane,sep:Math.abs(peer.lat-myLat),sepV:0,kind:'retry',wideRetry:true};
              leader=peer;want=next;st.laneHold=1.2;busy=true;attack={dM:peer.dm,o:peer};st.overtakeStarts=(st.overtakeStarts||0)+1;st.overtakeSwitches=(st.overtakeSwitches||0)+1;
            }
          }
        }
        if(open||retreat.clearT>=.5)st.sideRetreat=null;
      }
    }
    // hug: 사람 옆에 나란히 있을 때(추월 줄이 아님) 가고 싶은 줄 = 라인에 가장 가까우면서 그 차에서 차 폭+0.55 m 떨어진 줄
    if(!plOn&&!launchColumns&&!move&&!narrowSoon&&!mergeHazard&&car.grounded&&beside.length===1&&cpFor(beside[0],'hug')){
      const o=beside[0],sd=Math.sign(actualLane-o.lane)||1,sep=sideSpace(o)+.55;
      const cand=sd*(0-o.lane)>=sep?0:o.lane+sd*sep;
      if(fits(cand,.6)&&(cand-o.lane)*sd>0)want=cand;
    }
    if(!plOn&&BRAKEPASS&&!BK_OFF.has('hold')&&bold&&!launchColumns&&!move&&car.grounded){
      // brakepass: 추월이 끝난 뒤(또는 시작 전) 옆에 비켜 있는데 사람이 옆~바로 앞이면, 사람 줄에서 차 폭+0.3 m 안으로는 돌아오지 않음
      //   (슬립스트림에서 빠졌다 추월을 그만두고 라인으로 돌아오다 아직 옆에 있던 사람을 밀었음 = 닿음·강한 접촉)
      for(const o of peers){
        if(!o.human||o.fin||!nfOK(o))continue;
        const g=actualGap(o),sd=Math.sign(actualLane-o.lane)||1;
        if(g>-rearSpace(o)&&g<rearSpace(o)+4&&Math.abs(o.lat-myLat)>=sideSpace(o)-.1){
          const minL=o.lane+sd*(sideSpace(o)+.3);
          if(sd*(want-minL)>=0)continue;
          // 그 줄이 앞으로 도로 안에 다 들어가면 버팀, 아니면(코너 바깥으로 밀려남) 줄은 그대로 두고 살짝 늦춰서 사람 뒤로 빠짐
          const keep=sd*(actualLane-minL)<0?actualLane:minL;
          if(fits(keep,.6))want=keep;else{want=actualLane;if(BD_HOLD&&bdFor(o)&&noseIn(o)>=BD_NOSE)bdTag='hold';else setF(Math.max(3,o.speed-1.5),'holdback'+(o.human?'H':'B'));}
        }
      }
    }
    if(!plOn&&!launchColumns&&Math.abs(want-actualLane)>.15&&crosses(want)) {
      // 자기 줄로 되돌아오는 작은 보정은 버티고, 옆 차를 가로지르는 합류만 보류.
      const blockedBy=beside.filter(o=>(want-o.lane)*(actualLane-o.lane)<0||Math.abs(want-o.lane)<sideSpace(o)+.12);
      for(const o of blockedBy)if(!briefSideContact(o)&&yieldTo(o)&&Math.abs(actualLane-o.lane)<sideSpace(o)*.75&&!(BD_YIELD&&bdFor(o)&&noseIn(o)>=BD_NOSE&&(bdTag='yield')))setF(Math.max(3,o.speed-1),'yield'+(o.human?'H':'B'));
      want=actualLane;
    }
    if(beside.length&&!risky&&!mergeHazard)hold=bold?.25:.1;
    // --- planner: 0.1초마다 후보 길을 미리 달려 보고 고름 ---
    let plC=null;
    if(plOn){
      st.plT-=dt;
      if(st.plT<=0||!st.plC){
        st.plT+=PL.every;if(st.plT<0)st.plT=PL.every;
        const kPl=(exactMaster?1:pace*st.paceMul)*eq.kMul,kBPl=Math.min(1.03,(level.brakeK??0.95)*Math.min(1,kPl));
        const ev=st.prevLat!=null?clamp((actualLane-st.prevLat)/Math.max(1e-3,dt),-8,8):0;st.plEv=(st.plEv??ev)+(ev-(st.plEv??ev))*Math.min(1,dt*12);
        const oth=[];
        for(const o of peers){if(o.fin&&!o.human)continue;const g=actualGap(o);if(g<-30||g>v*PL.T+70)continue;const sg=st.sideSight?.get(keyOf(o));
          oth.push({key:keyOf(o),g,lane:o.lane,ov:sg?.ov||0,acc:sg?.acc||0,v:o.speed,Lf:rearSpace(o),Lb:projection(ownBox,car.fwd,false)+projection(boxOf(o),o.fwd,true),W:sideSpace(o),hb:boxOf(o).half+.2,human:!!o.human});}
        const t0=performance.now();
        st.plC=planner.plan({holdOnly:PL.noCorner===2&&(brakeSoon||cornerSoon),m:Math.max(1,ownBox.half),i0,v:speed,e0:actualLane,ev:st.plEv,c0:st.lane,d0:car.draft||0,k:kPl,kB:kBPl,g:gHere,lead:level.lead||0,topCap:level.topK?vTop*level.topK*(car.aeroTopMul?car.aeroTopMul(true):1):Infinity,aeroTop:car.aeroTopMul?car.aeroTopMul(true):1,vTop,drag:car.cfg.aero.drag,bold,others:oth,prev:st.plC,dump:PL_DUMP?(st.plDump={}):null});
        st.plMs=(st.plMs||0)+(performance.now()-t0);st.plN=(st.plN||0)+1;
      }
      plC=st.plC;want=plC.eT;
      // 옆에 나란히 있는 차를 가로지르는 줄은 그 차 옆까지만 (옆으로 박기 = 세게 닿음 방지; 예전 crosses 규칙과 같은 기준)
      if(!launchColumns&&PL.guard)for(const o of beside){if(o.fin&&!o.human)continue;const sw=sideSpace(o)+.15,sd=Math.sign(actualLane-o.lane)||1;
        if((want-o.lane)*sd<sw){want=o.lane+sd*sw;st.plGuard=(st.plGuard||0)+1;}}
      st.laneHold=Math.abs(want)>.3?.5:0;
    }
    st.laneTarget=plOn?clamp(want,Math.min(0,L.lo[i0]+Math.max(1,ownBox.half)-L.offset[i0]),Math.max(0,L.hi[i0]-Math.max(1,ownBox.half)-L.offset[i0])):move?.wideRetry||move?.bp?clamp(want,L.lo[i0]+.2-L.offset[i0],L.hi[i0]-.2-L.offset[i0]):clamp(want,-6.4,6.4);
    // 앞차가 브레이크 중(감속 3 m/s² 넘음)이면 슬립스트림 추월의 '브레이크 안 밟기'를 쓰지 않음 (NOFOLLOW: 아래 '빠지는 중' 제동으로)
    const leaderBraking=nfFor(leader)&&!NF_OFF.has('evade')&&(sight.get(keyOf(leader))?.acc||0)<-3;
    const slingNow=!!(move&&move.sling&&move.phase==='pass'&&slingOK&&!leaderBraking&&!beside.some(o=>o!==leader));
    // 빠지는 중(슬립스트림 추월이 아닌 추월): 땅 위·옆에 다른 차 없음·짧은 앞이 도로 안일 때. 코너에서는 접지 여유(계획 속도보다 15% 넘게 느림)가 있을 때만 빠르게
    const bpMove=!!(move&&move.bp);
    // 사람과 단둘일 때(내 옆~앞 90 m에 사람만): 옆 줄 커브 한계를 매끈한 계산으로 (예전 6 m 간격 계산은 슬립스트림 추월 뒤 남은 옆 거리 2~4 m에서
    //   라인 계획의 35~50%로 나와, 사람이 밟기 0.5~1초 전에 'lane' 브레이크를 밟았음 = 늦게 밟은 사람도 못 지나감)
    const bpAloneH=BRAKEPASS&&!BK_OFF.has('curve')&&bold&&(bpMove||!BK_OFF.has('alone')&&(BK_ALONE==='all'||!!(move&&move.phase==='pass'))&&peers.some(o=>o.human&&!o.fin&&o.dm>-8&&o.dm<90)&&!peers.some(o=>!o.human&&o.dm>-8&&o.dm<90));
    const evadeNow=!!((nfOK(leader)||bpMove&&BK_ALL)&&!NF_OFF.has('evade')&&!slingNow&&move&&move.phase==='pass'&&car.grounded&&car.mode!=='boat'&&car.mode!=='fly'&&car.surface!=='magnet'&&!risky&&!narrowSoon&&!mergeHazard&&!beside.some(o=>o!==leader)&&(bpMove?(move.side===turnSide||!turnSide?fitsBP(move.off,move.side,.6):fits(move.off,.6)):fits(move.off,.6,!!move.wideRetry)));
    const evadeRate=!evadeNow?0:bpMove?glide(Math.abs(st.laneTarget-st.lane)):!cornerSoon?(BRAKEPASS&&!BK_OFF.has('glide')&&bold?clamp(Math.sqrt(7.29+12*Math.abs(st.laneTarget-st.lane))-2.7,1.2,SLING_RATE):SLING_RATE):speed<prof.speed[i0]*.85?4.5:0;
    const slingGlide=slingNow&&BRAKEPASS&&!BK_OFF.has('glide')&&nfOK(leader);
    let laneRate=slingNow?(slingGlide?clamp(Math.sqrt(7.29+12*Math.abs(st.laneTarget-st.lane))-2.7,1.2,SLING_RATE):SLING_RATE):bpMove&&evadeRate?evadeRate:evadeRate?Math.max(evadeRate,2.6):cornerSoon&&speed>35?(bold?2:1.6):2.6;
    // dodge: 비키기가 끝난 뒤 3초 동안 라인으로 돌아올 때 옆에 차가 없으면 비킬 때와 같은 속도로 (예전 2 m/s로 천천히 돌아오는 동안 코너 안쪽 줄에 남아 'lane' 브레이크)
    if(move&&move.bp==='dodge')st.dgLastT=st.t;
    if(DG_CURVE&&!DG_OFF.has('back')&&!move&&st.t-(st.dgLastT??-99)<3&&!beside.length&&car.grounded&&Math.abs(st.laneTarget)<Math.abs(st.lane)-.3)laneRate=Math.max(laneRate,glide(Math.abs(st.laneTarget-st.lane)));
    if(plOn)laneRate=plC.r;
    const laneRateS=MLANE2&&exactMaster?Math.min(laneRate,Math.sqrt(2*3.5*Math.abs(st.laneTarget-st.lane))+.3):laneRate;
    st.lane+=clamp(st.laneTarget-st.lane,-laneRateS*dt,laneRateS*dt);
    let lane=st.lane;

    let evadeTc=Infinity;
    if(plOn){
      // planner F: 고른 앞차(없으면 같은 줄 가장 가까운 앞차)를 실제 간격으로 따라감
      if(plC.pol==='F'){
        const kPl=(exactMaster?1:pace*st.paceMul)*eq.kMul,kBPl=Math.min(1.03,(level.brakeK??0.95)*Math.min(1,kPl));
        let o=peers.find(p=>keyOf(p)===plC.folKey);
        if(!o)for(const p of peers){const gp=actualGap(p);if(gp>rearSpace(p)*.6&&Math.abs(p.lat-myLat)<sideSpace(p)-.1&&(!o||gp<actualGap(o)))o=p;}
        if(o&&actualGap(o)>rearSpace(o)*.6&&Math.abs(o.lat-myLat)<sideSpace(o)+.3)setF(planner.followSpeed(speed,actualGap(o),rearSpace(o),o.speed,kBPl,gHere),'plF');
      }
      // 마지막 안전망: 바로 앞(옆으로 많이 겹침)에 0.45초 안에 닿고 그 전에 옆으로 못 비키면 앞차 속도 −1
      for(const o of peers){if(o.fin&&!o.human)continue;const gap=actualGap(o),dLat=o.lat-myLat,width=sideSpace(o),closing=speed-o.speed;
        if(!(gap>0&&gap<60&&closing>.5&&Math.abs(dLat)<width*.75))continue;
        const tc=Math.max(0,gap-rearSpace(o))/closing,want=clamp(L.offset[i0]+st.laneTarget,L.lo[i0]+.2,L.hi[i0]-.2);
        const away=Math.abs(want-o.lat)>width+.1,tClear=away?Math.max(0,width+.1-Math.abs(dLat))/Math.max(.8,laneRate*.6)+.3:Infinity;
        if(tc<.45&&tClear>tc)setF(Math.max(0,o.speed-1),'plSafe');}
    }
    else for(const o of peers){
      const dLat=o.lat-myLat,gap=actualGap(o),closing=Math.max(0,speed-o.speed),width=sideSpace(o);
      if(!briefSideContact(o)&&gap>0&&gap<100&&Math.abs(dLat)<width+.08){
        const target=!!move&&o===leader;
        if((BD_SIDE||BD_REAR)&&bdFor(o)){
          const nose=noseIn(o);
          // side: 이미 나란히 (내 앞 끝이 상대 뒤 끝보다 1 m 넘게 앞, 옆으로 비켜 있음) → 닿아도 옆으로 비빔, 브레이크 안 함
          if(BD_SIDE&&nose>=BD_NOSE&&Math.abs(dLat)>=width*.4){bdTag='side';continue;}
          // rear: 추월 중 뒤에서 다가감 → 범퍼가 닿는 순간 옆으로 얼마나 겹칠지
          if(BD_REAR&&target&&move.phase==='pass'&&nose<BD_NOSE){
            const sg=sight.get(keyOf(o)),gN=gap-rearSpace(o),Tp=clamp(Math.max(0,gN)/Math.max(closing,.5),0,1.2);
            // 내 옆 움직임: 지금 움직임(mv), 가려는 줄 쪽이면 핸들 지연(0.35초) 뒤 줄 이동 속도의 70%까지, 가려는 줄을 넘지 않음
            const want=clamp(L.offset[i0]+st.laneTarget,L.lo[i0]+.2,L.hi[i0]-.2)-myLat,mv=sg?.mv||0;
            const mvE=Math.sign(want)===Math.sign(mv)||Math.abs(want)<.05?Math.max(Math.abs(mv),laneRate*.7*clamp((Tp-.35)/Math.max(Tp,.01),0,1)):0;
            const myMove=Math.abs(want)<.05?mv*Tp:Math.sign(want)*Math.min(Math.abs(want),mvE*Tp);
            const sepT=dLat+(BD_PRED?bpLaneAt(o,Tp)-o.lane:(sg?.ov||0)*Math.min(Tp,.6))-myMove;
            const ovl=Math.sign(sepT)!==Math.sign(dLat)&&Math.abs(dLat)>.05?width:width-Math.abs(sepT);
            if(ovl<=0){bdTag='clear';continue;}
            if(ovl<=BD_OVL){bdTag='nudge';setF(Math.sqrt((o.speed+BD_CV)**2+2*6*gHere*Math.max(0,gN-.3)),'bold'+(o.human?'H':'B'));continue;}
          }
        }
        const desired=clamp(L.offset[i0]+st.laneTarget,L.lo[i0]+.2,L.hi[i0]-.2);
        const toSide=target&&move.sepV>.25?Math.max(0,width+.12-Math.abs(dLat))/move.sepV:Infinity;
        const envelope=rearSpace(o)+.25;
        const toRear=closing>.1?(gap-envelope)/closing:Infinity;
        // 슬립스트림 추월 중이면 아직 옆으로 움직이기 전이라도 '곧 빠질 것'을 계산에 넣음 (예전엔 빠지는 0.5초 동안 앞차 속도에 맞춰 브레이크 → 모은 속도를 다 잃음)
        const toSideS=slingNow&&target?Math.max(0,width+.12-Math.abs(dLat))/Math.max(move.sepV,SLING_RATE*.7)+(move.sepV<1?Math.max(.1,.45-(move.passAge||0)):0):Infinity;
        const clearing=target&&move.phase==='pass'&&Math.abs(desired-o.lat)>width+.12&&(toSide+.2<toRear&&gap>envelope+.5||toSideS+.1<toRear&&gap>envelope+.3);
        const gapM=envelope+Math.max(0,speed)*(bold?.025:.06);
        if(!clearing){
          // 슬립스트림에서 빠지는 첫 1.2초는 사람처럼 액셀을 유지 (정말 닿기 직전이면 아래 마지막 안전 브레이크가 잡음)
          if(target&&evadeNow&&Math.abs(desired-o.lat)>width+.12){
            // 옆으로 다 비킬 때까지(Tc) 남은 범퍼 간격을 다 쓰지 않을 만큼만 줄임: (내 속도−앞차)·Tc − 앞차 감속·Tc²/2 ≤ 간격
            // 앞차 반대쪽으로 건너가는 중이면 앞차 뒤를 지나 반대편까지 (|옆 간격|을 더함)
            const away=Math.sign(desired-o.lat)===Math.sign(-dLat)||Math.abs(dLat)<.05,need=width+.12+(away?-1:1)*Math.abs(dLat);
            const dgF=DG_FOLLOW&&move.bp==='dodge';
            const rate=away?Math.max(move.sepV,dgF?glide(Math.abs(st.laneTarget-st.lane))*.7:1.5):laneRate*.5,Tc=Math.max(.2,Math.max(0,need)/rate+(!away||move.sepV<1?Math.max(.1,.45-(move.passAge||0)):0));
            const aL=Math.min(0,sight.get(keyOf(o))?.acc||0),room=gap-envelope-.35;
            let fv=Math.max(0,o.speed+(room>0?room/Tc:-Math.sqrt(10*gHere*-room))+aL*Tc*.5);
            if(dgF&&room>0&&move.dgOk)fv=Math.max(fv,o.speed+aL*Math.min(Tc,.3)-.5); // dodge: 비킬 수 있으면 사람보다 느려지지 않을 만큼만 (마지막 안전 브레이크는 그대로)
            if(!(BD_DODGE&&dgF&&move.dgOk&&room>0&&bdFor(o)&&Tc+.1<dgInfo(o).T&&(bdTag='dodge')))setF(fv,'evade'+(o.human?'H':'B'));
            evadeTc=Tc;
          }
          else if(target){if(!(slingNow&&(move.passAge||0)<1.2&&Math.abs(desired-o.lat)>width+.12)){const room=gap-gapM;setF(Math.max(0,o.speed+Math.sign(room)*Math.sqrt(10*gHere*Math.abs(room))),'target'+(o.human?'H':'B'));}}
          else if(Math.abs(o.lane-lane)<width+.25||gap<gapM+closing*2+3)setF(Math.sqrt(Math.max(0,o.speed*o.speed+2*7*gHere*(o.dm-gapM))),'lane'+(o.human?'H':'B'));
        }
        // 앞날개가 뒷범퍼에 닿기 전에는 반드시 제동. 나란히 확보한 옆 접촉과 구별.
        // 슬립스트림 추월로 옆으로 빠르게 비키는 중이면, 다 비키는 시간이 범퍼에 닿는 시간의 70%보다 짧을 때는 안 밟음
        const sideClear=target&&evadeTc<Infinity&&evadeTc<Math.max(0,gap-rearSpace(o))/Math.max(closing,.1)*.7||target&&slingNow&&move.sepV>1&&Math.max(0,width+.08-Math.abs(dLat))/move.sepV<Math.max(0,gap-rearSpace(o))/Math.max(closing,.1)*.7;
        if(!sideClear&&gap<envelope+closing*.2+closing*closing/(16*gHere))setF(Math.max(0,o.speed-2),'safe'+(o.human?'H':'B'));
      }
    }
    const inSide=move&&turnSide===move.side?1:0;

    // 옆줄 이동 속도도 목표 방향에 반영한다. 평행선만 향하면 핸들이 늦게 따라가 크게 꺾고 감속했음.
    const laneVMax=Math.max(2.6,laneRate);
    const rawLaneV=st.prevCommandLane==null?0:clamp((lane-st.prevCommandLane)/Math.max(.001,dt),-laneVMax,laneVMax);
    st.commandLaneV=(st.commandLaneV||0)+(rawLaneV-(st.commandLaneV||0))*Math.min(1,dt*6);
    st.prevCommandLane=lane;
    const laneV=st.commandLaneV;
    // --- 조향 ---
    const fx = car.fwd.x, fz = car.fwd.z, fl = Math.hypot(fx, fz) || 1;
    const angTo = (dx, dz) => Math.atan2((fx * dz - fz * dx) / fl, (fx * dx + fz * dz) / fl); // + = 오른쪽으로 돌아야 함
    const noise = level.noise * (Math.sin(st.t * 1.7 + st.phase) + 0.5 * Math.sin(st.t * 4.3 + st.phase * 2));
    let steerCmd;
    st.mNeed = 0;
    if (car.grounded && car.mode !== 'fly' && car.mode !== 'boat' && car.surface !== 'magnet' && speed > 3) {
      // 땅 위 (2026-11-10 hard2): '원하는 회전 속도' 방식. 라인 곡률 × 속도 + 방향 오차 + 옆 오차 → 이 차가 지금 핸들 1로 도는 회전 속도로 나눔
      //   예전 방식(20 m 앞 점을 향해 꺾기 + 곡률/24)은 빠른 코너에서 핸들이 늦게 풀려 안쪽 잔디로 파고들었음
      //   (그랑프리 proto 라인 봇 2바퀴 중 잔디 위 36초, 216.7초 → 이 방식 188.9초·잔디 0.5초, 달 156.6 → 142.4초)
      const cfg = car.cfg;
      const a = W(i0 + Math.round(3 / ds));
      const [ax, az] = target(W(a - 1), lane), [bx, bz] = target(W(a + 1), lane);
      const hd = angTo(bx - ax, bz - az);
      const want = clamp(L.offset[i0] + lane, L.lo[i0] + 0.2, L.hi[i0] - 0.2);
      const latErr = clamp(myLat - want, -6, 6);
      const kf = W(i0 + Math.round((v * 0.15) / ds));
      // 밀리는 중(hold)이면 옆으로 밀려나는 속도도 바로 되받음 (밀린 뒤에야 돌아오면 늦음)
      const latVel = st.prevLat != null ? clamp((actualLane - st.prevLat) / Math.max(1e-3, dt), -8, 8) : 0;
      const crossForce = forceZones.some(w => w.type === 'cross' && ti.t >= w.t0 && ti.t <= w.t1);
      const flowAngle = Math.atan2(fx*car.vel.z-fz*car.vel.x, fx*car.vel.x+fz*car.vel.z);
      const windYaw = crossForce && speed > 12 ? clamp(-1.8*flowAngle, -.18, .18) : 0;
      const trafficPath=!!st.overtake||hold>0||plOn&&(Math.abs(lane)>.3||Math.abs(st.laneTarget-lane)>.2);
      const lateralGain=trafficPath?clamp(5/v,.05,.15):MGAIN&&exactMaster?Math.min(.15,3.5/Math.max(1,v)):.15;
      const yawDes = windYaw -(Math.abs(lane) > 0.5 ? pathCurvature(kf, lane) : L.curvature[kf]) * v
        + 3 * (hd + (trafficPath?Math.atan2(laneV,v):0)) - lateralGain * (1 + hold) * latErr
        - .12 * hold * (latVel-laneV);
      const bankLat = cfg.bankGrip && !car.magnet && car.up.y > .8 && car.up.y < .9995
        ? 9.81 * (car.up.y * car.up.dot(car.right) - car.right.y) * Math.sign(yawDes) * cfg.bankGrip : 0;
      const latCap = steerLatCap(cfg, v, car.load || 0, bankLat, botSurf(car)); // car.js와 같은 식 (steergrip)
      const perSteer = cfg.steerRate * Math.min(1, v / 8) * Math.min(1, latCap / (cfg.steerRate * v)); // 핸들 1일 때 회전 속도 (car.js와 같은 식)
      // 원래 차의 꼬리 미끄러짐/핸들 지연을 보고 카운터. 성능값을 올리지 않고 조작으로 잡음.
      const yawNow = st.lastFx == null ? car.yawRate || 0 : Math.atan2(st.lastFx*fz-st.lastFz*fx,st.lastFx*fx+st.lastFz*fz)/Math.max(.001,dt);
      st.actualYaw = (st.actualYaw ?? yawNow) + (yawNow-(st.actualYaw ?? yawNow))*Math.min(1,dt*14);
      st.lastFx=fx;st.lastFz=fz;
      steerCmd = (yawDes + .45*(yawDes-st.actualYaw) - .8*(car.slip||0)) / Math.max(0.05, perSteer);
      // 핸들을 끝까지 꺾어도 모자란 정도 (마스터 봇이 속도를 줄이는 데 씀). 라인에서 도는 쪽 반대로 1 m 넘게 밀려나 있을 때만 (달처럼 잠깐 꽉 꺾는 곳은 그냥 둠)
      const mlTraffic = MLANE && exactMaster && trafficPath;
      st.cornerLoad = (circuit || (MLOAD && exactMaster)) && (!trafficPath || mlTraffic) && Math.abs(car.slip||0)<.12 && cfg.steerLatLoad
        ? steerLoadFor(cfg, v, (()=>{ if(!(MLANE2&&MLOOK&&exactMaster)) return Math.abs(mlTraffic ? pathCurvature(kf, lane) : L.curvature[kf])*v*v;
            let kmax=0; const n1=Math.round((v*.5)/ds), step=Math.max(1,Math.round(n1/8));
            for(let q=Math.round((v*.15)/ds);q<=n1;q+=step){const j=W(i0+q);const vj=Math.min(v,prof.speed[j]||v);kmax=Math.max(kmax,Math.abs(mlTraffic?pathCurvature(j,lane):L.curvature[j])*vj*vj);}
            return kmax; })(), bankLat, MLOAD ? botSurf(car) : 1) : 1;
      st.mNeed = Math.abs(Math.abs(lane) > 0.5 ? pathCurvature(kf, lane) : L.curvature[kf]) * v * v;
      st.satur = Math.sign(steerCmd) * -latErr > 1 ? Math.abs(steerCmd) - 1 : 0;
      st.saturRoom = steerCmd > 0 ? myLat - L.lo[i0] : L.hi[i0] - myLat; // 도는 쪽 바깥 도로 끝까지 남은 거리 (m)
      { // 좁은 길(한쪽 7 m 아래)·바깥이 낭떠러지/용암이면 '멀다'로 치지 않음 (화산: 예전처럼 브레이크)
        const hwN = S[i0].hw ?? (track.width || 16) / 2, E = track.EDGE, eo = track.edgeAt && E ? track.edgeAt(i0, steerCmd > 0 ? -1 : 1) : null;
        st.saturSafe = hwN >= 7 && !(E && (eo === E.cliff || eo === E.lava));
      }
      st.edgeRisk = 0;
      if (MEDGE && exactMaster && v > 20) {
        // 라인·계획한 옆 이동(laneV)에서 벗어나는 속도만 봄 (라인 자체가 도로 끝으로 가는 것은 빼고)
        const vRel = latVel - laneV;
        st.edgeVy = (st.edgeVy ?? vRel) + (vRel - (st.edgeVy ?? vRel)) * Math.min(1, dt * 20);
        const j = W(i0 + Math.round((v * MEDGE_T) / ds)), wantJ = clamp(L.offset[j] + lane, L.lo[j] + 0.2, L.hi[j] - 0.2), p = wantJ + (myLat - want) + st.edgeVy * MEDGE_T;
        st.edgeRisk = st.edgeVy > 1 ? p - (L.hi[j] + MEDGE_M) : st.edgeVy < -1 ? (L.lo[j] - MEDGE_M) - p : 0;
        if (st.edgeRisk < 0) st.edgeRisk = 0;
      }
      st.prevMyLat = myLat;

    } else if (car.grounded && car.mode !== 'fly' && car.mode !== 'boat' && track.roll?.loop && (car.surface === 'magnet' || ti.sample?.magnet || ti.sample?.roll)) {
      // 루프·자석 도로는 현재 도로의 3D 접선을 차 바닥 면에 투영한다.
      // 수평 앞점은 수직/천장 구간에서 뒤쪽 점이 되어 핸들을 끝까지 꺾고 속도를 잃었음.
      const s = ti.sample || S[i0], cfg = car.cfg;
      const dir = magnetDir.copy(s.tan3 || s.tan);
      const side = s.rightB || s.right;
      const want = clamp(L.offset[i0] + lane, L.lo[i0] + .2, L.hi[i0] - .2);
      dir.addScaledVector(side, clamp((want - myLat) * .09, -.35, .35));
      dir.addScaledVector(car.up, -dir.dot(car.up));
      const angle = dir.lengthSq() > 1e-6 ? -Math.atan2(magnetCross.crossVectors(car.fwd, dir).dot(car.up), car.fwd.dot(dir)) : 0;
      const latCap = steerLatCap(cfg, v, car.load || 0, 0, botSurf(car)); // car.js와 같은 식 (steergrip, &steer=old면 예전 식)
      const perSteer = cfg.steerRate * Math.min(1, v / 8) * Math.min(1, latCap / (cfg.steerRate * v));
      steerCmd = (3 * angle - .8 * (car.slip || 0)) / Math.max(.05, perSteer);
      st.satur = 0;
    } else if (car.grounded && car.mode === 'boat') {
      // 실제 방향타 회전량으로 조향. v²/24는 고속 배에서 과조향·부표 벽 충돌을 냈음.
      const a = W(i0 + Math.round(v * 0.12 / ds));
      const [ax, az] = target(W(a - 1), lane), [bx, bz] = target(W(a + 1), lane);
      const hd = angTo(bx - ax, bz - az);
      const want = clamp(L.offset[i0] + lane, L.lo[i0] + 0.3, L.hi[i0] - 0.3);
      const yaw = -L.curvature[a] * v + 2 * hd - 0.12 * clamp(myLat - want, -6, 6);
      const boat = car.cfg.modes.boat;
      const yawCap = boat.turnRate * (1 - 0.35 * Math.min(1, v / boat.maxSpeed));
      steerCmd = yaw / Math.max(0.1, yawCap);
    } else {
      // 공중·비행: 예전 방식 (앞 점 향하기 + 곡률)
      const look = Math.round((6 + v * 0.35) / ds);
      const [tx, tz] = target(W(i0 + look), lane);
      const jf = W(i0 + Math.round((v * 0.18) / ds));
      steerCmd = (-L.curvature[jf] * v * v) / 24 + 2 * angTo(tx - car.pos.x, tz - car.pos.z);
    }
    c.steer = clamp(steerCmd + noise + clamp(shove, -0.35, 0.35), -1, 1);
    st.prevLat = actualLane;
    if (!car.grounded && car.mode !== 'fly') c.steer = 0; // 점프 중에는 핸들을 곧게 (공중에서 꺾으면 차 머리가 돌아간 채 착지해서 미끄러짐)

    // --- 속도 ---
    const leadT = st.mistake === 'late' ? level.lead * 0.35 : level.lead;
    const lead = W(i0 + Math.round((v * leadT) / ds));
    st.calm = !!((jumpCalm && jumpCalm[i0]) || gHere < 0.95); // 점프 근처·저중력: 따라잡기로 빨라지지 않음 (raceSystem의 보이지 않는 슬립스트림도 끔)
    // 마스터(level.master.calmGrav = false): 저중력 구역에서는 도움을 그대로 (점프 근처만 조심). 접지 도움도 같이 커져서 코너는 버팀
    if (level.master && level.master.calmGrav === false) st.calm = !!(jumpCalm && jumpCalm[i0]);
    const pm = st.calm ? Math.min(1, st.paceMul) : st.paceMul;
    // 출발 뒤 25초(첫 코너들, 한 덩어리): 바로 앞에 차가 있으면 코너 속도를 조금 낮춤 (빨라진 어려움 봇이 달 T1 출구에서 뒤엉켜 여러 대 복귀했음)
    const OP = PACK.open;
    const openK = RUBBER_BAND && ctx.since < OP.sec && packAhead && level.pace > 0.95 ? OP.k : 1;
    const eqK = st.calm ? Math.min(eq.kMul, eq.kCalm) : eq.kMul;
    const k = (exactMaster?1:pace*pm) * eqK * openK * (ctx.finished ? 0.72 : 1) * (Math.abs(lane) > 1.5 && st.laneHold <= 0 ? 0.985 : 1);
    // 목표 속도: 앞쪽 지점들의 계획 속도 × 실력에서, 거기까지 브레이크로 줄일 수 있는 속도 (계획보다 빠를 때도 제때 제동)
    //   부스터 중에는 직선(계획이 최고 속도) 지점은 제한 없음 → 직선에서 부스터를 브레이크로 끄지 않음
    const boosting = car.form === 'spike';
    // 브레이크를 얼마나 늦게(세게) 밟는지 (어려움일수록 1에 가까움). 추월 중 확실히 빠를 때만 최대 +5% (성격 비례)
    const kB = Math.min(1.03, (level.brakeK ?? 0.95) * Math.min(1, k) * (1 + 0.05 * lateBrake));
    const reach = Math.round(Math.min(500, (speed * speed) / (2 * kB * gHere * cm.aBrake(30)) + 10) / ds);
    let tgt = Infinity, tgtWhy = 'plan', tgtQ = -1, tgtVq = 0, tgtVl = 0; // tgtQ·Vq·Vl: (진단) 목표를 정한 앞 지점·그 지점 한계·라인 한계
    const mbOn = MBRAKE && exactMaster && car.grounded && car.mode !== 'fly' && car.mode !== 'boat';
    const rampT = mbOn ? 0.5 * Math.max(0, 1 - (car.brk || 0)) / ((car.cfg.input && car.cfg.input.brakeRise) || 5) : 0; // 페달이 다 차오를 때까지 평균 걸리는 시간
    let ffDec = 0;
    const dragLoss = DRAG_BRAKE && exactMaster && car.dragMul ? (1 - car.dragMul()) * car.cfg.aero.drag : 0; // 줄어든 공기 저항 몫 (× v²)
    const aBrk = (vq) => Math.max(0.5 * cm.aBrake(vq), cm.aBrake(vq) - dragLoss * vq * vq);
    // 슬립스트림(기차)·견인·슬링샷·DRS로 차 최고 속도가 올라가면 목표 속도도 같이 (사람과 똑같이 효과를 받게, 2026-11-12 drs)
    //   직선(계획 속도가 최고 속도의 75~95%)일수록 다 받고 코너는 그대로. 예전엔 계획 속도 × k가 직선 상한이라 봇은 슬립스트림을 받아도 직선에서 더 빨라지지 않았음
    const tailwind = windZones.some(w => w.type === 'tail' && w.dir > 0 && ti.t >= w.t0 && ti.t <= w.t1);
    const aeroTop = (!BOT_AERO ? 1 : car.mode === 'boat' ? car.waterAeroTop || 1 : car.aeroTopMul ? car.aeroTopMul(true) : 1) * (tailwind ? 1.08 : 1);
    const aeroRef = car.mode === 'boat' && cm.boat ? cm.boat.vMax : vTop;
    // 일반 3단계는 앞차가 제한을 걸면 기존 추종/추월 판단을 유지한다.
    // 앞이 열린 경우에만 새 공력 계획을 써서 받은 견인의 나머지를 활용한다.
    const trafficPlan = !exactMaster && Number.isFinite(follow);
    const drivingProf = st.circuitClear ? circuitProf : prof;
    const activeProf = st.calm || trafficPlan ? prof : aeroPlan(L,car.cfg,drivingProf,car,st.circuitClear?circuitAeroPlans:aeroPlans,exactMaster,st.circuitClear);
    st.aeroPlan = activeProf !== prof && activeProf !== circuitProf;
    // 새 옆 줄 계산은 사람을 추월하는 중(pass, 앞뒤 25 m 안)일 때만 (봇끼리·모든 옆 줄에 쓰면 7봇 시험에서 코스 밖·강한 접촉이 1.6~1.9배)
    const dgCurveOn = DG_CURVE && bold && car.mode !== 'boat' && peers.some(o => o.human && !o.fin && o.dm > -60 && o.dm < 90) && !peers.some(o => !o.human && o.dm > -8 && o.dm < 90);
    const dgH = Math.max(1, Math.round(6 / ds));
    // 라인 쪽으로 돌아오는 중(목표 줄이 지금보다 라인에 가까움)이면 앞 지점마다 그때의 옆 거리로 계산 (예전엔 지금 줄이 끝까지 그대로라고 보고,
    //   라인이 안쪽 끝으로 붙는 코너에서 그 줄이 길 끝에 눌려 꺾임 → 추월 뒤 'lane' 브레이크로 사람보다 50~80 km/h 느려졌음: 장면 2분48초)
    const dgProj = dgCurveOn && DG_PROJ && Math.abs(st.laneTarget - lane) > 0.3 && Math.abs(st.laneTarget) < Math.abs(lane), dgRate = laneRateS;
    const bpLaneOn = (BP_LANE && !(CORNERPASS && !CP_OFF.has('clamp')) && (BP_LANE_ALL || !!(move && move.phase === 'pass' && leader && leader.human && Math.abs(leader.dm) < 25))) || bpAloneH;
    for (let q = 0; q <= reach; q += q < 8 ? 1 : 3) {
      const iq = W(lead + q);
      const free = boosting && activeProf.speed[iq] >= vTop * 0.97 && !activeProf.brake[iq];
      if (free) continue;
      let vq = activeProf.speed[iq] * k;
      let legacyVq = prof.speed[iq] * k;
      const halfWidth = S[iq].hw ?? (track.width || 16) / 2;
      if (halfWidth < 7 && car.mode !== 'boat') { vq *= 0.96; legacyVq *= 0.96; } // 한 줄 산길에서는 같은 안전 여유

      const vqLine = vq;
      const tq = q * ds / Math.max(10, speed), laneQ = dgProj ? lane + clamp(st.laneTarget - lane, -dgRate * tq, dgRate * tq) : lane;
      if (Math.abs(laneQ) > 0.5 && car.mode !== 'boat' && car.surface !== 'magnet' && !S[iq].roll && !S[iq].gap) {
        let bpLane = bpLaneOn, dgLine = false;
        if (dgCurveOn) { // dodge curve: 옆 줄이 길 끝에 눌린 곳 (6 m 간격 계산의 꺾임)
          let cut = false, onL = true;
          for (const kk of [W(iq - dgH), iq, W(iq + dgH)]) {
            const o = L.offset[kk] + laneQ, c = clamp(o, L.lo[kk] + 0.2, L.hi[kk] - 0.2);
            if (c !== o) cut = true;
            if (Math.abs(c - L.offset[kk]) > 1) onL = false;
          }
          // 눌린 점이 라인 1 m 안 = 실제로 라인 위를 감 → 라인 곡률. 그 밖(라인에서 먼 곳이 끝에 눌림)은 예전 계산 = 실제로 줄이 꺾여 차가 크게 돌아야 함.
          // (시험했다 뺀 것: 안쪽 끝에 눌린 곳에 laneCurvBP·15 m 간격 = 안쪽 끝 진입에서 실제보다 빠르게 봐 핸들이 모자라 코스 밖, 재현 코스 밖 1.5→4.3·3.8초)
          if (cut && onL) { dgLine = true; bpLane = false; }
        }
        const signedCurve = dgLine ? pathCurvature(iq, 0) : bpLane ? laneCurvBP(iq, laneQ) : laneCurvature(iq, laneQ), curve = Math.abs(signedCurve);
        const bankLat = 9.81 * Math.sin(S[iq].bank || 0) * Math.sign(signedCurve) * (cm.bankGrip || 0);
        const A0 = car.cfg.modes && car.cfg.modes.accel;
        const lat = MLANE && exactMaster ? Math.min(cm.aLat(vq), 0.97 * steerLatCap(car.cfg, vq, 0, 0, A0 && !car.cfg.modes.manualSelect && vq >= A0.autoSpeed / 3.6 ? A0.gripFactor : 1)) : cm.aLat(vq);
        if (curve > 0.001) {
          const cap = Math.sqrt(Math.max(lat*.5, lat+bankLat) / curve) * Math.min(1, k) * (bpLane ? BP_LANE_K : 1);
          vq = Math.min(vq, cap); legacyVq = Math.min(legacyVq, cap);
        }
      }
      if (aeroTop > 1.001 && !prof.brake[iq]) legacyVq *= 1 + (aeroTop - 1) * clamp((prof.speed[iq] / aeroRef - 0.75) / 0.2, 0, 1);
      // 원래 쓰던 공력 보너스 목표를 낮추지 않고, 가속 제한 때문에 못 쓰던 몫만 더 활용.
      if(!exactMaster)vq = Math.max(vq, legacyVq);
      if (jumpCap.size && jumpCap.has(iq)) vq = Math.min(vq, jumpCap.get(iq) * Math.min(jumpK, 1.12));
      const dq = mbOn ? Math.max(0, q * ds - speed * rampT) : q * ds;
      const allow = Math.sqrt(vq * vq + 2 * kB * gHere * aBrk(vq) * dq);
      if (allow < tgt) { tgt = allow; tgtQ = q; tgtVq = vq; tgtVl = vqLine; tgtWhy = vq < vqLine - 0.5 ? 'lane' : 'plan'; ffDec = q > 0 ? kB * gHere * aBrk(vq) : 0; } // 장면 저장(F8) 진단: 옆 차선 커브 계산이 깎았는지
    }
    // 마스터(level.master.saturBrake): 도움으로 빨라진 만큼 핸들이 모자라면(끝까지 꺾어도 원하는 만큼 못 돎) 바로 액셀을 떼고 줄임
    //   (화산 T7 출구·H1 출구에서 핸들 끝까지 꺾은 채 바깥 벽에 박혔음. 어려움은 이 규칙 없음 = 예전 그대로)
    //   접전(CLOSE)으로 빨라진 봇(eq.keep > 1)도 같은 규칙 (화산에서 사람보다 뒤인 봇이 계속 빨라져 낭떠러지로 떨어졌음)
    const sBrake = st.circuitClear ? 1.5 : (level.master && level.master.saturBrake) || (st.closeOn && eq.keep > 1.001 ? 8 : 3);
    // brakecorners (2026-11-24): 반지름 150 m 넘는 고속 스위퍼는 cornerSoon이 아니라 '직선 추월'로 쳐서, 추월 줄에서 핸들이 끝까지 꺾여 바깥으로 밀려도
    //   액셀을 안 뗐음(빙하 R300 스위퍼 290 km/h에서 코스 밖) → 지금 곡선이 반지름 600 m보다 급하고 핸들이 모자라면 직선 추월로 안 침 (&passsat=0 = 예전)
    const straightPass = !!st.overtake && st.overtake.phase === 'pass' && !cornerSoon && !brakeSoon && !risky && !mergeHazard
      && !(PASS_SAT && st.satur > 0.15 && Math.abs(L.curvature[i0]) > 1 / 600 && (st.saturRoom ?? 99) < 3 + speed * 0.04); // 바깥 도로 끝이 가까울 때만 (추월 중 일찍 떼면 뒤차가 박음)
    // 2026-11-14 (사용자 장면 저장, 파운드리 마스터): 옆 차를 피하거나 추월을 포기하고 라인으로 돌아올 때도 핸들이 끝까지 꺾여
    //   도로 끝이 한참 남았는데 0.5~0.7초 풀 브레이크(−70 km/h)를 밟았음 → 바깥 도로 끝이 멀면 액셀만 뗌, 가까우면 예전처럼 브레이크 (&satlift=0 = 예전)
    let saturLift = false;
    if (sBrake && !straightPass && car.grounded && speed > 12 && st.satur > 0.05) {
      if (SAT_LIFT && st.saturSafe && !(BRAKEPASS && move && move.bp) && (st.saturRoom ?? 0) > 3 + speed * 0.04 && !(MSAT && exactMaster && !hold && !shove && !(MSATL && trailL > -0.95 && (car.load || 0) < trailL + 0.1))) { saturLift = true; tgtWhy = 'saturLift'; }
      else if (BD_SATUR && bold && car.simT - (car._sideContactAt ?? -Infinity) < .3 && car.simT >= (car._sideContactAt ?? 0) && (BD_ALL || peers.some(o => o.human && o.pos === car._sideContactOther))
        && (st.saturRoom ?? 0) > 1.5 && !(track.EDGE && track.edgeAt && [track.EDGE.cliff, track.EDGE.lava].includes(track.edgeAt(i0, steerCmd > 0 ? -1 : 1)))) { saturLift = true; tgtWhy = 'saturLift'; bdTag = 'satur'; } // boldpass satur: 옆으로 닿은 직후
      else if (speed - 1 - sBrake * st.satur < tgt) { tgt = speed - 1 - sBrake * st.satur; tgtWhy = 'satur'; }
    }
    if (MEDGE && exactMaster && st.edgeRisk > MEDGE_B && car.grounded && speed > 20 && speed - 1 - 3 * (st.edgeRisk - MEDGE_B) < tgt) { tgt = speed - 1 - 3 * (st.edgeRisk - MEDGE_B); tgtWhy = 'edge'; }
    st.saturLast = st.satur;
    st.satur = 0;
    // 실력별 최고 속도 (직선이 긴 맵에서도 실력 차이가 나게). 부스터 중에는 제한 없음
    //   (aeroTop: 위 슬립스트림·견인·DRS 몫, 상한에도 같이)
    const tgtPreTop = tgt;
    let topCap = Infinity;
    if (level.topK && !boosting) topCap = vTop * level.topK * pm * (st.calm ? Math.min(eq.topMul, eq.topCalm) : eq.topMul) * aeroTop;
    // 따라잡기 효과로 늦추는 중(paceMul < 1)이면 직선 최고 속도도 같이 낮춤 (코너만 늦추면 효과가 거의 없음)
    else if ((st.paceMul < 0.999 || eq.topMul < 0.999) && !boosting) topCap = vTop * st.paceMul * eq.topMul * aeroTop;
    // botpush top: 슬립스트림(앞차 공기)을 받은 뒤 1.5초·추월 중에는 어려움·마스터의 직선 상한 없음 (사람처럼 모은 속도를 그대로 가져감)
    if (BP_TOP) {
      st.draftT = (car.draft || 0) > 0.05 ? 0 : (st.draftT ?? 99) + dt;
      if (BP_TOP_FREE && (level.topK || 1) >= 0.99 && !st.calm && car.grounded && (st.draftT < 1.5 || (st.overtake && st.overtake.phase === 'pass'))) topCap = Infinity;
    }
    tgt = Math.min(tgt, topCap);
    if (tgt < tgtPreTop - 0.01) tgtWhy = 'top';
    // 앞이 막혀 거의 멈춰 있으면 추월 경로를 다시 준비
    if (follow < 3 && Math.abs(speed) < 3 && ctx.since > 1) st.blockedT += dt;
    else st.blockedT = Math.max(0, st.blockedT - dt);
    if (st.blockedT > 2) {
      st.passT = 4; // 멈춰도 앞차를 밀지 않고 빈 줄을 다시 찾음
      st.blockedT = 0;
    }
    // 자석 도로(루프·벽): 위로 올라가는 동안 진행 거리가 짧게 계산되어 앞차가 아주 가까워 보임 → 앞차 때문에 줄이지 않음 (멈추면 떨어짐)
    const onMagnet = car.surface === 'magnet' || (ti.sample && ti.sample.roll) || car.up.y < 0.8;
    if (!onMagnet) {
      // 앞차 때문에 속도를 줄이고 있는 시간 → 1.5초 넘으면 '추월 시도' 4초 (그동안 또 막히면 계속)
      if (follow < tgt - 0.3 && speed > 10 && !ctx.finished) st.heldT += dt;
      else st.heldT = Math.max(0, st.heldT - dt * 0.5);
      if (st.heldT > 1.5) st.passT = 4;
      st.tgt0 = tgt; // (테스트용) 앞차 때문에 줄이기 전 목표 속도
      if (follow < tgt) tgtWhy = 'follow';
      tgt = Math.min(tgt, follow);
    }
    // botpush top: 브레이크는 상한을 뺀 목표로 (상한 때문에는 액셀만 뗌)
    const tgtBrake = BP_TOP ? (onMagnet ? tgtPreTop : Math.min(tgtPreTop, follow)) : tgt;
    if (st.passT > 0) st.passT -= dt;
    if (speed > tgt + 0.4) {
      c.throttle = 0;
      c.brake = clamp((speed - tgtBrake) / 3, 0, 1);
    }
    if (mbOn && ffDec > 0 && (tgtWhy === 'plan' || tgtWhy === 'lane') && speed > tgt - 1.5) {
      // 앞먹임 제동: 곡선이 가정한 감속(ffDec) 중 공기·구름 저항이 해 주는 몫을 뺀 만큼을 지금 브레이크 힘으로 나눔
      const cf = car.cfg, dfv = cf.aero.downforce * Math.min(1.6, (speed / cf.maxSpeed) ** 2);
      const gripK = car.mode === 'accel' && cf.modes.accel ? cf.modes.accel.gripFactor || 1 : 1;
      const bF = Math.max(1, Math.min(cf.brake, cf.tire.brakeGrip * (1 + dfv) * gripK));
      const need = ffDec - cf.aero.drag * speed * speed - (cf.aero.rolling || 0);
      const ff = clamp(need / bF, 0, 1) * clamp((speed - tgt + 1.5) / 1.5, 0, 1);
      if (ff > 0.05) { c.throttle = 0; c.brake = clamp(Math.max(c.brake || 0, ff + Math.max(0, speed - tgt) / 3), 0, 1); }
    }
    if (saturLift) {
      if (BP_LIFT && !hold && !shove) { // 옆 차와 나란히(hold)·밀리는 중(shove)이면 예전처럼 액셀 0 (마스터 7봇 시험에서 그때 덜 떼면 강한 접촉이 2배)
        // 바깥 도로 끝 여유가 '필요 거리'의 2배면 다 밟음, 필요 거리에 가까울수록·많이 모자랄수록·미끄러질수록 덜 밟음 (여유가 필요 거리 아래면 위 'satur' 브레이크)
        const need = 3 + speed * 0.04, m = clamp(((st.saturRoom ?? 0) - need) / need, 0, 1);
        const slipK = clamp(1 - (Math.abs(car.slip || 0) - 0.08) / 0.06, 0, 1);
        c.throttle = Math.min(c.throttle, m * clamp(1.2 - 0.6 * st.saturLast, 0, 1) * slipK); // 모자람 0.5 → 0.9, 1 → 0.6, 2 넘으면 0
      } else c.throttle = 0;
    }
    if (MTRAIL && exactMaster && trailL > -0.95 && c.brake > 0.05 && car.grounded && car.mode !== 'fly' && car.mode !== 'boat' && car.surface !== 'magnet' && speed > 12
        && st.mNeed > 0.85 * steerLatCap(car.cfg, speed, trailL, 0, botSurf(car))) {
      const cf = car.cfg, dfv = cf.aero.downforce * Math.min(1.6, (speed / cf.maxSpeed) ** 2);
      const gripK = car.mode === 'accel' && cf.modes.accel ? cf.modes.accel.gripFactor || 1 : 1;
      const bF = Math.max(1, Math.min(cf.brake, cf.tire.brakeGrip * (1 + dfv) * gripK));
      const dStar = -trailL * cf.tire.loadAccel - cf.aero.drag * speed * speed - (cf.aero.rolling || 0);
      c.brake = Math.min(c.brake, clamp(dStar / bF, 0.1, 1));
    }
    if (MEDGE && exactMaster && st.edgeRisk > 0 && car.grounded) c.throttle = Math.min(c.throttle, clamp(1 - 2 * st.edgeRisk, 0, 1));
    if (circuit && car.grounded && car.mode !== 'fly' && car.mode !== 'boat' && car.surface !== 'magnet' && st.cornerLoad < -.1 && speed > 25 && c.brake < .1) {
      // 코너 전에 액셀을 덜 밟아 앞 하중을 남긴다. 차 물리의 하중/접지는 그대로다.
      c.throttle=Math.min(c.throttle,clamp(.35+st.cornerLoad,0,.3));
    } else if (MLOAD && exactMaster && !circuit && car.grounded && car.mode !== 'fly' && car.mode !== 'boat' && car.surface !== 'magnet' && st.cornerLoad < .5 && speed > 25 && c.brake < .1 && (car.load || 0) > st.cornerLoad - .05) {
      // 다른 맵 마스터: 필요한 하중보다 뒤로 쏠려 있으면 액셀을 그만큼 덜 밟음 (필요 하중 0.2 → 액셀 0.55, −0.1 → 0.25)
      c.throttle=Math.min(c.throttle,clamp(.35+st.cornerLoad,0,1));
    }
    if (car.grounded && car.mode !== 'boat' && car.surface !== 'magnet') c.throttle=Math.min(c.throttle,clamp(1-2.5*Math.max(0,Math.abs(car.slip||0)-.12),.45,1));
    if (st.mistake === 'lift') c.throttle = Math.min(c.throttle, 0.35);
    // 실력별 액셀 (쉬움일수록 덜 밟음: 직선·비행 구간에서도 차이). 추월 시도 중에는 성격만큼 더 밟음
    const thrNow = pushing ? Math.min(1, thrK + 0.05 + 0.1 * aggr) : thrK;
    if (thrNow < 1 && !boosting) c.throttle = Math.min(c.throttle, thrNow);
    st.dbg = { overtake:st.overtake?{phase:st.overtake.phase,kind:st.overtake.kind,side:st.overtake.side,switched:st.overtake.switched,age:st.overtake.age}:null, follow, tgt, lane: st.lane, laneT: st.laneTarget, lateBrake, inSide, shove, hold, pass: +st.passT.toFixed(1), why: tgtWhy, fsrc, bold: bdTag, bp: move && move.bp || '', satur: st.saturLast || 0, pl: plC ? `${plC.pol}${plC.tag}${plC.i}/${plC.nc} e${plC.eT.toFixed(1)} r${plC.r} s${plC.sc.toFixed(1)}|p${plC.P.prog.toFixed(0)} h${plC.P.hit.toFixed(1)} u${plC.P.rub.toFixed(1)} o${plC.P.off.toFixed(1)} t${plC.P.sat.toFixed(1)} x${plC.P.pass.toFixed(1)} m${(plC.P.term||0).toFixed(1)}` : '', tq: tgtQ, tqm: tgtQ * ds, tvq: tgtVq, tvl: tgtVl };

    // 출발: 불이 꺼진 뒤 반응 시간만큼 기다림
    if (ctx.since < st.react) {
      c.throttle = 0;
      c.brake = 0;
    }

    // --- 부스터: 앞 (3초 × 속도) 안에 브레이크 구간이 없으면 ---
    st.boostCool -= dt;
    if (!ctx.finished && level.boost > 0 && st.boostCool <= 0 && car.form !== 'spike' && car.grounded && car.mode !== 'boat' && car.mode !== 'fly' && speed > 25 && !st.mistake) {
      // 앞 (속도 × level.boostLook초) 안에 브레이크 구간이 없으면
      const span = Math.round((Math.max(speed, 40) * (level.boostLook || 3)) / ds);
      let clear = true;
      for (let q = 0; q < span && clear; q += 3) if (prof.brake[W(i0 + q)] || prof.speed[W(i0 + q)] < vTop * 0.75) clear = false;
      // 앞차를 따라잡는 중이면(슬립스트림) 부스터를 더 자주: 추월 시도
      const want = level.boost * (attack ? 4 : 1);
      if (clear && rand() < want * dt * 2) {
        c.booster = true;
        st.boostCool = 3.5 + rand() * 3;
      }
    }
    return masterShift(c,dt);
  }

  return {
    controls,
    state: st,
    pace,
    /** 복귀(리스폰) 뒤: 줄·실수 초기화 */
    reset(grid = false) {
      st.lane = st.laneTarget = 0;
      st.sideSight=null;st.sideRetreat=null;
      delete car._sideContactAt;
      delete car._sideContactOther;

      st.overtake=null;st.overtakeCool=0;
      st.laneHold=st.heldT=st.passT=st.blockedT=0;
      if(grid)st.overtakeStarts=st.overtakeSwitches=st.overtakeWins=0;
      st.fly = null;
      st.sc = null; st.scTry = 0; // 판자 지름길 (botShortcut.js)
      st.flyI = 0;
      st.shiftLock = 0;
      st.circuitClear = false;
      st.cornerLoad = 1;
      st.mistake = null;
      st.prevLat = null; st.prevMyLat = null;
      st.lastFx=st.lastFz=st.actualYaw=null;
      st.prevCommandLane=null;st.commandLaneV=0;
      st.started = !grid; // 그리드에 새로 서면 출발 때 칸 줄을 지킴
    },
  };
}

/**
 * 봇이 탈 차 고르기: 플레이어 차와 같은 등급(class) 차들 중에서 (없으면 전체). 같은 차가 겹치면 색을 조금 바꿈
 * @returns [{ id, look }]
 */
export function pickBotCars(roster, playerCarId, count, seed = 1) {
  const cars = roster.cars || [];
  const me = cars.find((c) => c.id === playerCarId);
  let pool = me && me.class ? cars.filter((c) => c.class === me.class) : cars.slice();
  if (pool.length < 2) pool = cars.slice();
  // 차 잠금은 사람 차고에만 적용. 같은 등급에서도 원래 차 성능으로 경쟁.
  const rand = rng(seed);
  // 섞기
  pool = pool.slice().sort(() => rand() - 0.5);
  const out = [];
  const used = {};
  for (let i = 0; i < count; i++) {
    const c = pool[i % pool.length];
    used[c.id] = (used[c.id] || 0) + 1;
    let look = JSON.parse(JSON.stringify(c.look || { style: 'f1', body: '#e8463a' }));
    if (typeof look === 'string') look = { style: 'f1', body: look };
    // 같은 차가 두 번째부터는 색을 돌려서 구별 (플레이어 차와 같은 차도)
    const dup = used[c.id] - 1 + (c.id === playerCarId ? 1 : 0);
    if (dup > 0) look.body = shiftHue(look.body || '#e8463a', dup * 0.29);
    look.number = String(((seed + i * 7) % 89) + 2);
    out.push({ id: c.id, look, name: c.name });
  }
  return out;
}

function shiftHue(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (h + amount) % 1;
  s = Math.max(s, 0.55);
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  [r, g, b] = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  return '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
