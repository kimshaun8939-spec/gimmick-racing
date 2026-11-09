// 설정: 홈 화면과 ESC 메뉴가 같이 쓰는 설정 저장소 + 설정 화면(패널) 만들기
//   - 브라우저(localStorage 'gimmick.settings')에 저장되고, 바꾸면 바로 게임에 적용됨 (onChange로 알림)
//   - 화면은 소리 / 화면·그래픽 / 주행 / 표시 네 묶음. 마우스 또는 키보드(↑↓ 고르기, ←→ 바꾸기)로 조절

const KEY = 'gimmick.settings';

/** 설정 항목 정의: key, 묶음, 이름, 쉬운 설명, 종류(slider / toggle / choice), 기본값 */
export const SETTING_DEFS = [
  { group: '소리', key: 'masterVol', label: '전체 소리 크기', desc: '게임의 모든 소리', type: 'slider', def: 1 },
  { group: '소리', key: 'engineVol', label: '엔진 소리', desc: '부릉부릉 엔진음', type: 'slider', def: 1 },
  { group: '소리', key: 'fxVol', label: '효과음', desc: '변신·바람·연석·메뉴 소리', type: 'slider', def: 1 },
  { group: '소리', key: 'muted', label: '소리 끄기', desc: '게임 중 N 키와 같아요', type: 'toggle', def: false },

  { group: '화면·그래픽', key: 'quality', label: '그래픽 품질', desc: '노트북이 뜨거워지면 낮춰 보세요', type: 'choice',
    options: [['low', '낮음'], ['medium', '보통'], ['high', '높음']], def: 'high' },
  { group: '화면·그래픽', key: 'fpsCap', label: '프레임 제한', desc: '낮추면 배터리·발열이 줄어요', type: 'choice',
    options: [[30, '30'], [60, '60'], [0, '제한 없음']], def: 0 },
  { group: '화면·그래픽', key: 'speedFx', label: '속도감 효과', desc: '바람 줄기·속도선·시야 넓어짐', type: 'choice',
    options: [[0, '끔'], [0.5, '약하게'], [1, '보통'], [1.5, '강하게']], def: 1 },
  { group: '화면·그래픽', key: 'shake', label: '화면 흔들림', desc: '부딪힘·착지·연석에서 카메라 떨림', type: 'choice',
    options: [[0, '끔'], [0.5, '약하게'], [1, '보통']], def: 1 },
  { group: '화면·그래픽', key: 'fov', label: '시야 넓이', desc: '카메라가 보는 범위', type: 'choice',
    options: [[-6, '좁게'], [0, '보통'], [6, '넓게']], def: 0 },

  { group: '주행', key: 'gearbox', label: '변속 방식', desc: '게임 중 T 키로도 바꿔요 (수동: X 올림 · Z 내림)', type: 'choice',
    options: [['auto', '자동'], ['manual', '수동']], def: 'auto' },
  { group: '주행', key: 'racingLine', label: '레이싱 라인', desc: '도로 위 추천 길 (L 키)', type: 'toggle', def: true },
  { group: '주행', key: 'autoPause', label: '자동 일시정지', desc: '다른 창을 보면 게임을 멈춰요', type: 'toggle', def: true },

  { group: '표시', key: 'unit', label: '속도 단위', desc: '', type: 'choice', options: [['kmh', 'km/h'], ['mph', 'mph']], def: 'kmh' },
  { group: '표시', key: 'help', label: '조작법 안내', desc: '왼쪽 아래 조작법 (H 키로 고정)', type: 'choice',
    options: [['auto', '자동으로 숨김'], ['show', '항상 보기'], ['hide', '숨김']], def: 'auto' },
  { group: '표시', key: 'minimap', label: '미니맵', desc: '오른쪽 위 작은 지도', type: 'toggle', def: true },
  { group: '표시', key: 'showFps', label: 'FPS 보기', desc: '1초에 몇 장 그리는지', type: 'toggle', def: false },
];

