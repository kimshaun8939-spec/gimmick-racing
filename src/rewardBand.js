import { medalIcon, MEDAL_NAMES, medalTime } from './medals.js';
// 결과 화면 '보상 띠' + '레벨 업 카드' (rewards1, 2026-11-15, 점검 .debug/agents/rewards-review.md 제안 A·C)
//   보상 띠 (완주 시간 바로 아래 한 줄, 휴대폰도 첫 화면 안):
//     [Lv·티어 + XP 막대(이번 판 전 = 진한 색, 이번 판 증가분 = 밝은 색, 차오름) + '+n XP' · 다음 레벨까지 n XP (약 n판)]
//     [이번 판 조각 세 칩 ⬡ +n · ◆ +n · ✿ +n (아래 보유) (upgradeD2: summary gain·wallet)] [다음 보상 그림 카드 (rewardPath.nextRewardLevel)]
//   레벨 업 카드 (결과 화면 스크롤 맨 위): 'Lv.n 달성 — 새로 열렸어요' + 그림 타일 최대 4개(+n개 더) + 받은 선물 부품 한 줄
//     타일 = 바로 가기 (부품 → 차고 조립 탭, 코스튬·색 → 커스텀 탭, 차 → 그 차) = 홈 주소 ?menu=car&car=..&carTab=..
//     이 카드를 보여 주면 홈 레벨 업 창이 같은 소식을 또 띄우지 않게 'gimmick.seenLevel'을 지금 레벨로 (unlocks.takeLevelNews가 읽는 값),
//     선물 부품 소식은 parts.takeNews()로 가져감 (예전 metaResultsHtml과 같음)
//   경험치·보상 칸(hud .res-rewards)은 업적·목표·자세히만 (rewardDetailsHtml) → XP·코인·다음 목표가 두 번 안 나옴
//   움직임 줄이기(prefers-reduced-motion)면 애니메이션 없이 마지막 상태
// hud.js가 씀: prepareRewards(meta, { carId, room }) → model, rewardBandHtml(model), levelUpHtml(model), rewardDetailsHtml(meta), mountRewards(rootEl, model)
import { isOpen, levelOf, rewardLock, rewardLockText } from './featureGate.js';
import { levelOfXp } from './profile.js';
import { nextRewardLevel, nextRewards, rewardsBetween, racesToLevel } from './rewardPath.js';
import { takeNews } from './parts.js';
import { ACHIEVEMENTS, CURRENCIES } from './metaCatalog.js';
import { amount, currencyIcon, rewardChipsHtml, linesHtml, money, CUR_KINDS } from './metaUI.js';
import { ensureMetaStyle } from './meta.js';
import { setLast } from './gameData.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n = (v) => Math.floor(v || 0).toLocaleString('ko-KR');
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
const pct = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10;
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function ensureRewardStyle() {
  if (typeof document === 'undefined' || document.querySelector('link[data-reward-band]')) return;
  const ln = document.createElement('link');
  ln.rel = 'stylesheet';
  ln.href = new URL('./rewardBand.css', import.meta.url).href;
  ln.dataset.rewardBand = '1';
  document.head.appendChild(ln);
}
ensureRewardStyle();

