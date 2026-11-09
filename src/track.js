// 코스 생성: data/track.json의 중심선으로 도로, 연석, 기믹 구조물, 풍경을 만듭니다.
//
// 구조물 종류 (track.json의 features):
//   boostPad  부스트 패드 (surface: "ceiling"이면 튜브 천장에)
//   ramp      점프대
//   tube      자석 튜브 터널 (바닥-벽-천장이 이어진 통로)
//   wall      자석 벽 (side: -1 왼쪽, 1 오른쪽, 0 양쪽)
//   lava      용암 (닿으면 복귀, 스파이크 폼은 무사)
//   barrier   장애물 블록
//   shortcut  흙길 지름길 (입구에 바리케이드, 중간에 흙 점프대)
//
// data.sea가 있으면 (data/sea.json) 해안선 한쪽이 바다가 됩니다: 물(surface 'water'), 모래사장, 파도 거품,
// 바다 위 물길은 도로 대신 부표. track.inSea(x, z)로 바다인지 알 수 있음
import * as THREE from 'three';
import { buildGrandPrixTrack } from './gpTrack.js';
import { computeRacingLine, edgeFraction } from './racingLine.js';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const SAMPLES = 1200;

// 같은 코스는 항상 같은 풍경이 나오도록 하는 난수 (멀티플레이 때 모두에게 같은 화면이 보여야 함)
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function roadTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3a3d44';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      const v = 50 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v},${v + 5},0.35)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = '#f2f2f2';
    g.fillRect(w * 0.03, 0, w * 0.025, h);
    g.fillRect(w * 0.945, 0, w * 0.025, h);
    g.fillStyle = '#e8c547';
    g.fillRect(w * 0.49, 0, w * 0.02, h * 0.5);
  });
}

