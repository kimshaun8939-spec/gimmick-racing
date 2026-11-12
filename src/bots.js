// AI 봇 운전사: 레이싱 라인 + 속도 계획을 따라 달림 (진짜 차 물리 Car를 조작 명령으로만 움직임 → 사람과 같은 규칙)
//
//   조향 (땅): 원하는 회전 속도 = 라인 곡률×속도 + 방향 오차 + 옆 오차 → 이 차가 핸들 1로 도는 회전 속도로 나눔 (2026-11-10 hard2)
//   조향 (공중·비행·배): 앞 (6 + 속도×0.35) m 라인 점을 향하고, 조금 앞 라인의 곡률만큼 미리 꺾음 (.debug/lineLap.js와 같은 방법)
//   속도: 0.25초 앞 지점의 계획 속도 × 실력(pace). 넘으면 브레이크
//   추월: 앞차가 같은 줄에 있고 내가 더 빠르면 옆 줄(왼쪽/오른쪽 중 넓은 쪽)로 비켜서 지나감. 자리가 없으면 따라감
//   나란히: 옆에 붙은 차가 있으면 조금 떨어짐
//   실수: 가끔 코너에서 넓게 나가거나, 액셀을 잠깐 떼거나, 브레이크를 늦게 밟음 (쉬움일수록 자주)
//   부스터(E): 앞에 브레이크 구간이 없는 긴 직선에서 씀 (보통·어려움)
import * as THREE from 'three';
import { lineCarModel } from './car.js';

export const BOT_NAMES = ['레오', '미나', '카이', '루나', '준호', '사라', '토르', '하나', '제트', '노바'];

/** 실력 단계 (설정 botLevel) */
export const BOT_LEVELS = {
  // 실력 3단계 (2026-11-10 오후 'hard2' 다시 맞춤). 기준 = 진짜 사람 기록
  //   사용자(잘하는 사람) 블루 프로토: 그랑프리 1바퀴 184.0초, 달 2바퀴 134.7초 → 예전 어려움 봇(220초·166초)을 21초 차로 이김
  //   원인: 봇 조향 방식이 나빴음. 20 m 앞 점을 향해 꺾는 방식은 빠른 코너에서 핸들이 늦게 풀려 안쪽 잔디로 파고들었음
  //     (예전 라인 봇도 그랑프리 1바퀴 중 36초를 잔디 위에서 보냄). 그래서 '라인 봇 = 거의 완벽'이라는 예전 기준이 틀렸음
  //   → 조향을 '원하는 회전 속도' 방식으로 바꿈 (아래 controls의 조향). 같은 차·같은 계획으로 그랑프리 216.7 → 188.9초, 달 156.6 → 142.4초
  //   쉬움: 처음 하는 사람(벽에 박고 가끔 복귀)도 이김 + 따라잡기로 늦춰 줌
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
  // firm = 사람 옆에서 자리 지키기 (0 = 늘 양보, 1 = 내가 나란히·앞이면 안 물러남). 봇끼리는 예전처럼 양보
  // playerPush = 플레이어와 부딪힐 때 플레이어가 받는 몫 (0.5 = 반반, 0.57 = 봇이 조금 무거운 것처럼)
  // catchUp = 따라잡기 효과 (raceSystem.js catchUp, 기준 = 가장 앞선 사람):
  //   쉬움 {aheadM, releaseM, slowMul}: 사람보다 aheadM m 넘게 앞선 봇은 slowMul배로 늦춤(코너·직선 모두), releaseM m 안으로 오면 원래대로. 빨라지게는 절대 안 함
  //   어려움 {sec, upMul, upDraft, downMul, secDown}: 사람이 sec초 넘게 앞서면 upMul배 + 보이지 않는 슬립스트림 upDraft(공기 저항 −30%×upDraft),
  //     봇이 secDown초 넘게 앞서면 downMul배
  //   보통: 없음
// fly = 그랑프리 비행 루트 (2026-11-10 bots-fly): speed = 공중 속도(m/s, 비행 최고 55), latK = 활주로로 꺾어 들어갈 때 옆 접지력 여유(낮을수록 일찍·많이 줄임),
//   wobble = 공중에서 핸들·높이 흔들림 (쉬움일수록 큼). 없으면 { speed: 42, latK: 0.85, wobble: 0 }
  easy: { pace: 0.69, topK: 0.71, thrK: 0.8, paceVar: 0.008, react: [0.45, 0.8], noise: 0.05, mistakeEvery: 20, lateP: 0.1, boost: 0.15, boostLook: 3.4, lead: 0.3, brakeK: 0.95, firm: 0.15, playerPush: 0.5, catchUp: { aheadM: 120, releaseM: 30, slowMul: 0.85 }, fly: { speed: 38, latK: 0.75, wobble: 0.08 } },
  normal: { pace: 0.85, topK: 0.87, thrK: 0.88, paceVar: 0.007, react: [0.28, 0.5], noise: 0.025, mistakeEvery: 38, boost: 0.6, boostLook: 3, lead: 0.26, brakeK: 0.95, firm: 0.45, playerPush: 0.53, fly: { speed: 44, latK: 0.8, wobble: 0.04 } },
  hard: { pace: 1.04, topK: 1, thrK: 1, paceVar: 0.006, react: [0.17, 0.3], noise: 0.012, mistakeEvery: 100, boost: 3, boostLook: 2.2, lead: 0.24, brakeK: 1, jumpK: 1.3, firm: 0.9, playerPush: 0.57, catchUp: { sec: 2.5, upMul: 1.03, upDraft: 0.6, downMul: 0.97, secDown: 5 }, fly: { speed: 50 } },
};

