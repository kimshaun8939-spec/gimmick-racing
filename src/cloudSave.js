// 계정 클라우드 저장 (cloudsave, 2026-11-15, 사용자 "이름 + 비번에 계정 저장할 수 없어?" → "만들어줘. 로그아웃하고 다른 이름 계정으로도")
//   이름 + 비밀번호 4자리 계정(claimed)이면 이 기기의 '계정 진행'(지갑·산 물건·부품·강화·꾸미기·업적·아카데미·기록 …)을
//   서버 player_saves 한 줄(jsonb)에 올리고 받음. 서버 SQL = .debug/supabase_v6_save.sql (gr_save_get · gr_save_put)
//
//   키 나누기 (keyKind):
//     account = 계정 진행 → 서버에 올림, 계정을 바꾸면 바뀜 (모르는 새 gimmick.* 키도 기본은 계정, 20 KB 넘으면 안 올림)
//     local   = 계정 것이지만 안 올림: gimmick.profile(경험치는 기기마다 서버 player_xp로 따로 합침) · gimmick.profileNet · gimmick.nick(서버 이름을 따름)
//     ghost   = gimmick.ghost.* (커서 안 올림) → 계정을 바꾸면 그 계정 몫으로 이 기기 안에 따로 보관(gimmick.ghostStash.<id>)했다가 다시 들어오면 돌려놓음
//     device  = 설정·조작키·패드·화질·기기 id·온라인 열쇠·사진 캐시 … → 그대로 둠
//   합치기 (mergeSaves):
//     'three' = 같은 계정, 지난번 맞춘 상태(base)를 앎 → 한쪽만 바뀐 키는 그쪽, 둘 다 바뀌면 키마다 규칙 (지갑은 서버 + 이 기기에서 늘고 준 만큼)
//     'first' = 처음 연결 (이 기기 진행은 주인 없음) → 산 물건·해금·업적 = 합집합, 강화·레벨 = 큰 쪽, 조각 = 큰 쪽(더하지 않음), 기록 = 빠른 쪽
//               이 기기에 진행이 거의 없으면(새 브라우저) 서버 것을 그대로
//     이 기기 진행이 다른 계정 것이면 합치지 않음: 그 계정에 먼저 올리고 → 이 기기를 비우고 → 새 계정 저장으로 바꿈
//   올리기: 진행이 바뀌면(이벤트 + 30초마다 확인) 4초 모아서, 15초에 한 번까지. 페이지를 닫을 때 한 번 시도(keepalive)
//   서버에 v6 함수가 없으면(SQL 전) 10분 동안 다시 안 부름, 인터넷이 없으면 다음 기회에. 오류는 화면·콘솔에 안 냄
//   끄기: 주소 &cloud=0
const SYNC_KEY = 'gimmick.saveSync'; // { id, version, hashes:{키:해시}, base:{지갑 기준}, at, missingAt }
const OWNER_KEY = 'gimmick.saveOwner'; // 이 기기 계정 진행의 주인 (계정 id)
const STASH = 'gimmick.ghostStash.'; // + 계정 id → { 고스트 키: 값 }
const TOAST_KEY = 'gimmick.cloudToast'; // (sessionStorage) 새로 고침 뒤 띄울 알림
const MAX_BYTES = 204800; // 서버와 같은 크기 제한 (200 KB)
const UNKNOWN_MAX = 20000; // 목록에 없는 새 키는 20 KB까지만
const MISSING_WAIT = 10 * 60e3;
const DEBOUNCE = 4000, MIN_GAP = 15000;

/** 기기 키 (계정을 바꿔도 남음, 서버에 안 올림) */
export const DEVICE_KEYS = [
  'gimmick.settings', 'gimmick.keys', 'gimmick.keyPreset', 'gimmick.pad', 'gimmick.autoRes', 'gimmick.fps60', 'gimmick.ver',
  'gimmick.carThumbs', 'gimmick.partThumbs', 'gimmick.device', 'gimmick.online', 'gimmick.olStock', 'gimmick.olCache', 'gimmick.olStatusAt',
  'gimmick.carList', 'gimmick.carTab', 'gimmick.compare', 'gimmick.lobbyMode', 'gimmick.room', 'gimmick.pid', 'gimmick.net', 'gimmick.ice',
  'gimmick.portraitOk', 'gimmick.wheelIn', 'gimmick.gateTest', 'gimmick.friendGhost.pending', SYNC_KEY, OWNER_KEY,
];
/** 계정 것이지만 서버에 안 올리는 키 */
export const LOCAL_KEYS = ['gimmick.profile', 'gimmick.profileNet', 'gimmick.nick'];
/** 알고 있는 계정 키 (크기 제한 없이 올림) */
export const ACCOUNT_KEYS = [
  'gimmick.meta', 'gimmick.partLv', 'gimmick.parts', 'gimmick.partsExtra', 'gimmick.paint', 'gimmick.costume', 'gimmick.costumes',
  'gimmick.academy', 'gimmick.gate', 'gimmick.seenLevel', 'gimmick.tutorial', 'gimmick.firstRun', 'gimmick.firstComplete',
  'gimmick.records', 'gimmick.sectors', 'gimmick.champ', 'gimmick.last', 'gimmick.welcomeSeen',
];
const DEVICE_SET = new Set(DEVICE_KEYS), LOCAL_SET = new Set(LOCAL_KEYS), ACCOUNT_SET = new Set(ACCOUNT_KEYS);
/** 키 종류: 'account' | 'local' | 'ghost' | 'device' | null(게임 키 아님) */
export function keyKind(k) {
  k = String(k || '');
  if (k.startsWith('cornerBest:')) return 'account'; // 코너별 내 최고 (main.js)
  if (!k.startsWith('gimmick.')) return null; // racingLine(설정)·시험 키 등
  if (DEVICE_SET.has(k) || k.startsWith(STASH)) return 'device';
  if (LOCAL_SET.has(k)) return 'local';
  if (k.startsWith('gimmick.ghost.')) return 'ghost';
  if (k.startsWith('gimmick.courseIntro.')) return 'account'; // 맵 첫 안내 본 것
  return 'account';
}

