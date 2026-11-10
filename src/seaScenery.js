// 노을 해안 서킷 풍경 (seaMap.js가 부름)
//   노을 하늘·해·구름, 조명(따뜻한 노을빛, 낮은 해 → 긴 그림자), 출발 게이트(F1 빨간불), 관중석·피트,
//   항구(방파제 산책로·부두·요트·크레인·화물선), 산토리니풍 하얀 마을, 곶 위 소나무·풍차·빌라, 사장교 주탑·케이블,
//   등대섬, 서쪽 해변(파라솔·구조대·매점), 물길 부표·슬라럼 표지, 바다 동굴(바위 아치), 파도 점프대 거품, 소용돌이,
//   돌고래, 갈매기, 먼 섬, 크루즈선
// 위치는 sea.json의 점 번호(p)로 → 코스를 고쳐도 따라감. 단단한 물체는 도로(연석 + 여유) 밖에만 세움
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom, canvasTexture } from './track.js';
import * as A from './gpAssets.js';
import { SEA } from './seaTrack.js';
import { buildSeaLife } from './seaLife.js';

const CAR_R = 1.3;
const CELL = 24;
const UPV = new THREE.Vector3(0, 1, 0);

/** 부품에 색을 입혀 합치기 쉬운 모양으로 (위치·법선·색만) */
function colored(geo, color, m4 = null) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m4) g.applyMatrix4(m4);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) (arr[i * 3] = c.r), (arr[i * 3 + 1] = c.g), (arr[i * 3 + 2] = c.b);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** 야자수 (높이 약 9 m, 줄기 갈색 + 잎 초록 + 코코넛) */
function palmGeometry() {
  const parts = [];
  let x = 0, y = 0, lean = 0;
  for (let k = 0; k < 7; k++) {
    const h = 1.35, r0 = 0.3 - k * 0.022;
    lean += 0.045;
    parts.push(colored(new THREE.CylinderGeometry(r0 - 0.02, r0, h + 0.05, 7), k % 2 ? '#8a6542' : '#7a5636', M(x, y + h / 2, 0, 0, 0, -lean)));
    x += Math.sin(lean) * h;
    y += Math.cos(lean) * h;
  }
  const top = [x, y];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const leaf = new THREE.BoxGeometry(0.7, 0.06, 3.2).translate(0, 0, 1.6);
    parts.push(colored(leaf, i % 2 ? '#3f9a3a' : '#5bb346', new THREE.Matrix4().makeTranslation(top[0], top[1], 0).multiply(M(0, 0, 0, 0, a, 0)).multiply(M(0, 0, 0, -0.25, 0, 0))));
    const tip = new THREE.BoxGeometry(0.5, 0.05, 2.4).translate(0, 0, 1.2);
    parts.push(colored(tip, '#4aa83f', new THREE.Matrix4().makeTranslation(top[0], top[1], 0).multiply(M(0, 0, 0, 0, a, 0)).multiply(M(0, 0.62, 3.0, 0.55, 0, 0))));
  }
  for (let i = 0; i < 3; i++) parts.push(colored(new THREE.IcosahedronGeometry(0.24, 0), '#6b4a22', M(top[0] + Math.cos(i * 2.1) * 0.35, top[1] - 0.3, Math.sin(i * 2.1) * 0.35)));
  return mergeGeometries(parts);
}
/** 소나무 (곶 위) */
function pineGeometry() {
  const parts = [colored(new THREE.CylinderGeometry(0.22, 0.32, 3, 6), '#6b4a30', M(0, 1.5, 0))];
  for (let k = 0; k < 3; k++) parts.push(colored(new THREE.ConeGeometry(2.4 - k * 0.6, 3.2, 7), k % 2 ? '#2f6e3c' : '#3a7f45', M(0, 3 + k * 1.9, 0)));
  return mergeGeometries(parts);
}
/** 둥근 지중해 나무 (올리브·사이프러스 느낌) */
function cypressGeometry() {
  return mergeGeometries([colored(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6), '#6b4a30', M(0, 0.8, 0)), colored(new THREE.SphereGeometry(1, 7, 6), '#3d7a3a', M(0, 4.4, 0, 0, 0, 0, 1.1, 3.4, 1.1))]);
}
function bushGeometry() {
  return mergeGeometries([colored(new THREE.IcosahedronGeometry(1.4, 1), '#5c9a40', M(0, 0.8, 0, 0, 0, 0, 1.3, 0.8, 1.1)), colored(new THREE.IcosahedronGeometry(0.9, 1), '#6fae4a', M(0.9, 1.2, 0.3))]);
}
/** 바위 (울퉁불퉁한 다면체) */
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const r = seededRandom(seed);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + r() * 0.45;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
/** 요트 (흰 선체 + 돛대 + 돛) */
function yachtGeometry(sail = true) {
  const hull = new THREE.CylinderGeometry(0.75, 1.15, 6.4, 10).rotateX(Math.PI / 2).scale(1, 0.55, 1);
  const parts = [colored(hull, '#ffffff', M(0, 0.35, 0)), colored(new THREE.BoxGeometry(1.9, 0.12, 5.6), '#c79a64', M(0, 0.62, 0)), colored(new THREE.BoxGeometry(1.4, 0.8, 1.8), '#f2f2f2', M(0, 1.05, -0.6))];
  if (sail) {
    parts.push(colored(new THREE.CylinderGeometry(0.07, 0.09, 9, 5), '#dddddd', M(0, 5.1, 0.6)));
    const s = new THREE.BufferGeometry();
    s.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.4, 0.7, 0, 9.2, 0.7, 0, 1.4, -2.6, 0, 1.4, 0.7, 0, 1.4, -2.6, 0, 9.2, 0.7], 3));
    s.computeVertexNormals();
    parts.push(colored(s, '#fbf7ee'));
    const j = new THREE.BufferGeometry();
    j.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.3, 0.9, 0, 8.4, 0.75, 0, 1.3, 3.0, 0, 1.3, 0.9, 0, 1.3, 3.0, 0, 8.4, 0.75], 3));
    j.computeVertexNormals();
    parts.push(colored(j, '#f6efe2'));
  }
  return mergeGeometries(parts);
}
/** 작은 어선 (선실 + 색 띠) */
function fishBoatGeometry() {
  const hull = new THREE.CylinderGeometry(0.9, 1.3, 7, 8).rotateX(Math.PI / 2).scale(1, 0.6, 1);
  return mergeGeometries([colored(hull, '#ffffff', M(0, 0.45, 0)), colored(new THREE.BoxGeometry(2.3, 0.3, 6.4), '#2e6fd8', M(0, 0.95, 0)), colored(new THREE.BoxGeometry(1.7, 1.6, 2), '#f4f1ea', M(0, 1.9, -1)), colored(new THREE.BoxGeometry(1.9, 0.2, 2.3), '#e8463a', M(0, 2.8, -1)), colored(new THREE.CylinderGeometry(0.06, 0.06, 4, 4), '#555555', M(0, 3.5, 1.5))]);
}
/** 부표 (몸통 + 꼭대기 원뿔). 색은 인스턴스 색 */
function buoyGeometry() {
  return mergeGeometries([colored(new THREE.CylinderGeometry(0.55, 0.8, 1.4, 10), '#ffffff', M(0, 0.25, 0)), colored(new THREE.ConeGeometry(0.34, 0.9, 8), '#f4f4f4', M(0, 1.4, 0)), colored(new THREE.TorusGeometry(0.72, 0.1, 5, 12), '#333333', M(0, -0.25, 0, Math.PI / 2))]);
}
/** 갈매기 (V자 날개) */
function gullGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.4, -1.1, 0.25, -0.1, 0, 0, -0.3, 0, 0, 0.4, 0, 0, -0.3, 1.1, 0.25, -0.1, 0, -0.05, 0.6, 0, -0.05, -0.5, 0.06, 0.05, 0], 3));
  g.computeVertexNormals();
  return g;
}
/** 돌고래 (길쭉한 몸 + 등지느러미 + 꼬리) */
function dolphinGeometry() {
  return mergeGeometries([
    colored(new THREE.SphereGeometry(0.45, 10, 7), '#7b8fa6', M(0, 0, 0, 0, 0, 0, 1, 0.9, 3.2)),
    colored(new THREE.ConeGeometry(0.2, 0.7, 4), '#6d8099', M(0, 0.55, -0.1, -0.5, 0, 0)),
    colored(new THREE.BoxGeometry(1.1, 0.06, 0.4), '#6d8099', M(0, 0, -1.55)),
    colored(new THREE.ConeGeometry(0.16, 0.6, 5), '#9aabbd', M(0, -0.05, 1.6, Math.PI / 2, 0, 0)),
  ]);
}

