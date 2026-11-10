// 노을 해안 서킷 배 구간 놀거리 (2026-11-10, 사용자 요청 "배 탈 때 심심해 / 옆에 콘이 아무 의미가 없어")
//   seaMap.js의 buildProps가 만들고, 매 물리 스텝 update(dt, car) · 매 화면 animate(time)을 부름
//
//   1) 부표 게이트 (data.buoyGates): 주황 부표 두 개 + 위 화살표 띠 = 문. 사이로 지나가면 물살 가속(car.boatSurge) + 띵 소리 +
//      "부표 게이트 n/전체", 연달아 지나가면 연속 ×n (가속이 더 셈), 전부 지나가면 "퍼펙트 슬라럼!" 큰 가속.
//      문을 놓치면 빨갛게 꺼지고 연속이 끊김. 부표 기둥에 박으면 기둥이 튕겨 나가고 느려짐
//   2) 물길 양옆 부표 줄 (data.laneBuoys): 예전엔 그냥 장식(콘처럼 보였음) → 이제 "빠른 물" 경계.
//      부표 밖은 거친 물이라 느려지고, 부표에 박으면 부표가 날아가고 느려짐 (시간이 지나면 제자리로 돌아옴)
//   3) 급류 (data.currents): 물 위 하늘색 화살표 띠. 안에 있으면 물살 가속
//   4) 배 연출: 꼬리 물기둥(수탉 꼬리), 카빙(드리프트 키) 때 바깥으로 솟는 물벽, 뒤에 남는 거품 자국, 물살 소리·게이트 소리
//   모두 플레이어 차만 점수·가속을 받음 (봇은 레이싱 라인대로 달리고, 부표는 봇이 스치면 모습만 튕김)
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
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const R = (a, b) => a + Math.random() * (b - a);

