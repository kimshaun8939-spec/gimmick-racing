// AI 봇 운전사: 레이싱 라인 + 속도 계획을 따라 달림 (진짜 차 물리 Car를 조작 명령으로만 움직임 → 사람과 같은 규칙)
//
//   조향: 앞 (6 + 속도×0.35) m 라인 점을 향하고, 조금 앞 라인의 곡률만큼 미리 꺾음 (.debug/lineLap.js와 같은 방법)
//   속도: 0.25초 앞 지점의 계획 속도 × 실력(pace). 넘으면 브레이크
//   추월: 앞차가 같은 줄에 있고 내가 더 빠르면 옆 줄(왼쪽/오른쪽 중 넓은 쪽)로 비켜서 지나감. 자리가 없으면 따라감
//   나란히: 옆에 붙은 차가 있으면 조금 떨어짐
//   실수: 가끔 코너에서 넓게 나가거나, 액셀을 잠깐 떼거나, 브레이크를 늦게 밟음 (쉬움일수록 자주)
//   부스터(E): 앞에 브레이크 구간이 없는 긴 직선에서 씀 (보통·어려움)
import { lineCarModel } from './car.js';

export const BOT_NAMES = ['레오', '미나', '카이', '루나', '준호', '사라', '토르', '하나', '제트', '노바'];

/** 실력 단계 (설정 botLevel) */
export const BOT_LEVELS = {
  easy: { pace: 0.84, paceVar: 0.02, react: [0.45, 0.8], noise: 0.05, mistakeEvery: 20, boost: 0.15, boostLook: 3.4, lead: 0.3 },
  normal: { pace: 0.95, paceVar: 0.015, react: [0.28, 0.5], noise: 0.025, mistakeEvery: 38, boost: 0.6, boostLook: 3, lead: 0.26 },
  hard: { pace: 1.06, paceVar: 0.008, react: [0.17, 0.3], noise: 0.012, mistakeEvery: 85, boost: 3, boostLook: 2.2, lead: 0.24 },
};

