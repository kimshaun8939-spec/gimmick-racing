// 게임패드 (Gamepad API). 표준 배치('standard': Xbox·PlayStation·스위치 프로 컨트롤러 등) 기준
//   - 게임 중: 왼쪽 스틱 = 조향(아날로그), RT/R2 = 가속, LT/L2 = 브레이크 (밟은 만큼). 나머지 버튼 = 행동 (조작키 화면의 "게임패드" 탭에서 바꿈)
//   - 메뉴(홈·Esc 메뉴·확인 창·대기실·튜토리얼 설명·결과 화면): 스틱/D-패드 = 화살표, A = Enter, B = Esc, LB/RB = 탭 넘기기
//     → 메뉴 코드는 그대로 두고 "키를 누른 것처럼" 키 이벤트를 보냄 (ev.gmPad = true 표시, input.js는 이 이벤트를 무시)
//   - 버튼 배치는 localStorage 'gimmick.pad' = { v:1, binds: { 행동: 버튼 번호 | null } }
//   - 브라우저는 패드 버튼을 한 번 눌러야 패드를 알려 줌 (보안 규칙) → "연결됨" 알림은 첫 버튼 때 뜸
import { ACTIONS, keybinds, actionVisible } from './keybinds.js';

const STORE = 'gimmick.pad';
// 표준 배치 버튼 번호: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 LS, 11 RS, 12 ↑, 13 ↓, 14 ←, 15 →, 16 Home
export const PAD_DEF = {
  throttle: 7, brake: 6, left: 14, right: 15, drift: 0, booster: 2, climb: 0, dive: 1,
  gearbox: 10, shiftUp: 5, shiftDown: 4, respawn: 3, restart: 8, menu: 9, racingLine: 12, sound: null, map: null,
};
const LOCKED = new Set(['menu']); // Menu(Start) 버튼 = 항상 메뉴
const MENU_BTN = 9;
const NAMES = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→', 'Home'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'PS'],
};
const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
const overlap = (a, b) => {
  const x = (a && a.ctx) || 'all', y = (b && b.ctx) || 'all';
  return x === 'all' || y === 'all' || x === y;
};
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ------------------------------------------------------------------ 버튼 배치 저장
function load() {
  const b = { ...PAD_DEF };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    for (const [id, v] of Object.entries(saved.binds || {})) {
      if (!(id in PAD_DEF) || LOCKED.has(id)) continue;
      b[id] = Number.isInteger(v) && v >= 0 && v < 17 && v !== MENU_BTN ? v : null;
    }
  } catch {}
  return b;
}
let binds = load();
const bindListeners = new Set();
function changed() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ v: 1, binds }));
  } catch {}
  for (const fn of bindListeners) fn(binds);
}
try {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE) return;
    binds = load();
    for (const fn of bindListeners) fn(binds);
  });
} catch {}

// ------------------------------------------------------------------ 패드 상태
let gpIndex = -1; // 쓰는 패드 (navigator.getGamepads()의 번호)
let gpId = '';
let style = 'xbox';
let prev = []; // 지난번 버튼 눌림
let axes = [0, 0, 0, 0];
let values = []; // 버튼 값 0~1
let lastPadUse = 0, lastKbUse = 0;
let lastPoll = 0;
let curMode = null; // 마지막으로 읽을 때의 화면 (held·analog가 매번 DOM을 찾지 않게)
let captureCb = null; // 버튼 정하기 창
const actionListeners = new Set();
let actionFilter = null; // (id) => false면 그 버튼 행동을 게임에 안 보냄 (튜토리얼이 씀)
const connListeners = new Set();
const navRep = { dir: null, t: 0 }; // 메뉴 이동 반복

/** 아날로그 설정 (input.js가 설정 값으로 채움) */
export const padConfig = { deadzone: 0.1, curve: 1.5, sens: 1, vibe: true };

const styleOf = (id) => (/054c|sony|dualshock|dualsense|playstation/i.test(id) || (/^wireless controller/i.test(id) && !/xbox|045e/i.test(id)) ? 'ps' : 'xbox');
function pickPad() {
  let list = [];
  try {
    list = navigator.getGamepads ? [...navigator.getGamepads()] : [];
  } catch {}
  let gp = gpIndex >= 0 ? list[gpIndex] : null;
  if (!gp || !gp.connected) {
    gp = list.find((g) => g && g.connected && g.mapping === 'standard') || list.find((g) => g && g.connected) || null;
  }
  return gp;
}

