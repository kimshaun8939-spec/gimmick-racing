// 첫 레이스 출발 전 '주행 도움이 켜져 있어요' 카드 (사용자 요청 2026-11-15
//   "처음 들어왔을 때 주행 보조 시스템이 켜져 있는 거 같은데 첫 주행하기 전에 알려주고 바로 끌 수 있게")
//   - 첫 레이스 주소(rookie=1 + mode=race)에서는 settings.js가 브레이크·조향 도움·트랙션 컨트롤·부드러운 키보드 조향을 켬
//     → 출발 신호 전에 무엇이 켜졌는지 보여 주고 스위치로 바로 끄게 함. 스위치 = settings.set (Esc 설정과 같은 값, 바로 적용)
//   - 한 번 보면 localStorage 'gimmick.assistIntroSeen' = {v, choice}. 다음 rookie 레이스에서는 카드 없이 그 선택을 그대로 씀
//   - 출발 신호는 카드가 닫힐 때까지 멈춤: main.js가 돌려받은 state.open을 보고 기다림 (courseGuide와 같은 방식).
//     변신 연습장 첫 레이스는 코스 요약을 합침. 다른 맵은 코스 첫 안내를 이어서 띄움
//   - 안 뜨는 곳: 튜토리얼·아카데미·온라인(room)·자동화 브라우저(navigator.webdriver)·guide=0. 시험 강제 = ?assistintro=1 (0 = 끔)
//     intro=0은 그리드 소개를 건너뛰는 뜻이라 막지 않음: 홈 첫 레이스(…&intro=0&guide=1)·튜토리얼 뒤 첫 레이스(…&intro=0) 모두 intro=0을 씀
//   - 래퍼 class 'gm-confirm' → 패드 메뉴 이동·터치 버튼 숨김·Esc 메뉴 막기가 확인 창처럼 동작
import { settings, uiSound } from './settings.js';
import { touchWanted } from './touch.js';
import { pad, padKbd } from './gamepad.js';
import { keybinds } from './keybinds.js';

const SEEN_KEY = 'gimmick.assistIntroSeen';
const SET_KEY = 'gimmick.settings';

/** 카드에 나오는 도움 (on = 첫 레이스에서 켜지는 값, off = 끈 값) */
const ROWS = [
  { key: 'brakeAssist', icon: '🛑', name: '브레이크 도움', desc: '코너 앞에서 너무 빠르면 자동으로 브레이크', on: 'light', off: 'off', isOn: (v) => (v || 'off') !== 'off' },
  { key: 'steerAssist', icon: '🎯', name: '조향 도움', desc: '레이싱 라인 쪽으로 핸들을 살짝 돌려 줘요', on: 'light', off: 'off', isOn: (v) => (v || 'off') !== 'off' },
  { key: 'tcs', icon: '🛞', name: '트랙션 컨트롤', desc: '바퀴가 헛돌면 가속을 줄여 줘요', on: true, off: false, isOn: (v) => !!v },
  { key: 'steerRamp', icon: '⌨️', name: '부드러운 키보드 조향', desc: '키를 누르면 핸들이 서서히 꺾여요', on: 'smooth', off: 'instant', isOn: (v) => (v || 'instant') !== 'instant' },
  { key: 'racingLine', icon: '🟢', name: '레이싱 라인', desc: '도로 위 색 선 · 초록 가속 · 빨강 브레이크', on: true, off: false, isOn: (v) => !!v },
  { key: 'tow', icon: '🧲', name: '견인', desc: '많이 뒤처지면 가속 도움 (봇도 똑같아요)', on: true, off: false, isOn: (v) => v !== false },
];
const RECORD_KEYS = ['brakeAssist', 'steerAssist']; // 켜고 달리면 결과·기록에 🛟 '도움 켬'이 남는 도움 (main.js assistOn)

function readSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) || { v: 1 };
    } catch {
      return { v: 1 };
    }
  } catch {
    return null;
  }
}

