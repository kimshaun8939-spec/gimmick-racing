// 정글 유적: 용암 지하 세계 (차원 여행 기믹) — gpSpace.js(우주 차원)와 같은 방식
//
//   포털 A(사원 안) ~ 포털 B(폭포 절벽) 사이 도로(track.dimension t0~t1)는 지하 세계.
//   같은 도로가 이어지는 것이고(순간이동 아님) 세계별 물체를 보이기/숨기기만 함 (충돌은 그대로).
//   - 지하 하늘(검붉은 하늘 + 불씨), 용암 바다, 현무암 기둥, 흑요석 첨탑, 용암 폭포, 불 기둥(간헐천),
//     떠 있는 현무암 덩어리, 나선 가운데 용암 분수, 포털 뒤/앞 용암 동굴 터널, 안내판
//   - 포털 2개 (두 세계 모두에서 보임): 돌 고리 + 빛나는 룬 + 소용돌이 원판
//   - 세계 전환: 카메라가 포털 면을 지나는 순간 바뀜. 배경·안개·빛을 짧게 섞고, 화면 번쩍임·글자·소리
// buildUnderworld(track, scene, { jungleObjects, jungleEnv })가 { update(t, dt, car), portals, inUnder, force } 를 돌려줌
import * as THREE from 'three';
import { seededRandom, canvasTexture, glowTexture, TAU } from './jungleUtil.js';