// ───────── 그림 ─────────
const SLOT_COLOR = { engine: '#ff9a6b', gearbox: '#c9b6ff', tire: '#8ae3d0', aero: '#9cc8ff', water: '#6fd6ff', susp: '#ffd27a', wing: '#b6f0ff' };
const SLOT_SVG = {
  engine: '<path d="M18 30h44v24H18z"/><path d="M26 30v-8h28v8M24 54v6m32-6v6M62 38h8v10h-8M10 38h8v10h-8"/><path d="M28 38v8m8-8v8m8-8v8m8-8v8"/>',
  gearbox: '<circle cx="31" cy="40" r="13"/><circle cx="31" cy="40" r="4"/><circle cx="55" cy="36" r="9"/><circle cx="55" cy="36" r="3"/><path d="M31 21v6m0 26v6M12 40h6m26 0h6M55 22v5m0 18v5M41 36h5m18 0h5"/>',
  tire: '<circle cx="40" cy="40" r="22"/><circle cx="40" cy="40" r="12"/><circle cx="40" cy="40" r="3"/><path d="M40 18v10m0 24v10M18 40h10m24 0h10"/>',
  aero: '<path d="M10 40l56-12 6 6-56 14z"/><path d="M22 46v12m40-24v20M16 60h12m28-6h12"/>',
  water: '<path d="M10 34h58l-8 14H22z"/><path d="M20 34l6-8h26l8 8"/><path d="M8 58q8-5 16 0t16 0 16 0 16 0"/>',
};
function partArt(it) {
  const c = SLOT_COLOR[it.slot] || '#9cc8ff';
  return `<svg class="rw-svg" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36" fill="${c}14"/><g fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${SLOT_SVG[it.slot] || SLOT_SVG.engine}</g></svg>`;
}
function paintArt(it) {
  const body = it.color || '#888', acc = it.accent || '#fff';
  return `<svg class="rw-svg" viewBox="0 0 120 60" aria-hidden="true"><ellipse cx="60" cy="50" rx="46" ry="5" fill="#000" opacity=".35"/><path d="M12 42c0-7 6-11 14-12l14-10h34l16 10c10 1 18 5 18 12v4H12z" fill="${esc(body)}" stroke="#ffffff55" stroke-width="1.2"/><path d="M44 22h28l10 8H38z" fill="#0d1a2c" opacity=".75"/><path d="M14 38h92" stroke="${esc(acc)}" stroke-width="3"/><circle cx="32" cy="46" r="7" fill="#15181e" stroke="#ccd" stroke-width="2"/><circle cx="90" cy="46" r="7" fill="#15181e" stroke="#ccd" stroke-width="2"/></svg>`;
}
function tierArt(it) {
  return `<span class="rw-tierart" style="--tc:${esc(it.color || '#ffd24a')}">${esc(it.icon || '🏅')}</span>`;
}
/** 그림 칸 HTML. 차·코스튬은 사진 자리(data-rw-thumb)만 두고 mountRewards가 carThumbs로 채움 */
function artHtml(it) {
  if (!it) return '<span class="rw-emoji">🏁</span>';
  if (it.kind === 'part') return partArt(it);
  if (it.kind === 'paint') return paintArt(it);
  if (it.kind === 'tier') return tierArt(it);
  const thumb = it.kind === 'car' ? it.id : `${it.carId}@${it.id}`;
  return `<span class="rw-thumb" data-rw-thumb="${esc(thumb)}" data-rw-car="${esc(it.carId || it.id)}" data-rw-costume="${esc(it.kind === 'costume' ? it.id : '')}"><span class="rw-emoji">${it.kind === 'car' ? '🚗' : '✦'}</span></span>`;
}
const KIND_LABEL = { car: '새 차', part: '부품', paint: '색', costume: '코스튬', tier: '티어' };
/** 가격 글: 아이콘 + 숫자 (재화 3종, upgradeD2) */
const priceTxt = (it) => (it.price > 0 ? `${currencyIcon(it.currency || (it.kind === 'part' || it.kind === 'car' ? 'pit' : 'custom'), 12)} ${n(it.price)}` : '');
/** 타일 아래 작은 줄 (HTML) */
function subHtml(it) {
  if (rewardLock(it)) return rewardLockText(it);
  if (it.kind === 'part') return `${esc(it.slotName)} · ${it.how === 'gift' ? '선물' : priceTxt(it)}`;
  if (it.kind === 'costume') return `${esc(it.carName)} · ${priceTxt(it)}`;
  if (it.kind === 'car') return it.state === 'owned' ? '내 차' : `${priceTxt(it)}으로 살 수 있어요`;
  if (it.kind === 'paint') return it.state === 'owned' ? '모든 차에 칠하기' : `${priceTxt(it)} · 모든 차에 칠하기`;
  return '등급 이름';
}

