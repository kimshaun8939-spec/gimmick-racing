// 온라인 멀티플레이 연결 도구 (로비 lobby.js · 레이스 netRace.js가 같이 씀)
//
// 쉬운 설명:
//   - 서버를 따로 만들지 않고 PeerJS(무료 공개 서버)로 "서로 찾기"만 하고, 실제 데이터는 브라우저끼리 바로 주고받음(WebRTC).
//   - 방장(호스트)이 가운데에 있고, 다른 사람은 모두 방장에게만 연결 → 방장이 받은 것을 다른 사람에게 전달 (별 모양).
//   - 방 코드 K7Q2 → 방장의 PeerJS 아이디는 로비 "gimmickracing-k7q2", 레이스 "gimmickracing-k7q2-r"
//     (로비에서 출발하면 페이지를 새로 불러오므로, 레이스 화면은 다른 아이디로 다시 연결함)
//   - 연결 통로 2개: 'ctl'(꼭 도착해야 하는 메시지: 입장·출발·결과·채팅), 'st'(1초에 20번 보내는 차 위치: 잃어버려도 됨)
//   - 엄격한 공유기(NAT) 때문에 바로 연결이 안 되면 PeerJS 기본 설정에 들어 있는 무료 중계(TURN) 서버를 씀
//   - 인터넷 없이 같은 브라우저 탭끼리 시험할 때: 주소에 &net=local → BroadcastChannel로 흉내 냄
export const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm'; // 버전 고정
export const NET_VERSION = 1; // 메시지 형식이 바뀌면 올림 (다른 버전끼리는 같은 방에 못 들어감)
const PREFIX = 'gimmickracing-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 O/0, I/1 은 뺌

export const lobbyPeerId = (code) => PREFIX + normCode(code).toLowerCase();
export const racePeerId = (code) => PREFIX + normCode(code).toLowerCase() + '-r';

export function makeCode(len = 4) {
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) s += CODE_CHARS[r[i] % CODE_CHARS.length];
  return s;
}
/** 사용자가 친 코드 정리: 소문자 → 대문자, 공백·기호 빼기 (코드에는 O·0·I·1 이 없음) */
export function normCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}
export const validCode = (s) => /^[A-HJ-NP-Z2-9]{4,6}$/.test(s);

