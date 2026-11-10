// 화산 지대 풍경용 부품 모음 (volcanoScenery.js가 씀)
//   - 빌보드 구름(billboardCloud): 연기·김·빛 덩어리 수백 개를 "그림 호출 1번"으로 그리는 판 묶음 (늘 카메라를 봄)
//   - 하늘 돔 재질(skyMaterial): 붉은 저녁 하늘 + 화산재 구름 + 재 너머 해 + 화산 쪽 붉은 빛
//   - 안개를 덜 받는 Lambert 재질(hazeLambert): 먼 화산이 안개에 완전히 묻히지 않게, 분화구 쪽은 스스로 빛남(glow 속성)
//   - 모양: 울퉁불퉁한 바위, 현무암 기둥(육각), 불탄 나무
//   - 그림(캔버스 텍스처): 연기, 빛, 용암 균열, 유황 얼룩, 경고판 글자, 쉐브론, 깃발, 창문
import * as THREE from 'three';
import { canvasTexture, seededRandom, makeNoise } from './volcanoTrack.js';

const TAU = Math.PI * 2;
export const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif';

// ---------------------------------------------------------------- 빌보드 구름
const BB_VS = /* glsl */ `
attribute vec3 iPos;
attribute float iSize;
attribute float iRot;
attribute vec4 iCol;
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vCol = iCol;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iRot), s = sin(iRot);
  vec2 p = position.xy * iSize;
  mvPosition.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const BB_FS = /* glsl */ `
