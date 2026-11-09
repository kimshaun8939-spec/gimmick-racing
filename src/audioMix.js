// 소리 크기 조절판 (믹서)
//   엔진음(engineAudio.js), 변신음(transformFx.js), 연석(kerbFx.js), 바람(speedFx.js)은 각자 AudioContext를 만들어
//   스피커(ctx.destination)로 바로 보냄 → 그 파일들을 고치지 않고 크기를 조절하려고,
//   AudioContext를 살짝 감싸서 "스피커" 앞에 볼륨 손잡이(GainNode)를 하나씩 끼워 넣음.
//   어느 파일이 만든 소리인지는 만들 때의 호출 기록(stack)으로 구분: engineAudio.js = 엔진, settings.js = 메뉴 소리, 나머지 = 효과음
//   이 파일은 다른 소리 파일들이 AudioContext를 만들기 전에(첫 키 입력 전에) 불러와야 함 → main.js 맨 위에서 import

const buses = [];
const mix = { master: 1, engine: 1, fx: 1, muted: false, duck: false };

function level(cat) {
  if (mix.muted || mix.duck) return 0;
  if (cat === 'ui') return 1; // 메뉴 소리는 settings.js가 직접 크기를 맞춤
  return mix.master * (cat === 'engine' ? mix.engine : mix.fx);
}

function categoryFromStack() {
  const s = new Error().stack || '';
  if (/engineAudio\.js/.test(s)) return 'engine';
  if (/settings\.js/.test(s)) return 'ui';
  return 'fx';
}

(function install() {
  const RealAC = window.AudioContext || window.webkitAudioContext;
  if (!RealAC || RealAC.__mixed || typeof BaseAudioContext === 'undefined') return;
  const desc = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination');
  if (!desc || !desc.get) return;
  const realDest = desc.get;
  class MixedAudioContext extends RealAC {
    constructor(...args) {
      super(...args);
      const cat = categoryFromStack();
      const gain = this.createGain();
      gain.gain.value = level(cat);
      gain.connect(realDest.call(this));
      this.__bus = { ctx: this, gain, cat };
      buses.push(this.__bus);
    }
    get destination() {
      return this.__bus ? this.__bus.gain : realDest.call(this);
    }
  }
  MixedAudioContext.__mixed = true;
  window.AudioContext = MixedAudioContext;
  if (window.webkitAudioContext) window.webkitAudioContext = MixedAudioContext;
})();

function apply(fast = false) {
  for (const b of buses) {
    try {
      b.gain.gain.setTargetAtTime(level(b.cat), b.ctx.currentTime, fast ? 0.02 : 0.06);
    } catch {}
  }
}

/** 소리 크기 바꾸기: { master, engine, fx (0~1), muted } */
export function setMix(v) {
  Object.assign(mix, v);
  apply();
}

/** 일시정지 메뉴가 열려 있는 동안 게임 소리를 잠시 끔 */
export function duckAudio(on) {
  if (mix.duck === on) return;
  mix.duck = on;
  apply(true);
}

export function mixState() {
  return { ...mix, contexts: buses.map((b) => b.cat) };
}
