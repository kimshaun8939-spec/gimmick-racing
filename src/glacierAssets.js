// 빙하 하이웨이 풍경용 부품 모음 (glacierScenery.js가 씀)
//   - 하늘 돔 재질(glacierSkyMaterial): 해 진 직후 파란 하늘(블루 아워) + 움직이는 오로라 커튼 + 별 + 지평선 노을 + 달
//   - 안개를 덜 받는 Lambert 재질(fogLambert): 먼 설산이 안개에 완전히 묻히지 않게 (꼭짓점 색)
//   - 모양: 눈 덮인 전나무(가까운 것·먼 것), 눈 모자 바위, 통나무 오두막(벽·창문 불빛 따로), 풍력 발전기, 눈 울타리, 새
//   - 그림(캔버스 텍스처): 얼음 균열, 표지판 묶음(한 장에 여러 글자 = 재질 하나 → staticBatch가 합침), 광고판 묶음
// 이름·회사는 모두 지어낸 것 (진짜 브랜드 없음)
import * as THREE from 'three';
import { canvasTexture, seededRandom, makeNoise } from './moonTrack.js';
import { mergeSimple, colorBoxes, FONT } from './volcanoAssets.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 하늘 돔
/**
 * 블루 아워 하늘: 위는 짙은 남색, 지평선은 안개 색, 해 진 쪽은 분홍·주황 노을
 *   오로라: 높이 90~200 km 층을 몇 번 찍어서(레이마칭 7번) 세로 커튼처럼 보이게. 아래는 초록, 위로 갈수록 청록·보라
 *   별: 방향을 격자로 나눈 해시 (반짝임), 오로라·노을이 밝은 곳은 덜 보임
 */
