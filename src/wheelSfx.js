// wheelfx2 (2026-11-15, 사용자 요청 "큰 바퀴 화면 전환 … 효과음 좀 넣어줘"): 화면 전환 바퀴 소리. 소리 파일 없이 WebAudio로 만듦.
//   (a) 굴러 들어올 때: 타이어 구르는 '부우웅'(빠를수록 높음, 멈추며 낮아짐) + 바람 '쉬익', 땅에 닿을 때 '쿵' + '통' '통'
//   (b) 가운데에서 돌 때: 낮은 '위이잉'(작게). 로딩이 진행될수록 살짝 높아지고, 오래 걸리면 점점 더 작아짐
//   (c) 굴러 나갈 때: 오른쪽으로 밀리며 작은 쿵 → 제자리 휠 스핀 '끼이익'(타이어 갈리는 소리) → 튀어 나가며 '휘익'(오른쪽→왼쪽)
// 그림·움직임 엔진(index.html 인라인 window.__wf)이 'wheelfx' 이벤트로 알려 줌 (type: enter·spin·rate·progress·out).
// 소리 크기: audioMix.js를 지나므로 전체·효과음 크기·소리 끄기(N·설정)·압축기·안전 상한을 그대로 따름.
//   종류는 메뉴 소리(ui)로 둠 → Esc 메뉴·결과 화면처럼 게임 소리를 일부러 끄는 곳에서 눌러도 들림 (끄기·크기는 그대로 적용)
// 자동 재생: 클릭이 있었던 앞 페이지에선 (a)가 나고, 새 페이지에선 소리 장치를 깨워 보고 되면 (b)(c), 안 되면 조용히(오류 없이).
// 움직임 줄이기면 소리도 없음.
import { setMix, mixState } from './audioMix.js';

const W = () => (typeof window !== 'undefined' ? window.__wf : null);
let ctx = null, out = null, noiseBuf = null, hum = null, failed = false;
const log = []; // 시험용: 실제로 낸 소리 (window.__wfSfx.log)

// 소리 장치를 만들어도 되나: 이 페이지에서 누른 적이 있거나, 앞 페이지에서 눌러 바퀴로 넘어온 경우(크롬은 같은 사이트 이동이면 허락)
//   주소를 직접 열거나 새로 고침(fresh)이면 만들지 않음 → 크롬의 '자동 재생 막힘' 경고도 안 뜸
function allowed() {
  try { if (navigator.userActivation && navigator.userActivation.hasBeenActive) return true; } catch {}
  const m = W() && W().main;
  return !!(m && m.mode === 'hold');
}
function ensure() {
  if (ctx || failed) return ctx;
  if (!allowed()) return null;
  try { if (mixState().muted) return null; } catch {} // 소리 끔이면 장치도 안 만듦 (나중에 켜면 그때 만듦)
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { failed = true; return null; }
  try { ctx = new AC(); } catch { failed = true; return null; }
  try { if (ctx.__bus) { ctx.__bus.cat = 'ui'; setMix({}); } } catch {}
  out = ctx.createGain(); out.gain.value = 1; out.connect(ctx.destination);
  noiseBuf = makeNoise(ctx);
  return ctx;
}
function makeNoise(c) {
  const len = Math.floor(c.sampleRate * 1.2), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
  let s = 12345; for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 1073741823.5) - 1; }
  return b;
}
const reduced = () => !!(W() && W().RM);
/** 소리를 낼 수 있나 (막혀 있으면 깨워 봄). 깨어나지 않으면 false — 이때 미리 예약하면 나중에 한꺼번에 터지므로 아무것도 안 함 */
async function live() {
  if (reduced() || !ensure()) return false;
  if (ctx.state === 'running') return true;
  try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 160))]); } catch {}
  return ctx.state === 'running';
}
// performance.now() 기준 시각 → 소리 장치 시각
const T = (at) => ctx.currentTime + Math.max(0, ((at ?? performance.now()) - performance.now()) / 1000);

