import { gfxEnabled } from './gfxConfig.js';
import { smoothVisualGeometry, landscapeMaterial } from './gfxTerrain.js';
import { gfxSurface } from './gfxTextures.js';
// 변신 연습장 코스 (data/starter.json, "module": "starterMap") — 처음 온 사람의 첫 레이스, 2바퀴 · 한 바퀴 약 40초
//
// 빙하 하이웨이(glacierTrack.js)를 바탕으로, 한 바퀴에 이 게임의 변신을 다 맛보게 세 가지를 더함
//   - 물길 (water [[t0, t1]]): 이 구간 중심선 높이 0 = 도로 대신 석호 물. 양 끝은 선착장(물속으로 비스듬히 내려가는 콘크리트)
//       물 면은 진짜 메시(surface 'water') → car.js가 닿으면 자동으로 배 모드 (바닷가 seaTrack과 같은 규칙, fastTrack도 그대로)
//       석호 = 물길 둘레 channel m + 곡선 바깥 큰 만(bay). 바닥은 모래 (밖으로 나가도 그냥 물 = 느려지지 않음)
//   - 비행 루트 (sky): 그랑프리(gpTrack.js)와 같은 형식·같은 API (runway·apron·rings·skyPath·thermals·thermalAt·inSkyCorridor·onAltPath)
//       → car.js 자동 비행 모드·비행 구역, bots.js flightPlan(봇도 날아감), gpFlight.js(상승 기류·착지계)가 그대로 동작
//       활주로는 땅길 S자가 시작되는 곳에서 왼쪽으로 살짝 틀어 곧게 뻗음 = 핸들을 그대로 두면 활주로 → 날아감, 오른쪽으로 꺾으면 땅길
//   - 점프대: 발사대 끝을 낮은 착지판과 분리, 아래 겹친 안전 바닥으로 모든 속도를 받음
// 돌려주는 객체는 glacierTrack.js와 같은 모양 (car.js, main.js, hud 미니맵, racingLineFx, gpCorners, 봇이 그대로 씀)
import * as THREE from 'three';
import { computeRacingLine, edgeFraction } from './racingLine.js';
import { canvasTexture, seededRandom, makeNoise } from './moonTrack.js';

export { canvasTexture, seededRandom, makeNoise };

