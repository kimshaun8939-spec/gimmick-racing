// 장면 저장 (F8, 사용자 요청 2026-11-14 "봇이 이상한 장면을 녹화 대신 키 하나로 보내기")
//   레이스 중 항상 직전 20초를 기억해 둠: 모든 차(나 + 봇)의 위치·속도·페달·핸들·모드, 내가 누른 키,
//   봇 운전사가 낸 조작(액셀·브레이크·핸들)과 추월 판단 상태. F8을 누른 순간의 차·봇 상태 전체 스냅샷도 같이.
//   F8을 누르면 그 20초를 JSON 파일 하나로 내려받음 → 개발자가 .debug/scene_play.js로 분석·재현.
//   봇 코드(bots.js·raceSystem.js)는 건드리지 않음: 봇 운전 함수를 밖에서 감싸서 결과만 엿봄.
//   개인 정보(온라인 계정 열쇠·이름 등)는 담지 않음.

const SEC = 20; // 기억하는 시간 (초)
const HZ = 30; // 1초에 몇 번 기록
const MODES = ['normal', 'accel', 'boat', 'fly'];
const SKIP = new Set(['cfg', 'track', 'trackInfo', 'events', 'apexHits', 'cornerStart', 'apexWatch', 'lastApexInfo', 'lastCornerInfo', 'lastDriftInfo']);

const r3 = (x) => (typeof x === 'number' && isFinite(x) ? Math.round(x * 1000) / 1000 : 0);

/** 객체의 값 부분만 JSON으로 (숫자·글자·참거짓·벡터·작은 일반 객체). Map·Set·함수·three 객체는 뺌 */
export function snapValues(obj, skip = SKIP) {
  const out = {};
  if (!obj) return out;
  for (const k of Object.keys(obj)) {
    if (skip.has(k)) continue;
    const v = obj[k];
    const t = typeof v;
    if (v == null || t === 'number' || t === 'boolean' || t === 'string') { out[k] = t === 'number' && !isFinite(v) ? null : v; continue; }
    if (t !== 'object') continue;
    if (v.isVector3) { out[k] = { __v: [v.x, v.y, v.z] }; continue; }
    if (v.isQuaternion) { out[k] = { __q: [v.x, v.y, v.z, v.w] }; continue; }
    if (v instanceof Map || v instanceof Set || ArrayBuffer.isView(v) || v.isObject3D || v.isMaterial) continue;
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== Array.prototype) continue;
    if (Array.isArray(v) ? v.length > 64 : Object.keys(v).length > 40) continue; // 큰 것은 통째로 문자열을 만들면 멈칫함 (예전 1.8초)
    try {
      let bad = false; // 안에 벡터·three 객체가 있으면 되돌릴 때 모양이 깨지니 뺌 (car.trackInfo 등은 다음 스텝에 다시 계산됨)
      const s = JSON.stringify(v, (kk, vv) => {
        if (vv && typeof vv === 'object' && (vv.isVector3 || vv.isObject3D || vv.isQuaternion || vv instanceof Map || vv instanceof Set)) bad = true;
        return vv;
      });
      if (!bad && s && s.length < 4000) out[k] = JSON.parse(s);
    } catch {}
  }
  return out;
}

