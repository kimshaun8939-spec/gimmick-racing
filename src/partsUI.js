// 차고 🔧 조립 탭 (partsui·partdesign·partcard·swapanim·garage2) + 부품 강화 (upgradeD1, 2026-11-15)
//   강화: 부품 카드 별 ★(gate 'upgrade' 열렸을 때), 고른 부품 칸의 [◆ 강화] → 가운데 강화 창(확률·천장·비용·능력치 전/후)
//   → partUpgrade.roll()로 결과를 먼저 정해 저장 → upgradeFx 연출(2초, Enter/클릭 = 바로 결과) → 결과 창(한 번 더·닫기)
//   능력치는 내 강화 단계 기준(buildStats … {levels:'mine'}), 미리 보기 조립에도 숨은 levels(withLv)를 붙여 3D가 단계 모양을 그림
import { partThumb } from './partThumbs.js';
import { prepareGarageSwap } from './garageLift.js';
import * as parts from './parts.js';
import * as up from './partUpgrade.js';
import { buildStats, STAT_KEYS, METRIC_KEYS } from './carStats.js';
import { meta } from './meta.js';
import { confirmDialog, uiSound } from './settings.js';
import { gate } from './featureGate.js';
import { playUpgradeFx, upgradeSound } from './upgradeFx.js';
import { warmLevelShaders } from './carParts3d.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString('ko-KR');
const bal = (k) => { try { return Number(meta.balance?.(k) ?? (k === 'pit' ? meta.get().coins : 0)) || 0; } catch { return 0; } };
const upOpen = () => { try { return gate.isOpen('upgrade'); } catch { return true; } };
const upLock = () => { try { return 'Lv.' + gate.levelOf('upgrade') + '에 강화 열림'; } catch { return '강화 잠김'; } };
/** 조립 객체에 내 강화 단계(숨은 levels)를 붙임 — {...build}로 펼치면 사라지므로 미리 보기에 넘길 때마다 */
export function withLv(b, override) {
  const out = { ...(b || {}) };
  const lv = { ...parts.myLevels(), ...(override || {}) };
  try { Object.defineProperty(out, 'levels', { value: lv, enumerable: false, writable: true, configurable: true }); } catch {}
  return out;
}
export function ensurePartsStyle() { if (document.querySelector('#partsStyle')) return; const l = document.createElement('link'); l.id = 'partsStyle'; l.rel = 'stylesheet'; l.href = new URL('./parts.css', import.meta.url).href; document.head.append(l); }
const STAR = (lv, max = 5) => '★'.repeat(lv) + '☆'.repeat(Math.max(0, max - lv));
const starsHtml = (lv, cls = '', coach = '') => `<span class="pu-stars lv${lv} ${cls}"${coach ? ` data-coach="${coach}"` : ''} aria-label="강화 ${lv}단계">${STAR(lv)}</span>`;
const STAT_NAME = Object.fromEntries(STAT_KEYS);
const METRIC = Object.fromEntries(METRIC_KEYS.map(([k, n, u, good]) => [k, { n, u, good }]));
const num1 = (v, d = 1) => { const r = Math.round(v * 10 ** d) / 10 ** d; return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r).toFixed(d).replace(/\.0+$/, ''); };

/**
 * 강화로 바뀌는 숫자 줄: from/to = buildStats (순정 대비 diff)
 *   [{ key, name, a, b, unit, good: 'pro'|'con', text }] — 장점은 커지고(▲) 단점은 줄어듦(▼)
 */
function changeRows(from, to, limit = 6) {
  const rows = [];
  if (!from || !to) return rows;
  for (const [k, m] of Object.entries(METRIC)) {
    if (k === 'downforce') continue;
    const a = from.diff.metrics[k] ?? 0, b = to.diff.metrics[k] ?? 0;
    if (Math.abs(a) < 0.005 && Math.abs(b) < 0.005) continue;
    if (Math.abs(b - a) < 0.005) continue;
    const better = m.good ? a > 0 : a < 0; // Lv 지금 값이 좋은 쪽이면 장점
    const d = k === 'topKmh' || k === 'boatKmh' || k === 'offroadKeep' ? 0 : k.endsWith('Sec') || k === 'turboLag' ? 2 : 1;
    rows.push({ key: k, name: m.n, a, b, unit: m.u, good: better ? 'pro' : 'con', d, w: Math.abs(b - a) / (Math.abs(a) + 1e-3) });
  }
  for (const [k, n] of Object.entries(STAT_NAME)) {
    const a = from.diff.score100[k] ?? 0, b = to.diff.score100[k] ?? 0;
    if (Math.abs(a) < 0.3 && Math.abs(b) < 0.3) continue;
    if (Math.abs(b - a) < 0.15) continue;
    rows.push({ key: 's.' + k, name: n + ' 점수', a, b, unit: '점', good: a >= 0 ? 'pro' : 'con', d: 1, score: true, w: 0.01 });
  }
  rows.sort((x, y) => (x.score ? 1 : 0) - (y.score ? 1 : 0) || (x.good === y.good ? 0 : x.good === 'pro' ? -1 : 1));
  return rows.slice(0, limit);
}
const rowHtml = (r) => `<li class="pu-up-row ${r.good}"><span>${esc(r.name)}</span><em>${num1(r.a, r.d)}</em><i>→</i><strong>${num1(r.b, r.d)}</strong><small>${esc(r.unit)}</small><b>${r.good === 'pro' ? '▲ 장점' : '▼ 단점 줄어듦'}</b></li>`;

