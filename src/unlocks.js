// 잠금·해금: 레벨이 오르면 새 차와 새 색(페인트)이 열림 (2026-11-10, 사용자 요청 "레벨 올리면 해금되는 시스템")
//   - 차: data/cars.json의 차마다 `unlockLevel` (없거나 0 = 처음부터 열림). 예전 15대는 모두 열려 있음
//   - 색: 아래 PAINTS (0 = 원래 색). 고른 색은 localStorage `gimmick.paint` { 차 id: 색 id }
//   - 레벨은 profile.js (완주하면 XP). 잠금은 홈 화면 차 고르기에서만 막음 (게임 주소 ?car= 는 안 막음, 봇은 잠긴 차도 탐)
//   약속(다른 파일이 쓰는 이름): isCarUnlocked(carId) → true/false, carUnlockLevel(carId) → 필요한 레벨 (없으면 0)
// 재화 개편 (upgradeB, 2026-11-15, .debug/agents/wallet-contract.md): 차 = 시작 5대 + 레벨이 되면 피트 조각으로 삼 (metaCatalog CAR_SHOP),
//   색 = 원래·빨강·파랑 무료 + 레벨이 되면 커스텀 조각으로 삼. 가진 것 = gimmick.meta owned (meta.js가 씀, 여기는 읽기만 → meta.js를 안 불러옴)
//   gimmick.meta에 wv:2가 아직 없으면(옮기기 전) 예전 규칙으로 판단 → 옮긴 뒤와 결과가 같음
import { profile } from './profile.js';
import { listCostumes } from './carCostumes.js';
import { academy, licenseMeta } from './academyStore.js'; // 드라이빙 아카데미 라이선스 색 (2026-11-12)
import { START_CARS, CAR_SHOP, carShopPrice } from './metaCatalog.js';

const PAINT_KEY = 'gimmick.paint';
const SEEN_KEY = 'gimmick.seenLevel';

/** 색 묶음. level = 열리는 레벨 (0 = 처음부터). nb/nf = 번호판 바탕/글자 */
export const PAINTS = [
  { id: 0, name: '원래 색', level: 0 },
  { id: 1, name: '불꽃 빨강', level: 0, body: '#d92b2b', accent: '#f5f5f5', trim: '#1a1a1e', nb: '#f5f5f5', nf: '#d92b2b' },
  { id: 2, name: '바다 파랑', level: 0, body: '#1f6fe0', accent: '#f2f6ff', trim: '#ffd23a', nb: '#f2f6ff', nf: '#1f6fe0' },
  { id: 3, name: '숲 초록', level: 2, body: '#1f9d55', accent: '#f4f1e0', trim: '#16181d', nb: '#f4f1e0', nf: '#1f9d55' },
  { id: 4, name: '햇살 노랑', level: 3, body: '#ffc81f', accent: '#18191c', trim: '#e8463a', nb: '#18191c', nf: '#ffc81f' },
  { id: 5, name: '눈꽃 하양', level: 5, body: '#f4f6f8', accent: '#e8463a', trim: '#1b6dff', nb: '#e8463a', nf: '#ffffff' },
  { id: 6, name: '한밤 검정', level: 7, body: '#15171c', accent: '#ff3b5c', trim: '#8a8f99', nb: '#ff3b5c', nf: '#15171c' },
  { id: 7, name: '솜사탕 분홍', level: 9, body: '#ff7ab8', accent: '#ffffff', trim: '#6fd6ff', nb: '#ffffff', nf: '#ff4f9a' },
  { id: 8, name: '네온 라임', level: 12, body: '#b6ff2e', accent: '#14161b', trim: '#a04bff', nb: '#14161b', nf: '#b6ff2e' },
  { id: 9, name: '황금', level: 15, body: '#e8b931', accent: '#15161a', trim: '#ffffff', nb: '#15161a', nf: '#e8b931' },
  { id: 10, name: '은하 보라', level: 18, body: '#6a35d9', accent: '#35e0ff', trim: '#ffb21a', nb: '#35e0ff', nf: '#2a1466' },
  // 라이선스 색 (드라이빙 아카데미 시험에 붙으면 열림, 레벨과 상관없음). license = 'C' | 'B' | 'A' | 'S'
  { id: 11, name: '아카데미 하늘', level: 0, license: 'C', body: '#3fb4ff', accent: '#0d1830', trim: '#ffffff', nb: '#0d1830', nf: '#7fd1ff' },
  { id: 12, name: '서킷 민트', level: 0, license: 'B', body: '#20d39a', accent: '#0f1a17', trim: '#f4f8f6', nb: '#0f1a17', nf: '#7dff9a' },
  { id: 13, name: '레이스 오렌지', level: 0, license: 'A', body: '#ff8a1f', accent: '#1a1410', trim: '#2a6bff', nb: '#1a1410', nf: '#ffb84a' },
  { id: 14, name: '마스터 크롬 핑크', level: 0, license: 'S', body: '#f2f3f7', accent: '#ff3fb4', trim: '#16171c', nb: '#16171c', nf: '#ff7ad8' },
];

