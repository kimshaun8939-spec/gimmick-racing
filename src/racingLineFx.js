// 레이싱 라인 표시 (F1 게임의 주행 라인 보조처럼) + 에이펙스 알림
//
//   도로 위에 얇은 띠로 "가장 빠른 길"을 그립니다. 차 앞 약 170 m만 보이고, 색으로 알려 줍니다.
//     초록 = 지금 속도로 괜찮음 (밟아도 됨)
//     노랑 = 조금 빠름 (액셀을 떼요)
//     빨강 = 너무 빠름 (여기서 브레이크!)
//   L 키로 켜고 끔 (브라우저에 기억)
//   코너 안쪽 연석(에이펙스)을 빠르게 스치면 "에이펙스!" 표시 + 살짝 가속 (판정은 car.js의 checkApex)
import * as THREE from 'three';
import { lineCarModel } from './car.js';
import { smartProfile } from './brakeNeed.js';

const HALF = 0.5; // 띠 반폭 (m)
const LIFT = 0.07; // 도로 위로 띄우는 높이 (연석 0.02~0.04보다 위)
const AHEAD = 170, BEHIND = 12; // 보이는 범위 (m)
const GREEN = new THREE.Color('#38e86b'), YELLOW = new THREE.Color('#ffd23a'), RED = new THREE.Color('#ff3b30');

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,1)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRacingLineFx(scene, track, car) {
  const popup = createApexPopup();
  const cornerPop = createCornerPopup();
  const line = track.racingLine;
  if (!line) return { update() {}, toggle: () => false, apex() {}, visible: false, line: null };
  const N = line.N;
  const prof = line.profile(lineCarModel(car.cfg));
  car._lineProfile = prof; // 에이펙스 판정도 같은 속도 계획을 씀
  const lineY = track.lineY || (() => 0);
  const water = (i) => (track.isWaterT ? track.isWaterT(i / N) : false);

  // 고리를 두 번 이어 붙인 띠 (어느 구간이든 drawRange 한 번으로 그릴 수 있게)
  const ROWS = 2 * N + 1;
  const pos = new Float32Array(ROWS * 2 * 3);
  const col = new Float32Array(ROWS * 2 * 4);
  const uv = new Float32Array(ROWS * 2 * 2);
  const W = (i) => ((i % N) + N) % N;
  let v = 0;
  for (let r = 0; r < ROWS; r++) {
    const i = W(r), a = W(i - 1), b = W(i + 1);
    let dx = line.x[b] - line.x[a], dz = line.z[b] - line.z[a];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // 진행 방향의 오른쪽 = (-dz, dx)
    const nx = -dz, nz = dx;
    for (let k = 0; k < 2; k++) {
      const sgn = k === 0 ? -1 : 1;
      const o = (r * 2 + k) * 3;
      pos[o] = line.x[i] + nx * HALF * sgn;
      pos[o + 2] = line.z[i] + nz * HALF * sgn;
      pos[o + 1] = lineY(i, HALF * sgn) + LIFT;
      uv[(r * 2 + k) * 2] = k;
      uv[(r * 2 + k) * 2 + 1] = v;
    }
    v += line.seg[i] / 4;
  }
  const idx = new Uint32Array((ROWS - 1) * 6);
  for (let r = 0; r < ROWS - 1; r++) {
    const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.set([a, c, b, b, c, d], r * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const colAttr = new THREE.BufferAttribute(col, 4);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('color', colAttr);
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    map: stripeTexture(), vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  scene.add(mesh);

  let visible = true;
  try {
    visible = localStorage.getItem('racingLine') !== 'off';
  } catch {}
  mesh.visible = visible;

  const ds = track.length / N;
  const back = Math.round(BEHIND / ds), ahead = Math.round(AHEAD / ds);
  const tmp = new THREE.Color();

  function update(car) {
    const show = visible && car.grounded && !car.flying && car.trackInfo && car.trackInfo.dist < track.width + 8;
    mesh.visible = show;
    if (!show) return;
    const ci = car.trackInfo.index % N;
    const start = W(ci - back); // 0 ≤ start < N, 끝은 2N 안
    const count = back + ahead;
    const speed = Math.abs(car.speed);
    // 이 차로 브레이크가 이득이 없는 코너(W만 떼도 되는 곳)는 'W 떼기' 계획 속도와 비교하고 빨강(브레이크!) 대신 노랑까지만
    //   (사용자 요청 2026-11-13 "브레이크 안 밟고 가는 게 빠른 구간에서 브레이크를 밟으라고 함", brakeNeed.js)
    let sp = null;
    try {
      sp = car.cornerInfo ? smartProfile(car, track) : null;
    } catch {}
    const ref = sp ? sp.speed : prof.speed;
    for (let k = 0; k <= count; k++) {
      const r = start + k, i = W(r);
      let diff = speed - ref[i];
      if (sp && sp.noBrake[i]) diff = Math.min(diff, 2.2);
      if (diff > 3.5) tmp.copy(RED);
      else if (diff > 0.8) tmp.copy(YELLOW).lerp(RED, (diff - 0.8) / 2.7);
      else if (diff > -1.5) tmp.copy(GREEN).lerp(YELLOW, (diff + 1.5) / 2.3);
      else tmp.copy(GREEN);
      // 차 바로 아래와 먼 끝은 흐리게
      let a = 0.8;
      if (k < back + 4) a *= THREE.MathUtils.clamp((k - back + 4) / 8, 0, 1);
      a *= THREE.MathUtils.clamp((count - k) / (ahead * 0.3), 0, 1);
      if (water(i)) a = 0;
      for (let s = 0; s < 2; s++) {
        const o = (r * 2 + s) * 4;
        col[o] = tmp.r;
        col[o + 1] = tmp.g;
        col[o + 2] = tmp.b;
        col[o + 3] = a;
      }
    }
    colAttr.needsUpdate = true;
    geo.setDrawRange(start * 6, count * 6);
  }

  return {
    line,
    profile: prof,
    get visible() {
      return visible;
    },
    update,
    /** L 키: 켜기/끄기. 켜졌으면 true */
    toggle() {
      visible = !visible;
      try {
        localStorage.setItem('racingLine', visible ? 'on' : 'off');
      } catch {}
      return visible;
    },
    /** 에이펙스 성공 알림 */
    apex(info) {
      popup.show(info);
    },
    miss() {
      popup.miss();
    },
    /** 코너 탈출 알림 (car.lastCornerInfo, 내 최고 기록과 차이 초) */
    corner(info, delta) {
      cornerPop.show(info, delta);
    },
  };
}

/** 화면 위쪽 가운데에 잠깐 뜨는 "에이펙스!" 글자 */
function createApexPopup() {
  const el = document.createElement('div');
  el.className = 'racing-line-notice';
  Object.assign(el.style, {
    position: 'fixed', left: '50%', top: '24%', transform: 'translate(-50%, 0) scale(1)', pointerEvents: 'none',
    font: '800 26px/1.1 system-ui, sans-serif', letterSpacing: '0.04em', color: '#ffd23a', textAlign: 'center',
    textShadow: '0 2px 0 #000a, 0 0 14px #0008', opacity: '0', transition: 'opacity 0.5s ease-out, transform 0.5s ease-out', zIndex: 3,
  });
  document.body.appendChild(el);
  let timer = 0;
  const flash = (html, color) => {
    el.innerHTML = html;
    el.style.color = color;
    el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, 0) scale(1.18)';
    void el.offsetWidth;
    el.style.transition = 'opacity 0.6s ease-out 0.5s, transform 0.25s ease-out';
    el.style.transform = 'translate(-50%, 0) scale(1)';
    el.style.opacity = '0';
    clearTimeout(timer);
  };
  return {
    show({ perfect, combo }) {
      void combo; // 연속 수는 코너 탈출 알림의 '연계 ×n'으로 대신함
      flash(perfect ? '완벽한 에이펙스!' : '에이펙스!', perfect ? '#7dff6a' : '#ffd23a');
    },
    miss() {
      flash('<span style="font-size:16px">연속 끊김</span>', '#ffffffcc');
    },
  };
}

/**
 * 코너를 빠져나갈 때 에이펙스 글자 바로 아래에 작게 뜨는 한 줄
 *   [T3] 깔끔한 코너 · 연계 ×2   −0.12초
 * 깔끔한 코너 = 에이펙스 + 좋은 탈출, 연계 = 이어진 코너를 연달아 깔끔하게
 */
function createCornerPopup() {
  const el = document.createElement('div');
  el.className = 'racing-line-notice';
  Object.assign(el.style, {
    position: 'fixed', left: '50%', top: 'calc(24% + 36px)', transform: 'translate(-50%, 0)', pointerEvents: 'none',
    font: '700 15px/1.2 system-ui, sans-serif', letterSpacing: '0.03em', color: '#fff', textAlign: 'center', whiteSpace: 'nowrap',
    textShadow: '0 1px 0 #000c, 0 0 8px #0009', opacity: '0', zIndex: 3,
  });
  document.body.appendChild(el);
  const fmt = (d) => `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}초`;
  return {
    show(info, delta) {
      if (!info) return;
      let label = '';
      if (info.clean) label = info.chain >= 2 ? `<span style="color:#7dff6a">연계 ×${info.chain}</span>` : '<span style="color:#7dff6a">깔끔한 코너</span>';
      else if (info.goodExit) label = '<span style="color:#bfe9ff">좋은 탈출</span>';
      else if (info.broke) label = '<span style="color:#ffffffaa">연계 끊김</span>';
      const d = delta == null || Math.abs(delta) < 0.005 ? '' : `<span style="margin-left:10px;color:${delta < 0 ? '#7dff6a' : '#ff6b5e'}">${fmt(delta)}</span>`;
      if (!label && !d) return;
      const tag = `<span style="display:inline-block;padding:1px 6px;margin-right:8px;border-radius:4px;background:#ffffff26;font-size:13px">T${info.num}</span>`;
      // 깔끔하게 돌았고 다음 코너가 바로 이어지면 "→ T4" (이어서 잘 돌면 연계)
      const next = info.clean && info.nextLinked && info.nextNum ? `<span style="margin-left:8px;color:#ffffff99;font-size:13px">→ T${info.nextNum}</span>` : '';
      el.innerHTML = tag + label + d + next;
      el.style.transition = 'none';
      el.style.opacity = '1';
      void el.offsetWidth;
      el.style.transition = 'opacity 0.5s ease-out 1.1s';
      el.style.opacity = '0';
    },
  };
}
