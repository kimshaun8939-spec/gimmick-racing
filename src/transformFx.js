// 변신 소리: 가속은 패널 열림 쉬익 → 레일 모터 위이잉 → 단계 잠금 → 철컥 (1.0초)
//   위이잉 = 모터(서보)가 도는 소리: 톱니파가 올라가거나(변신) 내려감(되돌아감)
//   착, 착 = 부품이 하나씩 자리 잡는 짧은 금속음 (잡음을 높은 대역만 남겨 아주 짧게)
//   철컥 = 마지막에 낮고 묵직하게 잠기는 소리
//   N 키(엔진 소리 끄기)를 따라 같이 꺼짐. 너무 자주 울리지 않게 0.4초 안에 다시 부르면 무시
export function createTransformSfx() {
  let ctx = null, out = null, noiseBuf = null;
  let muted = false;
  let lastAt = -1;
  let recentMode = 'normal';

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
      if (out) out.gain.setTargetAtTime(muted ? 0 : .55, ctx.currentTime, .01);
    },
    /** up: true = 변신(부품이 펼쳐짐), false = 원래대로 접힘 */
    play(up = true) {
      if (!ctx || muted || (window.game && window.game.paused)) return;
      const t = ctx.currentTime;
      if (t - lastAt < 0.4) return;
      lastAt = t;
      const mode = window.game?.car?.mode || 'normal';
      const accel = mode === 'accel' || (!up && recentMode === 'accel');
      recentMode = mode;
      const dur = accel ? (up ? 1.00 : .80) : (up ? .55 : .4);
      // 패널 잠금 해제 → 공기 빠지는 쉬익 → 레일 모터 → 날개 잠금.
      const air = ctx.createBufferSource(); air.buffer = noiseBuf;
      const airFilter = ctx.createBiquadFilter(); airFilter.type = 'highpass'; airFilter.frequency.value = 2800;
      const airGain = ctx.createGain();
      airGain.gain.setValueAtTime(.0001,t); airGain.gain.linearRampToValueAtTime(.065,t+.035);
      airGain.gain.exponentialRampToValueAtTime(.001,t+.23);
      air.connect(airFilter).connect(airGain).connect(out); air.start(t); air.stop(t+.25);
      click(t+.015,3200,.12);
      // 위이잉 (서보 모터)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(up ? 190 : 540, t + .12);
      osc.frequency.exponentialRampToValueAtTime(up ? 640 : 200, t + dur - .1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.22);
      g.gain.setValueAtTime(0.05, t + dur - 0.08);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(lp).connect(g).connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      // 착, 착 (부품이 자리 잡음)
      const steps = accel ? (up ? [.32, .60, .84] : [.18, .43, .62]) : (up ? [.14, .27, .4] : [.12, .26]);
      steps.forEach((s, i) => click(t + s, 2100 + i * 430, 0.14));
      // 철컥 (마지막 잠김): 낮은 음이 빠르게 떨어짐 + 짧은 금속음
      const end = t + dur;
      const thud = ctx.createOscillator();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(150, end);
      thud.frequency.exponentialRampToValueAtTime(55, end + 0.12);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, end);
      tg.gain.exponentialRampToValueAtTime(0.25, end + 0.006);
      tg.gain.exponentialRampToValueAtTime(0.001, end + 0.16);
      thud.connect(tg).connect(out);
      thud.start(end);
      thud.stop(end + 0.18);
      click(end, 1800, 0.23);
    },
  };
}
