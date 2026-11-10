// 온라인 멀티플레이 로비 (방 만들기 · 코드로 참가 · 차/맵 고르기 · 준비 · 채팅 · 출발)
//   openLobby({ map, car, join, room, host, onClose })
//     join: 초대 링크(?join=CODE)로 들어왔을 때 그 코드 → 바로 참가 시도
//     room + host: 레이스가 끝나고 "로비로" 눌렀을 때 같은 방 코드로 다시 열기 (host=true면 방장으로)
//   방장이 "출발"을 누르면 모두 ?map=..&car=..&room=CODE&host=1|0&name=..&mode=race 로 이동 → netRace.js가 이어받음
// 연결 방식 설명은 net.js 위쪽 주석 참고
import { createHub, joinHub, probePeer, racePeerId, lobbyPeerId, makeCode, normCode, validCode, myPid, getNick, setNick, randomNick, cleanNick, saveRoomInfo, inviteUrl, loadPeerLib, NET_VERSION } from './net.js';
import { loadCarThumbs, thumbUrl } from './carThumbs.js'; // 차 고르기 칸의 진짜 차 사진 (홈 화면과 같은 사진, 저장돼 있으면 바로)
import { loadMaps, loadRoster, sampleOutline, drawTrackThumb, getLast, setLast } from './gameData.js';

const MAX_PLAYERS = 8;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lookColors = (look) => {
  if (typeof look === 'string') return [look, '#ffffff'];
  look = look || {};
  return [look.body || '#e8463a', look.accent || look.trim || '#ffffff'];
};
const STYLE_ICON = { f1: '🏎️', gt: '🚘', rally: '🚙', proto: '🏁', rocket: '🚀', buggy: '🛻' };

let current = null; // 한 번에 로비 하나만

