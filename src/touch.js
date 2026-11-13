// 터치 조작 (휴대폰·태블릿). input.js가 read()에 섞음 → main.js는 몰라도 됨
//   - 왼쪽: 조향 (끌기 패드 = 처음 닿은 곳에서 옆으로 끈 만큼 아날로그 / 버튼 = ◀ ▶)
//   - 오른쪽: 가속(큰 버튼) · 브레이크 · 드리프트 (비행 중에는 상승 · 하강)
//   - 작은 버튼: ↺ 복귀 · ☰ 메뉴 · 그 아래 👁 시점 바꾸기 (2026-11-12, 백미러와 안 겹치게 아래 줄)
//   - 기울여 조향 (DeviceOrientation, 설정에서 켬, 기본 끔). iPhone은 처음 켤 때 허락을 물어봄
//   - 세로 화면으로 달리면 "가로로 돌려 주세요" 안내
//   설정: touchCtl ('auto' = 터치 기기면 켬 | 'on' | 'off'), touchSteer ('pad' | 'buttons'), tilt (true/false), touchSize ('s'|'m'|'l')
import { settings } from './settings.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// 휴대폰·태블릿 = 주 입력이 손가락 (pointer: coarse). 터치 화면 노트북은 마우스가 주 입력이라 아님 →
// 그래도 화면을 손가락으로 실제로 만지면 그때부터 버튼을 보여 줌
let touchSeen = false;
try {
  window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && (touchSeen = true), { capture: true, passive: true });
} catch {}
export const isTouchDevice = () => {
  try {
    return touchSeen || matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
};

const state = { steer: 0, throttle: 0, brake: 0, drift: false, climb: false, dive: false };
const actionListeners = new Set();
let releaseAll = () => {};
let root = null, mounted = false, lastTouchUse = 0, tiltVal = 0, tiltOn = false;

// PC에서 한 번 만진 뒤 키보드로 돌아오면 터치 HUD가 계속 남지 않게 함.
// capture로 메뉴가 키를 막기 전에 처리. 휴대폰·태블릿과 강제 켜기 설정은 유지.
window.addEventListener('keydown', (e) => {
  if (!e.isTrusted || e.gmPad || !touchSeen || matchMedia('(pointer: coarse)').matches) return;
  touchSeen = false;
  lastTouchUse = 0;
  releaseAll();
  update();
}, { capture: true });

/** 메뉴 키처럼 (main.js가 Esc로 메뉴를 엶). input.js는 gmPad 표시가 있는 키를 무시 */
function sendEsc() {
  const ev = new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true });
  ev.gmPad = true;
  window.dispatchEvent(ev);
}

/** 켜져야 하나 (설정 + 기기) */
export function touchWanted() {
  const v = settings.values.touchCtl || 'auto';
  return v === 'on' || (v === 'auto' && isTouchDevice());
}

/** 화면 위 버튼들을 지금 보여 줘야 하나 (메뉴·결과·확인 창·튜토리얼 설명 중에는 숨김) */
function blocked() {
  const q = (s) => document.querySelector(s);
  if (q('#pauseMenu.on') || q('#results.on') || q('.gm-confirm') || q('#lobby')) return true;
  const g = window.game;
  if (g && g.tutorial && g.tutorial.phase === 'card') return true;
  const ld = q('#loading');
  return !!(ld && !ld.classList.contains('out'));
}

