// 구름섬 그랑프리 · Sky Harbor — 하늘 / 자연 레이어
// 하늘 돔, 해, 구름 바다(평면 2장 + 뭉게구름 무리), 높은 구름, 지평선의 먼 섬들, 새 떼,
// 그리고 맵 세션이 쓰는 도우미: 섬 밑면(islandUnderside), 작은 떠 있는 바위섬(floatingRock),
// 폭포(waterfall), 식물 인스턴싱(createFlora).
// 모든 배치는 seededRandom 으로만 정해서 모든 플레이어가 같은 세상을 봅니다. 전부 보기용(충돌 없음).
import * as THREE from 'three';
import { canvasTexture, seededRandom } from './track.js';

// ---------------------------------------------------------------- 공용 상수
const SUN_DIR = new THREE.Vector3(600, 1100, 400).normalize(); // 게임의 해 방향과 같음
const SKY = {
  zenith: '#2a76e0', // 머리 위 짙은 파랑
  mid: '#6cb6f4', // 중간 하늘
  horizon: '#e2effa', // 지평선 (안개 색과 같아야 이음매가 안 보임)
  warm: '#fbefdc', // 지평선 바로 위 따뜻한 띠
  sea: '#f2f6fd', // 지평선 아래: 밝은 구름 바다
  seaDeep: '#cdd9f0', // 바로 아래쪽: 구름 그늘
};
const FOG_NEAR = 320;
const FOG_FAR = 2600;
const CLOUD_Y = -70; // 구름 바다 높이

const UNDER_COLORS = {
  grass: '#6dcf48',
  grassDark: '#4fae3c',
  earth: '#bb8247',
  earth2: '#966139',
  rock: '#a0949f',
  rock2: '#807596',
  rock3: '#655c80',
  root: '#6a4426',
};

// ---------------------------------------------------------------- 공용 유틸
const _cache = {};
const cached = (key, make) => _cache[key] || (_cache[key] = make());
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** 색에 약간의 흔들림 (면마다 다른 색 → 로우폴리 느낌) */
function jit(hex, rnd, l = 0.05, h = 0.008, s = 0.04) {
  const c = new THREE.Color(hex);
  c.offsetHSL((rnd() - 0.5) * h, (rnd() - 0.5) * s, (rnd() - 0.5) * l);
  return c;
}

/** 위치로 정해지는 의사난수 (같은 꼭짓점은 항상 같은 값 → 틈 없이 울퉁불퉁하게) */
function hash3(x, y, z, seed = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
  return s - Math.floor(s);
}

/** 꼭짓점을 위치 해시로 밀어 울퉁불퉁하게 (비색인 도형용) */
function lumpy(geo, amt, seed = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const kx = Math.round(x * 1000) / 1000, ky = Math.round(y * 1000) / 1000, kz = Math.round(z * 1000) / 1000;
    const f = 1 + (hash3(kx, ky, kz, seed) - 0.5) * 2 * amt;
    p.setXYZ(i, x * f, y * f, z * f);
  }
  return g;
}

/** 삼각형을 모아 하나의 꼭짓점색 도형으로 굽는 도구 (그리기 호출 1번) */
class GeoBuilder {
  constructor() {
    this.pos = [];
    this.col = [];
  }
  tri(a, b, c, color) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.col.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b);
  }
  /** three 기본 도형을 행렬로 옮겨 굽기. colorOf: Color | (중심, 법선) => Color | 생략(도형의 꼭짓점색 복사) */
  shape(geo, matrix, colorOf) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    const src = g.attributes.color;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const n = new THREE.Vector3(), e = new THREE.Vector3(), ctr = new THREE.Vector3();
    for (let i = 0; i + 2 < p.count; i += 3) {
      a.fromBufferAttribute(p, i).applyMatrix4(matrix);
      b.fromBufferAttribute(p, i + 1).applyMatrix4(matrix);
      c.fromBufferAttribute(p, i + 2).applyMatrix4(matrix);
      if (colorOf === undefined && src) {
        this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        for (let k = 0; k < 3; k++) this.col.push(src.getX(i + k), src.getY(i + k), src.getZ(i + k));
        continue;
      }
      let col = colorOf;
      if (typeof colorOf === 'function') {
        n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
        ctr.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        col = colorOf(ctr, n);
      }
      this.tri(a, b, c, col || new THREE.Color('#ffffff'));
    }
    if (g !== geo) g.dispose();
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * 만화풍 램버트 재질: 그늘이 검게 죽지 않도록 자기 색을 조금 스스로 빛나게 함
 * (emissive = glow × 자기 색 — 꼭짓점색·인스턴스색 포함)
 */
function toonMat({ color = '#ffffff', vertexColors = false, glow = 0.25, side = THREE.FrontSide, key = 'toon' } = {}) {
  const m = new THREE.MeshLambertMaterial({ color, vertexColors, flatShading: true, side, emissive: new THREE.Color(glow, glow, glow) });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= diffuseColor.rgb;'
    );
  };
  m.customProgramCacheKey = () => 'gpToon';
  m.name = key;
  return m;
}
const vcMat = () => cached('mat:vc', () => toonMat({ vertexColors: true, glow: 0.2, key: 'gpVC' }));
const vcMat2 = () => cached('mat:vc2', () => toonMat({ vertexColors: true, glow: 0.3, side: THREE.DoubleSide, key: 'gpVC2' }));
const cloudMat = () => cached('mat:cloud', () => {
  const m = toonMat({ color: '#ffffff', glow: 0.0, key: 'gpCloud' });
  m.emissive.set('#bfcbf0').multiplyScalar(0.9); // 구름 그늘은 연보라빛 파랑
  m.onBeforeCompile = () => {}; // 구름은 고정 그늘색을 그대로 씀
  m.customProgramCacheKey = () => 'gpCloud';
  return m;
});
const puffGeo = () => cached('geo:puff', () => new THREE.IcosahedronGeometry(1, 1));
const farPuffGeo = () => cached('geo:farPuff', () => new THREE.SphereGeometry(1, 7, 4));

// ---------------------------------------------------------------- 다각형 도구
function polyArea(xs, zs) {
  let a = 0;
  const n = xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) a += xs[j] * zs[i] - xs[i] * zs[j];
  return a / 2;
}
function polyCentroid(xs, zs) {
  let a = 0, cx = 0, cz = 0;
  const n = xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = xs[j] * zs[i] - xs[i] * zs[j];
    a += f;
    cx += (xs[j] + xs[i]) * f;
    cz += (zs[j] + zs[i]) * f;
  }
  if (Math.abs(a) < 1e-6) {
    let sx = 0, sz = 0;
    for (let i = 0; i < n; i++) (sx += xs[i]), (sz += zs[i]);
    return [sx / n, sz / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}
/** 둘레를 같은 간격으로 다시 찍기 */
function resample(pts, m) {
  const n = pts.length;
  const seg = [];
  let per = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n];
    const l = Math.hypot(x1 - x0, z1 - z0);
    seg.push(l);
    per += l;
  }
  const xs = new Float64Array(m), zs = new Float64Array(m);
  let si = 0, acc = 0;
  for (let k = 0; k < m; k++) {
    const d = (k / m) * per;
    while (si < n - 1 && acc + seg[si] < d) acc += seg[si++];
    const t = seg[si] > 0 ? (d - acc) / seg[si] : 0;
    const [x0, z0] = pts[si], [x1, z1] = pts[(si + 1) % n];
    xs[k] = lerp(x0, x1, t);
    zs[k] = lerp(z0, z1, t);
  }
  return { xs, zs, per };
}
/** 라플라시안 다듬기: 반복할수록 오목한 곳이 메워지며 볼록한 덩어리로 줄어듦 */
function smoothStep(xs, zs, iters, tx, tz) {
  const n = xs.length;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      tx[i] = xs[i] + 0.5 * ((xs[a] + xs[b]) * 0.5 - xs[i]);
      tz[i] = zs[i] + 0.5 * ((zs[a] + zs[b]) * 0.5 - zs[i]);
    }
    xs.set(tx);
    zs.set(tz);
  }
}

// ---------------------------------------------------------------- 섬 밑면
// 높이 비율 T(0=위, 1=꼭지) 과 반지름 비율 R
const LEVELS = [
  [0, 1],
  [0.03, 1],
  [0.085, 0.985],
  [0.16, 0.945],
  [0.25, 0.88],
  [0.36, 0.78],
  [0.49, 0.64],
  [0.63, 0.47],
  [0.77, 0.3],
  [0.9, 0.14],
];

