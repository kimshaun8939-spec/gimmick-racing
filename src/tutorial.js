// 튜토리얼: 처음 하는 사람이 "운전하는 법 → 빠르게 달리는 법 → 변신 → 메뉴·레이스 방식"을 차례로 배움
//   주소 ?map=gp&tutorial=1 (main.js가 이 파일의 startTutorial(game)을 부름)
//   ?tutorial=boat 는 바닷가(sea) 맵에서 배 모드만 따로 연습 (그랑프리에는 물이 없어서)
//   ?tstep=<단계 id> 이면 그 단계부터 (바닷가 연습에서 돌아올 때)
//
// 단계마다
//   card  : 설명 카드 (게임은 멈춤, game.paused). Enter = 시작/다음
//   setup : 연습 자리로 차를 옮김 (game.car.placeAt + 굴러가는 속도)
//   goal  : 매 프레임 차 상태(game.car)·이벤트(car.events)를 보고 성공/실패 판정. 실패하면 잠깐 뒤 다시 그 자리로
// 코너 자리는 레이싱 라인·코너 분석(car.cornerInfo)에서 자동으로 고름 → 코스를 바꿔도 따라감
//
// 2026-11-12 (튜토리얼 2): 처음 하는 사람용으로 단계를 잘게 나눔 + '시범 주행'(자동 운전·슬로 모션·누르는 키, src/tutorialDemo.js)
//   + '따라 하기'(같은 코너를 직접 달리고 성적표: 바깥 진입·브레이크 시점·에이펙스·탈출 가속). 슬로 모션 = main.js game.timeScale
//   실패하면 이유 + 도움말을 보여 주고 그 자리로 자동으로 돌아감, 어려운 미션은 🐢 천천히(timeScale 0.5~0.6) 버튼
import * as THREE from 'three';
import { keybinds, actionsFor, codeLabel } from './keybinds.js';
import { pad, padKbd } from './gamepad.js';
import { settings, uiSound } from './settings.js';
import { raceUrl, homeUrl, setLast } from './gameData.js';
import { touch, touchWanted } from './touch.js';
import { cornerPlan, createCoachUI, createDemo, createDrill, momentText, kbd as kbdTd } from './tutorialDemo.js';
import { needOf, smartProfile, coachSpeed } from './brakeNeed.js';
import { TUTORIAL_TEXT } from './academyText.js';
import { shortCard, shortKeys } from './academyCards.js';

const TUT_KEY = 'gimmick.tutorial';
const DOWN = new THREE.Vector3(0, -1, 0);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// 지금 정한 키 (<kbd>). 패드를 쓰는 중이면 패드 버튼
// 휴대폰(터치 버튼)이면 화면 버튼 이름으로
const TOUCH_LBL = { camView: '👁 시점', throttle: '▲ 가속', brake: '▼ 브레이크', drift: '💨 드리프트', climb: '⬆ 상승', dive: '⬇ 하강', respawn: '↺ 복귀', left: '◀', right: '▶' };
const onTouch = () => !pad.usingPad() && touchWanted();
const TK = (id) => (onTouch() && TOUCH_LBL[id] ? `<kbd>${TOUCH_LBL[id]}</kbd>` : null);
// 운전 키(가속·브레이크·좌우)는 W와 ↑처럼 기본·보조 키를 같이 보여 줌 (방향키로 하는 사람도 있어서)
const DRIVE_IDS = new Set(['throttle', 'brake', 'left', 'right']);
const K = (id) => TK(id) || (pad.usingPad() && pad.get(id) != null ? pad.html(id) : keybinds.html(id, DRIVE_IDS.has(id) ? 2 : 1));
const KK = (id) => TK(id) || (pad.usingPad() && pad.get(id) != null ? pad.html(id) : keybinds.html(id, 2));
/** 조향 글자: 패드면 왼쪽 스틱, 터치면 왼쪽 끌기, 키보드면 왼쪽·오른쪽 키 */
const STEER = () => (pad.usingPad() ? '<kbd class="pad">L 스틱</kbd>' : onTouch() ? '<kbd>◀ 왼쪽 끌기 ▶</kbd>' : [0, 1].flatMap((s) => [keybinds.keys('left')[s], keybinds.keys('right')[s]]).filter(Boolean).map((c) => `<kbd>${esc(codeLabel(c))}</kbd>`).join('') || `${K('left')}${K('right')}`);

