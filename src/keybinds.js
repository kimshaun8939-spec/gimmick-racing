// 조작키 바꾸기: "행동(가속·브레이크·복귀…) → 키 2개(기본 + 보조)" 표를 브라우저(localStorage 'gimmick.keys')에 저장
//   - input.js가 이 표를 보고 키를 행동으로 바꿈 (게임 코드는 행동만 봄)
//   - 예전 코드가 input.wasPressed('KeyR')처럼 "기본 키 이름"으로 물어봐도, 그 키의 행동(복귀)으로 바꿔서 답함 (LEGACY)
//   - 설정 화면의 "조작키" 탭(createKeybindPanel)에서 클릭 → 새 키 누르기로 바꿈. 겹치면 경고
//   - 키 이름은 e.code(자판 위치) 기준이라 한글 입력 상태여도 똑같이 동작
//
// 행동 목록을 바꾸려면 ACTIONS만 고치면 됨. ctx: 'ground' = 땅에서만, 'fly' = 비행 중에만 (둘은 같은 키를 써도 안 겹침)

const STORE = 'gimmick.keys';

/** 행동 목록: id, 묶음, 이름, 설명, 기본 키 [기본, 보조], ctx(언제 쓰는지), lock(바꿀 수 없는 칸 번호) */
export const ACTIONS = [
  { group: '운전', id: 'throttle', label: '가속', desc: '꾹 누르면 페달이 서서히 끝까지', def: ['KeyW', 'ArrowUp'] },
  { group: '운전', id: 'brake', label: '브레이크 · 후진', desc: '서 있을 때 누르면 뒤로', def: ['KeyS', 'ArrowDown'] },
  { group: '운전', id: 'left', label: '왼쪽으로', desc: '비행 중엔 왼쪽으로 기울여 선회', def: ['KeyA', 'ArrowLeft'] },
  { group: '운전', id: 'right', label: '오른쪽으로', desc: '비행 중엔 오른쪽으로 기울여 선회', def: ['KeyD', 'ArrowRight'] },
  { group: '운전', id: 'drift', label: '드리프트', desc: '꺾으면서 누르기 (땅에서)', def: ['ShiftLeft', 'Space'], ctx: 'ground' },
  { group: '운전', id: 'booster', label: '부스터', desc: '3초 동안 최고 속도 ↑ · 브레이크로 끄기', def: ['KeyE', null] },
  { group: '비행', id: 'climb', label: '이륙 · 상승', desc: '활주로에서 약 94 km/h를 넘으면 이륙', def: ['Space', null], ctx: 'fly' },
  { group: '비행', id: 'dive', label: '하강', desc: '기수를 아래로', def: ['ShiftLeft', null], ctx: 'fly' },
  { group: '변속', id: 'gearbox', label: '자동 ↔ 수동 변속', desc: '', def: ['KeyT', null] },
  { group: '변속', id: 'shiftUp', label: '기어 올림 (수동)', desc: '', def: ['KeyX', null] },
  { group: '변속', id: 'shiftDown', label: '기어 내림 (수동)', desc: '', def: ['KeyZ', null] },
  { group: '레이스', id: 'respawn', label: '도로로 복귀', desc: '길을 벗어났거나 뒤집혔을 때', def: ['KeyR', null] },
  { group: '레이스', id: 'restart', label: '처음부터 다시', desc: '', def: ['Enter', null] },
  { group: '레이스', id: 'menu', label: '메뉴 · 일시정지', desc: 'Esc는 항상 메뉴 (보조 키만 바꿀 수 있어요)', def: ['Escape', null], lock: [0] },
  { group: '도움 · 화면', id: 'racingLine', label: '레이싱 라인 켜기/끄기', desc: '', def: ['KeyL', null] },
  { group: '도움 · 화면', id: 'sound', label: '소리 끄기/켜기', desc: '', def: ['KeyN', null] },
  { group: '도움 · 화면', id: 'map', label: '다음 맵으로', desc: '', def: ['KeyM', null] },
];
const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

