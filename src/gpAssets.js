// 구름섬 그랑프리 · Sky Harbor 용 구조물 모델 모음 (트랙 주변에 배치하는 장식).
// 모든 팩토리는 { obj, update?(time, dt) } 를 돌려줍니다. 단위 m, y 위쪽,
// 원점은 바닥 접점(0,0,0), 특별한 말이 없으면 +z 를 바라봅니다.
//
// 성능 메모
//   - 지오메트리/재질/텍스처는 모듈 단위로 캐시해서 여러 개를 놓아도 공유합니다.
//   - 움직이지 않는 부분은 bake() 로 재질별 한 덩어리로 합쳐 드로우콜을 줄이고,
//     같은 설정의 모델은 그 결과(템플릿)를 clone 해서 지오메트리를 공유합니다.
//   - 관중, 철골, 깃발 줄처럼 반복되는 작은 부품은 InstancedMesh 를 씁니다.
//   - 그림자는 큰 덩어리만 castShadow, 나머지는 receiveShadow 만.
import * as THREE from 'three';
import { canvasTexture } from './track.js';

const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI Symbol", "Segoe UI Emoji", sans-serif';

// 팔레트
const RED = '#e8463a';
const BLUE = '#2e6fd8';
const YEL = '#ffcf3f';
const WHITE = '#f6f7fb';
const TEAL = '#19b3a6';
const PURP = '#7a3cff';
const NAVY = '#1d2433';
const ORANGE = '#ff8a1f';
const PINK = '#ff5fa2';
const GREEN = '#3ccf4e';
const TEAMS = [RED, BLUE, YEL, TEAL, PURP, ORANGE, PINK, GREEN];

// ---------------------------------------------------------------- 공용 도우미
const _memo = new Map();
function memo(key, fn) {
  let v = _memo.get(key);
  if (v === undefined) _memo.set(key, (v = fn()));
  return v;
}

// 재질
const lam = (color) => memo('lam' + color, () => new THREE.MeshLambertMaterial({ color, flatShading: true }));
const lamSmooth = (color) => memo('lams' + color, () => new THREE.MeshLambertMaterial({ color }));
const glow = (color) => memo('glow' + color, () => new THREE.MeshBasicMaterial({ color }));
const glass = (color = '#8fd3ff') =>
  memo('glass' + color, () =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0.35, emissive: '#2c6aa8', emissiveIntensity: 0.35, flatShading: true }),
  );

// 지오메트리
const box = (w, h, d) => memo(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s = 10, open = false) => memo(`cyl${rt},${rb},${h},${s},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open));
const sph = (r, ws = 10, hs = 7) => memo(`sph${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const ico = (r, d = 0) => memo(`ico${r},${d}`, () => new THREE.IcosahedronGeometry(r, d));
const torus = (r, t, rs, ts) => memo(`tor${r},${t},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));

// 메시 하나를 만들어 parent 에 붙임. o: { rx, ry, rz, s, cast }
function put(parent, geo, mat, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (o.rx) m.rotation.x = o.rx;
  if (o.ry) m.rotation.y = o.ry;
  if (o.rz) m.rotation.z = o.rz;
  if (o.s !== undefined) Array.isArray(o.s) ? m.scale.set(o.s[0], o.s[1], o.s[2]) : m.scale.setScalar(o.s);
  m.castShadow = !!o.cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// 시드 난수
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// 여러 지오메트리를 하나로 합침 (non-indexed). parts: [{ g, m?: Matrix4, c?: 색 또는 (x,y,z)=>색 }]
function merge(parts) {
  const prep = parts.map((p) => {
    let g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    if (p.range) {
      // 다중 재질 지오메트리의 한 그룹만 잘라냄
      const [st, cnt] = p.range;
      const sub = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv', 'color']) {
        const A = g.attributes[k];
        if (A) sub.setAttribute(k, new THREE.BufferAttribute(A.array.slice(st * A.itemSize, (st + cnt) * A.itemSize), A.itemSize));
      }
      g.dispose();
      g = sub;
    }
    if (p.m) g.applyMatrix4(p.m);
    return { g, c: p.c };
  });
  let n = 0;
  for (const p of prep) n += p.g.attributes.position.count;
  const hasCol = prep.some((p) => p.c !== undefined || p.g.attributes.color);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = hasCol ? new Float32Array(n * 3) : null;
  const tc = new THREE.Color();
  let o = 0;
  for (const { g, c } of prep) {
    const P = g.attributes.position;
    const cnt = P.count;
    pos.set(P.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (col && c === undefined && g.attributes.color) col.set(g.attributes.color.array, o * 3);
    else if (col) {
      for (let t = 0; t < cnt; t += 3) {
        if (typeof c === 'function') {
          const a = P.array;
          const i = t * 3;
          tc.set(c((a[i] + a[i + 3] + a[i + 6]) / 3, (a[i + 1] + a[i + 4] + a[i + 7]) / 3, (a[i + 2] + a[i + 5] + a[i + 8]) / 3));
        } else tc.set(c ?? '#ffffff');
        for (let k = 0; k < 3; k++) col.set([tc.r, tc.g, tc.b], (o + t + k) * 3);
      }
    }
    o += cnt;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// 움직이지 않는 메시들을 재질별로 합침. userData.keep 이 붙은 노드(와 그 자식)는 그대로 둠.
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    for (let p = o; p && p !== root; p = p.parent) if (p.userData.keep) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    // 다중 재질이면 그룹별로 나눠서 각 재질 묶음에 넣음
    const pieces = Array.isArray(o.material)
      ? o.geometry.groups.map((gr) => ({ mat: o.material[gr.materialIndex], range: [gr.start, gr.count] }))
      : [{ mat: o.material }];
    for (const pc of pieces) {
      const k = pc.mat.uuid + (o.castShadow ? '|c' : '|n');
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { mat: pc.mat, cast: o.castShadow, parts: [] }));
      b.parts.push({ g: o.geometry, m, range: pc.range });
    }
    victims.push(o);
  });
  for (const o of victims) o.parent.remove(o);
  for (const b of buckets.values()) {
    const m = new THREE.Mesh(merge(b.parts), b.mat);
    m.castShadow = b.cast;
    m.receiveShadow = true;
    root.add(m);
  }
  return root;
}

// 같은 키의 정적 모델은 한 번만 만들고 clone (지오메트리·재질 공유)
function template(key, build) {
  const t = memo('tpl' + key, () => bake(build()));
  return t.clone();
}

// 막대(철골) 묶음: 끝점 쌍 목록 → InstancedMesh 하나. list: [[ax,ay,az],[bx,by,bz], 두께?, 색?]
const _up = new THREE.Vector3(0, 1, 0);
function struts(list, thick, mat, cast = true) {
  const g = memo('strutGeo', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const im = new THREE.InstancedMesh(g, mat, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const a = new THREE.Vector3();
  const d = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  list.forEach(([A, B, t, col], i) => {
    a.fromArray(A);
    d.fromArray(B).sub(a);
    const L = d.length();
    q.setFromUnitVectors(_up, d.normalize());
    s.set(t ?? thick, L, t ?? thick);
    m.compose(a, q, s);
    im.setMatrixAt(i, m);
    if (col) im.setColorAt(i, c.set(col));
  });
  im.castShadow = cast;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

// 글자 폭에 맞게 폰트 크기를 줄임
function fitFont(g, text, maxW, size, weight = 900) {
  let s = size;
  for (;;) {
    g.font = `${weight} ${s}px ${FONT}`;
    if (g.measureText(text).width <= maxW || s <= 10) return s;
    s -= 2;
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 텍스처 하나를 repeat 만 다르게 공유
function texRepeat(tex, rx, ry = 1) {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

// 스폰서 띠 (관중석 광고판·지붕 처마)
const sponsorTex = () =>
  memo('sponsorTex', () =>
    canvasTexture(1024, 128, (g, w, h) => {
      const blocks = [
        [RED, '#ffffff', 'SKY HARBOR'],
        ['#ffffff', BLUE, '구름섬 그랑프리'],
        [YEL, NAVY, 'BOOST ⚡'],
        [TEAL, '#ffffff', 'CLOUD 9'],
      ];
      const bw = w / blocks.length;
      blocks.forEach(([bg, fg, text], i) => {
        g.fillStyle = bg;
        g.fillRect(i * bw, 0, bw, h);
        g.fillStyle = fg;
        fitFont(g, text, bw * 0.86, 64);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, i * bw + bw / 2, h / 2 + 4);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(i * bw, h - 10, bw, 10);
      });
    }),
  );

// 체커 무늬
const checkerTex = () =>
  memo('checkerTex', () =>
    canvasTexture(64, 16, (g, w, h) => {
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 2; j++) {
          g.fillStyle = (i + j) % 2 ? '#111318' : '#ffffff';
          g.fillRect(i * 8, j * 8, 8, 8);
        }
    }),
  );

// 흔들리는 깃발: 왼쪽 위 모서리가 (0,0,0)
function makeFlag(w, h, mat, sx = 10, sy = 5) {
  const g = new THREE.PlaneGeometry(w, h, sx, sy);
  g.translate(w / 2, -h / 2, 0);
  const base = g.attributes.position.array.slice();
  const mesh = new THREE.Mesh(g, mat);
  mesh.userData.keep = true;
  mesh.receiveShadow = true;
  return {
    mesh,
    update(t, phase = 0, amp = 1) {
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const x = base[i];
        const k = x / w;
        p[i + 2] = Math.sin(x * (5.5 / w) - t * 5.2 + phase) * (0.05 + 0.16 * k) * w * amp + Math.sin(t * 1.7 + phase) * 0.04 * w * k;
        p[i + 1] = base[i + 1] - k * k * 0.06 * h + Math.sin(x * 3 / w - t * 4 + phase) * 0.03 * h * k;
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}

const flagTex = (color) =>
  memo('flagTex' + color, () =>
    canvasTexture(160, 100, (g, w, h) => {
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.fillRect(0, h * 0.72, w, h * 0.1);
      // 별
      g.beginPath();
      const cx = w * 0.42;
      const cy = h * 0.4;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 10 : 24;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    }),
  );
const flagMat = (color) =>
  memo('flagMat' + color, () => new THREE.MeshLambertMaterial({ map: flagTex(color), side: THREE.DoubleSide, flatShading: true }));

// 깜빡이는 표지등 재질 (모든 비컨이 같이 깜빡임)
const beaconOn = new THREE.Color('#ff3020');
const beaconOff = new THREE.Color('#5a1410');
const beaconMat = () => memo('beaconMat', () => new THREE.MeshBasicMaterial({ color: '#ff3020', toneMapped: false }));
function blinkBeacon(t) {
  beaconMat().color.copy(t % 1.6 < 0.35 ? beaconOn : beaconOff);
}

// ================================================================ 관중석
// 앞(도로 쪽) 가장자리 x=0, +x 로 약 14 m, z 는 -length/2..length/2
const GS = { rows: 8, D: 1.45, R: 0.62, front: 1.4, walk: 0.9 };

function crowdMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  const u = { uTime: { value: 0 }, uExcite: { value: 0.3 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = m.userData.u.uTime;
    sh.uniforms.uExcite = m.userData.u.uExcite;
    sh.vertexShader =
      'uniform float uTime;\nuniform float uExcite;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.71 + instanceMatrix[3].z * 1.37;
          float sp = 7.0 + fract(ph * 3.1) * 4.0;
          float hop = abs(sin(uTime * sp + ph * 6.2831));
          transformed.y += uExcite * hop * 0.32 + 0.02 * sin(uTime * 2.3 + ph);
          if (abs(position.z) > 0.26) transformed.z += sign(position.z) * uExcite * sin(uTime * sp * 0.5 + ph) * 0.12 * max(position.y - 0.9, 0.0) * 2.0;
        #endif`,
      );
  };
  return m;
}

// 응원하는 사람: 몸통+두 팔(만세), 머리는 따로
const personBodyGeo = () =>
  memo('personBody', () => {
    const M = (x, y, z, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1));
    return merge([
      { g: box(0.42, 1.06, 0.5), m: M(0, 0.53, 0) },
      { g: box(0.13, 0.6, 0.13), m: M(0, 1.28, 0.36, 0.38) },
      { g: box(0.13, 0.6, 0.13), m: M(0, 1.28, -0.36, -0.38) },
    ]);
  });

