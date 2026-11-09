// 연석을 밟을 때의 손맛: "드르르륵" 소리 + 카메라가 잘게 떨림
//   소리 = 낮은 사각파를 연석 줄무늬 간격(속도 ÷ 줄무늬 길이)만큼 빠르게 켰다 껐다
//   잔디에 바퀴가 빠지면 더 낮고 둔한 소리
//   N 키(엔진 소리 끄기)를 따라 같이 꺼짐
const STRIPE = 1.0; // 연석 줄무늬 하나 길이 (m)

export function createKerbFx() {
  let ctx = null, N = null;
  let muted = false;
  let phase = 0;
  let rumble = 0, grassRumble = 0, freq = 10;

  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    // 연석: 사각파 → 낮은 대역 → 줄무늬 박자에 맞춰 켜졌다 꺼짐
    const tone = ctx.createOscillator();
    tone.type = 'square';
    tone.frequency.value = 70;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 10;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(am.gain);
    tone.connect(lp).connect(am).connect(master);
    // 잔디: 낮게 걸러진 잡음
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = 260;
    const grass = ctx.createGain();
    grass.gain.value = 0;
    noise.connect(nlp).connect(grass).connect(ctx.destination);
    tone.start();
    lfo.start();
    noise.start();
    N = { master, tone, lfo, grass };
  }
  window.addEventListener('keydown', () => {
    if (!ctx) init();
    else if (ctx.state === 'suspended') ctx.resume();
  });
  window.addEventListener('pointerdown', () => {
    if (!ctx) init();
  });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  return {
    setMuted(m) {
      muted = m;
    },
    update(car, dt) {
      const v = Math.abs(car.speed);
      const on = car.grounded && !car.flying;
      rumble = on ? (car.kerbK || 0) * Math.min(1, v / 12) : 0;
      grassRumble = on && car.surface === 'ground' ? (car.offK || 0) * Math.min(1, v / 10) : 0;
      freq = Math.min(48, Math.max(3, v / STRIPE));
      phase += freq * dt;
      if (!ctx || !N) return;
      const t = ctx.currentTime;
      const paused = !!(window.game && window.game.paused);
      const k = muted || paused ? 0 : 1;
      N.master.gain.setTargetAtTime(rumble * 0.2 * k, t, 0.025);
      N.grass.gain.setTargetAtTime(grassRumble * 0.35 * k, t, 0.05);
      N.lfo.frequency.setTargetAtTime(freq, t, 0.02);
      N.tone.frequency.setTargetAtTime(60 + v * 0.9, t, 0.05);
    },
    /** 연석 위에서 카메라를 줄무늬 박자에 맞춰 위아래로 잘게 흔듦 */
    shakeCamera(camera, car) {
      if (rumble < 0.01 && grassRumble < 0.01) return;
      const bump = Math.sin(phase * Math.PI * 2) > 0 ? 1 : -1;
      const amp = rumble * 0.015 + grassRumble * 0.01 * (Math.random() - 0.5); // 예전의 절반 이하 (진동 줄이기)
      camera.position.addScaledVector(car.up, bump * amp);
    },
  };
}
