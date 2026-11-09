// 노을 해안 서킷 (data/sea.json, "module": "seaMap") — 도로·지형·바다
//
// 구름섬 그랑프리(gpTrack.js)처럼 도로에 높이가 있습니다 (points = [x, y, z]). 다른 점:
//   - 지형이 "떠 있는 섬"이 아니라 바닷가 땅: 해안선(land.coast 다각형) + 섬(discs) + 언덕(peaks)으로 높이를 계산하고
//     해안선 밖은 바닷속으로 내려갑니다. 해안이 가파른 곳(steep)은 절벽, 아니면 모래사장
//   - 바다 = 높이 0의 물. 충돌은 수학으로 계산하는 평면(메시 없음), 보이는 물은 깊이에 따라 색이 바뀌는 셰이더
//   - 도로 중심선 높이가 0인 곳(points의 y = 0)이 물길 → 차가 자동으로 배로 변신 (car.js). 물길 양쪽 끝은
//     도로가 물속으로 비스듬히 내려가는 선착장(슬립웨이)
//   - 지형 충돌도 메시 대신 높이 격자에서 바로 계산 (빠름)
//   - 구간은 t 대신 점 번호로 적습니다 (p0~p1, 소수 가능) → 점을 고쳐도 구간이 따라감
// buildTrack()과 같은 모양의 객체를 돌려줘서 차, HUD, main.js, gpCorners.js(코너 표지판)가 그대로 씁니다.
import * as THREE from 'three';
import { canvasTexture, seededRandom, roadTexture, curbTexture, checkerTexture, hazardTexture } from './track.js';
import { computeRacingLine, edgeFraction } from './racingLine.js';

