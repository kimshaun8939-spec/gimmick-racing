// 내 기록 (브라우저에 저장): 맵 + 차마다 최고 랩, 최고 완주 기록
//   localStorage 'gimmick.records' = { 맵id: { 차id: { lap, race, laps, date } } }
import { gridStart } from './ghostStart.js';
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

// 제외된 옛 값은 원본에 남겨 두고, 비교·화면에는 유효한 기록만 전달.
function comparable(v) {
  if (!v) return null;
  const result = { ...v };
  if (v.raceRivals) delete result.race;
  if (v.lapRivals) delete result.lap;
  return result;
}
export const records = {
  all() {
    return Object.fromEntries(Object.entries(readAll()).map(([map, cars]) => [map,
      Object.fromEntries(Object.entries(cars).map(([car, v]) => [car, comparable(v)]))]));
  },
  /** 옛 기록과 같은 완주 고스트가 그리드에서 출발한 경우만 표시. 지우거나 추측하지 않음. */
  classifyLegacy(map, track, laps) {
    const all = readAll();
    let changed = false;
    for (const [car, v] of Object.entries(all[map] || {})) {
      if (v.raceMode || v.raceRivals || !v.race) continue;
      // v2 완주, 옛 첫 바퀴, 1바퀴 맵의 옛 랩 고스트 순서로 확인.
      for (const suffix of ['.run', '.start', ...(laps === 1 ? [''] : [])]) {
        try {
          const g = JSON.parse(localStorage.getItem('gimmick.ghost.' + map + '.' + car + suffix) || 'null');
          if (!g || g.len !== Math.round(track.length)) continue;
          const total = g.v === 2 && g.laps === laps ? g.total : g.v === 1 && laps === 1 ? g.lap : null;
          if (!Number.isFinite(total) || Math.abs(total - v.race) > 0.002 || !gridStart(g, track)) continue;
          v.raceRivals = true;
          v.raceMode = 'race';
          v.raceExcludedReason = 'legacy-grid-start';
          // 한 바퀴 맵에서 완주와 같은 랩만 확정할 수 있음.
          if (laps === 1 && !v.lapMode && Math.abs(v.lap - total) <= 0.002) {
            v.lapRivals = true;
            v.lapMode = 'race';
          }
          changed = true;
          break;
        } catch {} // 고스트 없음·손상·다른 기록이면 그대로 둠
      }
    }
    if (changed) writeAll(all);
  },
  /** 이 맵 + 이 차의 기록 (없으면 null) */
  get(map, car) {
    const r = readAll()[map];
    return comparable(r && r[car]);
  },
  /** 이 맵에서 가장 빠른 랩 (어느 차든) → { lap, car } */
  bestOfMap(map) {
    const r = readAll()[map] || {};
    let best = null;
    for (const [car, v] of Object.entries(r)) if (!v.lapRivals && v.lap && (!best || v.lap < best.lap)) best = { lap: v.lap, car };
    return best;
  },
  /** 이 맵에서 가장 빠른 완주 기록 (어느 차든, 여러 바퀴면 합) → { race, car } */
  bestRaceOfMap(map) {
    const r = readAll()[map] || {};
    let best = null;
    for (const [car, v] of Object.entries(r)) if (!v.raceRivals && v.race && (!best || v.race < best.race)) best = { race: v.race, car };
    return best;
  },
  /** 한 바퀴 기록 저장. 새 최고 기록이면 true */
  saveLap(map, car, lap, assist = false, mode = 'solo') {
    const all = readAll();
    const m = (all[map] = all[map] || {});
    const v = (m[car] = m[car] || {});
    if (!v.lapRivals && v.lap && v.lap <= lap) return false;
    v.lap = +lap.toFixed(3);
    v.lapMode = mode;
    delete v.lapRivals;
    v.lapAssist = !!assist; // 운전 도움을 켜고 낸 기록이면 true ('도움 켬' 표시용)
    v.date = Date.now();
    writeAll(all);
    return true;
  },
  /** 완주 기록 저장. 새 최고 기록이면 true */
  saveRace(map, car, total, laps, assist = false, mode = 'solo') {
    const all = readAll();
    const m = (all[map] = all[map] || {});
    const v = (m[car] = m[car] || {});
    if (!v.raceRivals && v.race && v.race <= total) return false;
    v.race = +total.toFixed(3);
    v.raceMode = mode;
    delete v.raceRivals;
    delete v.raceExcludedReason;
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
