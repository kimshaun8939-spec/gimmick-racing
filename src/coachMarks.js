// 코치 마크 안내 (작업 C, 2026-11-15, 설계 .debug/design/upgrade-design.md 8.3)
//   새 기능이 열리면 화면을 어둡게 하고 눌러야 할 버튼만 구멍을 뚫어 빛나게 + 말풍선. 그 버튼만 눌림.
//   단계마다 [건너뛰기](이 안내만 끝) · 작은 '안내 모두 끄기'. Enter = 빛나는 버튼 누르기 / 다음, Esc = 건너뛰기,
//   패드 A/B = gamepad.js가 Enter/Esc를 보냄. 휴대폰 좁은 화면은 말풍선이 화면 아래(또는 위) 시트로.
//   대상은 화면 요소의 data-coach="이름" 이름표로만 찾음 (선택자에 기대지 않게). 이름표 목록 = .debug/agents/coach-contract.md
//   아직 이름표가 없는 다른 사람 화면(partsUI·metaUI·lobby)은 FALLBACK 선택자로 잠시 찾음 → 이름표가 붙으면 그쪽이 먼저
// 쓰는 법 (home.js):
//   const coach = createCoach({ home, goMain, onEnd, onRace })
//   coach.run(id) · coach.queue() (기다리는 안내 하나) · coach.skip() · coach.off(true) · coach.running · lockTip(el, featureId)
import * as gate from './featureGate.js';

function ensureStyle() {
  if (typeof document === 'undefined' || document.querySelector('link[data-coach-css]')) return;
  const ln = document.createElement('link');
  ln.rel = 'stylesheet';
  ln.href = new URL('./coach.css', import.meta.url).href;
  ln.dataset.coachCss = '1';
  document.head.appendChild(ln);
  // 잠긴 작은 기능 숨기기: #home.fg-off-<기능> [data-gate-hide~="<기능>"] (다른 화면도 이 이름표만 붙이면 됨)
  const st = document.createElement('style');
  st.dataset.coachGate = '1';
  st.textContent = gate.FEATURES.map((f) => `#home.fg-off-${f.id} [data-gate-hide~="${f.id}"]`).join(',\n') + '{display:none!important}';
  document.head.appendChild(st);
}

/** 이름표가 아직 없는 곳 (작업 D·Codex 보상 길·lobby가 data-coach를 붙이면 그쪽을 먼저 씀) */
const FALLBACK = {
  'parts.slot.engine': '[data-slot="engine"]',
  'parts.slot.gearbox': '[data-slot="gearbox"]',
  'parts.slot.tire': '[data-slot="tire"]',
  'parts.slot.aero': '[data-slot="aero"]',
  'parts.slot.water': '[data-slot="water"]',
  'parts.card.gear_short': '[data-part="gear_short"]',
  'parts.fit': '.pu-detail [data-fit]',
  'meta.tab.achievements': '[data-mt-tab="achievements"]',
  'meta.tab.path': '[data-mt-tab="path"]',
  'meta.tab.goals': '[data-mt-tab="goals"]',
  'meta.tab.shop': '[data-mt-tab="shop"]',
  'shop.kind.part': '[data-shop-kind="part"]',
  'shop.money': '.mt-shop-intro, .mt-summary',
  'shop.card': '.mt-shop-grid .mt-product-art',
  'goals.daily': '.mt-goal-section',
  'garage.costume': '.mt-costume-box .mt-costume',
  'lobby.create': '#lobby [data-act="create"]',
  'lobby.join': '#lobby [data-act="join"]',
};