const DEFAULTS = Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.def]));

function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {}
  const s = { ...DEFAULTS, ...saved };
  // 예전부터 쓰던 레이싱 라인 저장값(L 키)을 따름
  try {
    const rl = localStorage.getItem('racingLine');
    if (rl) s.racingLine = rl !== 'off';
  } catch {}
  return s;
}

/** 설정 저장소 (하나만 만들어 같이 씀) */
function createStore() {
  const values = load();
  const listeners = new Set();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(values));
      localStorage.setItem('racingLine', values.racingLine ? 'on' : 'off');
    } catch {}
  };
  return {
    values,
    get(k) {
      return values[k];
    },
    set(k, v) {
      if (values[k] === v) return;
      values[k] = v;
      save();
      for (const fn of listeners) fn(k, v, values);
    },
    /** 기본값으로 되돌리기 */
    reset() {
      for (const [k, v] of Object.entries(DEFAULTS)) this.set(k, v);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const settings = createStore();

/** 아주 작은 메뉴 소리 (효과음 크기·소리 끄기를 따름). kind: move / select / back / toggle */
let uiCtx = null;
export function uiSound(kind = 'move') {
  try {
    const v = settings.get('muted') ? 0 : settings.get('masterVol') * settings.get('fxVol');
    if (v <= 0.001) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!uiCtx) uiCtx = new AC();
    if (uiCtx.state === 'suspended') uiCtx.resume();
    const t = uiCtx.currentTime;
    const o = uiCtx.createOscillator();
    const g = uiCtx.createGain();
    const f = { move: [880, 990], select: [660, 1320], back: [700, 440], toggle: [1100, 1100] }[kind] || [880, 880];
    const dur = kind === 'select' ? 0.12 : 0.06;
    o.type = 'triangle';
    o.frequency.setValueAtTime(f[0], t);
    o.frequency.exponentialRampToValueAtTime(f[1], t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur + 0.04);
    o.connect(g).connect(uiCtx.destination);
    o.start(t);
    o.stop(t + dur + 0.06);
  } catch {}
}

/**
 * 설정 화면 만들기. 돌려주는 element를 아무 곳에나 붙이면 됨.
 * opts.inGame: 게임 중(ESC 메뉴)이면 "다음 시작부터 적용" 같은 안내를 다르게
 */
export function createSettingsPanel(opts = {}) {
  const root = document.createElement('div');
  root.className = 'gm-settings';
  const rows = [];
  let group = null, groupEl = null;
  for (const d of SETTING_DEFS) {
    if (d.group !== group) {
      group = d.group;
      groupEl = document.createElement('section');
      groupEl.className = 'gm-set-group';
      groupEl.innerHTML = `<h3>${group}</h3>`;
      root.appendChild(groupEl);
    }
    const row = document.createElement('div');
    row.className = 'gm-set-row';
    row.tabIndex = 0;
    row.dataset.nav = '';
    row.dataset.adjust = d.key;
    row.innerHTML = `<div class="gm-set-label"><b>${d.label}</b>${d.desc ? `<small>${d.desc}</small>` : ''}</div><div class="gm-set-ctl"></div>`;
    const ctl = row.querySelector('.gm-set-ctl');
    if (d.type === 'slider') {
      ctl.innerHTML = `<input type="range" min="0" max="100" step="5" tabindex="-1"><output></output>`;
      const r = ctl.querySelector('input');
      r.addEventListener('input', () => settings.set(d.key, +r.value / 100));
    } else if (d.type === 'toggle') {
      ctl.innerHTML = `<button class="gm-switch" tabindex="-1" aria-label="${d.label}"><i></i></button>`;
      ctl.querySelector('button').addEventListener('click', () => {
        settings.set(d.key, !settings.get(d.key));
        uiSound('toggle');
      });
    } else {
      ctl.innerHTML = `<div class="gm-seg">${d.options.map(([v, l], i) => `<button tabindex="-1" data-i="${i}">${l}</button>`).join('')}</div>`;
      ctl.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          settings.set(d.key, d.options[+b.dataset.i][0]);
          uiSound('toggle');
        }),
      );
    }
    groupEl.appendChild(row);
    rows.push({ d, row, ctl });
  }
  const foot = document.createElement('div');
  foot.className = 'gm-set-foot';
  foot.innerHTML = `<span>바꾸면 바로 적용되고 자동으로 저장돼요${opts.inGame ? '' : ''}</span><button class="gm-btn small" data-nav tabindex="0">기본값으로 되돌리기</button>`;
  foot.querySelector('button').addEventListener('click', () => {
    settings.reset();
    uiSound('select');
  });
  root.appendChild(foot);

  function refresh() {
    for (const { d, ctl } of rows) {
      const v = settings.get(d.key);
      if (d.type === 'slider') {
        const r = ctl.querySelector('input');
        if (document.activeElement !== r) r.value = Math.round(v * 100);
        r.style.setProperty('--p', `${Math.round(v * 100)}%`);
        ctl.querySelector('output').textContent = `${Math.round(v * 100)}%`;
      } else if (d.type === 'toggle') {
        ctl.querySelector('button').classList.toggle('on', !!v);
      } else {
        ctl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', d.options[+b.dataset.i][0] === v));
      }
    }
  }
  refresh();
  const off = settings.onChange(refresh);

  /** 키보드 ←→로 값 바꾸기 (key = 설정 이름, dir = -1 / +1) */
  function adjust(key, dir) {
    const d = SETTING_DEFS.find((x) => x.key === key);
    if (!d) return;
    const v = settings.get(key);
    if (d.type === 'slider') settings.set(key, Math.max(0, Math.min(1, Math.round((v + dir * 0.1) * 10) / 10)));
    else if (d.type === 'toggle') settings.set(key, !v);
    else {
      const i = d.options.findIndex((o) => o[0] === v);
      const j = Math.max(0, Math.min(d.options.length - 1, (i < 0 ? 0 : i) + dir));
      settings.set(key, d.options[j][0]);
    }
    uiSound('toggle');
  }
  // 클릭한 줄로 포커스 (마우스로 고른 줄도 키보드로 이어서 조절)
  root.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.gm-set-row');
    if (row) row.focus({ preventScroll: true });
  });
  return { el: root, adjust, refresh, destroy: off };
}

