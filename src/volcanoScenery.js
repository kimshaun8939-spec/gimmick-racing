// 화산 지대 풍경 (volcanoMap.js의 buildScenery)
//   - 하늘: 붉은 저녁 하늘 돔 + 흐르는 화산재 구름 + 재 너머 흐린 해 (차를 따라다님, volcanoAssets.js skyMaterial)
//   - 먼 지평선: 지형 끝을 가리는 검은 산줄기 고리 (지형 상자 모양을 따라 둥근 네모)
//   - 큰 활화산 (코스 남쪽 약 1.2 km): 빛나는 분화구, 산비탈을 흐르는 용암, 천천히 피어오르는 연기 기둥,
//     가끔 분화 (용암 덩어리가 포물선으로 날고 하늘이 붉게 번쩍) — 보기만 함. 작은 화산 2개도
//   - 길가: 흑요석·현무암 바위, 현무암 기둥 무리, 불탄 나무, 유황 증기 구멍(김이 피어오름), 유황 얼룩,
//     빛나는 용암 균열, 높은 곳에서 흘러내려 용암 바다로 떨어지는 용암 줄기, 분화구 호수의 바위섬
//   - 출발 지역 "VULCAN BASE": 빨간불 5개 출발 게이트, 연구 기지(관제동·관측탑·관측 돔·레이더·연료 탱크),
//     관중석 2개, 깃발, 조명탑
//   - 위험 표지판: 점프 3곳 앞 "점프! 풀 가속", 칼날 능선 앞 "낭떠러지", 헤어핀 바깥 쉐브론
//   - 성능: 반복 물체는 InstancedMesh, 연기·김·빛은 빌보드 묶음(그림 호출 1번), 움직이는 것은 이름을 붙여 staticBatch가 건드리지 않게
//   - 충돌: 원기둥 충돌체 격자 (collideCar, addCollider). 도로 가장자리(연석 끝)에서 3 m 안에는 충돌체를 두지 않음
import * as THREE from 'three';
import { canvasTexture, seededRandom, makeNoise, lavaTexture } from './volcanoTrack.js';
import {
  billboardCloud, skyMaterial, hazeLambert, rockGeo, basaltColumnGeo, deadTreeGeo, smokeTexture, glowTexture, crackTexture, sulfurTexture,
  warnTexture, chevronTexture, bannerTexture, windowTexture, titleTexture,
} from './volcanoAssets.js';
import { observatory, radarDish, antennaMast } from './gpSpace.js';
import { grandstand } from './gpAssets.js';

const TAU = Math.PI * 2;
const CAR_R = 1.3; // 차 충돌 반지름
const CELL = 24; // 충돌체 격자 크기
const UP = new THREE.Vector3(0, 1, 0);
const GC = 5; // 지형 격자 한 칸 (volcanoTrack.js CELL과 같음)

