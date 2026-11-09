// 부딪히면 반응하는 물체들.
//   cone    고깔: 툭 튕겨 나감 (감속 거의 없음)
//   lamp    가로등: 넘어지며 날아감
//   crate   나무 상자 더미: 와르르 무너짐
//   barrel  빨간 드럼통: 폭발! 차가 하늘로 튀어 오름 (용암 협곡을 넘는 또 다른 길)
//   hay     건초 더미, fence 울타리
//   barricade 지름길 입구: 100 km/h(BREAK_SPEED) 이상으로 들이받으면 부서짐 (윙으로 넘어가도 됨)
//   cube    에너지 큐브: 파랑 = 윙 게이지, 초록 = 스파이크 게이지
//
// 스파이크 폼이나 부스트 중에는 부딪혀도 느려지지 않습니다.
import * as THREE from 'three';
import { seededRandom, canvasTexture, hazardTexture } from './track.js';
import { buildGrandPrixProps } from './gpProps.js';

const G = 26;
const CAR_R = 1.3;
const BREAK_SPEED = 100 / 3.6; // 바리케이드를 부술 수 있는 속도 (m/s)
const RESPAWN_AFTER = 14; // 흩어진 물체가 제자리로 돌아오기까지 (차가 멀리 있을 때)

export function buildProps(track, scene) {
  if (track.grandprix) return buildGrandPrixProps(track, scene); // 구름섬 그랑프리: 하늘 고리 등 (gpProps.js)
  const rand = seededRandom(777);
  const R = (a, b) => a + rand() * (b - a);
  const W = track.width;
  const group = new THREE.Group();
  scene.add(group);
  const props = [];
  const cubes = [];
  const tmp = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const features = track.data.features;

  // 벽이나 튜브가 있는 쪽에는 길가 소품을 두지 않음
  function edgeBlocked(t, side) {
    for (const f of features) {
      if (f.type !== 'tube' && f.type !== 'wall') continue;
      if (t < f.t0 - 0.006 || t > f.t1 + 0.006) continue;
      if (f.type === 'tube' || !f.side || f.side === side) return true;
    }
    return false;
  }
  const nearShortcut = (p, m = 4) => track.shortcut && track.shortcutDist(p) < track.shortcut.width / 2 + m;

  // ---------------------------------------------------------------- 모양
  const lambert = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });
  const shapes = {};
  {
    // 고깔
    const g = new THREE.Group();
    const stripe = canvasTexture(16, 64, (c, w, h) => {
      c.fillStyle = '#ff6a1a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      c.fillRect(0, h * 0.35, w, h * 0.18);
    });
    add(g, new THREE.ConeGeometry(0.38, 1, 12), new THREE.MeshLambertMaterial({ map: stripe }), 0, 0.5, 0);
    add(g, new THREE.BoxGeometry(0.9, 0.08, 0.9), lambert('#ff6a1a'), 0, 0.04, 0);
    shapes.cone = { obj: g, r: 0.5, h: 1, mass: 0.2, slow: 0.02 };
  }
  {
    // 가로등 (밑동 기준)
    const g = new THREE.Group();
    add(g, new THREE.CylinderGeometry(0.12, 0.18, 7, 6), lambert('#4a505a'), 0, 3.5, 0);
    add(g, new THREE.BoxGeometry(0.15, 0.15, 1.8), lambert('#4a505a'), 0, 6.9, 0.8);
    add(g, new THREE.BoxGeometry(0.5, 0.2, 0.8), lambert('#fff6cc', { emissive: '#fff0b0', emissiveIntensity: 0.8 }), 0, 6.8, 1.6);
    shapes.lamp = { obj: g, r: 0.45, h: 7, mass: 0.6, slow: 0.08, spin: 1.5 };
  }
  {
    const tex = canvasTexture(64, 64, (c, w, h) => {
      c.fillStyle = '#b3824e';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#7a5530';
      c.lineWidth = 6;
      c.strokeRect(3, 3, w - 6, h - 6);
      c.beginPath();
      c.moveTo(3, 3);
      c.lineTo(w - 3, h - 3);
      c.stroke();
    });
    const g = new THREE.Group();
    add(g, new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshLambertMaterial({ map: tex }), 0, 0.7, 0);
    shapes.crate = { obj: g, r: 0.9, h: 1.4, mass: 0.5, slow: 0.07 };
  }
  {
    const tex = canvasTexture(64, 64, (c, w, h) => {
      c.fillStyle = '#d92b2b';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffd21f';
      c.fillRect(0, h * 0.4, w, h * 0.2);
      c.fillStyle = '#111';
      c.font = 'bold 22px sans-serif';
      c.textAlign = 'center';
      c.fillText('!', w / 2, h * 0.57);
    });
    const g = new THREE.Group();
    add(g, new THREE.CylinderGeometry(0.6, 0.6, 1.5, 14), new THREE.MeshLambertMaterial({ map: tex, emissive: '#5a0000', emissiveIntensity: 0.4 }), 0, 0.75, 0);
    add(g, new THREE.CylinderGeometry(0.63, 0.63, 0.08, 14), lambert('#8a1a1a'), 0, 0.35, 0);
    add(g, new THREE.CylinderGeometry(0.63, 0.63, 0.08, 14), lambert('#8a1a1a'), 0, 1.15, 0);
    shapes.barrel = { obj: g, r: 0.75, h: 1.5, mass: 0.5, slow: 0, explode: true };
  }
  {
    const tex = canvasTexture(64, 64, (c, w, h) => {
      c.fillStyle = '#e2c25a';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(150,110,30,0.6)';
      for (let i = 0; i < 40; i++) {
        c.beginPath();
        const x = Math.random() * w, y = Math.random() * h;
        c.moveTo(x, y);
        c.lineTo(x + 8, y + 2);
        c.stroke();
      }
    });
    const g = new THREE.Group();
    add(g, new THREE.CylinderGeometry(0.85, 0.85, 1.6, 14).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }), 0, 0.85, 0);
    shapes.hay = { obj: g, r: 1.0, h: 1.7, mass: 0.8, slow: 0.1 };
  }
  {
    // 울타리 한 칸 (4m)
    const g = new THREE.Group();
    const wood = lambert('#f1ece2');
    for (const x of [-2, 2]) add(g, new THREE.BoxGeometry(0.2, 1.3, 0.2), wood, x, 0.65, 0);
    for (const y of [0.45, 0.95]) add(g, new THREE.BoxGeometry(4.2, 0.18, 0.1), wood, 0, y, 0);
    shapes.fence = { obj: g, r: 1.9, h: 1.3, mass: 0.3, slow: 0.04, wide: true };
  }
  function add(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // ---------------------------------------------------------------- 물체 만들기
  function spawn(type, x, z, yaw = 0, y = 0) {
    const shape = shapes[type];
    const obj = shape.obj.clone();
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    group.add(obj);
    const p = {
      type, obj, shape,
      home: { pos: obj.position.clone(), quat: obj.quaternion.clone() },
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      moving: false,
      hidden: false,
      displacedAt: -1,
      restY: y,
    };
    props.push(p);
    return p;
  }

  const sampleLat = (t, lateral) => {
    const s = track.sampleAt(((t % 1) + 1) % 1);
    return { s, x: s.pos.x + s.right.x * lateral, z: s.pos.z + s.right.z * lateral, yaw: Math.atan2(s.tan.x, s.tan.z) };
  };
  const step = (m) => m / track.length;
  // 아래 길가 소품과 큐브 위치는 연습 코스(data/track.json) 기준. 다른 코스(운동장 등)는 데이터의 cubes만 씀
  const mainCourse = !track.arena && !track.data.style;

  if (mainCourse) {
    // 가로등: 도시 구역 양쪽 길가
    for (let t = 0.86; t < 1.14; t += step(26)) {
      for (const side of [-1, 1]) {
        const tt = t % 1;
        if (edgeBlocked(tt, side)) continue;
        const p = sampleLat(tt, side * (W / 2 + 3.2));
        if (nearShortcut(tmp.set(p.x, 0, p.z), 3)) continue;
        spawn('lamp', p.x, p.z, p.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2)); // 팔이 도로 쪽
      }
    }

    // 고깔: 숲 구역 커브 바깥쪽에 줄지어
    {
      const N = track.samples.length;
      for (let i = Math.floor(0.12 * N); i < 0.35 * N; i += 6) {
        const a = track.samples[i].tan, b = track.samples[(i + 12) % N].tan;
        const turn = a.x * b.z - a.z * b.x; // 부호 = 커브 방향
        if (Math.abs(turn) < 0.06) continue;
        const outSide = turn > 0 ? -1 : 1; // 오른쪽으로 꺾이면 바깥은 왼쪽
        const t = i / N;
        if (edgeBlocked(t, outSide)) continue;
        const p = sampleLat(t, outSide * (W / 2 - 0.6));
        spawn('cone', p.x, p.z, p.yaw);
      }
    }
    // 고깔 슬라롬: 직선에 몇 줄
    for (const t of [0.15, 0.3]) {
      for (let k = 0; k < 5; k++) {
        const p = sampleLat(t + step(k * 7), (k % 2 ? 1 : -1) * 3);
        spawn('cone', p.x, p.z, p.yaw);
      }
    }

    // 나무 상자 더미: 바위 S자 구역 (벽이 없는 쪽 도로 위)
    function crateStack(t, lateral) {
      const p = sampleLat(t, lateral);
      const rx = p.s.right.x, rz = p.s.right.z;
      for (const o of [-0.75, 0.75]) spawn('crate', p.x + rx * o, p.z + rz * o, p.yaw);
      spawn('crate', p.x, p.z, p.yaw + 0.3, 1.4);
    }
    crateStack(0.37, 5.5);
    crateStack(0.405, 5.5);
    crateStack(0.445, -5.5);
    crateStack(0.49, -5.5);
    crateStack(0.2, -5);
    crateStack(0.68 + step(25), -5);

    // 드럼통: 화산 구역. 용암 앞 평지 차선의 드럼통을 들이받으면 용암을 넘을 수 있음
    const barrelSpots = [
      [0.573, -6.5], // 용암 바로 앞 왼쪽 차선: 들이받으면 용암 위로 날아감
      [0.635, 5], [0.638, 6.8], [0.645, -4], [0.658, -6.5],
    ];
    for (const [t, lat] of barrelSpots) {
      const p = sampleLat(t, lat);
      spawn('barrel', p.x, p.z, p.yaw);
    }

    // 건초 더미, 울타리: 농장 구역
    for (let t = 0.68; t < 0.88; t += step(40)) {
      const side = rand() < 0.5 ? -1 : 1;
      const p = sampleLat(t, side * (W / 2 + 1.5));
      if (nearShortcut(tmp.set(p.x, 0, p.z), 4)) continue;
      spawn('hay', p.x, p.z, p.yaw);
      if (rand() < 0.5) {
        const q = sampleLat(t + step(2.2), side * (W / 2 + 1.5));
        spawn('hay', q.x, q.z, q.yaw);
      }
    }
    for (let t = 0.665; t < 0.88; t += step(4.3)) {
      for (const side of [-1, 1]) {
        const p = sampleLat(t, side * (W / 2 + 5));
        if (nearShortcut(tmp.set(p.x, 0, p.z), 5)) continue;
        if (Math.floor(t / step(4.3)) % 9 === 0) continue; // 군데군데 빈틈
        spawn('fence', p.x, p.z, p.yaw + Math.PI / 2);
      }
    }
    // 지름길 위의 건초 더미 (피해 가거나 뚫고 가거나)
    if (track.shortcut) {
      const ss = track.shortcut.samples;
      for (const [u, lat] of [[0.3, -2.5], [0.36, 2.5], [0.7, 0], [0.78, -3]]) {
        const s = ss[Math.round(u * (ss.length - 1))];
        spawn('hay', s.pos.x + s.right.x * lat, s.pos.z + s.right.z * lat, Math.atan2(s.tan.x, s.tan.z) + Math.PI / 2);
      }
    }

  }
  // 테스트 맵: track.json의 props 목록대로 배치 (월드 좌표)
  //   { type, x, z, yaw }                       하나
  //   { type, line: [x0, z0, x1, z1], count, zig } 선을 따라 count개 (zig: 좌우 지그재그 폭)
  //   { type, grid: [x, z, 가로 개수, 세로 개수, 간격] }  격자 모양 무더기
  //   { type: 'crateStack', x, z, yaw }          나무 상자 3개 더미
  if (track.arena) {
    for (const e of track.data.props || []) {
      const yaw = ((e.yaw || 0) * Math.PI) / 180;
      if (e.type === 'crateStack') {
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        for (const o of [-0.75, 0.75]) spawn('crate', e.x + rx * o, e.z + rz * o, yaw);
        spawn('crate', e.x, e.z, yaw + 0.3, 1.4);
      } else if (e.line) {
        const [x0, z0, x1, z1] = e.line;
        const len = Math.hypot(x1 - x0, z1 - z0);
        const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
        const ly = Math.atan2(x1 - x0, z1 - z0) + yaw;
        for (let i = 0; i < e.count; i++) {
          const u = e.count === 1 ? 0 : i / (e.count - 1);
          const off = e.zig ? (i % 2 ? 1 : -1) * e.zig : 0;
          spawn(e.type, x0 + (x1 - x0) * u + nx * off, z0 + (z1 - z0) * u + nz * off, ly);
        }
      } else if (e.grid) {
        const [gx, gz, cx, cz, gap] = e.grid;
        for (let i = 0; i < cx; i++)
          for (let j = 0; j < cz; j++) spawn(e.type, gx + (i - (cx - 1) / 2) * gap, gz + (j - (cz - 1) / 2) * gap, yaw);
      } else spawn(e.type, e.x, e.z, yaw);
    }
  }

  // ---------------------------------------------------------------- 바리케이드
  const barricades = [];
  function makeBarricade(pos, tan, right, width) {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = Math.atan2(tan.x, tan.z);
    group.add(g);
    const hz = hazardTexture();
    const plankMat = new THREE.MeshLambertMaterial({ map: hz });
    const postMat = lambert('#6b4a2e');
    const pieces = [];
    for (const x of [-width / 2, width / 2]) add(g, new THREE.BoxGeometry(0.35, 2.4, 0.35), postMat, x, 1.2, 0);
    for (const y of [0.6, 1.3, 2.0]) pieces.push(add(g, new THREE.BoxGeometry(width, 0.42, 0.18), plankMat, 0, y, 0));
    // 간판
    const signTex = canvasTexture(256, 64, (c, w, h) => {
      c.fillStyle = '#2b2b2b';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffd21f';
      c.font = 'bold 26px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('💥 100 km/h 이상으로 돌파', w / 2, h / 2);
    });
    signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping;
    const sign = add(g, new THREE.BoxGeometry(5, 1.2, 0.1), new THREE.MeshLambertMaterial({ map: signTex }), 0, 3.1, -0.15);
    sign.rotation.y = Math.PI; // 다가오는 차 쪽을 향함
    // 부서진 조각 (평소엔 숨김)
    const debris = [];
    for (let i = 0; i < 9; i++) {
      const m = add(group, new THREE.BoxGeometry(width / 3, 0.42, 0.18), plankMat, 0, -50, 0);
      m.visible = false;
      debris.push({ obj: m, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    const b = {
      group: g, pieces, debris, sign, broken: false, brokenAt: 0,
      pos: pos.clone(), tan: tan.clone(), right: right.clone(), halfW: width / 2, h: 2.4,
      lastHint: -10,
    };
    barricades.push(b);
    return b;
  }
  if (track.shortcut) {
    const gate = track.shortcut.gate;
    makeBarricade(gate.pos, gate.tan, gate.right, track.shortcut.width + 2);
  }
  for (const e of track.data.barricades || []) {
    const yaw = ((e.yaw || 0) * Math.PI) / 180;
    const tan = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    makeBarricade(new THREE.Vector3(e.x, 0, e.z), tan, new THREE.Vector3().crossVectors(tan, UP).normalize(), e.width || 12);
  }
  const barricade = barricades[0] || null;

  // ---------------------------------------------------------------- 에너지 큐브
  const cubeGeo = new THREE.OctahedronGeometry(0.75, 0);
  const cubeMats = {
    wing: new THREE.MeshStandardMaterial({ color: '#5ad1ff', emissive: '#2aa8ff', emissiveIntensity: 1.2, roughness: 0.3 }),
    spike: new THREE.MeshStandardMaterial({ color: '#7dff6a', emissive: '#3bd62a', emissiveIntensity: 1.2, roughness: 0.3 }),
  };
  const ringGeo = new THREE.TorusGeometry(1.05, 0.06, 6, 24);
  // 2026-11-06: 윙/스파이크 충전이 없어져서(car.addCharge는 아무 일도 안 함) 큐브를 더 이상 놓지 않음.
  // 아래 배치 코드와 맵 데이터의 cubes 목록은 남겨 두지만 모두 무시됨
  const CUBES_ENABLED = false;
  function cube(kind, pos, normal = UP) {
    if (!CUBES_ENABLED) return;
    const g = new THREE.Group();
    g.position.copy(pos).addScaledVector(normal, 1.1);
    g.quaternion.setFromUnitVectors(UP, normal);
    const core = new THREE.Mesh(cubeGeo, cubeMats[kind]);
    g.add(core);
    const ring = new THREE.Mesh(ringGeo, cubeMats[kind]);
    g.add(ring);
    group.add(g);
    cubes.push({ kind, obj: g, core, ring, takenAt: -1, phase: rand() * 6 });
  }
  /** 도로 중심에서 dir 방향(오른쪽 ±, 위)으로 광선을 쏴서 벽이나 천장 면 위에 큐브 놓기 */
  function cubeOnSurface(kind, t, dirKind, side = 1) {
    const s = track.sampleAt(t);
    const origin = s.pos.clone().addScaledVector(UP, dirKind === 'ceiling' ? 3 : 5);
    const dir = dirKind === 'ceiling' ? UP.clone() : s.right.clone().multiplyScalar(side);
    const hit = track.castRay(origin, dir, 30);
    if (hit) cube(kind, hit.point, hit.normal);
  }
  const onRoad = (kind, t, lat) => {
    const p = sampleLat(t, lat);
    cube(kind, new THREE.Vector3(p.x, 0, p.z));
  };
  if (mainCourse) {
    // 튜브 천장 (윙), 바닥 지그재그 길 (스파이크)
    for (const t of [0.031, 0.065]) cubeOnSurface('wing', t, 'ceiling');
    onRoad('spike', 0.0375, 3.75);
    onRoad('spike', 0.0625, -3.75);
    // S자 벽 위 (윙), 안쪽 바닥 (스파이크)
    for (const t of [0.375, 0.405]) cubeOnSurface('wing', t, 'wall', -1);
    for (const t of [0.45, 0.49]) cubeOnSurface('wing', t, 'wall', 1);
    onRoad('spike', 0.39, 3);
    onRoad('spike', 0.47, -3);
    // 용암 협곡 양쪽 벽 (윙)
    cubeOnSurface('wing', 0.585, 'wall', -1);
    cubeOnSurface('spike', 0.59, 'wall', 1);
    // 숲, 농장 길 (번갈아)
    for (const [t, lat, kind] of [[0.16, -4, 'wing'], [0.22, 4, 'spike'], [0.28, 0, 'wing'], [0.72, 4, 'spike'], [0.8, -4, 'wing'], [0.86, 0, 'spike']]) onRoad(kind, t, lat);
    // 지름길 안 (스파이크 2개)
    if (track.shortcut) {
      const ss = track.shortcut.samples;
      for (const u of [0.45, 0.62]) cube('spike', ss[Math.round(u * (ss.length - 1))].pos.clone());
    }

  }
  // 데이터의 cubes: { kind, x, z } 바닥 위, { kind, t, lat } 코스 위치, 또는 { kind, ray: [x, y, z, dx, dy, dz] } 광선이 닿는 벽/천장 위
  {
    for (const e of track.data.cubes || []) {
      if (e.t !== undefined) onRoad(e.kind, e.t, e.lat || 0);
      else if (e.ray) {
        const [x, y, z, dx, dy, dz] = e.ray;
        const hit = track.castRay(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, dz).normalize(), 80);
        if (hit) cube(e.kind, hit.point, hit.normal);
      } else cube(e.kind, new THREE.Vector3(e.x, 0, e.z));
    }
  }

  // ---------------------------------------------------------------- 효과 (폭발, 파편)
  const fx = [];
  const fireMat = new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const smokeMat = new THREE.MeshBasicMaterial({ color: '#3a3533', transparent: true, depthWrite: false });
  const sparkGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
  const ballGeo = new THREE.IcosahedronGeometry(1, 1);
  function explosion(pos) {
    const fire = new THREE.Mesh(ballGeo, fireMat.clone());
    fire.position.copy(pos);
    group.add(fire);
    fx.push({ obj: fire, life: 0, dur: 0.5, kind: 'fire' });
    const smoke = new THREE.Mesh(ballGeo, smokeMat.clone());
    smoke.position.copy(pos);
    group.add(smoke);
    fx.push({ obj: smoke, life: 0, dur: 1.4, kind: 'smoke' });
    for (let i = 0; i < 16; i++) sparks(pos, '#ffcf3f', 1);
    const light = new THREE.PointLight('#ff9a3a', 60, 40, 2);
    light.position.copy(pos).setY(pos.y + 2);
    group.add(light);
    fx.push({ obj: light, life: 0, dur: 0.6, kind: 'light' });
  }
  function sparks(pos, color, n = 6) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color }));
      m.position.copy(pos);
      group.add(m);
      fx.push({ obj: m, life: 0, dur: R(0.5, 0.9), kind: 'spark', vel: new THREE.Vector3(R(-8, 8), R(4, 13), R(-8, 8)) });
    }
  }
  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life += dt;
      const k = f.life / f.dur;
      if (k >= 1) {
        group.remove(f.obj);
        if (f.obj.material) f.obj.material.dispose();
        fx.splice(i, 1);
        continue;
      }
      if (f.kind === 'fire') {
        f.obj.scale.setScalar(1 + k * 6);
        f.obj.material.opacity = 1 - k;
        f.obj.material.color.setHSL(0.1 - k * 0.08, 1, 0.6 - k * 0.2);
      } else if (f.kind === 'smoke') {
        f.obj.scale.setScalar(2 + k * 7);
        f.obj.position.y += dt * 4;
        f.obj.material.opacity = 0.6 * (1 - k);
      } else if (f.kind === 'light') {
        f.obj.intensity = 60 * (1 - k);
      } else {
        f.vel.y -= G * dt;
        f.obj.position.addScaledVector(f.vel, dt);
        f.obj.rotation.x += dt * 9;
        f.obj.rotation.z += dt * 7;
        f.obj.scale.setScalar(1 - k);
      }
    }
  }

  // ---------------------------------------------------------------- 갱신
  let time = 0;
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();

  function knock(p, car, extra = 1) {
    // 차의 속도 방향 + 바깥쪽으로 튕겨 나감
    const away = tmp.subVectors(p.obj.position, car.pos).setY(0);
    if (away.lengthSq() < 1e-4) away.copy(car.moveDir);
    away.normalize();
    const v = Math.max(8, car.vel.length());
    const m = p.shape.mass;
    p.vel.copy(car.vel).multiplyScalar(1.1 / (0.6 + m)).addScaledVector(away, v * 0.35 * extra).setY(R(5, 9) * extra / (0.5 + m));
    const s = p.shape.spin || 6;
    p.spin.set(R(-s, s), R(-s, s), R(-s, s));
    p.moving = true;
    p.displacedAt = time;
  }

  function hitCar(p, car, events) {
    const spike = car.form === 'spike';
    const strong = spike || car.boostTime > 0;
    if (p.shape.explode) {
      // 드럼통 폭발: 차가 위로 튀어 오름
      p.hidden = true;
      p.obj.visible = false;
      p.displacedAt = time;
      explosion(p.obj.position.clone().setY(1));
      const up = spike ? 13 : 17;
      if (car.grounded) {
        const v = car.moveDir.multiplyScalar(Math.max(car.speed * 1.2, 24));
        car.leaveGround(v.addScaledVector(UP, up));
      } else car.vel.y = Math.max(car.vel.y, up);
      // 주변 물체도 날려 버림
      for (const q of props) {
        if (q === p || q.hidden) continue;
        const d = q.obj.position.distanceTo(p.obj.position);
        if (d < 9) {
          q.vel.subVectors(q.obj.position, p.obj.position).setY(0).normalize().multiplyScalar(14).setY(12);
          q.spin.set(R(-8, 8), R(-8, 8), R(-8, 8));
          q.moving = true;
          q.displacedAt = time;
          if (q.shape.explode && d < 6) q.chain = 0.15; // 연쇄 폭발
        }
      }
      events.push('explode');
      return;
    }
    knock(p, car, strong ? 1.5 : 1);
    if (!strong && p.shape.slow > 0) {
      const k = 1 - p.shape.slow;
      car.speed *= k;
      car.vel.multiplyScalar(k);
    }
    sparks(p.obj.position.clone().setY(1), p.type === 'cone' ? '#ff6a1a' : p.type === 'hay' ? '#e2c25a' : '#b3824e', 4);
    events.push(p.type === 'cone' || p.type === 'fence' ? 'tap' : 'smash');
  }

  function update(dt, car) {
    time += dt;
    const events = car.events;
    for (const p of props) {
      // 연쇄 폭발 대기
      if (p.chain !== undefined && !p.hidden) {
        p.chain -= dt;
        if (p.chain <= 0) {
          p.chain = undefined;
          p.hidden = true;
          p.obj.visible = false;
          explosion(p.obj.position.clone().setY(1));
          events.push('explode');
          if (car.pos.distanceTo(p.obj.position) < 7) {
            if (car.grounded) car.leaveGround(car.moveDir.multiplyScalar(car.speed).addScaledVector(UP, 12));
            else car.vel.y = Math.max(car.vel.y, 12);
          }
        }
      }
      // 제자리 복귀
      if (p.displacedAt >= 0 && time - p.displacedAt > RESPAWN_AFTER && car.pos.distanceTo(p.home.pos) > 60) resetProp(p);
      if (p.hidden) continue;

      // 차와 충돌
      const o = p.obj.position;
      const dy = car.pos.y - o.y;
      if (dy > -1.2 && dy < p.shape.h) {
        let dx = car.pos.x - o.x, dz = car.pos.z - o.z;
        let hit;
        if (p.shape.wide && !p.moving) {
          // 울타리: 긴 막대 (로컬 x 방향)
          const yaw = p.obj.rotation.y;
          const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
          hit = Math.abs(lx) < 2.1 + CAR_R * 0.5 && Math.abs(lz) < 0.3 + CAR_R;
        } else hit = dx * dx + dz * dz < (p.shape.r + CAR_R) ** 2;
        // 이미 날아가는 물체는 다시 칠 때 약하게만
        if (hit && (!p.moving || p.vel.lengthSq() < 9)) hitCar(p, car, events);
      }

      if (!p.moving) continue;
      p.vel.y -= G * dt;
      o.addScaledVector(p.vel, dt);
      _q.setFromEuler(_e.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt));
      p.obj.quaternion.multiply(_q);
      if (o.y <= 0) {
        o.y = 0;
        if (p.vel.y < -3) {
          p.vel.y *= -0.35;
          p.vel.x *= 0.7;
          p.vel.z *= 0.7;
          p.spin.multiplyScalar(0.6);
        } else {
          p.vel.y = 0;
          p.vel.x *= Math.exp(-5 * dt);
          p.vel.z *= Math.exp(-5 * dt);
          p.spin.multiplyScalar(Math.exp(-6 * dt));
          if (p.vel.lengthSq() < 0.2) {
            p.moving = false;
          }
        }
      }
    }

    // 바리케이드
    for (const b of barricades) updateBarricade(b, dt, car, events);

    // 에너지 큐브
    for (const c of cubes) {
      if (c.takenAt >= 0) {
        if (time - c.takenAt > 10) {
          c.takenAt = -1;
          c.obj.visible = true;
        } else continue;
      }
      if (c.obj.position.distanceToSquared(car.pos) < 2.6 * 2.6) {
        c.takenAt = time;
        c.obj.visible = false;
        car.addCharge(c.kind, 0.34);
        sparks(c.obj.position, c.kind === 'wing' ? '#5ad1ff' : '#7dff6a', 10);
        events.push(c.kind === 'wing' ? 'pickupWing' : 'pickupSpike');
      }
    }
    updateFx(dt);
  }

  function updateBarricade(b, dt, car, events) {
    if (b.broken) {
      for (const d of b.debris) {
        if (!d.obj.visible) continue;
        d.vel.y -= G * dt;
        d.obj.position.addScaledVector(d.vel, dt);
        d.obj.rotation.x += d.spin.x * dt;
        d.obj.rotation.y += d.spin.y * dt;
        if (d.obj.position.y < 0.2) {
          d.obj.position.y = 0.2;
          d.vel.multiplyScalar(0.5);
          d.vel.y = Math.abs(d.vel.y) > 2 ? -d.vel.y * 0.3 : 0;
          d.spin.multiplyScalar(0.5);
        }
      }
      if (time - b.brokenAt > 12 && car.pos.distanceTo(b.pos) > 35) {
        b.broken = false;
        b.pieces.forEach((m) => (m.visible = true));
        b.debris.forEach((d) => (d.obj.visible = false));
      }
      return;
    }
    if (car.pos.y > b.h) return; // 윙으로 넘어감
    tmp.subVectors(car.pos, b.pos);
    const along = tmp.dot(b.tan), side = tmp.dot(b.right);
    if (Math.abs(side) > b.halfW + 0.5 || Math.abs(along) > CAR_R + 0.2) return;
    // 빠르게(BREAK_SPEED 이상) 들이받으면 부서짐 (예전엔 부스터·부스트로만)
    const strong = car.form === 'spike' || car.boostTime > 0 || car.speed >= BREAK_SPEED;
    if (strong) {
      b.broken = true;
      b.brokenAt = time;
      b.pieces.forEach((m) => (m.visible = false));
      const fwd = car.vel.clone().setY(0).normalize();
      b.debris.forEach((d, i) => {
        const row = Math.floor(i / 3), col = (i % 3) - 1;
        d.obj.visible = true;
        d.obj.position.copy(b.pos).addScaledVector(b.right, col * (b.halfW * 2) / 3).setY(0.6 + row * 0.7);
        d.obj.quaternion.copy(b.group.quaternion);
        d.vel.copy(fwd).multiplyScalar(R(12, 22)).addScaledVector(b.right, col * R(3, 7)).setY(R(5, 11));
        d.spin.set(R(-9, 9), R(-9, 9), 0);
      });
      sparks(b.pos.clone().setY(1.2), '#ffd21f', 14);
      events.push('barricade');
      return;
    }
    // 막힘: 밀어내기
    const n = b.tan.clone().multiplyScalar(along >= 0 ? 1 : -1);
    car.applyPush(n, CAR_R + 0.2 - Math.abs(along));
    if (time - b.lastHint > 2.5) {
      b.lastHint = time;
      events.push('barricadeBlocked');
    }
  }

  function resetProp(p) {
    p.obj.position.copy(p.home.pos);
    p.obj.quaternion.copy(p.home.quat);
    p.vel.set(0, 0, 0);
    p.spin.set(0, 0, 0);
    p.moving = false;
    p.hidden = false;
    p.chain = undefined;
    p.obj.visible = true;
    p.displacedAt = -1;
  }

  function reset() {
    props.forEach(resetProp);
    for (const c of cubes) {
      c.takenAt = -1;
      c.obj.visible = true;
    }
    for (const b of barricades) {
      b.broken = false;
      b.pieces.forEach((m) => (m.visible = true));
      b.debris.forEach((d) => (d.obj.visible = false));
    }
  }

  /** 화면 연출 (프레임마다): 큐브 회전 */
  function animate(t) {
    for (const c of cubes) {
      if (!c.obj.visible) continue;
      c.core.rotation.y = t * 2 + c.phase;
      c.core.position.y = Math.sin(t * 3 + c.phase) * 0.25;
      c.ring.rotation.x = Math.PI / 2 + Math.sin(t * 1.7 + c.phase) * 0.4;
      c.ring.rotation.y = t * 1.3;
    }
  }

  return { update, reset, animate, props, cubes, barricade, barricades, stats: { props: props.length, cubes: cubes.length } };
}