export async function openLobby(opts = {}) {
  if (current) return current;
  injectCss();
  const api = { close };
  current = api;

  // ------------------------------------------------------------------ 데이터
  const [maps, roster] = await Promise.all([loadMaps(), loadRoster()]);
  let cars = [];
  try {
    cars = await roster.listCars();
  } catch {}
  if (!cars.length) cars = [{ id: 'f1', name: '레드 포뮬러', tag: 'FORMULA', look: '#e8463a' }];
  const carOf = (id) => cars.find((c) => c.id === id) || cars[0];
  let classes = [];
  try {
    classes = roster.listClasses ? await roster.listClasses() : [];
  } catch {}
  const classOf = (id) => classes.find((k) => k.id === id) || null;
  // 보여 줄 순서: A 레전드 → B 스포츠 → C 루키 (등급 없으면 원래 순서)
  const rank = (c) => { const i = classes.findIndex((k) => k.id === c.class); return i < 0 ? -1 : classes.length - i; };
  const carsShown = cars.slice().sort((a, b) => rank(b) - rank(a));
  const mapOf = (id) => maps.find((m) => m.id === id) || maps[0];
  const last = getLast();
  let carId = carOf(opts.car || last.car).id;
  let mapId = mapOf(opts.map || last.map).id;
  let nick = cleanNick(opts.name || getNick()) || ''; // (레이스에서 돌아올 땐 그때 쓰던 이름)
  const pid = myPid();
  const mapPts = {};
  maps.forEach((m) =>
    fetch(m.file)
      .then((r) => r.json())
      .then((d) => {
        mapPts[m.id] = { pts: sampleOutline(d, 8), laps: d.laps || 1 };
        renderMapThumbs();
      })
      .catch(() => {}),
  );

  // ------------------------------------------------------------------ 화면 틀
  const el = document.createElement('div');
  el.id = 'lobby';
  el.innerHTML = `
    <div class="lb-bg"></div>
    <div class="lb-top">
      <div class="lb-title"><span class="globe">🌐</span><div><b>온라인 멀티플레이</b><small>친구와 같은 코스에서 실시간 레이스 · 서버 설치 없이 링크만 보내면 끝</small></div></div>
      <button class="gm-btn small" data-act="close">✕ 닫기 <kbd>Esc</kbd></button>
    </div>
    <div class="lb-view" data-view="entry"></div>
    <div class="lb-view" data-view="busy"></div>
    <div class="lb-view" data-view="room"></div>
    <div class="lb-go"><div class="n"></div><small></small></div>`;
  document.body.appendChild(el);
  const $ = (s, root = el) => root.querySelector(s);
  const views = Object.fromEntries([...el.querySelectorAll('.lb-view')].map((v) => [v.dataset.view, v]));
  let view = '';
  const show = (name) => {
    view = name;
    for (const [k, v] of Object.entries(views)) v.classList.toggle('on', k === name);
  };
  // 게임 화면 위에 열렸으면 게임을 멈춤 (테스트용 paused와 같은 방식)
  const game = window.game && window.game.car ? window.game : null; // (홈 화면에선 window.game이 <canvas id=game>이라 car로 구분)
  const wasPaused = game && game.paused;
  if (game) game.paused = true;

  // ------------------------------------------------------------------ 1) 입장 화면
  views.entry.innerHTML = `
    <div class="lb-entry">
      <section class="lb-card lb-me">
        <h3>내 정보</h3>
        <label class="lb-field"><span>닉네임</span><input id="lbNick" maxlength="12" placeholder="닉네임 (최대 12자)" autocomplete="off" spellcheck="false"></label>
        <div class="lb-field"><span>내 차</span><div class="lb-cars" id="lbCars"></div></div>
      </section>
      <section class="lb-card lb-big create">
        <div class="ic">🏁</div>
        <h3>방 만들기</h3>
        <p>방 코드가 생겨요. 초대 링크를 친구에게 보내면 바로 들어와요.</p>
        <button class="gm-btn primary" data-act="create">방 만들기 <kbd>Enter</kbd></button>
      </section>
      <section class="lb-card lb-big join">
        <div class="ic">🔑</div>
        <h3>코드로 참가</h3>
        <p>친구에게 받은 4자리 방 코드를 넣으세요.</p>
        <div class="lb-code-in"><input id="lbCode" maxlength="6" placeholder="K7Q2" autocomplete="off" spellcheck="false"><button class="gm-btn" data-act="join">참가</button></div>
      </section>
      <p class="lb-err" id="lbErr"></p>
      <p class="lb-note">같은 와이파이가 아니어도 인터넷만 되면 연결돼요. 회사·학교 네트워크에서는 막힐 수도 있어요.</p>
    </div>`;
  const nickIn = $('#lbNick');
  const codeIn = $('#lbCode');
  nickIn.value = nick;
  nickIn.addEventListener('input', () => {
    nick = cleanNick(nickIn.value);
    setNick(nick);
  });
  codeIn.addEventListener('input', () => (codeIn.value = normCode(codeIn.value)));
  codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), startJoin(codeIn.value)));
  if (opts.join) codeIn.value = normCode(opts.join);

  // 차 사진 (2026-11-10 사용자 요청 "내 차도 좀 더 괜찮게"): 색 동그라미 대신 홈 화면과 같은 진짜 차 사진 카드
  const picHtml = (id) => {
    const url = thumbUrl(id);
    return url ? `<img src="${url}" alt="" draggable="false" data-pic="${esc(id)}">` : `<span class="ph" data-pic="${esc(id)}"></span>`;
  };
  function renderCarChips(box) {
    box.innerHTML = carsShown
      .map((c) => {
        const k = classOf(c.class);
        const tag = String(c.tag || '').split('·').pop().trim();
        return `<button class="lb-car${c.id === carId ? ' on' : ''}" data-car="${esc(c.id)}" title="${esc(c.desc || c.tag || '')}" style="--cc:${esc((k && k.color) || '#ffcf3f')}"><span class="pic">${picHtml(c.id)}${k ? `<i class="cl">${esc(k.id)}</i>` : ''}<span class="chk">✓</span></span><b>${esc(c.name)}</b><small>${esc(tag)}</small></button>`;
      })
      .join('');
  }
  renderCarChips($('#lbCars'));
  // 사진이 준비되면 자리(반짝이는 칸)를 사진으로 바꿈
  const thumbJob = loadCarThumbs(cars, {
    first: carId,
    onThumb: (id, url) => {
      el.querySelectorAll(`[data-pic="${CSS.escape(id)}"]`).forEach((n) => {
        if (n.tagName === 'IMG') return void (n.src = url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.draggable = false;
        img.dataset.pic = id;
        img.className = 'in';
        n.replaceWith(img);
      });
    },
  });
  thumbJob.done.catch((e) => console.warn('차 사진', e));
  el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-car]');
    if (chip) {
      carId = chip.dataset.car;
      setLast({ car: carId });
      el.querySelectorAll('[data-car]').forEach((b) => b.classList.toggle('on', b.dataset.car === carId));
      if (session) session.setMe({ car: carId });
      click();
    }
    const mp = e.target.closest('[data-map]');
    if (mp && session && session.isHost) {
      mapId = mp.dataset.map;
      session.setMap(mapId);
      click();
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'close') leaveOrClose();
    else if (a === 'create') startCreate();
    else if (a === 'join') startJoin(codeIn.value);
    else if (a === 'cancel') cancelBusy();
    else if (a === 'copyLink') copy(inviteUrl(session.code), act, '링크 복사됨!');
    else if (a === 'copyCode') copy(session.code, act, '복사됨!');
    else if (a === 'share') shareLink();
    else if (a === 'ready') session && session.setMe({ ready: !session.me().ready });
    else if (a === 'go') session && session.go();
    else if (a === 'leave') leaveRoom();
    else if (a === 'bots') session && session.setBots(+act.dataset.n);
    else if (a === 'rename') renameMe();
    else if (a === 'kick') session && session.kick(act.dataset.pid);
  });

  // ------------------------------------------------------------------ 2) 연결 중 화면
  function busy(title, sub) {
    views.busy.innerHTML = `<div class="lb-busy"><div class="spin"></div><h2>${esc(title)}</h2><p id="lbBusySub">${esc(sub || '')}</p><button class="gm-btn" data-act="cancel">취소</button></div>`;
    show('busy');
  }
  const busySub = (t) => {
    const s = $('#lbBusySub');
    if (s) s.textContent = t;
  };
  let abort = null;
  function cancelBusy() {
    if (abort) abort.abort();
    abort = null;
    if (session) session.leave();
    session = null;
    show('entry');
  }
  const err = (t) => {
    show('entry');
    $('#lbErr').textContent = t || '';
  };
  const needNick = () => {
    if (!nick) {
      nick = randomNick();
      nickIn.value = nick;
      setNick(nick);
    }
  };

  // ------------------------------------------------------------------ 방 (방장 / 참가자 공통 인터페이스)
  let session = null;

  async function startCreate(fixedCode) {
    needNick();
    busy('방 만드는 중…', '연결 서버에 접속하는 중');
    abort = new AbortController();
    const signal = abort.signal;
    try {
      await loadPeerLib();
      let s = null;
      for (let i = 0; i < 4 && !s; i++) {
        const code = fixedCode || makeCode();
        try {
          s = await hostSession(code, signal);
        } catch (e) {
          if (signal.aborted) return;
          if (fixedCode || e.type !== 'unavailable-id') throw e; // 우연히 같은 코드가 있으면 다른 코드로
        }
      }
      if (signal.aborted) return s && s.leave();
      session = s;
      enterRoom();
    } catch (e) {
      if (!signal.aborted) err(e.message || String(e));
    }
  }
  async function startJoin(raw, patient = false) {
    const code = normCode(raw);
    if (!validCode(code)) return err('방 코드는 4자리 영문·숫자예요 (예: K7Q2)');
    needNick();
    if (!patient || view !== 'busy') busy(`${code} 방에 들어가는 중…`, '연결 서버에 접속하는 중');
    abort = new AbortController();
    const signal = abort.signal;
    try {
      const s = await clientSession(code, signal, patient);
      if (signal.aborted) return s.leave();
      session = s;
      enterRoom();
    } catch (e) {
      if (signal.aborted) return;
      // 방이 없으면: 혹시 레이스 중인지 확인 → 레이스 중이면 끝나고 로비가 다시 열릴 때까지 기다림
      if (e.type === 'not-found' && !patient) {
        busySub('혹시 레이스 중인지 확인하는 중…');
        if ((await probePeer(racePeerId(code))) && !signal.aborted) {
          busy(`${code} 방은 지금 레이스 중이에요 🏁`, '레이스가 끝나고 방장이 "로비로 돌아가기"를 누르면 자동으로 들어가요');
          return startJoin(code, true);
        }
        if (signal.aborted) return;
      }
      err(e.message || String(e));
    }
  }

  // ---------- 방장
  async function hostSession(code, signal) {
    const players = new Map(); // pid → 선수 정보
    let bots = 0;
    const chat = [];
    let going = false;
    const meInfo = () => ({ pid, name: nick, car: carId, carName: carOf(carId).name, look: carOf(carId).look, ready: true, host: true, ping: 0 });
    players.set(pid, meInfo());
    const s = {
      code,
      isHost: true,
      me: () => players.get(pid),
      players: () => [...players.values()],
      map: () => mapId,
      bots: () => bots,
      chat,
    };
    const state = () => ({ t: 'state', players: s.players(), map: mapId, bots, code });
    const push = () => {
      hub.broadcast(state());
      renderRoom();
    };
    const sys = (text) => addChat({ sys: true, text });
    function addChat(m) {
      chat.push(m);
      if (chat.length > 60) chat.shift();
      hub.broadcast({ t: 'chat', ...m });
      renderChat();
    }
    const hub = await createHub(
      lobbyPeerId(code),
      {
        onJoin(p, link) {
          const h = link.hello || {};
          if (h.v !== NET_VERSION) return hub.kick(p, { t: 'reject', reason: '게임 버전이 달라요. 페이지를 새로고침해 주세요.' });
          if (going) return hub.kick(p, { t: 'reject', reason: '이미 출발한 방이에요.' });
          if (!players.has(p) && players.size >= MAX_PLAYERS) return hub.kick(p, { t: 'reject', reason: `방이 꽉 찼어요 (최대 ${MAX_PLAYERS}명)` });
          const c = carOf(h.car);
          const isNew = !players.has(p);
          players.set(p, { pid: p, name: cleanNick(h.name) || '손님', car: c.id, carName: c.name, look: c.look, ready: false, host: false, ping: 0, joinedAt: Date.now() });
          hub.send(p, { t: 'welcome', you: p, chat: chat.slice(-30) });
          if (isNew) sys(`${players.get(p).name} 님이 들어왔어요`), joinSound();
          push();
        },
        onMessage(p, m) {
          const pl = players.get(p);
          if (!pl) return;
          if (m.t === 'set') {
            if (m.name != null) pl.name = cleanNick(m.name) || pl.name;
            if (m.car != null) {
              const c = carOf(m.car);
              Object.assign(pl, { car: c.id, carName: c.name, look: c.look });
            }
            if (m.ready != null) pl.ready = !!m.ready;
            if (m.ping != null) pl.ping = Math.round(+m.ping) || 0;
            push();
          } else if (m.t === 'chat') {
            const text = String(m.text || '').slice(0, 80).trim();
            if (text) addChat({ from: pl.name, pid: p, text });
          }
        },
        onLeave(p) {
          const pl = players.get(p);
          if (!pl || going) return;
          players.delete(p);
          sys(`${pl.name} 님이 나갔어요`);
          push();
        },
      },
      { signal, tries: 1 },
    );
    const keep = setInterval(() => !going && hub.broadcast(state()), 3000); // 핑 숫자 갱신
    Object.assign(s, {
      setMe(v) {
        Object.assign(players.get(pid), v.car ? { car: v.car, carName: carOf(v.car).name, look: carOf(v.car).look } : {}, v.name ? { name: v.name } : {});
        push();
      },
      setMap(id) {
        mapId = id;
        setLast({ map: id });
        for (const pl of players.values()) if (!pl.host) pl.ready = false; // 맵이 바뀌면 다시 준비
        sys(`맵: ${mapOf(id).title}`);
        push();
      },
      setBots(n) {
        bots = Math.max(0, Math.min(7, n | 0));
        push();
      },
      kick(p) {
        const pl = players.get(p);
        if (!pl || pl.host) return;
        hub.kick(p, { t: 'reject', reason: '방장이 내보냈어요' });
        players.delete(p);
        sys(`${pl.name} 님을 내보냈어요`);
        push();
      },
      sendChat(text) {
        addChat({ from: nick, pid, text });
      },
      allReady: () => s.players().every((p) => p.ready),
      go() {
        if (going) return;
        if (!s.allReady()) {
          toastIn('모두 준비해야 출발할 수 있어요');
          return;
        }
        going = true;
        const list = s.players().sort((a, b) => (a.host ? -1 : b.host ? 1 : (a.joinedAt || 0) - (b.joinedAt || 0)));
        list.forEach((p, i) => (p.slot = i));
        // 봇 실력도 방장 설정으로 통일 (사람마다 다르면 봇 움직임이 달라짐)
        let botLevel = 'normal';
        try {
          botLevel = (JSON.parse(localStorage.getItem('gimmick.settings') || '{}') || {}).botLevel || 'normal';
        } catch {}
        const msg = { t: 'go', map: mapId, bots, botLevel, players: list, code };
        hub.broadcast(msg);
        launch(msg, true);
        setTimeout(() => hub.close(), 2600); // 참가자가 'go'를 받을 시간을 주고 정리
      },
      leave() {
        clearInterval(keep);
        hub.close();
      },
    });
    return s;
  }

  // ---------- 참가자
  async function clientSession(code, signal, patient) {
    let st = { players: [], map: mapId, bots: 0 };
    const chat = [];
    let myPing = 0;
    let gone = false;
    const s = {
      code,
      isHost: false,
      me: () => st.players.find((p) => p.pid === pid) || { ready: false },
      players: () => st.players,
      map: () => st.map,
      bots: () => st.bots,
      chat,
    };
    let rejected = null;
    const link = await joinHub(
      lobbyPeerId(code),
      { pid, name: nick, car: carId },
      {
        onMessage(m) {
          if (m.t === 'state') {
            st = m;
            mapId = m.map;
            renderRoom();
          } else if (m.t === 'welcome') {
            chat.splice(0, chat.length, ...(m.chat || []));
            renderChat();
          } else if (m.t === 'chat') {
            chat.push(m);
            if (chat.length > 60) chat.shift();
            renderChat();
            if (!m.sys && m.pid !== pid) chatSound();
          } else if (m.t === 'reject') {
            rejected = m.reason;
          } else if (m.t === 'go') {
            gone = true;
            launch(m, false);
          }
        },
        onPing(rtt) {
          myPing = rtt;
        },
        onClose() {
          if (gone || !session || session !== s) return;
          session = null;
          err(rejected || '방장이 방을 닫았거나 연결이 끊겼어요');
          codeIn.value = code;
        },
      },
      {
        signal,
        tries: patient ? 300 : 2, // (없는 방은 PeerJS 서버가 약 5초 뒤에 알려 줌 → 2번이면 약 13초)
        delay: patient ? 2500 : 1500,
        onStatus: (t, i) => busySub(patient ? `방장이 로비를 열기를 기다리는 중… (${i})` : `방을 찾는 중… (${i})`),
      },
    );
    const pinger = setInterval(() => link.open && link.send({ t: 'set', ping: myPing }), 2500);
    Object.assign(s, {
      setMe(v) {
        link.send({ t: 'set', ...v });
      },
      setMap() {},
      setBots() {},
      kick() {},
      sendChat(text) {
        link.send({ t: 'chat', text });
      },
      allReady: () => false,
      go() {},
      leave() {
        clearInterval(pinger);
        link.close();
      },
      ping: () => myPing,
    });
    // 처음 상태를 받을 때까지 잠깐 기다림 (거절되면 바로 알림)
    for (let i = 0; i < 40 && !st.code && !rejected && link.open; i++) await new Promise((r) => setTimeout(r, 100));
    if (rejected || !link.open) {
      s.leave();
      throw new Error(rejected || '방에 들어가지 못했어요');
    }
    return s;
  }

  // ------------------------------------------------------------------ 3) 방 화면
  function enterRoom() {
    abort = null;
    views.room.innerHTML = `
      <div class="lb-room">
        <section class="lb-card lb-codecard">
          <div class="lbl">방 코드</div>
          <div class="code" data-act="copyCode" title="눌러서 복사"></div>
          <div class="link"><input readonly id="lbLink"><button class="gm-btn small primary" data-act="copyLink">🔗 초대 링크 복사</button></div>
          <div class="share-row"><button class="gm-btn small" data-act="share" id="lbShare">📤 공유</button><small>링크를 받은 친구는 누르기만 하면 이 방으로 와요</small></div>
        </section>
        <section class="lb-card lb-players"><h3>선수 <span id="lbCount"></span></h3><div class="list" id="lbPlayers"></div></section>
        <section class="lb-card lb-maps"><h3 id="lbMapTitle">맵</h3><div class="grid" id="lbMaps"></div><div class="lb-bots" id="lbBots"></div></section>
        <section class="lb-card lb-mycar"><h3>내 차 <button class="gm-btn small" data-act="rename">✏️ 이름 바꾸기</button></h3><div class="lb-cars" id="lbCars2"></div></section>
        <section class="lb-card lb-chat"><h3>채팅</h3><div class="log" id="lbChat"></div><form id="lbChatForm"><input id="lbChatIn" maxlength="80" placeholder="메시지 입력 후 Enter" autocomplete="off"><button class="gm-btn small">보내기</button></form></section>
        <div class="lb-bar"><button class="gm-btn danger" data-act="leave">← 방 나가기</button><span class="status" id="lbStatus"></span><button class="gm-btn primary" id="lbMain"></button></div>
      </div>`;
    $('#lbLink').value = inviteUrl(session.code);
    if (!navigator.share) $('#lbShare').style.display = 'none';
    renderCarChips($('#lbCars2'));
    $('#lbChatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const i = $('#lbChatIn');
      const t = i.value.trim();
      if (t && session) session.sendChat(t);
      i.value = '';
    });
    $('#lbMain').addEventListener('click', () => {
      if (!session) return;
      if (session.isHost) session.go();
      else session.setMe({ ready: !session.me().ready });
    });
    show('room');
    renderRoom();
    renderChat();
  }

  let mapsBuiltFor = null;
  function renderRoom() {
    if (!session || view !== 'room') return;
    const s = session;
    $('.lb-codecard .code').textContent = s.code;
    const list = s.players();
    $('#lbCount').textContent = `${list.length} / ${MAX_PLAYERS}`;
    $('#lbPlayers').innerHTML =
      list
        .map((p, i) => {
          const [a, b] = lookColors(p.look);
          const me = p.pid === pid;
          const ping = p.host ? '' : p.ping ? `${p.ping} ms` : '…';
          const pingCls = p.host ? '' : p.ping > 180 ? 'bad' : p.ping > 90 ? 'mid' : 'good';
          return `<div class="lb-pl${me ? ' me' : ''}" style="animation-delay:${i * 0.04}s">
            <span class="sw" style="--a:${esc(a)};--b:${esc(b)}">${picHtml(p.car)}</span>
            <div class="who"><b>${p.host ? '👑 ' : ''}${esc(p.name)}${me ? ' <em>(나)</em>' : ''}</b><small>${esc(p.carName || p.car)}</small></div>
            <span class="ping ${pingCls}">${ping}</span>
            <span class="rd ${p.ready ? 'on' : ''}">${p.host ? '방장' : p.ready ? '준비 완료' : '준비 중'}</span>
            ${s.isHost && !p.host ? `<button class="gm-btn small kick" data-act="kick" data-pid="${esc(p.pid)}" title="내보내기">✕</button>` : ''}
          </div>`;
        })
        .join('') + (list.length < 2 ? `<div class="lb-empty">친구를 기다리는 중… 초대 링크를 보내 주세요 <span class="dots"><i></i><i></i><i></i></span></div>` : '');
    // 맵
    const mid = s.map();
    if (mapsBuiltFor !== s.isHost) {
      mapsBuiltFor = s.isHost;
      $('#lbMaps').innerHTML = maps
        .map((m) => `<button class="lb-map" data-map="${esc(m.id)}" ${s.isHost ? '' : 'disabled'}><canvas width="240" height="120" data-thumb="${esc(m.id)}"></canvas><b>${esc(m.title)}</b><small>${esc(m.subtitle || '')}</small></button>`)
        .join('');
      renderMapThumbs();
    }
    el.querySelectorAll('.lb-map').forEach((b) => b.classList.toggle('on', b.dataset.map === mid));
    const mm = mapOf(mid);
    const laps = mapPts[mid] ? ` · ${mapPts[mid].laps}바퀴` : '';
    $('#lbMapTitle').innerHTML = `맵 <span class="sub">${esc(mm.title)}${laps}${s.isHost ? '' : ' · 방장이 골라요'}</span>`;
    const bots = s.bots();
    $('#lbBots').innerHTML = `<span>🤖 컴퓨터 차</span>${
      s.isHost
        ? `<div class="gm-seg">${[0, 1, 3, 5].map((n) => `<button data-act="bots" data-n="${n}" class="${n === bots ? 'on' : ''}">${n ? n + '대' : '없음'}</button>`).join('')}</div>`
        : `<b>${bots ? bots + '대' : '없음'}</b>`
    }`;
    el.querySelectorAll('#lbCars2 [data-car]').forEach((b) => b.classList.toggle('on', b.dataset.car === (s.me().car || carId)));
    // 아래 버튼
    const main = $('#lbMain');
    const status = $('#lbStatus');
    if (s.isHost) {
      const waiting = list.filter((p) => !p.ready).length;
      main.textContent = list.length < 2 ? '혼자 출발 ▶' : '출발! ▶';
      main.disabled = waiting > 0;
      status.textContent = waiting ? `준비 안 된 사람 ${waiting}명` : list.length < 2 ? '혼자서도 연습할 수 있어요' : '모두 준비 완료!';
    } else {
      const r = s.me().ready;
      main.textContent = r ? '준비 취소' : '준비 완료 ✓';
      main.classList.toggle('primary', !r);
      main.disabled = false;
      status.textContent = r ? '방장이 출발하기를 기다리는 중…' : '준비되면 눌러 주세요';
    }
  }
  function renderMapThumbs() {
    el.querySelectorAll('canvas[data-thumb]').forEach((c) => {
      const id = c.dataset.thumb;
      if (c._drawn || !mapPts[id]) return;
      c._drawn = true;
      drawTrackThumb(c, mapPts[id].pts, mapOf(id).theme, { pad: 12 });
    });
  }
  function renderChat() {
    const box = $('#lbChat');
    if (!box || !session) return;
    box.innerHTML = session.chat.map((m) => (m.sys ? `<p class="sys">${esc(m.text)}</p>` : `<p><b>${esc(m.from)}</b> ${esc(m.text)}</p>`)).join('');
    box.scrollTop = box.scrollHeight;
  }
  function renameMe() {
    const n = cleanNick(prompt('새 닉네임 (최대 12자)', nick) || '');
    if (!n) return;
    nick = n;
    setNick(n);
    nickIn.value = n;
    if (session) session.setMe({ name: n });
  }

  // ------------------------------------------------------------------ 출발!
  function launch(msg, asHost) {
    const me = (msg.players || []).find((p) => p.pid === pid);
    saveRoomInfo({ code: session.code, host: asHost, pid, hostPid: (msg.players.find((p) => p.host) || {}).pid, players: msg.players, map: msg.map, bots: msg.bots, at: Date.now() });
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    const q = u.searchParams;
    q.set('map', msg.map);
    q.set('car', (me && me.car) || carId);
    q.set('room', session.code);
    q.set('host', asHost ? '1' : '0');
    q.set('name', nick);
    q.set('mode', 'race');
    q.set('bots', String(msg.bots || 0));
    if (msg.bots && msg.botLevel) q.set('botLevel', msg.botLevel);
    if (me && me.slot != null) q.set('slot', String(me.slot));
    if (new URLSearchParams(location.search).get('net') === 'local') q.set('net', 'local');
    setLast({ map: msg.map, car: (me && me.car) || carId });
    // 3·2·1 화면 → 이동
    const go = $('.lb-go');
    go.classList.add('on');
    $('small', go).textContent = `${mapOf(msg.map).title} · ${msg.players.length}명`;
    let n = 3;
    const step = () => {
      $('.n', go).textContent = n > 0 ? n : 'GO!';
      $('.n', go).style.animation = 'none';
      void go.offsetWidth;
      $('.n', go).style.animation = '';
      beep(n > 0 ? 520 : 880);
      if (n-- > 0) setTimeout(step, 600);
      else setTimeout(() => (location.href = u.toString()), asHost ? 700 : 350);
    };
    step();
  }

  // ------------------------------------------------------------------ 기타
  function leaveRoom() {
    if (session) session.leave();
    session = null;
    show('entry');
    $('#lbErr').textContent = '';
  }
  function leaveOrClose() {
    if (view === 'busy') return cancelBusy();
    if (view === 'room') return leaveRoom();
    close();
  }
  function close() {
    thumbJob.cancel();
    if (session) session.leave();
    session = null;
    if (abort) abort.abort();
    removeEventListener('keydown', onKey, true);
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
    if (game) game.paused = wasPaused;
    current = null;
    if (!game && /[?&]join=/.test(location.search)) history.replaceState(null, '', location.pathname);
    if (opts.onClose) opts.onClose();
  }
  function onKey(e) {
    // 로비가 열려 있는 동안 키는 로비만 씀 (뒤의 홈 화면·게임이 반응하지 않게)
    e.stopImmediatePropagation();
    const typing = e.target && /INPUT|TEXTAREA/.test(e.target.tagName);
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing && e.target.id === 'lbChatIn') return e.target.blur();
      leaveOrClose();
    } else if (e.key === 'Enter' && view === 'entry' && !typing) {
      e.preventDefault();
      startCreate();
    } else if (e.key === 'Enter' && view === 'entry' && e.target === nickIn) {
      e.preventDefault();
      codeIn.value ? startJoin(codeIn.value) : startCreate();
    }
  }
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', (e) => current === api && e.stopImmediatePropagation(), true);

  function copy(text, btn, done) {
    const ok = () => {
      const old = btn.textContent;
      btn.textContent = '✓ ' + done;
      setTimeout(() => (btn.textContent = old), 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text) && ok());
    else fallbackCopy(text) && ok();
  }
  function fallbackCopy(text) {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    let r = false;
    try {
      r = document.execCommand('copy');
    } catch {}
    t.remove();
    return r;
  }
  function shareLink() {
    navigator.share({ title: '기믹 레이싱 같이 하자!', text: `방 코드 ${session.code}`, url: inviteUrl(session.code) }).catch(() => {});
  }
  function toastIn(t) {
    const s = $('#lbStatus');
    if (!s) return;
    s.textContent = t;
    s.classList.remove('flash');
    void s.offsetWidth;
    s.classList.add('flash');
  }
  let ac = null;
  function beep(f, dur = 0.12, vol = 0.05) {
    try {
      ac ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch {}
  }
  const click = () => beep(990, 0.05, 0.03);
  const joinSound = () => (beep(660, 0.1), setTimeout(() => beep(990, 0.12), 90));
  const chatSound = () => beep(1250, 0.06, 0.025);

  // ------------------------------------------------------------------ 시작
  show('entry');
  if (opts.room && opts.host) startCreate(normCode(opts.room)); // 레이스 뒤 같은 코드로 다시 방 열기
  else if (opts.join || opts.room) startJoin(opts.join || opts.room, !!opts.room);
  else setTimeout(() => (nick ? $('[data-act=create]') : nickIn).focus(), 50);
  return api;
}