/** 이 탭의 선수 아이디 (탭마다 다름, 페이지를 새로 불러도 유지 → 로비와 레이스에서 같은 사람으로 알아봄) */
export function myPid() {
  try {
    let id = sessionStorage.getItem('gimmick.pid');
    if (!id) sessionStorage.setItem('gimmick.pid', (id = 'p' + makeCode(6).toLowerCase()));
    return id;
  } catch {
    return 'p' + makeCode(6).toLowerCase();
  }
}
export function getNick() {
  try {
    return localStorage.getItem('gimmick.nick') || '';
  } catch {
    return '';
  }
}
export function setNick(n) {
  try {
    localStorage.setItem('gimmick.nick', n);
  } catch {}
}
export const randomNick = () => ['번개', '질주', '드리프트', '터보', '로켓', '바람', '유성', '폭풍'][Math.floor(Math.random() * 8)] + Math.floor(10 + Math.random() * 90);
export const cleanNick = (s) => String(s || '').replace(/[<>&"]/g, '').trim().slice(0, 12);

/** 로비 → 레이스로 넘길 정보 (같은 탭 안에서만: sessionStorage) */
export function saveRoomInfo(info) {
  try {
    sessionStorage.setItem('gimmick.room', JSON.stringify(info));
  } catch {}
}
export function loadRoomInfo(code) {
  try {
    const v = JSON.parse(sessionStorage.getItem('gimmick.room') || 'null');
    return v && (!code || v.code === normCode(code)) ? v : null;
  } catch {
    return null;
  }
}

/** 초대 링크: 지금 주소(localhost든 GitHub Pages든)에서 ?join=CODE 만 붙임 */
export function inviteUrl(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', normCode(code));
  return u.toString();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const useLocal = () => {
  try {
    return new URLSearchParams(location.search).get('net') === 'local' || localStorage.getItem('gimmick.net') === 'local';
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- PeerJS 불러오기
let libPromise = null;
export function loadPeerLib() {
  if (useLocal()) return Promise.resolve({ Peer: LocalPeer, local: true });
  if (!libPromise) {
    libPromise = import(PEERJS_URL)
      .then((m) => ({ Peer: m.Peer || m.default, local: false }))
      .catch((e) => {
        libPromise = null;
        throw new Error('멀티플레이 모듈(PeerJS)을 불러오지 못했어요. 인터넷 연결을 확인해 주세요. (' + (e && e.message) + ')');
      });
  }
  return libPromise;
}

/**
 * 정해진 아이디로 PeerJS에 등록. 아이디가 아직 쓰이는 중이면(방금 나간 페이지 등) 기다렸다 다시 시도.
 * onStatus(문구) 로 진행 상황을 알려 줌
 */
export async function openPeer(id, { tries = 12, delay = 1500, onStatus, signal } = {}) {
  const { Peer } = await loadPeerLib();
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    if (signal && signal.aborted) throw new Error('취소됨');
    try {
      const peer = await new Promise((resolve, reject) => {
        const o = peerOptions();
        const p = id ? new Peer(id, o) : new Peer(o);
        const to = setTimeout(() => (p.off('error', onErr), p.destroy(), reject(Object.assign(new Error('서버 응답 없음'), { type: 'timeout' }))), 12000);
        // 주의: 이 오류 처리기는 열리기 전까지만 (열린 뒤의 '상대 없음' 오류로 peer를 부수면 안 됨)
        const onErr = (e) => (clearTimeout(to), p.off('error', onErr), p.destroy(), reject(e));
        p.on('error', onErr);
        p.once('open', () => (clearTimeout(to), p.off('error', onErr), resolve(p)));
      });
      watchPeer(peer);
      return peer;
    } catch (e) {
      lastErr = e;
      const t = e && e.type;
      if (t === 'browser-incompatible' || t === 'ssl-unavailable') throw new Error('이 브라우저는 온라인 연결(WebRTC)을 지원하지 않아요.');
      if (t === 'invalid-id') throw e;
      if (onStatus) onStatus(t === 'unavailable-id' ? '이전 연결이 정리되기를 기다리는 중…' : '연결 서버에 다시 접속하는 중…', i + 1);
      await wait(delay * (t === 'unavailable-id' ? 1 : Math.min(3, 1 + i * 0.5)));
    }
  }
  const err = new Error(lastErr && lastErr.type === 'unavailable-id' ? '이미 같은 방 코드를 쓰는 사람이 있어요' : '연결 서버에 접속할 수 없어요');
  err.type = lastErr && lastErr.type;
  throw err;
}

// PeerJS 설정. 기본값(구글 STUN + PeerJS 무료 TURN 중계)으로 충분함.
// 회사·학교처럼 아주 엄격한 네트워크에서 안 될 때만: 직접 받은 TURN 서버를 브라우저 콘솔에서
//   localStorage.setItem('gimmick.ice', JSON.stringify([{ urls: 'turn:서버:3478', username: '아이디', credential: '비번' }]))
// 처럼 넣으면 기본 서버 대신 그것을 씀 (지우기: localStorage.removeItem('gimmick.ice'))
function peerOptions() {
  const o = { debug: 1 };
  try {
    const ice = JSON.parse(localStorage.getItem('gimmick.ice') || 'null');
    if (Array.isArray(ice) && ice.length) o.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...ice] };
  } catch {}
  return o;
}

// 서버와 연결이 끊기면(와이파이 잠깐 끊김 등) 다시 붙음. 이미 연결된 상대와는 계속 통함
function watchPeer(peer) {
  peer.on('disconnected', () => {
    if (peer.destroyed) return;
    setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 1500);
  });
  peer.on('error', (e) => console.warn('[net]', e && e.type, e && e.message));
}

/** 한 번 연결 시도 (열리면 conn, 상대가 없거나 시간이 지나면 실패) */
function connectOnce(peer, id, opts, timeout = 9000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const conn = peer.connect(id, opts);
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      peer.off('error', onErr);
      if (err) {
        try {
          conn.close();
        } catch {}
        reject(err);
      } else resolve(conn);
    };
    const onErr = (e) => {
      if (e && e.type === 'peer-unavailable' && String(e.message || '').includes(id)) finish(Object.assign(new Error('상대가 없음'), { type: 'peer-unavailable' }));
    };
    peer.on('error', onErr);
    const to = setTimeout(() => finish(Object.assign(new Error('연결 시간 초과'), { type: 'timeout' })), timeout);
    conn.on('open', () => finish());
    conn.on('error', (e) => finish(e || new Error('연결 오류')));
  });
}

