// 보상 길 (rewards1, 2026-11-15, 점검 .debug/agents/rewards-review.md 제안 B)
//   레벨 순서로 '무엇이 열리는지'를 한 목록으로: 차 · 색 · 부품 · 코스튬(지금 고른 차 먼저, 다른 차는 뒤) · 티어
//   데이터는 복사하지 않고 profile·unlocks·parts·carCostumes·metaCatalog에서 읽기만 함 (저장 값은 하나도 안 바꿈)
//   - meta.js는 불러오지 않음 (불러오면 bootMeta가 환영 코인·체크인을 줌) → 'gimmick.meta'는 localStorage에서 읽기만
//   - parts.listParts/takeNews도 안 씀 (syncGrants가 저장함) → partsData·partState·altText만
// 쓰는 법:
//   rewardPath({ carId })            → [{ level, kind, id, key, name, icon, color?, carId?, carName?, slot?, slotName?, price, how, alt, mine, state }]
//       kind = 'tier' | 'car' | 'part' | 'paint' | 'costume'
//       how  = 'level'(레벨이 되면 저절로) | 'coin'(레벨이 되면 조각으로 구매) | 'gift'(선물로 받음)   ← 예전 값 그대로 (화면 호환)
//       currency = 'pit'(피트 조각: 차·부품) | 'custom'(커스텀 조각: 색·코스튬) | null (upgradeB, 2026-11-15)
//       via  = 설계의 how: 'pit' | 'custom' | 'gift' | 'level' (upgradeB)
//       차 = 시작 5대를 뺀 16대, 레벨이 되면 피트 조각으로 삼 (state open), 색 = 레벨이 되면 커스텀 조각으로 삼
//       alt  = 다른 길 글 ('업적 「…」 달성', '아카데미 「…」 금' …) 또는 ''
//       mine = 모든 차 공용이거나 지금 고른 차 것 (다른 차 코스튬만 false)
//       state = 'owned'(가짐·열림) | 'open'(레벨은 됨, 조각으로 살 수 있음) | 'locked'(레벨이 아직)
//   rewardsAt(level, { carId })      → 그 레벨에 열리는 것들 (같은 순서)
//   nextRewards({ carId, n, level, mine }) → 지금 레벨보다 높은 것 n개 (mine:true = 다른 차 코스튬 빼고)
//   nextRewardLevel({ carId, level }) → { level, items } 다음에 무언가 열리는 레벨 (없으면 null)
//   racesToLevel(level, { xp, avg }) → { xp: 남은 XP, races: 약 n판, avg: 한 판 평균 XP, guess: 기록이 없어 130으로 가정했나 }
import { profile, levelStartXp } from './profile.js';
import { PAINTS, carUnlockList, paintLockText, isPaintUnlocked } from './unlocks.js';
import { partsData, partState, altText } from './parts.js';
import { listCostumes } from './carCostumes.js';
import { ACHIEVEMENTS, costumePrice, paintPrice, partPrice } from './metaCatalog.js';

export const DEFAULT_RACE_XP = 130; // 기록이 없을 때 한 판 XP (봇 레이스 평균, 점검 보고서 1.3)
const KIND_ORDER = { tier: 0, car: 1, part: 2, paint: 3, costume: 4 };

function metaState() {
  try { return JSON.parse(localStorage.getItem('gimmick.meta') || '{}') || {}; } catch { return {}; }
}
function myLevel(lv) {
  if (Number.isFinite(lv)) return lv;
  try { return profile.get().level || 1; } catch { return 1; }
}

