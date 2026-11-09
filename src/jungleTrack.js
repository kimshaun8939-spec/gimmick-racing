// 정글 유적 코스 (data/jungle.json, module: jungleMap) — gpTrack.js(구름섬 그랑프리)를 복사해 정글용으로 고친 것
//
//   - points = [x, 높이 y, z] 3D 중심선. 도로 리본 자체가 밟는 땅, 정글 땅(islands)은 도로 높이를 따라 만들어짐
//   - 협곡(holes): 땅에 뚫린 깊은 골짜기. 밧줄 다리(bridges 'rope')로 건넘. 떨어지면 마지막 도로 지점으로 복귀
//   - 용암 지하 세계 (data.dimension t0~t1): 포털 A~B 사이는 현무암 다리(양쪽 난간). 정글 물체와 지하 물체는
//     setWorld(under)로 번갈아 보이게 함 (jungleWorld.js가 포털을 지날 때 부름). 숨겨도 충돌은 그대로
//   - 저중력 구역 (data.gravity [t0, t1, 배수]) → gravityAt(pos) (car.js가 씀)
//   - 낭떠러지 쪽에는 가드레일(보이지 않는 충돌 벽 + 난간)이 자동으로 생김
// buildTrack()과 같은 모양의 객체를 돌려줘서 차, HUD, main.js, gpCorners.js가 그대로 씁니다.
import * as THREE from 'three';
import { canvasTexture, roadTexture, curbTexture, checkerTexture, plankTexture, stoneTexture, makeNoise, underTrackMaterials } from './jungleUtil.js';
import { computeRacingLine, edgeFraction } from './racingLine.js';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const SAMPLE_STEP = 1.87; // 중심선 샘플 간격 (m). 샘플 수는 코스 길이에 맞춰 정함 (예전 3 km 코스 = 1600개)
const CELL = 5; // 지형 격자 한 칸 (m)
const CHUNK = 24; // 지형 메시 한 덩어리 = 24×24칸 (그리기 횟수와 충돌 계산 속도의 균형)
const smooth = (a, b, x) => {
  const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

// ---------------------------------------------------------------- 텍스처
function deckTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#c9ccd2';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const v = 175 + Math.random() * 50;
      g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(0, 0, w, 2);
  });
}

