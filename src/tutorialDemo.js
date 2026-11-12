// 튜토리얼 2 (2026-11-12): "시범 주행" + "따라 하기"
//
//   시범 주행: 자동 운전(레이싱 라인을 따라가는 운전사)이 플레이어 차로 코너 하나를 달리고,
//     중요한 순간(브레이크·핸들·에이펙스·가속)마다 슬로 모션(game.timeScale) + 큰 글자 + 지금 누르는 키를 보여 줌
//   따라 하기: 같은 자리에서 플레이어가 직접 달림 → 바깥 진입·브레이크 시점·에이펙스·탈출 가속을 재서 성적표
//
//   tutorial.js가 씀. 판정은 car.js의 에이펙스(apex/apexPerfect/apexMiss)·코너 탈출(corner, car.lastCornerInfo) 이벤트를 그대로 읽음
//   슬로 모션 = main.js의 game.timeScale (물리 시간만 늦춤, race.time은 물리 스텝마다 더하므로 기록 계산 그대로. 튜토리얼은 기록을 안 남김)
import { keybinds, codeLabel } from './keybinds.js';
import { pad } from './gamepad.js';
import { touchWanted } from './touch.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const kmh = (v) => Math.round(Math.abs(v) * 3.6);

// ------------------------------------------------------------------ 키 이름 (키보드 / 패드 / 터치)
const TOUCH_CAP = { throttle: ['▲', '가속 버튼'], brake: ['▼', '브레이크 버튼'], left: ['◀', '왼쪽 끌기'], right: ['▶', '오른쪽 끌기'] };
const NAME = { throttle: '가속', brake: '브레이크', left: '왼쪽', right: '오른쪽' };
const onTouch = () => !pad.usingPad() && touchWanted();
/** 키 글자: { main, alt, name } */
export function keyCap(id) {
  if (onTouch() && TOUCH_CAP[id]) return { main: TOUCH_CAP[id][0], alt: '', name: TOUCH_CAP[id][1] };
  if (pad.usingPad()) {
    if (id === 'left' || id === 'right') return { main: id === 'left' ? 'L◀' : 'L▶', alt: '', name: `스틱 ${NAME[id]}` };
    if (pad.get(id) != null) return { main: pad.label(id), alt: '', name: NAME[id] };
  }
  const ks = keybinds.keys(id);
  return { main: ks[0] ? codeLabel(ks[0]) : '?', alt: ks[1] ? codeLabel(ks[1]) : '', name: NAME[id] || id };
}
/** 글 속 키 (<kbd>) */
export const kbd = (id) => `<kbd class="td-k td-k-${id}">${esc(keyCap(id).main)}</kbd>`;

// ------------------------------------------------------------------ 자동 운전사 (시범용)
/**
 * 레이싱 라인을 따라가며 속도 계획대로 가속·제동 (.debug/lineLap.js를 다듬음: 앞을 짧게 보고 세게 붙어서 에이펙스·탈출이 깔끔함)
 * 그랑프리 T23에서 에이펙스(완벽)·좋은 탈출·깔끔한 코너까지 확인
 */
export function lineDriver(game, o = {}) {
  const car = game.car, tr = game.track, L = tr.racingLine, N = L.N, ds = tr.length / N;
  const prof = car._lineProfile || (car.lineSpeed(0), car._lineProfile);
  return () => {
    const c = { throttle: 1, brake: 0, steer: 0, drift: false, climb: false, dive: false, booster: false, mode: null, shiftUp: false, shiftDown: false };
    const i0 = (car.trackInfo ? car.trackInfo.index : tr.nearest(car.pos).index) % N;
    const v = Math.max(8, Math.abs(car.speed));
    const j = (i0 + Math.round((6 + v * (o.look ?? 0.12)) / ds)) % N;
    let dx = L.x[j] - car.pos.x, dz = L.z[j] - car.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const fx = car.fwd.x, fz = car.fwd.z, fl = Math.hypot(fx, fz) || 1;
    const cross = (fx * dz - fz * dx) / fl, dot = (fx * dx + fz * dz) / fl;
    const jf = (i0 + Math.round((v * 0.18) / ds)) % N;
    const ff = (-L.curvature[jf] * v * v) / (o.lat || 24);
    c.steer = clamp(ff + (o.fb ?? 3) * Math.atan2(cross, dot), -1, 1);
    const lead = (i0 + Math.round((v * 0.25) / ds)) % N;
    const target = prof.speed[lead];
    if (car.speed > target + 0.4) (c.throttle = 0), (c.brake = Math.min(1, (car.speed - target) / 3));
    return c;
  };
}