/** 이 페이지가 첫 레이스(rookie) 주소인지 — settings.js의 프리셋 조건과 같음 */
function rookieRace(params) {
  return params.get('rookie') === '1' && params.get('mode') === 'race';
}

// 다음 rookie 레이스: settings.js 프리셋이 도움을 다시 켜므로, 카드에서 고른 값을 메모리에만 되돌려 둠 (저장은 이미 됨)
//   이 파일은 main.js가 불러올 때(게임이 settings를 읽기 전) 한 번 실행됨
try {
  const p = new URLSearchParams(location.search);
  const seen = readSeen();
  if (rookieRace(p) && seen && seen.choice && p.get('assistintro') !== '1') {
    for (const r of ROWS) if (r.key in seen.choice) settings.values[r.key] = seen.choice[r.key];
  }
  // 첫 레이스 주소에서 Esc 설정으로 도움을 바꾸면 그 선택도 기억 (다음 첫 레이스 주소에서 옛 선택으로 되돌아가지 않게)
  if (rookieRace(p)) {
    settings.onChange((k, v) => {
      if (!ROWS.some((r) => r.key === k)) return;
      const cur = readSeen();
      if (!cur) return;
      cur.choice = { ...(cur.choice || {}), [k]: v };
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(cur));
      } catch {}
    });
  }
} catch {}

function shouldShow(params) {
  const force = params.get('assistintro');
  if (force === '0') return false;
  if (params.has('room') || params.has('tutorial') || params.has('academy') || params.has('replay')) return false;
  if (force === '1') return true;
  if (!rookieRace(params)) return false;
  if (params.get('guide') === '0' || navigator.webdriver) return false;
  if (readSeen()) return false;
  return ROWS.some((r) => r.isOn(settings.values[r.key]));
}

// settings.set은 values 전체를 저장함 → 첫 레이스 프리셋(봇 3대·쉬움·고스트 끔·구간 기록 끔)이 영구 저장되지 않게,
//   카드에서 바꾼 키만 원래 저장값 위에 덮어 다시 씀 (메모리 값·바로 적용은 settings.set 그대로)
let storedBase = null;
function persistOnly(changed) {
  try {
    if (storedBase == null) return;
    const obj = { ...storedBase, ...changed };
    localStorage.setItem(SET_KEY, JSON.stringify(obj));
    storedBase = obj;
  } catch {}
}

let cssDone = false;
function ensureCss() {
  if (cssDone) return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./assistIntro.css', import.meta.url).href;
  document.head.appendChild(l);
}