const UP = new THREE.Vector3(0, 1, 0);
const SAMPLE_STEP = 1.87; // 중심선 샘플 간격 (m)
const CELL = 6; // 지형 격자 한 칸 (m)
const VCHUNK = 40; // 보이는 지형 메시 한 덩어리 = 40×40칸
const smooth = (a, b, x) => {
  const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

// ---------------------------------------------------------------- 노이즈 (같은 코스는 항상 같은 지형)
export function makeNoise(seed) {
  const rand = seededRandom(seed);
  const perm = new Uint8Array(512), val = new Float32Array(256);
  for (let i = 0; i < 256; i++) (perm[i] = i), (val[i] = rand() * 2 - 1);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (x, z) => val[perm[(x & 255) + perm[z & 255]]];
  const noise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
    const a = v(xi, zi), b = v(xi + 1, zi), c = v(xi, zi + 1), d = v(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return (x, z, oct = 3) => {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += noise(x * f + o * 17.3, z * f - o * 9.1) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return s / norm;
  };
}

function deckTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#c9ccd2';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const v = 175 + Math.random() * 50;
      g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(0, 0, w, 2);
  });
}
/** 선착장 콘크리트 (미끄럼 방지 줄무늬) */
function slipTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#9a9c98';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 130 + Math.random() * 50;
      g.fillStyle = `rgba(${v},${v + 4},${v},0.4)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(60,70,60,0.45)';
    for (let k = 0; k < 8; k++) g.fillRect(0, (k * h) / 8, w, 3);
    g.fillStyle = 'rgba(40,90,70,0.35)'; // 물이끼
    g.fillRect(0, h * 0.7, w, h * 0.3);
  });
}

// ---------------------------------------------------------------- 바다 셰이더 (깊이에 따라 색, 해안 거품, 노을 반사, 반짝임)
export const SEA = {
  sunDir: new THREE.Vector3(-0.72, 0.36, -0.6).normalize(), // 노을 해 방향 (seaScenery.js 하늘·조명과 같음)
  sunColor: new THREE.Color('#ffb070'),
  sky: new THREE.Color('#ff9a6a'),
  skyTop: new THREE.Color('#5a64b8'),
  deep: new THREE.Color('#0f4a78'),
  mid: new THREE.Color('#1d7fa6'),
  shallow: new THREE.Color('#3fc6c4'),
  foam: new THREE.Color('#fff4e6'),
};
function seaMaterial(depthTex, gx0, gz0, gw, gd) {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: false,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDepth: { value: depthTex },
        uGrid: { value: new THREE.Vector4(gx0, gz0, gw, gd) },
        uSunDir: { value: SEA.sunDir.clone() },
        uSunCol: { value: SEA.sunColor.clone() },
        uSky: { value: SEA.sky.clone() },
        uSkyTop: { value: SEA.skyTop.clone() },
        uDeep: { value: SEA.deep.clone() },
        uMid: { value: SEA.mid.clone() },
        uShallow: { value: SEA.shallow.clone() },
        uFoam: { value: SEA.foam.clone() },
        uUnder: { value: 0 },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform sampler2D uDepth; uniform vec4 uGrid;
      uniform vec3 uSunDir, uSunCol, uSky, uSkyTop, uDeep, uMid, uShallow, uFoam; uniform float uUnder;
      varying vec3 vW;
      #include <fog_pars_fragment>
      // 해시: sin(큰 수)×43758 방식은 그래픽 카드에 따라 칸 경계에서 값이 튀어 물에 네모 무늬가 생김 → 작은 수만 쓰는 해시
      float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
      void main() {
        vec2 uv = (vW.xz - uGrid.xy) / uGrid.zw;
        float depth = 26.0;
        if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) depth = texture2D(uDepth, uv).r * 26.0;
        float t = uTime;
        // 물결 (여러 방향 사인 + 잔물결 노이즈) → 기울기
        vec2 p = vW.xz;
        // 멀리 갈수록 잔물결을 줄임 (먼 바다가 자글자글한 무늬로 보이지 않게)
        float camD = length(cameraPosition.xz - p);
        float nearK = 1.0 - smoothstep(60.0, 420.0, camD);
        float midK = 1.0 - smoothstep(250.0, 1400.0, camD) * 0.8;
        float dx = 0.0, dz = 0.0;
        dx += 0.10 * cos(p.x * 0.11 + p.y * 0.05 + t * 1.3); dz += 0.05 * cos(p.x * 0.11 + p.y * 0.05 + t * 1.3);
        dx += 0.04 * cos(-p.x * 0.07 + p.y * 0.19 + t * 1.7); dz += 0.12 * cos(-p.x * 0.07 + p.y * 0.19 + t * 1.7);
        dx *= midK; dz *= midK;
        dx += nearK * 0.05 * cos(p.x * 0.31 - p.y * 0.23 + t * 2.3); dz -= nearK * 0.04 * cos(p.x * 0.31 - p.y * 0.23 + t * 2.3);
        float n1 = vn(p * 0.35 + vec2(t * 0.4, t * 0.25)), n2 = vn(p * 0.35 + vec2(0.5, 0.0) + vec2(t * 0.4, t * 0.25));
        float n3 = vn(p * 0.35 + vec2(0.0, 0.5) + vec2(t * 0.4, t * 0.25));
        dx += (n2 - n1) * 0.35 * nearK; dz += (n3 - n1) * 0.35 * nearK;
        vec3 N = normalize(vec3(-dx, 1.0, -dz));
        vec3 V = normalize(cameraPosition - vW);
        // 물 색: 얕은 곳 청록 → 깊은 곳 남색
        vec3 base = mix(uShallow, uMid, smoothstep(0.3, 4.0, depth));
        base = mix(base, uDeep, smoothstep(4.0, 18.0, depth));
        // 하늘 반사 (비스듬히 볼수록 많이) + 노을빛
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        vec3 R = reflect(-V, N);
        vec3 skyC = mix(uSky, uSkyTop, clamp(R.y * 1.6, 0.0, 1.0));
        float toward = pow(clamp(dot(normalize(vec3(R.x, 0.0, R.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0), 6.0);
        skyC += uSunCol * toward * 0.35;
        vec3 col = mix(base, skyC, 0.15 + 0.6 * fres);
        // 해 반짝임
        float spec = pow(clamp(dot(R, uSunDir), 0.0, 1.0), 220.0) * 3.0 + pow(clamp(dot(R, uSunDir), 0.0, 1.0), 24.0) * 0.25;
        col += uSunCol * spec;
        // 해안 거품 (얕은 곳 줄무늬가 밀려옴)
        float shore = smoothstep(1.1, 0.0, depth);
        float wave = 0.5 + 0.5 * sin(depth * 9.0 - t * 2.2 + vn(p * 0.2) * 6.0);
        float foam = shore * (0.45 + 0.55 * smoothstep(0.55, 0.95, wave)) * (0.7 + 0.3 * vn(p * 1.3 + t));
        col = mix(col, uFoam, clamp(foam, 0.0, 0.92));
        // 아래에서 볼 때 (물속)
        if (uUnder > 0.5) col = mix(uMid, uShallow, 0.4) * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

export function buildSeaTrack(data, scene) {
  const buildT0 = performance.now();
  const W = data.width;
  const HW = W / 2;
  const CURB = 1.6;
  const SC = data.scale || 1;
  const noise = makeNoise(20261110);
  const group = new THREE.Group();
  scene.add(group);

  // ---------------------------------------------------------------- 중심선 샘플
  const pts = data.points.map(([x, y, z]) => new THREE.Vector3(x * SC, y, z * SC));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, data.points.length * 40);
  const length = curve.getLength();
  const SAMPLES = Math.max(1200, Math.round(length / SAMPLE_STEP));
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pos = curve.getPointAt(t % 1);
    const tan3 = curve.getTangentAt(t % 1);
    const tan = tan3.clone().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
    samples.push({ t, i, pos, tan, tan3, right, dist: t * length, bank: 0, bridge: null, land: true, water: false });
  }
  const wrapI = (i) => ((i % SAMPLES) + SAMPLES) % SAMPLES;
  const S = (i) => samples[wrapI(i)];
  const indexAt = (t) => Math.round((((t % 1) + 1) % 1) * SAMPLES);
  const sampleAt = (t) => samples[indexAt(t) % SAMPLES];
  const inRangeT = (t, t0, t1) => (t0 <= t1 ? t >= t0 && t <= t1 : t >= t0 || t <= t1);

  // 점 번호 → t (점 k에 가장 가까운 샘플). 소수 번호는 앞뒤 점 사이를 길이 비율로
  const pointT = [];
  {
    let from = 0;
    for (let k = 0; k < pts.length; k++) {
      let best = Infinity, bi = from;
      for (let n = 0; n < SAMPLES; n++) {
        const i = (from + n) % SAMPLES;
        const d = samples[i].pos.distanceToSquared(pts[k]);
        if (d < best) (best = d), (bi = i);
        if (n > SAMPLES / 3 && k > 0) break; // 점 순서대로 앞으로만 찾음
      }
      pointT.push(bi / SAMPLES);
      from = bi;
    }
  }
  /** 점 번호(소수 가능) → t */
  function tOfP(p) {
    const n = pts.length;
    const k = Math.floor(p), u = p - k;
    const a = pointT[((k % n) + n) % n];
    let b = pointT[(((k + 1) % n) + n) % n];
    if (b < a) b += 1;
    return (a + (b - a) * u) % 1;
  }
  function rangeP(p0, p1) {
    const a = indexAt(tOfP(p0));
    let b = indexAt(tOfP(p1));
    if (b < a) b += SAMPLES;
    return [a, b];
  }

  // 다리 구간 (점 번호)
  for (const [p0, p1, kind] of data.bridges || []) {
    const [a, b] = rangeP(p0, p1);
    for (let i = a; i <= b; i++) {
      S(i).bridge = kind || 'cable';
      S(i).land = false;
    }
  }
  // 물길: 중심선 높이가 0 근처인 곳 (다리 아님)
  for (let i = 0; i <= SAMPLES; i++) {
    const s = samples[i];
    if (!s.bridge && s.pos.y <= 0.05) {
      s.pos.y = 0;
      s.tan3.y = 0;
      s.tan3.normalize();
      s.water = true;
      s.land = false;
    }
  }
  // 굽은 방향 → 뱅크
  const heading = (s) => Math.atan2(s.tan.x, s.tan.z);
  const turnSign = samples.map((s, i) => {
    let d = heading(S(i + 10)) - heading(S(i - 10));
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  });
  for (const bk of data.bank || []) {
    const [a, b] = rangeP(bk.p0, bk.p1);
    const ramp = Math.max(4, Math.round((22 / length) * SAMPLES));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += turnSign[wrapI(i)];
    const sgn = Math.sign(sum) || 0;
    const agreeRaw = (i) => THREE.MathUtils.clamp((turnSign[wrapI(i)] * sgn) / 0.03, 0, 1);
    for (let i = a; i <= b; i++) {
      if (S(i).water) continue;
      const w = smooth(0, ramp, i - a) * smooth(0, ramp, b - i);
      let agree = 0;
      for (let j = -ramp; j <= ramp; j++) agree += agreeRaw(i + j);
      agree /= 2 * ramp + 1;
      S(i).bank = sgn * THREE.MathUtils.degToRad(bk.deg) * w * agree;
    }
  }
  for (const s of samples) {
    s.rightB = s.right.clone().multiplyScalar(Math.cos(s.bank)).addScaledVector(UP, Math.sin(s.bank));
    s.up = new THREE.Vector3().crossVectors(s.rightB, s.tan3).normalize();
  }
  samples[SAMPLES] = { ...samples[0], t: 1, dist: length };
  const surf = (s, l, h = 0, out = new THREE.Vector3()) => out.copy(s.pos).addScaledVector(s.rightB, l).addScaledVector(s.up, h);
  const roadYAt = (s, l) => s.pos.y + l * Math.tan(s.bank);

  // 체크포인트 (점 번호 → t). main.js가 data.checkpoints를 읽음 (buildTrack 다음에)
  if (data.checkpointsP) data.checkpoints = data.checkpointsP.map((p) => +tOfP(p).toFixed(4)).sort((a, b) => a - b);

  // 밟을 수 있는 면들 (메시). 지형과 바다는 메시 대신 castRay에서 계산
  const groundMeshes = [];
  const addGround = (mesh, surface) => {
    mesh.userData.surface = surface;
    groundMeshes.push(mesh);
    group.add(mesh);
    return mesh;
  };

  function strip(list, profile, mat, { vScale = 8, chunk = 40, uScale = null, surface = null, shadow = false } = {}) {
    const meshes = [];
    if (!surface) chunk = Math.max(chunk, 120);
    const prof0 = typeof profile === 'function' ? profile(list[0], 0) : profile;
    const P = prof0.length;
    for (let a = 0; a < list.length - 1; a += chunk) {
      const b = Math.min(list.length - 1, a + chunk);
      const rows = b - a + 1;
      const pos = new Float32Array(rows * P * 3), uv = new Float32Array(rows * P * 2);
      const idx = [];
      const v = new THREE.Vector3();
      for (let r = 0; r < rows; r++) {
        const s = list[a + r];
        const prof = typeof profile === 'function' ? profile(s, a + r) : profile;
        let acc = 0;
        for (let k = 0; k < P; k++) {
          if (k) acc += Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]);
          if (s.rightB) surf(s, prof[k][0], prof[k][1], v);
          else v.copy(s.pos).addScaledVector(s.right, prof[k][0]).addScaledVector(UP, prof[k][1]);
          const o = (r * P + k) * 3;
          pos[o] = v.x;
          pos[o + 1] = v.y;
          pos[o + 2] = v.z;
          uv[(r * P + k) * 2] = uScale ? acc / uScale : k / (P - 1);
          uv[(r * P + k) * 2 + 1] = s.dist / vScale;
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
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.castShadow = shadow;
      if (surface) addGround(m, surface);
      else group.add(m);
      meshes.push(m);
    }
    return meshes;
  }
  function spanList(a, b) {
    const out = [];
    for (let i = a; i <= b; i++) {
      const s = S(i);
      out.push(i >= SAMPLES ? { ...s, dist: s.dist + length * Math.floor(i / SAMPLES) } : s);
    }
    return out;
  }
  function runsOf(flag) {
    const out = [];
    if (samples.slice(0, SAMPLES).every((s, i) => flag(i))) return [[0, SAMPLES]];
    const off = samples.slice(0, SAMPLES).findIndex((s, i) => !flag(i));
    let a = -1;
    for (let k = 1; k <= SAMPLES; k++) {
      const i = off + k, f = flag(wrapI(i));
      if (f && a < 0) a = i;
      if (!f && a >= 0) out.push([a, i]), (a = -1);
    }
    return out;
  }
  function runsIn(list, flag) {
    const out = [];
    let c = -1;
    for (let k = 0; k < list.length; k++) {
      const f = flag(list[k]);
      if (f && c < 0) c = k;
      if (!f && c >= 0) out.push([c, k]), (c = -1);
    }
    if (c >= 0 && list.length - 1 > c) out.push([c, list.length - 1]);
    return out;
  }
  const mS = (m) => Math.max(1, Math.round((m / length) * SAMPLES));
  const waterRuns = runsOf((i) => samples[i].water);

  // ---------------------------------------------------------------- 레이싱 라인과 F1식 넓은 연석 (gpTrack.js와 같은 방법)
  const KERB_WIDE = 2.8;
  const LINE_MARGIN = 1.15;
  const LINE_PLAIN = 1.0;
  const kerbW = [new Float32Array(SAMPLES).fill(CURB), new Float32Array(SAMPLES).fill(CURB)];
  const sideI = (side) => (side < 0 ? 0 : 1);
  const kerbAt = (i, side) => (samples[wrapI(i)].water ? 0 : kerbW[sideI(side)][wrapI(i)]);
  const lineSamples = samples.slice(0, SAMPLES);
  const lineUse = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
  // 물길: 부표 줄 안쪽 1.5 m까지 (연석 없음)
  // 가드레일 쪽 한계 (가드레일을 만든 뒤 채움): 레일에서 2.4 m 안쪽까지만 (봇이 레일에 끼어 멈추지 않게)
  const railCap = [new Float32Array(SAMPLES).fill(99), new Float32Array(SAMPLES).fill(99)];
  const lineLimit = (i, side) => {
    const q = wrapI(i);
    if (samples[q].water) return HW - 1.5;
    const u = lineUse[sideI(side)][q];
    return Math.min(railCap[sideI(side)][q], HW - LINE_PLAIN + u * Math.max(0, kerbAt(q, side) - LINE_MARGIN + LINE_PLAIN));
  };
  const noRailP = (data.noRail || []).map(([p0, p1, sd]) => [tOfP(p0), tOfP(p1), sd]);
  const inNoRail = (i, side) => noRailP.some(([t0, t1, sd]) => (sd === side || sd === 0) && inRangeT(samples[i].t, t0, t1));
  const widen = (i0, i1, side, ramp) => {
    for (let i = i0; i <= i1; i++) {
      const q = wrapI(i);
      const w = smooth(0, ramp, i - i0) * smooth(0, ramp, i1 - i);
      const u = lineUse[sideI(side)];
      u[q] = Math.max(u[q], w);
      if (!samples[q].land) continue; // 다리·물길: 연석 폭 그대로
      const arr = kerbW[sideI(side)];
      arr[q] = Math.max(arr[q], CURB + (KERB_WIDE - CURB) * w);
    }
  };
  const halfSamples = lineSamples.filter((_, i) => i % 2 === 0);
  const prelimApexes = () => computeRacingLine(halfSamples, (i, side) => lineLimit(i * 2, side), length, { iterScale: 0.7 }).apexes.map((a) => ({ ...a, i: a.i * 2 }));
  let apexes0 = prelimApexes();
  for (let pass = 0; pass < 2; pass++) {
    for (const ap of apexes0) {
      if (ap.radius > 150) continue;
      widen(ap.i - mS(30), ap.i + mS(22), ap.side, mS(10));
      widen(ap.i + mS(12), ap.i + mS(62), -ap.side, mS(14));
    }
    if (pass === 0) apexes0 = prelimApexes();
  }
  const lineOpts = { bank: lineSamples.map((s) => s.bank || 0), water: lineSamples.map((s) => !!s.water) };
  let racingLine = computeRacingLine(lineSamples, lineLimit, length, lineOpts); // 가드레일을 만든 뒤 한 번 더 계산 (아래)
  const lineY = (i, d = 0) => roadYAt(samples[i], racingLine.offset[i] + d);

  // ---------------------------------------------------------------- 도로, 연석, 선착장
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.88 });
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.8 });
  const curbBridgeMat = new THREE.MeshStandardMaterial({ map: curbTexture('#2e6fd8', '#f4f4f4'), roughness: 0.8 });
  const slipMat = new THREE.MeshStandardMaterial({ map: slipTexture(), roughness: 0.95 });
  for (const [a, b] of runsOf((i) => !samples[i].water)) {
    const L = spanList(a, b);
    strip(L, [[-HW, 0], [HW, 0]], roadMat, { vScale: 12, surface: 'ground' });
  }
  for (const [a, b] of runsOf((i) => samples[i].land)) {
    const L = spanList(a, b);
    strip(L, (s) => [[-HW - kerbAt(s.i, -1), 0.02], [-HW, 0.02]], curbMat, { vScale: 4, surface: 'ground' });
    strip(L, (s) => [[HW, 0.02], [HW + kerbAt(s.i, 1), 0.02]], curbMat, { vScale: 4, surface: 'ground' });
  }
  // 선착장: 물길 양 끝에서 도로가 물속으로 비스듬히 내려감 (물 높이 0 아래로 1.6 m)
  const slipways = [];
  for (const [a, b] of waterRuns) {
    for (const [from, dir] of [[a, 1], [b, -1]]) {
      const L = [];
      for (let k = 0; k <= 12; k++) {
        const s = S(from + dir * k);
        if (!s.water) break;
        L.push({ ...s, pos: s.pos.clone().setY(-0.14 * (k + 1)), rightB: s.right, up: UP, bank: 0, dist: s.dist + (from + dir * k >= SAMPLES ? length : 0) });
      }
      // 마지막 땅 샘플부터 이어지게
      const land = S(from - dir);
      L.unshift({ ...land, rightB: land.rightB, up: land.up });
      const list = dir > 0 ? L : L.reverse();
      strip(list, [[-HW - 1.5, 0], [HW + 1.5, 0]], slipMat, { vScale: 6, surface: 'ground' });
      slipways.push({ land: S(from - dir), water: S(from + dir * 6), dir });
    }
  }

  // ---------------------------------------------------------------- 다리 (상판, 갓길)
  const DECK = HW + CURB + 1.2;
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.85, side: THREE.DoubleSide });
  const deckSideMats = {
    cable: new THREE.MeshStandardMaterial({ color: '#eef0f3', roughness: 0.7, side: THREE.DoubleSide }),
    viaduct: new THREE.MeshStandardMaterial({ color: '#d8cfc0', roughness: 0.85, side: THREE.DoubleSide }),
  };
  const bridgeRuns = runsOf((i) => !!samples[i].bridge).map(([a, b]) => ({ a, b, kind: S(a + 1).bridge }));
  for (const br of bridgeRuns) {
    const L = spanList(br.a, br.b);
    strip(L, [[-HW - CURB, 0.02], [-HW, 0.02]], curbBridgeMat, { vScale: 4, surface: 'ground' });
    strip(L, [[HW, 0.02], [HW + CURB, 0.02]], curbBridgeMat, { vScale: 4, surface: 'ground' });
    strip(L, [[-DECK, 0.01], [-HW - CURB, 0.01]], deckMat, { vScale: 6, surface: 'ground' });
    strip(L, [[HW + CURB, 0.01], [DECK, 0.01]], deckMat, { vScale: 6, surface: 'ground' });
    strip(L, [[-DECK - 0.3, 0.25], [-DECK - 0.3, -1.8], [DECK + 0.3, -1.8], [DECK + 0.3, 0.25]], deckSideMats[br.kind] || deckSideMats.cable, { vScale: 8, uScale: 4, shadow: true });
  }

  // ---------------------------------------------------------------- 지형 (해안선 + 섬 + 언덕, 도로 따라 다듬기)
  const LD = data.land || {};
  const coast = (LD.coast || []).map(([x, z]) => [x * SC, z * SC]);
  const discs = (LD.discs || []).map(([x, z, r]) => ({ x: x * SC, z: z * SC, r: r * SC }));
  const peaks = (LD.peaks || []).map(([x, z, h, r]) => ({ x: x * SC, z: z * SC, h, r: r * SC }));
  const steep = (LD.steep || []).map(([x, z, r, cw]) => ({ x: x * SC, z: z * SC, r: r * SC, cw }));
  const flats = (LD.flats || []).map(([x, z, r, y]) => ({ x: x * SC, z: z * SC, r: r * SC, y }));
  const BASE = LD.base ?? 3;
  /** 해안선 다각형까지 부호 있는 거리 (+ 땅 안쪽) */
  function coastField(x, z) {
    let f = -1e9;
    if (coast.length > 2) {
      let dmin = Infinity, inside = false;
      for (let i = 0, n = coast.length; i < n; i++) {
        const [ax, az] = coast[i], [bx, bz] = coast[(i + 1) % n];
        const vx = bx - ax, vz = bz - az;
        let w = ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
        w = w < 0 ? 0 : w > 1 ? 1 : w;
        const dx = x - ax - vx * w, dz = z - az - vz * w;
        const d = dx * dx + dz * dz;
        if (d < dmin) dmin = d;
        if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
      }
      f = inside ? Math.sqrt(dmin) : -Math.sqrt(dmin);
    }
    for (const c of discs) f = Math.max(f, c.r - Math.hypot(x - c.x, z - c.z));
    return f + noise(x / 70, z / 70, 3) * 10;
  }
  /** 도로 영향 없는 자연 지형 높이 */
  function natural(x, z) {
    const f = coastField(x, z);
    let st = 0, cw = 45;
    for (const s of steep) {
      const k = smooth(s.r, s.r * 0.55, Math.hypot(x - s.x, z - s.z));
      if (k > st) (st = k), (cw = THREE.MathUtils.lerp(45, s.cw, k));
    }
    if (f < 0) {
      // 바닷속: 모래사장 앞은 얕게, 절벽 앞은 깊게
      const slope = THREE.MathUtils.lerp(0.09, 0.9, st);
      return -Math.min(24, -f * slope + 0.3) + noise(x / 25, z / 25, 2) * 0.8;
    }
    let h = BASE + noise(x / 90, z / 90, 3) * 3 + noise(x / 21, z / 21, 2) * 0.7;
    for (const p of peaks) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r) h += p.h * Math.pow(0.5 + 0.5 * Math.cos((Math.PI * d) / p.r), 1.3) * (1 + 0.15 * noise(x / 16, z / 16, 2));
    }
    // 해안: 모래사장(완만, 처음 12 m는 거의 평평) 또는 절벽(가파름)
    const sand = 0.35 + 0.9 * smooth(0, cw, f);
    const k = smooth(0, cw, f);
    return Math.max(sand * (1 - k) + h * k, 0.25 * smooth(0, 3, f)) - (1 - smooth(0, 2.5, f)) * 0.5;
  }

  // 도로 샘플 해시 (가까운 도로 찾기용)
  const HASH = 20;
  const ckey = (a, b) => (a + 8192) * 16384 + (b + 8192);
  const hkey = (x, z) => ckey(Math.floor(x / HASH), Math.floor(z / HASH));
  const makeHash = (flag) => {
    const m = new Map();
    for (let i = 0; i < SAMPLES; i++) {
      const s = samples[i];
      if (!flag(s)) continue;
      const k = hkey(s.pos.x, s.pos.z);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return (x, z, r, fn) => {
      const x0 = Math.floor((x - r) / HASH), x1 = Math.floor((x + r) / HASH), z0 = Math.floor((z - r) / HASH), z1 = Math.floor((z + r) / HASH);
      for (let a = x0; a <= x1; a++)
        for (let b = z0; b <= z1; b++) {
          const list = m.get(ckey(a, b));
          if (list) for (const s of list) fn(s);
        }
    };
  };
  const landNear = makeHash((s) => s.land);
  const bridgeNear = makeHash((s) => !!s.bridge);
  const waterNear = makeHash((s) => s.water);
  const ROAD_BLEND = 34; // 도로 옆 지형이 도로 높이에서 자연 지형으로 바뀌는 거리 (m)

  /** 지형 높이 (도로·다리·물길 반영) */
  function terrainH(x, z) {
    const nat = natural(x, z);
    let nd = Infinity, ns = null, under = Infinity;
    landNear(x, z, HW + ROAD_BLEND + 6, (s) => {
      const dx = x - s.pos.x, dz = z - s.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < nd) (nd = d), (ns = s);
      if (d < HW + CURB + 2.5) {
        const l = (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z;
        under = Math.min(under, roadYAt(s, THREE.MathUtils.clamp(l, -HW - CURB, HW + CURB)));
      }
    });
    let H = nat;
    if (ns && nd < HW + CURB + 1) H = under - 0.3;
    else if (ns) {
      const l = (x - ns.pos.x) * ns.right.x + (z - ns.pos.z) * ns.right.z;
      const edgeY = roadYAt(ns, Math.sign(l) * (HW + CURB)) - 0.15;
      const k = smooth(HW + CURB + 1, HW + CURB + ROAD_BLEND, nd);
      H = edgeY * (1 - k) + nat * k;
      if (under < Infinity) H = Math.min(H, under - 0.1);
    }
    // 다리 아래: 상판보다 낮게
    bridgeNear(x, z, DECK + 16, (s) => {
      const dx = x - s.pos.x, dz = z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > DECK + 16) return;
      const l = dx * s.right.x + dz * s.right.z;
      const cap = roadYAt(s, THREE.MathUtils.clamp(l, -DECK, DECK)) - 2.2 + Math.max(0, d - DECK - 0.5) * 0.5;
      if (cap < H) H = cap;
    });
    // 물길: 물 아래로 파냄 (배가 모래톱에 걸리지 않게)
    waterNear(x, z, HW + 16, (s) => {
      const d = Math.hypot(x - s.pos.x, z - s.pos.z);
      const cap = THREE.MathUtils.lerp(-1.8, 99, smooth(HW + 3, HW + 16, d));
      if (cap < H) H = cap;
    });
    // 평평하게 할 곳 (항구 광장 등)
    for (const f of flats) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r + 20) H = THREE.MathUtils.lerp(f.y, H, smooth(f.r, f.r + 20, d));
    }
    return H;
  }

  // 격자: 코스 둘레 600 m까지 자세히
  const bb = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
  for (const s of lineSamples) bb.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
  bb.expandByScalar(LD.margin ?? 520);
  const gx0 = Math.floor(bb.min.x / CELL) * CELL, gz0 = Math.floor(bb.min.y / CELL) * CELL;
  const NX = Math.ceil((bb.max.x - gx0) / CELL), NZ = Math.ceil((bb.max.y - gz0) / CELL);
  const HG = new Float32Array((NX + 1) * (NZ + 1));
  const gi = (i, j) => j * (NX + 1) + i;
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) HG[gi(i, j)] = terrainH(gx0 + i * CELL, gz0 + j * CELL);

  /** 지형 높이 (격자 삼각형 그대로 → 보이는 메시와 정확히 같음). 격자 밖이면 null */
  function groundY(x, z) {
    const fi = (x - gx0) / CELL, fj = (z - gz0) / CELL;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return null;
    const u = fi - i, v = fj - j;
    const h00 = HG[gi(i, j)], h10 = HG[gi(i + 1, j)], h01 = HG[gi(i, j + 1)], h11 = HG[gi(i + 1, j + 1)];
    return u > v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
  /** 부드러운 면 방향 (격자 기울기를 겹선형 보간) */
  const gradAt = (i, j) => {
    const ic = THREE.MathUtils.clamp(i, 1, NX - 1), jc = THREE.MathUtils.clamp(j, 1, NZ - 1);
    return [(HG[gi(ic + 1, jc)] - HG[gi(ic - 1, jc)]) / (2 * CELL), (HG[gi(ic, jc + 1)] - HG[gi(ic, jc - 1)]) / (2 * CELL)];
  };
  function groundNormal(x, z, out = new THREE.Vector3()) {
    const fi = (x - gx0) / CELL, fj = (z - gz0) / CELL;
    const i = Math.floor(fi), j = Math.floor(fj);
    const u = fi - i, v = fj - j;
    const g00 = gradAt(i, j), g10 = gradAt(i + 1, j), g01 = gradAt(i, j + 1), g11 = gradAt(i + 1, j + 1);
    const gx = (g00[0] * (1 - u) + g10[0] * u) * (1 - v) + (g01[0] * (1 - u) + g11[0] * u) * v;
    const gz = (g00[1] * (1 - u) + g10[1] * u) * (1 - v) + (g01[1] * (1 - u) + g11[1] * u) * v;
    return out.set(-gx, 1, -gz).normalize();
  }
  /** 물 위로 나온 땅이면 높이, 아니면 null (gpCorners.js가 표지판 자리를 찾을 때 씀) */
  const heightAt = (x, z) => {
    const y = groundY(x, z);
    return y !== null && y > 0.15 ? y : null;
  };
  const fieldAt = (x, z) => {
    const y = groundY(x, z);
    return y === null ? -999 : y;
  };

  // 지형 메시 (보이기만 함: 충돌은 groundY로)
  const cSand = new THREE.Color('#e8d3a2'), cWetSand = new THREE.Color('#bfa77a'), cGrassA = new THREE.Color('#79b84e'), cGrassB = new THREE.Color('#a3c95b');
  const cGrassC = new THREE.Color('#5f9c45'), cRock = new THREE.Color('#a08670'), cRock2 = new THREE.Color('#7d6858'), cShoulder = new THREE.Color('#8a9a62');
  const cDry = new THREE.Color('#a8aa5e'), cSeaFloor = new THREE.Color('#c9b98a'), cDeepFloor = new THREE.Color('#5d7f7a'), cTmp = new THREE.Color();
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const nrm = new THREE.Vector3();
  function colorAt(x, y, z, ny) {
    const n1 = noise(x / 23, z / 23, 2);
    if (y < -0.15) {
      cTmp.copy(cSeaFloor).lerp(cDeepFloor, smooth(-0.5, -9, y));
    } else {
      cTmp.copy(cGrassA).lerp(n1 > 0 ? cGrassB : cGrassC, Math.min(1, Math.abs(n1) * 1.6));
      // 모래: 물가 낮은 곳 (해변 뒤쪽은 노이즈로 들쭉날쭉)
      // 높은 언덕은 지중해풍 마른 풀·올리브색
      cTmp.lerp(cDry, smooth(10, 26, y + n1 * 6) * 0.7);
      // 모래: 물가 낮은 곳 + 바닷가에서 가까운 띠 (해안선에서 떨어진 거리 coastField로, 노이즈로 들쭉날쭉)
      const f = coastField(x, z);
      const sandK = Math.max(smooth(2.4 + n1 * 0.8, 1.3, y), smooth(26 + n1 * 12, 9, f) * smooth(6, 3.5, y));
      cTmp.lerp(cSand, sandK);
      if (y < 0.45) cTmp.lerp(cWetSand, smooth(0.45, 0.05, y));
    }
    if (ny < 0.8) cTmp.lerp(ny < 0.6 ? cRock2 : cRock, smooth(0.8, 0.66, ny));
    return cTmp;
  }
  {
    for (let cj = 0; cj < NZ; cj += VCHUNK)
      for (let ci = 0; ci < NX; ci += VCHUNK) {
        const i1 = Math.min(NX, ci + VCHUNK), j1 = Math.min(NZ, cj + VCHUNK);
        let maxH = -Infinity;
        for (let j = cj; j <= j1; j++) for (let i = ci; i <= i1; i++) maxH = Math.max(maxH, HG[gi(i, j)]);
        if (maxH < -9) continue; // 깊은 바다: 물에 가려 안 보임
        const P = [], C = [];
        for (let j = cj; j < j1; j++)
          for (let i = ci; i < i1; i++) {
            const h00 = HG[gi(i, j)], h10 = HG[gi(i + 1, j)], h01 = HG[gi(i, j + 1)], h11 = HG[gi(i + 1, j + 1)];
            if (Math.max(h00, h10, h01, h11) < -9) continue;
            const x0 = gx0 + i * CELL, z0 = gz0 + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
            // groundY와 같은 대각선 (00-11)으로 나눔, 앞면이 위를 향하게
            const tris = [
              [x0, h00, z0, x1, h11, z1, x1, h10, z0],
              [x0, h00, z0, x0, h01, z1, x1, h11, z1],
            ];
            for (const T of tris) {
              const ax = T[3] - T[0], ay = T[4] - T[1], az = T[5] - T[2], bx = T[6] - T[0], by = T[7] - T[1], bz = T[8] - T[2];
              nrm.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx).normalize();
              if (nrm.y < 0) nrm.negate();
              const cx = (T[0] + T[3] + T[6]) / 3, cy = (T[1] + T[4] + T[7]) / 3, cz = (T[2] + T[5] + T[8]) / 3;
              const c = colorAt(cx, cy, cz, nrm.y);
              P.push(...T);
              for (let k = 0; k < 3; k++) C.push(c.r, c.g, c.b);
            }
          }
        if (!P.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, terrainMat);
        m.receiveShadow = true;
        m.userData.terrain = true;
        group.add(m);
      }
  }
  // 먼 땅 (격자 밖, 40 m 칸, 도로 영향 없음): 지평선까지 이어진 땅·바다 밑
  {
    const FC = 40, R0 = 3200;
    const P = [], C = [];
    const inFine = (x, z) => x > gx0 + FC && x < gx0 + NX * CELL - FC && z > gz0 + FC && z < gz0 + NZ * CELL - FC;
    const hf = (x, z) => (inFine(x, z) ? Math.min(natural(x, z), groundY(x, z) ?? 0) - 1.2 : natural(x, z) - 0.6);
    const n = Math.round((2 * R0) / FC);
    const H2 = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) H2[j * (n + 1) + i] = hf(-R0 + i * FC + bb.getCenter(new THREE.Vector2()).x, -R0 + j * FC + bb.getCenter(new THREE.Vector2()).y);
    const cx0 = bb.getCenter(new THREE.Vector2()).x - R0, cz0 = bb.getCenter(new THREE.Vector2()).y - R0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x0 = cx0 + i * FC, z0 = cz0 + j * FC, x1 = x0 + FC, z1 = z0 + FC;
        if (inFine(x0, z0) && inFine(x1, z1)) continue;
        const h00 = H2[j * (n + 1) + i], h10 = H2[j * (n + 1) + i + 1], h01 = H2[(j + 1) * (n + 1) + i], h11 = H2[(j + 1) * (n + 1) + i + 1];
        if (Math.max(h00, h10, h01, h11) < -9) continue;
        for (const T of [[x0, h00, z0, x1, h11, z1, x1, h10, z0], [x0, h00, z0, x0, h01, z1, x1, h11, z1]]) {
          const c = colorAt((T[0] + T[3] + T[6]) / 3, (T[1] + T[4] + T[7]) / 3, (T[2] + T[5] + T[8]) / 3, 0.95);
          P.push(...T);
          for (let k = 0; k < 3; k++) C.push(c.r, c.g, c.b);
        }
      }
    if (P.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      geo.computeVertexNormals();
      group.add(new THREE.Mesh(geo, terrainMat));
    }
  }

  // ---------------------------------------------------------------- 바다 (보이는 물: 깊이 텍스처로 색)
  const depthData = new Uint8Array((NX + 1) * (NZ + 1));
  for (let k = 0; k < depthData.length; k++) depthData[k] = Math.round(THREE.MathUtils.clamp(-HG[k] / 26, 0, 1) * 255);
  const depthTex = new THREE.DataTexture(depthData, NX + 1, NZ + 1, THREE.RedFormat, THREE.UnsignedByteType);
  // 한 줄 너비(NX+1)가 4의 배수가 아니라서 1바이트 정렬로 읽어야 함 (안 그러면 물 색이 계단처럼 깨짐)
  depthTex.unpackAlignment = 1;
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;
  const seaMat = seaMaterial(depthTex, gx0 - CELL / 2, gz0 - CELL / 2, (NX + 1) * CELL, (NZ + 1) * CELL);
  const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), seaMat);
  seaMesh.position.set(bb.getCenter(new THREE.Vector2()).x, 0, bb.getCenter(new THREE.Vector2()).y);
  seaMesh.receiveShadow = false;
  seaMesh.renderOrder = -1;
  group.add(seaMesh);

  // ---------------------------------------------------------------- 가드레일 (절벽 쪽, 바닷가 쪽, 다리 양쪽)
  const BRIDGE_EXT = Math.round((45 / length) * SAMPLES);
  const RAIL_FLARE = 7;
  const nearBridge = new Float32Array(SAMPLES).fill(1e9);
  const nearWater = new Float32Array(SAMPLES).fill(1e9);
  for (const [arr, flag] of [[nearBridge, (s) => !!s.bridge], [nearWater, (s) => s.water]]) {
    for (let pass = 0; pass < 2; pass++)
      for (let n = 0; n < SAMPLES; n++) {
        const i = pass ? SAMPLES - 1 - n : n;
        if (flag(samples[i])) arr[i] = 0;
        else arr[i] = Math.min(arr[i], arr[wrapI(i + (pass ? 1 : -1))] + 1);
      }
    for (let n = 0; n < SAMPLES; n++) arr[n] = Math.min(arr[n], arr[wrapI(n - 1)] + 1);
    for (let n = SAMPLES - 1; n >= 0; n--) arr[n] = Math.min(arr[n], arr[wrapI(n + 1)] + 1);
  }
  const SLIP_CLEAR = mS(55); // 선착장 앞뒤 55 m는 난간 없음 (물로 들어가는 길)
  const railSide = [-1, 1].map((side) => {
    const need = new Uint8Array(SAMPLES);
    const p = new THREE.Vector3();
    for (let i = 0; i < SAMPLES; i++) {
      const s = samples[i];
      if (s.water || nearWater[i] < SLIP_CLEAR || inNoRail(i, side)) continue;
      if (s.bridge) need[i] = 1;
      else {
        let edge = false;
        for (const l of [HW + 6, HW + 10]) {
          surf(s, side * l, 0, p);
          const y = groundY(p.x, p.z);
          if (y === null || y < 0.3 || y < s.pos.y - 3.2) edge = true; // 바다 또는 낭떠러지
        }
        need[i] = edge ? 1 : 0;
      }
    }
    const fill = (val, maxLen) => {
      let i = 0;
      while (i < SAMPLES) {
        if (need[i] === val) {
          let j = i;
          while (j < i + SAMPLES && need[wrapI(j)] === val) j++;
          if (j - i < maxLen) for (let k = i; k < j; k++) if (!samples[wrapI(k)].water && nearWater[wrapI(k)] >= SLIP_CLEAR) need[wrapI(k)] = 1 - val;
          i = j;
        } else i++;
      }
    };
    for (let i = 0; i < SAMPLES; i++) {
      if (need[i] || nearBridge[i] > BRIDGE_EXT || samples[i].water || nearWater[i] < SLIP_CLEAR) continue;
      if (inNoRail(i, side)) continue;
      const ts = turnSign[i];
      if (Math.abs(ts) > 0.15 && side === (ts > 0 ? -1 : 1)) continue;
      need[i] = 1;
    }
    fill(0, 14);
    fill(1, 8);
    return need;
  });
  function railLatAt(s) {
    if (s.bridge) return DECK;
    const nb = nearBridge[s.i];
    const base = THREE.MathUtils.lerp(DECK, HW + CURB + 1.6, Math.min(1, nb / (BRIDGE_EXT * 0.4)));
    return base + (nb <= BRIDGE_EXT ? RAIL_FLARE * smooth(BRIDGE_EXT * 0.5, BRIDGE_EXT, nb) : 0);
  }
  function railLimit(near) {
    const side = near.lateral < 0 ? 0 : 1;
    if (!railSide[side][near.index]) return null;
    return railLatAt(near.sample);
  }
  const railMat = new THREE.MeshStandardMaterial({ color: '#e6e9ee', metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  const railBlueMat = new THREE.MeshStandardMaterial({ color: '#2e8fd8', roughness: 0.5, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const posts = [];
  const railRuns = [];
  for (const [n, side] of [[0, -1], [1, 1]]) {
    const need = railSide[n];
    for (const [a, b] of runsOf((i) => need[i] === 1)) {
      const L = spanList(a, b);
      const lat = (s) => side * railLatAt(s);
      strip(L, (s) => [[lat(s), 0.62], [lat(s), 1.0]], railMat, { vScale: 4 });
      strip(L, (s) => [[lat(s), 0.36], [lat(s), 0.56]], railBlueMat, { vScale: 4 });
      for (const m of strip(L, (s) => [[lat(s), -0.6], [lat(s), 1.5]], wallMat, { surface: 'barrier' })) m.visible = false;
      const stepN = Math.max(1, Math.round((3.2 / length) * SAMPLES));
      for (let k = 0; k < L.length; k += stepN) {
        const s = L[k];
        const p = surf(s, lat(s) + side * 0.12, 0);
        posts.push({ x: p.x, y: p.y, z: p.z, ry: Math.atan2(s.tan.x, s.tan.z) });
      }
      railRuns.push({ side, a, b });
    }
  }
  // 레일 아래 갓길: 연석 끝 ~ 레일 바깥까지 도로 높이의 포장면 (6 m 격자 지형이 절벽 쪽으로 처져서 연석과 레일 사이에 0.8 m 도랑이 생겼고,
  //   봇이 그 도랑에 바퀴가 빠져 멈췄음)
  const shoulderMat = new THREE.MeshStandardMaterial({ color: '#b9ad9a', roughness: 0.95 });
  for (const [n, side] of [[0, -1], [1, 1]]) for (const [a, b] of runsOf((i) => railSide[n][i] === 1 && !samples[i].bridge)) {
    // (다리 구간은 따로 끊음: 예전엔 다리 샘플만 빼고 이어서 다리 앞뒤를 잇는 긴 띠가 도로를 가로질렀음)
    const L = spanList(a, b);
    if (L.length < 2) continue;
    const inner = (s) => HW + kerbAt(s.i, side), outer = (s) => Math.max(inner(s) + 0.3, railLatAt(s) + 0.6);
    strip(L, (s) => (side < 0 ? [[-outer(s), 0.01], [-inner(s), 0.01]] : [[inner(s), 0.01], [outer(s), 0.01]]), shoulderMat, { vScale: 6, surface: 'ground' });
  }
  // 레이싱 라인 다시: 레일이 있는 쪽은 레일 2.4 m 안쪽까지만
  {
    let capped = 0;
    for (const n of [0, 1])
      for (let i = 0; i < SAMPLES; i++)
        if (railSide[n][i] && !samples[i].bridge) (railCap[n][i] = railLatAt(samples[i]) - 2.4), capped++;
    if (capped) racingLine = computeRacingLine(lineSamples, lineLimit, length, lineOpts);
  }
  // 코너 탈출 바깥 포장 런오프 (F1 서킷처럼): 빠르게 나가다 연석 밖으로 밀려도 잔디에 빠져 멈추지 않게
  //   레이싱 라인이 연석까지 쓰는 탈출 구간(에이펙스 +4~+75 m 바깥)을 연석 끝에서 5.5 m 더 포장. 레일 쪽·다리·물·선착장 근처는 빼고
  const RUNOFF_W = 5.5; // (풍경 물체는 연석 2.8 m + 4~5 m 밖이라 겹치지 않음)
  const runoffW = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
  const addRunoff = (n, i0, i1, wMax, ramp) => {
    for (let i = i0; i <= i1; i++) {
      const q = wrapI(i), sm = samples[q];
      if (sm.water || sm.bridge || railSide[n][q] || nearWater[q] < SLIP_CLEAR + 4 || nearBridge[q] < BRIDGE_EXT) continue;
      runoffW[n][q] = Math.max(runoffW[n][q], wMax * smooth(0, ramp, i - i0) * smooth(0, ramp, i1 - i));
    }
  };
  for (const ap of racingLine.apexes) {
    if (ap.radius > 150) continue;
    addRunoff(sideI(-ap.side), ap.i + mS(4), ap.i + mS(75), RUNOFF_W, mS(14)); // 탈출 바깥
    addRunoff(sideI(ap.side), ap.i - mS(40), ap.i + mS(30), 4, mS(10)); // 에이펙스 안쪽 (연석을 넘어 안쪽을 자른 차도 잔디에 안 걸림)
  }
  const runoffMat = new THREE.MeshStandardMaterial({ color: '#8f8a84', roughness: 0.95 });
  for (const [n, side] of [[0, -1], [1, 1]]) {
    for (const [a, b] of runsOf((i) => runoffW[n][i] > 0.05)) {
      const L = spanList(a - 1, b + 1);
      const inner = (s) => HW + kerbAt(s.i, side), outer = (s) => inner(s) + runoffW[n][wrapI(s.i)];
      strip(L, (s) => (side < 0 ? [[-outer(s), -0.12], [-inner(s), 0.0]] : [[inner(s), 0.0], [outer(s), -0.12]]), runoffMat, { vScale: 12, surface: 'ground' });
    }
  }
  if (posts.length) {
    const postIm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.15, 0.16).translate(0, 0.52, 0), new THREE.MeshStandardMaterial({ color: '#7d8590', metalness: 0.5, roughness: 0.5 }), posts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    posts.forEach((p, i) => postIm.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(UP, p.ry), new THREE.Vector3(1, 1, 1))));
    postIm.castShadow = true;
    group.add(postIm);
  }

  // 바다 동굴 (data.caves [{p0, p1}]): 물길 양옆 보이지 않는 바위 벽 (보이는 바위는 seaScenery.js)
  const caves = (data.caves || []).map((c) => {
    const [a, b] = rangeP(c.p0, c.p1);
    const L = spanList(a, b);
    const half = HW + (c.room ?? 4);
    for (const side of [-1, 1]) for (const m of strip(L, () => [[side * half, -2], [side * half, 12]], wallMat, { surface: 'barrier' })) m.visible = false;
    return { a, b, list: L, half, height: c.height ?? 13, name: c.name };
  });

  // ---------------------------------------------------------------- 출발선
  const s0 = samples[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  line.material.map.repeat.set(W / 4, 1);
  {
    const x = new THREE.Vector3().crossVectors(s0.tan3, s0.up);
    line.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, s0.tan3, s0.up));
  }
  line.position.copy(s0.pos).addScaledVector(s0.up, 0.04);
  group.add(line);

  // ---------------------------------------------------------------- 파도 점프대 (물 면: 배 모드 그대로 뛰어오름)
  const waveMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05, emissive: '#0c4a66', emissiveIntensity: 0.2, side: THREE.DoubleSide });
  const waves = [];
  for (const f of data.features || []) {
    if (f.type !== 'wave') continue;
    const s = sampleAt(tOfP(f.p));
    const len = f.length || 16, h = f.height || 1.6, w = f.width || 12;
    // 단면: 앞쪽은 완만한 곡선으로 올라가고 끝에서 뚝 떨어짐
    const n = 14, P = [], idx = [];
    const prof = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      prof.push([u * len, h * Math.pow(u, 1.6)]);
    }
    // (뒤쪽 뚝 떨어지는 면은 밟는 면에서 뺌: 넣으면 차가 꼭대기에서 그 수직 면에 붙어 옆으로 넘어졌음 → 아래 back 메시로 보이기만)
    const cols = prof.length;
    // 폭 방향으로 여러 줄: 양 끝으로 갈수록 낮아져 물속으로 자연스럽게 사라짐 (네모난 판처럼 안 보이게)
    const NXW = 10, CC = [];
    const cLow = new THREE.Color('#1d7f9c'), cHigh = new THREE.Color('#8fe9f5'), cTop = new THREE.Color('#e9fbff'), cc = new THREE.Color();
    for (let r = 0; r <= NXW; r++) {
      const x = (r / NXW - 0.5) * w;
      const side = 1 - Math.pow(Math.abs(x) / (w / 2), 3);
      for (const [d, y] of prof) {
        const yy = y > 0 ? y * (0.25 + 0.75 * side) : y;
        P.push(x, yy, d - len);
        const k = THREE.MathUtils.clamp(yy / h, 0, 1);
        cc.copy(cLow).lerp(cHigh, k);
        if (k > 0.82) cc.lerp(cTop, (k - 0.82) / 0.18);
        CC.push(cc.r, cc.g, cc.b);
      }
    }
    for (let r = 0; r < NXW; r++)
      for (let k = 0; k < cols - 1; k++) {
        const A = r * cols + k, B = A + 1, C = A + cols, D = C + 1;
        idx.push(A, C, B, B, C, D);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(CC, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, waveMat);
    {
      // 뒤쪽 떨어지는 면 (보이기만): 꼭대기 줄 → 물속
      const BP = [], BI = [], BC = [];
      for (let r = 0; r <= NXW; r++) {
        const top = P.slice((r * cols + cols - 1) * 3, (r * cols + cols - 1) * 3 + 3);
        BP.push(top[0], top[1], top[2], top[0], -0.6, top[2] + 0.4);
        BC.push(cTop.r, cTop.g, cTop.b, cLow.r, cLow.g, cLow.b);
        if (r < NXW) BI.push(r * 2, r * 2 + 1, r * 2 + 2, r * 2 + 2, r * 2 + 1, r * 2 + 3);
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(BP, 3));
      bg.setAttribute('color', new THREE.Float32BufferAttribute(BC, 3));
      bg.setIndex(BI);
      bg.computeVertexNormals();
      m.add(new THREE.Mesh(bg, waveMat));
    }
    const p = surf(s, f.offset || 0, 0);
    m.position.set(p.x, -0.02, p.z);
    m.rotation.y = Math.atan2(s.tan.x, s.tan.z);
    m.updateMatrixWorld();
    addGround(m, 'water');
    waves.push({ mesh: m, s, len, h, w, offset: f.offset || 0 });
  }

  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- 찾기, 충돌
  function nearest(pos) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const p = samples[i].pos;
      const dy = p.y - pos.y;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2 + 3 * dy * dy;
      if (d < best) (best = d), (bi = i);
    }
    const s = samples[bi];
    const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    const lateral = dx * s.right.x + dz * s.right.z;
    return { index: bi, t: bi / SAMPLES, sample: s, dist: Math.hypot(dx, dz), lateral };
  }
  function nearestRaw(p) {
    let best = Infinity;
    for (let i = 0; i < SAMPLES; i += 2) {
      const q = samples[i].pos;
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  const raycaster = new THREE.Raycaster();
  const tri = new THREE.Triangle();
  const bary = new THREE.Vector3();
  const local = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const origin2 = new THREE.Vector3();
  let lastSampled = null;
  /** 지형 광선: 0.5 m씩 나아가다 땅 아래로 들어가면 이분법으로 정확히 */
  function terrainRay(o, d, far) {
    // 잘못된 값(NaN)이 들어오면 아래 반복이 끝나지 않으므로 바로 끝냄
    if (!(far > 0) || !Number.isFinite(o.x + o.y + o.z + d.x + d.y + d.z) || far > 1e5) return null;
    const yAt = (t) => {
      const g = groundY(o.x + d.x * t, o.z + d.z * t);
      return g === null ? -1e9 : o.y + d.y * t - g;
    };
    let prev = 0, fp = yAt(0);
    if (fp < -0.05) return null; // 이미 땅속에서 쏨
    const stepL = Math.abs(d.y) > 0.9 ? Math.max(0.5, far) : 0.5;
    for (let t = Math.min(stepL, far); ; t = Math.min(t + stepL, far)) {
      const f = yAt(t);
      if (f <= 0) {
        let a = prev, b = t;
        for (let k = 0; k < 18; k++) {
          const m = (a + b) / 2;
          if (yAt(m) > 0) a = m;
          else b = m;
        }
        return b;
      }
      prev = t;
      fp = f;
      if (t >= far) return null;
    }
  }
  function castRay(origin, dir, far) {
    // 차를 코스에 놓을 때(placeAt)는 높이 30에서 아래로 쏩니다 → 방금 고른 코스 지점 바로 위에서 쏘게 (다리 아래·절벽 위 모두 맞게)
    if (origin.y === 30 && far === 60 && dir.y === -1 && lastSampled && Math.hypot(origin.x - lastSampled.pos.x, origin.z - lastSampled.pos.z) < 25) {
      origin = origin2.set(origin.x, lastSampled.pos.y + 6, origin.z);
      far = 40;
    }
    return addTerrainAndSea(origin, dir, far, meshRay(origin, dir, far));
  }
  /** 도로·다리·경사로 같은 땅 메시만 검사 */
  function meshRay(origin, dir, far) {
    let best = null;
    raycaster.set(origin, dir);
    raycaster.near = 0;
    raycaster.far = far;
    for (const hit of raycaster.intersectObjects(groundMeshes, false)) {
      if (hit.distance < 1e-4) continue;
      const obj = hit.object;
      const nAttr = obj.geometry.attributes.normal;
      local.copy(hit.point);
      obj.worldToLocal(local);
      const { a, b, c } = hit.face;
      tri.setFromAttributeAndIndices(obj.geometry.attributes.position, a, b, c);
      tri.getBarycoord(local, bary);
      const n = new THREE.Vector3().fromBufferAttribute(nAttr, a).multiplyScalar(bary.x);
      n.add(tmp.fromBufferAttribute(nAttr, b).multiplyScalar(bary.y));
      n.add(tmp.fromBufferAttribute(nAttr, c).multiplyScalar(bary.z));
      if (n.lengthSq() < 1e-8) n.copy(hit.face.normal);
      normalMatrix.getNormalMatrix(obj.matrixWorld);
      n.applyMatrix3(normalMatrix).normalize();
      if (n.dot(dir) > 0) n.negate();
      best = { point: hit.point, normal: n, surface: obj.userData.surface, distance: hit.distance };
      break;
    }
    return best;
  }
  /** 메시 결과(best)에 계산식 지형과 바다 면(높이 0)을 더해 가장 가까운 것 */
  function addTerrainAndSea(origin, dir, far, best) {
    const lim = best ? best.distance : far;
    // 지형
    const tt = terrainRay(origin, dir, lim);
    if (tt !== null && tt < lim) {
      const p = origin.clone().addScaledVector(dir, tt);
      const n = groundNormal(p.x, p.z);
      if (n.dot(dir) > 0) n.negate();
      best = { point: p, normal: n, surface: 'ground', distance: tt };
    }
    // 바다 면 (높이 0)
    if (dir.y < -1e-4 && origin.y > 0) {
      const tw = origin.y / -dir.y;
      if (tw < (best ? best.distance : far)) {
        const p = origin.clone().addScaledVector(dir, tw);
        p.y = 0;
        best = { point: p, normal: UP.clone(), surface: 'water', distance: tw };
      }
    }
    return best;
  }

  const boostPadAt = () => null;
  const onAltPath = () => false;
  const onShortcut = () => false;
  const shortcutDist = () => Infinity;
  function isOnRoad(pos, near = nearest(pos)) {
    if (near.sample.water) return near.dist < HW + 1;
    return near.dist < HW + kerbAt(near.index, near.lateral < 0 ? -1 : 1);
  }
  function edgeInfo(pos, near = nearest(pos)) {
    // 선착장 콘크리트 위: 도로처럼
    if (near.sample.water || nearWater[near.index] < 6) return { kerb: 0, off: 0, runoff: true };
    const k = kerbAt(near.index, near.lateral < 0 ? -1 : 1);
    const sd = near.lateral < 0 ? 0 : 1;
    // 다리 위와 레일 아래 포장 갓길은 포장 런오프 (잔디처럼 많이 느려지지 않음)
    return { ...edgeFraction(near.dist, HW, HW + k), runoff: !!near.sample.bridge || !!railSide[sd][near.index] || (runoffW[sd][near.index] > 0.5 && near.dist < HW + k + runoffW[sd][near.index]) };
  }

  const outline = samples.filter((_, i) => i % 6 === 0 && i < SAMPLES).map((s) => [s.pos.x, s.pos.z]);
  const waterRanges = waterRuns.map(([a, b]) => ({ t0: (a % SAMPLES) / SAMPLES, t1: (b % SAMPLES) / SAMPLES, length: ((b - a) / SAMPLES) * length }));
  const isWaterT = (t) => !!sampleAt(t).water;
  const inSea = (x, z, r = 0) => {
    const y = groundY(x, z);
    return y === null || y < -0.3 - r * 0.05;
  };

  function animate(time) {
    seaMat.uniforms.uTime.value = time;
  }
  /** 카메라가 물속인가 (아래에서 본 물 색) */
  function setUnderwater(on) {
    seaMat.uniforms.uUnder.value = on ? 1 : 0;
  }
  const sampleAtTracked = (t) => (lastSampled = sampleAt(t));
  const buildMs = Math.round(performance.now() - buildT0);

  const api = {
    data, width: W, length, samples, sampleAt: sampleAtTracked, nearest, nearestRaw, boostPadAt, animate, outline,
    shortcut: null, shortcutDist, onShortcut, isOnRoad, edgeInfo, racingLine, lineY, kerbWidth: CURB, kerbAt, group, groundMeshes,
    arena: false, pad: null, inPad: () => false, spawn: null,
    sea: { level: 0 }, inSea, waterRanges, isWaterT, buoys: [],
    // gpCorners.js(코너 표지판·에이펙스 불빛)를 쓰려면 grandprix 모양의 API가 필요
    grandprix: true, seaside: true, surf, roadYAt, heightAt, fieldAt, groundY, groundNormal, natural, coastField, railRuns, railSide, railLimit, deckHalf: DECK, curb: CURB,
    runway: null, apron: null, plank: null, rings: [], skyPath: [], inSkyCorridor: () => false, onAltPath, altPaths: [], indexAt, S, spanList, noise,
    dimension: null, setWorld() {}, inSpace: false,
    tOfP, pointT, bridgeRuns, waterRuns, slipways, caves, waves, seaMat, setUnderwater, grid: { gx0, gz0, NX, NZ, CELL, HG },
    buildMs, sampleCount: SAMPLES,
  };
  // castRay: 봇용 빠른 레이(fastTrack.js)는 Object.create(track) 위에 castRay를 새로 넣는데, 그 레이는 땅 메시만 봐서
  //   이 맵의 계산식 지형·바다 면을 못 찾음 (차가 길 밖 땅을 뚫고 떨어졌음). 그래서 castRay를 '받는 쪽'(setter)으로 만들어,
  //   새로 넣는 함수를 메시 레이로 쓰고 그 뒤에 지형·바다 검사를 붙인 함수로 바꿔 끼움 → 빠르면서 결과도 같음
  Object.defineProperty(api, 'castRay', {
    enumerable: true,
    configurable: true,
    get() {
      return (this !== api && this.__seaRay) || castRay;
    },
    set(fn) {
      if (this === api) return;
      // (placeAt 레이(높이 30에서 60 m)는 fastTrack이 원래 castRay로 넘기므로 그 결과 그대로)
      const ray = (o, d, f) => (o.y === 30 && f === 60 ? fn.call(this, o, d, f) : addTerrainAndSea(o, d, f, fn.call(this, o, d, f)));
      Object.defineProperty(this, '__seaRay', { value: ray, writable: true, configurable: true });
    },
  });
  return api;
}
