// 변신 연습장 풍경 (starterMap.js의 buildScenery) — 맑은 날의 놀이공원 같은 시험장 "TRANSFORM PARK"
//   - 하늘: 파란 하늘 돔(해·해무리) + 뭉게구름(인스턴스 하나, 천천히 흘러감), 밝은 햇빛
//   - 출발: 빨간불 5개 게이트(race.lights), 관중석 2개(바깥), 피트 건물(안쪽), 깃대·깃발 줄, 큰 "TRANSFORM PARK" 간판
//   - 기믹 안내판(쉬운 한국어): 가속·물길·점프·활주로(직진=하늘길 / 오른쪽=땅길)·마지막 코너 (data.signs)
//   - 석호: 물길 양옆 빨강·흰 부표(출렁임), 입구 "SPLASH" 아치, 큰 만에 도는 돛단배, 모래 해변·파라솔·부두·등대
//   - 비행장: 격납고·관제탑·바람자루, 활주로 끝으로 달려가는 불빛, 열기구·비행선
//   - 놀이공원(코스 안쪽): 도는 대관람차, 회전목마, 줄무늬 천막, 풍선 다발 / 언덕 위 풍차·집
//   - 마지막 코너: 무지개 불빛 아치 터널 (불빛이 앞으로 달려감), 결승 뒤 꽃가루 (완주하면 터짐)
//   - 나무·꽃: gpSky.js createFlora 인스턴스 (도로에서 떨어진 곳만, 비행 루트 아래는 낮은 꽃·덤불만)
//   - 성능: 가만히 있는 것은 이름 없이 → staticBatch가 합침. 움직이는 것은 이름을 붙이고 묶음 하나로
//   - 충돌: 원기둥 충돌체 격자 (collideCar, addCollider). 도로 가장자리(연석 끝)에서 3 m 안에는 두지 않음
import * as THREE from 'three';
import { canvasTexture, seededRandom, makeNoise } from './moonTrack.js';
import * as A from './gpAssets.js';
import { createFlora } from './gpSky.js';
import { batchLocal } from './staticBatch.js';

const TAU = Math.PI * 2;
const CAR_R = 1.3;
const CELL = 24;
const UP = new THREE.Vector3(0, 1, 0);
const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