const W = 'click', I = 'info';
/** 안내 스크립트 13개 (설계 8.3). t: click = 그 버튼을 눌러야 다음, info = [다음] 버튼 */
export const SCRIPTS = {
  garage: [
    { t: W, target: 'home.garage', title: '차고가 열렸어요!', text: '차를 구경하고 골라 타는 곳이에요. 눌러 보세요.' },
    { t: W, target: 'garage.card', title: '차 고르기', text: '가진 차는 바로 탈 수 있고, 잠긴 차는 레벨이 되면 살 수 있어요. 차를 눌러 보세요.' },
    { t: W, target: 'garage.tab.custom', title: '🎨 색 바꾸기', text: '이 탭에서 차 색을 바꿔요.' },
    { t: I, target: 'garage.paint', title: '마음에 드는 색을 골라요', text: '골랐으면 Esc(또는 ‹ 버튼)로 돌아가요.' },
  ],
  time: [
    { t: W, target: 'home.play', title: '타임 어택이 열렸어요!', text: '플레이를 누르면 레이스 방식을 고를 수 있어요.' },
    { t: W, target: 'mode.time', title: '⏱️ 타임 어택', text: '이 카드를 눌러 골라요.' },
    { t: I, target: 'mode.time', title: '나와의 승부', text: '내 최고 기록 고스트와 같이 달려요. 구간마다 빨라졌는지 알려 줘요.' },
  ],
  records: [
    { t: W, target: 'home.records', title: '내 기록이 열렸어요!', text: '맵마다 내 최고 기록을 모아 봐요.' },
    { t: I, target: 'records.mine', title: '맵마다 내 최고', text: '완주 시간 · 최고 랩 · 구간 기록이 여기 쌓여요. 위 띠에서 맵을 바꿔요.' },
  ],
  parts: [
    { t: W, target: 'home.garage', title: '부품 조립이 열렸어요!', text: '차고에서 부품을 바꿔 끼울 수 있어요.' },
    { t: W, target: 'garage.card', title: '내 차 고르기', text: '부품을 끼울 차를 눌러요.' },
    { t: W, target: 'garage.tab.parts', title: '🔧 조립 탭', text: '엔진 · 기어 · 타이어 · 윙 · 배 부품 칸이 있어요.' },
    { t: W, target: 'parts.slot.gearbox', title: '기어 칸', text: '바꿀 칸을 먼저 골라요.' },
    { t: W, target: 'parts.card.gear_short', title: '가속 기어', text: '부품마다 좋은 점 · 아쉬운 점이 있어요. 눌러서 비교해 보고, 마음에 들면 [끼우기]를 눌러요.' },
  ],
  shop: [
    { t: W, target: 'home.shop', title: '상점이 열렸어요!', text: '차 · 부품 · 색을 사는 곳이에요.' },
    { t: W, target: 'shop.kind.part', title: '🔧 부품', text: '종류를 골라 구경해요.' },
    { t: I, target: 'shop.money', title: '⬡ 피트 조각', text: '레이스 · 목표 · 아카데미에서 모은 피트 조각으로 차와 부품을 사요.' },
    { t: W, target: 'shop.card', title: '상품 보기', text: '카드를 눌러 자세히 봐요. 사는 건 아래 버튼을 직접 누를 때만이에요.' },
  ],
  goals: [
    { t: W, target: 'home.goals', title: '업적과 목표가 열렸어요!', text: '그동안 달린 기록도 이미 쌓여 있어요.' },
    { t: W, target: 'meta.tab.goals', title: '일일 · 주간 목표', text: '매일 바뀌는 목표를 깨면 보상을 받아요.' },
    { t: W, target: 'meta.tab.path', title: '보상 길', text: '레벨마다 무엇이 열리는지 한눈에 봐요.' },
  ],
  custom: [
    { t: W, target: 'home.garage', title: '코스튬이 열렸어요!', text: '차고에서 차를 꾸며요.' },
    { t: W, target: 'garage.card', title: '꾸밀 차', text: '차를 눌러요.' },
    { t: W, target: 'garage.tab.custom', title: '🎨 커스텀 탭', text: '색 아래에 코스튬이 생겼어요.' },
    { t: W, target: 'garage.costume', title: '✦ 코스튬', text: '눌러서 미리 봐요. ✿ 커스텀 조각으로 꾸며요.' },
  ],
  item: [
    { t: W, target: 'home.play', title: '파워업 레이스가 열렸어요!', text: '플레이를 눌러요.' },
    { t: I, target: 'mode.item', title: '🎁 파워업 레이스', text: '상자를 지나 아이템을 얻고, 부스터 · 로켓 · 방어막으로 순위를 다퉈요.' },
  ],
  upgrade: [
    { t: W, target: 'home.garage', title: '부품 강화가 열렸어요!', text: '가진 부품을 더 좋게 만들 수 있어요.' },
    { t: W, target: 'garage.card', title: '내 차', text: '차를 눌러요.' },
    { t: W, target: 'garage.tab.parts', title: '🔧 조립 탭', text: '부품 카드에 별이 생겼어요.' },
    { t: I, target: 'parts.star', title: '★ 강화 단계', text: '강화하면 장점은 커지고 약점은 줄어요.' },
    { t: W, target: 'parts.upgrade', title: '◆ 강화', text: '강화 조각으로 강화해요. 눌러서 강화 창을 열어요.' },
    { t: I, target: 'upgrade.chance', title: '확률', text: '실패해도 단계는 안 내려가요. 실패할수록 다음 확률이 올라요. 진짜 강화는 직접 눌러요.' },
  ],
  compare: [
    { t: W, target: 'home.garage', title: '차 비교가 열렸어요!', text: '차고로 가요.' },
    { t: W, target: 'garage.compare', title: '⚖ 비교', text: '이 버튼으로 차 3대까지 성능을 나란히 봐요. 목록 위 정렬도 열렸어요.' },
  ],
  champ: [
    { t: W, target: 'home.play', title: '시즌이 열렸어요!', text: '플레이를 눌러요.' },
    { t: W, target: 'mode.champ', title: '🏆 그랑프리 · 시즌', text: '여러 맵을 이어 달리고 점수로 챔피언을 정해요.' },
    { t: W, target: 'mode.next', title: '다음으로', text: '시즌에 넣을 맵을 고르러 가요.' },
    { t: I, target: 'season.kinds', title: '시즌 맵 구성', text: '기본 시즌 · 랜덤 · 직접 고르기 중에서 골라요.' },
  ],
  ranking: [
    { t: W, target: 'home.records', title: '온라인 순위표가 열렸어요!', text: '다른 사람들 기록과 겨뤄요.' },
    { t: I, target: 'records.board', title: '🌐 세계 순위', text: '혼자 달린 완주 기록이 맵마다 올라가요.' },
    { t: I, target: 'records.ghost', title: '👻 같이 달리기', text: '그 사람의 주행 고스트와 같은 차로 타임 어택해요.' },
  ],
  online: [
    { t: W, target: 'home.online', title: '온라인 방이 열렸어요!', text: '친구와 같이 달려요.' },
    { t: I, target: 'lobby.create', title: '방 만들기', text: '방을 만들면 4자리 코드가 생겨요.', lobby: true },
    { t: I, target: 'lobby.join', title: '코드 공유', text: '친구에게 코드나 링크를 보내면 같은 방에 들어와요.', lobby: true },
  ],
};
export const STEP_COUNT = Object.values(SCRIPTS).reduce((n, s) => n + s.length, 0);

