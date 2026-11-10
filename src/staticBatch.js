// 가만히 있는 물체 묶어 그리기 (2026-11-10 사용자 요청 "친구가 하니까 렉 걸림, 같은 퀄리티로 사양 낮추기")
//   맵에는 작은 메시(가로등·건물 조각·난간…)가 수천 개라 화면 한 장에 그림 호출이 1000번 가까이 됨 → 느린 컴퓨터에서 렉
//   같은 뿌리(트랙·풍경 그룹) 안에서 같은 재질 + 가까운 곳(칸 CELL m)에 있는 메시들을 하나의 메시로 합침
//   → 모양·색은 그대로, 그림 호출만 크게 줄어듦
//
//   안전장치 (원래 코드가 물체를 나중에 움직이거나 숨겨도 깨지지 않게):
//   - 원래 메시는 부모에서 떼어 둘 뿐 지우지 않음 (충돌 레이·참조는 그대로, 정적이라 matrixWorld도 그대로)
//   - 원래 메시와 그 위 그룹들(뿌리까지)의 위치·회전·크기·재질·모양을 계속 지켜보다가 바뀌면 그 묶음을 바로 풀어 원래대로 돌려놓음
//   - 보이기/숨기기(그랑프리·정글 차원 전환 등): 묶음 안이 모두 같이 바뀌면 묶음이 따라 하고, 따로 바뀌면 묶음을 풂
//   - 투명·여러 재질·이름 붙은·자식 있는·InstancedMesh·onBeforeRender가 있는 메시는 건드리지 않음
//   주소에 ?batch=0 이면 끔 (비교·문제 찾기용), ?batchdebug 면 풀 때 콘솔에 이유
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CELL = 120; // 묶음 칸 크기 (m): 너무 크면 화면 밖 것도 같이 그려짐(컬링 손해), 너무 작으면 묶는 효과가 적음
const BASE_OBR = THREE.Object3D.prototype.onBeforeRender;
const BASE_OAR = THREE.Object3D.prototype.onAfterRender;
const _v = new THREE.Vector3();
const _inv = new THREE.Matrix4();

// 재질 "생김새" 열쇠: 따로 만든 재질이라도 색·거칠기·텍스처 등이 모두 같으면 같은 묶음에 넣음
//   (맵 코드가 물체마다 새 재질을 만드는 곳이 많아 uuid로만 묶으면 효과가 작았음)
//   묶은 뒤 재질 값이 바뀌면(깜빡이는 불 등) 지켜보기에서 알아채고 묶음을 풂
const SKIP = new Set(['uuid', 'name', 'id', 'version', 'userData', 'type', 'isMaterial', 'needsUpdate', 'uniforms', 'defines', 'onBuild', 'onBeforeRender', 'onBeforeCompile', 'customProgramCacheKey']);
const BASE_OBC = THREE.Material.prototype.onBeforeCompile;
export function matSig(m, noColor = false) {
  if (m.onBeforeCompile !== BASE_OBC) return 'custom:' + m.uuid; // 셰이더를 고친 재질은 자기 자신만
  const parts = [m.type];
  for (const k in m) {
    if (k[0] === '_' || SKIP.has(k)) continue;
    if (noColor && (k === 'color' || k === 'vertexColors')) continue;
    const v = m[k];
    if (v === null || v === undefined) parts.push(k + '=-');
    else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') parts.push(k + '=' + v);
    else if (v.isColor) parts.push(k + '=' + v.getHexString());
    else if (v.isTexture) parts.push(k + '=' + v.uuid);
    else if (v.isVector2 || v.isVector3 || v.isEuler) parts.push(k + '=' + v.toArray().join(','));
    else if (typeof v === 'function') continue;
    else if (Array.isArray(v)) parts.push(k + '=[' + v.length + ']' + (v.length ? 'x' + m.uuid : '')); // 잘린 면 등은 같은 재질끼리만
    else return 'obj:' + m.uuid; // 모르는 값이 있으면 자기 자신만
  }
  return parts.join(';');
}