// ------------------------------------------------------------------ 코너 계획 (거리 = 연습 시작점 i0에서 앞으로 m)
/**
 * @param c car.cornerInfo의 코너
 * @param before 브레이크 지점 몇 m 앞에서 시작할지
 */
export function cornerPlan(game, c, before = 330) {
  const car = game.car, tr = game.track, L = tr.racingLine, N = L.N, ds = tr.length / N;
  const W = (i) => ((Math.round(i) % N) + N) % N;
  const i0 = W(c.brakeI - before / ds);
  const d = (i) => W(i - i0) * ds;
  const dB = d(c.brakeI), dA = d(c.apexI), dX = d(c.exitI);
  const vB = Math.max(20, c.vBrake);
  const hw = tr.halfWidthAt ? tr.halfWidthAt(c.apexI) : tr.width / 2;
  const P = {
    c, i0, dB, dA, dX, vB, vMin: c.vMin, hw, side: c.side, N, ds,
    turnKey: c.side > 0 ? 'right' : 'left',
    outKey: c.side > 0 ? 'left' : 'right',
    outName: c.side > 0 ? '왼쪽' : '오른쪽',
    inName: c.side > 0 ? '오른쪽' : '왼쪽',
    end: dX + 35,
    outLine: L.offset[c.brakeI] * c.side, // 브레이크 지점에서 레이싱 라인의 옆 위치 (+ = 안쪽)
    /** 지금 차가 시작점에서 몇 m (뒤쪽이면 음수) */
    dist(idx) {
      const m = W(idx - i0) * ds;
      return m > tr.length / 2 ? m - tr.length : m;
    },
  };
  const bEnd = dB + Math.max(8, 0.3 * (dA - dB));
  const gEnd = dA + Math.max(28, 0.6 * (dX - dA));
  // 순간들: [시작 m, 끝 m) · 시범 슬로 모션 배수 · 큰 글자
  P.moments = [
    { id: 'straight', a: -1e9, b: dB - 110, ts: 1, chip: '직선' },
    { id: 'approach', a: dB - 110, b: dB - 0.3 * vB, ts: 0.6, chip: '직선' },
    { id: 'brake', a: dB - 0.3 * vB, b: bEnd, ts: 0.3, freeze: 0.1, chip: '브레이크' },
    { id: 'turn', a: bEnd, b: dA - 10, ts: 0.3, chip: '핸들' },
    { id: 'apex', a: dA - 10, b: dA + 6, ts: 0.18, chip: '에이펙스' },
    { id: 'gas', a: dA + 6, b: gEnd, ts: 0.25, chip: '가속' },
    { id: 'out', a: gEnd, b: 1e9, ts: 1, chip: '탈출' },
  ];
  P.momentAt = (m) => P.moments.find((x) => m >= x.a && m < x.b) || P.moments[0];
  return P;
}