/** 예전 코드가 쓰던 "기본 키 이름" → 행동 (input.wasPressed('KeyR') → 복귀 키가 눌렸나) */
export const LEGACY = {
  Enter: 'restart', KeyM: 'map', KeyR: 'respawn', KeyT: 'gearbox', KeyN: 'sound', KeyL: 'racingLine',
  KeyE: 'booster', KeyX: 'shiftUp', KeyZ: 'shiftDown',
};

/** 바꿀 수 없는 키 (메뉴·브라우저용) */
const RESERVED = new Set(['Escape', 'Tab', 'MetaLeft', 'MetaRight', 'ContextMenu', 'F5', 'F11', 'F12', 'PrintScreen']);

// 왼쪽·오른쪽 구분이 있는 키: 한쪽만 정해 두면 반대쪽도 같은 행동 (반대쪽을 따로 정했으면 그쪽을 따름)
const TWIN = {
  ShiftLeft: 'ShiftRight', ShiftRight: 'ShiftLeft', ControlLeft: 'ControlRight', ControlRight: 'ControlLeft',
  AltLeft: 'AltRight', AltRight: 'AltLeft', NumpadEnter: 'Enter',
};

const defaults = () => Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.def]]));

function load() {
  const b = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    for (const [id, keys] of Object.entries(saved.binds || saved)) {
      if (!BY_ID[id] || !Array.isArray(keys)) continue;
      const a = BY_ID[id];
      b[id] = [0, 1].map((s) => ((a.lock || []).includes(s) ? a.def[s] : typeof keys[s] === 'string' && keys[s] ? keys[s] : null));
    }
  } catch {}
  return b;
}

let binds = load();
let lookup = null; // 키 → [행동 id]
const listeners = new Set();

function rebuild() {
  lookup = new Map();
  for (const a of ACTIONS)
    for (const k of binds[a.id]) {
      if (!k) continue;
      if (!lookup.has(k)) lookup.set(k, []);
      if (!lookup.get(k).includes(a.id)) lookup.get(k).push(a.id);
    }
}
rebuild();

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ v: 1, binds }));
  } catch {}
}
function changed() {
  rebuild();
  save();
  for (const fn of listeners) fn(binds);
}

/**
 * 게임에서 지금 쓰는 기능 (꺼진 기능의 키는 조작법·조작키·불러오는 화면에서 숨김)
 *   booster: data/car.json의 booster.enabled (2026-11-09부터 꺼 둠)
 */
export const features = { booster: false };
export const actionVisible = (id) => id !== 'booster' || features.booster;
try {
  fetch('data/car.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const on = !!(j && j.booster && j.booster.enabled);
      if (on === features.booster) return;
      features.booster = on;
      for (const fn of listeners) fn(binds); // 화면들이 다시 그림
    })
    .catch(() => {});
} catch {}
// 다른 탭(홈 ↔ 게임)에서 바꿔도 따라감
try {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE) return;
    binds = load();
    rebuild();
    for (const fn of listeners) fn(binds);
  });
} catch {}

/** 이 키(e.code)를 누르면 어떤 행동들이 되는지 */
export function actionsFor(code) {
  if (!code) return [];
  const own = lookup.get(code);
  if (own && own.length) return own;
  const twin = TWIN[code];
  return (twin && lookup.get(twin)) || [];
}

