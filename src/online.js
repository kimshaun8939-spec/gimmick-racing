// 온라인 순위표 (사용자 요청 2026-11-10 "닉네임 온라인 순위표", 로그인 없음)
//
//   - 이름 + 비밀번호 4자리 = 한 계정 (사용자 요청 2026-11-12, 서버 .debug/supabase_v2_names.sql):
//     홈 이름 창에서 비밀번호를 넣으면 login() → 처음 쓰는 이름이면 내 것이 되고, 이미 있는 이름이면 비밀번호가 맞을 때
//     그 계정으로 이어 함 (이 기기의 예전 비밀번호 없는 계정 기록은 서버가 합침). 기기마다 자기 열쇠를 받음
//     → localStorage 'gimmick.online' = { id, secret, nick, claimed }
//   - 계정이 없으면 기록을 안 올림 ({ needLogin }). 예전에 비밀번호 없이 만든 계정은 그대로 올림 (claimed: false)
//   - 완주하면 자동으로 올림 (내 예전 온라인 기록보다 빠를 때만 서버가 바꿈, 고스트도 같이)
//   - "내 코드" = id + 비밀 열쇠. 다른 컴퓨터·브라우저에서 코드를 넣으면 같은 사람으로 이어서 올림
//   - 순위표: 맵마다 사람별 가장 빠른 기록 (어느 차든) / 이 차만
//   - 서버 = Supabase (설정 .debug/supabase_setup.sql, 주소·열쇠 src/onlineConfig.js). 비어 있으면 enabled = false
//   테스트: window.__onlineFake = (fn, body) => 결과 로 서버 대신 가짜 응답을 쓸 수 있음
import { ONLINE_URL, ONLINE_KEY } from './onlineConfig.js';
import { packVerified, unpackGhost } from './ghostPack.js';
import * as cloudSave from './cloudSave.js'; // 계정 클라우드 저장 (2026-11-15, 서버 .debug/supabase_v6_save.sql)
// 코스 버전 (mapver, 2026-11-24): 서버 map 칸 = recKey(맵) (코스가 바뀐 맵 'glacier@2', ver 1 맵은 맵 id 그대로).
//   서버 SQL은 그대로 (map은 1~24글자 아무 글자). 예전 코스 기록은 서버 'glacier' 줄로 남고 순위표·고스트에는 안 나옴
import { recKey } from './mapVer.js';

// 부품 조립 (2026-11-15, 부품 조립 1차 ⑤, 서버 SQL .debug/supabase_v5_parts.sql):
//   - 올릴 때 조립 표시 문자열(build sig, 예 'g1.t2' / 'stock')을 같이 보냄 (gr_submit p_build)
//   - 순위표 줄마다 build (예전 기록·SQL 전 서버 = 'stock'), '순정만' 보기 = board(map, car, limit, { stockOnly: true })
//   - 서버에 아직 SQL이 없으면: 예전 gr_submit(9개 인자)로 build 없이 올리고, 예전 조회로 읽음 (모두 'stock'으로 보임, 오류 없음)
//   - copyBuildFrom(carId, sig) = '이 조립 따라 하기' (내가 가진 부품만, 없는 부품은 순정 칸)
export const STOCK_SIG = 'stock';
const SIG_RE = /^[a-z][0-9]{1,2}(\.[a-z][0-9]{1,2}){0,9}$/;
/** 서버·고스트에서 받은 조립 표시를 정리 (모르는 모양·빈 값 = 'stock') */
export function cleanSig(sig) {
  const t = typeof sig === 'string' ? sig.trim() : '';
  return t && t !== STOCK_SIG && SIG_RE.test(t) ? t : STOCK_SIG;
}
let buildRpcMissing = false; // gr_submit에 p_build가 없는 서버 (SQL v5 전) → 이 페이지에서는 다시 안 보냄
const buildBoardMissing = new Set(); // build 칸·순정 보기가 없는 표
function missingBuildSchema(err) {
  const message = [err.message, err.details, err.hint].filter(Boolean).join(' ');
  return /build|stock_|ghost_ok|leaderboard_stock|records_stock/i.test(message) &&
    (/^(42703|42P01|PGRST100|PGRST204|PGRST205)$/.test(err.code || '') ||
      /does not exist|could not find|schema cache|unknown (column|table)|failed to parse/i.test(message));
}
function missingSubmitBuild(err) {
  const message = [err.message, err.details, err.hint].filter(Boolean).join(' ');
  return /^(PGRST202|PGRST203|42883)$/.test(err.code || '') ||
    (/gr_submit|p_build/i.test(message) && /does not exist|could not find|schema cache|unknown function/i.test(message));
}