export function grandstand({ length = 60, roofColor = RED } = {}) {
  const L = length;
  const { rows, D, R, front, walk } = GS;
  const yTop = front + rows * R;
  const xBack = walk + rows * D;
  const roofFrontY = yTop + 6.2;
  const roofBackY = roofFrontY - 1.0;
  const nSeg = Math.max(1, Math.round(L / 14));
  const aisles = [];
  for (let k = 1; k < nSeg; k++) aisles.push(-L / 2 + (k * L) / nSeg);

  const obj = template(`gs${L}${roofColor}`, () => {
    const g = new THREE.Group();
    // 계단식 콘크리트 몸체 (단면을 길이 방향으로 밀어냄)
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(0, front);
    sh.lineTo(walk, front);
    for (let i = 0; i < rows; i++) {
      const x0 = walk + i * D;
      const y1 = front + (i + 1) * R;
      sh.lineTo(x0, y1);
      sh.lineTo(x0 + D, y1);
    }
    sh.lineTo(xBack + 0.8, yTop);
    sh.lineTo(xBack + 0.8, yTop + 1.0);
    sh.lineTo(14, yTop + 1.0);
    sh.lineTo(14, 0);
    sh.closePath();
    const body = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false });
    body.translate(0, 0, -L / 2);
    put(g, body, lam('#e4e8ee'), 0, 0, 0, { cast: true });
    // 좌석 (줄마다 파랑 톤 번갈아), 통로는 비움
    const edges = [-L / 2, ...aisles, L / 2];
    for (let i = 0; i < rows; i++) {
      const x0 = walk + i * D;
      const y1 = front + (i + 1) * R;
      const mat = lam(i % 2 ? '#4f93f5' : BLUE);
      for (let k = 0; k < edges.length - 1; k++) {
        const z0 = edges[k] + (k ? 0.7 : 0.3);
        const z1 = edges[k + 1] - (k < edges.length - 2 ? 0.7 : 0.3);
        put(g, box(0.5, 0.42, 1), mat, x0 + D - 0.35, y1 + 0.21, (z0 + z1) / 2, { s: [1, 1, z1 - z0] });
      }
      // 통로 계단 끝 노란 줄
      for (const z of aisles) put(g, box(0.22, 0.05, 1.3), lam(YEL), x0 + 0.11, y1 + 0.03, z);
    }
    // 앞 난간 광고판 (도로 쪽 -x 를 바라봄)
    const ad = new THREE.Mesh(
      memo(`plane${L},${front}`, () => new THREE.PlaneGeometry(L, front - 0.1)),
      memo('adMat' + L, () => new THREE.MeshLambertMaterial({ map: texRepeat(sponsorTex(), Math.max(1, Math.round(L / 11.2))) })),
    );
    ad.rotation.y = -Math.PI / 2;
    ad.position.set(-0.02, front / 2, 0);
    ad.receiveShadow = true;
    g.add(ad);
    put(g, box(0.9, 0.12, L), lam(WHITE), 0.45, front + 0.06, 0);
    // 뒷벽 장식: 광고 띠 + 파란 줄
    const ad2 = ad.clone();
    ad2.rotation.y = Math.PI / 2;
    ad2.position.set(14.02, 3.2, 0);
    g.add(ad2);
    put(g, box(0.12, 0.5, L), lam(BLUE), 14.04, 4.3, 0);
    // 기둥: 뒤쪽 굵은 기둥 + 앞쪽 가는 기둥
    const nCol = Math.max(2, Math.round(L / 15) + 1);
    for (let k = 0; k < nCol; k++) {
      const z = -L / 2 + 0.6 + (k * (L - 1.2)) / (nCol - 1);
      put(g, box(0.6, roofBackY - yTop, 0.6), lam(WHITE), 13.65, (yTop + roofBackY) / 2 + 0.5, z, { cast: true });
      put(g, cyl(0.16, 0.2, roofFrontY - front, 8), lam(WHITE), 0.45, (front + roofFrontY) / 2, z);
    }
    // 옆 날개벽 (지붕 색)
    const fin = new THREE.Shape();
    fin.moveTo(walk - 0.3, front);
    fin.lineTo(14, yTop + 1.0);
    fin.lineTo(14, roofBackY + 0.1);
    fin.lineTo(1.8, roofFrontY - 0.05);
    fin.closePath();
    const finGeo = memo('gsFin', () => new THREE.ExtrudeGeometry(fin, { depth: 0.35, bevelEnabled: false }));
    put(g, finGeo, lam(roofColor), 0, 0, L / 2, { cast: true });
    put(g, finGeo, lam(roofColor), 0, 0, -L / 2 - 0.35, { cast: true });
    // 지붕: 위 = 지붕색, 아래 = 흰색
    const roofW = 15.8;
    const roofTilt = Math.atan2(roofFrontY - roofBackY, roofW);
    const roof = new THREE.Mesh(memo(`gsRoof${L}`, () => new THREE.BoxGeometry(roofW, 0.4, L + 1.2)), [
      lam(roofColor), lam(roofColor), lam(roofColor), lam('#ffffff'), lam(roofColor), lam(roofColor),
    ]);
    roof.position.set(-1.2 + roofW / 2, (roofFrontY + roofBackY) / 2 + 0.2, 0);
    roof.rotation.z = -roofTilt;
    roof.castShadow = true;
    roof.receiveShadow = true;
    g.add(roof);
    // 처마 스폰서 띠 (도로 쪽 -x 면)
    const fascia = new THREE.Mesh(memo(`gsFascia${L}`, () => new THREE.BoxGeometry(0.4, 1.9, L + 1.4)), [
      lam('#ffffff'),
      memo('fasciaMat' + L, () => new THREE.MeshLambertMaterial({ map: texRepeat(sponsorTex(), Math.max(1, Math.round(L / 15.2))) })),
      lam(roofColor), lam(roofColor), lam(roofColor), lam(roofColor),
    ]);
    fascia.position.set(-1.35, roofFrontY + 0.25, 0);
    fascia.castShadow = true;
    fascia.receiveShadow = true;
    g.add(fascia);
    return g;
  });


  // 관중 (인스턴스, 셰이더로 들썩임)
  const rand = rng(L * 31 + 7);
  const spots = [];
  for (let i = 0; i < rows; i++) {
    const x = walk + i * D + D * 0.4;
    const y = front + (i + 1) * R;
    for (let z = -L / 2 + 0.6; z <= L / 2 - 0.6; z += 0.74) {
      if (aisles.some((a) => Math.abs(z - a) < 0.85)) continue;
      if (rand() > 0.84) continue;
      spots.push([x + (rand() - 0.5) * 0.15, y, z + (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.6]);
    }
  }
  const cmat = crowdMaterial();
  const bodies = new THREE.InstancedMesh(personBodyGeo(), cmat, spots.length);
  const heads = new THREE.InstancedMesh(ico(0.2, 0), cmat, spots.length);
  const shirts = [RED, BLUE, YEL, WHITE, TEAL, PURP, ORANGE, PINK, GREEN, '#ffffff', '#ffe27a', '#8fd0ff'];
  const skins = ['#f5d0a9', '#e8b48a', '#c98d62', '#8d5a3b', '#ffe0bd'];
  const mm = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  spots.forEach(([x, y, z, ry], i) => {
    q.setFromAxisAngle(_up, ry);
    const s = 0.9 + rand() * 0.2;
    mm.compose(p.set(x, y, z), q, one.set(1, s, 1));
    bodies.setMatrixAt(i, mm);
    bodies.setColorAt(i, c.set(shirts[Math.floor(rand() * shirts.length)]));
    mm.compose(p.set(x, y + 1.06 * s + 0.2, z), q, one.set(1, 1, 1));
    heads.setMatrixAt(i, mm);
    heads.setColorAt(i, c.set(rand() < 0.22 ? shirts[Math.floor(rand() * 6)] : skins[Math.floor(rand() * skins.length)]));
  });
  for (const im of [bodies, heads]) {
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.boundingSphere.radius += 1;
    obj.add(im);
  }

  // 지붕 뒤쪽 깃발들
  const flags = [];
  const nf = Math.max(2, Math.round(L / 15));
  for (let k = 0; k < nf; k++) {
    const z = -L / 2 + ((k + 0.5) * L) / nf;
    put(obj, cyl(0.06, 0.06, 3, 6), lam('#dfe3ea'), 13.4, roofBackY + 0.4 + 1.5, z);
    const f = makeFlag(1.8, 1.1, flagMat(TEAMS[k % TEAMS.length]), 6, 3);
    f.mesh.position.set(13.4, roofBackY + 0.4 + 3, z);
    f.mesh.rotation.y = Math.PI / 2;
    obj.add(f.mesh);
    flags.push(f);
  }
  obj.name = 'grandstand';
  return {
    obj,
    halfDepth: 7,
    height: roofFrontY + 1.2,
    update(time, dt, excite = 0.35) {
      cmat.userData.u.uTime.value = time;
      cmat.userData.u.uExcite.value = excite;
      flags.forEach((f, i) => f.update(time, i * 1.3));
    },
  };
}

// ================================================================ 피트 건물
// 앞(도로 쪽) x=0, +x 로 약 16 m, z 는 -length/2..length/2
const ribTex = () =>
  memo('ribTex', () =>
    canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.16)';
      for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 2);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (let y = 3; y < h; y += 8) g.fillRect(0, y, w, 1);
    }),
  );
const doorMat = (color) => memo('door' + color, () => new THREE.MeshLambertMaterial({ color, map: texRepeat(ribTex(), 1, 5) }));
const windowTex = () =>
  memo('windowTex', () =>
    canvasTexture(128, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#d8f1ff');
      gr.addColorStop(1, '#6db7ef');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.moveTo(20, h);
      g.lineTo(60, 0);
      g.lineTo(78, 0);
      g.lineTo(38, h);
      g.fill();
      g.fillStyle = '#f4f7fb';
      g.fillRect(0, 0, 8, h);
      g.fillRect(0, h * 0.3, w, 5);
    }),
  );