// 마스터(master, 2026-11-10 사용자 요청: 처음엔 "내 기록보다 빠르게" → 고침 "내 기록과 상관없이 그냥 어렵게, 이름은 마스터"):
//   운전은 어려움과 똑같고, 봇마다 고정된 도움 h(help 범위 안, 봇마다 다르게)를 늘 받음 = 내 기록을 안 봄
//   도움 h(0~1): 코너 속도 +paceMax·h, 타이어 접지(옆·앞뒤·브레이크)와 핸들 회전 +gripMax·h, 엔진 힘 +powerMax·h,
//     보이지 않는 슬립스트림 draftMax·h (공기 저항 −30%·최고 속도 +4%까지)
//     + saturBrake: 핸들을 끝까지 꺾어도 모자라면 바로 속도를 줄임 (화산 T7·H1 출구에서 벽에 박혔던 것)
//   점프 근처(봇 st.calm)에서는 코너 속도·힘 도움 없음 (접지 도움만). 저중력 구역은 calmGrav: false라 도움 그대로
//   사람이 humanSec초 넘게 앞서면 늦은 만큼(gain초면 최대 1) 도움을 더 올림 (어려움 봇의 catchUp 같은 것)
//   출발 덩어리(처음 3초)는 startHelp까지만
BOT_LEVELS.master = {
  ...BOT_LEVELS.hard,
  catchUp: null,
  master: { help: [0.89, 0.96], startHelp: 0.45, gain: 1.5, humanSec: 1.5, paceMax: 0.1, gripMax: 0.24, powerMax: 0.25, draftMax: 1, calmGrav: false, saturBrake: 8 },
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
export const CLOSE = { on: false };
// 봇 목표 최고 속도에 슬립스트림·견인·DRS 몫을 더하기 (2026-11-12 drs). &botaero=0 = 예전처럼 안 더함 (비교 시험용)
let BOT_AERO = true;
try {
  const q = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
  if (q.get('close') === '1') CLOSE.on = true;
  if (q.get('botaero') === '0') BOT_AERO = false;
} catch {}
//   draft = 띠보다 draftAt초(기본 1) 넘게 뒤처진 봇에게 (1.5초에 걸쳐 커짐) 주는 보이지 않는 슬립스트림 최대 (raceSystem cuDraft, 예전 어려움 upDraft와 같은 것; 속도 계획 표가 없는 맵(화산)에서도 실제로 빨라지게)
BOT_LEVELS.easy.close = { ahead: 0.6, behind: 0.8, up: 0.12, down: 0.15, kUp: 0.06, kDown: 0.08 };
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

// --- 같은 단계 봇끼리 비슷하게 (2026-11-12 사용자 요청 "같은 난이도여도 실력 차이가 커서 같이 경쟁이 안 됨", 메모 .debug/agents/bots-pack.md) ---
//   원인 (봇 7대, 따라잡기 끔, .debug/pack_test.js): 1등과 꼴찌 차이 보통 8~12%, 빙하 B 등급은 33%
//     ① 같은 등급 차라도 맵마다 빠르기가 다름 (혼자 달려도 gp A 3%·B 8%, 빙하 A 9%·B 30%) → 빠른 차가 느린 차 뒤에 막혀 더 벌어짐
//     ② paceVar: 봇마다 코너 속도 ±2~3.5% + 액셀도 같이 (쉬움·보통은 이것만으로 5~10%)  ③ 마스터 도움 범위 0.85~1
//   고친 것: carEq = 봇은 '자기 차가 이 맵에서 같은 등급 가운데 차보다 몇 % 빠른지'(CAR_REL 표)만큼 늦추거나(최대 slowMax)
//     보이지 않게 도와줌(최대 helpMax: 타이어 접지·핸들·엔진·최고 속도. 사람 차에는 안 함). 표에 없는 맵·차는 속도 계획 시간으로 어림(늦추기만·빠르게는 여유 안에서)
//     + 봇이 고르는 차에서 이 맵에서 너무 느린 차(rel > pickMax)는 빼고 (같은 등급 다른 차가 충분하면) + paceVar 줄임 + keep(무리 유지)
//   ?pack=0 이면 전부 예전처럼 (paceVar는 줄인 값 그대로), ?keep=0 이면 무리 유지만 끔
export const PACK = {
  on: true,
  slowMax: 0.15, // 빠른 차를 최대 15%까지 늦춤
  helpMax: 0.06, // 느린 차는 최대 6%까지 빠르게 (보이지 않는 도움)
  pickMax: 1.06, // 이 맵에서 등급 가운데보다 6% 넘게 느린 차는 봇이 고르지 않음 (다른 차가 충분할 때)
  // 무리 유지: 봇끼리만 (사람은 안 봄). 봇 무리 가운데(중앙값)보다 behind초 넘게 뒤면 1초당 perSec씩(최대 up) 빠르게, ahead초 넘게 앞이면 (최대 down) 늦게.
  //   벌어지는 이유는 대부분 첫 바퀴: 맨 앞 그리드 차만 빈 길로 빠져나가고 나머지는 첫 코너에서 엉키고 줄 서서 5~10초 잃음
//   → 무리보다 앞선 차는 늦추고(최대 down) 뒤처진 차는 당김(최대 up) → 다시 한 덩어리가 되어 추월이 일어남
  //   fMax = 차 맞추기 × 무리 유지 최대. 마스터는 코너·직선 목표 속도만 (차 도움은 raceSystem 마스터 도움이 덮어써서)
  open: { sec: 25, k: 0.95 }, // 출발 뒤 sec초 동안 바로 앞에 차가 있으면 코너 속도 ×k (어려움·마스터, 예전 그대로)
  keep: { on: true, after: 8, behind: 1, ahead: 1, up: 0.07, down: 0.05, perSec: 0.025, fMax: 1.1, bias: 1.015 },
};
try {
  const q = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
  if (q.get('pack') === '0') PACK.on = false;
  if (q.get('keep') === '0') PACK.keep.on = false;
  if (q.get('opensec')) PACK.open.sec = +q.get('opensec');
  if (q.get('openk')) PACK.open.k = +q.get('openk');
} catch {}

// 차마다 맵별 혼자 달린 시간 ÷ 같은 등급 가운데값 (어려움 운전, 실수·paceVar 끔, 1.00 = 등급 가운데, 1.05 = 5% 느림)
//   만드는 법: .debug/pack_solo.js(차·맵마다 혼자 달리기) → .debug/pack_table.py. L = 그때 트랙 길이 (맵을 고쳐 길이가 바뀌면 표를 안 쓰고 속도 계획으로 어림)
const CAR_REL = {
  gp: { L: 10138.1, rel: { f1: 1.004, proto: 0.99, hyper: 1.021, rocket: 0.999, volt: 1.0, razor: 1.007, nova: 0.995, gt: 0.98, rally: 1.027, muscle: 1.0, junior: 0.99, trophy: 1.075, midnight: 0.981, blizzard: 1.018, buggy: 1.008, kart: 1.0, hatch: 0.995, roadster: 0.967, pickup: 1.142, cube: 0.996, scorpion: 1.008 } },
  sea: { L: 3454.3, rel: { f1: 0.996, proto: 0.999, hyper: 1.015, rocket: 0.996, volt: 1.008, razor: 1.0, nova: 1.008, gt: 0.987, rally: 1.024, muscle: 0.998, junior: 0.994, trophy: 1.079, midnight: 1.0, blizzard: 1.017, buggy: 0.999, kart: 0.997, hatch: 1.0, roadster: 0.977, pickup: 1.037, cube: 1.003, scorpion: 1.0 } },
  moon: { L: 3557.2, rel: { f1: 0.996, proto: 0.992, hyper: 1.015, rocket: 0.999, volt: 1.007, razor: 1.002, nova: 1.0, gt: 1.0, rally: 0.998, muscle: 1.001, junior: 0.969, trophy: 1.068, midnight: 1.001, blizzard: 0.993, buggy: 1.009, kart: 0.98, hatch: 0.999, roadster: 0.969, pickup: 1.063, cube: 1.0, scorpion: 1.013 } },
  glacier: { L: 4867.6, rel: { f1: 1.0, proto: 1.026, hyper: 0.94, rocket: 0.953, volt: 1.004, razor: 0.949, nova: 1.021, gt: 0.86, rally: 1.088, muscle: 0.885, junior: 1.027, trophy: 1.0, midnight: 0.853, blizzard: 1.068, buggy: 1.011, kart: 1.053, hatch: 0.983, roadster: 0.89, pickup: 1.02, cube: 0.993, scorpion: 1.0 } },
  neon: { L: 3514.6, rel: { f1: 0.984, proto: 1.0, hyper: 1.005, rocket: 0.979, volt: 1.002, razor: 0.985, nova: 1.003, gt: 0.97, rally: 1.017, muscle: 0.98, junior: 1.0, trophy: 1.035, midnight: 0.97, blizzard: 1.01, buggy: 0.999, kart: 0.986, hatch: 1.001, roadster: 0.935, pickup: 1.016, cube: 1.005, scorpion: 1.0 } },
  jungle: { L: 3562.5, rel: { f1: 1.0, proto: 0.991, hyper: 1.025, rocket: 1.004, volt: 0.999, razor: 1.025, nova: 0.994, gt: 0.983, rally: 1.009, muscle: 1.005, junior: 0.981, trophy: 1.064, midnight: 0.985, blizzard: 1.0, buggy: 1.014, kart: 0.988, hatch: 1.0, roadster: 0.972, pickup: 1.049, cube: 1.002, scorpion: 1.0 } },
};

const mapParam = () => {
  try {
    return new URLSearchParams(location.search).get('map') || 'gp';
  } catch {
    return 'gp';
  }
};
/** 이 맵 표에서 이 차의 rel (없으면 null) */
function tableRel(track, carId) {
  const e = CAR_REL[mapParam()];
  if (!e || !track || Math.abs(e.L - track.length) > 3) return null;
  return e.rel[carId] ?? null;
}
const planReg = new WeakMap(); // 트랙 → Map(차 → 속도 계획 한 바퀴 시간): 표가 없을 때 봇들끼리 비교
function planTime(prof, track) {
  let t = 0;
  const n = prof.speed.length, ds = track.length / n;
  for (let i = 0; i < n; i++) t += ds / Math.max(1, prof.speed[i]);
  return t;
}
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

const profiles = new Map(); // 차 종류마다 속도 계획 (한 번만 계산)
/** 그 차 성능으로 계산한 라인 속도 계획 */
export function profileFor(line, cfg) {
  const key = cfg.carId || 'base';
  if (!profiles.has(key)) profiles.set(key, line.profile(lineCarModel(cfg)));
  return profiles.get(key);
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// --- 비행 루트 (그랑프리 활주로 → 고리 4개 → 착륙장, 2026-11-10 bots-fly) ---
//   사람처럼: 활주로로 들어가면 차가 저절로 비행 모드(car.js autoSwitch) → 활주로 끝에서 Space(climb)로 이륙
//   → 고리를 잇는 매끈한 곡선(.debug/fly.js flyTest와 같은 곡선)을 따라 날고 → 착륙장에 내려 라인으로 돌아감
//   비행 구역(car.flightAllowed) 안에서만 날게 되어 있어서 따로 막을 필요 없음
const planCache = new WeakMap();
const APPROACH = 170; // 활주로 시작 몇 m 앞부터 활주로로 들어갈 준비 (속도 줄이기)
export function flightPlan(track) {
  if (planCache.has(track)) return planCache.get(track);
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
    const dense = new THREE.CatmullRomCurve3([...path.map((v) => v.clone()), landPt], false, 'centripetal').getSpacedPoints(n);
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
  planCache.set(track, p);
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
  const pace = level.pace + (rand() * 2 - 1) * level.paceVar;
  // 같은 단계 봇끼리 비슷하게 (PACK): opts.pack === false면 끔 (테스트에서 사람 차를 봇 운전사로 몰 때)
  const packOn = PACK.on && opts.pack !== false;
  const pe = pace > 1 ? 1 + (pace - 1) * 0.25 : pace; // 실제로 먹는 코너 속도 배수 (1 위로는 차 한계라 거의 안 빨라짐)
  const topK0 = level.topK || 1;
  const eq = { carK: 1, keep: 1, kMul: 1, topMul: 1, kCalm: 1, topCalm: 1, src: 'off' };
  /** 차 맞추기·무리 유지를 합친 배수 f(>1 빠르게, <1 늦게) → 코너 속도 배수·최고 속도 배수·보이지 않는 도움 */
  function applyEq(physical) {
    const f = Math.min(PACK.keep.fMax || 9, eq.carK * eq.keep);
    eq.kMul = f >= 1 ? f : (pe * f) / pace;
    eq.topMul = f;
    // 점프 근처·저중력(st.calm)에서는 무리 유지로 빨라지지 않음 (달 B등급: 뭉친 채 빨리 뛰다 착지에서 코스 밖 복귀가 늘었음)
    const fc = Math.min(PACK.keep.fMax || 9, eq.carK * Math.min(1, eq.keep));
    eq.kCalm = fc >= 1 ? fc : (pe * fc) / pace;
    eq.topCalm = fc;
    if (physical) {
      // 느린 차를 빠르게: 실력 배수로 모자란 만큼만 차를 도움 (쉬움·보통은 여유가 있어 거의 안 도움)
      const c = Math.max(1, pe * f) / Math.max(1, pe);
      const t = Math.max(1, topK0 * f) / Math.max(1, topK0);
      if (c > 1.0005 || t > 1.0005 || car._packHelp) setCarHelp(car, c, t);
    }
  }
  if (packOn && car.cfg) {
    const rel = tableRel(track, car.cfg.carId);
    if (rel != null) {
      eq.carK = clamp(rel, 1 - PACK.slowMax, 1 + PACK.helpMax);
      eq.src = 'table';
      applyEq(true);
    } else {
      // 표 없음: 봇들끼리 속도 계획 시간으로 비교 (첫 조작 때, 모든 봇이 만들어진 뒤)
      let reg = planReg.get(track);
      if (!reg) planReg.set(track, (reg = new Map()));
      reg.set(car, planTime(prof, track));
      eq.src = 'plan?';
    }
  }
  const cm = lineCarModel(car.cfg); // 제동력 계산용
  const thrK = level.thrK ? Math.min(1, (level.thrK * pace) / level.pace) : 1; // 봇마다 조금씩 다른 액셀 (실력 차이)
  let vTop = 0;
  for (let i = 0; i < N; i++) vTop = Math.max(vTop, prof.speed[i]);
  const st = {
    lane: 0, // 지금 라인에서 옆으로 비킨 거리 (m, + 오른쪽)
    laneTarget: 0,
    laneHold: 0, // 추월 줄을 유지할 남은 시간
    react: level.react[0] + rand() * (level.react[1] - level.react[0]),
    phase: rand() * 10,
    mistake: null, mistakeT: 0, nextMistake: level.mistakeEvery * (0.4 + rand()),
    t: 0, boostCool: 2 + rand() * 4,
    paceMul: 1, // 바깥(raceSystem)이 고무줄 효과로 조절
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
  const narrowAt = (i) => L.hi[i] - L.lo[i] < 5.5;
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
  const plan = flightPlan(track);
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
      f = Math.min(f, Math.sqrt(o.speed * o.speed * 0.8 + 2 * 6 * Math.max(0, o.progM - 7)), o.progM < 7 ? o.speed - 2 : Infinity);
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
        c.throttle = 0.3;
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
    st.dbg = { fly: st.fly, apI: bi, tgt: +tgt.toFixed(1) };
    return c;
  }

  /** 라인 지점 j에서 옆으로 lane만큼 비킨 목표 점 */
  function target(j, lane) {
    const s = S[j];
    const off = clamp(L.offset[j] + lane, L.lo[j] + 0.2, L.hi[j] - 0.2);
    return [s.pos.x + s.right.x * off, s.pos.z + s.right.z * off];
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
    // 비행 루트 (그랑프리): 활주로·공중에서는 땅 운전 대신
    const fc = plan ? flyControls(ctx, c, i0, speed) : null;
    if (fc) {
      if (ctx.since < st.react) c.throttle = c.brake = 0;
      if (st.fly !== 'approach') st.dbg = { fly: st.fly, flyI: st.flyI };
      return c;
    }

    // --- 같은 단계 봇끼리 비슷하게 (PACK) ---
    if (eq.src === 'plan?') {
      // 표가 없는 맵·차: 이 트랙 봇들의 속도 계획 시간 가운데값과 비교 (늦추기만 확실히, 빠르게는 실력 여유 안에서 = 차는 안 도움)
      const reg = planReg.get(track), ts = reg ? [...reg.values()].sort((a, b) => a - b) : [];
      const me = reg && reg.get(car);
      if (ts.length >= 2 && me) eq.carK = clamp(me / ts[(ts.length - 1) >> 1], 1 - PACK.slowMax, 1 + PACK.helpMax);
      eq.src = 'plan';
      applyEq(false);
    }
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
        applyEq(eq.src === 'table' && !level.master);
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

    // --- 차들 사이: 추월·따라가기·나란히 ---
    let follow = Infinity; // 앞차 때문에 줄여야 하는 속도
    let busy = false;
    const myLat = ti.lateral;
    const gHere = gAt(i0);
    // 출발 직후: 그리드 칸 줄을 2.5초 동안 지키고 천천히 라인으로 (모두 한꺼번에 라인으로 모이면 출발에서 부딪힘)
    if (!st.started) {
      st.started = true;
      if (ctx.since < 1.5) {
        st.lane = st.laneTarget = clamp(myLat - L.offset[i0], -9, 9);
        st.laneHold = 2.5;
      }
    }
    // 추월 시도 중(앞차 때문에 1.5초 넘게 막힘 = 내가 더 빠름): 더 바짝 붙고, 액셀을 끝까지 밟고, 코너에서 조금 늦게 브레이크
    const pushing = st.passT > 0;
    const gapM = 6 + (0.25 - 0.08 * aggr - (pushing ? 0.05 : 0)) * Math.max(0, speed);
    let narrowSoon = false, brakeSoon = false;
    for (let q = 0; q < (60 + speed * 2) / ds && !narrowSoon; q += 4) narrowSoon = narrowAt(W(i0 + q));
    const jumpSoon = !!jumpZone && !!jumpZone[i0];
    let jumpTraffic = false; // 점프 구역에서 앞 60 m ~ 뒤 15 m 안에 다른 차
    let packAhead = false; // 바로 앞 30 m 안 같은 줄 근처에 차
    const firmOK = !risky && !jumpSoon && !narrowSoon && ctx.since > 12;
    if (jumpSoon) narrowSoon = true; // 점프 구역: 추월 줄·나란히 줄 없이 라인 가운데로, 뒤차가 양보
    for (let q = 0; q < (20 + speed * 1.2) / ds && !brakeSoon; q += 3) brakeSoon = !!prof.brake[W(i0 + q)] || Math.abs(L.curvature[W(i0 + q)]) > 1 / 110; // 브레이크 구간·급한 코너
    let attack = null; // 바로 앞(35 m 안) 같은 줄의 차 → 슬립스트림을 타다가 부스터·추월
    let side = false; // 바로 옆에 차가 있음 → 빨리 비킴
    let lateBrake = 0; // 확실히 빠를 때만: 브레이크를 조금 늦게 (추월 마무리)
    let hold = 0; // 사람 옆에서 자리 지키기 (0~1, firm)
    let shove = 0; // 바로 옆 차와 너무 가까울 때 핸들을 직접 살짝 반대로 (줄 목표만으로는 20 m 앞을 겨냥해서 늦게 벌어짐)
    // 다음 코너의 안쪽 (라인 기준 옆 방향 부호, + = 오른쪽). 곡률 +면 왼쪽으로 도는 코너 → 안쪽은 −
    let inSide = 0;
    for (let q = 0; q < (40 + speed * 5) / ds; q += 3) {
      const cq = L.curvature[W(i0 + q)];
      if (Math.abs(cq) > 1 / 160) {
        inSide = -Math.sign(cq);
        break;
      }
    }

    // 옆에 나란히 있는 차들 (앞뒤 7 m, 옆 5 m 안): 추월 줄을 고를 때 이 차들을 가로질러 가지 않음
    const beside = [];
    for (const o of ctx.others) if (Math.abs(o.progM - ctx.me.progM) < 7 && Math.abs(o.lat - myLat) < 5) beside.push(o.lat);
    const crosses = (lat) => beside.some((bl) => (lat - bl) * (myLat - bl) < 0 || Math.abs(lat - bl) < 2.6);
    let sideTL = null; // 나란히 달릴 때 비켜설 줄 (추월 줄보다 우선)
    for (const o of ctx.others) {
      const dM = o.progM - ctx.me.progM; // + = 앞
      const dLat = o.lat - myLat;
      const closing = speed - o.speed;
      // 사람(플레이어·온라인 상대) 옆에서 자리 지키기 0~1 (실력 firm × 성격). 봇끼리는 0 = 예전처럼 양보 (봇끼리 접촉이 늘지 않게)
      //   예전엔 사람이 옆으로 밀고 들어오면 봇이 늘 물러나서 몸싸움에서 사람이 항상 이겼음
      //   출발 직후 12초(한 덩어리)·점프·저중력·좁은 길에서는 안 버팀 (거기서 버티면 코스 밖으로 튕겨 복귀만 늘어남)
      const firm = o.human && firmOK ? (level.firm || 0) * (0.6 + 0.4 * aggr) : 0;
      if (jumpSoon && dM > -(level.jumpTrafficM ? level.jumpTrafficM[0] : 15) && dM < (level.jumpTrafficM ? level.jumpTrafficM[1] : 60)) jumpTraffic = true;
      if (dM > 2 && dM < 30 && Math.abs(dLat) < 3.5) packAhead = true;
      // 점프 구역에서 옆(6 m 안)에 조금 앞선 차가 있으면 뒤로 빠져 그 차 뒤에 줄 섬 (슬립스트림 타고 따라감)
      if (jumpSoon && dM > 0 && dM < 8 && Math.abs(dLat) < 6) follow = Math.min(follow, o.speed - 2.5);
      // 얼마나 앞까지 볼지: 빨리 다가갈수록 멀리 (멈춘 차도 미리 피하게)
      const range = clamp(closing * 2.6, 40, 130);
      if (dM > -6 && dM < 6 && Math.abs(dLat) < 3.4) {
        // 나란히: 그 차 옆 3.6 m 줄로 비켜섬 (차 폭 2 m + 여유). 자리가 없으면(벽·좁은 길) 뒤로 물러남
        //   3.4 m까지 떨어져도 계속 '나란히'로 봄 (예전 2.7 m: 벌어지자마자 둘 다 라인으로 돌아가 다시 붙었음)
        const want = o.lat + (dLat > 0 ? -3.6 : 3.6);
        if (want > L.lo[i0] + 0.2 && want < L.hi[i0] - 0.2) {
          const tl = clamp(want - L.offset[i0], -9, 9);
          // 자리 지키는 봇(firm > 0.5)이 사람과 나란히·앞이면 비켜설 줄로 옮기지 않음 (밀어도 내 줄)
          const keep = firm > 0.5 && dM < 1;
          if (!keep && Math.abs(tl - st.lane) > 0.3 && (sideTL === null || Math.abs(tl - st.lane) > Math.abs(sideTL - st.lane))) sideTL = tl;
        } else if (dM > -1.5 + 3.5 * firm) follow = Math.min(follow, o.speed - 2.5); // 자리 없음: 내가 확실히 앞이 아니면 물러남 (firm이면 상대가 확실히 앞일 때만)
        st.laneHold = Math.max(st.laneHold, 0.8);
        side = true;
        busy = true;
        // 차 폭이 겹칠 만큼(옆 2.8 m 안) 붙어 있으면: 자리가 있는 쪽으로 핸들을 바로 조금 틀어 벌림.
        //   자리가 없으면(벽·잔디 쪽) 내가 확실히 앞서지 않은 이상 속도를 줄여 뒤로 빠짐
        const tight = 2.8 - Math.abs(dLat);
        if (tight > 0 && Math.abs(dM) < 5.2) {
          const away = dLat > 0 ? -1 : 1;
          //   (라인 한계 lo~hi보다 0.8 m 더: 연석까지는 써도 됨)
          const room = myLat + away * 1.2 > L.lo[i0] - 0.8 && myLat + away * 1.2 < L.hi[i0] + 0.8;
          if (room) shove += away * Math.min(0.3, tight * 0.45) * (dM < 1 ? 1 - firm : 1); // 나란히·앞서 있으면 firm만큼 덜 비킴
          if (dM < 1) hold = Math.max(hold, firm); // 사람이 옆에서 밀면 내 줄로 더 세게 돌아옴 (아래 조향의 옆 오차 힘 ×(1+3×hold))
          if ((!room && dM > -2 + 4.2 * firm) || (tight > 0.6 && dM > 0.3 + 2.2 * firm)) follow = Math.min(follow, o.speed - (3 + 5 * tight) * (1 - 0.6 * firm)); // 뒤쪽 차가 물러남
        }
        if (dM > 1.5 + firm && Math.abs(dLat) < 1.9) follow = Math.min(follow, o.speed - 1); // 앞쪽 반쯤 겹침: 박지 않게 (firm이면 사람이 반 차 넘게 앞일 때만)
        // 앞이 좁아지면(점프대 앞 등) 뒤쪽 차가 양보해서 한 줄로
        else if (dM > 0.5 && narrowSoon) follow = Math.min(follow, o.speed - 2);
        else if (brakeSoon) {
          // 코너 앞 나란히: '안쪽 차 우선' 규칙 (두 차가 같은 규칙을 쓰므로 서로 양보하거나 서로 밀지 않음)
          //   안쪽 차는 차 머리가 상대 옆까지 와 있으면(앞차와 3 m 안) 자리를 지킴, 바깥 차가 양보.
          //   코너 방향을 모르면 예전처럼 뒤쪽 차가 양보
          const iAmInside = inSide !== 0 && (myLat - o.lat) * inSide > 0;
          if (inSide !== 0 && iAmInside && dM < 3) {
            if (speed - o.speed > 0.5 || dM < 0) lateBrake = Math.max(lateBrake, aggr);
          } else if (inSide !== 0 && !iAmInside && dM > -3 + 4.5 * firm) follow = Math.min(follow, o.speed - 2); // 바깥 차 양보 (firm이면 사람이 확실히 앞일 때만)
          else if (inSide === 0 && dM > 0.5) follow = Math.min(follow, o.speed - 2);
        }
      } else if (dM >= 6 && dM < range && Math.abs(dLat) < 2.7) {
        if (dM < 35 && Math.abs(dLat) < 2.2 && !attack) attack = { dM, o };
        // 추월 줄로 빠지는 건 가까워졌을 때만 (그 전에는 바로 뒤에서 슬립스트림을 탐)
        // 슬립스트림을 타고 있고 앞이 직선이면: 성격만큼 일찍 옆으로 빠져 나란히 (빨아들인 속도로 옆에 붙음)
        const draftPull = (st.realDraft ?? car.draft ?? 0) > 0.25 && !brakeSoon && closing > -0.5 && dM < 16 + aggr * 12;
        if (((closing > 0.3 && dM < 14 + closing * 3) || dM < gapM + 5 || draftPull) && !narrowSoon) {
          // 추월할 줄: 앞차 왼쪽/오른쪽 3.2 m (그 차가 있는 지점의 라인 한계 lo~hi 안)
          //   지금 나랑 가까운 쪽 + 다음 코너 안쪽이면 가산점 (과감한 봇일수록 안쪽을 고름)
          const io = W(i0 + Math.round(dM / ds));
          const cand = [o.lat - 3.2, o.lat + 3.2]
            .filter((lat) => lat > L.lo[io] + 0.2 && lat < L.hi[io] - 0.2 && !crosses(lat))
            .map((lat) => ({
              lat, lane: lat - L.offset[io],
              cost: Math.abs(lat - myLat) - (inSide && (lat - o.lat) * inSide > 0 ? 2.5 * aggr : 0)
                + (st.passSide && st.laneHold > 0 && Math.sign(lat - o.lat) !== st.passSide ? 4 : 0), // 한번 고른 쪽을 바꾸지 않음 (예전엔 좌우로 왔다 갔다 하다 못 빠짐)
            }));
          if (cand.length) {
            cand.sort((a, b) => a.cost - b.cost);
            st.passSide = Math.sign(cand[0].lat - o.lat);
            st.laneTarget = clamp(cand[0].lane, -9, 9);
            st.laneHold = 1.6;
            busy = true;
            // 확실히 빠르게 다가가는 중(2 m/s 넘게)이면 다음 코너에서 브레이크를 조금 늦게
            if (closing > 2 || pushing) lateBrake = Math.max(lateBrake, aggr * 0.6);
          }
          // 아직 겹쳐 있으면: 앞차가 브레이크를 밟아도 그 뒤 (7 m + 0.25초 × 속도)에서 멈출 수 있는 속도까지만 (자리가 생기면 풀림)
          if (Math.abs(dLat) < 2.2) follow = Math.min(follow, Math.sqrt(o.speed * o.speed * 0.8 + 2 * 7 * gHere * Math.max(0, dM - gapM)));
        }
      } else if (dM >= 6 && dM < 40 && Math.abs(dLat) < 4.6 && (closing > 0 || pushing) && !narrowSoon && st.laneHold > 0) {
        // 이미 추월 줄로 빠져 있음(옆 2.7~4.6 m): 나란히 될 때까지 그 줄을 지킴 (예전엔 1.6초 뒤 라인으로 돌아가 다시 앞차 뒤에 붙었음)
        st.laneHold = Math.max(st.laneHold, 0.4);
        busy = true;
      }
    }
    if (sideTL !== null) st.laneTarget = sideTL; // 바로 옆 차와 벌리는 게 먼저
    st.laneHold -= dt;
    // 좁아지는 곳(점프대 앞) 전에는 라인 가운데로 돌아와 곧게 들어감 (비스듬히 뛰면 착지 뒤 미끄러져 코스 밖으로)
    if (narrowSoon) {
      st.laneTarget = 0;
      st.laneHold = 0;
      busy = false;
    }
    if (!busy && st.laneHold <= 0) st.laneTarget += (0 - st.laneTarget) * Math.min(1, dt * 0.8); // 천천히 라인으로 돌아감
    const laneRate = side ? 8 : 5.5;
    st.lane += clamp(st.laneTarget - st.lane, -laneRate * dt, laneRate * dt);
    let lane = st.lane;
    // 실수: 넓게 나감 (코너 바깥쪽 = 곡률 반대쪽)
    if (st.mistake === 'wide') lane += -Math.sign(L.curvature[W(i0 + Math.round(30 / ds))] || 1) * 2.4;

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
      const latVel = st.prevLat != null ? clamp((myLat - st.prevLat) / Math.max(1e-3, dt), -8, 8) : 0;
      const yawDes = -L.curvature[kf] * v + 3 * hd - 0.15 * (1 + 3 * hold) * latErr - 0.3 * hold * latVel;
      const dfz = cfg.aero.downforce * Math.min(1.6, (v / cfg.maxSpeed) ** 2);
      const latCap = Math.max(0.5 * cfg.steerLat, cfg.steerLat * (1 + (cfg.steerLatDownforce || 0) * dfz) * (1 - (cfg.steerLatLoad || 0) * (car.load || 0)));
      const perSteer = cfg.steerRate * Math.min(1, v / 8) * Math.min(1, latCap / (cfg.steerRate * v)); // 핸들 1일 때 회전 속도 (car.js와 같은 식)
      steerCmd = yawDes / Math.max(0.05, perSteer);
      // 핸들을 끝까지 꺾어도 모자란 정도 (마스터 봇이 속도를 줄이는 데 씀). 라인에서 도는 쪽 반대로 1 m 넘게 밀려나 있을 때만 (달처럼 잠깐 꽉 꺾는 곳은 그냥 둠)
      st.satur = Math.sign(steerCmd) * -latErr > 1 ? Math.abs(steerCmd) - 1 : 0;
    } else {
      // 공중·비행·배: 예전 방식 (앞 점 향하기 + 곡률)
      const look = Math.round((6 + v * 0.35) / ds);
      const [tx, tz] = target(W(i0 + look), lane);
      const jf = W(i0 + Math.round((v * 0.18) / ds));
      steerCmd = (-L.curvature[jf] * v * v) / 24 + 2 * angTo(tx - car.pos.x, tz - car.pos.z);
    }
    c.steer = clamp(steerCmd + noise + clamp(shove, -0.35, 0.35), -1, 1);
    st.prevLat = myLat;
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
    const openK = ctx.since < OP.sec && packAhead && level.pace > 0.95 ? OP.k : 1;
    const eqK = st.calm ? Math.min(eq.kMul, eq.kCalm) : eq.kMul;
    const k = pace * eqK * pm * openK * (ctx.finished ? 0.72 : 1) * (Math.abs(lane) > 1.5 && st.laneHold <= 0 ? 0.985 : 1);
    // 목표 속도: 앞쪽 지점들의 계획 속도 × 실력에서, 거기까지 브레이크로 줄일 수 있는 속도 (계획보다 빠를 때도 제때 제동)
    //   부스터 중에는 직선(계획이 최고 속도) 지점은 제한 없음 → 직선에서 부스터를 브레이크로 끄지 않음
    const boosting = car.form === 'spike';
    // 브레이크를 얼마나 늦게(세게) 밟는지 (어려움일수록 1에 가까움). 추월 중 확실히 빠를 때만 최대 +5% (성격 비례)
    const kB = Math.min(1.03, (level.brakeK ?? 0.95) * Math.min(1, k) * (1 + 0.05 * lateBrake));
    const reach = Math.round(Math.min(500, (speed * speed) / (2 * kB * gHere * cm.aBrake(30)) + 10) / ds);
    let tgt = Infinity;
    // 슬립스트림(기차)·견인·슬링샷·DRS로 차 최고 속도가 올라가면 목표 속도도 같이 (사람과 똑같이 효과를 받게, 2026-11-12 drs)
    //   직선(계획 속도가 최고 속도의 75~95%)일수록 다 받고 코너는 그대로. 예전엔 계획 속도 × k가 직선 상한이라 봇은 슬립스트림을 받아도 직선에서 더 빨라지지 않았음
    const aeroTop = BOT_AERO && car.aeroTopMul ? car.aeroTopMul(true) : 1;
    for (let q = 0; q <= reach; q += q < 8 ? 1 : 3) {
      const iq = W(lead + q);
      const free = boosting && prof.speed[iq] >= vTop * 0.97 && !prof.brake[iq];
      if (free) continue;
      let vq = prof.speed[iq] * k;
      if (aeroTop > 1.001 && !prof.brake[iq]) vq *= 1 + (aeroTop - 1) * clamp((prof.speed[iq] / vTop - 0.75) / 0.2, 0, 1);
      if (jumpCap.size && jumpCap.has(iq)) vq = Math.min(vq, jumpCap.get(iq) * (jumpTraffic ? 1 : jumpK));
      const allow = Math.sqrt(vq * vq + 2 * kB * gHere * cm.aBrake(vq) * q * ds);
      if (allow < tgt) tgt = allow;
    }
    // 마스터(level.master.saturBrake): 도움으로 빨라진 만큼 핸들이 모자라면(끝까지 꺾어도 원하는 만큼 못 돎) 바로 액셀을 떼고 줄임
    //   (화산 T7 출구·H1 출구에서 핸들 끝까지 꺾은 채 바깥 벽에 박혔음. 어려움은 이 규칙 없음 = 예전 그대로)
    //   접전(CLOSE)으로 빨라진 봇(eq.keep > 1)도 같은 규칙 (화산에서 사람보다 뒤인 봇이 계속 빨라져 낭떠러지로 떨어졌음)
    const sBrake = (level.master && level.master.saturBrake) || (st.closeOn && eq.keep > 1.001 ? 8 : 0);
    if (sBrake && car.grounded && speed > 12 && st.satur > 0.05) tgt = Math.min(tgt, speed - 1 - sBrake * st.satur);
    st.satur = 0;
    // 실력별 최고 속도 (직선이 긴 맵에서도 실력 차이가 나게). 부스터 중에는 제한 없음
    //   (aeroTop: 위 슬립스트림·견인·DRS 몫, 상한에도 같이)
    if (level.topK && !boosting) tgt = Math.min(tgt, vTop * level.topK * pm * (st.calm ? Math.min(eq.topMul, eq.topCalm) : eq.topMul) * aeroTop);
    // 따라잡기 효과로 늦추는 중(paceMul < 1)이면 직선 최고 속도도 같이 낮춤 (코너만 늦추면 효과가 거의 없음)
    else if ((st.paceMul < 0.999 || eq.topMul < 0.999) && !boosting) tgt = Math.min(tgt, vTop * st.paceMul * eq.topMul * aeroTop);
    // 앞이 막혀 2초 넘게 거의 멈춰 있으면: 1.5초 동안은 앞차를 신경 쓰지 않고 밀고 나감 (영원히 기다리지 않게)
    if (follow < 3 && Math.abs(speed) < 3 && ctx.since > 1) st.blockedT += dt;
    else st.blockedT = Math.max(0, st.blockedT - dt);
    if (st.blockedT > 2) {
      st.pushT = 1.5;
      st.blockedT = 0;
    }
    // 자석 도로(루프·벽): 위로 올라가는 동안 진행 거리가 짧게 계산되어 앞차가 아주 가까워 보임 → 앞차 때문에 줄이지 않음 (멈추면 떨어짐)
    const onMagnet = car.surface === 'magnet' || (ti.sample && ti.sample.roll) || car.up.y < 0.8;
    if (st.pushT > 0) st.pushT -= dt;
    else if (!onMagnet) {
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
    if (st.mistake === 'lift') c.throttle = Math.min(c.throttle, 0.35);
    // 실력별 액셀 (쉬움일수록 덜 밟음: 직선·비행 구간에서도 차이). 추월 시도 중에는 성격만큼 더 밟음
    const thrNow = pushing ? Math.min(1, thrK + 0.05 + 0.1 * aggr) : thrK;
    if (thrNow < 1 && !boosting) c.throttle = Math.min(c.throttle, thrNow);
    st.dbg = { follow, tgt, lane: st.lane, laneT: st.laneTarget, lateBrake, inSide, shove, hold, pass: +st.passT.toFixed(1) };

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
    return c;
  }

  return {
    controls,
    state: st,
    pace,
    /** 복귀(리스폰) 뒤: 줄·실수 초기화 */
    reset(grid = false) {
      st.lane = st.laneTarget = 0;
      st.fly = null;
      st.flyI = 0;
      st.mistake = null;
      st.prevLat = null;
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
  // 같은 단계 봇끼리 비슷하게 (PACK): 이 맵에서 등급 가운데보다 pickMax 넘게 느린 차는 빼고 (남는 차가 봇 수만큼 또는 4대 이상일 때)
  if (PACK.on) {
    const e = CAR_REL[mapParam()];
    if (e) {
      const ok = pool.filter((c) => !(e.rel[c.id] > PACK.pickMax));
      if (ok.length >= Math.min(count, 4) && ok.length >= 2) pool = ok;
    }
  }
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
