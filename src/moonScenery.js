// 달 중력 기지 풍경 (moonMap.js의 buildScenery)
//   - 검은 하늘: 별 두 겹 + 은하수 띠 + 지구(구름이 천천히 돎) + 해 — 하늘 묶음은 차를 따라다님 (카메라 끝 3000 m 안에 늘 있게)
//   - 먼 지평선: 지형 끝을 가리는 산등성이 고리 + 그 아래 넓은 바닥판 (부딪히지 않음, 멀어서 못 감)
//   - 바위(인스턴스), 달 기지: 관제동(피트), 돔, 거주 모듈과 연결 통로, 태양광 패널 밭, 착륙장과 착륙선, 로켓 발사대, 레이더, 안테나, 천문대, 탐사차(움직임)
//   - 출발 게이트: 빨간불 5개가 운전자 기준 왼쪽부터 켜짐 (window.game.race.lights)
//   - 중력 구역 문: 저중력(하늘색)/고중력(주황) 반원 고리 + 홀로그램 글자, 중력 루프 입구 보라 문, 점프 경고등
//   - 충돌: gpScenery와 같은 원기둥 충돌체 격자 (collideCar, addCollider)
import * as THREE from 'three';
import { canvasTexture, seededRandom, makeNoise } from './moonTrack.js';
import { rocketPad, observatory, radarDish, antennaMast } from './gpSpace.js';

const TAU = Math.PI * 2;
const CAR_R = 1.3; // 차 충돌 반지름
const CELL = 24; // 충돌체 격자 크기
const UP = new THREE.Vector3(0, 1, 0);

