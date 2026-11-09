// 구름섬 그랑프리 풍경: 하늘(gpSky.js) + 구조물(gpAssets.js)을 코스에 맞게 배치합니다.
//
//   하버 섬(출발)   : 출발 게이트, 관중석, 피트 건물, 관제탑, 깃발, 계류탑에 묶인 비행선, 항구 크레인
//   사장교          : 흰 주탑 2개와 케이블, 바다(구름)까지 내려가는 교각
//   풍차 섬         : 풍차, 동화 같은 집, 꽃밭, 벚꽃, 폭포, 열기구
//   교차 고가도로   : 기둥, 떠 있는 바위
//   봉우리 섬       : 눈 덮인 산, 소나무 숲, 등대, 폭포
//   하늘 협곡       : 활주로 안내판·유도등·아치, 비행 고리(gpProps.js), 수정 동굴 섬(수정, 버섯)
//   마지막 시케인   : 싱크홀 경고판, 타이어 벽
//   과수원 섬       : 줄지어 선 과일나무, 풍차, 집, 꽃밭
//   스타게이트 섬   : 우주로 가는 포털 2개, 로켓 발사대(차가 오면 발사), 천문대, 전파 망원경, 안테나
//   수정 폭포 섬    : 수정, 버섯, 소나무, 폭포
//   호수 마을 섬    : 호수(물), 나무 선착장, 작은 배, 집, 풍차
//   우주 차원       : gpSpace.js (포털 A~B 사이. 포털을 지나면 하늘·빛이 우주로 바뀜)
// 배치 위치(t)는 data/grandprix.json 의 "places" 에 있음 (코스를 바꾸면 거기만 고치면 됨)
// 큰 물체는 충돌체(원, 높이 범위)가 있어 차가 통과하지 못합니다.
import * as THREE from 'three';
import { seededRandom } from './track.js';
import * as A from './gpAssets.js';
import { createSky, islandUnderside, floatingRock, waterfall, createFlora } from './gpSky.js';
import { buildSpace, rocketPad, observatory, radarDish, antennaMast } from './gpSpace.js';

const CAR_R = 1.3; // 차의 충돌 반지름
const CELL = 24; // 충돌체 격자
const UP = new THREE.Vector3(0, 1, 0);