export function pitBuilding({ length = 70 } = {}) {
  const L = length;
  const n = Math.max(1, Math.round(L / 6.4));
  const pitch = L / n;
  const obj = template('pit' + L, () => {
    const g = new THREE.Group();
    // 1층 몸체 (x=4..16): -x 면 = 차고 안쪽 벽. 앞 0..4 m 는 차고 공간
    const GD = 4;
    const body = new THREE.Mesh(box(16 - GD, 5, L), [lam(WHITE), lam('#5d6676'), lam(WHITE), lam(WHITE), lam(WHITE), lam(WHITE)]);
    body.position.set(GD + (16 - GD) / 2, 2.5, 0);
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    // 기둥
    for (let k = 0; k <= n; k++) put(g, box(GD, 5, 0.8), lam(WHITE), GD / 2, 2.5, -L / 2 + k * pitch, { cast: true });
    // 차고 바닥 (밝은 회색 에폭시)
    put(g, box(GD, 0.04, L), lam('#aeb5c2'), GD / 2, 0.02, 0);
    // 문 위 머리띠 (차고 번호 + 팀색)
    const header = new THREE.Mesh(box(GD + 0.05, 0.9, L), [
      lam(BLUE),
      new THREE.MeshLambertMaterial({
        map: canvasTexture(256 * n, 64, (c, w, h) => {
          c.fillStyle = BLUE;
          c.fillRect(0, 0, w, h);
          for (let k = 0; k < n; k++) {
            const x = k * 256;
            c.fillStyle = TEAMS[k % TEAMS.length];
            c.fillRect(x + 40, 12, 176, 40);
            c.fillStyle = '#ffffff';
            c.font = `900 34px ${FONT}`;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(`PIT ${k + 1}`, x + 128, 34);
          }
        }),
      }),
      lam(BLUE), lam(BLUE), lam(BLUE), lam(BLUE),
    ]);
    header.position.set(GD / 2 - 0.02, 4.55, 0);
    header.receiveShadow = true;
    g.add(header);
    // 차고 문: 2개 닫힘, 1개 반쯤 열림 (안에 조명·타이어)
    const tw = tireWallGeometry();
    for (let k = 0; k < n; k++) {
      const z = -L / 2 + (k + 0.5) * pitch;
      const dw = pitch - 0.8;
      const col = TEAMS[k % TEAMS.length];
      if (k % 3 === 1) {
        put(g, box(0.2, 0.9, dw), doorMat(col), 0.7, 3.65, z);
        put(g, box(2.4, 0.08, dw - 0.8), glow('#fff6d8'), 2.4, 4.06, z);
        // 안쪽 벽 팀색 띠, 타이어 더미, 공구함
        put(g, box(0.05, 0.6, dw), lam(col), GD + 0.03, 2.6, z);
        for (let t = 0; t < 2; t++) {
          const tm = new THREE.Mesh(tw.geo, tw.mat);
          tm.position.set(GD - 0.6, 0, z - dw * 0.32 + t * 1.0);
          g.add(tm);
        }
        put(g, box(0.7, 1.3, 1.6), lam(col), GD - 0.4, 0.65, z + dw * 0.28);
        put(g, box(0.72, 0.08, 1.62), lam('#d9dde5'), GD - 0.4, 0.95, z + dw * 0.28);
      } else {
        put(g, box(0.2, 4.1, dw), doorMat(col), 0.7, 2.05, z);
      }
    }
    // 2층 발코니 슬래브
    put(g, box(18, 0.4, L + 1), lam(WHITE), 7.1, 5.2, 0, { cast: true });
    put(g, box(0.25, 0.4, L + 1), lam(RED), -1.95, 5.2, 0);
    // 2층 유리 라운지
    const winMat = memo('pitGlass' + L, () => new THREE.MeshStandardMaterial({ map: texRepeat(windowTex(), L / 3, 1), roughness: 0.2, metalness: 0.2, emissive: '#3b78b8', emissiveIntensity: 0.25 }));
    const winSide = memo('pitGlassS', () => new THREE.MeshStandardMaterial({ map: texRepeat(windowTex(), 4, 1), roughness: 0.2, metalness: 0.2, emissive: '#3b78b8', emissiveIntensity: 0.25 }));
    const lounge = new THREE.Mesh(box(13, 3.6, L - 2), [lam(WHITE), winMat, lam(WHITE), lam(WHITE), winSide, winSide]);
    lounge.position.set(1.6 + 6.5, 5.4 + 1.8, 0);
    lounge.castShadow = lounge.receiveShadow = true;
    g.add(lounge);
    // 발코니 난간: 흰 손잡이 + 반투명 유리
    put(g, box(0.12, 0.12, L + 0.8), lam(WHITE), -1.75, 6.5, 0);
    const rg = new THREE.Mesh(box(0.05, 1.0, L + 0.8), memo('railGlass', () => new THREE.MeshLambertMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.35, depthWrite: false })));
    rg.position.set(-1.75, 5.95, 0);
    g.add(rg);
    // 지붕 + 빨간 처마
    put(g, box(18.6, 0.6, L + 1.6), lam(WHITE), 7.2, 9.3, 0, { cast: true });
    put(g, box(0.3, 0.9, L + 1.6), lam(RED), -2.1, 9.3, 0);
    put(g, box(0.31, 0.25, L + 1.62), lam(YEL), -2.1, 8.85, 0);
    // 지붕 위 설비
    put(g, box(3, 1.2, 4), lam('#c9ced8'), 12, 10.2, L * 0.3);
    put(g, box(3, 1.2, 4), lam('#c9ced8'), 12, 10.2, -L * 0.3);
    // 큰 간판 받침
    const sw = Math.min(L * 0.62, 38);
    for (const s of [-1, 1]) put(g, box(0.4, 1.6, 0.4), lam('#8b93a3'), 6, 10.4, s * sw * 0.38);
    // "SKY HARBOR" 간판 (±x 양면)
    const signTex = memo('pitSignTex', () =>
      canvasTexture(1024, 200, (g, w, h) => {
        g.fillStyle = BLUE;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 10;
        roundRect(g, 12, 12, w - 24, h - 24, 26);
        g.stroke();
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fitFont(g, 'SKY HARBOR', w * 0.8, 120);
        g.fillStyle = '#123a80';
        g.fillText('SKY HARBOR', w / 2 + 5, h * 0.42 + 6);
        g.fillStyle = '#ffffff';
        g.fillText('SKY HARBOR', w / 2, h * 0.42);
        g.fillStyle = YEL;
        g.font = `800 40px ${FONT}`;
        g.fillText('구름섬 그랑프리 · PIT LANE', w / 2, h * 0.82);
      }),
    );
    const signMat = memo('pitSignMat', () => new THREE.MeshLambertMaterial({ map: signTex }));
    const sign = new THREE.Mesh(memo('pitSign' + sw, () => new THREE.BoxGeometry(0.5, sw / 5.12, sw)), [signMat, signMat, lam(BLUE), lam(BLUE), lam(BLUE), lam(BLUE)]);
    sign.position.set(6, 11.2 + sw / 10.24, 0);
    sign.castShadow = sign.receiveShadow = true;
    g.add(sign);
    return g;
  });
  const sw = Math.min(L * 0.62, 38);
  obj.name = 'pitBuilding';
  return { obj, height: 11.2 + sw / 5.12 };
}

// ================================================================ 관제탑 (~32 m)
export function controlTower() {
  const obj = template('tower', () => {
    const g = new THREE.Group();
    put(g, cyl(5, 5.4, 5, 12), lam(WHITE), 0, 2.5, 0, { cast: true });
    put(g, cyl(5.05, 5.05, 1.4, 12, true), glass(), 0, 3.2, 0);
    put(g, cyl(5.6, 5.6, 0.4, 12), lam(BLUE), 0, 5.1, 0);
    put(g, box(2.4, 2.6, 0.4), lam('#2f3644'), 0, 1.3, 5.25);
    put(g, cyl(2.4, 2.9, 18, 12), lam(WHITE), 0, 14, 0, { cast: true });
    for (const y of [9, 14, 19]) put(g, cyl(2.75 - (y - 5) * 0.028, 2.75 - (y - 5) * 0.028, 0.6, 12), lam(BLUE), 0, y, 0);
    // 글자 띠
    const band = memo('towerBandMat', () =>
      new THREE.MeshLambertMaterial({
        map: texRepeat(
          canvasTexture(512, 64, (c, w, h) => {
            c.fillStyle = RED;
            c.fillRect(0, 0, w, h);
            c.fillStyle = '#ffffff';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            fitFont(c, 'RACE CONTROL · 관제탑', w * 0.92, 40);
            c.fillText('RACE CONTROL · 관제탑', w / 2, h / 2 + 2);
          }),
          2,
        ),
      }),
    );
    put(g, cyl(2.48, 2.5, 1.4, 16, true), band, 0, 21.7, 0);
    // 운영실 아래 받침 (깔때기)
    put(g, cyl(4.3, 2.4, 2, 12), lam(WHITE), 0, 24, 0, { cast: true });
    // 유리 운영실 (위로 벌어짐)
    put(g, cyl(4.7, 4.1, 3.4, 12), glass('#7cc6ff'), 0, 26.7, 0, { cast: true });
    const mull = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      mull.push([[Math.sin(a) * 4.12, 25, Math.cos(a) * 4.12], [Math.sin(a) * 4.72, 28.4, Math.cos(a) * 4.72]]);
    }
    g.add(struts(mull, 0.16, lam(WHITE), false));
    put(g, cyl(4.2, 4.2, 0.2, 12), lam(WHITE), 0, 25.05, 0);
    // 지붕
    put(g, cyl(5.1, 4.9, 0.7, 12), lam(RED), 0, 28.75, 0, { cast: true });
    put(g, cyl(2, 2.2, 0.9, 10), lam(WHITE), 0, 29.55, 0);
    put(g, cyl(0.08, 0.12, 2.4, 6), lam('#9aa3b3'), 0, 31.2, 0);
    return g;
  });
  const beacon = put(obj, sph(0.34, 8, 6), beaconMat(), 0, 32.5, 0);
  // 회전 레이더
  const radar = new THREE.Group();
  radar.position.set(3.2, 29.1, 0);
  radar.userData.keep = true;
  put(radar, cyl(0.12, 0.12, 0.8, 6), lam('#9aa3b3'), 0, 0.4, 0);
  put(radar, box(2.6, 0.5, 0.25), lam(WHITE), 0, 1.0, 0.1);
  put(radar, box(2.4, 0.12, 0.1), lam(BLUE), 0, 1.0, 0.25);
  obj.add(radar);
  obj.name = 'controlTower';
  void beacon;
  return {
    obj,
    height: 32.8,
    update(time) {
      blinkBeacon(time);
      radar.rotation.y = time * 1.4;
    },
  };
}

// ================================================================ 출발 게이트
// 도로는 z 방향, 중심 x=0. 기둥은 ±(width/2+1.5).
export function startGantry({ width = 17 } = {}) {
  const hx = width / 2 + 1.5;
  const span = hx * 2 + 1.4;
  const obj = template('gantry' + width, () => {
    const g = new THREE.Group();
    const legTex = memo('legTexMat', () =>
      new THREE.MeshLambertMaterial({
        map: canvasTexture(128, 768, (c, w, h) => {
          c.fillStyle = BLUE;
          c.fillRect(0, 0, w, h);
          c.fillStyle = '#ffffff';
          c.fillRect(0, 0, 10, h);
          c.fillRect(w - 10, 0, 10, h);
          c.save();
          c.translate(w / 2, h / 2);
          c.rotate(-Math.PI / 2);
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          fitFont(c, 'SKY HARBOR', h * 0.85, 86);
          c.fillText('SKY HARBOR', 0, 4);
          c.restore();
        }),
      }),
    );
    for (const s of [-1, 1]) {
      put(g, box(2.2, 0.6, 2.2), lam('#4a5160'), s * hx, 0.3, 0, { cast: true });
      const leg = new THREE.Mesh(box(1.4, 6.6, 1.4), [lam(WHITE), lam(WHITE), lam(BLUE), lam(BLUE), legTex, legTex]);
      leg.position.set(s * hx, 0.6 + 3.3, 0);
      leg.castShadow = leg.receiveShadow = true;
      g.add(leg);
      put(g, box(1.6, 0.3, 1.6), lam(RED), s * hx, 7.2, 0);
      put(g, cyl(0.07, 0.07, 3, 6), lam('#dfe3ea'), s * hx, 9.4 + 1.5, 0);
      put(g, sph(0.14, 6, 4), lam(YEL), s * hx, 12.45, 0);
    }
    // 체커 띠
    const chk = memo('gantryChk' + span, () => new THREE.MeshLambertMaterial({ map: texRepeat(checkerTex(), span / 2.4, 1) }));
    put(g, box(span, 0.6, 1.62), chk, 0, 7.05 + 0.0, 0);
    // 신호등 판 매다는 봉
    for (const s of [-1, 1]) put(g, box(0.15, 0.6, 0.15), lam('#333844'), s * 2.2, 6.45, 0);
    put(g, box(6.6, 1.3, 0.6), lam('#15171d'), 0, 5.55, 0, { cast: true });
    put(g, box(6.8, 0.12, 0.8), lam(YEL), 0, 6.24, 0);
    for (let i = 0; i < 5; i++) put(g, box(0.95, 0.12, 0.9), lam('#15171d'), (i - 2) * 1.25, 6.05, 0);
    // 큰 배너 상판 (앞뒤 양면 글자)
    const banMat = memo('gantryBanner', () =>
      new THREE.MeshLambertMaterial({
        map: canvasTexture(1024, 112, (c, w, h) => {
          c.fillStyle = '#ffffff';
          c.fillRect(0, 0, w, h);
          c.fillStyle = RED;
          c.fillRect(0, 0, w, 10);
          c.fillRect(0, h - 10, w, 10);
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          fitFont(c, 'SKY HARBOR GRAND PRIX', w * 0.86, 74);
          const tw = c.measureText('SKY HARBOR ').width;
          const all = c.measureText('SKY HARBOR GRAND PRIX').width;
          c.textAlign = 'left';
          c.fillStyle = RED;
          c.fillText('SKY HARBOR ', w / 2 - all / 2, h / 2 + 3);
          c.fillStyle = BLUE;
          c.fillText('GRAND PRIX', w / 2 - all / 2 + tw, h / 2 + 3);
          // 양 끝 별
          c.fillStyle = YEL;
          for (const x of [36, w - 36]) {
            c.beginPath();
            for (let i = 0; i < 10; i++) {
              const r = i % 2 ? 9 : 22;
              const a = -Math.PI / 2 + (i * Math.PI) / 5;
              c.lineTo(x + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
            }
            c.fill();
          }
        }),
      }),
    );
    const beam = new THREE.Mesh(memo('gantryBeam' + span, () => new THREE.BoxGeometry(span, 2.3, 1.6)), [lam(RED), lam(RED), lam(RED), lam(RED), banMat, banMat]);
    beam.position.set(0, 7.35 + 1.15, 0);
    beam.castShadow = beam.receiveShadow = true;
    g.add(beam);
    return g;
  });
  // 신호등 5개: 전구 하나가 앞뒤로 튀어나온 원통 → InstancedMesh 하나 (색만 바꿈)
  const bulbGeo = memo('bulbGeo', () => new THREE.CylinderGeometry(0.4, 0.4, 0.66, 14).rotateX(Math.PI / 2));
  const bulbs = new THREE.InstancedMesh(bulbGeo, memo('bulbMat', () => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })), 5);
  const bm = new THREE.Matrix4();
  // 0번 전구가 운전자 기준 왼쪽 (게이트는 도로 방향으로 돌려 놓여서 로컬 +x = 운전자 왼쪽) → 화면 위 신호등처럼 왼쪽부터 켜짐
  for (let i = 0; i < 5; i++) bulbs.setMatrixAt(i, bm.makeTranslation((2 - i) * 1.25, 5.55, 0));
  obj.add(bulbs);
  const OFF = new THREE.Color('#3a1010');
  const ON = new THREE.Color('#ff2a1a');
  const GO = new THREE.Color('#2bff6a');
  let nOn = 0;
  let green = false;
  const apply = () => {
    for (let i = 0; i < 5; i++) bulbs.setColorAt(i, green ? GO : i < nOn ? ON : OFF);
    bulbs.instanceColor.needsUpdate = true;
  };
  apply();
  bulbs.computeBoundingSphere();
  // 기둥 위 깃발
  const flags = [-1, 1].map((s, i) => {
    const f = makeFlag(1.6, 1.0, flagMat(i ? BLUE : RED), 6, 3);
    f.mesh.position.set(s * hx, 12.3, 0);
    obj.add(f.mesh);
    return f;
  });
  obj.name = 'startGantry';
  return {
    obj,
    height: 9.65,
    setLights(n) {
      nOn = Math.max(0, Math.min(5, n | 0));
      apply();
    },
    setGreen(b) {
      green = !!b;
      apply();
    },
    update(time) {
      flags.forEach((f, i) => f.update(time, i * 2));
    },
  };
}

