// 레벨별 기능 해금 (작업 C, 2026-11-15, 설계 .debug/design/upgrade-design.md 8장)
//   처음 온 사람이 모든 기능을 한꺼번에 보고 헷갈리지 않게, 홈 화면의 기능을 레벨마다 하나씩 열어 줌.
//   - 해금은 홈 화면에서만 (게임 주소 ?map=&mode=item&car= · 초대 링크 ?join= 은 레벨과 상관없이 됨)
//   - 이미 레벨이 높은 사람은 다 열림 (지금과 똑같이 씀)
//   - Three.js 없음. 무거운 모듈(rewardPath·parts…)은 안 불러옴 → settings.js가 게임 안에서도 가볍게 씀
// 쓰는 법:
//   isOpen(id) · levelOf(id) · racesTo(id) → { level, races, xp } · lockText(id) → '🔒 Lv.3 · 약 1판 뒤'
//   newlyOpened() → 지난번 본 뒤 새로 열린 기능 목록 · markSeen(ids) · pendingCoaches() · setCoach(id, 'done'|'skipped')
//   이벤트 'gimmick:gate' (detail { reason })
// 시험 주소: ?gate=0 (모두 열림) · ?gate=1 (켬) · ?gatelv=3 (레벨 3인 척, 켬) · ?coach=reset (안내 기록 지움) · ?coach=0 (안내 안 뜸) · ?coach=<id> (그 안내 바로)
//   자동화 브라우저(navigator.webdriver)·intro=0·guide=0 주소는 해금·안내를 끔 (예전 game.tick·화면 검사가 안 막히게).
//   localStorage 'gimmick.gateTest' = 'lock' → 자동화 브라우저에서도 잠금만 켬 (안내 창은 안 뜸, overlap_scan --gate=1)
import { profile, levelStartXp } from './profile.js';
import { ownedParts } from './parts.js'; // 강화 안내는 부품을 하나라도 가진 뒤에 (관제탑 2026-11-15)

const KEY = 'gimmick.gate';
const DEFAULT_RACE_XP = 130; // rewardPath.DEFAULT_RACE_XP와 같은 값 (그 모듈은 무거워서 안 불러옴)