// ------------------------------------------------------------------ 스타일 (menu.css 색·버튼을 그대로 씀)
function injectCss() {
  if (document.getElementById('lobbyCss')) return;
  const st = document.createElement('style');
  st.id = 'lobbyCss';
  st.textContent = `
#lobby { position: fixed; inset: 0; z-index: 80; color: var(--gm-text, #f3f6fb); font-family: "Pretendard", "Segoe UI", "Malgun Gothic", sans-serif; overflow: hidden; animation: lbIn .25s ease-out; }
#lobby.out { animation: lbOut .22s ease-in forwards; }
@keyframes lbIn { from { opacity: 0; transform: scale(1.02); } }
@keyframes lbOut { to { opacity: 0; } }
#lobby .lb-bg { position: absolute; inset: 0; background: radial-gradient(1100px 700px at 75% 20%, rgba(80, 120, 255, .28), transparent 70%), radial-gradient(900px 600px at 10% 90%, rgba(255, 140, 50, .18), transparent 70%), rgba(5, 8, 18, .93); backdrop-filter: blur(10px); }
#lobby .lb-bg::after { content: ""; position: absolute; inset: 0; opacity: .5; background-image: radial-gradient(rgba(255,255,255,.07) 1px, transparent 1px); background-size: 22px 22px; }
#lobby .lb-top { position: absolute; left: 0; right: 0; top: 0; display: flex; justify-content: space-between; align-items: center; padding: 20px 30px; z-index: 2; }
#lobby .lb-title { display: flex; gap: 14px; align-items: center; }
#lobby .lb-title .globe { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; font-size: 26px; background: conic-gradient(from 160deg, #3a7bff, #7d5cff, #29d3ff, #3a7bff); box-shadow: 0 6px 22px rgba(70, 120, 255, .45); }
#lobby .lb-title b { display: block; font-family: var(--gm-title, sans-serif); font-size: 28px; font-weight: 400; font-style: italic; letter-spacing: .02em; }
#lobby .lb-title small { color: var(--gm-dim, #95a2bb); font-size: 12.5px; font-weight: 700; }
#lobby .lb-view { position: absolute; inset: 92px 30px 24px; display: none; z-index: 2; overflow: auto; }
#lobby .lb-view.on { display: block; animation: lbUp .28s ease-out; }
@keyframes lbUp { from { opacity: 0; transform: translateY(10px); } }
#lobby .lb-card { background: var(--gm-panel, rgba(13,19,36,.82)); border: 1px solid var(--gm-line, rgba(255,255,255,.09)); border-radius: 18px; padding: 18px 20px; }
#lobby .lb-card h3 { margin: 0 0 12px; font-size: 13px; letter-spacing: .08em; color: var(--gm-accent, #ffcf3f); font-weight: 800; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
#lobby .lb-card h3 .sub { color: var(--gm-text, #fff); letter-spacing: 0; font-size: 14px; margin-left: 6px; flex: 1; }
#lobby input { font: inherit; font-weight: 700; color: var(--gm-text, #fff); background: rgba(0,0,0,.35); border: 1px solid var(--gm-line2, rgba(255,255,255,.18)); border-radius: 11px; padding: 11px 14px; outline: none; min-width: 0; }
#lobby input:focus { border-color: var(--gm-accent, #ffcf3f); box-shadow: 0 0 0 3px rgba(255, 207, 63, .18); }
#lobby .gm-btn:disabled { opacity: .45; cursor: not-allowed; filter: grayscale(.4); }
/* 입장 */
#lobby .lb-entry { max-width: 980px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
#lobby .lb-me { grid-column: 1 / -1; display: grid; gap: 14px; }
#lobby .lb-field { display: grid; grid-template-columns: 80px 1fr; gap: 12px; align-items: center; }
#lobby .lb-field > span { color: var(--gm-dim, #95a2bb); font-weight: 800; font-size: 13px; }
#lobby .lb-cars { display: flex; flex-wrap: wrap; gap: 8px; }
#lobby .lb-chip { appearance: none; display: flex; align-items: center; gap: 8px; border: 1px solid var(--gm-line2, rgba(255,255,255,.18)); background: rgba(255,255,255,.04); color: inherit; font: inherit; font-size: 13px; font-weight: 800; padding: 7px 12px 7px 8px; border-radius: 30px; cursor: pointer; transition: .15s; }
#lobby .lb-chip i { width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 2px rgba(255,255,255,.25); }
#lobby .lb-chip:hover { border-color: var(--gm-accent, #ffcf3f); }
#lobby .lb-chip.on { background: rgba(255, 207, 63, .16); border-color: var(--gm-accent, #ffcf3f); box-shadow: 0 0 0 2px rgba(255,207,63,.35); }
#lobby .lb-big { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 26px 26px 24px; position: relative; overflow: hidden; }
#lobby .lb-big .ic { font-size: 40px; filter: drop-shadow(0 6px 14px rgba(0,0,0,.4)); }
#lobby .lb-big h3 { font-size: 24px; color: var(--gm-text, #fff); letter-spacing: 0; margin: 0; font-family: var(--gm-title, sans-serif); font-weight: 400; font-style: italic; }
#lobby .lb-big p { margin: 0 0 6px; color: var(--gm-dim, #95a2bb); font-size: 13.5px; line-height: 1.5; }
#lobby .lb-big.create { background: linear-gradient(150deg, rgba(255, 154, 46, .2), rgba(13,19,36,.85) 60%); }
#lobby .lb-big.join { background: linear-gradient(150deg, rgba(70, 130, 255, .22), rgba(13,19,36,.85) 60%); }
#lobby .lb-big::after { content: ""; position: absolute; right: -40px; top: -40px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(rgba(255,255,255,.08), transparent 70%); }
#lobby .lb-code-in { display: flex; gap: 8px; width: 100%; }
#lobby .lb-code-in input { flex: 1; font-size: 22px; letter-spacing: .3em; text-transform: uppercase; text-align: center; font-weight: 900; }
#lobby .lb-err { grid-column: 1 / -1; margin: 0; min-height: 20px; color: #ff8a7a; font-weight: 800; text-align: center; }
#lobby .lb-note { grid-column: 1 / -1; margin: 0; color: var(--gm-dim, #95a2bb); font-size: 12px; text-align: center; }
/* 연결 중 */
#lobby .lb-busy { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; }
#lobby .lb-busy h2 { margin: 10px 0 0; font-size: 24px; }
#lobby .lb-busy p { margin: 0 0 12px; color: var(--gm-dim, #95a2bb); font-weight: 700; min-height: 20px; }
#lobby .spin { width: 58px; height: 58px; border-radius: 50%; border: 5px solid rgba(255,255,255,.1); border-top-color: var(--gm-accent, #ffcf3f); border-right-color: var(--gm-accent2, #ff9a2e); animation: lbSpin .8s linear infinite; }
@keyframes lbSpin { to { transform: rotate(360deg); } }
/* 방 */
#lobby .lb-room { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(320px, 1.25fr); grid-template-rows: auto 1fr auto auto; grid-template-areas: "code maps" "players maps" "players car" "chat chat" "bar bar"; gap: 14px; min-height: 100%; }
#lobby .lb-codecard { grid-area: code; display: grid; gap: 8px; background: linear-gradient(140deg, rgba(255, 207, 63, .16), rgba(13,19,36,.85) 55%); }
#lobby .lb-codecard .lbl { font-size: 12px; font-weight: 800; color: var(--gm-dim, #95a2bb); letter-spacing: .12em; }
#lobby .lb-codecard .code { font-family: "Consolas", "Pretendard", monospace; font-size: 54px; font-weight: 900; letter-spacing: .22em; line-height: 1; cursor: pointer; color: #fff; text-shadow: 0 0 24px rgba(255, 207, 63, .45); }
#lobby .lb-codecard .link { display: flex; gap: 8px; }
#lobby .lb-codecard .link input { flex: 1; font-size: 12px; padding: 8px 10px; color: #c6cfdf; }
#lobby .share-row { display: flex; gap: 10px; align-items: center; color: var(--gm-dim, #95a2bb); font-size: 12px; }
#lobby .lb-players { grid-area: players; display: flex; flex-direction: column; }
#lobby .lb-players .list { display: grid; gap: 8px; align-content: start; }
#lobby .lb-pl { display: grid; grid-template-columns: 76px 1fr auto auto auto; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 13px; background: rgba(255,255,255,.04); border: 1px solid var(--gm-line, rgba(255,255,255,.09)); animation: lbUp .25s ease-out both; }
#lobby .lb-pl.me { border-color: rgba(255, 207, 63, .45); background: rgba(255, 207, 63, .07); }
#lobby .lb-pl .sw { width: 76px; height: 48px; border-radius: 12px; position: relative; overflow: hidden; flex: none; background: radial-gradient(ellipse 70% 60% at 50% 70%, color-mix(in srgb, var(--a) 45%, transparent), transparent 75%), linear-gradient(160deg, rgba(255,255,255,.07), rgba(255,255,255,.01)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
#lobby .lb-pl .sw img, #lobby .lb-pl .sw .ph { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
#lobby .lb-pl .sw .ph { background: linear-gradient(135deg, var(--a) 55%, var(--b) 56%); border-radius: 50%; inset: 12px 26px; width: auto; height: auto; opacity: .7; }
/* 내 차 고르기: 사진 카드 */
#lobby .lb-cars { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 10px; }
#lobby .lb-car { appearance: none; position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 1px; padding: 0 0 8px; border-radius: 14px; border: 1px solid rgba(255,255,255,.12); background: linear-gradient(170deg, rgba(255,255,255,.06), rgba(255,255,255,.015)); color: inherit; font: inherit; text-align: left; cursor: pointer; overflow: hidden; transition: transform .15s, border-color .15s, box-shadow .15s, background .15s; }
#lobby .lb-car .pic { position: relative; display: block; height: 74px; background: radial-gradient(ellipse 65% 55% at 50% 68%, color-mix(in srgb, var(--cc) 34%, transparent), transparent 72%); }
#lobby .lb-car .pic img { position: absolute; inset: 2px 4px 0; width: calc(100% - 8px); height: calc(100% - 2px); object-fit: contain; transition: transform .2s; filter: drop-shadow(0 6px 8px rgba(0,0,0,.35)); }
#lobby .lb-car .pic img.in { animation: lbPicIn .35s ease-out; }
@keyframes lbPicIn { from { opacity: 0; transform: translateY(4px) scale(.96); } }
#lobby .lb-car .pic .ph, #lobby .lb-pl .sw .ph.sh { position: absolute; inset: 18px 22px; border-radius: 10px; background: linear-gradient(100deg, rgba(255,255,255,.04) 30%, rgba(255,255,255,.14) 50%, rgba(255,255,255,.04) 70%); background-size: 300% 100%; animation: lbShim 1.2s linear infinite; }
@keyframes lbShim { from { background-position: 100% 0; } to { background-position: -100% 0; } }
#lobby .lb-car .cl { position: absolute; left: 7px; top: 7px; width: 19px; height: 19px; border-radius: 6px; display: grid; place-items: center; font-style: normal; font-size: 11px; font-weight: 900; color: #10131c; background: var(--cc); box-shadow: 0 2px 6px rgba(0,0,0,.35); }
#lobby .lb-car .chk { position: absolute; right: 7px; top: 7px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 900; color: #10131c; background: var(--gm-accent, #ffcf3f); opacity: 0; transform: scale(.5); transition: .15s; }
#lobby .lb-car b { padding: 0 10px; font-size: 13.5px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#lobby .lb-car small { padding: 0 10px; font-size: 11px; font-weight: 700; color: color-mix(in srgb, var(--cc) 70%, #cfd6e6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#lobby .lb-car:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--cc) 60%, transparent); }
#lobby .lb-car:hover .pic img { transform: scale(1.06); }
#lobby .lb-car.on { border-color: var(--gm-accent, #ffcf3f); background: linear-gradient(170deg, rgba(255,207,63,.16), rgba(255,207,63,.03)); box-shadow: 0 0 0 2px rgba(255,207,63,.35), 0 8px 22px rgba(0,0,0,.3); }
#lobby .lb-car.on .chk { opacity: 1; transform: none; }
#lobby .lb-car:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
@media (max-width: 520px) { #lobby .lb-cars { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; } #lobby .lb-car .pic { height: 60px; } }
#lobby .lb-pl .who b { display: block; font-size: 15px; }
#lobby .lb-pl .who em { font-style: normal; color: var(--gm-accent, #ffcf3f); font-size: 12px; }
#lobby .lb-pl .who small { color: var(--gm-dim, #95a2bb); font-size: 12px; font-weight: 700; }
#lobby .lb-pl .ping { font-size: 11px; font-weight: 800; color: var(--gm-dim, #95a2bb); font-variant-numeric: tabular-nums; }
#lobby .lb-pl .ping.good { color: #7dff6a; } #lobby .lb-pl .ping.mid { color: #ffcf3f; } #lobby .lb-pl .ping.bad { color: #ff6a5a; }
#lobby .lb-pl .rd { font-size: 12px; font-weight: 900; padding: 5px 10px; border-radius: 20px; background: rgba(255,255,255,.08); color: var(--gm-dim, #95a2bb); }
#lobby .lb-pl .rd.on { background: rgba(125, 255, 106, .16); color: #7dff6a; box-shadow: 0 0 0 1px rgba(125,255,106,.4); }
#lobby .lb-pl .kick { padding: 4px 9px; }
#lobby .lb-empty { margin-top: 6px; padding: 16px; border-radius: 13px; border: 1px dashed var(--gm-line2, rgba(255,255,255,.18)); color: var(--gm-dim, #95a2bb); font-weight: 700; font-size: 13px; text-align: center; }
#lobby .dots i { display: inline-block; width: 5px; height: 5px; margin: 0 2px; border-radius: 50%; background: currentColor; animation: lbDot 1.2s infinite; }
#lobby .dots i:nth-child(2) { animation-delay: .2s; } #lobby .dots i:nth-child(3) { animation-delay: .4s; }
@keyframes lbDot { 50% { opacity: .2; } }
#lobby .lb-maps { grid-area: maps; }
#lobby .lb-maps .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
#lobby .lb-map { appearance: none; text-align: left; font: inherit; color: inherit; padding: 0 0 10px; border-radius: 13px; overflow: hidden; border: 1px solid var(--gm-line2, rgba(255,255,255,.18)); background: rgba(255,255,255,.03); cursor: pointer; transition: .15s; }
#lobby .lb-map canvas { width: 100%; aspect-ratio: 2 / 1; display: block; }
#lobby .lb-map b { display: block; padding: 8px 10px 0; font-size: 14px; }
#lobby .lb-map small { display: block; padding: 2px 10px 0; color: var(--gm-dim, #95a2bb); font-size: 11.5px; font-weight: 700; }
#lobby .lb-map:not(:disabled):hover { transform: translateY(-2px); border-color: var(--gm-accent, #ffcf3f); }
#lobby .lb-map:disabled { cursor: default; opacity: .55; }
#lobby .lb-map.on { opacity: 1; border-color: var(--gm-accent, #ffcf3f); box-shadow: 0 0 0 2px var(--gm-accent, #ffcf3f), 0 10px 26px rgba(255, 207, 63, .2); }
#lobby .lb-bots { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--gm-line, rgba(255,255,255,.09)); font-weight: 800; font-size: 13px; }
#lobby .lb-mycar { grid-area: car; }
#lobby .lb-chat { grid-area: chat; display: grid; grid-template-columns: 1fr; }
#lobby .lb-chat .log { height: 92px; overflow: auto; font-size: 13px; line-height: 1.55; padding-right: 6px; }
#lobby .lb-chat .log p { margin: 0; }
#lobby .lb-chat .log b { color: var(--gm-accent, #ffcf3f); margin-right: 4px; }
#lobby .lb-chat .log .sys { color: var(--gm-dim, #95a2bb); font-size: 12px; }
#lobby .lb-chat form { display: flex; gap: 8px; margin-top: 8px; }
#lobby .lb-chat form input { flex: 1; padding: 8px 12px; }
#lobby .lb-bar { grid-area: bar; display: flex; align-items: center; gap: 14px; position: sticky; bottom: 0; padding: 18px 0 2px; background: linear-gradient(rgba(6, 9, 20, 0), rgba(6, 9, 20, .96) 40%); }
#lobby .lb-bar .status { flex: 1; text-align: right; color: var(--gm-dim, #95a2bb); font-weight: 800; font-size: 14px; }
#lobby .lb-bar .status.flash { animation: lbFlash .6s; color: #ff8a7a; }
@keyframes lbFlash { 30% { transform: translateX(-6px); } 60% { transform: translateX(4px); } }
#lobby #lbMain { min-width: 190px; font-size: 18px; padding: 14px 24px; }
/* 출발 3·2·1 */
#lobby .lb-go { position: absolute; inset: 0; z-index: 5; display: none; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,.6); }
#lobby .lb-go.on { display: flex; }
#lobby .lb-go .n { font-family: var(--gm-title, sans-serif); font-size: 160px; font-style: italic; color: #fff; text-shadow: 0 0 40px rgba(255, 154, 46, .8); animation: lbPop .5s ease-out; }
#lobby .lb-go small { color: var(--gm-dim, #95a2bb); font-weight: 800; font-size: 16px; }
@keyframes lbPop { from { transform: scale(1.6); opacity: 0; } }
@media (max-width: 820px) {
  #lobby .lb-top { padding: 14px 16px; } #lobby .lb-title small { display: none; }
  #lobby .lb-view { inset: 78px 16px 16px; }
  #lobby .lb-entry { grid-template-columns: 1fr; }
  #lobby .lb-room { grid-template-columns: 1fr; grid-template-areas: "code" "players" "maps" "car" "chat" "bar"; }
  #lobby .lb-codecard .code { font-size: 42px; }
  #lobby .lb-field { grid-template-columns: 1fr; gap: 6px; }
}`;
  document.head.appendChild(st);
}
