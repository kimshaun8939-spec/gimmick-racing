// 부품 강화 연출 (upgradeD1, 2026-11-15, 설계 .debug/design/upgrade-design.md 5.3)
//   약 2초: 그 부품으로 카메라(PART_VIEW) → 주변 어둡게 → 부품 둘레 원 게이지에 확률이 크게 보이며 차오름
//   → 성공 = 섬광·빛 고리·부품이 새 단계 모양으로·별 하나 채워짐 / 실패 = 불꽃 몇 개·연기·'아깝다! 다음 확률 72% (+12%)'
//   결과는 partUpgrade.roll()이 이미 정하고 저장한 것(res)을 보여 주기만 함. Enter·Space·Esc·클릭 = 바로 결과.
//   움직임 줄이기(prefers-reduced-motion) = 0.5초 페이드로 결과만.
//   장착한 부품은 차고 3D(home.preview)에서, 장착 안 했거나 물 모듈·3D가 없으면 부품 단독 그림(partThumb)으로.
//   소리는 합성(설정 muted·masterVol·fxVol 따름). Three.js는 카메라 계산에만 씀.
import * as T from 'three';
import { PART_VIEW, LV_ACCENT } from './carParts3d.js';

const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const accent = (lv) => LV_ACCENT[Math.max(2, Math.min(5, lv))] || '#4fd1ff';

// ───────── 소리 ─────────
let actx = null;
function audio() {
  let st = {};
  try { st = JSON.parse(localStorage.getItem('gimmick.settings') || '{}'); } catch {}
  if (st.muted) return null;
  const level = (st.masterVol ?? 1) * (st.fxVol ?? 1);
  if (!level) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { actx ||= new AC(); actx.resume().catch(() => {}); } catch { return null; }
  return { ctx: actx, vol: window.AudioContext?.__mixed ? 1 : level };
}
function tone(a, { type = 'sine', f0, f1, t0 = 0, dur = 0.2, gain = 0.05, q } = {}) {
  const { ctx, vol } = a, t = ctx.currentTime + t0;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * vol), t + Math.min(0.03, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (q) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = f0; f.Q.value = q; o.connect(f); node = f; }
  node.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch {} };
}
function noise(a, { t0 = 0, dur = 0.3, gain = 0.04, freq = 1800 } = {}) {
  const { ctx, vol } = a, t = ctx.currentTime + t0, n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = 'highpass'; f.frequency.value = freq; g.gain.value = gain * vol;
  s.connect(f).connect(g).connect(ctx.destination); s.start(t);
  s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch {} };
}
export const upgradeSound = {
  start() { const a = audio(); if (!a) return; tone(a, { type: 'sine', f0: 70, f1: 55, dur: 0.5, gain: 0.07 }); tone(a, { type: 'triangle', f0: 220, f1: 880, t0: 0.18, dur: 1.0, gain: 0.025 }); tone(a, { type: 'sine', f0: 330, f1: 1320, t0: 0.2, dur: 1.0, gain: 0.015 }); },
  success() { const a = audio(); if (!a) return; tone(a, { type: 'triangle', f0: 900, f1: 160, dur: 0.07, gain: 0.05 }); tone(a, { type: 'triangle', f0: 170, f1: 48, t0: 0.05, dur: 0.14, gain: 0.08 }); for (const [f, t] of [[1046, 0.08], [1318, 0.16], [1568, 0.24], [2093, 0.32]]) tone(a, { type: 'sine', f0: f, t0: t, dur: 0.55, gain: 0.035 }); },
  fail() { const a = audio(); if (!a) return; noise(a, { dur: 0.45, gain: 0.05, freq: 2400 }); tone(a, { type: 'sine', f0: 140, f1: 70, t0: 0.12, dur: 0.22, gain: 0.07 }); },
  ding() { const a = audio(); if (!a) return; tone(a, { type: 'sine', f0: 1760, t0: 0, dur: 0.35, gain: 0.025 }); },
};

