// 차 사진(썸네일) 만들기: 홈 화면 차 고르기 목록의 카드마다 진짜 차 모습을 보여 줌
//   - 화면에 안 보이는 작은 3D 그림판(WebGLRenderer) 하나로 차를 한 대씩 3/4 앞모습으로 찍어 그림(dataURL)으로 만듦
//   - 배경은 투명, 차 밑에 부드러운 그림자. 카드 배경색(등급 색)이 뒤에 비침
//   - 한 번 찍은 사진은 기억해 둠: 메모리 + 브라우저 저장소(localStorage 'gimmick.carThumbs')
//     저장 열쇠 = 차 id + 차 모습(look) + carModel.js 내용으로 만든 짧은 해시 → 차 모습이나 모델 코드를 고치면 자동으로 다시 찍음
//   - 15대를 한꺼번에 찍으면 화면이 잠깐 멈추므로, 한 대 찍고 쉬고 한 대 찍고 쉬고 (고른 차부터)
//   - 다 찍으면 3D 그림판은 정리(dispose)해서 메모리를 돌려줌
// 사용법:
//   const job = loadCarThumbs(cars, { first: 'f1', onThumb: (id, url) => { img.src = url } });
//   thumbUrl('f1')   // 이미 찍은 사진 (없으면 null)
//   job.done.then((stats) => console.log(stats))   // { rendered, cached, ms }
import * as THREE from 'three';
import { createCarModel } from './carModel.js';
import { costumeOf } from './carCostumes.js';

const THUMB_VER = 12; // 찍는 방법(각도·조명·크기)을 바꾸면 올릴 것 → 저장된 사진을 모두 다시 찍음
const STORE_KEY = 'gimmick.carThumbs';
const W = 400, H = 250; // 사진 크기 (카드에 약 150×94로 보임, 고해상도 화면 2배 기준)

/** 짧은 해시 (FNV-1a 32비트) */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const mem = new Map(); // id → { h, url }
let srcHashPromise = null;
/** carModel.js 내용 해시 (모델 코드를 고치면 바뀜). 못 읽으면 'x' */
function modelSrcHash() {
  if (!srcHashPromise) {
    // carModel.js + 차체 파일들(carBody_*.js) 내용을 모두 합쳐서 해시
    const FILES = ['carModel', 'carWheels', 'carLighting', 'carCostumes', 'carBody_boat', 'carBody_accel', 'carBody_wheels', 'carBody_cockpit', ...['f1', 'gt', 'rally', 'proto', 'rocket', 'buggy', 'hatch', 'muscle', 'hyper', 'kart', 'roadster', 'truck', 'ev', 'wedge', 'van'].map((x) => 'carBody_' + x)];
    srcHashPromise = Promise.all(FILES.map((f) => fetch(new URL(`./${f}.js`, import.meta.url)).then((r) => (r.ok ? r.text() : ''))))
      .then((a) => a.join('|'))
      .then((t) => (t ? hash(t) + t.length.toString(36) : 'x'))
      .catch(() => 'x');
  }
  return srcHashPromise;
}

function readStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return s && typeof s === 'object' && s.items ? s : { items: {} };
  } catch {
    return { items: {} };
  }
}
let saveTimer = 0;
/** 저장은 모아서 한 번에 (사진마다 저장하면 느림). 저장소가 꽉 차면 그냥 안 함 */
function saveStoreSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const items = {};
    for (const [id, v] of mem) items[id] = v;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: THUMB_VER, items }));
    } catch {
      try {
        localStorage.removeItem(STORE_KEY);
      } catch {}
    }
  }, 400);
}

/** 이미 찍은 사진 dataURL (없으면 null) */
export function thumbUrl(id) {
  const v = mem.get(id);
  return v ? v.url : null;
}