const pressedNow = (gp, i) => {
  const b = gp.buttons[i];
  return !!b && (b.pressed || b.value > 0.5);
};

/** 지금 어떤 화면인지: 'capture' | 'menu' | 'results' | null(게임) */
function screenMode() {
  const q = (s) => document.querySelector(s);
  if (q('.gm-pad-capture')) return 'capture';
  if (q('.gm-capture')) return 'capture'; // 키보드 키 정하기 창도 패드 이동은 쉼
  const home = q('#home');
  if (q('.gm-confirm') || q('#pauseMenu.on') || q('#lobby') || (home && !home.hidden)) return 'menu';
  const g = window.game;
  if (g && g.tutorial && g.tutorial.phase === 'card') return 'menu';
  if (q('#results.on')) return 'results';
  return null;
}

/** 키를 누른 것처럼 (메뉴 코드가 그대로 받게). 메뉴가 막았으면(preventDefault) true */
function sendKey(code, key = code) {
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : window;
  const mk = (type) => {
    const ev = new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true });
    ev.gmPad = true;
    return ev;
  };
  const down = mk('keydown');
  target.dispatchEvent(down);
  target.dispatchEvent(mk('keyup'));
  return down.defaultPrevented;
}

/** A 버튼 (메뉴): Enter를 보내고, 아무도 안 받았으면 초점이 있는 버튼을 누름 */
function menuConfirm() {
  const before = document.activeElement;
  const handled = sendKey('Enter');
  if (handled) return;
  const a = document.activeElement;
  if (a && a === before && a !== document.body && a.matches('button, a, [role="button"], .h-item, .h-start, [data-nav]')) a.click();
}

/** 결과 화면: 버튼끼리 이동 */
function resultsMove(dir) {
  const bs = [...document.querySelectorAll('#results.on button')].filter((b) => b.offsetParent !== null);
  if (!bs.length) return;
  const i = bs.indexOf(document.activeElement);
  const j = i < 0 ? 0 : clamp(i + (dir === 'left' || dir === 'up' ? -1 : 1), 0, bs.length - 1);
  bs[j].focus();
}

function navDir(gp) {
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  if (pressedNow(gp, 12) || ay < -0.6) return 'up';
  if (pressedNow(gp, 13) || ay > 0.6) return 'down';
  if (pressedNow(gp, 14) || ax < -0.6) return 'left';
  if (pressedNow(gp, 15) || ax > 0.6) return 'right';
  return null;
}
const ARROW = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** 패드 읽기 (rAF마다 + input.read()에서). 같은 프레임에 두 번 읽어도 버튼 눌림은 한 번만 */
export function pollPad() {
  const now = performance.now();
  if (now - lastPoll < 4) return;
  lastPoll = now;
  const gp = pickPad();
  if (!gp) {
    if (gpIndex >= 0) {
      gpIndex = -1;
      prev = [];
      values = [];
      axes = [0, 0, 0, 0];
      for (const fn of connListeners) fn(false);
    }
    return;
  }
  if (gp.index !== gpIndex || gp.id !== gpId) {
    gpIndex = gp.index;
    gpId = gp.id;
    style = styleOf(gp.id);
    prev = gp.buttons.map((_, i) => pressedNow(gp, i)); // 연결 순간 눌려 있던 버튼은 무시
    for (const fn of connListeners) fn(true);
  }
  axes = [...gp.axes];
  values = gp.buttons.map((b) => (b ? b.value || (b.pressed ? 1 : 0) : 0));
  const cur = gp.buttons.map((_, i) => pressedNow(gp, i));
  const edges = [];
  for (let i = 0; i < cur.length; i++) if (cur[i] && !prev[i]) edges.push(i);
  prev = cur;
  if (edges.length || Math.abs(axes[0] || 0) > 0.3 || Math.abs(axes[1] || 0) > 0.3 || (values[6] || 0) > 0.2 || (values[7] || 0) > 0.2) lastPadUse = now;

  if (captureCb) {
    if (edges.length) captureCb(edges[0]);
    return;
  }
  const mode = (curMode = screenMode());
  if (mode === 'capture') return;
  if (mode === 'menu' || mode === 'results') {
    // 메뉴 이동 (누르고 있으면 0.38초 뒤부터 빠르게 반복)
    const dir = navDir(gp);
    if (dir !== navRep.dir) {
      navRep.dir = dir;
      navRep.t = now + 380;
      if (dir) mode === 'results' ? resultsMove(dir) : sendKey(ARROW[dir]);
    } else if (dir && now >= navRep.t) {
      navRep.t = now + 110;
      mode === 'results' ? resultsMove(dir) : sendKey(ARROW[dir]);
    }
    for (const i of edges) {
      if (mode === 'results') {
        if (i === 0) {
          const a = document.activeElement;
          const b = a && a.closest && a.closest('#results') ? a : document.querySelector('#results.on [data-res="restart"]');
          if (b) b.click();
        } else if (i === 1) {
          const b = document.querySelector('#results.on [data-res="home"]');
          if (b) b.click();
        }
        continue;
      }
      if (i === 0) menuConfirm();
      else if (i === 1 || i === MENU_BTN) sendKey('Escape');
      else if (i === 4) sendKey('PageUp');
      else if (i === 5) sendKey('PageDown');
    }
    return;
  }
  navRep.dir = navDir(gp); // 게임으로 돌아온 순간 누르고 있던 방향이 메뉴 이동으로 새지 않게
  // 게임 중: 버튼 → 행동
  for (const i of edges) {
    if (i === MENU_BTN) {
      sendKey('Escape'); // main.js가 Esc로 메뉴를 엶
      continue;
    }
    for (const id of Object.keys(binds)) {
      if (binds[id] !== i) continue;
      if (actionFilter && actionFilter(id) === false) continue;
      for (const fn of actionListeners) fn(id);
    }
  }
}

