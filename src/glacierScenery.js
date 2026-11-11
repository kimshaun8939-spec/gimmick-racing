// 빙하 하이웨이 풍경 (glacierMap.js의 buildScenery)
//   - 하늘: 해 진 직후 파란 하늘 + 천천히 일렁이는 오로라(초록·청록·보라) + 별 + 노을 + 달 (차를 따라다님, glacierAssets.js)
//   - 먼 곳: 지형 상자를 빙 둘러싼 설산 (낮은 산자락 → 높은 봉우리, 골짜기엔 푸른 빙하), 산허리에 걸린 구름
//   - 얼음 터널 (json tunnels): 반투명 푸른 얼음 아치 + 빛 띠 + 고드름 + 입구 얼음 테두리·간판 (위쪽은 군데군데 뚫려 하늘이 보임)
//   - 얼어붙은 호수(코스 안쪽 넓은 곳) + 호숫가 통나무 마을(불 켜진 창·굴뚝 연기) + 스키 산장, 얼어붙은 강(json river) 얼음
//   - 길가: 눈 둑, 눈 덮인 전나무 숲(가까운 것·먼 것), 눈 모자 바위, 반사 기둥, 눈 울타리, 1 km 표지판, 광고판 (지어낸 이름만)
//   - 출발 지역 "GLACIER HIGHWAY": 빨간불 5개 출발 게이트, 관중석 2개, 피트 건물, 깃발 줄
//   - 움직이는 것: 케이블카 곤돌라, 풍력 발전기, 헬리콥터, 새 떼, 흘러가는 구름 (내리는 눈은 glacierProps.js)
//   - 성능: 반복 물체는 InstancedMesh(가까운 것만 그리는 LOD), 가만히 있는 메시는 이름 없이 → staticBatch가 합침,
//     움직이는 것은 이름을 붙임. 표지판·광고판은 그림 한 장(묶음)에 모아 재질 하나
//   - 충돌: 원기둥 충돌체 격자 (collideCar, addCollider). 도로 가장자리(연석 끝)에서 3 m 안에는 충돌체를 두지 않음
import * as THREE from 'three';
import { canvasTexture, seededRandom, makeNoise } from './moonTrack.js';
import { billboardCloud, smokeTexture, glowTexture, helicopterModel, gondolaGeo, pylonGeo, reflectorPostGeo, colorBoxes } from './volcanoAssets.js';
import {
  glacierSkyMaterial, fogLambert, paintGeo, mergeColored, snowPineGeo, farPineGeo, snowRockGeo, cabinGeo, cabinWindowsGeo,
  turbineTowerGeo, turbineRotorGeo, snowFenceGeo, birdGeo, iceTexture, lakeIceTexture, signAtlas, planeWithUV,
} from './glacierAssets.js';
import { observatory, radarDish, antennaMast } from './gpSpace.js';
import { grandstand, pitBuilding, flagPole } from './gpAssets.js';

const TAU = Math.PI * 2;
const CAR_R = 1.3; // 차 충돌 반지름
const CELL = 24; // 충돌체 격자 크기
const UP = new THREE.Vector3(0, 1, 0);
const GC = 5; // 지형 격자 한 칸 (트랙 지형 메시와 같게)