function showCard(combinedCourse) {
  ensureCss();
  try {
    storedBase = JSON.parse(localStorage.getItem(SET_KEY) || '{}') || {};
  } catch {
    storedBase = null;
  }
  const touch = touchWanted();
  const usingPad = pad.connected() && !touch;
  // 휴대폰 터치에서는 키보드 조향 줄을 뺌 (터치 조향엔 상관없음). 강제(?assistintro=1)면 꺼진 것도 다 보임
  const force = new URLSearchParams(location.search).get('assistintro') === '1';
  const rows = ROWS.filter((r) => (r.isOn(settings.values[r.key]) || force) && !(touch && r.key === 'steerRamp'));
  const changed = {};
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'gm-confirm assist-intro';
    const menuWay = touch ? '☰ 메뉴' : usingPad ? '메뉴 버튼' : esc(keybinds.label('menu') || 'Esc');
    const kOk = touch ? '' : usingPad ? padKbd(0) : '<kbd>Enter</kbd>';
    const label = (id) => esc(usingPad ? pad.label(id) : keybinds.label(id));
    const drive = touch ? '왼쪽 조향 · 오른쪽 ▲ 가속 / ▼ 감속 · ↺ 복귀' : `${label('throttle')} 가속 · ${label('brake')} 감속 · ${label('respawn')} 복귀`;
    const fly = touch ? '비행: ⬆ 상승 · ⬇ 하강' : `비행: ${label('climb')} 상승 · ${label('dive')} 하강`;
    wrap.innerHTML = `<div class="box ai-box" role="dialog" aria-modal="true" aria-labelledby="aiTitle">
      <div class="ai-head"><span class="ai-badge">🛟</span><div><h3 id="aiTitle">주행 도움이 켜져 있어요</h3>
      <p class="ai-sub">첫 레이스라 운전을 도와주는 기능을 켰어요. 직접 해 보고 싶으면 지금 끄세요.</p></div></div>
      <div class="ai-body">
      ${combinedCourse ? `<div class="ai-course"><b>변신 연습장 · 가속 → 배 → 비행</b><p>직선·물길·활주로에서 자동 변신! 비행 대신 오른쪽 땅길로 가도 돼요.</p><p>${drive}<br>${fly}</p><p class="ai-start">빨간불 5개가 모두 꺼지면 가속! 지금은 신호가 멈춰 있어요.</p></div>` : ""}
      <div class="ai-rows" role="group" aria-label="주행 도움">${rows
        .map(
          (r) => `<button type="button" class="ai-row" role="switch" data-k="${r.key}" aria-checked="true">
          <span class="ai-ic" aria-hidden="true">${r.icon}</span><span class="ai-txt"><b>${r.name}</b><small>${r.desc}</small></span>
          <span class="ai-state"></span><span class="gm-switch on" aria-hidden="true"><i></i></span></button>`
        )
        .join('')}</div>
      <p class="ai-note">🛟 브레이크·조향 도움을 켜고 달리면 결과에 '도움 켬'이 표시돼요</p>
      </div>
      <div class="btns ai-btns"><button type="button" class="gm-btn" data-act="off">모두 끄기</button><button type="button" class="gm-btn primary" data-act="go">이대로 출발${kOk}</button></div>
      <p class="ai-later">나중에 ${menuWay} → 설정 → 운전·도움에서 바꿀 수 있어요</p></div>`;
    const rowEls = [...wrap.querySelectorAll('.ai-row')];
    const btnOff = wrap.querySelector('[data-act="off"]');
    const btnGo = wrap.querySelector('[data-act="go"]');
    const rowOf = (k) => ROWS.find((r) => r.key === k);
    const draw = () => {
      let anyOn = false;
      for (const el of rowEls) {
        const r = rowOf(el.dataset.k);
        const on = r.isOn(settings.values[r.key]);
        anyOn = anyOn || on;
        el.setAttribute('aria-checked', String(on));
        el.classList.toggle('off', !on);
        el.querySelector('.gm-switch').classList.toggle('on', on);
        el.querySelector('.ai-state').textContent = on ? '켜짐' : '꺼짐';
      }
      btnOff.disabled = !anyOn;
      wrap.querySelector('#aiTitle').textContent = anyOn ? '주행 도움이 켜져 있어요' : '주행 도움을 모두 껐어요';
      wrap.querySelector('.ai-sub').textContent = anyOn ? '첫 레이스라 운전을 도와주는 기능을 켰어요. 직접 해 보고 싶으면 지금 끄세요.' : '이제 내 조작 그대로 달려요. 어려우면 다시 켜도 돼요.';
      btnGo.firstChild.textContent = anyOn ? '이대로 출발' : '도움 없이 출발';
      wrap.querySelector('.ai-note').hidden = !RECORD_KEYS.some((k) => rowOf(k).isOn(settings.values[k]));
    };
    const setRow = (k, on) => {
      const r = rowOf(k);
      const v = on ? r.on : r.off;
      settings.set(k, v); // Esc 설정과 같은 저장·바로 적용
      changed[k] = v;
      persistOnly(changed);
    };
    const toggle = (el) => {
      const r = rowOf(el.dataset.k);
      setRow(r.key, !r.isOn(settings.values[r.key]));
      uiSound('toggle');
      draw();
    };
    const allOff = () => {
      for (const el of rowEls) setRow(el.dataset.k, false);
      uiSound('toggle');
      draw();
      btnGo.focus({ preventScroll: true });
    };
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onKey, true);
      // 고른 값 기억 (다음 첫 레이스 주소에서도 그대로)
      const choice = {};
      for (const el of rowEls) choice[el.dataset.k] = settings.values[el.dataset.k];
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify({ v: 1, at: Date.now(), choice }));
      } catch {}
      wrap.remove(); // 다른 맵에서 이어질 코스 안내가 자기 창을 찾을 수 있게 바로 지움
      uiSound('select');
      if (prevFocus && prevFocus.focus && prevFocus !== document.body) prevFocus.focus({ preventScroll: true });
      resolve(choice);
    };
    const focusables = () => [...rowEls, btnOff, btnGo].filter((b) => !b.disabled);
    const move = (d) => {
      const fs = focusables();
      let i = fs.indexOf(document.activeElement);
      if (i < 0) i = fs.indexOf(btnGo);
      fs[(i + d + fs.length) % fs.length].focus({ preventScroll: false });
      uiSound('move');
    };
    const onKey = (e) => {
      e.stopImmediatePropagation(); // 게임 키(가속 등)로 안 감
      const a = document.activeElement;
      const onRow = rowEls.includes(a);
      if (e.code === 'Escape') return e.preventDefault(), done();
      if (e.code === 'ArrowDown' || (e.code === 'Tab' && !e.shiftKey)) return e.preventDefault(), move(1);
      if (e.code === 'ArrowUp' || (e.code === 'Tab' && e.shiftKey)) return e.preventDefault(), move(-1);
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        if (onRow) {
          const r = rowOf(a.dataset.k);
          const want = e.code === 'ArrowRight';
          if (r.isOn(settings.values[r.key]) !== want) toggle(a);
        } else if (a === btnOff || a === btnGo) (a === btnGo && !btnOff.disabled ? btnOff : btnGo).focus(), uiSound('move');
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (e.repeat) return;
        if (onRow) toggle(a);
        else if (a === btnOff) allOff();
        else if (e.code !== 'Space' || a === btnGo) done();
      }
    };
    wrap.addEventListener('click', (e) => {
      const row = e.target.closest('.ai-row');
      if (row) return toggle(row);
      const b = e.target.closest('[data-act]');
      if (b && b.dataset.act === 'off') allOff();
      else if (b && b.dataset.act === 'go') done();
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    draw();
    btnGo.focus({ preventScroll: true }); // 실수로 Enter를 눌러도 도움이 꺼지지 않게 '출발'에 먼저
  });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * main.js 훅: 변신 연습장 첫 레이스는 코스 요약까지 한 번에, 다른 맵은 닫히면 next()(= 코스 첫 안내).
 *   돌려주는 state.open = 카드 또는 코스 안내가 열려 있는 동안 true (main.js가 출발 신호·물리를 멈춤)
 *   onClose(choice) = 카드가 닫힐 때 (main.js가 입력·시간을 정리하고 race.assist를 다시 계산)
 */
export function withAssistIntro(params, next, onClose) {
  if (!shouldShow(params)) return next();
  const st = {
    card: true,
    inner: null,
    get open() {
      return this.card || !!(this.inner && this.inner.open);
    },
  };
  const combinedCourse = rookieRace(params) && params.get('map') === 'starter';
  showCard(combinedCourse).then((choice) => {
    try {
      onClose && onClose(choice);
    } catch (e) {
      console.warn('assistIntro onClose', e);
    }
    try {
      if (combinedCourse) {
        // 코스 요약을 함께 읽었으므로 두 번째 창 없이 출발. 다른 맵 안내는 그대로.
        try { localStorage.setItem('gimmick.courseIntro.v1.starter', 'seen'); } catch {}
      } else st.inner = next();
    } catch (e) {
      console.warn('courseGuide', e);
    }
    st.card = false;
  });
  return st;
}
