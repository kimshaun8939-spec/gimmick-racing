// 홈 화면: 주소에 ?map= 이 없으면 게임 대신 이 화면이 뜸
//   메인 메뉴(레이스 시작 / 차 고르기 / 맵 고르기 / 기록 / 설정 / 조작법)
//   차 고르기: 빙글빙글 도는 3D 차 미리보기(작은 Three.js 장면) + 성능 막대 + 변신 미리보기
//   맵 고르기: 코스 모양 그림 카드 (길이·바퀴 수·특징·내 최고 기록)
//   시작하면 ?map=<맵>&car=<차> 주소로 이동 (페이지를 새로 불러 게임 시작). 고른 것은 브라우저에 기억
//   키보드(화살표·Enter·Esc)와 마우스 모두 됨
import * as THREE from 'three';
import { settings, createSettingsPanel, createControlsPage, spatialMove, uiSound, confirmDialog, dialogOpen } from './settings.js';
import { loadMaps, loadRoster, getLast, setLast, raceUrl, sampleOutline, outlineLength, drawTrackThumb } from './gameData.js';
import { records, fmtTime } from './records.js';
import { createCarModel } from './carModel.js';

export const VERSION = 'v0.9 · 2026.11';
const STAT_NAMES = [['speed', '속도'], ['accel', '가속'], ['handling', '핸들링'], ['grip', '접지력'], ['boost', '부스터']];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** look(문자열 색 또는 { body, accent, ... }) → 카드 색 견본 */
function lookColors(look) {
  if (!look) return ['#e8463a', '#ffffff'];
  if (typeof look === 'string') return [look, '#ffffff'];
  return [look.body || look.color || look.paint || '#e8463a', look.accent || look.stripe || look.trim || look.secondary || '#ffffff'];
}

