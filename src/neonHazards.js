// 네온 시티 · 운전이 달라지는 기믹 (2026-11-15 neon2, 사용자 "맵 효과가 주행에서 달라지는 게 없음", 점검표 TOP 5의 4번)
//
//   1) 글리치 차원 '깜빡이는 길' (data/neon.json glitchRoad, 생성기 .debug/neon_gen.js)
//      S자 두 굽이·헤어핀의 안쪽 차선(+연석·갓길) 조각이 레이스 시계로 정해진 박자(2.6~3초)마다 사라졌다 생김.
//      조각이 있을 때 안쪽으로 붙으면 S자를 풀 가속으로 지나감(지름길), 없을 때 들어가면 격자 바닥으로 떨어져 뒤로 복귀.
//      바깥쪽(늘 있는 길)은 조금 돌아감. 레이싱 라인·봇은 늘 있는 길로만 (neonTrack.js lineLimitF).
//      보이는 것: 하늘색 데이터 조각 → 사라지기 0.55초 전 빨갛게 깜빡 → 사라지면 빨간 테두리만 → 생기기 0.35초 전 하늘색 윤곽,
//      늘 있는 길 끝 흰 안전선, 구간 시작·가운데 빛 기둥(같은 색), 160 m 앞 떠 있는 경고판·알림, 조각이 사라질 때 지지직 소리.
//      S1·S2 는 '초록 물결': 약 66 m/s로 S1을 열린 순간 지나가면 S2도 열려 있음.
//   2) (시험, 기본 꺼짐 · 주소 &belt=1) 자석 튜브 '급행 벨트' (tubeBelt): 튜브 위쪽 벽(45° 넘게 기운 곳)·천장에 올라탄 차를 컨베이어처럼 진행 방향으로 실어 나름.
//      시험해 보니 곧은 200 m 튜브에서는 240 km/h로 벽까지 옮겨 타는 손해가 벨트 이득보다 커서 끔 (.debug/neon_gen.js tubeBelt 설명)
//      벽을 타고 올라가는 데 거리가 들고(옆으로 가는 만큼 손해), 벨트는 출구 35 m 앞에서 끝나서 그 전에 내려와야 함 (늦게 비스듬히 내려오면 벽에 부딪힘).
//   사람·봇 같은 규칙 (봇은 window.game.raceSys.bots). neonProps.js가 만들고 update(dt, car)(물리 스텝마다)·animate(t)(그릴 때마다)를 부름.
//   결과는 game.props.hazards.stats.  &neon2=0 이면 아무것도 안 함 (track.flicker·tubeBelt가 null)
import * as THREE from 'three';
import { canvasTexture } from './neonTrack.js';
import { mixState } from './audioMix.js';

const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const COL = { on: new THREE.Color('#38f0ff'), warn: new THREE.Color('#ff2a55'), off: new THREE.Color('#ff2a55'), appear: new THREE.Color('#9ff6ff'), dark: new THREE.Color('#1a0630') };

/** 데이터 조각 (테두리 + 안쪽 격자 + 사선 줄). 흰 선에 material.color가 곱해짐 */
function tileTex() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#0e0322';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let k = -h; k < w; k += 22) {
      g.beginPath();
      g.moveTo(k, h);
      g.lineTo(k + 10, h);
      g.lineTo(k + 10 + h, 0);
      g.lineTo(k + h, 0);
      g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.strokeRect(22, 22, w - 44, h - 44);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 7;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#ffffff';
    for (const [x, y] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) g.fillRect(x - 4, y - 4, 8, 8);
  });
}
/** 사라졌을 때 남는 테두리 (가운데는 투명) */
function outlineTex() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.13)'; // 빈자리 전체가 옅게 물듦 (빨강) → 멀리서도 '구멍'이 보임
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff';
    g.setLineDash([16, 10]);
    g.lineWidth = 9;
    g.strokeRect(6, 6, w - 12, h - 12);
  });
}
/** 천장 벨트 화살표 (진행 방향 = 텍스처 +v) */
function beltTex() {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#140a2c';
    g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let k = 0; k < 2; k++) {
      const y = k * (h / 2) + h * 0.12;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 14;
      g.beginPath();
      // 캔버스 아래(+y)가 텍스처 v=0 쪽 → 진행 방향(+v)은 캔버스 위
      g.moveTo(w * 0.14, y + h * 0.3);
      g.lineTo(w * 0.5, y + h * 0.08);
      g.lineTo(w * 0.86, y + h * 0.3);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(0, 0, 6, h);
    g.fillRect(w - 6, 0, 6, h);
  });
}
/** 떠 있는 경고판 */
function signTex(title, sub, color) {
  return canvasTexture(512, 192, (g, w, h) => {
    g.fillStyle = 'rgba(12,4,30,0.92)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.save();
    g.beginPath();
    g.rect(14, 14, w - 28, 26);
    g.clip();
    for (let x = -40; x < w; x += 36) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(x, 40);
      g.lineTo(x + 18, 40);
      g.lineTo(x + 44, 14);
      g.lineTo(x + 26, 14);
      g.fill();
    }
    g.restore();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 54px "Segoe UI","Malgun Gothic",sans-serif';
    g.fillText(title, w / 2, 92);
    g.fillStyle = color;
    g.font = '700 28px "Segoe UI","Malgun Gothic",sans-serif';
    g.fillText(sub, w / 2, 150);
  });
}