export function buildJungleTrack(data, scene) {
  const buildT0 = performance.now();
  const W = data.width;
  const HW = W / 2;
  const CURB = 1.6;
  const SC = data.scale || 1;
  const noise = makeNoise(20261110);
  const group = new THREE.Group();
  scene.add(group);

  // ---------------------------------------------------------------- 중심선 샘플
  const curve = new THREE.CatmullRomCurve3(data.points.map(([x, y, z]) => new THREE.Vector3(x * SC, y, z * SC)), true, 'centripetal');
  // 길이 재기 촘촘하게 (기본 200칸은 점이 많은 긴 코스에서 샘플 간격이 들쭉날쭉해짐). .debug/space_gen.js 와 같은 값
  curve.arcLengthDivisions = Math.max(200, data.points.length * 40);
  const length = curve.getLength();
  const SAMPLES = Math.max(1600, Math.round(length / SAMPLE_STEP));
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pos = curve.getPointAt(t % 1);
    const tan3 = curve.getTangentAt(t % 1);
    const tan = tan3.clone().setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();
    samples.push({ t, i, pos, tan, tan3, right, dist: t * length, bank: 0, bridge: null, land: true });
  }
  const wrapI = (i) => ((i % SAMPLES) + SAMPLES) % SAMPLES;
  const S = (i) => samples[wrapI(i)];
  const indexAt = (t) => Math.round((((t % 1) + 1) % 1) * SAMPLES);
  const sampleAt = (t) => samples[indexAt(t) % SAMPLES];
  /** t0~t1 구간의 샘플 번호 (1을 넘어 감길 수 있음) */
  function rangeI(t0, t1) {
    const a = indexAt(t0);
    let b = indexAt(t1);
    if (b < a) b += SAMPLES;
    return [a, b];
  }
  const inRangeT = (t, t0, t1) => (t0 <= t1 ? t >= t0 && t <= t1 : t >= t0 || t <= t1);
  // 돌 포장 갓길 구간 (연석 바깥 APRON m): 잔디 대신 runoff(속도 85%)
  const APRON = 9;
  for (const [t0, t1] of data.runoff || []) {
    const [a, b] = rangeI(t0, t1);
    for (let i = a; i <= b; i++) S(i).apron = true;
  }

  // 다리 구간
  for (const [t0, t1, kind] of data.bridges || []) {
    const [a, b] = rangeI(t0, t1);
    for (let i = a; i <= b; i++) {
      S(i).bridge = kind;
      S(i).land = false;
    }
  }
  // 우주 차원 구간: 유리 다리 (bridge = 'space'), 지형 없음
  const dim = data.dimension || null;
  const inSpaceT = (t) => !!dim && inRangeT(((t % 1) + 1) % 1, dim.t0, dim.t1);
  if (dim) {
    const [a, b] = rangeI(dim.t0, dim.t1);
    for (let i = a; i <= b; i++) {
      S(i).bridge = 'space';
      S(i).land = false;
      S(i).space = true;
    }
  }
  // 굽은 방향 (+ 왼쪽, - 오른쪽) → 뱅크(안쪽이 낮게)
  const heading = (s) => Math.atan2(s.tan.x, s.tan.z);
  const turnSign = samples.map((s, i) => {
    let d = heading(S(i + 10)) - heading(S(i - 10));
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  });
  for (const bk of data.bank || []) {
    const [a, b] = rangeI(bk.t0, bk.t1);
    const ramp = Math.max(4, Math.round((22 / length) * SAMPLES));
    // 2026-11-09 코너 다듬기: 기울기 방향은 구간 전체에서 하나로 (구간 안에서 굽는 방향이 바뀌면
    // 예전엔 한 샘플 사이에 +8° → −8°로 뒤집혀 도로에 턱이 생겼음 → 차가 '쿵' 부딪힘).
    // 반대로 굽거나 거의 곧은 곳에서는 기울기를 부드럽게 0으로 줄임
    let sum = 0;
    for (let i = a; i <= b; i++) sum += turnSign[wrapI(i)];
    const sgn = Math.sign(sum) || 0;
    const agreeRaw = (i) => THREE.MathUtils.clamp((turnSign[wrapI(i)] * sgn) / 0.03, 0, 1);
    for (let i = a; i <= b; i++) {
      const w = smooth(0, ramp, i - a) * smooth(0, ramp, b - i);
      // 굽는 방향 일치 정도를 앞뒤 ramp 샘플(약 22 m)로 평균 → 기울기가 갑자기 바뀌지 않음
      let agree = 0;
      for (let j = -ramp; j <= ramp; j++) agree += agreeRaw(i + j);
      agree /= 2 * ramp + 1;
      S(i).bank = sgn * THREE.MathUtils.degToRad(bk.deg) * w * agree;
    }
  }
  // 도로 면의 방향: rightB(기울어진 오른쪽), up(도로 면의 위쪽)
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

  /**
   * 샘플 a~b를 따라 단면(profile)을 밀어 만든 메시들.
   * profile: [[옆, 위], ...] (왼쪽 → 오른쪽 순서면 앞면이 위를 향함) 또는 (sample) => 그런 배열
   */
  function strip(list, profile, mat, { vScale = 8, chunk = 40, uScale = null, surface = null, shadow = false } = {}) {
    const meshes = [];
    // 충돌하지 않는 장식(난간 판 등)은 크게 묶어 그리기 횟수를 줄임
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
          const frame = s.rightB ? s : null;
          if (frame) surf(s, prof[k][0], prof[k][1], v);
          else v.copy(s.pos).addScaledVector(s.right, prof[k][0]).addScaledVector(UP, prof[k][1]);
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
      // 어느 세계의 물체인가 (우주 샘플이 절반 넘으면 우주)
      let sp = 0;
      for (let r = 0; r < rows; r++) if (list[a + r].space) sp++;
      m.userData.world = sp * 2 > rows ? 'space' : 'cloud';
      if (surface) addGround(m, surface);
      else group.add(m);
      meshes.push(m);
    }
    return meshes;
  }
  /** 샘플 번호 a~b (감김 포함, 거리는 이어짐) */
  function spanList(a, b) {
    const out = [];
    for (let i = a; i <= b; i++) {
      const s = S(i);
      out.push(i >= SAMPLES ? { ...s, dist: s.dist + length * Math.floor(i / SAMPLES) } : s);
    }
    return out;
  }
  /** 조건이 이어지는 구간들 [[a, b], ...] (b는 다음 샘플까지 포함) */
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

  /** 목록 안에서 조건이 이어지는 구간들 [[c, d], ...] (d는 다음 항목까지 포함해 끊김 없이 이어짐) */
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

  // ---------------------------------------------------------------- 레이싱 라인과 F1식 넓은 연석
  // 1) 일반 연석(1.6 m)으로 라인을 구해 에이펙스(코너 안쪽 끝)를 찾고
  // 2) 에이펙스 안쪽과 코너 탈출 바깥쪽 연석을 2.8 m까지 넓힌 뒤 (F1 서킷처럼 연석을 밟고 지나갈 수 있게)
  // 3) 넓어진 연석까지 쓰는 라인으로 다시 계산
  const KERB_WIDE = 2.8;
  const LINE_MARGIN = 1.15; // 넓은 연석: 차 중심이 연석 바깥 끝에서 이만큼 안쪽까지 → 차가 연석을 밟고 지나감
  const LINE_PLAIN = 1.0; // 보통 구간: 차 중심이 도로 끝(흰 선)에서 이만큼 안쪽 → 직선에서는 연석을 밟지 않음
  const kerbW = [new Float32Array(SAMPLES).fill(CURB), new Float32Array(SAMPLES).fill(CURB)]; // [왼쪽, 오른쪽]
  const sideI = (side) => (side < 0 ? 0 : 1);
  const kerbAt = (i, side) => kerbW[sideI(side)][wrapI(i)];
  const lineSamples = samples.slice(0, SAMPLES);
  // lineUse 0 → 1: 코너 근처에서만 라인이 흰 선 안쪽에서 연석 위까지 나갈 수 있음
  //   땅에서는 넓힌 연석(2.8 m) 위까지, 다리 위에서는 원래 연석(1.6 m) 위까지
  const lineUse = [new Float32Array(SAMPLES), new Float32Array(SAMPLES)];
  const lineLimit = (i, side) => {
    const u = lineUse[sideI(side)][wrapI(i)];
    return HW - LINE_PLAIN + u * Math.max(0, kerbAt(i, side) - LINE_MARGIN + LINE_PLAIN);
  };
  let racingLine = null;
  const onShortcutSide = (i, side) => {
    const sc = data.shortcut;
    return !!sc && side === (Math.sign(sc.lat0 || -1) || -1) && inRangeT(samples[i].t, sc.t0 - 0.01, sc.t1 + 0.01);
  };
  const noWide = (i, side) => {
    const s = samples[i];
    if (!s.land) return true; // 다리: 연석 폭은 그대로 (라인은 원래 연석까지 씀)
    if ((data.noRail || []).some(([t0, t1, sd]) => sd === side && inRangeT(s.t, t0, t1))) return true; // 활주로·착륙장이 붙는 쪽
    return onShortcutSide(i, side);
  };
  const mS = (m) => Math.max(1, Math.round((m / length) * SAMPLES));
  const widen = (i0, i1, side, ramp) => {
    for (let i = i0; i <= i1; i++) {
      const q = wrapI(i);
      if (onShortcutSide(q, side)) continue;
      // 2026-11-09 코너 다듬기: 활주로·착륙장이 붙는 쪽(noRail)은 라인이 연석 위로 나가지 않음
      // (활주로 입구 왼쪽 코너에서 라인이 연석 끝까지 붙어 조금만 밀려도 활주로 턱·소품에 부딪혔음)
      if ((data.noRail || []).some(([t0, t1, sd]) => sd === side && inRangeT(samples[q].t, t0, t1))) continue;
      const w = smooth(0, ramp, i - i0) * smooth(0, ramp, i1 - i);
      const u = lineUse[sideI(side)];
      u[q] = Math.max(u[q], w);
      if (noWide(q, side)) continue;
      const arr = kerbW[sideI(side)];
      arr[q] = Math.max(arr[q], CURB + (KERB_WIDE - CURB) * w);
    }
  };
  // 넓힌 연석을 쓰면 에이펙스 자리가 조금 옮겨지므로 두 번 반복
  // (긴 코스라 미리 계산은 샘플 절반으로 빠르게: 에이펙스 자리만 필요. 마지막 라인만 촘촘하게)
  const halfSamples = lineSamples.filter((_, i) => i % 2 === 0);
  const prelimApexes = () => computeRacingLine(halfSamples, (i, side) => lineLimit(i * 2, side), length, { iterScale: 0.7 }).apexes.map((a) => ({ ...a, i: a.i * 2 }));
  let apexes0 = prelimApexes();
  for (let pass = 0; pass < 2; pass++) {
    for (const ap of apexes0) {
      if (ap.radius > 150) continue;
      widen(ap.i - mS(30), ap.i + mS(22), ap.side, mS(10)); // 에이펙스 안쪽
      widen(ap.i + mS(12), ap.i + mS(62), -ap.side, mS(14)); // 탈출 바깥쪽
    }
    if (pass === 0) apexes0 = prelimApexes();
  }
  racingLine = computeRacingLine(lineSamples, lineLimit, length, { bank: lineSamples.map((s) => s.bank || 0) }); // bank: 경사 코너 속도 계획
  /** 레이싱 라인 지점 i의 높이 (도로 면 위) */
  const lineY = (i, d = 0) => roadYAt(samples[i], racingLine.offset[i] + d);

  // ---------------------------------------------------------------- 도로, 연석
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.88 });
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.8 });
  const curbBridgeMat = new THREE.MeshStandardMaterial({ map: curbTexture('#e8b21f', '#2a2a2a'), roughness: 0.8 });
  const SPM = underTrackMaterials();
  // 도로: 정글 구간은 아스팔트, 지하 세계 구간은 용암 틈이 빛나는 현무암 도로
  for (const [a, b] of runsOf((i) => !samples[i].space)) strip(spanList(a, b), [[-HW, 0], [HW, 0]], roadMat, { vScale: 12, surface: 'ground' });
  for (const [a, b] of runsOf((i) => !!samples[i].space)) strip(spanList(a, b), [[-HW, 0], [HW, 0]], SPM.road, { vScale: 12, surface: 'ground' });
  for (const [a, b] of runsOf((i) => samples[i].land)) {
    const L = spanList(a, b);
    strip(L, (s) => [[-HW - kerbAt(s.i, -1), 0.02], [-HW, 0.02]], curbMat, { vScale: 4, surface: 'ground' });
    strip(L, (s) => [[HW, 0.02], [HW + kerbAt(s.i, 1), 0.02]], curbMat, { vScale: 4, surface: 'ground' });
  }

  // 돌 포장 갓길: 연석 바깥으로 돌판 + 바깥 끝은 아래로 꺾인 돌 테두리 (땅이 낮아도 떠 보이지 않게)
  const apronTex = stoneTexture('#a59a80', true);
  apronTex.repeat.set(1, 1);
  const apronMat = new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.95 });
  for (const [a, b] of runsOf((i) => !!samples[i].apron && samples[i].land)) {
    const L = spanList(a, b);
    for (const sd of [-1, 1]) {
      const prof = (s) => {
        const k = HW + kerbAt(s.i, sd);
        const P = [[k, 0.04], [k + APRON, 0.04], [k + APRON + 0.6, -3]];
        return sd > 0 ? P : P.map(([x, y]) => [-x, y]).reverse();
      };
      strip(L, prof, apronMat, { vScale: 6, uScale: 6, surface: 'ground' });
    }
  }

  // ---------------------------------------------------------------- 다리 (상판, 갓길)
  const DECK = HW + CURB + 2.6; // 상판 반폭 (난간 위치). 정글: gp(1.2)보다 넓은 갓길
  const deckTex = deckTexture();
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85, side: THREE.DoubleSide });
  const plankMat = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.9, side: THREE.DoubleSide }); // 밧줄 다리 판자
  const deckSideMats = {
    rope: new THREE.MeshStandardMaterial({ color: '#6b4528', roughness: 0.95, side: THREE.DoubleSide }),
    stone: new THREE.MeshStandardMaterial({ color: '#8f8a76', roughness: 0.95, side: THREE.DoubleSide }),
    cable: new THREE.MeshStandardMaterial({ color: '#e9ecf1', roughness: 0.7, side: THREE.DoubleSide }),
    viaduct: new THREE.MeshStandardMaterial({ color: '#d8cfc0', roughness: 0.85, side: THREE.DoubleSide }),
    trestle: new THREE.MeshStandardMaterial({ color: '#8a5c34', roughness: 0.9, side: THREE.DoubleSide }),
    space: SPM.side,
  };
  const bridgeRuns = runsOf((i) => !!samples[i].bridge).map(([a, b]) => ({ a, b, kind: S(a + 1).bridge }));
  for (const br of bridgeRuns) {
    const L = spanList(br.a, br.b);
    const sp = br.kind === 'space';
    const cm = sp ? SPM.curb : curbBridgeMat, dm = sp ? SPM.deck : br.kind === 'rope' ? plankMat : deckMat;
    strip(L, [[-HW - CURB, 0.02], [-HW, 0.02]], cm, { vScale: 4, surface: 'ground' });
    strip(L, [[HW, 0.02], [HW + CURB, 0.02]], cm, { vScale: 4, surface: 'ground' });
    strip(L, [[-DECK, 0.01], [-HW - CURB, 0.01]], dm, { vScale: 6, surface: 'ground' });
    strip(L, [[HW + CURB, 0.01], [DECK, 0.01]], dm, { vScale: 6, surface: 'ground' });
    const th = br.kind === 'viaduct' ? 2.4 : br.kind === 'trestle' || br.kind === 'rope' ? 1.2 : 1.6;
    strip(L, [[-DECK - 0.3, 0.25], [-DECK - 0.3, -th], [DECK + 0.3, -th], [DECK + 0.3, 0.25]], deckSideMats[br.kind], { vScale: 8, uScale: 4, shadow: !sp });
    // 우주 유리 다리 밑의 빛 띠
    if (sp) strip(L, [[DECK * 0.7, -th - 0.05], [-DECK * 0.7, -th - 0.05]], SPM.under, { vScale: 10 });
  }

  // ---------------------------------------------------------------- 섬 지형
  // 땅 샘플 해시 (가까운 도로 찾기용)
  const HASH = 20;
  const landHash = new Map();
  // 칸 번호를 숫자 하나로 (문자열 키보다 훨씬 빠름: 긴 코스의 지형 계산이 몇 초 걸렸음)
  const ckey = (a, b) => (a + 8192) * 16384 + (b + 8192);
  const hkey = (x, z) => ckey(Math.floor(x / HASH), Math.floor(z / HASH));
  for (let i = 0; i < SAMPLES; i++) {
    const s = samples[i];
    if (!s.land) continue;
    const k = hkey(s.pos.x, s.pos.z);
    if (!landHash.has(k)) landHash.set(k, []);
    landHash.get(k).push(s);
  }
  // 다리 샘플 해시: 다리가 섬 끝에서 시작하는 곳은 지형이 다리 상판보다 위로 올라오지 않게 (예전엔 초록 땅이 도로를 덮음)
  const bridgeHash = new Map();
  for (let i = 0; i < SAMPLES; i++) {
    const s = samples[i];
    if (s.land) continue;
    const k = hkey(s.pos.x, s.pos.z);
    if (!bridgeHash.has(k)) bridgeHash.set(k, []);
    bridgeHash.get(k).push(s);
  }
  function bridgeNear(x, z, r, fn) {
    const x0 = Math.floor((x - r) / HASH), x1 = Math.floor((x + r) / HASH), z0 = Math.floor((z - r) / HASH), z1 = Math.floor((z + r) / HASH);
    for (let a = x0; a <= x1; a++)
      for (let b = z0; b <= z1; b++) {
        const list = bridgeHash.get(ckey(a, b));
        if (list) for (const s of list) fn(s);
      }
  }
  function landNear(x, z, r, fn) {
    const x0 = Math.floor((x - r) / HASH), x1 = Math.floor((x + r) / HASH), z0 = Math.floor((z - r) / HASH), z1 = Math.floor((z + r) / HASH);
    for (let a = x0; a <= x1; a++)
      for (let b = z0; b <= z1; b++) {
        const list = landHash.get(ckey(a, b));
        if (list) for (const s of list) fn(s);
      }
  }

  // 섬 모양 (hull = 도로를 따라, discs = 원)
  const islands = (data.islands || []).map((isl, n) => {
    const hulls = (isl.hull || []).map(([t0, t1, pad]) => {
      const [a, b] = rangeI(t0, t1);
      const list = [];
      for (let i = a; i <= b; i++) if (S(i).land) list.push(S(i));
      // 끝이 다리로 이어지면 그쪽으로는 섬이 짧게 끝남
      const endA = !S(a - 1).land ? S(a) : null, endB = !S(b + 1).land ? S(b) : null;
      return { a, b, pad, list, endA, endB };
    });
    return {
      name: isl.name, n, hulls,
      discs: (isl.discs || []).map(([x, z, r]) => ({ x: x * SC, z: z * SC, r: r * SC })),
      peaks: (isl.peaks || []).map(([x, z, h, r]) => ({ x: x * SC, z: z * SC, h, r: r * SC })),
      holes: (isl.holes || []).map(([x, z, r]) => ({ x: x * SC, z: z * SC, r: r * SC })),
    };
  });
  const maxPad = Math.max(30, ...islands.flatMap((i) => i.hulls.map((h) => h.pad)));
  // 각 땅 샘플이 어느 hull에 속하는지
  const hullOf = new Map();
  for (const isl of islands) for (const h of isl.hulls) for (const s of h.list) hullOf.set(s, h), (s.hull = h);

  /** 섬 안이면 양수 (바닷가까지 남은 거리 정도), 밖이면 음수 */
  function field(x, z) {
    let f = -999;
    // hull: 가까운 땅 도로 샘플 (hull마다 가장 가까운 것)
    // (Math.hypot 대신 sqrt, 거리 제곱으로 비교: 긴 코스에서 지형 계산이 수 초 걸려 빠르게 함)
    const best = new Map();
    landNear(x, z, maxPad + 12, (s) => {
      const h = s.hull;
      if (!h) return;
      const dx = x - s.pos.x, dz = z - s.pos.z;
      const d2 = dx * dx + dz * dz;
      const cur = best.get(h);
      if (!cur) best.set(h, { d2, s });
      else if (d2 < cur.d2) (cur.d2 = d2), (cur.s = s);
    });
    for (const [h, { d2, s }] of best) {
      const d = Math.sqrt(d2);
      let v = h.pad - d;
      // 다리로 이어지는 끝: 진행 방향으로 벗어나면 빨리 끝남
      for (const [end, dir] of [[h.endA, -1], [h.endB, 1]]) {
        if (!end || Math.abs(s.i - end.i) > 8) continue;
        const along = ((x - end.pos.x) * end.tan.x + (z - end.pos.z) * end.tan.z) * dir;
        if (along > 0) v -= along * 4;
      }
      f = Math.max(f, v);
    }
    for (const isl of islands) for (const c of isl.discs) f = Math.max(f, c.r - Math.hypot(x - c.x, z - c.z));
    f += noise(x / 60, z / 60, 3) * 9;
    for (const isl of islands) for (const c of isl.holes) f = Math.min(f, Math.hypot(x - c.x, z - c.z) - c.r + noise(x / 9, z / 9, 2) * 2.5);
    return f;
  }

  // 지형을 평평하게 맞출 곳 (활주로, 착륙장, 지름길): { samples, half } — 아래 비행 루트를 만든 뒤 채움
  const flatZones = [];
  /** 가까운 땅 도로 정보 */
  function nearestLand(x, z, r = 60) {
    let best = null, bd = Infinity;
    landNear(x, z, r, (s) => {
      const d = (x - s.pos.x) ** 2 + (z - s.pos.z) ** 2;
      if (d < bd) (bd = d), (best = s);
    });
    return best ? { s: best, d: Math.sqrt(bd) } : null;
  }

  /** 지형 높이 (섬 밖이어도 계산은 함) */
  function terrainH(x, z) {
    // 주변 도로 높이의 가중 평균 → 자연스러운 기본 높이
    let sw = 0, sy = 0, nd = Infinity, ns = null, under = Infinity;
    landNear(x, z, 120, (s) => {
      const dx = x - s.pos.x, dz = z - s.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const e = d + 6;
      const w = 1 / (e * e * e);
      sw += w;
      sy += w * s.pos.y;
      if (d < nd) (nd = d), (ns = s);
      if (d < HW + CURB + 2.5) {
        // 도로 밑: 겹치는 모든 도로 면보다 낮게 (헤어핀 안쪽처럼 여러 도로가 가까운 곳)
        const l = (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z;
        under = Math.min(under, roadYAt(s, THREE.MathUtils.clamp(l, -HW - CURB, HW + CURB)));
      }
    });
    const base = sw > 0 ? sy / sw : 0;
    let H;
    if (ns && nd < HW + CURB + 1) {
      H = under - 0.3;
    } else {
      let edgeY = base, k = 1;
      if (ns) {
        const l = (x - ns.pos.x) * ns.right.x + (z - ns.pos.z) * ns.right.z;
        edgeY = roadYAt(ns, Math.sign(l) * (HW + CURB)) - 0.1;
        k = smooth(HW + CURB + 1, HW + 40, nd);
      }
      let natural = base + noise(x / 45, z / 45, 3) * 3.2 + noise(x / 13, z / 13, 2) * 0.6;
      for (const isl of islands)
        for (const p of isl.peaks) {
          const d = Math.hypot(x - p.x, z - p.z);
          if (d < p.r) natural += p.h * Math.pow(0.5 + 0.5 * Math.cos((Math.PI * d) / p.r), 1.3) * (1 + 0.18 * noise(x / 16, z / 16, 2));
        }
      H = edgeY * (1 - k) + natural * k;
      if (under < Infinity) H = Math.min(H, under - 0.1);
    }
    // 다리 상판 아래·옆: 상판보다 0.5 m 낮게, 상판에서 멀어질수록 천천히 원래 높이로 (높은 고가도로 밑은 영향 없음)
    bridgeNear(x, z, DECK + 16, (s) => {
      const dx = x - s.pos.x, dz = z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > DECK + 16) return;
      const l = dx * s.right.x + dz * s.right.z;
      const cap = roadYAt(s, THREE.MathUtils.clamp(l, -DECK, DECK)) - 0.5 + Math.max(0, d - DECK - 0.5) * 0.6;
      if (cap < H) H = cap;
    });
    // 활주로, 착륙장, 판자길 주변은 평평하게
    for (const z0 of flatZones) {
      if (!z0.box) {
        z0.box = new THREE.Box2().setFromPoints(z0.samples.map((q) => new THREE.Vector2(q.pos.x, q.pos.z)));
        z0.box.expandByScalar(z0.half + 15);
      }
      if (x < z0.box.min.x || x > z0.box.max.x || z < z0.box.min.y || z > z0.box.max.y) continue;
      let bd = Infinity, bs = null;
      for (const s of z0.samples) {
        const d = (x - s.pos.x) ** 2 + (z - s.pos.z) ** 2;
        if (d < bd) (bd = d), (bs = s);
      }
      const d = Math.sqrt(bd);
      if (d < z0.half + 2) H = Math.min(H, bs.pos.y - 0.3);
      else if (d < z0.half + 14) H = Math.min(H, THREE.MathUtils.lerp(bs.pos.y - 0.1, H, smooth(z0.half + 2, z0.half + 14, d)));
    }
    return { H, nd: ns ? nd : Infinity };
  }

  // ---------------------------------------------------------------- 하늘 협곡 비행 루트 (지형보다 먼저: 평평하게 할 곳)
  const altPaths = []; // { samples, half } 도로로 인정하는 길 (활주로, 착륙장, 판자길)
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
      out.push({ pos, tan, right, dist: d });
    }
    return out;
  };
  if (sky && sky.runway) {
    const rw = sky.runway;
    const s0 = sampleAt(rw.t);
    const lip = 14;
    // angle: 도로 방향에서 왼쪽으로 몇 도 틀어 뻗을지 (옆 도로·다리와 겹치지 않게)
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
      const c = ap.side * (HW + CURB + w / 2);
      return { pos: surf(s, c, 0, new THREE.Vector3()), tan: s.tan, right: s.right, dist: s.dist, w };
    });
    apron = { list, side: ap.side, widthAt, samples: pts, half: ap.width / 2 };
    altPaths.push({ samples: pts.filter((p) => p.w > 2), half: ap.width / 2 });
    flatZones.push({ samples: pts.filter((p) => p.w > 1), half: ap.width / 2 + 2 });
  }
  if (sky && sky.rings) {
    const R = (sky.ringRadius || 7) * 1;
    const ptsR = sky.rings.map(([x, y, z]) => new THREE.Vector3(x * SC, y, z * SC));
    const lipP = runway ? runway.end.pos.clone() : ptsR[0];
    const landP = apron ? apron.samples[Math.floor(apron.samples.length * 0.68)].pos.clone() : ptsR[ptsR.length - 1];
    skyPath = [lipP, ...ptsR, landP];
    rings = ptsR.map((p, k) => {
      const prev = skyPath[k], next = skyPath[k + 2];
      const dir = next.clone().sub(prev).normalize();
      return { pos: p, dir, r: R, index: k };
    });
  }
  // 판자 지름길
  let plank = null;
  if (data.shortcut) {
    const sc = data.shortcut;
    const sa = sampleAt(sc.t0), sb = sampleAt(sc.t1);
    const pa = surf(sa, sc.lat0 || 0), pb = surf(sb, sc.lat1 || 0);
    const dir = pb.clone().sub(pa);
    const len = Math.hypot(dir.x, dir.z);
    let L = lineList(pa, dir, len, (d) => THREE.MathUtils.lerp(pa.y, pb.y, d / len) + Math.sin((Math.PI * d) / len) * 0.8);
    // 본 도로와 겹치는 양 끝은 잘라냄 (도로 가장자리에서 시작/끝)
    const roadD = (p) => {
      let b = Infinity;
      for (let i = 0; i < SAMPLES; i += 2) b = Math.min(b, (samples[i].pos.x - p.x) ** 2 + (samples[i].pos.z - p.z) ** 2);
      return Math.sqrt(b);
    };
    const mid = Math.floor(L.length / 2);
    let k0 = 0, k1 = L.length - 1;
    for (let k = mid; k >= 0; k--) if (roadD(L[k].pos) < HW - 1) { k0 = k; break; }
    for (let k = mid; k < L.length; k++) if (roadD(L[k].pos) < HW - 1) { k1 = k; break; }
    L = L.slice(k0, k1 + 1);
    plank = { samples: L, half: sc.width / 2, length: len, data: sc };
    altPaths.push(plank);
    flatZones.push({ samples: L, half: sc.width / 2 });
  }

  // ---------------------------------------------------------------- 지형 메시 (격자 + 마칭 스퀘어: 섬 가장자리가 매끈하게)
  const bb = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
  for (const isl of islands) {
    for (const h of isl.hulls) for (const s of h.list) bb.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z)), bb.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
    for (const c of isl.discs) bb.expandByPoint(new THREE.Vector2(c.x - c.r, c.z - c.r)), bb.expandByPoint(new THREE.Vector2(c.x + c.r, c.z + c.r));
  }
  bb.expandByScalar(maxPad + 24);
  const gx0 = Math.floor(bb.min.x / CELL) * CELL, gz0 = Math.floor(bb.min.y / CELL) * CELL;
  const NX = Math.ceil((bb.max.x - gx0) / CELL), NZ = Math.ceil((bb.max.y - gz0) / CELL);
  const F = new Float32Array((NX + 1) * (NZ + 1));
  const HG = new Float32Array((NX + 1) * (NZ + 1));
  const ND = new Float32Array((NX + 1) * (NZ + 1));
  const gi = (i, j) => j * (NX + 1) + i;
  // 섬이 전혀 없는 덩어리(24×24칸)는 계산을 건너뜀 (긴 코스는 격자 대부분이 빈 하늘)
  const CNX = Math.ceil(NX / CHUNK) + 1, CNZ = Math.ceil(NZ / CHUNK) + 1;
  const chunkOn = new Uint8Array(CNX * CNZ);
  {
    const half = (CHUNK * CELL) / 2;
    const reach = half * 1.42 + 22; // 덩어리 반대각선 + 노이즈 여유
    for (let cj = 0; cj < CNZ; cj++)
      for (let ci = 0; ci < CNX; ci++) {
        const cx = gx0 + ci * CHUNK * CELL + half, cz = gz0 + cj * CHUNK * CELL + half;
        let on = false;
        landNear(cx, cz, reach + maxPad, (s) => {
          const h = hullOf.get(s);
          if (!on && h && Math.hypot(cx - s.pos.x, cz - s.pos.z) < reach + h.pad) on = true;
        });
        for (const isl of islands) for (const c of isl.discs) if (Math.hypot(cx - c.x, cz - c.z) < reach + c.r) on = true;
        chunkOn[cj * CNX + ci] = on ? 1 : 0;
      }
  }
  for (let j = 0; j <= NZ; j++)
    for (let i = 0; i <= NX; i++) {
      const x = gx0 + i * CELL, z = gz0 + j * CELL;
      if (!chunkOn[Math.floor(j / CHUNK) * CNX + Math.floor(i / CHUNK)]) {
        F[gi(i, j)] = -999;
        continue;
      }
      const f = field(x, z);
      F[gi(i, j)] = f;
      if (f > -CELL * 2) {
        const { H, nd } = terrainH(x, z);
        HG[gi(i, j)] = H - (f < 7 && nd > HW + 4 ? (7 - Math.max(0, f)) * 0.3 : 0); // 가장자리는 둥글게 처짐
        ND[gi(i, j)] = nd;
      }
    }
  /** 섬 위인가 + 지형 높이 (격자 보간). 섬 밖이면 null */
  function heightAt(x, z) {
    const fi = (x - gx0) / CELL, fj = (z - gz0) / CELL;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return null;
    const u = fi - i, v = fj - j;
    const f = THREE.MathUtils.lerp(THREE.MathUtils.lerp(F[gi(i, j)], F[gi(i + 1, j)], u), THREE.MathUtils.lerp(F[gi(i, j + 1)], F[gi(i + 1, j + 1)], u), v);
    if (f <= 0) return null;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(HG[gi(i, j)], HG[gi(i + 1, j)], u), THREE.MathUtils.lerp(HG[gi(i, j + 1)], HG[gi(i + 1, j + 1)], u), v);
  }
  const fieldAt = (x, z) => {
    const fi = (x - gx0) / CELL, fj = (z - gz0) / CELL;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return -999;
    const u = fi - i, v = fj - j;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(F[gi(i, j)], F[gi(i + 1, j)], u), THREE.MathUtils.lerp(F[gi(i, j + 1)], F[gi(i + 1, j + 1)], u), v);
  };

  // 색: 잔디(노이즈), 도로가, 경사면 바위, 산 꼭대기 눈, 가장자리 흙
  // 정글 바닥: 짙은 초록(노이즈) + 도로가 흙 + 경사면 이끼 바위 + 군데군데 진흙 + 가장자리 붉은 흙
  const cGrassA = new THREE.Color('#3f8a2e'), cGrassB = new THREE.Color('#5aa53a'), cGrassC = new THREE.Color('#2f6f25');
  const cShoulder = new THREE.Color('#6f6a3a'), cRock = new THREE.Color('#6f7a5a'), cRock2 = new THREE.Color('#5a5a4a');
  const cMud = new THREE.Color('#7a5a36'), cEarth = new THREE.Color('#8a5a34'), cTmp = new THREE.Color();
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const skirtMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const segs = []; // 가장자리 선분 [keyA, keyB, pA, pB]
  const crossKey = (i, j, dir) => `${dir}${i},${j}`;
  for (let cj = 0; cj < NZ; cj += CHUNK)
    for (let ci = 0; ci < NX; ci += CHUNK) {
      const P = [], C = [];
      const skirtP = [], skirtC = [];
      for (let j = cj; j < Math.min(NZ, cj + CHUNK); j++)
        for (let i = ci; i < Math.min(NX, ci + CHUNK); i++) {
          // 네 모서리 (시계 반대: 위에서 보면 x→, z↓ 이므로 앞면이 위를 향하도록 아래에서 뒤집음)
          const cs = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
          const fv = cs.map(([a, b]) => F[gi(a, b)]);
          if (fv.every((f) => f <= 0)) continue;
          const poly = []; // {x, z, y, key?, nd, f}
          for (let k = 0; k < 4; k++) {
            const [a, b] = cs[k], [a2, b2] = cs[(k + 1) % 4];
            const fa = fv[k], fb = fv[(k + 1) % 4];
            if (fa > 0) poly.push({ x: gx0 + a * CELL, z: gz0 + b * CELL, y: HG[gi(a, b)], nd: ND[gi(a, b)], f: fa });
            if (fa > 0 !== fb > 0) {
              const u = fa / (fa - fb);
              const ya = fa > 0 ? HG[gi(a, b)] : HG[gi(a2, b2)];
              const key = b === b2 ? crossKey(Math.min(a, a2), b, 'h') : crossKey(a, Math.min(b, b2), 'v');
              poly.push({
                x: gx0 + (a + (a2 - a) * u) * CELL, z: gz0 + (b + (b2 - b) * u) * CELL,
                y: THREE.MathUtils.lerp(HG[gi(a, b)], HG[gi(a2, b2)], u) * 0 + ya, nd: 99, f: 0, key,
              });
            }
          }
          if (poly.length < 3) continue;
          // 경계 높이: 안쪽 꼭짓점 높이를 그대로 써서 가장자리가 튀지 않게
          for (let k = 1; k < poly.length - 1; k++) {
            // 위를 향하도록 (0, k+1, k) 순서
            for (const p of [poly[0], poly[k + 1], poly[k]]) P.push(p.x, p.y, p.z);
          }
          // 가장자리 선분 (연속한 두 교차점)
          for (let k = 0; k < poly.length; k++) {
            const p = poly[k], q = poly[(k + 1) % poly.length];
            if (p.key && q.key) segs.push([p.key, q.key, p, q]);
          }
        }
      if (!P.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.computeVertexNormals();
      // 면마다 색
      const nrm = geo.attributes.normal;
      for (let t = 0; t < P.length / 9; t++) {
        const x = (P[t * 9] + P[t * 9 + 3] + P[t * 9 + 6]) / 3, y = (P[t * 9 + 1] + P[t * 9 + 4] + P[t * 9 + 7]) / 3, z = (P[t * 9 + 2] + P[t * 9 + 5] + P[t * 9 + 8]) / 3;
        const ny = nrm.getY(t * 3);
        const n1 = noise(x / 23, z / 23, 2);
        cTmp.copy(cGrassA).lerp(n1 > 0 ? cGrassB : cGrassC, Math.min(1, Math.abs(n1) * 1.6));
        const nr = nearestLand(x, z, 20);
        if (nr && nr.d < HW + 5) cTmp.lerp(cShoulder, 0.6);
        const f = fieldAt(x, z);
        if (f < 4) cTmp.lerp(cEarth, smooth(4, 0.5, f));
        if (ny < 0.82) cTmp.lerp(ny < 0.62 ? cRock2 : cRock, smooth(0.82, 0.7, ny));
        const n2 = noise(x / 9, z / 9, 2);
        if (n2 > 0.35) cTmp.lerp(cMud, Math.min(1, (n2 - 0.35) * 1.2)); // 군데군데 진흙
        for (let k = 0; k < 3; k++) C.push(cTmp.r, cTmp.g, cTmp.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      const m = new THREE.Mesh(geo, terrainMat);
      m.receiveShadow = true;
      addGround(m, 'ground');
    }

  // 가장자리 고리 잇기 → 절벽 띠(skirt) + 섬 밑바닥
  const adj = new Map();
  for (const sg of segs) {
    for (const [k, o, p] of [[sg[0], sg[1], sg[2]], [sg[1], sg[0], sg[3]]]) {
      if (!adj.has(k)) adj.set(k, { p, n: [] });
      adj.get(k).n.push(o);
    }
  }
  const loops = [];
  const used = new Set();
  for (const [k0] of adj) {
    if (used.has(k0)) continue;
    const loop = [];
    let k = k0, prev = null;
    while (k && !used.has(k)) {
      used.add(k);
      const node = adj.get(k);
      loop.push(node.p);
      const next = node.n.find((o) => o !== prev && !used.has(o));
      prev = k;
      k = next;
    }
    if (loop.length > 6) loops.push(loop);
  }
  {
    const P = [], C = [];
    const cLip = new THREE.Color('#4a6a2a'), cStone = new THREE.Color('#7d7460'), cStone2 = new THREE.Color('#5e5a48');
    const GORGE_FLOOR = data.gorgeFloor ?? -36;
    const allHoles = islands.flatMap((i) => i.holes);
    const holeNear = () => true; // 정글 고원: 바깥 가장자리·협곡 모두 아래 정글 바다까지 깊은 절벽
    for (const loop of loops) {
      for (let k = 0; k < loop.length; k++) {
        const p = loop[k], q = loop[(k + 1) % loop.length];
        if (Math.hypot(p.x - q.x, p.z - q.z) > CELL * 3) continue;
        const deep = (pp) => (holeNear(pp.x, pp.z) ? pp.y - GORGE_FLOOR : 5 + noise(pp.x / 7, pp.z / 7) * 3); // 협곡 둘레는 강바닥까지
        const dp = deep(p), dq = deep(q);
        const quad = [[p.x, p.y + 0.05, p.z], [q.x, q.y + 0.05, q.z], [q.x, q.y - dq, q.z], [p.x, p.y - dp, p.z]];
        for (const id of [0, 1, 2, 0, 2, 3]) P.push(...quad[id]);
        for (const id of [0, 1, 2, 0, 2, 3]) {
          const c = id < 2 ? cLip : (k % 3 ? cStone : cStone2);
          C.push(c.r, c.g, c.b);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.computeVertexNormals();
    const skirt = new THREE.Mesh(geo, skirtMat);
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    group.add(skirt);
  }

  // ---------------------------------------------------------------- 가드레일 (낭떠러지 쪽, 다리 양쪽)
  const noRail = data.noRail || [];
  // 각 샘플에서 가장 가까운 다리까지 샘플 수 (다리 위 = 0)
  const BRIDGE_EXT = Math.round((45 / length) * SAMPLES);
  const RAIL_FLARE = 7; // 레일 끝이 바깥으로 벌어지는 폭 (m)
  const nearBridge = new Float32Array(SAMPLES).fill(1e9);
  for (let pass = 0; pass < 2; pass++)
    for (let n = 0; n < SAMPLES; n++) {
      const i = pass ? SAMPLES - 1 - n : n;
      if (samples[i].bridge) nearBridge[i] = 0;
      else nearBridge[i] = Math.min(nearBridge[i], nearBridge[wrapI(i + (pass ? 1 : -1))] + 1);
    }
  for (let n = 0; n < SAMPLES; n++) nearBridge[n] = Math.min(nearBridge[n], nearBridge[wrapI(n - 1)] + 1); // 고리 이음매
  for (let n = SAMPLES - 1; n >= 0; n--) nearBridge[n] = Math.min(nearBridge[n], nearBridge[wrapI(n + 1)] + 1);
  const railSide = [-1, 1].map((side) => {
    const need = new Uint8Array(SAMPLES);
    const p = new THREE.Vector3();
    for (let i = 0; i < SAMPLES; i++) {
      const s = samples[i];
      if (noRail.some(([t0, t1, sd]) => sd === side && inRangeT(s.t, t0, t1))) continue;
      if (s.bridge) need[i] = 1;
      else {
        let edge = false;
        for (const l of [HW + 6, HW + 11]) {
          surf(s, side * l, 0, p);
          if (fieldAt(p.x, p.z) < 3) edge = true;
        }
        need[i] = edge ? 1 : 0;
      }
    }
    // 짧은 틈 메우기, 짧은 조각 없애기
    const fill = (val, maxLen) => {
      let i = 0;
      while (i < SAMPLES) {
        if (need[i] === val) {
          let j = i;
          while (j < i + SAMPLES && need[wrapI(j)] === val) j++;
          if (j - i < maxLen) for (let k = i; k < j; k++) need[wrapI(k)] = 1 - val;
          i = j;
        } else i++;
      }
    };
    // 다리 앞뒤 땅에도 가드레일을 이어 붙임 (다리 난간이 갑자기 끊기지 않게)
    for (let i = 0; i < SAMPLES; i++) {
      if (need[i] || nearBridge[i] > BRIDGE_EXT) continue;
      if (noRail.some(([t0, t1, sd]) => sd === side && inRangeT(samples[i].t, t0, t1))) continue;
      // 2026-11-09 코너 다듬기: 코너(반지름 약 250 m 아래)의 안쪽에는 이어 붙이지 않음.
      // 안쪽 레일 끝이 바깥으로 벌어지면서(RAIL_FLARE) 에이펙스를 조금만 파고들어도 레일 끝에 정면으로 박혀
      // 속도가 0이 됐음 (캐니언 헤어핀). 안쪽은 땅(잔디)이라 레일이 없어도 됨
      const ts = turnSign[i];
      if (Math.abs(ts) > 0.15 && side === (ts > 0 ? -1 : 1)) continue;
      need[i] = 1;
    }
    fill(0, 14);
    fill(1, 8);
    return need;
  });
  // 레일 위치 (중심선에서 m): 다리 위 = 상판 끝, 땅 = 연석 바깥. 다리 가까운 땅은 두 위치를 부드럽게 이음
  // 다리에서 먼 쪽 끝은 바깥으로 벌어짐 (깔때기): 코너를 넓게 돌아 나온 차가 레일 뒤에 갇히지 않고 도로로 안내됨
  function railLatAt(s) {
    if (s.bridge) return DECK;
    const nb = nearBridge[s.i];
    const base = THREE.MathUtils.lerp(DECK, HW + CURB + 1.6, Math.min(1, nb / (BRIDGE_EXT * 0.4)));
    return base + (nb <= BRIDGE_EXT ? RAIL_FLARE * smooth(BRIDGE_EXT * 0.5, BRIDGE_EXT, nb) : 0);
  }
  /** 차가 있는 쪽에 레일이 있으면 그 레일까지 거리 (m), 없으면 null — car.js가 레일을 비스듬히 뚫고 나가지 않게 막는 데 씀 */
  function railLimit(near) {
    const side = near.lateral < 0 ? 0 : 1;
    if (!railSide[side][near.index]) return null;
    return railLatAt(near.sample);
  }
  const railMat = new THREE.MeshStandardMaterial({ color: '#e2dcc8', metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide });
  const railRedMat = new THREE.MeshStandardMaterial({ color: '#2f8a3a', roughness: 0.5, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const posts = [];
  const railRuns = [];
  for (const [n, side] of [[0, -1], [1, 1]]) {
    const need = railSide[n];
    for (const [a, b] of runsOf((i) => need[i] === 1)) {
      const L = spanList(a, b);
      const lat = (s) => side * railLatAt(s);
      // 레일 판 2줄 (위: 흰 철판, 아래: 빨간 띠). 우주 구간은 네온 (하늘색 + 분홍)
      for (const [sp, m1, m2] of [[false, railMat, railRedMat], [true, SPM.rail, SPM.rail2]]) {
        for (const [c, d] of runsIn(L, (s) => !!s.space === sp)) {
          const LL = L.slice(c, d + 1);
          strip(LL, (s) => [[lat(s), 0.62], [lat(s), 1.0]], m1, { vScale: 4 });
          strip(LL, (s) => [[lat(s), 0.36], [lat(s), 0.56]], m2, { vScale: 4 });
        }
      }
      // 보이지 않는 충돌 벽
      // (보이는 레일과 같은 선. 예전엔 0.15 m 바깥이었음. 차 귀퉁이 검사는 car.keepInsideRail)
      for (const m of strip(L, (s) => [[lat(s), -0.6], [lat(s), 1.5]], wallMat, { surface: 'barrier' })) m.visible = false;
      const stepN = Math.max(1, Math.round((3.2 / length) * SAMPLES));
      for (let k = 0; k < L.length; k += stepN) {
        const s = L[k];
        const p = surf(s, lat(s) + side * 0.12, 0);
        posts.push({ x: p.x, y: p.y, z: p.z, ry: Math.atan2(s.tan.x, s.tan.z), space: !!s.space });
      }
      railRuns.push({ side, a, b });
    }
  }
  const postGeo = new THREE.BoxGeometry(0.16, 1.15, 0.16).translate(0, 0.52, 0);
  for (const [sp, mat] of [[false, new THREE.MeshStandardMaterial({ color: '#6b5a40', metalness: 0.2, roughness: 0.7 })], [true, SPM.post]]) {
    const list = posts.filter((p) => p.space === sp);
    if (!list.length) continue;
    const postIm = new THREE.InstancedMesh(postGeo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach((p, i) => {
      q.setFromAxisAngle(UP, p.ry);
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
      postIm.setMatrixAt(i, m4);
    });
    postIm.castShadow = !sp;
    postIm.userData.world = sp ? 'space' : 'cloud';
    group.add(postIm);
  }

  // ---------------------------------------------------------------- 출발선
  const s0 = samples[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  line.material.map.repeat.set(W / 4, 1);
  {
    const x = new THREE.Vector3().crossVectors(s0.tan3, s0.up);
    line.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, s0.tan3, s0.up));
  }
  line.position.copy(s0.pos).addScaledVector(s0.up, 0.04);
  group.add(line);

  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- 찾기, 충돌
  /** 가장 가까운 코스 지점. 높이 차이도 따져서 교차로(고가도로 위/아래)를 구분 */
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
  /** 중심선까지의 수평 거리 */
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
    // 차를 코스에 놓을 때(placeAt)는 높이 30에서 아래로 쏩니다. 고가도로 아래 지점이면
    // 위의 다리에 놓이지 않도록, 방금 고른 코스 지점 바로 위에서 쏘게 바꿉니다
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

  const boostPadAt = () => null; // 정글엔 부스트 패드 없음

  // ---------------------------------------------------------------- 저중력 구역 (떠 있는 돌 언덕)
  // data.gravity = [[t0, t1, 배수], ...]. 구간 도로 근처(35 m)면 배수, 구간 양 끝 25 m에서 부드럽게 1로
  const gravZones = (data.gravity || []).map(([t0, t1, k]) => {
    const [a, b] = rangeI(t0, t1);
    const pts = [];
    for (let i = a; i <= b; i += 3) pts.push(S(i).pos);
    const box = new THREE.Box3().setFromPoints(pts).expandByScalar(40);
    return { t0, t1, pts, k, box, a: pts[0], b: pts[pts.length - 1] };
  });
  function gravityAt(pos) {
    for (const z of gravZones) {
      if (!z.box.containsPoint(pos)) continue;
      let bd = Infinity;
      for (const p of z.pts) bd = Math.min(bd, (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2);
      if (bd > 35 * 35) continue;
      const de = Math.min(Math.hypot(pos.x - z.a.x, pos.z - z.a.z), Math.hypot(pos.x - z.b.x, pos.z - z.b.z));
      return THREE.MathUtils.lerp(1, z.k, smooth(0, 25, de));
    }
    return 1;
  }

  /** 다른 길(활주로, 착륙장, 판자길) 위인가 */
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
  /** 하늘 협곡 위를 날고 있는가 (비행 루트 근처 + 충분히 높음) */
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
  const shortcutDist = (pos) => (plank ? altDist(pos, plank).d : Infinity);
  function isOnRoad(pos, near = nearest(pos)) {
    return near.dist < HW + kerbAt(near.index, near.lateral < 0 ? -1 : 1) || onAltPath(pos);
  }
  /** 차가 연석·잔디(다리 위면 갓길)에 얼마나 걸쳤는지. runoff = 잔디가 아니라 포장된 갓길 */
  function edgeInfo(pos, near = nearest(pos)) {
    if (onAltPath(pos)) return { kerb: 0, off: 0, runoff: false };
    const k = kerbAt(near.index, near.lateral < 0 ? -1 : 1);
    return { ...edgeFraction(near.dist, HW, HW + k), runoff: !!near.sample.bridge || (!!near.sample.apron && near.dist < HW + k + APRON) };
  }
  /** (x, z)가 돌 포장 갓길 위인지 (풍경이 풀·바위를 안 놓게) */
  function apronAt(x, z) {
    const near = nearest(new THREE.Vector3(x, 0, z));
    return !!near.sample.apron && near.dist < HW + kerbAt(near.index, near.lateral < 0 ? -1 : 1) + APRON + 1.5;
  }

  const outline = samples.filter((_, i) => i % 6 === 0 && i < SAMPLES).map((s) => [s.pos.x, s.pos.z]);
  // 미니맵 조각: 정글 구간(흰 선) / 지하 세계 구간(주황 점선). hud가 지원하면 outline 대신 이걸로 그림
  const minimapParts = runsOf((i) => !!samples[i].space).map(([a, b]) => ({
    kind: 'under', color: '#ff8a3a', dash: [5, 4], label: '🌋',
    pts: spanList(a, b).filter((_, k, L) => k % 6 === 0 || k === L.length - 1).map((s) => [s.pos.x, s.pos.z]),
  }));

  function animate(time) {
    SPM.road.emissiveIntensity = 0.75 + 0.25 * Math.sin(time * 2.1); // 용암 틈이 숨 쉬듯 빛남
  }

  // placeAt이 어느 지점을 골랐는지 기억 (castRay 참고)
  const sampleAtTracked = (t) => (lastSampled = sampleAt(t));

  // ---------------------------------------------------------------- 세계 전환 (구름섬 ↔ 우주)
  // 지금 보이는 물체만 (보이지 않는 충돌 벽은 그대로 숨김). 숨겨도 레이 충돌은 그대로 됨
  const worldObjs = group.children.filter((o) => o.visible);
  let curWorld = false;
  function setWorld(space) {
    space = !!space;
    if (space === curWorld) return;
    curWorld = space;
    for (const o of worldObjs) o.visible = (o.userData.world === 'space') === space;
  }
  for (const o of worldObjs) o.visible = o.userData.world !== 'space';
  const dimension = dim
    ? { ...dim, inSpaceT, portalA: sampleAt(dim.t0), portalB: sampleAt(dim.t1), spaceSamples: samples.slice(0, SAMPLES).filter((s) => s.space) }
    : null;
  const buildMs = Math.round(performance.now() - buildT0);

  return {
    data, width: W, length, samples, sampleAt: sampleAtTracked, nearest, nearestRaw, castRay, boostPadAt, animate, outline,
    shortcut: null, shortcutDist, onShortcut, isOnRoad, edgeInfo, racingLine, lineY, kerbWidth: CURB, kerbAt, group, groundMeshes,
    arena: false, pad: null, inPad: () => false, spawn: null,
    sea: null, inSea: () => false, waterRanges: [], isWaterT: () => false, buoys: [],
    // 그랑프리 방식 (gpCorners.js 코너 표지판이 씀) + 정글 전용
    grandprix: true, jungle: true, gravityAt, gravZones, apronAt, minimapParts, marks: data.marks || {}, surf, roadYAt, heightAt, fieldAt, islands, loops, bridgeRuns, railRuns, railSide, railLimit, deckHalf: DECK, curb: CURB,
    runway, apron, plank, rings, skyPath, inSkyCorridor, onAltPath, altPaths, indexAt, S, spanList, noise,
    dimension, setWorld, get inSpace() { return curWorld; }, buildMs, sampleCount: SAMPLES,
  };
}
