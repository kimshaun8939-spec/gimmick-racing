// 구름섬 그랑프리 · 비행 기술 (2026-11-15 fly2, 사용자 "배랑 비행기가 애매해, 그 모드만의 특징이 없음")
//
//   하늘 협곡에서만 쓰는 운전 기술 세 가지 (물리는 car.js updateFlight·moveInAir, 값은 data/car.json modes.fly.thermal·dive·flare).
//   통과 판정·점수 없음, 사람·봇 같은 규칙. 이 파일은 '미리 보이게' 그리고 '들리게'만 함:
//   1) 상승 기류 (track.thermals, gpTrack.js가 비행 루트에서 자동 배치): 고리 줄 바로 옆 빛나는 바람 기둥.
//      위로 흐르는 바람 줄기 + 금빛 먼지가 돌며 올라감 + 올라가는 화살표 + 꼭대기 뭉게구름 + 그 위를 도는 새 떼. 안에 들면 우웅 바람 소리
//   2) 급강하 가속: 기수를 내리면 비행 최고 속도가 올라감 (높이 = 속도 저금통). 휘이잉 바람 소리가 속도만큼 높아짐
//   3) 부드러운 착지: 착지계(화면 오른쪽 작은 막대)가 내려오는 속도를 보여 줌. 초록 칸에서 내리면 속도 그대로 + 잠깐 가속,
//      빨간 칸이면 쿵(속도 손해), 길과 비뚤게 내리면 끌림 손해. 내린 순간 흙먼지 고리 + 소리
//   gpProps.js가 만들고 update(dt, car)(물리 스텝마다)·animate(time)(그릴 때마다)를 부름. 결과는 game.props.flightFx
import * as THREE from 'three';
import { canvasTexture } from './track.js';
import { mixState } from './audioMix.js';

const TAU = Math.PI * 2;
const DOWN = new THREE.Vector3(0, -1, 0);

/** 위로 흐르는 바람 줄기 (세로로 반복, offset.y를 움직여 흐르게 함) */
function wispTex() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 26; k++) {
      const x = rnd() * w, len = h * (0.25 + rnd() * 0.5), y = rnd() * h, wd = 3 + rnd() * 9;
      const a = 0.25 + rnd() * 0.55;
      for (const dy of [0, -h, h]) {
        const grd = g.createLinearGradient(0, y + dy, 0, y + dy + len);
        grd.addColorStop(0, 'rgba(255,255,255,0)');
        grd.addColorStop(0.5, `rgba(255,250,232,${a})`);
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(x, y + dy + len / 2, wd / 2, len / 2, 0, 0, TAU);
        g.fill();
      }
    }
  });
}
/** 위아래 끝을 흐리게 (alphaMap = 초록 채널) */
function fadeTex() {
  const t = canvasTexture(4, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgb(0,0,0)');
    grd.addColorStop(0.18, 'rgb(255,255,255)');
    grd.addColorStop(0.8, 'rgb(255,255,255)');
    grd.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
function glowTex() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,240,190,0.75)');
    grd.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}
