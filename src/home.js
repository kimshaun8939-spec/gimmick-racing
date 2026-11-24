import { medalHtml } from './medals.js';
﻿// 홈 화면: 주소에 ?map= 이 없으면 게임 대신 이 화면이 뜸
//   메인 메뉴(레이스 시작 / 차 고르기 / 맵 고르기 / 기록 / 설정 / 조작법)
//   차 고르기: 직접 돌려 보는 3D 차 미리보기(작은 Three.js 장면) + 성능 막대 + 변신 미리보기
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
import { recKey } from './mapVer.js'; // 코스 버전 (mapver): 구간 기록 칸 = 'glacier@2' (records·online·ghost는 안에서 바꿈)
import { online } from './online.js';
import { toastNext as cloudToastNext } from './cloudSave.js'; // 계정 저장: 새로 고침 뒤 알림
import { createCarModel } from './carModel.js';
import { loadCarThumbs, thumbUrl } from './garageThumbQueue.js'; // 차 고르기 카드의 진짜 차 사진
import { profile } from './profile.js'; // 드라이버 카드 (레벨·티어·XP)
import * as unlocks from './unlocks.js'; // 레벨 잠금(차)·색 고르기 (차고)
import { pad, padKbd } from './gamepad.js'; // 게임패드로 메뉴 이동 (스틱/D-패드 = 화살표, A = 확인, B = 뒤로)
import { LESSONS, LICENSES, GROUPS, academy, lessonMeta, licenseChip, MEDALS, MEDAL_NAMES } from './academyStore.js'; // 드라이빙 아카데미 (2026-11-12)
import { academyArt, licenseBadge } from './academyArt.js';
import { PRESETS, keybinds } from './keybinds.js';
import { statScore } from './carRoster.js';
import { createCarCompare } from './carCompare.js';
import { applyCostume, listCostumes } from './carCostumes.js';
import { meta, bootMeta } from './meta.js';
import { createMetaPage, createCostumePicker } from './metaUI.js';
import { paintPrice, CURRENCIES, CURRENCY_IDS } from './metaCatalog.js';
import { wallet as walletNow, buyCar } from './meta.js'; // 조각 3종 지갑 · 차 사기 (작업 B API, .debug/agents/wallet-contract.md)
import { createPartsUI } from './partsUI.js';
import * as parts from './parts.js';
import { PART_VIEW } from './partThumbs.js';
import { createGarageLift } from './garageLift.js';
import { nextRewards, rewardsBetween } from './rewardPath.js';
import { touchWanted } from './touch.js';
import { go as wheelGo } from './wheelTransition.js'; // 게임으로 갈 때 바퀴 화면 전환 (관제탑 부탁 2026-11-15)
import * as gate from './featureGate.js'; // 레벨별 기능 해금 (작업 C, 2026-11-15)
import { createCoach, lockTip, closeLockTip } from './coachMarks.js'; // 해금 안내 (코치 마크)

export const VERSION = 'v0.9 · 2026.11';
/** 운전 도움을 켜고 낸 기록 표시 */
const ASSIST_TAG = '<span class="h-assist" title="운전 도움을 켜고 낸 기록">🛟 도움</span>';
const STAT_NAMES = [['speed', '최고 속도'], ['accel', '가속'], ['handling', '핸들링'], ['grip', '접지력'], ['brake', '브레이크'], ['offroad', '험한 길'], ['boat', '배 성능']]; // 부스터는 꺼 둠 (car.json booster.enabled)

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** 차 특기 (cars.json stats의 숨은 값) → 정보 칸 아래 작은 딱지 */
const PERKS = [['offroad', 3, '잔디에 강해요'], ['boat', 3, '배가 빨라요'], ['fly', 3, '비행을 잘해요']];
/** 'LE MANS PROTO · 접지력' → ['LE MANS PROTO', '접지력'] */
const splitTag = (tag) => {
  const [en, ...ko] = String(tag || '').split('·');
  return [en.trim(), ko.join('·').trim()];
};

const TUT_KEY = 'gimmick.tutorial'; // 튜토리얼: 'asked'(권해 봄) | 'done'(끝까지 함)

