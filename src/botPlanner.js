// botPlanner (2026-11-26, 사용자 "봇이 추월을 너무 못해, 규칙으로 하는 건 한계"): 봇의 차 사이 판단을 '후보 길 여러 개를 미리 달려 보고 점수로 고르기'로.
//   bots.js가 &planner=1일 때만 부름 (땅 위·좁은 길/점프/물/비행/자석/출발 줄 아님·근처에 차 있음). 라인 따라가기·조향·비행·배·점프·지름길은 bots.js 그대로.
//   0.1초마다 (봇마다 시점을 엇갈려서):
//     1) 후보 길: 지금 줄 유지·라인·라인 기준 ±1.5/3/4.5/6/7.5 m·앞차 옆(앞차 줄 ± 차 폭+0.5) × 옮기는 빠르기(빨리 5 m/s / 천천히 2.4 m/s)
//        × 속도 방법(P 계획대로 / F 앞차 따라가기 — F는 P가 앞차와 부딪힐 때만)
//     2) 각 후보를 2.5초 미리 달려 봄: 간단한 차 모델 (점 하나: 라인 기준 옆 거리·옆 속도, 지시 줄을 따라가는 지연 약 0.4초(2차 스프링),
//        그 자리 옆 줄 곡률로 정한 커브 한계 + 계획 속도 + 브레이크 거리 (bots.js 속도 계산과 같은 식) · 가속 한계(lineCarModel aAcc) · 감속 한계
//        · 남은 옆 접지로만 줄을 옮김 · 슬립스트림 대략). 다른 차는 bpPredict(라인 쪽으로 돌아가며 계획 속도를 따라감)로 움직임 — 사람·봇 같은 방법
//     3) 점수 = 2.5초 동안 간 거리 + 끝 속도×0.5 + 앞지른 차 + ... − 세게 박음(뒤에서 들이받기: 10 + 5×속도 차) − 비빔(작게)
//        − 길 밖(낭떠러지·용암·벽 쪽은 크게) − 핸들 한계 넘음 − 줄 바꾸기(조금) − 끝에 라인에서 떨어진 거리(조금), 지난번 고른 것에 +가산점
//        시간이 먼 쪽의 충돌은 덜 셈 (예측이 덜 맞음: 1초 뒤부터 2.5초에 절반)
//     4) 가장 좋은 후보의 줄(st.laneTarget)·옮기는 빠르기·속도 방법을 0.1초 동안 따름 (F면 매 스텝 실제 앞차로 따라가기 속도 계산)
//   숨은 성능 보너스 없음 (차 성능·물리·견인·슬립스트림·DRS 규칙은 그대로, 운전 판단만).
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const PL = {
  T: 2.5, h: 0.1, every: 0.1,
  fast: 5.0, slow: 2.4, om: 5.2, // 줄 옮기는 빠르기(m/s), 지시 줄을 따라가는 2차 스프링 (지연 ≈ 2/om ≈ 0.4초)
  wHit: 1, wRub: 1.0, wOff: 3, wSat: 18, wChg: 1.0, wKeep: 0.8, wLine: 0.5, wPass: 2.5, vEnd: 0.5,
  fB: 0.9, noCorner: 1, guard: 1, // noCorner 1: 브레이크 구간·코너 안에서는 예전 운전(시험에서 코너까지 맡기면 강한 접촉·코스 밖이 늘었음), fB: 앞차 따라가기에서 쓰는 브레이크 힘 비율 (1 = 앞차와 똑같이 세게; 기차 꼬리 과감속 줄이기)
   trO: 8, wClose: 1.5, wBehind: 0.1, // 뒤차가 와서 박는 것은 뒤차 몫 (뒤차도 피함) → 작게 // 다른 차 예측: 라인으로 돌아가는 시간(초, 클수록 지금 줄 유지), 옆에서 옆으로 다가가는 빠르기 벌점
  termMax: 25, wTerm: 2, look: 160, wBrkLine: 1.5, // 끝 자리 값: 끝난 줄로 다음 코너(160 m)를 지날 때 라인보다 느려지는 만큼 ×3초, 브레이크 구간 앞이면 라인에서 떨어진 거리 ×1.5 더
};
// 시험용: &plk=trO:8,wRub:2 처럼 값 바꾸기
try { const q = new URLSearchParams(globalThis.location?.search || '').get('plk'); if (q) for (const kv of q.split(',')) { const [a, b] = kv.split(':'); if (a in PL && Number.isFinite(+b)) PL[a] = +b; } } catch (e) { /* 없음 */ }

