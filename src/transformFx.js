// 변신 소리: 모드가 바뀌거나 부스터로 변신할 때 "위이잉 - 착, 착 - 철컥"
//   위이잉 = 모터(서보)가 도는 소리: 톱니파가 올라가거나(변신) 내려감(되돌아감)
//   착, 착 = 부품이 하나씩 자리 잡는 짧은 금속음 (잡음을 높은 대역만 남겨 아주 짧게)
//   철컥 = 마지막에 낮고 묵직하게 잠기는 소리
//   N 키(엔진 소리 끄기)를 따라 같이 꺼짐. 너무 자주 울리지 않게 0.4초 안에 다시 부르면 무시
export function createTransformSfx() {
  let ctx = null, out = null, noiseBuf = null;
  let muted = false;
  let lastAt = -1;

  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.3);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  window.addEventListener('keydown', () => {
    if (!ctx) init();
    else if (ctx.state === 'suspended') ctx.resume();
  });
  window.addEventListener('pointerdown', () => {
    if (!ctx) init();
  });

  /** 짧은 금속음 하나 (t: 시작 시각, f: 밝기, v: 크기) */
  function click(t, f, v) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.08);
  }

  return {
    setMuted(m) {
      muted = m;
    },
    /** up: true = 변신(부품이 펼쳐짐), false = 원래대로 접힘 */
    play(up = true) {
      if (!ctx || muted || (window.game && window.game.paused)) return;
      const t = ctx.currentTime;
      if (t - lastAt < 0.4) return;
      lastAt = t;
      const dur = up ? 0.55 : 0.4;
      // 위이잉 (서보 모터)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(up ? 220 : 620, t);
      osc.frequency.exponentialRampToValueAtTime(up ? 640 : 200, t + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.05);
      g.gain.setValueAtTime(0.05, t + dur - 0.08);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(lp).connect(g).connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      // 착, 착 (부품이 자리 잡음)
      const steps = up ? [0.14, 0.27, 0.4] : [0.12, 0.26];
      steps.forEach((s, i) => click(t + s, 2600 + i * 500, 0.22));
      // 철컥 (마지막 잠김): 낮은 음이 빠르게 떨어짐 + 짧은 금속음
      const end = t + dur;
      const thud = ctx.createOscillator();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(150, end);
      thud.frequency.exponentialRampToValueAtTime(55, end + 0.12);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, end);
      tg.gain.exponentialRampToValueAtTime(0.35, end + 0.006);
      tg.gain.exponentialRampToValueAtTime(0.001, end + 0.16);
      thud.connect(tg).connect(out);
      thud.start(end);
      thud.stop(end + 0.18);
      click(end, 1800, 0.3);
    },
  };
}