// ───────── 모델 ─────────
/**
 * 결과 화면 보상 모델 (한 번만 부름: 선물 소식을 가져가고 레벨 업 소식을 '본 것'으로 표시함)
 *   meta = meta.js summary() { profile, raceXp, xp, coins, balance, beforeLevel, ... }
 */
export function prepareRewards(meta, opts = {}) {
  if (!meta || !meta.profile) return null;
  const carId = opts.carId || 'f1';
  const after = meta.profile;
  const gained = num(meta.raceXp) + num(meta.xp);
  const before = levelOfXp(Math.max(0, num(after.xp) - gained));
  const fromLv = Math.min(before.level, Number(meta.beforeLevel) || before.level);
  const levelUp = after.level > fromLv;
  const max = after.level >= 99;
  const toNext = max ? null : racesToLevel(after.level + 1, { xp: after.xp });
  const next = nextRewardLevel({ carId, level: after.level });
  const toReward = next ? racesToLevel(next.level, { xp: after.xp }) : null;
  const mineNext = nextRewards({ carId, level: after.level, n: 80, mine: true }).find((x) => x.kind === 'costume' && x.carId === carId) || null;
  let gifts = [];
  try { gifts = takeNews(); } catch {}
  let unlocked = [], newsFrom = fromLv;
  if (levelUp) {
    let seen = fromLv;
    try { seen = Number(localStorage.getItem('gimmick.seenLevel')) || fromLv; } catch {}
    newsFrom = Math.max(1, Math.min(fromLv, seen));
    unlocked = rewardsBetween(newsFrom, after.level, { carId, level: after.level });
    try { if ((Number(localStorage.getItem('gimmick.seenLevel')) || 1) < after.level) localStorage.setItem('gimmick.seenLevel', String(after.level)); } catch {}
  }
  // 재화 3종 (upgradeD2): 이번 판 얻은 양 gain · 보유 wallet (예전 summary면 피트만), 레벨 업 보너스 = 'Lv' 줄들의 합
  const gain = { pit: 0, up: 0, custom: 0, ...(meta.gain || { pit: num(meta.coins) }) };
  const wallet = { pit: 0, up: 0, custom: 0, ...(meta.wallet || { pit: num(meta.balance) }) };
  const lvBonus = { pit: 0, up: 0, custom: 0 };
  for (const l of meta.lines || []) if (/^레벨 업/.test(l.reason || '')) for (const k of CUR_KINDS) lvBonus[k] += num(l[k]);
  return { medal:meta.medal, carId, room: !!opts.room, after, before, gained, coins: num(meta.coins), balance: num(meta.balance), gain, wallet, lvBonus, levelUp, tierUp: levelUp && before.title !== after.title, newsFrom, max, toNext, next, toReward, mineNext, gifts, unlocked };
}

