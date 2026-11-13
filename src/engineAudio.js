// 엔진 소리 (Web Audio로 직접 합성, 파일 없음)
//   대배기량 스포츠카(V8 느낌) 엔진음: 낮고 묵직한 폭발음 + 으르렁거리는 찌그러짐
//   - 게임 rpm(4000~12500)을 낮은 폭발 주파수(약 46~205Hz)로 바꿔서 '모기 소리' 대신 굵은 소리
//   - 엔진 한 사이클(실린더 8번 폭발)을 버퍼로 만들어 반복 재생 → 고르지 않은 폭발이 '두둥두둥' 울림
//   - 소프트 클리핑(WaveShaper)으로 으르렁, 페달·rpm에 따라 로우패스가 열려 거칠어짐
//   - 가속 페달을 떼면 배기 팝/크래클, 가속 모드는 터보 휘슬 + 블로오프 '피식'
//   - 보트 모드(물 위)는 먹먹한 선박 엔진 + 물소리, 물에 가라앉으면 점점 먹먹해짐
//   브라우저 규칙상 첫 키 입력 뒤에 소리가 시작됨. N 키로 끄고 켜기

const MASTER = 0.2; // 최종 음량 (압축기 뒤). 크거나 작으면 이 값만 조절
const F_REF = 100; // 사이클 버퍼를 원래 속도로 재생할 때의 폭발 주파수(Hz)

/**
 * 차마다 다른 엔진 소리 (2026-11-09): car.json/cars.json의 "sound" 블록이 아래 기본값을 덮어씀.
 *   기본값 = 레드 포뮬러(f1)의 원래 V8 소리 그대로
 *   cyl: 한 사이클 폭발 수, amps/offs: 폭발마다 세기·간격 어긋남 (고르지 않을수록 '두둥두둥')
 *   fBase/fRange: 공회전·레드라인 음높이(Hz), pulse/saw/sub: 울렁이는 폭발음·매끈한 톱니파·저음 비율
 *   grit: 찌그러짐 세기, drive: 드라이브 배율, bright: 로우패스 열림 배율, tex: 흡기·배기 바람 질감
 *   eqFreq/eqGain: 강조 대역, turbo: 가속 모드가 아니어도 도는 터보(0~1), turboMax: 터보 최대 크기 배율
 *   whine: 슈퍼차저·기어 윙윙 (0~1), whineMul: 그 음높이 배수, pops: 배기 팝 빈도·세기 배율
 *   boostRoar: E 부스터 때 로켓 굉음 (0~1), electric: 하이브리드 전기 모터 휘잉 (0~1)
 */
