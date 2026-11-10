// 온라인 순위표 (사용자 요청 2026-11-10 "닉네임 온라인 순위표", 로그인 없음)
//
//   - 처음 기록을 올릴 때 서버에 등록: 닉네임(홈의 이름 'gimmick.nick') + 브라우저가 만든 비밀 열쇠
//     → localStorage 'gimmick.online' = { id, secret, nick }
//   - 완주하면 자동으로 올림 (내 예전 온라인 기록보다 빠를 때만 서버가 바꿈, 고스트도 같이)
//   - "내 코드" = id + 비밀 열쇠. 다른 컴퓨터·브라우저에서 코드를 넣으면 같은 사람으로 이어서 올림
//   - 순위표: 맵마다 사람별 가장 빠른 기록 (어느 차든) / 이 차만
//   - 서버 = Supabase (설정 .debug/supabase_setup.sql, 주소·열쇠 src/onlineConfig.js). 비어 있으면 enabled = false
//   테스트: window.__onlineFake = (fn, body) => 결과 로 서버 대신 가짜 응답을 쓸 수 있음
import { ONLINE_URL, ONLINE_KEY } from './onlineConfig.js';

const ID_KEY = 'gimmick.online';
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
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${ONLINE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, { ...opts, headers: { ...headers(), ...(opts.headers || {}) }, signal: ctl.signal });
    const txt = await res.text();
    const data = txt ? JSON.parse(txt) : null;
    if (!res.ok) throw new Error((data && (data.message || data.hint)) || `서버 오류 ${res.status}`);
    return data;
  } finally {
    clearTimeout(tm);
  }
}
async function rpc(fn, body) {
  const f = fake();
  if (f) return f(fn, body);
  return call(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
}
async function select(table, query) {
  const f = fake();
  if (f) return f(table, query);
  return call(`${table}?${query}`);
}

/** 내 기록을 올릴 사람 정보 (없으면 등록). nick이 없으면 null */
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
        }
      } catch {}
    }
    return me;
  }
  const nick = localNick();
  if (!nick) return null;
  const secret = randomSecret();
  const id = await rpc('gr_register', { p_nick: nick, p_secret: secret });
  if (!id) throw new Error('등록 실패');
  me = { id, secret, nick };
  writeId(me);
  return me;
}

export const online = {
  get enabled() {
    return !!fake() || !!(ONLINE_URL && ONLINE_KEY);
  },
  /** 내 정보 { id, nick } (아직 안 올렸으면 null) */
  me() {
    const m = readId();
    return m ? { id: m.id, nick: m.nick } : null;
  },
  /**
   * 완주 기록 올리기 → { saved, best, rank, players } (서버가 더 빠를 때만 바꿈)
   * run = { map, car, total, laps:[...], bestLap, assist, ghost(문자열 JSON 또는 null) }
   */
  async submit(run) {
    if (!this.enabled) return null;
    const me = await ensure();
    if (!me) return { needNick: true };
    const r = await rpc('gr_submit', {
      p_id: me.id, p_secret: me.secret, p_map: run.map, p_car: run.car,
      p_total: +run.total.toFixed(3), p_laps: run.laps.map((x) => +x.toFixed(3)),
      p_best_lap: run.bestLap ? +run.bestLap.toFixed(3) : null, p_assist: !!run.assist, p_ghost: run.ghost || null,
    });
    return r;
  },
  /** 순위표: 맵 전체(사람마다 가장 빠른 기록 하나) 또는 car를 주면 그 차만. 빠른 순서 */
  async board(map, car = null, limit = 50) {
    if (!this.enabled) return [];
    const q = `select=player_id,nickname,car,total,laps,best_lap,assist,updated_at&map=eq.${encodeURIComponent(map)}${car ? `&car=eq.${encodeURIComponent(car)}` : ''}&order=total.asc&limit=${limit}`;
    return (await select(car ? 'records' : 'leaderboard', q)) || [];
  },
  /** 다른 사람(또는 나)의 고스트 JSON 문자열 (없으면 null) */
  async ghost(map, car, playerId) {
    if (!this.enabled) return null;
    const rows = await select('ghosts', `select=data,total&map=eq.${encodeURIComponent(map)}&car=eq.${encodeURIComponent(car)}&player_id=eq.${encodeURIComponent(playerId)}&limit=1`);
    return rows && rows[0] ? rows[0].data : null;
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
    writeId({ id: m[1], secret: m[2], nick });
    try {
      localStorage.setItem(NICK_KEY, nick);
    } catch {}
    return nick;
  },
  /** 이 브라우저에서 온라인 정보 지우기 (서버 기록은 남음) */
  forget() {
    writeId(null);
  },
};