// ───────── 보상 띠 ─────────
/** 다음 보상 그룹에서 크게 보여 줄 것: 내 차·공용 먼저 (다른 차 코스튬은 그 레벨에 그것뿐일 때만) */
function pickNext(items) {
  return items.find((x) => x.kind !== 'tier' && x.mine) || items.find((x) => x.mine) || items[0];
}
export function rewardBandHtml(m) {
  if (!m) return '';
  const a = m.after, b = m.before;
  const bp = m.max ? 100 : m.levelUp ? 0 : pct(b.pct), ap = m.max ? 100 : pct(a.pct); // 최고 레벨이면 막대가 꽉 찬 채로
  const left = m.max ? '최고 레벨' : `${n(a.have)} / ${n(a.need)} XP · 다음 레벨까지 <b>${n(a.need - a.have)} XP</b>${m.toNext && m.toNext.races ? ` <em>(약 ${m.toNext.races}판)</em>` : ''}`;
  const xp = `<div class="rw-xp">
    <div class="rw-lvrow"><span class="rw-tierico" style="--tc:${esc(a.color)}" data-rw-ico>${esc(a.icon)}</span><b class="rw-lv">Lv.<span data-rw-lv>${a.level}</span></b><small class="rw-tier" data-rw-tier style="color:${esc(a.color)}">${esc(a.title)}</small>${m.levelUp ? '<em class="rw-stamp on">레벨 업!</em>' : ''}
      <strong class="rw-gain">+<span data-rw-count="${m.gained}">${n(m.gained)}</span> XP</strong></div>
    <div class="rw-bar" role="progressbar" aria-label="다음 레벨 경험치" aria-valuemin="0" aria-valuemax="${a.need}" aria-valuenow="${Math.min(a.have, a.need)}">
      <i class="rw-old" style="width:${bp}%"></i><i class="rw-new" style="left:${bp}%;width:${Math.max(0, ap - bp)}%"></i></div>
    <small class="rw-left">${left}</small></div>`;
  // 세 조각 칩: 이번 판 +n (숫자가 올라감) · 아래 보유
  const chip = (k) => { const c = CURRENCIES[k], g = num(m.gain[k]); return `<span class="rw-c rw-c-${k}${g ? '' : ' zero'}" style="--cur:${c.color}" title="${esc(c.name + ' · ' + c.use)}" aria-label="${esc(c.name)} +${n(g)}개, 보유 ${n(m.wallet[k])}개">${currencyIcon(k, 24)}<span class="rw-cv"><b>+<span data-rw-count="${g}">${n(g)}</span></b><small><i class="rw-cn">${esc(c.short)} </i><i class="rw-hold">보유 </i>${n(m.wallet[k])}</small></span></span>`; };
  const coin = `<div class="rw-coin rw-cur"><small class="rw-curhead">이번 판 조각 <em>· 보유</em></small><div class="rw-curs">${CUR_KINDS.map(chip).join('')}</div></div>`;
  let next;
  if (m.next) {
    const main = pickNext(m.next.items);
    const rest = m.next.items.filter((x) => x !== main);
    // 다른 차 코스튬만 남았을 때: 내 차의 다음 코스튬도 같이 알려 줌
    const mineTxt = !main.mine && m.mineNext && m.mineNext.level > m.next.level ? ` · 내 차 다음 코스튬 Lv.${m.mineNext.level} ${m.mineNext.name}` : '';
    const more = rest.slice(0, 2).map((x) => (x.kind === 'costume' && !x.mine ? `${x.carName} 코스튬` : x.name)).join(' · ') + (rest.length > 2 ? ` 외 ${rest.length - 2}` : '');
    // 바로 다음 레벨이면 남은 XP·판 수는 막대 아래 줄과 같으므로 안 적음
    const when = m.toReward && m.toReward.xp && m.next.level > m.after.level + 1 ? `${n(m.toReward.xp)} XP 남음 · 약 ${m.toReward.races}판` : '';
    next = `<div class="rw-next" title="${esc(m.next.items.map((x) => `${KIND_LABEL[x.kind]} · ${x.name}`).join('\n'))}">
      <div class="rw-art rw-k-${main.kind}">${artHtml(main)}</div>
      <div class="rw-ntext"><small>다음 보상 · <b>Lv.${m.next.level}</b>${when ? ` · ${when}` : ''}</small><b class="rw-nname">${main.kind === 'costume' && !main.mine ? esc(main.carName) + ' · ' : ''}${esc(main.name)}</b><span>${esc(KIND_LABEL[main.kind])}${main.kind === 'part' ? ' · ' + esc(main.slotName) : ''}${more ? ' 외 ' + rest.length + '개: ' + esc(more) : ''}${esc(mineTxt)}</span></div></div>`;
  } else {
    next = `<div class="rw-next rw-done"><div class="rw-art"><span class="rw-emoji">🏁</span></div><div class="rw-ntext"><small>다음 보상</small><b class="rw-nname">모든 레벨 보상 달성</b><span>피트 샵에서 조각으로 차·부품·꾸미기를 사 보세요</span></div></div>`;
  }
  return `${m.medal?'<div class="ms-result-medal">'+medalIcon(m.medal.tier)+MEDAL_NAMES[m.medal.tier-1]+'메달 달성!'+(m.medal.next?' · 다음 '+MEDAL_NAMES[m.medal.tier]+' '+medalTime(m.medal.next):' · 모든 메달을 모았어요')+'</div>':''}<section class="rw-band${m.levelUp ? ' lvup' : ''}${m.max ? ' max' : ''}" data-rw-band aria-label="이번 판 보상">${xp}${coin}${next}</section>`;
}

