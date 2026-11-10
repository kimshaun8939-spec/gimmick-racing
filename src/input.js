// 입력 → "조작 명령" 변환.
// 자동차는 이 명령 객체만 보고 움직입니다. 나중에 멀티플레이에서는
// 키보드 대신 네트워크로 받은 명령, AI 차는 AI가 만든 명령을 넣으면 됩니다.
//
// 어떤 키가 어떤 행동인지는 keybinds.js (설정 → 조작키에서 바꿈, localStorage 'gimmick.keys')
//   - 예전 코드처럼 wasPressed('KeyR')로 물어도 "복귀 키"가 눌렸는지로 바꿔서 답함 (keybinds.js의 LEGACY)
//   - 새 코드는 actionPressed('respawn') / actionHeld('throttle')를 써도 됨
// 게임패드(gamepad.js)도 여기서 섞음: 스틱·트리거는 아날로그, 버튼은 행동. 안내 글자(keyName)는 마지막에 쓴 쪽(키보드/패드)을 따름
// 조향 느낌·운전 도움(설정 → 조향·도움)도 여기서 적용 → main.js는 그대로 read()만 부름
//   steerSens(감도) · steerRamp(키보드 핸들을 서서히) · brakeAssist · steerAssist · tcs (assists.js)

import { keybinds, actionsFor, LEGACY, codeLabel, actionVisible } from './keybinds.js';
import { pad, padConfig, pollPad } from './gamepad.js';
import { settings } from './settings.js';
import { applyAssists } from './assists.js';
import { touch, touchWanted } from './touch.js';

// 패드 설정 → gamepad.js
function syncPadConfig() {
  const v = settings.values;
  padConfig.deadzone = v.padDeadzone ?? 0.1;
  padConfig.curve = v.padCurve ?? 1.5;
  padConfig.sens = v.steerSens ?? 1;
  padConfig.vibe = v.padVibe ?? true;
}
syncPadConfig();
settings.onChange(syncPadConfig);
// 키보드 핸들 서서히 꺾기: 초당 얼마나 (돌아올 때는 2.5배 빠르게)
const RAMP = { instant: 0, fast: 7, smooth: 3.2 };

/** @typedef {{ throttle:number, brake:number, steer:number, drift:boolean, climb:boolean, dive:boolean, booster:boolean, mode:(null|'normal'|'accel'|'boat'|'fly'), shiftUp:boolean, shiftDown:boolean }} ControlState */

export function emptyControls() {
  return { throttle: 0, brake: 0, steer: 0, drift: false, climb: false, dive: false, booster: false, mode: null, shiftUp: false, shiftDown: false };
}

// 운전 키는 브라우저 기본 동작(스크롤 등)을 막음
const DRIVE_ACTIONS = ['throttle', 'brake', 'left', 'right', 'drift', 'climb', 'dive', 'booster'];

