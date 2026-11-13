// ESC 메뉴 (일시정지): 계속하기 / 다시 시작 / 설정 / 조작법 / 차 바꾸기 / 맵 바꾸기 / 홈으로
//   열려 있는 동안 게임은 멈춤 (main.js가 isOpen을 보고 물리·시간·출발 신호를 멈추고 소리를 줄임)
//   ESC를 다시 누르면 계속하기. 설정·조작법은 오른쪽 칸에 열림
import { createSettingsPanel, createControlsPage, spatialMove, uiSound, confirmDialog, dialogOpen } from './settings.js';
import { fmtTime } from './records.js';
import { actionsFor } from './keybinds.js';
import { pad, padKbd } from './gamepad.js';

/**
 * @param {object} o
 *  o.getInfo() → { map, car, lapText, time, best, record, phase, lapTimes }
 *  o.onOpen(), o.onClose(), o.onRestart(), o.onHome(page)  (page: undefined | 'car' | 'map')
 *  o.isRacing() → 레이스 중이면 true (홈으로 갈 때 확인 창)
 */
export function createPauseMenu(o) {
  const root = document.createElement('div');
  root.id = 'pauseMenu';
  root.innerHTML = `
    <div class="pm-wrap">
      <div class="pm-side">
        <div class="pm-head"><div class="ic">⏸</div><div><h2>일시정지</h2><small>계속하기를 누르면 이어서 달려요</small></div></div>
        <div class="h-panel pm-info"></div>
        <div class="pm-list">
          <button class="gm-btn primary" data-act="resume" data-nav><span class="ic">▶</span>계속하기<kbd>Esc</kbd></button>
          <button class="gm-btn" data-act="restart" data-nav><span class="ic">↺</span>다시 시작</button>
          <div class="sep"></div>
          <button class="gm-btn" data-act="settings" data-nav><span class="ic">⚙️</span>설정</button>
          <button class="gm-btn" data-act="keys" data-nav><span class="ic">⌨️</span>조작키 바꾸기</button>
          <button class="gm-btn" data-act="controls" data-nav><span class="ic">🎮</span>조작법</button>
          <div class="sep"></div>
          <button class="gm-btn" data-act="car" data-nav><span class="ic">🏎️</span>차 바꾸기</button>
          <button class="gm-btn" data-act="map" data-nav><span class="ic">🗺️</span>맵 바꾸기</button>
          <button class="gm-btn danger" data-act="home" data-nav><span class="ic">🏠</span>홈으로</button>
        </div>
      </div>
      <div class="h-panel pm-page">
        <div class="head"><h3></h3><button class="gm-btn small" data-act="closePage" data-nav style="display:none">‹ 메뉴로</button></div>
        <div class="scroll"></div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const side = root.querySelector('.pm-side');
  const pageEl = root.querySelector('.pm-page');
  const pageTitle = pageEl.querySelector('h3');
  const pageBody = pageEl.querySelector('.scroll');
  const closePageBtn = pageEl.querySelector('[data-act="closePage"]');
  const setPanel = createSettingsPanel({ inGame: true });
  const controls = createControlsPage({ onEditKeys: () => act('keys') });
  let open = false, page = null;

  function renderInfo() {
    const i = o.getInfo();
    const resumeKey = root.querySelector('[data-act="resume"] kbd');
    if (resumeKey) resumeKey.outerHTML = pad.usingPad() ? padKbd(1) : '<kbd>Esc</kbd>';
    root.querySelector('.pm-head h2').textContent = i.online ? '온라인 메뉴' : '일시정지';
    root.querySelector('.pm-head small').textContent = i.online ? '온라인 경기는 계속돼요. 내 차는 가속을 멈춰요' : '계속하기를 누르면 이어서 달려요';
    root.querySelector('[data-act="restart"]').style.display = i.online ? 'none' : '';
    root.querySelector('.pm-info').innerHTML = [
      ['맵', i.map],
      ['차', i.car],
      i.free ? null : ['바퀴', i.lapText],
      ['시간', fmtTime(i.time)],
      i.free ? null : ['이번 최고 랩', fmtTime(i.best)],
      i.free ? null : ['내 최고 기록', i.record ? fmtTime(i.record) : '없음'],
    ]
      .filter(Boolean)
      .map(([a, b]) => `<div class="r"><span>${a}</span><span>${String(b).replace(/</g, '&lt;')}</span></div>`)
      .join('');
    return i;
  }
  function showPage(name) {
    page = name;
    pageBody.innerHTML = '';
    side.querySelectorAll('[data-act]').forEach((b) => b.classList.toggle('cur', b.dataset.act === name));
    closePageBtn.style.display = name ? '' : 'none';
    if (name === 'settings' || name === 'keys') {
      pageTitle.textContent = name === 'keys' ? '조작키' : '설정';
      setPanel.showTab(name === 'keys' ? (pad.usingPad() ? 'pad' : 'keys') : 'general'); // 패드로 연 거면 게임패드 탭
      pageBody.appendChild(setPanel.el);
      setPanel.refresh();
    } else if (name === 'controls') {
      pageTitle.textContent = '조작법';
      pageBody.appendChild(controls);
    } else {
      // 첫 화면: 지금 레이스 요약
      const i = o.getInfo();
      pageTitle.textContent = '';
      const laps = (i.lapTimes || []).map((t, k) => `<span>LAP ${k + 1} · ${fmtTime(t)}</span>`).join('');
      pageBody.innerHTML = `<div class="pm-welcome"><div><div class="big">${i.online ? '온라인 경기 중' : '잠시 쉬는 중'}</div>
        <div>${i.online ? '온라인에서는 메뉴를 열어도 레이스가 계속돼요. 계속하기로 돌아가세요' : i.phase === 'countdown' ? '출발 신호가 멈춰 있어요. 계속하기를 누르면 이어서 켜져요' : i.phase === 'finished' ? '완주했어요! 다시 시작하거나 다른 맵을 골라 보세요' : '레이스가 멈춰 있어요'}</div>
        ${laps ? `<div class="laps">${laps}</div>` : ''}</div></div>`;
    }
  }

  function doOpen() {
    if (open) return;
    open = true;
    renderInfo();
    showPage(null);
    root.classList.add('on');
    o.onOpen && o.onOpen();
    uiSound('select');
    root.querySelector('[data-act="resume"]').focus({ preventScroll: true });
  }
  function doClose() {
    if (!open) return;
    open = false;
    root.classList.remove('on');
    if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
    uiSound('back');
    o.onClose && o.onClose();
  }

  async function leave(pageName) {
    if (o.isRacing() && !(await confirmDialog(pageName === undefined ? '홈으로 갈까요?' : pageName === 'car' ? '차를 바꿀까요?' : '맵을 바꿀까요?',
      '이동하면 지금 달리던 레이스가 끝나요.', pageName === undefined ? '홈으로' : '바꾸러 가기'))) return;
    o.onHome(pageName);
  }

  async function act(name) {
    if (name === 'resume') doClose();
    else if (name === 'restart') {
      if (o.getInfo().online) return;
      doClose();
      o.onRestart();
    } else if (name === 'settings' || name === 'controls' || name === 'keys') {
      showPage(page === name ? null : name);
      uiSound('select');
      const first = pageBody.querySelector('[data-nav]');
      if (first && page) first.focus({ preventScroll: true });
    } else if (name === 'closePage') {
      const back = side.querySelector(`[data-act="${page}"]`);
      showPage(null);
      uiSound('back');
      if (back) back.focus({ preventScroll: true });
    } else if (name === 'car') leave('car');
    else if (name === 'map') leave('map');
    else if (name === 'home') leave(undefined);
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && root.contains(b)) act(b.dataset.act);
    else if (e.target === root) doClose(); // 바깥 빈 곳을 누르면 계속하기
  });
  root.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.pm-list .gm-btn');
    if (b && document.activeElement !== b) b.focus({ preventScroll: true });
  });

  // 메뉴가 열려 있을 때 키보드: 게임 입력보다 먼저 받음 (capture)
  window.addEventListener(
    'keydown',
    (e) => {
      if (!open || dialogOpen()) return;
      e.stopImmediatePropagation(); // 메뉴가 열려 있으면 게임(input.js·main.js)에는 키를 안 보냄
      const k = e.code;
      const a = document.activeElement;
      const inPage = a && pageEl.contains(a);
      // Esc, 또는 메뉴 보조 키(조작키에서 정한 키)
      if (k === 'Escape' || (!inPage || !(a && a.closest('.gm-keys-panel'))) && actionsFor(k).includes('menu')) {
        e.preventDefault();
        if (page && inPage) act('closePage');
        else doClose();
        return;
      }
      // 설정 화면: PageUp / PageDown (패드 LB / RB) = 탭 넘기기
      if ((k === 'PageUp' || k === 'PageDown') && (page === 'settings' || page === 'keys')) {
        e.preventDefault();
        const tabs = ['general', 'keys', 'pad'];
        const next = tabs[(tabs.indexOf(setPanel.tab) + (k === 'PageUp' ? 2 : 1)) % 3];
        setPanel.showTab(next);
        uiSound('toggle');
        const f = pageBody.querySelector(`.gm-tab[data-tab="${next}"]`);
        if (f) f.focus({ preventScroll: true });
        return;
      }
      const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[k];
      if (dir) {
        e.preventDefault();
        if (inPage && a.dataset && a.dataset.adjust && (dir === 'left' || dir === 'right')) {
          setPanel.adjust(a.dataset.adjust, dir === 'left' ? -1 : 1);
          return;
        }
        // 메뉴 목록 → 오른쪽 칸으로 (설정이 열려 있으면)
        if (!inPage && dir === 'right' && page) {
          const first = pageBody.querySelector('[data-nav]');
          if (first) (first.focus({ preventScroll: true }), uiSound('move'));
          return;
        }
        if (inPage && dir === 'left' && !(a.dataset && a.dataset.adjust)) {
          // 조작키 칸처럼 옆에 버튼이 더 있으면 그쪽으로, 없으면 왼쪽 메뉴로
          if (spatialMove(pageEl, 'left')) return uiSound('move');
          const back = side.querySelector(`[data-act="${page}"]`);
          if (back) (back.focus({ preventScroll: true }), uiSound('move'));
          return;
        }
        if (spatialMove(inPage ? pageEl : side.querySelector('.pm-list'), dir)) uiSound('move');
        return;
      }
      if ((k === 'Enter' || k === 'NumpadEnter' || k === 'Space') && a && a.dataset && a.dataset.adjust) {
        e.preventDefault();
        setPanel.adjust(a.dataset.adjust, 1);
        return;
      }
      if ((k === 'Enter' || k === 'NumpadEnter') && (!a || a === document.body)) {
        e.preventDefault();
        doClose();
      }
    },
    true,
  );

  return {
    get isOpen() {
      return open;
    },
    open: doOpen,
    close: doClose,
    toggle() {
      open ? doClose() : doOpen();
    },
    refreshInfo: renderInfo,
    el: root,
  };
}
