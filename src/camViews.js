// 시점 바꾸기 (2026-11-12, 사용자 요청 "시점 변경 추가해줘")
//   V 키(조작키에서 바꿈, 행동 'camView') · 패드 RS · 터치 👁 버튼 → 기본 → 가까운 추격 → 먼 추격 → 보닛 → 운전석
//   - 추격 3개(기본·가까이·멀리)는 main.js의 추격 카메라 그대로, 거리·높이·보는 곳만 배율(dist)로 바꿈 (부드럽게 바뀜)
//   - 1인칭 2개(보닛·운전석)는 차 모델(root)에 딱 붙은 카메라. 바뀔 때 0.45초 동안 자리를 섞음
//   - 내 차 부품 중 앞을 가리는 것은 숨김: 불러올 때 부품마다 "운전석에서 가리나 / 보닛에서 가리나"를 재서 three.js 레이어(5~8)에 나눠 둠
//     → 카메라 레이어만 바꾸면 됨 (부품의 visible을 건드리지 않음 = staticBatch batchLocal 묶음이 안 풀림, 변신 애니메이션 그대로)
//     · 레이어 5 = 늘 보임 · 6 = 운전석에서 숨김 · 7 = 보닛에서 숨김 · 8 = 둘 다 숨김 (batchLocal은 레이어가 같은 것끼리만 묶음)
//   - 리플레이·그리드 소개·결과 화면·튜토리얼 시범·테스트 카메라(cameraOverride)에서는 늘 '기본' 모습 (레이어 모두 보임)
//   - 설정 camView (settings.js)에 저장
import * as THREE from 'three';

/** 시점 목록 (순서 = V 키 순서)
 *  back·up·look·lookUp: 추격 카메라 거리 배율 / fov: 기본 시야에 더하는 각도 / fovSpeed: 빠를 때 넓어지는 정도 배율
 *  shake: 부딪힘·연석 흔들림 배율 / buzz: 고속 잔떨림 배율 / fp: 1인칭 */
export const CAM_VIEWS = [
  { id: 'chase', name: '기본', icon: '🎥' },
  { id: 'near', name: '가까운 추격', icon: '🎥', back: 0.78, up: 0.9, look: 0.9, lookUp: 0.92, fov: 2 },
  { id: 'far', name: '먼 추격', icon: '🎥', back: 1.6, up: 1.55, look: 1.3, lookUp: 1.2, fov: -5, fovSpeed: 0.9 },
  { id: 'bonnet', name: '보닛', icon: '🏎️', fp: true, fov: -3, fovSpeed: 0.75, shake: 0.45, buzz: 0.7 },
  { id: 'cockpit', name: '운전석', icon: '🧑‍✈️', fp: true, fov: 0, fovSpeed: 0.6, shake: 0.35, buzz: 0.5 },
];
const BY = Object.fromEntries(CAM_VIEWS.map((v) => [v.id, v]));
const LAYER = { all: 5, noCock: 6, noBon: 7, none: 8 };
const CAR_BITS = (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8);
const HIDE = { cockpit: (1 << 6) | (1 << 8), bonnet: (1 << 7) | (1 << 8) };
const COCKPIT_BIT = 1 << 9; // 완전한 좌우 한 쌍의 1인칭 전용 실내
const BLEND = 0.45; // 1인칭 ↔ 추격 섞는 시간 (초)

const smooth = (x) => x * x * (3 - 2 * x);
const smoothK = (x, a, b) => smooth(THREE.MathUtils.clamp((x - a) / (b - a), 0, 1));
const lerp = THREE.MathUtils.lerp;

