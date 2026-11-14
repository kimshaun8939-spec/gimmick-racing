// 설정: 홈 화면과 ESC 메뉴가 같이 쓰는 설정 저장소 + 설정 화면(패널) 만들기
//   - 브라우저(localStorage 'gimmick.settings')에 저장되고, 바꾸면 바로 게임에 적용됨 (onChange로 알림)
//   - 화면은 소리 / 화면·그래픽 / 주행 / 레이스 / 표시 묶음. 마우스 또는 키보드(↑↓ 고르기, ←→ 바꾸기)로 조절
//   - 위쪽 탭: [일반 설정] [조작키] [게임패드] (조작키 = keybinds.js의 createKeybindPanel, 게임패드 = gamepad.js의 createPadPanel)
//   - tab: 'pad'인 설정은 게임패드 탭에 보임. hidden: true는 화면에 안 보이는 설정 (홈의 다른 화면에서 바꿈)
import { setMix } from './audioMix.js';
import { keybinds, PRESETS, createKeybindPanel, codeLabel, actionVisible } from './keybinds.js';
import { pad, createPadPanel } from './gamepad.js';
import { touchWanted } from './touch.js';

const KEY = 'gimmick.settings';

/** 설정 항목 정의: key, 묶음, 이름, 쉬운 설명, 종류(slider / toggle / choice), 기본값 */
export const SETTING_DEFS = [
  { group: '소리', key: 'masterVol', label: '전체 소리 크기', desc: '게임의 모든 소리', type: 'slider', def: 1 },
  { group: '소리', key: 'engineVol', label: '엔진 소리', desc: '부릉부릉 엔진음', type: 'slider', def: 1 },
  { group: '소리', key: 'fxVol', label: '효과음', desc: '변신·바람·연석·메뉴 소리', type: 'slider', def: 1 },
  { group: '소리', key: 'muted', label: '소리 끄기', desc: () => `게임 중 ${keybinds.main('sound')} 키와 같아요`, type: 'toggle', def: false },

  { group: '화면·그래픽', key: 'quality', label: '그래픽 품질', desc: '자동 = 끊기면 해상도·그림자·백미러 갱신을 차례로 줄여요. 낮음 = 낮은 해상도, 햇빛 그림자 끔, 백미러는 덜 자주 그림. 차 모양·코스·운전 도움은 같아요. 그래도 끊기면 봇 수를 3대로 줄여 보세요', type: 'choice',
    options: [['auto', '자동'], ['low', '낮음'], ['medium', '보통'], ['high', '높음']], def: 'auto' },
  { group: '화면·그래픽', key: 'fpsCap', label: '프레임 제한', desc: '낮추면 배터리·발열이 줄어요', type: 'choice',
    options: [[30, '30'], [60, '60'], [0, '제한 없음']], def: 60 }, // 2026-11-12 기본 0 → 60 (사용자 요청: 발열)
  { group: '화면·그래픽', key: 'speedFx', label: '속도감 효과', desc: '바람 줄기·속도선·시야 넓어짐', type: 'choice',
    options: [[0, '끔'], [0.5, '약하게'], [1, '보통'], [1.5, '강하게']], def: 1 },
  { group: '화면·그래픽', key: 'shake', label: '화면 흔들림', desc: '부딪힘·착지·연석에서 카메라 떨림', type: 'choice',
    options: [[0, '끔'], [0.5, '약하게'], [1, '보통']], def: 1 },
  { group: '화면·그래픽', key: 'camView', label: '시점', desc: () => `달리는 중 ${keybinds.main('camView')} 키로도 바꿔요 · 보닛·운전석 = 1인칭 (흔들림이 줄어요)`, type: 'choice',
    options: [['chase', '기본'], ['near', '가까이'], ['far', '멀리'], ['bonnet', '보닛'], ['cockpit', '운전석']], def: 'chase' },
  { group: '화면·그래픽', key: 'fov', label: '시야 넓이', desc: '카메라가 보는 범위', type: 'choice',
    options: [[-6, '좁게'], [0, '보통'], [6, '넓게']], def: 0 },

  { group: '주행', key: 'gearbox', label: '변속 방식', desc: () => `게임 중 ${keybinds.main('gearbox')} 키로도 바꿔요 (수동: ${keybinds.main('shiftUp')} 올림 · ${keybinds.main('shiftDown')} 내림)`, type: 'choice',
    options: [['auto', '자동'], ['manual', '수동']], def: 'auto' },
  { group: '주행', key: 'racingLine', label: '레이싱 라인', desc: () => `초록 = 가속 · 노랑 = 속도 줄일 준비 · 빨강 = 브레이크 (${keybinds.main('racingLine')} 키)`, type: 'toggle', def: true },
  { group: '주행', key: 'autoPause', label: '자동 일시정지', desc: '다른 창을 보면 혼자 하는 게임을 멈춰요 (온라인 경기는 계속돼요)', type: 'toggle', def: true },

  // 조향 느낌·운전 도움 (input.js·assists.js가 조작 명령에 적용)
  { group: '조향 · 운전 도움', key: 'steerSens', label: '조향 감도', desc: '핸들을 꺾는 양 (키보드·패드)', type: 'choice',
    options: [[0.7, '둔하게'], [0.85, '−'], [1, '보통'], [1.15, '+'], [1.3, '예민하게']], def: 1 },
  { group: '조향 · 운전 도움', key: 'steerRamp', label: '키보드 조향', desc: '부드럽게 = 키를 누르면 핸들이 서서히 끝까지 (살짝 고치기 쉬움)', type: 'choice',
    options: [['instant', '바로'], ['fast', '빠르게'], ['smooth', '부드럽게']], def: 'instant' },
  { group: '조향 · 운전 도움', key: 'brakeAssist', label: '브레이크 도움', desc: '코너 앞에서 너무 빠르면 자동으로 브레이크 (초보용)', type: 'choice',
    options: [['off', '끔'], ['light', '약하게'], ['full', '강하게']], def: 'off' },
  { group: '조향 · 운전 도움', key: 'steerAssist', label: '조향 도움', desc: '레이싱 라인 쪽으로 핸들을 살짝 돌려 줘요 (초보용)', type: 'choice',
    options: [['off', '끔'], ['light', '약하게'], ['full', '강하게']], def: 'off' },
  { group: '조향 · 운전 도움', key: 'tcs', label: '트랙션 컨트롤', desc: '출발·코너 탈출에서 바퀴가 헛돌면 가속을 줄여 줘요', type: 'toggle', def: false },

  // 터치 (휴대폰·태블릿, src/touch.js)
  { group: '터치 (휴대폰)', key: 'touchCtl', label: '터치 버튼', desc: '화면 위 조향·가속·브레이크 버튼 (자동 = 터치 화면이면 켬)', type: 'choice',
    options: [['auto', '자동'], ['on', '켜기'], ['off', '끄기']], def: 'auto' },
  { group: '터치 (휴대폰)', key: 'touchSteer', label: '터치 조향', desc: '끌기 = 왼쪽 아무 데나 대고 옆으로 끈 만큼 · 버튼 = ◀ ▶', type: 'choice',
    options: [['pad', '끌기'], ['buttons', '버튼']], def: 'pad' },
  { group: '터치 (휴대폰)', key: 'touchSize', label: '버튼 크기', desc: '휴대폰 가속·브레이크·드리프트 버튼의 크기', type: 'choice',
    options: [['s', '작게'], ['m', '보통'], ['l', '크게']], def: 'm' },
  { group: '터치 (휴대폰)', key: 'tilt', label: '기울여 조향', desc: '휴대폰을 핸들처럼 좌우로 기울여요 (iPhone은 처음에 허락을 물어요)', type: 'toggle', def: false },

  // 게임패드 (게임패드 탭에 보임)
  { group: '게임패드', tab: 'pad', key: 'padDeadzone', label: '스틱 데드존', desc: '가운데에서 이만큼은 무시 (스틱이 저절로 조금 꺾이면 크게)', type: 'choice',
    options: [[0.05, '아주 작게'], [0.1, '작게'], [0.15, '보통'], [0.22, '크게']], def: 0.1 },
  { group: '게임패드', tab: 'pad', key: 'padCurve', label: '스틱 커브', desc: '가운데 섬세 = 조금 기울이면 조금만 꺾여서 고속에서 안정적', type: 'choice',
    options: [[1, '직선'], [1.5, '보통'], [2.2, '가운데 섬세']], def: 1.5 },
  { group: '게임패드', tab: 'pad', key: 'padVibe', label: '진동', desc: '연석·잔디·부딪힘에서 패드가 떨려요 (지원하는 패드만)', type: 'toggle', def: true },

  // 레이스 (main.js·봇·고스트가 settings.values.X ?? 기본값으로 읽음. 키 이름·값은 .debug/agents/contracts.md 약속)
  { group: '레이스', key: 'ghost', label: '고스트 차', desc: '예전 주행을 보여 주는 반투명 차예요 (부딪히지 않음). 맵 최고 = 어느 차로 달렸든 이 맵에서 내 가장 빠른 기록 · 이 차 최고 = 지금 차의 기록 (없으면 다른 차 최고). 화면의 "최고 기록"도 같이 바뀜', type: 'choice',
    options: [['off', '끔'], ['best', '맵 최고 (모든 차)'], ['car', '이 차 최고'], ['bot', '봇 기록']], def: 'best' },
  { group: '레이스', key: 'bots', label: '봇 수', desc: '봇 레이스에서 같이 달리는 차', type: 'choice',
    options: [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7']], def: 5 },
  { group: '레이스', key: 'botLevel', label: '봇 실력', desc: '쉬움 = 처음 해도 이길 수 있음 · 중간 = 처음엔 이기기 어려움 · 어려움 = 잘하는 사람과 비슷 · 마스터 = 어려움보다 훨씬 빠름, 아주 잘해야 이김', type: 'choice',
    options: [['easy', '쉬움'], ['normal', '중간'], ['hard', '어려움'], ['master', '마스터']], def: 'normal' },
  { group: '레이스', key: 'drs', label: 'DRS', desc: '직선의 DRS 구간 앞 감지선에서 앞차와 1초 안이면, 그 직선에서 뒷날개가 열려 더 빨라져요 (봇도 똑같이, 브레이크를 밟으면 닫힘)', type: 'toggle', def: true },
  { group: '레이스', key: 'tow', label: '견인', desc: '바로 앞차와 1초 넘게 벌어지면 자동으로 가속을 도와줘요 (멀수록 셈, 봇도 똑같이, 상대가 있는 레이스). 오래 받으면 결과에 "🛟 도움 켬"', type: 'toggle', def: true },
  { group: '레이스', key: 'sectors', label: '구간 기록', desc: '한 바퀴를 3구간으로 나눠 내 최고와 비교', type: 'toggle', def: true },
  // 챔피언십 경기 수 (홈 레이스 방식 화면에서 고름)
  { group: '레이스', key: 'champLen', label: '챔피언십 경기 수', desc: '', type: 'choice', hidden: true,
    options: [[3, '3경기'], [5, '5경기']], def: 5 },

  { group: '표시', key: 'unit', label: '속도 단위', desc: 'km/h = 시속 킬로미터 · mph = 시속 마일', type: 'choice', options: [['kmh', 'km/h'], ['mph', 'mph']], def: 'kmh' },
  { group: '표시', key: 'minimap', label: '미니맵', desc: '오른쪽 위 작은 지도', type: 'toggle', def: true },
  { group: '표시', key: 'mirror', label: '백미러', desc: '자동 = 다른 차가 바로 뒤에 붙으면 화면 위에 작은 백미러가 내려와요 · 항상 = 상대가 있는 레이스에서 늘 보임', type: 'choice',
    options: [['auto', '자동'], ['on', '항상'], ['off', '끔']], def: 'auto' },
  { group: '표시', key: 'showFps', label: 'FPS 보기', desc: '1초에 몇 장 그리는지', type: 'toggle', def: false },
];

const DEFAULTS = Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.def]));

