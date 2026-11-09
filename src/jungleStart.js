// 정글 유적 출발 구역 전용 모델: 사원식 출발 게이트(F1 빨간불 5개) + 돌 계단 관중석(초가 지붕, 응원하는 관중)
//   - templeGantry({ width }) → { obj, legX, height, setLights(n), setGreen(b), update(time) }
//     0번 전구 = 로컬 +x = 운전자 왼쪽 (게이트를 도로 방향으로 돌려 놓으면 왼쪽부터 켜짐, gpAssets와 같은 약속)
//   - templeStand({ length, accent }) → { obj, halfDepth, height, update(time, dt, excite) }
//     로컬 x = 0 이 도로 쪽 앞면(-x 를 바라봄), +x 로 약 14 m 깊이, z = 길이 방향 (gpAssets.grandstand와 같은 배치)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, stoneTexture, glowTexture, seededRandom, TAU } from './jungleUtil.js';

// ---------------------------------------------------------------- 공용 재질 (한 번만 만듦)
let M = null;
function mats() {
  if (M) return M;
  const stone = stoneTexture('#a39a82', true);
  stone.repeat.set(0.35, 0.35);
  const stoneD = stoneTexture('#837a66', true);
  stoneD.repeat.set(0.4, 0.4);
  M = {
    stone: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 }),
    stoneDark: new THREE.MeshStandardMaterial({ map: stoneD, roughness: 0.95 }),
    glyph: new THREE.MeshStandardMaterial({ map: glyphTexture(), roughness: 0.92 }),
    gold: new THREE.MeshStandardMaterial({ color: '#e6b84a', metalness: 0.8, roughness: 0.3, emissive: '#5a3a00', emissiveIntensity: 0.45 }),
    jade: new THREE.MeshStandardMaterial({ color: '#2fb08a', metalness: 0.2, roughness: 0.4, emissive: '#0a4a36', emissiveIntensity: 0.5 }),
    moss: new THREE.MeshLambertMaterial({ color: '#4c7a30', flatShading: true }),
    vine: new THREE.MeshLambertMaterial({ color: '#2f6a24', side: THREE.DoubleSide }),
    wood: new THREE.MeshStandardMaterial({ color: '#6b4528', roughness: 0.9 }),
    thatch: new THREE.MeshStandardMaterial({ map: thatchTexture(), roughness: 1, side: THREE.DoubleSide }),
    panel: new THREE.MeshStandardMaterial({ color: '#1f1c18', roughness: 0.8 }),
    checker: new THREE.MeshLambertMaterial({ map: checkerStrip() }),
    fire: new THREE.SpriteMaterial({ map: glowTexture('rgba(255,240,180,1)', 'rgba(255,120,30,0.5)'), color: '#ffb050', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  return M;
}

/** 새김 무늬 돌 (기둥 면): 네모 칸 안에 소용돌이·눈·계단 무늬 */
function glyphTexture() {
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#9d947c';
    g.fillRect(0, 0, w, h);
    const rnd = seededRandom(9);
    for (let i = 0; i < 2600; i++) {
      const v = Math.floor(rnd() * 40 - 20);
      g.fillStyle = `rgba(${120 + v},${112 + v},${92 + v},0.35)`;
      g.fillRect(rnd() * w, rnd() * h, 3, 3);
    }
    const cell = 128;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        g.strokeStyle = 'rgba(45,38,28,0.75)';
        g.lineWidth = 6;
        g.strokeRect(x + 8, y + 8, cell - 16, cell - 16);
        g.lineWidth = 5;
        const cx = x + cell / 2, cy = y + cell / 2;
        const k = Math.floor(rnd() * 3);
        g.beginPath();
        if (k === 0) {
          // 소용돌이
          for (let a = 0; a < TAU * 2.2; a += 0.15) {
            const r = 4 + a * 6;
            g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          }
        } else if (k === 1) {
          // 눈 모양
          g.ellipse(cx, cy, 36, 20, 0, 0, TAU);
          g.moveTo(cx + 10, cy);
          g.arc(cx, cy, 10, 0, TAU);
        } else {
          // 계단 무늬
          g.moveTo(cx - 40, cy + 36);
          for (let s = 0; s < 4; s++) {
            g.lineTo(cx - 40 + s * 20, cy + 36 - s * 20);
            g.lineTo(cx - 20 + s * 20, cy + 36 - s * 20);
          }
        }
        g.stroke();
      }
    }
    // 이끼
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${60 + rnd() * 30},${110 + rnd() * 40},${40},${0.25 + rnd() * 0.3})`;
      g.beginPath();
      g.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 20, 3 + rnd() * 8, rnd() * 3, 0, TAU);
      g.fill();
    }
  });
}

function thatchTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#b48a46';
    g.fillRect(0, 0, w, h);
    const rnd = seededRandom(31);
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * w, y = rnd() * h, l = 10 + rnd() * 24;
      const v = Math.floor(rnd() * 50 - 25);
      g.strokeStyle = `rgb(${170 + v},${130 + v},${70 + v})`;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 4, y + l);
      g.stroke();
    }
    g.fillStyle = 'rgba(80,55,25,0.45)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
  });
}

function checkerStrip() {
  const t = canvasTexture(256, 32, (g, w, h) => {
    for (let x = 0; x < w / 16; x++) for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f1e6';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  });
  return t;
}

/** 돌판에 금색으로 새긴 글자 (게이트 앞뒤) */
function bannerTexture(title, sub) {
  return canvasTexture(1024, 160, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#8d846c');
    gr.addColorStop(1, '#6d6552');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    // 테두리 계단 무늬
    g.fillStyle = '#4a4232';
    for (let x = 0; x < w; x += 32) {
      g.fillRect(x, 0, 16, 10);
      g.fillRect(x + 16, h - 10, 16, 10);
    }
    g.strokeStyle = '#3a3326';
    g.lineWidth = 4;
    g.strokeRect(14, 16, w - 28, h - 32);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 64px "Trebuchet MS", sans-serif';
    let size = 64;
    while (g.measureText(title).width > w * 0.78 && size > 30) g.font = `bold ${(size -= 2)}px "Trebuchet MS", sans-serif`;
    g.fillStyle = '#2a2318';
    g.fillText(title, w / 2 + 3, h * 0.42 + 3);
    g.fillStyle = '#f2c94c';
    g.fillText(title, w / 2, h * 0.42);
    g.font = 'bold 28px sans-serif';
    g.fillStyle = '#d9f5e4';
    g.fillText(sub, w / 2, h * 0.78);
    // 양 끝 해 무늬
    for (const x of [62, w - 62]) {
      g.fillStyle = '#f2c94c';
      g.beginPath();
      g.arc(x, h / 2, 22, 0, TAU);
      g.fill();
      g.strokeStyle = '#f2c94c';
      g.lineWidth = 5;
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        g.beginPath();
        g.moveTo(x + Math.cos(a) * 28, h / 2 + Math.sin(a) * 28);
        g.lineTo(x + Math.cos(a) * 40, h / 2 + Math.sin(a) * 40);
        g.stroke();
      }
    }
  });
}

const put = (parent, geo, mat, x, y, z, { cast = true, rx = 0, ry = 0, rz = 0 } = {}) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

/**
 * 그리기 횟수 줄이기: obj 안의 움직이지 않는 일반 메시를 재질별로 하나로 합침
 * (재질 배열을 쓰는 메시·인스턴스·스프라이트는 그대로 둠)
 */
function bake(obj) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const groups = new Map();
  const victims = [];
  obj.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    const key = o.material.uuid + (o.castShadow ? 's' : '');
    if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, geos: [] });
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    groups.get(key).geos.push(g);
    victims.push(o);
  });
  for (const o of victims) o.parent.remove(o);
  for (const { mat, cast, geos } of groups.values()) {
    // 같은 속성끼리만 합칠 수 있음 (uv/color 있는 것끼리)
    const byAttr = new Map();
    for (const g of geos) {
      const k = Object.keys(g.attributes).sort().join();
      if (!byAttr.has(k)) byAttr.set(k, []);
      byAttr.get(k).push(g);
    }
    for (const list of byAttr.values()) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      obj.add(m);
    }
  }
}

/** 불꽃 (스프라이트 2장, update에서 흔들림) */
function makeFire(parent, x, y, z, s = 1) {
  const f = [];
  for (let k = 0; k < 2; k++) {
    const sp = new THREE.Sprite(mats().fire);
    sp.position.set(x, y + k * 0.5 * s, z);
    sp.scale.setScalar((1.6 - k * 0.5) * s);
    parent.add(sp);
    f.push({ sp, base: (1.6 - k * 0.5) * s, ph: Math.random() * 6 });
  }
  return f;
}

// ================================================================ 사원 출발 게이트
export function templeGantry({ width = 21 } = {}) {
  const m = mats();
  const obj = new THREE.Group();
  obj.name = 'templeGantry';
  const hx = width / 2 + 2.2; // 기둥 가운데
  const span = hx * 2 + 3.4;
  const fires = [];
  for (const s of [-1, 1]) {
    const x = s * hx;
    put(obj, new THREE.BoxGeometry(3.6, 1.2, 3.6), m.stoneDark, x, 0.6, 0);
    put(obj, new THREE.BoxGeometry(3.1, 0.6, 3.1), m.stone, x, 1.5, 0);
    // 새김 무늬 기둥 몸통 (앞·뒤·옆 모두 무늬)
    put(obj, new THREE.BoxGeometry(2.6, 7.2, 2.6), m.glyph, x, 1.8 + 3.6, 0);
    put(obj, new THREE.BoxGeometry(3.3, 0.7, 3.3), m.stone, x, 9.35, 0);
    // 기둥 가운데 비취 눈 + 금 띠
    for (const z of [-1.31, 1.31]) put(obj, new THREE.CylinderGeometry(0.42, 0.42, 0.12, 10), m.jade, x, 6.2, z, { rx: Math.PI / 2, cast: false });
    put(obj, new THREE.BoxGeometry(2.7, 0.25, 2.7), m.gold, x, 3.6, 0, { cast: false });
    // 기둥 옆 횃불 (도로 바깥쪽)
    const tx = x + s * 1.6;
    put(obj, new THREE.CylinderGeometry(0.12, 0.16, 1.6, 6), m.wood, tx, 4.8, 0);
    put(obj, new THREE.CylinderGeometry(0.35, 0.18, 0.4, 8), m.stoneDark, tx, 5.75, 0);
    fires.push(...makeFire(obj, tx, 6.2, 0, 0.9));
  }
  // 상인방(가로 돌보): 앞뒤에 글자, 아래는 체커 띠
  const banner = new THREE.MeshStandardMaterial({ map: bannerTexture('JUNGLE RUINS GRAND PRIX', '정글 유적 그랑프리'), roughness: 0.9 });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 2.8, 2.6), [m.stone, m.stone, m.stone, m.stoneDark, banner, banner]);
  beam.position.set(0, 9.7 + 1.4, 0);
  beam.castShadow = beam.receiveShadow = true;
  obj.add(beam);
  put(obj, new THREE.BoxGeometry(span - 0.6, 0.4, 2.7), m.checker, 0, 9.55, 0, { cast: false });
  put(obj, new THREE.BoxGeometry(span + 0.6, 0.5, 3.0), m.stoneDark, 0, 12.75, 0);
  // 가운데 계단 왕관 + 금빛 해 원반
  put(obj, new THREE.BoxGeometry(9, 1.0, 2.4), m.stone, 0, 13.5, 0);
  put(obj, new THREE.BoxGeometry(6, 1.0, 2.1), m.stone, 0, 14.5, 0);
  put(obj, new THREE.BoxGeometry(3.2, 1.0, 1.8), m.stoneDark, 0, 15.5, 0);
  const sun = put(obj, new THREE.CylinderGeometry(1.7, 1.7, 0.3, 20), m.gold, 0, 15.2, 0, { rx: Math.PI / 2 });
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    const ray = put(obj, new THREE.ConeGeometry(0.28, 0.9, 4), m.gold, Math.cos(a) * 2.15, 15.2 + Math.sin(a) * 2.15, 0, { rz: a - Math.PI / 2, cast: false });
    void ray;
  }
  void sun;
  // 양 끝 뱀 머리 장식
  for (const s of [-1, 1]) {
    const hd = new THREE.Group();
    put(hd, new THREE.BoxGeometry(1.6, 1.4, 2.0), m.stone, 0, 0, 0);
    put(hd, new THREE.BoxGeometry(1.2, 0.5, 1.2), m.stoneDark, s * 0.9, -0.35, 0);
    for (const z of [-0.6, 0.6]) put(hd, new THREE.SphereGeometry(0.2, 8, 6), m.jade, s * 0.5, 0.35, z, { cast: false });
    hd.position.set(s * (span / 2 + 0.6), 11.1, 0);
    obj.add(hd);
  }
  // 꼭대기 이끼·덩굴
  const rnd = seededRandom(5);
  for (let i = 0; i < 14; i++) {
    const x = (rnd() - 0.5) * span;
    put(obj, new THREE.IcosahedronGeometry(0.5 + rnd() * 0.6, 0), m.moss, x, 12.9 + rnd() * 0.3, (rnd() - 0.5) * 2.4, { cast: false });
  }
  for (let i = 0; i < 9; i++) {
    const x = (rnd() - 0.5) * (span - 2);
    const L = 1.5 + rnd() * 3.5;
    if (Math.abs(x) < 4.2) continue; // 신호등 앞은 비움
    const z = rnd() < 0.5 ? -1.32 : 1.32;
    put(obj, new THREE.PlaneGeometry(0.35, L), m.vine, x, 9.7 - L / 2, z, { cast: false });
  }
  bake(obj);
  // 신호등 판: 상인방에 쇠사슬 두 줄로 매단 검은 돌판 + 금 테
  for (const x of [-2.6, 2.6]) put(obj, new THREE.CylinderGeometry(0.06, 0.06, 1.4, 5), m.panel, x, 8.85, 0, { cast: false });
  put(obj, new THREE.BoxGeometry(7.0, 1.5, 0.75), m.panel, 0, 7.45, 0);
  put(obj, new THREE.BoxGeometry(7.2, 0.14, 0.85), m.gold, 0, 8.2, 0, { cast: false });
  put(obj, new THREE.BoxGeometry(7.2, 0.14, 0.85), m.gold, 0, 6.7, 0, { cast: false });
  const bulbGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.9, 14).rotateX(Math.PI / 2);
  const bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 5);
  const bm = new THREE.Matrix4();
  for (let i = 0; i < 5; i++) bulbs.setMatrixAt(i, bm.makeTranslation((2 - i) * 1.3, 7.45, 0)); // 0번 = +x = 운전자 왼쪽
  obj.add(bulbs);
  const OFF = new THREE.Color('#3a1010'), ON = new THREE.Color('#ff2a1a'), GO = new THREE.Color('#2bff6a');
  let nOn = 0, green = false;
  const apply = () => {
    for (let i = 0; i < 5; i++) bulbs.setColorAt(i, green ? GO : i < nOn ? ON : OFF);
    bulbs.instanceColor.needsUpdate = true;
  };
  apply();
  bulbs.computeBoundingSphere();
  return {
    obj,
    legX: hx,
    legR: 2.1,
    height: 16,
    setLights(n) {
      nOn = Math.max(0, Math.min(5, n | 0));
      apply();
    },
    setGreen(b) {
      green = !!b;
      apply();
    },
    update(time) {
      for (const f of fires) f.sp.scale.setScalar(f.base * (0.85 + 0.2 * Math.sin(time * 13 + f.ph) + 0.1 * Math.sin(time * 29 + f.ph)));
    },
  };
}

// ================================================================ 관중 (gpAssets 방식 복사: 셰이더로 들썩임)
function crowdMaterial() {
  const mt = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
  const u = { uTime: { value: 0 }, uExcite: { value: 0.3 } };
  mt.userData.u = u;
  mt.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uExcite = u.uExcite;
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
        #endif`,
      );
  };
  return mt;
}
let personGeo = null;
function personBody() {
  if (personGeo) return personGeo;
  // 몸통 + 만세 두 팔을 한 도형으로 (정점 몇 개 안 됨)
  const parts = [
    [new THREE.BoxGeometry(0.42, 1.06, 0.5), 0, 0.53, 0, 0],
    [new THREE.BoxGeometry(0.13, 0.6, 0.13), 0, 1.28, 0.36, 0.38],
    [new THREE.BoxGeometry(0.13, 0.6, 0.13), 0, 1.28, -0.36, -0.38],
  ];
  const pos = [], nor = [], idx = [];
  let off = 0;
  for (const [g, x, y, z, rx] of parts) {
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(rx).setPosition(x, y, z));
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (const i of g.index.array) idx.push(i + off);
    off += g.attributes.position.count;
  }
  personGeo = new THREE.BufferGeometry();
  personGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  personGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  personGeo.setIndex(idx);
  return personGeo;
}

