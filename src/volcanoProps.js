// 화산 지대 소품·효과 (volcanoMap.js의 buildProps)
//   - 낭떠러지 추락 감지: 도로 끝 밖으로 떨어져 도로보다 5 m 넘게 내려가면 0.25초 뒤 바로 복귀 (용암까지 몇 초씩 떨어지지 않게)
//     플레이어와 봇 모두 (봇은 window.game.raceSys.bots)
//   - 불티(위로 떠오르는 주황 불꽃)와 화산재(천천히 떨어지는 회색 알갱이): 카메라 주변에만 (가벼움)
//   - 화면 위 알림: "🌋 낭떠러지!" (추락), 용암 근처 열기 (화면 가장자리 붉게)
import * as THREE from 'three';

const EMBER_N = 420;
const ASH_N = 520;

export function buildVolcanoProps(track, scene) {
  const group = new THREE.Group();
  group.name = 'volcanoProps';
  scene.add(group);
  const S = track.samples, N = S.length - 1;
  const wrap = (i) => ((i % N) + N) % N;

  // ---------------------------------------------------------------- 알림 (DOM)
  const toast = document.createElement('div');
  toast.id = 'volcanoToast';
  toast.style.cssText =
    'position:fixed;left:50%;top:21%;transform:translateX(-50%) scale(.96);z-index:5;pointer-events:none;opacity:0;transition:opacity .25s, transform .25s;' +
    'font:800 28px/1.2 "Segoe UI","Malgun Gothic",sans-serif;letter-spacing:1px;color:#fff;white-space:nowrap;text-align:center;text-shadow:0 0 12px #ff5a00,0 0 26px #ff3a00';
  // 열기: 화면 가장자리가 붉게 (용암 가까이·추락 중)
  const heat = document.createElement('div');
  heat.id = 'volcanoHeat';
  heat.style.cssText = 'position:fixed;inset:0;z-index:3;pointer-events:none;opacity:0;transition:opacity .15s;background:radial-gradient(ellipse at center, rgba(255,80,0,0) 55%, rgba(255,70,0,.42) 100%)';
  if (document.body) document.body.append(heat, toast);
  let toastT = 0;
  function showToast(text, sub) {
    toast.innerHTML = `${text}<div style="font-size:15px;font-weight:700;opacity:.9;margin-top:2px">${sub || ''}</div>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) scale(1)';
    toastT = 1.6;
  }

  // ---------------------------------------------------------------- 낭떠러지 추락 감지
  const state = new WeakMap(); // car → { idx, fallT }
  const tmp = new THREE.Vector3();
  function follow(st, car) {
    // 지난번 지점 근처(±60 샘플)에서 수평 거리만 보고 가장 가까운 곳 (떨어지는 동안 아래 다른 길로 넘어가지 않게)
    if (st.idx < 0 || car.events.includes('respawn')) {
      st.idx = car.trackInfo ? car.trackInfo.index ?? Math.round(car.trackInfo.t * N) : track.nearest(car.pos).index;
    }
    let best = Infinity, bi = st.idx;
    for (let k = -60; k <= 60; k += 1) {
      const i = wrap(st.idx + k), p = S[i].pos;
      const d = (p.x - car.pos.x) ** 2 + (p.z - car.pos.z) ** 2;
      if (d < best) (best = d), (bi = i);
    }
    if (best > 90 * 90) bi = track.nearest(car.pos).index;
    st.idx = bi;
    return bi;
  }
  function fallCheck(car, dt, isPlayer) {
    let st = state.get(car);
    if (!st) state.set(car, (st = { idx: -1, fallT: 0 }));
    const i = follow(st, car), s = S[i];
    tmp.copy(car.pos).sub(s.pos);
    const lat = tmp.x * s.right.x + tmp.z * s.right.z;
    const side = lat < 0 ? -1 : 1;
    const out = Math.abs(lat) - (s.hw + track.kerbAt(i, side));
    const roadY = track.roadYAt(s, THREE.MathUtils.clamp(lat, -s.hw, s.hw));
    const below = roadY - car.pos.y;
    // 길 끝 밖으로 4 m 넘게 내려감 (떨어지는 중이든 비탈에 걸렸든) / 도로 밑으로 들어감 (도로 판 아래 땅에 걸림)
    const falling = below > 4 && (out > 0.3 || s.gap);
    const underDeck = below > 0.5 && out < 0 && !s.gap; // 차는 보통 도로 면 ±0.05 m에 있음
    st.fallT = falling ? st.fallT + dt : 0;
    st.underT = underDeck ? (st.underT || 0) + dt : 0;
    if (isPlayer) fallHeat = falling ? Math.min(1, fallHeat + dt * 4) : fallHeat;
    if (st.fallT > 0.25 || st.underT > 0.4) {
      st.fallT = st.underT = 0;
      car.respawn();
      st.idx = -1;
      if (isPlayer) showToast(s.gap ? '🌋 용암 협곡에 빠졌어요!' : '🌋 낭떠러지!', '점프는 빠르게, 길 끝은 조심!');
      return true;
    }
    return false;
  }
  let fallHeat = 0;

  // ---------------------------------------------------------------- 불티 + 화산재 (카메라 주변 상자 안에서 돌고 돎)
  const BOX = 70;
  const ePos = new Float32Array(EMBER_N * 3), eVel = new Float32Array(EMBER_N * 3), eLife = new Float32Array(EMBER_N);
  const aPos = new Float32Array(ASH_N * 3);
  const rnd = Math.random;
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  const dotTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    const t = new THREE.CanvasTexture(c);
    return t;
  })();
  const embers = new THREE.Points(eGeo, new THREE.PointsMaterial({ size: 0.55, map: dotTex, color: '#ffae4a', transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  embers.frustumCulled = false;
  const aGeo = new THREE.BufferGeometry();
  aGeo.setAttribute('position', new THREE.BufferAttribute(aPos, 3));
  const ash = new THREE.Points(aGeo, new THREE.PointsMaterial({ size: 0.32, map: dotTex, color: '#8a817c', transparent: true, opacity: 0.55, depthWrite: false }));
  ash.frustumCulled = false;
  group.add(embers, ash);
  let inited = false;
  const center = new THREE.Vector3();
  function seedEmber(k, c) {
    ePos[k * 3] = c.x + (rnd() - 0.5) * BOX * 2;
    ePos[k * 3 + 1] = c.y - 6 + rnd() * 10;
    ePos[k * 3 + 2] = c.z + (rnd() - 0.5) * BOX * 2;
    eVel[k * 3] = (rnd() - 0.5) * 1.5;
    eVel[k * 3 + 1] = 1.5 + rnd() * 3.5;
    eVel[k * 3 + 2] = (rnd() - 0.5) * 1.5;
    eLife[k] = 2 + rnd() * 5;
  }
  function particles(dt, cam) {
    center.copy(cam);
    if (!inited) {
      inited = true;
      for (let k = 0; k < EMBER_N; k++) {
        seedEmber(k, center);
        eLife[k] *= rnd();
      }
      for (let k = 0; k < ASH_N; k++) {
        aPos[k * 3] = center.x + (rnd() - 0.5) * BOX * 2;
        aPos[k * 3 + 1] = center.y + (rnd() - 0.3) * 40;
        aPos[k * 3 + 2] = center.z + (rnd() - 0.5) * BOX * 2;
      }
    }
    const t = performance.now() / 1000;
    for (let k = 0; k < EMBER_N; k++) {
      eLife[k] -= dt;
      const o = k * 3;
      if (eLife[k] <= 0 || Math.abs(ePos[o] - center.x) > BOX || Math.abs(ePos[o + 2] - center.z) > BOX) {
        seedEmber(k, center);
        continue;
      }
      ePos[o] += (eVel[o] + Math.sin(t * 1.7 + k) * 0.8) * dt;
      ePos[o + 1] += eVel[o + 1] * dt;
      ePos[o + 2] += (eVel[o + 2] + Math.cos(t * 1.3 + k) * 0.8) * dt;
    }
    for (let k = 0; k < ASH_N; k++) {
      const o = k * 3;
      aPos[o] += Math.sin(t * 0.6 + k) * 0.5 * dt + 0.6 * dt;
      aPos[o + 1] -= (0.6 + (k % 5) * 0.12) * dt;
      aPos[o + 2] += Math.cos(t * 0.5 + k * 1.3) * 0.5 * dt;
      if (aPos[o + 1] < center.y - 15 || Math.abs(aPos[o] - center.x) > BOX || Math.abs(aPos[o + 2] - center.z) > BOX) {
        aPos[o] = center.x + (rnd() - 0.5) * BOX * 2;
        aPos[o + 1] = center.y + 20 + rnd() * 15;
        aPos[o + 2] = center.z + (rnd() - 0.5) * BOX * 2;
      }
    }
    eGeo.attributes.position.needsUpdate = true;
    aGeo.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 매 물리 스텝
  let lastCam = null;
  function update(dt, car) {
    if (!car) return;
    fallCheck(car, dt, true);
    const rs = window.game && window.game.raceSys;
    if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car !== car) fallCheck(b.car, dt, false);
    // 용암에 가까울수록 화면 가장자리 열기 (차 높이가 용암에서 12 m 안)
    const nearLava = 1 - THREE.MathUtils.clamp((car.pos.y - track.lavaY) / 12, 0, 1);
    fallHeat = Math.max(nearLava * 0.8, fallHeat - dt * 1.5);
    lastCam = car.pos;
  }
  let shownHeat = -1;
  function animate() {
    const g = window.game;
    const cam = g && g.camera ? g.camera.position : lastCam;
    if (cam) particles(1 / 60, cam);
    if (toastT > 0) {
      toastT -= 1 / 60;
      if (toastT <= 0) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) scale(.96)';
      }
    }
    const h = Math.round(fallHeat * 20) / 20;
    if (h !== shownHeat) {
      shownHeat = h;
      heat.style.opacity = String(h);
    }
  }
  function reset() {
    toastT = 0;
    toast.style.opacity = '0';
    fallHeat = 0;
  }

  return { group, update, reset, animate, fallCheck, props: [], cubes: [], barricade: null, barricades: [] };
}
