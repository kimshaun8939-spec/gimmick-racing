// 노을 해안 서킷 배 구간 놀거리 (2026-11-10, 사용자 요청 "배 탈 때 심심해 / 옆에 콘이 아무 의미가 없어")
//   seaMap.js의 buildProps가 만들고, 매 물리 스텝 update(dt, car) · 매 화면 animate(time)을 부름
//
//   1) 부표 게이트 (data.buoyGates): 주황 부표 두 개 + 위 화살표 띠 = 문. 사이로 지나가면 물살 가속(car.boatSurge) + 띵 소리 +
//      "부표 게이트 n/전체", 연달아 지나가면 연속 ×n (가속이 더 셈), 전부 지나가면 "퍼펙트 슬라럼!" 큰 가속.
//      문을 놓치면 빨갛게 꺼지고 연속이 끊김. 부표 기둥에 박으면 기둥이 튕겨 나가고 느려짐
//   2) 물길 양옆 부표 줄 (data.laneBuoys): 예전엔 그냥 장식(콘처럼 보였음) → 이제 "빠른 물" 경계.
//      부표 밖은 거친 물이라 느려지고, 부표에 박으면 부표가 날아가고 느려짐 (시간이 지나면 제자리로 돌아옴)
//   3) 물살 레인 (data.currents, boat3 2026-11-15): 물길 부표 줄 바깥의 하늘색 화살표 물결 띠 = 길지만 물이 밀어 주는 다른 길 (car.boatFlow)
//   4) 배 연출: 꼬리 물기둥(수탉 꼬리), 뒤에 남는 거품 자국, 물살 소리·게이트 소리
//   5) (boat3) 너울 파도 높이(track.updateWaves, 레이스 시계) + 파도 앞 거품 줄(밝으면 지금 가면 꼭대기) + 꼭대기 물보라,
//      소용돌이(data.whirlpools: 가장자리 = 앞으로 밀고 안쪽으로 돌려 줌, 깊으면 빙글), 착수 물보라 고리
//   게이트 점수는 플레이어만. 물살 레인·소용돌이·파도는 봇도 같은 규칙 (sea 봇 레이스로 복귀·코스 밖·접촉 확인, 2026-11-15)
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
  const G = data.buoyGates, LB = data.laneBuoys, CUR = (data.currents || []).filter((c) => c && !Array.isArray(c) && c.pts);
  const HW = track.width / 2;
  const group = new THREE.Group();
  group.name = 'seaGates';
  scene.add(group);
  const V = () => new THREE.Vector3();
  const flat = (v) => new THREE.Vector3(v.x, 0, v.z).normalize();
  const waterT = track.waterRanges && track.waterRanges[0] ? track.waterRanges[0] : { t0: 2, t1: -1 };
  const inWaterT = (t, pad = 0) => t > waterT.t0 - pad && t < waterT.t1 + pad;

  // ================================================================ 물살 레인·소용돌이 자료 (boat3 2026-11-15)
  const lanes = CUR.map((c) => {
    const pts = c.pts.map(([p, lat]) => [track.tOfP(p), lat]).sort((a, b) => a[0] - b[0]);
    return { pts, t0: pts[0][0], t1: pts[pts.length - 1][0], w: c.width ?? 8, k: c.k ?? 1, kind: c.kind || 'fast', fade: c.fade ?? 0.006 };
  });
  /** 레인 가운데 옆 위치 (t에서, 점 사이는 코사인으로 부드럽게) */
  function laneLat(L, t) {
    const P = L.pts;
    let k = 1;
    while (k < P.length - 1 && P[k][0] < t) k++;
    const a = P[k - 1], b = P[k];
    const u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0] || 1)));
    return a[1] + (b[1] - a[1]) * (1 - Math.cos(Math.PI * u)) * 0.5;
  }
  /** (t, 옆 위치)가 어느 레인 안인지 (pad = 폭에 더하는 여유) */
  function laneAt(t, lat, pad = 0) {
    for (const L of lanes) {
      if (t < L.t0 || t > L.t1) continue;
      // 양 끝(입구·출구)은 띠가 좁아짐 (모습과 같게)
      const u = Math.min(1, (t - L.t0) / L.fade, (L.t1 - t) / L.fade);
      if (Math.abs(lat - laneLat(L, t)) < (L.w / 2) * (0.45 + 0.55 * u) + pad) return L;
    }
    return null;
  }
  const pools = track.whirlpools || [];
  const inPool = (x, z, pad = 0) => pools.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < (p.r + pad) ** 2);
  const _nv = new THREE.Vector3();
  /** 이 자리가 물살 레인·소용돌이 자리인가 (부표 줄 틈·바위 치우기·코스 밖 판정에 씀) */
  function inLaneOrPool(x, z, pad = 0) {
    if (inPool(x, z, pad)) return true;
    if (!lanes.length) return false;
    const n = track.nearest(_nv.set(x, 0, z));
    return !!laneAt(n.t, n.lateral, pad);
  }

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
      /** (boat3) 깔끔한 착수: 촤악 + 밝은 두 음 */
      splashClean() {
        if (!ok()) return;
        const t = ctx.currentTime;
        noise(t, 0.5, 0.13, 3200, 700);
        tone(880, t + 0.03, 0.22, 0.06, 'sine');
        tone(1320, t + 0.09, 0.25, 0.05, 'sine');
      },
      /** (boat3) 뱃머리 박기: 퍽 + 무거운 물 */
      noseDive() {
        if (!ok()) return;
        const t = ctx.currentTime;
        tone(95, t, 0.3, 0.22, 'sine', 50);
        noise(t, 0.7, 0.22, 900, 180, 'lowpass');
      },
      /** 물살 소리: 물 위에서 빠를수록 크고 밝게 */
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
  const totals = { poolT: 0, poolDeepT: 0, runs: 0, passed: 0, missed: 0, perfect: 0, hits: 0, buoyHits: 0, roughT: 0, currentT: 0, offT: 0, offMax: 0, offResets: 0, slowLost: 0 };
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
          if (inLaneOrPool(p.x, p.z, 1)) continue; // 물살 레인 입구·소용돌이 자리 = 부표 줄 틈 (boat3)
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
  // (seafix 2026-11-10) 물길 경계를 한눈에: 큰 부표 사이를 잇는 밧줄 + 작은 노랑·흰 뜨개 (부딪히지 않음, 모습만)
  //   이 줄 밖으로 많이 나가면 '코스 밖' (아래 offCourse)
  const OC = data.offCourse || {};
  if (LB && OC.rope !== false) {
    const floats = [], rope = [];
    const every = OC.ropeEvery ?? 3;
    for (const [a, b] of track.waterRuns || []) {
      for (const side of [-1, 1]) {
        let last = -99, prev = null, n = 0;
        for (const s of track.spanList(a, b)) {
          if (s.dist - last < every) continue;
          last = s.dist;
          const p = track.surf(s, side * (HW + (LB.out ?? 1.6)), 0, V());
          const gy = track.groundY(p.x, p.z);
          // 물 위만 (선착장 끝 콘크리트·모래 위에는 안 놓음), 물살 레인 입구·소용돌이 자리는 틈 (boat3)
          if ((gy !== null && gy > -0.25) || inLaneOrPool(p.x, p.z, 1)) {
            prev = null;
            continue;
          }
          floats.push({ x: p.x, z: p.z, c: n++ % 2 });
          if (prev) rope.push(prev.x, 0.16, prev.z, p.x, 0.16, p.z);
          prev = p;
        }
      }
    }
    if (floats.length) {
      const fIm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6).scale(1, 0.7, 1), new THREE.MeshLambertMaterial({}), floats.length);
      const m4 = new THREE.Matrix4();
      const cY = new THREE.Color('#ffd21f'), cW = new THREE.Color('#ffffff');
      floats.forEach((f, i) => {
        fIm.setMatrixAt(i, m4.makeTranslation(f.x, 0.1, f.z));
        fIm.setColorAt(i, f.c ? cY : cW);
      });
      fIm.instanceColor.needsUpdate = true;
      fIm.name = 'laneFloats';
      fIm.computeBoundingSphere();
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rope, 3));
      const rl = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#fff2c4' }));
      rl.name = 'laneRope';
      group.add(fIm, rl);
    }
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

  // ================================================================ 물살 레인 (하늘색 화살표 물결 띠 + 바깥 가장자리 뜨개, boat3 2026-11-15)
  const currents = lanes; // (예전 이름: 테스트 도구가 api.currents를 봄)
  // 레인 무늬: 진한 하늘색 띠 + 흰 V자 물결 (밝은 노을 물 위에서도 하얗게 바래지 않게 보통 섞기)
  const curTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(20,170,255,0.5)';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.moveTo(6, 46);
    g.lineTo(32, 18);
    g.lineTo(58, 46);
    g.lineTo(48, 52);
    g.lineTo(32, 34);
    g.lineTo(16, 52);
    g.closePath();
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  })();
  const curMat = new THREE.MeshBasicMaterial({ map: curTex, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const curEdgeMat = new THREE.MeshBasicMaterial({ color: '#7fe6ff', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const laneFloats = [];
  for (const cu of lanes) {
    const N = track.samples.length - 1;
    const a = Math.round(cu.t0 * N), b = Math.round(cu.t1 * N);
    const list = track.spanList(a, b);
    const pos = [], uv = [], idx = [], epos = [], eidx = [];
    const d0 = list[0].dist;
    let lastF = -99;
    list.forEach((s, i) => {
      const t = s.dist / track.length;
      const c = laneLat(cu, t);
      const fade = Math.min(1, i / 5, (list.length - 1 - i) / 5);
      const w = (cu.w / 2) * (0.45 + 0.55 * fade);
      const L = track.surf(s, c - w, 0, V()), Rr = track.surf(s, c + w, 0, V());
      pos.push(L.x, 0.07, L.z, Rr.x, 0.07, Rr.z);
      const v = (s.dist - d0) / 4;
      uv.push(0, v, Math.max(1, Math.round(cu.w / 4)), v);
      for (const [sd, q] of [[-1, L], [1, Rr]]) {
        const o = track.surf(s, c + sd * (w + 0.7), 0, V());
        epos.push(q.x, 0.08, q.z, o.x, 0.08, o.z);
      }
      if (i) {
        const j = (i - 1) * 2;
        idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
        const e = (i - 1) * 4;
        eidx.push(e, e + 4, e + 1, e + 1, e + 4, e + 5, e + 2, e + 6, e + 3, e + 3, e + 6, e + 7);
      }
      // 바깥 가장자리 뜨개 (하늘색·흰색, 6 m마다, 부딪히지 않음): 물길 쪽 가장자리는 원래 부표 줄
      if (s.dist - lastF > 6 && fade > 0.6) {
        lastF = s.dist;
        const sd = Math.sign(c) || 1;
        const q = track.surf(s, c + sd * (cu.w / 2 + 0.6), 0, V());
        laneFloats.push({ x: q.x, z: q.z, c: laneFloats.length % 2 });
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
    em.name = 'currentEdge';
    group.add(m, em);
  }
  if (laneFloats.length) {
    const fIm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 8, 6).scale(1, 0.7, 1), new THREE.MeshLambertMaterial({ emissive: '#0a3a48' }), laneFloats.length);
    const m4b = new THREE.Matrix4();
    const cA = new THREE.Color('#5fe3ff'), cB = new THREE.Color('#ffffff');
    laneFloats.forEach((f, i) => {
      fIm.setMatrixAt(i, m4b.makeTranslation(f.x, 0.1, f.z));
      fIm.setColorAt(i, f.c ? cA : cB);
    });
    fIm.instanceColor.needsUpdate = true;
    fIm.name = 'laneEdgeFloats';
    fIm.computeBoundingSphere();
    group.add(fIm);
  }

  // ================================================================ 바위 치우기 (boat3): 풍경의 물길 옆 작은 바위가 물살 레인·소용돌이 안에 있으면 숨김 (모습만, 충돌 없던 바위)
  let hiddenRocks = 0;
  if (lanes.length || pools.length) {
    const rockIm = scene.getObjectByName('rocks');
    if (rockIm && rockIm.isInstancedMesh) {
      const m4r = new THREE.Matrix4(), pr = V(), qr = new THREE.Quaternion(), sr = V();
      let hid = 0;
      for (let i = 0; i < rockIm.count; i++) {
        rockIm.getMatrixAt(i, m4r);
        m4r.decompose(pr, qr, sr);
        if (pr.y > 3 || !inLaneOrPool(pr.x, pr.z, 2.5 + Math.max(sr.x, sr.z))) continue;
        rockIm.setMatrixAt(i, m4r.makeScale(0, 0, 0));
        hid++;
      }
      if (hid) rockIm.instanceMatrix.needsUpdate = true;
      hiddenRocks = hid;
    }
  }

  // ================================================================ 파도 앞 거품 줄 (boat3): 밝은 하얀 줄 = 지금 이 줄을 지나면 파도 꼭대기에 닿음
  //   줄은 파도 경사 시작에서 foamAhead m 앞, 밝기 = foamLead초 뒤 파도 높이 (글자 안내 없음, 눈으로 타이밍)
  const SWD = data.swell || {};
  const waves = track.waves || [];
  const foamAhead = SWD.foamAhead ?? 30, foamLead = SWD.foamLead ?? 0.6;
  const foamTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 32;
    const g = c.getContext('2d');
    for (let k = 0; k < 260; k++) {
      const x = Math.random() * 128, y = 16 + (Math.random() - 0.5) * 22 * Math.random(), r = 1.5 + Math.random() * 5;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  })();
  // 파도마다 메시 하나(재질 투명도로 밝기): 하얀 거품 띠 + 그 앞 옅은 물결 띠
  const foamLines = waves.map((wv) => {
    // 줄 자리: 코스를 따라 파도 경사 시작에서 foamAhead m 앞 (굽은 물길에서도 물길 가운데·파도 옆 위치에 맞게)
    const n0 = track.nearest(V().set(wv.x, 0, wv.z));
    const N = track.samples.length - 1;
    let i = n0.index, back = wv.len + foamAhead;
    while (back > 0) {
      const j = (i - 1 + N) % N;
      back -= Math.max(0.01, track.samples[i].dist - track.samples[j].dist);
      i = j;
    }
    const sl = track.samples[i];
    const pl = track.surf(sl, wv.offset, 0, V());
    const mat = new THREE.MeshBasicMaterial({ map: foamTex, color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    m.position.set(pl.x, 0.07, pl.z);
    m.rotation.y = Math.atan2(sl.tan.x, sl.tan.z);
    m.scale.set(wv.w + 6, 1, 3);
    m.name = 'waveFoamLine';
    m.renderOrder = 1;
    group.add(m);
    // 파도 꼭대기 거품 (seaScenery가 파도 메시에 붙인 판): 높을수록 진하게
    const crest = wv.mesh.children.find((c) => c.material && c.material.map && c.name !== 'seaWaveBack');
    return { wv, m, mat, crest };
  });
  const foamLineIm = foamLines.length ? true : null;

  // ================================================================ 물보라 입자 (꼬리 물기둥·부표 물보라)
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

  /** (boat3) 물보라 고리: 둘레로 퍼지는 물방울 + 거품 고리 (깔끔한 착수 표시) */
  //   (뒤쪽 = 카메라 쪽은 빼고 낮고 작게: 크게 하면 화면이 하얗게 덮였음)
  function ring(x, z, r0, n, power, vx = 0, vz = 0) {
    const vl = Math.hypot(vx, vz) || 1, fx = vx / vl, fz = vz / vl;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2, ca = Math.cos(a), sa = Math.sin(a);
      if (ca * fx + sa * fz < -0.35) continue;
      const s2 = (3.5 + Math.random() * 2) * power;
      emit(x + ca * r0, 0.15, z + sa * r0, vx * 0.85 + ca * s2, (1.6 + Math.random() * 1.8) * power, vz * 0.85 + sa * s2, 0.45 + Math.random() * 0.3, 0.35, 1.05); // 배와 같이 앞으로 흘러서 카메라에서 보임
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
    if (!st) fxState.set(c, (st = { acc: 0, lastX: c.pos.x, lastZ: c.pos.z, foamD: 0 }));
    // (boat3) 착수 순간: 물보라 고리 (플레이어는 소리도)
    const LL = c.lastLanding;
    if (LL && LL.t !== st.landT) {
      st.landT = LL.t;
      if (LL.kind === 'clean') {
        ring(c.pos.x, c.pos.z, 2.4, near ? 30 : 14, 1, c.vel.x, c.vel.z);
        for (let k = 0; k < 10; k++) dropFoam(c.pos.x + Math.cos(k * 0.628) * 3.4, c.pos.z + Math.sin(k * 0.628) * 3.4, k * 0.628 + 1.57, 2.4, 3.4, near ? 2.2 : 1.2);
        if (c === carRef) sfx.splashClean();
      } else if (LL.kind === 'nose') {
        burst(V().set(c.pos.x + c.fwd.x * 2.4, 0, c.pos.z + c.fwd.z * 2.4), near ? 60 : 24, 1.6);
        if (c === carRef) sfx.noseDive();
      } else burst(c.pos, near ? 18 : 8, 0.8);
    }
    const onW = c.mode === 'boat' && c.surface === 'water' && c.grounded && c.pos.y < 1.2;
    const sp = Math.hypot(c.vel.x, c.vel.z);
    const moved = Math.hypot(c.pos.x - st.lastX, c.pos.z - st.lastZ);
    st.lastX = c.pos.x;
    st.lastZ = c.pos.z;
    if (!onW || sp < 6 || moved > 8) return;
    const fast = clamp01((sp - 10) / 35);
    const fw = c.fwd;
    const rate = near ? 1 : 0.4;
    // 꼬리 물기둥: 선외기 뒤로 솟는 물 (빠를수록 높고 많이)
    st.acc += dt * (14 + 90 * fast) * rate;
    while (st.acc >= 1) {
      st.acc -= 1;
      const sx = c.pos.x - fw.x * 2.5, sz = c.pos.z - fw.z * 2.5;
      const back = 2 + sp * 0.12;
      emit(sx + R(-0.3, 0.3), 0.3, sz + R(-0.3, 0.3), c.vel.x * 0.5 - fw.x * back + R(-1.2, 1.2), R(3, 4) + 7.5 * fast * R(0.7, 1.1), c.vel.z * 0.5 - fw.z * back + R(-1.2, 1.2), R(0.55, 0.9), 0.35, 1.1 + 0.8 * fast);
    }
    // 거품 자국: 2.4 m마다 하나
    st.foamD += moved;
    if (st.foamD > 2.4) {
      st.foamD = 0;
      dropFoam(c.pos.x - fw.x * 2.6, c.pos.z - fw.z * 2.6, Math.atan2(fw.x, fw.z), 2.2, 3.2, (0.35 + 0.65 * fast) * (near ? 1 : 0.7));
    }
  }

  // ================================================================ 물리 스텝 (플레이어 차: 게이트·부표·거친 물·급류)
  const prevPos = V();
  const crossLog = []; // 테스트용: 최근 게이트 통과 기록 (문 가운데 기준 옆 위치)
  let havePrev = false, roughHintT = 0, roughFlag = false, curFlag = false;

  // ================================================================ 코스 밖 물 (seafix 2026-11-10, 사용자 요청 "바다에서 숏컷을 가도 페널티가 없음")
  //   물 위(배)에서 코스(물길·도로) 가운데로부터 떨어진 거리 ti.dist를 봄. 부표 줄(HW + out) 밖으로
  //   free m까지는 괜찮음(조금 넓게 나간 것) → 그 밖은 멀수록 세게 느려짐(거친 물) + "🌊 코스 밖! 느려져요"
  //   → resetOut m 넘게(물길 가운데에서 약 35 m) 나가거나 코스 밖에 maxOutT초 넘게 있으면 물길로 복귀(car.respawn = 마지막으로 코스 위에 있던 곳 30 m 뒤)
  //   봇은 이 함수를 안 거침 (update는 플레이어 차만 받음)
  const offCfg = {
    free: OC.free ?? 4, // 부표 줄 밖 몇 m까지 봐줌
    k0: OC.k0 ?? 0.2, // 봐주는 선을 넘은 순간 초당 감속 비율
    kPer: OC.kPer ?? 0.05, // 1 m 더 나갈 때마다 더하는 감속
    kMax: OC.kMax ?? 1.2,
    resetOut: OC.resetOut ?? 24, // 부표 줄 밖 이만큼이면 복귀
    resetDelay: OC.resetDelay ?? 0.35, // (한 프레임 튀는 것 무시)
    maxOutT: OC.maxOutT ?? 4, // 코스 밖에 이만큼 오래 있으면 복귀
  };
  const off = { t: 0, farT: 0, hintT: 0, warnT: 0, flag: false, last: 0 };
  function offCourse(dt, car, ti) {
    if (off.hintT > 0) off.hintT -= dt;
    if (off.warnT > 0) off.warnT -= dt;
    if (!LB || OC.enabled === false) return;
    const raceOn = !(window.game && window.game.race && window.game.race.phase === 'finished');
    // 물 위(배)인가: 물에 떠 있거나, 파도 점프로 물 위 공중
    const wet = car.surface === 'water' && car.grounded;
    const airOverWater = !car.grounded && car.mode === 'boat';
    if (!wet && !airOverWater) {
      off.t = Math.max(0, off.t - dt * 2);
      off.farT = 0;
      off.flag = false;
      return;
    }
    let out = ti.dist - (HW + (LB.out ?? 1.6)); // 부표 줄 밖으로 몇 m
    if (out > 0 && (laneAt(ti.t, ti.lateral, 2.5) || inPool(car.pos.x, car.pos.z, 2))) out = 0; // 물살 레인·소용돌이 = 코스 (boat3)
    off.last = out;
    if (airOverWater) return; // 공중에서는 판정만 멈춤 (착지하면 다시)
    if (out > totals.offMax) totals.offMax = out;
    const over = out - offCfg.free;
    if (over <= 0) {
      off.t = Math.max(0, off.t - dt * 2);
      off.farT = 0;
      off.flag = false;
      return;
    }
    off.t += dt;
    totals.offT += dt;
    // 거친 물: 멀수록 세게 (속도에 곱하기, 앞뒤 속도와 실제 움직임 둘 다)
    const k = Math.min(offCfg.kMax, offCfg.k0 + offCfg.kPer * over);
    const f = Math.exp(-k * dt);
    totals.slowLost += Math.abs(car.speed) * (1 - f);
    car.speed *= f;
    car.vel.x *= f;
    car.vel.z *= f;
    if (raceOn && !off.flag && off.hintT <= 0) {
      popText('🌊 코스 밖! 느려져요', '#9fdcff', false, 1.2);
      off.hintT = 3;
    }
    off.flag = true;
    if (raceOn && out > offCfg.resetOut * 0.6 && off.warnT <= 0 && off.hintT < 2.2) {
      popText('⚠️ 부표 줄 안으로! 더 나가면 돌아가요', '#ffd27a', false, 1.2);
      off.warnT = 3;
    }
    off.farT = out > offCfg.resetOut ? off.farT + dt : 0;
    if (off.farT > offCfg.resetDelay || off.t > offCfg.maxOutT) {
      off.t = off.farT = 0;
      off.flag = false;
      totals.offResets++;
      car.respawn();
      havePrev = false;
      off.hintT = 3;
      popText('🌊 코스를 벗어나서 물길로 돌아왔어요', '#9fdcff', false, 1.8);
      sfx.thunk(false);
    }
  }

  /**
   * 물살 레인·소용돌이 (boat3 2026-11-15): 물 위의 배 하나에 (플레이어·봇 같은 규칙)
   *   레인 안 = car.boatFlow(세기, 레인 양 끝은 점점), 소용돌이 = 물이 배를 옮김(가장자리는 앞으로 미는 물살, 깊을수록 안으로 끌기) + 뱃머리를 돌림, 깊으면 느려지며 빙글
   */
  function waterForces(dt, c, isPlayer) {
    if (c.mode !== 'boat' || c.surface !== 'water' || !c.grounded) return null;
    const ti = c.trackInfo;
    if (!ti) return null;
    let inLane = null;
    if (lanes.length && inWaterT(ti.t, 0.005)) {
      const L = laneAt(ti.t, ti.lateral, 0.3);
      if (L) {
        const u = Math.min(1, (ti.t - L.t0) / L.fade, (L.t1 - ti.t) / L.fade);
        c.boatFlow(L.k * Math.max(0.15, u));
        inLane = L;
        if (isPlayer) totals.currentT += dt;
      }
    }
    for (const p of pools) {
      const dx = c.pos.x - p.x, dz = c.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d >= p.r || d < 0.3) continue;
      const k = 1 - d / p.r, rx = dx / d, rz = dz / d;
      const tx = p.dir * rz, tz = -p.dir * rx; // 도는 물 방향
      // 가장자리(k 작음)는 앞으로 미는 물살이 대부분, 안으로 끄는 힘·뱃머리 돌림은 깊을수록(k²) 커짐
      const k2 = k * k;
      c.pos.x += (tx * p.spin * k - rx * p.pull * k2) * dt;
      c.pos.z += (tz * p.spin * k - rz * p.pull * k2) * dt;
      const deep = k > p.core ? (k - p.core) / (1 - p.core) : 0;
      c.fwd.applyAxisAngle(c.up, p.dir * (p.turn * k2 + p.coreTurn * deep) * dt);
      if (deep > 0) {
        const f = Math.exp(-p.coreDrag * deep * dt);
        c.speed *= f;
        c.vel.x *= f;
        c.vel.z *= f;
      }
      if (isPlayer) (totals.poolT += dt), deep > 0 && (totals.poolDeepT += dt);
    }
    return inLane;
  }

  function update(dt, car) {
    carRef = car;
    const GM = window.game;
    // 너울 파도 높이: 레이스 시계 (모두 같은 시각이면 같은 높이)
    if (track.updateWaves) track.updateWaves(GM && GM.race ? GM.race.clock || 0 : 0);
    const inLane = waterForces(dt, car, true);
    const rsB = GM && GM.raceSys;
    if (rsB && rsB.bots) for (const b of rsB.bots) if (b.car && b.car !== car) waterForces(dt, b.car, false);
    if (inLane && !curFlag) sfx.whoosh();
    curFlag = !!inLane;
    const ti = car.trackInfo;
    if (!ti) return;
    offCourse(dt, car, ti);
    const jumped = havePrev && Math.hypot(car.pos.x - prevPos.x, car.pos.z - prevPos.z) > 6; // 복귀·순간 이동
    prevPos.copy(car.pos);
    havePrev = true;
    const near = inWaterT(ti.t, 0.02);
    if (roughHintT > 0) roughHintT -= dt;
    if (!near) {
      for (const g of gates) g.prev = null;
      if (run.active && !run.done && ti.t > waterT.t1) finishRun();
      roughFlag = false;
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
    const rough = LB && (LB.roughDrag ?? 0.15) > 0 && car.grounded && ti.sample && ti.sample.water && Math.abs(ti.lateral) > edge + 0.6;
    if (rough) {
      car.speed -= car.speed * (LB.roughDrag ?? 0.15) * dt;
      totals.roughT += dt;
      if (!roughFlag && roughHintT <= 0 && Math.abs(car.speed) > 12) {
        popText('🌊 거친 물! 부표 안쪽이 빨라요', '#9fdcff', false, 1.4);
        roughHintT = 8;
      }
    }
    roughFlag = !!rough;
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
      const sp = Math.abs(car.speed), fast = clamp01((sp - 8) / 40);
      const fl = car.flowK > 0 ? 1 : 0;
      sfx.hiss(onW ? 0.025 + 0.11 * fast + (car.surgeT > 0 ? 0.04 : 0) + 0.05 * fl : 0, clamp01(0.3 * fast + 0.25 * fl));
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

    // --- 물살 레인 화살표 흐름
    curTex.offset.y -= dt * 2.6;
    // --- (boat3) 파도 앞 거품 줄 (밝을수록 지금 지나가면 꼭대기) + 꼭대기 근처 물보라
    if (foamLineIm) {
      const GM = window.game;
      const clock = GM && GM.race ? GM.race.clock || 0 : 0;
      foamTex.offset.x += dt * 0.05;
      for (const fl of foamLines) {
        const wv = fl.wv;
        const kAhead = track.waveU ? track.waveU(wv, clock + foamLead) : 0.5;
        const kNow = (wv.k - wv.hMin) / Math.max(1e-3, wv.hMax - wv.hMin);
        const b = Math.pow(kAhead, 2);
        fl.mat.opacity = 0.1 + 0.9 * b;
        fl.m.scale.set(wv.w + 4 + 4 * b, 1, 2.5 + 5 * b);
        if (fl.crest) fl.crest.material.opacity = 0.2 + 0.8 * kNow;
        // 꼭대기 물보라: 파도가 높을 때 꼭대기 줄에서 하얀 물이 흩날림 (가까울 때만)
        if (near && kNow > 0.78 && car && (car.pos.x - wv.x) ** 2 + (car.pos.z - wv.z) ** 2 < 260 * 260) {
          wv._sprayAcc = (wv._sprayAcc || 0) + (dt * 40 * (kNow - 0.78)) / 0.22;
          while (wv._sprayAcc >= 1) {
            wv._sprayAcc -= 1;
            const u = (Math.random() - 0.5) * wv.w * 0.8;
            const top = wv.h * wv.k * 0.95;
            emit(wv.x + wv.tz * u, top, wv.z - wv.tx * u, wv.tx * R(1, 3), R(1.5, 3.5), wv.tz * R(1, 3), R(0.5, 0.9), 0.4, 1.4);
          }
        }
      }
    }

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
    Object.assign(off, { t: 0, farT: 0, hintT: 0, warnT: 0, flag: false, last: 0 });
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
    lanes,
    pools,
    laneAt,
    laneLat,
    get hiddenRocks() {
      return hiddenRocks;
    },
    /** 테스트용: 이번 바퀴·전체 기록 */
    sfx,
    stats: () => ({ run: { ...run }, lastRun, total: NG, ...totals, crossLog: crossLog.slice(), off: { ...off } }),
  };
  track.buoyGates = api;
  track.boatSpray = true; // offroadFx.js: 물 위 네모 조각 대신 이 파일의 물보라를 씀
  return api;
}