// ---------------------------------------------------------------- 방장 (가운데)
/**
 * 방장 만들기. handlers:
 *   onJoin(pid, link)      새 사람이 'hello'를 보냄 (link.hello = 그 메시지)
 *   onMessage(pid, msg, link)  'ctl' 메시지
 *   onFast(pid, msg)       'st' 메시지 (차 위치)
 *   onLeave(pid)
 * 돌려줌: { peer, links: Map(pid → link), send(pid, msg), broadcast(msg, exceptPid), fast(msg, exceptPid), close() }
 */
export async function createHub(id, handlers = {}, opts = {}) {
  const peer = await openPeer(id, opts);
  const links = new Map(); // pid → { pid, ctl, st, hello, peerId }
  const byPeer = new Map(); // PeerJS 아이디 → link (hello 오기 전 st 통로 묶기)
  const hub = {
    peer,
    links,
    send(pid, msg) {
      const l = links.get(pid);
      if (l && l.ctl && l.ctl.open) safeSend(l.ctl, msg);
    },
    broadcast(msg, except) {
      for (const l of links.values()) if (l.pid !== except && l.ctl && l.ctl.open) safeSend(l.ctl, msg);
    },
    /** 위치 같은 자주 보내는 메시지: st 통로 (없으면 ctl) */
    fast(msg, except) {
      for (const l of links.values()) {
        if (l.pid === except) continue;
        const c = l.st && l.st.open ? l.st : l.ctl;
        if (c && c.open) safeSend(c, msg);
      }
    },
    kick(pid, msg) {
      const l = links.get(pid);
      if (!l) return;
      if (msg) safeSend(l.ctl, msg);
      setTimeout(() => closeLink(l), 300);
    },
    close() {
      for (const l of links.values()) closeLink(l);
      links.clear();
      try {
        peer.destroy();
      } catch {}
    },
  };
  const closeLink = (l) => {
    try {
      l.ctl && l.ctl.close();
    } catch {}
    try {
      l.st && l.st.close();
    } catch {}
  };
  peer.on('connection', (conn) => {
    if (conn.label === 'probe') return void setTimeout(() => conn.close(), 1500); // "방이 있나?" 확인만 하는 연결
    const key = conn.peer;
    let rec = byPeer.get(key);
    if (!rec) byPeer.set(key, (rec = { peerId: key, pid: null, ctl: null, st: null, hello: null }));
    if (conn.label === 'st') {
      rec.st = conn;
      conn.on('data', (msg) => rec.pid && handlers.onFast && handlers.onFast(rec.pid, msg));
      conn.on('close', () => rec.st === conn && (rec.st = null));
      return;
    }
    rec.ctl = conn;
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        const pid = String(msg.pid || key).slice(0, 24);
        const old = links.get(pid);
        if (old && old !== rec) closeLink(old); // 같은 사람이 다시 들어옴 → 예전 연결 정리
        rec.pid = pid;
        rec.hello = msg;
        links.set(pid, rec);
        if (handlers.onJoin) handlers.onJoin(pid, rec);
        return;
      }
      if (msg.t === 'ping') return safeSend(conn, { t: 'pong', c: msg.c, h: performance.now() });
      if (rec.pid && handlers.onMessage) handlers.onMessage(rec.pid, msg, rec);
    });
    const gone = () => {
      if (rec.ctl !== conn) return;
      byPeer.delete(key);
      if (rec.pid && links.get(rec.pid) === rec) {
        links.delete(rec.pid);
        if (handlers.onLeave) handlers.onLeave(rec.pid);
      }
      try {
        rec.st && rec.st.close();
      } catch {}
    };
    conn.on('close', gone);
    conn.on('error', gone);
  });
  // 페이지를 닫으면 바로 알려서 다른 사람 화면에서 빨리 사라지게
  addEventListener('pagehide', () => hub.close());
  return hub;
}

// ---------------------------------------------------------------- 참가자
/**
 * 방장에게 연결. 방장이 아직 없으면(페이지 불러오는 중) tries번까지 다시 시도.
 * handlers: onMessage(msg), onFast(msg), onClose()
 * 돌려줌: { peer, send(msg), fast(msg), close(), clock: { offset, rtt }, ping() }
 *   clock.offset: 방장 시계 = 내 performance.now() + offset
 */
