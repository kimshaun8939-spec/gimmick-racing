// 운전 도움 (설정 → 조향·도움). input.js가 조작 명령을 만든 뒤 여기서 살짝 고침 → main.js·car.js는 몰라도 됨
//   - 브레이크 도움: 레이싱 라인 속도 계획보다 너무 빠르게 코너에 다가가면 자동으로 브레이크 (봇과 같은 계산)
//   - 조향 도움: 레이싱 라인 쪽으로 핸들을 살짝 돌려 줌 (손을 떼면 더 많이, 직접 꺾으면 내 조향이 우선)
//   - 트랙션 컨트롤: 바퀴가 헛돌면(car.wheelspin) 가속 페달을 줄여 줌
//   window.game(main.js가 만듦)의 car·track을 봄. 자동 운전(controlsOverride)·비행·배 모드에서는 안 함
import { lineCarModel } from './car.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const LEVEL = { off: 0, light: 0.45, full: 0.85 };

let cache = null; // { car, cfgKey, prof, cm, vTop }
function plan(car, line) {
  if (cache && cache.car === car && cache.line === line && cache.cfg === car.cfg) return cache;
  const prof = car._lineProfile || line.profile(lineCarModel(car.cfg));
  const cm = lineCarModel(car.cfg);
  let vTop = 0;
  for (let i = 0; i < line.N; i++) vTop = Math.max(vTop, prof.speed[i]);
  cache = { car, line, cfg: car.cfg, prof, cm, vTop };
  return cache;
}

/**
 * c = input.read()가 만든 조작 명령 (바꿔서 돌려줌). opts = { brakeAssist, steerAssist, tcs }
 * 도움이 일했으면 c.assist = { brake, steer } (화면 표시용)
 */
export function applyAssists(c, opts) {
  const g = window.game;
  if (!g || !g.car || g.controlsOverride || g.paused) return c;
  const car = g.car, track = g.track;
  const ground = car.mode !== 'fly' && car.mode !== 'boat' && car.surface !== 'water';
  // 트랙션 컨트롤: 헛도는 만큼 페달을 뗌 (최소 35%)
  if (opts.tcs && ground && c.throttle > 0 && (car.wheelspin || 0) > 0.04) c.throttle *= clamp(1 - 1.5 * car.wheelspin, 0.35, 1);

  const bLv = LEVEL[opts.brakeAssist] || 0, sLv = LEVEL[opts.steerAssist] || 0;
  if ((!bLv && !sLv) || !ground) return c;
  const race = g.race;
  if (race && race.phase !== 'racing') return c;
  const line = track && track.racingLine, ti = car.trackInfo, S = track && track.samples;
  if (!line || !ti || !S || !S.length) return c;
  const N = line.N, ds = track.length / N, W = (i) => ((i % N) + N) % N;
  const i0 = W(ti.index);
  // 길에서 많이 벗어났으면(잔디 깊숙이·다른 길) 손대지 않음
  if (Math.abs(ti.lateral ?? 0) > track.width / 2 + 6) return c;
  const v = car.speed;
  const P = plan(car, line);

  // --- 브레이크 도움 ---
  if (bLv && v > 12) {
    const kB = 0.9;
    const reach = Math.round(Math.min(400, (v * v) / (2 * kB * P.cm.aBrake(30)) + 15) / ds);
    let tgt = Infinity;
    for (let q = 2; q <= reach; q += q < 10 ? 1 : 3) {
      const iq = W(i0 + q);
      const vq = P.prof.speed[iq] * (bLv > 0.6 ? 1.0 : 1.06); // 약하게 = 계획보다 6% 빨라도 그냥 둠
      const allow = Math.sqrt(vq * vq + 2 * kB * P.cm.aBrake(vq) * q * ds);
      if (allow < tgt) tgt = allow;
    }
    const over = v - tgt;
    if (over > 0.6) {
      const want = clamp(over / 4, 0, 1) * bLv;
      if (want > c.brake) {
        c.brake = want;
        c.throttle = Math.min(c.throttle, Math.max(0, 1 - want * 2));
        c.assist = { ...(c.assist || {}), brake: want };
      }
    }
  }

  // --- 조향 도움 (라인 따라가기) ---
  if (sLv && v > 4) {
    const look = Math.round((6 + Math.abs(v) * 0.35) / ds);
    const j = W(i0 + look);
    const s = S[j];
    if (s && s.pos && s.right) {
      const off = line.offset[j];
      const tx = s.pos.x + s.right.x * off, tz = s.pos.z + s.right.z * off;
      let dx = tx - car.pos.x, dz = tz - car.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const fx = car.fwd.x, fz = car.fwd.z, fl = Math.hypot(fx, fz) || 1;
      const cross = (fx * dz - fz * dx) / fl, dot = (fx * dx + fz * dz) / fl;
      if (dot > 0.2) {
        const jf = W(i0 + Math.round((v * 0.18) / ds));
        const auto = clamp((-line.curvature[jf] * v * v) / 24 + 2 * Math.atan2(cross, dot), -1, 1);
        const user = c.steer;
        // 직접 많이 꺾을수록 도움이 줄어듦 (반대로 꺾으면 거의 안 도움)
        const k = sLv * (1 - Math.min(1, Math.abs(user)) * 0.7) * (Math.sign(user) && Math.sign(user) !== Math.sign(auto) ? 0.4 : 1);
        c.steer = clamp(user + (auto - user) * k, -1, 1);
        c.assist = { ...(c.assist || {}), steer: Math.abs(c.steer - user) };
      }
    }
  }
  return c;
}