function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {}
  const s = { ...DEFAULTS, ...saved };
  // 프레임 제한 기본값이 '제한 없음'(0)에서 60으로 바뀜 (2026-11-12, 발열): 예전 기본값 0이 저장된 사람도 한 번만 60으로.
  //   그 뒤에 직접 고른 값('제한 없음' 포함)은 그대로 (gimmick.fps60 표시)
  try {
    if (!localStorage.getItem('gimmick.fps60')) {
      localStorage.setItem('gimmick.fps60', '1');
      if (s.fpsCap === 0) {
        s.fpsCap = 60;
        localStorage.setItem(KEY, JSON.stringify(s));
      }
    }
  } catch {}
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
  // 첫 레이스 링크 전용: main.js가 설정에서 읽는 봇 수에도 적용. 다른 레이스에는 영향 없음.
  const firstParams = new URLSearchParams(location.search);
  const firstRace = firstParams.get('rookie') === '1' && firstParams.get('mode') === 'race';
  if (firstRace) Object.assign(values, { bots: 3, botLevel: 'easy', racingLine: true, gearbox: 'auto', steerRamp: 'smooth', brakeAssist: 'light', steerAssist: 'light', tcs: true, ghost: 'off', sectors: false, mirror: 'off' });
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
// 홈·대기실에서도 공통 출력의 설정을 바로 맞춰요.
function syncSoundMix() {
  const s = settings.values;
  setMix({ master: s.masterVol, engine: s.engineVol, fx: s.fxVol, muted: s.muted });
}
syncSoundMix();
settings.onChange(syncSoundMix);
// 자동 품질의 현재 화면 비용 단계. 저장된 사용자 설정과 구분하며, 물리에는 쓰지 않아요.
export const graphicsBudget = { tier: 0 };
export function graphicsTier() {
  const q = settings.values.quality;
  return q === 'low' ? 2 : q === 'medium' ? 1 : q === 'auto' ? graphicsBudget.tier : 0;
}

