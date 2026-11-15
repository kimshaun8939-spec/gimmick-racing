// 부품 조립 뼈대 (2026-11-15, 부품 조립 1차 ①, 설계 .debug/design/parts-design.md, 약속 .debug/agents/parts-contract.md)
//   차 = 칸(엔진·변속기·타이어·날개·물 모듈) 조립체. 부품은 장단점만 있는 '옆으로 바꾸기' (data/parts.json)
//   - 얻는 건 모든 차 공용 (피트 조각 구매 = gimmick.meta owned['part:<id>'], 선물·업적·아카데미 = gimmick.partsExtra gifts)
//   - 끼우는 건 차마다: localStorage 'gimmick.parts' = { 차 id: { 칸: 부품 id } } (순정 칸은 안 적음)
//   - 프리셋·선물·알림: localStorage 'gimmick.partsExtra' = { v: 1, gifts: { 부품 id: { at, source } }, presets: { 차 id: [3칸] }, news: [] }
//   - 성능 적용: applyBuild(cfg, build) = 차 tune을 합친 '뒤' cfg에 비율로 (carRoster.loadCarConfig(id, { build })만 부름)
//     봇·아카데미·튜토리얼·친구 고스트는 build를 안 넘기므로 언제나 순정
//   - 구매는 meta.js(meta.buy('part', { id })). 이 파일은 meta.js를 불러오지 않음 (meta.js가 이 파일을 불러옴 → 순환 방지).
//     meta 저장 값은 localStorage에서 읽기만 함
//   Three.js 안 씀 → 홈·게임·Node 테스트 어디서나 가볍게
import { profile } from './profile.js';
import { academy, lessonMeta, licenseMeta, MEDAL_NAMES } from './academyStore.js';
import { ACHIEVEMENTS } from './metaCatalog.js';

export const STOCK = 'stock';
const BUILD_KEY = 'gimmick.parts';
const EXTRA_KEY = 'gimmick.partsExtra';
const META_KEY = 'gimmick.meta';
const TUT_KEY = 'gimmick.tutorial';
export const PRESET_COUNT = 3;