// ================================================================ 풍선 아치
// 도로는 z 방향, 아치 다리는 ±(width/2+1.5)
const stripeTex = (color) =>
  memo('stripe' + color, () =>
    canvasTexture(128, 16, (g, w, h) => {
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.fillRect(w * 0.62, 0, w * 0.38, h);
    }),
  );

export function archBanner({ width = 17, text = 'BOOST ZONE', color = BLUE } = {}) {
  const a = width / 2 + 1.5;
  const b = 8.6;
  const n = 2.6;
  const tr = 1.15;
  const sx = (t) => Math.sign(Math.cos(t)) * a * Math.pow(Math.abs(Math.cos(t)), 2 / n);
  const sy = (t) => b * Math.pow(Math.abs(Math.sin(t)), 2 / n);
  const obj = template(`arch${width}${color}`, () => {
    const g = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI;
      pts.push(new THREE.Vector3(sx(t), sy(t) - (i === 0 || i === 40 ? 0.5 : 0), 0));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 64, tr, 14, false);
    const mat = memo('archMat' + color, () => new THREE.MeshStandardMaterial({ map: texRepeat(stripeTex(color), 9, 1), roughness: 0.45, metalness: 0 }));
    put(g, tube, mat, 0, 0, 0, { cast: true });
    for (const s of [-1, 1]) {
      put(g, cyl(1.6, 1.8, 0.6, 14), lam('#2b3040'), s * a, 0.3, 0, { cast: true });
      put(g, cyl(1.25, 1.25, 1.2, 14), lamSmooth(color), s * a, 1.0, 0);
      put(g, box(0.9, 0.7, 0.9), lam('#596173'), s * (a + 1.9), 0.35, 0.8);
    }
    return g;
  });
  // 현수막: 아치 안쪽 꼭대기에 매달림 (앞뒤 양면)
  const bTop = b - tr + 0.25;
  const bh = 2.1;
  const xIn = (y) => a * Math.pow(1 - Math.pow(y / b, n), 1 / n);
  const bw = 2 * (xIn(bTop) - tr * 0.6);
  const tex = memo(`archText${text}${color}`, () =>
    canvasTexture(1024, Math.round((1024 * bh) / bw), (c, w, h) => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w, h);
      c.fillStyle = color;
      c.fillRect(0, 0, w, h * 0.1);
      c.fillRect(0, h * 0.9, w, h * 0.1);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      fitFont(c, text, w * 0.84, h * 0.62);
      c.fillStyle = color;
      c.fillText(text, w / 2, h / 2 + 3);
    }),
  );
  const tm = memo(`archTextMat${text}${color}`, () => new THREE.MeshLambertMaterial({ map: tex }));
  const ban = new THREE.Mesh(memo(`archBan${bw}`, () => new THREE.BoxGeometry(bw, bh, 0.14)), [lam(color), lam(color), lam(color), lam(color), tm, tm]);
  ban.position.set(0, bTop - bh / 2, 0);
  ban.castShadow = ban.receiveShadow = true;
  obj.add(ban);
  obj.name = 'archBanner';
  return { obj, height: b + tr, clearance: bTop - bh };
}

// ================================================================ 깃대 (10 m)
export function flagPole({ color = RED } = {}) {
  const obj = template('flagPole', () => {
    const g = new THREE.Group();
    put(g, cyl(0.35, 0.42, 0.4, 8), lam('#bfc5cf'), 0, 0.2, 0);
    put(g, cyl(0.07, 0.11, 9.8, 8), lam(WHITE), 0, 0.4 + 4.9, 0, { cast: true });
    put(g, sph(0.16, 8, 6), lam(YEL), 0, 10.25, 0);
    return g;
  });
  const f = makeFlag(3.2, 2.0, flagMat(color), 12, 6);
  f.mesh.position.set(0.05, 9.95, 0);
  obj.add(f.mesh);
  obj.name = 'flagPole';
  const ph = Math.random() * 6;
  return { obj, update: (time) => f.update(time, ph) };
}

// ================================================================ 비행선 (~45 m, 원점 = 중심, 앞 = +z)
export function airship({ color = RED, text = 'SKY HARBOR' } = {}) {
  const LEN = 45;
  const R = 6.6;
  const obj = new THREE.Group();
  const inner = new THREE.Group();
  inner.userData.keep = true;
  obj.add(inner);
  const prof = (s) => R * Math.pow(Math.max(0, Math.sin(Math.PI * (1 - Math.pow(1 - s, 0.85)))), 0.62);
  const shell = template(`airship${color}${text}`, () => {
    const g = new THREE.Group();
    const pts = [];
    const N = 26;
    for (let j = 0; j <= N; j++) {
      const s = j / N;
      pts.push(new THREE.Vector2(j === 0 || j === N ? 0.001 : prof(s), -LEN / 2 + s * LEN));
    }
    const geo = new THREE.LatheGeometry(pts, 20).rotateX(Math.PI / 2);
    // 몸체 텍스처: u = 둘레(0 = 아래), v = 꼬리→코. 옆면 글자
    const tex = canvasTexture(1024, 1024, (c, w, h) => {
      c.fillStyle = color;
      c.fillRect(0, 0, w, h);
      // 배 쪽 흰색
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w * 0.12, h);
      c.fillRect(w * 0.88, 0, w * 0.12, h);
      // 코·꼬리 띠
      c.fillRect(0, 0, w, h * 0.05);
      c.fillStyle = YEL;
      c.fillRect(0, h * 0.1, w, h * 0.025);
      c.fillRect(0, h * 0.86, w, h * 0.025);
      c.fillStyle = '#ffffff';
      c.fillRect(0, h * 0.905, w, h * 0.012);
      // 글자: 오른쪽(+x)은 u=0.25, 왼쪽(-x)은 u=0.75
      for (const [u, rot] of [
        [0.25, Math.PI / 2],
        [0.75, -Math.PI / 2],
      ]) {
        c.save();
        c.translate(u * w, h * 0.5);
        c.rotate(rot);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        fitFont(c, text, h * 0.6, 150);
        c.fillStyle = 'rgba(0,0,0,0.22)';
        c.fillText(text, 6, 6);
        c.fillStyle = '#ffffff';
        c.fillText(text, 0, 0);
        c.restore();
      }
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    put(g, geo, new THREE.MeshLambertMaterial({ map: tex }), 0, 0, 0, { cast: true });
    // 꼬리 날개 4장 (X 자)
    const fs = new THREE.Shape();
    fs.moveTo(-21, 1.0);
    fs.lineTo(-12.5, 1.0);
    fs.lineTo(-18.5, 7.6);
    fs.lineTo(-23.6, 7.6);
    fs.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fs, { depth: 0.45, bevelEnabled: false }).translate(0, 0, -0.225).rotateY(-Math.PI / 2);
    // 날개 끝 색 띠
    const tipS = new THREE.Shape();
    tipS.moveTo(-18.0, 7.0);
    tipS.lineTo(-18.55, 7.65);
    tipS.lineTo(-23.65, 7.65);
    tipS.lineTo(-23.5, 7.0);
    tipS.closePath();
    const tipGeo = new THREE.ExtrudeGeometry(tipS, { depth: 0.5, bevelEnabled: false }).translate(0, 0, -0.25).rotateY(-Math.PI / 2);
    for (let k = 0; k < 4; k++) {
      const rz = Math.PI / 4 + (k * Math.PI) / 2;
      put(g, finGeo, lam(WHITE), 0, 0, 0, { rz, cast: true });
      put(g, tipGeo, lam(BLUE), 0, 0, 0, { rz });
    }
    // 곤돌라
    const gond = memo('gondola', () => new THREE.CapsuleGeometry(1.5, 6.5, 4, 10).rotateX(Math.PI / 2));
    put(g, gond, lam(WHITE), 0, -R + 0.1, 3, { s: [1, 0.78, 1], cast: true });
    put(g, box(3.08, 0.6, 6.2), glass('#5fb4f0'), 0, -R + 0.25, 3);
    put(g, box(0.5, 1.2, 4.5), lam('#d8dde6'), 0, -R + 1.0, 3);
    // 엔진 받침
    for (const s of [-1, 1]) {
      put(g, box(2.6, 0.25, 0.5), lam('#c9ced8'), s * 2.4, -R + 0.9, 1.5);
      put(g, cyl(0.55, 0.45, 2.2, 10), lam(WHITE), s * 3.7, -R + 0.9, 1.5, { rx: Math.PI / 2 });
      put(g, cyl(0.2, 0.2, 0.5, 8), lam(RED), s * 3.7, -R + 0.9, 0.2, { rx: Math.PI / 2 });
    }
    return g;
  });
  inner.add(shell);
  // 프로펠러 (회전)
  const props = [];
  const pg = memo('propGeo', () =>
    merge([0, 1, 2].map((k) => ({ g: box(0.32, 1.9, 0.08), m: new THREE.Matrix4().makeRotationZ((k * Math.PI * 2) / 3).multiply(new THREE.Matrix4().makeTranslation(0, 0.95, 0)) }))),
  );
  for (const s of [-1, 1]) {
    const p = put(inner, pg, lam('#3a3f4b'), s * 3.7, -R + 0.9, -0.05);
    props.push(p);
  }
  // 항법등
  put(inner, sph(0.25, 6, 4), glow('#ff3b30'), -5.4, 5.4, -20.6);
  put(inner, sph(0.25, 6, 4), glow('#38ff6a'), 5.4, 5.4, -20.6);
  obj.name = 'airship';
  const ph = Math.random() * 10;
  return {
    obj,
    length: LEN,
    radius: R,
    update(time) {
      inner.position.y = Math.sin(time * 0.45 + ph) * 0.7;
      inner.rotation.z = Math.sin(time * 0.33 + ph) * 0.025;
      inner.rotation.x = Math.sin(time * 0.27 + ph) * 0.015;
      for (const p of props) p.rotation.z = time * 14;
    },
  };
}

