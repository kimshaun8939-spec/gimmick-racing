// 상대 차 목록 (AI 봇 + 온라인 다른 플레이어)
//
//   game.opponents.add({ id, name, look, carName, remote: true }) → { set(state), remove() }
//     state = { pos:[x,y,z], fwd:[x,y,z], up:[x,y,z], speed, lap, progress, finished, finishTime }
//     progress = 지난 바퀴 수 + 이번 바퀴 진행(0~1) → 순위표에 같이 나옴
//   봇은 raceSystem.js가 addBot()으로 넣음 (진짜 차 물리 Car를 가짐)
//
//   화면: 차마다 3D 모델 + 머리 위 이름표. 멀리 있는 차는 가벼운 모형(LOD)으로 바꿔서 그림 → 7대여도 가볍게
import * as THREE from 'three';
import { createCarModel } from './carModel.js';
import { graphicsTier } from './settings.js';
import { batchLocal } from './staticBatch.js'; // 차 부품 묶어 그리기 (렉 줄이기)

const FULL_DIST = 120; // 이 거리(m) 안에서만 자세한 모델 (밖은 단순한 모형)
const HIDE_DIST = 900; // 이보다 멀면 안 그림 (안개 너머)
const TAG_DIST = 260; // 이름표가 보이는 거리
// 그림자 줄이기 (렉 줄이기 2, 2026-11-11): 봇 차 한 대가 그림자를 30~40조각으로 따로 그렸음 (봇 6대 = 그림자만 그림 호출 약 200)
//   멀리 있는 차는 작은 부품(거울·흡입구·작은 날개 등)의 그림자를 끔. 차체·바퀴처럼 큰 것만 그림자를 남김
//   [거리 m, 남길 부품의 겉넓이 m²]: 20 m 안은 전부, 20~45 m는 0.8 m² 이상, 그 밖은 4 m² 이상 (차체 큰 판·바퀴)
const SHADOW_TIERS = [[20, 0], [45, 0.8], [Infinity, 4]];
const _shadow0 = new WeakMap(); // 메시 → 원래 castShadow
const _areaOf = new WeakMap(); // 모양 → 겉넓이 (m², 한 번만 계산)
function geoArea(g) {
  let a = _areaOf.get(g);
  if (a !== undefined) return a;
  a = 0;
  const p = g.attributes.position, idx = g.index;
  if (p) {
    const n = idx ? idx.count : p.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      const ax = p.getX(ia), ay = p.getY(ia), az = p.getZ(ia);
      const ux = p.getX(ib) - ax, uy = p.getY(ib) - ay, uz = p.getZ(ib) - az;
      const vx = p.getX(ic) - ax, vy = p.getY(ic) - ay, vz = p.getZ(ic) - az;
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      a += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    }
  }
  _areaOf.set(g, a);
  return a;
}
function shadowTierOf(d) {
  let t = 0;
  while (d > SHADOW_TIERS[t][0]) t++;
  return t;
}
/** 차 모델의 그림자 단계 적용 (tier 0 = 원래대로 전부) */
function applyShadowTier(root, tier) {
  const minArea = SHADOW_TIERS[tier][1];
  root.traverse((o) => {
    if (!o.isMesh) return;
    let cs0 = _shadow0.get(o);
    if (cs0 === undefined) _shadow0.set(o, (cs0 = o.castShadow));
    if (!cs0) return;
    if (minArea <= 0) {
      o.castShadow = true;
      return;
    }
    const sc = o.scale.x * o.scale.y * o.scale.z; // 부품 크기 (보통 1)
    o.castShadow = geoArea(o.geometry) * Math.abs(sc) ** (2 / 3) >= minArea;
  });
}

/** 모델(carModel.sync)이 읽는 값만 가진 가짜 차 (온라인 상대·고스트용) */
export function fakeCar() {
  return {
    pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, 1), vel: new THREE.Vector3(),
    mode: 'normal', form: null, sink: 0, forwardSpeed: 0, speed: 0, thr: 0, brk: 0, flying: false, grounded: true, surface: 'ground',
    drifting: false, driftDir: 0, driftLevel: 0, steerVisual: 0, load: 0, boostTime: 0,
  };
}

