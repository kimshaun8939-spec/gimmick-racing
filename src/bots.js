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
import { lineCarModel } from './car.js';
import { hitboxFor, obbOverlap } from './carHitbox.js';
import { createShortcutDriver } from './botShortcut.js'; // 그랑프리 판자 지름길 (2026-11-14)

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
  hard: { pace: 1.04, topK: 1, thrK: 1, paceVar: 0.001, react: [0.17, 0.3], noise: 0.012, mistakeEvery: 1e9, boost: 3, boostLook: 2.2, lead: 0.24, brakeK: 1, jumpK: 1.3, firm: 1, playerPush: 0.5, catchUp: { sec: 2.5, upMul: 1.03, upDraft: 0.6, downMul: 0.97, secDown: 5 }, fly: { speed: 50 } },
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
  lead: 0.02, brakeK: 1.03, noise: 0.001, fly: { speed: 55 },
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
    lat: cfg.tire.lateral, steerLat: cfg.steerLat, steerRate: cfg.steerRate, trac: cfg.tire.traction, brake: cfg.tire.brakeGrip,
    power: cfg.engine.power, maxSpeed: cfg.maxSpeed, gears: cfg.gears.slice(),
    boat: cfg.modes && cfg.modes.boat ? { thrust: cfg.modes.boat.thrust, maxSpeed: cfg.modes.boat.maxSpeed } : null,
  });
  const g = c * c; // 코너 속도 ∝ √접지
  cfg.tire.lateral = B.lat * g;
  cfg.steerLat = B.steerLat * g;
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

