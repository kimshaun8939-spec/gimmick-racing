// 네온 시티 소품·생동감 (round 2)
//
//   - 부딪히면 날아가는 소품: 코너 바깥 넓은 갓길에 네온 라바콘·빛나는 상자 더미·빛 기둥 (글리치 차원엔 데이터 큐브)
//       차(플레이어·봇 모두)가 닿으면 튕겨 날아가고 차는 아주 조금만 느려짐. 레이싱 라인 위에는 없음
//       예전 위치로 되돌리기: reset() (다시 시작할 때)
//   - 배달 드론: 도시 구간 위를 오가는 드론 (깜빡이는 불빛, 빛나는 소포)
//   - 결승선 홀로그램 쇼: 게이트 위 큰 홀로그램 전광판 (LAP 1/2 · 마지막 바퀴! · 결승!), 돌아가는 홀로그램 트로피, 레이저, 불꽃놀이
//   - 길가 관중: 코너 벽 뒤에서 응원 (일부는 뛰고, 야광봉)
// 모두 인스턴스 메시라 그리기 호출이 적음 (약 16개). 글리치 차원에 있을 땐 도시 쪽은 숨김
import * as THREE from 'three';
import { seededRandom, canvasTexture } from './neonTrack.js';
import { NEON, hologramMaterial, glowTexture } from './neonAssets.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3();

