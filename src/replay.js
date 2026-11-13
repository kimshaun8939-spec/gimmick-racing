// 리플레이 (race 에이전트, 2026-11-10 6라운드)
//   레이스 중 모든 차(내 차 + 봇·온라인 상대)의 위치·방향을 1초에 15번 기록 → 완주 뒤 결과 화면의 "▶ 리플레이"로 다시 보기.
//   다시 볼 때는 물리를 멈추고(main.js가 이 파일의 frame만 부름) 기록 사이를 부드럽게 이어서 그림.
//   카메라: TV(코스 옆 고정 카메라가 차를 따라 바뀜) · 뒤따라가기 · 운전석. 재생/멈춤, 2배속, ±5초, 다른 차 보기, 나가기.
//   키: Space 재생/멈춤 · ←/→ 5초 · ↑/↓ 다른 차 · C 카메라 · F 배속 · Esc 나가기. 버튼은 터치·패드(A)로도 누름
//   기록은 최대 15분(넘으면 오래된 것부터 버림)이라 메모리가 계속 늘지 않음.
import * as THREE from 'three';
import { fakeCar } from './opponents.js';

const HZ = 15; // 1초에 몇 번 기록
const MAX_FRAMES = HZ * 60 * 15; // 15분
const F = 13; // 차 한 대 값 수: 위치3 · 앞3 · 위3 · 속도 · 핸들 · 상태 비트 · 액셀
const MODES = ['normal', 'accel', 'boat', 'fly'];
const CAMS = ['tv', 'chase', 'onboard'];
const CAM_NAME = { tv: '📺 TV', chase: '🎥 뒤따라가기', onboard: '🏎 운전석' };
const TV_GAP = 110; // TV 카메라 간격 (m)

/**
 * @param o { scene, camera, track, car(내 Car), model(내 차 모델), opponents, hooks: { animate(view, dt), onExit() } }
 */
