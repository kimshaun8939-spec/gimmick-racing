// 순위표(tower) 시간 차이를 '지금' 기준으로 다시 계산 (2026-11-14 p0)
//   raceSystem.hudInfo의 간격은 '각 차가 마지막으로 지난 기록 지점(약 20 m마다)'에서 1등과의 시각 차라서
//   차마다 재는 곳이 달라 7등 +1.025 / 8등 +0.808처럼 순서가 뒤섞였음.
//   여기서는 F1 방송처럼: 간격 = 지금 시각 − (1등이 이 차의 지금 위치를 지난 시각, 기록 지점 사이는 보간)
//   → 진행(progress) 순서대로 늘 커짐. 계산할 수 없는 줄(그리드·지름길 등)은 원래 값을 쓰되 위 줄보다 작게는 안 보임.
//   raceSystem.js는 안 고침 (entries의 marks·progress만 읽음)

const fmt = (sec) => `+${sec.toFixed(sec < 10 ? 3 : 1)}`;
const parseGap = (s) => {
  const m = /^\+(\d+(?:\.\d+)?)$/.exec(String(s || ''));
  return m ? +m[1] : null;
};

/** 1등 e가 진행 p(바퀴 단위)를 지난 시각. 모르면 NaN */
function leaderTimeAt(e, p, M) {
  const marks = e && e.marks;
  if (!marks || !(p >= 0)) return NaN;
  const x = p * M;
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= marks.length) return NaN;
  const t0 = marks[i], t1 = marks[i + 1];
  if (!isFinite(t0)) return NaN;
  if (!isFinite(t1)) return t0;
  return t0 + (t1 - t0) * (x - i);
}

/**
 * info = raceSys.hudInfo(time), list = raceSys.standings() (같은 순서), time = race.clock, laps = 바퀴 수
 * info를 고쳐서 돌려줌 (tower[k].gap 글자, ahead/behind.gap {sec})
 */
export function liveGaps(info, list, time, laps) {
  if (!info || !info.tower || !list || list.length !== info.tower.length || !(time > 0.5)) return info;
  const lead = list[0];
  const n = lead && lead.marks ? lead.marks.length : 0;
  const M = n && laps > 0 ? (n - 2) / (laps + 2) : 0;
  if (!(M > 0)) return info;
  const secs = new Array(list.length).fill(null); // 1등과의 간격(초), 바퀴 차이면 null
  secs[0] = 0;
  let prev = 0;
  for (let k = 1; k < list.length; k++) {
    const e = list[k], row = info.tower[k];
    if (!row || /랩$/.test(String(row.gap))) { prev = Infinity; continue; } // +n랩은 그대로
    let sec = null;
    if (e.finished && lead.finished && e.finishTime != null && lead.finishTime != null) sec = e.finishTime - lead.finishTime;
    else if (!e.finished) {
      const tl = leaderTimeAt(lead, e.progress, M);
      if (isFinite(tl)) sec = time - tl;
    }
    if (sec == null) sec = parseGap(row.gap);
    if (sec == null) continue;
    if (prev === Infinity) continue;
    sec = Math.max(0, sec, prev); // 위 줄보다 작게는 안 보임
    prev = sec;
    secs[k] = sec;
    row.gap = fmt(sec);
  }
  // 앞·뒤 차 간격도 같은 숫자로 (순위표와 어긋나지 않게)
  const i = info.pos - 1;
  if (info.ahead && secs[i] != null && secs[i - 1] != null && info.ahead.gap && !info.ahead.gap.laps) info.ahead.gap = { sec: secs[i] - secs[i - 1] };
  if (info.behind && secs[i] != null && secs[i + 1] != null && info.behind.gap && !info.behind.gap.laps) info.behind.gap = { sec: secs[i + 1] - secs[i] };
  return info;
}
