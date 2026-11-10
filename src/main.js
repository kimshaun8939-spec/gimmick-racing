// 게임 진입점: 씬 구성, 게임 루프, 레이스 진행(카운트다운 → 주행 → 완주)
//   주소에 ?map= 이 없으면 홈 화면(home.js)을 띄우고 게임은 시작하지 않음. ?map=<맵>&car=<차> 이면 바로 게임
//   ESC = 일시정지 메뉴(pauseMenu.js), 설정(settings.js)은 바꾸는 즉시 아래 applySettings로 적용
import { setMix, duckAudio } from './audioMix.js'; // 소리 크기 조절판: 다른 소리 파일보다 먼저 불러와야 함
import * as THREE from 'three';
import { buildTrack } from './track.js';
import { Car } from './car.js';
import { createCarModel } from './carModel.js';
import { createKeyboardInput, emptyControls } from './input.js';
import { createHud } from './hud.js';
import { buildScenery } from './scenery.js';
import { buildProps } from './props.js';
import { createOffroadFx } from './offroadFx.js';
import { createEngineAudio } from './engineAudio.js';
import { createRacingLineFx } from './racingLineFx.js';
import { createKerbFx } from './kerbFx.js';
import { createTransformSfx } from './transformFx.js';
import { createSpeedFx } from './speedFx.js';
import { createGpCorners } from './gpCorners.js';
import { settings, dialogOpen } from './settings.js';
import { createPauseMenu } from './pauseMenu.js';
import { records, fmtTime } from './records.js';
import { loadMaps, loadRoster, setLast, raceUrl, homeUrl } from './gameData.js';
import { createOpponents, lookColor } from './opponents.js';
import { createRaceSystem } from './raceSystem.js';
import { createGhost } from './ghost.js';
import { createSectors } from './sectors.js';
import { fastTrack } from './fastTrack.js';
import { champRace, recordRace, champStandings, champUrl } from './championship.js';
import { createReplay } from './replay.js';
import { createCornerReport } from './cornerReport.js';