// ================================================================ 비행선 계류탑 (~28 m)
export function dockingMast() {
  const TOP = 24;
  const obj = template('mast', () => {
    const g = new THREE.Group();
    put(g, cyl(5, 5.4, 0.8, 8), lam('#c4c9d2'), 0, 0.4, 0, { cast: true });
    const half = (y) => 3.2 + (1.1 - 3.2) * (y / TOP);
    const cor = (y) => {
      const h = half(y);
      return [
        [h, y, h],
        [h, y, -h],
        [-h, y, -h],
        [-h, y, h],
      ];
    };
    const list = [];
    const lv = 8;
    for (let k = 0; k < lv; k++) {
      const y0 = 0.8 + (k * (TOP - 0.8)) / lv;
      const y1 = 0.8 + ((k + 1) * (TOP - 0.8)) / lv;
      const A = cor(y0);
      const B = cor(y1);
      const col = k % 2 ? RED : WHITE;
      for (let j = 0; j < 4; j++) {
        const j2 = (j + 1) % 4;
        list.push([A[j], B[j], 0.42, col]);
        list.push([B[j], B[j2], 0.24, col]);
        list.push([A[j], B[j2], 0.14, col]);
        list.push([A[j2], B[j], 0.14, col]);
      }
    }
    // 가운데 계단 기둥
    list.push([[0, 0.8, 0], [0, TOP, 0], 0.7, '#9aa3b3']);
    g.add(struts(list, 0.2, lam('#ffffff')));
    // 꼭대기 플랫폼 + 난간
    put(g, box(4.6, 0.4, 4.6), lam(NAVY), 0, TOP + 0.2, 0, { cast: true });
    put(g, torus(3.1, 0.07, 4, 4), lam(YEL), 0, TOP + 1.3, 0, { rx: Math.PI / 2, ry: Math.PI / 4 });
    const posts = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      posts.push([[Math.cos(a) * 3.1, TOP + 0.4, Math.sin(a) * 3.1], [Math.cos(a) * 3.1, TOP + 1.3, Math.sin(a) * 3.1]]);
    }
    g.add(struts(posts, 0.1, lam(YEL), false));
    // 계류 머리: 원통 + 빨간 원뿔 컵
    put(g, cyl(1.1, 1.3, 2.2, 10), lam(WHITE), 0, TOP + 1.5, 0, { cast: true });
    put(g, cyl(1.4, 1.4, 0.3, 10), lam(BLUE), 0, TOP + 2.7, 0);
    put(g, cyl(0.25, 1.2, 1.3, 10), lam(RED), 0, TOP + 3.5, 0, { cast: true });
    put(g, cyl(0.12, 0.12, 0.6, 6), lam('#9aa3b3'), 0, TOP + 4.4, 0);
    return g;
  });
  put(obj, sph(0.28, 8, 6), beaconMat(), 0, TOP + 4.8, 0);
  obj.name = 'dockingMast';
  return { obj, tieY: TOP + 4.1, height: TOP + 5, update: (t) => blinkBeacon(t + 0.5) };
}

// ================================================================ 오두막 (~8 m, 문 = +z)
const shingleTex = () =>
  memo('shingle', () =>
    canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.16)';
      for (let y = 0; y < h; y += 16) {
        g.fillRect(0, y + 13, w, 3);
        for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) g.fillRect(x, y, 2, 14);
      }
    }),
  );
const roofMat = (color) => memo('roofMat' + color, () => new THREE.MeshLambertMaterial({ color, map: texRepeat(shingleTex(), 3, 2), flatShading: true }));

function addWindow(g, x, y, z, ry, shutter) {
  const o = new THREE.Group();
  o.position.set(x, y, z);
  o.rotation.y = ry;
  put(o, box(1.3, 1.3, 0.14), lam('#ffffff'), 0, 0, 0.05);
  put(o, box(1.05, 1.05, 0.12), glass('#9ad8ff'), 0, 0, 0.09);
  put(o, box(0.1, 1.05, 0.06), lam('#ffffff'), 0, 0, 0.17);
  put(o, box(1.05, 0.1, 0.06), lam('#ffffff'), 0, 0, 0.17);
  if (shutter) for (const s of [-1, 1]) put(o, box(0.45, 1.3, 0.08), lam(shutter), s * 0.92, 0, 0.06);
  // 꽃 상자
  put(o, box(1.4, 0.3, 0.35), lam('#9a5b2e'), 0, -0.78, 0.2);
  const fl = [PINK, YEL, RED, '#ffffff', PURP];
  for (let i = 0; i < 5; i++) put(o, ico(0.15, 0), lam(fl[i]), -0.52 + i * 0.26, -0.55, 0.22 + (i % 2) * 0.06);
  g.add(o);
}

export function cottage({ wall = '#fff3d6', roof = RED } = {}) {
  const obj = template(`cottage${wall}${roof}`, () => {
    const g = new THREE.Group();
    const W = 6;
    const D = 5;
    const H = 3.6;
    const RH = 2.6;
    put(g, box(W + 0.2, 0.5, D + 0.2), lam('#a9a39a'), 0, 0.25, 0, { cast: true });
    put(g, box(W, H, D), lam(wall), 0, H / 2, 0, { cast: true });
    // 박공 삼각벽
    const tri = new THREE.Shape();
    tri.moveTo(-D / 2, 0);
    tri.lineTo(D / 2, 0);
    tri.lineTo(0, RH);
    tri.closePath();
    const gable = memo('gable', () => new THREE.ExtrudeGeometry(tri, { depth: W, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-W / 2, 0, 0));
    put(g, gable, lam(wall), 0, H, 0, { cast: true });
    // 지붕 두 장
    const ang = Math.atan2(RH, D / 2);
    const sl = Math.hypot(RH, D / 2) + 0.75;
    for (const s of [-1, 1]) {
      const cz = s * (Math.cos(ang) * (sl / 2 - 0.2) + Math.sin(ang) * 0.18);
      const cy = H + RH - Math.sin(ang) * (sl / 2 - 0.2) + Math.cos(ang) * 0.18;
      put(g, box(W + 0.9, 0.32, sl), roofMat(roof), 0, cy, cz, { rx: s * ang, cast: true });
    }
    put(g, box(W + 1.0, 0.3, 0.3), lam('#ffffff'), 0, H + RH + 0.28, 0, { rx: Math.PI / 4 });
    // 굴뚝
    put(g, box(0.9, 2.6, 0.9), lam('#b5523b'), 1.7, H + RH + 0.2, -1.1, { cast: true });
    put(g, box(1.1, 0.25, 1.1), lam('#6b6f78'), 1.7, H + RH + 1.55, -1.1);
    // 문
    put(g, box(1.4, 2.4, 0.16), lam('#ffffff'), -1.3, 1.45, D / 2 + 0.03);
    put(g, box(1.1, 2.15, 0.16), lam('#8a5a33'), -1.3, 1.35, D / 2 + 0.07);
    put(g, sph(0.08, 6, 4), lam(YEL), -0.95, 1.3, D / 2 + 0.18);
    put(g, box(1.6, 0.18, 0.9), lam('#a9a39a'), -1.3, 0.09, D / 2 + 0.45);
    put(g, box(1.8, 0.12, 0.9), lam(roof), -1.3, 2.85, D / 2 + 0.4, { rx: -0.25 });
    // 창문
    addWindow(g, 1.4, 2.1, D / 2, 0, TEAL);
    addWindow(g, -1.4, 2.1, -D / 2, Math.PI, TEAL);
    addWindow(g, 1.4, 2.1, -D / 2, Math.PI, TEAL);
    addWindow(g, W / 2, 2.1, 0, Math.PI / 2, null);
    addWindow(g, -W / 2, 2.1, 0, -Math.PI / 2, null);
    // 박공의 둥근 다락창
    for (const s of [-1, 1]) {
      put(g, cyl(0.42, 0.42, 0.14, 12), lam('#ffffff'), s * (W / 2 + 0.02), H + 0.95, 0, { rz: Math.PI / 2 });
      put(g, cyl(0.32, 0.32, 0.16, 12), glass('#9ad8ff'), s * (W / 2 + 0.04), H + 0.95, 0, { rz: Math.PI / 2 });
    }
    return g;
  });
  obj.name = 'cottage';
  return { obj, height: 7.9, halfW: 3.5, halfD: 3 };
}

// ================================================================ 풍차 (~18 m, 날개 = +z 쪽)
const sailTex = () =>
  memo('sailTex', () =>
    canvasTexture(64, 256, (g, w, h) => {
      g.fillStyle = '#fffaf0';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#8a5a33';
      g.lineWidth = 4;
      for (let x = 2; x <= w; x += 20) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let y = 2; y <= h; y += 22) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
    }),
  );

export function windmill({ color = RED } = {}) {
  const HUB = 10.9;
  const obj = template('windmill' + color, () => {
    const g = new THREE.Group();
    put(g, cyl(4.0, 4.4, 2, 8), lam('#b7afa2'), 0, 1, 0, { cast: true });
    put(g, cyl(2.3, 3.4, 8.4, 8), lam('#fff4dc'), 0, 2 + 4.2, 0, { cast: true });
    put(g, cyl(3.45, 3.45, 0.3, 8), lam(color), 0, 2.15, 0);
    // 발코니
    put(g, cyl(3.9, 3.9, 0.25, 8), lam('#8a5a33'), 0, 5.4, 0);
    put(g, torus(3.85, 0.06, 4, 8), lam('#ffffff'), 0, 6.3, 0, { rx: Math.PI / 2, rz: Math.PI / 8 });
    const posts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      posts.push([[Math.cos(a) * 3.8, 5.5, Math.sin(a) * 3.8], [Math.cos(a) * 3.8, 6.3, Math.sin(a) * 3.8]]);
    }
    g.add(struts(posts, 0.1, lam('#ffffff'), false));
    // 모자 (돔)
    put(g, cyl(2.75, 2.5, 0.5, 8), lam('#ffffff'), 0, 10.6, 0);
    put(g, memo('wmCap', () => new THREE.SphereGeometry(2.8, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)), lam(color), 0, 10.85, 0, { s: [1, 1.15, 1], cast: true });
    put(g, sph(0.3, 6, 4), lam(YEL), 0, 14.2, 0);
    // 축
    put(g, cyl(0.35, 0.45, 3.0, 8), lam('#6b4a2e'), 0, HUB, 2.8, { rx: Math.PI / 2 });
    // 문, 창
    put(g, box(1.6, 2.4, 0.3), lam('#ffffff'), 0, 1.3, 4.05);
    put(g, box(1.25, 2.1, 0.3), lam('#8a5a33'), 0, 1.15, 4.12);
    put(g, cyl(0.62, 0.62, 0.3, 10, false), lam('#8a5a33'), 0, 2.2, 4.12, { rx: Math.PI / 2 });
    addWindow(g, 0, 7.8, 2.72, 0, null);
    addWindow(g, 2.95, 3.6, 0, Math.PI / 2, color);
    addWindow(g, -2.95, 3.6, 0, -Math.PI / 2, color);
    // 옆에 붙은 작은 오두막
    const annex = cottage({ wall: '#fff4dc', roof: color }).obj;
    annex.scale.setScalar(0.55);
    annex.position.set(-5.4, 0, -1.2);
    annex.rotation.y = Math.PI / 2;
    g.add(annex);
    return g;
  });
  // 회전 날개 (날개 4장을 한 덩어리로 bake 한 템플릿, 원점 = 허브)
  const sails = template('sails' + color, () => {
    const g = new THREE.Group();
    const sm = memo('sailMat', () => new THREE.MeshLambertMaterial({ map: sailTex(), side: THREE.DoubleSide }));
    for (let k = 0; k < 4; k++) {
      const one = new THREE.Group();
      one.rotation.z = (k * Math.PI) / 2;
      put(one, box(0.3, 7.6, 0.3), lam('#6b4a2e'), 0, 3.8, 0, { cast: true });
      put(one, box(1.9, 6.0, 0.08), sm, 1.1, 4.3, 0, { cast: true });
      put(one, box(0.1, 6.0, 0.14), lam(color), 2.05, 4.3, 0, { cast: true });
      g.add(one);
    }
    put(g, cyl(0.6, 0.6, 0.6, 10), lam(color), 0, 0, 0.1, { rx: Math.PI / 2, cast: true });
    return g;
  });
  sails.position.set(0, HUB, 4.25);
  obj.add(sails);
  obj.name = 'windmill';
  const ph = Math.random() * 6;
  return { obj, height: HUB + 7.6, update: (time) => (sails.rotation.z = -time * 0.7 - ph) };
}

