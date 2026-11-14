// 네온 시티 코스 (data/neon.json, module: "neonMap")
//
// gpTrack.js(구름섬 그랑프리)를 바탕으로 도시 서킷에 맞게 고친 복사본입니다.
//   - 도로는 높이가 있는 3D 중심선 (points = [x, y, z]). 땅 높이(0)에서 고가도로(18 m)까지 오르내림
//   - 도시 서킷이라 도로 양옆은 모두 포장된 갓길 + 네온 방호벽 (보이지 않는 충돌 벽과 같은 선)
//   - 클로버잎 고리: 오른쪽 270° 오르막을 돌아 나오면 방금 지나온 접근 직선 위를 고가로 지나감 (교차)
//   - 자석 튜브 (data.tube): 메가타워를 관통하는 둥근 터널. 벽·천장이 자석 도로(surface 'magnet')라 벽·천장 주행 가능
//   - 글리치 차원 (data.dimension t0~t1): 포털 A~B 사이. 도시 물체와 글리치 물체를 setWorld(glitch)로 번갈아 보이게 함
//   - 저중력 언덕 (data.gravity): 글리치 차원 안의 둥근 언덕. gravityAt(pos)가 중력 배수를 돌려줌 (car.js가 씀)
// 반환 객체는 gpTrack.js와 같은 모양 (car.js, main.js, hud 미니맵, racingLineFx, gpCorners가 그대로 씀)
import * as THREE from 'three';
import { computeRacingLine, edgeFraction } from './racingLine.js';

const UP = new THREE.Vector3(0, 1, 0);
const SAMPLE_STEP = 1.6; // 중심선 샘플 간격 (m)
const smooth = (a, b, x) => {
  const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

// ---------------------------------------------------------------- 공용 도우미 (track.js에서 복사: 그 파일은 다른 에이전트가 고치는 중)
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
/** 비에 젖은 밤 아스팔트: 어두운 바탕 + 흰 가장자리 선 + 노란 가운데 점선. 물웅덩이는 거칠기 지도로 */
function wetRoadTextures() {
  const rnd = seededRandom(77);
  const map = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#1c1d24';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = 22 + rnd() * 26;
      g.fillStyle = `rgba(${v},${v},${v + 8},0.5)`;
      g.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    // 바퀴 자국 (조금 밝음)
    g.fillStyle = 'rgba(70,72,86,0.18)';
    for (const x of [0.25, 0.36, 0.64, 0.75]) g.fillRect(w * x - 6, 0, 12, h);
    g.fillStyle = '#e9ecf2';
    g.fillRect(w * 0.03, 0, w * 0.022, h);
    g.fillRect(w * 0.948, 0, w * 0.022, h);
    g.fillStyle = '#c9a63a';
    g.fillRect(w * 0.492, 0, w * 0.016, h * 0.45);
  });
  // 거칠기 (round 2: 색 얼룩 → 젖은 아스팔트): 바탕은 반쯤 거칠어서 반사가 흐릿하고 어둡게,
  //   물웅덩이(길쭉한 검은 얼룩)만 거울처럼 매끈, 1픽셀 잡티로 반사가 자글자글 부서지게
  const rough = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 90 + rnd() * 110;
      g.fillStyle = `rgba(${v},${v},${v},0.55)`;
      g.fillRect(rnd() * w, rnd() * h, 1, 1 + (rnd() * 2) | 0);
    }
    // 바퀴 자국 줄은 물이 고여 조금 더 매끈
    g.fillStyle = 'rgba(30,30,30,0.35)';
    for (const x of [0.25, 0.36, 0.64, 0.75]) g.fillRect(w * x - 7, 0, 14, h);
    for (let i = 0; i < 46; i++) {
      const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(10,10,10,0.95)');
      gr.addColorStop(1, 'rgba(10,10,10,0)');
      g.fillStyle = gr;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        g.save();
        g.translate(ox + x, oy + y);
        g.scale(0.7, 1.8); // 길 방향으로 길쭉한 웅덩이
        g.translate(-x, -y);
        g.fillRect(x - r, y - r, r * 2, r * 2);
        g.restore();
      }
    }
  });
  rough.colorSpace = THREE.NoColorSpace;
  return { map, rough };
}
function curbTexture(a, b) {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = b;
    g.fillRect(0, h / 2, w, h / 2);
  });
}
function checkerTexture() {
  const tex = canvasTexture(64, 16, (g, w, h) => {
    const s = 8;
    for (let x = 0; x < w / s; x++)
      for (let y = 0; y < h / s; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
        g.fillRect(x * s, y * s, s, s);
      }
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
/** 갓길 포장: 어두운 콘크리트 + 사선 노란 줄 조금 */
function runoffTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#2a2b33';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 40 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v},${v + 6},0.4)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, w, 2);
  });
}
/** 자석 도로: 보라 바탕에 빛나는 육각 격자 + 화살표 */
function magnetTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#1a0f38';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a5cff';
    g.lineWidth = 3;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.strokeStyle = 'rgba(80,220,255,0.7)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(w * 0.5, h * 0.2);
    g.lineTo(w * 0.5, h * 0.8);
    g.stroke();
    g.fillStyle = '#e2c9ff';
    g.beginPath();
    g.moveTo(w * 0.3, h * 0.45);
    g.lineTo(w * 0.5, h * 0.25);
    g.lineTo(w * 0.7, h * 0.45);
    g.lineTo(w * 0.6, h * 0.45);
    g.lineTo(w * 0.5, h * 0.35);
    g.lineTo(w * 0.4, h * 0.45);
    g.fill();
  });
}
/** 글리치 차원 도로: 검정 바탕에 빛나는 격자 (발광) */
function gridRoadTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#07030f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff2fd0';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath();
      g.moveTo((i * w) / 4, 0);
      g.lineTo((i * w) / 4, h);
      g.stroke();
      g.beginPath();
      g.moveTo(0, (i * h) / 4);
      g.lineTo(w, (i * h) / 4);
      g.stroke();
    }
    g.fillStyle = '#38f0ff';
    g.fillRect(0, 0, 6, h);
    g.fillRect(w - 6, 0, 6, h);
  });
}