// 운동장 트랙: 빨간 우레탄 + 흰 레인 선 8줄
function tartanTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#b8432f';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3500; i++) {
      const r = 160 + Math.random() * 50;
      g.fillStyle = `rgba(${r},${50 + Math.random() * 25},${35 + Math.random() * 20},0.45)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = '#f4f1ea';
    for (let k = 0; k <= 8; k++) g.fillRect(w * (0.02 + (0.96 * k) / 8) - 2, 0, 4, h);
  });
}

export function curbTexture(a = '#d93a3a', b = '#f4f4f4') {
  return canvasTexture(16, 64, (g, w, h) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = b;
    g.fillRect(0, h / 2, w, h / 2);
  });
}

/** 부스트 패드를 만들지 여부 (사용자 요청으로 끔: 기본 가속을 빠르게 하고 부스트류는 모두 없앰) */
export const BOOST_PADS = false;

export function boostTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#0c6bd1';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7fe7ff';
    g.lineWidth = 14;
    g.lineCap = 'round';
    for (const y of [0.2, 0.6]) {
      g.beginPath();
      g.moveTo(w * 0.2, h * (y + 0.25));
      g.lineTo(w * 0.5, h * y);
      g.lineTo(w * 0.8, h * (y + 0.25));
      g.stroke();
    }
  });
}

export function hazardTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d1d1d';
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * 22, 0);
      g.lineTo(i * 22 + 11, 0);
      g.lineTo(i * 22 + 11 + h, h);
      g.lineTo(i * 22 + h, h);
      g.fill();
    }
  });
}

/** 자석 도로: 보라색 바탕에 빛나는 줄무늬 */
function magnetTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#2a1650';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a2070';
    g.fillRect(0, 0, w, h / 2);
    g.strokeStyle = '#b98cff';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#e2c9ff';
    g.fillRect(w * 0.45, h * 0.15, w * 0.1, h * 0.3);
  });
}

function lavaTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#ff5a1f');
    grad.addColorStop(0.5, '#ffb627');
    grad.addColorStop(1, '#ff3d1f');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(120, 20, 0, ${0.25 + Math.random() * 0.3})`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 12, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function checkerTexture() {
  const tex = canvasTexture(64, 16, (g, w, h) => {
    const s = 8;
    for (let x = 0; x < w / s; x++)
      for (let y = 0; y < h / s; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
        g.fillRect(x * s, y * s, s, s);
      }
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** 중심선을 따라 offsetA~offsetB 폭의 평평한 띠 메시 */
function ribbon(samples, offsetA, offsetB, y, vScale, material) {
  return extrude(samples, 0, samples.length - 1, [[offsetA, y], [offsetB, y]], false, material, vScale, Infinity)[0];
}

/**
 * 단면(profile)을 중심선을 따라 밀어서 만든 메시.
 * profile: [[옆 위치, 높이], ...]  closed: 단면이 닫힌 모양(튜브)인지
 * 충돌 계산이 빠르도록 chunk 줄 단위로 나눠 여러 메시로 만듭니다.
 * taper: { anchor: [옆, 높이], length: m } 를 주면 양 끝에서 단면이 anchor 쪽으로 서서히 줄어듭니다.
 */
function extrude(samples, i0, i1, profile, closed, material, vScale = 8, chunk = 16, lift = 0, taper = null) {
  const d0 = samples[i0].dist, d1 = samples[i1].dist;
  const P = profile.length;
  const plen = [0];
  for (let k = 1; k < P; k++) plen.push(plen[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  const total = plen[P - 1] + (closed ? Math.hypot(profile[0][0] - profile[P - 1][0], profile[0][1] - profile[P - 1][1]) : 0);
  const cols = closed ? P + 1 : P;
  const uScale = P === 2 ? total : 4;

  const meshes = [];
  for (let a = i0; a < i1; a += chunk) {
    const b = Math.min(i1, a + chunk);
    const rows = b - a + 1;
    const pos = new Float32Array(rows * cols * 3);
    const uv = new Float32Array(rows * cols * 2);
    const idx = [];
    for (let r = 0; r < rows; r++) {
      const s = samples[a + r];
      let tk = 1;
      if (taper) {
        const e = THREE.MathUtils.clamp(Math.min(s.dist - d0, d1 - s.dist) / taper.length, 0, 1);
        tk = 0.04 + 0.96 * e * e * (3 - 2 * e); // 부드럽게 (smoothstep)
      }
      for (let k = 0; k < cols; k++) {
        let p = profile[k % P];
        if (taper) p = [taper.anchor[0] + (p[0] - taper.anchor[0]) * tk, taper.anchor[1] + (p[1] - taper.anchor[1]) * tk];
        const o = (r * cols + k) * 3;
        pos[o] = s.pos.x + s.right.x * p[0];
        pos[o + 1] = p[1] + lift;
        pos[o + 2] = s.pos.z + s.right.z * p[0];
        uv[(r * cols + k) * 2] = (k === P ? total : plen[k]) / uScale;
        uv[(r * cols + k) * 2 + 1] = s.dist / vScale;
        if (r < rows - 1 && k < cols - 1) {
          const A = r * cols + k, B = A + 1, C = A + cols, D = C + 1;
          idx.push(A, B, C, B, D, C);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}

/** 도로 가장자리에서 둥글게 솟아 수직이 되는 벽 (하프파이프의 한쪽) */
function quarterPipeProfile(side, w, R, H, segs = 10) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / segs);
    pts.push([side * (w / 2 + R * Math.cos(a)), R + R * Math.sin(a)]);
  }
  if (H > R) pts.push([side * (w / 2 + R), H]);
  return side < 0 ? pts.reverse() : pts;
}

/** 바닥-벽-천장이 둥글게 이어진 튜브 단면 (바닥은 도로와 같은 높이) */
function tubeProfile(w, R, H, segs = 8) {
  const hw = w / 2;
  const pts = [[-hw, 0]];
  const arc = (cx, cy, a0, a1, skipLast) => {
    for (let i = 0; i <= segs - (skipLast ? 1 : 0); i++) {
      const a = a0 + (a1 - a0) * (i / segs);
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
  };
  arc(hw, R, -Math.PI / 2, 0); // 오른쪽 아래
  arc(hw, H - R, 0, Math.PI / 2); // 오른쪽 위
  arc(-hw, H - R, Math.PI / 2, Math.PI); // 왼쪽 위
  arc(-hw, R, Math.PI, Math.PI * 1.5, true); // 왼쪽 아래 (시작점과 겹치는 끝점 제외)
  return pts;
}

/** 점프대: 앞쪽이 낮고 뒤쪽이 높은 쐐기 모양 (로컬 z축이 진행 방향) */
export function wedgeGeometry(W, L, H) {
  const a = [-W / 2, 0, 0], b = [W / 2, 0, 0], c = [-W / 2, 0, L], d = [W / 2, 0, L];
  const e = [-W / 2, H, L], f = [W / 2, H, L];
  const tris = [a, e, f, a, f, b, c, d, f, c, f, e, a, c, e, b, f, d];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  const uv = [];
  for (const v of tris) uv.push((v[0] + W / 2) / 4, (v[2] + v[1]) / 4);
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- 바다 (data.sea)
function waveTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#1f74b8');
    grd.addColorStop(0.5, '#2a86c8');
    grd.addColorStop(1, '#1f74b8');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // 물결 (가장자리를 넘어가면 반대쪽에도 그려서 이음새 없이 반복)
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 8 + Math.random() * 22;
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '200,235,255' : '120,190,240'},${0.25 + Math.random() * 0.35})`;
      g.lineWidth = 1.5 + Math.random() * 2;
      for (const ox of [-w, 0, w])
        for (const oy of [-h, 0, h]) {
          g.beginPath();
          g.arc(x + ox, y + oy, r, Math.PI * 1.15, Math.PI * 1.85);
          g.stroke();
        }
    }
  });
}

function sandTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#e7d3a0';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? 'rgba(200,175,120,0.5)' : 'rgba(250,238,205,0.6)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}

/**
 * 바다: 해안선(coast) 한쪽 전체에서 섬(islands)을 뺀 평평한 물 (surface 'water').
 * 해안선 → far 점들 순서로 이어 닫은 다각형이 바다입니다.
 */
function buildSea(data, group, addGround) {
  const S = data.scale;
  const cfg = data.sea;
  const curve = new THREE.CatmullRomCurve3(cfg.coast.map(([x, z]) => new THREE.Vector3(x * S, 0, z * S)), false, 'centripetal');
  const coast = curve.getSpacedPoints(Math.max(8, Math.round(curve.getLength() / 6))).map((p) => [p.x, p.z]);
  const far = (cfg.far || [[1700, 1700], [-1700, 1700]]).map(([x, z]) => [x * S, z * S]);
  const poly = coast.concat(far);
  const islands = (cfg.islands || []).map((i) => ({ ...i, x: i.x * S, z: i.z * S, r: i.r * S }));
  const beach = cfg.beach ?? 14;

  // 다각형 방향 (x, z 평면에서 반시계면 진행 방향 왼쪽이 바다)
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  const seaLeft = area > 0;

  // 점이 다각형 안인가: 위(+z)로 쏜 광선이 변을 몇 번 지나는지. x 띠로 나눠 빠르게
  const BAND = 16;
  const bands = new Map();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xa, za] = poly[j], [xb, zb] = poly[i];
    minX = Math.min(minX, xb), maxX = Math.max(maxX, xb), minZ = Math.min(minZ, zb), maxZ = Math.max(maxZ, zb);
    for (let b = Math.floor(Math.min(xa, xb) / BAND); b <= Math.floor(Math.max(xa, xb) / BAND); b++) {
      if (!bands.has(b)) bands.set(b, []);
      bands.get(b).push([xa, za, xb, zb]);
    }
  }
  function inPoly(x, z) {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
    let c = false;
    for (const [xa, za, xb, zb] of bands.get(Math.floor(x / BAND)) || []) {
      if (xa > x !== xb > x && z < za + ((zb - za) * (x - xa)) / (xb - xa)) c = !c;
    }
    return c;
  }
  const inWater = (x, z) => inPoly(x, z) && islands.every((i) => (x - i.x) ** 2 + (z - i.z) ** 2 > i.r * i.r);
  /** 바다 위인가. pad > 0이면 반지름 pad 안에 바다가 조금이라도 있으면 true */
  function inSea(x, z, pad = 0) {
    if (inWater(x, z)) return true;
    if (pad > 0) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (inWater(x + Math.cos(a) * pad, z + Math.sin(a) * pad)) return true;
      }
    }
    return false;
  }

  // 물 (Shape의 (x, y) → 눕히면 월드 (x, 0, -y))
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const i of islands) {
    const hole = new THREE.Path();
    hole.absarc(i.x, -i.z, i.r, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const waveTex = waveTexture();
  waveTex.repeat.set(1 / 28, 1 / 28); // ShapeGeometry의 UV는 좌표(m) 그대로
  const waveTex2 = waveTex.clone();
  waveTex2.needsUpdate = true;
  const waterMat = new THREE.MeshStandardMaterial({
    color: '#ffffff', map: waveTex, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.86,
  });
  const water = new THREE.Mesh(new THREE.ShapeGeometry(shape, 40), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.045;
  water.receiveShadow = true;
  water.renderOrder = 1;
  water.updateMatrixWorld();
  addGround(water, 'water');
  // 바닷속 바닥 (반투명한 물 너머로 잔디가 비치지 않게)
  const seabed = new THREE.Mesh(water.geometry, new THREE.MeshLambertMaterial({ color: '#17507a', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
  seabed.rotation.x = -Math.PI / 2;
  seabed.position.y = 0.006;
  group.add(seabed);
  // 위에 겹친 두 번째 물결 (반대 방향으로 흘러 반짝임)
  waveTex2.repeat.set(1 / 17, 1 / 17);
  const shimmerMat = new THREE.MeshBasicMaterial({ map: waveTex2, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  const shimmer = new THREE.Mesh(water.geometry, shimmerMat);
  shimmer.rotation.x = -Math.PI / 2;
  shimmer.position.y = 0.05;
  shimmer.renderOrder = 2;
  group.add(shimmer);

  // 해안선 방향: 각 점에서 육지 쪽을 향하는 단위 벡터
  const landN = coast.map((_, i) => {
    const a = coast[Math.max(0, i - 1)], b = coast[Math.min(coast.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return seaLeft ? [dz / l, -dx / l] : [-dz / l, dx / l];
  });
  // 해안선 띠 (offA~offB: + 육지 쪽, - 바다 쪽)
  function coastStrip(offA, offB, y, mat, vScale) {
    const pos = [], uv = [], idx = [];
    let dist = 0;
    coast.forEach(([x, z], i) => {
      if (i) dist += Math.hypot(x - coast[i - 1][0], z - coast[i - 1][1]);
      const [nx, nz] = landN[i];
      pos.push(x + nx * offA, y, z + nz * offA, x + nx * offB, y, z + nz * offB);
      uv.push(0, dist / vScale, 1, dist / vScale);
      if (i) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
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
  }
  // 모래사장 (물 아래까지 조금 이어져 얕은 물처럼 보임). 도로(0.03)보다 아래
  const sandTex = sandTexture();
  sandTex.repeat.set(2, 1);
  const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 });
  coastStrip(-9, beach, 0.012, sandMat, 10);
  // 파도 거품 (물가를 따라 하얀 띠가 숨쉬듯)
  const foamTex = canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0.15)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.clearRect(0, 0, w, h * 0.12);
  });
  const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, opacity: 0.8 });
  const foam = coastStrip(-3.2, 0.4, 0.055, foamMat, 5);
  foam.renderOrder = 3;
  // 섬 둘레 모래
  const islandSand = [];
  for (const i of islands) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(1, i.r - 7), i.r + 9, 56), sandMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(i.x, 0.012, i.z);
    ring.receiveShadow = true;
    group.add(ring);
    const f = new THREE.Mesh(new THREE.RingGeometry(i.r - 0.4, i.r + 3, 56), foamMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(i.x, 0.055, i.z);
    f.renderOrder = 3;
    group.add(f);
    islandSand.push(ring);
  }

  function animate(time) {
    waveTex.offset.set(time * 0.012, time * 0.02);
    waveTex2.offset.set(-time * 0.017, time * 0.009);
    foamMat.opacity = 0.55 + Math.sin(time * 1.3) * 0.25;
  }

  return { data: cfg, coast, landNormals: landN, islands, beach, inSea, water, animate };
}

export function buildTrack(data, scene) {
  if (data.style === 'grandprix') return buildGrandPrixTrack(data, scene); // 구름섬 그랑프리: 높이가 있는 코스 (gpTrack.js)
  const width = data.width;
  const points = data.points.map(([x, z]) => new THREE.Vector3(x * data.scale, 0, z * data.scale));
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  const length = curve.getLength();

  // 일정 간격 샘플 (마지막 = 처음, 텍스처 이음새용)
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pos = curve.getPointAt(t % 1);
    const tan = curve.getTangentAt(t % 1).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
    samples.push({ t, pos, tan, right, dist: t * length });
  }
  const sampleAt = (t) => samples[Math.round((((t % 1) + 1) % 1) * SAMPLES)];
  const indexAt = (t) => Math.round(t * SAMPLES);
  /** 중심선까지의 수평 거리 */
  const nearestRaw = (p) => {
    let best = Infinity;
    for (let i = 0; i < SAMPLES; i += 2) {
      const q = samples[i].pos;
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  const group = new THREE.Group();
  scene.add(group);

  // 차가 밟을 수 있는 면들 (userData.surface로 종류 구분)
  const groundMeshes = [];
  const addGround = (mesh, surface) => {
    mesh.userData.surface = surface;
    groundMeshes.push(mesh);
    group.add(mesh);
  };

  // 잔디 바닥
  const grassTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#5c9e45';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(80,140,60,0.5)' : 'rgba(110,170,80,0.5)';
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
  });
  grassTex.repeat.set(300, 300);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  addGround(grass, 'ground'); // 도로와 잔디는 같은 높이. 중심선과의 거리로 구분

  // 바다 (바닷가 코스). 바다가 없는 맵에서는 inSea가 항상 false
  const sea = data.sea ? buildSea(data, group, addGround) : null;
  const inSea = sea ? sea.inSea : () => false;
  // 중심선이 바다 위인 샘플 → 물길 구간 (t 범위)
  const wet = samples.slice(0, SAMPLES).map((s) => inSea(s.pos.x, s.pos.z));
  /** 조건을 만족하는 샘플이 이어지는 구간 [시작, 끝] (끝은 다음 샘플까지 포함, 0을 넘어 감길 수 있음) */
  function runsOf(flags) {
    if (flags.every(Boolean)) return [[0, SAMPLES]];
    const out = [];
    const off = flags.findIndex((f) => !f);
    let a = -1;
    for (let k = 1; k <= SAMPLES; k++) {
      const i = off + k, f = flags[i % SAMPLES];
      if (f && a < 0) a = i;
      if (!f && a >= 0) out.push([a, i]), (a = -1);
    }
    return out;
  }
  /** 샘플 i0~i1 (SAMPLES를 넘으면 처음으로 감김, 거리는 계속 늘어남) */
  const span = (i0, i1) => {
    const out = [];
    for (let i = i0; i <= i1; i++) out.push(i < SAMPLES ? samples[i] : { ...samples[i - SAMPLES], dist: samples[i - SAMPLES].dist + length });
    return out;
  };
  const waterRuns = sea ? runsOf(wet) : [];
  const waterRanges = waterRuns.map(([a, b]) => ({ t0: (a % SAMPLES) / SAMPLES, t1: (b % SAMPLES) / SAMPLES, length: ((b - a) / SAMPLES) * length }));
  /** 코스 위치 t의 중심선이 바다 위인가 */
  const isWaterT = (t) => !!sea && wet[Math.round((((t % 1) + 1) % 1) * SAMPLES) % SAMPLES];

  // 도로와 연석 (보이기만 하는 메시). 바다 위는 도로 대신 부표로 물길 표시 (도로는 물속으로 6m쯤 이어져 선착장처럼)
  const stadium = data.style === 'stadium';
  const roadMat = new THREE.MeshStandardMaterial({ map: stadium ? tartanTexture() : roadTexture(), roughness: 0.9 });
  const curbMat = new THREE.MeshStandardMaterial({ map: stadium ? curbTexture('#f4f4f4', '#2e6fd8') : curbTexture(), roughness: 0.8 });
  const slip = 3; // 물속으로 이어지는 샘플 수 (약 6m)
  const roadFlags = wet.map((_, i) => {
    for (let k = -slip; k <= slip; k++) if (!wet[(i + k + SAMPLES) % SAMPLES]) return true;
    return false;
  });
  for (const [a, b] of runsOf(roadFlags)) {
    const part = a === 0 && b === SAMPLES ? samples : span(a, b);
    group.add(ribbon(part, -width / 2, width / 2, 0.03, 12, roadMat));
  }
  for (const [a, b] of runsOf(wet.map((w) => !w))) {
    const part = a === 0 && b === SAMPLES ? samples : span(a, b);
    group.add(ribbon(part, -width / 2 - 1.6, -width / 2, 0.04, 4, curbMat));
    group.add(ribbon(part, width / 2, width / 2 + 1.6, 0.04, 4, curbMat));
  }

  // 물길 부표 (양쪽 가장자리 약 25m마다, 둥실둥실. 충돌 없음)
  const buoys = [];
  for (const [a, b] of waterRuns) {
    const step = Math.max(1, Math.round((25 / length) * SAMPLES));
    for (let i = a; i <= b; i += step) {
      const s = samples[i % SAMPLES];
      if (!wet[i % SAMPLES]) continue;
      for (const side of [-1, 1]) {
        const x = s.pos.x + s.right.x * side * (width / 2 + 1.5), z = s.pos.z + s.right.z * side * (width / 2 + 1.5);
        if (!inSea(x, z, 1.5)) continue;
        buoys.push({ x, z, red: (Math.round((i - a) / step) + (side > 0 ? 1 : 0)) % 2 === 0, phase: buoys.length * 1.37 });
      }
    }
  }
  let buoyBody = null, buoyTop = null;
  if (buoys.length) {
    const bodyGeo = new THREE.CylinderGeometry(0.5, 0.75, 1.4, 10).translate(0, 0.25, 0);
    const topGeo = new THREE.ConeGeometry(0.32, 0.8, 8).translate(0, 1.35, 0);
    buoyBody = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }), buoys.length);
    buoyTop = new THREE.InstancedMesh(topGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.15 }), buoys.length);
    buoys.forEach((b, i) => {
      buoyBody.setColorAt(i, new THREE.Color(b.red ? '#ff4a1c' : '#f6f6f6'));
      buoyTop.setColorAt(i, new THREE.Color(b.red ? '#f6f6f6' : '#ff7a1c'));
    });
    buoyBody.castShadow = buoyTop.castShadow = true;
    group.add(buoyBody, buoyTop);
  }
  const bm4 = new THREE.Matrix4(), bq = new THREE.Quaternion(), be = new THREE.Euler(), bp = new THREE.Vector3(), bs = new THREE.Vector3(1, 1, 1);
  function animateBuoys(time) {
    if (!buoyBody) return;
    buoys.forEach((b, i) => {
      bq.setFromEuler(be.set(Math.sin(time * 1.1 + b.phase) * 0.1, 0, Math.cos(time * 0.9 + b.phase) * 0.1));
      bm4.compose(bp.set(b.x, Math.sin(time * 1.6 + b.phase) * 0.15, b.z), bq, bs);
      buoyBody.setMatrixAt(i, bm4);
      buoyTop.setMatrixAt(i, bm4);
    });
    buoyBody.instanceMatrix.needsUpdate = buoyTop.instanceMatrix.needsUpdate = true;
  }
  animateBuoys(0);

  // 출발선과 게이트
  const s0 = samples[0];
  const startYaw = Math.atan2(s0.tan.x, s0.tan.z);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(width, 2.4), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 }));
  line.material.map.repeat.set(width / 4, 1);
  line.rotation.set(-Math.PI / 2, 0, startYaw, 'YXZ');
  line.position.copy(s0.pos).setY(0.05);
  group.add(line);

  // 운동장: 출발선 앞 레인 번호 1~8
  if (stadium) {
    const numTex = canvasTexture(1024, 96, (g, w, h) => {
      g.fillStyle = '#f4f1ea';
      g.font = 'bold 70px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let k = 0; k < 8; k++) g.fillText(String(8 - k), w * (0.02 + (0.96 * (k + 0.5)) / 8), h / 2);
    });
    const nums = new THREE.Mesh(new THREE.PlaneGeometry(width, 3), new THREE.MeshBasicMaterial({ map: numTex, transparent: true }));
    nums.rotation.set(-Math.PI / 2, 0, startYaw + Math.PI, 'YXZ'); // 다가오는 차 쪽에서 바로 읽히게
    nums.position.copy(s0.pos).addScaledVector(s0.tan, 4).setY(0.05);
    group.add(nums);
  }

  const gate = new THREE.Group();
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#2b2f3a' });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), pillarMat);
    p.position.set(side * (width / 2 + 2.4), 4.5, 0);
    p.castShadow = true;
    gate.add(p);
  }
  const bannerTex = canvasTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#e8463a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('START / FINISH', w / 2, h / 2 + 2);
  });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(width + 6, 2.2, 0.6), new THREE.MeshStandardMaterial({ map: bannerTex }));
  banner.position.y = 8.4;
  banner.castShadow = true;
  gate.add(banner);
  gate.position.copy(s0.pos);
  gate.rotation.y = startYaw;
  group.add(gate);

  // --- 기믹 구조물 ---
  const boostPads = [];
  const boostMat = new THREE.MeshBasicMaterial({ map: boostTexture(), transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  const hazardTex = hazardTexture();
  hazardTex.repeat.set(3, 3);
  const rampMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6, side: THREE.DoubleSide });
  const barrierMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.6 });
  const magTex = magnetTexture();
  const magnetMat = new THREE.MeshStandardMaterial({
    map: magTex, emissive: '#7a3cff', emissiveMap: magTex, emissiveIntensity: 0.55, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide,
  });
  const lavaTex = lavaTexture();
  lavaTex.repeat.set(2, 1);
  const lavaMat = new THREE.MeshBasicMaterial({ map: lavaTex });

  function addBoostPad(s, f) {
    if (!BOOST_PADS) return;
    const w = 6, l = 8;
    let normal, center;
    if (f.surface === 'ceiling') {
      normal = DOWN;
      center = s.pos.clone().addScaledVector(s.right, f.offset || 0).setY((f.height || 14) + 0.03 - 0.06);
    } else if (f.surface === 'wall') {
      // 자석 벽의 수직 부분 (side: -1 왼쪽, 1 오른쪽)
      normal = s.right.clone().multiplyScalar(-f.side);
      center = s.pos.clone().addScaledVector(s.right, f.side * (width / 2 + (f.radius || 6))).setY(f.height + 0.03);
      center.addScaledVector(normal, 0.08);
    } else {
      normal = UP;
      center = s.pos.clone().addScaledVector(s.right, f.offset || 0).setY(0.06);
    }
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, l), boostMat);
    const x = new THREE.Vector3().crossVectors(s.tan, normal);
    pad.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, s.tan, normal));
    pad.position.copy(center);
    group.add(pad);
    boostPads.push({ center, fwd: s.tan.clone(), right: s.right.clone(), normal: normal.clone(), halfW: w / 2, halfL: l / 2, duration: f.boost || 1.2 });
  }

  for (const f of data.features) {
    if (f.x !== undefined) continue; // 월드 좌표 구조물은 아래에서 (테스트 맵)
    if (f.type === 'boostPad') {
      addBoostPad(sampleAt(f.t), f);
    } else if (f.type === 'ramp') {
      const s = sampleAt(f.t);
      const ramp = new THREE.Mesh(wedgeGeometry(f.width || width * 0.7, f.length, f.height), rampMat);
      ramp.position.copy(s.pos).addScaledVector(s.right, f.offset || 0).setY(0.03);
      ramp.rotation.y = Math.atan2(s.tan.x, s.tan.z);
      ramp.castShadow = ramp.receiveShadow = true;
      ramp.updateMatrixWorld();
      addGround(ramp, 'ramp');
    } else if (f.type === 'tube') {
      const prof = tubeProfile(width, f.radius || 6, f.height || 14);
      for (const m of extrude(samples, indexAt(f.t0), indexAt(f.t1), prof, true, magnetMat, 8, 16, 0.03)) addGround(m, 'magnet');
    } else if (f.type === 'wall') {
      for (const side of f.side === 0 ? [-1, 1] : [f.side]) {
        const prof = quarterPipeProfile(side, width, f.radius || 6, f.height || 12);
        const taper = { anchor: [side * width / 2, 0], length: f.taper ?? 18 };
        for (const m of extrude(samples, indexAt(f.t0), indexAt(f.t1), prof, false, magnetMat, 8, 16, 0.03, taper)) {
          m.castShadow = true;
          addGround(m, 'magnet');
        }
      }
    } else if (f.type === 'lava') {
      const part = samples.slice(indexAt(f.t0), indexAt(f.t1) + 1);
      addGround(ribbon(part, -width / 2, width / 2, 0.05, 20, lavaMat), 'lava');
    } else if (f.type === 'barrier') {
      const s = sampleAt(f.t);
      const box = new THREE.Mesh(new THREE.BoxGeometry(f.width || 8, f.height || 1.6, 2), barrierMat);
      box.position.copy(s.pos).addScaledVector(s.right, f.offset || 0).setY((f.height || 1.6) / 2);
      box.rotation.y = Math.atan2(s.tan.x, s.tan.z);
      box.castShadow = box.receiveShadow = true;
      box.updateMatrixWorld();
      addGround(box, 'barrier');
    }
  }

  // --- 테스트 맵: 시험장 바닥 + 월드 좌표(x, z)로 놓는 구조물 ---
  //   yaw는 도(°) 단위, 0 = +z(북쪽), 90 = +x(동쪽). 직선 구조물은 (x, z)에서 yaw 방향으로 length만큼 뻗음
  const deg = (d) => (d * Math.PI) / 180;
  const dirOf = (yawDeg) => new THREE.Vector3(Math.sin(deg(yawDeg)), 0, Math.cos(deg(yawDeg)));
  function lineSamples(f) {
    const tan = dirOf(f.yaw || 0);
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
    const n = Math.max(2, Math.ceil(f.length));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const d = (i / n) * f.length;
      out.push({ pos: new THREE.Vector3(f.x, 0, f.z).addScaledVector(tan, d), tan, right, dist: d });
    }
    return out;
  }
  /** 원호 샘플 (중심 x, z, 반지름 r, arc: [시작각, 끝각] 도). right는 원의 안쪽을 향함 */
  function arcSamples(f) {
    const [a0, a1] = f.arc.map(deg);
    const n = Math.ceil((Math.abs(a1 - a0) * f.r) / 1.5);
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const pos = new THREE.Vector3(f.x + Math.cos(a) * f.r, 0, f.z + Math.sin(a) * f.r);
      const tan = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
      out.push({ pos, tan, right, dist: Math.abs(a - a0) * f.r });
    }
    return out;
  }
  const concreteMat = new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.8 });
  for (const f of data.features) {
    if (f.x === undefined) continue;
    const yaw = deg(f.yaw || 0);
    const tan = dirOf(f.yaw || 0);
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
    const here = { pos: new THREE.Vector3(f.x, 0, f.z), tan, right };
    if (f.type === 'boostPad') {
      addBoostPad(here, f);
    } else if (f.type === 'ramp') {
      const ramp = new THREE.Mesh(wedgeGeometry(f.width || 8, f.length, f.height), rampMat);
      ramp.position.set(f.x, 0.03, f.z);
      ramp.rotation.y = yaw;
      ramp.castShadow = ramp.receiveShadow = true;
      ramp.updateMatrixWorld();
      addGround(ramp, 'ramp');
    } else if (f.type === 'tube') {
      const ss = lineSamples(f);
      const prof = tubeProfile(f.width || 18, f.radius || 6, f.height || 14);
      for (const m of extrude(ss, 0, ss.length - 1, prof, true, magnetMat, 8, 16, 0.03)) {
        m.castShadow = true;
        addGround(m, 'magnet');
      }
    } else if (f.type === 'wall') {
      const ss = lineSamples(f);
      const w = f.width || 18;
      for (const side of f.side === 0 ? [-1, 1] : [f.side]) {
        const prof = quarterPipeProfile(side, w, f.radius || 6, f.height || 12);
        const taper = { anchor: [(side * w) / 2, 0], length: f.taper ?? 14 };
        for (const m of extrude(ss, 0, ss.length - 1, prof, false, magnetMat, 8, 16, 0.03, taper)) {
          m.castShadow = true;
          addGround(m, 'magnet');
        }
      }
    } else if (f.type === 'bowl') {
      // 둥근 경기장: 원 둘레를 따라 바깥으로 솟는 자석 벽 (arc 빈 곳이 입구)
      const ss = arcSamples(f);
      const prof = quarterPipeProfile(-1, 0, f.radius || 8, f.height || 14);
      const taper = { anchor: [0, 0], length: f.taper ?? 14 };
      for (const m of extrude(ss, 0, ss.length - 1, prof, false, magnetMat, 8, 16, 0.03, taper)) {
        m.castShadow = true;
        addGround(m, 'magnet');
      }
    } else if (f.type === 'lava') {
      const w = f.width || 18;
      addGround(ribbon(lineSamples(f), -w / 2, w / 2, 0.05, 20, lavaMat), 'lava');
    } else if (f.type === 'barrier') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(f.width || 8, f.height || 1.6, f.depth || 2), f.concrete ? concreteMat : barrierMat);
      box.position.set(f.x, (f.height || 1.6) / 2, f.z);
      box.rotation.y = yaw;
      box.castShadow = box.receiveShadow = true;
      box.updateMatrixWorld();
      addGround(box, 'barrier');
    }
  }
  // 시험장 바닥 (콘크리트 + 20m 격자). 이 안은 어디든 도로로 취급
  const pad = data.pad || null;
  if (pad) {
    const w = pad.x1 - pad.x0, d = pad.z1 - pad.z0;
    const padTex = canvasTexture(256, 256, (g, cw, ch) => {
      g.fillStyle = '#8f949c';
      g.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 3000; i++) {
        const v = 120 + Math.random() * 40;
        g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
        g.fillRect(Math.random() * cw, Math.random() * ch, 2, 2);
      }
      g.fillStyle = 'rgba(60,62,68,0.55)'; // 판 이음매
      g.fillRect(0, 0, cw, 3);
      g.fillRect(0, 0, 3, ch);
      g.fillStyle = 'rgba(255,255,255,0.5)'; // 격자 가운데 십자 표시
      g.fillRect(cw / 2 - 14, ch / 2 - 2, 28, 4);
      g.fillRect(cw / 2 - 2, ch / 2 - 14, 4, 28);
    });
    padTex.repeat.set(w / 20, d / 20);
    const padMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.95 }));
    padMesh.rotation.x = -Math.PI / 2;
    padMesh.position.set((pad.x0 + pad.x1) / 2, 0.02, (pad.z0 + pad.z1) / 2);
    padMesh.receiveShadow = true;
    group.add(padMesh);
    // 가장자리 노란 선
    const edgeMat = new THREE.MeshBasicMaterial({ color: '#f2c230' });
    for (const [ex, ez, ew, ed] of [[0, pad.z0, w, 0.6], [0, pad.z1, w, 0.6], [pad.x0, 0, 0.6, d], [pad.x1, 0, 0.6, d]]) {
      const e = new THREE.Mesh(new THREE.PlaneGeometry(ew, ed), edgeMat);
      e.rotation.x = -Math.PI / 2;
      e.position.set(ew === w ? (pad.x0 + pad.x1) / 2 : ex, 0.025, ed === d ? (pad.z0 + pad.z1) / 2 : ez);
      group.add(e);
    }
  }
  const inPad = (x, z, margin = 0) => !!pad && x > pad.x0 - margin && x < pad.x1 + margin && z > pad.z0 - margin && z < pad.z1 + margin;
  const spawn = data.spawn ? { x: data.spawn.x, z: data.spawn.z, yaw: deg(data.spawn.yaw || 0) } : null;

  // --- 흙길 지름길 (풍경과 나무는 scenery.js에서) ---
  let shortcut = null;
  const sc = data.features.find((f) => f.type === 'shortcut');
  if (sc) {
    const a = sampleAt(sc.t0), b = sampleAt(sc.t1);
    const P0 = a.pos.clone().addScaledVector(a.right, 3);
    const P3 = b.pos.clone().addScaledVector(b.right, 3);
    const P1 = a.pos.clone().addScaledVector(a.tan, sc.bend || 50).addScaledVector(a.right, sc.pull || 28);
    const P2 = b.pos.clone().addScaledVector(b.tan, -(sc.bend || 50)).addScaledVector(b.right, sc.pull || 28);
    const bez = new THREE.CubicBezierCurve3(P0, P1, P2, P3);
    const len = bez.getLength();
    const n = Math.ceil(len);
    const scSamples = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const pos = bez.getPointAt(u).setY(0);
      const tan = bez.getTangentAt(u).setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
      scSamples.push({ pos, tan, right, dist: u * len });
    }
    const dirtTex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#a07a4f';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const v = Math.random();
        g.fillStyle = v < 0.5 ? 'rgba(120,88,55,0.6)' : 'rgba(190,150,105,0.5)';
        g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
      g.fillStyle = 'rgba(90,65,40,0.55)'; // 바퀴 자국
      g.fillRect(w * 0.25, 0, w * 0.08, h);
      g.fillRect(w * 0.67, 0, w * 0.08, h);
    });
    const dirtMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 });
    group.add(ribbon(scSamples, -sc.width / 2, sc.width / 2, 0.025, 10, dirtMat));
    // 바리케이드 위치: 본 도로에서 충분히 벗어난 첫 지점 + 6m
    let gi = scSamples.findIndex((p) => nearestRaw(p.pos) > width / 2 + sc.width / 2 + 2);
    gi = Math.min(scSamples.length - 1, Math.max(0, gi) + 6);
    shortcut = { samples: scSamples, width: sc.width, length: len, gate: scSamples[gi], data: sc };
    // 지름길 중간의 흙 점프대
    if (sc.ramp) {
      const rs = scSamples[Math.round(sc.ramp * n)];
      const ramp = new THREE.Mesh(wedgeGeometry(sc.width * 0.8, 10, 1.8), rampMat);
      ramp.position.copy(rs.pos).setY(0.03);
      ramp.rotation.y = Math.atan2(rs.tan.x, rs.tan.z);
      ramp.castShadow = ramp.receiveShadow = true;
      ramp.updateMatrixWorld();
      addGround(ramp, 'ramp');
    }
  }

  // 첫 화면을 그리기 전에도 충돌 계산이 맞도록 위치 행렬을 미리 갱신
  group.updateMatrixWorld(true);

  /** 위치에서 가장 가까운 코스 지점 (위에서 내려다본 거리 기준) */
  function nearest(pos) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const p = samples[i].pos;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    const s = samples[bi];
    const lateral = (pos.x - s.pos.x) * s.right.x + (pos.z - s.pos.z) * s.right.z;
    return { index: bi, t: bi / SAMPLES, sample: s, dist: Math.sqrt(best), lateral };
  }

  // 광선 충돌: 부딪힌 지점, 매끄러운 면 방향(광선 반대쪽을 향함), 면 종류
  const raycaster = new THREE.Raycaster();
  const tri = new THREE.Triangle();
  const bary = new THREE.Vector3();
  const local = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  function castRay(origin, dir, far) {
    raycaster.set(origin, dir);
    raycaster.near = 0;
    raycaster.far = far;
    for (const hit of raycaster.intersectObjects(groundMeshes, false)) {
      if (hit.distance < 1e-4) continue;
      const obj = hit.object;
      const { a, b, c } = hit.face;
      const nAttr = obj.geometry.attributes.normal;
      local.copy(hit.point);
      obj.worldToLocal(local);
      tri.setFromAttributeAndIndices(obj.geometry.attributes.position, a, b, c);
      tri.getBarycoord(local, bary);
      const n = new THREE.Vector3().fromBufferAttribute(nAttr, a).multiplyScalar(bary.x);
      n.add(tmp.fromBufferAttribute(nAttr, b).multiplyScalar(bary.y));
      n.add(tmp.fromBufferAttribute(nAttr, c).multiplyScalar(bary.z));
      if (n.lengthSq() < 1e-8) n.copy(hit.face.normal);
      normalMatrix.getNormalMatrix(obj.matrixWorld);
      n.applyMatrix3(normalMatrix).normalize();
      if (n.dot(dir) > 0) n.negate();
      return { point: hit.point, normal: n, surface: obj.userData.surface, distance: hit.distance };
    }
    return null;
  }

  /** 밟고 있는 부스트 패드 (바닥, 벽, 천장 모두). 없으면 null */
  function boostPadAt(pos) {
    for (const p of boostPads) {
      tmp.subVectors(pos, p.center);
      if (Math.abs(tmp.dot(p.normal)) < 1.2 && Math.abs(tmp.dot(p.fwd)) < p.halfL && Math.abs(tmp.dot(p.right)) < p.halfW) return p;
    }
    return null;
  }

  /** 움직이는 텍스처 (부스트 화살표, 용암, 자석 도로 빛) */
  function animate(time) {
    boostMat.map.offset.y = -time * 1.5;
    lavaTex.offset.set(time * 0.03, time * 0.08);
    magnetMat.emissiveIntensity = 0.45 + Math.sin(time * 3) * 0.15;
    if (sea) {
      sea.animate(time);
      animateBuoys(time);
    }
  }

  /** 지름길 중심선까지의 거리 (지름길이 없으면 Infinity) */
  function shortcutDist(pos) {
    if (!shortcut) return Infinity;
    let best = Infinity;
    for (let i = 0; i < shortcut.samples.length; i += 2) {
      const q = shortcut.samples[i].pos;
      const d = (q.x - pos.x) ** 2 + (q.z - pos.z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  const onShortcut = (pos) => shortcutDist(pos) < (shortcut ? shortcut.width / 2 + 1 : 0);
  /** 도로 위인가 (본 도로 + 연석, 또는 지름길) */
  function isOnRoad(pos, near = nearest(pos)) {
    return near.dist < width / 2 + 1.6 || onShortcut(pos) || inPad(pos.x, pos.z);
  }
  /** 차가 연석·잔디에 얼마나 걸쳤는지 (car.js가 접지력·속도를 부드럽게 바꾸는 데 씀) */
  function edgeInfo(pos, near = nearest(pos)) {
    if (onShortcut(pos) || inPad(pos.x, pos.z)) return { kerb: 0, off: 0, runoff: false };
    return { ...edgeFraction(near.dist, width / 2, width / 2 + 1.6), runoff: false };
  }
  // 레이싱 라인 (자유 주행장은 없음)
  //   직선: 차 중심이 흰 선에서 1 m 안쪽 (연석을 밟지 않음)
  //   코너 에이펙스 안쪽·탈출 바깥쪽: 연석에 바퀴가 올라탈 만큼 (도로 끝 + 0.45 m)까지
  let racingLine = null;
  if (!pad) {
    const lineSamples = samples.slice(0, SAMPLES);
    const use = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)]; // [왼쪽, 오른쪽] 0~1
    const W = (i) => ((i % SAMPLES) + SAMPLES) % SAMPLES;
    // 장애물 때문에 라인이 꼭 지나야 하는 범위 (중심에서 옆 거리, + 오른쪽)
    const forceLo = new Float32Array(SAMPLES).fill(-1e9), forceHi = new Float32Array(SAMPLES).fill(1e9);
    const limit = (i, side) => {
      const q = W(i), base = width / 2 - 1.0 + use[side < 0 ? 0 : 1][q] * 1.45;
      return side < 0 ? Math.min(base, -forceLo[q]) : Math.min(base, forceHi[q]);
    };
    const mS = (m) => Math.max(1, Math.round((m / length) * SAMPLES));
    const tFeat = data.features.filter((f) => f && f.t !== undefined && f.x === undefined);
    const applyObstacles = (line) => {
      forceLo.fill(-1e9);
      forceHi.fill(1e9);
      for (const f of tFeat) {
        const c = indexAt(f.t), o = f.offset || 0;
        if (f.type === 'barrier') {
          // 장애물 블록 옆으로 비켜 감 (차 반폭 1 m + 여유)
          const hw = (f.width || 8) / 2 + 1.6;
          const roomL = o - hw + width / 2, roomR = width / 2 - (o + hw);
          const goRight = Math.abs(roomL - roomR) > 0.5 ? roomR > roomL : (line ? line.offset[W(c)] >= o : true);
          for (let i = c - mS(9); i <= c + mS(9); i++) {
            const q = W(i);
            if (goRight) forceLo[q] = Math.max(forceLo[q], o + hw);
            else forceHi[q] = Math.min(forceHi[q], o - hw);
          }
        } else if (f.type === 'ramp') {
          // 바로 뒤에 용암이 있으면 점프대 가운데로 똑바로
          const lava = data.features.find((g) => g && g.type === 'lava' && g.x === undefined && g.t0 > f.t && (g.t0 - f.t) * length < 150);
          if (!lava) continue;
          const half = Math.max(0.4, (f.width || width * 0.7) / 2 - 2.2);
          for (let i = c - mS(26); i <= indexAt(lava.t1); i++) {
            const q = W(i);
            forceLo[q] = Math.max(forceLo[q], o - half);
            forceHi[q] = Math.min(forceHi[q], o + half);
          }
        }
      }
    };
    const ramp01 = (x, r) => Math.min(1, Math.max(0, x / r)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, x / r)));
    const widen = (i0, i1, side, r) => {
      for (let i = i0; i <= i1; i++) {
        const a = use[side < 0 ? 0 : 1], q = W(i);
        a[q] = Math.max(a[q], ramp01(i - i0, r) * ramp01(i1 - i, r));
      }
    };
    applyObstacles(null);
    racingLine = computeRacingLine(lineSamples, limit, length);
    applyObstacles(racingLine);
    for (let pass = 0; pass < 2; pass++) {
      for (const ap of racingLine.apexes) {
        if (ap.radius > 150) continue;
        widen(ap.i - mS(30), ap.i + mS(22), ap.side, mS(10));
        widen(ap.i + mS(12), ap.i + mS(62), -ap.side, mS(14));
      }
      racingLine = computeRacingLine(lineSamples, limit, length);
    }
  }
  /** 레이싱 라인 위 지점 i의 높이 (평평한 코스라 0) */
  const lineY = () => 0;

  const outline = samples.filter((_, i) => i % 6 === 0).map((s) => [s.pos.x, s.pos.z]);

  return {
    data, width, length, samples, sampleAt, nearest, nearestRaw, castRay, boostPadAt, animate, outline,
    shortcut, shortcutDist, onShortcut, isOnRoad, edgeInfo, racingLine, lineY, kerbWidth: 1.6, group, groundMeshes,
    arena: !!pad, pad, inPad, spawn,
    // 바다 (바닷가 코스만. 없으면 sea = null, inSea는 항상 false, waterRanges = [])
    sea, inSea, waterRanges, isWaterT, buoys,
  };
}