export async function joinHub(hostId, hello, handlers = {}, { tries = 20, delay = 2000, onStatus, signal } = {}) {
  let peer = await openPeer(null, { onStatus, signal });
  let ctl = null;
  for (let i = 0; i < tries && !ctl; i++) {
    if (signal && signal.aborted) {
      peer.destroy();
      throw new Error('취소됨');
    }
    try {
      ctl = await connectOnce(peer, hostId, { label: 'ctl', reliable: true, serialization: 'json' });
    } catch (e) {
      console.warn('[net] 연결 실패', hostId, e && e.type, e && e.message);
      if (onStatus) onStatus(e.type === 'peer-unavailable' ? '방장을 찾는 중…' : '연결 다시 시도 중…', i + 1, e.type);
      await wait(delay);
      // 실패한 뒤에는 PeerJS 객체가 이상한 상태로 남을 때가 있음(같은 상대에게 다시 연결이 안 됨) → 새로 만들어서 다시 시도
      if (peer.destroyed || peer.disconnected || i % 5 === 4) {
        try {
          peer.destroy();
        } catch {}
        peer = await openPeer(null, { onStatus, signal });
      }
    }
  }
  if (!ctl) {
    peer.destroy();
    const err = new Error('방을 찾을 수 없어요. 방 코드를 확인해 주세요.');
    err.type = 'not-found';
    throw err;
  }
  let st = null;
  const clock = { offset: 0, rtt: 999, samples: [] };
  let closed = false;
  const link = {
    peer,
    clock,
    get open() {
      return !closed && ctl.open;
    },
    send(msg) {
      if (ctl.open) safeSend(ctl, msg);
    },
    fast(msg) {
      const c = st && st.open ? st : ctl;
      if (c.open) safeSend(c, msg);
    },
    ping() {
      if (ctl.open) safeSend(ctl, { t: 'ping', c: performance.now() });
    },
    /** 방장 시계로 지금 시각 */
    hostNow() {
      return performance.now() + clock.offset;
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(pinger);
      try {
        ctl.close();
      } catch {}
      try {
        st && st.close();
      } catch {}
      setTimeout(() => peer.destroy(), 200);
    },
  };
  ctl.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'pong') return onPong(msg);
    if (handlers.onMessage) handlers.onMessage(msg);
  });
  const onClose = () => {
    if (closed) return;
    closed = true;
    clearInterval(pinger);
    setTimeout(() => peer.destroy(), 200);
    if (handlers.onClose) handlers.onClose();
  };
  ctl.on('close', onClose);
  ctl.on('error', onClose);
  // 시계 맞추기: 왕복 시간이 가장 짧았던 몇 번의 평균 (느린 왕복은 오차가 큼)
  function onPong(m) {
    const now = performance.now();
    const rtt = now - m.c;
    clock.samples.push({ rtt, off: m.h + rtt / 2 - now });
    if (clock.samples.length > 16) clock.samples.shift();
    const best = [...clock.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(clock.samples.length / 3)));
    clock.offset = best.reduce((s, x) => s + x.off, 0) / best.length;
    clock.rtt = clock.rtt === 999 ? rtt : clock.rtt * 0.7 + rtt * 0.3;
    if (handlers.onPing) handlers.onPing(clock.rtt);
  }
  safeSend(ctl, { ...hello, t: 'hello', v: NET_VERSION });
  for (let i = 0; i < 5; i++) setTimeout(() => link.ping(), 60 + i * 120); // 처음엔 빨리 몇 번 재서 시계를 맞춤
  const pinger = setInterval(() => link.ping(), 2000);
  // 위치용 통로 (실패해도 ctl로 보내면 되니 기다리지 않음)
  connectOnce(peer, hostId, { label: 'st', reliable: false, serialization: 'json' })
    .then((c) => {
      st = c;
      st.on('data', (msg) => handlers.onFast && handlers.onFast(msg));
    })
    .catch(() => {});
  addEventListener('pagehide', () => link.close());
  return link;
}

function safeSend(conn, msg) {
  try {
    conn.send(msg);
  } catch (e) {
    /* 닫히는 중 */
  }
}