/** 해금표 (설계 8.1). coach = 열릴 때 보여 줄 안내 id (coachMarks.js SCRIPTS) */
export const FEATURES = [
  { id: 'play', level: 1, name: '플레이', icon: '🏁', desc: '봇들과 레이스해요' },
  { id: 'academy', level: 1, name: '아카데미', icon: '🎓', desc: '튜토리얼 · 코너 연습 · 라이선스' },
  { id: 'garage', level: 2, name: '차고', icon: '🚗', desc: '차를 구경하고 골라 타요 · 색도 바꿔요', coach: 'garage' },
  { id: 'time', level: 2, name: '타임 어택', icon: '⏱️', desc: '내 최고 기록 고스트와 달려요 · 자유 연습도 같이 열려요', coach: 'time' },
  { id: 'records', level: 2, name: '내 기록', icon: '🏆', desc: '맵마다 내 최고 기록과 구간 기록을 봐요', coach: 'records' },
  { id: 'parts', level: 3, name: '부품 조립', icon: '🔧', desc: '부품을 바꿔 차를 내 마음대로 조립해요', coach: 'parts' },
  { id: 'shop', level: 3, name: '상점', icon: '⬡', desc: '차 · 부품 · 색을 사요', coach: 'shop' },
  { id: 'goals', level: 3, name: '업적과 목표', icon: '✦', desc: '업적 · 일일·주간 목표 · 보상 길 (진행은 지금도 쌓여요)', coach: 'goals' },
  { id: 'custom', level: 4, name: '코스튬', icon: '🎨', desc: '코스튬과 세리머니로 차를 꾸며요', coach: 'custom' },
  { id: 'item', level: 4, name: '파워업 레이스', icon: '🎁', desc: '아이템 상자를 먹고 싸우는 레이스', coach: 'item' },
  { id: 'botHard', level: 4, name: "봇 '어려움'", icon: '💪', desc: '잘하는 사람만큼 빠른 봇' },
  { id: 'upgrade', level: 5, name: '부품 강화', icon: '★', desc: '부품을 강화해 장점은 키우고 약점은 줄여요', coach: 'upgrade' },
  { id: 'title', level: 5, name: '칭호 고르기', icon: '🏷️', desc: '업적으로 얻은 칭호를 이름 옆에 달아요' },
  { id: 'compare', level: 5, name: '차 비교', icon: '⚖', desc: '차 3대까지 성능을 나란히 비교해요 · 정렬도 열려요', coach: 'compare' },
  { id: 'presets', level: 5, name: '조립 프리셋', icon: '💾', desc: '조립을 저장해 두고 한 번에 바꿔 끼워요' },
  { id: 'champ', level: 6, name: '시즌', icon: '🏆', desc: '여러 맵을 이어 달리는 챔피언십', coach: 'champ' },
  { id: 'ranking', level: 6, name: '온라인 순위표', icon: '🌐', desc: '세계 순위표와 친구 고스트(👻 같이 달리기)', coach: 'ranking' },
  { id: 'botMaster', level: 6, name: "봇 '마스터'", icon: '👑', desc: '어려움보다 훨씬 빠른 봇' },
  { id: 'online', level: 7, name: '온라인 방', icon: '🌐', desc: '방을 만들어 친구와 같이 달려요', coach: 'online' },
];
const BY_ID = Object.fromEntries(FEATURES.map((f) => [f.id, f]));
/** 레이스 방식 id → 기능 id */
export const MODE_FEATURE = { race: 'play', time: 'time', free: 'time', item: 'item', champ: 'champ', net: 'online' };
/** 봇 실력 값 → 기능 id */
export const BOT_LEVEL_FEATURE = { hard: 'botHard', master: 'botMaster' };

/** 안내 목록 (설정 '안내 다시 보기'에 보이는 순서). 단계는 coachMarks.js SCRIPTS */
export const COACHES = [
  { id: 'garage', feature: 'garage', name: '차고' },
  { id: 'time', feature: 'time', name: '타임 어택' },
  { id: 'records', feature: 'records', name: '내 기록' },
  { id: 'parts', feature: 'parts', name: '부품 조립' },
  { id: 'shop', feature: 'shop', name: '상점' },
  { id: 'goals', feature: 'goals', name: '업적과 목표' },
  { id: 'custom', feature: 'custom', name: '커스텀' },
  { id: 'item', feature: 'item', name: '파워업 레이스' },
  { id: 'upgrade', feature: 'upgrade', name: '부품 강화' },
  { id: 'compare', feature: 'compare', name: '차 비교' },
  { id: 'champ', feature: 'champ', name: '시즌' },
  { id: 'ranking', feature: 'ranking', name: '온라인 순위표' },
  { id: 'online', feature: 'online', name: '온라인 방' },
].map((c) => ({ ...c, level: BY_ID[c.feature].level, icon: BY_ID[c.feature].icon }));
/** 아직 화면(대상 버튼)이 없어 기다리는 안내 — 작업 D가 data-coach 이름표를 붙이면 여기서 지움 */
export const WAITING_COACHES = new Set([]); // 강화 안내 이름표를 D1이 붙여서 켬 (관제탑 2026-11-15)

const qs = (() => {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams('');
  }
})();
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const robot = (() => {
  try {
    return !!navigator.webdriver;
  } catch {
    return false;
  }
})();