// rAF마다 읽기 (홈 화면처럼 input.read()를 안 부르는 곳에서도 메뉴 이동이 되게)
let loopOn = false;
function loop() {
  pollPad();
  requestAnimationFrame(loop);
}
function startLoop() {
  if (loopOn || typeof requestAnimationFrame !== 'function') return;
  loopOn = true;
  requestAnimationFrame(loop);
}
try {
  window.addEventListener('gamepadconnected', startLoop);
  if (navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) startLoop();
  // 일부 브라우저는 연결 이벤트를 늦게 보냄 → 아무 키나 눌러도 확인 시작
  window.addEventListener('pointerdown', startLoop, { once: true });
} catch {}

// ------------------------------------------------------------------ 연결 알림 (작은 띠)
let toastEl = null, toastT = 0;
export function padToast(html, ms = 3200) {
  if (!document.body) return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'padToast';
    document.body.appendChild(toastEl);
  }
  toastEl.innerHTML = html;
  toastEl.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('on'), ms);
}
connListeners.add((on) => {
  if (on) {
    const n = NAMES[style];
    padToast(`🎮 게임패드 연결됨 · ${padKbd(0)} 고르기 · ${padKbd(1)} 뒤로 · ${padKbd(MENU_BTN)} 메뉴`);
    void n;
  } else {
    padToast('🎮 게임패드 연결이 끊겼어요');
    // 달리는 중에 끊기면 일시정지 (메뉴를 엶)
    const g = window.game;
    if (g && g.race && g.race.phase === 'racing' && !screenMode()) sendKey('Escape');
  }
});

/** 버튼 글자 <kbd> */
export function padKbd(btn) {
  if (btn == null) return '<kbd class="none">없음</kbd>';
  const face = btn <= 3 ? ` pf pf${btn}` : '';
  return `<kbd class="pad${face}">${escHtml(NAMES[style][btn] || `버튼 ${btn}`)}</kbd>`;
}