// ------------------------------------------------------------------ 사진 찍는 3D 그림판 (필요할 때 만들고, 다 쓰면 정리)
// 홈·로비가 동시에 요청해도 한 작업이 다 쓴 뒤 그림판을 정리하도록 순서를 지킴.
let thumbJobs = Promise.resolve();
let studio = null;
async function getStudio() {
  if (studio) return studio;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .96;

  const scene = new THREE.Scene();
  // 반짝이는 페인트용 방 조명 반사 (홈 3D 미리보기와 같은 느낌). 못 불러와도 그냥 찍음
  let envTex = null;
  try {
    const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
    const pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pm.dispose();
    scene.environment = envTex;
    scene.environmentIntensity = 0.6;
  } catch {}
  scene.add(new THREE.HemisphereLight('#dfeaff', '#1b1630', 1.0));
  const key = new THREE.DirectionalLight('#f4f5f7', 2.0);
  key.position.set(6, 9, 7);
  const rimBlue = new THREE.DirectionalLight('#adb9d4', 1.2);
  rimBlue.position.set(-7, 3, -5);
  const rimWarm = new THREE.DirectionalLight('#f0e4d5', .5);
  rimWarm.position.set(7, 2.5, -6);
  scene.add(key, rimBlue, rimWarm);

  // 차 밑 그림자 (가운데가 진한 둥근 얼룩)
  const sc = document.createElement('canvas');
  sc.width = sc.height = 128;
  const g = sc.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.38)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(sc);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = -1;
  scene.add(shadow);

  const camera = new THREE.PerspectiveCamera(20, W / H, 0.1, 200);
  studio = {
    renderer, scene, camera, shadow, canvas,
    dispose() {
      shadow.geometry.dispose();
      shadow.material.dispose();
      shadowTex.dispose();
      if (envTex) envTex.dispose();
      renderer.dispose();
      try {
        renderer.forceContextLoss();
      } catch {}
      studio = null;
    },
  };
  return studio;
}

// createCarModel이 쓰는 차 상태를 흉내 낸 가짜 차 (홈 미리보기와 같음, 서 있는 일반 모드)
const fake = {
  pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, 1), vel: new THREE.Vector3(),
  mode: 'normal', sink: 0, forwardSpeed: 0, thr: 0, grounded: true, surface: 'road', drifting: false, driftDir: 0, driftLevel: 0,
  steerVisual: 0, load: 0, form: null, flying: false, boostTime: 0, brk: 0,
};

/** 보이는 부품만으로 상자 크기 (숨긴 변신 부품·날개·투명 효과는 빼고) */
function visibleBox(root) {
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  root.updateMatrixWorld(true);
  (function walk(o) {
    if (!o.visible) return;
    // 안 보이는 효과(투명도 0인 빛 고리·빛기둥)는 빼고
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const ghost = mat && mat.transparent && mat.opacity < 0.05;
    if (o.isMesh && o.geometry && !ghost) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (Number.isFinite(tmp.min.x)) box.union(tmp);
    }
    for (const c of o.children) walk(c);
  })(root);
  return box;
}

const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const nap = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** 캔버스 → dataURL. toBlob은 그림 압축을 따로(비동기) 해서 화면이 덜 멈춤 */
function canvasUrl(canvas) {
  return new Promise((resolve) => {
    const sync = () => {
      try {
        const u = canvas.toDataURL('image/webp', 0.86);
        resolve(u.startsWith('data:image/webp') ? u : canvas.toDataURL('image/png'));
      } catch {
        resolve('');
      }
    };
    if (!canvas.toBlob) return sync();
    canvas.toBlob((blob) => {
      if (!blob) return sync();
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = sync;
      fr.readAsDataURL(blob);
    }, 'image/webp', 0.86);
  });
}
/**
 * 사진 한 장: 차를 만들고 → (쉬고) → 셰이더 준비 → 찍고 → 정리 → 압축.
 * 일을 잘게 나눠서 한 번에 화면을 오래 붙잡지 않게. busy = 화면을 붙잡은 가장 긴 시간(ms)
 */
async function shoot(st, look, timing) {
  let t = performance.now();
  const lap = () => {
    const n = performance.now();
    timing.busy = Math.max(timing.busy, n - t);
    timing.total += n - t;
  };
  let model;
  try {
    model = createCarModel(look && typeof look === 'object' && !Object.keys(look).length ? '#e8463a' : look || '#e8463a');
  } catch (e) {
    console.warn('차 사진: 모델 만들기 실패', e);
    model = createCarModel('#e8463a');
  }
  model.sync(fake, 1, 0);
  st.scene.add(model.root);
  const box = visibleBox(model.root);
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(2, 1, 4.5));
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // 그림자: 바퀴 바로 밑, 차보다 조금 크게
  st.shadow.position.set(center.x, box.min.y + 0.01, center.z);
  st.shadow.scale.set(size.x * 1.55, size.z * 1.25, 1);

  // 카메라: 앞쪽 3/4 (차 앞이 화면 왼쪽 아래를 봄), 살짝 위에서
  const cam = st.camera;
  cam.zoom = 1;
  cam.clearViewOffset();
  const dir = new THREE.Vector3(-1.05, 0.5, 1.25).normalize();
  const r = size.length() / 2;
  const dist = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2));
  const target = center.clone();
  cam.position.copy(target).addScaledVector(dir, dist);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  // 화면에 꽉 차게: 상자 8 귀퉁이를 화면에 비춰 보고 확대·가운데 맞춤
  let i = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners[i++].set(x, y, z);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of corners) {
    const p = c.clone().project(cam);
    x0 = Math.min(x0, p.x), x1 = Math.max(x1, p.x), y0 = Math.min(y0, p.y), y1 = Math.max(y1, p.y);
  }
  const zoom = Math.min(0.9 / ((x1 - x0) / 2), 0.8 / ((y1 - y0) / 2));
  cam.zoom = zoom;
  cam.updateProjectionMatrix();
  const cx = ((x0 + x1) / 2) * zoom, cy = ((y0 + y1) / 2) * zoom;
  // 차가 살짝 아래쪽에 앉게 (위쪽 여백에 등급 글자)
  cam.setViewOffset(W, H, (cx * W) / 2, (-cy * H) / 2 - H * 0.03, W, H);
  lap();
  await nap();
  t = performance.now();
  // 셰이더를 미리 준비 (가능하면 GPU가 따로 처리 → 첫 그림이 덜 멈춤)
  if (st.renderer.compileAsync) {
    try {
      await st.renderer.compileAsync(st.scene, cam);
    } catch {}
    t = performance.now();
  }
  st.renderer.render(st.scene, cam);
  // 그린 즉시 그림을 떠 둠 (압축은 비동기로)
  const urlP = canvasUrl(st.canvas);
  st.scene.remove(model.root);
  model.dispose();
  lap();
  return urlP;
}

