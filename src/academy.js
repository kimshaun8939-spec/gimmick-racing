// 드라이빙 아카데미 (2026-11-12): 레슨 하나씩 "설명(그림) → 시범 주행 → 따라 하기 → 성적표(동·은·금)" + 라이선스 시험 C → B → A → S
//   주소: ?map=..&car=..&academy=<레슨 id>  ·  시험 ?academy=exam&lic=C&task=0
//   (main.js가 이 파일의 startAcademy(game)을 부름. 아직 연결 전이면 academyStore.js가 주소를 보고 스스로 불러옴)
//   레슨 진행 코드 = academyLessons.js (연습 자리·시범 계획·판정), 목록·저장 = academyStore.js, 그림 = academyArt.js (Codex 담당)
//   시범 주행·코치 화면 = tutorialDemo.js (튜토리얼과 같이 씀). 화면 모양은 튜토리얼과 같은 #tutorial 틀 + academy.css
//   game.tutorial 자리를 같이 씀 → 기록 저장 안 함(main.js realPlay), 시범 중 카메라 고정, 카드에서 패드 = 메뉴 이동, 터치 버튼 숨김, 화산탄 없음
//   아무것도 잠그지 않음. 시험 진행은 sessionStorage 'gimmick.academy.exam' (다른 맵 과제로 넘어갈 때 페이지를 새로 열어서)
import { keybinds, actionsFor, codeLabel } from './keybinds.js';
import { pad, padKbd } from './gamepad.js';
import { settings, uiSound } from './settings.js';
import { raceUrl, homeUrl, setLast } from './gameData.js';
import { touch, touchWanted } from './touch.js';
import { createCoachUI, createDemo, momentText } from './tutorialDemo.js';
import { coachSpeed } from './brakeNeed.js';
import { LESSON_TEXT, EXAM_TEXT } from './academyText.js';
import { shortCard, shortKeys } from './academyCards.js';
import { kbd as kbdTd } from './tutorialDemo.js';
import { RUN, pickSpots, fmt } from './academyLessons.js';
import { LESSONS, LICENSES, academy, lessonMeta, licenseMeta, scoreRows, medalFor, MEDALS, MEDAL_NAMES } from './academyStore.js';
import { academyArt, licenseBadge } from './academyArt.js';
import { profile } from './profile.js';
import { meta as pitMeta } from './meta.js';
import { paintOf } from './unlocks.js';

const EX_KEY = 'gimmick.academy.exam';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TOUCH_LBL = { throttle: '▲ 가속', brake: '▼ 브레이크', drift: '💨 드리프트', climb: '⬆ 상승', dive: '⬇ 하강', respawn: '↺ 복귀', left: '◀', right: '▶' };
const onTouch = () => !pad.usingPad() && touchWanted();
const DRIVE_IDS = new Set(['throttle', 'brake', 'left', 'right']);
const K = (id) => (onTouch() && TOUCH_LBL[id] ? `<kbd>${TOUCH_LBL[id]}</kbd>` : pad.usingPad() && pad.get(id) != null ? pad.html(id) : keybinds.html(id, DRIVE_IDS.has(id) ? 2 : 1));
const MEDAL_CLS = ['none', 'bronze', 'silver', 'gold'];
const ENV_KEYS = ['mode', 'bots', 'drs', 'tow'];

function readExam() {
  try {
    return JSON.parse(sessionStorage.getItem(EX_KEY) || 'null');
  } catch {
    return null;
  }
}
function writeExam(x) {
  try {
    if (x) sessionStorage.setItem(EX_KEY, JSON.stringify(x));
    else sessionStorage.removeItem(EX_KEY);
  } catch {}
}