export const SOUND_DEFAULTS = {
  cyl: 8,
  amps: [1, 0.74, 0.93, 0.68, 0.97, 0.79, 0.86, 0.71],
  offs: [0, 0.07, -0.03, 0.05, 0.01, -0.06, 0.04, -0.02],
  fBase: 46, fRange: 150,
  pulse: 1, saw: 1, sub: 1, grit: 2.8, drive: 1, bright: 1, tex: 1,
  eqFreq: 140, eqGain: 6,
  turbo: 0, turboMax: 1,
  whine: 0, whineMul: 3,
  pops: 1, boostRoar: 0, electric: 0,
  volume: 1,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createEngineAudio(sound = {}) {
  const P = { ...SOUND_DEFAULTS, ...(sound || {}) };
  const CYL = Math.max(1, Math.round(P.cyl));
  let ctx = null;
  let N = null; // 미리 만들어 둔 노드 모음
  let noiseBuf = null;
  let muted = false;
  // 프레임 사이에 기억하는 상태
  let lastT = 0;
  let spool = 0; // 터보 회전 (0~1)
  let onThrottle = false; // 페달을 깊게 밟고 있었는지 (떼는 순간 감지용)
  let popTime = 0; // 남은 팝/크래클 시간(초)
  let wasShifting = false;
  let lastDrift = null; // 마지막으로 본 드리프트 결과 (car.lastDriftInfo.t)

  // 흰 잡음 버퍼 (흡기·배기 질감, 터보 바람, 물소리, 팝에 같이 씀)
  function makeNoise(sec) {
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 엔진 한 사이클 파형: 폭발 8번, 세기와 간격을 조금씩 다르게 해서 V8 특유의 울렁임
  function makeCycleBuffer() {
    const sr = ctx.sampleRate;
    const len = Math.round((sr * CYL) / F_REF);
    const T = len / CYL; // 폭발 한 번의 길이(샘플)
    const d = new Float32Array(len);
    const amps = Array.from({ length: CYL }, (_, c) => P.amps[c % P.amps.length] ?? 1);
    const offs = Array.from({ length: CYL }, (_, c) => P.offs[c % P.offs.length] ?? 0);
    const span = Math.floor(T * 1.8);
    for (let c = 0; c < CYL; c++) {
      const start = Math.round((c + offs[c]) * T);
      for (let k = 0; k < span; k++) {
        const u = k / T;
        let v = 0;
        // 배기 압력 펄스 (부드러운 혹 모양이라 높은 소리가 덜 깨짐)
        if (u < 0.32) {
          const s = Math.sin((Math.PI * u) / 0.32);
          v += s * s;
        }
        // 배기관 울림 (빠르게 사그라드는 진동 → 거친 질감)
        v += Math.exp(-u / 0.28) * Math.sin(2 * Math.PI * 3.3 * u) * 0.45 * Math.min(1, u / 0.04);
        const idx = (((start + k) % len) + len) % len; // 끝이 처음으로 이어지게 (끊김 없는 반복)
        d[idx] += amps[c] * v;
      }
    }
    // 직류 성분 제거 + 최대값 1로 맞춤
    let mean = 0;
    for (let i = 0; i < len; i++) mean += d[i];
    mean /= len;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      d[i] -= mean;
      peak = Math.max(peak, Math.abs(d[i]));
    }
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    for (let i = 0; i < len; i++) out[i] = d[i] / peak;
    return buf;
  }

  // 부드러운 찌그러짐 곡선 (살짝 비대칭 → 짝수 배음이 생겨 따뜻하고 으르렁거림)
  function makeCurve() {
    const n = 2048;
    const c = new Float32Array(n);
    const k = P.grit;
    const norm = Math.tanh(k * 1.08);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * (x + 0.08 * x * x)) / norm;
    }
    return c;
  }

  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    noiseBuf = makeNoise(2);
    const gain = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const biquad = (type, freq, q) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const noiseLoop = (offset) => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      s.start(0, offset);
      return s;
    };

    // ── 출력단: 환경 필터(물속 먹먹함) → 압축기 → 음소거/일시정지 → 스피커
    const out = gain(0);
    out.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(out);
    const envGain = gain(1);
    envGain.connect(comp);
    const envLP = biquad('lowpass', 18000, 0.7);
    envLP.connect(envGain);

    // ── 엔진 본체: 사이클 버퍼 + 톱니파 → 드라이브 → 찌그러짐 → 직류 제거
    const pulse = ctx.createBufferSource();
    pulse.buffer = makeCycleBuffer();
    pulse.loop = true;
    const pulseG = gain(0.8);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const sawG = gain(0.15);
    const drive = gain(0.4);
    pulse.connect(pulseG).connect(drive);
    saw.connect(sawG).connect(drive);
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeCurve();
    shaper.oversample = '2x';
    const dcCut = biquad('highpass', 30, 0.7);
    const body = gain(1);
    drive.connect(shaper).connect(dcCut).connect(body);
    // 기본음 보강용 사인파 (찌그러짐을 거치지 않아 깔끔한 저음)
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const subG = gain(0.25);
    sub.connect(subG).connect(body);
    // 흡기·배기 바람 소리 질감
    const texSrc = noiseLoop(0);
    const texBP = biquad('bandpass', 800, 0.8);
    const texG = gain(0);
    texSrc.connect(texBP).connect(texG).connect(body);
    // 저중음 강조 → 로우패스(페달·rpm에 따라 열림) → 엔진 음량
    const eq = biquad('peaking', P.eqFreq, 0.8);
    eq.gain.value = P.eqGain;
    const lp = biquad('lowpass', 800, 0.9);
    const engG = gain(0);
    body.connect(eq).connect(lp).connect(engG).connect(envLP);

    // ── 터보 (가속 모드): 휘슬 사인파 + 높은 바람 소리
    const whistle = ctx.createOscillator();
    whistle.type = 'sine';
    whistle.frequency.value = 2200;
    const whistleG = gain(0);
    whistle.connect(whistleG).connect(envLP);
    const hissSrc = noiseLoop(0.7);
    const hissBP = biquad('bandpass', 3000, 2.5);
    const hissG = gain(0);
    hissSrc.connect(hissBP).connect(hissG).connect(envLP);

    // ── 슈퍼차저·기어 윙윙 (rpm을 따라 올라가는 삼각파), 전기 모터 휘잉 (사인파)
    const whine = ctx.createOscillator();
    whine.type = 'triangle';
    const whineG = gain(0);
    whine.connect(whineG).connect(envLP);
    const elec = ctx.createOscillator();
    elec.type = 'sine';
    const elecG = gain(0);
    elec.connect(elecG).connect(envLP);
    // ── 로켓 굉음 (E 부스터): 낮게 깎은 잡음이 크게 울림
    const roarSrc = noiseLoop(0.4);
    const roarLP = biquad('lowpass', 600, 0.6);
    const roarG = gain(0);
    roarSrc.connect(roarLP).connect(roarG).connect(envLP);

    // ── 팝/크래클·블로오프가 들어가는 통로 (엔진 로우패스는 거치지 않음)
    const fxBus = gain(1);
    fxBus.connect(envLP);

    // ── 물소리: 낮게 깎은 잡음을 천천히 출렁이게 (환경 필터 밖, 압축기로 직행)
    const waterSrc = noiseLoop(1.3);
    const waterLP = biquad('lowpass', 650, 0.5);
    const waterMod = gain(0.6);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.55;
    const lfoG = gain(0.4);
    lfo.connect(lfoG).connect(waterMod.gain);
    const waterG = gain(0);
    waterSrc.connect(waterLP).connect(waterMod).connect(waterG).connect(comp);

    // ── 타이어 비명 (2026-11-10): 떨리는 톱니파를 좁은 대역으로 깎은 '끼이익' + 높은 잡음 '쉬익'
    //   car.tyreSlip(0~1)만큼: 옆으로 미끄러짐·앞 밀림·바퀴 헛돎·브레이크 잠김·드리프트
    const sq = ctx.createOscillator();
    sq.type = 'sawtooth';
    sq.frequency.value = 900;
    const sqVib = ctx.createOscillator(); // 음높이 떨림
    sqVib.frequency.value = 7.3;
    const sqVibG = gain(28);
    sqVib.connect(sqVibG).connect(sq.frequency);
    const sqBP = biquad('bandpass', 1300, 7);
    const sqAM = gain(0.75); // 크기 떨림 (고무가 노면을 긁는 느낌)
    const sqAMlfo = ctx.createOscillator();
    sqAMlfo.frequency.value = 17;
    const sqAMg = gain(0.25);
    sqAMlfo.connect(sqAMg).connect(sqAM.gain);
    const sqG = gain(0);
    sq.connect(sqBP).connect(sqAM).connect(sqG).connect(envLP);
    const sqNoise = noiseLoop(0.9);
    const sqNBP = biquad('bandpass', 2400, 2.2);
    const sqNG = gain(0);
    sqNoise.connect(sqNBP).connect(sqNG).connect(envLP);

    pulse.start();
    for (const o of [saw, sub, whistle, lfo, whine, elec, sq, sqVib, sqAMlfo]) o.start();

    N = { out, envGain, envLP, pulse, pulseG, saw, sawG, drive, sub, subG, texBP, texG, lp, engG,
      whistle, whistleG, hissBP, hissG, fxBus, waterG, whine, whineG, elec, elecG, roarLP, roarG,
      sq, sqBP, sqG, sqNBP, sqNG, sqVibG };
    lastT = ctx.currentTime;
  }

  // 배기 팝(낮은 '퍽') 또는 크래클(높은 '탁'): 짧은 잡음 조각을 빠르게 줄임
  function firePop(strength) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const crackle = Math.random() < 0.4;
    let peak, dec;
    if (crackle) {
      f.type = 'bandpass';
      f.frequency.value = 1400 + Math.random() * 1600;
      f.Q.value = 1.2;
      peak = 0.6;
      dec = 0.012 + Math.random() * 0.012;
    } else {
      f.type = 'lowpass';
      f.frequency.value = 500 + Math.random() * 700;
      f.Q.value = 1.5;
      peak = 1.1;
      dec = 0.03 + Math.random() * 0.04;
    }
    peak *= strength * (0.6 + 0.4 * Math.random());
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, dec);
    src.connect(f).connect(g).connect(N.fxBus);
    src.start(t, Math.random() * 1.5, dec * 7 + 0.01);
  }

  // 깔끔한 드리프트 탈출 '띵-딩': 짧은 두 음 (품질이 높으면 더 높고 밝게)
  function chime(q) {
    const t = ctx.currentTime;
    const base = q > 0.75 ? 1046 : 880;
    [0, 0.08].forEach((d, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * (i ? 1.5 : 1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.09 * (0.6 + 0.4 * q), t + d + 0.01);
      g.gain.setTargetAtTime(0, t + d + 0.02, 0.09);
      o.connect(g).connect(N.fxBus);
      o.start(t + d);
      o.stop(t + d + 0.6);
    });
  }

  // 블로오프 밸브 '피시익': 높은 잡음이 아래로 미끄러지며 사라짐
  function blowOff(amount) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(4200, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4 * amount, t + 0.02);
    g.gain.setTargetAtTime(0, t + 0.03, 0.12);
    src.connect(bp).connect(g).connect(N.fxBus);
    src.start(t, Math.random() * 1.0, 0.8);
  }

  // 터치로 처음 출발해도 엔진 출력이 0으로 남지 않게 키보드와 같은 준비를 해요.
  const wake = () => {
    if (!ctx) init();
    else if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  window.addEventListener('keydown', wake);
  window.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  return {
    /** 소리 끄기/켜기. 꺼졌으면 true */
    toggleMute() {
      muted = !muted;
      return muted;
    },
    update(car) {
      if (!ctx || !N) return;
      const t = ctx.currentTime;
      const dt = clamp(t - lastT, 0, 0.1);
      lastT = t;
      const paused = !!(window.game && window.game.paused);
      const silent = muted || paused;

      const rpm = car.rpm || 4000;
      const thr = clamp(car.thr || 0, 0, 1);
      const rpmN = clamp((rpm - 4000) / 8000, 0, 1.1); // 공회전 0, 레드라인 1
      const grounded = car.grounded !== false;
      const accel = car.mode === 'accel';
      const onWater = car.mode === 'boat' && car.surface === 'water' && grounded;
      const sink = clamp(car.sink || 0, 0, 1);
      const shifting = car.shiftTimer > 0;
      const boosting = car.boostTime > 0;
      const load = thr * (grounded ? 1 : 0.55); // 공중에선 부하가 없어 헛도는 소리

      // ── 음높이: 4000rpm → 46Hz, 9000 → 140Hz, 12000 → 196Hz (보트는 더 낮게)
      const f = (P.fBase + P.fRange * rpmN) * (onWater ? 0.8 : 1);
      N.pulse.playbackRate.setTargetAtTime(f / F_REF, t, 0.02);
      N.saw.frequency.setTargetAtTime(f, t, 0.02);
      N.sub.frequency.setTargetAtTime(f, t, 0.02);

      // ── 섞는 비율: 낮은 rpm은 울렁이는 폭발음, 높은 rpm은 고른 톱니파가 커져 매끈하게
      N.pulseG.gain.setTargetAtTime((0.85 - 0.25 * rpmN) * P.pulse, t, 0.05);
      N.sawG.gain.setTargetAtTime((0.12 + 0.28 * rpmN) * P.saw, t, 0.05);
      N.subG.gain.setTargetAtTime((0.3 - 0.12 * rpmN) * (onWater ? 1.4 : 1) * P.sub, t, 0.05);
      N.drive.gain.setTargetAtTime((0.3 + 0.5 * load + (accel ? 0.08 : 0) + (boosting ? 0.12 : 0)) * P.drive, t, 0.04);
      N.texBP.frequency.setTargetAtTime(500 + f * 5, t, 0.05);
      N.texG.gain.setTargetAtTime((0.12 + 0.6 * load * Math.min(1, rpmN + 0.2)) * P.tex, t, 0.05);
      // 슈퍼차저·기어 윙윙, 전기 모터 휘잉 (차마다 있으면)
      N.whine.frequency.setTargetAtTime(f * P.whineMul, t, 0.03);
      N.whineG.gain.setTargetAtTime(P.whine * (0.004 + 0.03 * rpmN * (0.4 + 0.6 * load)), t, 0.05);
      const spdE = Math.abs(car.forwardSpeed || car.speed || 0);
      N.elec.frequency.setTargetAtTime(300 + spdE * 55, t, 0.05);
      N.elecG.gain.setTargetAtTime(P.electric * 0.02 * Math.min(1, spdE / 40) * (0.5 + 0.5 * thr), t, 0.08);
      // 로켓 굉음: 부스터를 켜는 동안 크게
      N.roarLP.frequency.setTargetAtTime(380 + 500 * Math.min(1, spdE / 70), t, 0.1);
      N.roarG.gain.setTargetAtTime(boosting ? P.boostRoar * 0.9 : 0, t, boosting ? 0.06 : 0.25);

      // ── 로우패스: 페달을 밟을수록, rpm이 높을수록 열림 (떼면 먹먹한 엔진 브레이크 소리)
      let cut = (350 + f * 4 + load * (1400 + f * 10) + (boosting ? 500 : 0)) * P.bright;
      if (shifting) cut *= 0.55;
      if (onWater) cut *= 0.45;
      N.lp.frequency.setTargetAtTime(cut, t, shifting ? 0.02 : 0.05);

      // ── 엔진 음량 (변속 중엔 잠깐 꺼지고, 리미터에선 툭툭 끊김)
      let vol = (0.1 + 0.08 * Math.min(1, rpmN) + 0.3 * load + (boosting ? 0.04 : 0)) * P.volume;
      if (shifting) vol *= 0.4;
      if (car.limiter) vol *= Math.sin(t * Math.PI * 2 * 16) > 0 ? 1 : 0.55;
      N.engG.gain.setTargetAtTime(vol, t, shifting || car.limiter ? 0.012 : 0.04);

      // ── 터보: rpm × 페달에 따라 천천히 차오르고, 떼면 빠지기 시작
      // 터보: 원래는 가속 모드에서만. sound.turbo가 있으면 평소에도 그만큼 돎 (랠리카 같은 터보 엔진)
      // (2026-11-10) 물리에 터보가 있는 차(car.cfg.engine.turbo)는 실제 터보 압력(car.spool)을 따라감 → 밟고 잠깐 뒤에 휘슬이 차오름 (터보 랙이 귀로 들림)
      const physTurbo = !!(car.cfg && car.cfg.engine && car.cfg.engine.turbo);
      const spTarget = onWater ? 0 : physTurbo ? clamp(car.spool || 0, 0, 1) * (accel ? P.turboMax : Math.max(P.turbo, 0.6)) : clamp(rpmN * 1.1, 0, 1) * load * (accel ? P.turboMax : P.turbo);
      spool += (spTarget - spool) * Math.min(1, dt * (spTarget > spool ? 1.8 : 2.5));
      const s2 = spool * spool;
      N.whistle.frequency.setTargetAtTime(2200 + 5200 * spool + 500 * rpmN, t, 0.05);
      N.whistleG.gain.setTargetAtTime(0.03 * s2 * Math.max(1, P.turboMax), t, 0.05);
      N.hissBP.frequency.setTargetAtTime(2500 + 3500 * spool, t, 0.05);
      N.hissG.gain.setTargetAtTime(0.25 * s2, t, 0.05);

      // ── 높은 rpm에서 페달을 떼는 순간: 블로오프 + 한동안 배기 팝
      if (thr > 0.6) onThrottle = true;
      if (onThrottle && thr < 0.35) {
        onThrottle = false;
        if (rpm > 8000 && !silent) {
          popTime = 0.7 + Math.random() * 0.8 + (accel ? 0.4 : 0);
          if ((accel || P.turbo > 0) && spool > 0.3) {
            blowOff(spool);
            spool *= 0.25;
          }
        }
      }
      if (popTime > 0) {
        popTime -= dt;
        if (thr > 0.3 || rpm < 5500 || silent) popTime = 0;
        else if (thr < 0.2) {
          const rate = (accel ? 13 : 8) * Math.min(1, popTime + 0.3) * P.pops; // 1초에 몇 번
          if (Math.random() < rate * dt) firePop((onWater ? 0.5 : 1) * Math.min(1.4, 0.6 + 0.4 * P.pops));
        }
      }
      if (!silent) {
        // 리미터에 걸리면 가끔 탁탁
        if (car.limiter && Math.random() < 5 * dt * Math.min(1, P.pops)) firePop(0.6); // 팝이 없는 차(전기차 pops 0)는 안 남
        // 풀가속 중 변속하는 순간 '빠앙' 한 방
        if (shifting && !wasShifting && thr > 0.6 && rpm > 9000 && Math.random() < (accel ? 0.9 : 0.5) * Math.min(1, P.pops)) firePop(0.8);
      }
      wasShifting = shifting;

      // ── 타이어 비명: 조금 미끄러지면 작게 '쉬익', 많이 미끄러지면 '끼이익' (sound.squeal = 차마다 크기, squealPitch = 음높이, squealVib = 떨림, squealNoise = 쉬익 섞임)
      const slip = clamp(car.tyreSlip || 0, 0, 1);
      const sqK = slip < 0.1 ? 0 : Math.pow((slip - 0.1) / 0.9, 1.3);
      const sqPitch = (P.squealPitch ?? 1) * (780 + 420 * slip + 3 * Math.min(60, spdE));
      N.sq.frequency.setTargetAtTime(sqPitch, t, 0.08);
      N.sqBP.frequency.setTargetAtTime(sqPitch * 1.45, t, 0.08);
      N.sqVibG.gain.setTargetAtTime((18 + 30 * slip) * (P.squealVib ?? 1), t, 0.1);
      N.sqG.gain.setTargetAtTime(0.32 * sqK * (P.squeal ?? 1), t, sqK > 0 ? 0.04 : 0.09);
      N.sqNBP.frequency.setTargetAtTime(1800 + 1400 * slip, t, 0.08);
      N.sqNG.gain.setTargetAtTime(0.1 * Math.min(1, slip * 1.6) * (P.squeal ?? 1) * (P.squealNoise ?? 1), t, 0.06);
      const di = car.lastDriftInfo;
      if (di && di.t !== lastDrift) {
        if (lastDrift !== null && di.clean && !silent) chime(di.quality);
        lastDrift = di.t;
      }
      if (!di) lastDrift = -1;

      // ── 환경: 보트는 물 위라 먹먹, 가라앉으면 점점 물속처럼
      let envCut = 18000;
      let envVol = 1;
      if (onWater) {
        envCut = 1100;
        envVol = 0.85;
      }
      if (sink > 0) {
        envCut *= Math.pow(200 / envCut, sink);
        envVol *= 1 - 0.6 * sink;
      }
      N.envLP.frequency.setTargetAtTime(envCut, t, 0.08);
      N.envGain.gain.setTargetAtTime(envVol, t, 0.08);
      const spd = Math.abs(car.forwardSpeed || 0);
      const water = (onWater ? 0.15 + 0.35 * Math.min(1, spd / 30) : 0) + 0.5 * sink;
      N.waterG.gain.setTargetAtTime(water, t, 0.15);

      N.out.gain.setTargetAtTime(silent ? 0 : MASTER, t, 0.05);
    },
  };
}