export function buildSeaScenery(track, scene) {
  const rand = seededRandom(20261110);
  const R = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const W = track.width, HW = W / 2, CURB = track.curb, DECK = track.deckHalf;
  const data = track.data;
  const P = data.places || {};
  const group = new THREE.Group();
  scene.add(group);
  const animators = [];
  const tmpV = new THREE.Vector3();
  const tAt = (p) => track.tOfP(p);
  const sAt = (p) => track.sampleAt(tAt(p));
  const yawOf = (s) => Math.atan2(s.tan.x, s.tan.z);
  const add = (obj, x, y, z, ry = 0) => {
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    group.add(obj);
    return obj;
  };
  const anim = (a) => a.update && animators.push((t, dt) => a.update(t, dt));

  // ---------------------------------------------------------------- 충돌체 (원, 높이 y0~y1)
  const grid = new Map();
  let stamp = 0;
  const allColliders = [];
  function addCollider(c) {
    c.stamp = 0;
    allColliders.push(c);
    for (let cx = Math.floor((c.x - c.r) / CELL); cx <= Math.floor((c.x + c.r) / CELL); cx++)
      for (let cz = Math.floor((c.z - c.r) / CELL); cz <= Math.floor((c.z + c.r) / CELL); cz++) {
        const k = `${cx},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
  }
  const circle = (x, z, r, y0, y1) => addCollider({ x, z, r, y0, y1 });

  // ---------------------------------------------------------------- 자리 찾기
  const occupied = [];
  const free = (x, z, r) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
  const occupy = (x, z, r) => occupied.push({ x, z, r });
  /** 도로(연석 + 여유 margin)에서 r만큼 떨어졌는가 */
  //   (기준은 넓힌 코너 연석 2.8 m: 미끄러져 나간 차가 바로 옆 물체에 걸려 멈추지 않게)
  const roadClear = (x, z, r, margin = 4) => track.nearestRaw(tmpV.set(x, 0, z)) > HW + Math.max(CURB, 2.8) + margin + r;
  const groundY = (x, z) => track.groundY(x, z);
  /** 물 위로 나온 땅 높이 (minY보다 낮으면 null) */
  const landY = (x, z, minY = 0.4) => {
    const y = groundY(x, z);
    return y !== null && y > minY ? y : null;
  };
  /** 지점 t 옆 l m */
  const beside = (t, l) => {
    const s = track.sampleAt(t);
    return { s, p: track.surf(s, l, 0, new THREE.Vector3()) };
  };
  /** 기울기가 완만한가 (집·관중석 자리) */
  const flatEnough = (x, z, r, maxD = 2.2) => {
    let lo = Infinity, hi = -Infinity;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const y = groundY(x + dx, z + dz);
      if (y === null) return false;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    return hi - lo < maxD;
  };

  // 인스턴스 묶음
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  function instanced(geo, mat, list, { shadow = true, name = '' } = {}) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((it, i) => {
      q.setFromEuler(e.set(it.rx || 0, it.ry || 0, it.rz || 0));
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1));
      im.setMatrixAt(i, m4);
      if (it.color) im.setColorAt(i, new THREE.Color(it.color));
    });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.name = name;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  }

  // 배 목록 (마지막에 인스턴스로, 둥실둥실): ships = 큰 배, boatSets = 요트·어선 묶음
  const ships = [], boatSets = [];
  // 식물·바위 목록 (마지막에 인스턴스로)
  const palms = [], pines = [], cypress = [], bushes = [], rocks = [];
  const tint = (hex, amt = 0.08) => new THREE.Color(hex).offsetHSL(R(-0.02, 0.02), R(-amt, amt), R(-amt, amt)).getHexString();
  function palm(x, z, s = R(0.85, 1.25), solid = true) {
    const y = landY(x, z, 0.3);
    if (y === null) return false;
    palms.push({ x, y: y - 0.1, z, s, ry: R(0, 6.3), color: '#' + tint('#ffffff', 0.12) });
    if (solid) circle(x, z, 0.4 * s, y, y + 9 * s);
    return true;
  }
  function pine(x, z, s = R(0.9, 1.5)) {
    const y = landY(x, z, 1);
    if (y === null) return false;
    pines.push({ x, y: y - 0.2, z, s, ry: R(0, 6.3), color: '#' + tint('#ffffff', 0.15) });
    circle(x, z, 0.5 * s, y, y + 9 * s);
    return true;
  }
  function tree(x, z, s = R(0.8, 1.3)) {
    const y = landY(x, z, 1);
    if (y === null) return false;
    cypress.push({ x, y: y - 0.1, z, s, ry: R(0, 6.3), color: '#' + tint('#ffffff', 0.15) });
    circle(x, z, 0.5 * s, y, y + 7 * s);
    return true;
  }
  function bush(x, z, s = R(0.7, 1.3)) {
    const y = groundY(x, z);
    if (y === null || y < 0.3) return;
    bushes.push({ x, y: y - 0.2, z, s, ry: R(0, 6.3), color: '#' + tint('#ffffff', 0.15) });
  }
  function rock(x, z, s, color = '#9a8a7a', y = null, solid = true) {
    const gy = y ?? groundY(x, z) ?? 0;
    rocks.push({ x, y: gy + s * 0.2, z, s, sx: s * R(0.9, 1.6), sy: s * R(0.7, 1.3), sz: s * R(0.9, 1.5), ry: R(0, 6.3), rx: R(-0.3, 0.3), color });
    if (solid) circle(x, z, s * 1.1, gy - 3, gy + s * 1.4);
  }

  // ---------------------------------------------------------------- 하늘, 조명, 안개 (노을)
  const SUN_DIR = SEA.sunDir;
  scene.background = new THREE.Color('#f3a77e');
  scene.fog = new THREE.Fog('#f2ae8c', 420, 2400);
  let sunLight = null, hemi = null;
  scene.traverse((o) => {
    if (o.isDirectionalLight && !sunLight) sunLight = o;
    if (o.isHemisphereLight && !hemi) hemi = o;
  });
  if (sunLight) {
    sunLight.color.set('#ffcf9e');
    sunLight.intensity = 2.6;
  }
  if (hemi) {
    hemi.color.set('#ffe0cc');
    hemi.groundColor.set('#6a6488');
    hemi.intensity = 1.15;
  }
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: SUN_DIR.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      // 하늘 공(반지름 4200)이 카메라 먼 거리(3000)보다 커서 화면 모서리가 잘렸음 → 늘 가장 먼 곳 바로 앞에 그림
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.9999; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sunSide = clamp(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5, 0.0, 1.0);
        // 색은 화면에 보이는 색(sRGB) 그대로 적음. 지평선 = 안개색(#f3a77e)과 비슷하게
        vec3 horizon = mix(vec3(0.95, 0.65, 0.50), vec3(1.0, 0.70, 0.42), sunSide);
        vec3 mid = mix(vec3(0.90, 0.58, 0.60), vec3(1.0, 0.58, 0.40), sunSide * sunSide);
        vec3 zen = vec3(0.42, 0.37, 0.64);
        vec3 col;
        if (h >= 0.0) {
          float t = pow(h, 0.6);
          col = mix(horizon, mid, smoothstep(0.0, 0.32, t));
          col = mix(col, zen, smoothstep(0.32, 1.0, t));
        } else col = horizon;
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.72, 0.42) * (pow(s, 5.0) * 0.28 + pow(s, 48.0) * 0.6);
        col = mix(col, vec3(1.0, 0.96, 0.82), smoothstep(0.99935, 0.9996, s)); // 해 원반
        // 톤 매핑을 거치면 노을색이 허옇게 바래서, sRGB 색을 직선 색으로 바꿔서 그대로 내보냄
        gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(2.2)), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  // 노을 구름 (해 쪽은 금빛, 반대쪽은 분홍·보라)
  {
    const tex = canvasTexture(256, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const r = seededRandom(7);
      for (let i = 0; i < 26; i++) {
        const x = w * (0.15 + r() * 0.7), y = h * (0.45 + r() * 0.25), rr = 14 + r() * 26;
        const gr = g.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, 'rgba(255,255,255,0.85)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
    });
    const clouds = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const a = R(0, Math.PI * 2), d = R(1700, 3200), y = R(260, 820);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const toward = Math.max(0, dir.dot(new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize()));
      const col = new THREE.Color('#d9a0c0').lerp(new THREE.Color('#ffd08a'), toward);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: tex, color: col, transparent: true, opacity: R(0.55, 0.9), depthWrite: false, fog: false }));
      const s = R(500, 1200);
      m.scale.set(s, s * R(0.6, 1), 1);
      m.position.set(dir.x * d, y, dir.z * d);
      m.lookAt(0, y * 0.7, 0);
      m.renderOrder = -9;
      clouds.add(m);
    }
    scene.add(clouds);
    animators.push((t, dt, car) => car && clouds.position.set(car.pos.x, 0, car.pos.z));
  }
  animators.push((t, dt, car) => {
    if (!car) return;
    sky.position.copy(car.pos).setY(0);
    // 해는 낮게 서쪽 바다 위 (긴 그림자). main.js가 해를 차 위에 놓은 뒤 여기서 방향만 바꿈
    if (sunLight) {
      sunLight.position.copy(car.pos).addScaledVector(SUN_DIR, 160);
      sunLight.target.position.copy(car.pos);
    }
  });
  // 먼 섬 실루엣 (바다 쪽 지평선)
  {
    const mat = new THREE.MeshLambertMaterial({ color: '#8a7f9e', flatShading: true });
    const list = [];
    for (let i = 0; i < 14; i++) {
      const a = R(-2.6, -0.4), d = R(1800, 2600);
      const x = Math.cos(a) * d, z = Math.sin(a) * d - 300;
      if (groundY(x, z) !== null && groundY(x, z) > -2) continue;
      list.push({ x, y: -8, z, sx: R(120, 320), sy: R(40, 120), sz: R(100, 260), ry: R(0, 3) });
    }
    instanced(rockGeometry(3), mat, list, { shadow: false, name: 'farIslands' });
  }

  // ---------------------------------------------------------------- 그랑프리 글자 바꾸기
  // 관중석·피트 건물·출발 게이트는 그랑프리 모델을 빌려 써서 "SKY HARBOR / 구름섬 그랑프리" 글자가 있었음
  // → 같은 크기의 바닷가 글자 그림으로 바꿈 (재질은 복사해서 바꿈: 그랑프리 원본은 그대로)
  const fitText = (c, text, maxW, size, weight = 900) => {
    let fs = size;
    do c.font = `${weight} ${fs}px "Segoe UI", sans-serif`;
    while (c.measureText(text).width > maxW && --fs > 8);
  };
  const seaTexBySize = {
    // 관중석 광고 띠
    '1024x128': () =>
      canvasTexture(1024, 128, (c, w, h) => {
        const blocks = [
          ['#ff6a2c', '#ffffff', 'SUNSET COAST'],
          ['#ffffff', '#1d5fa8', '노을 해안 서킷'],
          ['#ffcf3f', '#1d3f6e', 'SEA BREEZE'],
          ['#19b3a6', '#ffffff', 'BEACH FM 98.5'],
        ];
        const bw = w / blocks.length;
        blocks.forEach(([bg, fg, text], i) => {
          c.fillStyle = bg;
          c.fillRect(i * bw, 0, bw, h);
          c.fillStyle = fg;
          fitText(c, text, bw * 0.86, 56);
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(text, i * bw + bw / 2, h / 2 + 3);
        });
      }),
    // 피트 건물 큰 간판
    '1024x200': () =>
      canvasTexture(1024, 200, (c, w, h) => {
        c.fillStyle = '#1d6fa3';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = '#ffffff';
        c.lineWidth = 10;
        c.strokeRect(14, 14, w - 28, h - 28);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        fitText(c, 'SUNSET COAST', w * 0.8, 116);
        c.fillStyle = '#0d3a5c';
        c.fillText('SUNSET COAST', w / 2 + 5, h * 0.42 + 6);
        c.fillStyle = '#ffffff';
        c.fillText('SUNSET COAST', w / 2, h * 0.42);
        c.fillStyle = '#ffb02e';
        c.font = '800 40px "Segoe UI", sans-serif';
        c.fillText('노을 해안 서킷 · PIT LANE', w / 2, h * 0.82);
      }),
    // 출발 게이트 다리 (세로 글자)
    '128x768': () =>
      canvasTexture(128, 768, (c, w, h) => {
        c.fillStyle = '#1d6fa3';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, 10, h);
        c.fillRect(w - 10, 0, 10, h);
        c.save();
        c.translate(w / 2, h / 2);
        c.rotate(-Math.PI / 2);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        fitText(c, 'SUNSET COAST', h * 0.85, 80);
        c.fillText('SUNSET COAST', 0, 4);
        c.restore();
      }),
  };
  const seaTexCache = new Map(), seaMatCache = new Map();
  const rebrand = (obj) =>
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const one = (m) => {
        const img = m && m.map && m.map.image;
        const key = img && `${img.width}x${img.height}`;
        if (!key || !seaTexBySize[key]) return m;
        if (!seaMatCache.has(m)) {
          if (!seaTexCache.has(key)) seaTexCache.set(key, seaTexBySize[key]());
          const nm = m.clone();
          nm.map = seaTexCache.get(key).clone(); // repeat는 원래 것 그대로
          nm.map.repeat.copy(m.map.repeat);
          nm.map.offset.copy(m.map.offset);
          nm.map.needsUpdate = true;
          seaMatCache.set(m, nm);
        }
        return seaMatCache.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
    });

  // ---------------------------------------------------------------- 출발 게이트 (F1 빨간불: 운전자 왼쪽부터)
  {
    const s0 = track.sampleAt(0);
    const g = A.startGantry({ width: W + 2 * CURB });
    // 게이트 글자를 이 맵 이름으로
    const banner = canvasTexture(1024, 112, (c, w, h) => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ff7a3c';
      c.fillRect(0, 0, w, 10);
      c.fillRect(0, h - 10, w, 10);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '900 64px "Segoe UI", sans-serif';
      // 바닷가 이름만 (그랑프리 글자 없음): 해 + SUNSET COAST + 파도
      const all = c.measureText('SUNSET COAST').width;
      const x0 = w / 2 - all / 2;
      c.textAlign = 'left';
      c.fillStyle = '#ff6a2c';
      c.fillText('SUNSET ', x0, h / 2 + 3);
      c.fillStyle = '#1d3f6e';
      c.fillText('COAST', x0 + c.measureText('SUNSET ').width, h / 2 + 3);
      for (const x of [70, w - 70]) {
        c.fillStyle = '#ffb02e';
        c.beginPath();
        c.arc(x, h / 2 + 4, 24, Math.PI, 0);
        c.fill();
        c.strokeStyle = '#2ec4ff';
        c.lineWidth = 6;
        c.beginPath();
        for (let k = 0; k <= 24; k++) c.lineTo(x - 40 + k * (80 / 24), h / 2 + 14 + Math.sin(k * 0.8) * 4);
        c.stroke();
      }
    });
    g.obj.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m, k) => {
        if (m.map && m.map.image && m.map.image.width === 1024 && m.map.image.height === 112) {
          const nm = m.clone();
          nm.map = banner;
          if (Array.isArray(o.material)) o.material[k] = nm;
          else o.material = nm;
        }
      });
    });
    rebrand(g.obj);
    add(g.obj, s0.pos.x, s0.pos.y, s0.pos.z, yawOf(s0));
    anim(g);
    if (g.setLights) {
      animators.push(() => {
        const race = window.game && window.game.race;
        if (!race) return;
        if (race.phase === 'countdown') {
          g.setLights(race.lights ?? 0);
          g.setGreen && g.setGreen(false);
        } else {
          g.setLights(0);
          g.setGreen && g.setGreen(race.phase === 'racing' && race.time < 4);
        }
      });
    }
    for (const side of [-1, 1]) {
      const p = track.surf(s0, side * (HW + CURB + 1.5), 0, new THREE.Vector3());
      circle(p.x, p.z, 1.2, p.y - 1, p.y + 12);
    }
  }

  // ---------------------------------------------------------------- 항구: 산책로 + 방파제 벽 (출발 직선 바다 쪽)
  const harborP = P.harbor || [45.6, 2.6]; // 점 번호 범위
  const harborSide = P.harborSide ?? -1; // 바다 쪽 (운전자 왼쪽)
  const prom = { inner: HW + CURB + 3.2, outer: HW + CURB + 17 };
  {
    const [a, b] = (() => {
      const ta = tAt(harborP[0]), tb = tAt(harborP[1]);
      const ia = track.indexAt(ta);
      let ib = track.indexAt(tb);
      if (ib < ia) ib += track.sampleCount;
      return [ia, ib];
    })();
    const L = track.spanList(a, b);
    const stoneTex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#d8c9ac';
      g.fillRect(0, 0, w, h);
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 4; c++) {
          const v = 190 + Math.random() * 40;
          g.fillStyle = `rgb(${v},${v - 12},${v - 34})`;
          g.fillRect(c * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14);
        }
    });
    stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
    const wallTex = canvasTexture(128, 64, (g, w, h) => {
      g.fillStyle = '#8f8574';
      g.fillRect(0, 0, w, h);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++) {
          const v = 120 + Math.random() * 40;
          g.fillStyle = `rgb(${v},${v - 8},${v - 22})`;
          g.fillRect(c * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14);
        }
      g.fillStyle = 'rgba(40,80,60,0.45)';
      g.fillRect(0, h * 0.75, w, h * 0.25);
    });
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    const promMat = new THREE.MeshLambertMaterial({ map: stoneTex });
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide });
    const sd = harborSide;
    const geoStrip = (prof, mat) => {
      const pos = [], uv = [], idx = [];
      const n = prof.length;
      L.forEach((s, r) => {
        let acc = 0;
        prof.forEach(([l, h], k) => {
          if (k) acc += Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]);
          const v = track.surf(s, l, h, tmpV);
          pos.push(v.x, v.y, v.z);
          uv.push(acc / 4, s.dist / 4);
          if (r < L.length - 1 && k < n - 1) {
            const A0 = r * n + k;
            idx.push(A0, A0 + 1, A0 + n, A0 + 1, A0 + n + 1, A0 + n);
          }
        });
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    const a0 = sd * prom.inner, a1 = sd * prom.outer;
    geoStrip(sd < 0 ? [[a1, -0.05], [a0, -0.05]] : [[a0, -0.05], [a1, -0.05]], promMat);
    geoStrip([[a1, -0.05], [a1, -3.5 - 0.0]], wallMat).castShadow = true;
    // 산책로 끝 볼라드·가로등·야자수, 부두와 요트
    const N = L.length;
    let m = 0;
    for (let k = 3; k < N - 3; k++) {
      const s = L[k];
      const dist = s.dist;
      if (dist - m < 13) continue;
      m = dist;
      const idx = Math.round(dist / 13);
      const pL = track.surf(s, sd * (prom.inner + 2.5), 0);
      if (idx % 2 === 0) {
        const lp = A.lampPost();
        add(lp.obj, pL.x, pL.y - 0.05, pL.z, yawOf(s) + (sd < 0 ? Math.PI / 2 : -Math.PI / 2));
        circle(pL.x, pL.z, 0.4, pL.y - 1, pL.y + 6);
      } else {
        const pp = track.surf(s, sd * (prom.inner + 9), 0);
        palms.push({ x: pp.x, y: pp.y - 0.1, z: pp.z, s: R(0.9, 1.15), ry: R(0, 6.3), color: '#' + tint('#ffffff', 0.1) });
      }
    }
    // 부두 (판자 다리) + 요트
    const plank = canvasTexture(64, 64, (g, w, h) => {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? '#a8774a' : '#94653d';
        g.fillRect(0, (i * h) / 4, w, h / 4);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(0, ((i + 1) * h) / 4 - 2, w, 2);
      }
    });
    const plankMat = new THREE.MeshLambertMaterial({ map: plank });
    const postGeo = new THREE.CylinderGeometry(0.22, 0.22, 4, 6);
    const postMat = new THREE.MeshLambertMaterial({ color: '#5d4630' });
    const posts = [];
    const yachts = [], fishing = [];
    for (const u of P.piers || [0.18, 0.36, 0.55, 0.74, 0.9]) {
      const k = Math.round(u * (N - 1));
      const s = L[k];
      const base = track.surf(s, sd * prom.outer, -0.05);
      const out = new THREE.Vector3(s.right.x * sd, 0, s.right.z * sd);
      const len = R(34, 46);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.35, len), plankMat);
      pier.position.copy(base).addScaledVector(out, len / 2).setY(base.y - 1.2);
      pier.rotation.y = Math.atan2(out.x, out.z);
      pier.receiveShadow = pier.castShadow = true;
      group.add(pier);
      for (let d = 2; d < len; d += 5) for (const sgn of [-1, 1]) {
        const q = base.clone().addScaledVector(out, d).addScaledVector(s.tan, sgn * 1.4);
        posts.push({ x: q.x, y: base.y - 3, z: q.z });
      }
      for (let d = 8; d < len - 2; d += 9) for (const sgn of [-1, 1]) {
        if (rand() < 0.25) continue;
        const q = base.clone().addScaledVector(out, d).addScaledVector(s.tan, sgn * 4.6);
        (rand() < 0.7 ? yachts : fishing).push({ x: q.x, y: 0, z: q.z, ry: Math.atan2(out.x, out.z) + (rand() < 0.5 ? 0 : Math.PI), s: R(0.9, 1.2), ph: R(0, 6.3) });
      }
    }
    instanced(postGeo, postMat, posts, { name: 'pierPosts' });
    // 항구 크레인 (동쪽 끝 부두)
    const sC = sAt(harborP[1] - 0.15);
    for (const [u, h] of [[-30, 30], [10, 26]]) {
      const c = track.surf(sC, sd * (prom.outer + 22), 0).addScaledVector(sC.tan, u);
      const cr = A.crane({ height: h });
      const cy = Math.max(1.5, groundY(c.x, c.z) ?? 1.5);
      add(cr.obj, c.x, cy, c.z, Math.atan2(sC.right.x * sd, sC.right.z * sd));
      anim(cr);
    }
    // 화물선 (크레인 앞)
    {
      const c = track.surf(sC, sd * (prom.outer + 48), 0).addScaledVector(sC.tan, -10);
      ships.push({ x: c.x, z: c.z, ry: yawOf(sC), kind: 'cargo' });
    }
    boatSets.push({ list: yachts, geo: yachtGeometry(true) }, { list: fishing, geo: fishBoatGeometry() });
  }
  // ---------------------------------------------------------------- 관중석, 피트, 관제탑 (출발 직선 땅 쪽)
  const stands = [];
  function placeStand(p, side, length, roofColor) {
    const s = sAt(p);
    const front = HW + CURB + 5.5, need = HW + CURB + 4.5;
    let push = 0;
    for (let k = 0; k < 12; k++) {
      const q = track.surf(s, side * (front + push), 0, new THREE.Vector3());
      let gap = Infinity;
      for (const u of [-length / 2, -length / 4, length / 4, length / 2]) gap = Math.min(gap, track.nearestRaw(tmpV.set(q.x + s.tan.x * u, q.y, q.z + s.tan.z * u)));
      if (gap >= need) break;
      push += need - gap + 0.5;
    }
    const p0 = track.surf(s, side * (front + push), 0, new THREE.Vector3());
    const st = A.grandstand({ length, roofColor });
    rebrand(st.obj);
    add(st.obj, p0.x, p0.y - 0.05, p0.z, yawOf(s) + (side > 0 ? Math.PI : 0));
    const hd = st.halfDepth || 7;
    const c = track.surf(s, side * (front + push + hd), 0, new THREE.Vector3());
    for (let u = -length / 2; u <= length / 2; u += hd * 1.4) circle(c.x + s.tan.x * u, c.z + s.tan.z * u, hd + 0.5, p0.y - 2, p0.y + (st.height || 14));
    occupy(c.x, c.z, length / 2 + 4);
    stands.push({ st, c: c.clone() });
  }
  for (const [p, side, len, col] of P.stands || [[47.55, 1, 60, '#ff7a3c'], [0.45, 1, 64, '#2e6fd8']]) placeStand(p, side, len, col);
  animators.push((time, dt, car) => {
    for (const { st, c } of stands) {
      const d = car ? car.pos.distanceTo(c) : 999;
      st.excite = THREE.MathUtils.lerp(st.excite || 0, d < 90 ? 1 : 0.08, 1 - Math.exp(-4 * dt));
      if (st.update) st.update(time, dt, st.excite);
    }
  });
  {
    const s = sAt(P.pit ?? 1.35);
    const p0 = track.surf(s, HW + CURB + 6, 0, new THREE.Vector3());
    const pb = A.pitBuilding({ length: 72 });
    rebrand(pb.obj);
    add(pb.obj, p0.x, p0.y - 0.05, p0.z, yawOf(s) + Math.PI);
    anim(pb);
    const c = track.surf(s, HW + CURB + 14, 0, new THREE.Vector3());
    for (let u = -36; u <= 36; u += 9) circle(c.x + s.tan.x * u, c.z + s.tan.z * u, 9, p0.y - 2, p0.y + 16);
    occupy(c.x, c.z, 44);
    const tp = track.surf(s, HW + CURB + 42, 0, new THREE.Vector3()).addScaledVector(s.tan, -46);
    const ty = landY(tp.x, tp.z, 1);
    if (ty !== null) {
      const ct = A.controlTower();
      add(ct.obj, tp.x, ty, tp.z, yawOf(s) + Math.PI);
      anim(ct);
      circle(tp.x, tp.z, 5.6, ty, ty + 34);
      occupy(tp.x, tp.z, 10);
    }
  }

  // ---------------------------------------------------------------- 하얀 마을 (산토리니풍 집: 흰·파스텔 벽, 파란 돔, 주황 지붕)
  const winTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 2; c++) {
        const x = 18 + c * 60, y = 22 + r * 62;
        g.fillStyle = '#2f5d8a';
        g.fillRect(x, y, 30, 34);
        g.fillStyle = '#9fd0f0';
        g.fillRect(x + 4, y + 4, 22, 26);
        g.fillStyle = '#3a6fa4';
        g.fillRect(x - 6, y, 5, 34);
        g.fillRect(x + 31, y, 5, 34);
      }
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(0, h - 6, w, 6);
  });
  winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
  const houseGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  {
    const uv = houseGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.5, uv.getY(i) * 1.6);
  }
  const houses = [], roofs = [], domes = [], flatRoofs = [];
  const WALLS = ['#ffffff', '#fbf6ec', '#fff1dc', '#ffe4c9', '#f3f7ff', '#ffd9cf', '#fff6c8', '#e3f3ff'];
  function house(x, z, yaw, opts = {}) {
    const w = opts.w ?? R(8, 12), d = opts.d ?? R(7, 10), h = opts.h ?? (rand() < 0.5 ? R(5.5, 7) : R(8, 11));
    const r = Math.hypot(w, d) / 2;
    if (!free(x, z, r + 1) || !roadClear(x, z, r, opts.margin ?? 4)) return false;
    let lo = Infinity, hi = -Infinity;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (const [dx, dz] of [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]) {
      const y = groundY(x + dx * c + dz * sn, z - dx * sn + dz * c);
      if (y === null || y < 0.6) return false;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (hi - lo > (opts.slope ?? 5)) return false;
    const y0 = lo - 0.4, H = h + (hi - lo);
    houses.push({ x, y: y0, z, sx: w, sy: H, sz: d, ry: yaw, color: opts.color || pick(WALLS) });
    const kind = opts.roof || (rand() < 0.4 ? 'dome' : rand() < 0.6 ? 'tile' : 'flat');
    if (kind === 'tile') roofs.push({ x, y: y0 + H, z, sx: w * 0.78, sy: R(2.2, 3.4), sz: d * 0.78, ry: yaw + Math.PI / 4, color: pick(['#d9653b', '#c8552e', '#e0763f', '#b84a2a']) });
    else {
      flatRoofs.push({ x, y: y0 + H, z, sx: w + 0.5, sy: 0.45, sz: d + 0.5, ry: yaw });
      if (kind === 'dome') domes.push({ x: x + R(-w, w) * 0.15, y: y0 + H + 0.3, z: z + R(-d, d) * 0.15, s: Math.min(w, d) * R(0.28, 0.36), color: pick(['#2a6fd0', '#1f5fb8', '#3a86e0']) });
    }
    circle(x, z, r * 0.92, y0, y0 + H + 3);
    occupy(x, z, r + 1);
    return true;
  }
  /** 도로 p0~p1 양옆으로 줄지어 집 (rows: 연석 바깥에서 떨어진 거리들) */
  function street(p0, p1, sides, rows, opts = {}) {
    const a = track.indexAt(tAt(p0));
    let b = track.indexAt(tAt(p1));
    if (b < a) b += track.sampleCount;
    const L = track.spanList(a, b);
    let last = -99;
    for (const s of L) {
      if (s.dist - last < (opts.gap ?? 13)) continue;
      last = s.dist;
      for (const side of sides)
        for (const row of rows) {
          if (rand() < (opts.skip ?? 0.15)) continue;
          const p = track.surf(s, side * (HW + CURB + row + R(-1.5, 1.5)), 0, new THREE.Vector3());
          house(p.x + R(-2, 2), p.z + R(-2, 2), yawOf(s) + R(-0.12, 0.12), opts);
        }
    }
  }
  for (const [p0, p1, sides, rows, o] of P.streets || [
    [3.6, 9.4, [-1, 1], [9, 22, 36, 52], {}],
    [46.2, 47.4, [1], [10, 24], {}],
    [9.6, 12.5, [1], [12, 28, 46], { skip: 0.35 }],
    [12.6, 15.2, [-1], [16, 34], { skip: 0.5 }],
  ])
    street(p0, p1, sides, rows, o);
  // 언덕 위 흩어진 마을 (마을 뒤쪽)
  {
    const c = P.townCenter || [300, 150];
    for (let k = 0; k < 260; k++) house(c[0] + R(-230, 230), c[1] + R(-150, 200), R(0, 6.3), { slope: 4, margin: 6 });
  }
  // 하얀 교회 (파란 돔 + 종탑)
  {
    const s = sAt(P.church ?? 6.6);
    const p = track.surf(s, -(HW + CURB + 22), 0, new THREE.Vector3());
    const y = landY(p.x, p.z, 0.6);
    if (y !== null && roadClear(p.x, p.z, 8, 4) && free(p.x, p.z, 10)) {
      const g = new THREE.Group();
      const white = new THREE.MeshLambertMaterial({ color: '#ffffff' }), blue = new THREE.MeshLambertMaterial({ color: '#2a6fd0' });
      const mk = (geo, mat, x, yy, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, yy, z);
        m.castShadow = m.receiveShadow = true;
        g.add(m);
        return m;
      };
      mk(new THREE.BoxGeometry(12, 9, 16), white, 0, 4.5, 0);
      mk(new THREE.CylinderGeometry(4.6, 4.6, 1.6, 18), white, 0, 9.4, 0);
      mk(new THREE.SphereGeometry(4.6, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), blue, 0, 10.2, 0);
      mk(new THREE.BoxGeometry(4, 16, 4), white, 0, 8, -9);
      mk(new THREE.SphereGeometry(2.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), blue, 0, 16, -9);
      mk(new THREE.TorusGeometry(0.8, 0.2, 6, 10), new THREE.MeshLambertMaterial({ color: '#c9a032' }), 0, 13.5, -11.05);
      mk(new THREE.BoxGeometry(0.3, 2, 0.3), white, 0, 19, -9);
      add(g, p.x, y - 0.3, p.z, yawOf(s));
      circle(p.x, p.z, 9, y - 1, y + 20);
      occupy(p.x, p.z, 12);
    }
  }

  // ---------------------------------------------------------------- 곶 (절벽 능선): 소나무·사이프러스·풍차·빌라·바위
  {
    const zone = P.headland || [12.5, 26];
    const ia = track.indexAt(tAt(zone[0])), ib = track.indexAt(tAt(zone[1]));
    for (let k = 0; k < 900; k++) {
      const s = track.samples[Math.floor(R(ia, ib))];
      const side = rand() < 0.5 ? -1 : 1;
      const p = track.surf(s, side * (HW + CURB + R(8, 120)), 0, new THREE.Vector3());
      const x = p.x + R(-10, 10), z = p.z + R(-10, 10);
      const y = groundY(x, z);
      if (y === null || y < 2 || !roadClear(x, z, 1, 5) || !free(x, z, 2)) continue;
      const rr = rand();
      if (rr < 0.35) pine(x, z);
      else if (rr < 0.55) tree(x, z);
      else if (rr < 0.8) bush(x, z);
      else rock(x, z, R(0.8, 2.4), pick(['#b09a80', '#9c8670', '#a8917a']));
      occupy(x, z, 2);
    }
    for (const [p, l] of P.windmills || [[14.6, 60], [17.4, -70], [19.6, 58]]) {
      const { p: q } = beside(tAt(p), l);
      const y = landY(q.x, q.z, 2);
      if (y === null || !free(q.x, q.z, 6) || !roadClear(q.x, q.z, 5, 4)) continue;
      const wm = A.windmill({ color: pick(['#2a6fd0', '#e8463a']) });
      add(wm.obj, q.x, y - 0.3, q.z, Math.atan2(SUN_DIR.x, SUN_DIR.z));
      anim(wm);
      circle(q.x, q.z, 4.4, y - 1, y + 12);
      occupy(q.x, q.z, 7);
    }
    for (let k = 0; k < 40; k++) {
      const s = track.samples[Math.floor(R(ia, ib))];
      const side = rand() < 0.5 ? -1 : 1;
      const p = track.surf(s, side * (HW + CURB + R(18, 70)), 0, new THREE.Vector3());
      house(p.x, p.z, yawOf(s) + R(-0.3, 0.3), { slope: 3.5, margin: 8, h: R(5, 7), w: R(9, 14), d: R(8, 11) });
    }
  }

  // ---------------------------------------------------------------- 사장교 (주탑 2개 + 부채꼴 케이블 + 교각)
  const pillars = [];
  for (const br of track.bridgeRuns) {
    const list = track.spanList(br.a, br.b);
    const stepOf = (m) => Math.max(1, Math.round((m / track.length) * track.sampleCount));
    const cables = [];
    for (const u of [0.3, 0.72]) {
      const k = Math.round(u * (list.length - 1));
      const s = list[k];
      const H = 48;
      const py = A.bridgePylon({ height: H });
      const yaw = yawOf(s);
      py.obj.scale.set((DECK + 2) / 11, 1, 1);
      // 주탑 그림자가 다리 위에 진한 네모로 떨어져 이상해 보였음 → 주탑은 그림자 안 만듦 (케이블·상판은 그대로)
      py.obj.traverse((o) => (o.castShadow = false));
      add(py.obj, s.pos.x, s.pos.y - 1.6, s.pos.z, yaw);
      anim(py);
      for (const side of [-1, 1]) {
        const lp = track.surf(s, side * (DECK + 2), 0, new THREE.Vector3());
        const bot = -26, top = s.pos.y - 1.6;
        pillars.push({ x: lp.x, y: (top + bot) / 2, z: lp.z, sx: 1.3, sy: top - bot, sz: 1.3, ry: yaw });
        circle(lp.x, lp.z, 1.8, bot, top + H);
      }
      py.obj.updateMatrixWorld(true);
      for (const side of [-1, 1]) {
        const anc = py.anchors.filter((v) => Math.sign(v.x) === side).sort((a, b) => a.y - b.y);
        anc.forEach((v, j) => {
          const w = py.obj.localToWorld(v.clone());
          for (const dir of [-1, 1]) {
            const kk = THREE.MathUtils.clamp(k + dir * stepOf(9 + j * 8), 0, list.length - 1);
            const d = track.surf(list[kk], -side * (DECK - 0.3), 0.9, new THREE.Vector3());
            cables.push(w.x, w.y, w.z, d.x, d.y, d.z);
          }
        });
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
    group.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: '#fff6ee' })));
    for (let k = stepOf(20); k < list.length - stepOf(10); k += stepOf(42)) {
      const s = list[k];
      const top = s.pos.y - 1.8, bot = Math.min(-20, (groundY(s.pos.x, s.pos.z) ?? -20) - 1);
      if (top - bot < 3) continue;
      pillars.push({ x: s.pos.x, y: (top + bot) / 2, z: s.pos.z, sx: 1, sy: top - bot, sz: 1, ry: yawOf(s) });
    }
  }
  instanced(new THREE.BoxGeometry(3, 1, 3), new THREE.MeshLambertMaterial({ color: '#e4e1da' }), pillars, { name: 'bridgePiers' });

  // ---------------------------------------------------------------- 등대섬: 등대 + 관리인 집 + 바위 + 야자수
  {
    const lh = P.lighthouse || [285, -425];
    const y = landY(lh[0], lh[1], 1);
    if (y !== null) {
      const L = A.lighthouse();
      add(L.obj, lh[0], y - 0.4, lh[1], 0);
      anim(L);
      circle(lh[0], lh[1], 5.5, y - 1, y + 28);
      occupy(lh[0], lh[1], 9);
      const ct = A.cottage({ wall: '#ffffff', roof: '#2a6fd0' });
      const cx = lh[0] - 12, cz = lh[1] + 10, cy = landY(cx, cz, 1);
      if (cy !== null && roadClear(cx, cz, 4, 4)) {
        add(ct.obj, cx, cy - 0.2, cz, 0.6);
        circle(cx, cz, 4, cy - 1, cy + 8);
        occupy(cx, cz, 6);
      }
    }
    const disc = (data.land.discs || [])[0];
    if (disc) {
      for (let k = 0; k < 160; k++) {
        const a = R(0, 6.3), d = R(0, disc[2] + 10);
        const x = disc[0] + Math.cos(a) * d, z = disc[1] + Math.sin(a) * d;
        const y2 = groundY(x, z);
        if (y2 === null || !roadClear(x, z, 1, 4) || !free(x, z, 1.5)) continue;
        if (y2 < 0.4 && y2 > -2) rock(x, z, R(1, 3), pick(['#8f8578', '#7d7468']), Math.max(y2, -0.8));
        else if (y2 > 0.6) rand() < 0.5 ? palm(x, z) : rand() < 0.5 ? bush(x, z) : rock(x, z, R(0.6, 1.6), '#9c8f80');
        occupy(x, z, 1.5);
      }
    }
  }

  // ---------------------------------------------------------------- 해변 (파라솔 + 수건 + 구조대 + 매점 + 야자수)
  const umbrellas = [], towels = [];
  function beachProps(x, z) {
    const y = groundY(x, z);
    if (y === null || y < 0.35 || y > 2.6 || !roadClear(x, z, 2, 6) || !free(x, z, 2.5)) return;
    umbrellas.push({ x, y, z, s: R(0.9, 1.2), ry: R(0, 6.3), rz: R(-0.15, 0.15), color: pick(['#ff5a4a', '#ffcf3f', '#2e9fd8', '#19b3a6', '#ff8ad0', '#ffffff']) });
    towels.push({ x: x + R(-1.5, 1.5), y: y + 0.03, z: z + R(-1.5, 1.5), ry: R(0, 6.3), color: pick(['#ff7a5c', '#7ad0ff', '#ffe066', '#b48aff', '#7ee08a']) });
    occupy(x, z, 2.5);
  }
  {
    for (let k = 0; k < 4000 && umbrellas.length < 140; k++) {
      const x = R(-700, 760), z = R(-480, 120);
      const y = groundY(x, z);
      if (y === null || y < 0.4 || y > 1.8) continue;
      const f = track.coastField(x, z);
      if (f < 4 || f > 40) continue;
      if (rand() < 0.5) beachProps(x, z);
      else if (rand() < 0.35 && roadClear(x, z, 1, 5) && free(x, z, 2)) palm(x, z), occupy(x, z, 2);
    }
    const hut = (x, z, yaw, kind) => {
      const y = landY(x, z, 0.3);
      if (y === null || !roadClear(x, z, 4, 5) || !free(x, z, 4)) return;
      const g = new THREE.Group();
      const std = (c) => new THREE.MeshLambertMaterial({ color: c });
      const mk = (geo, mat, x2, y2, z2) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x2, y2, z2);
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      };
      if (kind === 'guard') {
        for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) mk(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 5), std('#f4f4f4'), lx, 1.3, lz);
        mk(new THREE.BoxGeometry(2, 1.6, 2), std('#e8463a'), 0, 3.4, 0);
        mk(new THREE.BoxGeometry(2.7, 0.15, 2.7), std('#ffffff'), 0, 4.3, 0);
        mk(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshLambertMaterial({ color: '#ffcf3f', side: THREE.DoubleSide }), 1.2, 5.6, 0);
        circle(x, z, 1.6, y - 1, y + 5);
      } else {
        mk(new THREE.BoxGeometry(6, 2.8, 4.5), std(pick(['#7fd6c8', '#ffd38a', '#ff9f8a'])), 0, 1.4, 0);
        mk(new THREE.BoxGeometry(7.4, 0.25, 6), std('#ffffff'), 0, 3.0, 0);
        mk(new THREE.BoxGeometry(4, 0.9, 0.2), std('#ff6a3c'), 0, 3.7, 2.4);
        circle(x, z, 3.8, y - 1, y + 4);
      }
      add(g, x, y - 0.1, z, yaw);
      occupy(x, z, 5);
    };
    for (const [p, l, kind] of P.huts || [[44.6, -22, 'guard'], [45.3, -26, 'bar'], [46.4, -30, 'guard'], [33.0, -24, 'bar']]) {
      const { s, p: q } = beside(tAt(p), l);
      hut(q.x, q.z, yawOf(s) + Math.PI / 2, kind);
    }
  }

  // ---------------------------------------------------------------- 물길: 부표 (양쪽 20 m마다, 빨강·흰색 번갈아) + 슬라럼 표지
  const buoyList = [];
  // (2026-11-10) data.laneBuoys가 있으면 물길 양옆 부표 줄은 seaGates.js가 만듦 (부딪히면 튕겨 나가고, 밖은 거친 물)
  for (const [a, b] of track.data.laneBuoys ? [] : track.waterRuns) {
    const list = track.spanList(a, b);
    let last = -99, n = 0;
    for (const s of list) {
      if (s.dist - last < 20) continue;
      last = s.dist;
      n++;
      for (const side of [-1, 1]) {
        const p = track.surf(s, side * (HW + 1.6), 0, new THREE.Vector3());
        buoyList.push({ x: p.x, z: p.z, ph: R(0, 6.3), color: (n + (side > 0 ? 1 : 0)) % 2 ? '#ff4a1c' : '#f6f6f6', s: 1 });
      }
    }
  }
  for (const ap of track.racingLine.apexes) {
    const s = track.samples[ap.i];
    if (!s.water) continue;
    const p = track.surf(s, ap.side * (HW + 3.5), 0, new THREE.Vector3());
    buoyList.push({ x: p.x, z: p.z, ph: R(0, 6.3), color: '#ffd21f', s: 2.3 });
  }
  const buoyIm = instanced(buoyGeometry(), vcMat, buoyList.map((b) => ({ x: b.x, y: 0, z: b.z, s: b.s, color: b.color })), { name: 'buoys' });
  if (buoyIm) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let clock = 0;
    animators.push((t, dt, car) => {
      // 물 구간 밖이면 0.3초마다만 갱신 (멀리서는 안 보임)
      clock -= dt;
      if (car && car.trackInfo && !car.trackInfo.sample.water && clock > 0) return;
      clock = 0.3;
      buoyList.forEach((b, i) => {
        q.setFromEuler(e.set(Math.sin(t * 1.1 + b.ph) * 0.1, 0, Math.cos(t * 0.9 + b.ph) * 0.1));
        buoyIm.setMatrixAt(i, m4.compose(p.set(b.x, Math.sin(t * 1.6 + b.ph) * 0.15, b.z), q, sc.setScalar(b.s)));
      });
      buoyIm.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- 바다 동굴 (물길 위 바위 아치, 안쪽에 빛나는 수정)
  const glowSpots = [];
  for (const cave of track.caves) {
    const list = cave.list;
    const half = cave.half, H = cave.height;
    const pos = [], col = [], idx = [];
    const RING = 22;
    const cA = new THREE.Color('#7a6a60'), cB = new THREE.Color('#4a3f3c'), cMoss = new THREE.Color('#3f6b4a');
    const ext = 16;
    const rows = [];
    for (let k = -ext; k < list.length + ext; k++) {
      const s = list[THREE.MathUtils.clamp(k, 0, list.length - 1)];
      const off = k < 0 ? k : k >= list.length ? k - list.length + 1 : 0;
      rows.push({ s, c: s.pos.clone().addScaledVector(s.tan, off * 1.87), flare: Math.abs(off) / ext });
    }
    rows.forEach(({ s, c, flare }, r) => {
      for (let j = 0; j <= RING; j++) {
        const a = Math.PI * (j / RING);
        const n = track.noise(c.x / 6 + j * 0.37, c.z / 6 - j * 0.21, 2);
        const rx = half + 3 + flare * 12 + n * 2.5, ry = H + flare * 6 + n * 3;
        const lx = Math.cos(a) * rx, ly = Math.sin(a) * ry - 3;
        const v = c.clone().addScaledVector(s.right, lx).addScaledVector(UPV, ly);
        pos.push(v.x, v.y, v.z);
        const cc = cA.clone().lerp(cB, 0.5 + n * 0.5);
        if (ly < 1.5) cc.lerp(cMoss, 0.5);
        col.push(cc.r, cc.g, cc.b);
        if (r < rows.length - 1 && j < RING) {
          const A0 = r * (RING + 1) + j;
          idx.push(A0, A0 + RING + 1, A0 + 1, A0 + 1, A0 + RING + 1, A0 + RING + 2);
        }
        if (flare === 0 && r % 4 === 0 && j % 3 === 1 && ly > 1.5) glowSpots.push(v.clone().lerp(c.clone().setY(H * 0.4), 0.05));
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const caveMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    caveMesh.castShadow = true;
    caveMesh.receiveShadow = true;
    group.add(caveMesh);
    for (let k = 0; k < 9; k++) {
      const s = list[Math.floor(R(0, list.length))];
      const p = track.surf(s, R(-1, 1) * (half + 6), 0, new THREE.Vector3());
      rocks.push({ x: p.x, y: H - 1 + R(0, 6), z: p.z, s: 1, sx: R(7, 13), sy: R(5, 9), sz: R(7, 13), ry: R(0, 6), color: pick(['#7a6a60', '#5c4f49']) });
    }
    const tex = canvasTexture(512, 128, (g, w, h) => {
      g.fillStyle = 'rgba(20,30,50,0.85)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#5ff0ff';
      g.lineWidth = 6;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#bff8ff';
      g.font = '900 60px "Malgun Gothic", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(cave.name || '푸른 동굴', w / 2, h / 2 + 4);
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    const s0 = list[0];
    plate.position.copy(s0.pos).addScaledVector(s0.tan, -1).setY(H - 4.2);
    plate.rotation.y = yawOf(s0) + Math.PI;
    group.add(plate);
    for (const u of [0.3, 0.7]) {
      const s = list[Math.floor(u * (list.length - 1))];
      const L = new THREE.PointLight('#62e6ff', 40, 50, 1.5);
      L.position.copy(s.pos).setY(6);
      group.add(L);
    }
  }
  if (glowSpots.length) {
    const im = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.6, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), glowSpots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    glowSpots.forEach((p, i) => {
      im.setMatrixAt(i, m4.compose(p, q.setFromEuler(new THREE.Euler(R(0, 3), R(0, 3), 0)), new THREE.Vector3(1, R(1.2, 2.4), 1).multiplyScalar(R(0.5, 1.3))));
      im.setColorAt(i, new THREE.Color(pick(['#7ff6ff', '#9a8cff', '#5affc8'])));
    });
    group.add(im);
  }

  // ---------------------------------------------------------------- 파도 점프대 거품, 소용돌이
  {
    const foamTex = canvasTexture(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 220; i++) {
        g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.5})`;
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 7, 0, Math.PI * 2);
        g.fill();
      }
    });
    foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
    for (const wv of track.waves) {
      const crest = new THREE.Mesh(new THREE.PlaneGeometry(wv.w + 2, 3), new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      crest.position.set(0, wv.h + 0.12, -1.2);
      crest.rotation.x = -Math.PI / 2 + 0.35;
      wv.mesh.add(crest);
      // 옆으로 비킨 파도는 바깥쪽에만 깃발 (물길 가운데에 깃대가 서 있지 않게)
      for (const side of wv.offset ? [Math.sign(wv.offset)] : [-1, 1]) {
        const p = track.surf(wv.s, wv.offset + side * (wv.w / 2 + 1.2), 0, new THREE.Vector3()).addScaledVector(wv.s.tan, -wv.len);
        const flag = A.flagPole({ color: '#ff7a3c' });
        flag.obj.scale.setScalar(0.5);
        add(flag.obj, p.x, -0.4, p.z, 0);
        anim(flag);
      }
      animators.push((t) => crest.material.map.offset.set(t * 0.3, t * 0.5));
    }
    // 선착장 물가 거품 띠: 도로가 물속으로 들어가는 선이 칼로 자른 듯 보였음 → 하얀 거품이 찰랑임
    //   (점무늬 거품은 비스듬히 보면 회색 자갈처럼 보여서, 가운데가 진하고 물결 모양 가장자리인 부드러운 띠로)
    const slipFoam = canvasTexture(512, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let x = 0; x < w; x++) {
        const edge = 6 * Math.sin(x * 0.09) + 4 * Math.sin(x * 0.23 + 1.3);
        for (let y = 0; y < h; y++) {
          const d = Math.abs(y - h / 2 - edge * 0.5) / (h / 2);
          const a = Math.max(0, 1 - d * d * 1.6) * (0.75 + 0.25 * Math.sin(x * 0.5 + y * 0.3));
          g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          g.fillRect(x, y, 1, 1);
        }
      }
    });
    slipFoam.repeat.set(2, 1);
    const slipFoamMat = new THREE.MeshBasicMaterial({ map: slipFoam, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const N = track.samples.length;
    for (const sw of track.slipways || []) {
      const L = sw.land, Wt = track.samples[(L.i + sw.dir + N) % N];
      const ly = L.pos.y, f = ly > 0 ? Math.min(1, ly / (ly + 0.14)) : 0;
      const p = L.pos.clone().lerp(Wt.pos.clone().setY(-0.14), f);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(W + 6, 2.4).rotateX(-Math.PI / 2), slipFoamMat);
      band.position.set(p.x, 0.07, p.z);
      band.rotation.y = Math.atan2(L.tan.x, L.tan.z);
      band.renderOrder = 1;
      group.add(band);
    }
    animators.push((t) => slipFoam.offset.set(t * 0.04, Math.sin(t * 1.6) * 0.08));
    const spiral = canvasTexture(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.translate(w / 2, h / 2);
      for (let k = 0; k < 5; k++) {
        g.rotate((Math.PI * 2) / 5);
        g.beginPath();
        for (let a = 0; a < 9; a += 0.05) g.lineTo(Math.cos(a) * (6 + a * 13), Math.sin(a) * (6 + a * 13));
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = 7;
        g.stroke();
      }
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30);
      gr.addColorStop(0, 'rgba(0,30,60,0.85)');
      gr.addColorStop(1, 'rgba(0,30,60,0)');
      g.fillStyle = gr;
      g.fillRect(-40, -40, 80, 80);
    });
    for (const p of track.whirlpools || []) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(p.r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: spiral, transparent: true, depthWrite: false }));
      m.position.set(p.x, 0.06, p.z);
      group.add(m);
      animators.push((t) => (m.rotation.y = t * 1.6));
    }
  }

  // ---------------------------------------------------------------- 바다의 바위섬 (물길·도로에서 떨어진 곳)
  for (let k = 0; k < 500; k++) {
    const x = R(-900, 1000), z = R(-900, 60);
    const y = groundY(x, z);
    if (y === null || y > -1 || !roadClear(x, z, 14, 10) || !free(x, z, 10)) continue;
    const big = rand() < 0.25;
    const s = big ? R(6, 16) : R(2, 5);
    const col = pick(['#8f8578', '#7d7468', '#9a8d7c']);
    rock(x, z, s, col, -1.5 - s * 0.1, false);
    if (big && rand() < 0.5) rock(x + R(-s, s), z + R(-s, s), s * 0.5, col, -1, false);
    occupy(x, z, s + 4);
  }
  for (const [a, b] of track.waterRuns) {
    const list = track.spanList(a, b);
    for (let k = 0; k < list.length; k += 9) {
      if (rand() < 0.55) continue;
      const s = list[k];
      const p = track.surf(s, (rand() < 0.5 ? -1 : 1) * (HW + R(8, 16)), 0, new THREE.Vector3());
      if (!free(p.x, p.z, 2) || track.nearestRaw(p) < HW + 6) continue;
      rock(p.x, p.z, R(0.8, 2.2), '#857a6e', -0.6, false);
    }
  }

  // ---------------------------------------------------------------- 큰 배: 화물선(항구), 크루즈선·범선(먼바다, 천천히 움직임)
  {
    const shipMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const cargo = mergeGeometries([
      colored(new THREE.BoxGeometry(14, 6, 70), '#c8402e', M(0, 1, 0)),
      colored(new THREE.BoxGeometry(14.2, 1.2, 70.2), '#1d2433', M(0, -1.5, 0)),
      colored(new THREE.BoxGeometry(12, 7, 9), '#f4f4f4', M(0, 7.5, -27)),
      colored(new THREE.BoxGeometry(2, 5, 2), '#e8463a', M(0, 12.5, -29)),
      ...[0, 1, 2, 3, 4].flatMap((k) => [colored(new THREE.BoxGeometry(12, 2.6, 8), pick(['#2e6fd8', '#ffcf3f', '#19b3a6', '#e8463a', '#7a3cff']), M(0, 5.3, -14 + k * 9)), colored(new THREE.BoxGeometry(12, 2.6, 8), pick(['#2e6fd8', '#ffcf3f', '#ff8a1f']), M(0, 7.9, -14 + k * 9))]),
    ]);
    const cruise = mergeGeometries([
      colored(new THREE.BoxGeometry(22, 8, 120), '#ffffff', M(0, 2, 0)),
      colored(new THREE.BoxGeometry(22.2, 2, 120.2), '#1d3f6e', M(0, -2, 0)),
      colored(new THREE.BoxGeometry(18, 6, 92), '#f4f6fa', M(0, 9, -6)),
      colored(new THREE.BoxGeometry(14, 5, 60), '#ffffff', M(0, 14.5, -10)),
      colored(new THREE.BoxGeometry(18.2, 1, 92.2), '#5fb6ff', M(0, 8, -6)),
      colored(new THREE.CylinderGeometry(3, 3.6, 8, 10), '#e8463a', M(0, 20, -24)),
    ]);
    const tall = mergeGeometries([
      colored(new THREE.CylinderGeometry(3, 4.2, 30, 10).rotateX(Math.PI / 2).scale(1, 0.6, 1), '#6b4528', M(0, 1, 0)),
      ...[-8, 2, 11].flatMap((z) => [colored(new THREE.CylinderGeometry(0.3, 0.4, 26, 6), '#4a3220', M(0, 15, z)), colored(new THREE.BoxGeometry(14, 6, 0.2), '#fff4e2', M(0, 12, z + 0.6)), colored(new THREE.BoxGeometry(11, 5, 0.2), '#fff4e2', M(0, 19, z + 0.6))]),
    ]);
    const addShip = (geo, x, z, ry, speed = 0) => {
      const m = new THREE.Mesh(geo, shipMat);
      m.position.set(x, 0, z);
      m.rotation.y = ry;
      m.castShadow = true;
      group.add(m);
      const ph = R(0, 6);
      animators.push((t, dt) => {
        if (speed && dt > 0) {
          m.position.x += Math.sin(m.rotation.y) * speed * dt;
          m.position.z += Math.cos(m.rotation.y) * speed * dt;
        }
        m.position.y = Math.sin(t * 0.6 + ph) * 0.25;
        m.rotation.z = Math.sin(t * 0.5 + ph) * 0.015;
      });
    };
    for (const sh of ships) addShip(cargo, sh.x, sh.z, sh.ry);
    for (const [x, z, ry, sp, kind] of P.ships || [[-250, -820, 1.2, 3, 'cruise'], [520, -900, -1.9, 2, 'cruise'], [-620, -560, 0.4, 4, 'tall'], [900, -380, 2.6, 3, 'tall'], [60, -700, 1.6, 2.5, 'cargo']]) {
      const gy = groundY(x, z);
      if (gy !== null && gy > -4) continue;
      addShip(kind === 'cruise' ? cruise : kind === 'tall' ? tall : cargo, x, z, ry, sp);
    }
  }

  // ---------------------------------------------------------------- 요트·어선 (항구) + 바다를 떠다니는 돛단배
  {
    const sailing = [];
    for (let k = 0; k < 60 && sailing.length < 26; k++) {
      const x = R(-800, 900), z = R(-850, -80);
      const y = groundY(x, z);
      if (y === null || y > -3 || !roadClear(x, z, 30, 10) || !free(x, z, 12)) continue;
      sailing.push({ x, y: 0, z, ry: R(0, 6.3), s: R(1, 1.5), ph: R(0, 6.3), drift: R(0.6, 1.6) });
      occupy(x, z, 12);
    }
    boatSets.push({ list: sailing, geo: yachtGeometry(true), sail: true });
    for (const set of boatSets) {
      if (!set.list.length) continue;
      const im = instanced(set.geo, vcMat, set.list, { name: 'boats' });
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      animators.push((t, dt) => {
        set.list.forEach((b, i) => {
          if (set.sail && dt > 0) {
            b.x += Math.sin(b.ry) * b.drift * dt;
            b.z += Math.cos(b.ry) * b.drift * dt;
          }
          q.setFromEuler(e.set(Math.cos(t * 1.1 + b.ph) * 0.03, b.ry, Math.sin(t * 0.9 + b.ph) * (set.sail ? 0.1 : 0.05)));
          im.setMatrixAt(i, m4.compose(p.set(b.x, Math.sin(t * 1.3 + b.ph) * 0.12, b.z), q, sc.setScalar(b.s)));
        });
        im.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // ---------------------------------------------------------------- 돌고래 (물길 옆에서 뛰어오름)
  {
    const list = [];
    for (const [a, b] of track.waterRuns) {
      const L = track.spanList(a, b);
      for (let k = 30; k < L.length - 30; k += 55) {
        const s = L[k];
        const side = k % 2 ? 1 : -1;
        for (let j = 0; j < 3; j++) {
          const p = track.surf(s, side * (HW + R(14, 30)), 0, new THREE.Vector3()).addScaledVector(s.tan, R(-8, 8));
          list.push({ x: p.x, z: p.z, dir: yawOf(s) + R(-0.4, 0.4), ph: R(0, 10) + j * 0.35, per: R(5, 8) });
        }
      }
    }
    if (list.length) {
      const im = new THREE.InstancedMesh(dolphinGeometry(), vcMat, list.length);
      im.castShadow = true;
      im.frustumCulled = false;
      group.add(im);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
      animators.push((t) => {
        list.forEach((d, i) => {
          const u = ((t + d.ph) % d.per) / d.per;
          const j = u < 0.25 ? u / 0.25 : -1;
          const fx = Math.sin(d.dir), fz = Math.cos(d.dir);
          const along = (j < 0 ? 0 : j - 0.5) * 9;
          const y = j < 0 ? -3 : Math.sin(Math.PI * j) * 3.2 - 0.6;
          const pitch = j < 0 ? 0 : -Math.cos(Math.PI * j) * 0.9;
          q.setFromEuler(e.set(pitch, d.dir, 0, 'YXZ'));
          im.setMatrixAt(i, m4.compose(p.set(d.x + fx * along, y, d.z + fz * along), q, sc));
        });
        im.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // ---------------------------------------------------------------- 갈매기 (무리 지어 빙빙)
  {
    const flocks = [];
    for (let k = 0; k < 10; k++) {
      const s = track.samples[Math.floor(R(0, track.sampleCount))];
      const c = s.pos.clone().add(new THREE.Vector3(R(-80, 80), R(22, 45), R(-80, 80)));
      const dirn = k % 2 ? 1 : -1;
      for (let j = 0; j < 7; j++) flocks.push({ c, r: R(18, 40), sp: R(0.25, 0.45) * dirn, ph: R(0, 6.3), h: R(-4, 4) });
    }
    const im = new THREE.InstancedMesh(gullGeometry(), new THREE.MeshLambertMaterial({ color: '#f8f4ee', side: THREE.DoubleSide }), flocks.length);
    im.frustumCulled = false;
    group.add(im);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    animators.push((t) => {
      flocks.forEach((g, i) => {
        const a = g.ph + t * g.sp;
        const flap = 0.6 + Math.sin(t * 7 + g.ph * 3) * 0.4;
        // 원을 따라 날아가는 방향을 바라봄
        q.setFromEuler(e.set(0, a + (g.sp > 0 ? Math.PI : 0), g.sp > 0 ? -0.3 : 0.3, 'YXZ'));
        im.setMatrixAt(i, m4.compose(p.set(g.c.x + Math.cos(a) * g.r, g.c.y + g.h + Math.sin(t * 0.7 + g.ph) * 2, g.c.z - Math.sin(a) * g.r), q, sc.set(1.2, flap * 1.2, 1.2)));
      });
      im.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- 아치 배너, 안내판, 코너 화살표판, 타이어 벽
  function arch(p, text, color) {
    const s = sAt(p);
    const width = s.bridge ? W + 2 * CURB + 2 : s.water ? W + 22 : W + 2 * CURB + 8; // 물 위는 배가 넓게 다니니 기둥을 멀리
    const a = A.archBanner({ width, text, color });
    add(a.obj, s.pos.x, s.pos.y, s.pos.z, yawOf(s));
    anim(a);
    for (const side of [-1, 1]) {
      const q = track.surf(s, side * (width / 2 + 1.5), 0, new THREE.Vector3());
      circle(q.x, q.z, 1.1, q.y - 1, q.y + 10);
      occupy(q.x, q.z, 3);
    }
  }
  for (const [p, text, color] of P.arches || [[3.9, 'HARBOR TOWN', '#ff7a3c'], [12.2, 'CLIFF ROAD', '#2e6fd8'], [32.4, 'BOAT ZONE', '#19b3a6'], [34.5, 'SPLASH!', '#2ec4ff'], [44.4, 'SUNSET BEACH', '#ff5fa2']]) arch(p, text, color);
  function sign(p, l, title, sub, bg, accent = '#ffd21f', width = 12) {
    const { p: q, s } = beside(tAt(p), l);
    const y = landY(q.x, q.z, 0.3);
    if (y === null || !roadClear(q.x, q.z, 1, 3) || !free(q.x, q.z, width / 2)) return;
    const b = A.signBoard({ title, sub, bg, accent, width });
    add(b.obj, q.x, y, q.z, Math.atan2(-s.tan.x, -s.tan.z));
    for (const u of [-width * 0.35, width * 0.35]) circle(q.x + s.right.x * u, q.z + s.right.z * u, 0.5, y, y + 8);
    occupy(q.x, q.z, width / 2);
  }
  for (const a of P.signs || [[18.6, -24, 'LIGHTHOUSE', '등대섬까지 1.2 km', '#1d3f6e'], [31.6, 26, 'BOAT ZONE', '물 위에서는 배로 변신!', '#0f6a7a', '#7ff6ff'], [10.5, -26, 'SUNSET COAST', '노을 해안 서킷', '#3b2b74', '#ff9a4a']]) sign(...a);
  {
    const N = track.sampleCount;
    const head = track.samples.map((s) => Math.atan2(s.tan.x, s.tan.z));
    const ds = track.length / N;
    let lastI = -999;
    const tw = A.tireWallGeometry();
    const tires = [];
    for (let i = 0; i < N; i += 3) {
      let d = head[(i + 8) % N] - head[(i - 8 + N) % N];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const Rr = Math.abs((16 * ds) / (d || 1e-6));
      const s = track.samples[i];
      if (Rr > 45 || s.water || s.bridge) continue;
      const outSide = d > 0 ? 1 : -1;
      const rail = track.railLimit({ lateral: outSide, index: i, sample: s });
      if (rail == null) {
        // (연석 끝에서 9 m: 미끄러진 차가 갇히지 않게 넉넉히)
        const p = track.surf(s, outSide * (HW + track.kerbAt(i, outSide) + 9), 0, new THREE.Vector3());
        const y = landY(p.x, p.z, 0.3);
        if (y !== null && roadClear(p.x, p.z, 0.5, 3.5)) {
          for (const u of [-0.6, 0, 0.6]) tires.push({ x: p.x + s.tan.x * u * 1.6, y, z: p.z + s.tan.z * u * 1.6, s: 1, ry: 0 });
          circle(p.x, p.z, 1.2, y, y + 1.2);
        }
      }
      if (i - lastI < 14) continue;
      // 화살표판은 부딪히지 않음 (예전엔 연석 2 m 밖 단단한 기둥이라 미끄러져 나간 봇이 걸려 멈췄음)
      const lat = outSide * (rail != null ? rail + 1.2 : HW + track.kerbAt(i, outSide) + 4);
      const p = track.surf(s, lat, 0, new THREE.Vector3());
      const y = landY(p.x, p.z, 0.3) ?? (rail != null ? p.y : null);
      if (y === null) continue;
      const cb = A.chevronBoard({ dir: -outSide });
      add(cb.obj, p.x, y, p.z, Math.atan2(-s.tan.x, -s.tan.z));
      lastI = i;
    }
    if (tires.length) instanced(tw.geo, tw.mat, tires, { name: 'tires' });
  }

  // ---------------------------------------------------------------- 남은 땅 채우기 (도로 둘레 400 m: 나무·덤불·바위)
  {
    let n = 0;
    for (let k = 0; k < 9000 && n < 1500; k++) {
      const s = track.samples[Math.floor(R(0, track.sampleCount))];
      if (s.water) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const p = track.surf(s, side * (HW + CURB + R(10, 380)), 0, new THREE.Vector3());
      const x = p.x + R(-15, 15), z = p.z + R(-15, 15);
      const y = groundY(x, z);
      if (y === null || y < 0.5 || !free(x, z, 1.5) || !roadClear(x, z, 1, 5)) continue;
      const f = track.coastField(x, z);
      const r = rand();
      if (f < 45 && y < 3) r < 0.6 ? palm(x, z) : bush(x, z);
      else if (y > 14) r < 0.45 ? pine(x, z) : r < 0.7 ? tree(x, z) : r < 0.88 ? bush(x, z) : rock(x, z, R(0.8, 2.4), '#a8917a');
      else r < 0.25 ? palm(x, z) : r < 0.55 ? tree(x, z) : r < 0.85 ? bush(x, z) : pine(x, z);
      occupy(x, z, 1.5);
      n++;
    }
  }

  // ---------------------------------------------------------------- 움직이는 것들 (seaLife.js): 항구 모터보트, 수상비행기, 결승선 등불·불꽃놀이, 물보라
  buildSeaLife(track, group, animators, rand);

  // ---------------------------------------------------------------- 인스턴스 만들기
  instanced(palmGeometry(), vcMat, palms, { name: 'palms' });
  instanced(pineGeometry(), vcMat, pines, { name: 'pines' });
  instanced(cypressGeometry(), vcMat, cypress, { name: 'trees' });
  instanced(bushGeometry(), vcMat, bushes, { shadow: false, name: 'bushes' });
  instanced(rockGeometry(11), new THREE.MeshLambertMaterial({ flatShading: true }), rocks, { name: 'rocks' });
  instanced(houseGeo, new THREE.MeshLambertMaterial({ map: winTex }), houses, { name: 'houses' });
  instanced(new THREE.ConeGeometry(0.75, 1, 4).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), roofs, { name: 'roofs' });
  instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#f4f1ea' }), flatRoofs, { name: 'flatRoofs' });
  instanced(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({}), domes, { name: 'domes' });
  {
    const um = mergeGeometries([colored(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), '#eeeeee', M(0, 1.2, 0)), colored(new THREE.ConeGeometry(1.5, 0.6, 10, 1, true), '#ffffff', M(0, 2.3, 0))]);
    instanced(um, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), umbrellas, { name: 'umbrellas' });
    instanced(new THREE.BoxGeometry(1, 0.04, 1.9), new THREE.MeshLambertMaterial({}), towels, { shadow: false, name: 'towels' });
  }

  // ---------------------------------------------------------------- 차와 충돌
  function collideCar(car) {
    stamp++;
    const cx0 = Math.floor((car.pos.x - CAR_R) / CELL), cx1 = Math.floor((car.pos.x + CAR_R) / CELL);
    const cz0 = Math.floor((car.pos.z - CAR_R) / CELL), cz1 = Math.floor((car.pos.z + CAR_R) / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = grid.get(`${cx},${cz}`);
        if (!list) continue;
        for (const c of list) {
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (car.pos.y > c.y1 || car.pos.y < c.y0 - 1.5) continue;
          const dx = car.pos.x - c.x, dz = car.pos.z - c.z;
          const d = Math.hypot(dx, dz), min = c.r + CAR_R;
          if (d < min && d > 1e-4) car.applyPush(tmpV.set(dx / d, 0, dz / d), min - d);
        }
      }
  }

  group.updateMatrixWorld(true);
  return {
    colliders: allColliders,
    collideCar,
    addCollider: circle,
    collidersNear(x, z, r = 4) {
      return allColliders.filter((c) => Math.hypot(c.x - x, c.z - z) < r + c.r);
    },
    animate(time, dt, car) {
      for (const a of animators) a(time, dt, car);
    },
  };
}