// ───────── 작은 도구 ─────────
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const parse = (s) => {
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return undefined; // JSON이 아닌 글자 ('done' 등)
  }
};
/** FNV-1a 32비트 → 8자리 16진수 (null = 키 없음) */
export function hash(s) {
  if (s == null) return '-';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export const hashes = (keys) => Object.fromEntries(Object.entries(keys || {}).map(([k, v]) => [k, hash(v)]));
const sameKeys = (a, b) => {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
};
const sameHashes = sameKeys;
const bytes = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 3);
const storage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};
const sget = (k) => {
  try {
    return storage()?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const sset = (k, v) => {
  try {
    if (v == null) storage()?.removeItem(k);
    else storage()?.setItem(k, v);
    return true;
  } catch {
    return false;
  }
};
const allKeys = () => {
  const st = storage(), out = [];
  if (!st) return out;
  try {
    for (let i = 0; i < st.length; i++) out.push(st.key(i));
  } catch {}
  return out.filter((k) => k != null);
};

/** 이 기기의 계정 진행 { 키: 원래 글자 } (고스트·경험치·이름 빼고) */
export function collect() {
  const out = {};
  for (const k of allKeys()) {
    if (keyKind(k) !== 'account') continue;
    const v = sget(k);
    if (v == null) continue;
    if (!ACCOUNT_SET.has(k) && !k.startsWith('cornerBest:') && !k.startsWith('gimmick.courseIntro.') && v.length > UNKNOWN_MAX) continue;
    out[k] = v;
  }
  return out;
}
/** 서버에 보낼 모양 + 크기가 넘으면 덜 중요한 것부터 뺌 (구간 기록 → 코너별 기록) */
export function pack(keys, device) {
  const data = { v: 1, at: Date.now(), device: device || null, keys: { ...keys } };
  const fits = () => bytes(JSON.stringify(data)) <= MAX_BYTES - 1024;
  if (!fits()) delete data.keys['gimmick.sectors'];
  if (!fits()) for (const k of Object.keys(data.keys)) if (k.startsWith('cornerBest:')) delete data.keys[k];
  if (!fits()) throw Object.assign(new Error('계정 저장이 너무 커요'), { tooBig: true });
  return data;
}
export function unpack(data) {
  const d = typeof data === 'string' ? parse(data) : data;
  const keys = isObj(d) && isObj(d.keys) ? d.keys : {};
  const out = {};
  for (const [k, v] of Object.entries(keys)) if (typeof v === 'string' && keyKind(k) === 'account') out[k] = v;
  return out;
}

// ───────── 진행 크기 (어느 쪽이 '주'인지, 새 브라우저인지) ─────────
function recCount(raw) {
  const r = parse(raw);
  let n = 0;
  if (isObj(r)) for (const cars of Object.values(r)) if (isObj(cars)) for (const v of Object.values(cars)) if (isObj(v) && (v.race > 0 || v.lap > 0)) n++;
  return n;
}
export function progressScore(keys) {
  const m = parse(keys['gimmick.meta']);
  let s = recCount(keys['gimmick.records']) * 30;
  if (isObj(m)) {
    for (const w of [m.earnedBy]) if (isObj(w)) s += num(w.pit) + num(w.up) + num(w.custom);
    s += num(m.stats && m.stats.races) * 50 + Object.keys(isObj(m.achievements) ? m.achievements : {}).length * 20 + Object.keys(isObj(m.owned) ? m.owned : {}).length * 40;
  }
  const lv = parse(keys['gimmick.partLv']);
  if (isObj(lv) && isObj(lv.parts)) s += Object.keys(lv.parts).length * 40;
  const ac = parse(keys['gimmick.academy']);
  if (isObj(ac) && isObj(ac.lessons)) s += Object.values(ac.lessons).filter((l) => isObj(l) && l.medal > 0).length * 40;
  if (keys['gimmick.tutorial'] === 'done') s += 30;
  return s;
}
/** 거의 처음 상태 (레이스·업적·산 물건·기록·강화·메달 없음) */
export function isFresh(keys) {
  const m = parse(keys['gimmick.meta']);
  if (isObj(m)) {
    if (num(m.stats && m.stats.races) > 0) return false;
    if (Object.keys(isObj(m.achievements) ? m.achievements : {}).length) return false;
    if (Object.keys(isObj(m.owned) ? m.owned : {}).length) return false;
    if (isObj(m.spentBy) && (num(m.spentBy.pit) || num(m.spentBy.up) || num(m.spentBy.custom))) return false;
  }
  if (recCount(keys['gimmick.records'])) return false;
  const lv = parse(keys['gimmick.partLv']);
  if (isObj(lv) && isObj(lv.parts) && Object.keys(lv.parts).length) return false;
  const ac = parse(keys['gimmick.academy']);
  if (isObj(ac) && isObj(ac.lessons) && Object.values(ac.lessons).some((l) => isObj(l) && l.medal > 0)) return false;
  return keys['gimmick.tutorial'] !== 'done';
}

// ───────── 키마다 합치는 규칙 ─────────
const unionObj = (p, o) => ({ ...(isObj(o) ? o : {}), ...(isObj(p) ? p : {}) }); // 키 합집합, 겹치면 p
function deepUnion(p, o) {
  if (isObj(p) && isObj(o)) {
    const out = { ...o };
    for (const [k, v] of Object.entries(p)) out[k] = k in o ? deepUnion(v, o[k]) : v;
    return out;
  }
  return p === undefined ? o : p;
}
const maxMap = (a, b) => {
  const out = { ...(isObj(b) ? b : {}) };
  for (const [k, v] of Object.entries(isObj(a) ? a : {})) out[k] = typeof v === 'number' || typeof out[k] === 'number' ? Math.max(num(v), num(out[k])) : v;
  return out;
};
const RANK = {
  'gimmick.tutorial': ['', 'asked', 'done'],
  'gimmick.firstRun': ['', 'ready', 'done'],
};
const COUNTERS = ['wallet', 'earnedBy', 'spentBy', 'exchanged'];
/** 지갑 기준 (three 합치기에서 '이 기기에서 늘고 준 만큼'을 재는 바탕) */
export function metaBase(keys) {
  const m = parse(keys && keys['gimmick.meta']);
  if (!isObj(m)) return null;
  const out = {};
  for (const c of COUNTERS) if (isObj(m[c])) out[c] = { ...m[c] };
  return out;
}
function mergeMeta(l, s, ctx) {
  if (!isObj(l)) return s;
  if (!isObj(s)) return l;
  // 재화 개편 전 모양(wv 없음)이 한쪽만이면 개편된 쪽을 바탕으로
  let P = ctx.primary === 'local' ? l : s, O = P === l ? s : l;
  if (O.wv === 2 && P.wv !== 2) [P, O] = [O, P];
  const out = JSON.parse(JSON.stringify(P));
  const base = ctx.mode === 'three' ? ctx.baseMeta : null;
  for (const c of COUNTERS) {
    const a = isObj(l[c]) ? l[c] : {}, b = isObj(s[c]) ? s[c] : {};
    const o = {};
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const B = base && isObj(base[c]) && f in base[c] ? num(base[c][f]) : null;
      o[f] = Math.floor(Math.max(0, B == null ? Math.max(num(a[f]), num(b[f])) : num(b[f]) + (num(a[f]) - B)));
    }
    out[c] = o;
  }
  if (isObj(out.wallet)) {
    out.coins = num(out.wallet.pit);
    if (isObj(out.earnedBy)) out.earned = num(out.earnedBy.pit);
    if (isObj(out.spentBy)) out.spent = num(out.spentBy.pit);
  }
  out.stats = maxMap(P.stats, O.stats);
  out.maps = maxMap(P.maps, O.maps);
  out.cars = maxMap(P.cars, O.cars);
  out.achievements = unionObj(P.achievements, O.achievements);
  out.owned = unionObj(P.owned, O.owned);
  out.academyPaid = maxMap(P.academyPaid, O.academyPaid);
  // 체크인: 더 늦은 날 (같은 날이면 큰 값)
  const la = isObj(P.login) ? P.login : {}, lb = isObj(O.login) ? O.login : {};
  out.login = String(lb.day || '') > String(la.day || '') ? { ...lb } : { ...la };
  out.login.total = Math.max(num(la.total), num(lb.total));
  if (la.day === lb.day) out.login.streak = Math.max(num(la.streak), num(lb.streak));
  // 일일·주간 목표: 같은 기간이면 진행 큰 쪽·받은 것 합집합, 다르면 더 새 기간
  const pa = isObj(P.periods) ? P.periods : {}, pb = isObj(O.periods) ? O.periods : {};
  out.periods = { ...pb, ...pa };
  for (const t of Object.keys(out.periods)) {
    const x = pa[t], y = pb[t];
    if (!isObj(x) || !isObj(y)) continue;
    if (x.key === y.key && Array.isArray(x.goals) && Array.isArray(y.goals)) {
      out.periods[t] = { ...x, goals: x.goals.map((g, i) => (isObj(g) && isObj(y.goals[i]) && y.goals[i].id === g.id ? { ...g, progress: Math.max(num(g.progress), num(y.goals[i].progress)), claimed: !!(g.claimed || y.goals[i].claimed) } : g)) };
    } else out.periods[t] = String(y.key || '') > String(x.key || '') ? y : x;
  }
  // 내역: 합치고 시간순 마지막 60개
  const seen = new Set(), hist = [];
  for (const h of [...(Array.isArray(P.history) ? P.history : []), ...(Array.isArray(O.history) ? O.history : [])]) {
    if (!isObj(h)) continue;
    const k = [h.at, h.amount, h.kind, h.reason].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    hist.push(h);
  }
  out.history = hist.sort((a, b) => num(a.at) - num(b.at)).slice(-60);
  out.levelPaid = Math.max(num(P.levelPaid), num(O.levelPaid)) || P.levelPaid;
  for (const f of ['tutorialPaid', 'welcome']) out[f] = !!(P[f] || O[f]);
  for (const [k, v] of Object.entries(O)) if (!(k in out)) out[k] = v;
  return out;
}
function mergePartLv(p, o) {
  const out = { v: 1, ...(isObj(o) ? o : {}), ...(isObj(p) ? p : {}) };
  const a = isObj(p) && isObj(p.parts) ? p.parts : {}, b = isObj(o) && isObj(o.parts) ? o.parts : {};
  const parts = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id], y = b[id];
    if (!isObj(y)) parts[id] = x;
    else if (!isObj(x)) parts[id] = y;
    else parts[id] = num(y.lv) > num(x.lv) || (num(y.lv) === num(x.lv) && num(y.tries) > num(x.tries)) ? y : x;
  }
  out.parts = parts;
  return out;
}
const RACE_F = ['race', 'raceMode', 'raceBuild', 'raceRivals', 'raceExcludedReason', 'laps', 'raceAssist'];
const LAP_F = ['lap', 'lapMode', 'lapBuild', 'lapRivals', 'lapAssist'];
function mergeEntry(p, o) {
  if (!isObj(o)) return p;
  if (!isObj(p)) return o;
  const out = { ...o, ...p };
  const pick = (fields, val, bad) => {
    const sp = p[val] > 0 && !p[bad] ? p[val] : Infinity, so = o[val] > 0 && !o[bad] ? o[val] : Infinity;
    const src = so < sp ? o : p;
    for (const f of fields) {
      if (f in src) out[f] = src[f];
      else delete out[f];
    }
  };
  pick(RACE_F, 'race', 'raceRivals');
  pick(LAP_F, 'lap', 'lapRivals');
  if (p.date || o.date) out.date = Math.max(num(p.date), num(o.date));
  return out;
}
function mergeRecords(p, o) {
  const out = {};
  const a = isObj(p) ? p : {}, b = isObj(o) ? o : {};
  for (const map of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = isObj(a[map]) ? a[map] : {}, y = isObj(b[map]) ? b[map] : {};
    out[map] = {};
    for (const car of new Set([...Object.keys(x), ...Object.keys(y)])) out[map][car] = mergeEntry(x[car], y[car]);
  }
  return out;
}
function mergeSectors(p, o) {
  const out = {};
  const a = isObj(p) ? p : {}, b = isObj(o) ? o : {};
  for (const map of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = isObj(a[map]) ? a[map] : {}, y = isObj(b[map]) ? b[map] : {};
    out[map] = {};
    for (const car of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const s1 = Array.isArray(x[car]) ? x[car] : [], s2 = Array.isArray(y[car]) ? y[car] : [];
      out[map][car] = Array.from({ length: Math.max(s1.length, s2.length) }, (_, i) => (s1[i] == null ? s2[i] : s2[i] == null ? s1[i] : Math.min(s1[i], s2[i])));
    }
  }
  return out;
}
function minMap(p, o) {
  const out = { ...(isObj(o) ? o : {}) };
  for (const [k, v] of Object.entries(isObj(p) ? p : {})) out[k] = out[k] == null ? v : Math.min(num(v), num(out[k]));
  return out;
}
function mergeAcademy(p, o) {
  const a = isObj(p) ? p : {}, b = isObj(o) ? o : {};
  const la = isObj(a.lessons) ? a.lessons : {}, lb = isObj(b.lessons) ? b.lessons : {};
  const lessons = {};
  for (const id of new Set([...Object.keys(la), ...Object.keys(lb)])) {
    const x = isObj(la[id]) ? la[id] : null, y = isObj(lb[id]) ? lb[id] : null;
    if (!x || !y) {
      lessons[id] = x || y;
      continue;
    }
    lessons[id] = { ...y, ...x, medal: Math.max(num(x.medal), num(y.medal)), pts: Math.max(num(x.pts), num(y.pts)), tries: Math.max(num(x.tries), num(y.tries)), at: Math.max(num(x.at), num(y.at)) };
  }
  return { ...b, ...a, v: 1, lessons, licenses: unionObj(a.licenses, b.licenses), paid: unionObj(a.paid, b.paid) };
}
/** 한 키 합치기 (p = 주, o = 다른 쪽; 둘 다 원래 글자, null = 없음) → 글자 또는 null */
export function mergeKey(k, p, o, ctx = {}) {
  if (p == null) return o;
  if (o == null) return p;
  if (p === o) return p;
  if (RANK[k]) {
    const r = RANK[k];
    return r.indexOf(o) > r.indexOf(p) ? o : p;
  }
  if (k === 'gimmick.firstComplete' || k.startsWith('gimmick.courseIntro.')) return p || o;
  if (k === 'gimmick.seenLevel') return String(Math.max(num(p), num(o)));
  const P = parse(p), O = parse(o);
  if (P === undefined || O === undefined) return p; // JSON이 아닌 글자: 주 쪽
  const L = ctx.primary === 'local' ? P : O, S = L === P ? O : P;
  let v;
  if (k === 'gimmick.meta') v = mergeMeta(L, S, ctx);
  else if (k === 'gimmick.partLv') v = mergePartLv(P, O);
  else if (k === 'gimmick.parts' || k === 'gimmick.paint' || k === 'gimmick.costume' || k === 'gimmick.costumes') v = unionObj(P, O);
  else if (k === 'gimmick.partsExtra') v = { ...unionObj(O, P), v: 1, gifts: unionObj(P && P.gifts, O && O.gifts), presets: unionObj(P && P.presets, O && O.presets), news: Array.isArray(P && P.news) ? P.news : [] };
  else if (k === 'gimmick.academy') v = mergeAcademy(P, O);
  else if (k === 'gimmick.gate') v = deepUnion(P, O);
  else if (k === 'gimmick.records') v = mergeRecords(P, O);
  else if (k === 'gimmick.sectors') v = mergeSectors(P, O);
  else if (k.startsWith('cornerBest:')) v = minMap(P, O);
  else return p; // 선택·시즌 진행·모르는 키 = 주 쪽 그대로
  return JSON.stringify(v);
}
/**
 * 계정 진행 합치기 → { 키: 글자 }
 *   opts.mode = 'three'(같은 계정, base = { hashes, base }) | 'first'(처음 연결, base 없음)
 */