export function buildMoonScenery(track, scene) {
  const t0 = performance.now();
  const rand = seededRandom(7310);
  const noise = makeNoise(4242);
  const W = track.width, HW = W / 2, CURB = track.curb || 1.6;
  const group = new THREE.Group();
  group.name = 'moonScenery';
  scene.add(group);
  const animators = []; // (time, dt, car) => void
  const extraStats = {};
  const tmpV = new THREE.Vector3();

  // ---------------------------------------------------------------- 빛: 공기가 없어 그림자가 진하고 햇빛은 하얗게
  scene.background = new THREE.Color('#010207');
  scene.fog = new THREE.Fog('#03040a', 700, 2900);
  scene.traverse((o) => {
    if (o.isHemisphereLight) {
      o.color.set('#aeb8d6');
      o.groundColor.set('#202127');
      o.intensity = 0.62;
    } else if (o.isDirectionalLight) {
      o.color.set('#ffffff');
      o.intensity = 3.1;
    }
  });

  // ---------------------------------------------------------------- 충돌체 (원기둥: x, z, 반지름, 아래 y0, 위 y1)
  const grid = new Map();
  let stamp = 0;
  const allColliders = [];
  function addCollider(c) {
    c.stamp = 0;
    allColliders.push(c);
    for (let cx = Math.floor((c.x - c.r) / CELL); cx <= Math.floor((c.x + c.r) / CELL); cx++)
      for (let cz = Math.floor((c.z - c.r) / CELL); cz <= Math.floor((c.z + c.r) / CELL); cz++) {
        const k = `${cx},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
  }
  const circle = (x, z, r, y0, y1) => addCollider({ x, z, r, y0, y1 });

  // ---------------------------------------------------------------- 자리 도우미
  const roadDist = (x, z) => track.nearestRaw(tmpV.set(x, 0, z));
  const ground = (x, z) => track.heightAt(x, z);
  const occupied = [];
  const free = (x, z, r) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
  const occupy = (x, z, r) => occupied.push({ x, z, r });
  /** 도로에서 clear m 이상, 다른 건물과 안 겹치는 곳이면 true (그리고 자리 차지) */
  function claim(x, z, r, clear = 12) {
    if (roadDist(x, z) < HW + CURB + clear + r) return false;
    if (!free(x, z, r)) return false;
    occupy(x, z, r);
    return true;
  }
  /** 물체를 땅 위에 놓기 (y는 둘레 몇 군데 중 가장 낮은 땅) */
  function place(obj, x, z, rotY = 0, r = 0, sink = 0.2) {
    let y = ground(x, z);
    if (r > 0) for (let k = 0; k < 6; k++) y = Math.min(y, ground(x + Math.cos((k / 6) * TAU) * r, z + Math.sin((k / 6) * TAU) * r));
    obj.position.set(x, y - sink, z);
    obj.rotation.y = rotY;
    group.add(obj);
    return y;
  }
  const s0 = track.sampleAt(0);
  const yawOf = (s) => Math.atan2(s.tan.x, s.tan.z);
  // 코스 가운데·크기
  const box = new THREE.Box3();
  for (let i = 0; i < track.samples.length; i += 8) box.expandByPoint(track.samples[i].pos);
  const center = box.getCenter(new THREE.Vector3());
  const tb = track.terrainBox; // 지형 격자 범위 (Box2)

  // ---------------------------------------------------------------- 공용 재질
  const M = {
    white: new THREE.MeshStandardMaterial({ color: '#eef0f4', roughness: 0.5, metalness: 0.25 }),
    panel: new THREE.MeshStandardMaterial({ color: '#d9dce3', roughness: 0.55, metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2d3139', roughness: 0.6, metalness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: '#b9bec8', roughness: 0.45, metalness: 0.3 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d9a93a', roughness: 0.3, metalness: 0.9 }),
    orange: new THREE.MeshStandardMaterial({ color: '#ff7a1f', roughness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: '#8fd8ff', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.35, depthWrite: false }),
    cyanGlow: new THREE.MeshBasicMaterial({ color: '#5ff0ff', toneMapped: false }),
    orangeGlow: new THREE.MeshBasicMaterial({ color: '#ff8a2a', toneMapped: false }),
    purpleGlow: new THREE.MeshBasicMaterial({ color: '#c08cff', toneMapped: false }),
    whiteGlow: new THREE.MeshBasicMaterial({ color: '#fff6e0', toneMapped: false }),
    redGlow: new THREE.MeshBasicMaterial({ color: '#ff3b30', toneMapped: false }),
  };
  // 창문 줄무늬 (밤처럼 노랗게 켜진 창)
  const windowTex = canvasTexture(256, 64, (c, w, h) => {
    c.fillStyle = '#dfe3ea';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1b2230';
    c.fillRect(0, 20, w, 24);
    for (let x = 6; x < w; x += 22) {
      c.fillStyle = Math.random() < 0.75 ? '#ffd98a' : '#3a4a66';
      c.fillRect(x, 24, 14, 16);
    }
    c.fillStyle = '#ff7a1f';
    c.fillRect(0, 54, w, 4);
  });
  const windowMat = new THREE.MeshStandardMaterial({ map: windowTex, emissive: '#ffffff', emissiveMap: windowTex, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.3 });
  // 육각 판 무늬 돔
  const hexTex = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#e8ebf1';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9aa3b2';
    c.lineWidth = 3;
    const r = 18;
    for (let row = -1; row < 10; row++)
      for (let col = -1; col < 9; col++) {
        const cx = col * r * 1.75 + (row % 2) * r * 0.875, cy = row * r * 1.5;
        c.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU + Math.PI / 6;
          c[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        c.closePath();
        c.stroke();
        if (Math.random() < 0.12) {
          c.fillStyle = 'rgba(120,200,255,0.55)';
          c.fill();
        }
      }
  });
  hexTex.repeat.set(4, 2);
  const domeMat = new THREE.MeshStandardMaterial({ map: hexTex, roughness: 0.35, metalness: 0.35 });
  /** 글자 판 텍스처 */
  function textTex(lines, { w = 512, h = 128, bg = 'rgba(8,14,30,0.82)', fg = '#ffffff', accent = '#5ff0ff', border = true } = {}) {
    return canvasTexture(w, h, (c) => {
      c.clearRect(0, 0, w, h);
      if (bg) {
        c.fillStyle = bg;
        c.fillRect(0, 0, w, h);
      }
      if (border) {
        c.strokeStyle = accent;
        c.lineWidth = 6;
        c.strokeRect(5, 5, w - 10, h - 10);
      }
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const n = lines.length;
      lines.forEach((ln, k) => {
        const big = k === 0;
        c.font = `${big ? 'bold ' : ''}${Math.round((h / (n + 0.6)) * (big ? 0.78 : 0.55))}px "Segoe UI", "Malgun Gothic", sans-serif`;
        c.fillStyle = big ? fg : accent;
        c.fillText(ln, w / 2, (h / (n + 0.6)) * (k + 0.8));
      });
    }, false);
  }

  // ---------------------------------------------------------------- 하늘 (차를 따라다님)
  const sky = new THREE.Group();
  sky.name = 'moonSky';
  scene.add(sky);
  {
    // 별 두 겹 + 은하수
    const mk = (n, size, fn, opacity = 1) => {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const v = fn(i);
        pos.set([v.x, v.y, v.z], i * 3);
        const tint = rand();
        c.setHSL(tint < 0.2 ? 0.08 : tint < 0.45 ? 0.6 : 0.62, tint < 0.45 ? 0.6 : 0.1, 0.65 + rand() * 0.35);
        col.set([c.r, c.g, c.b], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, fog: false, transparent: opacity < 1, opacity, depthWrite: false }));
      pts.frustumCulled = false;
      pts.renderOrder = -10;
      sky.add(pts);
      return pts;
    };
    const onSphere = (R) => {
      const u = rand() * 2 - 1, a = rand() * TAU;
      const r = Math.sqrt(1 - u * u);
      return new THREE.Vector3(r * Math.cos(a) * R, (u * 0.85 + 0.12) * R, r * Math.sin(a) * R);
    };
    mk(3200, 1.4, () => onSphere(2300), 0.9);
    mk(380, 2.6, () => onSphere(2280));
    // 은하수: 기울어진 큰 원 둘레에 몰린 흐린 점
    const axis = new THREE.Vector3(0.35, 0.6, 0.72).normalize();
    const e1 = new THREE.Vector3().crossVectors(axis, UP).normalize(), e2 = new THREE.Vector3().crossVectors(axis, e1);
    mk(5200, 1.2, () => {
      const a = rand() * TAU, spread = (rand() + rand() + rand() - 1.5) * 0.16;
      return e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a)).addScaledVector(axis, spread).normalize().multiplyScalar(2260);
    }, 0.55);

    // 지구: 바다·대륙·구름 (캔버스로 그림), 해 쪽이 밝게 (조명 받음)
    const eTex = canvasTexture(512, 256, (c, w, h) => {
      const img = c.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const lon = (x / w) * TAU, lat = (y / h - 0.5) * Math.PI;
          const px = Math.cos(lat) * Math.cos(lon), pz = Math.cos(lat) * Math.sin(lon), py = Math.sin(lat);
          const n = noise(px * 2.2 + 10, pz * 2.2 + py * 1.7, 4) + 0.25 * noise(px * 6 + 3, pz * 6 - py * 5, 2);
          const polar = Math.abs(py) > 0.86;
          let r, g, b;
          if (polar) (r = 235), (g = 240), (b = 248);
          else if (n > 0.12) {
            const dry = noise(px * 4 - 7, pz * 4 + py * 3, 2) > 0.05 && Math.abs(py) < 0.5;
            if (dry) (r = 176), (g = 150), (b = 98);
            else (r = 70 + n * 60), (g = 118 + n * 50), (b = 62);
          } else {
            const d = Math.max(0, 0.12 - n);
            (r = 18), (g = 70 - d * 60), (b = 150 - d * 70);
          }
          const o = (y * w + x) * 4;
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      c.putImageData(img, 0, 0);
    }, false);
    const cTex = canvasTexture(256, 128, (c, w, h) => {
      const img = c.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const lon = (x / w) * TAU, lat = (y / h - 0.5) * Math.PI;
          const px = Math.cos(lat) * Math.cos(lon), pz = Math.cos(lat) * Math.sin(lon), py = Math.sin(lat);
          const n = noise(px * 3 + 40, pz * 3 + py * 4, 4);
          const a = Math.max(0, Math.min(1, (n - 0.02) * 3.2));
          const o = (y * w + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
          img.data[o + 3] = a * 230;
        }
      c.putImageData(img, 0, 0);
    }, false);
    const earth = new THREE.Group();
    const ER = 230;
    const eMesh = new THREE.Mesh(new THREE.SphereGeometry(ER, 48, 32), new THREE.MeshStandardMaterial({ map: eTex, roughness: 0.75, metalness: 0, fog: false, emissive: '#0a1530', emissiveIntensity: 0.25 }));
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(ER * 1.015, 48, 32), new THREE.MeshStandardMaterial({ map: cTex, transparent: true, depthWrite: false, roughness: 0.9, fog: false }));
    const glowTex = canvasTexture(256, 256, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, w * 0.28, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(120,190,255,0.75)');
      g.addColorStop(0.25, 'rgba(90,160,255,0.28)');
      g.addColorStop(1, 'rgba(60,120,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }, false);
    const atm = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    atm.scale.setScalar(ER * 2.75);
    earth.add(atm, eMesh, clouds);
    eMesh.rotation.z = 0.41;
    clouds.rotation.z = 0.41;
    // 출발 직선에서 보이는 쪽 하늘 (진행 방향 앞, 조금 위)
    const eDir = new THREE.Vector3(s0.tan.x, 0, s0.tan.z).normalize().multiplyScalar(0.86).add(new THREE.Vector3(0, 0.3, 0)).addScaledVector(s0.right, -0.42).normalize();
    earth.position.copy(eDir).multiplyScalar(1850);
    earth.traverse((o) => (o.renderOrder = -9));
    sky.add(earth);
    animators.push((t) => {
      eMesh.rotation.y = t * 0.012;
      clouds.rotation.y = t * 0.017;
    });
    // 해: 빛 방향(main.js SUN_OFFSET 60,110,40) 쪽 하늘에 밝은 원 + 퍼지는 빛
    const sunTex = canvasTexture(256, 256, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.08, 'rgba(255,255,250,1)');
      g.addColorStop(0.18, 'rgba(255,240,210,0.45)');
      g.addColorStop(0.5, 'rgba(255,220,170,0.08)');
      g.addColorStop(1, 'rgba(255,200,150,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }, false);
    const sunS = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    sunS.scale.setScalar(520);
    sunS.position.set(60, 110, 40).normalize().multiplyScalar(2100);
    sky.add(sunS);
  }

  // ---------------------------------------------------------------- 먼 지평선: 산등성이 고리 + 바닥판
  {
    const R = Math.max(tb.max.x - center.x, center.x - tb.min.x, tb.max.y - center.z, center.z - tb.min.y) * 1.08 + 120;
    const N = 220;
    // 지형 격자 바깥 빈 곳을 메우는 넓은 바닥 높이 (지형보다 조금 낮게)
    let minY = Infinity;
    for (let k = 0; k < 40; k++) minY = Math.min(minY, ground(tb.min.x + rand() * (tb.max.x - tb.min.x), tb.min.y + rand() * (tb.max.y - tb.min.y)));
    const floorY = Math.max(-12, minY) - 6;
    const baseY = floorY - 1;
    const pos = [], col = [];
    const ca = new THREE.Color('#5d5c5a'), cb = new THREE.Color('#8e8c87');
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * TAU;
      const h = 30 + 70 * Math.max(0, noise(Math.cos(a) * 3 + 5, Math.sin(a) * 3, 3) + 0.35) + 26 * Math.abs(noise(Math.cos(a) * 9, Math.sin(a) * 9, 2));
      const r1 = R + noise(a * 2, 7, 2) * 60;
      const x = center.x + Math.cos(a) * r1, z = center.z + Math.sin(a) * r1;
      const xb = center.x + Math.cos(a) * (r1 + 160), zb = center.z + Math.sin(a) * (r1 + 160);
      const xa = center.x + Math.cos(a) * (r1 - 150), za = center.z + Math.sin(a) * (r1 - 150);
      // 바닥에서 완만하게 올라가는 비탈 → 봉우리 (벽처럼 보이지 않게)
      pos.push(xa, baseY, za, x, h * 0.5, z, xb, h, zb);
      const c = ca.clone().lerp(cb, rand());
      col.push(ca.r, ca.g, ca.b, c.r, c.g, c.b, cb.r, cb.g, cb.b);
    }
    const idx = [];
    for (let k = 0; k < N; k++)
      for (let j = 0; j < 2; j++) {
        const a = k * 3 + j, b = a + 1, c = a + 3, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const ring = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    ring.name = 'horizonRing';
    group.add(ring);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 240, 64), new THREE.MeshLambertMaterial({ color: '#6f6d69' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(center.x, floorY, center.z);
    group.add(floor);
  }

  // ---------------------------------------------------------------- 바위 (인스턴스 3종: 작은 자갈, 바위, 큰 바위)
  {
    const rockGeo = (seed, detail) => {
      const g = new THREE.IcosahedronGeometry(1, detail);
      const p = g.attributes.position;
      const nz = makeNoise(seed);
      for (let i = 0; i < p.count; i++) {
        tmpV.fromBufferAttribute(p, i);
        const k = 1 + nz(tmpV.x * 1.7, tmpV.y * 1.7 + tmpV.z, 2) * 0.38;
        tmpV.multiplyScalar(k);
        tmpV.y *= 0.72;
        p.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
      }
      g.computeVertexNormals();
      return g;
    };
    const rockMat = new THREE.MeshLambertMaterial({ color: '#8d8a84', flatShading: true });
    const kinds = [
      { geo: rockGeo(11, 0), n: 900, s: [0.25, 0.9], clear: 3 },
      { geo: rockGeo(23, 1), n: 360, s: [1, 3], clear: 6 },
      { geo: rockGeo(37, 1), n: 70, s: [3.5, 9], clear: 14 },
    ];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
    for (const k of kinds) {
      const im = new THREE.InstancedMesh(k.geo, rockMat, k.n);
      im.castShadow = k.s[0] > 1;
      im.receiveShadow = true;
      let n = 0, tries = 0;
      while (n < k.n && tries < k.n * 6) {
        tries++;
        // 크레이터 테두리 근처에 더 많이 (튀어나온 바위)
        let x, z;
        const cr = track.craters[Math.floor(rand() * track.craters.length)];
        if (cr && rand() < 0.45) {
          const a = rand() * TAU, d = cr.r * (0.8 + rand() * 0.5);
          x = cr.x + Math.cos(a) * d;
          z = cr.z + Math.sin(a) * d;
        } else {
          x = tb.min.x + rand() * (tb.max.x - tb.min.x);
          z = tb.min.y + rand() * (tb.max.y - tb.min.y);
        }
        const s = k.s[0] + rand() ** 2 * (k.s[1] - k.s[0]);
        const rd = roadDist(x, z);
        if (rd < HW + CURB + k.clear + s) continue;
        if (s > 3 && !free(x, z, s)) continue;
        const y = ground(x, z);
        if (y < -30) continue; // 협곡 바닥은 빼고
        e.set(rand() * 0.5, rand() * TAU, rand() * 0.5);
        q.setFromEuler(e);
        sc.set(s * (0.8 + rand() * 0.5), s * (0.7 + rand() * 0.6), s * (0.8 + rand() * 0.5));
        m4.compose(tmpV.set(x, y - s * 0.25, z), q, sc);
        im.setMatrixAt(n++, m4);
        if (s > 2.2 && rd < 90) circle(x, z, s * 0.85, y - 2, y + s * 1.1);
        if (s > 3) occupy(x, z, s);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    }
  }

  // ---------------------------------------------------------------- 출발 게이트 (빨간불 5개, 운전자 기준 왼쪽부터)
  const gantry = (() => {
    const span = HW + CURB + 2.2;
    const g = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(1.1, 9.5, 1.1);
    for (const sd of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, M.white);
      leg.position.set(sd * span, 4.75, 0);
      leg.castShadow = true;
      g.add(leg);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 8.6, 0.2), M.cyanGlow);
      strip.position.set(sd * (span - 0.6), 4.75, 0.6);
      g.add(strip);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.2, 2.4, 1.2), M.dark);
    beam.position.y = 8.6;
    g.add(beam);
    const signTex = textTex(['LUNAR GRAND PRIX', '달 중력 기지 · MOON BASE ARTEMIS'], { w: 1024, h: 128, bg: '#0d1424', accent: '#5ff0ff' });
    for (const zz of [-0.62, 0.62]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, 2.1), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
      sign.position.set(0, 10.95, zz);
      if (zz < 0) sign.rotation.y = Math.PI; // 다가오는 차 쪽(-z)을 봄
      g.add(sign);
    }
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.4, 2.3, 1.1), M.dark);
    signBack.position.y = 10.95;
    g.add(signBack);
    // 신호등 몸통 5개 (각각 위아래 두 알)
    const off = new THREE.MeshStandardMaterial({ color: '#2a0806', roughness: 0.4 });
    const on = new THREE.MeshBasicMaterial({ color: '#ff2414', toneMapped: false });
    const green = new THREE.MeshBasicMaterial({ color: '#2bff6a', toneMapped: false });
    const pods = [];
    const bulbGeo = new THREE.CircleGeometry(0.42, 20);
    for (let k = 0; k < 5; k++) {
      // 게이트 로컬 +z = 진행 방향, 로컬 +x = 운전자 왼쪽 → 0번(가장 먼저 켜짐)이 운전자 왼쪽 끝
      const x = (2 - k) * 1.6;
      const pod = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.7), M.dark);
      pod.position.set(x, 6.4, -0.3);
      g.add(pod);
      const bulbs = [];
      for (const by of [6.95, 5.85]) {
        const b = new THREE.Mesh(bulbGeo, off);
        b.position.set(x, by, -0.66);
        b.rotation.y = Math.PI; // 다가오는 차(-z 쪽)를 바라봄
        g.add(b);
        bulbs.push(b);
      }
      pods.push(bulbs);
    }
    // 진행 방향(tan)을 로컬 +z로, 오른쪽(right)을 로컬 +x로
    const basis = new THREE.Matrix4().makeBasis(s0.right.clone().negate(), UP, s0.tan.clone()); // 오른손 좌표: 로컬 +x = 운전자 왼쪽
    g.quaternion.setFromRotationMatrix(basis);
    g.position.copy(s0.pos);
    g.position.y -= 0.05;
    group.add(g);
    for (const sd of [-1, 1]) {
      const p = s0.pos.clone().addScaledVector(s0.right, sd * span);
      circle(p.x, p.z, 0.9, p.y - 1, p.y + 9);
    }
    let lastN = -1, lastG = null;
    return {
      setLights(n) {
        if (n === lastN) return;
        lastN = n;
        pods.forEach((bl, k) => bl.forEach((b) => (b.material = k < n ? on : off)));
      },
      setGreen(gr) {
        if (gr === lastG) return;
        lastG = gr;
        if (gr) pods.forEach((bl) => bl.forEach((b) => (b.material = green)));
        else lastN = -1;
      },
    };
  })();
  animators.push(() => {
    const race = window.game && window.game.race;
    if (!race) return;
    if (race.phase === 'countdown') {
      gantry.setGreen(false);
      gantry.setLights(race.lights ?? 0);
    } else {
      gantry.setGreen(race.phase === 'racing' && race.time < 4);
      if (!(race.phase === 'racing' && race.time < 4)) gantry.setLights(0);
    }
  });

  // ---------------------------------------------------------------- 출발 직선 옆 관제동(피트) + 조명탑
  {
    const outSide = -1; // 출발 직선의 바깥쪽 (코스 안쪽은 +right 쪽이 아님: 아래에서 확인)
    // 코스 가운데가 어느 쪽인지: 가운데 방향과 right의 내적
    const toC = center.clone().sub(s0.pos).setY(0);
    const inner = Math.sign(toC.dot(s0.right)) || 1;
    const side = -inner * (outSide < 0 ? 1 : -1); // 바깥쪽
    const d = HW + CURB + 34;
    const pc = s0.pos.clone().addScaledVector(s0.right, side * d).addScaledVector(s0.tan, -45);
    const yaw = yawOf(s0);
    const pit = new THREE.Group();
    const L = 110, D = 18, H = 9;
    const body = new THREE.Mesh(new THREE.BoxGeometry(D, H, L), M.panel);
    body.position.y = H / 2;
    body.castShadow = body.receiveShadow = true;
    pit.add(body);
    const win = new THREE.Mesh(new THREE.BoxGeometry(D + 0.3, 3, L - 4), windowMat);
    win.position.y = H * 0.62;
    pit.add(win);
    windowTex.repeat.set(8, 1);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(D + 4, 0.6, L + 4), M.dark);
    roof.position.y = H + 0.3;
    pit.add(roof);
    // 위층 관제실 (유리)
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 7, 8), M.white);
    tower.position.set(0, H + 3.5, -L * 0.3);
    pit.add(tower);
    const towerGlass = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 6.2, 4, 8, 1, true), M.glass);
    towerGlass.position.set(0, H + 9, -L * 0.3);
    pit.add(towerGlass);
    const towerTop = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.2, 0.7, 8), M.dark);
    towerTop.position.set(0, H + 11.3, -L * 0.3);
    pit.add(towerTop);
    const signTex = textTex(['ARTEMIS', 'LUNAR RACING CONTROL'], { w: 1024, h: 192, bg: '#0d1424', accent: '#ffb02e' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(34, 6.4), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
    // 건물 로컬 +x = 도로 오른쪽의 반대(-right) → 도로는 로컬 side·(+x) 쪽
    sign.position.set(side * (D / 2 + 0.3), H + 4.2, L * 0.15);
    sign.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    pit.add(sign);
    for (let k = 0; k < 6; k++) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5 + (k % 3) * 2), M.steel);
      ant.position.set((k % 2 ? 1 : -1) * 4, H + 3, -L / 2 + 10 + k * 16);
      pit.add(ant);
    }
    pit.position.copy(pc);
    pit.position.y = Math.min(ground(pc.x, pc.z), s0.pos.y) - 0.3;
    pit.rotation.y = yaw;
    group.add(pit);
    // 충돌: 긴 건물 = 원 여러 개
    for (let k = -L / 2 + 6; k <= L / 2 - 6; k += 10) {
      const p = pc.clone().addScaledVector(s0.tan, k);
      circle(p.x, p.z, D / 2 + 1, pit.position.y - 1, pit.position.y + H + 12);
    }
    occupy(pc.x, pc.z, L / 2 + 6);
    // 피트 앞 바닥 (포장 판)
    const apron = new THREE.Mesh(new THREE.BoxGeometry(d - HW - CURB - 2, 0.2, L + 10), new THREE.MeshStandardMaterial({ color: '#56595f', roughness: 0.85 }));
    apron.rotation.y = yaw;
    const ac = s0.pos.clone().addScaledVector(s0.right, side * ((d + HW + CURB) / 2 - 3)).addScaledVector(s0.tan, -45);
    apron.position.set(ac.x, Math.min(s0.pos.y, ground(ac.x, ac.z)) - 0.12, ac.z);
    group.add(apron);

    // 조명탑: 출발 직선 양옆 + 곳곳
    const mastGeo = new THREE.CylinderGeometry(0.35, 0.5, 22, 8);
    const headGeo = new THREE.BoxGeometry(4.2, 1.6, 0.8);
    const lampGeo = new THREE.PlaneGeometry(3.6, 1.1);
    const mkMast = (p, facing) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(mastGeo, M.steel);
      m.position.y = 11;
      g.add(m);
      const h = new THREE.Mesh(headGeo, M.dark);
      h.position.y = 22;
      g.add(h);
      const l = new THREE.Mesh(lampGeo, M.whiteGlow);
      l.position.set(0, 22, 0.41);
      g.add(l);
      g.position.set(p.x, ground(p.x, p.z) - 0.2, p.z);
      g.rotation.y = facing;
      group.add(g);
      circle(p.x, p.z, 0.6, g.position.y - 1, g.position.y + 23);
    };
    for (let k = 0; k < 8; k++) {
      const s = track.sampleAt(((k - 3) * 55) / track.length + 1);
      // 4차: 출발 직선에만 (T1 지나서 코너 바깥 런오프에 서 있던 탑은 운전자 눈앞을 가렸음)
      if (Math.abs(Math.atan2(s.tan.x * s0.tan.z - s.tan.z * s0.tan.x, s.tan.x * s0.tan.x + s.tan.z * s0.tan.z)) > 0.08) continue;
      for (const sd of [-1, 1]) {
        if (sd === side && Math.abs((k - 3) * 55 + 45) < L / 2 + 8) continue; // 피트 건물 자리
        const p = s.pos.clone().addScaledVector(s.right, sd * (HW + CURB + 9));
        mkMast(p, Math.atan2(-sd * s.right.x, -sd * s.right.z));
      }
    }
  }

  // ---------------------------------------------------------------- 달 기지 건물 묶음 만들기
  function domeObj(r) {
    const g = new THREE.Group();
    const d = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, TAU, 0, Math.PI / 2), domeMat);
    d.castShadow = d.receiveShadow = true;
    g.add(d);
    const ringM = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.6, r + 1.2, 1.6, 32), M.dark);
    ringM.position.y = 0.4;
    g.add(ringM);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(r + 0.7, 0.12, 6, 48), M.cyanGlow);
    glow.rotation.x = Math.PI / 2;
    glow.position.y = 1.25;
    g.add(glow);
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 3), M.white);
    door.position.set(0, 1.7, r);
    g.add(door);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4), M.steel);
    top.position.y = r + 2;
    g.add(top);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), M.redGlow.clone());
    beacon.position.y = r + 4.1;
    g.add(beacon);
    const ph = rand() * 6;
    animators.push((t) => (beacon.material.color.set(Math.sin(t * 3 + ph) > 0.6 ? '#ff3b30' : '#3a0b08')));
    return g;
  }
  function habObj(len = 18) {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, len, 20), M.panel);
    c.rotation.z = Math.PI / 2;
    c.position.y = 4.2;
    c.castShadow = c.receiveShadow = true;
    g.add(c);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.45, len - 3, 20, 1, true), windowMat);
    band.rotation.z = Math.PI / 2;
    band.position.y = 4.2;
    g.add(band);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(3.4, 16, 10, 0, TAU, 0, Math.PI / 2), M.white);
      cap.rotation.z = -sx * Math.PI / 2;
      cap.position.set((sx * len) / 2, 4.2, 0);
      g.add(cap);
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.4, 0.4), M.steel);
        leg.position.set(sx * len * 0.35, 1.2, sz * 2.2);
        g.add(leg);
      }
    }
    return g;
  }
  function tubeBetween(a, b) {
    const ya = ground(a.x, a.z), yb = ground(b.x, b.z);
    const pa = new THREE.Vector3(a.x, ya + 2.2, a.z), pb = new THREE.Vector3(b.x, yb + 2.2, b.z);
    const len = pa.distanceTo(pb);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, len, 12), M.white);
    m.position.copy(pa).lerp(pb, 0.5);
    m.quaternion.setFromUnitVectors(UP, pb.clone().sub(pa).normalize());
    group.add(m);
    const ribs = Math.floor(len / 4);
    for (let k = 1; k < ribs; k++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 6, 16), M.dark);
      r.position.copy(pa).lerp(pb, k / ribs);
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pb.clone().sub(pa).normalize());
      group.add(r);
    }
  }
  function solarField(cx, cz, cols, rows, yaw) {
    const n = cols * rows;
    const panelGeo = new THREE.BoxGeometry(6, 0.15, 3.2);
    const panelTex = canvasTexture(128, 64, (c, w, h) => {
      c.fillStyle = '#16264a';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#6f8fc8';
      c.lineWidth = 1;
      for (let x = 0; x <= w; x += 16) (c.beginPath(), c.moveTo(x, 0), c.lineTo(x, h), c.stroke());
      for (let y = 0; y <= h; y += 16) (c.beginPath(), c.moveTo(0, y), c.lineTo(w, y), c.stroke());
      c.strokeStyle = '#c9d2e0';
      c.lineWidth = 3;
      c.strokeRect(1, 1, w - 2, h - 2);
    }, false);
    const panelMat = new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.25, metalness: 0.7 });
    const pm = new THREE.InstancedMesh(panelGeo, panelMat, n);
    const postM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.15, 2.2, 6), M.steel, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let k = 0;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const lx = (i - (cols - 1) / 2) * 7.2, lz = (j - (rows - 1) / 2) * 6.5;
        const x = cx + lx * cy + lz * sy, z = cz - lx * sy + lz * cy;
        const y = ground(x, z);
        e.set(-0.55, yaw, 0, 'YXZ');
        q.setFromEuler(e);
        m4.compose(tmpV.set(x, y + 2.3, z), q, new THREE.Vector3(1, 1, 1));
        pm.setMatrixAt(k, m4);
        m4.compose(tmpV.set(x, y + 1.1, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        postM.setMatrixAt(k, m4);
        k++;
      }
    pm.castShadow = true;
    group.add(pm, postM);
  }
  function landerObj() {
    const g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(16, 16.5, 0.6, 6), new THREE.MeshStandardMaterial({ color: '#4d5057', roughness: 0.8 }));
    pad.position.y = 0.3;
    g.add(pad);
    const hTex = textTex(['H'], { w: 256, h: 256, bg: null, fg: '#ffd21f', accent: '#ffd21f', border: false });
    const hm = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: hTex, transparent: true, depthWrite: false }));
    hm.rotation.x = -Math.PI / 2;
    hm.position.y = 0.62;
    g.add(hm);
    const lights = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), M.orangeGlow.clone());
      l.position.set(Math.cos(a) * 15.3, 0.8, Math.sin(a) * 15.3);
      g.add(l);
      lights.push(l);
    }
    animators.push((t) => lights.forEach((l, k) => l.material.color.set(Math.floor(t * 4) % 6 === k ? '#ffb02e' : '#4a2a08')));
    // 착륙선: 금박 몸통 + 다리 4개 + 위 모듈
    const lander = new THREE.Group();
    const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 3, 8), M.gold);
    bodyM.position.y = 4;
    lander.add(bodyM);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3, 4.2), M.white);
    cab.position.y = 7;
    cab.rotation.y = Math.PI / 4;
    lander.add(cab);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), M.cyanGlow);
    win.position.set(0, 7.4, 2.98);
    win.rotation.y = 0;
    lander.add(win);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5), M.steel);
      leg.position.set(Math.cos(a) * 3.8, 2.2, Math.sin(a) * 3.8);
      leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      lander.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.25, 10), M.steel);
      foot.position.set(Math.cos(a) * 5, 0.75, Math.sin(a) * 5);
      lander.add(foot);
    }
    const noz = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.6, 12, 1, true), M.dark);
    noz.position.y = 1.9;
    lander.add(noz);
    lander.traverse((o) => o.isMesh && (o.castShadow = true));
    g.add(lander);
    return g;
  }
  function roverObj(color = '#f2f4f8') {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 4.4), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }));
    body.position.y = 1.5;
    g.add(body);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.8), M.gold);
    deck.position.set(0, 2.4, -0.9);
    g.add(deck);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2), M.steel);
    mast.position.set(0.7, 3.2, 1.2);
    g.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.4), M.dark);
    head.position.set(0.7, 4.2, 1.2);
    g.add(head);
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.12, 8), M.cyanGlow);
    eye.position.set(0.7, 4.2, 1.41);
    g.add(eye);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 6, 0, TAU, 0, Math.PI / 2.6), M.white);
    dish.position.set(-0.6, 2.9, 0.6);
    dish.rotation.x = -0.6;
    g.add(dish);
    const wheels = [];
    const wg = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 12);
    for (const sx of [-1, 1])
      for (const z of [-1.6, 0, 1.6]) {
        const w = new THREE.Mesh(wg, M.dark);
        w.rotation.z = Math.PI / 2;
        w.position.set(sx * 1.55, 0.55, z);
        g.add(w);
        wheels.push(w);
      }
    g.traverse((o) => o.isMesh && (o.castShadow = true));
    return { g, wheels };
  }

  // ---------------------------------------------------------------- 기지 배치: 코스 안쪽 큰 빈터와 바깥 곳곳
  /** (x, z) 근처에서 자리를 찾음 (못 찾으면 null) */
  function findSpot(x, z, r, clear = 14, spread = 120, tries = 40) {
    for (let k = 0; k < tries; k++) {
      const a = rand() * TAU, d = k === 0 ? 0 : rand() * spread;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (ground(px, pz) < -20) continue;
      if (claim(px, pz, r, clear)) return { x: px, z: pz };
    }
    return null;
  }
  const domes = [];
  // 본부: 코스 가운데 쪽에 돔 4개 + 거주 모듈 + 통로
  {
    const hub = findSpot(center.x + 40, center.z - 60, 30, 20, 150);
    if (hub) {
      const d0 = domeObj(16);
      place(d0, hub.x, hub.z, rand() * TAU, 16);
      circle(hub.x, hub.z, 16.5, ground(hub.x, hub.z) - 2, ground(hub.x, hub.z) + 17);
      domes.push(hub);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.4;
        const r = 9 + rand() * 4;
        const sp = { x: hub.x + Math.cos(a) * 46, z: hub.z + Math.sin(a) * 46 };
        if (!claim(sp.x, sp.z, r, 16)) continue;
        place(domeObj(r), sp.x, sp.z, rand() * TAU, r);
        circle(sp.x, sp.z, r + 0.5, ground(sp.x, sp.z) - 2, ground(sp.x, sp.z) + r + 1);
        tubeBetween(hub, sp);
        domes.push(sp);
      }
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + 1.2;
        const sp = { x: hub.x + Math.cos(a) * 78, z: hub.z + Math.sin(a) * 78 };
        if (!claim(sp.x, sp.z, 11, 14)) continue;
        place(habObj(18), sp.x, sp.z, a + Math.PI / 2, 9);
        circle(sp.x, sp.z, 9, ground(sp.x, sp.z) - 1, ground(sp.x, sp.z) + 8);
      }
    }
  }
  // 태양광 패널 밭 3곳
  for (const [x, z] of [[center.x - 180, center.z + 40], [center.x + 260, center.z - 260], [center.x - 420, center.z - 300]]) {
    const sp = findSpot(x, z, 34, 14, 160);
    if (sp) solarField(sp.x, sp.z, 8, 5, rand() * 0.6);
  }
  // 착륙장 2곳
  for (const [x, z] of [[center.x + 120, center.z + 120], [center.x - 520, center.z + 260]]) {
    const sp = findSpot(x, z, 18, 16, 160);
    if (!sp) continue;
    const l = landerObj();
    place(l, sp.x, sp.z, rand() * TAU, 16, 0.1);
    const y = ground(sp.x, sp.z);
    circle(sp.x, sp.z, 6, y - 1, y + 10);
  }
  // 로켓 발사대 2곳 (차가 가까이 오면 발사)
  const rockets = [];
  for (const [x, z] of [[center.x - 300, center.z + 120], [center.x + 380, center.z + 330]]) {
    const sp = findSpot(x, z, 16, 30, 200);
    if (!sp) continue;
    const rp = rocketPad();
    place(rp.obj, sp.x, sp.z, rand() * TAU, 10);
    const y = ground(sp.x, sp.z);
    circle(sp.x, sp.z, rp.radius || 12, y - 1, y + 30);
    rockets.push(rp);
  }
  // 레이더 접시·안테나·천문대
  const updaters = [];
  for (let k = 0; k < 4; k++) {
    const sp = findSpot(center.x + (rand() - 0.5) * 900, center.z + (rand() - 0.5) * 800, 4, 12, 120);
    if (!sp) continue;
    const r = radarDish({ size: 1 + rand() * 0.6 });
    place(r.obj, sp.x, sp.z, rand() * TAU, 3);
    circle(sp.x, sp.z, r.radius, ground(sp.x, sp.z) - 1, ground(sp.x, sp.z) + r.height);
    updaters.push(r);
  }
  for (let k = 0; k < 7; k++) {
    const sp = findSpot(center.x + (rand() - 0.5) * 1000, center.z + (rand() - 0.5) * 900, 2, 10, 100);
    if (!sp) continue;
    const a = antennaMast({ height: 18 + rand() * 16 });
    place(a.obj, sp.x, sp.z, 0, 1);
    circle(sp.x, sp.z, 1, ground(sp.x, sp.z) - 1, ground(sp.x, sp.z) + 40);
    updaters.push(a);
  }
  {
    // 천문대는 이름 있는 크레이터 테두리 위에
    const cr = track.craters.find((c) => c.name) || track.craters[0];
    if (cr) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        const x = cr.x + Math.cos(a) * cr.r * 1.05, z = cr.z + Math.sin(a) * cr.r * 1.05;
        if (!claim(x, z, 9, 18)) continue;
        const o = observatory();
        place(o.obj, x, z, rand() * TAU, 7);
        circle(x, z, o.radius, ground(x, z) - 1, ground(x, z) + o.height);
        updaters.push(o);
        break;
      }
    }
  }
  // 탐사차: 정해진 둘레를 천천히 돎 (부딪히지 않는 먼 곳)
  {
    const cols = ['#f2f4f8', '#ffd21f', '#ff7a1f', '#9fd8ff'];
    for (let k = 0; k < 5; k++) {
      let c = null;
      for (let tr = 0; tr < 30 && !c; tr++) {
        const x = center.x + (rand() - 0.5) * 900, z = center.z + (rand() - 0.5) * 800;
        const R = 18 + rand() * 20;
        let ok = ground(x, z) > -20;
        for (let j = 0; j < 8 && ok; j++) {
          const a = (j / 8) * TAU;
          ok = roadDist(x + Math.cos(a) * R, z + Math.sin(a) * R) > HW + CURB + 20 && free(x + Math.cos(a) * R, z + Math.sin(a) * R, 3);
        }
        if (ok) c = { x, z, R };
      }
      if (!c) continue;
      occupy(c.x, c.z, c.R + 4);
      const rv = roverObj(cols[k % cols.length]);
      group.add(rv.g);
      const sp = (0.35 + rand() * 0.3) * (rand() < 0.5 ? -1 : 1), ph = rand() * TAU;
      // 바퀴 자국 (고리 모양 어두운 띠)
      const trackRing = new THREE.Mesh(new THREE.RingGeometry(c.R - 1.4, c.R + 1.4, 48), new THREE.MeshBasicMaterial({ color: '#55534f', transparent: true, opacity: 0.55, depthWrite: false }));
      trackRing.rotation.x = -Math.PI / 2;
      trackRing.position.set(c.x, ground(c.x, c.z) + 0.15, c.z);
      group.add(trackRing);
      animators.push((t) => {
        const a = ph + t * sp * (8 / c.R);
        const x = c.x + Math.cos(a) * c.R, z = c.z + Math.sin(a) * c.R;
        rv.g.position.set(x, ground(x, z), z);
        rv.g.rotation.y = -a + (sp > 0 ? Math.PI : 0);
        for (const w of rv.wheels) w.rotation.x = t * sp * 6;
      });
    }
  }

  // ---------------------------------------------------------------- 길가 소품 묶음: 화물 컨테이너·연료 탱크·작은 모듈·안테나 (코스를 따라 약 150 m마다)
  {
    const contGeo = new THREE.BoxGeometry(6, 2.6, 2.6);
    const contTex = canvasTexture(128, 64, (c, w, h) => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      for (let x = 4; x < w; x += 8) c.fillRect(x, 0, 3, h);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(0, 0, w, 4);
      c.fillRect(0, h - 4, w, 4);
    });
    const contMat = new THREE.MeshStandardMaterial({ map: contTex, roughness: 0.6, metalness: 0.3 });
    const MAXC = 140;
    const cont = new THREE.InstancedMesh(contGeo, contMat, MAXC);
    cont.castShadow = true;
    const contCols = ['#e8e4dc', '#ff7a1f', '#3a76d8', '#d8d2c0', '#ffd21f', '#9aa3b2'].map((c) => new THREE.Color(c));
    let nc = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const tankGeo = new THREE.CylinderGeometry(2.4, 2.4, 7, 18);
    const tankTop = new THREE.SphereGeometry(2.4, 18, 8, 0, TAU, 0, Math.PI / 2);
    const bandGeo = new THREE.CylinderGeometry(2.45, 2.45, 0.35, 18);
    function containers(x, z, yaw) {
      const n = 2 + Math.floor(rand() * 5);
      const y0 = ground(x, z);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let k = 0; k < n && nc < MAXC; k++) {
        const col = k % 3, lay = Math.floor(k / 3);
        const lx = (col - 1) * 2.8, ly = 1.3 + lay * 2.6;
        q.setFromAxisAngle(UP, yaw + Math.PI / 2 + (rand() - 0.5) * 0.08);
        m4.compose(tmpV.set(x + lx * cy, y0 + ly - 0.1, z - lx * sy), q, one);
        cont.setMatrixAt(nc, m4);
        cont.setColorAt(nc, contCols[Math.floor(rand() * contCols.length)]);
        nc++;
      }
      circle(x, z, 4.6, y0 - 1, y0 + 6);
    }
    function tanks(x, z) {
      const n = 2 + Math.floor(rand() * 2);
      const y0 = ground(x, z);
      const a0 = rand() * TAU;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const px = x + Math.cos(a0 + (k / n) * TAU) * 3.4, pz = z + Math.sin(a0 + (k / n) * TAU) * 3.4;
        const yy = Math.min(y0, ground(px, pz));
        const t = new THREE.Mesh(tankGeo, M.white);
        t.position.set(px, yy + 3.5, pz);
        t.castShadow = true;
        const top = new THREE.Mesh(tankTop, M.white);
        top.position.set(px, yy + 7, pz);
        const band = new THREE.Mesh(bandGeo, k % 2 ? M.orange : M.dark);
        band.position.set(px, yy + 5.2, pz);
        group.add(t, top, band);
        pts.push([px, yy, pz]);
        circle(px, pz, 2.6, yy - 1, yy + 9.5);
      }
      // 탱크 사이 배관
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        const pa = new THREE.Vector3(a[0], a[1] + 1.2, a[2]), pb = new THREE.Vector3(b[0], b[1] + 1.2, b[2]);
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, pa.distanceTo(pb), 8), M.steel);
        pipe.position.copy(pa).lerp(pb, 0.5);
        pipe.quaternion.setFromUnitVectors(UP, pb.clone().sub(pa).normalize());
        group.add(pipe);
      }
    }
    const kinds = ['containers', 'tanks', 'hab', 'mast', 'containers', 'dish'];
    const L = track.length;
    let side = 1;
    for (let d = 90, k = 0; d < L - 60; d += 140 + rand() * 60, k++) {
      const s = track.sampleAt(d / L);
      if (s.gap || s.roll || s.magnet) continue;
      side = -side;
      const kind = kinds[k % kinds.length];
      for (let tr = 0; tr < 6; tr++) {
        const off = HW + CURB + 26 + rand() * 30;
        const p = s.pos.clone().addScaledVector(s.right, side * off).addScaledVector(s.tan, (rand() - 0.5) * 30);
        if (ground(p.x, p.z) < -15) continue;
        const r = kind === 'hab' ? 10 : kind === 'tanks' ? 7 : 5;
        if (!claim(p.x, p.z, r, 22)) continue;
        const yaw = yawOf(s) + (rand() - 0.5) * 0.6;
        if (kind === 'containers') containers(p.x, p.z, yaw);
        else if (kind === 'tanks') tanks(p.x, p.z);
        else if (kind === 'hab') {
          place(habObj(14 + rand() * 6), p.x, p.z, yaw, 8);
          circle(p.x, p.z, 8, ground(p.x, p.z) - 1, ground(p.x, p.z) + 8);
        } else if (kind === 'mast') {
          const a = antennaMast({ height: 16 + rand() * 12 });
          place(a.obj, p.x, p.z, 0, 1);
          circle(p.x, p.z, 1, ground(p.x, p.z) - 1, ground(p.x, p.z) + 30);
          updaters.push(a);
        } else {
          const r2 = radarDish({ size: 0.7 + rand() * 0.4 });
          place(r2.obj, p.x, p.z, rand() * TAU, 3);
          circle(p.x, p.z, r2.radius, ground(p.x, p.z) - 1, ground(p.x, p.z) + r2.height);
          updaters.push(r2);
        }
        break;
      }
    }
    cont.count = nc;
    cont.instanceMatrix.needsUpdate = true;
    if (cont.instanceColor) cont.instanceColor.needsUpdate = true;
    group.add(cont);
  }

  // ---------------------------------------------------------------- 길가 바닥 빛 (활주로 등처럼 낮은 빛 점, 구역 색)
  {
    const studGeo = new THREE.BoxGeometry(0.5, 0.22, 0.5);
    const studMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const L = track.length, STEP = 14;
    const MAX = Math.ceil(L / STEP) * 2 + 4;
    const im = new THREE.InstancedMesh(studGeo, studMat, MAX);
    const cPlain = new THREE.Color('#dfe8ff'), cLow = new THREE.Color('#5ff0ff'), cHigh = new THREE.Color('#ff8a2a');
    const m4 = new THREE.Matrix4();
    let n = 0;
    for (let d = 0; d < L; d += STEP) {
      const s = track.sampleAt(d / L);
      if (s.gap || s.roll || s.magnet) continue;
      for (const sd of [-1, 1]) {
        const lat = HW + track.kerbAt(s.i, sd) + 2.3;
        const p = s.pos.clone().addScaledVector(s.right, sd * lat);
        const y = Math.max(ground(p.x, p.z), track.roadYAt(s, sd * (HW + track.kerbAt(s.i, sd))) - 0.4);
        if (y < s.pos.y - 3) continue;
        m4.makeTranslation(p.x, y + 0.1, p.z);
        im.setMatrixAt(n, m4);
        im.setColorAt(n, s.zone ? (s.zone.kind === 'low' ? cLow : cHigh) : cPlain);
        n++;
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    group.add(im);
  }

  // ---------------------------------------------------------------- 중력 구역 문 + 홀로그램 글자
  const holoMats = [];
  function gate(s, kind, lines) {
    const color = kind === 'low' ? '#5ff0ff' : kind === 'high' ? '#ff8a2a' : '#c08cff';
    const glow = kind === 'low' ? M.cyanGlow : kind === 'high' ? M.orangeGlow : M.purpleGlow;
    const half = HW + Math.max(track.kerbAt(s.i, -1), track.kerbAt(s.i, 1)) + 2.4;
    const g = new THREE.Group();
    // 반원 고리 (빛)
    const arc = new THREE.Mesh(new THREE.TorusGeometry(half, 0.35, 8, 48, Math.PI), glow);
    g.add(arc);
    const arc2 = new THREE.Mesh(new THREE.TorusGeometry(half + 0.9, 0.12, 6, 48, Math.PI), glow);
    g.add(arc2);
    // 기둥
    for (const sd of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, 1.2), M.dark);
      p.position.set(sd * half, 1.5, 0);
      g.add(p);
    }
    // 홀로그램 판 (양면)
    const tex = textTex(lines, { w: 768, h: 192, bg: 'rgba(6,12,28,0.55)', fg: '#ffffff', accent: color });
    const hm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    holoMats.push(hm);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), hm);
    plate.position.y = half + 3.4;
    plate.rotation.y = Math.PI; // 다가오는 차(-z 쪽)에서 글자가 바로 보이게
    g.add(plate);
    const basis = new THREE.Matrix4().makeBasis(s.right.clone().negate(), UP, s.tan.clone());
    g.quaternion.setFromRotationMatrix(basis);
    g.position.copy(s.pos);
    group.add(g);
    for (const sd of [-1, 1]) {
      const p = s.pos.clone().addScaledVector(s.right, sd * half);
      circle(p.x, p.z, 0.8, p.y - 1, p.y + half + 2);
    }
    return g;
  }
  for (const z of track.gravityZones || []) {
    const gStr = `${z.g.toFixed(2)} G`;
    const nm = z.kind === 'low' ? '저중력 구역' : '고중력 구역';
    gate(track.S(z.a), z.kind, [`${z.kind === 'low' ? 'LOW-G' : 'HIGH-G'}  ${gStr}`, nm + (z.kind === 'low' ? ' · 둥실 점프' : ' · 묵직한 내리막')]);
    gate(track.S(z.b), z.kind, ['1.00 G', '보통 중력']);
  }
  // 구역 도로 표시: 저중력 = 하늘색 위 화살표(︿), 고중력 = 주황 아래 화살표(﹀) — 도로 위에 얇게 칠함
  {
    const chevTex = (color, up) =>
      canvasTexture(128, 128, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.strokeStyle = color;
        c.lineWidth = 16;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        for (const y0 of [34, 78]) {
          c.beginPath();
          if (up) (c.moveTo(18, y0 + 26), c.lineTo(64, y0 - 8), c.lineTo(110, y0 + 26));
          else (c.moveTo(18, y0 - 8), c.lineTo(64, y0 + 26), c.lineTo(110, y0 - 8));
          c.stroke();
        }
      }, false);
    const mats = {
      low: new THREE.MeshBasicMaterial({ map: chevTex('#5ff0ff', true), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      high: new THREE.MeshBasicMaterial({ map: chevTex('#ff8a2a', false), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    const geo = new THREE.PlaneGeometry(6, 6);
    const m4 = new THREE.Matrix4();
    for (const kind of ['low', 'high']) {
      const zs = (track.gravityZones || []).filter((z) => z.kind === kind);
      const list = [];
      for (const z of zs)
        for (let i = z.a + track.mS(20); i <= z.b - track.mS(10); i += track.mS(32)) {
          const sm = track.S(i);
          if (sm.gap || sm.magnet) continue;
          // 점프 립 바로 앞·착지 바로 뒤는 빼고
          if ((track.jumps || []).some((j) => i > j.lipI - track.mS(25) && i < j.landI + track.mS(8))) continue;
          list.push(sm);
        }
      const im = new THREE.InstancedMesh(geo, mats[kind], Math.max(1, list.length));
      list.forEach((sm, k) => {
        const p = track.surf(sm, 0, 0.05, new THREE.Vector3());
        m4.makeBasis(sm.rightB, sm.tan3, sm.up).setPosition(p);
        im.setMatrixAt(k, m4);
      });
      im.count = list.length;
      im.renderOrder = 2;
      group.add(im);
    }
  }
  // 저중력 구역: 도로 위에 천천히 떠다니는 빛 알갱이
  const motes = [];
  const moteTex = canvasTexture(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(160,240,255,0.6)');
    g.addColorStop(1, 'rgba(120,220,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }, false);
  for (const z of (track.gravityZones || []).filter((q) => q.kind === 'low')) {
    const n = 220;
    const pos = new Float32Array(n * 3), base = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const i = z.a + Math.floor(rand() * (z.b - z.a));
      const sm = track.S(i);
      const p = track.surf(sm, (rand() - 0.5) * (W + 14), 0.5 + rand() * 7, new THREE.Vector3());
      base.set([p.x, p.y, p.z], k * 3);
      pos.set([p.x, p.y, p.z], k * 3);
      ph[k] = rand() * TAU;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#9ff6ff', map: moteTex, size: 0.6, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false;
    group.add(pts);
    motes.push({ pts, pos, base, ph, n, center: track.S(Math.round((z.a + z.b) / 2)).pos });
  }
  animators.push((t, dt, car) => {
    for (const m of motes) {
      // 차가 멀리 있으면 움직이지 않음 (아낌)
      if (car && car.pos.distanceToSquared(m.center) > 700 * 700) continue;
      for (let k = 0; k < m.n; k++) {
        const a = m.ph[k] + t * 0.6;
        m.pos[k * 3] = m.base[k * 3] + Math.sin(a) * 0.6;
        m.pos[k * 3 + 1] = m.base[k * 3 + 1] + Math.sin(a * 0.7 + 1) * 1.2;
        m.pos[k * 3 + 2] = m.base[k * 3 + 2] + Math.cos(a * 0.8) * 0.6;
      }
      m.pts.geometry.attributes.position.needsUpdate = true;
    }
  });
  // 중력 루프 입구 문
  if (track.roll) {
    const r = track.roll;
    gate(track.S(r.a - r.pad - track.mS(26)), 'loop', ['GRAVITY LOOP', '자석 도로 · 그대로 달리면 한 바퀴']);
  }
  // 점프 앞 안내판 + 립 양옆 경고등 + 협곡 바닥 빛
  const beacons = [];
  for (const j of track.jumps || []) {
    const sJ = track.S(j.lipI - track.mS(95));
    gate(sJ, 'low', ['LUNAR JUMP', `협곡 ${Math.round(j.gapLen)} m · 중력 쿠션이 받쳐 줘요`]);
    const lip = j.lip;
    for (const sd of [-1, 1]) {
      const p = lip.pos.clone().addScaledVector(lip.right, sd * (HW + CURB + 1.5));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 3.2, 8), M.dark);
      post.position.copy(p).add(new THREE.Vector3(0, -1.6 + 1.6, 0));
      post.position.y = p.y - 1.2;
      group.add(post);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), M.orangeGlow.clone());
      b.position.copy(p);
      b.position.y = p.y + 0.6;
      group.add(b);
      beacons.push(b);
    }
    // 협곡 바닥 붉은 빛 점들
    const ch = track.chasms[track.jumps.indexOf(j)];
    if (ch) {
      for (let k = 0; k < 10; k++) {
        const p = ch.mid.clone().addScaledVector(ch.across, (rand() - 0.5) * ch.halfW * 1.4).addScaledVector(ch.along, (rand() - 0.5) * ch.halfLen);
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), M.redGlow);
        l.position.set(p.x, ground(p.x, p.z) + 0.6, p.z);
        group.add(l);
      }
    }
  }
  animators.push((t) => {
    const on = Math.sin(t * 6) > 0;
    for (const b of beacons) b.material.color.set(on ? '#ffb02e' : '#3a1c04');
    for (const m of holoMats) m.opacity = 0.82 + Math.sin(t * 2.3) * 0.12;
  });
  // 루프 빛 고리 흐르기 (moonTrack이 만든 rollParts.rings)
  if (track.rollParts && track.rollParts.rings.length) {
    const rings = track.rollParts.rings;
    const ringMats = rings.map(() => null);
    rings.forEach((r, k) => {
      r.material = r.material.clone();
      ringMats[k] = r.material;
    });
    animators.push((t) => {
      const n = rings.length;
      const head = (t * 9) % n;
      ringMats.forEach((m, k) => {
        const d = (head - k + n) % n;
        m.color.setHSL(0.76, 1, d < 1.5 ? 0.8 : 0.55);
      });
    });
  }

  // ---------------------------------------------------------------- 매 프레임
  animators.push((t, dt, car) => {
    if (car) sky.position.copy(car.pos);
    for (const u of updaters) u.update && u.update(t, dt, car);
    for (const r of rockets) r.update(t, dt || 0, car);
  });

  // ---------------------------------------------------------------- 길가를 오가는 탐사차 (2차): 코스 옆 곧은 길을 따라 왔다 갔다 + 뒤에 달 먼지
  {
    const NS = track.samples.length - 1;
    const S = (i) => track.samples[((i % NS) + NS) % NS];
    const hd = (s) => Math.atan2(s.tan.x, s.tan.z);
    const LEN = 70; // 샘플 (약 130 m)
    const used = new Uint8Array(NS);
    const routes = [];
    const blocked = (x, z) => !free(x, z, 3) || allColliders.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 3) ** 2);
    for (let i = 0; i < NS && routes.length < 5; i += 6) {
      let ok = true;
      for (let k = 0; k <= LEN && ok; k += 5) {
        const s = S(i + k);
        if (s.gap || s.roll || s.magnet || used[(i + k) % NS]) ok = false;
      }
      if (!ok) continue;
      let d = hd(S(i + LEN)) - hd(S(i));
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 0.08) continue;
      for (const side of routes.length % 2 ? [1, -1] : [-1, 1]) {
        const off = side * (HW + CURB + 17);
        const pts = [];
        let good = true;
        for (let k = 0; k <= LEN && good; k += 2) {
          const s = S(i + k);
          const x = s.pos.x + s.right.x * off, z = s.pos.z + s.right.z * off;
          const y = ground(x, z);
          if (blocked(x, z) || Math.abs(y - s.pos.y) > 7 || roadDist(x, z) < HW + CURB + 10) good = false;
          pts.push(new THREE.Vector3(x, y, z));
        }
        if (!good) continue;
        routes.push(pts);
        for (const p of pts) occupy(p.x, p.z, 2.5);
        for (let k = -25; k <= LEN + 25; k++) used[(((i + k) % NS) + NS) % NS] = 1;
        i += LEN;
        break;
      }
    }
    // 먼지 (모든 탐사차가 같이 쓰는 점 묶음 하나)
    const DN = 160;
    const dPos = new Float32Array(DN * 3).fill(-9999), dCol = new Float32Array(DN * 3), dAge = new Float32Array(DN).fill(99), dVel = new Float32Array(DN * 3);
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    dGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
    const puffTex = canvasTexture(64, 64, (c, w, h) => {
      const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr;
      c.fillRect(0, 0, w, h);
    }, false);
    const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ size: 2.6, map: puffTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    dust.frustumCulled = false;
    group.add(dust);
    let dHead = 0;
    const rovers = routes.map((pts, k) => {
      const rv = roverObj(['#f2f4f8', '#ffcf3f', '#ff7a45', '#9fe8ff', '#c8ff6a'][k % 5]);
      group.add(rv.g);
      const cum = [0];
      for (let q = 1; q < pts.length; q++) cum.push(cum[q - 1] + pts[q].distanceTo(pts[q - 1]));
      return { rv, pts, cum, len: cum[cum.length - 1], u: rand() * cum[cum.length - 1], dir: rand() < 0.5 ? 1 : -1, v: 6 + rand() * 4, wait: 0, emit: 0 };
    });
    const at = new THREE.Vector3(), nx = new THREE.Vector3();
    const pointAt = (r, u, out) => {
      let q = 1;
      while (q < r.cum.length - 1 && r.cum[q] < u) q++;
      const f = (u - r.cum[q - 1]) / Math.max(1e-6, r.cum[q] - r.cum[q - 1]);
      return out.lerpVectors(r.pts[q - 1], r.pts[q], THREE.MathUtils.clamp(f, 0, 1));
    };
    animators.push((t, dt) => {
      dt = Math.min(0.05, dt || 1 / 60);
      for (const r of rovers) {
        if (r.wait > 0) r.wait -= dt;
        else {
          r.u += r.dir * r.v * dt;
          if (r.u > r.len - 1 || r.u < 1) (r.dir *= -1), (r.u = THREE.MathUtils.clamp(r.u, 1, r.len - 1)), (r.wait = 1.5 + rand() * 2);
        }
        pointAt(r, r.u, at);
        pointAt(r, r.u + r.dir * 2, nx);
        r.rv.g.position.copy(at);
        r.rv.g.rotation.y = Math.atan2(nx.x - at.x, nx.z - at.z);
        if (r.wait > 0) continue;
        for (const w of r.rv.wheels) w.rotation.x += r.v * dt * 1.8;
        r.emit += dt;
        if (r.emit > 0.09) {
          r.emit = 0;
          const i = dHead;
          dHead = (dHead + 1) % DN;
          dPos[i * 3] = at.x - (nx.x - at.x) * 1.2 + (rand() - 0.5);
          dPos[i * 3 + 1] = at.y + 0.4;
          dPos[i * 3 + 2] = at.z - (nx.z - at.z) * 1.2 + (rand() - 0.5);
          dVel[i * 3] = (rand() - 0.5) * 1.2;
          dVel[i * 3 + 1] = 0.8 + rand() * 1.2;
          dVel[i * 3 + 2] = (rand() - 0.5) * 1.2;
          dAge[i] = 0;
        }
      }
      for (let i = 0; i < DN; i++) {
        if (dAge[i] > 3.2) continue;
        dAge[i] += dt;
        dVel[i * 3 + 1] -= 1.62 * 0.5 * dt; // 달 중력이라 천천히 내려앉음
        dPos[i * 3] += dVel[i * 3] * dt;
        dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt;
        dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
        const c = Math.max(0, 0.2 * (1 - dAge[i] / 3.2));
        dCol[i * 3] = c;
        dCol[i * 3 + 1] = c * 0.97;
        dCol[i * 3 + 2] = c * 0.92;
        if (dAge[i] > 3.2) dPos[i * 3 + 1] = -9999;
      }
      dGeo.attributes.position.needsUpdate = true;
      dGeo.attributes.color.needsUpdate = true;
    });
    extraStats.roadRovers = rovers.length;
    extraStats.roverRoutes = routes.map((p) => [Math.round(p[0].x), Math.round(p[0].y), Math.round(p[0].z), Math.round(p[p.length - 1].x), Math.round(p[p.length - 1].z)]);
  }

  // ---------------------------------------------------------------- 대형 로켓 발사 (2차): 레이스 중 정해진 시간마다 출발 직선 옆 발사대에서 큰 로켓이 하늘로
  //   레이스 시간 24초에 첫 발사, 그 뒤 80초마다 (2바퀴 레이스에서 2~3번). 출발 직선 옆 전광판에 카운트다운 (T-10 … 발사!)
  //   발사 순간 window에 'moonlaunch' 이벤트 → moonProps가 화면 알림 + 낮은 우르릉 소리
  const LAUNCH = { first: 24, every: 80, count: 10, flight: 34 };
  {
    const sA = track.sampleAt(0.03);
    let sp = null, side = 1;
    for (const sd of [1, -1]) {
      sp = findSpot(sA.pos.x + sA.right.x * sd * 200 + sA.tan.x * 160, sA.pos.z + sA.right.z * sd * 200 + sA.tan.z * 160, 30, 50, 110);
      if (sp) {
        side = sd;
        break;
      }
    }
    if (sp) {
      const pad = new THREE.Group();
      const concrete = new THREE.MeshStandardMaterial({ color: '#8d8f96', roughness: 0.9 });
      const towerMat = new THREE.MeshStandardMaterial({ color: '#b5462e', roughness: 0.6, metalness: 0.4 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(20, 22, 3, 32), concrete);
      base.position.y = 1.5;
      const trench = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 44), M.dark);
      trench.position.y = 3.05;
      pad.add(base, trench);
      // 발사탑: 기둥·가로대·팔을 인스턴스 하나로 (그리기 호출 1번)
      const beams = [];
      for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) beams.push([x, 39, z, 0.7, 78, 0.7]);
      for (let y = 4; y < 78; y += 6) beams.push([0, y, -2.2, 5.1, 0.4, 0.4], [0, y, 2.2, 5.1, 0.4, 0.4], [-2.2, y, 0, 0.4, 0.4, 5.1], [2.2, y, 0, 0.4, 0.4, 5.1]);
      beams.push([-6, 46, 0, 8, 0.8, 1.6], [-6.5, 62, 0, 9, 0.8, 1.6]);
      const tower = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMat, beams.length);
      const mtx = new THREE.Matrix4();
      beams.forEach(([x, y, z, sx, sy, sz], k) => tower.setMatrixAt(k, mtx.compose(new THREE.Vector3(x + 13, y + 3, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz))));
      tower.castShadow = true;
      pad.add(tower);
      const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moteTex, color: '#ff3b30', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      beacon.scale.setScalar(6);
      beacon.position.set(13, 83, 0);
      pad.add(beacon);
      // 로켓 (흰 몸통 + 검은 띠 + 부스터 2개)
      const R = new THREE.Group();
      R.position.y = 3;
      const white = new THREE.MeshStandardMaterial({ color: '#f4f5f8', roughness: 0.45, metalness: 0.2, emissive: '#3c4048' });
      const add = (geo, mat, x, y, z = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        R.add(m);
        return m;
      };
      add(new THREE.CylinderGeometry(3, 3, 46, 20), white, 0, 25);
      add(new THREE.CylinderGeometry(3.06, 3.06, 1.8, 20), M.dark, 0, 44);
      add(new THREE.CylinderGeometry(2.6, 3, 12, 20), white, 0, 54);
      add(new THREE.ConeGeometry(2.6, 8, 20), white, 0, 64);
      add(new THREE.CylinderGeometry(1.4, 2.4, 3, 14, 1, true), M.dark, 0, 0.6);
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(1.6, 1.6, 30, 14), white, sx * 4.7, 17);
        add(new THREE.ConeGeometry(1.6, 5, 14), white, sx * 4.7, 34.5);
        add(new THREE.CylinderGeometry(0.9, 1.5, 2.2, 10, 1, true), M.dark, sx * 4.7, 1);
      }
      const flameMat = new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
      const coreMat = new THREE.MeshBasicMaterial({ color: '#fff4c2', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
      const flame = new THREE.Group();
      const f1 = new THREE.Mesh(new THREE.ConeGeometry(4.2, 34, 16, 1, true), flameMat);
      f1.rotation.x = Math.PI;
      f1.position.y = -17;
      const f2 = new THREE.Mesh(new THREE.ConeGeometry(2.2, 20, 12, 1, true), coreMat);
      f2.rotation.x = Math.PI;
      f2.position.y = -10;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: moteTex, color: '#ffb060', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
      glow.scale.setScalar(70);
      glow.position.y = -6;
      flame.add(f1, f2, glow);
      flame.visible = false;
      R.add(flame);
      pad.add(R);
      // 발사 때 퍼지는 먼지 구름 (달 표면 레골리스)
      const puffMat = new THREE.MeshStandardMaterial({ color: '#a9a49a', roughness: 1, transparent: true, opacity: 0.5, depthWrite: false });
      const puffGeo = new THREE.IcosahedronGeometry(1, 1);
      const puffs = [];
      for (let k = 0; k < 18; k++) {
        const m = new THREE.Mesh(puffGeo, puffMat);
        m.visible = false;
        pad.add(m);
        puffs.push({ m, a: (k / 18) * TAU + rand() * 0.3, sp: 7 + rand() * 6, life: 0 });
      }
      // 꼬리 빛 (지나간 자리에 남는 불빛 점, 천천히 사라짐)
      const TN = 140;
      const tPos = new Float32Array(TN * 3).fill(-9999), tCol = new Float32Array(TN * 3), tAge = new Float32Array(TN).fill(99);
      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
      tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
      const trail = new THREE.Points(tGeo, new THREE.PointsMaterial({ size: 14, map: moteTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
      trail.frustumCulled = false;
      group.add(trail);
      let tHead = 0, tEmit = 0;
      const yaw = Math.atan2(sA.pos.x - sp.x, sA.pos.z - sp.z);
      pad.scale.setScalar(1.4); // 출발 직선에서도 잘 보이게 크게 (로켓 높이 약 95 m)
      const padY = place(pad, sp.x, sp.z, yaw, 28);
      circle(sp.x, sp.z, 30, padY - 2, padY + 125);
      // 카운트다운 전광판 (출발 직선 옆, 다가오는 차를 바라봄)
      const sB = track.sampleAt(0.012);
      const boardLat = side * (HW + CURB + 12);
      const bx = sB.pos.x + sB.right.x * boardLat, bz = sB.pos.z + sB.right.z * boardLat;
      const bc = document.createElement('canvas');
      bc.width = 512;
      bc.height = 176;
      const bctx = bc.getContext('2d');
      const bTex = new THREE.CanvasTexture(bc);
      bTex.colorSpace = THREE.SRGBColorSpace;
      let bText = '';
      const drawBoard = (l1, l2, col) => {
        const key = l1 + l2 + col;
        if (key === bText) return;
        bText = key;
        bctx.fillStyle = '#060a16';
        bctx.fillRect(0, 0, 512, 176);
        bctx.strokeStyle = col;
        bctx.lineWidth = 6;
        bctx.strokeRect(5, 5, 502, 166);
        bctx.textAlign = 'center';
        bctx.textBaseline = 'middle';
        bctx.fillStyle = '#9fb4d8';
        bctx.font = 'bold 30px "Segoe UI","Malgun Gothic",sans-serif';
        bctx.fillText('ARTEMIS HEAVY 로켓', 256, 44);
        bctx.fillStyle = col;
        bctx.font = 'bold 64px "Segoe UI","Malgun Gothic",sans-serif';
        bctx.fillText(l1, 256, 110);
        bctx.font = 'bold 22px "Segoe UI","Malgun Gothic",sans-serif';
        bctx.fillStyle = '#dfe8ff';
        bctx.fillText(l2, 256, 154);
        bTex.needsUpdate = true;
      };
      drawBoard('발사 대기', '레이스가 시작되면 카운트다운', '#5ff0ff');
      if (free(bx, bz, 5)) {
        occupy(bx, bz, 5);
        const board = new THREE.Group();
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.8), new THREE.MeshBasicMaterial({ map: bTex, toneMapped: false }));
        panel.position.y = 7.4;
        const back = new THREE.Mesh(new THREE.BoxGeometry(14.6, 5.4, 0.4), M.dark);
        back.position.set(0, 7.4, -0.25);
        board.add(panel, back);
        for (const px of [-5.5, 5.5]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 5, 8), M.steel);
          post.position.set(px, 2.5, -0.25);
          board.add(post);
        }
        const by = place(board, bx, bz, Math.atan2(-sB.tan.x, -sB.tan.z) + side * 0.35, 0, 0);
        for (const px of [-5.5, 5.5]) {
          const c = Math.cos(board.rotation.y), s = Math.sin(board.rotation.y);
          circle(bx + c * px, bz - s * px, 0.5, by - 1, by + 10);
        }
      }
      let state = 'pad', st = 0, v = 0, next = LAUNCH.first, lastRt = -1;
      const resetRocket = () => {
        R.position.set(0, 3, 0);
        R.rotation.set(0, 0, 0);
        R.visible = true;
        flame.visible = false;
        v = 0;
      };
      const wp = new THREE.Vector3();
      animators.push((t, dt) => {
        dt = Math.min(0.05, dt || 1 / 60);
        const g = window.game;
        const racing = g && g.race && g.race.phase === 'racing';
        const rt = racing ? g.race.time : null;
        if (rt != null && rt < lastRt - 1) {
          // 다시 시작: 처음부터
          state = 'pad';
          next = LAUNCH.first;
          resetRocket();
        }
        if (rt != null) lastRt = rt;
        beacon.material.color.set(Math.sin(t * 4) > 0 ? '#ff3b30' : '#3a0d0a');
        if (state === 'pad' && rt != null && rt >= next - LAUNCH.count) state = 'count';
        if (state === 'count') {
          const left = rt != null ? next - rt : 0;
          drawBoard(left > 0 ? `T-${String(Math.ceil(left)).padStart(2, '0')}` : '발사!', left > 0 ? `발사 카운트다운 — ${side > 0 ? '오른쪽' : '왼쪽'} 하늘을 보세요` : 'LIFTOFF', left > 3 ? '#ffcf3f' : '#ff6a3c');
          flame.visible = left < 2.5;
          if (flame.visible) flame.scale.setScalar(0.25 + 0.1 * Math.sin(t * 40));
          if (left <= 0) {
            state = 'lift';
            st = 0;
            v = 0;
            window.dispatchEvent(new CustomEvent('moonlaunch', { detail: { side } }));
            for (const p of puffs) (p.m.visible = true), (p.life = 0);
          }
        } else if (state === 'lift') {
          st += dt;
          v += (3 + st * 0.9) * dt;
          R.position.y += v * dt;
          R.rotation.z = Math.min(0.45, Math.max(0, st - 7) * 0.025) * side;
          R.position.x += Math.sin(R.rotation.z) * -v * dt;
          const fl = 0.9 + 0.15 * Math.sin(t * 37) + 0.1 * Math.sin(t * 23);
          flame.scale.set(fl, fl * (1 + Math.min(1, st * 0.3)), fl);
          drawBoard('발사!', `고도 ${Math.round(R.position.y)} m · ${Math.round(v * 3.6)} km/h`, '#ff6a3c');
          tEmit += dt;
          if (tEmit > 0.07) {
            tEmit = 0;
            R.getWorldPosition(wp);
            const i = tHead;
            tHead = (tHead + 1) % TN;
            tPos[i * 3] = wp.x;
            tPos[i * 3 + 1] = wp.y - 6;
            tPos[i * 3 + 2] = wp.z;
            tAge[i] = 0;
          }
          if (st > LAUNCH.flight) {
            state = 'gone';
            R.visible = false;
            flame.visible = false;
          }
        } else if (state === 'gone') {
          const left = rt != null ? next + LAUNCH.every - rt : 99;
          drawBoard('발사 성공', `다음 발사까지 ${Math.max(0, Math.ceil(left))}초`, '#5ff0ff');
          // 다음 로켓을 세움 (발사 25초 전)
          if (rt != null && left < 25) {
            next += LAUNCH.every;
            state = 'pad';
            resetRocket();
          }
        } else if (state === 'pad' && rt != null) {
          drawBoard(`T-${Math.max(0, Math.ceil(next - rt))}`, '다음 로켓 발사까지 (초)', '#5ff0ff');
        }
        // 먼지 구름
        for (const p of puffs) {
          if (!p.m.visible) continue;
          p.life += dt;
          const r = 6 + p.life * p.sp;
          p.m.position.set(Math.cos(p.a) * r, 3 + p.life * 1.4, Math.sin(p.a) * r);
          p.m.scale.setScalar(3 + p.life * 3.2);
          if (p.life > 7) p.m.visible = false;
        }
        // 꼬리 빛
        let any = false;
        for (let i = 0; i < TN; i++) {
          if (tAge[i] > 6) continue;
          any = true;
          tAge[i] += dt;
          const k = Math.max(0, 1 - tAge[i] / 6);
          tCol[i * 3] = k;
          tCol[i * 3 + 1] = k * (0.45 + 0.4 * k);
          tCol[i * 3 + 2] = k * (0.25 + 0.5 * (1 - k));
          if (tAge[i] > 6) tPos[i * 3 + 1] = -9999;
        }
        if (any) {
          tGeo.attributes.position.needsUpdate = true;
          tGeo.attributes.color.needsUpdate = true;
        }
      });
      extraStats.launchPad = { x: Math.round(sp.x), z: Math.round(sp.z), side };
    }
  }

  // ---------------------------------------------------------------- 송전탑 줄 (4차): 마지막 긴 직선·고속 굽이 옆이 텅 비어 보여서, 기지로 전기를 보내는 철탑과 전선
  //   코스 마지막 30%에서 곧은 구간 옆 45~60 m에 70 m 간격. 꼭대기 빨간 불이 깜빡임. 인스턴스 2개 + 선 1개 + 점 1개
  {
    const NS = track.samples.length - 1;
    const S = (i) => track.samples[((i % NS) + NS) % NS];
    const step = Math.max(1, Math.round(70 / (track.length / NS)));
    const spots = [];
    let side = 1;
    for (let i = Math.round(NS * 0.78); i < NS - Math.round(60 / (track.length / NS)); i += step) {
      const s = S(i);
      if (s.gap || s.roll || s.magnet) continue;
      let put = null;
      for (const sd of [side, -side])
        for (const off of [48, 58]) {
          if (put) break;
          const x = s.pos.x + s.right.x * sd * off, z = s.pos.z + s.right.z * sd * off;
          if (roadDist(x, z) < 40 || !free(x, z, 4) || ground(x, z) < s.pos.y - 8) continue;
          put = { x, z, y: ground(x, z), yaw: Math.atan2(s.tan.x, s.tan.z) };
        }
      if (!put) {
        if (spots.length) spots.push(null); // 줄 끊김
        continue;
      }
      occupy(put.x, put.z, 4);
      circle(put.x, put.z, 1.6, put.y - 1, put.y + 30);
      spots.push(put);
    }
    const towers = spots.filter(Boolean);
    if (towers.length >= 3) {
      const legGeo = new THREE.CylinderGeometry(0.5, 1.9, 28, 4, 1, true);
      const armGeo = new THREE.BoxGeometry(9, 0.6, 0.6);
      const steel = new THREE.MeshStandardMaterial({ color: '#d4d8df', roughness: 0.6, metalness: 0.2, emissive: '#4a4f58', side: THREE.DoubleSide });
      const legs = new THREE.InstancedMesh(legGeo, steel, towers.length);
      const arms = new THREE.InstancedMesh(armGeo, steel, towers.length * 2);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      const tips = new Float32Array(towers.length * 3);
      towers.forEach((t, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw + Math.PI / 4);
        legs.setMatrixAt(k, mtx.compose(p.set(t.x, t.y + 14 - 0.3, t.z), q, one));
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw + Math.PI / 2);
        arms.setMatrixAt(k * 2, mtx.compose(p.set(t.x, t.y + 24, t.z), q, one));
        arms.setMatrixAt(k * 2 + 1, mtx.compose(p.set(t.x, t.y + 20, t.z), q, new THREE.Vector3(0.75, 1, 1)));
        tips[k * 3] = t.x;
        tips[k * 3 + 1] = t.y + 28.6;
        tips[k * 3 + 2] = t.z;
      });
      legs.castShadow = arms.castShadow = true;
      group.add(legs, arms);
      // 전선: 이웃한 탑 사이에 처진 줄 3가닥 (팔 양끝 + 가운데)
      const seg = [];
      for (let k = 0; k + 1 < spots.length; k++) {
        const a = spots[k], b = spots[k + 1];
        if (!a || !b) continue;
        const ra = new THREE.Vector3(Math.cos(a.yaw), 0, -Math.sin(a.yaw)), rb = new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw));
        for (const [off, h] of [[-4.3, 24], [4.3, 24], [0, 20]]) {
          const A = new THREE.Vector3(a.x + ra.x * off, a.y + h - 0.4, a.z + ra.z * off), B = new THREE.Vector3(b.x + rb.x * off, b.y + h - 0.4, b.z + rb.z * off);
          const n = 10, sag = A.distanceTo(B) * 0.045;
          for (let u = 0; u < n; u++) {
            const u0 = u / n, u1 = (u + 1) / n;
            const P0 = A.clone().lerp(B, u0), P1 = A.clone().lerp(B, u1);
            P0.y -= sag * 4 * u0 * (1 - u0);
            P1.y -= sag * 4 * u1 * (1 - u1);
            seg.push(P0.x, P0.y, P0.z, P1.x, P1.y, P1.z);
          }
        }
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      group.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: '#3c4048' })));
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(tips, 3));
      const tipMat = new THREE.PointsMaterial({ color: '#ff3b30', map: moteTex, size: 3.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const tipPts = new THREE.Points(tg, tipMat);
      tipPts.frustumCulled = false;
      group.add(tipPts);
      animators.push((t) => {
        tipMat.opacity = Math.sin(t * 3) > 0 ? 1 : 0.15;
      });
    }
    extraStats.pylons = towers.length;
  }

  // ---------------------------------------------------------------- 차와 충돌
  function collideCar(car) {
    stamp++;
    const cx0 = Math.floor((car.pos.x - CAR_R) / CELL), cx1 = Math.floor((car.pos.x + CAR_R) / CELL);
    const cz0 = Math.floor((car.pos.z - CAR_R) / CELL), cz1 = Math.floor((car.pos.z + CAR_R) / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = grid.get(`${cx},${cz}`);
        if (!list) continue;
        for (const c of list) {
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (car.pos.y > c.y1 || car.pos.y < c.y0 - 1.5) continue;
          const dx = car.pos.x - c.x, dz = car.pos.z - c.z;
          const d = Math.hypot(dx, dz), min = c.r + CAR_R;
          if (d < min && d > 1e-4) car.applyPush(tmpV.set(dx / d, 0, dz / d), min - d);
        }
      }
  }

  const buildMs = Math.round(performance.now() - t0);
  return {
    colliders: allColliders,
    collideCar,
    /** 다른 파일(gpCorners.js 코너 표시판)이 단단한 기둥을 더할 때: (x, z, 반지름, 아래 y, 위 y) */
    addCollider: circle,
    collidersNear(x, z, r = 4) {
      return allColliders.filter((c) => Math.hypot(c.x - x, c.z - z) < r + c.r);
    },
    animate(time, dt, car) {
      for (const a of animators) a(time, dt, car);
    },
    sky,
    domes,
    stats: Object.assign(extraStats, { colliders: allColliders.length, occupied: occupied.length, buildMs }),
    launch: LAUNCH,
  };
}
