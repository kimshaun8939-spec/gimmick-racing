// 이 코너에 브레이크가 정말 필요한가? (2026-11-13, 사용자 요청: "굳이 브레이크 안 밟고 가는 것이 빠른 구간에서 브레이크를 밟으라고 함")
//   지금 타는 차의 속도 계획(car._lineProfile = racingLine.profile(lineCarModel))은 '최대 브레이크'로 줄이는 계획이라
//   속도가 조금만 줄어도 '브레이크 구간'이 생김. 그런데 W만 떼도(엔진 브레이크 + 공기 저항) 그만큼 줄일 수 있으면 브레이크는 이득이 거의 없음.
//   → 같은 계획을 'W만 떼기(리프트)'의 감속으로 다시 계산해서, 코너마다 브레이크로 아끼는 시간(gain, 초)을 셈.
//   kind: 'brake' (브레이크가 확실히 이득, gain ≥ BRAKE_GAIN), 'lift' (W를 잠깐 떼면 됨(톡)), 'flat' (그대로 밟고 통과)
//   판단은 이 차 기준 (차를 바꾸면 cfg가 바뀌므로 그대로 따라감). 시험 `.debug/academy_test.js` brakeTable()

export const BRAKE_GAIN = 0.12; // 브레이크로 이만큼(초) 넘게 아끼면 '브레이크 코너'
export const LIFT_CORNER_DECEL = 1.2; // 코너에서 W를 뗄 때 타이어·구름 저항 보정 (m/s²)
export const LIFT_DROP = 1.5; // 계획 속도가 이만큼(m/s) 넘게 줄면 적어도 'W 떼기'

/** W를 뗐을 때 감속 (m/s², 엔진 브레이크 + 공기 저항 + 구름 저항). car.js updateGround와 같은 항목을 대략 (rpm은 레드라인의 75%로 봄) */
export function liftDecel(cfg) {
  const e = cfg.engine || {}, a = cfg.aero || {};
  const eb = (e.engineBrake ?? 3) * 0.75;
  // + 1.2 m/s²: 코너 들어가며 핸들을 꺾을 때 타이어가 긁히는 감속 + 구름 저항 (gp f1 실측: 꺾는 중 W 떼기 감속이 이 식보다 1~2.5 m/s² 큼, 2026-11-13)
  return (v) => eb + (a.drag || 0) * v * v + (a.rolling || 0) + LIFT_CORNER_DECEL;
}

/**
 * 속도 계획을 '리프트만'으로 다시 계산
 * @returns Float32Array 리프트 계획 속도 (계획 속도 이하)
 */
export function liftProfile(car, track) {
  const L = track.racingLine, N = L.N;
  const prof = car._lineProfile || (car.lineSpeed(0), car._lineProfile);
  const seg = L.seg || null, ds = track.length / N;
  const aL = liftDecel(car.cfg);
  const out = Float32Array.from(prof.speed);
  for (let lap = 0; lap < 2; lap++)
    for (let n = N - 1; n >= 0; n--) {
      const nx = (n + 1) % N, s = seg ? seg[n] : ds;
      out[n] = Math.min(out[n], Math.sqrt(out[nx] * out[nx] + 2 * aL(out[nx]) * s));
    }
  return out;
}

/**
 * 코너마다 브레이크 이득
 * @param corners car.cornerInfo.corners (k, apexI, brakeI, exitI …)
 * @returns Map(코너 → { gain 초, kind, vIn 계획 최고 km/h, vMin km/h, liftAt 리프트 계획에서 떼기 시작하는 지점 i })
 */
