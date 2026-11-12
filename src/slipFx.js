// 슬립스트림·견인 연출 (2026-11-12, 사용자 요청 "슬립스트림을 더 세고 잘 보이게, 견인 기능")
//   raceSystem.update()가 매 화면 부름 (플레이어 차 기준만). 물리는 raceSystem·car.js가 하고, 여기는 보이고 들리는 것만
//   1) 3D: 내가 따라붙은 앞차 뒤에 공기 흐름 줄기 (InstancedMesh 1개 = 그림 호출 1번, 더하기 섞기·깊이 안 씀)
//      충전이 가득(슬링샷 준비)이면 파랑 → 금색
//   2) HUD: 오른쪽 아래 '💨 슬립스트림' 충전 막대 + 안내, '🧲 견인' 칩 (index.html #slipDock, 모양은 src/raceFx.css)
//   3) 화면: 가장자리 바람 줄(#draftLines, 예전 것)을 충전만큼 진하게, 슬링샷 때 번쩍 + "⚡ 슬링샷!" (#slingFlash)
//   4) 소리 (WebAudio 합성, audioMix가 효과음 크기·N 끄기를 따름): 바람 '쉬이익'이 슬립스트림·충전만큼 높아짐,
//      준비되면 높은 반짝 소리, 슬링샷 '휙', 견인이 켜질 때 낮은 '우웅' (15초에 한 번만)
//   2026-11-13 슬링샷 없앰 (기본, o.sling false = SIMPLE): 충전·금색·'옆으로 빠지면' 안내·슬링샷 번쩍임/소리 없음.
//     뒤에 붙어 있으면 파란 줄기 하나로 '켜짐'만 보이고, HUD는 '💨 슬립스트림 +n%'(지금 올라간 최고 속도), 바람 소리는 슬립스트림 세기만큼.
//     &slip=sling이면 예전 충전 막대·금색·슬링샷 그대로
//   리플레이·일시정지처럼 update가 안 불리면 0.3초 뒤 저절로 숨기고 소리를 끔
import * as THREE from 'three';

const N = 26; // 공기 줄기 수
const CYAN = new THREE.Color(0.55, 0.9, 1), GOLD = new THREE.Color(1, 0.78, 0.28);

function streakTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 128; x++) {
      const u = x / 127, v = (y - 7.5) / 7.5;
      const along = u < 0.7 ? Math.pow(u / 0.7, 1.6) : Math.pow((1 - u) / 0.3, 0.8); // 앞(차 쪽)은 뾰족, 뒤로 길게
      const a = along * Math.exp(-v * v * 3.2);
      const k = (y * 128 + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(255 * a);
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSlipFx(o = {}) {
  const getScene = o.getScene || (() => null);
  const D = o.draftCfg || {};
  const readyAt = D.ready ?? 0.9;
  const SIMPLE = !o.sling; // 슬링샷 없음 (기본)

  // ---------- 3D 공기 줄기 ----------
  let mesh = null;
  const seeds = [];
  for (let i = 0; i < N; i++)
    seeds.push({ lat: Math.random() * 2 - 1, h: 0.15 + Math.random() * 1.45, len: 3 + Math.random() * 4, w: 0.09 + Math.random() * 0.13, sp: 0.85 + Math.random() * 0.6, u: Math.random(), ph: Math.random() * 6.28 });
  function ensureMesh() {
    if (mesh) return mesh;
    const scene = getScene();
    if (!scene) return null;
    const mat = new THREE.MeshBasicMaterial({ map: streakTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, side: THREE.DoubleSide });
    mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, N);
    mesh.name = 'slipWake'; // 이름이 있으면 staticBatch가 안 건드림
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _a = new THREE.Vector3(), _n = new THREE.Vector3(), _y = new THREE.Vector3(), _x = new THREE.Vector3(), _c = new THREE.Color();
  let wakeVis = 0, wakeT = 0;
  function updateWake(dt, camera, src, myPos, draft, charge) {
    const want = src ? Math.min(1, draft / 0.6) : 0;
    wakeVis += (want - wakeVis) * Math.min(1, dt * (want > wakeVis ? 5 : 8));
    if (!src && wakeVis < 0.02) {
      if (mesh) mesh.visible = false;
      return;
    }
    if (!ensureMesh() || !src) {
      if (mesh && !src) mesh.visible = false;
      return;
    }
    wakeT += dt;
    mesh.visible = true;
    const fwd = src.fwd, right = src.right, up = src.up || THREE.Object3D.DEFAULT_UP;
    _a.copy(fwd).normalize();
    const gap = myPos ? Math.max(0, (src.pos.x - myPos.x) * _a.x + (src.pos.z - myPos.z) * _a.z) : 20;
    const span = THREE.MathUtils.clamp(gap + 9, 12, 44); // 내 차 옆을 지나 뒤까지 흐름
    const readyK = SIMPLE ? 0 : THREE.MathUtils.clamp((charge - readyAt + 0.25) / 0.25, 0, 1);
    _c.copy(CYAN).lerp(GOLD, readyK);
    const vis = SIMPLE ? wakeVis : wakeVis * (0.55 + 0.45 * Math.min(1, charge / readyAt));
    for (let i = 0; i < N; i++) {
      const s = seeds[i];
      s.u += dt * s.sp * (0.8 + 0.6 * readyK);
      if (s.u >= 1) {
        s.u -= 1;
        s.lat = Math.random() * 2 - 1;
        s.h = 0.15 + Math.random() * 1.45;
      }
      const back = 1.6 + s.u * span;
      const spread = Math.min(2.5, 0.8 + 0.06 * back); // 뒤로 갈수록 넓게 퍼짐 → 내 차 양옆으로 지나감
      const lat = s.lat * spread + Math.sin(wakeT * 3 + s.ph) * 0.12;
      _p.copy(src.pos).addScaledVector(_a, -back).addScaledVector(right, lat).addScaledVector(up, s.h);
      // 줄기 방향(앞뒤)을 축으로 카메라 쪽을 보게 돌림 (원통 빌보드)
      _n.copy(camera.position).sub(_p);
      _n.addScaledVector(_a, -_n.dot(_a));
      if (_n.lengthSq() < 1e-6) _n.copy(up);
      _n.normalize();
      _y.crossVectors(_n, _a);
      const len = s.len * (0.8 + 0.5 * readyK);
      _m.makeBasis(_x.copy(_a).multiplyScalar(len), _y.multiplyScalar(s.w * (1 + 0.6 * readyK)), _n);
      _m.setPosition(_p);
      mesh.setMatrixAt(i, _m);
      const camD = camera.position.distanceTo(_p);
      const a = Math.sin(Math.PI * s.u) * vis * 1.25 * THREE.MathUtils.clamp((camD - 2.5) / 7, 0, 1); // 카메라 바로 앞은 흐리게 (화면을 덮지 않게)
      mesh.instanceColor.setXYZ(i, _c.r * a, _c.g * a, _c.b * a);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  // ---------- HUD ----------
  const $ = (id) => document.getElementById(id);
  const box = $('draftBox'), tow = $('towBox'), lines = $('draftLines');
  let flash = $('slingFlash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'slingFlash';
    flash.innerHTML = '<b>⚡ 슬링샷!</b>';
    document.body.appendChild(flash);
  }
  const pct = box && box.querySelector('em'), fill = box && box.querySelector('.sl-bar i'), tip = box && box.querySelector('.sl-tip');
  const twFill = tow && tow.querySelector('.tw-bar i');
  // 견인 3차 (2026-11-12): 세기 % 글자 (멀수록 커지는 게 보이게)
  let twPct = tow && tow.querySelector('.tw-pct');
  if (tow && !twPct) {
    twPct = document.createElement('em');
    twPct.className = 'tw-pct';
    tow.appendChild(twPct);
  }
  if (box) box.classList.toggle('simple', SIMPLE); // 막대·안내 숨김 (raceFx.css)
  let shown = { on: null, pct: -1, ready: null, tow: -1, towOn: null, lines: -1 };
  function setHud(draft, charge, towK, towOn, gain = 0) {
    const on = draft > 0.12 || charge > 0.05;
    if (box && on !== shown.on) box.classList.toggle('on', (shown.on = on));
    const p = SIMPLE ? Math.round(gain * 100) : Math.round(Math.min(1, charge / readyAt) * 20) * 5;
    if (p !== shown.pct) {
      shown.pct = p;
      if (pct) pct.textContent = SIMPLE ? '+' + p + '%' : p + '%';
      if (fill) fill.style.width = p + '%';
    }
    const ready = !SIMPLE && charge >= readyAt;
    if (ready !== shown.ready) {
      shown.ready = ready;
      if (box) box.classList.toggle('ready', ready);
      if (tip) tip.textContent = ready ? '⚡ 옆으로 빠지면 슬링샷!' : '바짝 붙어서 충전 중…';
    }
    const lq = Math.round(Math.min(1, Math.max(0, draft - 0.12) / 0.5) * (SIMPLE ? 0.85 : 0.6 + 0.4 * Math.min(1, charge / readyAt)) * 20) / 20;
    if (lq !== shown.lines && lines) {
      shown.lines = lq;
      lines.style.opacity = lq * 0.95;
      lines.classList.toggle('ready', ready);
    }
    const tOn = towK > 0.06;
    if (tow && tOn !== shown.towOn) tow.classList.toggle('on', (shown.towOn = tOn));
    const tq = Math.round(towK * 20) * 5;
    if (tq !== shown.tow && twFill) {
      shown.tow = tq;
      twFill.style.width = tq + '%';
      if (twPct) twPct.textContent = tq + '%';
    }
    if (tow) tow.classList.toggle('off', !towOn);
  }
  function hideAll() {
    setHud(0, 0, 0, true);
    if (mesh) mesh.visible = false;
    wakeVis = 0;
  }
  let flashT = 0;
  function slingFlash() {
    flash.classList.remove('go');
    void flash.offsetWidth; // 애니메이션 다시 시작
    flash.classList.add('go');
    flashT = 1.2;
  }

  // ---------- 소리 ----------
  let ctx = null, S = null;
  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || ctx) return;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    bp.Q.value = 1.4;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    noise.connect(bp).connect(wind).connect(master);
    // 준비 반짝: 두 음 + 떨림
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = o2.type = 'sine';
    o1.frequency.value = 1046;
    o2.frequency.value = 1568;
    const trem = ctx.createOscillator();
    trem.frequency.value = 7;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.5;
    const shine = ctx.createGain();
    shine.gain.value = 0;
    const shineAm = ctx.createGain();
    shineAm.gain.value = 0.5;
    trem.connect(tremG).connect(shineAm.gain);
    o1.connect(shineAm);
    o2.connect(shineAm);
    shineAm.connect(shine).connect(master);
    noise.start();
    o1.start();
    o2.start();
    trem.start();
    S = { master, buf, bp, wind, shine };
  }
  const wake = () => {
    if (!ctx) initAudio();
    else if (ctx.state === 'suspended') ctx.resume();
  };
  window.addEventListener('keydown', wake);
  window.addEventListener('pointerdown', wake);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });
  function oneShot(kind) {
    if (!ctx || !S || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (kind === 'sling') {
      // '휙': 잡음이 높은 데서 낮은 데로 쓸려 내려감 + 낮은 '쿵'
      const src = ctx.createBufferSource();
      src.buffer = S.buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 2.2;
      f.frequency.setValueAtTime(2600, t);
      f.frequency.exponentialRampToValueAtTime(320, t + 0.65);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      src.connect(f).connect(g).connect(S.master);
      src.start(t, Math.random());
      src.stop(t + 0.8);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.28);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.connect(og).connect(S.master);
      o.start(t);
      o.stop(t + 0.35);
    } else if (kind === 'tow') {
      // 견인 켜짐: 낮은 '우웅' (부드럽게 올라갔다 내려감)
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(90, t);
      o.frequency.linearRampToValueAtTime(140, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g).connect(S.master);
      o.start(t);
      o.stop(t + 0.75);
    }
  }
  function setSound(draft, charge) {
    if (!ctx || !S) return;
    const t = ctx.currentTime;
    const ready = !SIMPLE && charge >= readyAt;
    if (SIMPLE) charge = Math.min(1, draft) * 0.6; // 슬링샷 없음: 바람 소리는 슬립스트림 세기만
    S.wind.gain.setTargetAtTime(Math.min(1, draft) * (0.07 + 0.06 * Math.min(1, charge)), t, 0.08);
    S.bp.frequency.setTargetAtTime(380 + 1100 * Math.min(1, draft) + 900 * Math.min(1, charge), t, 0.1);
    S.shine.gain.setTargetAtTime(ready && draft > 0.2 ? 0.022 : 0, t, 0.06);
  }

  // ---------- 지켜보기: update가 안 불리면 숨김 ----------
  let lastUpdate = 0, hidden = true;
  setInterval(() => {
    if (!hidden && performance.now() - lastUpdate > 300) {
      hidden = true;
      hideAll();
      setSound(0, 0);
    }
  }, 250);

  let towWas = 0, towSoundAt = -1e9;
  return {
    /**
     * st = { racing, draft, charge, gain(슬립스트림으로 올라간 최고 속도 비율), src(앞차 Car 또는 null), myPos, tow(0~1), towOn(견인 켜짐), sling(이번에 슬링샷, &slip=sling만) }
     */
    update(dt, camera, st) {
      lastUpdate = performance.now();
      hidden = false;
      const draft = st.racing ? st.draft || 0 : 0, charge = st.racing ? st.charge || 0 : 0;
      updateWake(dt, camera, st.racing && draft > 0.03 ? st.src : null, st.myPos, draft, charge);
      setHud(draft, charge, st.racing ? st.tow || 0 : 0, st.towOn !== false, st.racing ? st.gain || 0 : 0);
      setSound(draft, charge);
      if (st.sling && !SIMPLE) {
        slingFlash();
        oneShot('sling');
      }
      if (flashT > 0 && (flashT -= dt) <= 0) flash.classList.remove('go');
      const tw = st.racing ? st.tow || 0 : 0;
      if (tw > 0.15 && towWas <= 0.15 && performance.now() - towSoundAt > 15000) {
        towSoundAt = performance.now();
        oneShot('tow');
      }
      towWas = tw;
    },
    hide: hideAll,
    get mesh() {
      return mesh;
    },
    /** 미리 만들어 두기 (셰이더를 불러오는 화면에서 미리 컴파일되게) */
    prepare() {
      ensureMesh();
    },
  };
}
