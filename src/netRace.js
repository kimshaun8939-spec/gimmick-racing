// 온라인 레이스 (게임 화면 안): 주소에 ?room=CODE&host=1|0&name=닉네임 이 있으면 main.js가 startNetRace(game, params)를 부름
//
// 하는 일 (쉬운 설명)
//   1) 로비에서 출발하면 페이지를 새로 불러오므로, 여기서 다시 연결함 (방장 아이디 = gimmickracing-<코드>-r)
//   2) 모두 연결될 때까지 출발 신호를 멈춰 둠 (game.raceCtl.holdStart). 방장은 "지금 출발" 버튼으로 기다리지 않고 시작 가능
//   3) 방장이 "몇 초 뒤 출발"을 방장 시계로 알려 줌 → 각자 핑으로 잰 시계 차이만큼 보정해서 같은 순간에 빨간불 시작
//   4) 1초에 20번 내 차 위치를 보내고, 다른 사람 차는 game.opponents로 보여 줌 (부드럽게 따라가기·조금 앞 예측은 opponents.js)
//   5) 완주하면 기록을 보내고, 방장이 모은 결과를 모두에게 보여 줌 → "로비로 돌아가기"로 같은 방에서 다시
import { createHub, joinHub, racePeerId, loadRoomInfo, myPid, cleanNick, getNick, normCode, NET_VERSION } from './net.js';

const SEND_HZ = 20;
const WAIT_ALL_MS = 45000; // 이만큼 기다려도 다 안 오면 방장 쪽에서 그냥 출발
const START_LEAD_MS = 3200; // 출발 신호를 보내고 실제로 빨간불이 켜지기까지 (메시지가 도착할 시간)