const EMPTY = { version: 1, limits: { default: 0.08, keys: {} }, blocked: [], defaults: {}, slots: [], parts: [], box: { perPart: 100, minLevel: 2 } };
let DATA = EMPTY;
try {
  const res = await fetch(new URL('../data/parts.json', import.meta.url), { cache: 'no-cache' });
  if (res.ok) DATA = { ...EMPTY, ...(await res.json()) };
} catch (e) {
  try { console.warn('parts.json 불러오기 실패 → 순정만', e); } catch {}
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const round6 = (v) => +(+v).toPrecision(12); // 작은 값(공기 저항 0.001)도 비율이 안 흔들리게 유효 숫자로
const emit = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {} };
function readJSON(key, fallback) {
  try { const j = JSON.parse(localStorage.getItem(key) || 'null'); return j == null ? fallback : j; } catch { return fallback; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
}

// ───────── 강화 단계 (작업 A, 2026-11-15, 약속 .debug/agents/upgrade-contract.md) ─────────
//   저장 'gimmick.partLv' = { v:1, parts: { 부품 id: { lv, fails, tries, last } } } — partUpgrade.js만 씀, 여기는 읽기만
//   단계는 부품마다 하나(모든 차 공용). Lv1 = 강화 전 값 그대로 (코드도 예전 그대로 지나감)
export const LV_KEY = 'gimmick.partLv';
const UPG = () => (isObj(DATA.upgrade) ? DATA.upgrade : null);
/** 최고 단계 (강화 자료가 없으면 1) */
export const maxLevel = () => Math.max(1, Math.floor(Number(UPG()?.max) || 1));
const clampLv = (v) => Math.max(1, Math.min(maxLevel(), Math.floor(Number(v)) || 1));
/** 별 글자 '★★★☆☆' */
export const starsOf = (lv) => { const m = maxLevel(), l = clampLv(lv); return '★'.repeat(l) + '☆'.repeat(m - l); };
let lvRaw, lvCache = {};
function lvStore() {
  try {
    const raw = localStorage.getItem(LV_KEY);
    if (raw !== lvRaw) { lvRaw = raw; const j = JSON.parse(raw || 'null'); lvCache = isObj(j) && isObj(j.parts) ? j.parts : {}; }
  } catch { lvCache = {}; }
  return lvCache;
}
/** 내 부품 단계 (없거나 모르는 부품·순정 = 1) */
export function partLevel(id) {
  if (!id || id === STOCK || !PART_BY_ID.has(id)) return 1;
  const r = lvStore()[id];
  return r ? clampLv(r.lv) : 1;
}
/** 내 단계 { 부품 id: lv } (Lv2 이상만) */
export function myLevels() {
  const out = {};
  for (const p of DATA.parts) { const l = partLevel(p.id); if (l > 1) out[p.id] = l; }
  return out;
}
/** 그 단계 배수 { pro, con } (Lv1 = 1, 1) */
export function lvFactors(lv) {
  const U = UPG(), i = clampLv(lv) - 1;
  return { pro: U && Array.isArray(U.pro) ? Number(U.pro[i] ?? 1) : 1, con: U && Array.isArray(U.con) ? Number(U.con[i] ?? 1) : 1 };
}
/** 강화 설정 복사본 (partUpgrade.js·검사용) */
export const upgradeConfig = () => clone(UPG());
/**
 * 단계를 어디서 읽나 → (부품 id) => lv
 *   opts.levels: 'mine' = 내 단계, { id: lv }, false = 모두 Lv1 / 없으면: 문자열 sig 안의 단계 → 조립 객체의 숨은 levels → Lv1
 */
function levelSource(build, opts) {
  const L = opts ? opts.levels : undefined;
  if (L === false) return () => 1;
  if (L === 'mine') return partLevel;
  if (isObj(L)) return (id) => (id in L ? clampLv(L[id]) : 1);
  if (typeof build === 'string') { const m = parseSigLevels(build); return (id) => m[id] || 1; }
  if (isObj(build) && isObj(build.levels)) { const m = build.levels; return (id) => (id in m ? clampLv(m[id]) : 1); }
  return () => 1;
}
/** 조립 객체에 숨은(열거 안 되는) levels를 붙임 → JSON·펼치기·Object.entries에는 안 보이고 partLook/buildSig/applyBuild는 읽음 */
function attachLevels(b, lvOf) {
  const m = {};
  for (const id of Object.values(b)) if (id && id !== STOCK && PART_BY_ID.has(id)) m[id] = lvOf(id);
  try { Object.defineProperty(b, 'levels', { value: m, enumerable: false, writable: true, configurable: true }); } catch {}
  return b;
}

// ───────── 칸·부품 목록 ─────────
const SLOT_BY_ID = new Map(DATA.slots.map((s) => [s.id, s]));
const PART_BY_ID = new Map(DATA.parts.map((p) => [p.id, p]));
/** 지금 쓰는 칸 (phase 1). 2차 칸은 부품이 생기면 저절로 나옴 */
const activeSlots = () => DATA.slots.filter((s) => s.phase === 1 || DATA.parts.some((p) => p.slot === s.id));

/** 칸 목록 [{ id, letter, name, icon, desc, camera, phase }] (opts.all = 2차 칸까지) */
export function listSlots(opts = {}) {
  return (opts.all ? DATA.slots : activeSlots()).map((s) => ({ ...s }));
}
export const slotOf = (id) => (SLOT_BY_ID.has(id) ? { ...SLOT_BY_ID.get(id) } : null);
/** parts.json의 부품 원본 (복사본). 'stock'이나 모르는 id면 null */
export const partOf = (id) => (PART_BY_ID.has(id) ? clone(PART_BY_ID.get(id)) : null);
/** 순정 카드 (칸마다) */
export function stockPart(slot) {
  const s = SLOT_BY_ID.get(slot);
  return { id: STOCK, slot, no: 0, name: '순정', short: '순정', desc: '그 차 원래 성격 그대로', pros: ['그 차 원래 성격'], cons: [], shines: { maps: [], text: [] }, level: 0, price: 0, icon: s ? s.icon : '⚙️', look: null, stock: true };
}

// ───────── 소유·해금 ─────────
let metaRaw = null, metaCache = {};
function metaState() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw !== metaRaw) { metaRaw = raw; metaCache = JSON.parse(raw || '{}') || {}; }
  } catch { metaCache = {}; }
  return metaCache;
}
function extra() {
  const j = readJSON(EXTRA_KEY, null);
  const e = isObj(j) ? j : {};
  return { v: 1, gifts: isObj(e.gifts) ? e.gifts : {}, presets: isObj(e.presets) ? e.presets : {}, news: Array.isArray(e.news) ? e.news : [] };
}
const saveExtra = (e) => writeJSON(EXTRA_KEY, e);
function level(lv) {
  if (Number.isFinite(lv)) return lv;
  try { return profile.get().level || 1; } catch { return 1; }
}

/** 다른 길(업적·아카데미·라이선스·튜토리얼)을 채웠나 */
function altDone(p) {
  const a = p && p.alt;
  if (!a) return false;
  try {
    if (a.type === 'tutorial') return localStorage.getItem(TUT_KEY) === 'done';
    if (a.type === 'achievement') return !!(metaState().achievements || {})[a.id];
    if (a.type === 'academy') return academy.medalOf(a.id) >= (a.medal || 1);
    if (a.type === 'license') return academy.licenses().includes(a.id);
  } catch {}
  return false;
}
/** 다른 길 안내 글 ('업적 「파도 위의 레이서 I」' 등) */
export function altText(p) {
  const a = p && p.alt;
  if (!a) return '';
  if (a.type === 'tutorial') return '입문 튜토리얼을 끝내면 선물';
  if (a.type === 'achievement') { const ach = ACHIEVEMENTS.find((x) => x.id === a.id); return `업적 「${ach ? ach.name : a.id}」 달성`; }
  if (a.type === 'academy') { const l = lessonMeta(a.id); return `아카데미 「${l ? l.name : a.id}」 ${MEDAL_NAMES[a.medal || 1] || ''}`.trim(); }
  if (a.type === 'license') { const l = licenseMeta(a.id); return `${l ? l.name : a.id + ' 라이선스'} 따기`; }
  return '';
}
const bought = (id) => !!(metaState().owned || {})['part:' + id];

