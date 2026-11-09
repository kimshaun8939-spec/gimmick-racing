// 봇용 빠른 트랙: castRay(땅·벽 찾기 레이)를 삼각형 격자로 빠르게
//
//   트랙의 castRay는 레이 하나마다 땅 메시 전부(그랑프리 925개)를 검사하고, 맞은 메시는 삼각형을 모두 검사함
//   (섬 지형 한 덩어리 948개 등) → 0.1~0.3 ms씩. 봇 7대 × 초당 120번 × 레이 2~3개면 너무 무거움
//   여기서는 시작할 때 모든 땅 삼각형을 세상 좌표로 바꿔 8 m 칸 격자(위에서 본 x·z)에 나눠 두고,
//   레이가 지나가는 칸의 삼각형만 검사함 → 결과는 원래 castRay와 같음 (앞면/뒷면 규칙, 법선 보간까지)
//   트랙 파일은 고치지 않고, 트랙 객체를 감싼 새 객체를 봇 차(Car)에만 넘김
//   움직이는 땅(위치가 바뀌는 메시)이 생기면 그 메시는 원래 방식(Raycaster)으로 검사
import * as THREE from 'three';

const CELL = 8;

export function fastTrack(track) {
  const meshes = track.groundMeshes;
  if (!meshes || !meshes.length) return track;
  const t0 = performance.now();

  // --- 삼각형 모으기 (세상 좌표) ---
  let triCount = 0;
  const usable = [];
  const dynamic = []; // 격자에 못 넣는 것 (인스턴싱 등) → Raycaster
  for (const m of meshes) {
    const g = m.geometry;
    if (!g || !g.attributes.position || m.isInstancedMesh || m.isSkinnedMesh || !g.attributes.normal) {
      dynamic.push(m);
      continue;
    }
    m.updateWorldMatrix(true, false);
    usable.push(m);
    triCount += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  const P = new Float32Array(triCount * 9); // 꼭짓점 a,b,c
  const Nn = new Float32Array(triCount * 9); // 꼭짓점 법선 (세상 좌표)
  const side = new Uint8Array(triCount); // 0 앞면만, 1 뒷면만, 2 양면
  const owner = new Uint16Array(triCount); // 메시 번호
  const ownerMesh = [];
  const savedMatrix = [];
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let k = 0;
  usable.forEach((m, mi) => {
    const g = m.geometry, pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
    const mw = m.matrixWorld;
    nm.getNormalMatrix(mw);
    const flip = mw.determinant() < 0;
    ownerMesh.push(m);
    savedMatrix.push(mw.elements.slice());
    const n = idx ? idx.count : pos.count;
    const matSide = (mat) => (mat ? (mat.side === THREE.DoubleSide ? 2 : mat.side === THREE.BackSide ? 1 : 0) : 0);
    const groups = Array.isArray(m.material) ? g.groups : null;
    for (let i = 0; i < n; i += 3) {
      let s = 0;
      if (groups) {
        const gr = groups.find((q) => i >= q.start && i < q.start + q.count);
        s = gr ? matSide(m.material[gr.materialIndex]) : 2;
      } else s = matSide(m.material);
      const ids = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
      if (flip) [ids[1], ids[2]] = [ids[2], ids[1]];
      for (let c = 0; c < 3; c++) {
        v.fromBufferAttribute(pos, ids[c]).applyMatrix4(mw);
        P[k * 9 + c * 3] = v.x;
        P[k * 9 + c * 3 + 1] = v.y;
        P[k * 9 + c * 3 + 2] = v.z;
        v.fromBufferAttribute(nor, ids[c]).applyMatrix3(nm);
        Nn[k * 9 + c * 3] = v.x;
        Nn[k * 9 + c * 3 + 1] = v.y;
        Nn[k * 9 + c * 3 + 2] = v.z;
      }
      side[k] = s;
      owner[k] = mi;
      k++;
    }
  });

  // --- 격자 (x·z 8 m 칸) ---
  const cells = new Map();
  const hugeOwners = new Set();
  for (let t = 0; t < k; t++) {
    const o = t * 9;
    const minX = Math.min(P[o], P[o + 3], P[o + 6]), maxX = Math.max(P[o], P[o + 3], P[o + 6]);
    const minZ = Math.min(P[o + 2], P[o + 5], P[o + 8]), maxZ = Math.max(P[o + 2], P[o + 5], P[o + 8]);
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL), z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) {
      // 아주 큰 삼각형(바다 판 등)이 있는 메시는 통째로 원래 방식(Raycaster)으로
      if (!hugeOwners.has(owner[t])) hugeOwners.add(owner[t]);
      continue;
    }
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const key = x * 1000003 + z;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(t);
      }
  }
  // 배열로 굳히기 (빠르게)
  for (const [key, list] of cells) cells.set(key, Int32Array.from(list));
  const stamp = new Uint32Array(k);
  let stampN = 0;
  const moved = new Uint8Array(usable.length); // 위치가 바뀐 메시 → 격자 대신 Raycaster
  for (const mi of hugeOwners) {
    moved[mi] = 1;
    dynamic.push(ownerMesh[mi]);
  }
  let checkT = performance.now();
  const buildMs = Math.round(performance.now() - t0);

  let knownCount = meshes.length;
  function checkMoved() {
    let any = false;
    // 나중에 더해진 땅 메시 (맵 소품 등) → 원래 방식으로 검사
    if (meshes.length !== knownCount) {
      for (const m of meshes) if (!ownerMesh.includes(m) && !dynamic.includes(m)) dynamic.push(m);
      knownCount = meshes.length;
    }
    for (let i = 0; i < ownerMesh.length; i++) {
      if (moved[i]) continue;
      const e = ownerMesh[i].matrixWorld.elements, s = savedMatrix[i];
      for (let j = 12; j < 15; j++)
        if (Math.abs(e[j] - s[j]) > 1e-4) {
          moved[i] = 1;
          dynamic.push(ownerMesh[i]);
          any = true;
          break;
        }
    }
    return any;
  }

  const raycaster = new THREE.Raycaster();
  const tri = new THREE.Triangle(), bary = new THREE.Vector3(), local = new THREE.Vector3(), tmp = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();

  /** 원래 방식 (움직이는 메시만) */
  function rayDynamic(origin, dir, far) {
    if (!dynamic.length) return null;
    raycaster.set(origin, dir);
    raycaster.near = 0;
    raycaster.far = far;
    for (const hit of raycaster.intersectObjects(dynamic, false)) {
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

  function castRay(origin, dir, far) {
    // 차를 코스에 놓을 때(높이 30에서 아래로)는 트랙 원래 레이 (고가도로 아래 특별 처리가 있음)
    if (origin.y === 30 && far === 60) return track.castRay(origin, dir, far);
    const now = performance.now();
    if (now - checkT > 2000 || meshes.length !== knownCount) {
      checkT = now;
      checkMoved();
    }
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    const ex = ox + dx * far, ez = oz + dz * far;
    const x0 = Math.floor(Math.min(ox, ex) / CELL), x1 = Math.floor(Math.max(ox, ex) / CELL);
    const z0 = Math.floor(Math.min(oz, ez) / CELL), z1 = Math.floor(Math.max(oz, ez) / CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) return track.castRay(origin, dir, far); // 아주 긴 레이는 원래대로
    stampN++;
    let bestT = far, bestTri = -1;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const list = cells.get(x * 1000003 + z);
        if (!list) continue;
        for (let q = 0; q < list.length; q++) {
          const t = list[q];
          if (stamp[t] === stampN) continue;
          stamp[t] = stampN;
          if (moved[owner[t]]) continue;
          // Möller–Trumbore (three.js Ray.intersectTriangle과 같은 앞면/뒷면 규칙)
          const o = t * 9;
          let ax = P[o], ay = P[o + 1], az = P[o + 2];
          let bx = P[o + 3], by = P[o + 4], bz = P[o + 5];
          let cx = P[o + 6], cy = P[o + 7], cz = P[o + 8];
          const s = side[t];
          if (s === 1) {
            // 뒷면만: 꼭짓점 순서를 뒤집어 앞면 검사
            [ax, ay, az, cx, cy, cz] = [cx, cy, cz, ax, ay, az];
          }
          const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
          const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
          // 법선 = e1 × e2
          const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
          let DdN = dx * nx + dy * ny + dz * nz;
          let sign;
          if (DdN > 0) {
            if (s !== 2) continue; // 뒷면 (컬링)
            sign = 1;
          } else if (DdN < 0) {
            sign = -1;
            DdN = -DdN;
          } else continue;
          const qx = ox - ax, qy = oy - ay, qz = oz - az;
          // DdQxE2 = sign * dir · (Q × E2)
          const qe2x = qy * e2z - qz * e2y, qe2y = qz * e2x - qx * e2z, qe2z = qx * e2y - qy * e2x;
          const DdQxE2 = sign * (dx * qe2x + dy * qe2y + dz * qe2z);
          if (DdQxE2 < 0) continue;
          // DdE1xQ = sign * dir · (E1 × Q)
          const e1qx = e1y * qz - e1z * qy, e1qy = e1z * qx - e1x * qz, e1qz = e1x * qy - e1y * qx;
          const DdE1xQ = sign * (dx * e1qx + dy * e1qy + dz * e1qz);
          if (DdE1xQ < 0 || DdQxE2 + DdE1xQ > DdN) continue;
          const QdN = -sign * (qx * nx + qy * ny + qz * nz);
          if (QdN < 0) continue;
          const tt = QdN / DdN;
          if (tt < 1e-4 || tt > bestT) continue;
          bestT = tt;
          bestTri = t;
        }
      }
    const dyn = rayDynamic(origin, dir, bestT);
    if (dyn) return dyn;
    if (bestTri < 0) return null;
    const o = bestTri * 9;
    const point = new THREE.Vector3(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
    // 맞은 점의 무게중심 좌표로 꼭짓점 법선 섞기 (원래 castRay와 같음)
    tri.a.set(P[o], P[o + 1], P[o + 2]);
    tri.b.set(P[o + 3], P[o + 4], P[o + 5]);
    tri.c.set(P[o + 6], P[o + 7], P[o + 8]);
    tri.getBarycoord(point, bary);
    const wa = bary.x, bu = bary.y, bv = bary.z;
    const n = new THREE.Vector3(Nn[o] * wa + Nn[o + 3] * bu + Nn[o + 6] * bv, Nn[o + 1] * wa + Nn[o + 4] * bu + Nn[o + 7] * bv, Nn[o + 2] * wa + Nn[o + 5] * bu + Nn[o + 8] * bv);
    if (n.lengthSq() < 1e-8) {
      // 면 법선
      const e1 = new THREE.Vector3(P[o + 3] - P[o], P[o + 4] - P[o + 1], P[o + 5] - P[o + 2]);
      const e2 = new THREE.Vector3(P[o + 6] - P[o], P[o + 7] - P[o + 1], P[o + 8] - P[o + 2]);
      n.crossVectors(e1, e2);
    }
    n.normalize();
    if (n.x * dx + n.y * dy + n.z * dz > 0) n.negate();
    return { point, normal: n, surface: ownerMesh[owner[bestTri]].userData.surface, distance: bestT };
  }

  // 나머지(nearest, sampleAt, …)는 원래 트랙 그대로 (프로토타입으로 이어짐)
  const ft = Object.create(track);
  ft.castRay = castRay;
  ft._fast = { buildMs, tris: k, cells: cells.size };
  return ft;
}