/** 삼각형 몇 개만 뽑은 새 지오메트리 (색인 있으면 꼭짓점은 같이 쓰고 색인만 새로, 없으면 꼭짓점 복사 = 원래와 같은 방식 → batchLocal이 그대로 묶음) */
function subsetGeo(g, tris) {
  const out = new THREE.BufferGeometry();
  if (g.index) {
    for (const nm in g.attributes) out.setAttribute(nm, g.attributes[nm]);
    const src = g.index.array, arr = new (src.constructor)(tris.length * 3);
    tris.forEach((t, i) => arr.set([src[t * 3], src[t * 3 + 1], src[t * 3 + 2]], i * 3));
    out.setIndex(new THREE.BufferAttribute(arr, 1));
  } else {
    for (const nm in g.attributes) {
      const a = g.attributes[nm], s = a.itemSize, arr = new (a.array.constructor)(tris.length * 3 * s);
      tris.forEach((t, i) => arr.set(a.array.subarray(t * 3 * s, (t * 3 + 3) * s), i * 3 * s));
      out.setAttribute(nm, new THREE.BufferAttribute(arr, s, a.normalized));
    }
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * @param o { camera, model(내 차 모델), car, sun(그림자 빛), cfg: () => CAM (main.js 속도감 카메라 값) }
 */
export function createCamViews(o) {
  const { camera, model, car } = o;
  const eyeC = new THREE.Vector3(0, 1.0, -0.2); // 운전석 눈 (차 기준: x 왼쪽+, y 위, z 앞)
  const eyeB = new THREE.Vector3(0, 0.85, 1.2); // 보닛 카메라
  let bonnetLookDown = 0.7;
  const info = { meshes: 0, hideC: 0, hideB: 0, frontZ: 0, hoodY: 0 };

  // ------------------------------------------------------------------ 불러올 때: 부품 나누기 (batchLocal 전에 불러야 함)
  function tag() {
    const root = model.root;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const A = model.fp && model.fp.A;
    const h = (A && A.helmet) || [0, 0.93, -0.3];
    if (model.fp?.eye) eyeC.copy(model.fp.eye);
    else eyeC.set(h[0], h[1] + 0.1, h[2] + 0.22); // 헬멧 가운데보다 조금 위·앞 (눈)
    const list = [];
    const v = new THREE.Vector3(), m4 = new THREE.Matrix4();
    root.traverse((m) => {
      if (!m.isMesh || !m.geometry || !m.geometry.attributes.position || m.userData.fpInterior) return;
      let vis = true;
      for (let q = m; q && q !== root; q = q.parent) if (!q.visible) vis = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const fx = mats.some((x) => x && x.transparent && (x.blending === THREE.AdditiveBlending || x.opacity < 0.5 || !x.depthWrite));
      m4.multiplyMatrices(inv, m.matrixWorld);
      const pos = m.geometry.attributes.position;
      const box = new THREE.Box3();
      const step = Math.max(1, Math.floor(pos.count / 4000));
      const pts = [];
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m4);
        box.expandByPoint(v);
        pts.push(v.x, v.y, v.z);
      }
      list.push({ m, vis, fx, box, pts });
    });
    // 지붕 있는 차: 눈 앞 대시보드·보닛 끝(카울)이 높으면 눈을 그 위 16 cm로 (낮으면 보닛이 화면 절반을 가림)
    let cowl = -Infinity;
    for (const it of list) {
      if (!it.vis || it.fx) continue;
      const p = it.pts;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (Math.abs(x - eyeC.x) < 0.25 && z > eyeC.z + 0.35 && z < eyeC.z + 0.9 && y < eyeC.y + 0.12 && y > cowl) cowl = y;
      }
    }
    info.cowl = isFinite(cowl) ? +cowl.toFixed(2) : null;
    if (!model.fp?.eye && isFinite(cowl)) eyeC.y = Math.max(eyeC.y, Math.min(cowl + 0.16, h[1] + 0.3));
    // 보닛 카메라 기본 자리: 운전석과 앞끝 사이 가운데쯤, 그 자리 차체 꼭대기 + 22 cm
    // 앞끝은 실제 꼭짓점으로 따로 재야 짧은 밴에 가짜 1.5 m 노즈가 생기지 않음.
    let frontZ = -Infinity;
    for (const it of list) if (it.vis && !it.fx) for (let i = 0; i < it.pts.length; i += 3) if (Math.abs(it.pts[i]) < 1.2 && it.pts[i + 2] > frontZ) frontZ = it.pts[i + 2];
    if (!isFinite(frontZ)) frontZ = eyeC.z + 1.5;
    const noseLength = Math.max(0, frontZ - eyeC.z);
    const shortNose = 1 - smoothK(noseLength, 1.6, 2.3);
    // 긴 차의 기존 자리는 유지. 짧은 차는 실제 앞끝을 써서 지붕/코가 눈앞에 남도록 뒤로.
    const zb = eyeC.z + 0.5 * Math.max(1.5, noseLength);
    let hoodY = -Infinity;
    for (const it of list) {
      if (!it.vis || it.fx) continue;
      const p = it.pts;
      for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]) < 0.5 && Math.abs(p[i + 2] - zb) < 0.4 && p[i + 1] > hoodY) hoodY = p[i + 1];
    }
    if (!isFinite(hoodY)) hoodY = eyeC.y - 0.35;
    eyeB.set(0, hoodY + 0.22, zb);
    if (shortNose > 0) {
      eyeB.z = eyeC.z + 0.5 * noseLength - 0.45 * shortNose;
      eyeB.y += 0.03 * shortNose;
      // 뒤로 옮긴 자리의 지붕·핸들·짐 위로 여유 확보 (차 기준 18 cm 반경, 위로 22 cm).
      // 꼭짓점만 재면 큰 지붕 판의 가운데를 놓칠 수 있으므로 실제 면에 아래로 레이를 쏨.
      const solids = list.filter((it) => it.vis && !it.fx).map((it) => it.m);
      const topY = Math.max(eyeB.y, ...list.filter((it) => it.vis && !it.fx).map((it) => it.box.max.y)) + 1;
      const ray = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0).transformDirection(root.matrixWorld);
      const origin = new THREE.Vector3(), hitLocal = new THREE.Vector3();
      for (const dx of [-0.18, 0, 0.18]) for (const dz of [-0.18, 0, 0.18]) {
        origin.set(eyeB.x + dx, topY, eyeB.z + dz).applyMatrix4(root.matrixWorld);
        ray.set(origin, down);
        const hit = ray.intersectObjects(solids, false)[0];
        if (hit) {
          hitLocal.copy(hit.point).applyMatrix4(inv);
          eyeB.y = Math.max(eyeB.y, hitLocal.y + 0.22);
        }
      }
      // 내려다보는 각도는 최대 약 9도: 짧은 코를 화면 아래에 조금 보이게 하면서 길은 넓게 남김.
      bonnetLookDown = lerp(0.7, 3.1, shortNose);
    }
    info.noseLength = +noseLength.toFixed(2);
    info.shortNose = +shortNose.toFixed(2);
    info.frontZ = +frontZ.toFixed(2);
    info.hoodY = +hoodY.toFixed(2);
    // 삼각형마다: 이 카메라 앞을 가리나 (눈 높이보다 높고 눈보다 앞, 또는 눈 바로 옆)
    //   한 부품 안에서 갈리면(F1 몸통 = 낮은 노즈 + 높은 운전석 테두리) 가리는 삼각형만 떼어 자식 메시로 만들어 다른 레이어에
    const CLASS_LAYER = [LAYER.all, LAYER.noCock, LAYER.noBon, LAYER.none];
    const blocks = (x, y, z, e, top, back, r) => (y > e.y - top && z > e.z - back) || (x - e.x) ** 2 + (y - e.y) ** 2 + (z - e.z) ** 2 < r * r;
    const cockBlock = (x,y,z) => blocks(x,y,z,eyeC,.23,.25,.32) || (z > eyeC.z-.4 && z < eyeC.z+.9 && y > eyeC.y-.47);
    const triClass = (p, a, b, c) => {
      let hc = false, hb = false;
      for (const i of [a, b, c]) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        if (!hc && cockBlock(x,y,z)) hc = true;
        if (!hb && blocks(x, y, z, eyeB, 0.04, 0.1, 0.18)) hb = true;
      }
      return (hc ? 1 : 0) + (hb ? 2 : 0);
    };
    info.split = 0;
    for (const it of list) {
      const m = it.m, g = m.geometry;
      info.meshes++;
      let cls = null;
      if (it.fx) cls = 3;
      else if (Array.isArray(m.material) || (g.groups && g.groups.length) || g.morphAttributes.position || Object.values(g.attributes).some((a) => a.isInterleavedBufferAttribute)) {
        const b = it.box; // 통째로만
        cls = (b.max.y > eyeC.y - 0.1 && b.max.z > eyeC.z - 0.15 ? 1 : 0) + (b.max.y > eyeB.y - 0.04 && b.max.z > eyeB.z - 0.1 ? 2 : 0);
      }
      if (cls != null) {
        m.layers.set(CLASS_LAYER[cls]);
        continue;
      }
      // 모든 꼭짓점 (차 기준)
      m4.multiplyMatrices(inv, m.matrixWorld);
      const pa = g.attributes.position, n = pa.count, P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m4);
        P[i * 3] = v.x, P[i * 3 + 1] = v.y, P[i * 3 + 2] = v.z;
      }
      const idx = g.index, triN = idx ? idx.count / 3 : n / 3;
      const tris = [[], [], [], []];
      for (let t = 0; t < triN; t++) {
        const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        tris[triClass(P, a, b, c)].push(t);
      }
      const used = [0, 1, 2, 3].filter((k) => tris[k].length);
      if (used.length <= 1) {
        m.layers.set(CLASS_LAYER[used[0] || 0]);
        continue;
      }
      // 나누기: 가장 많은 쪽은 원래 메시에 남기고, 나머지는 자식 메시 (부품이 움직여도 같이 움직임)
      const main = used.reduce((x, y) => (tris[y].length > tris[x].length ? y : x));
      for (const k of used) {
        const sub = subsetGeo(g, tris[k]);
        if (k === main) {
          m.geometry = sub;
          m.layers.set(CLASS_LAYER[k]);
        } else {
          const child = new THREE.Mesh(sub, m.material);
          child.castShadow = m.castShadow;
          child.receiveShadow = m.receiveShadow;
          child.renderOrder = m.renderOrder;
          child.layers.set(CLASS_LAYER[k]);
          m.add(child);
        }
      }
      info.split++; // (원래 지오메트리는 다른 부품과 같이 쓸 수 있어 dispose 안 함)
    }
    for (const it of list) {
      const L = it.m.layers.mask;
      if (L & HIDE.cockpit) info.hideC++;
      if (L & HIDE.bonnet) info.hideB++;
    }
    camera.layers.mask = (camera.layers.mask | CAR_BITS) & ~COCKPIT_BIT;
    if (o.sun && o.sun.shadow && o.sun.shadow.camera) o.sun.shadow.camera.layers.mask |= CAR_BITS;
  }

  // ------------------------------------------------------------------ 상태
  let sel = 'chase'; // 고른 시점 (설정)
  let eff = 'chase', prev = 'chase', t = BLEND; // 지금 쓰는 시점 (결과 화면 등에서는 기본), 섞기
  const wheelZ = (model.fp?.A?.wheels || []).map(w => w[1]);
  const carScale = wheelZ.length ? THREE.MathUtils.clamp((Math.max(...wheelZ)-Math.min(...wheelZ))/3.1, .78, 1.14) : 1;
  const dist = { back: carScale, up: Math.sqrt(carScale), look: 1, lookUp: 1 }; // main.js cameraTarget이 곱해 씀
  const out = { fovAdd: 0, fovSpeedK: 1, shakeMul: 1, fpK: 0 };
  const pA = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3() };
  const pB = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3() };
  const _q = new THREE.Quaternion(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _e = new THREE.Vector3();
  let buzzT = 0;

  function setMask(hide) {
    camera.layers.mask = ((camera.layers.mask | CAR_BITS) & ~hide) & ~COCKPIT_BIT;
    if (hide === HIDE.cockpit && eff === 'cockpit') camera.layers.mask |= COCKPIT_BIT;
  }
  /** 1인칭 자세 (차 모델 root에 딱 붙음: 차가 기울고 뱅크하면 같이) */
  function fpPose(id, p) {
    const r = model.root;
    _q.copy(r.quaternion);
    _e.copy(id === 'cockpit' ? eyeC : eyeB);
    if (model.fp && model.fp.body) _e.y += model.fp.body.position.y; // 변신할 때 차체가 들썩이면 같이
    p.pos.copy(_e).applyQuaternion(_q).add(r.position);
    _f.set(0, 0, 1).applyQuaternion(_q);
    _u.set(0, 1, 0).applyQuaternion(_q);
    p.up.copy(_u);
    p.look.copy(p.pos).addScaledVector(_f, 20).addScaledVector(_u, id === 'cockpit' ? -0.9 : -bonnetLookDown);
  }
  function famTarget() {
    return BY[eff].fp ? BY.chase : BY[eff];
  }
  function snapDist() {
    const f = famTarget();
    dist.back = (f.back ?? 1) * carScale;
    dist.up = (f.up ?? 1) * Math.sqrt(carScale);
    dist.look = f.look ?? 1;
    dist.lookUp = f.lookUp ?? 1;
  }

  const api = {
    views: CAM_VIEWS,
    dist,
    out,
    info,
    eyeC,
    eyeB,
    get view() {
      return sel;
    },
    get effective() {
      return eff;
    },
    get firstPerson() {
      return !!BY[eff].fp && t >= BLEND;
    },
    get shakeMul() {
      return out.shakeMul;
    },
    get fovAdd() {
      return out.fovAdd;
    },
    get fovSpeedK() {
      return out.fovSpeedK;
    },
    nameOf: (id) => (BY[id] || BY.chase).name,
    /** 고른 시점 바꾸기 (설정에서) */
    setView(id) {
      sel = BY[id] ? id : 'chase';
    },
    /** 다음 시점 → 그 시점 정보 */
    cycle(dir = 1) {
      const i = CAM_VIEWS.findIndex((v) => v.id === sel);
      sel = CAM_VIEWS[(i + dir + CAM_VIEWS.length) % CAM_VIEWS.length].id;
      return BY[sel];
    },
    /** 섞는 중인 것 없이 바로 (다시 시작·리플레이 끝) */
    snap() {
      prev = eff;
      t = BLEND;
      snapDist();
    },
    /** 리플레이·그리드 소개 등: 기본 모습으로, 내 차 부품 모두 보이게 */
    neutral() {
      eff = prev = 'chase';
      t = BLEND;
      snapDist();
      setMask(0);
      Object.assign(out, { fovAdd: 0, fovSpeedK: 1, shakeMul: 1, fpK: 0 });
    },
    /**
     * 매 프레임 main.js updateCamera 끝에서 (추격 카메라가 camera를 정한 뒤)
     * ctx: { lock: true면 기본 모습(그리드 소개·결과·시범), chaseLook: 추격 카메라가 보는 점 }
     */
    apply(dt, ctx) {
      const want = ctx.lock ? 'chase' : sel;
      if (want !== eff) {
        // 섞는 도중에 또 바뀌면: 지금 더 가까운 쪽에서 출발
        prev = t < BLEND * 0.5 ? prev : eff;
        eff = want;
        t = 0;
      }
      t = Math.min(BLEND, t + dt);
      const e = smooth(t / BLEND);
      const P = BY[prev], C = BY[eff];
      // 추격 거리 배율 (기본·가까이·멀리끼리는 이것만 부드럽게 바뀜)
      const f = famTarget(), k = 1 - Math.exp(-6 * dt);
      dist.back = lerp(dist.back, (f.back ?? 1) * carScale, k);
      dist.up = lerp(dist.up, (f.up ?? 1) * Math.sqrt(carScale), k);
      dist.look = lerp(dist.look, f.look ?? 1, k);
      dist.lookUp = lerp(dist.lookUp, f.lookUp ?? 1, k);
      // 시야·흔들림 값 섞기
      out.fovAdd = lerp(P.fov ?? 0, C.fov ?? 0, e);
      out.fovSpeedK = lerp(P.fovSpeed ?? 1, C.fovSpeed ?? 1, e);
      out.shakeMul = lerp(P.shake ?? 1, C.shake ?? 1, e);
      const fpk = lerp(P.fp ? 1 : 0, C.fp ? 1 : 0, e);
      out.fpK = fpk;
      if (!P.fp && !C.fp) {
        setMask(0);
        return;
      }
      // 1인칭 자세 ↔ 추격 자세 섞기
      const chase = (p) => {
        p.pos.copy(camera.position);
        p.look.copy(ctx.chaseLook || camera.position);
        p.up.copy(camera.up);
      };
      if (P.fp) fpPose(prev, pA);
      else chase(pA);
      if (C.fp) fpPose(eff, pB);
      else chase(pB);
      if (e < 1) {
        pB.pos.lerpVectors(pA.pos, pB.pos, e);
        pB.look.lerpVectors(pA.look, pB.look, e);
        pB.up.lerpVectors(pA.up, pB.up, e).normalize();
        // 추격 ↔ 1인칭: 지붕 위로 살짝 넘어가는 길 (차 몸통을 뚫고 지나가 보이지 않게)
        if (P.fp !== C.fp) pB.pos.addScaledVector(pB.up, 0.9 * Math.sin(Math.PI * e));
      }
      camera.position.copy(pB.pos);
      camera.up.copy(pB.up);
      camera.lookAt(pB.look);
      // 고속 잔떨림 (1인칭은 줄여서)
      const cfg = (o.cfg && o.cfg()) || {};
      const vv = car.grounded ? Math.abs(car.forwardSpeed) : car.vel.length();
      const bk = car.grounded && !car.flying && cfg.buzz > 0 ? smoothK(vv * 3.6, cfg.buzzFromKmh ?? 190, (cfg.topKmh ?? 250) + 20) : 0;
      buzzT += dt;
      if (bk > 0 && fpk > 0) {
        const amp = cfg.buzz * bk * fpk * lerp(P.buzz ?? 1, C.buzz ?? 1, e);
        camera.position.addScaledVector(pB.up, amp * (Math.sin(buzzT * 83) * 0.6 + Math.sin(buzzT * 131 + 1.3) * 0.4));
      }
      // 앞을 가리는 내 차 부품 숨기기: 카메라가 차 안으로 충분히 들어왔을 때만 (밖에서 들어오는 동안은 차가 보임)
      //   보닛 ↔ 운전석: 섞는 동안은 두 시점에서 숨기는 부품을 모두 숨김 (차 안을 지나가므로)
      if (P.fp && C.fp) setMask(e < 1 ? HIDE[prev] | HIDE[eff] : HIDE[eff]);
      else {
        const inFp = (C.fp && e > 0.7) || (P.fp && e < 0.3);
        setMask(inFp ? HIDE[C.fp && e > 0.7 ? eff : prev] : 0);
      }
    },
  };
  tag();
  return api;
}
