// 부품 강화 (작업 A, 2026-11-15, 설계 .debug/design/upgrade-design.md §1·§2, 약속 .debug/agents/upgrade-contract.md)
//   부품은 살 때 Lv1 → Lv5. 장점은 커지고(100→140%) 단점은 줄어듦(100→10%, 0은 안 됨) — 값 계산은 parts.js applyBuild
//   확률 100/80/60/40% (Lv1→2…4→5), 실패해도 단계는 그대로·낸 강화 조각만 씀, 실패마다 다음 확률 +10/+12/+15%p (천장 2·4·4번)
//   비용 강화 조각 30/60/100/150 (parts.json upgrade.cost)
//   저장 localStorage 'gimmick.partLv' = { v:1, parts: { 부품 id: { lv, fails, tries, last } } } (이 기기, 부품마다 하나 = 모든 차 공용)
//   결과는 roll() 안에서 정하고 → 조각 빼기 → 저장까지 끝낸 뒤 돌려줌 (화면 애니메이션은 그다음) → 새로 고침으로 다시 굴릴 수 없음
//   지갑은 작업 B meta.js spend/balance('up') (.debug/agents/wallet-contract.md). 시험용 setWallet·setRandom
//   Three.js 안 씀. 기능 해금(Lv5 '부품 강화')은 여기서 막지 않음 (화면이 featureGate로)
import { partOf, isOwned, partLevel, maxLevel, starsOf, lvFactors, upgradeConfig, LV_KEY } from './parts.js';
import * as metaMod from './meta.js';

const CFG = upgradeConfig() || { max: 1, cost: [], chance: [], pity: [], ceiling: [], currency: 'up' };
export const MAX = maxLevel();
const KIND = CFG.currency || 'up';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const emit = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {} };

// ───────── 지갑·난수 (시험용 주입) ─────────
let walletOverride = null;
let rnd = null;
/** 시험용 지갑 { balance(kind), spend(kind, n, reason) → true|{ok}, refund?(kind, n, reason) } — null이면 meta.js 지갑 */
export function setWallet(w) { walletOverride = w || null; }
/** 시험용 난수 () => 0~1 — null이면 Math.random */
export function setRandom(fn) { rnd = typeof fn === 'function' ? fn : null; }
function wallet() {
  if (walletOverride) return walletOverride;
  const M = metaMod.meta || {};
  const pick = (name) => (typeof metaMod[name] === 'function' ? metaMod[name] : typeof M[name] === 'function' ? M[name].bind(M) : null);
  const spend = pick('spend'), balance = pick('balance');
  return spend ? { spend, balance: balance || (() => 0), refund: pick('refund') || pick('credit') } : null;
}
const paidOk = (r) => r === true || (isObj(r) && r.ok === true);

// ───────── 저장 ─────────
function load() {
  try {
    const j = JSON.parse(localStorage.getItem(LV_KEY) || 'null');
    if (isObj(j) && isObj(j.parts)) return { v: 1, ...j, parts: j.parts };
  } catch {}
  return { v: 1, parts: {} };
}
function save(s) {
  try { localStorage.setItem(LV_KEY, JSON.stringify(s)); return true; } catch { return false; }
}
function rec(s, id) {
  const r = isObj(s.parts[id]) ? s.parts[id] : {};
  return { lv: partLevel(id), fails: Math.max(0, Math.floor(Number(r.fails) || 0)), tries: Math.max(0, Math.floor(Number(r.tries) || 0)), last: r.last || null };
}

