// 정글 유적 · 용암 지하 세계 위험 (2026-11-15 jungle2, 사용자 "차원 이동이 배경만 바뀜 → 그 배경에 맞는 특징")
//
//   지하 세계에서만 운전이 달라지는 규칙 두 가지 (data/jungle.json 의 lavaEdges·lavaCut, 생성기 .debug/jungle_gen.py):
//   1) 난간 없는 용암 길 (lavaEdges.open): 간헐천 직선·돌아오는 직선·시케인은 난간이 없고, 연석 밖 1.2 m 아래가 용암.
//      떨어져 용암에 닿으면(도로보다 0.9 m 아래 + 길 끝 밖) 0.12초 뒤 뒤로 복귀 + "🔥 용암에 빠졌어요!"
//      (gp 우주 space2와 같은 방식. 길 모양·난간 제거·빛나는 가장자리 선은 jungleTrack.js)
//   2) 용암 둑길 (lavaCut): 큰 U자 안쪽 용암 호수를 가로지르는 낮은 지름길 (원래 길보다 약 95 m 짧음).
//      호수 용암이 레이스 시계(race.clock, 리플레이는 리플레이 시계)로 오르내림 → 같은 시각이면 모두 같은 높이 (온라인·리플레이 같음).
//      빠졌을 때만 지나갈 수 있고, 잠기면 둑길 위도 용암 → 닿으면 둑길 앞(갈림길 30 m 뒤)으로 복귀.
//      갈림길 문 신호등(초록·노랑 깜빡·빨강)·남은 초·둑길 가장자리 불빛 색·차오를 때 우르릉 소리·알림으로 미리 보임.
//      봇은 레이싱 라인(원래 길)만 탐 → 사람만 고르는 위험한 지름길. 같은 규칙은 봇에게도 적용 (밀려서 떨어지면 복귀)
//   jungleProps.js 가 만들고 update(dt, car)(물리 스텝마다)·animate(time)(그릴 때마다)·reset()을 부름. 결과는 game.props.lavaHz
import * as THREE from 'three';
import { canvasTexture, glowTexture, seededRandom } from './jungleUtil.js';

const TAU = Math.PI * 2;
const smooth01 = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** 흐르는 용암 텍스처 (밝은 틈 + 검붉은 껍질) */
function lavaTex() {
  const rnd = seededRandom(52);
  return canvasTexture(256, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#ff6a12');
    grd.addColorStop(0.5, '#ff9a2a');
    grd.addColorStop(1, '#ff5a08');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // 식은 껍질 조각
    for (let i = 0; i < 70; i++) {
      const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 26;
      g.fillStyle = `rgba(${60 + rnd() * 40 | 0},${14 + rnd() * 14 | 0},4,${0.45 + rnd() * 0.35})`;
      g.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU, rr = r * (0.6 + rnd() * 0.5);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.fill();
      // 같은 조각을 반대편에도 (이어 붙였을 때 끊김 없게)
      if (x > w - r) {
        g.save();
        g.translate(-w, 0);
        g.fill();
        g.restore();
      }
    }
    // 밝은 줄기
    g.strokeStyle = 'rgba(255,240,170,0.65)';
    g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      let x = rnd() * w, y = rnd() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) g.lineTo((x += (rnd() - 0.5) * 30), (y += 8 + rnd() * 16));
      g.stroke();
    }
  });
}

function rockTex() {
  const rnd = seededRandom(53);
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#231915';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 22 + rnd() * 34;
      g.fillStyle = `rgba(${v + 8},${v},${v - 6},0.6)`;
      g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3);
    }
    g.strokeStyle = 'rgba(255,90,20,0.55)';
    g.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) {
      let x = rnd() * w, y = rnd() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) g.lineTo((x += (rnd() - 0.5) * 24), (y += 6 + rnd() * 10));
      g.stroke();
    }
  });
}

/** 떠 있는 경고판 (용암색) */
function signTex(title, sub, color) {
  return canvasTexture(512, 192, (g, w, h) => {
    g.fillStyle = 'rgba(30,14,8,0.94)';
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
    g.font = '900 56px "Segoe UI","Malgun Gothic",sans-serif';
    g.fillText(title, w / 2, 92);
    g.fillStyle = color;
    g.font = '700 30px "Segoe UI","Malgun Gothic",sans-serif';
    g.fillText(sub, w / 2, 150);
  });
}

/** 점이 다각형(x, z) 안에 있는가 */
function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** 여러 (위치, uv, 번호) 조각을 한 메시로 */
function mergeParts(parts, mat) {
  let nv = 0, ni = 0;
  for (const p of parts) (nv += p.pos.length / 3), (ni += p.idx.length);
  if (!nv) return null;
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of parts) {
    pos.set(p.pos, ov * 3);
    uv.set(p.uv, ov * 2);
    for (let k = 0; k < p.idx.length; k++) idx[oi + k] = p.idx[k] + ov;
    ov += p.pos.length / 3;
    oi += p.idx.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, mat);
}

