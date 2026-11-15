// 차 능력치 계산 (2026-11-15, 부품 조립 1차 ①): 조립 전/후 100점 능력치·예상 수치 (조립 화면 막대의 +/−)
//   계산은 홈 차 고르기의 cars.json stats(score100·metrics)를 만든 .debug/night-ui-stats.mjs와 같은 식
//   → 순정 차는 cars.json 값과 똑같이 나옴 (.debug/parts_test.mjs가 확인)
//   100점 = 21대 순정 차 중 가장 낮은 값 20점 ~ 가장 높은 값 99점 (조립하면 이 범위를 조금 넘을 수 있음 → 0~100으로 자름)
//   부품의 토크 기울이기·터보 랙처럼 간단한 식에 안 보이는 것은 '자세한 식'(D)으로 순정 대비 비율을 재서 곱함
//   주의: 예상 값이지 실제 랩 기록이 아님 (실제는 .debug/parts_balance.js)
import { listCars, stockCarConfig } from './carRoster.js';
import { applyBuild } from './parts.js';

/** 능력치 8개 [키, 이름, 단위 설명] — 홈 차 고르기 막대와 같은 키 */
export const STAT_KEYS = [
  ['speed', '최고 속도'],
  ['accel', '가속'],
  ['handling', '핸들링'],
  ['grip', '접지력'],
  ['brake', '제동'],
  ['drift', '드리프트'],
  ['offroad', '험한 길'],
  ['boat', '배'],
];
/** 예상 수치 [키, 이름, 단위, 클수록 좋음?] */
export const METRIC_KEYS = [
  ['topKmh', '최고 속도', 'km/h', true],
  ['zero100Sec', '0→100', '초', false],
  ['zero150Sec', '0→150', '초', false],
  ['lateral150', '150 km/h 코너 힘', 'm/s²', true],
  ['downforce', '누르는 힘', '', true],
  ['brake100M', '100→0 제동 거리', 'm', false],
  ['offroadKeep', '잔디 속도 유지', '%', true],
  ['boatKmh', '배 최고 속도', 'km/h', true],
  ['shiftSec', '변속 시간', '초', false],
  ['turboLag', '터보 늦음', '초', false],
];

/**
 * 레이싱 라인 속도 계획용 차 성능 — src/car.js lineCarModel 복사 (car.js는 Three.js를 불러와서 홈·Node에서 가볍게 쓰려고 복사함)
 *   car.js의 lineCarModel을 바꾸면 여기도 같이 (.debug/parts_test.mjs가 두 식이 같은지 확인)
 */
export function lineModel(cfg) {
  const df = (v) => cfg.aero.downforce * Math.min(1.6, (v / cfg.maxSpeed) ** 2);
  const A = cfg.modes && cfg.modes.accel;
  const autoV = A && A.autoSpeed && !cfg.modes.manualSelect ? A.autoSpeed / 3.6 : Infinity;
  const hi = (v) => v >= autoV;
  return {
    vMax: autoV < Infinity ? cfg.maxSpeed * A.speedFactor : cfg.maxSpeed,
    aLat: (v) => 0.94 * (hi(v) ? A.gripFactor : 1) * Math.min(cfg.steerLat * (1 + (cfg.steerLatDownforce || 0) * df(v)), cfg.tire.lateral * (1 + df(v))),
    aAcc: (v) => {
      const gears = hi(v) ? cfg.gears.map((g) => g * A.gearFactor) : cfg.gears;
      const G = gears.find((g) => g >= v * 1.06) ?? gears[gears.length - 1];
      const eng = (cfg.engine.power * 0.9 * (hi(v) ? A.powerFactor : 1)) / G - cfg.aero.drag * v * v - cfg.aero.rolling;
      const drvK = cfg.drivetrain === 'awd' ? cfg.tire.awdTraction ?? 1.12 : cfg.drivetrain === 'fwd' ? 0.9 : 1;
      return Math.max(0.4, Math.min(cfg.tire.traction * drvK * (1 + df(v)) * (hi(v) ? A.gripFactor : 1), eng));
    },
    bankGrip: cfg.bankGrip || 0,
    boat: cfg.modes && cfg.modes.boat ? (() => {
      const b = cfg.modes.boat;
      return {
        vMax: Math.min(b.maxSpeed, Math.sqrt(Math.max(1, b.thrust - b.rolling) / b.drag)),
        aLat: (v) => Math.max(4, 0.5 * v * b.turnRate * (1 - 0.35 * Math.min(1, v / b.maxSpeed))),
        aAcc: (v) => Math.max(0.3, b.thrust - b.drag * v * v - b.rolling),
        aBrake: (v) => 0.85 * b.brake + b.drag * v * v + b.rolling,
      };
    })() : null,
    aBrake: (v) => 0.85 * Math.min(cfg.brake, cfg.tire.brakeGrip * (1 + df(v))) + cfg.aero.drag * v * v,
  };
}

