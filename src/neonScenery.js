// 네온 시티 풍경: 비 내리는 밤의 사이버펑크 도시
//
//   - 밤 하늘·안개·달빛, 젖은 도로 반사 (네온 색 환경 지도 scene.environment)
//   - 빌딩 숲 (합친 메시 몇 개: 창문 불빛, 옥상 네온 테두리, 안테나 빨간 불)
//   - 네온 간판 (가로·세로, 일부 깜빡임), 큰 전광판 (광고가 지지직 바뀜), 홀로그램 (지구본·광고판·옥상 다이아몬드)
//   - 출발 스타디움: 관중석, 피트 건물, 네온 출발 게이트(F1 신호등), 서치라이트, 전광판
//   - 고가도로 기둥, 가로등 + 도로 위 빛 웅덩이, 하늘을 나는 차들, 비
//   - 메가타워: 자석 튜브가 관통하는 거대한 빌딩
//   - 글리치 차원은 neonGlitch.js (포털, 세계 전환, 글리치 풍경)
// 충돌: 도로 양옆이 모두 방호벽이라 풍경과 부딪힐 일이 없음 (collideCar는 비어 있음)
import * as THREE from 'three';
import { seededRandom, canvasTexture } from './neonTrack.js';
import { NEON, facadeTextures, signAtlas, signUV, SIGN_CELLS, quadBatch, hologramMaterial, adTexture, screenMaterial, createRain, neonGantry, glowTexture } from './neonAssets.js';
import { buildGlitch } from './neonGlitch.js';
import * as A from './gpAssets.js';

const UP = new THREE.Vector3(0, 1, 0);