/** 조작법 화면 (홈·ESC 메뉴 같이 씀) */
export function createControlsPage() {
  const el = document.createElement('div');
  el.className = 'gm-controls';
  const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join('');
  const row = (keys, what, sub = '') => `<div class="gm-ctl-row"><div class="gm-keys">${keys}</div><div><b>${what}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
  el.innerHTML = `
    <section><h3>기본 운전</h3>
      ${row(k('W') + k('↑'), '가속', '꾹 누르면 페달이 서서히 끝까지')}
      ${row(k('S') + k('↓'), '브레이크 · 후진', '부스터 중이면 부스터가 바로 꺼져요')}
      ${row(k('A') + k('D') + k('←') + k('→'), '방향 바꾸기', '빠를수록 핸들이 덜 꺾여요')}
      ${row(k('Shift') + k('Space'), '드리프트', '꺾으면서 누르기')}
      ${row(k('E'), '부스터', '3초 동안 더 빠르게 · 무제한')}
    </section>
    <section><h3>레이스</h3>
      ${row('<span class="gm-lights"><i></i><i></i><i></i><i></i><i></i></span>', '출발 신호', '빨간불 5개가 꺼지는 순간 W! 미리 밟으면 시동이 꺼져요')}
      ${row(k('R'), '도로로 복귀', '길을 벗어났거나 뒤집혔을 때')}
      ${row(k('Enter'), '처음부터 다시')}
      ${row(k('Esc'), '메뉴 · 일시정지', '설정, 다시 시작, 홈으로')}
    </section>
    <section><h3>자동 변신 모드</h3>
      ${row('🚗', '일반', '평소 모드')}
      ${row('🔥', '가속', '150 km/h를 넘고 핸들이 곧으면 자동 · 빠르지만 조금 미끄러워요')}
      ${row('🚤', '배', '물에 닿으면 자동')}
      ${row('✈️', '비행', '활주로에서 자동 · Space 이륙/상승 · Shift 하강 · A/D 선회')}
    </section>
    <section><h3>그 밖에</h3>
      ${row(k('T'), '자동 ↔ 수동 변속', '수동: ' + k('X') + ' 올림 · ' + k('Z') + ' 내림')}
      ${row(k('L'), '레이싱 라인 켜기/끄기', '초록 = 밟기 · 노랑 = 떼기 · 빨강 = 브레이크')}
      ${row(k('N'), '소리 끄기/켜기')}
      ${row(k('H'), '조작법 안내 고정')}
      ${row(k('M'), '다음 맵으로')}
    </section>
    <p class="gm-tip">💡 코너 안쪽 빨간·흰 연석을 빠르게 스치면 <b>에이펙스 보너스</b>! 보라색 자석 도로는 벽과 천장도 달릴 수 있어요.</p>`;
  return el;
}

/**
 * 화살표 키로 가까운 버튼/줄로 이동 (격자·목록 모두). container 안의 [data-nav] 중에서 고름
 * @returns 이동했으면 true
 */
export function spatialMove(container, dir) {
  const items = [...container.querySelectorAll('[data-nav]')].filter((e) => e.offsetParent !== null && !e.disabled);
  if (!items.length) return false;
  const cur = document.activeElement;
  if (!items.includes(cur)) {
    items[0].focus();
    return true;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const e of items) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    let main, side;
    if (dir === 'up') (main = -dy), (side = Math.abs(dx));
    else if (dir === 'down') (main = dy), (side = Math.abs(dx));
    else if (dir === 'left') (main = -dx), (side = Math.abs(dy));
    else (main = dx), (side = Math.abs(dy));
    if (main <= 4) continue;
    const score = main + side * 2.2;
    if (score < bestScore) (bestScore = score), (best = e);
  }
  if (!best) return false;
  best.focus();
  best.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return true;
}

/**
 * 확인 창: "정말 홈으로 갈까요?" → 예/아니오. Enter = 예, Esc = 아니오
 * @returns Promise<boolean>
 */
export function confirmDialog(title, text, okLabel = '확인', cancelLabel = '취소') {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'gm-confirm';
    wrap.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3></h3><p></p><div class="btns"><button class="gm-btn" data-r="0"></button><button class="gm-btn primary" data-r="1"></button></div></div>`;
    wrap.querySelector('h3').textContent = title;
    wrap.querySelector('p').textContent = text;
    wrap.querySelector('[data-r="0"]').textContent = cancelLabel;
    wrap.querySelector('[data-r="1"]').innerHTML = `${okLabel}<kbd>Enter</kbd>`;
    const done = (r) => {
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      uiSound(r ? 'select' : 'back');
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      resolve(r);
    };
    const onKey = (e) => {
      e.stopImmediatePropagation();
      if (e.code === 'Escape') (e.preventDefault(), done(false));
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        done(document.activeElement && document.activeElement.dataset.r === '0' ? false : true);
      } else if (['ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
        const bs = wrap.querySelectorAll('button');
        (document.activeElement === bs[1] ? bs[0] : bs[1]).focus();
        uiSound('move');
      }
    };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) done(b.dataset.r === '1');
      else if (e.target === wrap) done(false);
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-r="1"]').focus();
  });
}

/** 지금 이 창이 입력을 받는 확인 창을 띄우고 있는지 */
export function dialogOpen() {
  return !!document.querySelector('.gm-confirm');
}