/** snapValues로 찍은 값을 다시 넣기 (재현 도구용). 벡터는 copy, 없는 키는 그대로 둠 */
export function restoreValues(obj, snap) {
  if (!obj || !snap) return;
  for (const k of Object.keys(snap)) {
    const v = snap[k];
    if (v && typeof v === 'object' && v.__v) {
      if (obj[k] && obj[k].isVector3) obj[k].set(v.__v[0], v.__v[1], v.__v[2]);
      continue;
    }
    if (v && typeof v === 'object' && v.__q) {
      if (obj[k] && obj[k].isQuaternion) obj[k].set(v.__q[0], v.__q[1], v.__q[2], v.__q[3]);
      continue;
    }
    if (typeof obj[k] === 'function') continue;
    if (v === null && typeof obj[k] === 'number') continue; // Infinity는 JSON에서 null이 됨 → 지금 값 그대로
    obj[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
}

/**
 * @param o { car, raceSys, race, hud, meta: { map, car, mode, carName } }
 */
export function createSceneSave(o) {
  const { car, raceSys, race, hud } = o;
  const frames = []; // { t, p: 내 조작, c: [차마다 숫자 배열], b: [봇마다 판단] }
  let lastCtl = null, nextT = 0, lastClock = -1;
  const wrapped = new WeakSet();

  // 봇 운전 함수 감싸기 (raceSystem이 매 스텝 b.driver.controls(...)를 부름 → 결과를 b.__ssCtl에 남김)
  function wrapBots() {
    for (const b of raceSys.bots) {
      const d = b.driver;
      if (!d || wrapped.has(d)) continue;
      const orig = d.controls;
      d.controls = function (ctx) {
        const c = orig.call(this, ctx);
        b.__ssCtl = c;
        return c;
      };
      wrapped.add(d);
    }
  }
  wrapBots();

  function carRow(c, ctl) {
    const ti = c.trackInfo;
    const flags = (c.grounded ? 1 : 0) + (c.drifting ? 2 : 0) + (c.offroad ? 4 : 0) + (c.flying ? 8 : 0) + (c.stalled ? 16 : 0);
    return [
      r3(c.pos.x), r3(c.pos.y), r3(c.pos.z), r3(c.vel.x), r3(c.vel.y), r3(c.vel.z), r3(c.fwd.x), r3(c.fwd.y), r3(c.fwd.z),
      r3(c.forwardSpeed ?? c.speed), ti ? r3(ti.t) : -1, ti ? r3(ti.lateral ?? ti.lat ?? 0) : 0,
      r3(c.thr), r3(c.brk), r3(c.steerIn), Math.max(0, MODES.indexOf(c.mode)), flags,
      r3(c.draft), r3(c.tow), r3(c.drs), r3(c.yawRate), r3(c.slip), c.gear | 0,
      ctl ? r3(ctl.throttle) : 0, ctl ? r3(ctl.brake) : 0, ctl ? r3(ctl.steer) : 0, ctl && ctl.drift ? 1 : 0,
    ];
  }
  function botBrief(b) {
    const st = (b.driver && b.driver.state) || {};
    const ot = st.overtake;
    const c = b.car;
    return {
      lt: r3(st.laneTarget), ln: r3(st.lane), lat: r3(b.lateral),
      ot: ot ? { k: ot.key, ph: ot.phase, kind: ot.kind, off: r3(ot.off), side: ot.side, sw: !!ot.switched } : null,
      ret: st.sideRetreat ? 1 : 0, hold: r3(st.laneHold),
      sc: c._sideContactAt != null ? r3((c.simT || 0) - c._sideContactAt) : null,
      cut: st.sc ? 1 : 0, fly: st.fly ? 1 : 0, calm: st.calm ? 1 : 0,
      fin: b.finished ? 1 : 0, rs: b.respawns | 0,
    };
  }

  /** 매 화면, 물리 전에: 이번 프레임 내 조작 */
  function input(ctl) {
    lastCtl = ctl ? { throttle: ctl.throttle || 0, brake: ctl.brake || 0, steer: ctl.steer || 0, drift: !!ctl.drift, climb: !!ctl.climb, dive: !!ctl.dive } : null;
  }

  /** 매 화면, 물리 뒤에 */
  function sample() {
    if (race.phase === 'countdown') return;
    const t = race.clock;
    if (t < lastClock - 0.5) { frames.length = 0; nextT = 0; } // 다시 시작
    lastClock = t;
    wrapBots();
    if (t < nextT) return;
    nextT = t + 1 / HZ;
    frames.push({
      t: r3(t),
      p: lastCtl ? [r3(lastCtl.throttle), r3(lastCtl.brake), r3(lastCtl.steer), lastCtl.drift ? 1 : 0, lastCtl.climb ? 1 : 0, lastCtl.dive ? 1 : 0] : null,
      c: [carRow(car, lastCtl), ...raceSys.bots.map((b) => carRow(b.car, b.__ssCtl))],
      b: raceSys.bots.map(botBrief),
    });
    while (frames.length && frames[0].t < t - SEC) frames.shift();
  }

  /** F8 누른 순간의 차·봇 상태 전체 (예전엔 1초마다 찍었는데 봇 7대에서 한 번에 약 2초가 걸려 게임이 주기적으로 멈췄음, 2026-11-14) */
  function snapshotNow() {
    const skipEntry = new Set(['car', 'driver', 'cfg', 'view', 'entry', '__ssCtl', 'model', 'proxy', 'tag', 'lod', 'marks', 'towInfo']);
    return {
      t: r3(race.clock),
      race: snapValues(race),
      player: { car: snapValues(car) },
      bots: raceSys.bots.map((b) => ({ car: snapValues(b.car), entry: snapValues(b, skipEntry), st: snapValues(b.driver && b.driver.state) })),
    };
  }
  function build(note = '') {
    const q = new URLSearchParams(location.search);
    const settings = (() => { try { return JSON.parse(localStorage.getItem('gimmick.settings') || '{}'); } catch { return {}; } })();
    const keep = {};
    for (const k of ['gimmick.paint', 'gimmick.costume', 'gimmick.costumes', 'gimmick.keyPreset']) {
      try { const v = localStorage.getItem(k); if (v && v.length < 4000) keep[k] = v; } catch {}
    }
    return {
      v: 1, kind: 'gimmick-scene', note, savedAt: new Date().toISOString(),
      url: q.toString(), meta: o.meta,
      level: raceSys.level, seed: raceSys.seed ?? null,
      bots: raceSys.bots.map((b, i) => ({ i, name: b.name, car: (b.cfg && b.cfg.carId) || null, carName: (b.cfg && b.cfg.carName) || null })),
      clock: r3(race.clock), phase: race.phase,
      settings, storage: keep,
      cols: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'fx', 'fy', 'fz', 'speed', 't', 'lat', 'thr', 'brk', 'steerIn', 'mode', 'flags(1땅 2드리프트 4잔디 8비행 16시동꺼짐)', 'draft', 'tow', 'drs', 'yawRate', 'slip', 'gear', 'ctlThrottle', 'ctlBrake', 'ctlSteer', 'ctlDrift'],
      cars: ['나', ...raceSys.bots.map((b) => b.name)],
      frames, keys: [snapshotNow()],
    };
  }

  /** F8: 파일로 내려받기 */
  function save(note = '') {
    if (!frames.length) {
      hud && hud.toast('📼 아직 저장할 장면이 없어요 (출발한 뒤에 눌러 주세요)');
      return null;
    }
    const data = build(note);
    const json = JSON.stringify(data);
    const m = Math.floor(race.clock / 60), s = Math.floor(race.clock % 60);
    const name = `장면_${(o.meta && o.meta.map) || 'map'}_${m}분${String(s).padStart(2, '0')}초.json`;
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.warn('장면 저장', e);
    }
    if (window.game) window.game.lastScene = data;
    hud && hud.toast(`📼 장면 저장! 다운로드 폴더 '${name}' (직전 ${Math.min(SEC, Math.round(race.clock))}초)`);
    return name;
  }

  return { input, sample, save, build, get frames() { return frames; } };
}
