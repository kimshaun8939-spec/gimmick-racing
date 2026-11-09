// 구간(섹터) 기록: 한 바퀴를 길이로 3등분 (S1·S2·S3), F1 색
//   보라 = 이 맵 전체 최고 (어느 차든, 이번 레이스의 봇 포함) / 초록 = 내 최고 (이 맵 + 이 차) / 노랑 = 더 느림
//   최고 구간 기록은 localStorage 'gimmick.sectors' = { 맵: { 차: [s1, s2, s3] } } (records.js와 같은 규칙으로 저장)
const KEY = 'gimmick.sectors';
const COUNT = 3;

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function createSectors({ mapName, carId }) {
  const all = readAll();
  const mine = ((all[mapName] || {})[carId] || []).slice(); // 내 최고 (저장된 것)
  const overall = []; // 이 맵 전체 최고 (어느 차든)
  for (const v of Object.values(all[mapName] || {})) for (let i = 0; i < COUNT; i++) if (v[i] && !(overall[i] <= v[i])) overall[i] = v[i];
  const session = []; // 이번에 달린 것 중 최고 (봇 포함) → 보라 판정에 같이 씀

  let cur = 0; // 지금 달리는 구간 (0~2)
  let splitStart = 0; // 이 구간을 시작한 바퀴 시간
  let lapSplits = []; // 이번 바퀴 [{ time, color }]
  const laps = []; // 끝난 바퀴들의 구간 [[{time,color}×3]]
  let lastSplit = null; // 방금 끝난 구간 (HUD 강조용) { idx, time, delta, color, at }

  function colorFor(i, t) {
    const pb = mine[i], ob = Math.min(overall[i] ?? Infinity, session[i] ?? Infinity);
    if (t <= ob) return 'purple';
    if (pb == null || t <= pb) return 'green';
    return 'yellow';
  }
  function close(i, t, now) {
    const color = colorFor(i, t);
    const delta = mine[i] != null ? t - mine[i] : null;
    lapSplits[i] = { time: t, color, delta };
    lastSplit = { idx: i, time: t, color, delta, at: now };
    if (!(session[i] <= t)) session[i] = t;
  }

  return {
    COUNT,
    get current() {
      return cur;
    },
    get lastSplit() {
      return lastSplit;
    },
    get mine() {
      return mine;
    },
    laps,
    /** 바퀴 시작 (레이스 처음, 다시 시작) */
    reset() {
      cur = 0;
      splitStart = 0;
      lapSplits = [];
      laps.length = 0;
      lastSplit = null;
    },
    /**
     * 매 물리 스텝: lapFrac = 이번 바퀴 진행 (0~1), lapTime = 이번 바퀴 시간, now = 레이스 시간
     * 구간 경계(1/3, 2/3)를 지나면 구간 기록
     */
    step(lapFrac, lapTime, now) {
      while (cur < COUNT - 1 && lapFrac >= (cur + 1) / COUNT) {
        close(cur, lapTime - splitStart, now);
        splitStart = lapTime;
        cur++;
      }
    },
    /** 바퀴 끝: 마지막 구간 닫기 → 이번 바퀴 구간 [{time,color,delta}×3]. canSave면 최고 구간 저장 */
    lapDone(lapTime, now, canSave) {
      // 구간 경계를 못 보고 지나갔으면(복귀 등) 남은 구간은 비워 둠
      while (cur < COUNT - 1) {
        lapSplits[cur] = null;
        cur++;
      }
      close(COUNT - 1, lapTime - splitStart, now);
      const done = lapSplits.slice();
      laps.push(done);
      // 구간 경계를 다 지난 정상적인 바퀴만 저장 (순간이동·테스트로 끝난 바퀴는 S3에 전체 시간이 들어가므로)
      if (canSave && done.every((x) => x)) {
        let changed = false;
        done.forEach((s, i) => {
          if (s && (mine[i] == null || s.time < mine[i])) {
            mine[i] = +s.time.toFixed(3);
            changed = true;
          }
        });
        if (changed) {
          const a = readAll();
          (a[mapName] = a[mapName] || {})[carId] = mine.slice();
          try {
            localStorage.setItem(KEY, JSON.stringify(a));
          } catch {}
        }
      }
      // 다음 바퀴
      cur = 0;
      splitStart = 0;
      lapSplits = [];
      return done;
    },
    /** 다른 차(봇)의 구간 기록도 보라 판정에 넣기 */
    addSession(i, t) {
      if (!(session[i] <= t)) session[i] = t;
    },
    /** HUD용: 구간 칸 3개 { label, time, color, live } */
    hud(lapTime) {
      const cells = [];
      for (let i = 0; i < COUNT; i++) {
        if (i < cur && lapSplits[i]) cells.push({ label: `S${i + 1}`, time: lapSplits[i].time, color: lapSplits[i].color, delta: lapSplits[i].delta });
        else if (i === cur) cells.push({ label: `S${i + 1}`, time: lapTime - splitStart, color: 'live' });
        else cells.push({ label: `S${i + 1}`, time: null, color: 'none' });
      }
      return cells;
    },
    /** 가장 좋은 구간들을 합친 "이론상 최고 랩" (이번 레이스) */
    theoretical() {
      const b = [];
      for (const lap of laps) lap.forEach((s, i) => s && !(b[i] <= s.time) && (b[i] = s.time));
      return b.length === COUNT && b.every((x) => x != null) ? b.reduce((a, c) => a + c, 0) : null;
    },
    bestSplits() {
      const b = [];
      for (const lap of laps) lap.forEach((s, i) => s && !(b[i] <= s.time) && (b[i] = s.time));
      return b;
    },
  };
}
