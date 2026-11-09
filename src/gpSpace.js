// 구름섬 그랑프리 · 우주 차원
//
//   코스 중간의 포털 A를 지나면 "우주 차원"으로 들어가고, 포털 B를 지나면 구름섬으로 돌아옵니다.
//   - 코스는 하나로 이어진 고리 그대로입니다 (차를 순간 이동시키지 않음). 우주 구간은 구름섬에서 멀리 떨어진 곳에 있고,
//     지금 어느 세계에 있는지에 따라 구름섬 물체 / 우주 물체를 번갈아 보이거나 숨깁니다 (숨겨도 충돌은 그대로)
//   - 포털을 지나는 순간: 하늘(배경), 안개, 빛 색, 하늘 돔이 바뀌고 화면이 살짝 번쩍임
//   - 우주 풍경: 별, 성운, 행성, 블랙홀, 소행성대, 우주 정거장, 위성, 네온 아치, 빛 터널, 작은 행성
// 설정은 data/grandprix.json 의 "dimension" 블록 (색, 행성, 소행성 수 등).
import * as THREE from 'three';
import { canvasTexture, curbTexture, seededRandom } from './track.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- 우주 도로 재질 (gpTrack.js 가 씀)
/** 우주 유리 도로: 어두운 남색 바탕 + 빛나는 육각 격자, 네온 가장자리 선, 가운데 점선 */
function spaceRoadTextures() {
  const draw = (glowOnly) => (g, w, h) => {
    g.fillStyle = glowOnly ? '#000000' : '#161a3a';
    g.fillRect(0, 0, w, h);
    if (!glowOnly) {
      for (let i = 0; i < 1600; i++) {
        const v = 30 + Math.random() * 30;
        g.fillStyle = `rgba(${v},${v + 4},${v + 30},0.35)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    }
    // 육각 격자
    g.strokeStyle = glowOnly ? 'rgba(60,90,200,0.55)' : 'rgba(90,120,255,0.22)';
    g.lineWidth = 1.5;
    const r = 16, hx = r * Math.sqrt(3);
    for (let row = -1; row < h / (r * 1.5) + 1; row++)
      for (let col = -1; col < w / hx + 1; col++) {
        const cx = col * hx + (row % 2 ? hx / 2 : 0), cy = row * r * 1.5;
        g.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * TAU + Math.PI / 6;
          g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        g.stroke();
      }
    g.fillStyle = '#ff4fd8';
    g.fillRect(w * 0.03, 0, w * 0.025, h);
    g.fillRect(w * 0.945, 0, w * 0.025, h);
    g.fillStyle = '#38e8ff';
    g.fillRect(w * 0.49, 0, w * 0.02, h * 0.5);
  };
  return { map: canvasTexture(256, 256, draw(false)), glow: canvasTexture(256, 256, draw(true)) };
}

let _trackMats = null;
/** 우주 구간 도로·연석·상판·난간 재질 */
export function spaceTrackMaterials() {
  if (_trackMats) return _trackMats;
  const road = spaceRoadTextures();
  const curb = curbTexture('#38e8ff', '#1b1f4d');
  const curbGlow = curbTexture('#38e8ff', '#000000');
  const deck = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#1c2050';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(139,92,255,0.6)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
  });
  const panel = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(56,232,255,0)');
    grd.addColorStop(0.5, 'rgba(56,232,255,1)');
    grd.addColorStop(1, 'rgba(56,232,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, h * 0.35, w, h * 0.3);
  });
  _trackMats = {
    road: new THREE.MeshStandardMaterial({ map: road.map, emissive: '#ffffff', emissiveMap: road.glow, emissiveIntensity: 0.75, roughness: 0.3, metalness: 0.35 }),
    curb: new THREE.MeshStandardMaterial({ map: curb, emissive: '#ffffff', emissiveMap: curbGlow, emissiveIntensity: 0.8, roughness: 0.5 }),
    deck: new THREE.MeshStandardMaterial({ map: deck, emissive: '#2a1a70', emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }),
    side: new THREE.MeshStandardMaterial({ color: '#1a1238', emissive: '#6a3cff', emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }),
    under: new THREE.MeshBasicMaterial({ map: panel, color: '#ffffff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    rail: new THREE.MeshStandardMaterial({ color: '#bff6ff', emissive: '#38e8ff', emissiveIntensity: 1.6, roughness: 0.3, side: THREE.DoubleSide }),
    rail2: new THREE.MeshStandardMaterial({ color: '#ffd0f4', emissive: '#ff4fd8', emissiveIntensity: 1.4, roughness: 0.3, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: '#2b2160', emissive: '#8b5cff', emissiveIntensity: 0.8, roughness: 0.4, metalness: 0.5 }),
  };
  return _trackMats;
}

// ---------------------------------------------------------------- 공용 도우미
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

/** 둥근 빛 점 텍스처 (별, 빛무리) */
function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  return canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.25, mid);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}
const glowSprite = (tex, color, size, opacity = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(size);
  return s;
};

/** 표본(샘플) 목록을 따라 단면을 밀어 만든 메시 (gpTrack의 strip과 같은 방식, 장식용) */
function sweep(track, list, profile, mat, { vScale = 8 } = {}) {
  const P = profile.length, rows = list.length;
  const pos = new Float32Array(rows * P * 3), uv = new Float32Array(rows * P * 2), idx = [];
  const v = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const s = list[r];
    let acc = 0;
    for (let k = 0; k < P; k++) {
      if (k) acc += Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]);
      track.surf(s, profile[k][0], profile[k][1], v);
      pos.set([v.x, v.y, v.z], (r * P + k) * 3);
      uv.set([k / (P - 1), (s.dist - list[0].dist) / vScale], (r * P + k) * 2);
      if (r < rows - 1 && k < P - 1) {
        const A = r * P + k, B = A + 1, C = A + P, D = C + 1;
        idx.push(A, B, C, B, D, C);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/** 울퉁불퉁한 바위 모양 (소행성, 작은 행성) */
function rockGeometry(seed, detail = 1, amt = 0.28, palette = ['#7d7486', '#5d566a', '#8f7f72', '#4b4558']) {
  const rnd = seededRandom(seed);
  const geo = new THREE.IcosahedronGeometry(1, detail); // 원래 인덱스 없는 도형
  const p = geo.attributes.position;
  const ph = [rnd() * 9, rnd() * 9, rnd() * 9];
  const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const moved = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = key(x, y, z);
    if (!moved.has(k)) {
      const n = Math.sin(x * 3.1 + ph[0]) * Math.sin(y * 2.7 + ph[1]) * Math.sin(z * 3.3 + ph[2]);
      moved.set(k, 1 + n * amt + (rnd() - 0.5) * amt * 0.6);
    }
    const f = moved.get(k);
    p.setXYZ(i, x * f, y * f * 0.85, z * f);
  }
  const col = [];
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    c.set(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.85 + rnd() * 0.3);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** 행성 표면 텍스처: 줄무늬(가스 행성) 또는 얼룩(암석/얼음) */
function planetTexture(color, seed, banded) {
  const rnd = seededRandom(seed);
  const base = new THREE.Color(color);
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#' + base.getHexString();
    g.fillRect(0, 0, w, h);
    const c = new THREE.Color();
    if (banded) {
      let y = 0;
      while (y < h) {
        const bh = 4 + rnd() * 22;
        c.copy(base).offsetHSL((rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.22);
        g.fillStyle = '#' + c.getHexString();
        g.globalAlpha = 0.75;
        g.fillRect(0, y, w, bh);
        y += bh;
      }
      g.globalAlpha = 0.5;
      g.fillStyle = '#' + base.clone().offsetHSL(-0.03, 0.1, -0.15).getHexString();
      g.beginPath();
      g.ellipse(w * 0.62, h * 0.6, 34, 14, 0, 0, TAU); // 큰 폭풍
      g.fill();
    } else {
      for (let i = 0; i < 90; i++) {
        c.copy(base).offsetHSL((rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.3);
        g.fillStyle = '#' + c.getHexString();
        g.globalAlpha = 0.35 + rnd() * 0.4;
        g.beginPath();
        g.arc(rnd() * w, rnd() * h, 4 + rnd() * 30, 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  });
}

// ---------------------------------------------------------------- 셰이더
const NOISE_GLSL = /* glsl */ `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise3(p); p *= 2.03; a *= 0.5; } return s; }
`;

/** 성운 하늘 (카메라를 따라다니는 큰 공의 안쪽) */
function nebulaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = vec3(0.010, 0.012, 0.040);
        float n1 = fbm3(d * 2.1 + vec3(0.0, 0.0, uTime * 0.003));
        float n2 = fbm3(d * 4.3 + 7.1);
        float n3 = fbm3(d * 1.3 - 3.7);
        float band = exp(-pow(dot(d, normalize(vec3(0.35, 1.0, 0.2))) * 3.0, 2.0)); // 은하수 띠
        col += vec3(0.42, 0.10, 0.62) * smoothstep(0.42, 0.82, n1) * 0.85;
        col += vec3(0.04, 0.38, 0.52) * smoothstep(0.48, 0.88, n2) * 0.65;
        col += vec3(0.75, 0.18, 0.42) * smoothstep(0.5, 0.92, n1 * n3 * 1.9) * 0.55;
        col += vec3(0.30, 0.26, 0.42) * band * (0.35 + 0.65 * n2);
        col += vec3(0.9, 0.85, 1.0) * band * smoothstep(0.62, 0.7, n2) * 0.25;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

/**
 * 포털 원판: 소용돌이. mode 0 = 우주가 보임 (보라·청록 소용돌이 + 별), 1 = 구름섬 하늘이 보임 (하늘색 + 흰 구름)
 * cutY: 이보다 아래(도로 밑)는 그리지 않음
 */
function portalDiskMaterial(cutY, radius) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMode: { value: 0 }, uCut: { value: cutY }, uOpen: { value: 1 }, uR: { value: radius } },
    vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uMode, uCut, uOpen, uR; varying vec2 vP;
      ${NOISE_GLSL}
      void main() {
        if (vP.y < uCut) discard;
        float r = length(vP) / uR;
        float a = atan(vP.y, vP.x);
        float sw = a + r * 5.0 - uTime * 1.6;
        float n = fbm3(vec3(cos(sw) * 2.0 * r, sin(sw) * 2.0 * r, r * 3.0 - uTime * 0.4));
        float n2 = fbm3(vec3(cos(sw * 2.0) * 3.0 * r, sin(sw * 2.0) * 3.0 * r, uTime * 0.2 + 5.0));
        vec3 col;
        if (uMode < 0.5) {
          col = mix(vec3(0.03, 0.02, 0.12), vec3(0.45, 0.12, 0.85), smoothstep(0.3, 0.75, n));
          col = mix(col, vec3(0.1, 0.85, 1.0), smoothstep(0.55, 0.85, n2) * 0.8);
          float st = step(0.985, hash3(floor(vec3(vP * 3.0, floor(uTime * 2.0)))));
          col += vec3(st) * (1.0 - r);
        } else {
          col = mix(vec3(0.35, 0.62, 0.98), vec3(0.85, 0.93, 1.0), smoothstep(0.35, 0.75, n));
          col = mix(col, vec3(1.0), smoothstep(0.6, 0.85, n2) * 0.7);
        }
        col += vec3(1.0, 0.95, 1.0) * pow(1.0 - r, 3.0) * 0.9; // 가운데 밝게 (빛 터널 입구)
        float edge = smoothstep(1.0, 0.86, r);
        float alpha = edge * (0.82 + 0.18 * n) * uOpen;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/** 행성 고리 / 블랙홀 원반 (반지름에 따라 색 띠) */
function ringBandMaterial({ inner, outer, colorA, colorB, swirl = 0, opacity = 0.8 }) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIn: { value: inner }, uOut: { value: outer }, uA: { value: new THREE.Color(colorA) }, uB: { value: new THREE.Color(colorB) }, uSwirl: { value: swirl }, uOp: { value: opacity } },
    vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uIn, uOut, uSwirl, uOp; uniform vec3 uA, uB; varying vec2 vP;
      ${NOISE_GLSL}
      void main() {
        float r = (length(vP) - uIn) / (uOut - uIn);
        if (r < 0.0 || r > 1.0) discard;
        float a = atan(vP.y, vP.x);
        float bands = 0.55 + 0.45 * sin(r * 70.0 + noise3(vec3(r * 12.0, 0.0, 0.0)) * 6.0);
        float sw = uSwirl > 0.0 ? fbm3(vec3(cos(a + r * 4.0 - uTime * uSwirl) * 3.0, sin(a + r * 4.0 - uTime * uSwirl) * 3.0, r * 6.0)) : 0.5;
        vec3 col = mix(uA, uB, r) * (0.6 + 0.8 * sw);
        float alpha = bands * smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.75, r) * uOp;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: swirl > 0 ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
}

/** 우주 먼지: 카메라 주변 상자 안에서 반복되는 작은 빛 점 (속도감) */
function spaceDust(n = 900, box = 220) {
  const rnd = seededRandom(4242);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = rnd() * box;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uSize: { value: 70 } },
    vertexShader: /* glsl */ `
      uniform vec3 uCam; uniform float uBox, uSize; varying float vA;
      void main() {
        vec3 p = mod(position - uCam, uBox) - uBox * 0.5 + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = length(mv.xyz);
        vA = smoothstep(uBox * 0.5, uBox * 0.2, d) * smoothstep(2.0, 8.0, d);
        gl_PointSize = uSize / d;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `varying float vA; void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4(0.75, 0.85, 1.0, a * vA * 0.9); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------- 포털 (구름섬 ↔ 우주 문)
/**
 * 도로를 감싸는 거대한 고리 + 소용돌이 원판 + 빙빙 도는 빛 알갱이.
 * 로컬 좌표: +z = 도로 진행 방향, y = 위, 원점 = 도로 가운데 바닥
 */
export function portalGate({ radius = 17, color = '#8b5cff', color2 = '#38e8ff' } = {}) {
  const obj = new THREE.Group();
  obj.name = 'portalGate';
  const R = radius;
  const hc = R * 0.55; // 고리 중심 높이 (아래쪽은 땅/도로 밑으로 들어감)
  const a0 = Math.asin(hc / R); // 도로 높이에서 고리가 땅에 닿는 각
  const ring = new THREE.Group();
  ring.position.y = hc;
  obj.add(ring);
  const metal = new THREE.MeshStandardMaterial({ color: '#2a2450', metalness: 0.7, roughness: 0.3, emissive: '#1a0f40', emissiveIntensity: 0.6 });
  const glowMat = new THREE.MeshBasicMaterial({ color, fog: false });
  const glow2 = new THREE.MeshBasicMaterial({ color: color2, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const arc = Math.PI + 2 * a0;
  const outer = new THREE.Mesh(new THREE.TorusGeometry(R, 1.7, 14, 120, arc), metal);
  outer.rotation.z = -a0;
  outer.castShadow = true;
  ring.add(outer);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(R - 1.6, 0.45, 8, 120, arc), glowMat);
  inner.rotation.z = -a0;
  ring.add(inner);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(R - 1.2, 1.4, 8, 120, arc), glow2);
  halo.rotation.z = -a0;
  ring.add(halo);
  // 고리 둘레의 빛나는 룬 블록
  const runeGeo = new THREE.BoxGeometry(1.2, 2.6, 4.2);
  const runeMat = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false });
  const runes = new THREE.InstancedMesh(runeGeo, runeMat, 18);
  for (let i = 0; i < 18; i++) {
    const a = -a0 + (i / 17) * arc;
    _m4.compose(_p.set(Math.cos(a) * (R + 1.4), Math.sin(a) * (R + 1.4), 0), _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a), _s.set(1, 1, 1));
    runes.setMatrixAt(i, _m4);
    runes.setColorAt(i, new THREE.Color(i % 2 ? color : color2));
  }
  ring.add(runes);
  // 땅에 닿는 받침 기둥 2개
  const footX = Math.cos(a0) * R;
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.4, 4, 8), metal);
    foot.position.set(sx * footX, 1.2, 0);
    foot.castShadow = true;
    obj.add(foot);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.4, 8), glowMat);
    lamp.position.set(sx * footX, 3.3, 0);
    obj.add(lamp);
  }
  // 소용돌이 원판
  const diskMat = portalDiskMaterial(-hc + 0.05, R - 1.3);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(R - 1.3, 96), diskMat);
  disk.position.y = hc;
  disk.renderOrder = 3;
  obj.add(disk);
  // 고리를 따라 도는 빛 알갱이
  const N = 260;
  const ppos = new Float32Array(N * 3);
  const rnd = seededRandom(77);
  const pdat = [];
  for (let i = 0; i < N; i++) pdat.push({ a: rnd() * TAU, r: R - 2 + rnd() * 5, z: (rnd() - 0.5) * 6, w: 0.3 + rnd() * 0.9 });
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  const sparks = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: color2, size: 0.9, map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sparks.position.y = hc;
  sparks.frustumCulled = false;
  obj.add(sparks);
  const shine = glowSprite(glowTexture(), color, R * 4.2, 0.45);
  shine.position.y = hc;
  obj.add(shine);
  return {
    obj,
    disk,
    diskMat,
    feet: [-footX, footX],
    radius: R,
    centerY: hc,
    update(t) {
      diskMat.uniforms.uTime.value = t;
      halo.material.opacity = 0.6 + 0.3 * Math.sin(t * 3);
      shine.material.opacity = 0.35 + 0.15 * Math.sin(t * 2.1);
      for (let i = 0; i < N; i++) {
        const d = pdat[i];
        const a = d.a + t * d.w;
        if (Math.sin(a) < -hc / d.r + 0.02) {
          ppos[i * 3 + 1] = -999;
          continue;
        }
        ppos[i * 3] = Math.cos(a) * d.r;
        ppos[i * 3 + 1] = Math.sin(a) * d.r;
        ppos[i * 3 + 2] = d.z + Math.sin(t * 2 + i) * 0.6;
      }
      pgeo.attributes.position.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- 스타게이트 섬 건물 (구름섬 쪽, gpScenery가 배치)
/** 발사대 + 로켓. 차가 가까이 오면 한 번 발사됨 (불꽃·연기), 한참 뒤 다시 발사대에 섬 */
export function rocketPad() {
  const obj = new THREE.Group();
  obj.name = 'rocketPad';
  const white = new THREE.MeshStandardMaterial({ color: '#f2f4f8', roughness: 0.45, metalness: 0.2 });
  const red = new THREE.MeshStandardMaterial({ color: '#e8463a', roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#3a3f4a', roughness: 0.7, metalness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c0453a', roughness: 0.6, metalness: 0.3 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(11, 12, 2, 24), dark);
  pad.position.y = 1;
  pad.receiveShadow = true;
  obj.add(pad);
  const flameHole = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.2, 16), new THREE.MeshBasicMaterial({ color: '#111' }));
  flameHole.position.y = 2.05;
  obj.add(flameHole);
  // 발사탑 (격자 기둥)
  const tower = new THREE.Group();
  for (let y = 0; y < 34; y += 4) {
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), steel);
      post.position.set(x, y + 2, z);
      tower.add(post);
    }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 3.6), steel);
    brace.position.y = y + 4;
    tower.add(brace);
  }
  const arm = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.6, 1.2), steel);
  arm.position.set(-3.6, 26, 0);
  tower.add(arm);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3b30' }));
  beacon.position.y = 36.4;
  tower.add(beacon);
  tower.position.set(8.5, 2, 0);
  tower.traverse((o) => o.isMesh && (o.castShadow = true));
  obj.add(tower);
  // 로켓
  const rocket = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 22, 20), white);
  body.position.y = 13;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 20), red);
  nose.position.y = 27.5;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, 1.4, 20), red);
  band.position.y = 19;
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16), new THREE.MeshStandardMaterial({ color: '#7fe7ff', emissive: '#38e8ff', emissiveIntensity: 0.6 }));
  win.position.set(0, 21.5, 2.23);
  rocket.add(body, nose, band, win);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 3.6), red);
    const a = (k / 4) * TAU + Math.PI / 4;
    fin.position.set(Math.cos(a) * 2.8, 4.5, Math.sin(a) * 2.8);
    fin.rotation.y = -a;
    rocket.add(fin);
    const booster = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 10, 12), white);
    booster.position.set(Math.cos(a + Math.PI / 4) * 3, 6.5, Math.sin(a + Math.PI / 4) * 3);
    rocket.add(booster);
  }
  rocket.traverse((o) => o.isMesh && (o.castShadow = true));
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(2.4, 12, 16, 1, true), flameMat);
  flame.rotation.x = Math.PI;
  flame.position.y = -5;
  flame.visible = false;
  rocket.add(flame);
  const flameGlow = glowSprite(glowTexture(), '#ffcf7a', 26, 0.9);
  flameGlow.position.y = -3;
  flameGlow.visible = false;
  rocket.add(flameGlow);
  rocket.position.y = 2;
  obj.add(rocket);
  // 연기 (발사할 때 퍼지는 구름)
  const smokeMat = new THREE.MeshLambertMaterial({ color: '#f4f4f6', transparent: true, opacity: 0.8, depthWrite: false });
  const puffs = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), smokeMat);
    m.visible = false;
    obj.add(m);
    puffs.push({ m, a: (i / 14) * TAU, life: 0 });
  }
  let state = 'idle', st = 0, v = 0, cooldown = 0;
  return {
    obj,
    height: 36,
    radius: 12,
    launch() {
      if (state !== 'idle' || cooldown > 0) return;
      state = 'count';
      st = 0;
    },
    update(t, dt, car) {
      beacon.material.color.set(Math.sin(t * 5) > 0 ? '#ff3b30' : '#4a1210');
      if (cooldown > 0) cooldown -= dt;
      if (car && state === 'idle' && cooldown <= 0) {
        _p.setFromMatrixPosition(obj.matrixWorld);
        if (car.pos.distanceToSquared(_p) < 260 * 260) this.launch();
      }
      if (state === 'idle') return;
      st += dt;
      const fl = 0.8 + 0.4 * Math.sin(t * 40) + 0.2 * Math.sin(t * 23);
      if (state === 'count') {
        flame.visible = flameGlow.visible = st > 1.2;
        flame.scale.set(fl * 0.6, fl * 0.5, fl * 0.6);
        if (st > 2.2) (state = 'fly'), (st = 0), (v = 0);
      } else if (state === 'fly') {
        v += dt * (6 + st * 3);
        rocket.position.y += v * dt;
        rocket.rotation.z = Math.min(0.35, st * 0.02);
        flame.scale.set(fl, fl * 1.4, fl);
        if (st > 16) {
          state = 'idle';
          cooldown = 60;
          rocket.position.y = 2;
          rocket.rotation.z = 0;
          flame.visible = flameGlow.visible = false;
        }
      }
      // 연기: 발사대 둘레로 퍼짐
      for (const p of puffs) {
        if (state !== 'idle' && st < 10 && (p.life <= 0 || p.life > 4)) {
          p.life = 0.01 + Math.random() * 0.5;
          p.a = Math.random() * TAU;
        }
        if (p.life > 0) {
          p.life += dt;
          const r = 3 + p.life * 6;
          p.m.visible = p.life < 4 && state !== 'idle';
          p.m.position.set(Math.cos(p.a) * r, 1.5 + p.life * 1.2, Math.sin(p.a) * r);
          p.m.scale.setScalar(2 + p.life * 2.2);
        }
      }
      smokeMat.opacity = 0.7;
    },
  };
}

/** 천문대: 흰 돔 (천천히 돌아감) + 망원경 */
export function observatory() {
  const obj = new THREE.Group();
  obj.name = 'observatory';
  const wall = new THREE.MeshStandardMaterial({ color: '#e9e4f2', roughness: 0.7 });
  const domeMat = new THREE.MeshStandardMaterial({ color: '#f8f9fc', roughness: 0.35, metalness: 0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 7, 24), wall);
  base.position.y = 3.5;
  const dome = new THREE.Group();
  dome.position.y = 7;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(7.2, 28, 14, 0, TAU, 0, Math.PI / 2), domeMat);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(2.2, 7.6, 7.6), new THREE.MeshStandardMaterial({ color: '#1b1d33' }));
  slit.position.set(0, 3.4, 3.2);
  slit.rotation.x = -0.45;
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 9, 12), new THREE.MeshStandardMaterial({ color: '#3a3f6a', metalness: 0.6, roughness: 0.3 }));
  scope.position.set(0, 5, 3.5);
  scope.rotation.x = -0.75;
  dome.add(shell, slit, scope);
  obj.add(base, dome);
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.4, 0.3), new THREE.MeshStandardMaterial({ color: '#5b4bb5' }));
  door.position.set(0, 1.7, 7.2);
  obj.add(door);
  const ringLight = new THREE.Mesh(new THREE.TorusGeometry(7.1, 0.18, 6, 48), new THREE.MeshBasicMaterial({ color: '#8b5cff' }));
  ringLight.rotation.x = Math.PI / 2;
  ringLight.position.y = 7;
  obj.add(ringLight);
  obj.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
  const ph = Math.random() * 6;
  return { obj, radius: 7.6, height: 15, update: (t) => (dome.rotation.y = Math.sin(t * 0.07 + ph) * 1.4) };
}

/** 전파 망원경 접시 (천천히 하늘을 훑음) */
export function radarDish({ size = 1 } = {}) {
  const obj = new THREE.Group();
  obj.name = 'radarDish';
  const metal = new THREE.MeshStandardMaterial({ color: '#dde2ea', roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: '#59607a', roughness: 0.6, metalness: 0.4 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 9, 10), dark);
  base.position.y = 4.5;
  obj.add(base);
  const head = new THREE.Group();
  head.position.y = 9.5;
  const tilt = new THREE.Group();
  head.add(tilt);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(8, 28, 10, 0, TAU, 0, 0.62), metal);
  dish.rotation.x = Math.PI;
  dish.position.y = 6.6;
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 6), dark);
  feed.position.y = 1.8;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff4fd8' }));
  tip.position.y = 4.8;
  tilt.add(dish, feed, tip);
  tilt.rotation.x = 0.7;
  obj.add(head);
  obj.scale.setScalar(size);
  obj.traverse((o) => o.isMesh && (o.castShadow = true));
  const ph = Math.random() * 6;
  return {
    obj, radius: 3 * size, height: 18 * size,
    update(t) {
      head.rotation.y = t * 0.12 + ph;
      tilt.rotation.x = 0.55 + Math.sin(t * 0.21 + ph) * 0.25;
      tip.material.color.set(Math.sin(t * 4 + ph) > 0.3 ? '#ff4fd8' : '#3a1036');
    },
  };
}

/** 안테나 탑 (깜박이는 빨간 불) */
export function antennaMast({ height = 26 } = {}) {
  const obj = new THREE.Group();
  obj.name = 'antennaMast';
  const steel = new THREE.MeshStandardMaterial({ color: '#c9ced8', metalness: 0.5, roughness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, height, 8), steel);
  pole.position.y = height / 2;
  obj.add(pole);
  for (let y = 6; y < height - 2; y += 5) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3 - y * 0.05, 0.15, 0.15), steel);
    bar.position.y = y;
    bar.rotation.y = y * 0.7;
    obj.add(bar);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3b30' }));
  lamp.position.y = height + 0.3;
  obj.add(lamp);
  const ph = Math.random() * 6;
  return { obj, radius: 1, height, update: (t) => lamp.material.color.set(Math.sin(t * 3 + ph) > 0.5 ? '#ff3b30' : '#401010') };
}

/** 우주 홀로그램 안내판 (빛나는 글자판 + 네온 기둥) */
function holoSign(title, sub, color = '#38e8ff') {
  const obj = new THREE.Group();
  const tex = canvasTexture(512, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(10,12,40,0.55)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#ffffff';
    g.font = 'bold 64px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.fillText(title, w / 2, h * 0.4);
    g.font = 'bold 30px sans-serif';
    g.fillStyle = color;
    g.fillText(sub, w / 2, h * 0.76);
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(18, 6.75), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  panel.position.y = 9;
  obj.add(panel);
  const postMat = new THREE.MeshBasicMaterial({ color });
  for (const x of [-8.6, 8.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 12.5, 0.35), postMat);
    post.position.set(x, 6.25, 0);
    obj.add(post);
  }
  return { obj, panel };
}

// ---------------------------------------------------------------- 우주 차원 전체
/**
 * 우주 차원 풍경과 세계 전환.
 * cloudObjects: 구름섬 세계 물체들 (우주에 있을 때 숨김). 이 밖에도 scene 바로 아래에서 userData.world === 'cloud' 인 것도 같이 숨김
 * 돌려주는 update(time, dt, car)를 매 프레임 부르면 됨
 */
export function buildSpace(track, scene, { cloudObjects = [], skyFog = null } = {}) {
  const D = track.dimension;
  if (!D) return null;
  const rnd = seededRandom(20261109);
  const R = (a, b) => a + rnd() * (b - a);
  const HW = track.width / 2, DECK = track.deckHalf;
  const world = new THREE.Group(); // 우주 쪽 물체 (도로 근처, 고정 위치)
  world.name = 'spaceWorld';
  world.userData.world = 'space';
  world.visible = false;
  scene.add(world);
  const sky = new THREE.Group(); // 카메라를 따라다니는 우주 하늘
  sky.name = 'spaceSky';
  sky.visible = false;
  scene.add(sky);
  const both = new THREE.Group(); // 두 세계 모두에서 보임 (포털)
  both.name = 'portals';
  scene.add(both);
  const animators = [];
  const neon = (D.neon || ['#38e8ff', '#ff4fd8', '#8b5cff', '#ffd25a']).map((c) => new THREE.Color(c));

  // 우주 구간 샘플 (포털 A → 포털 B 순서, 거리 이어짐)
  const iA = track.indexAt(D.t0);
  let iB = track.indexAt(D.t1);
  if (iB < iA) iB += track.samples.length - 1;
  const list = track.spanList(iA, iB);
  const d0 = list[0].dist, d1 = list[list.length - 1].dist;
  const spaceLen = d1 - d0;
  // 가까운 우주 도로 찾기용 해시
  const HS = 40;
  const hash = new Map();
  const hk = (x, y, z) => `${Math.floor(x / HS)},${Math.floor(y / HS)},${Math.floor(z / HS)}`;
  for (let k = 0; k < list.length; k += 3) {
    const p = list[k].pos;
    const key = hk(p.x, p.y, p.z);
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(p);
  }
  /** 우주 도로(중심선)까지 거리가 r보다 가까운가 */
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
  const atDist = (m) => list[Math.max(0, Math.min(list.length - 1, Math.round((m / spaceLen) * (list.length - 1))))];
  const yawOf = (s) => Math.atan2(s.tan.x, s.tan.z);
  /** 도로 지점 s에 도로 방향으로 놓기 (로컬 +z = 진행 방향) */
  const placeOn = (obj, s, lat = 0, h = 0) => {
    track.surf(s, lat, h, obj.position);
    obj.rotation.set(0, yawOf(s), 0);
    return obj;
  };

  // ---------------------------------------------------------------- 1) 우주 하늘 (카메라를 따라감)
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(2350, 48, 24), nebulaMaterial());
  nebula.renderOrder = -10;
  nebula.frustumCulled = false;
  sky.add(nebula);
  // 별 (밝은 별 / 흐린 별)
  const starTex = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.25)');
  for (const [n, size, op] of [[5200, 2.2, 0.85], [700, 4.2, 1]]) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - u * u);
      // 은하수 띠 근처에 더 많이
      let x = Math.cos(a) * r, y = u, z = Math.sin(a) * r;
      if (rnd() < 0.35) {
        const bx = 0.35, by = 1, bz = 0.2, bl = Math.hypot(bx, by, bz);
        const dd = (x * bx + y * by + z * bz) / bl;
        x -= (bx / bl) * dd * 0.85;
        y -= (by / bl) * dd * 0.85;
        z -= (bz / bl) * dd * 0.85;
        const l = Math.hypot(x, y, z);
        (x /= l), (y /= l), (z /= l);
      }
      pos.set([x * 2200, y * 2200, z * 2200], i * 3);
      c.setHSL(rnd() < 0.5 ? 0.6 + rnd() * 0.1 : 0.08 + rnd() * 0.06, 0.4 + rnd() * 0.4, 0.75 + rnd() * 0.25);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, map: starTex, vertexColors: true, transparent: true, opacity: op, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    pts.renderOrder = -9;
    pts.frustumCulled = false;
    sky.add(pts);
  }
  const glowTex = glowTexture();
  // 행성들
  const SUN = new THREE.Vector3(60, 110, 40).normalize(); // main.js 해 방향과 같게
  const sunSprite = glowSprite(glowTex, '#fff2d6', 420, 1);
  sunSprite.position.copy(SUN).multiplyScalar(2000);
  const sunCore = glowSprite(glowTex, '#ffffff', 120, 1);
  sunCore.position.copy(sunSprite.position);
  sky.add(sunSprite, sunCore);
  const planets = [];
  (D.planets || []).forEach(([x, y, z, r, color, ring], k) => {
    const dir = new THREE.Vector3(x, y, z).normalize();
    const g = new THREE.Group();
    g.position.copy(dir).multiplyScalar(1700 + r * 0.6);
    const banded = k % 2 === 0;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 32), new THREE.MeshStandardMaterial({ map: planetTexture(color, 100 + k, banded), roughness: 1, metalness: 0, emissive: color, emissiveIntensity: 0.08, fog: false }));
    mesh.rotation.z = R(-0.4, 0.4);
    g.add(mesh);
    const atm = glowSprite(glowTex, color, r * 2.9, 0.35);
    g.add(atm);
    if (ring) {
      const rg = new THREE.Mesh(new THREE.RingGeometry(r * 1.35, r * 2.3, 128, 1), ringBandMaterial({ inner: r * 1.35, outer: r * 2.3, colorA: color, colorB: '#fff4dc', opacity: 0.75 }));
      rg.rotation.x = Math.PI / 2 - 0.35;
      rg.rotation.y = 0.3;
      g.add(rg);
    }
    sky.add(g);
    planets.push({ g, mesh, spin: R(0.004, 0.012) });
  });
  // 블랙홀 (검은 공 + 빙글빙글 도는 빛 원반)
  if (D.blackHole) {
    const dir = new THREE.Vector3(...D.blackHole).normalize();
    const g = new THREE.Group();
    g.position.copy(dir).multiplyScalar(2050);
    g.lookAt(0, 0, 0);
    const hole = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 16), new THREE.MeshBasicMaterial({ color: '#000000', fog: false }));
    const diskMat = ringBandMaterial({ inner: 80, outer: 300, colorA: '#ffd6a0', colorB: '#ff4fd8', swirl: 0.25, opacity: 1 });
    const disk = new THREE.Mesh(new THREE.RingGeometry(80, 300, 160, 1), diskMat);
    disk.rotation.x = 1.2;
    const photon = new THREE.Mesh(new THREE.TorusGeometry(76, 3, 8, 96), new THREE.MeshBasicMaterial({ color: '#ffe8c8', transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
    const halo = glowSprite(glowTex, '#ff9a5a', 700, 0.4);
    g.add(halo, disk, hole, photon);
    sky.add(g);
    animators.push((t) => (diskMat.uniforms.uTime.value = t));
  }
  // 나선 은하 (먼 곳의 그림)
  {
    const tex = canvasTexture(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const r2 = seededRandom(9);
      for (let i = 0; i < 2600; i++) {
        const arm = i % 2, t = r2() * 3.2;
        const a = t * 2.2 + arm * Math.PI + (r2() - 0.5) * 0.6;
        const rr = t * 36 + (r2() - 0.5) * 10;
        const v = 1 - t / 3.4;
        g.fillStyle = `rgba(${200 + 55 * v | 0},${170 + 70 * v | 0},255,${0.15 + v * 0.5})`;
        g.fillRect(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr * 0.55, 2, 2);
      }
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 40);
      grd.addColorStop(0, 'rgba(255,240,220,1)');
      grd.addColorStop(1, 'rgba(255,240,220,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    const gal = glowSprite(tex, '#ffffff', 520, 0.9);
    gal.material.rotation = 0.5;
    gal.position.set(-0.3, 0.75, 0.6).normalize().multiplyScalar(2100);
    sky.add(gal);
  }
  // 혜성 (가끔 하늘을 가로지름)
  const comet = new THREE.Group();
  {
    const head = glowSprite(glowTex, '#e8fbff', 40, 1);
    const tailTex = canvasTexture(32, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(180,240,255,0.9)');
      grd.addColorStop(1, 'rgba(120,120,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(w * 0.5 - 6, 0);
      g.lineTo(w * 0.5 + 6, 0);
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.fill();
    });
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(40, 420), new THREE.MeshBasicMaterial({ map: tailTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    tail.position.y = -210;
    comet.add(tail, head);
    sky.add(comet);
  }
  animators.push((t) => {
    const ph = (t % 45) / 45;
    const a = -0.9 + ph * 1.8;
    comet.visible = ph < 0.7;
    comet.position.set(Math.sin(a) * 1900, 900 - ph * 500, Math.cos(a) * -1600);
    comet.rotation.z = 0.9;
    for (const p of planets) p.mesh.rotation.y = t * p.spin;
  });
  // 우주 먼지 (속도감)
  const dust = spaceDust();
  world.add(dust);

  // ---------------------------------------------------------------- 2) 빛 터널 (포털 A 뒤, 포털 B 앞)
  const TUN = D.tunnel || 230;
  const tunA = list.filter((s) => s.dist - d0 < TUN);
  const tunB = list.filter((s) => d1 - s.dist < TUN);
  const streakTex = canvasTexture(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r2 = seededRandom(3);
    for (let i = 0; i < 70; i++) {
      const x = r2() * w, y = r2() * h, l = 20 + r2() * 90;
      const grd = g.createLinearGradient(0, y, 0, y + l);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.7, `rgba(255,255,255,${0.4 + r2() * 0.6})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x, y, 1 + r2() * 2, l);
      if (y + l > h) g.fillRect(x, y - h, 1 + r2() * 2, l);
    }
  });
  streakTex.repeat.set(5, 1);
  const tubeProfile = [];
  for (let k = 0; k <= 16; k++) {
    const a = Math.PI - (k / 16) * Math.PI;
    tubeProfile.push([Math.cos(a) * 17, -3 + Math.sin(a) * 19]);
  }
  const tubeMats = [];
  for (const [L, col] of [[tunA, '#8b5cff'], [tunB, '#38e8ff']]) {
    if (L.length < 4) continue;
    const mat = new THREE.MeshBasicMaterial({ map: streakTex.clone(), color: col, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    mat.map.repeat.set(5, 1);
    mat.map.needsUpdate = true;
    const tube = sweep(track, L, tubeProfile, mat, { vScale: 40 });
    world.add(tube);
    tubeMats.push(mat);
    // 고리 (9 m마다, 색이 앞으로 흘러감)
    const hoops = [];
    for (let m = 4; m < TUN - 4; m += 9) {
      const s = L.find((q) => Math.abs(q.dist - L[0].dist - m) < 1.5);
      if (s) hoops.push(s);
    }
    const im = new THREE.InstancedMesh(new THREE.TorusGeometry(16, 0.32, 6, 48, Math.PI), new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }), hoops.length);
    hoops.forEach((s, i) => {
      _m4.compose(track.surf(s, 0, -1, _p), _q.setFromEuler(_e.set(0, yawOf(s), 0)), _s.set(1, 1, 1));
      im.setMatrixAt(i, _m4);
      im.setColorAt(i, neon[i % 2]);
    });
    world.add(im);
    const c = new THREE.Color();
    animators.push((t) => {
      for (let i = 0; i < hoops.length; i++) {
        const w = 0.5 + 0.5 * Math.sin(i * 0.8 - t * 9);
        c.copy(neon[(i >> 2) % 3]).multiplyScalar(0.25 + w * 1.4);
        im.setColorAt(i, c);
      }
      im.instanceColor.needsUpdate = true;
    });
  }
  animators.push((t) => {
    for (const m of tubeMats) m.map.offset.y = -t * 2.6;
  });

  // ---------------------------------------------------------------- 3) 네온 아치 (터널 밖 구간)
  {
    const step = D.arches || 140;
    const stationD = D.station !== undefined ? track.sampleAt(D.station).dist : -1e9;
    const arches = [];
    for (let m = TUN + 60; m < spaceLen - TUN - 40; m += step) {
      const s = atDist(m);
      if (Math.abs(s.dist - stationD) < 50) continue;
      arches.push(s);
    }
    const geo = new THREE.TorusGeometry(15.5, 0.55, 8, 56, Math.PI);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }), arches.length * 2);
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }), arches.length * 2);
    arches.forEach((s, i) => {
      for (let k = 0; k < 2; k++) {
        const s2 = atDist(s.dist - d0 + k * 6);
        _m4.compose(track.surf(s2, 0, -0.5, _p), _q.setFromEuler(_e.set(0, yawOf(s2), 0)), _s.set(1, 1, 1));
        im.setMatrixAt(i * 2 + k, _m4);
        im.setColorAt(i * 2 + k, neon[(i + k) % neon.length]);
        // 아치 다리 끝 빛 구슬
        _m4.compose(track.surf(s2, (k ? 1 : -1) * 15.5, 0, _p), _q.identity(), _s.set(1, 1, 1));
        bulb.setMatrixAt(i * 2 + k, _m4);
        bulb.setColorAt(i * 2 + k, neon[(i + 1) % neon.length]);
      }
    });
    world.add(im, bulb);
    const c = new THREE.Color();
    animators.push((t) => {
      for (let i = 0; i < arches.length * 2; i++) {
        const w = 0.5 + 0.5 * Math.sin(t * 3 - i * 0.6);
        c.copy(neon[(i >> 1) % neon.length]).multiplyScalar(0.45 + w * 1.1);
        im.setColorAt(i, c);
      }
      im.instanceColor.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- 4) 우주 정거장 (도로가 고리 가운데를 지나감)
  if (D.station !== undefined) {
    const s = track.sampleAt(D.station);
    const g = new THREE.Group();
    placeOn(g, s, 0, 4);
    const spin = new THREE.Group();
    g.add(spin);
    const hull = new THREE.MeshStandardMaterial({ color: '#c9cfdd', metalness: 0.6, roughness: 0.35 });
    const darkM = new THREE.MeshStandardMaterial({ color: '#3b4060', metalness: 0.5, roughness: 0.5 });
    const RR = 36;
    const torus = new THREE.Mesh(new THREE.TorusGeometry(RR, 3.4, 16, 120), hull);
    spin.add(torus);
    const winRing = new THREE.Mesh(new THREE.TorusGeometry(RR, 3.5, 4, 120, TAU), new THREE.MeshBasicMaterial({ color: '#ffd25a', wireframe: true, transparent: true, opacity: 0.35, fog: false }));
    spin.add(winRing);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const mod = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 12, 14), k % 2 ? hull : darkM);
      mod.position.set(Math.cos(a) * RR, Math.sin(a) * RR, 0);
      mod.rotation.z = a;
      spin.add(mod);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: k % 2 ? '#ff3b30' : '#38e8ff', fog: false }));
      lamp.position.set(Math.cos(a) * (RR + 5), Math.sin(a) * (RR + 5), 0);
      spin.add(lamp);
      if (k % 2 === 0) {
        // 태양 전지판 날개
        const wing = new THREE.Group();
        wing.position.set(Math.cos(a) * (RR + 4), Math.sin(a) * (RR + 4), 0);
        wing.rotation.z = a;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(34, 0.8, 0.8), darkM);
        arm.position.x = 17;
        wing.add(arm);
        for (const z of [-5.5, 5.5]) {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(28, 0.3, 9), new THREE.MeshStandardMaterial({ color: '#1d2a7a', emissive: '#2a4dff', emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.25 }));
          panel.position.set(20, 0, z);
          wing.add(panel);
        }
        spin.add(wing);
      }
    }
    const signTex = canvasTexture(512, 96, (gg, w, h) => {
      gg.fillStyle = '#0d1030';
      gg.fillRect(0, 0, w, h);
      gg.fillStyle = '#ffd25a';
      gg.font = 'bold 60px sans-serif';
      gg.textAlign = 'center';
      gg.textBaseline = 'middle';
      gg.fillText('ORBITAL STATION 7', w / 2, h / 2 + 2);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(40, 7.5), new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide, fog: false }));
    sign.position.set(0, RR + 9, 0);
    g.add(sign);
    world.add(g);
    animators.push((t) => (spin.rotation.z = t * 0.08));
    // 멀리 떠 있는 큰 바퀴 정거장
    const wheel = new THREE.Group();
    track.surf(s, 330, 90, wheel.position);
    wheel.rotation.set(0.5, yawOf(s) + 0.8, 0.2);
    const wspin = new THREE.Group();
    wheel.add(wspin);
    wspin.add(new THREE.Mesh(new THREE.TorusGeometry(120, 8, 14, 140), hull));
    wspin.add(new THREE.Mesh(new THREE.TorusGeometry(120, 8.2, 4, 140), new THREE.MeshBasicMaterial({ color: '#7fe7ff', wireframe: true, transparent: true, opacity: 0.3, fog: false })));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 50, 20), darkM);
    hub.rotation.x = Math.PI / 2;
    wspin.add(hub);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 104, 8), hull);
      spoke.position.set(Math.cos(a) * 60, Math.sin(a) * 60, 0);
      spoke.rotation.z = a + Math.PI / 2;
      wspin.add(spoke);
    }
    const hubGlow = glowSprite(glowTex, '#7fe7ff', 90, 0.6);
    wheel.add(hubGlow);
    world.add(wheel);
    animators.push((t) => (wspin.rotation.z = -t * 0.05));
  }

  // ---------------------------------------------------------------- 5) 작은 행성 (헤어핀 안쪽)
  if (D.planetoid) {
    const [x, y, z, r] = D.planetoid;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const geo = rockGeometry(31, 4, 0.08, ['#8d7aa8', '#6e5e8c', '#a091b8', '#5b4d78']);
    const ball = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
    ball.scale.setScalar(r);
    ball.castShadow = true;
    ball.receiveShadow = true;
    g.add(ball);
    // 행성 위 수정 기둥
    const cryMat = new THREE.MeshStandardMaterial({ color: '#7fe7ff', emissive: '#38e8ff', emissiveIntensity: 0.9, roughness: 0.2, flatShading: true });
    for (let k = 0; k < 26; k++) {
      const n = new THREE.Vector3(R(-1, 1), R(-1, 1), R(-1, 1)).normalize();
      const c = new THREE.Mesh(new THREE.ConeGeometry(R(1.5, 4), R(8, 20), 5), cryMat);
      c.position.copy(n).multiplyScalar(r * 0.97);
      c.quaternion.setFromUnitVectors(UP, n);
      g.add(c);
    }
    // 둘레를 도는 바위 고리
    const belt = new THREE.InstancedMesh(rockGeometry(5, 0), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }), 90);
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * TAU + R(-0.03, 0.03), rr = r * R(1.6, 2.1);
      _m4.compose(_p.set(Math.cos(a) * rr, R(-2, 2), Math.sin(a) * rr), _q.setFromEuler(_e.set(R(0, 6), R(0, 6), 0)), _s.setScalar(R(0.8, 3)));
      belt.setMatrixAt(k, _m4);
    }
    const beltG = new THREE.Group();
    beltG.rotation.set(0.35, 0, 0.2);
    beltG.add(belt);
    g.add(beltG);
    const atm = glowSprite(glowTex, '#b48cff', r * 3.2, 0.3);
    g.add(atm);
    world.add(g);
    animators.push((t) => {
      ball.rotation.y = t * 0.03;
      beltG.rotation.y = t * 0.06;
    });
  }

  // ---------------------------------------------------------------- 6) 소행성대
  {
    const variants = [0, 1, 2, 3, 4].map((k) => rockGeometry(200 + k, 1, 0.3));
    const items = variants.map(() => []);
    let placed = 0;
    for (let tries = 0; tries < (D.asteroids || 400) * 12 && placed < (D.asteroids || 400); tries++) {
      const s = list[Math.floor(rnd() * list.length)];
      if (s.dist - d0 < TUN + 20 || d1 - s.dist < TUN + 20) continue;
      const big = rnd() < 0.12;
      const size = big ? R(16, 42) : 1.2 + Math.pow(rnd(), 2.2) * 12;
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = side * (big ? R(130, 420) : R(28, 230));
      const h = big ? R(-160, 160) : R(-70, 70);
      track.surf(s, lat, h, _p);
      _p.addScaledVector(s.tan, R(-40, 40));
      if (nearRoad(_p.x, _p.y, _p.z, size * 1.3 + 24)) continue;
      if (D.planetoid && Math.hypot(_p.x - D.planetoid[0], _p.y - D.planetoid[1], _p.z - D.planetoid[2]) < D.planetoid[3] * 2.3 + size) continue;
      const v = Math.floor(rnd() * variants.length);
      items[v].push({ x: _p.x, y: _p.y, z: _p.z, s: size, rx: R(0, 6), ry: R(0, 6), w: R(-0.3, 0.3) / Math.sqrt(size), ax: R(0, 1) });
      placed++;
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    variants.forEach((geo, v) => {
      const L = items[v];
      if (!L.length) return;
      const im = new THREE.InstancedMesh(geo, mat, L.length);
      im.castShadow = true;
      im.receiveShadow = true;
      world.add(im);
      const set = (t) => {
        L.forEach((a, i) => {
          _m4.compose(_p.set(a.x, a.y, a.z), _q.setFromEuler(_e.set(a.rx + t * a.w, a.ry + t * a.w * a.ax, 0)), _s.setScalar(a.s));
          im.setMatrixAt(i, _m4);
        });
        im.instanceMatrix.needsUpdate = true;
      };
      set(0);
      let clock = 0;
      animators.push((t, dt) => {
        clock -= dt;
        if (clock > 0) return;
        clock = 1 / 30; // 천천히 구르는 것이라 초당 30번만
        set(t);
      });
    });
  }

  // ---------------------------------------------------------------- 7) 빛나는 수정 조각, 위성
  {
    const cry = new THREE.OctahedronGeometry(1, 0).scale(0.6, 1.8, 0.6);
    const im = new THREE.InstancedMesh(cry, new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.65, roughness: 0.15, flatShading: true }), 120);
    let n = 0;
    for (let tries = 0; tries < 2000 && n < 120; tries++) {
      const s = list[Math.floor(rnd() * list.length)];
      const lat = (rnd() < 0.5 ? -1 : 1) * R(22, 90);
      track.surf(s, lat, R(-25, 35), _p);
      const size = R(1.2, 4.5);
      if (nearRoad(_p.x, _p.y, _p.z, 18 + size)) continue;
      _m4.compose(_p, _q.setFromEuler(_e.set(R(-0.4, 0.4), R(0, 6), R(-0.4, 0.4))), _s.setScalar(size));
      im.setMatrixAt(n, _m4);
      im.setColorAt(n, neon[n % neon.length].clone().multiplyScalar(0.8));
      n++;
    }
    im.count = n;
    world.add(im);
  }
  {
    const gold = new THREE.MeshStandardMaterial({ color: '#e6b84a', metalness: 0.8, roughness: 0.3 });
    const panelM = new THREE.MeshStandardMaterial({ color: '#1d2a7a', emissive: '#2a4dff', emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.3 });
    const white = new THREE.MeshStandardMaterial({ color: '#f0f0f4', roughness: 0.5 });
    for (let k = 0; k < 9; k++) {
      const s = atDist(TUN + 80 + (k / 9) * (spaceLen - 2 * TUN - 160));
      const center = track.surf(s, (k % 2 ? -1 : 1) * R(45, 80), R(18, 40), new THREE.Vector3());
      if (nearRoad(center.x, center.y, center.z, 30)) continue;
      const sat = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 3.2), gold);
      sat.add(body);
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 2.2), panelM);
        p.position.x = sx * 4.4;
        sat.add(p);
      }
      const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 6, 0, TAU, 0, 0.9), white);
      dish.position.z = 2.2;
      dish.rotation.x = -Math.PI / 2;
      sat.add(dish);
      const blink = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff3b30' }));
      blink.position.y = 1.5;
      sat.add(blink);
      world.add(sat);
      const rr = R(16, 30), w = R(0.15, 0.35) * (k % 2 ? 1 : -1), ph = R(0, 6);
      animators.push((t) => {
        const a = ph + t * w;
        sat.position.set(center.x + Math.cos(a) * rr, center.y + Math.sin(a * 0.7) * 4, center.z + Math.sin(a) * rr);
        sat.rotation.set(t * 0.2, a, 0.3);
        blink.visible = Math.sin(t * 6 + ph) > 0.4;
      });
    }
  }

  // ---------------------------------------------------------------- 8) 홀로그램 안내판
  {
    const signs = [
      [TUN + 30, '우주 차원', 'SPACE DIMENSION · 소행성 조심!', '#38e8ff'],
      [spaceLen * 0.47, 'ORBITAL 7 →', '우주 정거장 고리 통과', '#ffd25a'],
      [spaceLen - TUN - 70, '포털 B ↓', '구름섬으로 돌아가기', '#ff4fd8'],
    ];
    const LAT = DECK + 5;
    for (const [m, title, sub, col] of signs) {
      const s = atDist(m);
      const sg = holoSign(title, sub, col);
      placeOn(sg.obj, s, -LAT, -1);
      sg.obj.rotation.y += Math.PI; // 다가오는 차를 바라보게
      world.add(sg.obj);
      animators.push((t) => (sg.panel.material.opacity = 0.85 + 0.15 * Math.sin(t * 7 + m)));
    }
  }

  // ---------------------------------------------------------------- 9) 포털 A, B (두 세계 모두에서 보임)
  const portals = [];
  for (const [t, c1, c2] of [[D.t0, '#8b5cff', '#38e8ff'], [D.t1, '#38e8ff', '#ff4fd8']]) {
    const s = track.sampleAt(t);
    const pg = portalGate({ radius: D.portalRadius || 17, color: c1, color2: c2 });
    placeOn(pg.obj, s, 0, 0);
    both.add(pg.obj);
    portals.push({ pg, s, pos: s.pos.clone(), tan: s.tan3.clone().normalize(), feet: pg.feet.map((l) => track.surf(s, l, 0, new THREE.Vector3())) });
  }

  // ---------------------------------------------------------------- 10) 세계 전환
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  const sun = scene.children.find((o) => o.isDirectionalLight);
  const fog = scene.fog;
  const cloudEnv = {
    bg: scene.background && scene.background.isColor ? scene.background.clone() : new THREE.Color('#e2effa'),
    fog: fog ? fog.color.clone() : new THREE.Color('#e2effa'),
    near: fog ? fog.near : 320,
    far: fog ? fog.far : 2600,
    hemiSky: hemi ? hemi.color.clone() : null,
    hemiGround: hemi ? hemi.groundColor.clone() : null,
    hemiI: hemi ? hemi.intensity : 1,
    sunC: sun ? sun.color.clone() : null,
    sunI: sun ? sun.intensity : 1,
  };
  const spaceEnv = {
    bg: new THREE.Color(D.background || '#060818'),
    fog: new THREE.Color(D.fog || '#0b0c26'),
    near: D.fogNear ?? 420,
    far: D.fogFar ?? 2600,
    hemiSky: new THREE.Color(D.hemiSky || '#9aa8ff'),
    hemiGround: new THREE.Color(D.hemiGround || '#2a1446'),
    hemiI: D.hemiIntensity ?? 0.85,
    sunC: new THREE.Color(D.sunColor || '#dfe6ff'),
    sunI: D.sunIntensity ?? 1.7,
  };
  void skyFog;
  let envK = 0; // 0 = 구름섬, 1 = 우주
  function applyEnv(k) {
    const a = cloudEnv, b = spaceEnv;
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
  // 포털을 지날 때 화면 효과 (살짝 번쩍임 + 작은 글자)
  const fx = document.createElement('div');
  fx.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;z-index:5;transition:none;';
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);pointer-events:none;opacity:0;z-index:6;font:800 26px/1.2 sans-serif;letter-spacing:2px;color:#fff;text-shadow:0 0 12px #8b5cff,0 0 28px #38e8ff;white-space:nowrap;';
  if (document.body) document.body.append(fx, label);
  let flash = 0, labelT = 0;
  // 포털 통과 소리 (위이이잉 - 슈욱). N 키로 엔진 소리를 끄면 같이 꺼짐
  let actx = null, muted = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyN') muted = !muted;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } else if (actx.state === 'suspended') actx.resume();
  });
  function whoosh(up) {
    if (!actx || muted || actx.state !== 'running') return;
    const t0 = actx.currentTime;
    const len = Math.floor(actx.sampleRate * 1.4);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4;
    bp.frequency.setValueAtTime(up ? 300 : 2400, t0);
    bp.frequency.exponentialRampToValueAtTime(up ? 2800 : 260, t0 + 1.1);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.35);
    const osc = actx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(up ? 180 : 520, t0);
    osc.frequency.exponentialRampToValueAtTime(up ? 760 : 140, t0 + 1.0);
    const og = actx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.18, t0 + 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
    src.connect(bp).connect(g).connect(actx.destination);
    osc.connect(og).connect(actx.destination);
    src.start(t0);
    src.stop(t0 + 1.4);
    osc.start(t0);
    osc.stop(t0 + 1.2);
  }

  let inSpace = false, force = null;
  let cloudList = null;
  function setWorld(space, announce) {
    inSpace = space;
    track.setWorld(space);
    world.visible = sky.visible = space;
    if (!cloudList) {
      // 구름섬 물체: 넘겨받은 것 + scene 바로 아래에서 world 표시가 'cloud' 인 것 (gpProps 고리 등)
      cloudList = [...cloudObjects, ...scene.children.filter((o) => o.userData.world === 'cloud')];
    }
    for (const o of cloudList) o.visible = !space;
    for (const p of portals) p.pg.diskMat.uniforms.uMode.value = space ? 1 : 0;
    if (announce) {
      flash = 1;
      labelT = 2.2;
      label.textContent = space ? '🌌 우주 차원' : '☁ 구름섬 귀환';
      fx.style.background = space ? 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(139,92,255,0.75) 45%, rgba(10,8,40,0.9) 100%)' : 'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(160,220,255,0.7) 50%, rgba(255,255,255,0.85) 100%)';
      whoosh(space);
    }
  }
  /** 지금 우주에 있어야 하나: 포털 근처는 카메라가 포털 면 어느 쪽에 있는지로 (카메라가 포털을 지나는 순간 바뀜) */
  function wantSpace(car) {
    if (force !== null) return force;
    const ti = car && car.trackInfo;
    if (!ti) return inSpace;
    const cam = window.game && window.game.camera ? window.game.camera.position : car.pos;
    const L = track.length;
    const near = (t0) => {
      let d = Math.abs(ti.t - t0);
      return Math.min(d, 1 - d) * L < 140;
    };
    if (near(D.t0)) return _p.subVectors(cam, portals[0].pos).dot(portals[0].tan) > 0;
    if (near(D.t1)) return _p.subVectors(cam, portals[1].pos).dot(portals[1].tan) < 0;
    return D.inSpaceT(ti.t);
  }

  return {
    group: world,
    sky,
    portals,
    get inSpace() {
      return inSpace;
    },
    /** 테스트용: true/false로 세계를 고정, null이면 자동 */
    set force(v) {
      force = v;
    },
    get force() {
      return force;
    },
    stats: { spaceLength: Math.round(spaceLen) },
    update(t, dt, car) {
      const want = wantSpace(car);
      if (want !== inSpace) setWorld(want, dt > 0 && force === null);
      // 환경(배경·안개·빛)은 짧게 섞어서 바꿈
      const target = inSpace ? 1 : 0;
      const blend = D.blend || 0.35;
      envK = dt > 0 ? THREE.MathUtils.clamp(envK + Math.sign(target - envK) * (dt / blend), 0, 1) : target;
      applyEnv(envK);
      if (window.game && window.game.camera) {
        const cp = window.game.camera.position;
        sky.position.copy(cp);
        dust.material.uniforms.uCam.value.copy(cp);
      }
      for (const p of portals) p.pg.update(t);
      if (inSpace) for (const a of animators) a(t, dt, car);
      flash = Math.max(0, flash - dt * 1.6);
      fx.style.opacity = (flash * flash * 0.85).toFixed(3);
      labelT = Math.max(0, labelT - dt);
      label.style.opacity = Math.min(1, labelT * 1.5).toFixed(3);
    },
  };
}