/** 순간마다 글자 (시범 = 설명, 따라 하기 = 짧은 신호) */
export function momentText(P, id, coach = false) {
  const T = kbd('throttle'), B = kbd('brake'), S = kbd(P.turnKey), O = kbd(P.outKey);
  if (coach) {
    return {
      straight: [`${T} 꾹 · 바깥(${P.outName})으로`, ''],
      approach: ['곧 브레이크…', '라인이 빨개지면'],
      brake: [`지금 ${B}!`, '곧게, 세게'],
      turn: [`${S} 꺾기`, `${B}는 서서히 떼요`],
      apex: ['안쪽에 붙기', `${P.inName} 연석`],
      gas: [`${T} 꾹!`, '핸들을 풀면서'],
      out: ['바깥으로 넓게', ''],
    }[id];
  }
  return {
    straight: [`직선에서는 ${T} 끝까지 꾹!`, `코너 <b>바깥쪽(${P.outName})</b>에 붙어서 달려요 ${O}`],
    approach: ['곧 코너!', '라인이 <b style="color:#ff6b5e">빨강</b>으로 바뀌는 곳 = 브레이크 지점'],
    brake: [`지금 브레이크! 코너 전 직선에서 ${B}`, '핸들은 곧게, 한 번에 세게 꾹'],
    turn: [`핸들 꺾기 ${S}`, `브레이크를 서서히 풀면서 ${P.inName}으로`],
    apex: ['에이펙스 — 안쪽에 붙기', `${P.inName} 연석(빨강·흰 줄)을 스쳐요`],
    gas: [`에이펙스를 지나면 가속 ${T}`, '핸들을 풀면서 끝까지 꾹'],
    out: ['바깥으로 넓게!', '탈출이 빠르면 다음 직선 전체가 빨라져요'],
  }[id];
}

