// 온라인에 올리는 고스트 줄이기 (2026-11-14, Supabase 무료 한도 아끼기)
//
//   예전(v 2) = ghost.js가 만든 JSON 그대로: data = Int16 12칸(위치 cm·방향·속도·모드) × 샘플 수를 base64로, marks = 진행 지점 ms 배열
//              → 3분 레이스 하나에 약 110 KB
//   지금(v 3) = { v: 3, len, laps, total, date, react, start, mode, n, c: 'gz' | 'raw', z }
//              z = 같은 값들을 열(column)마다 '앞 샘플과의 차이'로 바꿔 가변 길이 정수(varint)로 적고 gzip(CompressionStream) → base64
//              위치(1 cm)·모드·진행 지점은 v 2와 똑같고, 방향은 1/4000(오차 최대 약 0.03°)·속도는 0.1 m/s로 줄임
//              위치·방향은 2차 차분(차이의 차이)이라 매끈하게 달리는 동안 거의 0 → gzip이 아주 잘 줄임
//   packGhost(v2) → v3 JSON 문자열 (CompressionStream이 없는 브라우저는 gzip 없이 c: 'raw')
//   unpackGhost(raw) → v2 객체 (v3이면 풀고, v2·다른 것은 그대로 객체로). 못 풀면 null
const STRIDE = 12;
const MAGIC = 0x47; // 'G'
const FMT = 1; // z 안 바이너리 모양 번호

// --- base64 ---
function b64FromU8(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function u8FromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

// --- 가변 길이 정수 (zigzag) ---
class Writer {
  constructor(cap = 1 << 16) {
    this.b = new Uint8Array(cap);
    this.n = 0;
  }
  grow(k) {
    if (this.n + k <= this.b.length) return;
    const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k));
    nb.set(this.b.subarray(0, this.n));
    this.b = nb;
  }
  byte(v) {
    this.grow(1);
    this.b[this.n++] = v & 0xff;
  }
  uvar(v) {
    // v: 0 ~ 2^32-1 (정수)
    this.grow(5);
    v = v >>> 0;
    while (v >= 0x80) {
      this.b[this.n++] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    this.b[this.n++] = v;
  }
  svar(v) {
    this.uvar(((v << 1) ^ (v >> 31)) >>> 0);
  }
  out() {
    return this.b.subarray(0, this.n);
  }
}
class Reader {
  constructor(u8) {
    this.b = u8;
    this.i = 0;
  }
  byte() {
    if (this.i >= this.b.length) throw new Error('ghostPack: 끝');
    return this.b[this.i++];
  }
  uvar() {
    let v = 0, sh = 0, c;
    do {
      c = this.byte();
      v += (c & 0x7f) * 2 ** sh;
      sh += 7;
    } while (c & 0x80 && sh < 35);
    return v >>> 0;
  }
  svar() {
    const u = this.uvar();
    return (u >>> 1) ^ -(u & 1);
  }
}

// --- gzip ---
const canGzip = () => typeof CompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function';
const canGunzip = () => typeof DecompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function';
async function gzip(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function int16FromB64(b64) {
  const u8 = u8FromB64(b64);
  return new Int16Array(u8.buffer, 0, u8.length >> 1);
}

// 방향·속도 칸 줄이기: 쿼터니언 칸은 8단계씩(1/4000, 방향 오차 최대 약 0.03°), 속도는 4단계씩(0.1 m/s)
//   위치(1 cm)·진행 지점(ms)·모드는 v 2와 똑같이
const Q_STEP = 8, S_STEP = 4;

/** v2 data(Int16) + marks → 열마다 차이 varint 바이너리 (위치·방향은 '차이의 차이' = 2차 차분) */
function encodeBody(a, marks) {
  const n = Math.floor(a.length / STRIDE);
  const w = new Writer(n * 14 + marks.length * 3 + 64);
  w.byte(MAGIC);
  w.byte(FMT);
  w.uvar(n);
  w.uvar(marks.length);
  w.uvar(Q_STEP);
  w.uvar(S_STEP);
  const col = new Int32Array(n);
  const put2 = () => {
    // 2차 차분: v[i] − 2·v[i−1] + v[i−2]
    let p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++) {
      const v = col[i];
      w.svar((v - 2 * p1 + p2) | 0);
      p2 = p1;
      p1 = v;
    }
  };
  // 위치 x,y,z (Int32 cm = 아래 16비트 + 위 16비트)
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE + k * 2;
      col[i] = (a[o + 1] << 16) | (a[o] & 0xffff);
    }
    put2();
  }
  // 방향 쿼터니언 4칸
  for (let k = 6; k <= 9; k++) {
    for (let i = 0; i < n; i++) col[i] = Math.round(a[i * STRIDE + k] / Q_STEP);
    put2();
  }
  // 속도 (1차 차분)
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.round(a[i * STRIDE + 10] / S_STEP);
    w.svar(v - prev);
    prev = v;
  }
  // 모드 (그대로, 0~15)
  for (let i = 0; i < n; i++) w.svar(a[i * STRIDE + 11]);
  // 진행 지점 ms (−1 = 없음, 1차 차분)
  prev = 0;
  for (let i = 0; i < marks.length; i++) {
    const v = Math.round(marks[i]) | 0;
    w.svar((v - prev) | 0);
    prev = v;
  }
  return w.out();
}
function decodeBody(u8) {
  const r = new Reader(u8);
  if (r.byte() !== MAGIC) throw new Error('ghostPack: 모양이 달라요');
  const fmt = r.byte();
  if (fmt !== FMT) throw new Error('ghostPack: 모르는 형식 ' + fmt);
  const n = r.uvar(), nm = r.uvar();
  if (n > 2e6 || nm > 2e6) throw new Error('ghostPack: 너무 큼');
  const qs = r.uvar() || 1, ss = r.uvar() || 1;
  const a = new Int16Array(n * STRIDE);
  const get2 = (put) => {
    let p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++) {
      const v = (r.svar() + 2 * p1 - p2) | 0;
      put(i, v);
      p2 = p1;
      p1 = v;
    }
  };
  for (let k = 0; k < 3; k++)
    get2((i, cm) => {
      const o = i * STRIDE + k * 2;
      a[o] = cm & 0xffff;
      a[o + 1] = cm >> 16;
    });
  for (let k = 6; k <= 9; k++) get2((i, v) => (a[i * STRIDE + k] = Math.max(-32767, Math.min(32767, v * qs))));
  let v = 0;
  for (let i = 0; i < n; i++) {
    v += r.svar();
    a[i * STRIDE + 10] = Math.max(-32768, Math.min(32767, v * ss));
  }
  for (let i = 0; i < n; i++) a[i * STRIDE + 11] = r.svar();
  const marks = new Array(nm);
  let m = 0;
  for (let i = 0; i < nm; i++) {
    m = (m + r.svar()) | 0;
    marks[i] = m;
  }
  return { a, marks };
}