export function buildNeonTrack(data, scene) {
  const buildT0 = performance.now();
  const W = data.width;
  const HW = W / 2;
  const CURB = 1.6;
  const RUNOFF = 2.6; // 연석 바깥 포장 갓길 → 그 끝에 방호벽
  const DECK = HW + CURB + RUNOFF; // 방호벽 위치 (중심선에서 m)
  const group = new THREE.Group();
  group.name = 'neonTrack';
  scene.add(group);

  // ---------------------------------------------------------------- 중심선 샘플
  const curve = new THREE.CatmullRomCurve3(data.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, data.points.length * 20);
  const length = curve.getLength();
  const SAMPLES = Math.round(length / SAMPLE_STEP);
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pos = curve.getPointAt(t % 1);
    const tan3 = curve.getTangentAt(t % 1);
    const tan = tan3.clone().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
    samples.push({ t, i, pos, tan, tan3, right, dist: t * length, bank: 0, bridge: 'city', land: false });
  }
  const wrapI = (i) => ((i % SAMPLES) + SAMPLES) % SAMPLES;
  const S = (i) => samples[wrapI(i)];
  const indexAt = (t) => Math.round((((t % 1) + 1) % 1) * SAMPLES);
  const sampleAt = (t) => samples[indexAt(t) % SAMPLES];
  function rangeI(t0, t1) {
    const a = indexAt(t0);
    let b = indexAt(t1);
    if (b < a) b += SAMPLES;
    return [a, b];
  }
  const inRangeT = (t, t0, t1) => (t0 <= t1 ? t >= t0 && t <= t1 : t >= t0 || t <= t1);
  const mS = (m) => Math.max(1, Math.round((m / length) * SAMPLES));

  // ---------------------------------------------------------------- neon2 (2026-11-15): 깜빡이는 길 + 천장 급행 벨트. &neon2=0 이면 예전 그대로
  const NEON2 = (() => {
    try {
      return new URLSearchParams(location.search).get('neon2') !== '0';
    } catch {
      return true;
    }
  })();
  const GR = NEON2 && data.glitchRoad && data.glitchRoad.zones && data.glitchRoad.zones.length ? data.glitchRoad : null;
  // 튜브 급행 벨트: 시험해 보니 곧은 튜브에서는 벽을 타는 손해가 더 커서 기본 꺼짐 (data.tubeBelt.on, 주소 &belt=1 이면 켬)
  const BELT = (() => {
    if (!NEON2 || !data.tubeBelt) return null;
    let q = null;
    try {
      q = new URLSearchParams(location.search).get('belt');
    } catch {}
    return q === '1' || (data.tubeBelt.on && q !== '0') ? data.tubeBelt : null;
  })();
  /** 깜빡이는 길 구간 표: zoneOf[i] = 그 샘플의 구간 번호 + 1 (0 = 없음) */
  const flickZones = [];
  const zoneOf = new Uint8Array(SAMPLES + 1);

  // 글리치 차원 구간 (space = true: gpCorners가 네온 표시판을 씀)
  const dim = data.dimension || null;
  const inGlitchT = (t) => !!dim && inRangeT(((t % 1) + 1) % 1, dim.t0, dim.t1);
  for (const s of samples) if (inGlitchT(s.t)) (s.space = true), (s.glitch = true);

  // 자석 튜브: core = 닫힌 튜브, taper = 앞뒤로 벽만 서서히 낮아지는 구간
  const tube = data.tube || null;
  const tubeR = tube ? tube.radius || 5 : 0, tubeH = tube ? tube.height || 12 : 0;
  const TUBE_W2 = HW + CURB; // 튜브 벽이 시작하는 옆 거리 (연석 바깥 끝)
  if (GR)
    GR.zones.forEach((z, n) => {
      const [a, b] = rangeI(z.t0, z.t1);
      flickZones.push({ ...z, n, a, b });
      for (let i = a; i <= b; i++) zoneOf[wrapI(i)] = n + 1;
    });
  zoneOf[SAMPLES] = zoneOf[0];
  const zoneAt = (i) => (zoneOf[wrapI(i)] ? flickZones[zoneOf[wrapI(i)] - 1] : null);
  const tubeK = new Float32Array(SAMPLES + 1); // 0 = 튜브 없음, 0~1 = 벽 높이 비율 (taper), 1 = 닫힌 튜브 구간
  const tubeCore = new Uint8Array(SAMPLES + 1);
  if (tube) {
    const [a, b] = rangeI(tube.t0, tube.t1);
    const tp = mS(tube.taper || 28);
    for (let i = a - tp; i <= b + tp; i++) {
      const k = i < a ? smooth(a - tp, a, i) : i > b ? smooth(b + tp, b, i) : 1;
      tubeK[wrapI(i)] = Math.max(tubeK[wrapI(i)], k);
      if (i >= a && i <= b) tubeCore[wrapI(i)] = 1;
    }
    tubeK[SAMPLES] = tubeK[0];
  }
  const TUBE_RAIL = TUBE_W2 + tubeR + 1.0; // 튜브 앞뒤에서 방호벽이 바깥으로 벌어지는 위치

  // 굽은 방향 → 경사 (data.bank: t0~t1 구간, deg). gpTrack.js와 같은 방식
  const heading = (s) => Math.atan2(s.tan.x, s.tan.z);
  const turnSign = samples.map((s, i) => {
    let d = heading(S(i + 10)) - heading(S(i - 10));
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  });
  for (const bk of data.bank || []) {
    const [a, b] = rangeI(bk.t0, bk.t1);
    const ramp = Math.max(4, mS(22));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += turnSign[wrapI(i)];
    const sgn = Math.sign(sum) || 0;
    const agreeRaw = (i) => THREE.MathUtils.clamp((turnSign[wrapI(i)] * sgn) / 0.03, 0, 1);
    for (let i = a; i <= b; i++) {
      const w = smooth(0, ramp, i - a) * smooth(0, ramp, b - i);
      let agree = 0;
      for (let j = -ramp; j <= ramp; j++) agree += agreeRaw(i + j);
      agree /= 2 * ramp + 1;
      S(i).bank = sgn * THREE.MathUtils.degToRad(bk.deg) * w * agree;
    }
  }
  for (const s of samples) {
    s.rightB = s.right.clone().multiplyScalar(Math.cos(s.bank)).addScaledVector(UP, Math.sin(s.bank));
    s.up = new THREE.Vector3().crossVectors(s.rightB, s.tan3).normalize();
  }
  samples[SAMPLES] = { ...samples[0], t: 1, dist: length, i: SAMPLES };
  const surf = (s, l, h = 0, out = new THREE.Vector3()) => out.copy(s.pos).addScaledVector(s.rightB, l).addScaledVector(s.up, h);
  const roadYAt = (s, l) => s.pos.y + l * Math.tan(s.bank);

  // 밟을 수 있는 면들
  const groundMeshes = [];
  const addGround = (mesh, surface) => {
    mesh.userData.surface = surface;
    groundMeshes.push(mesh);
    group.add(mesh);
    return mesh;
  };

  /** 샘플 목록을 따라 단면(profile)을 밀어 만든 메시들 (gpTrack.js와 같음). world: 'city' | 'glitch' | 'both' | 'auto' */
  function strip(list, profile, mat, { vScale = 8, chunk = 40, uScale = null, surface = null, shadow = false, world = 'auto' } = {}) {
    const meshes = [];
    if (!surface) chunk = Math.max(chunk, 120);
    const prof0 = typeof profile === 'function' ? profile(list[0], 0) : profile;
    const P = prof0.length;
    for (let a = 0; a < list.length - 1; a += chunk) {
      const b = Math.min(list.length - 1, a + chunk);
      const rows = b - a + 1;
      const pos = new Float32Array(rows * P * 3), uv = new Float32Array(rows * P * 2);
      const idx = [];
      const v = new THREE.Vector3();
      for (let r = 0; r < rows; r++) {
        const s = list[a + r];
        const prof = typeof profile === 'function' ? profile(s, a + r) : profile;
        let acc = 0;
        for (let k = 0; k < P; k++) {
          if (k) acc += Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]);
          surf(s, prof[k][0], prof[k][1], v);
          const o = (r * P + k) * 3;
          pos[o] = v.x;
          pos[o + 1] = v.y;
          pos[o + 2] = v.z;
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
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.castShadow = shadow;
      if (world === 'auto') {
        let g = 0;
        for (let r = 0; r < rows; r++) if (list[a + r].glitch) g++;
        m.userData.world = g * 2 > rows ? 'glitch' : 'city';
      } else m.userData.world = world;
      if (surface) addGround(m, surface);
      else group.add(m);
      meshes.push(m);
    }
    return meshes;
  }
  function spanList(a, b) {
    const out = [];
    for (let i = a; i <= b; i++) {
      const s = S(i);
      out.push(i >= SAMPLES ? { ...s, dist: s.dist + length * Math.floor(i / SAMPLES) } : s);
    }
    return out;
  }
  function runsOf(flag) {
    const out = [];
    if (samples.slice(0, SAMPLES).every((s, i) => flag(i))) return [[0, SAMPLES]];
    const off = samples.slice(0, SAMPLES).findIndex((s, i) => !flag(i));
    let a = -1;
    for (let k = 1; k <= SAMPLES; k++) {
      const i = off + k, f = flag(wrapI(i));
      if (f && a < 0) a = i;
      if (!f && a >= 0) out.push([a, i]), (a = -1);
    }
    return out;
  }

  // ---------------------------------------------------------------- 레이싱 라인 + 넓은 연석 (gpTrack.js와 같은 방식)
  const KERB_WIDE = 2.6;
  const LINE_MARGIN = 1.15;
  const LINE_PLAIN = 1.0;
  const kerbW = [new Float32Array(SAMPLES).fill(CURB), new Float32Array(SAMPLES).fill(CURB)];
  const sideI = (side) => (side < 0 ? 0 : 1);
  const kerbAt = (i, side) => kerbW[sideI(side)][wrapI(i)];
  const lineSamples = samples.slice(0, SAMPLES);
  const lineUse = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
  const lineLimit = (i, side) => {
    const u = lineUse[sideI(side)][wrapI(i)];
    return HW - LINE_PLAIN + u * Math.max(0, kerbAt(i, side) - LINE_MARGIN + LINE_PLAIN);
  };
  const widen = (i0, i1, side, ramp) => {
    for (let i = i0; i <= i1; i++) {
      const q = wrapI(i);
      const w = smooth(0, ramp, i - i0) * smooth(0, ramp, i1 - i);
      const u = lineUse[sideI(side)];
      u[q] = Math.max(u[q], w);
      if (tubeK[q] > 0) continue; // 튜브 안은 연석 폭 그대로 (벽이 바로 붙어 있음)
      const arr = kerbW[sideI(side)];
      arr[q] = Math.max(arr[q], CURB + (KERB_WIDE - CURB) * w);
    }
  };
  const halfSamples = lineSamples.filter((_, i) => i % 2 === 0);
  const prelimApexes = () => computeRacingLine(halfSamples, (i, side) => lineLimit(i * 2, side), length, { iterScale: 0.7 }).apexes.map((a) => ({ ...a, i: a.i * 2 }));
  let apexes0 = prelimApexes();
  for (let pass = 0; pass < 2; pass++) {
    for (const ap of apexes0) {
      if (ap.radius > 150) continue;
      widen(ap.i - mS(30), ap.i + mS(22), ap.side, mS(10));
      widen(ap.i + mS(12), ap.i + mS(62), -ap.side, mS(14));
    }
    if (pass === 0) apexes0 = prelimApexes();
  }
  // neon2: 깜빡이는 길 쪽은 조각 앞 clear m까지만 → 라인(=봇·속도 계획·라인 표시)은 늘 있는 길로만. 앞뒤 ramp m에 걸쳐 서서히 좁아짐
  const flickCap = [new Float32Array(SAMPLES).fill(Infinity), new Float32Array(SAMPLES).fill(Infinity)];
  if (GR) {
    // 구간 앞 ramp m부터 뒤 8 m까지 같은 한계 (라인이 구간 바로 앞에서 갑자기 꺾이지 않게 미리 늘 있는 쪽으로; 그 앞뒤는 K1999가 부드럽게 이음)
    const pre = mS(GR.ramp ?? 25), post = mS(8);
    for (const z of flickZones)
      for (let i = z.a - pre; i <= z.b + post; i++) {
        const q = wrapI(i), arr = flickCap[sideI(z.side)];
        arr[q] = Math.min(arr[q], z.pe - (GR.clear ?? 1.8));
      }
  }
  const lineLimitF = (i, side) => Math.min(lineLimit(i, side), flickCap[sideI(side)][wrapI(i)]);
  const racingLine = computeRacingLine(lineSamples, GR ? lineLimitF : lineLimit, length, { bank: lineSamples.map((s) => s.bank || 0) });
  // neon2: 깜빡이는 길 앞·안의 '늘 있는 길' 라인은 좁은 차선 안쪽 끝을 따라감 → 계획 속도대로 달리면 고속 조향 한계 때문에 1~3 m 밀려 조각 위로 나갔음
  //   (라인 자동 운전·마스터 봇). 그 구간만 코너 속도를 slowK배로 낮춰 계획 (라인 색·봇 목표 속도가 같이 낮아짐). 앞뒤 가속·감속 한계로 다시 이음
  if (GR && GR.slowK && GR.slowK < 1) {
    const orig = racingLine.profile.bind(racingLine);
    const pre = mS((GR.ramp ?? 25) + 20), post = mS(10);
    racingLine.profile = (car) => {
      const p = orig(car);
      const v = p.speed, seg = racingLine.seg, n = v.length;
      let any = false;
      for (const z of flickZones)
        for (let i = z.a - pre; i <= z.b + post; i++) {
          const q = wrapI(i) % n;
          v[q] *= GR.slowK;
          any = true;
        }
      if (!any) return p;
      // 감속 한계(뒤로)·가속 한계(앞으로)로 앞뒤를 다시 이음 (두 바퀴)
      for (let lap = 0; lap < 2; lap++) {
        for (let k = n - 1; k >= 0; k--) {
          const nx = (k + 1) % n;
          v[k] = Math.min(v[k], Math.sqrt(v[nx] * v[nx] + 2 * car.aBrake(v[nx]) * seg[k]));
        }
        for (let k = 0; k < n; k++) {
          const pv = (k - 1 + n) % n;
          v[k] = Math.min(v[k], Math.sqrt(v[pv] * v[pv] + 2 * car.aAcc(v[pv]) * seg[pv]));
        }
      }
      for (let k = 0; k < n; k++) p.brake[k] = p.brake[k] || 0;
      return p;
    };
  }
  const lineY = (i, d = 0) => roadYAt(samples[i], racingLine.offset[i] + d);

  // ---------------------------------------------------------------- 도로, 연석, 갓길
  const wet = wetRoadTextures();
  const roadMat = new THREE.MeshStandardMaterial({ map: wet.map, roughnessMap: wet.rough, roughness: 0.55, metalness: 0.2, envMapIntensity: 1.1 }); // 젖은 길 반사: 웅덩이만 또렷, 나머지는 흐릿하고 어둡게
  const glitchRoadTex = gridRoadTexture();
  const glitchRoadMat = new THREE.MeshStandardMaterial({ map: glitchRoadTex, emissiveMap: glitchRoadTex, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.3 });
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture('#ff2f8e', '#f2f2f6'), roughness: 0.5, metalness: 0.1 });
  const curbGlitchTex = curbTexture('#38f0ff', '#160828');
  const curbGlitchMat = new THREE.MeshStandardMaterial({ map: curbGlitchTex, emissiveMap: curbGlitchTex, emissive: '#ffffff', emissiveIntensity: 0.7, roughness: 0.4 });
  const runoffMat = new THREE.MeshStandardMaterial({ map: runoffTexture(), roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
  const runoffGlitchMat = new THREE.MeshStandardMaterial({ color: '#0d0620', emissive: '#2a0a4a', emissiveIntensity: 0.6, roughness: 0.3, side: THREE.DoubleSide });
  const isG = (i) => !!samples[i].glitch;
  // 갓길·벽 위치 (쪽마다): 기본 DECK. 넓힌 연석(코너 안쪽·탈출 바깥) 옆은 벽을 더 멀리 (차가 넓게 나가도 벽에 안 닿게),
  // 튜브 앞뒤에서는 튜브 벽 바깥으로 벌어짐. 앞뒤로 부드럽게 이어지게 평균
  // 저중력 점프 착지 구간: 공중에서는 핸들이 안 들어서 비스듬히 내려앉는 차가 많음 → 언덕부터 착지 뒤 100 m까지 벽을 3 m 더 바깥으로
  const landW = new Float32Array(SAMPLES);
  if (data.gravity) {
    const [a, b] = rangeI(data.gravity.t0, data.gravity.t1);
    const r = mS(25), e = mS(100);
    for (let i = a - r; i <= b + e; i++) landW[wrapI(i)] = smooth(a - r, a, i) * smooth(b + e, b + e - r, i);
  }
  // 코너 갓길: 굽은 곳(반지름 약 400 m보다 급함)은 양쪽 벽을 최대 2.4 m 더 바깥으로.
  //   봇·초보는 라인보다 넓게 나가서 연석 밖 벽을 긁었음 (봇 레이스에서 S자·헤어핀·다운타운 S 탈출). 앞뒤 ±20 m 평균이라 벽이 부드럽게 벌어짐
  const cornerW = new Float32Array(SAMPLES);
  {
    const d = mS(12), w = mS(20);
    const kRaw = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const ta = samples[wrapI(i - d)].tan, tb = samples[wrapI(i + d)].tan;
      const ang = Math.acos(THREE.MathUtils.clamp((ta.x * tb.x + ta.z * tb.z) / (Math.hypot(ta.x, ta.z) * Math.hypot(tb.x, tb.z) || 1), -1, 1));
      kRaw[i] = ang / ((2 * d * length) / SAMPLES);
    }
    for (let i = 0; i < SAMPLES; i++) {
      let m = 0;
      for (let j = -w; j <= w; j++) m += kRaw[wrapI(i + j)];
      cornerW[i] = 2.4 * smooth(1 / 400, 1 / 160, m / (2 * w + 1));
    }
  }
  const railLat = [-1, 1].map((side) => {
    const raw = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const wide = (kerbAt(i, side) - CURB) / (KERB_WIDE - CURB);
      // 튜브 앞뒤(taper): 벽은 1/4 파이프 바깥 끝에 딱 붙임 (2026-11-10 턱 없애기)
      //   예전엔 벽이 일찍 TUBE_RAIL(16.6 m)까지 벌어져서, 낮은 1/4 파이프 뒤쪽 갓길에 들어간 차가 파이프 밑·뒷면에 걸려 멈췄음
      const tk = tubeK[i] > 0 ? 0.04 + 0.96 * tubeK[i] : 0;
      raw[i] = Math.max(DECK + wide * 2.6 + cornerW[i] * 0.4, DECK + cornerW[i], DECK + 3 * landW[i], tk ? TUBE_W2 + tubeR * tk + 0.02 : 0);
    }
    const r = mS(14);
    const out = new Float32Array(SAMPLES + 1);
    for (let i = 0; i < SAMPLES; i++) {
      let m = 0;
      for (let j = -r; j <= r; j++) m = Math.max(m, raw[wrapI(i + j)] - Math.abs(j) * (1.2 / r)); // 넓은 곳 앞뒤로 비스듬히 이어짐
      out[i] = m;
    }
    out[SAMPLES] = out[0];
    return out;
  });
  const railLatOf = (s, side = 1) => railLat[side < 0 ? 0 : 1][s.i % SAMPLES];
  /** [a, b] 구간을 깜빡이는 길 구간 경계에서 나눔 (경계 샘플은 양쪽이 같이 씀 → 잘린 모서리가 또렷) → [{ a, b, z }] */
  function cutRuns(a, b) {
    if (!GR) return [{ a, b, z: null }];
    const out = [];
    let c = a, cz = zoneAt(a);
    for (let i = a + 1; i <= b; i++) {
      const z = zoneAt(i);
      if (z !== cz) {
        // 구간 안으로 들어갈 때: 경계 = 구간 첫 샘플, 나올 때: 경계 = 구간 마지막 샘플
        const e = z ? i : i - 1;
        if (e > c) out.push({ a: c, b: e, z: cz });
        c = e;
        cz = z;
      }
    }
    if (b > c) out.push({ a: c, b, z: cz });
    return out;
  }
  const flickPieces = []; // 깜빡이는 조각 자리 (물리용 판·보이는 판을 만듦)
  for (const [flag, rm, cm, om] of [[(i) => !isG(i), roadMat, curbMat, runoffMat], [isG, glitchRoadMat, curbGlitchMat, runoffGlitchMat]]) {
    for (const [a0, b0] of runsOf(flag)) {
      for (const { a, b, z } of cutRuns(a0, b0)) {
        const L = spanList(a, b);
        const zs = z ? z.side : 0, pe = z ? z.pe : 0;
        // 깜빡이는 쪽: 도로는 pe까지만, 그쪽 연석·갓길은 없음 (그 자리는 neonHazards.js가 그리는 조각)
        strip(L, zs > 0 ? [[-HW, 0], [pe, 0]] : zs < 0 ? [[-pe, 0], [HW, 0]] : [[-HW, 0], [HW, 0]], rm, { vScale: 18, surface: 'ground' });
        if (zs >= 0) strip(L, (s) => [[-HW - kerbAt(s.i, -1), 0.02], [-HW, 0.02]], cm, { vScale: 4, surface: 'ground' });
        if (zs <= 0) strip(L, (s) => [[HW, 0.02], [HW + kerbAt(s.i, 1), 0.02]], cm, { vScale: 4, surface: 'ground' });
        if (zs >= 0) strip(L, (s) => [[-railLatOf(s, -1), 0.01], [-HW - kerbAt(s.i, -1), 0.01]], om, { vScale: 6, surface: 'ground' });
        if (zs <= 0) strip(L, (s) => [[HW + kerbAt(s.i, 1), 0.01], [railLatOf(s, 1), 0.01]], om, { vScale: 6, surface: 'ground' });
        if (z) flickPieces.push({ z, a, b, L });
      }
    }
  }
  // 도로 판 옆면·밑면 (고가도로는 두께가 보임, 땅 높이 구간은 땅에 묻힘)
  const slabMat = new THREE.MeshStandardMaterial({ color: '#3a3f4c', roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide });
  const slabGlitchMat = new THREE.MeshBasicMaterial({ color: '#150630', side: THREE.DoubleSide });
  const underGlowMat = new THREE.MeshBasicMaterial({ color: '#38e8ff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false });
  const underGlowMat2 = new THREE.MeshBasicMaterial({ color: '#ff3bd4', transparent: true, opacity: 0.85, side: THREE.DoubleSide, toneMapped: false });
  for (const [flag, sm] of [[(i) => !isG(i), slabMat], [isG, slabGlitchMat]]) {
    for (const [a0, b0] of runsOf(flag)) {
      for (const { a, b, z } of cutRuns(a0, b0)) {
        const L = spanList(a, b);
        const zs = z ? z.side : 0, pe = z ? z.pe : 0;
        const lw = (s) => (zs < 0 ? -pe : -railLatOf(s, -1) - 0.3), rw = (s) => (zs > 0 ? pe : railLatOf(s, 1) + 0.3);
        const lt = zs < 0 ? -0.03 : 0.2, rt = zs > 0 ? -0.03 : 0.2;
        strip(L, (s) => [[lw(s), lt], [lw(s), -1.6], [rw(s), -1.6], [rw(s), rt]], sm, { vScale: 8, uScale: 4, shadow: true });
        // 판 옆면 아래쪽 네온 띠 (왼쪽 하늘색, 오른쪽 분홍)
        if (zs >= 0) strip(L, (s) => [[-railLatOf(s, -1) - 0.34, -1.25], [-railLatOf(s, -1) - 0.34, -0.95]], underGlowMat);
        if (zs <= 0) strip(L, (s) => [[railLatOf(s, 1) + 0.34, -0.95], [railLatOf(s, 1) + 0.34, -1.25]], underGlowMat2);
      }
    }
  }

  // ---------------------------------------------------------------- 방호벽 (튜브 안은 없음) + 보이지 않는 충돌 벽
  const railSide = [-1, 1].map(() => {
    const need = new Uint8Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) need[i] = tubeCore[i] ? 0 : 1;
    return need;
  });
  function railLimit(near) {
    const side = near.lateral < 0 ? 0 : 1;
    if (!railSide[side][near.index % SAMPLES]) return null;
    return railLatOf(near.sample, side ? 1 : -1);
  }
  // 벽 모양: 낮은 콘크리트 벽(0~0.9 m) + 위에 빛나는 띠 + 투명 펜스
  const wallMat = new THREE.MeshStandardMaterial({ color: '#4a4f5e', roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
  const wallTopMat = new THREE.MeshBasicMaterial({ color: '#2ff3ff', side: THREE.DoubleSide, toneMapped: false });
  const wallTopMat2 = new THREE.MeshBasicMaterial({ color: '#ff3bd4', side: THREE.DoubleSide, toneMapped: false });
  const fenceMat = new THREE.MeshBasicMaterial({ color: '#6fd8ff', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  const glitchRailMat = new THREE.MeshBasicMaterial({ color: '#ff2fd0', side: THREE.DoubleSide, toneMapped: false });
  const glitchRailMat2 = new THREE.MeshBasicMaterial({ color: '#38f0ff', side: THREE.DoubleSide, toneMapped: false });
  const hiddenWall = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const energyTex = canvasTexture(64, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, 'rgba(255,60,220,0.55)');
    gr.addColorStop(1, 'rgba(255,60,220,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,240,255,0.5)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 2);
  });
  const energyMat = new THREE.MeshBasicMaterial({ map: energyTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  // 저중력 구간 앞뒤 (높은 벽 0~1)
  const highWall = new Float32Array(SAMPLES);
  if (data.gravity) {
    const [a, b] = rangeI(data.gravity.t0, data.gravity.t1);
    const r = mS(20);
    for (let i = a - r; i <= b + r; i++) highWall[wrapI(i)] = smooth(a - r, a, i) * smooth(b + r, b, i);
  }
  function runsIn(list, flag) {
    const out = [];
    let c = -1;
    for (let k = 0; k < list.length; k++) {
      const f = flag(list[k]);
      if (f && c < 0) c = k;
      if (!f && c >= 0) out.push([c, k]), (c = -1);
    }
    if (c >= 0 && list.length - 1 > c) out.push([c, list.length - 1]);
    return out;
  }
  const railRuns = [];
  for (const [n, side] of [[0, -1], [1, 1]]) {
    for (const [a, b] of runsOf((i) => railSide[n][i] === 1)) {
      const L = spanList(a, b);
      const lat = (s) => side * railLatOf(s, side);
      const o = side * 0.35; // 벽 두께 (바깥쪽)
      const prof = (h0, h1, dl = 0) => (s) => (side < 0 ? [[lat(s) + dl, h1], [lat(s) + dl, h0]] : [[lat(s) + dl, h0], [lat(s) + dl, h1]]);
      // 도시: 콘크리트 벽 + 위 네온 띠 + 펜스. 글리치: 빛나는 레일 두 줄
      for (const g of [false, true]) {
        const segs = [];
        let c = -1;
        for (let k = 0; k < L.length; k++) {
          const f = !!L[k].glitch === g;
          if (f && c < 0) c = k;
          if (!f && c >= 0) segs.push([c, k]), (c = -1);
        }
        if (c >= 0 && L.length - 1 > c) segs.push([c, L.length - 1]);
        for (const [c0, c1] of segs) {
          const LL = L.slice(c0, c1 + 1);
          if (!g) {
            strip(LL, prof(0, 0.95), wallMat, { vScale: 6, world: 'city' });
            strip(LL, (s) => [[lat(s), 0.95], [lat(s) + o, 0.95]], wallMat, { vScale: 6, world: 'city' });
            strip(LL, prof(0.95, 1.1, o * 0.5), side < 0 ? wallTopMat : wallTopMat2, { vScale: 6, world: 'city' });
            strip(LL, prof(1.1, 2.6, o * 0.5), fenceMat, { vScale: 6, world: 'city' });
          } else {
            strip(LL, prof(0.75, 0.95), glitchRailMat, { vScale: 6, world: 'glitch' });
            strip(LL, prof(0.3, 0.42), glitchRailMat2, { vScale: 6, world: 'glitch' });
          }
        }
      }
      for (const m of strip(L, (s) => [[lat(s), -0.6], [lat(s), 1.5 + 8 * (highWall[s.i % SAMPLES] || 0)]], hiddenWall, { surface: 'barrier', world: 'hidden' })) m.visible = false;
      // 저중력 점프 구간: 높은 에너지 벽 (날아도 코스 밖으로 못 나감)
      for (const [c0, c1] of runsIn(L, (s) => highWall[s.i % SAMPLES] > 0.01)) strip(L.slice(c0, c1 + 1), prof(1.0, 9.5), energyMat, { vScale: 10, world: 'glitch' });
      railRuns.push({ side, a, b });
    }
  }

  // ---------------------------------------------------------------- neon2: 깜빡이는 조각 (물리용 판). 땅 메시 목록(groundMeshes)에는 안 넣음
  //   → castRay(아래)가 '지금 있는' 구간의 판만 따로 검사. 보이는 판·경고 빛은 neonHazards.js
  const flickPhys = [];
  if (GR) {
    const physMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const pc of flickPieces) {
      const z = pc.z, sd = z.side;
      // 조각: pe부터 벽까지 평평 (도로 높이 0, 경사 그대로)
      const prof = (s) => (sd > 0 ? [[z.pe, 0], [railLatOf(s, 1), 0]] : [[-railLatOf(s, -1), 0], [-z.pe, 0]]);
      for (const m of strip(pc.L, prof, physMat, { world: 'hidden' })) {
        m.visible = false;
        m.userData.surface = 'ground';
        m.updateMatrixWorld();
        m.geometry.computeBoundingSphere();
        flickPhys.push({ z, mesh: m });
      }
    }
  }
  /** 구간 z의 상태 (레이스 시계 clock): on = 판이 있음, warn = 곧 사라짐(빨갛게), appear = 곧 생김, u = 주기 안 시각, left = 지금 상태가 남은 초 */
  const flickClock = { t: 0 };
  function flickState(z, clock = flickClock.t) {
    const P = z.period, u = (((clock + z.phase) % P) + P) % P;
    const on = u < z.on;
    return { on, u, warn: on && u > z.on - (GR.warn ?? 0.55), appear: !on && u > P - (GR.appear ?? 0.35), left: on ? z.on - u : P - u };
  }

  // ---------------------------------------------------------------- 자석 튜브 (벽·천장 주행)
  const magTex = magnetTexture();
  magTex.repeat.set(1, 1);
  const magnetMat = new THREE.MeshStandardMaterial({ map: magTex, emissive: '#7a3cff', emissiveMap: magTex, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide });
  let tubeInfo = null;
  if (tube) {
    const R = tubeR, H = tubeH, w2 = TUBE_W2;
    const ARC = 7;
    // 벽: 연석 끝에서 둥글게 올라가 수직 (높이 H - R). taper 구간은 연석 끝(w2, 0)을 향해 작아짐
    const wallProf = (side) => (s) => {
      const k = tubeK[s.i] || 0;
      const tk = 0.04 + 0.96 * k;
      // 파이프 바깥 끝 = 방호벽 (2026-11-10): 파이프가 작을 때는 갓길 위로 밀어내 벽에 붙임 → 파이프 뒤에 빈 틈(차가 갇히던 곳)이 없음
      const w2s = Math.max(w2, railLatOf(s, side) - R * tk - 0.02);
      const pts = [];
      for (let j = 0; j <= ARC; j++) {
        const a = -Math.PI / 2 + (Math.PI / 2) * (j / ARC);
        pts.push([side * (w2s + R * Math.cos(a) * tk), (R + R * Math.sin(a)) * tk]);
      }
      pts.push([side * (w2s + R * tk), (H - R) * tk]);
      return side < 0 ? pts.reverse() : pts;
    };
    const [ta, tb] = rangeI(tube.t0, tube.t1);
    const tp = mS(tube.taper || 28);
    const full = spanList(ta - tp, tb + tp);
    for (const side of [-1, 1]) for (const m of strip(full, wallProf(side), magnetMat, { vScale: 6, uScale: 3, surface: 'magnet', chunk: 16 })) m.castShadow = false;
    // 천장: 위쪽 둥근 모서리 + 평평한 천장 (닫힌 튜브 구간만)
    const ceilProf = () => {
      const pts = [];
      for (let j = 0; j <= ARC; j++) {
        const a = (Math.PI / 2) * (j / ARC);
        pts.push([-(w2 + R * Math.cos(a)), H - R + R * Math.sin(a)]);
      }
      for (let j = ARC; j >= 0; j--) {
        const a = (Math.PI / 2) * (j / ARC);
        pts.push([w2 + R * Math.cos(a), H - R + R * Math.sin(a)]);
      }
      return pts;
    };
    const core = spanList(ta, tb);
    strip(core, ceilProf(), magnetMat, { vScale: 6, uScale: 3, surface: 'magnet', chunk: 16 });
    tubeInfo = { a: ta, b: tb, taper: tp, R, H, w2, core, full };
  }

  // ---------------------------------------------------------------- 점프대 (data.features type 'ramp': 저중력 언덕 꼭대기)
  const rampTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#12061f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff2fd0';
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      const y = (k * h) / 4;
      g.moveTo(w * 0.15, y + h * 0.2);
      g.lineTo(w * 0.5, y);
      g.lineTo(w * 0.85, y + h * 0.2);
      g.lineTo(w * 0.85, y + h * 0.12);
      g.lineTo(w * 0.5, y + h * -0.08);
      g.lineTo(w * 0.15, y + h * 0.12);
      g.fill();
    }
  });
  const rampMat = new THREE.MeshStandardMaterial({ map: rampTex, emissiveMap: rampTex, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.4, side: THREE.DoubleSide });
  const ramps = [];
  for (const f of data.features || []) {
    if (f.type !== 'ramp') continue;
    const s = sampleAt(f.t);
    const Wr = f.width || W, Lr = f.length || 14, Hr = f.height || 1.2;
    // 폭 = 벽에서 벽까지 (2026-11-10 턱 없애기): 예전엔 도로+연석 폭(21.4 m)이라 옆 갓길에 선 차 앞에 1 m 옆면 턱이 있었음
    //   로컬 x: + = 도로 왼쪽. 점프대 시작~끝 중 벽이 가장 좁은 곳에 맞춤 (벽을 뚫고 나가지 않게)
    const i0 = indexAt(f.t);
    let wl = Infinity, wr = Infinity;
    for (let k = -mS(Lr) - 1; k <= 1; k++) {
      const q = S(i0 + k);
      wl = Math.min(wl, railLatOf(q, -1));
      wr = Math.min(wr, railLatOf(q, 1));
    }
    const XL = Math.max(Wr / 2, wl - 0.08), XR = -Math.max(Wr / 2, wr - 0.08);
    const a = [XR, 0, 0], b = [XL, 0, 0], c = [XR, 0, Lr], d = [XL, 0, Lr], e = [XR, Hr, Lr], f2 = [XL, Hr, Lr];
    const tris = [a, e, f2, a, f2, b, c, d, f2, c, f2, e, a, c, e, b, f2, d];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
    const uv = [];
    for (const v of tris) uv.push((v[0] - XR) / 4, (v[2] + v[1]) / 4);
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.computeVertexNormals();
    const ramp = new THREE.Mesh(geo, rampMat);
    const zx = s.tan3.clone().normalize();
    const xx = new THREE.Vector3().crossVectors(s.up, zx).normalize();
    const yy = new THREE.Vector3().crossVectors(zx, xx).normalize();
    ramp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, yy, zx));
    ramp.position.copy(s.pos).addScaledVector(s.up, 0.03).addScaledVector(zx, -Lr);
    ramp.castShadow = ramp.receiveShadow = true;
    ramp.userData.world = s.glitch ? 'glitch' : 'city';
    ramp.updateMatrixWorld();
    addGround(ramp, 'ramp');
    ramps.push({ t: f.t, s, mesh: ramp });
  }

  // ---------------------------------------------------------------- 출발선
  const s0 = samples[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  line.material.map.repeat.set(W / 4, 1);
  {
    const x = new THREE.Vector3().crossVectors(s0.tan3, s0.up);
    line.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, s0.tan3, s0.up));
  }
  line.position.copy(s0.pos).addScaledVector(s0.up, 0.04);
  line.userData.world = 'city';
  group.add(line);
  // 출발 그리드 (8칸, 2열 지그재그): 출발선 뒤 8 m 간격
  {
    const gm = new THREE.MeshBasicMaterial({ color: '#f4f4f8', transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const P = [];
    for (let k = 0; k < 8; k++) {
      const d = 6 + k * 8;
      const s = S(-Math.round((d / length) * SAMPLES));
      const lat = (k % 2 ? 1 : -1) * 3.6;
      // ㄷ자 표시 (앞 가로줄 + 양옆 짧은 줄)
      for (const [l0, l1, f0, f1] of [[-1.3, 1.3, 0, 0.35], [-1.3, -1.0, -2.2, 0], [1.0, 1.3, -2.2, 0]]) {
        const a = surf(s, lat + l0, 0.05).addScaledVector(s.tan3, f0);
        const b = surf(s, lat + l1, 0.05).addScaledVector(s.tan3, f0);
        const c = surf(s, lat + l1, 0.05).addScaledVector(s.tan3, f1);
        const d2 = surf(s, lat + l0, 0.05).addScaledVector(s.tan3, f1);
        P.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z, d2.x, d2.y, d2.z, c.x, c.y, c.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const gmesh = new THREE.Mesh(geo, gm);
    gmesh.userData.world = 'city';
    group.add(gmesh);
  }

  // ---------------------------------------------------------------- 땅 (도시 바닥, 충돌용 큰 판)
  const bb = new THREE.Box2();
  for (const s of samples) bb.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
  const groundSize = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) + 1600;
  const center = bb.getCenter(new THREE.Vector2());
  {
    const geo = new THREE.PlaneGeometry(groundSize, groundSize).rotateX(-Math.PI / 2);
    const gnd = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    gnd.position.set(center.x, -0.06, center.y);
    gnd.visible = false;
    gnd.userData.world = 'hidden';
    addGround(gnd, 'ground');
  }

  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- 찾기, 충돌 (gpTrack.js와 같음)
  function nearest(pos) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const p = samples[i].pos;
      const dy = p.y - pos.y;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2 + 3 * dy * dy;
      if (d < best) (best = d), (bi = i);
    }
    const s = samples[bi];
    const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    const lateral = dx * s.right.x + dz * s.right.z;
    return { index: bi, t: bi / SAMPLES, sample: s, dist: Math.hypot(dx, dz), lateral };
  }
  function nearestRaw(p) {
    let best = Infinity;
    for (let i = 0; i < SAMPLES; i += 2) {
      const q = samples[i].pos;
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  const raycaster = new THREE.Raycaster();
  const tri = new THREE.Triangle();
  const bary = new THREE.Vector3();
  const local = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const origin2 = new THREE.Vector3();
  let lastSampled = null;
  function castRay(origin, dir, far) {
    // 차를 코스에 놓을 때(placeAt)는 높이 30에서 아래로 쏨 → 고가도로 아래/위를 헷갈리지 않게 고른 지점 바로 위에서 쏨
    if (origin.y === 30 && far === 60 && dir.y === -1 && lastSampled && Math.hypot(origin.x - lastSampled.pos.x, origin.z - lastSampled.pos.z) < 25) {
      origin = origin2.set(origin.x, lastSampled.pos.y + 6, origin.z);
      far = 40;
    }
    raycaster.set(origin, dir);
    raycaster.near = 0;
    raycaster.far = far;
    for (const hit of raycaster.intersectObjects(groundMeshes, false)) {
      if (hit.distance < 1e-4) continue;
      const obj = hit.object;
      const nAttr = obj.geometry.attributes.normal;
      local.copy(hit.point);
      obj.worldToLocal(local);
      const { a, b, c } = hit.face;
      tri.setFromAttributeAndIndices(obj.geometry.attributes.position, a, b, c);
      tri.getBarycoord(local, bary);
      const n = new THREE.Vector3().fromBufferAttribute(nAttr, a).multiplyScalar(bary.x);
      n.add(tmp.fromBufferAttribute(nAttr, b).multiplyScalar(bary.y));
      n.add(tmp.fromBufferAttribute(nAttr, c).multiplyScalar(bary.z));
      if (n.lengthSq() < 1e-8) n.copy(hit.face.normal);
      normalMatrix.getNormalMatrix(obj.matrixWorld);
      n.applyMatrix3(normalMatrix).normalize();
      if (n.dot(dir) > 0) n.negate();
      return { point: hit.point, normal: n, surface: obj.userData.surface, distance: hit.distance };
    }
    return null;
  }
  // neon2: 지금 있는 깜빡이는 조각도 땅으로 (판마다 경계 구 검사 → 멀면 바로 넘어감)
  const flickRay = new THREE.Raycaster();
  const _fo = new THREE.Vector3();
  const _po = new THREE.Vector3();
  function withFlick(origin, dir, far, base) {
    if (!flickPhys.length) return base;
    // 차를 코스에 놓는 레이(높이 30에서 60 m)는 castRay가 고른 지점 6 m 위에서 쏘게 바꿈 → 같은 출발점으로 재야 거리 비교가 맞음
    if (origin.y === 30 && far === 60 && dir.y === -1 && lastSampled && Math.hypot(origin.x - lastSampled.pos.x, origin.z - lastSampled.pos.z) < 25) {
      origin = _po.set(origin.x, lastSampled.pos.y + 6, origin.z);
      far = 40;
    }
    let best = base, bestD = base ? base.distance : far;
    for (const f of flickPhys) {
      const bs = f.mesh.geometry.boundingSphere;
      // 레이 선분과 경계 구가 먼지 빠르게
      _fo.copy(bs.center).sub(origin);
      const along = THREE.MathUtils.clamp(_fo.dot(dir), 0, bestD);
      if (_fo.addScaledVector(dir, -along).lengthSq() > bs.radius * bs.radius) continue;
      if (!flickState(f.z).on) continue;
      flickRay.set(origin, dir);
      flickRay.near = 0;
      flickRay.far = bestD;
      const hit = flickRay.intersectObject(f.mesh, false)[0];
      if (!hit || hit.distance < 1e-4 || hit.distance >= bestD) continue;
      const n = hit.face.normal.clone();
      if (n.dot(dir) > 0) n.negate();
      best = { point: hit.point, normal: n, surface: 'ground', distance: hit.distance, flick: f.z.id };
      bestD = hit.distance;
    }
    return best;
  }
  const boostPadAt = () => null; // 부스트 패드 없음 (E 부스터만)
  function isOnRoad(pos, near = nearest(pos)) {
    return near.dist < HW + kerbAt(near.index, near.lateral < 0 ? -1 : 1);
  }
  /** 연석·갓길 걸침 (도시는 갓길이 모두 포장 → runoff) */
  function edgeInfo(pos, near = nearest(pos)) {
    const k = kerbAt(near.index, near.lateral < 0 ? -1 : 1);
    return { ...edgeFraction(near.dist, HW, HW + k), runoff: true };
  }
  /** 중력 배수: 저중력 언덕 위 (도로 근처) */
  const grav = data.gravity || null;
  function gravityAt(pos) {
    if (!grav) return 1;
    // car.trackInfo를 다시 계산하지 않도록 가까운 샘플만 빠르게: 언덕 구간 샘플 중 가장 가까운 것
    let bd = Infinity;
    for (const s of gravSamples) {
      const d = (s.pos.x - pos.x) ** 2 + (s.pos.z - pos.z) ** 2;
      if (d < bd) bd = d;
    }
    return bd < (DECK + 6) ** 2 ? grav.scale : 1;
  }
  const gravSamples = [];
  if (grav) {
    const [a, b] = rangeI(grav.t0, grav.t1);
    for (let i = a; i <= b; i += 3) gravSamples.push(S(i));
  }

  const outline = samples.filter((_, i) => i % 6 === 0 && i < SAMPLES).map((s) => [s.pos.x, s.pos.z]);

  function animate(time) {
    magTex.offset.y = -time * 0.6;
    magnetMat.emissiveIntensity = 0.6 + Math.sin(time * 3) * 0.15;
    glitchRoadTex.offset.y = -time * 0.25;
  }
  const sampleAtTracked = (t) => (lastSampled = sampleAt(t));

  // ---------------------------------------------------------------- 세계 전환 (도시 ↔ 글리치)
  const worldObjs = group.children.filter((o) => o.userData.world === 'city' || o.userData.world === 'glitch');
  let curWorld = false;
  function setWorld(glitch) {
    glitch = !!glitch;
    if (glitch === curWorld) return;
    curWorld = glitch;
    for (const o of worldObjs) o.visible = (o.userData.world === 'glitch') === glitch;
  }
  for (const o of worldObjs) o.visible = o.userData.world !== 'glitch';
  const dimension = dim ? { ...dim, inSpaceT: inGlitchT, inGlitchT, portalA: sampleAt(dim.t0), portalB: sampleAt(dim.t1) } : null;
  const buildMs = Math.round(performance.now() - buildT0);

  // neon2: 봇(bots.js saturBrake)이 보는 가장자리 종류. 깜빡이는 쪽 = 낭떠러지, 나머지는 벽
  const EDGE = { open: 0, cliff: 1, wall: 2, rail: 3, lava: 4 };
  const edgeAt = (i, side) => {
    const z = zoneAt(i);
    return z && z.side === side ? EDGE.cliff : EDGE.rail;
  };
  const flicker = GR
    ? { cfg: GR, zones: flickZones, zoneAt, zoneOf, state: flickState, clock: flickClock, pieces: flickPieces, phys: flickPhys, lineLimitBase: lineLimit, lineLimit: lineLimitF }
    : null;
  const api = {
    data, width: W, length, samples, sampleAt: sampleAtTracked, nearest, nearestRaw, boostPadAt, animate, outline,
    shortcut: null, shortcutDist: () => Infinity, onShortcut: () => false, isOnRoad, edgeInfo, racingLine, lineY, kerbWidth: CURB, kerbAt, group, groundMeshes,
    arena: false, pad: null, inPad: () => false, spawn: null,
    sea: null, inSea: () => false, waterRanges: [], isWaterT: () => false, buoys: [],
    // gpCorners.js(브레이크 판·코너 번호)가 쓰는 것: grandprix = true 이면 main.js가 만들어 줌
    grandprix: true, neon: true, surf, roadYAt, heightAt: () => 0, fieldAt: () => 10, islands: [], loops: [], bridgeRuns: [], railRuns, railSide, railLimit, railLatOf, deckHalf: DECK, curb: CURB,
    runway: null, apron: null, plank: null, rings: [], skyPath: [], inSkyCorridor: () => false, onAltPath: () => false, altPaths: [], indexAt, S, spanList, runsOf,
    dimension, setWorld, get inSpace() { return curWorld; }, get inGlitch() { return curWorld; }, buildMs, sampleCount: SAMPLES,
    // 갓길로 나갈 때 튀는 조각 색(초록 잔디 대신 젖은 아스팔트 + 네온 조각), 에이펙스 불빛 기둥 색(주황 대신 네온 하늘색)
    offroadColors: ['#2b2836', '#3b3648', '#1d1b26', '#ff2f8e'], apexColor: '#2ff3ff',
    gravityAt, ramps, highWall, tube: tubeInfo, tubeK, tubeCore, groundCenter: center, groundSize, bbox: bb,
    neon2: NEON2, flicker, tubeBelt: BELT && tubeInfo ? { ...BELT, tube: tubeInfo } : null,
  };
  if (flicker) Object.assign(api, { EDGE, edgeAt });
  if (!flicker) {
    api.castRay = castRay;
    return api;
  }
  // castRay: 봇·플레이어용 빠른 레이(fastTrack.js)는 Object.create(api) 위에 castRay를 새로 넣음 (seaTrack.js와 같은 방법)
  //   → 받는 쪽(setter)에서 그 함수 뒤에 '지금 있는 깜빡이는 조각' 검사를 붙여 바꿔 끼움. 원래 트랙 레이도 같은 검사
  const castRayF = (o, d, f) => withFlick(o, d, f, castRay(o, d, f));
  Object.defineProperty(api, 'castRay', {
    enumerable: true,
    configurable: true,
    get() {
      return (this !== api && this.__flickRay) || castRayF;
    },
    set(fn) {
      if (this === api) return;
      const self = this;
      const ray = (o, d, f) => withFlick(o, d, f, fn.call(self, o, d, f));
      Object.defineProperty(this, '__flickRay', { value: ray, writable: true, configurable: true });
    },
  });
  return api;
}