export function createJungleHazards(track, scene) {
  const HZc = track.lavaEdges && track.lavaEdges.cfg;
  if (!HZc || !track.dimension) return null;
  const CUT = track.lavaCut;
  const S = track.samples, N = S.length - 1, ds = track.length / N;
  const HW = track.width / 2, E = HW + (track.curb || 1.6);
  const wrap = (i) => ((i % N) + N) % N;
  const qs = new URLSearchParams(location.search);
  const DROP = HZc.lavaDrop ?? 1.2;
  const FALL_BELOW = (HZc.fall && HZc.fall.below) ?? 0.9, FALL_DELAY = (HZc.fall && HZc.fall.delay) ?? 0.12;
  const stats = { falls: 0, playerFalls: 0, botFalls: 0, cutFalls: 0, edgeFalls: 0, where: [], cutUse: 0, cutOpenUse: 0 };
  const rnd = seededRandom(1115);

  const group = new THREE.Group();
  group.name = 'lavaHazards';
  group.visible = false;
  scene.add(group);
  const glow = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.35)');
  const lavaT = lavaTex();
  lavaT.repeat.set(1, 1);
  const lavaMat = new THREE.MeshBasicMaterial({ map: lavaT, color: '#ffffff' });
  const basinT = lavaT.clone();
  basinT.needsUpdate = true;
  const basinMat = new THREE.MeshBasicMaterial({ map: basinT, color: '#ffffff', side: THREE.DoubleSide });
  const rockT = rockTex();
  const rockMat = new THREE.MeshStandardMaterial({ map: rockT, roughness: 0.95, emissive: '#ff4a10', emissiveIntensity: 0.08, side: THREE.DoubleSide });

  // ---------------------------------------------------------------- 시계: 용암 호수 높이 (레이스 시계 → 모두 같음)
  const CY = (CUT && CUT.cfg.cycle) || { period: 24, open: 10, rise: 2.5, flood: 9, offset: 0, warn: 3.5 };
  const LV = (CUT && CUT.cfg.lava) || [0, 1];
  const LOW = CUT ? CUT.low : 0;
  const SAFE = LOW - 0.15; // 용암이 이 높이보다 낮으면 둑길을 지나갈 수 있음
  let localClock = 0;
  function raceClock() {
    const g = window.game;
    if (g && g.replay && g.replay.active) {
      const st = g.replay.state;
      if (st && Number.isFinite(st.t)) return st.t;
    }
    if (g && g.race && Number.isFinite(g.race.clock)) return g.race.clock;
    return localClock;
  }
  /** 시계 c에서 호수 상태: level(높이), f(0 빠짐 ~ 1 잠김), open(지나갈 수 있음), secs(지금 상태가 바뀌기까지 초), warn */
  function lakeAt(c) {
    const P = CY.period;
    const ph = (((c + (CY.offset || 0)) % P) + P) % P;
    const t1 = CY.open, t2 = t1 + CY.rise, t3 = t2 + CY.flood, fallLen = P - t3;
    let f;
    if (ph < t1) f = 0;
    else if (ph < t2) f = smooth01((ph - t1) / CY.rise);
    else if (ph < t3) f = 1;
    else f = 1 - smooth01((ph - t3) / fallLen);
    const level = LV[0] + (LV[1] - LV[0]) * f;
    // 지나갈 수 있는 마지막·처음 순간 (용암이 SAFE를 넘는 때): 차오름 중 / 빠짐 중
    const kSafe = THREE.MathUtils.clamp((SAFE - LV[0]) / (LV[1] - LV[0]), 0, 1);
    const closeAt = t1 + CY.rise * invSmooth(kSafe), openAt = t3 + fallLen * invSmooth(1 - kSafe);
    const open = level < SAFE;
    let secs;
    if (open) secs = ph < closeAt ? closeAt - ph : P - ph + closeAt;
    else secs = openAt - ph;
    const warn = open && secs < (CY.warn ?? 3.5);
    return { level, f, open, secs, warn, phase: ph };
  }
  function invSmooth(y) {
    // smooth01의 역 (이분법)
    let a = 0, b = 1;
    for (let k = 0; k < 24; k++) {
      const m = (a + b) / 2;
      if (smooth01(m) < y) a = m;
      else b = m;
    }
    return (a + b) / 2;
  }

  // ---------------------------------------------------------------- 1) 난간 없는 곳 옆 용암 강 (고정 높이 = 도로 − DROP) + 바깥 현무암 둑
  const basin = CUT ? CUT.cfg.basin : null;
  // 다른 도로(나선 등)와 겹치지 않게 폭을 줄임: 지하 세계 샘플 중 앞뒤 80 m 밖의 도로까지 거리
  const underIdx = [];
  for (let i = 0; i < N; i += 3) if (S[i].space) underIdx.push(i);
  function otherRoadDist(i, x, z) {
    let bd = Infinity;
    for (const j of underIdx) {
      let dj = Math.abs(j - i);
      dj = Math.min(dj, N - dj) * ds;
      if (dj < 80) continue;
      const p = S[j].pos;
      bd = Math.min(bd, (p.x - x) ** 2 + (p.z - z) ** 2);
    }
    return Math.sqrt(bd);
  }
  const ribbonParts = [], bankParts = [];
  const zones = []; // 경고용 구간 { a, b }
  const P0 = new THREE.Vector3();
  const isOpenNoJoin = (i, sd) => track.isOpen(i, sd) && !(track.isJoin && track.isJoin(i, sd));
  for (const r of track.openRuns) {
    zones.push({ a: r.a, b: r.b, warnedAt: -1e9 });
    for (const sd of [-1, 1]) {
      // 이 쪽 샘플 목록 (2 샘플 간격), 호수 위·다른 도로 근처는 끊음
      let cur = null;
      const flush = () => {
        if (cur && cur.length > 2) buildRibbon(cur, sd);
        cur = null;
      };
      for (let i = r.a; i <= r.b; i += 2) {
        const q = wrap(i), s = S[q];
        if (!isOpenNoJoin(q, sd)) {
          flush();
          continue;
        }
        track.surf(s, sd * (E + 10), 0, P0);
        if (basin && inPoly(basin, P0.x, P0.z)) {
          flush();
          continue;
        }
        const room = otherRoadDist(q, P0.x, P0.z) - 10 - 14;
        const Wd = THREE.MathUtils.clamp(room + 10, 8, 30);
        (cur = cur || []).push({ s, i: q, Wd });
      }
      flush();
    }
  }
  function buildRibbon(list, sd) {
    // 용암 면: 가장자리(E+0.05) ~ E+Wd, 높이 −DROP. uv = 세상 거리(8 m에 한 번)
    const cols = [0, 0.25, 0.5, 0.75, 1];
    const pos = [], uv = [], idx = [];
    const bank = { pos: [], uv: [], idx: [] };
    const bankProf = [[0, -DROP - 0.1], [2.5, 1.3], [6, 0.8], [13, -22]];
    list.forEach((it, r) => {
      const s = it.s;
      for (const c of cols) {
        const lat = E + 0.05 + (it.Wd - 0.05) * c;
        track.surf(s, sd * lat, -DROP, P0);
        pos.push(P0.x, P0.y, P0.z);
        uv.push((sd * lat) / 16, s.dist / 16);
      }
      bankProf.forEach(([dl, h], k) => {
        track.surf(s, sd * (E + it.Wd + dl), h, P0);
        bank.pos.push(P0.x, P0.y, P0.z);
        bank.uv.push(k * 0.5, s.dist / 7);
      });
      if (r < list.length - 1) {
        const n = cols.length;
        for (let k = 0; k < n - 1; k++) {
          const A = r * n + k, B = A + 1, C = A + n, D = C + 1;
          sd > 0 ? idx.push(A, C, B, B, C, D) : idx.push(A, B, C, B, D, C);
        }
        const m = bankProf.length;
        for (let k = 0; k < m - 1; k++) {
          const A = r * m + k, B = A + 1, C = A + m, D = C + 1;
          sd > 0 ? bank.idx.push(A, C, B, B, C, D) : bank.idx.push(A, B, C, B, D, C);
        }
      }
    });
    ribbonParts.push({ pos, uv, idx });
    bankParts.push(bank);
  }

  // ---------------------------------------------------------------- 2) 용암 호수 (시계로 오르내림) + 둘레 현무암 벽
  let basinMesh = null, basinBox = null;
  if (CUT && basin) {
    const shape = new THREE.Shape(basin.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(shape, 24);
    geo.rotateX(-Math.PI / 2); // (x, −z) → (x, 0, z)
    const uvA = geo.attributes.uv, pA = geo.attributes.position;
    for (let k = 0; k < uvA.count; k++) uvA.setXY(k, pA.getX(k) / 26, pA.getZ(k) / 26);
    basinMesh = new THREE.Mesh(geo, basinMat);
    basinMesh.position.y = LV[0];
    group.add(basinMesh);
    basinBox = new THREE.Box2().setFromPoints(basin.map(([x, z]) => new THREE.Vector2(x, z)));
    // 둘레 벽: 호수 바닥 아래 ~ 그 자리 도로 아래 1.7 m (도로 밑이 비어 보이지 않게)
    const wall = { pos: [], uv: [], idx: [] };
    const ring = [...basin, basin[0]];
    let acc = 0, r = 0;
    for (let k = 0; k < ring.length; k++) {
      const [x, z] = ring[k];
      if (k) acc += Math.hypot(x - ring[k - 1][0], z - ring[k - 1][1]);
      const near = track.nearest(new THREE.Vector3(x, LV[1], z));
      const top = Math.max(LV[1] + 1.2, near.sample.pos.y - 1.7);
      wall.pos.push(x, LV[0] - 6, z, x, top, z);
      wall.uv.push(acc / 7, 0, acc / 7, (top - LV[0] + 6) / 7);
      if (k < ring.length - 1) wall.idx.push(r * 2, r * 2 + 1, r * 2 + 2, r * 2 + 1, r * 2 + 3, r * 2 + 2);
      r++;
    }
    bankParts.push(wall);
  }
  {
    const rib = mergeParts(ribbonParts, lavaMat);
    if (rib) group.add(rib);
    const bk = mergeParts(bankParts, rockMat);
    if (bk) group.add(bk);
  }

  // ---------------------------------------------------------------- 3) 불빛: 난간 없는 가장자리(주황, 앞으로 흐름) + 둑길 양쪽(초록·노랑·빨강)
  const lampList = [];
  for (const r of track.openRuns)
    for (const sd of [-1, 1])
      for (let i = r.a, k = 0; i <= r.b; i += Math.round(10 / ds), k++) {
        const q = wrap(i);
        if (!isOpenNoJoin(q, sd)) continue;
        const p = track.surf(S[q], sd * (E + 0.12), 0.28, new THREE.Vector3());
        lampList.push({ p, k, kind: 'edge' });
      }
  const cutLow = CUT ? CUT.samples.filter((q) => q.w > 0.05) : [];
  if (CUT)
    for (let k = 0, acc = -1e9; k < CUT.samples.length; k++) {
      const q = CUT.samples[k];
      if (q.w < 0.05 || q.dist - acc < 6) continue;
      acc = q.dist;
      for (const sd of [-1, 1]) {
        const p = q.pos.clone().addScaledVector(q.rightB, sd * (CUT.half + 0.15)).addScaledVector(q.up, 0.3);
        lampList.push({ p, k: Math.round(q.dist / 6), kind: 'cut' });
        lampList[lampList.length - 1].s = 0.7;
      }
    }
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 10, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }), Math.max(1, lampList.length));
  const lampHalo = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: glow, color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), Math.max(1, lampList.length));
  const m4 = new THREE.Matrix4(), P2 = new THREE.Vector3(), lampCol = new THREE.Color(), _hs = new THREE.Vector3();
  lampList.forEach((l, n) => {
    m4.makeTranslation(l.p.x, l.p.y, l.p.z);
    lamps.setMatrixAt(n, m4);
    lampHalo.setMatrixAt(n, m4);
    lamps.setColorAt(n, lampCol.set(l.kind === 'edge' ? '#ffd27a' : '#9dffb0'));
    lampHalo.setColorAt(n, lampCol.set(l.kind === 'edge' ? '#ff7a1a' : '#3dff6a'));
  });
  lamps.count = lampHalo.count = lampList.length;
  lamps.computeBoundingSphere();
  lampHalo.computeBoundingSphere();
  lampHalo.onBeforeRender = (r, sc, cam) => {
    for (let n = 0; n < lampList.length; n++) {
      P2.copy(lampList[n].p);
      m4.makeRotationFromQuaternion(cam.quaternion).scale(_hs.setScalar(lampList[n].s || 1)).setPosition(P2);
      lampHalo.setMatrixAt(n, m4);
    }
    lampHalo.instanceMatrix.needsUpdate = true;
  };
  group.add(lamps, lampHalo);

  // ---------------------------------------------------------------- 4) 경고판 (난간 없는 구간 앞, 양쪽) + 시작·끝 빛 기둥
  const beaconMat = new THREE.MeshBasicMaterial({ color: '#ffb347', fog: false });
  const postGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 8).translate(0, 0.5, 0);
  const posts = [];
  const signMat = new THREE.MeshBasicMaterial({ map: signTex('🔥 난간 없는 용암 길', '연석 밖은 용암 · 닿으면 뒤로 복귀', '#ff9a2a'), side: THREE.DoubleSide, transparent: true });
  for (const z of zones) {
    for (const i of [z.a, z.b])
      for (const sd of [-1, 1]) {
        if (!isOpenNoJoin(wrap(i + (i === z.a ? 3 : -3)), sd)) continue;
        const p = track.surf(S[wrap(i)], sd * (E + 0.5), -DROP);
        posts.push({ p, h: DROP + 3.4 });
      }
    const iw = wrap(z.a - Math.round(45 / ds));
    const sw = S[iw];
    for (const sd of [-1, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 3.95), signMat);
      const lat = sw.bridge ? (track.deckHalf || E) + 2.5 : E + 4;
      track.surf(sw, sd * lat, 4.4, sign.position);
      sign.rotation.set(0, Math.atan2(sw.tan.x, sw.tan.z) + Math.PI - sd * 0.3, 0);
      group.add(sign);
      posts.push({ p: sign.position.clone().setY(sign.position.y - 12), h: 10.1 });
    }
  }

  // ---------------------------------------------------------------- 5) 용암 둑길 문 (갈림길): 오른쪽 기둥 + 길 위로 뻗은 들보 + 신호등 3개 + 남은 초 판
  let gate = null;
  if (CUT) {
    const k0 = CUT.samples.findIndex((q) => q.w > 0.02);
    const q = CUT.samples[Math.max(0, k0 - 2)];
    const g = new THREE.Group();
    const H = CUT.half;
    const out = q.pos.clone().addScaledVector(q.right, H + 1.6);
    const metal = new THREE.MeshStandardMaterial({ color: '#2a2220', emissive: '#ff5a10', emissiveIntensity: 0.18, roughness: 0.6, metalness: 0.5 });
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9, 0.9), metal);
    pole.position.copy(out).setY(q.pos.y + 4.5 - 2.5);
    g.add(pole);
    const beamLen = H * 2 + 2.6;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.7, 0.7), metal);
    const mid = q.pos.clone().addScaledVector(q.right, 1.3 * 0.5);
    beam.position.copy(mid).setY(q.pos.y + 6.6);
    beam.rotation.y = Math.atan2(q.tan.x, q.tan.z) + Math.PI / 2;
    g.add(beam);
    // 신호등 판 (들보 위, 운전자 쪽을 봄)
    const yaw = Math.atan2(q.tan.x, q.tan.z) + Math.PI;
    const lights = [];
    const lightGeo = new THREE.CircleGeometry(0.62, 20);
    const backing = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.9), new THREE.MeshBasicMaterial({ color: '#120a08', side: THREE.DoubleSide }));
    backing.position.copy(mid).setY(q.pos.y + 7.9);
    backing.rotation.y = yaw;
    g.add(backing);
    const colors = ['#ff2a10', '#ffb020', '#2aff5a'];
    colors.forEach((c, k) => {
      const m = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: c, fog: false }));
      m.position.copy(backing.position).addScaledVector(q.right, (k - 1) * -1.6);
      m.position.addScaledVector(q.tan, -0.06);
      m.rotation.y = yaw;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      halo.position.copy(m.position).addScaledVector(q.tan, -0.1);
      halo.scale.setScalar(3.6);
      g.add(m, halo);
      lights.push({ m, halo, base: new THREE.Color(c) });
    });
    // 남은 초 판 (글자가 바뀔 때만 다시 그림)
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 160;
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 2.4), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, fog: false }));
    board.position.copy(mid).setY(q.pos.y + 5.0);
    board.position.addScaledVector(q.tan, -0.4);
    board.rotation.y = yaw;
    g.add(board);
    group.add(g);
    let shown = '';
    const draw = (title, sub, col) => {
      const key = title + sub + col;
      if (key === shown) return;
      shown = key;
      ctx.fillStyle = '#140b08';
      ctx.fillRect(0, 0, 512, 160);
      ctx.strokeStyle = col;
      ctx.lineWidth = 8;
      ctx.strokeRect(5, 5, 502, 150);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = col;
      ctx.font = '900 62px "Segoe UI","Malgun Gothic",sans-serif';
      ctx.fillText(title, 256, 62);
      ctx.fillStyle = '#ffe6c8';
      ctx.font = '700 32px "Segoe UI","Malgun Gothic",sans-serif';
      ctx.fillText(sub, 256, 122);
      tex.needsUpdate = true;
    };
    gate = { g, lights, draw, pos: q.pos.clone(), dist: q.dist };
  }
  // 갈림길 바닥 글자 (본 도로 오른쪽, 갈라지기 시작하는 곳): '용암 둑길 ↘'
  if (CUT) {
    const q = CUT.samples[Math.min(CUT.samples.length - 1, 8)];
    const tex = canvasTexture(512, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,190,40,0.95)';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '900 96px "Segoe UI","Malgun Gothic",sans-serif';
      g.fillText('용암 둑길', w / 2, 90);
      g.font = '900 110px "Segoe UI","Malgun Gothic",sans-serif';
      g.fillText('↘', w / 2, 200);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(-q.tan.x, -q.tan.z); // 글자 위쪽 = 진행 방향
    m.position.copy(q.pos).addScaledVector(q.right, 1.2).setY(q.pos.y + 0.07);
    group.add(m);
  }
  {
    const im = new THREE.InstancedMesh(postGeo, beaconMat, Math.max(1, posts.length));
    posts.forEach((o, n) => {
      m4.makeScale(1, o.h, 1).setPosition(o.p.x, o.p.y, o.p.z);
      im.setMatrixAt(n, m4);
    });
    im.count = posts.length;
    im.computeBoundingSphere();
    group.add(im);
  }

  // ---------------------------------------------------------------- 6) 호수 위 김·거품 (차오를 때 많아짐), 용암에 빠질 때 튀는 불덩이
  const BN = CUT ? 260 : 0;
  const bubbles = [];
  const bPos = new Float32Array(Math.max(1, BN) * 3);
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  const bMat = new THREE.PointsMaterial({ size: 1.4, map: glow, color: '#ffb060', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const bPts = new THREE.Points(bGeo, bMat);
  bPts.frustumCulled = false;
  if (BN) group.add(bPts);
  const randBasin = () => {
    for (let k = 0; k < 30; k++) {
      const x = basinBox.min.x + rnd() * (basinBox.max.x - basinBox.min.x), z = basinBox.min.y + rnd() * (basinBox.max.y - basinBox.min.y);
      if (inPoly(basin, x, z)) return [x, z];
    }
    return [(basinBox.min.x + basinBox.max.x) / 2, (basinBox.min.y + basinBox.max.y) / 2];
  };
  for (let k = 0; k < BN; k++) {
    const [x, z] = randBasin();
    bubbles.push({ x, z, ph: rnd(), sp: 0.4 + rnd() * 0.8 });
  }
  const splashes = [];
  const splashMat = new THREE.SpriteMaterial({ map: glow, color: '#ffa040', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let k = 0; k < 24; k++) {
    const sp = new THREE.Sprite(splashMat);
    sp.visible = false;
    group.add(sp);
    splashes.push({ sp, t: 1, v: new THREE.Vector3() });
  }
  function splashAt(p) {
    for (let k = 0; k < 10; k++) {
      const o = splashes.find((q) => q.t >= 1);
      if (!o) break;
      o.t = 0;
      o.sp.visible = true;
      o.sp.position.copy(p);
      const a = rnd() * TAU, r = 3 + rnd() * 5;
      o.v.set(Math.cos(a) * r, 7 + rnd() * 9, Math.sin(a) * r);
    }
  }

  // ---------------------------------------------------------------- 알림 (DOM)
  const toast = document.createElement('div');
  toast.id = 'lavaHzToast';
  toast.style.cssText =
    'position:fixed;left:50%;top:33%;transform:translateX(-50%) scale(.96);z-index:5;pointer-events:none;opacity:0;transition:opacity .25s, transform .25s;' +
    'font:800 27px/1.2 "Segoe UI","Malgun Gothic",sans-serif;letter-spacing:1px;color:#fff;white-space:nowrap;text-align:center;text-shadow:0 0 12px #ff5a10,0 0 26px #ffb347';
  const veil = document.createElement('div');
  veil.id = 'lavaHzVeil';
  veil.style.cssText = 'position:fixed;inset:0;z-index:3;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center, rgba(255,120,20,0) 45%, rgba(255,70,0,.6) 100%)';
  if (document.body) document.body.append(veil, toast);
  let toastT = 0;
  function showToast(text, sub, color = '#ffcf7a') {
    toast.innerHTML = `${text}<div style="font-size:15px;font-weight:700;opacity:.95;margin-top:3px;color:${color}">${sub || ''}</div>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) scale(1)';
    toastT = 2.4;
  }

  // ---------------------------------------------------------------- 소리: 차오를 때 우르릉, 호수 근처 보글보글 (N·음소거면 공통 믹서가 끔)
  let actx = null, bubbleGain = null;
  const wake = () => {
    if (actx) {
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    const n = Math.floor(actx.sampleRate * 2);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    // 보글보글: 드문드문 짧은 '뽁' 소리가 섞인 낮은 잡음
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.25;
    for (let b = 0; b < 26; b++) {
      const at = Math.floor(Math.random() * (n - 3000)), f = 90 + Math.random() * 160;
      for (let i = 0; i < 2600; i++) d[at + i] += Math.sin((i / actx.sampleRate) * TAU * f * (1 + i / 2600)) * Math.exp(-i / 700) * 0.9;
    }
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    bubbleGain = actx.createGain();
    bubbleGain.gain.value = 0;
    src.connect(lp).connect(bubbleGain).connect(actx.destination);
    src.start();
  };
  window.addEventListener('keydown', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });
  function rumble(strength = 1) {
    if (!actx || actx.state !== 'running') return;
    const t0 = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain(), lp = actx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(42, t0);
    o.frequency.linearRampToValueAtTime(30, t0 + 2.4);
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22 * strength, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
    o.connect(lp).connect(g).connect(actx.destination);
    o.start(t0);
    o.stop(t0 + 2.7);
  }
  function sizzle() {
    if (!actx || actx.state !== 'running') return;
    const t0 = actx.currentTime, n = Math.floor(actx.sampleRate * 0.9);
    const buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (actx.sampleRate * 0.28));
    const src = actx.createBufferSource(), hp = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = buf;
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    g.gain.value = 0.35;
    src.connect(hp).connect(g).connect(actx.destination);
    src.start(t0);
    const o = actx.createOscillator(), og = actx.createGain();
    o.frequency.setValueAtTime(120, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.6);
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.3, t0 + 0.04);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    o.connect(og).connect(actx.destination);
    o.start(t0);
    o.stop(t0 + 0.75);
  }

  // ---------------------------------------------------------------- 둑길 위치 찾기
  const cutBox = CUT ? new THREE.Box3().setFromPoints(CUT.samples.map((q) => q.pos)).expandByScalar(CUT.half + 4) : null;
  /** 차가 둑길 위(또는 바로 위)에 있으면 그 둑길 샘플, 아니면 null */
  function onCut(pos) {
    if (!CUT || !cutBox.containsPoint(pos)) return null;
    const L = CUT.samples;
    let best = Infinity, bk = -1;
    for (let k = 0; k < L.length; k++) {
      const p = L[k].pos;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < best) (best = d), (bk = k);
    }
    if (best > (CUT.half + 0.6) ** 2) return null;
    const q = L[bk];
    if (pos.y < q.pos.y - 1.2 || pos.y > q.pos.y + 6) return null;
    return q;
  }

  // ---------------------------------------------------------------- 떨어짐·용암 감지 (사람·봇 같음)
  const state = new WeakMap();
  const tmp = new THREE.Vector3();
  let lake = lakeAt(0);
  function follow(st, car) {
    if (st.idx < 0 || car.events.includes('respawn')) st.idx = car.trackInfo ? car.trackInfo.index ?? Math.round(car.trackInfo.t * N) : track.nearest(car.pos).index;
    let best = Infinity, bi = st.idx;
    for (let k = -60; k <= 60; k++) {
      const i = wrap(st.idx + k), p = S[i].pos;
      const d = (p.x - car.pos.x) ** 2 + (p.z - car.pos.z) ** 2;
      if (d < best) (best = d), (bi = i);
    }
    if (best > 90 * 90) bi = track.nearest(car.pos).index;
    st.idx = bi;
    return bi;
  }
  function burn(car, isPlayer, name, why, i) {
    const at = car.pos.clone();
    car.respawn();
    stats.falls++;
    if (why === 'cut') stats.cutFalls++;
    else stats.edgeFalls++;
    if (isPlayer) stats.playerFalls++;
    else stats.botFalls++;
    if (stats.where.length < 80) stats.where.push(`${name}@${why}:${S[wrap(i)].t.toFixed(3)}`);
    if (track.inSpace) splashAt(at);
    if (isPlayer) {
      fallFx = 1;
      sizzle();
      if (why === 'cut') showToast('🔥 용암에 잠겼어요!', '둑길은 용암이 빠졌을 때만 · 문 신호등을 보세요', '#ffcf7a');
      else showToast('🔥 용암에 빠졌어요!', '난간 없는 길 · 빛나는 가장자리 선을 넘지 마세요', '#ffcf7a');
    }
  }
  function stepCar(car, dt, isPlayer, name) {
    const ti = car.trackInfo;
    if (!ti) return;
    let st = state.get(car);
    if (!st) state.set(car, (st = { idx: -1, fallT: 0, onCutT: 0, cutOpen: false }));
    const i0 = wrap(ti.index ?? Math.round(ti.t * N));
    if (!S[i0].space && st.fallT === 0) {
      st.idx = -1;
      return;
    }
    if (car.mode === 'fly') return;
    // (가) 용암 둑길·호수: 호수 위에서 용암이 차 바닥보다 높으면
    if (CUT && basinBox && pointInBasin(car.pos)) {
      const q = onCut(car.pos);
      if (q && isPlayer) {
        if (st.onCutT === 0) {
          stats.cutUse++;
          st.cutOpen = lake.open;
          if (lake.open) stats.cutOpenUse++;
        }
        st.onCutT += dt;
      }
      // 본 도로 위(호수 위로 뻗은 U자 안쪽 상판 등)는 빼고: 본 도로 면에서 1 m 안이면 안전
      const s = S[follow(st, car)];
      tmp.copy(car.pos).sub(s.pos);
      const lat = tmp.x * s.right.x + tmp.z * s.right.z;
      const onMain = Math.abs(lat) < (s.bridge && !track.isOpen(s.i, lat < 0 ? -1 : 1) ? track.deckHalf || E : E) + 0.3 && car.pos.y > track.roadYAt(s, lat) - 1;
      if (!onMain && car.pos.y < lake.level + 0.12) {
        burn(car, isPlayer, name, 'cut', s.i);
        st.fallT = 0;
        st.idx = -1;
        return;
      }
      if (q || onMain) {
        st.fallT = 0;
        return;
      }
    } else if (isPlayer) st.onCutT = 0;
    // (나) 난간 없는 가장자리: 길 끝 밖 + 도로보다 FALL_BELOW m 아래
    const i = follow(st, car), s = S[i];
    if (!s.space) {
      st.fallT = 0;
      return;
    }
    tmp.copy(car.pos).sub(s.pos);
    const lat = tmp.x * s.right.x + tmp.z * s.right.z;
    const side = lat < 0 ? -1 : 1;
    if (!track.isOpen(i, side) || (CUT && onCut(car.pos))) {
      st.fallT = 0;
      return;
    }
    const out = Math.abs(lat) - E;
    const below = track.roadYAt(s, THREE.MathUtils.clamp(lat, -E, E)) - car.pos.y;
    const falling = out > 0.2 && below > FALL_BELOW;
    st.fallT = falling ? st.fallT + dt : 0;
    if (st.fallT > FALL_DELAY) {
      st.fallT = 0;
      burn(car, isPlayer, name, 'edge', i);
      st.idx = -1;
    }
  }
  function pointInBasin(p) {
    if (p.x < basinBox.min.x || p.x > basinBox.max.x || p.z < basinBox.min.y || p.z > basinBox.max.y) return false;
    return inPoly(basin, p.x, p.z);
  }

  // ---------------------------------------------------------------- 알림 (사람만): 구간·둑길 앞에서 한 번
  const distTo = (from, to) => {
    let d = (to - from) * ds;
    const L = track.length;
    if (d < -L / 2) d += L;
    if (d > L / 2) d -= L;
    return d;
  };
  const tBranchI = CUT ? Math.round(CUT.tBranch * N) : -1;
  let cutWarnedAt = -1e9, lastLakeOpen = true;
  function warnPlayer(car, clock) {
    const ti = car.trackInfo;
    if (!ti) return;
    const i = ti.index ?? Math.round(ti.t * N);
    const v = Math.max(20, Math.abs(car.speed));
    if (CUT) {
      const d = distTo(i, tBranchI);
      if (d > 0 && d < Math.max(140, v * 3.0) && clock - cutWarnedAt > 25) { // 포털 글자(2.2초)와 겹치지 않게 조금 늦게
        cutWarnedAt = clock;
        const eta = d / v;
        const at = lakeAt(clock + eta);
        if (at.open) showToast(`🌋 용암 둑길 열림 · ${Math.max(0, at.secs).toFixed(0)}초 뒤 잠김`, '오른쪽 낮은 길 = 지름길 · 잠기면 용암!', at.secs < 3 ? '#ffd040' : '#7dff9a');
        else showToast(`🌋 용암 둑길 잠김 · ${Math.max(0, at.secs).toFixed(0)}초 뒤 열림`, '안전한 큰 U자로 · 난간 없는 직선 조심', '#ff8a5a');
        for (const z of zones) if (distTo(i, z.a) > 0 && distTo(i, z.a) < 400) z.warnedAt = clock; // 첫 구간 알림은 함께 함
        return;
      }
    }
    for (const z of zones) {
      const d = distTo(i, z.a);
      if (d > 0 && d < Math.max(120, v * 2.4) && clock - z.warnedAt > 20) {
        z.warnedAt = clock;
        showToast('🔥 난간 없는 용암 길', '연석 밖은 용암 · 닿으면 뒤로 복귀', '#ffcf7a');
      }
    }
  }

  // ---------------------------------------------------------------- 매 물리 스텝
  let fallFx = 0;
  const off = qs.get('jlava') === '0';
  function update(dt, car) {
    if (!car || off) return;
    localClock += dt;
    const clock = raceClock();
    lake = lakeAt(clock);
    stepCar(car, dt, true, 'P');
    const rs = window.game && window.game.raceSys;
    if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car !== car) stepCar(b.car, dt, false, b.name);
    if (car.trackInfo && S[wrap(car.trackInfo.index ?? 0)].space) warnPlayer(car, clock);
    // 차오르기 시작 = 우르릉 (지하 세계에 있을 때만)
    if (lastLakeOpen && !lake.open && track.inSpace) rumble(1);
    lastLakeOpen = lake.open;
  }

  // ---------------------------------------------------------------- 그릴 때마다
  let lastT = null, shownVeil = -1;
  function animate(time) {
    const t = time ?? performance.now() / 1000;
    const dt = lastT === null ? 1 / 60 : THREE.MathUtils.clamp(t - lastT, 0, 0.1);
    lastT = t;
    const on = !!track.inSpace;
    group.visible = on && !off;
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) scale(.96)';
      }
    }
    const v = Math.round(fallFx * 0.8 * 20) / 20;
    if (v !== shownVeil) {
      shownVeil = v;
      veil.style.opacity = String(v);
    }
    fallFx = Math.max(0, fallFx - dt * 1.6);
    const lk = lakeAt(raceClock()); // 리플레이 중에도 화면은 리플레이 시계
    if (actx && bubbleGain) {
      const g = window.game;
      let near = 0;
      if (on && g && g.car && basinBox) {
        const p = g.car.pos;
        const dx = Math.max(basinBox.min.x - p.x, 0, p.x - basinBox.max.x), dz = Math.max(basinBox.min.y - p.z, 0, p.z - basinBox.max.y);
        near = Math.max(0, 1 - Math.hypot(dx, dz) / 160);
      }
      const want = (g && g.paused) || (g && g.replay && g.replay.active) ? 0 : near * (0.05 + 0.13 * lk.f);
      bubbleGain.gain.setTargetAtTime(want, actx.currentTime, 0.3);
    }
    if (!group.visible) return;
    lavaT.offset.set(t * 0.012, -t * 0.05);
    basinT.offset.set(-t * 0.01, t * 0.025);
    if (basinMesh) basinMesh.position.y = lk.level;
    basinMat.color.setScalar(0.9 + 0.25 * lk.f + 0.08 * Math.sin(t * 3));
    // 불빛: 가장자리 = 앞으로 흐르는 주황, 둑길 = 상태 색 (초록 / 노랑 깜빡 / 빨강)
    const blink = 0.5 + 0.5 * Math.sin(t * 12);
    const cutCol = lk.open ? (lk.warn ? (blink > 0.5 ? '#ffb020' : '#5a3000') : '#2aff5a') : '#ff2a10';
    for (let n = 0; n < lampList.length; n++) {
      const l = lampList[n];
      if (l.kind === 'edge') {
        const w = 0.5 + 0.5 * Math.sin(l.k * 0.55 - t * 7);
        lampHalo.setColorAt(n, lampCol.set('#ff7a1a').multiplyScalar(0.35 + 1.1 * w * w));
      } else {
        const w = lk.open && !lk.warn ? 0.6 + 0.4 * Math.sin(l.k * 0.7 - t * 6) : 1;
        lampHalo.setColorAt(n, lampCol.set(cutCol).multiplyScalar(0.5 + 0.9 * w));
        lamps.setColorAt(n, lampCol.set(cutCol));
      }
    }
    lampHalo.instanceColor.needsUpdate = true;
    lamps.instanceColor.needsUpdate = true;
    // 문 신호등 + 남은 초
    if (gate) {
      const which = lk.open ? (lk.warn ? 1 : 2) : 0;
      gate.lights.forEach((L, k) => {
        const lit = k === which && (k !== 1 || blink > 0.35);
        L.m.material.color.copy(L.base).multiplyScalar(lit ? 1 : 0.12);
        L.halo.material.opacity = lit ? 0.95 : 0;
      });
      const sec = Math.max(0, Math.ceil(lk.secs));
      if (lk.open) gate.draw(lk.warn ? `곧 잠김 ${sec}` : `열림 ${sec}`, lk.warn ? '용암이 차오릅니다!' : '용암 둑길 · 지름길', lk.warn ? '#ffb020' : '#2aff5a');
      else gate.draw(`잠김 ${sec}`, '용암에 잠김 · 큰 U자로', '#ff3a1a');
    }
    // 거품: 차오를 때 많이·높이
    if (BN) {
      for (let k = 0; k < BN; k++) {
        const b = bubbles[k];
        const u = (t * b.sp + b.ph) % 1;
        const show = k < BN * (0.35 + 0.65 * lk.f);
        bPos[k * 3] = b.x;
        bPos[k * 3 + 1] = show ? lk.level + 0.2 + u * (1.5 + 3 * lk.f) : -999;
        bPos[k * 3 + 2] = b.z;
      }
      bGeo.attributes.position.needsUpdate = true;
      bMat.opacity = 0.5 + 0.4 * lk.f;
    }
    for (const o of splashes) {
      if (o.t >= 1) continue;
      o.t += dt * 0.9;
      o.v.y -= 22 * dt;
      o.sp.position.addScaledVector(o.v, dt);
      o.sp.scale.setScalar(2.4 * (1 - o.t) + 0.4);
      if (o.t >= 1) o.sp.visible = false;
    }
  }
  function reset() {
    localClock = 0;
    toastT = 0;
    toast.style.opacity = '0';
    fallFx = 0;
    cutWarnedAt = -1e9;
    lastLakeOpen = true;
    for (const z of zones) z.warnedAt = -1e9;
  }

  return { group, update, animate, reset, stats, lakeAt, raceClock, get lake() { return lake; }, zones, onCut, pointInBasin: (p) => !!basinBox && pointInBasin(p), off };
}
