// 모든 합성음을 한 출력으로 모음. 각 소리는 자기 볼륨 버스를 가진 AudioContext 모양의 손잡이를 받음.
// 실제 장치는 하나: 여러 효과가 겹쳐도 마지막 압축기와 안전 상한을 함께 통과함.
const buses = [];
const mix = { master: 1, engine: 1, fx: 1, muted: false, duck: false };
let output = null, background = document.hidden, leaving = false, worldSilent = false;

function level(cat) {
  if (mix.muted || background || leaving) return 0;
  // 메뉴 소리는 일시정지 중에도 들리며, 전체·효과음 손잡이는 실시간으로 따름.
  if (cat === 'ui') return mix.master * mix.fx;
  if (mix.duck || (worldSilent && cat !== 'result')) return 0;
  return mix.master * (cat === 'engine' ? mix.engine : mix.fx);
}
function categoryFromStack() {
  const s = new Error().stack || '';
  if (/engineAudio\.js/.test(s)) return 'engine';
  if (/settings\.js/.test(s)) return 'ui';
  if (/hud\.js/.test(s)) return 'result';
  return 'fx';
}
(function install() {
  const RealAC = window.AudioContext || window.webkitAudioContext;
  if (!RealAC || RealAC.__mixed) return;
  function hardware(args) {
    if (output && output.ctx.state !== 'closed') return output;
    const ctx = new RealAC(...args), sum = ctx.createGain(), comp = ctx.createDynamicsCompressor(), ceiling = ctx.createWaveShaper();
    comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 20;
    comp.attack.value = .002; comp.release.value = .18;
    // 보통 크기는 그대로. 순간적으로 아주 큰 값만 부드럽게 눌러 ±0.9 아래에 둠.
    const curve = new Float32Array(65537);
    for (let i = 0; i < curve.length; i++) {
      const x = i * 2 / (curve.length - 1) - 1, a = Math.abs(x);
      curve[i] = a <= .75 ? x : Math.sign(x) * (.75 + .15 * (1 - Math.exp(-(a - .75) / .15)));
    }
    ceiling.curve = curve; ceiling.oversample = 'none';
    // 압축기의 자동 보상으로 평소 소리까지 커지지 않도록 맞춤.
    const trim = ctx.createGain(); trim.gain.value = .65;
    sum.connect(comp).connect(trim).connect(ceiling).connect(ctx.destination);
    output = { ctx, sum, comp };
    return output;
  }
  function MixedAudioContext(...args) {
    const { ctx, sum } = hardware(args), cat = categoryFromStack(), gain = ctx.createGain();
    gain.gain.value = level(cat); gain.connect(sum);
    const bus = { ctx, gain, cat }; buses.push(bus);
    const methods = new Map();
    // 네이티브 Web Audio 메서드는 실제 장치를 this로 받아야 하므로 한 번만 bind해서 돌려줌.
    return new Proxy(ctx, { get(target, key) {
      if (key === 'destination') return gain;
      if (key === '__bus') return bus;
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (!methods.has(key)) methods.set(key, value.bind(target));
      return methods.get(key);
    }, set(target, key, value) { return Reflect.set(target, key, value, target); } });
  }
  // 첫 메뉴음이 출력 장치의 시작과 겹치지 않게 첫 키·터치에서 미리 깨움.
  const wake = () => {
    try { const ctx = hardware([]).ctx; if (ctx.state === 'suspended') ctx.resume().catch(() => {}); } catch {}
  };
  window.addEventListener('pointerdown', wake, { once: true, passive: true });
  window.addEventListener('keydown', wake, { once: true, passive: true });
  MixedAudioContext.prototype = RealAC.prototype;
  Object.setPrototypeOf(MixedAudioContext, RealAC);
  MixedAudioContext.__mixed = true;
  window.AudioContext = MixedAudioContext;
  if (window.webkitAudioContext) window.webkitAudioContext = MixedAudioContext;
})();
function apply(fast = false) {
  for (const b of buses) {
    if (b.ctx.state === 'closed') continue;
    try { b.gain.gain.setTargetAtTime(level(b.cat), b.ctx.currentTime, fast ? .015 : .04); } catch {}
  }
}
export function setMix(v) { Object.assign(mix, v); apply(); }
export function duckAudio(on) { if (mix.duck !== on) { mix.duck = on; apply(true); } }
export function mixState() { return { ...mix, background, worldSilent, contexts: buses.map(b => b.cat), devices: output && output.ctx.state !== 'closed' ? 1 : 0, reduction: output?.comp.reduction || 0 }; }
// 화면 갱신이 멈춘 뒤에도 마지막 바람/용암 루프가 남지 않도록 출력단에서 막음.
function syncWorld() {
  const g = window.game;
  const silent = !!(g && (g.paused || g.replay?.active || g.race?.phase === 'finished'));
  if (silent !== worldSilent) { worldSilent = silent; apply(true); }
}
setInterval(syncWorld, 100);
window.addEventListener('blur', () => { background = true; apply(true); });
window.addEventListener('focus', () => { background = document.hidden; syncWorld(); apply(true); });
document.addEventListener('visibilitychange', () => { background = document.hidden; syncWorld(); apply(true); });
window.addEventListener('pagehide', () => { leaving = true; apply(true); });
window.addEventListener('pageshow', () => { leaving = false; background = document.hidden; syncWorld(); apply(true); });