// ---------------------------------------------------------------- 조각 소리 (c = 소리 장치, dst = 내보낼 곳: 시험에서는 OfflineAudioContext)
function noise(c, buf, t, dur) { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(t, Math.random() * .5); s.stop(t + dur + .05); return s; }
function env(c, t, pts) { const g = c.createGain(); g.gain.setValueAtTime(0, t); for (const [dt, v] of pts) g.gain.linearRampToValueAtTime(v, t + dt); return g; }
/** 쿵 / 통: 짧게 떨어지는 낮은 음 + 짧은 잡음 */
function thump(c, dst, buf, t, k, f0, f1) {
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + .16);
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.32 * k, t + .006); g.gain.exponentialRampToValueAtTime(.001, t + .09 + .16 * k);
  o.connect(g).connect(dst); o.start(t); o.stop(t + .4);
  const n = noise(c, buf, t, .1), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
  const ng = c.createGain(); ng.gain.setValueAtTime(.2 * k, t); ng.gain.exponentialRampToValueAtTime(.001, t + .07);
  n.connect(lp).connect(ng).connect(dst);
}
/** (a) 굴러 들어오기: dur 초, cover = 덮으며 들어옴(크게) / fresh = 짧게 */
export function synthEnter(c, dst, buf, t, dur, hits, cover) {
  const k = cover ? 1 : .7, end = t + dur;
  // 타이어 구름: 낮은 잡음을 트레드 박자로 떨게 함 (빠르다가 멈추며 느려짐)
  const n = noise(c, buf, t, dur), lp = c.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(220, end);
  const g = env(c, t, [[.03, .2 * k], [dur * .5, .13 * k], [dur * .9, .04 * k], [dur, 0]]);
  const am = c.createGain(); am.gain.value = .65;
  const lfo = c.createOscillator(); lfo.frequency.setValueAtTime(52, t); lfo.frequency.exponentialRampToValueAtTime(7, end);
  const lfoG = c.createGain(); lfoG.gain.value = .35; lfo.connect(lfoG).connect(am.gain); lfo.start(t); lfo.stop(end + .05);
  n.connect(lp).connect(am).connect(g).connect(dst);
  // 부우웅: 낮은 톱니파, 높음 → 낮음
  const o = c.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(52, t + dur * .85);
  const of = c.createBiquadFilter(); of.type = 'lowpass'; of.frequency.setValueAtTime(700, t); of.frequency.exponentialRampToValueAtTime(240, end);
  const og = env(c, t, [[.05, .085 * k], [dur * .55, .06 * k], [dur * .95, 0]]);
  o.connect(of).connect(og).connect(dst); o.start(t); o.stop(end + .05);
  // 쉬익: 바람 (높음 → 낮음), 오른쪽에서 가운데로
  const w = noise(c, buf, t, dur * .7), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = .9;
  bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(480, t + dur * .65);
  const wg = env(c, t, [[.04, .13 * k], [dur * .3, .07 * k], [dur * .65, 0]]);
  let wd = dst;
  if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.setValueAtTime(.7, t); p.pan.linearRampToValueAtTime(0, t + dur * .6); p.connect(dst); wd = p; }
  w.connect(bp).connect(wg).connect(wd);
  // 쿵 + 통 + 통
  thump(c, dst, buf, t + hits[0] / 1000, 1 * k, 100, 42);
  thump(c, dst, buf, t + hits[1] / 1000, .42 * k, 135, 70);
  thump(c, dst, buf, t + hits[2] / 1000, .2 * k, 150, 85);
}
/** (c) 굴러 나가기: 오른쪽으로 살짝 밀림(작은 쿵) → 제자리 휠 스핀 '끼이익'(+ 타이어 갈리는 잡음) → 튀어 나가며 '휘익'(오른쪽→왼쪽)
 *  o = { spinAt, spinDur, launchAt } 초 (없으면 기본 순서) */