// ───────── 레벨 업 카드 ─────────
function goUrl(it, carId) {
  if (rewardLock(it)) return '';
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('menu', 'car');
  if (it.kind === 'part') { u.searchParams.set('car', carId); u.searchParams.set('carTab', 'parts'); }
  else if (it.kind === 'costume') { u.searchParams.set('car', it.carId); u.searchParams.set('carTab', 'custom'); }
  else if (it.kind === 'car') { u.searchParams.set('car', it.id); u.searchParams.set('carTab', 'info'); }
  else if (it.kind === 'paint') { u.searchParams.set('car', carId); u.searchParams.set('carTab', 'custom'); }
  else return '';
  return u.pathname + u.search;
}
function tile(it, m) {
  const url = m.room ? '' : goUrl(it, m.carId);
  const inner = `<span class="rw-tart rw-k-${it.kind}">${artHtml(it)}</span><span class="rw-tkind">${esc(KIND_LABEL[it.kind])}</span><b>${esc(it.name)}</b><small>${subHtml(it)}</small>${url ? '<span class="rw-tgo">바로 가기 ›</span>' : ''}`;
  return url ? `<button type="button" class="rw-tile" data-rw-go="${esc(url)}">${inner}</button>` : `<div class="rw-tile">${inner}</div>`;
}
/** 타일 순서: 내 차·공용 (차·부품·색·내 코스튬) → 다른 차 코스튬. 티어는 머리에 */
function tileOrder(list) {
  const r = (x) => (x.kind === 'costume' && !x.mine ? 9 : x.kind === 'costume' ? 3 : { car: 0, part: 1, paint: 2 }[x.kind] ?? 5);
  return list.filter((x) => x.kind !== 'tier').map((x, i) => [x, i]).sort((p, q) => r(p[0]) - r(q[0]) || q[0].level - p[0].level || p[1] - q[1]).map((p) => p[0]);
}
export function levelUpHtml(m) {
  if (!m || (!m.levelUp && !m.gifts.length)) return '';
  const gifts = m.gifts.length
    ? `<div class="rw-gifts"><span>🎁 받은 선물</span><b>${m.gifts.map((g) => esc(g.name)).join(' · ')}</b><small>${esc(m.gifts.map((g) => g.text.replace(/^🔧 새 부품: [^—]*— /, '')).join(' · '))}</small>${m.room ? '' : !isOpen('parts') ? `<small>🔒 Lv.${levelOf('parts')}에 열려요</small>` : `<button type="button" class="rw-giftgo" data-rw-go="${esc(goUrl({ kind: 'part' }, m.carId))}">차고에서 끼우기 ›</button>`}</div>`
    : '';
  if (!m.levelUp) return `<section class="rw-levelup gift-only" aria-label="받은 선물">${gifts}</section>`;
  const tier = m.unlocked.find((x) => x.kind === 'tier');
  const tiles = tileOrder(m.unlocked);
  const shown = tiles.slice(0, 4), more = tiles.slice(4);
  const nextTxt = m.next ? `다음 보상 Lv.${m.next.level}` : '';
  return `<section class="rw-levelup" aria-label="레벨 업">
    <header><span class="rw-burst" aria-hidden="true">🎉</span><div><b>Lv.${m.after.level} 달성</b><small>${tiles.length ? '새로 열렸어요' : '이번 레벨엔 새 보상이 없어요' + (nextTxt ? ' · ' + nextTxt : '')}</small></div>${CUR_KINDS.some((k) => m.lvBonus[k] > 0) ? `<span class="rw-lvbonus"><small>레벨 업 보너스</small>${rewardChipsHtml(m.lvBonus, { size: 15 })}</span>` : ''}${tier ? `<span class="rw-tierup" style="--tc:${esc(tier.color)}">${esc(tier.icon)} ${esc(tier.name)} 승급</span>` : ''}</header>
    ${shown.length ? `<div class="rw-tiles" style="--n:${shown.length}">${shown.map((x) => tile(x, m)).join('')}</div>` : ''}
    ${more.length ? `<details class="rw-more"><summary>+ ${more.length}개 더 보기</summary><div class="rw-tiles small" style="--n:4">${more.map((x) => tile(x, m)).join('')}</div></details>` : ''}
    ${gifts}</section>`;
}