const FIXED_DT = 1 / 120; // 물리는 항상 같은 간격으로 계산 (멀티플레이/리플레이 대비)

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 불러오기 실패`);
  return res.json();
}

// 맵 선택: 주소 뒤에 ?map=gp(그랑프리) / ?map=sea(바닷가). 게임 안에서는 M 키로 차례대로 바꿈
// (사용자 요청 2026-11-09: 연습 코스 main·운동장 stadium·테스트 맵 test는 없앰 → 데이터는 .debug/removed-maps/에 보관)
// 새 맵 3개 (2026-11-10 밤샘 작업): neon 네온 시티 / moon 달 중력 기지 / jungle 정글 유적 (차원 이동)
const MAPS = { gp: 'data/grandprix.json', sea: 'data/sea.json', neon: 'data/neon.json', moon: 'data/moon.json', jungle: 'data/jungle.json' };
const MAP_ORDER = Object.keys(MAPS);
const params = new URLSearchParams(location.search);
const mapParam = params.get('map');
// 레이스 방식: ?mode=race (AI 봇과 레이스) / ?mode=time (혼자 타임 어택 + 고스트) / 없음 = 예전처럼 혼자 달리기 (테스트가 그대로 돌게)
const MODE = ['race', 'time'].includes(params.get('mode')) ? params.get('mode') : null;
// 온라인 레이스 (?room=코드): 봇 수·실력은 주소(&bots=N&botLevel=..)로 → 모든 사람이 같은 봇 (방 코드로 같은 씨앗)
const ONLINE = !!params.get('room');
if (!mapParam) {
  // 홈 화면 (차·맵 고르기). 출발하면 ?map=..&car=.. 주소로 새로 불러와서 아래 게임이 시작됨
  const { runHome } = await import('./home.js');
  await runHome();
  await new Promise(() => {}); // 홈 화면에서는 게임을 만들지 않음
}
let mapName = MAPS[mapParam] ? mapParam : 'gp';
// 로딩 화면: 맵 이름·차 이름·팁
const mapsMeta = await loadMaps();
const mapMeta = () => mapsMeta.find((m) => m.id === mapName) || { title: mapName };
const LOAD_TIPS = [
  '빨간불 5개가 꺼지는 순간 W! 미리 밟으면 시동이 꺼져요',
  'Esc를 누르면 일시정지하고 설정을 바꿀 수 있어요',
  '코너 안쪽 연석을 빠르게 스치면 에이펙스 보너스!',
  '바다에 닿으면 자동으로 배로 변신해요',
  'L 키로 레이싱 라인을 켜고 끌 수 있어요 (초록 밟기 · 빨강 브레이크)',
  '길을 벗어나면 R 키로 도로에 돌아와요',
];
const ld = (id, text) => {
  const e = document.getElementById(id);
  if (e) e.textContent = text;
};
ld('ldMap', mapMeta().title);
ld('ldTip', '💡 ' + LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)]);
// 차: ?car=<id> (없으면 기본 차 = 테스트가 늘 같은 차로 돌게). 차 목록·성능은 carRoster.js
const carParam = params.get('car');
let carCfg;
let rosterMod = null; // 봇 차 설정 불러오기용
try {
  const roster = (rosterMod = await loadRoster());
  carCfg = await roster.loadCarConfig(carParam || roster.DEFAULT_CAR_ID || 'f1');
} catch (err) {
  console.warn('차 설정 불러오기 실패 → 기본 차', err);
  carCfg = await loadJSON('data/car.json');
}
const carId = carCfg.carId || carParam || 'f1';
const carName = carCfg.carName || carId;
ld('ldCar', `🏎️ ${carName}`);
if (carParam) setLast({ map: mapName, car: carId });
// 부스터를 꺼 두면(car.json booster.enabled false) 화면 아래 부스터 버튼도 숨김
if (carCfg.booster && carCfg.booster.enabled === false) {
  const bb = document.getElementById('boosterBtn');
  if (bb) bb.style.display = 'none';
} // 홈에서 고른 것 기억 (주소에 차가 있을 때만)
let trackData;
try {
  trackData = await loadJSON(MAPS[mapName]);
} catch (err) {
  // 아직 없는 맵(만드는 중)이면 기본 코스로
  console.warn(err);
  mapName = 'gp';
  trackData = await loadJSON(MAPS.gp);
}
const FREE = !!trackData.pad; // 시험장: 카운트다운, 바퀴 수 없이 자유 주행
const mapTitle = mapMeta().title || trackData.name || mapName;
document.title = `${mapTitle} · 기믹 레이싱`;

// --- 렌더러와 씬 ---
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.get('quality') !== 'low' }); // 안티에일리어싱은 다음 시작부터 적용
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe7fb'); // 하늘은 scenery.js의 하늘 돔이 그림
scene.fog = new THREE.Fog('#cfe7fb', 260, 1150);

scene.add(new THREE.HemisphereLight('#dff1ff', '#4d6b3a', 1.1));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(60, 110, 40);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 3000);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (menuOpen()) renderer.render(scene, camera); // 일시정지 중에도 뒤 화면이 비지 않게
}
const menuOpen = () => !!(window.game && window.game.menu && window.game.menu.isOpen);
addEventListener('resize', resize);
resize();

// --- 게임 오브젝트 ---
// 맵 전용 모듈: 맵 json에 "module": "neonMap" 처럼 적으면 src/neonMap.js의 buildTrack/buildScenery/buildProps를 씀 (없는 함수는 기본 것)
const mapMod = trackData.module ? await import(`./${trackData.module}.js`) : null;
const track = mapMod && mapMod.buildTrack ? mapMod.buildTrack(trackData, scene) : buildTrack(trackData, scene);
const scenery = mapMod && mapMod.buildScenery ? mapMod.buildScenery(track, scene) : buildScenery(track, scene);
const props = mapMod && mapMod.buildProps ? mapMod.buildProps(track, scene) : buildProps(track, scene);
// 차는 땅 찾기 레이를 삼각형 격자로 빠르게 하는 트랙을 씀 (fastTrack.js, 결과는 원래와 똑같음. ?fastray=0 이면 원래 방식)
const car = new Car(carCfg, params.get('fastray') === '0' ? track : fastTrack(track));
const model = createCarModel(carCfg.look || '#e8463a'); // 차마다 모양·색 (carRoster.js의 look)
scene.add(model.root);
const offroadFx = createOffroadFx(scene);
const engineAudio = createEngineAudio(carCfg.sound); // 차마다 엔진 소리 (cars.json tune.sound)
const lineFx = createRacingLineFx(scene, track, car); // 레이싱 라인 (L 키) + 에이펙스 알림
const kerbFx = createKerbFx(); // 연석 드르륵 소리·떨림
// 그랑프리: 브레이크 표시판(150/100/50)·코너 번호·에이펙스 표시 (레이싱 라인·속도 계획에서 자동 배치)
const corners = track.grandprix && lineFx.line ? createGpCorners(scene, track, car, scenery) : null;
/** 코너별 내 최고 기록 (브라우저에 기억). 맵 모양이 바뀌면(코너 수가 다르면) 새로 시작 */
const cornerBest = (() => {
  const ci = car.cornerInfo;
  const key = `cornerBest:${mapName}:${ci ? ci.corners.length : 0}:${Math.round(track.length)}`;
  let best = {};
  try {
    best = JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch {}
  return {
    /** 지금까지의 내 최고 (코너 번호 → 초) 복사본: 레이스 시작 때 코너 분석 기준으로 */
    snapshot: () => ({ ...best }),
    /** 이번 기록 → 내 최고 기록과 차이 (처음이면 null). 더 빠르면 새 기록으로 저장 */
    delta(num, time) {
      if (time == null) return null;
      if (!canSaveRecords()) return null; // 테스트 자동 운전·튜토리얼 중에는 코너 기록을 비교·저장하지 않음
      const b = best[num];
      if (b == null || time < b) {
        best[num] = +time.toFixed(3);
        try {
          localStorage.setItem(key, JSON.stringify(best));
        } catch {}
      }
      return b == null ? null : time - b;
    },
  };
})();
const transformSfx = createTransformSfx(); // 변신할 때 기계 소리
const speedFx = createSpeedFx(scene, carCfg.speedFx); // 속도감: 바람 줄기, 화면 가장자리 속도선, 비네트, 바람 소리
const input = createKeyboardInput();
// 키 이름 (키 바꾸기 설정을 따름). input.keyName이 없으면 기본 글자
const keyLabel = (id, def) => {
  try {
    return (input.keyName && input.keyName(id)) || def;
  } catch {
    return def;
  }
};
const hud = createHud(track);
// --- 챔피언십 (?champ=1): 시즌 내내 같은 봇 (championship.js) ---
const CHAMP = MODE === 'race' && !ONLINE && !FREE && params.get('champ') ? champRace(mapName) : null;
// --- 상대 차·레이스 진행·고스트·구간 기록 ---
const opponents = createOpponents(scene); // 봇 + 온라인 상대 (game.opponents)
const raceSys = await createRaceSystem({
  track, car, scenery, opponents, laps: trackData.laps, carId, carName, color: lookColor(carCfg.look),
  botCount: FREE ? 0 : ONLINE ? parseInt(params.get('bots'), 10) || 0 : CHAMP ? CHAMP.state.bots : MODE === 'race' ? settings.values.bots ?? 5 : 0,
  botLevel: (ONLINE && params.get('botLevel')) || (CHAMP && CHAMP.state.level) || settings.values.botLevel || 'normal',
  seed: ONLINE ? params.get('room') : CHAMP ? 'champ' + CHAMP.state.seed : null,
  loadCarConfig: (id) => (rosterMod ? rosterMod.loadCarConfig(id) : Promise.resolve(carCfg)),
});
const sectors = createSectors({ mapName, carId });
const ghost = FREE ? null : createGhost({ scene, track, carCfg, look: carCfg.look, mapName, carId, laps: trackData.laps, spawnT: 0.992 });
const finishCbs = []; // raceCtl.onFinish
// 리플레이 (완주 뒤 결과 화면 "▶ 리플레이"): 모든 차를 1초에 15번 기록 → 다시 볼 때는 물리를 멈추고 replay.frame만
const replay = createReplay({
  scene, camera, track, car, model, opponents,
  hooks: {
    animate(view, dt) {
      track.animate(elapsed);
      scenery.animate(elapsed, dt, view); // 그랑프리 우주 차원 등: 보고 있는 차 기준
      props.animate(elapsed);
    },
    onStart() {
      duckAudio(true); // 엔진·효과음 잠시 끔
      if (ghost) ghost.hide();
    },
    onExit() {
      duckAudio(false);
      snapCamera();
    },
    worldKey() {
      // 그랑프리: 우주/구름섬이 바뀌면 TV 카메라 가림 검사 목록을 다시 만듦
      return scenery.space ? (scenery.space.inSpace ? 1 : 2) : 0;
    },
  },
});
// 코너 분석 (결과 화면): 코너마다 내 시간·문제 → 봇 최고(없으면 내 예전 최고)와 비교, 개선할 코너 TOP 3
const cornerRep = createCornerReport(carCfg);
// 화면 아래 모드/부스터 버튼: 누르면 그 키를 누른 것과 같음
for (const b of document.querySelectorAll('[data-key]')) {
  b.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    input.press(b.dataset.key);
  });
}

// --- 레이스 진행 상태 ---
// 한 바퀴 인정용 체크포인트 (코스 위치 t). 맵 데이터에 "checkpoints"가 있으면 그것을 씀
// 기본값: 연습 코스의 지름길(0.66→0.94)로 가도 한 바퀴로 인정
const CHECKPOINTS = trackData.checkpoints || [0.25, 0.5, 0.6];
const race = {
  phase: 'countdown', // countdown | racing | finished
  countdown: 3,
  time: 0,
  lap: 1,
  lapStart: 0,
  lapTimes: [],
  best: Infinity,
  nextCp: 0,
  lastT: 0,
};

function resetRace() {
  if (replay.active) replay.stop();
  replay.reset();
  cornerRep.reset(cornerBest.snapshot());
  let startT = 0.992;
  if (FREE) car.placeAtPos(track.spawn.x, track.spawn.z, track.spawn.yaw);
  else if (raceSys.hasGrid()) startT = raceSys.placeGrid().t; // 봇 레이스·온라인: 2열 출발 그리드
  else car.placeAt(0.992, 0); // 출발선 바로 뒤
  props.reset();
  // F1식 출발 신호: 0.6초 뒤부터 빨간불이 0.7초마다 하나씩 → 5개 다 켜지면 0.7~2.3초(무작위) 기다렸다가 한꺼번에 꺼짐
  car.jumpStall = 0;
  car.needRelease = false;
  Object.assign(race, { lightsT: 0, lightsOutAt: 3.4 + 0.7 + Math.random() * 1.6, lights: 0, reaction: null, reactArmed: false });
  Object.assign(race, { phase: FREE ? 'racing' : 'countdown', countdown: 3.5, time: 0, clock: 0, lap: 1, lapStart: 0, lapTimes: [], nextCp: 0, lastT: startT, newLapRecord: false, assist: assistOn() });
  sectors.reset();
  if (ghost) ghost.lapStart(1); // 첫 바퀴 = 출발 신호부터
  hud.hideResults();
  snapCamera();
  startIntro();
}

// --- 출발 그리드 소개: 불이 켜지기 전에 카메라가 그리드 앞에서부터 차들을 한 대씩 훑고 내 차 뒤로 돌아옴 ---
//   봇 레이스에서 페이지를 처음 열었을 때만 (다시 시작 Enter에는 없음). 아무 키나 누르면 건너뜀. ?intro=0이면 끔
const LEVEL_NAME = { easy: '쉬움', normal: '중간', hard: '어려움' };
const intro = { on: false, played: false, t: 0, dur: 0, keys: [], cards: [] };
const _ka = new THREE.Vector3(), _kb = new THREE.Vector3(), _kla = new THREE.Vector3(), _klb = new THREE.Vector3();
function startIntro() {
  intro.on = false;
  hud.intro(null);
  const g = window.game;
  if (intro.played || FREE || ONLINE || !raceSys.bots.length || params.get('intro') === '0' || params.get('tutorial')) return;
  if (g && g.car && (g.paused || g.controlsOverride)) return;
  intro.played = true;
  const order = raceSys.standings(); // 그리드 앞쪽 차부터
  const front = order[0].view;
  // 장면들: [위치, 보는 곳, 그 장면까지 걸리는 시간, 카드]
  const keys = [];
  keys.push({ p: front.pos.clone().addScaledVector(front.fwd, 38).addScaledVector(front.up, 13), l: order[Math.floor(order.length / 2)].view.pos.clone(), d: 0, card: null });
  order.forEach((e, i) => {
    const c = e.view;
    const side = (e.lateral || 0) >= 0 ? 1 : -1;
    keys.push({
      p: c.pos.clone().addScaledVector(c.fwd, 6.2).addScaledVector(c.right || c.fwd, side * 3.4).addScaledVector(c.up, 1.25),
      l: c.pos.clone().addScaledVector(c.up, 0.6).addScaledVector(c.fwd, 0.3),
      d: i === 0 ? 1.1 : 0.62,
      card: { pos: i + 1, name: e.name, carName: e.carName, color: e.color, isPlayer: !!e.isPlayer },
    });
  });
  keys.push({ chase: true, d: 1.1, card: null });
  intro.keys = keys;
  intro.dur = keys.reduce((a, k) => a + k.d, 0);
  intro.t = 0;
  intro.on = true;
}
function skipIntro() {
  if (intro.on) intro.t = Math.max(intro.t, intro.dur - 0.5);
}
window.addEventListener('keydown', skipIntro);
window.addEventListener('pointerdown', skipIntro);
/** 소개 카메라 (updateCamera 뒤에 덮어씀). 끝나면 false */
function applyIntro(dt) {
  if (!intro.on) return false;
  intro.t += dt;
  if (intro.t >= intro.dur || race.phase !== 'countdown') {
    intro.on = false;
    hud.intro(null);
    return false;
  }
  let acc = 0, i = 1;
  while (i < intro.keys.length - 1 && acc + intro.keys[i].d < intro.t) acc += intro.keys[i++].d;
  const a = intro.keys[i - 1], b = intro.keys[i];
  const u = Math.min(1, (intro.t - acc) / b.d);
  const e = u * u * (3 - 2 * u);
  const pa = a.chase ? camPos : a.p, la = a.chase ? camLook : a.l;
  const pb = b.chase ? camPos : b.p, lb = b.chase ? camLook : b.l;
  _ka.lerpVectors(pa, pb, e);
  _kla.lerpVectors(la, lb, e);
  camera.position.copy(_ka);
  camera.up.set(0, 1, 0).lerp(camUp, b.chase ? e : 0).normalize();
  camera.lookAt(_kla);
  camera.fov = 60 + (b.chase ? (camera.fov - 60) * e : 0);
  camera.updateProjectionMatrix();
  const card = (e < 0.5 ? a.card : b.card) || null;
  hud.intro({
    title: mapTitle,
    sub: CHAMP ? `🏆 챔피언십 ${CHAMP.index + 1}/${CHAMP.total} 경기 · 봇 ${LEVEL_NAME[raceSys.level] || ''}` : `봇 레이스 · ${raceSys.bots.length + 1}대 · ${LEVEL_NAME[raceSys.level] || ''} · ${trackData.laps}바퀴`,
    card,
    hint: '아무 키나 누르면 건너뛰기',
  });
  return true;
}

function updateLaps() {
  if (FREE) return; // 테스트 맵은 기록 없음
  // 지름길 위에서는 가장 가까운 코스 위치가 들쭉날쭉하므로 진행 판정을 멈춤
  if (track.onShortcut(car.pos)) {
    race.wrongWay = 0;
    return;
  }
  const t = car.trackInfo ? car.trackInfo.t : race.lastT;
  if (race.nextCp < CHECKPOINTS.length) {
    const cp = CHECKPOINTS[race.nextCp];
    if (t >= cp && t < cp + 0.1) race.nextCp++;
  } else if (race.lastT > 0.9 && t < 0.1) {
    // 출발선 통과 = 한 바퀴 완료
    const lapTime = race.time - race.lapStart;
    race.lapTimes.push(lapTime);
    race.lapStart = race.time;
    race.nextCp = 0;
    const isBest = lapTime < race.best;
    if (isBest) race.best = lapTime;
    // 구간 기록 (S3 닫기) · 고스트 (최고 랩이면 저장) · 레이스 순위표의 내 최고 랩
    const splits = sectors.lapDone(lapTime, race.time, canSaveRecords());
    if (ghost && ghost.lapDone(lapTime, canSaveRecords(), race.lap) && settings.values.ghost === 'best' && MODE !== 'race') race.ghostSaved = true;
    if (ghost) ghost.lapStart(race.lap + 1); // 다음 바퀴 (달리면서 출발선 통과)
    raceSys.playerLap(lapTime);
    if (settings.values.sectors ?? true) hud.lapSummary(race.lapTimes.length, lapTime, splits);
    // 내 기록 (맵 + 차마다, 브라우저에 저장). 자동 운전 테스트(game.paused) 중에는 저장 안 함
    let lapRecord = false;
    if (canSaveRecords()) {
      const prev = records.get(mapName, carId);
      if (records.saveLap(mapName, carId, lapTime, race.assist)) {
        race.newLapRecord = true;
        lapRecord = !!(prev && prev.lap);
      }
    }
    if (race.lap >= trackData.laps) {
      race.phase = 'finished';
      showFinish();
    } else {
      race.lap++;
      // 남은 바퀴 띠 알림 (마지막 바퀴는 크게)
      const left = trackData.laps - race.lap + 1;
      if (left === 1) hud.banner('마지막 바퀴!', 'FINAL LAP', 'final', 2.6);
      else hud.banner(`${left}바퀴 남음`, `LAP ${race.lap}/${trackData.laps}`, 'laps', 2.2);
      if (lapRecord || isBest) hud.toast(lapRecord ? `🏆 내 최고 랩! ${fmtTime(lapTime)}` : '최고 기록!');
    }
  }
  // 역주행 감지 (t가 계속 뒤로 가면)
  let d = t - race.lastT;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  race.wrongWay = d < -0.0004 && car.forwardSpeed > 5 ? (race.wrongWay || 0) + 1 : 0;
  race.lastT = t;
}

/** 플레이어 레이스 진행 = 지난 바퀴 + 이번 바퀴 위치 (출발선 뒤 그리드는 음수) → 순위·구간·고스트 */
function playerProgress() {
  if (race.phase === 'finished') return trackData.laps + (race.lastT < 0.5 ? race.lastT : 0);
  const t = race.lastT;
  return race.lap - 1 + (race.nextCp === 0 && t > 0.5 ? t - 1 : t);
}
/** 매 물리 스텝 (주행 중): 구간 경계·고스트 기록 */
function trackStep() {
  if (FREE || race.phase !== 'racing') return;
  const lapT = race.time - race.lapStart;
  const frac = playerProgress() - (race.lap - 1);
  sectors.step(frac, lapT, race.time);
  if (ghost) ghost.record(lapT, car, frac);
}

// --- 카메라: 차의 위쪽 방향을 따라 함께 회전 (벽, 천장에서도 차 뒤에 붙어 있음) ---
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camFwd = new THREE.Vector3(0, 0, 1);
const camUp = new THREE.Vector3(0, 1, 0);
const CAM_BACK = 6.0, CAM_UP = 2.3;
// 속도감 카메라 (data/car.json "camera"): 빠를수록 시야가 넓어지고 조금 낮고 가깝게, 세게 가속하면 살짝 뒤로 밀렸다가 제자리
const CAM = {
  fovBase: 68, fovSpeed: 16, fovBooster: 7, fovRate: 3, fxFromKmh: 60, topKmh: 250,
  followLead: 0.75, speedBack: -0.5, speedUp: -0.3, accelPull: 0.05, accelPullMax: 0.8, brakePullMax: 0.45,
  lookAhead: 3, lookSlip: 0.5, buzz: 0.012, buzzFromKmh: 190,
  ...(carCfg.camera || {}),
};
const cam = { sk: 0, acc: 0, pull: 0, prevSpeed: 0, boostK: 0, t: 0 };
const _lookDir = new THREE.Vector3(), _lead = new THREE.Vector3();
const smoothK = (x, a, b) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function cameraTarget(outPos, outLook) {
  // 차 바로 뒤, 낮게 붙어서 따라감 (CAM_BACK을 키우면 멀어짐). 빠를수록 조금 가깝고 낮게 (땅이 더 빨리 흘러 보임)
  const back = CAM_BACK + CAM.speedBack * cam.sk + cam.pull;
  const up = CAM_UP + CAM.speedUp * cam.sk;
  outPos.copy(car.pos).addScaledVector(camFwd, -back).addScaledVector(camUp, up);
  // 보는 곳: 빠를수록 조금 더 멀리, 미끄러질 때는 차가 실제로 가는 쪽을 조금 더 봄
  _lookDir.copy(camFwd);
  if (car.grounded && Math.abs(car.speed) > 3) {
    const md = car.moveDir;
    md.addScaledVector(camUp, -md.dot(camUp)).normalize();
    _lookDir.lerp(md, CAM.lookSlip).normalize();
  }
  outLook.copy(car.pos).addScaledVector(_lookDir, 6 + CAM.lookAhead * cam.sk).addScaledVector(camUp, 1.0);
}
function snapCamera() {
  camFwd.copy(car.fwd);
  camUp.copy(car.up);
  cam.pull = cam.acc = 0;
  cam.sk = smoothK(Math.abs(car.forwardSpeed) * 3.6, CAM.fxFromKmh, CAM.topKmh);
  cam.prevSpeed = car.forwardSpeed;
  cameraTarget(camPos, camLook);
  camera.position.copy(camPos);
  camera.up.copy(camUp);
  camera.lookAt(camLook);
}
function updateCamera(dt) {
  // 공중에서는 위쪽 방향을 세상 기준으로 천천히, 땅에서는 차 기준으로 빠르게
  camUp.lerp(car.up, 1 - Math.exp(-(car.grounded ? 5 : 2.5) * dt)).normalize();
  // 앞 방향은 차가 바라보는 방향을 부드럽게 따라감 (위쪽 방향과 직각으로 유지)
  const f = car.fwd.clone().addScaledVector(camUp, -car.fwd.dot(camUp)).normalize();
  camFwd.lerp(f, 1 - Math.exp(-5 * dt));
  camFwd.addScaledVector(camUp, -camFwd.dot(camUp)).normalize();

  // 속도 비율 (fxFromKmh → topKmh에서 0 → 1), 가속 쏠림
  const v = car.grounded ? Math.abs(car.forwardSpeed) : car.vel.length();
  const kmh = v * 3.6;
  cam.t += dt;
  cam.sk = THREE.MathUtils.lerp(cam.sk, smoothK(kmh, CAM.fxFromKmh, CAM.topKmh), 1 - Math.exp(-2 * dt));
  // 앞뒤 가속도 (부딪힘처럼 순간적으로 확 바뀐 속도는 잘라냄) → 세게 밟으면 카메라가 살짝 뒤로, 브레이크면 살짝 앞으로
  const a = dt > 0 && car.grounded ? THREE.MathUtils.clamp((car.forwardSpeed - cam.prevSpeed) / dt, -40, 25) : 0;
  cam.prevSpeed = car.forwardSpeed;
  cam.acc = THREE.MathUtils.lerp(cam.acc, a, 1 - Math.exp(-3 * dt));
  const pullT = THREE.MathUtils.clamp(cam.acc * CAM.accelPull, -CAM.brakePullMax, CAM.accelPullMax);
  cam.pull = THREE.MathUtils.lerp(cam.pull, pullT, 1 - Math.exp(-3 * dt));

  const tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
  cameraTarget(tPos, tLook);
  // 따라가기: 부드럽게 따라가되, 차 속도만큼 앞을 미리 겨냥해서(followLead) 빠를 때 카메라가 뒤로 처지지 않게
  //   (예전엔 209 km/h에서 카메라가 원래보다 7 m 넘게 뒤로 밀려 차가 작게 보이고 느리게 느껴졌음)
  _lead.copy(car.vel).multiplyScalar(CAM.followLead / 8);
  if (!car.grounded) _lead.y = 0;
  tPos.add(_lead);
  // 공중에서는 높이를 천천히 따라가서 점프가 더 높아 보이게
  const y = camPos.y;
  camPos.lerp(tPos, 1 - Math.exp(-8 * dt));
  if (!car.grounded) camPos.y = y + (tPos.y - y) * (1 - Math.exp(-2.5 * dt));
  tLook.addScaledVector(car.vel, CAM.followLead / 12);
  camLook.lerp(tLook, 1 - Math.exp(-12 * dt));
  camera.position.copy(camPos);
  camera.up.copy(camUp);
  camera.lookAt(camLook);
  // 최고 속도 근처에서만 아주 작게 노면 떨림 (흔들림이 아니라 잔진동, 1 cm 정도)
  const buzzK = car.grounded && !car.flying ? smoothK(kmh, CAM.buzzFromKmh, CAM.topKmh + 20) : 0;
  if (buzzK > 0 && CAM.buzz > 0) camera.position.addScaledVector(camUp, CAM.buzz * buzzK * (Math.sin(cam.t * 83) * 0.6 + Math.sin(cam.t * 131 + 1.3) * 0.4));

  // 속도감: 빠를수록, 부스터일 때 시야각 넓어짐
  const boosting = car.boostTime > 0 || car.form === 'spike';
  cam.boostK = THREE.MathUtils.lerp(cam.boostK, boosting ? 1 : 0, 1 - Math.exp(-(boosting ? 5 : 2) * dt));
  const targetFov = CAM.fovBase + CAM.fovSpeed * cam.sk + CAM.fovBooster * cam.boostK;
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-CAM.fovRate * dt));
  camera.updateProjectionMatrix();

  // 그림자가 차 주변에 생기도록 태양도 따라감
  sun.position.copy(car.pos).add(SUN_OFFSET);
  sun.target.position.copy(car.pos);
}

// --- 이벤트 → 연출 ---
const MODE_INFO = {
  normal: { name: '일반 모드', color: '#ffffff' },
  accel: { name: '가속 모드!', color: '#ff7a2e' },
  boat: { name: '배 모드!', color: '#3fb8ff' },
  fly: { name: '비행 모드!', color: '#9ad8ff' },
};
let lastFxMode = null, lastFxForm = null;
/** 모드·부스터 모습이 바뀌면 변신 소리 + 아래 모드 버튼이 살짝 커졌다 돌아옴 */
function checkModeChange() {
  if (lastFxMode !== null && car.mode !== lastFxMode) {
    transformSfx.play(car.mode !== 'normal');
    hud.modePulse(car.mode || 'normal');
  }
  if (lastFxForm !== null && car.form !== lastFxForm && car.form) transformSfx.play(true);
  lastFxMode = car.mode;
  lastFxForm = car.form;
}
function handleEvents() {
  for (const e of car.events) {
    // 카메라 흔들림은 예전의 절반쯤 (사용자 요청: 진동 줄이기)
    if (e === 'land') hud.shake(0.12);
    if (e === 'bump') hud.shake(0.2);
    if (e === 'lava') hud.toast('용암에 빠졌어요!');
    if (e === 'booster') {
      hud.big('부스터!', 0.7);
      hud.flash('#7dff6a', 0.35);
      hud.shake(0.12);
    }
    if (e === 'takeoff') hud.toast(`✈️ 이륙! ${keyLabel('climb', 'Space')} 상승 · ${keyLabel('dive', 'Shift')} 하강`);
    if (e === 'forceLand') hud.toast('🛬 비행 구역 끝! 땅으로 내려가요');
    if (e === 'smash') hud.shake(0.1);
    if (e === 'explode') {
      hud.shake(0.4);
      hud.flash('#ff9a3a', 0.35);
    }
    if (e === 'barricade') {
      hud.big('돌파!', 0.7);
      hud.shake(0.3);
      hud.flash('#ffd21f', 0.4);
    }
    if (e === 'barricadeBlocked') hud.toast('💥 100 km/h 이상으로 들이받으면 부서져요');
    if (e === 'perfectShift') hud.shiftFlash();
    if (e === 'overRev') hud.toast('회전수가 너무 높아서 기어를 내릴 수 없어요');
    // 드리프트 탈출 (cars: car.lastDriftInfo = { quality 0~1, gain m/s, hold 초 ... })
    if (e === 'driftExit') {
      const di = car.lastDriftInfo || {};
      const kmh = Math.round((di.gain || 0) * 3.6);
      hud.toast(`${(di.quality || 0) > 0.8 ? '완벽한 ' : ''}드리프트 탈출!${kmh > 0 ? ` +${kmh} km/h` : ''}`);
    }
    if (e === 'driftSpin') hud.toast('스핀! 반대로 꺾어서 각도를 잡아요');
    if (e === 'perfectLaunch') {
      hud.big('완벽한 출발!', 0.9);
      hud.flash('#7dff6a', 0.5);
      if (race.reaction != null) hud.toast(`반응 ${race.reaction.toFixed(2)}초`);
    }
    if (e === 'jumpStart') {
      hud.big('부정 출발!', 1.4);
      hud.flash('#ff3b30', 0.6);
      hud.toast(`불이 꺼지기 전에 밟아서 시동이 꺼졌어요 · ${keyLabel('throttle', 'W')}를 뗐다가 다시 누르세요`);
    }
    if (e === 'launchSpin') hud.toast('회전수가 너무 높아 바퀴가 헛돌아요!');
    // 모드가 바뀔 때: 큰 글자·화면 번쩍임 없이 차가 변신하는 모습(carModel) + 변신 소리 + 아래 버튼만 살짝 (아래 checkModeChange)
    if (e === 'splash') hud.toast('🌊 물에 빠지는 중! 곧 자동으로 배 모드');
    if (e === 'autoBoat') hud.toast('🚤 물에 닿아서 자동으로 배 모드!');
    if (e === 'autoFly') hud.toast(`🛫 활주로! 자동으로 비행 모드 · ${keyLabel('climb', 'Space')} 이륙`);
    if (e === 'sink') hud.toast(`가라앉았어요. ${keyLabel('respawn', 'R')} 키로 도로에 돌아와요`);
    if (e === 'apex' || e === 'apexPerfect') {
      lineFx.apex(car.lastApexInfo);
      if (corners) corners.apexHit(car.lastApexN);
    }
    // 코너 탈출 판정: "T3 깔끔한 코너 / 연계 ×2" + 내 최고 기록과 차이 (−0.12초 초록, +0.08초 빨강)
    if (e === 'corner') {
      const info = car.lastCornerInfo;
      if (race.phase === 'racing') cornerRep.add(info);
      lineFx.corner(info, cornerBest.delta(info.num, info.time));
    }
  }
  car.events.length = 0;
}

/** 물리 한 스텝: 차 → 건물/나무 충돌 → 소품 */
function stepWorld(controls) {
  if (race.phase === 'countdown') {
    // 출발 전: 차를 출발선에 묶어 둠. W로 올린 회전수(소리)는 그대로 두고, 바퀴로는 힘이 안 감
    const rpm = car.rpm, thr = car.thr;
    car.thr = 0;
    car.update(FIXED_DT, { ...controls, throttle: 0, brake: 0 });
    car.rpm = rpm;
    car.thr = thr;
    car.speed = 0;
    car.vel.x = car.vel.z = 0;
  } else car.update(FIXED_DT, controls);
  scenery.collideCar(car);
  props.update(FIXED_DT, car);
  // 봇 운전·차끼리 충돌·순위 기록 (봇·상대가 없으면 거의 아무것도 안 함)
  if (race.phase !== 'countdown') race.clock += FIXED_DT; // 내가 완주한 뒤에도 흐르는 레이스 시계 (봇 완주 시간)
  raceSys.step(FIXED_DT, race.phase, race.clock, playerProgress());
}

// --- 설정 적용 (settings.js: 홈·ESC 메뉴에서 바꾸면 바로 여기로) ---
const _shakeBase = new THREE.Vector3();
let shakeK = 1; // 화면 흔들림 세기 (0 끔 ~ 1 보통)
const FX_BASE = { ...speedFx.cfg };
const CAM_BASE = { fovBase: CAM.fovBase, fovSpeed: CAM.fovSpeed, fovBooster: CAM.fovBooster, buzz: CAM.buzz };
const fpsEl = document.getElementById('fps');
let engMuted = false;
function setModuleMute(m) {
  if (m !== engMuted) engMuted = engineAudio.toggleMute();
  kerbFx.setMuted(m);
  transformSfx.setMuted(m);
  speedFx.setMuted(m);
}
/** 그래픽 품질: 낮음 = 해상도 낮추고 그림자 끔, 보통 = 해상도 1배·그림자 작게, 높음 = 예전과 같음 */
function applyQuality(q) {
  const pr = q === 'low' ? Math.min(devicePixelRatio, 1) * 0.8 : q === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 2);
  if (Math.abs(renderer.getPixelRatio() - pr) > 1e-3) {
    renderer.setPixelRatio(pr);
    resize();
  }
  sun.castShadow = q !== 'low';
  const size = q === 'high' ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
}
function applySettings(key) {
  const s = settings.values;
  setMix({ master: s.masterVol, engine: s.engineVol, fx: s.fxVol, muted: s.muted });
  setModuleMute(!!s.muted);
  if (lineFx.line && lineFx.visible !== !!s.racingLine) lineFx.toggle();
  // 속도감 효과 세기: 바람 줄기·속도선·비네트 진하기 + 빠를 때 시야가 넓어지는 정도
  const k = s.speedFx;
  speedFx.cfg.streakOpacity = FX_BASE.streakOpacity * k;
  speedFx.cfg.lineOpacity = FX_BASE.lineOpacity * k;
  speedFx.cfg.vignette = FX_BASE.vignette * Math.min(1, k);
  speedFx.cfg.boosterVignette = FX_BASE.boosterVignette * Math.min(1, k);
  CAM.fovSpeed = CAM_BASE.fovSpeed * k;
  CAM.fovBooster = CAM_BASE.fovBooster * k;
  CAM.fovBase = CAM_BASE.fovBase + s.fov;
  shakeK = s.shake;
  CAM.buzz = CAM_BASE.buzz * s.shake;
  hud.setUnit(s.unit);
  document.body.classList.toggle('noMinimap', !s.minimap);
  fpsEl.style.display = s.showFps ? 'block' : 'none';
  if (!key || key === 'gearbox') car.manual = s.gearbox === 'manual';
  if (!key || key === 'quality') applyQuality(s.quality);
  // 고스트 (설정 ghost: off | best | bot). 봇 레이스에서는 끔
  if (ghost && (!key || key === 'ghost')) ghost.setKind(MODE === 'race' ? 'off' : s.ghost ?? 'best');
  if (key && menuOpen()) renderer.render(scene, camera); // 메뉴 뒤 화면도 새 설정으로
}
settings.onChange((k) => applySettings(k));
applySettings();

// --- ESC 메뉴 (일시정지) ---
const totalLaps = trackData.laps;
function goHome(page) {
  setLast({ map: mapName, car: carId });
  location.href = homeUrl(page);
}
const menu = createPauseMenu({
  getInfo: () => ({
    map: mapTitle, car: carName, free: FREE,
    lapText: `${Math.min(race.lap, totalLaps)} / ${totalLaps}`,
    time: race.time, best: race.best, record: (records.get(mapName, carId) || {}).lap,
    phase: race.phase, lapTimes: race.lapTimes,
  }),
  onOpen() {
    duckAudio(true); // 소리 잠시 끔
    input.clear();
  },
  onClose() {
    duckAudio(false);
    input.clear(); // 메뉴에서 누른 Enter 등이 게임으로 새지 않게
    last = performance.now();
    acc = 0;
  },
  onRestart: () => resetRace(),
  onHome: goHome,
  isRacing: () => race.phase === 'racing' && race.time > 3,
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || menu.isOpen || dialogOpen()) return;
  e.preventDefault();
  menu.open();
});
document.getElementById('menuBtn').addEventListener('click', (e) => {
  e.currentTarget.blur();
  menu.open();
});
// 창을 벗어나면 자동 일시정지 (진짜 키·마우스 입력이 한 번이라도 있었을 때만 → 자동 테스트에는 안 뜸)
let userActive = false;
const markUser = (e) => e.isTrusted && (userActive = true);
window.addEventListener('keydown', markUser, true);
window.addEventListener('pointerdown', markUser, true);
function autoPause() {
  if (ONLINE) return; // 온라인: 창을 벗어나도 멈추지 않음 (내 차만 멈추면 안 되니까)
  if (!userActive || !settings.get('autoPause') || menu.isOpen || race.phase === 'finished') return;
  if (window.game && window.game.paused) return;
  menu.open();
}
window.addEventListener('blur', autoPause);
document.addEventListener('visibilitychange', () => document.hidden && autoPause());

// --- 완주 결과 ---
// 운전 도움(브레이크·조향 도움)을 켰는지. 레이스 중 한 번이라도 켜면 race.assist = true → 결과·기록에 '도움 켬' 표시
function assistOn() {
  const v = settings.values;
  return (v.brakeAssist || 'off') !== 'off' || (v.steerAssist || 'off') !== 'off';
}
function canSaveRecords() {
  // 테스트 자동 운전·튜토리얼(차를 순간이동시킴) 중에는 기록·고스트·구간 기록을 저장하지 않음
  return !(window.game && (window.game.paused || window.game.controlsOverride || window.game.tutorial));
}
function nextMapId() {
  const order = mapsMeta.map((m) => m.id).filter((id) => MAPS[id]);
  return order[(order.indexOf(mapName) + 1) % order.length] || 'gp';
}
function showFinish() {
  replay.markFinish(race.clock); // 리플레이는 완주 4초 뒤까지
  const total = race.lapTimes.reduce((a, b) => a + b, 0);
  const prev = records.get(mapName, carId);
  const prevRace = prev && prev.race;
  const newRace = canSaveRecords() ? records.saveRace(mapName, carId, total, race.lapTimes.length, race.assist) : false;
  // 레이스 순위 (봇·온라인 상대가 있을 때)
  const position = raceSys.active() ? raceSys.playerFinished(race.clock, race.lapTimes, race.best) : null;
  const standings = raceSys.active() ? raceSys.results(race.clock) : null;
  race.resultsT = 0;
  const showSec = settings.values.sectors ?? true;
  // 챔피언십: 이 경기 점수 저장 (한 번만) + 시즌 순위
  let champ = null;
  if (CHAMP && standings) {
    if (!race.champRec) race.champRec = recordRace(mapName, standings);
    const rec = race.champRec;
    if (rec) {
      const title = (id) => (mapsMeta.find((m) => m.id === id) || {}).title || id;
      champ = {
        no: rec.index + 1, total: rec.state.maps.length, final: rec.final, maps: rec.state.maps.map(title),
        next: rec.final ? null : title(rec.state.maps[rec.index + 1]),
        table: champStandings(rec.state).map((d, i) => ({ pos: i + 1, name: d.name, color: d.color, points: d.points, gained: rec.gained[d.id] || 0, isPlayer: d.isPlayer, wins: d.wins })),
      };
    }
  }
  for (const cb of finishCbs) {
    try {
      cb({ time: total, lapTimes: race.lapTimes.slice(), best: race.best, position, standings });
    } catch (err) {
      console.warn(err);
    }
  }
  hud.showResults(race.lapTimes, race.best, {
    map: mapTitle, car: carName, newLap: race.newLapRecord, newRace, prevRace, hasNext: true,
    position, standings, sectorLaps: showSec ? sectors.laps : null, theoretical: showSec && race.lapTimes.length > 1 ? sectors.theoretical() : null,
    champ, assist: !!race.assist, noRestart: !!champ,
    replay: replay.has(), corners: !FREE && cornerRep.count ? cornerRep.summary(raceSys.active() ? raceSys.botCornerBest : null) : null, nextLabel: champ ? (champ.final ? '🏠 홈으로 (시즌 끝)' : `다음 경기 › ${champ.next}`) : null,
    onAction(a) {
      if (a === 'restart') {
        if (!ONLINE && !race.champRec) resetRace(); // 온라인·챔피언십(점수 저장 뒤)에서는 다시 하지 않음
      }
      else if (a === 'next' && champ) {
        const u = champ.final ? null : champUrl();
        if (u) location.href = u;
        else goHome();
      }
      else if (a === 'next') {
        const u = new URL(raceUrl(nextMapId(), carId));
        if (MODE) u.searchParams.set('mode', MODE);
        location.href = u.toString();
      }
      else if (a === 'replay') replay.start();
      else if (a === 'car') goHome('map');
      else if (a === 'home') goHome();
    },
  });
}

// --- 게임 루프 ---
let acc = 0;
let last = performance.now();
let elapsed = 0;
let fpsFrames = 0, fpsT = performance.now();
resetRace();
{
  const l = document.getElementById('loading');
  l.classList.add('out');
  setTimeout(() => l.remove(), 450);
}

function frame(now, manual = false) {
  // 프레임 제한 (설정): 너무 이르면 이번 화면은 건너뜀
  const cap = settings.values.fpsCap;
  if (!manual && cap && now - last < 1000 / cap - 1.5) return requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // 음수 방지 (game.tick 뒤 진짜 화면 프레임이 오면 시간이 거꾸로였음)
  last = now;
  if (window.game && window.game.paused) {
    engineAudio.update(car); // 일시정지 중엔 엔진 소리를 줄여 끔
    if (!manual) requestAnimationFrame(frame); // 테스트용 일시정지
    return;
  }
  // ESC 메뉴가 열려 있으면 모두 멈춤 (물리·시간·출발 신호). 화면은 마지막 장면 그대로
  //   온라인에서는 멈추지 않음 (다른 사람은 계속 달림): 내 차만 손을 뗀 채로 굴러감
  const menuHold = menu.isOpen;
  if (menuHold && !ONLINE) {
    if (!manual) requestAnimationFrame(frame);
    return;
  }
  // 리플레이 중: 물리·시간은 멈추고 기록만 다시 그림 (온라인이면 내 차는 그 자리에 멈춰 있음 = 이미 완주한 뒤)
  if (replay.active) {
    elapsed += dt;
    replay.frame(dt, elapsed);
    renderer.render(scene, camera);
    input.endFrame();
    if (!manual) requestAnimationFrame(frame);
    return;
  }
  elapsed += dt;
  if (settings.values.showFps) {
    fpsFrames++;
    if (now - fpsT >= 500) {
      fpsEl.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsT))} FPS`;
      fpsFrames = 0;
      fpsT = now;
    }
  }

  if (!ONLINE && !(window.game && window.game.net) && !menuHold && !race.champRec && input.wasPressed('Enter')) resetRace(); // 온라인에서는 Enter(다시 시작)·M(맵 바꾸기) 막음
  if (!ONLINE && !(window.game && window.game.net) && !menuHold && input.wasPressed('KeyM')) {
    // 맵 전환 (페이지를 새로 불러옴, 차는 그대로)
    const url = new URL(location.href);
    const next = MAP_ORDER[(MAP_ORDER.indexOf(mapName) + 1) % MAP_ORDER.length];
    url.searchParams.set('map', next); // map이 없으면 홈 화면이 뜨므로 main도 꼭 적음
    location.href = url.toString();
  }
  // (왼쪽 아래 조작법 안내·H 키는 없앰: 사용자 요청 2026-11-09)
  if (input.wasPressed('KeyR') && race.phase === 'racing') car.respawn();
  if (input.wasPressed('KeyT')) {
    car.manual = !car.manual;
    settings.set('gearbox', car.manual ? 'manual' : 'auto'); // 설정에도 기억
    hud.toast(car.manual ? `수동 변속: ${keyLabel('shiftUp', 'X')} 올림 · ${keyLabel('shiftDown', 'Z')} 내림` : '자동 변속');
  }
  if (input.wasPressed('KeyN')) {
    settings.set('muted', !settings.get('muted')); // → applySettings가 모든 소리를 끄고 켬
    hud.toast(`${settings.get('muted') ? '소리 끔' : '소리 켬'} (${keyLabel('sound', 'N')})`);
  }
  if (input.wasPressed('KeyL')) {
    hud.toast(lineFx.toggle() ? '레이싱 라인 켬 (초록 밟기 · 노랑 떼기 · 빨강 브레이크)' : '레이싱 라인 끔');
    settings.set('racingLine', lineFx.visible);
  }

  if (race.phase === 'countdown') {
    // 출발 전: 차는 움직이지 않음. 빨간불 5개가 꺼지는 순간 출발
    if (!race.hold && !intro.on) race.lightsT += dt; // 온라인: 모두 준비될 때까지 출발 신호를 멈춰 둠 (raceCtl.holdStart). 그리드 소개 중에도 멈춤
    race.countdown = race.lightsOutAt - race.lightsT;
    race.lights = Math.max(0, Math.min(5, Math.floor((race.lightsT - 0.6) / 0.7) + 1));
    const pre = input.read();
    car.revEngine(dt, pre.throttle); // 출발 전 공회전 소리 (밟고 있으면 불이 꺼질 때 시동이 꺼짐!)
    if (pre.mode && car.cfg.modes.manualSelect) car.setMode(pre.mode); // 수동 선택을 켜면 출발 전에도 모드 선택 가능
    if (race.countdown <= 0) {
      race.phase = 'racing';
      race.lights = 0;
      race.reactArmed = !pre.throttle;
      car.launch(pre.throttle > 0);
    }
  }
  // 불이 꺼진 뒤 처음 W를 누를 때까지 걸린 시간 = 반응 속도
  if (race.phase === 'racing' && race.reactArmed && input.read().throttle > 0) {
    race.reactArmed = false;
    race.reaction = race.time;
    car.reactionLaunch(race.time);
    // 첫 바퀴 고스트가 있으면 그 반응 속도도 같이 (고스트도 불이 꺼진 순간부터 자기 반응만큼 기다렸다 출발)
    const gr = ghost && ghost.kind === 'best' ? ghost.startReaction : null;
    const grTxt = gr != null ? ` · 고스트 ${gr.toFixed(2)}초` : '';
    if (race.time > (car.cfg.engine.perfectReaction ?? 0.3) || grTxt) hud.toast(`반응 ${race.time.toFixed(2)}초${grTxt}`);
  }
  hud.startLights(race.phase === 'countdown' && !intro.on ? race.lights : -1);

  const ctlOverride = window.game && window.game.controlsOverride; // 테스트용: 자동 운전 함수
  const controls = race.phase === 'racing' && !menuHold ? (ctlOverride ? ctlOverride() : input.read()) : emptyControls();
  if (race.phase === 'racing' && !race.assist && !ctlOverride && assistOn()) race.assist = true; // 레이스 중에 도움을 켜도 표시
  acc += dt;
  while (acc >= FIXED_DT) {
    stepWorld(controls);
    controls.booster = false; // 부스터, 변속 명령은 한 번만 전달
    controls.shiftUp = controls.shiftDown = false;
    controls.mode = null;
    if (race.phase === 'racing') {
      race.time += FIXED_DT;
      updateLaps();
      trackStep();
    }
    acc -= FIXED_DT;
  }
  handleEvents();
  replay.sample(race.clock, race.phase); // 리플레이 기록 (1/15초마다)

  model.sync(car, dt, elapsed);
  offroadFx.update(car, dt);
  lineFx.update(car);
  if (corners) corners.update(car, dt);
  kerbFx.update(car, dt);
  checkModeChange();
  updateCamera(dt);
  _shakeBase.copy(camera.position); // 화면 흔들림 세기(설정): 흔들기 전 위치를 기억해 두었다가 섞음
  offroadFx.shakeCamera(camera);
  kerbFx.shakeCamera(camera, car);
  // 테스트용: 카메라 고정 (차 기준 오프셋)
  const co = window.game && window.game.cameraOverride;
  if (co) {
    camera.position.copy(car.pos).addScaledVector(car.right, co[0]).addScaledVector(car.up, co[1]).addScaledVector(car.fwd, co[2]);
    camera.up.copy(car.up);
    camera.lookAt(car.pos.clone().addScaledVector(car.up, 0.8));
    camera.fov = 45;
    camera.updateProjectionMatrix();
  }
  if (applyIntro(dt)) _shakeBase.copy(camera.position);
  hud.shakeCamera(camera, dt);
  if (!co && shakeK !== 1) camera.position.lerpVectors(_shakeBase, camera.position, shakeK);
  if (!co) speedFx.update(car, camera, dt);
  track.animate(elapsed);
  scenery.animate(elapsed, dt, car);
  props.animate(elapsed);
  // 봇·온라인 상대 모델 + 이름표, 고스트
  raceSys.update(dt, elapsed, camera);
  if (ghost) ghost.update(dt, elapsed, race.time - race.lapStart, race.time, camera, race.phase === 'racing' && ghost.kind !== 'off');
  // 순위 패널은 1초에 5번만 (글자 바꾸기가 무거움). 완주 뒤 결과표 순위도 봇이 들어오면 갱신
  race.hudT = (race.hudT || 0) + dt;
  if (race.hudT > 0.2) {
    race.hudT = 0;
    hud.race(raceSys.active() && !FREE ? raceSys.hudInfo(race.clock) : null);
    if (race.phase === 'finished' && raceSys.active() && hud.resultsOpen) {
      race.resultsT = (race.resultsT || 0) + 0.2;
      if (race.resultsT > 0.6) {
        race.resultsT = 0;
        hud.updateStandings(raceSys.results(race.clock));
      }
    }
  }
  const showSectors = !FREE && (settings.values.sectors ?? true);
  // 레이스 알림: 이번 레이스 최고 랩 (봇 포함)
  if (raceSys.notices.length) {
    const many = raceSys.active() && !FREE;
    for (const n of raceSys.notices) if (many && race.phase === 'racing') hud.banner('⏱ 레이스 최고 랩', `${n.isPlayer ? '나' : n.name} ${fmtTime(n.time)}`, 'fastest', 2.6);
    raceSys.notices.length = 0;
  }

  hud.update({
    label: FREE ? '🧪 테스트 맵' : null,
    lap: Math.min(race.lap, trackData.laps),
    laps: trackData.laps,
    time: race.time,
    best: race.best,
    speed: Math.abs(car.forwardSpeed) * 3.6,
    driftTime: car.drifting ? car.driftTime : 0,
    driftLevel: car.driftLevel,
    driftAngle: car.driftAngle || 0,
    driftHold: car.driftHold || 0,
    drifting: car.drifting,
    cfg: carCfg,
    wrongWay: race.wrongWay > 60,
    carPos: car.pos,
    carYaw: car.yaw,
    mode: car.mode,
    flying: car.flying,
    altitude: car.pos.y,
    sink: car.sink,
    form: car.form,
    formTime: car.formTime,
    rpm: car.rpm,
    gear: car.gear,
    manual: car.manual,
    shifting: car.shiftTimer > 0,
    limiter: car.limiter,
    countdown: race.phase === 'countdown',
    wheelspin: car.wheelspin,
    understeer: car.understeer,
    sliding: car.sliding,
    brake: car.brk,
    others: raceSys.active() ? raceSys.dots() : null,
    draft: race.phase === 'racing' ? car.draft || 0 : 0,
    sectors: showSectors ? sectors.hud(race.phase === 'countdown' ? 0 : race.time - race.lapStart) : null,
    ghostDelta: ghost && ghost.kind !== 'off' && race.phase === 'racing' ? ghost.delta(playerProgress() - (race.lap - 1), race.time - race.lapStart, playerProgress(), race.time) : null,
    ghostLabel: ghost && ghost.kind === 'bot' ? '기본 봇' : '내 최고',
  });
  engineAudio.update(car);

  renderer.render(scene, camera);
  input.endFrame();
  if (!manual) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 디버그/테스트용 (브라우저 콘솔에서 사용 가능)