uniform sampler2D map;
uniform float fogAmt;
uniform float gain;
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(t.rgb * vCol.rgb * gain, t.a * vCol.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // 안개는 three.js 기본 재질처럼 색 공간 변환 뒤에 섞음 (fogColor가 화면 색 공간 값이라)
  #ifdef USE_FOG
    float ff = smoothstep(fogNear, fogFar, vFogDepth) * fogAmt;
    #ifdef ADDITIVE
      gl_FragColor.rgb *= (1.0 - ff);
    #else
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
    #endif
  #endif
}`;
/**
 * 카메라를 늘 바라보는 판 n장을 한 번에 그림 (InstancedBufferGeometry + 작은 셰이더)
 *   set(i, x, y, z, 크기, 회전, 색(THREE.Color), 투명도) 로 하나씩 바꾸고 flush()로 GPU에 보냄
 */
export function billboardCloud(n, { map, additive = false, fogAmt = 1, name = 'volcanoBillboards', toneMapped = !additive, renderOrder = 0, depthTest = true } = {}) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(base.index);
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  const pos = new Float32Array(n * 3), size = new Float32Array(n), rot = new Float32Array(n), col = new Float32Array(n * 4);
  const aPos = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.InstancedBufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const aRot = new THREE.InstancedBufferAttribute(rot, 1).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.InstancedBufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', aPos);
  g.setAttribute('iSize', aSize);
  g.setAttribute('iRot', aRot);
  g.setAttribute('iCol', aCol);
  g.instanceCount = n;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, fogAmt: { value: fogAmt }, gain: { value: 1 } }]);
  uniforms.map.value = map;
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: BB_VS, fragmentShader: BB_FS, transparent: true, depthWrite: false, depthTest, fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, defines: additive ? { ADDITIVE: 1 } : {},
  });
  mat.toneMapped = toneMapped;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.name = name; // 이름이 있으면 staticBatch.js가 건드리지 않음 (움직이는 물체)
  mesh.renderOrder = renderOrder;
  return {
    mesh, mat, count: n, pos, size, rot, col,
    set(i, x, y, z, s, r, c, a) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      size[i] = s;
      rot[i] = r;
      col[i * 4] = c.r;
      col[i * 4 + 1] = c.g;
      col[i * 4 + 2] = c.b;
      col[i * 4 + 3] = a;
    },
    alpha(i, a) {
      col[i * 4 + 3] = a;
    },
    flush() {
      aPos.needsUpdate = aSize.needsUpdate = aRot.needsUpdate = aCol.needsUpdate = true;
    },
    /** 카메라에서 먼 것부터 그리도록 순서 바꾸기 (연기 기둥처럼 겹치는 반투명) — 처음 m개만 */
    sortFrom(cam, m = n) {
      const idx = [];
      for (let i = 0; i < m; i++) idx.push([i, (pos[i * 3] - cam.x) ** 2 + (pos[i * 3 + 1] - cam.y) ** 2 + (pos[i * 3 + 2] - cam.z) ** 2]);
      idx.sort((a, b) => b[1] - a[1]);
      const p2 = pos.slice(0, m * 3), s2 = size.slice(0, m), r2 = rot.slice(0, m), c2 = col.slice(0, m * 4);
      idx.forEach(([i], k) => {
        pos.set(p2.subarray(i * 3, i * 3 + 3), k * 3);
        size[k] = s2[i];
        rot[k] = r2[i];
        col.set(c2.subarray(i * 4, i * 4 + 4), k * 4);
      });
    },
  };
}

// ---------------------------------------------------------------- 하늘 돔
export function skyMaterial({ fogColor, sunDir, volDir }) {
  const C = (h) => new THREE.Color(h);
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cTop: { value: C('#0f0607') }, cMid: { value: C('#3a140d') }, cHor: { value: fogColor },
      cGlow: { value: C('#ff4210') }, glowAmt: { value: 1 },
      cSun: { value: C('#ffb45e') }, cCloud: { value: C('#170c0b') }, cCloudLit: { value: C('#7a2c16') },
      sunDir: { value: sunDir.clone().normalize() }, volDir: { value: volDir.clone().setY(0).normalize() }, time: { value: 0 },
      fogSRGB: { value: fogColor.clone().convertLinearToSRGB() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 cTop, cMid, cHor, cGlow, cSun, cCloud, cCloudLit, sunDir, volDir, fogSRGB;
      uniform float time, glowAmt;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vnoise(vec3 x) {
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // 위로 갈수록 어두운 붉은 밤하늘, 지평선은 안개 색 (먼 산과 이어지게)
        vec3 col = mix(cHor, cMid, smoothstep(0.0, 0.2, h));
        col = mix(col, cTop, smoothstep(0.18, 0.75, h));
        // 화산 쪽 지평선이 붉게 달아오름
        vec2 hd = normalize(d.xz + 1e-5);
        float vg = max(dot(hd, volDir.xz), 0.0);
        col += cGlow * glowAmt * pow(vg, 5.0) * exp(-max(h, 0.0) * 6.0) * 0.55;
        // 화산재 구름 (평평한 구름층에 비춘 모양, 천천히 흐름)
        float cl = 0.0;
        if (h > -0.04) {
          vec2 uv = d.xz / (h + 0.14);
          float n = fbm(vec3(uv * 1.1 + vec2(time * 0.006, time * 0.0025), time * 0.004));
          cl = smoothstep(0.40, 0.72, n) * smoothstep(-0.04, 0.1, h);
          vec3 cc = mix(cCloudLit + cGlow * glowAmt * pow(vg, 4.0) * 0.25, cCloud, smoothstep(0.02, 0.45, h));
          col = mix(col, cc, cl * 0.82);
        }
        // 재 너머로 흐릿하게 보이는 해
        float sd = max(dot(d, sunDir), 0.0);
        col += cSun * (pow(sd, 1800.0) * 1.1 + pow(sd, 120.0) * 0.2 + pow(sd, 8.0) * 0.07) * (1.0 - cl * 0.8);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // 지평선 근처·아래는 먼 산의 안개 색과 똑같이 (안개는 화면 색 공간에서 섞이므로 여기서)
        float hz = smoothstep(0.16, -0.01, h) * (1.0 - cl * 0.5);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogSRGB + cGlow * glowAmt * pow(vg, 5.0) * 0.18, hz);
      }`,
  });
}

/**
 * 안개를 fogScale만큼만 받는 Lambert 재질 (먼 화산이 안개에 묻히지 않게)
 *   꼭짓점 속성 glow(0~1)가 있으면 그만큼 주황으로 스스로 빛남 (분화구·용암 근처)
 */