// ───────── 경험치·보상 칸 (업적·목표·자세히만) ─────────
export function rewardDetailsHtml(r) {
  if (!r) return '';
  const achieved = (r.achievements || []).map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean).sort((a, b) => b.tier - a.tier);
  const row = (a) => '<span class="rw-arow">' + ['', '🥉', '🥈', '🥇'][a.tier] + ' <span class="rw-an">' + esc(a.name) + '</span> <b class="mt-cur-row">' + rewardChipsHtml(a.reward || { pit: a.coins }, { size: 13 }) + ' +' + a.xp + ' XP</b></span>';
  const bar = (v, g, label) => '<div class="mt-bar" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="' + g + '" aria-valuenow="' + Math.min(g, Math.floor(v)) + '"><i style="width:' + Math.min(100, (100 * v) / g) + '%"></i></div>';
  const goals = r.goals || [], progress = r.progress || [];
  const top = achieved.length
    ? '<div class="mt-result-ach">' + achieved.slice(0, 3).map(row).join('') + '</div>' + (achieved.length > 3 ? '<details class="res-detail mt-more-ach"><summary>업적 ' + (achieved.length - 3) + '개 더</summary>' + achieved.slice(3).map(row).join('') + '</details>' : '')
    : '<p class="rw-none">이번 판에 새로 딴 업적은 없어요.</p>';
  const prog = progress.length ? '<div class="rw-prog"><small>다음 업적</small>' + progress.map((a) => '<div class="mt-result-progress"><span>' + esc(a.name) + '</span><small>' + amount(a.value, a.unit) + ' / ' + amount(a.goal, a.unit) + '</small>' + bar(a.value, a.goal, a.name) + '</div>').join('') + '</div>' : '';
  return '<section class="mt-result rw-detail">' + top +
    (goals.length ? '<p class="mt-result-goals">✓ ' + goals.map((g) => esc(g.name)).join(' · ') + '</p>' : '') +
    (r.title ? '<div class="mt-result-title">✦ ' + esc(r.title) + '</div>' : '') + prog +
    '<details class="res-detail"><summary>보상 내역 <span class="mt-cur-row">' + rewardChipsHtml(r.gain || { pit: r.coins }, { size: 13 }) + '</span></summary><div class="mt-result-breakdown">' + linesHtml(r) + '<div class="mt-line"><span>XP</span><span>완주 +' + n(r.raceXp) + ' · 업적·목표 +' + n(r.xp) + '</span></div></div></details>' +
    (isOpen('goals') ? '<a class="mt-result-link" href="?menu=achievements">업적 · 목표 →</a>' : '<span class="mt-result-link">🔒 Lv.' + levelOf('goals') + '에 열려요</span>') + '</section>';
}

