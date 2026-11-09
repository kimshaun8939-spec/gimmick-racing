// 달 중력 기지 소품·효과 (moonMap.js의 buildProps)
//   - 화면 오른쪽(미니맵과 속도계 사이) 중력계: 지금 중력 배수(0.32~1.90 G)와 막대, 구역마다 색 (하늘색 저중력 / 주황 고중력 / 보라 루프)
//   - 구역에 들어갈 때 화면 위 알림 + 짧은 소리 (설정의 소리 끄기·N을 따름)
//   - 바퀴 뒤 달 먼지: 중력이 약하면 높이 천천히 떠오르고, 강하면 바로 떨어짐
//   - 안전장치: 루프 안에서 거의 멈춰 버리면(천장에 붙어 못 움직임) 1.2초 뒤 자동 복귀
import * as THREE from 'three';
import { settings } from './settings.js';

const DUST_N = 360;

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
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ size: 0.75, map: dustTex, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.42 }));
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

  function update(dt, car) {
    if (!car) return;
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

    // 먼지: 땅 위에서 빠르면 뒤에 뿌림
    const v = Math.abs(car.speed);
    if (car.grounded && v > 12 && car.surface !== 'magnet') {
      spawnAcc += dt * Math.min(70, v * 1.4);
      back.copy(car.fwd).multiplyScalar(-2.1).add(car.pos);
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        const i = dHead;
        dHead = (dHead + 1) % DUST_N;
        const side = Math.random() < 0.5 ? -1 : 1;
        dPos[i * 3] = back.x + car.fwd.z * side * 0.9 + (Math.random() - 0.5) * 0.4;
        dPos[i * 3 + 1] = back.y + 0.15;
        dPos[i * 3 + 2] = back.z - car.fwd.x * side * 0.9 + (Math.random() - 0.5) * 0.4;
        const up = (1.5 + Math.random() * 2.5) * (v / 40);
        dVel[i * 3] = car.vel.x * 0.25 + (Math.random() - 0.5) * 2;
        dVel[i * 3 + 1] = up;
        dVel[i * 3 + 2] = car.vel.z * 0.25 + (Math.random() - 0.5) * 2;
        dLife[i] = 2.6;
        const c = 0.42 + Math.random() * 0.16;
        dCol[i * 3] = c;
        dCol[i * 3 + 1] = c * 0.98;
        dCol[i * 3 + 2] = c * 0.94;
      }
    }
    // 먼지 움직임: 달 중력(1.62 m/s²) × 구역 배수 → 저중력에서는 오래 떠 있음
    const grav = 1.62 * g * 2.2;
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

  return { group, update, reset, animate, props: [], cubes: [], barricade: null, barricades: [], hud };
}