/** look(문자열 또는 {body}) → 차체 색 */
export function lookColor(look) {
  if (!look) return '#e8463a';
  return typeof look === 'string' ? look : look.body || '#e8463a';
}

/** 멀리 있을 때 쓰는 가벼운 모형 (차체·앞날개·뒷날개·바퀴 4개 = 메시 2개) */
function proxyModel(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 4.4), paint);
  body.position.set(0, 0.45, 0.1);
  const side = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 1.8), paint);
  side.position.set(0, 0.42, -0.6);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.5), dark);
  wing.position.set(0, 0.95, -2.1);
  const fwing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.45), dark);
  fwing.position.set(0, 0.18, 2.25);
  g.add(body, side, wing, fwing);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.38, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.85, 1.45], [0.85, 1.45], [-0.9, -1.35], [0.9, -1.35]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.36, z);
    g.add(w);
  }
  g.traverse((o) => o.isMesh && (o.castShadow = false));
  return g;
}

/** 머리 위 이름표 (순위 + 이름). 글자가 바뀔 때만 다시 그림 */
function nameTag(color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.2, 0.05, 1);
  spr.renderOrder = 5;
  let last = '';
  return {
    sprite: spr,
    set(text, sub) {
      const key = text + '|' + sub;
      if (key === last) return;
      last = key;
      // 2026-11-14 사용자 요청 '이름표가 너무 큼 → 양 끝 반원·작게·반투명': 글자 길이에 맞춘 알약 모양, 배경 반투명, 왼쪽 색은 점
      const g = c.getContext('2d');
      g.clearRect(0, 0, 256, 64);
      const H = 48, y0 = 8, r = H / 2, pad = 14, dot = 12;
      g.textBaseline = 'middle';
      g.font = '800 31px "Malgun Gothic", system-ui, sans-serif';
      const w = sub ? g.measureText(sub).width : 0;
      g.font = '700 31px "Malgun Gothic", system-ui, sans-serif';
      const maxName = 256 - pad * 2 - dot - 8 - w - (sub ? 8 : 0);
      let name = Array.from(String(text)), label = name.join('');
      while (g.measureText(label).width > maxName && name.length) {
        name.pop(); label = name.join('') + '…';
      }
      const nw = g.measureText(label).width;
      const bw = Math.min(252, pad * 2 + dot + 8 + w + (sub ? 8 : 0) + nw), x0 = (256 - bw) / 2;
      g.fillStyle = 'rgba(7,12,23,0.55)';
      g.beginPath();
      g.roundRect(x0, y0, bw, H, r);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = color;
      g.beginPath();
      g.arc(x0 + pad + dot / 2, y0 + r, dot / 2, 0, Math.PI * 2);
      g.fill();
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 4;
      let tx = x0 + pad + dot + 8;
      if (sub) {
        g.font = '800 31px "Malgun Gothic", system-ui, sans-serif';
        g.fillStyle = '#ffd23a';
        g.fillText(sub, tx, y0 + r + 1);
        tx += w + 8;
      }
      g.font = '700 31px "Malgun Gothic", system-ui, sans-serif';
      g.fillStyle = '#ffffff';
      g.fillText(label, tx, y0 + r + 1);
      g.shadowBlur = 0;
      tex.needsUpdate = true;
    },
  };
}

