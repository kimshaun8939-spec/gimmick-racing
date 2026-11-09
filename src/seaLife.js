// 노을 해안 서킷의 움직이는 것들 (seaScenery.js가 부름)
//   항구를 오가는 배, 하늘을 도는 수상비행기, 결승선 위 불꽃놀이와 노을빛 등불, 물에 들어갈 때·파도에서 떨어질 때 물보라
//   모두 단단하지 않음 (부딪히지 않음). 무거운 계산 없이 인스턴스·점(Points) 몇 개로
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function colored(geo, color, m4 = null) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m4) g.applyMatrix4(m4);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) (arr[i * 3] = c.r), (arr[i * 3 + 1] = c.g), (arr[i * 3 + 2] = c.b);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** 수상비행기 (빨강·흰색, 날개 위, 바닥에 뜨개 2개) — 앞 = +z */
function seaplaneGeometry() {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.75, 0.5, 8, 10).rotateX(Math.PI / 2), '#f4f4f4', M(0, 0, 0)),
    colored(new THREE.ConeGeometry(0.75, 1.4, 10).rotateX(Math.PI / 2), '#e8463a', M(0, 0, 4.7)),
    colored(new THREE.BoxGeometry(12, 0.18, 1.7), '#e8463a', M(0, 0.85, 0.9)),
    colored(new THREE.BoxGeometry(4, 0.12, 1), '#e8463a', M(0, 0.2, -3.7)),
    colored(new THREE.BoxGeometry(0.12, 1.5, 1.1), '#e8463a', M(0, 0.8, -3.7)),
    colored(new THREE.BoxGeometry(1.2, 0.7, 1.4), '#5fb6ff', M(0, 0.55, 1.6)),
    ...[-1.3, 1.3].flatMap((x) => [
      colored(new THREE.CylinderGeometry(0.28, 0.22, 4.6, 8).rotateX(Math.PI / 2), '#ffffff', M(x, -1.7, 0.6)),
      colored(new THREE.BoxGeometry(0.1, 1.4, 0.1), '#9aa3ad', M(x, -1.0, 1.4)),
      colored(new THREE.BoxGeometry(0.1, 1.4, 0.1), '#9aa3ad', M(x, -1.0, -0.4)),
    ]),
    ...[-3.5, 3.5].map((x) => colored(new THREE.BoxGeometry(0.1, 0.9, 0.1), '#9aa3ad', M(x, 0.35, 0.9, 0, 0, x > 0 ? 0.6 : -0.6))),
  ]);
}

/** 작은 모터보트 (앞 = +z) */
function motorBoatGeometry(color) {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(2.2, 0.9, 6), color, M(0, 0.2, 0)),
    colored(new THREE.ConeGeometry(1.1, 2, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), color, M(0, 0.2, 3.9, 0, 0, 0, 1, 0.6, 1)),
    colored(new THREE.BoxGeometry(2.25, 0.25, 6.05), '#ffffff', M(0, 0.6, 0)),
    colored(new THREE.BoxGeometry(1.6, 0.8, 1.6), '#f4f4f4', M(0, 1.1, -0.6)),
    colored(new THREE.BoxGeometry(1.5, 0.4, 0.1), '#6fc4ff', M(0, 1.3, 0.25)),
  ]);
}