// 무료 한도 아끼기 (2026-11-14):
//   - 고스트는 올리기 전에 줄임 (ghostPack.js v 3, 약 110 KB → 12~15 KB). 받을 때 v 3이면 풀고, 예전 v 2는 그대로 읽음
//     주소에 &ghostzip=0 이면 예전처럼 줄이지 않고 올림
//   - 순위표 응답은 90초 동안 기억 (메모리 + sessionStorage 'gimmick.olCache') → 메뉴를 오가도 다시 안 받음
//     내 기록을 올리거나 로그인·이름 바꾸기를 하면 지움 (새 순위가 바로 보이게). &olcache=0 이면 기억 안 함
const qflag = (k) => {
  try {
    return new URLSearchParams(location.search).get(k);
  } catch {
    return null;
  }
};
const BOARD_TTL = 90e3;
const CACHE_KEY = 'gimmick.olCache';
const boardMem = new Map(); // key → { at, rows }
const boardFlight = new Map(); // key → Promise (같은 순위표를 동시에 두 번 받지 않게)
const cacheOff = () => qflag('olcache') === '0';
function cacheRead(key) {
  if (cacheOff()) return null;
  const now = Date.now();
  let e = boardMem.get(key);
  if (!e) {
    try {
      const all = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
      e = all[key];
      if (e) boardMem.set(key, e);
    } catch {}
  }
  return e && now - e.at < BOARD_TTL && now >= e.at ? e.rows : null;
}
function cacheWrite(key, rows) {
  if (cacheOff()) return;
  const e = { at: Date.now(), rows };
  boardMem.set(key, e);
  try {
    const all = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}');
    all[key] = e;
    for (const k of Object.keys(all)) if (e.at - all[k].at > BOARD_TTL) delete all[k];
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {}
}
/** 순위표 기억 지우기 (내 기록을 올린 뒤 등) */
export function clearBoardCache() {
  boardMem.clear();
  boardFlight.clear();
  try {
    sessionStorage.removeItem(CACHE_KEY);
    sessionStorage.removeItem('gimmick.olStatusAt');
  } catch {}
}

const ID_KEY = 'gimmick.online';
const DEVICE_KEY = 'gimmick.device'; // 이 브라우저 id (경험치를 기기마다 따로 올림)
const NET_KEY = 'gimmick.profileNet'; // 같은 계정 다른 기기들 경험치 합 (profile.js가 더해서 레벨을 보여 줌)
function deviceId() {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d || d.length < 8) {
      const a = new Uint8Array(12);
      crypto.getRandomValues(a);
      d = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DEVICE_KEY, d);
    }
    return d;
  } catch {
    return null;
  }
}
function localProfile() {
  try {
    const j = JSON.parse(localStorage.getItem('gimmick.profile') || 'null');
    if (j && typeof j.xp === 'number') return { xp: Math.max(0, Math.floor(j.xp) - Math.max(0, Number(j._adminBoost?.xp) || 0)), races: j.races || 0, wins: j.wins || 0, podiums: j.podiums || 0 };
  } catch {}
  return null;
}
const NICK_KEY = 'gimmick.nick';
const TIMEOUT = 12000;

function readId() {
  try {
    const j = JSON.parse(localStorage.getItem(ID_KEY) || 'null');
    return j && j.id && j.secret ? j : null;
  } catch {
    return null;
  }
}
function writeId(v) {
  try {
    if (v) localStorage.setItem(ID_KEY, JSON.stringify(v));
    else localStorage.removeItem(ID_KEY);
  } catch {}
}
function localNick() {
  try {
    return (localStorage.getItem(NICK_KEY) || '').trim();
  } catch {
    return '';
  }
}
function randomSecret() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
const fake = () => (typeof window !== 'undefined' && window.__onlineFake) || null;