// 색 굽기: 재질 색(color)을 꼭짓점 색으로 옮기면 색만 다른 물체들을 한 메시·한 재질로 그릴 수 있음
//   three.js는 diffuse × 꼭짓점 색 × 텍스처 순서로 곱하므로 결과 색은 똑같음
function canBake(m, geo) {
  if (!m.color || !m.color.isColor || !('vertexColors' in m)) return false;
  const c = geo.attributes.color;
  if (m.vertexColors && (!c || c.itemSize !== 3)) return false;
  return true;
}
const hasTex = (m) => {
  for (const k in m) if (m[k] && m[k].isTexture) return true;
  return false;
};
/** 합칠 때 남길 속성 이름 (텍스처가 없으면 uv는 필요 없음, 색을 구우면 color) */
function keepNames(m, geo, bake) {
  const tex = hasTex(m);
  const out = [];
  for (const n of Object.keys(geo.attributes)) {
    if (n === 'color') continue;
    if (!tex && /^uv\d?$/.test(n)) continue;
    out.push(n);
  }
  if (bake || m.vertexColors) out.push('color');
  return out.sort();
}
function attrKeyNames(geo, names) {
  return `${geo.index ? 'i' : 'n'}|${names.map((n) => (n === 'color' ? 'color:3' : `${n}:${geo.attributes[n].itemSize}:${geo.attributes[n].normalized ? 1 : 0}:${geo.attributes[n].array.constructor.name}`)).join(',')}`;
}