export function glacierSkyMaterial({ fogColor, sunDir, moonDir }) {
  const C = (h) => new THREE.Color(h);
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cTop: { value: C('#0b1636') }, cMid: { value: C('#26457e') }, cHor: { value: fogColor },
      cDusk: { value: C('#ffb08a') }, cDusk2: { value: C('#c77fb4') },
      sunDir: { value: sunDir.clone().normalize() }, moonDir: { value: moonDir.clone().normalize() },
      time: { value: 0 }, aurora: { value: 1 },
      fogSRGB: { value: fogColor.clone().convertLinearToSRGB() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 cTop, cMid, cHor, cDusk, cDusk2, sunDir, moonDir, fogSRGB;
      uniform float time, aurora;
      varying vec3 vDir;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n2(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      // 오로라 커튼 한 겹: 평면 위 점 p(km 단위 비슷한 값)에서의 세기
      float curtain(vec2 p, float t) {
        // 커튼 줄기: 천천히 꿈틀대는 곡선 (x를 따라 y가 흔들림)
        float c1 = sin(p.x * 0.55 + t * 0.07) * 1.6 + sin(p.x * 1.31 - t * 0.11) * 0.7 + (n2(vec2(p.x * 0.35, t * 0.05)) - 0.5) * 2.2;
        float d1 = abs(p.y - 2.2 - c1);
        float c2 = sin(p.x * 0.42 - t * 0.05 + 2.0) * 2.0 + (n2(vec2(p.x * 0.27 + 7.0, t * 0.04)) - 0.5) * 2.6;
        float d2 = abs(p.y + 1.6 - c2);
        float band = exp(-d1 * d1 * 2.2) + exp(-d2 * d2 * 1.6) * 0.7;
        // 세로 빛줄기 (가늘게 흔들림)
        float rays = 0.55 + 0.45 * n2(vec2(p.x * 9.0 + t * 0.35, 0.5)) * n2(vec2(p.x * 3.1 - t * 0.2, 3.0));
        return band * rays;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec2 hd = normalize(d.xz + 1e-5);
        // 바탕: 지평선(안개 색) → 가운데 파랑 → 꼭대기 남색
        vec3 col = mix(cHor, cMid, smoothstep(-0.02, 0.28, h));
        col = mix(col, cTop, smoothstep(0.25, 0.85, h));
        // 해 진 쪽 노을 (지평선 가까이만)
        float sv = max(dot(hd, normalize(sunDir.xz)), 0.0);
        float dusk = pow(sv, 3.0) * exp(-max(h, 0.0) * 9.0);
        col = mix(col, cDusk, dusk * 0.75);
        col += cDusk2 * pow(sv, 1.5) * exp(-max(h, 0.0) * 4.0) * 0.12;
        // 별 (높을수록 많이)
        float starMask = smoothstep(0.06, 0.4, h) * (1.0 - dusk);
        vec3 q = floor(d * 420.0);
        float st = h31(q);
        float tw = 0.65 + 0.35 * sin(time * (1.5 + st * 4.0) + st * 40.0);
        float star = step(0.9965, st) * tw * starMask;
        vec3 fq = fract(d * 420.0) - 0.5;
        star *= smoothstep(0.5, 0.05, length(fq));
        // 오로라: 하늘 위 평면들을 몇 겹 찍어서 커튼 높이를 만듦
        vec3 aur = vec3(0.0);
        if (h > 0.02) {
          for (int k = 0; k < 7; k++) {
            float fk = float(k) / 6.0;
            float H = 1.0 + fk * 1.3;           // 층 높이
            vec2 p = d.xz / h * H * 1.7;         // 그 층과 만나는 곳
            p = vec2(p.x * 0.8 + p.y * 0.6, -p.x * 0.6 + p.y * 0.8); // 커튼 방향 기울임
            float a = curtain(p, time + fk * 3.0);
            // 아래쪽 = 밝은 초록, 가운데 청록, 위 = 보라
            vec3 ac = mix(vec3(0.25, 1.0, 0.55), vec3(0.15, 0.85, 0.95), smoothstep(0.0, 0.5, fk));
            ac = mix(ac, vec3(0.62, 0.35, 1.0), smoothstep(0.45, 1.0, fk));
            aur += ac * a * (1.0 - fk * 0.55) * (fk < 0.01 ? 1.4 : 1.0);
          }
          aur *= 0.16 * aurora * smoothstep(0.02, 0.2, h) * (1.0 - smoothstep(0.75, 1.0, h) * 0.6);
          // 천천히 숨 쉬듯 밝아졌다 어두워짐
          aur *= 0.75 + 0.25 * sin(time * 0.21) * sin(time * 0.13 + 1.0);
        }
        col += aur;
        col += vec3(0.9, 0.95, 1.0) * star * (1.0 - min(length(aur) * 2.0, 0.8));
        // 달 (작은 원 + 은은한 빛무리)
        float md = max(dot(d, normalize(moonDir)), 0.0);
        col += vec3(0.95, 0.97, 1.0) * smoothstep(0.99955, 0.99975, md) * 1.2;
        col += vec3(0.55, 0.65, 0.9) * (pow(md, 400.0) * 0.35 + pow(md, 30.0) * 0.08);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // 지평선 근처·아래는 먼 산의 안개 색과 같게 (안개는 화면 색 공간에서 섞이므로 여기서)
        float hz = smoothstep(0.1, -0.01, h);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogSRGB, hz);
      }`,
  });
}

/** 안개를 fogScale만큼만 받는 Lambert (꼭짓점 색) — 먼 설산이 하늘에 묻히지 않게 */
export function fogLambert({ fogScale = 1, key = 'glacierFog', ...opts } = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
  m.userData.fogScale = { value: fogScale };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.fogScale = m.userData.fogScale;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float fogScale;')
      .replace(
        '#include <fog_fragment>',
        '#ifdef USE_FOG\n float fogFactor = smoothstep(fogNear, fogFar, vFogDepth) * fogScale;\n gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);\n#endif',
      );
  };
  m.customProgramCacheKey = () => key;
  return m;
}

// ---------------------------------------------------------------- 도우미
/** 비인덱스 지오메트리에 한 가지 색 (또는 꼭짓점마다 fn(x,y,z,nx,ny,nz) → Color) 칠하기 */
export function paintGeo(g, colorOrFn) {
  g = g.index ? g.toNonIndexed() : g;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    if (typeof colorOrFn === 'function') colorOrFn(c, p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
    else c.set(colorOrFn);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
/** 꼭짓점 색까지 있는 지오메트리 여러 개를 하나로 */
export function mergeColored(list) {
  const out = mergeSimple(list);
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// ---------------------------------------------------------------- 모양
/** 눈 덮인 전나무 (바닥 = 0, 높이 약 1 = 나중에 scale로 키움): 원뿔 4층 + 줄기. 층마다 위쪽은 눈(흰색), 아래 가장자리는 짙은 초록 */
export function snowPineGeo(seed = 1, segs = 7) {
  const r = seededRandom(seed);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.22, 5, 1, true).translate(0, 0.11, 0);
  parts.push(paintGeo(trunk, '#4a3426'));
  const tiers = 4;
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers;
    const rad = 0.36 * (1 - f * 0.68) * (0.92 + r() * 0.16);
    const h = 0.36 - f * 0.05;
    const y0 = 0.14 + f * 0.62;
    const cone = new THREE.ConeGeometry(rad, h, segs, 1, true).toNonIndexed();
    cone.rotateY(r() * TAU);
    cone.translate(0, y0 + h / 2, 0);
    const top = y0 + h;
    parts.push(paintGeo(cone, (c, x, y) => {
      const u = (y - y0) / h; // 0 = 가장자리, 1 = 꼭대기
      // 위쪽 절반은 눈, 아래는 초록 (조금 들쭉날쭉)
      const snow = THREE.MathUtils.smoothstep(u + Math.sin(x * 40) * 0.08, 0.25, 0.62);
      c.setRGB(0.09, 0.2, 0.15).lerp(new THREE.Color(0.86, 0.9, 0.96), snow);
      if (y >= top - 1e-4) c.setRGB(0.93, 0.95, 1.0);
    }));
  }
  const g = mergeColored(parts);
  g.computeVertexNormals();
  return g;
}
/** 먼 숲용 아주 간단한 전나무 (원뿔 하나, 삼각형 10개) */
export function farPineGeo() {
  const cone = new THREE.ConeGeometry(0.3, 1, 5, 1, true).toNonIndexed().translate(0, 0.5, 0);
  const g = paintGeo(cone, (c, x, y) => c.setRGB(0.1, 0.2, 0.17).lerp(new THREE.Color(0.82, 0.87, 0.94), THREE.MathUtils.smoothstep(y, 0.35, 0.8)));
  g.computeVertexNormals();
  return g;
}
/** 눈 모자를 쓴 바위 (반지름 약 1, 원점 = 가운데): 위를 보는 면은 눈 */
export function snowRockGeo(seed, detail = 1, flat = 0.7) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const nz = makeNoise(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + nz(v.x * 1.7, v.y * 1.7 + v.z, 2) * 0.42);
    v.y *= flat;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  const snowC = new THREE.Color('#eef3fb'), rockC = new THREE.Color('#5b6574'), rockD = new THREE.Color('#3c4350');
  return paintGeo(ng, (c, x, y, z, nx, ny) => {
    const k = THREE.MathUtils.smoothstep(ny + nz(x * 3, z * 3, 1) * 0.25, 0.35, 0.6);
    c.copy(rockD).lerp(rockC, THREE.MathUtils.clamp(y + 0.5, 0, 1)).lerp(snowC, k);
  });
}
/** 통나무 오두막 (바닥 = 0, 앞 = +z, 폭 8 × 깊이 7): 벽·지붕(눈)·굴뚝 = 꼭짓점 색. 창문은 windows로 따로 (불빛 재질) */
export function cabinGeo() {
  const wood = '#6b4530', woodD = '#4d3122', snow = '#eef2f8', stone = '#7c8088';
  const parts = [
    [8, 0.6, 7, 0, 0.3, 0, stone],
    [7.6, 3.4, 6.6, 0, 2.3, 0, wood],
    [7.7, 0.16, 6.7, 0, 1.4, 0, woodD],
    [7.7, 0.16, 6.7, 0, 2.6, 0, woodD],
    [1.2, 2.1, 0.12, 0, 1.65, 3.34, woodD], // 문
    [1.0, 4.2, 1.0, 2.6, 5.4, -1.4, stone], // 굴뚝
    [1.15, 0.3, 1.15, 2.6, 7.55, -1.4, snow],
  ];
  const g = colorBoxes(parts);
  // 박공 지붕 (눈 덮임): 기울인 판 두 장 + 박공 벽 삼각형
  const roof = [];
  const pitch = 0.62, half = 4.3, L = 8.4;
  for (const s of [-1, 1]) {
    const b = new THREE.BoxGeometry(half / Math.cos(pitch), 0.5, L).toNonIndexed();
    b.rotateZ(-s * pitch);
    b.translate(s * half * 0.5, 4.0 + Math.tan(pitch) * half * 0.5, 0);
    roof.push(paintGeo(b, (c, x, y, z, nx, ny) => c.set(ny > 0.3 ? snow : woodD)));
  }
  const tri = new THREE.BufferGeometry();
  const ty = 4.0, th = Math.tan(pitch) * 3.8;
  const tp = [];
  for (const zz of [3.3, -3.3]) {
    const f = zz > 0 ? 1 : -1;
    if (f > 0) tp.push(-3.8, ty, zz, 3.8, ty, zz, 0, ty + th, zz);
    else tp.push(3.8, ty, zz, -3.8, ty, zz, 0, ty + th, zz);
  }
  tri.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((tp.length / 3) * 2).fill(0), 2));
  tri.computeVertexNormals();
  roof.push(paintGeo(tri, wood));
  const out = mergeColored([g, ...roof]);
  out.computeVertexNormals();
  return out;
}
/** 오두막 창문 (cabinGeo와 같은 좌표) — 따뜻한 불빛 재질로 따로 그림 */
export function cabinWindowsGeo() {
  const parts = [];
  for (const x of [-2.4, 2.4]) parts.push([1.3, 1.0, 0.1, x, 2.6, 3.36, '#ffffff']);
  for (const z of [-1.6, 1.6]) {
    parts.push([0.1, 1.0, 1.2, 3.86, 2.6, z, '#ffffff']);
    parts.push([0.1, 1.0, 1.2, -3.86, 2.6, z, '#ffffff']);
  }
  parts.push([0.9, 0.9, 0.1, 0, 5.0, 3.42, '#ffffff']); // 다락 창
  const g = colorBoxes(parts);
  g.deleteAttribute('color');
  return g;
}
/** 풍력 발전기 기둥 + 머리 (바닥 = 0, 높이 h, 머리 앞 = +z) */
export function turbineTowerGeo(h = 60) {
  const tower = paintGeo(new THREE.CylinderGeometry(1.0, 2.0, h, 12, 1, true).translate(0, h / 2, 0), '#e9edf2');
  const band = paintGeo(new THREE.CylinderGeometry(2.02, 2.05, 1.6, 12, 1, true).translate(0, 4, 0), '#e04a3a');
  const head = paintGeo(new THREE.BoxGeometry(2.4, 2.6, 7).translate(0, h + 1, -0.8), '#f2f4f7');
  const hub = paintGeo(new THREE.SphereGeometry(1.1, 10, 6).scale(1, 1, 1.5).translate(0, h + 1, 3.1), '#f2f4f7');
  const g = mergeColored([tower, band, head, hub]);
  g.computeVertexNormals();
  return g;
}
/** 풍력 발전기 날개 3장 (원점 = 허브, 날개는 xy 평면, 길이 L) — 돌릴 때 z축으로 회전 */
export function turbineRotorGeo(L = 26) {
  const list = [];
  for (let k = 0; k < 3; k++) {
    const b = new THREE.BufferGeometry();
    // 끝이 가는 날개 한 장 (두께 조금)
    const w0 = 1.5, w1 = 0.35;
    const P = [
      [-w0 / 2, 0.8, 0.15], [w0 / 2, 0.8, 0.15], [w1 / 2, L, 0], [-w1 / 2, L, 0],
      [-w0 / 2, 0.8, -0.15], [w0 / 2, 0.8, -0.15], [w1 / 2, L, 0], [-w1 / 2, L, 0],
    ];
    const idx = [0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6];
    const pos = [];
    for (const i of idx) pos.push(...P[i]);
    b.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    b.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(idx.length * 2).fill(0), 2));
    b.computeVertexNormals();
    b.rotateZ((k / 3) * TAU);
    list.push(paintGeo(b, (c, x, y) => c.set(Math.hypot(x, y) > L - 3 ? '#e04a3a' : '#f4f6f9')));
  }
  const g = mergeColored(list);
  g.computeVertexNormals();
  return g;
}
/** 눈 울타리 판 하나 (폭 4 m, 높이 1.5 m, 원점 = 가운데 바닥): 주황 나무 살 + 기둥 */
export function snowFenceGeo() {
  const parts = [];
  for (let k = 0; k < 9; k++) parts.push([0.16, 1.4, 0.05, -1.8 + k * 0.45, 0.85, 0, '#e8642a']);
  parts.push([4.0, 0.1, 0.08, 0, 0.55, 0.05, '#7a4a2a'], [4.0, 0.1, 0.08, 0, 1.3, 0.05, '#7a4a2a']);
  parts.push([0.14, 1.8, 0.14, -2, 0.9, 0.1, '#5a3a24'], [0.14, 1.8, 0.14, 2, 0.9, 0.1, '#5a3a24']);
  const g = colorBoxes(parts);
  g.computeVertexNormals();
  return g;
}
/** 날아가는 새 한 마리 (V자 날개, 폭 약 1.4 m, 앞 = +z) */
export function birdGeo() {
  const b = new THREE.BufferGeometry();
  const pos = [
    0, 0, 0.35, -0.7, 0.12, -0.05, 0, 0, -0.25,
    0, 0, 0.35, 0, 0, -0.25, 0.7, 0.12, -0.05,
  ];
  b.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  b.computeVertexNormals();
  return b;
}

// ---------------------------------------------------------------- 그림
/** 얼음 터널 껍질 그림: 푸른 바탕 + 세로 줄무늬 + 갈라진 금 (반복) */
export function iceTexture(seed = 7) {
  return canvasTexture(256, 256, (c, w, h) => {
    const r = seededRandom(seed);
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#9fd6ff');
    g.addColorStop(0.5, '#cdeeff');
    g.addColorStop(1, '#9fd6ff');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let k = 0; k < 60; k++) {
      c.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '70,150,220'},${0.05 + r() * 0.12})`;
      c.fillRect(r() * w, 0, 2 + r() * 10, h);
    }
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    for (let k = 0; k < 14; k++) {
      c.lineWidth = 0.6 + r() * 1.4;
      c.beginPath();
      let x = r() * w, y = r() * h;
      c.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (r() - 0.5) * 50;
        y += (r() - 0.5) * 50;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  });
}
/** 얼어붙은 호수 그림: 짙은 청록 얼음 + 하얀 금 + 눈 얼룩 */
export function lakeIceTexture(seed = 21) {
  return canvasTexture(512, 512, (c, w, h) => {
    const r = seededRandom(seed);
    c.fillStyle = '#5f97b8';
    c.fillRect(0, 0, w, h);
    for (let k = 0; k < 40; k++) {
      const x = r() * w, y = r() * h, rad = 20 + r() * 90;
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      const a = 0.08 + r() * 0.18;
      g.addColorStop(0, r() < 0.5 ? `rgba(230,242,252,${a})` : `rgba(30,80,120,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
    c.strokeStyle = 'rgba(235,248,255,0.7)';
    for (let k = 0; k < 28; k++) {
      c.lineWidth = 0.5 + r() * 1.6;
      c.beginPath();
      let x = r() * w, y = r() * h, a = r() * TAU;
      c.moveTo(x, y);
      for (let s = 0; s < 9; s++) {
        a += (r() - 0.5) * 1.2;
        x += Math.cos(a) * 22;
        y += Math.sin(a) * 22;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  });
}
/**
 * 표지판 묶음: cells = [{ title, sub, bg, fg, accent }] 를 cols×rows 칸 한 장에 그림
 *   돌려줌: { tex, uv(i) → [u0, v0, u1, v1] } — 같은 재질을 여러 판이 같이 쓰게 (staticBatch가 하나로 합침)
 */
export function signAtlas(cells, { cols = 4, rows = 4, cw = 512, ch = 192 } = {}) {
  const tex = canvasTexture(cols * cw, rows * ch, (c) => {
    cells.forEach((cell, i) => {
      const x0 = (i % cols) * cw, y0 = Math.floor(i / cols) * ch;
      const { title = '', sub = '', bg = '#123', fg = '#fff', accent = '#7fe8ff', logo = null } = cell;
      c.fillStyle = bg;
      c.fillRect(x0, y0, cw, ch);
      c.fillStyle = accent;
      c.fillRect(x0, y0, cw, ch * 0.07);
      c.fillRect(x0, y0 + ch * 0.93, cw, ch * 0.07);
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = 4;
      c.strokeRect(x0 + 8, y0 + ch * 0.1, cw - 16, ch * 0.8);
      let lx = x0 + cw / 2;
      if (logo) {
        // 작은 그림 (산·눈송이·번개 등)
        const cx = x0 + ch * 0.55, cy = y0 + ch / 2, R = ch * 0.28;
        c.fillStyle = accent;
        c.strokeStyle = accent;
        c.lineWidth = 6;
        if (logo === 'peak') {
          c.beginPath();
          c.moveTo(cx - R * 1.2, cy + R * 0.8);
          c.lineTo(cx - R * 0.2, cy - R * 0.9);
          c.lineTo(cx + R * 0.3, cy - R * 0.1);
          c.lineTo(cx + R * 0.6, cy - R * 0.5);
          c.lineTo(cx + R * 1.2, cy + R * 0.8);
          c.closePath();
          c.fill();
        } else if (logo === 'flake') {
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU;
            c.beginPath();
            c.moveTo(cx, cy);
            c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
            c.stroke();
          }
        } else if (logo === 'bolt') {
          c.beginPath();
          c.moveTo(cx + R * 0.2, cy - R);
          c.lineTo(cx - R * 0.6, cy + R * 0.15);
          c.lineTo(cx, cy + R * 0.15);
          c.lineTo(cx - R * 0.2, cy + R);
          c.lineTo(cx + R * 0.6, cy - R * 0.15);
          c.lineTo(cx, cy - R * 0.15);
          c.closePath();
          c.fill();
        } else if (logo === 'ring') {
          c.beginPath();
          c.arc(cx, cy, R, 0, TAU);
          c.stroke();
          c.beginPath();
          c.arc(cx, cy, R * 0.45, 0, TAU);
          c.fill();
        }
        lx = x0 + ch + (cw - ch) / 2;
      }
      const maxW = (logo ? cw - ch : cw) * 0.88;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      let s = Math.round(ch * (sub ? 0.4 : 0.52));
      do c.font = `900 ${s}px ${FONT}`;
      while (c.measureText(title).width > maxW && (s -= 3) > 10);
      c.fillStyle = fg;
      c.fillText(title, lx, y0 + ch * (sub ? 0.42 : 0.52));
      if (sub) {
        let s2 = Math.round(ch * 0.17);
        do c.font = `700 ${s2}px ${FONT}`;
        while (c.measureText(sub).width > maxW && (s2 -= 2) > 8);
        c.fillStyle = accent;
        c.fillText(sub, lx, y0 + ch * 0.74);
      }
    });
  }, false);
  return {
    tex,
    uv(i) {
      const cx = i % cols, cy = Math.floor(i / cols);
      return [cx / cols, 1 - (cy + 1) / rows, (cx + 1) / cols, 1 - cy / rows];
    },
  };
}
/** 판(PlaneGeometry)의 uv를 묶음 칸 하나로 바꿈 */
export function planeWithUV(w, h, [u0, v0, u1, v1]) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}