export async function runHome() {
  bootMeta();
  const [allMaps, roster, carClasses] = await Promise.all([loadMaps(), loadRoster(), loadCarClasses()]);
  let cars = [];
  try {
    cars = await roster.listCars();
  } catch (e) {
    console.warn('차 목록 불러오기 실패', e);
  }
  if (!cars.length) cars = [{ id: 'f1', name: '블레이즈', tag: '경주 머신 · 균형형', desc: '', stats: {}, look: '#e8463a' }];
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
  // 차고 (2026-11-10): 레벨 잠금 + 색 고르기. 새 UI 스타일은 src/garage.css (index.html 기준 경로)
  if (!document.querySelector('link[data-garage]')) {
    const ln = document.createElement('link');
    ln.rel = 'stylesheet';
    ln.href = 'src/garage.css';
    ln.dataset.garage = '1';
    document.head.appendChild(ln);
  }
  if (!document.getElementById('acadcss')) {
    // 드라이빙 아카데미 화면 (2026-11-12, src/academy.css)
    const ln = document.createElement('link');
    ln.rel = 'stylesheet';
    ln.id = 'acadcss';
    ln.href = 'src/academy.css';
    document.head.appendChild(ln);
  }
  unlocks.registerCars(cars);
  let myLevel = unlocks.currentLevel();
  const isOpen = (id) => unlocks.isCarUnlocked(id);
  for (const c of cars) {
    c.look0 = c.look; // 원래 색
    if (c.look && typeof c.look === 'object') c.look = applyCostume(unlocks.applyPaint(c.look0, c.id), unlocks.isCostumeUnlocked(c.id, unlocks.getCostume(c.id)) ? unlocks.getCostume(c.id) : ''); // 내가 고른 색
  }
  // 잠긴 마지막 차는 준비 화면에서 안내해요.
  let garageOnly = params.get('menu') === 'car';
  let garageReturn = 'main';
  let openCarId = carId; // 마지막으로 고른 '열린' 차 (잠긴 차를 구경하다 나가면 이 차로 돌아옴)
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
        // 맵 전체를 만들지 않고 중심 곡선만으로 옛 그리드 출발을 확인.
        if (!d.pad && d.points && d.points.length >= 3) {
          const scaled = ['gp', 'sea', 'jungle'].includes(m.id) ? d.scale || 1 : 1;
          const curve = new THREE.CatmullRomCurve3(d.points.map(([x, y, z]) => new THREE.Vector3(x * scaled, y, z * scaled)), true, 'centripetal');
          curve.arcLengthDivisions = Math.max(200, d.points.length * (m.id === 'neon' ? 20 : 40));
          records.classifyLegacy(m.id, {
            length: curve.getLength(), width: d.width,
            sampleAt(t) {
              const pos = curve.getPointAt(t);
              const tan = curve.getTangentAt(t).setY(0).normalize();
              const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
              return { pos, right };
            },
          }, d.laps || 1);
        }
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
  // 레벨별 기능 해금 (설계 8장): 홈 화면에서만 잠금. 게임 주소·초대 링크는 그대로 됨
  const gateInfo = gate.initGate();
  const G = (id) => gate.isOpen(id);
  const modeOpen = (id) => G(gate.MODE_FEATURE[id] || 'play');
  if (!G('garage') && isOpen(DEFAULT_CAR)) carId = DEFAULT_CAR; // Lv1: 레드 포뮬러로 (차고가 열리면 고름)
  if (!modeOpen(raceMode)) raceMode = 'race'; // Lv1: 봇 레이스만 (방식 화면 건너뜀)

  // ------------------------------------------------------------------ 화면 틀
  const home = document.createElement('div');
  home.id = 'home';
  // 홈에서는 주행 HUD가 키보드 탐색·화면 읽기에 섞이지 않게 숨겨요.
  document.querySelectorAll('body > .hud, #menuBtn, #slingFlash, #draftLines').forEach(el => { el.style.display = 'none'; el.style.animation = 'none'; el.inert = true; });
  home.innerHTML = `
    <div class="m3-backdrop" aria-hidden="true"></div><div class="h-glow"></div><div class="h-floor"></div><div class="h-streaks"></div>
    <div class="h-top">
      <div class="h-logo"><div class="mark"><span>🏁</span></div><div><div class="name">트랜스폼 <em>레이서</em></div><div class="sub">TRANSFORM RACER</div></div></div>
      <div class="h-icons">
        <button class="mt-wallet-btn" data-act="metaShop" data-gate="shop" data-coach="home.wallet" data-nav title="조각 3종 · 상점" aria-label="내 조각 · 상점 열기"><span class="hw-chips">${CURRENCY_IDS.map((k) => `<span class="hw-c hw-${k}" style="--wc:${CURRENCIES[k].color}" title="${CURRENCIES[k].name} · ${CURRENCIES[k].use || ''}"><i>${CURRENCIES[k].icon}</i><b data-wallet="${k}">0</b></span>`).join('')}</span></button>
        <button class="gm-btn hx-driver h-name" data-act="name" data-nav title="이름 바꾸기 (레이스·순위표에 보여요)">
          <span class="hx-lic"></span><span class="hx-aclic"></span>
          <span class="hx-dinfo"><b class="nm"></b><small class="lv"></small><span class="hx-xp"><i></i></span><small class="st"></small></span>
        </button>
        <div class="hx-util">
          <button class="gm-btn hx-ico" data-go="settings" data-nav title="설정" aria-label="설정">⚙️</button>
          <button class="gm-btn hx-ico" data-go="controls" data-nav title="조작법" aria-label="조작법">🎮</button>
          <button class="gm-btn hx-ico" data-act="mute" data-nav title="소리 켜기/끄기" aria-label="소리 켜기/끄기">🔊</button>
        </div>
      </div>
    </div>
    <div class="h-view" data-view="main"></div>
    <div class="h-view" data-view="car"></div>
    <div class="h-view" data-view="map"></div>
    <div class="h-view" data-view="settings"></div>
    <div class="h-view" data-view="controls"></div>
    <div class="h-view" data-view="records"></div>
    <div class="h-view" data-view="mode"></div>
    <div class="h-view" data-view="season"></div>
    <div class="h-view" data-view="academy"></div>
    <div class="h-view" data-view="meta"></div>
    <div class="h-foot"><span>${VERSION} · 트랜스폼 레이서</span><span class="gm-hint"><span><kbd>↑↓←→</kbd> 고르기</span><span><kbd>Enter</kbd> 확인</span><span><kbd>Esc</kbd> 뒤로</span><span class="ct-foothint"><kbd>[</kbd><kbd>]</kbd> 정보 탭</span><span class="padhint" hidden>🎮 <kbd class="pad pf pf0">A</kbd> 확인 <kbd class="pad pf pf1">B</kbd> 뒤로</span></span></div>
    <div class="h-launch"><div class="ld" id="hLaunch"></div></div>
    <div class="h-toast" id="hToast"></div>`;
  document.body.appendChild(home);
  const $ = (sel) => home.querySelector(sel);
  const views = Object.fromEntries([...home.querySelectorAll('.h-view')].map((v) => [v.dataset.view, v]));
  // 해금 안내 (코치 마크): 홈 위에서만. 레벨 업 창·이름 창·확인 창·출발 중에는 기다림
  const coach = createCoach({
    toast: (t) => toast(t),
    goMain: () => {
      try { compare.close(); } catch {}
      if (view !== 'main') show('main', false);
      if (carDetail) garageDetail(false, false);
    },
    blocked: () => !!home.querySelector('.gx-news') || launching || home.classList.contains('nf-active') || dialogOpen() || !!document.querySelector('.nf'),
    onEnd: () => refreshCoachChip(),
    onStart: () => refreshCoachChip(),
  });

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
  let completedFirst = false, completedTutorial = false;
  try { completedFirst = !!localStorage.getItem('gimmick.firstComplete'); completedTutorial = localStorage.getItem(TUT_KEY) === 'done'; } catch {}
  views.main.innerHTML = `
    <div class="h-main hx hm-menu">
      <div class="hx-tagline m3-heading"><small class="m3-class">MY MACHINE</small><h1></h1><p></p></div>
      <button class="fg-chip" data-act="coachChip" data-coach="home.coachChip" data-nav hidden><i>🎓</i><span>새 안내</span></button>
      <button class="gm-btn primary h-start hx-hero" data-act="start" data-coach="home.play" data-nav>
        <span class="hx-thumb"><img alt="" draggable="false" hidden><span class="ph">🏎️</span></span>
        <span class="hx-htxt"><span class="big">플레이</span><span class="sel"></span>
          <span class="hx-chips"><i data-c="map"></i><i data-c="car"></i><i data-c="mode"></i></span></span>
        <span class="go">▶</span>
      </button>
<div class="h-menu hx-grid hm-list"><button class="gm-btn h-item hx-tile hm-garage" data-act="garage" data-gate="garage" data-coach="home.garage" data-nav><span class="ic">🚗</span><span class="t"><b>차고</b><small>차 구경 · 조립 · 꾸미기</small></span></button><button class="gm-btn h-item hx-tile hm-rewards" data-go="meta" data-gate="goals" data-coach="home.goals" data-nav><span class="ic">✦</span><span class="t"><b>업적과 목표</b><small>나의 드라이버 여정</small></span></button><button class="gm-btn h-item hx-tile hm-shop" data-act="metaShop" data-gate="shop" data-coach="home.shop" data-nav><span class="ic">⬡</span><span class="t"><b>상점</b><small>차 · 부품 · 꾸미기</small></span></button><button class="gm-btn h-item hx-tile " data-go="academy" data-coach="home.academy" data-nav><span class="ic">🎓</span><span class="t"><b>아카데미</b><small>튜토리얼 · 코너 연습 · 라이선스</small></span></button><button class="gm-btn h-item hx-tile " data-go="records" data-gate="records" data-coach="home.records" data-nav><span class="ic">🏆</span><span class="t"><b>기록과 순위</b><small>내 최고 기록 · 세계 순위</small></span></button><button class="gm-btn h-item hx-tile " data-act="multi" data-gate="online" data-coach="home.online" data-nav><span class="ic">🌐</span><span class="t"><b>온라인</b><small>방 코드로 친구와 함께</small></span></button></div>
    </div>
    <div class="h-cartag"><div class="tg"></div><div class="n"></div></div>`;

  // ------------------------------------------------------------------ 차 고르기
  // 정보 칸 탭 (cartabs 2026-11-15). 부품 조립이 생기면 여기에 { id: 'parts', icon: '🔧', label: '조립' }을
  // 'custom' 앞에 넣고 아래 .ct-body에 같은 id의 <section class="ct-pane" data-pane="parts">를 두면 됨 (탭 4개도 한 줄)
  const CAR_TAB_DEFS = [
    { id: 'info', icon: '📝', label: '소개' },
    { id: 'stats', icon: '📊', label: '성능' },
    { id: 'parts', icon: '🔧', label: '조립' },
    { id: 'custom', icon: '🎨', label: '커스텀' },
  ];
  views.car.innerHTML = `
    <div class="h-car g2-list">
      <div class="h-panel h-carlist"><div class="h-title"><span class="p3-eyebrow">READY TO RACE</span>나의 차고 · <span class="cnt">${cars.length}대</span>${useClasses ? '<span class="h-qe"><kbd>Q</kbd><kbd>E</kbd> 등급</span>' : ''}</div><button class="gm-btn hm-catalog-home" data-go="main" data-nav hidden>‹ 홈으로</button><div class="h-classtabs"></div>
        <div class="cx-tools"><label class="cx-find"><input type="search" spellcheck="false" autocomplete="off" placeholder="차 이름 찾기" aria-label="차 이름 찾기"></label>
          <select class="cx-sort" aria-label="정렬"><option value="class">등급별</option><option value="speed">최고 속도 순</option><option value="accel">가속 순</option><option value="handling">핸들링 순</option><option value="grip">접지력 순</option><option value="name">이름 순</option><option value="unlock">해금 레벨 순</option></select>
          <button class="cx-btn cx-dense" type="button" title="작게 보기 / 크게 보기">▦</button></div>
        <div class="list"></div><footer class="p3-catalogbar"><span>선택은 다음 화면에서도 바꿀 수 있어요</span><button class="gm-btn primary" data-act="carDetail" data-nav>선택한 차 상세 보기 ›</button></footer></div>
      <div class="h-carstage"><div class="g2-stagebar"><button class="gm-btn" data-act="carList" data-nav>‹ 차 목록</button><button class="gm-btn" data-act="carCompare" data-coach="garage.compareDetail" data-nav>⚖ 비교</button><button class="gm-btn" data-act="carFront" data-nav>정면으로</button></div>
        <div class="h-drag">↔ 끌어서 돌려 보기</div>
        
        <div class="gm-seg" id="hForms" title="자동 변신 모습 미리 보기">
          <button data-mode="normal" class="on">🚗 일반</button><button data-mode="accel">🔥 가속</button><button data-mode="boat">🚤 배</button><button data-mode="fly">✈️ 비행</button>
        </div>
        
      </div>
      <div class="h-panel h-carinfo ct">
        <!-- 정보 칸 탭 (사용자 요청 2026-11-15 "설명 칸이 길어서 커스텀이 있는지 모름"): 위 = 이름, 가운데 = 소개 · 성능 · 커스텀 탭, 아래 = 버튼 -->
        <div class="ct-head">
          <div class="ihead"><div class="h-classchip"></div><div class="tg"></div><span class="num"></span></div>
          <h2></h2>
        </div>
        <div class="ct-tabs" role="tablist" aria-label="차 정보" title="키보드 [ ] · 패드 LT / RT 로도 바꿀 수 있어요">
          ${CAR_TAB_DEFS.map((t) => `<button type="button" role="tab" class="ct-tab ct-${t.id}" data-ct="${t.id}" data-coach="garage.tab.${t.id}"${t.id === 'parts' ? ' data-gate="parts"' : ''} id="ctTab-${t.id}" aria-controls="ctPane-${t.id}" data-nav><span>${t.label}</span><b class="ct-badge"></b></button>`).join('')}
        </div>
        <div class="ct-body">
          <section class="ct-pane" data-pane="info" id="ctPane-info" role="tabpanel" aria-labelledby="ctTab-info">
            <div class="gx-locknote" hidden></div>
            <p class="desc"></p>
            <div class="h-perks"></div>
            <div class="ct-classnote"></div>
            <div class="ct-jump">
              <button type="button" class="gm-btn ct-jumpbtn" data-ctgo="stats" data-nav><span><b>성능 보기</b><small class="ct-jstats"></small></span><em>›</em></button>
              <button type="button" class="gm-btn ct-jumpbtn" data-ctgo="custom" data-nav><span><b>꾸미기</b><small class="ct-jcustom"></small></span><em>›</em></button>
            </div>
            <div class="gx-nextline"></div>
          </section>
          <section class="ct-pane" data-pane="stats" id="ctPane-stats" role="tabpanel" aria-labelledby="ctTab-stats" hidden>
            <div class="ct-statbox">
              <div class="ns-heading"><b>퍼포먼스 <small>100점 기준</small></b><button class="gm-btn small ns-compare" type="button" data-nav>⚖ 비교하기</button></div>
              <div class="h-stats"></div>
              <details class="ns-method"><summary>평지 예상 성능 · 점수는 어떻게 정했나요?</summary><p>21대의 실제 설정을 같은 조건으로 계산한 상대 점수예요. 숫자가 클수록 해당 성능이 좋아요. 최고 속도·0→100·제동 거리는 평지 계산 예상치이며 실제 주행 기록과 달라요. 가속 변신을 포함하며 부스터·견인은 제외해요.</p><p>핸들링은 조향·키 입력·회전 반응, 접지력은 150 km/h에서 버티는 힘과 차를 누르는 힘, 험한 길은 잔디 속도·접지 유지율, 배는 추진력·물 저항을 반영해요.</p></details>
            </div>
          </section>
          <section class="ct-pane" data-pane="parts" id="ctPane-parts" role="tabpanel" aria-labelledby="ctTab-parts" hidden></section>
          <section class="ct-pane" data-pane="custom" id="ctPane-custom" role="tabpanel" aria-labelledby="ctTab-custom" hidden>
            <div class="ct-locknote" hidden></div>
            <div class="gx-paint" data-coach="garage.paint"><div class="gx-ptitle">색 바꾸기 <small></small></div><div class="gx-swatches"></div></div>
            <div class="mt-costume-box" data-coach="garage.costumes"></div><div class="fg-costlock" hidden></div>
          </section>
        </div>
        <div class="btns"><button class="gm-btn" data-go="mode" data-nav>‹ 레이스 방식</button><button class="gm-btn primary" data-act="pickCar" data-nav>다음: 맵 고르기 ›</button></div>
      </div>
    </div>`;
  let carDetail = false;
  function garageDetail(detail, focus = true) {
    carDetail = detail;
    views.car.querySelector('.h-car').classList.toggle('g2-list', !detail);
    views.car.querySelector('.h-car').classList.toggle('g2-detail', detail);
    home.classList.toggle('g2-catalog', view === 'car' && !detail);
    preview.setView(view);
    requestAnimationFrame(() => { if (view === 'car') { startThumbs(); if (detail && carTab === 'custom') costumePicker.refresh(); else costumePicker.suspend(); } });
    if (focus) (detail ? views.car.querySelector('[data-act=pickCar]') : views.car.querySelector('.h-carcard.sel'))?.focus({preventScroll:true});
  }
  const costumePicker = createCostumePicker(views.car.querySelector('.mt-costume-box'), {
    onPreview(look) { const mode = views.car.querySelector('#hForms button.on')?.dataset.mode; preview.setCar({ ...carOf(carId), look }); if (mode) preview.setMode(mode); },
    onEquipped(look) { const c = carOf(carId); c.look = look; preview.setCar(c); loadCarThumbs([c], { onThumb: putThumb }); heroThumb(); }, toast,
  });
  // 정보 칸 탭: 소개 / 성능 / 커스텀 (마지막에 본 탭 기억 'gimmick.carTab'; 키보드 [ ] · 패드 LT/RT · 탭 위에서 ←→)
  const partsUI = createPartsUI(views.car.querySelector('[data-pane="parts"]'), {viewSlot: slot => { const mode=slot==='water'?'boat':'normal';preview.setMode(mode);views.car.querySelectorAll('#hForms button').forEach(b=>b.classList.toggle('on',b.dataset.mode===mode)); }, preview: b => preview.setParts?.(b), animate: (b, slot) => preview.replacePart?.(b,slot)});
  const CAR_TABS = CAR_TAB_DEFS.map((t) => t.id);
  let carTab = 'info';
  try {
    const t = new URLSearchParams(location.search).get('carTab') || localStorage.getItem('gimmick.carTab');
    if (CAR_TABS.includes(t)) carTab = t;
  } catch {}
  const carInfoEl = views.car.querySelector('.h-carinfo');
  function setCarTab(id, { focus = false, sound = false, save = true } = {}) {
    if (!CAR_TABS.includes(id)) id = 'info';
    if (id === 'parts' && !G('parts')) id = 'info'; // 부품 조립은 Lv3부터 (탭은 잠금 표시)
    const changed = id !== carTab;
    carTab = id;
    carInfoEl.dataset.tab = id;
    carInfoEl.querySelectorAll('.ct-tab').forEach((b) => {
      const on = b.dataset.ct === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    carInfoEl.querySelectorAll('.ct-pane').forEach((p) => (p.hidden = p.dataset.pane !== id));
    const body = carInfoEl.querySelector('.ct-body');
    if (changed) body.scrollTop = 0;
    if (id !== 'parts') preview.setParts?.(parts.getBuild(carId));
    if (id === 'parts') {partsUI.show(carOf(carId),isOpen(carId));partsUI.activate();}
    if (id === 'custom') costumePicker.refresh();
    if (id !== 'custom' && changed) { costumePicker.restore(); costumePicker.refresh(); } // 코스튬 미리 보기 중에 다른 탭으로 가면 입은 모습으로
    if (save) try { localStorage.setItem('gimmick.carTab', id); } catch {}
    if (sound && changed) uiSound('toggle');
    if (focus) carInfoEl.querySelector(`.ct-tab[data-ct="${id}"]`)?.focus({ preventScroll: true });
  }
  function stepCarTab(dir, focus = false, arrow = false) {
    // partslock 2026-11-15: [ ] = 잠긴 조립 탭 건너뜀, 탭 위 ←→ = 잠긴 조립 탭에 멈추고 말풍선만 (들어가지 않음)
    if (arrow) {
      const from = document.activeElement?.dataset?.ct;
      const i = CAR_TABS.indexOf(CAR_TABS.includes(from) ? from : carTab);
      const next = CAR_TABS[(i + dir + CAR_TABS.length) % CAR_TABS.length];
      if (next === 'parts' && !G('parts')) {
        const b = carInfoEl.querySelector('.ct-tab.ct-parts');
        if (b) { b.focus({ preventScroll: true }); uiSound('back'); lockTip(b, 'parts', { host: home, onRace: () => show(playView()) }); }
        return;
      }
      closeLockTip();
      setCarTab(next, { focus, sound: true });
      return;
    }
    const tabs = CAR_TABS.filter((t) => t !== 'parts' || G('parts'));
    const i = tabs.indexOf(carTab);
    setCarTab(tabs[(i + dir + tabs.length) % tabs.length], { focus, sound: true });
  }
  carInfoEl.addEventListener('click', (e) => {
    const t = e.target.closest('.ct-tab, [data-ctgo]');
    if (!t) return;
    setCarTab(t.dataset.ct || t.dataset.ctgo, { sound: true, focus: !!t.dataset.ctgo });
  });
  const metaPage = createMetaPage(views.meta, {cars, carId: () => carId});
  const carList = views.car.querySelector('.list');
  const tabsEl = views.car.querySelector('.h-classtabs');
  if (cars.length > 8) views.car.querySelector('.h-carlist').classList.add('compact'); // 차가 많으면 카드를 작게
  // 등급 탭: 전체 + 등급마다 (차가 있는 등급만). 차가 등급 없이 있으면 '기타'
  let classFilter = 'all';
  const classTabs = useClasses
    ? [{ id: 'all', name: '전체', color: '#ffffff' }, ...classes.filter((k) => cars.some((c) => c.class === k.id)).sort((a,b) => a.id.localeCompare(b.id)), ...(cars.some((c) => !classOfId(c.class)) ? [{ id: '_etc', name: '기타', color: '#95a2bb' }] : [])]
    : [];
  const inTab = (c, tab) => tab === 'all' || (tab === '_etc' ? !classOfId(c.class) : c.class === tab);
  const classMeaning = { all: '모든 스타일', C: '입문용', B: '균형 잡힌 성능', A: '최고 속도에 도전' };
  if (classTabs.length) {
    tabsEl.innerHTML = classTabs
      .map((k) => `<button class="h-ctab" data-ctab="${esc(k.id)}" style="--cc:${esc(k.color || '#ffcf3f')}" title="${esc(k.desc || '')}"><span class="nc-copy"><b>${esc(k.id === 'all' ? '전체' : k.name.replace(/^[ABC]\s*/, ''))}</b><em>${esc(classMeaning[k.id] || '다른 스타일')}</em></span><small>${cars.filter((c) => inTab(c, k.id)).length}대</small></button>`)
      .join('');
    tabsEl.insertAdjacentHTML('afterend', '<div class="nm-classhelp" aria-live="polite"></div>');
    tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.h-ctab');
      if (b) setClassTab(b.dataset.ctab, true);
    });
  } else tabsEl.remove();
  // 차가 많아져도 (사용자 요청 2026-11-11): 이름 찾기 · 정렬 · 탈 수 있는 차만 · 작게 보기 (localStorage 'gimmick.carList')
  const cx = (() => {
    try {
      return { find: '', sort: 'class', open: false, dense: cars.length > 24, ...JSON.parse(localStorage.getItem('gimmick.carList') || '{}'), find: '', open: false }; // 잠긴 차도 늘 보임 (사용자 요청 2026-11-11)
    } catch {
      return { find: '', sort: 'class', open: false, dense: cars.length > 24 };
    }
  })();
  const saveCx = () => {
    try {
      localStorage.setItem('gimmick.carList', JSON.stringify({ sort: cx.sort, open: cx.open, dense: cx.dense }));
    } catch {}
  };
  const cxTools = views.car.querySelector('.cx-tools');
  const cxFind = cxTools.querySelector('input');
  const cxSort = cxTools.querySelector('.cx-sort');
  const cxDenseBtn = cxTools.querySelector('.cx-dense');
  const carListBox = views.car.querySelector('.h-carlist');
  function syncCxTools() {
    cxSort.value = cx.sort;
    cxDenseBtn.classList.toggle('on', cx.dense);
    carListBox.classList.toggle('dense', cx.dense);
  }
  const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');
  /** 찾기 · 열린 차만 거른 차 목록 */
  function cxMatch(c) {
    if (cx.open && !isOpen(c.id)) return false;
    if (!cx.find) return true;
    const k = classOfId(c.class);
    return norm(`${c.name} ${c.tag || ''} ${c.id} ${k ? k.name : ''}`).includes(norm(cx.find));
  }
  const STAT_SORT = { speed: 1, accel: 1, handling: 1, grip: 1 };
  function cxSorted(list) {
    const a = list.slice();
    if (STAT_SORT[cx.sort]) a.sort((x, y) => statScore(y.stats, cx.sort) - statScore(x.stats, cx.sort));
    else if (cx.sort === 'name') a.sort((x, y) => x.name.localeCompare(y.name, 'ko'));
    else if (cx.sort === 'unlock') a.sort((x, y) => (x.unlockLevel || 0) - (y.unlockLevel || 0));
    return a; // 'class' = cars.json 순서 (등급 묶음은 아래에서)
  }
  cxFind.addEventListener('input', () => {
    cx.find = cxFind.value.trim();
    renderCarList();
  });
  cxFind.addEventListener('keydown', (e) => {
    // 찾기 칸: Enter·↓ = 첫 카드로, Esc = 지우고 고른 차로
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const first = carList.querySelector('.h-carcard');
      if (first) first.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cxFind.value = '';
      cx.find = '';
      renderCarList();
      const card = carList.querySelector('.h-carcard.sel') || carList.querySelector('.h-carcard');
      if (card) card.focus();
    }
  });
  cxSort.addEventListener('change', () => {
    cx.sort = cxSort.value;
    saveCx();
    renderCarList();
    uiSound('toggle');
  });
  cxDenseBtn.addEventListener('click', () => {
    cx.dense = !cx.dense;
    saveCx();
    syncCxTools();
    uiSound('toggle');
  });
  syncCxTools();
  function renderCarList() {
    carList.innerHTML = '';
    const grouped = false; // G1: 등급은 카드 딱지로, 목록은 끊김 없는 네 열
    const groups = grouped ? classTabs.filter((k) => k.id !== 'all') : [null];
    let shown = 0;
    for (const g of groups) {
      const list = cxSorted(cars.filter((c) => (g ? inTab(c, g.id) : inTab(c, classFilter)) && cxMatch(c)));
      if (!list.length) continue;
      shown += list.length;
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
        const locked = !isOpen(c.id);
        const st = carState(c.id); // 레벨이 됐는데 안 산 차 = ⬡ 가격 딱지, 아직이면 🔒 Lv.n
        const priceT = st.price.toLocaleString('ko-KR');
        btn.innerHTML = `<span class="pic">${url ? `<img src="${url}" alt="" draggable="false">` : '<span class="ph"></span>'}${k ? `<i class="cl">${esc(k.name.replace(/^[ABC]\s*/, ''))}</i>` : ''}<span class="chk">✓</span>${locked ? (st.buy ? `<span class="gx-lock gx-buy" title="⬡ ${priceT} 피트 조각으로 살 수 있어요 · 눌러서 보기">⬡ ${priceT}</span>` : `<span class="gx-lock" title="레벨 ${st.level}부터 살 수 있어요 · 눌러서 미리 보기">🔒 Lv.${st.level}</span>`) : '<span class="p3-owned">보유</span>'}</span><span class="nm"><b>${esc(c.name)}</b><small>${esc(locked ? (st.buy ? `⬡ ${priceT} 구매` : `Lv.${st.level}부터`) : ko || en)}</small></span>`;
        btn.classList.toggle('gx-locked', locked);
        btn.classList.toggle('sel', c.id === carId);
        btn.addEventListener('click', () => { selectCar(c.id, true); garageDetail(true); });

        btn.addEventListener('focus', () => selectCar(c.id));
        const tile = document.createElement('div');
        tile.className = 'cp-tile';
        const quick = document.createElement('button');
        quick.type = 'button'; quick.className = 'gm-btn cp-quick'; quick.dataset.nav = '';
        quick.textContent = '⚖'; quick.title = c.name + ' 비교하기'; quick.setAttribute('aria-label', c.name + ' 비교하기');
        quick.addEventListener('click', () => compare.open(c.id));
        tile.append(btn, quick); carList.appendChild(tile);
      }
    }
    markCoachCar();
    const filtered = cx.find || cx.open;
    views.car.querySelector('.h-title .cnt').textContent = filtered || classFilter !== 'all' ? `${shown} / ${cars.length}대` : `${cars.length}대`;
    if (!shown) {
      const e = document.createElement('div');
      e.className = 'cx-empty';
      e.textContent = cx.find ? `'${cx.find}'에 맞는 차가 없어요` : '이 등급에는 차가 없어요';
      carList.appendChild(e);
    }
    requestAnimationFrame(() => { if (view === 'car') startThumbs(); });
  }
  /** 안내 이름표: 지금 고른 차 카드 = garage.card, 그 옆 ⚖ = garage.compare */
  function markCoachCar() {
    for (const el of carList.querySelectorAll('[data-coach]')) el.removeAttribute('data-coach');
    const card = carList.querySelector('.h-carcard.sel') || carList.querySelector('.h-carcard');
    if (!card) return;
    card.dataset.coach = 'garage.card';
    const q = card.parentElement && card.parentElement.querySelector('.cp-quick');
    if (q) q.dataset.coach = 'garage.compare';
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
    compare.updateThumb(id, url);
    if (id === carId) { setTimeout(heroThumb, 0); for (const card of home.querySelectorAll('.f3-ride')) { const ph = card.querySelector('.f3-photo'); if(ph) { const im = new Image(); im.alt=''; ph.replaceWith(im); } card.querySelector('img').src=url; } }
    // 기록 화면(순위표·기록 카드)에서 사진을 기다리던 자리
    for (const ph of views.records.querySelectorAll(`.ph[data-car="${id}"]`)) {
      const im = new Image();
      im.alt = '';
      im.src = url;
      if (ph.classList.contains('big')) im.className = 'big';
      ph.replaceWith(im);
    }
    for (const pic of carList.querySelectorAll(`.h-carcard[data-car="${id}"] .pic`)) {
      const old = pic.querySelector('img');
      if (old) {
        if (old.getAttribute('src') !== url) old.src = url; // 색을 바꾸면 사진도 바뀜
        continue;
      }
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
  let thumbJob = null, thumbScope = '';
  const startThumbs = () => {
    // M3 메인은 3D 차만 보임. 목록 밖에서는 지금 탈 차 사진만 준비.
    if (view === 'main' || document.hidden) return;
    let wanted = view === 'records' ? cars : [carOf(carId)];
    if (view === 'car' && !carDetail) {
      const box = carList.getBoundingClientRect();
      const ids = new Set([carId]);
      for (const card of carList.querySelectorAll('.h-carcard')) {
        const r = card.getBoundingClientRect();
        if (r.bottom > Math.max(0,box.top) && r.top < Math.min(innerHeight,box.bottom) && r.right > box.left && r.left < box.right) ids.add(card.dataset.car);
      }
      wanted = cars.filter(c => ids.has(c.id));
    }
    const scope = wanted.map(c => c.id).join('|');
    if (thumbJob && thumbScope === scope) return;
    thumbJob?.cancel();
    thumbScope = scope;
    thumbJob = loadCarThumbs(wanted, { first: carId, onThumb: putThumb, channel:'home' });
    thumbJob.done.then((st) => window.home && (window.home.thumbStats = st)).catch((e) => console.warn('차 사진', e));
  };
  let thumbScrollTimer;
  const scheduleThumbs = () => { clearTimeout(thumbScrollTimer); if (view === 'car' && !carDetail) { thumbJob?.cancel(); thumbJob = null; thumbScope = ''; } thumbScrollTimer = setTimeout(startThumbs, 500); };
  carList.addEventListener('scroll', scheduleThumbs, {passive:true});
  addEventListener('resize', () => { if (view === 'car') scheduleThumbs(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { thumbJob?.cancel(); thumbJob = null; thumbScope = ''; costumePicker.suspend(); }
    else { startThumbs(); if (view === 'car' && carDetail && carTab === 'custom') costumePicker.refresh(); }
  });
  function setClassTab(id, sound = false) {
    if (!classTabs.some((k) => k.id === id)) id = 'all';
    classFilter = id;
    const help = views.car.querySelector('.nm-classhelp');
    if (help) help.textContent = (classMeaning[id] || '다른 스타일') + ' · ' + cars.filter(c => inTab(c,id)).length + '대';
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

  const metricLabel = (c, k) => {
    const m = c.stats?.metrics;
    if (!m) return '';
    return ({ speed: m.topKmh + ' km/h', accel: '0→100 · ' + m.zero100Sec.toFixed(2) + '초', handling: '방향 전환 반응', grip: m.lateral150 + ' m/s² · 150 km/h', brake: '100→0 · 약 ' + m.brake100M + ' m', offroad: '잔디 속도 ' + m.offroadKeep + '% 유지', boat: '약 ' + m.boatKmh + ' km/h' })[k] || '';
  };
  function renderStats(c) {
    const info = views.car.querySelector('.h-carinfo');
    views.car.querySelector('.hm-catalog-home').hidden = false;
    const btn = info.querySelector('.ns-compare');
    btn.textContent = '⚖ 비교하기';
    btn.setAttribute('aria-haspopup', 'dialog');
    info.querySelector('.h-stats').innerHTML = STAT_NAMES.map(([k, label]) => {
      const v = statScore(c.stats, k);
      return '<div class="h-stat ns-stat' + (v >= 85 ? ' top' : '') + '"><span class="ns-label">' + label + '<small>' + esc(metricLabel(c, k)) + '</small></span><span class="bar" role="meter" aria-label="' + label + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + v + '"><i class="on" style="width:' + v + '%"></i></span><span class="v">' + v + '</span></div>';
    }).join('');
  }
  const compare = createCarCompare({ host: home, cars, classOf: classOfId, isOpen,
    onPick(id) { selectCar(id, true); nextCar(); },
    onVisibility(open) { preview.setView(open ? 'compare' : view); },
  });
  views.car.querySelector('.ns-compare').addEventListener('click', () => compare.open(carId));

  function selectCar(id, sound = false) {
    if (id === carId && preview.carId === id) return;
    carId = id;
    const c = carOf(id);
    if (sound) uiSound('move');
    views.car.querySelectorAll('.h-carcard').forEach((b) => b.classList.toggle('sel', b.dataset.car === id));
    markCoachCar();
    const info = views.car.querySelector('.h-carinfo');
    info.querySelector('.tg').textContent = c.tag || '';
    const k = classOfId(c.class);
    const chip = info.querySelector('.h-classchip');
    chip.style.display = k ? '' : 'none';
    const cc = (k && k.color) || '#ffcf3f';
    info.style.setProperty('--cc', cc); // 정보 칸 막대·테두리 = 등급 색
    home.style.setProperty('--carc', cc); // 뒤쪽 큰 글자·빛 번짐 = 등급 색
    if (k) chip.innerHTML = `<b>${esc(k.name.replace(/^[ABC]\s*/, ''))}</b>${k.desc ? `<span>${esc(k.desc)}</span>` : ''}`;
    const num = c.look && typeof c.look === 'object' && c.look.number != null ? String(c.look.number) : '';
    info.querySelector('.num').textContent = num ? `#${num}` : '';
    info.querySelector('h2').textContent = c.name;
    info.querySelector('.desc').textContent = c.desc || '';
    renderStats(c);
    const perks = PERKS.filter(([key, min]) => c.stats?.score100?.[key] != null ? statScore(c.stats, key) >= 75 : ((c.stats && c.stats[key]) || 0) >= min);
    const perkEl = info.querySelector('.h-perks');
    perkEl.innerHTML = perks.map(([, , t]) => `<span>${t}</span>`).join('');
    perkEl.hidden = !perks.length;
    // 소개 탭: 등급 설명 + 성능·꾸미기 바로 가기 (숫자는 성능 탭 상자에만)
    const cnote = info.querySelector('.ct-classnote');
    cnote.hidden = !(k && k.desc);
    if (k && k.desc) cnote.innerHTML = `<span><b>${esc(k.name.replace(/^[ABC]\s*/, ''))}</b>${esc(k.desc)}</span>`;
    const best = STAT_NAMES.map(([key, label]) => [statScore(c.stats, key), label]).sort((a, b) => b[0] - a[0]).slice(0, 2).map((x) => x[1]);
    info.querySelector('.ct-jstats').textContent = best.length ? `강점 ${best.join(' · ')}` : '8가지 성능 점수';
    carMark.textContent = splitTag(c.tag)[0] || c.name;
    carMarkBox.classList.remove('in');
    void carMarkBox.offsetWidth; // 글자가 바뀔 때마다 다시 스르륵
    carMarkBox.classList.add('in');
    if (thumbJob) thumbJob.prioritize(id);
    views.car.querySelectorAll('#hForms button').forEach((x) => x.classList.toggle('on', x.dataset.mode === 'normal'));
    preview.setCar(c);
    refreshSummary();
    const open = isOpen(id);
    if (open) {
      openCarId = id;
      setLast({ car: id });
    }
    showGarage(c, open);
    partsUI.show(c, open);
    preview.setParts?.(parts.getBuild(c.id));
  }
  /** 차 상태 (재화 개편): owned 가짐 / buy 레벨이 돼서 ⬡로 살 수 있음 (short = 모자란 조각) / 아니면 level까지 잠김 */
  function carState(id) {
    const owned = isOpen(id), level = unlocks.carUnlockLevel(id), price = unlocks.carPrice(id);
    const buy = !owned && unlocks.canBuyCar(id, myLevel);
    const have = walletNow().pit || 0;
    return { owned, buy, level, price, have, short: buy ? Math.max(0, price - have) : 0 };
  }
  /** [⬡ n 으로 사기]: 확인 창 → meta.buyCar → 열리면 토스트·목록·사진 다시 */
  async function buyCarFlow(id = carId) {
    const c = carOf(id), st = carState(id);
    if (st.owned) return true;
    if (!st.buy) { uiSound('back'); toast(`🔒 ${c.name} · 레벨 ${st.level}부터 살 수 있어요 (지금 Lv.${myLevel})`); return false; }
    if (st.short) { uiSound('back'); toast(`⬡ ${st.short.toLocaleString('ko-KR')} 피트 조각이 부족해요 · 레이스·목표·아카데미에서 모아요`); return false; }
    if (!(await confirmDialog(`${c.name} 사기`, `⬡ ${st.price.toLocaleString('ko-KR')} 피트 조각으로 살까요? (지금 ⬡ ${st.have.toLocaleString('ko-KR')})`, '사기'))) return false;
    const r = buyCar(id);
    if (!r || !r.ok) { toast((r && r.message) || '차를 사지 못했어요'); return false; }
    uiSound('select');
    toast(`🚗 ${c.name}을(를) 샀어요! 이제 탈 수 있어요`);
    openCarId = id;
    setLast({ car: id });
    renderCarList();
    selectCar(id);
    showGarage(c, true);
    partsUI.show(c, true);
    refreshMetaHome();
    return true;
  }
  /** 차 정보 칸의 잠금 안내 + 색 고르기 줄 */
  function showGarage(c, open = isOpen(c.id)) {
    views.car.querySelector('.hm-catalog-home').hidden = false;
    const info = views.car.querySelector('.h-carinfo');
    const note = info.querySelector('.gx-locknote');
    note.hidden = open;
    // 재화 개편 (작업 B): 차 = 레벨 + ⬡ 피트 조각. 레벨이 됐는데 안 산 차 = [⬡ n 으로 사기], 아직이면 🔒 Lv.n
    const st = carState(c.id);
    if (!open) note.innerHTML = st.buy
      ? `<b>⬡ ${st.price.toLocaleString('ko-KR')} 으로 살 수 있어요</b><span>👀 디자인 미리 보기 중 · 끌어서 돌려 보고 변신 모습도 볼 수 있어요</span><button class="gm-btn primary gx-buycar" data-act="buyCar" data-nav>${st.short ? `⬡ ${st.short.toLocaleString('ko-KR')} 부족 · 가격 ${st.price.toLocaleString('ko-KR')}` : `⬡ ${st.price.toLocaleString('ko-KR')} 으로 사기`}</button>`
      : `<b>🔒 레벨 ${st.level}에 살 수 있어요</b><span>👀 디자인 미리 보기 중 · 끌어서 돌려 보고 아래 버튼으로 변신 모습도 볼 수 있어요</span><span>지금 Lv.${myLevel} · 레벨 ${st.level}이 되면 ⬡ ${st.price.toLocaleString('ko-KR')} 피트 조각으로 사요</span>`;
    const pick = info.querySelector('[data-act="pickCar"]');
    pick.classList.toggle('gx-off', !open && !garageOnly && !st.buy);
    pick.disabled = !open && !garageOnly && !st.buy;
    info.querySelector('.btns [data-go]').hidden = false;
    info.querySelector('.btns [data-go]').dataset.go = garageReturn;
    info.querySelector('.btns [data-go]').textContent = garageReturn === 'main' ? '‹ 홈' : '‹ 맵';
    pick.textContent = garageOnly ? '이 차로 선택하기 ✓' : open ? '이 차로 선택하기 ✓' : st.buy ? `⬡ ${st.price.toLocaleString('ko-KR')} 으로 사기` : `🔒 Lv.${st.level}에 살 수 있어요`;
    const box = info.querySelector('.gx-paint');
    const canPaint = open && c.look0 && typeof c.look0 === 'object';
    box.hidden = !canPaint;
    if (canPaint) {
      const cur = unlocks.getPaint(c.id);
      box.querySelector('.gx-ptitle small').textContent = unlocks.paintOf(cur).name;
      box.querySelector('.gx-swatches').innerHTML = unlocks.PAINTS.map((p) => {
        const ok = unlocks.isPaintUnlocked(p.id);
        const buy = !ok && unlocks.canBuyPaint(p.id, myLevel); // 레벨이 된 색 = ✿ 커스텀 조각으로 삼
        const body = p.body || c.look0.body || '#e8463a', acc = p.accent || c.look0.accent || '#f3f4f6';
        return `<button type="button" data-nav class="gx-sw${p.id === cur ? ' on' : ''}${ok ? '' : ' lock'}${buy ? ' buy' : ''}" data-paint="${p.id}" style="--pb:${esc(body)};--pa:${esc(acc)}" title="${esc(p.name)}${ok ? '' : p.license ? ` · 드라이빙 아카데미 ${esc(unlocks.paintLockText(p.id))}로 열려요` : buy ? ` · ✿ ${paintPrice(p)} 커스텀 조각으로 사요` : ` · 레벨 ${p.level}에 살 수 있어요`}" aria-label="${esc(p.name)}">${ok ? '' : `<i>${p.license ? '🎓' : buy ? '✿' : '🔒'}</i><small>${p.license ? esc(p.license) : buy ? paintPrice(p) : `Lv.${p.level}`}</small>`}</button>`;
      }).join('');
    }
    costumePicker.show(c);
    // 커스텀 탭: 처음부터 무엇이 있는지 보이게 (탭 딱지 + 소개 탭 바로 가기 글)
    const nCos = listCostumes(c.id).length;
    const nPaint = unlocks.PAINTS.length;
    const cosOpen = G('custom'); // 코스튬은 Lv4부터 (색은 차고와 같이 Lv2)
    const cosLock = info.querySelector('.fg-costlock');
    cosLock.hidden = cosOpen || !nCos;
    if (!cosOpen) cosLock.innerHTML = `<b>${gate.lockText('custom')}</b> · 코스튬 ${nCos}개로 차를 꾸밀 수 있어요`;
    info.querySelector('.ct-tab.ct-custom .ct-badge').textContent = nCos && cosOpen ? `✦${nCos}` : `${nPaint}색`;
    info.querySelector('.ct-tab.ct-custom').title = `커스텀 · 코스튬 ${nCos}개 · 색 ${nPaint}가지`;
    info.querySelector('.ct-jcustom').textContent = nCos ? `코스튬 ${nCos}개 · 색 ${nPaint}가지` : `색 ${nPaint}가지`;
    const cl = info.querySelector('.ct-locknote');
    cl.hidden = open;
    if (!open) cl.innerHTML = `<b>${st.buy ? `⬡ ${st.price.toLocaleString('ko-KR')} 으로 살 수 있는 차` : `🔒 레벨 ${st.level}에 살 수 있는 차`}</b><span>코스튬은 지금도 눌러서 미리 볼 수 있어요 · 색은 차를 사면 바꿀 수 있어요</span>`;
    const nx = unlocks.nextUnlock(myLevel);
    const line = info.querySelector('.gx-nextline');
    line.hidden = !nx || !open; // 잠긴 차는 위 안내가 대신 말해 줌
    if (nx) line.textContent = `다음 해금 · Lv.${nx.level} ${nx.text}`;
  }
  /** 색 고르기: 저장하고 미리보기·사진을 새 색으로 */
  async function pickPaint(pid) {
    const c = carOf(carId);
    const p = unlocks.paintOf(pid);
    if (!unlocks.isPaintUnlocked(p.id)) {
      // 색 = ✿ 커스텀 조각으로 삼 (작업 B 재화 개편). 레벨이 안 됐거나 라이선스 색이면 안내만
      if (unlocks.canBuyPaint(p.id, myLevel)) {
        const price = paintPrice(p), have = walletNow().custom || 0;
        if (have < price) { uiSound('back'); return toast(`✿ ${(price - have).toLocaleString('ko-KR')} 커스텀 조각이 부족해요 · '${p.name}' 가격 ✿ ${price}`); }
        if (!(await confirmDialog(`'${p.name}' 색 사기`, `✿ ${price} 커스텀 조각으로 사면 모든 차에 쓸 수 있어요. (지금 ✿ ${have.toLocaleString('ko-KR')})`, '사기'))) return;
        const r = meta.buy('paint', p);
        if (!r.ok) return toast(r.message);
        toast(`🎨 '${p.name}' 색을 샀어요`);
      } else {
        uiSound('back');
        return toast(p.license ? `🎓 '${p.name}' 색은 드라이빙 아카데미 ${unlocks.paintLockText(p.id)} 시험에 붙으면 열려요` : `🔒 '${p.name}' 색은 레벨 ${p.level}부터 ✿ ${paintPrice(p)} 커스텀 조각으로 살 수 있어요 (지금 Lv.${myLevel})`);
      }
    }
    unlocks.setPaint(c.id, p.id);
    c.look = applyCostume(unlocks.applyPaint(c.look0, c.id), unlocks.getCostume(c.id));
    uiSound('toggle');
    const mode = views.car.querySelector('#hForms button.on');
    preview.setCar(c);
    if (mode && mode.dataset.mode !== 'normal') preview.setMode(mode.dataset.mode);
    showGarage(c);
    loadCarThumbs([c], { onThumb: putThumb }); // 사진 다시 찍기
  }
  views.car.addEventListener('click', (e) => {
    const sw = e.target.closest('.gx-sw');
    if (sw) pickPaint(Number(sw.dataset.paint));
  });
  function stepCar(dir) {
    const list = visibleCars().length ? visibleCars() : cars;
    const i = list.findIndex((c) => c.id === carId);
    const next = list[(i + dir + list.length) % list.length];
    selectCar(next.id, true);
    const card = views.car.querySelector(`.h-carcard[data-car="${next.id}"]`);
    if (card && document.activeElement && document.activeElement.classList.contains('h-carcard')) card.focus({ preventScroll: false });
  }

  // ------------------------------------------------------------------ 맵 고르기
  //   (사용자 요청 2026-11-11 "맵이 많아져도 되게"): 왼쪽 = 작은 맵 칸 목록 (2~3열, 아래로 스크롤, 맵 수 제한 없음)
  //   오른쪽 = 고른 맵 자세히 (큰 코스 그림 · 난이도 · 설명 · 태그 · 길이 · 내 기록 · 온라인 1~3등)
  views.map.innerHTML = `
    <div class="h-maps">
      <div class="head"><div><span class="p3-eyebrow">READY TO RACE</span><h2>어디로 떠날까요?</h2><div class="who"></div></div>
        <div class="bar"><button class="gm-btn" data-go="mode" data-nav>‹ 방식 <kbd>Backspace</kbd></button><button class="gm-btn primary" data-act="start" data-nav>출발! <kbd>Enter</kbd></button></div></div>
      <div class="mp-layout">
        <div class="h-panel mp-list"><div class="mp-ltitle">코스 · ${maps.length}개</div><div class="h-mapgrid"></div></div>
        <div class="h-panel mp-info"></div>
      </div>
    </div>`;
  const grid = views.map.querySelector('.h-mapgrid');
  const mapInfoBox = views.map.querySelector('.mp-info');
  const DIFF_WORD = ['', '쉬움', '보통', '어려움', '아주 어려움'];
  const starsOf = (m) => '★'.repeat(m.difficulty || 1) + '☆'.repeat(Math.max(0, 3 - (m.difficulty || 1))); // 4 = 아주 어려움 (화산)
  let mapClickFrom = null;
  grid.addEventListener('pointerdown', () => { mapClickFrom = mapId; });
  for (const m of maps) {
    const info = mapInfo[m.id];
    const card = document.createElement('button');
    card.className = 'gm-btn h-map';
    card.dataset.nav = '';
    card.dataset.map = m.id;
    card.innerHTML = `<canvas width="320" height="180"></canvas>
      <div class="body">
        <div class="t"><b>${esc(m.title)}</b><span class="stars" title="난이도">${starsOf(m)}</span></div>
        <div class="meta"><span class="len">${!info.ok ? '🚧 준비 중' : info.free ? '자유 주행' : `${info.km >= 10 ? info.km.toFixed(0) : info.km.toFixed(1)} km · ${info.laps}바퀴`}</span><span class="rec"></span></div>
      </div>`;
    drawTrackThumb(card.querySelector('canvas'), info.pts, m.theme);
    card.addEventListener('click', (e) => {
      if (mapId === m.id && (e.detail === 0 || mapClickFrom === m.id)) start();
      else selectMap(m.id, true);
      mapClickFrom = null;
    });
    card.addEventListener('focus', () => selectMap(m.id));
    card.addEventListener('dblclick', () => start());
    if (!info.ok) card.classList.add('soon');
    grid.appendChild(card);
  }
  const prepScenery = document.createElement('div');
  prepScenery.className = 'p3-scenery'; prepScenery.setAttribute('aria-hidden', 'true');
  prepScenery.innerHTML = '<div></div><div></div>'; home.prepend(prepScenery);
  let prepImage = '', prepLayer = 0, prepRequest = 0;
  function setPrepScenery(id) {
    if (prepImage === id) return;
    prepImage = id; const request = ++prepRequest;
    const image = new Image(); image.onload = () => {
      if (request !== prepRequest) return;
      prepLayer = 1 - prepLayer;
      const layers = prepScenery.children;
      layers[prepLayer].style.backgroundImage = 'url("src/art/maps/' + id + '.webp")';
      layers[prepLayer].classList.add('on'); layers[1-prepLayer].classList.remove('on');
    }; image.src = 'src/art/maps/' + id + '.webp';
  }
  function selectMap(id, sound = false) {
    const changed = mapId !== id;
    mapId = id;
    if (sound) uiSound('move');
    grid.querySelectorAll('.h-map').forEach((b) => b.classList.toggle('sel', b.dataset.map === id));
    refreshSummary();
    setLast({ map: id });
    if (changed || !mapInfoBox.dataset.map) renderMapInfo();
    const card = grid.querySelector('.h-map.sel');
    if (card && views.map.classList.contains('on')) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  /** 오른쪽 자세히 패널 */
  const olTop = new Map(); // 맵 → 온라인 1~3등 (한 번 받으면 이 홈에서 다시 안 받음)
  function renderMapInfo() {
    const m = mapOf(mapId), info = mapInfo[m.id];
    mapInfoBox.dataset.map = m.id;
    setPrepScenery(m.id);
    const mine = records.get(m.id, carId);
    const best = records.bestRaceOfMap(m.id);
    const bestRec = best ? records.get(m.id, best.car) : null;
    const d = m.difficulty || 1;
    const len = !info.ok ? '준비 중' : info.free ? '자유 주행' : `${info.km >= 10 ? info.km.toFixed(0) : info.km.toFixed(1)} km`;
    mapInfoBox.innerHTML = `<div class="mp-pic"><canvas width="760" height="330"></canvas><span class="mp-diff d${d}">${starsOf(m)} ${DIFF_WORD[d] || ''}</span></div>
      <div class="mp-head"><h3>${esc(m.title)}</h3><div class="sub">${esc(m.subtitle || '')}</div></div>
      <div class="mp-facts"><span><small>길이</small><b>${len}</b></span><span><small>바퀴</small><b>${info.free ? '—' : `${info.laps}바퀴`}</b></span>
        <span><small>내 기록 · ${esc(carOf(carId).name)}</small><b class="${mine && mine.race ? 'gold' : 'none'}">${mine && mine.race ? fmtTime(mine.race) + (mine.raceAssist ? ' 🛟' : '') : '없음'}</b></span>
        <span><small>내 맵 최고</small><b class="${best ? '' : 'none'}">${best ? fmtTime(best.race) + (bestRec && bestRec.raceAssist ? ' 🛟' : '') : '없음'}</b>${best ? `<em>${esc(carOf(best.car).name)}</em>` : ''}</span></div>
      <div class="ms-map-medal">${medalHtml(m.id,meta.get().medals?.[m.id]?.tier||0,carOf(carId).class)}</div><p class="mp-desc">${esc(m.desc || '')}</p>
      <div class="mp-tags">${(m.tags || []).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      ${online.enabled && G('ranking') && !info.free ? '<div class="mp-online"><div class="mp-ot">🌐 온라인 1~3등</div><div class="mp-olist"><span class="none">불러오는 중…</span></div></div>' : ''}`;
    drawTrackThumb(mapInfoBox.querySelector('canvas'), info.pts, m.theme);
    if (online.enabled && G('ranking') && !info.free) fillMapTop(m.id);
  }
  async function fillMapTop(id) {
    let rows = olTop.get(id);
    if (!rows) {
      try {
        rows = await online.board(id, null, 3);
        olTop.set(id, rows);
      } catch {
        rows = null;
      }
    }
    const box = mapInfoBox.dataset.map === id && mapInfoBox.querySelector('.mp-olist');
    if (!box) return;
    if (!rows) box.innerHTML = '<span class="none">순위표를 불러오지 못했어요</span>';
    else if (!rows.length) box.innerHTML = '<span class="none">아직 아무도 없어요 · 첫 번째가 되어 보세요!</span>';
    else box.innerHTML = rows.map((r, i) => `<span class="r${i + 1}"><i>${['🥇', '🥈', '🥉'][i]}</i><b>${esc(r.nickname)}</b><em>${fmtTime(r.total)}</em></span>`).join('');
  }
  function refreshRecords() {
    grid.querySelectorAll('.h-map').forEach((card) => {
      const id = card.dataset.map;
      // 최고 기록 = 완주 기록 (여러 바퀴 맵은 모든 바퀴 합) (사용자 요청 2026-11-10)
      const best = records.bestRaceOfMap(id);
      const el = card.querySelector('.rec');
      el.textContent = mapInfo[id].free ? '자유 주행' : best ? `내 기록 ${fmtTime(best.race)}` : '내 기록 · 아직 없음';
      el.title = '이 맵 내 최고 기록 (완주 시간, 어느 차든)';
      if(!mapInfo[id].free)el.innerHTML=medalHtml(id,meta.get().medals?.[id]?.tier||0,carOf(carId).class);
    });
    renderMapInfo(); // 차가 바뀌었을 수 있음 (내 기록 · 차 이름)
  }

  // ------------------------------------------------------------------ 설정 · 조작법 · 기록
  const page = (title, inner) => `<div class="h-page"><div class="head"><h2>${title}</h2><button class="gm-btn" data-go="main" data-nav>‹ 뒤로 <kbd>Esc</kbd></button></div><div class="h-panel scroll"></div></div>`;
  views.settings.innerHTML = page('설정');
  const setPanel = createSettingsPanel({ optionLock: (key, v) => (key === 'botLevel' && gate.BOT_LEVEL_FEATURE[v] && !G(gate.BOT_LEVEL_FEATURE[v]) ? gate.lockText(gate.BOT_LEVEL_FEATURE[v], true) : null) });
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
  // 기록 화면 (사용자 요청 2026-11-11)
  //   위 = 맵 고르기 띠 (맵이 많아져도 옆으로 넘김 · ‹ › 버튼 · 고른 맵이 보이게 자동 스크롤)
  //   왼쪽 = 고른 맵의 온라인 순위표 (1·2·3등 이펙트), 오른쪽 = 고른 맵의 내 기록 (자세히)
  const recMaps = () => maps.filter((m) => !mapInfo[m.id].free);
  function fixRecMap() {
    const list = recMaps();
    if (!olMap || !list.some((m) => m.id === olMap)) olMap = (list.find((m) => m.id === mapId) || list[0] || maps[0]).id;
  }
  function renderRecords() {
    fixRecMap();
    const all = records.all();
    const chips = recMaps()
      .map((m) => {
        const best = Object.values(all[m.id] || {}).filter((v) => v.race).sort((a, b) => a.race - b.race)[0];
        // 코스가 바뀐 맵 (mapver): 새 코스 기록이 없고 예전 코스 기록만 있으면 '새 코스'
        const none = records.legacy(m.id).length ? '🆕 새 코스 · 기록 없음' : '기록 없음';
        return `<button class="gm-btn hr-mchip${m.id === olMap ? ' sel' : ''}" data-act="olMap" data-map="${m.id}" data-nav>
          <canvas width="160" height="90" data-map="${m.id}"></canvas>
          <span class="tx"><b>${esc(m.title)}</b><small>${best ? `🏆 ${fmtTime(best.race)}` : none}</small></span></button>`;
      })
      .join('');
    const box = views.records.querySelector('.scroll');
    box.innerHTML = `<div class="hr-mapbar"><button class="gm-btn hr-arr" data-act="recScroll" data-dir="-1" aria-label="이전 맵들">‹</button><div class="hr-maps">${chips}</div><button class="gm-btn hr-arr" data-act="recScroll" data-dir="1" aria-label="다음 맵들">›</button></div>
      <div class="hr-grid${online.enabled && G('ranking') ? '' : ' solo'}">
        ${online.enabled && G('ranking') ? '<section class="hr-col hr-left"><div class="h-online" data-coach="records.board"></div></section>' : ''}
        <section class="hr-col hr-right"><div class="hr-mine" data-coach="records.mine"></div></section></div>`;
    for (const cv of box.querySelectorAll('.hr-mchip canvas')) {
      const m = mapOf(cv.dataset.map);
      try {
        drawTrackThumb(cv, mapInfo[m.id].pts || [], m.theme);
      } catch {}
    }
    renderMine();
    revealRecMap(false);
  }
  /** 고른 맵 칩이 띠 안에 보이게 */
  function revealRecMap(smooth = true) {
    const strip = views.records.querySelector('.hr-maps');
    const chip = strip && strip.querySelector('.hr-mchip.sel');
    if (!chip) return;
    const l = chip.offsetLeft - strip.offsetLeft, r = l + chip.offsetWidth;
    if (l < strip.scrollLeft) strip.scrollTo({ left: l - 8, behavior: smooth ? 'smooth' : 'auto' });
    else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: r - strip.clientWidth + 8, behavior: smooth ? 'smooth' : 'auto' });
  }
  /** 오른쪽: 고른 맵 하나의 내 기록 */
  function renderMine() {
    const box = views.records.querySelector('.hr-mine');
    if (!box) return;
    const m = mapOf(olMap), info = mapInfo[m.id];
    const r = records.all()[m.id] || {};
    const sec = readSectors()[recKey(m.id)] || {};
    const runs = cars.filter((c) => r[c.id] && (r[c.id].race || r[c.id].lap)).map((c) => ({ c, v: r[c.id] }));
    const byRace = runs.filter((x) => x.v.race).sort((a, b) => a.v.race - b.v.race);
    const byLap = runs.filter((x) => x.v.lap).sort((a, b) => a.v.lap - b.v.lap);
    const best = byRace[0], lap = byLap[0];
    // 구간마다 가장 빠른 기록 (어느 차든) + 그 차
    const secBest = [0, 1, 2].map((i) => {
      let t = Infinity, car = null;
      for (const [cid, v] of Object.entries(sec)) if (v && v[i] > 0 && v[i] < t) (t = v[i]), (car = cid);
      return { t, car };
    });
    const theo = secBest.every((s) => Number.isFinite(s.t)) ? secBest.reduce((a, s) => a + s.t, 0) : null;
    const pic = (id, big) => {
      const u = thumbUrl(id);
      return u ? `<img src="${u}" alt=""${big ? ' class="big"' : ''}>` : `<span class="ph${big ? ' big' : ''}" data-car="${id}">🏎️</span>`;
    };
    const kmTxt = info.km ? `${info.km >= 10 ? info.km.toFixed(0) : info.km.toFixed(1)} km` : '';
    const head = `<h3 class="h-subt">💾 내 기록 <small>${esc(m.title)} · 이 브라우저</small></h3>`;
    const hero = `<div class="hm-hero"><canvas width="320" height="200"></canvas>
      <div class="hm-main"><div class="hm-name"><b>${esc(m.title)}</b><span>${info.laps}바퀴${kmTxt ? ` · ${kmTxt}` : ''}</span></div>
        ${best
          ? `<div class="hm-best"><small>최고 기록${info.laps > 1 ? ` (${info.laps}바퀴 합)` : ''}</small><strong>${fmtTime(best.v.race)}</strong>${best.v.raceAssist ? ASSIST_TAG : ''}</div>
             <div class="hm-car">${pic(best.c.id, true)}<span><b>${esc(best.c.name)}</b><small>${esc(best.c.tag || '')}</small>${buildTag(best.v.raceBuild, 'hm-build')}</span></div>`
          : `<div class="hm-none">🏁 아직 이 맵을 달리지 않았어요<small>타임 어택이나 자유 연습을 완주하면 기록이 쌓여요</small></div>`}
        <button class="gm-btn primary small hm-go" data-act="recRace" data-nav>🏁 이 맵 달리기 ›</button></div></div>`;
    if (!runs.length) {
      box.innerHTML = head + `<div class="hm-card empty">${hero}</div>` + legacyHtml() + foot();
    } else {
      const top = byRace.length ? byRace[0].v.race : 0;
      const rows = byRace
        .map((x, i) => {
          const gap = x.v.race - top;
          const w = Math.max(14, 100 - (gap / top) * 100 * 6);
          return `<li class="${i === 0 ? 'top' : ''}">${pic(x.c.id)}<span class="n"><b>${esc(x.c.name)}</b><small>최고 랩 ${x.v.lap ? fmtTime(x.v.lap) : '—'}${x.v.lapAssist ? ' 🛟' : ''}</small>${buildTag(x.v.raceBuild, 'hm-build')}</span>
            <span class="bar"><i style="width:${w.toFixed(1)}%"></i></span><span class="t"><b>${fmtTime(x.v.race)}${x.v.raceAssist ? ' 🛟' : ''}</b><small>${i === 0 ? '내 1등 차' : `+${gap.toFixed(3)}`}</small></span></li>`;
        })
        .join('');
      box.innerHTML = head + `<div class="hm-card">${hero}
        <div class="hm-stats">
          <div><small>⚡ 최고 랩</small><b>${lap ? fmtTime(lap.v.lap) : '—'}</b><em>${lap ? esc(lap.c.name) + (lap.v.lapAssist ? ' 🛟' : '') : ''}</em></div>
          <div><small>🧩 이론상 최고 랩</small><b>${theo ? fmtTime(theo) : '—'}</b><em>${theo ? '구간 최고를 더한 값' : '구간 기록이 아직 없어요'}</em></div>
          <div><small>🏎️ 달린 차</small><b>${runs.length}대</b><em>${cars.length}대 중</em></div>
        </div>
        ${theo ? `<div class="hm-secs">${secBest.map((s, i) => `<span><small>S${i + 1}</small><b>${s.t.toFixed(2)}</b><em>${esc(carOf(s.car).name)}</em></span>`).join('')}</div>` : ''}
        ${rows ? `<div class="hm-lt">차마다 최고 기록</div><ol class="hm-cars">${rows}</ol>` : ''}
      </div>` + legacyHtml() + foot();
    }
    const cv = box.querySelector('.hm-hero canvas');
    try {
      drawTrackThumb(cv, info.pts || [], m.theme);
    } catch {}
    // 예전 코스 기록 (mapver, 2026-11-24): 코스 모양이 바뀌기 전 기록 = 작게 보여 주기만 (비교·순위·고스트에는 안 씀)
    function legacyHtml() {
      const lines = records.legacy(m.id).map((g) => {
        const list = Object.entries(g.cars).filter(([, v]) => v && (v.race || v.lap));
        if (!list.length) return '';
        const race = list.filter(([, v]) => v.race).sort((a, b) => a[1].race - b[1].race)[0];
        const lap = list.filter(([, v]) => v.lap).sort((a, b) => a[1].lap - b[1].lap)[0];
        return `<li><span class="v">코스 v${g.ver}</span><span>🏆 ${race ? `${fmtTime(race[1].race)} <em>${esc(carOf(race[0]).name)}</em>` : '—'}</span><span>⚡ ${lap ? fmtTime(lap[1].lap) : '—'}</span><span class="c">${list.length}대</span></li>`;
      }).join('');
      return lines ? `<div class="hm-legacy"><div class="hm-lt">🕰️ 예전 코스 기록 <small>코스가 바뀌기 전 · 비교·순위표에는 안 써요</small></div><ol>${lines}</ol></div>` : '';
    }
    function foot() {
      return `<div class="hr-foot"><span>${online.enabled ? '타임 어택·자유 연습 완주 기록은 이름·비밀번호를 정하면 순위표에도 올라가요' : '기록은 이 브라우저에만 저장돼요'} · ${ASSIST_TAG} = 운전 도움을 켜고 낸 기록</span><button class="gm-btn small danger" data-act="clearRec" data-nav>모든 기록 지우기</button></div>`;
    }
  }

  // ------------------------------------------------------------------ 온라인 순위표 (내 기록 화면 위쪽)
  //   맵마다 사람별 가장 빠른 완주 기록 (어느 차든) / 지금 고른 차만. 줄마다 "👻 같이 달리기" = 그 사람 고스트와 타임 어택
  let olMap = null, olCarOnly = false, olSeq = 0;
  // 부품 조립 1차 ⑤ (2026-11-15): 순위표 '순정만' 보기 (기억 gimmick.olStock) + 조립 칩 ('g1.t2' → 🔧 숏 · 소프트, 순정은 표시 안 함)
  let olStockOnly = (() => { try { return localStorage.getItem('gimmick.olStock') === '1'; } catch { return false; } })();
  function buildTag(sig, cls = 'ol-build') {
    if (!sig || sig === 'stock') return '';
    let short = sig, full = sig;
    try { short = parts.buildSummary(sig, { short: true }); full = parts.buildSummary(sig); } catch {}
    return `<i class="${cls}" title="부품 조립: ${esc(full)}">🔧 ${esc(short)}</i>`;
  }
  // 순위표 아래 내 계정 줄 (이름 + 비밀번호 4자리 = 한 계정, 2026-11-12)
  function olMeHtml(me) {
    // 계정 저장 (2026-11-15): 로그인한 이름 + 진행 저장 상태 + [계정 바꾸기] [로그아웃]
    if (me && me.claimed) {
      const cs = online.cloudStatus ? online.cloudStatus() : {};
      const cloud = cs.missing ? '' : cs.linked ? `<em class="ol-cloud">☁ 진행 저장됨</em>` : `<em class="ol-cloud wait">☁ 저장 준비 중</em>`;
      return `<span class="ol-acc">👤 <b>${esc(me.nick)}</b> <em class="ol-lock">🔐 로그인 중</em>${cloud}</span><span class="ol-tip">${cs.missing ? '다른 기기에서도 같은 이름 + 비밀번호를 넣으면 이 계정이에요' : '다른 기기에서도 같은 이름 + 비밀번호면 레벨·조각·산 물건·기록이 그대로 이어져요'}</span><span class="ol-accbtns"><button class="gm-btn small" data-act="name" data-nav>👤 계정 바꾸기</button><button class="gm-btn small cs-logout" data-act="logout" data-nav>로그아웃</button></span>`;
    }
    if (me) return `<span class="ol-acc">👤 <b>${esc(me.nick)}</b> 으로 올리는 중</span><span class="ol-tip warn">비밀번호를 정하면 이 이름이 내 것이 되고, 다른 기기에서도 이어 할 수 있어요</span><button class="gm-btn small primary" data-act="name" data-nav>🔐 비밀번호 정하기</button>`;
    return `<span class="ol-tip warn">이름과 비밀번호 4자리를 정하면 완주 기록이 순위표에 올라가요 · 다른 기기에서도 같은 이름 + 비밀번호면 같은 계정</span><button class="gm-btn small primary" data-act="name" data-nav>🔐 이름·비밀번호 정하기</button>`;
  }
  // 로그아웃 (2026-11-15): 확인 → 계정에 저장 (실패하면 아무것도 안 지우고 안내) → 처음 상태로 홈 새로 열기
  let loggingOut = false;
  async function logoutFlow() {
    const me = online.me();
    if (loggingOut || !me || !me.claimed) return;
    if (!(await confirmDialog(`'${me.nick}' 계정에서 로그아웃할까요?`, '지금 진행을 계정에 저장하고 나가요 · 이 기기는 처음 상태가 돼요 (설정·조작키는 그대로). 같은 이름 + 비밀번호로 다시 들어오면 진행이 돌아와요.', '저장하고 로그아웃'))) return;
    loggingOut = true;
    toast('☁ 계정에 저장하는 중…');
    let r;
    try {
      r = await online.logout();
    } catch (err) {
      r = { ok: false, message: '계정에 저장하지 못했어요 · 인터넷 연결 뒤 다시 해 주세요' };
    }
    loggingOut = false;
    if (!r.ok) {
      $('#hToast').classList.remove('on');
      await accountNotice('로그아웃하지 못했어요', `${r.message} · 이 기기 진행은 그대로예요.`);
      return;
    }
    location.replace(location.pathname);
  }
  async function renderOnline() {
    const box = views.records.querySelector('.h-online');
    if (!box) return;
    fixRecMap();
    const me = online.me();
    box.innerHTML = `<h3 class="h-subt">🌐 온라인 순위표 <small>혼자 달린 완주 기록만 · 이름 + 비밀번호 4자리</small></h3>
      <div class="h-oltabs ol-one"><b class="ol-map">🗺️ ${esc(mapOf(olMap).title)}</b><button class="gm-btn small h-olcar${olCarOnly ? ' on' : ''}" data-act="olCar" data-nav>${olCarOnly ? `🏎️ ${esc(carOf(carId).name)}만` : '🏎️ 모든 차'}</button><button class="gm-btn small h-olstock${olStockOnly ? ' on' : ''}" data-act="olStock" data-nav aria-pressed="${olStockOnly}" title="${olStockOnly ? '부품을 끼우지 않은 기록만 보는 중 · 누르면 조립 기록도' : '조립 기록도 같이 보는 중 · 누르면 순정 기록만'}">${olStockOnly ? '⚙️ 순정만' : '🔧 조립 포함'}</button></div>
      <p class="ol-help">👻 같이 달리기: 저장된 주행과 겨루는 타임 어택이에요. 같은 차로 출발해요.<br>+시간은 1위와의 차이예요. 🔧 = 부품을 끼우고 낸 기록${olStockOnly ? ' · 지금은 부품 없이 낸 기록만' : ''}</p>
      <div class="h-olboard"><div class="none">불러오는 중…</div></div>
      <div class="h-olme">${olMeHtml(me)}</div>`;
    if (me) online.refresh().then((m2) => {
      const el = box.querySelector('.h-olme');
      if (el && (!m2 || m2.nick !== me.nick || m2.claimed !== me.claimed)) el.innerHTML = olMeHtml(m2);
    });
    const seq = ++olSeq;
    const board = box.querySelector('.h-olboard');
    try {
      const rows = await online.board(olMap, olCarOnly ? carId : null, 50, { stockOnly: olStockOnly });
      if (seq !== olSeq) return;
      if (!rows.length) {
        board.innerHTML = olStockOnly ? '<div class="none">아직 순정 기록이 없어요. 부품 없이 달려 첫 번째가 되어 보세요!</div>' : '<div class="none">아직 아무도 기록이 없어요. 첫 번째가 되어 보세요!</div>';
        return;
      }
      const lapsN = mapInfo[olMap].laps;
      const first = rows[0].total;
      // 줄 목록: 1·2·3등은 금·은·동 판 + 빛 훑기 + 메달 반짝임 (menu.css '기록 화면 2026-11-11')
      board.innerHTML = `<div class="ol-cap"><span>순위</span><span>이름 · 차</span><span>기록${lapsN > 1 ? ` (${lapsN}바퀴)` : ''}</span><span></span></div><ol class="ol-list">${rows
        .map((r, i) => {
          const mine = me && r.player_id === me.id;
          const c = carOf(r.car);
          const pic = c && c.id === r.car ? thumbUrl(c.id) : null;
          const cls = [i < 3 ? `r${i + 1} podium` : '', mine ? 'me' : ''].join(' ').trim();
          const rank = i < 3 ? `<span class="ol-medal">${i === 0 ? '<i class="crown">👑</i>' : ''}<b>${i + 1}</b></span>` : `<span class="ol-num">${i + 1}</span>`;
          return `<li class="${cls}" style="--i:${i}">${rank}
            <span class="ol-who">${pic ? `<img src="${pic}" alt="">` : `<span class="ph" data-car="${esc(r.car)}">🏎️</span>`}<span><b>${esc(r.nickname)}${r.license ? licenseChip(r.license, 18) : mine && academy.top() ? licenseChip(academy.top(), 18) : ''}${mine ? ' <em class="ol-me">나</em>' : ''}</b><small>${esc((c && c.id === r.car && c.name) || r.car)}${r.stock === false ? ' ' + buildTag(r.build) : ''}</small></span></span>
            <span class="ol-time"><strong>${fmtTime(r.total)}</strong>${r.assist ? ASSIST_TAG : ''}<small>${i === 0 ? (r.best_lap && lapsN > 1 ? `최고 랩 ${fmtTime(r.best_lap)}` : '1위') : `+${(r.total - first).toFixed(3)}`}</small></span>
            <span class="ol-acts">${r.ghostOk === false ? '<span class="ol-noghost" title="이 사람의 서버 고스트는 조립 주행이라 순정만 보기에서는 같이 달릴 수 없어요">👻✕</span>' : `<button class="gm-btn small ol-ghost" data-act="olGhost" data-coach="records.ghost" data-pid="${esc(r.player_id)}" data-car="${esc(r.car)}" data-nick="${esc(r.nickname)}" data-nav aria-label="${esc(r.nickname)} 고스트와 같이 달리기" title="이 사람의 고스트와 같은 차로 타임 어택">👻<span> 같이 달리기</span></button>`}${r.stock === false ? `<button class="gm-btn small ol-copy" data-act="olCopyBuild" data-car="${esc(r.car)}" data-build="${esc(r.build)}" data-nick="${esc(r.nickname)}" data-nav aria-label="${esc(r.nickname)}의 조립 따라 하기" title="이 조립을 내 ${esc((c && c.id === r.car && c.name) || r.car)}에 끼우기 (가진 부품만, 없는 부품은 순정)">🔧<span> 따라 하기</span></button>` : ''}</span></li>`;
        })
        .join('')}</ol>`;
    } catch (err) {
      console.warn('온라인 순위표', err);
      if (seq === olSeq) board.innerHTML = '<div class="none">순위표를 불러오지 못했어요 (인터넷 확인)</div>';
    }
  }

  // ------------------------------------------------------------------ 드라이빙 아카데미 (2026-11-12, ?menu=academy)
  //   레슨 카드(그림·내 메달) + 라이선스 시험 C → B → A → S. 진행은 게임 쪽 src/academy.js, 저장은 academyStore.js
  function renderAcademy() {
    const sum = academy.summary();
    const top = academy.top();
    const mapName = (id) => (mapOf(id) && mapOf(id).title) || id;
    const lessonCard = (l) => {
      const md = academy.medalOf(l.id);
      return `<button class="gm-btn ax-card m${md}" data-act="acLesson" data-id="${l.id}" data-nav>
        <span class="ax-art">${academyArt(l.art)}</span>
        <span class="ax-tx"><b>${esc(l.name)}</b><small>${esc(l.short)}</small><em>${esc(mapName(l.map))}${l.extra && l.extra.bots ? ' · 연습 상대' : ''} · 약 ${l.mins}분</em></span>
        <span class="ax-medal" title="${MEDAL_NAMES[md]}">${md ? MEDALS[md] : '<i>▶</i>'}</span></button>`;
    };
    const groups = GROUPS.map((g) => {
      const ls = LESSONS.filter((l) => l.group === g.id);
      return ls.length ? `<section class="ax-group"><h3>${esc(g.name)}</h3><div class="ax-grid">${ls.map(lessonCard).join('')}</div></section>` : '';
    }).join('');
    const licCard = (lv, i) => {
      const have = academy.hasLicense(lv.id);
      const can = academy.canTake(lv.id);
      const tasks = lv.tasks
        .map((t) => {
          const lm = lessonMeta(t);
          const md = LESSONS.some((x) => x.id === t) ? academy.medalOf(t) : 0;
          return `<span title="${esc(lm.name)}${md ? ` · 내 레슨 ${MEDAL_NAMES[md]}` : ''}">${lm.icon}<small>${esc(lm.name)}</small>${md ? `<i>${MEDALS[md]}</i>` : ''}</span>`;
        })
        .join('');
      const paint = unlocks.paintOf(lv.paint);
      return `<div class="ax-lic ${have ? 'have' : can ? 'open' : 'locked'}" style="--lc:${lv.color}">
        <div class="ax-lhead">${licenseBadge(lv.id, { size: 46 })}<div><b>${esc(lv.name)} <small>${esc(lv.sub)}</small></b><span>${esc(lv.desc)}</span></div>${have ? '<em class="ax-pass">✓ 합격</em>' : ''}</div>
        <div class="ax-tasks">${tasks}</div>
        <div class="ax-rule">과제마다 기회 2번 · 모두 <b>${MEDALS[lv.need]} ${MEDAL_NAMES[lv.need]}</b> 이상이면 합격</div>
        <div class="ax-rew"><span class="sw" style="--c:${(paint && paint.body) || '#fff'}"></span>${esc((paint && paint.name) || '')} 색 · +${lv.xp} XP · 배지</div>
        <button class="gm-btn ${!have && can ? 'primary' : ''} ax-go" data-act="acExam" data-lic="${lv.id}" data-nav>${have ? '↺ 다시 보기' : can ? '시험 보기 ›' : `🔒 ${esc(LICENSES[i - 1].name)} 먼저`}</button></div>`;
    };
    views.academy.innerHTML = `
      <div class="ax">
        <div class="ax-head">
          <button class="gm-btn small ax-back" data-go="main" data-nav>‹ 홈으로</button>
          <div class="ax-title"><div><b>드라이빙 아카데미</b><small>먼저 레슨으로 연습해요 · 시험을 통과하면 라이선스 배지를 받아요</small></div></div>
          <div class="ax-sum"><span>🥇 <b>${sum.gold}</b></span><span>🥈 <b>${sum.silver}</b></span><span>🥉 <b>${sum.bronze}</b></span><span class="n">레슨 ${sum.done}/${sum.total}</span>${top ? `<span class="lic">${licenseChip(top, 24)}</span>` : ''}</div>
        </div>
        <div class="ax-body">
          <div class="ax-lessons h-panel"><button class="gm-btn hm-tutorial" data-act="tutorial" data-nav><span>🚦</span><span><b>처음이라면 · 튜토리얼</b><small>출발·브레이크·자동 변신을 차근차근</small></span><span>›</span></button>${groups}</div>
          <div class="ax-side h-panel"><h3 class="ax-sh">라이선스 시험 <small>선택 도전 · C → B → A → S 순서 · 배지·색·XP 보상</small></h3>${LICENSES.map(licCard).join('')}</div>
        </div>
        <div class="ax-foot"><span class="ax-car">🏎️ ${esc(carOf(carId).name)} · 이 차로 연습해요 · 차는 '레이스 시작'에서 바꿔요</span></div>
      </div>`;
  }
  window.addEventListener('gimmick:academy', () => view === 'academy' && renderAcademy());

  // ------------------------------------------------------------------ 화면 바꾸기
  let view = 'main';
  // 준비 화면은 방식 → 맵(시즌 구성), 차고는 들어온 화면으로 돌아가요.
  const backView = () => view === 'car' ? garageReturn : ({mode:'main',map:G('time') ? 'mode' : 'main',season:'mode'}[view] || 'main');
  /** 플레이: 방식 화면부터 (Lv1은 방식이 봇 레이스 하나라 맵 고르기로 바로) */
  const playView = () => (G('time') ? 'mode' : 'map');
  /** 화면 바꾸기. sub: 설정 화면의 탭 ('general' | 'keys') */
  function show(name, focus = true, sub) {
    if (!views[name]) name = 'main';
    if (view === 'car' && name !== 'car') { costumePicker.restore(); costumePicker.suspend(); }
    if (view === 'car' && name !== 'car' && !isOpen(carId) && isOpen(openCarId)) selectCar(openCarId);
    if (view !== name) uiSound(name === 'main' ? 'back' : 'select');
    view = name;
    if (name === 'main' && thumbJob) { thumbJob.cancel(); thumbJob = null; thumbScope = ''; }
    if (name === 'settings') setPanel.showTab(sub || 'general');
    if (name === 'mode') { garageOnly = false; refreshModes(); refreshModeSummary(); startThumbs(); }
    for (const [k, v] of Object.entries(views)) v.classList.toggle('on', k === name);
    home.classList.toggle('dim', !['main', 'car'].includes(name));
    home.classList.toggle('calm', name !== 'main');
    preview.setView(name);
    if (name === 'mode') views.mode.querySelectorAll('[data-art]').forEach(el => el.style.setProperty('--mode-art', `url("${new URL(`./art/modes/${el.dataset.art}.webp`, import.meta.url).href}")`));
    if (name === 'records') {
      renderRecords();
      renderOnline();
      setTimeout(startThumbs, 300); // 범위가 바뀌었을 때만 추가 사진 준비
    }
    if (name === 'map') refreshRecords();
    home.classList.toggle('g2-catalog', name === 'car' && !carDetail);
    if (name === 'car') { startThumbs(); showGarage(carOf(carId));partsUI.show(carOf(carId),isOpen(carId));preview.setParts?.(parts.getBuild(carId)); }
    if (name === 'season') renderSeason();
    if (name === 'map' || name === 'season') { renderRideCard(); startThumbs(); }
    if (name === 'car') { const back = views.car.querySelector('.hm-catalog-home'); back.hidden = false; back.dataset.go = garageReturn; back.textContent = garageReturn === 'main' ? '‹ 홈' : '‹ 맵'; views.car.classList.toggle('p3-fromhome', garageReturn === 'main'); }
    refreshFlow();
    if (name === 'academy') renderAcademy();
    if (name === 'meta') metaPage.render();
    refreshMetaHome();
    refreshSummary();
    padHint();
    if (focus) {
      const target =
        name === 'car' ? views.car.querySelector('.h-carcard.sel')
        : name === 'map' ? grid.querySelector('.h-map.sel')
        : name === 'main' ? views.main.querySelector('.h-start')
        : name === 'mode' ? views.mode.querySelector('.h-mode.sel .h-modecard')
        : name === 'season' ? views.season.querySelector('[data-season-kind].on')
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
    home.style.setProperty('--m3-map', `url("${new URL(`./art/maps/${m.id}.webp`, import.meta.url).href}")`);
    views.main.querySelector('.m3-heading h1').textContent = c.name;
    views.main.querySelector('.m3-heading p').textContent = `오늘의 코스, ${m.title}`;
    views.main.querySelector('.m3-class').textContent = `MY MACHINE / ${classOfId(c.class)?.name?.replace(/^[ABC]\s*/, '') || ''}`;
    views.main.querySelector('.h-start .sel').textContent = `${m.title} · ${rm?.name || '봇 레이스'} · ${c.name}`;
    {
      // 큰 시작 버튼: 고른 맵·차·방식 딱지 + 차 사진
      const chip = (k, t) => (views.main.querySelector(`.hx-chips [data-c="${k}"]`).textContent = t);
      chip('map', `🗺️ ${m.title}`);
      chip('car', `🏎️ ${c.name}`);
      chip('mode', rm ? `${rm.icon} ${rm.name}` : '');
      heroThumb();
    }
    views.mode.querySelector('.who').textContent = `🗺️ ${m.title} · 🏎️ ${c.name}`;
    views.main.querySelector('.h-cartag .tg').textContent = c.tag || '';
    views.main.querySelector('.h-cartag .n').textContent = c.name;
    views.map.querySelector('.who').textContent = `🏎️ ${c.name} · 이 차로 달려요`;
  }

  /** 큰 시작 버튼의 차 사진 (carThumbs가 찍어 둔 것, 아직 없으면 그림 글자) */
  function heroThumb() {
    const box = views.main.querySelector('.hx-thumb');
    if (!box) return;
    const im = box.querySelector('img'), ph = box.querySelector('.ph');
    let url = null;
    try {
      url = thumbUrl(carId);
    } catch {}
    if (url) {
      if (im.getAttribute('src') !== url) im.src = url;
      im.hidden = false;
      ph.hidden = true;
    } else {
      im.hidden = true;
      ph.hidden = false;
    }
  }
  /** 드라이버 카드: 티어 아이콘 · 레벨 · XP 막대 · 레이스/우승 수 */
  function refreshMetaHome() {
    const s = meta.get();
    const wl = walletNow(); // 조각 3종 (⬡ 피트 · ◆ 강화 · ✿ 커스텀)
    for (const b of home.querySelectorAll('[data-wallet]')) b.textContent = (wl[b.dataset.wallet] || 0).toLocaleString('ko-KR');
    home.querySelector('.mt-wallet-btn').setAttribute('aria-label', '내 조각 ' + CURRENCY_IDS.map((k) => CURRENCIES[k].name + ' ' + (wl[k] || 0)).join(', ') + ' · 상점 열기');
    const products = meta.shop({carId});
    const available = products.filter(p => G('shop') && !gate.rewardLock(p) && p.canBuy && p.canAfford && !p.owned);
    const pc = available.filter(p => p.kind === 'part').length, carN = available.filter(p => p.kind === 'car').length, cc = available.length - pc - carN;
    const badge = [carN ? '🚗' + carN : '', pc ? '🔧' + pc : '', cc ? '✦' + cc : ''].filter(Boolean).join(' ');
    views.main.querySelector('.hm-shop small').textContent = available.length ? '지금 살 수 있어요 · ' + badge : '차 · 부품 · 코스튬 · 색 · 세리머니';
    const wallet = home.querySelector('.mt-wallet-btn');
    let wb = wallet.querySelector('.hm-wallet-badge');
    if (!wb) { wb = document.createElement('span'); wb.className = 'hm-wallet-badge'; wallet.append(wb); }
    wb.textContent = badge; wb.hidden = !G('shop') || !available.length;
    const fresh = !G('parts') ? [] : parts.listParts(null, {carId}).filter(p => p.owned && !p.equipped);
    views.main.querySelector('.hm-garage small').textContent = fresh.length ? '새 부품 ' + fresh.length + ' · 이 차에 아직 안 끼웠어요' : '차 구경 · 조립 · 꾸미기';
    views.car.querySelector('.ct-parts .ct-badge').textContent = fresh.length ? '● ' + fresh.length : '';
    const next = nextRewards({carId,n:1})[0];
    const goals=Object.values(s.periods).flatMap(p=>p.goals),pt=s.playtime;const claimable=goals.filter(g=>!g.claimed&&g.progress>=g.goal).length+(s.attendance.day!==s.periods.daily.key?1:0)+[900,1800,3600].filter((v,i)=>pt.seconds>=v&&!pt.claimed.includes(i)).length;
    const line=views.main.querySelector('.hm-rewards');line.querySelector('small').textContent='오늘 남은 미션 '+s.periods.daily.goals.filter(g=>!g.claimed).length+' · 받을 보상 '+claimable;line.classList.toggle('ms-has-reward',G('goals')&&claimable>0);
  }
  // 해금 잠금 표시는 refreshMetaHome이 홈 줄 글자를 다시 쓸 때마다 (show()도 이걸 부름)
  const refreshMetaHome0 = refreshMetaHome;
  refreshMetaHome = function () { refreshMetaHome0(); applyGate(); };
  window.addEventListener('gimmick:meta', () => { refreshMetaHome(); showDriver(); });
  window.addEventListener('gimmick:parts', () => requestAnimationFrame(refreshMetaHome));
  window.addEventListener('gimmick:metaError', e => toast(e.detail.message));
  function showDriver() {
    const box = $('.hx-driver');
    if (!box) return;
    let p = null;
    try {
      p = profile.get();
    } catch {}
    if (!p) p = { level: 1, title: '루키 티어', icon: '🔰', color: '#8fd3ff', pct: 0, have: 0, need: 200, races: 0, wins: 0 };
    box.style.setProperty('--lc', p.color || '#8fd3ff');
    box.querySelector('.hx-lic').textContent = p.icon || '🔰';
    box.querySelector('.lv').textContent = `Lv.${p.level} ${p.title}`;
    box.querySelector('.hx-xp i').style.width = `${Math.round((p.pct || 0) * 100)}%`;
    box.querySelector('.hx-xp').title = `다음 레벨까지 ${Math.max(0, p.need - p.have)} XP · ${p.have} / ${p.need} XP`;
    const nx = nextRewards({carId,n:1})[0];
    box.title = p.have + ' / ' + p.need + ' XP' + (nx ? ' · 다음 보상 Lv.'+nx.level+' '+nx.name : '') + '\n누르면 이름 바꾸기';
    box.querySelector('.st').hidden = true;
    box.querySelector('.hx-aclic').hidden = true;
  }
  /** 지난번보다 레벨이 올랐으면 한 번만 축하 창 (새로 열린 차·색) */
  function showLevelNews() {
    let n = null;
    try {
      n = unlocks.takeLevelNews();
    } catch {}
    const partNews=parts.takeNews();
    // 새로 열린 기능 (작업 C): 같은 창 위쪽에 '🎉 새 기능이 열렸어요' + [보러 가기] = 코치 마크 안내
    if (gate.gateActive() && !gate.coachActive()) gate.markSeen(); // 안내를 꺼 둔 사람은 조용히 본 것으로
    const feats = gate.coachActive() && !gateInfo.legacy ? gate.newlyOpened() : [];
    if (!n && !partNews.length && !feats.length) return false;
    const featOnly = !n && !partNews.length;
    const giftOnly = !n && !featOnly;
    n ||= {from:profile.get().level,to:profile.get().level,cars:[],paints:[]};
    const newRewards = featOnly ? [] : rewardsBetween(n.from,n.to,{carId});
    const items = newRewards.map(x=>'<li><i>'+esc(x.icon)+'</i>'+esc(x.name)+(gate.rewardLock(x)?' · '+gate.rewardLockText(x):x.how==='coin'?(x.state==='owned'?' · 보유':G('shop')?' · 구매 가능':' · 🔒 Lv.'+gate.levelOf('shop')+'에 열려요'):'')+'</li>');
    items.push(...partNews.map(x=>'<li><i>🎁</i>'+esc(x.name)+(!G('parts')?' · 🔒 Lv.'+gate.levelOf('parts')+'에 열려요':'')+'</li>'));
    const hasParts = parts.ownedParts().length > 0 && (partNews.length > 0 || newRewards.some(x => x.kind === 'part')) && G('parts');
    const hasCustom = newRewards.some(x => ['paint','costume'].includes(x.kind) && !gate.rewardLock(x));
    const rewardTab = hasParts ? 'parts' : hasCustom ? 'custom' : 'info';
    const nx = nextRewards({carId,level:n.to,n:1})[0];
    const firstCoach = feats.map((f) => f.coach).find((id) => id && !gate.WAITING_COACHES.has(id) && !gate.coachStatus(id) && (id !== 'upgrade' || parts.ownedParts().length > 0));
    const coachFeat = firstCoach && feats.find((f) => f.coach === firstCoach);
    const el = document.createElement('div');
    el.className = 'gx-news' + (feats.length ? ' fg-news' : '');
    el.innerHTML = `<div class="gx-newsbox" role="dialog" aria-modal="true"><div class="gx-burst">🎉</div><h3>${featOnly ? '새 기능이 열렸어요!' : giftOnly ? '새 부품을 받았어요' : `Lv.${n.to} 달성!`}</h3>
      ${feats.length ? `${featOnly ? '' : '<p class="fg-sub">🎉 새 기능이 열렸어요</p>'}<ul class="fg-feats">${feats.map((f) => `<li><i>${esc(f.icon)}</i><span>${esc(f.name)}<small>${esc(f.desc)}</small></span></li>`).join('')}</ul>` : ''}
      ${items.length ? `<p>새로 열렸어요</p><ul>${items.join('')}</ul>` : featOnly ? '' : '<p>계속 달리면 새 차와 색이 열려요</p>'}
      ${feats.some(f => f.id === 'upgrade') && !parts.ownedParts().length ? '<p>먼저 부품을 하나 사 보세요</p>' : ''}
      ${nx && !featOnly ? `<div class="gx-nx">다음 보상 · Lv.${nx.level} ${esc(nx.name)}</div>` : ''}
      <div class="gx-newsbtns">${coachFeat ? `<button class="gm-btn primary" data-gx="coach">${esc(coachFeat.icon)} ${esc(coachFeat.name)} 보러 가기</button>` : ''}${items.length && G('garage') && !(coachFeat?.id === 'garage' && rewardTab === 'info') ? `<button class="gm-btn${coachFeat ? '' : ' primary'}" data-gx="car">${hasParts ? '🔧 부품 끼우기' : hasCustom ? '🎨 꾸미기 보러 가기' : '🚗 차고 보러 가기'}</button>` : ''}<button class="gm-btn" data-gx="ok">${coachFeat ? '나중에' : '확인'}</button></div></div>`;
    const close = () => {
      if (!el.isConnected) return;
      el.remove();
      if (feats.length) gate.markSeen(feats.map((f) => f.id));
      refreshCoachChip();
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-gx]');
      if (!b && e.target !== el) return;
      close();
      if (b && b.dataset.gx === 'coach') { if (firstCoach === 'upgrade') setCarTab('parts'); coach.run(firstCoach); }
      if (b && b.dataset.gx === 'car') {garageReturn = 'main'; garageOnly = true; show('car');setCarTab(rewardTab);garageDetail(true);}
    });
    el.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); views.main.querySelector('.h-start')?.focus({ preventScroll: true }); }
    });
    home.appendChild(el);
    setTimeout(() => {
      const b = el.querySelector('.gm-btn');
      if (b) b.focus({ preventScroll: true });
    }, 50);
    if (!feats.length) setTimeout(close, 20000); // 새 기능 창은 저절로 안 닫힘 (누르기 전까지 기다림)
    return true;
  }
  // ------------------------------------------------------------------ 기능 해금 (작업 C, 설계 8장)
  /** 잠금 표시: #home.fg-off-<기능> (작은 기능 숨김) + data-gate 요소에 흐림·🔒 Lv.n · 약 m판 뒤 */
  function applyGate() {
    for (const f of gate.FEATURES) home.classList.toggle('fg-off-' + f.id, !G(f.id));
    for (const el of home.querySelectorAll('[data-gate]')) {
      const id = el.dataset.gate, lock = !G(id);
      el.classList.toggle('fg-locked', lock);
      const box = el.closest('.h-mode');
      if (box) box.classList.toggle('fg-locked', lock);
      if (lock) el.setAttribute('aria-description', `${gate.lockText(id)} · ${gate.featureOf(id)?.name || ''}`);
      else el.removeAttribute('aria-description');
      if (el.classList.contains('ct-tab')) {
        if (lock) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled'); // partslock: 잠긴 조립 탭은 못 들어감
        let tag = el.querySelector('.fg-tabtag');
        if (lock && !tag) { tag = document.createElement('i'); tag.className = 'fg-tabtag'; el.appendChild(tag); }
        if (tag) { tag.hidden = !lock; tag.textContent = lock ? gate.lockText(id, true) : ''; }
        continue;
      }
      const small = el.querySelector(':scope > .t > small, :scope > small');
      if (!small) continue;
      small.classList.toggle('fg-orig', lock);
      let line = el.querySelector('.fg-lockline');
      if (lock && !line) { line = document.createElement('i'); line.className = 'fg-lockline'; small.after(line); }
      if (line) { line.hidden = !lock; line.textContent = lock ? gate.lockText(id) : ''; }
    }
    // 맵 고르기 뒤로 가기: Lv1은 방식 화면이 없어 홈으로
    const back = views.map.querySelector('.h-maps .head .bar [data-go]');
    if (back) {
      back.dataset.go = G('time') ? 'mode' : 'main';
      back.innerHTML = G('time') ? '‹ 방식 <kbd>Backspace</kbd>' : '‹ 홈으로 <kbd>Backspace</kbd>';
    }
    refreshCoachChip();
  }
  /** 봇 실력이 아직 잠긴 단계면 열린 가장 높은 단계로 (레이스 출발 때) */
  function clampBotLevel() {
    const v = settings.get('botLevel');
    if (gate.BOT_LEVEL_FEATURE[v] && !G(gate.BOT_LEVEL_FEATURE[v])) settings.set('botLevel', G('botHard') ? 'hard' : 'normal');
  }
  /** 홈 '🎓 새 안내 n' 칩 (열렸는데 아직 안 본 안내) */
  function refreshCoachChip() {
    const chip = views.main.querySelector('.fg-chip');
    if (!chip) return;
    const list = gate.coachActive() ? gate.pendingCoaches() : [];
    chip.hidden = !list.length || !!coach.running;
    chip.querySelector('span').textContent = `새 안내 ${list.length} · ${list[0] ? list[0].name : ''}`;
    chip.title = list.map((c) => c.name).join(' · ');
  }
  /** 잠긴 것을 누르면 이동 대신 작은 말풍선 */
  const GO_GATE = { records: 'records', meta: 'goals', academy: 'academy' };
  function gateOfClick(b) {
    if (b.dataset.gate) return b.dataset.gate;
    if (b.dataset.go === 'car') return b.dataset.carSection === 'parts' ? 'parts' : b.dataset.carSection === 'costume' ? 'custom' : 'garage';
    return GO_GATE[b.dataset.go] || null;
  }
  home.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gate], [data-go]');
    if (!b || !home.contains(b)) return;
    const id = gateOfClick(b);
    if (!id || G(id)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    uiSound('back');
    lockTip(b, id, { host: home, onRace: () => show(playView()) });
  }, true);
  /** 기존 사용자 (처음 본 레벨이 이미 3 이상): 한 번만 '새 안내가 n개 있어요 · 보기 / 모두 건너뛰기' */
  function showLegacyCard() {
    const n = gate.pendingCoaches().length;
    if (!n) { gate.markSeenAll(false); return false; }
    const el = document.createElement('div');
    el.className = 'gx-news fg-news';
    el.innerHTML = `<div class="gx-newsbox" role="dialog" aria-modal="true"><div class="gx-burst">🎓</div><h3>새 안내가 ${n}개 있어요</h3>
      <p>차고 · 부품 조립 · 상점 같은 기능을 버튼을 짚어 가며 알려 줘요. 이미 아는 기능은 건너뛰어도 돼요.</p>
      <div class="gx-newsbtns"><button class="gm-btn primary" data-fg="see">보기</button><button class="gm-btn" data-fg="skip">모두 건너뛰기</button></div></div>`;
    const done = (see) => {
      el.remove();
      gate.markSeenAll(!see);
      refreshCoachChip();
      if (see) { show('settings', false); setPanel.showPage('coach'); setTimeout(() => views.settings.querySelector('[data-coach-replay]:not([disabled])')?.focus({ preventScroll: true }), 120); }
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fg]');
      if (b) done(b.dataset.fg === 'see');
    });
    el.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    });
    home.appendChild(el);
    setTimeout(() => el.querySelector('.gm-btn')?.focus({ preventScroll: true }), 50);
    return true;
  }
  // 설정 → 안내 → '다시 보기'
  window.addEventListener('gimmick:coachReplay', (e) => {
    const id = e.detail && e.detail.id;
    if (!id) return;
    gate.takeReplay();
    setTimeout(() => coach.run(id), 0);
  });
  /** 소리 버튼 그림 (설정의 '소리 끄기'와 같은 값) */
  function showMute() {
    const b = $('[data-act="mute"]');
    if (!b) return;
    const off = !!settings.get('muted');
    b.textContent = off ? '🔇' : '🔊';
    b.classList.toggle('off', off);
  }

  // ------------------------------------------------------------------ 레이스 방식 고르기
  views.mode.innerHTML = `
    <div class="h-modes">
      <div class="head"><div><h2>레이스 방식</h2><div class="who"></div></div>
        <div class="bar"><button class="gm-btn" data-go="main" data-nav>‹ 홈으로</button><button class="gm-btn primary" data-act="nextMode" data-coach="mode.next" data-nav>다음: 맵 고르기 › <kbd>Enter</kbd></button></div></div>
      <div class="h-modegrid">${RACE_MODES.map(
        (m) => `<div class="h-mode" data-mode="${m.id}">
          <button class="gm-btn h-modecard" data-art="${m.id}" data-nav data-pick="${m.id}" data-coach="mode.${m.id}"${m.id !== 'race' ? ` data-gate="${gate.MODE_FEATURE[m.id] || 'play'}"` : ''}><b>${esc(m.id === 'champ' ? '그랑프리 · 시즌' : m.name)}</b><small>${esc(m.id === 'item' ? '아이템과 부스터로 순위 경쟁' : m.id === 'time' ? '고스트와 최고 기록 경쟁' : m.desc)}</small><span class="chk">✓</span></button>
          <div class="opts"></div></div>`,
      ).join('')}</div>
      <div class="h-modetip"></div>
      <div class="h-modesum">
        <canvas width="360" height="170"></canvas>
        <div class="i"><small>맵</small><b data-s="mt"></b><span data-s="mm"></span></div>
        <div class="i"><small>차</small><b data-s="ct"></b><span data-s="cm"></span></div>
        <div class="i"><small>내 최고 기록 (이 차)</small><b data-s="rb"></b><span data-s="rm"></span></div>
        <div class="b"><button class="gm-btn small" data-go="map" data-nav>🗺️ 맵</button><button class="gm-btn small" data-go="car" data-gate="garage" data-nav>🏎️ 차</button></div>
      </div>
    </div>`;
  // 방식마다 고를 수 있는 것 (설정 값을 바로 바꿈: 홈 설정·Esc 메뉴 설정과 같은 값)
  const MODE_OPTS = { item: ['bots', 'botLevel'], race: ['bots', 'botLevel'], champ: ['bots', 'botLevel'], time: ['ghost'], net: [], free: [] };
  const OPT_LABEL = { bots: '봇 수', botLevel: '봇 실력', ghost: '고스트' };
  const MODE_TIPS = {
    race: '🏁 봇들과 같은 출발선에서 출발해요. 봇은 내 차와 같은 등급의 차를 타요',
    item: '🎁 상자를 지나 아이템을 얻어요. 화면 위 아이템 칸을 누르거나 ' + keybinds.label('booster') + ' 키로 사용해요',
    time: '⏱️ 혼자 달리며 고스트(내 최고 기록)와 겨뤄요. 구간마다 빨라졌는지 느려졌는지 알려 줘요',
    net: '🌐 방을 만들어 코드를 친구에게 보내거나, 친구 코드로 들어가요. 모두 준비되면 같이 출발해요',
    free: '🧭 봇·고스트 없이 혼자 달려요. 코스를 익히거나 레이싱 라인을 연습할 때 좋아요',
    champ: '🏆 같은 봇들과 여러 맵을 차례로 달려요. 1~8위는 25·18·15·12·10·8·6·4점! 합계가 높으면 우승해요. 동점이면 우승 횟수 → 가장 높은 순위로 비교해요. 진행은 자동 저장돼요',
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
    set('cm', [k ? k.name.replace(/^[ABC]\s*/, '') : '', c.tag || ''].filter(Boolean).join(' · '));
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
    const LEVEL_TIP = { easy: '봇 쉬움: 처음 해도 이길 수 있어요', normal: '봇 중간: 처음 하는 사람은 이기기 어려워요', hard: '봇 어려움: 잘하는 사람과 비슷한 실력이에요', master: '봇 마스터: 어려움보다 훨씬 빨라요. 아주 잘해야 이겨요' };
    let lvTip = raceMode === 'race' || raceMode === 'item' || raceMode === 'champ' ? LEVEL_TIP[settings.get('botLevel') || 'normal'] || '' : '';
    views.mode.querySelector('.h-modetip').textContent = [MODE_TIPS[raceMode] || '', lvTip].filter(Boolean).join(' · ');
    views.mode.querySelector('[data-act="nextMode"]').innerHTML = raceMode === 'net'
      ? '🌐 방 만들기 · 참가 <kbd>Enter</kbd>' : raceMode === 'champ' ? '다음: 시즌 맵 구성 › <kbd>Enter</kbd>' : '다음: 맵 고르기 › <kbd>Enter</kbd>';
    padHint();
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
        el.innerHTML = ''; // '지난 시즌' 줄은 없앰 (사용자 요청 2026-11-17: 봇 레이스 화면에 보여서 헷갈림)
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
  function nextMode() {
    if (raceMode === 'net') return openLobby({map:mapId,car:carId});
    show(raceMode === 'champ' ? 'season' : 'map');
  }
  function openPrepGarage() {
    if (!G('garage')) { const b = views[view]?.querySelector('[data-act="prepGarage"]'); if (b) lockTip(b, 'garage', { host: home }); return; }
    garageReturn = view === 'season' ? 'season' : 'map'; garageOnly = false;
    garageDetail(false, false); show('car');
  }
  function nextCar() {
    if (!isOpen(carId) && !garageOnly) { if (carState(carId).buy) buyCarFlow(carId).then((ok) => ok && show(garageReturn)); else toast('🔒 가진 차를 골라 주세요'); return; }
    show(garageReturn);
  }
  function renderRideCard() {
    const c = carOf(carId), locked = !isOpen(carId);
    const costume = listCostumes(carId).find(x => x.id === unlocks.getCostume(carId));
    const chips = (!parts.isStock(parts.getBuild(carId)) ? '<small>🔧 조립</small>' : '') + (costume ? '<small>✦ '+esc(costume.name)+'</small>' : '');
    for (const name of ['map','season']) {
      const root = views[name].querySelector(name === 'map' ? '.h-maps' : '.sx-season');
      if (!root) continue;
      root.querySelector('.f3-ride')?.remove();
      const card = document.createElement('aside'); card.className = 'f3-ride' + (locked ? ' locked' : '');
      const url = thumbUrl(carId);
      card.innerHTML = (url ? '<img alt="" src="'+esc(url)+'">' : '<span class="f3-photo">🏎️</span>') + '<div><small>지금 탈 차</small><strong>'+esc(c.name)+'</strong><span class="f3-chips"><small class="ct-grade" style="--cc:'+esc(classOfId(c.class)?.color || '#b4c4df')+'">'+esc(classOfId(c.class)?.name?.replace(/^[ABC]\s*/, '') || '기본')+' 등급</small>'+chips+(locked ? (carState(carId).buy ? '<small>⬡ '+carState(carId).price.toLocaleString('ko-KR')+' 으로 사야 해요</small>' : '<small>🔒 Lv.'+carState(carId).level+' 필요</small>') : '')+'</span></div><button class="gm-btn '+(locked?'primary':'')+'" data-act="prepGarage" data-gate="garage" data-coach="map.garageBtn" data-nav>'+(G('garage') ? '차고에서 바꾸기 <kbd>C</kbd>' : '<span class="fg-garagelock">'+gate.lockText('garage', true)+'</span> 차고')+'</button>';
      card.dataset.coach = 'map.ride';
      if (name === 'map') { const bar = root.querySelector('.bar'); const go = bar?.querySelector('[data-act="start"]'); if (go) go.before(card); else root.querySelector('.head').after(card); } else root.querySelector('footer > div:last-child').insertBefore(card, root.querySelector('footer [data-act="start"]'));
      root.querySelectorAll('[data-act="start"]').forEach(btn => btn.disabled = locked || (name === 'season' && !seasonMaps.length));
    }
  }
  function resumeChamp() {
    const cur = champState();
    const url = cur && champMod.champUrl();
    if (url) launch(url, '🏆 시즌 이어 하기', (cur.results.length + 1) + '/' + cur.maps.length + '경기 · ' + mapOf(cur.maps[cur.results.length]).title);
  }
  let seasonKind = 'default', seasonCount = 5, seasonMaps = [], randomMaps = [], customMaps = [];
  const seasonPool = () => (champMod?.CHAMP_MAPS || maps.map(m => m.id)).filter(id => mapInfo[id]?.ok && !mapInfo[id].free);
  function shuffleSeason() {
    const pool = [...seasonPool()];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    randomMaps = pool.slice(0, seasonCount);
  }
  function renderSeason() {
    const pool = seasonPool();
    if (seasonKind === 'random' && randomMaps.length !== Math.min(seasonCount, pool.length)) shuffleSeason();
    seasonMaps = seasonKind === 'default' ? [...pool] : seasonKind === 'random' ? [...randomMaps] : [...customMaps];
    const totalKm = seasonMaps.reduce((n, id) => n + mapInfo[id].km * mapInfo[id].laps, 0);
    // 평균 120 km/h 기준의 대략적인 주행 시간 (로딩·휴식 제외).
    const minutes = Math.max(1, Math.round(totalKm / 2));
    const mapMeta = id => {
      const m = mapOf(id), info = mapInfo[id];
      return starsOf(m) + ' ' + (DIFF_WORD[m.difficulty || 1] || '') + ' · ' + info.km.toFixed(1) + ' km × ' + info.laps + '바퀴';
    };
    const oldFlow = views.season.querySelector('.hx-flow');
    views.season.innerHTML = '<section class="sx-season h-panel"><header><div><h2>🏆 시즌 맵 구성</h2><p>맵을 고르고 여러 경기를 이어 달려요 · ' + esc(carOf(carId).name) + '</p></div></header>' +
      '<div class="sx-scroll"><div class="sx-kinds" data-coach="season.kinds" role="group" aria-label="시즌 구성 방식">' + [['default', '기본 시즌', '전체 ' + pool.length + '개 맵 순서 그대로'], ['random', '🎲 랜덤', '겹치지 않게 무작위로'], ['custom', '직접 고르기', '넣고 빼고 순서도 자유롭게']].map(([id, title, desc]) => '<button class="gm-btn ' + (seasonKind === id ? 'on' : '') + '" data-nav data-season-kind="' + id + '" data-season-key="kind-' + id + '" aria-pressed="' + (seasonKind === id) + '"><b>' + title + '</b><small>' + desc + '</small></button>').join('') + '</div>' +
      '<div class="sx-presets"><span>추천 묶음</span><button class="gm-btn small" data-nav data-season-preset="easy" data-season-key="easy">짧은 시즌 3경기 · 쉬움 위주</button><button class="gm-btn small" data-nav data-season-preset="tour" data-season-key="tour">변신 여행 3경기 · 바다·달·우주</button></div>' +
      (seasonKind === 'random' ? '<div class="sx-random"><b>경기 수</b>' + [...new Set([3, 5, 7, 9, pool.length].filter(n => n <= pool.length))].map(n => '<button class="gm-btn small ' + (seasonCount === n ? 'on' : '') + '" data-nav data-season-count="' + n + '" data-season-key="count-' + n + '" aria-pressed="' + (seasonCount === n) + '">' + n + '경기</button>').join('') + '<button class="gm-btn" data-nav data-season-shuffle data-season-key="shuffle">🎲 다시 섞기</button></div>' : '') +
      '<div class="sx-layout"><div class="sx-order"><h3>달릴 순서 <small>' + seasonMaps.length + '경기 / 최대 ' + pool.length + '경기</small></h3><ol>' + seasonMaps.map((id, i) => '<li><span class="sx-num">' + (i + 1) + '</span><canvas width="160" height="90" data-season-thumb="' + id + '"></canvas><div><b>' + esc(mapOf(id).title) + '</b><small>' + mapMeta(id) + '</small></div>' + (seasonKind === 'custom' ? '<div class="sx-move"><button class="gm-btn small" data-nav data-season-move="' + i + '" data-dir="-1" data-season-key="up-' + id + '" aria-label="' + esc(mapOf(id).title) + ' 앞으로" ' + (i === 0 ? 'disabled' : '') + '>▲</button><button class="gm-btn small" data-nav data-season-move="' + i + '" data-dir="1" data-season-key="down-' + id + '" aria-label="' + esc(mapOf(id).title) + ' 뒤로" ' + (i === seasonMaps.length - 1 ? 'disabled' : '') + '>▼</button><button class="gm-btn small" data-nav data-season-map="' + id + '" data-season-key="remove-' + id + '" aria-label="' + esc(mapOf(id).title) + ' 빼기">×</button></div>' : '') + '</li>').join('') + '</ol>' + (!seasonMaps.length ? '<p class="sx-empty">오른쪽 맵 칸에서 1~' + pool.length + '개를 골라 주세요.</p>' : '') + '</div>' +
      (seasonKind === 'custom' ? '<div class="sx-pool"><h3>맵을 눌러 넣고 빼기</h3><div class="sx-mapgrid">' + pool.map(id => '<button class="gm-btn sx-map ' + (customMaps.includes(id) ? 'on' : '') + '" data-nav data-season-map="' + id + '" data-season-key="map-' + id + '" aria-pressed="' + customMaps.includes(id) + '"><canvas width="240" height="120" data-season-thumb="' + id + '"></canvas><b>' + (customMaps.includes(id) ? '✓ ' : '+ ') + esc(mapOf(id).title) + '</b><small>' + mapMeta(id) + '</small></button>').join('') + '</div></div>' : '<aside class="sx-note"><b>' + (seasonKind === 'default' ? '익숙한 순서로 한 시즌' : '매번 다른 맵, 새로운 순서') + '</b><p>첫 경기부터 목록 순서대로 달려요. 매 경기 점수를 더해 시즌 우승자를 정해요.</p><p>진행은 자동 저장돼요. 홈의 레이스 방식에서 이어 할 수 있어요.</p></aside>') + '</div></div>' +
      '<footer><div class="sx-total" role="status"><b>' + seasonMaps.length + '경기 · 총 약 ' + totalKm.toFixed(1) + ' km</b><small>' + (seasonMaps.length ? '예상 주행 시간 약 ' + minutes + '분 · 차와 실력에 따라 달라요' : '맵을 하나 이상 골라 주세요') + '</small></div><div><button class="gm-btn" data-go="mode" data-nav>‹ 방식</button><button class="gm-btn primary" data-act="start" data-nav ' + (!seasonMaps.length ? 'disabled' : '') + '>🏁 시즌 출발!</button></div></footer></section>';
    if (oldFlow) views.season.prepend(oldFlow);
    renderRideCard();
    views.season.querySelectorAll('[data-season-thumb]').forEach(canvas => { const id = canvas.dataset.seasonThumb; drawTrackThumb(canvas, mapInfo[id].pts, mapOf(id).theme); });
  }
  views.season.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.dataset.go || b.dataset.act) return;
    const key = b.dataset.seasonKey;
    if (b.dataset.seasonKind) seasonKind = b.dataset.seasonKind;
    else if (b.dataset.seasonCount) { seasonCount = +b.dataset.seasonCount; shuffleSeason(); }
    else if (b.hasAttribute('data-season-shuffle')) shuffleSeason();
    else if (b.dataset.seasonPreset) {
      seasonKind = 'custom';
      customMaps = (b.dataset.seasonPreset === 'easy' ? ['starter', 'glacier', 'sea'] : ['sea', 'moon', 'gp']).filter(id => seasonPool().includes(id));
    } else if (b.dataset.seasonMap) {
      const id = b.dataset.seasonMap;
      customMaps = customMaps.includes(id) ? customMaps.filter(m => m !== id) : [...customMaps, id].slice(0, seasonPool().length);
    } else if (b.dataset.seasonMove != null) {
      const i = +b.dataset.seasonMove, j = i + +b.dataset.dir;
      if (j < 0 || j >= customMaps.length) return;
      [customMaps[i], customMaps[j]] = [customMaps[j], customMaps[i]];
    } else return;
    uiSound('select');
    renderSeason();
    const target = [...views.season.querySelectorAll('[data-season-key]')].find(el => el.dataset.seasonKey === key && !el.disabled);
    (target || views.season.querySelector('[data-season-kind].on')).focus({ preventScroll: true });
  });
  async function champStart() {
    if (!champReady) return toast('🏆 시즌을 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요');
    if (!isOpen(carId)) { toast('🔒 가진 차로 바꿔 주세요'); return openPrepGarage(); }
    if (view !== 'season') return show('season');
    const order = [...seasonMaps];
    if (!order.length) return toast('달릴 맵을 하나 이상 골라 주세요');
    const current = champState();
    if (current) {
      const me = champMod.champStandings(current).find(d => d.isPlayer);
      const choice = await seasonOverwriteDialog(`진행 중인 시즌(${current.results.length}/${current.maps.length}경기, ${me?.points || 0}점)이 있어요 · 새로 시작하면 지워져요`);
      if (choice === 'resume') return resumeChamp();
      if (choice !== 'new') return;
    }
    const c = carOf(carId);
    let url;
    try {
      url = champMod.startChamp({ classId: c.class || null, carId, level: settings.get('botLevel') || 'normal', maps: order, bots: settings.get('bots') || 5 });
    } catch (err) {
      console.warn('챔피언십 시작 실패', err);
      return toast('🏆 시즌을 시작하지 못했어요');
    }
    setLast({ map: order[0], car: carId, mode: 'champ' });
    launch(url, '🏆 시즌 개막', order.length + '경기 · ' + mapOf(order[0]).title);
  }
  views.mode.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-champ]');
    if (!b) return;
    e.stopPropagation();
    pickMode('champ');
    if (b.dataset.champ === 'resume') return resumeChamp();
    if (await confirmDialog('시즌을 그만둘까요?', '지금까지 모은 챔피언십 점수가 사라지고 되돌릴 수 없어요.', '그만두기', '계속하기')) {
      champMod.abandonChamp();
      uiSound('back');
      refreshModes();
    }
  });
  settings.onChange(refreshModes);
  // 클릭으로 포커스가 옮겨질 때 focusin이 먼저 방식을 바꿔요. 누르기 전 선택을 기억해 첫 클릭은 선택만.
  let modeClickFrom = null;
  views.mode.addEventListener('pointerdown', (e) => {
    modeClickFrom = e.target.closest('[data-pick]') ? raceMode : null;
  });
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
      if (raceMode === pick.dataset.pick && (e.detail === 0 || modeClickFrom === pick.dataset.pick)) nextMode();
      else pickMode(pick.dataset.pick, true);
      modeClickFrom = null;
    }
  });
  views.mode.addEventListener('focusin', (e) => {
    const box = e.target.closest('.h-mode');
    if (box) pickMode(box.dataset.mode);
  });
  function pickMode(id, sound = false) {
    if (raceMode === id) return;
    if (!modeOpen(id)) return; // 잠긴 방식 (누르면 잠금 말풍선은 click 잡기에서)
    raceMode = id;
    if (sound) uiSound('move');
    setLast({ mode: id });
    refreshModes();
    refreshFlow();
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
    if (!isOpen(carId)) { toast('🔒 가진 차로 바꿔 주세요'); return openPrepGarage(); }
    if (!modeOpen(mode)) mode = 'race'; // 잠긴 방식이 남아 있으면 봇 레이스로
    clampBotLevel();
    if (mode === 'champ') return view === 'season' ? champStart() : show('season');
    setLast({ map: mapId, car: carId, mode });
    if (mode === 'net') return openLobby({ map: mapId, car: carId });
    launching = true;
    uiSound('select');
    const m = mapOf(mapId), c = carOf(carId), rm = RACE_MODES.find((x) => x.id === mode);
    $('#hLaunch').innerHTML = `<div class="logo">트랜스폼 레이서</div><div class="map">${esc(m.title)}</div><div class="car">${esc(c.name)}</div><div class="mode">${rm ? `${rm.icon} ${esc(rm.name)}` : ''}</div>`;
    const extra = mode === 'race' || mode === 'time' || mode === 'item' ? { mode } : {};
    wheelGo(raceUrl(mapId, carId, extra), { title: m.title, sub: c.name });
  }
  /** 다른 주소로 출발 (챔피언십 등): 출발 화면을 보여 주고 이동 */
  function launch(url, title, sub = '') {
    if (launching || !url) return;
    launching = true;
    uiSound('select');
    $('#hLaunch').innerHTML = `<div class="logo">트랜스폼 레이서</div><div class="map">${esc(title)}</div><div class="car">${esc(sub)}</div>`;
    wheelGo(url, { title, sub });
  }
  function firstRace() {
    settings.set('racingLine', true);
    settings.set('gearbox', 'auto');
    setLast({ map: 'starter', car: 'f1', mode: 'race' });
    launch(raceUrl('starter', 'f1', { mode: 'race', bots: 3, botLevel: 'easy', rookie: 1, intro: 0, guide: 1 }), '첫 레이스 · 변신 연습장', '한 바퀴에 배·비행·점프 · 쉬운 봇 3대');
  }
  function startTutorial() {
    if (launching) return;
    launching = true;
    uiSound('select');
    try {
      localStorage.setItem(TUT_KEY, localStorage.getItem(TUT_KEY) || 'asked');
    } catch {}
    $('#hLaunch').innerHTML = `<div class="logo">트랜스폼 레이서</div><div class="map">🎓 튜토리얼</div><div class="car">구름섬 그랑프리 · ${esc(carOf(carId).name)}</div>`;
    wheelGo(tutorialUrl(carId, { quick: 1, intro: 0, bots: 0 }), { title: '튜토리얼', sub: carOf(carId).name });
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
    if (b.dataset.go) {
      if(b.dataset.go === 'car' && b.dataset.carSection) { garageOnly = true; garageReturn = 'main'; }
      if(b.dataset.shopCarId)selectCar(b.dataset.shopCarId);
      show(b.dataset.go);
      // 샵의 코스튬 구경은 성능표 아래를 다시 찾지 않아도 바로 보여 줌.
      if (b.dataset.go === 'car' && ['costume','parts'].includes(b.dataset.carSection)) {
        garageDetail(true);
        setCarTab(b.dataset.carSection === 'parts' ? 'parts' : 'custom');
        requestAnimationFrame(() => views.car.querySelector(b.dataset.carSection==='parts'?'[data-slot]':'.mt-costume-box .mt-costume.on, .mt-costume-box .mt-costume')?.focus({ preventScroll: true }));
      }
      return;
    }
    const act = b.dataset.act;
    if (act === 'start') view === 'main' ? show(playView()) : start();
    else if (act === 'coachChip') { closeLockTip(); coach.queue(); }
    else if (act === 'prepGarage') openPrepGarage();
    else if (act === 'garage') { garageReturn = 'main'; garageOnly = true; garageDetail(false, false); show('car'); }
    else if (act === 'nextMode') nextMode();
    else if (act === 'metaShop' || act === 'metaGoals') { show('meta'); metaPage.showTab(act === 'metaShop' ? 'shop' : 'goals'); }
    else if (act === 'tutorial') startTutorial();
    else if (act === 'acLesson') {
      const lm = lessonMeta(b.dataset.id);
      if (lm) launch(raceUrl(lm.map, carId, { academy: lm.id, ...(lm.extra || {}) }), `🎓 ${lm.name}`, `드라이빙 아카데미 · ${carOf(carId).name}`);
    } else if (act === 'acExam') {
      const lv = LICENSES.find((x) => x.id === b.dataset.lic);
      if (!lv) return;
      if (!academy.canTake(lv.id)) {
        uiSound('back');
        return toast(`🔒 ${LICENSES[LICENSES.indexOf(lv) - 1].name}을 먼저 따요`);
      }
      try {
        sessionStorage.setItem('gimmick.academy.exam', JSON.stringify({ lic: lv.id, i: 0, tries: 0, results: [] }));
      } catch {}
      const lm = lessonMeta(lv.tasks[0]);
      launch(raceUrl(lm.map, carId, { academy: 'exam', lic: lv.id, task: 0, ...(lm.extra || {}) }), `🎓 ${lv.name} 시험`, `${lv.sub} · ${carOf(carId).name}`);
    }
    else if (act === 'multi') openLobby({ map: mapId, car: carId });
    else if (act === 'mute') {
      settings.set('muted', !settings.get('muted'));
      showMute();
      uiSound('toggle');
    }
    else if (act === 'prevCar') stepCar(-1);
    else if (act === 'nextCar') stepCar(1);
    else if (act === 'carList') garageDetail(false);
    else if (act === 'carDetail') garageDetail(true);
    else if (act === 'carCompare') compare.open(carId);
    else if (act === 'carFront') preview.resetView();
    else if (act === 'pickCar') nextCar();
    else if (act === 'buyCar') buyCarFlow(carId);
    else if (act === 'editKeys') show('settings', true, 'keys');
    else if (act === 'name') {
      const r = await welcomeDialog({ first: false });
      if (r && r.logout) logoutFlow();
      else if (r && r.reload) {
        // 계정 저장 (2026-11-15): 다른 계정으로 바꿨거나 서버 진행을 받아 합침 → 홈을 새로 열어 그 진행으로
        cloudToastNext(r.msg || '👤 계정 진행을 불러왔어요');
        location.reload();
      } else if (r) {
        myLevel = unlocks.currentLevel(); // 계정에 들어가면 다른 기기 경험치까지 합친 레벨
        showName();
        if (r.msg) toast(r.msg);
        if (view === 'records') renderOnline();
      }
    }
    else if (act === 'logout') logoutFlow();
    else if (act === 'olMap') {
      // 기록 화면 위 맵 띠: 고른 맵으로 순위표·내 기록 둘 다 바꿈
      if (olMap !== b.dataset.map) {
        olMap = b.dataset.map;
        uiSound('move');
        views.records.querySelectorAll('.hr-mchip').forEach((c) => c.classList.toggle('sel', c.dataset.map === olMap));
        renderMine();
        renderOnline();
      }
      revealRecMap();
    }
    else if (act === 'recScroll') {
      const strip = views.records.querySelector('.hr-maps');
      if (strip) strip.scrollBy({ left: Number(b.dataset.dir) * strip.clientWidth * 0.8, behavior: 'smooth' });
    }
    else if (act === 'recRace') {
      // 이 맵으로 바로 레이스 준비
      selectMap(olMap);
      show('map');
    }
    else if (act === 'olCar') {
      olCarOnly = !olCarOnly;
      renderOnline();
    }
    else if (act === 'olStock') {
      olStockOnly = !olStockOnly;
      try { localStorage.setItem('gimmick.olStock', olStockOnly ? '1' : '0'); } catch {}
      renderOnline();
    }
    else if (act === 'olCopyBuild') {
      // '이 조립 따라 하기' (부품 조립 1차 ⑤): 내가 가진 부품만 끼우고 없는 칸은 순정
      const car = b.dataset.car, nick = b.dataset.nick;
      const r = await online.copyBuildFrom(car, b.dataset.build);
      const cn = (carOf(car) && carOf(car).name) || car;
      if (!r.ok) toast(r.message || '조립을 바꾸지 못했어요');
      else if (r.same) toast(`🔧 ${nick}의 조립을 내 ${cn}에 끼웠어요`);
      else if (r.sig === 'stock') toast(`🔧 ${cn} · 아직 가진 부품이 없어 순정이에요 · 필요한 부품: ${r.missing.map((m) => m.name).join(', ')}`);
      else toast(`🔧 가진 부품만 끼웠어요 · 없는 부품(순정 칸): ${r.missing.map((m) => m.name).join(', ')}`);
      // 강화 단계는 내 것 그대로 (online.copyBuildFrom levels = 단계가 다른 칸)
      if (r.ok && r.levels && r.levels.length) setTimeout(() => toast(`★ 강화 단계는 따라 할 수 없어요 · ${r.levels.map((x) => `${x.short || x.name} 내 ★${x.myLv} / 그 사람 ★${x.wantLv}`).join(', ')}`), 2700);
    }
    else if (act === 'olGhost') {
      const nick = b.dataset.nick, car = b.dataset.car, map = olMap, pid = b.dataset.pid;
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
      try {
        const json = await online.ghost(map, car, pid);
        if (!json) return toast('이 기록에는 고스트가 없어요. 다른 기록의 👻를 골라 주세요');
        // 다음 화면에서 같은 주행 파일을 두 번 받지 않도록 한 번만 전달해요.
        try { sessionStorage.setItem('gimmick.friendGhost.pending', JSON.stringify({ map, car, pid, json, at: Date.now() })); } catch {}
        setLast({ map, car, mode: 'time' });
        launch(raceUrl(map, car, { mode: 'time', ghost: pid, ghostCar: car, ghostName: nick }), mapOf(map).title, `👻 ${nick} 고스트와 · ${carOf(car).name}`);
      } catch {
        toast('고스트를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요');
      } finally {
        b.disabled = false;
        b.removeAttribute('aria-busy');
      }
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
    if (e.target?.isContentEditable) return;
    const k = e.code;
    if (k === 'KeyC' && ['map','season'].includes(view)) { e.preventDefault(); openPrepGarage(); return; }
    if (coach.running) return; // 안내 중에는 coachMarks가 키를 받음
    const act = document.activeElement;
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[k];
    if (k === 'Escape' || k === 'Backspace') {
      e.preventDefault();
      if (view === 'car' && carDetail && garageReturn === 'main') garageDetail(false);
      else if (view !== 'main') show(backView());
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
    if (view === 'car' && !carDetail && (k === 'KeyQ' || k === 'KeyE' || k === 'PageUp' || k === 'PageDown')) {
      e.preventDefault();
      stepClass(k === 'KeyQ' || k === 'PageUp' ? -1 : 1);
      return;
    }
    // 차 고르기: [ ] (패드 LT / RT) = 정보 칸 탭 (소개 · 성능 · 커스텀)
    if (view === 'car' && (k === 'BracketLeft' || k === 'BracketRight')) {
      e.preventDefault();
      const inTabs = act && act.closest && act.closest('.ct-tabs');
      stepCarTab(k === 'BracketLeft' ? -1 : 1, !!inTabs);
      return;
    }
    if (dir) {
      e.preventDefault();
      // 차 정보 탭 위: ←→ = 탭 바꾸기
      if (view === 'car' && (dir === 'left' || dir === 'right') && act && act.classList && act.classList.contains('ct-tab')) {
        stepCarTab(dir === 'left' ? -1 : 1, true, true);
        return;
      }
      // 차 정보 칸 안(색·코스튬·바로 가기): ←→ = 칸 안에서 옆 버튼으로 (차는 그대로)
      if (view === 'car' && (dir === 'left' || dir === 'right') && act && act.closest && act.closest('.ct-body')) {
        if (spatialMove(carInfoEl.querySelector('.ct-body'), dir)) uiSound('move');
        return;
      }
      // 설정 줄: ←→ = 값 바꾸기
      if ((dir === 'left' || dir === 'right') && act && act.dataset && act.dataset.adjust) {
        setPanel.adjust(act.dataset.adjust, dir === 'left' ? -1 : 1);
        return;
      }
      // 차 고르기: ←→ = 다른 차
      if (view === 'car' && !carDetail && (dir === 'left' || dir === 'right') && !(act && act.closest('.h-carinfo .btns'))) {
        stepCar(dir === 'left' ? -1 : 1);
        return;
      }
      // 맵 고르기: 방향키는 맵 목록 안에서만 (사용자 요청 2026-11-17: 위로 가면 재화, 아래로 가면 '방식' 버튼으로 빠졌음)
      // 출발 = Enter, 방식 = Backspace, 차고 = C 그대로. 목록 밖(아래 버튼 줄)에서 ↑↓ = 고른 맵으로 돌아옴
      if (view === 'map') {
        const grid = views.map.querySelector('.h-mapgrid');
        if (grid) {
          if (act && grid.contains(act)) { if (spatialMove(grid, dir)) uiSound('move'); grid.__last = document.activeElement; return; }
          if (dir === 'up' || dir === 'down' || !(act && views.map.contains(act))) {
            const sel = (grid.__last && grid.contains(grid.__last) && grid.__last) || grid.querySelector('.h-map.sel') || grid.querySelector('[data-nav]');
            if (sel) { sel.focus({ preventScroll: true }); sel.scrollIntoView({ block: 'nearest' }); uiSound('move'); }
            return;
          }
        }
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
        garageDetail(true);
        return;
      }
      if (view === 'car' && carDetail && k !== 'Space' && !(act && act.closest('.ct-body,.ct-tabs,.g2-stagebar,.btns'))) { e.preventDefault(); nextCar(); return; }
      if (act && act.dataset && act.dataset.adjust) {
        e.preventDefault();
        setPanel.adjust(act.dataset.adjust, 1);
        return;
      }
      if (!act || act === document.body) {
        e.preventDefault();
        if (view === 'main') show(playView());
        else if (view === 'mode') nextMode();
      }
    }
  });

  // 처음 화면
  setCarTab(carTab, { save: false });
  setClassTab('all');
  selectCar(carId);
  selectMap(mapId);
  refreshModes();
  // ?menu=로 잠긴 화면을 열면 홈으로 (Lv1의 ?menu=mode = 방식이 하나라 맵 고르기로)
  const menuParam = params.get('menu');
  const MENU_GATE = { car: 'garage', records: 'records', ranking: 'records', meta: 'goals', achievements: 'goals', goals: 'goals', shop: 'shop' };
  const menuLocked = !!(menuParam && MENU_GATE[menuParam] && !G(MENU_GATE[menuParam]));
  const startView = menuLocked ? 'main' : menuParam === 'mode' && !G('time') ? 'map' : menuParam;
  if (menuLocked) setTimeout(() => toast(`${gate.lockText(MENU_GATE[menuParam])} · 레이스를 달리면 '${gate.featureOf(MENU_GATE[menuParam]).name}' 기능이 열려요`), 300);
  if (startView === 'car' && (params.has('carTab') || params.has('car'))) garageDetail(true, false);
  if (startView === 'keys' || startView === 'pad') show('settings', true, startView);
  else if (['achievements', 'goals', 'shop'].includes(startView)) { show('meta'); metaPage.showTab(startView === 'achievements' ? 'achievements' : startView); }
  else show(['meta', 'car', 'map', 'settings', 'controls', 'records', 'mode', 'academy'].includes(startView) ? startView : startView === 'ranking' ? 'records' : 'main');
  // 레이스 방식 → 맵 / 시즌 구성. 차고는 별도 왕복 화면이에요.
  function refreshFlow() {
    const lastStep = raceMode === 'champ' ? 'season' : 'map';
    const withMode = G('time'); // Lv1은 방식 단계 없이 맵 → 출발
    for (const [v, n0] of [['mode', 1], ['car', 0], ['map', 2], ['season', 2]]) {
      const n = withMode || !n0 ? n0 : n0 - 1;
      let f = views[v].querySelector('.hx-flow');
      if (!f) { f = document.createElement('nav'); f.className = 'hx-flow'; f.setAttribute('aria-label', '레이스 준비 단계'); views[v].prepend(f); }
      f.hidden = v === 'car';
      f.innerHTML = [...(withMode ? [['mode', '방식']] : []), [lastStep, raceMode === 'champ' ? '시즌 맵 구성' : '맵']]
        .map(([id, t], i) => '<button class="' + (i + 1 === n ? 'on' : i + 1 < n ? 'done' : '') + '" data-go="' + id + '" ' + (i + 1 > n ? 'disabled tabindex="-1"' : 'tabindex="-1"') + (i + 1 === n ? ' aria-current="step"' : '') + '><b>' + (i + 1 < n ? '✓' : i + 1) + '</b>' + t + '</button>').join('<i>›</i>') + '<i>›</i><span class="end">🏁 출발</span>';
    }
  }
  refreshFlow();

  view === 'main' && views.main.querySelector('.h-start').focus({ preventScroll: true });
  // 레벨 합치기 (2026-11-12): 서버에서 같은 계정 다른 기기 경험치를 받아 온 뒤 레벨·레벨 업 알림
  // 서버 응답을 기다리지 않고 홈을 처음 그릴 때 안내해요. 0 코인은 조용히 정리해요.
  const migration = meta.migrationNotice();
  const migrationNews = migration?.coins > 0
    ? accountNotice('재화가 3가지 조각으로 바뀌었어요', `예전 피트 코인 ${migration.coins.toLocaleString('ko-KR')}은 정리되고 산 물건은 모두 그대로예요 · 조각은 레이스·업적·목표로 모아요`, 'wallet-migration').then(() => meta.acknowledgeMigration())
    : Promise.resolve();
  if (migration && !migration.coins) meta.acknowledgeMigration();
  let newsDone = false;
  const levelNews = async () => {
    if (newsDone) return;
    newsDone = true;
    await migrationNews;
    applyGate(); // 서버 경험치를 받은 뒤 레벨이 바뀌었을 수 있음
    // 해금 안내 순서: (기존 사용자) '새 안내 n개' 한 번 → 레벨 업 창(+새 기능) → 설정·주소로 부탁한 안내
    if (gate.urlCoach() && gate.coachActive()) { gate.markSeen(); gate.markSeenAll(false); } // ?coach=<id> 시험: 창 없이 그 안내만
    else if (gateInfo.legacy && gate.coachActive()) showLegacyCard();
    else showLevelNews();
    const want = gate.coachActive() ? gate.urlCoach() || gate.takeReplay() : null;
    if (want && !params.get('join')) setTimeout(() => coach.run(want), 0); // 창이 떠 있으면 닫힐 때까지 기다림
    refreshCoachChip();
  };
  online
    .syncXp()
    .then((r) => {
      if (!r) return;
      myLevel = unlocks.currentLevel();
      showDriver();
      if (view === 'car') renderCarList();
    })
    .catch(() => {})
    .finally(() => setTimeout(levelNews, 150));
  setTimeout(levelNews, 2500); // 서버가 느리면 기다리지 않음
  setTimeout(startThumbs, 2800); // 메인 화면에 있어도 미리 찍어 둠 (다음부터는 저장된 사진을 바로 씀). wheelfx2: 1.5→2.8초 = 바퀴가 굴러 나간 뒤에 (겹치면 바퀴가 끊김)
  const ld = document.getElementById('loading');
  if (ld) {
    ld.classList.add('out');
    setTimeout(() => ld.remove(), 450);
  }
  // 멀티플레이 초대 링크 (?join=코드) → 참가 창을 바로 엶
  const joinCode = params.get('join');
  if (joinCode) openLobby({ join: joinCode, map: mapId, car: carId });
  else if (!startView || params.get('first') === '1') {
    let asked = null, ready = null;
    try { asked = localStorage.getItem(TUT_KEY); ready = localStorage.getItem('gimmick.firstRun'); } catch {}
    const hasRecords = records.any(); // 예전 코스 기록만 있어도 돌아온 사람 (mapver)
    const p = profile.get();
    const returning = hasRecords || p.races > 0 || p.xp > 0 || !!getNick() || !!asked || !!ready;
    if (params.get('first') === '1' || !returning) {
      home.classList.add('nf-active');
      home.inert = true;
      firstDriveDialog((mode) => preview.setMode(mode)).then((choice) => {
        home.inert = false;
        home.classList.remove('nf-active');
        showName();
        if (choice === 'tutorial') launch(tutorialUrl('f1', { quick: 1, intro: 0, bots: 0 }), '운전 감각 익히기', '출발 · 라인 색 · 자동 변신');
        else if (choice === 'race') firstRace();
        else { selectMap('starter'); selectCar('f1'); views.main.querySelector('.h-start').focus({ preventScroll: true }); }
      });
    }
  }
  // 이름 (멀티플레이 대기실과 같은 'gimmick.nick')
  function showName() {
    const n = getNick();
    $('.h-name .nm').textContent = n || '이름 정하기';
    $('.h-name').classList.toggle('empty', !n);
    showDriver();
  }
  showName();
  showMute();
  // 게임패드가 연결되면 아래 안내에 패드 버튼도
  function padHint() {
    const on = pad.connected();
    const h = $('.h-foot .padhint');
    h.hidden = !on;
    if (on) h.innerHTML = `🎮 스틱/방향 버튼 고르기 · ${padKbd(0)} 확인 ${padKbd(1)} 뒤로 ${padKbd(4)}${padKbd(5)} 탭<span class="ct-foothint"> · ${padKbd(6)}${padKbd(7)} 정보 탭</span>`;
    home.querySelectorAll('.h-foot .gm-hint > span:not(.padhint)').forEach(el => { el.hidden = on; el.style.display = on ? 'none' : ''; });
    home.querySelectorAll('[data-view="map"] .bar kbd, [data-view="mode"] .bar kbd, .h-qe kbd').forEach(el => {
      const key = el.dataset.keyboardHint || el.textContent;
      el.dataset.keyboardHint = key;
      el.hidden = on && key === 'Backspace';
      el.style.display = el.hidden ? 'none' : '';
      el.textContent = on ? ({ Enter: pad.name(0), Q: pad.name(4), E: pad.name(5) })[key] || key : key;
    });
    const mapHint = home.querySelector('.mp-lhint');
    if (mapHint) mapHint.textContent = on ? '방향 버튼 고르기 · ' + pad.name(0) + ' 출발' : '↑↓←→ 고르기 · Enter 출발';
  }
  padHint();
  pad.onConnect(padHint);
  window.home = { show, selectCar, selectMap, start, startTutorial, openLobby, preview, coach, gate, applyGate, welcome: welcomeDialog, champ: champStart, get mode() { return raceMode; }, get view() { return view; }, get carId() { return carId; }, get mapId() { return mapId; } };
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
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'low' ? 1 : q === 'medium' ? 1.25 : 1.5));
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
      wake();
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
    mode: 'normal', sink: 0, forwardSpeed: 0, thr: 0, grounded: true, surface: 'road', 
    steerVisual: 0, load: 0, form: null, flying: false, boostTime: 0, brk: 0,
  };
  let model = null, holder = null, drop = 0;
  let dirty = true, settleLeft = 2200;
  // homeperf: 변신/카메라가 자리를 잡은 뒤에는 마지막 프레임을 그대로 보관.
  const wake = (ms = 2200) => { dirty = true; settleLeft = ms; };
  let renderHolds = 0;
  const api = { carId: null, invalidate: wake, hold() { renderHolds++; let released = false; return () => { if (!released) { released = true; renderHolds--; wake(); } }; } };

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

  const lift = createGarageLift(table);
  let swapSlot=null, savedOrbit=null, restoreTurn=false;
  const cameraLook = new THREE.Vector3(0,.45,0);
  api.resetView=()=>{wake();if(!lift.active){angle=-.6; pitch=.27;zoom=1;restoreTurn=false;}};
  api.setParts = build => { model?.setParts?.(parts.partLook(build)); wake(); };
  api.replacePart = async (build,slot) => {
    const skip=document.createElement('button');skip.className='pu-skip';skip.textContent='🔧 부품 교체 중 · 건너뛰기 ↵';swapSlot=slot;savedOrbit={angle,pitch,zoom};dragging=false;home.classList.add('g2-fitting');home.append(skip);
    const key=e=>{if(['Enter','Escape'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();lift.skip();}};
    const click=e=>{e.preventDefault();e.stopImmediatePropagation();lift.skip();};
    window.addEventListener('keydown',key,true);window.addEventListener('pointerdown',click,true);
    try{await lift.play(()=>api.setParts(build));}finally{swapSlot=null;if(savedOrbit){angle=savedOrbit.angle;pitch=savedOrbit.pitch;zoom=savedOrbit.zoom;}savedOrbit=null;restoreTurn=true;home.classList.remove('g2-fitting');skip.remove();window.removeEventListener('keydown',key,true);window.removeEventListener('pointerdown',click,true);}
  };
  api.setCar = (c) => {
    wake();
    lift.skip();
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
    model.setParts?.(parts.partLook(parts.getBuild(c.id)));
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
    wake();
    fake.mode = mode;
    fake.flying = false;
    fake.surface = 'road'; // 땅 위 모습 (배는 선체가 원판 위에 올라앉음)
    dirty = true;
  };

  // 화면마다 차가 놓이는 자리 (화면 가로 비율, 세로 비율)
  //   [가로 위치, 세로 위치, 원판이 화면에서 차지할 너비(px)]
  let spot = null, viewName = 'main';
  api.setView = (name) => {
    wake();
    viewName = name; ring.visible = name !== 'main'; shadowCatcher.material.opacity = name === 'main' ? .22 : .55;
    table.children.forEach(o => { if (o !== holder && o !== shadowCatcher) o.visible = name !== 'main'; });
    canvas.style.clipPath='';
    dirty = true;
  };
  function targetSpot() {
    const w = innerWidth, h = innerHeight;
    if (home.classList.contains('nf-active')) return w < 720 ? [0.5, 0.25, Math.min(w * 0.75, h * 0.35)] : [0.75, 0.5, Math.min(w * 0.46, h * 0.9)];
    if (viewName === 'car') {
      // 차 고르기: 가운데 칸(목록과 정보 사이) 가운데에
      const st = home.querySelector('.h-carstage');
      const r = st && st.getBoundingClientRect();
      if (r && r.width > 40) { return [(r.left + r.width / 2) / w, (r.top + r.height * 0.45) / h, Math.min(r.width * 0.95, r.height * 1.5)]; }
    }
    // M3: 풍경 앞 왼쪽에 내 차를 세워요.
    if (w < 600) return [.5,.34,Math.min(w*.76,h*.40)];
    if (h < 480) return [.35,.50,Math.min(w*.48,h*1.05)];
    return [.36,.53,Math.min(w*.57,h*1.22)];
  }

  // 마우스·터치로 수동 회전, 손을 떼면 정지
  let angle = -0.6, dragging = false, lastX = 0, lastY=0, pitch=.27, zoom=1;
  home.addEventListener('pointerdown', (e) => {
    if(lift.active || e.target.closest('button,input,select,.h-carinfo,.h-carlist,.h-top,[data-nav],.h-page,.gx-news'))return; // 설정 줄 같은 버튼 아닌 칸도 눌리게 (예전엔 홈이 포인터를 잡아 click이 #home에서 났음)
    const stage=home.querySelector('.g2-detail .h-carstage')?.getBoundingClientRect();
    if(viewName==='car' && (!stage || e.clientX<stage.left || e.clientX>stage.right || e.clientY<stage.top || e.clientY>stage.bottom))return;
    wake();dragging = true;lastY=e.clientY;
    lastX = e.clientX;
    home.setPointerCapture(e.pointerId);
  });
  home.addEventListener('pointermove', (e) => {
    if (!dragging || lift.active) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    pitch=THREE.MathUtils.clamp(pitch+(e.clientY-lastY)*.004,.08,.85);lastY=e.clientY;
    angle += dx * 0.009;
    wake();
  });
  const endDrag = () => (dragging = false);
  home.addEventListener('pointerup', endDrag);
  home.addEventListener('pointercancel', endDrag);

  home.addEventListener('wheel',e=>{if(viewName!=='car'||lift.active||e.target.closest('.h-carinfo,.h-carlist'))return;e.preventDefault();wake();zoom=THREE.MathUtils.clamp(zoom+e.deltaY*.0005,.78,1.3);},{passive:false});
  let W = 0, H = 0, drawRect = {left:0,top:0,width:0,height:0};
  function resize() {
    const w = innerWidth, h = innerHeight;
    // 상세 화면은 실제 차 칸만 할당. 전체 화면 투영의 같은 부분을 잘라 구도는 유지.
    const stage = viewName === 'car' && home.querySelector('.g2-detail .h-carstage');
    const r = stage && stage.getBoundingClientRect();
    const rect = r && r.width > 40 ? {left:r.left,top:r.top,width:r.width,height:r.height} : {left:0,top:0,width:w,height:h};
    if (w === W && h === H && Object.keys(rect).every(k => rect[k] === drawRect[k])) return;
    W = w;
    H = h;
    drawRect = rect;
    renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
    Object.assign(canvas.style, {inset:'auto',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let last = performance.now(), time = 0, nextFrame = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!home.isConnected || document.hidden || renderHolds) { last = now; return; }
    if (window.__wf?.busy?.()) return; // wheelfx2: 바퀴가 덮으며 다른 화면으로 가는 중엔 3D 미리 보기를 쉼 (가만히 서 있는 차라 멈춰도 티 안 남)
    // 홈의 3D 미리보기도 사용자가 고른 프레임 제한을 따름 (고주사율 화면 발열/배터리).
    const cap = settings.get('fpsCap');
    if (cap) {
      const interval = 1000 / cap;
      if (now < nextFrame - 2) return;
      nextFrame = now - nextFrame > interval ? now + interval : nextFrame + interval;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // 흐리게 깔리는 화면(맵·설정 등)에서는 그리지 않음 (노트북 발열 줄이기)
    const dim = home.classList.contains('dim');
    if (dim || viewName === 'compare' || home.classList.contains('g2-catalog')) { last = now; return; }
    if (!dirty && !dragging && !lift.active && !restoreTurn && settleLeft <= 0) { last = now; return; }
    resize();
    time += dt;
    // 손을 떼면 그 자리에서 멈춤.
    if(lift.active || restoreTurn){table.rotation.y=THREE.MathUtils.lerp(table.rotation.y,lift.active?0:angle,1-Math.exp(-10*dt));if(!lift.active&&Math.abs(table.rotation.y-angle)<.001)restoreTurn=false;}else table.rotation.y=angle;
    // 새 차가 살짝 위에서 내려앉음
    if (holder) {
      drop = reduceMotion.matches ? 1 : Math.min(1, drop + dt / 0.45);
      const e = 1 - Math.pow(1 - drop, 3);
      holder.position.y = holder.userData.baseY + 0.7 * (1 - e) + Math.sin(drop * Math.PI) * 0.03;
    }
    ringMat.opacity = THREE.MathUtils.lerp(ringMat.opacity, 0.55 + 0.15 * Math.sin(time * 2), 1 - Math.exp(-3 * dt));
    if (model) model.sync(fake, dt, time);
    lift.update(holder);
    if (holder) holder.position.y += 0; // sync가 root 위치를 0으로 둠 (holder가 높이 담당)

    // 화면 속 차 위치: 카메라 투영을 옆으로 밀어서(setViewOffset) 원하는 자리에
    const spotT = targetSpot();
    if (!spot) spot = [...spotT];
    for (let i = 0; i < 3; i++) spot[i] = THREE.MathUtils.lerp(spot[i], spotT[i], 1 - Math.exp(-6 * dt));
    // 차+원판 가운데 부분(약 6.4 m)이 spot[2] 픽셀 너비로 보이는 거리: 화면 높이 H 픽셀 = 2·거리·tan(시야/2)
    const dist = (6.4 * H) / (2 * Math.tan(THREE.MathUtils.degToRad(28 / 2)) * Math.max(120, spot[2]));
    const fitting = lift.active && PART_VIEW[swapSlot];
    const dest = fitting ? new THREE.Vector3(...fitting.pos).multiplyScalar(Math.max(1,dist/9)) : new THREE.Vector3(0,dist*pitch*zoom,dist*zoom);
    const aim = fitting ? new THREE.Vector3(...fitting.look) : new THREE.Vector3(0,.45,0);
    if(fitting){const liftY=(holder?.userData.baseY || 0)+.3;dest.y+=liftY;aim.y+=liftY;}
    camera.position.lerp(dest,1-Math.exp(-8*dt));cameraLook.lerp(aim,1-Math.exp(-8*dt));
    camera.fov=THREE.MathUtils.lerp(camera.fov,fitting?.fov || 28,1-Math.exp(-8*dt));
    camera.lookAt(cameraLook);
    camera.setViewOffset(W, H, (0.5 - spot[0]) * W + drawRect.left, (0.5 - spot[1]) * H + drawRect.top, drawRect.width, drawRect.height);
    renderer.render(scene, camera);
    // 실제로 진행한 변신 시간만 센다. 느린 PC에서도 중간 모습으로 멈추지 않음.
    settleLeft = Math.max(0, settleLeft - dt * 1000);
    dirty = false;
  }
  requestAnimationFrame(loop);
  // 창 크기를 바꾸면 다시 그림
  addEventListener('resize', () => wake());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  api.renderer = renderer;
  api.scene = scene;
  api.camera = camera;
  return api;
}

// ------------------------------------------------------------------ 이름 (net.js와 같은 저장 칸 'gimmick.nick')
const NICK_KEY = 'gimmick.nick';
const cleanNick = (v) => String(v || '').replace(/[<>&"]/g, '').trim().slice(0, 12);
const randomNick = () => ['번개', '질주', '질풍', '터보', '로켓', '바람', '유성', '폭풍', '코너', '에이펙스'][Math.floor(Math.random() * 10)] + Math.floor(10 + Math.random() * 90);
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
    if (!first) wrap.classList.add('wl-account');
    const cur = getNick();
    // 계정 저장 (2026-11-15): 지금 로그인한 계정 + [로그아웃], 다른 이름으로 들어갈 때 안내
    const meAcc = online.enabled ? online.me() : null;
    const acc = meAcc && meAcc.claimed ? meAcc : null;
    const accCs = acc && online.cloudStatus ? online.cloudStatus() : {};
    wrap.innerHTML = `<div class="box" role="dialog" aria-modal="true">
      ${first ? '<div class="wl-flag">🏁</div><h3>트랜스폼 레이서에 온 걸 환영해요!</h3><p>먼저 레이스에서 보일 <b>이름</b>을 정해 주세요. 멀티플레이와 결과표에 나와요.</p>' : '<h3>👤 내 이름</h3><p>멀티플레이 대기실과 레이스 결과표에 보이는 이름이에요.</p>'}
      ${!first && acc ? `<div class="wl-acc"><span class="wl-acc-who"><small>지금 로그인한 계정</small><b>🔐 ${esc(acc.nick)}</b>${accCs.missing ? '' : `<em>${accCs.linked ? '☁ 진행 저장됨' : '☁ 저장 준비 중'}</em>`}</span><button class="gm-btn small cs-logout" data-r="logout">로그아웃</button></div>` : ''}
      <div class="wl-name"><input type="text" maxlength="12" spellcheck="false" autocomplete="off" aria-label="이름"><button class="gm-btn small" data-r="dice" title="아무 이름이나">🎲</button></div>
      <small class="wl-hint">최대 12글자 · 나중에 홈 오른쪽 위 👤에서 바꿀 수 있어요</small>
      ${online.enabled ? `<div class="wl-pin"><label><span>🔐 비밀번호 <small>숫자 4자리</small></span><input type="password" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="비밀번호 숫자 4자리" placeholder="••••"${online.isMine(cur) ? ' aria-describedby="wlPinNote"' : ''}></label>
        ${online.isMine(cur) ? '<small class="wl-pinhint" id="wlPinNote">이 이름은 이미 내 것 · 비워 둬도 돼요</small>' : ''}
        ${acc ? `<small class="wl-switch">↪ 다른 이름 + 비밀번호 = 그 계정으로 들어가요 (없는 이름이면 새 계정) · ${accCs.missing ? '서버가 아직 계정 저장을 지원하지 않아 지금은 계정 바꾸기를 막고 있어요.' : `지금 진행을 <b>${esc(acc.nick)}</b> 계정에 저장할 수 있을 때만 바꿀 수 있어요.`} 이름만 바꾸려면 비밀번호를 비워 두세요</small>` : `<small class="wl-pinhint">🌐 <b>같은 이름 + 같은 비밀번호면 다른 기기에서도 같은 계정</b>이에요 · 순위표 기록과 레벨을 이어 해요 · 조각·산 물건은 서버가 계정 저장을 지원할 때 이어져요. 처음 쓰는 이름이면 이 비밀번호로 내 이름이 돼요.${first ? ' 비워 두면 순위표에는 안 올라가요.' : ''}</small>`}
        <div class="wl-err" role="alert"></div></div>` : ''}
      ${first ? `<div class="wl-keypreset"><label for="welcomeKeyPreset"><b>⌨️ 어떤 배치로 할래요?</b></label>
        <select id="welcomeKeyPreset" aria-label="조작키 배치">${PRESETS.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <small class="wl-keypreset-desc"></small><div class="wl-keypreset-keys"></div>
        <small>기본은 WASD · 나중에 설정 → 조작키에서 바꾸거나 직접 고칠 수 있어요</small></div>` : ''}
      ${first ? `<div class="wl-tut"><span class="ic">🎓</span><div><b>처음이라면 튜토리얼부터!</b><small>약 5분 · 출발 신호, 브레이크, 에이펙스, 변신(가속·배·비행)까지 직접 해 보며 배워요</small></div></div>` : ''}
      <div class="btns">${first ? '<button class="gm-btn" data-r="skip">바로 둘러보기</button><button class="gm-btn primary" data-r="tut">🎓 튜토리얼 시작<kbd>Enter</kbd></button>' : '<button class="gm-btn" data-r="cancel">취소</button><button class="gm-btn primary" data-r="ok">저장<kbd>Enter</kbd></button>'}</div></div>`;
    const inp = wrap.querySelector('input');
    const pinInp = wrap.querySelector('.wl-pin input');
    const errEl = wrap.querySelector('.wl-err');
    let purpose = first ? 'first' : 'rename';
    const actions = document.createElement('div');
    actions.className = 'wl-actions';
    if (!first) {
      actions.innerHTML = '<button class="gm-btn small" data-r="rename" aria-pressed="true">✏ 이름 변경</button>' + (online.enabled ? '<button class="gm-btn small" data-r="login" aria-pressed="false">🔑 다른 계정으로 로그인</button>' : '');
      wrap.querySelector('.wl-name').before(actions);
    }
    const setPurpose = (next) => {
      purpose = next;
      if (pinInp) { pinInp.value = ''; pinInp.closest('.wl-pin').hidden = next === 'rename'; }
      if (!first) {
        wrap.querySelector('h3').textContent = next === 'rename' ? '✏ 이름 변경' : '🔑 다른 계정으로 로그인';
        wrap.querySelector('.box > p').textContent = next === 'rename'
          ? (online.enabled && meAcc ? '기록·순위표·온라인 방 이름도 함께 바뀌어요. 레벨·조각·기록과 비밀번호는 그대로예요.' : online.enabled ? '이 기기에서 쓸 이름만 바꿔요. 온라인 계정은 로그인에서 연결해 주세요.' : '오프라인이에요. 이 기기에서 쓸 이름만 바뀌고 진행은 그대로예요.')
          : '들어갈 계정의 이름과 비밀번호를 입력해 주세요. 처음 쓰는 이름이면 새 계정이 만들어져요.';
        inp.setAttribute('aria-label', next === 'rename' ? '새 이름' : '로그인할 이름');
        inp.placeholder = next === 'rename' ? '새 이름 (최대 12글자)' : '로그인할 이름';
        wrap.querySelector('[data-r="ok"]').innerHTML = (next === 'rename' ? '이름 변경' : '로그인') + '<kbd>Enter</kbd>';
        actions.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.r === next)));
        inp.value = next === 'rename' ? cur : '';
      }
      if (errEl) { errEl.textContent = ''; errEl.classList.remove('on'); }
    };
    // 오류 안내는 비밀번호 칸을 숨겨도 보여야 해요.
    if (errEl) wrap.querySelector('.btns').before(errEl);
    const switchHint = wrap.querySelector('.wl-switch');
    if (switchHint) switchHint.textContent = accCs.missing ? '서버가 아직 계정 저장을 지원하지 않아 계정 바꾸기를 막고 있어요.' : '지금 계정에 진행을 저장한 뒤, 들어갈 계정의 진행을 불러와요.';
    const pinNote = wrap.querySelector('#wlPinNote');
    if (pinNote) pinNote.textContent = '로그인할 계정의 비밀번호를 입력해 주세요';
    setPurpose(purpose);
    const presetSelect = wrap.querySelector('#welcomeKeyPreset');
    if (presetSelect) {
      // 예전에 직접 정한 키도 보존하고, 처음 고르지 않으면 기본 WASD로 시작해요.
      presetSelect.value = keybinds.preset();
      const drawPreset = () => {
        const preset = PRESETS.find((p) => p.id === keybinds.preset());
        wrap.querySelector('.wl-keypreset-desc').textContent = preset?.desc || '';
        wrap.querySelector('.wl-keypreset-keys').innerHTML = [['throttle', '가속'], ['brake', '브레이크'], ['left', '왼쪽'], ['right', '오른쪽']]
          .map(([id, text]) => `<span><small>${text}</small>${keybinds.html(id)}</span>`).join('');
      };
      presetSelect.addEventListener('change', () => {
        keybinds.selectPreset(presetSelect.value);
        drawPreset();
        uiSound('toggle');
      });
      drawPreset();
    }
    inp.value = cur || (first ? randomNick() : '');
    if (pinInp) pinInp.addEventListener('input', () => (pinInp.value = pinInp.value.replace(/\D/g, '').slice(0, 4)));
    let busy = false;
    const fail = (msg, el) => {
      errEl.textContent = msg;
      errEl.classList.add('on');
      uiSound('back');
      (el || pinInp).focus();
      (el || pinInp).select && (el || pinInp).select();
    };
    const done = async (r) => {
      if (busy) return;
      if (r === 'rename' || r === 'login') { setPurpose(r); inp.focus(); inp.select(); return; }
      if (r === 'logout') {
        window.removeEventListener('keydown', onKey, true);
        wrap.remove();
        uiSound('select');
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        return resolve({ logout: true });
      }
      if (r) {
        const n = cleanNick(inp.value) || cur || randomNick();
        // 온라인: 비밀번호를 넣었으면 이름 + 비밀번호로 시작/이어 하기, 안 넣었으면 이 기기 계정 이름만 바꿈
        if (pinInp && online.enabled) {
          const pin = purpose === 'rename' ? '' : pinInp.value.trim();
          if (purpose === 'login' && !pin) return fail('비밀번호는 숫자 4자리예요', pinInp);
          if (pin && !/^[0-9]{4}$/.test(pin)) return fail('비밀번호는 숫자 4자리예요');
          busy = true;
          wrap.classList.add('busy');
          try {
            if (pin) {
              const res = await online.login(n, pin);
              wrap.dataset.msg = res.switched ? (res.cloud?.ok ? `👤 ${res.nick} 계정으로 바꿨어요 · 그 계정 진행을 불러왔어요` : `👤 ${res.nick} 계정으로 바꿨어요 · 진행을 받지 못했어요. 인터넷 연결 뒤 홈을 다시 열어 주세요`) : res.cloud?.missing ? `🔐 ${res.nick} 이름을 지켰어요 · 진행은 지금 이 기기에만 있어요` : res.merged ? `👤 ${res.nick} 계정으로 이어 해요 · 이 기기 기록 ${res.merged}개를 합쳤어요` : res.created || res.claimed ? `🔐 ${res.nick} 이름을 지켰어요` : res.reload ? `👤 ${res.nick} 계정으로 이어 해요 · 계정 진행을 불러왔어요` : `👤 ${res.nick} 계정으로 이어 해요`;
              if (res.reload) wrap.dataset.reload = '1';
            } else if (!(await online.rename(n))) {
              busy = false;
              wrap.classList.remove('busy');
              return fail('이미 쓰는 이름이에요 · 다른 이름을 골라 주세요', inp);
            } else {
              wrap.dataset.msg = `👤 이름을 ${n}(으)로 바꿨어요 · 진행은 그대로예요`;
            }
          } catch (err) {
            busy = false;
            wrap.classList.remove('busy');
            return fail(err.reason ? err.message : '서버에 연결하지 못했어요 (인터넷 확인)', purpose === 'rename' ? inp : pinInp);
          }
        }
        window.removeEventListener('keydown', onKey, true);
        wrap.remove();
        setNick(n);
        const m = online.me();
        if (online.enabled && m && m.claimed && m.nick !== n) setNick(m.nick); // 서버의 이름(대소문자·띄어쓰기)을 따름
        uiSound('select');
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        resolve({ name: getNick(), tutorial: r === 'tut', msg: wrap.dataset.msg || '', reload: wrap.dataset.reload === '1' });
      } else {
        window.removeEventListener('keydown', onKey, true);
        wrap.remove();
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
      if (e.code === 'Tab') {
        const items = [...wrap.querySelectorAll('input, select, button')].filter(el => el.getClientRects().length && !el.disabled);
        e.preventDefault();
        items[(items.indexOf(a) + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
        return;
      }
      // 선택 상자에서는 화살표·Enter·Tab의 기본 동작을 그대로 써요.
      if (a === presetSelect) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (a && a.dataset && a.dataset.r === 'dice') return (inp.value = randomNick()), uiSound('move');
        return done(a && a.dataset && a.dataset.r && a !== inp ? (a.dataset.r === 'cancel' ? null : a.dataset.r) : primary);
      }
      if (['ArrowUp', 'ArrowDown'].includes(e.code) || (a !== inp && a !== pinInp && ['ArrowLeft', 'ArrowRight'].includes(e.code))) {
        e.preventDefault();
        const items = [...wrap.querySelectorAll('input, select, button')].filter(el => el.getClientRects().length && !el.disabled);
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

/** 첫 방문: 게임 소개 → 이름·조작키. 계정 등록은 홈에서 언제든 가능. */
function firstDriveDialog(onMode) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'nf';
    wrap.innerHTML = '<section class="nf-copy" role="dialog" aria-modal="true" aria-labelledby="nfTitle"><div class="nf-brand">🏁 TRANSFORM RACER <span>WELCOME, DRIVER</span></div><div class="nf-step nf-intro"><span class="nf-kicker">상상 밖의 레이스가 시작돼요</span><h1 id="nfTitle">달리고, 변신하고,<br><em>날아올라!</em></h1><p>한 대의 차로 땅 · 물 · 하늘까지.<br>운전만 하세요. 변신은 차가 알아서 해요.</p><div class="nf-route"><span>🚗 도로</span><i>→</i><span>🚤 바다</span><i>→</i><span>✈️ 하늘</span></div><h2>튜토리얼부터 해 볼까요?</h2><button class="gm-btn primary nf-choice" data-nf="tutorial"><b>운전 감각 익히기 <small>추천</small></b><span>약 3~5분 · 출발, 브레이크, 변신 맛보기</span><i>→</i></button><button class="gm-btn nf-choice" data-nf="race"><b>바로 첫 레이스</b><span>짧은 변신 연습장 · 쉬운 봇 3대와 출발</span><i>→</i></button><button class="nf-text" data-nf="home">홈부터 둘러보기</button></div><div class="nf-step nf-setup" hidden><span class="nf-kicker">출발 준비 · 마지막 한 단계</span><h2>어떻게 달릴까요?</h2><div class="nf-setup-fields"><label class="nf-label">레이스에서 쓸 이름<input maxlength="12" autocomplete="off" spellcheck="false" aria-label="레이스에서 쓸 이름"></label><small class="nf-note">지금은 별명만! 계정은 나중에 홈의 이름 버튼에서 만들 수 있어요.</small><label class="nf-label nf-keyboard-label">편한 조작키 배치<select aria-label="조작키 배치"></select></label><div class="nf-keys"></div><p class="nf-note nf-touch">휴대폰은 화면 버튼, 게임패드는 연결 후 버튼을 누르면 돼요.</p><div class="nf-ready"><b>처음엔 이것만 기억하세요</b><span>🟢 가속 → 🔴 브레이크 → 🟢 다시 가속</span><span>핸들은 짧게 톡톡 · 길을 벗어나면 복귀</span></div></div><div class="nf-actions"><button class="gm-btn" data-nf="back">‹ 이전</button><button class="gm-btn primary" data-nf="go">출발하기 →</button></div></div><div class="nf-progress"><b class="on">1 게임 소개</b><i></i><b>2 출발 준비</b></div></section><div class="nf-showcase" aria-hidden="true"><div class="nf-orbit"></div><span class="nf-form">🚗 도로에서는 자동차</span><small>한 대의 차, 네 가지 모습</small></div>';
    const touchMode = touchWanted();
    wrap.classList.toggle('nf-on-touch', touchMode);
    if (touchMode) {
      wrap.querySelector('.nf-touch').textContent = '화면 버튼의 크기와 조향 방식은 나중에 설정에서 바꿀 수 있어요.';
      wrap.querySelector('.nf-ready span:last-child').textContent = '왼쪽 패드를 조금씩 끌기 · 길을 벗어나면 ↺ 복귀';
    }
    const input = wrap.querySelector('input'), select = wrap.querySelector('select');
    input.value = getNick() || randomNick();
    select.innerHTML = PRESETS.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('');
    select.value = keybinds.preset();
    let choice = 'tutorial', step = 0;
    const keyPreview = () => {
      const usePad = pad.connected() && !touchMode;
      wrap.querySelector('.nf-keyboard-label').hidden = touchMode || usePad;
      if (usePad) {
        wrap.querySelector('.nf-keys').innerHTML = '<small>🎮 왼쪽 스틱으로 조향</small>' + [['throttle', '가속'], ['brake', '브레이크'], ['respawn', '복귀']].map(([id, label]) => '<span><b>' + label + '</b>' + pad.html(id) + '</span>').join('');
        wrap.querySelector('.nf-touch').innerHTML = padKbd(0) + ' 확인 · ' + padKbd(1) + ' 뒤로 · 스틱/방향 버튼으로 고르기';
        return;
      }
      if (!touchMode) wrap.querySelector('.nf-touch').textContent = '휴대폰은 화면 버튼, 게임패드는 연결 후 버튼을 누르면 돼요.';
      if (touchMode) {
        wrap.querySelector('.nf-keys').innerHTML = '<small>두 손가락으로 편하게 운전해요</small><span><b>왼손</b>◀ 끌어서 조향 ▶</span><span><b>오른손</b>▲ 가속 · ▼ 브레이크</span><span><b>길 밖에서는</b>↺ 복귀</span>';
        return;
      }
      const p = PRESETS.find((p) => p.id === select.value);
      wrap.querySelector('.nf-keys').innerHTML = '<small>' + esc(p?.desc || '') + '</small>' + [['throttle', '가속'], ['brake', '브레이크'], ['left', '왼쪽'], ['right', '오른쪽'], ['respawn', '복귀']].map(([id, label]) => '<span><b>' + label + '</b>' + keybinds.html(id, 1) + '</span>').join('');
    };
    select.addEventListener('change', () => { keybinds.selectPreset(select.value); keyPreview(); });
    keyPreview();
    const offPad = pad.onConnect(keyPreview);
    const forms = [['normal', '🚗 도로에서는 자동차'], ['accel', '🔥 직선에서 가속 모드'], ['boat', '🚤 물에 닿으면 배로'], ['fly', '✈️ 활주로에서는 비행기로']];
    let form = 0;
    const showForm = () => { onMode(forms[form][0]); wrap.querySelector('.nf-form').textContent = forms[form][1]; form = (form + 1) % forms.length; };
    showForm();
    const timer = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : setInterval(showForm, 3200);
    function finish() {
      setNick(cleanNick(input.value) || randomNick());
      keybinds.selectPreset(select.value);
      try { localStorage.setItem('gimmick.firstRun', 'ready'); localStorage.setItem(TUT_KEY, localStorage.getItem(TUT_KEY) || 'asked'); } catch {}
      clearInterval(timer); offPad(); onMode('normal'); wrap.remove();
      window.removeEventListener('keydown', onKey, true);
      resolve(choice);
    }
    function setup(action) {
      choice = action; step = 1;
      wrap.querySelector('.nf-intro').hidden = true;
      wrap.querySelector('.nf-setup').hidden = false;
      wrap.querySelectorAll('.nf-progress b')[1].classList.add('on');
      wrap.querySelector('[data-nf="go"]').textContent = action === 'tutorial' ? '튜토리얼 시작 →' : action === 'race' ? '첫 레이스 시작 →' : '홈으로 →';
      if (touchMode) wrap.querySelector('[data-nf="go"]').focus({ preventScroll: true });
      else { input.focus({ preventScroll: true }); input.select(); }
      wrap.scrollTop = 0;
    }
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nf]'); if (!b) return;
      const a = b.dataset.nf;
      if (a === 'go') return finish();
      if (a === 'back') { step = 0; wrap.querySelector('.nf-intro').hidden = false; wrap.querySelector('.nf-setup').hidden = true; wrap.querySelectorAll('.nf-progress b')[1].classList.remove('on'); wrap.querySelector('[data-nf="tutorial"]').focus(); return; }
      setup(a);
    });
    function onKey(e) {
      e.stopImmediatePropagation();
      const controls = [...wrap.querySelectorAll('button,input,select')].filter((x) => x.getClientRects().length);
      if (e.key === 'Tab' || (e.gmPad && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))) { e.preventDefault(); const i = controls.indexOf(document.activeElement); const back = e.shiftKey || e.code === 'ArrowUp' || e.code === 'ArrowLeft'; controls[(i + (back ? -1 : 1) + controls.length) % controls.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (step) wrap.querySelector('[data-nf="back"]').click(); else setup('home'); }
      else if (e.key === 'Enter' && document.activeElement !== select) { e.preventDefault(); if (document.activeElement?.tagName === 'BUTTON') document.activeElement.click(); else if (step) finish(); }
    }
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-nf="tutorial"]').focus({ preventScroll: true });
  });
}