/** 해금이 켜져 있나 (꺼져 있으면 모두 열림) */
export function gateActive() {
  const g = qs.get('gate');
  if (g === '0') return false;
  if (g === '1' || qs.has('gatelv')) return true;
  if (lsGet('gimmick.gateTest')) return true;
  if (robot) return false;
  if (qs.get('intro') === '0' || qs.get('guide') === '0') return false; // 게임 시험 주소
  return true;
}
/** 안내(코치 마크)가 뜰 수 있나 (해금이 켜져 있고, 끄지 않았고, 시험 주소가 아님) */
export function coachActive() {
  if (!gateActive()) return false;
  const c = qs.get('coach');
  if (c === '0') return false;
  if (lsGet('gimmick.gateTest') === 'lock' && !qs.has('gatelv') && c !== '1') return false;
  if (robot && !qs.has('gatelv') && c !== '1' && qs.get('gate') !== '1') return false;
  return !load().off;
}

/** 지금 레벨 (?gatelv=n이면 그 값) */
export function gateLevel() {
  const t = Number(qs.get('gatelv'));
  if (Number.isFinite(t) && t >= 1) return Math.floor(t);
  try {
    return profile.get().level || 1;
  } catch {
    return 1;
  }
}
export const levelOf = (id) => (BY_ID[id] ? BY_ID[id].level : 1);
export const featureOf = (id) => BY_ID[id] || null;
export function isOpen(id) {
  if (!BY_ID[id] || !gateActive()) return true;
  return gateLevel() >= BY_ID[id].level;
}

/** 그 기능까지 약 몇 판 (rewardPath.racesToLevel과 같은 계산: 남은 XP ÷ 최근 5판 평균 XP, 기록이 없으면 130) */
export function racesTo(id) {
  const level = levelOf(id);
  let xp = 0;
  try {
    xp = profile.get().xp || 0;
  } catch {}
  const fake = Number(qs.get('gatelv'));
  if (Number.isFinite(fake) && fake >= 1) xp = levelStartXp(Math.floor(fake)); // 레벨인 척: 그 레벨 시작 XP
  let avg = DEFAULT_RACE_XP;
  try {
    const r = (JSON.parse(lsGet('gimmick.meta') || '{}') || {}).recentXp;
    const v = Array.isArray(r) ? r.map(Number).filter((x) => x > 0) : [];
    if (v.length) avg = v.reduce((a, b) => a + b, 0) / v.length;
  } catch {}
  avg = Math.max(20, avg);
  const left = Math.max(0, levelStartXp(level) - xp);
  return { level, xp: left, races: left > 0 ? Math.max(1, Math.ceil(left / avg)) : 0 };
}
/** '🔒 Lv.3 · 약 1판 뒤' (short = '🔒 Lv.3') */
export function lockText(id, short = false) {
  const r = racesTo(id);
  if (short) return `🔒 Lv.${r.level}`;
  return `🔒 Lv.${r.level}${r.races ? ` · 약 ${r.races}판 뒤` : ''}`;
}

// ------------------------------------------------------------------ 저장 { v:1, seen:{기능: at}, coach:{안내: 'done'|'skipped'}, off, seenAll, born, replay, missed:{} }
function load() {
  try {
    const s = JSON.parse(lsGet(KEY) || 'null');
    if (s && typeof s === 'object') return { v: 1, seen: {}, coach: {}, missed: {}, ...s };
  } catch {}
  return { v: 1, seen: {}, coach: {}, missed: {}, off: false };
}
function save(s, reason = 'save') {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('gimmick:gate', { detail: { reason } }));
  } catch {}
}
export const gateState = () => load();