/** 게이트 기둥: 물에 뜬 주황 몸통 + 주황·흰 줄무늬 기둥 + 검은 고리 (꼭대기 등은 따로) */
function postGeometry() {
  const parts = [
    colored(new THREE.CylinderGeometry(0.62, 0.85, 0.9, 12), '#ff5a14', M(0, 0.05, 0)),
    colored(new THREE.TorusGeometry(0.8, 0.12, 6, 14), '#1d2330', M(0, 0.32, 0, Math.PI / 2)),
  ];
  for (let k = 0; k < 6; k++) parts.push(colored(new THREE.CylinderGeometry(0.3, 0.34, 0.75, 10), k % 2 ? '#ffffff' : '#ff6a1a', M(0, 0.9 + k * 0.75, 0)));
  parts.push(colored(new THREE.CylinderGeometry(0.5, 0.34, 0.2, 10), '#1d2330', M(0, 5.1, 0)));
  return mergeGeometries(parts);
}
/** 물길 양옆 부표: 동그란 공 + 흰 띠 + 짧은 막대와 꼭대기 반사판 (예전 원뿔 꼭지는 "콘"처럼 보였음). 색은 인스턴스 색 */
function buoyGeometry() {
  return mergeGeometries([
    colored(new THREE.SphereGeometry(0.78, 14, 10), '#ffffff', M(0, 0.2, 0)),
    colored(new THREE.TorusGeometry(0.8, 0.09, 6, 16), '#f2f2f2', M(0, 0.25, 0, Math.PI / 2)),
    colored(new THREE.TorusGeometry(0.62, 0.1, 6, 14), '#2a2f38', M(0, -0.25, 0, Math.PI / 2)),
    colored(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6), '#2a2f38', M(0, 1.3, 0)),
    colored(new THREE.BoxGeometry(0.42, 0.42, 0.06), '#ffe14a', M(0, 1.85, 0, 0, 0, Math.PI / 4)),
  ]);
}
/** 동그랗게 번지는 점 (거품·물방울) */
function softTexture(stretch = 1) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  g.scale(1, stretch);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, 31, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** 화살표 무늬 (게이트 띠: ▶ 세 개, 급류: 위로 향하는 V자). 흰색 → 인스턴스 색/재질 색을 곱함 */
function arrowTexture(kind) {
  const c = document.createElement('canvas');
  c.width = kind === 'banner' ? 256 : 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (kind === 'banner') {
    g.fillStyle = 'rgba(70,70,70,0.85)';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 6);
    g.fillRect(0, 58, 256, 6);
    // 아래를 가리키는 V자 세 개 = "이 문 아래로 지나가세요"
    for (let k = 0; k < 3; k++) {
      const x = 52 + k * 76;
      g.beginPath();
      g.moveTo(x - 26, 12);
      g.lineTo(x - 10, 12);
      g.lineTo(x, 30);
      g.lineTo(x + 10, 12);
      g.lineTo(x + 26, 12);
      g.lineTo(x, 54);
      g.closePath();
      g.fill();
    }
  } else {
    // 급류: 아래(v=0)에서 위(v=1)로 향하는 굵은 V자 (트랙 진행 방향) + 옅은 바탕
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(4, 44);
    g.lineTo(32, 12);
    g.lineTo(60, 44);
    g.lineTo(48, 52);
    g.lineTo(32, 32);
    g.lineTo(16, 52);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createSeaGates(track, scene) {
  const data = track.data || {};
  const G = data.buoyGates, LB = data.laneBuoys, CUR = data.currents || [];
  const HW = track.width / 2;
  const group = new THREE.Group();
  group.name = 'seaGates';
  scene.add(group);
  const V = () => new THREE.Vector3();
  const flat = (v) => new THREE.Vector3(v.x, 0, v.z).normalize();
  const waterT = track.waterRanges && track.waterRanges[0] ? track.waterRanges[0] : { t0: 2, t1: -1 };
  const inWaterT = (t, pad = 0) => t > waterT.t0 - pad && t < waterT.t1 + pad;

  // ================================================================ 소리 (첫 키 입력 뒤에 만듦, 소리 끄기는 audioMix가 함께 처리)
  const sfx = (() => {
    let ctx = null, hiss = null, hissBP = null;
    function init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      sfx.noiseBuf = buf;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      hissBP = ctx.createBiquadFilter();
      hissBP.type = 'bandpass';
      hissBP.frequency.value = 900;
      hissBP.Q.value = 0.7;
      hiss = ctx.createGain();
      hiss.gain.value = 0;
      src.connect(hissBP).connect(hiss).connect(ctx.destination);
      src.start();
    }
    const wake = () => {
      if (!ctx) init();
      else if (ctx.state === 'suspended') ctx.resume();
    };
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
    const ok = () => ctx && (ctx.state === 'running' || sfx.force);
    function tone(freq, t0, dur, vol, type = 'sine', slideTo = 0) {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gn.gain.setValueAtTime(0, t0);
      gn.gain.linearRampToValueAtTime(vol, t0 + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      o.connect(gn).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
    function noise(t0, dur, vol, f0, f1, type = 'bandpass') {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
      s.buffer = sfx.noiseBuf;
      f.type = type;
      f.frequency.setValueAtTime(f0, t0);
      f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      gn.gain.setValueAtTime(vol, t0);
      gn.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      s.connect(f).connect(gn).connect(ctx.destination);
      s.start(t0, Math.random());
      s.stop(t0 + dur + 0.05);
    }
    const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19];
    return {
      noiseBuf: null,
      force: false, // 테스트용: 소리 장치가 멈춰 있어도 소리 만들기를 실행 (오류 확인)
      init: () => wake(),
      /** 게이트 통과: 연속일수록 높은 음 (띵-딩) */
      gate(combo) {
        if (!ok()) return;
        const t = ctx.currentTime, st = PENTA[Math.min(PENTA.length - 1, combo - 1)];
        const f = 660 * Math.pow(2, st / 12);
        tone(f, t, 0.35, 0.16);
        tone(f * 1.5, t + 0.07, 0.4, 0.12);
        noise(t, 0.35, 0.05, 2500, 900);
      },
      /** 퍼펙트 슬라럼: 위로 올라가는 화음 */
      perfect() {
        if (!ok()) return;
        const t = ctx.currentTime;
        [0, 4, 7, 12, 16].forEach((st, i) => tone(523 * Math.pow(2, st / 12), t + i * 0.07, 0.6, 0.12, 'triangle'));
        noise(t, 0.9, 0.08, 600, 3500);
      },
      /** 게이트를 놓침: 뚜우 */
      miss() {
        if (!ok()) return;
        tone(260, ctx.currentTime, 0.3, 0.09, 'triangle', 150);
      },
      /** 부표에 박음: 퉁 + 철썩 */
      thunk(big) {
        if (!ok()) return;
        const t = ctx.currentTime;
        tone(big ? 120 : 170, t, 0.22, 0.25, 'sine', big ? 60 : 90);
        noise(t, 0.45, big ? 0.22 : 0.14, 1400, 300, 'lowpass');
      },
      /** 급류에 들어감: 쏴아 */
      whoosh() {
        if (!ok()) return;
        noise(ctx.currentTime, 0.8, 0.12, 400, 2200);
      },
      /** 물살 소리: 물 위에서 빠를수록, 카빙할수록 크고 밝게 */
      hiss(level, bright) {
        if (!hiss) return;
        const t = ctx.currentTime;
        hiss.gain.setTargetAtTime(level, t, 0.08);
        hissBP.frequency.setTargetAtTime(700 + 2600 * bright, t, 0.1);
      },
    };
  })();

  // ================================================================ 화면 글자 (게이트 수 칩 + 잠깐 뜨는 글자)
  const chip = document.createElement('div');
  chip.id = 'seaGateHud';
  chip.style.cssText = 'position:fixed;top:86px;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:12px;background:rgba(10,24,48,0.6);color:#fff;font:700 17px system-ui,sans-serif;z-index:5;pointer-events:none;opacity:0;transition:opacity .35s;white-space:nowrap;text-shadow:0 1px 3px #0008';
  const pop = document.createElement('div');
  pop.id = 'seaGatePop';
  pop.style.cssText = 'position:fixed;top:31%;left:50%;transform:translate(-50%,0) scale(1);font:800 26px system-ui,sans-serif;z-index:5;pointer-events:none;opacity:0;white-space:nowrap;text-shadow:0 2px 6px #000a;transition:opacity .25s, transform .25s';
  if (typeof document !== 'undefined' && document.body) document.body.append(chip, pop);
  let popT = 0, chipT = 0;
  function popText(text, color = '#ffffff', big = false, time = 1.0) {
    pop.textContent = text;
    pop.style.color = color;
    pop.style.fontSize = big ? '34px' : '24px';
    pop.style.transition = 'none';
    pop.style.opacity = '1';
    pop.style.transform = 'translate(-50%,0) scale(1.25)';
    void pop.offsetWidth;
    pop.style.transition = 'opacity .25s, transform .25s';
    pop.style.transform = 'translate(-50%,0) scale(1)';
    popT = time;
  }

  // ================================================================ 부표 게이트
  const gates = (G ? G.list : []).map(([p, lat], k) => {
    const s = track.sampleAt(track.tOfP(p));
    const c = track.surf(s, lat, 0, V()).setY(0);
    const tan = flat(s.tan), right = flat(s.right);
    const half = G.half || 3.75;
    const posts = [-1, 1].map((sd) => ({ base: c.clone().addScaledVector(right, sd * half), off: V(), vel: V(), tilt: 0, tiltV: 0, axis: V(), cool: 0, ph: R(0, 6.3) }));
    return { k, c, tan, right, half, lat, posts, state: 'wait', flash: 0, prev: null, dist: s.dist, yaw: Math.atan2(tan.x, tan.z) };
  }).sort((a, b) => a.dist - b.dist);
  gates.forEach((g, i) => (g.k = i));
  const NG = gates.length;
  const run = { active: false, passed: 0, combo: 0, best: 0, done: false };
  const totals = { runs: 0, passed: 0, missed: 0, perfect: 0, hits: 0, buoyHits: 0, roughT: 0, currentT: 0 };
  let lastRun = null;

  const postMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const postIm = NG ? new THREE.InstancedMesh(postGeometry(), postMat, NG * 2) : null;
  const lampIm = NG ? new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), NG * 2) : null;
  const bannerIm = NG ? new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: arrowTexture('banner'), transparent: true, side: THREE.DoubleSide, depthWrite: false }), NG) : null;
  const lineIm = NG ? new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: softTexture(0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), NG) : null;
  if (NG) {
    postIm.castShadow = true;
    postIm.name = 'gatePosts';
    for (const im of [lampIm, bannerIm, lineIm]) im.frustumCulled = false;
    postIm.frustumCulled = false;
    group.add(postIm, lampIm, bannerIm, lineIm);
  }
  const COL = { wait: new THREE.Color('#ffa21a'), next: new THREE.Color('#fff27a'), pass: new THREE.Color('#38ff7a'), miss: new THREE.Color('#5a1418'), white: new THREE.Color('#ffffff') };
  const tmpC = new THREE.Color();
  function gateColor(g, t, nextK) {
    if (g.state === 'pass') return tmpC.copy(COL.pass).lerp(COL.white, g.flash * 0.8);
    if (g.state === 'miss') return tmpC.copy(COL.miss).lerp(new THREE.Color('#ff3344'), g.flash);
    if (g.k === nextK) return tmpC.copy(COL.wait).lerp(COL.next, 0.5 + 0.5 * Math.sin(t * 9));
    return tmpC.copy(COL.wait).multiplyScalar(0.8);
  }

  function newRun() {
    if (run.active && !run.done) finishRun();
    for (const g of gates) (g.state = 'wait'), (g.flash = 0);
    run.active = true;
    run.done = false;
    run.passed = 0;
    run.combo = 0;
    run.best = 0;
    totals.runs++;
  }
  function finishRun() {
    run.done = true;
    lastRun = { passed: run.passed, total: NG, best: run.best };
  }
  let carRef = null;
  function passGate(g, car) {
    g.state = 'pass';
    g.flash = 1;
    run.passed++;
    run.combo++;
    run.best = Math.max(run.best, run.combo);
    totals.passed++;
    const step = Math.min(run.combo, G.comboMax || 5) - 1;
    const [sec, k] = G.surge || [1.1, 0.6];
    car.boatSurge(sec + 0.08 * step, k + (G.comboStep || 0.12) * step);
    car.events.push('buoyGate');
    sfx.gate(run.combo);
    for (const p of g.posts) fountain(p.base, 22);
    if (g.k === NG - 1 && run.passed === NG) {
      const [ps, pk] = G.perfect || [3, 1.5];
      car.boatSurge(ps, pk);
      totals.perfect++;
      sfx.perfect();
      popText(`🌊 퍼펙트 슬라럼! ${NG}/${NG}`, '#7dffb0', true, 1.8);
    } else popText(`🚩 게이트 ${run.passed}/${NG}${run.combo > 1 ? `  연속 ×${run.combo}` : ''}`, run.combo > 2 ? '#7dffb0' : '#ffffff');
    chipT = 3;
  }
  function missGate(g, loud) {
    g.state = 'miss';
    g.flash = 1;
    totals.missed++;
    if (run.combo > 1 && loud) popText(`게이트 놓침 · 연속 끊김`, '#ff9a9a', false, 0.9);
    else if (loud) popText('게이트 놓침', '#ff9a9a', false, 0.8);
    run.combo = 0;
    if (loud) sfx.miss();
    chipT = 3;
  }
  function crossGate(g, ok, car) {
    if (g.k === 0) newRun();
    if (!run.active) return;
    for (const h of gates) if (h.k < g.k && h.state === 'wait') missGate(h, false); // 건너뛴 문
    if (g.state !== 'wait') return;
    if (ok) passGate(g, car);
    else missGate(g, true);
    if (g.k === NG - 1) finishRun();
  }

  // ================================================================ 물길 양옆 부표 줄 (부딪히면 날아감)
  const buoys = [];
  if (LB) {
    for (const [a, b] of track.waterRuns || []) {
      let last = -99, n = 0;
      for (const s of track.spanList(a, b)) {
        if (s.dist - last < (LB.every || 20)) continue;
        last = s.dist;
        n++;
        for (const side of [-1, 1]) {
          const p = track.surf(s, side * (HW + (LB.out ?? 1.6)), 0, V());
          const red = (n + (side > 0 ? 1 : 0)) % 2 === 1;
          buoys.push({ base: new THREE.Vector3(p.x, 0, p.z), off: V(), vel: V(), rot: V(), spin: V(), air: false, gone: 0, ph: R(0, 6.3), color: red ? '#ff4a1c' : '#f6f6f6', cool: 0 });
        }
      }
    }
  }
  const buoyIm = buoys.length ? new THREE.InstancedMesh(buoyGeometry(), postMat, buoys.length) : null;
  if (buoyIm) {
    buoys.forEach((b, i) => buoyIm.setColorAt(i, new THREE.Color(b.color)));
    buoyIm.instanceColor.needsUpdate = true;
    buoyIm.castShadow = true;
    buoyIm.frustumCulled = false;
    buoyIm.name = 'laneBuoys';
    group.add(buoyIm);
  }
  /** 부표를 날림: 차가 오는 방향으로 튀어 오르며 빙글빙글 */
  function knockBuoy(b, car, playerHit) {
    const sp = Math.hypot(car.vel.x, car.vel.z);
    const ax = b.base.x + b.off.x - car.pos.x, az = b.base.z + b.off.z - car.pos.z;
    const al = Math.hypot(ax, az) || 1;
    b.vel.set(car.vel.x * 0.55 + (ax / al) * 4, 3 + Math.min(9, sp * 0.18), car.vel.z * 0.55 + (az / al) * 4);
    b.spin.set(R(-8, 8), R(-4, 4), R(-8, 8));
    b.air = true;
    b.gone = 0;
    b.cool = 1.2;
    burst(b.base.clone().add(b.off), 26, 0.8 + Math.min(1, sp / 40));
    if (playerHit) sfx.thunk(false);
  }

  // ================================================================ 급류 (하늘색 화살표 띠)
  const currents = CUR.map(([p0, p1, off0, off1, w, k]) => {
    const t0 = track.tOfP(p0), t1 = track.tOfP(p1);
    return { t0, t1, off0, off1, w, k: k ?? 1, inside: false };
  });
  const curTex = arrowTexture('current');
  const curMat = new THREE.MeshBasicMaterial({ map: curTex, color: '#3fcfff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const curEdgeMat = new THREE.MeshBasicMaterial({ color: '#9feaff', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (const cu of currents) {
    const N = track.samples.length - 1;
    const a = Math.round(cu.t0 * N), b = Math.round(cu.t1 * N);
    const list = track.spanList(a, b);
    const pos = [], uv = [], idx = [], epos = [], eidx = [];
    const d0 = list[0].dist;
    list.forEach((s, i) => {
      const u = i / (list.length - 1);
      const c = cu.off0 + (cu.off1 - cu.off0) * u;
      const fade = Math.min(1, i / 4, (list.length - 1 - i) / 4);
      const w = (cu.w / 2) * (0.4 + 0.6 * fade);
      const L = track.surf(s, c - w, 0, V()), Rr = track.surf(s, c + w, 0, V());
      pos.push(L.x, 0.07, L.z, Rr.x, 0.07, Rr.z);
      const v = (s.dist - d0) / 5.5;
      uv.push(0, v, Math.max(1, Math.round(cu.w / 5.5)), v);
      for (const [sd, q] of [[-1, L], [1, Rr]]) {
        const o = track.surf(s, c + sd * (w + 0.5), 0, V());
        epos.push(q.x, 0.08, q.z, o.x, 0.08, o.z);
      }
      if (i) {
        const j = (i - 1) * 2;
        idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
        const e = (i - 1) * 4;
        eidx.push(e, e + 4, e + 1, e + 1, e + 4, e + 5, e + 2, e + 6, e + 3, e + 3, e + 6, e + 7);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, curMat);
    m.name = 'current';
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(epos, 3));
    eg.setIndex(eidx);
    const em = new THREE.Mesh(eg, curEdgeMat);
    group.add(m, em);
  }

  // ================================================================ 물보라 입자 (꼬리 물기둥·카빙 물벽·부표 물보라)
  const NP = 1600;
  const pPos = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP), pMax = new Float32Array(NP).fill(1);
  const pS0 = new Float32Array(NP), pS1 = new Float32Array(NP), aSize = new Float32Array(NP), aAlpha = new Float32Array(NP);
  for (let i = 0; i < NP; i++) pPos[i * 3 + 1] = -999;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(aAlpha, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 560 }, uColor: { value: new THREE.Color('#eef9ff') } },
    vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = min(70.0, aSize * uScale / max(0.5, -mv.z)); vA = aAlpha * smoothstep(2.5, 7.0, -mv.z); }`,
    fragmentShader: `varying float vA; uniform vec3 uColor;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = smoothstep(1.0, 0.15, r) * vA;
        if (a < 0.01) discard; gl_FragColor = vec4(uColor * (0.85 + 0.15 * (1.0 - r)), a); }`,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(pGeo, pMat);
  pts.frustumCulled = false;
  pts.name = 'boatSpray';
  group.add(pts);
  let pNext = 0, pAlive = 0;
  function emit(x, y, z, vx, vy, vz, life, s0, s1) {
    const i = pNext;
    pNext = (pNext + 1) % NP;
    const k = i * 3;
    pPos[k] = x;
    pPos[k + 1] = y;
    pPos[k + 2] = z;
    pVel[k] = vx;
    pVel[k + 1] = vy;
    pVel[k + 2] = vz;
    pLife[i] = 0;
    pMax[i] = life;
    pS0[i] = s0;
    pS1[i] = s1;
    pAlive = 2;
  }
  function burst(p, n, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = R(1, 4) * power;
      emit(p.x + Math.cos(a) * 0.6, 0.2, p.z + Math.sin(a) * 0.6, Math.cos(a) * s, R(4, 8) * power, Math.sin(a) * s, R(0.6, 1.1), 0.5, 1.6);
    }
  }
  function fountain(p, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = R(0.3, 1.6);
      emit(p.x + Math.cos(a) * 0.4, 0.4, p.z + Math.sin(a) * 0.4, Math.cos(a) * s, R(7, 11), Math.sin(a) * s, R(0.8, 1.2), 0.4, 1.2);
    }
  }

  // ================================================================ 거품 자국 (배가 지나간 뒤에 남는 하얀 물결, 점점 넓어지며 사라짐)
  const NF = 300;
  const foamIm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: softTexture(0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), NF);
  foamIm.frustumCulled = false;
  foamIm.name = 'boatFoam';
  const foam = Array.from({ length: NF }, () => ({ x: 0, z: 0, yaw: 0, age: 9, life: 1, w: 1, l: 1, k: 1 }));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = V(), sc = V();
  for (let i = 0; i < NF; i++) {
    foamIm.setMatrixAt(i, m4.makeScale(0.001, 0.001, 0.001));
    foamIm.setColorAt(i, tmpC.setRGB(0, 0, 0));
  }
  group.add(foamIm);
  let fNext = 0;
  function dropFoam(x, z, yaw, w, l, k) {
    const f = foam[fNext];
    fNext = (fNext + 1) % NF;
    Object.assign(f, { x, z, yaw, age: 0, life: R(2.6, 3.4), w, l, k });
  }

  // ================================================================ 차마다 연출 상태 (플레이어 + 봇)
  const fxState = new WeakMap();
  function carFx(c, dt, near) {
    let st = fxState.get(c);
    if (!st) fxState.set(c, (st = { acc: 0, cacc: 0, lastX: c.pos.x, lastZ: c.pos.z, foamD: 0 }));
    const onW = c.mode === 'boat' && c.surface === 'water' && c.grounded && c.pos.y < 1.2;
    const sp = Math.hypot(c.vel.x, c.vel.z);
    const moved = Math.hypot(c.pos.x - st.lastX, c.pos.z - st.lastZ);
    st.lastX = c.pos.x;
    st.lastZ = c.pos.z;
    if (!onW || sp < 6 || moved > 8) return;
    const fast = clamp01((sp - 10) / 35);
    const fw = c.fwd, rt = c.right;
    const cv = c.boatCarve || 0;
    const rate = near ? 1 : 0.4;
    // 꼬리 물기둥: 선외기 뒤로 솟는 물 (빠를수록 높고 많이)
    st.acc += dt * (14 + 90 * fast) * rate;
    while (st.acc >= 1) {
      st.acc -= 1;
      const sx = c.pos.x - fw.x * 2.5, sz = c.pos.z - fw.z * 2.5;
      const back = 2 + sp * 0.12;
      emit(sx + R(-0.3, 0.3), 0.3, sz + R(-0.3, 0.3), c.vel.x * 0.5 - fw.x * back + R(-1.2, 1.2), R(3, 4) + 7.5 * fast * R(0.7, 1.1), c.vel.z * 0.5 - fw.z * back + R(-1.2, 1.2), R(0.55, 0.9), 0.35, 1.1 + 0.8 * fast);
    }
    // 카빙 물벽: 도는 반대쪽(바깥)으로 물이 부채처럼 솟음
    if (cv > 0.15) {
      const out = -Math.sign(c.yawRate || 0) || 1; // +1 = 오른쪽 바깥
      st.cacc += dt * 280 * cv * (0.4 + fast) * rate;
      while (st.cacc >= 1) {
        st.cacc -= 1;
        const ox = c.pos.x + rt.x * out * 1.1 - fw.x * R(-0.4, 1.4), oz = c.pos.z + rt.z * out * 1.1 - fw.z * R(-0.4, 1.4);
        const so = (4 + sp * 0.16) * R(0.7, 1.2);
        emit(ox, 0.25, oz, c.vel.x * 0.55 + rt.x * out * so, R(2.5, 4.5) + 4 * cv, c.vel.z * 0.55 + rt.z * out * so, R(0.5, 0.9), 0.45, 2.3);
      }
    } else st.cacc = 0;
    // 거품 자국: 2.4 m마다 하나 (카빙하면 넓게)
    st.foamD += moved;
    if (st.foamD > 2.4) {
      st.foamD = 0;
      dropFoam(c.pos.x - fw.x * 2.6, c.pos.z - fw.z * 2.6, Math.atan2(fw.x, fw.z), 2.2 + 1.5 * cv, 3.2, (0.35 + 0.65 * fast) * (near ? 1 : 0.7));
    }
  }

  // ================================================================ 물리 스텝 (플레이어 차: 게이트·부표·거친 물·급류)
  const prevPos = V();
  const crossLog = []; // 테스트용: 최근 게이트 통과 기록 (문 가운데 기준 옆 위치)
  let havePrev = false, roughHintT = 0, roughFlag = false, curFlag = false;
  function update(dt, car) {
    carRef = car;
    const ti = car.trackInfo;
    if (!ti) return;
    const jumped = havePrev && Math.hypot(car.pos.x - prevPos.x, car.pos.z - prevPos.z) > 6; // 복귀·순간 이동
    prevPos.copy(car.pos);
    havePrev = true;
    const near = inWaterT(ti.t, 0.02);
    if (roughHintT > 0) roughHintT -= dt;
    if (!near) {
      for (const g of gates) g.prev = null;
      if (run.active && !run.done && ti.t > waterT.t1) finishRun();
      roughFlag = curFlag = false;
      return;
    }
    const boat = car.mode === 'boat';
    // --- 게이트 통과·기둥 충돌
    for (const g of gates) {
      const dx = car.pos.x - g.c.x, dz = car.pos.z - g.c.z;
      const along = dx * g.tan.x + dz * g.tan.z, lat = dx * g.right.x + dz * g.right.z;
      if (g.prev != null && !jumped && boat && g.prev < 0 && along >= 0 && Math.abs(lat) < 24 && car.pos.y < 9) {
        crossLog.push({ k: g.k, lat: +lat.toFixed(2), y: +car.pos.y.toFixed(1) });
        if (crossLog.length > 30) crossLog.shift();
        crossGate(g, Math.abs(lat) <= g.half - 0.25, car);
      }
      g.prev = along;
      if (Math.abs(along) > 4 || car.pos.y > 2.5) continue;
      for (const p of g.posts) {
        if (p.cool > 0) continue;
        const px = car.pos.x - (p.base.x + p.off.x), pz = car.pos.z - (p.base.z + p.off.z);
        const d = Math.hypot(px, pz);
        if (d > (G.hitR ?? 1.3)) continue;
        // 기둥에 박음: 기둥이 튕겨 기울고(제자리로 돌아옴), 차는 느려짐
        const sp = Math.hypot(car.vel.x, car.vel.z);
        p.vel.set(car.vel.x * 0.3 - (px / (d || 1)) * 3, 0, car.vel.z * 0.3 - (pz / (d || 1)) * 3);
        p.tiltV = 2.5 + sp * 0.06;
        p.axis.set(car.vel.z, 0, -car.vel.x).normalize();
        p.cool = 1;
        const slow = G.hitSlow ?? 0.88;
        car.speed *= slow;
        car.vel.multiplyScalar(slow);
        car.events.push('bump');
        totals.hits++;
        burst(p.base.clone().add(p.off), 34, 1 + Math.min(1, sp / 40));
        sfx.thunk(true);
        popText('💥 부표에 쾅!', '#ffb08a', false, 0.8);
      }
    }
    if (!(car.surface === 'water' && boat)) return;
    // --- 물길 양옆 부표: 박으면 날아가고 느려짐
    for (const b of buoys) {
      if (b.cool > 0 || b.air) continue;
      const bx = b.base.x + b.off.x, bz = b.base.z + b.off.z;
      if (Math.abs(car.pos.x - bx) > 2 || Math.abs(car.pos.z - bz) > 2) continue;
      if (Math.hypot(car.pos.x - bx, car.pos.z - bz) > 1.6 || car.pos.y > 2.2) continue;
      knockBuoy(b, car, true);
      crossLog.push({ buoy: true, t: +ti.t.toFixed(4), lat: +ti.lateral.toFixed(1), y: +car.pos.y.toFixed(1) });
      if (crossLog.length > 30) crossLog.shift();
      const slow = LB.hitSlow ?? 0.94;
      car.speed *= slow;
      car.vel.multiplyScalar(slow);
      totals.buoyHits++;
    }
    // --- 거친 물: 부표 줄 밖은 느려짐
    const edge = HW + (LB ? LB.out ?? 1.6 : 99);
    const rough = LB && car.grounded && ti.sample && ti.sample.water && Math.abs(ti.lateral) > edge + 0.6;
    if (rough) {
      car.speed -= car.speed * (LB.roughDrag ?? 0.15) * dt;
      totals.roughT += dt;
      if (!roughFlag && roughHintT <= 0 && Math.abs(car.speed) > 12) {
        popText('🌊 거친 물! 부표 안쪽이 빨라요', '#9fdcff', false, 1.4);
        roughHintT = 8;
      }
    }
    roughFlag = !!rough;
    // --- 급류: 띠 안이면 물살 가속
    let inCur = null;
    for (const cu of currents) {
      if (ti.t < cu.t0 || ti.t > cu.t1) continue;
      const u = (ti.t - cu.t0) / (cu.t1 - cu.t0);
      const c = cu.off0 + (cu.off1 - cu.off0) * u;
      if (Math.abs(ti.lateral - c) < cu.w / 2 + 0.3) inCur = cu;
    }
    if (inCur && car.grounded) {
      car.boatSurge(0.45, inCur.k);
      totals.currentT += dt;
      if (!curFlag) {
        sfx.whoosh();
        popText('🌊 급류 타기!', '#8ff0ff', false, 1.0);
      }
    }
    curFlag = !!inCur;
  }

  // ================================================================ 화면마다 (모습·입자·소리·글자)
  let lastTime = null, lastBuoyUpd = 0;
  function animate(time) {
    const dt = lastTime == null ? 0 : Math.min(0.1, Math.max(0, time - lastTime));
    lastTime = time;
    const car = carRef;
    const ti = car && car.trackInfo;
    const near = !!(ti && inWaterT(ti.t, 0.03));
    // 차 연출: 플레이어 + 가까운 봇
    if (car && dt > 0) {
      carFx(car, dt, true);
      const rs = window.game && window.game.raceSys;
      if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car.pos && b.car.pos.distanceToSquared(car.pos) < 140 * 140) carFx(b.car, dt, false);
    }
    // 소리
    if (car) {
      const onW = car.mode === 'boat' && car.surface === 'water' && car.grounded;
      const sp = Math.abs(car.speed), fast = clamp01((sp - 8) / 40), cv = car.boatCarve || 0;
      sfx.hiss(onW ? 0.025 + 0.11 * fast + 0.16 * cv + (car.surgeT > 0 ? 0.04 : 0) : 0, clamp01(0.3 * fast + 0.7 * cv));
    }
    if (dt <= 0) return;

    // --- 게이트 모습: 출렁임 + 상태 색 + 박힌 기둥 기울기
    if (NG && (near || lastBuoyUpd <= 0)) {
      const nextK = run.active && !run.done ? (gates.find((g) => g.state === 'wait') || { k: -1 }).k : 0;
      const rs0 = window.game && window.game.raceSys;
      const bots0 = near && rs0 && rs0.bots ? rs0.bots : [];
      gates.forEach((g, gi) => {
        g.flash = Math.max(0, g.flash - dt * 1.6);
        const col = gateColor(g, time, nextK);
        g.posts.forEach((p, pi) => {
          // 기둥 스프링: 옆으로 밀린 만큼 돌아오고, 기운 만큼 다시 섬
          p.cool = Math.max(0, p.cool - dt);
          // 봇이 스치면 기둥만 기울었다 섬 (봇 속도는 그대로)
          if (p.cool <= 0) for (const bt of bots0) {
            const c = bt.car;
            if (!c || c.pos.y > 2.5 || Math.abs(c.pos.x - p.base.x - p.off.x) > 1.4 || Math.abs(c.pos.z - p.base.z - p.off.z) > 1.4) continue;
            p.vel.set(c.vel.x * 0.3, 0, c.vel.z * 0.3);
            p.tiltV = 2.5 + Math.hypot(c.vel.x, c.vel.z) * 0.06;
            p.axis.set(c.vel.z, 0, -c.vel.x).normalize();
            p.cool = 1;
            burst(p.base.clone().add(p.off), 20, 1);
          }
          p.vel.addScaledVector(p.off, -5 * dt).multiplyScalar(Math.exp(-2.2 * dt));
          p.off.addScaledVector(p.vel, dt);
          p.tiltV += (-14 * p.tilt - 3 * p.tiltV) * dt;
          p.tilt += p.tiltV * dt;
          const bob = Math.sin(time * 1.5 + p.ph) * 0.12;
          q.setFromEuler(e.set(Math.sin(time * 1.1 + p.ph) * 0.05, g.yaw, Math.cos(time * 0.9 + p.ph) * 0.05));
          if (Math.abs(p.tilt) > 1e-3) q.premultiply(new THREE.Quaternion().setFromAxisAngle(p.axis, p.tilt * 0.6));
          pv.copy(p.base).add(p.off).setY(bob);
          postIm.setMatrixAt(gi * 2 + pi, m4.compose(pv, q, sc.setScalar(1)));
          // 꼭대기 등: 기둥 꼭대기 (기울기 반영)
          const top = new THREE.Vector3(0, 5.55, 0).applyQuaternion(q).add(pv);
          lampIm.setMatrixAt(gi * 2 + pi, m4.compose(top, q, sc.setScalar(g.k === nextK || g.flash > 0 ? 1.25 : 1)));
          lampIm.setColorAt(gi * 2 + pi, col);
        });
        // 화살표 띠 (두 기둥 사이 위쪽) + 물 위 빛 줄
        const a = g.posts[0], b = g.posts[1];
        pv.copy(a.base).add(a.off).add(b.base).add(b.off).multiplyScalar(0.5);
        const span = Math.hypot(b.base.x + b.off.x - a.base.x - a.off.x, b.base.z + b.off.z - a.base.z - a.off.z);
        pv.y = 4.6 + Math.sin(time * 1.5 + a.ph) * 0.1;
        q.setFromEuler(e.set(0, g.yaw, 0));
        bannerIm.setMatrixAt(gi, m4.compose(pv, q, sc.set(Math.max(0.5, span - 0.6), 1.5, 1)));
        bannerIm.setColorAt(gi, col);
        pv.y = 0.09;
        lineIm.setMatrixAt(gi, m4.compose(pv, q, sc.set(span, 1, 2.2)));
        lineIm.setColorAt(gi, tmpC.copy(col).multiplyScalar(g.state === 'miss' ? 0.15 : g.k === nextK ? 0.7 : 0.35));
      });
      for (const im of [postIm, lampIm, bannerIm, lineIm]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }

    // --- 물길 부표: 출렁임, 날아간 부표는 포물선 → 물에 떨어져 떠다니다 제자리로 (물 구간 밖이면 0.3초마다)
    lastBuoyUpd -= dt;
    if (buoyIm && (near || lastBuoyUpd <= 0)) {
      const rs = window.game && window.game.raceSys;
      const bots = near && rs && rs.bots ? rs.bots : [];
      buoys.forEach((b, i) => {
        b.cool = Math.max(0, b.cool - dt);
        // 봇이 스치면 모습만 튕김 (봇 속도는 그대로)
        if (!b.air && b.cool <= 0) for (const bt of bots) {
          const c = bt.car;
          if (c && c.surface === 'water' && Math.abs(c.pos.x - b.base.x - b.off.x) < 1.6 && Math.abs(c.pos.z - b.base.z - b.off.z) < 1.6) knockBuoy(b, c, false);
        }
        if (b.air) {
          b.vel.y -= 14 * dt;
          b.off.addScaledVector(b.vel, dt);
          b.rot.addScaledVector(b.spin, dt);
          if (b.off.y < 0 && b.vel.y < 0) {
            b.air = false;
            b.off.y = 0;
            b.vel.multiplyScalar(0.25).setY(0);
            burst(b.base.clone().add(b.off), 14, 0.6);
          }
        } else {
          b.gone += dt;
          b.vel.multiplyScalar(Math.exp(-1.5 * dt));
          b.off.addScaledVector(b.vel, dt);
          if (b.gone > 3) b.off.multiplyScalar(Math.exp(-0.8 * dt)); // 3초 뒤 제자리로 천천히 떠 돌아옴
          b.rot.multiplyScalar(Math.exp(-1.2 * dt));
        }
        q.setFromEuler(e.set(Math.sin(time * 1.1 + b.ph) * 0.1 + b.rot.x, b.rot.y, Math.cos(time * 0.9 + b.ph) * 0.1 + b.rot.z));
        pv.copy(b.base).add(b.off);
        if (!b.air) pv.y = Math.sin(time * 1.6 + b.ph) * 0.15;
        buoyIm.setMatrixAt(i, m4.compose(pv, q, sc.setScalar(1)));
      });
      buoyIm.instanceMatrix.needsUpdate = true;
    }
    if (lastBuoyUpd <= 0) lastBuoyUpd = 0.3;

    // --- 급류 화살표 흐름
    curTex.offset.y -= dt * 2.2;

    // --- 입자
    if (pAlive > 0) {
      let any = false;
      for (let i = 0; i < NP; i++) {
        const k = i * 3;
        if (pPos[k + 1] < -50) continue;
        pLife[i] += dt;
        const u = pLife[i] / pMax[i];
        if (u >= 1) {
          pPos[k + 1] = -999;
          aAlpha[i] = 0;
          continue;
        }
        any = true;
        pVel[k + 1] -= 13 * dt;
        const drag = Math.exp(-1.6 * dt);
        pVel[k] *= drag;
        pVel[k + 2] *= drag;
        pPos[k] += pVel[k] * dt;
        pPos[k + 1] += pVel[k + 1] * dt;
        pPos[k + 2] += pVel[k + 2] * dt;
        if (pPos[k + 1] < -0.2) {
          pPos[k + 1] = -999;
          aAlpha[i] = 0;
          continue;
        }
        aSize[i] = pS0[i] + (pS1[i] - pS0[i]) * Math.sqrt(u);
        aAlpha[i] = 0.8 * (1 - u) * Math.min(1, u * 8 + 0.3);
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.aSize.needsUpdate = true;
      pGeo.attributes.aAlpha.needsUpdate = true;
      if (!any) pAlive -= 1;
    }
    // --- 거품 자국
    let fAny = false;
    for (let i = 0; i < NF; i++) {
      const f = foam[i];
      if (f.age > f.life) continue;
      f.age += dt;
      fAny = true;
      const u = Math.min(1, f.age / f.life);
      q.setFromEuler(e.set(0, f.yaw, 0));
      foamIm.setMatrixAt(i, m4.compose(pv.set(f.x, 0.05, f.z), q, sc.set(f.w * (1 + 2.6 * u), 1, f.l * (1 + 0.8 * u))));
      foamIm.setColorAt(i, tmpC.setScalar(0.32 * f.k * Math.pow(1 - u, 1.6)));
      if (u >= 1) foamIm.setMatrixAt(i, m4.makeScale(0.001, 0.001, 0.001));
    }
    if (fAny || foamIm.userData.dirty) {
      foamIm.instanceMatrix.needsUpdate = true;
      foamIm.instanceColor.needsUpdate = true;
    }
    foamIm.userData.dirty = fAny;

    // --- 화면 글자
    if (popT > 0) {
      popT -= dt;
      if (popT <= 0) pop.style.opacity = '0';
    }
    const raceOn = !(window.game && window.game.race && window.game.race.phase === 'finished');
    const showChip = NG && raceOn && run.active && (near || chipT > 0);
    if (chipT > 0 && !near) chipT -= dt;
    if (showChip) {
      const txt = `🚩 부표 게이트 ${run.passed}/${NG}${run.combo > 1 ? `  ·  연속 ×${run.combo}` : ''}${car && car.surgeT > 0 ? '  ·  💨' : ''}`;
      if (chip.textContent !== txt) chip.textContent = txt;
    }
    chip.style.opacity = showChip ? '1' : '0';
  }

  function reset() {
    for (const g of gates) {
      g.state = 'wait';
      g.flash = 0;
      g.prev = null;
      for (const p of g.posts) p.off.set(0, 0, 0), p.vel.set(0, 0, 0), (p.tilt = p.tiltV = 0);
    }
    for (const b of buoys) b.off.set(0, 0, 0), b.vel.set(0, 0, 0), b.rot.set(0, 0, 0), (b.air = false), (b.cool = 0);
    Object.assign(run, { active: false, passed: 0, combo: 0, best: 0, done: false });
    havePrev = false;
    chipT = popT = 0;
    pop.style.opacity = chip.style.opacity = '0';
  }

  const api = {
    update,
    animate,
    reset,
    gates,
    buoys,
    currents,
    /** 테스트용: 이번 바퀴·전체 기록 */
    sfx,
    stats: () => ({ run: { ...run }, lastRun, total: NG, ...totals, crossLog: crossLog.slice() }),
  };
  track.buoyGates = api;
  track.boatSpray = true; // offroadFx.js: 물 위 네모 조각 대신 이 파일의 물보라를 씀
  return api;
}