const visible = (el) => {
  if (!el || !el.isConnected) return false;
  if (el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
};
/** 이름표로 찾기 (보이는 것 중 첫째) */
export function findTarget(name) {
  for (const el of document.querySelectorAll(`[data-coach="${name}"]`)) if (visible(el)) return el;
  const fb = FALLBACK[name];
  if (fb) for (const el of document.querySelectorAll(fb)) if (visible(el)) return el;
  return null;
}

const reduced = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** 잠긴 기능을 누르면 뜨는 작은 말풍선 (화면 이동 없음, Esc·바깥 클릭으로 닫힘) */
let tipEl = null, tipOff = null;
export function closeLockTip() {
  if (tipOff) tipOff();
  tipOff = null;
  if (tipEl) tipEl.remove();
  tipEl = null;
}
export function lockTip(anchor, featureId, { onRace, host = document.body } = {}) {
  ensureStyle();
  closeLockTip();
  const f = gate.featureOf(featureId);
  if (!f) return;
  const r = gate.racesTo(featureId);
  const el = document.createElement('div');
  el.className = 'cm-tip';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `${f.name} 잠김`);
  el.innerHTML = `<b>🔒 Lv.${r.level}에 열려요${r.races ? ` · 약 ${r.races}판 뒤` : ''}</b><p>${escH(f.icon)} ${escH(f.name)} · ${escH(f.desc)}</p><div class="cm-tipbtns">${onRace ? '<button class="gm-btn primary small" data-cm="race">🏁 지금 레이스하기</button>' : ''}<button class="gm-btn small" data-cm="close">닫기</button></div>`;
  host.appendChild(el);
  tipEl = el;
  // 자리: 버튼 아래(안 되면 위), 화면 안
  const a = anchor.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  const w = Math.min(320, vw - 24);
  el.style.width = w + 'px';
  const h = el.offsetHeight;
  let x = Math.max(12, Math.min(vw - w - 12, a.left + a.width / 2 - w / 2));
  let y = a.bottom + 10;
  if (y + h > vh - 12) y = a.top - h - 10;
  if (y < 12) y = Math.max(12, Math.min(vh - h - 12, a.top + a.height / 2 - h / 2));
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  const back = document.activeElement;
  const done = (race) => {
    closeLockTip();
    if (back && back.focus) back.focus({ preventScroll: true });
    if (race && onRace) onRace();
  };
  const onClick = (e) => {
    const b = e.target.closest('[data-cm]');
    if (b) return done(b.dataset.cm === 'race');
    if (!el.contains(e.target) && !anchor.contains(e.target)) done(false);
  };
  const onKey = (e) => {
    if (e.code === 'Escape' || e.code === 'Backspace') {
      e.preventDefault();
      e.stopImmediatePropagation();
      done(false);
    }
  };
  setTimeout(() => document.addEventListener('click', onClick, true), 0);
  window.addEventListener('keydown', onKey, true);
  tipOff = () => {
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
  };
  el.querySelector('.gm-btn').focus({ preventScroll: true });
  clearTimeout(lockTip.t);
  lockTip.t = setTimeout(() => tipEl === el && done(false), 9000);
}

