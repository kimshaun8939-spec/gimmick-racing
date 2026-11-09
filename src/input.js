// 입력 → "조작 명령" 변환.
// 자동차는 이 명령 객체만 보고 움직입니다. 나중에 멀티플레이에서는
// 키보드 대신 네트워크로 받은 명령, AI 차는 AI가 만든 명령을 넣으면 됩니다.

/** @typedef {{ throttle:number, brake:number, steer:number, drift:boolean, climb:boolean, dive:boolean, booster:boolean, mode:(null|'normal'|'accel'|'boat'|'fly'), shiftUp:boolean, shiftDown:boolean }} ControlState */

export function emptyControls() {
  return { throttle: 0, brake: 0, steer: 0, drift: false, climb: false, dive: false, booster: false, mode: null, shiftUp: false, shiftDown: false };
}

export function createKeyboardInput() {
  const down = new Set();
  const pressed = new Set(); // 이번 프레임에 새로 눌린 키

  // Shift는 키보드·입력기(한글)에 따라 e.code가 비거나 다르게 올 때가 있어서 e.key·e.location으로도 알아봄 (오른쪽 Shift = location 2)
  const codeOf = (e) => (e.key === 'Shift' && !/^Shift(Left|Right)$/.test(e.code) ? (e.location === 2 ? 'ShiftRight' : 'ShiftLeft') : e.code);
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    const code = codeOf(e);
    if (!down.has(code)) pressed.add(code);
    down.add(code);
    // 다른 키를 누를 때마다 Shift 상태를 다시 맞춤 (Shift를 뗀 신호를 놓쳐서 계속 눌린 것으로 남지 않게)
    if (e.key !== 'Shift' && !e.shiftKey) down.delete('ShiftLeft'), down.delete('ShiftRight');
  });
  window.addEventListener('keyup', (e) => {
    down.delete(codeOf(e));
    if (e.key === 'Shift' && !e.shiftKey) down.delete('ShiftLeft'), down.delete('ShiftRight'); // 두 Shift 모두 뗌
  });
  window.addEventListener('blur', () => down.clear());

  const any = (...codes) => codes.some((c) => down.has(c));

  return {
    /** @returns {ControlState} */
    read() {
      const left = any('KeyA', 'ArrowLeft') ? 1 : 0;
      const right = any('KeyD', 'ArrowRight') ? 1 : 0;
      return {
        throttle: any('KeyW', 'ArrowUp') ? 1 : 0,
        brake: any('KeyS', 'ArrowDown') ? 1 : 0,
        steer: right - left, // +1 = 오른쪽
        drift: any('ShiftLeft', 'ShiftRight', 'Space'),
        // 비행 모드: Space 상승(이륙), Shift 하강
        climb: down.has('Space'),
        dive: any('ShiftLeft', 'ShiftRight'),
        // 부스터 (누른 순간 한 번만)
        booster: pressed.has('KeyE'),
        // 주행 모드: 1 일반 / 2 가속 / 3 배 (누른 순간 한 번만)
        mode: pressed.has('Digit1') || pressed.has('Numpad1') ? 'normal'
          : pressed.has('Digit2') || pressed.has('Numpad2') ? 'accel'
          : pressed.has('Digit3') || pressed.has('Numpad3') ? 'boat'
          : pressed.has('Digit4') || pressed.has('Numpad4') ? 'fly' : null,
        // 수동 변속 (누른 순간 한 번만)
        shiftUp: pressed.has('KeyX'),
        shiftDown: pressed.has('KeyZ'),
      };
    },
    /** 화면 버튼을 눌렀을 때: 그 키를 한 번 누른 것처럼 */
    press(code) {
      pressed.add(code);
    },
    /** 한 번 눌림 감지 (메뉴, 리스폰 등) */
    wasPressed(code) {
      return pressed.has(code);
    },
    endFrame() {
      pressed.clear();
    },
    /** 메뉴를 닫을 때: 메뉴에서 누른 키가 게임으로 새지 않게 "방금 눌림"을 비움 (keepHeld=false면 누르고 있는 키도 비움) */
    clear(keepHeld = true) {
      pressed.clear();
      if (!keepHeld) down.clear();
    },
  };
}