/** 밑면 삼각형을 B에 굽고, 윗면을 이을 수 있게 가장자리 정보를 돌려줌 */
function undersideInto(B, outline, { topY = 0, depth = 80, seed = 1, colors = {}, lip = 0.25, maxPts = 150, spacing = 5, roots = true, hang = true } = {}) {
  const C = { ...UNDER_COLORS, ...colors };
  const rnd = seededRandom(seed * 7919 + 13);
  let pts = outline.map((p) => [p[0], p[1]]);
  if (pts.length > 2) {
    const [fx, fz] = pts[0], [lx, lz] = pts[pts.length - 1];
    if (Math.hypot(fx - lx, fz - lz) < 1e-6) pts.pop();
  }
  // 반시계 방향으로 통일
  {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    if (polyArea(xs, zs) < 0) pts.reverse();
  }
  let per0 = 0;
  for (let i = 0; i < pts.length; i++) per0 += Math.hypot(pts[(i + 1) % pts.length][0] - pts[i][0], pts[(i + 1) % pts.length][1] - pts[i][1]);
  const M = Math.max(12, Math.min(maxPts, Math.round(per0 / spacing)));
  const { xs: X0, zs: Z0 } = resample(pts, M);
  const A0 = Math.abs(polyArea(X0, Z0));
  const size = Math.sqrt(A0 / Math.PI); // 같은 넓이 원의 반지름
  const topFn = typeof topY === 'function' ? topY : () => topY;
  const Y0 = new Float64Array(M);
  let yMean = 0;
  for (let i = 0; i < M; i++) {
    Y0[i] = topFn(X0[i], Z0[i]) + lip;
    yMean += Y0[i] / M;
  }
  // 둘레를 따라 부드럽게 변하는 잡음 (꼭짓점마다 다른 깊이 → 손으로 빚은 느낌)
  const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU, rnd() * TAU];
  const wave = (i, a = 0) => {
    const u = (i / M) * TAU;
    return Math.sin(u * 2 + ph[a % 4]) * 0.55 + Math.sin(u * 3 + ph[(a + 1) % 4]) * 0.3 + Math.sin(u * 7 + ph[(a + 2) % 4]) * 0.15;
  };
  // 가장자리 바깥 방향 (반시계 → 오른쪽 법선이 바깥)
  const NX = new Float64Array(M), NZ = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const a = (i + M - 1) % M, b = (i + 1) % M;
    const tx = X0[b] - X0[a], tz = Z0[b] - Z0[a];
    const l = Math.hypot(tx, tz) || 1;
    NX[i] = tz / l;
    NZ[i] = -tx / l;
  }
  // 고리별 위치 계산
  const K = LEVELS.length;
  const rings = []; // [{x:Float64Array, y, z}]
  const sx = Float64Array.from(X0), sz = Float64Array.from(Z0);
  const tx = new Float64Array(M), tz = new Float64Array(M);
  const itersMax = Math.round(M * M * 0.06);
  let done = 0;
  const lipOut = Math.min(1.6, 0.3 + size * 0.012);
  for (let k = 0; k < K; k++) {
    const [T, R] = LEVELS[k];
    const rx = new Float64Array(M), ry = new Float64Array(M), rz = new Float64Array(M);
    if (k === 0) {
      rx.set(X0);
      rz.set(Z0);
      ry.set(Y0);
    } else if (k === 1) {
      // 풀 덮인 입술: 가장자리에서 살짝 바깥으로 튀어나옴
      for (let i = 0; i < M; i++) {
        const o = lipOut * (0.7 + 0.6 * rnd());
        rx[i] = X0[i] + NX[i] * o;
        rz[i] = Z0[i] + NZ[i] * o;
        ry[i] = Y0[i] - lip - depth * T * (0.8 + 0.4 * rnd()) - 0.6;
      }
    } else {
      const want = Math.round(Math.pow(Math.max(0, 1 - R - 0.01), 1.15) * itersMax);
      if (want > done) {
        smoothStep(sx, sz, want - done, tx, tz);
        done = want;
      }
      const a = Math.sqrt(Math.abs(polyArea(sx, sz)) / A0) || 1;
      const [cx, cz] = polyCentroid(sx, sz);
      const s = Math.min(1, R / a);
      const jA = size * 0.035 * Math.sin(Math.PI * Math.min(1, T * 1.4)) + 0.4;
      for (let i = 0; i < M; i++) {
        let x = cx + (sx[i] - cx) * s, z = cz + (sz[i] - cz) * s;
        const dx = x - cx, dz = z - cz;
        const dl = Math.hypot(dx, dz) || 1;
        const j = (rnd() - 0.5) * 2 * jA + wave(i, k) * jA * 0.8;
        x += (dx / dl) * j;
        z += (dz / dl) * j;
        const yb = lerp(Y0[i] - lip, yMean - lip, Math.min(1, T * 2.5));
        const tt = T + 0.16 * wave(i, 1) * T * (1 - T) * 4 + (rnd() - 0.5) * 0.03 * T;
        rx[i] = x;
        rz[i] = z;
        ry[i] = yb - depth * tt;
      }
    }
    rings.push({ x: rx, y: ry, z: rz, T });
  }
  // 꼭지점
  const last = rings[K - 1];
  let tipX = 0, tipZ = 0;
  for (let i = 0; i < M; i++) (tipX += last.x[i] / M), (tipZ += last.z[i] / M);
  const tip = new THREE.Vector3(tipX, yMean - lip - depth * (1 + rnd() * 0.06), tipZ);

  // 띠 색 (지층): 깊이 비율 + 둘레 잡음
  const band = (t, k) => {
    if (k === 0) return jit(C.grass, rnd, 0.06);
    if (k === 1) return rnd() < 0.35 ? jit(C.grassDark, rnd, 0.06) : jit(C.earth, rnd, 0.06);
    if (t < 0.2) return jit(C.earth, rnd, 0.07);
    if (t < 0.34) return jit(C.earth2, rnd, 0.07);
    if (t < 0.55) return jit(C.rock, rnd, 0.07);
    if (t < 0.76) return jit(C.rock2, rnd, 0.07);
    return jit(C.rock3, rnd, 0.07);
  };
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vd = new THREE.Vector3();
  for (let k = 0; k < K - 1; k++) {
    const r0 = rings[k], r1 = rings[k + 1];
    const tm = (LEVELS[k][0] + LEVELS[k + 1][0]) / 2;
    for (let i = 0; i < M; i++) {
      const i2 = (i + 1) % M;
      va.set(r0.x[i], r0.y[i], r0.z[i]);
      vb.set(r0.x[i2], r0.y[i2], r0.z[i2]);
      vc.set(r1.x[i2], r1.y[i2], r1.z[i2]);
      vd.set(r1.x[i], r1.y[i], r1.z[i]);
      const t = tm + wave(i, 2) * 0.05 + (rnd() - 0.5) * 0.04;
      const c1 = band(t, k);
      const c2 = rnd() < 0.7 ? c1 : band(t + 0.03, k);
      if ((i + k) & 1) {
        B.tri(va, vb, vc, c1);
        B.tri(va, vc, vd, c2);
      } else {
        B.tri(va, vb, vd, c1);
        B.tri(vb, vc, vd, c2);
      }
    }
  }
  for (let i = 0; i < M; i++) {
    const i2 = (i + 1) % M;
    va.set(last.x[i], last.y[i], last.z[i]);
    vb.set(last.x[i2], last.y[i2], last.z[i2]);
    B.tri(va, vb, tip, jit(C.rock3, rnd, 0.06));
  }

  // 매달린 뿌리 / 덩굴 (입술 바로 아래)
  if (roots) {
    const step = Math.max(3, Math.round(M / Math.min(40, 6 + size / 12)));
    for (let i = Math.floor(rnd() * step); i < M; i += step + Math.floor(rnd() * 3)) {
      const r1 = rings[1], r2 = rings[2];
      const green = rnd() < 0.4;
      const L = Math.min(14, 2.5 + depth * (0.05 + rnd() * 0.08)) * (green ? 0.7 : 1);
      const p0 = new THREE.Vector3(r1.x[i], r1.y[i] + 0.4, r1.z[i]);
      // 밑면을 따라 안쪽으로 살짝 휘며 내려감
      const inx = r2.x[i] - r1.x[i], inz = r2.z[i] - r1.z[i];
      const p1 = new THREE.Vector3(p0.x + inx * 0.3 + (rnd() - 0.5), p0.y - L * 0.5, p0.z + inz * 0.3 + (rnd() - 0.5));
      const p2 = new THREE.Vector3(p1.x + (rnd() - 0.5) * 1.5, p1.y - L * 0.5, p1.z + (rnd() - 0.5) * 1.5);
      const w = Math.min(0.45, 0.12 + size * 0.0015);
      const col = green ? jit(C.grassDark, rnd) : jit(C.root, rnd);
      strut(B, p0, p1, w, w * 0.65, col);
      strut(B, p1, p2, w * 0.65, 0.02, col);
    }
  }
  // 매달린 바위 (깊은 고리에서 아래로 뾰족)
  if (hang) {
    const n = Math.max(2, Math.min(10, Math.round(size / 25) + 2));
    for (let h = 0; h < n; h++) {
      const k = 5 + Math.floor(rnd() * 4);
      const i = Math.floor(rnd() * M);
      const r = rings[k];
      const rad = Math.max(0.8, depth * (0.03 + rnd() * 0.05));
      const len = rad * (2.2 + rnd() * 2);
      const [cx, cz] = [tipX, tipZ];
      const x = lerp(r.x[i], cx, 0.15), z = lerp(r.z[i], cz, 0.15);
      _m4.compose(_p.set(x, r.y[i] - len * 0.5 + rad * 0.6, z), _q.setFromAxisAngle(_up, rnd() * TAU), _s.set(1, 1, 1));
      _m4.multiply(new THREE.Matrix4().makeRotationX(Math.PI));
      const cols = [C.rock2, C.rock3, C.rock];
      B.shape(new THREE.ConeGeometry(rad, len, 5), _m4, () => jit(cols[Math.floor(rnd() * 3)], rnd, 0.08));
    }
  }
  return { xs: X0, zs: Z0, ys: Y0, n: M, size, yMean, cx: tipX, cz: tipZ, centroid: polyCentroid(X0, Z0) };
}

