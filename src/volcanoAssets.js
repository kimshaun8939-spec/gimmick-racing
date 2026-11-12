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
  let sortBuf = null;
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
      // 매 프레임 새 배열을 만들지 않게 미리 만든 칸을 다시 씀
      if (!sortBuf || sortBuf.m < m) sortBuf = { m, idx: new Uint16Array(m), d: new Float32Array(n), p2: new Float32Array(m * 3), s2: new Float32Array(m), r2: new Float32Array(m), c2: new Float32Array(m * 4) };
      const B = sortBuf;
      for (let i = 0; i < m; i++) {
        B.idx[i] = i;
        B.d[i] = (pos[i * 3] - cam.x) ** 2 + (pos[i * 3 + 1] - cam.y) ** 2 + (pos[i * 3 + 2] - cam.z) ** 2;
      }
      // 삽입 정렬 (거의 정렬된 채로 프레임마다 조금씩만 바뀜 → 빠름)
      for (let i = 1; i < m; i++) {
        const v = B.idx[i], dv = B.d[v];
        let j = i - 1;
        while (j >= 0 && B.d[B.idx[j]] < dv) {
          B.idx[j + 1] = B.idx[j];
          j--;
        }
        B.idx[j + 1] = v;
      }
      B.p2.set(pos.subarray(0, m * 3));
      B.s2.set(size.subarray(0, m));
      B.r2.set(rot.subarray(0, m));
      B.c2.set(col.subarray(0, m * 4));
      for (let k = 0; k < m; k++) {
        const i = B.idx[k];
        pos[k * 3] = B.p2[i * 3];
        pos[k * 3 + 1] = B.p2[i * 3 + 1];
        pos[k * 3 + 2] = B.p2[i * 3 + 2];
        size[k] = B.s2[i];
        rot[k] = B.r2[i];
        col[k * 4] = B.c2[i * 4];
        col[k * 4 + 1] = B.c2[i * 4 + 1];
        col[k * 4 + 2] = B.c2[i * 4 + 2];
        col[k * 4 + 3] = B.c2[i * 4 + 3];
      }
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
      flash: { value: 0 }, flashDir: { value: new THREE.Vector3(0, 1, 0) }, // 번개: 세기, 번개 쪽 방향
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 cTop, cMid, cHor, cGlow, cSun, cCloud, cCloudLit, sunDir, volDir, fogSRGB;
      uniform float time, glowAmt, flash;
      uniform vec3 flashDir;
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
        // 번개: 번개 쪽 하늘과 구름이 푸르스름하게 번쩍
        float fl = flash * (pow(max(dot(d, flashDir), 0.0), 6.0) * 1.1 + 0.04);
        col += vec3(0.85, 0.78, 0.92) * fl * (0.3 + cl * 0.95);
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

// ================================================================ 2라운드: 살아 있는 화산 (흐르는 용암·불똥·번개·움직이는 것들)

// 셰이더 공용: 값 노이즈
const NOISE_GLSL = /* glsl */ `
float vhash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), f.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vfbm(vec2 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++) { s += a * vnoise2(p); p = p * 2.07 + 1.7; a *= 0.5; } return s; }
`;

/**
 * 흐르는 용암 재질 (강·폭포·웅덩이): uv.x = 가로 0~1, uv.y = 흐름 방향 거리(m)
 *   셰이더 안에서 시간에 따라 흘러감 (CPU 일 없음). 굳은 껍질 조각이 떠내려가고 가운데는 더 밝음
 *   speed: 흐름 빠르기(m/초), fall: 1이면 폭포 (세로로 길게 늘어진 줄무늬)
 */