// ───────── 숫자 ─────────
/** 그 단계 배수 { pro, con } */
export const factors = (lv) => lvFactors(lv);
/** 부품 단계 (모르는 id·순정 = 1) */
export const level = (partId) => partLevel(partId);
/** 내 단계 { 부품 id: lv } (Lv2 이상만) */
export function levels() {
  const s = load(), out = {};
  for (const id of Object.keys(s.parts)) { const l = partLevel(id); if (l > 1) out[id] = l; }
  return out;
}
/** from 단계에서 fails번 실패한 뒤 확률 (천장이면 1) */
function chanceAt(from, fails) {
  const i = from - 1;
  const base = Number(CFG.chance?.[i] ?? 1), add = Number(CFG.pity?.[i] ?? 0), ceil = Number(CFG.ceiling?.[i] ?? 0);
  if (ceil > 0 && fails >= ceil) return 1;
  return r4(Math.min(1, base + add * fails));
}
const costAt = (from) => Math.max(0, Math.floor(Number(CFG.cost?.[from - 1] ?? 0)));
/** 다음 강화 성공 확률 0~1 (최고 단계면 0) */
export function chance(partId) {
  const s = load(), r = rec(s, partId);
  return r.lv >= MAX ? 0 : chanceAt(r.lv, r.fails);
}
/** 다음 강화 비용 (강화 조각, 최고 단계면 0) */
export function cost(partId) {
  const lv = partLevel(partId);
  return lv >= MAX ? 0 : costAt(lv);
}

/**
 * 강화 상태 (부품 카드·강화 창)
 *   { partId, name, lv, max, isMax, owned, stars, cost, chance, baseChance, pityAdd, fails, ceiling, failsLeft, tries,
 *     balance, canAfford, missing, canUpgrade, reason, next: { lv, pro, con } | null, factors: { pro, con }, last }
 */
export function state(partId) {
  const p = partOf(partId);
  const s = load(), r = rec(s, partId);
  const lv = p ? r.lv : 1, isMax = lv >= MAX;
  const i = lv - 1;
  const w = wallet();
  let balance = 0;
  try { balance = w ? Math.max(0, Number(w.balance(KIND)) || 0) : 0; } catch {}
  const c = isMax ? 0 : costAt(lv);
  const owned = !!p && isOwned(partId);
  const ceiling = isMax ? 0 : Number(CFG.ceiling?.[i] ?? 0);
  const out = {
    partId, name: p ? p.name : partId, lv, max: MAX, isMax, owned, stars: starsOf(lv),
    cost: c, chance: isMax ? 0 : chanceAt(lv, r.fails), baseChance: isMax ? 0 : Number(CFG.chance?.[i] ?? 1), pityAdd: isMax ? 0 : Number(CFG.pity?.[i] ?? 0),
    fails: r.fails, ceiling, failsLeft: ceiling > 0 ? Math.max(0, ceiling - r.fails) : 0, tries: r.tries,
    balance, canAfford: balance >= c, missing: Math.max(0, c - balance),
    canUpgrade: false, reason: '',
    next: isMax ? null : { lv: lv + 1, ...lvFactors(lv + 1) }, factors: lvFactors(lv), last: r.last,
  };
  if (!p) out.reason = '모르는 부품이에요';
  else if (!owned) out.reason = '아직 없는 부품이에요';
  else if (isMax) out.reason = `이미 최고 단계(★${MAX})예요`;
  else if (!w) out.reason = '◆ 강화 조각 지갑이 아직 없어요';
  else if (!out.canAfford) out.reason = `◆ ${out.missing} 강화 조각이 더 필요해요 · 완주·일일 목표에서 모아요`;
  else out.canUpgrade = true;
  return out;
}

/**
 * 강화 한 번. 확인 → 결과 굴림 → 조각 빼기(spend) → 단계·실패 수 저장 → 이벤트 'gimmick:partLv' → 결과
 *   성공 { ok:true, success:true, partId, from, to, lv, chance, cost, fails:0, tries, next }
 *   실패 { ok:true, success:false, partId, from, to:from, lv, chance, cost, fails, nextChance, tries, next }
 *   못 함 { ok:false, partId, message, missing? } (조각 안 빠짐)
 */
