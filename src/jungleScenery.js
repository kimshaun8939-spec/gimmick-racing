// 정글 유적 풍경: 코스(jungleTrack.js)에 맞춰 하늘·정글·유적·협곡·동굴·지하 세계를 배치합니다.
//
//   출발 직선     : F1 출발 게이트(빨간불 5개, 왼쪽부터), 관중석, 피트, 깃발, 사원 문 아치
//   오르막 S자    : 돌 기둥·석상·작은 계단 피라미드, 대나무 숲
//   사원 광장     : 태양의 대피라미드 (도로가 피라미드 속 터널을 지나고, 안쪽 끝에 포털 A)
//   지하 세계     : jungleWorld.js (포털 A~B 사이. 지나가면 하늘·빛이 용암 세계로 바뀜)
//   폭포 절벽     : 포털 B, 고원 가장자리 폭포들
//   협곡          : 밧줄 다리(나무 탑·밧줄·깃발), 강, 협곡 폭포, 물안개
//   떠 있는 돌    : 저중력 구역 (빛나는 룬 기둥, 떠 있는 돌은 jungleProps.js)
//   동굴 직선     : 이끼 바위 동굴 (종유석, 빛나는 버섯·수정)
//   멀리          : 연기 나는 화산, 먼 산, 고원 아래 정글 바다(나무 꼭대기), 새 떼(jungleProps.js)
//   어디나        : 큰 열대 나무·야자·대나무·고사리·덤불·꽃 (인스턴스), 반딧불, 안개, 햇살 줄기
// 큰 물체는 충돌체(원, 높이 범위)가 있어 차가 통과하지 못합니다 (gpScenery.js와 같은 방식).
import * as THREE from 'three';
import * as A from './gpAssets.js';
import { templeGantry, templeStand } from './jungleStart.js';
import { buildTempleGate } from './jungleTrap.js';
import { waterfall } from './gpSky.js';
import { buildUnderworld } from './jungleWorld.js';
import { seededRandom, canvasTexture, glowTexture, stoneTexture, TAU } from './jungleUtil.js';

const CAR_R = 1.3;
const CELL = 24;
const UP = new THREE.Vector3(0, 1, 0);

// 정글 환경 (하늘·안개·빛). 지하 세계에서 돌아올 때 이 값으로 되돌림
const ENV = { bg: '#c4d6b8', fog: '#b9cdb0', near: 170, far: 1300, hemiSky: '#eef6dc', hemiGround: '#3b5a28', hemiI: 1.05, sunC: '#fff0cf', sunI: 2.25 };

/**
 * gpAssets의 출발 게이트·관중석·피트 간판에 박힌 "SKY HARBOR" 글자를 정글 글자로 다시 그림
 * (gpAssets.js는 얼린 파일이라 못 고침 → 만들어진 캔버스 텍스처를 크기로 찾아 덮어 그림. 이 맵 페이지에서만 적용)
 */
function rebrand(root) {
  const done = new Set();
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      const img = m.map && m.map.image;
      if (!img || !img.getContext || done.has(img)) continue;
      const g = img.getContext('2d'), w = img.width, h = img.height;
      const fit = (text, maxW, size) => {
        let sz = size;
        do g.font = `900 ${sz}px sans-serif`; while (g.measureText(text).width > maxW && --sz > 10);
      };
      if (w === 1024 && h === 112) {
        // 출발 게이트 큰 배너
        g.fillStyle = '#f4ecd8';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#2f8a3a';
        g.fillRect(0, 0, w, 10);
        g.fillRect(0, h - 10, w, 10);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fit('JUNGLE RUINS GRAND PRIX', w * 0.84, 74);
        g.fillStyle = '#2f6f25';
        g.fillText('JUNGLE RUINS GRAND PRIX', w / 2, h / 2 + 3);
        g.fillStyle = '#e8862a';
        for (const x of [36, w - 36]) g.beginPath(), g.arc(x, h / 2, 18, 0, TAU), g.fill();
      } else if (w === 128 && h === 768) {
        // 게이트 다리 세로 글자
        g.fillStyle = '#2f6f25';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#f4ecd8';
        g.fillRect(0, 0, 10, h);
        g.fillRect(w - 10, 0, 10, h);
        g.save();
        g.translate(w / 2, h / 2);
        g.rotate(-Math.PI / 2);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fit('정글 유적', h * 0.8, 86);
        g.fillText('정글 유적', 0, 4);
        g.restore();
      } else if (w === 1024 && h === 128) {
        // 관중석 스폰서 띠
        const blocks = [['#2f8a3a', '#ffffff', 'JUNGLE RUINS'], ['#f4ecd8', '#6b4528', '정글 유적 GP'], ['#e8862a', '#2a1a10', 'LAVA PORTAL 🌋'], ['#1f5f6a', '#ffffff', 'TEMPLE GATE']];
        const bw = w / blocks.length;
        blocks.forEach(([bg, fg, text], i) => {
          g.fillStyle = bg;
          g.fillRect(i * bw, 0, bw, h);
          g.fillStyle = fg;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          fit(text, bw * 0.86, 60);
          g.fillText(text, i * bw + bw / 2, h / 2 + 2);
        });
      } else if (w === 1024 && h === 200) {
        // 피트 건물 간판
        g.fillStyle = '#2f6f25';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#f4ecd8';
        g.lineWidth = 10;
        g.strokeRect(14, 14, w - 28, h - 28);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fit('JUNGLE RUINS', w * 0.8, 110);
        g.fillStyle = '#f4ecd8';
        g.fillText('JUNGLE RUINS', w / 2, h * 0.42);
        g.font = '800 38px sans-serif';
        g.fillStyle = '#ffcf3f';
        g.fillText('PIT LANE · 정글 유적 그랑프리', w / 2, h * 0.78);
      } else continue;
      done.add(img);
      m.map.needsUpdate = true;
    }
  });
}