function build() {
  root = document.createElement('div');
  root.id = 'touchCtl';
  root.innerHTML = `
    <div class="tc-zone" data-z="steer"><div class="tc-base"><i class="tc-knob"></i><span class="l">◀</span><span class="r">▶</span></div></div>
    <div class="tc-steerbtns"><button class="tc-btn tc-left" data-hold="left" aria-label="왼쪽">◀</button><button class="tc-btn tc-right" data-hold="right" aria-label="오른쪽">▶</button></div>
    <button class="tc-btn tc-gas" data-hold="throttle" aria-label="가속"><b>▲</b><small>가속</small></button>
    <button class="tc-btn tc-brake" data-hold="brake" aria-label="브레이크"><b>▼</b><small class="lb">브레이크</small></button>
    <button class="tc-btn tc-drift" data-hold="drift" aria-label="드리프트"><b>💨</b><small class="lb">드리프트</small></button>
    <button class="tc-btn tc-dive" data-hold="dive" aria-label="하강"><b>⬇</b><small>하강</small></button>
    <div class="tc-small"><button class="tc-btn tc-mini" data-tap="respawn" aria-label="도로로 복귀">↺<small>복귀</small></button><button class="tc-btn tc-mini" data-tap="menu" aria-label="메뉴">☰<small>메뉴</small></button><button class="tc-btn tc-mini tc-cam" data-tap="camView" aria-label="시점 바꾸기" style="position:absolute;top:calc(100% + 8px);right:0">👁<small>시점</small></button></div>
    <div class="tc-tilt">📱 기울여 조향</div>
    <div id="rotateHint"><div class="box"><div class="ph">📱</div><b>가로로 돌려 주세요</b><small>가로 화면이 훨씬 잘 보이고 버튼도 편해요</small><button class="gm-btn small" data-rot>세로로 할게요</button></div></div>`;
  document.body.appendChild(root);

  const held = { left: new Set(), right: new Set(), throttle: new Set(), brake: new Set(), drift: new Set(), dive: new Set() };
  const sync = () => {
    state.throttle = held.throttle.size ? 1 : 0;
    state.brake = held.brake.size ? 1 : 0;
    state.drift = held.drift.size > 0;
    state.dive = held.dive.size > 0;
    state.climb = state.drift; // 비행 중에는 드리프트 버튼 = 상승
    root.querySelectorAll('[data-hold]').forEach((b) => b.classList.toggle('on', held[b.dataset.hold].size > 0));
  };
  const cap = (el, id) => {
    try {
      el.setPointerCapture(id);
    } catch {}
  };
  // 누르고 있는 버튼 (여러 손가락 동시에)
  root.querySelectorAll('[data-hold]').forEach((b) => {
    const k = b.dataset.hold;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lastTouchUse = performance.now();
      cap(b, e.pointerId);
      held[k].add(e.pointerId);
      sync();
      if (navigator.vibrate && k !== 'throttle' && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) try { navigator.vibrate(8); } catch {}
    });
    const up = (e) => {
      held[k].delete(e.pointerId);
      sync();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  // 한 번 누르는 버튼
  root.querySelectorAll('[data-tap]').forEach((b) =>
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lastTouchUse = performance.now();
      if (b.dataset.tap === 'menu') sendEsc();
      else for (const fn of actionListeners) fn(b.dataset.tap);
      b.classList.add('on');
      setTimeout(() => b.classList.remove('on'), 140);
    }),
  );
  // 끌기 패드: 닿은 곳이 가운데, 옆으로 RANGE px 끌면 끝까지
  const zone = root.querySelector('.tc-zone'), base = root.querySelector('.tc-base'), knob = root.querySelector('.tc-knob');
  let sp = null; // { id, x0 }
  const RANGE = () => (settings.values.touchSize === 'l' ? 80 : settings.values.touchSize === 's' ? 55 : 68);
  const homeBase = () => {
    base.style.left = '';
    base.style.top = '';
    knob.style.transform = '';
    base.classList.remove('on');
  };
  zone.addEventListener('pointerdown', (e) => {
    if (sp) return;
    e.preventDefault();
    lastTouchUse = performance.now();
    cap(zone, e.pointerId);
    const r = zone.getBoundingClientRect();
    sp = { id: e.pointerId, x0: e.clientX };
    base.style.left = `${e.clientX - r.left}px`;
    base.style.top = `${e.clientY - r.top}px`;
    base.classList.add('on');
    state.steer = 0;
  });
  zone.addEventListener('pointermove', (e) => {
    if (!sp || e.pointerId !== sp.id) return;
    const dx = clamp((e.clientX - sp.x0) / RANGE(), -1, 1);
    // 가운데 조금은 무시 + 살짝 곡선 (작게 끌면 섬세하게)
    const a = Math.abs(dx) < 0.06 ? 0 : Math.sign(dx) * Math.pow((Math.abs(dx) - 0.06) / 0.94, 1.3);
    state.steer = a;
    knob.style.transform = `translateX(${dx * RANGE()}px)`;
  });
  const zoneUp = (e) => {
    if (!sp || e.pointerId !== sp.id) return;
    sp = null;
    state.steer = 0;
    homeBase();
  };
  zone.addEventListener('pointerup', zoneUp);
  zone.addEventListener('pointercancel', zoneUp);
  zone.addEventListener('lostpointercapture', zoneUp);
  // 조향 버튼 모드 → steer는 read()에서 held로 계산
  touch._held = held;
  // 메뉴·결과 화면이 뜨면 누르고 있던 것 모두 놓기 (손가락을 뗀 신호를 못 받을 수 있음)
  releaseAll = () => {
    for (const k in held) held[k].clear();
    sp = null;
    state.steer = 0;
    homeBase();
    sync();
  };
  root.querySelector('[data-rot]').addEventListener('click', () => {
    try {
      sessionStorage.setItem('gimmick.portraitOk', '1');
    } catch {}
    document.body.classList.add('rotate-ok');
  });
  try {
    if (sessionStorage.getItem('gimmick.portraitOk')) document.body.classList.add('rotate-ok');
  } catch {}
  // 화면 아무 데나 처음 만질 때: 기울기 허락 받기 (iPhone)
  window.addEventListener('pointerdown', askTilt, { capture: true });
  // 설정에서 '기울여 조향'을 켜는 순간 (누른 손가락 = 허락 물어볼 수 있는 때)
  settings.onChange((k, v) => {
    if (k !== 'tilt' || !v) return;
    tiltAsked = false;
    askTilt();
  });
  // 다른 앱으로 갔다 오면 누르고 있던 것 놓기
  window.addEventListener('blur', () => releaseAll());
  document.addEventListener('visibilitychange', () => document.hidden && releaseAll());
}