/** 샘플 목록을 따라 단면을 밀어 만든 메시 (neonTrack.js strip과 같은 방식, 땅 메시는 아님) */
function band(track, list, profile, mat, { vScale = 6, uScale = null } = {}) {
  const P = profile(list[0]).length, rows = list.length;
  const pos = new Float32Array(rows * P * 3), uv = new Float32Array(rows * P * 2), idx = [];
  const v = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const s = list[r], prof = profile(s);
    let acc = 0;
    for (let k = 0; k < P; k++) {
      if (k) acc += Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]);
      track.surf(s, prof[k][0], prof[k][1], v);
      pos.set([v.x, v.y, v.z], (r * P + k) * 3);
      uv[(r * P + k) * 2] = uScale ? acc / uScale : k / (P - 1);
      uv[(r * P + k) * 2 + 1] = s.dist / vScale;
      if (r < rows - 1 && k < P - 1) {
        const A = r * P + k, B = A + 1, C = A + P, D = C + 1;
        idx.push(A, B, C, B, D, C);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = true;
  return m;
}

export function createNeonHazards(track, scene) {
  const FL = track.flicker, BELT = track.tubeBelt;
  if (!FL && !BELT) return null;
  const S = track.samples, N = S.length - 1, ds = track.length / N;
  const wrap = (i) => ((i % N) + N) % N;
  const GR = FL ? FL.cfg : null;
  const stats = { falls: 0, playerFalls: 0, botFalls: 0, where: [], flickOnT: 0, beltT: 0, beltBotT: 0, beltGain: 0 };
  let clock = 0;

  // ================================================================ 보이는 것: 깜빡이는 조각 (글리치 세계에서만)
  const gGroup = new THREE.Group();
  gGroup.name = 'neonFlicker';
  gGroup.visible = false;
  scene.add(gGroup);
  const tTex = tileTex(), oTex = outlineTex();
  const zoneFx = [];
  if (FL) {
    const seamMat = new THREE.MeshBasicMaterial({ color: '#e8fdff', toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    const seamMat2 = new THREE.MeshBasicMaterial({ color: '#38f0ff', transparent: true, opacity: 0.55, toneMapped: false, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    for (const z of FL.zones) {
      const pcs = FL.pieces.filter((p) => p.z === z);
      if (!pcs.length) continue;
      const sd = z.side;
      const map = tTex.clone();
      map.needsUpdate = true;
      const tileMat = new THREE.MeshBasicMaterial({ map, color: COL.on.clone(), transparent: true, opacity: 1, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const lineMat = new THREE.MeshBasicMaterial({ map: oTex, color: COL.off.clone(), transparent: true, opacity: 0.5, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
      const beamMat = new THREE.MeshBasicMaterial({ color: COL.on.clone(), transparent: true, opacity: 0.75, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
      // 잘린 가장자리 빛 (도로 판 옆면을 따라 아래로 1.2 m): 있을 때 하늘색, 곧 사라짐·없을 때 빨강 → 낭떠러지 끝이 또렷
      const edgeMat = new THREE.MeshBasicMaterial({ color: COL.on.clone(), transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const fx = { z, tileMat, lineMat, beamMat, edgeMat, tiles: [], lines: [], last: null };
      for (const pc of pcs) {
        const prof = (h) => (s) => {
          const out = [];
          const r = track.railLatOf(s, sd), n = 4;
          for (let k = 0; k <= n; k++) {
            const l = z.pe + ((r - z.pe) * k) / n;
            out.push([sd * l, h]);
          }
          return sd > 0 ? out : out.reverse();
        };
        const t = band(track, pc.L, prof(0.025), tileMat, { vScale: 4.6, uScale: 3.1 });
        const l = band(track, pc.L, prof(0.03), lineMat, { vScale: 4.6, uScale: 3.1 });
        t.renderOrder = 1;
        gGroup.add(t, l);
        fx.tiles.push(t);
        fx.lines.push(l);
        gGroup.add(band(track, pc.L, (s) => [[sd * (z.pe + 0.04), -0.02], [sd * (z.pe + 0.04), -1.25]], edgeMat, { vScale: 6 }));
        // 늘 있는 길 끝 안전선 (흰 줄 + 옅은 빛)
        gGroup.add(band(track, pc.L, (s) => (sd > 0 ? [[z.pe - 0.28, 0.035], [z.pe - 0.02, 0.035]] : [[-z.pe + 0.02, 0.035], [-z.pe + 0.28, 0.035]]), seamMat, { vScale: 6 }));
        gGroup.add(band(track, pc.L, (s) => (sd > 0 ? [[z.pe - 1.1, 0.03], [z.pe - 0.28, 0.03]] : [[-z.pe + 0.28, 0.03], [-z.pe + 1.1, 0.03]]), seamMat2, { vScale: 6 }));
      }
      // 빛 기둥: 구간 시작·가운데, 깜빡이는 쪽 벽 바로 안
      const geos = [];
      for (const i of [z.a, Math.round((z.a + z.b) / 2), z.b]) {
        const s = S[wrap(i)];
        const p = track.surf(s, sd * (track.railLatOf(s, sd) - 0.7), 0, new THREE.Vector3());
        const gq = new THREE.BoxGeometry(0.7, 12, 0.7).translate(p.x, p.y + 6, p.z);
        geos.push(gq);
        const cap = new THREE.OctahedronGeometry(1.2).translate(p.x, p.y + 12.8, p.z);
        geos.push(cap);
      }
      const beams = new THREE.Mesh(mergeGeos(geos), beamMat);
      gGroup.add(beams);
      fx.beams = beams;
      zoneFx.push(fx);
    }
    // 경고판: 첫 구간(S자)·헤어핀 160 m 앞, 깜빡이는 쪽 벽 위, 다가오는 차를 바라봄
    const signs = [];
    const signFor = (z, title, sub) => {
      const i = wrap(z.a - Math.round(160 / ds)), s = S[i];
      const mat = new THREE.MeshBasicMaterial({ map: signTex(title, sub, '#ff3bd4'), transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 3.6), mat);
      const p = track.surf(s, z.side * (track.railLatOf(s, z.side) - 1.2), 5.4, new THREE.Vector3());
      m.position.copy(p);
      m.lookAt(p.clone().addScaledVector(s.tan, -10).addScaledVector(s.right, -z.side * 3));
      gGroup.add(m);
      signs.push(m);
    };
    const zS = FL.zones.find((z) => z.id === 'S1') || FL.zones[0];
    const zH = FL.zones.find((z) => z.id === 'H');
    if (zS) signFor(zS, '⚡ 깜빡이는 길', `S자 안쪽 조각이 ${zS.period}초마다 사라져요`);
    if (zH) signFor(zH, '⚡ 깜빡이는 길', '헤어핀 안쪽 · 빨갛게 깜빡이면 곧 사라짐');
  }

  // ================================================================ 보이는 것: 천장 급행 벨트 (도시 세계, 튜브 안)
  let beltMat = null, beltEndMat = null;
  const bGroup = new THREE.Group();
  bGroup.name = 'neonTubeBelt';
  scene.add(bGroup);
  if (BELT) {
    const TB = BELT.tube;
    const i0 = TB.a + Math.round(BELT.fadeIn / ds), i1 = TB.b - Math.round(BELT.endGap / ds);
    const list = [];
    for (let i = i0; i <= i1; i++) list.push(S[wrap(i)]);
    const bt = beltTex();
    bt.repeat.set(1, 1);
    bt.wrapS = bt.wrapT = THREE.RepeatWrapping;
    beltMat = new THREE.MeshBasicMaterial({ map: bt, color: '#ffd23a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    // 벨트 = 위쪽 둥근 벽(45°부터)·수직 벽·천장을 한 바퀴 덮는 띠 (튜브 단면 neonTrack.js wallProf·ceilProf와 같은 모양, 가운데 쪽으로 8 cm 띄움)
    const R = TB.R, H = TB.H, w2 = TB.w2, ARC = 6;
    const cs = [];
    for (let j = 0; j <= ARC; j++) {
      const a = -Math.PI / 4 + (Math.PI / 4) * (j / ARC);
      cs.push([w2 + R * Math.cos(a), R + R * Math.sin(a)]);
    }
    for (let j = 0; j <= ARC; j++) {
      const a = (Math.PI / 2) * (j / ARC);
      cs.push([w2 + R * Math.cos(a), H - R + R * Math.sin(a)]);
    }
    const half = cs.map(([x, y]) => [x, y]);
    const ring = [...half.map(([x, y]) => [x, y]), ...half.slice().reverse().map(([x, y]) => [-x, y])];
    const cY = H / 2;
    const prof = ring.map(([x, y]) => {
      const dx = x, dy = y - cY, l = Math.hypot(dx, dy) || 1;
      return [x - (dx / l) * 0.08, y - (dy / l) * 0.08];
    });
    const beltMesh = band(track, list, () => prof, beltMat, { vScale: 9, uScale: 6 });
    bGroup.add(beltMesh);
    // 벨트 끝 줄무늬 (빨강·검정): 여기서부터 내려와야 함
    const endList = [];
    for (let i = i1; i <= i1 + Math.round(10 / ds); i++) endList.push(S[wrap(i)]);
    const et = canvasTexture(128, 64, (g, w, h) => {
      g.fillStyle = '#18060c';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff2a55';
      for (let x = -h; x < w; x += 32) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 16, h);
        g.lineTo(x + 16 + h, 0);
        g.lineTo(x + h, 0);
        g.fill();
      }
    });
    beltEndMat = new THREE.MeshBasicMaterial({ map: et, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    bGroup.add(band(track, endList, () => prof, beltEndMat, { vScale: 4, uScale: 4 }));
    // 튜브 입구 바닥 글자 "⬆ 벽 위 급행 BELT" (양쪽 차선)
    const decal = new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 512, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.fillStyle = '#ffd23a';
        g.beginPath();
        g.moveTo(w * 0.5, h * 0.04);
        g.lineTo(w * 0.86, h * 0.3);
        g.lineTo(w * 0.62, h * 0.3);
        g.lineTo(w * 0.62, h * 0.5);
        g.lineTo(w * 0.38, h * 0.5);
        g.lineTo(w * 0.38, h * 0.3);
        g.lineTo(w * 0.14, h * 0.3);
        g.fill();
        g.font = '900 64px "Segoe UI","Malgun Gothic",sans-serif';
        g.textAlign = 'center';
        g.fillText('벽 위', w / 2, h * 0.68);
        g.fillText('급행', w / 2, h * 0.82);
        g.font = '800 40px "Segoe UI","Malgun Gothic",sans-serif';
        g.fillText('BELT', w / 2, h * 0.95);
      }),
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    });
    const di = TB.a - Math.round(40 / ds);
    for (const lat of [-5.2, 5.2]) {
      const s = S[wrap(di)];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 7.2), decal);
      const p = track.surf(s, lat, 0.05, new THREE.Vector3());
      const zx = s.tan3.clone().normalize(), xx = new THREE.Vector3().crossVectors(zx, s.up).normalize();
      // 평면의 +y(글자 위쪽) = 진행 방향, 법선 = 도로 위
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, zx, s.up));
      m.position.copy(p);
      bGroup.add(m);
    }
  }

  // ================================================================ 알림 (DOM)
  const toast = document.createElement('div');
  toast.id = 'neonHzToast';
  toast.style.cssText =
    'position:fixed;left:50%;top:29%;transform:translateX(-50%) scale(.96);z-index:5;pointer-events:none;opacity:0;transition:opacity .25s, transform .25s;' +
    'font:800 26px/1.2 "Segoe UI","Malgun Gothic",sans-serif;letter-spacing:1px;color:#fff;white-space:nowrap;text-align:center;text-shadow:0 0 12px #ff2fd0,0 0 26px #38f0ff';
  if (document.body) document.body.append(toast);
  let toastT = 0;
  function showToast(text, sub, color = '#7ff3ff') {
    toast.innerHTML = `${text}<div style="font-size:15px;font-weight:700;opacity:.92;margin-top:3px;color:${color}">${sub || ''}</div>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) scale(1)';
    toastT = 2.4;
  }
  const warned = new Map(); // 알림 이름 → 마지막으로 보인 시계
  const quiet = (() => {
    try {
      const q = new URLSearchParams(location.search);
      return !!q.get('tutorial') || !!q.get('academy');
    } catch {
      return false;
    }
  })();
  function warnOnce(key, text, sub, color) {
    if (quiet) return;
    if (clock - (warned.get(key) ?? -1e9) < 25) return;
    warned.set(key, clock);
    showToast(text, sub, color);
  }

  // ================================================================ 소리 (조각이 사라질 때 지지직, 생길 때 짧은 삑, 벨트 위 윙 — N·음소거면 꺼짐)
  let actx = null, out = null, beltG = null;
  const wake = () => {
    if (actx) {
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    out = actx.createGain();
    out.gain.value = 0.9;
    out.connect(actx.destination);
    // 벨트 윙윙 (톱니 + 띠 통과)
    const o = actx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 92;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 2;
    beltG = actx.createGain();
    beltG.gain.value = 0;
    o.connect(bp).connect(beltG).connect(out);
    o.start();
  };
  window.addEventListener('keydown', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });
  const muted = () => {
    try {
      return !!mixState().muted || !!(window.game && window.game.paused);
    } catch {
      return false;
    }
  };
  function crackle(vol, up) {
    if (!actx || muted() || vol < 0.02) return;
    const t = actx.currentTime;
    if (up) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(660, t);
      o.frequency.exponentialRampToValueAtTime(1320, t + 0.09);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 * vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.14);
      return;
    }
    const len = Math.floor(actx.sampleRate * 0.28);
    const buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.floor(i / 700) % 2 ? 1 : 0.2) * (1 - i / len);
    const src = actx.createBufferSource(), g = actx.createGain(), hp = actx.createBiquadFilter();
    src.buffer = buf;
    hp.type = 'highpass';
    hp.frequency.value = 900;
    g.gain.value = 0.12 * vol;
    src.connect(hp).connect(g).connect(out);
    src.start(t);
  }

  // ================================================================ 물리 (매 스텝): 떨어짐 + 벨트
  const state = new WeakMap();
  const _d = new THREE.Vector3();
  function zoneHere(i) {
    // 차 앞뒤 3 m까지 (구간 끝 경계에서 걸쳐도)
    const k = Math.round(3 / ds);
    for (const q of [i, i - k, i + k]) {
      const z = FL.zoneAt(q);
      if (z) return z;
    }
    return null;
  }
  function stepCar(car, dt, isPlayer, name) {
    const ti = car.trackInfo;
    if (!ti) return;
    let st = state.get(car);
    if (!st) state.set(car, (st = { fallT: 0, gap: null }));
    const i = ti.index ?? Math.round(ti.t * N);
    // --- 깜빡이는 길: 조각 자리(pe 밖)에서 떨어지기 시작한 차가 도로보다 fall.below m 아래로 fall.delay초 → 복귀
    //     (떨어지는 동안 길이 굽어서 옆 거리는 줄어듦 → 한 번 빠지면 계속 셈). 글리치 어디서든 4.5 m 넘게 아래면 같은 복귀 (도로 밑 땅에서 달리지 않게)
    if (FL && S[wrap(i)].glitch) {
      const s = ti.sample || S[wrap(i)];
      _d.copy(car.pos).sub(s.pos);
      const lat = _d.x * s.right.x + _d.z * s.right.z;
      const below = track.roadYAt(s, THREE.MathUtils.clamp(lat, -track.deckHalf, track.deckHalf)) - car.pos.y;
      const z = zoneHere(i);
      if (z && !car.grounded && below > 0.4 && lat * z.side > z.pe - 0.6) st.gap = z;
      if (car.grounded && below < 1) st.gap = null;
      if (isPlayer && z && car.grounded && lat * z.side > z.pe && FL.state(z).on) stats.flickOnT += dt;
      const falling = (st.gap && below > (GR.fall?.below ?? 2)) || below > 4.5;
      st.fallT = falling ? st.fallT + dt : 0;
      if (st.fallT > (GR.fall?.delay ?? 0.2)) {
        const zz = st.gap;
        st.fallT = 0;
        st.gap = null;
        car.respawn();
        stats.falls++;
        if (isPlayer) stats.playerFalls++;
        else stats.botFalls++;
        if (stats.where.length < 60) stats.where.push(`${name}@${zz ? zz.id : s.t.toFixed(3)}`);
        if (isPlayer) {
          warned.set('fall', clock);
          showToast('⚡ 길이 사라졌어요!', '빨갛게 깜빡이면 곧 사라짐 · 흰 안전선 안쪽은 늘 있음', '#ff7ab8');
        }
        return;
      }
    } else (st.fallT = 0), (st.gap = null);
    // --- 천장 급행 벨트: 컨베이어처럼 차를 실어 나름 (차 속도는 그대로, 위치만 진행 방향으로 carry m/s 더 감)
    //     속도에 더하면 car.js가 최고 속도 위 몫을 0.4초 만에 지워 버려 거의 이득이 없었음 → 바닥이 움직이는 것과 같게 위치로
    if (BELT && car.grounded && car.magnet && car.mode !== 'fly' && car.mode !== 'boat' && car.up.dot(S[wrap(i)].up || car.up) < (BELT.maxUp ?? 0.7)) {
      const TB = BELT.tube, k = wrap(i - TB.a), L = TB.b - TB.a;
      if (k <= L) {
        const dIn = k * ds, dOut = (L - k) * ds, f = BELT.fade ?? 12;
        const w = smooth(BELT.fadeIn - f, BELT.fadeIn, dIn) * smooth(BELT.endGap, BELT.endGap + f, dOut);
        if (w > 0) {
          const s = S[wrap(i)], tg = s.tan3 || s.tan, c = (BELT.carry ?? 12) * w;
          car.pos.addScaledVector(tg, c * dt);
          if (isPlayer) (stats.beltT += dt), (stats.beltGain += c * dt), (beltNow = w);
          else stats.beltBotT += dt;
        }
      }
    }
  }
  let beltNow = 0;
  function update(dt, car) {
    if (!car) return;
    const g = window.game;
    clock = g && g.race && Number.isFinite(g.race.clock) ? g.race.clock : clock + dt;
    if (FL) FL.clock.t = clock;
    beltNow = 0;
    stepCar(car, dt, true, 'P');
    const rs = g && g.raceSys;
    if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car !== car) stepCar(b.car, dt, false, b.name);
    // 다가갈 때 알림 (플레이어만)
    const ti = car.trackInfo;
    if (ti) {
      const i = ti.index ?? Math.round(ti.t * N);
      const v = Math.max(20, Math.abs(car.speed));
      if (FL)
        for (const z of FL.zones) {
          if (z.id === 'S2') continue; // S1·S2는 한 번에
          const d = wrap(z.a - i) * ds;
          if (d > 0 && d < Math.max(140, v * 2.6)) {
            const way = z.side > 0 ? '오른쪽 ▶' : '◀ 왼쪽';
            const sub = z.id === 'H' ? `헤어핀 안쪽 ${way} 조각 · 있을 때만 붙기` : `S자 안쪽 조각 · 열렸을 때 들어가면 풀 가속 · 바깥은 늘 안전`;
            warnOnce('z' + z.id, '⚡ 깜빡이는 길', sub, '#ff7ab8');
          }
        }
      if (BELT) {
        const d = wrap(BELT.tube.a - i) * ds;
        if (d > 0 && d < Math.max(120, v * 2.2)) warnOnce('belt', '🧲 튜브 급행 벨트', '벽을 높이 타면(노란 띠) 실어 줘요 · 빨간 줄 전에 내려오기', '#ffd23a');
      }
    }
  }

  // ================================================================ 그릴 때마다
  let lastT = null;
  function animate(time) {
    const t = time ?? performance.now() / 1000;
    const dt = lastT === null ? 1 / 60 : THREE.MathUtils.clamp(t - lastT, 0, 0.1);
    lastT = t;
    const g = window.game;
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) scale(.96)';
      }
    }
    // 벨트 (도시 세계, 늘 움직임)
    if (beltMat) {
      beltMat.map.offset.y -= (dt * (BELT.carry ?? 12)) / 9; // 화살표가 벨트 속도(carry m/s)로 흐름 (텍스처 한 칸 = 9 m)
      beltMat.color.setHSL(0.13, 1, 0.55 + 0.12 * Math.sin(t * 6));
    }
    if (actx && beltG) beltG.gain.setTargetAtTime(muted() ? 0 : beltNow * 0.07, actx.currentTime, 0.08);
    const glitch = !!track.inGlitch;
    gGroup.visible = glitch && zoneFx.length > 0;
    if (!glitch || !FL) return;
    // 리플레이는 그 장면의 레이스 시계로 (같은 시각이면 같은 모양)
    let ck = FL.clock.t;
    const rp = g && g.replay;
    if (rp && rp.active) {
      const st = rp.state;
      if (st && Number.isFinite(st.t)) ck = st.t;
    }
    const car = g && g.car;
    const pi = car && car.trackInfo ? car.trackInfo.index ?? 0 : 0;
    for (const fx of zoneFx) {
      const st = FL.state(fx.z, ck);
      const key = st.on ? (st.warn ? 'warn' : 'on') : st.appear ? 'appear' : 'off';
      // 소리: 플레이어 앞 160 m ~ 뒤 20 m 안 구간만
      if (fx.last && fx.last !== key && !(rp && rp.active)) {
        const d = wrap(fx.z.a - pi) * ds;
        const near = d < 160 || wrap(pi - fx.z.b) * ds < 20 ? 1 : 0;
        if (key === 'off') crackle(near, false);
        if (key === 'on' && fx.last === 'appear') crackle(near, true);
      }
      fx.last = key;
      const blink = 0.5 + 0.5 * Math.sign(Math.sin(t * 2 * Math.PI * 9));
      if (key === 'on') {
        fx.tileMat.color.copy(COL.on);
        fx.tileMat.opacity = 1;
        fx.tileMat.map.offset.set(0, 0);
        fx.beamMat.color.copy(COL.on);
        fx.beamMat.opacity = 0.7;
      } else if (key === 'warn') {
        fx.tileMat.color.copy(COL.warn).lerp(COL.dark, 1 - blink);
        fx.tileMat.opacity = 0.7 + 0.3 * blink;
        // 글리치 떨림: 무늬가 툭툭 어긋남 (모양만, 물리는 그대로)
        fx.tileMat.map.offset.set(Math.random() < 0.3 ? (Math.random() - 0.5) * 0.2 : 0, 0);
        fx.beamMat.color.copy(COL.warn);
        fx.beamMat.opacity = 0.35 + 0.55 * blink;
      } else if (key === 'appear') {
        const k = 1 - st.left / (GR.appear ?? 0.35);
        fx.tileMat.color.copy(COL.appear);
        fx.tileMat.opacity = 0.15 + 0.45 * k;
        fx.tileMat.map.offset.set(0, 0);
        fx.beamMat.color.copy(COL.appear);
        fx.beamMat.opacity = 0.3 + 0.4 * k;
      } else {
        fx.beamMat.color.copy(COL.off);
        fx.beamMat.opacity = 0.12;
      }
      fx.edgeMat.color.copy(key === 'on' ? COL.on : key === 'appear' ? COL.appear : COL.warn);
      fx.edgeMat.opacity = key === 'warn' ? 0.5 + 0.5 * blink : key === 'off' ? 0.65 + 0.25 * Math.sin(t * 10) : 0.85;
      const solid = key !== 'off';
      for (const m of fx.tiles) m.visible = solid;
      for (const m of fx.lines) m.visible = !solid || key === 'appear';
      fx.lineMat.color.copy(key === 'appear' ? COL.appear : COL.off);
      fx.lineMat.opacity = key === 'appear' ? 0.85 : 0.6 + 0.2 * Math.sin(t * 8);
    }
  }
  function reset() {
    toastT = 0;
    toast.style.opacity = '0';
    warned.clear();
    beltNow = 0;
  }
  return { group: gGroup, beltGroup: bGroup, update, animate, reset, stats, get clock() { return clock; }, zones: FL ? FL.zones : [], state: FL ? FL.state : null };
}

/** 여러 BufferGeometry를 하나로 (위치만, 인덱스 없이) */
function mergeGeos(list) {
  let n = 0;
  for (const g of list) n += g.index ? g.index.count : g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.set(g.attributes.position.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeBoundingSphere();
  return out;
}