/** 합칠 메시 모양 복사: 필요한 속성만 + (색 굽기면) 꼭짓점 색 = 재질 색 × 원래 꼭짓점 색 */
function bakeGeo(o, names, bake) {
  const src = o.geometry;
  const g = new THREE.BufferGeometry();
  for (const n of names) if (n !== 'color') g.setAttribute(n, src.attributes[n].clone());
  if (src.index) g.setIndex(src.index.clone());
  if (names.includes('color')) {
    const cnt = src.attributes.position.count, col = new Float32Array(cnt * 3);
    const m = o.material, sc = src.attributes.color;
    const r = bake ? m.color.r : 1, gg = bake ? m.color.g : 1, bb = bake ? m.color.b : 1;
    const useSrc = m.vertexColors && sc;
    for (let i = 0; i < cnt; i++) {
      col[i * 3] = (useSrc ? sc.getX(i) : 1) * r;
      col[i * 3 + 1] = (useSrc ? sc.getY(i) : 1) * gg;
      col[i * 3 + 2] = (useSrc ? sc.getZ(i) : 1) * bb;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return g;
}

function attrKey(geo) {
  const names = Object.keys(geo.attributes).sort();
  const parts = names.map((n) => {
    const a = geo.attributes[n];
    return `${n}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`;
  });
  return `${geo.index ? 'i' : 'n'}|${parts.join(',')}`;
}

function eligible(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return false;
  if (o.children.length || o.name) return false;
  if (o.onBeforeRender !== BASE_OBR || o.onAfterRender !== BASE_OAR) return false;
  const mat = o.material;
  if (!mat || Array.isArray(mat) || mat.transparent || mat.isShaderMaterial) return false;
  const geo = o.geometry;
  if (!geo || !geo.attributes.position) return false;
  if (geo.morphAttributes && Object.keys(geo.morphAttributes).length) return false;
  for (const n in geo.attributes) if (geo.attributes[n].isInterleavedBufferAttribute) return false;
  if (geo.drawRange && (geo.drawRange.start !== 0 || geo.drawRange.count !== Infinity)) return false;
  if (o.userData && (o.userData.noBatch || o.userData.dynamic)) return false;
  return true;
}

/** 물체의 지금 모양 기록 (바뀌었는지 비교용) */
function snap(o) {
  return { o, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone(), mtx: o.matrix.clone(), mat: o.material, geo: o.geometry, vis: o.visible, parent: o.parent };
}

/**
 * roots 아래의 정적 메시를 묶음. 반환: { update(), stats, undoAll() }
 * @param roots 묶을 물체들의 뿌리 (트랙·풍경). 물리 소품(props)·차는 넣지 말 것
 */
export function batchStatic(roots, opts = {}) {
  const t0 = performance.now();
  const minCount = opts.minCount || 2;
  const batches = []; // { merged, root, items: [{ o, parent, index }], chain: Set(조상 그룹), undone }
  const watch = new Map(); // 지켜볼 물체 → { s: snap, batches: Set }
  const watchOf = (o) => {
    let w = watch.get(o);
    if (!w) watch.set(o, (w = { s: snap(o), batches: new Set() }));
    return w;
  };
  let before = 0, after = 0;
  const sigCache = new Map(); // 재질 → 생김새 열쇠
  const bakeInfo = new Map(); // 메시 → { bake, names }
  const bakedMats = new Map(); // 색 뺀 열쇠 → 꼭짓점 색을 쓰는 공용 재질
  const matUse = new Map(); // 원래 재질 → { sig, batches: Set } (값이 바뀌면 풂)
  for (const root of roots) {
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    // 1) 후보 모으기 (열쇠: 재질·속성·그림자·보이기·차원 표시·칸)
    const groups = new Map();
    root.traverse((o) => {
      if (o === root || !eligible(o)) return;
      // 위쪽 그룹들 (뿌리 바로 아래까지): 보이기·차원 표시 확인
      let vis = true, world = '';
      for (let p = o; p && p !== root; p = p.parent) {
        if (!p.visible) vis = false;
        if (!world && p.userData && p.userData.world) world = p.userData.world;
        if (p !== o && (p.onBeforeRender !== BASE_OBR || (p.userData && (p.userData.noBatch || p.userData.dynamic)))) return;
      }
      const geo = o.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if (o.matrixWorld.determinant() < 0) return; // 뒤집힌 메시 (합치면 면이 뒤집힘)
      _v.copy(geo.boundingSphere.center).applyMatrix4(o.matrixWorld);
      const cs = opts.cellFor ? opts.cellFor(_v) : CELL; // 코스에서 먼 것(하늘 섬 등)은 큰 칸
      const cell = `${cs}:${Math.floor(_v.x / cs)},${Math.floor(_v.z / cs)}`;
      let sig = sigCache.get(o.material);
      if (sig === undefined) sigCache.set(o.material, (sig = matSig(o.material)));
      const bake = canBake(o.material, geo);
      const names = keepNames(o.material, geo, bake);
      bakeInfo.set(o, { bake, names });
      const key = [bake ? 'bake:' + matSig(o.material, true) : sig, attrKeyNames(geo, names), o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.renderOrder, o.frustumCulled ? 1 : 0, vis ? 1 : 0, world, o.layers.mask, cell].join('|');
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(o);
    });
    // 2) 묶기
    for (const list of groups.values()) {
      if (list.length < minCount) continue;
      const geos = [];
      const rel = new THREE.Matrix4();
      const bake = bakeInfo.get(list[0]).bake;
      for (const o of list) {
        const g = bakeGeo(o, bakeInfo.get(o).names, bake);
        rel.multiplyMatrices(_inv, o.matrixWorld); // 뿌리 기준 위치로 굽기
        g.applyMatrix4(rel);
        geos.push(g);
      }
      let geo = null;
      try {
        geo = mergeGeometries(geos, false);
      } catch {
        geo = null;
      }
      for (const g of geos) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const f = list[0];
      let mat = f.material;
      if (bake) {
        const mk = matSig(f.material, true);
        mat = bakedMats.get(mk);
        if (!mat) {
          mat = f.material.clone();
          mat.color.setRGB(1, 1, 1);
          mat.vertexColors = true;
          bakedMats.set(mk, mat);
        }
      }
      const merged = new THREE.Mesh(geo, mat);
      merged.castShadow = f.castShadow;
      merged.receiveShadow = f.receiveShadow;
      merged.renderOrder = f.renderOrder;
      merged.frustumCulled = f.frustumCulled;
      merged.layers.mask = f.layers.mask;
      merged.userData = { batched: true };
      merged.matrixAutoUpdate = false;
      merged.updateMatrix();
      const b = { merged, root, items: [], chain: new Set(), undone: false, visKey: null };
      for (const o of list) {
        b.items.push({ o, parent: o.parent });
        let mu = matUse.get(o.material);
        if (!mu) matUse.set(o.material, (mu = { m: o.material, sig: sigCache.get(o.material), batches: new Set() }));
        mu.batches.add(b);
        watchOf(o).item = b; // 이 메시는 묶음 안에 있음 (떼어 둔 동안 부모가 없어야 정상)
        for (let p = o; p && p !== root; p = p.parent) {
          b.chain.add(p);
          watchOf(p).batches.add(b);
        }
      }
      for (const o of list) o.parent.remove(o);
      root.add(merged);
      b.merged.visible = effVisible(b.items[0].o, b.items[0].parent, root);
      batches.push(b);
      before += list.length;
      after += 1;
    }
  }
  /** 뿌리 바로 아래까지 모두 보이는지 (떼어 둔 메시는 원래 부모부터 따라 올라감) */
  function effVisible(o, parent, root) {
    if (!o.visible) return false;
    for (let p = parent; p && p !== root; p = p.parent) if (!p.visible) return false;
    return true;
  }
  const watchList = [...watch.values()];
  const matList = [...matUse.values()];
  const stats = { batches: batches.length, meshesBefore: before, meshesAfter: after, watched: watchList.length, materials: matList.length, ms: Math.round(performance.now() - t0), undone: 0 };

  function undo(b, why) {
    if (b.undone) return;
    b.undone = true;
    b.root.remove(b.merged);
    b.merged.geometry.dispose();
    for (const it of b.items) if (!it.o.parent && it.parent) it.parent.add(it.o);
    stats.undone++;
    if (opts.debug) console.log('[batch] 풀기', why, b.items.length, b.merged.material && b.merged.material.name);
  }

  // 3) 지켜보기: 보이기 상태는 매 프레임, 위치·재질은 한 프레임에 조금씩 나눠서
  let cursor = 0;
  const localized = new Set();
  let update = function () {
    // 보이기: 지켜보는 물체의 visible이 바뀌었으면 그 묶음들 다시 확인
    let dirty = null;
    for (const w of watchList) {
      if (w.s.o.visible !== w.s.vis) {
        w.s.vis = w.s.o.visible;
        for (const b of w.batches) (dirty || (dirty = new Set())).add(b);
      }
    }
    if (dirty) {
      for (const b of dirty) {
        if (b.undone) continue;
        const v0 = effVisible(b.items[0].o, b.items[0].parent, b.root);
        let same = true;
        for (const it of b.items) if (effVisible(it.o, it.parent, b.root) !== v0) { same = false; break; }
        if (same) b.merged.visible = v0;
        else undo(b, 'visible');
      }
    }
    // 위치·회전·크기·재질·모양·부모
    let budget = Math.min(watchList.length, 300);
    while (budget-- > 0) {
      cursor = (cursor + 1) % watchList.length;
      const w = watchList[cursor];
      if (!w.batches.size) continue;
      const s = w.s;
      // 떼어 둔 메시는 부모가 없어야 정상 (누가 다시 붙였으면 바뀐 것)
      const parentChanged = w.item && !w.item.undone ? s.o.parent !== null : s.o.parent !== s.parent;
      if (parentChanged || !s.o.position.equals(s.pos) || !s.o.quaternion.equals(s.quat) || !s.o.scale.equals(s.scale) || (!s.o.matrixAutoUpdate && !s.o.matrix.equals(s.mtx)) || s.o.material !== s.mat || s.o.geometry !== s.geo) {
        for (const b of w.batches) undo(b, 'changed');
        w.batches.clear();
        // 움직이는 그룹(풍차 날개·비행선 등)이면 그 안에서만 다시 묶음 (그룹과 같이 움직이게)
        if (!w.item && !s.o.isMesh && !localized.has(s.o)) {
          localized.add(s.o);
          const ls = batchLocal(s.o);
          stats.local = (stats.local || 0) + ls.batches;
        }
      }
    }
  }
  // 재질 값: 한 프레임에 8개씩 다시 재 봄 (같은 묶음에 여러 재질이 섞여 있으니 하나라도 바뀌면 풂)
  let mcur = 0;
  const _upd = update;
  update = function () {
    _upd();
    for (let n = Math.min(8, matList.length); n > 0; n--) {
      mcur = (mcur + 1) % matList.length;
      const mu = matList[mcur];
      if (!mu.batches.size) continue;
      if (matSig(mu.m) !== mu.sig) {
        for (const b of mu.batches) undo(b, 'material');
        mu.batches.clear();
      }
    }
  };
  // 4) 맵 전체에 퍼진 큰 InstancedMesh(나무·바위·구름 등)를 칸별로 나눔
  //   한 덩어리면 화면 밖·그림자 밖 것까지 매번 모두 그림 (그랑프리 출발선에서 약 110만 삼각형) → 칸으로 나누면 보이는 칸만
  const splits = opts.splitInstances === false ? [] : splitInstanced(roots, stats);
  const _upd2 = update;
  let scur = 0;
  update = function () {
    _upd2();
    for (const sp of splits) {
      if (sp.undone) continue;
      const o = sp.o;
      if (o.visible !== sp.vis) {
        sp.vis = o.visible;
        for (const c of sp.chunks) c.visible = o.visible;
      }
    }
    // 원래 InstancedMesh가 바뀌면(나무 흔들기·개수 바꾸기 등) 원래대로
    for (let n = Math.min(4, splits.length); n > 0; n--) {
      scur = (scur + 1) % splits.length;
      const sp = splits[scur];
      if (sp.undone) continue;
      const o = sp.o;
      if (o.parent || o.count !== sp.count || o.instanceMatrix.version !== sp.mv || (o.instanceColor && o.instanceColor.version !== sp.cv) || o.material !== sp.mat || o.geometry !== sp.geo || !o.position.equals(sp.pos) || !o.quaternion.equals(sp.quat) || !o.scale.equals(sp.scale)) {
        undoSplit(sp, opts.debug);
        stats.undone++;
      }
    }
  };
  function undoAll() {
    for (const b of batches) undo(b, 'all');
    for (const sp of splits) undoSplit(sp);
  }
  return { update, stats, undoAll, batches, splits };
}

let SPLIT_CELL = 400; // InstancedMesh 나누는 칸 (m)
const _sc = typeof location !== 'undefined' && /[?&]splitcell=(\d+)/.exec(location.search);
if (_sc) SPLIT_CELL = +_sc[1];
const _mi = new THREE.Matrix4();
const _p = new THREE.Vector3();
function splitInstanced(roots, stats) {
  const out = [];
  stats.split = 0;
  stats.chunks = 0;
  const list = [];
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isInstancedMesh || !o.parent || !o.frustumCulled || o.count < 24 || o.children.length) return;
      if (o.onBeforeRender !== BASE_OBR || o.morphTexture) return;
      if (o.userData && (o.userData.noBatch || o.userData.dynamic)) return;
      if (!o.boundingSphere) o.computeBoundingSphere();
      const ws = o.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
      if (ws < SPLIT_CELL * 1.2) return; // 이미 작으면 그대로
      list.push(o);
    });
  }
  for (const o of list) {
    // 인스턴스마다 월드 위치 → 칸
    const cells = new Map();
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, _mi);
      _p.setFromMatrixPosition(_mi).applyMatrix4(o.matrixWorld);
      const key = `${Math.floor(_p.x / SPLIT_CELL)},${Math.floor(_p.z / SPLIT_CELL)}`;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = []));
      c.push(i);
    }
    if (cells.size < 2) continue;
    const chunks = [];
    for (const idx of cells.values()) {
      const c = new THREE.InstancedMesh(o.geometry, o.material, idx.length);
      for (let k = 0; k < idx.length; k++) {
        o.getMatrixAt(idx[k], _mi);
        c.setMatrixAt(k, _mi);
        if (o.instanceColor) {
          if (!c.instanceColor) c.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(idx.length * 3), 3);
          c.instanceColor.setXYZ(k, o.instanceColor.getX(idx[k]), o.instanceColor.getY(idx[k]), o.instanceColor.getZ(idx[k]));
        }
      }
      Object.assign(c, { castShadow: o.castShadow, receiveShadow: o.receiveShadow, renderOrder: o.renderOrder, frustumCulled: true, visible: o.visible });
      c.layers.mask = o.layers.mask;
      if (o.customDepthMaterial) c.customDepthMaterial = o.customDepthMaterial;
      if (o.customDistanceMaterial) c.customDistanceMaterial = o.customDistanceMaterial;
      c.position.copy(o.position);
      c.quaternion.copy(o.quaternion);
      c.scale.copy(o.scale);
      c.updateMatrix();
      c.matrixAutoUpdate = false;
      c.userData = { batched: true, splitOf: o };
      c.computeBoundingSphere();
      chunks.push(c);
    }
    const parent = o.parent;
    parent.remove(o);
    for (const c of chunks) parent.add(c);
    out.push({ o, parent, chunks, undone: false, count: o.count, mv: o.instanceMatrix.version, cv: o.instanceColor ? o.instanceColor.version : 0, mat: o.material, geo: o.geometry, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone(), vis: o.visible });
    stats.split++;
    stats.chunks += chunks.length;
  }
  return out;
}
function undoSplit(sp, debug) {
  if (sp.undone) return;
  sp.undone = true;
  for (const c of sp.chunks) {
    sp.parent.remove(c);
    c.dispose();
  }
  if (!sp.o.parent) sp.parent.add(sp.o);
  if (debug) console.log('[batch] 나눈 InstancedMesh 원래대로', sp.count);
}

