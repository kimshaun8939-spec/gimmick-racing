// 느린 노트북 (2026-11-14): 충돌 외곽을 잴 때 메시의 모든 꼭짓점(차 한 대 약 3만 개) 대신
//   그 메시 모양의 볼록 껍질 꼭짓점만 씀. 위치·회전·크기를 바꿔도(아핀 변환) 껍질 꼭짓점의 상은
//   전체 점의 상의 껍질을 그대로 만들므로 결과 외곽은 같음. 도형마다 한 번만 계산해 기억.
//   ?hullcache=0 = 예전(모든 꼭짓점)
import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hullcache') === '0';
const cache = new WeakMap();
// 26방향(상자 면·모서리·꼭짓점) 받침값이 전체 점과 같은지로 껍질 결과를 확인. 다르면 전체 점을 씀.
const DIRS = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) DIRS.push([x, y, z]);

function allIdx(n) { const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }

function compute(p) {
  const n = p.count;
  if (OFF || n <= 32) return allIdx(n);
  const pts = new Array(n);
  for (let i = 0; i < n; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); v.userData = i; pts[i] = v; }
  let keep;
  try {
    const hull = new ConvexHull().setFromPoints(pts), set = new Set();
    for (const f of hull.faces) { let e = f.edge; do { set.add(e.head().point.userData); e = e.next; } while (e !== f.edge); }
    keep = [...set];
  } catch (e) { return allIdx(n); }
  if (keep.length < 4) return allIdx(n);
  // 확인: 받침값 차이가 1e-6 m보다 크면 껍질이 잘못 나온 것 (납작한 판 등)
  for (const [x, y, z] of DIRS) {
    let a = -Infinity, b = -Infinity;
    for (const v of pts) { const d = v.x * x + v.y * y + v.z * z; if (d > a) a = d; }
    for (const i of keep) { const v = pts[i]; const d = v.x * x + v.y * y + v.z * z; if (d > b) b = d; }
    if (a - b > 1e-6) return allIdx(n);
  }
  keep.sort((a, b) => a - b);
  return Uint32Array.from(keep);
}

/** 이 도형 위치 속성에서 외곽에 필요한 꼭짓점 번호 (모양이 바뀌면 다시 계산) */
export function hullIndices(geometry) {
  const p = geometry.attributes.position;
  if (hullOff()) return allIdx(p.count); // 시험용: 예전과 비교
  let c = cache.get(geometry);
  if (!c || c.attr !== p || c.ver !== p.version || c.count !== p.count) {
    c = { attr: p, ver: p.version, count: p.count, idx: compute(p) };
    cache.set(geometry, c);
  }
  return c.idx;
}

/** 시험용 (globalThis.__hullOff) 또는 ?hullcache=0 이면 예전처럼 모든 꼭짓점 */
export function hullOff() { return OFF || !!globalThis.__hullOff; }

/** 점들의 볼록 껍질 꼭짓점 (껍질이 안 되면 그대로) */
export function hullPoints(points) {
  if (points.length < 4) return points;
  try {
    const hull = new ConvexHull().setFromPoints(points), set = new Set();
    for (const f of hull.faces) { let e = f.edge; do { set.add(e.head().point); e = e.next; } while (e !== f.edge); }
    return set.size >= 4 ? [...set] : points;
  } catch (e) { return points; }
}
