// 입력 → "조작 명령" 변환.
// 자동차는 이 명령 객체만 보고 움직입니다. 나중에 멀티플레이에서는
// 키보드 대신 네트워크로 받은 명령, AI 차는 AI가 만든 명령을 넣으면 됩니다.
//
// 어떤 키가 어떤 행동인지는 keybinds.js (설정 → 조작키에서 바꿈, localStorage 'gimmick.keys')
//   - 예전 코드처럼 wasPressed('KeyR')로 물어도 "복귀 키"가 눌렸는지로 바꿔서 답함 (keybinds.js의 LEGACY)
//   - 새 코드는 actionPressed('respawn') / actionHeld('throttle')를 써도 됨

import { keybinds, actionsFor, LEGACY } from './keybinds.js';

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
  const held = (id) => {
    for (const code of down) if (actionsFor(code).includes(id)) return true;
    return false;
  };
  const hit = (id) => pressedActs.has(id);

  return {
    /** @returns {ControlState} */
    read() {
      const left = held('left') ? 1 : 0;
      const right = held('right') ? 1 : 0;
      return {
        throttle: held('throttle') ? 1 : 0,
        brake: held('brake') ? 1 : 0,
        steer: right - left, // +1 = 오른쪽
        drift: held('drift'),
        // 비행 모드: 상승(이륙) / 하강 (기본 Space / Shift)
        climb: held('climb'),
        dive: held('dive'),
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
      return keybinds.main(id);
    },
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