export function lavaFlowMaterial({ speed = 2, fogScale = 0.45, gain = 1, fall = 0, crust = 0.5, width = 8 } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, speed: { value: speed }, fogScale: { value: fogScale }, gain: { value: gain }, fall: { value: fall }, crust: { value: crust }, width: { value: width } }]);
  const m = new THREE.ShaderMaterial({
    uniforms, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float time, speed, fogScale, gain, fall, crust, width;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        float edge = 1.0 - abs(vUv.x * 2.0 - 1.0); // 가운데 1, 둑 0
        float along = vUv.y - time * speed;
        vec2 p = vec2(vUv.x * width * 0.16, along * mix(0.16, 0.035, fall));
        float n = vfbm(p);
        float n2 = vfbm(p * 2.3 + vec2(7.1, -time * 0.05));
        // 둑 쪽은 굳어서 어둡고, 가운데는 녹아서 밝음
        float cr = smoothstep(0.5, 0.66, n + (1.0 - edge) * 0.42 - (1.0 - crust) * 0.3 - fall * 0.25);
        vec3 hot = mix(vec3(1.0, 0.30, 0.03), vec3(1.0, 0.78, 0.32), smoothstep(0.35, 0.85, n2) * (0.4 + edge * 0.6));
        hot *= 1.25 + 0.2 * sin(time * 2.3 + vUv.y * 0.21) + fall * 0.35;
        vec3 crc = vec3(0.09, 0.035, 0.022) + vec3(0.5, 0.12, 0.02) * smoothstep(0.75, 0.55, n2) * 0.35;
        vec3 col = mix(hot, crc, cr);
        // 껍질 틈 (껍질 가장자리가 가늘게 빛남)
        col += vec3(1.0, 0.45, 0.08) * (1.0 - abs(cr * 2.0 - 1.0)) * 0.55;
        gl_FragColor = vec4(col * gain, 1.0);
        #include <colorspace_fragment>
        #ifdef USE_FOG
          float ff = smoothstep(fogNear, fogFar, vFogDepth) * fogScale;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
        #endif
      }`,
  });
  m.toneMapped = false;
  return m;
}

/**
 * GPU 불똥 묶음: 수백~수천 개의 빛 알갱이를 그림 호출 1번으로. 움직임은 전부 셰이더가 시간으로 계산 (CPU 일 없음)
 *   add({ p:[x,y,z], v:[vx,vy,vz], g(중력), size, period(되풀이 간격 초), life(살아 있는 초), phase, jitter(속도 흔들림),
 *         grow(끝 크기 배수), fade(사라짐 곡선, 0이면 안 사라짐), darken(끝으로 갈수록 어두워짐), color, alpha })
 *   period > life면 깜빡이거나 가끔 터지는 것 (경고등·용암 거품), period = life면 계속 뿜는 것 (분수·불꽃)
 */
export function gpuSparks(n, { map, fogAmt = 0.5, name = 'volcanoSparks', additive = true, nearFade = [0, 0] } = {}) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(base.index);
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  const A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 4), D = new Float32Array(n * 4), Col = new Float32Array(n * 4);
  const attrs = { iA: A, iB: B, iC: C, iD: D, iCol: Col };
  for (const k in attrs) g.setAttribute(k, new THREE.InstancedBufferAttribute(attrs[k], 4));
  g.instanceCount = 0;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, fogAmt: { value: fogAmt }, gain: { value: 1 }, time: { value: 0 }, nearFade: { value: new THREE.Vector2(nearFade[0], nearFade[1]) } }]);
  uniforms.map.value = map;
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, defines: additive ? { ADDITIVE: 1 } : {},
    vertexShader: /* glsl */ `
      attribute vec4 iA; // 처음 자리 xyz, 크기
      attribute vec4 iB; // 속도 xyz, 중력
      attribute vec4 iC; // 되풀이 간격, 수명, 시작 어긋남, 속도 흔들림
      attribute vec4 iD; // 끝 크기 배수, 사라짐 곡선, 회전 속도, 끝으로 갈수록 어두워짐(0~1)
      attribute vec4 iCol;
      uniform float time;
      uniform vec2 nearFade; // 카메라에서 이 거리(m) 안이면 흐려짐 (연기가 화면을 덮지 않게)
      varying vec2 vUv;
      varying vec4 vCol;
      #include <fog_pars_vertex>
      float h1(float x) { return fract(sin(x) * 43758.5453); }
      void main() {
        vUv = uv;
        float T = time + iC.z;
        float cyc = floor(T / iC.x);
        float tau = T - cyc * iC.x;
        float alive = step(tau, iC.y);
        float f = clamp(tau / iC.y, 0.0, 1.0);
        float id = float(gl_InstanceID);
        vec3 j = vec3(h1(cyc * 12.9898 + id * 78.233), h1(cyc * 39.346 + id * 11.135), h1(cyc * 73.156 + id * 52.235)) - 0.5;
        vec3 vel = iB.xyz + j * 2.0 * iC.w;
        vec3 p = iA.xyz + vel * tau;
        p.y -= 0.5 * iB.w * tau * tau;
        float size = iA.w * mix(1.0, iD.x, f) * alive;
        float fade = iD.y > 0.0 ? 1.0 - pow(f, iD.y) : 1.0;
        vCol = vec4(mix(iCol.rgb, iCol.rgb * 0.18, f * iD.w), iCol.a * smoothstep(0.0, 0.05, f) * fade);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        if (nearFade.y > 0.0) vCol.a *= smoothstep(nearFade.x, nearFade.y, length(mvPosition.xyz) - size * 0.5);
        float r = iD.z * (tau + id);
        float c = cos(r), s = sin(r);
        vec2 q = position.xy * size;
        mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: BB_FS,
  });
  mat.toneMapped = false;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.name = name;
  let k = 0;
  const cc = new THREE.Color();
  return {
    mesh, mat, max: n,
    get count() {
      return k;
    },
    add({ p, v = [0, 0, 0], g: grav = 0, size = 1, period = 1, life = 1, phase = 0, jitter = 0, grow = 1, fade = 1, spin = 0, darken = 0, color = '#ffffff', alpha = 1 }) {
      if (k >= n) return -1;
      const i = k++;
      A.set([p[0], p[1], p[2], size], i * 4);
      B.set([v[0], v[1], v[2], grav], i * 4);
      C.set([period, Math.min(life, period), phase, jitter], i * 4);
      D.set([grow, fade, spin, darken], i * 4);
      cc.set(color);
      Col.set([cc.r, cc.g, cc.b, alpha], i * 4);
      g.instanceCount = k;
      for (const a in attrs) g.attributes[a].needsUpdate = true;
      return i;
    },
  };
}