/** 전체 보상 길 (레벨 1~끝). opts.level = 상태 계산용 레벨 (테스트), opts.carId = 지금 고른 차 */
export function rewardPath(opts = {}) {
  const carId = opts.carId || 'f1';
  const L = myLevel(opts.level);
  const owned = metaState().owned || {};
  const cars = carUnlockList();
  const carName = Object.fromEntries(cars.map((c) => [c.id, c.name]));
  const out = [];
  // 티어 (Lv1 루키는 시작이라 뺌)
  for (const t of profile.tiers()) {
    if (t.lv <= 1) continue;
    out.push({ level: t.lv, kind: 'tier', id: 'tier-' + t.lv, key: 'tier:' + t.lv, name: t.title, icon: t.icon, color: t.color, price: 0, how: 'level', currency: null, via: 'level', alt: '', mine: true, state: L >= t.lv ? 'owned' : 'locked' });
  }
  // 차 (시작 5대 빼고: 레벨이 되면 피트 조각으로 삼)
  for (const c of cars) {
    if (!(c.level > 0)) continue;
    out.push({ level: c.level, kind: 'car', id: c.id, key: 'car:' + c.id, carId: c.id, carName: c.name, name: c.name, icon: '🚗', price: c.price || 0, how: 'coin', currency: 'pit', via: 'pit', alt: '', mine: true, state: c.owned ? 'owned' : L >= c.level ? 'open' : 'locked' });
  }
  // 색 (라이선스 색은 레벨과 무관 → 뺌, 레벨이 되면 커스텀 조각으로 삼)
  for (const p of PAINTS) {
    if (p.license || !(p.level > 0)) continue;
    const has = !!owned['paint:' + p.id] || isPaintUnlocked(p.id, L);
    out.push({ level: p.level, kind: 'paint', id: p.id, key: 'paint:' + p.id, name: p.name, icon: '🎨', color: p.body, accent: p.accent, price: paintPrice(p), how: 'coin', currency: 'custom', via: 'custom', alt: '', lockText: paintLockText(p.id), mine: true, state: has ? 'owned' : L >= p.level ? 'open' : 'locked' });
  }
  // 부품
  const data = partsData();
  const slotOf = Object.fromEntries((data.slots || []).map((s) => [s.id, s]));
  for (const p of data.parts || []) {
    const st = partState(p.id, { level: L }) || {};
    const s = slotOf[p.slot] || {};
    const gift = !!(p.alt && p.alt.gift);
    out.push({ level: p.level || 0, kind: 'part', id: p.id, key: 'part:' + p.id, name: p.name, short: p.short || p.name, icon: p.icon || s.icon || '🔧', slot: p.slot, slotName: s.name || p.slot, slotIcon: s.icon || '🔧', price: partPrice(p), how: gift ? 'gift' : 'coin', currency: 'pit', via: gift ? 'gift' : 'pit', alt: altText(p), mine: true, state: st.owned ? 'owned' : st.levelOk ? 'open' : 'locked' });
  }
  // 코스튬 (모든 차, 지금 고른 차 것이 mine)
  for (const c of cars) {
    for (const k of listCostumes(c.id)) {
      const ach = ACHIEVEMENTS.find((a) => a.costume === k.id);
      const has = !!owned['costume:' + k.id];
      out.push({ level: k.unlockLevel || 0, kind: 'costume', id: k.id, key: 'costume:' + k.id, carId: c.id, carName: c.name, name: k.name, desc: k.desc || '', icon: '✦', color: k.look && k.look.body, price: costumePrice(k), how: 'coin', currency: 'custom', via: 'custom', alt: ach ? `업적 「${ach.name}」 달성` : '', mine: c.id === carId, state: has ? 'owned' : L >= (k.unlockLevel || 0) ? 'open' : 'locked' });
    }
  }
  return sortPath(out);
}
/** 레벨 → 같은 레벨 안에서는 티어·차·부품·색·내 차 코스튬·다른 차 코스튬 */
function sortPath(list) {
  const rank = (x) => KIND_ORDER[x.kind] * 2 + (x.kind === 'costume' && !x.mine ? 1 : 0);
  return list.sort((a, b) => a.level - b.level || rank(a) - rank(b) || String(a.carName || '').localeCompare(String(b.carName || '')) || String(a.id).localeCompare(String(b.id)));
}

/** 그 레벨에 열리는 것들 */
export function rewardsAt(level, opts = {}) {
  return rewardPath(opts).filter((x) => x.level === level);
}
/** from < 레벨 ≤ to 사이에 열린 것들 (결과 화면 레벨 업 카드) */
export function rewardsBetween(from, to, opts = {}) {
  return rewardPath(opts).filter((x) => x.level > from && x.level <= to);
}
/** 지금 레벨(opts.level)보다 높은 보상 n개. opts.mine = 다른 차 코스튬 빼고 */
export function nextRewards(opts = {}) {
  const L = myLevel(opts.level);
  const n = opts.n || 3;
  return rewardPath(opts).filter((x) => x.level > L && (!opts.mine || x.mine)).slice(0, n);
}
/** 다음에 무언가 열리는 레벨과 그 레벨의 보상 { level, items } (없으면 null) */
export function nextRewardLevel(opts = {}) {
  const L = myLevel(opts.level);
  const all = rewardPath(opts).filter((x) => x.level > L);
  if (!all.length) return null;
  const lv = all[0].level;
  return { level: lv, items: all.filter((x) => x.level === lv) };
}

/** 최근 판 평균 XP (gimmick.meta recentXp, 없으면 null) */
export function recentRaceXp() {
  const r = metaState().recentXp;
  if (!Array.isArray(r)) return null;
  const v = r.map(Number).filter((x) => x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
/** 그 레벨까지 남은 XP와 '약 n판'. opts.xp = 지금 누적 XP (안 주면 profile), opts.avg = 한 판 XP (안 주면 최근 평균 또는 130) */
export function racesToLevel(level, opts = {}) {
  let xp = opts.xp;
  if (!Number.isFinite(xp)) { try { xp = profile.get().xp || 0; } catch { xp = 0; } }
  const rec = Number.isFinite(opts.avg) ? opts.avg : recentRaceXp();
  const avg = Math.max(20, rec || DEFAULT_RACE_XP);
  const left = Math.max(0, levelStartXp(level) - xp);
  return { xp: left, races: left > 0 ? Math.max(1, Math.ceil(left / avg)) : 0, avg: Math.round(avg), guess: !rec };
}