export function mergeSaves(local, server, opts = {}) {
  local = local || {};
  server = server || {};
  const three = opts.mode === 'three' && opts.base && isObj(opts.base.hashes);
  const primary = three ? 'local' : progressScore(server) > progressScore(local) ? 'server' : 'local';
  const ctx = { mode: three ? 'three' : 'first', primary, baseMeta: three ? opts.base.base || null : null };
  const out = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(server)])) {
    const l = local[k] ?? null, s = server[k] ?? null;
    let v;
    if (l === s) v = l;
    else if (three && hash(l) === (opts.base.hashes[k] || '-')) v = s; // 서버에서만 바뀜
    else if (three && hash(s) === (opts.base.hashes[k] || '-')) v = l; // 이 기기에서만 바뀜 (지운 것 포함)
    else v = primary === 'local' ? mergeKey(k, l, s, ctx) : mergeKey(k, s, l, ctx);
    if (v != null) out[k] = v;
  }
  return out;
}

// ───────── 서버와 주고받기 ─────────
let api = null; // online.js가 attach: { rpc, readId, enabled(), syncXp(), clearId() }
let metaMod = null;
let lock = Promise.resolve();
let timer = 0, lastPut = 0, booted = false;
const qflag = (k) => {
  try {
    return new URLSearchParams(location.search).get(k);
  } catch {
    return null;
  }
};
const off = () => qflag('cloud') === '0';
function readSync() {
  try {
    const j = JSON.parse(sget(SYNC_KEY) || 'null');
    return isObj(j) ? j : {};
  } catch {
    return {};
  }
}
const writeSync = (patch) => sset(SYNC_KEY, JSON.stringify({ ...readSync(), ...patch }));
const owner = () => sget(OWNER_KEY) || null;
const setOwner = (id) => sset(OWNER_KEY, id || null);
function linkSync(id, version, keys) {
  writeSync({ id, version: version || 0, hashes: hashes(keys), base: metaBase(keys), at: Date.now() });
  setOwner(id);
}
const device = () => sget('gimmick.device');
/** 비밀번호로 지킨 계정이고 온라인이 켜져 있으면 그 계정 */
function account() {
  if (!api || off()) return null;
  try {
    if (!api.enabled()) return null;
  } catch {
    return null;
  }
  const m = api.readId();
  return m && m.claimed ? m : null;
}
const missingNow = () => {
  const t = num(readSync().missingAt);
  return t && Date.now() - t < MISSING_WAIT && Date.now() >= t;
};
function isMissing(err) {
  const msg = [err && err.message, err && err.details, err && err.hint].filter(Boolean).join(' ');
  return /^(PGRST202|PGRST203|42883|42P01)$/.test((err && err.code) || '') || (/gr_save_|player_saves/i.test(msg) && /could not find|does not exist|schema cache|unknown function/i.test(msg));
}
async function call(fn, body, opts) {
  if (missingNow()) throw Object.assign(new Error('계정 저장 서버 준비 전'), { missing: true });
  try {
    return await api.rpc(fn, body, opts);
  } catch (err) {
    if (isMissing(err)) {
      writeSync({ missingAt: Date.now() });
      throw Object.assign(new Error('계정 저장 서버 준비 전'), { missing: true });
    }
    throw err;
  }
}
async function loadMeta() {
  if (metaMod || typeof window === 'undefined') return metaMod;
  if (window.__cloudMeta) return (metaMod = window.__cloudMeta); // 시험용 (cloudsave_test.mjs)
  try {
    metaMod = await import('./meta.js');
  } catch {}
  return metaMod;
}
async function snapshot() {
  const m = await loadMeta();
  try {
    m && m.metaFlush && m.metaFlush(); // 미뤄 둔 메타 저장부터
  } catch {}
  return collect();
}
/** 계정 진행 키를 keys로 바꿈 (없는 키는 지움) + 메타 다시 읽기 */
async function applyLocal(keys) {
  for (const k of allKeys()) if (keyKind(k) === 'account' && !(k in keys)) sset(k, null);
  for (const [k, v] of Object.entries(keys)) if (sget(k) !== v) sset(k, v);
  const m = await loadMeta();
  try {
    m && m.metaReload && m.metaReload();
  } catch {}
}
function serialize(fn) {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
}
const fail = (err) => (err && err.missing ? { ok: false, missing: true } : err && err.offline ? { ok: false, offline: true } : err && err.tooBig ? { ok: false, tooBig: true } : { ok: false, error: (err && err.message) || String(err) });