/** p → q 로 이어지는 가는 기둥(뿌리 등) */
function strut(B, p, q, r0, r1, color, sides = 3) {
  const d = new THREE.Vector3().subVectors(q, p);
  const len = d.length();
  if (len < 1e-4) return;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3().addVectors(p, q).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()),
    new THREE.Vector3(1, 1, 1)
  );
  // 위(+y)가 q쪽이므로 r0/r1 순서를 맞춤
  B.shape(new THREE.CylinderGeometry(r1, r0, len, sides, 1, true), m, color);
}

/** 별 모양(중심에서 보이는) 가장자리에 풀 덮인 윗면 + 작은 언덕 */
function capInto(B, info, { hill = 2, seed = 1, colors = [UNDER_COLORS.grass, '#62c444', '#78d652'] } = {}) {
  const rnd = seededRandom(seed * 31 + 7);
  const { xs, zs, ys, n } = info;
  const [cx, cz] = info.centroid;
  const F = [1, 0.68, 0.36];
  const H = [0, 0.45, 0.85];
  const ring = F.map((f, k) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = cx + (xs[i] - cx) * f, z = cz + (zs[i] - cz) * f;
      const y = lerp(ys[i], info.yMean, 1 - f) + hill * H[k] * (k ? 0.8 + 0.4 * hash3(x, 0, z, seed) : 0);
      out.push(new THREE.Vector3(x, y, z));
    }
    return out;
  });
  const top = new THREE.Vector3(cx, info.yMean + hill, cz);
  const pick = () => jit(colors[Math.floor(rnd() * colors.length)], rnd, 0.05);
  for (let k = 0; k < F.length - 1; k++)
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      B.tri(ring[k][i], ring[k][i2], ring[k + 1][i2], pick());
      B.tri(ring[k][i], ring[k + 1][i2], ring[k + 1][i], pick());
    }
  const L = ring[F.length - 1];
  for (let i = 0; i < n; i++) B.tri(L[i], L[(i + 1) % n], top, pick());
  // 윗면 높이 근사 (나무 심을 때 사용)
  return (fx) => info.yMean + hill * (1 - fx * fx) * 0.95;
}

/**
 * 떠 있는 섬의 바위 밑면.
 * outline: [[x,z],...] 닫힌 다각형(시계/반시계 무관, 오목 가능), topY: 숫자 또는 (x,z)=>y
 * 가장자리에서 시작해 depth m 아래 꼭지까지 지층 색이 있는 거꾸로 된 산 모양.
 */
export function islandUnderside(outline, { topY = 0, depth = 80, seed = 1, colors, lip = 0.25 } = {}) {
  const B = new GeoBuilder();
  undersideInto(B, outline, { topY, depth, seed, colors, lip });
  const mesh = new THREE.Mesh(B.geometry(), vcMat2());
  mesh.name = 'islandUnderside';
  return mesh;
}

/** 작은 떠 있는 바위섬 (윗면 가운데가 원점) */
export function floatingRock({ r = 8, seed = 1, grass = true } = {}) {
  const rnd = seededRandom(seed * 101 + 3);
  const n = Math.max(12, Math.min(28, Math.round(r * 2)));
  const ph = [rnd() * TAU, rnd() * TAU];
  const outline = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (1 + 0.1 * Math.sin(a * 2 + ph[0]) + 0.06 * Math.sin(a * 3 + ph[1]) + (rnd() - 0.5) * 0.1);
    outline.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const hill = r * 0.07;
  const B = new GeoBuilder();
  const info = undersideInto(B, outline, {
    topY: -hill,
    depth: r * (1.6 + rnd() * 0.5),
    seed,
    lip: 0,
    maxPts: n,
    spacing: 0.01,
    colors: grass ? {} : { grass: '#9d97ad', grassDark: '#8a849c' },
  });
  const height = capInto(B, info, { hill, seed, colors: grass ? undefined : ['#a6a1b5', '#9893aa', '#b0abbf'] });
  if (grass) {
    const nb = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < nb; i++) {
      const a = rnd() * TAU, f = 0.2 + rnd() * 0.45;
      const sc = (r / 8) * (0.9 + rnd() * 0.6);
      _m4.compose(_p.set(Math.cos(a) * r * f, height(f) - 0.1 * sc, Math.sin(a) * r * f), _q.setFromAxisAngle(_up, rnd() * TAU), _s.set(sc, sc, sc));
      B.shape(floraGeo('bush'), _m4);
    }
    if (r >= 5) {
      const a = rnd() * TAU, f = 0.4;
      const sc = r / 8;
      _m4.compose(_p.set(Math.cos(a) * r * f, height(f) - 0.05, Math.sin(a) * r * f), _q.identity(), _s.set(sc, sc, sc));
      B.shape(floraGeo('flowers'), _m4);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const a = rnd() * TAU, f = rnd() * 0.5;
      const sc = (r / 10) * (0.5 + rnd() * 0.5);
      _m4.compose(_p.set(Math.cos(a) * r * f, height(f) - 0.2 * sc, Math.sin(a) * r * f), _q.setFromAxisAngle(_up, rnd() * TAU), _s.set(sc, sc, sc));
      B.shape(floraGeo('rock'), _m4);
    }
  }
  const mesh = new THREE.Mesh(B.geometry(), vcMat2());
  mesh.name = 'floatingRock';
  return { obj: mesh };
}