// ---------------------------------------------------------------- 인터넷 없이 시험용 (같은 브라우저 탭끼리)
// PeerJS의 Peer/DataConnection 중 여기서 쓰는 것만 흉내 냄
class Emitter {
  constructor() {
    this._h = {};
  }
  on(n, f) {
    (this._h[n] ||= []).push(f);
    return this;
  }
  once(n, f) {
    const g = (...a) => (this.off(n, g), f(...a));
    return this.on(n, g);
  }
  off(n, f) {
    this._h[n] = (this._h[n] || []).filter((x) => x !== f);
    return this;
  }
  emit(n, ...a) {
    for (const f of [...(this._h[n] || [])]) f(...a);
  }
}
let bc = null;
const localPeers = new Map();
function chan() {
  if (bc) return bc;
  bc = new BroadcastChannel('gimmick-net');
  bc.onmessage = (ev) => {
    const m = ev.data;
    for (const p of localPeers.values()) p._recv(m);
  };
  return bc;
}
class LocalConn extends Emitter {
  constructor(peer, other, cid, label) {
    super();
    Object.assign(this, { _peer: peer, peer: other, cid, label, open: false });
  }
  send(data) {
    if (this.open) chan().postMessage({ k: 'd', to: this.peer, cid: this.cid, data: JSON.parse(JSON.stringify(data)) });
  }
  close() {
    if (!this.open) return;
    this.open = false;
    chan().postMessage({ k: 'x', to: this.peer, cid: this.cid });
    this._peer.conns.delete(this.cid);
    this.emit('close');
  }
}
class LocalPeer extends Emitter {
  constructor(id) {
    super();
    if (typeof id !== 'string') id = 'local-' + makeCode(8).toLowerCase();
    Object.assign(this, { id, conns: new Map(), destroyed: false, disconnected: false, _claim: true });
    localPeers.set(this, this);
    chan().postMessage({ k: 'claim', id });
    setTimeout(() => {
      if (this.destroyed) return;
      this._claim = false;
      this.emit('open', id);
    }, 250);
    addEventListener('pagehide', () => this.destroy());
  }
  _recv(m) {
    if (this.destroyed) return;
    if (m.k === 'claim' && m.id === this.id && !this._claim) return chan().postMessage({ k: 'taken', id: m.id });
    if (m.k === 'taken' && m.id === this.id && this._claim) {
      this.destroyed = true;
      localPeers.delete(this);
      return this.emit('error', Object.assign(new Error('ID taken'), { type: 'unavailable-id' }));
    }
    if (m.to !== this.id) return;
    if (m.k === 'c') {
      if (this._claim) return; // (시험용 통신) 아직 여는 중이면 받지 않음 → 상대가 잠시 뒤 다시 시도 (예전엔 받는 쪽 준비 전에 연결돼 영영 안 이어지는 때가 있었음)
      const c = new LocalConn(this, m.from, m.cid, m.label);
      c.open = true;
      this.conns.set(m.cid, c);
      chan().postMessage({ k: 'a', to: m.from, cid: m.cid });
      this.emit('connection', c);
      setTimeout(() => c.emit('open'), 0);
    } else if (m.k === 'a') {
      const c = this.conns.get(m.cid);
      if (c && !c.open) (c.open = true), clearTimeout(c._to), c.emit('open');
    } else if (m.k === 'd') {
      const c = this.conns.get(m.cid);
      if (c && c.open) c.emit('data', m.data);
    } else if (m.k === 'x') {
      const c = this.conns.get(m.cid);
      if (c) (c.open = false), this.conns.delete(m.cid), c.emit('close');
    }
  }
  connect(id, opts = {}) {
    const cid = makeCode(10);
    const c = new LocalConn(this, id, cid, opts.label);
    this.conns.set(cid, c);
    chan().postMessage({ k: 'c', to: id, from: this.id, cid, label: opts.label });
    c._to = setTimeout(() => {
      if (c.open) return;
      this.conns.delete(cid);
      this.emit('error', Object.assign(new Error('Could not connect to peer ' + id), { type: 'peer-unavailable' }));
    }, 1200);
    return c;
  }
  reconnect() {}
  destroy() {
    if (this.destroyed) return;
    for (const c of [...this.conns.values()]) c.close();
    this.destroyed = true;
    localPeers.delete(this);
  }
}

/** 그 아이디의 방장이 지금 있는지만 확인 (레이스 중인지 알아볼 때) */
export async function probePeer(id) {
  let peer = null;
  try {
    peer = await openPeer(null, { tries: 2 });
    const c = await connectOnce(peer, id, { label: 'probe', serialization: 'json' }, 7000);
    c.close();
    return true;
  } catch {
    return false;
  } finally {
    if (peer) setTimeout(() => peer.destroy(), 300);
  }
}