/** 이 부품을 가졌나 (구매·선물·업적/아카데미 조건). 순정은 언제나 true */
export function isOwned(id) {
  if (id === STOCK) return true;
  const p = PART_BY_ID.get(id);
  if (!p) return false;
  return bought(id) || !!extra().gifts[id] || altDone(p);
}
/**
 * 부품 상태 { id, owned, levelOk, canBuy, locked, lockReason, altText, altDone, level, price, source }
 *   canBuy = 아직 없고 레벨이 됨 (조각은 따로: meta.shop의 canAfford), locked = 아직 없고 레벨도 안 됨
 *   opts.level: 테스트용 레벨
 */
export function partState(id, opts = {}) {
  if (id === STOCK) return { id, owned: true, levelOk: true, canBuy: false, locked: false, lockReason: '', altText: '', altDone: false, level: 0, price: 0, source: 'stock' };
  const p = PART_BY_ID.get(id);
  if (!p) return null;
  const lv = level(opts.level);
  const gift = extra().gifts[id];
  const ad = altDone(p);
  const owned = bought(id) || !!gift || ad;
  const levelOk = lv >= (p.level || 0);
  const alt = altText(p);
  const source = bought(id) ? 'buy' : gift ? gift.source || 'gift' : ad ? p.alt.type : null;
  let lockReason = '';
  if (!owned && !levelOk) lockReason = `Lv.${p.level}부터 피트 조각으로 살 수 있어요` + (alt ? ` · 또는 ${alt}` : '');
  return { id, owned, levelOk, canBuy: !owned && levelOk, locked: !owned && !levelOk, lockReason, altText: alt, altDone: ad, level: p.level || 0, price: p.price || 0, source };
}
/** 가진 부품 id 목록 (순정 제외) */
export function ownedParts() {
  syncGrants();
  return DATA.parts.filter((p) => isOwned(p.id)).map((p) => p.id);
}

/**
 * 부품 목록 (화면용). slot을 주면 그 칸만, opts.stock = 칸마다 순정 카드를 앞에, opts.carId = equipped 표시
 *   항목 = parts.json 부품 + partState + { slotName, slotIcon, equipped }
 */
export function listParts(slot, opts = {}) {
  syncGrants();
  const slots = slot ? [slot] : activeSlots().map((s) => s.id);
  const cur = opts.carId ? getBuild(opts.carId) : null;
  const out = [];
  for (const sid of slots) {
    const s = SLOT_BY_ID.get(sid);
    if (!s) continue;
    const rows = DATA.parts.filter((p) => p.slot === sid).sort((a, b) => a.no - b.no);
    if (opts.stock) out.push({ ...stockPart(sid), ...partState(STOCK), slotName: s.name, slotIcon: s.icon, equipped: cur ? cur[sid] === STOCK : false });
    for (const p of rows) out.push({ ...clone(p), ...partState(p.id, opts), slotName: s.name, slotIcon: s.icon, icon: p.icon || s.icon, equipped: cur ? cur[sid] === p.id : false });
  }
  return out;
}

/**
 * 다른 길로 채운 부품을 선물로 저장 (한 번 받으면 계속 내 것) + 알림 목록에 넣음. 새로 받은 부품 id 목록을 돌려줌
 *   (조건이 사라져도 안 뺏기게 남겨 둠. 사는 건 meta.buy)
 */