// ---------------------------------------------------------------- 폭포
const waterMats = () =>
  cached('mat:water', () => {
    const tex = canvasTexture(128, 256, (g, w, h) => {
      const r = seededRandom(4242);
      g.fillStyle = 'rgba(96,190,250,0.62)';
      g.fillRect(0, 0, w, h);
      // 넓고 옅은 띠
      for (let i = 0; i < 10; i++) {
        const x = r() * w, ww = 8 + r() * 18;
        g.fillStyle = `rgba(190,235,255,${0.15 + r() * 0.2})`;
        g.fillRect(x, 0, ww, h);
        g.fillRect(x - w, 0, ww, h);
      }
      // 흰 물줄기 (세로로 이어져 반복됨)
      for (let i = 0; i < 70; i++) {
        const x = r() * w, ww = 1.5 + r() * 4.5, y = r() * h, len = 30 + r() * 140;
        g.fillStyle = `rgba(255,255,255,${0.45 + r() * 0.5})`;
        for (const dy of [0, -h]) for (const dx of [0, -w]) g.fillRect(x + dx, y + dy, ww, len);
      }
    });
    const tex2 = tex.clone();
    tex2.needsUpdate = true;
    const front = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const back = new THREE.MeshBasicMaterial({ map: tex2, color: '#7cc4f4', vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    front.name = 'gpWaterFront';
    back.name = 'gpWaterBack';
    return { front, back, tex, tex2, t: -1 };
  });
function setWaterTime(time) {
  const w = waterMats();
  if (w.t === time) return;
  w.t = time;
  w.tex.offset.y = -((time * 0.85) % 1);
  w.tex2.offset.y = -((time * 0.55 + 0.37) % 1);
}

/** 흐르는 물줄기 리본: 위 가장자리 가운데가 원점, -y 로 떨어지며 +z 로 조금 휘어 나감 */
function ribbonGeo(width, height, { inset = 0, spread = 0.35, outK = 0.16 } = {}) {
  const nx = 5, ny = 22;
  const pos = [], uv = [], col = [], idx = [];
  for (let j = 0; j <= ny; j++) {
    const s = j / ny;
    const w = width * (1 + spread * s);
    const z = height * outK * Math.sqrt(s) + inset;
    const y = -height * s;
    const fade = s < 0.55 ? 1 : Math.max(0, 1 - (s - 0.55) / 0.45);
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const e = (u - 0.5) * 2;
      pos.push(e * w * 0.5, y, z - e * e * width * 0.12 - inset * 0.5 * e * e);
      uv.push(u, (s * height) / (width * 2));
      const edge = 1 - Math.pow(Math.abs(e), 6) * 0.6;
      col.push(1, 1, 1, fade * edge);
    }
  }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** 같은 속성(position/uv/color4)을 가진 색인 도형들을 행렬로 옮겨 하나로 합침 */
function mergeIndexed(list) {
  const pos = [], uv = [], col = [], idx = [];
  const v = new THREE.Vector3();
  for (const { geo, matrix } of list) {
    const base = pos.length / 3;
    const p = geo.attributes.position, t = geo.attributes.uv, c = geo.attributes.color;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      pos.push(v.x, v.y, v.z);
      uv.push(t.getX(i), t.getY(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i), c.getW(i));
    }
    for (const k of geo.index.array) idx.push(k + base);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** 섬 가장자리에서 쏟아지는 폭포. 원점 = 위 가장자리 가운데, -y 로 떨어지고 +z(바깥)로 휨 */
export function waterfall({ width = 10, height = 60, seed = 1 } = {}) {
  const rnd = seededRandom(seed * 53 + 11);
  const W = waterMats();
  const obj = new THREE.Group();
  obj.name = 'waterfall';
  const back = new THREE.Mesh(ribbonGeo(width * 1.08, height, { inset: -0.5, spread: 0.45 }), W.back);
  const front = new THREE.Mesh(ribbonGeo(width, height, { inset: 0.15 }), W.front);
  back.renderOrder = 1;
  front.renderOrder = 2;
  obj.add(back, front);
  // 물거품(위) + 물보라(아래): 구름과 같은 재질의 덩어리
  const foam = [];
  const nf = Math.max(4, Math.round(width / 2.2));
  for (let i = 0; i < nf; i++) {
    const s = width * (0.09 + rnd() * 0.06);
    foam.push({ x: ((i + 0.5) / nf - 0.5) * width * 0.95, y: 0.1 + rnd() * 0.3, z: 0.4 + rnd() * 0.6, s, sy: s * 0.6, ph: rnd() * TAU, mist: false });
  }
  const zb = height * 0.16 + 0.15;
  const nm = 9;
  for (let i = 0; i < nm; i++) {
    const s = width * (0.35 + rnd() * 0.35);
    foam.push({ x: (rnd() - 0.5) * width * 1.4, y: -height * (0.8 + rnd() * 0.14), z: zb + (rnd() - 0.3) * width * 0.5, s, sy: s * 0.8, ph: i / nm, mist: true });
  }
  const im = new THREE.InstancedMesh(puffGeo(), cloudMat(), foam.length);
  im.name = 'waterfallFoam';
  obj.add(im);
  const place = (time) => {
    foam.forEach((f, i) => {
      let k = 1, dy = 0;
      if (f.mist) {
        // 물보라: 커지며 떠올랐다 사라지기를 반복
        const c = (time * 0.35 + f.ph) % 1;
        k = Math.sin(Math.PI * c) * (0.6 + c * 0.6);
        dy = c * height * 0.06;
      } else k = 0.85 + 0.15 * Math.sin(time * 5 + f.ph);
      _m4.compose(_p.set(f.x, f.y + dy, f.z), _q.setFromAxisAngle(_up, f.ph * 3), _s.set(f.s * k, f.sy * k, f.s * k));
      im.setMatrixAt(i, _m4);
    });
    im.instanceMatrix.needsUpdate = true;
  };
  place(0);
  im.computeBoundingSphere();
  return {
    obj,
    update(time) {
      setWaterTime(time);
      place(time);
    },
  };
}

// ---------------------------------------------------------------- 식물
const FLORA_TYPES = ['pine', 'round', 'blossom', 'bush', 'flowers', 'rock', 'mushroom', 'crystal'];
// 충돌: [반지름, 높이] (scale 1 기준), null = 통과 가능
const FLORA_SOLID = { pine: [0.6, 10], round: [0.65, 9], blossom: [0.6, 8], rock: [1.2, 1.6], mushroom: [0.75, 4], crystal: [1.2, 3] };

function floraGeo(type) {
  return cached('flora:' + type, () => {
    const B = new GeoBuilder();
    const r = seededRandom(FLORA_TYPES.indexOf(type) * 977 + 5);
    const m = new THREE.Matrix4();
    const at = (x, y, z, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0) =>
      m.compose(_p.set(x, y, z), _q.setFromEuler(new THREE.Euler(rx, ry, rz)), _s.set(sx, sy, sz));
    const trunk = (h, r0, r1, lean = 0) => B.shape(new THREE.CylinderGeometry(r1, r0, h, 6), at(lean * 0.5, h / 2, 0, 1, 1, 1, 0, 0, -lean / h), () => jit('#8b5a32', r, 0.06));
    switch (type) {
      case 'pine': {
        trunk(2.6, 0.48, 0.3);
        const tiers = [
          [3.3, 4.2, 1.6, '#2f9150'],
          [2.6, 3.8, 3.9, '#39a35a'],
          [1.8, 3.5, 6.3, '#46b465'],
        ];
        for (const [rad, h, base, c] of tiers) B.shape(lumpy(new THREE.ConeGeometry(rad, h, 8, 1), 0.06, base), at(0, base + h / 2, 0, 1, 1, 1, r() * TAU), (ct, n) => jit(n.y < -0.5 ? '#25764a' : c, r, 0.07));
        break;
      }
      case 'round': {
        trunk(4.2, 0.58, 0.36);
        const balls = [
          [3.0, 0, 6.0, 0, '#5cc43f'],
          [2.2, 1.9, 5.0, 0.7, '#4fb438'],
          [2.0, -1.7, 5.3, -0.9, '#68d14a'],
          [1.7, 0.2, 7.3, 0.9, '#74d955'],
        ];
        for (const [rad, x, y, z, c] of balls) B.shape(lumpy(new THREE.IcosahedronGeometry(rad, 1), 0.08, rad), at(x, y, z), () => jit(c, r, 0.08));
        break;
      }
      case 'blossom': {
        trunk(3.6, 0.52, 0.3, 0.5);
        const balls = [
          [2.5, 0.3, 5.3, 0, '#ffb3d3'],
          [1.9, 2.0, 4.6, 0.5, '#ff9fc7'],
          [1.8, -1.4, 4.8, -0.7, '#ffc4de'],
          [1.5, 0.6, 6.5, 0.9, '#ffd2e6'],
          [1.3, -0.6, 6.3, -1.0, '#ffa8cc'],
        ];
        for (const [rad, x, y, z, c] of balls) B.shape(lumpy(new THREE.IcosahedronGeometry(rad, 1), 0.09, rad + 3), at(x, y, z), () => (r() < 0.12 ? jit('#fff0f6', r, 0.04) : jit(c, r, 0.07)));
        break;
      }
      case 'bush': {
        const balls = [
          [0.78, 0, 0.62, 0, '#4cae3a'],
          [0.58, 0.62, 0.45, 0.2, '#5cc046'],
          [0.55, -0.52, 0.48, -0.32, '#57ba42'],
          [0.45, 0.1, 0.42, 0.6, '#63c84c'],
        ];
        for (const [rad, x, y, z, c] of balls) B.shape(lumpy(new THREE.IcosahedronGeometry(rad, 1), 0.1, rad + 9), at(x, y, z), () => jit(c, r, 0.08));
        break;
      }
      case 'flowers': {
        const pal = ['#ff5a7a', '#ffd23f', '#ffffff', '#b77bff', '#ff8a3d', '#5ab8ff'];
        for (let i = 0; i < 5; i++) {
          const a = r() * TAU, d = r() * 0.9;
          B.shape(new THREE.ConeGeometry(0.32, 0.32, 5), at(Math.cos(a) * d, 0.12, Math.sin(a) * d, 1, 1, 1, r()), () => jit('#4dae3c', r, 0.08));
        }
        for (let i = 0; i < 11; i++) {
          const a = r() * TAU, d = Math.sqrt(r()) * 1.15;
          const x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.28 + r() * 0.22;
          B.shape(new THREE.CylinderGeometry(0.03, 0.03, h, 3, 1, true), at(x, h / 2, z), () => jit('#3f9a34', r));
          const c = pal[Math.floor(r() * pal.length)];
          B.shape(new THREE.OctahedronGeometry(0.17), at(x, h + 0.05, z, 1, 0.6, 1, r()), () => jit(c, r, 0.05));
          B.shape(new THREE.OctahedronGeometry(0.06), at(x, h + 0.12, z), () => new THREE.Color(c === '#ffd23f' ? '#ff8a3d' : '#ffe14d'));
        }
        break;
      }
      case 'rock': {
        B.shape(lumpy(new THREE.DodecahedronGeometry(1, 0), 0.18, 3), at(0, 0.55, 0, 1.25, 0.95, 1.05), (c, n) => (n.y > 0.75 && c.y > 1.1 ? jit('#7cc44f', r, 0.06) : jit(r() < 0.5 ? '#a29fb3' : '#8f8ca3', r, 0.06)));
        B.shape(lumpy(new THREE.DodecahedronGeometry(0.5, 0), 0.2, 4), at(1.0, 0.2, 0.55, 1, 0.8, 1, 0.6), () => jit('#9895aa', r, 0.06));
        break;
      }
      case 'mushroom': {
        B.shape(new THREE.CylinderGeometry(0.42, 0.62, 2.7, 8), at(0, 1.35, 0), () => jit('#fbeedb', r, 0.04));
        B.shape(new THREE.SphereGeometry(1.9, 12, 5, 0, TAU, 0, Math.PI / 2), at(0, 2.5, 0, 1, 0.74, 1), () => jit('#ff4b3e', r, 0.05));
        B.shape(new THREE.CircleGeometry(1.88, 12), at(0, 2.52, 0, 1, 1, 1, 0, Math.PI / 2), () => jit('#f3d9bd', r, 0.04));
        for (let i = 0; i < 8; i++) {
          const ph = 0.25 + r() * 1.0, th = (i / 8) * TAU + r() * 0.5;
          const x = Math.sin(ph) * Math.cos(th) * 1.92, y = 2.5 + Math.cos(ph) * 1.92 * 0.74, z = Math.sin(ph) * Math.sin(th) * 1.92;
          const sz = 0.22 + r() * 0.14;
          const q = new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(x, (y - 2.5) / 0.74, z).normalize());
          B.shape(new THREE.CylinderGeometry(sz, sz, 0.12, 6), m.compose(_p.set(x, y, z), q, _s.set(1, 1, 1)), () => new THREE.Color('#ffffff'));
        }
        break;
      }
      case 'crystal': {
        const parts = [
          [0.55, 1.65, 0, 0, 0, 0],
          [0.4, 1.1, 0.7, 0.35, 0.45, 0.4],
          [0.38, 1.0, -0.6, -0.4, -0.5, 1.9],
          [0.3, 0.75, 0.2, -0.75, 0.55, 3.6],
          [0.28, 0.6, -0.3, 0.7, -0.6, 5.0],
        ];
        for (const [w, h, x, z, tilt, yaw] of parts) {
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, tilt));
          const pos = new THREE.Vector3(x, h * 0.85, z);
          B.shape(new THREE.OctahedronGeometry(1), m.compose(pos, q, _s.set(w, h, w)), () => new THREE.Color().setScalar(0.62 + r() * 0.38));
        }
        break;
      }
    }
    return B.geometry();
  });
}