export function buildVolcanoScenery(track, scene) {
  const t0 = performance.now();
  const rand = seededRandom(9127);
  const noise = makeNoise(5151);
  const group = new THREE.Group();
  group.name = 'volcanoScenery';
  scene.add(group);
  const animators = []; // (time, dt, car) => void
  const stats = {};
  const tmpV = new THREE.Vector3();
  const S = track.samples, NS = S.length - 1;
  const LAVA = track.lavaY;
  const tb = track.terrainBox;
  const EDGE = track.EDGE;
  const kerb = (i, sd) => track.kerbAt(i, sd);
  const edgeLat = (i, sd) => S[i].hw + kerb(i, sd);

  // ---------------------------------------------------------------- 빛·안개: 붉은 저녁, 화산재로 뿌연 공기
  const FOG = new THREE.Color('#6e2f1f');
  scene.background = FOG.clone();
  scene.fog = new THREE.Fog(FOG.clone(), 320, 2500);
  scene.traverse((o) => {
    if (o.isHemisphereLight) {
      o.color.set('#ffb48c');
      o.groundColor.set('#5a2412');
      o.intensity = 1.05;
    } else if (o.isDirectionalLight) {
      o.color.set('#ffc08e');
      o.intensity = 2.3;
    }
  });

  // ---------------------------------------------------------------- 충돌체 (원기둥: x, z, 반지름, 아래 y0, 위 y1)
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

  // ---------------------------------------------------------------- 자리 도우미
  /** 지형 메시와 똑같은 높이 (5 m 격자 삼각형 면 위) → 물체가 뜨거나 묻히지 않게 */
  function groundY(x, z) {
    const i = Math.floor(x / GC), j = Math.floor(z / GC);
    const x0 = i * GC, z0 = j * GC, u = (x - x0) / GC, v = (z - z0) / GC;
    const h00 = track.heightAt(x0, z0), h10 = track.heightAt(x0 + GC, z0), h11 = track.heightAt(x0 + GC, z0 + GC), h01 = track.heightAt(x0, z0 + GC);
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
  const inBox = (x, z, m = 10) => x > tb.min.x + m && x < tb.max.x - m && z > tb.min.y + m && z < tb.max.y - m;
  /** 땅 기울기 (노멀) */
  function groundN(x, z, d = 1.5, out = new THREE.Vector3()) {
    return out.set(groundY(x - d, z) - groundY(x + d, z), 2 * d, groundY(x, z - d) - groundY(x, z + d)).normalize();
  }
  // 도로 샘플 해시: (x, z)에서 도로 가장자리(연석 끝)까지 가장 가까운 거리
  const RC = 32;
  const rkey = (a, b) => (a + 4000) * 8000 + (b + 4000);
  const rmap = new Map();
  for (let i = 0; i < NS; i++) {
    const p = S[i].pos;
    const k = rkey(Math.floor(p.x / RC), Math.floor(p.z / RC));
    if (!rmap.has(k)) rmap.set(k, []);
    rmap.get(k).push(i);
  }
  /** 도로 가장자리까지 거리 (m, 30 m 넘으면 대충 큰 값) — 높이 차이는 안 봄 (위아래 겹친 길도 피함) */
  function roadClear(x, z) {
    let best = 1e9;
    const cx = Math.floor(x / RC), cz = Math.floor(z / RC);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const list = rmap.get(rkey(cx + a, cz + b));
        if (!list) continue;
        for (const i of list) {
          const s = S[i];
          const dx = x - s.pos.x, dz = z - s.pos.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d - 11.2 > best) continue;
          const e = d - s.hw - kerb(i, dx * s.right.x + dz * s.right.z < 0 ? -1 : 1);
          if (e < best) best = e;
        }
      }
    return best > 1e8 ? 40 : best;
  }
  // 점프 협곡 근처 (립·착지 60 m 안)에는 충돌체를 두지 않음
  const jumpPts = [];
  for (const j of track.jumps || []) jumpPts.push(j.lip.pos, j.landS.pos);
  const nearJump = (x, z, r = 60) => jumpPts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r);
  /** 충돌체 넣기 (도로 가장자리에서 3 m 밖일 때만, 점프 근처 빼고) */
  function solid(x, z, r, y0, y1) {
    if (nearJump(x, z)) return false;
    if (roadClear(x, z) < 3 + r) return false;
    circle(x, z, r, y0, y1);
    return true;
  }
  const occupied = [];
  const free = (x, z, r) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
  const occupy = (x, z, r) => occupied.push({ x, z, r });
  /** 발자국 둘레 가장 낮은 땅 (물체를 그 높이에 놓으면 뜨지 않음) */
  function lowGround(x, z, r) {
    let y = groundY(x, z);
    if (r > 0) for (let k = 0; k < 6; k++) y = Math.min(y, groundY(x + Math.cos((k / 6) * TAU) * r, z + Math.sin((k / 6) * TAU) * r));
    return y;
  }
  /** 길 옆 무작위 자리: 코스 샘플 하나 골라 옆으로 (가장자리 + min ~ max) */
  function nearRoadPoint(min, max, pow = 1.4) {
    const i = Math.floor(rand() * NS);
    const s = S[i];
    const sd = rand() < 0.5 ? -1 : 1;
    const d = edgeLat(i, sd) + min + rand() ** pow * (max - min);
    const a = (rand() - 0.5) * 6;
    return [s.pos.x + s.right.x * sd * d + s.tan.x * a, s.pos.z + s.right.z * sd * d + s.tan.z * a];
  }
  const farPoint = () => [tb.min.x + 20 + rand() * (tb.max.x - tb.min.x - 40), tb.min.y + 20 + rand() * (tb.max.y - tb.min.y - 40)];

  const s0 = S[0];
  const yawOf = (s) => Math.atan2(s.tan.x, s.tan.z);
  const center = new THREE.Vector3();
  {
    const box = new THREE.Box3();
    for (let i = 0; i < NS; i += 8) box.expandByPoint(S[i].pos);
    box.getCenter(center);
  }
  const boxC = new THREE.Vector2((tb.min.x + tb.max.x) / 2, (tb.min.y + tb.max.y) / 2);
  const boxH = new THREE.Vector2((tb.max.x - tb.min.x) / 2, (tb.max.y - tb.min.y) / 2);
  // 큰 화산 자리: 코스 남쪽(+z) 지형 상자 밖
  const VOL = { x: boxC.x - 60, z: tb.max.y + 640, H: 560, R: 920, cr: 78, cd: 46 };
  const volDir = new THREE.Vector3(VOL.x - center.x, 0, VOL.z - center.z).normalize();
  const SUN_DIR = new THREE.Vector3(60, 46, 40).normalize(); // main.js 햇빛 방향(60,110,40)과 같은 쪽, 하늘에선 조금 낮게

  // ---------------------------------------------------------------- 공용 텍스처·재질
  const TX = {
    smoke: smokeTexture(3),
    glow: glowTexture(0.12),
    glowSoft: glowTexture(0.02),
    crack: crackTexture(11),
    crack2: crackTexture(29),
    sulfur: sulfurTexture(13),
  };
  const M = {
    concrete: new THREE.MeshLambertMaterial({ color: '#5b5450' }),
    dark: new THREE.MeshStandardMaterial({ color: '#222024', roughness: 0.6, metalness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: '#9a9ca2', roughness: 0.45, metalness: 0.55 }),
    orange: new THREE.MeshLambertMaterial({ color: '#ff6a14' }),
    hazard: new THREE.MeshLambertMaterial({ map: canvasTexture(64, 64, (c, w, h) => {
      c.fillStyle = '#ffb21f';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#171313';
      for (let k = -2; k < 4; k++) {
        c.beginPath();
        c.moveTo(k * 32, 0);
        c.lineTo(k * 32 + 16, 0);
        c.lineTo(k * 32 + 80, h);
        c.lineTo(k * 32 + 64, h);
        c.fill();
      }
    }) }),
    lampGlow: new THREE.MeshBasicMaterial({ color: '#fff1d0', toneMapped: false }),
    orangeGlow: new THREE.MeshBasicMaterial({ color: '#ff8a2a', toneMapped: false }),
    redGlow: new THREE.MeshBasicMaterial({ color: '#ff2a14', toneMapped: false }),
    glass: new THREE.MeshStandardMaterial({ color: '#2a1a14', roughness: 0.1, metalness: 0.7, emissive: '#ff7a2a', emissiveIntensity: 0.25 }),
  };
  const winTex = windowTexture();
  const windowMat = new THREE.MeshStandardMaterial({ map: winTex, emissive: '#ffffff', emissiveMap: winTex, emissiveIntensity: 0.55, roughness: 0.6 });

  // 빌보드 묶음들 (그림 호출 1번씩)
  const NEAR_GLOW_N = 260, STEAM_N = 420, FAR_GLOW_N = 90, PLUME_N = 86;
  const nearGlow = billboardCloud(NEAR_GLOW_N, { map: TX.glowSoft, additive: true, name: 'volcanoNearGlow' });
  const steam = billboardCloud(STEAM_N, { map: TX.smoke, name: 'volcanoSteam' });
  const farGlow = billboardCloud(FAR_GLOW_N, { map: TX.glow, additive: true, fogAmt: 0.35, name: 'volcanoFarGlow' });
  const plume = billboardCloud(PLUME_N, { map: TX.smoke, fogAmt: 0.5, name: 'volcanoPlume', renderOrder: -1 });
  for (const b of [nearGlow, steam, farGlow, plume]) {
    for (let i = 0; i < b.count; i++) b.col[i * 4 + 3] = 0; // 안 쓰는 칸은 투명
    group.add(b.mesh);
  }
  let nearGlowN = 0, steamN = 0, farGlowN = 0;
  const cTmp = new THREE.Color();
  const nearGlowList = []; // { i, base, ph }
  function addNearGlow(x, y, z, size, color, alpha) {
    if (nearGlowN >= NEAR_GLOW_N) return;
    const i = nearGlowN++;
    nearGlow.set(i, x, y, z, size, 0, cTmp.set(color), alpha);
    nearGlowList.push({ i, a: alpha, ph: rand() * TAU });
  }
  const steamSrc = []; // 김 나오는 곳 { x, y, z, n, life, rise, s0, s1, a, color, drift }
  function addSteam(x, y, z, o) {
    const n = o.n || 5;
    if (steamN + n > STEAM_N) return;
    steamSrc.push({ x, y, z, first: steamN, n, life: o.life || 5, rise: o.rise || 12, s0: o.s0 || 1.5, s1: o.s1 || 8, a: o.a || 0.35, color: new THREE.Color(o.color || '#e9dcc4'), ph: rand() });
    steamN += n;
  }

  // ---------------------------------------------------------------- 거리 줄이기 (LOD): 인스턴스 묶음은 카메라에서 range m 안의 것만 그림
  //   맵 전체 바위·나무를 늘 다 그리면 삼각형이 너무 많음 → 카메라가 range의 1/8쯤 움직일 때마다 가까운 것만 다시 골라 넣음
  const ranged = [];
  function rangeLOD(im, range) {
    const n = im.count;
    const mats = new Float32Array(n * 16), px = new Float32Array(n), pz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      im.getMatrixAt(i, m4L);
      m4L.toArray(mats, i * 16);
      px[i] = mats[i * 16 + 12];
      pz[i] = mats[i * 16 + 14];
    }
    const extra = [];
    ranged.push({ im, range, mats, px, pz, n, lx: 1e9, lz: 1e9, extra });
    return extra; // 같은 자리로 함께 줄일 다른 인스턴스 묶음 (예: 증기 구멍 안쪽 빛)
  }
  const m4L = new THREE.Matrix4();
  animators.push(() => {
    const cam = window.game && window.game.camera;
    if (!cam) return;
    const cx = cam.position.x, cz = cam.position.z;
    for (const R of ranged) {
      if ((cx - R.lx) ** 2 + (cz - R.lz) ** 2 < (R.range * 0.12) ** 2) continue;
      R.lx = cx;
      R.lz = cz;
      const r2 = R.range * R.range;
      const arr = R.im.instanceMatrix.array;
      let c = 0;
      for (let i = 0; i < R.n; i++) {
        if ((R.px[i] - cx) ** 2 + (R.pz[i] - cz) ** 2 > r2) continue;
        if (c !== i) arr.set(R.mats.subarray(i * 16, i * 16 + 16), c * 16);
        c++;
      }
      R.im.count = c;
      R.im.instanceMatrix.needsUpdate = true;
      R.im.boundingSphere = null; // 화면 밖 판정을 다시 계산
    }
  });

  // ---------------------------------------------------------------- 하늘 (차를 따라다님)
  const skyMat = skyMaterial({ fogColor: scene.fog.color, sunDir: SUN_DIR, volDir });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2750, 40, 20), skyMat);
  sky.name = 'volcanoSky';
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  animators.push((t) => {
    const cam = window.game && window.game.camera;
    if (cam) sky.position.copy(cam.position);
    skyMat.uniforms.time.value = t;
  });

  // ---------------------------------------------------------------- 먼 지평선: 지형 상자를 따라 도는 검은 산줄기
  {
    const N = 360, P = 6;
    const layers = [-45, 75, 240, 430, 660];
    const pos = [], col = [], glow = [];
    const cLow = new THREE.Color('#3a2d28'), cHigh = new THREE.Color('#6e5848'), cAsh = new THREE.Color('#7d5440'), c = new THREE.Color();
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const sx = Math.sign(ca) * Math.abs(ca) ** (2 / P), sz = Math.sign(sa) * Math.abs(sa) ** (2 / P);
      const bx = boxC.x + boxH.x * sx, bz = boxC.y + boxH.y * sz;
      const nx = sx / boxH.x ** 1, nz2 = sz / boxH.y ** 1;
      const nl = Math.hypot(nx, nz2) || 1;
      const ox = nx / nl, oz = nz2 / nl;
      const ridge = 1 - Math.abs(noise(Math.cos(a) * 6 + 3, Math.sin(a) * 6, 3));
      const peak = 55 + 190 * ridge ** 2.2 + 45 * Math.abs(noise(Math.cos(a) * 17, Math.sin(a) * 17, 2));
      for (let L = 0; L < layers.length; L++) {
        const d = layers[L] + (L > 0 ? noise(a * 3 + L, 5, 2) * 40 : 0);
        const x = bx + ox * d, z = bz + oz * d;
        let y;
        if (L === 0) y = Math.max(track.heightAt(x, z), LAVA + 2) - 6;
        else if (L === 1) y = 6 + peak * 0.16;
        else if (L === 2) y = peak;
        else if (L === 3) y = peak * 0.6 + 20;
        else y = LAVA - 10;
        pos.push(x, y, z);
        c.copy(cLow).lerp(cHigh, THREE.MathUtils.clamp(y / 200, 0, 1));
        if (noise(x / 60, z / 60, 2) > 0.2) c.lerp(cAsh, 0.4);
        col.push(c.r, c.g, c.b);
        glow.push(L === 0 ? 0.35 : L === 1 ? 0.05 : 0);
      }
    }
    const idx = [];
    const LN = layers.length;
    for (let k = 0; k < N; k++)
      for (let j = 0; j < LN - 1; j++) {
        const a = k * LN + j, b = a + 1, cc = a + LN, d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const ring = new THREE.Mesh(g, hazeLambert({ fogScale: 0.85, side: THREE.DoubleSide, glowGain: 0.9 }));
    ring.name = 'volcanoHorizon';
    group.add(ring);
  }

  // ---------------------------------------------------------------- 화산 (큰 활화산 1 + 작은 화산 2): 높이 함수로 만든 원뿔
  const volcanoes = [
    { ...VOL, seed: 1, streams: 6, main: true },
    { x: tb.min.x - 520, z: boxC.y - 260, H: 250, R: 470, cr: 34, cd: 20, seed: 2, streams: 2 },
    { x: center.x + 620, z: tb.min.y - 560, H: 210, R: 400, cr: 28, cd: 16, seed: 3, streams: 1 },
  ];
  {
    const pos = [], col = [], glow = [], idx = [];
    const lavaPos = [], lavaUv = [], lavaIdx = [];
    const cBas = new THREE.Color('#2b2220'), cAsh = new THREE.Color('#5d4033'), cTop = new THREE.Color('#1a1312'), cRim = new THREE.Color('#5a2a1a'), c = new THREE.Color();
    for (const V of volcanoes) {
      const nz = makeNoise(777 + V.seed);
      const NA = V.main ? 128 : 72, NJ = V.main ? 40 : 24;
      const hAt = (r, a) => {
        if (r < V.cr) return V.H - V.cd * (1 - (r / V.cr) ** 2);
        const u = Math.min(1.15, (r - V.cr) / (V.R - V.cr));
        let y = V.H * Math.max(0, 1 - u) ** 1.75;
        y += V.H * 0.025 * Math.exp(-(((r - V.cr) / (V.cr * 0.45)) ** 2)); // 분화구 테두리
        y -= V.H * 0.05 * (1 - u) * Math.max(0, Math.sin(a * 9 + nz(Math.cos(a) * 2, Math.sin(a) * 2, 2) * 3)) ** 3; // 골짜기
        y += nz(Math.cos(a) * 3 + u * 2, Math.sin(a) * 3 + u * 3, 3) * V.H * 0.035 * (1 - u * 0.6);
        if (u > 1) y -= (u - 1) * 300;
        return y;
      };
      V.hAt = hAt;
      const base = pos.length / 3;
      for (let j = 0; j <= NJ; j++) {
        const r = V.cr * 0.15 + (V.R * 1.12 - V.cr * 0.15) * (j / NJ) ** 1.55;
        for (let k = 0; k < NA; k++) {
          const a = (k / NA) * TAU;
          const rr = r * (1 + nz(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 2) * 0.07 * Math.min(1, r / (V.cr * 2)));
          const y = hAt(r, a);
          pos.push(V.x + Math.cos(a) * rr, y - 8, V.z + Math.sin(a) * rr);
          const h = y / V.H;
          c.copy(cBas).lerp(cAsh, THREE.MathUtils.clamp(0.5 + nz(Math.cos(a) * 6, h * 5, 2), 0, 1) * 0.7);
          c.lerp(cTop, THREE.MathUtils.smoothstep(h, 0.55, 0.9));
          let gl = 0;
          if (r < V.cr * 1.05) (gl = 1), c.copy(cRim);
          else gl = Math.exp(-(r - V.cr) / (V.cr * 0.5)) * 0.55;
          col.push(c.r, c.g, c.b);
          glow.push(gl);
        }
      }
      for (let j = 0; j < NJ; j++)
        for (let k = 0; k < NA; k++) {
          const a = base + j * NA + k, b = base + j * NA + ((k + 1) % NA), cc = a + NA, d = b + NA;
          idx.push(a, cc, b, b, cc, d);
        }
      // 산비탈 용암 줄기: 분화구에서 코스 쪽 비탈로 (구불구불)
      const toC = Math.atan2(center.z - V.z, center.x - V.x);
      for (let s = 0; s < V.streams; s++) {
        const a0 = toC + (s - (V.streams - 1) / 2) * (V.main ? 0.42 : 0.6) + (rand() - 0.5) * 0.15;
        let rEnd = V.R * (0.45 + rand() * 0.3);
        // 지평선 산줄기(지형 상자 + 400 m) 안으로 들어오기 전에 끝남 (가려진 비탈 위에 떠 보이지 않게)
        for (let r = V.cr; r <= rEnd; r += 5) {
          const wx = V.x + Math.cos(a0) * r, wz = V.z + Math.sin(a0) * r;
          if (wx > tb.min.x - 400 && wx < tb.max.x + 400 && wz > tb.min.y - 400 && wz < tb.max.y + 400) {
            rEnd = r - 10;
            break;
          }
        }
        const w0 = V.main ? 9 : 5;
        const vb = lavaPos.length / 3;
        let rows = 0;
        for (let r = V.cr * 0.9, v = 0; r <= rEnd; r += V.main ? 9 : 6, rows++) {
          const a = a0 + Math.sin(r / 70 + s * 2) * 0.05 + Math.sin(r / 23 + s) * 0.015;
          const w = (w0 + r * 0.02) * Math.min(1, (rEnd - r) / 60 + 0.25) / Math.max(r, 1);
          for (const da of [-w, 0, w]) {
            const aa = a + da;
            lavaPos.push(V.x + Math.cos(aa) * r, hAt(r, aa) - 8 + 2.6, V.z + Math.sin(aa) * r);
            lavaUv.push(da < 0 ? 0 : da > 0 ? 1 : 0.5, (r - V.cr) / 45);
          }
          if (rows > 0) {
            const p = vb + (rows - 1) * 3;
            for (let q = 0; q < 2; q++) lavaIdx.push(p + q, p + q + 3, p + q + 1, p + q + 1, p + q + 3, p + q + 4);
          }
          // 줄기를 따라 빛 몇 개
          if (rows % 9 === 4 && farGlowN < FAR_GLOW_N - 50) farGlow.set(farGlowN++, V.x + Math.cos(a) * r, hAt(r, a) - 2, V.z + Math.sin(a) * r, V.main ? 60 : 35, 0, cTmp.set('#ff5a14'), 0.35);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const volMat = hazeLambert({ fogScale: 0.55, glowGain: 2.2 });
    const mesh = new THREE.Mesh(g, volMat);
    mesh.name = 'volcanoMountains';
    group.add(mesh);
    // 산비탈 용암 (흐름 애니메이션)
    const lt = lavaTexture(41);
    lt.repeat.set(1, 1);
    const flowMat = new THREE.MeshBasicMaterial({ map: lt, color: '#ffd0a0', toneMapped: false, fog: false, side: THREE.DoubleSide });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lavaPos, 3));
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(lavaUv, 2));
    lg.setIndex(lavaIdx);
    const flow = new THREE.Mesh(lg, flowMat);
    flow.name = 'volcanoFlankLava';
    group.add(flow);
    // 분화구 용암 호수 (원판)
    const craterMat = new THREE.MeshBasicMaterial({ map: lt, color: '#ffffff', toneMapped: false, fog: false });
    for (const V of volcanoes) {
      const disk = new THREE.Mesh(new THREE.CircleGeometry(V.cr * 0.82, 28).rotateX(-Math.PI / 2), craterMat);
      disk.position.set(V.x, V.H - V.cd * 0.62 - 8, V.z);
      disk.name = 'volcanoCraterLava';
      group.add(disk);
    }
    animators.push((t) => {
      lt.offset.set(0, -t * 0.05);
    });
    stats.volcanoTris = idx.length / 3;
  }
  // 분화구 빛 (큰 화산은 2겹)
  const craterGlow = [];
  for (const V of volcanoes) {
    const top = V.H - 8;
    const k = farGlowN;
    farGlow.set(farGlowN++, V.x, top + 10, V.z, V.cr * (V.main ? 6 : 5), 0, cTmp.set('#ff6a1a'), 0.75);
    farGlow.set(farGlowN++, V.x, top + V.cr * 1.2, V.z, V.cr * (V.main ? 11 : 7), 0, cTmp.set('#ff3a0a'), 0.35);
    craterGlow.push({ k, V });
  }

  // ---------------------------------------------------------------- 연기 기둥 + 분화 (용암 덩어리)
  const BOMB_N = 40;
  const bombFirst = farGlowN;
  farGlowN += BOMB_N;
  const bombs = [];
  for (let i = 0; i < BOMB_N; i++) bombs.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s: 20 });
  const plumeCfg = [];
  {
    // 큰 화산 40개, 작은 화산 15개씩
    const wind = new THREE.Vector3(volDir.x * 0.6 + 0.5, 0, volDir.z * 0.6 - 0.2).normalize();
    let first = 0;
    volcanoes.forEach((V, vi) => {
      const n = V.main ? 56 : 15;
      plumeCfg.push({ V, first, n, life: V.main ? 80 : 45, rise: V.main ? 950 : 300, s0: V.main ? 120 : 35, s1: V.main ? 760 : 170, drift: V.main ? 700 : 200, wind, top: V.H - 8 });
      first += n;
    });
  }
  const erupt = { next: 9, flash: 0, n: 0 };
  const cSmokeLow = new THREE.Color('#a8502c'), cSmokeHigh = new THREE.Color('#2e2624'), cSmokeTop = new THREE.Color('#4a4240');
  animators.push((t, dt) => {
    const cam = window.game && window.game.camera;
    // 분화: 정해진 간격으로 용암 덩어리 발사 + 빛 번쩍
    if (t > erupt.next && t - erupt.next < 5) {
      erupt.next = t + 24 + Math.random() * 18;
      erupt.flash = 1;
      erupt.n++;
      const V = volcanoes[0];
      for (const b of bombs) {
        b.on = true;
        b.age = -Math.random() * 1.2;
        const a = Math.random() * TAU, sp = 35 + Math.random() * 85;
        b.x = V.x + Math.cos(a) * 15;
        b.z = V.z + Math.sin(a) * 15;
        b.y = V.H - 8;
        b.vx = Math.cos(a) * sp;
        b.vz = Math.sin(a) * sp;
        b.vy = 110 + Math.random() * 110;
        b.s = 24 + Math.random() * 26;
      }
    } else if (t < erupt.next - 60) erupt.next = t + 9; // 시간이 되감기면 (다시 시작)
    erupt.flash = Math.max(0, erupt.flash - dt * 0.45);
    for (let i = 0; i < BOMB_N; i++) {
      const b = bombs[i];
      if (!b.on) continue;
      b.age += dt;
      if (b.age < 0) continue;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.y += b.vy * dt;
      b.vy -= 55 * dt;
      const V = volcanoes[0];
      const r = Math.hypot(b.x - V.x, b.z - V.z);
      const ground = V.hAt(r, Math.atan2(b.z - V.z, b.x - V.x)) - 8;
      if (b.y < ground + 2 && b.vy < 0) b.on = false;
      farGlow.set(bombFirst + i, b.x, b.y, b.z, b.s, 0, cTmp.setRGB(1, 0.55, 0.18), b.on ? 1 : 0);
    }
    // 분화구 빛 깜빡임 + 분화 때 번쩍
    for (const { k, V } of craterGlow) {
      const f = 0.85 + Math.sin(t * 1.7 + V.seed) * 0.1 + Math.sin(t * 4.3 + V.seed * 2) * 0.05 + (V.main ? erupt.flash * 1.4 : 0);
      farGlow.alpha(k, 0.75 * f);
      farGlow.alpha(k + 1, 0.35 * f);
    }
    skyMat.uniforms.glowAmt.value = 1 + erupt.flash * 1.6;
    farGlow.flush();
    // 연기 기둥: 아래는 용암 빛에 주황, 위로 갈수록 회색·투명, 바람에 기울어짐
    for (const P of plumeCfg) {
      for (let q = 0; q < P.n; q++) {
        const f = (t / P.life + q / P.n) % 1;
        const i = P.first + q;
        const lean = f ** 1.4 * P.drift;
        const wob = Math.sin(q * 12.9 + t * 0.05) * P.s0 * 0.35 * (0.3 + f);
        const x = P.V.x + P.wind.x * lean + wob, z = P.V.z + P.wind.z * lean + Math.cos(q * 7.1) * P.s0 * 0.3 * f;
        const y = P.top + 15 + P.rise * (1 - (1 - f) ** 1.6);
        const s = P.s0 + (P.s1 - P.s0) * f ** 0.8;
        const a = Math.min(1, f / 0.06) * (1 - f) ** 1.1 * 0.82;
        cTmp.copy(cSmokeLow).lerp(cSmokeHigh, Math.min(1, f * 3.5)).lerp(cSmokeTop, Math.max(0, f - 0.5));
        if (P.V.main && f < 0.25) cTmp.lerp(cSmokeLow, erupt.flash * 0.8).multiplyScalar(1 + erupt.flash * 0.8 * (1 - f * 4));
        plume.set(i, x, y, z, s, q * 1.7 + t * 0.01 * (q % 2 ? 1 : -1), cTmp, a);
      }
    }
    if (cam) plume.sortFrom(cam.position, PLUME_N);
    plume.flush();
  });

  // ---------------------------------------------------------------- 출발 지역 자리 비우기 (바위가 건물 자리에 안 나게)
  for (let a = -200; a <= 200; a += 35)
    for (const sd of [-1, 1]) {
      const p = s0.pos.clone().addScaledVector(s0.tan, a).addScaledVector(s0.right, sd * 45);
      occupy(p.x, p.z, 38);
    }

  // ---------------------------------------------------------------- 바위·현무암 기둥·불탄 나무 (인스턴스)
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), sc4 = new THREE.Vector3(), n4 = new THREE.Vector3();
  {
    const basalt = new THREE.MeshLambertMaterial({ color: '#4d433d', flatShading: true });
    const obsidian = new THREE.MeshStandardMaterial({ color: '#2c2731', roughness: 0.3, metalness: 0.05, flatShading: true });
    const kinds = [
      { geo: rockGeo(11, 0), mat: basalt, n: 1300, s: [0.2, 0.7], min: 2, max: 40, far: 0.1, shadow: false, range: 170 },
      { geo: rockGeo(23, 1), mat: basalt, n: 520, s: [0.8, 2.8], min: 3, max: 80, far: 0.25, shadow: true, range: 420 },
      { geo: rockGeo(37, 1, 0.9), mat: obsidian, n: 380, s: [0.7, 2.6], min: 3, max: 60, far: 0.2, shadow: true, range: 420 },
      { geo: rockGeo(53, 1, 0.8), mat: basalt, n: 200, s: [3, 9], min: 5, max: 110, far: 0.3, shadow: true, range: 1400 },
      // 뾰족한 흑요석 바위 기둥 (위로 길쭉)
      { geo: rockGeo(71, 1, 2.6), mat: obsidian, n: 120, s: [1.5, 4], min: 5, max: 90, far: 0.3, shadow: true, range: 1100 },
    ];
    for (const k of kinds) {
      const im = new THREE.InstancedMesh(k.geo, k.mat, k.n);
      im.castShadow = k.shadow;
      im.receiveShadow = true;
      let n = 0, tries = 0;
      while (n < k.n && tries < k.n * 5) {
        tries++;
        const [x, z] = rand() < k.far ? farPoint() : nearRoadPoint(k.min, k.max);
        if (!inBox(x, z)) continue;
        const s = k.s[0] + rand() ** 2 * (k.s[1] - k.s[0]);
        const clear = roadClear(x, z);
        if (clear < k.min + s * 0.6) continue;
        if (s > 2.5 && !free(x, z, s)) continue;
        if (!free(x, z, 0)) continue;
        const y = lowGround(x, z, s * 0.6);
        if (y < LAVA + 1) continue;
        const ny = groundN(x, z, 2, n4).y;
        if (ny < 0.55 && s > 1.5) continue;
        e4.set(rand() * 0.6, rand() * TAU, rand() * 0.6);
        q4.setFromEuler(e4);
        sc4.set(s * (0.8 + rand() * 0.5), s * (0.65 + rand() * 0.6), s * (0.8 + rand() * 0.5));
        m4.compose(tmpV.set(x, y - s * 0.22, z), q4, sc4);
        im.setMatrixAt(n++, m4);
        if (s > 1.1 && clear < 40) solid(x, z, s * 0.8, y - 2, y + s * 1.1);
        if (s > 2.5) occupy(x, z, s);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
      rangeLOD(im, k.range);
    }
    // 분화구 호수 바위섬 (용암 위로 솟은 큰 바위 3개)
    const lake = track.lake;
    if (lake) {
      const im = new THREE.InstancedMesh(rockGeo(61, 1, 1.3), basalt, 4);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.6, d = lake.r * (k === 0 ? 0.05 : 0.38 + rand() * 0.12);
        const x = lake.x + Math.cos(a) * d, z = lake.z + Math.sin(a) * d;
        const s = k === 0 ? 11 : 5 + rand() * 4;
        if (roadClear(x, z) < 15) continue;
        e4.set(rand() * 0.3, rand() * TAU, rand() * 0.3);
        m4.compose(tmpV.set(x, LAVA - s * 0.35, z), q4.setFromEuler(e4), sc4.set(s, s * 1.2, s));
        im.setMatrixAt(k, m4);
        addSteam(x, LAVA + s * 0.4, z, { n: 3, life: 7, rise: 30, s0: 4, s1: 18, a: 0.25, color: '#d6b8a0' });
      }
      group.add(im);
      for (let k = 0; k < 10; k++) {
        const a = rand() * TAU, d = rand() * lake.r * 0.8;
        addNearGlow(lake.x + Math.cos(a) * d, LAVA + 2, lake.z + Math.sin(a) * d, 30 + rand() * 25, '#ff6a1a', 0.22);
      }
    }
  }
  // 현무암 기둥 무리 (육각 기둥이 빽빽하게 솟음)
  {
    const geo = basaltColumnGeo();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: '#8f8580' });
    const MAXC = 1300;
    const im = new THREE.InstancedMesh(geo, mat, MAXC);
    im.castShadow = true;
    im.receiveShadow = true;
    let n = 0, clusters = 0, tries = 0;
    while (clusters < 80 && tries < 900 && n < MAXC - 30) {
      tries++;
      const [x, z] = rand() < 0.25 ? farPoint() : nearRoadPoint(6, 60);
      if (!inBox(x, z, 30)) continue;
      const cr = 2.5 + rand() * 4;
      const clear = roadClear(x, z);
      if (clear < 5 + cr) continue;
      if (!free(x, z, cr + 2)) continue;
      const yc = groundY(x, z);
      if (yc < LAVA + 3) continue;
      if (groundN(x, z, 3, n4).y < 0.5) continue;
      const rc = 0.7 + rand() * 0.5;
      const hMax = 4 + rand() * 12;
      const tilt = (rand() - 0.5) * 0.2, tiltDir = rand() * TAU;
      const yaw = rand() * TAU;
      let minY = Infinity;
      const before = n;
      // 육각 격자로 채움
      const step = rc * 1.78;
      for (let gx = -cr; gx <= cr && n < MAXC; gx += step)
        for (let gz = -cr; gz <= cr && n < MAXC; gz += step * 0.866) {
          const ox = gx + ((Math.round(gz / (step * 0.866)) & 1) ? step / 2 : 0);
          const d = Math.hypot(ox, gz);
          if (d > cr || n - before >= 22) continue;
          const px = x + Math.cos(yaw) * ox - Math.sin(yaw) * gz, pz = z + Math.sin(yaw) * ox + Math.cos(yaw) * gz;
          const gy = lowGround(px, pz, rc);
          if (gy < LAVA + 1) continue;
          minY = Math.min(minY, gy);
          // 가운데가 높고 바깥이 낮은 계단 모양
          const h = Math.max(0.8, hMax * (1 - (d / cr) ** 1.5) * (0.75 + rand() * 0.35) + (rand() < 0.15 ? -hMax * 0.4 : 0));
          e4.set(Math.cos(tiltDir) * tilt, rand() * TAU, Math.sin(tiltDir) * tilt);
          m4.compose(tmpV.set(px, gy - 1.2, pz), q4.setFromEuler(e4), sc4.set(rc * (0.92 + rand() * 0.1), h + 1.2, rc * (0.92 + rand() * 0.1)));
          im.setMatrixAt(n++, m4);
        }
      if (n === before) continue;
      clusters++;
      occupy(x, z, cr + 1);
      if (clear < 40) solid(x, z, cr + 0.6, minY - 2, minY + hMax + 1);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
    rangeLOD(im, 1000);
    stats.columns = n;
    stats.columnClusters = clusters;
  }
  // 불탄 나무 (두 모양)
  {
    const mat = new THREE.MeshLambertMaterial({ color: '#2a1e18', flatShading: true });
    let total = 0;
    for (const seed of [5, 17]) {
      const im = new THREE.InstancedMesh(deadTreeGeo(seed), mat, 170);
      let n = 0, tries = 0;
      while (n < 170 && tries < 900) {
        tries++;
        const [x, z] = rand() < 0.3 ? farPoint() : nearRoadPoint(5, 90);
        if (!inBox(x, z)) continue;
        const clear = roadClear(x, z);
        if (clear < 4.5) continue;
        if (!free(x, z, 1)) continue;
        const y = groundY(x, z);
        if (y < LAVA + 4) continue;
        if (groundN(x, z, 1.5, n4).y < 0.8) continue;
        const s = 0.8 + rand() * 0.7;
        e4.set((rand() - 0.5) * 0.25, rand() * TAU, (rand() - 0.5) * 0.25);
        m4.compose(tmpV.set(x, y, z), q4.setFromEuler(e4), sc4.set(s, s * (0.9 + rand() * 0.4), s));
        im.setMatrixAt(n++, m4);
        if (clear < 30) solid(x, z, 0.4 * s, y - 1, y + 6 * s);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
      rangeLOD(im, 650);
      total += n;
    }
    stats.trees = total;
  }

  // ---------------------------------------------------------------- 용암 줄기: 높은 곳에서 비탈을 따라 흘러내려 용암 바다로 (절벽이면 용암 폭포)
  {
    const pos = [], uv = [], idx = [];
    let made = 0, tries = 0;
    const ends = [];
    while (made < 26 && tries < 1400) {
      tries++;
      const [sx, sz] = rand() < 0.6 ? nearRoadPoint(14, 120) : farPoint();
      if (!inBox(sx, sz, 40)) continue;
      const y0 = groundY(sx, sz);
      if (y0 < LAVA + 10) continue;
      if (roadClear(sx, sz) < 14) continue;
      // 근처 40 m 안에 용암이 있는 곳만 (절벽 끝에서 떨어지는 줄기가 되게)
      let lavaNear = false;
      for (let k = 0; k < 8 && !lavaNear; k++) if (groundY(sx + Math.cos((k / 8) * TAU) * 40, sz + Math.sin((k / 8) * TAU) * 40) < LAVA) lavaNear = true;
      if (!lavaNear) continue;
      // 가장 가파른 내리막을 따라 걸어감
      const path = [[sx, sz]];
      let x = sx, z = sz, ok = false, dir = null, stall = 0, lastY = y0;
      for (let st = 0; st < 260; st++) {
        const gx = groundY(x + 1.5, z) - groundY(x - 1.5, z), gz = groundY(x, z + 1.5) - groundY(x, z - 1.5);
        let dx = -gx, dz = -gz;
        const L = Math.hypot(dx, dz);
        if (L < 1e-3) break;
        dx /= L;
        dz /= L;
        if (dir) {
          dx = dir[0] * 0.55 + dx * 0.45;
          dz = dir[1] * 0.55 + dz * 0.45;
          const l2 = Math.hypot(dx, dz);
          dx /= l2;
          dz /= l2;
        }
        dir = [dx, dz];
        x += dx * 1.6;
        z += dz * 1.6;
        if (!inBox(x, z, 5)) break;
        if (roadClear(x, z) < 8) break;
        const y = groundY(x, z);
        path.push([x, z]);
        if (y < LAVA - 0.2) {
          // 용암에 닿음 → 조금 더 들어가서 끝
          for (let e = 0; e < 3; e++) path.push([(x += dx * 1.6), (z += dz * 1.6)]);
          ok = true;
          break;
        }
        stall = y > lastY - 0.05 ? stall + 1 : 0;
        lastY = Math.min(lastY, y);
        if (stall > 6) break;
      }
      if (!ok || path.length < 14) continue;
      // 이미 만든 줄기와 너무 가까우면 버림
      const [ex, ez] = path[path.length - 1];
      if (ends.some(([a, b]) => (a - ex) ** 2 + (b - ez) ** 2 < 45 * 45)) continue;
      ends.push([ex, ez]);
      made++;
      // 리본 (가운데 + 양옆, 땅 위 0.45 m)
      const W = 2 + rand() * 2.4;
      const vb = pos.length / 3;
      let dist = 0;
      for (let k = 0; k < path.length; k++) {
        const [px, pz] = path[k];
        const [ax, az] = path[Math.max(0, k - 1)], [bx, bz] = path[Math.min(path.length - 1, k + 1)];
        let tx = bx - ax, tz = bz - az;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        if (k) dist += Math.hypot(px - path[k - 1][0], pz - path[k - 1][1]);
        const w = W * Math.min(1, 0.35 + k / 8) * (1 + Math.sin(k * 0.7) * 0.12);
        for (const u of [-1, 0, 1]) {
          const vx = px - tz * w * u, vz = pz + tx * w * u;
          pos.push(vx, Math.max(groundY(vx, vz) + 0.32, LAVA + 0.25), vz);
          uv.push((u + 1) / 2, dist / 9);
        }
        if (k) {
          const p = vb + (k - 1) * 3;
          for (let q = 0; q < 2; q++) idx.push(p + q, p + q + 3, p + q + 1, p + q + 1, p + q + 3, p + q + 4);
        }
        if (k % 12 === 6) addNearGlow(px, groundY(px, pz) + 2.5, pz, 9 + W * 2, '#ff6a1a', 0.3);
      }
      addNearGlow(ex, LAVA + 3, ez, 26, '#ff7a1a', 0.35);
      addSteam(ex, LAVA + 0.5, ez, { n: 4, life: 6, rise: 18, s0: 3, s1: 12, a: 0.3, color: '#d9b49a' });
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const t = lavaTexture(57);
      t.repeat.set(1, 1);
      const mat = new THREE.MeshBasicMaterial({ map: t, color: '#ffffff', toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const m = new THREE.Mesh(g, mat);
      m.name = 'volcanoLavaStreams';
      group.add(m);
      animators.push((time) => {
        t.offset.set(0, -time * 0.18);
        mat.color.setScalar(0.88 + Math.sin(time * 2.1) * 0.08);
      });
    }
    stats.lavaStreams = made;
  }

  // ---------------------------------------------------------------- 바닥 무늬: 빛나는 용암 균열·유황 얼룩 (땅에 붙은 판, 평평한 곳만)
  function decals({ n, tex, size, near, far, additive, color, name, minClear = 2.5, lavaAbove = 1 }) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color, transparent: true, depthWrite: false, toneMapped: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.name = name;
    let k = 0, tries = 0;
    const list = [];
    while (k < n && tries < n * 8) {
      tries++;
      const [x, z] = rand() < far ? farPoint() : nearRoadPoint(minClear, near);
      if (!inBox(x, z)) continue;
      const s = size[0] + rand() * (size[1] - size[0]);
      if (roadClear(x, z) < minClear + s * 0.5) continue;
      const y = groundY(x, z);
      if (y < LAVA + lavaAbove) continue;
      const nrm = groundN(x, z, s * 0.35, n4);
      if (nrm.y < 0.8) continue;
      // 판이 땅에서 뜨거나 묻히지 않게: 둘레 8곳이 평면에서 0.12 m 안이어야
      let okp = true;
      for (let a = 0; a < 8 && okp; a++) {
        const px = x + Math.cos((a / 8) * TAU) * s * 0.5, pz = z + Math.sin((a / 8) * TAU) * s * 0.5;
        const pred = y - (nrm.x * (px - x) + nrm.z * (pz - z)) / nrm.y;
        if (Math.abs(groundY(px, pz) - pred) > 0.12) okp = false;
      }
      if (!okp) continue;
      q4.setFromUnitVectors(UP, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(UP, rand() * TAU));
      m4.compose(tmpV.set(x, y + 0.1, z), q4, sc4.set(s, 1, s));
      im.setMatrixAt(k++, m4);
      list.push({ x, y, z, s });
    }
    im.count = k;
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
    rangeLOD(im, additive ? 380 : 480);
    return { im, mat, list };
  }
  const cracks = decals({ n: 260, tex: TX.crack, size: [3, 7], near: 60, far: 0.25, additive: true, color: '#ffffff', name: 'volcanoCracks' });
  const cracks2 = decals({ n: 140, tex: TX.crack2, size: [2.5, 5], near: 40, far: 0.2, additive: true, color: '#ffffff', name: 'volcanoCracks2' });
  const sulfur = decals({ n: 160, tex: TX.sulfur, size: [4, 10], near: 70, far: 0.3, additive: false, color: '#ffffff', name: 'volcanoSulfur', lavaAbove: 3 });
  for (const c of cracks.list) if (rand() < 0.35) addNearGlow(c.x, c.y + 1.2, c.z, c.s * 1.6, '#ff5a10', 0.18);
  animators.push((t) => {
    const p = 0.75 + Math.sin(t * 1.6) * 0.18 + Math.sin(t * 4.1) * 0.07;
    cracks.mat.color.setScalar(p);
    cracks2.mat.color.setScalar(1.6 - p);
  });
  stats.decals = cracks.list.length + cracks2.list.length + sulfur.list.length;

  // ---------------------------------------------------------------- 유황 증기 구멍: 노란 돌 무더기 + 피어오르는 김
  {
    const moundGeo = new THREE.ConeGeometry(1, 0.7, 7, 1, true).translate(0, 0.25, 0);
    const moundMat = new THREE.MeshLambertMaterial({ color: '#b39a3c', flatShading: true, side: THREE.DoubleSide });
    const holeMat = new THREE.MeshBasicMaterial({ color: '#ffb040', toneMapped: false });
    const VN = 46;
    const im = new THREE.InstancedMesh(moundGeo, moundMat, VN);
    const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 8).rotateX(-Math.PI / 2), holeMat, VN);
    holes.name = 'volcanoVentHoles';
    let n = 0, tries = 0;
    // 1) 유황 얼룩 가운데에 먼저
    const spots = sulfur.list.slice(0, 26).map((s) => [s.x, s.z]);
    while (n < VN && tries < 900) {
      tries++;
      const [x, z] = spots.length ? spots.shift() : nearRoadPoint(5, 45);
      if (!inBox(x, z)) continue;
      if (roadClear(x, z) < 5) continue;
      const y = lowGround(x, z, 1.4);
      if (y < LAVA + 2) continue;
      if (groundN(x, z, 1.5, n4).y < 0.75) continue;
      const s = 1.2 + rand() * 1.4;
      m4.compose(tmpV.set(x, y - 0.15, z), q4.setFromAxisAngle(UP, rand() * TAU), sc4.set(s, s * (0.8 + rand() * 0.5), s));
      im.setMatrixAt(n, m4);
      m4.compose(tmpV.set(x, y + 0.45 * s * 0.9, z), q4.identity(), sc4.set(s, 1, s));
      holes.setMatrixAt(n, m4);
      n++;
      const hot = rand() < 0.3;
      addSteam(x, y + 0.6, z, { n: hot ? 6 : 5, life: 4 + rand() * 2.5, rise: 10 + rand() * 10, s0: 1.6, s1: 8 + rand() * 5, a: 0.5, color: hot ? '#ffcf9a' : '#efe6c8' });
      if (hot) addNearGlow(x, y + 0.8, z, 5, '#ff8a2a', 0.3);
    }
    im.count = holes.count = n;
    im.instanceMatrix.needsUpdate = holes.instanceMatrix.needsUpdate = true;
    group.add(im, holes);
    rangeLOD(im, 500);
    rangeLOD(holes, 500);
    stats.vents = n;
    animators.push((t) => holeMat.color.setRGB(1, 0.55 + Math.sin(t * 3) * 0.12, 0.2));
  }

  // ---------------------------------------------------------------- 용암 바다·협곡 위 은은한 빛 (코스 옆에서 보이는 곳)
  {
    let k = 0, tries = 0;
    while (k < 90 && tries < 2500 && nearGlowN < NEAR_GLOW_N - 10) {
      tries++;
      const [x, z] = nearRoadPoint(6, 80, 1);
      if (!inBox(x, z)) continue;
      if (groundY(x, z) > LAVA - 0.5) continue;
      if (roadClear(x, z) < 6) continue;
      addNearGlow(x, LAVA + 4 + rand() * 4, z, 34 + rand() * 30, rand() < 0.5 ? '#ff5a10' : '#ff7a20', 0.16);
      if (rand() < 0.25) addSteam(x, LAVA + 0.5, z, { n: 3, life: 7, rise: 22, s0: 5, s1: 16, a: 0.18, color: '#c89a82' });
      k++;
    }
    stats.lavaGlows = k;
  }

  // ---------------------------------------------------------------- 출발 게이트 (빨간불 5개, 운전자 기준 왼쪽부터)
  const HW0 = s0.hw, KB = Math.max(kerb(0, -1), kerb(0, 1));
  const gantry = (() => {
    const span = HW0 + KB + 4.2;
    const g = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(1.3, 10, 1.3);
    for (const sd of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, M.dark);
      leg.position.set(sd * span, 5, 0);
      leg.castShadow = true;
      g.add(leg);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 9, 0.22), M.orangeGlow);
      strip.position.set(sd * (span - 0.7), 5, 0.7);
      g.add(strip);
      const strip2 = strip.clone();
      strip2.position.z = -0.7;
      g.add(strip2);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 2.4), M.hazard);
      foot.position.set(sd * span, 0.3, 0);
      g.add(foot);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.4, 2.4, 1.3), M.dark);
    beam.position.y = 9;
    beam.castShadow = true;
    g.add(beam);
    const signTex = titleTexture(['VULCAN GRAND PRIX', '화산 지대 · 1바퀴 생존 레이스'], { w: 1024, h: 128 });
    for (const zz of [-0.67, 0.67]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, 2.1), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
      sign.position.set(0, 11.4, zz);
      if (zz < 0) sign.rotation.y = Math.PI; // 다가오는 차 쪽(-z)을 봄
      g.add(sign);
    }
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.4, 2.3, 1.2), M.dark);
    signBack.position.y = 11.4;
    g.add(signBack);
    // 전구 10개 = 인스턴스 1묶음 (색만 바꿈)
    const C_OFF = new THREE.Color('#3a0a06'), C_ON = new THREE.Color('#ff2414').multiplyScalar(1.6), C_GREEN = new THREE.Color('#2bff6a').multiplyScalar(1.4);
    const bulbIm = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 20).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 10);
    bulbIm.name = 'volcanoStartBulbs';
    bulbIm.userData.noBatch = true;
    g.add(bulbIm);
    const pods = [];
    for (let k = 0; k < 5; k++) {
      // 게이트 로컬 +z = 진행 방향, 로컬 +x = 운전자 왼쪽 → 0번(가장 먼저 켜짐)이 운전자 왼쪽 끝
      const x = (2 - k) * 1.6;
      const pod = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.7), M.dark);
      pod.position.set(x, 6.8, -0.3);
      g.add(pod);
      const bulbs = [];
      for (const by of [7.35, 6.25]) {
        const bi = k * 2 + bulbs.length;
        bulbIm.setMatrixAt(bi, new THREE.Matrix4().makeTranslation(x, by, -0.66));
        bulbIm.setColorAt(bi, C_OFF);
        bulbs.push(bi);
      }
      pods.push(bulbs);
    }
    const paint = (fn) => {
      pods.forEach((bl, k) => bl.forEach((bi) => bulbIm.setColorAt(bi, fn(k))));
      bulbIm.instanceColor.needsUpdate = true;
    };
    const basis = new THREE.Matrix4().makeBasis(s0.right.clone().negate(), UP, s0.tan.clone());
    g.quaternion.setFromRotationMatrix(basis);
    g.position.copy(s0.pos);
    g.position.y -= 0.05;
    group.add(g);
    for (const sd of [-1, 1]) {
      const p = s0.pos.clone().addScaledVector(s0.right, sd * span);
      solid(p.x, p.z, 0.9, p.y - 1, p.y + 10); // 게이트 다리
    }
    let lastN = -1, lastG = null;
    return {
      setLights(n) {
        if (n === lastN) return;
        lastN = n;
        paint((k) => (k < n ? C_ON : C_OFF));
      },
      setGreen(gr) {
        if (gr === lastG) return;
        lastG = gr;
        if (gr) paint(() => C_GREEN);
        else lastN = -1;
      },
    };
  })();
  animators.push(() => {
    const race = window.game && window.game.race;
    if (!race) return;
    if (race.phase === 'countdown') {
      gantry.setGreen(false);
      gantry.setLights(race.lights ?? 0);
    } else {
      const gr = race.phase === 'racing' && race.time < 4;
      gantry.setGreen(gr);
      if (!gr) gantry.setLights(0);
    }
  });

  // ---------------------------------------------------------------- 출발 직선 도우미: along(진행 방향 m), lat(+ = 오른쪽)
  const inner = Math.sign(new THREE.Vector3().subVectors(center, s0.pos).dot(s0.right)) || 1; // 코스 안쪽
  const outer = -inner;
  const atStart = (along, lat) => s0.pos.clone().addScaledVector(s0.tan, along).addScaledVector(s0.right, lat);
  /** 출발 직선 옆 그룹: 로컬 +z = 도로에서 멀어지는 쪽, 로컬 -z 면이 도로를 봄 */
  function sideFrame(along, dist, side, obj) {
    const p = atStart(along, side * dist);
    const X = s0.tan.clone().multiplyScalar(side), Z = s0.right.clone().multiplyScalar(side);
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, UP, Z));
    obj.position.set(p.x, 0, p.z);
    return p;
  }
  const box = (w, h, d, mat, x, y, z, parent, cast = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const cyl = (r0, r1, h, seg, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const roadSideY = (along, lat) => {
    const p = atStart(along, lat);
    return lowGround(p.x, p.z, 3);
  };
  const updaters = [];
  /** 그룹 안 로컬 자리 (lx, lz)에 원기둥 충돌체 */
  function localSolid(obj, lx, lz, r, h) {
    obj.updateMatrixWorld(true);
    const p = obj.localToWorld(new THREE.Vector3(lx, 0, lz));
    solid(p.x, p.z, r, obj.position.y - 2, obj.position.y + h);
  }

  // ---------------------------------------------------------------- VULCAN BASE 연구 기지 (출발 직선 바깥쪽)
  {
    const D0 = HW0 + KB + 16; // 건물 앞면까지 거리
    const g = new THREE.Group();
    const along = -40;
    sideFrame(along, D0, outer, g);
    const gy = Math.min(roadSideY(along - 35, outer * D0), roadSideY(along + 35, outer * D0), roadSideY(along, outer * (D0 + 10)));
    g.position.y = gy - 0.1;
    const L = 76, Dd = 15, H = 8.5;
    box(L, H, Dd, M.concrete, 0, H / 2, Dd / 2, g);
    // 창문 띠 (도로 쪽)
    const win = new THREE.Mesh(new THREE.PlaneGeometry(L - 6, 3.2), windowMat);
    win.position.set(0, H * 0.58, -0.03);
    win.rotation.y = Math.PI;
    g.add(win);
    winTex.repeat.set(L / 14, 1);
    // 주황 줄무늬 지붕 테두리 + 간판
    box(L + 0.6, 0.9, 0.6, M.orange, 0, H + 0.45, -0.1, g, false);
    box(L + 0.6, 0.5, Dd + 0.6, M.dark, 0, H + 0.25, Dd / 2, g, false);
    const tTex = titleTexture(['VULCAN BASE', '화산 연구 기지 · 지진 관측소'], { w: 1024, h: 192 });
    const title = new THREE.Mesh(new THREE.PlaneGeometry(30, 5.6), new THREE.MeshBasicMaterial({ map: tTex, toneMapped: false }));
    title.position.set(-8, H + 4.2, 1.2);
    title.rotation.y = Math.PI;
    g.add(title);
    box(30.6, 6, 0.5, M.dark, -8, H + 4.2, 1.5, g);
    for (const x of [-20, 4]) box(0.4, 3.5, 0.4, M.steel, x, H + 1.5, 1.6, g);
    // 지붕 기계 (환기구·냉각기)
    for (let k = 0; k < 6; k++) box(3 + rand() * 3, 1.4 + rand(), 3, M.steel, -30 + k * 11, H + 1.1, 9 + rand() * 3, g);
    // 셔터 문 (차고)
    for (let k = 0; k < 4; k++) {
      const door = box(7, 5.5, 0.3, M.hazard, 14 + k * 0, 2.75, -0.2, g, false);
      door.position.x = 10 + k * 7.6;
      door.scale.y = 0.98;
    }
    win.position.x = -12;
    win.scale.x = 0.62;
    // 관측탑 (기지 끝, 꼭대기 유리방 + 안테나)
    const tw = new THREE.Group();
    tw.position.set(-L / 2 - 6, 0, 8);
    g.add(tw);
    box(7, 20, 7, M.concrete, 0, 10, 0, tw);
    box(9.5, 4, 9.5, M.glass, 0, 22, 0, tw);
    box(10.2, 0.6, 10.2, M.dark, 0, 24.3, 0, tw);
    box(10.2, 0.4, 10.2, M.orange, 0, 19.8, 0, tw, false);
    const ant = antennaMast({ height: 16 });
    ant.obj.position.set(0, 24.6, 0);
    tw.add(ant.obj);
    if (ant.update) updaters.push(ant.update);
    group.add(g);
    // 충돌 (건물 앞면을 따라 원 여러 개)
    for (let u = -L / 2 - 8; u <= L / 2; u += 8) {
      const p = atStart(along + u * outer, outer * (D0 + 7.5));
      solid(p.x, p.z, 8, gy - 2, gy + 26);
    }
    // 뒤쪽: 관측 돔, 레이더, 연료 탱크, 컨테이너, 트럭
    const backY = (a, d) => roadSideY(a, outer * d);
    const obs = observatory();
    const o1 = new THREE.Group();
    sideFrame(along - 18, D0 + 34, outer, o1);
    o1.position.y = backY(along - 18, D0 + 34) - 0.2;
    o1.add(obs.obj);
    // 달 기지용 보라색을 화산 기지 색으로
    obs.obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      const h = o.material.color.getHexString();
      if (h === '8b5cff' || h === '5b4bb5') o.material.color.set('#ff7a1a');
      else if (h === 'e9e4f2' || h === 'f8f9fc') o.material.color.set(h === 'e9e4f2' ? '#8c837e' : '#c9c2bd');
    });
    group.add(o1);
    localSolid(o1, 0, 0, 8, 16);
    if (obs.update) updaters.push(obs.update);
    const rd = radarDish({ size: 0.9 });
    const o2 = new THREE.Group();
    sideFrame(along + 22, D0 + 32, outer, o2);
    o2.position.y = backY(along + 22, D0 + 32) - 0.2;
    o2.add(rd.obj);
    group.add(o2);
    localSolid(o2, 0, 0, 3, 18);
    updaters.push(rd.update);
    // 연료 탱크 3개 (주황 띠)
    const tanks = new THREE.Group();
    sideFrame(along + 48, D0 + 10, outer, tanks);
    tanks.position.y = backY(along + 48, D0 + 14) - 0.2;
    for (let k = 0; k < 3; k++) {
      cyl(3.2, 3.2, 9, 16, M.steel, k * 7.5, 4.5, 5, tanks);
      cyl(3.25, 3.25, 0.8, 16, M.orange, k * 7.5, 6.5, 5, tanks);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 6, 0, TAU, 0, Math.PI / 2), M.steel);
      cap.position.set(k * 7.5, 9, 5);
      tanks.add(cap);
    }
    group.add(tanks);
    for (let k = 0; k < 3; k++) localSolid(tanks, k * 7.5, 5, 3.4, 11);
    // 컨테이너 더미
    const cont = new THREE.Group();
    sideFrame(along - 75, D0 + 4, outer, cont);
    cont.position.y = backY(along - 75, D0 + 8) - 0.1;
    const cCols = ['#c4471c', '#2f3c48', '#d99a1c', '#5b2a22'];
    for (let k = 0; k < 7; k++) {
      const lvl = k < 4 ? 0 : 1;
      const m = box(6, 2.6, 2.5, new THREE.MeshLambertMaterial({ color: cCols[k % 4] }), (k % 4) * 0.4 + (lvl ? 0.8 : 0), 1.3 + lvl * 2.6, 2 + (k % 4) * 2.7 - lvl * 1.2, cont);
      m.rotation.y = (rand() - 0.5) * 0.1;
    }
    group.add(cont);
    localSolid(cont, 0.6, 2, 4, 6);
    localSolid(cont, 0.6, 7.5, 4, 6);
  }

  // ---------------------------------------------------------------- 관중석 (출발 직선 안쪽, gpAssets 관중석: 응원하는 관중)
  const stands = [];
  for (const [along, len] of [[-55, 64], [62, 44]]) {
    const side = inner;
    const s = s0;
    const front = HW0 + KB + 6;
    const p = atStart(along, side * front);
    const y = Math.min(roadSideY(along - len / 2, side * front), roadSideY(along + len / 2, side * front), roadSideY(along, side * (front + 8)));
    const st = grandstand({ length: len, roofColor: '#ff6a14' });
    // 관중석 광고 띠 (구름섬 글자) → 화산 지대 글자로 다시 그림 (한 페이지에 맵 하나라 공유 그림을 바꿔도 됨)
    st.obj.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        const img = m.map && m.map.image;
        if (!img || !img.getContext || img.width !== 1024 || img.height !== 128 || img.__volcano) continue;
        img.__volcano = true;
        const c = img.getContext('2d'), w = img.width, h = img.height;
        const blocks = [['#ff6a14', '#141012', 'VULCAN GP'], ['#141012', '#ff8a1a', '화산 지대'], ['#ffc21a', '#141012', 'LAVA RUN'], ['#3a2a26', '#ffffff', 'VULCAN BASE']];
        const bw = w / blocks.length;
        blocks.forEach(([bg, fg, text], i) => {
          c.fillStyle = bg;
          c.fillRect(i * bw, 0, bw, h);
          c.fillStyle = fg;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          let fs = 64;
          do c.font = `900 ${fs}px "Malgun Gothic", sans-serif`;
          while (c.measureText(text).width > bw * 0.86 && (fs -= 4) > 10);
          c.fillText(text, i * bw + bw / 2, h / 2 + 4);
          c.fillStyle = 'rgba(0,0,0,0.2)';
          c.fillRect(i * bw, h - 10, bw, 10);
        });
        m.map.needsUpdate = true;
      }
    });
    st.obj.position.set(p.x, y - 0.05, p.z);
    st.obj.rotation.y = yawOf(s) + (side > 0 ? Math.PI : 0);
    group.add(st.obj);
    const hd = st.halfDepth || 7;
    for (let u = -len / 2; u <= len / 2; u += hd * 1.4) {
      const c = atStart(along + u, side * (front + hd));
      solid(c.x, c.z, hd + 0.5, y - 2, y + (st.height || 14));
    }
    stands.push({ st, c: atStart(along, side * (front + hd)) });
  }
  animators.push((time, dt, car) => {
    for (const { st, c } of stands) {
      const d = car ? car.pos.distanceTo(c) : 999;
      st.excite = THREE.MathUtils.lerp(st.excite || 0, d < 90 ? 1 : 0.1, 1 - Math.exp(-4 * dt));
      if (st.update) st.update(time, dt, st.excite);
      // 멀리서는 관중(삼각형이 많음)을 숨김
      if (!st.crowd) st.obj.traverse((o) => o.isInstancedMesh && (st.crowd = st.crowd || []).push(o));
      const camP = window.game && window.game.camera ? window.game.camera.position : car ? car.pos : null;
      const far = camP ? camP.distanceTo(c) > 650 : false;
      if (st.crowd) for (const o of st.crowd) o.visible = !far;
    }
  });

  // ---------------------------------------------------------------- 깃발 (출발 직선 양쪽) + 조명탑
  {
    const spots = [];
    for (let a = -170; a <= 170; a += 20) {
      if (Math.abs(a) < 8) continue; // 게이트 자리
      for (const sd of [-1, 1]) spots.push([a, sd]);
    }
    const poleIm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 8, 6).translate(0, 4, 0), M.steel, spots.length);
    const bTex = [bannerTexture('#ff6a14', '#141012'), bannerTexture('#141012', '#ff8a1a')];
    const banners = bTex.map((t) => new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 4.5).translate(0.8, 5.2, 0), new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }), spots.length));
    const cnt = [0, 0];
    spots.forEach(([a, sd], k) => {
      const lat = sd * (HW0 + KB + 3.6);
      const p = atStart(a, lat);
      const y = groundY(p.x, p.z);
      m4.compose(tmpV.set(p.x, y - 0.2, p.z), q4.identity(), sc4.set(1, 1, 1));
      poleIm.setMatrixAt(k, m4);
      // 깃발은 도로와 나란히 (진행 방향으로 펄럭이는 모양)
      q4.setFromAxisAngle(UP, yawOf(s0) + Math.PI / 2 + (rand() - 0.5) * 0.3);
      m4.compose(tmpV.set(p.x, y - 0.2, p.z), q4, sc4.set(1, 1, 1));
      const b = k % 2;
      banners[b].setMatrixAt(cnt[b]++, m4);
      solid(p.x, p.z, 0.25, y - 1, y + 8);
    });
    banners.forEach((b, i) => {
      b.count = cnt[i];
      b.instanceMatrix.needsUpdate = true;
    });
    group.add(poleIm, ...banners);
    // 조명탑 (빛 덩어리는 빌보드, 진짜 빛은 없음)
    const lightSpots = [[-120, outer], [-10, outer], [95, outer], [-120, inner], [8, inner], [120, inner]];
    for (const [a, sd] of lightSpots) {
      const d = HW0 + KB + 9;
      const t = new THREE.Group();
      sideFrame(a, d, sd, t);
      const y = roadSideY(a, sd * d);
      t.position.y = y - 0.2;
      box(0.9, 26, 0.9, M.dark, 0, 13, 0, t);
      box(2.6, 0.5, 2.6, M.hazard, 0, 0.25, 0, t, false);
      const head = new THREE.Group();
      head.position.set(0, 26, -0.6);
      head.rotation.x = 0.35;
      t.add(head);
      box(6, 3, 0.6, M.dark, 0, 0, 0, head);
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < 4; c++) {
          const l = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.1), M.lampGlow);
          l.position.set(-2.1 + c * 1.4, 0.65 - r * 1.3, -0.31);
          l.rotation.y = Math.PI;
          head.add(l);
        }
      group.add(t);
      const hp = atStart(a, sd * (d - 0.8));
      addNearGlow(hp.x, y + 26, hp.z, 16, '#ffe6b8', 0.55);
      const cp = atStart(a, sd * d);
      solid(cp.x, cp.z, 0.8, y - 1, y + 26);
    }
  }

  // ---------------------------------------------------------------- 위험 표지판 (점프·칼날 능선·분화구) + 헤어핀 쉐브론
  const secs = track.data.sections || {};
  const secI = (name, k = 0) => (secs[name] ? track.indexAt(secs[name][k]) : null);
  /**
   * 표지판 자리 찾기: i에서 뒤로 maxBack m까지 훑으며 한쪽(먼저 prefer) 가장자리 밖에 땅이 있는 곳
   *   열린 쪽·가드레일 쪽 = 기둥 2개로 세움, 바위벽 = 벽에 붙임, 낭떠러지·용암 = 못 세움
   *   돌려줌: { i, side, kind: 'post'|'wall', lat }
   */
  function signSpot(i0, prefer, maxBack, W) {
    const step = 2;
    for (let k = 0; k <= track.mS(maxBack); k += step) {
      const i = track.wrapI(i0 - k);
      if (S[i].gap) continue;
      for (const side of [prefer, -prefer]) {
        const e = track.edgeAt(i, side);
        const rail = track.railSide && track.railSide[side < 0 ? 0 : 1][i];
        if (e === EDGE.wall) {
          const lat = edgeLat(i, side) + 0.35; // 바위벽 면
          return { i, side, kind: 'wall', lat };
        }
        if (e === EDGE.cliff && !rail) continue;
        if (e === EDGE.lava) continue;
        const lat0 = edgeLat(i, side) + (rail ? 1.9 : 3.2);
        const s = S[i];
        const roadEdgeY = track.roadYAt(s, side * edgeLat(i, side));
        let ok = true;
        for (const d of [lat0, lat0 + W * 0.5, lat0 + W]) {
          const x = s.pos.x + s.right.x * side * d, z = s.pos.z + s.right.z * side * d;
          const gy = groundY(x, z);
          if (!(gy > roadEdgeY - 1.6 && gy < roadEdgeY + 2.5)) ok = false;
          if (roadClear(x, z) < d - edgeLat(i, side) - 0.6) ok = false; // 다른 길이 더 가까우면 안 됨
        }
        if (ok) return { i, side, kind: 'post', lat: lat0 };
      }
    }
    return null;
  }
  const signs = [];
  /** 큰 경고판 하나 (판 + 기둥 2개, 또는 벽에 붙인 판) — 다가오는 차를 봄 */
  function warnSign(i0, prefer, maxBack, title, sub, opts = {}) {
    const W = opts.w || 7, H = opts.h || 2.6;
    const sp = signSpot(i0, prefer, maxBack, W);
    if (!sp) return null;
    const s = S[sp.i], side = sp.side;
    const tex = warnTexture(title, sub, opts);
    const g = new THREE.Group();
    const faceMat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.28 });
    // 판 = 검은 틀(상자) + 앞면 그림(얇은 판) → 틀은 다른 표지판과 묶여 그려짐
    const board = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, H + 0.2, 0.18), M.dark);
    frame.castShadow = true;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), faceMat);
    face.position.z = 0.1;
    board.add(frame, face);
    g.add(board);
    let pos;
    // 판 앞면(+z)이 다가오는 차 쪽(−진행 방향, 조금 도로 쪽)을 보게
    const n = s.tan.clone().negate().addScaledVector(s.right, -side * (sp.kind === 'wall' ? 0.42 : 0.3)).setY(0).normalize();
    const yaw = Math.atan2(n.x, n.z);
    if (sp.kind === 'post') {
      const mid = sp.lat + W / 2;
      pos = s.pos.clone().addScaledVector(s.right, side * mid);
      const gy = groundY(pos.x, pos.z);
      const bottom = gy + 1.6;
      board.position.y = bottom + H / 2 - gy;
      // 기둥 2개 (각각 자기 땅 높이부터)
      for (const u of [-1, 1]) {
        const lx = u * (W / 2 - 0.5);
        const wx = pos.x + Math.cos(yaw) * lx, wz = pos.z - Math.sin(yaw) * lx;
        const py = groundY(wx, wz);
        const h = bottom + H - 0.2 - (py - 0.3);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, h, 0.22), M.steel);
        post.position.set(lx, py - 0.3 + h / 2 - gy, -0.15);
        g.add(post);
        solid(wx, wz, 0.3, py - 1, py + bottom + H - gy);
      }
      g.position.set(pos.x, gy, pos.z);
    } else {
      // 바위벽에 붙임: 벽이 바깥으로 기울어 있으므로 판도 뒤로 눕힘
      pos = s.pos.clone().addScaledVector(s.right, side * (sp.lat + 0.95));
      const ry = track.roadYAt(s, side * edgeLat(sp.i, side));
      g.position.set(pos.x, ry + 2.4, pos.z);
      board.rotation.x = -0.36;
      for (const u of [-1, 1]) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.2), M.steel);
        br.position.set(u * (W / 2 - 0.6), 0, 0.4 - 0.6);
        g.add(br);
      }
    }
    g.rotation.y = yaw;
    group.add(g);
    signs.push({ title, t: +(sp.i / NS).toFixed(4), kind: sp.kind, side });
    return g;
  }
  // 점프 3곳: 약 230 m 앞 "점프 구간", 약 95 m 앞 "점프! 풀 가속"
  const jumpText = {
    GORGE: ['협곡 점프', '용암 협곡을 건너요 · 줄이지 마세요'],
    DROP: ['낙하 점프', '착지는 12 m 아래 · 곧게 들어가요'],
    RIVER: ['용암 강 점프', '가운데로 곧게 · 풀 가속'],
  };
  for (const j of track.jumps || []) {
    const [a, b] = jumpText[j.name] || ['점프', '풀 가속'];
    // 앞이 양쪽 낭떠러지라 못 세우면 립 바로 앞 가드레일 뒤에
    warnSign(track.wrapI(j.lipI - track.mS(230)), 1, 90, a, b, { icon: '⚠' }) || warnSign(track.wrapI(j.lipI - track.mS(26)), 1, 6, a, b, { icon: '⚠', w: 5.5 });
    warnSign(track.wrapI(j.lipI - track.mS(90)), -1, 40, '점프! 풀 가속', 'JUMP · FULL THROTTLE', { icon: '▲' }) || warnSign(track.wrapI(j.lipI - track.mS(14)), 1, 4, '점프! 풀 가속', 'JUMP · FULL THROTTLE', { icon: '▲', w: 5.5 });
  }
  // 칼날 능선 앞
  {
    const i = secI('ridge');
    if (i != null) warnSign(track.wrapI(i - track.mS(30)), -1, 120, '칼날 능선', '양쪽 낭떠러지 · 정확하게', { icon: '⚠', bg: '#141010', fg: '#ffffff', accent: '#ff8a1a' });
  }
  // 분화구 테두리 앞
  {
    const i = secI('RIM');
    if (i != null) warnSign(track.wrapI(i - track.mS(20)), 1, 120, '분화구 테두리', '용암 호수 · 미끄러지면 끝', { icon: '🌋', bg: '#141010', fg: '#ffffff', accent: '#ff8a1a' });
  }
  // 산 내리막 앞
  {
    const i = secI('D1');
    if (i != null) warnSign(track.wrapI(i - track.mS(60)), 1, 120, '급한 내리막', '브레이크 미리 · 헤어핀 연속', { icon: '⚠' });
  }
  // 헤어핀 바깥 쉐브론 (바깥이 낭떠러지·용암이면 안 세움)
  {
    const tex = { 1: chevronTexture(1), [-1]: chevronTexture(-1) };
    const mats = { 1: new THREE.MeshLambertMaterial({ map: tex[1], emissive: '#ffffff', emissiveMap: tex[1], emissiveIntensity: 0.3 }), [-1]: new THREE.MeshLambertMaterial({ map: tex[-1], emissive: '#ffffff', emissiveMap: tex[-1], emissiveIntensity: 0.3 }) };
    const boardGeo = new THREE.BoxGeometry(3, 1.1, 0.1);
    const items = { 1: [], [-1]: [] }, posts = [];
    let made = 0;
    for (const name of ['H1', 'H2', 'H3', 'D1', 'D2', 'T15', 'T3', 'T4', 'T10']) {
      if (!secs[name]) continue;
      let [ia, ib] = [track.indexAt(secs[name][0]), track.indexAt(secs[name][1])];
      if (ib < ia) ib += NS;
      let turn = 0;
      for (let i = ia; i < ib; i++) {
        const a = S[track.wrapI(i)].tan, b = S[track.wrapI(i + 1)].tan;
        turn += a.z * b.x - a.x * b.z;
      }
      // turn > 0 → 왼쪽으로 도는 코너 → 바깥 = 오른쪽(+1)
      const outside = turn > 0 ? 1 : -1;
      const arrow = -outside; // 화살표는 안쪽(도는 쪽)을 가리킴: 운전자 오른쪽 = +1
      const approach = S[track.wrapI(ia - track.mS(35))].pos;
      const span = ib - ia;
      const nB = Math.max(3, Math.min(6, Math.round((span * track.length) / NS / 12)));
      for (let k = 0; k < nB; k++) {
        const i = track.wrapI(Math.round(ia + span * (0.15 + (0.75 * k) / Math.max(1, nB - 1))));
        if (S[i].gap) continue;
        const e = track.edgeAt(i, outside);
        const rail = track.railSide && track.railSide[outside < 0 ? 0 : 1][i];
        const s = S[i];
        let lat, y, wall = false;
        if ((e === EDGE.cliff && !rail) || e === EDGE.lava) {
          // 낭떠러지·용암 쪽: 길 끝(연석 끝 0.3 m 밖)에 기둥 하나, 판은 바깥(낭떠러지 위)으로 내밀어 달림 (충돌 없음)
          const ry = track.roadYAt(s, outside * edgeLat(i, outside));
          const pp = s.pos.clone().addScaledVector(s.right, outside * (edgeLat(i, outside) + 0.3));
          const bp = s.pos.clone().addScaledVector(s.right, outside * (edgeLat(i, outside) + 1.25));
          const toA = approach.clone().sub(bp).setY(0).normalize();
          const yaw = Math.atan2(toA.x, toA.z);
          q4.setFromAxisAngle(UP, yaw);
          m4.compose(tmpV.set(bp.x, ry + 1.45, bp.z), q4, sc4.set(0.8, 0.8, 1));
          items[arrow].push(m4.clone());
          posts.push(new THREE.Matrix4().compose(tmpV.set(pp.x, ry - 1.6, pp.z), q4, sc4.set(1.4, 3.4, 1.4)));
          const arm = bp.clone().sub(pp);
          posts.push(new THREE.Matrix4().compose(tmpV.set(pp.x, ry + 1.75, pp.z), new THREE.Quaternion().setFromUnitVectors(UP, arm.clone().normalize()), sc4.set(0.8, arm.length(), 0.8)));
          made++;
          continue;
        }
        if (e === EDGE.wall) {
          lat = edgeLat(i, outside) + 0.35 + 0.9;
          y = track.roadYAt(s, outside * edgeLat(i, outside)) + 1.7;
          wall = true;
        } else {
          lat = edgeLat(i, outside) + (rail ? 1.6 : 3.0) + 1.5;
          const p = s.pos.clone().addScaledVector(s.right, outside * lat);
          const gy = groundY(p.x, p.z);
          const ry = track.roadYAt(s, outside * edgeLat(i, outside));
          if (!(gy > ry - 1.5 && gy < ry + 2)) continue;
          if (roadClear(p.x, p.z) < 3 + 1.5) continue;
          y = gy;
        }
        const p = s.pos.clone().addScaledVector(s.right, outside * lat);
        // 판이 다가오는 차(코너 입구 35 m 앞)를 봄. 벽에 붙일 땐 벽과 거의 나란히
        const toA = approach.clone().sub(p).setY(0).normalize();
        if (wall) toA.lerp(s.right.clone().multiplyScalar(-outside), 0.55).normalize();
        const yaw = Math.atan2(toA.x, toA.z);
        q4.setFromAxisAngle(UP, yaw);
        if (wall) q4.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.3));
        m4.compose(tmpV.set(p.x, wall ? y : y + 1.75, p.z), q4, sc4.set(1, 1, 1));
        items[arrow].push(m4.clone());
        if (!wall) {
          for (const u of [-1, 1]) {
            const px = p.x + Math.cos(yaw) * u * 0.95, pz = p.z - Math.sin(yaw) * u * 0.95;
            const py = groundY(px, pz);
            posts.push(new THREE.Matrix4().compose(tmpV.set(px, py - 0.3, pz), q4.setFromAxisAngle(UP, yaw), sc4.set(1, y + 2.3 - (py - 0.3), 1)));
            solid(px, pz, 0.2, py - 1, py + 2.4);
          }
        }
        made++;
      }
    }
    for (const d of [1, -1]) {
      if (!items[d].length) continue;
      const im = new THREE.InstancedMesh(boardGeo, mats[d], items[d].length);
      items[d].forEach((m, k) => im.setMatrixAt(k, m));
      im.castShadow = true;
      group.add(im);
    }
    if (posts.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12).translate(0, 0.5, 0), M.steel, posts.length);
      posts.forEach((m, k) => im.setMatrixAt(k, m));
      group.add(im);
    }
    stats.chevrons = made;
  }
  stats.signs = signs;

  // ---------------------------------------------------------------- 매 프레임: 김·빛 깜빡임·기지 장비
  const cSteam = new THREE.Color();
  animators.push((t, dt) => {
    // 김: 생겨서 위로 퍼지며 사라짐
    for (const v of steamSrc) {
      for (let q = 0; q < v.n; q++) {
        const f = (t / v.life + v.ph + q / v.n) % 1;
        const i = v.first + q;
        const sway = Math.sin(t * 0.7 + q * 2 + v.ph * 9) * 0.6 * f * v.s1 * 0.3;
        const s = v.s0 + (v.s1 - v.s0) * Math.sqrt(f);
        const a = Math.min(1, f / 0.12) * (1 - f) ** 1.3 * v.a;
        cSteam.copy(v.color);
        steam.set(i, v.x + sway + f * 1.5, v.y + f * v.rise, v.z + sway * 0.6, s, q * 2.1 + f * 1.2, cSteam, a);
      }
    }
    steam.flush();
    // 길가 빛: 천천히 숨쉬듯
    for (const g of nearGlowList) nearGlow.alpha(g.i, g.a * (0.8 + Math.sin(t * 1.3 + g.ph) * 0.2));
    nearGlow.flush();
  });
  animators.push((t, dt) => {
    for (const u of updaters) u(t, dt);
  });
  nearGlow.flush();
  farGlow.flush();

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

  // 인스턴스 묶음은 staticBatch.js가 400 m 칸으로 나누지 않게 (나누면 그림 호출이 몇 배로 늘어남: 한 번에 그리는 편이 빠름)
  group.traverse((o) => {
    if (o.isInstancedMesh) o.userData.noBatch = true;
  });
  const buildMs = Math.round(performance.now() - t0);
  return {
    colliders: allColliders,
    collideCar,
    /** 다른 파일(gpCorners.js 코너 표시판)이 단단한 기둥을 더할 때: (x, z, 반지름, 아래 y, 위 y) */
    addCollider: circle,
    collidersNear(x, z, r = 4) {
      return allColliders.filter((c) => Math.hypot(c.x - x, c.z - z) < r + c.r);
    },
    animate(time, dt, car) {
      for (const a of animators) a(time, dt, car);
    },
    sky,
    erupt,
    stats: Object.assign(stats, { colliders: allColliders.length, occupied: occupied.length, steam: steamN, nearGlow: nearGlowN, farGlow: farGlowN, buildMs }),
  };
}