/**
 * 용암 위를 떠내려가는 굳은 껍질 조각 (InstancedMesh용 재질)
 *   인스턴스 속성 aDrift = (방향 x, 방향 z, 빠르기 m/초, 움직이는 길이 m), aPhase = 0~1
 *   한쪽 끝에서 커지며 떠올라 흘러가다 다른 쪽 끝에서 작아지며 가라앉음 (셰이더만으로)
 */
export function crustPlateMaterial({ fogScale = 0.6 } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, fogScale: { value: fogScale } }]);
  const m = new THREE.ShaderMaterial({
    uniforms, fog: true,
    vertexShader: /* glsl */ `
      attribute vec4 aDrift;
      attribute float aPhase;
      uniform float time;
      varying vec2 vUv;
      varying float vLife;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        float f = fract(time * aDrift.z / aDrift.w + aPhase);
        float sc = sin(f * 3.14159);
        vec3 lp = position * (0.3 + 0.7 * sqrt(sc));
        vec4 wp = modelMatrix * instanceMatrix * vec4(lp, 1.0);
        wp.xz += aDrift.xy * (f - 0.5) * aDrift.w;
        wp.y -= (1.0 - sc) * 0.3;
        vLife = sc;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float time, fogScale;
      varying vec2 vUv;
      varying float vLife;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float n = vnoise2(vUv * 9.0);
        float rim = smoothstep(0.55, 0.98, r + n * 0.15);
        vec3 col = mix(vec3(0.075, 0.03, 0.02) + n * 0.03, vec3(1.0, 0.42, 0.06) * 1.4, rim);
        // 갈라진 금 사이로 빛
        col += vec3(1.0, 0.35, 0.05) * smoothstep(0.035, 0.0, abs(vnoise2(vUv * 5.0 + 3.0) - 0.5)) * 0.7;
        col = mix(vec3(1.0, 0.45, 0.08), col, smoothstep(0.0, 0.45, vLife));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #ifdef USE_FOG
          float ff = smoothstep(fogNear, fogFar, vFogDepth) * fogScale;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
        #endif
      }`,
  });
  m.toneMapped = false;
  return m;
}
/** 껍질 조각 모양 (울퉁불퉁한 납작 다각형, 반지름 약 1, 바닥에 눕힘) */
export function crustPlateGeo(seed = 5) {
  const r = seededRandom(seed);
  const g = new THREE.CircleGeometry(1, 9);
  const p = g.attributes.position;
  for (let i = 1; i < p.count; i++) {
    const k = 0.7 + r() * 0.45;
    p.setXY(i, p.getX(i) * k, p.getY(i) * k);
  }
  g.rotateX(-Math.PI / 2);
  return g;
}