export function syncGrants() {
  const e = extra();
  const got = [];
  for (const p of DATA.parts) {
    if (e.gifts[p.id] || bought(p.id) || !altDone(p)) continue;
    e.gifts[p.id] = { at: Date.now(), source: p.alt.type };
    e.news.push({ partId: p.id, source: p.alt.type, at: Date.now() });
    got.push(p.id);
  }
  if (got.length) {
    e.news = e.news.slice(-12);
    saveExtra(e);
    emit('gimmick:parts', { granted: got });
  }
  return got;
}
/** 아직 안 보여 준 '부품 받음' 알림 [{ partId, name, slot, source, text }] → 가져가면 비움 (레벨 업 알림·차고 배지용) */
export function takeNews() {
  syncGrants();
  const e = extra();
  if (!e.news.length) return [];
  const list = e.news.map((n) => {
    const p = PART_BY_ID.get(n.partId);
    if (!p) return null;
    const why = n.source === 'tutorial' ? '입문 튜토리얼 완료 선물' : altText(p);
    return { partId: p.id, name: p.name, slot: p.slot, source: n.source, at: n.at, text: `🔧 새 부품: ${p.name} — ${why}` };
  }).filter(Boolean);
  e.news = [];
  saveExtra(e);
  return list;
}
/** from < 레벨 ≤ to 사이에 '살 수 있음'이 되는 부품 [{ id, name, slot, level, price }] (레벨 업 알림) */
export function partsBetween(from, to) {
  return DATA.parts.filter((p) => p.level > from && p.level <= to).sort((a, b) => a.level - b.level || a.no - b.no).map((p) => ({ id: p.id, name: p.name, slot: p.slot, level: p.level, price: p.price }));
}
/** 이 레벨 다음에 열리는 부품 (없으면 null) { level, parts: [{ id, name, slot, price }] } (드라이버 카드 '다음 부품까지') */
export function nextPart(lv) {
  const L = level(lv);
  const next = DATA.parts.map((p) => p.level).filter((v) => v > L).sort((a, b) => a - b)[0];
  if (!next) return null;
  return { level: next, parts: partsBetween(next - 1, next) };
}
/** 부품 상자에 들어갈 개수: 이미 레벨이 된 부품 (box.minLevel 이상) */
export function boxCount(lv) {
  const L = level(lv);
  const min = DATA.box?.minLevel ?? 2;
  return DATA.parts.filter((p) => p.level >= min && p.level <= L).length;
}
export const boxPerPart = () => DATA.box?.perPart ?? 100;

// ───────── 조립 (build) ─────────
/** 조립을 정리: 칸마다 부품 id (모르는 칸·다른 칸 부품은 'stock'). 객체·buildSig 문자열·null 모두 받음 */
export function normBuild(build) {
  if (typeof build === 'string') build = parseSig(build);
  const out = {};
  for (const s of activeSlots()) {
    const id = isObj(build) ? build[s.id] : null;
    const p = id && PART_BY_ID.get(id);
    out[s.id] = p && p.slot === s.id ? id : STOCK;
  }
  return out;
}
/** 가진 부품만 남김 (없는 건 순정) — 친구 고스트의 '이 조립 따라 하기' 등 */
export function fitBuild(build) {
  const b = normBuild(build);
  for (const k of Object.keys(b)) if (!isOwned(b[k])) b[k] = STOCK;
  return b;
}
/** 이 차에 지금 끼운 조립 (가진 부품만) { engine, gearbox, tire, aero, water } */
export function getBuild(carId) {
  const all = readJSON(BUILD_KEY, {});
  return attachLevels(fitBuild(isObj(all) ? all[carId] : null), partLevel); // 숨은 levels = 내 강화 단계
}
function saveBuild(carId, b) {
  const all = readJSON(BUILD_KEY, {});
  const store = isObj(all) ? all : {};
  const slim = {};
  for (const [k, v] of Object.entries(normBuild(b))) if (v !== STOCK) slim[k] = v;
  if (Object.keys(slim).length) store[carId] = slim;
  else delete store[carId];
  const ok = writeJSON(BUILD_KEY, store);
  const build = attachLevels(normBuild(b), partLevel);
  emit('gimmick:parts', { carId, build, sig: buildSig(build) });
  return ok;
}
/** 한 칸 바꾸기 → { ok, build, sig, message } (가진 부품만) */
export function setPart(carId, slot, partId = STOCK) {
  if (!carId) return { ok: false, message: '차를 먼저 골라 주세요' };
  const s = SLOT_BY_ID.get(slot);
  if (!s || !activeSlots().includes(s)) return { ok: false, message: '없는 칸이에요' };
  const p = partId === STOCK ? null : PART_BY_ID.get(partId);
  if (partId !== STOCK && (!p || p.slot !== slot)) return { ok: false, message: '이 칸에 맞지 않는 부품이에요' };
  if (!isOwned(partId)) return { ok: false, message: partState(partId)?.lockReason || '아직 없는 부품이에요' };
  const b = getBuild(carId);
  b[slot] = partId;
  attachLevels(b, partLevel);
  if (!saveBuild(carId, b)) return { ok: false, message: '저장하지 못했어요' };
  return { ok: true, build: b, sig: buildSig(b) };
}
/** 조립 통째로 바꾸기 (없는 부품은 순정으로) → { ok, build, sig } */
export function setBuild(carId, build) {
  if (!carId) return { ok: false, message: '차를 먼저 골라 주세요' };
  const b = attachLevels(fitBuild(build), partLevel);
  if (!saveBuild(carId, b)) return { ok: false, message: '저장하지 못했어요' };
  return { ok: true, build: b, sig: buildSig(b) };
}
export const resetBuild = (carId) => setBuild(carId, null);

/**
 * 조립 표시 문자열: 순정이 아닌 칸만 '글자+번호(+단계)'를 칸 순서대로 '.'로 이음, 모두 순정이면 'stock'
 *   단계는 Lv2 이상만 숫자 하나 (예 'g15.t23' = 가속 기어 Lv5·험한 길 Lv3, Lv1만이면 예전 'g1.t2'와 똑같음)
 *   단계는 opts.levels('mine' | { id: lv } | false) → 문자열 sig 안 → 조립 객체의 숨은 levels → Lv1 (upgrade-contract.md)
 *   서버·records·ghost·online 검사식 ^[a-z][0-9]{1,2}(\.[a-z][0-9]{1,2}){0,9}$ 그대로 통과 (부품 번호는 1~9)
 */