/**
 * 차 모델처럼 부분부분 움직이는 물체용: 같은 부모(그룹) 안의 형제 메시끼리만 묶음
 *   - 부모 그룹이 움직이거나 기울어도(차체 롤·바퀴 회전) 묶음이 같이 따라감
 *   - 따로 update()를 부를 필요 없음: 묶은 메시가 그려질 때마다(onBeforeRender) 스스로 원래 메시들을 확인
 *     위치·재질·모양이 바뀌면 다음 화면부터 원래대로 풀고, 보이기는 모두 같이 바뀌면 따라 함
 * @returns { batches, meshesBefore, meshesAfter }
 */
export function batchLocal(root) {
  const byParent = new Map();
  root.traverse((o) => {
    if (o === root || !eligible(o) || !o.parent) return;
    let m = byParent.get(o.parent);
    if (!m) byParent.set(o.parent, (m = []));
    m.push(o);
  });
  const stats = { batches: 0, meshesBefore: 0, meshesAfter: 0 };
  const bakedMats = new Map();
  for (const [parent, meshes] of byParent) {
    const groups = new Map();
    for (const o of meshes) {
      if (o.matrixAutoUpdate) o.updateMatrix();
      if (o.matrix.determinant() < 0) continue;
      const geo = o.geometry;
      const bake = canBake(o.material, geo);
      const names = keepNames(o.material, geo, bake);
      const key = [bake ? 'bake:' + matSig(o.material, true) : matSig(o.material), attrKeyNames(geo, names), o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.renderOrder, o.visible ? 1 : 0, o.layers.mask].join('|');
      let l = groups.get(key);
      if (!l) groups.set(key, (l = { bake, list: [] }));
      l.list.push({ o, names });
    }
    for (const { bake, list } of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map(({ o, names }) => {
        const g = bakeGeo(o, names, bake);
        g.applyMatrix4(o.matrix);
        return g;
      });
      let geo = null;
      try {
        geo = mergeGeometries(geos, false);
      } catch {
        geo = null;
      }
      for (const g of geos) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const f = list[0].o;
      let mat = f.material;
      if (bake) {
        const mk = matSig(f.material, true);
        mat = bakedMats.get(mk);
        if (!mat) {
          mat = f.material.clone();
          mat.color.setRGB(1, 1, 1);
          mat.vertexColors = true;
          bakedMats.set(mk, mat);
        }
      }
      const merged = new THREE.Mesh(geo, mat);
      Object.assign(merged, { castShadow: f.castShadow, receiveShadow: f.receiveShadow, renderOrder: f.renderOrder, frustumCulled: f.frustumCulled });
      merged.layers.mask = f.layers.mask;
      merged.userData = { batched: true };
      const items = list.map(({ o }) => ({ o, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone(), mat: o.material, geo: o.geometry, sig: matSig(o.material) }));
      for (const it of items) parent.remove(it.o);
      parent.add(merged);
      let undone = false, k = 0;
      const undo = () => {
        if (undone) return;
        undone = true;
        parent.remove(merged);
        geo.dispose();
        for (const it of items) if (!it.o.parent) parent.add(it.o);
      };
      merged.onBeforeRender = () => {
        if (undone) return;
        const v0 = items[0].o.visible;
        for (const it of items) {
          const o = it.o;
          if (o.parent || o.visible !== v0 || !o.position.equals(it.pos) || !o.quaternion.equals(it.quat) || !o.scale.equals(it.scale) || o.material !== it.mat || o.geometry !== it.geo) return undo();
        }
        geo.setDrawRange(0, v0 ? Infinity : 0);
        // 재질 값은 한 번에 하나씩 (깜빡이는 불 등)
        k = (k + 1) % items.length;
        if (matSig(items[k].mat) !== items[k].sig) undo();
      };
      merged.userData.undo = undo;
      stats.batches++;
      stats.meshesBefore += list.length;
      stats.meshesAfter++;
    }
  }
  return stats;
}