/** 번개 모양: 아래로 갈라지며 내려가는 지그재그 띠 (위 = 0, 아래 = -len, xy 평면) */
export function boltGeometry(seed, len = 420, width = 7) {
  const r = seededRandom(seed);
  const pos = [];
  const quad = (ax, ay, bx, by, w) => {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * w * 0.5, ny = (dx / L) * w * 0.5;
    pos.push(ax - nx, ay - ny, 0, bx - nx, by - ny, 0, bx + nx, by + ny, 0, ax - nx, ay - ny, 0, bx + nx, by + ny, 0, ax + nx, ay + ny, 0);
  };
  const branch = (x, y, L, w, depth, dirX) => {
    const steps = 9 + Math.floor(r() * 6);
    let px = x, py = y;
    for (let k = 0; k < steps; k++) {
      const nx = px + (r() - 0.5) * L * 0.22 + dirX * L * 0.04, ny = py - (L / steps) * (0.7 + r() * 0.6);
      quad(px, py, nx, ny, w * (1 - (k / steps) * 0.5));
      if (depth < 2 && r() < 0.22) branch(nx, ny, L * (0.3 + r() * 0.25), w * 0.55, depth + 1, r() < 0.5 ? -1 : 1);
      px = nx;
      py = ny;
    }
  };
  branch(0, 0, len, width, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** 서치라이트 빛줄기 그림 (꼭짓점 쪽 v=1이 밝고 끝으로 갈수록 투명) */
export function beamTexture() {
  return canvasTexture(64, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }, false);
}

/** 꼭짓점 색이 들어간 상자 여러 개를 하나로 (작은 기계 모형용): parts = [[w,h,d, x,y,z, '#색', 회전Y, 모양], ...] */
export function colorBoxes(parts) {
  const list = [];
  const c = new THREE.Color();
  for (const [w, h, d, x, y, z, col, ry = 0, shape = 'box'] of parts) {
    let g;
    if (shape === 'cyl') g = new THREE.CylinderGeometry(w / 2, w / 2, h, 10);
    else if (shape === 'ball') g = new THREE.SphereGeometry(w / 2, 10, 6).scale(1, h / w, d / w);
    else g = new THREE.BoxGeometry(w, h, d);
    g = g.toNonIndexed();
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    c.set(col);
    const cols = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < cols.length; i += 3) {
      cols[i] = c.r;
      cols[i + 1] = c.g;
      cols[i + 2] = c.b;
    }
    g.userData.cols = cols;
    list.push(g);
  }
  const out = mergeSimple(list);
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    col.set(g.userData.cols, o * 3);
    o += g.attributes.position.count;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** 헬리콥터 (길이 약 13 m): 몸통·꼬리·스키드는 꼭짓점 색 한 덩어리, 회전 날개는 따로 (돌림) */
export function helicopterModel() {
  const root = new THREE.Group();
  const body = colorBoxes([
    [3.2, 2.6, 5.2, 0, 1.9, 0.6, '#d8d2c8', 0, 'ball'],
    [2.2, 1.6, 2.6, 0, 1.7, 2.9, '#1d2730', 0, 'ball'],
    [0.7, 0.7, 7, 0, 2.3, -4.6, '#d8d2c8'],
    [0.25, 2.2, 1.4, 0, 3.2, -7.9, '#ff6a14'],
    [2.4, 0.18, 0.7, 0, 2.6, -7.6, '#d8d2c8'],
    [0.16, 0.16, 5.4, -1.25, 0.25, 0.6, '#2a2a2e'],
    [0.16, 0.16, 5.4, 1.25, 0.25, 0.6, '#2a2a2e'],
    [0.14, 1.0, 0.14, -1.0, 0.7, 2, '#2a2a2e'],
    [0.14, 1.0, 0.14, 1.0, 0.7, 2, '#2a2a2e'],
    [0.14, 1.0, 0.14, -1.0, 0.7, -0.8, '#2a2a2e'],
    [0.14, 1.0, 0.14, 1.0, 0.7, -0.8, '#2a2a2e'],
    [0.5, 0.6, 0.5, 0, 3.35, 0.6, '#2a2a2e', 0, 'cyl'],
    [3.3, 0.35, 0.5, 0, 1.65, 2.2, '#ff6a14'],
    [0.7, 0.7, 0.9, 0, 0.75, 3.6, '#202024', 0, 'ball'],
  ]);
  body.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  root.add(new THREE.Mesh(body, mat));
  const rotorMat = new THREE.MeshBasicMaterial({ color: '#1a1a1c', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  const rotor = new THREE.Mesh(new THREE.CircleGeometry(6.2, 24).rotateX(-Math.PI / 2), rotorMat);
  rotor.position.set(0, 3.7, 0.6);
  const blades = new THREE.Mesh(colorBoxes([[12.4, 0.08, 0.35, 0, 0, 0, '#202022'], [0.35, 0.08, 12.4, 0, 0, 0, '#202022']]), new THREE.MeshBasicMaterial({ vertexColors: true }));
  rotor.add(blades);
  const tail = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12).rotateY(Math.PI / 2), rotorMat);
  tail.position.set(0.25, 3.2, -8.2);
  root.add(rotor, tail);
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false }));
  red.position.set(0, 3.5, -2.2);
  const white = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  white.position.set(0, 4.4, -8.4);
  root.add(red, white);
  return { obj: root, rotor, tail, blades, red, white };
}