export function buildStarterScenery(track, scene) {
  const t0 = performance.now();
  const rand = seededRandom(91511);
  const R = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const noise = makeNoise(5150);
  const group = new THREE.Group();
  group.name = 'starterScenery';
  scene.add(group);
  const animators = [];
  const stats = { ms: {} };
  let tLap = performance.now();
  const lap = (name) => { const n = performance.now(); stats.ms[name] = Math.round(n - tLap); tLap = n; };
  const tmpV = new THREE.Vector3();
  const S = track.samples, NS = S.length - 1;
  const data = track.data || {};
  const hwOf = (i) => S[i].hw ?? track.width / 2;
  const kerb = (i, sd) => track.kerbAt(i, sd);
  const edgeLat = (i, sd) => hwOf(i) + kerb(i, sd);
  const heading = (s) => Math.atan2(s.tan.x, s.tan.z);

  lap('before:빛·안개:');
  // ---------------------------------------------------------------- 빛·안개: 맑은 낮
  const HORIZON = new THREE.Color('#cfeaff');
  scene.background = HORIZON.clone();
  scene.fog = new THREE.Fog(HORIZON.clone(), 420, 2300);
  const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.35).normalize();
  scene.traverse((o) => {
    if (o.isHemisphereLight) {
      o.color.set('#e6f4ff');
      o.groundColor.set('#6a8f4c');
      o.intensity = 1.2;
    } else if (o.isDirectionalLight) {
      o.color.set('#fff3dc');
      o.intensity = 2.35;
    }
  });

  lap('before:충돌체');
  lap('before:충돌');
  // ---------------------------------------------------------------- 충돌체
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

  lap('before:자리');
  // ---------------------------------------------------------------- 자리 도우미
  const gY = (x, z) => track.heightAt(x, z);
  const wet = (x, z, pad = 0) => track.inWater(x, z, pad);
  // 도로 샘플 해시 → 도로 가장자리(연석 끝)까지 거리
  const RC = 32;
  const rkey = (a, b) => (a + 4000) * 8000 + (b + 4000);
  const rmap = new Map();
  for (let i = 0; i < NS; i++) {
    const p = S[i].pos;
    const k = rkey(Math.floor(p.x / RC), Math.floor(p.z / RC));
    if (!rmap.has(k)) rmap.set(k, []);
    rmap.get(k).push(i);
  }
  // 활주로·착륙장도 '도로'로 침
  const altPts = [];
  for (const ap of track.altPaths || []) for (let k = 0; k < ap.samples.length; k += 2) altPts.push({ p: ap.samples[k].pos, half: ap.half });
  function roadClear(x, z) {
    let best = 1e9;
    const cx = Math.floor(x / RC), cz = Math.floor(z / RC);
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        const list = rmap.get(rkey(cx + a, cz + b));
        if (!list) continue;
        for (const i of list) {
          const s = S[i];
          const d = Math.hypot(x - s.pos.x, z - s.pos.z) - Math.max(edgeLat(i, -1), edgeLat(i, 1));
          if (d < best) best = d;
        }
      }
    for (const q of altPts) {
      const d = Math.hypot(x - q.p.x, z - q.p.z) - q.half;
      if (d < best) best = d;
    }
    return best;
  }
  const sky = (x, z) => (track.skyLineDist && track.skyPath.length > 1 ? track.skyLineDist(x, z) : { d: 1e9, u: 0 });
  const occupied = [];
  const free = (x, z, r) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
  const occupy = (x, z, r) => occupied.push({ x, z, r });
  const add = (obj, x, y, z, yaw = 0, parent = group) => {
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    parent.add(obj);
    return obj;
  };
  const moving = new Set();
  const anim = (r) => {
    if (!r || !r.update) return;
    if (r.obj) {
      // 모델 전체 대신 실제로 회전·이동하는 부분만 분리한다.
      // 깃대·풍차 몸통·등대 본체는 다른 정지 장식과 함께 묶을 수 있다.
      const poses = [];
      r.obj.traverse((o) => poses.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(), v: o.visible }));
      r.update(0, 0, null);
      const first = poses.map(({ o }) => [o.position.clone(), o.quaternion.clone(), o.scale.clone()]);
      r.update(1, 0, null);
      poses.forEach(({ o, p, q, s, v }, i) => {
        if (!o.position.equals(first[i][0]) || !o.quaternion.equals(first[i][1]) || !o.scale.equals(first[i][2])) moving.add(o);
        o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); o.visible = v;
      });
    }
    animators.push((t, dt, car) => r.update(t, dt, car));
  };
  const atT = (t, l, h = 0) => {
    const s = track.sampleAt(t);
    return { s, p: track.surf(s, l, h, new THREE.Vector3()), yaw: heading(s) };
  };
  /** 여기 놓아도 되는지: 땅 위, 도로에서 clear m 밖, 비리 비행 루트 아래가 아니고, 다른 큰 물건과 안 겹침 */
  const okSpot = (x, z, r, clear = 6, skyClear = 0) => !wet(x, z, 2) && roadClear(x, z) > clear + r && free(x, z, r) && (!skyClear || sky(x, z).d > skyClear) && track.fieldAt(x, z) > 0;
  /** (x, z) 근처에서 okSpot을 만족하는 곳 찾기 (나선으로) */
  function findSpot(x, z, r, clear = 6, skyClear = 0, maxR = 160) {
    for (let d = 0; d <= maxR; d += 8)
      for (let k = 0; k < Math.max(1, Math.round((TAU * d) / 10)); k++) {
        const a = (k / Math.max(1, Math.round((TAU * d) / 10))) * TAU;
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        if (okSpot(px, pz, r, clear, skyClear)) return { x: px, z: pz, y: gY(px, pz) };
      }
    return null;
  }
  // 코스 안쪽 가운데 (놀이공원 자리)
  let cx = 0, cz = 0;
  for (let i = 0; i < NS; i += 4) (cx += S[i].pos.x), (cz += S[i].pos.z);
  cx /= Math.ceil(NS / 4);
  cz /= Math.ceil(NS / 4);
  const tb = track.terrainBox;

  lap('before:하늘');
  // ---------------------------------------------------------------- 하늘 돔 (카메라를 따라다님)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color('#2f86e6') }, mid: { value: new THREE.Color('#6fb6f4') }, hor: { value: HORIZON.clone() }, sun: { value: SUN_DIR.clone() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sun; varying vec3 vD;' +
      'void main(){ vec3 d = normalize(vD); float h = d.y; vec3 c = mix(hor, mid, smoothstep(-0.02, 0.22, h)); c = mix(c, top, smoothstep(0.22, 0.85, h));' +
      ' float s = max(dot(d, sun), 0.0); c += vec3(1.0,0.93,0.78) * (pow(s, 900.0) * 2.2 + pow(s, 40.0) * 0.22 + pow(s, 6.0) * 0.08);' +
      ' gl_FragColor = vec4(c, 1.0); }',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), skyMat);
  dome.name = 'starterSky';
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);
  animators.push(() => {
    const cam = window.game && window.game.camera;
    if (cam) dome.position.copy(cam.position);
  });

  lap('before:뭉게구름');
  // ---------------------------------------------------------------- 뭉게구름 (구 7개를 합친 모양 하나 → 인스턴스)
  {
    const parts = [];
    const cr = seededRandom(7);
    for (let k = 0; k < 8; k++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const r = 0.55 + cr() * 0.5;
      g.scale(r * 1.25, r * 0.8, r);
      g.translate((k - 3.5) * 0.55 + (cr() - 0.5) * 0.3, (cr() - 0.3) * 0.35, (cr() - 0.5) * 0.6);
      parts.push(g);
    }
    const geo = mergeGeos(parts);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#e8f2ff', emissiveIntensity: 0.55, flatShading: true });
    const N = 26;
    const im = new THREE.InstancedMesh(geo, mat, N);
    im.name = 'starterClouds';
    const clouds = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU + R(-0.2, 0.2), d = R(500, 1500);
      clouds.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, y: R(150, 300), s: R(28, 60), ry: R(0, TAU), v: R(2, 5) });
    }
    const place = (time) => {
      clouds.forEach((c, k) => {
        const x = c.x + ((((time * c.v) % 3000) + 3000) % 3000) - 1500; // 3 km 흘러가면 처음으로
        q.setFromAxisAngle(UP, c.ry);
        m4.compose(pv.set(x, c.y, c.z), q, sv.set(c.s, c.s * 0.75, c.s * 0.8));
        im.setMatrixAt(k, m4);
      });
      im.instanceMatrix.needsUpdate = true;
    };
    place(0);
    im.frustumCulled = false;
    group.add(im);
    let acc = 0;
    animators.push((time, dt) => {
      acc += dt || 0;
      if (acc > 0.25) {
        acc = 0;
        place(time);
      }
    });
  }

  lap('before:출발');
  // ---------------------------------------------------------------- 출발 지역
  const s0 = track.sampleAt(0);
  const HW0 = hwOf(0), KB = kerb(0, -1);
  {
    const g = A.startGantry({ width: 2 * (HW0 + KB) });
    add(g.obj, s0.pos.x, s0.pos.y - 0.05, s0.pos.z, heading(s0));
    anim(g);
    animators.push(() => {
      const race = window.game && window.game.race;
      if (!race) return;
      if (race.phase === 'countdown') {
        g.setGreen(false);
        g.setLights(race.lights ?? 0);
      } else {
        g.setLights(0);
        g.setGreen(race.phase === 'racing' && race.time < 4);
      }
    });
    for (const sd of [-1, 1]) {
      const p = track.surf(s0, sd * (HW0 + KB + 1.5), 0, new THREE.Vector3());
      circle(p.x, p.z, 1.2, p.y - 1, p.y + 12);
    }
  }
  // 관중석 2개 (바깥 = 왼쪽), 피트 건물 (안쪽 = 오른쪽)
  const stands = [];
  for (const [along, len, col] of [[-62, 56, '#e8463a'], [40, 56, '#2e6fd8']]) {
    const t = ((along / track.length) % 1 + 1) % 1;
    const s = track.sampleAt(t);
    const front = edgeLat(s.i, -1) + 6;
    const p = track.surf(s, -front, 0, new THREE.Vector3());
    const st = A.grandstand({ length: len, roofColor: col });
    add(st.obj, p.x, Math.min(p.y, gY(p.x, p.z)) - 0.05, p.z, heading(s));
    const hd = st.halfDepth || 7;
    const c = track.surf(s, -(front + hd), 0, new THREE.Vector3());
    for (let u = -len / 2; u <= len / 2; u += hd * 1.4) circle(c.x + s.tan.x * u, c.z + s.tan.z * u, hd + 0.5, p.y - 2, p.y + 16);
    occupy(c.x, c.z, len / 2 + 6);
    stands.push({ st, c: c.clone() });
  }
  animators.push((time, dt, car) => {
    for (const { st, c } of stands) {
      const d = car ? car.pos.distanceTo(c) : 999;
      st.excite = THREE.MathUtils.lerp(st.excite || 0, d < 80 ? 1 : 0.1, 1 - Math.exp(-4 * (dt || 0.016)));
      if (st.update) st.update(time, dt, st.excite);
    }
  });
  {
    const t = 70 / track.length;
    const s = track.sampleAt(t);
    const p = track.surf(s, edgeLat(s.i, 1) + 6, 0, new THREE.Vector3());
    const pb = A.pitBuilding({ length: 64 });
    add(pb.obj, p.x, p.y - 0.05, p.z, heading(s) + Math.PI);
    anim(pb);
    const c = track.surf(s, edgeLat(s.i, 1) + 14, 0, new THREE.Vector3());
    for (let u = -32; u <= 32; u += 9) circle(c.x + s.tan.x * u, c.z + s.tan.z * u, 8.5, p.y - 2, p.y + 13);
    occupy(c.x, c.z, 40);
  }
  // 깃대 줄 (관중석 사이) + 출발 직선 깃발 줄
  for (let k = 0; k < 6; k++) {
    const s = track.sampleAt(((-12 + k * 4.2) / track.length + 1) % 1);
    const p = track.surf(s, -(edgeLat(s.i, -1) + 3.5), 0, new THREE.Vector3());
    const f = A.flagPole({ color: ['#e8463a', '#ffcf3f', '#2e6fd8', '#19b3a6', '#ff5fa2', '#3ccf4e'][k] });
    add(f.obj, p.x, gY(p.x, p.z) - 0.1, p.z, heading(s));
    anim(f);
    circle(p.x, p.z, 0.45, p.y - 1, p.y + 10);
  }
  for (const along of [105, 150, 195]) { // 깃발 줄 (곧은 직선 위만: T1이 시작하는 215 m 전)
    const s = track.sampleAt(along / track.length);
    const p = track.surf(s, edgeLat(s.i, 1) + 3.2, 0, new THREE.Vector3());
    const b = A.bannerFlags({ length: 36 });
    add(b.obj, p.x, gY(p.x, p.z) - 0.1, p.z, heading(s) + Math.PI / 2);
    anim(b);
    for (const u of [-18, 18]) circle(p.x + s.tan.x * u, p.z + s.tan.z * u, 0.4, p.y - 1, p.y + 7);
  }

  lap('before:글자');
  // ---------------------------------------------------------------- 글자 판 (캔버스) 도우미 — 이모지는 쓰지 말 것 (캔버스 색 이모지가 판마다 100~400 ms 걸려 로딩이 느려짐)
  const boardTex = new Map();
  function textBoard({ title, sub = '', icon = '', w = 12, h = 4, bg = '#1d6fd8', fg = '#ffffff', accent = '#ffd23f' }) {
    const tb0 = performance.now();
    const key = [title, sub, icon, w, h, bg, fg, accent].join('|');
    const tex = boardTex.get(key) || canvasTexture(1024, Math.round((1024 * h) / w), (g, W, H) => {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, bg);
      gr.addColorStop(1, new THREE.Color(bg).multiplyScalar(0.72).getStyle());
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      g.fillStyle = accent;
      g.fillRect(0, 0, W, H * 0.06);
      g.fillRect(0, H * 0.94, W, H * 0.06);
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = 8;
      g.strokeRect(14, 14 + H * 0.06, W - 28, H * 0.88 - 28);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = fg;
      const tx = icon ? `${icon} ${title}` : title;
      let fs = Math.round(H * (sub ? 0.4 : 0.56));
      do g.font = `900 ${fs}px ${FONT}`;
      while (g.measureText(tx).width > W * 0.9 && --fs > 10);
      g.fillText(tx, W / 2, H * (sub ? 0.4 : 0.52));
      if (sub) {
        let ss = Math.round(H * 0.2);
        do g.font = `700 ${ss}px ${FONT}`;
        while (g.measureText(sub).width > W * 0.9 && --ss > 8);
        g.fillStyle = accent;
        g.fillText(sub, W / 2, H * 0.74);
      }
    }, false);
    boardTex.set(key, tex);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const back = new THREE.MeshLambertMaterial({ color: '#d9dde5' });
    const grp = new THREE.Group();
    // 상자의 앞면만 별도 재질, 나머지 다섯 면은 한 번에 그린다.
    const boardGeo = new THREE.BoxGeometry(w, h, 0.25);
    const srcIndex = boardGeo.index.array;
    boardGeo.setIndex([...srcIndex.slice(0, 24), ...srcIndex.slice(30, 36), ...srcIndex.slice(24, 30)]);
    boardGeo.clearGroups();
    boardGeo.addGroup(0, 30, 0);
    boardGeo.addGroup(30, 6, 1);
    const board = new THREE.Mesh(boardGeo, [back, mat]);
    board.castShadow = true;
    const POLE = 3.2;
    board.position.y = POLE + h / 2;
    grp.add(board);
    const legMat = new THREE.MeshLambertMaterial({ color: '#c3c9d3' });
    for (const sx of [-w * 0.35, w * 0.35]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, POLE + h * 0.6, 8), legMat);
      leg.position.set(sx, (POLE + h * 0.6) / 2, -0.2);
      grp.add(leg);
    }
    (stats.tb || (stats.tb = [])).push(Math.round(performance.now() - tb0));
    return { obj: grp, height: POLE + h, w };
  }
  lap('textBoardFn');
  /** 코스 위치 t에서 옆 side(−1 왼 / 1 오른)에, 다가오는 차를 바라보는 안내판 */
  function roadSign(t, side, opts, gap = 5) {
    const s = track.sampleAt(t);
    const p = track.surf(s, side * (edgeLat(s.i, side) + gap + (opts.w || 12) / 2), 0, new THREE.Vector3());
    const y = Math.min(p.y, gY(p.x, p.z)) - 0.1;
    const b = textBoard(opts);
    // 도로 쪽으로 살짝 돌려 운전자가 잘 보게
    add(b.obj, p.x, y, p.z, Math.atan2(-s.tan.x, -s.tan.z) - side * 0.28);
    for (const u of [-b.w * 0.35, b.w * 0.35]) circle(p.x + s.right.x * u, p.z + s.right.z * u, 0.45, y, y + b.height);
    occupy(p.x, p.z, b.w / 2 + 2);
    return b;
  }
  const SG = data.signs || {};
  const tBack = (t, m) => ((t - m / track.length) % 1 + 1) % 1;
  if (SG.accel != null) roadSign(SG.accel, 1, { title: '쭉 밟아요!', sub: '150 km/h 넘으면 가속 모드', bg: '#e8463a' });
  if (SG.water != null) {
    roadSign(SG.water, -1, { title: '물길', sub: '들어가면 배로 변신!', bg: '#1d8fd0' });
    roadSign(tBack(SG.water, -60), 1, { title: 'SPLASH!', sub: '그대로 직진', bg: '#16a3b8', w: 10 });
  }
  if (SG.jump != null) roadSign(SG.jump, -1, { title: '점프대', sub: '핸들은 똑바로', bg: '#f08a1c', accent: '#1d2433' });
  if (SG.runway != null) {
    roadSign(SG.runway, -1, { title: '직진 → 활주로', sub: '끝에서 날아올라요', bg: '#0f6fb8' });
    roadSign(tBack(SG.runway, -70), 1, { title: '땅길은 오른쪽 →', sub: '날지 않아도 괜찮아요', bg: '#3c9a3c', w: 11 });
  }
  if (SG.final != null) roadSign(SG.final, 1, { title: '마지막 코너', sub: '기울어진 길 · 빠르게!', bg: '#7a3cff' });

  lap('roadSigns');
  // 큰 "TRANSFORM PARK" 간판 (출발 직선 안쪽 언덕, 출발선에서 보임)
  {
    const s = track.sampleAt(180 / track.length);
    const want = track.surf(s, 60, 0, new THREE.Vector3());
    const sp = findSpot(want.x, want.z, 14, 20, 30, 80);
    if (sp) {
      const b = textBoard({ title: 'TRANSFORM PARK', sub: '변신 연습장 · 처음 오신 걸 환영해요!', w: 30, h: 7.5, bg: '#ffffff', fg: '#1d2433', accent: '#e8463a' });
      add(b.obj, sp.x, sp.y - 0.2, sp.z, Math.atan2(s0.pos.x - sp.x, s0.pos.z - sp.z));
      circle(sp.x, sp.z, 12, sp.y, sp.y + 12);
      occupy(sp.x, sp.z, 18);
    }
  }

  lap('before:코너');
  // ---------------------------------------------------------------- 코너 표시: 화살표 판(바깥) + 타이어 더미
  {
    const L = track.racingLine;
    for (const ap of (L && L.apexes) || []) {
      if (ap.radius > 100) continue;
      const out = -ap.side;
      for (let k = -2; k <= 2; k++) {
        const i = ((ap.i + Math.round((k * 9) / (track.length / NS))) % NS + NS) % NS;
        const s = S[i];
        if (s.water) continue;
        const p = track.surf(s, out * (edgeLat(i, out) + 3.8), 0, new THREE.Vector3());
        if (roadClear(p.x, p.z) < 3.4) continue; // 굽은 길 반대쪽 도로와 가까우면 안 세움
        const cb = A.chevronBoard({ dir: -out });
        add(cb.obj, p.x, Math.min(p.y, gY(p.x, p.z)) - 0.05, p.z, Math.atan2(-s.tan.x, -s.tan.z));
        circle(p.x, p.z, 0.4, p.y - 1, p.y + 3);
      }
    }
  }

  lap('before:석호:');
  // ---------------------------------------------------------------- 석호: 부표 줄 · SPLASH 아치 · 돛단배 · 해변 · 등대
  const buoyList = [];
  for (const [a, b] of (track.waterRanges || []).map((w) => [Math.round(w.t0 * NS), Math.round(w.t1 * NS)])) {
    const step = Math.max(1, Math.round(12 / (track.length / NS)));
    let n = 0;
    for (let i = a + step; i < b - step; i += step, n++)
      for (const sd of [-1, 1]) {
        const s = S[i % NS];
        const p = track.surf(s, sd * (hwOf(i % NS) + 1.6), 0, new THREE.Vector3());
        buoyList.push({ x: p.x, z: p.z, red: (n + (sd > 0 ? 1 : 0)) % 2 === 0, ph: rand() * TAU });
      }
  }
  if (buoyList.length) {
    const geo = mergeGeos([
      new THREE.SphereGeometry(0.55, 10, 7).translate(0, 0.1, 0),
      new THREE.CylinderGeometry(0.06, 0.08, 1.0, 6).translate(0, 0.9, 0),
      new THREE.SphereGeometry(0.16, 8, 6).translate(0, 1.45, 0),
    ]);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.45 }), buoyList.length);
    im.name = 'starterBuoys';
    const cR = new THREE.Color('#ff3b2f'), cW = new THREE.Color('#ffffff');
    buoyList.forEach((b, k) => im.setColorAt(k, b.red ? cR : cW));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const pose = (time) => {
      buoyList.forEach((b, k) => {
        e.set(Math.sin(time * 1.3 + b.ph) * 0.12, 0, Math.cos(time * 1.1 + b.ph) * 0.12);
        m4.compose(pv.set(b.x, Math.sin(time * 1.7 + b.ph) * 0.12 - 0.1, b.z), q.setFromEuler(e), one);
        im.setMatrixAt(k, m4);
      });
      im.instanceMatrix.needsUpdate = true;
    };
    pose(0);
    im.computeBoundingSphere();
    im.boundingSphere.radius += 2;
    group.add(im);
    animators.push((time) => pose(time));
    stats.buoys = buoyList.length;
  }
  for (const w of track.waterRanges || []) {
    // 물길 입구 아치 (다리는 물속 바닥까지)
    const s = track.sampleAt((w.t0 + 14 / track.length) % 1);
    const width = 2 * (hwOf(s.i) + 4);
    const a = A.archBanner({ width, text: 'SPLASH ZONE', color: '#16a3b8' });
    add(a.obj, s.pos.x, s.pos.y - 0.4, s.pos.z, heading(s));
    for (const sd of [-1, 1]) {
      const p = track.surf(s, sd * (width / 2 + 1.5), 0, new THREE.Vector3());
      circle(p.x, p.z, 1.8, p.y - 3, p.y + 9);
    }
  }
  // 큰 만: 도는 돛단배들
  const bay = track.bay;
  if (bay) {
    const hullGeo = mergeGeos([
      new THREE.BoxGeometry(2.2, 0.9, 6.5).translate(0, 0.25, 0),
      new THREE.ConeGeometry(1.1, 2.2, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.45, 1).translate(0, 0.25, 4.3),
    ]);
    const mastGeo = new THREE.CylinderGeometry(0.08, 0.1, 8, 6).translate(0, 4.6, 0.3);
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, 0.2, 0, 8.3, 0.4, 0, 1.2, -3.2], 3));
    sailGeo.computeVertexNormals();
    const boats = [];
    const hullMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    const mastMat = new THREE.MeshLambertMaterial({ color: '#8a6a4a' });
    const boatInstances = [
      new THREE.InstancedMesh(hullGeo, hullMat, 6),
      new THREE.InstancedMesh(mastGeo, mastMat, 6),
      new THREE.InstancedMesh(sailGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), 6),
    ];
    for (const im of boatInstances) {
      im.name = 'starterBoats';
      im.frustumCulled = false; // 작은 배 여섯 척이 석호 안에서만 움직임
      group.add(im);
    }
    for (let k = 0; k < 6; k++) {
      const g = new THREE.Group();
      boatInstances[2].setColorAt(k, new THREE.Color(['#ff5f5f', '#ffd23f', '#3fa9ff', '#ffffff', '#ff8fd0', '#5fdc8f'][k]));
      boats.push({ g, r: R(25, bay.r - 30), ph: R(0, TAU), sp: R(0.04, 0.08) * (k % 2 ? 1 : -1), bob: R(0, TAU) });
    }
    animators.push((time) => {
      for (const b of boats) {
        const a = b.ph + time * b.sp;
        b.g.position.set(bay.x + Math.cos(a) * b.r, Math.sin(time * 1.4 + b.bob) * 0.15, bay.z + Math.sin(a) * b.r);
        b.g.rotation.set(Math.sin(time * 1.1 + b.bob) * 0.04, -a + (b.sp > 0 ? 0 : Math.PI), Math.sin(time * 0.9 + b.bob) * 0.08 + 0.12 * Math.sign(b.sp));
        b.g.updateMatrix();
        for (const im of boatInstances) im.setMatrixAt(boats.indexOf(b), b.g.matrix);
      }
      for (const im of boatInstances) im.instanceMatrix.needsUpdate = true;
    });
    // 해변: 만 둘레 모래사장에 파라솔·비치 타월 (인스턴스)
    const umb = [];
    for (let k = 0; k < 220 && umb.length < 46; k++) {
      const a = R(0, TAU), d = bay.r + R(8, 26);
      const x = bay.x + Math.cos(a) * d, z = bay.z + Math.sin(a) * d;
      const y = gY(x, z);
      if (y < 0.15 || y > 1.4 || roadClear(x, z) < 12) continue;
      umb.push({ x, y, z, c: pick(['#ff5f5f', '#ffd23f', '#3fa9ff', '#ff8fd0', '#5fdc8f', '#ffffff']) });
    }
    if (umb.length) {
      const geo = mergeGeos([new THREE.ConeGeometry(1.6, 0.8, 8).translate(0, 2.5, 0), new THREE.CylinderGeometry(0.05, 0.05, 2.5, 5).translate(0, 1.25, 0)]);
      const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), umb.length);
      const m4 = new THREE.Matrix4(), c = new THREE.Color();
      umb.forEach((u, k) => {
        im.setMatrixAt(k, m4.makeTranslation(u.x, u.y, u.z));
        im.setColorAt(k, c.set(u.c));
      });
      im.computeBoundingSphere();
      group.add(im);
    }
    // 등대: 만 바깥쪽 끝 기슭
    {
      const dx = bay.x - cx, dz = bay.z - cz, dl = Math.hypot(dx, dz) || 1;
      let spot = null;
      for (let d = bay.r + 6; d < bay.r + 60 && !spot; d += 4) {
        const x = bay.x + (dx / dl) * d, z = bay.z + (dz / dl) * d;
        if (!wet(x, z, 1) && gY(x, z) > 0.6) spot = { x, z, y: gY(x, z) };
      }
      if (spot) {
        const lh = A.lighthouse();
        add(lh.obj, spot.x, spot.y - 0.2, spot.z, 0);
        anim(lh);
        circle(spot.x, spot.z, 6, spot.y, spot.y + 27);
        occupy(spot.x, spot.z, 10);
      }
    }
    // 부두: 만 안쪽 기슭에서 물로 뻗은 나무 다리 + 작은 배 2척
    {
      const dx = cx - bay.x, dz = cz - bay.z, dl = Math.hypot(dx, dz) || 1;
      const ux = dx / dl, uz = dz / dl;
      let shore = null;
      for (let d = bay.r - 20; d < bay.r + 60 && !shore; d += 2) if (!wet(bay.x + ux * d, bay.z + uz * d, 0)) shore = d;
      if (shore) {
        const L = 34, x0 = bay.x + ux * (shore + 4), z0 = bay.z + uz * (shore + 4);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, L), new THREE.MeshLambertMaterial({ color: '#a77a4f' }));
        const yaw = Math.atan2(-ux, -uz);
        add(deck, x0 - ux * (L / 2), 0.8, z0 - uz * (L / 2), yaw);
        for (let k = 0; k <= 6; k++)
          for (const sd of [-1, 1]) {
            const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4, 6), new THREE.MeshLambertMaterial({ color: '#6b4a30' }));
            add(pile, x0 - ux * (k * L / 6) + uz * sd * 1.6, -0.8, z0 - uz * (k * L / 6) - ux * sd * 1.6, 0);
          }
      }
    }
  }

  lap('before:점프대:');
  // ---------------------------------------------------------------- 점프대: 노랑·검정 줄무늬 판 + JUMP 아치
  for (const j of track.jumps || []) {
    const kick = [];
    for (let k = -j.kickN; k <= 0; k++) kick.push(S[(j.lipI + k + NS) % NS]);
    const tex = canvasTexture(64, 64, (c, w, h) => {
      c.fillStyle = '#f2c230';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#1d2026';
      for (let q = -2; q < 4; q++) {
        c.beginPath();
        c.moveTo(q * 22, h);
        c.lineTo(q * 22 + 11, h);
        c.lineTo(q * 22 + 11 + h, 0);
        c.lineTo(q * 22 + h, 0);
        c.fill();
      }
    });
    tex.repeat.set(3, 1);
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    track.strip(kick, (q) => [[-hwOf(q.i) + 0.6, 0.02], [hwOf(q.i) - 0.6, 0.02]], mat, { vScale: 4, parent: group });
    const sa = S[(j.lipI - j.kickN - Math.round(8 / (track.length / NS)) + NS) % NS];
    const w = 2 * (Math.max(edgeLat(sa.i, -1), edgeLat(sa.i, 1)) + 3.5);
    const a = A.archBanner({ width: w, text: 'JUMP!', color: '#f08a1c' });
    add(a.obj, sa.pos.x, sa.pos.y - 0.05, sa.pos.z, heading(sa));
    for (const sd of [-1, 1]) {
      const p = track.surf(sa, sd * (w / 2 + 1.5), 0, new THREE.Vector3());
      circle(p.x, p.z, 1.8, p.y - 1, p.y + 9);
    }
  }
  // 활주로 위 "하늘길" 아치 (도로에서 충분히 갈라진 곳: 활주로 46 m 지점)
  if (track.runway) {
    const rw = track.runway, q = rw.samples[Math.min(rw.samples.length - 1, 58)];
    const w = 2 * rw.half + 5;
    const a = A.archBanner({ width: w, text: '하늘길 TAKE OFF', color: '#0f6fb8' });
    add(a.obj, q.pos.x, q.pos.y - 0.05, q.pos.z, Math.atan2(q.tan.x, q.tan.z));
    for (const sd of [-1, 1]) {
      const p = q.pos.clone().addScaledVector(q.right, sd * (w / 2 + 1.5));
      circle(p.x, p.z, 1.8, p.y - 1, p.y + 9);
      stats.rwArchLeg = (stats.rwArchLeg || []).concat(Math.round(track.nearestRaw(p) * 10) / 10);
    }
  }

  lap('before:비행장:');
  // ---------------------------------------------------------------- 비행장: 격납고·관제탑·바람자루·활주로 불빛
  if (track.runway) {
    const rw = track.runway, st = rw.start;
    const dir = rw.end.pos.clone().sub(st.pos).setY(0).normalize();
    const left = new THREE.Vector3(dir.z, 0, -dir.x); // 진행 방향 왼쪽 (활주로는 왼쪽으로 갈라짐 → 그 바깥)
    const hangarMat = new THREE.MeshLambertMaterial({ color: '#dfe6ee', flatShading: true });
    const roofMat = new THREE.MeshLambertMaterial({ color: '#2e6fd8', flatShading: true });
    const doorMat = new THREE.MeshLambertMaterial({ color: '#5b6573' });
    for (const [along, out] of [[-10, 46], [32, 50]]) {
      const want = st.pos.clone().addScaledVector(dir, along).addScaledVector(left, out);
      const sp = findSpot(want.x, want.z, 13, 10, 28, 50);
      if (!sp) continue;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 18), hangarMat);
      body.position.y = 3.5;
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 18, 14, 1, false, 0, Math.PI), roofMat);
      roof.rotation.set(Math.PI / 2, Math.PI / 2, 0);
      roof.scale.set(1, 1, 0.45);
      roof.position.y = 7;
      const door = new THREE.Mesh(new THREE.BoxGeometry(16, 6.2, 0.3), doorMat);
      door.position.set(0, 3.1, 9.05);
      g.add(body, roof, door);
      const label = textBoard({ title: 'HANGAR', w: 9, h: 2 });
      label.obj.children.forEach((c) => (c.position.y -= 3.2));
      label.obj.position.set(0, 7.8, 9.2);
      label.obj.scale.setScalar(0.9);
      g.add(label.obj);
      add(g, sp.x, sp.y - 0.2, sp.z, Math.atan2(st.pos.x - sp.x, st.pos.z - sp.z));
      circle(sp.x, sp.z, 12.5, sp.y, sp.y + 12);
      occupy(sp.x, sp.z, 16);
    }
    {
      const want = st.pos.clone().addScaledVector(dir, 70).addScaledVector(left, 44);
      const sp = findSpot(want.x, want.z, 6, 10, 30, 60);
      if (sp) {
        const ct = A.controlTower();
        add(ct.obj, sp.x, sp.y - 0.2, sp.z, Math.atan2(st.pos.x - sp.x, st.pos.z - sp.z));
        anim(ct);
        circle(sp.x, sp.z, 5.6, sp.y, sp.y + 34);
        occupy(sp.x, sp.z, 9);
      }
    }
    // 바람자루 (활주로 끝 옆)
    {
      const p = rw.end.pos.clone().addScaledVector(left, rw.half + 9);
      const y = gY(p.x, p.z);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), new THREE.MeshLambertMaterial({ color: '#d9dde5' }));
      pole.position.y = 3;
      const sockTex = canvasTexture(64, 16, (c, w, h) => {
        for (let k = 0; k < 5; k++) {
          c.fillStyle = k % 2 ? '#ffffff' : '#ff6a14';
          c.fillRect((k * w) / 5, 0, w / 5, h);
        }
      });
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 2.6, 10, 1, true).rotateZ(Math.PI / 2).translate(1.3, 0, 0), new THREE.MeshLambertMaterial({ map: sockTex, side: THREE.DoubleSide }));
      sock.name = 'starterWindsock';
      sock.position.y = 5.8;
      g.add(pole, sock);
      add(g, p.x, y, p.z, 0);
      animators.push((time) => {
        sock.rotation.y = 0.6 + Math.sin(time * 0.6) * 0.25;
        sock.rotation.z = -0.15 + Math.sin(time * 2.3) * 0.08;
      });
      circle(p.x, p.z, 0.4, y, y + 6);
    }
    // 활주로 가장자리 불빛: 끝을 향해 달려가는 불빛
    const L = rw.samples;
    const lights = [];
    for (let k = 2; k < L.length; k += 4)
      for (const sd of [-1, 1]) {
        const s = L[k];
        lights.push({ x: s.pos.x + s.right.x * sd * (rw.half + 0.5), y: s.pos.y + 0.2, z: s.pos.z + s.right.z * sd * (rw.half + 0.5), k });
      }
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), lights.length);
    im.name = 'starterRunwayLights';
    const m4 = new THREE.Matrix4(), cOn = new THREE.Color('#5ad1ff'), cOff = new THREE.Color('#244a6a');
    lights.forEach((l, i) => im.setMatrixAt(i, m4.makeTranslation(l.x, l.y, l.z)));
    im.computeBoundingSphere();
    group.add(im);
    animators.push((time) => {
      const head = (time * 40) % (L.length + 20);
      lights.forEach((l, i) => im.setColorAt(i, Math.abs(l.k - head) < 6 ? cOn : cOff));
      im.instanceColor.needsUpdate = true;
    });
  }
  // 열기구·비행선 (비행 루트에서 떨어진 하늘)
  for (let k = 0, n = 0; k < 40 && n < 6; k++) {
    const x = R(tb.min.x + 220, tb.max.x - 220), z = R(tb.min.y + 220, tb.max.y - 220), y = R(45, 110);
    tmpV.set(x, y, z);
    if (track.skyPath.some((p) => p.distanceTo(tmpV) < 70) || roadClear(x, z) < 20) continue;
    const b = A.hotAirBalloon({ colors: pick([['#e8463a', '#ffcf3f'], ['#2e6fd8', '#ffffff'], ['#7a3cff', '#ff5fa2'], ['#19b3a6', '#ffcf3f'], ['#ff8a1f', '#ffffff']]) });
    b.obj.name = 'starterBalloon';
    add(b.obj, x, y, z, R(0, TAU));
    const ph = R(0, TAU), sp = R(0.6, 1.4);
    animators.push((t) => {
      b.update(t);
      b.obj.position.x = x + Math.sin(t * 0.02 * sp + ph) * 40;
      b.obj.position.z = z + Math.cos(t * 0.017 * sp + ph) * 40;
    });
    n++;
  }
  {
    const ship = A.airship({ color: '#ff5f5f', text: 'TRANSFORM PARK' });
    group.add(ship.obj);
    ship.obj.name = 'starterAirship';
    const rx = Math.max(220, (tb.max.x - tb.min.x) / 2 - 260), rz = Math.max(200, (tb.max.y - tb.min.y) / 2 - 260);
    animators.push((t) => {
      const a = t * 0.016;
      ship.obj.position.set(cx + Math.cos(a) * rx, 95, cz + Math.sin(a) * rz);
      ship.obj.rotation.y = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz);
      ship.update(t);
    });
  }

  lap('before:놀이공원');
  // ---------------------------------------------------------------- 놀이공원 (코스 안쪽 가운데): 대관람차 · 회전목마 · 천막 · 풍선
  {
    const sp = findSpot(cx, cz, 26, 22, 40, 150);
    if (sp) {
      const H = 34, RW = 15;
      const wheel = new THREE.Group();
      wheel.name = 'starterFerris';
      const rimMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.3 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(RW, 0.35, 6, 48), rimMat);
      const rim2 = rim.clone();
      rim.position.z = 1.2;
      rim2.position.z = -1.2;
      wheel.add(rim, rim2);
      const spokes = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU;
        const g = new THREE.CylinderGeometry(0.1, 0.1, RW, 4).translate(0, RW / 2, 0).rotateZ(a);
        spokes.push(g.clone().translate(0, 0, 1.2), g.translate(0, 0, -1.2));
      }
      wheel.add(new THREE.Mesh(mergeGeos(spokes), rimMat));
      const cabCols = ['#ff5f5f', '#ffd23f', '#3fa9ff', '#ff8fd0', '#5fdc8f', '#b07cff'];
      const cabs = new THREE.InstancedMesh(new THREE.BoxGeometry(2.0, 2.1, 2.0), new THREE.MeshLambertMaterial({ flatShading: true }), 16);
      cabs.name = 'starterFerrisCabs';
      const cc = new THREE.Color();
      for (let k = 0; k < 16; k++) cabs.setColorAt(k, cc.set(cabCols[k % cabCols.length]));
      // 다리 (A자 두 쌍)
      const legMat = new THREE.MeshLambertMaterial({ color: '#2e6fd8' });
      const legs = new THREE.Group();
      for (const sz of [-2.6, 2.6])
        for (const sx of [-1, 1]) {
          const len = Math.hypot(H, 9);
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, len, 6), legMat);
          leg.position.set(sx * 4.5, H / 2, sz);
          leg.rotation.z = sx * Math.atan2(9, H);
          legs.add(leg);
        }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 6.4, 12).rotateX(Math.PI / 2), legMat);
      hub.position.y = H;
      legs.add(hub);
      const base = new THREE.Group();
      base.add(legs);
      wheel.position.y = H;
      base.add(wheel);
      cabs.position.y = 0;
      base.add(cabs);
      const yaw = Math.atan2(s0.pos.x - sp.x, s0.pos.z - sp.z) + Math.PI / 2;
      add(base, sp.x, sp.y - 0.2, sp.z, yaw);
      const m4 = new THREE.Matrix4();
      animators.push((time) => {
        const a = time * 0.12;
        wheel.rotation.z = a;
        for (let k = 0; k < 16; k++) {
          const b = a + (k / 16) * TAU + Math.PI / 2;
          cabs.setMatrixAt(k, m4.makeTranslation(Math.cos(b) * RW, H + Math.sin(b) * RW - 1.4, 0));
        }
        cabs.instanceMatrix.needsUpdate = true;
      });
      cabs.frustumCulled = false;
      circle(sp.x, sp.z, 10, sp.y, sp.y + 50);
      occupy(sp.x, sp.z, 24);
      stats.ferris = [Math.round(sp.x), Math.round(sp.z)];
      // 회전목마 + 천막 + 풍선: 대관람차 둘레
      const ring = (n, d) => Array.from({ length: n }, (_, k) => [sp.x + Math.cos((k / n) * TAU + 0.4) * d, sp.z + Math.sin((k / n) * TAU + 0.4) * d]);
      let placed = 0;
      for (const [x, z] of ring(5, 42)) {
        if (!okSpot(x, z, 7, 14, 30)) continue;
        const y = gY(x, z);
        if (placed === 0) {
          const cg = new THREE.Group();
          cg.name = 'starterCarousel';
          const baseM = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.8, 0.8, 20), new THREE.MeshLambertMaterial({ color: '#ffe9b0' }));
          baseM.position.y = 0.4;
          const roof = new THREE.Mesh(new THREE.ConeGeometry(7.2, 3.6, 20), new THREE.MeshLambertMaterial({ color: '#ff5f8f', flatShading: true }));
          roof.position.y = 6.2;
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 5, 10), new THREE.MeshLambertMaterial({ color: '#ffd23f' }));
          pole.position.y = 3;
          const horses = [];
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * TAU;
            horses.push(new THREE.BoxGeometry(0.6, 1.1, 1.8).translate(Math.cos(a) * 4.8, 2.0, Math.sin(a) * 4.8), new THREE.CylinderGeometry(0.06, 0.06, 4.4, 4).translate(Math.cos(a) * 4.8, 3.0, Math.sin(a) * 4.8));
          }
          const hm = new THREE.Mesh(mergeGeos(horses), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
          cg.add(baseM, roof, pole, hm);
          add(cg, x, y - 0.1, z, 0);
          animators.push((t) => (cg.rotation.y = t * 0.5));
          circle(x, z, 7, y, y + 8);
          occupy(x, z, 9);
        } else {
          const tg = new THREE.Group();
          const col = pick(['#ff5f5f', '#3fa9ff', '#ffd23f', '#5fdc8f']);
          const wall = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 3, 12), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
          wall.position.y = 1.5;
          const roof = new THREE.Mesh(new THREE.ConeGeometry(5, 3.8, 12), new THREE.MeshLambertMaterial({ color: col, flatShading: true }));
          roof.position.y = 4.9;
          tg.add(wall, roof);
          add(tg, x, y - 0.1, z, R(0, TAU));
          circle(x, z, 4.5, y, y + 7);
          occupy(x, z, 6);
        }
        placed++;
      }
    }
  }

  lap('before:마지막');
  // ---------------------------------------------------------------- 마지막 코너 무지개 불빛 아치 터널
  if (data.sections && data.sections.FIN) {
    const [fa, fb] = data.sections.FIN;
    const n = 7;
    const arches = [];
    const bulbs = [];
    const archGeos = [];
    for (let k = 0; k < n; k++) {
      const t = (fa + ((fb - fa + 1) % 1) * ((k + 0.5) / n)) % 1;
      const s = track.sampleAt(t);
      const wl = edgeLat(s.i, -1) + 4.2, wr = edgeLat(s.i, 1) + 4.2; // 다리는 연석 끝에서 4 m 넘게 밖 (안쪽을 넓게 도는 차가 안 걸리게)
      const pl = track.surf(s, -wl, 0, new THREE.Vector3()), pr = track.surf(s, wr, 0, new THREE.Vector3());
      const mid = pl.clone().add(pr).multiplyScalar(0.5);
      const half = pl.distanceTo(pr) / 2;
      const H = 8.5;
      const pts = [];
      for (let q = 0; q <= 24; q++) {
        const u = q / 24, a = Math.PI * u;
        const lx = -Math.cos(a) * half, ly = Math.sin(a) * H;
        pts.push(new THREE.Vector3().copy(mid).addScaledVector(s.right, lx).setY(mid.y + ly + (u < 0.5 ? (pl.y - mid.y) * (1 - 2 * u) : (pr.y - mid.y) * (2 * u - 1))));
      }
      archGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.5, 8, false));
      for (let q = 1; q < 24; q += 1) bulbs.push({ p: pts[q].clone().addScaledVector(s.tan, -0.55), k, q });
      for (const p of [pl, pr]) circle(p.x, p.z, 0.6, p.y - 1, p.y + 9);
      arches.push(s);
    }
    // 아치마다 무지개 색 → 꼭짓점 색으로 구워 메시 하나 (그림 호출 1번)
    const colored = archGeos.map((g, k) => {
      const col = new THREE.Color().setHSL(k / n, 0.85, 0.55);
      const ng = g.toNonIndexed();
      const cc = new Float32Array(ng.attributes.position.count * 3);
      for (let q = 0; q < cc.length; q += 3) cc.set([col.r, col.g, col.b], q);
      ng.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      return ng;
    });
    const mg = mergeGeos(colored);
    let off = 0;
    const allC = new Float32Array(mg.attributes.position.count * 3);
    for (const g of colored) (allC.set(g.attributes.color.array, off), (off += g.attributes.color.array.length));
    mg.setAttribute('color', new THREE.BufferAttribute(allC, 3));
    group.add(new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1, emissive: '#222222' })));
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 8, 5), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), bulbs.length);
    im.name = 'starterArchBulbs';
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    bulbs.forEach((b, i) => im.setMatrixAt(i, m4.makeTranslation(b.p.x, b.p.y, b.p.z)));
    im.computeBoundingSphere();
    group.add(im);
    animators.push((time) => {
      bulbs.forEach((b, i) => {
        const wave = Math.sin(time * 6 - b.k * 0.9) * 0.5 + 0.5;
        c.setHSL(((b.q / 24 + time * 0.08) % 1), 1, 0.45 + wave * 0.25);
        im.setColorAt(i, c);
      });
      im.instanceColor.needsUpdate = true;
    });
    stats.finArches = n;
  }

  lap('before:언덕');
  // ---------------------------------------------------------------- 언덕 위 풍차·집 (먼 곳)
  for (let k = 0, w = 0, h = 0; k < 400 && (w < 6 || h < 10); k++) {
    const a = R(0, TAU), d = R(170, 330);
    const x = cx + Math.cos(a) * d * 1.35, z = cz + Math.sin(a) * d * 1.35;
    if (!okSpot(x, z, 7, 40, 50)) continue;
    const y = gY(x, z);
    if (w < 6 && rand() < 0.45) {
      const wm = A.windmill({ color: pick(['#e8463a', '#2e6fd8', '#ff8a1f', '#19b3a6']) });
      wm.obj.name = 'starterWindmill';
      add(wm.obj, x, y - 0.2, z, Math.atan2(cx - x, cz - z) + R(-0.4, 0.4));
      anim(wm);
      circle(x, z, 3.8, y, y + 20);
      occupy(x, z, 12);
      w++;
    } else if (h < 10) {
      const c = A.cottage({ wall: pick(['#fff3d6', '#ffe0e0', '#e0f0ff', '#e8ffe0']), roof: pick(['#e8463a', '#2e6fd8', '#7a3cff', '#ff8a1f']) });
      add(c.obj, x, y - 0.2, z, R(0, TAU));
      circle(x, z, 4.2, y, y + 9);
      occupy(x, z, 8);
      h++;
    }
  }

  lap('before:나무·꽃');
  // ---------------------------------------------------------------- 나무·꽃 (인스턴스)
  const flora = createFlora();
  let nTree = 0, nLow = 0;
  const TREES = 520, LOW = 240; // 삼각형: 나무 한 그루 약 100~420, 꽃·덤불 약 320 → 다른 맵보다 가볍게
  for (let k = 0; k < 9000 && (nTree < TREES || nLow < LOW); k++) {
    const x = R(tb.min.x + 30, tb.max.x - 30), z = R(tb.min.y + 30, tb.max.y - 30);
    if (wet(x, z, 3)) continue;
    const rc = roadClear(x, z);
    const y = gY(x, z);
    if (y < 0.8) continue;
    const near = rc < 70;
    const skyD = sky(x, z).d;
    if (nTree < TREES && rc > 9 && skyD > 32 && free(x, z, 2)) {
      // 숲 덩어리: 잡음이 큰 곳에 몰림, 길가는 드문드문
      const dens = noise(x / 90, z / 90, 2);
      if (dens < (near ? 0.1 : -0.15)) continue;
      // 가까운 나무는 둥근 나무·벚꽃, 먼 나무는 가벼운 전나무 (삼각형 약 100)
      const type = rc > 80 ? (rand() < 0.8 ? 'pine' : 'round') : rand() < 0.5 ? 'round' : rand() < 0.45 ? 'pine' : 'blossom';
      const s = R(0.8, 1.35);
      flora.add(type, x, y - 0.2, z, s, R(0, TAU));
      if (rc < 45) circle(x, z, 0.65 * s, y, y + 9 * s);
      nTree++;
    } else if (nLow < LOW && rc > 3.5 && rc < 70) {
      const type = rand() < 0.4 ? 'flowers' : rand() < 0.6 ? 'bush' : 'rock';
      flora.add(type, x, y - 0.1, z, R(0.8, 1.5), R(0, TAU));
      if (type === 'rock' && rc < 30) circle(x, z, 1.2, y, y + 1.6);
      nLow++;
    }
  }
  flora.build(group);
  stats.trees = nTree;
  stats.low = nLow;

  lap('before:완주');
  // ---------------------------------------------------------------- 완주 꽃가루 (결승선 위, 결승하면 4초)
  {
    const N = 600;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = [];
    const cl = new THREE.Color();
    for (let k = 0; k < N; k++) {
      cl.setHSL(rand(), 0.9, 0.6);
      col.set([cl.r, cl.g, cl.b], k * 3);
      vel.push([R(-6, 6), R(6, 16), R(-6, 6)]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true }));
    pts.name = 'starterConfetti';
    pts.visible = false;
    pts.frustumCulled = false;
    group.add(pts);
    let tBurst = -1, lastPhase = null;
    const top = s0.pos.clone().setY(s0.pos.y + 9);
    animators.push((time, dt) => {
      const race = window.game && window.game.race;
      const ph = race && race.phase;
      if (ph === 'finished' && lastPhase === 'racing') tBurst = 0;
      lastPhase = ph;
      if (tBurst < 0) return;
      tBurst += dt || 0.016;
      if (tBurst > 4.5) {
        tBurst = -1;
        pts.visible = false;
        return;
      }
      pts.visible = true;
      for (let k = 0; k < N; k++) {
        const v = vel[k], t = tBurst;
        pos[k * 3] = top.x + v[0] * t + Math.sin(t * 3 + k) * 0.4;
        pos[k * 3 + 1] = top.y + v[1] * t - 4.9 * 0.35 * t * t;
        pos[k * 3 + 2] = top.z + v[2] * t;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- 충돌
  function collideCar(car) {
    stamp++;
    const cx0 = Math.floor((car.pos.x - CAR_R) / CELL), cx1 = Math.floor((car.pos.x + CAR_R) / CELL);
    const cz0 = Math.floor((car.pos.z - CAR_R) / CELL), cz1 = Math.floor((car.pos.z + CAR_R) / CELL);
    for (let x = cx0; x <= cx1; x++)
      for (let z = cz0; z <= cz1; z++) {
        const list = grid.get(`${x},${z}`);
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

  lap('before:빌려');
  // ---------------------------------------------------------------- 빌려 온 그랑프리 모델의 글자를 변신 연습장 글자로 (한 페이지에 맵 하나라 공유 그림을 바꿔도 됨)
  const painted = new Set();
  const fitText = (c, text, maxW, size, weight = 900) => {
    let fs = size;
    do c.font = `${weight} ${fs}px ${FONT}`;
    while (c.measureText(text).width > maxW && (fs -= 2) > 10);
  };
  group.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      const img = m.map && m.map.image;
      if (!img || !img.getContext || painted.has(img)) continue;
      const c = img.getContext('2d'), w = img.width, h = img.height;
      let done = true;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if (w === 1024 && h === 112) {
        // 출발 게이트 큰 배너
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#e8463a';
        c.fillRect(0, 0, w, 10);
        c.fillRect(0, h - 10, w, 10);
        fitText(c, 'TRANSFORM PARK · 변신 연습장', w * 0.86, 70);
        c.fillStyle = '#1d2433';
        c.fillText('TRANSFORM PARK · 변신 연습장', w / 2, h / 2 + 3);
      } else if (w === 128 && h === 768) {
        // 게이트 다리 (세로 글자)
        c.fillStyle = '#e8463a';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, 10, h);
        c.fillRect(w - 10, 0, 10, h);
        c.save();
        c.translate(w / 2, h / 2);
        c.rotate(-Math.PI / 2);
        fitText(c, 'TRANSFORM', h * 0.85, 86);
        c.fillText('TRANSFORM', 0, 4);
        c.restore();
      } else if (w === 1024 && h === 128) {
        // 관중석 광고 띠
        const blocks = [['#e8463a', '#ffffff', 'TRANSFORM PARK'], ['#ffffff', '#2e6fd8', '변신 연습장'], ['#ffd23f', '#1d2433', '배 · 비행 · 점프'], ['#19b3a6', '#ffffff', 'FIRST RACE']];
        const bw = w / blocks.length;
        blocks.forEach(([bg, fg, text], i) => {
          c.fillStyle = bg;
          c.fillRect(i * bw, 0, bw, h);
          c.fillStyle = fg;
          fitText(c, text, bw * 0.86, 60);
          c.fillText(text, i * bw + bw / 2, h / 2 + 4);
        });
      } else if (w === 1024 && h === 200) {
        // 피트 건물 간판
        c.fillStyle = '#2e6fd8';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = '#ffffff';
        c.lineWidth = 10;
        c.strokeRect(14, 14, w - 28, h - 28);
        c.fillStyle = '#ffffff';
        fitText(c, 'TRANSFORM PARK', w * 0.8, 110);
        c.fillText('TRANSFORM PARK', w / 2, h * 0.42);
        c.fillStyle = '#ffd23f';
        fitText(c, '변신 연습장 · PIT LANE', w * 0.7, 40, 800);
        c.fillText('변신 연습장 · PIT LANE', w / 2, h * 0.8);
      } else done = false;
      if (done) {
        painted.add(img);
        m.map.needsUpdate = true;
      }
    }
  });

  // 움직이는 모델은 자기 좌표 안에서 먼저 묶는다. 세계 좌표 묶음에 섞이면
  // 첫 움직임마다 큰 묶음이 풀려 그림 호출과 로딩 때 만든 버퍼가 늘어난다.
  const movingNames = new Set(['starterWindsock', 'starterBalloon', 'starterAirship', 'starterFerris', 'starterCarousel']);
  group.traverse((o) => {
    if (movingNames.has(o.name)) moving.add(o);
    if (o.userData.keep) o.userData.noBatch = true; // 깃발처럼 정점을 바꾸는 부품
    if (o.isInstancedMesh && o.name && o.name.startsWith('starter')) o.userData.noBatch = true; // 움직이는 인스턴스 (부표·불빛·관람차 칸)는 묶지 않음 (나무 flora:*는 staticBatch가 400 m 칸으로 나눔)
  });
  const batching = new URLSearchParams(location.search).get('batch') !== '0';
  if (batching) {
    for (const root of moving) {
      const parents = [];
      root.traverse((o) => { if (!o.isMesh && !o.userData.keep) parents.push(o); });
      for (const parent of parents.reverse()) batchLocal(parent, { pbr: true });
      root.userData.noBatch = true;
    }
    // 짧은 연습장은 먼 장식도 함께 보이므로 120 m 대신 320 m 칸을 쓴다.
    // 충돌 원본은 유지하고, 그림 메시만 합친다.
    group.updateMatrixWorld(true);
    const cells = new Map(), candidates = [];
    group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.name || Array.isArray(o.material) || o.material.transparent || o.material.isShaderMaterial) return;
      for (let p = o; p && p !== group; p = p.parent) if (p.userData.noBatch || p.userData.keep || !p.visible) return;
      candidates.push(o);
    });
    for (const o of candidates) {
      const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      const key = `${Math.floor(p.x / 320)},${Math.floor(p.z / 320)}`;
      let cell = cells.get(key);
      if (!cell) { cell = new THREE.Group(); cell.name = 'starterStatic'; cells.set(key, cell); group.add(cell); }
      // 셀은 원점에 있으므로 이미 계산한 세계 행렬을 그대로 쓴다.
      // attach()로 조상 행렬을 메시마다 다시 계산하지 않는다.
      const matrix = o.matrixWorld.clone();
      cell.add(o);
      matrix.decompose(o.position, o.quaternion, o.scale);
    }
    for (const cell of cells.values()) {
      batchLocal(cell, { pbr: true });
      cell.userData.noBatch = true;
    }
    stats.staticCells = cells.size;
  }
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
    stats: Object.assign(stats, { colliders: allColliders.length, occupied: occupied.length, buildMs }),
  };
}

/** 여러 BufferGeometry를 하나로 (위치·노멀·uv만, 색 없음) */
function mergeGeos(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