// ================================================================ 등대 (~26 m)
export function lighthouse() {
  const obj = template('lighthouse', () => {
    const g = new THREE.Group();
    put(g, cyl(4.6, 5.4, 1.6, 10), lam('#9fa7b3'), 0, 0.8, 0, { cast: true });
    const rocks = rng(5);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rocks();
      put(g, ico(1.2 + rocks() * 0.8, 0), lam('#8a929e'), Math.cos(a) * 5.2, 0.4, Math.sin(a) * 5.2, { s: [1, 0.7, 1], ry: rocks() * 3 });
    }
    const st = memo('lhStripe', () =>
      new THREE.MeshLambertMaterial({
        map: canvasTexture(16, 256, (c, w, h) => {
          for (let i = 0; i < 8; i++) {
            c.fillStyle = i % 2 ? '#ffffff' : RED;
            c.fillRect(0, (i * h) / 8, w, h / 8);
          }
        }),
      }),
    );
    put(g, cyl(1.9, 2.8, 18, 16), st, 0, 1.6 + 9, 0, { cast: true });
    put(g, box(1.1, 2.0, 0.3), lam('#2f3644'), 0, 2.6, 2.72);
    put(g, box(1.4, 0.2, 0.6), lam('#ffffff'), 0, 3.7, 2.8);
    for (const [y, a] of [[8, 0.7], [13, -0.9], [17, 2.4]]) {
      const r = 2.8 - ((y - 1.6) / 18) * 0.9;
      put(g, box(0.5, 0.8, 0.2), lam('#2f3644'), Math.sin(a) * r, y, Math.cos(a) * r, { ry: a });
    }
    // 발코니
    put(g, cyl(3.0, 2.4, 0.6, 16), lam(NAVY), 0, 19.9, 0, { cast: true });
    put(g, torus(2.85, 0.07, 4, 16), lam('#ffffff'), 0, 21.2, 0, { rx: Math.PI / 2 });
    const posts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      posts.push([[Math.cos(a) * 2.85, 20.2, Math.sin(a) * 2.85], [Math.cos(a) * 2.85, 21.2, Math.sin(a) * 2.85]]);
    }
    g.add(struts(posts, 0.08, lam('#ffffff'), false));
    // 등실 (빛나는 유리) + 기둥
    put(g, cyl(1.55, 1.55, 2.6, 12), memo('lampGlass', () => new THREE.MeshBasicMaterial({ color: '#fff1a8' })), 0, 21.5, 0);
    const mull = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      mull.push([[Math.cos(a) * 1.62, 20.2, Math.sin(a) * 1.62], [Math.cos(a) * 1.62, 22.8, Math.sin(a) * 1.62]]);
    }
    g.add(struts(mull, 0.12, lam(NAVY), false));
    put(g, cyl(2.0, 2.0, 0.3, 12), lam(NAVY), 0, 22.9, 0);
    put(g, cyl(0.15, 2.05, 1.9, 12), lam(RED), 0, 24.0, 0, { cast: true });
    put(g, sph(0.32, 8, 6), lam(YEL), 0, 25.1, 0);
    put(g, cyl(0.05, 0.05, 1.0, 4), lam(NAVY), 0, 25.8, 0);
    return g;
  });
  // 회전 빛줄기 (가산 혼합 원뿔 두 개)
  const beamMat = memo('beamMat', () =>
    new THREE.MeshBasicMaterial({
      map: canvasTexture(4, 128, (c, w, h) => {
        const gr = c.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, 'rgba(255,240,180,1)');
        gr.addColorStop(0.3, 'rgba(110,100,60,1)');
        gr.addColorStop(0.7, 'rgba(30,26,14,1)');
        gr.addColorStop(1, 'rgba(0,0,0,1)');
        c.fillStyle = gr;
        c.fillRect(0, 0, w, h);
      }),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  const beamGeo = memo('beamGeo', () => {
    const g = new THREE.ConeGeometry(4.5, 38, 16, 1, true).translate(0, -19, 0).rotateZ(Math.PI / 2);
    // uv.y = 등대에서 멀어질수록 0 (빛이 흐려짐)
    const P = g.attributes.position;
    const U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) U.setY(i, 1 - P.getX(i) / 38);
    return g;
  });
  const beam = new THREE.Group();
  beam.position.set(0, 21.5, 0);
  beam.userData.keep = true;
  for (const s of [0, Math.PI]) {
    const m = new THREE.Mesh(beamGeo, beamMat);
    m.rotation.y = s;
    m.renderOrder = 5;
    beam.add(m);
  }
  obj.add(beam);
  obj.name = 'lighthouse';
  return { obj, height: 26.3, update: (time) => (beam.rotation.y = time * 0.9) };
}

// ================================================================ 열기구 (~16 m, 원점 = 바구니 바닥)
export function hotAirBalloon({ colors = [RED, YEL] } = {}) {
  const [ca, cb] = colors;
  const obj = new THREE.Group();
  const inner = template(`balloon${ca}${cb}`, () => {
    const g = new THREE.Group();
    put(g, box(1.6, 1.1, 1.6), lam('#b07636'), 0, 0.55, 0, { cast: true });
    put(g, box(1.75, 0.2, 1.75), lam('#7a4a22'), 0, 1.1, 0);
    put(g, box(1.62, 0.12, 1.62), lam('#7a4a22'), 0, 0.5, 0);
    const ropes = [];
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) ropes.push([[x * 0.75, 1.1, z * 0.75], [x * 0.95, 4.1, z * 0.95]]);
    g.add(struts(ropes, 0.05, lam('#5a4030'), false));
    put(g, cyl(0.35, 0.35, 0.5, 8), lam('#8f98a8'), 0, 2.6, 0);
    put(g, cyl(0.9, 1.05, 0.5, 12, true), lam(cb), 0, 4.2, 0);
    // 풍선 몸통 (세로 줄무늬)
    const prof = [
      [1.0, 4.4], [1.7, 5.3], [3.3, 6.8], [4.9, 8.7], [5.8, 10.5], [6.15, 12.0],
      [5.95, 13.4], [5.1, 14.8], [3.6, 15.8], [1.6, 16.3], [0.01, 16.4],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(prof, 16);
    const tex = canvasTexture(256, 128, (c, w, h) => {
      for (let i = 0; i < 8; i++) {
        c.fillStyle = i % 2 ? cb : ca;
        c.fillRect((i * w) / 8, 0, w / 8, h);
      }
      c.fillStyle = '#ffffff';
      c.fillRect(0, h * 0.62, w, h * 0.07);
      c.fillStyle = ca;
      c.fillRect(0, 0, w, h * 0.1);
    });
    put(g, geo, new THREE.MeshLambertMaterial({ map: tex, flatShading: true }), 0, 0, 0, { cast: true });
    return g;
  });
  inner.userData.keep = true;
  obj.add(inner);
  const flame = put(inner, memo('flameGeo', () => new THREE.ConeGeometry(0.28, 1.1, 8)), glow('#ffb43a'), 0, 3.4, 0);
  obj.name = 'hotAirBalloon';
  const ph = Math.random() * 6;
  return {
    obj,
    height: 16.4,
    update(time) {
      inner.position.y = Math.sin(time * 0.5 + ph) * 0.6;
      inner.rotation.y = time * 0.05 + ph;
      inner.rotation.z = Math.sin(time * 0.37 + ph) * 0.03;
      flame.scale.setScalar(0.8 + 0.35 * Math.abs(Math.sin(time * 9 + ph)));
    },
  };
}

// ================================================================ 큰 안내판 (판 중심 높이 ~5 m, 앞 = +z, 양면)
export function signBoard({ title = 'SKY HARBOR', sub = '', bg = '#1d2433', accent = '#ffd21f', width = 12 } = {}) {
  const W = width;
  const H = Math.max(2.4, Math.min(3.6, W * 0.26));
  const key = `sign${title}|${sub}|${bg}|${accent}|${W}`;
  const tex = memo(key, () =>
    canvasTexture(1024, Math.round((1024 * H) / W), (c, w, h) => {
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      c.fillStyle = accent;
      c.fillRect(0, 0, w, h * 0.07);
      c.fillRect(0, h * 0.93, w, h * 0.07);
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 5;
      roundRect(c, h * 0.11, h * 0.14, w - h * 0.22, h * 0.72, 18);
      c.stroke();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const ty = sub ? h * 0.42 : h * 0.51;
      fitFont(c, title, w * 0.86, Math.round(h * (sub ? 0.36 : 0.46)));
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillText(title, w / 2 + 4, ty + 4);
      c.fillStyle = '#ffffff';
      c.fillText(title, w / 2, ty);
      if (sub) {
        fitFont(c, sub, w * 0.8, Math.round(h * 0.17), 800);
        c.fillStyle = accent;
        c.fillText(sub, w / 2, h * 0.7);
      }
    }),
  );
  const tm = memo(key + 'mat', () => new THREE.MeshLambertMaterial({ map: tex }));
  const obj = template(key, () => {
    const g = new THREE.Group();
    // 기둥은 판 바깥 양옆 (앞뒤 어느 쪽에서도 글자를 가리지 않게)
    const px = W / 2 + 0.42;
    for (const s of [-1, 1]) {
      put(g, box(0.9, 0.4, 0.9), lam('#b9bfca'), s * px, 0.2, 0);
      put(g, cyl(0.2, 0.24, 5 + H / 2 + 0.6, 8), lam('#d9dee6'), s * px, (5 + H / 2 + 0.6) / 2, 0, { cast: true });
      put(g, sph(0.26, 8, 6), lam(accent), s * px, 5 + H / 2 + 0.65, 0);
      for (const y of [5 - H / 2 + 0.3, 5 + H / 2 - 0.3]) put(g, box(0.5, 0.16, 0.3), lam('#9aa3b3'), s * (W / 2 + 0.2), y, 0);
    }
    // 테두리 (강조색)
    put(g, box(W + 0.3, 0.2, 0.42), lam(accent), 0, 5 + H / 2 + 0.1, 0, { cast: true });
    put(g, box(W + 0.3, 0.2, 0.42), lam(accent), 0, 5 - H / 2 - 0.1, 0);
    for (const s of [-1, 1]) put(g, box(0.2, H + 0.4, 0.42), lam(accent), s * (W / 2 + 0.05), 5, 0);
    const board = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.3), [lam(bg), lam(bg), lam(bg), lam(bg), tm, tm]);
    board.position.y = 5;
    board.castShadow = board.receiveShadow = true;
    g.add(board);
    return g;
  });
  obj.name = 'signBoard';
  return { obj, height: 5 + H / 2 + 0.2, boardH: H };
}

// ================================================================ 회전 방향 쉐브론 (폭 3 m, 앞 = +z, dir +1 → +x)
const chevTex = (dir) =>
  memo('chev' + dir, () =>
    canvasTexture(256, 96, (c, w, h) => {
      c.fillStyle = RED;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        const cx = w * (0.22 + i * 0.28);
        c.save();
        c.translate(cx, h / 2);
        c.scale(dir, 1);
        c.beginPath();
        c.moveTo(-26, -36);
        c.lineTo(0, -36);
        c.lineTo(30, 0);
        c.lineTo(0, 36);
        c.lineTo(-26, 36);
        c.lineTo(4, 0);
        c.closePath();
        c.fill();
        c.restore();
      }
      c.strokeStyle = '#ffffff';
      c.lineWidth = 6;
      c.strokeRect(3, 3, w - 6, h - 6);
    }),
  );