/** 촬영 드론 (폭 약 2 m): 몸통 + 팔 4개 + 카메라 + 프로펠러 원판 (꼭짓점 색 한 덩어리) */
export function droneGeo() {
  const parts = [
    [0.9, 0.32, 1.1, 0, 0, 0, '#26262a'],
    [0.5, 0.12, 0.6, 0, 0.22, 0, '#ff6a14'],
    [0.32, 0.32, 0.32, 0, -0.32, 0.35, '#111114', 0, 'ball'],
  ];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push([1.15, 0.1, 0.12, x * 0.45, 0.05, z * 0.45, '#3a3a40', z * x > 0 ? -Math.PI / 4 : Math.PI / 4]);
    parts.push([0.16, 0.22, 0.16, x * 0.85, 0.15, z * 0.85, '#3a3a40', 0, 'cyl']);
    parts.push([1.1, 0.03, 1.1, x * 0.85, 0.28, z * 0.85, '#4a4a52', 0, 'cyl']);
    parts.push([0.12, 0.5, 0.12, x * 0.3, -0.38, z * 0.3, '#3a3a40']);
  }
  const g = colorBoxes(parts);
  g.computeVertexNormals();
  return g;
}

/** 케이블카 곤돌라 (높이 약 5 m, 원점 = 케이블에 매달린 곳). 창문 띠는 밝은 색 */
export function gondolaGeo() {
  const g = colorBoxes([
    [0.2, 2.2, 0.2, 0, -1.1, 0, '#2a2a2e'],
    [0.9, 0.5, 0.5, 0, -0.1, 0, '#2a2a2e'],
    [3.4, 0.3, 2.4, 0, -2.35, 0, '#2a2a2e'],
    [3.6, 2.2, 2.6, 0, -3.5, 0, '#ff7a1a'],
    [3.66, 0.8, 2.66, 0, -3.3, 0, '#ffe2b0'],
    [3.7, 0.5, 2.7, 0, -4.75, 0, '#3a2c26'],
    [3.4, 0.25, 2.4, 0, -2.45, 0, '#e9e1d6'],
  ]);
  g.computeVertexNormals();
  return g;
}