// ------------------------------------------------------------------ 화면 (키 · 페달 막대 · 큰 글자 · 순간 띠)
export function createCoachUI(root) {
  const el = document.createElement('div');
  el.className = 'td';
  el.innerHTML = `
    <div class="td-vig"></div>
    <div class="td-top"><span class="td-badge"></span><div class="td-strip"></div><div class="td-slow"></div></div>
    <div class="td-cap"><div class="td-t"></div><div class="td-s"></div></div>
    <div class="td-keys">
      <div class="td-key" data-k="throttle"><b></b><i></i><small></small></div>
      <div class="td-key" data-k="left"><b></b><i></i><small></small></div>
      <div class="td-key" data-k="brake"><b></b><i></i><small></small></div>
      <div class="td-key" data-k="right"><b></b><i></i><small></small></div>
    </div>
    <div class="td-ped"><div class="td-bars"><div class="td-bar thr"><b></b><span>액셀</span></div><div class="td-bar brk"><b></b><span>브레이크</span></div></div>
      <div class="td-spd"><b>0</b><small>km/h</small></div><div class="td-tgt"></div></div>
    <div class="td-btns"></div>`;
  root.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const keyEls = Object.fromEntries([...el.querySelectorAll('.td-key')].map((k) => [k.dataset.k, k]));
  let lastCap = '', lastStrip = '', capT = 0;
  const hold = { throttle: 0, brake: 0, left: 0, right: 0 };
  const ui = {
    el,
    show(mode) {
      el.className = `td on ${mode || ''}`;
      ui.labels();
    },
    hide() {
      el.className = 'td';
      lastCap = '';
    },
    /** 키 글자를 지금 조작 장치에 맞게 */
    labels() {
      for (const id in keyEls) {
        const k = keyCap(id);
        keyEls[id].querySelector('b').textContent = k.main;
        keyEls[id].querySelector('i').textContent = k.alt;
        keyEls[id].querySelector('small').textContent = k.name;
      }
    },
    badge(html) {
      $('.td-badge').innerHTML = html;
    },
    /** 순간 띠: 직선 › 브레이크 › 핸들 › 에이펙스 › 가속 */
    strip(cur) {
      const ids = ['straight', 'brake', 'turn', 'apex', 'gas', 'out'];
      const names = { straight: '직선', brake: '브레이크', turn: '핸들', apex: '에이펙스', gas: '가속', out: '탈출' };
      const c = cur === 'approach' ? 'straight' : cur;
      const ci = ids.indexOf(c);
      const h = ids.map((x, j) => `<span class="${j < ci ? 'past' : j === ci ? 'cur' : ''}">${names[x]}</span>`).join('<i>›</i>');
      if (h !== lastStrip) $('.td-strip').innerHTML = lastStrip = h;
    },
    clearStrip() {
      $('.td-strip').innerHTML = lastStrip = '';
    },
    caption(title, sub, tone = '') {
      const key = title + '|' + sub + '|' + tone;
      if (key === lastCap) return;
      lastCap = key;
      const cap = $('.td-cap');
      $('.td-t').innerHTML = title || '';
      $('.td-s').innerHTML = sub || '';
      cap.className = `td-cap ${tone}${title ? ' on' : ''}`;
      void cap.offsetWidth;
      cap.classList.add('pop');
      capT = performance.now();
    },
    slow(ts) {
      const s = $('.td-slow');
      const on = ts < 0.95;
      s.textContent = on ? `🐢 슬로 모션 ${ts < 0.14 ? '· 잠깐 멈춤' : `${ts.toFixed(2).replace(/0$/, '')}×`}` : '';
      s.classList.toggle('on', on);
      $('.td-vig').style.opacity = on ? String(clamp((1 - ts) * 0.9, 0, 0.8)) : '0';
    },
    /** 키 불 켜기 (페달·핸들 값 0~1, -1~1) */
    keys(thr, brk, steer, dt = 1 / 60, steerTh = 0.15) {
      const want = { throttle: thr > 0.15, brake: brk > 0.12, left: steer < -steerTh, right: steer > steerTh };
      for (const id in hold) {
        // 깜빡임 방지: 켜지면 0.15초는 켜 둠
        if (want[id]) hold[id] = 0.15;
        else hold[id] = Math.max(0, hold[id] - dt);
        const on = hold[id] > 0;
        const ke = keyEls[id];
        if (ke.classList.contains('on') !== on) ke.classList.toggle('on', on);
        const amt = id === 'throttle' ? thr : id === 'brake' ? brk : Math.abs(steer);
        ke.style.setProperty('--a', clamp(amt, 0, 1).toFixed(2));
      }
    },
    /** 다음에 누를 키를 깜빡여 알려 줌 (따라 하기) */
    cue(id) {
      for (const k in keyEls) keyEls[k].classList.toggle('cue', k === id);
    },
    pedals(thr, brk, v, target) {
      $('.td-bar.thr b').style.height = `${Math.round(clamp(thr, 0, 1) * 100)}%`;
      $('.td-bar.brk b').style.height = `${Math.round(clamp(brk, 0, 1) * 100)}%`;
      $('.td-spd b').textContent = kmh(v);
      const t = $('.td-tgt');
      if (target != null) {
        const over = Math.abs(v) - target;
        t.innerHTML = `목표 <b>${kmh(target)}</b>`;
        t.className = `td-tgt ${over > 3.5 ? 'red' : over > 0.8 ? 'yel' : 'grn'}`;
      } else t.innerHTML = '';
    },
    buttons(html) {
      $('.td-btns').innerHTML = html;
    },
  };
  return ui;
}

// ------------------------------------------------------------------ 시범 주행 진행
/**
 * 매 프레임 update(realDt) → 'done'이면 끝
 *   차 위치(물리 거리)로 순간을 고르고, 순간마다 슬로 모션 배수로 부드럽게 바꿈
 */
