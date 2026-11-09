// 속도감 연출 (data/car.json의 "speedFx"로 세기 조절)
//   1) 바람 줄기: 차 주변 공기 중에 가늘고 흐릿한 빛줄기가 떠 있어서, 빠를수록 길게 늘어나며 옆을 휙휙 스쳐 지나감
//      (세상에 고정된 줄기라 실제 속도만큼 지나감 → 텅 빈 곳에서도 얼마나 빠른지 느껴짐)
//   2) 화면 가장자리 속도선: 아주 빠를 때(가속 모드·부스터) 화면 바깥쪽에만 짧은 선이 가는 방향에서 퍼져 나감
//   3) 비네트: 아주 빠를 때 화면 가장자리가 살짝 어두워져 시야가 앞으로 모이는 느낌
//   4) 바람 소리: 속도에 따라 "쉬이이익" 하는 바람 소리가 커지고 높아짐 (N 키로 엔진 소리와 같이 꺼짐)
//   카메라 흔들림은 넣지 않음 (사용자 요청으로 진동을 줄였음)
import * as THREE from 'three';

const smooth = (x, a, b) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createSpeedFx(scene, cfg = {}) {
  const C = {
    streaks: 90, streakFromKmh: 120, streakFullKmh: 250, streakOpacity: 0.45, streakTime: 0.05, streakWidth: 0.035,
    streakNear: 2.5, streakFar: 75, streakRadius: [3.5, 14], boosterStreak: 1.6,
    lines: 26, linesFromKmh: 170, linesFullKmh: 260, lineOpacity: 0.3, boosterLines: 1.8,
    vignette: 0.28, vignetteFromKmh: 180, boosterVignette: 0.14,
    wind: 0.2, windBooster: 1.4,
    ...cfg,
  };

  // --- 1) 바람 줄기 (3D) ---
  const N = C.streaks;
  const pos = new Float32Array(N * 4 * 3);
  const col = new Float32Array(N * 4 * 3);
  const idx = [];
  for (let i = 0; i < N; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  scene.add(mesh);
  const S = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), b: 0, alive: false }));

  const dir = new THREE.Vector3(0, 0, 1), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3(), tail = new THREE.Vector3(), wv = new THREE.Vector3(), toCam = new THREE.Vector3();
  const base = new THREE.Vector3();

  /** 진행 방향 앞쪽, 길 양옆 낮은 공중에 줄기 하나 놓기 (차가 보이는 길 가운데와 카메라 바로 옆·머리 위는 비워 둠) */
  function spawn(s, camPos, near, far) {
    for (let k = 0; k < 8; k++) {
      const along = near + Math.random() * (far - near);
      const x = (Math.random() < 0.5 ? -1 : 1) * (C.streakRadius[0] + Math.random() * (C.streakRadius[1] - C.streakRadius[0]));
      const y = -0.9 + Math.random() ** 1.6 * 4; // 도로 위 0.3 m ~ 4.3 m, 낮은 쪽이 많게
      if (Math.hypot(x, y + base.y) < 4.5) continue; // 카메라에 너무 가까우면 굵은 빛기둥처럼 보임
      s.p.copy(camPos).addScaledVector(dir, along).addScaledVector(side, x).add(tmp.copy(up).multiplyScalar(y + base.y));
      s.b = 0.45 + Math.random() * 0.55;
      s.alive = true;
      return;
    }
    s.alive = false;
  }

  // --- 2), 3) 화면 위 2D 레이어 (속도선 + 비네트) ---
  const overlay = document.createElement('canvas');
  overlay.id = 'speedFx';
  Object.assign(overlay.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
  const gameCanvas = document.getElementById('game');
  gameCanvas.after(overlay);
  const g2 = overlay.getContext('2d');
  const L = [];
  for (let i = 0; i < Math.ceil(C.lines * C.boosterLines); i++) L.push({ life: 0, max: 0, a: 0, r: 0, v: 0, len: 0, w: 1, e: 1 });
  let overlayDirty = true;
  const focus = new THREE.Vector3();

  function drawOverlay(dt, lineK, vigK, boostK, camera, car) {
    const W = Math.max(1, Math.round(innerWidth)), H = Math.max(1, Math.round(innerHeight));
    if (overlay.width !== W || overlay.height !== H) (overlay.width = W), (overlay.height = H), (overlayDirty = true);
    const active = lineK > 0.01 || vigK > 0.01;
    if (!active) {
      if (overlayDirty) g2.clearRect(0, 0, W, H), (overlayDirty = false);
      return;
    }
    overlayDirty = true;
    g2.clearRect(0, 0, W, H);
    // 퍼져 나가는 중심 = 차가 가는 방향 60 m 앞을 화면에 비춘 곳
    focus.copy(car.pos).addScaledVector(dir, 60).addScaledVector(up, 1.2).project(camera);
    let fx = W / 2, fy = H * 0.45;
    if (focus.z < 1 && Math.abs(focus.x) < 1.5 && Math.abs(focus.y) < 1.5) (fx = ((focus.x + 1) / 2) * W), (fy = ((1 - focus.y) / 2) * H);
    fx = THREE.MathUtils.clamp(fx, W * 0.3, W * 0.7);
    fy = THREE.MathUtils.clamp(fy, H * 0.25, H * 0.65);
    const R = Math.hypot(W, H) / 2;
    // 비네트
    if (vigK > 0.01) {
      const gr = g2.createRadialGradient(fx, fy, R * 0.42, fx, fy, R * 1.12);
      gr.addColorStop(0, 'rgba(4, 8, 16, 0)');
      gr.addColorStop(1, `rgba(4, 8, 16, ${vigK.toFixed(3)})`);
      g2.fillStyle = gr;
      g2.fillRect(0, 0, W, H);
    }
    // 속도선: 가장자리(중심에서 화면 끝까지 거리의 55% 넘는 곳)에만, 짧게 살다가 사라짐
    const want = Math.round(C.lines * lineK * (1 + (C.boosterLines - 1) * boostK));
    const tint = boostK > 0.3 ? '210, 255, 205' : '235, 245, 255';
    g2.lineCap = 'round';
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      l.life += dt;
      if (l.life >= l.max) {
        if (i >= want) continue;
        const a = Math.random() * Math.PI * 2;
        // 그 방향으로 화면 끝까지 거리
        const ca = Math.cos(a), sa = Math.sin(a);
        const e = Math.min(ca > 0 ? (W - fx) / ca : ca < 0 ? -fx / ca : Infinity, sa > 0 ? (H - fy) / sa : sa < 0 ? -fy / sa : Infinity);
        Object.assign(l, {
          life: 0, max: 0.14 + Math.random() * 0.14, a, e, r: 0.55 + Math.random() * 0.3,
          v: 1.0 + Math.random() * 1.0, len: (0.1 + Math.random() * 0.15) * (1 + boostK * 0.6), w: 1.2 + Math.random() * 1.8,
        });
      }
      const t = l.life / l.max;
      const env = Math.sin(Math.PI * t);
      const r0 = (l.r + l.v * l.life) * l.e, r1 = r0 + l.len * l.e;
      const ca = Math.cos(l.a), sa = Math.sin(l.a);
      g2.strokeStyle = `rgba(${tint}, ${(C.lineOpacity * env * Math.min(1, lineK * 1.4)).toFixed(3)})`;
      g2.lineWidth = l.w;
      g2.beginPath();
      g2.moveTo(fx + ca * r0, fy + sa * r0);
      g2.lineTo(fx + ca * r1, fy + sa * r1);
      g2.stroke();
    }
  }

  // --- 4) 바람 소리 ---
  let ctx = null, A = null, muted = false;
  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // 분홍 잡음 비슷하게 (높은 소리가 너무 날카롭지 않게)
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // 쉬이익 (대역 통과, 빠를수록 높아짐)
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.value = 600;
    const rush = ctx.createGain();
    rush.gain.value = 0;
    // 웅웅 (낮은 바람 덩어리가 창문 때리듯 천천히 출렁임)
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    src.connect(bp).connect(rush).connect(ctx.destination);
    src.connect(lp).connect(rumble).connect(ctx.destination);
    src.start();
    A = { bp, rush, lp, rumble };
  }
  window.addEventListener('keydown', () => {
    if (!ctx) initAudio();
    else if (ctx.state === 'suspended') ctx.resume();
  });
  window.addEventListener('pointerdown', () => {
    if (!ctx) initAudio();
  });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  let boostK = 0, time = 0;
  const state = { kmh: 0, streakK: 0, lineK: 0, vigK: 0, boostK: 0 };

  return {
    overlay,
    state,
    cfg: C, // 테스트용 (세기를 바로 바꿔 보기)
    setMuted(m) {
      muted = m;
    },
    /** 테스트 스크린샷(contactSheet 등 카메라를 따로 옮길 때)용: 줄기·화면 레이어 숨김. 다음 update에서 다시 켜짐 */
    hide() {
      mesh.visible = false;
      state.wasOn = false;
      for (const s of S) s.alive = false;
      g2.clearRect(0, 0, overlay.width, overlay.height);
    },
    /** 매 프레임: 카메라 위치가 정해진 뒤에 부름 */
    update(car, camera, dt) {
      time += dt;
      const v = car.grounded ? Math.abs(car.forwardSpeed) : car.vel.length();
      const kmh = v * 3.6;
      const boosting = car.form === 'spike' || car.boostTime > 0;
      boostK = THREE.MathUtils.lerp(boostK, boosting ? 1 : 0, 1 - Math.exp(-(boosting ? 5 : 2) * dt));
      const streakK = Math.min(1.4, smooth(kmh, C.streakFromKmh, C.streakFullKmh) * (1 + (C.boosterStreak - 1) * boostK));
      const lineK = Math.max(smooth(kmh, C.linesFromKmh, C.linesFullKmh), boostK * smooth(kmh, 60, 160));
      const vigK = C.vignette * smooth(kmh, C.vignetteFromKmh, C.streakFullKmh + 10) + C.boosterVignette * boostK;
      Object.assign(state, { kmh, streakK, lineK, vigK, boostK });

      // 진행 방향 기준 좌표 (공중·벽 위에서도 차 기준)
      if (v > 1) dir.copy(car.vel).normalize();
      else camera.getWorldDirection(dir);
      up.copy(car.up);
      side.crossVectors(dir, up).normalize();
      up.crossVectors(side, dir).normalize();
      base.set(0, 1.2 - 2.3, 0); // 카메라(차 위 약 2.3 m)보다 조금 아래가 줄기들의 가운데
      const camPos = camera.position;

      // 바람 줄기
      mesh.visible = streakK > 0.01;
      if (mesh.visible) {
        const len = THREE.MathUtils.clamp(v * C.streakTime * (1 + 0.6 * boostK), 0.4, 9);
        const near = C.streakNear, far = C.streakFar;
        for (let i = 0; i < N; i++) {
          const s = S[i];
          if (s.alive) {
            tmp.subVectors(s.p, camPos);
            const a = tmp.dot(dir);
            const rr = tmp.addScaledVector(dir, -a).length();
            if (a < -3 || a > far + 15 || rr > C.streakRadius[1] * 2) s.alive = false;
          }
          // 처음 켜질 때는 앞쪽 전체에 고르게, 그 뒤로는 먼 앞쪽에서 새로 생김
          if (!s.alive) spawn(s, camPos, state.wasOn ? far * 0.7 : near, far);
        }
        state.wasOn = true;
        for (let i = 0; i < N; i++) {
          const s = S[i];
          const o = i * 12;
          tmp.subVectors(s.p, camPos);
          const a = tmp.dot(dir);
          const rr = tmp.addScaledVector(dir, -a).length(); // 카메라에서 옆으로 떨어진 거리: 가까이 스치는 줄기는 흐리게 (굵은 빛기둥 방지)
          const fade = s.alive ? smooth(a, -3, near + 2) * (1 - smooth(a, far * 0.6, far)) * smooth(rr, 3.5, 9) : 0;
          const k = Math.min(1, C.streakOpacity * streakK * s.b * fade);
          tail.copy(s.p).addScaledVector(dir, -len);
          toCam.subVectors(camPos, s.p);
          wv.crossVectors(dir, toCam).normalize().multiplyScalar(C.streakWidth * (1 + Math.max(0, a) * 0.015));
          pos[o] = s.p.x + wv.x, pos[o + 1] = s.p.y + wv.y, pos[o + 2] = s.p.z + wv.z;
          pos[o + 3] = s.p.x - wv.x, pos[o + 4] = s.p.y - wv.y, pos[o + 5] = s.p.z - wv.z;
          pos[o + 6] = tail.x + wv.x, pos[o + 7] = tail.y + wv.y, pos[o + 8] = tail.z + wv.z;
          pos[o + 9] = tail.x - wv.x, pos[o + 10] = tail.y - wv.y, pos[o + 11] = tail.z - wv.z;
          // 앞쪽(머리)이 밝고 꼬리로 갈수록 사라짐 (더하기 혼합이라 검정 = 투명). 부스터 때는 살짝 초록빛
          const rk = 1 - 0.25 * boostK, bk = 1 - 0.3 * boostK;
          col[o] = col[o + 3] = rk * k;
          col[o + 1] = col[o + 4] = k;
          col[o + 2] = col[o + 5] = bk * k;
          col[o + 6] = col[o + 7] = col[o + 8] = col[o + 9] = col[o + 10] = col[o + 11] = 0;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
      } else {
        state.wasOn = false;
        for (const s of S) s.alive = false;
      }

      drawOverlay(dt, lineK, vigK, boostK, camera, car);

      // 바람 소리
      if (ctx && A) {
        const t = ctx.currentTime;
        const paused = !!(window.game && window.game.paused);
        const on = muted || paused ? 0 : 1;
        const k = Math.min(1.3, (v / 70) ** 2) * (1 + (C.windBooster - 1) * boostK);
        const gust = 0.75 + 0.25 * Math.sin(time * 5.3) * Math.sin(time * 2.1 + 1);
        A.rush.gain.setTargetAtTime(C.wind * k * on, t, 0.08);
        A.bp.frequency.setTargetAtTime(500 + 1900 * Math.min(1.3, v / 70) + 500 * boostK, t, 0.1);
        A.rumble.gain.setTargetAtTime(C.wind * 0.9 * k * gust * on, t, 0.08);
      }
    },
  };
}