// ------------------------------------------------------------------ 기울여 조향
let tiltAsked = false, tiltListening = false;
function onOrient(e) {
  if (!tiltOn) return;
  const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  // 가로(90): 앞뒤 기울기(beta)가 핸들, 반대 가로(270/-90): 반대로, 세로: 좌우 기울기(gamma)
  let v = ang === 90 ? e.beta : ang === 270 || ang === -90 ? -e.beta : e.gamma;
  if (v == null) return;
  v = clamp(v / 28, -1, 1);
  tiltVal = Math.abs(v) < 0.08 ? 0 : v;
}
function listenTilt() {
  if (tiltListening) return;
  tiltListening = true;
  window.addEventListener('deviceorientation', onOrient);
}
function askTilt() {
  if (!settings.values.tilt || tiltAsked) return;
  tiltAsked = true;
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    D.requestPermission()
      .then((r) => r === 'granted' && listenTilt())
      .catch(() => {});
  } else listenTilt();
}

// ------------------------------------------------------------------ 매 프레임: 보이기·숨기기
function frame() {
  requestAnimationFrame(frame);
  update();
}
// 창이 숨겨져 rAF가 멈춰도 (game.tick) read()에서 같이 부름
const setText = (el, t) => {
  if (el.textContent !== t) el.textContent = t;
};
function update() {
  if (!root) return;
  const want = touchWanted();
  const show = want && !blocked();
  document.body.classList.toggle('touch-on', want);
  if (!show && root.classList.contains('show')) releaseAll();
  root.classList.toggle('show', show);
  root.classList.toggle('btnsteer', (settings.values.touchSteer || 'pad') === 'buttons');
  root.dataset.size = settings.values.touchSize || 'm';
  tiltOn = want && !!settings.values.tilt;
  root.classList.toggle('tilt', tiltOn);
  if (tiltOn && !tiltAsked && !(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function')) askTilt();
  const g = window.game, car = g && g.car;
  const fly = !!(car && car.mode === 'fly');
  root.classList.toggle('fly', fly);
  setText(root.querySelector('.tc-drift .lb'), fly ? '상승' : '드리프트');
  setText(root.querySelector('.tc-drift b'), fly ? '⬆' : '💨');
  setText(root.querySelector('.tc-brake .lb'), fly ? '감속' : '브레이크');
  // 레이스 중 세로 화면 → 돌려 달라는 안내
  root.classList.toggle('racing', !!(g && g.race && !blocked()));
}

export const touch = {
  /** 게임 화면에 버튼 만들기 (input.js가 부름, 한 번만) */
  mount() {
    if (mounted || typeof document === 'undefined') return;
    mounted = true;
    const go = () => {
      build();
      requestAnimationFrame(frame);
    };
    if (document.body) go();
    else document.addEventListener('DOMContentLoaded', go, { once: true });
  },
  /** 지금 터치 입력 (메뉴가 떠 있거나 꺼져 있으면 0) */
  read() {
    const out = { steer: 0, throttle: 0, brake: 0, drift: false, climb: false, dive: false };
    update();
    if (!root || !root.classList.contains('show')) return out;
    let steer = state.steer;
    if (touch._held) steer += (touch._held.right.size ? 1 : 0) - (touch._held.left.size ? 1 : 0);
    if (tiltOn) steer += tiltVal;
    out.steer = clamp(steer, -1, 1);
    out.throttle = state.throttle;
    out.brake = state.brake;
    out.drift = state.drift;
    out.climb = state.climb;
    out.dive = state.dive;
    return out;
  },
  /** 마지막에 쓴 게 터치인가 */
  usingTouch: () => !!root && root.classList.contains('show') && lastTouchUse > 0,
  lastUse: () => lastTouchUse,
  /** 한 번 누르는 버튼 (복귀) → input.js가 "이번 프레임에 눌림"으로 */
  onAction(fn) {
    actionListeners.add(fn);
    return () => actionListeners.delete(fn);
  },
  get el() {
    return root;
  },
};