export function createDemo(game, P, ui, place) {
  const car = game.car;
  let ts = 1, cur = null, freezeT = 0, age = 0, endT = 0;
  const drive = lineDriver(game);
  let lastCtl = null;
  return {
    start() {
      place();
      // '지금 브레이크!' 글자가 뜨면 바로 브레이크 (예전엔 계획 지점까지 0.3초 동안 W가 켜진 채라 글자와 키가 어긋나 보였음)
      game.controlsOverride = () => {
        const c = drive();
        if (cur && cur.id === 'brake' && car.speed > P.vMin + 1) (c.throttle = 0), (c.brake = Math.max(c.brake, 0.9));
        return (lastCtl = c);
      };
      game.timeScale = ts = 1;
      cur = null;
      age = 0;
      endT = 0;
      ui.show('demo');
      ui.badge(`🎬 시범 주행 · T${P.c.num}`);
      ui.cue(null);
    },
    stop() {
      if (game.controlsOverride) game.controlsOverride = null;
      game.timeScale = 1;
    },
    get moment() {
      return cur && cur.id;
    },
    update(dt) {
      age += dt;
      const idx = car.trackInfo ? car.trackInfo.index % P.N : P.i0;
      const m = age < 0.3 ? 0 : P.dist(idx);
      const mo = P.momentAt(m);
      if (!cur || mo.id !== cur.id) {
        cur = mo;
        freezeT = mo.freeze ? 0.9 : 0; // 브레이크 순간은 처음 0.9초 거의 멈춤
        const [t, s] = momentText(P, mo.id);
        ui.caption(t, s, mo.id);
        ui.strip(mo.id);
      }
      let want = cur.ts;
      if (freezeT > 0) (freezeT -= dt), (want = cur.freeze);
      ts += (want - ts) * Math.min(1, dt * (want < ts ? 10 : 5));
      game.timeScale = ts;
      ui.slow(ts);
      // 키 그림은 지금 누르는 키(명령) 기준: 차의 페달 값은 천천히 바뀌어서 '지금 브레이크!'에도 W가 잠깐 켜져 보였음
      ui.keys(lastCtl ? lastCtl.throttle : car.thr, lastCtl ? lastCtl.brake : car.brk, lastCtl ? lastCtl.steer : car.steerIn, dt, 0.2); // 깜빡임 방지 시간은 실제 시간 (슬로 모션 0.1×에서 W가 1.5초 남아 있었음)
      ui.pedals(car.thr, car.brk, car.speed, car.lineSpeed(idx));
      if (m > P.end) {
        endT += dt;
        if (endT > 0.6) return 'done';
      }
      return null;
    },
  };
}

// ------------------------------------------------------------------ 따라 하기 판정
/**
 * 플레이어가 같은 코너를 달리는 동안 기록 → result()로 성적표
 *   바깥 진입: 브레이크 순간(계획)에 코너 바깥쪽 절반에 있었나
 *   브레이크: "지금 속도가 계획 속도를 넘는 순간"(라인이 빨개지는 순간)과 실제로 S를 밟은 순간의 차이 (초)
 *   에이펙스: car.js 에이펙스 판정 (못 맞히면 안쪽까지 몇 m 모자랐는지)
 *   가속: car.js 코너 탈출 판정(좋은 탈출) + 에이펙스 뒤 몇 초 만에 액셀을 꾹 밟았는지
 */