export function chevronBoard({ dir = 1 } = {}) {
  const d = dir < 0 ? -1 : 1;
  const obj = template('chev' + d, () => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) put(g, cyl(0.07, 0.08, 2.4, 6), lam('#c9ced8'), s * 0.9, 1.2, -0.08);
    const m = new THREE.MeshLambertMaterial({ map: chevTex(d) });
    const b = new THREE.Mesh(box(3, 1.12, 0.1), [lam('#d9dde5'), lam('#d9dde5'), lam('#d9dde5'), lam('#d9dde5'), m, lam('#7d8594')]);
    b.position.set(0, 1.85, 0);
    b.castShadow = true;
    g.add(b);
    return g;
  });
  obj.name = 'chevronBoard';
  return { obj, height: 2.41 };
}

// ================================================================ 타이어 더미 (3단, ~1 m)
// tireWallGeometry(): InstancedMesh 용 { geo, mat } (정점색, 원점 = 바닥 중심)
export function tireWallGeometry(bands = ['#ffffff', RED, '#ffffff']) {
  return memo('tireWall' + bands.join(), () => {
    // 타이어 단면(둥근 사각형)을 돌려 만든 링: 바깥 트레드 면이 깔끔한 띠가 됨
    const tg = memo('tireLathe', () =>
      new THREE.LatheGeometry(
        [[0.2, -0.13], [0.42, -0.155], [0.475, -0.08], [0.475, -0.035], [0.475, 0.035], [0.475, 0.08], [0.42, 0.155], [0.2, 0.13], [0.2, -0.13]].map(([x, y]) => new THREE.Vector2(x, y)),
        10,
      ),
    );
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const yc = 0.16 + i * 0.32;
      const band = bands[i % bands.length];
      parts.push({
        g: tg,
        m: new THREE.Matrix4().makeTranslation(0, yc, 0),
        c: (x, y, z) => (Math.hypot(x, z) > 0.43 && Math.abs(y - yc) < 0.04 ? band : '#26282e'),
      });
    }
    const geo = merge(parts);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    return { geo, mat };
  });
}

export function tireStack() {
  const { geo, mat } = tireWallGeometry();
  const obj = new THREE.Mesh(geo, mat);
  obj.receiveShadow = true;
  obj.name = 'tireStack';
  return { obj, height: 0.96, radius: 0.47 };
}

// ================================================================ 사장교 주탑 (A 자, 다리 x=±11, 상판은 y=0..1 사이로 지나감)
export function bridgePylon({ height = 45 } = {}) {
  const H = height;
  const headH = Math.min(11, H * 0.24);
  const obj = template('pylon' + H, () => {
    const g = new THREE.Group();
    const topY = H - headH + 0.5;
    const legs = [];
    for (const s of [-1, 1]) {
      legs.push([[s * 11, -0.5, 0], [s * 1.7, topY, 0], 2.0]);
      put(g, box(3.4, 1.2, 3.4), lam('#c9ced8'), s * 11, 0.1, 0, { cast: true });
    }
    g.add(struts(legs, 2, lam(WHITE)));
    // 가로보 (차가 날아도 충분히 높게)
    const cy = H * 0.5;
    const t = (cy + 0.5) / (topY + 0.5);
    const cx = 11 + (1.7 - 11) * t;
    put(g, box(cx * 2, 1.4, 1.6), lam(WHITE), 0, cy, 0, { cast: true });
    put(g, box(cx * 2 - 0.8, 0.3, 1.64), lam(BLUE), 0, cy - 0.3, 0);
    // 머리 (케이블 정착부)
    put(g, box(4.4, headH, 2.6), lam(WHITE), 0, H - headH / 2, 0, { cast: true });
    put(g, box(4.5, 0.8, 2.7), lam(BLUE), 0, H - headH - 0.1 + 1.2, 0);
    put(g, box(4.5, 0.5, 2.7), lam(RED), 0, H - 0.25, 0);
    const anchorList = [];
    for (let k = 0; k < 6; k++) for (const s of [-1, 1]) anchorList.push([[s * 1.2, H - headH + 1.8 + k * ((headH - 3) / 5), -1.45], [s * 1.2, H - headH + 1.8 + k * ((headH - 3) / 5), 1.45], 0.35]);
    g.add(struts(anchorList.map(([a, b, th]) => [a.map((v, i) => (i === 2 ? -1.45 : v)), b, th]), 0.35, lam('#9aa3b3'), false));
    put(g, cyl(0.12, 0.12, 1.6, 6), lam('#9aa3b3'), 0, H + 0.8, 0);
    return g;
  });
  put(obj, sph(0.4, 8, 6), beaconMat(), 0, H + 1.8, 0);
  const anchors = [];
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) anchors.push(new THREE.Vector3(s * 1.2, H - headH + 1.8 + k * ((headH - 3) / 5), 0));
  obj.name = 'bridgePylon';
  return { obj, height: H + 2.2, anchors, crossBeamY: H * 0.5, update: (t) => blinkBeacon(t + 1.1) };
}

// ================================================================ 항만 컨테이너 크레인 (붐 = +z 쪽으로 뻗음)
export function crane({ height = 30 } = {}) {
  const H = height;
  const BY = H * 0.6;
  const obj = template('crane' + H, () => {
    const g = new THREE.Group();
    const L = [];
    const Y = YEL;
    const legX = 7;
    const legZ = 6;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        L.push([[sx * legX, 1.2, sz * legZ], [sx * legX, BY, sz * legZ], 1.1, Y]);
        put(g, box(2.2, 1.2, 3.2), lam('#3a3f4b'), sx * legX, 0.6, sz * legZ, { cast: true });
        for (const w of [-1, 1]) put(g, cyl(0.45, 0.45, 0.5, 10), lam('#22252c'), sx * legX + 1.1 * 0, 0.45, sz * legZ + w * 1.0, { rz: Math.PI / 2 });
      }
    for (const sx of [-1, 1]) {
      L.push([[sx * legX, BY * 0.35, -legZ], [sx * legX, BY * 0.35, legZ], 0.7, Y]);
      L.push([[sx * legX, 1.3, -legZ], [sx * legX, BY * 0.35, legZ], 0.4, Y]);
      L.push([[sx * legX, BY * 0.35, -legZ], [sx * legX, BY - 0.5, legZ], 0.4, Y]);
    }
    for (const sz of [-1, 1]) L.push([[-legX, BY * 0.85, sz * legZ], [legX, BY * 0.85, sz * legZ], 0.8, Y]);
    // 붐 (두 줄 거더) + 래티스
    const z0 = -15;
    const z1 = 32;
    for (const sx of [-1, 1]) {
      L.push([[sx * 1.6, BY, z0], [sx * 1.6, BY, z1], 1.0, RED]);
      L.push([[sx * 1.6, BY + 1.8, z0], [sx * 1.6, BY + 1.8, z1 - 3], 0.4, RED]);
      for (let z = z0; z < z1 - 3; z += 3.5) L.push([[sx * 1.6, BY, z], [sx * 1.6, BY + 1.8, z + 3.5], 0.22, RED]);
    }
    for (let z = z0; z <= z1; z += 3.5) L.push([[-1.6, BY + 0.3, z], [1.6, BY + 0.3, z], 0.3, RED]);
    // 다리와 붐 연결
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.push([[sx * legX, BY, sz * legZ], [sx * 1.6, BY, sz * legZ], 0.9, Y]);
    // A 프레임 꼭대기 + 지지줄
    for (const sx of [-1, 1]) {
      L.push([[sx * legX, BY, -legZ], [sx * 1.4, H, -1], 0.8, Y]);
      L.push([[sx * legX, BY, legZ], [sx * 1.4, H, -1], 0.8, Y]);
      L.push([[sx * 1.4, H, -1], [sx * 1.6, BY + 1.8, z1 - 3], 0.25, '#e9edf3']);
      L.push([[sx * 1.4, H, -1], [sx * 1.6, BY + 1.8, 14], 0.25, '#e9edf3']);
      L.push([[sx * 1.4, H, -1], [sx * 1.6, BY + 1.8, z0 + 1], 0.25, '#e9edf3']);
    }
    L.push([[-1.6, H, -1], [1.6, H, -1], 0.8, Y]);
    g.add(struts(L, 0.5, lam('#ffffff')));
    // 기계실 (뒤쪽 붐 위)
    put(g, box(5, 3.2, 6), lam(BLUE), 0, BY + 2.1, -11, { cast: true });
    put(g, box(5.1, 0.4, 6.1), lam(WHITE), 0, BY + 3.9, -11);
    put(g, sph(0.3, 6, 4), beaconMat(), 0, H + 0.6, -1);
    return g;
  });
  // 트롤리 + 운전실 + 컨테이너 (천천히 움직임)
  const trolley = new THREE.Group();
  trolley.userData.keep = true;
  put(trolley, box(4.2, 1.2, 3.4), lam('#4a5160'), 0, BY - 0.6, 0, { cast: true });
  put(trolley, box(2.4, 2.0, 2.4), lam(WHITE), -2.2, BY - 2.4, 0.8);
  put(trolley, box(2.2, 0.9, 2.46), glass('#6fc2ff'), -2.2, BY - 2.2, 0.8);
  const hoist = new THREE.Group();
  const cable = put(hoist, box(0.08, 1, 0.08), lam('#3a3f4b'), 0, 0, 0);
  const cable2 = put(hoist, box(0.08, 1, 0.08), lam('#3a3f4b'), 0, 0, 0);
  const spreader = new THREE.Group();
  put(spreader, box(6.2, 0.45, 2.6), lam(YEL), 0, 0, 0);
  put(spreader, box(6.1, 2.6, 2.44), memo('container', () =>
    new THREE.MeshLambertMaterial({
      color: TEAL,
      map: canvasTexture(128, 64, (c, w, h) => {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(0,0,0,0.18)';
        for (let x = 0; x < w; x += 8) c.fillRect(x, 0, 3, h);
      }),
    }),
  ), 0, -1.55, 0, { cast: true });
  hoist.add(spreader);
  trolley.add(hoist);
  obj.add(trolley);
  obj.name = 'crane';
  const setHoist = (drop) => {
    spreader.position.y = BY - 1.2 - drop;
    for (const [c, x] of [[cable, -2], [cable2, 2]]) {
      c.position.set(x, BY - 1.2 - drop / 2, 0);
      c.scale.y = drop;
    }
  };
  setHoist(BY * 0.45);
  trolley.position.z = 16;
  return {
    obj,
    height: H + 1,
    boomY: BY,
    update(time) {
      const ph = (time * 0.08) % 1;
      const s = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
      trolley.position.z = -3 + s * 26;
      setHoist(BY * (0.25 + 0.4 * (0.5 - 0.5 * Math.cos(ph * Math.PI * 4))));
    },
  };
}

// ================================================================ 가로등 (~6.4 m)
export function lampPost() {
  const obj = template('lamp', () => {
    const g = new THREE.Group();
    const P = '#24365a';
    put(g, cyl(0.38, 0.48, 0.9, 8), lam(P), 0, 0.45, 0, { cast: true });
    put(g, cyl(0.42, 0.42, 0.12, 8), lam(YEL), 0, 0.92, 0);
    put(g, cyl(0.09, 0.14, 4.9, 8), lam(P), 0, 0.9 + 2.45, 0, { cast: true });
    put(g, torus(0.17, 0.05, 4, 8), lam(YEL), 0, 1.6, 0, { rx: Math.PI / 2 });
    put(g, torus(0.13, 0.05, 4, 8), lam(YEL), 0, 4.6, 0, { rx: Math.PI / 2 });
    // 양쪽 팔 + 등
    for (const s of [-1, 1]) {
      put(g, box(1.1, 0.09, 0.09), lam(P), s * 0.55, 5.35, 0);
      put(g, torus(0.25, 0.04, 4, 10), lam(P), s * 0.82, 5.12, 0);
      put(g, cyl(0.04, 0.04, 0.3, 4), lam(P), s * 1.1, 5.2, 0);
      put(g, cyl(0.3, 0.12, 0.25, 8), lam(P), s * 1.1, 5.0, 0);
      put(g, sph(0.27, 10, 7), glow('#ffe2a0'), s * 1.1, 4.68, 0);
    }
    put(g, sph(0.34, 10, 7), glow('#fff0c4'), 0, 5.85, 0);
    put(g, cyl(0.04, 0.38, 0.32, 8), lam(P), 0, 6.24, 0);
    put(g, sph(0.08, 6, 4), lam(YEL), 0, 6.45, 0);
    return g;
  });
  obj.name = 'lampPost';
  return { obj, height: 6.5 };
}