export function hazeLambert({ fogScale = 1, glowColor = '#ff5a14', glowGain = 1.6, ...opts } = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });
  const gc = new THREE.Color(glowColor).multiplyScalar(glowGain);
  m.userData.fogScale = { value: fogScale };
  m.userData.glowColor = { value: gc };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.fogScale = m.userData.fogScale;
    sh.uniforms.glowColor = m.userData.glowColor;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float fogScale;\nuniform vec3 glowColor;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * glowColor;')
      .replace(
        '#include <fog_fragment>',
        '#ifdef USE_FOG\n float fogFactor = smoothstep(fogNear, fogFar, vFogDepth) * fogScale;\n gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'volcanoHaze';
  return m;
}

// ---------------------------------------------------------------- 모양
/** 울퉁불퉁한 바위 (원점 = 가운데, 반지름 약 1) */
export function rockGeo(seed, detail = 1, flat = 0.72) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const nz = makeNoise(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + nz(v.x * 1.7, v.y * 1.7 + v.z, 2) * 0.4;
    v.multiplyScalar(k);
    v.y *= flat;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** 현무암 기둥: 육각 기둥 (바닥 = 0, 높이 1, 반지름 1), 윗면은 밝게 (꼭짓점 색) */
export function basaltColumnGeo() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1).toNonIndexed();
  g.translate(0, 0.5, 0);
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const top = n.getY(i) > 0.9;
    const y = p.getY(i);
    const c = top ? [0.62, 0.55, 0.5] : y > 0.5 ? [0.38, 0.34, 0.32] : [0.26, 0.22, 0.21];
    col.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 불탄 나무: 굽은 줄기 + 가지 3~4개 (바닥 = 0, 높이 약 6 m) */