export function createKeyboardInput() {
  const down = new Set();
  const pressed = new Set(); // 이번 프레임에 새로 눌린 키
  const pressedActs = new Set(); // 이번 프레임에 새로 눌린 행동

  // Shift는 키보드·입력기(한글)에 따라 e.code가 비거나 다르게 올 때가 있어서 e.key·e.location으로도 알아봄 (오른쪽 Shift = location 2)
  const codeOf = (e) => (e.key === 'Shift' && !/^Shift(Left|Right)$/.test(e.code) ? (e.location === 2 ? 'ShiftRight' : 'ShiftLeft') : e.code);
  window.addEventListener('keydown', (e) => {
    if (e.gmPad) return; // 패드가 메뉴용으로 보낸 가짜 키 (게임 입력이 아님)
    if (e.isTrusted) pad.markKeyboard();
    const code = codeOf(e);
    const acts = actionsFor(code);
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    if (typing) return; // 글자 입력 칸(멀티플레이 이름 등)에 쓰는 중이면 게임 키로 안 씀
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) || acts.some((a) => DRIVE_ACTIONS.includes(a))) e.preventDefault();
    if (!down.has(code)) {
      pressed.add(code);
      for (const a of acts) pressedActs.add(a);
      // 메뉴 보조 키 (Esc가 아닌 키로 메뉴를 열도록 정했을 때): Esc를 누른 것처럼 알림 (main.js가 Esc로 메뉴를 엶)
      const menuOn = () => !!document.querySelector('#pauseMenu.on, .gm-confirm, #lobby');
      if (code !== 'Escape' && acts.includes('menu') && !e.repeat && !menuOn()) {
        const esc = new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true });
        setTimeout(() => !menuOn() && window.dispatchEvent(esc), 0);
      }
    }
    down.add(code);
    // 다른 키를 누를 때마다 Shift 상태를 다시 맞춤 (Shift를 뗀 신호를 놓쳐서 계속 눌린 것으로 남지 않게)
    if (e.key !== 'Shift' && !e.shiftKey) down.delete('ShiftLeft'), down.delete('ShiftRight');
  });
  window.addEventListener('keyup', (e) => {
    down.delete(codeOf(e));
    if (e.key === 'Shift' && !e.shiftKey) down.delete('ShiftLeft'), down.delete('ShiftRight'); // 두 Shift 모두 뗌
  });
  window.addEventListener('blur', () => down.clear());

  /** 이 행동의 키가 지금 눌려 있나 (Shift처럼 왼쪽·오른쪽이 있는 키는 양쪽 다) */
  const kbHeld = (id) => {
    for (const code of down) if (actionsFor(code).includes(id)) return true;
    return false;
  };
  const held = (id) => kbHeld(id) || pad.held(id);
  const hit = (id) => pressedActs.has(id);
  // 패드 버튼 → 이번 프레임에 눌린 행동
  pad.onAction((id) => pressedActs.add(id));
  // 터치 버튼 (휴대폰): 화면에 버튼 만들고, 복귀 버튼 → 이번 프레임에 눌린 행동
  touch.mount();
  touch.onAction((id) => pressedActs.add(id));

  // 키보드 조향 (서서히 꺾기)
  let kSteer = 0, lastT = 0;
  function keyboardSteer(target) {
    const now = performance.now();
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0;
    lastT = now;
    const sens = settings.values.steerSens ?? 1;
    const rate = (RAMP[settings.values.steerRamp] || 0) * Math.max(0.6, sens);
    if (!rate) return (kSteer = target * Math.min(1, sens));
    const back = target === 0 || Math.sign(target) !== Math.sign(kSteer);
    const r = rate * (back ? 2.5 : 1);
    const goal = target * Math.min(1, sens);
    kSteer += Math.max(-r * dt, Math.min(r * dt, goal - kSteer));
    return kSteer;
  }

  // 패드 진동: 연석·잔디 떨림 + 부딪힘(속도가 갑자기 줄면)
  let rumbleT = 0, lastSpeed = 0;
  function rumble() {
    if (!pad.connected() || !(settings.values.padVibe ?? true)) return;
    const g = window.game, car = g && g.car;
    if (!car || g.paused) return;
    const now = performance.now();
    const sp = Math.abs(car.speed || 0);
    const bump = lastSpeed - sp;
    lastSpeed = sp;
    if (bump > 4) {
      pad.rumble(Math.min(1, bump / 14), 0.5, 220);
      rumbleT = now + 220;
      return;
    }
    if (now < rumbleT) return;
    const k = Math.min(1, sp / 30);
    const weak = ((car.kerbK || 0) * 0.45 + (car.offK || 0) * 0.25) * k + (car.wheelspin || 0) * 0.2;
    if (weak > 0.04) {
      pad.rumble(weak * 0.4, weak, 110);
      rumbleT = now + 100;
    }
  }

  return {
    /** @returns {ControlState} */
    read() {
      pollPad();
      const left = held('left') ? 1 : 0;
      const right = held('right') ? 1 : 0;
      const pa = pad.analog();
      const tc = touch.read();
      const kb = keyboardSteer(right - left);
      const tSteer = tc.steer * Math.min(1.3, settings.values.steerSens ?? 1);
      const c = {
        throttle: Math.max(kbHeld('throttle') ? 1 : 0, pa.throttle, tc.throttle),
        brake: Math.max(kbHeld('brake') ? 1 : 0, pa.brake, tc.brake),
        steer: Math.max(-1, Math.min(1, kb + pa.steer + tSteer)), // +1 = 오른쪽
        drift: held('drift') || tc.drift,
        // 비행 모드: 상승(이륙) / 하강 (기본 Space / Shift)
        climb: held('climb') || tc.climb,
        dive: held('dive') || tc.dive,
        // 부스터 (누른 순간 한 번만)
        booster: hit('booster'),
        // 주행 모드: 1 일반 / 2 가속 / 3 배 / 4 비행 (누른 순간 한 번만. 지금은 자동 변신이라 car.json에서 꺼 둠 → 바꾸는 키 없음)
        mode: pressed.has('Digit1') || pressed.has('Numpad1') ? 'normal'
          : pressed.has('Digit2') || pressed.has('Numpad2') ? 'accel'
          : pressed.has('Digit3') || pressed.has('Numpad3') ? 'boat'
          : pressed.has('Digit4') || pressed.has('Numpad4') ? 'fly' : null,
        // 수동 변속 (누른 순간 한 번만)
        shiftUp: hit('shiftUp'),
        shiftDown: hit('shiftDown'),
      };
      const v = settings.values;
      if ((v.brakeAssist || 'off') !== 'off' || (v.steerAssist || 'off') !== 'off' || v.tcs)
        applyAssists(c, { brakeAssist: v.brakeAssist || 'off', steerAssist: v.steerAssist || 'off', tcs: !!v.tcs });
      rumble();
      return c;
    },
    /** 화면 버튼을 눌렀을 때: 그 키(기본 키 이름)를 한 번 누른 것처럼 */
    press(code) {
      pressed.add(code);
      if (LEGACY[code]) pressedActs.add(LEGACY[code]);
      else for (const a of actionsFor(code)) pressedActs.add(a);
    },
    /**
     * 한 번 눌림 감지 (메뉴, 리스폰 등). 기본 키 이름(KeyR, Enter, KeyL…)으로 물으면 그 행동의 지금 키로 바꿔서 봄
     * (그 밖의 키는 키 그대로)
     */
    wasPressed(code) {
      const act = LEGACY[code];
      return act ? pressedActs.has(act) : pressed.has(code);
    },
    /** 행동 이름으로: 이번 프레임에 눌렸나 ('respawn', 'restart', 'racingLine', 'sound', 'map', 'gearbox', 'menu' …) */
    actionPressed(id) {
      return pressedActs.has(id);
    },
    /** 행동 이름으로: 지금 누르고 있나 */
    actionHeld(id) {
      return held(id);
    },
    /** 행동의 키 이름 (안내 글자용, 예: keyName('respawn') → 'R') */
    keyName(id) {
      return keyName(id);
    },
    /** 패드를 쓰는 중인가 (안내 글자를 패드 버튼으로 보여 줄 때) */
    usingPad: () => pad.usingPad(),
    endFrame() {
      pressed.clear();
      pressedActs.clear();
    },
    /** 메뉴를 닫을 때: 메뉴에서 누른 키가 게임으로 새지 않게 "방금 눌림"을 비움 (keepHeld=false면 누르고 있는 키도 비움) */
    clear(keepHeld = true) {
      pressed.clear();
      pressedActs.clear();
      if (!keepHeld) down.clear();
    },
  };
}