// ───────── 3D 부품 찾기 ─────────
function findPart(scene, slot) {
  if (!scene) return null;
  let best = null, bestZ = -Infinity;
  scene.traverse((o) => {
    if (!o.name || !o.name.startsWith('part-')) return;
    const n = o.name.slice(5);
    const hit = slot === 'tire' ? n.startsWith('tire-') : slot === 'aero' ? n === 'aero' || n === 'splitter' : n === slot;
    if (!hit) return;
    let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
    if (!vis) return;
    // 타이어는 오른쪽 앞바퀴(카메라 쪽 PART_VIEW.tire = +x)
    let root = o; while (root.parent && root.parent.type !== 'Scene' && !root.parent.userData?.baseY) root = root.parent;
    const holder = root.parent;
    const local = new T.Vector3(); o.getWorldPosition(local); if (holder) holder.worldToLocal(local);
    const score = slot === 'tire' ? (local.x > 0 ? 100 : 0) + local.z : 0;
    if (!best || score > bestZ) { best = { obj: o, holder, splitter: n === 'splitter' }; bestZ = score; }
  });
  return best;
}

/**
 * 강화 연출 재생 → Promise<{ skipped }>
 * @param o.res        partUpgrade.roll() 결과 (ok:true)
 * @param o.slot       부품 칸
 * @param o.equipped   이 차에 끼운 부품인지 (3D 연출)
 * @param o.preview    home.preview (scene·camera·renderer)
 * @param o.stage      3D 칸 요소 (.h-carstage) — 없거나 작으면 화면 가운데
 * @param o.setLevel   (lv) => 3D 부품을 그 단계 모양으로 (장착 연출 때)
 * @param o.thumbs     { from, to } 단독 그림 URL (그림 연출·실패 때)
 */