function torqueAt(curve, rpm) {
  if (!Array.isArray(curve) || !curve.length) return 0.9;
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

/** 간단한 식 (S) = night-ui-stats.mjs 그대로 */
function simple(q) {
  const p = lineModel(q);
  let v = 0, t = 0;
  for (; v < 100 / 3.6 && t < 20; t += 0.002) v += p.aAcc(v) * 0.002;
  const G = q.gears.at(-1) * q.modes.accel.gearFactor;
  const top = Math.min(p.vMax, Math.sqrt(Math.max(0, (q.engine.power * 0.9 * q.modes.accel.powerFactor) / G - q.aero.rolling) / q.aero.drag));
  const d = q.drift;
  const raw = {
    speed: top * 3.6,
    accel: 1 / t,
    handling: q.steerRate * 0.45 + q.tire.yawResponse * 0.08 + q.input.steerRise * 0.2,
    grip: p.aLat(150 / 3.6),
    brake: p.aBrake(100 / 3.6),
    drift: (d.holdAngle[1] - d.holdAngle[0]) * d.baseTurn / d.grip * (1 + d.exitKeep),
    offroad: q.offroad.maxSpeedFactor * 0.7 + q.offroad.gripFactor * 0.3,
    boat: p.boat.vMax * 3.6,
  };
  const metrics = {
    topKmh: Math.round(top * 3.6),
    zero100Sec: +t.toFixed(2),
    lateral150: +raw.grip.toFixed(1),
    downforce: +q.aero.downforce.toFixed(2),
    brake100M: Math.round((100 / 3.6) ** 2 / (2 * raw.brake)),
    offroadKeep: Math.round(q.offroad.maxSpeedFactor * 100),
    boatKmh: Math.round(raw.boat),
  };
  return { raw, metrics, p };
}

/**
 * 자세한 식 (D): 토크 표(기울이기)·터보 랙·변속 시간을 넣은 직선 가속 → 0→100·0→150 시간, 최고 속도
 *   순정 차의 간단한 식 값에 'D(조립) / D(순정)' 비율을 곱하는 데만 씀
 */
function detailed(q) {
  const p = lineModel(q);
  const e = q.engine, A = q.modes.accel;
  const autoV = A.autoSpeed / 3.6;
  const tq = (rpm) => torqueAt(e.torque, rpm); // 순정 식의 '토크 약 0.9' 대신 실제 토크 표 (비율만 쓰므로 상수는 상관없음)
  let v = 0, t = 0, spool = e.turbo ? 0 : 1, gear = 0, shift = 0, t100 = 0, t150 = 0;
  const dt = 0.004;
  for (; t < 40 && (!t100 || !t150); t += dt) {
    const hi = v >= autoV;
    const gears = hi ? q.gears.map((g) => g * A.gearFactor) : q.gears;
    while (gear < gears.length - 1 && v >= gears[gear] * (e.autoUp ?? 0.96)) { gear++; shift = e.shiftTime ?? 0.16; }
    const G = gears[gear];
    const rpm = Math.max(e.idleRpm, (e.redline * v) / G, gear === 0 ? e.launchRpm : 0);
    if (e.turbo) {
      const tgt = Math.min(1, Math.max(0, (rpm - e.idleRpm) / (e.redline * 0.72 - e.idleRpm)));
      spool += (tgt - spool) * (1 - Math.exp(-dt / (tgt > spool ? e.turbo.lag : e.turbo.lag * 0.35)));
    }
    const turboK = e.turbo ? 1 - e.turbo.share * (1 - spool) : 1;
    let a;
    if (shift > 0) { shift -= dt; a = -(q.aero.drag * v * v + q.aero.rolling); }
    else {
      const df = q.aero.downforce * Math.min(1.6, (v / q.maxSpeed) ** 2);
      const drvK = q.drivetrain === 'awd' ? q.tire.awdTraction ?? 1.12 : q.drivetrain === 'fwd' ? 0.9 : 1;
      const eng = (e.power * tq(rpm) * turboK * (hi ? A.powerFactor : 1)) / G - q.aero.drag * v * v - q.aero.rolling;
      a = Math.max(0.4, Math.min(q.tire.traction * drvK * (1 + df) * (hi ? A.gripFactor : 1), eng));
    }
    v = Math.min(p.vMax, v + a * dt);
    if (!t100 && v >= 100 / 3.6) t100 = t;
    if (!t150 && v >= 150 / 3.6) t150 = t;
  }
  // 최고 속도: 마지막 기어 레드라인 근처(95%) 토크로
  const G = q.gears.at(-1) * A.gearFactor;
  const top = Math.min(p.vMax, Math.sqrt(Math.max(0, (e.power * tq(e.redline * 0.95) * A.powerFactor) / G - q.aero.rolling) / q.aero.drag));
  return { t100: t100 || 40, t150: t150 || 40, top };
}

let rangePromise = null;
const stockCache = new Map();
async function stockOf(carId) {
  if (!stockCache.has(carId)) stockCache.set(carId, stockCarConfig(carId));
  return stockCache.get(carId);
}
/** 21대 순정 차의 간단한 식 값 범위 { 키: [lo, hi] } (한 번만 계산) */
export function statRanges() {
  if (!rangePromise)
    rangePromise = (async () => {
      const cars = await listCars();
      const raws = await Promise.all(cars.map(async (c) => simple(await stockOf(c.id)).raw));
      const out = {};
      for (const [k] of STAT_KEYS) {
        const vals = raws.map((r) => r[k]);
        out[k] = [Math.min(...vals), Math.max(...vals)];
      }
      return out;
    })().catch((e) => ((rangePromise = null), Promise.reject(e)));
  return rangePromise;
}
function scoreOf(raw, ranges) {
  const out = {};
  for (const [k] of STAT_KEYS) {
    const [lo, hi] = ranges[k] || [0, 0];
    out[k] = hi === lo ? 50 : Math.max(0, Math.min(100, Math.round(20 + (79 * (raw[k] - lo)) / (hi - lo))));
  }
  return out;
}

/**
 * cfg(순정 stock과 조립 built) → { raw, score100, metrics }
 *   built가 stock과 같으면 cars.json stats와 같은 값
 */
export function statsFromConfigs(stock, built, ranges) {
  const S0 = simple(stock), S1 = built === stock ? S0 : simple(built);
  const raw = { ...S1.raw }, metrics = { ...S1.metrics };
  if (built !== stock) {
    const D0 = detailed(stock), D1 = detailed(built);
    // 속도·가속은 '순정 간단 값 × 자세한 식의 비율' (토크·터보·변속이 보이게, 순정이면 그대로)
    raw.speed = S0.raw.speed * (D1.top / D0.top);
    raw.accel = S0.raw.accel * (D0.t100 / D1.t100);
    metrics.topKmh = Math.round(raw.speed);
    metrics.zero100Sec = +(S0.metrics.zero100Sec * (D1.t100 / D0.t100)).toFixed(2);
    metrics.zero150Sec = +(D1.t150).toFixed(2);
  } else metrics.zero150Sec = +detailed(stock).t150.toFixed(2);
  metrics.shiftSec = +(built.engine.shiftTime ?? 0.16).toFixed(3);
  metrics.turboLag = built.engine.turbo ? +built.engine.turbo.lag.toFixed(2) : 0;
  return { raw, score100: ranges ? scoreOf(raw, ranges) : null, metrics };
}

/**
 * 한 차 + 조립의 능력치 (조립 화면용)
 *   → { carId, build, sig, stock: { score100, metrics, raw }, built: { ... }, diff: { score100: { 키: +n }, metrics: { 키: +n }, pct: { 키: 원래 값 대비 % } } }
 *   build: { 칸: 부품 id } | buildSig | null. 가진 부품인지는 안 봄 (미리 보기 가능)
 *   opts.levels (강화, 2026-11-15): 'mine' | { 부품 id: lv } | false — 없으면 sig 안 단계 → 조립 객체의 숨은 levels(getBuild) → Lv1 (upgrade-contract.md)
 *     {...build}로 펼친 객체는 숨은 levels가 사라지므로 내 단계를 보려면 { levels: 'mine' }
 */
export async function buildStats(carId, build, opts) {
  const [stock, ranges] = await Promise.all([stockOf(carId), statRanges()]);
  const built = applyBuild(stock, build, opts);
  const b = built.partsInfo.build;
  const s = statsFromConfigs(stock, stock, ranges);
  const r = statsFromConfigs(stock, built, ranges);
  const diff = { score100: {}, metrics: {}, pct: {} };
  for (const [k] of STAT_KEYS) {
    diff.score100[k] = r.score100[k] - s.score100[k];
    diff.pct[k] = s.raw[k] ? +((r.raw[k] / s.raw[k] - 1) * 100).toFixed(1) : 0;
  }
  for (const [k] of METRIC_KEYS) diff.metrics[k] = +((r.metrics[k] ?? 0) - (s.metrics[k] ?? 0)).toFixed(2);
  return { carId: stock.carId, build: b, sig: built.partsInfo.sig, levels: built.partsInfo.levels, stock: s, built: r, diff, partsInfo: built.partsInfo };
}
/** 순정 능력치만 (buildStats(carId, null).stock과 같음) */
export async function stockStats(carId) {
  const [stock, ranges] = await Promise.all([stockOf(carId), statRanges()]);
  return statsFromConfigs(stock, stock, ranges);
}