/** 먼 섬용 아주 단순한 나무 (실루엣만) */
function farTreeGeo(type) {
  return cached('farTree:' + type, () => {
    const B = new GeoBuilder();
    const r = seededRandom(FLORA_TYPES.indexOf(type) * 31 + 1);
    const m = new THREE.Matrix4();
    B.shape(new THREE.CylinderGeometry(0.35, 0.5, 3, 4, 1, true), m.makeTranslation(0, 1.5, 0), () => jit('#8b5a32', r));
    if (type === 'pine') {
      B.shape(new THREE.ConeGeometry(3.1, 5, 6, 1, true), m.makeTranslation(0, 4.2, 0), () => jit('#33975a', r, 0.08));
      B.shape(new THREE.ConeGeometry(2.2, 4.2, 6, 1, true), m.makeTranslation(0, 7.4, 0), () => jit('#44b065', r, 0.08));
    } else {
      const c = type === 'blossom' ? '#ffb3d3' : '#5cc43f';
      B.shape(lumpy(new THREE.IcosahedronGeometry(2.9, 0), 0.1, 2), m.makeTranslation(0, 5.8, 0), () => jit(c, r, 0.1));
    }
    return B.geometry();
  });
}

/**
 * 식물 인스턴싱 모음.
 * add(type, x, y, z, scale, rotY) 로 모은 뒤 build(parent) 한 번 → 종류마다 InstancedMesh 1개.
 */
export function createFlora() {
  const items = {};
  for (const t of FLORA_TYPES) items[t] = [];
  const meshes = [];
  return {
    add(type, x, y, z, scale = 1, rotY = 0) {
      if (!items[type]) throw new Error('알 수 없는 식물 종류: ' + type);
      items[type].push([x, y, z, scale, rotY]);
    },
    build(parent) {
      for (const type of FLORA_TYPES) {
        const list = items[type];
        if (!list.length) continue;
        const crystal = type === 'crystal';
        const mat = crystal ? cached('mat:crystal', () => toonMat({ vertexColors: true, glow: 0.85, key: 'gpCrystal' })) : vcMat();
        const im = new THREE.InstancedMesh(floraGeo(type), mat, list.length);
        im.name = 'flora:' + type;
        const col = new THREE.Color();
        list.forEach(([x, y, z, s, ry], i) => {
          im.setMatrixAt(i, _m4.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, ry), _s.set(s, s, s)));
          const r = seededRandom(Math.floor(x * 73 + z * 131 + i * 7) >>> 0);
          if (crystal) col.set(r() < 0.5 ? '#c07cff' : '#46e6d2').offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.06);
          else col.setRGB(1, 1, 1).offsetHSL((r() - 0.5) * 0.02, 0, (r() - 0.5) * 0.1);
          im.setColorAt(i, col);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = type !== 'flowers';
        im.receiveShadow = true;
        parent.add(im);
        meshes.push(im);
      }
      return meshes;
    },
    colliders() {
      const out = [];
      for (const type of FLORA_TYPES) {
        const solid = FLORA_SOLID[type];
        if (!solid) continue;
        for (const [x, y, z, s] of items[type]) out.push({ x, z, r: solid[0] * s, y0: y, y1: y + solid[1] * s });
      }
      return out;
    },
    meshes,
  };
}