export function createPlanner(E) {
  // E = { L, N, ds, S, prof, laneCurvature(j, lane), bpPredict, aLat(v), aAcc(v), aBrake(v), edgeK(j, side) }
  const { L, N, ds, S, prof } = E;
  // 속도별 한계는 0.5 m/s 칸 표로 (매번 계산하면 느림)
  const tab = (f) => { const a = new Float32Array(281); for (let i = 0; i <= 280; i++) a[i] = f(i * 0.5); return (v) => { const x = clamp(v, 0, 139.99) * 2, i = x | 0, u = x - i; return a[i] + (a[i + 1] - a[i]) * u; }; };
  const aLat = tab(E.aLat), aBrake = tab(E.aBrake), aAcc = tab(E.aAcc);
  const W = (i) => ((i % N) + N) % N;
  const stepI = Math.max(1, Math.round(3 / ds)), stepD = stepI * ds;
  // 옆 줄 곡률 (bots.js laneCurvature와 같은 값, 1 m 칸) — 맵마다 그대로라 한 번 계산하면 기억
  const curvCache = new Map();
  const laneKeyOf = (lane) => (Math.abs(lane) <= 0.5 ? 0 : Math.round(lane));
  function curvAt(j, lane) {
    const lk = laneKeyOf(lane);
    if (lk === 0) return L.curvature[j];
    let a = curvCache.get(lk);
    if (!a) { a = new Float32Array(N).fill(NaN); curvCache.set(lk, a); }
    let c = a[j];
    if (c !== c) { c = E.laneCurvature(j, lk); a[j] = c; }
    return c;
  }

  /**
   * ctx: { i0, v, e0, ev, c0, d0, k, kB, g, lead, topCap, aeroTop, vTop, drag, bold, others:[{key,g,lane,ov,acc,v,Lf,Lb,W,hb,human}], prev }
   * → { eT, r, pol, key, sc, parts, n, i }
   */
  function plan(ctx) {
    const { i0, k, kB, g } = ctx;
    const v0 = Math.max(0, ctx.v), T = PL.T, h = PL.h, K = Math.round(T / h);
    // --- 계획 속도 + 브레이크 거리 (옆 줄마다 한 번) ---
    const D = Math.min(700, v0 * T * 1.2 + (v0 * v0) / (2 * Math.max(4, aBrake(v0) * kB * g)) + 40);
    const Q = Math.ceil(D / stepD) + 2, leadQ = Math.round((Math.max(10, v0) * (ctx.lead || 0)) / stepD);
    const envs = new Map();
    const envFor = (lane) => {
      const lk = laneKeyOf(lane);
      let env = envs.get(lk);
      if (env) return env;
      env = new Float32Array(Q + leadQ + 1);
      const n = env.length, vq = new Float32Array(n);
      for (let q = 0; q < n; q++) {
        const j = W(i0 + q * stepI);
        let x = prof.speed[j] * k;
        if (ctx.aeroTop > 1.001 && !prof.brake[j]) x *= 1 + (ctx.aeroTop - 1) * clamp((prof.speed[j] / ctx.vTop - 0.75) / 0.2, 0, 1);
        const hw = S[j].hw;
        if (hw != null && hw < 7) x *= 0.96;
        if (lk !== 0 && !S[j].roll && !S[j].gap) {
          const sc = curvAt(j, lk), c = Math.abs(sc);
          if (c > 0.001) {
            const lat = aLat(x), bank = 9.81 * Math.sin(S[j].bank || 0) * Math.sign(sc) * (E.bankGrip || 0);
            x = Math.min(x, Math.sqrt(Math.max(lat * 0.5, lat + bank) / c) * Math.min(1, k));
          }
        }
        vq[q] = Math.min(x, ctx.topCap);
      }
      env[n - 1] = vq[n - 1];
      for (let q = n - 2; q >= 0; q--) { const u = env[q + 1]; env[q] = Math.min(vq[q], Math.sqrt(u * u + 2 * kB * g * aBrake(u) * stepD)); }
      envs.set(lk, env);
      return env;
    };
    // --- 다른 차 예측 (0.1초 칸) ---
    const O = [];
    for (const o of ctx.others) {
      const sO = new Float32Array(K + 1), vO = new Float32Array(K + 1), eO = new Float32Array(K + 1);
      vO[0] = o.v; eO[0] = o.lane;
      const jO = W(i0 + Math.round(o.g / ds));
      let kk = 0;
      E.bpPredict(L, prof.speed, ds, jO, o.lane, o.ov, o.v, o.acc, T, o.hb, 0.6, PL.trO, {}, (s, vl, ln, t) => {
        const kq = Math.round(t / h);
        if (Math.abs(t - kq * h) < 1e-4 && kq > kk && kq <= K) { kk = kq; sO[kq] = s; vO[kq] = vl; eO[kq] = ln; }
        return false;
      });
      for (let q = 1; q <= K; q++) if (!(q <= kk)) { sO[q] = sO[q - 1] + vO[q - 1] * h; vO[q] = vO[q - 1]; eO[q] = eO[q - 1]; }
      O.push({ o, sO, vO, eO });
    }
    // --- 후보 ---
    const lo0 = L.lo[i0] - L.offset[i0], hi0 = L.hi[i0] - L.offset[i0];
    const jA = W(i0 + Math.round((v0 * 0.8) / ds)), loA = L.lo[jA] - L.offset[jA], hiA = L.hi[jA] - L.offset[jA];
    const m = ctx.m ?? 1; // 줄 가장자리 여유 (bots.js fits()와 같은 max(1, 차 반폭)) — 예전 운전보다 가장자리로 더 가지 않게
    let LO = Math.min(0, Math.max(lo0, loA) + m), HI = Math.max(0, Math.min(hi0, hiA) - m); // 라인 자리(0)는 늘 됨 (라인이 가장자리에 붙어 있어도)
    if (LO > HI) LO = HI = (LO + HI) / 2; // 아주 좁으면 가운데 하나
    const lanes = [];
    const addLane = (x, tag) => {
      if (!Number.isFinite(x)) return;
      x = clamp(x, LO, HI);
      if (lanes.some((y) => Math.abs(y.x - x) < 0.6)) return;
      lanes.push({ x, tag });
    };
    addLane(ctx.c0, 'hold');
    if (ctx.holdOnly) addLane(0, 'line'); // noCorner 2: 브레이크 구간·코너에서는 지금 줄 또는 라인으로 돌아가기만, 나머지는 속도(따라가기) 고르기
    else {
    if (ctx.prev) addLane(ctx.prev.eT, 'prev');
    addLane(0, 'line');
    for (const d of [1.5, 3, 4.5, 6]) { addLane(-d, 'g'); addLane(d, 'g'); }
    const ahead = O.filter((x) => x.o.g > 0 && x.o.g < 70).sort((a, b) => a.o.g - b.o.g).slice(0, 3);
    for (const x of ahead) {
      const w = x.o.W + 0.5, e1 = x.eO[Math.min(K, 10)];
      addLane(x.o.lane - w, 'side'); addLane(x.o.lane + w, 'side');
      if (x === ahead[0]) { addLane(e1 - w, 'side1'); addLane(e1 + w, 'side1'); }
    }
    }
    const cands = [];
    for (const ln of lanes) {
      const far = Math.abs(ln.x - ctx.c0) > 0.8;
      for (const r of far && Math.abs(ln.x - ctx.c0) < 4.5 ? [PL.fast, PL.slow] : [PL.fast]) cands.push({ eT: ln.x, r, tag: ln.tag });
    }
    const pen = ctx.bold ? 1 : 2.5; // 쉬움은 충돌을 더 무서워함
    const prev = ctx.prev;
    // --- 미리 달리기 ---
    const roll = (cd, pol) => {
      let s = 0, e = ctx.e0, ev = ctx.ev, c = ctx.c0, v = v0, d = ctx.d0 || 0;
      let hit = 0, rub = 0, off = 0, sat = 0, minV = v0, folKey = null; const hitBy = ctx.dump ? {} : null;
      const om = PL.om, om2 = om * om;
      const st = O.map((x) => { const dsr = x.o.g, der = x.eO[0] - e; return { lat: Math.abs(der) < x.o.W, lon: dsr < x.o.Lf && dsr > -x.o.Lb, der }; });
      for (let q = 1; q <= K; q++) {
        const t = q * h, wT = t <= 1 ? 1 : 1 - (0.5 * (t - 1)) / (T - 1);
        // 지시 줄 (목표 근처에서는 천천히 멈춤, bots.js MLANE2와 비슷)
        const dC = cd.eT - c, rr = Math.min(cd.r, Math.sqrt(7 * Math.abs(dC)) + 0.3);
        c += clamp(dC, -rr * h, rr * h);
        const j = W(i0 + Math.round(s / ds));
        const k0 = L.curvature[j], ak = Math.abs(k0), dIn = -e * Math.sign(k0); // 매끈한 옆 줄 곡률 (핸들 한계 계산용)
        const aL = aLat(v), aC = (ak / Math.max(0.3, 1 - dIn * ak)) * v * v;
        const cc = clamp(c, Math.min(0, L.lo[j] - L.offset[j] + m), Math.max(0, L.hi[j] - L.offset[j] - m)); // bots.js target()처럼 도로 안으로 자른 줄
        let ea = om2 * (cc - e) - 2 * om * ev;
        const room = Math.max(0.25 * aL, aL - aC);
        if (Math.abs(ea) > room) { sat += ((Math.abs(ea) - room) / aL) * h; ea = Math.sign(ea) * room; }
        if (aC > aL * 1.1) sat += (aC / aL - 1.1) * h;
        const eP = e; ev += ea * h; e += ev * h;
        // 속도
        const env = envFor(e), qi = Math.min(env.length - 1, Math.round(s / stepD) + leadQ);
        let vA = env[qi];
        if (d > 0.02 && vA >= ctx.vTop * 0.85) vA *= 1 + 0.1 * d;
        let vC = vA;
        if (pol === 'F') {
          let best = Infinity;
          for (let n = 0; n < O.length; n++) {
            const x = O[n], dsr = x.o.g + x.sO[q - 1] - s;
            if (dsr <= x.o.Lf * 0.6 || Math.abs(x.eO[q - 1] - e) >= x.o.W - 0.1) continue;
            const gap = dsr - x.o.Lf - (1 + 0.02 * v), vo = x.vO[q - 1], b = PL.fB * kB * g * aBrake(vo);
            const vf = gap >= 0 ? Math.sqrt(vo * vo + 2 * b * gap) : vo + gap * 2;
            if (vf < best) { best = vf; folKey = x.o.key; }
          }
          vC = Math.min(vC, Math.max(0, best));
        }
        if (v < vC) v = Math.min(vC, v + (aAcc(v) + 0.5 * d * (ctx.drag || 0) * v * v) * h);
        else v = Math.max(vC, v - kB * g * aBrake(v) * h);
        s += v * h;
        if (v < minV) minV = v;
        // 슬립스트림 (대략): 앞 4~72 m, 옆 2.8 m 안
        let dT = 0;
        // 다른 차와 겹침
        for (let n = 0; n < O.length; n++) {
          const x = O[n], o = x.o, S0 = st[n];
          const dsr = o.g + x.sO[q] - s, der = x.eO[q] - e;
          if (dsr > 4 && dsr < 72 && Math.abs(der) < 2.8) dT = Math.max(dT, 1 - (dsr - 4) / 68);
          const inLat = Math.abs(der) < o.W, inLon = dsr < o.Lf && dsr > -o.Lb;
          if (inLon && Math.abs(der) < o.W + 0.8) { const lc = (Math.abs(S0.der) - Math.abs(der)) / h; if (lc > 1) hit += PL.wClose * (lc - 1) * h * 10 * wT; } // 옆에 나란히 있을 때 옆으로 세게 다가가기 = 옆으로 박기
          if (inLat && inLon) {
            if (!(S0.lat && S0.lon)) {
              if (S0.lat) { // 앞뒤로 들어옴 = 뒤에서 박음 (내가 박거나, 뒤차가 나를)
                const cl = dsr > 0 ? v - x.vO[q] : x.vO[q] - v;
                const hv = (cl > 2.5 ? 10 + 5 * cl : 1.5 + cl) * (dsr > 0 ? 1 : PL.wBehind) * wT; hit += hv;
                if (hitBy) hitBy[o.key] = (hitBy[o.key] || '') + `R${t.toFixed(1)}:${hv.toFixed(0)}`;
              } else { // 옆으로 들어옴 = 옆 비빔
                const lv = Math.abs(der - S0.der) / h, sg = Math.sign(S0.der) || 1;
                const mine = Math.max(0, (e - eP) * sg), theirs = Math.max(0, -(x.eO[q] - x.eO[q - 1]) * sg); // 누가 옆으로 다가갔나
                const share = mine + theirs > 1e-4 ? Math.max(0.2, mine / (mine + theirs)) : 0.5;
                const hv = (3 + 2 * Math.min(4, lv)) * share * wT; hit += hv;
                if (hitBy) hitBy[o.key] = (hitBy[o.key] || '') + `S${t.toFixed(1)}:${hv.toFixed(0)}`;
              }
            }
            const depth = Math.min(o.W - Math.abs(der), o.Lf - dsr, dsr + o.Lb);
            rub += Math.min(1, depth) * wT;
          }
          S0.lat = inLat; S0.lon = inLon; S0.der = der;
        }
        d += (dT - d) * Math.min(1, h / (dT > d ? 1.6 : 1.2));
        // 길 밖
        const jj = W(i0 + Math.round(s / ds)), lat = L.offset[jj] + e;
        const oHi = lat - (L.hi[jj] + 0.3), oLo = L.lo[jj] - 0.3 - lat;
        if (oHi > 0) off += (oHi + (oHi > 1 ? 2 * (oHi - 1) : 0)) * E.edgeK(jj, 1) * wT;
        else if (oLo > 0) off += (oLo + (oLo > 1 ? 2 * (oLo - 1) : 0)) * E.edgeK(jj, -1) * wT;
      }
      // 앞지른 차 / 뺏긴 차
      let pass = 0;
      for (const x of O) {
        const o = x.o, g0 = o.g, g1 = o.g + x.sO[K] - s;
        if (g0 > 0 && g1 < -o.Lb) pass += o.human ? 1.2 : 1;
        else if (g0 < 0 && g1 > o.Lf) pass -= 1;
      }
      // 끝 자리: 이 줄 그대로 다음 코너에 들어가면 라인보다 얼마나 느린가 (브레이크 구간 앞 바깥 줄 고르지 않기)
      let term = 0;
      { const envE = envFor(e), env0 = envFor(0), q0 = Math.min(env0.length - 1, Math.round(s / stepD) + leadQ), q1 = Math.min(env0.length - 1, q0 + Math.ceil(PL.look / stepD));
        let mE = Infinity, m0 = Infinity; for (let q = q0; q <= q1; q++) { if (envE[q] < mE) mE = envE[q]; if (env0[q] < m0) m0 = env0[q]; }
        term = Math.min(PL.termMax, PL.wTerm * Math.max(0, m0 - mE) + (m0 < v * 0.85 ? PL.wBrkLine * Math.abs(e) : 0)); }
      const P = { term, prog: s + PL.vEnd * v, hit: PL.wHit * pen * hit, rub: PL.wRub * pen * rub, off: PL.wOff * off, sat: PL.wSat * sat, pass: PL.wPass * pass, line: PL.wLine * Math.abs(e), chg: 0, keep: 0 };
      if (prev) {
        if (Math.abs(cd.eT - prev.eT) > 0.5) P.chg = PL.wChg + 0.1 * Math.abs(cd.eT - prev.eT);
        else if (pol === prev.pol && cd.r === prev.r) P.keep = PL.wKeep;
        else if (pol === prev.pol) P.keep = PL.wKeep * 0.5;
      }
      if (cd.r === PL.fast && Math.abs(cd.eT - ctx.c0) > 0.8) P.chg += 0.15;
      const sc = P.prog - P.hit - P.rub - P.off - P.sat + P.pass - P.line - P.chg + P.keep - P.term;
      return { sc, P, folKey, minV, hitRaw: hit, hitBy };
    };
    let best = null, n = 0;
    for (let i = 0; i < cands.length; i++) {
      const cd = cands[i];
      const rP = roll(cd, 'P'); n++;
      let pick = { ...rP, pol: 'P' };
      if (rP.hitRaw > 0.5 || rP.P.rub > 0.5) { const rF = roll(cd, 'F'); n++; if (rF.sc > pick.sc) pick = { ...rF, pol: 'F' }; }
      if (!best || pick.sc > best.sc) best = { ...pick, i, eT: cd.eT, r: cd.r, tag: cd.tag };
      if (ctx.dump) (ctx.dump.all ||= []).push(`${pick.pol}${cd.tag} e${cd.eT.toFixed(1)} r${cd.r} s${pick.sc.toFixed(1)} p${pick.P.prog.toFixed(0)} h${pick.P.hit.toFixed(1)} u${pick.P.rub.toFixed(1)} o${pick.P.off.toFixed(1)} t${pick.P.sat.toFixed(1)} m${pick.P.term.toFixed(1)} x${pick.P.pass.toFixed(1)} c${(pick.P.chg - pick.P.keep).toFixed(1)}${pick.hitBy ? ' ' + JSON.stringify(pick.hitBy) : ''}`);
    }
    best.n = n; best.nc = cands.length;
    return best;
  }

  /** F: 지금 실제 앞차로 따라가기 속도 (같은 식) */
  function followSpeed(v, gap, Lf, vo, kB, g) {
    const gp = gap - Lf - (1 + 0.02 * v), b = PL.fB * kB * g * aBrake(vo);
    return gp >= 0 ? Math.sqrt(vo * vo + 2 * b * gp) : Math.max(0, vo + gp * 2);
  }
  return { plan, followSpeed, curvAt };
}