// ───────── 움직임·사진·바로 가기 ─────────
function countUp(el, to, ms) {
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = n(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  el.textContent = '0';
  requestAnimationFrame(step);
  setTimeout(() => { if (el.isConnected) el.textContent = n(to); }, ms + 150); // 탭이 숨겨져 rAF가 멈춰도 숫자는 맞게
}
function animate(root, m) {
  const band = root.querySelector('[data-rw-band]');
  if (!band || reduced()) return;
  const old = band.querySelector('.rw-old'), nw = band.querySelector('.rw-new'), stamp = band.querySelector('.rw-stamp');
  const lv = band.querySelector('[data-rw-lv]'), tier = band.querySelector('[data-rw-tier]'), ico = band.querySelector('[data-rw-ico]');
  const a = m.after, b = m.before;
  const set = (o, l, w, tr) => { o.style.transition = tr || 'none'; if (l != null) o.style.left = l + '%'; o.style.width = w + '%'; };
  const bp = pct(b.pct), ap = m.max ? 100 : pct(a.pct);
  for (const c of band.querySelectorAll('[data-rw-count]')) countUp(c, Number(c.dataset.rwCount) || 0, 900);
  if (m.max && !m.levelUp) return;
  if (!m.levelUp) {
    set(nw, bp, 0);
    void nw.offsetWidth;
    set(nw, bp, Math.max(0, ap - bp), 'width .9s cubic-bezier(.2,.8,.2,1) .25s');
    return;
  }
  // 레벨 업: 이번 판 전 레벨에서 끝까지 찼다가 'Lv.n!' 도장 → 새 레벨 막대가 다시 참
  stamp?.classList.remove('on');
  lv.textContent = b.level; tier.textContent = b.title; tier.style.color = b.color; ico.textContent = b.icon; ico.style.setProperty('--tc', b.color);
  set(old, null, bp); set(nw, bp, 0);
  void nw.offsetWidth;
  set(nw, bp, 100 - bp, 'width .75s cubic-bezier(.4,.1,.6,1) .25s');
  setTimeout(() => {
    if (!band.isConnected) return;
    band.classList.add('flash');
    stamp?.classList.add('on');
    lv.textContent = a.level; tier.textContent = a.title; tier.style.color = a.color; ico.textContent = a.icon; ico.style.setProperty('--tc', a.color);
    set(old, null, 0); set(nw, 0, 0);
    void nw.offsetWidth;
    set(nw, 0, ap, 'width .7s cubic-bezier(.2,.8,.2,1) .15s');
  }, 1050);
}
async function fillThumbs(root) {
  const slots = [...root.querySelectorAll('[data-rw-thumb]')];
  if (!slots.length) return;
  try {
    const [{ loadCarThumbs, thumbUrl }, roster, cos, un] = await Promise.all([import('./garageThumbQueue.js'), import('./carRoster.js'), import('./carCostumes.js'), import('./unlocks.js')]);
    const put = (id, url) => { for (const s of root.querySelectorAll('[data-rw-thumb]')) if (s.dataset.rwThumb === id) { const im = new Image(); im.alt = ''; im.src = url; s.replaceChildren(im); } };
    const cars = await roster.listCars();
    const reqs = [], seen = new Set();
    for (const s of slots) {
      const id = s.dataset.rwThumb;
      if (seen.has(id)) continue;
      seen.add(id);
      const car = cars.find((c) => c.id === s.dataset.rwCar);
      if (!car) continue;
      const painted = un.applyPaint(car.look, car.id);
      const costume = s.dataset.rwCostume || (un.isCostumeUnlocked(car.id, un.getCostume(car.id)) ? un.getCostume(car.id) : '');
      // 홈 차고와 같은 사진 이름·모습 → 이미 찍어 둔 사진을 같이 씀
      reqs.push({ ...car, id, look: cos.applyCostume(painted, costume) });
      const u = thumbUrl(id);
      if (u) put(id, u);
    }
    if (reqs.length) loadCarThumbs(reqs, { channel: 'reward-band', onThumb: (id, url) => root.isConnected && put(id, url) });
  } catch (e) {
    console.warn('보상 사진', e);
  }
}
/** 결과 화면에 붙인 뒤 부름: 막대·숫자 움직임, 차·코스튬 사진, 바로 가기 */
export function mountRewards(root, m) {
  if (!root || !m) return;
  try { ensureMetaStyle(); } catch {}
  animate(root, m);
  root.querySelectorAll('[data-rw-go]').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      const q = new URLSearchParams(location.search);
      try { setLast({ ...(q.get('map') ? { map: q.get('map') } : {}), car: q.get('car') || m.carId }); } catch {}
      location.href = b.dataset.rwGo;
    }),
  );
  setTimeout(() => fillThumbs(root), reduced() ? 0 : 450);
}
