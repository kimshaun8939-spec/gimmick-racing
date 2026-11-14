// 구름섬 그랑프리 · 우주 차원 위험 (2026-11-15 space2, 사용자 요청 "차원에 들어가도 배경만 바뀜 → 그 배경에 맞는 특징")
//
//   우주에서만 운전이 달라지는 규칙 두 가지 (data/grandprix.json 의 spaceHazards, 생성기 .debug/space_gen.js):
//   1) 난간 없는 길 (open): 연석 밖은 허공. 떨어지면(도로보다 3 m 아래 + 길 끝 밖) 0.25초 뒤 뒤로 복귀 + "🕳 우주로 떨어졌어요!"
//      (예전엔 우주 어디서 떨어져도 y −30까지 몇 초씩 떨어졌음 → 우주 전체에서 빠른 복귀). 가장자리 빛 선·빛 커튼은 gpTrack.js
//   2) 블랙홀 중력 (pull): 블랙홀(dimension.blackHole) 쪽으로 옆으로 끌림. 블랙홀이 숨 쉬듯 세졌다 약해지고(pulse),
//      블랙홀 쪽 가장자리로 갈수록 더 셈(edgeGain). 도로 위 화살표·가로질러 흐르는 빛 알갱이·소용돌이·경고판·화면 가장자리 보라빛·낮은 소리로 미리 보임
//   사람·봇 같은 힘, 같은 복귀 (봇은 window.game.raceSys.bots). 튜토리얼·아카데미 중에는 중력만 끔 (길 모양은 그대로)
//   gpProps.js 가 만들고 update(dt, car)(물리 스텝마다)·animate(time)(그릴 때마다)를 부름. 결과는 game.props.spaceHz
import * as THREE from 'three';
import { canvasTexture } from './track.js';
import { mixState } from './audioMix.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function glowTex() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

/** 도로 위 화살표 (→ 방향 = 텍스처 오른쪽) */
function chevronTex() {
  return canvasTexture(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
      const x = 46 + k * 70;
      g.strokeStyle = `rgba(255,255,255,${0.45 + k * 0.27})`;
      g.lineWidth = 20;
      g.beginPath();
      g.moveTo(x - 26, 22);
      g.lineTo(x + 18, h / 2);
      g.lineTo(x - 26, h - 22);
      g.stroke();
    }
  });
}

/** 소용돌이 (블랙홀로 빨려 드는 빛 나선) */
function spiralTex() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    for (let arm = 0; arm < 4; arm++) {
      for (let k = 0; k < 900; k++) {
        const t = k / 900;
        const r = 18 + t * 230;
        const a = arm * (TAU / 4) + t * 7.5;
        const alpha = (1 - t) * 0.55 + 0.08;
        const sz = 2 + (1 - t) * 6;
        g.fillStyle = `rgba(${200 + 55 * (1 - t) | 0},${120 + 90 * (1 - t) | 0},255,${alpha})`;
        g.beginPath();
        g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, sz, 0, TAU);
        g.fill();
      }
    }
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, 60);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.9)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(255,220,180,0.9)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, 40, 0, TAU);
    g.stroke();
  });
}

/** 떠 있는 경고판 */
function signTex(title, sub, color) {
  return canvasTexture(512, 192, (g, w, h) => {
    g.fillStyle = 'rgba(10,8,34,0.92)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
    // 위험 줄무늬
    g.save();
    g.beginPath();
    g.rect(14, 14, w - 28, 26);
    g.clip();
    for (let x = -40; x < w; x += 36) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(x, 40);
      g.lineTo(x + 18, 40);
      g.lineTo(x + 44, 14);
      g.lineTo(x + 26, 14);
      g.fill();
    }
    g.restore();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 58px "Segoe UI","Malgun Gothic",sans-serif';
    g.fillText(title, w / 2, 92);
    g.fillStyle = color;
    g.font = '700 30px "Segoe UI","Malgun Gothic",sans-serif';
    g.fillText(sub, w / 2, 150);
  });
}

