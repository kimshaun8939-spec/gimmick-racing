// 클록워크 파운드리: 독립된 트랙 구현. glacierTrack API를 바탕으로 황토 지형·구리 연석·사발 뱅크 코너에 맞춤.
// 클록워크 파운드리 — 교차 고가·사발·헤어핀·시케인, 2바퀴
//
// 화산 지대(volcanoTrack.js)를 바탕으로 낭떠러지·용암·점프 립을 빼고 공장 지대으로 바꿈
//   - 넓은 길 (반폭 8.5~9 m), 구간 도로 폭 (halfWidths)
//   - 길 가장자리 종류 (edges): open 공장 부지(느려지지만 다시 올라올 수 있음) / rail 가드레일 / wall 금속 벽(터널 안)
//   - 정비 터널 (tunnels [[t0, t1]]): 이 파일은 양옆 금속 벽 + 옆 언덕만, 지붕·장식은 풍경(foundryScenery.js)
//   - 다리 (bridges) + 공장 수로 골짜기 (river): 다리 밑 땅을 강바닥까지 파냄
//   - 경사 코너 (bank), 넓은 연석 (큰 스위퍼에도), 코스에서 멀어질수록 솟는 황토 언덕 (지형 격자 끝을 가림)
// 돌려주는 객체는 volcanoTrack.js / moonTrack.js와 같은 모양 (car.js, main.js, hud 미니맵, racingLineFx, gpCorners, 봇이 그대로 씀)
import * as THREE from 'three';
import { computeRacingLine, edgeFraction } from './racingLine.js';
import { batchLocal } from './staticBatch.js';
import { canvasTexture, seededRandom, makeNoise } from './moonTrack.js';

export { canvasTexture, seededRandom, makeNoise };