async function put(acct, keys, base, opts = {}) {
  const r = await call('gr_save_put', { p_id: acct.id, p_secret: acct.secret, p_data: pack(keys, device()), p_base: base || 0, p_device: device() }, opts);
  lastPut = Date.now();
  return r || { ok: false, reason: 'bad' };
}
async function get(acct) {
  const r = await call('gr_save_get', { p_id: acct.id, p_secret: acct.secret });
  return r && isObj(r) && r.data ? { version: num(r.version), keys: unpack(r.data), device: r.device || null } : null;
}
/** 연결: 서버 저장을 받아 이 기기와 맞춤. replace = 이 기기 것은 버리고 서버 것으로 (다른 계정에서 바꿔 들어올 때) */
async function connectCore(acct, { replace = false } = {}) {
  const srv = await get(acct);
  let local = await snapshot();
  if (!srv) {
    // 서버 저장 없음 → 이 기기 진행이 이 계정 것 (처음 연결)
    const r = await put(acct, local, 0);
    if (r.ok) {
      linkSync(acct.id, r.version, local);
      return { ok: true, uploaded: true, changedLocal: false };
    }
    if (r.reason === 'conflict') return mergeAfterConflict(acct, local, r, { mode: 'first' });
    return { ok: false, error: r.reason || 'bad' };
  }
  if (replace) {
    await applyLocal(srv.keys);
    linkSync(acct.id, srv.version, srv.keys);
    return { ok: true, replaced: true, changedLocal: true };
  }
  const sync = readSync();
  const linked = sync.id === acct.id && owner() === acct.id && isObj(sync.hashes);
  if (linked && num(sync.version) === srv.version) return pushCore(acct, { linkedOnly: true });
  let merged;
  if (linked) merged = mergeSaves(local, srv.keys, { mode: 'three', base: sync });
  else if (isFresh(local)) merged = { ...srv.keys };
  else merged = mergeSaves(local, srv.keys, { mode: 'first' });
  const changedLocal = !sameKeys(merged, local);
  if (changedLocal) await applyLocal(merged);
  if (sameKeys(merged, srv.keys)) {
    linkSync(acct.id, srv.version, merged);
    return { ok: true, changedLocal, merged: linked ? 'three' : 'first' };
  }
  const r = await put(acct, merged, srv.version);
  if (r.ok) linkSync(acct.id, r.version, merged);
  else linkSync(acct.id, srv.version, srv.keys); // 다음 올리기가 다시 맞춤
  return { ok: !!r.ok, changedLocal, merged: linked ? 'three' : 'first', uploaded: !!r.ok };
}
async function mergeAfterConflict(acct, local, r, { mode }) {
  const srvKeys = r.data ? unpack(r.data) : null;
  if (!srvKeys) {
    // 서버에 줄이 없어짐 (계정 합치기 등) → 처음부터
    const r2 = await put(acct, local, 0);
    if (r2.ok) linkSync(acct.id, r2.version, local);
    return { ok: !!r2.ok, uploaded: !!r2.ok, changedLocal: false };
  }
  const sync = readSync();
  const merged = mode === 'three' ? mergeSaves(local, srvKeys, { mode: 'three', base: sync }) : isFresh(local) ? { ...srvKeys } : mergeSaves(local, srvKeys, { mode: 'first' });
  const changedLocal = !sameKeys(merged, local);
  if (changedLocal) await applyLocal(merged);
  if (sameKeys(merged, srvKeys)) {
    linkSync(acct.id, num(r.version), merged);
    return { ok: true, changedLocal, merged: mode, conflict: true };
  }
  const r2 = await put(acct, merged, num(r.version));
  if (r2.ok) linkSync(acct.id, r2.version, merged);
  else linkSync(acct.id, num(r.version), srvKeys);
  return { ok: !!r2.ok, changedLocal, merged: mode, conflict: true };
}
/** 바뀐 것 올리기 (연결 전이면 연결부터) */
async function pushCore(acct, opts = {}) {
  const sync = readSync();
  const linked = sync.id === acct.id && owner() === acct.id && isObj(sync.hashes);
  if (!linked) return opts.linkedOnly ? { ok: false, error: 'not linked' } : connectCore(acct);
  const local = await snapshot();
  if (sameHashes(hashes(local), sync.hashes)) return { ok: true, same: true };
  const r = await put(acct, local, num(sync.version));
  if (r.ok) {
    linkSync(acct.id, r.version, local);
    return { ok: true, uploaded: true, version: r.version };
  }
  if (r.reason === 'conflict') return mergeAfterConflict(acct, local, r, { mode: 'three' });
  if (r.reason === 'too_big') return { ok: false, tooBig: true };
  return { ok: false, error: r.reason || 'bad' };
}
/** 지금 바로 올리기 → { ok } | { missing } | { offline } | { error } */
export function pushNow(acct = account()) {
  if (!acct) return Promise.resolve({ ok: false, skip: true });
  return serialize(() => pushCore(acct).catch(fail));
}
/** 서버 저장 받아서 맞추기 (홈을 열 때) */
export function pull(acct = account()) {
  if (!acct) return Promise.resolve({ ok: false, skip: true });
  return serialize(() => connectCore(acct).catch(fail));
}
function schedule(delay = DEBOUNCE) {
  if (!account() || missingNow()) return;
  clearTimeout(timer);
  const wait = Math.max(delay, lastPut + MIN_GAP - Date.now());
  timer = setTimeout(() => pushNow(), wait);
}
/** 바뀐 게 있는지 (해시 비교만, 서버 안 부름) */
function changed() {
  const s = readSync();
  return !isObj(s.hashes) || !sameHashes(hashes(collect()), s.hashes);
}
function flushOnExit() {
  const acct = account();
  if (!acct || missingNow()) return;
  const sync = readSync();
  if (!(sync.id === acct.id && owner() === acct.id)) return;
  try {
    metaMod && metaMod.metaFlush && metaMod.metaFlush();
  } catch {}
  if (!changed()) return;
  try {
    // 받는 결과는 못 봄 → 다음에 열 때 버전이 다르면 서버 것과 다시 맞춤 (같은 내용이라 그대로 합쳐짐)
    api.rpc('gr_save_put', { p_id: acct.id, p_secret: acct.secret, p_data: pack(collect(), device()), p_base: num(sync.version), p_device: device() }, { keepalive: true }).catch(() => {});
  } catch {}
}

