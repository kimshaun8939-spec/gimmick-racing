// 달 중력 기지 코스 (data/moon.json, "module": "moonMap")
//
// 구름섬 그랑프리(gpTrack.js)와 같은 방식(높이가 있는 3D 중심선 + 도로 리본)으로 만들고, 달 기믹을 더함
//   - 지형: 달 표면 높이 격자 (회색 레골리스, 크레이터). 도로 옆은 도로 높이에 맞춰 부드럽게 이어짐
//   - 저중력 점프 (jumps): 립(lip)에서 도로가 끊기고 협곡/크레이터를 건너 착지 도로로. 립 직전은 kick 각도로 살짝 들림
//   - 중력 구역 (gravity): 코스 구간마다 중력 배수. car.js가 track.gravityAt(pos)로 씀 (저중력 0.3~0.45, 고중력 1.9)
//   - 중력 반전 코르크스크루 (roll): 자석 도로(surface 'magnet')가 축을 따라 한 바퀴(360°) 비틀림 → 벽 → 천장 → 벽 → 바닥
//     양옆에 보이지 않는 벽 + 유리 난간, 바깥에 유리 튜브
//   - 뱅크 코너 (bank): 크레이터 테두리를 도는 기울어진 코너
// 돌려주는 객체는 gpTrack.js와 같은 모양 (car.js, main.js, hud 미니맵, racingLineFx, gpCorners가 그대로 씀)
import * as THREE from 'three';
import { computeRacingLine, edgeFraction } from './racingLine.js';

const UP = new THREE.Vector3(0, 1, 0);
const SAMPLE_STEP = 1.9; // 중심선 샘플 간격 (m)
const CELL = 5; // 가까운 지형 격자 한 칸 (m)
const CHUNK = 24; // 지형 메시 덩어리 = 24×24칸
const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

