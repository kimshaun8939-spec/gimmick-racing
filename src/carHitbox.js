// 일반 모드 기본 모델의 바퀴·앞/뒷날개를 포함한 충돌 상자.
// car.pos는 모델 root 원점. +z 앞, +y 위. 크기는 m, normal은 b → a.
import * as THREE from 'three';
import { createCarModel, normalizeLook } from './carModel.js';

const shapes = new Map();
const objects = new WeakMap();
const EPS = 1e-7;
const UP = new THREE.Vector3(0, 1, 0);

/** Car / cfg / roster entry / createCarModel 결과 / look → 불변 크기.
 * 첫 look에서만 기본 모델을 만들고 정리한다. 이후 객체·look 캐시 사용.
 * 모델 자체를 넘기면 이미 측정한 normalBounds를 사용한다.
 * 코스튬·가속·배·비행·1인칭·발광 효과는 물리 크기를 바꾸지 않는다.
 */
export function hitboxFor(source = {}) {
  if (source && typeof source === 'object') {
    const cached = objects.get(source);
    if (cached) return cached;
  }
  const cfg = source.cfg || source;
  const look = normalizeLook(cfg.look || source.look || cfg);
  delete look.costume;
  const key = JSON.stringify(Object.keys(look).sort().map(k => [k, look[k]]));
  let box = shapes.get(key);
  if (!box) {
    if (source.normalBounds && !source.look?.costume) box = source.normalBounds;
    else {
      const model = createCarModel(look);
      box = model.normalBounds;
      model.dispose();
    }
    if (![box.front, box.back, box.half, box.height, box.bottom].every(Number.isFinite) || Math.min(box.front, box.back, box.half, box.height) <= 0) throw new Error('Invalid car model hitbox');
    box = Object.freeze({ ...box });
    shapes.set(key, box);
  }
  if (source && typeof source === 'object') objects.set(source, box);
  return box;
}

function basis(car) {
  const up = new THREE.Vector3().copy(car.up || UP).normalize();
  if (up.lengthSq() < EPS) up.copy(UP);
  const fwd = new THREE.Vector3().copy(car.fwd || new THREE.Vector3(0, 0, 1)).projectOnPlane(up);
  if (fwd.lengthSq() < EPS) fwd.set(0, 0, 1).projectOnPlane(up);
  if (fwd.lengthSq() < EPS) fwd.set(1, 0, 0).projectOnPlane(up);
  fwd.normalize();
  return { up, fwd, right: new THREE.Vector3().crossVectors(up, fwd).normalize() };
}

/** 디버그용. 원점 기준 앞뒤 비대칭·바닥 높이를 반영한 8개 꼭짓점. */
export function hitboxCorners(car) {
  const h = hitboxFor(car), b = basis(car), points = [];
  for (const y of [h.bottom, h.bottom + h.height])
    for (const z of [-h.back, h.front])
      for (const x of [-h.half, h.half]) points.push(new THREE.Vector3().copy(car.pos).addScaledVector(b.right, x).addScaledVector(b.fwd, z).addScaledVector(b.up, y));
  return points;
}

function rectangle(car, planeUp) {
  const h = hitboxFor(car), b = basis(car);
  const center = new THREE.Vector3().copy(car.pos)
    .addScaledVector(b.fwd, (h.front - h.back) / 2)
    .addScaledVector(b.up, h.bottom + h.height / 2);
  const fwd = b.fwd.clone().projectOnPlane(planeUp);
  if (fwd.lengthSq() < EPS) fwd.copy(b.right).projectOnPlane(planeUp);
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(planeUp, fwd).normalize();
  const length = (h.front + h.back) / 2;
  // 서로 기울기가 달라도 높이는 실제 8개 꼭짓점의 투영 범위를 사용.
  const vertical = length * Math.abs(b.fwd.dot(planeUp)) + h.half * Math.abs(b.right.dot(planeUp)) + h.height / 2 * Math.abs(b.up.dot(planeUp));
  return { center, fwd, right, length, half: h.half, vertical };
}

function radius(r, axis) {
  return r.length * Math.abs(r.fwd.dot(axis)) + r.half * Math.abs(r.right.dot(axis));
}

// 접촉 지점: a 사각형을 b의 네 변으로 잘라 겹친 영역 가운데를 구함.
function contactPoint(a, b, up, low, high) {
  let polygon = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) => a.center.clone().addScaledVector(a.right, x*a.half).addScaledVector(a.fwd, z*a.length));
  for (const [axis, limit] of [[b.right,b.half],[b.right.clone().negate(),b.half],[b.fwd,b.length],[b.fwd.clone().negate(),b.length]]) {
    const input = polygon; polygon = [];
    for (let i=0; i<input.length; i++) {
      const p=input[i], q=input[(i+1)%input.length];
      const dp=p.clone().sub(b.center).dot(axis)-limit, dq=q.clone().sub(b.center).dot(axis)-limit;
      if (dp<=EPS) polygon.push(p);
      if ((dp<0 && dq>0) || (dp>0 && dq<0)) polygon.push(p.clone().lerp(q, dp/(dp-dq)));
    }
  }
  const point = new THREE.Vector3();
  if (polygon.length) { for (const p of polygon) point.add(p); point.multiplyScalar(1/polygon.length); }
  else point.copy(a.center).add(b.center).multiplyScalar(0.5);
  return point.addScaledVector(up, (low+high)/2-point.dot(up));
}

/** 땅 접평면 2D OBB SAT + 높이 겹침. 도로의 경사·뱅크는 평균 up 기준.
 * 반환값은 항상 {hit, depth, normal, point}; 분리 시 normal/point=null.
 * 정확히 닿으면 hit=true, depth=0. depth만큼 a를 normal 쪽으로 밀면 분리.
 * sideHit 판정/질량/마찰/반발/소리는 호출한 쪽의 기존 응답을 그대로 사용.
 * 수직 루프와 다른 층은 높이로 거른다. 공중의 임의 3축 회전용 완전 3D SAT는 아님.
 */
export function obbOverlap(a, b) {
  const ba = basis(a), bb = basis(b);
  const up = ba.up.clone().add(bb.up);
  if (up.lengthSq() < EPS) up.copy(ba.up);
  up.normalize();
  const ra=rectangle(a,up), rb=rectangle(b,up);
  const ya=ra.center.dot(up), yb=rb.center.dot(up);
  const low=Math.max(ya-ra.vertical,yb-rb.vertical), high=Math.min(ya+ra.vertical,yb+rb.vertical);
  const miss=()=>({hit:false,depth:0,normal:null,point:null});
  if (high<low-EPS) return miss();
  const delta=ra.center.clone().sub(rb.center);
  let depth=Infinity, normal=null;
  for (const axis of [ra.right,ra.fwd,rb.right,rb.fwd]) {
    const d=delta.dot(axis), overlap=radius(ra,axis)+radius(rb,axis)-Math.abs(d);
    if (overlap < -EPS) return miss();
    if (overlap < depth) { depth=Math.max(0,overlap); normal=axis.clone().multiplyScalar(d<0?-1:1); }
  }
  return {hit:true,depth,normal,point:contactPoint(ra,rb,up,low,high)};
}