/** 키 이름 → 화면에 보이는 짧은 글자 */
export function codeLabel(code) {
  if (!code) return '';
  const m = /^Key([A-Z])$/.exec(code) || /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  const np = /^Numpad(\d)$/.exec(code);
  if (np) return `숫자판 ${np[1]}`;
  const f = /^F(\d+)$/.exec(code);
  if (f) return code;
  return (
    {
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter', NumpadEnter: '숫자판 Enter', Escape: 'Esc',
      ShiftLeft: 'Shift', ShiftRight: '오른쪽 Shift', ControlLeft: 'Ctrl', ControlRight: '오른쪽 Ctrl', AltLeft: 'Alt', AltRight: '오른쪽 Alt',
      Backspace: '⌫ Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', CapsLock: 'Caps Lock',
      Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
      Comma: ',', Period: '.', Slash: '/', NumpadAdd: '숫자판 +', NumpadSubtract: '숫자판 -', NumpadMultiply: '숫자판 *', NumpadDivide: '숫자판 /',
      NumpadDecimal: '숫자판 .', Lang1: '한/영', Lang2: '한자', IntlBackslash: '\\', IntlRo: 'Ro', IntlYen: '¥',
    }[code] || code
  );
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const keybinds = {
  ACTIONS,
  /** 행동의 키 [기본, 보조] (없으면 null) */
  get(id) {
    return binds[id] ? [...binds[id]] : [null, null];
  },
  /** 행동의 키들 (빈 칸 빼고) */
  keys(id) {
    return (binds[id] || []).filter(Boolean);
  },
  /** 키 하나 정하기. slot = 0(기본) / 1(보조). code = null이면 비움 */
  set(id, slot, code) {
    const a = BY_ID[id];
    if (!a || (a.lock || []).includes(slot)) return false;
    if (code && RESERVED.has(code)) return false;
    const cur = binds[id];
    if (code && cur[1 - slot] === code) cur[1 - slot] = null; // 같은 행동의 다른 칸에 있으면 옮김
    cur[slot] = code || null;
    // 보조만 남으면 기본 칸으로 당김
    if (!cur[0] && cur[1] && !(a.lock || []).includes(0)) (cur[0] = cur[1]), (cur[1] = null);
    changed();
    return true;
  },
  /** 한 행동만 기본값으로 */
  resetAction(id) {
    if (!BY_ID[id]) return;
    binds[id] = [...BY_ID[id].def];
    changed();
  },
  /** 모두 기본값으로 */
  reset() {
    binds = defaults();
    changed();
  },
  /** 기본값과 다른지 */
  isDefault(id) {
    const a = BY_ID[id];
    return !!a && a.def[0] === binds[id][0] && a.def[1] === binds[id][1];
  },
  allDefault() {
    return ACTIONS.every((a) => this.isDefault(a.id));
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** 이 행동과 같은 키를 쓰는(같은 때 쓰여서 겹치는) 다른 행동들: [{ id, label, code }] */
  conflictsOf(id) {
    const a = BY_ID[id];
    if (!a || !actionVisible(id)) return [];
    const out = [];
    for (const code of binds[id]) {
      if (!code) continue;
      for (const b of ACTIONS) {
        if (b.id === id || !overlap(a, b) || !actionVisible(b.id)) continue;
        if (binds[b.id].some((k) => k && (k === code || TWIN[k] === code || TWIN[code] === k)))
          if (!out.some((o) => o.id === b.id)) out.push({ id: b.id, label: b.label, code });
      }
    }
    return out;
  },
  /** 이 키를 이미 쓰는 다른 행동 (바꾸기 전에 경고용) */
  whoUses(code, exceptId) {
    const a = BY_ID[exceptId];
    return ACTIONS.filter((b) => b.id !== exceptId && actionVisible(b.id) && (!a || overlap(a, b)) && binds[b.id].includes(code));
  },
  label(id) {
    return this.keys(id).map(codeLabel).join(' / ');
  },
  /** <kbd> 글자 (조작법 화면용). 키가 없으면 '없음' */
  html(id, max = 2) {
    const ks = this.keys(id).slice(0, max);
    return ks.length ? ks.map((k) => `<kbd>${escHtml(codeLabel(k))}</kbd>`).join('') : '<kbd class="none">없음</kbd>';
  },
  /** 첫 번째 키 이름 (안내 글자용, 예: "R") */
  main(id) {
    const k = this.keys(id)[0];
    return k ? codeLabel(k) : '?';
  },
  isReserved: (code) => RESERVED.has(code),
};

/** 두 행동이 같은 때 쓰이는지 (땅 전용과 비행 전용은 같은 키여도 괜찮음) */
function overlap(a, b) {
  const x = a.ctx || 'all', y = b.ctx || 'all';
  return x === 'all' || y === 'all' || x === y;
}

/**
 * 새 키 누르기 창: "가속에 쓸 키를 누르세요" → Promise<code | null(취소) | ''(비우기)>
 *   Esc = 취소, Backspace/Delete = 이 칸 비우기. 확인 창(.gm-confirm)과 같은 모양이라 다른 메뉴는 키를 안 받음
 */
export function captureKey(title, sub = '') {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'gm-confirm gm-capture';
    wrap.innerHTML = `<div class="box" role="dialog" aria-modal="true">
      <div class="kb-wave"><i></i><i></i><i></i></div>
      <h3></h3><p class="sub"></p>
      <div class="kb-press">⌨️ 쓰고 싶은 키를 누르세요</div>
      <p class="hint"><kbd>Esc</kbd> 취소 · <kbd>Backspace</kbd> 이 칸 비우기</p>
      <div class="btns"><button class="gm-btn small" data-r="clear">비우기</button><button class="gm-btn small" data-r="cancel">취소</button></div></div>`;
    wrap.querySelector('h3').textContent = title;
    wrap.querySelector('.sub').textContent = sub;
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', eat, true);
      wrap.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      resolve(r);
    };
    // Shift는 e.code가 비어 올 때가 있음 (input.js와 같은 방법으로 알아봄)
    const codeOf = (e) => (e.key === 'Shift' && !/^Shift(Left|Right)$/.test(e.code) ? (e.location === 2 ? 'ShiftRight' : 'ShiftLeft') : e.code);
    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const code = codeOf(e);
      if (code === 'Escape') return finish(null);
      if (code === 'Backspace' || code === 'Delete') return finish('');
      if (!code || code === 'Unidentified') {
        wrap.querySelector('.kb-press').textContent = '이 키는 알아볼 수 없어요. 다른 키를 눌러 주세요';
        return;
      }
      if (RESERVED.has(code)) {
        wrap.querySelector('.kb-press').textContent = `${codeLabel(code)} 키는 쓸 수 없어요 (메뉴·브라우저용)`;
        wrap.querySelector('.kb-press').classList.add('bad');
        return;
      }
      finish(code);
    };
    const eat = (e) => e.stopImmediatePropagation();
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) finish(b.dataset.r === 'clear' ? '' : null);
      else if (e.target === wrap) finish(null);
    });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', eat, true);
    document.body.appendChild(wrap);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
}