const NOISE_GLSL = /* glsl */ `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

/** 포털 소용돌이 원판: mode 0 = 정글 쪽에서 볼 때(용암빛), 1 = 지하에서 볼 때(초록 정글빛) */
function portalDiskMaterial(cutY, radius) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMode: { value: 0 }, uCut: { value: cutY }, uR: { value: radius } },
    vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uMode, uCut, uR; varying vec2 vP;
      ${NOISE_GLSL}
      void main() {
        if (vP.y < uCut) discard;
        float r = length(vP) / uR;
        float a = atan(vP.y, vP.x);
        float sw = a + r * 4.0 - uTime * 1.3;
        float n = fbm3(vec3(cos(sw) * 2.0 * r, sin(sw) * 2.0 * r, r * 3.0 - uTime * 0.35));
        float n2 = fbm3(vec3(cos(sw * 2.0) * 3.0 * r, sin(sw * 2.0) * 3.0 * r, uTime * 0.25 + 5.0));
        vec3 col;
        if (uMode < 0.5) {
          col = mix(vec3(0.15, 0.02, 0.0), vec3(0.95, 0.28, 0.02), smoothstep(0.3, 0.75, n));
          col = mix(col, vec3(1.0, 0.85, 0.3), smoothstep(0.55, 0.85, n2) * 0.8);
        } else {
          col = mix(vec3(0.05, 0.25, 0.08), vec3(0.45, 0.9, 0.45), smoothstep(0.3, 0.75, n));
          col = mix(col, vec3(1.0, 0.95, 0.6), smoothstep(0.6, 0.85, n2) * 0.7);
        }
        col += vec3(1.0, 0.95, 0.85) * pow(1.0 - r, 3.0) * 0.9;
        float edge = smoothstep(1.0, 0.86, r);
        gl_FragColor = vec4(col, edge * (0.82 + 0.18 * n));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/** 사원 돌 포털: 이끼 낀 돌 고리 + 빛나는 룬 + 소용돌이 */
export function stonePortal({ radius = 15, rune = '#ffb347' } = {}) {
  const obj = new THREE.Group();
  const R = radius;
  const hc = R * 0.5;
  const a0 = Math.asin(hc / R);
  const arc = Math.PI + 2 * a0;
  const ring = new THREE.Group();
  ring.position.y = hc;
  obj.add(ring);
  const stone = new THREE.MeshStandardMaterial({ color: '#8c8670', roughness: 0.95, flatShading: true });
  const moss = new THREE.MeshStandardMaterial({ color: '#4f7a34', roughness: 1, flatShading: true });
  const runeMat = new THREE.MeshBasicMaterial({ color: rune, fog: false });
  // 돌 블록 고리 (쐐기돌 여러 개)
  const NB = 26;
  const blockGeo = new THREE.BoxGeometry(3.4, 4.2, 4.6);
  const blocks = new THREE.InstancedMesh(blockGeo, stone, NB);
  const runes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1.6, 4.8), runeMat, NB);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < NB; i++) {
    const a = -a0 + (i / (NB - 1)) * arc;
    q.setFromAxisAngle(zAxis, a);
    m4.compose(new THREE.Vector3(Math.cos(a) * (R + 1.6), Math.sin(a) * (R + 1.6), 0), q, new THREE.Vector3(1, 1 + (i % 3) * 0.08, 1));
    blocks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(Math.cos(a) * (R - 0.2), Math.sin(a) * (R - 0.2), 0), q, new THREE.Vector3(1, 1, 1));
    runes.setMatrixAt(i, m4);
  }
  blocks.castShadow = true;
  ring.add(blocks, runes);
  // 꼭대기 쐐기돌 장식 (해 얼굴)
  const key = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1.4, 12), stone);
  key.rotation.x = Math.PI / 2;
  key.position.set(0, R + 3.2, 0);
  ring.add(key);
  const keyGlow = new THREE.Mesh(new THREE.CircleGeometry(1.8, 12), runeMat);
  keyGlow.position.set(0, R + 3.2, 0.75);
  ring.add(keyGlow);
  // 이끼 덩어리
  for (let i = 0; i < 9; i++) {
    const a = -a0 + Math.random() * arc;
    const mm = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 + Math.random(), 0), moss);
    mm.position.set(Math.cos(a) * (R + 3.4), Math.sin(a) * (R + 3.4), (Math.random() - 0.5) * 3);
    ring.add(mm);
  }
  const footX = Math.cos(a0) * R;
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), stone);
    foot.position.set(sx * (footX + 1.6), 1.5, 0);
    foot.castShadow = true;
    obj.add(foot);
    const brazier = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.0, 1.2, 8), new THREE.MeshStandardMaterial({ color: '#3a3026', roughness: 0.8 }));
    brazier.position.set(sx * (footX + 1.6), 4.6, 0);
    obj.add(brazier);
  }
  const diskMat = portalDiskMaterial(-hc + 0.05, R - 0.8);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(R - 0.8, 80), diskMat);
  disk.position.y = hc;
  disk.renderOrder = 3;
  obj.add(disk);
  // 불꽃 (화로 2개)
  const flameTex = glowTexture('rgba(255,230,160,1)', 'rgba(255,120,30,0.5)');
  const flames = [];
  for (const sx of [-1, 1]) {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: '#ffa040', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    f.position.set(sx * (footX + 1.6), 6.2, 0);
    f.scale.set(3, 4.2, 1);
    obj.add(f);
    flames.push(f);
  }
  const shine = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: rune, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  shine.position.y = hc;
  shine.scale.setScalar(R * 3.6);
  obj.add(shine);
  return {
    obj,
    diskMat,
    feet: [-(footX + 1.6), footX + 1.6],
    update(t) {
      diskMat.uniforms.uTime.value = t;
      runeMat.color.setHSL(0.08 + 0.02 * Math.sin(t * 2), 1, 0.55 + 0.1 * Math.sin(t * 3));
      shine.material.opacity = 0.3 + 0.12 * Math.sin(t * 2.1);
      flames.forEach((f, i) => f.scale.set(3 + Math.sin(t * 9 + i) * 0.4, 4.2 + Math.sin(t * 7 + i * 2) * 0.7, 1));
    },
  };
}

function lavaTexture() {
  // 용암: 어두운 굳은 껍질 사이로 밝은 용암 (emissiveMap 겸용)
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#ff5a12';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,${180 + Math.random() * 60},${60 + Math.random() * 60},${0.3 + Math.random() * 0.4})`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, 5 + Math.random() * 20, 0, TAU);
      g.fill();
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${40 + Math.random() * 30},${10 + Math.random() * 10},5,${0.55 + Math.random() * 0.4})`;
      g.beginPath();
      const x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) g.lineTo(x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 50);
      g.closePath();
      g.fill();
    }
  });
}

export function buildUnderworld(track, scene, { jungleObjects = [], jungleEnv = null } = {}) {
  const D = track.dimension;
  if (!D) return null;
  const rnd = seededRandom(20261110);
  const R = (a, b) => a + rnd() * (b - a);
  const HW = track.width / 2, DECK = track.deckHalf;
  const world = new THREE.Group();
  world.name = 'underWorld';
  world.userData.world = 'space';
  world.visible = false;
  scene.add(world);
  const sky = new THREE.Group();
  sky.name = 'underSky';
  sky.visible = false;
  scene.add(sky);
  const both = new THREE.Group();
  both.name = 'portals';
  scene.add(both);
  const animators = [];

  // 지하 구간 샘플 (포털 A → B)
  const iA = track.indexAt(D.t0);
  let iB = track.indexAt(D.t1);
  if (iB < iA) iB += track.samples.length - 1;
  const list = track.spanList(iA, iB);
  const d0 = list[0].dist;
  const len = list[list.length - 1].dist - d0;
  const atDist = (m) => list[Math.max(0, Math.min(list.length - 1, Math.round((m / len) * (list.length - 1))))];
  const yawOf = (s) => Math.atan2(s.tan.x, s.tan.z);
  const TUN = D.tunnel || 110;
  // 가까운 지하 도로 찾기 (3D 해시)
  const HS = 30;
  const hash = new Map();
  const hk = (x, y, z) => `${Math.floor(x / HS)},${Math.floor(y / HS)},${Math.floor(z / HS)}`;
  for (let k = 0; k < list.length; k += 2) {
    const p = list[k].pos;
    const key = hk(p.x, p.y, p.z);
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(p);
  }
  function nearRoad(x, y, z, r) {
    const n = Math.ceil(r / HS);
    const cx = Math.floor(x / HS), cy = Math.floor(y / HS), cz = Math.floor(z / HS);
    for (let a = -n; a <= n; a++)
      for (let b = -n; b <= n; b++)
        for (let c = -n; c <= n; c++) {
          const l = hash.get(`${cx + a},${cy + b},${cz + c}`);
          if (l) for (const p of l) if ((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 < r * r) return true;
        }
    return false;
  }
  /** 수평 거리만 (위아래 상관없이) */
  function nearRoadXZ(x, z, r) {
    for (let k = 0; k < list.length; k += 3) {
      const p = list[k].pos;
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true;
    }
    return false;
  }
  const box = new THREE.Box3();
  for (const s of list) box.expandByPoint(s.pos);
  const center = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  const LAVA_Y = minY - 16;

  // ---------------------------------------------------------------- 1) 하늘 (카메라를 따라감): 검붉은 돔 + 불씨
  {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec3 vD;
        ${NOISE_GLSL}
        void main() {
          float h = vD.y;
          vec3 top = vec3(0.07, 0.015, 0.01), mid = vec3(0.35, 0.07, 0.02), hor = vec3(0.95, 0.35, 0.08);
          vec3 col = mix(hor, mid, smoothstep(-0.05, 0.18, h));
          col = mix(col, top, smoothstep(0.18, 0.7, h));
          float n = fbm3(vec3(vD.xz * 3.0 / max(0.25, h + 0.4), uTime * 0.03));
          col += vec3(0.5, 0.12, 0.02) * smoothstep(0.55, 0.8, n) * (1.0 - smoothstep(0.1, 0.8, h)) * 0.6; // 연기 구름 아래쪽이 용암빛
          col *= 0.75 + 0.35 * n;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 40, 20), mat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    sky.add(dome);
    animators.push((t) => (mat.uniforms.uTime.value = t));
  }
  // 불씨 (카메라 주변 상자 안에서 위로 날아오름, 셰이더로 계산)
  const embers = (() => {
    const N = 900, BOX = 160;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) pos.set([R(-BOX, BOX), R(-BOX * 0.3, BOX * 0.6), R(-BOX, BOX)], i * 3), (seed[i] = rnd());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uMap: { value: glowTexture('rgba(255,240,200,1)', 'rgba(255,120,30,0.5)') }, uBox: { value: BOX } },
      vertexShader: /* glsl */ `
        uniform float uTime, uBox; uniform vec3 uCam; attribute float seed; varying float vA;
        void main() {
          vec3 p = position;
          p.y += mod(uTime * (2.0 + seed * 4.0) + seed * 200.0, uBox * 0.9);
          p.x += sin(uTime * 0.7 + seed * 30.0) * 3.0;
          vec3 w = uCam + mod(p - uCam + uBox, 2.0 * uBox) - uBox;
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          vA = 0.5 + 0.5 * sin(uTime * 4.0 + seed * 50.0);
          gl_PointSize = (1.6 + seed * 2.5) * 300.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying float vA;
        void main() { vec4 c = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * c.rgb * 1.6, c.a * vA); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    world.add(pts);
    return mat;
  })();

  // ---------------------------------------------------------------- 2) 용암 바다 (흘러가는 텍스처 + 빛)
  const lavaTex = lavaTexture();
  lavaTex.repeat.set(26, 26);
  const lavaMat = new THREE.MeshStandardMaterial({ map: lavaTex, emissive: '#ffffff', emissiveMap: lavaTex, emissiveIntensity: 0.95, roughness: 0.6, color: '#ffffff' });
  {
    const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) + 1400;
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(center.x, LAVA_Y, center.z);
    world.add(lava);
    animators.push((t) => {
      lavaTex.offset.set(t * 0.004, t * 0.006);
      lavaMat.emissiveIntensity = 0.85 + 0.15 * Math.sin(t * 1.3);
    });
  }
  // 지하 동굴 천장 대신: 멀리 둘러싼 현무암 절벽 (용암 바다 끝을 가림)
  {
    const rockMat = new THREE.MeshStandardMaterial({ color: '#2a1e1a', roughness: 1, flatShading: true, emissive: '#3a0c02', emissiveIntensity: 0.4 });
    const rad = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 380;
    const n = 40;
    const geo = new THREE.ConeGeometry(1, 1, 5);
    const im = new THREE.InstancedMesh(geo, rockMat, n * 2);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * TAU + R(-0.03, 0.03);
      const r = rad + R(0, 160) + (i % 2) * 120;
      const h = R(90, 260), w = R(60, 120);
      m4.compose(new THREE.Vector3(center.x + Math.cos(a) * r, LAVA_Y - 5 + h / 2, center.z + Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(R(-0.1, 0.1), R(0, 6), R(-0.1, 0.1))), new THREE.Vector3(w, h, w));
      im.setMatrixAt(i, m4);
    }
    world.add(im);
  }

  // ---------------------------------------------------------------- 3) 현무암 기둥 (도로 상판 아래, 용암까지)
  {
    const geo = new THREE.CylinderGeometry(2.2, 3.4, 1, 6);
    const mat = new THREE.MeshStandardMaterial({ color: '#3a2e28', roughness: 0.95, flatShading: true, emissive: '#ff3a00', emissiveIntensity: 0.08 });
    const items = [];
    for (let m = TUN + 10; m < len - TUN - 10; m += 34) {
      const s = atDist(m);
      const top = s.pos.y - 1.4;
      // 바로 아래에 다른 도로(나선 아래쪽)가 있으면 기둥을 세우지 않음
      let blocked = false;
      for (let y = top - 4; y > LAVA_Y; y -= 4) if (nearRoad(s.pos.x, y, s.pos.z, HW + 4)) blocked = true;
      if (blocked) continue;
      items.push({ x: s.pos.x, y: (top + LAVA_Y) / 2, z: s.pos.z, h: top - LAVA_Y, ry: yawOf(s) });
    }
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    items.forEach((it, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry);
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(1, it.h, 1));
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true;
    world.add(im);
    // 기둥 아래 용암이 끓는 고리
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffb040', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    const rim = new THREE.InstancedMesh(new THREE.RingGeometry(3.5, 6, 16), ringMat, items.length);
    items.forEach((it, i) => {
      m4.compose(new THREE.Vector3(it.x, LAVA_Y + 0.2, it.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1));
      rim.setMatrixAt(i, m4);
    });
    world.add(rim);
    animators.push((t) => (ringMat.opacity = 0.5 + 0.25 * Math.sin(t * 2.5)));
  }

  // ---------------------------------------------------------------- 4) 용암 동굴 터널 (포털 뒤 / 앞)
  {
    const tunnelMat = new THREE.MeshStandardMaterial({ color: '#3b2c24', roughness: 1, flatShading: true, side: THREE.DoubleSide, emissive: '#2a0800', emissiveIntensity: 0.6 });
    const veinMat = new THREE.MeshBasicMaterial({ color: '#ff7a20', side: THREE.DoubleSide });
    const lampTex = glowTexture('rgba(255,220,160,1)', 'rgba(255,110,20,0.45)');
    const RAD = DECK + 4;
    const tunnelOf = (m0, m1) => {
      const N = 16; // 둘레 꼭짓점 수 (아래 반원은 도로 밑으로)
      const rows = [];
      for (let m = m0; m <= m1; m += 4) rows.push(atDist(m));
      const P = [], idx = [];
      const v = new THREE.Vector3();
      rows.forEach((s, r) => {
        for (let k = 0; k <= N; k++) {
          const a = Math.PI * (-0.08 + 1.16 * (k / N)); // 오른쪽 아래 → 위 → 왼쪽 아래
          const rr = RAD * (1 + 0.12 * Math.sin(k * 2.3 + r * 0.7) + 0.08 * Math.sin(r * 1.9 + k));
          const l = Math.cos(a) * rr, h = Math.sin(a) * rr * 0.8 + 1;
          track.surf(s, l, h, v);
          P.push(v.x, v.y, v.z);
          if (r < rows.length - 1 && k < N) {
            const A = r * (N + 1) + k, B = A + 1, C = A + N + 1, Dd = C + 1;
            idx.push(A, C, B, B, C, Dd);
          }
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      world.add(new THREE.Mesh(geo, tunnelMat));
      // 빛나는 용암 줄기 (벽을 따라)
      for (const side of [-1, 1]) {
        const vp = [], vi = [];
        rows.forEach((s, r) => {
          const off = Math.sin(r * 0.45) * 2.5;
          for (const dh of [-0.25, 0.25]) {
            track.surf(s, side * (RAD - 0.6), 4 + off + dh, v);
            vp.push(v.x, v.y, v.z);
          }
          if (r < rows.length - 1) {
            const A = r * 2;
            vi.push(A, A + 2, A + 1, A + 1, A + 2, A + 3);
          }
        });
        const g2 = new THREE.BufferGeometry();
        g2.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
        g2.setIndex(vi);
        world.add(new THREE.Mesh(g2, veinMat));
      }
      // 횃불 같은 빛 (벽 위쪽)
      for (let r = 2; r < rows.length; r += 6) {
        for (const side of [-1, 1]) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampTex, color: '#ffa040', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
          track.surf(rows[r], side * (RAD - 1.5), 7, sp.position);
          sp.scale.setScalar(5);
          world.add(sp);
        }
      }
    };
    tunnelOf(2, TUN);
    tunnelOf(len - TUN, len - 2);
  }

  // ---------------------------------------------------------------- 5) 흑요석 첨탑, 떠 있는 현무암, 용암 폭포
  const obsMat = new THREE.MeshStandardMaterial({ color: '#1a1420', roughness: 0.25, metalness: 0.6, flatShading: true, emissive: '#2a0a30', emissiveIntensity: 0.4 });
  const glowVein = new THREE.MeshBasicMaterial({ color: '#ff6a1a' });
  function spire(x, z, h, w) {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), obsMat);
    cone.position.y = h / 2;
    cone.castShadow = true;
    g.add(cone);
    for (let k = 0; k < 4; k++) {
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(w * R(0.3, 0.5), h * R(0.35, 0.6), 5), obsMat);
      const a = R(0, TAU);
      c2.position.set(Math.cos(a) * w * 0.8, h * 0.18, Math.sin(a) * w * 0.8);
      c2.rotation.set(R(-0.3, 0.3), 0, R(-0.3, 0.3));
      g.add(c2);
    }
    // 빛나는 금
    const vein = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, h * 0.8, 4), glowVein);
    vein.position.set(w * 0.35, h * 0.4, w * 0.35);
    vein.rotation.z = 0.08;
    g.add(vein);
    g.position.set(x, LAVA_Y - 2, z);
    world.add(g);
    return g;
  }
  // U자 코너(가장 큰 굽이) 안쪽, 나선 가운데: 큰 첨탑
  const turnCenters = [];
  {
    // 굽은 구간의 원 중심을 대충 찾기: 곡률이 큰 샘플들의 중심점
    let acc = null, cnt = 0;
    for (let k = 0; k < list.length; k += 2) {
      const s0 = list[Math.max(0, k - 6)], s1 = list[Math.min(list.length - 1, k + 6)];
      let dh = Math.atan2(s1.tan.x, s1.tan.z) - Math.atan2(s0.tan.x, s0.tan.z);
      while (dh > Math.PI) dh -= TAU;
      while (dh < -Math.PI) dh += TAU;
      const ds = s1.dist - s0.dist;
      const curv = dh / Math.max(1, ds);
      if (Math.abs(curv) > 1 / 120) {
        const r = 1 / Math.abs(curv);
        const s = list[k];
        const c = s.pos.clone().addScaledVector(s.right, curv > 0 ? -r : r); // + = 왼쪽으로 굽음 → 중심은 왼쪽
        if (!acc) (acc = c.clone()), (cnt = 1);
        else if (acc.clone().divideScalar(cnt).distanceTo(c) < 40) acc.add(c), cnt++;
        else {
          if (cnt > 6) turnCenters.push(acc.divideScalar(cnt));
          acc = c.clone();
          cnt = 1;
        }
      }
    }
    if (acc && cnt > 6) turnCenters.push(acc.divideScalar(cnt));
  }
  const fountains = [];
  for (const c of turnCenters) {
    if (nearRoadXZ(c.x, c.z, HW + 14)) continue;
    spire(c.x, c.z, R(70, 95), R(9, 13));
    fountains.push(c);
  }
  // 도로에서 떨어진 곳에 작은 첨탑 여러 개
  for (let i = 0; i < 40; i++) {
    const s = atDist(R(TUN, len - TUN));
    const side = rnd() < 0.5 ? -1 : 1;
    const p = track.surf(s, side * R(DECK + 25, DECK + 140), 0, new THREE.Vector3());
    if (nearRoadXZ(p.x, p.z, DECK + 18)) continue;
    spire(p.x, p.z, R(25, 70), R(4, 9));
  }
  // 떠 있는 현무암 덩어리 (빛나는 금 + 천천히 둥실)
  {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: '#2a201c', roughness: 0.95, flatShading: true, emissive: '#ff4a00', emissiveIntensity: 0.05 });
    const items = [];
    for (let i = 0; i < 160 && items.length < 60; i++) {
      const s = atDist(R(TUN, len - TUN));
      const side = rnd() < 0.5 ? -1 : 1;
      const p = track.surf(s, side * R(DECK + 14, DECK + 120), R(10, 60), new THREE.Vector3());
      if (nearRoad(p.x, p.y, p.z, 26)) continue;
      items.push({ p, s: R(2, 7), ph: R(0, 6), rot: new THREE.Euler(R(0, 6), R(0, 6), R(0, 6)) });
    }
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    world.add(im);
    animators.push((t) => {
      items.forEach((it, i) => {
        v.copy(it.p);
        v.y += Math.sin(t * 0.5 + it.ph) * 2;
        q.setFromEuler(it.rot.set(it.rot.x, it.ph + t * 0.05, it.rot.z));
        m4.compose(v, q, sc.setScalar(it.s));
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
    });
  }
  // 용암 폭포 (먼 절벽에서 떨어지는 빛나는 띠)
  {
    const tex = canvasTexture(64, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, 'rgba(255,90,10,0)');
      grd.addColorStop(0.3, 'rgba(255,140,30,1)');
      grd.addColorStop(0.5, 'rgba(255,230,140,1)');
      grd.addColorStop(0.7, 'rgba(255,140,30,1)');
      grd.addColorStop(1, 'rgba(255,90,10,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = 'rgba(120,30,0,0.4)';
        g.fillRect(Math.random() * w, Math.random() * h, 3, 20 + Math.random() * 40);
      }
    });
    tex.repeat.set(1, 3);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false });
    const glowT = glowTexture('rgba(255,200,120,1)', 'rgba(255,90,20,0.4)');
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + R(-0.2, 0.2);
      const rr = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + R(200, 300);
      const x = center.x + Math.cos(a) * rr, z = center.z + Math.sin(a) * rr;
      const H = R(120, 200), Wd = R(14, 30);
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(Wd, H), mat);
      fall.position.set(x, LAVA_Y + H / 2, z);
      fall.lookAt(center.x, LAVA_Y + H / 2, center.z);
      world.add(fall);
      const splash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: '#ff8a30', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      splash.position.set(x, LAVA_Y + 6, z);
      splash.scale.setScalar(Wd * 3);
      world.add(splash);
    }
    animators.push((t) => (tex.offset.y = -t * 0.35));
  }
  // 나선·U자 가운데 용암 분수 (위로 솟구치는 불덩이)
  {
    const tex = glowTexture('rgba(255,240,190,1)', 'rgba(255,110,20,0.5)');
    const N = 60;
    const blobs = [];
    for (const c of fountains)
      for (let i = 0; i < N; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ff9a40', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        world.add(sp);
        blobs.push({ sp, c, ph: rnd(), a: R(0, TAU), r: R(0, 6), h: R(40, 85), s: R(3, 7) });
      }
    animators.push((t) => {
      for (const b of blobs) {
        const k = (t * 0.32 + b.ph) % 1;
        b.sp.position.set(b.c.x + Math.cos(b.a) * b.r * (1 + k * 3), LAVA_Y + b.h * 4 * k * (1 - k) * 1.1 + 2, b.c.z + Math.sin(b.a) * b.r * (1 + k * 3));
        b.sp.scale.setScalar(b.s * (1 - k * 0.5));
        b.sp.material.opacity = 1 - k * 0.6;
      }
    });
  }
  // 간헐천 불기둥 (긴 직선 양옆, 차례로 솟음)
  {
    const tex = glowTexture('rgba(255,250,210,1)', 'rgba(255,120,20,0.55)');
    const geysers = [];
    const m0 = TUN + 20, m1 = Math.min(len - TUN, TUN + 220);
    for (let m = m0, k = 0; m < m1; m += 38, k++) {
      const s = atDist(m);
      const side = k % 2 ? 1 : -1;
      const base = track.surf(s, side * (DECK + 8), 0, new THREE.Vector3());
      base.y = LAVA_Y;
      // 받침 바위
      const rock = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, s.pos.y - LAVA_Y + 1, 7), obsMat);
      rock.position.set(base.x, (s.pos.y + LAVA_Y) / 2 - 0.5, base.z);
      world.add(rock);
      const parts = [];
      for (let i = 0; i < 14; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffa040', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        world.add(sp);
        parts.push(sp);
      }
      geysers.push({ x: base.x, y: s.pos.y, z: base.z, ph: k * 0.37, parts });
    }
    animators.push((t) => {
      for (const g of geysers) {
        const c = (t * 0.28 + g.ph) % 1;
        const on = c < 0.35 ? Math.sin((c / 0.35) * Math.PI) : 0;
        g.parts.forEach((sp, i) => {
          const u = i / g.parts.length;
          sp.visible = on > 0.02;
          sp.position.set(g.x + Math.sin(t * 9 + i) * 0.6, g.y + 1 + u * 22 * on, g.z + Math.cos(t * 7 + i) * 0.6);
          sp.scale.setScalar((5 - u * 3) * (0.6 + on));
        });
      }
    });
  }
  // 용암 빛 (도로를 아래에서 붉게) — 점 조명은 무거우니 반구 조명 색으로 대신 (아래 env)

  // ---------------------------------------------------------------- 6) 안내판 (돌판 + 빛나는 글자)
  {
    const signs = [
      [TUN + 25, '용암 지하 세계', 'UNDERWORLD · 난간 밖은 용암!', '#ff7a20'],
      [len * 0.55, '불의 나선 ↺', 'SPIRAL OF FIRE · 오르막', '#ffcf40'],
      [len - TUN - 60, '정글 귀환 →', '포털 B · 폭포 절벽', '#7dff9a'],
    ];
    for (const [m, title, sub, col] of signs) {
      const s = atDist(m);
      const tex = canvasTexture(512, 192, (g, w, h) => {
        g.fillStyle = '#231a16';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = col;
        g.lineWidth = 8;
        g.strokeRect(8, 8, w - 16, h - 16);
        g.fillStyle = col;
        g.textAlign = 'center';
        g.font = '900 64px sans-serif';
        g.fillText(title, w / 2, 92);
        g.font = '700 30px sans-serif';
        g.fillStyle = '#ffe6c8';
        g.fillText(sub, w / 2, 150);
      });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 4.5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      const p = track.surf(s, -(DECK + 4), 4.5, new THREE.Vector3());
      board.position.copy(p);
      board.rotation.y = yawOf(s) + Math.PI;
      world.add(board);
      for (const u of [-4.5, 4.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), obsMat);
        post.position.copy(p).addScaledVector(s.right, u * -1);
        post.position.y -= 1.2;
        world.add(post);
      }
    }
  }

  // ---------------------------------------------------------------- 7) 포털 A, B (두 세계 모두에서 보임)
  const portals = [];
  for (const [t, rune] of [[D.t0, '#ffb347'], [D.t1, '#7dffb0']]) {
    const s = track.sampleAt(t);
    const pg = stonePortal({ radius: D.portalRadius || 15, rune });
    track.surf(s, 0, 0, pg.obj.position);
    pg.obj.rotation.y = yawOf(s);
    both.add(pg.obj);
    portals.push({ pg, s, pos: s.pos.clone(), tan: s.tan3.clone().normalize(), feet: pg.feet.map((l) => track.surf(s, l, 0, new THREE.Vector3())) });
  }

  // ---------------------------------------------------------------- 8) 세계 전환
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  const sun = scene.children.find((o) => o.isDirectionalLight);
  const fog = scene.fog;
  const jEnv = jungleEnv || {
    bg: scene.background && scene.background.isColor ? scene.background.clone() : new THREE.Color('#cfe0c0'),
    fog: fog ? fog.color.clone() : new THREE.Color('#cfe0c0'),
    near: fog ? fog.near : 200,
    far: fog ? fog.far : 1100,
    hemiSky: hemi ? hemi.color.clone() : new THREE.Color('#ffffff'),
    hemiGround: hemi ? hemi.groundColor.clone() : new THREE.Color('#446633'),
    hemiI: hemi ? hemi.intensity : 1,
    sunC: sun ? sun.color.clone() : new THREE.Color('#ffffff'),
    sunI: sun ? sun.intensity : 1,
  };
  const uEnv = {
    bg: new THREE.Color(D.background || '#2a0c06'),
    fog: new THREE.Color(D.fog || '#3a1308'),
    near: D.fogNear ?? 60,
    far: D.fogFar ?? 900,
    hemiSky: new THREE.Color(D.hemiSky || '#ff9a5a'),
    hemiGround: new THREE.Color(D.hemiGround || '#3a0a00'),
    hemiI: D.hemiIntensity ?? 0.9,
    sunC: new THREE.Color(D.sunColor || '#ffb070'),
    sunI: D.sunIntensity ?? 1.4,
  };
  let envK = 0;
  function applyEnv(k) {
    const a = jEnv, b = uEnv;
    if (scene.background && scene.background.isColor) scene.background.lerpColors(a.bg, b.bg, k);
    if (fog) {
      fog.color.lerpColors(a.fog, b.fog, k);
      fog.near = THREE.MathUtils.lerp(a.near, b.near, k);
      fog.far = THREE.MathUtils.lerp(a.far, b.far, k);
    }
    if (hemi) {
      hemi.color.lerpColors(a.hemiSky, b.hemiSky, k);
      hemi.groundColor.lerpColors(a.hemiGround, b.hemiGround, k);
      hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, k);
    }
    if (sun) {
      sun.color.lerpColors(a.sunC, b.sunC, k);
      sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, k);
    }
  }
  // 포털 화면 효과 (번쩍임 + 글자)
  const fx = document.createElement('div');
  fx.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;z-index:5;';
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);pointer-events:none;opacity:0;z-index:6;font:800 26px/1.2 sans-serif;letter-spacing:2px;color:#fff;white-space:nowrap;';
  if (document.body) document.body.append(fx, label);
  let flash = 0, labelT = 0;
  // 포털 소리 (우우웅 + 쉬익). N 키로 엔진 소리를 끄면 같이 꺼짐
  let actx = null;
  // 키·터치 모두 소리를 준비해요. 음소거 상태는 공통 믹서 한 곳에서만 기억해요.
  const wakeAudio = () => {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } else if (actx.state === 'suspended') actx.resume().catch(() => {});
  };
  window.addEventListener('keydown', wakeAudio);
  window.addEventListener('pointerdown', wakeAudio, { passive: true });
  function whoosh(down) {
    if (!actx || actx.state !== 'running') return;
    const t0 = actx.currentTime;
    const n = Math.floor(actx.sampleRate * 1.5);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(down ? 1800 : 260, t0);
    bp.frequency.exponentialRampToValueAtTime(down ? 160 : 2200, t0 + 1.2);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    // 낮은 북소리 (둥-)
    const osc = actx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(down ? 110 : 70, t0);
    osc.frequency.exponentialRampToValueAtTime(down ? 38 : 160, t0 + 0.9);
    const og = actx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
    src.connect(bp).connect(g).connect(actx.destination);
    osc.connect(og).connect(actx.destination);
    src.start(t0);
    src.stop(t0 + 1.5);
    osc.start(t0);
    osc.stop(t0 + 1.2);
  }

  let inUnder = false, force = null, jungleList = null;
  const _p = new THREE.Vector3();
  function setWorld(under, announce) {
    inUnder = under;
    track.setWorld(under);
    world.visible = sky.visible = under;
    if (!jungleList) jungleList = [...jungleObjects, ...scene.children.filter((o) => o.userData.world === 'cloud')];
    for (const o of jungleList) o.visible = !under;
    for (const p of portals) p.pg.diskMat.uniforms.uMode.value = under ? 1 : 0;
    if (announce) {
      flash = 1;
      labelT = 2.2;
      label.textContent = under ? '🌋 용암 지하 세계' : '🌴 정글 귀환';
      label.style.textShadow = under ? '0 0 12px #ff5a10,0 0 28px #ffb347' : '0 0 12px #2f8a3a,0 0 28px #9dff7a';
      fx.style.background = under
        ? 'radial-gradient(circle, rgba(255,240,200,0.95) 0%, rgba(255,110,20,0.75) 45%, rgba(40,6,0,0.9) 100%)'
        : 'radial-gradient(circle, rgba(255,255,230,0.95) 0%, rgba(140,230,120,0.7) 50%, rgba(255,255,240,0.85) 100%)';
      whoosh(under);
    }
  }
  /** 지금 지하에 있어야 하나: 포털 근처는 카메라가 포털 면 어느 쪽에 있는지로 */
  function wantUnder(car) {
    if (force !== null) return force;
    const ti = car && car.trackInfo;
    if (!ti) return inUnder;
    const cam = window.game && window.game.camera ? window.game.camera.position : car.pos;
    const L = track.length;
    const near = (t0) => {
      const d = Math.abs(ti.t - t0);
      return Math.min(d, 1 - d) * L < 120;
    };
    if (near(D.t0)) return _p.subVectors(cam, portals[0].pos).dot(portals[0].tan) > 0;
    if (near(D.t1)) return _p.subVectors(cam, portals[1].pos).dot(portals[1].tan) < 0;
    return D.inSpaceT(ti.t);
  }

  return {
    group: world,
    sky,
    portals,
    get inUnder() {
      return inUnder;
    },
    set force(v) {
      force = v;
    },
    get force() {
      return force;
    },
    stats: { length: Math.round(len), turnCenters: turnCenters.length },
    update(t, dt, car) {
      const want = wantUnder(car);
      if (want !== inUnder) setWorld(want, dt > 0 && force === null);
      const target = inUnder ? 1 : 0;
      const blend = D.blend || 0.4;
      envK = dt > 0 ? THREE.MathUtils.clamp(envK + Math.sign(target - envK) * (dt / blend), 0, 1) : target;
      applyEnv(envK);
      if (window.game && window.game.camera) {
        const cp = window.game.camera.position;
        sky.position.copy(cp);
        embers.uniforms.uCam.value.copy(cp);
      }
      embers.uniforms.uTime.value = t;
      for (const p of portals) p.pg.update(t);
      if (inUnder) for (const a of animators) a(t, dt, car);
      flash = Math.max(0, flash - dt * 1.6);
      fx.style.opacity = (flash * flash * 0.85).toFixed(3);
      labelT = Math.max(0, labelT - dt);
      label.style.opacity = Math.min(1, labelT * 1.5).toFixed(3);
    },
  };
}