// ---------------------------------------------------------------- 꼭짓점 색으로 굽는 메시 (나무 등 인스턴스용)
class Geo {
  constructor() {
    this.pos = [];
    this.col = [];
  }
  /** three 도형을 행렬로 옮겨 붙임. color: Color | (중심, 법선) => Color */
  add(geo, m, color) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3(), ctr = new THREE.Vector3();
    for (let i = 0; i + 2 < p.count; i += 3) {
      a.fromBufferAttribute(p, i).applyMatrix4(m);
      b.fromBufferAttribute(p, i + 1).applyMatrix4(m);
      c.fromBufferAttribute(p, i + 2).applyMatrix4(m);
      let col = color;
      if (typeof color === 'function') {
        n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
        ctr.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        col = color(ctr, n);
      }
      this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      for (let k = 0; k < 3; k++) this.col.push(col.r, col.g, col.b);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
const M = (x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const C = (hex) => new THREE.Color(hex);

/** 식물 모양들 (높이 1 기준이 아니라 실제 m) */
function plantGeos(rnd) {
  const R = (a, b) => a + rnd() * (b - a);
  const jit = (hex, l = 0.06) => C(hex).offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * l);
  const out = {};
  // 큰 열대 나무 (판근 + 굵은 줄기 + 넓은 수관 여러 덩어리)
  {
    const g = new Geo();
    g.add(new THREE.CylinderGeometry(0.55, 1.0, 16, 7), M(0, 8, 0), () => jit('#6b5238'));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + 0.4;
      g.add(new THREE.BoxGeometry(0.25, 3.2, 2.6), M(Math.cos(a) * 1.1, 1.4, Math.sin(a) * 1.1, 1, 1, 1, 0, -a, 0), () => jit('#5e4630'));
    }
    // 가지
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      g.add(new THREE.CylinderGeometry(0.18, 0.3, 6, 5), M(Math.cos(a) * 2, 15, Math.sin(a) * 2, 1, 1, 1, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9), () => jit('#5e4630'));
    }
    const crowns = [[0, 18.5, 0, 6.5], [4, 17, 1.5, 4.6], [-3.5, 17.3, -2.5, 4.8], [1, 16.6, -4, 4.2], [-2, 16.8, 3.8, 4.3], [0.5, 20.5, 0.5, 4], [3, 15.8, -2, 3.4]];
    for (const [x, y, z, r] of crowns)
      g.add(new THREE.IcosahedronGeometry(r, 0), M(x, y, z, 1, 0.55, 1, 0, x + z, 0), (c, n) => (n.y > 0.3 ? jit('#3f8f32', 0.1) : jit('#2b6a24', 0.08)));
    // 덩굴
    for (let k = 0; k < 5; k++) g.add(new THREE.CylinderGeometry(0.06, 0.06, R(5, 9), 3), M(R(-4, 4), 12, R(-4, 4)), () => C('#3d6b28'));
    out.kapok = g.build();
  }
  // 야자수 (휘어진 줄기 + 늘어진 잎 + 열매)
  {
    const g = new Geo();
    let x = 0, y = 0;
    for (let k = 0; k < 6; k++) {
      const lean = 0.08 + k * 0.05;
      g.add(new THREE.CylinderGeometry(0.26 - k * 0.02, 0.32 - k * 0.02, 2.3, 6), M(x, y + 1.1, 0, 1, 1, 1, 0, 0, -lean), () => jit(k % 2 ? '#8a7354' : '#7a6448'));
      x += Math.sin(lean) * 2.2;
      y += Math.cos(lean) * 2.2;
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const leaf = new THREE.PlaneGeometry(1.1, 5.2, 1, 3);
      // 아래로 휘게
      const p = leaf.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = p.getY(i) + 2.6; // 0~5.2
        p.setZ(i, -0.06 * v * v);
        p.setX(i, p.getX(i) * (1 - v / 6.5));
      }
      leaf.translate(0, 2.6, 0);
      leaf.rotateX(-Math.PI / 2 + 0.25);
      g.add(leaf, M(x, y + 0.1, 0, 1, 1, 1, 0, a, 0), () => jit('#4f9a35', 0.1));
    }
    for (let k = 0; k < 4; k++) g.add(new THREE.SphereGeometry(0.22, 5, 4), M(x + Math.cos(k * 1.6) * 0.35, y - 0.3, Math.sin(k * 1.6) * 0.35), () => C('#6b4a22'));
    out.palm = g.build();
  }
  // 대나무 덤불
  {
    const g = new Geo();
    for (let k = 0; k < 7; k++) {
      const a = R(0, TAU), r = R(0, 1.3), h = R(8, 13), tilt = R(-0.12, 0.12);
      g.add(new THREE.CylinderGeometry(0.1, 0.13, h, 4, 1, true), M(Math.cos(a) * r, h / 2, Math.sin(a) * r, 1, 1, 1, tilt, 0, tilt), () => jit('#8aa64a'));
      for (let j = 0; j < 2; j++) g.add(new THREE.OctahedronGeometry(R(1.1, 1.6), 0), M(Math.cos(a) * r + tilt * h * 0.5, h * R(0.7, 1), Math.sin(a) * r, 1, 0.5, 1, 0, a, 0), () => jit('#5c9a3a', 0.1));
    }
    out.bamboo = g.build();
  }
  // 고사리 (바닥에 퍼진 잎)
  {
    const g = new Geo();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU + R(-0.2, 0.2);
      const leaf = new THREE.PlaneGeometry(0.5, 2.0, 1, 2);
      const p = leaf.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = p.getY(i) + 1;
        p.setZ(i, 0.35 * v - 0.25 * v * v);
        p.setX(i, p.getX(i) * (1 - v / 2.6));
      }
      leaf.translate(0, 1, 0);
      leaf.rotateX(-Math.PI / 2 + 0.6);
      g.add(leaf, M(0, 0.1, 0, 1, 1, 1, 0, a, 0), () => jit('#4a9a3a', 0.12));
    }
    out.fern = g.build();
  }
  // 덤불
  {
    const g = new Geo();
    for (let k = 0; k < 4; k++) g.add(new THREE.IcosahedronGeometry(R(0.9, 1.6), 0), M(R(-1, 1), R(0.6, 1.2), R(-1, 1), 1, 0.75, 1), () => jit('#3f7f2c', 0.12));
    out.bush = g.build();
  }
  // 꽃 (빨강·노랑·보라 작은 덩어리, 색은 인스턴스 색으로)
  {
    const g = new Geo();
    g.add(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 3), M(0, 0.4, 0), () => C('#4a7a2a'));
    for (let k = 0; k < 4; k++) g.add(new THREE.OctahedronGeometry(0.22, 0), M(Math.cos(k * 1.6) * 0.25, 0.8 + (k % 2) * 0.1, Math.sin(k * 1.6) * 0.25), () => C('#ffffff'));
    for (let k = 0; k < 3; k++) g.add(new THREE.PlaneGeometry(0.3, 0.7), M(Math.cos(k * 2.1) * 0.2, 0.35, Math.sin(k * 2.1) * 0.2, 1, 1, 1, 0.4, k * 2.1, 0), () => C('#4f8f30'));
    out.flower = g.build();
  }
  // 이끼 바위
  {
    const g = new Geo();
    g.add(new THREE.DodecahedronGeometry(1, 0), M(0, 0.45, 0, 1.3, 0.9, 1.1), (c, n) => (n.y > 0.55 ? jit('#4f7f32', 0.1) : jit('#7a7666', 0.1)));
    out.rock = g.build();
  }
  // ---- 멀리서 보는 가벼운 모양 (LOD): 실루엣·색은 비슷하게, 삼각형은 1/4~1/10
  {
    const g = new Geo();
    g.add(new THREE.CylinderGeometry(0.6, 0.95, 16, 5, 1, true), M(0, 8, 0), () => C('#654d35'));
    for (const [x, y, z, r] of [[0, 18.3, 0, 7], [3.5, 16.8, 1.2, 5], [-3.2, 17, -2.2, 5.2], [0, 16.6, -3.8, 4.4]])
      g.add(new THREE.IcosahedronGeometry(r, 0), M(x, y, z, 1, 0.55, 1, 0, x + z, 0), (c, n) => (n.y > 0.3 ? C('#3f8f32') : C('#2b6a24')));
    out.kapokLo = g.build();
  }
  {
    const g = new Geo();
    g.add(new THREE.CylinderGeometry(0.18, 0.3, 13, 4, 1, true), M(2.6, 6.4, 0, 1, 1, 1, 0, 0, -0.4), () => C('#7f6a4e'));
    for (let k = 0; k < 6; k++) {
      const leaf = new THREE.PlaneGeometry(1.1, 5.2, 1, 1);
      leaf.translate(0, 2.6, 0);
      leaf.rotateX(-Math.PI / 2 + 0.6);
      g.add(leaf, M(5.2, 12.3, 0, 1, 1, 1, 0, (k / 6) * TAU, 0), () => C('#4f9a35'));
    }
    out.palmLo = g.build();
  }
  {
    const g = new Geo();
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1, h = 10 + k;
      g.add(new THREE.CylinderGeometry(0.1, 0.13, h, 3, 1, true), M(Math.cos(a) * 0.7, h / 2, Math.sin(a) * 0.7), () => C('#8aa64a'));
      g.add(new THREE.OctahedronGeometry(1.6, 0), M(Math.cos(a) * 0.7, h * 0.85, Math.sin(a) * 0.7, 1, 0.6, 1), () => C('#5c9a3a'));
    }
    out.bambooLo = g.build();
  }
  {
    const g = new Geo();
    g.add(new THREE.IcosahedronGeometry(1.5, 0), M(0, 0.9, 0, 1.3, 0.75, 1.2), () => C('#3f7f2c'));
    out.bushLo = g.build();
  }
  // 고원 아래 정글 바다용 나무 꼭대기 (멀리서만 보임, 가볍게)
  {
    const g = new Geo();
    g.add(new THREE.IcosahedronGeometry(1, 0), M(0, 0, 0, 1, 0.5, 1), (c, n) => (n.y > 0.2 ? jit('#3d7f30', 0.12) : jit('#2a5a22', 0.08)));
    out.crown = g.build();
  }
  return out;
}

