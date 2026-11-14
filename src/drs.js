// DRS (2026-11-12, 사용자 요청 "멈춰 주는 게 아니라 어떤 시스템을 이용해서 격차가 많이 벌어지지 않게", 메모 .debug/agents/drs.md)
//
//   F1처럼: 코스마다 긴 직선(DRS 구간 1~3개)과 그 앞 '감지선'을 레이싱 라인 속도 계획에서 자동으로 찾음 (맵마다 적어 둔 값 없음).
//   감지선을 지날 때 바로 앞차가 detectSec(1초) 안에 먼저 지나갔으면 → 그 DRS 구간에서 DRS 사용 가능 ('DRS 가능' 칩)
//   구간에 들어가면 자동으로 열림 → 공기 저항 −dragCut, 최고 속도 +topGain (car.js, data/car.json drs). 브레이크를 밟으면 그 구간에서는 닫힘
//   사람·봇 똑같이 (raceSystem이 모두 계산), 온라인은 각자 자기 차만 (앞차 판정은 상대 위치로)
//   출발 뒤 startDelay초 동안은 감지 안 함 (1바퀴 맵도 그 뒤 첫 감지선부터 바로 씀)
//   보이는 것: 뒷날개 윗판이 열림 (carModel.js car.drs), HUD 칩, 도로 위 'DRS ZONE' 글자·감지선
//   켜고 끄기: 설정 'DRS' (settings.values.drs), 주소 &drs=0
//
//   구간 찾기: 레이싱 라인에서 '브레이크 없음 + 휘는 반지름 curvR m 넘음'이 이어지는 곳 → 앞 startAfter m·뒤 endBefore m 자르고
//     minLen m 넘는 것 중 긴 순서로 maxZones개 (maxLen m보다 길면 브레이크 지점 쪽 maxLen m만). 루프·자석 도로·튜브·점프·점프대·파도·물·저중력/고중력·끊긴 도로·좁은 길(반폭 6.5 m 아래)은 빼고 자름
import * as THREE from 'three';

const DEF = { detectSec: 1, startDelay: 15, minLen: 300, maxLen: 800, maxZones: 3, curvR: 260, startAfter: 40, endBefore: 45, detectBefore: 150, minSep: 250, brakeClose: 0.3, openTime: 0.25, closeTime: 0.12 };