function headers() {
  const h = { apikey: ONLINE_KEY, 'Content-Type': 'application/json' };
  if (ONLINE_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${ONLINE_KEY}`; // 예전 방식(anon JWT) 열쇠
  return h;
}
async function call(path, opts = {}) {
  // 인터넷이 없다고 브라우저가 이미 알면 요청을 안 보냄 (콘솔에 '연결 실패'가 안 쌓이게, 2026-11-14). 부르는 쪽은 예전처럼 오류로 받아 조용히 넘어감
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Object.assign(new Error('인터넷 연결 없음'), { offline: true });
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${ONLINE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...opts, headers: { ...headers(), ...(opts.headers || {}) }, signal: ctl.signal });
    if (opts.keepalive) return null; // 페이지를 닫는 중 (계정 저장): 결과는 안 봄
    const txt = await res.text();
    const data = txt ? JSON.parse(txt) : null;
    if (!res.ok) throw Object.assign(new Error((data && (data.message || data.hint)) || `서버 오류 ${res.status}`), { code: data && data.code, details: data && data.details, hint: data && data.hint, status: res.status });
    return data;
  } finally {
    clearTimeout(tm);
  }
}
async function rpc(fn, body, opts = {}) {
  const f = fake();
  if (f) return f(fn, body);
  return call(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body), ...(opts.keepalive ? { keepalive: true } : {}) });
}
async function select(table, query) {
  const f = fake();
  if (f) return f(table, query);
  return call(`${table}?${query}`);
}

/** 내 기록을 올릴 사람 정보. 아직 이름+비밀번호로 시작하지 않았으면 null */
async function ensure() {
  let me = readId();
  if (me) {
    // 홈에서 이름을 바꿨으면 서버 이름도 바꿈
    const n = localNick();
    if (n && n !== me.nick) {
      try {
        if (await rpc('gr_rename', { p_id: me.id, p_secret: me.secret, p_nick: n })) {
          me = { ...me, nick: n };
          writeId(me);
          clearBoardCache();
        }
      } catch {}
    }
    return me;
  }
  return null;
}
const sameName = (a, b) => String(a || '').replace(/\s+/g, '').toLowerCase() === String(b || '').replace(/\s+/g, '').toLowerCase();

const LICENSE_LEVELS = ['C', 'B', 'A', 'S'];
let licenseRpcMissing = false; // SQL이 없으면 이 페이지를 새로 열 때까지 다시 보내지 않음
const licenseBoardMissing = new Set();
const validLicense = (level) => LICENSE_LEVELS.includes(level) ? level : null;
function missingLicenseSchema(err) {
  const message = [err.message, err.details, err.hint].filter(Boolean).join(' ');
  return /license|records_with_license/i.test(message) &&
    (/^(42703|42P01|PGRST204|PGRST205)$/.test(err.code || '') ||
      /does not exist|could not find|schema cache|unknown (column|table)/i.test(message));
}

/** 최고 라이선스를 전송 → 서버의 현재 등급 또는 null. 계정·서버 함수가 없으면 조용히 건너뜀. */
export async function setLicense(level) {
  const m = readId();
  if (!validLicense(level) || !m || !online.enabled || licenseRpcMissing) return null;
  try {
    return validLicense(await rpc('gr_set_license', { p_id: m.id, p_secret: m.secret, p_license: level }));
  } catch (err) {
    const message = [err.message, err.details, err.hint].filter(Boolean).join(' ');
    if (/^(PGRST202|42883)$/.test(err.code || '') ||
        (/gr_set_license/i.test(message) && /does not exist|could not find|schema cache|unknown function/i.test(message))) {
      licenseRpcMissing = true;
    }
    return null;
  }
}

export const online = {
  setLicense,
  clearBoardCache,
  get enabled() {
    return !!fake() || !!(ONLINE_URL && ONLINE_KEY);
  },
  /** 내 정보 { id, nick, claimed(비밀번호로 지킨 이름인지) } (아직 없으면 null) */
  me() {
    const m = readId();
    return m ? { id: m.id, nick: m.nick, claimed: !!m.claimed } : null;
  },
  /** 지금 이 기기 계정이 이 이름으로 비밀번호까지 정해져 있는지 (이름 창에서 비밀번호 칸을 비워도 되는지) */
  isMine(nick) {
    const m = readId();
    return !!(m && m.claimed && sameName(m.nick, nick));
  },
  /**
   * 이름 + 비밀번호 4자리로 시작 / 다른 기기에서 이어 하기
   * → { nick, created(새 계정), merged(합친 기록 수), claimed(이 기기 예전 계정에 이름을 붙임) }. 틀리면 예외 (err.reason = 'pin' | 'locked' | 'bad')
   */
  async login(nick, pin) {
    if (!this.enabled) throw new Error('온라인이 꺼져 있어요');
    nick = String(nick || '').trim();
    pin = String(pin || '').trim();
    if (!nick) throw Object.assign(new Error('이름을 넣어 주세요'), { reason: 'bad' });
    if (!/^[0-9]{4}$/.test(pin)) throw Object.assign(new Error('비밀번호는 숫자 4자리예요'), { reason: 'bad' });
    const cur = readId();
    // 계정 저장: 다른 이름으로 바꿔 들어가면 지금 진행을 지금 계정에 먼저 저장 (못 하면 여기서 멈춤 = 진행을 잃지 않음)
    const prep = await cloudSave.beforeLogin(cur, nick);
    const secret = randomSecret();
    // 비밀번호로 지킨 계정에서 다른 이름을 넣으면 = 다른 계정으로 들어가기 (없는 이름이면 새 계정). 예전처럼 지금 계정 이름을 바꾸지 않음
    //   (이름만 바꾸기는 비밀번호를 비우고 rename). 비밀번호 없는 예전 계정은 예전처럼 넘겨서 서버가 합치거나 이름을 붙임
    const other = !!(cur && cur.claimed && !sameName(cur.nick, nick));
    const r = await rpc('gr_login', { p_nick: nick, p_pin: pin, p_secret: secret, p_id: cur && !other ? cur.id : null, p_cur: cur && !other ? cur.secret : null });
    if (!r || !r.ok) {
      const reason = (r && r.reason) || 'bad';
      const msg = reason === 'pin' ? '이미 있는 이름이에요 · 비밀번호가 달라요'
        : reason === 'locked' ? `비밀번호를 여러 번 틀려서 잠겼어요 · ${Math.ceil((r.wait || 1800) / 60)}분 뒤에 다시 해 주세요`
        : '이름이나 비밀번호를 확인해 주세요';
      throw Object.assign(new Error(msg), { reason });
    }
    writeId({ id: r.id, secret, nick: r.nick, claimed: true });
    clearBoardCache(); // 합친 기록·이름이 순위표에 바로 보이게
    try {
      localStorage.setItem(NICK_KEY, r.nick);
    } catch {}
    // 계정 저장 받기: 같은 계정·처음 연결이면 합치고, 다른 계정에서 바꿔 들어왔으면 이 계정 진행으로 바꿈
    let cloud = {};
    try {
      cloud = (await cloudSave.afterLogin({ id: r.id, secret, nick: r.nick, claimed: true }, prep)) || {};
    } catch {}
    await this.syncXp();
    return { nick: r.nick, created: !!r.created, merged: r.merged || 0, claimed: !!r.claimed, cloud, reload: !!cloud.reload, switched: !!cloud.switched };
  },
  /**
   * 레벨 합치기: 이 기기 경험치를 서버에 올리고 같은 계정 다른 기기들의 합을 받아 둠 → { others, total, devices } 또는 null
   *   (계정이 없거나 서버에 gr_xp가 없으면 null, 레벨은 이 기기 값만으로 보임)
   */
  async syncXp() {
    const m = readId();
    const p = localProfile() || { xp: 0, races: 0, wins: 0, podiums: 0 }; // 로그아웃·계정 바꾸기 뒤 아직 프로필이 없으면 0부터
    const dev = deviceId();
    if (!m || !dev || !this.enabled) return null;
    try {
      const r = await rpc('gr_xp', { p_id: m.id, p_secret: m.secret, p_device: dev, p_xp: p.xp, p_races: p.races, p_wins: p.wins, p_podiums: p.podiums });
      if (!r || !r.others) return null;
      // 이 기기 몫 = 합 − 다른 기기들. 로그아웃·계정 바꾸기로 이 기기 경험치를 비웠으면 서버에 남은 이 기기 몫으로 되돌림
      try {
        if (r.total) {
          const row = { xp: (+r.total.xp || 0) - (+r.others.xp || 0), races: (+r.total.races || 0) - (+r.others.races || 0), wins: (+r.total.wins || 0) - (+r.others.wins || 0), podiums: (+r.total.podiums || 0) - (+r.others.podiums || 0) };
          const raw = JSON.parse(localStorage.getItem('gimmick.profile') || 'null') || { xp: 0, races: 0, wins: 0, podiums: 0, seeded: true };
          const boost = Math.max(0, Number(raw._adminBoost?.xp) || 0);
          if (row.xp > p.xp || row.races > p.races) {
            localStorage.setItem('gimmick.profile', JSON.stringify({ ...raw, xp: Math.max(p.xp, row.xp) + boost, races: Math.max(p.races, row.races), wins: Math.max(p.wins, row.wins), podiums: Math.max(p.podiums, row.podiums), seeded: true }));
          }
        }
      } catch {}
      try {
        localStorage.setItem(NET_KEY, JSON.stringify({ id: m.id, ...r.others, devices: r.devices || 1, at: Date.now() }));
      } catch {}
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gimmick:xpnet', { detail: r }));
      return r;
    } catch (err) {
      if (/unknown player/.test(err.message || '')) writeId(null);
      return null;
    }
  },
  /** 이 기기 계정 이름 바꾸기 (계정이 없으면 true = 할 일 없음). 남이 비밀번호로 지킨 이름이면 false */
  async rename(nick) {
    const m = readId();
    if (!m || !this.enabled) return true;
    if (m.nick === nick) return true;
    const ok = await rpc('gr_rename', { p_id: m.id, p_secret: m.secret, p_nick: nick });
    if (ok) {
      writeId({ ...m, nick });
      clearBoardCache();
    }
    return !!ok;
  },
  /** 서버에서 내 계정 상태 다시 확인 (다른 기기에서 합쳐져 없어졌으면 지움) → me() */
  async refresh() {
    const m = readId();
    if (!m || !this.enabled) return this.me();
    // 기록 화면을 열 때마다 묻지 않게: 같은 계정은 90초에 한 번만 (&olcache=0 이면 매번)
    const SK = 'gimmick.olStatusAt';
    try {
      const last = JSON.parse(sessionStorage.getItem(SK) || 'null');
      if (!cacheOff() && last && last.id === m.id && Date.now() - last.at < BOARD_TTL && Date.now() >= last.at) return this.me();
      sessionStorage.setItem(SK, JSON.stringify({ id: m.id, at: Date.now() }));
    } catch {}
    try {
      const r = await rpc('gr_status', { p_id: m.id, p_secret: m.secret });
      if (!r) writeId(null);
      else writeId({ ...m, nick: r.nick, claimed: !!r.claimed });
    } catch {}
    return this.me();
  },
  /**
   * 완주 기록 올리기 → { saved, best, rank, players } (서버가 더 빠를 때만 바꿈)
   * run = { map, car, total, laps:[...], bestLap, assist, ghost(문자열 JSON 또는 null) }
   */
  async submit(run) {
    if (!this.enabled) return null;
    const me = await ensure();
    if (!me) return { needLogin: true, needNick: true };
    // 고스트 줄이기 (v 3). 실패하면 예전 모양 그대로 올림
    let ghostTxt = run.ghost || null;
    if (ghostTxt && qflag('ghostzip') !== '0') {
      try {
        ghostTxt = await packVerified(ghostTxt);
      } catch (err) {
        console.warn('고스트 줄이기 실패 · 그대로 올려요', err);
        ghostTxt = run.ghost;
      }
    }
    let r;
    const build = cleanSig(run.build);
    try {
      const body = {
        p_id: me.id, p_secret: me.secret, p_map: recKey(run.map), p_car: run.car,
        p_total: +run.total.toFixed(3), p_laps: run.laps.map((x) => +x.toFixed(3)),
        p_best_lap: run.bestLap ? +run.bestLap.toFixed(3) : null, p_assist: !!run.assist, p_ghost: ghostTxt,
      };
      if (!buildRpcMissing) {
        try {
          r = await rpc('gr_submit', { ...body, p_build: build });
        } catch (err) {
          if (!missingSubmitBuild(err)) throw err;
          buildRpcMissing = true; // SQL v5 전 서버 → 예전 방식으로
        }
      }
      if (r === undefined) {
        r = await rpc('gr_submit', body);
        if (r && typeof r === 'object') r = { ...r, buildSaved: false }; // 서버가 조립 표시를 모름 (순정으로 보임)
      }
      if (r && typeof r === 'object' && r.buildSaved === undefined) r = { ...r, buildSaved: true, build: cleanSig(r.build ?? build) };
    } catch (err) {
      // 다른 기기에서 이 계정이 합쳐져 없어졌으면: 이 기기는 다시 이름+비밀번호로
      if (/unknown player/.test(err.message || '')) {
        writeId(null);
        return { needLogin: true };
      }
      throw err;
    } finally {
      clearBoardCache(); // 새 순위가 홈에서 바로 보이게
    }
    return r;
  },
  /**
   * 순위표: 맵 전체(사람마다 가장 빠른 기록 하나) 또는 car를 주면 그 차만. 빠른 순서
   *   opts.stockOnly = '순정만' (부품을 안 끼운 기록만, 사람·차마다 가장 빠른 순정 기록)
   *   줄 = { player_id, nickname, car, total, best_lap, assist, license, build('stock' | 'g1.t2'…), stock, ghostOk }
   *   ghostOk = 서버 고스트가 이 줄 기록의 것 ('순정만'에서 그 사람의 가장 빠른 기록이 조립 기록이면 false → 👻 숨김)
   */
  async board(mapId, car = null, limit = 50, opts = {}) {
    if (!this.enabled) return [];
    const map = recKey(mapId);
    const stockOnly = !!(opts && opts.stockOnly);
    // 기억해 둔 순위표 (같은 맵·차, 더 긴 목록을 받아 둔 것도 앞부분만 잘라 씀)
    const key = (fake() ? 'fake|' : '') + map + '|' + (car || '') + (stockOnly ? '|stock' : '');
    const kL = key + '|' + limit;
    for (const L of [limit, 50, 100]) {
      if (L < limit) continue;
      const rows = cacheRead(key + '|' + L);
      if (rows) return rows.slice(0, limit);
    }
    // 같은 순위표(또는 더 긴 목록)를 이미 받는 중이면 그것을 기다림 (홈이 1~3등과 50등을 동시에 부를 때)
    for (const L of [limit, 50, 100]) {
      if (L < limit || !boardFlight.has(key + '|' + L)) continue;
      return (await boardFlight.get(key + '|' + L)).slice(0, limit);
    }
    const p = this._board(map, car, limit, stockOnly).then((rows) => {
      cacheWrite(kL, rows);
      return rows;
    });
    boardFlight.set(kL, p);
    try {
      return await p;
    } finally {
      if (boardFlight.get(kL) === p) boardFlight.delete(kL);
    }
  },
  /** board(map, { car, limit, stockOnly }) 모양으로도 부를 수 있게 (홈 순위표용) */
  leaderboard(map, opts = {}) {
    return this.board(map, opts.car || null, opts.limit || 50, { stockOnly: !!opts.stockOnly });
  },
  /** 순위표를 서버에서 받기 (기억 안 함). 고스트·바퀴별 기록은 안 받음 (화면에 쓰는 칸만) */
  async _board(mapId, car, limit, stockOnly = false) {
    const map = recKey(mapId);
    const fields = 'player_id,nickname,car,total,best_lap,assist';
    const filters = '&map=eq.' + encodeURIComponent(map) +
      (car ? '&car=eq.' + encodeURIComponent(car) : '') + '&order=total.asc&limit=' + limit;
    const fix = (row) => {
      const build = cleanSig(row.build);
      const { ghost_ok, ...rest } = row;
      return { ...rest, license: validLicense(row.license), build, stock: build === STOCK_SIG, ghostOk: ghost_ok === undefined || ghost_ok === null ? true : !!ghost_ok };
    };
    // SQL v5 서버: build 칸 + 순정 보기 (records_stock / leaderboard_stock)
    const table5 = stockOnly ? (car ? 'records_stock' : 'leaderboard_stock') : car ? 'records_with_license' : 'leaderboard';
    if (!buildBoardMissing.has(table5) && !licenseBoardMissing.has(table5)) {
      try {
        const rows = await select(table5, 'select=' + fields + ',license,build' + (stockOnly ? ',ghost_ok' : '') + filters);
        return (rows || []).map(fix);
      } catch (err) {
        if (!missingBuildSchema(err) && !missingLicenseSchema(err)) throw err;
        buildBoardMissing.add(table5);
      }
    }
    // SQL v5 전 서버: 조립 표시가 없음 = 모든 기록이 순정 → '순정만'도 같은 목록
    const table = car ? 'records_with_license' : 'leaderboard';
    let rows;
    if (!licenseBoardMissing.has(table)) {
      try {
        rows = await select(table, 'select=' + fields + ',license' + filters);
      } catch (err) {
        if (!missingLicenseSchema(err)) throw err;
        licenseBoardMissing.add(table);
      }
    }
    // SQL 적용 전 서버: 원래 조회로 되돌리고 배지는 null로 맞춤.
    if (rows === undefined) rows = await select(car ? 'records' : 'leaderboard', 'select=' + fields + filters);
    return (rows || []).map((row) => fix({ ...row, build: STOCK_SIG }));
  },
  /** 서버가 조립 표시(SQL v5)를 모른다고 확인됐으면 false, 아니면 true (화면에서 '순정만' 안내를 다르게 할 때) */
  get buildAware() {
    return !(buildRpcMissing || buildBoardMissing.size);
  },
  cleanSig,
  /** 조립 표시 → { sig, stock, chips, summary, short } (칩·요약은 parts.js에서, 못 읽으면 칩 없이) */
  async buildInfo(sig) {
    const s = cleanSig(sig);
    if (s === STOCK_SIG) return { sig: s, stock: true, chips: [], summary: '순정', short: '순정' };
    try {
      const P = await import('./parts.js');
      return { sig: s, stock: false, chips: P.buildChips(s), summary: P.buildSummary(s), short: P.buildSummary(s, { short: true }) };
    } catch {
      return { sig: s, stock: false, chips: [], summary: s, short: s };
    }
  },
  /**
   * '이 조립 따라 하기': 순위표·친구 고스트의 조립을 내 차(carId)에 끼움 — 내가 가진 부품만, 없는 부품은 순정 칸
   * → { ok, sig(끼운 결과), wanted(원래 조립), same(원래와 똑같이 됨), missing: [{ slot, partId, name, short }], message? }
   */
  async copyBuildFrom(carId, sig) {
    const wanted = cleanSig(sig);
    let P;
    try {
      P = await import('./parts.js');
    } catch (err) {
      return { ok: false, sig: STOCK_SIG, wanted, same: false, missing: [], message: '부품 정보를 못 읽었어요' };
    }
    const want = P.parseSig(wanted);
    const fit = P.fitBuild(want);
    const missing = P.buildChips(want).filter((c) => fit[c.slot] !== c.partId).map((c) => ({ slot: c.slot, partId: c.partId, name: c.name, short: c.short }));
    const r = P.setBuild(carId, fit);
    if (!r || !r.ok) return { ok: false, sig: STOCK_SIG, wanted, same: false, missing, message: (r && r.message) || '저장하지 못했어요' };
    // 강화 단계 (2026-11-15): 부품만 따라 하고 단계는 내 것 → same은 부품 기준, levels = 단계가 다른 칸 (화면 토스트용)
    const pSig = (x) => (P.partsSig ? P.partsSig(x) : P.buildSig(x));
    const wantLv = P.parseSigLevels ? P.parseSigLevels(wanted) : {};
    const levels = P.buildChips ? P.buildChips(r.build).map((c) => ({ slot: c.slot, partId: c.partId, name: c.name, short: c.short, wantLv: wantLv[c.partId] || 1, myLv: c.lv || 1 })).filter((x) => x.wantLv !== x.myLv) : [];
    return { ok: true, sig: r.sig, wanted, same: pSig(r.build) === pSig(want), missing, levels };
  },
  /** 다른 사람(또는 나)의 고스트 (예전 v 2 JSON 문자열 또는 v 3을 푼 v 2 객체, 없으면 null). 👻 같이 달리기를 누를 때만 받음 */
  async ghost(mapId, car, playerId) {
    if (!this.enabled) return null;
    const map = recKey(mapId);
    const rows = await select('ghosts', `select=data&map=eq.${encodeURIComponent(map)}&car=eq.${encodeURIComponent(car)}&player_id=eq.${encodeURIComponent(playerId)}&limit=1`);
    if (!rows || !rows[0] || !rows[0].data) return null;
    // v 3(줄인 고스트)은 풀어서 ghost.js가 읽는 v 2 객체로, 예전 v 2 문자열은 그대로
    const raw = rows[0].data;
    if (typeof raw !== 'string' || !/"v"\s*:\s*3[,}]/.test(raw.slice(0, 40))) return raw;
    return unpackGhost(raw);
  },
  /** 내 코드 (다른 기기에서 이어 하기). 아직 등록 전이면 null */
  myCode() {
    const m = readId();
    return m ? `GR-${m.id}-${m.secret}` : null;
  },
  /** 다른 기기의 코드 넣기 → 닉네임 (틀리면 예외) */
  async useCode(code) {
    const m = String(code || '').trim().match(/^GR-([0-9a-f-]{36})-([0-9a-f]{20,})$/i);
    if (!m) throw new Error('코드 모양이 달라요');
    const nick = await rpc('gr_whoami', { p_id: m[1], p_secret: m[2] });
    if (!nick) throw new Error('맞는 코드가 아니에요');
    writeId({ id: m[1], secret: m[2], nick, claimed: false });
    clearBoardCache();
    this.refresh();
    try {
      localStorage.setItem(NICK_KEY, nick);
    } catch {}
    return nick;
  },
  /** 이 브라우저에서 온라인 정보 지우기 (서버 기록은 남음) */
  forget() {
    writeId(null);
  },
  /**
   * 로그아웃 (2026-11-15): 지금 진행을 계정에 저장 → 성공하면 이 기기를 처음 상태로(기기 설정은 남김)
   *   → { ok: true } (부른 쪽이 홈을 새로 엶) | { ok: false, message } (저장 실패 = 아무것도 안 지움)
   */
  async logout() {
    const r = await cloudSave.logout();
    if (r.ok) clearBoardCache();
    return r;
  },
  /** 계정 저장 상태 { on, linked, missing, version, at, pending } */
  cloudStatus() {
    return cloudSave.status();
  },
  /** 지금 바로 계정 저장 올리기 */
  cloudPush() {
    return cloudSave.pushNow();
  },
};

cloudSave.attach({
  rpc,
  readId,
  enabled: () => online.enabled,
  syncXp: () => online.syncXp(),
  clearId: () => {
    writeId(null);
    try {
      sessionStorage.removeItem('gimmick.olStatusAt');
    } catch {}
  },
});

// 완주해서 경험치를 받으면(profile.js 'gimmick:xp') 계정 경험치도 올림
if (typeof window !== 'undefined' && !window.__gimmickXpSync) {
  window.__gimmickXpSync = true;
  window.addEventListener('gimmick:xp', () => {
    online.syncXp();
  });
}
