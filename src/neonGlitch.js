// 네온 시티 · 글리치 차원
//
//   포털 A(data.dimension.t0)를 지나면 "글리치 차원"으로 들어가고, 포털 B(t1)를 지나면 도시로 돌아옵니다.
//   (gpSpace.js의 우주 차원과 같은 방식: 차는 그대로 같은 코스를 달리고, 보이는 세계만 바뀜. 숨겨도 충돌은 그대로)
//   - 글리치 세계: 보라·분홍 레트로 하늘, 줄무늬 태양, 끝없는 네온 격자 바닥, 와이어프레임 산, 떠다니며 지지직거리는 큐브,
//     데이터 빛기둥, "ERROR" 홀로그램, 위로 떠오르는 데이터 알갱이, 저중력 언덕 표시
//   - 포털 통과: 화면 번쩍임 + RGB 어긋난 글자 "⚡ 글리치 차원" + 위이잉 소리 (N으로 끔), 글리치 안에서는 화면에 옅은 주사선
import * as THREE from 'three';
import { portalGate } from './gpSpace.js';
import { seededRandom, canvasTexture } from './neonTrack.js';
import { hologramMaterial, createRain, glowTexture } from './neonAssets.js';

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

export function buildGlitch(track, scene, { cityObjects = [], getCityEnv = () => null } = {}) {
  const D = track.dimension;
  if (!D) return null;
  const rand = seededRandom(1337);
  const R = (a, b) => a + rand() * (b - a);
  const world = new THREE.Group();
  world.name = 'glitchWorld';
  world.userData.world = 'glitch';
  world.visible = false;
  scene.add(world);
  const both = new THREE.Group();
  both.name = 'portals';
  scene.add(both);
  const animators = [];
  const gs = track.samples.filter((s) => s.glitch);
  const gc = new THREE.Vector3();
  for (const s of gs) gc.add(s.pos);
  gc.divideScalar(Math.max(1, gs.length));
  gc.y = 0;
  // 가까운 글리치 도로까지 거리
  const roadD = (x, z) => {
    let b = Infinity;
    for (let k = 0; k < gs.length; k += 3) b = Math.min(b, (gs[k].pos.x - x) ** 2 + (gs[k].pos.z - z) ** 2);
    return Math.sqrt(b);
  };

  // ---------------------------------------------------------------- 1) 하늘 돔 (위 짙은 보라 → 수평선 분홍 → 아래 검정)
  const skyTex = canvasTexture(16, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#0a0018');
    gr.addColorStop(0.35, '#250a48');
    gr.addColorStop(0.49, '#ff3fa8');
    gr.addColorStop(0.5, '#ffb04a');
    gr.addColorStop(0.52, '#3a0a3a');
    gr.addColorStop(1, '#000000');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  skyTex.wrapS = THREE.ClampToEdgeWrapping;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  world.add(sky);
  // 별 (반짝)
  {
    const n = 1200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = R(0, Math.PI * 2), ph = R(0.05, 1.3);
      pos.set([Math.cos(th) * Math.cos(ph) * 2200, Math.sin(ph) * 2200, Math.sin(th) * Math.cos(ph) * 2200], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffd6ff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
    sky.add(stars);
  }

  // ---------------------------------------------------------------- 2) 줄무늬 레트로 태양 (글리치 구간 너머 수평선)
  const sunDir = new THREE.Vector3().subVectors(gc, track.groundCenter ? new THREE.Vector3(track.groundCenter.x, 0, track.groundCenter.y) : new THREE.Vector3()).setY(0).normalize();
  if (sunDir.lengthSq() < 0.5) sunDir.set(-1, 0, -1).normalize();
  const sunTex = canvasTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#ffe96a');
    gr.addColorStop(0.5, '#ff7a3a');
    gr.addColorStop(1, '#ff1f9a');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 9; k++) {
      const y = h * 0.52 + k * k * 3.2 + k * 12;
      g.fillRect(0, y, w, 4 + k * 2.2);
    }
  });
  sunTex.wrapS = sunTex.wrapT = THREE.ClampToEdgeWrapping;
  const retroSun = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false, toneMapped: false }));
  retroSun.renderOrder = -9;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,120,200,0.9)', 'rgba(255,60,160,0.25)'), transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.renderOrder = -9;
  sky.add(halo, retroSun);
  {
    const p = sunDir.clone().multiplyScalar(2000).setY(160);
    retroSun.position.copy(p);
    halo.position.copy(p).multiplyScalar(1.01);
    retroSun.lookAt(0, 160, 0);
    halo.lookAt(0, 160, 0);
  }

  // ---------------------------------------------------------------- 3) 네온 격자 바닥 (끝없이, 카메라를 따라 움직이되 격자는 제자리)
  const gridMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCam; varying vec3 vW;
      float line(float x, float w) { float f = abs(fract(x) - 0.5); return smoothstep(w, 0.0, 0.5 - f); }
      void main() {
        vec2 p = vW.xz / 24.0;
        float g = max(line(p.x, 0.04), line(p.y, 0.04));
        float g2 = max(line(p.x / 5.0, 0.012), line(p.y / 5.0, 0.012));
        float d = length(vW.xz - uCam.xz);
        float fade = 1.0 - smoothstep(300.0, 1500.0, d);
        vec3 col = mix(vec3(1.0, 0.18, 0.75), vec3(0.2, 0.95, 1.0), 0.5 + 0.5 * sin(d * 0.004 - uTime * 0.6));
        vec3 base = vec3(0.03, 0.0, 0.06);
        vec3 c = base + col * (g * 0.9 + g2 * 0.7) * fade;
        // 물결처럼 지나가는 빛 띠
        float wave = smoothstep(6.0, 0.0, abs(mod(d - uTime * 60.0, 260.0) - 130.0)) * 0.35 * fade;
        c += col * wave;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const gridY = -14;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), gridMat);
  grid.position.y = gridY;
  world.add(grid);

  // ---------------------------------------------------------------- 4) 와이어프레임 산 (멀리 고리 모양)
  {
    const mats = [new THREE.MeshBasicMaterial({ color: '#ff2fd0', wireframe: true, transparent: true, opacity: 0.55, fog: false }), new THREE.MeshBasicMaterial({ color: '#38f0ff', wireframe: true, transparent: true, opacity: 0.45, fog: false })];
    const fill = new THREE.MeshBasicMaterial({ color: '#06000d', fog: false });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + R(-0.1, 0.1);
      const dist = R(700, 1000);
      const w = R(260, 420), h = R(90, 230);
      const geo = new THREE.PlaneGeometry(w, h, 10, 6);
      const pa = geo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), y = pa.getY(i);
        const u = x / w + 0.5, v = y / h + 0.5;
        const peak = Math.max(0, 1 - Math.abs(u - 0.5) * 2) ** 1.2;
        pa.setY(i, v * h * peak * (0.8 + 0.4 * Math.sin(u * 17 + k)) - h / 2 * 0);
        pa.setZ(i, (rand() - 0.5) * 18 * v);
      }
      geo.computeVertexNormals();
      const m = new THREE.Group();
      m.add(new THREE.Mesh(geo, fill), new THREE.Mesh(geo, mats[k % 2]));
      m.children[1].position.z = 0.5;
      m.position.set(gc.x + Math.cos(a) * dist, gridY, gc.z + Math.sin(a) * dist);
      m.lookAt(gc.x, gridY, gc.z);
      world.add(m);
    }
  }

  // ---------------------------------------------------------------- 5) 떠다니는 글리치 큐브 + 데이터 빛기둥
  const cubes = [];
  {
    const NC = 170;
    for (let k = 0; k < NC && cubes.length < NC; k++) {
      const s = gs[Math.floor(rand() * gs.length)];
      const side = rand() < 0.5 ? -1 : 1;
      const lat = side * R(26, 160);
      const p = track.surf(s, lat, 0, new THREE.Vector3());
      const size = R(1.5, 9);
      p.y = s.pos.y + R(-10, 40);
      if (roadD(p.x, p.z) < track.railLatOf(s, 1) + size + 6) continue;
      cubes.push({ p, size, rot: new THREE.Euler(R(0, 3), R(0, 3), 0), w: R(-0.6, 0.6), jit: 0, ph: R(0, 6) });
    }
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), cubes.length);
    const wire = new THREE.InstancedMesh(new THREE.BoxGeometry(1.08, 1.08, 1.08), new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, toneMapped: false }), cubes.length);
    const cols = ['#ff2fd0', '#38f0ff', '#8a5cff', '#ffe23a', '#14051f', '#14051f'];
    cubes.forEach((c, k) => {
      const col = new THREE.Color(cols[k % cols.length]);
      im.setColorAt(k, col);
      wire.setColorAt(k, new THREE.Color(k % 2 ? '#ff2fd0' : '#38f0ff'));
    });
    im.frustumCulled = wire.frustumCulled = false;
    world.add(im, wire);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
    let nextJit = 0;
    animators.push((t) => {
      if (t > nextJit) {
        nextJit = t + 0.08;
        for (let j = 0; j < 6; j++) cubes[Math.floor(Math.random() * cubes.length)].jit = 0.15;
      }
      cubes.forEach((c, k) => {
        c.jit = Math.max(0, c.jit - 0.016);
        q.setFromEuler(c.rot.set(c.ph + t * c.w, c.ph * 0.7 + t * c.w * 0.6, 0));
        pp.copy(c.p);
        pp.y += Math.sin(t * 0.6 + c.ph) * 1.5;
        if (c.jit > 0) pp.x += (Math.random() - 0.5) * c.size, pp.z += (Math.random() - 0.5) * c.size;
        sc.setScalar(c.jit > 0 ? c.size * (0.6 + Math.random() * 0.8) : c.size);
        m4.compose(pp, q, sc);
        im.setMatrixAt(k, m4);
        wire.setMatrixAt(k, m4);
      });
      im.instanceMatrix.needsUpdate = wire.instanceMatrix.needsUpdate = true;
    });
    // 빛기둥
    const beamTex = canvasTexture(16, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, h, 0, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    beamTex.wrapS = beamTex.wrapT = THREE.ClampToEdgeWrapping;
    const beamGeo = new THREE.CylinderGeometry(2.5, 2.5, 300, 10, 1, true).translate(0, 150, 0);
    for (let k = 0; k < 36; k++) {
      const s = gs[Math.floor(rand() * gs.length)];
      const p = track.surf(s, (rand() < 0.5 ? -1 : 1) * R(40, 260), 0, new THREE.Vector3());
      if (roadD(p.x, p.z) < 30) continue;
      const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: beamTex, color: rand() < 0.5 ? '#ff2fd0' : '#38f0ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
      b.position.set(p.x, gridY, p.z);
      b.scale.set(R(0.5, 1.6), R(0.4, 1), R(0.5, 1.6));
      world.add(b);
    }
  }

  // ---------------------------------------------------------------- 6) 글리치 홀로그램 표지 (ERROR, 저중력, 헤어핀)
  const holoMats = [];
  {
    const signs = [
      [D.t0 + 0.006, '⚠ SYSTEM GLITCH', '현실.exe 응답 없음', '#ff2fd0', -1],
      [track.data.gravity ? track.data.gravity.t0 - 0.004 : D.t0 + 0.02, 'LOW-G ZONE ↑', '저중력 점프!', '#7dff6a', 1],
      [track.data.sections && track.data.sections.hairpin ? track.data.sections.hairpin[0] - 0.012 : D.t1 - 0.04, 'ERROR 404', '헤어핀 ↺ 브레이크!', '#38f0ff', 1],
      [D.t1 - 0.006, 'REBOOT ▶', '도시로 귀환', '#ffe23a', -1],
    ];
    for (const [t, a, b, col, side] of signs) {
      const s = track.sampleAt(((t % 1) + 1) % 1);
      const tex = canvasTexture(512, 256, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.strokeStyle = col;
        g.lineWidth = 8;
        g.strokeRect(8, 8, w - 16, h - 16);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '900 70px system-ui, "Malgun Gothic", sans-serif';
        g.fillStyle = '#ffffff';
        g.fillText(a, w / 2, h * 0.38);
        g.font = '800 46px system-ui, "Malgun Gothic", sans-serif';
        g.fillStyle = col;
        g.fillText(b, w / 2, h * 0.72);
      });
      const mat = hologramMaterial(col, { opacity: 1, lines: 2.5, map: tex });
      holoMats.push(mat);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), mat);
      const p = track.surf(s, side * (track.railLatOf(s, side) + 6), 7, new THREE.Vector3());
      pl.position.copy(p);
      pl.rotation.y = Math.atan2(s.tan.x, s.tan.z) + Math.PI - side * 0.45;
      world.add(pl);
    }
    animators.push((t) => holoMats.forEach((m) => (m.uniforms.uTime.value = t)));
  }
  // 저중력 언덕: 길 위 위로 올라가는 빛 화살표 고리
  if (track.data.gravity) {
    const g = track.data.gravity;
    const mat = hologramMaterial('#7dff6a', { opacity: 0.7, lines: 1.5 });
    holoMats.push(mat);
    const rings = [];
    for (let k = 0; k < 6; k++) {
      const s = track.sampleAt(g.t0 + ((g.t1 - g.t0) * (k + 0.5)) / 6);
      const r = new THREE.Mesh(new THREE.TorusGeometry(track.railLatOf(s, 1) + 1.5, 0.35, 6, 48, Math.PI), mat);
      r.position.copy(s.pos);
      r.rotation.y = Math.atan2(s.tan.x, s.tan.z); // 고리 면이 진행 방향을 바라봄 → 길 위 아치
      world.add(r);
      rings.push(r);
    }
    animators.push((t) => rings.forEach((r, k) => (r.scale.setScalar(1 + 0.04 * Math.sin(t * 4 + k)))));
  }

  // ---------------------------------------------------------------- 7) 위로 떠오르는 데이터 알갱이 (비 대신)
  const motes = createRain({ count: 900, box: 130, height: 70 });
  motes.mat.uniforms.uColor.value.set('#ff7ae8');
  motes.mat.uniforms.uSpeed.value = 6;
  motes.mat.uniforms.uLen.value = 0.8;
  motes.mat.uniforms.uOpacity.value = 0.6;
  motes.mat.uniforms.uDir.value = 1;
  world.add(motes.obj);

  // ---------------------------------------------------------------- 8) 포털 A, B (두 세계 모두에서 보임)
  const portals = [];
  for (const [t, c1, c2] of [[D.t0, '#ff2fd0', '#38f0ff'], [D.t1, '#38f0ff', '#ffe23a']]) {
    const s = track.sampleAt(t);
    const pg = portalGate({ radius: Math.max(17, track.railLatOf(s, 1) + 4), color: c1, color2: c2 });
    pg.obj.position.copy(s.pos);
    pg.obj.rotation.y = Math.atan2(s.tan.x, s.tan.z);
    both.add(pg.obj);
    portals.push({ pg, s, pos: s.pos.clone(), tan: s.tan3.clone().normalize() });
  }

  // ---------------------------------------------------------------- 9) 세계 전환
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  const sun = scene.children.find((o) => o.isDirectionalLight);
  const fog = scene.fog;
  const cityEnv = {
    bg: scene.background.clone(), fog: fog.color.clone(), near: fog.near, far: fog.far,
    hemiSky: hemi ? hemi.color.clone() : null, hemiGround: hemi ? hemi.groundColor.clone() : null, hemiI: hemi ? hemi.intensity : 1,
    sunC: sun ? sun.color.clone() : null, sunI: sun ? sun.intensity : 1,
  };
  const glitchEnv = {
    bg: new THREE.Color('#12002a'), fog: new THREE.Color('#2a0640'), near: 220, far: 1600,
    hemiSky: new THREE.Color('#ff7ae0'), hemiGround: new THREE.Color('#1a0040'), hemiI: 1.1,
    sunC: new THREE.Color('#ffb0f0'), sunI: 0.9,
  };
  let envK = 0;
  function applyEnv(k) {
    const a = cityEnv, b = glitchEnv;
    scene.background.lerpColors(a.bg, b.bg, k);
    fog.color.lerpColors(a.fog, b.fog, k);
    fog.near = THREE.MathUtils.lerp(a.near, b.near, k);
    fog.far = THREE.MathUtils.lerp(a.far, b.far, k);
    if (hemi) hemi.color.lerpColors(a.hemiSky, b.hemiSky, k), hemi.groundColor.lerpColors(a.hemiGround, b.hemiGround, k), (hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, k));
    if (sun) sun.color.lerpColors(a.sunC, b.sunC, k), (sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, k));
  }
  // 화면 효과: 번쩍임 + RGB가 어긋난 글자 + 글리치 안에서는 옅은 주사선
  const fx = document.createElement('div');
  fx.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;z-index:5;';
  const scan = document.createElement('div');
  scan.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;z-index:4;background:repeating-linear-gradient(0deg, rgba(255,60,200,0.06) 0px, rgba(255,60,200,0.06) 1px, transparent 2px, transparent 4px);mix-blend-mode:screen;transition:opacity .4s;';
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:50%;top:22%;transform:translateX(-50%);pointer-events:none;opacity:0;z-index:6;font:900 30px/1.2 system-ui,sans-serif;letter-spacing:3px;color:#fff;white-space:nowrap;';
  if (document.body) document.body.append(fx, scan, label);
  let flash = 0, labelT = 0;
  // 포털 소리 (위이잉 + 지지직). N 키로 같이 꺼짐
  let actx = null;
  // 키·터치 모두 소리를 준비해요. 음소거 상태는 공통 믹서 한 곳에서만 기억해요.
  const wakeAudio = () => {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } else if (actx.state === 'suspended') actx.resume().catch(() => {});
  };
  window.addEventListener('keydown', wakeAudio);
  window.addEventListener('pointerdown', wakeAudio, { passive: true });
  function zap(into) {
    if (!actx || actx.state !== 'running') return;
    try {
      const st = window.game && window.game.settings && window.game.settings.values;
      if (st && st.muted) return;
    } catch {}
    const t0 = actx.currentTime;
    const len = Math.floor(actx.sampleRate * 1.2);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    // 지지직: 짧게 끊기는 잡음
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.floor(i / 900) % 3 === 0 ? 1 : 0.25);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(into ? 400 : 3000, t0);
    bp.frequency.exponentialRampToValueAtTime(into ? 3200 : 300, t0 + 1.0);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.15);
    const osc = actx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(into ? 110 : 660, t0);
    osc.frequency.exponentialRampToValueAtTime(into ? 880 : 90, t0 + 0.8);
    const og = actx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.08, t0 + 0.05);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    src.connect(bp).connect(g).connect(actx.destination);
    osc.connect(og).connect(actx.destination);
    src.start(t0);
    src.stop(t0 + 1.2);
    osc.start(t0);
    osc.stop(t0 + 1.0);
  }

  let inGlitch = false, force = null;
  const cityEnvMap = () => getCityEnv();
  function setWorld(g, announce) {
    inGlitch = g;
    track.setWorld(g);
    world.visible = g;
    for (const o of cityObjects) o.visible = !g;
    for (const p of portals) p.pg.diskMat.uniforms.uMode.value = 0;
    scene.environment = g ? null : cityEnvMap();
    scan.style.opacity = g ? '1' : '0';
    if (announce) {
      flash = 1;
      labelT = 2.2;
      label.textContent = g ? '⚡ 글리치 차원' : '🌃 네온 시티 귀환';
      label.style.textShadow = g ? '-3px 0 #ff2fd0, 3px 0 #38f0ff, 0 0 18px #ff2fd0' : '0 0 14px #38f0ff, 0 0 28px #ff2f8e';
      fx.style.background = g
        ? 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,47,208,0.7) 45%, rgba(20,0,40,0.9) 100%)'
        : 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(56,240,255,0.6) 50%, rgba(10,6,32,0.85) 100%)';
      zap(g);
    }
  }
  /** 지금 글리치에 있어야 하나: 포털 근처는 카메라가 포털 면 어느 쪽인지로 (카메라가 포털을 지나는 순간 바뀜) */
  function wantGlitch(car) {
    if (force !== null) return force;
    const ti = car && car.trackInfo;
    if (!ti) return inGlitch;
    const cam = window.game && window.game.camera ? window.game.camera.position : car.pos;
    const L = track.length;
    const near = (t0) => {
      const d = Math.abs(ti.t - t0);
      return Math.min(d, 1 - d) * L < 120;
    };
    if (near(D.t0)) return _p.subVectors(cam, portals[0].pos).dot(portals[0].tan) > 0;
    if (near(D.t1)) return _p.subVectors(cam, portals[1].pos).dot(portals[1].tan) < 0;
    return D.inGlitchT(ti.t);
  }

  return {
    group: world,
    portals,
    get inGlitch() {
      return inGlitch;
    },
    /** 테스트용: true/false로 세계 고정, null이면 자동 */
    set force(v) {
      force = v;
    },
    get force() {
      return force;
    },
    update(t, dt, car) {
      const want = wantGlitch(car);
      if (want !== inGlitch) setWorld(want, dt > 0 && force === null);
      const target = inGlitch ? 1 : 0;
      envK = dt > 0 ? THREE.MathUtils.clamp(envK + Math.sign(target - envK) * (dt / 0.35), 0, 1) : target;
      applyEnv(envK);
      const cam = window.game && window.game.camera;
      if (cam) {
        sky.position.copy(cam.position);
        gridMat.uniforms.uCam.value.copy(cam.position);
        motes.mat.uniforms.uCam.value.copy(cam.position);
      }
      gridMat.uniforms.uTime.value = t;
      motes.mat.uniforms.uTime.value = t;
      for (const p of portals) p.pg.update(t);
      if (inGlitch) for (const a of animators) a(t, dt, car);
      flash = Math.max(0, flash - dt * 1.6);
      fx.style.opacity = (flash * flash * 0.85).toFixed(3);
      labelT = Math.max(0, labelT - dt);
      label.style.opacity = Math.min(1, labelT * 1.5).toFixed(3);
      if (labelT > 0 && inGlitch) label.style.transform = `translateX(calc(-50% + ${((Math.random() - 0.5) * 6).toFixed(1)}px))`;
    },
  };
}