export function deadTreeGeo(seed) {
  const r = seededRandom(seed);
  const parts = [];
  const seg = (a, b, r0, r1) => {
    const d = b.clone().sub(a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    parts.push(g.toNonIndexed());
  };
  const p0 = new THREE.Vector3(0, -0.5, 0);
  const p1 = new THREE.Vector3((r() - 0.5) * 0.6, 2.6, (r() - 0.5) * 0.6);
  const p2 = p1.clone().add(new THREE.Vector3((r() - 0.5) * 1.2, 2.6 + r(), (r() - 0.5) * 1.2));
  seg(p0, p1, 0.32, 0.22);
  seg(p1, p2, 0.22, 0.06);
  const nb = 3 + Math.floor(r() * 2);
  for (let k = 0; k < nb; k++) {
    const from = p1.clone().lerp(p2, 0.15 + r() * 0.7);
    const a = r() * TAU;
    const L = 1.2 + r() * 1.8;
    const to = from.clone().add(new THREE.Vector3(Math.cos(a) * L, 0.6 + r() * 1.4, Math.sin(a) * L));
    seg(from, to, 0.1, 0.03);
    if (r() < 0.6) {
      const a2 = a + (r() - 0.5) * 1.6;
      seg(to, to.clone().add(new THREE.Vector3(Math.cos(a2) * 0.9, 0.5 + r() * 0.6, Math.sin(a2) * 0.9)), 0.04, 0.015);
    }
  }
  const out = mergeSimple(parts);
  out.computeVertexNormals();
  return out;
}

/** 위치·노멀(·uv)만 있는 비인덱스 지오메트리 여러 개를 하나로 */
export function mergeSimple(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// ---------------------------------------------------------------- 그림 (캔버스 텍스처)
/** 부드러운 연기 덩어리 (가장자리가 울퉁불퉁) */
export function smokeTexture(seed = 3) {
  return canvasTexture(128, 128, (c, w, h) => {
    const r = seededRandom(seed);
    c.clearRect(0, 0, w, h);
    for (let k = 0; k < 16; k++) {
      const a = r() * TAU, d = r() * w * 0.2;
      const x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d, rad = w * (0.16 + r() * 0.16);
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.32)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
  }, false);
}
/** 동그란 빛 (가운데 밝음) */
export function glowTexture(core = 0.12) {
  return canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(core, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }, false);
}
/** 빛나는 용암 균열 (투명 바탕, 더하기 섞기용) */
export function crackTexture(seed = 11) {
  return canvasTexture(256, 256, (c, w, h) => {
    const r = seededRandom(seed);
    c.clearRect(0, 0, w, h);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const branch = (x, y, a, len, width, depth) => {
      for (const pass of [0, 1]) {
        c.strokeStyle = pass ? 'rgba(255,230,150,0.95)' : 'rgba(255,90,10,0.55)';
        c.lineWidth = pass ? width * 0.45 : width * 2.6;
        c.beginPath();
        c.moveTo(x, y);
        let px = x, py = y, pa = a;
        const rr = seededRandom(Math.floor(x * 31 + y * 17 + depth));
        for (let s = 0; s < 6; s++) {
          pa += (rr() - 0.5) * 0.9;
          px += Math.cos(pa) * (len / 6);
          py += Math.sin(pa) * (len / 6);
          c.lineTo(px, py);
        }
        c.stroke();
        if (pass && depth < 2)
          for (let k = 0; k < 2; k++) if (r() < 0.75) branch(x + (px - x) * (0.3 + r() * 0.5), y + (py - y) * (0.3 + r() * 0.5), a + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.6), len * 0.5, width * 0.6, depth + 1);
      }
    };
    // 가운데에서 바깥으로 갈라짐 (가장자리에 닿지 않게)
    for (let k = 0; k < 4; k++) branch(w / 2, h / 2, (k / 4) * TAU + r() * 0.8, w * 0.36, 5, 0);
    // 가장자리 쪽은 서서히 투명하게 (사각형이 보이지 않게)
    c.globalCompositeOperation = 'destination-in';
    const g = c.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }, false);
}
/** 유황 얼룩 (노란 가루가 묻은 땅, 가장자리 투명) */
export function sulfurTexture(seed = 13) {
  return canvasTexture(256, 256, (c, w, h) => {
    const r = seededRandom(seed);
    c.clearRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) {
      const a = r() * TAU, d = (r() ** 0.7) * w * 0.45;
      const x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d;
      const edge = d / (w * 0.45);
      const hue = r();
      c.fillStyle = hue < 0.7 ? `rgba(${220 + r() * 35},${190 + r() * 40},${40 + r() * 40},${0.5 * (1 - edge) + 0.05})` : `rgba(${200},${220},${150},${0.35 * (1 - edge)})`;
      const s = 2 + r() * 9 * (1 - edge);
      c.beginPath();
      c.arc(x, y, s, 0, TAU);
      c.fill();
    }
  }, false);
}
/** 위험 경고판 글자 (노랑·검정 줄무늬 테두리) */
export function warnTexture(title, sub, { w = 1024, h = 384, bg = '#ffc21a', fg = '#141010', accent = '#141010', icon = '⚠' } = {}) {
  return canvasTexture(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    // 줄무늬 테두리
    const b = h * 0.09;
    c.save();
    c.beginPath();
    c.rect(0, 0, w, h);
    c.rect(b, b, w - 2 * b, h - 2 * b);
    c.clip('evenodd');
    c.fillStyle = '#141010';
    c.fillRect(0, 0, w, h);
    c.fillStyle = bg === '#141010' ? '#ff7a12' : '#ffc21a';
    for (let x = -h; x < w + h; x += b * 2.2) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + b * 1.1, 0);
      c.lineTo(x + b * 1.1 - h, h);
      c.lineTo(x - h, h);
      c.fill();
    }
    c.restore();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const fit = (txt, maxW, px, weight = 900) => {
      let s = px;
      do c.font = `${weight} ${s}px ${FONT}`;
      while (c.measureText(txt).width > maxW && (s -= 4) > 10);
    };
    const tx = icon ? w * 0.56 : w / 2;
    if (icon) {
      c.font = `900 ${Math.round(h * 0.5)}px ${FONT}`;
      c.fillStyle = accent;
      c.fillText(icon, w * 0.13, h * 0.52);
    }
    fit(title, w * (icon ? 0.68 : 0.84), Math.round(h * (sub ? 0.34 : 0.44)));
    c.fillStyle = fg;
    c.fillText(title, tx, sub ? h * 0.42 : h * 0.52);
    if (sub) {
      fit(sub, w * (icon ? 0.68 : 0.84), Math.round(h * 0.16), 800);
      c.fillStyle = accent;
      c.fillText(sub, tx, h * 0.7);
    }
  }, false);
}
/** 쉐브론 (dir +1 = 오른쪽 화살표): 검정 바탕에 주황 꺾쇠 */
export function chevronTexture(dir = 1) {
  return canvasTexture(256, 96, (c, w, h) => {
    c.fillStyle = '#151112';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff8a1a';
    for (let i = 0; i < 3; i++) {
      const cx = w * (0.22 + i * 0.28);
      c.save();
      c.translate(cx, h / 2);
      c.scale(dir, 1);
      c.beginPath();
      c.moveTo(-26, -34);
      c.lineTo(0, -34);
      c.lineTo(30, 0);
      c.lineTo(0, 34);
      c.lineTo(-26, 34);
      c.lineTo(4, 0);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.strokeStyle = '#ffb21f';
    c.lineWidth = 6;
    c.strokeRect(3, 3, w - 6, h - 6);
  }, false);
}
/** 세로 깃발 (VULCAN GP) */
export function bannerTexture(bg, fg, text = 'VULCAN', sub = 'GP') {
  return canvasTexture(128, 384, (c, w, h) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.fillRect(0, h * 0.05, w, h * 0.025);
    c.fillRect(0, h * 0.925, w, h * 0.025);
    // 작은 화산 그림
    c.beginPath();
    c.moveTo(w * 0.18, h * 0.3);
    c.lineTo(w * 0.42, h * 0.12);
    c.lineTo(w * 0.58, h * 0.12);
    c.lineTo(w * 0.82, h * 0.3);
    c.closePath();
    c.fill();
    c.fillStyle = '#ff5a14';
    c.fillRect(w * 0.44, h * 0.08, w * 0.12, h * 0.04);
    c.save();
    c.translate(w / 2, h * 0.62);
    c.rotate(-Math.PI / 2);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `900 ${Math.round(w * 0.42)}px ${FONT}`;
    c.fillStyle = fg;
    c.fillText(text, 0, -w * 0.08);
    c.font = `800 ${Math.round(w * 0.22)}px ${FONT}`;
    c.fillText(sub, 0, w * 0.26);
    c.restore();
  }, false);
}
/** 건물 창문 줄 (안쪽 불빛) */
export function windowTexture() {
  return canvasTexture(256, 64, (c, w, h) => {
    c.fillStyle = '#3a3634';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#121010';
    c.fillRect(0, 16, w, 30);
    for (let x = 6; x < w; x += 20) {
      c.fillStyle = Math.random() < 0.7 ? '#ffc477' : '#4a2a20';
      c.fillRect(x, 20, 13, 22);
    }
    c.fillStyle = '#ff6a14';
    c.fillRect(0, 54, w, 5);
  });
}
/** 큰 글자 간판 (검정 바탕 + 주황 글자) */
export function titleTexture(lines, { w = 1024, h = 192, bg = '#141012', fg = '#ffffff', accent = '#ff8a1a' } = {}) {
  return canvasTexture(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = accent;
    c.fillRect(0, 0, w, h * 0.06);
    c.fillRect(0, h * 0.94, w, h * 0.06);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((ln, k) => {
      const big = k === 0;
      let s = Math.round((h / (n + 0.5)) * (big ? 0.82 : 0.5));
      do c.font = `${big ? 900 : 700} ${s}px ${FONT}`;
      while (c.measureText(ln).width > w * 0.92 && (s -= 4) > 10);
      c.fillStyle = big ? fg : accent;
      c.fillText(ln, w / 2, (h / (n + 0.5)) * (k + 0.75));
    });
  }, false);
}