/**
 * 조작키 설정 화면. { el, refresh, destroy }
 *   줄마다 [기본 키] [보조 키] [↺] 버튼. 클릭(또는 Enter) → 새 키 누르기. 겹치면 줄이 빨개지고 아래에 알림 + "겹친 쪽에서 빼기"
 *   opts.sound(kind): 메뉴 소리 (settings.js의 uiSound)
 */
export function createKeybindPanel(opts = {}) {
  const sound = opts.sound || (() => {});
  const root = document.createElement('div');
  root.className = 'gm-keys-panel';
  const note = document.createElement('div');
  note.className = 'kb-note';
  root.appendChild(note);
  const rows = [];
  let group = null, groupEl = null;
  for (const a of ACTIONS) {
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
    row.innerHTML = `<div class="gm-set-label"><b>${escHtml(a.label)}</b><small class="kb-desc">${escHtml(a.desc || '')}</small></div>
      <div class="kb-slots">
        <button class="kb-slot" data-nav data-slot="0" title="기본 키"></button>
        <button class="kb-slot alt" data-nav data-slot="1" title="보조 키"></button>
        <button class="kb-reset" data-nav data-reset title="이 줄만 기본값으로">↺</button>
      </div>`;
    groupEl.appendChild(row);
    rows.push({ a, row });
  }
  const foot = document.createElement('div');
  foot.className = 'gm-set-foot';
  foot.innerHTML = `<span>칸을 누르고 새 키를 누르면 바뀌어요 · 자동으로 저장돼요</span><button class="gm-btn small" data-nav data-resetall>모든 키 기본값으로</button>`;
  root.appendChild(foot);

  let lastMsg = null; // { id, code, others: [id] }
  function refresh() {
    for (const { a, row } of rows) {
      row.hidden = !actionVisible(a.id);
      const ks = binds[a.id];
      row.querySelectorAll('.kb-slot').forEach((b) => {
        const s = +b.dataset.slot;
        const locked = (a.lock || []).includes(s);
        b.innerHTML = ks[s] ? `<kbd>${escHtml(codeLabel(ks[s]))}</kbd>${locked ? '<span class="lock">🔒</span>' : ''}` : '<span class="empty">+ 추가</span>';
        b.classList.toggle('locked', locked);
        b.disabled = locked;
      });
      const c = keybinds.conflictsOf(a.id);
      row.classList.toggle('conflict', c.length > 0);
      row.classList.toggle('custom', !keybinds.isDefault(a.id));
      row.querySelector('.kb-reset').style.visibility = keybinds.isDefault(a.id) ? 'hidden' : '';
      const d = row.querySelector('.kb-desc');
      d.innerHTML = c.length ? `⚠ ${c.map((o) => `<b>${escHtml(codeLabel(o.code))}</b> 키가 '${escHtml(o.label)}'와 겹쳐요`).join(' · ')}` : escHtml(a.desc || '');
    }
    const all = ACTIONS.filter((a) => keybinds.conflictsOf(a.id).length).length;
    // 줄이 다 숨겨진 묶음은 제목도 숨김
    root.querySelectorAll('.kb-group').forEach((g) => (g.hidden = ![...g.querySelectorAll('.kb-row')].some((r) => !r.hidden)));
    if (lastMsg) {
      const { id, code, others } = lastMsg;
      const still = others.filter((o) => binds[o].includes(code));
      if (still.length && binds[id].includes(code)) {
        note.className = 'kb-note warn on';
        note.innerHTML = `<span>⚠ <kbd>${escHtml(codeLabel(code))}</kbd> 키를 '${escHtml(BY_ID[id].label)}'와 '${still.map((o) => escHtml(BY_ID[o].label)).join("', '")}'가 같이 써요. 한 번에 둘 다 될 수 있어요</span><button class="gm-btn small" data-nav data-unbind>'${escHtml(BY_ID[still[0]].label)}'에서 빼기</button>`;
        return;
      }
      lastMsg = null;
    }
    if (all) {
      note.className = 'kb-note warn on';
      note.innerHTML = `<span>⚠ 겹치는 키가 ${all}개 있어요 (빨간 줄). 칸을 눌러 다른 키로 바꿔 주세요</span>`;
    } else {
      note.className = 'kb-note on';
      note.innerHTML = `<span>💡 칸을 눌러(또는 <kbd>Enter</kbd>) 새 키를 정해요. 앞 칸 = 기본 키, 뒤 칸 = 보조 키</span>`;
    }
  }

  async function edit(id, slot) {
    const a = BY_ID[id];
    if ((a.lock || []).includes(slot)) return;
    sound('select');
    const code = await captureKey(`'${a.label}' ${slot ? '보조' : '기본'} 키`, `지금: ${binds[id][slot] ? codeLabel(binds[id][slot]) : '없음'}`);
    if (code === null) return sound('back');
    if (code === '') {
      keybinds.set(id, slot, null);
      lastMsg = null;
      sound('toggle');
      return;
    }
    const others = keybinds.whoUses(code, id).map((b) => b.id);
    keybinds.set(id, slot, code);
    lastMsg = others.length ? { id, code, others } : null;
    sound(others.length ? 'back' : 'toggle');
    const row = root.querySelector(`.kb-row[data-action="${id}"]`);
    if (row) {
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
    }
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute('data-resetall')) {
      keybinds.reset();
      lastMsg = null;
      sound('select');
      return;
    }
    if (b.hasAttribute('data-unbind') && lastMsg) {
      const { code, others } = lastMsg;
      const o = others.find((x) => binds[x].includes(code));
      if (o) keybinds.set(o, binds[o].indexOf(code), null);
      lastMsg = null;
      sound('toggle');
      return;
    }
    const row = b.closest('.kb-row');
    if (!row) return;
    if (b.hasAttribute('data-reset')) {
      keybinds.resetAction(row.dataset.action);
      sound('toggle');
      return;
    }
    if (b.dataset.slot != null) edit(row.dataset.action, +b.dataset.slot);
  });
  refresh();
  const off = keybinds.onChange(refresh);
  return { el: root, refresh, destroy: off };
}