// ---------------------------------------------------------------- 하늘
function cloudSeaTexture(seed, layer) {
  return canvasTexture(1024, 1024, (g, w, h) => {
    const r = seededRandom(seed);
    const wrap = (x, y, rad, fn) => {
      for (const dx of [-w, 0, w])
        for (const dy of [-h, 0, h]) {
          const X = x + dx, Y = y + dy;
          if (X + rad < 0 || X - rad > w || Y + rad < 0 || Y - rad > h) continue;
          fn(X, Y);
        }
    };
    const blob = (X, Y, rad, inner, outer, hold = 0.6) => {
      const gr = g.createRadialGradient(X, Y, 0, X, Y, rad);
      gr.addColorStop(0, inner);
      gr.addColorStop(hold, inner);
      gr.addColorStop(1, outer);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(X, Y, rad, 0, TAU);
      g.fill();
    };
    if (layer === 0) {
      // 바탕: 구름 사이 그늘
      g.fillStyle = '#b3c3ea';
      g.fillRect(0, 0, w, h);
      // 구름 무리(덩어리) 단위로: 무리 전체 그늘 → 밝은 몽우리들
      const clusters = [];
      for (let c = 0; c < 46; c++) {
        const cx = r() * w, cy = r() * h, R = 50 + r() * 110;
        const puffs = [];
        const n = 7 + Math.floor(r() * 9);
        for (let i = 0; i < n; i++) {
          const a = r() * TAU, d = Math.sqrt(r()) * R;
          puffs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 26 + r() * 52 * (1 - (d / R) * 0.5)]);
        }
        puffs.sort((a, b) => b[1] - a[1] + (a[2] - b[2]) * 0.2);
        clusters.push(puffs);
      }
      for (const puffs of clusters) {
        for (const [x, y, rad] of puffs) wrap(x + rad * 0.15, y + rad * 0.3, rad * 1.2, (X, Y) => blob(X, Y, rad * 1.15, 'rgba(140,158,214,0.75)', 'rgba(140,158,214,0)', 0.45));
        for (const [x, y, rad] of puffs) {
          wrap(x, y, rad, (X, Y) => blob(X, Y, rad, 'rgba(250,252,255,1)', 'rgba(214,224,248,0)', 0.78));
          wrap(x - rad * 0.2, y - rad * 0.22, rad * 0.7, (X, Y) => blob(X, Y, rad * 0.7, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)', 0.5));
        }
      }
    } else {
      // 위층: 투명 바탕에 흩어진 구름 무리
      for (let c = 0; c < 34; c++) {
        const cx = r() * w, cy = r() * h, R = 40 + r() * 90;
        const n = 5 + Math.floor(r() * 8);
        for (let i = 0; i < n; i++) {
          const a = r() * TAU, d = r() * R;
          const x = cx + Math.cos(a) * d * 1.4, y = cy + Math.sin(a) * d * 0.7, rad = 18 + r() * 46;
          wrap(x + rad * 0.1, y + rad * 0.22, rad * 1.1, (X, Y) => blob(X, Y, rad * 1.06, 'rgba(170,188,230,0.55)', 'rgba(170,188,230,0)', 0.5));
          wrap(x, y, rad, (X, Y) => blob(X, Y, rad, 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0)', 0.62));
        }
      }
    }
  });
}

function sunTexture() {
  return cached('tex:sun', () =>
    canvasTexture(256, 256, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,250,1)');
      gr.addColorStop(0.16, 'rgba(255,253,240,1)');
      gr.addColorStop(0.2, 'rgba(255,244,205,0.7)');
      gr.addColorStop(0.36, 'rgba(255,236,190,0.22)');
      gr.addColorStop(1, 'rgba(255,230,180,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    })
  );
}

/** 뭉게구름 한 덩어리를 퍼프 목록에 추가 (바닥은 납작하게) */
function addClump(out, rnd, x, y, z, size, flat = 0.62) {
  out.push({ x, y, z, sx: size, sy: size * flat, sz: size * 0.9, ry: rnd() * TAU });
  const n = 4 + Math.floor(rnd() * 5);
  for (let k = 0; k < n; k++) {
    const a = rnd() * TAU, d = size * (0.55 + rnd() * 0.65);
    const s = size * (0.42 + rnd() * 0.38);
    const fy = d / size;
    out.push({
      x: x + Math.cos(a) * d * 1.15,
      y: y - size * flat * 0.25 * fy + s * flat * 0.2 + (rnd() - 0.5) * size * 0.1,
      z: z + Math.sin(a) * d * 0.8,
      sx: s * (1 + rnd() * 0.25),
      sy: s * flat * (0.85 + rnd() * 0.35),
      sz: s,
      ry: rnd() * TAU,
    });
  }
  // 꼭대기 작은 몽우리
  if (rnd() < 0.7) out.push({ x: x + (rnd() - 0.5) * size * 0.5, y: y + size * flat * 0.65, z: z + (rnd() - 0.5) * size * 0.4, sx: size * 0.5, sy: size * 0.42, sz: size * 0.5, ry: rnd() * TAU });
}
function puffMesh(list, name, geo = puffGeo()) {
  const im = new THREE.InstancedMesh(geo, cloudMat(), list.length);
  im.name = name;
  list.forEach((p, i) => im.setMatrixAt(i, _m4.compose(_p.set(p.x, p.y, p.z), _q.setFromAxisAngle(_up, p.ry), _s.set(p.sx, p.sy, p.sz))));
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  return im;
}

/** 먼 섬 실루엣들 + 그 섬의 폭포들 (각각 그리기 호출 1번) */
function buildDistantIslands(center, lowPuffs, inner = 660) {
  const rnd = seededRandom(777);
  const B = new GeoBuilder();
  const falls = [];
  const placed = [];
  const N = 26;
  for (let i = 0; i < N; i++) {
    let ok = false, x = 0, z = 0, r = 0, ang = 0, dist = 0;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      ang = ((i + rnd() * 0.8) / N) * TAU;
      r = 30 + Math.pow(rnd(), 1.6) * 150;
      dist = Math.max(inner + r, inner + 40) + rnd() * (900 - r * 0.5);
      x = center.x + Math.cos(ang) * dist;
      z = center.z + Math.sin(ang) * dist;
      ok = placed.every((p) => Math.hypot(p[0] - x, p[1] - z) > p[2] + r + 60);
    }
    placed.push([x, z, r]);
    const topY = -25 + rnd() * 85 + (r > 110 ? -10 : 0);
    const depth = r * (1.1 + rnd() * 0.8);
    const n = 30 + Math.round(r / 6);
    const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
    const elong = 1 + rnd() * 0.5, rot = rnd() * TAU;
    const outline = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const rr = r * (1 + 0.16 * Math.sin(2 * a + ph[0]) + 0.1 * Math.sin(3 * a + ph[1]) + 0.05 * Math.sin(5 * a + ph[2]) + (rnd() - 0.5) * 0.05);
      const lx = Math.cos(a) * rr * elong, lz = Math.sin(a) * rr;
      outline.push([x + lx * Math.cos(rot) - lz * Math.sin(rot), z + lx * Math.sin(rot) + lz * Math.cos(rot)]);
    }
    const seed = 900 + i;
    const info = undersideInto(B, outline, { topY, depth, seed, lip: 0, maxPts: n, spacing: 0.01, roots: false, hang: true });
    const hill = r * (rnd() < 0.3 ? 0.28 + rnd() * 0.25 : 0.06 + rnd() * 0.12); // 가끔 봉긋한 산
    const height = capInto(B, info, { hill, seed });
    // 큰 섬 곁의 작은 위성 바위섬
    const ns = rnd() < 0.5 ? 1 + Math.floor(rnd() * 3) : 0;
    for (let k = 0; k < ns; k++) {
      const sr = 7 + rnd() * 14, a = rnd() * TAU, d = r * elong + sr + 15 + rnd() * 40;
      const sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d, sy = topY + (rnd() - 0.4) * 40;
      if (Math.hypot(sx - center.x, sz - center.z) < inner + sr) continue; // 코스 가까이엔 두지 않음
      const so = [];
      const sn = 14;
      for (let q = 0; q < sn; q++) {
        const qa = (q / sn) * TAU, qr = sr * (0.85 + rnd() * 0.3);
        so.push([sx + Math.cos(qa) * qr, sz + Math.sin(qa) * qr]);
      }
      const si = undersideInto(B, so, { topY: sy, depth: sr * (1.5 + rnd()), seed: seed * 10 + k, lip: 0, maxPts: sn, spacing: 0.01, roots: false, hang: false });
      capInto(B, si, { hill: sr * 0.12, seed: seed * 10 + k });
    }
    const [cx, cz] = info.centroid;
    // 나무 (멀리서도 보이게 크게)
    const nt = 3 + Math.floor(r / 14);
    for (let t = 0; t < nt; t++) {
      const k = Math.floor(rnd() * info.n), f = Math.sqrt(rnd()) * 0.72;
      const tx = cx + (info.xs[k] - cx) * f, tz = cz + (info.zs[k] - cz) * f;
      const type = rnd() < 0.55 ? 'pine' : rnd() < 0.7 ? 'round' : 'blossom';
      const s = 1.8 + rnd() * 1.6;
      _m4.compose(_p.set(tx, height(f) - 0.6 * s, tz), _q.setFromAxisAngle(_up, rnd() * TAU), _s.set(s, s, s));
      B.shape(farTreeGeo(type), _m4);
    }
    // 폭포: 큰 섬 일부, 코스 쪽을 보는 가장자리에
    if (r > 55 && rnd() < 0.5) {
      let best = 0, bd = -2;
      const dx = center.x - cx, dz = center.z - cz, dl = Math.hypot(dx, dz);
      for (let k = 0; k < info.n; k++) {
        const ex = info.xs[k] - cx, ez = info.zs[k] - cz, el = Math.hypot(ex, ez);
        const d = (ex * dx + ez * dz) / (el * dl);
        if (d > bd) (bd = d), (best = k);
      }
      const ox = dx / dl, oz = dz / dl;
      const px = info.xs[best] - ox * 1.2, pz = info.zs[best] - oz * 1.2;
      const fw = r * (0.12 + rnd() * 0.06), fh = depth * 0.9 + 30;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(px, info.ys[best] + 0.3, pz), new THREE.Quaternion().setFromAxisAngle(_up, Math.atan2(ox, oz)), new THREE.Vector3(1, 1, 1));
      falls.push({ geo: ribbonGeo(fw, fh), matrix: m });
      // 구름에 닿는 곳의 물보라
      const yHit = Math.max(CLOUD_Y + 6, info.ys[best] - fh * 0.85);
      const s = Math.max(0, Math.min(1, (info.ys[best] - yHit) / fh));
      const out = fh * 0.16 * Math.sqrt(s);
      addClump(lowPuffs, rnd, px + ox * out, yHit, pz + oz * out, fw * 0.9, 0.6);
    }
  }
  const islands = new THREE.Mesh(B.geometry(), vcMat2());
  islands.name = 'distantIslands';
  let fallsMesh = null;
  if (falls.length) {
    fallsMesh = new THREE.Mesh(mergeIndexed(falls), waterMats().front);
    fallsMesh.name = 'distantFalls';
    fallsMesh.renderOrder = 2;
    falls.forEach((f) => f.geo.dispose());
  }
  return { islands, fallsMesh };
}

