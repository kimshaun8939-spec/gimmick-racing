// 화산 지대 코스 (data/volcano.json, "module": "volcanoMap") — 아주 어려운 1바퀴 약 3분
//
// 달 맵(moonTrack.js)과 같은 방식(높이가 있는 3D 중심선 + 도로 리본)으로 만들고, 화산 기믹을 더함
//   - 구간마다 도로 폭이 다름 (halfWidths): 칼날 능선은 아주 좁음
//   - 길 가장자리 종류 (edges): cliff 낭떠러지(밑은 용암) / wall 바위벽(부딪힘) / rail 가드레일 / lava 바로 옆 용암 웅덩이
//   - 용암 바다 (lavaY): 땅이 이 높이보다 낮은 곳은 모두 용암 (닿으면 복귀, surface 'lava')
//   - 점프 (jumps): 립(lip)에서 도로가 끊기고 용암 협곡을 건너 착지 도로로 (낙하 점프는 착지가 12 m 아래)
//   - 분화구 용암 호수 (craterLake), 경사 코너 (bank)
// 돌려주는 객체는 moonTrack.js / gpTrack.js와 같은 모양 (car.js, main.js, hud 미니맵, racingLineFx, gpCorners가 그대로 씀)
import * as THREE from 'three';
import { computeRacingLine, edgeFraction } from './racingLine.js';
import { canvasTexture, seededRandom, makeNoise } from './moonTrack.js';

export { canvasTexture, seededRandom, makeNoise };

const UP = new THREE.Vector3(0, 1, 0);
const SAMPLE_STEP = 1.9; // 중심선 샘플 간격 (m)
const CELL = 5; // 가까운 지형 격자 한 칸 (m)
const CHUNK = 24; // 지형 메시 덩어리 = 24×24칸
const smooth = (a, b, x) => {
  const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
// 길 가장자리 종류
export const EDGE = { open: 0, cliff: 1, wall: 2, rail: 3, lava: 4 };

// ---------------------------------------------------------------- 텍스처
function roadTexture() {
  // 화산 도로: 검은 아스팔트 + 붉은 화산재 얼룩 + 흰 가장자리 선
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#2b2828';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      const v = 34 + Math.random() * 30;
      g.fillStyle = Math.random() < 0.18 ? `rgba(${v + 40},${v * 0.6},${v * 0.45},0.35)` : `rgba(${v},${v - 2},${v - 3},0.45)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)'; // 금 간 자국
    for (let k = 0; k < 7; k++) {
      let x = Math.random() * w, y = Math.random() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) g.lineTo((x += (Math.random() - 0.5) * 30), (y += Math.random() * 20));
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(10,8,8,0.6)';
      g.stroke();
    }
    g.fillStyle = '#ece6dc';
    g.fillRect(w * 0.025, 0, w * 0.022, h);
    g.fillRect(w * 0.953, 0, w * 0.022, h);
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
function hazardTexture(c1 = '#ffb21f', c2 = '#1d1a18') {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = c1;
    g.fillRect(0, 0, w, h);
    g.fillStyle = c2;
    for (let k = -2; k < 4; k++) {
      g.beginPath();
      g.moveTo(k * 32, 0);
      g.lineTo(k * 32 + 16, 0);
      g.lineTo(k * 32 + 16 + 64, h);
      g.lineTo(k * 32 + 64, h);
      g.fill();
    }
  });
}
/** 용암: 밝은 주황·노랑 갈라진 껍질 사이로 빛나는 흐름 (반복 무늬, 천천히 흐름) */
export function lavaTexture(seed = 5) {
  return canvasTexture(256, 256, (g, w, h) => {
    const r = seededRandom(seed);
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#ff5a00');
    grd.addColorStop(0.5, '#ff9a12');
    grd.addColorStop(1, '#ff4300');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // 밝은 줄기
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(255,${200 + r() * 55},${80 + r() * 90},${0.35 + r() * 0.4})`;
      g.lineWidth = 2 + r() * 5;
      g.beginPath();
      let x = r() * w, y = r() * h;
      g.moveTo(x, y);
      for (let s = 0; s < 5; s++) g.quadraticCurveTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60, (x += (r() - 0.5) * 70), (y += (r() - 0.5) * 70));
      g.stroke();
    }
    // 식어서 검게 굳은 껍질 조각 (반복 경계를 넘어 그려 이음매 없게)
    for (let k = 0; k < 34; k++) {
      const cx = r() * w, cy = r() * h, rad = 6 + r() * 20;
      for (const ox of [-w, 0, w])
        for (const oy of [-h, 0, h]) {
          g.fillStyle = `rgba(${30 + r() * 30},${12 + r() * 10},${8},${0.75})`;
          g.beginPath();
          for (let a = 0; a < 7; a++) {
            const ang = (a / 7) * Math.PI * 2, rr = rad * (0.6 + r() * 0.5);
            g.lineTo(cx + ox + Math.cos(ang) * rr, cy + oy + Math.sin(ang) * rr);
          }
          g.fill();
        }
    }
  });
}
function rockTexture(seed, base, spread) {
  return canvasTexture(128, 128, (g, w, h) => {
    const r = seededRandom(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 1400; k++) {
      const v = spread[0] + Math.floor(r() * spread[1]);
      g.fillStyle = `rgba(${v + 6},${v},${v - 4},0.55)`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    // 세로 금 (현무암 기둥 느낌)
    for (let k = 0; k < 9; k++) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(r() * w, 0, 1 + r() * 2, h);
    }
  });
}

