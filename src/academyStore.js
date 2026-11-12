// 드라이빙 아카데미: 레슨·라이선스 목록(글자만) + 내 메달·라이선스 저장 (2026-11-12)
//   홈 화면(home.js), 게임 속 아카데미(academy.js), 결과 화면 배지 등 어디서나 가볍게 불러 씀 (Three.js 안 씀)
//   저장: localStorage 'gimmick.academy' = { v: 1, lessons: { 레슨 id: { medal 0~3, pts 0~1, tries, at } }, licenses: { C: { at, car }, ... }, paid: { 보상 키: true } }
//   메달: 1 = 동 🥉, 2 = 은 🥈, 3 = 금 🥇 (성적표 점수 pts: ✓ = 2점, △ = 1점, ✗ = 0점을 만점으로 나눔)
//   아무것도 잠그지 않음 (레이스·차·맵은 그대로). 라이선스 보상 = 배지·색·XP
//   TODO(나중): 여러 기기 합치기 (레벨 gr_xp처럼 서버에 올려 합치기)는 아직 없음 → 지금은 이 브라우저에만
import { licenseBadge } from './academyArt.js'; // 라이선스 방패 그림 (Codex 담당 파일, 가져다 쓰기만)
const KEY = 'gimmick.academy';

/** 레슨 묶음 (홈 화면 칸 제목) */
export const GROUPS = [
  { id: 'basic', name: '기초 · 브레이크와 페달', icon: '🦶' },
  { id: 'corner', name: '코너 실력', icon: '↪️' },
  { id: 'race', name: '레이스 기술', icon: '🏁' },
  { id: 'special', name: '변신 · 특별 기술', icon: '✨' },
];

/**
 * 레슨 (글자·맵만, 진행 코드는 academyLessons.js)
 *   map: 연습하는 맵, extra: 게임 주소에 더 붙일 것 (봇이 필요한 레슨 등), art: academyArt.js 그림 키
 */
export const LESSONS = [
  { id: 'brake', icon: '🛑', name: '브레이크 포인트', short: '직선 끝에서 언제, 얼마나 세게 밟을까', group: 'basic', map: 'gp', art: 'brakePoint', mins: 2 },
  { id: 'trail', icon: '🎚️', name: '트레일 브레이킹', short: '브레이크를 조금 남긴 채 꺾기 시작', group: 'basic', map: 'gp', art: 'trailBrake', mins: 2 },
  { id: 'lift', icon: '🦶', name: '리프트오프', short: 'W를 살짝 떼서 코너를 조이기', group: 'basic', map: 'gp', art: 'liftOff', mins: 2 },
  { id: 'late', icon: '↪️', name: '늦게 꺾고 빨리 가속', short: '긴 직선 앞 코너는 탈출이 전부', group: 'corner', map: 'gp', art: 'lateApex', mins: 2 },
  { id: 'chain', icon: '🔗', name: '연속 코너 잇기', short: '두 코너를 한 번에 생각하기', group: 'corner', map: 'gp', art: 'chicane', mins: 3 },
  { id: 'kerb', icon: '🟥', name: '연석 쓰기', short: '빨강·흰 연석까지 길을 넓게', group: 'corner', map: 'gp', art: 'kerbs', mins: 2 },
  { id: 'slip', icon: '💨', name: '슬립스트림', short: '앞차 뒤에 바짝 붙어 빨라진 뒤 추월', group: 'race', map: 'gp', art: 'slipstream', mins: 2, extra: { mode: 'race', bots: 1, botLevel: 'normal', intro: 0, tow: 0, drs: 0 } },
  { id: 'drs', icon: '🟩', name: 'DRS', short: '앞차와 1초 안이면 뒷날개가 열려요', group: 'race', map: 'gp', art: 'drs', mins: 2, extra: { mode: 'race', bots: 1, botLevel: 'normal', intro: 0, tow: 0 } },
  { id: 'drift', icon: '🌀', name: '드리프트', short: '헤어핀에서 꼬리를 미끄러뜨려 돌기', group: 'special', map: 'gp', art: 'drift', mins: 2 },
  { id: 'fly', icon: '✈️', name: '비행 루트', short: '활주로 → 고리 4개 → 착륙장', group: 'special', map: 'gp', art: 'fly', mins: 2 },
  { id: 'boat', icon: '🚤', name: '배 카빙', short: '물 위에서 드리프트 키로 날카롭게 돌기', group: 'special', map: 'sea', art: 'boat', mins: 2 },
];
/** 시험에만 나오는 과제 (레슨 카드는 없음) */
export const EXAM_TASKS = {
  lap: { id: 'lap', icon: '⏱️', name: '깔끔한 한 바퀴', short: '빙하 하이웨이 한 바퀴 · 복귀 없이 목표 시간 안', map: 'glacier', art: 'lateApex' },
};
export const lessonMeta = (id) => LESSONS.find((l) => l.id === id) || EXAM_TASKS[id] || null;

/**
 * 라이선스 시험: 과제 3개, 과제마다 기회 2번 (좋은 쪽), 모든 과제가 need 메달 이상이면 합격
 *   paint = unlocks.js PAINTS의 색 id (라이선스 색), xp = 처음 땄을 때 경험치
 */