/**
 * 코치 마크 만들기. opts:
 *   home      = #home 요소 (안내가 뜨는 화면)
 *   goMain()  = 안내 시작 전에 홈 첫 화면으로
 *   blocked() = true면 기다림 (레벨 업 창·확인 창 등)
 *   onEnd(id, status) = 끝났을 때 ('done' | 'skipped')
 */
export function createCoach(opts = {}) {
  ensureStyle();
  let cur = null; // { id, steps, i, el, since, scrolled, resolve, missedRun }
  let raf = 0;
  const root = document.createElement('div');
  root.className = 'cm-root';
  root.hidden = true;
  root.innerHTML = `<div class="cm-shade" data-s="t"></div><div class="cm-shade" data-s="b"></div><div class="cm-shade" data-s="l"></div><div class="cm-shade" data-s="r"></div>
    <div class="cm-cover"></div><div class="cm-ring"></div>
    <div class="cm-bubble" role="dialog" aria-modal="true" aria-live="polite">
      <div class="cm-top"><span class="cm-n"></span><button type="button" class="cm-off">안내 모두 끄기</button></div>
      <h4></h4><p></p>
      <div class="cm-btns"><button type="button" class="gm-btn small cm-skip">건너뛰기 <kbd>Esc</kbd></button><button type="button" class="gm-btn small primary cm-next">다음 <kbd>Enter</kbd></button></div>
      <div class="cm-wait" hidden>잠깐만요…</div>
    </div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const bubble = $('.cm-bubble'), ring = $('.cm-ring'), cover = $('.cm-cover');
  bubble.tabIndex = -1;
  const shades = [...root.querySelectorAll('.cm-shade')];

  const pausedNow = () => {
    if (document.querySelector('.gm-confirm')) return true;
    if (opts.blocked && opts.blocked()) return true;
    if (cur && !cur.steps[cur.i].lobby && document.getElementById('lobby')) return true;
    return false;
  };
  function shake() {
    if (reduced()) return;
    bubble.classList.remove('cm-shake');
    void bubble.offsetWidth;
    bubble.classList.add('cm-shake');
  }
  // 어두운 막 = 클릭 막기 (말풍선만 흔들림)
  for (const s of [...shades, cover]) {
    s.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      shake();
    });
    s.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }
  $('.cm-skip').addEventListener('click', () => end('skipped'));
  $('.cm-next').addEventListener('click', () => advance());
  $('.cm-off').addEventListener('click', () => {
    gate.setCoachOff(true);
    end('skipped');
    if (opts.toast) opts.toast('🎓 안내를 모두 껐어요 · 설정 → 안내에서 다시 볼 수 있어요');
  });

  function place(el) {
    const vw = innerWidth, vh = innerHeight;
    const pad = 6;
    let r = el ? el.getBoundingClientRect() : null;
    const box = r ? { l: Math.max(0, r.left - pad), t: Math.max(0, r.top - pad), r: Math.min(vw, r.right + pad), b: Math.min(vh, r.bottom + pad) } : { l: vw / 2, t: vh / 2, r: vw / 2, b: vh / 2 };
    const [st, sb, sl, sr] = shades;
    st.style.cssText = `left:0;top:0;width:${vw}px;height:${box.t}px`;
    sb.style.cssText = `left:0;top:${box.b}px;width:${vw}px;height:${Math.max(0, vh - box.b)}px`;
    sl.style.cssText = `left:0;top:${box.t}px;width:${box.l}px;height:${Math.max(0, box.b - box.t)}px`;
    sr.style.cssText = `left:${box.r}px;top:${box.t}px;width:${Math.max(0, vw - box.r)}px;height:${Math.max(0, box.b - box.t)}px`;
    ring.style.cssText = `left:${box.l}px;top:${box.t}px;width:${box.r - box.l}px;height:${box.b - box.t}px`;
    ring.hidden = !el;
    const info = !cur || cur.steps[cur.i].t !== W;
    cover.style.cssText = `left:${box.l}px;top:${box.t}px;width:${box.r - box.l}px;height:${box.b - box.t}px`;
    cover.hidden = !el || !info; // 설명 단계는 구멍도 막음 ([다음]으로만)
    // 말풍선 자리
    const narrow = vw < 560;
    bubble.classList.toggle('cm-sheet', narrow);
    const bw = narrow ? vw - 24 : Math.min(340, vw - 24);
    bubble.style.width = bw + 'px';
    const bh = bubble.offsetHeight || 150;
    let x, y;
    if (narrow) {
      x = 12;
      // 화면 아래 시트 (대상이 아래쪽이면 위로)
      const below = vh - bh - 12;
      y = !el || box.b < below - 8 ? below : box.t > bh + 24 ? 12 : below;
    } else {
      const gap = 14;
      const cands = [
        [box.l + (box.r - box.l) / 2 - bw / 2, box.b + gap],
        [box.l + (box.r - box.l) / 2 - bw / 2, box.t - bh - gap],
        [box.r + gap, box.t + (box.b - box.t) / 2 - bh / 2],
        [box.l - bw - gap, box.t + (box.b - box.t) / 2 - bh / 2],
      ];
      const fits = ([cx, cy]) => cy >= 8 && cy + bh <= vh - 8 && cx >= -bw / 2 && cx + bw <= vw + bw / 2;
      [x, y] = (el && cands.find(fits)) || [vw / 2 - bw / 2, el ? (box.b < vh / 2 ? vh - bh - 16 : 16) : vh / 2 - bh / 2];
    }
    x = Math.max(12, Math.min(vw - bw - 12, x));
    y = Math.max(8, Math.min(vh - bh - 8, y));
    bubble.style.left = x + 'px';
    bubble.style.top = y + 'px';
  }

  function showStep() {
    const s = cur.steps[cur.i];
    $('.cm-n').textContent = `${cur.name} · ${cur.i + 1}/${cur.steps.length}`;
    bubble.querySelector('h4').textContent = s.title;
    bubble.querySelector('p').textContent = s.text;
    $('.cm-next').hidden = s.t === W;
    $('.cm-next').innerHTML = cur.i === cur.steps.length - 1 ? '알겠어요 <kbd>Enter</kbd>' : '다음 <kbd>Enter</kbd>';
    if (cur.el) cur.el.classList.remove('cm-target');
    for (const e of document.querySelectorAll('.cm-target')) e.classList.remove('cm-target');
    cur.el = null;
    cur.since = performance.now();
    cur.scrolled = false;
  }
  function advance() {
    if (!cur) return;
    cur.missedRun = 0;
    if (cur.i + 1 >= cur.steps.length) return end('done');
    cur.i++;
    showStep();
  }
  function end(status) {
    if (!cur) return;
    const c = cur;
    cur = null;
    cancelAnimationFrame(raf);
    root.hidden = true;
    root.classList.remove('on');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('pointerdown', onDocClick, true);
    document.removeEventListener('pointerup', onDocClick, true);
    window.removeEventListener('keydown', onKey, true);
    if (c.el) c.el.classList.remove('cm-target');
    gate.setCoach(c.id, status);
    c.resolve(status);
    if (opts.onEnd) opts.onEnd(c.id, status);
  }
  function tick() {
    if (!cur) return;
    raf = requestAnimationFrame(tick);
    const s = cur.steps[cur.i];
    if (pausedNow()) {
      root.classList.add('cm-paused');
      cur.since = performance.now(); // 기다리는 동안은 시간을 안 셈
      return;
    }
    root.classList.remove('cm-paused');
    let el = cur.el && visible(cur.el) && cur.el.matches(`[data-coach="${s.target}"]${FALLBACK[s.target] ? ', ' + FALLBACK[s.target] : ''}`) ? cur.el : findTarget(s.target);
    if (el !== cur.el) {
      if (cur.el) cur.el.classList.remove('cm-target');
      cur.el = el;
      cur.scrolled = false;
      if (el) {
        el.classList.add('cm-target');
        // 대상에 초점을 주면 화면 코드가 '고름'으로 받는 곳이 있음(방식 카드 focusin) → 말풍선에 초점, Enter는 onKey가 대상을 누름
        if (s.t === W) bubble.focus({ preventScroll: true });
        else $('.cm-next').focus({ preventScroll: true });
      }
    }
    $('.cm-wait').hidden = !!el;
    if (el) cur.since = performance.now(); // 못 찾은 시간만 셈 (누른 뒤 화면이 바뀌는 사이는 놓침이 아님)
    if (el && !cur.scrolled) {
      cur.scrolled = true;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (!el && performance.now() - cur.since > (cur.i === 0 ? 4000 : 6000)) {
      // 6초 안에 대상이 안 나타나면 그 단계 건너뜀 (두 번 이어지면 안내를 멈춤)
      gate.noteMissed(cur.id, cur.i + 1);
      console.info('[coach] 대상 없음', cur.id, cur.i + 1, s.target);
      cur.missedRun = (cur.missedRun || 0) + 1;
      if (cur.missedRun >= 2) return end('skipped');
      if (cur.i + 1 >= cur.steps.length) return end(cur.i > 0 && cur.missedRun < 2 ? 'done' : 'skipped'); // 마지막 설명만 못 찾음 = 본 것으로
      cur.i++;
      showStep();
      return;
    }
    place(el);
  }
  // 빛나는 버튼을 누르면 (원래 동작이 먼저 일어난 뒤) 다음 단계
  function onDocClick(e) {
    if (!cur || pausedNow()) return;
    const s = cur.steps[cur.i];
    if (s.t !== W || !cur.el) return;
    // 화면이 다시 그려져 cur.el이 바뀌었을 수 있음 → 같은 이름표(또는 FALLBACK) 안을 눌렀으면 됨
    const t = e.target && e.target.closest ? e.target : null;
    const hit = cur.el.contains(e.target) || (t && (t.closest(`[data-coach="${s.target}"]`) || (FALLBACK[s.target] && t.closest(FALLBACK[s.target]))));
    if (e.type === 'pointerdown') {
      downAt = hit ? cur.id + ':' + cur.i : null; // 누르는 사이에 화면이 다시 그려지면 click이 대상 밖에서 날 수 있음 → 뗄 때 판단
      return;
    }
    if (hit || (e.type === 'pointerup' && downAt === cur.id + ':' + cur.i)) {
      downAt = null;
      const id = cur.id, i = cur.i;
      setTimeout(() => cur && cur.id === id && cur.i === i && advance(), 0);
    }
  }
  let downAt = null;
  /** 진짜 마우스 클릭처럼 (pointerdown → click) — 화면 코드가 마우스와 키보드를 다르게 다루는 곳이 있어서 */
  function press(el) {
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    } catch {}
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, view: window }));
  }
  function onKey(e) {
    if (!cur) return;
    if (document.querySelector('.gm-confirm')) return; // 확인 창이 키를 받음
    if (pausedNow()) return;
    const k = e.code || e.key;
    const s = cur.steps[cur.i];
    const inBubble = bubble.contains(document.activeElement);
    if (k === 'Escape' || k === 'Backspace') {
      e.preventDefault();
      e.stopImmediatePropagation();
      return end('skipped');
    }
    if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (inBubble && document.activeElement.tagName === 'BUTTON' && !document.activeElement.hidden) return document.activeElement.click();
      if (s.t === W) {
        if (cur.el) press(cur.el);
      } else advance();
      return;
    }
    if (k === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const list = [...(s.t === W && cur.el ? [cur.el] : []), ...[...bubble.querySelectorAll('button')].filter((b) => !b.hidden)];
      const i = list.indexOf(document.activeElement);
      const n = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
      if (n) n.focus({ preventScroll: true });
      return;
    }
    // 그 밖의 키(화살표·WASD·Q/E…)는 다른 곳으로 가지 않게 막음
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function run(id) {
    const steps = SCRIPTS[id];
    if (!steps) return Promise.resolve(null);
    if (cur) end('skipped');
    closeLockTip();
    if (opts.goMain) opts.goMain(id);
    const meta = gate.COACHES.find((c) => c.id === id);
    return new Promise((resolve) => {
      cur = { id, name: meta ? meta.name : id, steps, i: 0, el: null, since: 0, resolve, missedRun: 0 };
      root.hidden = false;
      root.classList.add('on');
      root.classList.toggle('cm-still', reduced());
      showStep();
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('pointerdown', onDocClick, true);
      document.addEventListener('pointerup', onDocClick, true);
      window.addEventListener('keydown', onKey, true);
      raf = requestAnimationFrame(tick);
      if (opts.onStart) opts.onStart(id);
    });
  }
  return {
    run,
    /** 기다리는 안내 하나를 시작 (없으면 null) */
    queue() {
      const next = gate.pendingCoaches()[0];
      return next ? run(next.id) : null;
    },
    skip() {
      end('skipped');
    },
    off(v = true) {
      gate.setCoachOff(v);
      if (v) end('skipped');
    },
    get running() {
      return cur ? cur.id : null;
    },
    get step() {
      return cur ? { id: cur.id, i: cur.i, n: cur.steps.length, t: cur.steps[cur.i].t, target: cur.steps[cur.i].target, found: !!cur.el, paused: root.classList.contains('cm-paused') } : null;
    },
  };
}