/** 레이싱 라인 지점마다 'DRS를 쓰면 안 되는 곳' (루프·튜브·점프·물·저중력 등, 앞뒤 여유 포함) */
function badMask(track, N) {
  const S = track.samples, M = S.length - 1, L = track.length;
  const dsS = L / M, mS = (m) => Math.max(1, Math.round(m / dsS));
  const bad = new Uint8Array(M);
  const mark = (i0, i1) => {
    for (let i = i0; i <= i1; i++) bad[((i % M) + M) % M] = 1;
  };
  for (let i = 0; i < M; i++) {
    const s = S[i];
    if (s.roll || s.magnet || s.gap) mark(i - mS(40), i + mS(40));
    if (s.water) mark(i - mS(30), i + mS(30));
    if (s.hw && s.hw < 6.5) mark(i - mS(20), i + mS(20)); // 좁은 길 (화산 칼날 능선·낭떠러지 길): 나란히 달리다 떨어지기 쉬움
    if (track.tubeK && track.tubeK[i] > 0) mark(i - mS(40), i + mS(40));
    if (track.gravityAt && i % 3 === 0) {
      const g = track.gravityAt(s.pos);
      if (g < 0.95 || g > 1.15) mark(i - mS(40), i + mS(40));
    }
  }
  for (const j of track.jumps || []) if (j.lipI !== undefined) mark(j.lipI - mS(120), (j.landI ?? j.lipI) + mS(60));
  for (const r of track.ramps || []) if (r.t !== undefined) mark(Math.round(r.t * M) - mS(120), Math.round(r.t * M) + mS(80));
  for (const w of track.waves || []) {
    const i = w.s ? (w.s.i ?? Math.round(w.s.t * M)) : null;
    if (i !== null) mark(i - mS(60), i + mS((w.len || 16) + 60));
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = bad[Math.min(M - 1, Math.floor((i / N) * M))];
  return out;
}

/**
 * DRS 구간 찾기
 * @returns [{ startT, endT, detT, len }] (출발선부터 순서대로)
 */
export function findDrsZones(track, line, prof, o = {}) {
  const C = { ...DEF, ...o };
  const N = line.N, L = track.length, ds = L / N;
  const W = (i) => ((i % N) + N) % N;
  const bad = badMask(track, N);
  const ok = new Uint8Array(N);
  for (let i = 0; i < N; i++) ok[i] = !bad[i] && !prof.brake[i] && Math.abs(line.curvature[i]) < 1 / C.curvR ? 1 : 0;
  // 이어진 구간 (한 바퀴를 넘어 이어지는 것도): ok가 아닌 곳에서 시작
  let s0 = -1;
  for (let i = 0; i < N; i++) if (!ok[i]) { s0 = i; break; }
  if (s0 < 0) return []; // 코스 전체가 직선(?)
  const runs = [];
  let a = -1;
  for (let k = 1; k <= N; k++) {
    const i = W(s0 + k);
    if (ok[i] && a < 0) a = s0 + k;
    if ((!ok[i] || k === N) && a >= 0) {
      const b = ok[i] ? s0 + k : s0 + k - 1;
      runs.push({ a, b });
      a = -1;
    }
  }
  const pick = (minLen) => {
    const cand = [];
    for (const r of runs) {
      const en = r.b - Math.round(C.endBefore / ds);
      // 너무 긴 직선(스위퍼까지 이어진 곳)은 끝(브레이크 지점) 쪽 maxLen m만 = 추월이 일어나는 곳
      const st = Math.max(r.a + Math.round(C.startAfter / ds), en - Math.round(C.maxLen / ds));
      const len = (en - st) * ds, raw = (en - r.a) * ds;
      if (len >= minLen) cand.push({ st, en, len, raw });
    }
    cand.sort((x, y) => y.raw - x.raw);
    const chosen = [];
    for (const c of cand) {
      if (chosen.length >= C.maxZones) break;
      // 다른 구간과 너무 붙어 있으면 (감지선이 앞 구간 안에 들어가면) 빼기
      const far = chosen.every((z) => {
        const gap1 = W(c.st - z.en) * ds, gap2 = W(z.st - c.en) * ds;
        return gap1 >= C.minSep && gap2 >= C.minSep;
      });
      if (far) chosen.push(c);
    }
    return chosen;
  };
  let chosen = pick(C.minLen);
  if (!chosen.length) chosen = pick(C.minLen * 0.7);
  const zones = chosen.map((c) => {
    const det = c.st - Math.round(C.detectBefore / ds);
    return { startT: W(c.st) / N, endT: W(c.en) / N, detT: W(det) / N, len: Math.round(c.len), startI: W(c.st), endI: W(c.en), detI: W(det) };
  });
  zones.sort((x, y) => x.startT - y.startT);
  zones.forEach((z, k) => (z.n = k + 1));
  return zones;
}

/** 바퀴 진행(0~1)에서 a → b로 앞으로 가는 구간 안인지 (출발선을 넘는 구간도) */
const inArc = (f, a, b) => (a <= b ? f >= a && f <= b : f >= a || f <= b);

// ---------------------------------------------------------------- 도로 위 표시
function textTex(draw, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/** 도로 면을 따라 붙는 띠 (진행 방향 길이 len m, 폭 wid m, 지점 s 기준 앞으로 along m) */
function roadDecal(track, si, along, len, wid, mat) {
  const S = track.samples, M = S.length - 1, dsS = track.length / M;
  const nx = 8, nz = Math.max(2, Math.ceil(len / 2));
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  const ray = new THREE.Raycaster(), o = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0), p = new THREE.Vector3();
  let k = 0;
  for (let zi = 0; zi <= nz; zi++) {
    const d = along + (len * zi) / nz;
    const s = S[(((si + Math.round(d / dsS)) % M) + M) % M];
    for (let xi = 0; xi <= nx; xi++) {
      const lat = (xi / nx - 0.5) * wid;
      p.copy(s.pos).addScaledVector(s.right, lat);
      o.set(p.x, p.y + 4, p.z);
      const hit = track.castRay ? track.castRay(o, down, 9) : null;
      const y = hit && hit.point ? hit.point.y : p.y;
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = y + 0.05;
      pos[k * 3 + 2] = p.z;
      uv[k * 2] = xi / nx;
      uv[k * 2 + 1] = zi / nz;
      k++;
    }
  }
  const idx = [];
  for (let zi = 0; zi < nz; zi++)
    for (let xi = 0; xi < nx; xi++) {
      const a = zi * (nx + 1) + xi, b = a + 1, c = a + nx + 1, e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  m.name = 'drsMark'; // staticBatch가 합치지 않게 (이름 있음)
  return m;
}
function decalMat(tex) {
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
}
function buildMarks(track, zones) {
  const g = new THREE.Group();
  g.name = 'drsMarks';
  const S = track.samples, M = S.length - 1;
  const zoneTex = textTex((c, w, h) => {
    // 진행 방향으로 길게 늘어난 글자 (운전석에서 보면 바로 읽힘): 아래(v=0)가 차 쪽
    c.clearRect(0, 0, w, h);
    c.save();
    c.translate(w / 2, h / 2);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.font = '900 150px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.save();
    c.scale(1, 2.6);
    c.fillText('DRS', 0, h * 0.2 / 2.6);
    c.restore();
    c.fillStyle = 'rgba(80,255,140,0.95)';
    c.font = '900 92px system-ui, sans-serif';
    c.save();
    c.scale(1, 2.2);
    c.fillText('ZONE', 0, -h * 0.25 / 2.2);
    c.restore();
    c.restore();
  }, 512, 1024);
  const lineTex = textTex((c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    for (let x = 0; x < w; x += 64) c.fillRect(x + 8, h * 0.62, 40, h * 0.3); // 점선
    c.save();
    c.translate(w / 2, h * 0.3);
    c.fillStyle = 'rgba(120,255,170,0.95)';
    c.font = '800 60px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('DRS DETECTION', 0, 0);
    c.restore();
  }, 1024, 256);
  const startTex = textTex((c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(80,255,140,0.9)';
    c.fillRect(0, h * 0.25, w, h * 0.5);
  }, 64, 16);
  const zMat = decalMat(zoneTex), lMat = decalMat(lineTex), sMat = decalMat(startTex);
  for (const z of zones) {
    const si = Math.round(z.startT * M), di = Math.round(z.detT * M);
    const hw = (track.halfWidthAt ? track.halfWidthAt(z.startI) : null) || (S[si].hw) || (track.width || 16) / 2;
    const hwD = (track.halfWidthAt ? track.halfWidthAt(z.detI) : null) || (S[di].hw) || (track.width || 16) / 2;
    g.add(roadDecal(track, si, 0, 0.6, hw * 2 - 0.6, sMat)); // 구간 시작 초록 줄
    g.add(roadDecal(track, si, 4, 13, Math.min(9, hw * 1.2), zMat)); // DRS ZONE 글자
    g.add(roadDecal(track, di, -1.2, 2.4, hwD * 2 - 0.6, lMat)); // 감지선
  }
  return g;
}

// ---------------------------------------------------------------- HUD 칩
function hudBox() {
  let box = document.getElementById('drsBox');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'drsBox';
  box.innerHTML = '<b>DRS</b><span class="dr-st"></span><i class="dr-flap"></i>';
  const dock = document.getElementById('slipDock');
  if (dock) dock.prepend(box);
  else {
    box.classList.add('hud', 'solo');
    document.body.appendChild(box);
  }
  return box;
}

/**
 * DRS 계산 (raceSystem이 만듦)
 * @param o { track, line, prof, cfg(car.json drs), isOn(), all(), local() (내가 계산하는 차들), me, scene() }
 */
export function createDrs(o) {
  const C = { ...DEF, ...(o.cfg || {}) };
  const { track } = o;
  let zones = [];
  try {
    zones = o.line && o.prof ? findDrsZones(track, o.line, o.prof, C) : [];
  } catch (err) {
    console.warn('DRS 구간 찾기 실패', err);
  }
  const cross = zones.map(() => new Map()); // 구간마다: 차 → 마지막으로 감지선을 지난 시각
  let marks = null, box = null, shown = '';
  let armed = false; // 처음으로 DRS가 켜진 레이스 스텝(불 꺼짐)부터 표시가 보임 = 예전과 같음

  function ensureMarks() {
    if (marks || !zones.length || typeof document === 'undefined') return;
    const scene = o.scene && o.scene();
    if (!scene) return;
    try {
      marks = buildMarks(track, zones);
      marks.visible = armed;
      scene.add(marks);
    } catch (err) {
      console.warn('DRS 표시 만들기 실패', err);
      marks = { visible: false };
    }
  }
  // 불러오는 동안 미리 만듦 (drswarm 2026-11-14): 예전엔 불이 꺼지는 첫 스텝에 레이 약 9×(길이/2+1)개/표시 + 새 셰이더·글자 그림을 처음 그려서
  //   그 프레임이 멈칫했음 (빙하 1배 약 105 ms, CPU 4배 350~760 ms). 지금은 여기서 만들어 숨겨 두고 → prewarm.js가 숨은 것까지 셰이더·텍스처를 준비 → 레이스 중엔 보이기만 바꿈.
  //   DRS를 안 쓰는 판(&drs=0·설정 끔·상대 없음)은 안 만듦. 온라인은 상대가 나중에 들어오니 주소에 room이 있으면 같이 미리 만듦. 못 만들면 예전처럼 첫 스텝에.
  try {
    const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    if (zones.length && (o.isOn() || (qs && qs.get('room') && qs.get('drs') !== '0'))) ensureMarks();
  } catch (err) {
    console.warn('DRS 표시 미리 만들기 실패', err);
  }
  function reset() {
    for (const m of cross) m.clear();
    for (const e of o.all()) {
      e.drsPrev = undefined;
      e.drsZ = null;
      e.drsShut = false;
      e.drsMiss = null;
      if (e.view && !e.remote) e.view.drs = 0;
    }
  }
  function canOpen(c) {
    return c && c.grounded && !c.flying && c.mode !== 'fly' && c.mode !== 'boat' && c.surface !== 'water' && !(c.gravityScale && Math.abs(c.gravityScale() - 1) > 0.08);
  }
  /** 물리 한 스텝 */
  function step(dt, time, racing) {
    const on = racing && zones.length && o.isOn();
    const list = o.all();
    if (on) {
      armed = true;
      ensureMarks();
    }
    if (marks) marks.visible = !!(armed && zones.length && o.isOn());
    const locals = o.local();
    for (const e of list) {
      const p = e.progress;
      if (p == null || !isFinite(p)) continue;
      const prev = e.drsPrev;
      e.drsPrev = p;
      if (!on || prev == null || e.finished || Math.abs(p - prev) > 0.03) continue; // 복귀로 순간이동하면 안 셈
      for (let k = 0; k < zones.length; k++) {
        const z = zones[k];
        if (Math.floor(p - z.detT) <= Math.floor(prev - z.detT)) continue;
        // 감지선을 지남: 바로 앞차(먼저 지나간 차 중 가장 최근)와의 시간
        let last = -Infinity;
        for (const [x, t] of cross[k]) if (x !== e && !x.finished && t <= time && t > last) last = t;
        cross[k].set(e, time);
        if (!locals.includes(e)) continue;
        const gap = time - last;
        if (time < C.startDelay) {
          if (e === o.me) e.drsMiss = { txt: '출발 직후엔 아직', t: 1.6 };
        } else if (gap <= C.detectSec) {
          e.drsZ = z;
          e.drsShut = false;
          e.drsMiss = null;
        } else if (e === o.me) e.drsMiss = { txt: isFinite(gap) && gap < 9.95 ? `앞차 +${gap.toFixed(1)}초` : '앞차 없음', t: 1.8 };
      }
    }
    // 열기·닫기 (내가 계산하는 차만)
    for (const e of locals) {
      const c = e.view;
      if (!c) continue;
      let want = 0;
      const z = e.drsZ;
      if (z && on && !e.finished) {
        const f = ((e.progress % 1) + 1) % 1;
        if (inArc(f, z.startT, z.endT)) {
          if ((c.brk || 0) > C.brakeClose) e.drsShut = true;
          if (!e.drsShut && canOpen(c)) want = 1;
          e.drsIn = true;
        } else if (e.drsIn) {
          // 구간을 지나감 → 끝
          e.drsZ = null;
          e.drsIn = false;
          e.drsShut = false;
        }
      } else e.drsIn = false;
      const cur = c.drs || 0;
      c.drs = want > cur ? Math.min(1, cur + dt / C.openTime) : Math.max(0, cur - dt / C.closeTime);
      if (e.drsMiss) e.drsMiss.t -= dt;
    }
  }
  /** 화면 (플레이어 칩) */
  function update(dt, racing) {
    if (typeof document === 'undefined') return;
    const me = o.me;
    let st = '';
    if (racing && zones.length && o.isOn() && !me.finished) {
      if ((me.view.drs || 0) > 0.5) st = 'open';
      else if (me.drsZ) st = me.drsShut ? 'shut' : 'armed';
      else if (me.drsMiss && me.drsMiss.t > 0) st = 'miss:' + me.drsMiss.txt;
    }
    if (st === shown) return;
    shown = st;
    if (!box) box = hudBox();
    if (!box) return;
    box.className = st ? 'on ' + st.split(':')[0] : '';
    const s = box.querySelector('.dr-st');
    if (s) s.textContent = st === 'open' ? '열림' : st === 'armed' ? '가능 · 직선에서 자동으로 열려요' : st === 'shut' ? '닫힘 (브레이크)' : st.startsWith('miss:') ? '✕ ' + st.slice(5) + ' (1초 안이어야)' : '';
  }
  return {
    zones,
    step,
    update,
    reset,
    info: () => ({ zones: zones.map((z) => ({ n: z.n, startT: +z.startT.toFixed(4), endT: +z.endT.toFixed(4), detT: +z.detT.toFixed(4), len: z.len })) }),
    hide() {
      if (box) box.className = '';
      shown = '';
    },
  };
}
