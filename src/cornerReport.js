// 코너 분석 (race 에이전트, 2026-11-10 6라운드)
//   레이스 중 코너마다 car.lastCornerInfo(코너 시간·에이펙스·탈출 라인·탈출 액셀·탈출 속도·에이펙스 뒤 브레이크)를 모아 두고,
//   결과 화면에서 "어디서 시간을 잃었는지"를 보여 줌.
//   비교 기준: 봇이 있으면 이번 레이스에서 가장 빠른 봇의 코너 시간, 없으면 레이스 전 내 최고 기록(cornerBest).
//   개선할 코너 TOP 3 + 한 줄 팁 ("T4: 탈출 가속이 늦어요" 등).

/** 문제 종류 → 팁 (쉬운 말) */
const TIPS = {
  apex: '코너 안쪽을 놓쳤어요 — 안쪽 연석에 조금 더 붙어요',
  lateBrake: '브레이크가 늦어요 — 꺾기 전에 감속하고, 코너 안쪽을 지난 뒤에는 브레이크를 놓으세요',
  slowThrottle: '탈출 가속이 늦어요 — 코너 안쪽을 지난 뒤 다시 가속해요',
  earlyBrake: '브레이크가 일러요 — 너무 많이 줄여서 탈출이 느려요',
  wide: '탈출 라인이 어긋나요 — 바깥쪽까지 넓게 펴며 나가요',
  clean: '깔끔해요! 이대로 조금만 더 빠르게',
};

export function createCornerReport(cfg = {}) {
  const k = cfg.corner || {};
  const exitTol = k.exitTol ?? 2.5, exitThr = k.exitThrottle ?? 0.75, exitRatio = k.exitSpeedRatio ?? 0.8;
  let ref = {}; // 레이스 전 내 최고 (코너 번호 → 초)
  let data = new Map(); // num → { num, times: [], issues: {..} , n }

  function reset(refBest) {
    ref = { ...(refBest || {}) };
    data = new Map();
  }
  /** 'corner' 이벤트마다 (내 차) */
  function add(info) {
    if (!info || info.num == null) return;
    let d = data.get(info.num);
    if (!d) data.set(info.num, (d = { num: info.num, times: [], n: 0, issues: { apex: 0, lateBrake: 0, slowThrottle: 0, earlyBrake: 0, wide: 0 } }));
    d.n++;
    if (info.time != null) d.times.push(info.time);
    const is = d.issues;
    if (!info.apexHit) is.apex++;
    if (info.noBrake === false) is.lateBrake++;
    if (info.thrAvg != null && info.thrAvg < exitThr) is.slowThrottle++;
    if (info.apexHit && info.noBrake !== false && info.ratio != null && info.ratio < exitRatio) is.earlyBrake++;
    if (info.latErr != null && info.latErr > exitTol) is.wide++;
  }
  /** 가장 자주 나온 문제 → 팁 */
  function tipOf(d) {
    let best = null, cnt = 0;
    for (const key of ['lateBrake', 'apex', 'earlyBrake', 'slowThrottle', 'wide']) {
      if (d.issues[key] > cnt) {
        cnt = d.issues[key];
        best = key;
      }
    }
    return best ? { key: best, text: TIPS[best], count: cnt } : { key: 'clean', text: TIPS.clean, count: 0 };
  }
  /**
   * 결과 화면용 요약. botBest = { num: 가장 빠른 봇 코너 시간 }
   * → { rows: [{ num, mine, refT, refKind, delta, tip, issues }], top: [...3], refKind, total }
   */
  function summary(botBest) {
    const useBot = botBest && Object.keys(botBest).length > 0;
    const rows = [];
    for (const d of data.values()) {
      if (!d.times.length) continue;
      const mine = Math.min(...d.times);
      const refT = useBot ? botBest[d.num] : ref[d.num];
      const delta = refT != null ? mine - refT : null;
      rows.push({ num: d.num, mine, refT: refT ?? null, delta, tip: tipOf(d), n: d.n });
    }
    rows.sort((a, b) => String(a.num).localeCompare(String(b.num), undefined, { numeric: true }));
    // 개선할 코너: 기준보다 많이 느린 곳 → 같으면 문제 횟수가 많은 곳
    const score = (r) => (r.delta != null ? r.delta : 0) + r.tip.count * 0.05;
    const top = rows
      .filter((r) => (r.delta != null && r.delta > 0.02) || r.tip.key !== 'clean')
      .sort((a, b) => score(b) - score(a))
      .slice(0, 3);
    const lost = rows.reduce((a, r) => a + (r.delta != null && r.delta > 0 ? r.delta : 0), 0);
    return { rows, top, refKind: useBot ? 'bot' : Object.keys(ref).length ? 'me' : null, lost };
  }
  return {
    reset,
    add,
    summary,
    get count() {
      return data.size;
    },
  };
}