export function buildVolcanoTrack(data, scene) {
  const buildT0 = performance.now();
  const W = data.width;
  const HW = W / 2; // 기본 반폭 (track.width/2)
  const CURB = 1.4;
  const LAVA_Y = data.lavaY ?? -26;
  const noise = makeNoise(20261111);
  const group = new THREE.Group();
  group.name = 'volcanoTrack';
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
    // space: false → gpCorners가 땅 위에 흰 표시판을 세움 (낭떠러지 위에는 안 세움)
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

  // ---------------------------------------------------------------- 레이싱 라인과 넓은 연석
  const KERB_WIDE = 2.6;
  const LINE_MARGIN = 1.15;
  const LINE_PLAIN = 1.0;
  const kerbW = [new Float32Array(SAMPLES).fill(CURB), new Float32Array(SAMPLES).fill(CURB)];
  const kerbAt = (i, side) => kerbW[sideN(side)][wrapI(i)];
  const lineSamples = samples.slice(0, SAMPLES);
  const lineUse = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
  // 점프: 립 60 m 앞부터는 가운데 ±1.2 m로 곧게, 착지 뒤 50 m까지도 곧게
  const centerOnly = new Float32Array(SAMPLES).fill(Infinity);
  for (const j of jumps)
    for (let i = j.lipI - mS(100); i <= j.landI + mS(70); i++)
      centerOnly[wrapI(i)] = Math.min(centerOnly[wrapI(i)], i < j.lipI - mS(55) || i > j.landI + mS(45) ? hwAt(i) - 2.5 : 1.2);
  const lineLimit = (i, side) => {
    const q = wrapI(i);
    const u = lineUse[sideN(side)][q];
    // 낭떠러지·용암 쪽은 0.4 m 더 안쪽으로 (봇이 떨어지지 않게)
    //   낭떠러지·용암 쪽은 연석을 쓰지 않음 (넓은 연석 끝까지 라인이 가면 조금만 밀려도 떨어졌음)
    const e = edgeT[sideN(side)][q];
    const risky = e === EDGE.cliff || e === EDGE.lava;
    const lim = risky ? samples[q].hw - LINE_PLAIN - 0.5 : samples[q].hw - LINE_PLAIN + u * Math.max(0, kerbAt(q, side) - LINE_MARGIN + LINE_PLAIN);
    return Math.min(lim, centerOnly[q]);
  };
  const noWide = (i) => samples[i].gap || centerOnly[i] < samples[i].hw;
  const widen = (i0, i1, side, ramp) => {
    for (let i = i0; i <= i1; i++) {
      const q = wrapI(i);
      const w = smooth(0, ramp, i - i0) * smooth(0, ramp, i1 - i);
      const u = lineUse[sideN(side)];
      u[q] = Math.max(u[q], w);
      if (noWide(q)) continue;
      const ek = edgeT[sideN(side)][q];
      if (ek === EDGE.cliff || ek === EDGE.lava) continue; // 낭떠러지 쪽 연석은 좁은 그대로 (위험 표시)
      const arr = kerbW[sideN(side)];
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
  const racingLine = computeRacingLine(lineSamples, lineLimit, length, { bank: lineSamples.map((s) => s.bank || 0) });
  const lineY = (i, d = 0) => roadYAt(samples[i], racingLine.offset[i] + d);

  // ---------------------------------------------------------------- 도로, 연석
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.92 });
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture('#f1ebe2', '#d0271b'), roughness: 0.8 });
  // 낭떠러지·용암 쪽 연석: 검정/주황 (위험하다는 표시)
  const curbHot = new THREE.MeshStandardMaterial({ map: curbTexture('#1b1715', '#ff7a12'), emissive: '#ff4a00', emissiveIntensity: 0.25, roughness: 0.75 });
  for (const [a, b] of runsOf((i) => hasRoad(i))) strip(spanList(a, b), (s) => [[-s.hw, 0], [s.hw, 0]], roadMat, { vScale: 12, surface: 'ground' });
  const hot = (i, side) => {
    const e = edgeAt(i, side);
    return e === EDGE.cliff || e === EDGE.lava;
  };
  for (const side of [-1, 1]) {
    for (const isHot of [false, true]) {
      for (const [a, b] of runsOf((i) => hasRoad(i) && hot(i, side) === isHot)) {
        const L = spanList(a, b);
        const prof = side < 0 ? (s) => [[-s.hw - kerbAt(s.i, -1), 0.02], [-s.hw, 0.02]] : (s) => [[s.hw, 0.02], [s.hw + kerbAt(s.i, 1), 0.02]];
        strip(L, prof, isHot ? curbHot : curbMat, { vScale: 4, surface: 'ground' });
      }
    }
  }
  const edgeLat = (s, side) => s.hw + kerbAt(s.i, side);

  // ---------------------------------------------------------------- 점프 립: 줄무늬 옆면 + 빛나는 립 끝선
  const hazMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, side: THREE.DoubleSide });
  const lipGlow = new THREE.MeshBasicMaterial({ color: '#ffcf4a', toneMapped: false, side: THREE.DoubleSide });
  const bars = [];
  for (const j of jumps) {
    const L = spanList(j.lipI - mS(30), j.lipI);
    const DE = (s) => s.hw + Math.max(kerbAt(s.i, 1), kerbAt(s.i, -1)) + 0.2;
    strip(L, (s) => [[-DE(s), 0.03], [-DE(s), -4.5], [DE(s), -4.5], [DE(s), 0.03]], hazMat, { vScale: 4, uScale: 4, shadow: true });
    for (const s of [j.lip, j.landS]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * DE(s) + 1.5, 0.18, 0.5), lipGlow);
      bar.position.copy(surf(s, 0, 0.06));
      bar.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.rightB.clone().negate(), s.up, s.tan3));
      group.add(bar);
      bars.push(bar);
    }
    const L2 = spanList(j.landI, j.landI + mS(6));
    strip(L2, (s) => [[-DE(s), 0.03], [-DE(s), -8], [DE(s), -8], [DE(s), 0.03]], hazMat, { vScale: 4, uScale: 4 });
  }

  // ---------------------------------------------------------------- 막힌 가장자리 (가드레일·바위벽): car.keepInsideRail이 씀
  const railSide = [new Uint8Array(SAMPLES), new Uint8Array(SAMPLES)];
  const setRail = (a, b, side) => {
    for (let i = a; i <= b; i++) {
      const q = wrapI(i);
      if (samples[q].gap) continue;
      if (side <= 0) railSide[0][q] = 1;
      if (side >= 0) railSide[1][q] = 1;
    }
  };
  // 점프 립 앞 35 m·착지 뒤 30 m는 가드레일 (립 바로 앞에서 낭떠러지로 떨어지는 건 너무 가혹)
  for (const j of jumps) {
    setRail(j.lipI - mS(35), j.lipI, 0);
    setRail(j.landI, j.landI + mS(30), 0);
  }
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
  const railMat = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  const railGlowMat = new THREE.MeshBasicMaterial({ color: '#ff8a2a', toneMapped: false, side: THREE.DoubleSide });
  const rockWallTex = rockTexture(31, '#2a2522', [22, 34]);
  rockWallTex.repeat.set(1, 1);
  const rockWallMat = new THREE.MeshStandardMaterial({ map: rockWallTex, roughness: 0.95, side: THREE.DoubleSide, color: '#8a7f78' });
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
          // 바위벽: 울퉁불퉁하게 바깥으로 기울어 올라감 (높이 4.5~6.5 m)
          const bump = (s, k) => noise(s.dist / 9, k * 3.1 + n * 7, 2);
          strip(
            L,
            (s) => {
              const l = lat(s), h = 5.5 + bump(s, 1) * 2;
              const pts = [[l, -0.6], [l + side * (0.15 + bump(s, 2) * 0.25), 1.4], [l + side * (0.7 + bump(s, 3) * 0.5), 3.2], [l + side * 2.2, h], [l + side * 6, h + 1.5]];
              return side < 0 ? pts : pts;
            },
            rockWallMat,
            { vScale: 6, uScale: 4, shadow: true, name: 'volcanoRockWall' },
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
    const postIm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.15, 0.16).translate(0, 0.52, 0), new THREE.MeshStandardMaterial({ color: '#6f6a66', metalness: 0.5, roughness: 0.5 }), posts.length);
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

  // 낭떠러지 깊이: 그 쪽 30~90 m 안에 (코스로 200 m 넘게 떨어진) 더 낮은 도로가 있으면 그 높이까지만 (지그재그 오르막),
  //   없으면 용암까지. data.edges의 5번째 값(숫자)이 있으면 그것
  const cliffDepth = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
  const lavaDeep = (s) => s.pos.y - (LAVA_Y - 7);
  for (let n = 0; n < 2; n++) {
    const sd = n ? 1 : -1;
    for (let i = 0; i < SAMPLES; i++) {
      if (edgeT[n][i] !== EDGE.cliff) continue;
      const s = samples[i];
      if (!Number.isNaN(edgeDepth[n][i])) {
        cliffDepth[n][i] = edgeDepth[n][i];
        continue;
      }
      let lower = -Infinity;
      if (i % 3 === 0 || i === 0) {
        const px = s.pos.x + s.right.x * sd * 45, pz = s.pos.z + s.right.z * sd * 45;
        roadNear(px, pz, 45, (o) => {
          let gap = Math.abs(o.i - i);
          gap = Math.min(gap, SAMPLES - gap) * (length / SAMPLES);
          if (gap < 200) return;
          const dx = o.pos.x - s.pos.x, dz = o.pos.z - s.pos.z;
          const l = (dx * s.right.x + dz * s.right.z) * sd;
          if (l < 15 || l > 95) return;
          if (o.pos.y < s.pos.y && o.pos.y > lower) lower = o.pos.y;
        });
        cliffDepth[n][i] = lower > -Infinity ? Math.max(6, s.pos.y - lower - 2.5) : lavaDeep(s); // 적어도 6 m (떨어지면 확실히 복귀)
      } else cliffDepth[n][i] = cliffDepth[n][i - (i % 3)];
    }
    // 부드럽게 (깊이가 갑자기 바뀌지 않게)
    const r = mS(10), src = cliffDepth[n].slice();
    for (let i = 0; i < SAMPLES; i++) {
      if (edgeT[n][i] !== EDGE.cliff) continue;
      let sum = 0, cnt = 0;
      for (let j = -r; j <= r; j++) {
        const q = wrapI(i + j);
        if (edgeT[n][q] !== EDGE.cliff) continue;
        sum += src[q];
        cnt++;
      }
      cliffDepth[n][i] = sum / cnt;
    }
  }
  const depthAt = (i, side) => cliffDepth[sideN(side)][wrapI(i)];

  // ---------------------------------------------------------------- 갓길 경사판 (열린 쪽만: 코스 밖에서 다시 올라올 수 있게)
  const SKW = 4.5;
  const skirtOK = [new Uint8Array(SAMPLES), new Uint8Array(SAMPLES)];
  {
    const nearGap = new Uint8Array(SAMPLES);
    const g = mS(12);
    for (let i = 0; i < SAMPLES; i++) if (samples[i].gap) for (let k = -g; k <= g; k++) nearGap[wrapI(i + k)] = 1;
    for (let n = 0; n < 2; n++) for (let i = 0; i < SAMPLES; i++) skirtOK[n][i] = !nearGap[i] && !railSide[n][i] && edgeT[n][i] === EDGE.open ? 1 : 0;
  }
  const skirtAt = (i, side) => skirtOK[sideN(side)][wrapI(i)] === 1;
  const ashTex = rockTexture(77, '#3b3532', [40, 30]);
  {
    const skirtMat = new THREE.MeshLambertMaterial({ map: ashTex, side: THREE.DoubleSide });
    const OUT = [[0, 0], [1.5, -0.06], [3.2, -0.16], [SKW, -0.25], [SKW + 2.2, -1.6]];
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
        strip(spanList(a, b), prof, skirtMat, { vScale: 10, uScale: 6, surface: 'ground', name: 'volcanoSkirt' });
      }
    }
  }

  // ---------------------------------------------------------------- 낭떠러지 벽면 (도로 끝에서 아래로 거의 수직) + 바로 옆 용암 웅덩이
  const cliffTex = rockTexture(53, '#4a3a33', [18, 30]);
  const cliffMat = new THREE.MeshStandardMaterial({ map: cliffTex, roughness: 1, side: THREE.DoubleSide, color: '#9a8c84' });
  // 아래쪽이 용암 빛을 받아 붉게: 꼭짓점 색 대신 emissive 그라데이션 텍스처 (위 검정 → 아래 주황)
  //   strip의 u = 단면 점 순서(0 = 도로 끝, 1 = 바닥), v = 도로 거리 → 그라데이션은 가로(u) 방향. 왼쪽은 단면을 뒤집어 넣으므로 텍스처도 뒤집은 재질
  const glowTex = canvasTexture(128, 4, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#2a120b');
    grd.addColorStop(0.4, '#3a1408');
    grd.addColorStop(0.75, '#7a2000');
    grd.addColorStop(1, '#ff4a00');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, false);
  cliffMat.emissive = new THREE.Color('#ffffff');
  cliffMat.emissiveMap = glowTex;
  cliffMat.emissiveIntensity = 0.75;
  const cliffMatL = cliffMat.clone();
  cliffMatL.emissiveMap = glowTex.clone();
  cliffMatL.emissiveMap.wrapS = THREE.RepeatWrapping;
  cliffMatL.emissiveMap.repeat.set(-1, 1);
  cliffMatL.emissiveMap.offset.set(1, 0);
  cliffMatL.emissiveMap.needsUpdate = true;
  const lavaTex = lavaTexture(9);
  lavaTex.repeat.set(1, 1);
  const lavaMat = new THREE.MeshBasicMaterial({ map: lavaTex, color: '#ffffff', toneMapped: false });
  const lavaPoolMat = new THREE.MeshBasicMaterial({ map: lavaTex, color: '#ffffff', toneMapped: false });
  for (const sd of [-1, 1]) {
    // 낭떠러지: 연석 끝 → 0.5 m 바깥으로 1.5 m 내려가고 → 거의 수직으로 깊이만큼
    for (const [a, b] of runsOf((i) => hasRoad(i) && edgeAt(i, sd) === EDGE.cliff && !railSide[sideN(sd)][i])) {
      const L = spanList(a - 1, b + 1);
      const prof = (s) => {
        const e = edgeLat(s, sd), d = Math.min(depthAt(s.i, sd) + 3, 90);
        const pts = [[sd * e, 0.02], [sd * (e + 0.35), -1.2], [sd * (e + 0.9), -d * 0.45], [sd * (e + 2.2), -d]];
        return sd < 0 ? pts.reverse() : pts;
      };
      strip(L, prof, sd < 0 ? cliffMatL : cliffMat, { vScale: 10, shadow: false, name: 'volcanoCliff' });
      // 보이지 않는 벽: 도로 끝 바로 아래 (0.4 m 밑부터 12 m 밑까지) → 비탈로 미끄러진 차가 도로 판 밑으로 파고들지 못함
      for (const m of strip(L, (s) => [[sd * edgeLat(s, sd), -0.4], [sd * edgeLat(s, sd), -12]], wallMat, { surface: 'barrier', chunk: 30 })) m.visible = false;
    }
    // 용암 웅덩이: 연석 끝 0.6 m 바깥, 도로보다 1.4 m 아래 (빠지면 바로 복귀)
    for (const [a, b] of runsOf((i) => hasRoad(i) && edgeAt(i, sd) === EDGE.lava)) {
      const L = spanList(a, b);
      const lip = (s) => {
        const e = edgeLat(s, sd);
        const pts = [[sd * e, 0.02], [sd * (e + 0.25), -0.8], [sd * (e + 0.6), -1.7]];
        return sd < 0 ? pts.reverse() : pts;
      };
      strip(L, lip, sd < 0 ? cliffMatL : cliffMat, { vScale: 6, name: 'volcanoPoolLip' });
      const pool = (s) => {
        const e = edgeLat(s, sd);
        const pts = [[sd * (e + 0.3), -1.4], [sd * (e + 30), -1.4]];
        return sd < 0 ? pts.reverse() : pts;
      };
      strip(L, pool, lavaPoolMat, { vScale: 30, uScale: 30, surface: 'lava', name: 'volcanoLavaPool' });
    }
  }

  // ---------------------------------------------------------------- 지형 높이
  const bb = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
  for (const s of samples) bb.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
  const MARGIN = data.terrainMargin || 300;
  bb.expandByScalar(MARGIN);
  const CG = 40;
  const cgx0 = bb.min.x - CG, cgz0 = bb.min.y - CG;
  const CNXg = Math.ceil((bb.max.x - bb.min.x) / CG) + 3, CNZg = Math.ceil((bb.max.y - bb.min.y) / CG) + 3;
  const coarse = new Float32Array(CNXg * CNZg);
  {
    const pts = samples.filter((s, i) => i % 6 === 0 && solid(s));
    for (let j = 0; j < CNZg; j++)
      for (let i = 0; i < CNXg; i++) {
        const x = cgx0 + i * CG, z = cgz0 + j * CG;
        let sw = 0.00002, sy = 0;
        for (const s of pts) {
          const d2 = (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2 + 900;
          const w = 1 / (d2 * Math.sqrt(d2));
          sw += w;
          sy += w * s.pos.y;
        }
        coarse[j * CNXg + i] = sy / sw;
      }
  }
  function coarseH(x, z) {
    const fi = THREE.MathUtils.clamp((x - cgx0) / CG, 0, CNXg - 1.001), fj = THREE.MathUtils.clamp((z - cgz0) / CG, 0, CNZg - 1.001);
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const g = (a, b) => coarse[b * CNXg + a];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(g(i, j), g(i + 1, j), u), THREE.MathUtils.lerp(g(i, j + 1), g(i + 1, j + 1), u), v);
  }
  // 분화구 용암 호수
  const lake = data.craterLake || null;
  function lakeH(x, z, H) {
    if (!lake) return H;
    const d = Math.hypot(x - lake.x, z - lake.z) + noise(x / 14, z / 14, 2) * 5;
    if (d > lake.r + 26) return H;
    const floor = LAVA_Y - 9;
    const w = 1 - smooth(lake.r * 0.9, lake.r + 26, d);
    return Math.min(H, THREE.MathUtils.lerp(H, floor, w));
  }
  /** 자연 지형: 울퉁불퉁한 현무암 들판 + 낮은 언덕 (도로 영향 없음) */
  function naturalH(x, z) {
    const ridge = 1 - Math.abs(noise(x / 160, z / 160, 3)); // 날카로운 산등성이 무늬
    return coarseH(x, z) + noise(x / 70, z / 70, 3) * 5 + ridge * ridge * 9 - 3 + noise(x / 15, z / 15, 2) * 0.9;
  }
  // 점프 협곡: 립과 착지 사이를 가로지르는 깊은 골짜기 (바닥은 용암 아래)
  const chasms = jumps.map((j) => {
    const a = j.lip, b = j.landS;
    const mid = a.pos.clone().lerp(b.pos, 0.5);
    const along = b.pos.clone().sub(a.pos).setY(0);
    const len = along.length();
    along.normalize();
    const across = new THREE.Vector3(-along.z, 0, along.x);
    return { mid, along, across, halfLen: len / 2 - 0.6, halfW: j.chasmHalfWidth || 60, floor: LAVA_Y - 10 };
  });
  function chasmH(x, z, H) {
    let out = H;
    for (const c of chasms) {
      const dx = x - c.mid.x, dz = z - c.mid.z;
      const a = Math.abs(dx * c.along.x + dz * c.along.z), b = Math.abs(dx * c.across.x + dz * c.across.z);
      const wa = 1 - smooth(c.halfLen - 0.5, c.halfLen + 3 + Math.max(0, b - c.halfW * 0.6) * 0.5, a);
      const wb = 1 - smooth(c.halfW * 0.75, c.halfW + 8, b + noise(x / 9, z / 9, 2) * 6);
      const w = Math.min(wa, wb);
      if (w <= 0) continue;
      const floor = c.floor + noise(x / 11, z / 11, 2) * 3;
      out = Math.min(out, THREE.MathUtils.lerp(H, floor, w));
    }
    return out;
  }
  function terrainH(x, z) {
    let nd = Infinity, ns = null, under = Infinity;
    roadNear(x, z, 100, (s) => {
      if (!solid(s)) return;
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
    const nat = naturalH(x, z);
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
        if (e === EDGE.cliff && !railSide[sideN(side)][ns.i]) {
          // 낭떠러지: 바로 깊이만큼 떨어지고, 아주 멀리서야 원래 땅으로 (용암까지면 넓은 용암 골짜기)
          const dep = depthAt(ns.i, side);
          edgeY = roadEdge - dep;
          k = smooth(eW + 0.4, eW + (dep > 30 ? 110 : 45), nd);
        } else if (e === EDGE.lava) {
          edgeY = roadEdge - 3.2; // 용암 웅덩이 밑 (웅덩이 면은 도로 −1.4 m)
          k = smooth(eW + 24, eW + 40, nd);
        } else if (e === EDGE.wall) {
          edgeY = roadEdge + 5; // 바위벽 뒤 산비탈
          k = smooth(eW + 3, eW + 40, nd);
        } else {
          edgeY = roadEdge - 0.15;
          const sk = skirtAt(ns.i, side);
          if (sk) sink = 0.45 * (1 - smooth(eW + SKW + 0.5, eW + SKW + 5, nd));
          k = smooth(eW + 1 + (sk ? SKW : 0), eW + 42, nd);
        }
      }
      H = edgeY * (1 - k) + nat * k - sink;
      if (under < Infinity) H = Math.min(H, under - 0.1);
    }
    return { H: lakeH(x, z, chasmH(x, z, H)), nd: ns ? nd : Infinity };
  }

  // ---------------------------------------------------------------- 지형 메시 (가까운 격자, 충돌 있음)
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
  /** 땅 위(용암 위로 솟은 곳)면 양수 */
  const fieldAt = (x, z) => {
    if (x < gx0 || z < gz0 || x > gx0 + NX * CELL || z > gz0 + NZ * CELL) return -999;
    return heightAt(x, z) > LAVA_Y + 0.6 ? 10 : -10;
  };

  // 색: 검은 현무암, 붉은 화산재, 용암 가까운 곳은 붉게 달아오름, 가파른 면은 더 검게
  const cA = new THREE.Color('#463d38'), cB = new THREE.Color('#62544b'), cAsh = new THREE.Color('#8a5a42');
  const cHot = new THREE.Color('#ff5a1a'), cDark = new THREE.Color('#3e2f29'), cShoulder = new THREE.Color('#544a44'), cSul = new THREE.Color('#9c8a3a'), cTmp = new THREE.Color();
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#2a0c05' });
  const terrainColor = (x, y, z, ny, nd) => {
    const n1 = noise(x / 90, z / 90, 3), n2 = noise(x / 13, z / 13, 2);
    cTmp.copy(cA).lerp(cB, THREE.MathUtils.clamp(0.5 + n2 * 0.9, 0, 1));
    cTmp.lerp(cAsh, smooth(0.1, 0.45, n1) * 0.65);
    if (n2 > 0.55) cTmp.lerp(cSul, 0.35); // 유황 얼룩
    if (nd < 30) cTmp.lerp(cShoulder, 0.5 * (1 - smooth(8, 30, nd)));
    if (ny < 0.75) cTmp.lerp(cDark, smooth(0.75, 0.35, ny) * 0.6);
    // 용암 근처 (높이가 용암에 가까울수록) 달아오름
    const hot = 1 - smooth(LAVA_Y, LAVA_Y + 9, y);
    if (hot > 0) cTmp.lerp(cHot, hot * 0.55);
    return cTmp;
  };
  for (let cj = 0; cj < NZ; cj += CHUNK)
    for (let ci = 0; ci < NX; ci += CHUNK) {
      const i1 = Math.min(NX, ci + CHUNK), j1 = Math.min(NZ, cj + CHUNK);
      const P = [], C = [];
      for (let j = cj; j < j1; j++)
        for (let i = ci; i < i1; i++) {
          const v = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => [gx0 + a * CELL, HG[gi(a, b)], gz0 + b * CELL, ND[gi(a, b)]]);
          // 모두 용암 밑이면 그리지 않음 (용암 면이 덮음)
          if (v.every((q) => q[1] < LAVA_Y - 0.5)) continue;
          for (const tri of [[0, 2, 1], [0, 3, 2]]) {
            const [p, q, r] = tri.map((k) => v[k]);
            P.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
            const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], wx = r[0] - p[0], wy = r[1] - p[1], wz = r[2] - p[2];
            const nx = uy * wz - uz * wy, nyy = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            const ny = nyy / (Math.hypot(nx, nyy, nz) || 1);
            const c = terrainColor((p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3, Math.abs(ny), Math.min(p[3], q[3], r[3]));
            for (let k = 0; k < 3; k++) C.push(c.r, c.g, c.b);
          }
        }
      if (!P.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, terrainMat);
      m.receiveShadow = true;
      m.userData.volcanoTerrain = true; // 이름을 안 붙여야 staticBatch가 칸별로 합침 (그림 호출 줄임)
      addGround(m, 'ground');
    }

  // ---------------------------------------------------------------- 용암 바다 (지형 격자 전체를 덮는 넓은 판, 닿으면 복귀)
  const lavaSea = (() => {
    const w = NX * CELL + 400, h = NZ * CELL + 400;
    const geo = new THREE.PlaneGeometry(w, h, 8, 8).rotateX(-Math.PI / 2);
    const t = lavaTexture(21);
    t.repeat.set(w / 60, h / 60);
    const mat = new THREE.MeshBasicMaterial({ map: t, color: '#ffffff', toneMapped: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(gx0 + (NX * CELL) / 2, LAVA_Y, gz0 + (NZ * CELL) / 2);
    m.name = 'volcanoLava';
    addGround(m, 'lava');
    return { mesh: m, tex: t, mat };
  })();

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
    // placeAt(높이 30에서 아래로 60 m): 이 맵은 도로가 66 m까지 올라가서, 고른 코스 지점 바로 위에서 쏨
    //   (안 그러면 높은 산길에서 복귀할 때 도로 밑 땅·용암에 놓였음)
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

  function animate(time) {
    lavaSea.tex.offset.set(time * 0.006, time * 0.011);
    lavaTex.offset.set(time * 0.01, -time * 0.02);
    const pulse = 0.85 + Math.sin(time * 1.3) * 0.08 + Math.sin(time * 3.7) * 0.04;
    lavaSea.mat.color.setScalar(pulse);
    lavaPoolMat.color.setScalar(pulse);
    cliffMat.emissiveIntensity = cliffMatL.emissiveIntensity = 0.75 + Math.sin(time * 1.3) * 0.1;
    lipGlow.color.setHSL(0.11, 1, 0.55 + Math.sin(time * 6) * 0.15);
  }
  const sampleAtTracked = (t) => (lastSampled = sampleAt(t));
  const buildMs = Math.round(performance.now() - buildT0);

  return {
    data, width: W, length, samples, sampleAt: sampleAtTracked, nearest, nearestRaw, castRay, boostPadAt: () => null, animate, outline,
    shortcut: null, shortcutDist: () => Infinity, onShortcut: () => false, isOnRoad, edgeInfo, racingLine, lineY, kerbWidth: CURB, kerbAt, group, groundMeshes,
    arena: false, pad: null, inPad: () => false, spawn: null,
    sea: null, inSea: () => false, waterRanges: [], isWaterT: () => false, buoys: [],
    // gpCorners.js(코너 표시판)가 쓰는 그랑프리 방식 값 (흰 표시판)
    grandprix: true, inSpace: false, surf, roadYAt, heightAt, fieldAt, railLimit, railRuns, railSide, deckHalf: HW + CURB + 1.2, curb: CURB,
    onAltPath: () => false, altPaths: [], runway: null, apron: null, plank: null, rings: [], skyPath: [], inSkyCorridor: () => false,
    indexAt, S, spanList, noise, dimension: null, setWorld() {}, buildMs, sampleCount: SAMPLES,
    offroadColors: ['#3a3330', '#4d423b', '#2a2523', '#6b4a3a'], apexColor: '#ff9a2a',
    // 화산 전용
    volcano: true, lavaY: LAVA_Y, halfWidthAt: hwAt, edgeAt, EDGE, depthAt, jumps, chasms, lake, naturalH, coarseH, terrainBox: bb, strip, mS, wrapI, lavaSea,
  };
}