// ------------------------------------------------------------------ 밖에서 쓰는 것
export const pad = {
  /** 패드가 연결돼 있나 (한 번이라도 버튼을 눌러 브라우저가 알려 준 뒤) */
  connected: () => gpIndex >= 0,
  /** 연결된 패드 이름·모양 */
  info: () => ({ connected: gpIndex >= 0, id: gpId, style }),
  /** 마지막으로 쓴 게 패드면 true (안내 글자를 패드 버튼으로) */
  usingPad: () => gpIndex >= 0 && lastPadUse > lastKbUse,
  /** 키보드를 썼다고 알림 (input.js) */
  markKeyboard() {
    lastKbUse = performance.now();
  },
  get(id) {
    return id in binds ? binds[id] : null;
  },
  set(id, btn) {
    if (!(id in PAD_DEF) || LOCKED.has(id)) return false;
    if (btn === MENU_BTN) return false;
    binds[id] = btn == null ? null : btn;
    changed();
    return true;
  },
  resetAction(id) {
    if (!(id in PAD_DEF)) return;
    binds[id] = PAD_DEF[id];
    changed();
  },
  reset() {
    binds = { ...PAD_DEF };
    changed();
  },
  isDefault: (id) => binds[id] === PAD_DEF[id],
  allDefault: () => Object.keys(PAD_DEF).every((id) => binds[id] === PAD_DEF[id]),
  onChange(fn) {
    bindListeners.add(fn);
    return () => bindListeners.delete(fn);
  },
  /** 같은 버튼을 같은 때 쓰는 다른 행동 */
  conflictsOf(id) {
    const b = binds[id];
    if (b == null) return [];
    if (!actionVisible(id)) return [];
    return Object.keys(binds)
      .filter((o) => o !== id && binds[o] === b && actionVisible(o) && overlap(BY_ID[id], BY_ID[o]))
      .map((o) => ({ id: o, label: BY_ID[o] ? BY_ID[o].label : o }));
  },
  /** 버튼 이름 (예: 'A', '✕', 'RT') */
  name: (btn) => (btn == null ? '' : NAMES[style][btn] || `버튼 ${btn}`),
  label(id) {
    return this.name(id === 'menu' ? MENU_BTN : binds[id]);
  },
  html(id) {
    return padKbd(id === 'menu' ? MENU_BTN : binds[id]);
  },
  /** 행동 버튼을 누르고 있나 (게임 중에만) */
  held(id) {
    if (gpIndex < 0 || curMode) return false;
    const b = binds[id];
    return b != null && (values[b] || 0) > 0.5;
  },
  /**
   * 아날로그 값: steer(-1~1, +오른쪽), throttle·brake(0~1). 데드존·커브·감도(padConfig) 적용.
   * 메뉴가 떠 있으면 0
   */
  analog() {
    if (gpIndex < 0 || curMode) return { steer: 0, throttle: 0, brake: 0 };
    const dz = padConfig.deadzone, x = axes[0] || 0;
    let s = Math.abs(x) <= dz ? 0 : (Math.abs(x) - dz) / (1 - dz);
    s = Math.sign(x) * Math.pow(Math.min(1, s), padConfig.curve);
    const trig = (id) => {
      const b = binds[id];
      if (b == null) return 0;
      const v = values[b] || 0;
      return v < 0.04 ? 0 : Math.min(1, (v - 0.04) / 0.92);
    };
    return { steer: clamp(s * padConfig.sens, -1, 1), throttle: trig('throttle'), brake: trig('brake') };
  },
  /** 게임 중 버튼 행동 알림 (input.js가 "이번 프레임에 눌림"으로 씀) */
  onAction(fn) {
    actionListeners.add(fn);
    return () => actionListeners.delete(fn);
  },
  /** 버튼 행동 거르개: fn(id)가 false면 게임에 안 보냄 (null = 없앰) */
  setActionFilter(fn) {
    actionFilter = fn || null;
  },
  onConnect(fn) {
    connListeners.add(fn);
    return () => connListeners.delete(fn);
  },
  /** 진동 (strong·weak 0~1). 설정에서 끄면 안 함 */
  rumble(strong, weak, ms = 120) {
    if (!padConfig.vibe || gpIndex < 0) return;
    try {
      const gp = navigator.getGamepads()[gpIndex];
      const va = gp && gp.vibrationActuator;
      if (va && va.playEffect) va.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
    } catch {}
  },
  /** 지금 패드 상태 (조작키 화면 미리보기용) */
  raw: () => ({ axes: [...axes], values: [...values] }),
  poll: pollPad,
  startLoop,
};

/**
 * 버튼 정하기 창: Promise<버튼 번호 | null(취소) | ''(비우기)>
 *   패드 버튼을 누르면 정해짐. 키보드 Esc = 취소, Backspace = 비우기
 */
