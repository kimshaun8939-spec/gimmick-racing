// 홈 화면: 주소에 ?map= 이 없으면 게임 대신 이 화면이 뜸
//   메인 메뉴(레이스 시작 / 차 고르기 / 맵 고르기 / 기록 / 설정 / 조작법)
//   차 고르기: 빙글빙글 도는 3D 차 미리보기(작은 Three.js 장면) + 성능 막대 + 변신 미리보기
//   맵 고르기: 코스 모양 그림 카드 (길이·바퀴 수·특징·내 최고 기록)
//   레이스 방식 고르기: 봇 레이스(mode=race) / 타임 어택(mode=time, 고스트) / 멀티플레이(lobby.js) / 자유 연습(mode 없음)
//   차 등급(클래스) 탭: data/cars.json의 classes (없으면 탭 없이 전체 목록)
//   튜토리얼: ?map=gp&tutorial=1 (처음 온 사람에게 한 번 권함)
//   시작하면 ?map=<맵>&car=<차>&mode=.. 주소로 이동 (페이지를 새로 불러 게임 시작). 고른 것은 브라우저에 기억
//   ?join=코드 → 멀티플레이 방 참가 창을 바로 엶
//   키보드(화살표·Enter·Esc)와 마우스 모두 됨
import * as THREE from 'three';
import { settings, SETTING_DEFS, createSettingsPanel, createControlsPage, spatialMove, uiSound, confirmDialog, dialogOpen } from './settings.js';
import { loadMaps, loadRoster, loadCarClasses, getLast, setLast, raceUrl, tutorialUrl, RACE_MODES, sampleOutline, outlineLength, drawTrackThumb } from './gameData.js';
import { records, fmtTime } from './records.js';
import { masterTarget } from './bots.js'; // 고수 봇 목표 기록 (레이스 방식 화면 설명)
import { online } from './online.js';
import { createCarModel } from './carModel.js';
import { loadCarThumbs, thumbUrl } from './carThumbs.js'; // 차 고르기 카드의 진짜 차 사진
import { pad, padKbd } from './gamepad.js'; // 게임패드로 메뉴 이동 (스틱/D-패드 = 화살표, A = 확인, B = 뒤로)

export const VERSION = 'v0.9 · 2026.11';
/** 운전 도움을 켜고 낸 기록 표시 */
const ASSIST_TAG = '<span class="h-assist" title="운전 도움을 켜고 낸 기록">🛟 도움</span>';
const STAT_NAMES = [['speed', '속도'], ['accel', '가속'], ['handling', '핸들링'], ['grip', '접지력']]; // 부스터는 꺼 둠 (car.json booster.enabled)

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** 차 특기 (cars.json stats의 숨은 값) → 정보 칸 아래 작은 딱지 */
const PERKS = [['offroad', 3, '🌿 잔디에 강해요'], ['boat', 3, '🚤 배가 빨라요'], ['fly', 3, '✈️ 비행을 잘해요'], ['drift', 4, '🌀 드리프트 쉬워요']];
/** 'LE MANS PROTO · 접지력' → ['LE MANS PROTO', '접지력'] */
const splitTag = (tag) => {
  const [en, ...ko] = String(tag || '').split('·');
  return [en.trim(), ko.join('·').trim()];
};

const TUT_KEY = 'gimmick.tutorial'; // 튜토리얼: 'asked'(권해 봄) | 'done'(끝까지 함)