export function createSpaceHazards(track, scene) {
  const HZ = track.spaceHazards;
  if (!HZ || !track.dimension) return null;
  const C = HZ.cfg;
  const S = track.samples, N = S.length - 1, ds = track.length / N;
  const HW = track.width / 2;
  const wrap = (i) => ((i % N) + N) % N;
  const qs = new URLSearchParams(location.search);
  const pullOff = qs.get('spull') === '0' || !!qs.get('tutorial') || !!qs.get('academy');
  const fallCfg = C.fall || {};
  const FALL_BELOW = fallCfg.below ?? 3, FALL_DELAY = fallCfg.delay ?? 0.25;
  const pulseCfg = C.pulse || { period: 5, min: 0.55 };
  let clock = 0;
  const pulse = (t = clock) => pulseCfg.min + (1 - pulseCfg.min) * (0.5 - 0.5 * Math.cos((TAU * t) / pulseCfg.period));
  const stats = { falls: 0, playerFalls: 0, botFalls: 0, pullT: 0, where: [] };

  const group = new THREE.Group();
  group.name = 'spaceHazards';
  group.visible = false;
  scene.add(group);
  const glow = glowTex();

  // ---------------------------------------------------------------- 블랙홀 중력 (물리)
  //   속도에 옆 힘을 더하면 타이어가 바로 잡아 버려서 거의 안 밀렸음 (사막 측풍처럼 '살짝 버티기'로 끝) →
  //   차 방향·속도는 그대로 두고 위치만 옆으로 미끄러지게 함 (raceSystem 몸싸움 cNudge와 같은 방식, 돌 일 없음).
  //   옆 미끄럼 속도 drift' = 끌림 − slip × drift  → 손을 놓으면 약 accel/slip m/s로 블랙홀 쪽으로 흘러감 (2.9 → 2.9 m/s, 정거장 직선 끝까지면 허공)
  //   핸들로 반대쪽을 살짝 바라보면(약 2°) 버틸 수 있음. 사람·봇 같은 식
  const SLIP = C.slip ?? 1;
  function applyPull(car, dt, i, lat, st) {
    const a0 = track.pullA[i];
    const ok = a0 && !pullOff && car.grounded && car.mode !== 'fly' && car.mode !== 'boat';
    let a = 0;
    if (ok) {
      const dir = Math.sign(a0);
      const toward = THREE.MathUtils.clamp((lat * dir) / HW, -1, 1.3); // 블랙홀 쪽 가장자리로 갈수록 +1
      a = a0 * pulse() * (1 + (C.edgeGain || 0) * toward);
    }
    // 구간 밖에서는 빨리 사라짐 (난간 있는 곳으로 밀고 들어가지 않게)
    st.drift += (a - (ok ? SLIP : 4) * st.drift) * dt;
    if (Math.abs(st.drift) < 1e-3 && !ok) st.drift = 0;
    if (st.drift) {
      const r = S[i].right;
      car.pos.x += r.x * st.drift * dt;
      car.pos.z += r.z * st.drift * dt;
    }
    return Math.abs(a);
  }

  // ---------------------------------------------------------------- 떨어짐 감지 (화산 volcanoProps 방식)
  const state = new WeakMap();
  const tmp = new THREE.Vector3();
  function follow(st, car) {
    // 지난번 지점 근처(±60 샘플)에서 수평 거리만 보고 가장 가까운 곳 (떨어지는 동안 아래 다른 길로 넘어가지 않게; 우주 고리는 다른 길 아래로 교차함)
    if (st.idx < 0 || car.events.includes('respawn')) st.idx = car.trackInfo ? car.trackInfo.index ?? Math.round(car.trackInfo.t * N) : track.nearest(car.pos).index;
    let best = Infinity, bi = st.idx;
    for (let k = -60; k <= 60; k++) {
      const i = wrap(st.idx + k), p = S[i].pos;
      const d = (p.x - car.pos.x) ** 2 + (p.z - car.pos.z) ** 2;
      if (d < best) (best = d), (bi = i);
    }
    if (best > 90 * 90) bi = track.nearest(car.pos).index;
    st.idx = bi;
    return bi;
  }
  /** 한 차: 중력 + 떨어짐. 돌려주는 값 = 이 차가 받은 옆 끌림 (m/s²) */
  function stepCar(car, dt, isPlayer, name) {
    const ti = car.trackInfo;
    if (!ti) return 0;
    let st = state.get(car);
    if (!st) state.set(car, (st = { idx: -1, fallT: 0, drift: 0 }));
    // 우주 근처가 아니면 아무것도 안 함 (가벼움)
    if (!S[wrap(ti.index ?? Math.round(ti.t * N))].space && st.fallT === 0) {
      st.idx = -1;
      st.drift = 0;
      return 0;
    }
    const i = follow(st, car), s = S[i];
    if (!s.space) {
      st.fallT = 0;
      return 0;
    }
    tmp.copy(car.pos).sub(s.pos);
    const lat = tmp.x * s.right.x + tmp.z * s.right.z;
    const side = lat < 0 ? -1 : 1;
    const edge = track.spaceEdgeLat(i, side);
    const out = Math.abs(lat) - edge;
    const below = track.roadYAt(s, THREE.MathUtils.clamp(lat, -edge, edge)) - car.pos.y;
    const falling = below > FALL_BELOW && out > 0.2;
    st.fallT = falling ? st.fallT + dt : 0;
    if (isPlayer) fallFx = falling ? Math.min(1, fallFx + dt * 4) : fallFx;
    if (st.fallT > FALL_DELAY) {
      st.fallT = 0;
      car.respawn();
      st.idx = -1;
      st.drift = 0;
      stats.falls++;
      if (isPlayer) stats.playerFalls++;
      else stats.botFalls++;
      if (stats.where.length < 60) stats.where.push(`${name}@${s.t.toFixed(3)}`);
      if (isPlayer) showToast('🕳 우주로 떨어졌어요!', '난간 없는 길 · 빛나는 가장자리 선을 넘지 마세요', '#b98cff');
      return 0;
    }
    if (falling) return 0;
    if (car.events.includes('respawn')) st.drift = 0;
    const a = applyPull(car, dt, i, lat, st);
    if (isPlayer && a > 0) stats.pullT += dt;
    return a;
  }

  // ---------------------------------------------------------------- 알림 (DOM)
  const toast = document.createElement('div');
  toast.id = 'spaceHzToast';
  toast.style.cssText =
    'position:fixed;left:50%;top:29%;transform:translateX(-50%) scale(.96);z-index:5;pointer-events:none;opacity:0;transition:opacity .25s, transform .25s;' +
    'font:800 27px/1.2 "Segoe UI","Malgun Gothic",sans-serif;letter-spacing:1px;color:#fff;white-space:nowrap;text-align:center;text-shadow:0 0 12px #8b5cff,0 0 26px #38e8ff';
  // 화면 가장자리 보라빛 (블랙홀 쪽만, 끌림 세기만큼)
  const veil = document.createElement('div');
  veil.id = 'spaceHzVeil';
  veil.style.cssText = 'position:fixed;inset:0;z-index:3;pointer-events:none;opacity:0;';
  if (document.body) document.body.append(veil, toast);
  let toastT = 0;
  function showToast(text, sub, color = '#7fe7ff') {
    toast.innerHTML = `${text}<div style="font-size:15px;font-weight:700;opacity:.92;margin-top:3px;color:${color}">${sub || ''}</div>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) scale(1)';
    toastT = 2.2;
  }

  // ---------------------------------------------------------------- 구간 목록 (경고용): 난간 없는 구간마다, 겹치는 중력 구간 정보
  const zones = track.openRuns.map((r) => {
    let pullSign = 0;
    for (let i = r.a; i <= r.b; i++) if (track.pullA[wrap(i)]) pullSign = Math.sign(track.pullA[wrap(i)]);
    return { ...r, pullSign, warnedAt: -1e9 };
  });
  const distTo = (from, to) => {
    let d = (to - from) * ds;
    const L = track.length;
    if (d < -L / 2) d += L;
    if (d > L / 2) d -= L;
    return d;
  };
  function warnPlayer(car) {
    const ti = car.trackInfo;
    if (!ti) return;
    const i = ti.index ?? Math.round(ti.t * N);
    const v = Math.max(20, Math.abs(car.speed));
    for (const z of zones) {
      const d = distTo(i, z.a);
      if (d > 0 && d < Math.max(C.warn || 160, v * 2.4) && clock - z.warnedAt > 20) {
        z.warnedAt = clock;
        if (z.pullSign) {
          const way = z.pullSign > 0 ? '오른쪽 ▶' : '◀ 왼쪽';
          showToast(`⚫ 블랙홀 중력 · ${way}`, `블랙홀 쪽으로 끌려요 · 반대로 버티기 · 난간 없음!`, '#d6a8ff');
        } else showToast('⚠ 난간 없는 길', '연석 밖은 허공 · 떨어지면 뒤로 복귀', '#7fe7ff');
      }
    }
  }

  // ---------------------------------------------------------------- 보이는 것: 중력 구간마다 화살표·빛 알갱이·소용돌이·빛 커튼
  const pulls = track.pullRuns; // { a, b, sign, name }
  const chevMat = new THREE.MeshBasicMaterial({ map: chevronTex(), color: '#c58cff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, fog: false });
  const chevGeo = new THREE.PlaneGeometry(4.2, 2.1).rotateX(-Math.PI / 2);
  const chevList = [];
  for (const z of pulls) {
    const step = Math.round(30 / ds);
    for (let i = z.a + Math.round(20 / ds), k = 0; i < z.b - Math.round(10 / ds); i += step, k++) {
      for (const lat of [-4.3, 0, 4.3]) chevList.push({ i: wrap(i), lat, sign: z.sign, k });
    }
  }
  const chev = new THREE.InstancedMesh(chevGeo, chevMat, Math.max(1, chevList.length));
  {
    const m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Z = new THREE.Vector3(), P = new THREE.Vector3();
    chevList.forEach((c, n) => {
      const s = S[c.i];
      X.copy(s.rightB).multiplyScalar(c.sign);
      Z.crossVectors(X, s.up);
      m4.makeBasis(X, s.up, Z);
      track.surf(s, c.lat, 0.06, P);
      m4.setPosition(P);
      chev.setMatrixAt(n, m4);
    });
    chev.count = chevList.length;
    chev.computeBoundingSphere();
  }
  group.add(chev);

  // 빛 커튼 (블랙홀 쪽 가장자리 밑으로 늘어지는 보라빛, 세기가 숨 쉬듯)
  const curtainTex = canvasTexture(8, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  curtainTex.flipY = false; // uv.y 0 = 텍스처 위 (밝음)
  curtainTex.needsUpdate = true;
  const curtainMat = new THREE.MeshBasicMaterial({ map: curtainTex, color: '#b05cff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  for (const z of pulls) {
    const pos = [], uv = [], idx = [];
    const P = new THREE.Vector3();
    let r = 0;
    for (let i = z.a; i <= z.b; i++, r++) {
      const s = S[wrap(i)];
      const e = z.sign * (track.spaceEdgeLat(wrap(i), z.sign) + 0.05);
      const w = smooth(z.a, z.a + 25, i) * smooth(z.b, z.b - 25, i);
      track.surf(s, e, 0.04, P);
      pos.push(P.x, P.y, P.z);
      track.surf(s, e + z.sign * 1.5, -14 * (0.35 + 0.65 * w), P);
      pos.push(P.x, P.y, P.z);
      uv.push(0, (1 - w) * 0.98, 0, 1);
      if (i < z.b) idx.push(r * 2, r * 2 + 1, r * 2 + 2, r * 2 + 1, r * 2 + 3, r * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    // 세로 방향: uv.y 0 = 위(밝음), 1 = 아래 (텍스처를 뒤집어 씀)
    const m = new THREE.Mesh(geo, curtainMat);
    geo.computeBoundingSphere();
    group.add(m);
  }

  // 가로질러 흐르는 빛 알갱이 (블랙홀 쪽으로 흘러가 가장자리 밖으로 빨려 떨어짐)
  const PN = Math.min(900, pulls.reduce((a, z) => a + Math.round(((z.b - z.a) * ds) / 0.8), 0));
  const pPos = new Float32Array(PN * 3);
  const parts = [];
  const rnd = Math.random;
  const seedPart = (p, first) => {
    const z = pulls[(Math.random() * pulls.length) | 0];
    p.z = z;
    p.i = z.a + Math.floor(rnd() * (z.b - z.a));
    p.lat = -z.sign * (first ? rnd() * 40 - 20 : 16 + rnd() * 8);
    p.h = 0.4 + rnd() * 4.5;
    p.v = 5 + rnd() * 9;
  };
  for (let k = 0; k < PN; k++) {
    const p = {};
    seedPart(p, true);
    parts.push(p);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.95, map: glow, color: '#e9d2ff', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  pts.frustumCulled = false;
  group.add(pts);

  // 중력 소용돌이 (구간 가운데에서 블랙홀 쪽 허공, 다른 도로와 겹치지 않는 곳)
  const bh = new THREE.Vector3(...track.dimension.blackHole).setY(0).normalize();
  const vortexMat = new THREE.MeshBasicMaterial({ map: spiralTex(), color: '#ffffff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const vortices = [];
  for (const z of pulls) {
    const mid = S[wrap(Math.round((z.a + z.b) / 2))];
    let best = null;
    for (const far of [170, 150, 130, 110, 95]) {
      const c = mid.pos.clone().addScaledVector(bh, far);
      let md = Infinity;
      for (let i = 0; i < N; i += 3) {
        if (Math.abs(i - (z.a + z.b) / 2) < (z.b - z.a) / 2 + 40) continue;
        const p = S[i].pos;
        md = Math.min(md, Math.hypot(p.x - c.x, p.z - c.z));
      }
      if (md > 95) {
        best = c;
        break;
      }
    }
    if (!best) best = mid.pos.clone().addScaledVector(bh, 95);
    best.y = mid.pos.y - 4; // 도로 높이쯤: 운전석에서 옆 앞쪽으로 보임
    const g = new THREE.Group();
    g.position.copy(best);
    const disk = new THREE.Mesh(new THREE.CircleGeometry(78, 64), vortexMat);
    // 도로 쪽으로 살짝 세움 (운전자 눈에 나선이 보이게)
    const toRoad = mid.pos.clone().sub(best).normalize();
    disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(toRoad.x, 0.45, toRoad.z).normalize()); // 도로 쪽을 보게 세움
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ff9ae8', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    core.scale.setScalar(70);
    const hole = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 12), new THREE.MeshBasicMaterial({ color: '#000000', fog: false }));
    g.add(core, disk, hole);
    group.add(g);
    vortices.push({ g, disk, core, sign: z.sign });
  }

  // 경고판·가장자리 기둥 (난간 없는 구간 시작 앞: 양쪽 허공에 떠 있음, 부딪히지 않음)
  const beaconMat = new THREE.MeshBasicMaterial({ color: '#7fe7ff', fog: false });
  const beaconGeo = new THREE.CylinderGeometry(0.18, 0.18, 3.2, 8).translate(0, 1.6, 0);
  const beaconPos = [], polePos = [];
  for (const z of zones) {
    // 시작·끝 양쪽 가장자리에 빛 기둥 (난간이 끝나는 자리)
    for (const i of [z.a, z.b])
      for (const sd of [-1, 1]) {
        const s = S[wrap(i)];
        const p = track.surf(s, sd * (track.spaceEdgeLat(wrap(i), sd) + 0.5), -0.2);
        beaconPos.push(p);
      }
    const iw = wrap(z.a - Math.round(Math.min(150, C.warn || 160) / ds)); // 구간 150 m 앞 (250 km/h로 약 2초)
    const sw = S[iw];
    const tex = z.pullSign
      ? signTex('⚫ 블랙홀 중력', z.pullSign > 0 ? '오른쪽으로 끌림 ▶  ·  난간 없음' : '◀ 왼쪽으로 끌림  ·  난간 없음', '#c58cff')
      : signTex('⚠ 난간 없는 길', '떨어지면 복귀 · 가장자리 조심', '#7fe7ff');
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, fog: false });
    for (const sd of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.9), mat);
      track.surf(sw, sd * (HW + 9), 6.5, sign.position);
      sign.rotation.set(0, Math.atan2(sw.tan.x, sw.tan.z) + Math.PI - sd * 0.32, 0);
      group.add(sign);
      polePos.push(sign.position.clone().setY(sign.position.y - 2.4)); // 판 기둥 (빛, 아래 InstancedMesh 하나로)
    }
  }
  // 그리기 호출을 줄이려고 기둥은 InstancedMesh 2개, 기둥 꼭대기 빛은 아래 가장자리 불빛(lampHalo)에 같이 넣음
  const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, Math.max(1, beaconPos.length));
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 6.5, 6).translate(0, -3.25, 0), beaconMat, Math.max(1, polePos.length));
  {
    const m4 = new THREE.Matrix4();
    beaconPos.forEach((p, n) => beacons.setMatrixAt(n, m4.makeTranslation(p.x, p.y, p.z)));
    polePos.forEach((p, n) => poles.setMatrixAt(n, m4.makeTranslation(p.x, p.y, p.z)));
    beacons.count = beaconPos.length;
    poles.count = polePos.length;
    beacons.computeBoundingSphere();
    poles.computeBoundingSphere();
  }
  group.add(beacons, poles);

  // 가장자리 불빛 (활주로 끝 등처럼 10 m마다, 앞으로 흐르며 반짝임: 멀리서도 '여기가 끝'이 보임. 블랙홀 쪽은 보라)
  const lampList = [];
  for (const z of zones)
    for (const sd of [-1, 1]) {
      if (z.side && z.side !== sd) continue;
      for (let i = z.a, k = 0; i <= z.b; i += Math.round(10 / ds), k++) lampList.push({ i: wrap(i), sd, k, pull: (track.pullA[wrap(i)] || 0) * sd > 0.3 });
    }
  for (const p of beaconPos) lampList.push({ pos: p.clone().setY(p.y + 3.3), k: 0, pull: false, beacon: true });
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 10, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }), Math.max(1, lampList.length));
  const lampHalo = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshBasicMaterial({ map: glow, color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), Math.max(1, lampList.length));
  {
    const m4 = new THREE.Matrix4(), P2 = new THREE.Vector3();
    lampList.forEach((l, n) => {
      if (l.pos) P2.copy(l.pos);
      else track.surf(S[l.i], l.sd * (track.spaceEdgeLat(l.i, l.sd) + 0.12), 0.28, P2);
      m4.makeTranslation(P2.x, P2.y, P2.z);
      lamps.setMatrixAt(n, m4);
      lampHalo.setMatrixAt(n, m4);
      lamps.setColorAt(n, new THREE.Color(l.pull ? '#d9a6ff' : '#9ff4ff'));
      lampHalo.setColorAt(n, new THREE.Color(l.pull ? '#b45cff' : '#38e8ff'));
    });
    lamps.count = lampHalo.count = lampList.length;
    lamps.computeBoundingSphere();
    lampHalo.computeBoundingSphere();
    // 빛무리는 늘 카메라를 보게 (onBeforeRender에서 회전만 맞춤)
    lampHalo.onBeforeRender = (r, sc, cam) => {
      for (let n = 0; n < lampList.length; n++) {
        lampHalo.getMatrixAt(n, m4);
        P2.setFromMatrixPosition(m4);
        m4.makeRotationFromQuaternion(cam.quaternion).setPosition(P2);
        lampHalo.setMatrixAt(n, m4);
      }
      lampHalo.instanceMatrix.needsUpdate = true;
    };
  }
  group.add(lamps, lampHalo);
  const lampCol = new THREE.Color(), lampBase = lampList.map((l) => new THREE.Color(l.pull ? '#b45cff' : '#38e8ff'));

  // ---------------------------------------------------------------- 소리 (블랙홀 쪽에서 낮게 우웅 — N 키·음소거면 꺼짐)
  let actx = null, droneGain = null, pan = null, droneOsc = null;
  const wake = () => {
    if (actx) {
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    droneGain = actx.createGain();
    droneGain.gain.value = 0;
    pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
    droneOsc = actx.createOscillator();
    droneOsc.type = 'sawtooth';
    droneOsc.frequency.value = 46;
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const sub = actx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 31;
    const subG = actx.createGain();
    subG.gain.value = 0.8;
    droneOsc.connect(lp);
    sub.connect(subG).connect(lp);
    let node = lp.connect(droneGain);
    if (pan) node = node.connect(pan);
    node.connect(actx.destination);
    droneOsc.start();
    sub.start();
  };
  window.addEventListener('keydown', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });

  // ---------------------------------------------------------------- 매 물리 스텝
  let playerPull = 0, playerSign = 0, fallFx = 0;
  function update(dt, car) {
    if (!car) return;
    clock += dt;
    const a = stepCar(car, dt, true, 'P');
    playerPull = a;
    playerSign = 0;
    // 화면 가장자리 빛을 켤 쪽 = 블랙홀 쪽 (도로 방향으로 달리면 도로 오른쪽 = 화면 오른쪽)
    if (a > 0 && car.trackInfo) playerSign = Math.sign(track.pullA[wrap(car.trackInfo.index ?? 0)] || 0);
    const rs = window.game && window.game.raceSys;
    if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car !== car) stepCar(b.car, dt, false, b.name);
    if (track.inSpace || (car.trackInfo && S[wrap(car.trackInfo.index ?? 0)].space)) warnPlayer(car);
  }

  // ---------------------------------------------------------------- 그릴 때마다
  let lastT = null, shownVeil = -1;
  const P = new THREE.Vector3();
  function animate(time) {
    const t = time ?? performance.now() / 1000;
    const dt = lastT === null ? 1 / 60 : THREE.MathUtils.clamp(t - lastT, 0, 0.1);
    lastT = t;
    const g = window.game;
    const replaying = !!(g && g.replay && g.replay.active);
    const on = !!track.inSpace;
    group.visible = on;
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) scale(.96)';
      }
    }
    // 소리·화면 가장자리
    const k = on && !replaying ? Math.min(1, playerPull / 3.2) : 0;
    const v = Math.round(Math.max(k * 0.85, fallFx * 0.7) * 20) / 20;
    if (v !== shownVeil) {
      shownVeil = v;
      veil.style.opacity = String(v);
      const side = playerSign >= 0 ? 'right' : 'left';
      veil.style.background = fallFx > k ? 'radial-gradient(ellipse at center, rgba(120,60,255,0) 50%, rgba(80,30,200,.5) 100%)' : `linear-gradient(to ${side}, rgba(120,50,255,0) 62%, rgba(150,70,255,.42) 100%)`;
    }
    fallFx = Math.max(0, fallFx - dt * 1.8);
    if (actx && droneGain) {
      const muted = (() => {
        try {
          return !!mixState().muted;
        } catch {
          return false;
        }
      })();
      const want = muted || (g && g.paused) || replaying ? 0 : k * 0.16;
      droneGain.gain.setTargetAtTime(want, actx.currentTime, 0.25);
      if (pan) pan.pan.setTargetAtTime(playerSign * 0.7, actx.currentTime, 0.3);
      droneOsc.frequency.setTargetAtTime(40 + 14 * pulse(), actx.currentTime, 0.3);
    }
    if (!on) return;
    const pk = pulse(); // 보이는 숨 쉬기 = 물리와 같은 시계 (레이스 시계)
    chevMat.opacity = 0.14 + 0.42 * pk;
    chevMat.map.offset.x = -t * 1.4;
    curtainMat.opacity = 0.25 + 0.6 * pk;
    for (const vx of vortices) {
      vx.disk.rotation.z = -vx.sign * t * 0.9;
      vx.core.material.opacity = 0.35 + 0.6 * pk;
      vx.g.scale.setScalar(0.92 + 0.16 * pk);
    }
    for (let n = 0; n < lampList.length; n++) {
      const w = lampList[n].beacon ? 0.75 + 0.25 * Math.sin(t * 5 + n) : 0.5 + 0.5 * Math.sin(lampList[n].k * 0.55 - t * 7);
      lampHalo.setColorAt(n, lampCol.copy(lampBase[n]).multiplyScalar(0.35 + 1.1 * w * w));
    }
    lampHalo.instanceColor.needsUpdate = true;
    // 빛 알갱이
    for (let n = 0; n < PN; n++) {
      const p = parts[n];
      const sg = p.z.sign;
      p.lat += sg * p.v * (0.6 + pk) * dt;
      const edgeL = track.spaceEdgeLat(p.i, sg);
      const beyond = p.lat * sg - edgeL;
      if (beyond > 24) seedPart(p, false);
      const h = p.h - Math.max(0, beyond) * 0.9;
      track.surf(S[wrap(p.i)], p.lat, h, P);
      pPos[n * 3] = P.x;
      pPos[n * 3 + 1] = P.y;
      pPos[n * 3 + 2] = P.z;
    }
    pGeo.attributes.position.needsUpdate = true;
  }
  function reset() {
    clock = 0;
    toastT = 0;
    toast.style.opacity = '0';
    fallFx = 0;
    playerPull = 0;
    for (const z of zones) z.warnedAt = -1e9;
  }

  return { group, update, animate, reset, stats, pulse, get clock() { return clock; }, zones, pulls, pullOff };
}