/** 아주 작은 메뉴 소리 (효과음 크기·소리 끄기를 따름). kind: move / select / back / toggle */
let uiCtx = null;
export function uiSound(kind = 'move') {
  try {
    if (settings.get('muted') || settings.get('masterVol') <= 0.001 || settings.get('fxVol') <= 0.001) return;
    const v = 1; // 크기 조절은 공통 믹서에서 한 번만
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
  const wrap = document.createElement('div');
  wrap.className = 'gm-setwrap';
  wrap.innerHTML = `<div class="gm-set-tabs" role="tablist">
      <button class="gm-tab on" data-tab="general" data-nav role="tab">⚙️ 일반 설정</button>
      <button class="gm-tab" data-tab="keys" data-nav role="tab">⌨️ 조작키 배치<span class="badge" hidden>!</span></button>
      <button class="gm-tab" data-tab="pad" data-nav role="tab">🎮 게임패드<span class="dot" hidden></span></button>
    </div>`;
  const root = document.createElement('div');
  root.className = 'gm-settings';
  wrap.appendChild(root);
  const help = document.createElement('div');
  help.className = 'gm-set-help';
  help.innerHTML = '<span>처음이면 부드러운 조향과 약한 운전 도움을 추천해요. 도움을 쓰면 기록에 🛟 표시가 남아요.</span><button class="gm-btn" data-nav>초보 추천 적용</button><output class="gm-set-feedback" role="status" aria-live="polite"></output>';
  root.appendChild(help);
  const feedback = text => { help.querySelector('output').textContent = text; };
  help.querySelector('button').addEventListener('click', () => {
    for (const [key, value] of Object.entries({gearbox:'auto',racingLine:true,steerSens:1,steerRamp:'smooth',brakeAssist:'light',steerAssist:'light',tcs:true})) settings.set(key, value);
    feedback('초보 추천 적용: 자동 변속 · 라인 켬 · 부드러운 조향 · 약한 브레이크/조향 도움 · 헛바퀴 방지 켬');
  });
  const keyPanel = createKeybindPanel({ sound: uiSound });
  keyPanel.el.hidden = true;
  wrap.appendChild(keyPanel.el);
  const padPanel = createPadPanel({ sound: uiSound });
  padPanel.el.hidden = true;
  wrap.appendChild(padPanel.el);
  // 패드가 연결돼 있으면 탭에 초록 점
  const padDot = () => (wrap.querySelector('.gm-tab .dot').hidden = !pad.connected());
  padDot();
  const offPad = pad.onConnect(padDot);
  let tab = 'general';
  function showTab(name) {
    tab = name === 'keys' || name === 'pad' ? name : 'general';
    root.hidden = tab !== 'general';
    keyPanel.el.hidden = tab !== 'keys';
    padPanel.el.hidden = tab !== 'pad';
    wrap.querySelectorAll('.gm-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
  }
  wrap.querySelector('.gm-set-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.gm-tab');
    if (!b) return;
    if (b.dataset.tab !== tab) uiSound('toggle');
    showTab(b.dataset.tab);
  });
  // 겹치는 키가 있으면 조작키 탭에 빨간 점
  const keyBadge = () => (wrap.querySelector('.gm-tab .badge').hidden = !keybinds.ACTIONS.some((a) => keybinds.conflictsOf(a.id).length));
  keyBadge();
  const offKeys = keybinds.onChange(() => {
    keyBadge();
    for (const { d, row } of rows) if (typeof d.desc === 'function') row.querySelector('.gm-set-label small').textContent = d.desc();
  });
  const rows = [];
  let group = null, groupEl = null;
  for (const d of SETTING_DEFS) {
    if (d.hidden) continue;
    const host = d.tab === 'pad' ? padPanel.settingsEl : root;
    if (d.group !== group) {
      group = d.group;
      groupEl = document.createElement('section');
      groupEl.className = 'gm-set-group';
      groupEl.innerHTML = `<h3>${group}</h3>`;
      host.appendChild(groupEl);
    }
    const row = document.createElement('div');
    row.className = 'gm-set-row';
    row.tabIndex = 0;
    row.dataset.nav = '';
    row.dataset.adjust = d.key;
    const desc = typeof d.desc === 'function' ? d.desc() : d.desc; // 함수면 지금 조작키를 넣은 글자
    row.innerHTML = `<div class="gm-set-label"><b>${d.label}</b>${desc ? `<small>${desc}</small>` : ''}</div><div class="gm-set-ctl"></div>`;
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
  foot.innerHTML = `<span>바꾸면 바로 저장돼요 · 초기화는 일반·패드 설정에 적용 (조작키·패드 버튼 배치는 각 탭에서)</span><button class="gm-btn small" data-nav tabindex="0">기본값으로 되돌리기</button>`;
  foot.querySelector('button').addEventListener('click', () => {
    settings.reset();
    feedback('설정값을 기본으로 되돌렸어요. 바꾼 조작키·패드 버튼 배치는 유지돼요.');
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
  for (const host of [root, padPanel.settingsEl])
    host.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.gm-set-row');
      if (row) row.focus({ preventScroll: true });
    });
  return {
    el: wrap,
    adjust,
    refresh,
    showTab,
    get tab() {
      return tab;
    },
    destroy() {
      off();
      offKeys();
      offPad();
      keyPanel.destroy();
      padPanel.destroy();
    },
  };
}

/** 조작법 화면 (홈·ESC 메뉴 같이 씀). 키 글자는 지금 정한 조작키(keybinds.js)를 따라 바뀜. opts.onEditKeys = "키 바꾸기" 버튼 */
export function createControlsPage(opts = {}) {
  const el = document.createElement('div');
  el.className = 'gm-controls';
  const K = (...ids) => ids.map((id) => keybinds.html(id)).join('');
  const k1 = (id) => keybinds.html(id, 1);
  // 왼쪽·오른쪽 기본 키 먼저, 그다음 보조 키 (A D ← → 순서)
  const slotKeys = (...ids) =>
    [0, 1].flatMap((slot) => ids.map((id) => keybinds.get(id)[slot]).filter(Boolean)).map((c) => `<kbd>${codeLabel(c)}</kbd>`).join('') || '<kbd class="none">없음</kbd>';
  const row = (keys, what, sub = '') => `<div class="gm-ctl-row"><div class="gm-keys">${keys}</div><div><b>${what}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
  function render() {
    const touchSec = touchWanted()
      ? `<section class="gm-touchctl"><h3>📱 터치 (휴대폰)</h3>
      ${row('<kbd>◀ ●▶</kbd>', '조향', '화면 왼쪽 아무 데나 손가락을 대고 옆으로 끈 만큼 꺾여요 (설정에서 ◀ ▶ 버튼·기울이기로 바꿀 수 있어요)')}
      ${row('<kbd>▲</kbd><kbd>▼</kbd>', '가속 · 브레이크', '오른쪽 아래 큰 버튼 · 작은 버튼')}
      ${row('<kbd>💨</kbd>', '드리프트', '비행기일 땐 ⬆ 상승 · ⬇ 하강 버튼이 생겨요')}
      ${row('<kbd>👁</kbd><kbd>↺</kbd><kbd>☰</kbd>', '시점 · 복귀 · 메뉴', '오른쪽 위 작은 버튼')}
      </section>`
      : '';
    el.innerHTML = `${touchSec}
    <section><h3>기본 운전 · ${PRESETS.find(p => p.id === keybinds.preset())?.name || '내 설정'}</h3>
      ${row(K('throttle'), '가속', '꾹 누르면 페달이 서서히 끝까지')}
      ${row(K('brake'), '브레이크 · 후진', '서 있을 때 누르면 뒤로 가요')}
      ${row(slotKeys('left', 'right'), '방향 바꾸기', '빠를수록 핸들이 덜 꺾여요')}
      ${row(K('drift'), '드리프트', '꺾으면서 누르기')}
      ${actionVisible('booster') ? row(K('booster'), '아이템 사용', '파워업 레이스에서 가진 아이템 쓰기 (드리프트로 게이지를 채우면 부스터)') : ''}
    </section>
    <section><h3>레이스</h3>
      ${row('<span class="gm-lights"><i></i><i></i><i></i><i></i><i></i></span>', '출발 신호', `빨간불 5개가 꺼지는 순간 ${K('throttle')}! 미리 밟으면 시동이 꺼져요`)}
      ${row('<kbd class="gm-drs">DRS</kbd>', 'DRS (따라잡기)', '도로의 DRS DETECTION 선에서 앞차와 1초 안이면 → 다음 DRS ZONE 직선에서 뒷날개가 저절로 열려 빨라져요. 브레이크를 밟으면 닫힘')}
      ${row('💨', '슬립스트림', '앞차 바로 뒤에 붙으면 공기 저항이 줄어 바로 빨라져요 (최고 속도도 올라감). 옆으로 빠져도 효과가 잠깐 이어져 추월을 도와줘요. 여러 대가 줄지어 있으면 더 세요')}
      ${row('🧲', '견인', '바로 앞차와 1초 넘게 벌어지면 자동으로 가속을 도와줘요 (멀수록 셈, 봇도 똑같이). 핸들은 직접 조작해요')}
      ${row(K('respawn'), '도로로 복귀', '길을 벗어났거나 뒤집혔을 때')}
      ${row(K('restart'), '다시 하기 (결과 화면에서)')}
      ${row(K('menu'), '메뉴 · 일시정지', '설정, 다시 시작, 홈으로')}
    </section>
    <section><h3>자동 변신 모드</h3>
      ${row('🚗', '일반', '평소 모드')}
      ${row('🔥', '가속', '150 km/h를 넘고 핸들이 곧으면 자동 · 빠르지만 조금 미끄러워요')}
      ${row('🚤', '배', '물에 닿으면 자동')}
      ${row('✈️', '비행', `활주로에서 자동 · ${K('climb')} 이륙/상승 · ${K('dive')} 하강 · ${slotKeys('left', 'right')} 선회 · ${K('throttle')} 추력`)}
    </section>
    <section><h3>그 밖에</h3>
      ${row(K('gearbox'), '자동 ↔ 수동 변속', '수동: ' + k1('shiftUp') + ' 올림 · ' + k1('shiftDown') + ' 내림')}
      ${row(K('camView'), '시점 바꾸기', '기본 → 가까운 추격 → 먼 추격 → 보닛 → 운전석 (설정에서도)')}
      ${row(K('racingLine'), '레이싱 라인 켜기/끄기', '초록 = 밟기 · 노랑 = 떼기 · 빨강 = 브레이크')}
      ${row(K('sound'), '소리 끄기/켜기')}
    </section>
    <section class="gm-padctl${pad.connected() ? ' on' : ''}"><h3>🎮 게임패드 ${pad.connected() ? '<span class="ok">연결됨</span>' : '<small>(연결하고 버튼을 누르면 바로 써요)</small>'}</h3>
      ${row('<kbd class="pad">L 스틱</kbd>', '조향', '기울인 만큼 꺾여요 (설정 → 게임패드에서 데드존·커브)')}
      ${row(pad.html('throttle') + pad.html('brake'), '가속 · 브레이크', '트리거를 밟은 만큼')}
      ${row(pad.html('drift'), '드리프트 · 이륙/상승', `하강 ${pad.html('dive')}`)}
      ${actionVisible('booster') ? row(pad.html('booster') + pad.html('respawn'), '아이템 사용 · 복귀') : row(pad.html('respawn'), '도로로 복귀')}
      ${row(pad.html('shiftDown') + pad.html('shiftUp'), '기어 내림 · 올림 (수동)', `자동↔수동 ${pad.html('gearbox')} · 레이싱 라인 ${pad.html('racingLine')} · 시점 ${pad.html('camView')}`)}
      ${row(pad.html('menu') + pad.html('restart'), '메뉴 · 다시 하기(결과 화면)', `메뉴에서는 ${pad.name(0) ? `<kbd class="pad pf pf0">${pad.name(0)}</kbd>` : ''} 고르기 · <kbd class="pad pf pf1">${pad.name(1)}</kbd> 뒤로`)}
    </section>
    <p class="gm-tip">💡 코너 안쪽 빨간·흰 연석을 빠르게 스치면 <b>에이펙스 보너스</b>! 바다에 닿으면 배로, 활주로에 올라서면 비행기로 변신해요.
      ${opts.onEditKeys ? '<button class="gm-btn small" data-nav data-editkeys>⌨️ 조작키 바꾸기</button>' : ''}${keybinds.preset() === 'custom' ? ' <span class="gm-custom">(내 설정으로 보여요)</span>' : ''}</p>`;
    const b = el.querySelector('[data-editkeys]');
    if (b) b.addEventListener('click', () => opts.onEditKeys());
  }
  render();
  keybinds.onChange(render);
  pad.onChange(render);
  pad.onConnect(render);
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
    // 옆으로(←→)는 같은 줄에 있는 것만 (조작키 칸에서 ←를 누르면 엉뚱하게 위쪽 탭으로 튀지 않게)
    if ((dir === 'left' || dir === 'right') && (b.bottom < a.top + 4 || b.top > a.bottom - 4)) continue;
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