/** 홈을 열 때 한 번: 저장이 없으면 만듦. 돌려주는 값 { legacy: 처음 본 사람이 이미 Lv3 이상인가 } */
export function initGate() {
  if (qs.get('coach') === 'reset') {
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }
  const raw = lsGet(KEY);
  const lv = gateLevel();
  if (raw) {
    const s = load();
    return { legacy: !s.seenAll && (s.born || 1) >= 3, born: s.born || 1 };
  }
  const s = load();
  s.born = lv;
  s.at = Date.now();
  // Lv1 기능은 처음부터 본 것으로 (안내할 것 없음)
  for (const f of FEATURES) if (f.level <= 1) s.seen[f.id] = Date.now();
  if (lv < 3) s.seenAll = Date.now(); // 새로 온 사람 (Lv2 = 첫 레이스만 하고 온 사람도 보통 흐름으로)
  save(s, 'init');
  return { legacy: lv >= 3, born: lv };
}
/** 지난번 본 뒤 새로 열린 기능 (Lv2 이상, 열렸고, 아직 안 본 것) */
export function newlyOpened() {
  if (!gateActive()) return [];
  const s = load();
  const lv = gateLevel();
  return FEATURES.filter((f) => f.level > 1 && f.level <= lv && !s.seen[f.id]);
}
export function markSeen(ids = null) {
  const s = load();
  const list = ids || FEATURES.filter((f) => isOpen(f.id)).map((f) => f.id);
  for (const id of list) s.seen[id] ||= Date.now();
  save(s, 'seen');
}
/** 기존 사용자 한 번 카드를 닫음 (보기·모두 건너뛰기 둘 다) */
export function markSeenAll(skipCoaches = false) {
  const s = load();
  s.seenAll = Date.now();
  for (const f of FEATURES) if (isOpen(f.id)) s.seen[f.id] ||= Date.now();
  if (skipCoaches) for (const c of COACHES) if (isOpen(c.feature) && !s.coach[c.id]) s.coach[c.id] = 'skipped';
  save(s, 'seenAll');
}
export const coachStatus = (id) => load().coach[id] || null;
export function setCoach(id, status) {
  const s = load();
  if (status) s.coach[id] = status;
  else delete s.coach[id];
  if (s.replay === id) delete s.replay;
  save(s, 'coach');
}
/** 단계를 못 찾아 건너뛴 기록 (안내 id → [단계 번호…]) */
export function noteMissed(id, step) {
  const s = load();
  const a = (s.missed[id] ||= []);
  if (!a.includes(step)) a.push(step);
  save(s, 'missed');
}
function hasAnyPart() { try { return ownedParts().length > 0; } catch { return true; } }
/** 기능이 열렸고 아직 안 본(끝내지도 건너뛰지도 않은) 안내 (기다리는 안내는 뺌) */
export function pendingCoaches() {
  if (!gateActive()) return [];
  const s = load();
  return COACHES.filter((c) => isOpen(c.feature) && !s.coach[c.id] && !WAITING_COACHES.has(c.id) && levelOf(c.feature) > 1 && (c.id !== 'upgrade' || hasAnyPart()));
}
/** '안내 모두 끄기' */
export function setCoachOff(off) {
  const s = load();
  s.off = !!off;
  save(s, 'off');
}
export const coachOff = () => !!load().off;
/** 다른 화면(게임 중 Esc 메뉴의 설정)에서 '다시 보기'를 누르면 홈에 돌아왔을 때 보여 줌 */
export function requestReplay(id) {
  const s = load();
  s.replay = id;
  delete s.coach[id];
  s.off = false;
  save(s, 'replay');
}
export function takeReplay() {
  const s = load();
  const id = s.replay;
  if (!id) return null;
  delete s.replay;
  save(s, 'replay');
  return id;
}
/** 시험 주소 ?coach=<안내 id> */
export function urlCoach() {
  const c = qs.get('coach');
  return COACHES.some((x) => x.id === c) ? c : null;
}

export const gate = { FEATURES, COACHES, MODE_FEATURE, BOT_LEVEL_FEATURE, WAITING_COACHES, gateActive, coachActive, gateLevel, levelOf, featureOf, isOpen, racesTo, lockText, initGate, newlyOpened, markSeen, markSeenAll, coachStatus, setCoach, noteMissed, pendingCoaches, setCoachOff, coachOff, requestReplay, takeReplay, urlCoach, gateState };