// 차마다 필요한 레벨 (cars.json에서 읽음). 못 읽으면 모두 열림
let carLevels = {};
let carNames = {};
let carInfos = {};
/** 차 목록을 알려 줌 (carRoster.js도 불러 줌) */
export function registerCars(cars) {
  for (const c of cars || []) {
    if (!c || !c.id) continue;
    carLevels[c.id] = Math.max(0, Number(c.unlockLevel) || 0);
    carNames[c.id] = c.name || c.id;
    carInfos[c.id] = { id: c.id, name: c.name || c.id, class: c.class || '', tag: c.tag || '', desc: c.desc || '' };
  }
}
try {
  const res = await fetch(new URL('../data/cars.json', import.meta.url), { cache: 'no-cache' });
  if (res.ok) registerCars((await res.json()).cars);
} catch {}

/** 차 이름·등급·태그 (상점 카드용, 모르면 null) */
export const carInfo = (carId) => (carInfos[carId] ? { ...carInfos[carId] } : null);
/** 지금 내 레벨 */
export function currentLevel() {
  try {
    return profile.get().level || 1;
  } catch {
    return 1;
  }
}
// ── 가진 것 읽기 (gimmick.meta, 읽기만) ──
function metaRaw() {
  try {
    const j = JSON.parse(localStorage.getItem('gimmick.meta') || 'null');
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}
/** 재화 개편 뒤 저장(wv 2)인가 */
const walletReady = (m = metaRaw()) => !!(m && m.wv === 2);
/** 예전에 놀았던 저장이 있나 (옮길 때 열린 차·색을 그대로 줌): gimmick.meta가 있거나 경험치·기록이 있음 */
export function isLegacySave() {
  if (metaRaw()) return true;
  try {
    const p = JSON.parse(localStorage.getItem('gimmick.profile') || 'null');
    if (p && Number(p.xp) > 0) return true;
  } catch {}
  try {
    const r = JSON.parse(localStorage.getItem('gimmick.records') || 'null');
    if (r && typeof r === 'object' && Object.keys(r).length) return true;
  } catch {}
  return false;
}
/** 예전 규칙 레벨 (cars.json unlockLevel, 예전 15대 = 0) */
export const carLegacyLevel = (carId) => carLevels[carId] || 0;
/** 예전 규칙으로 열린 차인가 (옮기기 전 / 옮기는 순간) */
export const carLegacyOpen = (carId, level = currentLevel()) => level >= carLegacyLevel(carId);
/** 차를 사는 데 필요한 레벨 (시작 차 = 0, 표에 없는 차 = cars.json unlockLevel) */
export const carUnlockLevel = (carId) => (START_CARS.includes(carId) ? 0 : CAR_SHOP[carId] ? CAR_SHOP[carId].level : carLevels[carId] || 0);
/** 차 값 (피트 조각, 시작 차·모르는 차 = 0) */
export const carPrice = (carId) => (START_CARS.includes(carId) ? 0 : carShopPrice(carId));
export const isStartCar = (carId) => START_CARS.includes(carId);
/** 가진 차인가: 시작 5대 · 산 차 · 옮길 때 받은 차 (표에 없는 차는 예전 규칙) */
export function isCarOwned(carId) {
  if (START_CARS.includes(carId)) return true;
  const m = metaRaw();
  if (walletReady(m)) return !!(m.owned && m.owned['car:' + carId]) || (!CAR_SHOP[carId] && carLegacyOpen(carId));
  // 옮기기 전: 예전 저장이면 예전 규칙, 새로 온 사람이면 시작 5대만
  if (isLegacySave()) return carLegacyOpen(carId);
  return !CAR_SHOP[carId] && carLegacyOpen(carId);
}
/** 아직 없고 레벨이 돼서 살 수 있음 */
export const canBuyCar = (carId, level = currentLevel()) => !isCarOwned(carId) && !!CAR_SHOP[carId] && level >= carUnlockLevel(carId);
/** 보상 띠 (rewards1, 2026-11-15, 읽기만): 알고 있는 모든 차 [{ id, name, level, price, owned }] (level 0 = 처음부터) */
export const carUnlockList = () => Object.keys(carLevels).map((id) => ({ id, name: carNames[id] || id, level: carUnlockLevel(id), price: carPrice(id), owned: isCarOwned(id) }));
/** 차 고르기에서 탈 수 있나 = 가진 차 (재화 개편: 레벨만으로는 안 열림, 피트 조각으로 삼) */
export const isCarUnlocked = (carId) => isCarOwned(carId);

export const paintOf = (id) => PAINTS.find((p) => p.id === Number(id)) || PAINTS[0];
/** 쓸 수 있는 색 (= 가진 색): 원래·빨강·파랑 무료, 라이선스 색은 시험, 나머지는 커스텀 조각으로 산 색 (옮기기 전이면 예전 규칙: 레벨이 됐거나 미리 산 색) */
export const isPaintUnlocked = (id, level) => {
  const p = paintOf(id);
  if (p.license) return academy.hasLicense(p.license);
  if (!p.level) return true;
  const m = metaRaw();
  if (m && m.owned && m.owned['paint:' + p.id]) return true;
  if (walletReady(m)) return false;
  return (Number.isFinite(level) ? level : currentLevel()) >= p.level;
};
/** 아직 없고 레벨이 돼서 커스텀 조각으로 살 수 있는 색 */
export const canBuyPaint = (id, level = currentLevel()) => {
  const p = paintOf(id);
  return !!p.level && !p.license && !isPaintUnlocked(p.id, level) && level >= p.level;
};
/** 잠긴 색 안내 글자 ('Lv.5' / 'C 라이선스') */
export const paintLockText = (id) => {
  const p = paintOf(id);
  return p.license ? `${(licenseMeta(p.license) || {}).name || p.license + ' 라이선스'}` : `Lv.${p.level}`;
};
function readPaints() {
  try {
    const j = JSON.parse(localStorage.getItem(PAINT_KEY) || '{}');
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}
/** 이 차에 고른 색 id (없거나 아직 잠긴 색이면 0 = 원래 색) */
export function getPaint(carId) {
  const id = Number(readPaints()[carId]) || 0;
  return paintOf(id).id === id && isPaintUnlocked(id) ? id : 0;
}
export function setPaint(carId, id) {
  const all = readPaints();
  if (Number(id)) all[carId] = Number(id);
  else delete all[carId];
  try {
    localStorage.setItem(PAINT_KEY, JSON.stringify(all));
  } catch {}
}
/** 차 모습(look)에 색을 입힌 새 look (원본은 안 바뀜). paintId를 안 주면 저장된 색 */
export function applyPaint(look, carId, paintId) {
  const id = paintId == null ? getPaint(carId) : Number(paintId) || 0;
  const p = paintOf(id);
  if (!p.id || !p.body) return look;
  const base = look && typeof look === 'object' ? look : { style: 'f1' };
  return { ...base, body: p.body, accent: p.accent, trim: p.trim, rim: p.trim, helmet: p.accent, wall: null, numberBg: p.nb, numberFg: p.nf };
}

/** from < 레벨 ≤ to 사이에 열리는 것(차·색은 '살 수 있음'이 됨) { cars: [이름], paints: [이름] } */
export function unlockedBetween(from, to) {
  const cars = Object.keys(carLevels)
    .filter((id) => carUnlockLevel(id) > from && carUnlockLevel(id) <= to)
    .sort((a, b) => carUnlockLevel(a) - carUnlockLevel(b))
    .map((id) => carNames[id]);
  const paints = PAINTS.filter((p) => !p.license && p.level > from && p.level <= to).map((p) => p.name);
  return { cars, paints };
}
/** 다음에 열리는 것 (없으면 null) { level, text } */
export function nextUnlock(level = currentLevel()) {
  const lv = [...Object.keys(carLevels).map(carUnlockLevel), ...PAINTS.filter((p) => !p.license).map((p) => p.level)].filter((v) => v > level).sort((a, b) => a - b)[0];
  if (!lv) return null;
  const u = unlockedBetween(lv - 1, lv);
  const names = [...u.cars.map((n) => `🚗 ${n}`), ...u.paints.map((n) => `🎨 ${n}`)];
  return { level: lv, text: names.join(' · ') };
}
/** 지난번 홈에 왔을 때보다 레벨이 올랐으면 { from, to, cars, paints } (한 번만), 아니면 null */
export function takeLevelNews() {
  const now = currentLevel();
  let seen = 1;
  try {
    seen = Number(localStorage.getItem(SEEN_KEY)) || 1;
    localStorage.setItem(SEEN_KEY, String(now));
  } catch {}
  if (now <= seen) return null;
  return { from: seen, to: now, ...unlockedBetween(seen, now) };
}

// 코스튬 API 추가: 기존 페인트/차 해금 함수는 그대로 유지.
const COSTUME_KEY = 'gimmick.costume';
export function isCostumeUnlocked(carId, id, level = currentLevel()) {
  if (!id || id === 'default') return true;
  const c = listCostumes(carId).find(c => c.id === id);
  return !!c && Number(level) >= c.unlockLevel;
}
export function getCostume(carId) {
  try { const id = JSON.parse(localStorage.getItem(COSTUME_KEY) || '{}')?.[carId]; return listCostumes(carId).some(c => c.id === id) ? id : ''; } catch { return ''; }
}
export function setCostume(carId, id = '') {
  id = id === 'default' ? '' : id;
  if (!isCostumeUnlocked(carId, id)) return false;
  try {
    const raw = JSON.parse(localStorage.getItem(COSTUME_KEY) || '{}');
    const saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (id) saved[carId] = id; else delete saved[carId];
    localStorage.setItem(COSTUME_KEY, JSON.stringify(saved));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gimmick:costume', { detail: { carId, id } }));
    return true;
  } catch { return false; }
}