export function buildGrandPrixScenery(track, scene) {
  const rand = seededRandom(20261106);
  const R = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const W = track.width, HW = W / 2, CURB = track.curb, DECK = track.deckHalf;
  const group = new THREE.Group();
  scene.add(group);
  const animators = []; // (time, dt, car) => void
  const tmpV = new THREE.Vector3();

  // ---------------------------------------------------------------- 충돌체 (원, 높이 y0~y1)
  const grid = new Map();
  let stamp = 0;
  const allColliders = [];
  function addCollider(c) {
    c.stamp = 0;
    if (location.search.includes('coldebug')) c.src = new Error().stack.split(String.fromCharCode(10)).slice(2, 4).map((x) => x.trim()).join(' <- ');
    allColliders.push(c);
    for (let cx = Math.floor((c.x - c.r) / CELL); cx <= Math.floor((c.x + c.r) / CELL); cx++)
      for (let cz = Math.floor((c.z - c.r) / CELL); cz <= Math.floor((c.z + c.r) / CELL); cz++) {
        const k = `${cx},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
  }
  const circle = (x, z, r, y0, y1) => addCollider({ x, z, r, y0, y1 });
  /** 단단한(부딪히는) 나무는 도로 연석 바깥으로 5 m 이상 떨어뜨림 (넓게 나간 차가 바로 나무에 걸리지 않게) */
  const treeOk = (x, z) => track.nearestRaw(tmpV.set(x, 0, z)) > HW + CURB + 5;

  // ---------------------------------------------------------------- 자리 찾기
  const occupied = [];
  const free = (x, z, r) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
  const occupy = (x, z, r) => occupied.push({ x, z, r });
  /** 모든 도로·다른 길에서 충분히 떨어졌는지 */
  function roadClear(x, z, r, margin = 4) {
    tmpV.set(x, 0, z);
    if (track.nearestRaw(tmpV) < HW + CURB + margin + r) return false;
    for (const p of track.altPaths) {
      for (let k = 0; k < p.samples.length; k += 3) {
        const q = p.samples[k].pos;
        if ((q.x - x) ** 2 + (q.z - z) ** 2 < (p.half + margin + r) ** 2) return false;
      }
    }
    return true;
  }
  /** 섬 위 (가장자리에서 edge m 이상 안쪽)면 땅 높이, 아니면 null */
  function landY(x, z, edge = 3) {
    if (track.fieldAt(x, z) < edge) return null;
    return track.heightAt(x, z);
  }
  const zones = track.data.scenery || [];
  const inZone = (t, z) => (z.t0 <= z.t1 ? t >= z.t0 && t < z.t1 : t >= z.t0 || t < z.t1);
  const zonesOf = (theme) => zones.filter((z) => z.theme === theme);
  /** 테마 구역 전체 길이 (m) → 물건 개수를 길이에 맞춤 (예전 3 km 코스 기준 길이 base) */
  const zoneM = (theme) => zonesOf(theme).reduce((a, z) => a + (((z.t1 - z.t0 + 1) % 1) || 1) * track.length, 0);
  const per = (theme, n, base) => Math.max(0, Math.round((n * zoneM(theme)) / base));
  /** 테마 구역 안, 도로에서 dMin~dMax 떨어진 빈 땅 */
  function spot(theme, dMin, dMax, r, { margin = 4, edge = 4, tries = 40 } = {}) {
    const zs = zonesOf(theme);
    if (!zs.length) return null;
    for (let k = 0; k < tries; k++) {
      const zone = pick(zs);
      const span = (zone.t1 - zone.t0 + 1) % 1 || 1;
      const t = (zone.t0 + rand() * span) % 1;
      const s = track.sampleAt(t);
      const sgn = rand() < 0.5 ? -1 : 1;
      const d = dMin + (dMax - dMin) * Math.pow(rand(), 1.4);
      const x = s.pos.x + s.right.x * sgn * d, z = s.pos.z + s.right.z * sgn * d;
      const y = landY(x, z, edge + r * 0.5);
      if (y === null || !roadClear(x, z, r, margin) || !free(x, z, r)) continue;
      const n = track.nearest(tmpV.set(x, y, z));
      if (!inZone(n.t, zone)) continue;
      // 도로를 바라보는 방향
      const yaw = Math.atan2(n.sample.pos.x - x, n.sample.pos.z - z);
      return { x, y, z, t: n.t, yaw, d: n.dist };
    }
    return null;
  }
  const add = (obj, x, y, z, yaw = 0, parent = group) => {
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    parent.add(obj);
    return obj;
  };
  const anim = (r) => r && r.update && animators.push((t, dt, car) => r.update(t, dt, car));
  /** 도로 옆 (s, 옆 거리 l)의 월드 위치와 '도로 쪽을 등진' 방향 */
  function beside(t, l) {
    const s = track.sampleAt(t);
    const p = track.surf(s, l, 0, new THREE.Vector3());
    return { s, p, yaw: Math.atan2(s.tan.x, s.tan.z) };
  }

  // 구름섬 쪽 코스가 차지하는 범위 (우주 구간 빼고)
  const cloudBox = new THREE.Box2();
  for (const s of track.samples) if (!s.space) cloudBox.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
  cloudBox.expandByScalar(60);
  const cbC = cloudBox.getCenter(new THREE.Vector2()), cbS = cloudBox.getSize(new THREE.Vector2());
  const places = track.data.places || {};
  const tAtM = (m) => (((m / track.length) % 1) + 1) % 1; // 출발선에서 m 미터 → t

  // ---------------------------------------------------------------- 하늘, 구름 바다, 먼 섬
  const sky = createSky(scene, { center: new THREE.Vector3(cbC.x, 0, cbC.y), radius: Math.max(660, Math.hypot(cbS.x, cbS.y) / 2 + 20), halfX: Math.max(620, cbS.x / 2), halfZ: Math.max(420, cbS.y / 2) });
  animators.push((t, dt, car) => sky.update(t, dt, car ? car.pos : undefined));

  // ---------------------------------------------------------------- 섬 밑면 (바위가 거꾸로 매달린 모양)
  const holes = track.islands.flatMap((i) => i.holes);
  for (const [n, loop] of track.loops.entries()) {
    if (loop.length < 30) continue;
    let cx = 0, cz = 0;
    for (const p of loop) (cx += p.x), (cz += p.z);
    cx /= loop.length;
    cz /= loop.length;
    if (holes.some((h) => Math.hypot(h.x - cx, h.z - cz) < h.r + 8)) continue; // 싱크홀 둘레는 밑면 없음
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of loop) (minX = Math.min(minX, p.x)), (maxX = Math.max(maxX, p.x)), (minZ = Math.min(minZ, p.z)), (maxZ = Math.max(maxZ, p.z));
    const size = Math.max(maxX - minX, maxZ - minZ);
    // 밑면 윗가장자리 높이 = 가장 가까운 섬 가장자리 점 높이 - 4.5
    // (예전엔 다시 나눈 점이 정확히 안 맞으면 섬 평균 높이를 써서, 다리로 내려가는 도로 위로 초록 띠가 튀어나왔음)
    const topY = (x, z) => {
      let bd = Infinity, by = 0;
      for (const p of loop) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bd) (bd = d), (by = p.y);
      }
      return by - 4.5;
    };
    const under = islandUnderside(loop.map((p) => [p.x, p.z]), { topY, depth: THREE.MathUtils.clamp(size * 0.22, 45, 120), seed: 11 + n });
    group.add(under);
  }

  // ---------------------------------------------------------------- 식물 (인스턴스)
  const flora = createFlora();
  function plant(type, x, z, s = 1, edge = 2) {
    const y = landY(x, z, edge);
    if (y === null) return false;
    flora.add(type, x, y, z, s, R(0, Math.PI * 2));
    return true;
  }

  // ---------------------------------------------------------------- 다리 구조물
  const pierMat = new THREE.MeshLambertMaterial({ color: '#e7e2d8', flatShading: true });
  const pierDark = new THREE.MeshLambertMaterial({ color: '#c9c0b0', flatShading: true });
  const woodMat = new THREE.MeshLambertMaterial({ color: '#8a5c34', flatShading: true });
  const steelMat = new THREE.MeshLambertMaterial({ color: '#c0453a', flatShading: true });
  const pillars = [], caps = [], legs = [], braces = [];
  /** 이 지점 아래로 기둥을 세워도 다른 도로를 막지 않는지 */
  function otherRoadNear(x, z, t, r) {
    for (let i = 0; i < track.samples.length - 1; i += 2) {
      const s = track.samples[i];
      let dt = Math.abs(s.t - t);
      dt = Math.min(dt, 1 - dt);
      if (dt < 0.03) continue;
      if ((s.pos.x - x) ** 2 + (s.pos.z - z) ** 2 < r * r) return true;
    }
    return false;
  }
  const bottomAt = (x, z, fallback = -95) => {
    const g = track.heightAt(x, z);
    return g === null ? fallback : g - 1;
  };
  for (const br of track.bridgeRuns) {
    const list = track.spanList(br.a, br.b);
    const len = list[list.length - 1].dist - list[0].dist;
    const stepOf = (m) => Math.max(1, Math.round((m / track.length) * (track.samples.length - 1)));
    if (br.kind === 'viaduct' || br.kind === 'cable') {
      // 가운데 교각 (고가도로는 34m마다, 사장교는 주탑 사이 2곳만 + 양 끝)
      const step = stepOf(br.kind === 'viaduct' ? 34 : 60);
      for (let k = step; k < list.length - step / 2; k += step) {
        const s = list[k];
        if (br.kind === 'cable') continue;
        const top = s.pos.y - 2.4;
        if (otherRoadNear(s.pos.x, s.pos.z, s.t, HW + CURB + 6)) continue;
        const bot = bottomAt(s.pos.x, s.pos.z);
        const h = top - bot;
        pillars.push({ x: s.pos.x, y: bot + h / 2, z: s.pos.z, sx: 1, sy: h, sz: 1, ry: Math.atan2(s.tan.x, s.tan.z) });
        caps.push({ x: s.pos.x, y: top - 0.9, z: s.pos.z, s: 1, ry: Math.atan2(s.tan.x, s.tan.z) });
        circle(s.pos.x, s.pos.z, 3, bot, top);
      }
    }
    if (br.kind === 'cable') {
      // 사장교: 주탑 2개 (1/4, 3/4 지점) + 부채꼴 케이블
      const cables = [];
      for (const u of [0.27, 0.73]) {
        const k = Math.round(u * (list.length - 1));
        const s = list[k];
        const H = 46;
        const py = A.bridgePylon({ height: H });
        const yaw = Math.atan2(s.tan.x, s.tan.z);
        py.obj.scale.set((DECK + 2) / 11, 1, 1);
        add(py.obj, s.pos.x, s.pos.y - 1.6, s.pos.z, yaw);
        anim(py);
        // 주탑 아래 교각 (구름까지)
        for (const side of [-1, 1]) {
          const lp = track.surf(s, side * (DECK + 2), 0, new THREE.Vector3());
          const bot = -110, top = s.pos.y - 1.6;
          pillars.push({ x: lp.x, y: (top + bot) / 2, z: lp.z, sx: 1.1, sy: top - bot, sz: 1.1, ry: yaw });
          circle(lp.x, lp.z, 1.6, bot, top + H);
        }
        // 케이블: 주탑 머리의 정착점(아래→위 6개씩)에서 앞뒤 상판 가장자리로 부채꼴
        py.obj.updateMatrixWorld(true);
        for (const side of [-1, 1]) {
          const anc = py.anchors.filter((v) => Math.sign(v.x) === side).sort((u, v) => u.y - v.y);
          anc.forEach((v, j) => {
            const w = py.obj.localToWorld(v.clone());
            for (const dir of [-1, 1]) {
              const kk = THREE.MathUtils.clamp(k + dir * stepOf(9 + j * 7.5), 0, list.length - 1);
              const d = track.surf(list[kk], -side * (DECK - 0.3), 0.9, new THREE.Vector3()); // 주탑 로컬 +x = 도로 왼쪽
              cables.push(w.x, w.y, w.z, d.x, d.y, d.z);
            }
          });
        }
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
      group.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: '#f4f6fa' })));
      // 다리 입구·출구 교각
      for (const k of [2, list.length - 3]) {
        const s = list[k];
        const top = s.pos.y - 1.6, bot = bottomAt(s.pos.x, s.pos.z, -60);
        pillars.push({ x: s.pos.x, y: (top + bot) / 2, z: s.pos.z, sx: 1, sy: top - bot, sz: 1, ry: Math.atan2(s.tan.x, s.tan.z) });
      }
    }
    if (br.kind === 'trestle') {
      // 협곡 철교: 12m마다 양쪽 다리 + 가로대
      const step = stepOf(12);
      for (let k = 0; k < list.length; k += step) {
        const s = list[k];
        const yaw = Math.atan2(s.tan.x, s.tan.z);
        const top = s.pos.y - 1.2;
        const bot = -70;
        for (const side of [-1, 1]) {
          const lp = track.surf(s, side * (DECK - 1), 0, new THREE.Vector3());
          const g = track.heightAt(lp.x, lp.z);
          const b = g === null ? bot : g - 0.5;
          if (top - b < 1) continue;
          legs.push({ x: lp.x, y: (top + b) / 2, z: lp.z, sx: 1, sy: top - b, sz: 1, ry: yaw });
        }
        for (let y = top - 6; y > bot + 4; y -= 8) {
          const c = track.surf(s, 0, 0, new THREE.Vector3());
          if (track.heightAt(c.x, c.z) !== null && track.heightAt(c.x, c.z) > y) continue;
          braces.push({ x: c.x, y, z: c.z, sx: (DECK - 1) * 2, sy: 1, sz: 1, ry: yaw });
        }
      }
    }
    void len;
  }
  const inst = (geo, mat, list, shadow = true) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((it, i) => {
      q.setFromEuler(e.set(it.rx || 0, it.ry || 0, it.rz || 0));
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.s));
      im.setMatrixAt(i, m4);
      if (it.color) im.setColorAt(i, new THREE.Color(it.color));
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    group.add(im);
    return im;
  };
  inst(new THREE.CylinderGeometry(2.2, 2.6, 1, 10), pierMat, pillars);
  inst(new THREE.BoxGeometry(9, 1.8, 4), pierDark, caps);
  inst(new THREE.BoxGeometry(0.7, 1, 0.7), steelMat, legs);
  inst(new THREE.BoxGeometry(1, 0.45, 0.45), woodMat, braces);

  // ---------------------------------------------------------------- 하버 섬: 출발 게이트, 관중석, 피트
  {
    const s0 = track.sampleAt(0);
    const g = A.startGantry({ width: W + 2 * CURB });
    add(g.obj, s0.pos.x, s0.pos.y, s0.pos.z, Math.atan2(s0.tan.x, s0.tan.z));
    anim(g);
    if (g.setLights) {
      // 레이스 시작 전 신호등: 빨간불 하나씩 → 초록
      animators.push((t, dt, car) => {
        const race = window.game && window.game.race;
        if (!race) return;
        if (race.phase === 'countdown') {
          g.setLights(race.lights ?? Math.max(0, Math.min(5, Math.floor((3.5 - race.countdown) / 0.7) + 1)));
          g.setGreen && g.setGreen(false);
        } else {
          g.setLights(0);
          g.setGreen && g.setGreen(race.phase === 'racing' && race.time < 4);
        }
      });
    }
    for (const side of [-1, 1]) {
      const p = track.surf(s0, side * (HW + CURB + 1.5), 0, new THREE.Vector3());
      circle(p.x, p.z, 1.2, p.y - 1, p.y + 12);
    }
  }
  const stands = [];
  function placeStand(t, side, length, roofColor) {
    const s = track.sampleAt(t);
    // 곧은 관중석이 굽은 도로 안쪽에 놓이면 양 끝이 도로에 붙음 → 앞면 양 끝이 도로에서 충분히 떨어질 때까지 바깥으로
    const front = HW + CURB + 5.5, need = HW + CURB + 4.5;
    let push = 0;
    for (let k = 0; k < 12; k++) {
      const q = track.surf(s, side * (front + push), 0, new THREE.Vector3());
      let gap = Infinity;
      for (const u of [-length / 2, -length / 4, length / 4, length / 2]) {
        tmpV.set(q.x + s.tan.x * u, q.y, q.z + s.tan.z * u);
        gap = Math.min(gap, track.nearestRaw(tmpV));
      }
      if (gap >= need) break;
      push += need - gap + 0.5;
    }
    const lat = side * (front + push);
    const p = track.surf(s, lat, 0, new THREE.Vector3());
    const y = landY(p.x, p.z, 1) ?? p.y;
    const st = A.grandstand({ length, roofColor });
    const yaw = Math.atan2(s.tan.x, s.tan.z) + (side > 0 ? Math.PI : 0);
    add(st.obj, p.x, Math.min(p.y, y) - 0.05, p.z, yaw);
    const hd = st.halfDepth || 7;
    const c = track.surf(s, side * (front + push + hd), 0, new THREE.Vector3());
    // 관중석 충돌: 길이 방향으로 원 여러 개
    for (let u = -length / 2; u <= length / 2; u += hd * 1.4) {
      circle(c.x + s.tan.x * u, c.z + s.tan.z * u, hd + 0.5, p.y - 2, p.y + (st.height || 14));
    }
    occupy(c.x, c.z, length / 2 + 4);
    stands.push({ st, c: c.clone() });
  }
  for (const [t, side, len, col] of places.stands || [[0.985, -1, 64, '#e8463a'], [0.012, -1, 64, '#2e6fd8'], [0.9671, 1, 48, '#ffcf3f']]) placeStand(t, side, len, col);
  animators.push((time, dt, car) => {
    for (const { st, c } of stands) {
      const d = car ? car.pos.distanceTo(c) : 999;
      st.excite = THREE.MathUtils.lerp(st.excite || 0, d < 90 ? 1 : 0.08, 1 - Math.exp(-4 * dt));
      if (st.update) st.update(time, dt, st.excite);
    }
  });
  // 피트 건물 (출발 직선 오른쪽 = 남쪽)
  {
    const s = track.sampleAt(places.pit ?? 0.036);
    const side = 1;
    const p = track.surf(s, side * (HW + CURB + 6), 0, new THREE.Vector3());
    const pb = A.pitBuilding({ length: 72 });
    add(pb.obj, p.x, p.y - 0.05, p.z, Math.atan2(s.tan.x, s.tan.z) + Math.PI);
    anim(pb);
    const c = track.surf(s, side * (HW + CURB + 14), 0, new THREE.Vector3());
    for (let u = -36; u <= 36; u += 9) circle(c.x + s.tan.x * u, c.z + s.tan.z * u, 9, p.y - 2, p.y + 16);
    occupy(c.x, c.z, 44);
    // 관제탑 (피트 뒤)
    const tp = track.surf(s, side * (HW + CURB + 40), 0, new THREE.Vector3()).addScaledVector(s.tan, 44);
    const ty = landY(tp.x, tp.z, 6);
    if (ty !== null) {
      const ct = A.controlTower();
      add(ct.obj, tp.x, ty, tp.z, Math.atan2(s.tan.x, s.tan.z) + Math.PI);
      anim(ct);
      circle(tp.x, tp.z, 5.6, ty, ty + 34);
      occupy(tp.x, tp.z, 9);
    }
  }
  // 출발 직선 깃발, 가로등, 깃발 줄
  const [fm0, fm1] = places.flagsM || [-164, 164];
  for (let m = fm0; m < fm1; m += 13.4) {
    const tt = tAtM(m);
    const t = m / 13.4;
    for (const side of [-1, 1]) {
      const { p, s } = beside(tt, side * (HW + CURB + 2.2));
      const y = landY(p.x, p.z, 1);
      if (y === null || !free(p.x, p.z, 0.6)) continue;
      const k = Math.round(t) + 1000;
      if (k % 3 === 0) {
        const lp = A.lampPost();
        add(lp.obj, p.x, y, p.z, Math.atan2(s.tan.x, s.tan.z) + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
        circle(p.x, p.z, 0.4, y, y + 6);
      } else if (k % 3 === 1) {
        const fp = A.flagPole({ color: pick(['#e8463a', '#2e6fd8', '#ffcf3f', '#19b3a6', '#7a3cff']) });
        add(fp.obj, p.x, y, p.z, R(0, 6));
        anim(fp);
        circle(p.x, p.z, 0.35, y, y + 10);
      }
    }
  }

  // 아치 배너 (도로 위)
  // 다리(기둥)는 넓힌 코너 연석(2.8 m) 바깥 + 여유 → 레이싱 라인으로 연석을 타도 기둥에 안 걸림
  function arch(t, text, color, width) {
    const s = track.sampleAt(t);
    width ??= s.bridge ? W + 2 * CURB + 2 : W + 2 * CURB + 8; // 다리 위는 상판 폭에 맞춤
    const a = A.archBanner({ width, text, color });
    add(a.obj, s.pos.x, s.pos.y, s.pos.z, Math.atan2(s.tan.x, s.tan.z));
    anim(a);
    for (const side of [-1, 1]) {
      const p = track.surf(s, side * (width / 2 + 1.5), 0, new THREE.Vector3());
      circle(p.x, p.z, 1.1, p.y - 1, p.y + 10);
    }
  }
  for (const [t, text, color] of places.arches || [[0.0903, 'SKY BRIDGE', '#19b3a6'], [0.4505, 'PEAK RIDGE', '#7a3cff'], [0.8794, 'FINAL SECTOR', '#e8463a']]) arch(t, text, color);

  // ---------------------------------------------------------------- 안내판
  function sign(t, l, title, sub, bg, accent = '#ffd21f', width = 12) {
    const { p, s } = beside(t, l);
    const y = landY(p.x, p.z, 0.5);
    if (y === null) return;
    const b = A.signBoard({ title, sub, bg, accent, width });
    // 다가오는 차를 바라보게
    add(b.obj, p.x, y, p.z, Math.atan2(-s.tan.x, -s.tan.z));
    for (const u of [-width * 0.35, width * 0.35]) circle(p.x + s.right.x * u, p.z + s.right.z * u, 0.5, y, y + 8);
    occupy(p.x, p.z, width / 2);
  }
  for (const a of places.signs || []) sign(...a);
  // 코너 화살표판 (급커브 바깥쪽)
  {
    const N = track.samples.length - 1;
    const head = track.samples.map((s) => Math.atan2(s.tan.x, s.tan.z));
    const ds = track.length / N;
    let lastI = -999;
    for (let i = 0; i < N; i += 3) {
      let d = head[(i + 8) % N] - head[(i - 8 + N) % N];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const Rr = Math.abs((16 * ds) / (d || 1e-6));
      if (Rr > 42 || i - lastI < 14) continue;
      const s = track.samples[i];
      if (s.space) continue; // 우주 구간은 gpSpace.js 가 꾸밈
      const outSide = d > 0 ? 1 : -1; // 왼쪽으로 굽으면 바깥은 오른쪽
      const lat = outSide * (s.bridge ? DECK + 1.5 : HW + CURB + 3.2);
      const p = track.surf(s, lat, 0, new THREE.Vector3());
      const y = s.bridge ? p.y : landY(p.x, p.z, 0.5);
      if (y === null) continue;
      const cb = A.chevronBoard({ dir: -outSide });
      add(cb.obj, p.x, y, p.z, Math.atan2(-s.tan.x, -s.tan.z));
      circle(p.x, p.z, 0.4, y, y + 3);
      lastI = i;
    }
  }

  // ---------------------------------------------------------------- 타이어 벽 (가드레일이 없는 급커브 바깥쪽)
  {
    const tw = A.tireWallGeometry();
    const stacks = [];
    const N = track.samples.length - 1;
    const head = track.samples.map((s) => Math.atan2(s.tan.x, s.tan.z));
    const ds = track.length / N;
    const wallPts = [];
    for (let i = 0; i < N; i++) {
      let d = head[(i + 8) % N] - head[(i - 8 + N) % N];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const Rr = Math.abs((16 * ds) / (d || 1e-6));
      const s = track.samples[i];
      if (Rr > 70 || s.bridge) continue;
      const outSide = d > 0 ? 1 : -1;
      if (track.railSide[outSide > 0 ? 1 : 0][i]) continue;
      if (track.onAltPath(track.surf(s, outSide * (HW + CURB + 4.5), 0, tmpV), 3)) continue;
      wallPts.push({ i, side: outSide });
    }
    // 이어지는 조각마다 타이어 더미 + 보이지 않는 벽
    const runs = [];
    for (const w of wallPts) {
      const r = runs[runs.length - 1];
      if (r && r.side === w.side && w.i - r.b <= 2) r.b = w.i;
      else runs.push({ a: w.i, b: w.i, side: w.side });
    }
    const wallMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const r of runs) {
      if (r.b - r.a < 6) continue;
      const lat = r.side * (HW + CURB + 4.2);
      const list = track.spanList(r.a, r.b);
      const pos = [], idx = [];
      list.forEach((s, k) => {
        const p = track.surf(s, lat, 0, new THREE.Vector3());
        pos.push(p.x, p.y - 0.5, p.z, p.x, p.y + 1.4, p.z);
        if (k) idx.push((k - 1) * 2, (k - 1) * 2 + 1, k * 2, (k - 1) * 2 + 1, k * 2 + 1, k * 2);
        if (k % 1 === 0) {
          const y = landY(p.x, p.z, 0.2) ?? p.y;
          stacks.push({ x: p.x, y: Math.min(y, p.y), z: p.z, s: 1, ry: R(0, 6), color: k % 2 ? '#e8463a' : '#f4f4f4' });
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, wallMat);
      m.visible = false;
      m.userData.surface = 'barrier';
      group.add(m);
      m.updateMatrixWorld();
      track.groundMeshes.push(m);
    }
    if (stacks.length) {
      const im = new THREE.InstancedMesh(tw.geo, tw.mat, stacks.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      stacks.forEach((it, i) => {
        q.setFromAxisAngle(UP, it.ry);
        m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(1, 1, 1));
        im.setMatrixAt(i, m4);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      group.add(im);
    }
  }

  // ---------------------------------------------------------------- 섬 가장자리 찾기 (폭포, 계류탑 자리)
  /** 섬 가장자리 점 (안쪽에서 바깥을 향하는 방향 포함) */
  function coastSpots(filter, n, minGap = 40) {
    const out = [];
    for (const loop of track.loops) {
      if (loop.length < 30) continue;
      for (let tries = 0; tries < loop.length; tries++) {
        const k = Math.floor(rand() * loop.length);
        const p = loop[k], q = loop[(k + 3) % loop.length], o = loop[(k - 3 + loop.length) % loop.length];
        // 바깥 방향: 가장자리 접선에 수직, 섬 밖(field 감소)을 향하게
        let nx = -(q.z - o.z), nz = q.x - o.x;
        const l = Math.hypot(nx, nz) || 1;
        nx /= l;
        nz /= l;
        if (track.fieldAt(p.x + nx * 4, p.z + nz * 4) > track.fieldAt(p.x - nx * 4, p.z - nz * 4)) (nx = -nx), (nz = -nz);
        const c = { x: p.x, y: p.y, z: p.z, nx, nz };
        if (!filter(c) || out.some((o2) => Math.hypot(o2.x - c.x, o2.z - c.z) < minGap)) continue;
        out.push(c);
        if (out.length >= n) return out;
      }
    }
    return out;
  }
  const nearT = (c) => track.nearest(tmpV.set(c.x, c.y, c.z));

  // 계류탑 + 비행선 (하버 섬 가장자리, 도로에서 떨어진 곳)
  {
    const spots = coastSpots((c) => {
      const n = nearT(c);
      return inZone(n.t, zones[0]) && n.dist > 34 && roadClear(c.x - c.nx * 8, c.z - c.nz * 8, 5, 10);
    }, 2, 160);
    spots.forEach((c, k) => {
      const mx = c.x - c.nx * 7, mz = c.z - c.nz * 7;
      const y = landY(mx, mz, 1) ?? c.y;
      const mast = A.dockingMast();
      add(mast.obj, mx, y, mz, Math.atan2(-c.nx, -c.nz)); // 비행선 자리(-z)가 섬 밖
      anim(mast);
      circle(mx, mz, 3, y, y + 32);
      occupy(mx, mz, 10);
      const ship = A.airship({ color: k ? '#2e6fd8' : '#e8463a', text: k ? 'ZIP COLA' : 'SKY HARBOR' });
      const tie = (mast.tieY || 30) + y;
      // 비행선 코가 탑 꼭대기에 묶이고 몸통은 섬 밖으로
      const sg = new THREE.Group();
      sg.position.set(mx, tie, mz);
      sg.rotation.y = Math.atan2(-c.nx, -c.nz); // +z(코)가 탑을 향하도록
      ship.obj.position.set(0, -1, -23.5);
      sg.add(ship.obj);
      group.add(sg);
      animators.push((t, dt) => {
        ship.update && ship.update(t, dt);
        sg.rotation.y = Math.atan2(-c.nx, -c.nz) + Math.sin(t * 0.13 + k) * 0.12;
      });
    });
  }
  // 하늘을 도는 비행선 2대
  for (let k = 0; k < 4; k++) {
    const ship = A.airship({ color: ['#19b3a6', '#ffcf3f', '#7a3cff', '#e8463a'][k], text: ['SKY HARBOR GP', 'TURBO NOODLE', 'STAR GATE', 'ORCHARD JUICE'][k] });
    group.add(ship.obj);
    const cx = [230, -150, 1050, 900][k], cz = [60, 80, -560, -40][k], rx = [380, 330, 300, 360][k], rz = [300, 260, 420, 230][k], h = [70, 95, 110, 85][k], sp = [0.014, -0.018, 0.012, -0.015][k];
    animators.push((t, dt) => {
      const a = t * sp + k * 2;
      ship.obj.position.set(cx + Math.cos(a) * rx, h + Math.sin(t * 0.3 + k) * 3, cz + Math.sin(a) * rz);
      ship.obj.rotation.y = Math.atan2(-Math.sin(a) * rx * Math.sign(sp), Math.cos(a) * rz * Math.sign(sp));
      ship.update && ship.update(t, dt);
    });
  }

  // 항구 크레인과 화물 상자 (1번 코너 바깥, 하버 섬 동쪽 끝)
  {
    const crates = [];
    for (let i = 0; i < 3; i++) {
      const c = coastSpots((c) => {
        const n = nearT(c);
        const [c0, c1] = places.crane || [0.03, 0.09];
        return n.t > c0 && n.t < c1 && n.dist > 28 && roadClear(c.x - c.nx * 10, c.z - c.nz * 10, 7, 6);
      }, 1, 50)[0];
      if (!c) break;
      const cx = c.x - c.nx * 9, cz = c.z - c.nz * 9;
      const y = landY(cx, cz, 1);
      if (y === null || !free(cx, cz, 8)) continue;
      const cr = A.crane({ height: R(24, 32) });
      add(cr.obj, cx, y, cz, Math.atan2(c.nx, c.nz));
      anim(cr);
      circle(cx, cz, 8, y, y + 34);
      occupy(cx, cz, 9);
      for (let j = 0; j < 7; j++) {
        const ox = cx - c.nx * R(10, 20) + R(-10, 10), oz = cz - c.nz * R(10, 20) + R(-10, 10);
        const oy = landY(ox, oz, 3);
        if (oy === null || !roadClear(ox, oz, 2, 5) || !free(ox, oz, 2.2)) continue;
        const stack = 1 + Math.floor(R(0, 3));
        for (let s = 0; s < stack; s++) crates.push({ x: ox, y: oy + 1.3 + s * 2.6, z: oz, s: 1, sx: 6, sy: 2.6, sz: 2.6, ry: Math.atan2(c.nx, c.nz) + R(-0.1, 0.1), color: pick(['#e8463a', '#2e6fd8', '#ffcf3f', '#19b3a6', '#ff8a1f']) });
        circle(ox, oz, 2.6, oy, oy + stack * 2.6);
        occupy(ox, oz, 3.5);
      }
    }
    inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), crates);
  }

  // ---------------------------------------------------------------- 풍차 섬
  for (let i = 0; i < 6; i++) {
    const p = spot('windmill', 30, 90, 5, { margin: 8, edge: 8 });
    if (!p) continue;
    const wm = A.windmill({ color: pick(['#e8463a', '#2e6fd8', '#ff8a1f', '#19b3a6']) });
    add(wm.obj, p.x, p.y - 0.2, p.z, p.yaw + R(-0.4, 0.4));
    anim(wm);
    circle(p.x, p.z, 3.8, p.y, p.y + 20);
    occupy(p.x, p.z, 9);
  }
  for (let i = 0; i < 10; i++) {
    const p = spot('windmill', 24, 75, 4, { margin: 6, edge: 6 });
    if (!p) continue;
    const c = A.cottage({ wall: pick(['#fff3d6', '#ffe0e0', '#e0f0ff', '#e8ffe0']), roof: pick(['#e8463a', '#2e6fd8', '#7a3cff', '#ff8a1f']) });
    add(c.obj, p.x, p.y - 0.2, p.z, p.yaw + pick([0, Math.PI / 2, -Math.PI / 2]));
    circle(p.x, p.z, 4.2, p.y, p.y + 9);
    occupy(p.x, p.z, 6);
  }
  // 꽃밭 줄무늬 (같은 색 꽃이 줄지어)
  for (let i = 0; i < 7; i++) {
    const p = spot('windmill', 28, 80, 12, { margin: 4, edge: 8 });
    if (!p) continue;
    occupy(p.x, p.z, 12);
    const yaw = R(0, Math.PI);
    const ux = Math.cos(yaw), uz = Math.sin(yaw);
    for (let row = -3; row <= 3; row++)
      for (let k = -5; k <= 5; k++) {
        const x = p.x + ux * k * 2 - uz * row * 2.6, z = p.z + uz * k * 2 + ux * row * 2.6;
        plant('flowers', x, z, R(0.9, 1.2), 3);
      }
  }
  for (let i = 0; i < 70; i++) {
    const p = spot('windmill', 16, 110, 2, { margin: 3, edge: 4 });
    if (p) plant(rand() < 0.4 ? 'blossom' : 'round', p.x, p.z, R(0.8, 1.2)) && occupy(p.x, p.z, 2.5) && circle(p.x, p.z, 0.7, p.y, p.y + 9);
  }
  for (let i = 0; i < 120; i++) {
    const p = spot('windmill', 14, 110, 1, { margin: 1.5, edge: 2 });
    if (p) plant(rand() < 0.5 ? 'bush' : 'flowers', p.x, p.z, R(0.8, 1.4));
  }

  // ---------------------------------------------------------------- 봉우리 섬: 소나무 숲, 바위, 등대
  for (let i = 0; i < 260; i++) {
    const p = spot('peak', 15, 140, 1.8, { margin: 2, edge: 4 });
    if (!p) continue;
    if (p.y > 46) continue; // 눈 덮인 꼭대기는 비움
    const r = rand();
    if (r < 0.62) plant('pine', p.x, p.z, R(0.8, 1.5)) && circle(p.x, p.z, 0.7, p.y, p.y + 12);
    else if (r < 0.8) plant('rock', p.x, p.z, R(0.7, 1.8)) && circle(p.x, p.z, 1.2, p.y, p.y + 2);
    else plant('bush', p.x, p.z, R(0.8, 1.4));
    occupy(p.x, p.z, 1.8);
  }
  {
    // 등대: 북쪽 능선 시케인 바깥 낭떠러지 가장자리
    const c = coastSpots((c) => {
      const n = nearT(c);
      const [l0, l1] = places.lighthouse || [0.47, 0.53];
      return n.t > l0 && n.t < l1 && n.dist > 22 && n.dist < 60;
    }, 1)[0];
    if (c) {
      const lx = c.x - c.nx * 6, lz = c.z - c.nz * 6;
      const y = landY(lx, lz, 1) ?? c.y;
      const lh = A.lighthouse();
      add(lh.obj, lx, y, lz, 0);
      anim(lh);
      circle(lx, lz, 6, y, y + 27);
      occupy(lx, lz, 6);
    }
  }

  // ---------------------------------------------------------------- 폭포 (풍차 섬, 봉우리 섬, 수정 섬)
  {
    const want = [['windmill', 3], ['peak', 3], ['canyon', 2], ['harbor', 1], ['crystalfalls', 4], ['orchard', 2], ['lake', 2], ['stargate', 1]];
    for (const [theme, n] of want) {
      const spots = coastSpots((c) => {
        const nn = nearT(c);
        const z = zones.find((zz) => inZone(nn.t, zz));
        return z && z.theme === theme && nn.dist > 26 && free(c.x, c.z, 8) && roadClear(c.x, c.z, 4, 8);
      }, n, 70);
      for (const c of spots) {
        const wf = waterfall({ width: R(8, 13), height: R(55, 85), seed: Math.floor(R(1, 999)) });
        add(wf.obj, c.x, c.y - 0.3, c.z, Math.atan2(c.nx, c.nz));
        anim(wf);
        occupy(c.x, c.z, 8);
        // 위쪽 작은 연못
        const pond = new THREE.Mesh(new THREE.CircleGeometry(4.5, 18), new THREE.MeshStandardMaterial({ color: '#4aa8e8', roughness: 0.15, metalness: 0.1 }));
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(c.x - c.nx * 4.5, c.y + 0.06, c.z - c.nz * 4.5);
        group.add(pond);
      }
    }
  }

  // ---------------------------------------------------------------- 하늘 협곡: 활주로 유도등, 아치, 수정 섬
  if (track.runway) {
    const L = track.runway.samples;
    const lights = [];
    for (let k = 0; k < L.length; k += 4) {
      for (const side of [-1, 1]) {
        const s = L[k];
        lights.push({ x: s.pos.x + s.right.x * side * (track.runway.half + 0.4), y: s.pos.y + 0.25, z: s.pos.z + s.right.z * side * (track.runway.half + 0.4), k });
      }
    }
    const lightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), lightMat, lights.length);
    const m4 = new THREE.Matrix4();
    const cOn = new THREE.Color('#7fe7ff'), cOff = new THREE.Color('#1d4d6b');
    lights.forEach((l, i) => {
      im.setMatrixAt(i, m4.makeTranslation(l.x, l.y, l.z));
      im.setColorAt(i, cOff);
    });
    group.add(im);
    // 끝(이륙대) 쪽으로 달려가는 불빛
    animators.push((t) => {
      const head = (t * 26) % (L.length + 20);
      lights.forEach((l, i) => im.setColorAt(i, Math.abs(l.k - head) < 5 ? cOn : cOff));
      im.instanceColor.needsUpdate = true;
    });
    // SKY ROUTE 아치: 활주로가 갈라지는 입구에서 본 도로와 활주로를 한꺼번에 덮음 (2026-11-09)
    //   예전엔 활주로 끝쪽에 서 있어서, 도로와 활주로 사이가 3~5 m뿐인 곳의 기둥에 비스듬히 들어가는 차가 박았음
    //   → 기둥은 양쪽 모두 넓은 연석(2.8 m) 바깥 5 m에 서게 (도로·활주로 어느 쪽으로 가도 걸리지 않음)
    const rwT = track.runway.start.t ?? 0;
    const mid = track.sampleAt((rwT + 12 / track.length) % 1);
    const legLat = HW + 2.8 + 5;
    const archW = 2 * legLat - 3;
    const legAt = (m, side) => m.pos.clone().addScaledVector(m.right, side * legLat);
    const a = A.archBanner({ width: archW, text: '✈ SKY ROUTE', color: '#0f6fb8' });
    add(a.obj, mid.pos.x, mid.pos.y, mid.pos.z, Math.atan2((mid.tan3 || mid.tan).x, (mid.tan3 || mid.tan).z));
    anim(a);
    for (const side of [-1, 1]) {
      const lp = legAt(mid, side);
      circle(lp.x, lp.z, 1.5, mid.pos.y - 1, mid.pos.y + 10);
    }
  }
  if (track.apron) {
    // 착륙장 바깥 가장자리 노란 깃발 (착륙 구역 밖)
    const ap = track.apron;
    for (let j = 6; j < ap.samples.length - 6; j += 7) {
      const q = ap.samples[j];
      if (q.w < 6) continue;
      const x = q.pos.x + q.right.x * ap.side * (q.w / 2 + 4.5), z = q.pos.z + q.right.z * ap.side * (q.w / 2 + 4.5);
      const y = landY(x, z, 0.5);
      if (y === null || !free(x, z, 0.6)) continue;
      const fp = A.flagPole({ color: '#ffcf3f' });
      add(fp.obj, x, y, z, R(0, 6));
      anim(fp); // 착륙하는 차가 걸리지 않게 충돌체 없음
    }
  }
  // 수정 섬 (헤어핀): 빛나는 수정과 큰 버섯
  for (let i = 0; i < 90; i++) {
    const p = spot('canyon', 13, 45, 1.8, { margin: 1.5, edge: 2 });
    if (!p) continue;
    const r = rand();
    if (r < 0.45) plant('crystal', p.x, p.z, R(0.8, 2.2)) && circle(p.x, p.z, 1, p.y, p.y + 4);
    else if (r < 0.7) plant('mushroom', p.x, p.z, R(0.7, 1.6)) && circle(p.x, p.z, 0.8, p.y, p.y + 5);
    else plant(rand() < 0.5 ? 'bush' : 'rock', p.x, p.z, R(0.7, 1.4));
    occupy(p.x, p.z, 1.8);
  }

  // ---------------------------------------------------------------- 과수원 섬: 줄지어 선 과일나무, 풍차, 집, 꽃밭
  for (let i = 0; i < per('orchard', 9, 740); i++) {
    const p = spot('orchard', 26, 95, 13, { margin: 5, edge: 9 });
    if (!p) continue;
    occupy(p.x, p.z, 13);
    const yaw = p.yaw + R(-0.2, 0.2);
    const ux = Math.cos(yaw), uz = Math.sin(yaw);
    const kind = rand() < 0.5 ? 'blossom' : 'round';
    for (let row = -2; row <= 2; row++)
      for (let k = -2; k <= 2; k++) {
        const x = p.x + ux * k * 5.2 - uz * row * 5.2, z = p.z + uz * k * 5.2 + ux * row * 5.2;
        if (!roadClear(x, z, 1, 3) || !treeOk(x, z)) continue;
        if (plant(kind, x, z, R(0.75, 0.95), 3)) circle(x, z, 0.6, (landY(x, z, 3) ?? 0), (landY(x, z, 3) ?? 0) + 7);
      }
  }
  for (let i = 0; i < per('orchard', 3, 740); i++) {
    const p = spot('orchard', 30, 90, 5, { margin: 8, edge: 8 });
    if (!p) continue;
    const wm = A.windmill({ color: pick(['#e8463a', '#ff8a1f', '#7a3cff']) });
    add(wm.obj, p.x, p.y - 0.2, p.z, p.yaw + R(-0.4, 0.4));
    anim(wm);
    circle(p.x, p.z, 3.8, p.y, p.y + 20);
    occupy(p.x, p.z, 9);
  }
  for (let i = 0; i < per('orchard', 7, 740); i++) {
    const p = spot('orchard', 24, 75, 4, { margin: 6, edge: 6 });
    if (!p) continue;
    const c = A.cottage({ wall: pick(['#fff3d6', '#ffe0e0', '#fff0c8']), roof: pick(['#e8463a', '#ff8a1f', '#2f8a3a']) });
    add(c.obj, p.x, p.y - 0.2, p.z, p.yaw + pick([0, Math.PI / 2, -Math.PI / 2]));
    circle(p.x, p.z, 4.2, p.y, p.y + 9);
    occupy(p.x, p.z, 6);
  }
  for (let i = 0; i < per('orchard', 5, 740); i++) {
    const p = spot('orchard', 22, 80, 10, { margin: 4, edge: 7 });
    if (!p) continue;
    occupy(p.x, p.z, 10);
    const yaw = R(0, Math.PI), ux = Math.cos(yaw), uz = Math.sin(yaw);
    for (let row = -2; row <= 2; row++)
      for (let k = -4; k <= 4; k++) plant('flowers', p.x + ux * k * 2 - uz * row * 2.6, p.z + uz * k * 2 + ux * row * 2.6, R(0.9, 1.2), 3);
  }
  for (let i = 0; i < per('orchard', 140, 740); i++) {
    const p = spot('orchard', 14, 110, 1, { margin: 1.5, edge: 2 });
    if (p) plant(rand() < 0.6 ? 'bush' : 'flowers', p.x, p.z, R(0.8, 1.4));
  }

  // ---------------------------------------------------------------- 스타게이트 섬: 로켓 발사대, 천문대, 전파 망원경, 안테나
  {
    const put = (make, x, z, r, h, edge = 3) => {
      const y = landY(x, z, edge);
      if (y === null || !roadClear(x, z, r, 3)) return null;
      const it = make();
      tmpV.set(x, y, z);
      const n = track.nearest(tmpV);
      add(it.obj, x, y - 0.1, z, Math.atan2(n.sample.pos.x - x, n.sample.pos.z - z));
      anim(it);
      circle(x, z, it.radius ?? r, y - 1, y + (it.height ?? h));
      occupy(x, z, (it.radius ?? r) + 3);
      return it;
    };
    if (places.rocket) put(rocketPad, places.rocket[0], places.rocket[1], 12, 36, 8);
    for (const [x, z] of places.observatories || []) put(observatory, x, z, 7.6, 15, 6);
    for (const [x, z] of places.radars || []) put(() => radarDish({ size: R(0.8, 1.1) }), x, z, 3, 18, 4);
    for (const [x, z] of places.antennas || []) put(() => antennaMast({ height: R(22, 30) }), x, z, 1, 30, 2);
    // 길가 가로등, 보라색 깃발
    for (let i = 0; i < per('stargate', 22, 340); i++) {
      const p = spot('stargate', HW + CURB + 3, HW + CURB + 5, 0.6, { margin: 1.5, edge: 1 });
      if (!p) continue;
      if (i % 2) {
        const lp = A.lampPost();
        add(lp.obj, p.x, p.y, p.z, p.yaw + Math.PI / 2);
        circle(p.x, p.z, 0.4, p.y, p.y + 6);
      } else {
        const fp = A.flagPole({ color: pick(['#7a3cff', '#38e8ff', '#ff4fd8']) });
        add(fp.obj, p.x, p.y, p.z, R(0, 6));
        anim(fp);
        circle(p.x, p.z, 0.35, p.y, p.y + 10);
      }
      occupy(p.x, p.z, 1);
    }
    // 발사 관제탑 (로켓 옆)
    if (places.rocket) put(A.controlTower, places.rocket[0] - 48, places.rocket[1] - 26, 6, 28, 6);
    // 연구원 숙소 (작은 집)
    for (let i = 0; i < per('stargate', 5, 340); i++) {
      const p = spot('stargate', 24, 110, 5, { margin: 4, edge: 6 });
      if (!p) continue;
      const c = A.cottage({ wall: pick(['#eef2ff', '#e6f7ff', '#f4ecff']), roof: pick(['#5b3cc4', '#2a7fd6', '#7a3cff']) });
      add(c.obj, p.x, p.y - 0.2, p.z, p.yaw + pick([0, Math.PI / 2, -Math.PI / 2]));
      circle(p.x, p.z, 4.2, p.y, p.y + 9);
      occupy(p.x, p.z, 6);
    }
    // 나무 숲 몇 덩어리 + 수정 꽃밭
    for (let i = 0; i < per('stargate', 9, 340); i++) {
      const c = spot('stargate', 30, 115, 8, { margin: 3, edge: 8 });
      if (!c) continue;
      for (let k = 0; k < 7; k++) {
        const x = c.x + R(-9, 9), z = c.z + R(-9, 9);
        if (!roadClear(x, z, 1.5, 3) || !treeOk(x, z)) continue;
        const y = landY(x, z, 3);
        if (y === null) continue;
        plant(rand() < 0.55 ? 'pine' : 'round', x, z, R(0.8, 1.3)) && circle(x, z, 0.7, y, y + 11);
      }
      occupy(c.x, c.z, 11);
    }
    for (let i = 0; i < per('stargate', 170, 340); i++) {
      const p = spot('stargate', 14, 120, 1.4, { margin: 2, edge: 3 });
      if (!p) continue;
      plant(pick(['bush', 'round', 'flowers', 'flowers', 'crystal', 'rock']), p.x, p.z, R(0.7, 1.3)) && occupy(p.x, p.z, 1.6);
    }
  }

  // ---------------------------------------------------------------- 수정 폭포 섬: 수정, 버섯, 소나무
  for (let i = 0; i < per('crystalfalls', 220, 920); i++) {
    const p = spot('crystalfalls', 13, 80, 1.8, { margin: 1.5, edge: 2 });
    if (!p) continue;
    const r = treeOk(p.x, p.z) ? rand() : 0.85;
    if (r < 0.3) plant('crystal', p.x, p.z, R(0.9, 2.6)) && circle(p.x, p.z, 1, p.y, p.y + 4);
    else if (r < 0.48) plant('mushroom', p.x, p.z, R(0.8, 1.8)) && circle(p.x, p.z, 0.8, p.y, p.y + 5);
    else if (r < 0.8) plant('pine', p.x, p.z, R(0.8, 1.5)) && circle(p.x, p.z, 0.7, p.y, p.y + 12);
    else plant(rand() < 0.5 ? 'bush' : 'rock', p.x, p.z, R(0.7, 1.6));
    occupy(p.x, p.z, 1.8);
  }

  // ---------------------------------------------------------------- 호수 마을 섬: 호수, 선착장, 배, 집, 풍차
  {
    const isl = track.islands.find((i) => i.name === 'lake');
    for (const h of isl ? isl.holes : []) {
      // 구멍 가장자리 땅 높이보다 조금 아래에 물을 채움
      let edgeY = Infinity;
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        for (let d = h.r + 2; d < h.r + 30; d += 2) {
          const y = landY(h.x + Math.cos(a) * d, h.z + Math.sin(a) * d, 0.5);
          if (y !== null) {
            edgeY = Math.min(edgeY, y);
            break;
          }
        }
      }
      if (edgeY === Infinity) continue;
      const wy = edgeY - 0.8;
      const water = new THREE.Mesh(new THREE.CircleGeometry(h.r + 14, 48), new THREE.MeshStandardMaterial({ color: '#3f9de0', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.92 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(h.x, wy, h.z);
      water.receiveShadow = true;
      group.add(water);
      const deep = new THREE.Mesh(new THREE.CylinderGeometry(h.r + 14, h.r * 0.6, 7, 32, 1, true), new THREE.MeshLambertMaterial({ color: '#2b6f9e', side: THREE.DoubleSide }));
      deep.position.set(h.x, wy - 3.5, h.z);
      group.add(deep);
      occupy(h.x, h.z, h.r + 6);
      animators.push((t) => (water.material.color.setHSL(0.57, 0.65, 0.55 + Math.sin(t * 0.6) * 0.02)));
      // 나무 선착장 2개와 작은 배
      const wood = new THREE.MeshLambertMaterial({ color: '#9a6b40', flatShading: true });
      for (let k = 0; k < 2; k++) {
        const a = R(0, Math.PI * 2);
        const ex = h.x + Math.cos(a) * (h.r + 6), ez = h.z + Math.sin(a) * (h.r + 6);
        const dock = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 14), wood);
        dock.position.set(ex - Math.cos(a) * 6, wy + 0.9, ez - Math.sin(a) * 6);
        dock.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
        dock.castShadow = true;
        group.add(dock);
        const boat = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 5.2), new THREE.MeshLambertMaterial({ color: pick(['#e8463a', '#ffcf3f', '#2e6fd8', '#ffffff']), flatShading: true }));
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 5), wood);
        mast.position.y = 2.4;
        const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.2), new THREE.MeshLambertMaterial({ color: '#fdfdf6', side: THREE.DoubleSide }));
        sail.position.set(0, 2.6, 0.9);
        sail.rotation.y = Math.PI / 2;
        boat.add(hull, mast, sail);
        const bx = h.x + Math.cos(a + 0.5) * h.r * 0.5, bz = h.z + Math.sin(a + 0.5) * h.r * 0.5;
        boat.position.set(bx, wy + 0.3, bz);
        group.add(boat);
        const ph = R(0, 6);
        animators.push((t) => {
          boat.position.y = wy + 0.3 + Math.sin(t * 1.3 + ph) * 0.12;
          boat.rotation.y = ph + Math.sin(t * 0.1 + ph) * 0.6;
          boat.rotation.z = Math.sin(t * 1.1 + ph) * 0.05;
        });
      }
    }
  }
  for (let i = 0; i < per('lake', 9, 650); i++) {
    const p = spot('lake', 22, 80, 4, { margin: 6, edge: 6 });
    if (!p) continue;
    const c = A.cottage({ wall: pick(['#fff3d6', '#e0f0ff', '#e8ffe0', '#ffe0e0']), roof: pick(['#2e6fd8', '#19b3a6', '#e8463a', '#7a3cff']) });
    add(c.obj, p.x, p.y - 0.2, p.z, p.yaw + pick([0, Math.PI / 2, -Math.PI / 2]));
    circle(p.x, p.z, 4.2, p.y, p.y + 9);
    occupy(p.x, p.z, 6);
  }
  for (let i = 0; i < per('lake', 2, 650); i++) {
    const p = spot('lake', 30, 90, 5, { margin: 8, edge: 8 });
    if (!p) continue;
    const wm = A.windmill({ color: pick(['#2e6fd8', '#19b3a6']) });
    add(wm.obj, p.x, p.y - 0.2, p.z, p.yaw + R(-0.4, 0.4));
    anim(wm);
    circle(p.x, p.z, 3.8, p.y, p.y + 20);
    occupy(p.x, p.z, 9);
  }
  for (let i = 0; i < per('lake', 150, 650); i++) {
    const p = spot('lake', 14, 100, 1.6, { margin: 2, edge: 3 });
    if (!p) continue;
    const r = treeOk(p.x, p.z) ? rand() : 1;
    if (r < 0.4) plant('round', p.x, p.z, R(0.8, 1.2)) && circle(p.x, p.z, 0.7, p.y, p.y + 9);
    else if (r < 0.55) plant('pine', p.x, p.z, R(0.8, 1.3)) && circle(p.x, p.z, 0.7, p.y, p.y + 12);
    else plant(rand() < 0.5 ? 'bush' : 'flowers', p.x, p.z, R(0.8, 1.3));
    occupy(p.x, p.z, 1.6);
  }

  // ---------------------------------------------------------------- 하버 섬 나무, 꽃
  for (let i = 0; i < 160; i++) {
    const p = spot('harbor', 14, 90, 1.6, { margin: 2, edge: 4 });
    if (!p) continue;
    const r = rand();
    if (r < 0.45) plant('round', p.x, p.z, R(0.8, 1.2)) && circle(p.x, p.z, 0.7, p.y, p.y + 9);
    else if (r < 0.6) plant('blossom', p.x, p.z, R(0.8, 1.1)) && circle(p.x, p.z, 0.7, p.y, p.y + 8);
    else plant(rand() < 0.5 ? 'bush' : 'flowers', p.x, p.z, R(0.8, 1.3));
    occupy(p.x, p.z, 1.6);
  }

  // ---------------------------------------------------------------- 떠 있는 작은 바위섬 (도로·비행 루트를 피해서)
  {
    let placed = 0;
    const nRock = Math.round(46 * Math.max(1, (cbS.x * cbS.y) / (1160 * 890)) ** 0.7);
    for (let tries = 0; tries < nRock * 20 && placed < nRock; tries++) {
      const x = R(cloudBox.min.x - 150, cloudBox.max.x + 150), z = R(cloudBox.min.y - 150, cloudBox.max.y + 150), y = R(-35, 70);
      const r = R(4, 14);
      if (track.fieldAt(x, z) > -r - 20) continue; // 큰 섬 바로 옆은 피함
      tmpV.set(x, y, z);
      if (track.nearestRaw(tmpV) < HW + r + 26) continue;
      if (track.inSkyCorridor(tmpV) || track.skyPath.some((p) => p.distanceTo(tmpV) < r + 25)) continue;
      if (!free(x, z, r + 6)) continue;
      const fr = floatingRock({ r, seed: Math.floor(R(1, 9999)) });
      add(fr.obj, x, y, z, R(0, 6));
      occupy(x, z, r + 4);
      const ph = R(0, 6), amp = R(0.6, 1.8);
      animators.push((t) => (fr.obj.position.y = y + Math.sin(t * 0.4 + ph) * amp));
      placed++;
    }
  }
  // 열기구 (풍차 섬, 하버 섬 주변 하늘)
  for (let k = 0; k < 14; k++) {
    const b = A.hotAirBalloon({ colors: pick([['#e8463a', '#ffcf3f'], ['#2e6fd8', '#ffffff'], ['#7a3cff', '#ff5fa2'], ['#19b3a6', '#ffcf3f'], ['#ff8a1f', '#ffffff']]) });
    const x = R(cloudBox.min.x + 60, cloudBox.max.x - 60), z = R(cloudBox.min.y + 60, cloudBox.max.y - 60), y = R(38, 110);
    tmpV.set(x, y, z);
    if (track.skyPath.some((p) => p.distanceTo(tmpV) < 40)) continue;
    add(b.obj, x, y, z, R(0, 6));
    const ph = R(0, 6);
    animators.push((t, dt) => {
      b.obj.position.y = y + Math.sin(t * 0.25 + ph) * 3;
      b.obj.position.x = x + Math.sin(t * 0.05 + ph) * 12;
      b.update && b.update(t, dt);
    });
  }

  // 먼 곳의 작은 소품은 숨김 (그리기 횟수 줄이기). 이름별 보이는 거리(m)
  const RANGE = { lampPost: 260, flagPole: 320, chevronBoard: 240, signBoard: 380, cottage: 480, crane: 520, windmill: 700, archBanner: 600, dockingMast: 700, controlTower: 900, pitBuilding: 800, grandstand: 800 };
  const detail = [];
  for (const o of group.children) if (RANGE[o.name]) detail.push({ o, r2: RANGE[o.name] ** 2 });
  let detailClock = 0;
  animators.push((t, dt, car) => {
    detailClock -= dt;
    if (detailClock > 0 && dt > 0) return;
    detailClock = 0.25;
    const c = car ? car.pos : null;
    if (!c) return;
    for (const d of detail) d.o.visible = (d.o.position.x - c.x) ** 2 + (d.o.position.z - c.z) ** 2 < d.r2;
  });

  flora.build(group);
  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- 우주 차원 (포털, 우주 풍경, 세계 전환)
  const space = buildSpace(track, scene, { cloudObjects: [group, sky.group] });
  if (space) {
    for (const p of space.portals) for (const f of p.feet) circle(f.x, f.z, 3.4, f.y - 2, f.y + 30);
    animators.push((t, dt, car) => space.update(t, dt, car));
  }

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
    /** 다른 파일(gpCorners.js 코너 표시판)이 단단한 기둥을 더할 때: (x, z, 반지름, 아래 y, 위 y) */
    addCollider: circle,
    /** 디버그: (x, z) 근처 충돌체 목록 */
    collidersNear(x, z, r = 4) {
      return [...new Set([...grid.values()].flat())].filter((c) => Math.hypot(c.x - x, c.z - z) < r + c.r);
    },
    animate(time, dt, car) {
      for (const a of animators) a(time, dt, car);
    },
    space,
    stats: { colliders: [...new Set([...grid.values()].flat())].length, occupied: occupied.length },
  };
}