export async function runHome() {
  const [maps, roster] = await Promise.all([loadMaps(), loadRoster()]);
  let cars = [];
  try {
    cars = await roster.listCars();
  } catch (e) {
    console.warn('차 목록 불러오기 실패', e);
  }
  if (!cars.length) cars = [{ id: 'f1', name: '레드 포뮬러', tag: 'FORMULA', desc: '', stats: {}, look: '#e8463a' }];
  const last = getLast();
  const params = new URLSearchParams(location.search);
  const DEFAULT_CAR = roster.DEFAULT_CAR_ID || cars[0].id;
  let carId = cars.find((c) => c.id === (params.get('car') || last.car)) ? params.get('car') || last.car : DEFAULT_CAR;
  if (!cars.find((c) => c.id === carId)) carId = cars[0].id;
  let mapId = maps.find((m) => m.id === last.map) ? last.map : maps[0].id;
  const carOf = (id) => cars.find((c) => c.id === id) || cars[0];
  const mapOf = (id) => maps.find((m) => m.id === id) || maps[0];

  // 맵 데이터(코스 모양·길이·바퀴 수)를 같이 불러옴
  const mapInfo = {};
  await Promise.all(
    maps.map(async (m) => {
      try {
        const d = await (await fetch(m.file)).json();
        const pts = sampleOutline(d, 10);
        mapInfo[m.id] = { pts, km: outlineLength(pts) / 1000, laps: d.laps || 1, free: !!d.pad || m.free };
      } catch {
        mapInfo[m.id] = { pts: [], km: 0, laps: 1, free: m.free };
      }
    }),
  );

  // ------------------------------------------------------------------ 화면 틀
  const home = document.createElement('div');
  home.id = 'home';
  home.innerHTML = `
    <div class="h-glow"></div><div class="h-floor"></div><div class="h-streaks"></div>
    <div class="h-top">
      <div class="h-logo"><div class="mark"><span>🏁</span></div><div><div class="name">기믹 <em>레이싱</em></div><div class="sub">GIMMICK RACING</div></div></div>
      <div class="h-icons">
        <button class="gm-btn small" data-go="records" data-nav>🏆 기록</button>
        <button class="gm-btn small" data-go="controls" data-nav>🎮 조작법</button>
        <button class="gm-btn small" data-go="settings" data-nav>⚙️ 설정</button>
      </div>
    </div>
    <div class="h-view" data-view="main"></div>
    <div class="h-view" data-view="car"></div>
    <div class="h-view" data-view="map"></div>
    <div class="h-view" data-view="settings"></div>
    <div class="h-view" data-view="controls"></div>
    <div class="h-view" data-view="records"></div>
    <div class="h-foot"><span>${VERSION} · 기믹 레이싱 · Three.js</span><span class="gm-hint"><span><kbd>↑↓←→</kbd> 고르기</span><span><kbd>Enter</kbd> 확인</span><span><kbd>Esc</kbd> 뒤로</span></span></div>
    <div class="h-launch"><div class="ld" id="hLaunch"></div></div>`;
  document.body.appendChild(home);
  const $ = (sel) => home.querySelector(sel);
  const views = Object.fromEntries([...home.querySelectorAll('.h-view')].map((v) => [v.dataset.view, v]));

  // 속도 줄무늬 몇 개 (CSS 애니메이션)
  const streaks = $('.h-streaks');
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('i');
    s.style.top = `${12 + Math.random() * 76}%`;
    s.style.width = `${120 + Math.random() * 220}px`;
    s.style.animationDuration = `${2.2 + Math.random() * 2.8}s`;
    s.style.animationDelay = `${-Math.random() * 5}s`;
    streaks.appendChild(s);
  }

  // ------------------------------------------------------------------ 3D 차 미리보기
  const preview = createPreview(home);

  // ------------------------------------------------------------------ 메인 메뉴
  views.main.innerHTML = `
    <div class="h-main">
      <h1 class="h-hero">달리고,<br>변신하고,<br>날아올라!<small>기믹 가득한 3D 레이싱 · 땅·물·하늘·우주까지</small></h1>
      <button class="gm-btn primary h-start" data-act="start" data-nav><span class="big">레이스 시작</span><span class="sel"></span><span class="go">▶</span></button>
      <div class="h-menu">
        <button class="gm-btn h-item" data-go="car" data-nav><span class="ic">🏎️</span><span class="t"><b>차 고르기</b><small data-f="car"></small></span><span class="arrow">›</span></button>
        <button class="gm-btn h-item" data-go="map" data-nav><span class="ic">🗺️</span><span class="t"><b>맵 고르기</b><small data-f="map"></small></span><span class="arrow">›</span></button>
        <button class="gm-btn h-item" data-go="records" data-nav><span class="ic">🏆</span><span class="t"><b>내 기록</b><small>맵마다 가장 빠른 랩</small></span><span class="arrow">›</span></button>
        <button class="gm-btn h-item" data-go="settings" data-nav><span class="ic">⚙️</span><span class="t"><b>설정</b><small>소리 · 그래픽 · 주행 도움</small></span><span class="arrow">›</span></button>
        <button class="gm-btn h-item" data-go="controls" data-nav><span class="ic">🎮</span><span class="t"><b>조작법</b><small>키보드 안내</small></span><span class="arrow">›</span></button>
      </div>
    </div>
    <div class="h-cartag"><div class="tg"></div><div class="n"></div></div>`;

  // ------------------------------------------------------------------ 차 고르기
  views.car.innerHTML = `
    <div class="h-car">
      <div class="h-panel h-carlist"><div class="h-title">차고 · ${cars.length}대</div><div class="list"></div></div>
      <div class="h-carstage">
        <button class="gm-btn h-arrow" data-act="prevCar" aria-label="이전 차">‹</button>
        <div class="gm-seg" id="hForms" title="자동 변신 모습 미리 보기">
          <button data-mode="normal" class="on">🚗 일반</button><button data-mode="accel">🔥 가속</button><button data-mode="boat">🚤 배</button><button data-mode="fly">✈️ 비행</button>
        </div>
        <button class="gm-btn h-arrow" data-act="nextCar" aria-label="다음 차">›</button>
      </div>
      <div class="h-panel h-carinfo">
        <div class="tg"></div><h2></h2><p class="desc"></p>
        <div class="h-stats"></div>
        <div class="btns"><button class="gm-btn" data-go="main" data-nav>뒤로</button><button class="gm-btn primary" data-act="pickCar" data-nav>이 차로 맵 고르기 ›</button></div>
      </div>
    </div>`;
  const carList = views.car.querySelector('.list');
  for (const c of cars) {
    const [a, b] = lookColors(c.look);
    const btn = document.createElement('button');
    btn.className = 'gm-btn h-carcard';
    btn.dataset.nav = '';
    btn.dataset.car = c.id;
    btn.innerHTML = `<span class="sw" style="background:linear-gradient(135deg, ${esc(a)} 55%, ${esc(b)} 56%)"></span><span><b>${esc(c.name)}</b><small>${esc(c.tag || '')}</small></span><span class="chk">✓</span>`;
    btn.addEventListener('click', () => selectCar(c.id, true));
    btn.addEventListener('focus', () => selectCar(c.id));
    carList.appendChild(btn);
  }
  views.car.querySelectorAll('#hForms button').forEach((b) =>
    b.addEventListener('click', () => {
      views.car.querySelectorAll('#hForms button').forEach((x) => x.classList.toggle('on', x === b));
      preview.setMode(b.dataset.mode);
      uiSound('toggle');
    }),
  );

  function selectCar(id, sound = false) {
    if (id === carId && preview.carId === id) return;
    carId = id;
    const c = carOf(id);
    if (sound) uiSound('move');
    views.car.querySelectorAll('.h-carcard').forEach((b) => b.classList.toggle('sel', b.dataset.car === id));
    const info = views.car.querySelector('.h-carinfo');
    info.querySelector('.tg').textContent = c.tag || '';
    info.querySelector('h2').textContent = c.name;
    info.querySelector('.desc').textContent = c.desc || '';
    info.querySelector('.h-stats').innerHTML = STAT_NAMES.map(([k, label]) => {
      const v = Math.max(0, Math.min(5, Math.round((c.stats && c.stats[k]) || 0)));
      return `<div class="h-stat"><span>${label}</span><span class="bar">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < v ? 'on' : ''}" style="animation-delay:${i * 0.05}s"></i>`).join('')}</span><span class="v">${v}</span></div>`;
    }).join('');
    views.car.querySelectorAll('#hForms button').forEach((x) => x.classList.toggle('on', x.dataset.mode === 'normal'));
    preview.setCar(c);
    refreshSummary();
    setLast({ car: id });
  }
  function stepCar(dir) {
    const i = cars.findIndex((c) => c.id === carId);
    const next = cars[(i + dir + cars.length) % cars.length];
    selectCar(next.id, true);
    const card = views.car.querySelector(`.h-carcard[data-car="${next.id}"]`);
    if (card && document.activeElement && document.activeElement.classList.contains('h-carcard')) card.focus({ preventScroll: false });
  }

  // ------------------------------------------------------------------ 맵 고르기
  views.map.innerHTML = `
    <div class="h-maps">
      <div class="head"><div><h2>맵 고르기</h2><div class="who"></div></div>
        <div class="bar"><button class="gm-btn" data-go="car" data-nav>‹ 차 바꾸기</button><button class="gm-btn primary" data-act="start" data-nav>출발! <kbd>Enter</kbd></button></div></div>
      <div class="h-mapgrid"></div>
    </div>`;
  const grid = views.map.querySelector('.h-mapgrid');
  for (const m of maps) {
    const info = mapInfo[m.id];
    const card = document.createElement('button');
    card.className = 'gm-btn h-map';
    card.dataset.nav = '';
    card.dataset.map = m.id;
    const stars = '★'.repeat(m.difficulty || 1) + '☆'.repeat(3 - (m.difficulty || 1));
    const len = info.free ? '자유 주행' : `📏 약 ${info.km >= 10 ? info.km.toFixed(0) : info.km.toFixed(1)} km · 🔁 ${info.laps}바퀴`;
    card.innerHTML = `<canvas width="480" height="270"></canvas>
      <div class="body">
        <div class="t"><b>${esc(m.title)}</b><span class="stars" title="난이도">${stars}</span></div>
        <div class="sub">${esc(m.subtitle || '')}</div>
        <div class="desc">${esc(m.desc || '')}</div>
        <div class="tags">${(m.tags || []).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        <div class="meta"><span>${len}</span><span class="rec"></span></div>
      </div>`;
    drawTrackThumb(card.querySelector('canvas'), info.pts, m.theme);
    card.addEventListener('click', () => {
      if (mapId === m.id && card.classList.contains('sel')) start();
      else selectMap(m.id, true);
    });
    card.addEventListener('focus', () => selectMap(m.id));
    card.addEventListener('dblclick', () => start());
    grid.appendChild(card);
  }
  function selectMap(id, sound = false) {
    mapId = id;
    if (sound) uiSound('move');
    grid.querySelectorAll('.h-map').forEach((b) => b.classList.toggle('sel', b.dataset.map === id));
    refreshSummary();
    setLast({ map: id });
  }
  function refreshRecords() {
    grid.querySelectorAll('.h-map').forEach((card) => {
      const id = card.dataset.map;
      const mine = records.get(id, carId);
      const best = records.bestOfMap(id);
      const el = card.querySelector('.rec');
      if (mapInfo[id].free) el.textContent = '';
      else if (mine && mine.lap) el.textContent = `🏆 ${fmtTime(mine.lap)}`;
      else if (best) el.textContent = `🏆 ${fmtTime(best.lap)} (${carOf(best.car).name})`;
      else el.textContent = '기록 없음';
      el.title = '내 최고 랩 (지금 고른 차)';
    });
  }

  // ------------------------------------------------------------------ 설정 · 조작법 · 기록
  const page = (title, inner) => `<div class="h-page"><div class="head"><h2>${title}</h2><button class="gm-btn" data-go="main" data-nav>‹ 뒤로 <kbd>Esc</kbd></button></div><div class="h-panel scroll"></div></div>`;
  views.settings.innerHTML = page('설정');
  const setPanel = createSettingsPanel();
  views.settings.querySelector('.scroll').appendChild(setPanel.el);
  views.controls.innerHTML = page('조작법');
  views.controls.querySelector('.scroll').appendChild(createControlsPage());
  views.records.innerHTML = page('내 기록');
  function renderRecords() {
    const all = records.all();
    const rows = maps
      .filter((m) => !mapInfo[m.id].free)
      .map((m) => {
        const r = all[m.id] || {};
        const entries = Object.entries(r);
        const lap = entries.filter(([, v]) => v.lap).sort((a, b) => a[1].lap - b[1].lap)[0];
        const race = entries.filter(([, v]) => v.race).sort((a, b) => a[1].race - b[1].race)[0];
        const perCar = cars
          .filter((c) => r[c.id] && r[c.id].lap)
          .map((c) => `${esc(c.name)} ${fmtTime(r[c.id].lap)}`)
          .join(' · ');
        return `<tr><td class="m"><b>${esc(m.title)}</b><small>${mapInfo[m.id].laps}바퀴</small></td>
          <td>${lap ? `<span class="gold">${fmtTime(lap[1].lap)}</span><br><small class="none">${esc(carOf(lap[0]).name)}</small>` : '<span class="none">—</span>'}</td>
          <td>${race ? `${fmtTime(race[1].race)}<br><small class="none">${esc(carOf(race[0]).name)}</small>` : '<span class="none">—</span>'}</td>
          <td><small class="none">${perCar || '아직 달리지 않았어요'}</small></td></tr>`;
      })
      .join('');
    const box = views.records.querySelector('.scroll');
    box.innerHTML = `<table class="h-rec"><thead><tr><th>맵</th><th>최고 랩</th><th>최고 완주</th><th>차마다 최고 랩</th></tr></thead><tbody>${rows}</tbody></table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;color:var(--gm-dim);font-size:12px">
        <span>기록은 이 브라우저에만 저장돼요</span><button class="gm-btn small danger" data-act="clearRec" data-nav>기록 지우기</button></div>`;
  }

  // ------------------------------------------------------------------ 화면 바꾸기
  let view = 'main';
  function show(name, focus = true) {
    if (!views[name]) name = 'main';
    if (view !== name) uiSound(name === 'main' ? 'back' : 'select');
    view = name;
    for (const [k, v] of Object.entries(views)) v.classList.toggle('on', k === name);
    home.classList.toggle('dim', !['main', 'car'].includes(name));
    home.classList.toggle('calm', name !== 'main');
    preview.setView(name);
    if (name === 'records') renderRecords();
    if (name === 'map') refreshRecords();
    refreshSummary();
    if (focus) {
      const target =
        name === 'car' ? views.car.querySelector('.h-carcard.sel')
        : name === 'map' ? grid.querySelector('.h-map.sel')
        : name === 'main' ? views.main.querySelector('.h-start')
        : views[name].querySelector('.gm-set-row, [data-nav]');
      if (target) target.focus({ preventScroll: true });
    }
  }
  function refreshSummary() {
    const c = carOf(carId), m = mapOf(mapId);
    views.main.querySelector('.h-start .sel').textContent = `${m.title} · ${c.name}`;
    views.main.querySelector('[data-f="car"]').textContent = `지금: ${c.name}`;
    views.main.querySelector('[data-f="map"]').textContent = `지금: ${m.title}`;
    views.main.querySelector('.h-cartag .tg').textContent = c.tag || '';
    views.main.querySelector('.h-cartag .n').textContent = c.name;
    views.map.querySelector('.who').textContent = `🏎️ ${c.name} 으로 달려요`;
  }

  let launching = false;
  function start() {
    if (launching) return;
    launching = true;
    uiSound('select');
    setLast({ map: mapId, car: carId });
    const m = mapOf(mapId), c = carOf(carId);
    $('#hLaunch').innerHTML = `<div class="logo">기믹 레이싱</div><div class="map">${esc(m.title)}</div><div class="car">${esc(c.name)}</div>`;
    $('.h-launch').classList.add('on');
    setTimeout(() => (location.href = raceUrl(mapId, carId)), 380);
  }

  // 버튼 클릭 (data-go = 화면 이동, data-act = 동작)
  home.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-go], [data-act]');
    if (!b) return;
    if (b.dataset.go) return show(b.dataset.go);
    const act = b.dataset.act;
    if (act === 'start') start();
    else if (act === 'prevCar') stepCar(-1);
    else if (act === 'nextCar') stepCar(1);
    else if (act === 'pickCar') show('map');
    else if (act === 'clearRec') {
      if (await confirmDialog('기록을 지울까요?', '모든 맵의 최고 기록이 사라지고 되돌릴 수 없어요.', '지우기')) {
        records.clear();
        renderRecords();
      }
    }
  });
  // 마우스를 올리면 그 버튼에 초점 (키보드와 마우스를 섞어 써도 자연스럽게)
  home.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.h-item, .h-start, .pm-list .gm-btn');
    if (b && document.activeElement !== b) b.focus({ preventScroll: true });
  });

  // ------------------------------------------------------------------ 키보드
  window.addEventListener('keydown', (e) => {
    if (dialogOpen() || launching) return;
    const k = e.code;
    const act = document.activeElement;
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[k];
    if (k === 'Escape' || k === 'Backspace') {
      e.preventDefault();
      if (view !== 'main') show(view === 'map' ? 'main' : 'main');
      return;
    }
    if (dir) {
      e.preventDefault();
      // 설정 줄: ←→ = 값 바꾸기
      if ((dir === 'left' || dir === 'right') && act && act.dataset && act.dataset.adjust) {
        setPanel.adjust(act.dataset.adjust, dir === 'left' ? -1 : 1);
        return;
      }
      // 차 고르기: ←→ = 다른 차
      if (view === 'car' && (dir === 'left' || dir === 'right') && !(act && act.closest('.h-carinfo .btns'))) {
        stepCar(dir === 'left' ? -1 : 1);
        return;
      }
      const container = views[view];
      if (spatialMove(container, dir) || spatialMove(home.querySelector('.h-top'), dir)) uiSound('move');
      return;
    }
    if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') {
      if (view === 'map' && act && act.classList.contains('h-map')) {
        e.preventDefault();
        selectMap(act.dataset.map);
        start();
        return;
      }
      if (view === 'car' && act && act.classList.contains('h-carcard')) {
        e.preventDefault();
        show('map');
        return;
      }
      if (act && act.dataset && act.dataset.adjust) {
        e.preventDefault();
        setPanel.adjust(act.dataset.adjust, 1);
        return;
      }
      if (!act || act === document.body) {
        e.preventDefault();
        if (view === 'main') start();
      }
    }
  });

  // 처음 화면
  selectCar(carId);
  selectMap(mapId);
  const startView = params.get('menu');
  show(['car', 'map', 'settings', 'controls', 'records'].includes(startView) ? startView : 'main');
  view === 'main' && views.main.querySelector('.h-start').focus({ preventScroll: true });
  const ld = document.getElementById('loading');
  if (ld) {
    ld.classList.add('out');
    setTimeout(() => ld.remove(), 450);
  }
  window.home = { show, selectCar, selectMap, start, preview, get view() { return view; }, get carId() { return carId; }, get mapId() { return mapId; } };
}

/** 3D 차 미리보기 (턴테이블 위에서 빙글빙글, 마우스로 끌어서 돌리기) */
function createPreview(home) {
  const canvas = document.createElement('canvas');
  canvas.className = 'h-car';
  home.insertBefore(canvas, home.querySelector('.h-top'));
  const q = settings.get('quality');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: q !== 'low', alpha: true, preserveDrawingBuffer: false });
  } catch (e) {
    console.warn('3D 미리보기를 만들 수 없어요', e);
    return { setCar() {}, setMode() {}, setView() {}, carId: null };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'low' ? 1 : q === 'medium' ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = q !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);
  // 반짝이는 차 페인트용 주변 반사 (방 조명) — 불러오기 실패해도 그냥 진행
  import('three/addons/environments/RoomEnvironment.js')
    .then(({ RoomEnvironment }) => {
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
      scene.environmentIntensity = 0.55;
      pm.dispose();
      dirty = true;
    })
    .catch(() => {});

  scene.add(new THREE.HemisphereLight('#d6e6ff', '#1b1630', 0.9));
  const key = new THREE.DirectionalLight('#fff3e2', 2.6);
  key.position.set(5, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key);
  const rimBlue = new THREE.DirectionalLight('#6fa8ff', 2.2);
  rimBlue.position.set(-7, 3, -5);
  const rimWarm = new THREE.DirectionalLight('#ff9a4a', 1.6);
  rimWarm.position.set(7, 2.5, -6);
  scene.add(rimBlue, rimWarm);

  // 턴테이블: 어두운 금속 원판 + 노란 빛 고리 + 바닥 빛 번짐
  const table = new THREE.Group();
  scene.add(table);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(3.7, 3.85, 0.16, 72),
    new THREE.MeshStandardMaterial({ color: '#1a2036', roughness: 0.35, metalness: 0.7 }),
  );
  disc.position.y = -0.08;
  disc.receiveShadow = true;
  table.add(disc);
  const discTop = new THREE.Mesh(new THREE.CircleGeometry(3.62, 72), new THREE.MeshStandardMaterial({ color: '#232a44', roughness: 0.55, metalness: 0.5 }));
  discTop.rotation.x = -Math.PI / 2;
  discTop.position.y = 0.002;
  discTop.receiveShadow = true;
  table.add(discTop);
  // 원판 위 가는 선 (돌아가는 게 보이게)
  const lines = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 2.63, 72, 1),
    new THREE.MeshBasicMaterial({ color: '#8fa6ff', transparent: true, opacity: 0.25 }),
  );
  lines.rotation.x = -Math.PI / 2;
  lines.position.y = 0.004;
  table.add(lines);
  for (let i = 0; i < 12; i++) {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.5), new THREE.MeshBasicMaterial({ color: '#8fa6ff', transparent: true, opacity: 0.3 }));
    const a = (i / 12) * Math.PI * 2;
    tick.rotation.set(-Math.PI / 2, 0, -a);
    tick.position.set(Math.sin(a) * 3.25, 0.005, Math.cos(a) * 3.25);
    table.add(tick);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffcf3f', transparent: true, opacity: 0.85, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.78, 0.025, 8, 120), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.0;
  scene.add(ring);
  const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(3.6, 48), new THREE.ShadowMaterial({ opacity: 0.55 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.006;
  shadowCatcher.receiveShadow = true;
  table.add(shadowCatcher);
  // 바닥 빛 번짐 (가운데 밝은 원)
  const gc = document.createElement('canvas');
  gc.width = gc.height = 128;
  const gg = gc.getContext('2d');
  const grad = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,190,110,0.55)');
  grad.addColorStop(0.5, 'rgba(120,150,255,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  gg.fillStyle = grad;
  gg.fillRect(0, 0, 128, 128);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 16),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.17;
  scene.add(glow);

  // 차 모델 (createCarModel이 쓰는 차 상태를 흉내 낸 가짜 차)
  const fake = {
    pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, 1), vel: new THREE.Vector3(),
    mode: 'normal', sink: 0, forwardSpeed: 0, thr: 0, grounded: true, surface: 'road', drifting: false, driftDir: 0, driftLevel: 0,
    steerVisual: 0, load: 0, form: null, flying: false, boostTime: 0, brk: 0,
  };
  let model = null, holder = null, drop = 0;
  let dirty = true;
  const api = { carId: null };

  function disposeModel(m, h) {
    if (!m) return;
    if (h) table.remove(h);
    if (typeof m.dispose === 'function') {
      try {
        m.dispose();
        return;
      } catch {}
    }
    // dispose()가 없으면 직접 정리 (같은 재질을 여러 번 정리해도 괜찮음)
    m.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mt of mats) {
        for (const v of Object.values(mt)) if (v && v.isTexture) v.dispose();
        mt.dispose();
      }
    });
  }

  api.setCar = (c) => {
    api.carId = c.id;
    disposeModel(model, holder);
    let look = c.look;
    if (look && typeof look === 'object' && !Object.keys(look).length) look = undefined;
    try {
      model = createCarModel(look === undefined ? '#e8463a' : look);
    } catch (e) {
      console.warn('차 모델 만들기 실패, 기본 색으로', e);
      model = createCarModel('#e8463a');
    }
    fake.mode = 'normal';
    fake.flying = false;
    model.sync(fake, 1, 0);
    holder = new THREE.Group();
    holder.add(model.root);
    // 바퀴 아래가 원판 위에 오도록
    model.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.root);
    holder.userData.baseY = -box.min.y + 0.004;
    holder.position.y = holder.userData.baseY + 0.7;
    model.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    table.add(holder);
    drop = 0;
    ringMat.opacity = 1;
    dirty = true;
  };
  api.setMode = (mode) => {
    fake.mode = mode;
    fake.flying = false;
    fake.surface = 'road'; // 땅 위 모습 (배는 선체가 원판 위에 올라앉음)
    dirty = true;
  };

  // 화면마다 차가 놓이는 자리 (화면 가로 비율, 세로 비율)
  //   [가로 위치, 세로 위치, 원판이 화면에서 차지할 너비(px)]
  let spot = null, viewName = 'main';
  api.setView = (name) => {
    viewName = name;
    dirty = true;
  };
  function targetSpot() {
    const w = innerWidth, h = innerHeight;
    if (viewName === 'car') {
      // 차 고르기: 가운데 칸(목록과 정보 사이) 가운데에
      const st = home.querySelector('.h-carstage');
      const r = st && st.getBoundingClientRect();
      if (r && r.width > 40) return [(r.left + r.width / 2) / w, (r.top + r.height * 0.45) / h, Math.min(r.width * 0.95, r.height * 1.5)];
    }
    // 메인 메뉴: 왼쪽 메뉴 칸 오른쪽 빈 곳 가운데
    const menuEl = home.querySelector('.h-main');
    const left = menuEl && menuEl.offsetWidth ? menuEl.getBoundingClientRect().right + 20 : w * 0.38;
    const avail = Math.max(200, w - left - 20);
    if (w < 720) return [0.5, 0.25, Math.min(w * 0.85, h * 0.4)]; // 휴대폰: 메뉴 위 빈 곳
    return [(left + avail / 2) / w, 0.56, Math.min(avail * 0.95, h * 0.95, w * 0.5)];
  }

  // 마우스로 끌어 돌리기 (손을 떼면 관성 → 2초 뒤 다시 천천히 자동 회전)
  let angle = -0.6, spin = 0, dragging = false, lastX = 0, idle = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    angle += dx * 0.009;
    spin = dx * 0.009 * 60;
    idle = 0;
  });
  const endDrag = () => (dragging = false);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  let W = 0, H = 0;
  function resize() {
    const w = innerWidth, h = innerHeight;
    if (w === W && h === H) return;
    W = w;
    H = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  let last = performance.now(), time = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!home.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // 흐리게 깔리는 화면(맵·설정 등)에서는 그리지 않음 (노트북 발열 줄이기)
    const dim = home.classList.contains('dim');
    if (dim && !dirty) return;
    resize();
    time += dt;
    idle += dt;
    if (!dragging) {
      spin *= Math.exp(-3 * dt);
      const auto = idle > 2 ? 0.32 : 0;
      angle += (spin + auto) * dt;
    }
    table.rotation.y = angle;
    // 새 차가 살짝 위에서 내려앉음
    if (holder) {
      drop = Math.min(1, drop + dt / 0.45);
      const e = 1 - Math.pow(1 - drop, 3);
      holder.position.y = holder.userData.baseY + 0.7 * (1 - e) + Math.sin(drop * Math.PI) * 0.03;
    }
    ringMat.opacity = THREE.MathUtils.lerp(ringMat.opacity, 0.55 + 0.15 * Math.sin(time * 2), 1 - Math.exp(-3 * dt));
    if (model) model.sync(fake, dt, time);
    if (holder) holder.position.y += 0; // sync가 root 위치를 0으로 둠 (holder가 높이 담당)

    // 화면 속 차 위치: 카메라 투영을 옆으로 밀어서(setViewOffset) 원하는 자리에
    const spotT = targetSpot();
    if (!spot) spot = [...spotT];
    for (let i = 0; i < 3; i++) spot[i] = THREE.MathUtils.lerp(spot[i], spotT[i], 1 - Math.exp(-6 * dt));
    // 차+원판 가운데 부분(약 6.4 m)이 spot[2] 픽셀 너비로 보이는 거리: 화면 높이 H 픽셀 = 2·거리·tan(시야/2)
    const dist = (6.4 * H) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(120, spot[2]));
    camera.position.set(0, dist * 0.27, dist);
    camera.lookAt(0, 0.45, 0);
    camera.setViewOffset(W, H, (0.5 - spot[0]) * W, (0.5 - spot[1]) * H, W, H);
    renderer.render(scene, camera);
    dirty = false;
  }
  requestAnimationFrame(loop);
  // 창 크기를 바꾸면 다시 그림
  addEventListener('resize', () => (dirty = true));
  api.renderer = renderer;
  api.scene = scene;
  api.camera = camera;
  return api;
}
