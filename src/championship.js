// 챔피언십 (시즌): 같은 봇들과 5경기(맵 순서는 고를 수 있음)를 달려 F1식 점수로 우승자를 정함
//
//   홈 화면(ui)이 부르는 것
//     getChamp()        진행 중인 시즌 상태 (없거나 끝났으면 null)
//     startChamp({ classId, carId, level, maps, bots })  새 시즌 시작 → 첫 경기 주소
//     champUrl()        다음 경기 주소 (시즌이 끝났으면 null)
//     abandonChamp()    시즌 그만두기 (기록 지움)
//   게임(main.js)이 부르는 것
//     champRace(mapName)  지금 경기가 챔피언십 경기인지 → { state, index, total } 또는 null
//     recordRace(mapName, rows)  경기 결과 저장 (rows = raceSystem.results) → { state, gained, final }
//     champStandings(state)      시즌 순위 (점수 → 우승 수 → 가장 좋은 순위)
//   경기 주소: ?map=..&car=..&mode=race&champ=1
//   저장: localStorage 'gimmick.champ'
import { raceUrl } from './gameData.js';

const KEY = 'gimmick.champ';
/** F1 점수: 1위 25, 2위 18, ... 8위 4 */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4];
/** 기본 시즌 맵 순서 */
export const CHAMP_MAPS = ['gp', 'sea', 'neon', 'moon', 'jungle', 'volcano'];
/** 등급마다 기본 차 (carId를 안 주면) */
const CLASS_CAR = { A: 'f1', B: 'gt', C: 'hatch' };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && s.v === 1 && Array.isArray(s.maps) ? s : null;
  } catch {
    return null;
  }
}
function save(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}
function readSettings() {
  try {
    return JSON.parse(localStorage.getItem('gimmick.settings') || '{}') || {};
  } catch {
    return {};
  }
}

/** 진행 중인 시즌 (끝났거나 없으면 null) */
export function getChamp() {
  const s = load();
  return s && !s.finished ? s : null;
}
/** 마지막 시즌 (끝난 것도) */
export function lastChamp() {
  return load();
}

/**
 * 새 시즌 시작 → 첫 경기 주소
 * @param o { classId, carId, level: 'easy'|'normal'|'hard'|'master', maps: ['gp',...], bots: 1~7 }
 */
export function startChamp(o = {}) {
  const set = readSettings();
  const maps = (Array.isArray(o.maps) && o.maps.length ? o.maps : CHAMP_MAPS).slice(0, 8);
  const carId = o.carId || CLASS_CAR[o.classId] || 'f1';
  const bots = Math.max(1, Math.min(7, (o.bots ?? set.bots ?? 5) | 0 || 5));
  const s = {
    v: 1,
    id: Date.now().toString(36),
    seed: (Math.random() * 1e9) | 0, // 모든 경기에 같은 봇 (이름·차·성격)
    classId: o.classId || null,
    carId,
    level: ['easy', 'normal', 'hard', 'master'].includes(o.level) ? o.level : set.botLevel || 'normal', // master = 마스터 (어려움보다 빠름)
    bots,
    maps,
    results: [], // 경기마다 { map, rows: [{ id, name, color, carName, pos, points, total, isPlayer }] }
    drivers: {}, // id → { id, name, color, carName, isPlayer, points, wins, podiums, bestPos }
    startedAt: Date.now(),
    finished: false,
  };
  save(s);
  return raceUrl(maps[0], carId, { mode: 'race', champ: 1 });
}

/** 다음 경기 주소 (끝났으면 null) */
export function champUrl() {
  const s = getChamp();
  if (!s) return null;
  const i = s.results.length;
  if (i >= s.maps.length) return null;
  return raceUrl(s.maps[i], s.carId, { mode: 'race', champ: 1 });
}

/** 시즌 그만두기 */
export function abandonChamp() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/** 지금 주소의 경기가 챔피언십 다음 경기인지 */
export function champRace(mapName) {
  const s = getChamp();
  if (!s) return null;
  const index = s.results.length;
  if (s.maps[index] !== mapName) return null;
  return { state: s, index, total: s.maps.length };
}

/** 시즌 순위 */
export function champStandings(s) {
  return Object.values((s && s.drivers) || {}).sort(
    (a, b) => b.points - a.points || b.wins - a.wins || (a.bestPos ?? 99) - (b.bestPos ?? 99) || (a.isPlayer ? -1 : b.isPlayer ? 1 : 0),
  );
}

/**
 * 경기 결과 저장 (한 경기에 한 번만: 이미 저장했으면 그대로 돌려줌)
 * rows = raceSystem.results(time): [{ pos, id, name, color, carName, isPlayer, total, ... }]
 */
export function recordRace(mapName, rows) {
  const s = getChamp();
  if (!s || !rows || !rows.length) return null;
  const index = s.results.length;
  if (s.maps[index] !== mapName) return null;
  const gained = {};
  const res = rows.map((r, i) => {
    const pos = i + 1;
    const points = POINTS[i] || 0;
    const id = r.isPlayer ? 'me' : r.id;
    gained[id] = points;
    const d = (s.drivers[id] = s.drivers[id] || { id, name: r.name, color: r.color, carName: r.carName, isPlayer: !!r.isPlayer, points: 0, wins: 0, podiums: 0, bestPos: null });
    d.name = r.name;
    d.color = r.color;
    d.carName = r.carName || d.carName;
    d.points += points;
    if (pos === 1) d.wins++;
    if (pos <= 3) d.podiums++;
    if (d.bestPos == null || pos < d.bestPos) d.bestPos = pos;
    return { id, name: r.name, color: r.color, carName: r.carName, pos, points, total: r.total, projected: !!r.projected, isPlayer: !!r.isPlayer };
  });
  s.results.push({ map: mapName, rows: res });
  if (s.results.length >= s.maps.length) {
    s.finished = true;
    s.finishedAt = Date.now();
  }
  save(s);
  return { state: s, index, gained, final: s.finished };
}