// --- 비행 루트 (그랑프리 활주로 → 고리 4개 → 착륙장, 2026-11-10 bots-fly) ---
//   사람처럼: 활주로로 들어가면 차가 저절로 비행 모드(car.js autoSwitch) → 활주로 끝에서 Space(climb)로 이륙
//   → 고리를 잇는 매끈한 곡선(.debug/fly.js flyTest와 같은 곡선)을 따라 날고 → 착륙장에 내려 라인으로 돌아감
//   비행 구역(car.flightAllowed) 안에서만 날게 되어 있어서 따로 막을 필요 없음
const planCache = new WeakMap();
const masterPlanCache = new WeakMap();
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
    aLat: v => 1.08 * Math.min(cfg.steerLat * (1 + (cfg.steerLatDownforce || 0) * df(v)), cfg.tire.lateral * (1 + df(v)) * grip(v)),
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
  const plan = line.profile(circuit ? {...model,aLat:v=>model.aLat(v)*(1.16/1.08)} : model);
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
export function createBotDriver(car, track, prof, level, seed = 1, opts = {}) {
  const L = track.racingLine, N = L.N, ds = track.length / N, S = track.samples;
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
  const aeroPlans = new Map();
  // 구름섬 마스터만 별도 코너 계획. 타이어·엔진·공통 공력 값은 바꾸지 않는다.
  const circuit = exactMaster && !!track.runway;
  // 제동/코스팅으로 앞 하중을 남기는 구간의 목표. 실제 가속과 회전은 Car가 제한한다.
  const circuitProf = circuit ? L.profile({...cm,aLat:v=>cm.aLat(v)*(1.16/1.08)}) : null;
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
      const vNow = car.vel.length();
      c.throttle = vNow > flyV ? 0 : 1;
      c.brake = vNow > flyV + 4 ? 0.5 : 0;
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
      const lat=cfg.steerLat*(1+(cfg.steerLatDownforce||0)*df)*(1-(cfg.steerLatLoad||0)*(car.load||0));
      const yaw=plan.kap[Math.min(A.length-1,bi+Math.round(v*.2))]*v+3*hd+.15*clamp(side,-6,6);
      const per=cfg.steerRate*Math.min(1,v/8)*Math.min(1,lat/(cfg.steerRate*v));
      c.steer=clamp((yaw+.3*(yaw-(car.yawRate||0))-.8*(car.slip||0))/Math.max(.05,per),-1,1);
    }
    st.dbg = { fly: st.fly, apI: bi, tgt: +tgt.toFixed(1) };
    return c;
  }

  const scDrive = createShortcutDriver({ car, track, cm, level, pace, thrK, st, prof, vTop, queueSpeed: (ctx, v) => queueSpeed(ctx, v),
    onRelease: (i) => { const ti = car.trackInfo; if (ti) st.lane = st.laneTarget = clamp(ti.lateral - L.offset[i % N], -12, 12); st.laneHold = 0; } });
  /** 라인 지점 j에서 옆으로 lane만큼 비킨 목표 점 */
  const magnetDir = new THREE.Vector3(), magnetCross = new THREE.Vector3();
  function target(j, lane) {
    const s = S[j];
    const off = clamp(L.offset[j] + lane, L.lo[j] + 0.2, L.hi[j] - 0.2);
    return [s.pos.x + s.right.x * off, s.pos.z + s.right.z * off];
  }

  function pathCurvature(j, lane) {
    const h = Math.max(1, Math.round(6 / ds));
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
    const c = { throttle: 1, brake: 0, steer: 0, drift: false, climb: false, dive: false, booster: false, mode: null, shiftUp: false, shiftDown: false };
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
    let follow = Infinity, busy = false, lateBrake = 0, hold = 0, shove = 0, attack = null;
    // 실제 지상 제동력에는 중력 배수가 없음. 마스터는 그 제동력으로 계획한다.
    // 다른 단계의 기존 여유와 물리는 그대로 둔다.
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
    const options=(leader,side=0,wide=false)=>{
      const spread=Math.max(3.1,sideSpace(leader)+(bold?.5:.75));
      const low=L.lo[i0]+Math.max(1,ownBox.half)-L.offset[i0],high=L.hi[i0]-Math.max(1,ownBox.half)-L.offset[i0];
      const choices=[0,-spread,spread,leader.lane-spread,leader.lane+spread,clamp(st.lane,low,high)];
      return choices.filter((off,i)=>(wide||Math.abs(off)<=6.4)&&choices.indexOf(off)===i&&Math.abs(off-leader.lane)>=sideSpace(leader)+.2&&(!side||Math.sign(off-leader.lane)===side)&&fits(off,wide?2.5:1.1,wide)&&!crosses(off)&&!peers.some(o=>o!==leader&&o.dm>-rearSpace(o)-2&&o.dm<rearSpace(o)+12&&Math.abs(o.lane-off)<sideSpace(o)+.15));
    };
    const safeWindow=()=>{for(let q=0;q<(25+v*2.5)/ds;q+=3){const j=W(i0+q);if(narrowAt(j)||jumpZone?.[j]||S[j].roll||S[j].gap||track.isWaterT?.(j/N))return false;}return true;};
    const mergeHazard=!safeWindow();
    let move=st.overtake;
    let leader=move&&peers.find(o=>move.key!=null&&keyOf(o)===move.key);
    if(move&&move.key==null){let best=8;for(const o of peers){const score=Math.abs(o.dm-move.dm)+2*Math.abs(o.lane-move.lane);if(score<best){best=score;leader=o;}}}
    const endMove=(won=false)=>{if(won)st.overtakeWins=(st.overtakeWins||0)+1;st.overtake=null;st.overtakeCool=bold?.35:1.2;st.laneHold=0;move=null;};
    const changeSide=(kind='crossover')=>{const off=options(leader,-move.side,kind==='retry'&&bold)[0];if(off==null)return false;move.off=off;move.side=Math.sign(off-leader.lane);move.switched=true;move.kind=kind;move.wideRetry=kind==='retry'&&bold;move.evadeOff=null;move.noGain=0;st.overtakeSwitches=(st.overtakeSwitches||0)+1;return true;};
    if(move){
      move.age+=dt;
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
          if(safeSwitch&&(defended||!fits(move.off)||exitCross))changeSide();
          // 방어로 틈이 줄어도 같은 쪽 바깥에 공간이 남으면 더 벌려 지나간다.
          if(move.phase==='pass'&&gap>rearSpace(leader)+.4&&Math.abs(move.off-leader.lane)<sideSpace(leader)+.1){
            const wider=options(leader,move.side).sort((a,b)=>Math.abs(a-move.off)-Math.abs(b-move.off))[0];
            if(wider!=null)move.off=wider;
          }
          move.wasCorner ||= cornerSoon;
          if(move.phase==='approach'){
            const off=options(leader,move.side)[0];if(off!=null)move.off=off;
            const laneTime=Math.max(0,sideSpace(leader)+.2-Math.abs(leader.lat-myLat))/2.6+.35;
            const pullAt=rearSpace(leader)+Math.max(bold?3.5:5,closing*laneTime+v*.04);
            if(gap<pullAt&&fits(move.off)) {move.phase='pass';move.kind=brakeSoon&&move.side===turnSide?'dive':cornerSoon?'outside':'slingshot';}
          }else if(!fits(move.off,1.1,!!move.wideRetry)&&gap>rearSpace(leader)+1)endMove();
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

    let want=st.laneTarget;
    const launchColumns=ctx.since<6&&!narrowSoon&&!brakeSoon&&!cornerSoon;
    if(launchColumns)want=clamp(st.gridLat-L.offset[i0],L.lo[i0]+.35-L.offset[i0],L.hi[i0]-.35-L.offset[i0]);
    else if(narrowSoon||mergeHazard)want=0;
    else{
      if(!move&&front&&!ctx.finished&&!risky&&st.overtakeCool<=0){
        // 마스터끼리는 작은 속도 차로 코너에서 싸우지 않고 직선의 뚜렷한 기회를 쓴다.
        // 사람 상대는 기존의 과감한 추월 판단을 유지한다.
        const cooperative=!!level.master&&!front.human;
        const closing=Math.max(0,speed-front.speed),gap=actualGap(front),minClosing=cooperative?1.2:bold?.2:1.1;
        const trapped=gap<25&&st.heldT>(bold?.25:.9)&&st.tgt0>front.speed+.15;
        if(gap>rearSpace(front)+.3&&gap<Math.min(65,Math.max(30,v*1.1))&&(closing>minClosing||trapped)&&(bold||!cornerSoon)&&(!cooperative||!brakeSoon&&!cornerSoon&&(closing>1.2||st.heldT>2))){
          const choices=options(front).sort((a,b)=>{
            const cost=x=>Math.abs(x-st.lane)+(brakeSoon&&Math.sign(x-front.lane)!==turnSide?1.1:0);
            return cost(a)-cost(b);
          });
          const off=choices[0];
          if(off!=null){move=st.overtake={key:keyOf(front),off,side:Math.sign(off-front.lane),startLane:front.lane,phase:gap<rearSpace(front)+4?'pass':'approach',base:Math.abs(st.lane)<2?0:Math.round(st.lane/3.1)*3.1,bestGap:gap,switched:false,age:0,noGain:0,wasCorner:cornerSoon,dm:front.dm,lane:front.lane,sep:Math.abs(front.lat-myLat),sepV:0,kind:brakeSoon&&Math.sign(off-front.lane)===turnSide?'dive':cornerSoon?'outside':'slingshot'};leader=front;st.overtakeStarts=(st.overtakeStarts||0)+1;}
        }
      }
      if(move){
        move.dm=leader.dm+(leader.speed-speed)*dt;move.lane=leader.lane;
        const separation=Math.abs(leader.lat-myLat),rate=clamp((separation-move.sep)/Math.max(.001,dt),-8,8);
        move.sepV+=(rate-move.sepV)*Math.min(1,dt*8);move.sep=separation;
        want=move.phase==='approach'?move.base+move.side*.35:move.off;
        st.laneHold=1.2;busy=true;attack={dM:leader.dm,o:leader};
        if(move.phase==='pass'&&brakeSoon&&turnSide===move.side&&actualGap(leader)>0&&actualGap(leader)<25&&separation>sideSpace(leader)+.05)lateBrake=intent;
      }else if(st.laneHold<=0&&!crosses(0)&&!cornerSoon)want=0;
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
      sight.set(key,{lane:o.lane,mine:actualLane,ov,mv});
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
    if(!launchColumns&&Math.abs(want-actualLane)>.15&&crosses(want)) {
      // 자기 줄로 되돌아오는 작은 보정은 버티고, 옆 차를 가로지르는 합류만 보류.
      const blockedBy=beside.filter(o=>(want-o.lane)*(actualLane-o.lane)<0||Math.abs(want-o.lane)<sideSpace(o)+.12);
      for(const o of blockedBy)if(!briefSideContact(o)&&yieldTo(o)&&Math.abs(actualLane-o.lane)<sideSpace(o)*.75)follow=Math.min(follow,Math.max(3,o.speed-1));
      want=actualLane;
    }
    if(beside.length&&!risky&&!mergeHazard)hold=bold?.25:.1;
    st.laneTarget=move?.wideRetry?clamp(want,L.lo[i0]+.2-L.offset[i0],L.hi[i0]-.2-L.offset[i0]):clamp(want,-6.4,6.4);
    const laneRate=cornerSoon&&speed>35?(bold?2:1.6):2.6;
    st.lane+=clamp(st.laneTarget-st.lane,-laneRate*dt,laneRate*dt);
    let lane=st.lane;

    for(const o of peers){
      const dLat=o.lat-myLat,gap=actualGap(o),closing=Math.max(0,speed-o.speed),width=sideSpace(o);
      if(!briefSideContact(o)&&gap>0&&gap<100&&Math.abs(dLat)<width+.08){
        const target=!!move&&o===leader;
        const desired=clamp(L.offset[i0]+st.laneTarget,L.lo[i0]+.2,L.hi[i0]-.2);
        const toSide=target&&move.sepV>.25?Math.max(0,width+.12-Math.abs(dLat))/move.sepV:Infinity;
        const envelope=rearSpace(o)+.25;
        const toRear=closing>.1?(gap-envelope)/closing:Infinity;
        const clearing=target&&move.phase==='pass'&&Math.abs(desired-o.lat)>width+.12&&toSide+.2<toRear&&gap>envelope+.5;
        const gapM=envelope+Math.max(0,speed)*(bold?.025:.06);
        if(!clearing){
          if(target){const room=gap-gapM;follow=Math.min(follow,Math.max(0,o.speed+Math.sign(room)*Math.sqrt(10*gHere*Math.abs(room))));}
          else if(Math.abs(o.lane-lane)<width+.25||gap<gapM+closing*2+3)follow=Math.min(follow,Math.sqrt(Math.max(0,o.speed*o.speed+2*7*gHere*(o.dm-gapM))));
        }
        // 앞날개가 뒷범퍼에 닿기 전에는 반드시 제동. 나란히 확보한 옆 접촉과 구별.
        if(gap<envelope+closing*.2+closing*closing/(16*gHere))follow=Math.min(follow,Math.max(0,o.speed-2));
      }
    }
    const inSide=move&&turnSide===move.side?1:0;

    // 옆줄 이동 속도도 목표 방향에 반영한다. 평행선만 향하면 핸들이 늦게 따라가 크게 꺾고 감속했음.
    const rawLaneV=st.prevCommandLane==null?0:clamp((lane-st.prevCommandLane)/Math.max(.001,dt),-2.6,2.6);
    st.commandLaneV=(st.commandLaneV||0)+(rawLaneV-(st.commandLaneV||0))*Math.min(1,dt*6);
    st.prevCommandLane=lane;
    const laneV=st.commandLaneV;
    // --- 조향 ---
    const fx = car.fwd.x, fz = car.fwd.z, fl = Math.hypot(fx, fz) || 1;
    const angTo = (dx, dz) => Math.atan2((fx * dz - fz * dx) / fl, (fx * dx + fz * dz) / fl); // + = 오른쪽으로 돌아야 함
    const noise = level.noise * (Math.sin(st.t * 1.7 + st.phase) + 0.5 * Math.sin(st.t * 4.3 + st.phase * 2));
    let steerCmd;
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
      const trafficPath=!!st.overtake||hold>0;
      const lateralGain=trafficPath?clamp(5/v,.05,.15):.15;
      const yawDes = windYaw -(Math.abs(lane) > 0.5 ? pathCurvature(kf, lane) : L.curvature[kf]) * v
        + 3 * (hd + (trafficPath?Math.atan2(laneV,v):0)) - lateralGain * (1 + hold) * latErr
        - .12 * hold * (latVel-laneV);
      const dfz = cfg.aero.downforce * Math.min(1.6, (v / cfg.maxSpeed) ** 2);
      const bankLat = cfg.bankGrip && !car.magnet && car.up.y > .8 && car.up.y < .9995
        ? 9.81 * (car.up.y * car.up.dot(car.right) - car.right.y) * Math.sign(yawDes) * cfg.bankGrip : 0;
      const latCap = Math.max(0.5 * cfg.steerLat, cfg.steerLat * (1 + (cfg.steerLatDownforce || 0) * dfz) * (1 - (cfg.steerLatLoad || 0) * (car.load || 0)) + bankLat);
      const perSteer = cfg.steerRate * Math.min(1, v / 8) * Math.min(1, latCap / (cfg.steerRate * v)); // 핸들 1일 때 회전 속도 (car.js와 같은 식)
      // 원래 차의 꼬리 미끄러짐/핸들 지연을 보고 카운터. 성능값을 올리지 않고 조작으로 잡음.
      const yawNow = st.lastFx == null ? car.yawRate || 0 : Math.atan2(st.lastFx*fz-st.lastFz*fx,st.lastFx*fx+st.lastFz*fz)/Math.max(.001,dt);
      st.actualYaw = (st.actualYaw ?? yawNow) + (yawNow-(st.actualYaw ?? yawNow))*Math.min(1,dt*14);
      st.lastFx=fx;st.lastFz=fz;
      steerCmd = (yawDes + .45*(yawDes-st.actualYaw) - .8*(car.slip||0)) / Math.max(0.05, perSteer);
      // 핸들을 끝까지 꺾어도 모자란 정도 (마스터 봇이 속도를 줄이는 데 씀). 라인에서 도는 쪽 반대로 1 m 넘게 밀려나 있을 때만 (달처럼 잠깐 꽉 꺾는 곳은 그냥 둠)
      st.cornerLoad = circuit && !trafficPath && Math.abs(car.slip||0)<.12 && cfg.steerLatLoad
        ? clamp((1-(Math.abs(L.curvature[kf])*v*v-bankLat)/(cfg.steerLat*(1+(cfg.steerLatDownforce||0)*dfz)))/cfg.steerLatLoad,-.6,1) : 1;
      st.satur = Math.sign(steerCmd) * -latErr > 1 ? Math.abs(steerCmd) - 1 : 0;

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
      const dfz = cfg.aero.downforce * Math.min(1.6, (v / cfg.maxSpeed) ** 2);
      const latCap = cfg.steerLat * (1 + (cfg.steerLatDownforce || 0) * dfz) * (1 - (cfg.steerLatLoad || 0) * (car.load || 0));
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
    let tgt = Infinity;
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
    for (let q = 0; q <= reach; q += q < 8 ? 1 : 3) {
      const iq = W(lead + q);
      const free = boosting && activeProf.speed[iq] >= vTop * 0.97 && !activeProf.brake[iq];
      if (free) continue;
      let vq = activeProf.speed[iq] * k;
      let legacyVq = prof.speed[iq] * k;
      const halfWidth = S[iq].hw ?? (track.width || 16) / 2;
      if (halfWidth < 7 && car.mode !== 'boat') { vq *= 0.96; legacyVq *= 0.96; } // 한 줄 산길에서는 같은 안전 여유

      if (Math.abs(lane) > 0.5 && car.mode !== 'boat' && car.surface !== 'magnet' && !S[iq].roll && !S[iq].gap) {
        const signedCurve = pathCurvature(iq, lane), curve = Math.abs(signedCurve);
        const bankLat = 9.81 * Math.sin(S[iq].bank || 0) * Math.sign(signedCurve) * (cm.bankGrip || 0);
        const lat = cm.aLat(vq);
        if (curve > 0.001) {
          const cap = Math.sqrt(Math.max(lat*.5, lat+bankLat) / curve) * Math.min(1, k);
          vq = Math.min(vq, cap); legacyVq = Math.min(legacyVq, cap);
        }
      }
      if (aeroTop > 1.001 && !prof.brake[iq]) legacyVq *= 1 + (aeroTop - 1) * clamp((prof.speed[iq] / aeroRef - 0.75) / 0.2, 0, 1);
      // 원래 쓰던 공력 보너스 목표를 낮추지 않고, 가속 제한 때문에 못 쓰던 몫만 더 활용.
      if(!exactMaster)vq = Math.max(vq, legacyVq);
      if (jumpCap.size && jumpCap.has(iq)) vq = Math.min(vq, jumpCap.get(iq) * Math.min(jumpK, 1.12));
      const allow = Math.sqrt(vq * vq + 2 * kB * gHere * cm.aBrake(vq) * q * ds);
      if (allow < tgt) tgt = allow;
    }
    // 마스터(level.master.saturBrake): 도움으로 빨라진 만큼 핸들이 모자라면(끝까지 꺾어도 원하는 만큼 못 돎) 바로 액셀을 떼고 줄임
    //   (화산 T7 출구·H1 출구에서 핸들 끝까지 꺾은 채 바깥 벽에 박혔음. 어려움은 이 규칙 없음 = 예전 그대로)
    //   접전(CLOSE)으로 빨라진 봇(eq.keep > 1)도 같은 규칙 (화산에서 사람보다 뒤인 봇이 계속 빨라져 낭떠러지로 떨어졌음)
    const sBrake = st.circuitClear ? 1.5 : (level.master && level.master.saturBrake) || (st.closeOn && eq.keep > 1.001 ? 8 : 3);
    const straightPass = !!st.overtake && st.overtake.phase === 'pass' && !cornerSoon && !brakeSoon && !risky && !mergeHazard;
    if (sBrake && !straightPass && car.grounded && speed > 12 && st.satur > 0.05) tgt = Math.min(tgt, speed - 1 - sBrake * st.satur);
    st.satur = 0;
    // 실력별 최고 속도 (직선이 긴 맵에서도 실력 차이가 나게). 부스터 중에는 제한 없음
    //   (aeroTop: 위 슬립스트림·견인·DRS 몫, 상한에도 같이)
    if (level.topK && !boosting) tgt = Math.min(tgt, vTop * level.topK * pm * (st.calm ? Math.min(eq.topMul, eq.topCalm) : eq.topMul) * aeroTop);
    // 따라잡기 효과로 늦추는 중(paceMul < 1)이면 직선 최고 속도도 같이 낮춤 (코너만 늦추면 효과가 거의 없음)
    else if ((st.paceMul < 0.999 || eq.topMul < 0.999) && !boosting) tgt = Math.min(tgt, vTop * st.paceMul * eq.topMul * aeroTop);
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
      tgt = Math.min(tgt, follow);
    }
    if (st.passT > 0) st.passT -= dt;
    if (speed > tgt + 0.4) {
      c.throttle = 0;
      c.brake = clamp((speed - tgt) / 3, 0, 1);
    }
    if (circuit && car.grounded && car.mode !== 'fly' && car.mode !== 'boat' && car.surface !== 'magnet' && st.cornerLoad < -.1 && speed > 25 && c.brake < .1) {
      // 코너 전에 액셀을 덜 밟아 앞 하중을 남긴다. 차 물리의 하중/접지는 그대로다.
      c.throttle=Math.min(c.throttle,clamp(.35+st.cornerLoad,0,.3));
    }
    if (car.grounded && car.mode !== 'boat' && car.surface !== 'magnet') c.throttle=Math.min(c.throttle,clamp(1-2.5*Math.max(0,Math.abs(car.slip||0)-.12),.45,1));
    if (st.mistake === 'lift') c.throttle = Math.min(c.throttle, 0.35);
    // 실력별 액셀 (쉬움일수록 덜 밟음: 직선·비행 구간에서도 차이). 추월 시도 중에는 성격만큼 더 밟음
    const thrNow = pushing ? Math.min(1, thrK + 0.05 + 0.1 * aggr) : thrK;
    if (thrNow < 1 && !boosting) c.throttle = Math.min(c.throttle, thrNow);
    st.dbg = { overtake:st.overtake?{phase:st.overtake.phase,kind:st.overtake.kind,side:st.overtake.side,switched:st.overtake.switched,age:st.overtake.age}:null, follow, tgt, lane: st.lane, laneT: st.laneTarget, lateBrake, inSide, shove, hold, pass: +st.passT.toFixed(1) };

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
      st.prevLat = null;
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