export function roll(partId) {
  const st = state(partId);
  if (!st.canUpgrade) return { ok: false, partId, message: st.reason, missing: st.missing || 0 };
  const w = wallet();
  const from = st.lv, c = st.cost, pChance = st.chance;
  const roll01 = (() => { try { const x = Number((rnd || Math.random)()); return Number.isFinite(x) ? x : 0; } catch { return 0; } })();
  const success = pChance >= 1 || roll01 < pChance; // 결과를 먼저 정함
  let paid;
  try { paid = w.spend(KIND, c, `강화 · ${st.name} ★${from}→★${from + 1}`); } catch { paid = false; }
  if (!paidOk(paid)) {
    const msg = (isObj(paid) && paid.message) || `◆ ${Math.max(1, c - st.balance)} 강화 조각이 더 필요해요 · 완주·일일 목표에서 모아요`;
    return { ok: false, partId, message: msg, missing: Math.max(0, c - st.balance) };
  }
  const s = load();
  const r = rec(s, partId);
  const to = success ? Math.min(MAX, from + 1) : from;
  const fails = success ? 0 : r.fails + 1;
  const tries = r.tries + 1;
  const last = { at: Date.now(), ok: success, from, to, chance: pChance, cost: c };
  s.parts[partId] = { lv: to, fails, tries, last };
  if (!save(s)) {
    try { w.refund && w.refund(KIND, c, `강화 저장 실패 · ${st.name} 돌려받음`); } catch {}
    return { ok: false, partId, message: '저장하지 못했어요 · 강화 조각은 돌려받았어요' };
  }
  const res = { ok: true, success, partId, name: st.name, from, to, lv: to, chance: pChance, cost: c, fails, tries };
  if (!success) res.nextChance = chanceAt(from, fails);
  res.next = state(partId);
  emit('gimmick:partLv', { partId, success, from, to, lv: to, chance: pChance, cost: c, fails });
  return res;
}

/**
 * 확률 표 ('확률 표 보기'): [{ from, to, cost, chance, pity, ceiling, chances: [시도마다 확률], avgTries, avgCost, worstCost }] + total { avgCost, worstCost }
 */
export function table() {
  const rows = [];
  for (let from = 1; from < MAX; from++) {
    const chances = [];
    let f = 0, p = chanceAt(from, 0);
    chances.push(p);
    while (p < 1 && f < 50) { f++; p = chanceAt(from, f); chances.push(p); }
    let reach = 1, avgTries = 0;
    for (const q of chances) { avgTries += reach; reach *= 1 - q; }
    const c = costAt(from);
    rows.push({ from, to: from + 1, cost: c, chance: chanceAt(from, 0), pity: Number(CFG.pity?.[from - 1] ?? 0), ceiling: Number(CFG.ceiling?.[from - 1] ?? 0), chances, avgTries: r4(avgTries), avgCost: Math.round(avgTries * c * 10) / 10, worstCost: chances.length * c });
  }
  return { rows, total: { avgCost: Math.round(rows.reduce((s, r) => s + r.avgCost, 0) * 10) / 10, worstCost: rows.reduce((s, r) => s + r.worstCost, 0) } };
}

/**
 * 강화 창 능력치 전/후: 그 부품만 끼운 조립의 buildStats (순정 대비)
 *   opts.from(기본 지금 단계)·opts.to(기본 다음 단계) → Promise<{ from, to }> (to는 최고 단계면 null)
 */
export async function preview(carId, partId, opts = {}) {
  const p = partOf(partId);
  if (!p) return null;
  const { buildStats } = await import('./carStats.js');
  const from = Math.max(1, Math.min(MAX, Math.floor(opts.from ?? partLevel(partId))));
  const to = opts.to ?? (from < MAX ? from + 1 : null);
  const build = { [p.slot]: partId };
  const a = await buildStats(carId, build, { levels: { [partId]: from } });
  const b = to ? await buildStats(carId, build, { levels: { [partId]: to } }) : null;
  return { from: a, to: b, fromLv: from, toLv: to };
}