export function brakeNeeds(car, track, corners) {
  const L = track.racingLine, N = L.N;
  const prof = car._lineProfile || (car.lineSpeed(0), car._lineProfile);
  const seg = L.seg || null, ds = track.length / N;
  const lift = liftProfile(car, track);
  const W = (i) => ((i % N) + N) % N;
  const out = new Map();
  corners.forEach((c, k) => {
    const p = corners[(k - 1 + corners.length) % corners.length];
    // 앞 코너 에이펙스 → 이 코너 에이펙스 (이 코너로 들어가는 구간 전체)
    const from = p === c ? W(c.apexI - Math.round(500 / ds)) : p.apexI;
    let tPlan = 0, tLift = 0, vIn = 0, vMin = Infinity, liftAt = null;
    for (let i = from, n = 0; n < N && i !== c.apexI; i = W(i + 1), n++) {
      const s = seg ? seg[i] : ds;
      tPlan += s / Math.max(1, prof.speed[i]);
      tLift += s / Math.max(1, lift[i]);
      vIn = Math.max(vIn, prof.speed[i]);
      if (liftAt == null && lift[i] < prof.speed[i] - 0.3) liftAt = i;
    }
    for (let i = c.apexI, n = 0; n < Math.round(40 / ds); i = W(i + 1), n++) vMin = Math.min(vMin, prof.speed[i]);
    const gain = tLift - tPlan;
    const drop = vIn - vMin;
    const kind = gain >= BRAKE_GAIN ? 'brake' : drop > LIFT_DROP ? 'lift' : 'flat';
    out.set(c, { gain: +gain.toFixed(3), kind, vIn: Math.round(vIn * 3.6), vMin: Math.round(vMin * 3.6), drop: +drop.toFixed(1), liftAt });
  });
  return out;
}

/**
 * '똑똑한' 속도 계획: 브레이크가 확실히 이득인 코너는 원래 계획(최대 브레이크), 나머지 코너로 들어가는 구간은 리프트 계획
 *   → 시범 운전(tutorialDemo lineDriver)·라인 색(racingLineFx)·튜토리얼 라인 색 칩이 씀. 에이펙스 판정 등은 원래 계획(car._lineProfile) 그대로
 * @returns { speed: Float32Array, noBrake: Uint8Array (1 = 이 구간은 W만 떼기), needs: Map(코너 k → need) } 또는 null (코너 정보 없음)
 */
export function smartProfile(car, track) {
  const prof = car._lineProfile || (car.lineSpeed(0), car._lineProfile);
  if (car._smartProf && car._smartProf.src === prof && car._smartProf.cfg === car.cfg) return car._smartProf;
  const ci = car.cornerInfo;
  if (!ci || !ci.corners || !ci.corners.length || !track.racingLine) return null;
  const L = track.racingLine, N = L.N, ds = track.length / N;
  const W = (i) => ((i % N) + N) % N;
  const lift = liftProfile(car, track);
  const needs = brakeNeeds(car, track, ci.corners);
  const speed = Float32Array.from(prof.speed);
  const noBrake = new Uint8Array(N);
  ci.corners.forEach((c, k) => {
    const n = needs.get(c);
    if (!n || n.kind === 'brake') return;
    const p = ci.corners[(k - 1 + ci.corners.length) % ci.corners.length];
    const from = p === c ? W(c.apexI - Math.round(500 / ds)) : p.apexI;
    for (let i = from, m = 0; m < N && i !== c.apexI; i = W(i + 1), m++) {
      speed[i] = Math.min(speed[i], lift[i]);
      noBrake[i] = 1;
    }
  });
  const byK = new Map();
  ci.corners.forEach((c) => byK.set(c.k, needs.get(c)));
  car._smartProf = { src: prof, cfg: car.cfg, speed, noBrake, needs: byK };
  return car._smartProf;
}
/** 코너 k의 브레이크 필요 정보 (없으면 null) */
export function needOf(car, track, c) {
  const sp = c && smartProfile(car, track);
  return sp ? sp.needs.get(c.k) || null : null;
}

/** 안내용 목표 속도 (튜토리얼·아카데미 '목표 km/h' 칩): 똑똑한 계획이 있으면 그것, 없으면 원래 계획 */
export function coachSpeed(car, track, idx) {
  const sp = smartProfile(car, track);
  if (sp) return sp.speed[((idx % sp.speed.length) + sp.speed.length) % sp.speed.length];
  return car.lineSpeed(idx);
}