/** 케이블카 철탑: 네 다리가 위로 좁아지는 격자 탑 + 꼭대기 팔 (바닥 = 0, 높이 h) */
export function pylonGeo(h, arm = 9) {
  const list = [];
  const beam = (a, b, t) => {
    const d = b.clone().sub(a);
    const L = d.length();
    const g = new THREE.BoxGeometry(t, L, t).toNonIndexed();
    g.translate(0, L / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate(a.x, a.y, a.z);
    list.push(g);
  };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const w0 = Math.max(3, h * 0.11), w1 = 1.2;
  const leg = (sx, sz, y) => {
    const w = w0 + (w1 - w0) * (y / h);
    return V3(sx * w, y, sz * w);
  };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) beam(leg(sx, sz, -2), leg(sx, sz, h), 0.5);
  const levels = Math.max(3, Math.round(h / 7));
  for (let l = 0; l < levels; l++) {
    const y0 = (l / levels) * h, y1 = ((l + 1) / levels) * h;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
      beam(leg(ax, az, y0), leg(bx, bz, y1), 0.22);
      beam(leg(ax, az, y1), leg(bx, bz, y1), 0.26);
    }
  }
  beam(V3(-arm, h, 0), V3(arm, h, 0), 0.9);
  beam(V3(-arm, h + 1.2, 0), V3(arm, h + 1.2, 0), 0.5);
  for (const s of [-1, 1]) beam(V3(s * arm * 0.6, h, 0), V3(0, h - 4, 0), 0.35);
  const out = mergeSimple(list);
  out.computeVertexNormals();
  return out;
}

/** 노란 유황 결정 무더기 (반지름 약 1, 바닥 = 0) */
export function crystalClusterGeo(seed) {
  const r = seededRandom(seed);
  const list = [];
  const n = 5 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const g = new THREE.OctahedronGeometry(0.22 + r() * 0.18, 0);
    g.scale(1, 2.2 + r() * 1.8, 1);
    g.rotateZ((r() - 0.5) * 1.1);
    g.rotateY(r() * TAU);
    const a = r() * TAU, d = r() * 0.6;
    g.translate(Math.cos(a) * d, 0.25, Math.sin(a) * d);
    list.push(g);
  }
  const out = mergeSimple(list);
  out.computeVertexNormals();
  return out;
}

/** 보랏빛 흑요석 결정 무더기: 날카로운 조각 여러 개가 비스듬히 솟음 (반지름 약 1, 바닥 = 0) */
export function obsidianClusterGeo(seed) {
  const r = seededRandom(seed);
  const list = [];
  const n = 4 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const h = 0.9 + r() * 1.9;
    const g = new THREE.ConeGeometry(0.22 + r() * 0.25, h, 4 + Math.floor(r() * 2), 1).toNonIndexed();
    g.translate(0, h / 2 - 0.15, 0);
    g.rotateX((r() - 0.5) * 0.9);
    g.rotateZ((r() - 0.5) * 0.9);
    g.rotateY(r() * TAU);
    const a = r() * TAU, d = r() * 0.55;
    g.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    list.push(g);
  }
  const out = mergeSimple(list);
  out.computeVertexNormals();
  return out;
}

/** 길가 반사 기둥 (흰 기둥 + 검은 띠, 원점 = 땅, 땅 위 약 1.15 m): 꼭짓점 색 */
export function reflectorPostGeo() {
  const g = colorBoxes([
    [0.14, 2.6, 0.14, 0, -0.15, 0, '#e8e4dc'],
    [0.15, 0.22, 0.15, 0, 0.95, 0, '#141212'],
  ]);
  g.computeVertexNormals();
  return g;
}
