// 코너 분석: 레이싱 라인(에이펙스·곡률)과 속도 계획에서 "코너"를 자동으로 찾아냄
//
//   - 에이펙스가 같은 방향으로 90 m 안에 붙어 있으면 한 코너 (더블 에이펙스)
//   - 브레이크 지점: 코너의 가장 느린 곳에서 거꾸로 거슬러 올라가 속도가 가장 높았던 곳
//   - 탈출 지점: 마지막 에이펙스 뒤에서 라인이 바깥 끝에 닿거나 곧게 펴지는 곳
//   - 연결(linked): 앞 코너 탈출 지점에서 이 코너 브레이크 지점까지가 짧으면 (linkGap m)
//     → 앞 코너를 잘 빠져나와야 이 코너도 잘 들어갈 수 있는 "이어진 코너"
//
// 맵 모양이 바뀌어도 자동으로 다시 계산됨 (t 값을 직접 적지 않음).
// car.js(탈출·연계 판정), gpCorners.js(브레이크 표시판·코너 번호·에이펙스 표시)가 같이 씀

/**
 * @param line computeRacingLine 결과
 * @param prof line.profile(...) 결과 { speed, brake }
 * @param length 한 바퀴 길이 (m)
 */
export function analyzeCorners(line, prof, length, opts = {}) {
  const N = line.N, ds = length / N;
  const W = (i) => ((i % N) + N) % N;
  const v = prof.speed;
  const M = (m) => Math.max(1, Math.round(m / ds)); // m → 지점 수
  const linkGap = opts.linkGap ?? 220;
  const fwdDist = (a, b) => W(b - a) * ds; // a에서 앞으로 b까지 (m)

  // 1) 에이펙스 묶기
  const groups = [];
  line.apexes.forEach((ap, n) => {
    const g = groups[groups.length - 1];
    if (g && g.side === ap.side && fwdDist(g.apexes[g.apexes.length - 1].i, ap.i) < 90) g.apexes.push({ n, i: ap.i });
    else groups.push({ side: ap.side, apexes: [{ n, i: ap.i }] });
  });
  // 고리 끝과 처음이 한 코너면 합침
  if (groups.length > 1) {
    const a = groups[groups.length - 1], b = groups[0];
    if (a.side === b.side && fwdDist(a.apexes[a.apexes.length - 1].i, b.apexes[0].i) < 90) {
      b.apexes = [...a.apexes, ...b.apexes];
      groups.pop();
    }
  }

  // 2) 코너마다 가장 느린 곳, 브레이크 지점, 탈출 지점
  const corners = groups.map((g) => {
    const first = g.apexes[0].i, last = g.apexes[g.apexes.length - 1].i;
    let minI = first;
    for (let j = -M(40); j <= fwdDist(first, last) / ds + M(40); j++) if (v[W(first + j)] < v[minI]) minI = W(first + j);
    // 브레이크 지점: 가장 느린 곳에서 거꾸로 가며 속도 계획의 감속 구간(prof.brake)이 시작되는 곳
    // (감속 구간 사이의 짧은 틈 8 m는 이어 봄. 가장 느린 곳 60 m 앞까지 감속이 없으면 = 액셀만 떼는 빠른 코너)
    let p = minI, seen = false, gapM = 0, q = minI;
    for (let k = 0; k < M(900); k++) {
      q = W(q - 1);
      if (prof.brake[q]) {
        seen = true;
        gapM = 0;
        if (v[q] >= v[p]) p = q;
      } else {
        gapM += ds;
        if ((seen && gapM > 8) || (!seen && gapM > 60)) break;
      }
    }
    const drop = v[p] - v[minI];
    // 탈출: 마지막 에이펙스에서 15 m 뒤부터, 라인이 바깥 끝 1.5 m 안 또는 곡률이 작아짐 (반지름 > 400 m가 10 m 이어짐)
    const outLo = g.side > 0; // 오른쪽으로 굽음(안쪽 오른쪽) → 바깥은 왼쪽(lo)
    let exitI = W(last + M(140)), calm = 0;
    for (let k = M(15); k < M(140); k++) {
      const q = W(last + k);
      const edge = outLo ? line.lo[q] : line.hi[q];
      if (Math.abs(edge - line.offset[q]) < 1.5) {
        exitI = q;
        break;
      }
      calm = Math.abs(line.curvature[q]) < 1 / 400 ? calm + 1 : 0;
      if (calm * ds >= 10) {
        exitI = W(q - calm + 1);
        break;
      }
    }
    // 코너 시간 재기 시작점: 브레이크 지점, 브레이크가 없으면(풀 스로틀 코너) 첫 에이펙스 120 m 앞
    const startI = drop > 1.5 ? p : W(first - M(120));
    return {
      side: g.side, apexes: g.apexes, apexI: first, minI, vMin: v[minI],
      brakeI: p, vBrake: v[p], drop, brakeLen: fwdDist(p, minI), exitI, vExit: v[exitI], startI,
    };
  });
  // 고리 순서대로 (첫 에이펙스 기준), 번호 T1, T2… (출발선 t=0 다음부터)
  corners.sort((a, b) => a.apexI - b.apexI);
  corners.forEach((c, k) => {
    c.k = k;
    c.num = k + 1;
  });
  // 3) 연결: 앞 코너 탈출 → 이 코너 시작이 짧으면 이어진 코너
  corners.forEach((c, k) => {
    const prev = corners[W2(k - 1, corners.length)];
    const gap = fwdDist(prev.exitI, c.drop > 1.5 ? c.brakeI : W(c.apexI - M(60)));
    c.gapPrev = gap;
    c.linkedPrev = corners.length > 1 && gap < linkGap && gap < length / 2;
  });
  // 지점 → 이 지점에서 탈출 판정할 코너 (빠른 찾기)
  const exitAt = new Map(corners.map((c) => [c.exitI, c]));
  // 지점 → 탈출 구간(마지막 에이펙스 ~ 탈출 지점)인 코너 번호 (-1 = 아님). 이 구간에서 브레이크·액셀을 봄
  const exitZone = new Int16Array(N).fill(-1);
  for (const c of corners) {
    const last = c.apexes[c.apexes.length - 1].i;
    for (let j = 0, n = W(c.exitI - last); j <= n; j++) exitZone[W(last + j)] = c.k;
  }
  const startAt = new Map(corners.map((c) => [c.startI, c]));
  const apexCorner = new Map();
  for (const c of corners) for (const a of c.apexes) apexCorner.set(a.n, c);
  return { corners, exitAt, startAt, exitZone, apexCorner, ds, N };
}
const W2 = (i, n) => ((i % n) + n) % n;