export function createOpponents(scene) {
  const entries = [];
  const changeFns = [];
  const _cam = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _x = new THREE.Vector3();
  const _tagPoint = new THREE.Vector3();

  /** 화면용 부품 (모델 + 모형 + 이름표) */
  function makeVisual(entry) {
    const model = createCarModel(entry.look || '#e8463a');
    if (!/[?&]batch=0/.test(location.search)) batchLocal(model.root, { pbr: !/[?&]pbr=0/.test(location.search) }); // 같은 그룹 안 부품을 묶음 (움직이면 스스로 풂). pbr = 렉 줄이기 2
    // 그림자 단계용 겉넓이를 불러올 때 미리 계산 (레이스 중에 처음 계산하면 한 번에 수 ms 멈칫)
    model.root.traverse((o) => o.isMesh && o.castShadow && geoArea(o.geometry));
    scene.add(model.root);
    const proxy = proxyModel(entry.color);
    scene.add(proxy);
    proxy.visible = false;
    const tag = nameTag(entry.color);
    scene.add(tag.sprite);
    entry.model = model;
    entry.proxy = proxy;
    entry.tag = tag;
    entry.lod = 'full';
  }

  function add(opts, extra = {}) {
    const entry = {
      id: opts.id ?? `opp${entries.length + 1}`,
      name: opts.name || '상대',
      carName: opts.carName || '',
      look: opts.look || '#4fc3ff',
      color: lookColor(opts.look),
      remote: !!opts.remote,
      isBot: !!extra.car,
      car: extra.car || null, // 봇: 진짜 Car (물리)
      view: extra.car || fakeCar(), // 모델이 읽는 상태
      progress: 0, lap: 1, finished: false, finishTime: null, bestLap: null, lapTimes: [],
      speed: 0, lateral: 0, recvT: 0, target: null, position: 0,
      ...extra,
    };
    makeVisual(entry);
    entries.push(entry);
    for (const fn of changeFns) fn('add', entry);
    const handle = {
      entry,
      /** 온라인 상대의 새 상태 (네트워크로 받은 것) */
      set(state) {
        if (!state) return;
        const v = entry.view;
        const first = !entry.target;
        entry.target = state;
        entry.recvT = performance.now();
        if (first && state.pos) {
          v.pos.fromArray(state.pos);
          if (state.fwd) v.fwd.fromArray(state.fwd);
          if (state.up) v.up.fromArray(state.up);
        }
        if (state.progress != null) entry.progress = state.progress;
        if (state.lap != null) entry.lap = state.lap;
        if (state.speed != null) entry.speed = Math.abs(state.speed);
        if (state.finished && !entry.finished) {
          entry.finished = true;
          entry.finishTime = state.finishTime ?? null;
        }
        if (state.bestLap != null) entry.bestLap = state.bestLap;
        if (state.mode) v.mode = state.mode;
        v.form = state.form || null;
      },
      remove() {
        const i = entries.indexOf(entry);
        if (i < 0) return;
        entries.splice(i, 1);
        scene.remove(entry.model.root, entry.proxy, entry.tag.sprite);
        entry.model.dispose && entry.model.dispose();
        // 단순 모형과 이름표는 carModel.dispose의 범위 밖. 온라인 입퇴장 때도 GPU 자원을 돌려줌.
        const geos = new Set(), mats = new Set();
        entry.proxy.traverse(o => { if (o.geometry) geos.add(o.geometry); if (o.material) mats.add(o.material); });
        for (const g of geos) g.dispose();
        for (const m of mats) m.dispose();
        entry.tag.sprite.material.map.dispose();
        entry.tag.sprite.material.dispose();
        for (const fn of changeFns) fn('remove', entry);
      },
    };
    return handle;
  }

  /** 온라인 상대: 받은 상태 쪽으로 부드럽게 (조금 앞을 예측해서 늦게 보이지 않게) */
  function steerRemote(e, dt) {
    const s = e.target;
    if (!s || !s.pos) return;
    const v = e.view;
    const lag = Math.min(0.25, (performance.now() - e.recvT) / 1000);
    const tx = s.pos[0], ty = s.pos[1], tz = s.pos[2];
    const f = s.fwd || [0, 0, 1];
    const sp = s.speed || 0;
    _x.set(tx + f[0] * sp * lag, ty + f[1] * sp * lag, tz + f[2] * sp * lag);
    if (v.pos.distanceToSquared(_x) > 40 * 40) v.pos.copy(_x); // 순간이동(복귀 등)
    else v.pos.lerp(_x, 1 - Math.exp(-12 * dt));
    if (s.fwd) v.fwd.lerp(_x.fromArray(s.fwd), 1 - Math.exp(-12 * dt)).normalize();
    if (s.up) v.up.lerp(_x.fromArray(s.up), 1 - Math.exp(-12 * dt)).normalize();
    v.forwardSpeed = v.speed = sp;
    v.thr = sp > 1 ? 1 : 0;
    v.vel.copy(v.fwd).multiplyScalar(sp);
  }

  /** 매 화면: 모델 위치·LOD·이름표 */
  function render(dt, elapsed, camera, labelFn) {
    _cam.copy(camera.position);
    camera.updateMatrixWorld();
    const tags = [];
    // 화면 높이·시야각에 따라 이름표가 5~9px로 작아지지 않게 실제 픽셀로 맞춤.
    const tagW = innerHeight <= 500 ? 104 : 116, tagH = tagW / 4; // 2026-11-14 작게 (예전 112/128, 박스는 이름 길이에 맞춤)
    const tagUnit = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, innerHeight);
    for (const e of entries) {
      if (e.remote) steerRemote(e, dt);
      const v = e.view;
      const d = v.pos.distanceTo(_cam);
      const lod = d > HIDE_DIST ? 'none' : d > FULL_DIST ? 'proxy' : 'full';
      if (lod !== e.lod) {
        e.model.root.visible = lod === 'full';
        e.proxy.visible = lod === 'proxy';
        if (lod === 'full') e.model.sync(v, 1, elapsed); // 다시 보일 때 바로 제자리
        e.lod = lod;
      }
      if (lod === 'full') {
        e.model.sync(v, dt, elapsed);
        // 그림자 단계: 거리가 바뀌면 바로, 아니어도 1초마다 다시 (변신으로 부품이 풀려 새로 생긴 메시까지)
        let tier = shadowTierOf(d);
        if (e.shTier != null && tier !== e.shTier && shadowTierOf(d + (tier > e.shTier ? -2 : 2)) === e.shTier) tier = e.shTier; // 경계에서 2 m 여유 (깜빡임 방지)
        tier = Math.max(graphicsTier() > 0 ? 1 : 0, tier);
        e.shT = (e.shT || 0) - dt;
        if (tier !== e.shTier || e.shT < 0) {
          applyShadowTier(e.model.root, tier);
          e.shTier = tier;
          e.shT = 1;
        }
      }
      else if (lod === 'proxy') {
        _x.crossVectors(v.up, v.fwd).normalize();
        _m.makeBasis(_x, v.up, v.fwd);
        _q.setFromRotationMatrix(_m);
        e.proxy.position.copy(v.pos);
        e.proxy.quaternion.copy(_q);
      }
      const showTag = lod !== 'none' && d < TAG_DIST && d > 4;
      e.tag.sprite.visible = showTag;
      if (showTag) {
        e.tag.sprite.position.copy(v.pos).addScaledVector(v.up, 2.1 + d * 0.006);
        e.tag.sprite.scale.set(tagW * tagUnit, tagH * tagUnit, 1);
        _tagPoint.copy(e.tag.sprite.position).project(camera);
        const x = (_tagPoint.x + 1) * innerWidth / 2, y = (1 - _tagPoint.y) * innerHeight / 2;
        if (_tagPoint.z < -1 || _tagPoint.z > 1 || x < 0 || x > innerWidth || y < 0 || y > innerHeight) {
          e.tag.sprite.visible = false;
          continue;
        }
        tags.push({ sprite: e.tag.sprite, d, x0: x - tagW / 2 - 3, x1: x + tagW / 2 + 3, y0: y - tagH / 2 - 3, y1: y + tagH / 2 + 3 });
        const [text, sub] = labelFn ? labelFn(e) : [e.name, ''];
        e.tag.set(text, sub);
        e.tag.sprite.material.opacity = 0.88 * Math.min(1, (TAG_DIST - d) / 60);
      }
    }
    // 가까운 차를 우선. 겹치는 이름표만 숨기고 차에서 떨어진 자리로 옮기지는 않음.
    const placed = [];
    tags.sort((a, b) => a.d - b.d);
    for (const tag of tags) {
      if (placed.some(p => tag.x0 < p.x1 && tag.x1 > p.x0 && tag.y0 < p.y1 && tag.y1 > p.y0)) tag.sprite.visible = false;
      else placed.push(tag);
    }
  }

  return {
    entries,
    /** 온라인 상대 추가 (net). 봇은 raceSystem이 add(opts, { car })로 넣음 */
    add,
    list: () => entries.slice(),
    get: (id) => entries.find((e) => e.id === id) || null,
    onChange(fn) {
      changeFns.push(fn);
    },
    render,
  };
}