export function startAcademy(game) {
  if (!game || !game.car) return null;
  if (game.tutorial && game.tutorial.el) return game.tutorial; // 두 번 부르지 않게 (튜토리얼과도 같이 안 켬)
  if (game.__academyOn) return game.tutorial; // main.js 연결과 academyStore.js 자동 시작이 둘 다 불러도 한 번만
  game.__academyOn = true;
  for (const [id, f] of [['tut2css', './tutorial2.css'], ['acadcss', './academy.css']]) {
    if (document.getElementById(id)) continue;
    const l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = new URL(f, import.meta.url).href;
    document.head.appendChild(l);
  }
  const params = new URLSearchParams(location.search);
  const car = game.car, track = game.track, race = game.race;
  const carId = game.carId || params.get('car') || 'f1';
  const mapId = params.get('map') || game.mapName || 'gp';
  const line = track.racingLine || (game.lineFx && game.lineFx.line) || null;
  const N = line ? line.N : 1;
  const ds = track.length / N;
  const W = (i) => ((Math.round(i) % N) + N) % N;
  const M = (m) => Math.max(1, Math.round(m / ds));
  const fwd = (a, b) => W(b - a) * ds;
  const idxNow = () => (car.trackInfo ? car.trackInfo.index % N : 0);

  // ------------------------------------------------------------------ 차 옮기기 (tutorial.js와 같은 방식)
  const seen = [];
  function hookEvents() {
    const arr = car.events;
    if (arr.__tut) return;
    const push = arr.push;
    arr.push = function (...ev) {
      seen.push(...ev);
      return push.apply(this, ev);
    };
    arr.__tut = true;
  }
  hookEvents();
  function setSpeed(v) {
    car.speed = v;
    car.forwardSpeed = v;
    car.vel.copy(car.fwd).multiplyScalar(v);
    if (v > 0 && car.gearSpeeds) {
      const G = car.gearSpeeds();
      const g = G.findIndex((x) => x >= v * 1.15);
      car.gear = g < 0 ? G.length : Math.max(1, g + 1);
    }
  }
  function afterTeleport(t) {
    car.lastSafeT = t;
    race.lastT = t;
    race.nextCp = 0;
    race.wrongWay = 0;
    car.events.length = 0;
    seen.length = 0;
    try {
      game.renderOnce && game.renderOnce();
    } catch {}
  }
  function placeRolling(i, factor = 0.85, minSpeed = 0) {
    i = W(i);
    const t = i / N;
    car.placeAt(t, line ? line.offset[i] || 0 : 0);
    if (car.mode !== 'normal' && car.setMode) car.setMode('normal', true);
    let v = 0;
    try {
      v = line ? factor * car.lineSpeed(i) : 0;
    } catch {}
    setSpeed(Math.max(v, minSpeed));
    afterTeleport(t);
  }

  const ctx = { game, car, track, race, line, N, ds, W, M, fwd, placeRolling, kbd: kbdTd, K, cname: (c) => (c && c.num ? `T${c.num}` : '코너') };
  try {
    ctx.spots = pickSpots(ctx);
  } catch (e) {
    console.warn('아카데미 연습 자리 찾기 실패', e);
    ctx.spots = {};
  }

  // ------------------------------------------------------------------ 무엇을 하나 (레슨 / 시험)
  let exam = null;
  let lessonId = params.get('academy');
  if (lessonId === 'exam') {
    const lic = licenseMeta(params.get('lic')) || LICENSES[0];
    exam = readExam();
    const ti = Math.max(0, Math.min(lic.tasks.length - 1, Number(params.get('task')) || 0));
    if (!exam || exam.lic !== lic.id) exam = { lic: lic.id, i: ti, tries: 0, results: [] };
    if (exam.i !== ti) (exam.i = ti), (exam.tries = 0);
    writeExam(exam);
    lessonId = lic.tasks[exam.i];
  }
  if (!RUN[lessonId]) lessonId = LESSONS[0].id;
  const lic = () => exam && licenseMeta(exam.lic);

  // ------------------------------------------------------------------ 화면
  const root = document.createElement('div');
  root.id = 'tutorial';
  root.className = 'acad';
  root.innerHTML = `
    <div class="tut-card-wrap"><div class="tut-card ac-card">
      <div class="tut-top"><span class="tut-chip"></span><div class="ac-crumb"></div><button class="tut-x" data-t="home" title="아카데미로">✕</button></div>
      <div class="tut-hero"><div class="tut-ic"></div><h2></h2></div>
      <div class="tut-body"></div>
      <div class="tut-btns"></div>
    </div></div>
    <div class="tut-panel ac-panel">
      <div class="tut-ph"><span class="tut-chip"></span><span class="tut-pt"></span></div>
      <div class="tut-pb"></div>
      <div class="tut-goals"></div>
      <div class="tut-hint"></div>
      <div class="tut-pbtns"><button class="gm-btn small" data-t="retry">↺ 다시 <span class="k"></span></button><button class="gm-btn small" data-t="demo">▶ 시범</button><button class="gm-btn small" data-t="slow">🐢 천천히</button><button class="gm-btn small" data-t="card">? 설명</button><button class="gm-btn small" data-t="home">🎓 나가기</button></div>
    </div>
    <div class="tut-burst"><div class="ok">✓</div><div class="tx"></div><div class="sub"></div></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const cardWrap = $('.tut-card-wrap'), panel = $('.tut-panel'), burst = $('.tut-burst');
  const coach = createCoachUI(root);

  // ------------------------------------------------------------------ 상태
  let phase = 'card', ended = false;
  let L = null, meta = null, spot = null, P = null, judge = null, demo = null, st = null, target = null;
  let slow = false, ts = 1, waitT = 0, tries = 0, lastRes = null;

  function pause(on) {
    game.paused = on;
    if (!on && game.input) game.input.clear && game.input.clear();
  }
  function setTS(x) {
    ts = x;
    game.timeScale = x;
  }
  function stopAuto() {
    if (demo) demo.stop();
    demo = null;
    if (game.controlsOverride) game.controlsOverride = null;
    setTS(1);
  }
  function cleanupLesson() {
    try {
      L && L.cleanup && L.cleanup(ctx);
    } catch {}
  }
  const isCorner = () => P && P.dB != null && P.dX != null;
  const label = () => (L && L.label ? L.label(ctx, spot) : spot && spot.num ? ctx.cname(spot) : '');

  /** 레슨 준비 (같은 페이지 안에서 다음 레슨으로 갈 때도) */
  function setup(id) {
    cleanupLesson();
    lessonId = id;
    L = RUN[id];
    meta = lessonMeta(id);
    tries = 0;
    slow = false;
    lastRes = null;
    spot = null;
    P = null;
    try {
      spot = L.spot(ctx);
      target = L.target ? L.target(ctx) : null;
      P = spot ? L.plan(ctx, spot) : null;
      if (P && target != null) P.target = target;
    } catch (e) {
      console.warn('아카데미 레슨 준비 실패', id, e);
      P = null;
    }
  }

  // ------------------------------------------------------------------ 카드
  function frame(chip, icon, title) {
    phase = 'card';
    stopAuto();
    pause(true);
    try {
      game.renderOnce && game.renderOnce();
    } catch {}
    panel.classList.remove('on');
    coach.hide();
    burst.classList.remove('on');
    $('.tut-card .tut-chip').innerHTML = chip;
    $('.tut-card .tut-ic').innerHTML = icon;
    $('.tut-card h2').textContent = title;
    $('.ac-crumb').innerHTML = crumb();
    $('.tut-card').classList.remove('tdr', 'ac-rep', 'ac-final', 'ac-short-frame');
  }
  function crumb() {
    if (exam) {
      const m = lic();
      return `<span class="ac-exam">${licenseBadge(m.id, { size: 22 })} ${esc(m.name)} 시험</span>` + m.tasks.map((t, j) => {
        const r = exam.results[j];
        const cls = j === exam.i ? 'cur' : r ? (r.medal >= m.need ? 'ok' : 'bad') : '';
        return `<i class="${cls}" title="${esc(lessonMeta(t).name)}">${r ? MEDALS[r.medal] || '✗' : j + 1}</i>`;
      }).join('');
    }
    const best = academy.medalOf(lessonId);
    return `<span class="ac-best">내 최고 ${best ? `${MEDALS[best]} ${MEDAL_NAMES[best]}` : '— 아직 없음'}</span>`;
  }
  function chipText() {
    if (exam) {
      const m = lic();
      return `🎓 ${esc(m.name)} · 과제 ${exam.i + 1}/${m.tasks.length}`;
    }
    const j = LESSONS.findIndex((x) => x.id === lessonId);
    return `🎓 드라이빙 아카데미 · 레슨 ${j + 1}/${LESSONS.length}`;
  }
  function open(focusSel) {
    cardWrap.classList.remove('on');
    void cardWrap.offsetWidth;
    cardWrap.classList.add('on');
    const f = focusSel && $(focusSel);
    f && f.focus({ preventScroll: true });
    const body = $('.tut-card');
    if (body) body.scrollTop = 0;
  }
  const btn = (t, html, cls = '') => `<button class="gm-btn ${cls}" data-t="${t}">${html}</button>`;
  const enterK = '<kbd>Enter</kbd>';

  function showIntro() {
    if (!P) return showBlocked();
    frame(chipText(), meta.icon, `${meta.name}${label() ? ` · ${label()}` : ''}`);
    const text = Object.hasOwn(LESSON_TEXT, lessonId) ? LESSON_TEXT[lessonId] : null;
    const examText = exam && Object.hasOwn(EXAM_TEXT, exam.lic) ? EXAM_TEXT[exam.lic] : null;
    $('.tut-card').classList.toggle('ac-short-frame', !!text);
    if (text) {
      const rule = examText ? '\n\n' + examText.title + '\n' + examText.more : '';
      const badge = exam ? MEDAL_NAMES[lic().need] + ' 이상 · 기회 ' + Math.max(1, 2 - exam.tries) + '번' : '';
      $('.tut-card .tut-body').innerHTML = shortCard({
        ...text, title: text.title + (label() ? ' · ' + label() : ''), badge,
        tip: examText ? examText.tip : text.tip, more: text.more + rule,
        keyHtml: (key) => shortKeys(key, K, lessonId === 'fly' ? 'dive' : 'drift'),
      });
    } else {
      const goals = (L.goals || []).map((g) => `<span>${esc(g)}</span>`).join('');
      const ex = exam ? `<div class="ac-examnote">${licenseBadge(exam.lic, { size: 26 })}<span>합격 기준: 이 과제 <b>${MEDALS[lic().need]} ${MEDAL_NAMES[lic().need]}</b> 이상 · 기회 <b>${Math.max(1, 2 - exam.tries)}번</b> 남음 (좋은 쪽 기록)</span></div>` : '';
      $('.tut-card .tut-body').innerHTML = `
        ${ex}
        <div class="ac-intro"><div class="ac-art">${academyArt(meta.art)}</div><div class="ac-txt">${L.intro(ctx, spot, target)}</div></div>
        <div class="ac-goalrow"><b>성적표 항목</b>${goals}<em>✓ 모두 = 🥇 · 75% = 🥈 · 50% = 🥉</em></div>`;
    }
    const demoOk = L.demo !== false;
    $('.tut-card .tut-btns').innerHTML =
      btn('home', exam ? '‹ 시험 그만두기' : '‹ 아카데미') + '<span class="sp"></span>' +
      (demoOk ? btn('go', '바로 달리기') + btn('demo', `▶ 시범 보기 ${enterK}`, 'primary') : btn('go', `${L.standing ? '출발 준비' : '시작'} ${enterK}`, 'primary'));
    open('.tut-card .primary');
  }
  function showBlocked() {
    frame(chipText(), '🚧', meta ? meta.name : '레슨');
    const where = meta && meta.map !== mapId;
    $('.tut-card .tut-body').innerHTML = `<p>${where ? '이 레슨은 다른 맵에서 해요. 아래 버튼을 누르면 그 맵으로 가요.' : '이 맵에서는 이 레슨에 맞는 연습 자리를 찾지 못했어요.'}</p>`;
    $('.tut-card .tut-btns').innerHTML = btn('home', '‹ 아카데미') + '<span class="sp"></span>' + (where ? btn('goMap', `그 맵으로 ${enterK}`, 'primary') : '');
    open('.tut-card .tut-btns button:last-child');
  }

  // ------------------------------------------------------------------ 시범 주행
  function startDemo() {
    if (!P) return;
    phase = 'demo';
    cardWrap.classList.remove('on');
    panel.classList.remove('on');
    burst.classList.remove('on');
    pause(false);
    readyRace();
    const place = () => (L.place ? L.place(ctx, P) : placeRolling(P.i0, L.factor || 0.95));
    try {
      demo = createDemo(game, P, coach, place);
      demo.start();
    } catch (e) {
      console.warn('시범 주행 오류', e);
      return startLive();
    }
    coach.buttons(`<button class="gm-btn small" data-t="demoAgain">↺ 처음부터 <kbd>${esc(keybinds.main('restart'))}</kbd></button><button class="gm-btn small" data-t="demoSkip">직접 해 보기 ›</button><button class="gm-btn small" data-t="card">‹ 설명·나가기</button>`);
  }
  function demoDone(skipped) {
    stopAuto();
    coach.hide();
    if (skipped) return startLive();
    phase = 'between';
    waitT = 1.5;
    burst.querySelector('.ok').textContent = '🎬';
    burst.querySelector('.tx').textContent = '시범 끝!';
    burst.querySelector('.sub').textContent = '이번엔 직접 해 봐요';
    burst.classList.remove('on');
    void burst.offsetWidth;
    burst.classList.add('on');
    chime(true);
  }

  // ------------------------------------------------------------------ 따라 하기
  /** 결과 화면·출발 신호가 남아 있으면 바로 달릴 수 있게 */
  function readyRace() {
    if (race.phase === 'finished' || race.phase === 'countdown') {
      game.resetRace();
      race.phase = 'racing';
      race.lights = 0;
    }
  }
  function startLive() {
    if (!P) return showBlocked();
    stopAuto();
    phase = 'live';
    cardWrap.classList.remove('on');
    burst.classList.remove('on');
    seen.length = 0;
    st = { age: 0, far: null, stuck: 0, off: 0, mo: null };
    pause(false);
    if (L.standing) {
      game.resetRace(); // 출발 신호부터 (한 바퀴 시험)
    } else {
      readyRace();
      try {
        if (L.place) L.place(ctx, P);
        else placeRolling(P.i0, L.factor || 0.95);
      } catch (e) {
        console.warn('아카데미 자리 옮기기 실패', e);
      }
    }
    seen.length = 0;
    judge = L.judge(ctx, P);
    renderPanel();
    panel.classList.add('on');
    coach.buttons('');
    coach.show('follow');
    coach.badge(`🏎️ ${exam ? '시험' : '따라 하기'} · ${esc(meta.name)}${slow ? ' · 🐢 천천히' : ''}`);
    coach.caption('', '');
    coach.clearStrip();
    coach.slow(1);
    coach.cue(null);
  }
  function renderPanel() {
    const tl = document.getElementById('topLeft');
    const r = tl && tl.getBoundingClientRect();
    if (r && r.height && innerWidth > 720) panel.style.top = `${Math.round(Math.min(innerHeight * 0.45, r.bottom + 14))}px`;
    $('.tut-panel .tut-chip').textContent = exam ? `${lic().id} 시험 ${exam.i + 1}/${lic().tasks.length}` : '아카데미';
    $('.tut-panel .tut-pt').textContent = `${meta.icon} ${meta.name}`;
    $('.tut-panel .tut-pb').innerHTML = L.task ? L.task(ctx, P) : '';
    $('.tut-panel [data-t="retry"] .k').innerHTML = K('restart');
    $('.tut-panel [data-t="demo"]').style.display = L.demo !== false ? '' : 'none';
    const sb = $('.tut-panel [data-t="slow"]');
    sb.style.display = !exam && isCorner() ? '' : 'none';
    sb.textContent = slow ? '🐢 천천히 켬' : '🐢 천천히';
    sb.classList.toggle('primary', slow);
    renderGoals();
    setHint(slow ? '🐢 천천히는 메달이 🥈까지예요' : '');
  }
  function renderGoals() {
    let prog = [];
    try {
      prog = judge && judge.prog ? judge.prog() : [];
    } catch {}
    $('.tut-panel .tut-goals').innerHTML = (L.goals || []).map((g, j) => `<div class="g ${prog[j] ? 'ok' : ''}"><i>${prog[j] ? '✓' : ''}</i><span>${esc(g)}</span></div>`).join('') + (L.gauge && phase === 'live' ? driftGauge(car) : '') + (L.standing ? lapInfo() : '');
  }
  function lapInfo() {
    const t = race.phase === 'racing' ? race.time - (race.lapStart || 0) : 0;
    const over = P.target != null && t > P.target;
    return `<div class="ac-lapclock ${over ? 'over' : ''}"><span>지금</span><b>${fmt(t)}</b><span>목표</span><b>${fmt(P.target)}</b></div>`;
  }
  function setHint(t, bad) {
    const h = $('.tut-panel .tut-hint');
    h.innerHTML = t || '';
    h.classList.toggle('on', !!t);
    h.classList.toggle('bad', !!bad);
  }

  // ------------------------------------------------------------------ 성적표
  function showReport() {
    const rewardBefore = { xp: profile.get().xp, coins: pitMeta.get().coins };
    let res;
    try {
      res = judge.result();
    } catch (e) {
      console.warn('아카데미 판정 오류', e);
      res = { rows: [{ id: 'x', ok: 'bad', title: '판정', text: '판정 중 문제가 생겼어요. 다시 해 주세요' }], respawn: false };
    }
    stopAuto();
    cleanupLesson();
    tries++;
    let pts = scoreRows(res.rows, res.respawn);
    if (slow) pts = Math.min(pts, 0.99); // 🐢 천천히 = 은메달까지
    const medal = medalFor(pts);
    lastRes = { res, pts, medal };
    let saved = null, xpRes = null;
    if (exam) {
      const prev = exam.results[exam.i];
      if (!prev || pts > prev.pts) exam.results[exam.i] = { task: lessonId, pts, medal };
      exam.tries++;
      writeExam(exam);
    } else {
      saved = academy.saveLesson(lessonId, pts);
      if (saved.xp) {
        try {
          xpRes = profile.bonus(saved.xp);
        } catch {}
      }
    }
    const ok = res.rows.filter((r) => r.ok === 'ok').length;
    const head = res.respawn ? '길을 벗어났어요' : medal === 3 ? '완벽해요! 금메달!' : medal === 2 ? '은메달! 거의 다 왔어요' : medal === 1 ? '동메달! 감 잡았어요' : '괜찮아요, 한 번 더!';
    frame(`${chipText()} · 성적표`, MEDALS[medal] || '🏁', head);
    $('.tut-card').classList.add('tdr', 'ac-rep');
    const worst = res.rows.find((r) => r.ok === 'bad') || res.rows.find((r) => r.ok === 'meh');
    const tip = worst ? `다음엔 이것만: ${worst.text}` : '이 느낌 그대로 레이스에서도!';
    let footer = '';
    if (exam) {
      const m = lic();
      const best = exam.results[exam.i];
      const okT = best.medal >= m.need;
      footer = `<div class="ac-examres ${okT ? 'ok' : 'bad'}">${okT ? `✓ 이 과제 합격 (기록 ${MEDALS[best.medal]} ${MEDAL_NAMES[best.medal]})` : `✗ 합격하려면 ${MEDALS[m.need]} ${MEDAL_NAMES[m.need]} 이상${exam.tries < 2 ? ` · 기회 ${2 - exam.tries}번 더` : ' · 기회를 다 썼어요'}`}</div>`;
    } else if (saved) {
      footer = `<div class="ac-save">${saved.improved ? `🎉 새 메달! <b>${MEDALS[saved.best]} ${MEDAL_NAMES[saved.best]}</b>${saved.xp ? ` · <span class="xp">+${saved.xp} XP</span>` : ''}` : `내 최고 ${saved.best ? `${MEDALS[saved.best]} ${MEDAL_NAMES[saved.best]}` : '—'}`}${slow ? ' · 🐢 천천히로 달렸어요 (🥈까지)' : ''}</div>`;
    }
    if (!exam) footer += rewardSummary(rewardBefore);
    $('.tut-card .tut-body').innerHTML = `
      <div class="ac-medal ${MEDAL_CLS[medal]}"><div class="disc"><span>${medal ? MEDALS[medal] : '🏁'}</span></div><div class="lbl">${MEDAL_NAMES[medal]}<small>${Math.round(pts * 100)}점 · ✓ ${ok}/${res.rows.length}</small></div></div>
      <div class="tdr-rows">${res.rows.map((r) => `<div class="tdr-row ${r.ok}"><span class="ic">${r.ok === 'ok' ? '✓' : r.ok === 'meh' ? '△' : '✗'}</span><b>${esc(r.title)}</b><span>${r.text}</span></div>`).join('')}</div>
      <div class="tdr-tip">💡 ${tip}</div>
      ${footer}`;
    $('.tut-card .tut-btns').innerHTML = reportButtons(medal);
    chime(medal >= 2);
    quietRewards();
    open('.tut-card .tut-btns .primary');
  }
  function rewardSummary(before) {
    const xp = Math.max(0,profile.get().xp-before.xp), coins = Math.max(0,pitMeta.get().coins-before.coins);
    return xp || coins ? '<div class="ac-save">이번 보상 합계 · <b>+'+xp+' XP</b> · ⬡ +'+coins+' 피트 코인<small style="display:block;margin-top:4px">레슨·업적·목표 보상 포함 · XP는 레벨, 코인은 꾸미기에 써요</small></div>' : '';
  }
  function quietRewards() {
    document.getElementById('xpPill')?.remove();
    window.dispatchEvent(new CustomEvent('gimmick:resultsOpen'));
  }
  function reportButtons(medal) {
    if (exam) {
      const m = lic();
      const best = exam.results[exam.i];
      const passed = best && best.medal >= m.need;
      const last = exam.i >= m.tasks.length - 1;
      if (passed) return btn('quitExam', '시험 그만두기') + '<span class="sp"></span>' + (exam.tries < 2 && medal < 3 ? btn('again', '↺ 한 번 더 (좋은 쪽 기록)') : '') + btn('nextTask', `${last ? '결과 보기' : '다음 과제'} › ${enterK}`, 'primary');
      if (exam.tries < 2) return btn('quitExam', '시험 그만두기') + '<span class="sp"></span>' + (L.demo !== false ? btn('demo', '▶ 시범 보기') : '') + btn('again', `↺ 두 번째 기회 ${enterK}`, 'primary');
      return btn('quitExam', '시험 그만두기') + '<span class="sp"></span>' + btn('nextTask', `결과 보기 › ${enterK}`, 'primary');
    }
    const nx = nextLesson();
    const good = medal >= 2;
    return (
      btn('home', '🎓 아카데미') + '<span class="sp"></span>' +
      (L.demo !== false ? btn('demo', '▶ 시범 다시') : '') +
      (isCorner() ? btn('slowTog', slow ? '🏁 진짜 속도로' : '🐢 천천히') : '') +
      btn('again', `↺ 다시${good ? '' : ` ${enterK}`}`, good ? '' : 'primary') +
      (nx ? btn('nextLesson', `다음 레슨 ›${good ? ` ${enterK}` : ''}`, good ? 'primary' : '') : '')
    );
  }
  function nextLesson() {
    const j = LESSONS.findIndex((x) => x.id === lessonId);
    return j >= 0 && j < LESSONS.length - 1 ? LESSONS[j + 1] : null;
  }

  // ------------------------------------------------------------------ 시험 결과
  async function showExamFinal() {
    const rewardBefore = { xp: profile.get().xp, coins: pitMeta.get().coins };
    const m = lic();
    const res = m.tasks.map((t, j) => exam.results[j] || { task: t, pts: 0, medal: 0 });
    const pass = res.every((r) => r.medal >= m.need);
    let grant = null, xpRes = null;
    if (pass) {
      grant = academy.grantLicense(m.id, carId);
      if (grant) {
        try {
          xpRes = profile.bonus(grant.xp);
        } catch {}
      }
      // 온라인 순위표 배지 (계정이 없거나 서버 준비 전이면 조용히 넘어감)
      import('./online.js')
        .then((o) => (o.online && o.online.setLicense ? o.online.setLicense(academy.top() || m.id) : null))
        .catch(() => {});
    }
    writeExam(null);
    frame(`🎓 ${esc(m.name)} 시험 결과`, pass ? '🎉' : '📋', pass ? `${m.name} 합격!` : '아쉽게 불합격');
    $('.tut-card').classList.add('ac-final');
    const rows = res
      .map((r, j) => {
        const lm = lessonMeta(m.tasks[j]);
        return `<div class="tdr-row ${r.medal >= m.need ? 'ok' : 'bad'}"><span class="ic">${r.medal >= m.need ? '✓' : '✗'}</span><b>${lm.icon} ${esc(lm.name)}</b><span>${r.medal ? `${MEDALS[r.medal]} ${MEDAL_NAMES[r.medal]}` : '메달 없음'} · ${Math.round(r.pts * 100)}점</span></div>`;
      })
      .join('');
    const paint = paintOf(m.paint);
    const nextLic = LICENSES[LICENSES.findIndex((x) => x.id === m.id) + 1];
    $('.tut-card .tut-body').innerHTML = pass
      ? `<div class="ac-licwin"><div class="ac-licbig">${licenseBadge(m.id, { size: 132 })}<i class="shine"></i></div>
          <div class="ac-lictx"><b>${esc(m.name)} · ${esc(m.sub)}</b><span>${esc(m.desc)}</span>
          <ul class="ac-rew">${grant ? `<li>🏅 배지: 홈 · 결과 화면 · 온라인 순위표에 보여요</li><li>🎨 새 차 색 <b style="color:${paint.body || '#fff'}">${esc(paint.name)}</b> (차 고르기 → 색)</li><li class="xp">+${grant.xp} XP</li>` : '<li>이미 가진 라이선스예요. 다시 합격!</li>'}</ul></div></div>
         <div class="tdr-rows">${rows}</div>`
      : `<p>모든 과제에서 <b>${MEDALS[m.need]} ${MEDAL_NAMES[m.need]}</b> 이상이면 합격이에요. 레슨에서 먼저 연습하고 다시 도전해요!</p><div class="tdr-rows">${rows}</div>`;
    if (pass) $('.tut-card .tut-body').insertAdjacentHTML('beforeend', rewardSummary(rewardBefore));
    $('.tut-card .tut-btns').innerHTML =
      btn('home', '🎓 아카데미로') + '<span class="sp"></span>' +
      (pass ? (nextLic ? btn('nextExam', `${esc(nextLic.name)} 시험 ›`) : '') + (grant ? btn('paint', '🎨 색 바꾸러 가기') : '') : btn('examAgain', `↺ 시험 다시 ${enterK}`, 'primary'));
    if (pass) $('.tut-card .tut-btns .gm-btn:last-child').classList.add('primary');
    chime(pass);
    quietRewards();
    open('.tut-card .tut-btns .primary');
  }

  // ------------------------------------------------------------------ 이동
  const urlFor = (id, extra = {}) => {
    const lm = lessonMeta(id);
    return raceUrl(lm.map, carId, { academy: id, ...(lm.extra || {}), ...extra });
  };
  const examUrl = (lv, i) => {
    const t = licenseMeta(lv).tasks[i];
    const lm = lessonMeta(t);
    return raceUrl(lm.map, carId, { academy: 'exam', lic: lv, task: i, ...(lm.extra || {}) });
  };
  /** 지금 페이지에서 바로 할 수 있나 (같은 맵, 같은 봇·DRS 설정) */
  function sameEnv(id) {
    const lm = lessonMeta(id);
    if (!lm || lm.map !== mapId) return false;
    const ex = lm.extra || {};
    return ENV_KEYS.every((k) => String(ex[k] ?? '') === String(params.get(k) ?? ''));
  }
  function go(url) {
    stopAuto();
    setLast({ map: mapId, car: carId });
    location.href = url;
  }
  function goLesson(id) {
    if (sameEnv(id)) {
      setup(id);
      history.replaceState(null, '', urlFor(id));
      return showIntro();
    }
    go(urlFor(id));
  }
  function goTask(i) {
    exam.i = i;
    exam.tries = 0;
    writeExam(exam);
    const t = lic().tasks[i];
    if (sameEnv(t)) {
      setup(t);
      history.replaceState(null, '', examUrl(exam.lic, i));
      return showIntro();
    }
    go(examUrl(exam.lic, i));
  }
  function startExam(lv) {
    exam = { lic: lv, i: 0, tries: 0, results: [] };
    writeExam(exam);
    goTask(0);
  }

  // ------------------------------------------------------------------ 매 프레임
  function update(dt) {
    if (ended) return;
    hookEvents();
    if (game.menu && game.menu.isOpen) return;
    if (phase === 'demo') {
      if (race.phase === 'countdown') return startDemo(); // Esc 메뉴 '다시 시작'
      let r = null;
      try {
        r = demo ? demo.update(dt) : 'done';
      } catch (e) {
        console.warn('시범 주행 오류', e);
        r = 'done';
      }
      seen.length = 0;
      if (r === 'done') demoDone(false);
      return;
    }
    if (phase === 'between') {
      waitT -= dt;
      if (waitT <= 0) startLive();
      return;
    }
    if (phase !== 'live') return;
    if (!L.standing && race.phase === 'countdown') return startLive();
    st.age += dt;
    coach.keys(car.thr, car.brk, car.steerIn, dt);
    coach.pedals(car.thr, car.brk, car.speed, car.trackInfo && line ? coachSpeed(car, track, idxNow()) : null);
    if (st.age < 0.25 || !car.trackInfo) {
      seen.length = 0;
      return;
    }
    let r = null;
    if (!L.standing && race.phase === 'racing') {
      // 막힘: 6초 동안 앞으로 못 가면 · 도로 밖에 오래 있으면 → 성적표 (길을 벗어남)
      const d = fwd(P.i0, idxNow());
      const dd = d < track.length / 2 ? d : 0;
      if (st.far == null || dd > st.far + 5) (st.far = dd), (st.stuck = 0);
      else st.stuck += dt;
      if (car.offK > 0.85 && car.grounded && car.mode !== 'boat' && car.mode !== 'fly' && !car.flying) st.off += dt;
      else st.off = Math.max(0, st.off - dt * 2);
      if (st.stuck > 6 || st.off > 3) r = 'out';
    }
    // 순간 글자 · 깜빡일 키
    if (P.momentAt && !L.standing) {
      const m = P.dist(idxNow());
      const mo = P.momentAt(m);
      if (mo && mo.id !== st.mo) {
        st.mo = mo.id;
        const txt = momentText(P, mo.id, true) || ['', ''];
        coach.caption(txt[0], txt[1], mo.id);
        coach.strip(mo.id, P.strip);
        const cue = L.cue ? L.cue(P, mo.id) : { straight: 'throttle', approach: null, brake: 'brake', turn: P.turnKey, apex: null, gas: 'throttle', out: 'throttle', run: 'throttle' }[mo.id];
        coach.cue(cue || null);
      }
      if (isCorner()) {
        const want = slow && m > P.dB - 120 && m < (P.c2 ? P.d2X : P.dX) + 20 ? 0.5 : 1;
        setTS(ts + (want - ts) * Math.min(1, dt * 5));
        coach.slow(ts);
      }
    } else if (L.standing) {
      coach.caption(race.phase === 'countdown' ? '불이 꺼지면 출발!' : '', '', 'straight');
    }
    try {
      if (!r) r = judge.step(dt, seen);
    } catch (e) {
      console.warn('아카데미 판정 오류', e);
    }
    seen.length = 0;
    if (r === 'out') {
      // 따라 하기 판정에 '길을 벗어남' 표시
      try {
        const res0 = judge.result;
        judge.result = () => {
          const x = res0();
          return { ...x, respawn: true };
        };
      } catch {}
      r = 'end';
    }
    renderGoals();
    if (r === 'end') showReport();
  }
  let last = performance.now();
  function loop(now) {
    if (ended) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    update(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ------------------------------------------------------------------ 입력 (키보드 · 패드 · 터치)
  const cardLike = () => phase === 'card';
  function onKey(e) {
    if (ended || document.querySelector('.gm-confirm')) return;
    if (game.menu && game.menu.isOpen) return;
    const acts = actionsFor(e.code);
    if (cardLike()) {
      if (e.code === 'Escape') return; // 메뉴는 그대로
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const a = document.activeElement;
        if (a && a.matches('.ac-short-summary')) return a.click();
        if (a && a.closest && a.closest('.tut-card button') && e.code !== 'Space') return a.click();
        const p = $('.tut-card .tut-btns .primary');
        p && p.click();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const bs = [...root.querySelectorAll('.tut-card button, .tut-card .ac-short-summary')].filter((b) => b.offsetParent !== null);
        const i = bs.indexOf(document.activeElement);
        const back = e.code === 'ArrowLeft' || e.code === 'ArrowUp' || (e.code === 'Tab' && e.shiftKey);
        const j = i < 0 ? bs.length - 1 : (i + (back ? -1 : 1) + bs.length) % bs.length;
        bs[j] && bs[j].focus({ preventScroll: false });
        uiSound('move');
        return;
      }
      if (e.code === 'Backspace') {
        e.preventDefault();
        e.stopImmediatePropagation();
        return act('home');
      }
      if (acts.length) e.stopImmediatePropagation();
      return;
    }
    if (phase === 'demo' || phase === 'between') {
      if (acts.includes('restart')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return phase === 'demo' ? startDemo() : null;
      }
      if (acts.length && !acts.includes('menu') && !acts.includes('sound')) e.stopImmediatePropagation();
      return;
    }
    if (acts.includes('restart')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return retry();
    }
    if (acts.includes('map')) {
      e.stopImmediatePropagation();
      setHint('아카데미 중에는 맵을 바꿀 수 없어요');
    }
  }
  window.addEventListener('keydown', onKey, true);
  pad.setActionFilter((id) => {
    if (ended || cardLike()) return true;
    if (id === 'restart') return phase === 'demo' ? startDemo() : retry(), false;
    if (id === 'map') return setHint('아카데미 중에는 맵을 바꿀 수 없어요'), false;
    if (phase === 'demo' || phase === 'between') return id === 'menu';
    return true;
  });
  const offTouch = touch.onAction(() => {});

  function retry() {
    uiSound('back');
    stopAuto();
    cleanupLesson();
    startLive();
  }
  function act(t) {
    switch (t) {
      case 'demo':
        uiSound('select');
        return startDemo();
      case 'go':
      case 'again':
        uiSound('select');
        return startLive();
      case 'demoAgain':
        return uiSound('back'), startDemo();
      case 'demoSkip':
        return uiSound('select'), demoDone(true);
      case 'retry':
        return retry();
      case 'card':
        uiSound('back');
        stopAuto();
        cleanupLesson();
        return showIntro();
      case 'slow':
        slow = !slow;
        uiSound('move');
        return retry();
      case 'slowTog':
        slow = !slow;
        uiSound('move');
        return startLive();
      case 'nextLesson': {
        const nx = nextLesson();
        uiSound('select');
        return nx ? goLesson(nx.id) : go(homeUrl('academy'));
      }
      case 'nextTask': {
        uiSound('select');
        const m = lic();
        if (exam.i >= m.tasks.length - 1) return showExamFinal();
        return goTask(exam.i + 1);
      }
      case 'quitExam':
        writeExam(null);
        uiSound('back');
        return go(homeUrl('academy'));
      case 'examAgain':
        uiSound('select');
        return startExam(exam ? exam.lic : params.get('lic') || 'C');
      case 'nextExam': {
        uiSound('select');
        const j = LICENSES.findIndex((x) => x.id === ((exam && exam.lic) || params.get('lic') || 'C'));
        return startExam(LICENSES[Math.min(LICENSES.length - 1, j + 1)].id);
      }
      case 'paint':
        uiSound('select');
        return go(homeUrl('car'));
      case 'goMap':
        return go(exam ? examUrl(exam.lic, exam.i) : urlFor(lessonId));
      case 'home':
        uiSound('back');
        if (exam) writeExam(null);
        return go(homeUrl('academy'));
    }
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    b.blur();
    act(b.dataset.t);
  });

  // ------------------------------------------------------------------ 소리 (딩동 / 뚱)
  let actx = null;
  function chime(ok) {
    try {
      const v = settings.get('muted') ? 0 : settings.get('masterVol') * settings.get('fxVol');
      if (v <= 0.001) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = actx || new AC();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime;
      const notes = ok ? [784, 988, 1319] : [330, 262];
      notes.forEach((f, j) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = ok ? 'triangle' : 'sine';
        o.frequency.value = f;
        const t = t0 + j * (ok ? 0.09 : 0.12);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09 * v, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0005, t + (ok ? 0.35 : 0.25));
        o.connect(g).connect(actx.destination);
        o.start(t);
        o.stop(t + 0.4);
      });
    } catch {}
  }
  keybinds.onChange(() => {
    if (phase === 'live') renderPanel();
    coach.labels();
  });

  function end() {
    ended = true;
    stopAuto();
    cleanupLesson();
    root.remove();
    pause(false);
    window.removeEventListener('keydown', onKey, true);
    pad.setActionFilter(null);
    if (typeof offTouch === 'function') offTouch();
    if (game.tutorial === api) game.tutorial = null;
  }

  // game.tutorial 자리 (main.js·gamepad.js·touch.js가 phase를 봄: 카드·성적표 = 'card')
  const api = {
    el: root,
    academy: true,
    get phase() {
      return phase === 'card' ? 'card' : phase === 'demo' ? 'demo' : phase === 'between' ? 'success' : 'live';
    },
    get stage() {
      return phase;
    },
    get lesson() {
      return lessonId;
    },
    get plan() {
      return P;
    },
    get judge() {
      return judge;
    },
    get demo() {
      return demo;
    },
    get exam() {
      return exam;
    },
    get last() {
      return lastRes;
    },
    spots: ctx.spots,
    ctx,
    coach,
    update,
    act,
    setup: (id) => (setup(id), showIntro()),
    startDemo,
    startLive,
    showReport,
    end,
  };
  game.tutorial = api;
  setup(lessonId);
  showIntro();
  return api;
}

// ------------------------------------------------------------------ 드리프트 각도 막대 (따라 하기 판)
const GAUGE_MAX = 1.35;
function driftGauge(car) {
  const D = car.cfg.drift || {};
  const win = Array.isArray(D.holdAngle) ? D.holdAngle : [0.28, 0.75];
  const spin = D.spinAngle || 1.15, exit = D.exitAngle || 0.6;
  const pc = (r) => `${Math.max(0, Math.min(100, (r / GAUGE_MAX) * 100)).toFixed(1)}%`;
  const a = car.drifting ? Math.abs(car.driftAngle || 0) : 0;
  const inWin = a >= win[0] && a <= win[1];
  const state = !car.drifting ? '드리프트 키를 누르면 바늘이 움직여요' : a > spin * 0.9 ? '⚠ 너무 돌아요! 카운터' : inWin ? (a < exit ? '좋아요! 지금 놓으면 깔끔' : '좋아요! 버티다가 펴면서 놓기') : a < win[0] ? '더 꺾어요' : '카운터로 줄여요';
  return `<div class="tut-gauge${car.drifting ? ' on' : ''}${inWin ? ' good' : ''}${a > spin * 0.9 ? ' bad' : ''}">
    <div class="gt"><span>드리프트 각도</span><b>${Math.round((a * 180) / Math.PI)}°</b></div>
    <div class="gb"><i class="win" style="left:${pc(win[0])};width:calc(${pc(win[1])} - ${pc(win[0])})"></i><i class="spin" style="left:${pc(spin)}"></i><i class="exit" style="left:${pc(exit)}"></i><i class="needle" style="left:${pc(a)}"></i></div>
    <div class="gs">${state}</div></div>`;
}
void padKbd;
void codeLabel;