/** 동그랗게 번지는 빛 점 무늬 (불꽃·물방울·등불을 네모 대신 둥글게) */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSeaLife(track, group, animators, rand) {
  const glow = glowTexture();
  const R = (a, b) => a + rand() * (b - a);
  const groundY = (x, z) => track.groundY(x, z);
  const HW = track.width / 2;
  const tmpV = new THREE.Vector3();
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  // ---------------------------------------------------------------- 항구를 오가는 모터보트 (물 위 타원 길을 천천히 돎)
  {
    const s0 = track.samples[0];
    // 출발 직선 바다 쪽(-오른쪽) 50~140 m 앞바다에서 빈 물 찾기
    const loops = [];
    for (let k = 0; k < 40 && loops.length < 4; k++) {
      const along = R(-160, 140), off = R(70, 150);
      const cx = s0.pos.x + s0.tan.x * along - s0.right.x * off, cz = s0.pos.z + s0.tan.z * along - s0.right.z * off;
      const rx = R(22, 45), rz = R(12, 22), rot = Math.atan2(s0.tan.x, s0.tan.z) + R(-0.3, 0.3);
      let ok = true;
      for (let a = 0; a < 6.28 && ok; a += 0.4) {
        const lx = Math.cos(a) * rx, lz = Math.sin(a) * rz;
        const x = cx + lx * Math.cos(rot) + lz * Math.sin(rot), z = cz - lx * Math.sin(rot) + lz * Math.cos(rot);
        const y = groundY(x, z);
        if (y === null || y > -1.5 || track.nearestRaw(tmpV.set(x, 0, z)) < HW + 20) ok = false;
      }
      if (ok && loops.every((l) => Math.hypot(l.cx - cx, l.cz - cz) > 70)) loops.push({ cx, cz, rx, rz, rot, sp: R(0.12, 0.22) * (rand() < 0.5 ? -1 : 1), ph: R(0, 6.3) });
    }
    const colors = ['#2e6fd8', '#e8463a', '#19b3a6', '#ffcf3f'];
    // 물결 자국 그림: 가운데 거품 줄 + 양옆으로 벌어지는 V자 줄, 뒤로 갈수록 흐려짐
    const wakeTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = 128;
      cv.height = 512;
      const c = cv.getContext('2d');
      for (let y = 0; y < 512; y++) {
        const f = y / 511; // 0 = 배 바로 뒤, 1 = 끝
        const fade = Math.pow(1 - f, 1.3);
        // 가운데 거품 (뒤로 갈수록 넓고 흐림)
        const cw = 10 + f * 30;
        c.fillStyle = `rgba(255,255,255,${(0.95 * fade).toFixed(3)})`;
        c.fillRect(64 - cw / 2, y, cw, 1);
        // V자 두 줄
        const spread = 8 + f * 52, lw = 4 + f * 6;
        c.fillStyle = `rgba(255,255,255,${(0.8 * fade).toFixed(3)})`;
        c.fillRect(64 - spread - lw / 2, y, lw, 1);
        c.fillRect(64 + spread - lw / 2, y, lw, 1);
      }
      // 거품 점
      for (let k = 0; k < 260; k++) {
        const y = Math.random() * 512, f = y / 511, sp = 8 + f * 52;
        c.fillStyle = `rgba(255,255,255,${(0.7 * (1 - f)).toFixed(3)})`;
        c.fillRect(64 + (Math.random() * 2 - 1) * sp, y, 2, 2);
      }
      const tx = new THREE.CanvasTexture(cv);
      tx.colorSpace = THREE.SRGBColorSpace;
      tx.flipY = false; // 그림 위쪽(진한 곳)이 배 꽁무니 쪽으로
      return tx;
    })();
    // 판 앞(+v) = 배 꽁무니, 뒤로 30 m
    const wakeGeo = new THREE.PlaneGeometry(16, 42).rotateX(-Math.PI / 2).translate(0, 0, -22.5);
    const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, opacity: 0.8, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    loops.forEach((l, i) => {
      const m = new THREE.Mesh(motorBoatGeometry(colors[i % colors.length]), vcMat);
      m.castShadow = true;
      group.add(m);
      // 뒤에 V자 하얀 물결 자국 (배가 앞으로 살짝 들려 있어서 배에 붙이면 끝이 물속에 묻혔음 → 따로 물 위에 눕힘)
      const wake = new THREE.Mesh(wakeGeo, wakeMat);
      wake.renderOrder = 2;
      group.add(wake);
      animators.push((t) => {
        const a = l.ph + t * l.sp;
        const lx = Math.cos(a) * l.rx, lz = Math.sin(a) * l.rz;
        // 진행 방향 = 타원 접선
        const tx = -Math.sin(a) * l.rx * Math.sign(l.sp), tz = Math.cos(a) * l.rz * Math.sign(l.sp);
        const wx = tx * Math.cos(l.rot) + tz * Math.sin(l.rot), wz = -tx * Math.sin(l.rot) + tz * Math.cos(l.rot);
        m.position.set(l.cx + lx * Math.cos(l.rot) + lz * Math.sin(l.rot), Math.sin(t * 2 + i) * 0.08, l.cz - lx * Math.sin(l.rot) + lz * Math.cos(l.rot));
        m.rotation.set(-0.06, Math.atan2(wx, wz), Math.sin(t * 1.7 + i) * 0.03);
        wake.position.set(m.position.x, 0.32, m.position.z);
        wake.rotation.y = m.rotation.y;
      });
    });
  }

  // ---------------------------------------------------------------- 수상비행기 (만 위를 크게 돌다가 물길 옆으로 낮게 지나감)
  {
    const plane = new THREE.Mesh(seaplaneGeometry(), vcMat);
    plane.castShadow = true;
    const prop = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.06), new THREE.MeshLambertMaterial({ color: '#2a2a2a' }));
    prop.position.set(0, 0, 5.45);
    plane.add(prop);
    group.add(plane);
    // 물길 가운데쯤을 중심으로 큰 타원
    let cx = 0, cz = 0, n = 0;
    for (const [a, b] of track.waterRuns) for (const s of track.spanList(a, b)) (cx += s.pos.x), (cz += s.pos.z), n++;
    if (n) (cx /= n), (cz /= n - 0);
    else (cx = 0), (cz = -400);
    const RX = 380, RZ = 230, PER = 46;
    const prev = new THREE.Vector3(), cur = new THREE.Vector3();
    const posAt = (t, out) => {
      const a = (t / PER) * Math.PI * 2;
      // 한 바퀴 중 한 번 물 가까이 내려옴 (낮게 스치기)
      const low = Math.pow(Math.max(0, Math.cos(a - 1.2)), 6);
      return out.set(cx + Math.cos(a) * RX, 70 - 52 * low + Math.sin(a * 3) * 4, cz + Math.sin(a) * RZ);
    };
    animators.push((t) => {
      posAt(t, cur);
      posAt(t + 0.2, prev);
      plane.position.copy(cur);
      const dx = prev.x - cur.x, dy = prev.y - cur.y, dz = prev.z - cur.z;
      plane.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0, 'YXZ');
      plane.rotation.z = -0.35; // 원을 도니까 안쪽으로 기울임
      prop.rotation.z = t * 40;
    });
  }

  // ---------------------------------------------------------------- 결승선 노을빛 등불 줄 (출발 직선 위 가로질러)
  {
    const s0 = track.samples[0];
    const pts = [], cols = [];
    const palette = ['#ffd27a', '#ff9a4a', '#ff6a8a', '#fff1b0'];
    for (const along of [-60, -36, 24, 48]) {
      const base = s0.pos.clone().addScaledVector(s0.tan, along);
      const L = HW + 6;
      for (let k = 0; k <= 24; k++) {
        const u = k / 24;
        const sag = Math.sin(u * Math.PI) * 1.6;
        const p = base.clone().addScaledVector(s0.right, -L + 2 * L * u).setY(base.y + 9.5 - sag);
        pts.push(p.x, p.y, p.z);
        const c = new THREE.Color(palette[k % palette.length]);
        cols.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({ size: 1.3, map: glow, vertexColors: true, transparent: true, depthWrite: false, fog: false });
    group.add(new THREE.Points(g, mat));
    // 줄 (가는 선)
    const lp = [];
    for (let i = 0; i < pts.length / 3 - 1; i++) if ((i + 1) % 25) lp.push(pts[i * 3], pts[i * 3 + 1] + 0.15, pts[i * 3 + 2], pts[i * 3 + 3], pts[i * 3 + 4] + 0.15, pts[i * 3 + 5]);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#3a2a2a' })));
    animators.push((t) => (mat.size = 1.25 + Math.sin(t * 3) * 0.15));
  }

  // ---------------------------------------------------------------- 불꽃놀이 (결승선 앞바다 위. 경기가 끝나면 쉴 새 없이)
  const fw = (() => {
    const BURSTS = 7, PER = 140;
    const N = BURSTS * PER;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // (노을 하늘이 밝아서 더하기 섞기로는 거의 안 보였음 → 보통 섞기 + 둥근 빛 무늬 + 크게)
    const mat = new THREE.PointsMaterial({ size: 4.2, map: glow, vertexColors: true, transparent: true, depthWrite: false, fog: false, sizeAttenuation: true });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    group.add(pts);
    const bursts = Array.from({ length: BURSTS }, () => ({ age: 99, color: new THREE.Color() }));
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -999;
    const s0 = track.samples[0];
    const PAL = ['#ff5a4a', '#ffd21f', '#5ff0ff', '#ff8ad0', '#9a8cff', '#7ee08a', '#ffffff'];
    let next = 1.5, nextBurst = 0, wasFinished = false;
    const fire = () => {
      const b = bursts[nextBurst];
      const k0 = nextBurst * PER;
      nextBurst = (nextBurst + 1) % BURSTS;
      b.age = 0;
      b.color.set(PAL[Math.floor(Math.random() * PAL.length)]);
      const c = s0.pos.clone().addScaledVector(s0.tan, R(-90, 90)).addScaledVector(s0.right, -R(70, 160));
      c.y = R(55, 95);
      const sp = R(14, 22);
      for (let i = 0; i < PER; i++) {
        const k = (k0 + i) * 3;
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        const v = sp * (0.85 + Math.random() * 0.15);
        vel[k] = r * Math.cos(a) * v;
        vel[k + 1] = u * v;
        vel[k + 2] = r * Math.sin(a) * v;
        pos[k] = c.x;
        pos[k + 1] = c.y;
        pos[k + 2] = c.z;
      }
    };
    let sleeping = false;
    animators.push((t, dt) => {
      if (!(dt > 0)) return;
      const race = typeof window !== 'undefined' && window.game && window.game.race;
      const finished = race && race.phase === 'finished';
      if (finished && !wasFinished) next = 0; // 결승선을 넘는 순간 바로 터짐
      wasFinished = finished;
      next -= dt;
      if (next <= 0) {
        fire();
        next = finished ? R(0.25, 0.6) : R(2.5, 5.5);
      }
      let alive = false;
      for (let bi = 0; bi < BURSTS; bi++) {
        const b = bursts[bi];
        if (b.age > 3.2) continue;
        alive = true;
        b.age += dt;
        const fade = Math.max(0, 1 - b.age / 3.2);
        const tw = fade * fade;
        for (let i = 0; i < PER; i++) {
          const k = (bi * PER + i) * 3;
          vel[k] *= 1 - 1.2 * dt;
          vel[k + 1] = vel[k + 1] * (1 - 1.2 * dt) - 6 * dt;
          vel[k + 2] *= 1 - 1.2 * dt;
          pos[k] += vel[k] * dt;
          pos[k + 1] += vel[k + 1] * dt;
          pos[k + 2] += vel[k + 2] * dt;
          // 처음엔 하얗게 번쩍 → 제 색 → 어두워지며 사라짐 (투명도 대신 색을 하늘색 쪽으로 낮춤)
          const wh = Math.max(0, 1 - b.age * 3);
          const fl = (0.75 + 0.25 * Math.sin(t * 30 + i)) * (0.4 + 0.6 * tw);
          col[k] = Math.min(1, (b.color.r + wh) * fl);
          col[k + 1] = Math.min(1, (b.color.g + wh) * fl);
          col[k + 2] = Math.min(1, (b.color.b + wh) * fl);
          if (b.age > 3.0) pos[k + 1] = -999;
        }
      }
      if (alive || !sleeping) {
        g.attributes.position.needsUpdate = true;
        g.attributes.color.needsUpdate = true;
      }
      sleeping = !alive;
    });
    return { fire };
  })();

  // ---------------------------------------------------------------- 물보라 (차가 물에 들어갈 때, 파도에서 물에 떨어질 때)
  {
    const PER = 70, SLOTS = 8, N = PER * SLOTS;
    const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: '#e8f8ff', map: glow, size: 1.1, transparent: true, opacity: 0.95, depthWrite: false });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    group.add(pts);
    const ring = [];
    for (let k = 0; k < SLOTS; k++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#d9f6ff', transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      group.add(m);
      ring.push({ m, age: 9 });
    }
    let slot = 0, active = 0;
    const splash = (p, v, big) => {
      const k0 = slot * PER;
      const r = ring[slot];
      slot = (slot + 1) % SLOTS;
      for (let i = 0; i < PER; i++) {
        const k = (k0 + i) * 3;
        const a = Math.random() * Math.PI * 2, s = (big ? 5 : 3) * Math.random();
        vel[k] = Math.cos(a) * s + v.x * 0.35;
        vel[k + 1] = (big ? 6 : 4) + Math.random() * (big ? 6 : 3);
        vel[k + 2] = Math.sin(a) * s + v.z * 0.35;
        pos[k] = p.x + Math.cos(a) * 1.2;
        pos[k + 1] = 0.2;
        pos[k + 2] = p.z + Math.sin(a) * 1.2;
      }
      r.m.position.set(p.x, 0.06, p.z);
      r.age = 0;
      r.m.visible = true;
      active = 2.2;
    };
    // 지켜볼 차: 플레이어 + 봇 (window.game.raceSys가 있으면)
    const state = new Map();
    const watch = (c) => {
      const st = state.get(c) || { water: false, air: false };
      const inWater = c.surface === 'water' && c.grounded;
      if (inWater && (!st.water || st.air)) {
        const sp = Math.hypot(c.vel.x, c.vel.z) || Math.abs(c.speed);
        if (sp > 6 && Math.abs(c.pos.y) < 1) splash(c.pos, c.vel, st.air || sp > 25);
      }
      st.water = c.surface === 'water';
      st.air = !c.grounded && st.water;
      state.set(c, st);
    };
    animators.push((t, dt, car) => {
      if (car) watch(car);
      const rs = typeof window !== 'undefined' && window.game && window.game.raceSys;
      if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car.pos) watch(b.car);
      if (!(dt > 0) || active <= 0) return;
      active -= dt;
      for (let i = 0; i < N; i++) {
        const k = i * 3;
        if (pos[k + 1] < -50) continue;
        vel[k + 1] -= 14 * dt;
        pos[k] += vel[k] * dt;
        pos[k + 1] += vel[k + 1] * dt;
        pos[k + 2] += vel[k + 2] * dt;
        if (pos[k + 1] < -0.3) pos[k + 1] = -999;
      }
      g.attributes.position.needsUpdate = true;
      for (const r of ring) {
        if (!r.m.visible) continue;
        r.age += dt;
        const s = 1 + r.age * 7;
        r.m.scale.set(s, 1, s);
        r.m.material.opacity = Math.max(0, 0.7 * (1 - r.age / 1.4));
        if (r.age > 1.4) r.m.visible = false;
      }
    });
  }

  return { fireworks: fw };
}