export async function startNetRace(game, params) {
  if (!game || game.net) return game && game.net;
  const code = normCode(params.get('room'));
  if (!code) return null;
  const isHost = params.get('host') === '1';
  const pid = myPid();
  const info = loadRoomInfo(code);
  const name = cleanNick(params.get('name')) || getNick() || '선수';
  const me = { pid, name, car: game.carId, carName: game.carName, look: game.carCfg && game.carCfg.look, host: isHost };
  const race = game.race;
  const totalLaps = () => (game.track && game.track.data && game.track.data.laps) || race.totalLaps || 1;

  const net = {
    code,
    isHost,
    pid,
    players: new Map(), // pid → { pid, name, car, carName, look, host, opp(화면 핸들), last(마지막 상태), connected }
    results: new Map(), // pid → { pid, name, carName, time, laps, best }
    started: false,
    startAt: 0, // 방장 시계 기준 출발(빨간불 시작) 시각
    lightsOut: 0,
    ping: 0,
    link: null,
    hub: null,
  };
  game.net = net;
  const ui = createUi(net, { roster: (info && info.players) || [], isHost, onStartNow: () => hostStart(true), onLobby: backToLobby, onHome: goHome });

  // ---------------------------------------------------------------- 출발 멈추기 / 시작 (race 담당 raceCtl, 없으면 직접)
  let holding = true;
  const ctl = () => game.raceCtl;
  function hold(on) {
    holding = on;
    if (ctl() && ctl().holdStart) return ctl().holdStart(on);
    if (on) {
      race.phase = 'countdown';
      race.lightsT = 0;
      race.lights = 0;
      race.lightsOutAt = 1e9;
    }
  }
  function startLights(lo) {
    holding = false;
    if (ctl() && ctl().startCountdown) {
      ctl().startCountdown({ wait: Math.max(0, lo - 4.1), lightsOutAt: lo }); // (wait = 빨간불 5개가 다 켜진 뒤 기다리는 시간)
      ctl().holdStart && ctl().holdStart(false);
    } else if (race.phase !== 'countdown') game.resetRace();
    race.lightsT = 0;
    race.lights = 0;
    if (lo) race.lightsOutAt = lo; // 모두 같은 순간에 불이 꺼지게 (방장이 정한 값)
  }
  // 출발 그리드 칸: 로비에서 방장이 정한 순서 (0 = 맨 앞). 사람 칸 다음에 봇
  const slot = parseInt(params.get('slot'), 10);
  const humans = info && info.players ? info.players.length : 1;
  const botN = parseInt(params.get('bots'), 10) || 0;
  if (Number.isFinite(slot) && ctl() && ctl().setGrid) {
    try {
      ctl().setGrid(Math.max(0, slot), Math.max(humans + botN, slot + 1), humans);
    } catch (e) {
      console.warn('[net] setGrid', e);
    }
  }
  hold(true);

  // ---------------------------------------------------------------- 상대 차 화면 (race 담당 game.opponents, 없으면 직접 만듦)
  let opps = game.opponents;
  let ownOpps = null;
  if (!opps) {
    try {
      const m = await import('./opponents.js');
      opps = ownOpps = m.createOpponents(game.scene);
    } catch (e) {
      console.warn('[net] 상대 차 화면을 만들 수 없음', e);
    }
  }
  function ensurePlayer(p) {
    if (!p || p.pid === pid) return null;
    let pl = net.players.get(p.pid);
    if (!pl) {
      pl = { ...p, connected: true, opp: null, last: null };
      net.players.set(p.pid, pl);
      if (opps) pl.opp = opps.add({ id: 'net:' + p.pid, name: p.name, look: p.look, carName: p.carName, remote: true });
      ui.toast(`🟢 ${p.name} 님이 들어왔어요`);
    } else {
      Object.assign(pl, { name: p.name, connected: true });
    }
    ui.refresh();
    return pl;
  }
  function dropPlayer(id, why) {
    const pl = net.players.get(id);
    if (!pl) return;
    if (pl.opp) pl.opp.remove();
    net.players.delete(id);
    ui.toast(`🔴 ${pl.name} 님이 ${why || '나갔어요'}`);
    ui.refresh();
  }
  function applyState(id, s) {
    const pl = net.players.get(id);
    if (!pl || !s.p) return;
    pl.last = s;
    pl.lastAt = performance.now();
    if (pl.opp)
      pl.opp.set({
        pos: s.p, fwd: s.f, up: s.u, speed: s.v, lap: s.l, progress: s.pr, finished: !!s.fin, finishTime: s.ft ?? null, bestLap: s.bl ?? null,
        mode: s.m, form: s.fo || null, flying: !!s.fl, drifting: !!s.dr,
      });
  }

  // ---------------------------------------------------------------- 내 상태 보내기
  const r2 = (x) => Math.round(x * 100) / 100;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  function myProgress() {
    const laps = totalLaps();
    if (ctl() && ctl().progress) return Math.max(0, Math.min(laps, ctl().progress()));
    if (race.phase === 'finished') return laps;
    let t = game.car.trackInfo ? game.car.trackInfo.t : race.lastT || 0;
    if (race.nextCp === 0 && t > 0.5) t -= 1; // 출발선 바로 뒤(지난 바퀴 끝부분)
    return Math.max(0, Math.min(laps, (race.lap - 1) + t));
  }
  function myState() {
    const c = game.car;
    return {
      t: 's',
      id: pid,
      ts: Math.round(nowHost()),
      p: [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)],
      f: [r3(c.fwd.x), r3(c.fwd.y), r3(c.fwd.z)],
      u: [r3(c.up.x), r3(c.up.y), r3(c.up.z)],
      v: r2(c.forwardSpeed || 0),
      l: Math.min(race.lap, totalLaps()),
      pr: r3(myProgress()),
      m: c.mode,
      fo: c.form || 0,
      fl: c.flying ? 1 : 0,
      dr: c.drifting ? 1 : 0,
      fin: race.phase === 'finished' ? 1 : 0,
      ft: race.phase === 'finished' ? r2(totalTime()) : undefined,
      bl: Number.isFinite(race.best) ? r2(race.best) : undefined,
    };
  }
  const totalTime = () => race.lapTimes.reduce((a, b) => a + b, 0);
  const nowHost = () => (isHost ? performance.now() : net.link ? net.link.hostNow() : performance.now());
  let sentFinish = false;
  let sendN = 0;
  const sender = setInterval(() => {
    if (!game.car) return;
    // 5명 이상이면 1초에 15번으로 줄임 (방장이 모두에게 전달하므로 방장 인터넷 부담이 사람 수의 제곱으로 늘어남)
    const skip = net.players.size >= 4 && ++sendN % 4 === 0;
    const s = skip ? null : myState();
    if (!s) {
      /* 이번엔 건너뜀 */
    } else if (isHost && net.hub) net.hub.fast(s);
    else if (net.link && net.link.open) net.link.fast(s);
    // 완주 → 기록 보내기 (한 번)
    if (race.phase === 'finished' && !sentFinish && net.started) {
      sentFinish = true;
      const fin = { t: 'fin', id: pid, name, carName: game.carName, time: r2(totalTime()), laps: race.lapTimes.map(r2), best: Number.isFinite(race.best) ? r2(race.best) : null };
      if (isHost) addResult(fin);
      else if (net.link) net.link.send(fin);
      ui.showResults();
    }
    if (race.phase !== 'finished' && sentFinish && race.phase === 'countdown') sentFinish = false; // (다시 시작한 경우)
  }, 1000 / SEND_HZ);

  // ---------------------------------------------------------------- 결과
  function addResult(r) {
    if (!r || !r.id || net.results.has(r.id)) return;
    net.results.set(r.id, { pid: r.id, name: r.name, carName: r.carName, time: r.time, laps: r.laps, best: r.best });
    if (isHost && net.hub) net.hub.broadcast({ t: 'results', list: [...net.results.values()] });
    const pl = net.players.get(r.id);
    if (r.id !== pid) ui.toast(`🏁 ${r.name} 님 완주! ${fmt(r.time)}`);
    if (pl) pl.finished = true;
    ui.refresh();
  }
  net.standings = () => {
    // 완주한 사람은 시간 순, 나머지는 진행 순
    const rows = [];
    const meRow = { pid, name, carName: game.carName, me: true, progress: myProgress(), lap: race.lap };
    rows.push(meRow);
    for (const pl of net.players.values()) rows.push({ pid: pl.pid, name: pl.name, carName: pl.carName, progress: pl.last ? pl.last.pr : 0, lap: pl.last ? pl.last.l : 1, gone: !pl.connected });
    for (const r of rows) {
      const res = net.results.get(r.pid);
      if (res) Object.assign(r, { time: res.time, best: res.best, finished: true });
    }
    rows.sort((a, b) => (a.finished && b.finished ? a.time - b.time : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress));
    return rows;
  };

  // ---------------------------------------------------------------- 출발 신호
  let startTimer = 0;
  let lightsOn = false;
  function scheduleStart(at, lo) {
    if (net.started) return;
    net.started = true;
    net.startAt = at;
    net.lightsOut = lo;
    const delay = at - nowHost();
    clearTimeout(startTimer);
    ui.countdown(at);
    startTimer = setTimeout(() => {
      // 늦게 들어와서 이미 지난 시각이면: 지난 만큼 불 진행을 앞당김
      const late = Math.max(0, (nowHost() - at) / 1000);
      startLights(lo);
      lightsOn = true;
      if (late > 0.05) race.lightsT = Math.min(late, lo - 0.6);
      ui.started();
    }, Math.max(0, delay));
  }
  function hostStart(force) {
    if (!isHost || net.started) return;
    const expected = expectedPids();
    const missing = expected.filter((p) => !net.players.has(p));
    if (missing.length && !force) return;
    const at = performance.now() + START_LEAD_MS;
    const lo = 3.4 + 0.7 + Math.random() * 1.6; // main.js resetRace와 같은 규칙 (빨간불 5개 + 0.7~2.3초)
    net.hub.broadcast({ t: 'start', at, lo });
    scheduleStart(at, lo);
  }
  const expectedPids = () => (info && info.players ? info.players.map((p) => p.pid).filter((p) => p !== pid) : []);

  // ---------------------------------------------------------------- 방장
  async function runHost() {
    ui.status('방을 여는 중…');
    try {
      net.hub = await createHub(
        racePeerId(code),
        {
          onJoin(p, link) {
            const h = link.hello || {};
            if (h.v !== NET_VERSION) return net.hub.kick(p, { t: 'reject', reason: '게임 버전이 달라요. 새로고침해 주세요.' });
            ensurePlayer({ pid: p, name: cleanNick(h.name) || '손님', car: h.car, carName: h.carName, look: h.look, host: false });
            net.hub.send(p, { t: 'welcome', you: p, started: net.started, at: net.startAt, lo: net.lightsOut, results: [...net.results.values()] });
            net.hub.broadcast({ t: 'players', list: allPlayers() });
            if (!net.started && expectedPids().every((x) => net.players.has(x))) setTimeout(() => hostStart(false), 600); // 다 모임 → 출발
          },
          onFast(p, msg) {
            if (msg.t !== 's') return;
            msg.id = p;
            applyState(p, msg);
            net.hub.fast(msg, p); // 다른 사람에게 전달
          },
          onMessage(p, msg) {
            if (msg.t === 'fin') addResult({ ...msg, id: p });
            else if (msg.t === 'emote') net.hub.broadcast({ ...msg, id: p }), ui.emote(net.players.get(p), msg.e);
          },
          onLeave(p) {
            dropPlayer(p, '나갔어요');
            net.hub.broadcast({ t: 'left', id: p });
          },
        },
        { tries: 20, delay: 1500, onStatus: (t) => ui.status(t) },
      );
    } catch (e) {
      ui.status('연결 실패: ' + e.message + ' → 혼자 달려요', true);
      setTimeout(() => !net.started && scheduleStart(performance.now() + 500, 4.5), 1500);
      return;
    }
    ui.status('');
    ui.refresh();
    const expected = expectedPids();
    if (!expected.length) setTimeout(() => hostStart(true), 800); // 혼자 → 바로
    else setTimeout(() => hostStart(true), WAIT_ALL_MS); // 너무 오래 안 오면 출발
  }
  const allPlayers = () => [me, ...[...net.players.values()].map(({ pid, name, car, carName, look }) => ({ pid, name, car, carName, look }))];

  // ---------------------------------------------------------------- 참가자
  let reconnects = 0;
  async function runClient() {
    ui.status(reconnects ? '다시 연결하는 중…' : '방장에게 연결하는 중…');
    try {
      net.link = await joinHub(racePeerId(code), { pid, name, car: me.car, carName: me.carName, look: me.look }, {
        onMessage(m) {
          if (m.t === 'welcome') {
            if (m.started && !net.started) scheduleStart(m.at, m.lo);
            for (const r of m.results || []) addResult({ ...r, id: r.pid });
          } else if (m.t === 'players') {
            for (const p of m.list) if (p.pid !== pid) ensurePlayer(p);
            const ids = new Set(m.list.map((p) => p.pid));
            for (const id of [...net.players.keys()]) if (!ids.has(id)) dropPlayer(id);
          } else if (m.t === 'start') scheduleStart(m.at, m.lo);
          else if (m.t === 'results') for (const r of m.list) addResult({ ...r, id: r.pid });
          else if (m.t === 'left') dropPlayer(m.id);
          else if (m.t === 'reject') ui.status(m.reason, true);
          else if (m.t === 'emote') ui.emote(net.players.get(m.id), m.e);
        },
        onFast(m) {
          if (m.t === 's' && m.id !== pid) applyState(m.id, m);
        },
        onPing(rtt) {
          net.ping = rtt;
          ui.refresh();
        },
        onClose() {
          net.link = null;
          ui.toast('⚠️ 방장과 연결이 끊겼어요');
          for (const id of [...net.players.keys()]) dropPlayer(id, '연결이 끊겼어요');
          if (reconnects++ < 5) setTimeout(runClient, 2000);
          else ui.status('방장과 연결이 끊겼어요 (혼자 계속 달릴 수 있어요)', true);
          ui.refresh();
        },
      }, { tries: 30, delay: 2000, onStatus: (t, i) => ui.status(`${t} (${i})`) });
    } catch (e) {
      ui.status('방장을 찾지 못했어요 → 혼자 달려요', true);
      if (!net.started) setTimeout(() => scheduleStart(performance.now() + 500, 4.5), 1500);
      return;
    }
    ui.status('');
    ui.refresh();
  }

  // ---------------------------------------------------------------- 매 화면 (main.js가 부르는 model.sync에 살짝 끼워 넣음 → game.tick에서도 돎)
  const origSync = game.model.sync.bind(game.model);
  game.model.sync = (car, dt, t) => {
    origSync(car, dt, t);
    if (holding && !(ctl() && ctl().holdStart) && race.phase === 'countdown') {
      race.lightsT = 0; // (raceCtl이 없을 때) 출발 신호를 멈춰 둠
      race.lightsOutAt = 1e9;
    }
    // 화면이 버벅여서 내 빨간불이 방장 시계보다 늦어지면 따라잡음 (앞서는 쪽은 그대로: game.tick 테스트용)
    if (lightsOn && race.phase === 'countdown' && !holding) {
      const ct = (nowHost() - net.startAt) / 1000;
      if (ct > race.lightsT + 0.05 && ct < net.lightsOut + 0.5) race.lightsT = ct;
    }
    if (ownOpps && dt < 1) ownOpps.render(dt, t, game.camera, (e) => [e.name, '']);
    ui.frame(dt);
  };

  // ---------------------------------------------------------------- 로비 / 홈
  function closeNet() {
    clearInterval(sender);
    clearTimeout(startTimer);
    if (net.hub) net.hub.close();
    if (net.link) (net.link.close(), (net.link = null));
    for (const id of [...net.players.keys()]) {
      const pl = net.players.get(id);
      if (pl.opp) pl.opp.remove();
    }
    net.players.clear();
    reconnects = 99;
  }
  async function backToLobby() {
    closeNet();
    ui.hideResults();
    const { openLobby } = await import('./lobby.js');
    openLobby({ room: code, host: isHost, map: game.mapName, car: game.carId, name, onClose: goHome });
  }
  function goHome() {
    closeNet();
    const u = new URL(location.href);
    u.search = '';
    location.href = u.toString();
  }
  net.backToLobby = backToLobby;
  net.close = closeNet;
  net.emote = (e) => {
    const msg = { t: 'emote', e, id: pid };
    if (isHost && net.hub) net.hub.broadcast(msg);
    else if (net.link) net.link.send(msg);
    ui.emote({ name: name + ' (나)' }, e);
  };

  if (isHost) runHost();
  else runClient();
  return net;
}

