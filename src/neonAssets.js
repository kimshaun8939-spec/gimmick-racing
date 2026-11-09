// 네온 시티 그림 재료: 빌딩 외벽, 네온 간판 그림판(아틀라스), 홀로그램 재질, 큰 전광판, 비, 출발 게이트
//   neonScenery.js(배치)와 neonGlitch.js(글리치 차원)가 씀. 모두 코드로 그린 텍스처 (그림 파일 없음)
import * as THREE from 'three';
import { canvasTexture, seededRandom } from './neonTrack.js';

export const NEON = ['#ff2f8e', '#2ff3ff', '#ffe23a', '#7dff6a', '#ff8a2a', '#b06cff', '#ff3b3b', '#3b8bff', '#ff5cf0'];

// ---------------------------------------------------------------- 빌딩 외벽 (한 장 = 가로 16 m × 세로 16 m: 4칸 × 4층)
/** kind 0 = 파란 유리 커튼월, 1 = 따뜻한 불빛 아파트, 2 = 어두운 사무실 (분홍·보라 불빛), 3 = 콘크리트 + 가로 띠 */
export function facadeTextures(kind, seed = 1) {
  const rnd = seededRandom(seed * 97 + kind * 13);
  const W = 256, H = 256, bays = kind === 3 ? 4 : 8, floors = kind === 1 ? 10 : 8;
  const bw = W / bays, fh = H / floors;
  const lit = [];
  for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) lit.push(rnd());
  const warm = ['#ffd38a', '#ffe9b8', '#ffc070', '#fff2d6'];
  const cool = ['#9fe8ff', '#c6f2ff', '#7fc8ff', '#e0f6ff'];
  const pink = ['#ff6ad5', '#c08bff', '#ff9ae8', '#7ae2ff'];
  const pal = kind === 0 ? cool : kind === 1 ? warm : kind === 2 ? pink : warm;
  const base = ['#0c1424', '#1c1820', '#120c1e', '#26262c'][kind];
  const map = canvasTexture(W, H, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    for (let f = 0; f < floors; f++)
      for (let b = 0; b < bays; b++) {
        const x = b * bw, y = f * fh;
        if (kind === 3) {
          g.fillStyle = '#1a1a20';
          g.fillRect(x + 4, y + fh * 0.35, bw - 8, fh * 0.4);
          continue;
        }
        g.fillStyle = kind === 0 ? '#16243c' : '#0e0e14';
        g.fillRect(x + 2, y + 3, bw - 4, fh - 6);
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(x + 2, y + 3, bw - 4, 2);
      }
    // 층 사이 띠
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let f = 0; f < floors; f++) g.fillRect(0, f * fh + fh - 5, W, 3);
  });
  const glow = canvasTexture(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    let k = 0;
    for (let f = 0; f < floors; f++)
      for (let b = 0; b < bays; b++) {
        const r = lit[k++];
        const x = b * bw, y = f * fh;
        if (kind === 3) {
          if (r < 0.55) {
            g.fillStyle = pal[Math.floor(r * 40) % pal.length];
            g.globalAlpha = 0.5 + r * 0.6;
            g.fillRect(x + 4, y + fh * 0.35, bw - 8, fh * 0.4);
            g.globalAlpha = 1;
          }
          continue;
        }
        if (r < (kind === 0 ? 0.42 : 0.32)) {
          g.fillStyle = pal[Math.floor(r * 97) % pal.length];
          g.globalAlpha = 0.25 + r * 1.1;
          g.fillRect(x + 2, y + 3, bw - 4, fh - 6);
          // 블라인드·사람 그림자
          g.fillStyle = 'rgba(0,0,0,0.4)';
          if (r < 0.12) g.fillRect(x + 2 + (bw - 4) * 0.55, y + fh * 0.35, 3, fh * 0.6);
          g.globalAlpha = 1;
        }
      }
  });
  glow.colorSpace = THREE.SRGBColorSpace;
  return { map, glow };
}