export function startTutorial(game) {
  if (!game || !game.car) return;
  if (game.tutorial && game.tutorial.el) return game.tutorial; // 두 번 부르지 않게
  for (const [id, file] of [['tut2css', './tutorial2.css'], ['acadcss', './academy.css']]) {
    if (document.getElementById(id)) continue;
    const l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = new URL(file, import.meta.url).href;
    document.head.appendChild(l);
  }
  const params = new URLSearchParams(location.search);
  const boatOnly = params.get('tutorial') === 'boat';
  const car = game.car, track = game.track, race = game.race;
  const line = track.racingLine || (game.lineFx && game.lineFx.line) || null;
  const N = line ? line.N : 1;
  const ds = track.length / N;
  const W = (i) => ((Math.round(i) % N) + N) % N;
  const M = (m) => Math.max(1, Math.round(m / ds)); // m → 라인 지점 수
  const fwd = (a, b) => W(b - a) * ds; // a에서 앞으로 b까지 (m)
  const inSpace = (i) => !!(track.dimension && track.dimension.inSpaceT && track.dimension.inSpaceT(i / N));
  const ci = (() => {
    try {
      return car.cornerInfo;
    } catch {
      return null;
    }
  })();
  const corners = ci ? ci.corners : [];

  // ------------------------------------------------------------------ 연습 자리 고르기 (자동)
  const nearRunway = (i) => {
    if (!track.runway) return false;
    const p = track.sampleAt(i / N).pos, r = track.runway.start.pos;
    return Math.hypot(p.x - r.x, p.z - r.z) < 150;
  };
  const groundCorner = (c) => !inSpace(c.apexI) && !inSpace(c.brakeI) && !nearRunway(c.apexI);
  // 제동: 땅 위에서 속도를 가장 많이 줄이는 코너 (직선 끝 큰 제동)
  const brakeC = corners.filter((c) => groundCorner(c) && c.drop > 8).sort((a, b) => b.drop - a.drop)[0] || corners[0] || null;
  // 에이펙스·탈출: 혼자 있는 중간 속도(90~170 km/h) 코너 (제동 코너와 다른 곳). 없으면 제동 코너
  const apexC = corners.find((c) => c !== brakeC && groundCorner(c) && c.drop > 1.5 && c.vMin > 25 && c.vMin < 47 && !c.linkedPrev) || brakeC;
  // 고가도로·다리 밑처럼 도로가 겹치는 곳은 차를 놓을 때 위아래가 헷갈릴 수 있어서 피함
  const clearAt = (i) => {
    const p = track.sampleAt(W(i) / N).pos;
    for (let j = 0; j < N; j += 3) {
      if (Math.abs(W(j - i)) < M(150) || Math.abs(W(i - j)) < M(150)) continue;
      const q = track.sampleAt(j / N).pos;
      if (Math.hypot(q.x - p.x, q.z - p.z) < 30) return false;
    }
    return true;
  };
  const drillOk = (c) => groundCorner(c) && !inSpace(W(c.brakeI - M(330))) && !nearRunway(W(c.brakeI - M(330))) && [c.brakeI - M(330), c.brakeI - M(160), c.brakeI, c.apexI, c.exitI].every(clearAt);
  // 크게 제동하는 땅 위 코너들 (제동이 클수록 앞): 시범·따라 하기·라인 색 연습 자리
  //   + 이 차로 브레이크가 확실히 이득인 코너만 (brakeNeed.js: W만 떼는 것보다 0.25초 넘게 빠름). 잘 꺾이는 차로 '브레이크 필요 없는 코너'에서 브레이크를 시키지 않게
  //     (사용자 요청 2026-11-13). 그런 코너가 하나도 없으면 예전처럼 제동이 큰 코너
  const brakeGain = (c) => {
    try {
      const n = needOf(car, track, c);
      return n ? (n.kind === 'brake' ? n.gain : -1) : 1;
    } catch {
      return 1;
    }
  };
  const bigAll = corners.filter((c) => c.drop > 8 && drillOk(c)).sort((a, b) => b.drop - a.drop);
  const bigSure = bigAll.filter((c) => brakeGain(c) >= 0.25);
  const bigBrakes = bigSure.length ? bigSure : bigAll;
  const SPOT = {
    brake: brakeC,
    demo: bigBrakes[0] || null,
    lineC: bigBrakes[0] || null, // 라인 색 연습도 시범과 같은 코너 (그랑프리는 다른 큰 제동 코너들이 S자 안이라 처음 하는 사람에게 어려움)
    drill2: bigBrakes.find((c, j) => j >= 1 && c.side !== (bigBrakes[0] || {}).side) || bigBrakes[1] || null,
    apex: apexC,
    // 연계: 앞 코너와 이어진 코너 (둘 다 땅 위, 둘 다 브레이크가 조금이라도 있는 곳 우선, 위 두 코너와 겹치지 않게)
    linked: (() => {
      const pairs = [];
      for (const c of corners) {
        const p = corners[(c.k - 1 + corners.length) % corners.length];
        if (c.linkedPrev && p !== c && groundCorner(c) && groundCorner(p)) pairs.push([p, c]);
      }
      const score = ([p, c]) => (p.drop > 1.5 ? 2 : 0) + (c.drop > 1.5 ? 2 : 0) + (p === brakeC || c === brakeC || p === apexC || c === apexC ? -3 : 0) + (c.vMin < 47 ? 1 : 0);
      return pairs.sort((a, b) => score(b) - score(a))[0] || null;
    })(),
    // 드리프트: 땅 위에서 가장 느린 코너 (헤어핀)
    drift: corners.filter(groundCorner).sort((a, b) => a.vMin - b.vMin)[0] || null,
    // 가속 모드: 땅 위에서 가장 긴 직선
    straight: (() => {
      if (!line || !line.curvature) return null;
      let best = null, run = 0, start = 0;
      for (let j = 0; j < N * 2; j++) {
        const i = j % N;
        const ok = Math.abs(line.curvature[i]) < 1 / 700 && !inSpace(i) && !nearRunway(i);
        if (ok) {
          if (!run) start = i;
          run++;
          if (!best || run > best.len) best = { i0: start, len: run };
        } else run = 0;
        if (run > N / 3) break;
      }
      return best && best.len * ds > 250 ? { i0: best.i0, i1: W(best.i0 + best.len), m: best.len * ds } : null;
    })(),
  };
  // 그랑프리 코너 번호 이름 (T1 등)
  const cname = (c) => (c ? `T${c.num}` : '코너');

  // ------------------------------------------------------------------ 차 옮기기
  /** 라인 지점 i에 차를 놓고, 레이싱 라인 속도의 factor 배로 굴러가게 */
  function placeRolling(i, factor = 0.85, minSpeed = 0) {
    i = W(i);
    const t = i / N;
    car.placeAt(t, line ? line.offset[i] || 0 : 0);
    if (car.mode !== 'normal' && car.setMode) car.setMode('normal', true);
    let v = 0;
    try {
      v = line ? factor * car.lineSpeed(i) : 0;
    } catch {}
    v = Math.max(v, minSpeed);
    setSpeed(v);
    afterTeleport(t);
  }
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
    race.nextCp = 0; // 순간이동으로 한 바퀴가 끝나 버리지 않게
    race.wrongWay = 0;
    car.events.length = 0;
    seen.length = 0;
    try {
      game.renderOnce && game.renderOnce(); // 카메라를 차 뒤로 바로 옮김
    } catch {}
  }
  const idxNow = () => (car.trackInfo ? car.trackInfo.index % N : 0);

  // ------------------------------------------------------------------ 차 이벤트 엿보기 (main.js가 매 프레임 비우기 전에)
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

  // ------------------------------------------------------------------ 화면 만들기
  const root = document.createElement('div');
  root.id = 'tutorial';
  root.innerHTML = `
    <div class="tut-card-wrap"><div class="tut-card">
      <div class="tut-top"><span class="tut-chip"></span><div class="tut-dots"></div><button class="tut-x" data-t="quit" title="튜토리얼 끝내기">✕</button></div>
      <div class="tut-hero"><div class="tut-ic"></div><h2></h2></div>
      <div class="tut-body"></div>
      <div class="tut-btns"><button class="gm-btn" data-t="prev">‹ 이전</button><span class="sp"></span><button class="gm-btn" data-t="skip">건너뛰기</button><button class="gm-btn primary" data-t="go"></button></div>
    </div></div>
    <div class="tut-panel">
      <div class="tut-ph"><span class="tut-chip"></span><span class="tut-pt"></span></div>
      <div class="tut-pb"></div>
      <div class="tut-goals"></div>
      <div class="tut-hint"></div>
      <div class="tut-pbtns"><button class="gm-btn small" data-t="retry">↺ 다시 <span class="k"></span></button><button class="gm-btn small" data-t="demo">▶ 시범</button><button class="gm-btn small" data-t="slow">🐢 천천히</button><button class="gm-btn small" data-t="card">? 설명</button><button class="gm-btn small" data-t="skip">건너뛰기 ›</button></div>
    </div>
    <div class="tut-burst"><div class="ok">✓</div><div class="tx"></div><div class="sub"></div></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const cardWrap = $('.tut-card-wrap'), panel = $('.tut-panel'), burst = $('.tut-burst');
  const coach = createCoachUI(root); // 시범·따라 하기 화면 (키·페달·큰 글자)

  // ------------------------------------------------------------------ 그림들 (SVG)
  const SVG = {
    lights: `<div class="tut-lights"><i></i><i></i><i></i><i></i><i></i></div><div class="tut-arrow">빨간불 5개 → 모두 <b>꺼지는 순간</b> 출발!</div>`,
    lineColors: `<div class="tut-swatch"><span style="--c:#4dff7a">초록</span><em>계획 속도 이하 — 밟아도 돼요</em></div>
      <div class="tut-swatch"><span style="--c:#ffd23a">노랑</span><em>조금 빨라요 — 액셀을 떼요</em></div>
      <div class="tut-swatch"><span style="--c:#ff4b3a">빨강</span><em>너무 빨라요 — 브레이크!</em></div>`,
    // 아웃-인-아웃: 바깥에서 들어가 안쪽 연석(에이펙스)을 스치고 다시 바깥으로
    outInOut: `<svg class="tut-svg" viewBox="0 0 420 210" aria-hidden="true">
      <defs><pattern id="tutKerb" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="10" fill="#ff4b3a"/><rect x="5" width="5" height="10" fill="#fff"/></pattern></defs>
      <path d="M90 230 L90 110 Q90 50 150 50 L440 50" fill="none" stroke="#4a5062" stroke-width="72"/>
      <path d="M54 230 L54 108 Q54 14 148 14 L440 14" fill="none" stroke="#ffffffaa" stroke-width="2"/>
      <path d="M127 230 L127 112 Q127 87 152 87 L440 87" fill="none" stroke="url(#tutKerb)" stroke-width="6"/>
      <rect x="56" y="150" width="69" height="34" fill="#ff4b3a40" stroke="#ff6b5e" stroke-dasharray="5 4"/>
      <text x="90" y="171" class="s" text-anchor="middle">제동 (곧게)</text>
      <path d="M62 230 L62 150 Q64 100 122 90 Q190 80 250 34 Q275 20 440 20" fill="none" stroke="#4dff7a" stroke-width="5" stroke-linecap="round"/>
      <circle cx="123" cy="90" r="8" fill="#ffd23a" stroke="#000" stroke-width="2"/>
      <text x="64" y="204" class="b">① 바깥에서</text>
      <text x="142" y="118" class="b">② 에이펙스</text><text x="142" y="134" class="s">안쪽 연석을 스침</text>
      <text x="268" y="74" class="b">③ 바깥으로 · 액셀 꾹</text>
    </svg>`,
    // 왼쪽으로 도는 코너용 (위 그림을 좌우로 뒤집음, 글자는 그대로 읽히게)
    outInOutL: `<svg class="tut-svg" viewBox="0 0 420 210" aria-hidden="true">
      <defs><pattern id="tutKerbL" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="10" fill="#ff4b3a"/><rect x="5" width="5" height="10" fill="#fff"/></pattern></defs>
      <g transform="translate(420 0) scale(-1 1)">
      <path d="M90 230 L90 110 Q90 50 150 50 L440 50" fill="none" stroke="#4a5062" stroke-width="72"/>
      <path d="M54 230 L54 108 Q54 14 148 14 L440 14" fill="none" stroke="#ffffffaa" stroke-width="2"/>
      <path d="M127 230 L127 112 Q127 87 152 87 L440 87" fill="none" stroke="url(#tutKerbL)" stroke-width="6"/>
      <rect x="56" y="150" width="69" height="34" fill="#ff4b3a40" stroke="#ff6b5e" stroke-dasharray="5 4"/>
      <path d="M62 230 L62 150 Q64 100 122 90 Q190 80 250 34 Q275 20 440 20" fill="none" stroke="#4dff7a" stroke-width="5" stroke-linecap="round"/>
      <circle cx="123" cy="90" r="8" fill="#ffd23a" stroke="#000" stroke-width="2"/>
      </g>
      <text x="330" y="171" class="s" text-anchor="middle">제동 (곧게)</text>
      <text x="356" y="204" class="b" text-anchor="end">① 바깥에서</text>
      <text x="278" y="118" class="b" text-anchor="end">② 에이펙스</text><text x="278" y="134" class="s" text-anchor="end">안쪽 연석을 스침</text>
      <text x="152" y="74" class="b" text-anchor="end">③ 바깥으로 · 액셀 꾹</text>
    </svg>`,
    // 직선에서 브레이크 → 코너 (속도 그래프)
    brakeGraph: `<svg class="tut-svg" viewBox="0 0 420 150" aria-hidden="true">
      <line x1="20" y1="130" x2="410" y2="130" stroke="#ffffff33"/>
      <path d="M20 30 L210 30 L270 92 L300 92 L410 40" fill="none" stroke="#ffd23a" stroke-width="4" stroke-linejoin="round"/>
      <rect x="210" y="22" width="60" height="108" fill="#ff4b3a22"/>
      <text x="110" y="22" class="s" text-anchor="middle">직선: 끝까지 밟기</text>
      <text x="240" y="145" class="b" text-anchor="middle">곧게 꾹! 제동</text>
      <text x="285" y="112" class="s" text-anchor="middle">코너</text>
      <text x="360" y="30" class="s" text-anchor="middle">일찍 가속</text>
      <g class="sign"><rect x="150" y="96" width="24" height="18" rx="3"/><text x="162" y="109">150</text><rect x="180" y="96" width="24" height="18" rx="3"/><text x="192" y="109">100</text><rect x="210" y="96" width="24" height="18" rx="3"/><text x="222" y="109">50</text></g>
    </svg>`,
    // 이어진 코너 (S자)
    linked: `<svg class="tut-svg" viewBox="0 0 420 150" aria-hidden="true">
      <path d="M0 120 C90 120 110 30 210 30 S330 120 420 120" fill="none" stroke="#3a4154" stroke-width="54"/>
      <path d="M0 136 C95 136 112 52 210 52 S335 104 420 104" fill="none" stroke="#4dff7a" stroke-width="4" stroke-dasharray="10 6"/>
      <text x="110" y="140" class="b" text-anchor="middle">T1 탈출을 잘 하면</text>
      <text x="320" y="24" class="b" text-anchor="middle">T2도 빠르게 → 연계 ×2</text>
    </svg>`,
    forms: `<div class="tut-forms"><div><span>🚗</span>→<span>🔥</span><b>가속</b><small>150 km/h↑ · 핸들 곧게</small></div><div><span>🚗</span>→<span>🚤</span><b>배</b><small>물에 닿으면</small></div><div><span>🚗</span>→<span>✈️</span><b>비행</b><small>활주로에 올라서면</small></div></div>`,
    modes: `<div class="tut-modes"><div><span>🏁</span><b>봇 레이스</b><small>같은 등급 봇들과 순위 경쟁</small></div><div><span>⏱️</span><b>타임 어택</b><small>고스트(반투명 차)와 내 최고 기록 경쟁</small></div><div><span>🟪</span><b>구간 기록</b><small>한 바퀴 3구간 · 초록 = 내 최고보다 빠름</small></div><div><span>🌐</span><b>멀티플레이</b><small>방 코드로 친구와</small></div></div>`,
  };

  // ------------------------------------------------------------------ 단계들
  /**
   * 단계: { id, ic, chip, title, card() → html, go(버튼 글자), task() → html, goals: [글자], setup(s), update(dt, s) → 'done' | 'fail:이유' | null,
   *         after: 성공 글자, info: 카드만, kind: 'demo'(시범 주행) | 'drill'(따라 하기 → 성적표), keys: 화면 아래 키·페달 보이기,
   *         slowable: 🐢 천천히 버튼, hint(fails) → 실패 뒤 도움말 }
   * s = 단계별 상태 객체 (setup마다 새로)
   */
  const STEPS = [];
  const add = (st) => STEPS.push(st);
  const mem = {}; // 단계별 다시 하기 자리 (같은 자리로 돌아가게)
  const prof = () => car._lineProfile || (car.lineSpeed(0), car._lineProfile);
  /** 차 바로 앞 라인 색 (racingLineFx와 같은 계산: 브레이크가 필요 없는 코너는 노랑까지만): 'red' | 'yellow' | 'green' */
  function lineColorNear() {
    const P = prof();
    if (!P || !car.trackInfo) return 'green';
    let sp = null;
    try {
      sp = smartProfile(car, track);
    } catch {}
    const ref = sp ? sp.speed : P.speed;
    const idx = idxNow(), v = Math.abs(car.speed);
    let worst = -9;
    for (let k = 0, n = Math.round((v * 0.35 + 4) / ds); k <= n; k++) {
      const i = W(idx + k);
      worst = Math.max(worst, sp && sp.noBrake[i] ? Math.min(2.2, v - ref[i]) : v - ref[i]);
    }
    return worst > 3.5 ? 'red' : worst > 0.8 ? 'yellow' : 'green';
  }
  const COLOR_TXT = { red: ['빨강', '브레이크!', '#ff5a48'], yellow: ['노랑', '액셀을 떼요', '#ffd23a'], green: ['초록', '밟아도 돼요', '#4dff7a'] };
  const colorChip = () => {
    const c = COLOR_TXT[lineColorNear()];
    return `<div class="tut-gauge on" style="border-color:${c[2]}"><div class="gt"><span>지금 차 앞 라인</span><b style="color:${c[2]}">${c[0]}</b></div><div class="gs">${c[1]}</div></div>`;
  };

  if (boatOnly) {
    // ---------------- 바닷가: 배 모드 연습만
    const wr = (track.waterRanges || [])[0];
    add({
      id: 'boatIntro', ic: '🚤', chip: '배 모드', title: '바다에서는 배로 변신!', info: true,
      card: () => `<p>이 코스에는 <b>바다 구간</b>이 있어요. 물에 닿으면 차가 <b>자동으로 배</b>로 변신하고, 땅에 올라오면 다시 차가 돼요.</p>
        ${SVG.forms}<p class="tut-tip">💡 배는 물살에 살짝 미끄러져요. 꺾으면서 ${K('drift')}를 누르면 더 빨리 돌아요(카빙).</p>`,
      go: '연습하러 가기',
    });
    add({
      id: 'boat', ic: '🌊', chip: '배 모드', title: '물 건너기',
      card: null,
      task: () => `${K('throttle')} 로 바다까지 달려가 배로 변신한 뒤, 건너편 땅까지 가 보세요.`,
      goals: ['물에 닿아 배로 변신', '건너편 땅에 올라오기'],
      keys: true,
      setup(s) {
        if (!wr || !line) {
          s.noWater = true;
          return;
        }
        const i0 = W(wr.t0 * N - M(160));
        placeRolling(i0, 0.75, 18);
        s.i0 = i0;
        s.iEnd = W(wr.t1 * N + M(30));
      },
      update(dt, s) {
        if (s.noWater) return 'done';
        if (seen.includes('autoBoat') || car.mode === 'boat') s.g0 = true;
        if (s.g0 && car.mode !== 'boat' && car.grounded) s.g1 = true;
        if (seen.includes('sink')) return 'fail:가라앉았어요. 물에서는 액셀을 계속 밟아요';
        if (seen.includes('fall') || car.pos.y < -15) return 'fail:떨어졌어요. 다시 해 봐요';
        if (s.g0 && s.g1) return 'done';
        const d = fwd(s.i0, idxNow());
        if (d > fwd(s.i0, s.iEnd) + 120 && d < track.length / 2) return s.g0 ? 'done' : 'fail:물을 지나쳤어요';
        return null;
      },
      progress: (s) => [s.g0, s.g1],
      after: '배 변신 완료!',
    });
    add({
      id: 'boatDone', ic: '🎉', chip: '배 모드', title: '배 모드 끝!', info: true,
      card: () => `<p>물에서는 배, 땅에서는 차! 변신은 모두 <b>자동</b>이라 운전만 신경 쓰면 돼요.</p>
        <div class="tut-choices"><button class="gm-btn primary" data-goto="gp">🎓 그랑프리 튜토리얼 이어서 하기</button><button class="gm-btn" data-goto="home">🏠 홈으로</button></div>`,
      go: '그랑프리로 돌아가기',
      onGo: () => goTo('gp'),
    });
  } else {
    // ---------------- 그랑프리: 처음 하는 사람용 전체 과정 (2026-11-12 다시 만듦: 작은 단계 + 시범 주행 + 따라 하기)
    add({
      id: 'welcome', ic: '🏁', chip: '시작', title: '기믹 레이싱에 온 걸 환영해요!', info: true,
      card: () => `<p>약 <b>7분</b> 동안 운전하는 법부터 <b>진짜 레이스처럼 코너 도는 법</b>까지 하나씩 해 봐요. 게임을 처음 해도 괜찮아요!</p>
        <ul class="tut-list"><li>🎮 출발 · 가속 · 핸들 · 브레이크</li><li>🟩 라인 색 읽기</li><li>🎬 시범 주행 (슬로 모션)</li><li>🏎️ 따라 하기 → 성적표</li><li>💨 드리프트 · 변신</li><li>🧭 복귀 · 메뉴</li></ul>
        <p class="tut-tip">💡 막혀도 괜찮아요: 실패하면 <b>그 자리로 자동으로 돌아가고</b>, 도움말이 떠요. 미션마다 <b>건너뛰기</b>도 있어요. ${K('restart')} = 그 미션 다시.</p>
        ${pad.connected()
          ? `<p class="tut-tip tut-pad">🎮 게임패드 OK! ${pad.html('throttle')} 가속 · ${pad.html('brake')} 브레이크 · <kbd class="pad">L 스틱</kbd> 조향 · 설명 카드는 ${padKbd(0)}로 넘겨요</p>`
          : '<p class="tut-tip tut-pad">🎮 게임패드도 돼요. 연결하고 아무 버튼이나 누르면 안내가 패드 버튼으로 바뀌어요</p>'}`,
      go: '시작하기',
    });
    add({
      id: 'start', ic: '🚦', chip: '출발', title: 'F1식 출발 신호',
      card: () => `${SVG.lights}<p>빨간불이 하나씩 켜지고, 5개가 다 켜진 뒤 <b>한꺼번에 꺼지는 순간</b> ${K('throttle')}를 밟아요.</p>
        <p>불이 꺼지기 전에 밟고 있으면 <b>부정 출발</b> → 시동이 꺼져서 늦게 출발해요. 꺼지고 0.3초 안에 밟으면 <b>완벽한 출발</b>!</p>
        <p class="tut-tip">💡 손을 키에서 떼고 기다리다가, 불이 <b>모두 사라지면</b> 꾹!</p>`,
      go: '출발선으로',
      task: () => `불이 <b>모두 꺼지면</b> ${K('throttle')}! 그 전엔 손을 떼고 기다려요.`,
      goals: ['부정 출발 없이 출발하기'],
      keys: true,
      setup(s) {
        game.resetRace();
        car.events.length = 0;
        seen.length = 0;
      },
      update(dt, s) {
        if (seen.includes('jumpStart')) s.jump = true;
        coach.cue(race.phase === 'racing' ? 'throttle' : null);
        if (race.phase === 'racing' && car.forwardSpeed > 4) {
          if (s.jump) return 'fail:부정 출발! 불이 꺼진 다음에 밟아요';
          const r = race.reaction;
          s.after = r != null ? (r <= (car.cfg.engine.perfectReaction ?? 0.3) ? `완벽한 출발! 반응 ${r.toFixed(2)}초` : `출발! 반응 ${r.toFixed(2)}초`) : '출발!';
          return 'done';
        }
        return null;
      },
      progress: (s) => [race.phase === 'racing' && !s.jump],
      hint: () => '불이 켜지는 동안은 아무 키도 누르지 말고, 5개가 한 번에 꺼지면 그때 꾹!',
    });
    add({
      id: 'gas', ic: '🟢', chip: '가속', title: '가속',
      card: null,
      task: () => `${K('throttle')} 를 <b>꾹 누르고 있으면</b> 빨라져요. <b>100 km/h</b>까지!`,
      goals: ['100 km/h 넘기'],
      keys: true,
      setup(s) {
        if (race.phase !== 'racing') game.resetRace();
      },
      update(dt, s) {
        coach.cue('throttle');
        s.p = Math.min(1, (car.forwardSpeed * 3.6) / 100);
        return car.forwardSpeed * 3.6 >= 100 ? 'done' : null;
      },
      bar: (s) => s.p || 0,
      after: '좋아요! 이제 핸들도 써 봐요',
    });
    add({
      id: 'steer', ic: '↔️', chip: '핸들', title: '길 따라 달리기',
      card: null,
      task: () => `${STEER()} 로 방향을 바꿔요. <b>도로 안에서</b> 200 m 달려 보세요. 키를 <b>짧게 톡톡</b> 누르면 부드럽게 꺾여요.`,
      goals: ['도로 안에서 200 m 달리기'],
      keys: true,
      setup(s) {
        if (again && mem.steer != null) placeRolling(mem.steer, 0, 22);
        else if (race.phase !== 'racing') game.resetRace();
        s.i0 = mem.steer = idxNow();
        s.off = 0;
      },
      update(dt, s) {
        const d = fwd(s.i0, idxNow());
        if (car.offK > 0.6) s.off += dt;
        if (s.off > 1.5) return 'fail:도로 밖으로 나갔어요. 길이 휘는 쪽으로 미리 살짝 꺾어요';
        s.p = d < track.length / 2 ? Math.min(1, d / 200) : 0;
        return s.p >= 1 ? 'done' : null;
      },
      bar: (s) => s.p || 0,
      after: '핸들 OK! 빠를수록 조금만 꺾어도 많이 돌아요',
      hint: () => `왼쪽은 ${K('left')}, 오른쪽은 ${K('right')}. 꾹 누르지 말고 톡톡!`,
    });
    const S = SPOT.straight;
    add({
      id: 'stop', ic: '🛑', chip: '브레이크', title: '브레이크',
      card: null,
      task: () => `${K('brake')} 를 꾹 → <b>50 km/h 아래</b>로 줄이고, 다시 ${K('throttle')} 로 <b>80 km/h</b>!`,
      goals: [`${keybinds.main('brake')}로 50 km/h 아래로`, `다시 ${keybinds.main('throttle')}로 80 km/h`],
      keys: true,
      setup(s) {
        const i = S ? S.i0 : W(0.97 * N);
        if (again || car.forwardSpeed < 24) placeRolling(i, 0, 34);
        s.i0 = idxNow();
      },
      update(dt, s) {
        const k = car.forwardSpeed * 3.6;
        if (!s.g0 && k < 50 && car.brk > 0.3) s.g0 = true;
        if (s.g0 && k >= 80) s.g1 = true;
        coach.cue(s.g0 ? 'throttle' : 'brake');
        return s.g0 && s.g1 ? 'done' : null;
      },
      progress: (s) => [s.g0, s.g1],
      after: '좋아요! 브레이크는 세게, 짧게',
      hint: () => `${K('brake')}를 손을 떼지 말고 꾹 누르고 있어요. 서 있을 때 누르면 뒤로 가요`,
    });
    const LC = SPOT.lineC;
    if (LC && line) {
      add({
        id: 'line', ic: '🟩', chip: '라인 색', title: '도로 위 색깔 띠 = 레이싱 라인',
        card: () => `<p>도로 위의 띠는 <b>가장 빠른 길</b>이에요. 색은 <b>지금 속도가 괜찮은지</b> 알려 줘요.</p>${SVG.lineColors}
          <p>직선에서는 초록 → 코너가 가까워지면 <b style="color:#ff6b5e">빨강</b>으로 바뀌어요. 빨강이 차 앞까지 오면 ${K('brake')}, 다시 초록이 되면 ${K('throttle')}!</p>
          <p class="tut-tip">💡 ${K('racingLine')} 키로 켜고 끌 수 있어요. 익숙해질 때까지 켜 두세요.</p>`,
        go: `${cname(LC)} 코너로`,
        task: () => `라인이 <b style="color:#ff6b5e">빨강</b>이면 ${K('brake')}, <b style="color:#4dff7a">초록</b>이 되면 다시 ${K('throttle')}.`,
        goals: ['빨강일 때 브레이크', '초록이 되면 다시 가속'],
        keys: true,
        slowable: true,
        setup(s) {
          if (game.lineFx && !game.lineFx.visible && game.lineFx.line) {
            game.lineFx.toggle();
            settings.set('racingLine', true);
          }
          s.P = cornerPlan(game, LC, 300);
          placeRolling(s.P.i0, 0.95);
          s.i0 = s.P.i0;
        },
        update(dt, s) {
          const P = s.P, m = P.dist(idxNow());
          const col = lineColorNear();
          if (!s.g0 && col !== 'green' && car.brk > 0.4 && m > P.dB - 200) s.g0 = true;
          if (s.g0 && !s.g1 && col === 'green' && car.thr > 0.6 && m > P.dB) s.g1 = true;
          coach.cue(col === 'red' ? 'brake' : col === 'green' ? 'throttle' : null);
          if (seen.includes('respawn')) return 'fail:길을 벗어났어요. 빨강일 때 더 일찍 브레이크';
          if (s.g0 && s.g1) return 'done';
          if (m > P.dX + 60) return s.g0 ? 'done' : 'fail:브레이크를 안 밟았어요. 라인이 빨개지면 꾹!';
          return null;
        },
        progress: (s) => [s.g0, s.g1],
        gauge: () => colorChip(),
        after: '라인 읽기 OK!',
        hint: (f) => (f >= 2 ? '어려우면 🐢 천천히를 눌러 보세요. 빨강이 보이면 바로 브레이크!' : '차 바로 앞 라인이 빨개지는 순간 브레이크!'),
      });
    }
    // 시범 주행 + 따라 하기 (가장 크게 제동하는 땅 위 코너)
    const DC = SPOT.demo;
    if (DC && line) {
      add({
        id: 'demo', ic: '🎬', chip: '시범 주행', title: '코너는 이렇게! 시범 주행',
        kind: 'demo',
        card: () => `${DC.side > 0 ? SVG.outInOut : SVG.outInOutL}<p>빠른 사람이 코너를 도는 순서예요. 이제 <b>${cname(DC)} 코너</b>에서 자동 운전이 직접 보여 줄게요. 중요한 순간엔 <b>🐢 슬로 모션</b>으로 멈칫해요.</p>
          ${steps4(DC)}
          <p class="tut-tip">💡 화면 아래 키가 <b>지금 누르는 키</b>예요. 오른쪽 막대는 액셀·브레이크를 얼마나 밟는지 보여 줘요.</p>`,
        go: '▶ 시범 보기',
        after: '이제 따라 해 볼까요?',
      });
      add({
        id: 'follow', ic: '🏎️', chip: '따라 하기', title: '이제 따라 해 보세요!',
        kind: 'drill', corner: DC, slowDefault: false, // 사용자 요청 2026-11-12: 슬로 모션은 🐢 천천히를 직접 고를 때만
        card: () => `<p>방금 본 <b>${cname(DC)} 코너</b>를 직접 달려 봐요. 같은 자리에서 시작해요.</p>${steps4(DC)}
          <p class="tut-tip">💡 처음엔 코너 근처가 <b>🐢 천천히</b> 흘러가요. 화면 위 글자와 <b>깜빡이는 키</b>를 따라 하세요. 끝나면 <b>성적표</b>가 나와요.</p>`,
        go: '따라 하기 시작',
        task: () => `${cname(DC)}: 바깥 → ${K('brake')} → ${STEER()} → 에이펙스 → ${K('throttle')}`,
        goals: ['바깥에서 들어가기', '브레이크', '에이펙스', '에이펙스 뒤 가속'],
        keys: true,
        slowable: true,
      });
    }
    const D2 = SPOT.drill2;
    if (D2 && line) {
      add({
        id: 'follow2', ic: '🔁', chip: '한 번 더', title: `다른 코너에서 한 번 더 (${D2.side > 0 ? '오른쪽' : '왼쪽'} 코너)`,
        kind: 'drill', corner: D2, slowDefault: false, before: 170, factor: 0.9,
        card: () => `<p>이번엔 <b>${cname(D2)}</b>, ${D2.side > 0 ? '오른쪽' : '왼쪽'}으로 도는 코너예요. 요령은 같아요!</p>${steps4(D2)}
          <p class="tut-tip">💡 이번엔 진짜 속도예요. 어려우면 🐢 천천히를 켜도 되고, 건너뛰어도 괜찮아요.</p>`,
        go: '달리기',
        task: () => `${cname(D2)}: 바깥 → ${K('brake')} → ${STEER()} → 에이펙스 → ${K('throttle')}`,
        goals: ['바깥에서 들어가기', '브레이크', '에이펙스', '에이펙스 뒤 가속'],
        keys: true,
        slowable: true,
        hard: true,
      });
    }
    const D = SPOT.drift;
    if (D && line) {
      // 드리프트 기초: 꺾으면서 드리프트 키 → 조금이라도 미끄러지면 성공 (깔끔한 탈출은 보너스)
      const DCf = car.cfg.drift || {};
      const skill = Array.isArray(DCf.holdAngle) && typeof car.driftAngle === 'number';
      const WIN = skill ? DCf.holdAngle : [0.28, 0.75];
      const SPIN = DCf.spinAngle || 1.15, EXIT = DCf.exitAngle || 0.6;
      const deg = (r) => Math.round((r * 180) / Math.PI);
      const NEED = 0.6;
      add({
        id: 'drift', ic: '💨', chip: '드리프트', title: '드리프트 맛보기',
        card: () => `${driftSvg(WIN, SPIN, EXIT)}
          <p>느린 헤어핀에서 ${STEER()}로 꺾으면서 ${K('drift')}를 누르면 <b>꼬리가 미끄러지며</b> 돌아요.</p>
          <ul class="tut-list"><li>① 코너에서 꺾기</li><li>② ${K('drift')} 꾹</li><li>③ 너무 돌면 반대로 살짝</li><li>④ 펴면서 놓기</li></ul>
          <p class="tut-tip">💡 이번엔 <b>${NEED}초만 미끄러지면</b> 성공이에요. 초록 칸(${deg(WIN[0])}~${deg(WIN[1])}°)에서 버티다 펴고 놓으면 <b>깔끔한 탈출</b> 보너스! 레이스에선 아주 급한 코너에서만 짧게 써요.</p>`,
        go: `${cname(D)} 헤어핀으로`,
        task: () => `${cname(D)} 에서 꺾으면서 ${KK('drift')} → <b>${NEED}초</b> 미끄러지기!`,
        goals: [`드리프트 ${NEED}초`],
        keys: true,
        slowable: true,
        setup(s) {
          s.i0 = W(D.startI - M(200));
          placeRolling(s.i0, 0.95);
          s.dExit = fwd(s.i0, D.exitI);
          s.t = 0;
        },
        update(dt, s) {
          const d = fwd(s.i0, idxNow());
          if (seen.includes('respawn')) return 'fail:길을 벗어났어요';
          if (car.drifting) s.t += dt;
          s.p = Math.min(1, s.t / NEED);
          if (seen.includes('driftSpin')) setHint('스핀! 다음엔 반대로 살짝 꺾어(카운터) 각도를 줄여요', true);
          if (seen.includes('driftExit')) {
            const info = car.lastDriftInfo || {};
            s.after = info.gain > 0.3 ? `깔끔한 탈출! +${Math.round(info.gain * 3.6)} km/h` : '깔끔한 탈출!';
            if (s.t >= 0.2) return 'done';
          }
          if (s.t >= NEED && !car.drifting) {
            s.after = s.after || '드리프트 성공!';
            return 'done';
          }
          if (d < track.length / 2 && d > s.dExit + 40) return s.t >= NEED ? 'done' : s.t > 0 ? `fail:조금 더 길게! (${s.t.toFixed(1)}초)` : 'fail:코너에서 핸들을 꺾은 채로 드리프트 키를 꾹';
          return null;
        },
        progress: (s) => [s.t >= NEED],
        bar: (s) => s.p || 0,
        gauge: skill ? () => driftGauge(car, WIN, SPIN, EXIT) : null,
        after: '드리프트!',
        hard: true,
        hint: (f) => (f >= 2 ? `브레이크로 속도를 줄인 다음, 코너 안쪽으로 ${STEER()} 꺾고 바로 ${K('drift')}` : `핸들을 꺾은 상태에서 ${K('drift')}를 눌러야 미끄러져요`),
      });
    }
    add({
      id: 'forms', ic: '🔄', chip: '자동 변신', title: '차가 알아서 변신해요', info: true,
      card: () => `${SVG.forms}<p>변신은 모두 <b>자동</b>이에요. 운전만 하면 돼요. 화면 아래 버튼은 지금 모드를 보여 줄 뿐이에요.</p>
        <p class="tut-tip">💡 그랑프리에는 바다가 없어요. 배 변신은 <b>바닷가 코스</b>에서 해 볼 수 있어요.
        <button class="gm-btn small" data-goto="boat">🚤 바닷가에서 배 연습</button></p>`,
      go: '가속 모드 해 보기',
    });
    add({
      id: 'accel', ic: '🔥', chip: '가속 모드', title: '긴 직선에서 가속 모드',
      card: null,
      task: () => `긴 직선이에요. ${K('throttle')} 꾹, 핸들은 <b>곧게</b> → 150 km/h를 넘으면 자동 변신!`,
      goals: ['가속 모드로 변신'],
      keys: true,
      setup(s) {
        if (S) {
          s.i0 = S.i0;
          placeRolling(S.i0, 0, 36);
          s.dEnd = S.m;
        } else {
          placeRolling(W(0.97 * N), 0, 36);
          s.dEnd = 600;
          s.i0 = W(0.97 * N);
        }
      },
      update(dt, s) {
        coach.cue('throttle');
        if (car.mode === 'accel') return 'done';
        const d = fwd(s.i0, idxNow());
        if (d < track.length / 2 && d > s.dEnd + 80) return 'fail:핸들을 곧게 하고 끝까지 밟아요';
        return null;
      },
      bar: () => Math.min(1, (car.forwardSpeed * 3.6) / 150),
      after: '🔥 가속 모드! 빠르지만 조금 미끄러워요',
    });
    if (track.runway) {
      add({
        id: 'fly', ic: '✈️', chip: '비행', title: '활주로 = 비행기로 변신',
        card: () => `<p>그랑프리 활주로에 올라서면 자동으로 <b>비행 모드</b>! 약 94 km/h를 넘으면 ${K('climb')}로 이륙해요.</p>
          <div class="tut-rules"><span>${K('climb')} 상승</span><span>${K('dive')} 하강</span><span>${STEER()} 기울여 선회</span><span>${K('throttle')} 추력</span></div>
          <p class="tut-tip">💡 고리를 잇는 하늘길에서만 날 수 있어요. 벗어나면 자동으로 내려와요. 이번엔 <b>2초</b>만 날면 성공!</p>`,
        go: '활주로로',
        task: () => `${K('throttle')} 로 속도를 올리고 ${K('climb')} 로 이륙 → <b>2초</b> 날기!`,
        goals: ['이륙', '2초 날기'],
        setup(s) {
          const rw = track.runway;
          const smp = rw.samples.find((x) => x.dist >= 60) || rw.samples[Math.floor(rw.samples.length / 3)];
          if (car.mode !== 'normal' && car.setMode) car.setMode('normal', true);
          const t = track.nearest ? track.nearest(rw.start.pos).t : 0;
          car.placeAt(t, 0);
          car.pos.copy(smp.pos);
          car.fwd.copy(smp.tan);
          car.up.set(0, 1, 0);
          car.surface = 'road';
          setSpeed(22);
          afterTeleport(t);
          s.air = 0;
        },
        update(dt, s) {
          if (car.flying) (s.took = true), (s.air += dt);
          s.p = Math.min(1, s.air / 2);
          if (s.air >= 2) return 'done';
          if (seen.includes('respawn') || seen.includes('fall')) return 'fail:떨어졌어요. 속도를 유지하며 날아요';
          if (!car.flying && car.mode !== 'fly' && (s.t = (s.t || 0) + dt) > 4) return 'fail:활주로 위에서 이륙해요';
          if (!car.flying && (s.g = (s.g || 0) + dt) > 9) return `fail:${keybinds.main('throttle')}로 속도를 올린 뒤 ${keybinds.main('climb')}를 눌러요`;
          return null;
        },
        progress: (s) => [s.took, s.air >= 2],
        bar: (s) => s.p || 0,
        after: '✈️ 비행 성공! 레이스에선 고리를 따라 날다 착륙장에 내려요',
      });
    }
    add({
      id: 'respawn', ic: '↩️', chip: '복귀', title: '길을 벗어나면 복귀',
      card: null,
      task: () => `도로 밖에 나왔어요! ${K('respawn')} 를 눌러 도로로 돌아가요.`,
      goals: [pad.usingPad() && pad.get('respawn') != null ? `${pad.label('respawn')} 버튼으로 복귀` : onTouch() ? '↺ 복귀 버튼으로 복귀' : `${keybinds.main('respawn')} 키로 복귀`],
      setup(s) {
        // 도로 옆 땅 위 (떨어지지 않는 평평한 곳)를 찾음
        const half = track.width / 2;
        let spot = null;
        for (let k = 0; k < 60 && !spot; k++) {
          const i = W((0.02 + k * 0.013) * N);
          if (inSpace(i) || nearRunway(i)) continue;
          for (const side of [1, -1]) {
            const smp = track.sampleAt(i / N);
            const p = smp.pos.clone().addScaledVector(smp.right, side * (half + 9));
            const hit = track.castRay(p.clone().setY(smp.pos.y + 6), DOWN, 14);
            if (hit && hit.normal && hit.normal.y > 0.9 && Math.abs(hit.point.y - smp.pos.y) < 2) {
              spot = { i, lat: side * (half + 9) };
              break;
            }
          }
        }
        const i = spot ? spot.i : W(0.03 * N);
        car.placeAt(i / N, spot ? spot.lat : track.width / 2 + 4);
        setSpeed(0);
        afterTeleport(car.lastSafeT);
        car.lastSafeT = i / N + 40 / track.length;
        s.keyed = false;
        s.noOffFail = true;
      },
      update(dt, s) {
        if (s.keyed && seen.includes('respawn')) return 'done';
        return null;
      },
      after: '복귀! 굴러가는 속도로 다시 시작해요',
    });
    add({
      id: 'menu', ic: '⏸', chip: '메뉴', title: '메뉴 · 일시정지',
      card: null,
      task: () => `${K('menu')} 로 메뉴를 열어 보세요. 설정·조작키·다시 시작·홈이 있어요. 그다음 <b>계속하기</b>.`,
      goals: ['메뉴 열기', '계속하기'],
      setup(s) {
        s.noOffFail = true;
      },
      update(dt, s) {
        if (game.menu && game.menu.isOpen) s.opened = true;
        if (s.opened && game.menu && !game.menu.isOpen) s.closed = true;
        return s.opened && s.closed ? 'done' : null;
      },
      progress: (s) => [s.opened, s.closed],
      after: '창을 벗어나면 자동으로 멈춰요',
    });
    add({
      id: 'modes', ic: '🏆', chip: '레이스 방식', title: '이제 진짜 레이스!', info: true,
      card: () => `${SVG.modes}<p>홈에서 <b>레이스 시작</b>을 누르면 방식을 골라요. 봇 수·실력, 고스트는 설정에서도 바꿀 수 있어요.</p>
        <p class="tut-tip">💡 기록을 줄이는 순서: ① 코너 전 바깥으로 → ② 직선에서 브레이크 → ③ 에이펙스 → ④ 에이펙스 뒤 일찍 액셀</p>
        <p class="tut-tip">🎥 달리는 중 ${K('camView')} 로 시점을 바꿀 수 있어요 (기본 · 가까이 · 멀리 · 보닛 · 운전석).</p>
        <p class="tut-tip">🟩 레이스에서 뒤처지면: 도로의 <b>DRS DETECTION</b> 선에서 앞차와 1초 안이면 다음 <b>DRS ZONE</b> 직선에서 뒷날개가 열려 빨라져요 · 앞차 뒤에 붙으면 💨 슬립스트림.</p>`,
      go: '다음',
    });
    add({
      id: 'done', ic: '🎉', chip: '끝', title: '튜토리얼 완료!', info: true, final: true,
      card: () => `<div class="tut-summary">${STEPS.filter((x) => !x.info).map((x) => `<span class="${doneSet.has(x.id) ? 'ok' : 'skip'}">${doneSet.has(x.id) ? '✓' : '–'} ${esc(x.chip)}</span>`).join('')}</div>
        <p>이제 마음껏 달려 보세요! 처음엔 <b>봇 실력 '쉬움'</b>이 좋아요. 언제든 홈의 <b>튜토리얼</b>로 다시 볼 수 있어요.</p>
        <button class="gm-btn tut-next-ac" data-goto="academy"><span class="ic">🎓</span><span><b>다음은 드라이빙 아카데미</b><small>브레이크 포인트·트레일 브레이킹·연석·슬립스트림·DRS… 레슨 11개로 메달을 모으고 라이선스 C → S를 따요</small></span><i>›</i></button>
        <div class="tut-choices"><button class="gm-btn primary" data-goto="race">🏁 봇 레이스</button><button class="gm-btn" data-goto="time">⏱️ 타임 어택</button><button class="gm-btn" data-goto="free">🧭 자유 연습</button><button class="gm-btn" data-goto="home">🏠 홈으로</button></div>`,
      go: '봇 레이스 시작',
      onGo: () => goTo('race'),
    });
  }

  /** 코너 요령 4칸 (바깥 → 브레이크 → 꺾기·에이펙스 → 가속) */
  function steps4(c) {
    const out = c.side > 0 ? '왼쪽' : '오른쪽', turn = c.side > 0 ? 'right' : 'left';
    return `<div class="td-steps4"><div><span>①</span>코너 전<br>바깥(${out})으로</div><div><span>②</span>직선에서<br>${kbdTd('brake')} 꾹</div><div><span>③</span>${kbdTd(turn)} 꺾어<br>안쪽 에이펙스</div><div><span>④</span>지나면<br>${kbdTd('throttle')} 꾹</div></div>`;
  }

  function exitReason(c) {
    const k = car.cfg.corner || {};
    if (c.noBrake === false) return '에이펙스 뒤에 브레이크를 밟았어요';
    if (c.thrAvg != null && c.thrAvg < (k.exitThrottle ?? 0.75)) return '탈출에서 액셀을 더 일찍, 꾹 밟아요';
    if (c.latErr != null && c.latErr > (k.exitTol ?? 2.5)) return '바깥쪽까지 넓게 나가요 (라인을 따라)';
    if (c.ratio != null && c.ratio < (k.exitSpeedRatio ?? 0.8)) return '너무 느려요. 브레이크 키를 더 일찍 떼요';
    return '잔디에 닿았어요';
  }

  // ------------------------------------------------------------------ 진행
  const doneSet = new Set();
  let cur = 0, phase = 'card', st = null, fails = 0, waitT = 0, ended = false, lastReason = '';
  let again = false; // 지금 setup이 다시 하기인지 (단계 setup에서 봄)
  let retrying = false;
  let returnTo = null; // 따라 하기에서 '시범 다시 보기'를 누르면 시범이 끝난 뒤 돌아갈 단계
  let demo = null, drill = null, ts = 1;
  const slowPref = {}; // 단계별 🐢 천천히 (따라 하기 첫 번째는 켜고 시작)
  const startId = params.get('tstep');
  if (startId) {
    const j = STEPS.findIndex((x) => x.id === startId);
    if (j >= 0) cur = j;
  }
  // 이어서 하기: 바닷가에서 돌아왔으면 앞 단계들은 한 것으로
  if (cur > 0) for (let j = 0; j < cur; j++) if (!STEPS[j].info) doneSet.add(STEPS[j].id);

  function pause(on) {
    game.paused = on;
    if (!on && game.input) game.input.clear(); // 카드에서 누른 키가 게임으로 새지 않게
  }
  function setTS(x) {
    ts = x;
    game.timeScale = x;
  }
  /** 시범·자동 운전을 멈추고 보통으로 */
  function stopAuto() {
    if (demo) demo.stop();
    demo = null;
    if (game.controlsOverride) game.controlsOverride = null;
    setTS(1);
  }
  const slowOn = (s) => (s.id in slowPref ? slowPref[s.id] : !!s.slowDefault);

  function dots() {
    return STEPS.map((x, j) => `<i class="${j === cur ? 'cur' : doneSet.has(x.id) ? 'ok' : j < cur ? 'past' : ''}" title="${esc(x.chip)}"></i>`).join('');
  }

  function cardFrame(s, chip) {
    phase = 'card';
    $('.tut-card').classList.remove('ac-short-frame');
    stopAuto();
    pause(true);
    try {
      game.renderOnce && game.renderOnce();
    } catch {}
    panel.classList.remove('on');
    coach.hide();
    $('.tut-card .tut-chip').textContent = chip || `${cur + 1} / ${STEPS.length} · ${s.chip}`;
    $('.tut-card .tut-dots').innerHTML = dots();
    $('.tut-card .tut-ic').textContent = s.ic;
  }
  function showCard() {
    const s = STEPS[cur];
    cardFrame(s);
    $('.tut-card').classList.remove('tdr');
    $('.tut-card h2').textContent = s.title;
    const text = Object.hasOwn(TUTORIAL_TEXT, s.id) ? TUTORIAL_TEXT[s.id] : null;
    $('.tut-card').classList.toggle('ac-short-frame', !!text);
    if (text) {
      // 예전 카드 안의 이동 버튼도 보존 (완료·배 연습·아카데미 등). 긴 글은 넣지 않음.
      const choices = document.createElement('template');
      choices.innerHTML = s.card ? s.card() : '';
      const buttons = [...choices.content.querySelectorAll('[data-goto]')].map((b) => b.outerHTML).join('');
      $('.tut-card .tut-body').innerHTML = shortCard({
        ...text, buttons, keyHtml: (key) => shortKeys(key, K),
      });
    } else {
      $('.tut-card .tut-body').innerHTML = s.card ? s.card() : `<p>${s.task ? s.task() : ''}</p>`;
    }
    $('.tut-card .tut-btns').style.display = '';
    $('.tut-card [data-t="go"]').innerHTML = `${esc(s.go || (s.info ? '다음' : '시작'))} <kbd>Enter</kbd>`;
    $('.tut-card [data-t="prev"]').style.visibility = cur > 0 ? '' : 'hidden';
    $('.tut-card [data-t="skip"]').style.display = s.final ? 'none' : '';
    $('.tut-card [data-t="skip"]').textContent = s.info ? '튜토리얼 끝내기' : s.kind === 'demo' ? '시범 건너뛰기' : '이 미션 건너뛰기';
    openCard($('.tut-card [data-t="go"]'));
  }
  function openCard(focusEl) {
    cardWrap.classList.remove('on');
    void cardWrap.offsetWidth;
    cardWrap.classList.add('on');
    focusEl && focusEl.focus({ preventScroll: true });
  }

  function startLive() {
    const s = STEPS[cur];
    again = phase === 'fail' || phase === 'report' || retrying;
    retrying = false;
    stopAuto();
    phase = 'live';
    cardWrap.classList.remove('on');
    burst.classList.remove('on');
    st = { after: null };
    if (!again) (fails = 0), (lastReason = '');
    seen.length = 0;
    pause(false);
    if (race.phase === 'finished' || (race.phase === 'countdown' && s.id !== 'start')) {
      // 결과 화면·출발 신호가 남아 있으면 바로 달릴 수 있게
      game.resetRace();
      race.phase = 'racing';
      race.lights = 0;
    }
    drill = null;
    if (s.kind === 'demo') return startDemo(s);
    if (s.kind === 'drill') {
      st.P = cornerPlan(game, s.corner, s.before || 330);
      st.i0 = st.P.i0;
      placeRolling(st.P.i0, s.factor || 0.95);
      drill = createDrill(game, st.P);
      drill.R.slow = slowOn(s);
    } else {
      try {
        s.setup && s.setup(st);
      } catch (e) {
        console.warn('튜토리얼 준비 실패', e);
      }
    }
    renderPanel();
    if (again && lastReason) setHint(`다시! 지난번: ${lastReason}${s.hint ? ' · ' : ''}${s.hint ? s.hint(fails) : ''}`, false, true);
    panel.classList.add('on');
    coach.buttons('');
    if (s.keys) {
      coach.show('follow');
      coach.badge(s.kind === 'drill' ? `🏎️ 따라 하기 · ${cname(s.corner)}${slowOn(s) ? ' · 🐢 천천히' : ''}` : '');
      coach.caption('', '');
      coach.clearStrip();
      coach.slow(1);
      coach.cue(null);
    } else coach.hide();
  }

  // ---------------- 시범 주행
  function startDemo(s) {
    phase = 'demo';
    panel.classList.remove('on');
    const P = cornerPlan(game, SPOT.demo, 330);
    demo = createDemo(game, P, coach, () => placeRolling(P.i0, 0.95));
    demo.start();
    coach.buttons(`<button class="gm-btn small" data-t="demoAgain">↺ 처음부터 <kbd>${esc(keybinds.main('restart'))}</kbd></button><button class="gm-btn small" data-t="demoSkip">${returnTo != null ? '돌아가기 ›' : '건너뛰기 ›'}</button>`);
  }
  function demoDone(skipped) {
    stopAuto();
    coach.hide();
    const s = STEPS[cur];
    if (!skipped) doneSet.add(s.id);
    if (returnTo != null) {
      cur = returnTo;
      returnTo = null;
      return showCard();
    }
    if (skipped) return next();
    phase = 'success';
    waitT = 1.4;
    burst.querySelector('.tx').textContent = s.after || '시범 끝!';
    burst.querySelector('.sub').textContent = '이번엔 직접 해 봐요';
    burst.classList.remove('on');
    void burst.offsetWidth;
    burst.classList.add('on');
    chime(true);
  }
  function watchDemo() {
    const j = STEPS.findIndex((x) => x.kind === 'demo');
    if (j < 0) return;
    uiSound('select');
    if (STEPS[cur].kind !== 'demo') returnTo = cur;
    cur = j;
    startLive();
  }

  // ---------------- 따라 하기 성적표
  function showReport() {
    const s = STEPS[cur];
    const res = drill.result();
    if (res.pass) doneSet.add(s.id);
    else fails++;
    lastReason = '';
    const P = st.P;
    cardFrame(s, `${cur + 1} / ${STEPS.length} · 성적표`);
    phase = 'report';
    const stars = res.rows.filter((r) => r.ok === 'ok').length;
    $('.tut-card h2').textContent = res.respawn ? '길을 벗어났어요' : stars === 4 ? '완벽해요! 진짜 레이서!' : res.pass ? '잘했어요!' : stars >= 2 ? '거의 다 왔어요!' : '괜찮아요, 한 번 더!';
    const worst = res.rows.find((r) => r.ok === 'bad') || res.rows.find((r) => r.ok === 'meh');
    const tip = res.respawn ? '브레이크를 더 일찍, 세게 밟아 보세요' : worst ? `다음엔 이것만: ${worst.text}` : '이 느낌 그대로 레이스에서도!';
    const slow = slowOn(s);
    $('.tut-card .tut-body').innerHTML = `
      <div class="tdr-stars">${[0, 1, 2, 3].map((j) => `<i class="${j < stars ? 'on' : ''}" style="animation-delay:${0.15 * j}s">★</i>`).join('')}</div>
      <div class="tdr-rows">${res.rows.map((r) => `<div class="tdr-row ${r.ok}"><span class="ic">${r.ok === 'ok' ? '✓' : r.ok === 'meh' ? '△' : '✗'}</span><b>${esc(r.title)}</b><span>${r.text}</span></div>`).join('')}</div>
      <div class="tdr-tip">💡 ${tip}${res.slow ? ' · 🐢 천천히로 달렸어요' : ''}</div>
      <div class="tdr-btns">
        <button class="gm-btn ${res.pass ? '' : 'primary'}" data-t="again">↺ 다시 해 보기</button>
        <button class="gm-btn" data-t="demo">▶ 시범 다시 보기</button>
        <button class="gm-btn" data-t="slowTog">${slow ? '🏁 진짜 속도로' : '🐢 천천히 해 보기'}</button>
        <span class="sp"></span>
        <button class="gm-btn ${res.pass ? 'primary' : ''}" data-t="next">다음 ›</button>
      </div>
      ${!res.pass && fails >= 2 ? '<p class="tut-tip">어려우면 <b>다음 ›</b>으로 넘어가도 괜찮아요. 레이스에서 연습하면 늘어요!</p>' : ''}`;
    $('.tut-card .tut-btns').style.display = 'none';
    $('.tut-card').classList.add('tdr');
    void P;
    chime(res.pass);
    openCard($(`.tut-card [data-t="${res.pass ? 'next' : 'again'}"]`));
  }

  function renderPanel() {
    const s = STEPS[cur];
    // 왼쪽 위 기록판(#topLeft) 바로 아래에 놓음 (기록판 크기가 바뀌어도 겹치지 않게)
    const tl = document.getElementById('topLeft');
    const r = tl && tl.getBoundingClientRect();
    if (r && r.height && innerWidth > 720) panel.style.top = `${Math.round(Math.min(innerHeight * 0.45, r.bottom + 14))}px`;
    $('.tut-panel .tut-chip').textContent = `미션 ${cur + 1}/${STEPS.length}`;
    $('.tut-panel .tut-pt').textContent = `${s.ic} ${s.chip}`;
    $('.tut-panel .tut-pb').innerHTML = s.task ? s.task() : '';
    $('.tut-panel [data-t="retry"] .k').innerHTML = K('restart');
    $('.tut-panel [data-t="card"]').style.display = s.card ? '' : 'none';
    panel.classList.toggle('tdc', s.kind === 'drill');
    $('.tut-panel [data-t="demo"]').style.display = s.kind === 'drill' ? '' : 'none';
    const sb = $('.tut-panel [data-t="slow"]');
    sb.style.display = s.slowable ? '' : 'none';
    sb.textContent = slowOn(s) ? '🐢 천천히 켬' : '🐢 천천히';
    sb.classList.toggle('primary', slowOn(s));
    renderGoals();
    setHint(s.hard && fails >= 2 ? '어려우면 건너뛰기를 눌러도 괜찮아요' : '');
  }
  function renderGoals() {
    const s = STEPS[cur];
    const prog = s.kind === 'drill' && drill ? drillProg() : s.progress ? s.progress(st) : [];
    const bar = s.bar ? s.bar(st) : null;
    $('.tut-panel .tut-goals').innerHTML = (s.goals || [])
      .map((g, j) => `<div class="g ${prog[j] ? 'ok' : ''}"><i>${prog[j] ? '✓' : ''}</i><span>${esc(g)}</span></div>`)
      .join('') + (bar != null ? `<div class="tut-bar"><b style="width:${Math.round(bar * 100)}%"></b></div>` : '') + (s.gauge && phase !== 'card' ? s.gauge(st) : '');
  }
  function drillProg() {
    const R = drill.R, P = st.P;
    return [R.outLat != null && R.outLat <= Math.max(P.outLine, -P.hw * 0.25) + 1.5, R.brakeD != null, !!R.apex, R.gasDelay != null && R.gasDelay < 1.2];
  }
  function setHint(t, bad, html) {
    const h = $('.tut-panel .tut-hint');
    if (html) h.innerHTML = t || '';
    else h.textContent = t || '';
    h.classList.toggle('on', !!t);
    h.classList.toggle('bad', !!bad);
  }

  function success() {
    const s = STEPS[cur];
    doneSet.add(s.id);
    phase = 'success';
    waitT = 1.6;
    setTS(1);
    coach.cue(null);
    renderGoals();
    burst.querySelector('.tx').textContent = (st && st.after) || s.after || '성공!';
    burst.querySelector('.sub').textContent = '잘했어요!';
    burst.classList.remove('on');
    void burst.offsetWidth;
    burst.classList.add('on');
    chime(true);
  }
  function fail(reason) {
    fails++;
    lastReason = reason;
    phase = 'fail';
    waitT = 1.6;
    setTS(1);
    const s = STEPS[cur];
    const extra = s.hint && fails >= 1 ? ` <br>💡 ${s.hint(fails)}` : '';
    const skipTip = fails >= 3 ? ' · 어려우면 건너뛰기를 눌러도 괜찮아요' : '';
    setHint(`✗ ${esc(reason)}${skipTip}${extra}<br><small>잠깐 뒤 그 자리로 돌아가요…</small>`, true, true);
    chime(false);
  }

  function next() {
    burst.classList.remove('on');
    stopAuto();
    if (cur >= STEPS.length - 1) return finish();
    cur++;
    const s = STEPS[cur];
    if (s.card) showCard();
    else startLive();
  }
  function prev() {
    if (cur <= 0) return;
    cur--;
    showCard();
  }
  function retry() {
    if (phase === 'demo') return uiSound('back'), startLive();
    if (phase !== 'live' && phase !== 'fail' && phase !== 'report') return;
    uiSound('back');
    retrying = true;
    startLive();
  }
  function skip() {
    uiSound('back');
    if (STEPS[cur].info) return quit();
    if (phase === 'demo') return demoDone(true);
    next();
  }
  function finish() {
    try {
      localStorage.setItem(TUT_KEY, 'done');
    } catch {}
    goTo('home');
  }
  async function quit() {
    try {
      localStorage.setItem(TUT_KEY, localStorage.getItem(TUT_KEY) || 'asked');
    } catch {}
    end();
  }
  /** 튜토리얼을 닫고 자유 주행으로 */
  function end() {
    ended = true;
    stopAuto();
    root.remove();
    pause(false);
    window.removeEventListener('keydown', onKey, true);
    pad.setActionFilter(null);
    if (typeof offTouch === 'function') offTouch();
  }
  function goTo(where) {
    const carId = game.carId || 'f1';
    stopAuto();
    if (['race', 'time', 'free', 'home', 'academy'].includes(where)) {
      try {
        localStorage.setItem(TUT_KEY, 'done');
      } catch {}
    }
    setLast({ map: 'gp', car: carId });
    const url =
      where === 'boat' ? raceUrl('sea', carId, { tutorial: 'boat', tret: STEPS[cur + 1] ? STEPS[cur + 1].id : 'accel' })
      : where === 'gp' ? raceUrl('gp', carId, { tutorial: 1, tstep: params.get('tret') || 'accel' })
      : where === 'race' || where === 'time' ? raceUrl('gp', carId, { mode: where, botLevel: where === 'race' ? 'easy' : null })
      : where === 'free' ? raceUrl('gp', carId)
      : where === 'academy' ? homeUrl('academy') // 드라이빙 아카데미 (2026-11-12)
      : homeUrl();
    location.href = url;
  }

  // ------------------------------------------------------------------ 매 프레임
  let last = performance.now();
  function update(dt) {
    if (ended) return;
    hookEvents();
    const s = STEPS[cur];
    if (game.menu && game.menu.isOpen && s.id !== 'menu') return; // 메뉴가 열려 있으면 기다림
    // Esc 메뉴의 "다시 시작" 등으로 레이스가 처음으로 돌아가면 이 미션 자리로 다시 옮김
    if ((phase === 'live' || phase === 'demo') && s.id !== 'start' && race.phase === 'countdown') return startLive();
    if (phase === 'demo') {
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
    if (phase === 'live') {
      // 순간이동 직후에는 차의 코스 위치(trackInfo)가 아직 옛 자리라서 잠깐(0.25초) 판정을 쉼
      st._age = (st._age || 0) + dt;
      if (s.keys) {
        coach.keys(car.thr, car.brk, car.steerIn, dt);
        coach.pedals(car.thr, car.brk, car.speed, car.trackInfo && line ? coachSpeed(car, track, idxNow()) : null);
      }
      if (st._age < 0.25 || !car.trackInfo) {
        seen.length = 0;
        return;
      }
      let r = null;
      // 막힘 감지: 연습 자리(i0)가 있는 미션에서 6초 동안 앞으로 못 가면 (벽에 박힘·거꾸로) 다시
      if (st.i0 != null) {
        const d = fwd(st.i0, idxNow());
        const dd = d < track.length / 2 ? d : 0;
        if (st._far == null || dd > st._far + 5) (st._far = dd), (st._stuck = 0);
        else st._stuck = (st._stuck || 0) + dt;
        if (st._stuck > 6) r = 'fail:멈췄어요. 그 자리에서 다시 해요';
      }
      // 도로 밖에 오래 있으면 자동으로 연습 자리로 (복귀 미션은 빼고)
      if (!st.noOffFail && car.offK > 0.85 && car.grounded && car.mode !== 'boat' && car.mode !== 'fly' && !car.flying) st._off = (st._off || 0) + dt;
      else st._off = Math.max(0, (st._off || 0) - dt * 2);
      if (!r && st._off > 3) r = 'fail:도로 밖에 오래 있었어요. 연습 자리로 돌아가요';
      try {
        if (!r) r = s.kind === 'drill' ? drillUpdate(dt, s) : s.update(dt, st);
      } catch (e) {
        console.warn('튜토리얼 판정 오류', e);
      }
      // 따라 하기에서 도로 밖·멈춤으로 끝나면 그냥 다시 하지 않고 성적표로 (무엇이 문제였는지 알려 줌)
      if (s.kind === 'drill' && drill && r && r.startsWith('fail:')) {
        drill.R.respawn = true;
        r = 'report';
      }
      // 🐢 천천히 (따라 하기는 코너 근처만, 다른 미션은 내내)
      if (s.slowable && s.kind !== 'drill') {
        const want = slowOn(s) ? 0.6 : 1;
        setTS(ts + (want - ts) * Math.min(1, dt * 5));
      }
      renderGoals();
      seen.length = 0;
      if (r === 'done') success();
      else if (r === 'report') showReport();
      else if (r && r.startsWith('fail:')) fail(r.slice(5));
    } else if (phase === 'success' || phase === 'fail') {
      if (phase === 'fail') seen.length = 0;
      waitT -= dt;
      if (waitT <= 0) {
        if (phase === 'success') next();
        else startLive();
      }
    }
  }
  /** 따라 하기: 판정 + 순간마다 짧은 신호 글자 + 다음 키 깜빡임 + 코너 근처 슬로 모션 */
  function drillUpdate(dt, s) {
    const P = st.P;
    const m = P.dist(idxNow());
    const mo = P.momentAt(m);
    if (mo.id !== st._mo) {
      st._mo = mo.id;
      const [t, sub] = momentText(P, mo.id, true);
      coach.caption(t, sub, mo.id);
      coach.strip(mo.id);
      coach.cue({ straight: 'throttle', approach: null, brake: 'brake', turn: P.turnKey, apex: null, gas: 'throttle', out: 'throttle' }[mo.id]);
    }
    const slowZone = slowOn(s) && m > P.dB - 120 && m < P.dX + 20;
    const want = slowZone ? 0.5 : 1;
    setTS(ts + (want - ts) * Math.min(1, dt * 5));
    coach.slow(ts);
    const r = drill.step(dt, seen);
    if (r === 'end') return 'report';
    return null;
  }
  function loop(now) {
    if (ended) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    update(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ------------------------------------------------------------------ 입력
  function onKey(e) {
    if (ended || document.querySelector('.gm-confirm')) return;
    if (game.menu && game.menu.isOpen) return;
    const acts = actionsFor(e.code);
    if (phase === 'card' || phase === 'report') {
      if (e.code === 'Escape') return; // 메뉴는 그대로
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (document.activeElement && document.activeElement.matches('.ac-short-summary')) return document.activeElement.click();
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.tut-card button') && e.code !== 'Space') {
          document.activeElement.click();
          return;
        }
        const go = phase === 'report' ? $('.tut-card .tdr-btns .primary') : $('.tut-card [data-t="go"]');
        go && go.click();
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const bs = [...root.querySelectorAll('.tut-card button, .tut-card .ac-short-summary')].filter((b) => b.offsetParent !== null);
        const i = bs.indexOf(document.activeElement);
        const j = (i + (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || (e.code === 'Tab' && e.shiftKey) ? -1 : 1) + bs.length) % bs.length;
        bs[j] && bs[j].focus({ preventScroll: true });
        uiSound('move');
        return;
      }
      // 카드가 떠 있을 때는 운전 키를 게임에 안 보냄
      if (acts.length) e.stopImmediatePropagation();
      return;
    }
    // 시범 주행 중: "처음부터 다시" 키 = 시범 처음부터, 다른 운전 키는 게임에 안 보냄 (메뉴는 그대로)
    if (phase === 'demo') {
      if (acts.includes('restart')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        retry();
        return;
      }
      if (acts.length && !acts.includes('menu') && !acts.includes('sound')) e.stopImmediatePropagation();
      return;
    }
    // 달리는 중: "처음부터 다시" 키 = 이 미션 다시, "다음 맵" 키 = 막음 (튜토리얼이 끊기지 않게)
    if (acts.includes('restart')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      retry();
      return;
    }
    if (acts.includes('map')) {
      e.stopImmediatePropagation();
      setHint('튜토리얼 중에는 맵을 바꿀 수 없어요');
      return;
    }
    if (acts.includes('respawn') && st) st.keyed = true;
  }
  window.addEventListener('keydown', onKey, true);
  // 게임패드 버튼도 키와 똑같이: "처음부터 다시" = 이 미션 다시, "다음 맵" = 막음, 복귀 = 기록
  pad.setActionFilter((id) => {
    if (ended || phase === 'card' || phase === 'report') return true;
    if (id === 'restart') return retry(), false;
    if (id === 'map') return setHint('튜토리얼 중에는 맵을 바꿀 수 없어요'), false;
    if (phase === 'demo') return id === 'menu';
    if (id === 'respawn' && st) st.keyed = true;
    return true;
  });
  // 터치 ↺ 복귀 버튼도 기록
  var offTouch = touch.onAction((id) => {
    if (!ended && phase !== 'card' && id === 'respawn' && st) st.keyed = true;
  });

  root.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) {
      uiSound('select');
      return goTo(g.dataset.goto);
    }
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const t = b.dataset.t;
    b.blur();
    const s = STEPS[cur];
    if (t === 'go') {
      uiSound('select');
      if (s.onGo) return s.onGo();
      if (s.info) next();
      else startLive();
    } else if (t === 'prev') (uiSound('back'), prev());
    else if (t === 'skip') skip();
    else if (t === 'quit') quit();
    else if (t === 'retry' || t === 'again' || t === 'demoAgain') retry();
    else if (t === 'card') showCard();
    else if (t === 'demo') watchDemo();
    else if (t === 'demoSkip') (uiSound('back'), demoDone(true));
    else if (t === 'next') (uiSound('select'), next());
    else if (t === 'slow' || t === 'slowTog') {
      uiSound('move');
      slowPref[s.id] = !slowOn(s);
      if (t === 'slowTog') retry();
      else {
        if (drill) drill.R.slow = drill.R.slow || slowPref[s.id];
        renderPanel();
        if (s.kind === 'drill') coach.badge(`🏎️ 따라 하기 · ${cname(s.corner)}${slowOn(s) ? ' · 🐢 천천히' : ''}`);
      }
    }
  });

  // ------------------------------------------------------------------ 소리 (성공 딩동 / 실패 뚱)
  let ctx = null;
  function chime(ok) {
    try {
      const v = settings.get('muted') ? 0 : settings.get('masterVol') * settings.get('fxVol');
      if (v <= 0.001) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime;
      const notes = ok ? [784, 988, 1319] : [330, 262];
      notes.forEach((f, j) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = ok ? 'triangle' : 'sine';
        o.frequency.value = f;
        const t = t0 + j * (ok ? 0.09 : 0.12);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09 * v, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0005, t + (ok ? 0.35 : 0.25));
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.4);
      });
    } catch {}
  }

  // 키를 바꾸면 안내 글자도 바뀜
  keybinds.onChange(() => {
    if (phase === 'card') showCard();
    else if (phase === 'live') renderPanel();
    coach.labels();
  });

  game.tutorial = {
    el: root,
    steps: STEPS.map((x) => x.id),
    spots: SPOT,
    get step() {
      return STEPS[cur] && STEPS[cur].id;
    },
    get phase() {
      return phase;
    },
    get state() {
      return st;
    },
    /** 테스트용: 창이 숨겨져 rAF가 멈췄을 때 직접 판정을 돌림 */
    update,
    go(id) {
      const j = STEPS.findIndex((x) => x.id === id);
      if (j < 0) return false;
      cur = j;
      returnTo = null;
      STEPS[cur].card ? showCard() : startLive();
      return true;
    },
    start: () => startLive(),
    next,
    end,
    skip,
    retry,
    watchDemo,
    placeRolling,
    /** 테스트용: 따라 하기 판정 중간 값 · 시범 진행 */
    get drill() {
      return drill;
    },
    get demo() {
      return demo;
    },
    coach,
  };
  showCard();
  return game.tutorial;
}

// ------------------------------------------------------------------ 드리프트 각도 막대 (미션 판)
const GAUGE_MAX = 1.35; // 막대 끝 = 77°
/** 지금 드리프트 각도: 초록 칸(버티기) · 빨강(스핀) · 노란 선(이 아래에서 놓으면 깔끔) */
function driftGauge(car, win, spin, exit) {
  const pc = (r) => `${Math.max(0, Math.min(100, (r / GAUGE_MAX) * 100)).toFixed(1)}%`;
  const a = car.drifting ? Math.abs(car.driftAngle || 0) : 0;
  const inWin = a >= win[0] && a <= win[1];
  const state = !car.drifting ? '드리프트 키를 누르면 바늘이 움직여요' : a > spin * 0.9 ? '⚠ 너무 돌아요! 카운터' : inWin ? (a < exit ? '좋아요! 지금 놓으면 깔끔' : '좋아요! 버티다가 펴면서 놓기') : a < win[0] ? '더 꺾어요' : '카운터로 줄여요';
  return `<div class="tut-gauge${car.drifting ? ' on' : ''}${inWin ? ' good' : ''}${a > spin * 0.9 ? ' bad' : ''}">
    <div class="gt"><span>드리프트 각도</span><b>${Math.round((a * 180) / Math.PI)}°</b></div>
    <div class="gb"><i class="win" style="left:${pc(win[0])};width:calc(${pc(win[1])} - ${pc(win[0])})"></i><i class="spin" style="left:${pc(spin)}"></i><i class="exit" style="left:${pc(exit)}"></i><i class="needle" style="left:${pc(a)}"></i></div>
    <div class="gs">${state}</div><div class="gh">유지 ${(car.driftHold || 0).toFixed(1)}초</div></div>`;
}
/** 설명 카드 그림: 차 위에서 본 각도 + 막대 */
function driftSvg(win, spin, exit) {
  const x = (r) => 20 + (r / GAUGE_MAX) * 260;
  return `<svg class="tut-svg" viewBox="0 0 300 120" aria-hidden="true">
    <g transform="translate(70 52)">
      <path d="M-46 0 H46" stroke="#ffffff40" stroke-width="2" stroke-dasharray="5 5"/><text x="10" y="16" style="fill:#ffffff99;font-size:10px">진행 방향 →</text>
      <g transform="rotate(-28)"><rect x="-20" y="-9" width="40" height="18" rx="6" fill="#ff4b3a"/><rect x="8" y="-6" width="9" height="12" rx="2" fill="#ffe2b0"/></g>
      <path d="M30 0 A30 30 0 0 0 26.5 -14" fill="none" stroke="#ffcf3f" stroke-width="2.5"/><text x="34" y="-10" style="fill:#ffcf3f;font-size:12px" font-weight="800">각도</text>
      <path d="M-30 18 q-14 4 -26 2" stroke="#ffffff55" stroke-width="3" fill="none"/><path d="M-26 -16 q-14 -6 -28 -4" stroke="#ffffff55" stroke-width="3" fill="none"/>
    </g>
    <rect x="20" y="92" width="260" height="10" rx="5" fill="#ffffff1f"/>
    <rect x="${x(win[0])}" y="92" width="${x(win[1]) - x(win[0])}" height="10" rx="3" fill="#3ddc6a"/>
    <rect x="${x(spin)}" y="92" width="${280 - x(spin)}" height="10" rx="3" fill="#ff4b5c"/>
    <path d="M${x(exit)} 86 V106" stroke="#ffcf3f" stroke-width="2"/>
    <text x="${(x(win[0]) + x(win[1])) / 2}" y="117" style="fill:#3ddc6a;font-size:10px" text-anchor="middle" font-weight="800">버티기</text>
    <text x="${x(exit)}" y="83" style="fill:#ffcf3f;font-size:10px" text-anchor="middle" font-weight="800">이 아래로 펴고 놓기</text>
    <text x="${(x(spin) + 280) / 2}" y="117" style="fill:#ff4b5c;font-size:10px" text-anchor="middle" font-weight="800">스핀</text>
  </svg>`;
}