// =====================================================================================
// 화면: 대기 카드, 오른쪽 위 접속 표시, 알림, 결과 카드
// =====================================================================================
const fmt = (s) => {
  if (s == null || !Number.isFinite(s)) return '--:--.---';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const EMOTES = ['👍', '😂', '😮', '🔥', 'GG'];

function createUi(net, { roster, isHost, onStartNow, onLobby, onHome }) {
  injectCss();
  const root = document.createElement('div');
  root.id = 'netRace';
  root.innerHTML = `
    <div class="nr-badge"><span class="dot"></span><b>🌐 ${esc(net.code)}</b><span class="cnt"></span><span class="ping"></span></div>
    <div class="nr-toasts"></div>
    <div class="nr-wait on">
      <div class="card">
        <div class="hd"><span class="spin"></span><div><b>온라인 레이스 · 방 ${esc(net.code)}</b><small class="st">연결하는 중…</small></div></div>
        <div class="list"></div>
        <div class="cd"></div>
        <div class="btns">${isHost ? '<button class="gm-btn primary small" data-a="now">지금 출발 ▶</button>' : ''}<button class="gm-btn small" data-a="home">나가기</button></div>
      </div>
    </div>
    <div class="nr-dock"><button class="gm-btn primary" data-a="lobby">🌐 로비로 돌아가기</button><button class="gm-btn" data-a="live">📋 온라인 순위</button></div>
    <div class="nr-emotes">${EMOTES.map((e, i) => `<button data-e="${e}" title="${i + 6}번 키">${e}</button>`).join('')}</div>
    <div class="nr-res">
      <div class="card">
        <h3>🏁 온라인 결과 <small>방 ${esc(net.code)}</small></h3>
        <div class="rows"></div>
        <div class="btns"><button class="gm-btn primary" data-a="lobby">↺ 로비로 돌아가기</button><button class="gm-btn" data-a="home">홈으로</button><button class="gm-btn small" data-a="hide">닫기</button></div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    const em = e.target.closest('[data-e]');
    if (em) {
      em.blur();
      return net.emote && net.emote(em.dataset.e);
    }
    if (!a) return;
    a.blur();
    if (a.dataset.a === 'now') onStartNow();
    else if (a.dataset.a === 'lobby') onLobby();
    else if (a.dataset.a === 'home') onHome();
    else if (a.dataset.a === 'hide') $('.nr-res').classList.remove('on'), root.classList.remove('live');
    else if (a.dataset.a === 'live') root.classList.toggle('live');
  });
  // 6~0 키 = 이모티콘 (조작키와 겹치지 않는 숫자)
  addEventListener('keydown', (e) => {
    const i = ['Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(e.code);
    if (i >= 0 && !e.repeat && net.emote && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) net.emote(EMOTES[i]);
  });

  // 레이스 담당의 결과 화면(#results)이 떠 있으면 내 결과 카드는 접고, 아래에 "로비로" 버튼 줄만 보임 (📋로 펼침)
  // 오른쪽 위 접속 표시·알림은 미니맵 바로 아래에 (미니맵을 끄면 메뉴 버튼 아래)
  const place = () => {
    const mm = document.getElementById('minimap');
    const r = mm && mm.offsetParent && getComputedStyle(mm).display !== 'none' ? mm.getBoundingClientRect() : null;
    const top = (r && r.height > 20 ? r.bottom : 54) + 8;
    root.style.setProperty('--nr-top', `${Math.round(top)}px`);
  };
  setInterval(() => {
    const r = document.querySelector('#results.on');
    root.classList.toggle('docked', !!r && resOpen);
    place();
  }, 300);
  place();
  let cdAt = 0;
  let resOpen = false;
  let refreshT = 0;
  const ui = {
    status(t, bad) {
      const s = $('.nr-wait .st');
      if (t) s.textContent = t;
      s.classList.toggle('bad', !!bad);
      if (bad) toast('⚠️ ' + t);
      ui.refresh();
    },
    toast,
    refresh() {
      const n = net.players.size + 1;
      $('.nr-badge .cnt').textContent = `${n}명`;
      $('.nr-badge .ping').textContent = isHost ? '방장' : net.link ? `${Math.round(net.ping)} ms` : '끊김';
      $('.nr-badge').classList.toggle('bad', !isHost && !net.link);
      // 대기 목록
      if ($('.nr-wait').classList.contains('on')) {
        const rows = [`<div class="pl ok"><i>✓</i>${esc(netName(net))} <small>(나)</small></div>`];
        for (const pl of net.players.values()) rows.push(`<div class="pl ok"><i>✓</i>${esc(pl.name)} <small>${esc(pl.carName || '')}</small></div>`);
        // 로비에 있었지만 아직 연결 안 된 사람
        for (const p of roster) if (p.pid !== net.pid && !net.players.has(p.pid)) rows.push(`<div class="pl wait"><i>⏳</i>${esc(p.name)} <small>불러오는 중…</small></div>`);
        $('.nr-wait .list').innerHTML = rows.join('');
        if (!net.started && !$('.nr-wait .st').classList.contains('bad') && !$('.nr-wait .st').dataset.fixed) {
          $('.nr-wait .st').textContent = isHost ? `다른 선수를 기다리는 중… (${n}명 연결됨)` : net.link ? '방장의 출발 신호를 기다리는 중…' : $('.nr-wait .st').textContent;
        }
      }
      if (resOpen) renderResults();
    },
    countdown(at) {
      cdAt = at;
      $('.nr-wait .st').textContent = '모두 모였어요! 곧 출발 신호가 켜져요';
      $('.nr-wait .st').dataset.fixed = '1';
      const b = $('[data-a=now]');
      if (b) b.remove();
    },
    started() {
      cdAt = 0;
      $('.nr-wait').classList.remove('on');
      toast(`🏁 ${net.players.size + 1}명이 함께 출발!`);
    },
    frame(dt) {
      if (cdAt && net) {
        const left = Math.max(0, (cdAt - (net.isHost ? performance.now() : net.link ? net.link.hostNow() : performance.now())) / 1000);
        $('.nr-wait .cd').textContent = left > 0 ? `출발 신호까지 ${left.toFixed(1)}초` : '';
      }
      refreshT += dt;
      if (refreshT > 0.5) {
        refreshT = 0;
        if (resOpen) renderResults();
      }
    },
    showResults() {
      resOpen = true;
      $('.nr-res').classList.add('on');
      renderResults();
    },
    hideResults() {
      resOpen = false;
      $('.nr-res').classList.remove('on');
      $('.nr-wait').classList.remove('on');
    },
    emote(pl, e) {
      if (!pl) return;
      const d = document.createElement('div');
      d.className = 'nr-emote';
      d.innerHTML = `<b>${esc(e)}</b><small>${esc(pl.name)}</small>`;
      d.style.left = `${30 + Math.random() * 40}%`;
      root.appendChild(d);
      setTimeout(() => d.remove(), 2400);
    },
  };
  function toast(t) {
    const box = $('.nr-toasts');
    const d = document.createElement('div');
    d.textContent = t;
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 3600);
    setTimeout(() => d.remove(), 4100);
  }
  function renderResults() {
    const rows = net.standings();
    const lead = rows.find((r) => r.finished);
    $('.nr-res .rows').innerHTML = rows
      .map((r, i) => {
        const pos = i + 1;
        const medal = r.finished ? ['🥇', '🥈', '🥉'][i] || `${pos}` : `${pos}`;
        const right = r.finished
          ? `<span class="t">${fmt(r.time)}</span><span class="gap">${lead && r !== lead ? '+' + (r.time - lead.time).toFixed(3) : r.best ? '최고 랩 ' + fmt(r.best) : ''}</span>`
          : `<span class="t dim">${r.gone ? '나감' : '달리는 중…'}</span><span class="gap">LAP ${r.lap || 1}</span>`;
        return `<div class="row${r.me ? ' me' : ''}${r.finished ? '' : ' run'}"><span class="pos">${medal}</span><span class="nm"><b>${esc(r.name)}${r.me ? ' (나)' : ''}</b><small>${esc(r.carName || '')}</small></span>${right}</div>`;
      })
      .join('');
  }
  return ui;
}
function netName() {
  try {
    return new URLSearchParams(location.search).get('name') || '나';
  } catch {
    return '나';
  }
}

function injectCss() {
  if (document.getElementById('netRaceCss')) return;
  const st = document.createElement('style');
  st.id = 'netRaceCss';
  st.textContent = `
#netRace { position: fixed; inset: 0; pointer-events: none; z-index: 40; font-family: "Pretendard", "Segoe UI", "Malgun Gothic", sans-serif; color: #f3f6fb; }
#netRace .gm-btn, #netRace button { pointer-events: auto; }
#netRace .nr-badge { position: absolute; top: var(--nr-top, 62px); right: 16px; display: flex; gap: 8px; align-items: center; padding: 6px 12px; border-radius: 20px; background: rgba(8, 12, 24, .72); border: 1px solid rgba(255,255,255,.12); font-size: 12.5px; font-weight: 800; backdrop-filter: blur(6px); }
#netRace .nr-badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #7dff6a; box-shadow: 0 0 8px #7dff6a; }
#netRace .nr-badge.bad .dot { background: #ff5a4a; box-shadow: 0 0 8px #ff5a4a; }
#netRace .nr-badge .ping, #netRace .nr-badge .cnt { color: #95a2bb; }
#netRace .nr-toasts { position: absolute; top: calc(var(--nr-top, 62px) + 38px); right: 16px; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
#netRace .nr-toasts div { padding: 8px 14px; border-radius: 12px; background: rgba(8, 12, 24, .8); border: 1px solid rgba(255,255,255,.12); font-size: 13.5px; font-weight: 800; animation: nrIn .25s ease-out; transition: opacity .45s, transform .45s; }
#netRace .nr-toasts div.out { opacity: 0; transform: translateX(20px); }
@keyframes nrIn { from { opacity: 0; transform: translateX(24px); } }
#netRace .nr-wait { position: absolute; inset: 0; display: none; align-items: flex-start; justify-content: center; padding-top: 16vh; }
#netRace .nr-wait.on { display: flex; }
#netRace .card { pointer-events: auto; background: rgba(10, 15, 30, .88); border: 1px solid rgba(255,255,255,.14); border-radius: 18px; padding: 18px 20px; width: min(420px, calc(100vw - 32px)); box-shadow: 0 20px 60px rgba(0,0,0,.55); backdrop-filter: blur(10px); animation: nrPop .25s ease-out; }
@keyframes nrPop { from { transform: scale(.95); opacity: 0; } }
#netRace .hd { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
#netRace .hd b { display: block; font-size: 17px; }
#netRace .hd small { display: block; color: #95a2bb; font-weight: 700; font-size: 13px; margin-top: 2px; }
#netRace .hd small.bad { color: #ff8a7a; }
#netRace .spin { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 4px solid rgba(255,255,255,.12); border-top-color: #ffcf3f; animation: nrSpin .8s linear infinite; }
@keyframes nrSpin { to { transform: rotate(360deg); } }
#netRace .nr-wait .list { display: grid; gap: 6px; }
#netRace .pl { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-radius: 10px; background: rgba(255,255,255,.05); font-weight: 800; font-size: 14px; }
#netRace .pl i { font-style: normal; color: #7dff6a; }
#netRace .pl.wait { opacity: .6; }
#netRace .pl small { color: #95a2bb; font-weight: 700; }
#netRace .cd { margin-top: 10px; font-size: 20px; font-weight: 900; color: #ffcf3f; text-align: center; min-height: 4px; font-variant-numeric: tabular-nums; }
#netRace .btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; flex-wrap: wrap; }
#netRace .nr-emotes { position: absolute; left: 16px; bottom: 120px; display: flex; flex-direction: column; gap: 5px; opacity: .55; transition: opacity .2s; }
#netRace .nr-emotes:hover { opacity: 1; }
#netRace .nr-emotes button { width: 38px; height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15); background: rgba(8, 12, 24, .7); color: #fff; font: 800 15px inherit; cursor: pointer; }
#netRace .nr-emote { position: absolute; top: 24%; display: flex; flex-direction: column; align-items: center; animation: nrFloat 2.4s ease-out forwards; }
#netRace .nr-emote b { font-size: 46px; filter: drop-shadow(0 4px 10px rgba(0,0,0,.5)); }
#netRace .nr-emote small { font-weight: 800; font-size: 13px; padding: 2px 8px; border-radius: 8px; background: rgba(0,0,0,.5); }
@keyframes nrFloat { 0% { opacity: 0; transform: translateY(20px) scale(.6); } 15% { opacity: 1; transform: none; } 80% { opacity: 1; } 100% { opacity: 0; transform: translateY(-40px); } }
#netRace .nr-res { position: absolute; right: 16px; top: calc(var(--nr-top, 62px) + 38px); display: none; z-index: 70; }
#netRace .nr-res.on { display: block; }
#netRace.docked .nr-res.on { display: none; }
#netRace.docked.live .nr-res.on { display: block; z-index: 72; }
#netRace .nr-dock { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); display: none; gap: 10px; z-index: 71; }
#netRace.docked .nr-dock { display: flex; animation: nrPop .3s ease-out; }
#netRace { z-index: 45; }
#netRace .nr-res .card { width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - var(--nr-top, 62px) - 60px); overflow: auto; }
#netRace .nr-res h3 { margin: 0 0 12px; font-size: 18px; display: flex; justify-content: space-between; align-items: baseline; }
#netRace .nr-res h3 small { color: #95a2bb; font-size: 12px; }
#netRace .row { display: grid; grid-template-columns: 34px 1fr auto auto; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.04); margin-bottom: 5px; animation: nrIn .25s ease-out both; }
#netRace .row.me { background: rgba(255, 207, 63, .12); box-shadow: inset 0 0 0 1px rgba(255,207,63,.45); }
#netRace .row .pos { font-size: 18px; font-weight: 900; text-align: center; }
#netRace .row .nm b { display: block; font-size: 14px; }
#netRace .row .nm small { color: #95a2bb; font-size: 11.5px; font-weight: 700; }
#netRace .row .t { font-variant-numeric: tabular-nums; font-weight: 900; }
#netRace .row .t.dim, #netRace .row.run .gap { color: #95a2bb; font-weight: 700; font-size: 12.5px; }
#netRace .row .gap { font-variant-numeric: tabular-nums; font-size: 12px; color: #ff9a7a; font-weight: 800; min-width: 64px; text-align: right; }
@media (max-width: 700px) { #netRace .nr-res { left: 16px; right: 16px; } #netRace .nr-emotes { display: none; } }`;
  document.head.appendChild(st);
}