export function createDrill(game, P) {
  const car = game.car, k = car.cfg.kerb || {}, ck = car.cfg.corner || {};
  const R = {
    outLat: null, needD: null, needV: 0, brakeD: null, brakeV: 0, minV: Infinity, apex: null, apexBest: -Infinity, apexV: 0,
    passApexT: null, gasDelay: null, corner: null, offT: 0, respawn: false, t: 0, slow: false,
  };
  const prof = car._lineProfile || (car.lineSpeed(0), car._lineProfile);
  return {
    R,
    /** 매 프레임 (seen = 이번 프레임 차 이벤트) → 'end'면 끝 */
    step(dt, seen) {
      R.t += dt;
      if (!car.trackInfo) return null;
      const idx = car.trackInfo.index % P.N;
      const m = P.dist(idx);
      const v = Math.abs(car.speed);
      if (seen.includes('respawn') || seen.includes('fall')) {
        R.respawn = true;
        return 'end';
      }
      if (m < -50) return null;
      const lat = car.trackInfo.lateral * P.side; // + = 안쪽
      // 바깥 진입: 계획 브레이크 순간 (또는 내가 먼저 밟은 순간)의 옆 위치
      if (R.outLat == null && (m >= P.dB - 0.3 * P.vB || (R.brakeD != null && m > P.dB - 200))) R.outLat = lat;
      // 계획 속도를 넘는 순간 = 브레이크를 시작해야 하는 순간
      if (R.needD == null && m > P.dB - 260 && m < P.dA && v > prof.speed[(idx + Math.round((v * 0.25) / P.ds)) % P.N] + 0.3) (R.needD = m), (R.needV = v); // 0.25초 앞 계획 속도보다 빠름 = 라인이 빨개지는 순간
      if (R.brakeD == null && m > P.dB - 260 && m < P.dA && car.brk > 0.45 && car.forwardSpeed > 5) (R.brakeD = m), (R.brakeV = v);
      if (m > P.dB && m < P.dX) R.minV = Math.min(R.minV, v);
      if (m > P.dB - 20 && m < P.dX + 10 && car.offK > 0.6) R.offT += dt;
      // 에이펙스
      if (Math.abs(m - P.dA) < 8 && lat > R.apexBest) (R.apexBest = lat), (R.apexV = v);
      for (const e of seen) {
        if ((e === 'apex' || e === 'apexPerfect') && m > P.dB - 10 && m < P.dX + 20 && !R.apex) R.apex = e;
        if (e === 'corner' && car.lastCornerInfo && car.lastCornerInfo.k === P.c.k) R.corner = { ...car.lastCornerInfo };
      }
      // 에이펙스 뒤 액셀까지 걸린 시간
      if (m >= P.dA && R.passApexT == null) R.passApexT = R.t;
      if (R.passApexT != null && R.gasDelay == null && car.thr >= 0.8) R.gasDelay = R.t - R.passApexT;
      if (m > P.end) return 'end';
      return null;
    },
    /** 성적표: rows [{ id, ok: 'ok'|'meh'|'bad', title, text }], score, pass */
    result() {
      const rows = [];
      const t2 = (x) => Math.abs(x).toFixed(1);
      // 1) 바깥 진입: 레이싱 라인만큼 바깥이면 OK (S자 사이처럼 라인이 가운데로 지나는 곳도 있어서 라인 기준, 바깥 끝 기준 둘 중 쉬운 쪽)
      {
        const o = R.outLat, want = Math.max(P.outLine, -P.hw * 0.25);
        const title = '바깥에서 들어가기';
        if (o == null) rows.push({ id: 'out', ok: 'bad', title, text: '코너까지 못 갔어요' });
        else if (o <= want + 1.5) rows.push({ id: 'out', ok: 'ok', title, text: `좋아요! 코너 전에 ${P.outName}에 붙었어요` });
        else if (o <= want + 4) rows.push({ id: 'out', ok: 'meh', title, text: `조금 안쪽이었어요. 코너 전엔 더 ${P.outName}으로 붙어요` });
        else rows.push({ id: 'out', ok: 'bad', title, text: `안쪽(${P.inName})에서 들어갔어요. 코너 전엔 ${P.outName}으로!` });
      }
      // 2) 브레이크 시점
      {
        const title = '브레이크 시점';
        if (R.brakeD == null) {
          if (R.needD == null) rows.push({ id: 'brake', ok: 'meh', title, text: '속도가 느려서 브레이크가 필요 없었어요. 직선에서 더 밟아도 돼요' });
          else rows.push({ id: 'brake', ok: 'bad', title, text: `브레이크를 안 밟았어요. 라인이 빨개지면 ${kbd('brake')} 꾹!` });
        } else {
          const ref = R.needD != null ? R.needD : P.dB; // 계획 속도를 넘은 적이 없으면 계획 브레이크 지점과 비교
          const vv = Math.max(15, (R.brakeV + (R.needV || R.brakeV)) / 2);
          const e = (R.brakeD - ref) / vv; // + = 늦음 (초)
          if (e > 0.25) rows.push({ id: 'brake', ok: e > 0.6 ? 'bad' : 'meh', title, text: `브레이크가 ${t2(e)}초 늦었어요. 조금 더 일찍!`, err: e });
          else if (e < -0.7) rows.push({ id: 'brake', ok: 'meh', title, text: `${t2(e)}초 일찍 밟았어요. 조금 더 참아도 돼요`, err: e });
          else rows.push({ id: 'brake', ok: 'ok', title, text: `딱 좋아요! (${e >= 0 ? '+' : '−'}${t2(e)}초)`, err: e });
        }
        if (R.offT > 0.4) {
          const r = rows[rows.length - 1];
          r.ok = 'bad';
          r.text = `너무 빨리 들어가서 도로 밖으로 나갔어요. ${R.brakeD == null ? '브레이크를 꾹!' : '조금 더 일찍 · 세게'}`;
        }
      }
      // 3) 에이펙스
      {
        const title = '에이펙스 (안쪽에 붙기)';
        const need = P.hw - (k.apexReach ?? 1.6);
        if (R.apex) rows.push({ id: 'apex', ok: 'ok', title, text: R.apex === 'apexPerfect' ? '완벽한 에이펙스!' : '에이펙스 성공!' });
        else if (R.apexBest === -Infinity) rows.push({ id: 'apex', ok: 'bad', title, text: '에이펙스까지 못 갔어요' });
        else if (R.apexBest < need) rows.push({ id: 'apex', ok: R.apexBest > need - 1.5 ? 'meh' : 'bad', title, text: `안쪽 연석까지 ${(need - R.apexBest).toFixed(1)} m 모자라요. 더 ${P.inName}으로 붙어요` });
        else rows.push({ id: 'apex', ok: 'meh', title, text: '안쪽은 좋았는데 너무 느렸어요. 브레이크를 조금 덜' });
      }
      // 4) 탈출 가속
      {
        const title = '에이펙스 뒤 가속';
        const c = R.corner;
        const dl = R.gasDelay != null ? ` (에이펙스 뒤 ${R.gasDelay.toFixed(1)}초에 ${kbd('throttle')})` : '';
        if (c && c.goodExit) rows.push({ id: 'gas', ok: 'ok', title, text: `좋은 탈출!${dl}` });
        else if (!c) rows.push({ id: 'gas', ok: 'bad', title, text: R.respawn ? '길을 벗어났어요' : '코너를 끝까지 못 지났어요' });
        else {
          let why = '잔디에 닿았어요';
          if (c.noBrake === false) why = '에이펙스 뒤에 브레이크를 밟았어요';
          else if (c.thrAvg != null && c.thrAvg < (ck.exitThrottle ?? 0.75)) why = `에이펙스를 지나면 ${kbd('throttle')}를 더 일찍, 꾹`;
          else if (c.latErr != null && c.latErr > (ck.exitTol ?? 2.5)) why = '바깥쪽까지 넓게 나가요 (라인을 따라)';
          else if (c.ratio != null && c.ratio < (ck.exitSpeedRatio ?? 0.8)) why = '너무 느려요. 브레이크를 조금 덜';
          rows.push({ id: 'gas', ok: c.thrAvg >= 0.6 && c.noBrake ? 'meh' : 'bad', title, text: why + dl });
        }
      }
      const score = rows.reduce((a, r) => a + (r.ok === 'ok' ? 1 : r.ok === 'meh' ? 0.5 : 0), 0);
      const clean = !!(R.corner && R.corner.clean);
      return { rows, score, clean, pass: !R.respawn && score >= 2.5, respawn: R.respawn, slow: R.slow };
    },
  };
}
