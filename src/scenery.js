// 풍경: 하늘, 산맥, 구름, 구역별 테마(도시·숲·바위·화산·농장 / 바닷가: 해변·바다·절벽·마을), 호수.
// 건물, 나무, 바위 같은 고정 물체는 충돌체를 가지고 있어 차가 통과하지 못합니다.
//
// 구역은 data/track.json의 "scenery"로 정합니다: { theme, t0, t1 }
import * as THREE from 'three';
import { seededRandom, canvasTexture } from './track.js';
import { buildGrandPrixScenery } from './gpScenery.js';

const CAR_R = 1.3; // 차의 충돌 반지름 (위에서 본 크기)
const CELL = 24; // 충돌체 격자 크기

export function buildScenery(track, scene) {
  if (track.grandprix) return buildGrandPrixScenery(track, scene); // 구름섬 그랑프리 풍경 (gpScenery.js)
  const rand = seededRandom(20261105);
  const R = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const W = track.width;
  const group = new THREE.Group();
  scene.add(group);
  const animators = []; // (time, dt, car) => void

  // ---------------------------------------------------------------- 충돌체
  const grid = new Map();
  let stamp = 0;
  function addCollider(c) {
    c.stamp = 0;
    const ext = c.type === 'circle' ? c.r : Math.hypot(c.hx, c.hz);
    for (let cx = Math.floor((c.x - ext) / CELL); cx <= Math.floor((c.x + ext) / CELL); cx++)
      for (let cz = Math.floor((c.z - ext) / CELL); cz <= Math.floor((c.z + ext) / CELL); cz++) {
        const k = `${cx},${cz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
  }
  const circle = (x, z, r, h) => addCollider({ type: 'circle', x, z, r, h });
  const box = (x, z, hx, hz, yaw, h) => addCollider({ type: 'box', x, z, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw), h });

  // 겹치지 않게 자리 잡기
  const occupied = [];
  const free = (x, z, r) => occupied.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r);
  const occupy = (x, z, r) => occupied.push({ x, z, r });

  // 코스 안쪽(인필드) 판정
  const poly = track.outline;
  function inside(x, z) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  }
  const tmpV = new THREE.Vector3();
  // 테스트 맵: 격납고와 관제탑 자리 (시험장 양 끝)
  const arenaReserve = track.arena ? [[-350, 0, 70], [350, 0, 75]] : [];
  const inArenaReserve = (x, z, r) => arenaReserve.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar + r);
  /** 도로, 지름길에서 충분히 떨어졌는지 */
  function clear(x, z, r, margin = 6) {
    tmpV.set(x, 0, z);
    if (track.nearestRaw(tmpV) < W / 2 + 6 + margin + r) return false; // 자석 벽(도로 끝+6m)보다 바깥
    if (track.shortcut && track.shortcutDist(tmpV) < track.shortcut.width / 2 + margin + r) return false;
    if (track.arena && (inside(x, z) || track.inPad(x, z, margin + r + 4) || inArenaReserve(x, z, r + margin))) return false; // 시험장(주회로 안쪽 전체)은 비워 둠
    if (track.sea && track.inSea(x, z, r + 2)) return false; // 바다에는 아무것도 두지 않음
    return true;
  }

  // 구역에서 자리 찾기. side: 'out'(코스 바깥) | 'in'(인필드) | 'any'
  const zones = track.data.scenery || [];
  function inZone(t, z) {
    return z.t0 <= z.t1 ? t >= z.t0 && t < z.t1 : t >= z.t0 || t < z.t1;
  }
  function spot(zone, dMin, dMax, r, side = 'any', margin = 6) {
    for (let tries = 0; tries < 40; tries++) {
      const span = (zone.t1 - zone.t0 + 1) % 1 || 1;
      const t = (zone.t0 + rand() * span) % 1;
      const s = track.sampleAt(t);
      const sgn = rand() < 0.5 ? -1 : 1;
      const d = dMin + (dMax - dMin) * Math.pow(rand(), 1.7); // 도로 가까이 더 촘촘하게
      const x = s.pos.x + s.right.x * sgn * d, z = s.pos.z + s.right.z * sgn * d;
      const isIn = inside(x, z);
      if ((side === 'out' && isIn) || (side === 'in' && !isIn)) continue;
      if (!clear(x, z, r, margin) || !free(x, z, r)) continue;
      // 가장 가까운 코스 지점이 이 구역인지 (다른 테마 구역에 섞이지 않게)
      const n = track.nearest(tmpV.set(x, 0, z));
      if (!inZone(n.t, zone)) continue;
      return { x, z, yaw: Math.atan2(n.sample.tan.x, n.sample.tan.z), t: n.t };
    }
    return null;
  }

  // ---------------------------------------------------------------- 공용 재료
  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const mesh = (geo, mat, x, y, z, parent = group, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // 인스턴스 묶음: 같은 모양을 수백 개 그릴 때
  function instanced(geo, mat, list, shadow = true) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((it, i) => {
      q.setFromEuler(e.set(it.rx || 0, it.ry || 0, it.rz || 0));
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.s));
      im.setMatrixAt(i, m4);
      if (it.color) im.setColorAt(i, new THREE.Color(it.color));
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    group.add(im);
    return im;
  }

  // 나무와 바위 목록 (마지막에 한꺼번에 인스턴스로)
  const pines = [], rounds = [], deads = [], rocks = [], bushes = [];
  function addPine(x, z, s, dark = false) {
    pines.push({ x, z, s, color: dark ? '#24563a' : pick(['#2f7a3a', '#2a6e35', '#3a8a40', '#2d7444']) });
    circle(x, z, 0.6 * s, 12 * s);
  }
  function addRound(x, z, s, autumn = false) {
    rounds.push({ x, z, s, color: autumn ? pick(['#d9822b', '#c8552e', '#e3b23c']) : pick(['#4f9a3a', '#5fae45', '#46883a']) });
    circle(x, z, 0.6 * s, 10 * s);
  }
  const palms = [];
  function addPalm(x, z, s) {
    palms.push({ x, z, s, ry: R(0, Math.PI * 2), rz: R(-0.06, 0.12), color: pick(['#3f9a3a', '#4aa83f', '#358a35', '#5bb346']) });
    circle(x, z, 0.45 * s, 9 * s);
  }
  function addRock(x, z, s, color) {
    rocks.push({ x, z, y: s * 0.35, s, sx: s * R(0.9, 1.6), sy: s * R(0.6, 1.1), sz: s * R(0.9, 1.5), ry: R(0, 6.3), rx: R(-0.3, 0.3), color });
    circle(x, z, s * 1.1, s * 1.2);
  }

  // ---------------------------------------------------------------- 하늘, 산, 구름
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color('#3f86d6') }, horizon: { value: new THREE.Color('#cfe7fb') }, ground: { value: new THREE.Color(track.sea ? '#bcd8ec' : '#9fbf8a') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, ground, min(1.0, -h * 4.0));
        gl_FragColor = vec4(c, 1.0); }`,
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);
  animators.push((t, dt, car) => sky.position.copy(car.pos).setY(0));

  // 태양 원반
  const sunTex = canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,240,1)');
    grd.addColorStop(0.25, 'rgba(255,245,200,0.9)');
    grd.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true }));
  sunSprite.scale.setScalar(260);
  scene.add(sunSprite);
  animators.push((t, dt, car) => sunSprite.position.copy(car.pos).add(new THREE.Vector3(600, 1100, 400).normalize().multiplyScalar(2000)));

  // 코스 중심
  const center = new THREE.Vector3();
  for (const [x, z] of poly) center.x += x / poly.length, center.z += z / poly.length;

  // 멀리 둘러싼 산맥 (눈 덮인 봉우리)
  const peaks = [], snows = [];
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + R(-0.05, 0.05);
    const dist = R(820, 1080);
    const h = R(120, 300), r = R(160, 280);
    const x = center.x + Math.cos(a) * dist, z = center.z + Math.sin(a) * dist;
    if (track.sea && track.inSea(x, z, r * 0.5)) {
      // 바다 쪽 수평선은 비워 두고, 가끔 먼 섬
      if (rand() < 0.3) peaks.push({ x, y: h * 0.12, z, s: 1, sx: r * 0.6, sy: h * 0.25, sz: r * 0.5, ry: R(0, 6), color: pick(['#5f8a5a', '#6f9466']) });
      continue;
    }
    peaks.push({ x, y: h / 2, z, s: 1, sx: r, sy: h, sz: r * R(0.8, 1.2), ry: R(0, 6), color: pick(['#6f8a78', '#7a8c80', '#66806e', '#8a9488']) });
    if (h > 170) snows.push({ x, y: h * 0.86, z, s: 1, sx: r * 0.29, sy: h * 0.28, sz: r * 0.29, ry: R(0, 6) });
  }
  instanced(new THREE.ConeGeometry(1, 1, 7), lambert('#ffffff'), peaks, false);
  instanced(new THREE.ConeGeometry(1, 1, 7), lambert('#f4f7fb'), snows, false);

  // 구름
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#5a6a7a', emissiveIntensity: 0.25 });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const clouds = [];
  for (let i = 0; i < 32; i++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(R(0, 4));
    for (let k = 0; k < n; k++) {
      const p = mesh(cloudGeo, cloudMat, R(-22, 22), R(-3, 5), R(-10, 10), c, false);
      p.scale.set(R(10, 18), R(7, 11), R(9, 14));
    }
    c.position.set(center.x + R(-1100, 1100), R(120, 220), center.z + R(-1100, 1100));
    c.userData.speed = R(2, 5);
    group.add(c);
    clouds.push(c);
  }
  animators.push((t, dt) => {
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > center.x + 1200) c.position.x = center.x - 1200;
    }
  });

  // ---------------------------------------------------------------- 텍스처
  // 창문 4×4칸 (한 칸 = 4m)
  const windowTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    const c = w / 4;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(i * c, j * c + c * 0.84, c, c * 0.16);
        g.fillStyle = rand() < 0.22 ? '#ffe9a8' : rand() < 0.5 ? '#4d6f8f' : '#5b80a3';
        g.fillRect(i * c + c * 0.16, j * c + c * 0.18, c * 0.68, c * 0.52);
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.fillRect(i * c + c * 0.16, j * c + c * 0.18, c * 0.2, c * 0.52);
      }
  });
  const roofTex = canvasTexture(32, 32, (g, w, h) => {
    g.fillStyle = '#8a8d93';
    g.fillRect(0, 0, w, h);
  });
  const plankTex = canvasTexture(64, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#9c6b3f' : '#8a5c34';
      g.fillRect(0, (i * h) / 8, w, h / 8);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, ((i + 1) * h) / 8 - 1, w, 1);
    }
  });
  const barnTex = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#b23a2e';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 8; i++) g.fillRect((i * w) / 8, 0, 1.5, h);
  });
  const houseTex = (wall) =>
    canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = wall;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#5d7fa3';
      g.fillRect(w * 0.25, h * 0.25, w * 0.5, h * 0.4);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3;
      g.strokeRect(w * 0.25, h * 0.25, w * 0.5, h * 0.4);
    });

  /** 상자의 옆면에 창문 텍스처가 크기에 맞게 반복되도록 UV 조정 */
  function tiledBox(w, h, d, tile = 16) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      if (f === 2 || f === 3) continue; // 지붕, 바닥
      const fw = f < 2 ? d : w;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * Math.max(0.25, Math.round((fw / tile) * 4) / 4), uv.getY(i) * Math.max(0.25, Math.round((h / tile) * 4) / 4));
      }
    }
    return geo;
  }
  function gableRoof(w, d, rh, mat) {
    const s = new THREE.Shape();
    s.moveTo(-d / 2 - 0.5, 0);
    s.lineTo(d / 2 + 0.5, 0);
    s.lineTo(0, rh);
    const geo = new THREE.ExtrudeGeometry(s, { depth: w + 0.8, bevelEnabled: false }).translate(0, 0, -(w + 0.8) / 2).rotateY(Math.PI / 2);
    return new THREE.Mesh(geo, mat);
  }

  // ---------------------------------------------------------------- 도시 / 경기장
  const cityWallMats = ['#e9e6df', '#cfd8e3', '#e6d3b8', '#c9d6c4', '#d8c4c4'].map((c) => {
    const m = std(c, { map: windowTex });
    return [m, m, std('#7d8088', { map: roofTex }), m, m, m];
  });
  function building(x, z, yaw, w, d, h) {
    const mats = pick(cityWallMats);
    const geo = tiledBox(w, h, d);
    const b = new THREE.Mesh(geo, [mats[0], mats[1], mats[2], mats[2], mats[4], mats[5]]);
    b.position.set(x, h / 2, z);
    b.rotation.y = yaw;
    b.castShadow = b.receiveShadow = true;
    group.add(b);
    // 옥상 장비
    for (let k = 0; k < 1 + Math.floor(R(0, 3)); k++) {
      const u = mesh(new THREE.BoxGeometry(R(2, 4), R(1.2, 2.5), R(2, 4)), std('#9aa0a8'), 0, 0, 0, b);
      u.position.set(R(-w / 3, w / 3), h / 2 + 0.8, R(-d / 3, d / 3));
    }
    if (h > 45) {
      const ant = mesh(new THREE.CylinderGeometry(0.15, 0.25, 10, 5), std('#c03030'), 0, h / 2 + 5, 0, b);
      ant.castShadow = false;
    }
    box(x, z, w / 2, d / 2, yaw, h);
    occupy(x, z, Math.hypot(w, d) / 2);
  }

  function grandstand(t, length = 64) {
    const s = track.sampleAt(t);
    // 코스 바깥쪽 찾기 (인필드가 아닌 쪽)
    let outSign = inside(s.pos.x + s.right.x * 40, s.pos.z + s.right.z * 40) ? -1 : 1;
    // 바닷가: 바다 쪽이면 반대편(육지)에
    if (track.sea && track.inSea(s.pos.x + s.right.x * outSign * 34, s.pos.z + s.right.z * outSign * 34, 30)) outSign = -outSign;
    const depth = 13;
    const lat = W / 2 + 17 + depth / 2;
    const yaw = Math.atan2(s.tan.x, s.tan.z);
    const g = new THREE.Group();
    g.position.copy(s.pos).addScaledVector(s.right, outSign * lat);
    g.rotation.y = yaw;
    group.add(g);
    // 로컬 x축 = -right. a = 코스에서 멀어지는 로컬 x 방향
    const a = -outSign;
    const concrete = std('#b9bcc2');
    const seatColors = ['#2e6fd8', '#e8463a'];
    const crowd = [];
    for (let i = 0; i < 5; i++) {
      const x = a * (-depth / 2 + 1.3 + i * 2.6);
      const top = 1 + i * 1.3;
      mesh(new THREE.BoxGeometry(2.6, top, length), concrete, x, top / 2, 0, g);
      mesh(new THREE.BoxGeometry(2.4, 0.25, length - 1), std(seatColors[i % 2]), x, top + 0.12, 0, g, false);
      for (let k = 0; k < length - 3; k += 1.1) {
        if (rand() < 0.15) continue;
        crowd.push({ x: x + R(-0.3, 0.3), y: top + 0.7, z: -length / 2 + 1.5 + k, sx: 0.55, sy: 0.9, sz: 0.45, color: pick(['#ffcf3f', '#e8463a', '#2e6fd8', '#ffffff', '#5fd36b', '#ff8ad8', '#222']) });
      }
    }
    // 지붕과 기둥 (뒤쪽)
    const roofY = 1 + 5 * 1.3 + 4;
    mesh(new THREE.BoxGeometry(depth + 2, 0.4, length + 2), std('#e8463a'), 0, roofY, 0, g);
    for (const zz of [-length / 2, 0, length / 2]) mesh(new THREE.CylinderGeometry(0.3, 0.3, roofY, 6), std('#555a64'), a * depth / 2, roofY / 2, zz, g);
    // 관중 (인스턴스, 차가 가까우면 뛰어오름)
    const crowdIm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std('#ffffff'), crowd.length);
    const m4 = new THREE.Matrix4();
    crowd.forEach((c, i) => {
      m4.makeScale(c.sx, c.sy, c.sz).setPosition(c.x, c.y, c.z);
      crowdIm.setMatrixAt(i, m4);
      crowdIm.setColorAt(i, new THREE.Color(c.color));
    });
    crowdIm.castShadow = true;
    g.add(crowdIm);
    const wc = g.position.clone();
    box(wc.x, wc.z, depth / 2 + 1, length / 2 + 1, yaw, roofY);
    occupy(wc.x, wc.z, length / 2 + 4);
    let excite = 0;
    animators.push((time, dt, car) => {
      const near = car.pos.distanceTo(wc) < 80;
      excite = THREE.MathUtils.lerp(excite, near ? 1 : 0.06, 1 - Math.exp(-4 * dt));
      if (excite < 0.07 && !near) return;
      crowd.forEach((c, i) => {
        const jump = Math.max(0, Math.sin(time * 11 + i * 1.7)) * 0.5 * excite;
        m4.makeScale(c.sx, c.sy, c.sz).setPosition(c.x, c.y + jump, c.z);
        crowdIm.setMatrixAt(i, m4);
      });
      crowdIm.instanceMatrix.needsUpdate = true;
    });
  }

  const ads = [
    ['MAGNET ROAD', '#7a3cff', '#ffffff'],
    ['GIMMICK GP', '#e8463a', '#ffffff'],
    ['SPARK TIRES', '#111111', '#ffcf3f'],
    ['ZIP COLA', '#2e6fd8', '#ffffff'],
    ['Q 윙 · E 스파이크', '#0f7a4a', '#d9ffd0'],
    ['TURBO NOODLE', '#ff8a1f', '#ffffff'],
  ];
  function billboard(x, z, yaw, idx) {
    const [text, bg, fg] = ads[idx % ads.length];
    const tex = canvasTexture(512, 160, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = fg;
      g.lineWidth = 8;
      g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = fg;
      g.font = 'bold 62px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 4);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const face = std('#ffffff', { map: tex });
    const back = std('#3a3f4a');
    mesh(new THREE.BoxGeometry(14, 4.4, 0.4), [back, back, back, back, face, face], 0, 7, 0, g);
    for (const px of [-5, 5]) mesh(new THREE.CylinderGeometry(0.25, 0.3, 7, 6), std('#555a64'), px, 3.5, 0, g);
    const wx = Math.cos(yaw), wz = -Math.sin(yaw);
    for (const px of [-5, 5]) circle(x + wx * px, z + wz * px, 0.35, 9.5);
    occupy(x, z, 7.5);
  }

  // ---------------------------------------------------------------- 농장
  function house(x, z, yaw) {
    const w = R(8, 12), d = R(7, 10), h = R(4.5, 6.5);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const tex = houseTex(pick(['#f2e6d0', '#e8d7c3', '#dfe8ef', '#f5f0e6', '#e9dccf']));
    tex.repeat.set(Math.round(w / 4), 1);
    mesh(new THREE.BoxGeometry(w, h, d), std('#ffffff', { map: tex }), 0, h / 2, 0, g);
    const roof = gableRoof(w, d, R(3, 4.5), lambert(pick(['#b5523b', '#4b6f9e', '#5c7a3e', '#8a4a3a'])));
    roof.position.y = h;
    roof.castShadow = true;
    g.add(roof);
    mesh(new THREE.BoxGeometry(1, 2.5, 1), std('#a7a29a'), w / 4, h + 2, 0, g); // 굴뚝
    box(x, z, w / 2 + 0.3, d / 2 + 0.3, yaw, h + 4);
    occupy(x, z, Math.hypot(w, d) / 2 + 2);
  }
  function barn(x, z, yaw) {
    const w = 18, d = 12, h = 8;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const tex = barnTex.clone();
    tex.repeat.set(3, 1);
    tex.needsUpdate = true;
    mesh(new THREE.BoxGeometry(w, h, d), std('#ffffff', { map: tex }), 0, h / 2, 0, g);
    const roof = gableRoof(w, d, 5, lambert('#5a2a24'));
    roof.position.y = h;
    roof.castShadow = true;
    g.add(roof);
    mesh(new THREE.BoxGeometry(0.2, 5, 5), std('#f4f0e8'), w / 2 + 0.05, 2.5, 0, g);
    box(x, z, w / 2, d / 2, yaw, h + 5);
    occupy(x, z, 13);
  }
  function windmill(x, z, yaw) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    mesh(new THREE.CylinderGeometry(1.6, 3, 16, 8), lambert('#f2efe8'), 0, 8, 0, g);
    mesh(new THREE.ConeGeometry(2.2, 3, 8), lambert('#8a4a3a'), 0, 17.5, 0, g);
    const hub = new THREE.Group();
    hub.position.set(0, 15.5, 2.3);
    g.add(hub);
    mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 8).rotateX(Math.PI / 2), lambert('#555'), 0, 0, 0, hub);
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k * Math.PI) / 2;
      hub.add(arm);
      mesh(new THREE.BoxGeometry(1.4, 9, 0.12), lambert('#f7f3ea'), 0.4, 5, 0, arm);
      mesh(new THREE.BoxGeometry(0.2, 9.5, 0.2), lambert('#6b4a2e'), 0, 4.8, 0.05, arm);
    }
    const speed = R(0.6, 1.2);
    animators.push((t, dt) => (hub.rotation.z += speed * dt));
    circle(x, z, 3, 20);
    occupy(x, z, 7);
  }
  function waterTower(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    group.add(g);
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) mesh(new THREE.CylinderGeometry(0.25, 0.3, 12, 5), lambert('#6b4a2e'), lx, 6, lz, g);
    mesh(new THREE.CylinderGeometry(4, 4, 5, 12), lambert('#9fb4c4'), 0, 14.5, 0, g);
    mesh(new THREE.ConeGeometry(4.4, 2.5, 12), lambert('#6c7f8f'), 0, 18.2, 0, g);
    circle(x, z, 3.2, 20);
    occupy(x, z, 6);
  }
  const fieldTex = [
    ['#5f9e3e', '#4f8a33'],
    ['#d9b84a', '#c7a33b'],
    ['#8a6a45', '#76583a'],
    ['#7fb04c', '#6c9c40'],
  ].map(([a, b]) =>
    canvasTexture(32, 32, (g, w, h) => {
      g.fillStyle = a;
      g.fillRect(0, 0, w, h);
      g.fillStyle = b;
      g.fillRect(0, 0, w * 0.45, h);
    })
  );
  function field(x, z, yaw, fw, fl) {
    const tex = pick(fieldTex).clone();
    tex.needsUpdate = true;
    tex.repeat.set(fw / 2.5, 1);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(fw, fl), std('#ffffff', { map: tex, roughness: 1 }));
    f.rotation.set(-Math.PI / 2, 0, yaw, 'YXZ');
    f.position.set(x, 0.015, z);
    f.receiveShadow = true;
    group.add(f);
    occupy(x, z, Math.min(fw, fl) / 2);
  }
  function cabin(x, z, yaw) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const tex = plankTex.clone();
    tex.repeat.set(2, 1);
    tex.needsUpdate = true;
    mesh(new THREE.BoxGeometry(8, 4, 6), std('#ffffff', { map: tex }), 0, 2, 0, g);
    const roof = gableRoof(8, 6, 3, lambert('#4a3a2e'));
    roof.position.y = 4;
    roof.castShadow = true;
    g.add(roof);
    box(x, z, 4.3, 3.3, yaw, 7);
    occupy(x, z, 6);
  }

  // ---------------------------------------------------------------- 화산
  const lavaPoolMat = new THREE.MeshBasicMaterial({ color: '#ff7a1f' });
  const lavaGlowTex = canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,190,80,1)');
    grd.addColorStop(0.6, 'rgba(255,90,20,0.9)');
    grd.addColorStop(1, 'rgba(120,20,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  function lavaPool(x, z, r) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), lavaPoolMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.04, z);
    group.add(m);
    m.updateMatrixWorld();
    m.userData.surface = 'lava';
    track.groundMeshes.push(m); // 진짜 용암: 빠지면 복귀
    const glow = new THREE.Mesh(new THREE.CircleGeometry(r * 1.6, 20), new THREE.MeshBasicMaterial({ map: lavaGlowTex, transparent: true, opacity: 0.6, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, 0.03, z);
    group.add(glow);
    occupy(x, z, r + 2);
  }
  function scorch(x, z, r) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshLambertMaterial({ color: '#3b2e2a' }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.receiveShadow = true;
    group.add(m);
  }
  function volcano(x, z) {
    const h = 170;
    const geo = new THREE.CylinderGeometry(30, 190, h, 11, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // 울퉁불퉁하게
      const y = pos.getY(i);
      if (Math.abs(y) < h / 2 - 1) {
        pos.setX(i, pos.getX(i) * R(0.88, 1.1));
        pos.setZ(i, pos.getZ(i) * R(0.88, 1.1));
      }
    }
    geo.computeVertexNormals();
    mesh(geo, lambert('#4a3a35'), x, h / 2 - 2, z, group, false);
    // 분화구의 용암
    const crater = new THREE.Mesh(new THREE.CircleGeometry(27, 16), new THREE.MeshBasicMaterial({ color: '#ff6a1a', fog: false }));
    crater.rotation.x = -Math.PI / 2;
    crater.position.set(x, h - 2.5, z);
    group.add(crater);
    // 흘러내리는 용암 줄기
    for (let k = 0; k < 4; k++) {
      const a = R(0, Math.PI * 2);
      // 경사면 위에 눕히기: 면의 법선 = 바깥 위쪽 (원뿔 반지름 190→30, 높이 170)
      const stream = new THREE.Mesh(new THREE.PlaneGeometry(12, 150), new THREE.MeshBasicMaterial({ color: '#ff5a14', side: THREE.DoubleSide }));
      const rr = 190 - 160 * 0.45 + 8;
      const mid = new THREE.Vector3(Math.cos(a) * rr, h * 0.45 - 2, Math.sin(a) * rr);
      stream.position.set(x + mid.x, mid.y, z + mid.z);
      stream.lookAt(stream.position.x + Math.cos(a) * 170, stream.position.y + 160, stream.position.z + Math.sin(a) * 170);
      group.add(stream);
    }
    // 연기
    const smokeTex = canvasTexture(64, 64, (g, w, hh) => {
      const grd = g.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, w / 2);
      grd.addColorStop(0, 'rgba(90,85,85,0.9)');
      grd.addColorStop(1, 'rgba(90,85,85,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, hh);
    });
    const puffs = Array.from({ length: 26 }, (_, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false }));
      sp.userData.life = i / 26;
      group.add(sp);
      return sp;
    });
    animators.push((t, dt) => {
      for (const sp of puffs) {
        sp.userData.life = (sp.userData.life + dt * 0.06) % 1;
        const L = sp.userData.life;
        sp.position.set(x + Math.sin(L * 9 + sp.id) * 12 + L * 80, h + L * 220, z + Math.cos(L * 7 + sp.id) * 12);
        sp.scale.setScalar(30 + L * 140);
        sp.material.opacity = 0.75 * (1 - L);
      }
      crater.material.color.setHSL(0.06, 1, 0.5 + Math.sin(t * 2) * 0.06);
    });
    occupy(x, z, 200);
  }

  // ---------------------------------------------------------------- 운동장 (data/stadium.json)
  // 직선 600m(x -300~300, z ±150) + 반지름 150m 반원 기준으로 배치
  function stadiumScene() {
    const at = (x, z) => track.nearest(tmpV.set(x, 0, z)).t;
    // 관중석: 남·북 직선 전체와 동쪽 반원
    for (let x = -264; x <= 264; x += 66) {
      grandstand(at(x, -150), 62);
      grandstand(at(x, 150), 62);
    }
    for (let a = -75; a <= 75; a += 15) {
      const r = (a * Math.PI) / 180;
      grandstand(at(300 + 150 * Math.cos(r), 150 * Math.sin(r)), 44);
    }

    // 가운데 축구장 (잔디 줄무늬 + 흰 선) 105m x 68m
    const pitchTex = canvasTexture(1050, 680, (g, w, h) => {
      for (let i = 0; i < 14; i++) {
        g.fillStyle = i % 2 ? '#4f9a3c' : '#5aa845';
        g.fillRect((i * w) / 14, 0, w / 14 + 1, h);
      }
      g.strokeStyle = '#f4f4f4';
      g.lineWidth = 6;
      g.strokeRect(20, 20, w - 40, h - 40);
      g.beginPath();
      g.moveTo(w / 2, 20);
      g.lineTo(w / 2, h - 20);
      g.stroke();
      g.beginPath();
      g.arc(w / 2, h / 2, 91, 0, Math.PI * 2);
      g.stroke();
      for (const sx of [20, w - 20]) {
        const dir = sx < w / 2 ? 1 : -1;
        g.strokeRect(Math.min(sx, sx + dir * 165), h / 2 - 201, 165, 402); // 페널티 박스
        g.strokeRect(Math.min(sx, sx + dir * 55), h / 2 - 92, 55, 184); // 골 에어리어
        g.beginPath();
        g.arc(sx + dir * 110, h / 2, 91, dir > 0 ? -0.93 : Math.PI - 0.93, dir > 0 ? 0.93 : Math.PI + 0.93);
        g.stroke();
      }
    });
    pitchTex.wrapS = pitchTex.wrapT = THREE.ClampToEdgeWrapping;
    const pitch = mesh(new THREE.PlaneGeometry(110, 72), std('#ffffff', { map: pitchTex, roughness: 1 }), 0, 0.02, 0, group, false);
    pitch.rotation.x = -Math.PI / 2;
    // 골대 (기둥은 부딪힘)
    const white = std('#f4f4f4');
    for (const gx of [-52.5, 52.5]) {
      const goal = new THREE.Group();
      goal.position.set(gx, 0, 0);
      group.add(goal);
      for (const gz of [-3.66, 3.66]) {
        mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.44, 8), white, 0, 1.22, gz, goal);
        circle(gx, gz, 0.2, 2.44);
      }
      mesh(new THREE.BoxGeometry(0.24, 0.24, 7.56), white, 0, 2.44, 0, goal);
      const net = mesh(new THREE.BoxGeometry(2, 2.44, 7.32), std('#ffffff', { transparent: true, opacity: 0.35 }), Math.sign(gx) * 1, 1.22, 0, goal, false);
      net.material.depthWrite = false;
    }
    // 코너 깃발
    for (const fx of [-52.5, 52.5]) for (const fz of [-34, 34]) {
      mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5), white, fx, 0.8, fz, group, false);
      mesh(new THREE.PlaneGeometry(0.5, 0.35), std('#ffcf3f', { side: THREE.DoubleSide }), fx + 0.25, 1.4, fz, group, false);
    }
    // 서쪽 인필드: 멀리뛰기 모래판, 벤치
    const sand = mesh(new THREE.PlaneGeometry(9, 40), std('#e6cf91', { roughness: 1 }), -180, 0.025, 60, group, false);
    sand.rotation.x = -Math.PI / 2;
    for (const bz of [-46, 46]) {
      mesh(new THREE.BoxGeometry(14, 2.2, 2), std('#3a6fd0', { transparent: true, opacity: 0.8 }), 0, 1.1, bz, group);
      box(0, bz, 7, 1, 0, 2.2);
    }

    // 조명탑 (관중석 뒤, 꼭대기 조명이 빛남)
    const lampMat = new THREE.MeshBasicMaterial({ color: '#fffbe6' });
    const poleMat = std('#6c727e', { metalness: 0.5, roughness: 0.4 });
    const towers = [[0, -215], [0, 215], [-215, -215], [215, -215], [-215, 215], [215, 215], [300 + 215 * Math.cos(0.6), 215 * Math.sin(0.6)], [300 + 215 * Math.cos(-0.6), 215 * Math.sin(-0.6)]];
    for (const [tx, tz] of towers) {
      const g = new THREE.Group();
      g.position.set(tx, 0, tz);
      g.rotation.y = Math.atan2(-tx * 0.3, -tz); // 대충 경기장 가운데를 봄
      group.add(g);
      mesh(new THREE.CylinderGeometry(0.8, 1.4, 46, 8), poleMat, 0, 23, 0, g);
      mesh(new THREE.BoxGeometry(12, 6, 1), std('#2b2f3a'), 0, 47, 0, g);
      for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) mesh(new THREE.BoxGeometry(2.4, 2.2, 0.3), lampMat, -4.2 + i * 2.8, 45.6 + k * 2.8, 0.6, g, false);
      circle(tx, tz, 1.6, 50);
      occupy(tx, tz, 8);
    }

    // 서쪽 끝 전광판 (반원 너머, 경기장 쪽을 봄)
    const boardTex = canvasTexture(1024, 384, (g, w, h) => {
      g.fillStyle = '#0d1220';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffcf3f';
      g.font = 'bold 120px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('GIMMICK', w / 2, h * 0.32);
      g.fillStyle = '#7fe7ff';
      g.fillText('STADIUM', w / 2, h * 0.7);
    });
    boardTex.wrapS = boardTex.wrapT = THREE.ClampToEdgeWrapping;
    const board = new THREE.Group();
    board.position.set(-520, 0, 0);
    board.rotation.y = Math.PI / 2; // 앞면이 +x(경기장 쪽)
    group.add(board);
    const frame = std('#2b2f3a');
    mesh(new THREE.BoxGeometry(56, 21, 2), [frame, frame, frame, frame, new THREE.MeshBasicMaterial({ map: boardTex }), frame], 0, 22, 0, board);
    for (const px of [-18, 18]) mesh(new THREE.BoxGeometry(2, 12, 2), frame, px, 6, 0, board);
    box(-520, 0, 2, 28, 0, 32);
    occupy(-520, 0, 32);

    // 경기장 둘레 나무
    for (let i = 0; i < 260; i++) {
      const a = rand() * Math.PI * 2;
      const rx = 560 + R(0, 260), rz = 290 + R(0, 240);
      const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
      if (!free(x, z, 3) || !clear(x, z, 3)) continue;
      addRound(x, z, R(1.2, 2.2), rand() < 0.15);
    }
  }

  // ---------------------------------------------------------------- 바닷가 (data/sea.json)
  // 야자수, 파라솔, 수건, 알록달록한 마을, 부두와 배, 등대섬, 바다 안내판
  const sea = track.sea;
  const umbrellas = [], towels = [];
  const pastel = ['#f7a8a8', '#ffd27f', '#9fd8e8', '#b5e3a1', '#f7f1e3', '#c9b3e6', '#ffb88c', '#8fd3c1'];
  const beachColors = ['#e8463a', '#2e6fd8', '#ffcf3f', '#1d9a6c', '#ff8ad8', '#ff8a1f'];
  const townWallMats = pastel.map((c) => std(c, { map: windowTex }));
  const flatRoofMat = std('#ece6da');
  const tileRoofMats = ['#c4573a', '#b5523b', '#3f6fa8', '#d07a3a'].map((c) => lambert(c));
  const stripeTex = (c) =>
    canvasTexture(64, 16, (g, w, h) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : c;
        g.fillRect((i * w) / 8, 0, w / 8 + 1, h);
      }
    });
  const awningMats = ['#e8463a', '#2e6fd8', '#1d9a6c', '#ff8a1f'].map((c) => std('#ffffff', { map: stripeTex(c), side: THREE.DoubleSide }));

  /** 바닷가 마을의 낮은 집 (1~3층, 파스텔 벽, 도로 쪽에 줄무늬 차양) */
  function townHouse(x, z, yaw) {
    const w = R(8, 13), d = R(8, 12), floors = 1 + Math.floor(R(0, 3)), h = floors * 3.6 + 0.4;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const wall = pick(townWallMats);
    mesh(tiledBox(w, h, d, 14), [wall, wall, flatRoofMat, flatRoofMat, wall, wall], 0, h / 2, 0, g);
    if (rand() < 0.55) {
      const roof = gableRoof(w, d, R(2, 3.2), pick(tileRoofMats));
      roof.position.y = h;
      roof.castShadow = true;
      g.add(roof);
    } else {
      mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), flatRoofMat, 0, h + 0.25, 0, g);
      if (rand() < 0.5) mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 10), std('#9fb4c4'), R(-w / 4, w / 4), h + 1.3, R(-d / 4, d / 4), g);
    }
    // 도로 쪽 (로컬 x축 = 월드 (cos, -sin))
    const n = track.nearest(tmpV.set(x, 0, z));
    const side = Math.sign((n.sample.pos.x - x) * Math.cos(yaw) - (n.sample.pos.z - z) * Math.sin(yaw)) || 1;
    mesh(new THREE.BoxGeometry(0.1, 2.3, 1.4), std('#6a4a32'), side * (w / 2 + 0.05), 1.15, 0, g);
    if (rand() < 0.65) {
      const aw = mesh(new THREE.BoxGeometry(1.8, 0.08, d * 0.8), pick(awningMats), side * (w / 2 + 0.85), 3.1, 0, g);
      aw.rotation.z = side * 0.28;
    }
    box(x, z, w / 2 + 0.3, d / 2 + 0.3, yaw, h + 3.5);
    occupy(x, z, Math.hypot(w, d) / 2 + 1.5);
  }

  /** 해변 매점 */
  function snackBar(x, z, yaw) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const tex = plankTex.clone();
    tex.repeat.set(2, 1);
    tex.needsUpdate = true;
    mesh(new THREE.BoxGeometry(6, 2.8, 4.5), std(pick(pastel), { map: tex }), 0, 1.4, 0, g);
    mesh(new THREE.BoxGeometry(7.4, 0.25, 6), pick(awningMats), 0, 3.0, 0, g);
    mesh(new THREE.BoxGeometry(6.2, 1.1, 0.4), std('#f4f1ea'), 0, 1.0, 2.5, g); // 계산대
    box(x, z, 3.7, 3, yaw, 3.2);
    occupy(x, z, 5.5);
  }

  /** 해변 구조대 망루 */
  function lifeguard(x, z, yaw) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const white = std('#f4f4f4');
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 5), white, lx, 1.3, lz, g);
    mesh(new THREE.BoxGeometry(2.6, 0.2, 2.6), std('#c8a27a'), 0, 2.6, 0, g);
    mesh(new THREE.BoxGeometry(1.9, 1.5, 1.9), std('#e8463a'), 0, 3.45, -0.2, g);
    mesh(new THREE.BoxGeometry(2.6, 0.15, 2.6), white, 0, 4.3, -0.1, g);
    mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 4), white, 1.1, 5.2, 1.1, g, false);
    mesh(new THREE.PlaneGeometry(0.9, 0.6), std('#ffcf3f', { side: THREE.DoubleSide }), 1.55, 5.8, 1.1, g, false);
    circle(x, z, 1.5, 4.5);
    occupy(x, z, 3.5);
  }

  // 배 (작은 보트, sail이면 돛단배). 물 위에서 둥실둥실
  const hullGeo = new THREE.CylinderGeometry(0.7, 1.1, 5.4, 10).rotateX(Math.PI / 2).scale(1, 0.55, 1);
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.0, 0.3, 0, 7.8, 0.3, 0, 1.0, -2.6], 3));
  sailGeo.computeVertexNormals();
  function boat(x, z, yaw, sail) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    mesh(hullGeo, std(pick(['#ffffff', '#2e6fd8', '#e8463a', '#f2c230', '#1d8a6a'])), 0, 0.25, 0, g);
    if (sail) {
      mesh(new THREE.CylinderGeometry(0.08, 0.1, 7.5, 5), std('#dddddd'), 0, 4.3, 0.4, g);
      mesh(sailGeo, std('#fbfbf5', { side: THREE.DoubleSide }), 0.05, 0, 0, g);
    } else {
      mesh(new THREE.BoxGeometry(1.4, 0.9, 1.6), std('#f4f4f4'), 0, 1.0, -0.4, g);
    }
    const ph = R(0, 6.3);
    animators.push((t) => {
      g.position.y = Math.sin(t * 1.3 + ph) * 0.12;
      g.rotation.z = Math.sin(t * 0.9 + ph) * 0.06;
      g.rotation.x = Math.cos(t * 1.1 + ph) * 0.03;
    });
    return g;
  }

  /** 나무 부두: 해안 (cx, cz)에서 바다 쪽 (nx, nz)으로 len m, 옆에 배 */
  function pier(cx, cz, nx, nz, len) {
    const yaw = Math.atan2(nx, nz);
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = yaw;
    group.add(g);
    const deckTex = plankTex.clone();
    deckTex.repeat.set(1, len / 4);
    deckTex.needsUpdate = true;
    mesh(new THREE.BoxGeometry(4.4, 0.35, len + 4), std('#ffffff', { map: deckTex }), 0, 1.1, len / 2 - 2, g);
    const postMat = std('#5a4030');
    for (let k = 0; k <= len; k += 5) for (const sx of [-2, 2]) mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.8, 6), postMat, sx, 0.4, k, g);
    mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 5), postMat, 1.8, 2.6, len - 0.5, g);
    mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff2b0' }), 1.8, 4.2, len - 0.5, g, false);
    const mx = cx + nx * (len / 2 - 2), mz = cz + nz * (len / 2 - 2);
    box(mx, mz, 2.3, len / 2 + 2, yaw, 1.4);
    occupy(mx, mz, len / 2 + 4);
    const lx = Math.cos(yaw), lz = -Math.sin(yaw); // 로컬 x축
    for (const [sx, k, sail] of [[-4.4, len * 0.4, false], [4.4, len * 0.65, true], [-4.4, len * 0.85, rand() < 0.5]]) {
      const bx = cx + lx * sx + nx * k, bz = cz + lz * sx + nz * k;
      if (!track.inSea(bx, bz, 2.5)) continue;
      boat(bx, bz, yaw + R(-0.12, 0.12), sail);
      circle(bx, bz, 1.6, 2);
    }
  }
  /** 구역에서 도로와 물길에서 떨어진 해안을 골라 부두 하나 */
  function placePier(zone, len = 30) {
    if (!sea) return;
    let best = null;
    sea.coast.forEach(([cx, cz], i) => {
      if (i % 2) return;
      tmpV.set(cx, 0, cz);
      const d = track.nearestRaw(tmpV);
      if (d < 40 || d > 220 || !inZone(track.nearest(tmpV).t, zone)) return;
      const [lnx, lnz] = sea.landNormals[i];
      const ex = cx - lnx * len, ez = cz - lnz * len;
      if (!track.inSea(ex, ez, 3)) return;
      const de = track.nearestRaw(tmpV.set(ex, 0, ez));
      if (de < 45 || !free(cx - (lnx * len) / 2, cz - (lnz * len) / 2, len / 2)) return;
      const score = Math.min(d, de) + rand() * 6;
      if (!best || score > best.score) best = { cx, cz, nx: -lnx, nz: -lnz, score };
    });
    if (best) pier(best.cx, best.cz, best.nx, best.nz, len);
  }

  /** 모래사장: 파라솔, 수건, 구조대 망루 (해안선을 따라) */
  function beachCoast(zone) {
    if (!sea) return;
    const B = sea.beach;
    let guards = 0;
    sea.coast.forEach(([cx, cz], i) => {
      tmpV.set(cx, 0, cz);
      if (track.nearestRaw(tmpV) > 260) return;
      if (!inZone(track.nearest(tmpV).t, zone)) return;
      const [nx, nz] = sea.landNormals[i];
      const tx = -nz, tz = nx; // 해안선 방향
      if (guards < 2 && i % 40 === 20) {
        const x = cx + nx * B * 0.6, z = cz + nz * B * 0.6;
        if (clear(x, z, 2, 1) && free(x, z, 3.5)) {
          lifeguard(x, z, Math.atan2(-nx, -nz));
          guards++;
          return;
        }
      }
      if (rand() < 0.4) return;
      const d = R(4, B - 2.5), j = R(-2, 2);
      const x = cx + nx * d + tx * j, z = cz + nz * d + tz * j;
      if (!clear(x, z, 1.3, 1) || !free(x, z, 1.7)) return;
      umbrellas.push({ x, y: 0, z, s: R(0.9, 1.1), ry: R(0, 6.3), rz: R(-0.08, 0.08), color: pick(beachColors) });
      circle(x, z, 0.15, 2.8);
      occupy(x, z, 1.7);
      if (rand() < 0.75) {
        const a = R(0, 6.3);
        towels.push({ x: x + Math.cos(a) * 1.8, y: 0.035, z: z + Math.sin(a) * 1.8, s: 1, ry: R(0, 6.3), color: pick([...beachColors, '#ffffff']) });
      }
    });
  }

  /** 등대섬: 풀 언덕, 빨강·흰 줄무늬 등대 (빛줄기가 빙글빙글), 등대지기 집, 바위, 야자수 */
  function lighthouse(isl) {
    const { x, z, r } = isl;
    const moundR = Math.max(8, r - 9), moundH = 3.2;
    mesh(new THREE.CylinderGeometry(moundR * 0.45, moundR, moundH, 24), lambert('#6aa84f'), x, moundH / 2, z);
    circle(x, z, moundR, moundH);
    const bands = canvasTexture(16, 64, (g, w, h) => {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : '#d8322a';
        g.fillRect(0, (i * h) / 4, w, h / 4);
      }
    });
    bands.repeat.set(1, 1.5);
    const T = 22;
    const g = new THREE.Group();
    g.position.set(x, moundH, z);
    group.add(g);
    mesh(new THREE.CylinderGeometry(2.1, 3.1, T, 18), std('#ffffff', { map: bands }), 0, T / 2, 0, g);
    mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.5, 18), std('#2b2f3a'), 0, T + 0.25, 0, g);
    mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.6, 12), new THREE.MeshBasicMaterial({ color: '#fff2b0' }), 0, T + 1.8, 0, g, false);
    mesh(new THREE.ConeGeometry(2.2, 2, 12), std('#d8322a'), 0, T + 4.1, 0, g);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#fff4c0', transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const pivot = new THREE.Group();
    pivot.position.y = T + 1.8;
    g.add(pivot);
    for (const dir of [1, -1]) pivot.add(new THREE.Mesh(new THREE.ConeGeometry(4, 70, 16, 1, true).translate(0, -35, 0).rotateZ((dir * Math.PI) / 2), beamMat));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, color: '#ffe9a0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(10);
    glow.position.y = T + 1.8;
    g.add(glow);
    animators.push((t) => (pivot.rotation.y = t * 0.8));
    circle(x, z, 3.4, moundH + T + 5);
    // 등대지기 집
    const hx = Math.min(7, moundR * 0.45 - 2);
    mesh(new THREE.BoxGeometry(4, 2.6, 3.2), std('#f4f1ea'), hx, 1.3, 0, g);
    const roof = gableRoof(4, 3.2, 1.6, lambert('#d8322a'));
    roof.position.set(hx, 2.6, 0);
    roof.castShadow = true;
    g.add(roof);
    occupy(x, z, r);
    for (let k = 0; k < 16; k++) {
      const a = R(0, Math.PI * 2), d = R(r - 6, r - 1.5);
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!track.inSea(px, pz, 1.2)) addRock(px, pz, R(0.9, 2.2), pick(['#8c8f94', '#7c7f84', '#9a9488']));
    }
    for (let k = 0; k < 9; k++) {
      const a = R(0, Math.PI * 2), d = R(moundR + 0.5, r - 3);
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!track.inSea(px, pz, 1.5)) addPalm(px, pz, R(0.8, 1.2));
    }
  }

  /** 안내판 (양면) */
  function signPost(x, z, yaw, title, sub, bg) {
    const tex = canvasTexture(512, 192, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.fillRect(0, h - 14, w, 14);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'bold 66px sans-serif';
      g.fillText(title, w / 2, h * 0.36, w - 30);
      g.font = 'bold 38px sans-serif';
      g.fillText(sub, w / 2, h * 0.72, w - 30);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const sg = new THREE.Group();
    sg.position.set(x, 0, z);
    sg.rotation.y = yaw;
    group.add(sg);
    const face = std('#ffffff', { map: tex });
    const back = std('#3a3f4a');
    mesh(new THREE.BoxGeometry(10, 3.75, 0.3), [back, back, back, back, face, face], 0, 5.4, 0, sg);
    const wx = Math.cos(yaw), wz = -Math.sin(yaw);
    for (const px of [-3.8, 3.8]) {
      mesh(new THREE.CylinderGeometry(0.2, 0.25, 4, 6), std('#555a64'), px, 2, 0, sg);
      circle(x + wx * px, z + wz * px, 0.3, 7.3);
    }
    occupy(x, z, 6);
  }
  /** 코스 위치 t에서 dists(m)만큼 앞뒤로 옮겨 가며 길가(육지)에 안내판 자리 찾기 */
  function roadSign(t, dists, title, sub, bg) {
    for (const dd of dists) {
      const s = track.sampleAt((((t + dd / track.length) % 1) + 1) % 1);
      if (track.isWaterT(s.t)) continue;
      const yaw = Math.atan2(s.tan.x, s.tan.z);
      for (const side of [1, -1]) {
        const lat = W / 2 + 9;
        const x = s.pos.x + s.right.x * side * lat, z = s.pos.z + s.right.z * side * lat;
        if (!clear(x, z, 0.5, 1) || !free(x, z, 5.5)) continue;
        signPost(x, z, yaw, title, sub, bg);
        return;
      }
    }
  }

  const pierZones = new Set();
  if (sea) {
    // 바다 들어가기 전 / 육지로 올라온 곳에 안내판
    for (const wr of track.waterRanges) {
      roadSign(wr.t0, [-70, -90, -55, -110], '3  배 모드', '바다 진입! 숫자 3 키', '#0f6fb8');
      roadSign(wr.t1, [16, 28, 40, 55], '1  자동차 모드', '육지 도착! 숫자 1 / 2 키', '#2f8a3a');
    }
    // 섬
    for (const isl of sea.islands) {
      if (isl.lighthouse) lighthouse(isl);
      else {
        for (let k = 0; k < Math.round(isl.r / 2); k++) {
          const a = R(0, Math.PI * 2), d = R(0, isl.r - 3);
          const px = isl.x + Math.cos(a) * d, pz = isl.z + Math.sin(a) * d;
          if (track.inSea(px, pz, 1.5) || !free(px, pz, 2)) continue;
          rand() < 0.5 ? addPalm(px, pz, R(0.8, 1.2)) : addRock(px, pz, R(1, 2.5), '#8c8f94');
          occupy(px, pz, 2);
        }
        occupy(isl.x, isl.z, isl.r);
      }
    }
    // 먼 바다의 돛단배 (부딪히지 않음)
    for (let tries = 0, placed = 0; tries < 400 && placed < 8; tries++) {
      const x = center.x + R(-750, 750), z = center.z + R(-750, 750);
      if (!track.inSea(x, z, 20) || track.nearestRaw(tmpV.set(x, 0, z)) < 90 || !free(x, z, 12)) continue;
      boat(x, z, R(0, 6.3), true);
      occupy(x, z, 12);
      placed++;
    }
  }

  // ---------------------------------------------------------------- 구역별 배치
  for (const zone of zones) {
    if (zone.theme === 'city') {
      for (const t of zone.stands || []) grandstand(t);
      for (let i = 0; i < 34; i++) {
        const w = R(12, 24), d = R(12, 24), h = R(14, 64);
        const p = spot(zone, 45, 170, Math.hypot(w, d) / 2, 'out', 10);
        if (p) building(p.x, p.z, p.yaw, w, d, h);
      }
      for (let i = 0; i < 6; i++) {
        const w = R(10, 16), d = R(10, 16), h = R(10, 22);
        const p = spot(zone, 40, 90, Math.hypot(w, d) / 2, 'in', 10);
        if (p) building(p.x, p.z, p.yaw, w, d, h);
      }
      for (let i = 0; i < 6; i++) {
        const p = spot(zone, W / 2 + 22, W / 2 + 30, 7.5, 'any', 4);
        if (p) {
          const n = track.nearest(tmpV.set(p.x, 0, p.z));
          const toRoad = Math.atan2(n.sample.pos.x - p.x, n.sample.pos.z - p.z);
          billboard(p.x, p.z, toRoad, i);
        }
      }
      for (let i = 0; i < 90; i++) {
        const p = spot(zone, 24, 90, 1.5, 'any', 3);
        if (p) addRound(p.x, p.z, R(0.7, 1));
      }
    } else if (zone.theme === 'stadium') {
      stadiumScene();
    } else if (zone.theme === 'forest') {
      for (let i = 0; i < 2; i++) {
        const p = spot(zone, 35, 70, 6, 'out', 8);
        if (p) cabin(p.x, p.z, p.yaw);
      }
      for (let i = 0; i < 560; i++) {
        const p = spot(zone, 19, 220, 1.5, 'any', 1.5);
        if (p) rand() < 0.72 ? addPine(p.x, p.z, R(0.8, 1.6)) : addRound(p.x, p.z, R(0.8, 1.3), rand() < 0.35);
      }
      for (let i = 0; i < 60; i++) {
        const p = spot(zone, 18, 120, 2, 'any', 2);
        if (p) addRock(p.x, p.z, R(0.8, 2), pick(['#8c8f94', '#7c7f84', '#9a9488']));
      }
      for (let i = 0; i < 160; i++) {
        const p = spot(zone, 16, 90, 1, 'any', 0.5);
        if (p) bushes.push({ x: p.x, y: 0.6, z: p.z, s: R(0.8, 1.6), color: pick(['#4f9a3a', '#3f8a35', '#5fae45']) });
      }
    } else if (zone.theme === 'rocky') {
      for (let i = 0; i < 9; i++) {
        const r = R(7, 13), h = R(18, 46);
        const p = spot(zone, 45, 140, r, 'any', 10);
        if (!p) continue;
        const geo = new THREE.CylinderGeometry(r * R(0.6, 0.85), r, h, 7, 3);
        const pos = geo.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          pos.setX(k, pos.getX(k) * R(0.85, 1.12));
          pos.setZ(k, pos.getZ(k) * R(0.85, 1.12));
        }
        geo.computeVertexNormals();
        mesh(geo, lambert(pick(['#b07a52', '#a36d4a', '#c08a5e'])), p.x, h / 2, p.z);
        circle(p.x, p.z, r, h);
        occupy(p.x, p.z, r + 3);
      }
      for (let i = 0; i < 130; i++) {
        const p = spot(zone, 18, 160, 3, 'any', 1.5);
        if (p) addRock(p.x, p.z, R(1, 3.2), pick(['#b07a52', '#9c8070', '#8c8f94']));
      }
      for (let i = 0; i < 160; i++) {
        const p = spot(zone, 20, 200, 1.5, 'any', 2);
        if (p) addPine(p.x, p.z, R(0.8, 1.4), true);
      }
    } else if (zone.theme === 'volcano') {
      // 코스 바깥쪽, 모든 도로에서 충분히 먼 곳에 화산
      const mid = track.sampleAt((zone.t0 + zone.t1) / 2);
      const sgn = inside(mid.pos.x + mid.right.x * 40, mid.pos.z + mid.right.z * 40) ? -1 : 1;
      let vd = 300, vx, vz;
      do {
        vx = mid.pos.x + mid.right.x * sgn * vd;
        vz = mid.pos.z + mid.right.z * sgn * vd;
        vd += 10;
      } while (track.nearestRaw(tmpV.set(vx, 0, vz)) < 225 && vd < 700);
      volcano(vx, vz);
      for (let i = 0; i < 14; i++) {
        const p = spot(zone, 30, 160, 10, 'any', 0);
        if (p) scorch(p.x, p.z, R(18, 40));
      }
      for (let i = 0; i < 9; i++) {
        const r = R(3.5, 7);
        const p = spot(zone, 26, 110, r + 3, 'any', 6);
        if (p) lavaPool(p.x, p.z, r);
      }
      for (let i = 0; i < 120; i++) {
        const p = spot(zone, 19, 180, 1.2, 'any', 1.5);
        if (p) {
          const s = R(0.8, 1.4);
          deads.push({ x: p.x, y: 3 * s, z: p.z, s, ry: R(0, 6.3) });
          circle(p.x, p.z, 0.5 * s, 7 * s);
        }
      }
      for (let i = 0; i < 100; i++) {
        const p = spot(zone, 18, 170, 2.5, 'any', 1.5);
        if (p) addRock(p.x, p.z, R(1, 3), pick(['#2e2a2a', '#3b3433', '#463c38']));
      }
    } else if (zone.theme === 'farm') {
      for (let i = 0; i < 9; i++) {
        const p = spot(zone, 28, 110, 9, 'any', 10);
        if (p) house(p.x, p.z, p.yaw + pick([0, Math.PI / 2, Math.PI]));
      }
      for (let i = 0; i < 3; i++) {
        const p = spot(zone, 35, 120, 13, 'any', 12);
        if (p) barn(p.x, p.z, p.yaw);
      }
      for (let i = 0; i < 4; i++) {
        const p = spot(zone, 30, 140, 7, 'any', 10);
        if (p) windmill(p.x, p.z, p.yaw + Math.PI / 2);
      }
      {
        const p = spot(zone, 30, 90, 6, 'any', 10);
        if (p) waterTower(p.x, p.z);
      }
      for (let i = 0; i < 12; i++) {
        const fw = R(22, 40), fl = R(30, 55);
        const p = spot(zone, 25 + fw / 2, 150, Math.max(fw, fl) / 2, 'any', 4);
        if (p) field(p.x, p.z, p.yaw, fw, fl);
      }
      for (let i = 0; i < 150; i++) {
        const p = spot(zone, 18, 200, 1.5, 'any', 1.5);
        if (p) rand() < 0.25 ? addPine(p.x, p.z, R(0.8, 1.3)) : addRound(p.x, p.z, R(0.7, 1.2), rand() < 0.15);
      }
      for (let i = 0; i < 120; i++) {
        const p = spot(zone, 16, 120, 1, 'any', 0.5);
        if (p) bushes.push({ x: p.x, y: 0.6, z: p.z, s: R(0.8, 1.5), color: pick(['#4f9a3a', '#6aa84f', '#5fae45']) });
      }
    } else if (zone.theme === 'beach') {
      // 해변: 관중석(바다 반대쪽), 모래사장 파라솔, 부두, 매점, 해변 집, 야자수
      for (const t of zone.stands || []) grandstand(t, 56);
      beachCoast(zone);
      if (!pierZones.has('beach')) {
        pierZones.add('beach');
        placePier(zone, 34);
      }
      for (let i = 0; i < 3; i++) {
        const p = spot(zone, 26, 60, 4.5, 'any', 4);
        if (p) snackBar(p.x, p.z, p.yaw);
      }
      for (let i = 0; i < 8; i++) {
        const p = spot(zone, 40, 130, 8, 'any', 6);
        if (p) townHouse(p.x, p.z, p.yaw + pick([0, Math.PI / 2]));
      }
      for (let i = 0; i < 150; i++) {
        const p = spot(zone, 17, 170, 1.2, 'any', 1);
        if (p) addPalm(p.x, p.z, R(0.85, 1.3));
      }
      for (let i = 0; i < 60; i++) {
        const p = spot(zone, 16, 100, 1, 'any', 0.5);
        if (p) bushes.push({ x: p.x, y: 0.5, z: p.z, s: R(0.6, 1.2), color: pick(['#4f9a3a', '#6aa84f', '#7fae55']) });
      }
    } else if (zone.theme === 'sea') {
      // 바다 구간: 가까운 육지에만 야자수와 바위 (등대섬, 안내판, 돛단배는 위에서)
      for (let i = 0; i < 80; i++) {
        const p = spot(zone, 18, 150, 1.2, 'any', 1);
        if (p) addPalm(p.x, p.z, R(0.85, 1.3));
      }
      for (let i = 0; i < 30; i++) {
        const p = spot(zone, 18, 120, 2, 'any', 1.5);
        if (p) addRock(p.x, p.z, R(0.8, 2.2), pick(['#9a9488', '#b9a27f', '#8c8f94']));
      }
    } else if (zone.theme === 'cliff') {
      // 해안 절벽: 모래색 바위 기둥, 바위, 소나무, 야자수 조금
      for (let i = 0; i < 10; i++) {
        const r = R(7, 13), h = R(16, 38);
        const p = spot(zone, 40, 130, r, 'any', 8);
        if (!p) continue;
        const geo = new THREE.CylinderGeometry(r * R(0.6, 0.85), r, h, 7, 3);
        const pos = geo.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          pos.setX(k, pos.getX(k) * R(0.85, 1.12));
          pos.setZ(k, pos.getZ(k) * R(0.85, 1.12));
        }
        geo.computeVertexNormals();
        mesh(geo, lambert(pick(['#c9a77c', '#b8956a', '#d4b48a'])), p.x, h / 2, p.z);
        circle(p.x, p.z, r, h);
        occupy(p.x, p.z, r + 3);
      }
      for (let i = 0; i < 110; i++) {
        const p = spot(zone, 18, 160, 3, 'any', 1.5);
        if (p) addRock(p.x, p.z, R(1, 3.2), pick(['#b9a27f', '#a8916f', '#8c8f94']));
      }
      for (let i = 0; i < 110; i++) {
        const p = spot(zone, 20, 200, 1.5, 'any', 2);
        if (p) addPine(p.x, p.z, R(0.8, 1.4), true);
      }
      for (let i = 0; i < 25; i++) {
        const p = spot(zone, 18, 90, 1.2, 'any', 1);
        if (p) addPalm(p.x, p.z, R(0.85, 1.2));
      }
    } else if (zone.theme === 'town') {
      // 바닷가 마을: 야자수 가로수 → 부두 → 알록달록한 낮은 집
      const stepT = 28 / track.length;
      const span = (zone.t1 - zone.t0 + 1) % 1 || 1;
      for (let u = 0; u < span; u += stepT) {
        const s = track.sampleAt((zone.t0 + u) % 1);
        for (const side of [-1, 1]) {
          const lat = W / 2 + 7.5;
          const x = s.pos.x + s.right.x * side * lat, z = s.pos.z + s.right.z * side * lat;
          if (!clear(x, z, 0.5, 0) || !free(x, z, 1.5)) continue;
          addPalm(x, z, R(0.95, 1.15));
          occupy(x, z, 1.5);
        }
      }
      if (!pierZones.has('town')) {
        pierZones.add('town');
        placePier(zone, 28);
      }
      for (let i = 0; i < 55; i++) {
        const p = spot(zone, 24, 120, 8, 'any', 3);
        if (p) townHouse(p.x, p.z, p.yaw + pick([0, 0, Math.PI]));
      }
      for (let i = 0; i < 70; i++) {
        const p = spot(zone, 20, 150, 1.5, 'any', 1.5);
        if (p) rand() < 0.5 ? addPalm(p.x, p.z, R(0.85, 1.2)) : addRound(p.x, p.z, R(0.7, 1.1));
      }
      for (let i = 0; i < 60; i++) {
        const p = spot(zone, 16, 90, 1, 'any', 0.5);
        if (p) bushes.push({ x: p.x, y: 0.5, z: p.z, s: R(0.6, 1.2), color: pick(['#4f9a3a', '#e87fb0', '#5fae45', '#f2c230']) });
      }
    }
  }

  // ---------------------------------------------------------------- 호수 (인필드에서 가장 넓은 빈 곳. 운동장은 인필드가 축구장이라 없음)
  if (!track.arena && !track.sea && !zones.some((z) => z.theme === 'stadium')) {
    let best = null;
    const bb = new THREE.Box3().setFromPoints(poly.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    for (let x = bb.min.x; x < bb.max.x; x += 8)
      for (let z = bb.min.z; z < bb.max.z; z += 8) {
        if (!inside(x, z)) continue;
        tmpV.set(x, 0, z);
        const c = Math.min(track.nearestRaw(tmpV) - W / 2 - 14, track.shortcutDist(tmpV) - 14, ...occupied.map((o) => Math.hypot(o.x - x, o.z - z) - o.r));
        if (!best || c > best.c) best = { x, z, c };
      }
    if (best && best.c > 12) {
      const r = Math.min(48, best.c);
      const sand = new THREE.Mesh(new THREE.CircleGeometry(r + 4, 40), new THREE.MeshLambertMaterial({ color: '#d9c99a' }));
      sand.rotation.x = -Math.PI / 2;
      sand.position.set(best.x, 0.014, best.z);
      sand.receiveShadow = true;
      group.add(sand);
      const waterTex = canvasTexture(64, 64, (g, w, h) => {
        g.fillStyle = '#3d8fd1';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
          g.beginPath();
          const y = Math.random() * h;
          g.moveTo(Math.random() * w * 0.5, y);
          g.lineTo(Math.random() * w * 0.5 + w * 0.3, y);
          g.stroke();
        }
      });
      waterTex.repeat.set(r / 8, r / 8);
      const water = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshStandardMaterial({ map: waterTex, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.92 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(best.x, 0.045, best.z);
      group.add(water);
      water.updateMatrixWorld();
      water.userData.surface = 'water';
      track.groundMeshes.push(water); // 물 위는 느려짐
      animators.push((t) => waterTex.offset.set(t * 0.02, t * 0.01));
      // 호숫가 나무
      for (let i = 0; i < 18; i++) {
        const a = R(0, Math.PI * 2), d = r + R(7, 16);
        const x = best.x + Math.cos(a) * d, z = best.z + Math.sin(a) * d;
        if (clear(x, z, 1.5, 2) && free(x, z, 1.5)) addRound(x, z, R(0.8, 1.2));
      }
      occupy(best.x, best.z, r + 4);
    }
  }

  // ---------------------------------------------------------------- 테스트 맵: 안내판, 격납고, 관제탑
  if (track.arena) {
    const sp = track.spawn;
    for (const e of track.data.signs || []) {
      // 방향을 안 주면 출발 지점을 바라봄
      const yaw = e.yaw !== undefined ? (e.yaw * Math.PI) / 180 : Math.atan2(sp.x - e.x, sp.z - e.z);
      const tex = canvasTexture(512, 128, (g, w, h) => {
        g.fillStyle = e.bg || '#1d2433';
        g.fillRect(0, 0, w, h);
        g.fillStyle = e.color || '#ffd21f';
        g.fillRect(0, h - 12, w, 12);
        g.fillStyle = '#ffffff';
        g.font = 'bold 44px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(e.text, w / 2, h / 2 - 4, w - 30);
      });
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const sg = new THREE.Group();
      sg.position.set(e.x, 0, e.z);
      sg.rotation.y = yaw;
      group.add(sg);
      const face = std('#ffffff', { map: tex });
      const back = std('#3a3f4a');
      mesh(new THREE.BoxGeometry(12, 3, 0.3), [back, back, back, back, face, face], 0, 5.2, 0, sg);
      const wx = Math.cos(yaw), wz = -Math.sin(yaw);
      for (const px of [-4.5, 4.5]) {
        mesh(new THREE.CylinderGeometry(0.2, 0.25, 5, 6), std('#555a64'), px, 2.5, 0, sg);
        circle(e.x + wx * px, e.z + wz * px, 0.3, 6.5);
      }
    }
    // 격납고 (반원 지붕, 문은 시험장 쪽)
    const hangarMat = std('#c9ced6', { metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide });
    for (const [hx, hz, face] of [[350, -48, -1], [350, 0, -1], [350, 48, -1], [-345, 50, 1]]) {
      const hg = new THREE.Group();
      hg.position.set(hx, 0, hz);
      group.add(hg);
      mesh(new THREE.CylinderGeometry(13, 13, 34, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), hangarMat, 0, 0, 0, hg);
      mesh(new THREE.CircleGeometry(13, 20, 0, Math.PI).rotateY(Math.PI / 2 * -face), std('#2b3240'), -face * 17, 0, 0, hg); // 뒷벽
      const door = mesh(new THREE.CircleGeometry(12.6, 20, 0, Math.PI), std('#14181f'), face * 16.9, 0, 0, hg, false);
      door.rotation.y = (Math.PI / 2) * face;
      mesh(new THREE.BoxGeometry(0.4, 1.4, 22), std('#f2c230'), face * 17.1, 13.5, 0, hg); // 간판 띠
      box(hx, hz, 17, 13, 0, 13);
    }
    // 관제탑
    const tw = new THREE.Group();
    tw.position.set(-350, 0, -20);
    group.add(tw);
    mesh(new THREE.CylinderGeometry(3.2, 4.2, 30, 10), std('#e4e7ec'), 0, 15, 0, tw);
    mesh(new THREE.CylinderGeometry(6.5, 5, 5, 8), std('#7fc6ff', { metalness: 0.6, roughness: 0.15 }), 0, 32.5, 0, tw);
    mesh(new THREE.CylinderGeometry(7.2, 7.2, 0.8, 8), std('#3a3f4a'), 0, 35.4, 0, tw);
    const beacon = mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3a3a' }), 0, 37, 0, tw, false);
    animators.push((t) => (beacon.visible = Math.sin(t * 4) > 0));
    circle(-350, -20, 4.4, 36);
  }

  // ---------------------------------------------------------------- 먼 곳 채우기 (지평선까지 텅 빈 들판이 되지 않게)
  for (const zone of zones) {
    for (let i = 0; i < 160; i++) {
      const p = spot(zone, 200, 520, 3, 'out', 0);
      if (!p) continue;
      const s = R(1.2, 2.2);
      if (zone.theme === 'volcano') addRock(p.x, p.z, R(2, 5), pick(['#2e2a2a', '#3b3433']));
      else if (zone.theme === 'rocky') rand() < 0.5 ? addRock(p.x, p.z, R(2, 5), '#a36d4a') : addPine(p.x, p.z, s, true);
      else if (zone.theme === 'farm' || zone.theme === 'city' || zone.theme === 'stadium') addRound(p.x, p.z, s);
      else if (zone.theme === 'beach' || zone.theme === 'sea') rand() < 0.7 ? addPalm(p.x, p.z, R(0.9, 1.3)) : addRound(p.x, p.z, s);
      else if (zone.theme === 'town') rand() < 0.4 ? addPalm(p.x, p.z, R(0.9, 1.3)) : addRound(p.x, p.z, s);
      else if (zone.theme === 'cliff') rand() < 0.45 ? addRock(p.x, p.z, R(2, 5), pick(['#b9a27f', '#a8916f'])) : addPine(p.x, p.z, s, true);
      else addPine(p.x, p.z, s);
    }
  }

  // ---------------------------------------------------------------- 인스턴스 만들기
  instanced(new THREE.CylinderGeometry(0.35, 0.5, 3, 6).translate(0, 1.5, 0), lambert('#7a5233'), pines.map((p) => ({ ...p, y: 0, color: undefined })));
  instanced(new THREE.ConeGeometry(2.6, 5, 7).translate(0, 5, 0), lambert('#ffffff'), pines.map((p) => ({ ...p, y: 0 })));
  instanced(new THREE.ConeGeometry(1.9, 4, 7).translate(0, 7.6, 0), lambert('#ffffff'), pines.map((p) => ({ ...p, y: 0 })));
  instanced(new THREE.CylinderGeometry(0.3, 0.45, 4, 6).translate(0, 2, 0), lambert('#7a5233'), rounds.map((p) => ({ ...p, y: 0, color: undefined })));
  instanced(new THREE.IcosahedronGeometry(2.6, 1).translate(0, 5.6, 0), lambert('#ffffff'), rounds.map((p) => ({ ...p, y: 0 })));
  instanced(new THREE.CylinderGeometry(0.25, 0.45, 6, 5), lambert('#2b2422'), deads);
  instanced(new THREE.CylinderGeometry(0.1, 0.18, 3, 4).rotateZ(0.9).translate(0.9, 1.2, 0), lambert('#2b2422'), deads);
  instanced(new THREE.DodecahedronGeometry(1, 0), lambert('#ffffff'), rocks);
  instanced(new THREE.IcosahedronGeometry(1, 0), lambert('#ffffff'), bushes, false);
  if (palms.length) {
    // 야자수: 휘어진 줄기 + 늘어진 잎 8장 + 열매
    const trunk = new THREE.CylinderGeometry(0.2, 0.36, 8, 6, 6).translate(0, 4, 0);
    const tp = trunk.attributes.position;
    for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) + 0.022 * tp.getY(i) * tp.getY(i));
    trunk.computeVertexNormals();
    const top = [0.022 * 64, 8, 0];
    const leafPos = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + (k % 2) * 0.2, ca = Math.cos(a), sa = Math.sin(a);
      const droop = k % 2 ? 0.45 : 0;
      const pt = (out, up, side) => [top[0] + ca * out - sa * side, top[1] + up, top[2] + sa * out + ca * side];
      const base = pt(0, 0.1, 0), mL = pt(2.1, 0.55 - droop, -0.75), mR = pt(2.1, 0.55 - droop, 0.75), tip = pt(4.4, -1.5 - droop, 0);
      leafPos.push(...base, ...mL, ...mR, ...mL, ...tip, ...mR);
    }
    const leaves = new THREE.BufferGeometry();
    leaves.setAttribute('position', new THREE.Float32BufferAttribute(leafPos, 3));
    leaves.computeVertexNormals();
    instanced(trunk, lambert('#8a6a48'), palms.map((p) => ({ ...p, y: 0, color: undefined })));
    instanced(leaves, lambert('#ffffff', { side: THREE.DoubleSide }), palms.map((p) => ({ ...p, y: 0 })));
    instanced(new THREE.IcosahedronGeometry(0.5, 0).translate(top[0], top[1] - 0.35, 0), lambert('#6b4a2e'), palms.map((p) => ({ ...p, y: 0, color: undefined })), false);
  }
  if (umbrellas.length) {
    // 파라솔: 기둥 + 색 조각/흰 조각이 번갈아 있는 갓 (8조각)
    const canopyHalf = (parity) => {
      const src = new THREE.ConeGeometry(1.9, 0.75, 8, 1, true).toNonIndexed();
      const sp = src.attributes.position, sn = src.attributes.normal;
      const P = [], N = [];
      for (let t = 0; t < sp.count; t += 3) {
        const cx = sp.getX(t) + sp.getX(t + 1) + sp.getX(t + 2), cz = sp.getZ(t) + sp.getZ(t + 1) + sp.getZ(t + 2);
        const seg = Math.floor(((Math.atan2(cz, cx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4));
        if (seg % 2 !== parity) continue;
        for (let k = 0; k < 3; k++) {
          P.push(sp.getX(t + k), sp.getY(t + k), sp.getZ(t + k));
          N.push(sn.getX(t + k), sn.getY(t + k), sn.getZ(t + k));
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      return geo.translate(0, 2.55, 0);
    };
    instanced(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5).translate(0, 1.3, 0), lambert('#f4f4f4'), umbrellas.map((p) => ({ ...p, color: undefined })));
    instanced(canopyHalf(0), lambert('#ffffff', { side: THREE.DoubleSide }), umbrellas);
    instanced(canopyHalf(1), lambert('#fbfbf5', { side: THREE.DoubleSide }), umbrellas.map((p) => ({ ...p, color: undefined })));
  }
  instanced(new THREE.PlaneGeometry(1.1, 2).rotateX(-Math.PI / 2), lambert('#ffffff'), towels, false);

  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- 차와 충돌
  const seen = [];
  function collideCar(car) {
    if (car.pos.y > 70) return;
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
          if (car.pos.y > c.h) continue;
          const dx = car.pos.x - c.x, dz = car.pos.z - c.z;
          if (c.type === 'circle') {
            const d = Math.hypot(dx, dz), min = c.r + CAR_R;
            if (d < min && d > 1e-4) car.applyPush(tmpV.set(dx / d, 0, dz / d), min - d);
          } else {
            // 상자의 로컬 좌표 (x축 = (cos, -sin), z축 = (sin, cos))
            const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
            const px = THREE.MathUtils.clamp(lx, -c.hx, c.hx), pz = THREE.MathUtils.clamp(lz, -c.hz, c.hz);
            let nx = lx - px, nz = lz - pz;
            let d = Math.hypot(nx, nz), depth;
            if (d > 1e-4) {
              if (d >= CAR_R) continue;
              nx /= d;
              nz /= d;
              depth = CAR_R - d;
            } else {
              // 중심이 상자 안: 가장 얕은 쪽으로
              const ox = c.hx - Math.abs(lx), oz = c.hz - Math.abs(lz);
              if (ox < oz) (nx = Math.sign(lx) || 1), (nz = 0), (depth = ox + CAR_R);
              else (nx = 0), (nz = Math.sign(lz) || 1), (depth = oz + CAR_R);
            }
            // 로컬 → 월드
            car.applyPush(tmpV.set(nx * c.cos + nz * c.sin, 0, -nx * c.sin + nz * c.cos), depth);
          }
        }
      }
  }

  return {
    collideCar,
    animate(time, dt, car) {
      for (const a of animators) a(time, dt, car);
    },
    stats: { palms: palms.length, umbrellas: umbrellas.length, pines: pines.length, rounds: rounds.length, rocks: rocks.length, deads: deads.length, colliders: [...new Set([...grid.values()].flat())].length },
  };
}