// ---------------------------------------------------------------- 네온 간판 그림판
// 가로 간판: 위쪽 절반에 4열 × 8행 (칸 512 × 128), 세로 간판: 아래쪽 절반에 16열 × 2행 (칸 128 × 512)
const H_TEXT = ['NEON', '라멘 RAMEN', 'HOTEL', '24H', 'CYBER', 'GAME ZONE', 'PIZZA', 'KARAOKE', '기믹 레이싱', 'NOODLE', 'SUSHI 寿司', 'BAR', 'CAFE', 'ARCADE', 'TAXI', 'CLUB', '편의점', 'PC방', '노래방', 'OPEN', 'NIGHT', 'DRIVE', 'TURBO', 'MOTEL', '치킨', 'DATA', 'BOOST', '떡볶이', 'ROBOT', 'SYNTH', '電脳', 'VR'];
const V_TEXT = ['라멘', '호텔', '서울', '네온', '게임', '노래방', '東京', '電脳', '酒場', '카페', '극장', '사우나', '24시', '치킨', '피씨', '만화'];
export const SIGN_CELLS = { h: H_TEXT.length, v: V_TEXT.length };
export function signAtlas() {
  const rnd = seededRandom(4242);
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 2048;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 2048, 2048);
  const round = (x, y, w, h, r) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  };
  H_TEXT.forEach((t, k) => {
    const x = (k % 4) * 512, y = Math.floor(k / 4) * 128;
    const col = NEON[Math.floor(rnd() * NEON.length)], col2 = NEON[Math.floor(rnd() * NEON.length)];
    g.fillStyle = '#07040e';
    g.fillRect(x + 4, y + 4, 504, 120);
    g.shadowColor = col2;
    g.shadowBlur = 14;
    g.strokeStyle = col2;
    g.lineWidth = 5;
    round(x + 10, y + 10, 492, 108, 18);
    g.stroke();
    g.shadowColor = col;
    g.shadowBlur = 22;
    g.fillStyle = '#ffffff';
    let fs = 78;
    g.font = `900 ${fs}px system-ui, "Malgun Gothic", sans-serif`;
    while (g.measureText(t).width > 440 && fs > 30) g.font = `900 ${(fs -= 4)}px system-ui, "Malgun Gothic", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, x + 256, y + 68);
    g.globalAlpha = 0.85;
    g.fillStyle = col;
    g.fillText(t, x + 256, y + 68);
    g.globalAlpha = 1;
    g.shadowBlur = 0;
  });
  V_TEXT.forEach((t, k) => {
    const x = (k % 16) * 128, y = 1024 + Math.floor(k / 16) * 512;
    const col = NEON[Math.floor(rnd() * NEON.length)];
    g.fillStyle = '#08030f';
    g.fillRect(x + 4, y + 4, 120, 504);
    g.shadowColor = col;
    g.shadowBlur = 14;
    g.strokeStyle = col;
    g.lineWidth = 5;
    round(x + 10, y + 10, 108, 492, 14);
    g.stroke();
    const chars = [...t];
    const step = Math.min(110, 460 / chars.length);
    g.font = `900 ${Math.min(96, step * 0.9)}px system-ui, "Malgun Gothic", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowBlur = 20;
    chars.forEach((ch, j) => {
      g.fillStyle = '#ffffff';
      g.fillText(ch, x + 64, y + 256 + (j - (chars.length - 1) / 2) * step);
      g.globalAlpha = 0.8;
      g.fillStyle = col;
      g.fillText(ch, x + 64, y + 256 + (j - (chars.length - 1) / 2) * step);
      g.globalAlpha = 1;
    });
    g.shadowBlur = 0;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
/** 간판 칸의 uv [u0, v0, u1, v1] */
export function signUV(vertical, k) {
  if (!vertical) {
    const col = k % 4, row = Math.floor(k / 4);
    return [col / 4, 1 - ((row + 1) * 128) / 2048, (col + 1) / 4, 1 - (row * 128) / 2048];
  }
  const col = k % 16, row = Math.floor(k / 16);
  return [col / 16, 1 - (1024 + (row + 1) * 512) / 2048, (col + 1) / 16, 1 - (1024 + row * 512) / 2048];
}

// ---------------------------------------------------------------- 합친 사각형 묶음 (간판·빛 웅덩이 등을 그리기 한 번에)
export function quadBatch() {
  const pos = [], uv = [], col = [];
  return {
    /** c: 중심, rx: 가로 방향(길이 = 반폭), ry: 세로 방향(길이 = 반높이), [u0,v0,u1,v1], color */
    add(c, rx, ry, uvr = [0, 0, 1, 1], color = null) {
      const [u0, v0, u1, v1] = uvr;
      const P = [
        [c.x - rx.x - ry.x, c.y - rx.y - ry.y, c.z - rx.z - ry.z, u0, v0],
        [c.x + rx.x - ry.x, c.y + rx.y - ry.y, c.z + rx.z - ry.z, u1, v0],
        [c.x + rx.x + ry.x, c.y + rx.y + ry.y, c.z + rx.z + ry.z, u1, v1],
        [c.x - rx.x + ry.x, c.y - rx.y + ry.y, c.z - rx.z + ry.z, u0, v1],
      ];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(P[i][0], P[i][1], P[i][2]);
        uv.push(P[i][3], P[i][4]);
        if (color) col.push(color.r, color.g, color.b);
      }
    },
    /** 네 꼭짓점을 직접 (a b c d 반시계) */
    addPts(a, b, c, d, uvr = [0, 0, 1, 1], color = null) {
      const [u0, v0, u1, v1] = uvr;
      const P = [[a, u0, v0], [b, u1, v0], [c, u1, v1], [d, u0, v1]];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(P[i][0].x, P[i][0].y, P[i][0].z);
        uv.push(P[i][1], P[i][2]);
        if (color) col.push(color.r, color.g, color.b);
      }
    },
    get count() {
      return pos.length / 18;
    },
    mesh(mat) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (col.length) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      return new THREE.Mesh(geo, mat);
    },
  };
}