export function buildSig(build, opts) {
  const lvOf = levelSource(build, opts);
  const b = normBuild(build);
  const bits = [];
  for (const s of DATA.slots) {
    const id = b[s.id];
    if (!id || id === STOCK) continue;
    const p = PART_BY_ID.get(id);
    if (!p) continue;
    const lv = p.no < 10 ? lvOf(p.id) : 1;
    bits.push(s.letter + p.no + (lv > 1 ? String(lv) : ''));
  }
  return bits.length ? bits.join('.') : STOCK;
}
/** 단계 없이 부품만 ('g15.t23' → 'g1.t2') — 같은 조립인지 비교할 때 */
export const partsSig = (build) => buildSig(build, { levels: false });
/** sig 한 조각 'g15' → { slot, part, lv } | null (한 자리 = 부품 번호, 두 자리 = 부품 번호 + 단계) */
function parseBit(bit) {
  const m = /^([a-z])(\d)(\d?)$/.exec(String(bit).trim());
  if (!m) return null;
  const s = DATA.slots.find((x) => x.letter === m[1]);
  const p = s && DATA.parts.find((x) => x.slot === s.id && x.no === Number(m[2]));
  return p ? { slot: s.id, part: p.id, lv: m[3] ? clampLv(m[3]) : 1 } : null;
}
/** 'g1.t2' / 'g15.t23' → { gearbox: 'gear_short', tire: 'tire_allterrain', 나머지: 'stock' } (단계는 버림, 모르는 조각은 무시) */
export function parseSig(sig) {
  const out = {};
  for (const s of activeSlots()) out[s.id] = STOCK;
  if (typeof sig !== 'string' || !sig || sig === STOCK) return out;
  for (const bit of sig.split('.')) {
    const r = parseBit(bit);
    if (r && r.slot in out) out[r.slot] = r.part;
  }
  return out;
}
/** sig 안의 단계 { 부품 id: lv } (예전 'g1.t2' = 모두 1) */
export function parseSigLevels(sig) {
  const out = {};
  if (typeof sig !== 'string' || !sig || sig === STOCK) return out;
  const act = new Set(activeSlots().map((s) => s.id));
  for (const bit of sig.split('.')) {
    const r = parseBit(bit);
    if (r && act.has(r.slot)) out[r.part] = r.lv;
  }
  return out;
}
/** sig → { build (숨은 levels 붙음), levels } */
export function parseSigFull(sig) {
  const levels = parseSigLevels(sig);
  return { build: attachLevels(parseSig(sig), (id) => levels[id] || 1), levels };
}
export const isStock = (build) => buildSig(build) === STOCK;
/** 조립 칩 [{ slot, letter, icon, partId, no, name, short, lv, stars }] (순정 칸은 뺌) — 결과 화면·순위표·고스트 이름표 */
export function buildChips(build, opts) {
  const lvOf = levelSource(build, opts);
  const b = normBuild(build);
  return DATA.slots.filter((s) => b[s.id] && b[s.id] !== STOCK).map((s) => {
    const p = PART_BY_ID.get(b[s.id]);
    const lv = lvOf(p.id);
    return { slot: s.id, letter: s.letter, icon: s.icon, partId: p.id, no: p.no, name: p.name, short: p.short || p.name, lv, stars: starsOf(lv) };
  });
}
/** 사람이 읽는 요약 ('가속 기어 · 찰떡 타이어' / '순정'), opts.short = 짧은 이름, opts.stars = Lv2 이상이면 ' ★n' */
export function buildSummary(build, opts = {}) {
  const chips = buildChips(build, opts);
  return chips.length ? chips.map((c) => (opts.short ? c.short : c.name) + (opts.stars && c.lv > 1 ? ' ★' + c.lv : '')).join(' · ') : '순정';
}
/** 모양 힌트 { 칸: { ...look, partId, no, lv } | null } (④ 부품 모양·⑤ 고스트 모습, lv = 강화 단계 재질용) */
export function partLook(build, opts) {
  const lvOf = levelSource(build, opts);
  const b = normBuild(build);
  const out = {};
  for (const [slot, id] of Object.entries(b)) {
    const p = id !== STOCK && PART_BY_ID.get(id);
    out[slot] = p ? { ...(clone(p.look) || {}), partId: p.id, no: p.no, lv: lvOf(p.id) } : null;
  }
  return out;
}