export const LICENSES = [
  { id: 'C', name: 'C 라이선스', sub: '기초', color: '#e0a36b', tasks: ['brake', 'trail', 'lift'], need: 1, xp: 150, paint: 11, desc: '브레이크·페달을 쓸 줄 알아요' },
  { id: 'B', name: 'B 라이선스', sub: '코너', color: '#cfdbe8', tasks: ['late', 'chain', 'kerb'], need: 2, xp: 250, paint: 12, desc: '코너를 빠르게 이어 달려요' },
  { id: 'A', name: 'A 라이선스', sub: '레이스', color: '#f3c74e', tasks: ['drift', 'fly', 'slip'], need: 2, xp: 400, paint: 13, desc: '레이스 기술과 변신을 다뤄요' },
  { id: 'S', name: 'S 라이선스', sub: '마스터', color: '#d698ff', tasks: ['trail', 'chain', 'lap'], need: 3, xp: 700, paint: 14, desc: '어떤 코너든 금메달처럼' },
];
export const licenseMeta = (id) => LICENSES.find((l) => l.id === id) || null;
export const MEDALS = ['', '🥉', '🥈', '🥇'];
export const MEDAL_NAMES = ['메달 없음', '동메달', '은메달', '금메달'];
/** 메달마다 처음 받을 때 XP (올라간 만큼만 더 줌) */
const MEDAL_XP = [0, 40, 70, 120];

function load() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (j && typeof j === 'object') return { v: 1, lessons: j.lessons || {}, licenses: j.licenses || {}, paid: j.paid || {} };
  } catch {}
  return { v: 1, lessons: {}, licenses: {}, paid: {} };
}
function save(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('gimmick:academy'));
  } catch {}
}

/** 성적표 줄(✓ △ ✗) → 점수 0~1 */
export function scoreRows(rows, respawn = false) {
  if (!rows || !rows.length) return 0;
  const p = rows.reduce((a, r) => a + (r.ok === 'ok' ? 2 : r.ok === 'meh' ? 1 : 0), 0) / (rows.length * 2);
  return respawn ? Math.min(p, 0.49) : p; // 길을 벗어나면 메달 없음
}
/** 점수 → 메달 (금 = 모두 ✓, 은 = 75% 이상, 동 = 50% 이상) */
export const medalFor = (pts) => (pts >= 0.999 ? 3 : pts >= 0.75 ? 2 : pts >= 0.5 ? 1 : 0);

export const academy = {
  all: load,
  medalOf: (id) => (load().lessons[id] || {}).medal || 0,
  lessonInfo: (id) => load().lessons[id] || null,
  /** 레슨 결과 저장 → { medal, best, improved, xp } (xp = 새로 줄 경험치, 메달이 올랐을 때만) */
  saveLesson(id, pts) {
    const s = load();
    const cur = s.lessons[id] || { medal: 0, pts: 0, tries: 0 };
    const medal = medalFor(pts);
    const before = cur.medal || 0;
    cur.tries = (cur.tries || 0) + 1;
    cur.pts = Math.max(cur.pts || 0, pts);
    cur.medal = Math.max(before, medal);
    cur.at = Date.now();
    s.lessons[id] = cur;
    const xp = medal > before ? MEDAL_XP[medal] - MEDAL_XP[before] : 0;
    save(s);
    return { medal, best: cur.medal, improved: medal > before, xp };
  },
  hasLicense: (lv) => !!load().licenses[lv],
  licenses: () => LICENSES.filter((l) => load().licenses[l.id]).map((l) => l.id),
  /** 가장 높은 라이선스 ('S' | 'A' | 'B' | 'C' | null) */
  top() {
    const have = load().licenses;
    for (const l of [...LICENSES].reverse()) if (have[l.id]) return l.id;
    return null;
  },
  /** 이 시험을 볼 수 있나 (앞 라이선스가 있어야 함; C는 언제나) */
  canTake(lv) {
    const i = LICENSES.findIndex((l) => l.id === lv);
    return i <= 0 || !!load().licenses[LICENSES[i - 1].id];
  },
  /** 라이선스 주기 → 처음이면 { xp, paint } 아니면 null */
  grantLicense(lv, car) {
    const s = load();
    const meta = licenseMeta(lv);
    if (!meta || s.licenses[lv]) return null;
    s.licenses[lv] = { at: Date.now(), car: car || null };
    save(s);
    return { xp: meta.xp, paint: meta.paint };
  },
  /** 레슨 메달 개수 { gold, silver, bronze, done, total } */
  summary() {
    const s = load();
    const out = { gold: 0, silver: 0, bronze: 0, done: 0, total: LESSONS.length };
    for (const l of LESSONS) {
      const m = (s.lessons[l.id] || {}).medal || 0;
      if (m) out.done++;
      if (m === 3) out.gold++;
      else if (m === 2) out.silver++;
      else if (m === 1) out.bronze++;
    }
    return out;
  },
  reset() {
    save({ v: 1, lessons: {}, licenses: {}, paid: {} });
  },
};

/** 라이선스 배지 (방패 그림 = academyArt.js licenseBadge) */
export function licenseChip(lv, size = 22) {
  const m = licenseMeta(lv);
  if (!m) return '';
  return `<span class="ac-lic" title="${m.name} · 드라이빙 아카데미">${licenseBadge(lv, { size })}</span>`;
}

// 게임 화면에서 주소에 academy=…가 있으면 아카데미를 켬 (main.js 연결 전에도 되게; main.js가 먼저 켜면 startAcademy가 두 번 안 켬)
//   이 파일은 unlocks.js → carRoster.js를 거쳐 게임 페이지에서 늘 불려 옴
if (typeof window !== 'undefined' && typeof location !== 'undefined') {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('academy') && q.get('map') && !window.__academyBoot) {
      window.__academyBoot = true;
      let n = 0;
      const wait = () => {
        const g = window.game;
        if (g && g.car && g.track && g.race) {
          if (!g.tutorial) import('./academy.js').then((m) => m.startAcademy(g)).catch((e) => console.warn('아카데미 불러오기 실패', e));
          return;
        }
        if (++n < 600) setTimeout(wait, 100);
      };
      setTimeout(wait, 100);
    }
  } catch {}
}