export function buildNeonScenery(track, scene) {
  const t0 = performance.now();
  const rand = seededRandom(20261110);
  const R = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const W = track.width, HW = W / 2;
  const city = new THREE.Group();
  city.name = 'neonCity';
  city.userData.world = 'city';
  scene.add(city);
  const animators = [];
  const tmpV = new THREE.Vector3();
  const N = track.sampleCount;
  const samples = track.samples;

  // ---------------------------------------------------------------- 밤 환경
  scene.background = new THREE.Color('#090620');
  scene.fog = new THREE.Fog('#1a0f34', 140, 1250);
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  const sun = scene.children.find((o) => o.isDirectionalLight);
  if (hemi) hemi.color.set('#7a6ad8'), hemi.groundColor.set('#1c0d2a'), (hemi.intensity = 1.0);
  if (sun) sun.color.set('#a9b8ff'), (sun.intensity = 0.85);
  // 하늘 돔: 아래쪽은 도시 불빛에 물든 보라, 위는 짙은 남색 + 흐린 별
  {
    const tex = canvasTexture(16, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#04030f');
      gr.addColorStop(0.55, '#0c0828');
      gr.addColorStop(0.8, '#2a1248');
      gr.addColorStop(1, '#4a1c5a');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    tex.wrapS = THREE.ClampToEdgeWrapping;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -10;
    dome.name = 'nightDome';
    city.add(dome);
    animators.push(() => {
      const c = window.game && window.game.camera;
      if (c) dome.position.copy(c.position);
    });
    // 흐린 달
    const moon = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,250,240,1)', 'rgba(200,190,255,0.25)'), transparent: true, fog: false, depthWrite: false }));
    moon.position.set(-1400, 900, -1700);
    moon.lookAt(0, 0, 0);
    moon.scale.setScalar(3);
    dome.add(moon);
  }

  // ---------------------------------------------------------------- 도로에서 떨어진 자리 찾기
  // 도로 샘플 해시 (가까운 도로까지 수평 거리 - 그 지점의 벽 위치)
  const HASH = 40;
  const hash = new Map();
  const hk = (a, b) => (a + 4096) * 8192 + (b + 4096);
  for (let i = 0; i < N; i += 2) {
    const s = samples[i];
    const k = hk(Math.floor(s.pos.x / HASH), Math.floor(s.pos.z / HASH));
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(s);
  }
  /** (x, z)에서 가장 가까운 도로 벽까지 여유 거리 (음수 = 도로 안), 그 샘플 */
  function roadGap(x, z, reach = 120) {
    let best = Infinity, bs = null;
    const x0 = Math.floor((x - reach) / HASH), x1 = Math.floor((x + reach) / HASH), z0 = Math.floor((z - reach) / HASH), z1 = Math.floor((z + reach) / HASH);
    for (let a = x0; a <= x1; a++)
      for (let b = z0; b <= z1; b++) {
        const list = hash.get(hk(a, b));
        if (!list) continue;
        for (const s of list) {
          const d = Math.hypot(s.pos.x - x, s.pos.z - z) - Math.max(track.railLatOf(s, -1), track.railLatOf(s, 1));
          if (d < best) (best = d), (bs = s);
        }
      }
    return { gap: best, s: bs };
  }
  const occupied = [];
  const free = (x, z, r) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
  const occupy = (x, z, r) => occupied.push({ x, z, r });
  const tAt = (k) => (track.data.sections && track.data.sections[k]) || null;
  const midT = (k) => {
    const s = tAt(k);
    return s ? (s[0] + s[1]) / 2 : 0;
  };
  const sAtT = (t) => samples[Math.round(((((t % 1) + 1) % 1) * N)) % N];

  // ---------------------------------------------------------------- 출발 스타디움 (관중석, 피트, 게이트)
  const s0 = samples[0];
  const yaw0 = Math.atan2(s0.tan.x, s0.tan.z);
  {
    const g = neonGantry({ width: 2 * (HW + track.curb) + 2 });
    g.obj.position.copy(s0.pos);
    g.obj.rotation.y = yaw0;
    city.add(g.obj);
    animators.push((t) => {
      g.update(t);
      const race = window.game && window.game.race;
      if (!race) return;
      if (race.phase === 'countdown') {
        g.setLights(race.lights ?? 0);
        g.setGreen(false);
      } else {
        g.setLights(0);
        g.setGreen(race.phase === 'racing' && race.time < 4);
      }
    });
  }
  // 관중석: 출발 직선 양쪽 (gpAssets 관중석 재사용, 지붕은 네온색). 피트 건물, 조명탑, 대형 전광판
  const stands = [];
  const besideAt = (dm, side, extra) => {
    const t = ((dm / track.length) % 1 + 1) % 1;
    const s = sAtT(t);
    const p = track.surf(s, side * (track.railLatOf(s, side) + extra), 0, new THREE.Vector3());
    return { s, p, yaw: Math.atan2(s.tan.x, s.tan.z) };
  };
  const standCols = ['#ff2f8e', '#2ff3ff', '#b06cff', '#ffe23a'];
  for (const [dm, side, len] of [[-75, 1, 62], [-8, 1, 62], [59, 1, 62], [126, 1, 62], [193, 1, 62], [-65, -1, 56], [0, -1, 56], [230, -1, 60]]) {
    const { s, p } = besideAt(dm, side, 4.5);
    const st = A.grandstand({ length: len, roofColor: standCols[stands.length % standCols.length] });
    st.obj.position.set(p.x, p.y - 0.05, p.z);
    st.obj.rotation.y = Math.atan2(s.tan.x, s.tan.z) + (side > 0 ? Math.PI : 0);
    city.add(st.obj);
    stands.push(st);
    occupy(p.x, p.z, len / 2 + 6);
    animators.push((tt, dt) => st.update(tt, dt, 0.5));
  }
  // 피트 건물 (왼쪽)
  {
    const { p, yaw } = besideAt(120, -1, 5);
    const pb = A.pitBuilding({ length: 80 });
    pb.obj.position.set(p.x, p.y - 0.05, p.z);
    pb.obj.rotation.y = yaw;
    city.add(pb.obj);
    occupy(p.x, p.z, 45);
  }
  // 조명탑 (관중석 뒤, 하얀 투광등 판)
  {
    const towerMat = new THREE.MeshStandardMaterial({ color: '#2a2d3a', metalness: 0.7, roughness: 0.4 });
    const lampMat = new THREE.MeshBasicMaterial({ color: '#f4f8ff', toneMapped: false });
    const haloTex = glowTexture('rgba(220,235,255,0.9)', 'rgba(180,200,255,0.25)');
    for (const [dm, side] of [[-110, 1], [25, 1], [160, 1], [-100, -1], [60, -1], [270, -1]]) {
      const { p, yaw } = besideAt(dm, side, 24);
      const g = new THREE.Group();
      g.position.copy(p);
      g.rotation.y = yaw;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.2, 42, 8), towerMat);
      pole.position.y = 21;
      g.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 1), towerMat);
      head.position.set(0, 43, 0);
      head.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(head);
      const lamps = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 4.4), lampMat);
      lamps.position.set(-side * 0.55, 43, 0);
      lamps.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(lamps);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: '#cfe0ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.set(34, 22, 1);
      halo.position.set(-side * 1.5, 43, 0);
      g.add(halo);
      city.add(g);
    }
  }
  // 대형 전광판 2개 (스타디움)
  const stadiumScreens = [];
  {
    const ad0 = adTexture();
    for (const [dm, side] of [[30, 1], [175, -1]]) {
      const { p, s } = besideAt(dm, side, 30);
      const mat = screenMaterial(ad0.tex, ad0.count);
      mat.uniforms.uSeed.value = dm * 0.1;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(32, 14), mat);
      scr.position.set(p.x, p.y + 30, p.z);
      scr.lookAt(s.pos.x, p.y + 26, s.pos.z);
      city.add(scr);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(33.5, 15.5, 1.2), new THREE.MeshStandardMaterial({ color: '#16171f', metalness: 0.6, roughness: 0.4 }));
      frame.position.copy(scr.position).addScaledVector(new THREE.Vector3(s.pos.x - p.x, 0, s.pos.z - p.z).normalize(), -0.7);
      frame.quaternion.copy(scr.quaternion);
      city.add(frame);
      for (const sx of [-12, 12]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 24, 1.4), frame.material);
        leg.position.copy(frame.position);
        leg.position.y = p.y + 11;
        leg.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(scr.quaternion), sx);
        city.add(leg);
      }
      stadiumScreens.push(mat);
    }
    animators.push((t) => stadiumScreens.forEach((m) => (m.uniforms.uTime.value = t)));
  }

  // ---------------------------------------------------------------- 메가타워 (자석 튜브가 관통)
  const tube = track.tube;
  if (tube) {
    const core = tube.core;
    const sa = core[0], sb = core[core.length - 1];
    const mid = core[Math.floor(core.length / 2)];
    const dir = new THREE.Vector3().subVectors(sb.pos, sa.pos).setY(0);
    const len = dir.length() + 4;
    dir.normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const cx = (sa.pos.x + sb.pos.x) / 2, cz = (sa.pos.z + sb.pos.z) / 2;
    const yTop = Math.max(sa.pos.y, sb.pos.y) + tube.H + 2;
    const yBot = Math.min(sa.pos.y, sb.pos.y) - 2.2;
    const outer = tube.w2 + tube.R + 1.2; // 튜브 바깥 반폭
    const TW = 34; // 타워 옆 블록 폭
    const HT = 210;
    const fac = facadeTextures(0, 31);
    const towerMat = new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.glow, emissive: '#ffffff', emissiveIntensity: 1.1, metalness: 0.6, roughness: 0.25 });
    fac.map.repeat.set(3, 12);
    fac.glow.repeat.set(3, 12);
    const tower = new THREE.Group();
    tower.position.set(cx, 0, cz);
    tower.rotation.y = yaw;
    const box = (w, h, d, x, y, z, m = towerMat) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      tower.add(b);
      return b;
    };
    // 옆 블록 (튜브 양옆) — 로컬 x가 도로의 옆
    for (const sd of [-1, 1]) box(TW, HT, len, sd * (outer + TW / 2), HT / 2, 0);
    // 튜브 위 다리 블록, 튜브 아래 받침
    box(outer * 2, HT - yTop, len, 0, yTop + (HT - yTop) / 2, 0);
    if (yBot > 0.5) box(outer * 2, yBot, len, 0, yBot / 2, 0, new THREE.MeshStandardMaterial({ color: '#1c1e28', roughness: 0.7 }));
    // 꼭대기: 계단식 + 첨탑 + 네온 고리
    box(outer * 2 + TW * 1.4, 40, len * 0.7, 0, HT + 20, 0);
    box(outer * 1.6, 30, len * 0.4, 0, HT + 55, 0);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.2, 60, 8), new THREE.MeshStandardMaterial({ color: '#2a2d3a', metalness: 0.8, roughness: 0.3 }));
    spire.position.y = HT + 100;
    tower.add(spire);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ff2f8e', toneMapped: false });
    for (let k = 0; k < 3; k++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(outer + TW * 0.9 + k * 6, 0.6, 6, 64), k % 2 ? ringMat : new THREE.MeshBasicMaterial({ color: '#2ff3ff', toneMapped: false }));
      r.rotation.x = Math.PI / 2;
      r.position.y = HT + 2 + k * 14;
      tower.add(r);
      animators.push((t) => (r.rotation.z = t * (0.15 + k * 0.07) * (k % 2 ? -1 : 1)));
    }
    // 튜브 입구 테두리 (네온 문)
    const mouthMat = new THREE.MeshBasicMaterial({ color: '#2ff3ff', toneMapped: false });
    for (const [s, sg] of [[sa, -1], [sb, 1]]) {
      const local = new THREE.Vector3(s.pos.x - cx, 0, s.pos.z - cz).applyAxisAngle(UP, -yaw);
      const fz = local.z + sg * 0.3;
      box(outer * 2 + 2, 1.2, 0.8, 0, s.pos.y + tube.H + 1.2, fz, mouthMat);
      for (const sd of [-1, 1]) box(1.2, tube.H + 2, 0.8, sd * (outer + 0.6), s.pos.y + tube.H / 2, fz, mouthMat);
    }
    // 큰 세로 간판 "기믹 타워"
    const signTex = canvasTexture(256, 1024, (g, w, h) => {
      g.fillStyle = '#06030c';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ff2f8e';
      g.lineWidth = 10;
      g.shadowColor = '#ff2f8e';
      g.shadowBlur = 24;
      g.strokeRect(14, 14, w - 28, h - 28);
      g.font = '900 170px system-ui, "Malgun Gothic", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#2ff3ff';
      g.fillStyle = '#e8fbff';
      ['기', '믹', '타', '워'].forEach((c, k) => g.fillText(c, w / 2, 150 + k * 240));
    });
    signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping;
    for (const sd of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 56), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
      p.position.set(sd * (outer + TW + 0.3), 95, 0);
      p.rotation.y = (sd * Math.PI) / 2;
      tower.add(p);
    }
    city.add(tower);
    occupy(cx, cz, len / 2 + 10);
    // 튜브 안 빛 고리 (12 m마다, 튜브 단면을 따라 하늘색/분홍)
    const ringPts = [], ringCol = [];
    const cA = new THREE.Color('#2ff3ff'), cB = new THREE.Color('#ff2f8e');
    const stepK = Math.max(2, Math.round(12 / (track.length / N)));
    const v = new THREE.Vector3(), v2 = new THREE.Vector3();
    for (let k = 0, n = 0; k < core.length; k += stepK, n++) {
      const s = core[k];
      const prof = [];
      const { R: TR, H: TH, w2 } = tube;
      for (let j = 0; j <= 7; j++) {
        const a = -Math.PI / 2 + (Math.PI / 2) * (j / 7);
        prof.push([-(w2 + TR * Math.cos(a) - 0.12), TR + TR * Math.sin(a)]);
      }
      for (let j = 0; j <= 7; j++) {
        const a = (Math.PI / 2) * (j / 7);
        prof.push([-(w2 + TR * Math.cos(a) - 0.12), TH - TR + TR * Math.sin(a) - 0.12]);
      }
      const half = prof.slice();
      for (let j = half.length - 1; j >= 0; j--) prof.push([-half[j][0], half[j][1]]);
      const c = n % 2 ? cA : cB;
      for (let j = 0; j < prof.length - 1; j++) {
        track.surf(s, prof[j][0], prof[j][1], v);
        track.surf(s, prof[j + 1][0], prof[j + 1][1], v2);
        ringPts.push(v.x, v.y, v.z, v2.x, v2.y, v2.z);
        ringCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(ringCol, 3));
    const ringLines = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }));
    city.add(ringLines);
    void mid;
  }

  // ---------------------------------------------------------------- 광장 (빌딩을 세우지 않는 곳): 스타디움 앞, 클로버잎 고리 안
  const plazas = [];
  const plazaT = (t) => t > 0.955 || t < 0.045;
  {
    const loop = tAt('loop');
    if (loop) {
      let cx = 0, cz = 0, n = 0;
      for (let t = loop[0]; t < loop[1]; t += 0.002) {
        const q = sAtT(t);
        cx += q.pos.x;
        cz += q.pos.z;
        n++;
      }
      plazas.push({ x: cx / n, z: cz / n, r: 70 });
    }
  }

  // ---------------------------------------------------------------- 빌딩 숲 (합친 메시: 외벽 4종)
  const bb = track.bbox;
  const MARGIN = 420;
  const center = track.groundCenter;
  const halfDiag = Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y) / 2;
  const facades = [0, 1, 2, 3].map((k) => facadeTextures(k, k + 1));
  const facadeMats = facades.map((f, k) => new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.glow, emissive: '#ffffff', emissiveIntensity: 0.75, metalness: k === 0 ? 0.55 : 0.2, roughness: k === 0 ? 0.25 : 0.7 }));
  const roofMat = new THREE.MeshStandardMaterial({ color: '#15141c', roughness: 0.8 });
  const bGeo = facadeMats.map(() => ({ pos: [], uv: [], idx: [] }));
  const roofGeo = { pos: [], idx: [] };
  const edgeLines = [], edgeCols = [];
  const antennas = [], beacons = [];
  const buildings = []; // { x, z, w, d, h, yaw, near }
  function addBox(G, cx, cz, w, d, y0, y1, yaw, uOff, vOff) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const corner = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const P = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
    const lens = [w, d, w, d];
    let u = uOff;
    for (let f = 0; f < 4; f++) {
      const a = P[f], b = P[(f + 1) % 4];
      const base = G.pos.length / 3;
      G.pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
      const u1 = u + lens[f] / 16;
      G.uv.push(u, (y0 + vOff) / 16, u1, (y0 + vOff) / 16, u1, (y1 + vOff) / 16, u, (y1 + vOff) / 16);
      u = u1;
      G.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    // 지붕
    const rb = roofGeo.pos.length / 3;
    for (const p of P) roofGeo.pos.push(p[0], y1, p[1]);
    roofGeo.idx.push(rb, rb + 2, rb + 1, rb, rb + 3, rb + 2);
    return P;
  }
  const edgeColor = new THREE.Color();
  function addRoofEdge(P, y, color) {
    edgeColor.set(color);
    for (let f = 0; f < 4; f++) {
      const a = P[f], b = P[(f + 1) % 4];
      edgeLines.push(a[0], y, a[1], b[0], y, b[1]);
      edgeCols.push(edgeColor.r, edgeColor.g, edgeColor.b, edgeColor.r, edgeColor.g, edgeColor.b);
    }
  }
  {
    const SP = 30;
    const x0 = bb.min.x - MARGIN, x1 = bb.max.x + MARGIN, z0 = bb.min.y - MARGIN, z1 = bb.max.y + MARGIN;
    for (let gx = x0; gx < x1; gx += SP)
      for (let gz = z0; gz < z1; gz += SP) {
        if (rand() < 0.1) continue; // 광장·공터
        const w = R(12, 24), d = R(12, 24);
        const x = gx + R(-4, 4), z = gz + R(-4, 4);
        const r = Math.hypot(w, d) / 2;
        const { gap, s } = roadGap(x, z, 140);
        if (gap < r + 11) continue; // 벽 바깥 보도 + 골목 (너무 붙으면 답답함)
        if (!free(x, z, r)) continue;
        if (plazas.some((p2) => (p2.x - x) ** 2 + (p2.z - z) ** 2 < (p2.r + r) ** 2)) continue;
        if (s && plazaT(s.t) && gap < 110) continue; // 스타디움 앞은 넓게 비움
        const dc = Math.hypot(x - center.x, z - center.y) / (halfDiag + MARGIN);
        const tall = Math.max(0, 1 - dc);
        let h = 18 + Math.pow(rand(), 2.2) * 170 * (0.35 + tall) + (gap < 40 ? R(0, 25) : 0);
        if (s && s.glitch && gap < 60) h *= 0.7;
        const yaw = s ? Math.atan2(s.tan.x, s.tan.z) + (rand() < 0.15 ? R(-0.3, 0.3) : 0) : 0;
        const kind = Math.floor(rand() * 4);
        const P = addBox(bGeo[kind], x, z, w, d, -0.2, h, yaw, Math.floor(rand() * 4) * 0.25, Math.floor(rand() * 4) * 4);
        if (rand() < 0.55) addRoofEdge(P, h + 0.1, pick(NEON));
        // 계단식 윗부분
        if (h > 70 && rand() < 0.6) {
          const w2 = w * R(0.55, 0.8), d2 = d * R(0.55, 0.8), h2 = h + R(10, 40);
          const P2 = addBox(bGeo[kind], x, z, w2, d2, h, h2, yaw, 0.5, 8);
          addRoofEdge(P2, h2 + 0.1, pick(NEON));
          h = h2;
        }
        if (h > 90 && rand() < 0.5) {
          const ah = R(12, 30);
          antennas.push({ x, y: h + ah / 2, z, sy: ah });
          beacons.push({ x, y: h + ah, z, ph: rand() * 6 });
        }
        buildings.push({ x, z, w, d, h, yaw, gap, s, kind });
        occupy(x, z, r);
      }
    for (const [k, G] of bGeo.entries()) {
      if (!G.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
      geo.setIndex(G.idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, facadeMats[k]);
      m.name = 'buildings' + k;
      city.add(m);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(roofGeo.pos, 3));
    rg.setIndex(roofGeo.idx);
    rg.computeVertexNormals();
    city.add(new THREE.Mesh(rg, roofMat));
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edgeLines, 3));
    eg.setAttribute('color', new THREE.Float32BufferAttribute(edgeCols, 3));
    city.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false })));
  }
  const inst = (geo, mat, list, parent = city) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((it, i) => {
      q.setFromEuler(e.set(it.rx || 0, it.ry || 0, it.rz || 0));
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1));
      im.setMatrixAt(i, m4);
      if (it.color) im.setColorAt(i, new THREE.Color(it.color));
    });
    im.computeBoundingSphere();
    parent.add(im);
    return im;
  };
  inst(new THREE.CylinderGeometry(0.25, 0.6, 1, 6), new THREE.MeshStandardMaterial({ color: '#2a2d3a', metalness: 0.7, roughness: 0.4 }), antennas);
  const beaconIm = inst(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }), beacons);
  if (beaconIm) {
    const on = new THREE.Color('#ff2a2a'), off = new THREE.Color('#2a0505');
    animators.push((t) => {
      beacons.forEach((b, i) => beaconIm.setColorAt(i, Math.sin(t * 2.4 + b.ph) > 0.2 ? on : off));
      beaconIm.instanceColor.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- 네온 간판 (도로를 보는 빌딩 벽에)
  const atlas = signAtlas();
  const signMat = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false, fog: true });
  const flickMat = signMat.clone();
  const signs = quadBatch(), flicks = quadBatch();
  {
    for (const b of buildings) {
      if (b.gap > 70 || !b.s) continue;
      // 도로 쪽을 보는 벽 고르기. 빌딩 로컬 x축 = (c, -s), z축 = (s, c) (addBox와 같음)
      const tx = b.s.pos.x - b.x, tz = b.s.pos.z - b.z, tl = Math.hypot(tx, tz) || 1;
      const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
      const faces = [
        { n: [c, -sn], faceW: b.d, depth: b.w / 2 },
        { n: [-c, sn], faceW: b.d, depth: b.w / 2 },
        { n: [sn, c], faceW: b.w, depth: b.d / 2 },
        { n: [-sn, -c], faceW: b.w, depth: b.d / 2 },
      ];
      for (const f of faces) f.score = (f.n[0] * tx + f.n[1] * tz) / tl;
      faces.sort((p2, q) => q.score - p2.score);
      const f = faces[0];
      if (f.score < 0.3) continue;
      const nx = f.n[0], nz = f.n[1];
      const rxD = new THREE.Vector3(nz, 0, -nx); // 벽을 바라보는 사람의 오른쪽
      const fx = b.x + nx * (f.depth + 0.3), fz = b.z + nz * (f.depth + 0.3);
      const nSigns = 1 + Math.floor(rand() * (b.h > 50 ? 3 : 2));
      for (let k = 0; k < nSigns; k++) {
        const vertical = rand() < 0.4;
        const sw = vertical ? R(2.6, 3.6) : Math.min(f.faceW * 0.8, R(8, 14));
        const sh = vertical ? sw * 4 : sw / 4;
        const yMax = Math.max(8 + sh / 2, Math.min(b.h - sh / 2 - 2, 46));
        const y = R(6 + sh / 2, yMax);
        const off = vertical ? (rand() < 0.5 ? -1 : 1) * Math.max(0, f.faceW / 2 - sw / 2 - 0.4) : R(-1, 1) * Math.max(0, f.faceW / 2 - sw / 2 - 0.5);
        const cpos = new THREE.Vector3(fx + rxD.x * off, y, fz + rxD.z * off);
        const ry = new THREE.Vector3(0, sh / 2, 0);
        const cell = vertical ? Math.floor(rand() * SIGN_CELLS.v) : Math.floor(rand() * SIGN_CELLS.h);
        const batch = rand() < 0.15 ? flicks : signs;
        if (vertical && rand() < 0.6) {
          // 벽에서 튀어나온 돌출 간판: 도로를 따라 오는 차가 앞뒤에서 읽을 수 있게 양면
          cpos.x += nx * (sw / 2 + 0.3);
          cpos.z += nz * (sw / 2 + 0.3);
          const n2 = new THREE.Vector3(nx, 0, nz);
          const side = rxD.clone().multiplyScalar(0.04);
          batch.add(cpos.clone().add(side), n2.clone().multiplyScalar(-sw / 2), ry, signUV(true, cell));
          batch.add(cpos.clone().sub(side), n2.clone().multiplyScalar(sw / 2), ry, signUV(true, cell));
        } else batch.add(cpos, rxD.clone().multiplyScalar(sw / 2), ry, signUV(vertical, cell));
      }
    }
    const sm = signs.mesh(signMat);
    sm.name = 'neonSigns';
    city.add(sm);
    if (flicks.count) {
      const fm = flicks.mesh(flickMat);
      city.add(fm);
      let next = 0;
      animators.push((t) => {
        if (t < next) return;
        const on = rand() < 0.7;
        flickMat.color.setScalar(on ? 1 : 0.15);
        next = t + (on ? R(0.3, 2.5) : R(0.04, 0.15));
      });
    }
  }

  // ---------------------------------------------------------------- 큰 전광판 (길가 빌딩 벽, 출발 스타디움)
  const ad = adTexture();
  const screens = [];
  {
    const near = buildings.filter((b) => b.gap < 55 && b.h > 35).sort((p, q) => p.gap - q.gap);
    let made = 0;
    for (const b of near) {
      if (made >= 14) break;
      if (screens.some((s) => Math.hypot(s.x - b.x, s.z - b.z) < 160)) continue;
      const toRoad = new THREE.Vector3(b.s.pos.x - b.x, 0, b.s.pos.z - b.z).normalize();
      const sw = Math.min(26, Math.max(b.w, b.d) * 0.9), sh = sw / 2;
      const mat = screenMaterial(ad.tex, ad.count);
      mat.uniforms.uSeed.value = rand() * 10;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
      const dist = Math.max(b.w, b.d) / 2 + 1.5;
      m.position.set(b.x + toRoad.x * dist, Math.min(b.h - sh / 2 - 3, R(24, 40)), b.z + toRoad.z * dist);
      m.lookAt(b.s.pos.x, m.position.y, b.s.pos.z);
      city.add(m);
      screens.push({ x: b.x, z: b.z, mat });
      made++;
    }
    animators.push((t) => {
      for (const s of screens) s.mat.uniforms.uTime.value = t;
    });
  }

  // ---------------------------------------------------------------- 가로등 + 도로 위 빛 웅덩이 (도시 구간)
  {
    const poles = [], arms = [], heads = [];
    const pools = quadBatch();
    const step = Math.max(1, Math.round(26 / (track.length / N)));
    const warm = new THREE.Color('#ffb36b'), cool = new THREE.Color('#7fd6ff'), pinkC = new THREE.Color('#ff7ad9');
    let k = 0;
    for (let i = 0; i < N; i += step, k++) {
      const s = samples[i];
      if (s.glitch || (track.tubeK && track.tubeK[i] > 0.02)) continue;
      const side = k % 2 ? 1 : -1;
      const rl = track.railLatOf(s, side);
      const base = track.surf(s, side * (rl + 0.9), 0, new THREE.Vector3());
      const yaw = Math.atan2(s.tan.x, s.tan.z);
      poles.push({ x: base.x, y: base.y + 4.5, z: base.z, sy: 9 });
      const armC = track.surf(s, side * (rl - 1.2), 9, new THREE.Vector3());
      arms.push({ x: armC.x, y: armC.y, z: armC.z, ry: yaw, sx: 4.4 });
      const hd = track.surf(s, side * (rl - 3.2), 8.8, new THREE.Vector3());
      const col = k % 7 === 0 ? pinkC : k % 3 === 0 ? cool : warm;
      heads.push({ x: hd.x, y: hd.y, z: hd.z, ry: yaw, color: '#' + col.getHexString() });
      // 젖은 길에 비친 가로등 줄기 (round 2: 둥근 색 웅덩이 → 길 방향으로 길쭉하고 좁은 반사)
      const lat = side * Math.min(rl - 3.4, HW - 1.2); // 넓힌 갓길 위가 아니라 도로 위에 (round 4)
      const r = 1.5;
      const di = Math.round(11 / (track.length / N));
      const sA = samples[(i - di + N) % N], sB = samples[(i + di) % N];
      const a = track.surf(sA, lat - r, 0.06, new THREE.Vector3()), b = track.surf(sA, lat + r, 0.06, new THREE.Vector3());
      const c2 = track.surf(sB, lat + r, 0.06, new THREE.Vector3()), d = track.surf(sB, lat - r, 0.06, new THREE.Vector3());
      pools.addPts(a, b, c2, d, [0, 0, 1, 1], col);
    }
    inst(new THREE.CylinderGeometry(0.14, 0.2, 1, 6), new THREE.MeshStandardMaterial({ color: '#30333f', metalness: 0.7, roughness: 0.4 }), poles);
    // 팔: 로컬 x가 도로 옆 방향이 되도록 (ry = 도로 방향) → 상자 x축 = 옆
    inst(new THREE.BoxGeometry(1, 0.16, 0.16).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#30333f', metalness: 0.7, roughness: 0.4 }), arms.map((a) => ({ ...a, ry: a.ry + Math.PI / 2 })));
    inst(new THREE.BoxGeometry(1.4, 0.25, 0.7), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), heads);
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,255,255,0.7)', 'rgba(255,255,255,0.16)'), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const pm = pools.mesh(poolMat);
    pm.renderOrder = 1;
    city.add(pm);
  }

  // ---------------------------------------------------------------- 고가도로 기둥 (도시 구간, 도로가 4 m 넘게 높은 곳)
  {
    const pil = [], caps = [], bands = [];
    const step = Math.max(1, Math.round(30 / (track.length / N)));
    for (let i = 0; i < N; i += step) {
      const s = samples[i];
      if (s.glitch || s.pos.y < 4) continue;
      if (track.tube && track.tubeK[i] > 0.5) continue;
      // 다른 도로(아래 지나가는 길)를 막지 않는지
      let blocked = false;
      for (let j = 0; j < N && !blocked; j += 3) {
        let dd = Math.abs(j - i) / N;
        dd = Math.min(dd, 1 - dd) * track.length;
        if (dd < 50) continue;
        const q = samples[j];
        if (q.pos.y > s.pos.y - 3) continue;
        if (Math.hypot(q.pos.x - s.pos.x, q.pos.z - s.pos.z) < Math.max(track.railLatOf(q, -1), track.railLatOf(q, 1)) + 4) blocked = true;
      }
      if (blocked) continue;
      const top = s.pos.y - 1.7;
      const yaw = Math.atan2(s.tan.x, s.tan.z);
      pil.push({ x: s.pos.x, y: top / 2, z: s.pos.z, sx: 1, sy: top, sz: 1, ry: yaw });
      caps.push({ x: s.pos.x, y: top - 0.6, z: s.pos.z, ry: yaw, sx: (track.railLatOf(s, 1) + track.railLatOf(s, -1)) * 0.8 });
      bands.push({ x: s.pos.x, y: top * 0.55, z: s.pos.z, ry: yaw, color: rand() < 0.5 ? '#2ff3ff' : '#ff2f8e' });
    }
    const conc = new THREE.MeshStandardMaterial({ color: '#3b3e4a', roughness: 0.75, metalness: 0.2 });
    inst(new THREE.BoxGeometry(3.2, 1, 2.4), conc, pil);
    inst(new THREE.BoxGeometry(1, 1.2, 2.6), conc, caps);
    inst(new THREE.BoxGeometry(3.4, 0.35, 2.6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), bands);
  }

  // ---------------------------------------------------------------- 홀로그램
  const holoMats = [];
  {
    // 1) 클로버잎 고리 한가운데: 거대한 홀로그램 지구본 + 고리
    const loop = tAt('loop');
    if (loop) {
      let cx = 0, cz = 0, n = 0;
      for (let t = loop[0]; t < loop[1]; t += 0.002) {
        const s = sAtT(t);
        cx += s.pos.x;
        cz += s.pos.z;
        n++;
      }
      cx /= n;
      cz /= n;
      const g = new THREE.Group();
      g.position.set(cx, 38, cz);
      const m1 = hologramMaterial('#2ff3ff', { opacity: 0.6, lines: 1.2 });
      const m2 = hologramMaterial('#ff2f8e', { opacity: 0.7, lines: 0.8 });
      holoMats.push(m1, m2);
      const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(16, 2), m1);
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(16.3, 1)), new THREE.LineBasicMaterial({ color: '#7ff8ff', transparent: true, opacity: 0.6, toneMapped: false }));
      g.add(globe, wire);
      const rings = [];
      for (let k = 0; k < 3; k++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(22 + k * 4, 0.5, 6, 80), m2);
        r.rotation.set(Math.PI / 2 + k * 0.4, k * 0.7, 0);
        g.add(r);
        rings.push(r);
      }
      // 아래 받침 빛기둥
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 9, 38, 24, 1, true), hologramMaterial('#b06cff', { opacity: 0.5, lines: 0.5 }));
      holoMats.push(beam.material);
      beam.position.y = -19;
      g.add(beam);
      city.add(g);
      animators.push((t) => {
        globe.rotation.y = t * 0.25;
        wire.rotation.y = t * 0.25;
        rings.forEach((r, k) => (r.rotation.z = t * (0.3 + k * 0.15) * (k % 2 ? -1 : 1)));
        g.position.y = 38 + Math.sin(t * 0.8) * 1.5;
      });
    }
    // 2) 고가도로 옆 떠 있는 홀로그램 광고판 (글자 그림 + 홀로그램 재질)
    const holoTexts = [['NEON CITY', '#2ff3ff'], ['기믹 레이싱', '#ff2f8e'], ['MAGNET TUBE ▶', '#b06cff'], ['LOW-G 주의', '#7dff6a'], ['DRIVE FAST', '#ffe23a']];
    const htex = holoTexts.map(([txt, col]) =>
      canvasTexture(512, 160, (g2, w, h) => {
        g2.clearRect(0, 0, w, h);
        g2.strokeStyle = col;
        g2.lineWidth = 6;
        g2.strokeRect(6, 6, w - 12, h - 12);
        g2.font = '900 76px system-ui, "Malgun Gothic", sans-serif';
        g2.textAlign = 'center';
        g2.textBaseline = 'middle';
        g2.fillStyle = '#ffffff';
        g2.fillText(txt, w / 2, h / 2 + 4);
      }),
    );
    for (const [secName, side, k] of [['highway', 1, 0], ['sweeper', -1, 1], ['highway2', 1, 2], ['T2', -1, 4], ['finalL', 1, 1], ['chicane', 1, 0]]) {
      const sec = tAt(secName);
      if (!sec) continue;
      const s = sAtT((sec[0] + sec[1]) / 2);
      const lat = side * (track.railLatOf(s, side) + 9);
      const p = track.surf(s, lat, 0, new THREE.Vector3());
      const mat = hologramMaterial(holoTexts[k][1], { opacity: 0.9, lines: 3, map: htex[k] });
      holoMats.push(mat);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(18, 5.6), mat);
      pl.position.set(p.x, p.y + 12, p.z);
      pl.rotation.y = Math.atan2(s.tan.x, s.tan.z) + Math.PI - side * 0.5; // 다가오는 차 쪽으로
      city.add(pl);
      // 아래 투사기
      const pr = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, p.y + 8.5, 8), new THREE.MeshStandardMaterial({ color: '#2a2d3a', metalness: 0.7, roughness: 0.4 }));
      pr.position.set(p.x, (p.y + 8.5) / 2 - 0.2, p.z);
      city.add(pr);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(4, 3.2, 16, 1, true), hologramMaterial(holoTexts[k][1], { opacity: 0.35, lines: 4 }));
      holoMats.push(beam.material);
      beam.position.set(p.x, p.y + 10.2, p.z);
      beam.rotation.x = Math.PI;
      city.add(beam);
    }
    // 3) 옥상 다이아몬드 (도로 가까운 높은 빌딩 위)
    const tops = buildings.filter((b) => b.gap < 80 && b.h > 60).slice(0, 26);
    const dm = hologramMaterial('#ff5cf0', { opacity: 0.8, lines: 0.6 });
    const dm2 = hologramMaterial('#2ff3ff', { opacity: 0.8, lines: 0.6 });
    holoMats.push(dm, dm2);
    const dias = tops.map((b, k) => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(5, 0), k % 2 ? dm : dm2);
      m.position.set(b.x, b.h + 12, b.z);
      m.scale.y = 1.6;
      city.add(m);
      return m;
    });
    animators.push((t) => dias.forEach((m, k) => ((m.rotation.y = t * 0.6 + k), (m.position.y += Math.sin(t * 1.3 + k) * 0.01))));
    animators.push((t) => {
      for (const m of holoMats) m.uniforms.uTime.value = t;
    });
  }

  // ---------------------------------------------------------------- 서치라이트 (스타디움, 하늘을 훑음)
  {
    const beamTex = canvasTexture(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, h, 0, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    beamTex.wrapS = beamTex.wrapT = THREE.ClampToEdgeWrapping;
    const beams = [];
    for (const [dm, side, col] of [[-40, 1, '#9fd8ff'], [60, 1, '#ff9ae8'], [-20, -1, '#9fd8ff'], [90, -1, '#c8a0ff']]) {
      const s = sAtT(((dm / track.length) % 1 + 1) % 1);
      const p = track.surf(s, side * (track.railLatOf(s, side) + 26), 0, new THREE.Vector3());
      const g = new THREE.Group();
      g.position.set(p.x, p.y + 16, p.z);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(9, 0.8, 260, 20, 1, true).translate(0, 130, 0), new THREE.MeshBasicMaterial({ map: beamTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      g.add(cone);
      city.add(g);
      beams.push({ g, ph: rand() * 6 });
    }
    animators.push((t) => beams.forEach((b) => b.g.rotation.set(0.35 + 0.18 * Math.sin(t * 0.5 + b.ph), t * 0.3 + b.ph, 0.25 * Math.cos(t * 0.37 + b.ph), 'YXZ')));
  }

  // ---------------------------------------------------------------- 하늘을 나는 차 (빌딩 사이를 빙빙)
  {
    const NF = 46;
    const fl = [];
    for (let k = 0; k < NF; k++) {
      const cx = R(bb.min.x - 150, bb.max.x + 150), cz = R(bb.min.y - 150, bb.max.y + 150);
      fl.push({ cx, cz, r: R(120, 420), y: R(45, 150), w: (R(18, 38) / R(120, 420)) * (rand() < 0.5 ? -1 : 1), ph: R(0, 6.28), bob: R(0, 6) });
    }
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.9, 4.6), new THREE.MeshStandardMaterial({ color: '#2a2d3a', metalness: 0.8, roughness: 0.3 }), NF);
    const tail = new THREE.InstancedMesh(new THREE.BoxGeometry(2.0, 0.25, 0.2).translate(0, 0, -2.35), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), NF);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.2, 0.2).translate(0, 0, 2.35), new THREE.MeshBasicMaterial({ color: '#dff6ff', toneMapped: false }), NF);
    const under = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 5).rotateX(-Math.PI / 2).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), NF);
    for (let k = 0; k < NF; k++) {
      tail.setColorAt(k, new THREE.Color(k % 3 ? '#ff2a4a' : '#ff2fd0'));
      under.setColorAt(k, new THREE.Color(pick(['#2ff3ff', '#ff2f8e', '#b06cff'])));
    }
    for (const im of [body, tail, head, under]) {
      im.frustumCulled = false;
      city.add(im);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    animators.push((t) => {
      fl.forEach((f, k) => {
        const a = f.ph + t * f.w;
        p.set(f.cx + Math.cos(a) * f.r, f.y + Math.sin(t * 0.7 + f.bob) * 2, f.cz + Math.sin(a) * f.r);
        // 진행 방향 (원의 접선)
        const yaw = Math.atan2(-Math.sin(a) * Math.sign(f.w), Math.cos(a) * Math.sign(f.w));
        q.setFromAxisAngle(UP, yaw);
        m4.compose(p, q, sc);
        body.setMatrixAt(k, m4);
        tail.setMatrixAt(k, m4);
        head.setMatrixAt(k, m4);
        under.setMatrixAt(k, m4);
      });
      for (const im of [body, tail, head, under]) im.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- 땅 (젖은 도시 바닥: 보도 블록 줄무늬)
  {
    const tex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#121219';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2500; i++) {
        const v = 16 + Math.random() * 18;
        g.fillStyle = `rgba(${v},${v},${v + 6},0.6)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.strokeStyle = 'rgba(70,70,90,0.5)';
      g.lineWidth = 2;
      for (let k = 0; k <= 8; k++) {
        g.beginPath();
        g.moveTo((k * w) / 8, 0);
        g.lineTo((k * w) / 8, h);
        g.stroke();
        g.beginPath();
        g.moveTo(0, (k * h) / 8);
        g.lineTo(w, (k * h) / 8);
        g.stroke();
      }
    });
    const size = track.groundSize;
    tex.repeat.set(size / 24, size / 24);
    const gnd = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0.2, envMapIntensity: 1.2 }));
    gnd.position.set(center.x, -0.1, center.y);
    gnd.receiveShadow = true;
    gnd.name = 'cityGround';
    city.add(gnd);
  }

  // ---------------------------------------------------------------- 비
  const rain = createRain();
  city.add(rain.obj);
  animators.push((t) => {
    rain.mat.uniforms.uTime.value = t;
    const c = window.game && window.game.camera;
    if (c) rain.mat.uniforms.uCam.value.copy(c.position);
  });

  // ---------------------------------------------------------------- 젖은 도로 반사용 환경 지도 (네온 색 하늘·간판 띠) — 렌더러가 생긴 뒤 한 번
  let envDone = false;
  /** 환경맵용: 원점을 바라보는 작은 사각형들을 한 메시로 */
  function quadBatchEnv() {
    const P = [], C = [];
    return {
      add(x, y, z, w, h, col) {
        const len = Math.hypot(x, z) || 1;
        const rx = -z / len * w * 0.5, rz = x / len * w * 0.5; // 옆 방향
        const hy = h * 0.5;
        const v = [[x - rx, y - hy, z - rz], [x + rx, y - hy, z + rz], [x + rx, y + hy, z + rz], [x - rx, y + hy, z - rz]];
        for (const q of [0, 1, 2, 0, 2, 3]) P.push(...v[q]), C.push(col.r, col.g, col.b);
      },
      mesh() {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
        return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      },
    };
  }
  function makeEnv() {
    const renderer = window.game && window.game.renderer;
    if (!renderer || envDone) return;
    envDone = true;
    const es = new THREE.Scene();
    es.background = new THREE.Color('#0b0820');
    const box = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: canvasTexture(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#05040e');
      gr.addColorStop(0.45, '#1a0c38');
      gr.addColorStop(0.5, '#4a1a5a');
      gr.addColorStop(1, '#0a0812');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }) }));
    es.add(box);
    // 반사에 비치는 도시 불빛 (round 2): 예전엔 큰 네온 판 18개 → 젖은 길에 큰 색 얼룩.
    //   지금은 작은 창문 불빛·간판 조각 수백 개 → 반사가 잘게 부서진 빛으로 보임 (진짜 젖은 아스팔트처럼)
    const lights = quadBatchEnv();
    for (let k = 0; k < 420; k++) {
      const a = R(0, Math.PI * 2);
      const y = Math.pow(rand(), 1.6) * 16 + 0.5;
      const neon = rand() < 0.28;
      const col = new THREE.Color(neon ? NEON[k % NEON.length] : rand() < 0.5 ? '#ffd8a8' : '#bcd4ff').multiplyScalar(neon ? 2.2 : R(0.8, 1.8)); // 1보다 밝게 (HDR) → 매끈한 웅덩이에 또렷한 점으로 비침
      lights.add(Math.cos(a) * 40, y, Math.sin(a) * 40, neon ? R(0.8, 2.6) : R(0.3, 0.9), neon ? R(0.3, 1.2) : R(0.3, 0.7), col);
    }
    es.add(lights.mesh());
    // 수평선 쪽 희미한 도시 빛 띠
    const band = new THREE.Mesh(new THREE.CylinderGeometry(39, 39, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#3a1d55', side: THREE.BackSide, transparent: true, opacity: 0.6 }));
    band.position.y = 2;
    es.add(band);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(es, 0.02);
    cityEnv = rt.texture;
    scene.environment = cityEnv;
    pm.dispose();
  }
  let cityEnv = null;

  // ---------------------------------------------------------------- 글리치 차원 (포털·세계 전환·글리치 풍경)
  const glitch = buildGlitch(track, scene, { cityObjects: [city], getCityEnv: () => cityEnv });

  city.updateMatrixWorld(true);
  const buildMs = Math.round(performance.now() - t0);
  return {
    collideCar() {},
    addCollider() {},
    animate(time, dt, car) {
      if (!envDone) makeEnv();
      if (glitch) glitch.update(time, dt, car);
      if (!glitch || !glitch.inGlitch) for (const a of animators) a(time, dt, car);
    },
    glitch,
    stats: { buildings: buildings.length, signs: signs.count + flicks.count, screens: screens.length, buildMs },
  };
}