// ───────── 프리셋 (차마다 3칸) ─────────
/** [{ name, build, sig, at } | null] × 3 (가진 부품만으로 보여 줌) */
export function listPresets(carId) {
  const row = extra().presets[carId];
  return Array.from({ length: PRESET_COUNT }, (_, i) => {
    const p = Array.isArray(row) ? row[i] : null;
    if (!p || !p.build) return null;
    const build = attachLevels(fitBuild(p.build), partLevel);
    return { name: p.name || `프리셋 ${i + 1}`, build, sig: buildSig(build), at: p.at || 0 };
  });
}
/** 지금 조립(또는 build)을 i번 칸에 저장 */
export function savePreset(carId, i, name, build) {
  if (!carId || !(i >= 0 && i < PRESET_COUNT)) return false;
  const e = extra();
  const row = Array.isArray(e.presets[carId]) ? e.presets[carId] : [];
  const b = normBuild(build || getBuild(carId));
  row[i] = { name: String(name || `프리셋 ${i + 1}`).slice(0, 24), build: b, at: Date.now() };
  e.presets[carId] = row.slice(0, PRESET_COUNT);
  return saveExtra(e);
}
/** i번 프리셋을 이 차에 끼움 → setBuild 결과 */
export function usePreset(carId, i) {
  const p = listPresets(carId)[i];
  return p ? setBuild(carId, p.build) : { ok: false, message: '빈 프리셋이에요' };
}
export function clearPreset(carId, i) {
  const e = extra();
  if (!Array.isArray(e.presets[carId])) return false;
  e.presets[carId][i] = null;
  return saveExtra(e);
}

/** 부품 사기 (meta.buy('part')와 같음, meta.js를 나중에 불러와서 순환을 피함) → Promise<{ ok, price?, owned?, message? }> */
export async function buyPart(id) {
  const { meta } = await import('./meta.js');
  return meta.buy('part', { id });
}