export function buildNeonProps(track, scene) {
  const rand = seededRandom(4242);
  const R = (a, b) => a + rand() * (b - a);
  const N = track.sampleCount, S = track.samples, L = track.length;
  const HW = track.width / 2;
  const mS = (m) => Math.max(1, Math.round((m / L) * N));
  const city = new THREE.Group(); // 도시 쪽 (글리치 차원에선 숨김)
  const glitchG = new THREE.Group(); // 글리치 차원 쪽
  glitchG.visible = false;
  const root = new THREE.Group();
  root.name = 'neonProps';
  root.add(city, glitchG);
  scene.add(root);
  const anim = []; // (t, dt) => {}

  // ================================================================ 1. 부딪히면 날아가는 소품
  const TYPES = {
    cone: { r: 0.45, loss: 0.006, h: 0.75, mass: 1 },
    crate: { r: 0.8, loss: 0.018, h: 1.1, mass: 3 },
    post: { r: 0.4, loss: 0.008, h: 1.2, mass: 1.5 },
    cube: { r: 0.7, loss: 0.012, h: 1.0, mass: 2 },
  };
  const items = [];
  const add = (type, s, lat, dLong, yOff = 0, yaw = 0) => {
    const p = track.surf(s, lat, 0, new THREE.Vector3());
    p.addScaledVector(s.tan, dLong);
    items.push({ type, home: p.clone(), homeY: yOff, homeYaw: yaw, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), av: new THREE.Vector3(), state: 0, rest: 0, scale: 1, glitch: !!s.glitch, idx: 0, groundY: p.y });
  };
  {
    const step = mS(11);
    let k = 0;
    for (let i = 0; i < N; i += step) {
      const s = S[i];
      if (track.tubeK && track.tubeK[i] > 0.01) continue;
      for (const side of [-1, 1]) {
        const inner = HW + track.kerbAt(i, side) + 2.6; // 넓은 연석 바깥 + 여유 (라인을 따라 달리면 안 닿음)
        const outer = track.railLatOf(s, side) - 0.7;
        if (outer - inner < 1.0) continue; // 갓길이 넓은 곳(코너 바깥·착지 구간)만
        k++;
        if (k % 2) continue; // 너무 빽빽하지 않게
        const lat = side * (inner + rand() * (outer - inner));
        const yaw = Math.atan2(s.tan.x, s.tan.z);
        if (s.glitch) {
          add('cube', s, lat, 0, 0, R(0, 6));
          if (rand() < 0.5) add('cube', s, lat, 0, 1.0, R(0, 6));
          continue;
        }
        const pick = rand();
        if (pick < 0.45) {
          // 라바콘 3개 (삼각형)
          add('cone', s, lat, 0);
          add('cone', s, lat + side * 0.75, 0.7);
          add('cone', s, lat + side * 0.75, -0.7);
        } else if (pick < 0.75) {
          // 상자 더미 (아래 2 + 위 1)
          add('crate', s, lat, -0.6, 0, yaw + R(-0.2, 0.2));
          add('crate', s, lat, 0.6, 0, yaw + R(-0.2, 0.2));
          add('crate', s, lat, 0, 1.1, yaw + R(-0.5, 0.5));
        } else {
          // 빛 기둥 줄 (4개)
          for (let q = -1.5; q <= 1.5; q++) add('post', s, lat, q * 1.6);
        }
      }
    }
  }
  // 모양·재질
  const coneTex = canvasTexture(16, 64, (g, w, h) => {
    g.fillStyle = '#ff5a12';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.fillRect(0, h * 0.28, w, h * 0.12);
    g.fillRect(0, h * 0.55, w, h * 0.1);
  });
  const crateTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#16131f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2ff3ff';
    g.lineWidth = 7;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.strokeStyle = 'rgba(255,47,142,0.9)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(10, 10);
    g.lineTo(w - 10, h - 10);
    g.stroke();
    g.fillStyle = '#ffe23a';
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'center';
    g.fillText('NEO', w / 2, h / 2 + 34);
  });
  const cubeTex = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#12001e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff5cf0';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = 'rgba(47,243,255,0.8)';
    for (let k = 0; k < 6; k++) g.fillRect((k * 23) % 50 + 8, (k * 37) % 50 + 8, 6, 6);
  });
  const geos = {
    cone: new THREE.ConeGeometry(0.3, 0.75, 10, 1).translate(0, 0.375, 0),
    crate: new THREE.BoxGeometry(1.1, 1.1, 1.1).translate(0, 0.55, 0),
    post: new THREE.CylinderGeometry(0.16, 0.2, 1.2, 8).translate(0, 0.6, 0),
    cube: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  };
  const mats = {
    cone: new THREE.MeshStandardMaterial({ map: coneTex, emissiveMap: coneTex, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.5 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTex, emissiveMap: crateTex, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.6 }),
    post: new THREE.MeshStandardMaterial({ color: '#1a1d28', emissive: '#2ff3ff', emissiveIntensity: 1.3, roughness: 0.4 }),
    cube: new THREE.MeshStandardMaterial({ map: cubeTex, emissiveMap: cubeTex, emissive: '#ffffff', emissiveIntensity: 1.2, roughness: 0.3 }),
  };
  const meshes = {};
  for (const type of Object.keys(TYPES)) {
    const list = items.filter((it) => it.type === type);
    if (!list.length) continue;
    const m = new THREE.InstancedMesh(geos[type], mats[type], list.length);
    list.forEach((it, k) => (it.idx = k));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // 날아간 소품이 경계 밖으로 나가도 안 사라지게
    (type === 'cube' ? glitchG : city).add(m);
    meshes[type] = m;
  }
  const writeItem = (it) => {
    _e.copy(it.rot);
    _q.setFromEuler(_e);
    _s.setScalar(Math.max(0.001, it.scale));
    _m.compose(it.pos, _q, _s);
    meshes[it.type].setMatrixAt(it.idx, _m);
    meshes[it.type].instanceMatrix.needsUpdate = true;
  };
  function resetItems() {
    for (const it of items) {
      it.pos.copy(it.home);
      it.pos.y += it.homeY;
      it.vel.set(0, 0, 0);
      it.av.set(0, 0, 0);
      it.rot.set(0, it.homeYaw, 0);
      it.state = 0;
      it.rest = 0;
      it.scale = 1;
      writeItem(it);
    }
    flying.length = 0;
  }
  // 빠른 찾기: 10 m 칸
  const CELL = 10;
  const grid = new Map();
  const key = (x, z) => Math.floor(x / CELL) * 73856 + Math.floor(z / CELL);
  for (const it of items) {
    const k = key(it.home.x, it.home.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(it);
  }
  const flying = [];
  // 부딪힘 불꽃 (작은 빛 알갱이)
  const SPARKS = 160;
  const spPos = new Float32Array(SPARKS * 3), spVel = new Float32Array(SPARKS * 3), spLife = new Float32Array(SPARKS);
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: 0.35, map: glowTexture(), color: '#ffd37a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false;
  root.add(sparks);
  let spNext = 0, sparkAlive = 0;
  for (let i = 0; i < SPARKS; i++) spPos[i * 3 + 1] = -9999;
  function burst(p, n) {
    for (let k = 0; k < n; k++) {
      const i = spNext;
      spNext = (spNext + 1) % SPARKS;
      spPos[i * 3] = p.x;
      spPos[i * 3 + 1] = p.y + 0.5;
      spPos[i * 3 + 2] = p.z;
      spVel[i * 3] = R(-5, 5);
      spVel[i * 3 + 1] = R(2, 7);
      spVel[i * 3 + 2] = R(-5, 5);
      spLife[i] = R(0.3, 0.7);
    }
    sparkAlive = 1;
  }

  // 부딪힘 소리 (플레이어 차만): 라바콘 = 통, 상자 = 쿵. N 키·설정 음소거로 같이 꺼짐 (audioMix가 효과음 크기 조절)
  let actx = null, muted = false, lastSnd = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyN') muted = !muted;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } else if (actx.state === 'suspended') actx.resume();
  });
  function thunk(type, speed) {
    if (!actx || muted || actx.state !== 'running') return;
    try {
      const st = window.game && window.game.settings && window.game.settings.values;
      if (st && st.muted) return;
    } catch {}
    const t0 = actx.currentTime;
    if (t0 - lastSnd < 0.05) return; // 한꺼번에 여러 개면 한 번만
    lastSnd = t0;
    const heavy = type === 'crate' || type === 'cube';
    const len = Math.floor(actx.sampleRate * 0.25);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (actx.sampleRate * (heavy ? 0.06 : 0.025)));
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = heavy ? 'lowpass' : 'bandpass';
    f.frequency.value = heavy ? 420 : 1300;
    f.Q.value = heavy ? 0.8 : 4;
    const g = actx.createGain();
    g.gain.value = Math.min(0.5, 0.12 + speed / 120);
    src.connect(f).connect(g).connect(actx.destination);
    src.start(t0);
    if (heavy) {
      const o = actx.createOscillator();
      o.frequency.setValueAtTime(120, t0);
      o.frequency.exponentialRampToValueAtTime(45, t0 + 0.15);
      const og = actx.createGain();
      og.gain.setValueAtTime(0.25, t0);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(og).connect(actx.destination);
      o.start(t0);
      o.stop(t0 + 0.2);
    }
  }

  /** 차 하나와 소품 부딪힘 (main.js / raceSystem이 scenery.collideCar(car)로 플레이어·봇 모두 부름) */
  function hit(car) {
    if (!items.length) return;
    const glitchSide = !!track.inGlitch;
    const cx = car.pos.x, cz = car.pos.z;
    const sp = Math.abs(car.speed || 0);
    if (sp < 2) return;
    const fx = Math.floor(cx / CELL), fz = Math.floor(cz / CELL);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const list = grid.get((fx + a) * 73856 + (fz + b));
        if (!list) continue;
        for (const it of list) {
          if (it.state !== 0 || it.glitch !== glitchSide) continue;
          const T = TYPES[it.type];
          const dx = it.pos.x - cx, dz = it.pos.z - cz;
          const rr = T.r + 1.0;
          if (dx * dx + dz * dz > rr * rr || Math.abs(it.pos.y - it.homeY - car.pos.y) > 2.2) continue;
          // 날아감: 차 속도 방향 + 옆으로 비켜 + 위로
          const v = car.vel && car.vel.lengthSq() > 1 ? _v.copy(car.vel) : _v.copy(car.fwd).multiplyScalar(car.speed);
          const d = Math.hypot(dx, dz) || 1;
          const k = 1.25 / Math.sqrt(T.mass);
          it.vel.set(v.x * k + (dx / d) * sp * 0.25, R(3, 6) + sp * 0.12 / T.mass, v.z * k + (dz / d) * sp * 0.25);
          it.av.set(R(-12, 12), R(-8, 8), R(-12, 12)).multiplyScalar(1 / T.mass);
          it.state = 1;
          it.rest = 0;
          flying.push(it);
          // 차는 아주 조금만 느려짐
          const f = 1 - T.loss * Math.min(1, sp / 30);
          car.speed *= f;
          if (car.vel) car.vel.multiplyScalar(f);
          burst(it.pos, it.type === 'cone' ? 4 : 8);
          if (window.game && car === window.game.car) thunk(it.type, sp);
        }
      }
  }
  function updateItems(dt) {
    for (let n = flying.length - 1; n >= 0; n--) {
      const it = flying[n];
      if (it.state === 1) {
        it.vel.y -= 9.81 * dt;
        it.pos.addScaledVector(it.vel, dt);
        it.rot.x += it.av.x * dt;
        it.rot.y += it.av.y * dt;
        it.rot.z += it.av.z * dt;
        if (it.pos.y < it.groundY && it.vel.y < 0) {
          it.pos.y = it.groundY;
          it.vel.y *= -0.35;
          it.vel.x *= 0.55;
          it.vel.z *= 0.55;
          it.av.multiplyScalar(0.5);
          if (Math.abs(it.vel.y) < 1 && it.vel.x * it.vel.x + it.vel.z * it.vel.z < 1.5) {
            it.state = 2;
            it.rot.x = Math.round(it.rot.x / (Math.PI / 2)) * (Math.PI / 2); // 옆으로 누운 채 멈춤
            it.rot.z = Math.round(it.rot.z / (Math.PI / 2)) * (Math.PI / 2);
          }
        }
      } else {
        // 멈춘 뒤 5초 지나면 작아지며 사라짐 (다시 시작하면 제자리)
        it.rest += dt;
        if (it.rest > 5) it.scale = Math.max(0, 1 - (it.rest - 5) / 0.6);
        if (it.scale <= 0) {
          it.state = 3;
          flying.splice(n, 1);
        }
      }
      writeItem(it);
    }
    if (sparkAlive) {
      let alive = 0;
      for (let i = 0; i < SPARKS; i++) {
        if (spLife[i] <= 0) continue;
        spLife[i] -= dt;
        spVel[i * 3 + 1] -= 14 * dt;
        spPos[i * 3] += spVel[i * 3] * dt;
        spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt;
        spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
        if (spLife[i] <= 0) spPos[i * 3 + 1] = -9999;
        else alive++;
      }
      spGeo.attributes.position.needsUpdate = true;
      sparkAlive = alive;
    }
  }

  // ================================================================ 2. 배달 드론 (도시 구간: 포털 B → 출발선 → 포털 A)
  const dim = track.dimension;
  const cityIdx = [];
  {
    // 포털 B 뒤부터 한 바퀴 돌아 포털 A 앞까지 (연속된 도시 구간)
    const i0 = dim ? Math.round(dim.t1 * N) + mS(40) : 0;
    const i1 = dim ? Math.round(dim.t0 * N) - mS(40) + N : N - 1;
    for (let i = i0; i <= i1; i++) cityIdx.push(i % N);
  }
  // 드론 높이 바닥: 고가도로(최고 18 m)보다 늘 위로 (round 4: 고가 교차 아래 접근로 위를 낮게 날던 드론이 카메라 앞을 지나갔음),
  //   메가타워(튜브) 근처 ±90 m에서는 숨김 (빌딩을 뚫고 지나가지 않게)
  const droneOK = new Uint8Array(cityIdx.length);
  {
    const near = mS(90);
    for (let j = 0; j < cityIdx.length; j++) {
      let ok = 1;
      for (let q = -near; q <= near && ok; q += 2) if (track.tubeK && track.tubeK[(cityIdx[j] + q + N) % N] > 0) ok = 0;
      droneOK[j] = ok;
    }
  }
  const DRONES = 60;
  const drones = [];
  for (let k = 0; k < DRONES; k++) drones.push({ u: rand() * cityIdx.length, sp: R(9, 22) * (rand() < 0.5 ? 1 : -1), lat: R(12, 30) * (rand() < 0.5 ? 1 : -1), h: R(8, 22), ph: R(0, 6), pkg: rand() < 0.6, col: new THREE.Color(NEON[k % NEON.length]) });
  const dBody = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.22, 1.1), new THREE.MeshStandardMaterial({ color: '#2a2d38', metalness: 0.7, roughness: 0.35, emissive: '#0d0f18' }), DRONES);
  const rotorGeo = (() => {
    const parts = [];
    for (const [x, z] of [[0.75, 0.75], [-0.75, 0.75], [0.75, -0.75], [-0.75, -0.75]]) parts.push(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 12).translate(x, 0.16, z));
    return mergeGeos(parts);
  })();
  const dRotor = new THREE.InstancedMesh(rotorGeo, new THREE.MeshBasicMaterial({ color: '#9aa3b8', transparent: true, opacity: 0.35, depthWrite: false }), DRONES);
  const dLight = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), DRONES * 2);
  const dPkg = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), DRONES);
  for (let k = 0; k < DRONES; k++) {
    dPkg.setColorAt(k, drones[k].col.clone().multiplyScalar(1.3));
    dLight.setColorAt(k * 2, new THREE.Color('#ff3030'));
    dLight.setColorAt(k * 2 + 1, new THREE.Color('#30ff70'));
  }
  for (const m of [dBody, dRotor, dLight, dPkg]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    city.add(m);
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _r = new THREE.Vector3();
  anim.push((t, dt) => {
    const n = cityIdx.length;
    for (let k = 0; k < DRONES; k++) {
      const d = drones[k];
      d.u += (d.sp * dt) / (L / N);
      if (d.u < 0 || d.u > n - 2) {
        d.sp = -d.sp; // 끝에서 돌아섬
        d.u = THREE.MathUtils.clamp(d.u, 0, n - 2);
      }
      const j = Math.floor(d.u), f = d.u - j;
      const sa = S[cityIdx[j]], sb = S[cityIdx[j + 1]];
      _a.lerpVectors(sa.pos, sb.pos, f);
      _r.lerpVectors(sa.right, sb.right, f).normalize();
      _a.addScaledVector(_r, d.lat + Math.sin(t * 0.3 + d.ph) * 3);
      _a.y = Math.max(_a.y, 18) + d.h + Math.sin(t * 1.7 + d.ph) * 0.6;
      const vis = droneOK[j] ? 1 : 0.001;
      const yaw = Math.atan2(sa.tan.x, sa.tan.z) + (d.sp < 0 ? Math.PI : 0);
      _q.setFromEuler(_e.set(0.12, yaw, Math.sin(t * 1.1 + d.ph) * 0.06, 'YXZ'));
      _s.setScalar(1.5 * vis);
      _m.compose(_a, _q, _s);
      dBody.setMatrixAt(k, _m);
      dRotor.setMatrixAt(k, _m);
      _s.setScalar(d.pkg ? 1.4 * vis : 0.001);
      _b.copy(_a);
      _b.y -= 0.6;
      _m.compose(_b, _q, _s);
      dPkg.setMatrixAt(k, _m);
      const blink = Math.sin(t * 6 + d.ph * 3) > 0.6 ? 1 : 0.25;
      for (const side of [0, 1]) {
        _b.set(side ? 0.9 : -0.9, 0, -0.9).applyQuaternion(_q).add(_a);
        _s.setScalar(1.6 * vis * (side ? blink : 1.25 - blink));
        _m.compose(_b, _q, _s);
        dLight.setMatrixAt(k * 2 + side, _m);
      }
    }
    for (const m of [dBody, dRotor, dLight, dPkg]) m.instanceMatrix.needsUpdate = true;
  });

  // ================================================================ 3. 결승선 홀로그램 쇼
  const s0 = S[0];
  const yaw0 = Math.atan2(s0.tan.x, s0.tan.z);
  const show = new THREE.Group();
  show.position.copy(s0.pos);
  show.rotation.y = yaw0;
  city.add(show);
  // 큰 홀로그램 전광판 (게이트 위 18 m, 다가오는 차 쪽을 봄)
  const scrC = document.createElement('canvas');
  scrC.width = 1024;
  scrC.height = 256;
  const scrG = scrC.getContext('2d');
  const scrTex = new THREE.CanvasTexture(scrC);
  scrTex.colorSpace = THREE.SRGBColorSpace;
  const screenMat = hologramMaterial('#2ff3ff', { opacity: 0.95, lines: 1.4, map: scrTex });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), screenMat);
  screen.position.set(0, 17, 0);
  screen.rotation.y = Math.PI; // 앞(-z 쪽에서 오는 차)을 봄
  show.add(screen);
  const frameMat = new THREE.MeshBasicMaterial({ color: '#ff2f8e', toneMapped: false });
  for (const [w, h, x, y] of [[26.6, 0.25, 0, 20.3], [26.6, 0.25, 0, 13.7], [0.25, 6.8, 13.3, 17], [0.25, 6.8, -13.3, 17]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.25), frameMat);
    b.position.set(x, y, 0);
    show.add(b);
  }
  // 프로젝터 받침 (게이트 위 기둥 두 개)
  for (const x of [-12.5, 12.5]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 7, 8), new THREE.MeshStandardMaterial({ color: '#2b2e3a', metalness: 0.7, roughness: 0.4 }));
    p.position.set(x, 10.2, 0.8);
    show.add(p);
  }
  let scrText = '';
  function drawScreen(big, small, colA, colB) {
    const txt = big + '|' + small;
    if (txt === scrText) return;
    scrText = txt;
    const g = scrG, w = 1024, h = 256;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(10,0,30,0.35)';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.font = '900 112px "Segoe UI", sans-serif';
    g.shadowColor = colA;
    g.shadowBlur = 24;
    g.fillStyle = colA;
    g.fillText(big, w / 2, 130);
    g.font = '700 46px "Segoe UI", sans-serif';
    g.shadowColor = colB;
    g.fillStyle = colB;
    g.fillText(small, w / 2, 210);
    scrTex.needsUpdate = true;
  }
  drawScreen('NEON CITY GP', '기믹 레이싱 · 야간 그랑프리', '#2ff3ff', '#ff5cf0');
  // 돌아가는 홀로그램 트로피 (전광판 위)
  const trophyPts = [[0, 0], [1.6, 0], [1.6, 0.5], [0.7, 0.8], [0.45, 2.2], [1.8, 3.2], [2.4, 5.2], [0.2, 5.2]].map(([x, y]) => new THREE.Vector2(x, y));
  const trophyMat = hologramMaterial('#ffe23a', { opacity: 0.9, lines: 3 });
  const trophy = new THREE.Mesh(new THREE.LatheGeometry(trophyPts, 24), trophyMat);
  trophy.position.set(0, 21, 0);
  show.add(trophy);
  const ringMat = hologramMaterial('#ff5cf0', { opacity: 0.8, lines: 4 });
  const rings = [0, 1].map((k) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(4 + k * 1.3, 0.08, 6, 48), ringMat);
    r.position.set(0, 23.5, 0);
    show.add(r);
    return r;
  });
  // 레이저 부채 (게이트 양쪽에서 하늘로)
  const laserMat = new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.25)'), color: '#ff2f8e', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const lasers = [];
  for (let k = 0; k < 8; k++) {
    const g = new THREE.Group();
    g.position.set(k < 4 ? -12.5 : 12.5, 13.8, 0.8);
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 70).translate(0, 35, 0), laserMat.clone());
    beam.material.color.set(NEON[(k * 3) % NEON.length]);
    g.add(beam);
    const b2 = beam.clone();
    b2.rotation.y = Math.PI / 2;
    g.add(b2);
    show.add(g);
    lasers.push({ g, ph: k * 0.8, side: k < 4 ? -1 : 1 });
  }
  // 불꽃놀이 (바퀴를 돌 때·결승·출발)
  const FW = 900;
  const fwPos = new Float32Array(FW * 3), fwVel = new Float32Array(FW * 3), fwLife = new Float32Array(FW), fwCol = new Float32Array(FW * 3);
  for (let i = 0; i < FW; i++) fwPos[i * 3 + 1] = -9999;
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3).setUsage(THREE.DynamicDrawUsage));
  fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3).setUsage(THREE.DynamicDrawUsage));
  const fw = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 1.4, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  fw.frustumCulled = false;
  city.add(fw);
  let fwNext = 0, fwAlive = 0;
  const _c = new THREE.Color();
  function firework(x, y, z, n = 120) {
    _c.set(NEON[Math.floor(rand() * NEON.length)]);
    for (let k = 0; k < n; k++) {
      const i = fwNext;
      fwNext = (fwNext + 1) % FW;
      const u = R(-1, 1), th = R(0, Math.PI * 2), sp = R(14, 20);
      const rr = Math.sqrt(1 - u * u);
      fwPos[i * 3] = x;
      fwPos[i * 3 + 1] = y;
      fwPos[i * 3 + 2] = z;
      fwVel[i * 3] = rr * Math.cos(th) * sp;
      fwVel[i * 3 + 1] = u * sp + 3;
      fwVel[i * 3 + 2] = rr * Math.sin(th) * sp;
      fwLife[i] = R(1.2, 1.9);
      fwCol[i * 3] = _c.r * 2;
      fwCol[i * 3 + 1] = _c.g * 2;
      fwCol[i * 3 + 2] = _c.b * 2;
    }
    fwAlive = 1;
  }
  let fwQueue = 0, fwTimer = 0;
  const celebrate = (n) => (fwQueue += n);
  let lastLap = 1, lastPhase = '';
  anim.push((t, dt) => {
    for (const m of [screenMat, trophyMat, ringMat]) m.uniforms.uTime.value = t;
    trophy.rotation.y = t * 0.8;
    rings[0].rotation.set(Math.PI / 2 + Math.sin(t * 0.7) * 0.3, t * 0.5, 0);
    rings[1].rotation.set(Math.PI / 2 + Math.cos(t * 0.6) * 0.3, -t * 0.4, 0);
    for (const l of lasers) l.g.rotation.set(Math.sin(t * 0.9 + l.ph) * 0.5, 0, l.side * (0.25 + 0.35 * Math.sin(t * 0.6 + l.ph)));
    // 전광판 글자: 레이스 상태에 따라
    const race = window.game && window.game.race;
    const laps = (track.data && track.data.laps) || 2;
    if (race) {
      if (race.phase === 'countdown') drawScreen(race.lights >= 5 ? 'GET READY' : 'NEON CITY GP', '불이 모두 꺼지면 출발!', '#ff3b3b', '#ffe23a');
      else if (race.phase === 'finished') drawScreen('FINISH!', '체커기 — 수고했어요!', '#ffe23a', '#2ff3ff');
      else if (race.lap >= laps) drawScreen('FINAL LAP', `마지막 바퀴! LAP ${race.lap}/${laps}`, '#ff2f8e', '#ffe23a');
      else drawScreen(`LAP ${race.lap}/${laps}`, 'NEON CITY GRAND PRIX', '#2ff3ff', '#ff5cf0');
      if (race.phase === 'racing' && lastPhase === 'countdown') celebrate(3);
      if (race.lap !== lastLap && race.lap > lastLap) celebrate(4);
      if (race.phase === 'finished' && lastPhase !== 'finished') celebrate(12);
      lastLap = race.lap;
      lastPhase = race.phase;
    }
    if (fwQueue > 0) {
      fwTimer -= dt;
      if (fwTimer <= 0) {
        fwQueue--;
        fwTimer = R(0.18, 0.4);
        _p.set(R(-60, 60), R(35, 60), R(-30, 120)).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw0).add(s0.pos);
        firework(_p.x, _p.y, _p.z);
      }
    }
    if (fwAlive) {
      let alive = 0;
      for (let i = 0; i < FW; i++) {
        if (fwLife[i] <= 0) continue;
        fwLife[i] -= dt;
        fwVel[i * 3] *= 1 - 1.2 * dt;
        fwVel[i * 3 + 2] *= 1 - 1.2 * dt;
        fwVel[i * 3 + 1] = fwVel[i * 3 + 1] * (1 - 1.2 * dt) - 6 * dt;
        fwPos[i * 3] += fwVel[i * 3] * dt;
        fwPos[i * 3 + 1] += fwVel[i * 3 + 1] * dt;
        fwPos[i * 3 + 2] += fwVel[i * 3 + 2] * dt;
        const fade = Math.min(1, fwLife[i] / 0.6);
        fwCol[i * 3] *= fade < 1 ? 0.97 : 1;
        fwCol[i * 3 + 1] *= fade < 1 ? 0.97 : 1;
        fwCol[i * 3 + 2] *= fade < 1 ? 0.97 : 1;
        if (fwLife[i] <= 0) fwPos[i * 3 + 1] = -9999;
        else alive++;
      }
      fwGeo.attributes.position.needsUpdate = true;
      fwGeo.attributes.color.needsUpdate = true;
      fwAlive = alive;
    }
  });

  // ================================================================ 4. 길가 관중 (코너 벽 뒤)
  const fans = [];
  {
    const step = mS(2.2);
    for (let i = 0; i < N; i += step) {
      const s = S[i];
      if (s.glitch || s.pos.y > 0.6 || (track.tubeK && track.tubeK[i] > 0)) continue;
      const t = i / N;
      if (t > 0.94 || t < 0.08) continue; // 출발 직선은 관중석이 있음
      for (const side of [-1, 1]) {
        // 코너(갓길을 넓힌 곳) 바깥쪽에만
        if (track.railLatOf(s, side) < 14.4) continue;
        const rl = track.railLatOf(s, side);
        const rows = 2;
        for (let r = 0; r < rows; r++) {
          if (rand() < 0.25) continue;
          const lat = side * (rl + 2.2 + r * 1.3 + R(-0.25, 0.25));
          const p = track.surf(s, lat, 0, new THREE.Vector3());
          p.addScaledVector(s.tan, R(-0.6, 0.6));
          // 다른 도로(고가 아래 접근로 등)와 겹치면 건너뜀
          const near = track.nearest(p);
          const di = Math.abs(((near.index - i) % N + N + N / 2) % N - N / 2); // 코스를 따라 떨어진 거리 (샘플 수)
          if (di > mS(30) && near.dist < track.railLatOf(near.sample, near.lateral < 0 ? -1 : 1) + 1.5) continue;
          fans.push({ i, p, yaw: Math.atan2(-side * s.right.x, -side * s.right.z), h: R(0.85, 1.1), col: NEON[Math.floor(rand() * NEON.length)], stick: rand() < 0.35 });
        }
      }
    }
  }
  if (fans.length) {
    const bodyGeo = new THREE.CapsuleGeometry(0.24, 0.75, 2, 6).translate(0, 0.62, 0);
    const headGeo = new THREE.SphereGeometry(0.17, 6, 4).translate(0, 1.32, 0);
    const stickGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.55, 4).translate(0.28, 1.75, 0);
    // 응원 동작: 셰이더에서 사람마다 다른 박자로 폴짝 (CPU 계산 없음). 몸·머리·야광봉은 같은 번호라 같이 뜀
    const time = { value: 0 };
    const jump = (mat) => {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = time;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float idf = float(gl_InstanceID);
          float jumper = step(0.55, fract(idf * 0.618));
          transformed.y += jumper * max(0.0, sin(uTime * 7.0 + idf * 2.3)) * 0.32 + (1.0 - jumper) * sin(uTime * 3.0 + idf) * 0.03;`
        );
      };
      return mat;
    };
    const bodyMat = jump(new THREE.MeshStandardMaterial({ roughness: 0.8, emissive: '#1a0f30', emissiveIntensity: 0.6 }));
    const headMat = jump(new THREE.MeshStandardMaterial({ color: '#c99a7a', roughness: 0.8, emissive: '#2a1810', emissiveIntensity: 0.5 }));
    const stickMat = jump(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
    // 코스 구간별로 나눠서 (화면 밖 묶음은 안 그림)
    const CH = 8;
    const chunks = Array.from({ length: CH }, () => []);
    for (const f of fans) chunks[Math.min(CH - 1, Math.floor(f.i / (N / CH)))].push(f);
    for (const list of chunks) {
      if (!list.length) continue;
      const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, list.length);
      const heads = new THREE.InstancedMesh(headGeo, headMat, list.length);
      const sticks = new THREE.InstancedMesh(stickGeo, stickMat, list.length);
      list.forEach((f, k) => {
        _q.setFromEuler(_e.set(0, f.yaw, 0));
        _s.set(1, f.h, 1);
        _m.compose(f.p, _q, _s);
        bodies.setMatrixAt(k, _m);
        heads.setMatrixAt(k, _m);
        bodies.setColorAt(k, _c.set(f.col).multiplyScalar(0.55));
        _s.setScalar(f.stick ? 1 : 0.0001);
        _m.compose(f.p, _q, _s);
        sticks.setMatrixAt(k, _m);
        sticks.setColorAt(k, _c.set(NEON[(k * 5) % NEON.length]).multiplyScalar(1.6));
      });
      for (const m of [bodies, heads, sticks]) {
        m.computeBoundingSphere();
        city.add(m);
      }
    }
    anim.push((t) => (time.value = t));
  }

  resetItems();
  let worldG = null;
  return {
    group: root,
    hit,
    items, // 테스트용
    knocked: () => items.filter((it) => it.state > 0).length, // 테스트용: 날아간 소품 수
    update(dt) {
      updateItems(dt);
    },
    reset() {
      resetItems();
    },
    animate(t) {
      const g = !!track.inGlitch;
      if (g !== worldG) {
        worldG = g;
        city.visible = !g;
        glitchG.visible = g;
      }
      const dt = Math.min(0.1, Math.max(0, t - (this._lt ?? t)));
      this._lt = t;
      if (!g) for (const a of anim) a(t, dt);
    },
    props: [],
    cubes: [],
    barricade: null,
    barricades: [],
    rings: [],
    stats: { breakables: items.length, drones: DRONES, fans: fans.length },
  };
}

/** 여러 BufferGeometry를 하나로 (위치·법선만) */
function mergeGeos(list) {
  let n = 0;
  for (const g of list) n += g.index ? g.index.count : g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