/** 새 떼 (작은 V 모양, 천천히 원을 그리며 날기) */
function buildBirds(center, spanX = 700, spanZ = 600) {
  const rnd = seededRandom(31337);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.4, -1.3, 0.3, -0.35, 0, 0, -0.25, 0, 0, 0.4, 0, 0, -0.25, 1.3, 0.3, -0.35], 3));
  g.computeVertexNormals();
  const flocks = [];
  let count = 0;
  for (let f = 0; f < 4; f++) {
    const n = 5 + Math.floor(rnd() * 4);
    flocks.push({
      cx: center.x + (rnd() - 0.5) * spanX,
      cz: center.z + (rnd() - 0.5) * spanZ,
      y: 45 + rnd() * 60,
      R: 70 + rnd() * 130,
      w: (0.05 + rnd() * 0.05) * (rnd() < 0.5 ? -1 : 1),
      ph: rnd() * TAU,
      n,
      first: count,
    });
    count += n;
  }
  const mat = new THREE.MeshBasicMaterial({ color: '#46506e', side: THREE.DoubleSide });
  const im = new THREE.InstancedMesh(g, mat, count);
  im.name = 'birds';
  im.frustumCulled = false;
  const fwd = new THREE.Vector3(), side = new THREE.Vector3();
  const update = (time) => {
    for (const F of flocks) {
      const a = F.ph + time * F.w;
      const lx = F.cx + Math.cos(a) * F.R, lz = F.cz + Math.sin(a) * F.R;
      // 진행 방향 (원의 접선)
      fwd.set(-Math.sin(a) * Math.sign(F.w), 0, Math.cos(a) * Math.sign(F.w));
      side.set(fwd.z, 0, -fwd.x);
      const yaw = Math.atan2(fwd.x, fwd.z);
      for (let j = 0; j < F.n; j++) {
        const row = (j + 1) >> 1, sgn = j & 1 ? 1 : -1;
        const x = lx - fwd.x * row * 4 + side.x * sgn * row * 3.4;
        const z = lz - fwd.z * row * 4 + side.z * sgn * row * 3.4;
        const y = F.y + Math.sin(time * 1.3 + j) * 0.8 - row * 0.5;
        const flap = Math.sin(time * 7 + j * 1.7) * 2.2;
        im.setMatrixAt(F.first + j, _m4.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(1.7, 1.7 * flap, 1.7)));
      }
    }
    im.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh: im, update };
}

/**
 * 구름섬 그랑프리 하늘 전체를 만들고 scene 에 추가.
 * scene.fog / scene.background 를 이 맵용으로 바꿈.
 * 돌려주는 update(time, dt, camPos): 매 프레임 호출 (camPos 를 주면 하늘 돔과 해가 카메라를 따라감)
 * radius = 코스(섬들)가 차지하는 반지름 (먼 섬·먼 구름은 이 바깥에), halfX/halfZ = 낮은 구름을 깔 범위 (코스 크기)
 */
export function createSky(scene, { center = new THREE.Vector3(50, 0, 100), radius = 660, halfX = 620, halfZ = 420 } = {}) {
  const root = new THREE.Group();
  root.name = 'gpSky';
  scene.add(root);
  scene.fog = new THREE.Fog(SKY.horizon, FOG_NEAR, FOG_FAR);
  scene.background = new THREE.Color(SKY.horizon);
  const C = (h) => new THREE.Color(h);

  // 1) 하늘 돔
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: C(SKY.zenith) },
        uMid: { value: C(SKY.mid) },
        uHorizon: { value: C(SKY.horizon) },
        uWarm: { value: C(SKY.warm) },
        uSea: { value: C(SKY.sea) },
        uSeaDeep: { value: C(SKY.seaDeep) },
        uSunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith, uMid, uHorizon, uWarm, uSea, uSeaDeep, uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col;
          if (h >= 0.0) {
            float t = pow(h, 0.55);
            col = mix(uHorizon, uMid, smoothstep(0.0, 0.5, t));
            col = mix(col, uZenith, smoothstep(0.5, 1.0, t));
            // 지평선 바로 위의 따뜻한 띠 (h=0 에서는 정확히 안개 색)
            col = mix(col, uWarm, smoothstep(0.0, 0.02, h) * (1.0 - smoothstep(0.02, 0.16, h)) * 0.55);
          } else {
            float t = -h;
            col = mix(uHorizon, uSea, smoothstep(0.0, 0.05, t));
            col = mix(col, uSeaDeep, smoothstep(0.08, 0.8, t));
          }
          float s = max(dot(d, uSunDir), 0.0);
          col += vec3(1.0, 0.94, 0.8) * (pow(s, 6.0) * 0.16 + pow(s, 60.0) * 0.35);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
  );
  dome.name = 'skyDome';
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.position.copy(center);
  root.add(dome);

  // 2) 해 (원반 + 넓은 빛무리)
  const sunMat = new THREE.SpriteMaterial({ map: sunTexture(), fog: false, depthWrite: false, transparent: true, toneMapped: false });
  const sun = new THREE.Sprite(sunMat);
  sun.scale.setScalar(560);
  const glowMat = new THREE.SpriteMaterial({ map: sunTexture(), fog: false, depthWrite: false, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, color: '#ffe9c4' });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(1500);
  sun.renderOrder = glow.renderOrder = -5;
  root.add(sun, glow);
  const placeSun = (base) => {
    sun.position.copy(base).addScaledVector(SUN_DIR, 1900);
    glow.position.copy(sun.position);
  };
  placeSun(center);

  // 3) 구름 바다 평면 2장 (아래: 불투명, 위: 반투명 · 서로 다른 방향으로 흐름)
  const texA = cloudSeaTexture(101, 0);
  texA.repeat.set(7.5, 7.5);
  const texB = cloudSeaTexture(202, 1);
  texB.repeat.set(4.3, 4.3);
  texB.rotation = 0.6;
  texB.center.set(0.5, 0.5);
  const planeGeo = new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2);
  const seaA = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: texA }));
  seaA.position.set(center.x, CLOUD_Y, center.z);
  seaA.name = 'cloudSeaBase';
  const seaB = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: texB, transparent: true, opacity: 0.9, depthWrite: false }));
  seaB.position.set(center.x, CLOUD_Y + 8, center.z);
  seaB.name = 'cloudSeaTop';
  root.add(seaA, seaB);

  // 4) 뭉게구름: 아래(구름 바다 위로 솟은 덩어리) / 위(천천히 흐르는 구름)
  const rnd = seededRandom(5150);
  const low = [];
  for (let i = 0; i < Math.round(120 * Math.max(1, (halfX * halfZ) / (620 * 420)) ** 0.6); i++) {
    const x = center.x - halfX + rnd() * halfX * 2, z = center.z - halfZ + rnd() * halfZ * 2;
    addClump(low, rnd, x, CLOUD_Y + 4 + rnd() * 22, z, 18 + rnd() * 34, 0.55);
  }
  const far = []; // 먼 구름은 더 거친 퍼프로 (삼각형 절약)
  for (let i = 0; i < 95; i++) {
    const a = rnd() * TAU, d = radius - 40 + Math.pow(rnd(), 0.8) * 2000;
    addClump(far, rnd, center.x + Math.cos(a) * d, CLOUD_Y + 6 + rnd() * 26, center.z + Math.sin(a) * d, 30 + rnd() * 55, 0.55);
  }
  const { islands, fallsMesh } = buildDistantIslands(center, far, radius);
  root.add(islands);
  if (fallsMesh) root.add(fallsMesh);
  const lowMesh = puffMesh(low, 'lowClouds');
  const farMesh = puffMesh(far, 'farClouds', farPuffGeo());
  root.add(lowMesh, farMesh);

  const high = [];
  for (let i = 0; i < 30; i++) {
    const a = rnd() * TAU, d = 220 + Math.pow(rnd(), 0.7) * 1700;
    addClump(high, rnd, Math.cos(a) * d, 85 + rnd() * 115, Math.sin(a) * d, 14 + rnd() * 30, 0.6);
  }
  const highGroup = new THREE.Group();
  highGroup.position.copy(center);
  const highMesh = puffMesh(high, 'highClouds');
  highGroup.add(highMesh);
  root.add(highGroup);

  // 5) 새 떼
  const birds = buildBirds(center, halfX * 1.2, halfZ * 1.2);
  root.add(birds.mesh);

  return {
    group: root,
    update(time = 0, dt = 0, camPos) {
      if (camPos) {
        dome.position.copy(camPos);
        placeSun(camPos);
      }
      texA.offset.set((time * 0.0009) % 1, (time * 0.0004) % 1);
      texB.offset.set((-time * 0.0016) % 1, (time * 0.0011) % 1);
      highGroup.rotation.y = time * 0.0022;
      setWaterTime(time);
      birds.update(time);
    },
  };
}