function accountNotice(title, text, extraClass = '') {
 return new Promise(resolve => {
  const previous=document.activeElement, wrap=document.createElement('div');
  wrap.className='gm-confirm account-notice '+extraClass;
  wrap.innerHTML='<div class="box" role="dialog" aria-modal="true" aria-labelledby="accountNoticeTitle"><h3 id="accountNoticeTitle"></h3><p></p><div class="btns"><button class="gm-btn primary">확인<kbd>Enter</kbd></button></div></div>';
  wrap.querySelector('h3').textContent=title;wrap.querySelector('p').textContent=text;
  const close=()=>{window.removeEventListener('keydown',key,true);wrap.remove();previous?.focus?.({preventScroll:true});resolve();};
  const key=e=>{e.stopImmediatePropagation();if(['Enter','NumpadEnter','Escape'].includes(e.code)){e.preventDefault();close();}else if(e.code==='Tab'){e.preventDefault();wrap.querySelector('button').focus();}};
  wrap.querySelector('button').onclick=close;window.addEventListener('keydown',key,true);document.body.append(wrap);wrap.querySelector('button').focus();
 });
}
function seasonOverwriteDialog(text) {
  return new Promise(resolve => {
    const previous = document.activeElement, wrap = document.createElement('div');
    wrap.className = 'gm-confirm season-overwrite';
    wrap.innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-labelledby="seasonOverwriteTitle"><h3 id="seasonOverwriteTitle">새 시즌을 시작할까요?</h3><p></p><div class="btns"><button class="gm-btn primary" data-choice="resume">이어 하기</button><button class="gm-btn" data-choice="new">새로 시작</button><button class="gm-btn" data-choice="cancel">취소</button></div></div>';
    wrap.querySelector('p').textContent = text;
    const buttons = [...wrap.querySelectorAll('button')];
    const done = choice => { window.removeEventListener('keydown', key, true); wrap.remove(); previous?.focus?.({preventScroll:true}); resolve(choice); };
    const key = e => {
      e.stopImmediatePropagation();
      if (e.code === 'Escape') { e.preventDefault(); done('cancel'); }
      else if (['Enter','NumpadEnter'].includes(e.code)) { e.preventDefault(); if (!e.repeat) done(document.activeElement?.dataset.choice || 'resume'); }
      else if (['Tab','ArrowLeft','ArrowRight'].includes(e.code)) {
        e.preventDefault(); const delta = e.code === 'ArrowLeft' || (e.code === 'Tab' && e.shiftKey) ? -1 : 1;
        buttons[(buttons.indexOf(document.activeElement) + delta + buttons.length) % buttons.length].focus();
      }
    };
    wrap.addEventListener('click', e => { const b = e.target.closest('button'); if (b) done(b.dataset.choice); else if (e.target === wrap) done('cancel'); });
    document.body.append(wrap); window.addEventListener('keydown', key, true); buttons[0].focus();
  });
}