const META = ['len', 'laps', 'total', 'date', 'react', 'start', 'mode'];

/**
 * v2 고스트(JSON 문자열 또는 객체) → v3 JSON 문자열. v2가 아니면 그대로 문자열로 돌려줌.
 * opt.gzip = false 이면 gzip 없이 (테스트용)
 */
export async function packGhost(raw, opt = {}) {
  const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!j || j.v !== 2 || typeof j.data !== 'string' || !Array.isArray(j.marks)) return typeof raw === 'string' ? raw : JSON.stringify(raw);
  const a = int16FromB64(j.data);
  let body = encodeBody(a, j.marks);
  let c = 'raw';
  if (opt.gzip !== false && canGzip()) {
    body = await gzip(body);
    c = 'gz';
  }
  const out = { v: 3 };
  for (const k of META) if (j[k] !== undefined) out[k] = j[k];
  out.n = Math.floor(a.length / STRIDE);
  out.c = c;
  out.z = b64FromU8(body);
  return JSON.stringify(out);
}

/** 서버에서 받은 고스트(문자열·객체) → v2 객체 (ghost.js parseRun이 읽는 모양). 못 풀면 null */
export async function unpackGhost(raw) {
  if (raw == null) return null;
  let j;
  try {
    j = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  if (j.v !== 3) return j; // v2(예전 고스트)·다른 것은 그대로
  if (typeof j.z !== 'string') return null;
  let body = u8FromB64(j.z);
  if (j.c === 'gz') {
    if (!canGunzip()) return null;
    body = await gunzip(body);
  } else if (j.c !== 'raw') return null;
  const { a, marks } = decodeBody(body);
  const out = { v: 2 };
  for (const k of META) if (j[k] !== undefined) out[k] = j[k];
  const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  out.data = b64FromU8(u8);
  out.marks = marks;
  return out;
}

/** 두 v2 data의 최대 차이 { pos(m), quat(칸 값), spd(m/s), mode(다른 개수), n(샘플 수 같은지) } */
export function ghostDiff(aB64, bB64) {
  const a = int16FromB64(aB64), b = int16FromB64(bB64);
  const out = { sameN: a.length === b.length, pos: 0, quat: 0, spd: 0, mode: 0 };
  if (!out.sameN) return out;
  const n = a.length / STRIDE;
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    for (let k = 0; k < 3; k++) {
      const ca = (a[o + k * 2 + 1] << 16) | (a[o + k * 2] & 0xffff), cb = (b[o + k * 2 + 1] << 16) | (b[o + k * 2] & 0xffff);
      out.pos = Math.max(out.pos, Math.abs(ca - cb) / 100);
    }
    for (let k = 6; k <= 9; k++) out.quat = Math.max(out.quat, Math.abs(a[o + k] - b[o + k]) / 32000);
    out.spd = Math.max(out.spd, Math.abs(a[o + 10] - b[o + 10]) / 40);
    if (a[o + 11] !== b[o + 11]) out.mode++;
  }
  return out;
}

/** packGhost 결과가 원래 v2와 같게 풀리는지 확인하고 올림 (위치·모드·진행 지점은 똑같이, 방향·속도는 줄인 만큼만) */
export async function packVerified(raw) {
  const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const packed = await packGhost(j);
  if (!j || j.v !== 2) return packed;
  const back = await unpackGhost(packed);
  const d = back && ghostDiff(j.data, back.data);
  const ok = d && d.sameN && d.pos === 0 && d.mode === 0 && d.quat <= (Q_STEP / 2 + 1) / 32000 && d.spd <= (S_STEP / 2 + 1) / 40 &&
    back.marks.length === j.marks.length && back.marks.every((m, i) => m === Math.round(j.marks[i]));
  if (!ok) throw new Error('ghostPack: 되돌려 보니 달라요');
  return packed;
}
