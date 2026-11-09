// 내 기록 (브라우저에 저장): 맵 + 차마다 최고 랩, 최고 완주 기록
//   localStorage 'gimmick.records' = { 맵id: { 차id: { lap, race, laps, date } } }
const KEY = 'gimmick.records';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

export const records = {
  all: readAll,
  /** 이 맵 + 이 차의 기록 (없으면 null) */
  get(map, car) {
    const r = readAll()[map];
    return (r && r[car]) || null;
  },
  /** 이 맵에서 가장 빠른 랩 (어느 차든) → { lap, car } */
  bestOfMap(map) {
    const r = readAll()[map] || {};
    let best = null;
    for (const [car, v] of Object.entries(r)) if (v.lap && (!best || v.lap < best.lap)) best = { lap: v.lap, car };
    return best;
  },
  /** 한 바퀴 기록 저장. 새 최고 기록이면 true */
  saveLap(map, car, lap, assist = false) {
    const all = readAll();
    const m = (all[map] = all[map] || {});
    const v = (m[car] = m[car] || {});
    if (v.lap && v.lap <= lap) return false;
    v.lap = +lap.toFixed(3);
    v.lapAssist = !!assist; // 운전 도움을 켜고 낸 기록이면 true ('도움 켬' 표시용)
    v.date = Date.now();
    writeAll(all);
    return true;
  },
  /** 완주 기록 저장. 새 최고 기록이면 true */
  saveRace(map, car, total, laps, assist = false) {
    const all = readAll();
    const m = (all[map] = all[map] || {});
    const v = (m[car] = m[car] || {});
    if (v.race && v.race <= total) return false;
    v.race = +total.toFixed(3);
    v.laps = laps;
    v.raceAssist = !!assist;
    v.date = Date.now();
    writeAll(all);
    return true;
  },
  clear() {
    writeAll({});
  },
};

export function fmtTime(sec) {
  if (!isFinite(sec) || sec == null) return '--:--.---';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