// ───────── 고스트: 계정마다 이 기기 안에 따로 보관 ─────────
function stashGhosts(id) {
  const keys = allKeys().filter((k) => keyKind(k) === 'ghost');
  if (!keys.length) return 0;
  const box = {};
  for (const k of keys) box[k] = sget(k);
  if (id) {
    let old = {};
    try {
      old = JSON.parse(sget(STASH + id) || '{}') || {};
    } catch {}
    sset(STASH + id, JSON.stringify({ ...old, ...box }));
  }
  for (const k of keys) sset(k, null);
  return keys.length;
}
function restoreGhosts(id) {
  if (!id) return 0;
  let box;
  try {
    box = JSON.parse(sget(STASH + id) || 'null');
  } catch {}
  if (!isObj(box)) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(box)) {
    if (keyKind(k) !== 'ghost' || typeof v !== 'string') continue;
    if (k === 'gimmick.ghost.index') {
      let a = [], b = [];
      try {
        a = JSON.parse(sget(k) || '[]') || [];
        b = JSON.parse(v) || [];
      } catch {}
      sset(k, JSON.stringify([...new Set([...b, ...a])]));
    } else if (sget(k) == null && sset(k, v)) n++;
  }
  sset(STASH + id, null);
  return n;
}
/** 이 기기를 계정 없는 처음 상태로 (기기 설정은 그대로). 고스트는 주인 몫으로 보관 */
function clearAccountData(ghostOwner) {
  stashGhosts(ghostOwner);
  for (const k of allKeys()) {
    const kind = keyKind(k);
    if (kind === 'account' || kind === 'local' || kind === 'ghost') sset(k, null);
  }
  sset(SYNC_KEY, null);
  sset(OWNER_KEY, null);
  try {
    for (const k of ['gimmick.olCache', 'gimmick.olStatusAt', 'gimmick.academy.exam']) sessionStorage.removeItem(k);
  } catch {}
}