export function createPartsUI(box, o) {
  ensurePartsStyle();
  let car, open = true, slot = 'engine', chosen = 'stock', token = 0, busy = false, statsFrom = null;
  const mapNames = { gp: '그랑프리', sea: '바닷가', neon: '네온', moon: '달', jungle: '정글', volcano: '화산', glacier: '빙하', foundry: '톱니 공장', cloud: '구름섬', mirage: '신기루' };
  const names = { speed: '속도', accel: '가속', handling: '핸들링', grip: '접지', brake: '제동', offroad: '잔디', boat: '배' };
  const preview = (b, ov) => o.preview?.(withLv(b, ov));
  // partslock 2026-11-15: 칸의 (순정 아닌) 부품이 모두 레벨 부족이면 칸 잠금 = 가장 먼저 열리는 레벨, 아니면 0
  let picked = false;
  const slotLockLv = (sid) => { if (!car) return 0; const ps = parts.listParts(sid, { carId: car.id }); if (!ps.length || ps.some((x) => !x.locked)) return 0; return Math.min(...ps.map((x) => x.level || 0)) || 0; };
  const slotLockMsg = (sid, lk) => { const n = parts.slotOf(sid)?.name || ''; return (/부품$/.test(n) ? n : n + ' 부품') + '은 Lv.' + lk + '에 열려요'; };
  /** 조립 탭을 열 때 처음 고르는 칸: 장착한 칸 → 가진 부품이 있는 칸 → 쓸 수 있는 부품(보유·선물·지금 레벨에 열린 것)이 있는 첫 칸 */
  function firstSlot() {
    const ids = parts.listSlots().map((s) => s.id), build = parts.getBuild(car.id);
    const has = (sid, f) => parts.listParts(sid, { carId: car.id }).some(f);
    return ids.find((sid) => build[sid] && build[sid] !== 'stock') || ids.find((sid) => has(sid, (x) => x.owned)) || ids.find((sid) => has(sid, (x) => !x.locked)) || ids[0] || 'engine';
  }

  function render() {
    if (!car) return;
    const build = parts.getBuild(car.id), all = parts.listParts(slot, { stock: true, carId: car.id });
    const p = all.find((p) => p.id === chosen) || all[0];
    chosen = p.id;
    const pit = bal('pit'), short = !p.owned && p.canBuy ? Math.max(0, (p.price || 0) - pit) : 0;
    const showLv = upOpen();
    const pst = p.id !== 'stock' && p.owned && showLv ? up.state(p.id) : null;
    const lvOfSlot = (id) => (id && id !== 'stock' ? parts.partLevel(id) : 1);
    let upBtn = '';
    if (p.id !== 'stock' && p.owned) {
      if (!showLv) upBtn = `<button data-nav type="button" class="gm-btn pu-upbtn locked" disabled>🔒 ${esc(upLock())}</button>`;
      else if (pst.isMax) upBtn = `<button data-nav type="button" class="gm-btn pu-upbtn max" data-up="${p.id}" data-coach="parts.upgrade">MAX ★${pst.max}</button>`;
      else upBtn = `<button data-nav type="button" class="gm-btn pu-upbtn${pst.canAfford ? '' : ' poor'}" data-up="${p.id}" data-coach="parts.upgrade">◆ 강화 <small>◆${fmt(pst.cost)} · ${Math.round(pst.chance * 100)}%</small></button>`;
    }
    box.innerHTML = `<div class="pu-head"><b>나만의 조립</b><span>⬡ ${fmt(pit)}${showLv ? ` · <i class="pu-upbal">◆ ${fmt(bal('up'))}</i>` : ''}</span></div>${!open ? '<p class="pu-lock">🔒 잠긴 차 · 미리 보기만 할 수 있어요</p>' : ''}<div class="pu-slots">${parts.listSlots().map((s) => { const id = build[s.id], lv = lvOfSlot(id), lk = slotLockLv(s.id); if (lk) return `<button type="button" data-slot="${s.id}" class="pu-slotlock" aria-disabled="true" title="${esc(slotLockMsg(s.id, lk))}"><span>${s.icon} ${s.name}</span><small>🔒 Lv.${lk}</small></button>`; return `<button data-nav data-slot="${s.id}" class="${slot === s.id ? 'on' : ''}" aria-pressed="${slot === s.id}"><span>${s.icon} ${s.name}${parts.listParts(s.id, { carId: car.id }).some((x) => x.owned && !x.equipped) ? '<i class="pu-new" title="아직 안 끼운 부품">●</i>' : ''}</span><small>${esc(parts.partOf(id)?.short || '순정')}${showLv && lv > 1 ? `<b class="pu-slotlv lv${lv}">★${lv}</b>` : ''}</small></button>`; }).join('')}</div><p class="pu-slotmsg" role="status" hidden></p><div class="pu-cards">${all.map((x) => { const lv = x.id !== 'stock' && x.owned && showLv ? parts.partLevel(x.id) : 0; const cs = lv ? up.state(x.id) : null; return `<button data-nav data-part="${x.id}" class="${chosen === x.id ? 'on' : ''}${lv === 5 ? ' lvmax' : ''}"><span class="pu-art"><img data-thumb="${x.id}" alt="${esc(x.name)} 부품 모습" hidden><span>⚙</span>${lv ? starsHtml(lv, 'pu-cardstars', chosen === x.id ? 'parts.star' : '') : ''}</span><b>${esc(x.short || x.name)}</b><span class="pu-cardtrade">${esc((x.pros || [])[0] || '원래 성능')}<em>${esc((x.cons || [])[0] || '')}</em></span><small>${x.equipped ? '✓ 장착' : x.owned ? '보유' : x.locked ? '🔒 Lv.' + x.level : '⬡ ' + x.price}${cs && !cs.isMax ? `<i class="pu-cardup${cs.canAfford ? ' can' : ''}">◆${fmt(cs.cost)}</i>` : cs?.isMax ? '<i class="pu-cardup max">MAX</i>' : ''}</small></button>`; }).join('')}</div><article class="pu-detail"><b>${esc(p.name)}${pst ? ' ' + starsHtml(pst.lv, 'pu-detstars') : ''}</b><p>${esc(p.desc)}</p><div class="pu-trades">${(p.pros || []).map((t) => '<span class="plus">+ ' + esc(t) + '</span>').join('')}${(p.cons || []).map((t) => '<span class="minus">− ' + esc(t) + '</span>').join('')}</div>${pst && pst.lv > 1 ? '<small class="pu-lvfx" aria-live="polite"></small>' : ''}${p.shines && (p.shines.text?.length || p.shines.maps?.length) ? '<small>빛나는 곳 · ' + esc([...(p.shines.text || []), ...(p.shines.maps || []).map((id) => mapNames[id] || id)].join(' · ')) + '</small>' : ''}${!p.owned ? '<small>' + esc(p.lockReason || '⬡ ' + p.price + ' · 구매 후 모든 차에서 사용') + (p.altText ? '<br>또 다른 방법 · ' + esc(p.altText) : '') + '</small>' : ''}<div class="pu-acts"><button data-nav class="gm-btn primary" data-fit ${!open || p.equipped || (!p.owned && !p.canBuy) ? 'disabled' : ''}>${p.equipped ? '✓ 장착 중' : p.owned ? '이 부품 끼우기' : short ? '⬡ ' + fmt(short) + ' 부족 · 가격 ' + p.price : '⬡ ' + p.price + ' · 구매하고 끼우기'}</button>${upBtn}</div></article><div class="pu-stats" aria-label="순정과 비교한 예상 성능"></div><div class="pu-tools"><button data-nav class="gm-btn" data-reset ${!open ? 'disabled' : ''}>순정으로</button>${parts.listPresets(car.id).map((p, i) => `<button data-nav class="gm-btn" data-preset="${i}" ${!open ? 'disabled' : ''}>${p ? esc(p.name) : '저장 ' + (i + 1)}</button>${p ? '<button data-nav class="pu-preset-save" data-save-preset="' + i + '" aria-label="프리셋 ' + (i + 1) + ' 덮어쓰기" ' + (!open ? 'disabled' : '') + '>↥</button>' : ''}`).join('')}</div><p class="pu-feedback" role="status"></p>`;
    // 코치 마크 이름표: 고른 부품에 강화 버튼이 없으면(순정을 고름) 첫 별 딱지가 대신 (별을 누르면 그 부품 강화 창)
    if (showLv) {
      const firstStars = box.querySelector('.pu-cardstars');
      if (firstStars && !box.querySelector('[data-coach="parts.star"]')) firstStars.dataset.coach = 'parts.star';
      const firstUp = box.querySelector('.pu-cardup');
      if (firstUp && !box.querySelector('[data-coach="parts.upgrade"]')) firstUp.dataset.coach = 'parts.upgrade';
    }
    const t = ++token;
    for (const img of box.querySelectorAll('[data-thumb]')) {
      partThumb(img.dataset.thumb, { carId: car.id, slot, size: 320 }).then((url) => { if (t !== token || !img.isConnected) return; img.src = url; img.hidden = false; img.nextElementSibling.hidden = true; }).catch(() => {});
    }
    buildStats(car.id, { ...build, [slot]: chosen }, { levels: 'mine' }).then((s) => {
      if (t !== token) return;
      box.querySelector('.pu-stats').innerHTML = '<small>선택한 조립 · 순정 대비 예상치' + (showLv && Object.keys(parts.myLevels()).length ? ' · 내 강화 단계 반영' : '') + '</small>' + Object.entries(names).map(([k, n]) => `<div><span>${n}</span><i><em style="width:${s.built.score100[k]}%"></em><b style="left:${s.stock.score100[k]}%"></b></i><strong class="${s.diff.score100[k] >= 0 ? 'plus' : 'minus'}">${s.diff.score100[k] > 0 ? '+' : ''}${s.diff.score100[k].toFixed(1)}</strong></div>`).join('') + '<small>' + Object.entries(s.diff.pct).filter(([, v]) => Math.abs(v) > 0.05).slice(0, 4).map(([k, v]) => esc(names[k] || k) + ' ' + (v > 0 ? '+' : '') + v.toFixed(1) + '%').join(' · ') + '</small>';
      if (statsFrom) {
        const from = statsFrom; statsFrom = null;
        const bars = [...box.querySelectorAll('.pu-stats em')], targets = bars.map((e) => e.style.width);
        bars.forEach((e, i) => { e.style.transition = 'none'; e.style.width = from[Object.keys(names)[i]] + '%'; });
        requestAnimationFrame(() => { if (t !== token) return; bars.forEach((e, i) => { e.style.transition = ''; e.style.width = targets[i]; }); });
      }
    }).catch(() => {});
    // 단계 효과 한 줄: Lv1 숫자(지움선) → 지금 단계 숫자
    const fx = box.querySelector('.pu-lvfx');
    if (fx && pst) up.preview(car.id, p.id, { from: 1, to: pst.lv }).then((pv) => {
      if (t !== token || !fx.isConnected || !pv?.to) return;
      const all = changeRows(pv.from, pv.to, 6), rows = (all.some((r) => !r.score) ? all.filter((r) => !r.score) : all).slice(0, 3);
      fx.innerHTML = rows.length ? `<b class="lv${pst.lv}">★${pst.lv}</b> ` + rows.map((r) => `${esc(r.name)} <s>${num1(r.a, r.d)}</s> <em class="${r.good}">${num1(r.b, r.d)}</em>${esc(r.unit)}`).join(' · ') : '';
    }).catch(() => {});
  }

  async function animate(build, before = {}) {
    busy = true;
    const oldStats = await buildStats(car.id, before, { levels: 'mine' }).catch(() => null);
    if (oldStats) box.querySelectorAll('.pu-stats em').forEach((e, i) => (e.style.width = oldStats.built.score100[Object.keys(names)[i]] + '%'));
    const changed = parts.listSlots().map((s) => s.id).filter((id) => (before[id] || 'stock') !== (build[id] || 'stock'));
    let current = { ...before }, skipAll = false;
    preview(current);
    try {
      for (const id of changed) {
        const next = { ...current, [id]: build[id] || 'stock' };
        o.viewSlot?.(id);
        prepareGarageSwap({ car, before: current, after: next, slot: id, duration: changed.length > 1 ? 2800 / changed.length : 2400, preview: window.home?.preview, onSkip: () => { skipAll = true; } });
        await o.animate?.(withLv(next), id);
        current = next;
        if (skipAll) { preview(build); break; }
      }
    } finally {
      busy = false; chosen = parts.getBuild(car.id)[slot] || 'stock'; statsFrom = oldStats?.built.score100; render();
      const label = box.querySelector('.pu-feedback');
      if (label && changed.length) label.textContent = changed.length === 1 ? (parts.partOf(build[changed[0]])?.name || '순정 ' + parts.slotOf(changed[0]).name) + ' 장착!' : changed.length + '개 부품 장착 완료!';
    }
  }

  // ───────── 강화 창 ─────────
  let modal = null;
  function closeModal() {
    if (!modal) return;
    const m = modal; modal = null;
    window.removeEventListener('keydown', m.onKey, true);
    m.el.remove();
    uiSound('back');
    render();
    box.querySelector(`[data-up="${m.partId}"]`)?.focus({ preventScroll: true }) || box.querySelector(`[data-part="${m.partId}"]`)?.focus({ preventScroll: true });
  }
  function tableHtml() {
    const t = up.table();
    return `<table><thead><tr><th>단계</th><th>비용</th><th>기본</th><th>실패마다</th><th>천장</th><th>평균</th></tr></thead><tbody>${t.rows.map((r) => `<tr><td>★${r.from}→★${r.to}</td><td>◆${r.cost}</td><td>${Math.round(r.chance * 100)}%</td><td>${r.pity ? '+' + Math.round(r.pity * 100) + '%' : '—'}</td><td>${r.ceiling ? r.ceiling + '번 실패 뒤 100%' : '—'}</td><td>◆${Math.round(r.avgCost)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="6">★1→★5 평균 ◆${Math.round(t.total.avgCost)} · 운이 가장 나빠도 ◆${fmt(t.total.worstCost)}</td></tr></tfoot></table>`;
  }
  function oddsHtml(st) {
    const base = Math.round(st.baseChance * 100), add = Math.round(st.pityAdd * 100), pct = Math.round(st.chance * 100);
    const cells = st.ceiling ? Array.from({ length: st.ceiling }, (_, i) => `<i class="${i < st.fails ? 'on' : ''}"></i>`).join('') : '';
    const ceilTxt = !st.ceiling ? '처음 강화는 늘 성공해요' : pct >= 100 ? '천장! 이번엔 100% 성공' : st.failsLeft > 0 ? `${st.failsLeft}번 더 실패하면 다음은 100%` : '';
    return `<div class="pu-up-pct"><strong>${pct}%</strong><small>성공 확률</small></div><div class="pu-up-oddtxt"><span>기본 ${base}%${st.fails ? ` + 실패 ${st.fails}번 ×${add}%` : ''}</span>${add ? `<span>실패할 때마다 다음 확률 +${add}%</span>` : ''}${cells ? `<div class="pu-up-ceil" aria-label="천장까지 ${st.failsLeft}번">${cells}<em>100%</em></div>` : ''}<span class="pu-up-ceiltxt">${ceilTxt}</span><span class="pu-up-safe">실패해도 단계는 그대로예요 · 낸 조각만 써요</span></div>`;
  }
  function costHtml(st) {
    const after = st.balance - st.cost;
    return st.canAfford ? `<span>비용 <b>◆ ${fmt(st.cost)}</b></span><span>보유 ◆ ${fmt(st.balance)} → <b>${fmt(after)}</b></span>` : `<span>비용 <b>◆ ${fmt(st.cost)}</b> · 보유 ◆ ${fmt(st.balance)}</span><span class="pu-up-poor">◆ ${fmt(st.missing)} 부족 · 완주·일일 목표에서 모아요</span>`;
  }
  async function openUpgrade(partId) {
    if (modal || busy) return;
    const p = parts.partOf(partId); if (!p) return;
    const el = document.createElement('div');
    el.className = 'pu-up';
    el.innerHTML = `<div class="pu-up-box" role="dialog" aria-modal="true" aria-labelledby="puUpTitle"><header class="pu-up-head"><b id="puUpTitle">◆ 부품 강화</b><span class="pu-up-bal"></span></header><div class="pu-up-body"></div><footer class="pu-up-btns"></footer><details class="pu-up-table"><summary>확률 표 보기</summary>${tableHtml()}</details></div>`;
    document.body.append(el);
    const m = { el, partId, slot: p.slot, phase: 'ask', thumbs: {}, onKey: null };
    modal = m;
    const focusables = () => [...el.querySelectorAll('.pu-up-btns button:not([disabled]), .pu-up-table summary')];
    m.onKey = (e) => {
      if (m.phase === 'fx') return; // 연출 중엔 upgradeFx가 받음
      if (document.querySelector('.cm-root:not([hidden])')) return; // 코치 마크 안내 중엔 안내가 키를 받음 (Enter로 강화되지 않게)
      e.stopImmediatePropagation();
      const k = e.code || e.key;
      if (k === 'Escape' || e.key === 'Escape' || k === 'Backspace') { e.preventDefault(); closeModal(); }
      else if (k === 'Enter' || k === 'NumpadEnter' || e.key === 'Enter') {
        e.preventDefault();
        const a = document.activeElement;
        if (a && el.contains(a) && (a.tagName === 'BUTTON' || a.tagName === 'SUMMARY')) a.click();
        else el.querySelector('[data-up-go]:not([disabled])')?.click() || el.querySelector('[data-up-close]')?.click();
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(k)) {
        e.preventDefault();
        const f = focusables(); if (!f.length) return;
        const i = f.indexOf(document.activeElement), back = k === 'ArrowLeft' || k === 'ArrowUp' || (k === 'Tab' && e.shiftKey);
        f[(i < 0 ? (back ? f.length - 1 : 0) : (i + (back ? -1 : 1) + f.length) % f.length)].focus(); uiSound('move');
      }
    };
    window.addEventListener('keydown', m.onKey, true);
    el.addEventListener('click', (e) => {
      if (m.phase === 'fx') return;
      if (e.target === el) { closeModal(); return; }
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-up-close')) closeModal();
      else if (b.hasAttribute('data-up-go')) go();
    });
    const pv = window.home?.preview;
    if (pv) warmLevelShaders(pv.renderer, pv.scene, pv.camera).catch(() => {});
    uiSound('select');
    await ask();

    async function thumbs(st) {
      const want = [st.lv, Math.min(st.max, st.lv + 1)];
      const urls = await Promise.all(want.map((lv) => partThumb(partId, { carId: car.id, slot: p.slot, size: 360, lv }).catch(() => '')));
      return { from: urls[0], to: urls[1] };
    }
    async function ask() {
      m.phase = 'ask';
      const st = up.state(partId), nextLv = Math.min(st.max, st.lv + 1);
      el.querySelector('.pu-up-bal').textContent = '보유 ◆ ' + fmt(st.balance);
      el.classList.toggle('ismax', st.isMax);
      const body = el.querySelector('.pu-up-body');
      body.innerHTML = `<section class="pu-up-hero"><figure class="pu-up-art now lv${st.lv}"><img alt="${esc(p.name)} ★${st.lv}" hidden><span>⚙</span><figcaption>★${st.lv}</figcaption></figure>${st.isMax ? '' : `<span class="pu-up-arrow" aria-hidden="true">➜</span><figure class="pu-up-art next lv${nextLv}"><img alt="${esc(p.name)} ★${nextLv}" hidden><span>⚙</span><figcaption>★${nextLv}</figcaption></figure>`}<div class="pu-up-name"><b>${esc(p.name)}</b><span>${starsHtml(st.lv)}${st.isMax ? ' 최고 단계' : ` <i>→</i> ${starsHtml(nextLv, 'next')}`}</span></div></section><section class="pu-up-stats"><h4>${st.isMax ? '지금 능력치 (순정 대비)' : `강화하면 바뀌는 것 (★${st.lv} → ★${nextLv})`}</h4><ul><li class="pu-up-wait">계산 중…</li></ul></section>${st.isMax ? `<section class="pu-up-odds max"><div class="pu-up-pct"><strong>★${st.max}</strong><small>최고 단계</small></div><div class="pu-up-oddtxt"><span>이 부품은 더 강화할 수 없어요</span><span class="pu-up-safe">장점 ×${up.factors(st.lv).pro} · 단점 ×${up.factors(st.lv).con}</span></div></section>` : `<section class="pu-up-odds" data-coach="upgrade.chance">${oddsHtml(st)}</section><section class="pu-up-cost">${costHtml(st)}</section>`}`;
      const goLabel = st.isMax ? '' : st.canUpgrade ? `강화하기 <kbd>Enter</kbd>` : st.owned ? `◆ ${fmt(st.missing)} 부족` : esc(st.reason);
      el.querySelector('.pu-up-btns').innerHTML = `<button type="button" class="gm-btn" data-up-close>닫기 <kbd>Esc</kbd></button>${st.isMax ? '' : `<button type="button" class="gm-btn primary" data-up-go ${st.canUpgrade ? '' : 'disabled'}>${goLabel}</button>`}`;
      (el.querySelector('[data-up-go]:not([disabled])') || el.querySelector('[data-up-close]')).focus({ preventScroll: true });
      // 그림·능력치 (늦게 와도 됨)
      thumbs(st).then((u) => { if (modal !== m || m.phase !== 'ask') return; m.thumbs = u; const imgs = el.querySelectorAll('.pu-up-art img'); [u.from, u.to].forEach((src, i) => { const img = imgs[i]; if (img && src) { img.src = src; img.hidden = false; img.nextElementSibling.hidden = true; } }); });
      const pvs = await up.preview(car.id, partId, st.isMax ? { from: st.lv, to: st.lv } : {}).catch(() => null);
      if (modal !== m || m.phase !== 'ask') return;
      const list = el.querySelector('.pu-up-stats ul');
      let rows = st.isMax ? changeRows({ diff: { metrics: {}, score100: {} } }, pvs?.from, 6) : changeRows(pvs?.from, pvs?.to, 6);
      if (st.isMax) rows = rows.map((r) => ({ ...r, good: (r.score || METRIC[r.key]?.good ? r.b >= 0 : r.b <= 0) ? 'pro' : 'con' }));
      list.innerHTML = rows.length ? rows.map(st.isMax ? (r) => `<li class="pu-up-row ${r.good}"><span>${esc(r.name)}</span><strong>${num1(r.b, r.d)}</strong><small>${esc(r.unit)}</small></li>` : rowHtml).join('') : '<li class="pu-up-wait">숫자로 보이는 변화가 작아요 (성격 부품)</li>';
    }
    async function go() {
      if (m.phase !== 'ask') return;
      const before = up.state(partId);
      if (!before.canUpgrade) return;
      if (!m.thumbs.from) m.thumbs = await thumbs(before).catch(() => ({}));
      const res = up.roll(partId); // 결과 먼저 정하고 저장 (되돌릴 수 없음)
      if (!res.ok) { el.querySelector('.pu-up-cost').innerHTML = `<span class="pu-up-poor">${esc(res.message)}</span>`; return; }
      m.phase = 'fx';
      el.classList.add('fx');
      const equipped = parts.getBuild(car.id)[p.slot] === partId;
      const stage = document.querySelector('.h-carstage');
      await playUpgradeFx({
        res, slot: p.slot, equipped, preview: window.home?.preview, stage, thumbs: m.thumbs,
        setLevel: (lv) => preview(parts.getBuild(car.id), { [partId]: lv }),
      });
      preview(parts.getBuild(car.id));
      if (modal !== m) return;
      el.classList.remove('fx');
      await result(res, before);
    }
    async function result(res, before) {
      m.phase = 'result';
      const st = up.state(partId), ok = res.success;
      el.querySelector('.pu-up-bal').textContent = '보유 ◆ ' + fmt(st.balance);
      const nextPct = Math.round(st.chance * 100), add = Math.round((st.chance - res.chance) * 100);
      const body = el.querySelector('.pu-up-body');
      body.innerHTML = `<section class="pu-up-result ${ok ? 'ok' : 'no'}"><figure class="pu-up-art big lv${st.lv}"><img alt="" hidden><span>⚙</span></figure><div><b>${ok ? `Lv.${res.to} 강화 성공!` : '아깝다!'}</b><span>${esc(p.name)} ${starsHtml(st.lv)}</span>${ok ? `<small>장점 ×${up.factors(st.lv).pro} · 단점 ×${up.factors(st.lv).con}</small>` : `<small>${st.isMax ? '' : nextPct >= 100 ? '다음 강화는 100% 성공해요' : `다음 확률 <em>${nextPct}%</em>${add > 0 ? ` (+${add}%)` : ''}`} · 단계는 그대로예요</small>`}</div></section>${ok ? `<section class="pu-up-stats"><h4>바뀐 것 (★${res.from} → ★${res.to})</h4><ul><li class="pu-up-wait">계산 중…</li></ul></section>` : `<section class="pu-up-odds">${oddsHtml(st)}</section>`}${st.isMax ? '<section class="pu-up-cost"><span>🏆 최고 단계! 더 강화할 게 없어요</span></section>' : `<section class="pu-up-cost">${costHtml(st)}</section>`}`;
      const img = body.querySelector('.pu-up-art img');
      if (ok) body.querySelector('.pu-up-result > div').insertAdjacentHTML('beforeend', `<small>${st.isMax ? 'MAX' : `다음 강화 ${nextPct}% · ◆${fmt(st.cost)}`}</small>`);
      partThumb(partId, { carId: car.id, slot: p.slot, size: 360, lv: st.lv }).then((u) => { if (u && img.isConnected) { img.src = u; img.hidden = false; img.nextElementSibling.hidden = true; } }).catch(() => {});
      el.querySelector('.pu-up-btns').innerHTML = `<button type="button" class="gm-btn" data-up-close>닫기 <kbd>Esc</kbd></button>${st.isMax ? '' : `<button type="button" class="gm-btn primary" data-up-again ${st.canUpgrade ? '' : 'disabled'}>${st.canUpgrade ? `한 번 더 · ◆${fmt(st.cost)} <kbd>Enter</kbd>` : st.owned ? `◆ ${fmt(st.missing)} 부족` : esc(st.reason)}</button>`}`;
      el.querySelector('[data-up-again]')?.addEventListener('click', () => { m.thumbs = {}; ask(); });
      (el.querySelector('[data-up-again]:not([disabled])') || el.querySelector('[data-up-close]')).focus({ preventScroll: true });
      if (ok) {
        upgradeSound.ding();
        const pvs = await up.preview(car.id, partId, { from: res.from, to: res.to }).catch(() => null);
        if (modal !== m || m.phase !== 'result') return;
        const rows = changeRows(pvs?.from, pvs?.to, 5);
        const list = el.querySelector('.pu-up-stats ul');
        if (list) list.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<li class="pu-up-wait">숫자로 보이는 변화가 작아요 (성격 부품)</li>';
      }
    }
  }

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || busy || modal) return;
    if (b.dataset.up) { openUpgrade(b.dataset.up); return; }
    if (b.dataset.part && e.target.closest('.pu-cardstars, .pu-cardup') && upOpen()) { chosen = b.dataset.part; render(); preview({ ...parts.getBuild(car.id), [slot]: chosen }); openUpgrade(chosen); return; }
    if (b.dataset.slot && b.classList.contains('pu-slotlock')) { const lk = slotLockLv(b.dataset.slot), m = box.querySelector('.pu-slotmsg'); uiSound('back'); if (m && lk) { const sl = box.querySelector('.pu-slots'); m.textContent = '🔒 ' + slotLockMsg(b.dataset.slot, lk); m.hidden = false; if (sl) m.style.top = sl.offsetTop + sl.offsetHeight + 4 + 'px'; clearTimeout(m._t); m._t = setTimeout(() => { m.hidden = true; }, 2600); } return; }
    if (b.dataset.slot) { slot = b.dataset.slot; picked = true; o.viewSlot?.(slot); chosen = parts.getBuild(car.id)[slot]; render(); box.querySelector('[data-slot="' + slot + '"]')?.focus({ preventScroll: true }); }
    else if (b.dataset.part) {
      chosen = b.dataset.part; render(); box.querySelector('[data-part="' + chosen + '"]')?.focus({ preventScroll: true });
      preview({ ...parts.getBuild(car.id), [slot]: chosen });
      const detail = box.querySelector('.pu-detail'), scroller = box.closest('.ct-body');
      if (detail && scroller) { const d = detail.getBoundingClientRect(), s = scroller.getBoundingClientRect(); if (d.bottom > s.bottom) scroller.scrollTop += d.bottom - s.bottom + 6; }
    } else if (b.hasAttribute('data-fit') && open) {
      const p = parts.listParts(slot, { stock: true, carId: car.id }).find((p) => p.id === chosen);
      if (!p.owned) {
        const need = (p.price || 0) - bal('pit');
        if (need > 0) { box.querySelector('.pu-feedback').textContent = '⬡ ' + fmt(need) + ' 피트 조각이 더 필요해요. 레이스·목표·아카데미에서 모아 보세요.'; return; }
        if (!(await confirmDialog(p.name, '⬡ ' + p.price + ' 피트 조각으로 구매할까요?', '구매하기'))) return;
        const r = await parts.buyPart(p.id);
        if (!r.ok) { box.querySelector('.pu-feedback').textContent = r.message; return; }
        const hc = box.querySelector('.pu-head span'); if (hc) hc.textContent = '⬡ ' + fmt(bal('pit'));
      }
      const before = parts.getBuild(car.id), r = parts.setPart(car.id, slot, chosen);
      if (r.ok) { const fb = box.querySelector('[data-fit]'); if (fb) { fb.disabled = true; fb.textContent = '🔧 교체 중…'; } await animate(r.build, before); }
      else box.querySelector('.pu-feedback').textContent = r.message;
    } else if (b.hasAttribute('data-reset') && open) { const before = parts.getBuild(car.id); parts.resetBuild(car.id); await animate(parts.getBuild(car.id), before); }
    else if (b.dataset.savePreset !== undefined && open) { const i = +b.dataset.savePreset; parts.savePreset(car.id, i, '조립 ' + (i + 1)); render(); }
    else if (b.dataset.preset !== undefined && open) { const i = +b.dataset.preset, p = parts.listPresets(car.id)[i]; if (p) { const before = parts.getBuild(car.id); parts.usePreset(car.id, i); await animate(parts.getBuild(car.id), before); } else { parts.savePreset(car.id, i, '조립 ' + (i + 1)); render(); } }
  });
  // 다른 곳에서 단계·지갑이 바뀌면 다시 그림 (상점 구매·보상)
  for (const ev of ['gimmick:wallet', 'gimmick:partLv']) window.addEventListener(ev, () => { if (car && !busy && !modal && box.isConnected && box.offsetParent) render(); });
  return {
    show(c, unlocked) { if (!car || car.id !== c.id) picked = false; car = c; open = unlocked; if (!picked || slotLockLv(slot)) slot = firstSlot(); chosen = parts.getBuild(c.id)[slot]; render(); },
    activate() { meta.claimPartsBox?.(); render(); o.preview?.(parts.getBuild(car.id)); const pv = window.home?.preview; if (pv && upOpen()) setTimeout(() => warmLevelShaders(pv.renderer, pv.scene, pv.camera).catch(() => {}), 400); },
    openUpgrade,
    get upgradeOpen() { return !!modal; },
  };
}