export function buildJungleScenery(track, scene) {
  const rand = seededRandom(20261110);
  const R = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const W = track.width, HW = W / 2, CURB = track.curb, DECK = track.deckHalf;
  const group = new THREE.Group();
  scene.add(group);
  const animators = [];
  const tmpV = new THREE.Vector3();
  const marks = track.marks || {};
  const mt = (name, dm = 0) => (((marks[name] ?? 0) + dm / track.length) % 1 + 1) % 1;

  // ---------------------------------------------------------------- 환경 (빛, 안개, 배경)
  {
    const hemi = scene.children.find((o) => o.isHemisphereLight);
    const sun = scene.children.find((o) => o.isDirectionalLight);
    if (scene.background && scene.background.isColor) scene.background.set(ENV.bg);
    if (scene.fog) scene.fog.color.set(ENV.fog), (scene.fog.near = ENV.near), (scene.fog.far = ENV.far);
    if (hemi) hemi.color.set(ENV.hemiSky), hemi.groundColor.set(ENV.hemiGround), (hemi.intensity = ENV.hemiI);
    if (sun) sun.color.set(ENV.sunC), (sun.intensity = ENV.sunI);
  }

  // ---------------------------------------------------------------- 충돌체 (원, 높이 y0~y1)
  const grid = new Map();
  let stamp = 0;
  const allColliders = [];
  function addCollider(c) {
    c.stamp = 0;
    allColliders.push(c);
    for (let cx = Math.floor((c.x - c.r) / CELL); cx <= Math.floor((c.x + c.r) / CELL); cx++)
      for (let cz = Math.floor((c.z - c.r) / CELL); cz <= Math.floor((c.z + c.r) / CELL); cz++) {
        const k = `${cx},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
  }
  const circle = (x, z, r, y0, y1) => addCollider({ x, z, r, y0, y1 });

  // ---------------------------------------------------------------- 자리 찾기
  const occupied = [];
  const free = (x, z, r) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
  const occupy = (x, z, r) => occupied.push({ x, z, r });
  const roadD = (x, z) => track.nearestRaw(tmpV.set(x, 0, z));
  const onApron = (x, z) => !!(track.apronAt && track.apronAt(x, z)); // 돌 포장 갓길 위엔 풀·석상 안 놓음
  function landY(x, z, edge = 3) {
    if (track.fieldAt(x, z) < edge) return null;
    return track.heightAt(x, z);
  }
  const add = (obj, x, y, z, yaw = 0, parent = group) => {
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    parent.add(obj);
    return obj;
  };
  const anim = (r) => r && r.update && animators.push((t, dt, car) => r.update(t, dt, car));
  const yawOf = (s) => Math.atan2(s.tan.x, s.tan.z);
  function beside(t, l) {
    const s = track.sampleAt(t);
    const p = track.surf(s, l, 0, new THREE.Vector3());
    return { s, p, yaw: yawOf(s) };
  }
  // 정글(땅) 범위
  const landBox = new THREE.Box2();
  for (const s of track.samples) if (!s.space) landBox.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
  const lbC = landBox.getCenter(new THREE.Vector2());
  const lbS = landBox.getSize(new THREE.Vector2());
  const landR = Math.hypot(lbS.x, lbS.y) / 2 + 150;
  const SUN_DIR = new THREE.Vector3(60, 110, 40).normalize();

  // ---------------------------------------------------------------- 하늘 돔 (카메라를 따라감): 습한 연녹빛 지평선 + 파란 하늘 + 해 + 구름
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR } },
      vertexShader: /* glsl */ `varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSun; varying vec3 vD;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p *= 2.1; a *= 0.5; } return s; }
        void main() {
          float h = vD.y;
          vec3 hor = vec3(0.80, 0.86, 0.74), mid = vec3(0.56, 0.74, 0.88), top = vec3(0.30, 0.52, 0.80);
          vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));
          col = mix(col, top, smoothstep(0.22, 0.8, h));
          float sd = max(0.0, dot(vD, uSun));
          col += vec3(1.0, 0.92, 0.7) * (pow(sd, 600.0) * 2.5 + pow(sd, 18.0) * 0.35);
          // 구름 (위쪽, 천천히 흐름)
          if (h > 0.02) {
            vec2 uv = vD.xz / (h + 0.15) * 1.3 + vec2(uTime * 0.004, uTime * 0.002);
            float c = smoothstep(0.52, 0.78, fbm(uv));
            vec3 cc = mix(vec3(0.82, 0.84, 0.82), vec3(1.0, 0.98, 0.94), smoothstep(0.0, 0.6, sd + h));
            col = mix(col, cc, c * smoothstep(0.02, 0.2, h) * 0.85);
          }
          if (h < 0.0) col = mix(hor, vec3(0.62, 0.70, 0.58), smoothstep(0.0, -0.3, h));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2600, 40, 20), mat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    skyGroup.add(dome);
    animators.push((t) => {
      mat.uniforms.uTime.value = t;
      if (window.game && window.game.camera) skyGroup.position.copy(window.game.camera.position);
    });
  }

  // ---------------------------------------------------------------- 고원 아래 정글 바다 + 먼 산 + 화산
  const FLOOR_Y = -32;
  {
    const tex = canvasTexture(512, 512, (g, w, h) => {
      g.fillStyle = '#2f5f26';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1800; i++) {
        const r = 4 + Math.random() * 16;
        g.fillStyle = `rgba(${40 + Math.random() * 40},${90 + Math.random() * 70},${30 + Math.random() * 30},0.7)`;
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, r, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(255,255,220,0.12)';
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, r * 0.4, 0, TAU);
        g.fill();
      }
    });
    tex.repeat.set(60, 60);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3000, 48), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(lbC.x, FLOOR_Y, lbC.y);
    group.add(floor);
  }
  const plants = plantGeos(seededRandom(99));
  const plantMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const plantMat2 = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  /**
   * 거리에 따라 모양을 바꾸는 인스턴스 (LOD): 카메라에서 near m 안 = 자세한 모양(hi), far m 안 = 가벼운 모양(lo, 없으면 안 그림).
   * 카메라가 15 m 넘게 움직일 때만 다시 나눔 (행렬 복사만 하므로 가벼움)
   */
  const lodSets = [];
  function instancedLOD(hiGeo, loGeo, mat, items, { near = 170, far = 2000, shadow = false, name = '' } = {}) {
    if (!items.length) return;
    const n = items.length;
    const mats = new Float32Array(n * 16), cols = items.some((it) => it.color) ? new Float32Array(n * 3) : null;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    items.forEach((it, i) => {
      q.setFromAxisAngle(UP, it.ry || 0);
      m4.compose(v.set(it.x, it.y, it.z), q, sc.set(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.s)).toArray(mats, i * 16);
      if (cols) col.set(it.color || '#ffffff').toArray(cols, i * 3);
    });
    const mk = (geo, cast, suffix) => {
      if (!geo) return null;
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.name = name + suffix;
      im.castShadow = cast;
      im.receiveShadow = true;
      im.frustumCulled = false; // 숲 전체에 퍼져 있음 (개수는 count로 줄임)
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (cols) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      im.count = 0;
      group.add(im);
      return im;
    };
    lodSets.push({ items, mats, cols, hi: mk(hiGeo, shadow, ''), lo: mk(loGeo, false, 'Lo'), near2: near * near, far2: far * far });
  }
  const lodAt = new THREE.Vector3(1e9, 0, 0);
  function updateLOD(cx, cz, force = false) {
    if (!force && (lodAt.x - cx) ** 2 + (lodAt.z - cz) ** 2 < 15 * 15) return;
    lodAt.set(cx, 0, cz);
    for (const L of lodSets) {
      let nh = 0, nl = 0;
      const hm = L.hi.instanceMatrix.array, lm = L.lo ? L.lo.instanceMatrix.array : null;
      const hc = L.cols && L.hi.instanceColor.array, lc = L.cols && L.lo && L.lo.instanceColor.array;
      for (let i = 0; i < L.items.length; i++) {
        const it = L.items[i];
        const d2 = (it.x - cx) ** 2 + (it.z - cz) ** 2;
        if (d2 < L.near2) {
          hm.set(L.mats.subarray(i * 16, i * 16 + 16), nh * 16);
          if (hc) hc.set(L.cols.subarray(i * 3, i * 3 + 3), nh * 3);
          nh++;
        } else if (lm && d2 < L.far2) {
          lm.set(L.mats.subarray(i * 16, i * 16 + 16), nl * 16);
          if (lc) lc.set(L.cols.subarray(i * 3, i * 3 + 3), nl * 3);
          nl++;
        }
      }
      L.hi.count = nh;
      L.hi.instanceMatrix.needsUpdate = true;
      if (hc) L.hi.instanceColor.needsUpdate = true;
      if (L.lo) {
        L.lo.count = nl;
        L.lo.instanceMatrix.needsUpdate = true;
        if (lc) L.lo.instanceColor.needsUpdate = true;
      }
    }
  }
  animators.push(() => {
    const cam = window.game && window.game.camera;
    if (cam) updateLOD(cam.position.x, cam.position.z);
  });
  /** 인스턴스 메시 하나 만들기: items = [{x,y,z,s,ry,color?}] */
  function instanced(geo, mat, items, { shadow = false, name = '' } = {}) {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    im.name = name;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    items.forEach((it, i) => {
      q.setFromAxisAngle(UP, it.ry || 0);
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.s));
      im.setMatrixAt(i, m4);
      if (it.color) im.setColorAt(i, col.set(it.color));
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  }
  // 고원 밖 아래쪽 나무 꼭대기들 (원근감)
  {
    const items = [];
    for (let i = 0; i < 2600 && items.length < 1700; i++) {
      const a = R(0, TAU), r = landR * 0.4 + Math.pow(rand(), 0.7) * 900;
      const x = lbC.x + Math.cos(a) * r, z = lbC.y + Math.sin(a) * r;
      if (track.fieldAt(x, z) > -6) continue;
      const s = R(6, 14);
      items.push({ x, y: FLOOR_Y + R(1, 5), z, s, sy: s * R(0.8, 1.2), ry: R(0, TAU) });
    }
    instanced(plants.crown, plantMat, items, { name: 'canopy' });
  }
  // 먼 산 (안개 없이 직접 옅게 칠함 → 지평선 실루엣)
  {
    const layers = [[2100, '#8ea596', 26, 260, 520], [2450, '#a9bcae', 22, 300, 640]];
    for (const [rad, color, n, h0, h1] of layers) {
      const mat = new THREE.MeshBasicMaterial({ color, fog: false });
      const items = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + R(-0.08, 0.08);
        const h = R(h0, h1), w = R(260, 420);
        items.push({ x: lbC.x + Math.cos(a) * rad, y: FLOOR_Y - 20 + h / 2, z: lbC.y + Math.sin(a) * rad, sx: w, sy: h, sz: w, ry: R(0, TAU) });
      }
      const im = instanced(new THREE.ConeGeometry(1, 1, 6), mat, items, { name: 'farMountains' });
      im.renderOrder = -5;
    }
  }
  // 화산 (북동쪽 멀리, 연기 + 빛나는 분화구 + 용암 줄기)
  const volcano = new THREE.Group();
  {
    const vx = lbC.x + 900, vz = lbC.y - 1500;
    const prof = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      prof.push(new THREE.Vector2(620 * (1 - u) + 70 * u + Math.sin(u * 9) * 12, u * 520));
    }
    prof.push(new THREE.Vector2(55, 505), new THREE.Vector2(20, 470));
    const cone = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshBasicMaterial({ color: '#6a6660', fog: false }));
    volcano.add(cone);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(60, 20), new THREE.MeshBasicMaterial({ color: '#ff7a2a', fog: false }));
    crater.rotation.x = -Math.PI / 2;
    crater.position.y = 506;
    volcano.add(crater);
    // 용암 줄기 (경사면을 따라 빛나는 띠)
    const lavaMat = new THREE.MeshBasicMaterial({ color: '#ff8a3a', fog: false });
    for (let k = 0; k < 5; k++) {
      const a = -0.6 + k * 0.3 + R(-0.1, 0.1);
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const rr = 70 + u * 420;
        pts.push(new THREE.Vector3(Math.cos(a + Math.sin(u * 5 + k) * 0.05) * rr, 505 - u * 430 + 2, Math.sin(a + Math.sin(u * 5 + k) * 0.05) * rr));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 6 - k * 0.6, 4), lavaMat);
      volcano.add(tube);
    }
    volcano.position.set(vx, FLOOR_Y - 40, vz);
    // 연기 기둥
    const smokeTex = glowTexture('rgba(90,85,80,0.9)', 'rgba(110,105,100,0.4)');
    const puffs = [];
    for (let i = 0; i < 26; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: '#8a827a', transparent: true, depthWrite: false, fog: false }));
      volcano.add(sp);
      puffs.push({ sp, ph: i / 26, dx: R(-40, 40) });
    }
    const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,200,120,1)', 'rgba(255,100,20,0.4)'), color: '#ff7a2a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glowS.position.y = 520;
    glowS.scale.setScalar(260);
    volcano.add(glowS);
    animators.push((t) => {
      for (const p of puffs) {
        const k = (t * 0.02 + p.ph) % 1;
        p.sp.position.set(p.dx * (1 + k * 3) + k * 260, 520 + k * 520, k * 60);
        p.sp.scale.setScalar(90 + k * 320);
        p.sp.material.opacity = 0.75 * (1 - k);
      }
      glowS.material.opacity = 0.6 + 0.2 * Math.sin(t * 1.7);
    });
    volcano.traverse((o) => (o.renderOrder = -4));
    group.add(volcano);
  }

  // ---------------------------------------------------------------- 출발 직선: 출발 게이트, 관중석, 피트, 깃발
  {
    const s0 = track.sampleAt(0);
    // 사원식 출발 게이트 (jungleStart.js): 새김 무늬 돌기둥 + 글자 돌보 + 매달린 빨간불 5개
    const g = templeGantry({ width: W + 2 * CURB });
    add(g.obj, s0.pos.x, s0.pos.y, s0.pos.z, yawOf(s0));
    anim(g);
    if (g.setLights) {
      // 빨간불: 운전자 기준 왼쪽부터 하나씩 → 모두 꺼지면 출발 (0번 전구 = 로컬 +x = 왼쪽)
      animators.push(() => {
        const race = window.game && window.game.race;
        if (!race) return;
        if (race.phase === 'countdown') {
          g.setLights(race.lights ?? 0);
          g.setGreen && g.setGreen(false);
        } else {
          g.setLights(0);
          g.setGreen && g.setGreen(race.phase === 'racing' && race.time < 4);
        }
      });
    }
    for (const side of [-1, 1]) {
      const p = track.surf(s0, side * g.legX, 0, new THREE.Vector3());
      circle(p.x, p.z, g.legR, p.y - 1, p.y + 16);
    }
  }
  const stands = [];
  function placeStand(t, side, length, roofColor) {
    const s = track.sampleAt(t);
    const front = HW + CURB + 5.5;
    const lat = side * front;
    const p = track.surf(s, lat, 0, new THREE.Vector3());
    const st = templeStand({ length, accent: roofColor, seed: stands.length + 1 }); // 돌 계단 관중석 (jungleStart.js)
    add(st.obj, p.x, p.y - 0.05, p.z, yawOf(s) + (side > 0 ? Math.PI : 0));
    const hd = st.halfDepth || 7;
    const c = track.surf(s, side * (front + hd), 0, new THREE.Vector3());
    for (let u = -length / 2; u <= length / 2; u += hd * 1.4) circle(c.x + s.tan.x * u, c.z + s.tan.z * u, hd + 0.5, p.y - 2, p.y + (st.height || 14));
    occupy(c.x, c.z, length / 2 + 6);
    stands.push({ st, c: c.clone() });
  }
  const tM = (m) => (((m / track.length) % 1) + 1) % 1;
  placeStand(tM(-45), -1, 60, '#2f8a3a');
  placeStand(tM(30), -1, 50, '#e8862a');
  placeStand(tM(-110), -1, 44, '#c0392b');
  animators.push((time, dt, car) => {
    for (const { st, c } of stands) {
      const d = car ? car.pos.distanceTo(c) : 999;
      st.excite = THREE.MathUtils.lerp(st.excite || 0, d < 90 ? 1 : 0.08, 1 - Math.exp(-4 * Math.max(dt, 0.001)));
      if (st.update) st.update(time, dt, st.excite);
    }
  });
  {
    const s = track.sampleAt(tM(-20));
    const p = track.surf(s, HW + CURB + 6, 0, new THREE.Vector3());
    const pb = A.pitBuilding({ length: 64 });
    rebrand(pb.obj);
    add(pb.obj, p.x, p.y - 0.05, p.z, yawOf(s) + Math.PI);
    anim(pb);
    const c = track.surf(s, HW + CURB + 14, 0, new THREE.Vector3());
    for (let u = -32; u <= 32; u += 8) circle(c.x + s.tan.x * u, c.z + s.tan.z * u, 9, p.y - 2, p.y + 16);
    occupy(c.x, c.z, 40);
  }
  for (let m = -140; m < 120; m += 20) {
    for (const side of [-1, 1]) {
      const { p, s } = beside(tM(m), side * (HW + CURB + 2.2));
      if (!free(p.x, p.z, 0.6)) continue;
      const fp = A.flagPole({ color: pick(['#2f8a3a', '#e8862a', '#ffcf3f', '#c0392b', '#19b3a6']) });
      add(fp.obj, p.x, p.y, p.z, R(0, 6));
      anim(fp);
      circle(p.x, p.z, 0.35, p.y, p.y + 10);
      void s;
    }
  }

  // ---------------------------------------------------------------- 돌 재질, 유적 도우미
  const stoneTex = stoneTexture('#9a917c');
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 });
  const stoneDark = new THREE.MeshStandardMaterial({ map: stoneTexture('#7d7666'), roughness: 0.95 });
  const mossMat = new THREE.MeshLambertMaterial({ color: '#4c7a30', flatShading: true });
  const goldMat = new THREE.MeshStandardMaterial({ color: '#e6b84a', metalness: 0.8, roughness: 0.3, emissive: '#5a3a00', emissiveIntensity: 0.4 });
  const runeGlow = new THREE.MeshBasicMaterial({ color: '#7dffd8' });
  const torchTex = glowTexture('rgba(255,230,170,1)', 'rgba(255,120,30,0.45)');
  const flames = [];
  function torch(x, y, z, size = 1) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * size, 0.24 * size, 2.6 * size, 6), new THREE.MeshLambertMaterial({ color: '#5a4030' }));
    post.position.set(x, y + 1.3 * size, z);
    group.add(post);
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: torchTex, color: '#ffa040', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.position.set(x, y + 2.9 * size, z);
    f.scale.set(1.6 * size, 2.2 * size, 1);
    group.add(f);
    flames.push({ f, size, ph: R(0, 6) });
  }
  animators.push((t) => {
    for (const fl of flames) fl.f.scale.set((1.6 + Math.sin(t * 9 + fl.ph) * 0.25) * fl.size, (2.2 + Math.sin(t * 7 + fl.ph * 2) * 0.4) * fl.size, 1);
  });

  /** 계단 피라미드 (장식, 도로에서 떨어진 곳). base = 한 변, tiers = 층 수 */
  function stepPyramid(x, y, z, base, tiers, yaw = 0, { shrine = true } = {}) {
    const g = new THREE.Group();
    const th = base * 0.09;
    for (let k = 0; k < tiers; k++) {
      const w = base * (1 - (k / tiers) * 0.75);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, th, w), k % 2 ? stoneDark : stoneMat);
      b.position.y = th * (k + 0.5);
      b.castShadow = b.receiveShadow = true;
      g.add(b);
    }
    // 앞 계단
    const stairW = base * 0.16;
    const stair = new THREE.Mesh(new THREE.BoxGeometry(stairW, th * tiers, base * 0.5), stoneDark);
    stair.position.set(0, (th * tiers) / 2 - th * 0.3, base * 0.38);
    stair.rotation.x = -0.62;
    g.add(stair);
    if (shrine) {
      const top = base * 0.25;
      const sh = new THREE.Mesh(new THREE.BoxGeometry(top * 0.8, top * 0.6, top * 0.8), stoneMat);
      sh.position.y = th * tiers + top * 0.3;
      sh.castShadow = true;
      g.add(sh);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(top * 0.65, top * 0.5, 4), stoneDark);
      roof.position.y = th * tiers + top * 0.85;
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(top * 0.25, top * 0.35), new THREE.MeshBasicMaterial({ color: '#1a120a' }));
      door.position.set(0, th * tiers + top * 0.2, top * 0.401);
      g.add(door);
    }
    // 이끼 덩어리
    for (let i = 0; i < tiers * 3; i++) {
      const k = Math.floor(rand() * tiers);
      const w = base * (1 - (k / tiers) * 0.75);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(R(0.8, 2.2) * base * 0.02 + 0.6, 0), mossMat);
      const side = Math.floor(rand() * 4);
      const u = R(-0.45, 0.45) * w;
      const pos = [[u, w / 2], [u, -w / 2], [w / 2, u], [-w / 2, u]][side];
      m.position.set(pos[0], th * (k + 1), pos[1]);
      g.add(m);
    }
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    group.add(g);
    circle(x, z, base * 0.55, y - 2, y + th * tiers + 5);
    occupy(x, z, base * 0.72);
    return g;
  }
  /** 큰 석상 머리 (올멕 두상 느낌) */
  function stoneHead(x, y, z, size, yaw) {
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), stoneMat);
    head.scale.set(1, 1.15, 0.95);
    head.position.y = size * 1.05;
    head.castShadow = true;
    g.add(head);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(size * 1.02, 10, 6, 0, TAU, 0, 1.2), stoneDark);
    helm.position.y = size * 1.15;
    g.add(helm);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(size * 0.3, size * 0.12, size * 0.1), new THREE.MeshBasicMaterial({ color: '#2a2018' }));
      eye.position.set(sx * size * 0.33, size * 1.2, size * 0.9);
      g.add(eye);
    }
    const nose = new THREE.Mesh(new THREE.BoxGeometry(size * 0.3, size * 0.35, size * 0.3), stoneMat);
    nose.position.set(0, size * 0.95, size * 0.95);
    g.add(nose);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(size * 0.5, size * 0.1, size * 0.1), new THREE.MeshBasicMaterial({ color: '#3a2a1e' }));
    mouth.position.set(0, size * 0.62, size * 0.92);
    g.add(mouth);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 0.5, 0), mossMat);
    m.position.set(size * 0.5, size * 2, -size * 0.2);
    g.add(m);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    group.add(g);
    circle(x, z, size * 1.05, y - 1, y + size * 2.3);
    occupy(x, z, size * 1.4);
  }
  /** 돌기둥 (부서진 것 포함) */
  const columns = [];
  function column(x, y, z, h, broken) {
    columns.push({ x, y: y + h / 2, z, s: 1, sy: h, ry: R(0, TAU), broken });
    circle(x, z, 1.1, y - 1, y + h);
    occupy(x, z, 2);
  }

  // ---------------------------------------------------------------- 사원 문 아치 (T1 앞) + 다른 아치들
  function stoneArch(t, text) {
    const s = track.sampleAt(t);
    const half = HW + CURB + 3.5;
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(3, 12, 3), stoneMat);
      pillar.position.set(sx * (half + 1.5), 6, 0);
      pillar.castShadow = true;
      g.add(pillar);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 4), stoneDark);
      cap.position.set(sx * (half + 1.5), 12.4, 0);
      g.add(cap);
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), stoneDark);
      head.position.set(sx * (half + 1.5), 14.2, 0);
      head.rotation.y = Math.PI / 4;
      g.add(head);
      for (let k = 0; k < 3; k++) {
        const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), runeGlow);
        rune.position.set(sx * (half + 1.5), 3 + k * 3, 1.51);
        g.add(rune);
      }
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * half + 6, 2.6, 3.2), stoneMat);
    beam.position.y = 14.2;
    beam.castShadow = true;
    g.add(beam);
    const tex = canvasTexture(1024, 128, (c, w, h) => {
      c.fillStyle = '#5e5646';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffd25a';
      c.font = '900 84px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, w / 2, h / 2 + 4);
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(2 * half, 2.2), new THREE.MeshBasicMaterial({ map: tex }));
    for (const dz of [-1.62, 1.62]) {
      const pl = plate.clone();
      pl.position.set(0, 14.2, dz);
      if (dz < 0) pl.rotation.y = Math.PI;
      g.add(pl);
    }
    // 덩굴
    for (let k = 0; k < 10; k++) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, R(2, 6), 3), mossMat);
      v.position.set(R(-half, half), 12.5 - R(0, 2), R(-1.4, 1.4));
      g.add(v);
    }
    add(g, s.pos.x, s.pos.y, s.pos.z, yawOf(s));
    for (const sx of [-1, 1]) {
      const p = track.surf(s, sx * (half + 1.5), 0, new THREE.Vector3());
      circle(p.x, p.z, 2.2, p.y - 1, p.y + 15);
      torch(p.x + s.tan.x * 3, p.y, p.z + s.tan.z * 3, 1.2);
    }
  }
  stoneArch(mt('t1', -95), 'TEMPLE GATE');
  stoneArch(mt('float', -20), '저중력 · FLOATING STONES');
  stoneArch(mt('gorge', -40), 'GORGE BRIDGE');

  let templeTrap = null;
  // ---------------------------------------------------------------- 태양의 대피라미드 (사원 광장 끝, 도로가 속을 지나 포털 A로)
  if (track.dimension) {
    const sP = track.sampleAt(track.dimension.t0);
    const yaw = yawOf(sP);
    const TW = HW + CURB + 2.4; // 터널 반폭
    const TH = 12; // 터널 높이
    const L0 = 62, L1 = 2; // 포털 앞 62 m ~ 뒤 2 m
    const cen = sP.pos.clone().addScaledVector(sP.tan, -(L0 - L1) / 2);
    const g = new THREE.Group();
    const tiers = 6, th = 6.5;
    const depth = L0 + L1;
    for (let k = 0; k < tiers; k++) {
      const hw = 46 - k * 6.2; // 옆 반폭
      const hd = depth / 2 + 10 - k * 4.5; // 앞뒤 반길이
      const y0 = k * th - 2;
      const mat = k % 2 ? stoneDark : stoneMat;
      if (y0 + th <= TH) {
        // 터널 옆 두 덩어리
        for (const sx of [-1, 1]) {
          const w = hw - TW;
          const b = new THREE.Mesh(new THREE.BoxGeometry(w, th, hd * 2), mat);
          b.position.set(sx * (TW + w / 2), y0 + th / 2, 0);
          b.castShadow = b.receiveShadow = true;
          g.add(b);
        }
      } else {
        const b = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, th, hd * 2), mat);
        b.position.set(0, y0 + th / 2, 0);
        b.castShadow = b.receiveShadow = true;
        g.add(b);
      }
      // 층 위 이끼·덩굴
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(R(1, 2.4), 0), mossMat);
        const side = Math.floor(rand() * 4);
        const u = R(-0.9, 0.9);
        const pos = [[u * hw, hd], [u * hw, -hd], [hw, u * hd], [-hw, u * hd]][side];
        if (Math.abs(pos[0]) < TW + 2 && y0 < TH) continue;
        m.position.set(pos[0], y0 + th, pos[1]);
        g.add(m);
      }
    }
    // 터널 위 들보 (입구 쪽 얼굴 장식)
    const face = new THREE.Mesh(new THREE.BoxGeometry(TW * 2 + 2, TH - 2 * th + 2 + 4, 2), stoneDark);
    face.position.set(0, TH - 1, depth / 2 + 10.5);
    g.add(face);
    const sunDisk = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 1, 20), goldMat);
    sunDisk.rotation.x = Math.PI / 2;
    sunDisk.position.set(0, TH + 7, depth / 2 + 6);
    g.add(sunDisk);
    // 꼭대기 사당 + 금빛 지붕
    const topY = tiers * th - 2;
    const shrine = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 14), stoneMat);
    shrine.position.y = topY + 4;
    g.add(shrine);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 7, 4), goldMat);
    roof.position.y = topY + 11.5;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,240,180,1)', 'rgba(255,170,40,0.45)'), color: '#ffc040', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    beacon.position.y = topY + 17;
    beacon.scale.setScalar(22);
    g.add(beacon);
    animators.push((t) => (beacon.material.opacity = 0.6 + 0.3 * Math.sin(t * 2.2)));
    // 옆면 큰 계단 (양쪽)
    for (const sx of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(12, tiers * th * 1.25, 3), stoneDark);
      st.position.set(sx * 30, tiers * th * 0.45, 0);
      st.rotation.z = sx * 0.85;
      st.rotation.y = Math.PI / 2;
      g.add(st);
    }
    g.position.copy(cen);
    g.position.y = sP.pos.y;
    g.rotation.y = yaw;
    group.add(g);
    // 터널 안 횃불 + 벽 충돌체
    const back = sP.pos;
    for (let d = -L0; d <= L1; d += 3) {
      for (const sx of [-1, 1]) {
        const p = back.clone().addScaledVector(sP.tan, d).addScaledVector(sP.right, sx * (TW + 1.6));
        circle(p.x, p.z, 1.6, sP.pos.y - 3, sP.pos.y + 30);
      }
    }
    for (let d = -L0 + 6; d < -4; d += 12)
      for (const sx of [-1, 1]) {
        const p = back.clone().addScaledVector(sP.tan, d).addScaledVector(sP.right, sx * (TW - 0.5));
        torch(p.x, sP.pos.y, p.z, 1.3);
      }
    // 피라미드 몸통 (터널 밖) 큰 충돌체
    for (const sx of [-1, 1])
      for (let d = -L0 - 6; d <= L1; d += 14) {
        const p = back.clone().addScaledVector(sP.tan, d).addScaledVector(sP.right, sx * (TW + 16));
        circle(p.x, p.z, 13, sP.pos.y - 3, sP.pos.y + 40);
      }
    occupy(cen.x, cen.z, 60);
    // 사원 함정: 터널 입구 돌문이 차가 다가오면 쿠구궁 내려옴 (보이기만, jungleTrap.js)
    const trap = buildTempleGate(track, group, { sP, d: -L0 - 8, TW, top: 11, stoneMat: stoneDark, goldMat });
    animators.push((t, dt, car) => trap.update(t, dt, car));
    templeTrap = trap;
    // 광장 앞 석상 머리 두 개 + 횃불 길
    for (const sx of [-1, 1]) {
      const p = back.clone().addScaledVector(sP.tan, -L0 - 30).addScaledVector(sP.right, sx * (HW + CURB + 12));
      const y = landY(p.x, p.z, 1);
      if (y !== null) stoneHead(p.x, y, p.z, 3.4, yaw + Math.PI + sx * 0.5);
    }
  }

  // ---------------------------------------------------------------- 길가 유적 (석상, 기둥, 비석, 작은 피라미드)
  const stelae = [];
  {
    // 큰 계단 피라미드: 언덕 위·안쪽 땅 (멀리서 보이는 랜드마크)
    const bigSpots = [[60, 380, 44, 7], [-70, 190, 30, 5], [330, 160, 34, 6], [-120, -110, 30, 5], [70, 610, 26, 5]];
    for (const [x, z, base, tiers] of bigSpots) {
      const y = landY(x, z, 8);
      if (y === null || roadD(x, z) < HW + base) continue;
      stepPyramid(x, y - 1, z, base, tiers, R(0, TAU));
    }
    // 길가 석상·기둥·비석: 코스를 따라 일정 간격
    const N = track.samples.length - 1;
    for (let m = 60; m < track.length; m += 55) {
      const s = track.samples[Math.floor((m / track.length) * N)];
      if (s.space || s.bridge) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const d = HW + CURB + R(7, 16);
      const p = track.surf(s, side * d, 0, new THREE.Vector3());
      const y = landY(p.x, p.z, 4);
      if (y === null || !free(p.x, p.z, 3) || roadD(p.x, p.z) < HW + CURB + 6 || onApron(p.x, p.z)) continue;
      const r = rand();
      if (r < 0.3) column(p.x, y, p.z, R(4, 9), rand() < 0.5);
      else if (r < 0.55) {
        stelae.push({ x: p.x, y: y + 2.5, z: p.z, s: 1, ry: yawOf(s) + R(-0.3, 0.3) });
        circle(p.x, p.z, 1.2, y - 1, y + 5);
        occupy(p.x, p.z, 2);
      } else if (r < 0.7) stoneHead(p.x, y, p.z, R(1.6, 2.6), Math.atan2(s.pos.x - p.x, s.pos.z - p.z));
      else {
        // 기둥 줄 (무너진 회랑)
        const along = s.tan.clone();
        for (let k = 0; k < 4; k++) {
          const q = p.clone().addScaledVector(along, k * 6).addScaledVector(s.right, side * 4);
          const yy = landY(q.x, q.z, 3);
          if (yy === null || !free(q.x, q.z, 1.5) || roadD(q.x, q.z) < HW + CURB + 6) continue;
          column(q.x, yy, q.z, k % 2 ? R(2, 4) : R(6, 9), false);
        }
      }
    }
    const colGeo = new THREE.CylinderGeometry(0.9, 1.05, 1, 10);
    instanced(colGeo, stoneMat, columns.map((c) => ({ ...c, sx: 1, sz: 1 })), { shadow: true, name: 'columns' });
    // 기둥 머리 장식
    instanced(new THREE.BoxGeometry(2.4, 0.6, 2.4), stoneDark, columns.filter((c) => !c.broken).map((c) => ({ x: c.x, y: c.y + c.sy / 2 + 0.3, z: c.z, s: 1, ry: c.ry })), { name: 'columnCaps' });
    // 비석 (조각 무늬 텍스처)
    const stelaTex = canvasTexture(64, 128, (g, w, h) => {
      g.fillStyle = '#8f8772';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#5a5244';
      g.lineWidth = 3;
      for (let y = 10; y < h - 10; y += 22) {
        g.strokeRect(10, y, w - 20, 16);
        g.beginPath();
        g.arc(w / 2, y + 8, 5, 0, TAU);
        g.stroke();
      }
    });
    instanced(new THREE.BoxGeometry(1.6, 5, 0.6), new THREE.MeshStandardMaterial({ map: stelaTex, roughness: 0.95 }), stelae, { shadow: true, name: 'stelae' });
  }

  // ---------------------------------------------------------------- 협곡: 강, 폭포, 밧줄 다리
  const holes = track.islands.flatMap((i) => i.holes);
  const gorge = holes.filter((h) => h.r < 100); // 큰 원은 동쪽 절벽 (지하 세계 쪽)
  const RIVER_Y = FLOOR_Y + 3.5;
  const waterTex = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#2f7f7a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(220,255,250,${0.1 + Math.random() * 0.25})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 10, 1 + Math.random() * 2);
    }
  });
  waterTex.repeat.set(2, 12);
  if (gorge.length > 1) {
    // 구멍 중심을 이은 강 리본
    const pts = gorge.map((h) => new THREE.Vector3(h.x, RIVER_Y, h.z));
    const first = pts[0].clone().add(pts[0].clone().sub(pts[1]).setLength(30));
    const last = pts[pts.length - 1].clone().add(pts[pts.length - 1].clone().sub(pts[pts.length - 2]).setLength(60));
    const curve = new THREE.CatmullRomCurve3([first, ...pts, last]);
    const n = 80;
    const P = [], UV = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = curve.getPointAt(u), tg = curve.getTangentAt(u);
      const rt = new THREE.Vector3(-tg.z, 0, tg.x).normalize();
      const k = Math.min(gorge.length - 1, Math.floor(u * gorge.length));
      const wdt = gorge[k].r * 1.4 + 10;
      for (const sd of [-1, 1]) {
        P.push(p.x + rt.x * sd * wdt, RIVER_Y, p.z + rt.z * sd * wdt);
        UV.push(sd > 0 ? 1 : 0, u * 12);
      }
      if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: waterTex, roughness: 0.25, metalness: 0.1, color: '#9fe6dc', side: THREE.DoubleSide }));
    group.add(water);
    // 빠른 물살 거품 (위에 한 겹 더, 더 빨리 흐름) → 물이 흐르는 게 잘 보임
    const foamTex = canvasTexture(128, 256, (g, w, h) => {
      for (let i = 0; i < 140; i++) {
        const x = Math.random() * w, y = Math.random() * h, l = 16 + Math.random() * 50;
        const gr = g.createLinearGradient(0, y, 0, y + l);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(0.5, `rgba(240,255,255,${0.35 + Math.random() * 0.4})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x, y, 3 + Math.random() * 7, l);
      }
    });
    foamTex.repeat.set(3, 16);
    const foam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    foam.position.y = 0.06;
    foam.renderOrder = 1;
    group.add(foam);
    // 떠내려가는 통나무·잎 (강을 따라 흐르다 끝에서 다시 위로)
    const NL = 26;
    const logGeo = new THREE.CylinderGeometry(0.5, 0.55, 5, 6).rotateZ(Math.PI / 2);
    const leafGeo = new THREE.CircleGeometry(0.9, 6).rotateX(-Math.PI / 2);
    const logs = new THREE.InstancedMesh(logGeo, new THREE.MeshLambertMaterial({ color: '#6b4a2a', flatShading: true }), NL);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: '#4f9a35', side: THREE.DoubleSide }), NL);
    for (const im of [logs, leaves]) (im.frustumCulled = false), group.add(im);
    const floaters = Array.from({ length: NL }, () => ({ u: rand(), lat: R(-0.6, 0.6), sp: R(0.012, 0.02), ph: R(0, TAU), rot: R(0, TAU) }));
    // 강 속 바위 + 둘레 흰 물보라
    const foamRing = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,0.9)', 'rgba(220,255,250,0.35)'), transparent: true, depthWrite: false });
    const rocksIn = [];
    for (let i = 0; i < 14; i++) {
      const u = (i + 0.5) / 14;
      const p = curve.getPointAt(u), tg = curve.getTangentAt(u);
      const k = Math.min(gorge.length - 1, Math.floor(u * gorge.length));
      const off = R(-0.7, 0.7) * (gorge[k].r * 1.4 + 6);
      const x = p.x - tg.z * off, z = p.z + tg.x * off;
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(R(1.5, 3.5), 0), stoneDark);
      rk.position.set(x, RIVER_Y + 0.3, z);
      rk.rotation.set(R(0, 3), R(0, 3), 0);
      group.add(rk);
      const sp = new THREE.Sprite(foamRing);
      sp.position.set(x, RIVER_Y + 0.4, z);
      sp.scale.set(9, 2.5, 1);
      group.add(sp);
      rocksIn.push({ sp, ph: R(0, TAU) });
    }
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    animators.push((t, dt) => {
      waterTex.offset.y = -t * 0.25;
      foamTex.offset.y = -t * 0.7;
      foamTex.offset.x = Math.sin(t * 0.3) * 0.05;
      floaters.forEach((f, i) => {
        f.u = (f.u + f.sp * Math.min(dt || 0, 0.05)) % 1;
        const p = curve.getPointAt(f.u), tg = curve.getTangentAt(f.u);
        const k = Math.min(gorge.length - 1, Math.floor(f.u * gorge.length));
        const off = f.lat * (gorge[k].r * 1.4 + 6);
        v4.set(p.x - tg.z * off, RIVER_Y + 0.25 + Math.sin(t * 2 + f.ph) * 0.12, p.z + tg.x * off);
        e4.set(Math.sin(t * 1.3 + f.ph) * 0.08, Math.atan2(tg.x, tg.z) + f.rot + t * 0.2, 0);
        m4.compose(v4, q4.setFromEuler(e4), one);
        (i % 2 ? leaves : logs).setMatrixAt(i, m4);
        // 안 쓰는 쪽은 숨김 (크기 0)
        (i % 2 ? logs : leaves).setMatrixAt(i, m4.makeScale(0, 0, 0));
      });
      logs.instanceMatrix.needsUpdate = leaves.instanceMatrix.needsUpdate = true;
      for (const r of rocksIn) r.sp.scale.set(9 + 1.5 * Math.sin(t * 6 + r.ph), 2.5 + 0.4 * Math.sin(t * 5 + r.ph), 1); // 물보라가 출렁
    });
  }
  // 폭포: 고원 가장자리(도로에서 보이는 곳)에서 아래로 떨어짐. 바깥 방향 = 땅 값이 줄어드는 쪽
  {
    const falls = [];
    const minGap = 170;
    const cands = [];
    for (const loop of track.loops) {
      for (let k = 0; k < loop.length; k += 3) {
        const p = loop[k];
        const d = roadD(p.x, p.z);
        if (d < 35 || d > 170) continue;
        cands.push({ p, d });
      }
    }
    // 협곡 북쪽 끝은 반드시 (강의 시작)
    if (gorge.length) {
      const h0 = gorge[0];
      const lip = new THREE.Vector3(h0.x, 0, h0.z - h0.r);
      const y = track.heightAt(lip.x, lip.z - 4);
      if (y !== null) falls.push({ x: lip.x, y: y + 0.3, z: lip.z + 1, yaw: 0, w: 16 });
    }
    cands.sort(() => rand() - 0.5);
    for (const c of cands) {
      if (falls.length >= 7) break;
      if (falls.some((f) => Math.hypot(f.x - c.p.x, f.z - c.p.z) < minGap)) continue;
      // 바깥 방향
      const e = 3;
      const gx = track.fieldAt(c.p.x + e, c.p.z) - track.fieldAt(c.p.x - e, c.p.z);
      const gz = track.fieldAt(c.p.x, c.p.z + e) - track.fieldAt(c.p.x, c.p.z - e);
      const yaw = Math.atan2(-gx, -gz); // 로컬 +z = 바깥
      falls.push({ x: c.p.x, y: c.p.y + 0.2, z: c.p.z, yaw, w: R(9, 16) });
    }
    for (const [i, f] of falls.entries()) {
      const H = Math.max(10, f.y - FLOOR_Y);
      const wf = waterfall({ width: f.w, height: H, seed: 30 + i });
      add(wf.obj, f.x, f.y, f.z, f.yaw);
      anim(wf);
      // 위쪽 물길 (땅 위 짧은 시내)
      const stream = new THREE.Mesh(new THREE.PlaneGeometry(f.w * 0.8, 26), new THREE.MeshStandardMaterial({ map: waterTex, color: '#a8efe6', roughness: 0.2 }));
      stream.rotation.x = -Math.PI / 2;
      const back = new THREE.Vector3(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
      stream.position.set(f.x + back.x * 13, f.y + 0.15, f.z + back.z * 13);
      stream.rotation.z = f.yaw;
      const sy = landY(stream.position.x, stream.position.z, 0);
      if (sy !== null && Math.abs(sy - f.y) < 3 && roadD(stream.position.x, stream.position.z) > HW + 8) {
        stream.position.y = sy + 0.12;
        group.add(stream);
      }
    }
  }
  // 밧줄 다리: 양 끝 나무 탑 + 큰 밧줄 + 매다는 줄 + 색 깃발
  for (const br of track.bridgeRuns) {
    if (br.kind !== 'rope') continue;
    const list = track.spanList(br.a, br.b);
    const woodMat = new THREE.MeshLambertMaterial({ color: '#6b4528', flatShading: true });
    const ropeMat = new THREE.MeshLambertMaterial({ color: '#c9a66b' });
    const ends = [list[2], list[list.length - 3]];
    const tops = [];
    for (const s of ends) {
      for (const sx of [-1, 1]) {
        const p = track.surf(s, sx * (DECK + 1.6), 0, new THREE.Vector3());
        const tower = new THREE.Group();
        for (const dz of [-1.2, 1.2]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 13, 6), woodMat);
          leg.position.set(0, 6.5, dz);
          leg.castShadow = true;
          tower.add(leg);
        }
        for (const y of [4, 8.5, 12.3]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 3.2), woodMat);
          bar.position.y = y;
          tower.add(bar);
        }
        const skull = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), stoneMat);
        skull.position.y = 13.4;
        tower.add(skull);
        add(tower, p.x, p.y - 1, p.z, yawOf(s));
        circle(p.x, p.z, 1.3, p.y - 3, p.y + 14);
        tops.push({ s, sx, p: p.clone().setY(p.y + 11.5) });
        torch(p.x + s.tan.x * (s === ends[0] ? -2.5 : 2.5), p.y, p.z + s.tan.z * (s === ends[0] ? -2.5 : 2.5), 1.1);
      }
    }
    const flagCols = ['#e8463a', '#ffcf3f', '#2fb5ff', '#3ccf4e', '#ff8a1f', '#c07cff'];
    const flagGeo = new THREE.PlaneGeometry(0.9, 1.2);
    const flagItems = [];
    for (const sx of [-1, 1]) {
      const a = tops.find((q) => q.sx === sx && q.s === ends[0]).p, b = tops.find((q) => q.sx === sx && q.s === ends[1]).p;
      const pts = [];
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const k = Math.round(2 + u * (list.length - 5));
        const deck = track.surf(list[k], sx * (DECK + 0.6), 0, new THREE.Vector3());
        const straight = a.clone().lerp(b, u);
        // 늘어진 밧줄: 가운데로 갈수록 상판 가까이 (최소 1.2 m 위)
        const sag = Math.sin(Math.PI * u);
        const y = THREE.MathUtils.lerp(straight.y, deck.y + 1.4, sag * 0.92);
        pts.push(new THREE.Vector3(deck.x, y, deck.z));
        if (i > 0 && i < n) {
          // 매다는 줄
          const hl = y - deck.y;
          const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, hl, 3), ropeMat);
          hanger.position.set(deck.x, deck.y + hl / 2, deck.z);
          group.add(hanger);
          if (i % 2 === 0) flagItems.push({ x: deck.x, y: y - 0.7, z: deck.z, s: 1, ry: yawOf(list[k]) + Math.PI / 2, color: flagCols[(i / 2 + (sx > 0 ? 3 : 0)) % flagCols.length] });
        }
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.12, 5), ropeMat);
      group.add(tube);
      // 탑 꼭대기에서 땅으로 내리는 고정 줄
      for (const [top, s, dir] of [[a, ends[0], -1], [b, ends[1], 1]]) {
        const anchor = top.clone().addScaledVector(s.tan, dir * 9);
        anchor.y = (landY(anchor.x, anchor.z, -5) ?? top.y - 12) + 0.2;
        const tb = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(top, anchor), 2, 0.1, 4), ropeMat);
        group.add(tb);
      }
    }
    const flagMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const flags = instanced(flagGeo, flagMat, flagItems, { name: 'prayerFlags' });
    if (flags) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      animators.push((t) => {
        flagItems.forEach((f, i) => {
          q.setFromEuler(e.set(Math.sin(t * 3 + i) * 0.35, f.ry, 0));
          m4.compose(tmpV.set(f.x, f.y, f.z), q, new THREE.Vector3(1, 1, 1));
          flags.setMatrixAt(i, m4);
        });
        flags.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // ---------------------------------------------------------------- 동굴 (서쪽 직선의 바위 동굴)
  {
    const iC = track.indexAt(mt('cave', 210));
    const iD = track.indexAt(mt('cave', 340));
    const list = track.spanList(iC, iD < iC ? iD + track.samples.length - 1 : iD);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#6a665a', roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const RAD = HW + CURB + 7.5;
    const N = 18;
    const P = [], idx = [];
    const v = new THREE.Vector3();
    const rows = [];
    for (let k = 0; k < list.length; k += 2) rows.push(list[k]);
    rows.forEach((s, r) => {
      // 입구·출구는 조금 넓게 (나팔 모양)
      const flare = 1 + 0.35 * Math.max(0, 1 - Math.min(r, rows.length - 1 - r) / 4);
      for (let k = 0; k <= N; k++) {
        const a = Math.PI * (-0.12 + 1.24 * (k / N));
        const rr = RAD * flare * (1 + 0.14 * Math.sin(k * 2.7 + r * 0.9) + 0.07 * Math.sin(r * 2.3 + k * 1.3));
        track.surf(s, Math.cos(a) * rr, Math.sin(a) * rr * 0.75 + 0.5, v);
        P.push(v.x, v.y, v.z);
        if (r < rows.length - 1 && k < N) {
          const a0 = r * (N + 1) + k;
          idx.push(a0, a0 + N + 1, a0 + 1, a0 + 1, a0 + N + 1, a0 + N + 2);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const cave = new THREE.Mesh(geo, rockMat);
    cave.castShadow = true;
    cave.receiveShadow = true;
    group.add(cave);
    // 이끼 덮인 바깥 (동굴 위 언덕처럼 보이게 큰 바위 덩어리)
    const lumps = [];
    for (let r = 0; r < rows.length; r += 2) {
      const s = rows[r];
      for (const sx of [-1, 1]) {
        const p = track.surf(s, sx * R(RAD * 0.6, RAD * 1.1), RAD * R(0.5, 0.75), new THREE.Vector3());
        lumps.push({ x: p.x, y: p.y, z: p.z, s: R(5, 9), sy: R(3, 6), ry: R(0, TAU) });
      }
    }
    instanced(plants.rock, plantMat, lumps, { shadow: true, name: 'caveLumps' });
    // 벽 충돌체
    for (const s of rows)
      for (const sx of [-1, 1]) {
        const p = track.surf(s, sx * (HW + CURB + 6.5), 0, new THREE.Vector3());
        circle(p.x, p.z, 1.8, p.y - 2, p.y + 14);
      }
    // 종유석 + 빛나는 버섯/수정
    const stal = [], glowItems = [];
    for (let r = 1; r < rows.length - 1; r++) {
      const s = rows[r];
      for (let k = 0; k < 2; k++) {
        const l = R(-RAD * 0.7, RAD * 0.7);
        const top = RAD * 0.75 * Math.sqrt(Math.max(0, 1 - (l / RAD) ** 2)) + 0.3;
        if (top < 7) continue;
        const p = track.surf(s, l, top, new THREE.Vector3());
        stal.push({ x: p.x, y: p.y - 1.4, z: p.z, s: 1, sx: R(0.6, 1.2), sy: R(1.5, 3.2), sz: R(0.6, 1.2), ry: R(0, TAU) });
      }
      for (const sx of [-1, 1]) {
        if (rand() < 0.4) continue;
        const p = track.surf(s, sx * (HW + CURB + R(2.2, 3.4)), R(0.3, 2.5), new THREE.Vector3());
        glowItems.push({ x: p.x, y: p.y, z: p.z, s: R(0.4, 0.9), ry: R(0, TAU), color: rand() < 0.5 ? '#46e6d2' : '#c07cff' });
      }
    }
    const stalGeo = new THREE.ConeGeometry(1, 1, 5);
    stalGeo.rotateX(Math.PI);
    instanced(stalGeo, rockMat, stal, { name: 'stalactites' });
    instanced(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), glowItems, { name: 'caveCrystals' });
    // 동굴 안 빛무리
    const gTex = glowTexture('rgba(160,255,240,1)', 'rgba(90,200,255,0.35)');
    for (let r = 2; r < rows.length - 1; r += 5) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: r % 2 ? '#7dffe0' : '#c9a0ff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      track.surf(rows[r], (r % 2 ? 1 : -1) * (HW + CURB + 2), 2, sp.position);
      sp.scale.setScalar(9);
      group.add(sp);
    }
    // 동굴 입구 표지
    for (const s of [rows[0]]) {
      for (const sx of [-1, 1]) {
        const p = track.surf(s, sx * (HW + CURB + 6), 0, new THREE.Vector3()).addScaledVector(s.tan, -6);
        torch(p.x, p.y, p.z, 1.3);
      }
    }
  }

  // ---------------------------------------------------------------- 저중력 구역: 빛나는 룬 기둥 + 위로 오르는 빛 알갱이
  for (const z of track.gravZones || []) {
    for (const [t, k] of [[z.t0, 0], [z.t1, 1]]) {
      const s = track.sampleAt(t);
      for (const sx of [-1, 1]) {
        const p = track.surf(s, sx * (HW + CURB + 3.5), 0, new THREE.Vector3());
        const ob = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 1.6), stoneDark);
        ob.position.set(p.x, p.y + 4.5, p.z);
        ob.rotation.y = yawOf(s);
        ob.castShadow = true;
        group.add(ob);
        for (let i = 0; i < 4; i++) {
          const rr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), runeGlow);
          rr.position.set(0, -3 + i * 2, 0.81);
          ob.add(rr);
          const rr2 = rr.clone();
          rr2.position.z = -0.81;
          rr2.rotation.y = Math.PI;
          ob.add(rr2);
        }
        circle(p.x, p.z, 1.2, p.y - 1, p.y + 9);
        void k;
      }
    }
    // 빛 알갱이 (구역 위로 천천히 떠오름)
    const N = 260;
    const pos = new Float32Array(N * 3);
    const base = [];
    for (let i = 0; i < N; i++) {
      const q = z.pts[Math.floor(rand() * z.pts.length)];
      base.push({ x: q.x + R(-22, 22), y: q.y + R(-1, 2), z: q.z + R(-22, 22), sp: R(0.8, 2.2), ph: R(0, 20) });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: '#8dffe0', size: 0.45, map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false;
    group.add(pts);
    animators.push((t) => {
      base.forEach((b, i) => {
        const k = (t * b.sp * 0.1 + b.ph) % 12;
        pos[i * 3] = b.x + Math.sin(t + b.ph) * 0.8;
        pos[i * 3 + 1] = b.y + k;
        pos[i * 3 + 2] = b.z + Math.cos(t * 0.8 + b.ph) * 0.8;
      });
      g.attributes.position.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- 정글 식물 (인스턴스)
  const treeOk = (x, z, margin) => roadD(x, z) > HW + CURB + margin && !onApron(x, z);
  const veg = { kapok: [], palm: [], bamboo: [], fern: [], bush: [], flower: [], rock: [] };
  const SOLID = { kapok: 1.4, palm: 0.5, bamboo: 1.2, rock: 1.2 };
  /** 도로 근처(dMin~dMax)에 type을 n개 */
  function scatterNear(type, n, dMin, dMax, sMin, sMax, margin) {
    const N = track.samples.length - 1;
    for (let k = 0, got = 0; k < n * 4 && got < n; k++) {
      const s = track.samples[Math.floor(rand() * N)];
      if (s.space) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const d = dMin + (dMax - dMin) * Math.pow(rand(), 1.3);
      const x = s.pos.x + s.right.x * side * d, z = s.pos.z + s.right.z * side * d;
      const y = landY(x, z, 2);
      if (y === null || !treeOk(x, z, margin) || !free(x, z, SOLID[type] || 0.3)) continue;
      const sc = R(sMin, sMax);
      veg[type].push({ x, y: y - 0.2, z, s: sc, ry: R(0, TAU) });
      got++;
    }
  }
  /** 땅 어디나 type을 n개 (먼 숲) */
  function scatterAll(type, n, sMin, sMax, margin) {
    for (let k = 0, got = 0; k < n * 4 && got < n; k++) {
      const x = lbC.x + R(-landR, landR), z = lbC.y + R(-landR, landR);
      const y = landY(x, z, 3);
      if (y === null || !treeOk(x, z, margin) || !free(x, z, SOLID[type] || 0.3)) continue;
      (veg[type + 'Far'] ||= []).push({ x, y: y - 0.2, z, s: R(sMin, sMax), ry: R(0, TAU) });
      got++;
    }
  }
  scatterNear('kapok', 320, HW + 9, 70, 0.75, 1.25, 7);
  scatterNear('palm', 260, HW + 6, 45, 0.85, 1.3, 5);
  scatterNear('bamboo', 90, HW + 8, 40, 0.8, 1.2, 6);
  scatterNear('fern', 1500, HW + 2.5, 40, 0.8, 1.6, 2.2);
  scatterNear('bush', 900, HW + 3, 50, 0.8, 1.7, 3);
  scatterNear('flower', 700, HW + 2, 22, 0.8, 1.4, 1.8);
  scatterNear('rock', 140, HW + 5, 40, 0.6, 1.6, 4);
  scatterAll('kapok', 320, 1.0, 1.5, 20);
  scatterAll('palm', 180, 0.9, 1.3, 20);
  scatterAll('bush', 500, 1, 2, 10);
  const flowerCols = ['#ff4f6a', '#ffcf3f', '#c07cff', '#ff8a1f', '#ffffff', '#ff5fa2'];
  for (const f of veg.flower) f.color = pick(flowerCols);
  // 가까운 것만 자세한 모양 (LOD). 고사리·꽃은 작아서 멀면 안 그림
  instancedLOD(plants.kapok, plants.kapokLo, plantMat, veg.kapok.concat(veg.kapokFar || []), { near: 190, shadow: true, name: 'kapok' });
  instancedLOD(plants.palm, plants.palmLo, plantMat2, veg.palm.concat(veg.palmFar || []), { near: 150, shadow: true, name: 'palm' });
  instancedLOD(plants.bamboo, plants.bambooLo, plantMat, veg.bamboo, { near: 140, shadow: true, name: 'bamboo' });
  instancedLOD(plants.fern, null, plantMat2, veg.fern, { near: 140, name: 'fern' });
  instancedLOD(plants.bush, plants.bushLo, plantMat, veg.bush.concat(veg.bushFar || []), { near: 150, far: 700, name: 'bush' });
  instancedLOD(plants.flower, null, plantMat, veg.flower, { near: 110, name: 'flower' });
  instanced(plants.rock, plantMat, veg.rock, { shadow: true, name: 'rock' });
  {
    const s0 = track.sampleAt(0);
    updateLOD(s0.pos.x, s0.pos.z, true);
  }
  // 도로 가까운 단단한 것만 충돌체 (멀리 있는 것은 차가 닿을 일이 없음)
  for (const type of ['kapok', 'palm', 'bamboo', 'rock'])
    for (const it of veg[type]) if (roadD(it.x, it.z) < 60) circle(it.x, it.z, SOLID[type] * it.s, it.y - 1, it.y + 18 * it.s);

  // ---------------------------------------------------------------- 반딧불 (카메라 주변, 셰이더로 깜빡임)
  const fireflies = (() => {
    const N = 700, BOX = 90;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) pos.set([R(-BOX, BOX), R(0, 1), R(-BOX, BOX)], i * 3), (seed[i] = rand());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uMap: { value: glowTexture('rgba(255,255,200,1)', 'rgba(200,255,120,0.45)') }, uBox: { value: BOX } },
      vertexShader: /* glsl */ `
        uniform float uTime, uBox; uniform vec3 uCam; attribute float seed; varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.3 + seed * 40.0) * 4.0;
          p.z += cos(uTime * 0.25 + seed * 31.0) * 4.0;
          vec3 w = uCam + mod(p - uCam + uBox, 2.0 * uBox) - uBox;
          w.y = uCam.y - 4.0 + seed * 9.0 + sin(uTime * 0.6 + seed * 20.0) * 1.5;
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          vA = smoothstep(0.55, 1.0, sin(uTime * (1.0 + seed * 2.0) + seed * 60.0));
          gl_PointSize = (2.0 + seed * 2.0) * 260.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying float vA;
        void main() { vec4 c = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * c.rgb * 1.5, c.a * vA); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    group.add(p);
    return mat;
  })();

  // ---------------------------------------------------------------- 물안개 (협곡·골짜기 위에 낮게 깔림) + 햇살 줄기
  {
    const mistTex = glowTexture('rgba(255,255,255,0.75)', 'rgba(255,255,255,0.3)');
    const mists = [];
    const spots = [];
    for (const h of gorge) spots.push([h.x, RIVER_Y + R(4, 10), h.z, R(40, 70)]);
    for (let i = 0; i < 70; i++) {
      const s = track.samples[Math.floor(rand() * (track.samples.length - 1))];
      if (s.space) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const p = track.surf(s, side * R(HW + 15, 90), 0, new THREE.Vector3());
      const y = landY(p.x, p.z, 1);
      if (y === null) continue;
      spots.push([p.x, y + R(1.5, 4), p.z, R(30, 55)]);
    }
    for (const [x, y, z, size] of spots) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, color: '#eef6ea', transparent: true, opacity: 0.32, depthWrite: false }));
      sp.position.set(x, y, z);
      sp.scale.set(size, size * 0.35, 1);
      group.add(sp);
      mists.push({ sp, x, z, ph: R(0, 6) });
    }
    animators.push((t) => {
      for (const m of mists) {
        m.sp.position.x = m.x + Math.sin(t * 0.05 + m.ph) * 8;
        m.sp.position.z = m.z + Math.cos(t * 0.04 + m.ph) * 8;
        m.sp.material.opacity = 0.24 + 0.1 * Math.sin(t * 0.3 + m.ph);
      }
    });
    // 햇살 줄기 (숲 사이로 비스듬히 내리는 빛)
    const rayTex = canvasTexture(64, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, 'rgba(255,250,210,0)');
      grd.addColorStop(0.5, 'rgba(255,250,210,0.5)');
      grd.addColorStop(1, 'rgba(255,250,210,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      const fade = g.createLinearGradient(0, 0, 0, h);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(0.2, 'rgba(0,0,0,1)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = fade;
      g.fillRect(0, 0, w, h);
    });
    const rayMat = new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rays = [];
    for (let i = 0; i < 40; i++) {
      const s = track.samples[Math.floor(rand() * (track.samples.length - 1))];
      if (s.space || s.bridge) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const p = track.surf(s, side * R(HW + 6, 40), 0, new THREE.Vector3());
      const y = landY(p.x, p.z, 1);
      if (y === null) continue;
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(R(3, 7), 34), rayMat);
      ray.position.set(p.x - SUN_DIR.x * 8, y + 15, p.z - SUN_DIR.z * 8);
      ray.lookAt(ray.position.clone().add(new THREE.Vector3(SUN_DIR.z, 0, -SUN_DIR.x)));
      ray.rotateZ(-0.45);
      group.add(ray);
      rays.push(ray);
    }
    animators.push((t) => (rayMat.opacity = 0.26 + 0.08 * Math.sin(t * 0.4)));
  }

  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- 용암 지하 세계 (포털, 지하 풍경, 세계 전환)
  const under = buildUnderworld(track, scene, { jungleObjects: [group, skyGroup], jungleEnv: {
    bg: new THREE.Color(ENV.bg), fog: new THREE.Color(ENV.fog), near: ENV.near, far: ENV.far,
    hemiSky: new THREE.Color(ENV.hemiSky), hemiGround: new THREE.Color(ENV.hemiGround), hemiI: ENV.hemiI, sunC: new THREE.Color(ENV.sunC), sunI: ENV.sunI,
  } });
  if (under) {
    for (const p of under.portals) for (const f of p.feet) circle(f.x, f.z, 3.6, f.y - 2, f.y + 30);
    animators.push((t, dt, car) => under.update(t, dt, car));
  }
  animators.push((t) => {
    fireflies.uniforms.uTime.value = t;
    if (window.game && window.game.camera) fireflies.uniforms.uCam.value.copy(window.game.camera.position);
  });

  // ---------------------------------------------------------------- 차와 충돌
  function collideCar(car) {
    stamp++;
    const cx0 = Math.floor((car.pos.x - CAR_R) / CELL), cx1 = Math.floor((car.pos.x + CAR_R) / CELL);
    const cz0 = Math.floor((car.pos.z - CAR_R) / CELL), cz1 = Math.floor((car.pos.z + CAR_R) / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = grid.get(`${cx},${cz}`);
        if (!list) continue;
        for (const c of list) {
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (car.pos.y > c.y1 || car.pos.y < c.y0 - 1.5) continue;
          const dx = car.pos.x - c.x, dz = car.pos.z - c.z;
          const d = Math.hypot(dx, dz), min = c.r + CAR_R;
          if (d < min && d > 1e-4) car.applyPush(tmpV.set(dx / d, 0, dz / d), min - d);
        }
      }
  }

  return {
    colliders: allColliders,
    collideCar,
    addCollider: circle,
    collidersNear(x, z, r = 4) {
      return allColliders.filter((c) => Math.hypot(c.x - x, c.z - z) < r + c.r);
    },
    animate(time, dt, car) {
      for (const a of animators) a(time, dt, car);
    },
    space: under,
    under,
    get trap() {
      return templeTrap;
    },
    stats: { colliders: allColliders.length, veg: Object.fromEntries(Object.entries(veg).map(([k, v]) => [k, v.length])) },
  };
}
