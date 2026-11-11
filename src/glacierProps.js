// 빙하 하이웨이 소품·효과 (glacierMap.js의 buildProps) — 가볍게
//   - 내리는 눈: 카메라 주변 상자 안에서만 도는 눈송이 한 묶음 (Points 1개). 빠를수록 옆으로 비스듬히 흩날림
//   - 강에 빠짐: 다리 밖으로 떨어져 도로보다 4 m 넘게 내려가 1.2초 지나면 복귀 + "❄ 얼어붙은 강에 빠졌어요!" (플레이어·봇 모두)
//     (눈밭으로 나가는 건 괜찮음: 느려지지만 다시 올라올 수 있음)
import * as THREE from 'three';

const SNOW_N = 900;

export function buildGlacierProps(track, scene) {
  const group = new THREE.Group();
  group.name = 'glacierProps';
  scene.add(group);
  const S = track.samples, N = S.length - 1;
  const wrap = (i) => ((i % N) + N) % N;

  // ---------------------------------------------------------------- 알림 (DOM)
  const toast = document.createElement('div');
  toast.id = 'glacierToast';
  toast.style.cssText =
    'position:fixed;left:50%;top:21%;transform:translateX(-50%) scale(.96);z-index:5;pointer-events:none;opacity:0;transition:opacity .25s, transform .25s;' +
    'font:800 28px/1.2 "Segoe UI","Malgun Gothic",sans-serif;letter-spacing:1px;color:#fff;white-space:nowrap;text-align:center;text-shadow:0 0 12px #39b8ff,0 0 26px #1f7dff';
  if (document.body) document.body.append(toast);
  let toastT = 0;
  function showToast(text, sub) {
    toast.innerHTML = `${text}<div style="font-size:15px;font-weight:700;opacity:.9;margin-top:2px">${sub || ''}</div>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) scale(1)';
    toastT = 1.6;
  }

  // ---------------------------------------------------------------- 강에 빠짐 감지 (다리 근처만 봄)
  const state = new WeakMap();
  const tmp = new THREE.Vector3();
  const nearBridge = (i) => track.bridges.some((b) => {
    const m = Math.round((b.a + b.b) / 2);
    let d = Math.abs(wrap(i) - wrap(m));
    d = Math.min(d, N - d);
    return d < track.mS(160);
  });
  function fallCheck(car, dt, isPlayer) {
    if (!track.bridges.length || !car.trackInfo) return false;
    const i = car.trackInfo.index ?? Math.round(car.trackInfo.t * N);
    let st = state.get(car);
    if (!st) state.set(car, (st = { t: 0 }));
    if (!nearBridge(i)) {
      st.t = 0;
      return false;
    }
    const s = S[wrap(i)];
    tmp.copy(car.pos).sub(s.pos);
    const lat = tmp.x * s.right.x + tmp.z * s.right.z;
    const below = track.roadYAt(s, THREE.MathUtils.clamp(lat, -s.hw, s.hw)) - car.pos.y;
    st.t = below > 4 ? st.t + dt : 0;
    if (st.t > 1.2) {
      st.t = 0;
      car.respawn();
      if (isPlayer) showToast('❄ 얼어붙은 강에 빠졌어요!', '다리 위로 돌아가요');
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 내리는 눈 (카메라 주변 상자 안에서 돌고 돎)
  const BOX = 60;
  const pos = new Float32Array(SNOW_N * 3);
  const rnd = Math.random;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dotTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const snow = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.38, map: dotTex, color: '#f2f8ff', transparent: true, opacity: 0.85, depthWrite: false }));
  snow.frustumCulled = false;
  group.add(snow);
  let inited = false;
  const center = new THREE.Vector3();
  const wind = new THREE.Vector3();
  function particles(dt, cam, vel) {
    center.copy(cam);
    if (!inited) {
      inited = true;
      for (let k = 0; k < SNOW_N; k++) {
        pos[k * 3] = center.x + (rnd() - 0.5) * BOX * 2;
        pos[k * 3 + 1] = center.y + (rnd() - 0.3) * 40;
        pos[k * 3 + 2] = center.z + (rnd() - 0.5) * BOX * 2;
      }
    }
    // 바람 + 차가 달리는 반대쪽으로 살짝 흩날림 (속도감)
    wind.set(1.2, 0, 0.6);
    if (vel) wind.addScaledVector(vel, -0.08);
    const t = performance.now() / 1000;
    for (let k = 0; k < SNOW_N; k++) {
      const o = k * 3;
      pos[o] += (wind.x + Math.sin(t * 0.8 + k) * 0.6) * dt;
      pos[o + 1] -= (1.1 + (k % 7) * 0.15) * dt;
      pos[o + 2] += (wind.z + Math.cos(t * 0.6 + k * 1.3) * 0.6) * dt;
      const dx = pos[o] - center.x, dz = pos[o + 2] - center.z;
      if (pos[o + 1] < center.y - 12 || Math.abs(dx) > BOX || Math.abs(dz) > BOX) {
        // 상자 반대편 / 위쪽에서 다시
        pos[o] = Math.abs(dx) > BOX ? center.x - Math.sign(dx) * (BOX - 1) : center.x + (rnd() - 0.5) * BOX * 2;
        pos[o + 2] = Math.abs(dz) > BOX ? center.z - Math.sign(dz) * (BOX - 1) : center.z + (rnd() - 0.5) * BOX * 2;
        pos[o + 1] = center.y + 8 + rnd() * 22;
      }
    }
    geo.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 매 물리 스텝
  let lastCar = null;
  function update(dt, car) {
    if (!car) return;
    fallCheck(car, dt, true);
    const rs = window.game && window.game.raceSys;
    if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car !== car) fallCheck(b.car, dt, false);
    lastCar = car;
  }
  function animate() {
    const g = window.game;
    const cam = g && g.camera ? g.camera.position : lastCar && lastCar.pos;
    if (cam) particles(1 / 60, cam, lastCar && lastCar.vel);
    if (toastT > 0) {
      toastT -= 1 / 60;
      if (toastT <= 0) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) scale(.96)';
      }
    }
  }
  function reset() {
    toastT = 0;
    toast.style.opacity = '0';
  }

  return { group, update, reset, animate, fallCheck, props: [], cubes: [], barricade: null, barricades: [] };
}