/**
 * 차 사진을 차례로 준비 (저장된 것은 바로, 없는 것은 한 대씩 찍음)
 * @param cars [{ id, look }]
 * @param opts.first 먼저 찍을 차 id (지금 고른 차)
 * @param opts.onThumb (id, url) 사진이 준비될 때마다
 * @returns { done: Promise<{rendered, cached, ms, perCar}>, cancel(), prioritize(id) }
 */
export function loadCarThumbs(cars, { first, onThumb } = {}) {
  let cancelled = false;
  const queue = [...cars];
  const t0 = performance.now();
  const stats = { rendered: 0, cached: 0, ms: 0, perCar: 0, longest: 0 };
  const prioritize = (id) => {
    const i = queue.findIndex((c) => c.id === id);
    if (i > 0) queue.unshift(...queue.splice(i, 1));
  };
  if (first) prioritize(first);

  const previous = thumbJobs;
  let release;
  thumbJobs = new Promise((resolve) => (release = resolve));
  const done = (async () => {
    await previous;
    try {
      if (cancelled) return stats;
      const src = await modelSrcHash();
      const store = readStore();
      const keyOf = (c) => hash(`${THUMB_VER}|${W}x${H}|${src}|${c.id}|${JSON.stringify(c.look ?? null)}|${JSON.stringify(costumeOf(c.look?.costume))}`);
      // 1) 저장된 사진 먼저 (열쇠가 같을 때만)
      for (let k = queue.length - 1; k >= 0; k--) {
        const c = queue[k];
        const h = keyOf(c);
        const m = mem.get(c.id);
        const s = store.v === THUMB_VER && store.items[c.id];
        const hit = m && m.h === h ? m : s && s.h === h && s.url ? s : null;
        if (hit) {
          mem.set(c.id, hit);
          queue.splice(k, 1);
          stats.cached++;
          onThumb && onThumb(c.id, hit.url);
        }
      }
      // 2) 없는 것은 한 대씩 찍기 (사이사이 쉬어서 화면이 안 멈추게)
      if (queue.length && !cancelled) {
        let st;
        try {
          st = await getStudio();
        } catch (e) {
          console.warn('차 사진을 만들 수 없어요 (WebGL)', e);
          return stats;
        }
        const timing = { busy: 0, total: 0 };
        while (queue.length && !cancelled) {
          const c = queue.shift();
          let url = '';
          try {
            url = await shoot(st, c.look, timing);
          } catch (e) {
            console.warn('차 사진 실패', c.id, e);
          }
          if (url) {
            mem.set(c.id, { h: keyOf(c), url });
            stats.rendered++;
            onThumb && onThumb(c.id, url);
          }
          await nap(12);
        }
        stats.perCar = stats.rendered ? +(timing.total / stats.rendered).toFixed(1) : 0; // 차 한 대에 화면을 붙잡은 시간 합
        stats.longest = +timing.busy.toFixed(1); // 가장 길게 붙잡은 한 번
        st.dispose();
        if (stats.rendered) saveStoreSoon();
      }
      stats.ms = Math.round(performance.now() - t0);
      return stats;
    } finally {
      release();
    }
  })();
  return { done, cancel: () => (cancelled = true), prioritize };
}