/** 행동의 키 이름: 패드를 쓰는 중이면 패드 버튼 (예: 'RT', 'A'), 아니면 키보드 키 (예: 'W') */
// 운전 키(가속·브레이크·좌우)는 기본 키와 보조 키(방향키)를 같이 보여 줌 (사용자 요청 2026-11-10 "방향키 조작도 포함")
const BOTH = new Set(['throttle', 'brake', 'left', 'right']);
export function keyName(id) {
  if (pad.usingPad()) {
    const l = pad.label(id);
    if (l) return l;
  }
  return BOTH.has(id) ? keybinds.label(id) : keybinds.main(id);
}

// ------------------------------------------------------------------ 불러오는 화면: 지금 정한 키 보여 주기
// (main.js의 팁 글자에 박힌 기본 키(W·L·R…)를 바뀐 키로 고치고, 아래에 주요 키 줄을 붙임)
function decorateLoading() {
  const ld = document.getElementById('loading');
  const box = ld && ld.querySelector('.ld');
  if (!box || box.querySelector('.ld-keys')) return;
  const K = (id) => (BOTH.has(id) ? keybinds.keys(id) : keybinds.keys(id).slice(0, 1)).map((c) => `<kbd>${codeLabel(c)}</kbd>`).join('') || '<kbd>?</kbd>';
  // 조향: A D 다음에 ← → (기본 키 둘, 보조 키 둘)
  const LR = () => [0, 1].flatMap((s) => [keybinds.keys('left')[s], keybinds.keys('right')[s]]).filter(Boolean).map((c) => `<kbd>${codeLabel(c)}</kbd>`).join('');
  const el = document.createElement('div');
  el.className = 'ld-keys';
  const draw = () =>
    (el.innerHTML = touchWanted()
      ? [['<kbd>◀ ▶</kbd>', '조향'], ['<kbd>▲</kbd>', '가속'], ['<kbd>▼</kbd>', '브레이크'], ['<kbd>💨</kbd>', '드리프트'], ['<kbd>↺</kbd>', '복귀']]
          .map(([k, t]) => `<span>${k}<small>${t}</small></span>`)
          .join('')
      : [[K('throttle'), '가속'], [K('brake'), '브레이크'], [LR(), '조향'], [K('drift'), '드리프트'], actionVisible('booster') && [K('booster'), '부스터'], [K('respawn'), '복귀'], ['<kbd>Esc</kbd>', '메뉴']]
        .filter(Boolean)
        .map(([k, t]) => `<span>${k}<small>${t}</small></span>`)
        .join('') + (pad.connected() ? '<span class="pad">🎮 패드 OK</span>' : ''));
  draw();
  keybinds.onChange(() => el.isConnected && draw());
  box.appendChild(el);
  const tip = document.getElementById('ldTip');
  if (!tip) return;
  const LETTER = Object.fromEntries(Object.entries(LEGACY).filter(([c]) => /^Key[A-Z]$/.test(c)).map(([c, a]) => [c.slice(3), a]));
  let mine = '';
  const fix = () => {
    const t = tip.textContent;
    if (!t || t === mine) return;
    let out = t.replace(/\b([A-Z]) 키/g, (m, L) => (LETTER[L] ? `${keybinds.main(LETTER[L])} 키` : m));
    out = out.replace(/순간 W!/, `순간 ${keybinds.label('throttle')}!`);
    mine = out;
    if (out !== t) tip.textContent = out;
  };
  fix();
  try {
    new MutationObserver(fix).observe(tip, { childList: true, characterData: true, subtree: true });
  } catch {}
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateLoading, { once: true });
  else decorateLoading();
}