export function playUpgradeFx(o) {
  const res = o.res, success = !!res.success, from = res.from, to = success ? res.to : from;
  let reduced = o.reduced ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pct = Math.round((res.chance || 0) * 100);
  const nextPct = success ? 0 : Math.round((res.nextChance ?? res.next?.chance ?? 0) * 100);
  const addPct = success ? 0 : Math.max(0, nextPct - pct);
  const color = accent(success ? to : from + 1);
  const sr = o.stage?.getBoundingClientRect();
  // 3D 칸이 작으면(휴대폰 세로·가로) 화면 전체에 부품 단독 그림으로
  const stageEl = sr && sr.width > 340 && sr.height > 360 ? o.stage : null;
  const use3d = !!(o.equipped && o.preview && stageEl && o.slot !== 'water');
  const DUR = reduced ? 500 : 2050, HIT = reduced ? 0 : 1200;

  // ── 화면 겹(overlay) ──
  const el = document.createElement('div');
  el.className = 'ufx' + (use3d ? ' ufx-3d' : ' ufx-img') + (reduced ? ' ufx-reduced' : '');
  el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'assertive');
  el.style.setProperty('--ufx-c', color);
  el.innerHTML = `<div class="ufx-dim"></div><canvas class="ufx-cv"></canvas>
    ${use3d ? '' : `<img class="ufx-art" alt="" src="${o.thumbs?.from || ''}">`}
    <div class="ufx-gauge"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ufx-track" cx="60" cy="60" r="52"/><circle class="ufx-fill" cx="60" cy="60" r="52" pathLength="100"/></svg><div class="ufx-lab"><b class="ufx-pct">${reduced ? pct : 0}%</b><small>성공 확률</small></div></div>
    <div class="ufx-flash"></div><div class="ufx-ring"></div>
    <div class="ufx-banner" hidden></div>
    <div class="ufx-hint">${reduced ? '' : '건너뛰기 · Enter / 클릭'}</div>`;
  document.body.append(el);
  const place = () => {
    const r = stageEl ? stageEl.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    return r;
  };
  let rect = place();
  const cv = el.querySelector('.ufx-cv'), ctx2 = cv.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr);
  const gauge = el.querySelector('.ufx-gauge'), fill = el.querySelector('.ufx-fill'), pctEl = el.querySelector('.ufx-pct');
  const banner = el.querySelector('.ufx-banner'), art = el.querySelector('.ufx-art');
  let cx = rect.width / 2, cy = rect.height * (use3d ? 0.45 : 0.46);

  // ── 3D 카메라 ──
  let scene = null, prevRender = null, found = null, startCam = null, camT = null;
  const tmp = new T.Vector3();
  if (use3d) {
    scene = o.preview.scene; prevRender = scene.onBeforeRender;
    try { o.setLevel?.(from); } catch {}
    found = findPart(scene, o.slot);
    startCam = o.preview.camera.position.clone();
    if (found) {
      scene.onBeforeRender = (renderer, sc, camera) => {
        prevRender?.call(sc, renderer, sc, camera);
        const f = findPart(sc, o.slot) || found; found = f;
        const box = new T.Box3().setFromObject(f.obj); if (box.isEmpty()) return;
        const center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3()).length();
        const v = PART_VIEW[o.slot] || PART_VIEW.engine;
        const dir = new T.Vector3(...v.pos).sub(new T.Vector3(...v.look)).normalize();
        if (f.splitter) dir.z = Math.abs(dir.z);
        if (f.holder) dir.applyQuaternion(f.holder.getWorldQuaternion(new T.Quaternion()));
        const r = stageEl.getBoundingClientRect(), frac = Math.max(120, Math.min(r.height, r.width)) / innerHeight;
        const want = Math.max(size * 2.6, o.slot === 'tire' ? 2.1 : o.slot === 'aero' ? 3.0 : 1.5);
        const dist = Math.max(o.slot === 'aero' ? 2.4 : 1.6, want / (2 * Math.tan(T.MathUtils.degToRad(v.fov / 2)) * frac));
        camT = center.clone().addScaledVector(dir, dist);
        const k = reduced ? 1 : ease((performance.now() - t0) / 380);
        camera.position.lerpVectors(startCam, camT, k); camera.fov = T.MathUtils.lerp(camera.fov, v.fov, k); camera.lookAt(center);
        camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        tmp.copy(center).project(camera);
        const cr = renderer.domElement.getBoundingClientRect();
        cx = (tmp.x + 1) / 2 * cr.width + cr.left - rect.left; cy = (1 - tmp.y) / 2 * cr.height + cr.top - rect.top;
        cx = Math.max(70, Math.min(rect.width - 70, cx)); cy = Math.max(80, Math.min(rect.height - 90, cy));
      };
    }
  }
  if (!use3d && art) { art.addEventListener('error', () => { art.hidden = true; }); }

  // ── 입자 ──
  const parts = [];
  const spawnIn = (n) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 120; parts.push({ k: 'in', x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a, r, life: 0.55 + Math.random() * 0.3, t: 0 }); } };
  const burst = () => { for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, s = 180 + Math.random() * 420; parts.push({ k: 'out', x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.5, t: 0, w: Math.random() < 0.3 }); } };
  const sparks = () => {
    for (let i = 0; i < 18; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, s = 120 + Math.random() * 260; parts.push({ k: 'spark', x: cx + (Math.random() - 0.5) * 30, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.45, t: 0 }); }
    for (let i = 0; i < 6; i++) parts.push({ k: 'smoke', x: cx + (Math.random() - 0.5) * 40, y: cy, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 30, life: 1.1 + Math.random() * 0.6, t: 0, r: 14 + Math.random() * 10 });
  };
  function drawParts(dt) {
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0); ctx2.clearRect(0, 0, rect.width, rect.height);
    ctx2.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.t += dt; const u = p.t / p.life;
      if (u >= 1) { parts.splice(i, 1); continue; }
      if (p.k === 'in') { const rr = p.r * (1 - ease(u)); p.x = cx + Math.cos(p.a + u * 1.5) * rr; p.y = cy + Math.sin(p.a + u * 1.5) * rr; ctx2.fillStyle = color; ctx2.globalAlpha = 0.85 * Math.sin(u * Math.PI); ctx2.beginPath(); ctx2.arc(p.x, p.y, 2.4, 0, 7); ctx2.fill(); }
      else if (p.k === 'out') { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93; ctx2.fillStyle = p.w ? '#fff' : color; ctx2.globalAlpha = 1 - u; ctx2.beginPath(); ctx2.arc(p.x, p.y, p.w ? 2 : 3, 0, 7); ctx2.fill(); }
      else if (p.k === 'spark') { p.vy += 620 * dt; p.x += p.vx * dt; p.y += p.vy * dt; ctx2.strokeStyle = u < 0.4 ? '#ffe28a' : '#ff8a2a'; ctx2.globalAlpha = 1 - u; ctx2.lineWidth = 2; ctx2.beginPath(); ctx2.moveTo(p.x, p.y); ctx2.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx2.stroke(); }
      else if (p.k === 'smoke') { ctx2.globalCompositeOperation = 'source-over'; p.x += p.vx * dt; p.y += p.vy * dt; ctx2.fillStyle = '#9aa3ad'; ctx2.globalAlpha = 0.28 * (1 - u); ctx2.beginPath(); ctx2.arc(p.x, p.y, p.r * (1 + u), 0, 7); ctx2.fill(); ctx2.globalCompositeOperation = 'lighter'; }
    }
    ctx2.globalAlpha = 1; ctx2.globalCompositeOperation = 'source-over';
  }

  // ── 진행 ──
  let t0 = performance.now(), last = t0, raf = 0, hit = false, done = false, resolveFn;
  const promise = new Promise((r) => (resolveFn = r));
  const fillTo = (f) => { fill.style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, f))); };
  const showBanner = () => {
    banner.hidden = false;
    banner.className = 'ufx-banner ' + (success ? 'ok' : 'no');
    banner.innerHTML = success
      ? `<span class="ufx-stars">${'★'.repeat(to)}${'☆'.repeat(Math.max(0, (res.next?.max || 5) - to))}</span><b>Lv.${to} 강화 성공!</b>`
      : `<b>아깝다!</b><span>${nextPct >= 100 ? '다음 강화는 100% 성공' : `다음 확률 ${nextPct}%${addPct ? ` (+${addPct}%)` : ''}`}</span><small>실패해도 단계는 그대로예요</small>`;
  };
  const strike = () => {
    if (hit) return; hit = true;
    if (success) {
      el.classList.add('ufx-ok'); fillTo(100); pctEl.textContent = '★' + to; el.querySelector('.ufx-lab small').textContent = '강화 성공';
      if (use3d) { try { o.setLevel?.(to); } catch {} } else if (art && o.thumbs?.to) art.src = o.thumbs.to;
      if (!reduced) burst();
      upgradeSound.success();
    } else {
      el.classList.add('ufx-no'); fillTo(Math.min(96, pct + 30)); pctEl.textContent = pct + '%'; el.querySelector('.ufx-lab small').textContent = '이번엔 실패';
      if (!reduced) sparks();
      upgradeSound.fail();
    }
    showBanner();
  };
  function frame(now) {
    if (done) return;
    const t = el.pausedAt ?? now - t0, dt = el.pausedAt != null ? 0.016 : Math.min(0.05, (now - last) / 1000); last = now;
    rect = place();
    gauge.style.left = cx + 'px'; gauge.style.top = cy + 'px';
    el.style.setProperty('--ufx-x', cx + 'px'); el.style.setProperty('--ufx-y', cy + 'px');
    if (art) { art.style.left = cx + 'px'; art.style.top = cy + 'px'; }
    if (!reduced && !hit) {
      const u = ease((t - 200) / (HIT - 200));
      const target = success ? 100 : Math.min(96, pct + 30);
      fillTo(u * target);
      pctEl.textContent = Math.round(u * pct) + '%';
      if (t > 200 && t < HIT - 150 && Math.random() < 0.7) spawnIn(2);
    }
    if (t >= HIT) strike();
    drawParts(dt);
    if (t >= DUR) { finish(false); return; }
    raf = requestAnimationFrame(frame);
  }
  function finish(skipped) {
    if (done) return; done = true;
    if (!hit) { reduced = true; strike(); }
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onPtr, true); window.removeEventListener('click', onPtr, true); removeEventListener('resize', onResize);
    if (scene) scene.onBeforeRender = prevRender;
    el.classList.add('ufx-out');
    setTimeout(() => el.remove(), skipped ? 0 : 260);
    resolveFn({ skipped, success });
  }
  // 건너뛰기 = 바로 결과 (결과는 이미 저장됨)
  const onKey = (e) => { e.stopImmediatePropagation(); if (['Enter', 'NumpadEnter', 'Space', 'Escape'].includes(e.code) || ['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); finish(true); } };
  const onPtr = (e) => { e.preventDefault(); e.stopImmediatePropagation(); if (e.type === 'pointerdown') finish(true); };
  const onResize = () => { rect = place(); cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr); };
  window.addEventListener('keydown', onKey, true); window.addEventListener('pointerdown', onPtr, true); window.addEventListener('click', onPtr, true); addEventListener('resize', onResize);
  if (reduced) { el.classList.add('ufx-fade'); strike(); fillTo(success ? 100 : Math.min(96, pct + 30)); }
  else upgradeSound.start();
  fillTo(reduced ? (success ? 100 : 96) : 0);
  raf = requestAnimationFrame(frame);
  // 시험·외부에서: 건너뛰기, 시각 고정(사진용 el.pausedAt = ms)
  el.skip = () => finish(true);
  el.pausedAt = null;
  o.onStart?.(el);
  return promise;
}