/** 위로 향한 겹화살표 ︽ */
function upArrowTex() {
  const t = canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [y, a] of [[0.62, 0.65], [0.34, 1]]) {
      g.strokeStyle = 'rgba(120,70,0,0.55)';
      g.lineWidth = 22;
      g.beginPath();
      g.moveTo(w * 0.2, h * (y + 0.2));
      g.lineTo(w * 0.5, h * y);
      g.lineTo(w * 0.8, h * (y + 0.2));
      g.stroke();
      g.strokeStyle = `rgba(255,214,90,${a})`;
      g.lineWidth = 13;
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
/** 새 한 마리 (V자 날개, 날개 끝이 위아래로 움직이게 꼭짓점 2개를 따로 둠) */
function birdGeo() {
  const g = new THREE.BufferGeometry();
  // 몸통 가운데 앞·뒤 + 왼쪽 날개 끝 + 오른쪽 날개 끝
  const p = new Float32Array([0, 0, 0.5, 0, 0, -0.35, -1.1, 0.25, -0.2, 1.1, 0.25, -0.2]);
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setIndex([0, 2, 1, 0, 1, 3]);
  g.computeVertexNormals();
  return g;
}

export function createFlightFx(track, parent) {
  const thermals = track.thermals || [];
  if (!track.runway || !track.skyPath || track.skyPath.length < 3) return null;
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('fly2') === '0') return null; // 예전 비행 그대로
  const group = new THREE.Group();
  group.name = 'flightFx';
  parent.add(group);
  const stats = { soft: 0, ok: 0, hard: 0, skew: 0, thermalT: 0, last: null };

  // ---------------------------------------------------------------- 상승 기류 기둥
  const wispMap = wispTex();
  wispMap.repeat.set(3, 1.4);
  const fade = fadeTex();
  const wispMat = new THREE.MeshBasicMaterial({ map: wispMap, alphaMap: fade, color: '#ffe7a8', transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const wispMat2 = wispMat.clone();
  wispMat2.map = wispMap.clone();
  wispMat2.map.repeat.set(2, 1);
  wispMat2.color.set('#ffc552');
  wispMat2.opacity = 0.42;
  const dustMat = new THREE.PointsMaterial({ map: glowTex(), color: '#ffcf5a', size: 1.5, transparent: true, depthWrite: false, opacity: 0.95, sizeAttenuation: true });
  const arrowMat = new THREE.SpriteMaterial({ map: upArrowTex(), transparent: true, depthWrite: false, opacity: 0.9 });
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#f2f6ff', emissiveIntensity: 0.62, flatShading: true });
  const birdMat = new THREE.MeshStandardMaterial({ color: '#2d3340', roughness: 0.8, side: THREE.DoubleSide });
  const cols = [], dusts = [], arrows = [], flocks = [];
  const BOTTOM = -46;
  for (const T of thermals) {
    const ax = T.ax, az = T.az, bx = T.bx, bz = T.bz, r = T.r, top = T.y1;
    const H = top - BOTTOM;
    const at = (u) => [ax + (bx - ax) * u, az + (bz - az) * u];
    // 바람 줄기 원통 (바깥 큰 것 + 안쪽 가는 것) 3개를 이어 길쭉한 기둥 모양
    for (const u of [0, 0.5, 1]) {
      const [x, z] = at(u);
      const outer = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.95, H, 32, 1, true), wispMat);
      outer.position.set(x, BOTTOM + H / 2, z);
      outer.rotation.y = u * 2.1;
      outer.renderOrder = 2;
      group.add(outer);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.5, H * 0.92, 24, 1, true), wispMat2);
      inner.position.set(x, BOTTOM + H * 0.48, z);
      inner.rotation.y = 1 + u * 1.3;
      inner.renderOrder = 2;
      group.add(inner);
      cols.push(outer, inner);
    }
    // 금빛 먼지: 기둥 안을 빙글빙글 돌며 올라감
    const PN = 320;
    const pos = new Float32Array(PN * 3);
    const parts = [];
    for (let n = 0; n < PN; n++) parts.push({ u: Math.random(), a: Math.random() * TAU, rr: r * (0.15 + 0.75 * Math.sqrt(Math.random())), y: BOTTOM + Math.random() * H, v: 7 + Math.random() * 7, w: (0.6 + Math.random() * 0.9) * (Math.random() < 0.5 ? 1 : -1) });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, dustMat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    group.add(pts);
    dusts.push({ T, parts, pos, geo, at, H });
    // 올라가는 화살표
    for (let k = 0; k < 7; k++) {
      const s = new THREE.Sprite(arrowMat.clone());
      s.scale.set(6.5, 6.5, 1);
      s.renderOrder = 4;
      group.add(s);
      arrows.push({ s, T, at, u: (k + 0.5) / 7, y: BOTTOM + 20 + (k / 7) * (top - BOTTOM - 20), off: ((k * 37) % 7) / 7 - 0.5 });
    }
    // 꼭대기 뭉게구름 (기류가 끝나는 높이 = 구름 밑바닥)
    const NC = 11;
    const cap = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), cloudMat, NC); // 한 번에 그림
    const cm = new THREE.Matrix4(), cq = new THREE.Quaternion(), cs = new THREE.Vector3(), cp = new THREE.Vector3();
    for (let k = 0; k < NC; k++) {
      const u = k / (NC - 1);
      const [x, z] = at(u);
      const sz = r * (0.42 + 0.34 * Math.sin(u * Math.PI)) * (0.8 + ((k * 53) % 10) / 25);
      cs.set(sz, sz * 0.62, sz);
      cp.set(x + Math.sin(k * 2.3) * r * 0.4, top + 7 + sz * 0.45, z + Math.cos(k * 1.7) * r * 0.4);
      cap.setMatrixAt(k, cm.compose(cp, cq, cs));
    }
    cap.computeBoundingSphere();
    group.add(cap);
    // 새 떼: 구름 밑에서 기류를 타고 빙빙 돎
    const NB = 11;
    const birds = new THREE.InstancedMesh(birdGeo(), birdMat, NB);
    birds.frustumCulled = false;
    group.add(birds);
    const list = [];
    for (let k = 0; k < NB; k++) list.push({ u: (k % 3) / 2, rad: r * (0.6 + (k % 4) * 0.22), y: top - 16 + (k % 5) * 3.2, a: (k / NB) * TAU, w: 0.55 + (k % 3) * 0.12, flap: k * 1.7 });
    flocks.push({ birds, list, at });
  }

  // ---------------------------------------------------------------- 착지 흙먼지 고리 (재사용)
  const ringMat = new THREE.MeshBasicMaterial({ color: '#e9dcc0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 40, 1), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 3;
  group.add(ring);
  const puffMat = new THREE.MeshStandardMaterial({ color: '#d9c9a6', roughness: 1, transparent: true, opacity: 0, depthWrite: false, flatShading: true });
  const puffs = [];
  const puffGeo = new THREE.IcosahedronGeometry(1, 0);
  for (let k = 0; k < 10; k++) {
    const m = new THREE.Mesh(puffGeo, puffMat);
    m.visible = false;
    group.add(m);
    puffs.push({ m, v: new THREE.Vector3(), life: 0 });
  }
  let ringT = 0, ringK = 1;
  function landFx(car, q) {
    ring.position.copy(car.pos).y += 0.15;
    ring.visible = true;
    ringT = 0;
    ringK = q === 'hard' ? 1.6 : q === 'soft' ? 0.8 : 1;
    ringMat.color.set(q === 'soft' ? '#f4f0dc' : q === 'hard' ? '#b99a6a' : '#e9dcc0');
    const n = q === 'hard' ? 10 : q === 'soft' ? 4 : 6;
    for (let k = 0; k < puffs.length; k++) {
      const p = puffs[k];
      if (k >= n) {
        p.m.visible = false;
        continue;
      }
      const a = (k / n) * TAU + Math.random() * 0.4;
      // 뒷바퀴 뒤에서 양옆·뒤로 퍼짐 (차를 덮지 않게)
      const side = k % 2 ? 1 : -1;
      p.m.position.copy(car.pos).addScaledVector(car.fwd, -2.6 - Math.random()).addScaledVector(car.right, side * (1 + Math.random())).setY(car.pos.y + 0.3);
      p.v.copy(car.right).multiplyScalar(side * (2 + ringK * 3)).addScaledVector(car.fwd, -(2 + Math.random() * 3)).setY(1 + Math.random() * 1.5 * ringK);
      p.life = 1;
      p.m.visible = true;
    }
  }

  // ---------------------------------------------------------------- 착지계 (DOM, 비행 중에만)
  const css = document.createElement('style');
  css.textContent = `
#flyGauge{position:fixed;right:18px;top:38%;z-index:4;pointer-events:none;width:196px;padding:10px 12px 11px;border-radius:14px;
  background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,0) 46%),rgba(9,13,26,.62);border:1px solid rgba(255,255,255,.14);
  box-shadow:0 6px 20px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.07);color:#eef4ff;font:600 12px/1.25 "Pretendard","Segoe UI","Malgun Gothic",sans-serif;
  opacity:0;transform:translateX(12px);transition:opacity .25s,transform .25s}
#flyGauge.on{opacity:1;transform:none}
#flyGauge .fg-row{display:flex;gap:6px;margin-bottom:7px;min-height:20px}
#flyGauge .fg-chip{white-space:nowrap;padding:2px 7px;border-radius:999px;font-size:11.5px;font-weight:700;background:rgba(255,255,255,.08);color:rgba(238,244,255,.45);transition:background .2s,color .2s}
#flyGauge .fg-chip.th.lit{background:rgba(255,200,70,.95);color:#2a1a00}
#flyGauge .fg-chip.dv.lit{background:rgba(120,210,255,.95);color:#04202e}
#flyGauge .fg-lbl{display:flex;justify-content:space-between;font-size:11.5px;color:rgba(238,244,255,.78);margin-bottom:4px}
#flyGauge .fg-lbl b{color:#fff;font-weight:800}
#flyGauge .fg-bar{position:relative;height:12px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.08);display:flex}
#flyGauge .fg-bar i{display:block;height:100%}
#flyGauge .fg-bar .z1{background:#3ad07a}#flyGauge .fg-bar .z2{background:#f2c23a}#flyGauge .fg-bar .z3{background:#ff5a48}
#flyGauge .fg-mk{position:absolute;top:-3px;width:4px;height:18px;margin-left:-2px;border-radius:2px;background:#fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.55),0 0 8px rgba(255,255,255,.7);transition:left .06s linear}
#flyGauge .fg-res{margin-top:7px;height:16px;font-size:12.5px;font-weight:800;text-align:center;opacity:0;transition:opacity .2s}
#flyGauge .fg-res.on{opacity:1}
body.touch-on #flyGauge{top:auto;bottom:46%;right:auto;left:50%;transform:translateX(-50%) scale(.86);transform-origin:50% 100%}
body.touch-on #flyGauge.on{transform:translateX(-50%) scale(.86)}
@media (max-height:520px){#flyGauge{top:30%;width:164px;padding:8px 10px}}
`;
  const gauge = document.createElement('div');
  gauge.id = 'flyGauge';
  gauge.innerHTML =
    '<div class="fg-row"><span class="fg-chip th">⬆ 상승 기류</span><span class="fg-chip dv">⬇ 급강하</span></div>' +
    '<div class="fg-lbl"><span>내려오는 속도</span><b class="fg-vy">0.0 m/s</b></div>' +
    '<div class="fg-bar"><i class="z1"></i><i class="z2"></i><i class="z3"></i><span class="fg-mk"></span></div>' +
    '<div class="fg-lbl" style="margin-top:5px;margin-bottom:0"><span>땅까지</span><b class="fg-agl">– m</b></div>' +
    '<div class="fg-res"></div>';
  if (document.head) document.head.append(css);
  if (document.body) document.body.append(gauge);
  const $ = (s) => gauge.querySelector(s);
  const elVy = $('.fg-vy'), elAgl = $('.fg-agl'), elMk = $('.fg-mk'), elRes = $('.fg-res'), elTh = $('.th'), elDv = $('.dv');
  const BAR_MAX = 24; // 막대 오른쪽 끝 = 24 m/s
  function layoutBar(F) {
    const soft = F.flare?.soft ?? 4, crash = F.flare?.crashSpeed ?? 13;
    const [z1, z2, z3] = gauge.querySelectorAll('.fg-bar i');
    z1.style.width = `${(soft / BAR_MAX) * 100}%`;
    z2.style.width = `${((crash - soft) / BAR_MAX) * 100}%`;
    z3.style.width = `${((BAR_MAX - crash) / BAR_MAX) * 100}%`;
  }
  let barDone = false, gaugeOn = false, resT = 0, lastVy = '', lastAgl = '', lastMk = '', lastTh = null, lastDv = null;
  function showResult(fl, gainKmh) {
    const txt = fl.q === 'soft' ? `부드러운 착지 ✓ ${gainKmh > 1 ? `+${gainKmh} km/h` : '가속!'}` : fl.q === 'hard' ? '쿵! 너무 세게 내렸어요' : fl.skew > 0 ? '비뚤게 내려 끌렸어요' : '착지';
    elRes.textContent = txt;
    elRes.style.color = fl.q === 'soft' ? '#5ff59b' : fl.q === 'hard' ? '#ff7a6a' : fl.skew > 0 ? '#ffb45a' : '#dfe7f5';
    elRes.classList.add('on');
    resT = 1.6;
  }

  // ---------------------------------------------------------------- 소리 (바람·휘이잉·착지)  N 키·음소거면 꺼짐
  let actx = null, windG = null, windF = null, whisG = null, whisF = null, noiseBuf = null;
  const wake = () => {
    if (actx) {
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    const len = actx.sampleRate * 2;
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[i] = b * 4 + (Math.random() * 2 - 1) * 0.15;
    }
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    // 상승 기류: 낮게 우우웅 (밴드패스, 세기만큼 높아짐)
    windF = actx.createBiquadFilter();
    windF.type = 'bandpass';
    windF.frequency.value = 280;
    windF.Q.value = 0.8;
    windG = actx.createGain();
    windG.gain.value = 0;
    src.connect(windF).connect(windG).connect(actx.destination);
    // 급강하: 휘이잉 (좁은 밴드패스, 속도만큼 높아짐)
    const src2 = actx.createBufferSource();
    src2.buffer = noiseBuf;
    src2.loop = true;
    src2.playbackRate.value = 1.3;
    whisF = actx.createBiquadFilter();
    whisF.type = 'bandpass';
    whisF.frequency.value = 900;
    whisF.Q.value = 6;
    whisG = actx.createGain();
    whisG.gain.value = 0;
    src2.connect(whisF).connect(whisG).connect(actx.destination);
    src.start();
    src2.start();
  };
  window.addEventListener('keydown', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });
  const muted = () => {
    try {
      return !!mixState().muted;
    } catch {
      return false;
    }
  };
  function landSound(q) {
    if (!actx || muted()) return;
    const t = actx.currentTime;
    if (q === 'soft') {
      // 타이어가 살짝 끽 + 쉭
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1150, t);
      o.frequency.exponentialRampToValueAtTime(1650, t + 0.07);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + 0.16);
    }
    // 흙먼지 쉭 / 쿵
    const n = actx.createBufferSource();
    n.buffer = noiseBuf;
    const f = actx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = q === 'hard' ? 380 : 1600;
    const g = actx.createGain();
    const peak = q === 'hard' ? 0.5 : q === 'soft' ? 0.12 : 0.22;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (q === 'hard' ? 0.45 : 0.3));
    n.connect(f).connect(g).connect(actx.destination);
    n.start(t, Math.random());
    n.stop(t + 0.5);
    if (q === 'hard') {
      const o = actx.createOscillator(), g2 = actx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(95, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
      g2.gain.setValueAtTime(0.55, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g2).connect(actx.destination);
      o.start(t);
      o.stop(t + 0.4);
    }
  }

  // ---------------------------------------------------------------- 물리 스텝마다 (플레이어 착지 이벤트)
  let seenLanding = null; // 같은 착지를 두 번 세지 않게 (한 화면에 물리 스텝이 여러 번이면 이벤트가 남아 있음)
  function update(dt, car) {
    if (!car) return;
    if (car.thermalK > 0.05) stats.thermalT += dt;
    for (const e of car.events) {
      if (e !== 'flySoft' && e !== 'flyHard' && e !== 'flySkew' && e !== 'flyLand') continue;
      const fl = car.lastFlyLanding;
      if (!fl || fl === seenLanding) continue;
      seenLanding = fl;
      stats[fl.q === 'soft' ? 'soft' : fl.q === 'hard' ? 'hard' : fl.skew > 0 ? 'skew' : 'ok']++;
      stats.last = { q: fl.q, descent: +fl.descent.toFixed(1), yaw: +fl.yaw.toFixed(2), vIn: +fl.vIn.toFixed(1), vOut: +fl.vOut.toFixed(1) };
      const g = window.game;
      if (g && g.replay && g.replay.active) continue;
      landFx(car, fl.q);
      landSound(fl.q);
      showResult(fl, Math.round(Math.max(0, fl.gain) * 3.6));
    }
  }

  // ---------------------------------------------------------------- 그릴 때마다
  let lastT = null;
  const P = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(), s3 = new THREE.Vector3(1, 1, 1);
  function animate(time) {
    const t = time ?? performance.now() / 1000;
    const dt = lastT === null ? 1 / 60 : THREE.MathUtils.clamp(t - lastT, 0, 0.1);
    lastT = t;
    const g = window.game;
    const car = g && g.car;
    const replaying = !!(g && g.replay && g.replay.active);
    const vis = group.parent ? group.parent.visible !== false : true;
    // 기류 기둥 (차 바로 옆 먼지·화살표는 숨김: 기둥 안을 날 때 화면을 가리지 않게)
    const cx = car ? car.pos.x : 1e9, cy = car ? car.pos.y : 1e9, cz = car ? car.pos.z : 1e9;
    wispMap.offset.y -= dt * 0.22;
    wispMat2.map.offset.y -= dt * 0.38;
    for (const D of dusts) {
      const { T, parts, pos, at } = D;
      for (let n = 0; n < parts.length; n++) {
        const p = parts[n];
        p.y += p.v * dt;
        p.a += p.w * dt;
        if (p.y > T.y1 + 2) {
          p.y = BOTTOM + Math.random() * 10;
          p.u = Math.random();
        }
        const [x, z] = at(p.u);
        const px = x + Math.cos(p.a) * p.rr, pz = z + Math.sin(p.a) * p.rr;
        const near = (px - cx) ** 2 + (p.y - cy) ** 2 + (pz - cz) ** 2 < 64;
        pos[n * 3] = px;
        pos[n * 3 + 1] = near ? -500 : p.y;
        pos[n * 3 + 2] = pz;
      }
      D.geo.attributes.position.needsUpdate = true;
    }
    for (const A of arrows) {
      A.y += dt * 9;
      const lo = BOTTOM + 18, hi = A.T.y1 - 2;
      if (A.y > hi) A.y = lo;
      const [x, z] = A.at(A.u);
      A.s.position.set(x + A.off * A.T.r * 0.5, A.y, z);
      const k = Math.min(1, (A.y - lo) / 12, (hi - A.y) / 10);
      const dc = Math.sqrt((A.s.position.x - cx) ** 2 + (A.y - cy) ** 2 + (A.s.position.z - cz) ** 2);
      A.s.material.opacity = 0.85 * Math.max(0, k) * THREE.MathUtils.clamp((dc - 12) / 14, 0, 1);
    }
    for (const F of flocks) {
      for (let k = 0; k < F.list.length; k++) {
        const b = F.list[k];
        b.a += b.w * dt;
        const [x, z] = F.at(b.u);
        const fl = Math.sin(t * 7 + b.flap);
        e3.set(0.15 * fl, -b.a + Math.PI, -0.35); // 원을 따라 기울어 돎
        q4.setFromEuler(e3);
        s3.set(1.1, 1 + 0.6 * fl, 1.1);
        m4.compose(P.set(x + Math.cos(b.a) * b.rad, b.y + Math.sin(t * 0.7 + k) * 0.8, z + Math.sin(b.a) * b.rad), q4, s3);
        F.birds.setMatrixAt(k, m4);
      }
      F.birds.instanceMatrix.needsUpdate = true;
    }
    // 착지 흙먼지
    if (ring.visible) {
      ringT += dt;
      const k = ringT / 0.7;
      ring.scale.setScalar(1.5 + k * 9 * ringK);
      ringMat.opacity = Math.max(0, 0.55 * (1 - k));
      if (k >= 1) ring.visible = false;
    }
    let anyPuff = false;
    for (const p of puffs) {
      if (!p.m.visible) continue;
      p.life -= dt / 0.9;
      if (p.life <= 0) {
        p.m.visible = false;
        continue;
      }
      anyPuff = true;
      p.m.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(Math.exp(-2.2 * dt));
      p.m.scale.setScalar(0.45 + (1 - p.life) * 1.4 * ringK);
    }
    puffMat.opacity = anyPuff ? 0.38 : 0;
    // 착지계 + 소리
    const F = car && car.cfg && car.cfg.modes && car.cfg.modes.fly;
    const flying = !!(car && car.flying && F && vis && !replaying && !(g && g.paused));
    if (F && !barDone) {
      layoutBar(F);
      barDone = true;
    }
    if (flying !== gaugeOn) {
      gaugeOn = flying;
      gauge.classList.toggle('on', flying);
    }
    if (resT > 0) {
      resT -= dt;
      if (resT <= 0) elRes.classList.remove('on');
      if (!gaugeOn && resT > 0) gauge.classList.add('on');
      if (!gaugeOn && resT <= 0) gauge.classList.remove('on');
    }
    let wantWind = 0, wantWhis = 0;
    if (flying) {
      const vy = -car.vel.y; // 실제로 내려오는 속도 (착지 판정과 같은 기준: 기류가 받쳐 주면 그만큼 덜 내려옴)
      const hit = track.castRay(P.copy(car.pos).setY(car.pos.y + 0.5), DOWN, 120);
      const agl = hit ? car.pos.y - hit.point.y : null;
      const sVy = `${Math.max(0, vy).toFixed(1)} m/s`;
      if (sVy !== lastVy) elVy.textContent = lastVy = sVy;
      const sAgl = agl == null ? '— 협곡 위' : `${Math.max(0, agl).toFixed(0)} m`;
      if (sAgl !== lastAgl) elAgl.textContent = lastAgl = sAgl;
      const mk = `${(THREE.MathUtils.clamp(vy, 0, BAR_MAX) / BAR_MAX) * 100}%`;
      if (mk !== lastMk) elMk.style.left = lastMk = mk;
      const th = car.thermalK > 0.08;
      if (th !== lastTh) elTh.classList.toggle('lit', (lastTh = th));
      const over = Math.max(0, car.speed - F.maxSpeed);
      const dv = over > 1;
      if (dv !== lastDv) elDv.classList.toggle('lit', (lastDv = dv));
      if (dv) {
        const s = `⬇ 급강하 +${Math.round(over * 3.6)}`;
        if (elDv.textContent !== s) elDv.textContent = s;
      } else if (elDv.textContent !== '⬇ 급강하') elDv.textContent = '⬇ 급강하';
      wantWind = 0.22 * (car.thermalK || 0);
      wantWhis = 0.09 * THREE.MathUtils.clamp(over / 10, 0, 1) + 0.04 * (car.diveK || 0);
      if (windF && actx) windF.frequency.setTargetAtTime(240 + 26 * (car.thermalUp || 0), actx.currentTime, 0.2);
      if (whisF && actx) whisF.frequency.setTargetAtTime(800 + 70 * over, actx.currentTime, 0.15);
    }
    if (actx && windG) {
      const m = muted() || replaying || (g && g.paused) ? 0 : 1;
      windG.gain.setTargetAtTime(wantWind * m, actx.currentTime, 0.18);
      whisG.gain.setTargetAtTime(wantWhis * m, actx.currentTime, 0.12);
    }
  }
  function reset() {
    ring.visible = false;
    for (const p of puffs) p.m.visible = false;
    resT = 0;
    elRes.classList.remove('on');
    gauge.classList.remove('on');
    gaugeOn = false;
    stats.soft = stats.ok = stats.hard = stats.skew = 0;
    stats.thermalT = 0;
    stats.last = null;
  }
  return { group, update, animate, reset, stats, gauge };
}
