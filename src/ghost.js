// 고스트 (반투명 차, 부딪히지 않음) — 설정 ghost: 'off' | 'best' | 'bot'
//
//   'best' = 이 맵 + 이 차로 달린 내 최고 완주(레이스 전체, 여러 바퀴면 모든 바퀴)를 그대로 다시 보여 줌
//            (사용자 요청 2026-11-10: 바퀴가 바뀌어도 고스트가 처음으로 돌아가지 않고 이어서 달림, 최고 = 모든 바퀴 합)
//            불이 꺼진 순간부터 시간이 흐르고, 고스트가 그때 실제로 반응한 만큼 기다렸다 출발
//            초당 20번 위치·방향을 적어 두고, 완주 시간이 내 최고 고스트보다 빠르면 브라우저(localStorage)에 압축해서 저장
//            예전 바퀴별 고스트(첫 바퀴 '.start' + 달리는 바퀴)만 있으면 둘을 이어 붙여 레이스 전체 고스트로 씀
//            (records.js와 같은 규칙: 자동 운전 테스트·game.paused 중에는 저장 안 함)
//   'bot'  = "기본 봇" 고스트: 레이싱 라인을 속도 계획대로 달리는 차 (출발부터 끝까지 한 번에, 계산은 순식간)
//   화면 왼쪽 위에 고스트와의 시간 차이 (−0.42 초록 = 내가 빠름, +0.31 빨강 = 느림)
import * as THREE from 'three';
import { createCarModel } from './carModel.js';
import { fakeCar } from './opponents.js';
import { lineCarModel } from './car.js';

const HZ = 20;
const STRIDE = 12; // 샘플 하나: 위치 x,y,z (Int32, cm) + 방향 쿼터니언 4개 + 속도 + 모드 (Int16) → Int16 12칸 = 24바이트
const KEY = (map, car) => `gimmick.ghost.${map}.${car}`; // (예전) 달리는 바퀴 (2바퀴째부터)
const KEY_START = (map, car) => `gimmick.ghost.${map}.${car}.start`; // (예전) 첫 바퀴 (출발 신호부터)
const KEY_RUN = (map, car) => `gimmick.ghost.${map}.${car}.run`; // 레이스 전체 (출발 신호부터 결승까지)
const INDEX_KEY = 'gimmick.ghost.index';
const MAX_SAVED = 12; // 저장해 두는 고스트 수 (오래된 것부터 지움)
const MODES = ['normal', 'accel', 'boat', 'fly'];
const BOT_PACE = 0.9; // "기본 봇" 고스트 빠르기 (라인 계획 속도의 비율)

// --- 압축 (Int16 배열 ↔ base64) ---
function toB64(i16) {
  const u8 = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Int16Array(u8.buffer);
}

/** 기록 (메모리용): 위치·방향·속도·모드를 시간 순서대로 */
function emptyTrace() {
  return { n: 0, pos: [], quat: [], spd: [], mode: [], marks: [] };
}

function encode(tr) {
  const a = new Int16Array(tr.n * STRIDE);
  for (let i = 0; i < tr.n; i++) {
    const o = i * STRIDE;
    for (let k = 0; k < 3; k++) {
      const cm = Math.round(tr.pos[i * 3 + k] * 100);
      a[o + k * 2] = cm & 0xffff; // 아래 16비트
      a[o + k * 2 + 1] = cm >> 16; // 위 16비트
    }
    for (let k = 0; k < 4; k++) a[o + 6 + k] = Math.round(tr.quat[i * 4 + k] * 32000);
    a[o + 10] = Math.round(Math.min(800, tr.spd[i]) * 40);
    a[o + 11] = tr.mode[i];
  }
  return a;
}
function decode(a) {
  const n = Math.floor(a.length / STRIDE);
  const tr = { n, pos: new Float32Array(n * 3), quat: new Float32Array(n * 4), spd: new Float32Array(n), mode: new Uint8Array(n), marks: [] };
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    for (let k = 0; k < 3; k++) tr.pos[i * 3 + k] = (((a[o + k * 2 + 1] << 16) | (a[o + k * 2] & 0xffff)) / 100);
    for (let k = 0; k < 4; k++) tr.quat[i * 4 + k] = a[o + 6 + k] / 32000;
    tr.spd[i] = a[o + 10] / 40;
    tr.mode[i] = a[o + 11];
  }
  return tr;
}

function loadIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]') || [];
  } catch {
    return [];
  }
}
function saveStored(key, value) {
  let idx = loadIndex().filter((k) => k !== key);
  idx.push(key);
  // 너무 많으면 오래된 것부터 지움
  while (idx.length > MAX_SAVED) {
    try {
      localStorage.removeItem(idx.shift());
    } catch {}
  }
  for (let tries = 0; tries < 6; tries++) {
    try {
      localStorage.setItem(key, value);
      localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
      return true;
    } catch {
      // 저장 공간이 꽉 참 → 가장 오래된 고스트 하나 지우고 다시
      const old = idx.find((k) => k !== key);
      if (!old) return false;
      idx = idx.filter((k) => k !== old);
      try {
        localStorage.removeItem(old);
      } catch {}
    }
  }
  return false;
}

/**
 * @param o { scene, track, carCfg, look, mapName, carId, laps, spawnT }
 */
export function createGhost(o) {
  const { scene, track } = o;
  const L = track.length;
  const M = Math.max(100, Math.min(600, Math.round(L / 20))); // 한 바퀴 시간 기록 지점 수 (시간 차이 계산용)
  const lenKey = Math.round(L);
  let kind = 'off';

  // --- 모델 (반투명) --- 친구 고스트는 그 친구 차 모양 + 주황빛 (makeModel로 다시 만듦)
  let model = null, ghostMats = [];
  function makeModel(look, glow = '#3d9bff') {
    if (model) {
      scene.remove(model.root);
      if (model.dispose) model.dispose();
    }
    model = createCarModel(look || '#9fd8ff');
  const matMap = new Map();
  model.root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = false;
    obj.receiveShadow = false;
    const conv = (m) => {
      if (!matMap.has(m)) {
        const c = m.clone();
        c.transparent = true;
        c.depthWrite = false;
        c.userData.baseOpacity = (m.opacity ?? 1) * 0.5;
        c.opacity = c.userData.baseOpacity;
        // 파르스름하게 빛나는 유령 느낌 (어두운 맵에서도 보이게)
        if (c.emissive) {
          c.emissive.set(glow);
          c.emissiveIntensity = 0.55;
        } else if (c.color) c.color.lerp(new THREE.Color('#9fd0ff'), 0.5);
        matMap.set(m, c);
      }
      return matMap.get(m);
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(conv) : conv(obj.material);
    obj.renderOrder = 3;
  });
  ghostMats = [...matMap.values()];
  model.root.visible = false;
  scene.add(model.root);
  fade = 1;
  }
  let fade = 1;
  makeModel(o.look);
  const view = fakeCar();

  // --- 저장된 최고 랩 고스트 ---
  // best = 달리는 바퀴(2바퀴째부터) 최고, bestStart = 첫 바퀴(출발 신호부터) 최고. 둘 다 { lap, tr, marks, react }
  function loadSlot(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (j.v !== 1 || j.len !== lenKey) return null;
      const tr = decode(fromB64(j.data));
      return { lap: j.lap, tr, marks: Float32Array.from(j.marks.map((ms) => (ms < 0 ? NaN : ms / 1000))), react: j.react ?? reactionOf(tr) };
    } catch (err) {
      console.warn('고스트 불러오기 실패', err);
      return null;
    }
  }
  /** 첫 바퀴 기록에서 처음 움직이기 시작한 시각 (= 고스트의 반응 속도, 초) */
  function reactionOf(tr) {
    for (let i = 0; i < tr.n; i++) if (tr.spd[i] > 0.5) return Math.max(0, (i - 1) / HZ);
    return null;
  }
  const LAPS = Math.max(1, o.laps || 1);
  const RM = LAPS * M; // 레이스 전체 진행 지점 수 (바퀴마다 M개)
  let best = loadSlot(KEY(o.mapName, o.carId));
  let bestStart = loadSlot(KEY_START(o.mapName, o.carId));
  // 1바퀴짜리 맵(그랑프리)은 예전에 저장한 최고 랩도 첫 바퀴(출발 신호부터)였음
  if (o.laps === 1 && !bestStart && best) bestStart = best;
  /** 레이스 전체 고스트 JSON(v 2) → { total, segs: [{ tr, off }], marks, react, relative: 'race' } (맵 길이·바퀴 수가 다르면 null) */
  function parseRun(raw) {
    if (!raw) return null;
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (j.v !== 2 || j.len !== lenKey || j.laps !== LAPS) return null;
    const tr = decode(fromB64(j.data));
    const marks = Float32Array.from(j.marks.map((ms) => (ms < 0 ? NaN : ms / 1000)));
    return { total: j.total, segs: [{ tr, off: 0 }], marks, react: j.react ?? reactionOf(tr), relative: 'race' };
  }
  function loadRun() {
    try {
      return parseRun(localStorage.getItem(KEY_RUN(o.mapName, o.carId)));
    } catch (err) {
      console.warn('고스트 불러오기 실패', err);
      return null;
    }
  }
  let friend = null; // 온라인 순위표에서 고른 다른 사람 고스트 (kind 'friend')
  let lastRunJson = null; // 방금 끝난 레이스의 고스트 JSON (온라인 순위표에 올릴 것)
  /** 예전 바퀴별 고스트를 이어 붙임: 첫 바퀴(출발) + 달리는 바퀴 × (바퀴 수 − 1) */
  function stitched() {
    if (!bestStart || (LAPS > 1 && !best)) return null;
    const segs = [], marks = new Float32Array(RM + 1).fill(NaN);
    let off = 0;
    for (let l = 0; l < LAPS; l++) {
      const g = l === 0 ? bestStart : best;
      segs.push({ tr: g.tr, off });
      for (let k = 0; k <= M; k++) if (isFinite(g.marks[k])) marks[l * M + k] = off + g.marks[k];
      off += g.lap;
    }
    return { total: off, segs, marks, react: bestStart.react, relative: 'race', stitched: true };
  }
  let run = loadRun() || stitched();

  // --- 기본 봇 고스트 (라인 + 속도 계획으로 바로 계산) ---
  let bot = null;
  function buildBot() {
    const line = track.racingLine;
    if (!line) return null;
    const N = line.N, S = track.samples;
    const cm = lineCarModel(o.carCfg);
    const prof = line.profile(cm);
    const W = (i) => ((i % N) + N) % N;
    const start = W(Math.round((o.spawnT ?? 0.992) * N));
    const steps = Math.ceil(N * (o.laps + (1 - start / N)) + 2);
    // 지점마다 도착 시각: 출발은 0 속도에서, 반응 0.25초 뒤 가속 (엔진 한계 aAcc), 그 뒤 계획 속도 × BOT_PACE
    const times = new Float32Array(steps + 1);
    let v = 0, t = 0.25;
    times[0] = t;
    for (let s = 0; s < steps; s++) {
      const i = W(start + s), nx = W(start + s + 1);
      const seg = line.seg[i];
      const vn = Math.min(prof.speed[nx] * BOT_PACE, Math.sqrt(v * v + 2 * cm.aAcc(v) * seg));
      t += seg / Math.max(0.5, (v + vn) / 2);
      v = vn;
      times[s + 1] = t;
    }
    // 20 Hz 샘플
    const tr = { n: 0, pos: [], quat: [], spd: [], mode: [] };
    const q = new THREE.Quaternion(), mtx = new THREE.Matrix4(), xA = new THREE.Vector3(), fw = new THREE.Vector3(), up = new THREE.Vector3();
    const pAt = (s, out) => {
      const i = W(s);
      const y = track.lineY ? track.lineY(i, 0) : S[i].pos.y;
      return out.set(line.x[i], y + 0.02, line.z[i]);
    };
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    let s = 0;
    const end = times[steps];
    for (let ts = 0; ts <= end; ts += 1 / HZ) {
      while (s < steps - 1 && times[s + 1] < ts) s++;
      const f = Math.max(0, Math.min(1, (ts - times[s]) / Math.max(1e-4, times[s + 1] - times[s])));
      pAt(start + s, pa);
      pAt(start + s + 1, pb);
      const p = pa.clone().lerp(pb, f);
      fw.subVectors(pb, pa).normalize();
      const i = W(start + s);
      up.copy(S[i].up || new THREE.Vector3(0, 1, 0));
      fw.addScaledVector(up, -fw.dot(up)).normalize();
      xA.crossVectors(up, fw).normalize();
      mtx.makeBasis(xA, up, fw);
      q.setFromRotationMatrix(mtx);
      tr.pos.push(p.x, p.y, p.z);
      tr.quat.push(q.x, q.y, q.z, q.w);
      const sp = line.seg[i] / Math.max(1e-3, times[s + 1] - times[s]);
      tr.spd.push(sp);
      const water = track.isWaterT ? track.isWaterT(i / N) : false;
      tr.mode.push(water ? 2 : sp * 3.6 > 150 ? 1 : 0);
      tr.n++;
    }
    // 레이스 전체 진행 지점 시각 (진행 = 출발선 기준 바퀴 수)
    const marks = new Float32Array((o.laps + 1) * M + 1).fill(NaN);
    for (let s2 = 0; s2 <= steps; s2++) {
      const prog = (start + s2) / N - 1; // 그리드(출발선 뒤)는 음수
      const k = Math.floor(prog * M);
      if (k >= 0 && k < marks.length && !isFinite(marks[k])) marks[k] = times[s2];
    }
    return { tr, marks, total: end, relative: 'race' };
  }

  // --- 지금 바퀴 기록 (플레이어) ---
  let rec = emptyTrace();
  let recMarks = new Float32Array(RM + 1).fill(NaN);
  let recNext = 0;
  let recT = 0;
  const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _x = new THREE.Vector3();

  function active() {
    if (kind === 'best') return run; // 레이스 전체 (바퀴가 바뀌어도 이어서)
    if (kind === 'friend') return friend;
    if (kind === 'bot') return (bot ||= buildBot());
    return null;
  }

  /** 시각 t(초)의 고스트 위치 → view */
  function place(g, t) {
    let tr = g.tr;
    if (g.segs) {
      // 이어 붙인 고스트: 시각 t가 들어가는 조각 (마지막 조각은 끝까지)
      let sg = g.segs[0];
      for (const x of g.segs) if (t >= x.off) sg = x;
      tr = sg.tr;
      t -= sg.off;
    }
    const fi = t * HZ;
    if (fi < 0 || fi > tr.n - 1) return false;
    const i = Math.min(tr.n - 2, Math.floor(fi)), f = fi - i;
    const P = tr.pos, Q = tr.quat;
    view.pos.set(P[i * 3] + (P[i * 3 + 3] - P[i * 3]) * f, P[i * 3 + 1] + (P[i * 3 + 4] - P[i * 3 + 1]) * f, P[i * 3 + 2] + (P[i * 3 + 5] - P[i * 3 + 2]) * f);
    const qa = new THREE.Quaternion(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]).normalize();
    const qb = new THREE.Quaternion(Q[i * 4 + 4], Q[i * 4 + 5], Q[i * 4 + 6], Q[i * 4 + 7]).normalize();
    qa.slerp(qb, f);
    view.fwd.set(0, 0, 1).applyQuaternion(qa);
    view.up.set(0, 1, 0).applyQuaternion(qa);
    view.forwardSpeed = view.speed = tr.spd[i];
    view.mode = MODES[tr.mode[i] & 3] || 'normal';
    view.form = tr.mode[i] & 8 ? 'spike' : null;
    view.thr = 1;
    view.vel.copy(view.fwd).multiplyScalar(view.speed);
    return true;
  }

  return {
    get kind() {
      return kind;
    },
    get best() {
      return best;
    },
    M,
    setKind(k) {
      if (friend && k !== 'off') k = 'friend'; // 친구 고스트를 골라 들어왔으면 설정보다 먼저
      kind = k === 'best' || k === 'bot' || k === 'friend' ? k : 'off';
      if (kind === 'off') model.root.visible = false;
    },
    /** 저장된 최고 랩 고스트가 있는지 */
    hasBest: () => !!run,
    /** 고스트의 반응 속도 (초, 불이 꺼진 뒤 움직이기 시작할 때까지). 없으면 null */
    get startReaction() {
      const g = kind === 'best' ? run : kind === 'friend' ? friend : null;
      return g ? g.react : null;
    },
    /** 친구(온라인) 고스트 쓰기: json = 서버의 고스트, look = 그 차 모양, name = 이름. 맞지 않는 맵이면 false */
    useFriend(json, look, name) {
      try {
        friend = parseRun(json);
      } catch (err) {
        console.warn('친구 고스트 불러오기 실패', err);
        friend = null;
      }
      if (!friend) return false;
      friend.name = name || '친구';
      makeModel(look, '#ff9a3d');
      kind = 'friend';
      return true;
    },
    get friendName() {
      return friend ? friend.name : null;
    },
    /** 방금 완주한 레이스의 고스트 JSON (온라인에 올릴 것, 기록이 모자라면 null) */
    get lastRunJson() {
      return lastRunJson;
    },
    /** 레이스 시작: 기록을 새로 (출발 신호부터 결승까지 한 번에 기록) */
    lapStart() {
      rec = emptyTrace();
      recMarks = new Float32Array(RM + 1).fill(NaN);
      recNext = 0;
      recT = 0;
    },
    /**
     * 매 물리 스텝: 내 차 기록 (20 Hz) + 진행 지점 시각
     * raceTime = 불이 꺼진 뒤 시간, raceProg = 레이스 진행 (바퀴 수, 0~laps, 출발 전 그리드는 음수)
     */
    record(raceTime, car, raceProg) {
      const k1 = Math.floor(raceProg * M);
      while (recNext <= k1 && recNext <= RM) {
        if (recNext >= 0) recMarks[recNext] = raceTime;
        recNext++;
      }
      if (raceTime + 1e-6 < recT) return;
      recT += 1 / HZ;
      _x.crossVectors(car.up, car.fwd).normalize();
      _m.makeBasis(_x, car.up, car.fwd);
      _q.setFromRotationMatrix(_m);
      rec.pos.push(car.pos.x, car.pos.y, car.pos.z);
      rec.quat.push(_q.x, _q.y, _q.z, _q.w);
      rec.spd.push(Math.abs(car.forwardSpeed));
      rec.mode.push(Math.max(0, MODES.indexOf(car.mode || 'normal')) | (car.form === 'spike' ? 8 : 0));
      rec.n++;
    },
    /** 완주: 레이스 전체가 내 최고 고스트보다 빠르면 저장. 저장했으면 true */
    raceDone(total, canSave) {
      lastRunJson = null;
      // 레이스를 거의 다 지나며 기록한 경우만 (순간이동·테스트로 끝난 레이스는 저장 안 함)
      if (!canSave || rec.n < 20 || recNext < RM * 0.9) return false;
      for (let k = 0; k <= RM; k++) if (!isFinite(recMarks[k])) recMarks[k] = k === RM ? total : recMarks[Math.max(0, k - 1)];
      const enc = encode(rec);
      const tr = decode(enc); // 저장되는 것과 똑같이 (압축 정밀도)
      const react = reactionOf(tr);
      const json = JSON.stringify({ v: 2, len: lenKey, laps: LAPS, total: +total.toFixed(3), date: Date.now(), react, data: toB64(enc), marks: Array.from(recMarks, (t) => (isFinite(t) ? Math.round(t * 1000) : -1)) });
      lastRunJson = json;
      // 예전 바퀴별 고스트를 이어 붙인 것은 진짜 완주 기록이 생기면 바로 바꿈
      if (run && !run.stitched && run.total <= total) return false;
      run = { total, segs: [{ tr, off: 0 }], marks: recMarks.slice(), react, relative: 'race' };
      saveStored(KEY_RUN(o.mapName, o.carId), json);
      // 예전 바퀴별 고스트는 이제 필요 없음 (저장 공간 아끼기)
      for (const k of [KEY(o.mapName, o.carId), KEY_START(o.mapName, o.carId)]) {
        try {
          localStorage.removeItem(k);
        } catch {}
      }
      best = bestStart = null;
      return true;
    },
    /**
     * 고스트와 시간 차이 (초, + = 내가 느림). 마지막으로 지난 지점에서 비교
     * lapFrac/lapTime: 이번 바퀴, raceProg/raceTime: 레이스 전체
     */
    delta(lapFrac, lapTime, raceProg, raceTime) {
      const g = active();
      if (!g) return null;
      // 마지막으로 지난 진행 지점에서 내 시각 − 고스트 시각 (레이스 전체 기준, 바퀴가 바뀌어도 이어서)
      const k = Math.min(recNext - 1, RM, g.marks.length - 1);
      if (k < 1 || !isFinite(g.marks[k]) || !isFinite(recMarks[k])) return null;
      return recMarks[k] - g.marks[k];
    },
    /** 매 화면: 고스트 위치 (lapTime = 이번 바퀴 시간, raceTime = 출발 뒤 시간) */
    update(dt, elapsed, lapTime, raceTime, camera, show) {
      const g = show ? active() : null;
      if (!g || !place(g, raceTime)) {
        model.root.visible = false;
        return;
      }
      model.root.visible = true;
      // 카메라에 가까우면 더 흐리게 (내 차를 가리지 않게)
      const d = camera.position.distanceTo(view.pos);
      const want = Math.max(0.25, Math.min(1, (d - 4) / 14));
      if (Math.abs(want - fade) > 0.02) {
        fade = want;
        for (const m of ghostMats) m.opacity = m.userData.baseOpacity * fade;
      }
      model.sync(view, dt, elapsed);
    },
    hide() {
      model.root.visible = false;
    },
    /** 테스트용 */
    view,
    get model() {
      return model;
    },
    _debug: () => ({ rec: rec.n, recNext, RM, run: run && { total: run.total, segs: run.segs.length, n: run.segs.reduce((a, x) => a + x.tr.n, 0), react: run.react, stitched: !!run.stitched }, bot: bot && { n: bot.tr.n, total: bot.total } }),
  };
}