// ================================================================ 삼각 깃발 줄 (x 방향 length, 기둥 높이 6 m, 원점 = 가운데)
const pennantGeo = () =>
  memo('pennant', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1.25, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
    return g;
  });

export function bannerFlags({ length = 40 } = {}) {
  const L = length;
  const PH = 6;
  const sag = Math.min(1.6, L * 0.035);
  const ropeY = (x) => PH - 0.2 - sag * (1 - Math.pow((2 * x) / L, 2));
  const obj = template('bunting' + L, () => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      put(g, cyl(0.3, 0.35, 0.3, 8), lam('#b9bfca'), (s * L) / 2, 0.15, 0);
      put(g, cyl(0.07, 0.09, PH, 8), lam(WHITE), (s * L) / 2, PH / 2, 0, { cast: true });
      put(g, sph(0.15, 8, 6), lam(RED), (s * L) / 2, PH + 0.1, 0);
    }
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const x = -L / 2 + (i / 24) * L;
      pts.push(new THREE.Vector3(x, ropeY(x), 0));
    }
    put(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.03, 4, false), lam('#ffffff'), 0, 0, 0);
    return g;
  });
  const n = Math.max(2, Math.floor((L - 1.2) / 1.2));
  const im = new THREE.InstancedMesh(pennantGeo(), memo('pennantMat', () => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, flatShading: true })), n);
  const cols = [RED, YEL, BLUE, WHITE, TEAL, PURP, ORANGE, GREEN];
  const xs = [];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    xs.push(-L / 2 + 0.6 + ((i + 0.5) * (L - 1.2)) / n);
    im.setColorAt(i, c.set(cols[i % cols.length]));
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const pose = (t) => {
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const slope = Math.atan((8 * sag * x) / (L * L));
      e.set(Math.sin(t * 2.4 + i * 0.7) * 0.32 + 0.08, 0, slope);
      q.setFromEuler(e);
      m.compose(p.set(x, ropeY(x), 0), q, one);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  pose(0);
  im.computeBoundingSphere();
  im.boundingSphere.radius += 1.5;
  im.receiveShadow = true;
  obj.add(im);
  obj.name = 'bannerFlags';
  return { obj, update: (time) => pose(time) };
}

// ================================================================ 목록 + 미리보기
export const assetList = [
  'grandstand', 'pitBuilding', 'controlTower', 'startGantry', 'archBanner', 'flagPole', 'airship', 'dockingMast',
  'windmill', 'cottage', 'lighthouse', 'hotAirBalloon', 'signBoard', 'chevronBoard', 'tireStack', 'bridgePylon',
  'crane', 'lampPost', 'bannerFlags',
];

function ground(scene, THREE_, size = 400, color = '#7cc35a') {
  const m = new THREE_.Mesh(new THREE_.PlaneGeometry(size, size), new THREE_.MeshLambertMaterial({ color }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
function road(scene, THREE_, w = 17, len = 200) {
  const m = new THREE_.Mesh(new THREE_.PlaneGeometry(w, len), new THREE_.MeshLambertMaterial({ color: '#4a4e57' }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
const multi = (...us) => (t, dt) => us.forEach((u) => u && u(t, dt));

export function galleryItems() {
  return [
    {
      label: 'grandstand (excite 1)',
      build(scene, T) {
        ground(scene, T);
        const r = grandstand({ length: 60 });
        scene.add(r.obj);
        const rd = road(scene, T);
        rd.position.x = -10;
        return { pos: [-34, 13, 34], look: [6, 5, 4], update: (t, dt) => r.update(t, dt, 1), time: 1.2 };
      },
    },
    {
      label: 'pitBuilding',
      build(scene, T) {
        ground(scene, T);
        const r = pitBuilding({ length: 70 });
        scene.add(r.obj);
        road(scene, T).position.x = -12;
        return { pos: [-40, 15, 40], look: [6, 6, 2] };
      },
    },
    {
      label: 'controlTower',
      build(scene, T) {
        ground(scene, T);
        const r = controlTower();
        scene.add(r.obj);
        return { pos: [30, 16, 34], look: [0, 16, 0], update: r.update, time: 0.1 };
      },
    },
    {
      label: 'startGantry (3 lights)',
      build(scene, T) {
        ground(scene, T);
        road(scene, T);
        const r = startGantry({ width: 17 });
        r.setLights(3);
        scene.add(r.obj);
        return { pos: [9, 5, 20], look: [0, 6.5, 0], update: r.update };
      },
    },
    {
      label: 'archBanner',
      build(scene, T) {
        ground(scene, T);
        road(scene, T);
        const r = archBanner({ width: 17 });
        scene.add(r.obj);
        const r2 = archBanner({ width: 17, text: '구름 터널', color: PURP });
        r2.obj.position.z = -26;
        scene.add(r2.obj);
        return { pos: [9, 5, 22], look: [0, 5, -4] };
      },
    },
    {
      label: 'flagPole x3',
      build(scene, T) {
        ground(scene, T);
        const fs = [RED, BLUE, YEL].map((c, i) => {
          const r = flagPole({ color: c });
          r.obj.position.x = (i - 1) * 4.5;
          scene.add(r.obj);
          return r.update;
        });
        return { pos: [3, 6, 15], look: [0, 6.5, 0], update: multi(...fs) };
      },
    },
    {
      label: 'airship',
      build(scene, T) {
        ground(scene, T);
        const r = airship({});
        r.obj.position.y = 18;
        scene.add(r.obj);
        return { pos: [46, 16, 30], look: [0, 18, 0], update: r.update };
      },
    },
    {
      label: 'dockingMast + airship',
      build(scene, T) {
        ground(scene, T);
        const r = dockingMast();
        scene.add(r.obj);
        const a = airship({ color: BLUE, text: '구름섬 GP' });
        a.obj.position.set(0, r.tieY - 1, -23.5);
        scene.add(a.obj);
        return { pos: [-44, 14, 22], look: [0, 16, -8], update: multi(r.update, a.update), fov: 55 };
      },
    },
    {
      label: 'windmill',
      build(scene, T) {
        ground(scene, T);
        const r = windmill({ color: RED });
        scene.add(r.obj);
        return { pos: [14, 9, 24], look: [-1, 8.5, 0], update: r.update, time: 0.4 };
      },
    },
    {
      label: 'cottage x2',
      build(scene, T) {
        ground(scene, T);
        const a = cottage({});
        a.obj.position.x = -4;
        scene.add(a.obj);
        const b = cottage({ wall: '#dff3ff', roof: BLUE });
        b.obj.position.set(5, 0, -4);
        b.obj.rotation.y = -0.5;
        scene.add(b.obj);
        return { pos: [6, 6, 15], look: [0, 3, 0] };
      },
    },
    {
      label: 'lighthouse',
      build(scene, T) {
        ground(scene, T, 400, '#5aa9d6');
        const r = lighthouse();
        scene.add(r.obj);
        return { pos: [22, 12, 30], look: [0, 14, 0], update: r.update, time: 0.5 };
      },
    },
    {
      label: 'hotAirBalloon x2',
      build(scene, T) {
        ground(scene, T);
        const a = hotAirBalloon({ colors: [RED, YEL] });
        a.obj.position.set(-5, 3, 0);
        const b = hotAirBalloon({ colors: [BLUE, '#ffffff'] });
        b.obj.position.set(9, 8, -10);
        scene.add(a.obj, b.obj);
        return { pos: [6, 10, 26], look: [1, 11, 0], update: multi(a.update, b.update) };
      },
    },
    {
      label: 'signBoard',
      build(scene, T) {
        ground(scene, T);
        const a = signBoard({ title: '4 비행 모드 · Space 이륙', sub: 'FLIGHT MODE — 하늘길로!' });
        a.obj.position.x = -6;
        const b = signBoard({ title: '✈ SKY ROUTE', bg: BLUE, accent: '#ffffff', width: 9 });
        b.obj.position.set(8, 0, -6);
        b.obj.rotation.y = -0.35;
        scene.add(a.obj, b.obj);
        return { pos: [1, 5, 21], look: [1, 4.6, 0], fov: 55 };
      },
    },
    {
      label: 'chevronBoard (+1, -1, back)',
      build(scene, T) {
        ground(scene, T);
        const a = chevronBoard({ dir: 1 });
        a.obj.position.x = -2;
        const b = chevronBoard({ dir: -1 });
        b.obj.position.x = 2;
        const c = chevronBoard({ dir: 1 });
        c.obj.position.set(6, 0, -1);
        c.obj.rotation.y = Math.PI * 0.8;
        scene.add(a.obj, b.obj, c.obj);
        return { pos: [1, 2.2, 8], look: [1, 1.6, 0] };
      },
    },
    {
      label: 'tireStack + instanced wall',
      build(scene, T) {
        ground(scene, T);
        const one = tireStack();
        one.obj.position.set(0, 0, 2);
        scene.add(one.obj);
        const { geo, mat } = tireWallGeometry();
        const im = new T.InstancedMesh(geo, mat, 24);
        const m = new T.Matrix4();
        for (let i = 0; i < 24; i++) im.setMatrixAt(i, m.makeTranslation(-6 + (i % 12) * 0.95, i < 12 ? 0 : 0.96, -1));
        scene.add(im);
        return { pos: [2, 2.4, 6], look: [0, 0.6, 0] };
      },
    },
    {
      label: 'bridgePylon + deck',
      build(scene, T) {
        ground(scene, T, 400, '#5aa9d6');
        const r = bridgePylon({ height: 45 });
        r.obj.position.y = 0;
        scene.add(r.obj);
        const deck = new T.Mesh(new T.BoxGeometry(18, 1, 160), new T.MeshLambertMaterial({ color: '#5a5f6b' }));
        deck.position.y = 0.5;
        scene.add(deck);
        const cm = new T.MeshLambertMaterial({ color: '#ffffff' });
        for (const a of r.anchors)
          for (const dz of [-1, 1]) {
            const end = new T.Vector3(Math.sign(a.x) * 8.5, 1, dz * (10 + (a.y - 30) * 2.2));
            const d = end.clone().sub(a);
            const cmesh = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, d.length(), 4), cm);
            cmesh.position.copy(a).addScaledVector(d, 0.5);
            cmesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
            scene.add(cmesh);
          }
        return { pos: [46, 20, 50], look: [0, 20, 0], update: r.update, time: 0.1 };
      },
    },
    {
      label: 'crane',
      build(scene, T) {
        ground(scene, T);
        const r = crane({ height: 30 });
        scene.add(r.obj);
        return { pos: [42, 18, 42], look: [0, 14, 6], update: r.update, time: 3 };
      },
    },
    {
      label: 'lampPost x3',
      build(scene, T) {
        ground(scene, T);
        for (let i = 0; i < 3; i++) {
          const r = lampPost();
          r.obj.position.set((i - 1) * 4, 0, -i * 2);
          scene.add(r.obj);
        }
        return { pos: [3, 4, 9], look: [0, 3.6, -1] };
      },
    },
    {
      label: 'bannerFlags',
      build(scene, T) {
        ground(scene, T);
        road(scene, T, 17, 60).rotation.z = Math.PI / 2;
        const r = bannerFlags({ length: 40 });
        scene.add(r.obj);
        return { pos: [6, 4.2, 30], look: [0, 4.4, 0], update: r.update, time: 0.8 };
      },
    },
    {
      label: 'harbour scene',
      build(scene, T) {
        ground(scene, T);
        road(scene, T);
        const g = startGantry({});
        g.setGreen(true);
        const s = grandstand({ length: 40, roofColor: BLUE });
        s.obj.position.x = 12;
        const p = pitBuilding({ length: 50 });
        p.obj.position.x = -12;
        p.obj.rotation.y = Math.PI;
        const t = controlTower();
        t.obj.position.set(-30, 0, -40);
        const a = airship({});
        a.obj.position.set(10, 34, -50);
        a.obj.rotation.y = 1.2;
        scene.add(g.obj, s.obj, p.obj, t.obj, a.obj);
        return { pos: [4, 8, 46], look: [0, 8, 0], update: multi((tt, dt) => s.update(tt, dt, 0.6), t.update, a.update), fov: 60 };
      },
    },
  ];
}