// ================================================================ 돌 계단 관중석 (초가 지붕)
const GS = { rows: 8, D: 1.45, R: 0.62, front: 1.6, walk: 0.9 };
export function templeStand({ length = 60, accent = '#e8862a', seed = 1 } = {}) {
  const m = mats();
  const L = length;
  const { rows, D, R, front, walk } = GS;
  const yTop = front + rows * R;
  const xBack = walk + rows * D;
  const obj = new THREE.Group();
  obj.name = 'templeStand';
  // 계단식 돌 몸체 (단면을 길이 방향으로 밀어냄)
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.lineTo(0, front);
  sh.lineTo(walk, front);
  for (let i = 0; i < rows; i++) {
    const x0 = walk + i * D, y1 = front + (i + 1) * R;
    sh.lineTo(x0, y1);
    sh.lineTo(x0 + D, y1);
  }
  sh.lineTo(xBack + 0.8, yTop);
  sh.lineTo(xBack + 0.8, yTop + 1.2);
  sh.lineTo(14, yTop + 1.2);
  sh.lineTo(14, 0);
  sh.closePath();
  const body = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false });
  body.translate(0, 0, -L / 2);
  put(obj, body, m.stone, 0, 0, 0);
  // 앞면 새김 무늬 띠 (도로 쪽)
  const frieze = new THREE.Mesh(new THREE.PlaneGeometry(L, front - 0.1), m.glyph);
  frieze.material = m.glyph.clone();
  frieze.material.map = m.glyph.map.clone();
  frieze.material.map.repeat.set(L / 3, 0.25);
  frieze.material.map.needsUpdate = true;
  frieze.rotation.y = -Math.PI / 2;
  frieze.position.set(-0.03, front / 2, 0);
  obj.add(frieze);
  put(obj, new THREE.BoxGeometry(0.9, 0.16, L), m.gold, 0.45, front + 0.08, 0, { cast: false });
  // 좌석: 줄마다 짠 돗자리 색 (주황·청록·빨강 번갈아)
  const seatCols = [accent, '#19b3a6', '#c0392b', '#ffcf3f'];
  for (let i = 0; i < rows; i++) {
    const x0 = walk + i * D, y1 = front + (i + 1) * R;
    put(obj, new THREE.BoxGeometry(0.55, 0.12, L - 0.6), new THREE.MeshLambertMaterial({ color: seatCols[i % seatCols.length] }), x0 + D - 0.4, y1 + 0.06, 0, { cast: false });
  }
  // 양 끝 계단 피라미드 벽 + 횃불
  const fires = [];
  for (const s of [-1, 1]) {
    const zE = s * (L / 2 + 0.8);
    put(obj, new THREE.BoxGeometry(14.4, yTop + 1.2, 1.6), m.stoneDark, 7, (yTop + 1.2) / 2, zE);
    for (let k = 0; k < 3; k++) put(obj, new THREE.BoxGeometry(12 - k * 3.6, 1.0, 1.5 - k * 0.15), m.stoneDark, 7.6 + k * 0.9, yTop + 1.7 + k, zE); // 계단 꼭대기
    put(obj, new THREE.CylinderGeometry(0.35, 0.2, 0.5, 8), m.stoneDark, -0.4, yTop + 3.6, s * (L / 2 + 0.8));
    fires.push(...makeFire(obj, -0.4, yTop + 4.1, s * (L / 2 + 0.8), 1.1));
  }
  // 나무 기둥 + 초가 지붕 (앞이 높고 뒤가 낮음)
  const roofFront = yTop + 6.0, roofBack = yTop + 4.6;
  const nCol = Math.max(2, Math.round(L / 12) + 1);
  for (let k = 0; k < nCol; k++) {
    const z = -L / 2 + 0.8 + (k * (L - 1.6)) / (nCol - 1);
    put(obj, new THREE.CylinderGeometry(0.22, 0.28, roofFront - front, 7), m.wood, 0.5, (front + roofFront) / 2, z);
    put(obj, new THREE.CylinderGeometry(0.25, 0.3, roofBack - yTop - 1.2, 7), m.wood, 13.4, (yTop + 1.2 + roofBack) / 2, z);
  }
  const roofW = 16.4;
  const tilt = Math.atan2(roofFront - roofBack, roofW);
  const roofTex = m.thatch.map.clone();
  roofTex.repeat.set(roofW / 4, L / 4);
  roofTex.needsUpdate = true;
  const roofMat = m.thatch.clone();
  roofMat.map = roofTex;
  const roof = put(obj, new THREE.BoxGeometry(roofW, 0.5, L + 2), roofMat, -1.4 + roofW / 2, (roofFront + roofBack) / 2 + 0.25, 0, { rz: -tilt });
  void roof;
  // 지붕 앞 처마 술 (초록 잎 술 + 색 천 깃발 줄)
  const fringeTex = canvasTexture(128, 32, (g, w, h) => {
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = x % 16 ? '#3f8a2e' : '#5aa53a';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 8, 0);
      g.lineTo(x + 4, h);
      g.fill();
    }
  });
  fringeTex.repeat.set(L / 4, 1);
  const fringe = new THREE.Mesh(new THREE.PlaneGeometry(L + 2, 1.1), new THREE.MeshLambertMaterial({ map: fringeTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
  fringe.rotation.y = -Math.PI / 2;
  fringe.position.set(-1.45, roofFront - 0.35, 0);
  obj.add(fringe);
  // 삼각 깃발 줄 (한 도형)
  {
    const pos = [], col = [];
    const cc = new THREE.Color();
    const cols = [accent, '#19b3a6', '#ffcf3f', '#c0392b', '#f4f1e6'];
    let k = 0;
    for (let z = -L / 2; z < L / 2 - 1; z += 1.4, k++) {
      const sag = -0.5 * Math.sin(((z + L / 2) / L) * Math.PI * Math.max(1, Math.round(L / 20)) ) ** 2;
      const y = roofFront - 1.0 + sag;
      pos.push(-1.5, y, z, -1.5, y, z + 1.0, -1.5, y - 0.9, z + 0.5);
      cc.set(cols[k % cols.length]);
      for (let v = 0; v < 3; v++) col.push(cc.r, cc.g, cc.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    obj.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }
  // 뒷벽 위 화분 덤불
  const rnd = seededRandom(seed * 13 + 3);
  for (let z = -L / 2 + 2; z < L / 2 - 1; z += 4 + rnd() * 2) put(obj, new THREE.IcosahedronGeometry(0.8 + rnd() * 0.5, 0), m.moss, 13.6, yTop + 1.6, z, { cast: false });

  bake(obj);
  // 관중
  const spots = [];
  for (let i = 0; i < rows; i++) {
    const x = walk + i * D + D * 0.4, y = front + (i + 1) * R;
    for (let z = -L / 2 + 0.6; z <= L / 2 - 0.6; z += 0.74) {
      if (rnd() > 0.82) continue;
      spots.push([x + (rnd() - 0.5) * 0.15, y, z + (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.6]);
    }
  }
  const cmat = crowdMaterial();
  const bodies = new THREE.InstancedMesh(personBody(), cmat, spots.length);
  const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2, 0), cmat, spots.length);
  const shirts = ['#e8862a', '#19b3a6', '#ffcf3f', '#c0392b', '#2f8a3a', '#f4f1e6', '#7d4bd8', '#ff6fa8', '#4f93f5', '#8fd0ff'];
  const skins = ['#f5d0a9', '#e8b48a', '#c98d62', '#8d5a3b', '#ffe0bd'];
  const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  spots.forEach(([x, y, z, ry], i) => {
    q.setFromAxisAngle(UP, ry);
    const s = 0.9 + rnd() * 0.2;
    mm.compose(p.set(x, y, z), q, sc.set(1, s, 1));
    bodies.setMatrixAt(i, mm);
    bodies.setColorAt(i, c.set(shirts[Math.floor(rnd() * shirts.length)]));
    mm.compose(p.set(x, y + 1.06 * s + 0.2, z), q, sc.set(1, 1, 1));
    heads.setMatrixAt(i, mm);
    heads.setColorAt(i, c.set(skins[Math.floor(rnd() * skins.length)]));
  });
  for (const im of [bodies, heads]) {
    im.computeBoundingSphere();
    im.boundingSphere.radius += 1;
    obj.add(im);
  }
  return {
    obj,
    halfDepth: 7,
    height: roofFront + 1.2,
    update(time, dt, excite = 0.35) {
      cmat.userData.u.uTime.value = time;
      cmat.userData.u.uExcite.value = excite;
      for (const f of fires) f.sp.scale.setScalar(f.base * (0.85 + 0.2 * Math.sin(time * 13 + f.ph)));
    },
  };
}