export function createReplay(o) {
  const { camera, track, car, model, opponents } = o;
  const hooks = o.hooks || {};
  const L = track.length;
  // --- 기록 ---
  let frames = []; // { t, d: Float32Array }
  let cars = null; // [{ name, color, isPlayer, entry, src }] 기록을 시작할 때 정함
  let nextT = 0, stopAt = Infinity;

  function reset() {
    frames = [];
    cars = null;
    nextT = 0;
    stopAt = Infinity;
  }
  function pickCars() {
    cars = [{ name: '나', color: '#ffd23a', isPlayer: true, entry: null, src: car }];
    for (const e of opponents.entries) cars.push({ name: e.name, color: e.color, isPlayer: false, entry: e, src: e.view });
  }
  /** 매 화면(물리 뒤): 레이스 시계 clock 기준 1/15초마다 한 장 */
  function sample(clock, phase) {
    if (phase === 'countdown' || clock > stopAt) return;
    if (!cars) pickCars();
    if (clock < nextT) return;
    nextT = clock + 1 / HZ;
    const d = new Float32Array(cars.length * F);
    cars.forEach((c, k) => {
      const v = c.src, b = k * F;
      if (!v || !v.pos) return;
      d[b] = v.pos.x; d[b + 1] = v.pos.y; d[b + 2] = v.pos.z;
      d[b + 3] = v.fwd.x; d[b + 4] = v.fwd.y; d[b + 5] = v.fwd.z;
      d[b + 6] = v.up.x; d[b + 7] = v.up.y; d[b + 8] = v.up.z;
      d[b + 9] = v.forwardSpeed ?? v.speed ?? 0;
      d[b + 10] = v.steerVisual || 0;
      d[b + 11] = Math.max(0, MODES.indexOf(v.mode)) + (v.form === 'spike' ? 8 : 0) + (v.drifting ? 16 : 0) + (v.flying ? 32 : 0) + (v.grounded === false ? 0 : 64);
      d[b + 12] = v.thr || 0;
    });
    frames.push({ t: clock, d });
    if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
  }
  /** 내가 완주한 시각: 그 뒤 4초까지만 기록 */
  function markFinish(clock) {
    stopAt = clock + 4;
  }

  // --- TV 카메라 자리: 코스를 따라 110 m마다, 코너 바깥쪽 옆 + 높이 8 m ---
  //   처음 쓸 때 가로등·나무 등에 가리는지 레이로 보고, 가리면 높이·반대쪽 자리를 고름 (한 번 정하면 기억)
  const S = track.samples, n = S.length;
  const RL = track.racingLine;
  const stations = [];
  for (let s = 0; s < L; s += TV_GAP) {
    const i = Math.min(n - 1, Math.round((s / L) * (n - 1)));
    let curv = 0;
    if (RL) for (let q = 0; q < 12; q++) curv += RL.curvature[(i + q * 3) % RL.N] || 0;
    const side = curv > 0 ? 1 : curv < 0 ? -1 : stations.length % 2 ? 1 : -1; // 왼쪽으로 도는 코너 → 오른쪽(바깥)에
    const half = RL ? Math.max(Math.abs(RL.lo[i % RL.N] || 6), Math.abs(RL.hi[i % RL.N] || 6)) : 7;
    stations.push({ i, side, half, pos: null });
  }
  const ray = new THREE.Raycaster();
  let solids = null, solidsKey = 0; // 가림 검사용 물체 목록 (처음 필요할 때 만듦)
  ray.camera = o.camera; // 글자판(Sprite)도 레이에 걸릴 수 있게 (없으면 three가 경고를 냄)
  const _d = new THREE.Vector3(), _tgt = new THREE.Vector3();
  function blocked(from, to) {
    _d.subVectors(to, from);
    const len = _d.length();
    ray.set(from, _d.normalize());
    ray.far = len - 3;
    const wk = o.hooks && o.hooks.worldKey ? o.hooks.worldKey() : 0; // gp 우주/구름섬처럼 세계가 바뀌면 다시 모음
    if (wk !== solidsKey) solids = null;
    solidsKey = wk;
    if (!solids) {
      // 보이는 덩어리(Mesh)만 모음: 글자판(Sprite)·선·점은 빼고, 차는 움직이니까 빼고
      solids = [];
      const skip = new Set();
      const addSkip = (obj) => obj && obj.traverse((c) => skip.add(c));
      addSkip(o.model && (o.model.group || o.model.root || o.model.object));
      if (o.opponents && o.opponents.entries) for (const e of o.opponents.entries) addSkip(e.model && (e.model.group || e.model.root || e.model.object));
      o.scene.traverseVisible((c) => {
        if (!c.isMesh || skip.has(c)) return;
        const m = c.material;
        if (m && !Array.isArray(m) && m.transparent && m.opacity < 0.5) return;
        solids.push(c);
      });
    }
    return ray.intersectObjects(solids, false).length > 0;
  }
  function stationPos(k) {
    const st = stations[k];
    if (st.pos) return st.pos;
    const sm = S[st.i], up = sm.up || new THREE.Vector3(0, 1, 0);
    const back = S[(st.i - Math.round((40 / L) * n) + n) % n]; // 차가 다가오는 쪽 40 m 앞 도로
    const cands = [];
    for (const side of [st.side, -st.side]) for (const h of [8, 13]) cands.push(sm.pos.clone().addScaledVector(sm.right, side * (st.half + 10)).addScaledVector(up, h));
    st.pos = cands[0];
    try {
      for (const c of cands) {
        if (!blocked(c, _tgt.copy(sm.pos).addScaledVector(up, 1)) && !blocked(c, _tgt.copy(back.pos).addScaledVector(back.up || up, 1))) {
          st.pos = c;
          break;
        }
      }
    } catch (err) {
      console.warn(err);
    }
    return st.pos;
  }

  // --- 재생 ---
  let active = false, playing = true, speed = 1, t = 0, t0 = 0, t1 = 0, camMode = 'tv', focus = 0;
  let views = [], bar = null, savedFov = 60, lastStation = -1;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _look = new THREE.Vector3(), _cp = new THREE.Vector3();

  function makeViews() {
    views = cars.map(() => {
      const v = fakeCar();
      v.trackInfo = null;
      return v;
    });
  }
  /** 시각 tt의 상태를 views에 (앞뒤 기록 사이를 이어서) */
  function place(tt) {
    let lo = 0, hi = frames.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (frames[m].t <= tt) lo = m;
      else hi = m;
    }
    const A = frames[lo], B = frames[hi];
    const u = B.t > A.t ? Math.min(1, Math.max(0, (tt - A.t) / (B.t - A.t))) : 0;
    views.forEach((v, k) => {
      const b = k * F, a = A.d, c = B.d;
      if (b + F > a.length || b + F > c.length) return;
      _a.set(a[b], a[b + 1], a[b + 2]);
      _b.set(c[b], c[b + 1], c[b + 2]);
      const jump = _a.distanceToSquared(_b) > 30 * 30; // 복귀(순간이동): 잇지 않음
      const w = jump ? (u < 0.5 ? 0 : 1) : u;
      v.pos.lerpVectors(_a, _b, w);
      v.fwd.set(a[b + 3] + (c[b + 3] - a[b + 3]) * w, a[b + 4] + (c[b + 4] - a[b + 4]) * w, a[b + 5] + (c[b + 5] - a[b + 5]) * w).normalize();
      v.up.set(a[b + 6] + (c[b + 6] - a[b + 6]) * w, a[b + 7] + (c[b + 7] - a[b + 7]) * w, a[b + 8] + (c[b + 8] - a[b + 8]) * w).normalize();
      const sp = a[b + 9] + (c[b + 9] - a[b + 9]) * w;
      v.speed = v.forwardSpeed = sp;
      v.vel.copy(v.fwd).multiplyScalar(sp);
      v.steerVisual = a[b + 10] + (c[b + 10] - a[b + 10]) * w;
      v.thr = a[b + 12];
      const fl = (w < 0.5 ? a : c)[b + 11];
      v.mode = MODES[fl & 7] || 'normal';
      v.form = fl & 8 ? 'spike' : null;
      v.drifting = !!(fl & 16);
      v.flying = !!(fl & 32);
      v.grounded = !!(fl & 64);
    });
  }

  function syncModels(dt, elapsed) {
    views.forEach((v, k) => {
      const c = cars[k];
      if (c.isPlayer) {
        model.root.visible = true;
        model.sync(v, dt, elapsed);
        return;
      }
      const e = c.entry;
      if (!e || !e.model || opponents.entries.indexOf(e) < 0) return; // 나간 상대
      const d = v.pos.distanceTo(camera.position);
      e.model.root.visible = d < 450;
      if (e.proxy) e.proxy.visible = false;
      if (d < 450) e.model.sync(v, dt, elapsed);
      if (e.tag && e.tag.sprite) {
        const show = d > 4 && d < 160 && camMode !== 'onboard';
        e.tag.sprite.visible = show;
        if (show) {
          e.tag.sprite.position.copy(v.pos).addScaledVector(v.up, 2.1 + d * 0.006);
          e.tag.set(c.name, '');
          e.tag.sprite.material.opacity = Math.min(1, (160 - d) / 60);
        }
      }
      e.lod = null; // 나가면 opponents가 다시 정함
    });
  }

  function updateCam(dt) {
    const v = views[focus];
    if (!v) return;
    camera.up.set(0, 1, 0);
    if (camMode === 'tv') {
      const ti = track.nearest(v.pos);
      v.trackInfo = ti;
      const s = ti.t * L;
      // 차가 카메라를 30 m 지나갈 때까지는 그 카메라, 지나면 다음 카메라 (TV 중계처럼 '컷')
      let k = Math.ceil((s - 30) / TV_GAP);
      k = ((k % stations.length) + stations.length) % stations.length;
      lastStation = k;
      camera.position.copy(stationPos(k));
      _look.copy(v.pos).addScaledVector(v.up, 0.8);
      camera.lookAt(_look);
      const d = camera.position.distanceTo(_look);
      camera.fov = THREE.MathUtils.clamp((2 * Math.atan(7 / Math.max(1, d)) * 180) / Math.PI, 10, 62);
    } else if (camMode === 'chase') {
      _cp.copy(v.pos).addScaledVector(v.fwd, -7).addScaledVector(v.up, 2.4);
      camera.position.lerp(_cp, 1 - Math.exp(-10 * dt));
      if (camera.position.distanceToSquared(_cp) > 400) camera.position.copy(_cp);
      camera.up.copy(v.up);
      camera.lookAt(_look.copy(v.pos).addScaledVector(v.fwd, 4).addScaledVector(v.up, 0.9));
      camera.fov = 66;
    } else {
      camera.position.copy(v.pos).addScaledVector(v.up, 1.0).addScaledVector(v.fwd, 0.1);
      camera.up.copy(v.up);
      camera.lookAt(_look.copy(v.pos).addScaledVector(v.fwd, 25).addScaledVector(v.up, 0.6));
      camera.fov = 78;
    }
    camera.updateProjectionMatrix();
  }

  // --- 화면 막대 (결과 화면 #results 안에 넣음: 패드 이동·B 버튼·터치가 그대로 됨) ---
  const fmt = (s) => {
    s = Math.max(0, s);
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
  };
  function buildBar() {
    const root = document.getElementById('results');
    bar = document.createElement('div');
    bar.id = 'rpBar';
    bar.innerHTML = `<div class="rp-top"><b>🎬 리플레이</b><span class="rp-car"></span><span class="rp-time"></span></div>
      <p class="rp-help">완주한 주행을 다시 보는 화면이에요. 아래 막대를 끌어 원하는 순간으로 이동하세요.</p>
      <input class="rp-seek" type="range" min="0" max="1000" value="0" aria-label="재생 위치">
      <div class="rp-btns">
        <button class="gm-btn small" data-rp="back" title="5초 뒤로 (←)">⏪ 5초</button>
        <button class="gm-btn small primary" data-rp="play" title="재생/멈춤 (Space)">⏸ 멈춤</button>
        <button class="gm-btn small" data-rp="fwd" title="5초 앞으로 (→)">5초 ⏩</button>
        <button class="gm-btn small" data-rp="speed" title="배속 (F)">1×</button>
        <button class="gm-btn small" data-rp="cam" title="카메라 (C)">📺 TV</button>
        <button class="gm-btn small" data-rp="car" title="다른 차 보기 (↑/↓)" ${cars.length < 2 ? 'disabled' : ''}>${cars.length < 2 ? '🚗 내 차만 있음' : '🚗 다른 차'}</button>
        <button class="gm-btn small" data-rp="exit" data-res="home" title="나가기 (Esc)">✕ 나가기</button>
      </div>`;
    root.prepend(bar); // 패드 B(= #results의 첫 [data-res="home"])가 '나가기'를 누르게 맨 앞에
    bar.querySelectorAll('[data-rp]').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        act(b.dataset.rp);
      }),
    );
    const seek = bar.querySelector('.rp-seek');
    seek.addEventListener('input', () => {
      t = t0 + ((t1 - t0) * seek.value) / 1000;
    });
    root.classList.add('rp');
    document.body.classList.add('replaying');
    // 결과 창은 숨김 (CSS '#results.rp > .res'가 디자인 2차의 '#results .res.wide { display: flex }'에 져서 순위표가 있는 결과 창이 리플레이를 가렸음, 2026-11-12)
    root.querySelectorAll(':scope > .res').forEach((e) => (e.style.display = 'none'));
  }
  function refreshBar() {
    if (!bar) return;
    bar.querySelector('.rp-time').textContent = `${fmt(t - t0)} / ${fmt(t1 - t0)}${speed !== 1 ? `  ${speed}×` : ''}`;
    const c = cars[focus];
    bar.querySelector('.rp-car').innerHTML = `<i style="background:${c.color}"></i>${c.name.replace(/</g, '&lt;')}`;
    const seek = bar.querySelector('.rp-seek');
    if (document.activeElement !== seek) seek.value = String(Math.round(((t - t0) / Math.max(0.01, t1 - t0)) * 1000));
    bar.querySelector('[data-rp="play"]').textContent = playing ? '⏸ 멈춤' : t >= t1 - 0.01 ? '↺ 처음부터' : '▶ 재생';
    bar.querySelector('[data-rp="speed"]').textContent = `${speed}×`;
    bar.querySelector('[data-rp="cam"]').textContent = CAM_NAME[camMode];
  }

  function act(a) {
    if (a === 'play') {
      if (!playing && t >= t1 - 0.01) t = t0;
      playing = !playing;
    } else if (a === 'back') t = Math.max(t0, t - 5);
    else if (a === 'fwd') t = Math.min(t1, t + 5);
    else if (a === 'speed') speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
    else if (a === 'cam') camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length];
    else if (a === 'car' || a === 'carNext') focus = (focus + 1) % cars.length;
    else if (a === 'carPrev') focus = (focus - 1 + cars.length) % cars.length;
    else if (a === 'exit') return stop();
    refreshBar();
  }

  // 키보드 (다시 보는 중에만). 잡는 단계(capture)에서 먼저 받아 게임(Enter 다시 시작·Esc 메뉴)으로 가지 않게 막음
  window.addEventListener(
    'keydown',
    (e) => {
      if (!active) return;
      const inBar = bar && bar.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON';
      const k = e.code;
      let used = true;
      if (k === 'Escape' || k === 'Backspace') act('exit');
      else if (k === 'Space' || k === 'Enter' || k === 'NumpadEnter') {
        if (inBar) {
          e.stopImmediatePropagation(); // 초점 버튼은 브라우저가 누름 (패드 A도 같은 버튼)
          if (k === 'Enter' || k === 'NumpadEnter') {
            e.preventDefault();
            document.activeElement.click();
          }
          return;
        }
        act('play');
      } else if (k === 'ArrowLeft') act('back');
      else if (k === 'ArrowRight') act('fwd');
      else if (k === 'ArrowUp') act('carPrev');
      else if (k === 'ArrowDown') act('carNext');
      else if (k === 'KeyC') act('cam');
      else if (k === 'KeyF' || k === 'Digit2') act('speed');
      else used = false;
      if (used) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );

  function start() {
    if (active || frames.length < 4) return false;
    active = true;
    makeViews();
    t0 = frames[0].t;
    t1 = frames[frames.length - 1].t;
    t = t0;
    playing = true;
    speed = 1;
    focus = 0;
    savedFov = camera.fov;
    if (hooks.onStart) hooks.onStart();
    buildBar();
    refreshBar();
    const pb = bar.querySelector('[data-rp="play"]');
    if (pb) pb.focus({ preventScroll: true }); // 패드 A = 재생/멈춤
    return true;
  }
  function stop() {
    if (!active) return;
    active = false;
    if (bar) bar.remove();
    bar = null;
    const root = document.getElementById('results');
    root.classList.remove('rp');
    document.body.classList.remove('replaying');
    root.querySelectorAll(':scope > .res').forEach((e) => (e.style.display = ''));
    // 상대 모델은 원래대로 (다음 화면에서 opponents가 LOD·이름표를 다시 정함)
    for (const c of cars || []) if (c.entry) c.entry.lod = null;
    camera.fov = savedFov;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    if (hooks.onExit) hooks.onExit();
    const rb = root.querySelector('[data-res="replay"]');
    if (rb) rb.focus({ preventScroll: true });
  }
  let barT = 0;
  /** 다시 보는 중 매 화면 (main.js: 물리 대신 이것만) */
  function frame(dt, elapsed) {
    if (!active) return;
    if (playing) {
      t += dt * speed;
      if (t >= t1) {
        t = t1;
        playing = false;
        refreshBar();
      }
    }
    place(t);
    updateCam(dt);
    syncModels(dt, elapsed);
    if (hooks.animate) {
      try {
        hooks.animate(views[focus], dt);
      } catch (err) {
        console.warn('리플레이 풍경 갱신 끔:', err);
        hooks.animate = null; // 한 번 틀리면 끔 (매 화면 경고가 쌓이지 않게)
      }
    }
    barT += dt;
    if (barT > 0.1) {
      barT = 0;
      refreshBar();
    }
  }

  return {
    reset,
    sample,
    markFinish,
    start,
    stop,
    frame,
    get active() {
      return active;
    },
    /** 다시 볼 기록이 있는지 */
    has: () => frames.length >= 4,
    get frames() {
      return frames.length;
    },
    get duration() {
      return frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
    },
    /** 테스트용 */
    get state() {
      return { t, t0, t1, playing, speed, camMode, focus, station: lastStation, cars: cars ? cars.length : 0 };
    },
    act,
    /** 테스트용: 시작 뒤 sec초 위치로 */
    seek(sec) {
      t = Math.min(t1, Math.max(t0, t0 + sec));
    },
  };
}