// ───────── 성능 적용 ─────────
function getPath(o, path) {
  let cur = o;
  for (const k of path.split('.')) {
    if (!isObj(cur) || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}
function setPath(o, path, v) {
  const ks = path.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[ks[ks.length - 1]] = v;
}
const isBlocked = (path) => (DATA.blocked || []).some((b) => path === b || path.startsWith(b + '.'));
/** 강화 전(Lv1) 키 한계: 정확한 키 → 가장 긴 'x.*' → null(= 기본 ±default) */
function keyLimit(path) {
  const keys = DATA.limits?.keys || {};
  if (keys[path]) return keys[path];
  let best = null, len = -1;
  for (const [k, v] of Object.entries(keys)) {
    if (!k.endsWith('.*')) continue;
    const pre = k.slice(0, -1);
    if (path.startsWith(pre) && pre.length > len) { best = v; len = pre.length; }
  }
  return best;
}
/**
 * 키 한계 { ratio: [lo, hi], abs?: [min, max] } — 정확한 키 → 가장 긴 'x.*' → 기본 ±default
 *   lv (강화, 기본 1): 그 키를 건드리는 부품 중 가장 높은 단계. 기본 키는 upgrade.capDefault[lv−1], 성격 키 ratio 폭은 × upgrade.capWiden[lv−1], abs는 그대로
 */
export function limitFor(path, lv = 1) {
  const L0 = keyLimit(path);
  const U = UPG(), l = clampLv(lv);
  if (l <= 1 || !U) {
    if (L0) return L0;
    const d = DATA.limits?.default ?? 0.08;
    return { ratio: [1 - d, 1 + d] };
  }
  if (!L0) {
    const d = Number(U.capDefault?.[l - 1] ?? DATA.limits?.default ?? 0.08);
    return { ratio: [1 - d, 1 + d] };
  }
  const w = Number(U.capWiden?.[l - 1] ?? 1);
  const [lo, hi] = L0.ratio || [1, 1];
  return { ...L0, ratio: [round6(Math.max(0, 1 - (1 - lo) * w)), round6(1 + (hi - 1) * w)] };
}
function clipNum(path, base, v, lv = 1) {
  if (!Number.isFinite(v)) return base;
  const L = limitFor(path, lv);
  const [lo, hi] = L.ratio || [1, 1];
  let out = v;
  if (base > 0) out = Math.min(base * hi, Math.max(base * lo, out));
  else if (base < 0) out = Math.min(base * lo, Math.max(base * hi, out));
  else if (!L.abs) out = 0; // 순정이 0이면 abs 한계가 있는 키만 바꿀 수 있음
  if (L.abs) out = Math.min(Math.max(L.abs[1], base), Math.max(Math.min(L.abs[0], base), out)); // abs는 순정 값보다 더 끌어당기지 않음
  return round6(out);
}
/** 키 하나에 모인 조작(mul/add/set)을 순서대로 */
function computeValue(base, ops) {
  const one = (b, i) => {
    let v = b;
    for (const op of ops) {
      if (op.t === 'mul') v *= Array.isArray(op.v) ? (op.v[i] ?? 1) : op.v;
      else if (op.t === 'add') v += Array.isArray(op.v) ? (op.v[i] ?? 0) : op.v;
    }
    for (const op of ops) if (op.t === 'set') v = Array.isArray(op.v) ? (op.v[i] ?? v) : op.v;
    return v;
  };
  if (Array.isArray(base)) return base.map((b, i) => (typeof b === 'number' ? one(b, i) : b));
  return typeof base === 'number' ? one(base, 0) : ops.filter((o) => o.t === 'set').reduce((v, o) => o.v, base);
}

/** 강화: 키의 '좋은 방향' (+1 클수록 좋음, −1 작을수록 좋음, 0 성격) — 정확한 키 → 가장 긴 'x.*' → 0 */
export function dirOf(path) {
  const D = UPG()?.dir || {};
  if (path in D) return Number(D[path]) || 0;
  let best = 0, len = -1;
  for (const [k, v] of Object.entries(D)) {
    if (!k.endsWith('.*')) continue;
    const pre = k.slice(0, -1);
    if (path.startsWith(pre) && pre.length > len) { best = Number(v) || 0; len = pre.length; }
  }
  return best;
}
/**
 * 강화: 부품 값 하나를 그 단계로 (편차 × 배수). set·소리(dir 0)는 그대로
 *   역할 = 부품 up.roles[키] (pro/con/keep) → 없으면 dir과 편차 부호 (같으면 장점 pro, 반대면 단점 con)
 *   keepPro 키(기어비)는 장점이어도 안 키움
 */
function scaleOp(p, t, key, v, F) {
  if (t === 'set') return v;
  const U = UPG() || {};
  const forced = p.up && isObj(p.up.roles) ? p.up.roles[key] : undefined;
  const dir = dirOf(key);
  const keepPro = Array.isArray(U.keepPro) && U.keepPro.includes(key);
  const one = (x) => {
    if (typeof x !== 'number') return x;
    const dev = t === 'mul' ? x - 1 : x;
    if (!dev) return x;
    const role = forced || (!dir ? 'keep' : Math.sign(dev) === Math.sign(dir) ? 'pro' : 'con');
    const k = role === 'pro' ? (keepPro ? 1 : F.pro) : role === 'con' ? F.con : 1;
    if (k === 1) return x;
    return t === 'mul' ? round6(1 + dev * k) : round6(dev * k);
  };
  return Array.isArray(v) ? v.map(one) : one(v);
}

/**
 * 차 cfg(car.json + 차 tune을 합친 것)에 조립을 적용한 새 cfg (원본은 안 바뀜)
 *   build: { 칸: 부품 id } | buildSig 문자열('g15.t23'처럼 단계 포함 가능) | null (= 순정, 값은 그대로)
 *   opts.levels: 'mine' | { 부품 id: lv } | false — 없으면 문자열 sig 안 단계 → 조립 객체의 숨은 levels → Lv1 (upgrade-contract.md)
 *   결과 cfg.partsInfo = { build(숨은 levels), sig(단계 포함), partsSig(부품만), levels: { id: lv }, maxLv, parts: [id], applied: [{ path, from, to }], clipped, skipped, blocked, tilt, turbo }
 *   가진 부품인지는 여기서 안 봄 (그건 getBuild/fitBuild). 차 tune 값에 대한 비율이라 차 개성은 그대로
 *   Lv1 부품은 강화 전 계산 그대로 (같은 숫자)
 */
export function applyBuild(cfg, build, opts) {
  const lvOf = levelSource(build, opts);
  const b = normBuild(build);
  const out = clone(cfg);
  const parts = Object.values(b).filter((id) => id !== STOCK).map((id) => PART_BY_ID.get(id)).filter(Boolean);
  const levels = {};
  for (const p of parts) levels[p.id] = UPG() ? lvOf(p.id) : 1;
  attachLevels(b, (id) => levels[id] || 1);
  const maxLv = parts.reduce((m, p) => Math.max(m, levels[p.id]), 1);
  const info = { build: b, sig: buildSig(b, { levels }), partsSig: buildSig(b, { levels: false }), levels, maxLv, parts: parts.map((p) => p.id), applied: [], clipped: [], skipped: [], blocked: [], tilt: 0, turbo: null };
  const ops = new Map();
  const push = (path, t, v, lv) => { if (!ops.has(path)) ops.set(path, { lv: 1, list: [] }); const o = ops.get(path); o.list.push({ t, v }); o.lv = Math.max(o.lv, lv); };
  for (const p of parts) {
    const L = levels[p.id];
    const F = L > 1 ? lvFactors(L) : null;
    for (const t of ['mul', 'add', 'set']) for (const [k, v] of Object.entries(p[t] || {})) if (!k.startsWith('_')) push(k, t, F ? scaleOp(p, t, k, v, F) : v, L);
    // 단계 보너스 (up.bonus.mul: 단계마다 +배수, 예 가속 기어 힘 +0.5%/단계) — Lv1엔 없음
    if (L > 1 && p.up && isObj(p.up.bonus)) {
      for (const [k, per] of Object.entries(p.up.bonus.mul || {})) if (!k.startsWith('_') && Number(per)) push(k, 'mul', round6(1 + Number(per) * (L - 1)), L);
      for (const [k, per] of Object.entries(p.up.bonus.add || {})) if (!k.startsWith('_') && Number(per)) push(k, 'add', round6(Number(per) * (L - 1)), L);
    }
  }
  for (const [path, { list, lv }] of ops) {
    if (isBlocked(path)) { info.blocked.push(path); continue; }
    let base = getPath(out, path);
    if (base === undefined) base = getPath(DATA.defaults || {}, path);
    if (base === undefined || base === null) { info.skipped.push(path); continue; }
    const raw = computeValue(base, list);
    let val;
    if (Array.isArray(base)) val = raw.map((v, i) => (typeof base[i] === 'number' ? clipNum(path, base[i], v, lv) : v));
    else if (typeof base === 'number') val = clipNum(path, base, raw, lv);
    else val = raw;
    const rawCmp = JSON.stringify(Array.isArray(raw) ? raw.map((x) => (typeof x === 'number' ? round6(x) : x)) : typeof raw === 'number' ? round6(raw) : raw);
    if (rawCmp !== JSON.stringify(val)) info.clipped.push(path);
    setPath(out, path, val);
    info.applied.push({ path, from: clone(base), to: clone(val) });
  }
  // 특수 계산 1: 토크 표 기울이기 — 값 × (1 + k·(rpm/redline − pivot)), 표 모양(행 수·rpm)은 그대로
  //   강화: 괄호 안 항이 +인 회전 구간은 장점(×pro), −인 구간은 단점(×con), 한계 torqueTilt × capWiden
  const tiltMax = DATA.limits?.torqueTilt ?? 0.3;
  const pivot = DATA.limits?.tiltPivot ?? 0.6;
  const tilters = parts.filter((p) => Number(p.fx?.torqueTilt));
  const k = Math.max(-tiltMax, Math.min(tiltMax, parts.reduce((s, p) => s + (Number(p.fx?.torqueTilt) || 0), 0)));
  if (k && out.engine && Array.isArray(out.engine.torque) && out.engine.redline > 0) {
    const red = out.engine.redline;
    const tiltLv = tilters.reduce((m, p) => Math.max(m, levels[p.id]), 1);
    if (tiltLv <= 1) {
      out.engine.torque = out.engine.torque.map(([rpm, val]) => [rpm, round6(val * (1 + k * (rpm / red - pivot)))]);
    } else {
      const cap = tiltMax * Number(UPG()?.capWiden?.[tiltLv - 1] ?? 1);
      out.engine.torque = out.engine.torque.map(([rpm, val]) => {
        const x = rpm / red - pivot;
        let term = 0;
        for (const p of tilters) {
          const raw = Number(p.fx.torqueTilt) * x;
          const F = lvFactors(levels[p.id]);
          term += raw * (raw > 0 ? F.pro : F.con);
        }
        term = Math.max(-cap * Math.abs(x), Math.min(cap * Math.abs(x), term));
        return [rpm, round6(val * (1 + term))];
      });
    }
    info.tilt = k;
  }
  // 특수 계산 2: 터보 — 없는 차엔 넣고, 있는 차엔 share·lag를 곱함 (max 한계)
  //   강화: lag(랙)는 단점 → 편차 × con (max.lag도 × con, 있던 차는 순정 랙 아래로 안 내려감), share는 성격(그대로)
  const tp = parts.find((p) => p.fx && p.fx.turbo);
  if (tp && out.engine) {
    const T = tp.fx.turbo, mx = T.max || {};
    const L = levels[tp.id] || 1;
    const cap = (key, v) => round6(Math.min(mx[key] ?? Infinity, v));
    const had = isObj(out.engine.turbo);
    if (L <= 1) {
      out.engine.turbo = had
        ? { ...out.engine.turbo, share: cap('share', out.engine.turbo.share * (T.haveMul?.share ?? 1)), lag: cap('lag', out.engine.turbo.lag * (T.haveMul?.lag ?? 1)) }
        : { share: cap('share', T.share), lag: cap('lag', T.lag) };
    } else {
      const C = lvFactors(L).con;
      const maxLag = (mx.lag ?? Infinity) * C;
      if (had) {
        const b0 = out.engine.turbo.lag;
        out.engine.turbo = { ...out.engine.turbo, share: cap('share', out.engine.turbo.share * (T.haveMul?.share ?? 1)), lag: round6(Math.min(Math.max(b0, maxLag), b0 * (1 + ((T.haveMul?.lag ?? 1) - 1) * C))) };
      } else out.engine.turbo = { share: cap('share', T.share), lag: round6(Math.min(maxLag, T.lag * C)) };
    }
    info.turbo = { had, ...out.engine.turbo };
  }
  out.partsInfo = info;
  return out;
}

/** 내부 자료 (테스트·균형 도구용) */
export const partsData = () => clone(DATA);

// 업적·아카데미가 바뀌면 다른 길 선물을 바로 확인
if (typeof window !== 'undefined' && window.addEventListener && !window.__gimmickPartsHooked) {
  window.__gimmickPartsHooked = true;
  const later = () => setTimeout(() => { try { syncGrants(); } catch {} }, 0);
  window.addEventListener('gimmick:meta', later);
  window.addEventListener('gimmick:academy', later);
}