export function synthOut(c, dst, buf, t, dur, o = {}) {
  dur = dur || 1.18;
  const sa = o.spinAt ?? .22, sd = o.spinDur ?? .35, la = o.launchAt ?? .58, rest = Math.max(.3, dur - la);
  // 밀림: 눌리는 작은 쿵
  thump(c, dst, buf, t + .03, .22, 120, 60);
  // 끼이익: 두 개의 높은 네모파를 좁은 대역으로 + 떨림. 헛도는 동안 크고 튀어 나가며 줄어듦
  const sq = c.createGain(); sq.gain.setValueAtTime(0, t + sa); sq.gain.linearRampToValueAtTime(.085, t + sa + .05); sq.gain.linearRampToValueAtTime(.07, t + sa + sd);
  sq.gain.linearRampToValueAtTime(.02, t + la + .12); sq.gain.linearRampToValueAtTime(0, t + la + .26);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(1500, t + sa); bp.frequency.linearRampToValueAtTime(1900, t + la + .2); bp.Q.value = 4;
  const vib = c.createOscillator(); vib.frequency.value = 29; const vg = c.createGain(); vg.gain.value = 45; vib.connect(vg); vib.start(t + sa); vib.stop(t + la + .3);
  for (const f of [1150, 1240]) { const x = c.createOscillator(); x.type = 'square'; x.frequency.setValueAtTime(f, t + sa); x.frequency.linearRampToValueAtTime(f * 1.1, t + la + .25); vg.connect(x.frequency); x.connect(bp); x.start(t + sa); x.stop(t + la + .3); }
  bp.connect(sq).connect(dst);
  // 타이어가 갈리는 잡음 (연기 소리)
  const gr = noise(c, buf, t + sa, sd + .3), gb = c.createBiquadFilter(); gb.type = 'bandpass'; gb.frequency.value = 900; gb.Q.value = .7;
  const gg = env(c, t + sa, [[.05, .09], [sd, .08], [sd + .25, 0]]);
  gr.connect(gb).connect(gg).connect(dst);
  // 휘익: 낮음 → 높음, 오른쪽 → 왼쪽
  const w = noise(c, buf, t + la - .05, rest + .1), wb = c.createBiquadFilter(); wb.type = 'bandpass'; wb.Q.value = 1.1;
  wb.frequency.setValueAtTime(380, t + la); wb.frequency.exponentialRampToValueAtTime(2800, t + la + rest * .8);
  const wg = env(c, t + la - .05, [[.05, 0], [rest * .4, .15], [rest * .95, 0]]);
  let wd = dst;
  if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.setValueAtTime(.25, t + la); p.pan.linearRampToValueAtTime(-.8, t + dur); p.connect(dst); wd = p; }
  w.connect(wb).connect(wg).connect(wd);
  // 굴러 나가는 소리 조금
  const r = noise(c, buf, t + la, rest), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
  const rg = env(c, t + la, [[.06, .09], [rest * .8, 0]]);
  r.connect(lp).connect(rg).connect(dst);
}
/** (b) 회전 위이잉: 돌려주는 손잡이로 높이·멈춤을 바꿈 */
export function synthHum(c, dst, t) {
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.06, t + .5);
  g.gain.linearRampToValueAtTime(.045, t + 3); g.gain.linearRampToValueAtTime(.03, t + 9); // 오래 걸려도 지루하지 않게 점점 작게
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
  const trem = c.createGain(); trem.gain.value = .88;
  const tl = c.createOscillator(); tl.frequency.value = .6; const tg = c.createGain(); tg.gain.value = .12; tl.connect(tg).connect(trem.gain); tl.start(t);
  const oscs = [['triangle', 1, .7], ['sine', 2, .35], ['sawtooth', 4, .05]].map(([type, mul, v]) => {
    const o = c.createOscillator(); o.type = type; const og = c.createGain(); og.gain.value = v; o.connect(og).connect(lp); o.start(t); return { o, mul };
  });
  lp.connect(trem).connect(g).connect(dst);
  const base = (p, rate) => (60 + .5 * Math.max(0, Math.min(100, p))) * (.92 + .08 * Math.min(1.6, rate || 1));
  const set = (p, rate, at = c.currentTime) => { const f = base(p, rate); for (const x of oscs) x.o.frequency.setTargetAtTime(f * x.mul, at, .12); };
  set(10, 1, t);
  return {
    set,
    stop(at = c.currentTime, fade = .25) {
      // 지금 크기에서 부드럽게 0으로 (gain.value는 아직 안 그린 시각이면 1을 돌려줄 수 있어 쓰지 않음)
      if (g.gain.cancelAndHoldAtTime) { g.gain.cancelAndHoldAtTime(at); g.gain.linearRampToValueAtTime(0, at + fade); }
      else { g.gain.cancelScheduledValues(at); g.gain.setTargetAtTime(0, at, fade / 3); }
      for (const x of oscs) { x.o.frequency.setTargetAtTime(x.o.frequency.value * .8, at, .1); x.o.stop(at + fade + .05); }
      tl.stop(at + fade + .05);
    },
  };
}

// ---------------------------------------------------------------- 엔진 이벤트 연결
let humP = 10, humRate = 1, humWant = false;
async function startHum() {
  humWant = true;
  if (hum || !(await live()) || !humWant || hum) return;
  hum = synthHum(ctx, out, ctx.currentTime); log.push({ s: 'hum', t: performance.now() });
  hum.set(humP, humRate);
}
function stopHum(at) { humWant = false; if (hum) { log.push({ s: 'humStop', t: performance.now() }); try { hum.stop(T(at)); } catch {} hum = null; } }
async function onEvent(e) {
  const d = e.detail || {};
  try {
    if (d.type === 'enter') {
      if (!(await live())) return;
      synthEnter(ctx, out, noiseBuf, T(d.at), d.dur / 1000, d.hits, d.cover); log.push({ s: 'enter', cover: !!d.cover, t: performance.now() });
    } else if (d.type === 'spin') { if (d.main) startHum(); }
    else if (d.type === 'progress') { humP = d.p; if (hum) hum.set(humP, humRate); }
    else if (d.type === 'rate') { humRate = d.rate; if (hum) hum.set(humP, humRate); }
    else if (d.type === 'out') {
      stopHum(d.at);
      if (d.rm || !(await live())) return;
      synthOut(ctx, out, noiseBuf, T(d.at), d.dur / 1000, { spinAt: d.spinAt / 1000, spinDur: d.spinDur / 1000, launchAt: d.launchAt / 1000 }); log.push({ s: 'out', t: performance.now() });
    }
  } catch {}
}
if (typeof window !== 'undefined' && !window.__wfSfx) {
  window.__wfSfx = { log, get ctx() { return ctx; }, get hum() { return !!hum; }, synthEnter, synthOut, synthHum, makeNoise };
  window.addEventListener('wheelfx', onEvent);
  // 이 모듈이 늦게 불러와졌을 때: 이 페이지의 바퀴가 아직 돌고 있으면 위이잉부터
  const m = W() && W().main;
  if (m && !m.done && (m.mode === 'hold' || m.mode === 'fresh')) {
    humP = m.progress >= 0 ? m.progress : 10; humRate = m.rate || 1;
    startHum();
  }
  // 막혀 있던 소리 장치가 첫 키·터치로 깨어나면 아직 도는 중일 때만 위이잉
  const wake = () => { if (humWant && !hum && ctx) startHum(); };
  window.addEventListener('keydown', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });
}