const UP = new THREE.Vector3(0, 1, 0);
const SAMPLE_STEP = 2.4; // 중심선 샘플 간격 (m)
const CELL = 6; // 가까운 지형 격자 한 칸 (m)
const CHUNK = 24; // 지형 메시 덩어리 = 24×24칸
const smooth = (a, b, x) => {
  const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
// 길 가장자리 종류 (volcano와 같은 번호: cliff·lava는 이 맵에서 안 씀)
export const EDGE = { open: 0, cliff: 1, wall: 2, rail: 3, lava: 4 };

// ---------------------------------------------------------------- 텍스처
function roadTexture() {
  // 공장 지대 도로: 짙은 아스팔트 + 서리 알갱이 + 흰 가장자리 선
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#2a2e34';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3200; i++) {
      const v = 36 + Math.random() * 26;
      g.fillStyle = Math.random() < 0.12 ? `rgba(${v + 120},${v + 140},${v + 160},0.22)` : `rgba(${v},${v + 3},${v + 8},0.45)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // 타이어 자국 (조금 더 어두운 세로 띠 두 줄씩)
    g.fillStyle = 'rgba(10,12,16,0.18)';
    for (const x of [0.3, 0.36, 0.64, 0.7]) g.fillRect(w * x, 0, w * 0.035, h);
    g.fillStyle = '#eef3f8';
    g.fillRect(w * 0.025, 0, w * 0.02, h);
    g.fillRect(w * 0.955, 0, w * 0.02, h);
  });
}
function curbTexture(a, b) {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = b;
    g.fillRect(0, h / 2, w, h / 2);
    g.fillStyle = 'rgba(0,0,0,0.15)';
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
/** 눈: 흰 바탕에 푸른 그늘 얼룩과 반짝이 */
function snowTexture(seed) {
  return canvasTexture(128, 128, (g, w, h) => {
    const r = seededRandom(seed);
    g.fillStyle = '#e9eff6';
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) {
      const v = 200 + Math.floor(r() * 50);
      g.fillStyle = `rgba(${v - 18},${v - 6},${v + 5},0.35)`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    for (let k = 0; k < 120; k++) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(r() * w, r() * h, 1, 1);
    }
  });
}
/** 금속 벽: 푸른 얼음 + 세로 금 + 하얀 서리 줄 */
function iceTexture(seed) {
  return canvasTexture(128, 128, (g, w, h) => {
    const r = seededRandom(seed);
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#bfe6fb');
    grd.addColorStop(0.5, '#7fc4ec');
    grd.addColorStop(1, '#a9dcf7');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 500; k++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(40,110,170,0.18)';
      g.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 2);
    }
    for (let k = 0; k < 10; k++) {
      g.fillStyle = 'rgba(30,90,150,0.3)';
      g.fillRect(r() * w, 0, 1 + r() * 2, h);
    }
  });
}

export function buildFoundryTrack(data, scene) {
  const buildT0 = performance.now();
  const W = data.width;
  const HW = W / 2; // 기본 반폭 (track.width/2)
  const CURB = 1.4;
  const noise = makeNoise(20261112);
  const group = new THREE.Group();
  group.name = 'foundryTrack';
  scene.add(group);

  // ---------------------------------------------------------------- 중심선 샘플
  const curve = new THREE.CatmullRomCurve3(data.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, data.points.length * 40);
  const length = curve.getLength();
  const SAMPLES = Math.max(1200, Math.round(length / SAMPLE_STEP));
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pos = curve.getPointAt(t % 1);
    const tan3 = curve.getTangentAt(t % 1);
    const tan = tan3.clone().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
    // space: false → gpCorners가 땅 위에 흰 표시판을 세움
    samples.push({ t, i, pos, tan, tan3, right, dist: t * length, bank: 0, gap: false, roll: false, magnet: false, space: false, bridge: null, land: true, hw: HW });
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
  const edgeDepth = [new Float32Array(SAMPLES).fill(NaN), new Float32Array(SAMPLES).fill(NaN)];
  for (const [t0, t1, side, kind, depth] of data.edges || []) {
    const [a, b] = rangeI(t0, t1);
    const code = EDGE[kind] ?? 0;
    for (let i = a; i <= b; i++) {
      const q = wrapI(i);
      for (const n of side < 0 ? [0] : side > 0 ? [1] : [0, 1]) {
        edgeT[n][q] = code;
        if (depth != null) edgeDepth[n][q] = depth;
      }
    }
  }
  const sideN = (side) => (side < 0 ? 0 : 1);
  const edgeAt = (i, side) => edgeT[sideN(side)][wrapI(i)];

  // ---------------------------------------------------------------- 점프: 립 앞은 kick 각도로 들고, 립~착지 사이는 도로 없음
  const jumps = (data.jumps || []).map((j) => {
    const lipI = indexAt(j.lip);
    let landI = indexAt(j.land);
    if (landI < lipI) landI += SAMPLES;
    const kickN = mS(j.kickLen || 26);
    const a = lipI - kickN;
    const ds = length / SAMPLES;
    const y0 = S(a).pos.y, s0 = (S(a + 1).pos.y - S(a - 1).pos.y) / (2 * ds);
    const L = kickN * ds;
    const want = Math.tan(THREE.MathUtils.degToRad(j.kick ?? 6));
    const q = (want - s0) / (2 * L);
    for (let k = 0; k <= kickN; k++) {
      const x = k * ds;
      S(a + k).pos.y = y0 + s0 * x + q * x * x;
    }
    const lipY = S(lipI).pos.y, landY = S(landI).pos.y;
    for (let i = lipI; i < landI; i++) {
      const u = (i - lipI) / (landI - lipI);
      S(i).pos.y = THREE.MathUtils.lerp(lipY, landY, u);
      S(i).gap = true;
      S(i).land = false;
    }
    const lip = S(lipI), land = S(landI);
    return { ...j, lipI: wrapI(lipI), landI: wrapI(landI), lip, landS: land, gapLen: (landI - lipI) * ds, lipY, landY, kickN };
  });
  for (const j of jumps)
    for (let k = -j.kickN - 3; k <= 3; k++) {
      const s = S(j.lipI + k);
      if (s.gap) continue;
      const p = S(j.lipI + k - 1).gap ? s.pos : S(j.lipI + k - 1).pos, n = S(j.lipI + k + 1).gap ? s.pos : S(j.lipI + k + 1).pos;
      s.tan3 = n.clone().sub(p).normalize();
    }

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
    const ramp = Math.max(4, mS(bk.ramp || 22));
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
  samples[SAMPLES] = { ...samples[0], t: 1, dist: length };
  /** 도로 면 위의 점 (옆 l, 위 h) */
  // l is horizontal lateral distance, as in nearest(), racingLine and railLimit.
  // Unit rightB would shrink the visible road at a bank and leave a hidden rail outside it.
  const surf = (s, l, h = 0, out = new THREE.Vector3()) => out.copy(s.pos).addScaledVector(s.rightB, l / Math.cos(s.bank)).addScaledVector(s.up, h);
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
  const hasRoad = (i) => !samples[i].gap;


  // ---------------------------------------------------------------- 터널·다리 구간 표시 (샘플마다)
  const tunnels = (data.tunnels || []).map(([t0, t1]) => ({ t0, t1 }));
  const tunnelW = new Float32Array(SAMPLES); // 0~1: 터널 안 1 (입구 앞뒤 25 m에 걸쳐 부드럽게) → 옆 언덕 높이
  for (const tn of tunnels) {
    const [a, b] = rangeI(tn.t0, tn.t1);
    const r = mS(25);
    for (let i = a - r; i <= b + r; i++) tunnelW[wrapI(i)] = Math.max(tunnelW[wrapI(i)], smooth(a - r, a, i) * smooth(b + r, b, i));
  }
  const inTunnelI = (i) => tunnelW[wrapI(i)] > 0.99;
  const bridges = (data.bridges || []).map((b) => {
    const [a, c] = rangeI(b.t0, b.t1);
    return { ...b, a, b: c };
  });
  const onBridge = new Uint8Array(SAMPLES);
  for (const br of bridges) for (let i = br.a; i <= br.b; i++) onBridge[wrapI(i)] = 1;

  // ---------------------------------------------------------------- 레이싱 라인과 넓은 연석
  const KERB_WIDE = 2.6;
  const LINE_MARGIN = 1.15;
  const LINE_PLAIN = 1.0;
  const kerbW = [new Float32Array(SAMPLES).fill(CURB), new Float32Array(SAMPLES).fill(CURB)];
  const kerbAt = (i, side) => kerbW[sideN(side)][wrapI(i)];
  const lineSamples = samples.slice(0, SAMPLES);
  const lineUse = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
  const lineLimit = (i, side) => {
    const q = wrapI(i);
    const u = lineUse[sideN(side)][q];
    // 터널 벽 쪽은 0.4 m 더 안쪽 (벽에 긁히지 않게)
    const wall = edgeT[sideN(side)][q] === EDGE.wall ? 0.4 : 0;
    let limit = samples[q].hw - LINE_PLAIN - wall + u * Math.max(0, kerbAt(q, side) - LINE_MARGIN + LINE_PLAIN);
    const shelf = data.wallRide;
    if (shelf) {
      const t = samples[q].t, pad = 30 / length;
      if (t > shelf.t0 - pad && t < shelf.t1 + pad) {
        const w = smooth(shelf.t0 - pad, shelf.t0 + pad, t) * (1 - smooth(shelf.t1 - pad, shelf.t1 + pad, t));
        limit = Math.min(limit, THREE.MathUtils.lerp(limit, samples[q].hw - 2.2, w));
      }
    }
    return limit;
  };
  const noWide = (i) => samples[i].gap || inTunnelI(i);
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
  const prelimApexes = () => computeRacingLine(halfSamples, (i, side) => lineLimit(i * 2, side), length, { iterScale: 0.7 }).apexes.map((a) => ({ ...a, i: a.i * 2 }));
  let apexes0 = prelimApexes();
  for (let pass = 0; pass < 2; pass++) {
    for (const ap of apexes0) {
      if (ap.radius > 900) continue;
      // 큰 스위퍼(반지름 150 m 넘음)는 연석도 길게: 에이펙스 앞 최대 140 m, 뒤 최대 110 m
      const big = ap.radius > 150;
      const pre = big ? Math.min(140, ap.radius * 0.3) : 30, post = big ? Math.min(110, ap.radius * 0.22) : 22;
      widen(ap.i - mS(pre), ap.i + mS(post), ap.side, mS(big ? 25 : 10));
      widen(ap.i + mS(12), ap.i + mS(big ? post + 60 : 62), -ap.side, mS(14));
    }
    if (pass === 0) apexes0 = prelimApexes();
  }
  const racingLine = computeRacingLine(lineSamples, lineLimit, length, { bank: lineSamples.map((s) => s.bank || 0) });
  const lineY = (i, d = 0) => roadYAt(samples[i], racingLine.offset[i] + d);
  // 큰 스위퍼: 라인이 길 끝에 붙는 곳(안쪽 에이펙스·바깥 탈출)마다 연석을 넓게 (보이는 연석 + 연석 위도 '도로'로 침)
  {
    const touch = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
    for (let i = 0; i < SAMPLES; i++) {
      const o = racingLine.offset[i];
      if (Math.abs(o) > samples[i].hw - LINE_PLAIN - 0.35 && !noWide(i) && !onBridge[i]) touch[o < 0 ? 0 : 1][i] = 1;
    }
    const r = mS(18);
    for (let n = 0; n < 2; n++)
      for (let i = 0; i < SAMPLES; i++) {
        let m = 0;
        for (let j = -r; j <= r; j += 2) if (touch[n][wrapI(i + j)]) m = Math.max(m, 1 - Math.abs(j) / (r + 1));
        if (m > 0) kerbW[n][i] = Math.max(kerbW[n][i], CURB + (KERB_WIDE - CURB) * smooth(0, 0.6, m));
      }
  }

  // ---------------------------------------------------------------- 도로, 연석
  // 살짝 젖은 듯 반들거리는 아스팔트, 파랑/흰 연석
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.85, metalness: 0.06 });
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(data.palette?.kerb?.[0] || '#f2d6a2', data.palette?.kerb?.[1] || '#d18223'), roughness: 0.6 });
  for (const [a, b] of runsOf((i) => hasRoad(i))) strip(spanList(a, b), (s) => [[-s.hw, 0], [s.hw, 0]], roadMat, { vScale: 12, surface: 'ground' });
  for (const side of [-1, 1]) {
    for (const [a, b] of runsOf((i) => hasRoad(i))) {
      const L = spanList(a, b);
      const prof = side < 0 ? (s) => [[-s.hw - kerbAt(s.i, -1), 0.02], [-s.hw, 0.02]] : (s) => [[s.hw, 0.02], [s.hw + kerbAt(s.i, 1), 0.02]];
      strip(L, prof, curbMat, { vScale: 4, surface: 'ground' });
    }
  }
  const edgeLat = (s, side) => s.hw + kerbAt(s.i, side);

  // ---------------------------------------------------------------- 막힌 가장자리 (가드레일·금속 벽): car.keepInsideRail이 씀
  const railSide = [new Uint8Array(SAMPLES), new Uint8Array(SAMPLES)];
  const setRail = (a, b, side) => {
    for (let i = a; i <= b; i++) {
      const q = wrapI(i);
      if (samples[q].gap) continue;
      if (side <= 0) railSide[0][q] = 1;
      if (side >= 0) railSide[1][q] = 1;
    }
  };
  for (let n = 0; n < 2; n++)
    for (let i = 0; i < SAMPLES; i++) if (edgeT[n][i] === EDGE.rail || edgeT[n][i] === EDGE.wall) railSide[n][i] = 1;
  for (const [t0, t1, side] of data.rails || []) setRail(...rangeI(t0, t1), side);
  // 레일 자리: 연석 끝에서 0.6 m (벽은 0.35 m)
  const railLatAt = (s, side) => s.hw + kerbAt(s.i, side) + (edgeAt(s.i, side) === EDGE.wall ? 0.35 : 0.6);
  function railLimit(near) {
    const side = near.lateral < 0 ? 0 : 1;
    if (!railSide[side][near.index]) return null;
    return railLatAt(near.sample, side ? 1 : -1);
  }
  const wallMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const railMat = new THREE.MeshStandardMaterial({ color: '#d3d9e0', metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  const railGlowMat = new THREE.MeshBasicMaterial({ color: '#f5bf62', toneMapped: false, side: THREE.DoubleSide });
  const iceTex = iceTexture(31);
  const iceWallMat = new THREE.MeshStandardMaterial({ map: iceTex, roughness: 0.25, metalness: 0.05, side: THREE.DoubleSide, emissive: '#2a78b0', emissiveIntensity: 0.25 });
  const posts = [];
  const railRuns = [];
  for (const [n, side] of [[0, -1], [1, 1]]) {
    const need = railSide[n];
    const isWall = (i) => edgeT[n][i] === EDGE.wall;
    for (const wallRun of [false, true]) {
      for (const [a, b] of runsOf((i) => need[i] === 1 && isWall(i) === wallRun)) {
        const L = spanList(a, b);
        const lat = (s) => side * railLatAt(s, side);
        for (const m of strip(L, (s) => [[lat(s), -0.6], [lat(s), 1.6]], wallMat, { surface: 'barrier' })) m.visible = false;
        if (wallRun) {
          // 금속 벽: 거의 수직으로 6.5 m, 위는 바깥으로 살짝 (지붕은 풍경 에이전트가 이 위에 얹음)
          const bump = (s, k) => noise(s.dist / 7, k * 3.1 + n * 7, 2);
          strip(
            L,
            (s) => {
              const l = lat(s);
              return [[l, -0.6], [l + side * (0.1 + bump(s, 2) * 0.12), 2.2], [l + side * (0.25 + bump(s, 3) * 0.2), 4.6], [l + side * 0.6, 6.5], [l + side * 3.5, 7.2]];
            },
            iceWallMat,
            { vScale: 6, uScale: 4, shadow: true },
          );
        } else {
          strip(L, (s) => [[lat(s), 0.62], [lat(s), 1.0]], railMat, { vScale: 4 });
          strip(L, (s) => [[lat(s), 0.4], [lat(s), 0.52]], railGlowMat, { vScale: 4 });
          const stepN = mS(3.2);
          for (let k = 0; k < L.length; k += stepN) {
            const s = L[k];
            const p = surf(s, lat(s) + side * 0.12, 0);
            posts.push({ x: p.x, y: p.y, z: p.z, ry: Math.atan2(s.tan.x, s.tan.z) });
          }
        }
        railRuns.push({ side, a, b, wall: wallRun });
      }
    }
  }
  if (posts.length) {
    const postIm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.15, 0.16).translate(0, 0.52, 0), new THREE.MeshStandardMaterial({ color: '#6f7780', metalness: 0.5, roughness: 0.5 }), posts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    posts.forEach((p, i) => {
      q.setFromAxisAngle(UP, p.ry);
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
      postIm.setMatrixAt(i, m4);
    });
    postIm.castShadow = true;
    group.add(postIm);
  }

  // ---------------------------------------------------------------- 지형 높이 준비: 도로 샘플 해시
  const HASH = 20;
  const ckey = (a, b) => (a + 8192) * 16384 + (b + 8192);
  const roadHash = new Map();
  const solid = (s) => !s.gap;
  for (let i = 0; i < SAMPLES; i++) {
    const p = samples[i].pos;
    const k = ckey(Math.floor(p.x / HASH), Math.floor(p.z / HASH));
    if (!roadHash.has(k)) roadHash.set(k, []);
    roadHash.get(k).push(samples[i]);
  }
  function roadNear(x, z, r, fn) {
    const x0 = Math.floor((x - r) / HASH), x1 = Math.floor((x + r) / HASH), z0 = Math.floor((z - r) / HASH), z1 = Math.floor((z + r) / HASH);
    for (let a = x0; a <= x1; a++)
      for (let b = z0; b <= z1; b++) {
        const list = roadHash.get(ckey(a, b));
        if (list) for (const s of list) fn(s);
      }
  }


  const depthAt = () => 0; // (화산과 같은 API: 낭떠러지 깊이 — 이 맵엔 낭떠러지 없음)

  // ---------------------------------------------------------------- 갓길 경사판 (열린 쪽만: 코스 밖 공장 부지에서 다시 올라올 수 있게)
  const SKW = 4.5;
  const skirtOK = [new Uint8Array(SAMPLES), new Uint8Array(SAMPLES)];
  for (let n = 0; n < 2; n++) for (let i = 0; i < SAMPLES; i++) skirtOK[n][i] = !samples[i].gap && !railSide[n][i] && edgeT[n][i] === EDGE.open ? 1 : 0;
  const skirtAt = (i, side) => skirtOK[sideN(side)][wrapI(i)] === 1;
  const snowTex = snowTexture(77);
  {
    // 다져진 눈 갓길 (살짝 회색빛)
    const skirtMat = new THREE.MeshLambertMaterial({ map: snowTex, color: data.palette?.skirt || '#6b777b', side: THREE.DoubleSide });
    const OUT = [[0, 0], [1.5, -0.06], [3.2, -0.16], [SKW, -0.25], [SKW + 2.2, -1.0]];
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

  // ---------------------------------------------------------------- 다리: 도로 판 아래 두꺼운 상판 + 교각 (밑은 공장 수로 골짜기)
  const river = data.river || null;
  const deckMat = new THREE.MeshStandardMaterial({ color: '#8c96a3', roughness: 0.8 });
  const bridgeInfo = [];
  for (const br of bridges) {
    const L = spanList(br.a - mS(3), br.b + mS(3));
    const DE = (s) => Math.max(edgeLat(s, -1), edgeLat(s, 1)) + 0.9;
    strip(L, (s) => [[-DE(s), 0.05], [-DE(s), -1.6], [DE(s), -1.6], [DE(s), 0.05]], deckMat, { vScale: 6, uScale: 4, shadow: true });
    // 교각: 가운데에서 앞뒤로 14 m마다, 상판 밑에서 강바닥 밑까지
    const mid = S(Math.round((br.a + br.b) / 2));
    const floorY = mid.pos.y - (river ? river.depth : 9);
    const pierGeo = new THREE.BoxGeometry(1.6, 1, 2.2);
    for (let k = -2; k <= 2; k++) {
      const s = S(Math.round((br.a + br.b) / 2) + mS(k * 14));
      for (const sd of [-1, 1]) {
        const top = s.pos.y - 1.5, bot = floorY - 3;
        const base = surf(s, sd * (s.hw + 5), 0);
        if (samples.some(q => q.pos.y < s.pos.y - 6 && Math.hypot(q.pos.x-base.x,q.pos.z-base.z) < q.hw+7)) continue;
        const m = new THREE.Mesh(pierGeo, deckMat);
        m.scale.set(1, top - bot, 1);
        m.position.copy(surf(s, sd * (s.hw + 5), 0)).setY((top + bot) / 2);
        m.rotation.y = Math.atan2(s.tan.x, s.tan.z);
        m.castShadow = true;
        group.add(m);
      }
    }
    bridgeInfo.push({ ...br, mid: mid.pos.clone(), floorY });
  }

  // ---------------------------------------------------------------- 지형 높이
  const bb = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
  for (const s of samples) bb.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
  const MARGIN = data.terrainMargin || 400;
  bb.expandByScalar(MARGIN);
  const CG = 40;
  const cgx0 = bb.min.x - CG, cgz0 = bb.min.y - CG;
  const CNXg = Math.ceil((bb.max.x - bb.min.x) / CG) + 3, CNZg = Math.ceil((bb.max.y - bb.min.y) / CG) + 3;
  const coarse = new Float32Array(CNXg * CNZg);
  const coarseD = new Float32Array(CNXg * CNZg); // 코스까지 거리 (먼 곳 황토 언덕 높이용)
  {
    const pts = samples.filter((s, i) => i % 6 === 0 && solid(s) && !onBridge[s.i]);
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
          sy += w * s.pos.y;
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
  /** 황토 언덕: 코스에서 130 m 넘게 떨어지면 솟기 시작해 400 m 밖은 높은 산 (지형 격자 끝을 가림) */
  function mountainH(x, z, df) {
    const rise = smooth(130, 430, df + noise(x / 70, z / 70, 2) * 40);
    if (rise <= 0) return 0;
    const ridge = 1 - Math.abs(noise(x / 230, z / 230, 3));
    return rise * (6 + ridge * ridge * 14);
  }
  /** 자연 지형: 완만한 황토 언덕 + 바람에 쌓인 눈 물결 (도로 영향 없음) */
  function naturalH(x, z, df = farDist(x, z)) {
    const dunes=data.dunes ? smooth(28,100,df)*data.dunes.amplitude*(.5+.5*Math.sin(x/data.dunes.wavelength+Math.sin(z/190)*1.5)) : 0;
    return coarseH(x, z) + noise(x / 120, z / 120, 3) * 3 - 0.5 + noise(x / 16, z / 16, 2) * 0.35 + mountainH(x, z, df)+dunes;
  }
  // 공장 수로 골짜기: 다리 가운데를 직각으로 지나는 긴 골짜기 (바닥 = 다리 도로 − depth)
  const riverFloor = bridgeInfo.length ? bridgeInfo[0].floorY : 0;
  // 금속 벽 가중치 (쪽마다 0~1, 벽 끝 앞뒤 15 m에 걸쳐 부드럽게) → 벽 뒤 언덕 높이가 입구·출구에서 서서히 줄어듦
  const wallW = [0, 1].map((n) => {
    const raw = new Float32Array(SAMPLES), out = new Float32Array(SAMPLES), r = mS(15);
    for (let i = 0; i < SAMPLES; i++) raw[i] = edgeT[n][i] === EDGE.wall ? 1 : 0;
    for (let i = 0; i < SAMPLES; i++) {
      if (raw[i]) {
        out[i] = 1;
        continue;
      }
      let sum = 0;
      for (let j = -r; j <= r; j++) sum += raw[wrapI(i + j)];
      out[i] = Math.min(1, (sum / (2 * r + 1)) * 2);
    }
    return out;
  });
  // 얼어붙은 호수 (풍경이 얼음판·마을을 놓는 자리): 안은 평평하게, 가장자리 30 m에 걸쳐 원래 땅으로. 도로 45 m 안은 건드리지 않음
  const lake = data.lake ? { x: data.lake.x, z: data.lake.z, r: data.lake.r, y: 0 } : null;
  if (lake) lake.y = +(coarseH(lake.x, lake.z) - 0.6).toFixed(2);
  function lakeH(x, z, H, ns, nd) {
    if (!lake) return H;
    const d = Math.hypot(x - lake.x, z - lake.z);
    if (d > lake.r + 32) return H;
    let w = 1 - smooth(lake.r, lake.r + 30, d + noise(x / 25, z / 25, 2) * 4);
    if (ns) w *= smooth(ns.hw + 12, ns.hw + 45, nd);
    if (w <= 0) return H;
    return THREE.MathUtils.lerp(H, lake.y - 0.15, w);
  }
  function riverH(x, z, H, ns, nd) {
    if (!river) return H;
    const dx = x - river.x, dz = z - river.z;
    const a = Math.abs(dx * river.dx + dz * river.dz);
    if (a > river.halfLen) return H;
    const b = Math.abs(-dx * river.dz + dz * river.dx);
    if (b > river.halfW + 20) return H;
    let w = (1 - smooth(river.halfW * 0.55, river.halfW + 10, b + noise(x / 9, z / 9, 2) * 3)) * (1 - smooth(river.halfLen - 90, river.halfLen, a));
    if (ns && !onBridge[ns.i]) w *= smooth(ns.hw + 8, ns.hw + 45, nd); // 다른 도로 근처는 원래 땅
    if (w <= 0) return H;
    const floor = riverFloor + noise(x / 30, z / 30, 2) * 0.3;
    return Math.min(H, THREE.MathUtils.lerp(H, floor, w));
  }
  /** 이 점이 공장 수로 바닥(얼음) 위인지 */
  const onRiverIce = (x, z) => {
    if (!river) return false;
    const dx = x - river.x, dz = z - river.z;
    return Math.abs(dx * river.dx + dz * river.dz) < river.halfLen - 60 && Math.abs(-dx * river.dz + dz * river.dx) < river.halfW * 0.6;
  };
  function terrainH(x, z) {
    const df = farDist(x, z);
    if (df > 160) return { H: riverH(x, z, lakeH(x, z, naturalH(x, z, df), null, Infinity), null, Infinity), nd: df };
    let nd = Infinity, ns = null, under = Infinity;
    roadNear(x, z, 100, (s) => {
      if (!solid(s)) return;
      const dx = x - s.pos.x, dz = z - s.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (onBridge[s.i]) return;
      if (d < nd) (nd = d), (ns = s);
      if (onBridge[s.i]) return; // 다리 밑은 비워 둠 (강 골짜기)
      if (d < s.hw + CURB + 3) {
        const along = dx * s.tan.x + dz * s.tan.z;
        if (Math.abs(along) > 4) return;
        const l = dx * s.right.x + dz * s.right.z;
        const gr = s.tan3.y / (Math.hypot(s.tan3.x, s.tan3.z) || 1);
        const y = roadYAt(s, THREE.MathUtils.clamp(l, -s.hw - CURB, s.hw + CURB)) + gr * along;
        under = Math.min(under, y);
      }
    });
    const nat = naturalH(x, z, df);
    let H;
    let l = 0;
    if (ns) l = (x - ns.pos.x) * ns.right.x + (z - ns.pos.z) * ns.right.z;
    const side = l < 0 ? -1 : 1;
    const eW = ns ? ns.hw + kerbAt(ns.i, side) : HW + CURB;
    if (ns && nd < eW + 1 && under < Infinity) H = under - 0.3;
    else {
      let edgeY = nat, k = 1, sink = 0;
      if (ns) {
        const along = (x - ns.pos.x) * ns.tan.x + (z - ns.pos.z) * ns.tan.z;
        const gr = ns.tan3.y / (Math.hypot(ns.tan3.x, ns.tan3.z) || 1);
        const roadEdge = roadYAt(ns, side * eW) + gr * along;
        const e = edgeAt(ns.i, side);
        const tw = tunnelW[ns.i], ww = wallW[sideN(side)][ns.i];
        if (ww > 0 || tw > 0) {
          // 정비 터널 옆: 연석 끝부터 벽 뒤 6 m까지는 도로 높이 그대로 (5 m 격자 삼각형이 벽 안쪽으로 솟지 않게),
          //   그 뒤에서 벽 높이(+6.5 m × 벽 가중치)로 올라가 옆으로 갈수록 큰 황토 언덕 (터널이 언덕을 뚫고 지나가는 느낌)
          const hill = tw * 22 * (1 - smooth(eW + 60, eW + 170, nd)) * smooth(eW + 6, eW + 40, nd);
          const flatTo = eW + 6.5;
          if (nd < flatTo) H = roadEdge - 0.3;
          else {
            edgeY = roadEdge + 6.5 * ww - 0.3;
            k = smooth(flatTo, eW + 90, nd);
            H = edgeY * (1 - k) + (nat + hill) * k;
          }
        } else {
          edgeY = roadEdge - 0.15;
          const sk = skirtAt(ns.i, side);
          if (sk) sink = 0.45 * (1 - smooth(eW + SKW + 0.5, eW + SKW + 5, nd));
          k = smooth(eW + 1 + (sk ? SKW : 0), eW + 48, nd);
        }
      }
      if (H === undefined) H = edgeY * (1 - k) + nat * k - sink;
      if (under < Infinity) H = Math.min(H, under - 0.1);
    }
    return { H: riverH(x, z, lakeH(x, z, H, ns, nd), ns, nd), nd: ns ? nd : df };
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
  /** 땅 위면 양수 (격자 안은 모두 땅) — gpCorners 표시판이 씀 */
  const fieldAt = (x, z) => (x < gx0 || z < gz0 || x > gx0 + NX * CELL || z > gz0 + NZ * CELL ? -999 : 10);

  // 색: 황토, 푸른 그늘, 가파른 곳은 드러난 회청색 바위, 길가 다져진 눈, 강바닥은 푸른 얼음
  const pal=data.palette;
  const cA = new THREE.Color(pal?.ground?.[0] || '#59626a'), cB = new THREE.Color(pal?.ground?.[1] || '#48555b'), cBlue = new THREE.Color(pal?.ground?.[2] || '#647079');
  const cRock = new THREE.Color(pal?.rock?.[0] || '#39454b'), cRock2 = new THREE.Color(pal?.rock?.[1] || '#4c555b'), cShoulder = new THREE.Color(pal?.shoulder || '#657078'), cIce = new THREE.Color('#53616a'), cTmp = new THREE.Color();
  const yardTex = canvasTexture(512,512,(g,w,h)=>{g.fillStyle='#c5c8c6';g.fillRect(0,0,w,h);const r=seededRandom(83);for(let k=0;k<7500;k++){g.fillStyle=r()>.5?'rgba(20,30,35,.09)':'rgba(255,255,255,.08)';g.fillRect(r()*w,r()*h,1+r()*3,1+r()*3);}g.strokeStyle='#808a8d';g.lineWidth=2;for(let x=0;x<w;x+=128){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();g.beginPath();g.moveTo(0,x);g.lineTo(w,x);g.stroke();}g.fillStyle='#a5abaa';g.fillRect(60,88,55,60);});
  const sandTex=data.palette?.sand?canvasTexture(256,256,(g,w,h)=>{g.fillStyle='#d9cfb7';g.fillRect(0,0,w,h);const r=seededRandom(67);for(let k=0;k<3000;k++){g.fillStyle=k%2?'rgba(100,72,38,.05)':'rgba(255,255,255,.1)';g.fillRect(r()*w,r()*h,2,1);}g.strokeStyle='rgba(102,79,46,.06)';g.lineWidth=2;for(let y=-20;y<h+20;y+=12){g.beginPath();for(let x=0;x<=w;x+=8)g.lineTo(x,y+Math.sin(x*.04+y)*3);g.stroke();}}):null;
  const terrainMat = new THREE.MeshLambertMaterial({ map:sandTex || yardTex, vertexColors: true, flatShading: true, emissive: '#070d17', side: THREE.DoubleSide });
  const terrainColor = (x, y, z, ny, nd) => {
    const n1 = noise(x / 90, z / 90, 3), n2 = noise(x / 13, z / 13, 2);
    cTmp.copy(cA).lerp(cB, THREE.MathUtils.clamp(0.5 + n2 * 0.9, 0, 1));
    cTmp.lerp(cBlue, smooth(0.1, 0.5, n1) * 0.55);
    if (nd < 22) cTmp.lerp(cShoulder, 0.55 * (1 - smooth(8, 22, nd)));
    // 가파른 면: 눈이 못 붙어 바위가 드러남 (산 위쪽은 더)
    if (ny < 0.8) cTmp.lerp(n2 > 0 ? cRock : cRock2, smooth(0.8, 0.5, ny) * 0.85);
    if (onRiverIce(x, z) && y < riverFloor + 1.2) cTmp.copy(cIce).lerp(cA, Math.max(0, n2) * 0.3);
    return cTmp;
  };
  // 코스에서 먼 덩어리(가장 가까운 점도 70 m 넘음)는 3칸씩 건너뛰어 성기게 + 아래로 내린 치마(틈 가림) → 삼각형 줄임
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
        // 치마: 덩어리 네 변을 따라 3 m 아래로 내린 띠 (옆 고운 덩어리와의 틈 가림)
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
      const UV=[];for(let k=0;k<P.length;k+=3)UV.push(P[k]/28,P[k+2]/28);geo.setAttribute('uv',new THREE.Float32BufferAttribute(UV,2));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, terrainMat);
      m.receiveShadow = true;
      m.userData.foundryTerrain = true; // 이름을 안 붙여야 staticBatch가 칸별로 합침 (그림 호출 줄임)
      addGround(m, 'ground');
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
    const gridMat = new THREE.MeshBasicMaterial({ color: '#efe8dc', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
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
    //   (높은 곳·다리 위에서 복귀할 때 도로 밑 땅·강바닥에 놓이지 않게)
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

  function isOnRoad(pos, near = nearest(pos)) {
    return near.dist < near.sample.hw + kerbAt(near.index, near.lateral < 0 ? -1 : 1);
  }
  function edgeInfo(pos, near = nearest(pos)) {
    const hw = near.sample.hw;
    const k = kerbAt(near.index, near.lateral < 0 ? -1 : 1);
    return { ...edgeFraction(near.dist, hw, hw + k), runoff: false };
  }

  const outline = samples.filter((_, i) => i % 6 === 0 && i < SAMPLES).map((s) => [s.pos.x, s.pos.z]);

  // Steady edge lights keep direction marks clear and static batches intact.
  function animate() {}
  const staticStats = batchMapStatics(group, 320);
  const sampleAtTracked = (t) => (lastSampled = sampleAt(t));
  /** 코스 위치 t가 정비 터널 안인지 */
  const inTunnel = (t) => inTunnelI(indexAt(t));
  const buildMs = Math.round(performance.now() - buildT0);

  return {
    staticStats, data, width: W, length, samples, sampleAt: sampleAtTracked, nearest, nearestRaw, castRay, boostPadAt: () => null, animate, outline,
    shortcut: null, shortcutDist: () => Infinity, onShortcut: () => false, isOnRoad, edgeInfo, racingLine, lineY, kerbWidth: CURB, kerbAt, group, groundMeshes,
    arena: false, pad: null, inPad: () => false, spawn: null,
    sea: null, inSea: () => false, waterRanges: [], isWaterT: () => false, buoys: [],
    // gpCorners.js(코너 표시판)가 쓰는 그랑프리 방식 값 (흰 표시판)
    grandprix: true, inSpace: false, surf, roadYAt, heightAt, fieldAt, railLimit, railRuns, railSide, deckHalf: HW + CURB + 1.2, curb: CURB,
    onAltPath: () => false, altPaths: [], runway: null, apron: null, plank: null, rings: [], skyPath: [], inSkyCorridor: () => false,
    indexAt, S, spanList, noise, dimension: null, setWorld() {}, buildMs, sampleCount: SAMPLES,
    offroadColors: ['#f2d6a2', '#dfe8f2', '#c9d6e6', '#ffffff'], apexColor: '#ffd58a',
    // 빙하 전용 (풍경 에이전트용)
    foundry: true, gravityAt: () => 1, halfWidthAt: hwAt, edgeAt, EDGE, depthAt, jumps, terrainBox: bb, strip, mS, wrapI, naturalH, coarseH, farDist, mountainH,
    lake, wallW, tunnels, tunnelW, inTunnel, inTunnelI, bridges: bridgeInfo, onBridge, river, riverFloor, onRiverIce, edgeLat, railLatAt,
  };
}

/** Only these two new maps: flatten immobile art into spatial bins, then bake PBR values.
 * Moving machines, sky, named objects and collision originals keep their own transforms.
 * Collision meshes remain in groundMeshes with the same world matrix after batching.
 */
export function batchMapStatics(root, cell = 280) {
  if (new URLSearchParams(location.search).get('batch') === '0') return null;
  root.updateMatrixWorld(true);
  const list = [], bins = new Map(), p = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.children.length || o.name || !o.visible || Array.isArray(o.material)) return;
    if (o.material.transparent || o.material.isShaderMaterial || o.userData.dynamic || o.userData.noBatch) return;
    if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    for (let a = o.parent; a && a !== root; a = a.parent) if (a.userData.dynamic || a.userData.noBatch || !a.visible || a.isMesh) return;
    list.push(o);
  });
  for (const o of list) {
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    p.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const key = Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell);
    let bin = bins.get(key);
    if (!bin) { bin = new THREE.Group(); root.add(bin); bins.set(key, bin); }
    bin.attach(o);
  }
  const stats = { cells: bins.size, before: list.length, after: 0, batches: 0 };
  for (const bin of bins.values()) { const s = batchLocal(bin, { pbr: true }); stats.batches += s.batches; stats.after += bin.children.length; }
  root.updateMatrixWorld(true);
  return stats;
}

/** Shared soft cloud sprites, drawn in one pass with camera-facing instanced quads. */
export function batchSkyClouds(sky){
 const clouds=sky.children.filter(o=>o.isSprite);if(!clouds.length)return;
 const src=clouds[0].material,mat=new THREE.MeshBasicMaterial({map:src.map,color:src.color,transparent:true,opacity:src.opacity,depthWrite:false,fog:false,side:THREE.DoubleSide});
 mat.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',[
 'vec4 cloudOrigin=vec4(0.,0.,0.,1.);',
 'vec2 cloudScale=vec2(1.);',
 '#ifdef USE_INSTANCING',
 'cloudOrigin=instanceMatrix*cloudOrigin;',
 'cloudScale=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));',
 '#endif',
 'vec4 mvPosition=modelViewMatrix*cloudOrigin;',
 'mvPosition.xy+=transformed.xy*cloudScale;',
 'gl_Position=projectionMatrix*mvPosition;'
 ].join('\n'));};
 mat.customProgramCacheKey=()=> 'mapCloudBillboards1';
 const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),mat,clouds.length);mesh.name='mapCloudBank';mesh.frustumCulled=false;mesh.userData.dynamic=true;
 clouds.forEach((c,i)=>{c.updateMatrix();mesh.setMatrixAt(i,c.matrix);sky.remove(c);});sky.add(mesh);return mesh;
}