// ---------------------------------------------------------------- 미리보기
function sampleOutline() {
  // 오목한 강낭콩 + 깊은 만 모양 (약 500m)
  const pts = [];
  const r = seededRandom(9);
  const n = 300;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    let rr = 170 * (1 + 0.22 * Math.cos(2 * a) + 0.08 * Math.sin(3 * a));
    const da = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2));
    rr *= 1 - 0.58 * Math.exp(-((da / 0.42) ** 2));
    rr *= 1 + (r() - 0.5) * 0.02;
    pts.push([50 + Math.cos(a) * rr * 1.35, 100 + Math.sin(a) * rr]);
  }
  return pts;
}
const sampleTop = (x, z) => 6 + 5 * Math.sin(x * 0.012) * Math.cos(z * 0.015);

function sampleIsland(scene, THREE_) {
  const outline = sampleOutline();
  // 윗면(미리보기 전용): ShapeGeometry 로 오목 다각형 채우기
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, sampleTop(p.getX(i), p.getZ(i)) + 0.25);
  g.computeVertexNormals();
  const top = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#6dcf48', side: THREE.DoubleSide }));
  scene.add(top);
  const under = islandUnderside(outline, { topY: sampleTop, depth: 110, seed: 3 });
  scene.add(under);
  const fl = createFlora();
  const r = seededRandom(5);
  for (let i = 0; i < 80; i++) {
    const [x, z] = outline[Math.floor(r() * outline.length)];
    const f = 0.3 + r() * 0.6;
    const px = lerp(50, x, f), pz = lerp(100, z, f);
    fl.add(r() < 0.6 ? 'pine' : 'round', px, sampleTop(px, pz), pz, 1.5 + r(), r() * TAU);
  }
  fl.build(scene);
  return { under, top };
}

export function galleryItems() {
  const center = new THREE.Vector3(50, 0, 100);
  const sd = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize();
  return [
    {
      label: 'sky: horizon toward sun',
      build(scene) {
        const sky = createSky(scene);
        sampleIsland(scene);
        return { pos: [50 - sd.x * 260, 22, 100 - sd.z * 260], look: [50 + sd.x * 1000, 60, 100 + sd.z * 1000], fov: 60, update: sky.update, time: 4 };
      },
    },
    {
      label: 'sky: horizon away from sun',
      build(scene) {
        const sky = createSky(scene);
        return { pos: [50, 15, 100], look: [50 - sd.x * 1000, 40, 100 - sd.z * 1000], fov: 60, update: sky.update, time: 4 };
      },
    },
    {
      label: 'sun + high clouds (camPos follow)',
      build(scene) {
        const sky = createSky(scene);
        const cam = new THREE.Vector3(250, 12, 300);
        return { pos: cam.toArray(), look: cam.clone().addScaledVector(new THREE.Vector3(SUN_DIR.x, SUN_DIR.y * 0.45, SUN_DIR.z).normalize(), 100).toArray(), fov: 70, update: (t, dt) => sky.update(t, dt, cam), time: 6 };
      },
    },
    {
      label: 'cloud sea from y=30',
      build(scene) {
        const sky = createSky(scene);
        return { pos: [50, 30, 100], look: [350, -70, 420], fov: 60, update: sky.update, time: 10 };
      },
    },
    {
      label: 'islandUnderside (concave) side + sky',
      build(scene) {
        const sky = createSky(scene);
        sampleIsland(scene);
        return { pos: [50 + 120, -30, 100 + 620], look: [50, -40, 100], fov: 55, update: sky.update, time: 2 };
      },
    },
    {
      label: 'islandUnderside from below',
      build(scene) {
        sampleIsland(scene);
        return { pos: [50 + 260, -200, 100 + 300], look: [50, -40, 100], fov: 60 };
      },
    },
    {
      label: 'floatingRock r=8 / r=14 / r=5 (no grass)',
      build(scene) {
        const a = floatingRock({ r: 8, seed: 1 }).obj;
        const b = floatingRock({ r: 14, seed: 2 }).obj;
        const c = floatingRock({ r: 5, seed: 3, grass: false }).obj;
        a.position.set(-14, 2, 0);
        b.position.set(16, -4, -10);
        c.position.set(-2, 10, 18);
        scene.add(a, b, c);
        return { pos: [0, 6, 62], look: [0, -4, 0], fov: 50 };
      },
    },
    {
      label: 'waterfall on floatingRock',
      build(scene) {
        const rock = floatingRock({ r: 16, seed: 4 }).obj;
        scene.add(rock);
        const wf = waterfall({ width: 6, height: 45, seed: 1 });
        wf.obj.position.set(0, -0.6, 14.6);
        scene.add(wf.obj);
        return { pos: [45, -5, 60], look: [0, -16, 5], fov: 55, update: (t) => wf.update(t), time: 1.3 };
      },
    },
    {
      label: 'flora: every type',
      build(scene) {
        const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 32).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#6dcf48' }));
        scene.add(ground);
        const fl = createFlora();
        FLORA_TYPES.forEach((t, i) => (i < 3 ? fl.add(t, (i - 1) * 9, 0, -6, 1, i * 0.7) : fl.add(t, (i - 5) * 4.2, 0, 7, 1, i * 0.7)));
        fl.build(scene);
        return { pos: [0, 8, 30], look: [0, 3, 0], fov: 55 };
      },
    },
    {
      label: 'flora field + sky',
      build(scene) {
        const sky = createSky(scene);
        const rock = floatingRock({ r: 45, seed: 8 }).obj;
        scene.add(rock);
        const fl = createFlora();
        const r = seededRandom(77);
        const types = ['pine', 'round', 'blossom', 'bush', 'bush', 'flowers', 'flowers', 'flowers', 'rock', 'mushroom', 'crystal'];
        for (let i = 0; i < 160; i++) {
          const a = r() * TAU, d = Math.sqrt(r()) * 34;
          const t = types[Math.floor(r() * types.length)];
          fl.add(t, Math.cos(a) * d, 2.2 * (1 - (d / 45) ** 2) - 0.2, Math.sin(a) * d, 0.8 + r() * 0.5, r() * TAU);
        }
        fl.build(scene);
        const wf = waterfall({ width: 9, height: 70, seed: 2 });
        wf.obj.position.set(0, -0.8, 42);
        scene.add(wf.obj);
        return {
          pos: [30, 26, 92],
          look: [0, -6, 0],
          fov: 55,
          update: (t, dt) => {
            sky.update(t, dt);
            wf.update(t);
          },
          time: 3,
        };
      },
    },
  ];
}