// ---------------------------------------------------------------- 공용 도우미 (다른 moon 파일도 씀)
export function canvasTexture(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
export function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function makeNoise(seed) {
  const rand = seededRandom(seed);
  const perm = new Uint8Array(512), val = new Float32Array(256);
  for (let i = 0; i < 256; i++) (perm[i] = i), (val[i] = rand() * 2 - 1);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (x, z) => val[perm[(x & 255) + perm[z & 255]]];
  const noise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
    const a = v(xi, zi), b = v(xi + 1, zi), c = v(xi, zi + 1), d = v(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return (x, z, oct = 3) => {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += noise(x * f + o * 17.3, z * f - o * 9.1) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return s / norm;
  };
}

// ---------------------------------------------------------------- 텍스처
function roadTexture() {
  // 달 기지 도로: 짙은 회색 콘크리트 판 + 흰 가장자리 선
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3a3c42';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 48 + Math.random() * 34;
      g.fillStyle = `rgba(${v},${v},${v + 5},0.4)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(20,22,26,0.55)'; // 판 이음매
    g.fillRect(0, 0, w, 2);
    g.fillRect(w / 2 - 1, 0, 2, h);
    g.fillStyle = '#eef1f6';
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
    g.fillStyle = 'rgba(0,0,0,0.12)';
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
function hazardTexture(c1 = '#ffcf3f', c2 = '#1d1f24') {
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
/** 자석 도로: 보라색 육각 패널 + 빛나는 화살표 */
function magnetTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#251a46';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,120,255,0.55)';
    g.lineWidth = 3;
    const r = 22;
    for (let y = 0; y < h + r; y += r * 1.5)
      for (let x = 0; x < w + r; x += r * Math.sqrt(3)) {
        const ox = (Math.round(y / (r * 1.5)) % 2) * r * Math.sqrt(3) * 0.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU + Math.PI / 6;
          g.lineTo(x + ox + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.closePath();
        g.stroke();
      }
    g.fillStyle = '#d6c4ff';
    g.fillRect(w * 0.03, 0, w * 0.03, h);
    g.fillRect(w * 0.94, 0, w * 0.03, h);
    g.fillStyle = 'rgba(200,160,255,0.85)';
    for (const y0 of [0.15, 0.6]) {
      g.beginPath();
      g.moveTo(w * 0.32, h * (y0 + 0.25));
      g.lineTo(w * 0.5, h * y0);
      g.lineTo(w * 0.68, h * (y0 + 0.25));
      g.lineTo(w * 0.6, h * (y0 + 0.25));
      g.lineTo(w * 0.5, h * (y0 + 0.12));
      g.lineTo(w * 0.4, h * (y0 + 0.25));
      g.fill();
    }
  });
}

export function buildMoonTrack(data, scene) {
  const buildT0 = performance.now();
  const W = data.width;
  const HW = W / 2;
  const CURB = 1.6;
  const noise = makeNoise(20261110);
  const group = new THREE.Group();
  group.name = 'moonTrack';
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
    samples.push({ t, i, pos, tan, tan3, right, dist: t * length, bank: 0, gap: false, roll: false, magnet: false, space: true, bridge: null, land: true, grav: 1, zone: null });
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

  // ---------------------------------------------------------------- 점프: 립 앞은 kick 각도로 들고, 립~착지 사이는 도로 없음
  const jumps = (data.jumps || []).map((j) => {
    const lipI = indexAt(j.lip);
    let landI = indexAt(j.land);
    if (landI < lipI) landI += SAMPLES;
    // 립 직전 kickLen m: 높이를 2차 곡선으로 바꿔 립에서 기울기가 kick°가 되게 (시작점 높이·기울기는 그대로 이어짐)
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
    // 립 샘플부터 '도로 없음' 표시 (도로 리본은 립 샘플까지 이어지고 그 뒤는 끊김)
    for (let i = lipI; i < landI; i++) {
      const u = (i - lipI) / (landI - lipI);
      S(i).pos.y = THREE.MathUtils.lerp(lipY, landY, u);
      S(i).gap = true;
      S(i).land = false;
    }
    const lip = S(lipI), land = S(landI);
    return { ...j, lipI: wrapI(lipI), landI: wrapI(landI), lip, landS: land, gapLen: (landI - lipI) * ds, lipY, landY, kickN };
  });
  // 높이를 바꿨으니 접선 다시 (립 부근)
  for (const j of jumps)
    for (let k = -j.kickN - 3; k <= 3; k++) {
      const s = S(j.lipI + k);
      if (s.gap) continue;
      const p = S(j.lipI + k - 1).gap ? s.pos : S(j.lipI + k - 1).pos, n = S(j.lipI + k + 1).gap ? s.pos : S(j.lipI + k + 1).pos;
      s.tan3 = n.clone().sub(p).normalize();
    }

  // ---------------------------------------------------------------- 뱅크 (gpTrack과 같은 방식: 구간 전체가 한 방향으로만 기울어짐)
  const heading = (s) => Math.atan2(s.tan.x, s.tan.z);
  const turnSign = samples.map((s, i) => {
    let d = heading(S(i + 10)) - heading(S(i - 10));
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
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

  // ---------------------------------------------------------------- 중력 반전 루프: 자석 도로가 세로로 한 바퀴 (천장을 거꾸로 달림)
  //   예전 코르크스크루(옆으로 비틀기)는 벽을 달릴 때 car.js wallGravity가 차를 옆으로 끌어내려 떨어졌음
  //   세로 루프는 '아래 방향'이 늘 진행 방향 앞뒤라 옆으로 끌리지 않음 (자석 도로에서는 오르막 감속도 없음)
  //   모양: x = kφ + (R+k)·sinφ, y = R(1−cosφ)  (k = 바닥 길이/2π) → 꼭대기 반지름 R, 바닥은 완만
  //   옆으로 shift만큼 비켜 가며 돌고(입구와 출구가 겹치지 않게), 앞뒤 jog m 동안 옆으로 shift/2씩 미리 비켜 둠
  const loopD = data.loop || null;
  let roll = null;
  if (loopD) {
    const [a, b] = rangeI(loopD.t0, loopD.t1);
    const R = loopD.radius ?? 13, w = loopD.shift ?? 20;
    const pad = mS(loopD.magnetPad ?? 24); // 앞뒤로 자석 도로를 조금 더 (기울기 전에 자석에 붙도록)
    const jog = mS(loopD.jog ?? 65);
    const P0 = S(a).pos.clone(), P1 = S(b).pos.clone();
    const F = P1.clone().sub(P0).setY(0);
    const L = F.length();
    F.normalize();
    const Rt = new THREE.Vector3().crossVectors(F, UP).normalize();
    const k = L / TAU;
    const loopXY = (ph, out = new THREE.Vector3()) =>
      out.copy(P0)
        .addScaledVector(F, k * ph + (R + k) * Math.sin(ph))
        .addScaledVector(UP, R * (1 - Math.cos(ph)) + ((P1.y - P0.y) * ph) / TAU);
    // 길이가 고르게 되도록 φ ↔ 호 길이 표 (옆 이동 빼고 세로 면 위 길이)
    const NT = 2000, cum = new Float32Array(NT + 1);
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    loopXY(0, pa);
    for (let j = 1; j <= NT; j++) {
      loopXY((j / NT) * TAU, pb);
      cum[j] = cum[j - 1] + pa.distanceTo(pb);
      pa.copy(pb);
    }
    // 옆 이동은 호 길이에 정비례 → 루프 면을 펼치면 곧은 비스듬한 선 = 핸들을 안 꺾어도 그대로 따라가는 길
    const slope = w / cum[NT]; // 1 m 갈 때 옆으로 가는 거리
    const latAt = (ph) => {
      const f = THREE.MathUtils.clamp((ph / TAU) * NT, 0, NT - 1e-6), j = Math.floor(f);
      return w * ((cum[j] + (cum[j + 1] - cum[j]) * (f - j)) / cum[NT]) - w / 2;
    };
    const loopPt = (ph, out = new THREE.Vector3()) => loopXY(ph, out).addScaledVector(Rt, latAt(ph));
    const phiAt = (u) => {
      const want = u * cum[NT];
      let lo = 0, hi = NT;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (cum[m] < want) lo = m;
        else hi = m;
      }
      const f = (want - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
      return ((lo + f) / NT) * TAU;
    };
    // 앞뒤 옆 비키기 (에르미트 곡선: 루프 입구·출구에서 옆 기울기 slope와 이어지게)
    const J = jog * (length / SAMPLES);
    const h01 = (t) => -2 * t ** 3 + 3 * t * t, h11 = (t) => t ** 3 - t * t, h00 = (t) => 1 - h01(t), h10 = (t) => t ** 3 - 2 * t * t + t;
    for (let i = a - jog; i < a; i++) {
      const t = (i - (a - jog)) / jog;
      S(i).pos.addScaledVector(S(i).right, h01(t) * (-w / 2) + h11(t) * J * slope);
    }
    for (let i = b + 1; i <= b + jog; i++) {
      const t = (i - b) / jog;
      S(i).pos.addScaledVector(S(i).right, h00(t) * (w / 2) + h10(t) * J * slope);
    }
    for (let i = a; i <= b; i++) {
      const s = S(i);
      const u = (i - a) / (b - a);
      const ph = phiAt(u);
      // base = 라인 계산용 '펴진' 위치 (바닥 높이 그대로 앞으로 곧게, 옆 비키기만)
      s.base = P0.clone().addScaledVector(F, L * u).addScaledVector(Rt, latAt(ph));
      s.base.y = THREE.MathUtils.lerp(P0.y, P1.y, u);
      loopPt(ph, s.pos);
      s.roll = true;
      s.rollU = u;
      s.loopPhi = ph;
      s.land = false;
    }
    for (let i = a - pad; i <= b + pad; i++) S(i).magnet = true;
    // 옆으로 비킨 곳의 진행 방향 다시 계산 (루프 바깥)
    for (let i = a - jog - 2; i <= b + jog + 2; i++) {
      const s = S(i);
      if (s.roll) continue;
      s.tan3 = S(i + 1).pos.clone().sub(S(i - 1).pos).normalize();
      s.tan = s.tan3.clone().setY(0).normalize();
      s.right = new THREE.Vector3().crossVectors(s.tan, UP).normalize();
    }
    for (let i = a; i <= b; i++) {
      S(i).tan = F.clone();
      S(i).right = Rt.clone();
    }
    roll = { a, b, R, pad, jog, dir: 1, loop: true, P0, P1, F, Rt, k, w, top: P0.y + 2 * R, arc: cum[NT] };
  }

  // 도로 면의 방향: rightB(기울어진 오른쪽), up(도로 면의 위쪽)
  for (const s of samples) {
    s.rightB = s.right.clone().multiplyScalar(Math.cos(s.bank)).addScaledVector(UP, Math.sin(s.bank));
    s.up = new THREE.Vector3().crossVectors(s.rightB, s.tan3).normalize();
  }
  samples[SAMPLES] = { ...samples[0], t: 1, dist: length };
  if (roll) {
    // 루프 구간의 진행 방향(tan3)을 실제 도로 가운데 곡선에 맞춤 (차가 바라보는 방향 = 이 선). 오른쪽은 루프 내내 같은 수평 방향
    for (let i = roll.a - 2; i <= roll.b + 2; i++) {
      const s = S(i);
      const n = S(i + 1).pos, p = S(i - 1).pos;
      s.tan3 = n.clone().sub(p).normalize();
      s.rightB = s.right.clone().multiplyScalar(Math.cos(s.bank)).addScaledVector(UP, Math.sin(s.bank));
      s.up = new THREE.Vector3().crossVectors(s.rightB, s.tan3).normalize();
      s.rightB = new THREE.Vector3().crossVectors(s.tan3, s.up).normalize();
    }
  }
  /** 도로 면 위의 점 (옆 l, 위 h) */
  const surf = (s, l, h = 0, out = new THREE.Vector3()) => out.copy(s.pos).addScaledVector(s.rightB, l).addScaledVector(s.up, h);
  /** 수평 옆 위치 l에서의 도로 높이 (많이 비틀린 곳은 가운데 높이) */
  const roadYAt = (s, l) => (Math.abs(s.bank) < 0.8 ? s.pos.y + l * Math.tan(s.bank) : s.pos.y);

  // ---------------------------------------------------------------- 중력 구역 (샘플마다 배수, 경계는 25 m에 걸쳐 부드럽게)
  const zones = (data.gravity || []).map((z, k) => ({ ...z, k }));
  {
    const raw = new Float32Array(SAMPLES).fill(1);
    for (const z of zones) {
      const [a, b] = rangeI(z.t0, z.t1);
      z.a = a;
      z.b = b;
      for (let i = a; i <= b; i++) {
        raw[wrapI(i)] = z.g;
        S(i).zone = z;
      }
    }
    const r = mS(12);
    for (let i = 0; i < SAMPLES; i++) {
      let sum = 0;
      for (let j = -r; j <= r; j++) sum += raw[wrapI(i + j)];
      samples[i].grav = sum / (2 * r + 1);
    }
  }

  // 밟을 수 있는 면들
  const groundMeshes = [];
  const addGround = (mesh, surface) => {
    mesh.userData.surface = surface;
    groundMeshes.push(mesh);
    group.add(mesh);
    return mesh;
  };

  /** 샘플 목록을 따라 단면(profile)을 밀어 만든 메시들 (gpTrack.js와 같음) */
  function strip(list, profile, mat, { vScale = 8, chunk = 40, uScale = null, surface = null, shadow = false, parent = null } = {}) {
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
  /** 도로가 있는 샘플 (점프 사이는 없음). 도로 리본은 i → i+1 사각형이므로 립 샘플까지 */
  const hasRoad = (i) => !samples[i].gap;

  // ---------------------------------------------------------------- 레이싱 라인과 넓은 연석 (gpTrack과 같은 방식)
  const KERB_WIDE = 2.8;
  const LINE_MARGIN = 1.15;
  const LINE_PLAIN = 1.0;
  const kerbW = [new Float32Array(SAMPLES).fill(CURB), new Float32Array(SAMPLES).fill(CURB)];
  const sideI = (side) => (side < 0 ? 0 : 1);
  const kerbAt = (i, side) => kerbW[sideI(side)][wrapI(i)];
  const lineSamples = samples.slice(0, SAMPLES);
  const lineUse = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
  // 자석 도로(코르크스크루)·점프 앞뒤는 라인을 가운데 가까이로 (비틀린 도로에서는 옆 거리 계산이 맞지 않음, 점프는 똑바로)
  const centerOnly = new Float32Array(SAMPLES).fill(Infinity);
  if (roll) for (let i = roll.a - roll.pad - mS(25); i <= roll.b + roll.pad + mS(10); i++) centerOnly[wrapI(i)] = 0.3;
  // 점프: 립 60 m 앞부터는 가운데 ±1.2 m로 곧게 (비스듬히 뛰면 착지 도로 옆으로 떨어져 속도를 크게 잃었음)
  //   착지 뒤 65 m까지도 곧게 (2차: 공중에서 봇이 착지 뒤 라인 점을 겨냥해 차 머리가 20° 돌아간 채 착지 → 미끄러져 T12 밖으로 나갔음)
  for (const j of jumps)
    for (let i = j.lipI - mS(110); i <= j.landI + mS(95); i++)
      centerOnly[wrapI(i)] = Math.min(centerOnly[wrapI(i)], i < j.lipI - mS(60) || i > j.landI + mS(65) ? HW - 3.5 : 1.2);
  const lineLimit = (i, side) => {
    const q = wrapI(i);
    const u = lineUse[sideI(side)][q];
    const lim = HW - LINE_PLAIN + u * Math.max(0, kerbAt(q, side) - LINE_MARGIN + LINE_PLAIN);
    return Math.min(lim, centerOnly[q]);
  };
  const noWide = (i) => samples[i].magnet || samples[i].gap || centerOnly[i] < HW;
  const widen = (i0, i1, side, ramp) => {
    for (let i = i0; i <= i1; i++) {
      const q = wrapI(i);
      const w = smooth(0, ramp, i - i0) * smooth(0, ramp, i1 - i);
      const u = lineUse[sideI(side)];
      u[q] = Math.max(u[q], w);
      if (noWide(q)) continue;
      const arr = kerbW[sideI(side)];
      arr[q] = Math.max(arr[q], CURB + (KERB_WIDE - CURB) * w);
    }
  };
  // 라인 계산용 샘플: 코르크스크루 구간은 비틀기 전 중심선(축 아래)으로 계산 (곧은 직선) → 나중에 실제 위치로 옮김
  const flatSamples = lineSamples.map((s) => (s.roll ? { pos: s.base, right: s.right } : s));
  const halfSamples = flatSamples.filter((_, i) => i % 2 === 0);
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
  const racingLine = computeRacingLine(flatSamples, lineLimit, length, { bank: lineSamples.map((s) => (s.roll ? 0 : s.bank || 0)) });
  if (roll) {
    // 펴진 루프(base)는 50 m 안에서 옆으로 shift만큼 비스듬히 가서 입구·출구에 꺾임(가짜 곡률)이 생김 → 루프 앞뒤 곡률을 이어 붙여 없앰
    //   (속도 계획 profile()은 나중에 이 곡률 배열을 읽음). 루프 안 가짜 에이펙스도 뺌
    {
      const c = racingLine.curvature, e0 = roll.a - 8, e1 = roll.b + 8;
      const c0 = c[wrapI(e0)], c1 = c[wrapI(e1)];
      for (let i = e0 + 1; i < e1; i++) c[wrapI(i)] = THREE.MathUtils.lerp(c0, c1, (i - e0) / (e1 - e0));
      const inLoop = (i) => wrapI(i - e0) <= e1 - e0;
      for (let k = racingLine.apexes.length - 1; k >= 0; k--) if (inLoop(racingLine.apexes[k].i)) racingLine.apexes.splice(k, 1);
    }
    // 라인을 실제 비틀린 도로 가운데로 옮김 (띠가 도로 위에 그려지고, 봇이 실제 위치를 겨냥). 곡률은 곧은 축 기준 그대로(0 근처)
    for (let i = roll.a; i <= roll.b; i++) {
      const q = wrapI(i), s = samples[q];
      racingLine.x[q] = s.pos.x + s.rightB.x * racingLine.offset[q];
      racingLine.z[q] = s.pos.z + s.rightB.z * racingLine.offset[q];
    }
  }
  /** 레이싱 라인 지점 i의 높이 (도로 면 위) */
  const lineY = (i, d = 0) => {
    const s = samples[i];
    if (s.roll) return s.pos.y + s.rightB.y * racingLine.offset[i];
    return roadYAt(s, racingLine.offset[i] + d);
  };

  // ---------------------------------------------------------------- 도로, 연석
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.9 });
  // 연석 색: 보통 = 흰/파랑, 저중력 구역 = 흰/하늘색, 고중력 = 검정/주황
  const curbMats = {
    plain: new THREE.MeshStandardMaterial({ map: curbTexture('#f2f4f8', '#2f6fe0'), roughness: 0.8 }),
    low: new THREE.MeshStandardMaterial({ map: curbTexture('#f2f4f8', '#2fd6ff'), emissive: '#1aa8d8', emissiveIntensity: 0.25, roughness: 0.7 }),
    high: new THREE.MeshStandardMaterial({ map: curbTexture('#1d1f24', '#ff7a1f'), emissive: '#ff5a10', emissiveIntensity: 0.2, roughness: 0.7 }),
  };
  const magTex = magnetTexture();
  const magnetMat = new THREE.MeshStandardMaterial({ map: magTex, emissive: '#7a3cff', emissiveMap: magTex, emissiveIntensity: 0.6, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide });
  for (const [a, b] of runsOf((i) => hasRoad(i) && !samples[i].magnet)) strip(spanList(a, b), [[-HW, 0], [HW, 0]], roadMat, { vScale: 12, surface: 'ground' });
  // 루프 폭: 입구·출구가 옆으로 비켜 지나가도록 루프 도로는 halfWidth(6.5)로 좁힘. 벽 바깥 조금까지 자석 판
  const HWR = roll ? (data.loop && data.loop.halfWidth) || HW : HW;
  const rollRel = (i) => (roll ? wrapI(i - (roll.a - roll.pad)) : 0); // 자석 구간 시작부터 샘플 수
  const rollHalf = (i) => {
    if (!roll) return HW;
    const k = rollRel(i), pad = roll.pad, len = roll.b - roll.a + 2 * pad;
    const f = Math.min(smooth(0, pad, k), 1 - smooth(len - pad, len, k));
    return HW + (HWR - HW) * f;
  };
  const rollWallLat = (i) => {
    const k = rollRel(i), pad = roll.pad, len = roll.b - roll.a + 2 * pad;
    return rollHalf(i) + 0.45 + 2.6 * (1 - smooth(0, pad * 0.6, k)) + 2.6 * smooth(len - pad * 0.6, len, k);
  };
  for (const [a, b] of runsOf((i) => samples[i].magnet)) strip(spanList(a, b), (s) => [[-rollWallLat(s.i) - 0.3, 0], [rollWallLat(s.i) + 0.3, 0]], magnetMat, { vScale: 14, surface: 'magnet', chunk: 24 });
  const zoneKind = (s) => (s.zone ? s.zone.kind : 'plain');
  for (const kind of ['plain', 'low', 'high']) {
    for (const [a, b] of runsOf((i) => hasRoad(i) && !samples[i].magnet && zoneKind(samples[i]) === kind)) {
      const L = spanList(a, b);
      strip(L, (s) => [[-HW - kerbAt(s.i, -1), 0.02], [-HW, 0.02]], curbMats[kind], { vScale: 4, surface: 'ground' });
      strip(L, (s) => [[HW, 0.02], [HW + kerbAt(s.i, 1), 0.02]], curbMats[kind], { vScale: 4, surface: 'ground' });
    }
  }

  // ---------------------------------------------------------------- 코르크스크루: 양옆 벽(보이지 않음) + 빛나는 난간 + 유리 튜브
  const wallMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const rollParts = { rings: [], tube: null };
  if (roll) {
    const L = spanList(roll.a - roll.pad, roll.b + roll.pad);
    // 벽은 들어가는 곳에서 깔때기처럼 넓게 시작해서 좁아짐 (연석 위로 달리던 차도 안으로 들어오게)
    const wallLat = (s) => rollWallLat(s.i);
    for (const sd of [-1, 1]) {
      for (const m of strip(L, (s, k) => [[sd * wallLat(s, k), -0.8], [sd * wallLat(s, k), 2.2]], wallMat, { surface: 'barrier', chunk: 20 })) (m.visible = false), (m.userData.rollWall = true);
    }
    const railGlow = new THREE.MeshBasicMaterial({ color: '#c49bff', toneMapped: false, side: THREE.DoubleSide });
    const railGlass = new THREE.MeshStandardMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false });
    for (const sd of [-1, 1]) {
      const x = (s, k) => sd * wallLat(s, k);
      strip(L, (s, k) => (sd < 0 ? [[x(s, k), 1.25], [x(s, k), 0.0]] : [[x(s, k), 0.0], [x(s, k), 1.25]]), railGlass, { vScale: 8 });
      strip(L, (s, k) => [[x(s, k) - sd * 0.06, 1.2], [x(s, k) - sd * 0.06, 1.4]], railGlow, { vScale: 8 });
      strip(L, (s, k) => [[x(s, k) - sd * 0.06, 0.05], [x(s, k) - sd * 0.06, 0.2]], railGlow, { vScale: 8 });
    }
    // 루프를 감싸는 빛 고리 (도로 위로 반원, 6샘플마다) + 양옆 철탑과 꼭대기 들보
    const ringMat = new THREE.MeshBasicMaterial({ color: '#b98cff', toneMapped: false });
    const ringGeo = new THREE.TorusGeometry(HWR + 1.4, 0.16, 6, 28, Math.PI);
    for (let i = roll.a + 3; i <= roll.b - 3; i += 6) {
      const sm = S(i);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(sm.pos);
      // 토러스 기본: xy 평면, 반원은 +y 쪽 → x = 도로 오른쪽, y = 도로 위, z = 진행 방향
      ring.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sm.rightB.clone().negate(), sm.up, sm.tan3));
      group.add(ring);
      rollParts.rings.push(ring);
    }
    const steel = new THREE.MeshStandardMaterial({ color: '#c9ccd4', roughness: 0.45, metalness: 0.7 });
    const beamGlow = new THREE.MeshBasicMaterial({ color: '#c49bff', toneMapped: false });
    const mid = roll.P0.clone().lerp(roll.P1, 0.5);
    const topY = roll.top + 4;
    const sideOff = roll.w / 2 + HWR + 7;
    for (const sd of [-1, 1]) {
      for (const fo of [-roll.R * 0.9, roll.R * 0.9]) {
        const base = mid.clone().addScaledVector(roll.Rt, sd * sideOff).addScaledVector(roll.F, fo);
        const h = topY - base.y + 2;
        const col = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.4), steel);
        col.position.copy(base).setY(base.y - 1 + h / 2);
        group.add(col);
        const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, h * 0.92, 0.25), beamGlow);
        strip2.position.copy(col.position).addScaledVector(roll.Rt, -sd * 0.75);
        group.add(strip2);
      }
    }
    for (const fo of [-roll.R * 0.9, roll.R * 0.9]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(sideOff * 2 + 1.4, 1.2, 1.2), steel);
      beam.position.copy(mid).addScaledVector(roll.F, fo).setY(topY + 1);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), roll.Rt);
      group.add(beam);
    }
    rollParts.mid = mid;
    rollParts.topY = topY;
    rollParts.sideOff = sideOff;
  }

  // ---------------------------------------------------------------- 점프 립: 노란 줄무늬 옆면 + 빛나는 립 끝선
  const hazMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, side: THREE.DoubleSide });
  hazMat.map.repeat.set(1, 1);
  const lipGlow = new THREE.MeshBasicMaterial({ color: '#7ff3ff', toneMapped: false, side: THREE.DoubleSide });
  for (const j of jumps) {
    // 립 앞 30 m 도로 아래 옆면 (도로 판이 들린 모습)
    const L = spanList(j.lipI - mS(30), j.lipI);
    const DE = HW + kerbAt(j.lipI, 1) + 0.2;
    strip(L, [[-DE, 0.03], [-DE, -3.5], [DE, -3.5], [DE, 0.03]], hazMat, { vScale: 4, uScale: 4, shadow: true });
    // 립 끝 빛 띠
    const s = j.lip;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 0.18, 0.5), lipGlow);
    bar.position.copy(surf(s, 0, 0.06));
    bar.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s.rightB.clone().negate(), s.up, s.tan3));
    group.add(bar);
    // 착지 도로 앞쪽 절벽면
    const s2 = j.landS;
    const L2 = spanList(j.landI, j.landI + mS(6));
    strip(L2, [[-DE, 0.03], [-DE, -6], [DE, -6], [DE, 0.03]], hazMat, { vScale: 4, uScale: 4 });
    const bar2 = bar.clone();
    bar2.position.copy(surf(s2, 0, 0.06));
    bar2.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s2.rightB.clone().negate(), s2.up, s2.tan3));
    group.add(bar2);
  }

  // ---------------------------------------------------------------- 가드레일 (점프 앞뒤, 코르크스크루 들어가고 나오는 곳, data.rails)
  const railSide = [new Uint8Array(SAMPLES), new Uint8Array(SAMPLES)];
  const setRail = (a, b, side) => {
    for (let i = a; i <= b; i++) {
      const q = wrapI(i);
      if (samples[q].gap || samples[q].roll) continue;
      if (side <= 0) railSide[0][q] = 1;
      if (side >= 0) railSide[1][q] = 1;
    }
  };
  for (const j of jumps) {
    setRail(j.lipI - mS(70), j.lipI, 0);
    setRail(j.landI, j.landI + mS(60), 0);
  }
  for (const [t0, t1, side] of data.rails || []) {
    const [a, b] = rangeI(t0, t1);
    setRail(a, b, side);
  }
  const RAIL_LAT = HW + CURB + 1.4;
  function railLatAt(s) {
    return Math.max(RAIL_LAT, HW + kerbAt(s.i, 1) + 0.6, HW + kerbAt(s.i, -1) + 0.6);
  }
  // 루프 안 자동 운전 겨냥점: 봇(라인 따라가기)은 수평면(xz)에서 '앞 지점'을 겨냥해 핸들을 꺾는데,
  //   루프를 세로로 오를 때는 차의 xz 방향이 옆(Rt)으로만 남아 엉뚱하게 꺾고 벽에 박혔음.
  //   → 루프 근처 라인 점 j를, 그 점을 겨냥할 때(약 LOOK 샘플 뒤에 있는 차) 차가 '이미 가는 방향'에 놓음 = 핸들을 안 꺾음
  //   레이싱 라인 띠(racingLineFx)와 코너 분석은 불러오는 동안 진짜 위치로 이미 만들어졌으므로, 첫 물리 스텝에서 한 번만 바꿈
  let loopAimDone = !roll;
  function patchLoopAim() {
    loopAimDone = true;
    const LOOK = 10, D = 22;
    const xs = racingLine.x, zs = racingLine.z;
    for (let j = roll.a - 2; j <= roll.b + LOOK + 2; j++) {
      const i = j - LOOK, si = S(i), q = wrapI(j);
      const d = new THREE.Vector3(si.tan3.x, 0, si.tan3.z);
      if (d.lengthSq() < 1e-6) d.copy(roll.Rt);
      d.normalize();
      const w = smooth(roll.a - 3, roll.a + 2, j) * (1 - smooth(roll.b + LOOK - 2, roll.b + LOOK + 2, j));
      xs[q] = THREE.MathUtils.lerp(xs[q], si.pos.x + d.x * D, w);
      zs[q] = THREE.MathUtils.lerp(zs[q], si.pos.z + d.z * D, w);
    }
  }
  function railLimit(near) {
    if (!loopAimDone) patchLoopAim();
    // 루프 안: 좁은 자석 차선 양옆을 레일처럼 (옆 위치는 루프 내내 수평 방향 Rt라 그대로 쓸 수 있음)
    if (near.sample.roll) return HWR - 0.2;
    const side = near.lateral < 0 ? 0 : 1;
    if (!railSide[side][near.index]) return null;
    return railLatAt(near.sample);
  }
  const railMat = new THREE.MeshStandardMaterial({ color: '#dfe4ea', metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  const railGlowMat = new THREE.MeshBasicMaterial({ color: '#4fe8ff', toneMapped: false, side: THREE.DoubleSide });
  const posts = [];
  const railRuns = [];
  for (const [n, side] of [[0, -1], [1, 1]]) {
    const need = railSide[n];
    for (const [a, b] of runsOf((i) => need[i] === 1)) {
      const L = spanList(a, b);
      const lat = (s) => side * railLatAt(s);
      strip(L, (s) => [[lat(s), 0.62], [lat(s), 1.0]], railMat, { vScale: 4 });
      strip(L, (s) => [[lat(s), 0.4], [lat(s), 0.52]], railGlowMat, { vScale: 4 });
      for (const m of strip(L, (s) => [[lat(s), -0.6], [lat(s), 1.5]], wallMat, { surface: 'barrier' })) m.visible = false;
      const stepN = mS(3.2);
      for (let k = 0; k < L.length; k += stepN) {
        const s = L[k];
        const p = surf(s, lat(s) + side * 0.12, 0);
        posts.push({ x: p.x, y: p.y, z: p.z, ry: Math.atan2(s.tan.x, s.tan.z) });
      }
      railRuns.push({ side, a, b });
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

  // ---------------------------------------------------------------- 크레이터 목록 (지형이 씀)
  // data.craters: { t, side, off, r, depth, rim } (코스 기준) 또는 { x, z, r, depth, rim }
  const craters = [];
  for (const c of data.craters || []) {
    let x = c.x, z = c.z;
    if (c.t != null) {
      const s = sampleAt(c.t);
      const p = (s.base || s.pos).clone().addScaledVector(s.right, (c.side || 1) * (c.off || 0));
      x = p.x;
      z = p.z;
    }
    craters.push({ x, z, r: c.r, depth: c.depth ?? c.r * 0.22, rim: c.rim ?? c.r * 0.06, name: c.name || null });
  }
  // 점프 협곡: 립과 착지 사이를 가로지르는 깊은 골짜기 (떨어지면 아래로 → 복귀)
  const chasms = jumps.map((j) => {
    const a = j.lip, b = j.landS;
    const mid = a.pos.clone().lerp(b.pos, 0.5);
    const along = b.pos.clone().sub(a.pos).setY(0);
    const len = along.length();
    along.normalize();
    const across = new THREE.Vector3(-along.z, 0, along.x);
    return { mid, along, across, halfLen: len / 2 - 0.6, halfW: j.chasmHalfWidth || 70, floor: j.floor ?? -48, round: !!j.round };
  });

  // ---------------------------------------------------------------- 지형 높이
  // 도로 샘플 해시 (가까운 도로 찾기). 점프 사이·코르크스크루 가운데는 '도로 밑 땅'을 맞추지 않음
  const HASH = 20;
  const ckey = (a, b) => (a + 8192) * 16384 + (b + 8192);
  const roadHash = new Map();
  const solid = (s) => !s.gap && !(s.roll && s.rollU > 0.04 && s.rollU < 0.96);
  for (let i = 0; i < SAMPLES; i++) {
    const s = samples[i];
    const p = s.base || s.pos;
    const k = ckey(Math.floor(p.x / HASH), Math.floor(p.z / HASH));
    if (!roadHash.has(k)) roadHash.set(k, []);
    roadHash.get(k).push(s);
  }
  function roadNear(x, z, r, fn) {
    const x0 = Math.floor((x - r) / HASH), x1 = Math.floor((x + r) / HASH), z0 = Math.floor((z - r) / HASH), z1 = Math.floor((z + r) / HASH);
    for (let a = x0; a <= x1; a++)
      for (let b = z0; b <= z1; b++) {
        const list = roadHash.get(ckey(a, b));
        if (list) for (const s of list) fn(s);
      }
  }
  // 넓은 높이 기준: 도로 높이를 40 m 격자에 퍼뜨린 것 (지형이 도로 근처에서 도로 높이를 따라감)
  const bb = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
  for (const s of samples) bb.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
  const MARGIN = data.terrainMargin || 260;
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
  /** 크레이터 모양: 안쪽 오목, 테두리 볼록 */
  function craterAt(x, z) {
    let h = 0;
    for (const c of craters) {
      const dx = x - c.x, dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      const R2 = c.r * 1.6;
      if (d2 > R2 * R2) continue;
      const d = Math.sqrt(d2) / c.r;
      if (d < 1) h -= c.depth * (1 - d * d) * (1 - d * d * 0.35);
      h += c.rim * Math.exp(-(((d - 1) / 0.22) ** 2));
    }
    return h;
  }
  /** 자연 지형 (도로 영향 없음) */
  function naturalH(x, z) {
    return coarseH(x, z) + noise(x / 70, z / 70, 3) * 3.2 + noise(x / 17, z / 17, 2) * 0.7 + craterAt(x, z);
  }
  /** 점프 협곡 깊이 (협곡 밖이면 null) */
  function chasmH(x, z, H) {
    let out = H;
    for (const c of chasms) {
      const dx = x - c.mid.x, dz = z - c.mid.z;
      const a = Math.abs(dx * c.along.x + dz * c.along.z), b = Math.abs(dx * c.across.x + dz * c.across.z);
      // 길이 방향: 립~착지 사이(halfLen)는 바닥까지, 벽은 3 m에 걸쳐 / 폭 방향: halfW 넘어가면 점점 얕아짐 (둥근 끝)
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
    roadNear(x, z, 70, (s) => {
      if (!solid(s)) return;
      const p = s.base || s.pos;
      const dx = x - p.x, dz = z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < nd) (nd = d), (ns = s);
      if (d < HW + CURB + 3) {
        const l = dx * s.right.x + dz * s.right.z;
        const y = s.roll ? (s.base || s.pos).y : roadYAt(s, THREE.MathUtils.clamp(l, -HW - CURB, HW + CURB));
        under = Math.min(under, y);
      }
    });
    const nat = naturalH(x, z);
    let H;
    if (ns && nd < HW + CURB + 1) H = under - 0.3;
    else {
      let edgeY = nat, k = 1;
      if (ns) {
        const p = ns.base || ns.pos;
        const l = (x - p.x) * ns.right.x + (z - p.z) * ns.right.z;
        edgeY = (ns.roll ? p.y : roadYAt(ns, Math.sign(l) * (HW + CURB))) - 0.15;
        k = smooth(HW + CURB + 1, HW + 42, nd);
      }
      H = edgeY * (1 - k) + nat * k;
      if (under < Infinity) H = Math.min(H, under - 0.1);
    }
    // 점프 사이·코르크스크루 아래: 도로보다 충분히 낮게
    roadNear(x, z, HWR + 12, (s) => {
      if (solid(s) || !s.roll) return;
      const p = s.base || s.pos;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > HWR + 12) return;
      // 루프 밑: 루프 도로(바닥 높이 이상)에 땅이 닿지 않게 살짝 낮춤
      const cap = p.y - 1.2 + Math.max(0, d - HWR - 4) * 0.8;
      if (cap < H) H = cap;
    });
    return { H: chasmH(x, z, H), nd: ns ? nd : Infinity };
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
    // 격자 삼각형과 같은 방식으로 (대각선 나눔)
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(HG[gi(i, j)], HG[gi(i + 1, j)], u), THREE.MathUtils.lerp(HG[gi(i, j + 1)], HG[gi(i + 1, j + 1)], u), v);
  }
  /** 지형 위면 양수 (gpCorners가 '땅 위인가'를 볼 때 씀). 협곡 안은 음수 */
  const fieldAt = (x, z) => {
    if (x < gx0 || z < gz0 || x > gx0 + NX * CELL || z > gz0 + NZ * CELL) return -999;
    return heightAt(x, z) > -20 ? 10 : -10;
  };

  // 색: 레골리스 회색(노이즈), 바다(어두운 평원), 고지대(밝음), 크레이터 안 어둡게·테두리 밝게, 도로 옆 바퀴 자국 흙
  const cA = new THREE.Color('#8f8d88'), cB = new THREE.Color('#a9a7a1'), cMare = new THREE.Color('#5f5e5c');
  const cRimC = new THREE.Color('#c4c2bb'), cDeep = new THREE.Color('#4a4a4b'), cShoulder = new THREE.Color('#77746f'), cTmp = new THREE.Color();
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const terrainColor = (x, y, z, ny, nd) => {
    const n1 = noise(x / 90, z / 90, 3), n2 = noise(x / 13, z / 13, 2);
    cTmp.copy(cA).lerp(cB, THREE.MathUtils.clamp(0.5 + n2 * 0.8, 0, 1));
    cTmp.lerp(cMare, smooth(0.05, 0.35, n1) * 0.7);
    const cr = craterAt(x, z);
    if (cr < -0.5) cTmp.lerp(cDeep, Math.min(0.55, -cr / 14));
    else if (cr > 0.4) cTmp.lerp(cRimC, Math.min(0.6, cr / 3));
    if (nd < HW + 9) cTmp.lerp(cShoulder, 0.55 * (1 - smooth(HW + 3, HW + 9, nd)));
    if (ny < 0.8) cTmp.lerp(cDeep, smooth(0.8, 0.45, ny) * 0.6);
    if (y < -12) cTmp.lerp(cDeep, smooth(-12, -35, y) * 0.8);
    return cTmp;
  };
  for (let cj = 0; cj < NZ; cj += CHUNK)
    for (let ci = 0; ci < NX; ci += CHUNK) {
      const i1 = Math.min(NX, ci + CHUNK), j1 = Math.min(NZ, cj + CHUNK);
      const P = [], C = [];
      for (let j = cj; j < j1; j++)
        for (let i = ci; i < i1; i++) {
          const v = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => [gx0 + a * CELL, HG[gi(a, b)], gz0 + b * CELL, ND[gi(a, b)]]);
          // 두 삼각형 (위를 향하게: 0,2,1 / 0,3,2)
          for (const tri of [[0, 2, 1], [0, 3, 2]]) {
            const [p, q, r] = tri.map((k) => v[k]);
            P.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
            // 면 기울기
            const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], wx = r[0] - p[0], wy = r[1] - p[1], wz = r[2] - p[2];
            const nx = uy * wz - uz * wy, nyy = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            const ny = nyy / (Math.hypot(nx, nyy, nz) || 1);
            const c = terrainColor((p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3, Math.abs(ny), Math.min(p[3], q[3], r[3]));
            for (let k = 0; k < 3; k++) C.push(c.r, c.g, c.b);
          }
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, terrainMat);
      m.receiveShadow = true;
      m.name = 'moonTerrain';
      addGround(m, 'ground');
    }

  // ---------------------------------------------------------------- 출발선 (체커)
  const s0 = samples[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  line.material.map.repeat.set(W / 4, 1);
  {
    const x = new THREE.Vector3().crossVectors(s0.tan3, s0.up);
    line.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, s0.tan3, s0.up));
  }
  line.position.copy(s0.pos).addScaledVector(s0.up, 0.04);
  group.add(line);
  // 출발 그리드 칸 (2줄, 8칸): 흰 ㄷ자 표시
  {
    const gridMat = new THREE.MeshBasicMaterial({ color: '#e9edf3', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const bars = [];
    for (let k = 0; k < 8; k++) {
      const back = 10 + k * 8.5;
      const lat = (k % 2 ? 1 : -1) * 3.6;
      const s = samples[wrapI(-mS(back))];
      const p = surf(s, lat, 0.035);
      bars.push({ p, s, w: 3.6, l: 0.35 });
      for (const sd of [-1, 1]) bars.push({ p: surf(s, lat + sd * 1.75, 0.035).addScaledVector(s.tan3, -0.9), s, w: 0.3, l: 2.1 });
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    const im = new THREE.InstancedMesh(geo, gridMat, bars.length);
    const m4 = new THREE.Matrix4();
    bars.forEach((b, i) => {
      const x = new THREE.Vector3().crossVectors(b.s.tan3, b.s.up);
      m4.makeBasis(x.multiplyScalar(b.w), b.s.tan3.clone().multiplyScalar(b.l), b.s.up).setPosition(b.p);
      im.setMatrixAt(i, m4);
    });
    group.add(im);
  }

  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- 찾기, 충돌
  /** 가장 가까운 코스 지점 (높이 차이도 따짐: 코르크스크루 위·아래 구분) */
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
  /** 중력 구역용 빠른 찾기: 지난번 지점 근처만 (멀리 순간이동하면 전체) */
  let gLast = 0;
  function nearIndexFast(pos) {
    let best = Infinity, bi = gLast;
    const win = 70;
    for (let k = -win; k <= win; k++) {
      const i = wrapI(gLast + k), p = samples[i].pos;
      const dy = p.y - pos.y;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2 + 3 * dy * dy;
      if (d < best) (best = d), (bi = i);
    }
    if (best > 45 * 45) bi = nearest(pos).index;
    gLast = bi;
    return bi;
  }
  /** 이 자리의 중력 배수 (car.js가 매 스텝 부름) */
  // 중력 쿠션 (2026-11-10 2차): 협곡 위 '립→착지' 선보다 아래로 떨어지면 아래로 갈수록 중력이 줄다가 거꾸로(위로) 밀어 줌
  //   → 느리게(브레이크 밟고·쉬운 봇·느린 차) 뛰어도 쿠션 위를 둥실 떠서 건너감. 빠른 차는 쿠션보다 높이 날아서 그대로
  //   off: 선보다 이만큼 위부터 쿠션 (립 1.4 m → 착지 1.9 m, 착지 도로보다 살짝 위로 띄워 착지 턱에 안 걸리게)
  //   K: 1 m 내려갈 때 줄어드는 중력 배수, GMIN: 가장 세게 밀어 올리는 값(−), DEEP: 이보다 깊이 떨어지면 쿠션 없음
  const CUSHION = { off0: 1.4, off1: 1.9, K: 0.7, GMIN: -0.75, DEEP: 14, side: HW + 9 };
  for (const j of jumps)
    for (let i = j.lipI; i !== j.landI; i = wrapI(i + 1)) {
      const u = wrapI(i - j.lipI) / Math.max(1, wrapI(j.landI - j.lipI));
      samples[i].cushionOff = CUSHION.off0 + (CUSHION.off1 - CUSHION.off0) * u;
    }
  function gravityAt(pos) {
    const s = samples[nearIndexFast(pos)];
    if (s.cushionOff === undefined) return s.grav;
    const d = s.pos.y + s.cushionOff - pos.y;
    if (d <= 0 || d > CUSHION.DEEP) return s.grav;
    if (Math.hypot(pos.x - s.pos.x, pos.z - s.pos.z) > CUSHION.side) return s.grav;
    return Math.max(CUSHION.GMIN, s.grav - CUSHION.K * d);
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
    // placeAt(높이 30에서 아래로): 코르크스크루 천장 같은 곳에 놓이지 않게 고른 지점 바로 위에서 쏨
    if (origin.y === 30 && far === 60 && dir.y === -1 && lastSampled && Math.hypot(origin.x - lastSampled.pos.x, origin.z - lastSampled.pos.z) < 25) {
      origin = origin2.set(origin.x, lastSampled.pos.y + 6, origin.z);
      far = 40;
    }
    raycaster.set(origin, dir);
    raycaster.near = 0;
    raycaster.far = far;
    // 자석 도로 위에서 바닥을 찾는 레이(car.js: 길이 1.5 + 2.5 = 4)는 코르크스크루 옆벽을 무시
    //   (천장·벽을 달리다 차 가운데가 벽에 붙으면 아래로 쏜 레이가 벽면을 스쳐 '벽 위에 선 것'으로 잘못 판정 → 떨어졌음)
    // 공중에서 착지할 곳을 찾는 짧은 레이(1 m 아래)도 무시: 뒤집힌 구간에서는 옆벽의 면이 위를 향해 '바닥'처럼 보임
    const groundProbe = Math.abs(far - 4) < 1e-6 || far < 1.2;
    for (const hit of raycaster.intersectObjects(groundMeshes, false)) {
      if (hit.distance < 1e-4) continue;
      const obj = hit.object;
      if (groundProbe && obj.userData.rollWall) continue;
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
    if (near.sample.magnet) return true;
    return near.dist < HW + kerbAt(near.index, near.lateral < 0 ? -1 : 1);
  }
  function edgeInfo(pos, near = nearest(pos)) {
    if (near.sample.magnet || near.sample.roll) return { kerb: 0, off: 0, runoff: false };
    const k = kerbAt(near.index, near.lateral < 0 ? -1 : 1);
    return { ...edgeFraction(near.dist, HW, HW + k), runoff: false };
  }

  const outline = samples.filter((_, i) => i % 6 === 0 && i < SAMPLES).map((s) => [s.pos.x, s.pos.z]);

  // 중력 쿠션 그림 (2차): 협곡 위 립→착지 사이에 하늘색 빛 그물 + 위로 흐르는 화살표 → "느려도 둥실 건너갈 수 있음"이 보이게
  const cushionTex = canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,240,255,0.55)';
    g.lineWidth = 3;
    for (let k = 0; k <= 4; k++) {
      g.beginPath();
      g.moveTo((k * w) / 4, 0);
      g.lineTo((k * w) / 4, h);
      g.stroke();
      g.beginPath();
      g.moveTo(0, (k * h) / 4);
      g.lineTo(w, (k * h) / 4);
      g.stroke();
    }
    g.fillStyle = 'rgba(170,250,255,0.85)';
    g.beginPath();
    g.moveTo(w * 0.5, h * 0.3);
    g.lineTo(w * 0.68, h * 0.55);
    g.lineTo(w * 0.32, h * 0.55);
    g.fill();
  });
  const cushionMat = new THREE.MeshBasicMaterial({ map: cushionTex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  for (const j of jumps) {
    const L = spanList(j.lipI, j.landI);
    strip(L, [[-HW - 2, -0.6], [HW + 2, -0.6]], cushionMat, { vScale: 6, uScale: 6 });
  }
  function animate(time) {
    cushionTex.offset.y = -time * 0.5;
    cushionMat.opacity = 0.4 + Math.sin(time * 2.4) * 0.1;
    magnetMat.emissiveIntensity = 0.5 + Math.sin(time * 3) * 0.15;
    magTex.offset.y = -time * 0.6;
    lipGlow.color.setHSL(0.52, 1, 0.6 + Math.sin(time * 6) * 0.15);
  }
  const sampleAtTracked = (t) => (lastSampled = sampleAt(t));
  const buildMs = Math.round(performance.now() - buildT0);

  return {
    data, width: W, length, samples, sampleAt: sampleAtTracked, nearest, nearestRaw, castRay, boostPadAt: () => null, animate, outline,
    shortcut: null, shortcutDist: () => Infinity, onShortcut: () => false, isOnRoad, edgeInfo, racingLine, lineY, kerbWidth: CURB, kerbAt, group, groundMeshes,
    arena: false, pad: null, inPad: () => false, spawn: null,
    sea: null, inSea: () => false, waterRanges: [], isWaterT: () => false, buoys: [],
    // gpCorners.js(코너 표시판)가 쓰는 그랑프리 방식 값: 우주(네온) 표시판으로
    grandprix: true, inSpace: true, surf, roadYAt, heightAt, fieldAt, railLimit, railRuns, railSide, deckHalf: HW + CURB + 1.2, curb: CURB,
    onAltPath: () => false, altPaths: [], runway: null, apron: null, plank: null, rings: [], skyPath: [], inSkyCorridor: () => false,
    indexAt, S, spanList, noise, dimension: null, setWorld() {}, buildMs, sampleCount: SAMPLES,
    // 달 전용
    moon: true, gravityAt, gravityZones: zones, jumps, roll, rollParts, craters, chasms, naturalH, coarseH, terrainBox: bb, strip,
    magnetMat, mS, wrapI,
  };
}