/** 같은 씨앗이면 같은 난수 (봇마다 다른 성격) */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const profiles = new Map(); // 차 종류마다 속도 계획 (한 번만 계산)
/** 그 차 성능으로 계산한 라인 속도 계획 */
export function profileFor(line, cfg) {
  const key = cfg.carId || 'base';
  if (!profiles.has(key)) profiles.set(key, line.profile(lineCarModel(cfg)));
  return profiles.get(key);
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * @param car   Car (봇 차)
 * @param track 트랙 (racingLine 필요)
 * @param prof  이 차의 속도 계획 (profileFor)
 * @param level BOT_LEVELS 중 하나
 * @param seed  성격 씨앗
 */
export function createBotDriver(car, track, prof, level, seed = 1) {
  const L = track.racingLine, N = L.N, ds = track.length / N, S = track.samples;
  const rand = rng(seed * 7919 + 13);
  const pace = level.pace + (rand() * 2 - 1) * level.paceVar;
  const cm = lineCarModel(car.cfg); // 제동력 계산용
  let vTop = 0;
  for (let i = 0; i < N; i++) vTop = Math.max(vTop, prof.speed[i]);
  const st = {
    lane: 0, // 지금 라인에서 옆으로 비킨 거리 (m, + 오른쪽)
    laneTarget: 0,
    laneHold: 0, // 추월 줄을 유지할 남은 시간
    react: level.react[0] + rand() * (level.react[1] - level.react[0]),
    phase: rand() * 10,
    mistake: null, mistakeT: 0, nextMistake: level.mistakeEvery * (0.4 + rand()),
    t: 0, boostCool: 2 + rand() * 4,
    paceMul: 1, // 바깥(raceSystem)이 고무줄 효과로 조절
    blockedT: 0, pushT: 0,
  };
  const W = (i) => ((i % N) + N) % N;

  /** 라인 지점 j에서 옆으로 lane만큼 비킨 목표 점 */
  function target(j, lane) {
    const s = S[j];
    const off = clamp(L.offset[j] + lane, L.lo[j] + 0.2, L.hi[j] - 0.2);
    return [s.pos.x + s.right.x * off, s.pos.z + s.right.z * off];
  }

  /**
   * 매 물리 스텝 조작 명령
   * ctx = { since: 출발 신호 뒤 시간, dt, me: { progM, lat }, others: [{ progM, lat, speed }], finished }
   */
  function controls(ctx) {
    const c = { throttle: 1, brake: 0, steer: 0, drift: false, climb: false, dive: false, booster: false, mode: null, shiftUp: false, shiftDown: false };
    const dt = ctx.dt;
    st.t += dt;
    const ti = car.trackInfo;
    if (!ti) return c;
    const i0 = ti.index % N;
    const v = Math.max(8, Math.abs(car.speed));
    const speed = car.speed;

    // --- 실수 ---
    if (!ctx.finished && ctx.since > 5) {
      st.nextMistake -= dt;
      if (st.nextMistake <= 0) {
        const r = rand();
        st.mistake = r < 0.4 ? 'wide' : r < 0.7 ? 'lift' : 'late';
        st.mistakeT = st.mistake === 'lift' ? 0.5 + rand() * 0.5 : 1.2 + rand();
        st.nextMistake = level.mistakeEvery * (0.5 + rand());
      }
    }
    if (st.mistake) {
      st.mistakeT -= dt;
      if (st.mistakeT <= 0) st.mistake = null;
    }

    // --- 차들 사이: 추월·따라가기·나란히 ---
    let follow = Infinity; // 앞차 때문에 줄여야 하는 속도
    let busy = false;
    const myLat = ti.lateral;
    for (const o of ctx.others) {
      const dM = o.progM - ctx.me.progM; // + = 앞
      const dLat = o.lat - myLat;
      const closing = speed - o.speed;
      // 얼마나 앞까지 볼지: 빨리 다가갈수록 멀리 (멈춘 차도 미리 피하게)
      const range = clamp(closing * 2.6, 40, 130);
      if (dM > -6 && dM < 6 && Math.abs(dLat) < 2.7) {
        // 나란히: 옆으로 조금 떨어짐
        const away = dLat > 0 ? -1 : 1;
        st.laneTarget = clamp(st.laneTarget + away * 9 * dt, -7, 7);
        st.laneHold = Math.max(st.laneHold, 0.8);
        busy = true;
        if (dM > 1.5 && Math.abs(dLat) < 1.9) follow = Math.min(follow, o.speed - 1); // 앞쪽 반쯤 겹침: 박지 않게
      } else if (dM >= 6 && dM < range && Math.abs(dLat) < 2.7) {
        if (closing > -0.5 || dM < 14) {
          // 추월할 줄: 앞차 왼쪽/오른쪽 3.2 m (그 차가 있는 지점의 라인 한계 lo~hi 안), 지금 나랑 가까운 쪽
          const io = W(i0 + Math.round(dM / ds));
          const cand = [o.lat - 3.2, o.lat + 3.2]
            .filter((lat) => lat > L.lo[io] + 0.2 && lat < L.hi[io] - 0.2)
            .map((lat) => ({ lat, lane: lat - L.offset[io] }));
          if (cand.length) {
            cand.sort((a, b) => Math.abs(a.lat - myLat) - Math.abs(b.lat - myLat));
            st.laneTarget = clamp(cand[0].lane, -9, 9);
            st.laneHold = 1.6;
            busy = true;
          }
          // 아직 겹쳐 있으면: 앞차 뒤 8 m에서 멈출 수 있는 속도까지만 (자리가 생기면 풀림)
          if (Math.abs(dLat) < 2.2) follow = Math.min(follow, o.speed + Math.sqrt(2 * 11 * Math.max(0, dM - 8)));
        }
      }
    }
    st.laneHold -= dt;
    if (!busy && st.laneHold <= 0) st.laneTarget += (0 - st.laneTarget) * Math.min(1, dt * 0.8); // 천천히 라인으로 돌아감
    st.lane += clamp(st.laneTarget - st.lane, -5.5 * dt, 5.5 * dt);
    let lane = st.lane;
    // 실수: 넓게 나감 (코너 바깥쪽 = 곡률 반대쪽)
    if (st.mistake === 'wide') lane += -Math.sign(L.curvature[W(i0 + Math.round(30 / ds))] || 1) * 2.4;

    // --- 조향 ---
    const look = Math.round((6 + v * 0.35) / ds);
    const j = W(i0 + look);
    const [tx, tz] = target(j, lane);
    let dx = tx - car.pos.x, dz = tz - car.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const fx = car.fwd.x, fz = car.fwd.z, fl = Math.hypot(fx, fz) || 1;
    const cross = (fx * dz - fz * dx) / fl, dot = (fx * dx + fz * dz) / fl;
    const jf = W(i0 + Math.round((v * 0.18) / ds));
    const ff = (-L.curvature[jf] * v * v) / 24;
    const noise = level.noise * (Math.sin(st.t * 1.7 + st.phase) + 0.5 * Math.sin(st.t * 4.3 + st.phase * 2));
    c.steer = clamp(ff + 2 * Math.atan2(cross, dot) + noise, -1, 1);

    // --- 속도 ---
    const leadT = st.mistake === 'late' ? level.lead * 0.35 : level.lead;
    const lead = W(i0 + Math.round((v * leadT) / ds));
    const k = pace * st.paceMul * (ctx.finished ? 0.72 : 1) * (Math.abs(lane) > 1.5 ? 0.985 : 1);
    // 목표 속도: 앞쪽 지점들의 계획 속도 × 실력에서, 거기까지 브레이크로 줄일 수 있는 속도 (계획보다 빠를 때도 제때 제동)
    //   부스터 중에는 직선(계획이 최고 속도) 지점은 제한 없음 → 직선에서 부스터를 브레이크로 끄지 않음
    const boosting = car.form === 'spike';
    const kB = 0.95 * Math.min(1, k);
    const reach = Math.round(Math.min(400, (speed * speed) / (2 * kB * cm.aBrake(30)) + 10) / ds);
    let tgt = Infinity;
    for (let q = 0; q <= reach; q += q < 8 ? 1 : 3) {
      const iq = W(lead + q);
      const free = boosting && prof.speed[iq] >= vTop * 0.97 && !prof.brake[iq];
      if (free) continue;
      const vq = prof.speed[iq] * k;
      const allow = Math.sqrt(vq * vq + 2 * kB * cm.aBrake(vq) * q * ds);
      if (allow < tgt) tgt = allow;
    }
    // 앞이 막혀 2초 넘게 거의 멈춰 있으면: 1.5초 동안은 앞차를 신경 쓰지 않고 밀고 나감 (영원히 기다리지 않게)
    if (follow < 3 && Math.abs(speed) < 3 && ctx.since > 1) st.blockedT += dt;
    else st.blockedT = Math.max(0, st.blockedT - dt);
    if (st.blockedT > 2) {
      st.pushT = 1.5;
      st.blockedT = 0;
    }
    if (st.pushT > 0) st.pushT -= dt;
    else tgt = Math.min(tgt, follow);
    if (speed > tgt + 0.4) {
      c.throttle = 0;
      c.brake = clamp((speed - tgt) / 3, 0, 1);
    }
    if (st.mistake === 'lift') c.throttle = Math.min(c.throttle, 0.35);
    st.dbg = { follow, tgt, lane: st.lane, laneT: st.laneTarget };

    // 출발: 불이 꺼진 뒤 반응 시간만큼 기다림
    if (ctx.since < st.react) {
      c.throttle = 0;
      c.brake = 0;
    }

    // --- 부스터: 앞 (3초 × 속도) 안에 브레이크 구간이 없으면 ---
    st.boostCool -= dt;
    if (!ctx.finished && level.boost > 0 && st.boostCool <= 0 && car.form !== 'spike' && car.grounded && car.mode !== 'boat' && car.mode !== 'fly' && speed > 25 && !st.mistake) {
      // 앞 (속도 × level.boostLook초) 안에 브레이크 구간이 없으면
      const span = Math.round((Math.max(speed, 40) * (level.boostLook || 3)) / ds);
      let clear = true;
      for (let q = 0; q < span && clear; q += 3) if (prof.brake[W(i0 + q)] || prof.speed[W(i0 + q)] < vTop * 0.75) clear = false;
      if (clear && rand() < level.boost * dt * 2) {
        c.booster = true;
        st.boostCool = 3.5 + rand() * 3;
      }
    }
    return c;
  }

  return {
    controls,
    state: st,
    pace,
    /** 복귀(리스폰) 뒤: 줄·실수 초기화 */
    reset() {
      st.lane = st.laneTarget = 0;
      st.mistake = null;
    },
  };
}

/**
 * 봇이 탈 차 고르기: 플레이어 차와 같은 등급(class) 차들 중에서 (없으면 전체). 같은 차가 겹치면 색을 조금 바꿈
 * @returns [{ id, look }]
 */
export function pickBotCars(roster, playerCarId, count, seed = 1) {
  const cars = roster.cars || [];
  const me = cars.find((c) => c.id === playerCarId);
  let pool = me && me.class ? cars.filter((c) => c.class === me.class) : cars.slice();
  if (pool.length < 2) pool = cars.slice();
  const rand = rng(seed);
  // 섞기
  pool = pool.slice().sort(() => rand() - 0.5);
  const out = [];
  const used = {};
  for (let i = 0; i < count; i++) {
    const c = pool[i % pool.length];
    used[c.id] = (used[c.id] || 0) + 1;
    let look = JSON.parse(JSON.stringify(c.look || { style: 'f1', body: '#e8463a' }));
    if (typeof look === 'string') look = { style: 'f1', body: look };
    // 같은 차가 두 번째부터는 색을 돌려서 구별 (플레이어 차와 같은 차도)
    const dup = used[c.id] - 1 + (c.id === playerCarId ? 1 : 0);
    if (dup > 0) look.body = shiftHue(look.body || '#e8463a', dup * 0.29);
    look.number = String(((seed + i * 7) % 89) + 2);
    out.push({ id: c.id, look, name: c.name });
  }
  return out;
}

function shiftHue(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (h + amount) % 1;
  s = Math.max(s, 0.55);
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  [r, g, b] = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  return '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
