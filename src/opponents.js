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
import { batchLocal } from './staticBatch.js'; // 차 부품 묶어 그리기 (렉 줄이기)

const FULL_DIST = 120; // 이 거리(m) 안에서만 자세한 모델 (밖은 단순한 모형)
const HIDE_DIST = 900; // 이보다 멀면 안 그림 (안개 너머)
const TAG_DIST = 260; // 이름표가 보이는 거리

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
      const g = c.getContext('2d');
      g.clearRect(0, 0, 256, 64);
      g.fillStyle = 'rgba(10,14,24,0.72)';
      g.beginPath();
      g.roundRect(4, 8, 248, 48, 12);
      g.fill();
      g.fillStyle = color;
      g.fillRect(4, 8, 10, 48);
      g.font = '800 26px "Malgun Gothic", system-ui, sans-serif';
      g.fillStyle = '#ffd23a';
      g.textBaseline = 'middle';
      g.fillText(sub, 24, 33);
      const w = g.measureText(sub).width;
      g.fillStyle = '#ffffff';
      g.font = '700 24px "Malgun Gothic", system-ui, sans-serif';
      g.fillText(text, 24 + w + (sub ? 10 : 0), 33, 220 - w);
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

  /** 화면용 부품 (모델 + 모형 + 이름표) */
  function makeVisual(entry) {
    const model = createCarModel(entry.look || '#e8463a');
    if (!/[?&]batch=0/.test(location.search)) batchLocal(model.root); // 같은 그룹 안 부품을 묶음 (움직이면 스스로 풂)
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
      if (lod === 'full') e.model.sync(v, dt, elapsed);
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
        const [text, sub] = labelFn ? labelFn(e) : [e.name, ''];
        e.tag.set(text, sub);
        e.tag.sprite.material.opacity = Math.min(1, (TAG_DIST - d) / 60);
      }
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