export async function runHome() {
  const [allMaps, roster, carClasses] = await Promise.all([loadMaps(), loadRoster(), loadCarClasses()]);
  let cars = [];
  try {
    cars = await roster.listCars();
  } catch (e) {
    console.warn('차 목록 불러오기 실패', e);
  }
  if (!cars.length) cars = [{ id: 'f1', name: '레드 포뮬러', tag: 'FORMULA', desc: '', stats: {}, look: '#e8463a' }];
  // 차 등급: listCars()가 class를 주면 그것, 아니면 cars.json에서 직접
  const classes = carClasses.classes;
  for (const c of cars) c.class = c.class || carClasses.classOf[c.id] || null;
  const classOfId = (id) => classes.find((k) => k.id === id) || null;
  const useClasses = classes.length > 0 && cars.some((c) => c.class);
  const last = getLast();
  const params = new URLSearchParams(location.search);
  const DEFAULT_CAR = roster.DEFAULT_CAR_ID || cars[0].id;
  let carId = cars.find((c) => c.id === (params.get('car') || last.car)) ? params.get('car') || last.car : DEFAULT_CAR;
  if (!cars.find((c) => c.id === carId)) carId = cars[0].id;
  const carOf = (id) => cars.find((c) => c.id === id) || cars[0];

  // 맵 데이터(코스 모양·길이·바퀴 수)를 같이 불러옴. maps.json에 없는 새 맵(extra)은 파일이 있을 때만 보여 줌
  const mapInfo = {};
  await Promise.all(
    allMaps.map(async (m) => {
      try {
        const res = await fetch(m.file);
        if (!res.ok) throw new Error(res.status);
        const d = await res.json();
        const pts = sampleOutline(d, 10);
        mapInfo[m.id] = { ok: true, pts, km: outlineLength(pts) / 1000, laps: d.laps || 1, free: !!d.pad || m.free, name: d.name };
      } catch {
        mapInfo[m.id] = { ok: false, pts: [], km: 0, laps: 1, free: m.free };
      }
    }),
  );
  const maps = allMaps.filter((m) => !m.extra || mapInfo[m.id].ok);
  if (!maps.length) maps.push(allMaps[0]);
  let mapId = maps.find((m) => m.id === last.map) ? last.map : maps[0].id;
  const mapOf = (id) => maps.find((m) => m.id === id) || maps[0];
  let raceMode = RACE_MODES.some((m) => m.id === last.mode) ? last.mode : 'race';

  // ------------------------------------------------------------------ 화면 틀
  const home = document.createElement('div');
  home.id = 'home';
  home.innerHTML = `
    <div class="h-glow"></div><div class="h-floor"></div><div class="h-streaks"></div>
    <div class="h-top">
      <div class="h-logo"><div class="mark"><span>🏁</span></div><div><div class="name">기믹 <em>레이싱</em></div><div class="sub">GIMMICK RACING</div></div></div>
      <div class="h-icons">
        <button class="gm-btn small h-name" data-act="name" data-nav title="레이스에서 보일 이름 바꾸기">👤 <span></span></button>
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
    <div class="h-view" data-view="mode"></div>
    <div class="h-foot"><span>${VERSION} · 기믹 레이싱 · Three.js</span><span class="gm-hint"><span><kbd>↑↓←→</kbd> 고르기</span><span><kbd>Enter</kbd> 확인</span><span><kbd>Esc</kbd> 뒤로</span><span class="padhint" hidden>🎮 <kbd class="pad pf pf0">A</kbd> 확인 <kbd class="pad pf pf1">B</kbd> 뒤로</span></span></div>
    <div class="h-launch"><div class="ld" id="hLaunch"></div></div>
    <div class="h-toast" id="hToast"></div>`;
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
  // 차 고르기 뒤쪽 큰 글자 (차 종류 영어 이름, 3D 차보다 뒤에 깔림)
  const carMarkBox = document.createElement('div');
  carMarkBox.className = 'h-carmark';
  carMarkBox.innerHTML = '<b></b>';
  home.insertBefore(carMarkBox, home.querySelector('canvas.h-car') || home.querySelector('.h-top'));
  const carMark = carMarkBox.querySelector('b');

  // ------------------------------------------------------------------ 메인 메뉴
  views.main.innerHTML = `
    <div class="h-main">
      <h1 class="h-hero">달리고,<br>변신하고,<br>날아올라!<small>기믹 가득한 3D 레이싱 · 땅·물·하늘·우주까지</small></h1>
      <button class="gm-btn primary h-start" data-act="start" data-nav><span class="big">레이스 시작</span><span class="sel"></span><span class="go">▶</span></button>
      <div class="h-menu">
        <div class="h-duo">
          <button class="gm-btn h-item" data-act="tutorial" data-nav><span class="ic">🎓</span><span class="t"><b>튜토리얼</b><small>빠르게 달리는 법</small></span></button>
          <button class="gm-btn h-item" data-act="multi" data-nav><span class="ic">🌐</span><span class="t"><b>멀티플레이</b><small>친구와 같이</small></span></button>
        </div>
        <button class="gm-btn h-item" data-go="car" data-nav><span class="ic">🏎️</span><span class="t"><b>차 고르기</b><small data-f="car"></small></span><span class="arrow">›</span></button>
        <button class="gm-btn h-item" data-go="map" data-nav><span class="ic">🗺️</span><span class="t"><b>맵 고르기</b><small data-f="map"></small></span><span class="arrow">›</span></button>
        <button class="gm-btn h-item" data-go="records" data-nav><span class="ic">🏆</span><span class="t"><b>내 기록</b><small>${online.enabled ? '🌐 온라인 순위표 · 맵마다 최고 기록' : '맵마다 최고 기록'}</small></span><span class="arrow">›</span></button>
        <button class="gm-btn h-item" data-go="settings" data-nav><span class="ic">⚙️</span><span class="t"><b>설정</b><small>소리 · 그래픽 · 운전 도움 · 조작키</small></span><span class="arrow">›</span></button>
        <button class="gm-btn h-item" data-go="controls" data-nav><span class="ic">🎮</span><span class="t"><b>조작법</b><small>키보드 · 게임패드 안내</small></span><span class="arrow">›</span></button>
      </div>
    </div>
    <div class="h-cartag"><div class="tg"></div><div class="n"></div></div>`;

  // ------------------------------------------------------------------ 차 고르기
  views.car.innerHTML = `
    <div class="h-car">
      <div class="h-panel h-carlist"><div class="h-title">차고 · ${cars.length}대${useClasses ? '<span class="h-qe"><kbd>Q</kbd><kbd>E</kbd> 등급</span>' : ''}</div><div class="h-classtabs"></div><div class="list"></div></div>
      <div class="h-carstage">
        <div class="h-drag">↔ 끌어서 돌려 보기</div>
        <button class="gm-btn h-arrow" data-act="prevCar" aria-label="이전 차">‹</button>
        <div class="gm-seg" id="hForms" title="자동 변신 모습 미리 보기">
          <button data-mode="normal" class="on">🚗 일반</button><button data-mode="accel">🔥 가속</button><button data-mode="boat">🚤 배</button><button data-mode="fly">✈️ 비행</button>
        </div>
        <button class="gm-btn h-arrow" data-act="nextCar" aria-label="다음 차">›</button>
      </div>
      <div class="h-panel h-carinfo">
        <div class="ihead"><div class="h-classchip"></div><span class="num"></span></div>
        <div class="tg"></div><h2></h2><p class="desc"></p>
        <div class="h-stats"></div>
        <div class="h-perks"></div>
        <div class="btns"><button class="gm-btn" data-go="main" data-nav>뒤로</button><button class="gm-btn primary" data-act="pickCar" data-nav>이 차로 맵 고르기 ›</button></div>
      </div>
    </div>`;
  const carList = views.car.querySelector('.list');
  const tabsEl = views.car.querySelector('.h-classtabs');
  if (cars.length > 8) views.car.querySelector('.h-carlist').classList.add('compact'); // 차가 많으면 카드를 작게
  // 등급 탭: 전체 + 등급마다 (차가 있는 등급만). 차가 등급 없이 있으면 '기타'
  let classFilter = 'all';
  const classTabs = useClasses
    ? [{ id: 'all', name: '전체', color: '#ffffff' }, ...classes.filter((k) => cars.some((c) => c.class === k.id)), ...(cars.some((c) => !classOfId(c.class)) ? [{ id: '_etc', name: '기타', color: '#95a2bb' }] : [])]
    : [];
  const inTab = (c, tab) => tab === 'all' || (tab === '_etc' ? !classOfId(c.class) : c.class === tab);
  if (classTabs.length) {
    tabsEl.innerHTML = classTabs
      .map((k) => `<button class="h-ctab" data-ctab="${esc(k.id)}" style="--cc:${esc(k.color || '#ffcf3f')}" title="${esc(k.desc || '')}"><i></i>${esc(k.name)}<small>${cars.filter((c) => inTab(c, k.id)).length}</small></button>`)
      .join('');
    tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.h-ctab');
      if (b) setClassTab(b.dataset.ctab, true);
    });
  } else tabsEl.remove();
  function renderCarList() {
    carList.innerHTML = '';
    const groups = classFilter === 'all' && useClasses ? classTabs.filter((k) => k.id !== 'all') : [null];
    for (const g of groups) {
      const list = cars.filter((c) => (g ? inTab(c, g.id) : inTab(c, classFilter)));
      if (!list.length) continue;
      if (g) {
        const h = document.createElement('div');
        h.className = 'h-cgroup';
        h.style.setProperty('--cc', g.color || '#ffcf3f');
        h.innerHTML = `<i></i><b>${esc(g.name)}</b><small>${esc(g.desc || '')}</small>`;
        carList.appendChild(h);
      }
      for (const c of list) {
        const k = classOfId(c.class);
        const btn = document.createElement('button');
        btn.className = 'gm-btn h-carcard';
        btn.dataset.nav = '';
        btn.dataset.car = c.id;
        btn.title = c.tag || c.name;
        if (k) btn.style.setProperty('--cc', k.color || '#ffcf3f');
        // 카드: 차 사진(없으면 반짝이는 자리) + 등급 글자 + ✓ / 이름 + 특기
        const url = thumbUrl(c.id);
        const [en, ko] = splitTag(c.tag);
        btn.innerHTML = `<span class="pic">${url ? `<img src="${url}" alt="" draggable="false">` : '<span class="ph"></span>'}${k ? `<i class="cl">${esc(k.id)}</i>` : ''}<span class="chk">✓</span></span><span class="nm"><b>${esc(c.name)}</b><small>${esc(ko || en)}</small></span>`;
        btn.classList.toggle('sel', c.id === carId);
        btn.addEventListener('click', () => selectCar(c.id, true));
        btn.addEventListener('dblclick', () => show('map')); // 두 번 누르면 바로 맵 고르기
        btn.addEventListener('focus', () => selectCar(c.id));
        carList.appendChild(btn);
      }
    }
  }
  // 화면에 보이는 순서 그대로 (전체 탭은 C→B→A 묶음 순서라 cars.json 순서와 다름) → ←→가 바로 옆 카드로
  const visibleCars = () => {
    const shown = [...carList.querySelectorAll('.h-carcard')].map((b) => carOf(b.dataset.car));
    return shown.length ? shown : cars.filter((c) => inTab(c, classFilter));
  };
  /** 카드가 보이게 목록만 스크롤 (scrollIntoView는 홈 화면 전체까지 밀어 올려 로고가 잘렸음) */
  function scrollCard(card, center) {
    const box = card.closest('.list'); // 목록 칸만 스크롤됨
    if (!box) return;
    const row = box;
    const cr = card.getBoundingClientRect(), br = box.getBoundingClientRect();
    const topPad = 8;
    if (row.scrollWidth > row.clientWidth + 2 && getComputedStyle(row).flexDirection === 'row') {
      // 휴대폰 세로: 가로로 흐르는 목록
      const rr = row.getBoundingClientRect();
      if (center || cr.left < rr.left || cr.right > rr.right) row.scrollLeft += cr.left - rr.left - (center ? (rr.width - cr.width) / 2 : 8);
      return;
    }
    if (center) box.scrollTop += cr.top - br.top - (br.height - cr.height) / 2;
    else if (cr.top < br.top + topPad) box.scrollTop += cr.top - br.top - topPad;
    else if (cr.bottom > br.bottom - 8) box.scrollTop += cr.bottom - br.bottom + 8;
  }
  /** 차 사진이 준비되면 카드에 끼움 (부드럽게 나타남) */
  function putThumb(id, url) {
    for (const pic of carList.querySelectorAll(`.h-carcard[data-car="${id}"] .pic`)) {
      if (pic.querySelector('img')) continue;
      const im = new Image();
      im.alt = '';
      im.draggable = false;
      im.className = 'in';
      im.src = url;
      const ph = pic.querySelector('.ph');
      if (ph) ph.remove();
      pic.prepend(im);
    }
  }
  // 사진 찍기는 차 고르기 화면을 처음 열 때 (아니면 홈이 뜬 뒤 잠시 쉬었다가) 시작. 고른 차부터
  let thumbJob = null;
  const startThumbs = () => {
    if (thumbJob) return;
    thumbJob = loadCarThumbs(cars, { first: carId, onThumb: putThumb });
    thumbJob.done.then((st) => window.home && (window.home.thumbStats = st)).catch((e) => console.warn('차 사진', e));
  };
  function setClassTab(id, sound = false) {
    if (!classTabs.some((k) => k.id === id)) id = 'all';
    classFilter = id;
    tabsEl.querySelectorAll('.h-ctab').forEach((b) => b.classList.toggle('on', b.dataset.ctab === id));
    renderCarList();
    if (sound) uiSound('toggle');
    // 지금 고른 차가 이 등급에 없으면 첫 차로
    const vis = visibleCars();
    if (vis.length && !vis.some((c) => c.id === carId)) selectCar(vis[0].id);
    const card = carList.querySelector('.h-carcard.sel');
    if (card && view === 'car') scrollCard(card, false);
  }
  function stepClass(dir) {
    if (!classTabs.length) return;
    const i = classTabs.findIndex((k) => k.id === classFilter);
    setClassTab(classTabs[(i + dir + classTabs.length) % classTabs.length].id, true);
    const card = carList.querySelector('.h-carcard.sel');
    if (card) card.focus({ preventScroll: true });
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
    const k = classOfId(c.class);
    const chip = info.querySelector('.h-classchip');
    chip.style.display = k ? '' : 'none';
    const cc = (k && k.color) || '#ffcf3f';
    info.style.setProperty('--cc', cc); // 정보 칸 막대·테두리 = 등급 색
    home.style.setProperty('--carc', cc); // 뒤쪽 큰 글자·빛 번짐 = 등급 색
    if (k) chip.innerHTML = `<i></i><b>${esc(k.name)}</b>${k.desc ? `<span>${esc(k.desc)}</span>` : ''}`;
    const num = c.look && typeof c.look === 'object' && c.look.number != null ? String(c.look.number) : '';
    info.querySelector('.num').textContent = num ? `#${num}` : '';
    info.querySelector('h2').textContent = c.name;
    info.querySelector('.desc').textContent = c.desc || '';
    info.querySelector('.h-stats').innerHTML = STAT_NAMES.map(([k, label]) => {
      const v = Math.max(0, Math.min(5, Math.round((c.stats && c.stats[k]) || 0)));
      return `<div class="h-stat${v >= 5 ? ' top' : ''}"><span>${label}</span><span class="bar">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < v ? 'on' : ''}" style="animation-delay:${i * 0.05}s"></i>`).join('')}</span><span class="v">${v}</span></div>`;
    }).join('');
    const perks = PERKS.filter(([key, min]) => ((c.stats && c.stats[key]) || 0) >= min);
    const perkEl = info.querySelector('.h-perks');
    perkEl.innerHTML = perks.map(([, , t]) => `<span>${t}</span>`).join('');
    perkEl.hidden = !perks.length;
    carMark.textContent = splitTag(c.tag)[0] || c.name;
    carMarkBox.classList.remove('in');
    void carMarkBox.offsetWidth; // 글자가 바뀔 때마다 다시 스르륵
    carMarkBox.classList.add('in');
    if (thumbJob) thumbJob.prioritize(id);
    views.car.querySelectorAll('#hForms button').forEach((x) => x.classList.toggle('on', x.dataset.mode === 'normal'));
    preview.setCar(c);
    refreshSummary();
    setLast({ car: id });
  }
  function stepCar(dir) {
    const list = visibleCars().length ? visibleCars() : cars;
    const i = list.findIndex((c) => c.id === carId);
    const next = list[(i + dir + list.length) % list.length];
    selectCar(next.id, true);
    const card = views.car.querySelector(`.h-carcard[data-car="${next.id}"]`);
    if (card && document.activeElement && document.activeElement.classList.contains('h-carcard')) card.focus({ preventScroll: false });
  }

  // ------------------------------------------------------------------ 맵 고르기
  views.map.innerHTML = `
    <div class="h-maps">
      <div class="head"><div><h2>맵 고르기</h2><div class="who"></div></div>
        <div class="bar"><button class="gm-btn" data-go="car" data-nav>‹ 차 바꾸기 <kbd>Backspace</kbd></button><button class="gm-btn primary" data-go="mode" data-nav>다음: 레이스 방식 › <kbd>Enter</kbd></button></div></div>
      <div class="h-mapgrid"></div>
    </div>`;
  const grid = views.map.querySelector('.h-mapgrid');
  for (const m of maps) {
    const info = mapInfo[m.id];
    const card = document.createElement('button');
    card.className = 'gm-btn h-map';
    card.dataset.nav = '';
    card.dataset.map = m.id;
    const stars = '★'.repeat(m.difficulty || 1) + '☆'.repeat(Math.max(0, 3 - (m.difficulty || 1))); // 4 = 아주 어려움 (화산)
    const len = !info.ok ? '🚧 준비 중' : info.free ? '자유 주행' : `📏 약 ${info.km >= 10 ? info.km.toFixed(0) : info.km.toFixed(1)} km · 🔁 ${info.laps}바퀴`;
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
      if (mapId === m.id && card.classList.contains('sel')) show('mode');
      else selectMap(m.id, true);
    });
    card.addEventListener('focus', () => selectMap(m.id));
    card.addEventListener('dblclick', () => show('mode'));
    if (!info.ok) card.classList.add('soon');
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
      // 최고 기록 = 완주 기록 (여러 바퀴 맵은 모든 바퀴 합) (사용자 요청 2026-11-10)
      const mine = records.get(id, carId);
      const best = records.bestRaceOfMap(id);
      const el = card.querySelector('.rec');
      const bestRec = best ? records.get(id, best.car) : null;
      if (mapInfo[id].free) el.textContent = '';
      else if (mine && mine.race) el.innerHTML = `🏆 ${fmtTime(mine.race)}${mine.raceAssist ? ASSIST_TAG : ''}`;
      else if (best) el.innerHTML = `🏆 ${fmtTime(best.race)} (${esc(carOf(best.car).name)})${bestRec && bestRec.raceAssist ? ASSIST_TAG : ''}`;
      else el.textContent = '기록 없음';
      el.title = '내 최고 기록 (완주 시간, 지금 고른 차)';
    });
  }

  // ------------------------------------------------------------------ 설정 · 조작법 · 기록
  const page = (title, inner) => `<div class="h-page"><div class="head"><h2>${title}</h2><button class="gm-btn" data-go="main" data-nav>‹ 뒤로 <kbd>Esc</kbd></button></div><div class="h-panel scroll"></div></div>`;
  views.settings.innerHTML = page('설정');
  const setPanel = createSettingsPanel();
  views.settings.querySelector('.scroll').appendChild(setPanel.el);
  views.controls.innerHTML = page('조작법');
  views.controls.querySelector('.scroll').appendChild(createControlsPage({ onEditKeys: () => show('settings', true, 'keys') }));
  views.records.innerHTML = page('내 기록');
  // 구간 기록 (race 담당 sectors.js가 저장: { 맵: { 차: [s1, s2, s3] } })
  const readSectors = () => {
    try {
      return JSON.parse(localStorage.getItem('gimmick.sectors') || '{}') || {};
    } catch {
      return {};
    }
  };
  function renderRecords() {
    const all = records.all();
    const sec = readSectors();
    const rows = maps
      .filter((m) => !mapInfo[m.id].free)
      .map((m) => {
        const r = all[m.id] || {};
        const entries = Object.entries(r);
        const lap = entries.filter(([, v]) => v.lap).sort((a, b) => a[1].lap - b[1].lap)[0];
        const race = entries.filter(([, v]) => v.race).sort((a, b) => a[1].race - b[1].race)[0];
        const perCar = cars
          .filter((c) => r[c.id] && r[c.id].race)
          .map((c) => `${esc(c.name)} ${fmtTime(r[c.id].race)}${r[c.id].raceAssist ? ASSIST_TAG : ''}`)
          .join(' · ');
        // 구간마다 (어느 차든) 최고 → 이론상 최고 랩 = 합
        const best3 = [0, 1, 2].map((i) => Math.min(...Object.values(sec[m.id] || {}).map((v) => (v && v[i]) || Infinity)));
        const secHtml = best3.every(Number.isFinite)
          ? `<span class="h-sec">${best3.map((v, i) => `<i>S${i + 1} ${v.toFixed(2)}</i>`).join('')}</span><br><small class="none">이론상 ${fmtTime(best3[0] + best3[1] + best3[2])}</small>`
          : '<span class="none">—</span>';
        return `<tr><td class="m"><b>${esc(m.title)}</b><small>${mapInfo[m.id].laps}바퀴</small></td>
          <td>${race ? `<span class="gold">${fmtTime(race[1].race)}</span>${race[1].raceAssist ? ASSIST_TAG : ''}<br><small class="none">${esc(carOf(race[0]).name)}</small>` : '<span class="none">—</span>'}</td>
          <td>${lap ? `${fmtTime(lap[1].lap)}${lap[1].lapAssist ? ASSIST_TAG : ''}<br><small class="none">${esc(carOf(lap[0]).name)}</small>` : '<span class="none">—</span>'}</td>
          <td>${secHtml}</td>
          <td><small class="none">${perCar || '아직 달리지 않았어요'}</small></td></tr>`;
      })
      .join('');
    const box = views.records.querySelector('.scroll');
    box.innerHTML = `${online.enabled ? '<div class="h-online"></div><h3 class="h-subt">💾 이 브라우저의 내 기록</h3>' : ''}<table class="h-rec"><thead><tr><th>맵</th><th>최고 기록 (완주)</th><th>최고 랩</th><th>최고 구간</th><th>차마다 최고 기록</th></tr></thead><tbody>${rows}</tbody></table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;color:var(--gm-dim);font-size:12px">
        <span>${online.enabled ? '완주하면 온라인 순위표에도 자동으로 올라가요' : '기록은 이 브라우저에만 저장돼요'} · ${ASSIST_TAG} = 운전 도움(브레이크·조향·트랙션)을 켜고 낸 기록</span><button class="gm-btn small danger" data-act="clearRec" data-nav>기록 지우기</button></div>`;
  }

  // ------------------------------------------------------------------ 온라인 순위표 (내 기록 화면 위쪽)
  //   맵마다 사람별 가장 빠른 완주 기록 (어느 차든) / 지금 고른 차만. 줄마다 "👻 같이 달리기" = 그 사람 고스트와 타임 어택
  let olMap = null, olCarOnly = false, olSeq = 0;
  async function renderOnline() {
    const box = views.records.querySelector('.h-online');
    if (!box) return;
    if (!olMap || !maps.some((m) => m.id === olMap && !mapInfo[m.id].free)) olMap = (maps.find((m) => m.id === mapId && !mapInfo[m.id].free) || maps.find((m) => !mapInfo[m.id].free) || maps[0]).id;
    const me = online.me();
    const code = online.myCode();
    const tabs = maps.filter((m) => !mapInfo[m.id].free).map((m) => `<button class="gm-btn small${m.id === olMap ? ' on' : ''}" data-act="olMap" data-map="${m.id}" data-nav>${esc(m.title)}</button>`).join('');
    box.innerHTML = `<h3 class="h-subt">🌐 온라인 순위표 <small>로그인 없이 이름으로 · 완주하면 자동으로 올라감</small></h3>
      <div class="h-oltabs">${tabs}<button class="gm-btn small h-olcar${olCarOnly ? ' on' : ''}" data-act="olCar" data-nav>${olCarOnly ? `🏎️ ${esc(carOf(carId).name)}만` : '🏎️ 모든 차'}</button></div>
      <div class="h-olboard"><div class="none">불러오는 중…</div></div>
      <div class="h-olme">${me ? `👤 <b>${esc(me.nick)}</b> 으로 올리는 중` : '👤 아직 올린 기록이 없어요 (완주하면 홈의 이름으로 올라가요)'}
        ${code ? '<button class="gm-btn small" data-act="olCopy" data-nav title="다른 컴퓨터·브라우저에서 같은 이름으로 이어 하기">🔑 내 코드 복사</button>' : ''}
        <span class="h-olcode"><input type="text" spellcheck="false" autocomplete="off" placeholder="다른 기기의 코드 (GR-…)" aria-label="내 코드 넣기"><button class="gm-btn small" data-act="olUse" data-nav>코드로 이어 하기</button></span></div>`;
    const seq = ++olSeq;
    const board = box.querySelector('.h-olboard');
    try {
      const rows = await online.board(olMap, olCarOnly ? carId : null, 50);
      if (seq !== olSeq) return;
      if (!rows.length) {
        board.innerHTML = '<div class="none">아직 아무도 기록이 없어요. 첫 번째가 되어 보세요!</div>';
        return;
      }
      const lapsN = mapInfo[olMap].laps;
      board.innerHTML = `<table class="h-rec h-olt"><thead><tr><th>순위</th><th>이름</th><th>차</th><th>기록${lapsN > 1 ? ` (${lapsN}바퀴)` : ''}</th><th>최고 랩</th><th></th></tr></thead><tbody>${rows
        .map((r, i) => {
          const mine = me && r.player_id === me.id;
          return `<tr class="${mine ? 'me' : ''}"><td class="rk">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td><b>${esc(r.nickname)}</b>${mine ? ' <small class="none">(나)</small>' : ''}</td><td><small>${esc(carOf(r.car).name || r.car)}</small></td>
            <td><span class="${i === 0 ? 'gold' : ''}">${fmtTime(r.total)}</span>${r.assist ? ASSIST_TAG : ''}</td><td><small class="none">${r.best_lap ? fmtTime(r.best_lap) : '—'}</small></td>
            <td><button class="gm-btn small" data-act="olGhost" data-pid="${esc(r.player_id)}" data-car="${esc(r.car)}" data-nick="${esc(r.nickname)}" data-nav title="이 사람의 고스트와 같은 차로 타임 어택">👻 같이 달리기</button></td></tr>`;
        })
        .join('')}</tbody></table>`;
    } catch (err) {
      console.warn('온라인 순위표', err);
      if (seq === olSeq) board.innerHTML = '<div class="none">순위표를 불러오지 못했어요 (인터넷 확인)</div>';
    }
  }

  // ------------------------------------------------------------------ 화면 바꾸기
  let view = 'main';
  let modeFrom = 'main'; // 레이스 방식 화면에서 Esc → 온 곳으로
  /** 화면 바꾸기. sub: 설정 화면의 탭 ('general' | 'keys') */
  function show(name, focus = true, sub) {
    if (!views[name]) name = 'main';
    if (view !== name) uiSound(name === 'main' ? 'back' : 'select');
    if (name === 'mode' && view !== 'mode') modeFrom = view === 'map' ? 'map' : 'main';
    view = name;
    if (name === 'settings') setPanel.showTab(sub || 'general');
    if (name === 'mode') refreshModes(), refreshModeSummary();
    for (const [k, v] of Object.entries(views)) v.classList.toggle('on', k === name);
    home.classList.toggle('dim', !['main', 'car'].includes(name));
    home.classList.toggle('calm', name !== 'main');
    preview.setView(name);
    if (name === 'records') {
      renderRecords();
      renderOnline();
    }
    if (name === 'map') refreshRecords();
    if (name === 'car') startThumbs();
    refreshSummary();
    if (focus) {
      const target =
        name === 'car' ? views.car.querySelector('.h-carcard.sel')
        : name === 'map' ? grid.querySelector('.h-map.sel')
        : name === 'main' ? views.main.querySelector('.h-start')
        : name === 'mode' ? views.mode.querySelector('.h-mode.sel .h-modecard')
        : name === 'settings' && sub === 'keys' ? views.settings.querySelector('.kb-slot')
        : name === 'settings' && sub === 'pad' ? views.settings.querySelector('.gm-tab[data-tab="pad"]')
        : views[name].querySelector('.gm-set-row, [data-nav]');
      if (target) target.focus({ preventScroll: true });
      if (target && name === 'car') scrollCard(target, true); // 고른 차가 목록 아래쪽이어도 보이게
    }
  }
  function refreshSummary() {
    const c = carOf(carId), m = mapOf(mapId);
    const rm = RACE_MODES.find((x) => x.id === raceMode);
    views.main.querySelector('.h-start .sel').textContent = `${m.title} · ${c.name}${rm ? ` · ${rm.icon} ${rm.name}` : ''}`;
    views.mode.querySelector('.who').textContent = `🗺️ ${m.title} · 🏎️ ${c.name}`;
    views.main.querySelector('[data-f="car"]').textContent = `지금: ${c.name}`;
    views.main.querySelector('[data-f="map"]').textContent = `지금: ${m.title}`;
    views.main.querySelector('.h-cartag .tg').textContent = c.tag || '';
    views.main.querySelector('.h-cartag .n').textContent = c.name;
    views.map.querySelector('.who').textContent = `🏎️ ${c.name} 으로 달려요`;
  }

  // ------------------------------------------------------------------ 레이스 방식 고르기
  views.mode.innerHTML = `
    <div class="h-modes">
      <div class="head"><div><h2>레이스 방식</h2><div class="who"></div></div>
        <div class="bar"><button class="gm-btn" data-go="map" data-nav>‹ 맵 바꾸기</button><button class="gm-btn primary" data-act="start" data-nav>출발! <kbd>Enter</kbd></button></div></div>
      <div class="h-modegrid">${RACE_MODES.map(
        (m) => `<div class="h-mode" data-mode="${m.id}">
          <button class="gm-btn h-modecard" data-nav data-pick="${m.id}"><span class="ic">${m.icon}</span><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><span class="chk">✓</span></button>
          <div class="opts"></div></div>`,
      ).join('')}</div>
      <div class="h-modetip"></div>
      <div class="h-modesum">
        <canvas width="360" height="170"></canvas>
        <div class="i"><small>맵</small><b data-s="mt"></b><span data-s="mm"></span></div>
        <div class="i"><small>차</small><b data-s="ct"></b><span data-s="cm"></span></div>
        <div class="i"><small>내 최고 기록 (이 차)</small><b data-s="rb"></b><span data-s="rm"></span></div>
        <div class="b"><button class="gm-btn small" data-go="map" data-nav>🗺️ 맵</button><button class="gm-btn small" data-go="car" data-nav>🏎️ 차</button></div>
      </div>
    </div>`;
  // 방식마다 고를 수 있는 것 (설정 값을 바로 바꿈: 홈 설정·Esc 메뉴 설정과 같은 값)
  const MODE_OPTS = { race: ['bots', 'botLevel'], champ: ['champLen', 'botLevel'], time: ['ghost'], net: [], free: [] };
  const OPT_LABEL = { bots: '봇 수', botLevel: '봇 실력', ghost: '고스트', champLen: '시즌' };
  const MODE_TIPS = {
    race: '🏁 봇들과 같은 출발선에서 출발해요. 봇은 내 차와 같은 등급의 차를 타요',
    time: '⏱️ 혼자 달리며 고스트(내 최고 기록)와 겨뤄요. 구간마다 빨라졌는지 느려졌는지 알려 줘요',
    net: '🌐 방을 만들어 코드를 친구에게 보내거나, 친구 코드로 들어가요. 모두 준비되면 같이 출발해요',
    free: '🧭 봇·고스트 없이 혼자 달려요. 코스를 익히거나 레이싱 라인을 연습할 때 좋아요',
    champ: '🏆 같은 봇들과 여러 맵을 차례로 달려요. 1위 25점 · 2위 18점 · 3위 15점… 시즌이 끝나면 점수로 챔피언을 정해요',
  };
  for (const box of views.mode.querySelectorAll('.h-mode')) {
    const opts = box.querySelector('.opts');
    const keys = MODE_OPTS[box.dataset.mode] || [];
    if (box.dataset.mode === 'champ') box.querySelector('.h-modecard').insertAdjacentHTML('afterend', '<div class="h-champ"></div>');
    if (!keys.length) {
      opts.innerHTML = `<div class="none">${box.dataset.mode === 'net' ? '방 만들기 · 코드로 참가' : '봇 없음 · 고스트 없음'}</div>`;
      continue;
    }
    opts.innerHTML = keys
      .map((k) => `<div class="h-mopt" data-nav tabindex="0" data-adjust="${k}"><span>${OPT_LABEL[k]}</span><span class="v"><button tabindex="-1" data-adj="-1" aria-label="줄이기">‹</button><b></b><button tabindex="-1" data-adj="1" aria-label="늘리기">›</button></span></div>`)
      .join('');
  }
  /** 레이스 방식 화면 아래 요약: 코스 그림 + 맵·차·내 기록 */
  function refreshModeSummary() {
    const m = mapOf(mapId), c = carOf(carId), info = mapInfo[mapId] || {};
    const box = views.mode.querySelector('.h-modesum');
    drawTrackThumb(box.querySelector('canvas'), info.pts || [], m.theme);
    const set = (k, v) => (box.querySelector(`[data-s="${k}"]`).textContent = v);
    set('mt', m.title);
    set('mm', info.free ? '자유 주행' : `약 ${info.km >= 10 ? info.km.toFixed(0) : (info.km || 0).toFixed(1)} km · ${info.laps}바퀴 · ${'★'.repeat(m.difficulty || 1)}`);
    set('ct', c.name);
    const k = classOfId(c.class);
    set('cm', [k ? k.name : '', c.tag || ''].filter(Boolean).join(' · '));
    const mine = records.get(mapId, carId);
    box.querySelector('[data-s="rb"]').innerHTML = mine && mine.race ? `${fmtTime(mine.race)}${mine.raceAssist ? ASSIST_TAG : ''}` : '—';
    set('rm', mine && mine.lap ? `최고 랩 ${fmtTime(mine.lap)}` : '아직 기록 없음');
  }
  function refreshModes() {
    views.mode.querySelectorAll('.h-mode').forEach((b) => b.classList.toggle('sel', b.dataset.mode === raceMode));
    views.mode.querySelectorAll('.h-mopt').forEach((o) => {
      const d = SETTING_DEFS.find((x) => x.key === o.dataset.adjust);
      const v = settings.get(o.dataset.adjust);
      const opt = d && d.options.find((x) => x[0] === v);
      o.querySelector('b').textContent = o.dataset.adjust === 'bots' ? `${v}대` : opt ? opt[1] : String(v);
    });
    refreshChamp();
    const m = RACE_MODES.find((x) => x.id === raceMode);
    // 봇 실력 설명 (사용자 요청: 쉬움 = 처음 해도 이김, 중간 = 처음엔 어려움, 어려움 = 잘하는 사람과 비슷)
    const LEVEL_TIP = { easy: '봇 쉬움: 처음 해도 이길 수 있어요', normal: '봇 중간: 처음 하는 사람은 이기기 어려워요', hard: '봇 어려움: 잘하는 사람과 비슷한 실력이에요', master: '봇 고수: 내 최고 기록보다 1~3% 빨라요' };
    let lvTip = raceMode === 'race' || raceMode === 'champ' ? LEVEL_TIP[settings.get('botLevel') || 'normal'] || '' : '';
    if (lvTip && settings.get('botLevel') === 'master') {
      // 고수: 이 맵(마지막으로 고른 맵) 내 최고 기록 → 봇 목표 (bots.js masterTarget, 같은 등급 차 기록 우선)
      let mt = null;
      try {
        mt = masterTarget(records.all(), mapId, carId, cars, (mapInfo[mapId] || {}).laps || null);
      } catch {}
      lvTip = mt
        ? `${lvTip} (목표: 내 최고 ${fmtTime(mt.sec)}${mt.adjusted ? ' (다른 등급 기록으로 어림)' : ''} → 약 ${fmtTime(mt.sec * 0.98)})`
        : `${lvTip} (이 맵 기록이 없어서 지금은 어려움보다 조금 빠르게 달려요)`;
    }
    views.mode.querySelector('.h-modetip').textContent = [MODE_TIPS[raceMode] || '', lvTip].filter(Boolean).join(' · ');
    views.mode.querySelector('[data-act="start"]').innerHTML =
      raceMode === 'net' ? '🌐 방 만들기 · 참가 <kbd>Enter</kbd>'
      : raceMode === 'champ' ? (champState() ? '▶ 시즌 이어 하기 <kbd>Enter</kbd>' : '🏆 시즌 시작 <kbd>Enter</kbd>')
      : `${m ? m.icon : ''} 출발! <kbd>Enter</kbd>`;
  }

  // ------------------------------------------------------------------ 챔피언십 (race 담당의 championship.js)
  var champMod = null, champReady = null; // null = 확인 중, false = 아직 없음 (var: 위의 refreshModes가 먼저 불려도 되게)
  import('./championship.js')
    .then((m) => {
      champMod = m;
      champReady = typeof m.startChamp === 'function' && typeof m.getChamp === 'function';
    })
    .catch(() => (champReady = false))
    .finally(() => (refreshChamp(), refreshModes(), refreshSummary()));
  function champState() {
    try {
      return champReady ? champMod.getChamp() : null;
    } catch {
      return null;
    }
  }
  /** 챔피언십 카드: 진행 중이면 몇 경기째·점수·순위 + 이어 하기 / 그만두기 */
  function refreshChamp() {
    const box = views.mode.querySelector('.h-mode[data-mode="champ"]');
    if (!box) return;
    const el = box.querySelector('.h-champ');
    box.classList.toggle('soon', champReady === false);
    box.classList.remove('running');
    if (champReady === false) {
      el.innerHTML = '<div class="soonchip">🚧 준비 중</div>';
      return;
    }
    const st = champState();
    if (!st) {
      let last = null;
      try {
        last = champMod && champMod.lastChamp ? champMod.lastChamp() : null;
      } catch {}
      if (last && last.finished && champMod.champStandings) {
        const tbl = champMod.champStandings(last);
        const pos = tbl.findIndex((d) => d.isPlayer) + 1;
        el.innerHTML = pos ? `<div class="last">지난 시즌: <b>${pos === 1 ? '🏆 챔피언!' : `${pos}위`}</b> · ${tbl[pos - 1].points}점</div>` : '';
      } else el.innerHTML = '';
      return;
    }
    box.classList.add('running'); // 진행 중인 시즌: 시즌 길이·실력은 이미 정해져 있어서 고르기 줄 숨김
    const done = st.results.length, total = st.maps.length;
    const tbl = champMod.champStandings ? champMod.champStandings(st) : [];
    const meI = tbl.findIndex((d) => d.isPlayer);
    const me = meI >= 0 ? tbl[meI] : null;
    const next = st.maps[done];
    const dots = st.maps.map((m, i) => `<i class="${i < done ? 'done' : i === done ? 'now' : ''}" title="${esc(mapOf(m).title || m)}"></i>`).join('');
    el.innerHTML = `<div class="prog"><span class="dots">${dots}</span><b>${done}/${total}경기</b>${me ? ` · <b>${me.points}점</b> · ${meI + 1}위` : ''}</div>
      <div class="nx">다음: ${esc(next ? mapOf(next).title || next : '-')} · ${esc(carOf(st.carId).name || st.carId)}</div>
      <div class="b"><button class="gm-btn small primary" data-champ="resume" data-nav>▶ 이어 하기</button><button class="gm-btn small" data-champ="quit" data-nav>그만두기</button></div>`;
  }
  async function champStart() {
    if (!champReady) return toast('🏆 챔피언십은 곧 열려요 (준비 중)');
    const cur = champState();
    if (cur) {
      const url = champMod.champUrl();
      if (url) return launch(url, '🏆 챔피언십', `${cur.results.length + 1}/${cur.maps.length}경기 · ${mapOf(cur.maps[cur.results.length]).title}`);
    }
    const n = settings.get('champLen') || 5;
    const ok = maps.filter((m) => mapInfo[m.id] && mapInfo[m.id].ok && !mapInfo[m.id].free);
    const at = Math.max(0, ok.findIndex((m) => m.id === mapId));
    const order = [...ok.slice(at), ...ok.slice(0, at)].slice(0, n).map((m) => m.id);
    const c = carOf(carId);
    let url;
    try {
      url = champMod.startChamp({ classId: c.class || null, carId, level: settings.get('botLevel') || 'normal', maps: order, bots: settings.get('bots') || 5 });
    } catch (err) {
      console.warn('챔피언십 시작 실패', err);
      return toast('🏆 챔피언십을 시작하지 못했어요');
    }
    setLast({ map: mapId, car: carId, mode: 'champ' });
    launch(url, '🏆 챔피언십 개막', `${order.length}경기 · ${order.map((id) => mapOf(id).title).join(' → ')}`);
  }
  views.mode.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-champ]');
    if (!b) return;
    e.stopPropagation();
    pickMode('champ');
    if (b.dataset.champ === 'resume') return champStart();
    if (await confirmDialog('시즌을 그만둘까요?', '지금까지 모은 챔피언십 점수가 사라지고 되돌릴 수 없어요.', '그만두기', '계속하기')) {
      champMod.abandonChamp();
      uiSound('back');
      refreshModes();
    }
  });
  settings.onChange(refreshModes);
  views.mode.addEventListener('click', (e) => {
    const adj = e.target.closest('[data-adj]');
    if (adj) {
      const row = adj.closest('.h-mopt');
      pickMode(row.closest('.h-mode').dataset.mode);
      setPanel.adjust(row.dataset.adjust, +adj.dataset.adj);
      row.focus({ preventScroll: true });
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      if (raceMode === pick.dataset.pick) start();
      else pickMode(pick.dataset.pick, true);
    }
  });
  views.mode.addEventListener('focusin', (e) => {
    const box = e.target.closest('.h-mode');
    if (box) pickMode(box.dataset.mode);
  });
  function pickMode(id, sound = false) {
    if (raceMode === id) return;
    raceMode = id;
    if (sound) uiSound('move');
    setLast({ mode: id });
    refreshModes();
    refreshSummary();
  }

  let launching = false;
  /** 출발: 고른 맵·차·방식으로 게임 주소를 불러옴 (멀티플레이는 대기실 창) */
  function start(mode = raceMode) {
    if (launching) return;
    if (!mapInfo[mapId].ok) {
      toast('🚧 이 맵은 아직 준비 중이에요');
      return;
    }
    if (mode === 'champ') return champStart();
    setLast({ map: mapId, car: carId, mode });
    if (mode === 'net') return openLobby({ map: mapId, car: carId });
    launching = true;
    uiSound('select');
    const m = mapOf(mapId), c = carOf(carId), rm = RACE_MODES.find((x) => x.id === mode);
    $('#hLaunch').innerHTML = `<div class="logo">기믹 레이싱</div><div class="map">${esc(m.title)}</div><div class="car">${esc(c.name)}</div><div class="mode">${rm ? `${rm.icon} ${esc(rm.name)}` : ''}</div>`;
    $('.h-launch').classList.add('on');
    const extra = mode === 'race' || mode === 'time' ? { mode } : {};
    setTimeout(() => (location.href = raceUrl(mapId, carId, extra)), 380);
  }
  /** 다른 주소로 출발 (챔피언십 등): 출발 화면을 보여 주고 이동 */
  function launch(url, title, sub = '') {
    if (launching || !url) return;
    launching = true;
    uiSound('select');
    $('#hLaunch').innerHTML = `<div class="logo">기믹 레이싱</div><div class="map">${esc(title)}</div><div class="car">${esc(sub)}</div>`;
    $('.h-launch').classList.add('on');
    setTimeout(() => (location.href = url), 380);
  }
  function startTutorial() {
    if (launching) return;
    launching = true;
    uiSound('select');
    try {
      localStorage.setItem(TUT_KEY, localStorage.getItem(TUT_KEY) || 'asked');
    } catch {}
    $('#hLaunch').innerHTML = `<div class="logo">기믹 레이싱</div><div class="map">🎓 튜토리얼</div><div class="car">구름섬 그랑프리 · ${esc(carOf(carId).name)}</div>`;
    $('.h-launch').classList.add('on');
    setTimeout(() => (location.href = tutorialUrl(carId)), 380);
  }
  /** 멀티플레이 대기실 (net 담당이 만드는 lobby.js). 없거나 실패하면 알림만 */
  function openLobby(opts) {
    uiSound('select');
    import('./lobby.js')
      .then((m) => {
        if (typeof m.openLobby !== 'function') throw new Error('openLobby 없음');
        return m.openLobby(opts);
      })
      .catch((err) => {
        console.warn('멀티플레이 불러오기 실패', err);
        toast('🌐 멀티플레이를 아직 열 수 없어요 (준비 중)');
      });
  }
  let toastT = 0;
  function toast(text) {
    const t = $('#hToast');
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 2600);
  }

  // 버튼 클릭 (data-go = 화면 이동, data-act = 동작)
  home.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-go], [data-act]');
    if (!b) return;
    if (b.dataset.go) return show(b.dataset.go);
    const act = b.dataset.act;
    if (act === 'start') view === 'mode' ? start() : show('mode');
    else if (act === 'tutorial') startTutorial();
    else if (act === 'multi') openLobby({ map: mapId, car: carId });
    else if (act === 'prevCar') stepCar(-1);
    else if (act === 'nextCar') stepCar(1);
    else if (act === 'pickCar') show('map');
    else if (act === 'editKeys') show('settings', true, 'keys');
    else if (act === 'name') {
      const r = await welcomeDialog({ first: false });
      if (r) showName();
    }
    else if (act === 'olMap') {
      olMap = b.dataset.map;
      renderOnline();
    }
    else if (act === 'olCar') {
      olCarOnly = !olCarOnly;
      renderOnline();
    }
    else if (act === 'olGhost') {
      const nick = b.dataset.nick, car = b.dataset.car;
      setLast({ map: olMap, car, mode: 'time' });
      launch(raceUrl(olMap, car, { mode: 'time', ghost: b.dataset.pid, ghostCar: car, ghostName: nick }), mapOf(olMap).title, `👻 ${nick} 고스트와 · ${carOf(car).name}`);
    }
    else if (act === 'olCopy') {
      const code = online.myCode();
      try {
        await navigator.clipboard.writeText(code);
        toast('🔑 내 코드를 복사했어요 · 다른 기기의 "코드로 이어 하기"에 붙여 넣으세요');
      } catch {
        window.prompt('내 코드 (다른 기기에 붙여 넣기)', code);
      }
    }
    else if (act === 'olUse') {
      const inp = views.records.querySelector('.h-olcode input');
      try {
        const nick = await online.useCode(inp.value);
        toast(`👤 ${nick} 으로 이어서 올려요`);
        showName();
        renderOnline();
      } catch (err) {
        toast(`🔑 ${err.message || '코드를 확인하지 못했어요'}`);
      }
    }
    else if (act === 'clearRec') {
      if (await confirmDialog('기록을 지울까요?', '모든 맵의 최고 기록·구간 기록·고스트가 사라지고 되돌릴 수 없어요.', '지우기')) {
        records.clear();
        try {
          localStorage.removeItem('gimmick.sectors'); // 구간 기록도 같이
          // 고스트(최고 랩 다시 보기)도 같이 (ghost.js: 'gimmick.ghost.index'에 저장한 키 목록)
          for (const k of JSON.parse(localStorage.getItem('gimmick.ghost.index') || '[]') || []) localStorage.removeItem(k);
          localStorage.removeItem('gimmick.ghost.index');
        } catch {}
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
    if (dialogOpen() || launching || document.getElementById('lobby')) return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return; // 글자 입력 칸
    const k = e.code;
    const act = document.activeElement;
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[k];
    if (k === 'Escape' || k === 'Backspace') {
      e.preventDefault();
      // 맵 고르기에서 Backspace = 차 고르기로 (사용자 요청 2026-11-10), Esc는 예전처럼 홈으로
      if (view === 'map' && k === 'Backspace') return show('car');
      if (view !== 'main') show(view === 'mode' ? modeFrom : 'main');
      return;
    }
    // 설정: PageUp / PageDown (패드 LB / RB) = 탭 넘기기
    if (view === 'settings' && (k === 'PageUp' || k === 'PageDown')) {
      e.preventDefault();
      const tabs = ['general', 'keys', 'pad'];
      const i = tabs.indexOf(setPanel.tab);
      const next = tabs[(i + (k === 'PageUp' ? 2 : 1)) % 3];
      setPanel.showTab(next);
      uiSound('toggle');
      const f = views.settings.querySelector(`.gm-tab[data-tab="${next}"]`);
      if (f) f.focus({ preventScroll: true });
      return;
    }
    // 차 고르기: Q / E = 등급 탭 바꾸기
    if (view === 'car' && (k === 'KeyQ' || k === 'KeyE' || k === 'PageUp' || k === 'PageDown')) {
      e.preventDefault();
      stepClass(k === 'KeyQ' || k === 'PageUp' ? -1 : 1);
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
        show('mode');
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
        if (view === 'main') show('mode');
        else if (view === 'mode') start();
      }
    }
  });

  // 처음 화면
  setClassTab('all');
  selectCar(carId);
  selectMap(mapId);
  refreshModes();
  const startView = params.get('menu');
  if (startView === 'keys' || startView === 'pad') show('settings', true, startView);
  else show(['car', 'map', 'settings', 'controls', 'records', 'mode'].includes(startView) ? startView : startView === 'ranking' ? 'records' : 'main');
  view === 'main' && views.main.querySelector('.h-start').focus({ preventScroll: true });
  setTimeout(startThumbs, 1500); // 메인 화면에 있어도 미리 찍어 둠 (다음부터는 저장된 사진을 바로 씀)
  const ld = document.getElementById('loading');
  if (ld) {
    ld.classList.add('out');
    setTimeout(() => ld.remove(), 450);
  }
  // 멀티플레이 초대 링크 (?join=코드) → 참가 창을 바로 엶
  const joinCode = params.get('join');
  if (joinCode) openLobby({ join: joinCode, map: mapId, car: carId });
  else if (!startView) {
    // 처음 온 사람에게 튜토리얼을 한 번 권함 (기록이 없고 아직 안 물어봤을 때)
    let asked = null;
    try {
      asked = localStorage.getItem(TUT_KEY);
    } catch {}
    const hasRecords = Object.keys(records.all() || {}).length > 0;
    if (!asked && !hasRecords) {
      try {
        localStorage.setItem(TUT_KEY, 'asked');
      } catch {}
      setTimeout(async () => {
        if (view !== 'main' || launching || dialogOpen()) return;
        const r = await welcomeDialog({ first: true });
        showName();
        if (r && r.tutorial) startTutorial();
      }, 700);
    }
  }
  // 이름 (멀티플레이 대기실과 같은 'gimmick.nick')
  function showName() {
    const n = getNick();
    $('.h-name span').textContent = n || '이름 정하기';
    $('.h-name').classList.toggle('empty', !n);
  }
  showName();
  // 게임패드가 연결되면 아래 안내에 패드 버튼도
  const padHint = () => {
    const h = $('.h-foot .padhint');
    h.hidden = !pad.connected();
    if (!h.hidden) h.innerHTML = `🎮 ${padKbd(0)} 확인 ${padKbd(1)} 뒤로 ${padKbd(4)}${padKbd(5)} 탭`;
  };
  padHint();
  pad.onConnect(padHint);
  window.home = { show, selectCar, selectMap, start, startTutorial, openLobby, preview, welcome: welcomeDialog, champ: champStart, get mode() { return raceMode; }, get view() { return view; }, get carId() { return carId; }, get mapId() { return mapId; } };
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

// ------------------------------------------------------------------ 이름 (net.js와 같은 저장 칸 'gimmick.nick')
const NICK_KEY = 'gimmick.nick';
const cleanNick = (v) => String(v || '').replace(/[<>&"]/g, '').trim().slice(0, 12);
const randomNick = () => ['번개', '질주', '드리프트', '터보', '로켓', '바람', '유성', '폭풍', '코너', '에이펙스'][Math.floor(Math.random() * 10)] + Math.floor(10 + Math.random() * 90);
function getNick() {
  try {
    return localStorage.getItem(NICK_KEY) || '';
  } catch {
    return '';
  }
}
function setNick(n) {
  try {
    localStorage.setItem(NICK_KEY, n);
  } catch {}
}

/**
 * 환영 창 (처음 왔을 때) / 이름 바꾸기 창
 *   first: true → 이름 + "튜토리얼부터 / 바로 둘러보기". Promise<{ name, tutorial } | null>
 *   first: false → 이름만 [저장] [취소]
 */
function welcomeDialog({ first = false } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'gm-confirm gm-welcome';
    const cur = getNick();
    wrap.innerHTML = `<div class="box" role="dialog" aria-modal="true">
      ${first ? '<div class="wl-flag">🏁</div><h3>기믹 레이싱에 온 걸 환영해요!</h3><p>먼저 레이스에서 보일 <b>이름</b>을 정해 주세요. 멀티플레이와 결과표에 나와요.</p>' : '<h3>👤 내 이름</h3><p>멀티플레이 대기실과 레이스 결과표에 보이는 이름이에요.</p>'}
      <div class="wl-name"><input type="text" maxlength="12" spellcheck="false" autocomplete="off" aria-label="이름"><button class="gm-btn small" data-r="dice" title="아무 이름이나">🎲</button></div>
      <small class="wl-hint">최대 12글자 · 나중에 홈 오른쪽 위 👤에서 바꿀 수 있어요</small>
      ${first ? `<div class="wl-tut"><span class="ic">🎓</span><div><b>처음이라면 튜토리얼부터!</b><small>약 5분 · 출발 신호, 브레이크, 에이펙스, 드리프트, 변신(가속·배·비행)까지 직접 해 보며 배워요</small></div></div>` : ''}
      <div class="btns">${first ? '<button class="gm-btn" data-r="skip">바로 둘러보기</button><button class="gm-btn primary" data-r="tut">🎓 튜토리얼 시작<kbd>Enter</kbd></button>' : '<button class="gm-btn" data-r="cancel">취소</button><button class="gm-btn primary" data-r="ok">저장<kbd>Enter</kbd></button>'}</div></div>`;
    const inp = wrap.querySelector('input');
    inp.value = cur || (first ? randomNick() : '');
    const done = (r) => {
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      if (r) {
        const n = cleanNick(inp.value) || cur || randomNick();
        setNick(n);
        uiSound('select');
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        resolve({ name: n, tutorial: r === 'tut' });
      } else {
        uiSound('back');
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        resolve(null);
      }
    };
    const primary = first ? 'tut' : 'ok';
    const onKey = (e) => {
      e.stopImmediatePropagation(); // 홈·게임은 키를 안 받음 (글자 입력은 그대로 됨)
      const a = document.activeElement;
      if (e.code === 'Escape') return e.preventDefault(), done(first ? 'skip' : null);
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (a && a.dataset && a.dataset.r === 'dice') return (inp.value = randomNick()), uiSound('move');
        return done(a && a.dataset && a.dataset.r && a !== inp ? (a.dataset.r === 'cancel' ? null : a.dataset.r) : primary);
      }
      if (['ArrowUp', 'ArrowDown'].includes(e.code) || (a !== inp && ['ArrowLeft', 'ArrowRight'].includes(e.code))) {
        e.preventDefault();
        const items = [inp, ...wrap.querySelectorAll('button')];
        const i = items.indexOf(a);
        const d = e.code === 'ArrowUp' || e.code === 'ArrowLeft' ? -1 : 1;
        items[(i + d + items.length) % items.length].focus();
        uiSound('move');
      }
    };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.r === 'dice') return (inp.value = randomNick()), inp.focus(), uiSound('move');
      done(b.dataset.r === 'cancel' ? null : b.dataset.r);
    });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    inp.focus();
    inp.select();
  });
}