export function buildGlacierScenery(track, scene) {
  const t0 = performance.now();
  const rand = seededRandom(4471);
  const noise = makeNoise(8123);
  const group = new THREE.Group();
  group.name = 'glacierScenery';
  scene.add(group);
  const animators = []; // (time, dt, car) => void
  const stats = {};
  const tmpV = new THREE.Vector3();
  const S = track.samples, NS = S.length - 1;
  const data = track.data || {};
  const hwOf = (i) => (S[i].hw != null ? S[i].hw : track.halfWidthAt ? track.halfWidthAt(i) : (track.width || 17) / 2);
  const kerb = (i, sd) => (track.kerbAt ? track.kerbAt(i, sd) : track.kerbWidth || 1.6);
  const edgeLat = (i, sd) => hwOf(i) + kerb(i, sd);
  const wrapI = (i) => ((Math.round(i) % NS) + NS) % NS;
  const idxAt = (t) => (track.indexAt ? track.indexAt(t) : wrapI(Math.round(t * NS)));
  const heightAt = track.heightAt ? (x, z) => track.heightAt(x, z) : (x, z) => (track.nearest ? track.nearest(new THREE.Vector3(x, 0, z)).sample.pos.y : 0);

  // ---------------------------------------------------------------- 빛·안개: 블루 아워 (어둡지 않게 — 눈이 하늘빛을 받아 밝음)
  const FOG = new THREE.Color('#9fb6d6');
  scene.background = FOG.clone();
  scene.fog = new THREE.Fog(FOG.clone(), 420, 2900);
  scene.traverse((o) => {
    if (o.isHemisphereLight) {
      o.color.set('#cfe0ff');
      o.groundColor.set('#6f7f9c');
      o.intensity = 1.25;
    } else if (o.isDirectionalLight) {
      o.color.set('#ffe0cc');
      o.intensity = 1.9;
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
  /** 지형 메시와 같은 높이 (5 m 격자 삼각형 면 위) → 물체가 뜨거나 묻히지 않게 */
  function groundY(x, z) {
    const i = Math.floor(x / GC), j = Math.floor(z / GC);
    const x0 = i * GC, z0 = j * GC, u = (x - x0) / GC, v = (z - z0) / GC;
    const h00 = heightAt(x0, z0), h10 = heightAt(x0 + GC, z0), h11 = heightAt(x0 + GC, z0 + GC), h01 = heightAt(x0, z0 + GC);
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
  // 지형 상자 (없으면 코스 둘레 + 여유)
  let tb = track.terrainBox;
  if (!tb) {
    const m = data.terrainMargin || 420;
    tb = { min: { x: 1e9, y: 1e9 }, max: { x: -1e9, y: -1e9 } };
    for (let i = 0; i < NS; i += 4) {
      const p = S[i].pos;
      tb.min.x = Math.min(tb.min.x, p.x - m);
      tb.min.y = Math.min(tb.min.y, p.z - m);
      tb.max.x = Math.max(tb.max.x, p.x + m);
      tb.max.y = Math.max(tb.max.y, p.z + m);
    }
  }
  const inBox = (x, z, m = 10) => x > tb.min.x + m && x < tb.max.x - m && z > tb.min.y + m && z < tb.max.y - m;
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
  /** 도로 가장자리까지 거리 (m, 30 m 넘으면 대충 큰 값) */
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
          if (d - 12 > best) continue;
          const e = d - hwOf(i) - kerb(i, dx * s.right.x + dz * s.right.z < 0 ? -1 : 1);
          if (e < best) best = e;
        }
      }
    return best > 1e8 ? 40 : best;
  }
  /** 도로 가장자리까지 거리 (멀어도 정확히) */
  function roadDist(x, z) {
    const c = roadClear(x, z);
    if (c < 39) return c;
    let best = 1e9;
    for (let i = 0; i < NS; i += 3) {
      const s = S[i];
      const d = Math.hypot(x - s.pos.x, z - s.pos.z) - hwOf(i) - 2;
      if (d < best) best = d;
    }
    return best;
  }
  /** 충돌체 넣기 (도로 가장자리에서 3 m 밖일 때만) */
  function solid(x, z, r, y0, y1) {
    if (roadClear(x, z) < 3 + r) return false;
    circle(x, z, r, y0, y1);
    return true;
  }
  const occupied = [];
  const free = (x, z, r) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
  const occupy = (x, z, r) => occupied.push({ x, z, r });
  function lowGround(x, z, r) {
    let y = groundY(x, z);
    if (r > 0) for (let k = 0; k < 6; k++) y = Math.min(y, groundY(x + Math.cos((k / 6) * TAU) * r, z + Math.sin((k / 6) * TAU) * r));
    return y;
  }
  // 구간 범위: 터널·다리 (t → 샘플 번호)
  const ranges = (list) => (list || []).map((r) => {
    const a = idxAt(Array.isArray(r) ? r[0] : r.t0);
    let b = idxAt(Array.isArray(r) ? r[1] : r.t1);
    if (b < a) b += NS;
    return [a, b];
  });
  const TUN = ranges(data.tunnels);
  const BRG = ranges(data.bridges);
  const inRange = (R, i, pad = 0) => R.some(([a, b]) => {
    const j = i < a - pad ? i + NS : i;
    return j >= a - pad && j <= b + pad;
  });
  const inTunnel = (i, pad = 0) => inRange(TUN, i, pad);
  const onBridge = (i, pad = 0) => inRange(BRG, i, pad);
  const edgeKind = (i, sd) => (track.edgeAt && track.EDGE ? track.edgeAt(i, sd) : 0);
  const isWall = (i, sd) => track.EDGE && edgeKind(i, sd) === track.EDGE.wall;

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
  const SUN_DIR = new THREE.Vector3(60, 22, 40).normalize(); // main.js 햇빛(60,110,40)과 같은 쪽, 하늘의 노을은 지평선 가까이
  const MOON_DIR = new THREE.Vector3(-70, 30, -45).normalize();

  // ---------------------------------------------------------------- 공용 재질
  const M = {
    snow: new THREE.MeshLambertMaterial({ color: '#eef3fa' }),
    vcol: new THREE.MeshLambertMaterial({ vertexColors: true }),
    vcolFlat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    dark: new THREE.MeshStandardMaterial({ color: '#1f2731', roughness: 0.6, metalness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: '#a7b0bc', roughness: 0.45, metalness: 0.55 }),
    white: new THREE.MeshLambertMaterial({ color: '#f2f5f9' }),
    blue: new THREE.MeshLambertMaterial({ color: '#2f7fd8' }),
    cyanGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#8ff0ff').multiplyScalar(1.4), toneMapped: false }),
    warmGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc977').multiplyScalar(1.15), toneMapped: false }),
    wood: new THREE.MeshLambertMaterial({ color: '#6b4530' }),
  };
  const TX = { smoke: smokeTexture(5), glow: glowTexture(0.1) };

  // ---------------------------------------------------------------- 거리 줄이기 (LOD): 인스턴스 묶음은 카메라에서 range m 안의 것만 그림
  const ranged = [];
  const m4L = new THREE.Matrix4();
  function rangeLOD(im, range) {
    const n = im.count;
    const mats = new Float32Array(n * 16), px = new Float32Array(n), pz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      im.getMatrixAt(i, m4L);
      m4L.toArray(mats, i * 16);
      px[i] = mats[i * 16 + 12];
      pz[i] = mats[i * 16 + 14];
    }
    ranged.push({ im, range, mats, px, pz, n, lx: 1e9, lz: 1e9 });
  }
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
      R.im.boundingSphere = null;
    }
  });
  /** 인스턴스 묶음 만들기: list = [{x,y,z, sx,sy,sz, ry}] */
  function instanced(geo, mat, list, { name, shadow = false, lod = 0 } = {}) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((o, k) => {
      e.set(o.rx || 0, o.ry || 0, o.rz || 0);
      q.setFromEuler(e);
      m4L.compose(tmpV.set(o.x, o.y, o.z), q, new THREE.Vector3(o.sx ?? 1, o.sy ?? o.sx ?? 1, o.sz ?? o.sx ?? 1));
      im.setMatrixAt(k, m4L);
    });
    if (name) im.name = name;
    im.castShadow = shadow;
    im.receiveShadow = false;
    im.userData.noBatch = true;
    group.add(im);
    if (lod) rangeLOD(im, lod);
    return im;
  }

  // ---------------------------------------------------------------- 하늘 (차를 따라다님)
  const skyMat = glacierSkyMaterial({ fogColor: scene.fog.color, sunDir: SUN_DIR, moonDir: MOON_DIR });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2750, 48, 24), skyMat);
  sky.name = 'glacierSky';
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  animators.push((t) => {
    const cam = window.game && window.game.camera;
    if (cam) sky.position.copy(cam.position);
    skyMat.uniforms.time.value = t;
  });

  // ---------------------------------------------------------------- 설산 고리: 지형 상자를 따라 도는 둥근 네모 (극좌표 격자 한 장)
  //   d = 상자 끝에서 바깥으로 거리. 0~200 m 산자락(숲) → 350~550 m 첫 봉우리 줄 → 800 m 뒤 더 높은 봉우리 줄
  const MTN = (() => {
    const N = 400, P = 6;
    const D = [-40, 0, 30, 70, 120, 180, 250, 330, 410, 490, 570, 650, 740, 830, 920, 1020];
    const dirs = [];
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const sx = Math.sign(ca) * Math.abs(ca) ** (2 / P), sz = Math.sign(sa) * Math.abs(sa) ** (2 / P);
      // 바깥 방향 (둥근 네모의 노멀 근사)
      const nx = Math.sign(ca) * Math.abs(ca) ** (P - 1) / boxH.x, nz = Math.sign(sa) * Math.abs(sa) ** (P - 1) / boxH.y;
      const nl = Math.hypot(nx, nz) || 1;
      dirs.push({ bx: boxC.x + boxH.x * sx, bz: boxC.y + boxH.y * sz, nx: nx / nl, nz: nz / nl, u: k / N });
    }
    // 둘레 거리(대략) 기준 노이즈 좌표
    const per = 2 * (boxH.x + boxH.y) * 2.2;
    const ridge = (u, f, o) => 1 - Math.abs(noise(u * f + o, o * 0.37, 3));
    /** 높이 (y): k = 각도 번호(실수 가능), d = 상자 끝에서 거리 */
    function H(u, d, base) {
      const s = u * per;
      const foot = 18 + 55 * (0.5 + 0.5 * noise(s / 160, 3.1, 3)); // 산자락
      const r1 = ridge(s / 900, 1, 11.3);
      const r2 = ridge(s / 1300, 1, 27.9);
      const peak1 = 150 + 280 * r1 * r1 + 60 * noise(s / 140, 9.2, 2);
      const peak2 = 300 + 420 * r2 * r2 + 80 * noise(s / 200, 1.7, 2);
      const sm = THREE.MathUtils.smoothstep;
      let h = foot * sm(d, -40, 140);
      h = Math.max(h, peak1 * sm(d, 120, 470) * (1 - sm(d, 560, 820) * 0.45));
      h = Math.max(h, peak2 * sm(d, 560, 900));
      // 바위 울퉁불퉁
      h += noise(s / 45, d / 45, 2) * Math.min(28, h * 0.12);
      return base + h;
    }
    const baseOf = dirs.map((q) => {
      const x = q.bx - q.nx * 40, z = q.by ?? q.bz - q.nz * 40;
      return groundY(Math.min(Math.max(x, tb.min.x + 1), tb.max.x - 1), Math.min(Math.max(q.bz - q.nz * 40, tb.min.y + 1), tb.max.y - 1)) - 3;
    });
    return { N, D, dirs, H, baseOf, per };
  })();
  /** 상자 밖 (x, z)의 산 높이 (케이블카·풍차를 산 위에 세울 때) — 가장 가까운 각도 + 거리로 근사 */
  function mtnAt(x, z) {
    let best = 1e18, bk = 0;
    for (let k = 0; k < MTN.N; k += 2) {
      const q = MTN.dirs[k];
      const d2 = (x - q.bx) ** 2 + (z - q.bz) ** 2;
      if (d2 < best) (best = d2), (bk = k);
    }
    const q = MTN.dirs[bk];
    const d = (x - q.bx) * q.nx + (z - q.bz) * q.nz;
    return { y: MTN.H(q.u, d, MTN.baseOf[bk]), d, k: bk };
  }
  {
    const { N, D, dirs, H, baseOf } = MTN;
    const pos = [];
    const P = (k, j) => {
      const q = dirs[k], d = D[j];
      return [q.bx + q.nx * d, H(q.u, d, baseOf[k]), q.bz + q.nz * d];
    };
    for (let k = 0; k < N; k++)
      for (let j = 0; j < D.length - 1; j++) {
        const a = P(k, j), b = P(k + 1, j), c = P(k + 1, j + 1), d = P(k, j + 1);
        // 안쪽(코스)에서 보이는 면이 앞면이 되게
        pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // 면마다 색: 완만하면 눈, 가파르면 바위, 높은 골짜기는 푸른 빙하, 낮은 곳은 숲
    const col = new Float32Array(pos.length);
    const cSnow = new THREE.Color('#f1f5fb'), cSnow2 = new THREE.Color('#d6e2f2'), cRock = new THREE.Color('#5d6878'), cRock2 = new THREE.Color('#465061');
    const cIce = new THREE.Color('#8fd0f2'), cIce2 = new THREE.Color('#b9e6fb'), cForest = new THREE.Color('#2a3d39'), cForestS = new THREE.Color('#9db0b8');
    const c = new THREE.Color();
    const nrm = g.attributes.normal;
    for (let f = 0; f < pos.length / 9; f++) {
      let cx = 0, cy = 0, cz = 0;
      for (let v = 0; v < 3; v++) (cx += pos[f * 9 + v * 3]), (cy += pos[f * 9 + v * 3 + 1]), (cz += pos[f * 9 + v * 3 + 2]);
      cx /= 3, cy /= 3, cz /= 3;
      const ny = (nrm.getY(f * 3) + nrm.getY(f * 3 + 1) + nrm.getY(f * 3 + 2)) / 3;
      const n1 = noise(cx / 70, cz / 70, 2), n2 = noise(cx / 260 + 5, cz / 260, 2);
      const alt = cy - 20;
      if (alt < 70 + n2 * 30) {
        // 산자락: 눈 덮인 숲 (얼룩덜룩)
        c.copy(n1 > -0.05 ? cForest : cForestS).lerp(cSnow2, alt < 12 ? 0.6 : 0.15);
      } else if (ny < 0.55 + n1 * 0.12) {
        c.copy(n1 > 0 ? cRock : cRock2).lerp(cSnow2, THREE.MathUtils.clamp((ny - 0.25) * 1.5, 0, 0.5));
      } else if (alt > 140 && alt < 420 && n2 < -0.18 && ny > 0.6) {
        c.copy(n1 > 0.1 ? cIce2 : cIce); // 빙하 (골짜기를 흐르는 푸른 얼음)
      } else {
        c.copy(n1 > 0.2 ? cSnow2 : cSnow);
      }
      for (let v = 0; v < 3; v++) c.toArray(col, f * 9 + v * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mtnMat = fogLambert({ fogScale: 0.93, flatShading: true });
    const mtn = new THREE.Mesh(g, mtnMat);
    mtn.name = 'glacierMountains'; // 너무 커서 칸 나누기 대상이 아님
    mtn.frustumCulled = false;
    mtn.userData.noBatch = true;
    group.add(mtn);
    stats.mountainTris = pos.length / 9;
  }

  // ---------------------------------------------------------------- 산허리 구름 + 골짜기 안개 (빌보드 묶음, 천천히 흘러감)
  {
    const NC = 44;
    const clouds = billboardCloud(NC, { map: TX.smoke, fogAmt: 0.55, name: 'glacierClouds', renderOrder: -1 });
    group.add(clouds.mesh);
    const list = [];
    const cc = new THREE.Color();
    for (let i = 0; i < NC; i++) {
      const k = Math.floor(rand() * MTN.N);
      const q = MTN.dirs[k];
      const d = 200 + rand() * 600;
      const yy = MTN.H(q.u, d, MTN.baseOf[k]);
      const low = i < 18; // 산자락 낮은 안개 띠
      list.push({
        k: k + rand(), d: low ? 60 + rand() * 140 : d, y: low ? MTN.baseOf[k] + 30 + rand() * 30 : (yy - MTN.baseOf[k]) * (0.45 + rand() * 0.3) + MTN.baseOf[k],
        s: low ? 260 + rand() * 200 : 300 + rand() * 300, a: low ? 0.2 : 0.22 + rand() * 0.14, sp: (0.4 + rand()) * 0.0009 * (rand() < 0.5 ? 1 : -1), rot: rand() * TAU,
        col: cc.setHSL(0.6, 0.25, 0.86 + rand() * 0.1).clone(),
      });
    }
    animators.push((t) => {
      for (let i = 0; i < NC; i++) {
        const o = list[i];
        const kk = (((o.k + t * o.sp * MTN.N) % MTN.N) + MTN.N) % MTN.N;
        const q = MTN.dirs[Math.floor(kk)];
        clouds.set(i, q.bx + q.nx * o.d, o.y, q.bz + q.nz * o.d, o.s, o.rot + t * 0.004, o.col, o.a);
      }
      clouds.flush();
    });
  }

  // 내리는 눈은 glacierProps.js가 그림 (속도에 따라 비스듬히) → 풍경은 안 그림

  // ---------------------------------------------------------------- 표지판·광고판 묶음 (그림 한 장)
  const CELLS = [
    { title: 'GLACIER HIGHWAY', sub: '빙하 하이웨이 · 2 LAPS', bg: '#0f2a4a', accent: '#7fe8ff', logo: 'peak' },
    { title: '1 KM', bg: '#f4f7fb', fg: '#0f2a4a', accent: '#2f7fd8' },
    { title: '2 KM', bg: '#f4f7fb', fg: '#0f2a4a', accent: '#2f7fd8' },
    { title: '3 KM', bg: '#f4f7fb', fg: '#0f2a4a', accent: '#2f7fd8' },
    { title: '4 KM', bg: '#f4f7fb', fg: '#0f2a4a', accent: '#2f7fd8' },
    { title: 'FROSTLINE', sub: 'WINTER TYRES', bg: '#14181f', accent: '#ffd21f', logo: 'flake' },
    { title: 'AURORA FIZZ', sub: 'SPARKLING · ICE COLD', bg: '#1d1240', accent: '#5dffb0', logo: 'ring' },
    { title: 'NORDWIND', sub: 'CLEAN ENERGY', bg: '#e9f2fb', fg: '#0d3a66', accent: '#21a0e0', logo: 'bolt' },
    { title: 'SNOWCAP', sub: 'MOUNTAIN COFFEE', bg: '#5a2f1d', accent: '#ffd9a8', logo: 'peak' },
    { title: 'POLAR BYTE', sub: 'FAST NETWORKS', bg: '#062236', accent: '#3fd2ff', logo: 'bolt' },
    { title: 'ICEPEAK', sub: 'OUTDOOR GEAR', bg: '#c8312a', accent: '#ffffff', logo: 'peak' },
    { title: 'ICE TUNNEL', sub: '얼음 터널 · 라이트 켜기', bg: '#0b3156', accent: '#8ff0ff', logo: 'flake' },
    { title: 'FROZEN RIVER', sub: '얼어붙은 강 다리', bg: '#0b3156', accent: '#8ff0ff', logo: 'ring' },
    { title: '⚠ 결빙 주의', sub: 'ICY CORNER · SLOW', bg: '#ffc21a', fg: '#141010', accent: '#141010' },
    { title: 'FINISH', sub: 'GLACIER GRAND PRIX', bg: '#111418', accent: '#ffffff' },
    { title: 'BLUE HOUR', sub: 'NIGHT SKI · 오로라 전망대', bg: '#26457e', accent: '#c7a4ff', logo: 'ring' },
  ];
  const ATL = signAtlas(CELLS, { cols: 4, rows: 4, cw: 512, ch: 192 });
  const signMat = new THREE.MeshLambertMaterial({ map: ATL.tex, emissive: '#ffffff', emissiveMap: ATL.tex, emissiveIntensity: 0.28 });
  /**
   * 길가 판 세우기: 샘플 i, 쪽 sd(+1 오른쪽), 가장자리에서 off m, 판 크기 w×h, 아래 끝 높이 lift
   *   판은 다가오는 차 쪽(-tan)을 보고 도로 쪽으로 조금 돌아감. 기둥 2개 (충돌체)
   */
  function roadBoard(i, sd, off, cell, w, h, lift) {
    i = wrapI(i);
    const s = S[i];
    const lat = edgeLat(i, sd) + off;
    const x = s.pos.x + s.right.x * sd * lat, z = s.pos.z + s.right.z * sd * lat;
    const gy = lowGround(x, z, w / 2);
    const g = new THREE.Group();
    const face = s.tan.clone().negate().addScaledVector(s.right, -sd * 0.35).setY(0).normalize();
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face);
    g.position.set(x, gy, z);
    const panel = new THREE.Mesh(planeWithUV(w, h, ATL.uv(cell)), signMat);
    panel.position.set(0, lift + h / 2, 0.13);
    g.add(panel);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.22), M.dark);
    back.position.set(0, lift + h / 2, 0);
    g.add(back);
    const px = w / 2 - Math.min(1, w * 0.15);
    for (const sx of [-px, px]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, lift + h, 0.28), M.steel);
      post.position.set(sx, (lift + h) / 2, -0.2);
      g.add(post);
    }
    group.add(g);
    g.updateMatrixWorld(true);
    for (const sx of [-px, px]) {
      const p = new THREE.Vector3(sx, 0, 0).applyMatrix4(g.matrixWorld);
      solid(p.x, p.z, 0.4, gy - 1, gy + lift + h);
    }
    occupy(x, z, w / 2 + 2);
    return g;
  }

  // ---------------------------------------------------------------- 출발 지역
  const HW0 = hwOf(0), KB = kerb(0, 1);
  const inner = Math.sign(new THREE.Vector3().subVectors(center, s0.pos).dot(s0.right)) || 1; // 코스 안쪽
  const outer = -inner;
  const atStart = (along, lat) => s0.pos.clone().addScaledVector(s0.tan, along).addScaledVector(s0.right, lat);
  /** 출발 직선 옆 그룹: 로컬 +x = 진행 방향×side, 로컬 +z = 도로에서 멀어지는 쪽 */
  function sideFrame(along, dist, side, obj) {
    const p = atStart(along, side * dist);
    const X = s0.tan.clone().multiplyScalar(side), Z = s0.right.clone().multiplyScalar(side);
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, UP, Z));
    obj.position.set(p.x, groundY(p.x, p.z), p.z);
    return obj;
  }

  // 출발 게이트 (빨간불 5개)
  const gantry = (() => {
    const g = new THREE.Group();
    const span = HW0 + KB + 1.6;
    const legGeo = new THREE.BoxGeometry(1.0, 10, 1.0);
    for (const sd of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, M.white);
      leg.position.set(sd * span, 5, 0);
      leg.castShadow = true;
      g.add(leg);
      for (const zz of [-0.55, 0.55]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 9, 0.18), M.cyanGlow);
        strip.position.set(sd * (span - 0.55), 5, zz);
        g.add(strip);
      }
      const foot = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 2.2), M.dark);
      foot.position.set(sd * span, 0.3, 0);
      g.add(foot);
      // 다리 위 눈덩이
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 1.3), M.snow);
      cap.position.set(sd * span, 12.7, 0);
      g.add(cap);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.2, 2.2, 1.2), M.dark);
    beam.position.y = 9;
    beam.castShadow = true;
    g.add(beam);
    for (const zz of [-0.66, 0.66]) {
      const sign = new THREE.Mesh(planeWithUV(span * 2, span * 2 * (192 / 512) * 0.55, ATL.uv(0)), signMat);
      sign.position.set(0, 11.5, zz);
      if (zz < 0) sign.rotation.y = Math.PI;
      g.add(sign);
    }
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.3, span * 2 * (192 / 512) * 0.55 + 0.25, 1.2), M.dark);
    signBack.position.y = 11.5;
    g.add(signBack);
    const roofSnow = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 0.4, 1.5), M.snow);
    roofSnow.position.y = 11.5 + span * (192 / 512) * 0.55 + 0.3;
    g.add(roofSnow);
    const C_OFF = new THREE.Color('#3a0a06'), C_ON = new THREE.Color('#ff2414').multiplyScalar(1.6), C_GREEN = new THREE.Color('#2bff6a').multiplyScalar(1.4);
    const bulbIm = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 20).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 10);
    bulbIm.name = 'glacierStartBulbs';
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
      circle(p.x, p.z, 0.8, p.y - 1, p.y + 12); // 게이트 다리 (연석 바로 밖 = 다른 맵 출발 게이트와 같음)
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

  // 관중석 2개 (바깥쪽, 뒤로 설산이 보임) — 광고 띠 글자를 빙하 글자로 다시 그림
  const updaters = [];
  for (const [along, len] of [[-70, 64], [40, 48]]) {
    const side = outer;
    const front = HW0 + KB + 7;
    const p = atStart(along, side * front);
    const y = Math.min(groundY(p.x, p.z), groundY(...(() => { const q = atStart(along - len / 2, side * front); return [q.x, q.z]; })()), groundY(...(() => { const q = atStart(along + len / 2, side * front); return [q.x, q.z]; })()));
    const st = grandstand({ length: len, roofColor: '#2f7fd8' });
    st.obj.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        const img = m.map && m.map.image;
        if (!img || !img.getContext || img.width !== 1024 || img.height !== 128 || img.__glacier) continue;
        img.__glacier = true;
        const c = img.getContext('2d'), w = img.width, h = img.height;
        const blocks = [['#2f7fd8', '#ffffff', 'GLACIER GP'], ['#0f2a4a', '#7fe8ff', '빙하 하이웨이'], ['#f4f7fb', '#0f2a4a', 'FROSTLINE'], ['#1d1240', '#5dffb0', 'AURORA FIZZ']];
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
        });
        m.map.needsUpdate = true;
      }
    });
    st.obj.position.set(p.x, y - 0.05, p.z);
    st.obj.rotation.y = yawOf(s0) + (side > 0 ? Math.PI : 0);
    group.add(st.obj);
    updaters.push((t, dt) => st.update(t, dt, 0.4));
    for (let u = -len / 2; u <= len / 2; u += 8) {
      const q = atStart(along + u, side * (front + 7));
      solid(q.x, q.z, 7, y - 2, y + 16);
    }
    occupy(p.x + s0.right.x * side * 7, p.z + s0.right.z * side * 7, len / 2 + 6);
  }
  // 피트 건물 (안쪽)
  {
    const L = 84;
    const along = -10;
    const d0 = HW0 + KB + 9;
    const pit = pitBuilding({ length: L });
    const X = s0.right.clone().multiplyScalar(inner); // 로컬 +x = 도로에서 멀어지는 쪽
    const Z = new THREE.Vector3().crossVectors(X, UP);
    const p = atStart(along, inner * d0);
    pit.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, UP, Z));
    pit.obj.position.set(p.x, lowGround(p.x, p.z, 6) - 0.1, p.z);
    // 피트 간판 (구름섬 글자) → 빙하 글자로 다시 그림 (한 페이지에 맵 하나라 공유 그림을 바꿔도 됨)
    pit.obj.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        const img = m.map && m.map.image;
        if (!img || !img.getContext || img.width !== 1024 || img.height !== 200 || img.__glacier) continue;
        img.__glacier = true;
        const c = img.getContext('2d'), w = img.width, h = img.height;
        c.fillStyle = '#0f2a4a';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = '#7fe8ff';
        c.lineWidth = 10;
        c.strokeRect(14, 14, w - 28, h - 28);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#ffffff';
        c.font = '900 104px "Malgun Gothic", sans-serif';
        c.fillText('GLACIER PIT', w / 2, h * 0.42);
        c.fillStyle = '#7fe8ff';
        c.font = '800 38px "Malgun Gothic", sans-serif';
        c.fillText('빙하 하이웨이 · PIT LANE', w / 2, h * 0.8);
        m.map.needsUpdate = true;
      }
    });
    group.add(pit.obj);
    for (let u = -L / 2; u <= L / 2; u += 8) {
      const q = atStart(along + u, inner * (d0 + 8));
      solid(q.x, q.z, 8, p.y - 2, p.y + 14);
    }
    occupy(p.x + X.x * 8, p.z + X.z * 8, L / 2 + 10);
    // 피트 지붕 위 눈
    const roof = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.5, L - 1), M.snow);
    roof.position.set(8, pit.height + 0.1, 0);
    pit.obj.add(roof);
  }
  // 깃발 (출발 직선 양쪽)
  for (let k = 0; k < 10; k++) {
    const along = -150 + k * 34;
    const side = k % 2 ? inner : outer;
    const f = flagPole({ color: k % 3 === 0 ? '#2f7fd8' : k % 3 === 1 ? '#7fe8ff' : '#f2f5f9' });
    const o = new THREE.Group();
    sideFrame(along, HW0 + KB + (side === outer ? 4.2 : 4.5), side, o);
    if (!free(o.position.x, o.position.z, 1)) continue;
    o.add(f.obj);
    group.add(o);
    updaters.push((t) => f.update(t));
    solid(o.position.x, o.position.z, 0.3, o.position.y - 1, o.position.y + 8);
  }
  animators.push((t, dt) => {
    for (const u of updaters) u(t, dt);
  });

  // ---------------------------------------------------------------- 길가 눈 둑 (도로 양옆, 낮고 둥근 띠 하나로 합침)
  {
    const pos = [], col = [];
    const cTop = new THREE.Color('#f4f8fd'), cBot = new THREE.Color('#c6d4e8');
    const prof = [[0, 0], [0.8, 0.55], [1.9, 1], [3.0, 0.7], [4.2, 0.1]]; // (가장자리에서 m, 높이 비율)
    for (const sd of [-1, 1]) {
      let prev = null;
      for (let i = 0; i <= NS; i += 2) {
        const ii = wrapI(i);
        const s = S[ii];
        const skip = inTunnel(ii, 8) || onBridge(ii, 10) || isWall(ii, sd) || (ii < 60 || ii > NS - 160);
        let ring = null;
        if (!skip) {
          const e = edgeLat(ii, sd) + 1.4;
          const hgt = 0.55 + 0.5 * (0.5 + 0.5 * noise(i * 0.05, sd * 7, 2));
          ring = [];
          let ok = true;
          for (const [o, f] of prof) {
            const lat = e + o * (1 + 0.25 * noise(i * 0.08, sd * 3 + o, 1));
            const x = s.pos.x + s.right.x * sd * lat, z = s.pos.z + s.right.z * sd * lat;
            const gy = groundY(x, z);
            if (Math.abs(gy - s.pos.y) > 2.5) ok = false;
            ring.push([x, gy - 0.25 + f * hgt + (f === 0 ? -0.2 : 0), z, f]);
          }
          if (!ok) ring = null;
        }
        if (ring && prev) {
          for (let k = 0; k < prof.length - 1; k++) {
            const a = prev[k], b = prev[k + 1], c2 = ring[k + 1], d = ring[k];
            const quad = sd > 0 ? [a, b, c2, a, c2, d] : [a, c2, b, a, d, c2];
            for (const v of quad) {
              pos.push(v[0], v[1], v[2]);
              const cc = cBot.clone().lerp(cTop, v[3]);
              col.push(cc.r, cc.g, cc.b);
            }
          }
        }
        prev = ring;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const banks = new THREE.Mesh(g, M.vcol);
    banks.receiveShadow = true;
    group.add(banks);
    stats.snowBankTris = pos.length / 9;
  }

  // ---------------------------------------------------------------- 반사 기둥 (24 m마다 양쪽)
  {
    const list = [];
    for (let i = 0; i < NS; i += 13) {
      if (inTunnel(i, 4) || onBridge(i, 4) || i < 70 || i > NS - 150) continue;
      const s = S[i];
      for (const sd of [-1, 1]) {
        if (isWall(i, sd)) continue;
        const lat = edgeLat(i, sd) + 0.9;
        const x = s.pos.x + s.right.x * sd * lat, z = s.pos.z + s.right.z * sd * lat;
        const gy = groundY(x, z);
        if (Math.abs(gy - s.pos.y) > 1.5) continue;
        list.push({ x, y: gy, z, ry: yawOf(s), sx: 1 });
      }
    }
    instanced(reflectorPostGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), list, { lod: 420 });
    stats.posts = list.length;
  }

  // ---------------------------------------------------------------- 얼음 터널
  const tunnelInfo = [];
  {
    const iceTex = iceTexture(7);
    iceTex.repeat.set(1, 1);
    const shellMat = new THREE.MeshStandardMaterial({
      color: '#a8dcff', map: iceTex, emissive: '#3f9fe0', emissiveMap: iceTex, emissiveIntensity: 0.35,
      roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    });
    const portalMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const icicleMat = new THREE.MeshStandardMaterial({ color: '#cfefff', roughness: 0.15, metalness: 0.1, emissive: '#5fb8ff', emissiveIntensity: 0.25 });
    const icicles = [];
    const stripPos = [];
    const STRIP_TH = [0.3, 0.5, 0.7]; // 빛 띠 각도 (π 단위)
    for (const [a, b] of TUN) {
      const i0 = a - 6, i1 = b + 6;
      const M_SEG = 16;
      const WALL_H = 6.2; // 트랙의 얼음 벽 높이(6.5 m) 바로 아래에서 지붕이 시작
      const HC = 4.2; // 벽 위로 솟는 지붕 높이 → 꼭대기 = 도로 위 약 10.4 m
      const pos = [], uv = [];
      const ringAt = (ii, j, shrink = 0) => {
        const i = wrapI(Math.round(ii));
        const s = S[i];
        const th = (j / M_SEG) * Math.PI;
        // 벽 윗면 안쪽 끝(연석 끝 + 0.95 m)보다 조금 바깥에서 시작하는 둥근 지붕
        const L = Math.max(edgeLat(i, 1), edgeLat(i, -1)) + 1.7;
        const bump = noise(ii * 0.11, j * 0.7, 2) * 0.45 * Math.sin(th);
        const lat = Math.cos(th) * (L + bump - shrink);
        const up = WALL_H + Math.pow(Math.sin(th), 0.75) * (HC + bump - shrink);
        return [s.pos.x + s.right.x * lat, s.pos.y + up, s.pos.z + s.right.z * lat];
      };
      let dist = 0;
      for (let ii = i0; ii < i1; ii += 2) {
        const sA = S[wrapI(ii)], sB = S[wrapI(ii + 2)];
        const step = sA.pos.distanceTo(sB.pos);
        for (let j = 0; j < M_SEG; j++) {
          const th = (j + 0.5) / M_SEG;
          // 위쪽은 군데군데 뚫림 (하늘·오로라가 보이는 틈)
          if (th > 0.3 && th < 0.7 && noise(ii * 0.035, j * 0.45 + 3, 1) > 0.3) continue;
          const A = ringAt(ii, j), B = ringAt(ii, j + 1), C = ringAt(ii + 2, j + 1), D = ringAt(ii + 2, j);
          pos.push(...A, ...B, ...C, ...A, ...C, ...D);
          const u0 = (j / M_SEG) * 3, u1 = ((j + 1) / M_SEG) * 3, v0 = dist / 14, v1 = (dist + step) / 14;
          uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
        }
        // 빛 띠 (껍질 안쪽)
        for (const tf of STRIP_TH) {
          const jj = tf * M_SEG;
          const A = ringAt(ii, jj - 0.12, 0.25), B = ringAt(ii, jj + 0.12, 0.25), C = ringAt(ii + 2, jj + 0.12, 0.25), D = ringAt(ii + 2, jj - 0.12, 0.25);
          stripPos.push(...A, ...C, ...B, ...A, ...D, ...C);
        }
        // 고드름 (천장 쪽, 끝이 도로에서 5.4 m 넘게 높을 때만)
        if (ii > i0 + 8 && ii < i1 - 8) {
          for (let k = 0; k < 3; k++) {
            const jj = (0.22 + rand() * 0.56) * M_SEG;
            const p = ringAt(ii + rand() * 2, jj, 0.3);
            const len = 0.8 + rand() * 2.2;
            const sy = S[wrapI(ii)].pos.y;
            if (p[1] - len < sy + 6.0) continue;
            icicles.push({ x: p[0], y: p[1] + 0.3, z: p[2], sx: 0.14 + rand() * 0.16, sy: len, sz: 0.14 + rand() * 0.16, ry: rand() * TAU });
          }
        }
        dist += step;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const shell = new THREE.Mesh(g, shellMat);
      shell.name = 'glacierTunnelShell';
      shell.renderOrder = 2;
      group.add(shell);
      // 입구 얼음 테두리 (두꺼운 아치) + 간판
      for (const [ii, dir] of [[i0, 1], [i1, -1]]) {
        // 입구 테두리: 도로 옆 땅에서 벽 바깥을 따라 올라가 지붕을 넘어 반대쪽으로 내려옴
        const pts = [];
        const sP = S[wrapI(ii)];
        const leg = (sd, y) => {
          const l = sd * (Math.max(edgeLat(wrapI(ii), 1), edgeLat(wrapI(ii), -1)) + 2.2);
          return new THREE.Vector3(sP.pos.x + sP.right.x * l, sP.pos.y + y, sP.pos.z + sP.right.z * l);
        };
        pts.push(leg(1, -1), leg(1, 3));
        for (let j = 0; j <= M_SEG; j++) pts.push(new THREE.Vector3(...ringAt(ii, j, -0.6)));
        pts.push(leg(-1, 3), leg(-1, -1));
        const curve = new THREE.CatmullRomCurve3(pts);
        const tube = new THREE.TubeGeometry(curve, 44, 1.5, 7, false);
        const cIce = new THREE.Color('#bfe6fb'), cSnow = new THREE.Color('#f4f8fd');
        const pg = paintGeo(tube, (c, x, y, z, nx, ny) => c.copy(ny > 0.45 ? cSnow : cIce));
        pg.computeVertexNormals();
        group.add(new THREE.Mesh(pg, portalMat));
        if (dir > 0) {
          const s = S[wrapI(ii)];
          const top = new THREE.Vector3(...ringAt(ii, M_SEG / 2, -2.2));
          const sign = new THREE.Mesh(planeWithUV(12, 12 * (192 / 512), ATL.uv(11)), signMat);
          sign.position.copy(top).setY(top.y - 0.4);
          sign.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.tan.clone().negate().setY(0).normalize());
          group.add(sign);
        }
      }
      tunnelInfo.push({ i0: a, i1: b, len: Math.round(dist) });
    }
    if (stripPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(stripPos, 3));
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, M.cyanGlow));
    }
    // 고드름: 밑동(y=0)이 천장, 끝(y=-1)이 아래
    instanced(new THREE.ConeGeometry(1, 1, 5, 1).rotateX(Math.PI).translate(0, -0.5, 0), icicleMat, icicles, { name: 'glacierIcicles' });
    stats.icicles = icicles.length;
    // 터널 안 은은한 푸른 빛 (빌보드)
    const NG = Math.max(1, TUN.length * 30);
    const tg = billboardCloud(NG, { map: TX.glow, additive: true, fogAmt: 0.6, name: 'glacierTunnelGlow' });
    let n = 0;
    const cc = new THREE.Color('#5fd0ff');
    for (const [a, b] of TUN)
      for (let ii = a; ii < b && n < NG; ii += Math.max(4, Math.floor((b - a) / 30))) {
        const s = S[wrapI(ii)];
        tg.set(n++, s.pos.x, s.pos.y + 8.5, s.pos.z, 10, 0, cc, 0.22);
      }
    for (let i = n; i < NG; i++) tg.alpha(i, 0);
    tg.flush();
    group.add(tg.mesh);
  }

  // 얼어붙은 강: 트랙 지형이 강바닥을 얼음 색으로 칠함 (track.onRiverIce) → 풍경은 따로 안 그림

  // ---------------------------------------------------------------- 얼어붙은 호수 (코스 안쪽, 도로에서 넓게 떨어진 곳) + 호숫가 마을
  let lake = null;
  {
    // 트랙이 호수 자리를 파 줬으면(track.lake) 그대로, 아니면 도로에서 50~150 m 떨어진 곳 중 가장 평평한 곳
    //   (이 맵 지형은 코스에서 130 m 넘게 떨어지면 눈산으로 솟음 → 너무 멀면 안 됨)
    let best = null;
    const TL = track.lake;
    if (TL) best = { x: TL.x, z: TL.z, d: TL.r + 45, y: TL.y };
    else {
      const RT = 85;
      for (let x = tb.min.x + 60; x < tb.max.x - 60; x += 25)
        for (let z = tb.min.y + 60; z < tb.max.y - 60; z += 25) {
          if (roadClear(x, z) < 39) continue;
          const d = roadDist(x, z);
          if (d < RT + 30 || d > RT + 80) continue;
          if (track.onRiverIce && track.onRiverIce(x, z)) continue;
          if (data.river) {
            const R = data.river;
            const u = (x - R.x) * R.dx + (z - R.z) * R.dz, w = (x - R.x) * -R.dz + (z - R.z) * R.dx;
            if (Math.abs(w) < RT + R.halfW + 20 && Math.abs(u) < R.halfLen + 100) continue;
          }
          let lo = 1e9, hi = -1e9;
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * TAU;
            for (const f of [0.45, 1]) {
              const y = groundY(x + Math.cos(a) * RT * f, z + Math.sin(a) * RT * f);
              lo = Math.min(lo, y);
              hi = Math.max(hi, y);
            }
          }
          // 출발 직선 쪽(보이는 곳)을 조금 더 좋아함
          const score = hi - lo + Math.hypot(x - s0.pos.x, z - s0.pos.z) * 0.002;
          if (!best || score < best.sc) best = { x, z, d: RT + 45, sc: score, range: hi - lo };
        }
      if (best) stats.lakeRange = +best.range.toFixed(1);
    }
    if (best && best.d > 90) {
      const RAD = TL ? TL.r : Math.min(230, best.d - 45);
      const NP = 56;
      const shape = [];
      for (let k = 0; k < NP; k++) {
        const a = (k / NP) * TAU;
        const r = RAD * (0.78 + 0.22 * noise(Math.cos(a) * 1.3 + 9, Math.sin(a) * 1.3, 2)) * (Math.abs(Math.cos(a)) > 0.5 ? 1.1 : 0.9);
        shape.push([best.x + Math.cos(a) * r, best.z + Math.sin(a) * r]);
      }
      // 얼음 높이: 테두리 땅 중 낮은 쪽 25% 값 → 대부분 땅 위에 살짝 덮이고 높은 곳은 눈 섬처럼 튀어나옴
      const hs = shape.map(([x, z]) => groundY(x, z)).sort((p, q) => p - q);
      const innerH = [];
      for (let k = 0; k < 40; k++) {
        const a = rand() * TAU, r = Math.sqrt(rand()) * RAD * 0.7;
        innerH.push(groundY(best.x + Math.cos(a) * r, best.z + Math.sin(a) * r));
      }
      innerH.sort((p, q) => p - q);
      const yIce = TL && TL.y != null ? TL.y + 0.05 : Math.max(hs[Math.floor(hs.length * 0.25)], innerH[Math.floor(innerH.length * 0.6)]) + 0.35;
      // 호수 판 (부채꼴 삼각형) + 테두리 아래로 내려가는 눈 벽 (뜬 가장자리를 가림)
      const pos = [], uv = [];
      const UVs = (x, z) => [(x - best.x) / 120, (z - best.z) / 120];
      for (let k = 0; k < NP; k++) {
        const A = shape[k], B = shape[(k + 1) % NP];
        pos.push(best.x, yIce, best.z, B[0], yIce, B[1], A[0], yIce, A[1]);
        uv.push(...UVs(best.x, best.z), ...UVs(B[0], B[1]), ...UVs(A[0], A[1]));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const tex = lakeIceTexture(21);
      const lakeMat = new THREE.MeshPhongMaterial({ color: '#d9eefa', map: tex, shininess: 120, specular: '#d8f0ff', emissive: '#1a3a5a', emissiveIntensity: 0.45 });
      const lakeMesh = new THREE.Mesh(g, lakeMat);
      lakeMesh.receiveShadow = true;
      group.add(lakeMesh);
      // 테두리 눈 둑 (바깥으로 낮아짐)
      const rim = [], rc = [];
      const cR = new THREE.Color('#e9f0f9'), cR2 = new THREE.Color('#c8d6ea');
      for (let k = 0; k < NP; k++) {
        const A = shape[k], B = shape[(k + 1) % NP];
        const ring = (P, f) => {
          const vx = P[0] - best.x, vz = P[1] - best.z, l = Math.hypot(vx, vz);
          const x = best.x + (vx / l) * (l + f * 9), z = best.z + (vz / l) * (l + f * 9);
          const gy = groundY(x, z);
          return [x, f === 0 ? yIce - 4 : f === 1 ? Math.max(yIce + 0.9, gy + 0.6) : gy - 0.3, z];
        };
        for (let f = 0; f < 2; f++) {
          const a0 = ring(A, f), b0 = ring(B, f), a1 = ring(A, f + 1), b1 = ring(B, f + 1);
          rim.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
          for (let v = 0; v < 6; v++) rc.push(...(f === 0 ? cR2 : cR).toArray());
        }
      }
      // 첫 줄(얼음 아래 → 테두리 위)은 얼음 판 가장자리에 붙도록 시작점을 얼음 높이로
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
      rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
      rg.computeVertexNormals();
      group.add(new THREE.Mesh(rg, M.vcol));
      lake = { x: best.x, z: best.z, r: RAD, y: yIce };
      occupy(best.x, best.z, RAD * 1.08);
      stats.lake = { x: Math.round(best.x), z: Math.round(best.z), r: Math.round(RAD), y: +yIce.toFixed(1) };
      // 얼음 위 작은 것들: 얼음낚시 텐트·스케이트 하는 사람 대신 = 작은 텐트 몇 개 (꼭짓점 색)
      const tents = [];
      for (let k = 0; k < 7; k++) {
        const a = rand() * TAU, r = RAD * (0.2 + rand() * 0.45);
        tents.push({ x: best.x + Math.cos(a) * r, y: yIce, z: best.z + Math.sin(a) * r, sx: 1, ry: rand() * TAU });
      }
      const tentGeo = mergeColored([
        paintGeo(new THREE.ConeGeometry(1.6, 2.2, 4, 1).toNonIndexed().translate(0, 1.1, 0), (c) => c.set(['#e04a3a', '#2f7fd8', '#ffb21f'][Math.floor(rand() * 3)])),
        paintGeo(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 4).toNonIndexed().translate(0, 2.3, 0), '#333'),
      ]);
      tentGeo.computeVertexNormals();
      instanced(tentGeo, M.vcolFlat, tents);
    }
  }

  // ---------------------------------------------------------------- 통나무 마을 + 스키 산장 (호숫가, 없으면 출발 직선 안쪽 뒤)
  const cabins = [];
  const chimneys = [];
  const village = lake ? { x: lake.x, z: lake.z, r: lake.r + 28 } : { x: center.x, z: center.z, r: 80 };
  {
    let tries = 0;
    while (cabins.length < 12 && tries++ < 400) {
      const a = rand() * TAU, r = village.r + rand() * 60;
      const x = village.x + Math.cos(a) * r, z = village.z + Math.sin(a) * r;
      if (!inBox(x, z, 30) || roadDist(x, z) < 22 || !free(x, z, 7)) continue;
      const sc = 0.9 + rand() * 0.35;
      const gy = lowGround(x, z, 4.5 * sc);
      const ry = Math.atan2(village.x - x, village.z - z) + (rand() - 0.5) * 0.5; // 앞(+z)이 호수를 봄
      cabins.push({ x, y: gy - 0.1, z, sx: sc, ry });
      occupy(x, z, 7 * sc);
      solid(x, z, 4.6 * sc, gy - 1, gy + 8 * sc);
      // 굴뚝 자리 (cabinGeo의 굴뚝 x 2.6, z -1.4, 꼭대기 7.7)
      const cx = 2.6 * sc, cz = -1.4 * sc;
      chimneys.push([x + Math.cos(ry) * cx + Math.sin(ry) * cz, gy + 7.8 * sc, z - Math.sin(ry) * cx + Math.cos(ry) * cz]);
    }
    // 스키 산장 (큰 오두막 = 2.3배)
    {
      let pick = null;
      for (let k = 0; k < 200 && !pick; k++) {
        const a = rand() * TAU, r = village.r + 70 + rand() * 80;
        const x = village.x + Math.cos(a) * r, z = village.z + Math.sin(a) * r;
        if (inBox(x, z, 40) && roadDist(x, z) > 30 && free(x, z, 18)) pick = { x, z };
      }
      if (pick) {
        const sc = 2.3;
        const gy = lowGround(pick.x, pick.z, 10);
        const ry = Math.atan2(village.x - pick.x, village.z - pick.z);
        cabins.push({ x: pick.x, y: gy - 0.2, z: pick.z, sx: sc, ry, lodge: true });
        occupy(pick.x, pick.z, 18);
        solid(pick.x, pick.z, 10, gy - 1, gy + 18);
        chimneys.push([pick.x + Math.cos(ry) * 2.6 * sc + Math.sin(ry) * -1.4 * sc, gy + 7.8 * sc, pick.z - Math.sin(ry) * 2.6 * sc + Math.cos(ry) * -1.4 * sc]);
        stats.lodge = { x: Math.round(pick.x), z: Math.round(pick.z) };
        village.lodge = { x: pick.x, z: pick.z, y: gy };
      }
    }
    const cg = cabinGeo();
    instanced(cg, M.vcolFlat, cabins, { name: 'glacierCabins', shadow: true });
    instanced(cabinWindowsGeo(), M.warmGlow, cabins, { name: 'glacierCabinWindows' });
    // 굴뚝 연기
    const NP = chimneys.length * 5;
    if (NP) {
      const smoke = billboardCloud(NP, { map: TX.smoke, fogAmt: 0.8, name: 'glacierChimneySmoke' });
      group.add(smoke.mesh);
      const sc = new THREE.Color('#dfe6f0');
      animators.push((t) => {
        let n = 0;
        for (const [x, y, z] of chimneys)
          for (let k = 0; k < 5; k++) {
            const f = (t * 0.12 + k / 5) % 1;
            smoke.set(n++, x + f * 9, y + f * 14, z + f * 4, 2 + f * 9, f * 2 + k, sc, 0.42 * (1 - f) * Math.min(1, f * 6));
          }
        smoke.flush();
      });
    }
    stats.cabins = cabins.length;
  }

  // ---------------------------------------------------------------- 케이블카: 산장(또는 마을) → 가장 가까운 상자 끝 너머 산 위
  {
    const base = village.lodge || { x: village.x, z: village.z, y: groundY(village.x, village.z) };
    // 가장 가까운 상자 끝 방향
    const dl = base.x - tb.min.x, dr = tb.max.x - base.x, dt = base.z - tb.min.y, db = tb.max.y - base.z;
    const m = Math.min(dl, dr, dt, db);
    const dir = m === dl ? [-1, 0] : m === dr ? [1, 0] : m === dt ? [0, -1] : [0, 1];
    const start = new THREE.Vector3(base.x + dir[0] * 30, 0, base.z + dir[1] * 30);
    start.y = groundY(start.x, start.z);
    const len = m + 330;
    const end = new THREE.Vector3(base.x + dir[0] * len, 0, base.z + dir[1] * len);
    end.y = mtnAt(end.x, end.z).y;
    const yAt = (x, z) => (inBox(x, z, 2) ? groundY(x, z) : Math.max(groundY(Math.min(Math.max(x, tb.min.x + 3), tb.max.x - 3), Math.min(Math.max(z, tb.min.y + 3), tb.max.y - 3)), mtnAt(x, z).y));
    // 도로를 가로지르면 철탑을 도로 근처에 세우지 않음
    const NPY = Math.max(3, Math.round(start.distanceTo(end) / 110));
    const towerMat = new THREE.MeshLambertMaterial({ color: '#c9d2dc' });
    const tops = [];
    for (let k = 0; k <= NPY; k++) {
      const f = k / NPY;
      const x = start.x + (end.x - start.x) * f, z = start.z + (end.z - start.z) * f;
      const gy = yAt(x, z);
      const h = k === 0 || k === NPY ? 10 : 18;
      if (k > 0 && k < NPY && roadDist(x, z) < 10) {
        tops.push(new THREE.Vector3(x, gy + h + 6, z));
        continue;
      }
      const py = new THREE.Mesh(pylonGeo(h, 5), towerMat);
      py.position.set(x, gy - 0.5, z);
      py.rotation.y = Math.atan2(dir[0], dir[1]) + Math.PI / 2;
      group.add(py);
      solid(x, z, 2.5, gy - 1, gy + h);
      tops.push(new THREE.Vector3(x, gy + h - 0.3, z));
    }
    // 정류장 (아래·위): 간단한 상자 건물
    for (const P of [start, end]) {
      const st = new THREE.Mesh(colorBoxes([[14, 6, 10, 0, 3, 0, '#3a4656'], [15, 0.6, 11, 0, 6.3, 0, '#eef3fa'], [14.2, 1.6, 10.2, 0, 4.2, 0, '#ffc977']]), M.vcolFlat);
      st.geometry.computeVertexNormals();
      st.position.set(P.x, (inBox(P.x, P.z, 2) ? groundY(P.x, P.z) : P.y) - 0.3, P.z);
      st.rotation.y = Math.atan2(dir[0], dir[1]);
      group.add(st);
    }
    // 줄 2가닥 (오르는 줄·내리는 줄), 처진 곡선
    const side = new THREE.Vector3(-dir[1], 0, dir[0]);
    const lines = [];
    const cablePts = [[], []];
    for (let w = 0; w < 2; w++) {
      const off = (w ? 1 : -1) * 2.6;
      for (let k = 0; k < tops.length - 1; k++) {
        const A = tops[k].clone().addScaledVector(side, off), B = tops[k + 1].clone().addScaledVector(side, off);
        const sag = A.distanceTo(B) * 0.03;
        for (let s = 0; s < 8; s++) {
          const f0 = s / 8, f1 = (s + 1) / 8;
          const P0 = A.clone().lerp(B, f0), P1 = A.clone().lerp(B, f1);
          P0.y -= sag * 4 * f0 * (1 - f0);
          P1.y -= sag * 4 * f1 * (1 - f1);
          lines.push(P0, P1);
          cablePts[w].push(P0);
        }
      }
      cablePts[w].push(tops[tops.length - 1].clone().addScaledVector(side, off));
    }
    const lg = new THREE.BufferGeometry().setFromPoints(lines);
    const cable = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#2a2f38' }));
    cable.name = 'glacierCable';
    group.add(cable);
    // 곤돌라: 두 줄 위를 반대로 움직임
    const NG = 10;
    const gond = new THREE.InstancedMesh(gondolaGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), NG);
    gond.name = 'glacierGondolas';
    gond.userData.noBatch = true;
    gond.frustumCulled = false;
    group.add(gond);
    const cum = cablePts.map((pts) => {
      const c = [0];
      for (let k = 1; k < pts.length; k++) c.push(c[k - 1] + pts[k].distanceTo(pts[k - 1]));
      return c;
    });
    const at = (w, f, out) => {
      const pts = cablePts[w], c = cum[w], L = c[c.length - 1];
      const d = f * L;
      let k = 1;
      while (k < c.length - 1 && c[k] < d) k++;
      const u = (d - c[k - 1]) / Math.max(1e-6, c[k] - c[k - 1]);
      return out.copy(pts[k - 1]).lerp(pts[k], u);
    };
    const gq = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(dir[0], dir[1]) + Math.PI / 2);
    const one = new THREE.Vector3(1, 1, 1);
    animators.push((t) => {
      for (let k = 0; k < NG; k++) {
        const w = k % 2;
        let f = ((t * 0.006 + k / NG) % 1);
        if (w) f = 1 - f;
        at(w, f, tmpV);
        m4L.compose(tmpV, gq, one);
        gond.setMatrixAt(k, m4L);
      }
      gond.instanceMatrix.needsUpdate = true;
    });
    stats.lift = { len: Math.round(start.distanceTo(end)), pylons: tops.length };
  }

  // ---------------------------------------------------------------- 풍력 발전기 (산자락 위 한 줄, 천천히 돎)
  {
    // 출발 직선에서 잘 보이는 쪽 = 바깥 쪽 상자 끝 너머 산자락
    const list = [];
    const kStart = Math.floor(rand() * MTN.N);
    for (let n = 0; n < 9; n++) {
      const k = (kStart + n * 9) % MTN.N;
      const q = MTN.dirs[k];
      const d = 30 + (n % 2) * 40;
      const x = q.bx + q.nx * d, z = q.bz + q.nz * d;
      const y = MTN.H(q.u, d, MTN.baseOf[k]) - 2;
      list.push({ x, y, z, ry: Math.atan2(-q.nx, -q.nz) + 0.4 });
    }
    // 출발 직선 바깥 쪽에도 한 줄 (가장 잘 보이는 곳)
    for (let n = 0; n < 5; n++) {
      const along = -260 + n * 150;
      const p = atStart(along, outer * (HW0 + 170 + (n % 2) * 60));
      if (!inBox(p.x, p.z, 20) || roadDist(p.x, p.z) < 60 || !free(p.x, p.z, 20)) continue;
      list.push({ x: p.x, y: lowGround(p.x, p.z, 3) - 0.5, z: p.z, ry: yawOf(s0) + Math.PI / 2 * outer });
      solid(p.x, p.z, 2.2, p.y - 2, p.y + 70);
      occupy(p.x, p.z, 20);
    }
    const H = 62;
    const towers = instanced(turbineTowerGeo(H), M.vcol, list, { name: 'glacierTurbines' });
    const rotors = new THREE.InstancedMesh(turbineRotorGeo(27), M.vcol, list.length);
    rotors.name = 'glacierRotors';
    rotors.userData.noBatch = true;
    group.add(rotors);
    const q = new THREE.Quaternion(), qs = new THREE.Quaternion(), qr = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const hub = list.map((o) => {
      qs.setFromAxisAngle(UP, o.ry);
      return { p: new THREE.Vector3(0, H + 1, 3.9).applyQuaternion(qs).add(new THREE.Vector3(o.x, o.y, o.z)), q: qs.clone(), sp: 0.7 + rand() * 0.4, ph: rand() * TAU };
    });
    const zAx = new THREE.Vector3(0, 0, 1);
    animators.push((t) => {
      hub.forEach((h, k) => {
        qr.setFromAxisAngle(zAx, t * h.sp + h.ph);
        q.copy(h.q).multiply(qr);
        m4L.compose(h.p, q, one);
        rotors.setMatrixAt(k, m4L);
      });
      rotors.instanceMatrix.needsUpdate = true;
    });
    void towers;
    stats.turbines = list.length;
  }

  // ---------------------------------------------------------------- 연구 기지 + 오로라 관측소 (코스 안쪽 높은 곳)
  {
    let best = null;
    for (let k = 0; k < 600; k++) {
      const x = tb.min.x + 80 + rand() * (tb.max.x - tb.min.x - 160), z = tb.min.y + 80 + rand() * (tb.max.y - tb.min.y - 160);
      const d = roadDist(x, z);
      if (d < 70 || d > 260 || !free(x, z, 40)) continue;
      const y = groundY(x, z);
      const sc = y - d * 0.02;
      if (!best || sc > best.sc) best = { x, z, y, sc };
    }
    if (best) {
      const g = new THREE.Group();
      g.position.set(best.x, lowGround(best.x, best.z, 12) - 0.3, best.z);
      g.rotation.y = Math.atan2(center.x - best.x, center.z - best.z);
      const obs = observatory();
      obs.obj.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        const h = o.material.color.getHexString();
        if (h === '8b5cff' || h === '5b4bb5') o.material.color.set('#2f7fd8');
      });
      g.add(obs.obj);
      const rd = radarDish({ size: 0.8 });
      rd.obj.position.set(16, 0, 6);
      g.add(rd.obj);
      const ant = antennaMast({ height: 22 });
      ant.obj.position.set(-14, 0, 4);
      g.add(ant.obj);
      const lab = new THREE.Mesh(colorBoxes([
        [18, 5, 9, 0, 2.5, 0, '#e04a3a'], [18.4, 0.5, 9.4, 0, 5.2, 0, '#eef3fa'], [18.1, 1.2, 9.1, 0, 3.2, 0, '#ffc977'],
        [8, 4, 6, 14, 2, -9, '#f2f5f9'], [8.3, 0.4, 6.3, 14, 4.2, -9, '#eef3fa'],
      ]), M.vcolFlat);
      lab.geometry.computeVertexNormals();
      lab.position.set(0, 0, -16);
      g.add(lab);
      group.add(g);
      updaters.push((t, dt) => {
        if (obs.update) obs.update(t, dt);
        if (rd.update) rd.update(t, dt);
        if (ant.update) ant.update(t, dt);
      });
      solid(best.x, best.z, 12, g.position.y - 1, g.position.y + 16);
      occupy(best.x, best.z, 40);
      stats.station = { x: Math.round(best.x), z: Math.round(best.z) };
    }
  }

  // ---------------------------------------------------------------- 1 km 표지판 + 광고판 + 위험 표지
  {
    const L = track.length || NS * 2;
    const per = NS / L;
    for (let km = 1; km <= 4; km++) {
      const i = Math.round(km * 1000 * per);
      if (i >= NS || inTunnel(i, 20) || onBridge(i, 20)) continue;
      roadBoard(i, inner, 3.5, km, 3.6, 3.6 * (192 / 512), 1.6);
    }
    // 광고판: 곧은 곳 바깥쪽 (곡률 작은 곳), 다리·터널 빼고
    const curv = (i) => {
      const a = S[wrapI(i - 12)].tan, b = S[wrapI(i + 12)].tan;
      return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
    };
    const spots = [];
    const spacing = Math.round(NS / 13);
    for (let k = 0; k < 13; k++) {
      let i = wrapI(Math.round(NS * 0.04) + k * spacing);
      if (inTunnel(i, 30) || onBridge(i, 30) || i < 120 || i > NS - 120) continue;
      const cv = curv(i);
      const sd = cv < 0.05 ? (k % 2 ? 1 : -1) : -Math.sign(S[wrapI(i + 12)].tan.clone().cross(S[wrapI(i - 12)].tan).y || 1) * -1;
      spots.push([i, sd, 5 + (k % 5)]);
    }
    spots.forEach(([i, sd, cell], k) => roadBoard(i, sd, 9 + (k % 3) * 3, cell, 13, 13 * (192 / 512), 2.2));
    // 출발 직선 끝 (T1 앞) 결빙 주의
    const secs = data.sections || {};
    for (const nm of ['T1', 'T2', 'T3']) {
      if (!secs[nm]) continue;
      const i = idxAt(secs[nm][0]) - 70;
      const s = S[wrapI(i)], sN = S[wrapI(i + 100)];
      const turnRight = s.tan.clone().cross(sN.tan).y < 0;
      roadBoard(i, turnRight ? -1 : 1, 5, 13, 6, 6 * (192 / 512), 1.8);
    }
    // 다리 앞 간판
    for (const [a] of BRG) roadBoard(a - 60, outer, 6, 12, 8, 8 * (192 / 512), 2);
    // 결승 직전 FINISH · 오로라 전망대 간판
    roadBoard(NS - 90, outer, 8, 14, 10, 10 * (192 / 512), 2.4);
    roadBoard(Math.round(NS * 0.3), inner, 14, 15, 12, 12 * (192 / 512), 2.4);
  }

  // ---------------------------------------------------------------- 눈 울타리 (빠른 스위퍼 바깥 쪽)
  {
    const list = [];
    const secs = data.sections || {};
    for (const nm of ['S1', 'S3', 'S4', 'b']) {
      const r = secs[nm];
      if (!r) continue;
      let a = idxAt(r[0]), b = idxAt(r[1]);
      if (b < a) b += NS;
      const mid = S[wrapI(Math.round((a + b) / 2))];
      const nx = S[wrapI(Math.round((a + b) / 2) + 20)];
      const right = mid.tan.clone().cross(nx.tan).y < 0;
      const sd = right ? -1 : 1; // 코너 바깥
      for (let i = a; i < b; i += 2) {
        const ii = wrapI(i);
        const s = S[ii];
        if (inTunnel(ii, 10) || onBridge(ii, 10)) continue;
        const lat = edgeLat(ii, sd) + 10;
        const x = s.pos.x + s.right.x * sd * lat, z = s.pos.z + s.right.z * sd * lat;
        if (list.length && Math.hypot(x - list[list.length - 1].x, z - list[list.length - 1].z) < 4.05) continue;
        if (!free(x, z, 2)) continue;
        const gy = groundY(x, z);
        list.push({ x, y: gy - 0.1, z, ry: yawOf(s) + Math.PI / 2 });
        solid(x, z, 1.1, gy - 1, gy + 1.6);
      }
    }
    instanced(snowFenceGeo(), M.vcolFlat, list, { lod: 500 });
    stats.fences = list.length;
  }

  // ---------------------------------------------------------------- 숲: 눈 덮인 전나무 (가까운 것 = 자세히, LOD) + 먼 숲
  {
    const near = [], far = [];
    const nearMax = 4200;
    let tries = 0;
    while (near.length < nearMax && tries++ < 40000) {
      const x = tb.min.x + 15 + rand() * (tb.max.x - tb.min.x - 30), z = tb.min.y + 15 + rand() * (tb.max.y - tb.min.y - 30);
      // 숲 덩어리 (노이즈 높은 곳에 빽빽), 길가 가까이도 조금
      const dens = noise(x / 260, z / 260, 3) * 0.7 + noise(x / 70, z / 70, 1) * 0.3;
      const d = roadClear(x, z);
      const want = dens > 0.08 || (d < 40 && dens > -0.1 && rand() < 0.35);
      if (!want) continue;
      if (d < 8 || !free(x, z, 3)) continue;
      if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r + 10) continue;
      if (data.river) {
        const R = data.river;
        const w = (x - R.x) * -R.dz + (z - R.z) * R.dx;
        const u = (x - R.x) * R.dx + (z - R.z) * R.dz;
        if (Math.abs(w) < R.halfW + 8 && Math.abs(u) < R.halfLen + 250) continue;
      }
      const gy = groundY(x, z);
      const h = 7 + rand() * 11 + (d > 60 ? rand() * 6 : 0);
      const o = { x, y: gy - 0.3, z, sx: h * (0.75 + rand() * 0.25), sy: h, ry: rand() * TAU };
      o.sz = o.sx;
      near.push(o);
      if (d < 30) solid(x, z, 0.6, gy - 1, gy + h);
    }
    const g1 = snowPineGeo(3), g2 = snowPineGeo(11, 6);
    const half = Math.floor(near.length / 2);
    instanced(g1, M.vcol, near.slice(0, half), { name: 'glacierPinesA', shadow: true, lod: 560 });
    instanced(g2, M.vcol, near.slice(half), { name: 'glacierPinesB', shadow: true, lod: 560 });
    // 먼 숲: 상자 끝 안쪽 띠 + 산자락 (원뿔 하나)
    for (let k = 0; k < 5200; k++) {
      let x, z, y;
      if (k < 2600) {
        const kk = Math.floor(rand() * MTN.N), q = MTN.dirs[kk];
        const d = -30 + rand() * 170;
        x = q.bx + q.nx * d;
        z = q.bz + q.nz * d;
        y = d < 0 && inBox(x, z, 1) ? groundY(x, z) : MTN.H(q.u, d, MTN.baseOf[kk]);
        if (y - MTN.baseOf[kk] > 70) continue;
      } else {
        x = tb.min.x + rand() * (tb.max.x - tb.min.x);
        z = tb.min.y + rand() * (tb.max.y - tb.min.y);
        if (noise(x / 260, z / 260, 3) < 0.15 || roadClear(x, z) < 150) continue;
        if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r + 10) continue;
        y = groundY(x, z);
      }
      const h = 10 + rand() * 12;
      far.push({ x, y: y - 0.5, z, sx: h * 0.9, sy: h, sz: h * 0.9, ry: rand() * TAU });
    }
    instanced(farPineGeo(), M.vcolFlat, far, { name: 'glacierFarPines' });
    stats.pines = near.length;
    stats.farPines = far.length;
  }

  // ---------------------------------------------------------------- 눈 모자 바위
  {
    const list = [];
    let tries = 0;
    while (list.length < 520 && tries++ < 8000) {
      const x = tb.min.x + 15 + rand() * (tb.max.x - tb.min.x - 30), z = tb.min.y + 15 + rand() * (tb.max.y - tb.min.y - 30);
      const d = roadClear(x, z);
      if (d < 6 || (d > 120 && rand() < 0.6) || !free(x, z, 2)) continue;
      if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r - 5) continue;
      const big = rand() < 0.15;
      const r = big ? 4 + rand() * 6 : 0.8 + rand() * 2.2;
      if (d < 3 + r + 2) continue;
      const gy = groundY(x, z);
      list.push({ x, y: gy + r * 0.15, z, sx: r * (0.9 + rand() * 0.4), sy: r * (0.7 + rand() * 0.6), sz: r, ry: rand() * TAU });
      if (d < 40) solid(x, z, r * 0.85, gy - 1, gy + r);
    }
    const half = Math.floor(list.length / 2);
    instanced(snowRockGeo(5), M.vcolFlat, list.slice(0, half), { name: 'glacierRocksA', lod: 600 });
    instanced(snowRockGeo(17, 1, 0.55), M.vcolFlat, list.slice(half), { name: 'glacierRocksB', lod: 600 });
    stats.rocks = list.length;
  }

  // ---------------------------------------------------------------- 하늘을 나는 것: 헬리콥터 (코스 위를 크게 돎) + 새 떼
  {
    const heli = helicopterModel();
    heli.obj.name = 'glacierHeli';
    heli.obj.traverse((o) => {
      if (o.isMesh) o.userData.noBatch = true;
    });
    group.add(heli.obj);
    const Rh = Math.min(boxH.x, boxH.y) * 0.55;
    animators.push((t, dt) => {
      const a = t * 0.035;
      const x = center.x + Math.cos(a) * Rh, z = center.z + Math.sin(a) * Rh * 0.8;
      heli.obj.position.set(x, 95 + Math.sin(t * 0.3) * 6, z);
      heli.obj.rotation.set(0.08, Math.atan2(-Math.sin(a), Math.cos(a) * 0.8) + 0, -0.12);
      heli.rotor.rotation.y += dt * 22;
      heli.tail.rotation.x += dt * 30;
    });
    // 새 떼 2무리
    const NB = 26;
    const birds = new THREE.InstancedMesh(birdGeo(), new THREE.MeshBasicMaterial({ color: '#1d2433', side: THREE.DoubleSide }), NB);
    birds.name = 'glacierBirds';
    birds.userData.noBatch = true;
    birds.frustumCulled = false;
    group.add(birds);
    const flock = [];
    for (let k = 0; k < NB; k++) flock.push({ f: k < 14 ? 0 : 1, ox: (rand() - 0.5) * 30, oy: (rand() - 0.5) * 8, oz: (rand() - 0.5) * 30, ph: rand() * TAU, s: 1.6 + rand() * 0.8 });
    const fc = [
      { x: lake ? lake.x : center.x, z: lake ? lake.z : center.z, r: 160, y: 60, sp: 0.05 },
      { x: s0.pos.x + s0.right.x * outer * 250, z: s0.pos.z + s0.right.z * outer * 250, r: 220, y: 80, sp: -0.04 },
    ];
    const bq = new THREE.Quaternion(), bs = new THREE.Vector3();
    animators.push((t) => {
      flock.forEach((b, k) => {
        const F = fc[b.f];
        const a = t * F.sp + b.f * 2;
        const x = F.x + Math.cos(a) * F.r + b.ox, z = F.z + Math.sin(a) * F.r + b.oz;
        const flap = Math.sin(t * 9 + b.ph);
        bq.setFromEuler(new THREE.Euler(0, Math.atan2(-Math.sin(a) * Math.sign(F.sp), Math.cos(a) * Math.sign(F.sp)), 0));
        bs.set(b.s, b.s * (0.3 + flap * 0.9), b.s);
        m4L.compose(tmpV.set(x, groundY(Math.min(Math.max(F.x, tb.min.x), tb.max.x), Math.min(Math.max(F.z, tb.min.y), tb.max.y)) + F.y + b.oy + flap * 0.3, z), bq, bs);
        birds.setMatrixAt(k, m4L);
      });
      birds.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- 충돌
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

  group.traverse((o) => {
    if (o.isInstancedMesh) o.userData.noBatch = true;
  });
  const buildMs = Math.round(performance.now() - t0);
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
    sky,
    lake: () => lake,
    tunnels: tunnelInfo,
    stats: Object.assign(stats, { colliders: allColliders.length, occupied: occupied.length, buildMs }),
  };
}