export function capturePad(title, sub = '') {
  startLoop();
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'gm-confirm gm-capture gm-pad-capture';
    wrap.innerHTML = `<div class="box" role="dialog" aria-modal="true">
      <div class="kb-wave"><i></i><i></i><i></i></div>
      <h3></h3><p class="sub"></p>
      <div class="kb-press">🎮 쓰고 싶은 패드 버튼을 누르세요</div>
      <p class="hint">${padKbd(MENU_BTN)} 버튼은 메뉴 전용이에요 · 키보드 <kbd>Esc</kbd> 취소 · <kbd>Backspace</kbd> 비우기</p>
      <div class="btns"><button class="gm-btn small" data-r="clear">비우기</button><button class="gm-btn small" data-r="cancel">취소</button></div></div>`;
    wrap.querySelector('h3').textContent = title;
    wrap.querySelector('.sub').textContent = sub;
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      captureCb = null;
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      resolve(r);
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') finish(null);
      else if (e.code === 'Backspace' || e.code === 'Delete') finish('');
    };
    captureCb = (btn) => {
      if (btn === MENU_BTN) {
        const p = wrap.querySelector('.kb-press');
        p.textContent = '그 버튼은 메뉴 전용이라 쓸 수 없어요. 다른 버튼을 눌러 주세요';
        p.classList.add('bad');
        return;
      }
      finish(btn);
    };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) finish(b.dataset.r === 'clear' ? '' : null);
      else if (e.target === wrap) finish(null);
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    if (gpIndex < 0) wrap.querySelector('.kb-press').textContent = '🎮 패드를 연결하고 버튼을 눌러 주세요';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
}

/**
 * 조작키 화면의 "게임패드" 탭. { el, settingsEl, refresh, destroy }
 *   위: 연결 상태 + 실시간 미리보기(스틱·트리거·버튼), 가운데: 패드 설정 줄(settings.js가 settingsEl에 넣음), 아래: 행동별 버튼
 */