const UP = new THREE.Vector3(0, 1, 0);
const SAMPLE_STEP = 1.9; // 중심선 샘플 간격 (m)
const CELL = 5; // 가까운 지형 격자 한 칸 (m)
const CHUNK = 24; // 지형 메시 덩어리 = 24×24칸
// fly2 상승 기류 자동 배치 (gpTrack.js와 같은 값): 활주로 끝→착륙 곧은 선의 u 구간, 고리 쪽으로 떨어진 거리(m), 반지름(m), 가장 높은 고리보다 몇 m 위까지
const THERMAL_U = [0.2, 0.46], THERMAL_OFF = 20, THERMAL_R = 13, THERMAL_TOP = 26;
const smooth = (a, b, x) => {
  const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
export const EDGE = { open: 0, cliff: 1, wall: 2, rail: 3, lava: 4 };

// ---------------------------------------------------------------- 텍스처
function roadTexture() {
  // 밝은 낮 아스팔트 + 흰 가장자리 선 + 노란 가운데 점선
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3d4149';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2800; i++) {
      const v = 52 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v + 2},${v + 6},0.38)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(14,16,20,0.16)';
    for (const x of [0.3, 0.36, 0.64, 0.7]) g.fillRect(w * x, 0, w * 0.035, h);
    g.fillStyle = '#f4f4f0';
    g.fillRect(w * 0.025, 0, w * 0.02, h);
    g.fillRect(w * 0.955, 0, w * 0.02, h);
    g.fillStyle = '#f2c94a';
    g.fillRect(w * 0.492, 0, w * 0.016, h * 0.45);
  });
}
function curbTexture(a, b) {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = b;
    g.fillRect(0, h / 2, w, h / 2);
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(0, 0, w, 3);
  });
}
function checkerTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4';
        g.fillRect((i * w) / 4, (j * h) / 4, w / 4, h / 4);
      }
  });
}
function runwayTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3b3f48';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      const v = 52 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v},${v + 6},0.35)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = '#f4f4f4';
    g.fillRect(w * 0.04, 0, w * 0.03, h);
    g.fillRect(w * 0.93, 0, w * 0.03, h);
    g.fillRect(w * 0.485, 0, w * 0.03, h * 0.45);
    g.fillStyle = '#5ad1ff';
    g.beginPath();
    g.moveTo(w * 0.3, h * 0.95);
    g.lineTo(w * 0.5, h * 0.62);
    g.lineTo(w * 0.7, h * 0.95);
    g.lineTo(w * 0.6, h * 0.95);
    g.lineTo(w * 0.5, h * 0.78);
    g.lineTo(w * 0.4, h * 0.95);
    g.fill();
  });
}
function apronTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#8d939c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 120 + Math.random() * 40;
      g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(60,62,68,0.5)';
    g.fillRect(0, 0, w, 3);
    g.fillRect(0, 0, 3, h);
    g.fillStyle = '#ffcf3f';
    g.fillRect(w * 0.47, h * 0.1, w * 0.06, h * 0.8);
    g.fillRect(w * 0.2, h * 0.47, w * 0.6, h * 0.06);
  });
}
function hazardTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d2026';
    for (let k = -2; k < 4; k++) {
      g.beginPath();
      g.moveTo(k * 22, h);
      g.lineTo(k * 22 + 11, h);
      g.lineTo(k * 22 + 11 + h, 0);
      g.lineTo(k * 22 + h, 0);
      g.fill();
    }
  });
}
function slipTexture() {
  // 선착장 콘크리트: 밝은 회색 + 가로 홈 + 노란 경고 띠
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#a7adb3';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 140 + Math.random() * 50;
      g.fillStyle = `rgba(${v},${v},${v},0.4)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(70,74,80,0.55)';
    for (let k = 0; k < 8; k++) g.fillRect(0, (k * h) / 8, w, 2);
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, w * 0.05, h);
    g.fillRect(w * 0.95, 0, w * 0.05, h);
  });
}
/** 물 잔물결 노멀맵 (캔버스로 만든 높이 → 노멀) */
function waterNormalTexture(seed) {
  const N = 128;
  const r = seededRandom(seed);
  const hgt = new Float32Array(N * N);
  const waves = [];
  for (let k = 0; k < 9; k++) waves.push([1 + Math.floor(r() * 4), Math.floor(r() * 5) - 2, r() * 6.28, 0.4 + r() * 0.6]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const [a, b, ph, amp] of waves) v += amp * Math.sin(((a * x + b * y) / N) * Math.PI * 2 + ph);
      hgt[y * N + x] = v;
    }
  return canvasTexture(N, N, (g) => {
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x + N - 1) % N)];
        const dy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
        const nx = -dx * 0.35, ny = -dy * 0.35, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const o = (y * N + x) * 4;
        img.data[o] = (nx / l * 0.5 + 0.5) * 255;
        img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
        img.data[o + 2] = (nz / l * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  });
}

export function buildStarterTrack(data, scene) {
  const buildT0 = performance.now();
  const W = data.width;
  const HW = W / 2; // 기본 반폭 (track.width/2)
  const CURB = 1.4;
  const noise = makeNoise(20261115);
  const group = new THREE.Group();
  group.name = 'starterTrack';
  scene.add(group);
  const LG = data.lagoon || {};
  const WL = LG.level ?? 0; // 물 높이

  // ---------------------------------------------------------------- 중심선 샘플
  const curve = new THREE.CatmullRomCurve3(data.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, data.points.length * 40);
  const length = curve.getLength();
  const SAMPLES = Math.max(900, Math.round(length / SAMPLE_STEP));
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pos = curve.getPointAt(t % 1);
    const tan3 = curve.getTangentAt(t % 1);
    const tan = tan3.clone().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
    // space: false → gpCorners가 땅 위에 흰 표시판을 세움
    samples.push({ t, i, pos, tan, tan3, right, dist: t * length, bank: 0, gap: false, roll: false, magnet: false, space: false, bridge: null, land: true, water: false, hw: HW });
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
  const mS = (m) => Math.max(1, Math.round((m / length) * SAMPLES));
  const ds = length / SAMPLES;

  // ---------------------------------------------------------------- 물길: 높이 0, 도로 대신 물 (bank 없음)
  for (const [t0, t1] of data.water || []) {
    const [a, b] = rangeI(t0, t1);
    for (let i = a; i <= b; i++) {
      const s = S(i);
      s.pos.y = WL;
      s.tan3.y = 0;
      s.tan3.normalize();
      s.water = true;
      s.land = false;
    }
  }

  // ---------------------------------------------------------------- 구간 도로 폭 (30 m에 걸쳐 부드럽게)
  {
    const raw = new Float32Array(SAMPLES).fill(HW);
    for (const [t0, t1, hw] of data.halfWidths || []) {
      const [a, b] = rangeI(t0, t1);
      for (let i = a; i <= b; i++) raw[wrapI(i)] = hw;
    }
    const r = mS(15);
    for (let i = 0; i < SAMPLES; i++) {
      let sum = 0;
      for (let j = -r; j <= r; j++) sum += raw[wrapI(i + j)];
      samples[i].hw = sum / (2 * r + 1);
    }
  }
  const hwAt = (i) => samples[wrapI(i)].hw;

  // ---------------------------------------------------------------- 길 가장자리 종류 (왼쪽 [0], 오른쪽 [1])
  const edgeT = [new Uint8Array(SAMPLES), new Uint8Array(SAMPLES)];
  for (const [t0, t1, side, kind] of data.edges || []) {
    const [a, b] = rangeI(t0, t1);
    const code = EDGE[kind] ?? 0;
    for (let i = a; i <= b; i++) for (const n of side < 0 ? [0] : side > 0 ? [1] : [0, 1]) edgeT[n][wrapI(i)] = code;
  }
  const sideN = (side) => (side < 0 ? 0 : 1);
  const edgeAt = (i, side) => edgeT[sideN(side)][wrapI(i)];

  // ---------------------------------------------------------------- 안전 점프대: 발사대 끝과 낮은 착지판 분리 + 아래 겹친 안전 바닥
  const jumps = (data.jumps || []).map((j) => {
    const lipI = indexAt(j.lip);
    let landI = indexAt(j.land);
    if (landI < lipI) landI += SAMPLES;
    const kickN = mS(j.kickLen || 28), dropN = mS(j.dropLen || 65);
    const L = kickN * ds, lift = j.lift ?? 2.6;
    const baseY = S(lipI).pos.y;
    const want = Math.tan(THREE.MathUtils.degToRad(j.kick ?? 12));
    const base0 = (S(lipI + 1).pos.y - S(lipI - 1).pos.y) / (2 * ds);
    const p = Math.max(1.2, ((want - base0) * L) / lift);
    for (let k = 0; k <= kickN; k++) S(lipI - kickN + k).pos.y += lift * Math.pow(k / kickN, p);
    // 바닥 레이가 닿으면 차는 내리막에 붙는다. 발사대 끝을 낮은 착지판과 분리한다.
    // 립 아래까지 겹치는 안전 바닥이 느린 차도 받으며, 착지판은 원래 길에 매끈하게 합류한다.
    for (let k = 1; k <= dropN; k++) {
      const u = k / dropN;
      S(lipI + k).pos.y -= (j.floorDrop ?? 0.4) * (1 - u) ** 2;
      S(lipI + k).jumpFace = true;
    }
    S(lipI + 1).jumpDrop = true;
    for (let k = -kickN - 3; k <= dropN + 3; k++) {
      const s = S(lipI + k);
      const prev = k === 1 ? s.pos : S(lipI + k - 1).pos;
      const next = k === 0 ? s.pos : S(lipI + k + 1).pos;
      s.tan3 = next.clone().sub(prev).normalize();
      s.jump = true;
    }
    S(lipI).jumpFloorY = baseY - (j.floorDrop ?? 0.4);
    return { ...j, lipI: wrapI(lipI), landI: wrapI(landI), lip: S(lipI), landS: S(landI), gapLen: 0, lipY: S(lipI).pos.y, landY: S(landI).pos.y, kickN, botSpeed: j.botSpeed || 46 };
  });

  // ---------------------------------------------------------------- 뱅크 (구간 전체가 한 방향으로만 기울어짐)
  const heading = (s) => Math.atan2(s.tan.x, s.tan.z);
  const turnSign = samples.map((s, i) => {
    let d = heading(S(i + 10)) - heading(S(i - 10));
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
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
      if (S(i).water) continue;
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
  samples[SAMPLES] = { ...samples[0], t: 1, dist: length };
  /** 도로 면 위의 점 (옆 l, 위 h) */
  const surf = (s, l, h = 0, out = new THREE.Vector3()) => out.copy(s.pos).addScaledVector(s.rightB, l).addScaledVector(s.up, h);
  /** 수평 옆 위치 l에서의 도로 높이 */
  const roadYAt = (s, l) => s.pos.y + l * Math.tan(s.bank);

  // 밟을 수 있는 면들
  const groundMeshes = [];
  const addGround = (mesh, surface) => {
    mesh.userData.surface = surface;
    groundMeshes.push(mesh);
    group.add(mesh);
    return mesh;
  };

  /** 샘플 목록을 따라 단면(profile)을 밀어 만든 메시들 */
  function strip(list, profile, mat, { vScale = 8, chunk = 40, uScale = null, surface = null, shadow = false, parent = null, name = null } = {}) {
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
          if (r < rows - 1 && k < P - 1 && !list[a + r + 1].jumpDrop) {
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
      if (name) m.name = name;
      if (surface) addGround(m, surface);
      else (parent || group).add(m);
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
  const waterRuns = runsOf((i) => samples[i].water);

  // ---------------------------------------------------------------- 레이싱 라인과 넓은 연석
  const KERB_WIDE = 2.6;
  const LINE_MARGIN = 1.15;
  const LINE_PLAIN = 1.0;
  const kerbW = [new Float32Array(SAMPLES).fill(CURB), new Float32Array(SAMPLES).fill(CURB)];
  const kerbAt = (i, side) => (samples[wrapI(i)].water ? 0 : kerbW[sideN(side)][wrapI(i)]);
  const lineSamples = samples.slice(0, SAMPLES);
  const lineUse = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
  const lineLimit = (i, side) => {
    const q = wrapI(i);
    // 물길: 부표 줄 안쪽 1.5 m까지 (연석 없음)
    if (samples[q].water) return samples[q].hw - 1.5;
    const u = lineUse[sideN(side)][q];
    const rail = edgeT[sideN(side)][q] === EDGE.rail ? 0.4 : 0;
    return samples[q].hw - LINE_PLAIN - rail + u * Math.max(0, kerbAt(q, side) - LINE_MARGIN + LINE_PLAIN);
  };
  const noWide = (i) => samples[i].water || samples[i].jump;
  const widen = (i0, i1, side, ramp) => {
    for (let i = i0; i <= i1; i++) {
      const q = wrapI(i);
      const w = smooth(0, ramp, i - i0) * smooth(0, ramp, i1 - i);
      const u = lineUse[sideN(side)];
      u[q] = Math.max(u[q], w);
      if (noWide(q)) continue;
      const arr = kerbW[sideN(side)];
      arr[q] = Math.max(arr[q], CURB + (KERB_WIDE - CURB) * w);
    }
  };
  const halfSamples = lineSamples.filter((_, i) => i % 2 === 0);
  const halfWater = halfSamples.map((s) => !!s.water);
  const prelimApexes = () => computeRacingLine(halfSamples, (i, side) => lineLimit(i * 2, side), length, { iterScale: 0.7, water: halfWater }).apexes.map((a) => ({ ...a, i: a.i * 2 }));
  let apexes0 = prelimApexes();
  for (let pass = 0; pass < 2; pass++) {
    for (const ap of apexes0) {
      if (ap.radius > 600 || S(ap.i).water) continue;
      const big = ap.radius > 150;
      const pre = big ? Math.min(120, ap.radius * 0.3) : 30, post = big ? Math.min(100, ap.radius * 0.22) : 22;
      widen(ap.i - mS(pre), ap.i + mS(post), ap.side, mS(big ? 25 : 10));
      widen(ap.i + mS(12), ap.i + mS(big ? post + 60 : 62), -ap.side, mS(14));
    }
    if (pass === 0) apexes0 = prelimApexes();
  }
  const lineOpts = { bank: lineSamples.map((s) => s.bank || 0), water: lineSamples.map((s) => !!s.water) };
  const racingLine = computeRacingLine(lineSamples, lineLimit, length, lineOpts);
  const lineY = (i, d = 0) => roadYAt(samples[i], racingLine.offset[i] + d);

  // ---------------------------------------------------------------- 도로, 연석, 선착장
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.82, metalness: 0.02 });
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture('#f4f4f4', '#e8463a'), roughness: 0.7 });
  const landRun = (i) => !samples[i].water;
  for (const [a, b] of runsOf(landRun)) strip(spanList(a, b), (s) => [[-s.hw, 0], [s.hw, 0]], roadMat, { vScale: 12, surface: 'ground' });
  for (const j of jumps) {
    const floor = spanList(j.lipI - 3, j.lipI + 1).map((s) => ({ ...s, pos: s.pos.clone().setY(j.lip.jumpFloorY), up: UP, jumpDrop: false }));
    strip(floor, (s) => [[-s.hw - 5, 0], [s.hw + 5, 0]], roadMat, { vScale: 12, surface: 'ground', name: 'starterJumpSafety' });
  }
  for (const side of [-1, 1]) {
    for (const [a, b] of runsOf(landRun)) {
      const L = spanList(a, b);
      const prof = side < 0 ? (s) => [[-s.hw - kerbAt(s.i, -1), 0.02], [-s.hw, 0.02]] : (s) => [[s.hw, 0.02], [s.hw + kerbAt(s.i, 1), 0.02]];
      strip(L, prof, curbMat, { vScale: 4, surface: 'ground' });
    }
  }
  const edgeLat = (s, side) => s.hw + kerbAt(s.i, side);
  // 선착장: 물길 양 끝에서 도로가 물속으로 비스듬히 내려감 (물 높이 아래로 1.7 m, 바닷가와 같은 방법)
  const slipMat = new THREE.MeshStandardMaterial({ map: slipTexture(), roughness: 0.92 });
  const slipways = [];
  for (const [a, b] of waterRuns) {
    for (const [from, dir] of [[a, 1], [b - 1, -1]]) {
      const L = [];
      for (let k = 0; k <= 12; k++) {
        const s = S(from + dir * k);
        if (!s.water) break;
        L.push({ ...s, pos: s.pos.clone().setY(WL - 0.14 * (k + 1)), rightB: s.right, up: UP, bank: 0, dist: s.dist + (from + dir * k >= SAMPLES ? length : 0) });
      }
      const land = S(from - dir);
      L.unshift({ ...land, rightB: land.rightB, up: land.up });
      const list = dir > 0 ? L : L.reverse();
      strip(list, (s) => [[-s.hw - 1.6, 0], [s.hw + 1.6, 0]], slipMat, { vScale: 6, surface: 'ground' });
      slipways.push({ land: S(from - dir), water: S(from + dir * 6), dir });
    }
  }

  // ---------------------------------------------------------------- 막힌 가장자리 (가드레일): car.keepInsideRail이 씀
  const railSide = [new Uint8Array(SAMPLES), new Uint8Array(SAMPLES)];
  for (let n = 0; n < 2; n++) for (let i = 0; i < SAMPLES; i++) if (edgeT[n][i] === EDGE.rail && !samples[i].water) railSide[n][i] = 1;
  const railLatAt = (s, side) => s.hw + kerbAt(s.i, side) + 0.6;
  function railLimit(near) {
    const side = near.lateral < 0 ? 0 : 1;
    if (!railSide[side][near.index]) return null;
    return railLatAt(near.sample, side ? 1 : -1);
  }
  const wallMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const railMat = new THREE.MeshStandardMaterial({ color: '#e9edf2', metalness: 0.55, roughness: 0.35, side: THREE.DoubleSide });
  const railBandMat = new THREE.MeshStandardMaterial({ color: '#e8463a', roughness: 0.5, side: THREE.DoubleSide });
  const posts = [];
  const railRuns = [];
  for (const [n, side] of [[0, -1], [1, 1]]) {
    for (const [a, b] of runsOf((i) => railSide[n][i] === 1)) {
      const L = spanList(a, b);
      const lat = (s) => side * railLatAt(s, side);
      for (const m of strip(L, (s) => [[lat(s), -0.6], [lat(s), 1.6]], wallMat, { surface: 'barrier' })) m.visible = false;
      // 타이어 벽 느낌: 흰 레일 + 빨간 띠 (처음 하는 사람에게 '여기는 벽' 이 잘 보이게)
      strip(L, (s) => [[lat(s), 0.62], [lat(s), 1.0]], railMat, { vScale: 4 });
      strip(L, (s) => [[lat(s), 0.3], [lat(s), 0.6]], railBandMat, { vScale: 4 });
      const stepN = mS(3.2);
      for (let k = 0; k < L.length; k += stepN) {
        const s = L[k];
        const p = surf(s, lat(s) + side * 0.12, 0);
        posts.push({ x: p.x, y: p.y, z: p.z, ry: Math.atan2(s.tan.x, s.tan.z) });
      }
      railRuns.push({ side, a, b, wall: false });
    }
  }
  if (posts.length) {
    const postIm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.15, 0.16).translate(0, 0.52, 0), new THREE.MeshStandardMaterial({ color: '#7d8590', metalness: 0.5, roughness: 0.5 }), posts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    posts.forEach((p, i) => {
      q.setFromAxisAngle(UP, p.ry);
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
      postIm.setMatrixAt(i, m4);
    });
    postIm.castShadow = true;
    group.add(postIm);
  }

  // ---------------------------------------------------------------- 비행 루트 (gpTrack.js와 같은 방법·같은 이름)
  const altPaths = []; // { samples, half } 도로로 인정하는 길 (활주로, 착륙장)
  const flatZones = []; // 지형을 평평하게 할 곳
  const sky = data.sky || null;
  let runway = null, apron = null, skyPath = [], rings = [];
  const lineList = (p0, dir, len, yFn, step = 1) => {
    const tan = dir.clone().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
    const out = [];
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const d = (k / n) * len;
      const pos = p0.clone().addScaledVector(tan, d);
      pos.y = yFn(d);
      out.push({ pos, tan, right, dist: d, rightB: right, up: UP, tan3: tan, bank: 0 });
    }
    return out;
  };
  if (sky && sky.runway) {
    const rw = sky.runway;
    const s0 = sampleAt(rw.t);
    const lip = 14;
    // angle: 도로 방향에서 왼쪽으로 몇 도 틀어 뻗을지
    const rwDir = s0.tan.clone().applyAxisAngle(UP, ((rw.angle || 0) * Math.PI) / 180);
    const L = lineList(s0.pos, rwDir, rw.length, (d) => s0.pos.y + (d > rw.length - lip ? rw.lift * ((d - (rw.length - lip)) / lip) ** 2 : 0));
    runway = { samples: L, half: rw.width / 2, start: s0, end: L[L.length - 1] };
    altPaths.push(runway);
    flatZones.push({ samples: L, half: rw.width / 2 });
  }
  if (sky && sky.apron) {
    const ap = sky.apron;
    const [a, b] = rangeI(ap.t0, ap.t1);
    const list = spanList(a, b);
    const taper = Math.round((30 / length) * SAMPLES);
    const widthAt = (k) => ap.width * smooth(0, taper, k) * smooth(0, taper, list.length - 1 - k);
    const pts = list.map((s, k) => {
      const w = widthAt(k);
      const c = ap.side * (s.hw + CURB + w / 2);
      return { pos: surf(s, c, 0, new THREE.Vector3()), tan: s.tan, right: s.right, dist: s.dist, w };
    });
    apron = { list, side: ap.side, widthAt, samples: pts, half: ap.width / 2 };
    altPaths.push({ samples: pts.filter((p) => p.w > 2), half: ap.width / 2 });
    flatZones.push({ samples: pts.filter((p) => p.w > 1), half: ap.width / 2 + 2 });
  }
  if (sky && sky.rings) {
    const R = sky.ringRadius || 7;
    const ptsR = sky.rings.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const lipP = runway ? runway.end.pos.clone() : ptsR[0];
    const landP = apron ? apron.samples[Math.floor(apron.samples.length * 0.68)].pos.clone() : ptsR[ptsR.length - 1];
    skyPath = [lipP, ...ptsR, landP];
    rings = ptsR.map((p, k) => {
      const prev = skyPath[k], next = skyPath[k + 2];
      const dir = next.clone().sub(prev).normalize();
      return { pos: p, dir, r: R, index: k };
    });
  }
  // fly2 상승 기류 (gpTrack.js와 같음): 비행 루트에서 자동으로 고리 줄 바깥쪽에 바람 기둥 하나
  const thermals = [];
  if (sky && skyPath.length >= 3 && !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fly2') === '0')) {
    if (Array.isArray(sky.thermals)) {
      for (const [x1, z1, x2, z2, r, top] of sky.thermals) thermals.push({ ax: x1, az: z1, bx: x2, bz: z2, r, y1: top });
    } else {
      const a = skyPath[0], b = skyPath[skyPath.length - 1];
      const cx = b.x - a.x, cz = b.z - a.z, cl = Math.hypot(cx, cz) || 1;
      const nx = -cz / cl, nz = cx / cl;
      let side = 0;
      for (let k = 1; k < skyPath.length - 1; k++) side += (skyPath[k].x - a.x) * nx + (skyPath[k].z - a.z) * nz;
      side = Math.sign(side) || 1;
      const at = (u, off) => [a.x + cx * u + nx * side * off, a.z + cz * u + nz * side * off];
      const [x1, z1] = at(THERMAL_U[0], THERMAL_OFF), [x2, z2] = at(THERMAL_U[1], THERMAL_OFF);
      const topY = Math.max(...skyPath.map((p) => p.y)) + THERMAL_TOP;
      thermals.push({ ax: x1, az: z1, bx: x2, bz: z2, r: THERMAL_R, y1: topY });
    }
  }
  function thermalAt(p) {
    let best = 0;
    for (const T of thermals) {
      const abx = T.bx - T.ax, abz = T.bz - T.az;
      const u = THREE.MathUtils.clamp(((p.x - T.ax) * abx + (p.z - T.az) * abz) / (abx * abx + abz * abz || 1), 0, 1);
      const d = Math.hypot(p.x - (T.ax + abx * u), p.z - (T.az + abz * u));
      if (d >= T.r || p.y >= T.y1) continue;
      const k = (1 - smooth(T.r * 0.45, T.r, d)) * (1 - smooth(T.y1 - 14, T.y1, p.y));
      if (k > best) best = k;
    }
    return best;
  }
  /** 비행 루트 아래 (활주로 끝 → 착륙 지점 선분들) 수평 거리와 진행 비율 0~1 */
  function skyLineDist(x, z) {
    let best = Infinity, bu = 0, acc = 0, tot = 0;
    for (let k = 0; k < skyPath.length - 1; k++) tot += Math.hypot(skyPath[k + 1].x - skyPath[k].x, skyPath[k + 1].z - skyPath[k].z);
    for (let k = 0; k < skyPath.length - 1; k++) {
      const a = skyPath[k], b = skyPath[k + 1];
      const abx = b.x - a.x, abz = b.z - a.z, L = Math.hypot(abx, abz) || 1;
      const u = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / (L * L), 0, 1);
      const d = Math.hypot(x - (a.x + abx * u), z - (a.z + abz * u));
      if (d < best) (best = d), (bu = (acc + u * L) / (tot || 1));
      acc += L;
    }
    return { d: best, u: bu };
  }

  // ---------------------------------------------------------------- 지형 높이 준비: 도로 샘플 해시 (물길 샘플은 땅이 아님)
  const HASH = 20;
  const ckey = (a, b) => (a + 8192) * 16384 + (b + 8192);
  const roadHash = new Map();
  const waterHash = new Map();
  for (let i = 0; i < SAMPLES; i++) {
    const p = samples[i].pos;
    const k = ckey(Math.floor(p.x / HASH), Math.floor(p.z / HASH));
    const map = samples[i].water ? waterHash : roadHash;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(samples[i]);
  }
  // 평평하게 할 곳(활주로·착륙장) 점도 해시에 (높이 = 그 면 높이)
  const flatHash = new Map();
  for (const z of flatZones)
    for (const s of z.samples) {
      const k = ckey(Math.floor(s.pos.x / HASH), Math.floor(s.pos.z / HASH));
      if (!flatHash.has(k)) flatHash.set(k, []);
      flatHash.get(k).push({ p: s.pos, tan: s.tan, half: z.half });
    }
  function near(map, x, z, r, fn) {
    const x0 = Math.floor((x - r) / HASH), x1 = Math.floor((x + r) / HASH), z0 = Math.floor((z - r) / HASH), z1 = Math.floor((z + r) / HASH);
    for (let a = x0; a <= x1; a++)
      for (let b = z0; b <= z1; b++) {
        const list = map.get(ckey(a, b));
        if (list) for (const s of list) fn(s);
      }
  }
  const depthAt = () => 0;

  // ---------------------------------------------------------------- 갓길 경사판 (열린 쪽: 코스 밖 풀밭에서 다시 올라올 수 있게)
  const SKW = 4.2;
  const skirtOK = [new Uint8Array(SAMPLES), new Uint8Array(SAMPLES)];
  // 활주로·착륙장이 붙는 쪽, 물가(선착장 근처)는 갓길 판 없음
  const nearWaterI = new Float32Array(SAMPLES).fill(1e9);
  for (const [a, b] of waterRuns) for (let i = a - mS(40); i <= b + mS(40); i++) nearWaterI[wrapI(i)] = 0;
  const apronSideI = new Uint8Array(SAMPLES);
  if (apron) {
    const [a, b] = rangeI(sky.apron.t0, sky.apron.t1);
    for (let i = a; i <= b; i++) apronSideI[wrapI(i)] = 1;
  }
  for (let n = 0; n < 2; n++)
    for (let i = 0; i < SAMPLES; i++)
      skirtOK[n][i] = !samples[i].water && !railSide[n][i] && nearWaterI[i] > 0 && !(apronSideI[i] && (n === 0) === (sky.apron.side < 0)) ? 1 : 0;
  const skirtAt = (i, side) => skirtOK[sideN(side)][wrapI(i)] === 1;
  {
    const skirtMat = new THREE.MeshLambertMaterial({ color: '#8fbf5a', side: THREE.DoubleSide });
    const OUT = [[0, 0], [1.6, -0.05], [3.0, -0.14], [SKW, -0.24], [SKW + 2.2, -1.0]];
    const v = new THREE.Vector3();
    const toBanked = (s, Lw, Yw) => {
      v.copy(s.right).multiplyScalar(Lw).addScaledVector(UP, Yw);
      return [v.dot(s.rightB), v.dot(s.up)];
    };
    for (const sd of [-1, 1]) {
      for (const [a, b] of runsOf((i) => skirtAt(i, sd))) {
        const prof = (s) => {
          const e = surf(s, sd * edgeLat(s, sd), 0.02).sub(s.pos);
          const eL = e.dot(s.right), eY = e.y;
          const pts = OUT.map(([d, dy]) => toBanked(s, eL + sd * d, eY + dy));
          return sd < 0 ? pts.reverse() : pts;
        };
        strip(spanList(a, b), prof, skirtMat, { vScale: 10, uScale: 6, surface: 'ground' });
      }
    }
  }

  // ---------------------------------------------------------------- 지형 높이
  const bb = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
  for (const s of samples) bb.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
  const bay = LG.bay ? { x: LG.bay[0], z: LG.bay[1], r: LG.bay[2] } : null;
  if (bay) bb.expandByPoint(new THREE.Vector2(bay.x - bay.r, bay.z - bay.r)).expandByPoint(new THREE.Vector2(bay.x + bay.r, bay.z + bay.r));
  const MARGIN = data.terrainMargin || 360;
  bb.expandByScalar(MARGIN);
  const CG = 40;
  const cgx0 = bb.min.x - CG, cgz0 = bb.min.y - CG;
  const CNXg = Math.ceil((bb.max.x - bb.min.x) / CG) + 3, CNZg = Math.ceil((bb.max.y - bb.min.y) / CG) + 3;
  const coarse = new Float32Array(CNXg * CNZg);
  const coarseD = new Float32Array(CNXg * CNZg);
  {
    const pts = samples.filter((s, i) => i % 6 === 0 && !s.water && i < SAMPLES);
    for (let j = 0; j < CNZg; j++)
      for (let i = 0; i < CNXg; i++) {
        const x = cgx0 + i * CG, z = cgz0 + j * CG;
        let sw = 0.00002, sy = 0, dmin = Infinity;
        for (const s of pts) {
          const q = (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2;
          if (q < dmin) dmin = q;
          const d2 = q + 900;
          const w = 1 / (d2 * Math.sqrt(d2));
          sw += w;
          sy += w * Math.max(4, s.pos.y);
        }
        coarse[j * CNXg + i] = sy / sw;
        coarseD[j * CNXg + i] = Math.sqrt(dmin);
      }
  }
  function coarseGrid(arr, x, z) {
    const fi = THREE.MathUtils.clamp((x - cgx0) / CG, 0, CNXg - 1.001), fj = THREE.MathUtils.clamp((z - cgz0) / CG, 0, CNZg - 1.001);
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const g = (a, b) => arr[b * CNXg + a];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(g(i, j), g(i + 1, j), u), THREE.MathUtils.lerp(g(i, j + 1), g(i + 1, j + 1), u), v);
  }
  const coarseH = (x, z) => coarseGrid(coarse, x, z);
  const farDist = (x, z) => coarseGrid(coarseD, x, z);
  /** 먼 언덕: 코스에서 120 m 넘게 떨어지면 솟기 시작하는 둥근 초록 언덕 (지형 격자 끝을 가림) */
  function hillH(x, z, df) {
    const rise = smooth(120, 360, df + noise(x / 70, z / 70, 2) * 40);
    if (rise <= 0) return 0;
    const ridge = 1 - Math.abs(noise(x / 210, z / 210, 3));
    return rise * (14 + ridge * ridge * 46 + noise(x / 60, z / 60, 3) * 9);
  }
  function naturalH(x, z, df = farDist(x, z)) {
    return coarseH(x, z) + noise(x / 110, z / 110, 3) * 2.2 - 0.4 + noise(x / 18, z / 18, 2) * 0.25 + hillH(x, z, df);
  }
  // 석호: 물길 중심선에서 channel m 안 + 큰 만(bay) 안은 물 바닥(floor), 밖으로 shore m에 걸쳐 기슭
  const CH = LG.channel ?? 24, SH = LG.shore ?? 18, FLOOR = LG.floor ?? -3.2;
  function lagoonW(x, z) {
    let w = 0;
    let dc = Infinity;
    near(waterHash, x, z, CH + SH + 4, (s) => {
      const d = Math.hypot(x - s.pos.x, z - s.pos.z);
      if (d < dc) dc = d;
    });
    if (dc < Infinity) w = 1 - smooth(CH, CH + SH, dc + noise(x / 20, z / 20, 2) * 4);
    if (bay) {
      const d = Math.hypot(x - bay.x, z - bay.z) + noise(x / 35, z / 35, 2) * 10;
      w = Math.max(w, 1 - smooth(bay.r, bay.r + SH * 1.4, d));
    }
    return w;
  }
  // 꽃밭 골짜기: 비행 루트(활주로 끝 → 착륙 지점) 아래를 data.valley.depth m 낮춤 (도로·활주로 근처는 원래 땅)
  const VD = (data.valley && data.valley.depth) || 0;
  function valleyDrop(x, z) {
    if (!VD || skyPath.length < 2) return 0;
    const { d, u } = skyLineDist(x, z);
    const w = (1 - smooth(14, 60, d + noise(x / 30, z / 30, 2) * 8)) * smooth(0.02, 0.16, u) * (1 - smooth(0.78, 0.96, u));
    return VD * w;
  }
  function terrainH(x, z) {
    const df = farDist(x, z);
    const lw = lagoonW(x, z);
    const lagoonMix = (H, keep) => (lw > 0 ? THREE.MathUtils.lerp(H, Math.min(H, FLOOR + noise(x / 26, z / 26, 2) * 0.5), lw * (1 - keep)) : H);
    if (df > 160) return { H: lagoonMix(naturalH(x, z, df), 0), nd: df };
    let nd = Infinity, ns = null, under = Infinity;
    near(roadHash, x, z, 100, (s) => {
      const dx = x - s.pos.x, dz = z - s.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < nd) (nd = d), (ns = s);
      if (d < s.hw + CURB + 3) {
        const along = dx * s.tan.x + dz * s.tan.z;
        if (Math.abs(along) > 4) return;
        const l = dx * s.right.x + dz * s.right.z;
        const gr = s.tan3.y / (Math.hypot(s.tan3.x, s.tan3.z) || 1);
        const y = roadYAt(s, THREE.MathUtils.clamp(l, -s.hw - CURB, s.hw + CURB)) + gr * along;
        under = Math.min(under, y);
      }
    });
    // 활주로·착륙장 밑: 그 면보다 0.3 m 아래로 평평하게, 옆 14 m에 걸쳐 원래 땅으로
    let fH = null, fW = 0;
    near(flatHash, x, z, 30, (f) => {
      const dx = x - f.p.x, dz = z - f.p.z;
      const along = dx * f.tan.x + dz * f.tan.z;
      if (Math.abs(along) > 2.5) return;
      const lat = Math.abs(dx * f.tan.z - dz * f.tan.x);
      const w = 1 - smooth(f.half + 1.5, f.half + 16, lat);
      if (w > fW) (fW = w), (fH = f.p.y - 0.3);
    });
    // 골짜기는 물 높이 + 0.7 m 아래로는 안 파냄 (비행 루트 아래에 연못이 생기면 일찍 내린 차가 배가 되어 갇힘)
    const nat0 = naturalH(x, z, df), vd = valleyDrop(x, z);
    const nat = vd > 0 ? Math.max(Math.min(nat0, WL + 0.7), nat0 - vd) : nat0;
    let H;
    let l = 0;
    if (ns) l = (x - ns.pos.x) * ns.right.x + (z - ns.pos.z) * ns.right.z;
    const side = l < 0 ? -1 : 1;
    const eW = ns ? ns.hw + kerbAt(ns.i, side) : HW + CURB;
    let keep = 0; // 1 = 도로 바로 옆 (석호로 안 낮춤)
    if (ns && nd < eW + 1 && under < Infinity) {
      H = under - 0.3;
      keep = 1;
    } else {
      let edgeY = nat, k = 1, sink = 0;
      if (ns) {
        const along = (x - ns.pos.x) * ns.tan.x + (z - ns.pos.z) * ns.tan.z;
        const gr = ns.tan3.y / (Math.hypot(ns.tan3.x, ns.tan3.z) || 1);
        const roadEdge = roadYAt(ns, side * eW) + gr * along;
        edgeY = roadEdge - 0.15;
        const sk = skirtAt(ns.i, side);
        if (sk) sink = 0.45 * (1 - smooth(eW + SKW + 0.5, eW + SKW + 5, nd));
        k = smooth(eW + 1 + (sk ? SKW : 0), eW + 42, nd);
        keep = 1 - smooth(eW + 1, eW + 10, nd);
      }
      H = edgeY * (1 - k) + nat * k - sink;
      if (under < Infinity) H = Math.min(H, under - 0.1);
    }
    if (fW > 0 && fH !== null) H = THREE.MathUtils.lerp(H, fH, fW);
    return { H: lagoonMix(H, keep), nd: ns ? nd : df, lw };
  }

  // ---------------------------------------------------------------- 지형 메시 (격자, 충돌 있음)
  const gx0 = Math.floor(bb.min.x / CELL) * CELL, gz0 = Math.floor(bb.min.y / CELL) * CELL;
  const NX = Math.ceil((bb.max.x - gx0) / CELL), NZ = Math.ceil((bb.max.y - gz0) / CELL);
  const HG = new Float32Array((NX + 1) * (NZ + 1));
  const ND = new Float32Array((NX + 1) * (NZ + 1));
  const gi = (i, j) => j * (NX + 1) + i;
  for (let j = 0; j <= NZ; j++)
    for (let i = 0; i <= NX; i++) {
      const x = gx0 + i * CELL, z = gz0 + j * CELL;
      const { H, nd } = terrainH(x, z);
      HG[gi(i, j)] = H;
      ND[gi(i, j)] = nd;
    }
  function heightAt(x, z) {
    const fi = (x - gx0) / CELL, fj = (z - gz0) / CELL;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return naturalH(x, z);
    const u = fi - i, v = fj - j;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(HG[gi(i, j)], HG[gi(i + 1, j)], u), THREE.MathUtils.lerp(HG[gi(i, j + 1)], HG[gi(i + 1, j + 1)], u), v);
  }
  const fieldAt = (x, z) => (x < gx0 || z < gz0 || x > gx0 + NX * CELL || z > gz0 + NZ * CELL ? -999 : 10);
  /** 물 위인가 (지형이 물 높이보다 낮음) */
  const inWater = (x, z, pad = 0) => heightAt(x, z) < WL - 0.15 - pad * 0.05;

  // 색: 밝은 풀밭(두 가지 초록 + 노란 꽃밭 기운), 길가 짧은 잔디, 가파른 곳 흙·바위, 물가 모래, 물 밑 하늘빛 모래
  const cA = new THREE.Color('#7cc45a'), cB = new THREE.Color('#5fae47'), cY = new THREE.Color('#b5cf55');
  const cRock = new THREE.Color('#8a7f72'), cRock2 = new THREE.Color('#a39684'), cShoulder = new THREE.Color('#93cc66');
  const cSand = new THREE.Color('#ead9a6'), cSandW = new THREE.Color('#b9d9c6'), cDeep = new THREE.Color('#7fc2c4'), cTmp = new THREE.Color();
  const gfx5 = gfxEnabled();
  const terrainVisualMat = gfx5 ? landscapeMaterial({waterLevel:WL,preserveBelow:true}) : null;
  if(gfx5) gfxSurface(roadMat,'dirt');
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const terrainColor = (x, y, z, ny, nd) => {
    const n1 = noise(x / 80, z / 80, 3), n2 = noise(x / 12, z / 12, 2);
    cTmp.copy(cA).lerp(cB, THREE.MathUtils.clamp(0.5 + n2 * 0.8, 0, 1));
    cTmp.lerp(cY, smooth(0.15, 0.55, n1) * 0.5);
    if (nd < 20) cTmp.lerp(cShoulder, 0.5 * (1 - smooth(8, 20, nd)));
    if (ny < 0.8) cTmp.lerp(n2 > 0 ? cRock : cRock2, smooth(0.8, 0.52, ny) * 0.8);
    // 물가: 물 높이 +1.4 m 아래는 모래, 물속은 하늘빛 모래 → 깊을수록 청록
    if (y < WL + 1.4) cTmp.lerp(cSand, smooth(WL + 1.4, WL + 0.3, y));
    if (y < WL - 0.2) cTmp.copy(cSandW).lerp(cDeep, smooth(WL - 0.3, FLOOR + 0.4, y));
    return cTmp;
  };
  for (let cj = 0; cj < NZ; cj += CHUNK)
    for (let ci = 0; ci < NX; ci += CHUNK) {
      const i1 = Math.min(NX, ci + CHUNK), j1 = Math.min(NZ, cj + CHUNK);
      let minNd = Infinity;
      for (let j = cj; j <= j1; j++) for (let i = ci; i <= i1; i++) minNd = Math.min(minNd, ND[gi(i, j)]);
      const st = minNd > 70 ? 3 : 1;
      const P = [], C = [];
      const tri3 = (p, q, r, nyOverride) => {
        P.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
        const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], wx = r[0] - p[0], wy = r[1] - p[1], wz = r[2] - p[2];
        const nx = uy * wz - uz * wy, nyy = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const ny = nyOverride ?? nyy / (Math.hypot(nx, nyy, nz) || 1);
        const c = terrainColor((p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3, Math.abs(ny), Math.min(p[3], q[3], r[3]));
        for (let k = 0; k < 3; k++) C.push(c.r, c.g, c.b);
      };
      const V = (a, b) => [gx0 + a * CELL, HG[gi(a, b)], gz0 + b * CELL, ND[gi(a, b)]];
      for (let j = cj; j < j1; j += st)
        for (let i = ci; i < i1; i += st) {
          const ia = Math.min(i1, i + st), ja = Math.min(j1, j + st);
          const v = [V(i, j), V(ia, j), V(ia, ja), V(i, ja)];
          tri3(v[0], v[2], v[1]);
          tri3(v[0], v[3], v[2]);
        }
      if (st > 1) {
        const edges = [];
        for (let i = ci; i < i1; i += st) edges.push([V(i, cj), V(Math.min(i1, i + st), cj)], [V(Math.min(i1, i + st), j1), V(i, j1)]);
        for (let j = cj; j < j1; j += st) edges.push([V(i1, j), V(i1, Math.min(j1, j + st))], [V(ci, Math.min(j1, j + st)), V(ci, j)]);
        for (const [p, q] of edges) {
          const pd = [p[0], p[1] - 3, p[2], p[3]], qd = [q[0], q[1] - 3, q[2], q[3]];
          tri3(p, q, qd, 1);
          tri3(p, qd, pd, 1);
        }
      }
      if (!P.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, terrainMat);
      m.receiveShadow = true;
      m.userData.starterTerrain = true; // 이름을 안 붙여야 staticBatch가 칸별로 합침
      addGround(m, 'ground');
      if(gfx5){m.visible=false;m.name='gfx3CollisionTerrain';const vg=smoothVisualGeometry(geo,heightAt);vg.setAttribute('color',geo.attributes.color.clone());for(let k=0;k<vg.attributes.position.count;k++)if(vg.attributes.position.getY(k)<=WL){vg.attributes.normal.setXYZ(k,geo.attributes.normal.getX(k),geo.attributes.normal.getY(k),geo.attributes.normal.getZ(k));}const visual=new THREE.Mesh(vg,terrainVisualMat);visual.receiveShadow=true;visual.userData.starterTerrain=true;group.add(visual);}
    }

  // ---------------------------------------------------------------- 석호 물 면 (surface 'water', 지형이 물보다 낮은 칸만)
  const waterNormal = waterNormalTexture(77);
  waterNormal.repeat.set(1, 1);
  const waterMat = new THREE.MeshStandardMaterial({
    color: '#38b9cf', roughness: 0.12, metalness: 0.08, transparent: true, opacity: 0.78, normalMap: waterNormal, normalScale: new THREE.Vector2(0.55, 0.55), depthWrite: false,
  });
  const waterMeshes = [];
  {
    const WC = 10; // 물 면 격자 (m)
    const WCH = 12; // 덩어리 = 12×12칸
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let j = 0; j <= NZ; j++)
      for (let i = 0; i <= NX; i++)
        if (HG[gi(i, j)] < WL + 0.2) {
          const x = gx0 + i * CELL, z = gz0 + j * CELL;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        }
    if (x0 < Infinity) {
      x0 = Math.floor((x0 - WC) / WC) * WC; z0 = Math.floor((z0 - WC) / WC) * WC;
      const nx = Math.ceil((x1 + WC - x0) / WC), nz = Math.ceil((z1 + WC - z0) / WC);
      const wet = (x, z) => heightAt(x, z) < WL + 0.25;
      for (let cj = 0; cj < nz; cj += WCH)
        for (let ci = 0; ci < nx; ci += WCH) {
          const P = [], U = [];
          for (let j = cj; j < Math.min(nz, cj + WCH); j++)
            for (let i = ci; i < Math.min(nx, ci + WCH); i++) {
              const ax = x0 + i * WC, az = z0 + j * WC;
              // 칸 안 9점 중 하나라도 물(지형이 물보다 낮음)이면 칸 전체를 깜 (기슭 밑으로 들어간 부분은 땅에 가려 안 보임)
              let any = false;
              for (const [u, v] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) if (wet(ax + u * WC, az + v * WC)) any = true;
              if (!any) continue;
              const bx = ax + WC, bz = az + WC;
              P.push(ax, WL, az, ax, WL, bz, bx, WL, az, bx, WL, az, ax, WL, bz, bx, WL, bz);
              U.push(ax / 40, az / 40, ax / 40, bz / 40, bx / 40, az / 40, bx / 40, az / 40, ax / 40, bz / 40, bx / 40, bz / 40);
            }
          if (!P.length) continue;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
          geo.computeVertexNormals();
          const m = new THREE.Mesh(geo, waterMat);
          m.receiveShadow = true;
          m.renderOrder = 2;
          addGround(m, 'water');
          waterMeshes.push(m);
        }
    }
  }

  // ---------------------------------------------------------------- 비행 루트 메시 (활주로, 착륙장)
  if (runway) {
    const mat = new THREE.MeshStandardMaterial({ map: runwayTexture(), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    strip(runway.samples, [[-runway.half, -0.01], [runway.half, -0.01]], mat, { vScale: 16, surface: 'ground' });
    // 이륙대 옆면 (끝부분이 들려 있음): 노랑·검정 줄무늬
    const lipMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, side: THREE.DoubleSide });
    lipMat.map.repeat.set(2, 1);
    const tail = runway.samples.slice(-16);
    strip(tail, [[-runway.half, 0], [-runway.half, -2.2], [runway.half, -2.2], [runway.half, 0]], lipMat, { vScale: 4, uScale: 4 });
    // 활주로 양옆 경사면 (그랑프리와 같음: 옆에서 비스듬히 들어가도 턱에 안 걸리게)
    const SKIRT_W = 8, SKIRT_DROP = 2.5;
    const skirtMat = new THREE.MeshStandardMaterial({ color: '#8d9399', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
    const rwY0 = runway.start.pos.y;
    for (const sd of [-1, 1]) {
      strip(runway.samples, (s) => {
        const edge = [sd * runway.half, -0.02], foot = [sd * (runway.half + SKIRT_W), -(s.pos.y - rwY0) - SKIRT_DROP];
        return sd > 0 ? [edge, foot] : [foot, edge];
      }, skirtMat, { vScale: 8, surface: 'ground' });
    }
  }
  if (apron) {
    const mat = new THREE.MeshStandardMaterial({ map: apronTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    const side = apron.side;
    const prof = (s, k) => {
      const w = apron.widthAt(k);
      const a = side * (s.hw + CURB - 0.2), b = side * (s.hw + CURB + Math.max(0.3, w));
      return side < 0 ? [[b, 0.0], [a, 0.0]] : [[a, 0.0], [b, 0.0]];
    };
    strip(apron.list, prof, mat, { vScale: 14, surface: 'ground' });
  }

  // ---------------------------------------------------------------- 출발선 (체커) + 출발 그리드 칸
  const s0 = samples[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(2 * s0.hw, 2.4), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  line.material.map.repeat.set((2 * s0.hw) / 4, 1);
  {
    const x = new THREE.Vector3().crossVectors(s0.tan3, s0.up);
    line.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, s0.tan3, s0.up));
  }
  line.position.copy(s0.pos).addScaledVector(s0.up, 0.04);
  group.add(line);
  {
    const gridMat = new THREE.MeshBasicMaterial({ color: '#f4f2ea', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const bars2 = [];
    for (let k = 0; k < 8; k++) {
      const back = 10 + k * 8.5;
      const lat = (k % 2 ? 1 : -1) * 3.6;
      const s = samples[wrapI(-mS(back))];
      const p = surf(s, lat, 0.035);
      bars2.push({ p, s, w: 3.6, l: 0.35 });
      for (const sd of [-1, 1]) bars2.push({ p: surf(s, lat + sd * 1.75, 0.035).addScaledVector(s.tan3, -0.9), s, w: 0.3, l: 2.1 });
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    const im = new THREE.InstancedMesh(geo, gridMat, bars2.length);
    const m4 = new THREE.Matrix4();
    bars2.forEach((b, i) => {
      const x = new THREE.Vector3().crossVectors(b.s.tan3, b.s.up);
      m4.makeBasis(x.multiplyScalar(b.w), b.s.tan3.clone().multiplyScalar(b.l), b.s.up).setPosition(b.p);
      im.setMatrixAt(i, m4);
    });
    group.add(im);
  }

  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- 찾기, 충돌
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
    // placeAt(높이 30에서 아래로 60 m): 고른 코스 지점 바로 위(도로 + 6 m)에서 쏨
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

  /** 다른 길(활주로, 착륙장) 위인가 */
  function altDist(pos, path) {
    let bd = Infinity, bs = null;
    for (let k = 0; k < path.samples.length; k += 2) {
      const q = path.samples[k].pos;
      const d = (q.x - pos.x) ** 2 + (q.z - pos.z) ** 2;
      if (d < bd) (bd = d), (bs = q);
    }
    return { d: Math.sqrt(bd), y: bs ? bs.y : 0 };
  }
  const onAltPath = (pos, margin = 1) =>
    altPaths.some((p) => {
      const r = altDist(pos, p);
      return r.d < p.half + margin && Math.abs(pos.y - r.y) < 6;
    });
  /** 비행 루트 위를 날고 있는가 (비행 루트 근처 + 충분히 높음) */
  function inSkyCorridor(pos) {
    for (let k = 0; k < skyPath.length - 1; k++) {
      const a = skyPath[k], b = skyPath[k + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const u = THREE.MathUtils.clamp(((pos.x - a.x) * abx + (pos.z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
      const d = Math.hypot(pos.x - (a.x + abx * u), pos.z - (a.z + abz * u));
      const y = a.y + (b.y - a.y) * u;
      if (d < 45 && pos.y > y - 9) return true;
    }
    return false;
  }
  /** 본 도로 밖의 다른 길 위 (main.js는 이때 바퀴 수 판정을 잠시 멈춤) */
  const onShortcut = (pos) => onAltPath(pos) || inSkyCorridor(pos);
  function isOnRoad(pos, near = nearest(pos)) {
    if (near.sample.water) return near.dist < near.sample.hw + 1;
    return near.dist < near.sample.hw + kerbAt(near.index, near.lateral < 0 ? -1 : 1) || onAltPath(pos);
  }
  function edgeInfo(pos, near = nearest(pos)) {
    // 물 위·선착장 근처 = 느려지지 않음 (물 밖으로 나가도 그냥 물)
    if (near.sample.water) return { kerb: 0, off: 0, runoff: true };
    if (onAltPath(pos)) return { kerb: 0, off: 0, runoff: false };
    const hw = near.sample.hw;
    const k = kerbAt(near.index, near.lateral < 0 ? -1 : 1);
    return { ...edgeFraction(near.dist, hw, hw + k), runoff: false };
  }

  const outline = samples.filter((_, i) => i % 6 === 0 && i < SAMPLES).map((s) => [s.pos.x, s.pos.z]);
  const waterRanges = waterRuns.map(([a, b]) => ({ t0: (a % SAMPLES) / SAMPLES, t1: (b % SAMPLES) / SAMPLES, length: ((b - a) / SAMPLES) * length }));
  const isWaterT = (t) => !!sampleAt(t).water;

  function animate(time) {
    // 물결: 노멀맵 두 방향으로 천천히 흐름
    waterNormal.offset.set(time * 0.012, time * 0.008);
    railBandMat.emissive && railBandMat.emissive.setRGB(0, 0, 0);
  }
  const sampleAtTracked = (t) => (lastSampled = sampleAt(t));
  const buildMs = Math.round(performance.now() - buildT0);

  return {
    data, width: W, length, samples, sampleAt: sampleAtTracked, nearest, nearestRaw, castRay, boostPadAt: () => null, animate, outline,
    shortcut: null, shortcutDist: () => Infinity, onShortcut, isOnRoad, edgeInfo, racingLine, lineY, kerbWidth: CURB, kerbAt, group, groundMeshes,
    arena: false, pad: null, inPad: () => false, spawn: null,
    // 물 (바닷가와 같은 이름: racingLineFx·ghost·academy가 isWaterT/waterRanges를 씀). sea는 null (seaGates·바닷가 전용 풍경이 안 붙게)
    sea: null, inSea: (x, z, r = 0) => inWater(x, z, r), waterRanges, isWaterT, buoys: [], slipways, waterLevel: WL, inWater, waterMeshes, bay,
    // gpCorners.js(코너 표시판)가 쓰는 그랑프리 방식 값 (흰 표시판)
    grandprix: true, inSpace: false, surf, roadYAt, heightAt, fieldAt, railLimit, railRuns, railSide, deckHalf: HW + CURB + 1.2, curb: CURB,
    // 비행 루트 (gpTrack.js와 같은 이름)
    runway, apron, plank: null, rings, skyPath, thermals, thermalAt, inSkyCorridor, onAltPath, altPaths, skyLineDist,
    indexAt, S, spanList, noise, dimension: null, setWorld() {}, buildMs, sampleCount: SAMPLES,
    offroadColors: ['#7cc45a', '#5fae47', '#b5cf55', '#8a6a4a'], apexColor: '#ffd23f',
    // 변신 연습장 전용 (풍경용)
    starter: true, halfWidthAt: hwAt, edgeAt, EDGE, depthAt, jumps, terrainBox: bb, strip, mS, wrapI, naturalH, coarseH, farDist, hillH,
    edgeLat, railLatAt, valleyDrop, lagoonW,
  };
}