// ───────── 로그인·로그아웃 (online.js가 부름) ─────────
const sameName = (a, b) => String(a || '').replace(/\s+/g, '').toLowerCase() === String(b || '').replace(/\s+/g, '').toLowerCase();
/** 이 기기 진행의 주인: 표시가 있으면 그것, 없으면 지금 비밀번호로 지킨 계정(예전 방식으로 그 계정으로 놀았음) */
function effectiveOwner(cur) {
  return owner() || (cur && cur.claimed ? cur.id : null);
}
/** gr_login 전: 다른 이름으로 바꿔 들어가려 하면 지금 진행을 지금 계정에 먼저 저장. 못 하면 예외 (reason 'save') */
export async function beforeLogin(cur, nick) {
  const prep = { owner: effectiveOwner(cur), cloud: !!(api && !off()) };
  if (!prep.cloud) return prep;
  if (prep.owner && cur && cur.claimed && prep.owner === cur.id && !sameName(cur.nick, nick)) {
    const r = await serialize(() => pushCore(cur).catch(fail));
    if (r.ok) prep.saved = true;
    else if (r.missing) prep.missing = true; // SQL 전 서버: 예전처럼 (진행은 이 기기에 그대로)
    else throw Object.assign(new Error(r.offline ? '지금 진행을 계정에 저장하지 못했어요 · 인터넷 연결 뒤 다시 해 주세요' : '지금 진행을 계정에 저장하지 못했어요 · 잠시 뒤 다시 해 주세요'), { reason: 'save' });
    try {
      await api.syncXp();
    } catch {}
  } else if (prep.owner && (!cur || prep.owner !== cur.id)) prep.orphan = true; // 주인 계정 열쇠가 없음 → 합치기로 (잃지 않게)
  return prep;
}
/** gr_login 뒤 (새 계정 열쇠는 이미 저장됨) → { switched, replaced, merged, uploaded, reload, missing } */
export async function afterLogin(acct, prep = {}) {
  if (!prep.cloud || off() || !acct || !acct.claimed) return {};
  if (prep.missing) return { missing: true };
  if (prep.owner && prep.owner !== acct.id && !prep.orphan) {
    // 다른 계정으로 바꿔 들어옴: 지금 진행은 이미 그 계정에 올렸음 → 이 기기를 비우고 새 계정 저장으로
    return serialize(async () => {
      clearAccountData(prep.owner);
      sset('gimmick.profile', JSON.stringify({ xp: 0, races: 0, wins: 0, podiums: 0, seeded: true })); // 이 기기 경험치는 새 계정 몫(gr_xp가 돌려줌)부터
      sset('gimmick.nick', acct.nick || null);
      restoreGhosts(acct.id);
      {
        // 메모리에 남은 예전 계정 메타가 새 계정 저장으로 쓰이지 않게 바로 다시 읽음 (빈 상태)
        const m = await loadMeta();
        try {
          m && m.metaReload && m.metaReload();
        } catch {}
      }
      let r;
      try {
        r = await connectCore(acct, { replace: true });
      } catch (err) {
        r = fail(err);
      }
      if (!r.ok) {
        // 서버 저장을 못 받음: 주인 표시 없이 둠 → 다음에 홈을 열 때 다시 받아 맞춤 (빈 진행으로 덮어쓰지 않음)
        sset(OWNER_KEY, null);
        sset(SYNC_KEY, null);
        const m = await loadMeta();
        try {
          m && m.metaReload && m.metaReload();
        } catch {}
      }
      return { switched: true, reload: true, ...r };
    });
  }
  const r = await pull(acct);
  restoreGhosts(acct.id);
  return { ...r, reload: !!r.changedLocal };
}
/** 로그아웃: 서버에 저장 → 성공하면 이 기기를 처음 상태로. → { ok } | { ok:false, message } */
export async function logout() {
  const acct = account();
  const cur = api && api.readId();
  if (acct) {
    const r = await pushNow(acct);
    if (!r.ok) {
      const message = r.missing ? '서버가 아직 계정 저장을 지원하지 않아요 · 지금 로그아웃하면 진행이 사라져서 막았어요'
        : r.offline ? '계정에 저장하지 못했어요 · 인터넷 연결 뒤 다시 해 주세요'
        : r.tooBig ? '저장할 진행이 너무 커서 올리지 못했어요 · 로그아웃을 막았어요'
        : '계정에 저장하지 못했어요 · 잠시 뒤 다시 해 주세요';
      return { ok: false, ...r, message };
    }
    try {
      await api.syncXp();
    } catch {}
  } else if (cur) return { ok: false, message: '비밀번호를 정한 계정만 로그아웃할 수 있어요' };
  else return { ok: false, message: '로그인한 계정이 없어요' };
  clearAccountData(acct.id);
  try {
    api.clearId();
  } catch {}
  const m = await loadMeta();
  try {
    m && m.metaReload && m.metaReload(); // 닫힐 때 메타가 예전 진행을 다시 쓰지 않게
  } catch {}
  toastNext('👋 로그아웃했어요 · 진행은 계정에 저장돼 있어요');
  return { ok: true };
}
/** 화면용 상태 */
export function status() {
  const acct = account(), s = readSync();
  return { on: !!acct, linked: !!acct && s.id === acct.id && owner() === acct.id, missing: missingNow(), version: num(s.version), at: s.at || 0, pending: !!acct && changed() };
}
/** 새로 고침 뒤 한 번 띄울 알림 */
export function toastNext(text) {
  try {
    sessionStorage.setItem(TOAST_KEY, text);
  } catch {}
}
function showToast() {
  let t = null;
  try {
    t = sessionStorage.getItem(TOAST_KEY);
    sessionStorage.removeItem(TOAST_KEY);
  } catch {}
  if (!t || typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'cs-toast';
  el.setAttribute('role', 'status');
  el.textContent = t;
  el.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:90;max-width:calc(100vw - 32px);padding:10px 18px;border-radius:999px;background:rgba(12,18,32,.92);border:1px solid rgba(126,240,224,.45);color:#fff;font:700 14px/1.35 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);pointer-events:none;text-align:center;transition:opacity .4s';
  document.body.appendChild(el);
  setTimeout(() => (el.style.opacity = '0'), 3600);
  setTimeout(() => el.remove(), 4200);
}
const isHome = () => {
  try {
    const q = new URLSearchParams(location.search);
    return !q.get('map') && !q.get('join');
  } catch {
    return false;
  }
};
async function homePull() {
  const acct = account();
  if (!acct || missingNow()) return;
  const r = await pull(acct);
  if (!r.ok || !r.changedLocal) return;
  // 다른 기기에서 바뀐 진행을 받음 → 화면을 새로 (같은 페이지에서 20초 안에 두 번은 안 함, 창이 떠 있으면 미룸)
  let last = 0;
  try {
    last = num(sessionStorage.getItem('gimmick.cloudReloadAt'));
  } catch {}
  if (Date.now() - last < 20000) return;
  const busy = () => document.querySelector('.gm-confirm, .nf, .coach-on') || document.getElementById('home')?.classList.contains('nf-active');
  const go = () => {
    try {
      sessionStorage.setItem('gimmick.cloudReloadAt', String(Date.now()));
    } catch {}
    toastNext('☁ 다른 기기의 진행을 받았어요');
    location.reload();
  };
  if (!busy()) go();
}
/** online.js가 한 번 연결 */
export function attach(o) {
  api = o;
  if (booted || typeof window === 'undefined' || typeof document === 'undefined' || typeof setInterval !== 'function' || typeof document.addEventListener !== 'function') return; // 시험 VM 등
  booted = true;
  const kick = () => schedule();
  for (const ev of ['gimmick:meta', 'gimmick:wallet', 'gimmick:partLv', 'gimmick:parts', 'gimmick:raceDone', 'gimmick:academy', 'gimmick:gate', 'gimmick:costume', 'gimmick:metaFinish', 'gimmick:xp']) window.addEventListener(ev, kick);
  window.addEventListener('online', kick);
  window.addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && account() && changed()) pushNow();
  });
  setInterval(() => {
    if (account() && !missingNow() && changed()) schedule(0);
  }, 30000);
  const start = () => {
    showToast();
    loadMeta();
    setTimeout(() => (isHome() ? homePull() : account() && changed() && schedule()), 1200);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

export const cloudSave = { attach, pushNow, pull, beforeLogin, afterLogin, logout, status, keyKind, collect, mergeSaves, toastNext };