window.game = {
  car, race, track, scene, camera, model, renderer, scenery, props, mapName, offroadFx, engineAudio, lineFx, corners, kerbFx, speedFx, input, camCfg: CAM,
  carId, carName, carCfg, mapTitle, menu, settings, records,
  resetRace,
  mode: MODE, opponents, raceSys, ghost, sectors, champ: CHAMP, intro, replay, cornerRep,
  /**
   * 레이스 진행 조절 (온라인 레이스용, net 담당)
   *   holdStart(true) = 출발 신호를 멈춰 둠(모두 준비될 때까지), startCountdown({ wait }) = 처음부터 빨간불 시작
   *   onFinish(cb) = 내가 완주하면 cb({ time, lapTimes, best, position, standings })
   *   setGrid(index, total) = 내 그리드 칸 (0 = 맨 앞)
   */
  raceCtl: {
    holdStart(on) {
      race.hold = !!on;
      if (on && race.phase === 'countdown') race.lightsT = 0;
    },
    startCountdown(opts = {}) {
      resetRace();
      race.hold = false;
      if (opts.wait != null) race.lightsOutAt = 3.4 + 0.7 + opts.wait; // 모두 같은 때 불이 꺼지게 (0~1.6초)
    },
    onFinish(cb) {
      finishCbs.push(cb);
    },
    setGrid(index, total, humans) {
      raceSys.setGrid(index, total, humans);
      if (race.phase === 'countdown') resetRace();
    },
    get phase() {
      return race.phase;
    },
    get time() {
      return race.time;
    },
    progress: () => playerProgress(),
  },
  /** 테스트용: 지금 화면(게임 + 속도선 레이어)을 한 장의 캔버스로 */
  grab(w = 640, h = 400) {
    renderer.render(scene, camera);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.drawImage(renderer.domElement, 0, 0, w, h);
    g.drawImage(speedFx.overlay, 0, 0, w, h);
    return c;
  },
  /** 테스트용: 화면 없이 레이스를 seconds초 진행 (controlsFn이 매 스텝 조작 명령을 줌) */
  simulate(seconds, controlsFn) {
    race.phase = 'racing';
    for (let i = 0; i < seconds / FIXED_DT && race.phase === 'racing'; i++) {
      stepWorld(controlsFn());
      race.time += FIXED_DT;
      updateLaps();
      trackStep();
    }
    return { phase: race.phase, lap: race.lap, lapTimes: race.lapTimes.map((t) => t.toFixed(2)) };
  },
  /**
   * 테스트용: 여러 장면을 한 장의 이미지로 묶어 .debug/name.jpg로 저장.
   * frames: [{ setup(), cam: [오른쪽, 위, 앞] }, ...]
   */
  async contactSheet(name, frames, cols = 3, w = 420, h = 300) {
    const sheet = document.createElement('canvas');
    const rows = Math.ceil(frames.length / cols);
    sheet.width = cols * w;
    sheet.height = rows * h;
    const g = sheet.getContext('2d');
    speedFx.hide(); // 속도 연출(바람 줄기)은 카메라를 따로 옮기는 사진에서는 숨김
    frames.forEach((f, i) => {
      f.setup();
      model.sync(car, 1, elapsed);
      scenery.animate(elapsed, 0, car);
      props.animate(elapsed);
      camera.position.copy(car.pos).addScaledVector(car.right, (f.cam || [0, 5, -14])[0]).addScaledVector(car.up, (f.cam || [0, 5, -14])[1]).addScaledVector(car.fwd, (f.cam || [0, 5, -14])[2]);
      camera.up.copy(car.up);
      camera.lookAt(car.pos.clone().addScaledVector(car.up, 0.8));
      camera.fov = 45;
      if (f.look) {
        // 넓은 풍경용: 카메라 위치와 바라볼 곳을 직접 지정
        camera.position.fromArray(f.pos);
        camera.up.set(0, 1, 0);
        camera.lookAt(new THREE.Vector3().fromArray(f.look));
        camera.fov = 60;
      }
      camera.updateProjectionMatrix();
      sun.position.copy(car.pos).add(SUN_OFFSET);
      sun.target.position.copy(car.pos);
      renderer.render(scene, camera);
      const cw = renderer.domElement.width, ch = renderer.domElement.height;
      const s = Math.max(w / cw, h / ch);
      g.drawImage(renderer.domElement, (cw - w / s) / 2, (ch - h / s) / 2, w / s, h / s, (i % cols) * w, Math.floor(i / cols) * h, w, h);
      g.fillStyle = '#000a';
      g.fillRect((i % cols) * w, Math.floor(i / cols) * h, w, 26);
      g.fillStyle = '#fff';
      g.font = 'bold 16px sans-serif';
      g.fillText(f.label || String(i), (i % cols) * w + 8, Math.floor(i / cols) * h + 19);
    });
    await fetch(`/__shot?name=${name}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.85) });
    return `.debug/${name}.jpg`;
  },
  /** 화면이 멈춰 있을 때도 현재 상태를 한 장 그려봄 */
  /** 테스트용: 창이 숨겨져 rAF가 멈췄을 때 게임 루프를 직접 seconds초 돌림 (출발 신호 등 확인용) */
  tick(seconds, fps = 60) {
    for (let i = 0; i < seconds * fps; i++) frame(last + 1000 / fps, true);
  },
  renderOnce() {
    speedFx.hide();
    model.sync(car, 1, elapsed);
    snapCamera();
    sun.position.copy(car.pos).add(SUN_OFFSET);
    sun.target.position.copy(car.pos);
    track.animate(elapsed);
    scenery.animate(elapsed, 0, car);
    props.animate(elapsed);
    renderer.render(scene, camera);
  },
};
// 튜토리얼 (?tutorial=1, src/tutorial.js), 멀티플레이 (?room=코드, src/netRace.js): 주소에 있을 때만 불러옴
if (params.get('tutorial')) import('./tutorial.js').then((m) => m.startTutorial(window.game)).catch((e) => console.warn('튜토리얼 불러오기 실패', e));
if (params.get('room')) import('./netRace.js').then((m) => m.startNetRace(window.game, params)).catch((e) => console.warn('멀티플레이 불러오기 실패', e));
