// 달 중력 기지 소품·효과 (moonMap.js의 buildProps)
//   - 화면 오른쪽(미니맵과 속도계 사이) 중력계: 지금 중력 배수(0.32~1.90 G)와 막대, 구역마다 색 (하늘색 저중력 / 주황 고중력 / 보라 루프)
//   - 구역에 들어갈 때 화면 위 알림 + 짧은 소리 (설정의 소리 끄기·N을 따름)
//   - 바퀴 뒤 달 먼지: 중력이 약하면 높이 천천히 떠오르고, 강하면 바로 떨어짐
//   - 안전장치: 루프 안에서 거의 멈춰 버리면(천장에 붙어 못 움직임) 1.2초 뒤 자동 복귀
import * as THREE from 'three';
import { settings } from './settings.js';

const DUST_N = 720;

export function buildMoonProps(track, scene) {
  const group = new THREE.Group();
  group.name = 'moonProps';
  scene.add(group);

  // ---------------------------------------------------------------- 중력계 (DOM)
  const hud = document.createElement('div');
  hud.id = 'moonGravity';
  hud.style.cssText =
    'position:fixed;right:16px;top:46%;z-index:5;text-align:right;pointer-events:none;padding:8px 12px 9px;border-radius:10px;' +
    'background:rgba(8,12,26,0.62);border:1px solid rgba(120,200,255,0.35);font:700 13px/1.25 "Segoe UI","Malgun Gothic",sans-serif;color:#dfe8ff;' +
    'min-width:118px;backdrop-filter:blur(3px);transition:border-color .3s, box-shadow .3s;';
  hud.innerHTML =
    '<div style="font-size:11px;opacity:.75;letter-spacing:1px">중력 GRAVITY</div>' +
    '<div><span data-g style="font-size:22px">1.00</span><span style="font-size:13px"> G</span> <span data-k style="font-size:12px;opacity:.85"></span></div>' +
    '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,.12);margin-top:4px;overflow:hidden"><div data-bar style="height:100%;width:50%;border-radius:3px;background:#9fb4d8"></div></div>';
  const toast = document.createElement('div');
  toast.style.cssText =
    'position:fixed;left:50%;top:21%;transform:translateX(-50%) scale(.96);z-index:5;pointer-events:none;opacity:0;transition:opacity .25s, transform .25s;' +
    'font:800 26px/1.2 "Segoe UI","Malgun Gothic",sans-serif;letter-spacing:1px;color:#fff;white-space:nowrap;text-align:center';
  if (document.body) document.body.append(hud, toast);
  const elG = hud.querySelector('[data-g]'), elK = hud.querySelector('[data-k]'), elBar = hud.querySelector('[data-bar]');
  let toastT = 0;
  function showToast(text, sub, color) {
    toast.innerHTML = `${text}<div style="font-size:15px;font-weight:700;opacity:.9;margin-top:2px">${sub}</div>`;
    toast.style.textShadow = `0 0 12px ${color}, 0 0 26px ${color}`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) scale(1)';
    toastT = 1.8;
  }

  // ---------------------------------------------------------------- 짧은 소리 (구역 들어갈 때)
  let actx = null;
  const wake = () => {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } else if (actx.state === 'suspended') actx.resume();
  };
  window.addEventListener('keydown', wake);
  function chime(kind) {
    if (!actx || actx.state !== 'running' || settings.get('muted')) return;
    const t0 = actx.currentTime;
    const notes = kind === 'low' ? [660, 880, 1320] : kind === 'high' ? [330, 247, 165] : [523, 659, 784, 1046];
    notes.forEach((f, k) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === 'high' ? 'sawtooth' : 'sine';
      o.frequency.value = f;
      const st = t0 + k * 0.09;
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(kind === 'high' ? 0.05 : 0.08, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, st + 0.5);
      o.connect(g).connect(actx.destination);
      o.start(st);
      o.stop(st + 0.55);
    });
  }

  // 로켓 발사 (moonScenery가 'moonlaunch' 이벤트를 보냄) → 화면 알림 + 낮은 우르릉 소리
  function rumble() {
    if (!actx || actx.state !== 'running' || settings.get('muted')) return;
    const t0 = actx.currentTime, len = 3.2;
    const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = last * 0.985 + (Math.random() * 2 - 1) * 0.015; // 낮은 소리만 남긴 잡음
      d[i] = last * 6;
    }
    const src = actx.createBufferSource(), g = actx.createGain(), lp = actx.createBiquadFilter();
    src.buffer = buf;
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5, t0 + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
    src.connect(lp).connect(g).connect(actx.destination);
    src.start(t0);
  }
  const onLaunch = (e) => {
    showToast('🚀 로켓 발사!', 'ARTEMIS HEAVY — 출발 직선 옆 발사대에서 하늘로', '#ff8a3c');
    rumble();
  };
  window.addEventListener('moonlaunch', onLaunch);

  // ---------------------------------------------------------------- 달 먼지 (점 묶음 하나)
  const dPos = new Float32Array(DUST_N * 3), dVel = new Float32Array(DUST_N * 3), dLife = new Float32Array(DUST_N), dCol = new Float32Array(DUST_N * 3);
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
  const dustTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ size: 0.45, map: dustTex, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.26 }));
  dust.frustumCulled = false;
  group.add(dust);
  let dHead = 0, spawnAcc = 0;
  for (let i = 0; i < DUST_N; i++) dPos[i * 3 + 1] = -9999;
  const back = new THREE.Vector3();

  // ---------------------------------------------------------------- 상태
  let lastKey = 'plain', stuckT = 0, shownG = 1, inLoop = false;
  const zoneKey = (car) => {
    const s = car.trackInfo && car.trackInfo.sample;
    if (!s) return 'plain';
    if (s.roll || (s.magnet && track.roll)) return 'loop';
    return s.zone ? s.zone.kind : 'plain';
  };

  // ---------------------------------------------------------------- 루프 자석 가이드 (2026-11-10 2차)
  //   루프 안(세로로 도는 자석 도로)에서는 차 방향을 차선 방향 쪽으로 천천히 돌려 줌 + 가운데에서 벗어나면 가운데 쪽으로 살짝
  //   → 봇(수평면에서 겨냥하는 운전)이나 핸들을 크게 꺾은 사람이 벽에 긁히지 않음. 플레이어·봇 모든 차에 똑같이
  const GUIDE = { rate: 7, center: 0.09, maxBias: 0.35 };
  const gD = new THREE.Vector3(), gC = new THREE.Vector3();
  function loopGuide(c, dt) {
    const ti = c.trackInfo;
    if (!ti || !c.grounded || c.flying || c.speed < 2) return;
    const s = ti.sample;
    if (!s || !s.roll) return;
    const bias = THREE.MathUtils.clamp(-ti.lateral * GUIDE.center, -GUIDE.maxBias, GUIDE.maxBias);
    gD.copy(s.tan3).addScaledVector(s.right, bias);
    gD.addScaledVector(c.up, -gD.dot(c.up));
    if (gD.lengthSq() < 1e-6) return;
    gD.normalize();
    const a = Math.atan2(gC.crossVectors(c.fwd, gD).dot(c.up), c.fwd.dot(gD));
    c.fwd.applyAxisAngle(c.up, a * (1 - Math.exp(-GUIDE.rate * dt))); // 미끄럼각(slip)은 그대로 → 진행 방향도 같이 돎
  }
  // 점프 공중 자세 잡기: 협곡 위를 나는 동안 차 머리를 날아가는 방향 쪽으로 천천히 돌림
  //   (공중에서 핸들을 꺾으면 차 머리만 돌아 20° 넘게 비스듬히 착지 → 미끄러져 T12 바깥으로 나갔음. 봇도 사람도 똑같이)
  const UPW = new THREE.Vector3(0, 1, 0);
  const jumpNear = new Uint8Array(track.samples.length);
  for (const j of track.jumps || []) {
    const n = track.samples.length - 1, ds = track.length / n;
    for (let i = j.lipI - Math.round(10 / ds); i <= j.landI + Math.round(70 / ds); i++) jumpNear[((i % n) + n) % n] = 1;
  }
  function airAlign(c, dt) {
    const ti = c.trackInfo;
    if (!ti || c.grounded || c.flying || !jumpNear[ti.index]) return;
    const vx = c.vel.x, vz = c.vel.z, vl = Math.hypot(vx, vz), fl = Math.hypot(c.fwd.x, c.fwd.z);
    if (vl < 3 || fl < 0.3) return;
    const a = Math.atan2((c.fwd.z * vx - c.fwd.x * vz) / (vl * fl), (c.fwd.x * vx + c.fwd.z * vz) / (vl * fl));
    c.fwd.applyAxisAngle(UPW, a * (1 - Math.exp(-5 * dt)));
  }
  function assist(c, dt) {
    loopGuide(c, dt);
    airAlign(c, dt);
  }
  function guideAll(dt, car) {
    if (car) assist(car, dt);
    const rs = window.game && window.game.raceSys;
    if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car !== car) assist(b.car, dt);
  }

  // 먼지 뿌리기: 플레이어 차 + 가까운 봇 차 (뒤 바퀴에서 줄기, 착지할 때 둥글게 한 번)
  //   저중력에서는 먼지가 높이 떠서 오래 머묾 (중력 배수만큼 천천히 떨어지고, 수명도 길어짐)
  function emitDust(c, n, spread, upMul, g) {
    const v = Math.abs(c.speed);
    back.copy(c.fwd).multiplyScalar(-2.1).add(c.pos);
    for (let k = 0; k < n; k++) {
      const i = dHead;
      dHead = (dHead + 1) % DUST_N;
      const side = Math.random() < 0.5 ? -1 : 1;
      const a = Math.random() * Math.PI * 2;
      dPos[i * 3] = back.x + c.fwd.z * side * 0.9 + (spread ? Math.cos(a) * spread : (Math.random() - 0.5) * 0.4);
      dPos[i * 3 + 1] = back.y + 0.15;
      dPos[i * 3 + 2] = back.z - c.fwd.x * side * 0.9 + (spread ? Math.sin(a) * spread : (Math.random() - 0.5) * 0.4);
      const up = (1.5 + Math.random() * 2.5) * Math.max(0.6, v / 40) * upMul;
      // 차 속도를 조금 물려받아 뒤로 덜 날아옴 (카메라 바로 앞을 큰 점이 가리지 않게)
      dVel[i * 3] = c.vel.x * 0.5 + (spread ? Math.cos(a) * 4 : (Math.random() - 0.5) * 2);
      dVel[i * 3 + 1] = up * 0.75;
      dVel[i * 3 + 2] = c.vel.z * 0.5 + (spread ? Math.sin(a) * 4 : (Math.random() - 0.5) * 2);
      dLife[i] = 2.2 + 2.4 * Math.max(0, 1 - g); // 저중력: 오래 떠 있음
      const col = 0.42 + Math.random() * 0.16;
      dCol[i * 3] = col;
      dCol[i * 3 + 1] = col * 0.98;
      dCol[i * 3 + 2] = col * 0.94;
    }
  }
  const dustState = new WeakMap();
  function carDust(c, dt, near) {
    let s = dustState.get(c);
    if (!s) dustState.set(c, (s = { acc: 0, wasGround: true }));
    const g = c.gravityScale ? c.gravityScale() : 1;
    const v = Math.abs(c.speed);
    if (c.grounded && !s.wasGround && near) emitDust(c, g < 0.8 ? 26 : 12, 1.6, g < 0.8 ? 1.4 : 0.8, g); // 착지 먼지
    s.wasGround = c.grounded;
    if (!c.grounded || v < 12 || c.surface === 'magnet') return;
    s.acc += dt * Math.min(70, v * 1.4) * (near ? 1 : 0.35) * (g < 0.8 ? 1.4 : 1);
    const n = Math.floor(s.acc);
    if (n > 0) (s.acc -= n), emitDust(c, n, 0, g < 0.8 ? 1.5 : 1, g);
  }

  function update(dt, car) {
    if (!car) return;
    guideAll(dt, car);
    carDust(car, dt, true);
    const rs = window.game && window.game.raceSys;
    if (rs && rs.bots)
      for (const b of rs.bots) {
        if (!b.car || b.car === car) continue;
        const d2 = b.car.pos.distanceToSquared(car.pos);
        if (d2 < 180 * 180) carDust(b.car, dt, d2 < 70 * 70);
      }
    const g = car.gravityScale ? car.gravityScale() : 1;
    const key = zoneKey(car);
    // 구역 바뀜 → 알림
    if (key !== lastKey) {
      const s = car.trackInfo && car.trackInfo.sample;
      if (key === 'low' && s && s.zone) showToast(`🌙 저중력 구역 ${s.zone.g.toFixed(2)} G`, '점프가 둥실 — 멀리 날아가요', '#38d8ff'), chime('low');
      else if (key === 'high' && s && s.zone) showToast(`⬇ 고중력 구역 ${s.zone.g.toFixed(2)} G`, '차가 무거워져요 — 착지·내리막 조심', '#ff8a2a'), chime('high');
      else if (key === 'loop' && !inLoop) showToast('🔄 중력 루프', '자석 도로 — 핸들은 곧게, 속도 유지!', '#b87cff'), chime('loop');
      if (key === 'loop') inLoop = true;
      else inLoop = false;
      lastKey = key;
    }
    // 루프 안에서 거의 멈춤 → 자동 복귀
    const s = car.trackInfo && car.trackInfo.sample;
    if (s && s.roll && Math.abs(car.speed) < 6) {
      stuckT += dt;
      if (stuckT > 1.2) {
        stuckT = 0;
        car.respawn();
      }
    } else stuckT = 0;

    // 먼지 움직임: 달 중력(1.62 m/s²) × 그 자리 구역 배수 (알갱이마다 다르면 비싸서, 플레이어 둘레 구역 값으로)
    const grav = 1.62 * Math.max(0.3, g) * 2.2;
    for (let i = 0; i < DUST_N; i++) {
      if (dLife[i] <= 0) continue;
      dLife[i] -= dt;
      dVel[i * 3 + 1] -= grav * dt;
      dVel[i * 3] *= 1 - 0.6 * dt;
      dVel[i * 3 + 2] *= 1 - 0.6 * dt;
      dPos[i * 3] += dVel[i * 3] * dt;
      dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt;
      dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
      if (dLife[i] <= 0) dPos[i * 3 + 1] = -9999;
    }
    shownG += (g - shownG) * Math.min(1, dt * 6);
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) scale(.96)';
      }
    }
  }

  let lastShown = '';
  function animate() {
    dGeo.attributes.position.needsUpdate = true;
    dGeo.attributes.color.needsUpdate = true;
    // 중력계 글자 (바뀔 때만)
    const txt = shownG.toFixed(2);
    const kind = lastKey;
    const k = txt + kind;
    if (k === lastShown) return;
    lastShown = k;
    elG.textContent = txt;
    const col = kind === 'low' ? '#5ff0ff' : kind === 'high' ? '#ff8a2a' : kind === 'loop' ? '#c08cff' : '#9fb4d8';
    elK.textContent = kind === 'low' ? '저중력' : kind === 'high' ? '고중력' : kind === 'loop' ? '자석 루프' : '';
    elK.style.color = col;
    elBar.style.background = col;
    elBar.style.width = `${Math.min(100, (shownG / 2) * 100)}%`;
    hud.style.borderColor = kind === 'plain' ? 'rgba(120,200,255,0.35)' : col;
    hud.style.boxShadow = kind === 'plain' ? 'none' : `0 0 14px ${col}55`;
  }

  function reset() {
    for (let i = 0; i < DUST_N; i++) (dLife[i] = 0), (dPos[i * 3 + 1] = -9999);
    lastKey = 'plain';
    inLoop = false;
    stuckT = 0;
    toastT = 0;
    toast.style.opacity = '0';
  }

  return { group, update, reset, animate, loopGuide: assist, assist, props: [], cubes: [], barricade: null, barricades: [], hud };
}
