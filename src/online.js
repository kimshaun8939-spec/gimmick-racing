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
    if (j && typeof j.xp === 'number') return { xp: Math.floor(j.xp), races: j.races || 0, wins: j.wins || 0, podiums: j.podiums || 0 };
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
        }
      } catch {}
    }
    return me;
  }
  return null;
}
const sameName = (a, b) => String(a || '').replace(/\s+/g, '').toLowerCase() === String(b || '').replace(/\s+/g, '').toLowerCase();

export const online = {
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
    const secret = randomSecret();
    const r = await rpc('gr_login', { p_nick: nick, p_pin: pin, p_secret: secret, p_id: cur ? cur.id : null, p_cur: cur ? cur.secret : null });
    if (!r || !r.ok) {
      const reason = (r && r.reason) || 'bad';
      const msg = reason === 'pin' ? '이미 있는 이름이에요 · 비밀번호가 달라요'
        : reason === 'locked' ? `비밀번호를 여러 번 틀려서 잠겼어요 · ${Math.ceil((r.wait || 1800) / 60)}분 뒤에 다시 해 주세요`
        : '이름이나 비밀번호를 확인해 주세요';
      throw Object.assign(new Error(msg), { reason });
    }
    writeId({ id: r.id, secret, nick: r.nick, claimed: true });
    try {
      localStorage.setItem(NICK_KEY, r.nick);
    } catch {}
    await this.syncXp();
    return { nick: r.nick, created: !!r.created, merged: r.merged || 0, claimed: !!r.claimed };
  },
  /**
   * 레벨 합치기: 이 기기 경험치를 서버에 올리고 같은 계정 다른 기기들의 합을 받아 둠 → { others, total, devices } 또는 null
   *   (계정이 없거나 서버에 gr_xp가 없으면 null, 레벨은 이 기기 값만으로 보임)
   */
  async syncXp() {
    const m = readId();
    const p = localProfile();
    const dev = deviceId();
    if (!m || !p || !dev || !this.enabled) return null;
    try {
      const r = await rpc('gr_xp', { p_id: m.id, p_secret: m.secret, p_device: dev, p_xp: p.xp, p_races: p.races, p_wins: p.wins, p_podiums: p.podiums });
      if (!r || !r.others) return null;
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
    if (ok) writeId({ ...m, nick });
    return !!ok;
  },
  /** 서버에서 내 계정 상태 다시 확인 (다른 기기에서 합쳐져 없어졌으면 지움) → me() */
  async refresh() {
    const m = readId();
    if (!m || !this.enabled) return this.me();
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
    let r;
    try {
      r = await rpc('gr_submit', {
        p_id: me.id, p_secret: me.secret, p_map: run.map, p_car: run.car,
        p_total: +run.total.toFixed(3), p_laps: run.laps.map((x) => +x.toFixed(3)),
        p_best_lap: run.bestLap ? +run.bestLap.toFixed(3) : null, p_assist: !!run.assist, p_ghost: run.ghost || null,
      });
    } catch (err) {
      // 다른 기기에서 이 계정이 합쳐져 없어졌으면: 이 기기는 다시 이름+비밀번호로
      if (/unknown player/.test(err.message || '')) {
        writeId(null);
        return { needLogin: true };
      }
      throw err;
    }
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
    writeId({ id: m[1], secret: m[2], nick, claimed: false });
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
};

// 완주해서 경험치를 받으면(profile.js 'gimmick:xp') 계정 경험치도 올림
if (typeof window !== 'undefined' && !window.__gimmickXpSync) {
  window.__gimmickXpSync = true;
  window.addEventListener('gimmick:xp', () => {
    online.syncXp();
  });
}