export function createPadPanel(opts = {}) {
  const sound = opts.sound || (() => {});
  const root = document.createElement('div');
  root.className = 'gm-keys-panel gm-pad-panel';
  root.innerHTML = `
    <div class="pad-status">
      <div class="pad-pic">
        <div class="stick"><i></i></div>
        <div class="trig"><span>LT</span><b class="lt"><i></i></b></div>
        <div class="trig"><span>RT</span><b class="rt"><i></i></b></div>
        <div class="btnrow"></div>
      </div>
      <div class="pad-txt"><b class="t"></b><small class="s"></small></div>
    </div>
    <div class="pad-settings"></div>`;
  const settingsEl = root.querySelector('.pad-settings');
  const rows = [];
  let group = null, groupEl = null;
  const ANALOG = { throttle: '트리거는 밟은 만큼 가속', brake: '트리거는 밟은 만큼 브레이크', left: '왼쪽 스틱으로도 (아날로그)', right: '왼쪽 스틱으로도 (아날로그)', menu: '메뉴 버튼은 바꿀 수 없어요' };
  for (const a of ACTIONS) {
    if (!(a.id in PAD_DEF)) continue;
    if (a.group !== group) {
      group = a.group;
      groupEl = document.createElement('section');
      groupEl.className = 'gm-set-group kb-group';
      groupEl.innerHTML = `<h3>${escHtml(group)}</h3>`;
      root.appendChild(groupEl);
    }
    const row = document.createElement('div');
    row.className = 'gm-set-row kb-row';
    row.dataset.action = a.id;
    row.innerHTML = `<div class="gm-set-label"><b>${escHtml(a.label)}</b><small class="kb-desc"></small></div>
      <div class="kb-slots"><button class="kb-slot pad-slot" data-nav data-slot="0" title="패드 버튼"></button><button class="kb-reset" data-nav data-reset title="이 줄만 기본값으로">↺</button></div>`;
    groupEl.appendChild(row);
    rows.push({ a, row });
  }
  const foot = document.createElement('div');
  foot.className = 'gm-set-foot';
  foot.innerHTML = `<span>칸을 누르고 패드 버튼을 누르면 바뀌어요 · 메뉴에서는 ${padKbd(0)} 고르기 · ${padKbd(1)} 뒤로</span><button class="gm-btn small" data-nav data-resetall>모든 버튼 기본값으로</button>`;
  root.appendChild(foot);

  function refresh() {
    const st = pad.info();
    root.querySelector('.pad-txt .t').textContent = st.connected ? `🎮 연결됨 (${st.style === 'ps' ? 'PlayStation 배치' : 'Xbox 배치'})` : '🎮 패드가 아직 안 보여요';
    root.querySelector('.pad-txt .s').textContent = st.connected ? st.id.replace(/\(.*?Vendor.*?\)/i, '').trim().slice(0, 60) : '패드를 USB·블루투스로 연결하고 아무 버튼이나 한 번 눌러 주세요';
    root.classList.toggle('on', st.connected);
    for (const { a, row } of rows) {
      row.hidden = !actionVisible(a.id);
      const b = row.querySelector('.pad-slot');
      const locked = LOCKED.has(a.id);
      b.innerHTML = (a.id === 'menu' || binds[a.id] != null ? pad.html(a.id) : '<span class="empty">+ 추가</span>') + (locked ? '<span class="lock">🔒</span>' : '');
      b.disabled = locked;
      b.classList.toggle('locked', locked);
      const c = pad.conflictsOf(a.id);
      row.classList.toggle('conflict', c.length > 0);
      row.classList.toggle('custom', !pad.isDefault(a.id));
      row.querySelector('.kb-reset').style.visibility = pad.isDefault(a.id) ? 'hidden' : '';
      row.querySelector('.kb-desc').innerHTML = c.length ? `⚠ '${c.map((o) => escHtml(o.label)).join("', '")}'와 같은 버튼이에요` : escHtml(ANALOG[a.id] || a.desc || '');
    }
    root.querySelectorAll('.kb-group').forEach((g) => (g.hidden = ![...g.querySelectorAll('.kb-row')].some((r) => !r.hidden)));
    root.querySelector('.btnrow').innerHTML = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 8, 9].map((i) => `<span data-b="${i}">${escHtml(pad.name(i))}</span>`).join('');
  }

  async function edit(id) {
    if (LOCKED.has(id)) return;
    const a = BY_ID[id];
    sound('select');
    const btn = await capturePad(`'${a.label}' 패드 버튼`, `지금: ${binds[id] != null ? pad.name(binds[id]) : '없음'}`);
    if (btn === null) return sound('back');
    pad.set(id, btn === '' ? null : btn);
    sound(btn !== '' && pad.conflictsOf(id).length ? 'back' : 'toggle');
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b) || settingsEl.contains(b)) return;
    if (b.hasAttribute('data-resetall')) {
      pad.reset();
      sound('select');
      return;
    }
    const row = b.closest('.kb-row');
    if (!row || settingsEl.contains(row)) return;
    if (b.hasAttribute('data-reset')) {
      pad.resetAction(row.dataset.action);
      sound('toggle');
      return;
    }
    if (b.classList.contains('pad-slot')) edit(row.dataset.action);
  });

  // 실시간 미리보기 (이 탭이 보일 때만)
  let raf = 0, wasConn = null;
  const dot = root.querySelector('.stick i'), lt = root.querySelector('.lt i'), rt = root.querySelector('.rt i');
  function live() {
    raf = requestAnimationFrame(live);
    if (!root.isConnected || root.offsetParent === null) return;
    startLoop();
    const st = pad.connected();
    if (st !== wasConn) (wasConn = st), refresh();
    if (!st) return;
    const r = pad.raw();
    dot.style.transform = `translate(${(r.axes[0] || 0) * 15}px, ${(r.axes[1] || 0) * 15}px)`;
    lt.style.width = `${(r.values[6] || 0) * 100}%`;
    rt.style.width = `${(r.values[7] || 0) * 100}%`;
    root.querySelectorAll('.btnrow span').forEach((s) => s.classList.toggle('on', (r.values[+s.dataset.b] || 0) > 0.5));
  }
  raf = requestAnimationFrame(live);
  refresh();
  const off = pad.onChange(refresh);
  const offKb = keybinds.onChange(refresh); // 부스터가 켜지고 꺼질 때
  return {
    el: root,
    settingsEl,
    refresh,
    destroy() {
      off();
      offKb();
      cancelAnimationFrame(raf);
    },
  };
}