// ---------------------------------------------------------------- 홀로그램 재질 (투명, 가로 줄무늬, 깜빡임)
export function hologramMaterial(color = '#38e8ff', { opacity = 0.75, lines = 2.2, map = null } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uLines: { value: lines }, uMap: { value: map }, uHasMap: { value: map ? 1 : 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity, uLines, uHasMap; uniform vec3 uColor; uniform sampler2D uMap;
      varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec2 vUv;
      float h(float x) { return fract(sin(x * 91.17) * 43758.5); }
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float scan = 0.55 + 0.45 * sin(vW.y * uLines * 6.2832 - uTime * 6.0);
        float flick = 0.85 + 0.15 * step(0.92, h(floor(uTime * 12.0)));
        vec3 col = uColor;
        float a = (0.18 + fres * 0.9) * scan * flick;
        if (uHasMap > 0.5) {
          vec4 t = texture2D(uMap, vUv);
          col = mix(col, t.rgb * 1.4, 0.75);
          a = max(a, t.a * (0.65 + 0.35 * scan)) * flick;
        }
        gl_FragColor = vec4(col * 1.6, a * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- 큰 전광판 (광고가 몇 초마다 지지직 바뀜)
const ADS = [
  ['NEON CITY', 'GRAND PRIX', '#ff2f8e', '#2ff3ff'],
  ['기믹 레이싱', 'GIMMICK RACING', '#ffe23a', '#ff2f8e'],
  ['TURBO COLA', '⚡ 부스터 충전 ⚡', '#7dff6a', '#2ff3ff'],
  ['GLITCH ZONE', '차원 포털 앞 300m', '#b06cff', '#ff5cf0'],
  ['RAMEN 24H', '라멘 · 떡볶이 · 치킨', '#ff8a2a', '#ffe23a'],
  ['MAGNET TUBE', '벽·천장을 달리세요!', '#2ff3ff', '#b06cff'],
];
export function adTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256 * ADS.length;
  const g = c.getContext('2d');
  ADS.forEach(([a, b, c1, c2], k) => {
    const y = k * 256;
    const gr = g.createLinearGradient(0, y, 512, y + 256);
    gr.addColorStop(0, '#0a0420');
    gr.addColorStop(1, '#1d0636');
    g.fillStyle = gr;
    g.fillRect(0, y, 512, 256);
    // 사선 무늬
    g.strokeStyle = c2;
    g.globalAlpha = 0.25;
    g.lineWidth = 10;
    for (let x = -256; x < 512; x += 48) {
      g.beginPath();
      g.moveTo(x, y + 256);
      g.lineTo(x + 256, y);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = c1;
    g.shadowBlur = 24;
    g.fillStyle = '#ffffff';
    let fs = 84;
    g.font = `900 ${fs}px system-ui, "Malgun Gothic", sans-serif`;
    while (g.measureText(a).width > 470 && fs > 30) g.font = `900 ${(fs -= 4)}px system-ui, "Malgun Gothic", sans-serif`;
    g.fillText(a, 256, y + 100);
    g.shadowColor = c2;
    g.fillStyle = c2;
    g.font = `800 38px system-ui, "Malgun Gothic", sans-serif`;
    g.fillText(b, 256, y + 186);
    g.shadowBlur = 0;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, count: ADS.length };
}
export function screenMaterial(adTex, count) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: adTex }, uN: { value: count }, uSeed: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uN, uSeed; uniform sampler2D uMap; varying vec2 vUv;
      float h(float x) { return fract(sin(x * 78.233) * 43758.5); }
      void main() {
        float T = uTime * 0.22 + uSeed;
        float k = floor(T);
        float f = fract(T);
        float idx = mod(k + floor(uSeed * 3.0), uN);
        vec2 uv = vUv;
        // 바뀌는 순간 지지직 (가로 줄이 밀림)
        float g = step(0.93, f) * step(0.5, h(floor(vUv.y * 24.0) + floor(uTime * 30.0)));
        uv.x += g * (h(floor(vUv.y * 40.0) + uTime) - 0.5) * 0.3;
        vec2 tuv = vec2(uv.x, (uv.y + (uN - 1.0 - idx)) / uN);
        vec3 col = texture2D(uMap, tuv).rgb;
        float r = texture2D(uMap, tuv + vec2(0.006 * g, 0.0)).r;
        col.r = mix(col.r, r, g);
        col *= 0.85 + 0.15 * sin(vUv.y * 400.0); // 화면 줄
        gl_FragColor = vec4(col * 1.25, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- 비 (카메라 주변 상자 안에서 떨어짐, 셰이더로 움직임)
export function createRain({ count = 2600, box = 110, height = 60 } = {}) {
  const rnd = seededRandom(9);
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = (rnd() - 0.5) * box, y = rnd() * height, z = (rnd() - 0.5) * box;
    for (let k = 0; k < 2; k++) {
      pos.set([x, y, z], (i * 2 + k) * 3);
      seed[i * 2 + k] = rnd();
      end[i * 2 + k] = k;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uH: { value: height }, uColor: { value: new THREE.Color('#9fc6ff') }, uSpeed: { value: 38 }, uLen: { value: 1.6 }, uOpacity: { value: 0.35 }, uDir: { value: -1 } },
    vertexShader: /* glsl */ `
      uniform float uTime, uBox, uH, uSpeed, uLen, uDir; uniform vec3 uCam;
      attribute float aSeed; attribute float aEnd; varying float vA;
      void main() {
        vec3 p = position;
        float y = mod(p.y + uDir * uTime * uSpeed * (0.8 + 0.4 * aSeed) - uCam.y + uH * 0.5, uH) + uCam.y - uH * 0.5;
        // 카메라를 따라다니는 상자 (x, z도 감싸기)
        vec2 xz = mod(p.xz - uCam.xz + uBox * 0.5, uBox) + uCam.xz - uBox * 0.5;
        vec3 w = vec3(xz.x, y + aEnd * uLen * -uDir, xz.y);
        w.x += aEnd * 0.25; // 바람에 살짝 기울어짐
        vA = 1.0 - smoothstep(uBox * 0.25, uBox * 0.5, length(w.xz - uCam.xz));
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main() { gl_FragColor = vec4(uColor, uOpacity * vA); }`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  return { obj: lines, mat };
}

// ---------------------------------------------------------------- 출발 게이트 (네온): 빨간불 5개가 운전자 왼쪽부터 켜짐
//   도로는 로컬 z 방향, 기둥은 ±(width/2 + 1.5). 로컬 +x = 운전자 왼쪽 (게이트를 도로 방향으로 돌려 놓기 때문)
export function neonGantry({ width = 22 } = {}) {
  const obj = new THREE.Group();
  obj.name = 'neonGantry';
  const hx = width / 2 + 1.5;
  const span = hx * 2 + 1.6;
  const dark = new THREE.MeshStandardMaterial({ color: '#1a1c26', metalness: 0.7, roughness: 0.35 });
  const pink = new THREE.MeshBasicMaterial({ color: '#ff2f8e', toneMapped: false });
  const cyan = new THREE.MeshBasicMaterial({ color: '#2ff3ff', toneMapped: false });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 11, 1.6), dark);
    leg.position.set(s * hx, 5.5, 0);
    leg.castShadow = true;
    obj.add(leg);
    for (const dz of [-0.82, 0.82]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 10.6, 0.06), s < 0 ? cyan : pink);
      strip.position.set(s * hx, 5.5, dz);
      obj.add(strip);
    }
  }
  // 위 들보 + 글자 판
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 2.6, 1.8), dark);
  beam.position.y = 10.2;
  beam.castShadow = true;
  obj.add(beam);
  const label = canvasTexture(1024, 128, (g, w, h) => {
    g.fillStyle = '#05030c';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 78px system-ui, "Malgun Gothic", sans-serif';
    g.shadowColor = '#ff2f8e';
    g.shadowBlur = 24;
    g.fillStyle = '#ffd6ef';
    g.fillText('NEON CITY  GRAND PRIX', w / 2, h / 2 + 4);
  });
  label.wrapS = THREE.ClampToEdgeWrapping;
  for (const z of [-0.92, 0.92]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(span - 1.2, 2.0), new THREE.MeshBasicMaterial({ map: label, toneMapped: false }));
    p.position.set(0, 10.2, z);
    if (z < 0) p.rotation.y = Math.PI;
    obj.add(p);
  }
  for (const y of [8.85, 11.55]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(span, 0.12, 1.9), y < 9 ? cyan : pink);
    e.position.y = y;
    obj.add(e);
  }
  // 신호등 판
  const box = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.5, 0.7), new THREE.MeshStandardMaterial({ color: '#0b0c12', roughness: 0.6 }));
  box.position.set(0, 7.9, 0);
  obj.add(box);
  const bulbGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.8, 16).rotateX(Math.PI / 2);
  const bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 5);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 5; i++) bulbs.setMatrixAt(i, m4.makeTranslation((2 - i) * 1.35, 7.9, 0)); // 0번 = 로컬 +x = 운전자 왼쪽
  obj.add(bulbs);
  const OFF = new THREE.Color('#2a0a10'), ON = new THREE.Color('#ff1a1a'), GO = new THREE.Color('#2bff6a');
  let nOn = 0, green = false;
  const apply = () => {
    for (let i = 0; i < 5; i++) bulbs.setColorAt(i, green ? GO : i < nOn ? ON : OFF);
    bulbs.instanceColor.needsUpdate = true;
  };
  apply();
  bulbs.computeBoundingSphere();
  return {
    obj,
    hx,
    setLights(n) {
      n = Math.max(0, Math.min(5, n | 0));
      if (n !== nOn) (nOn = n), apply();
    },
    setGreen(b) {
      if (!!b !== green) (green = !!b), apply();
    },
    update(t) {
      pink.color.setHSL(0.92, 1, 0.55 + 0.08 * Math.sin(t * 3));
    },
  };
}

/** 부드러운 둥근 빛 (빛 웅덩이·광원 후광) */
export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.3)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.35, mid);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
