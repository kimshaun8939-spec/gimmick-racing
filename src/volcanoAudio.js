// 화산 지대 소리 (volcanoEvents.js가 씀). 파일 없이 Web Audio로 모두 합성
//   - 늘 깔리는 소리: 깊은 화산 울림 / 용암 보글보글·타닥 (용암 가까울수록 크게) / 높은 낭떠러지 바람 소리
//   - 한 번 나는 소리: 분화 쾅 (거리만큼 늦게) / 천둥 / 화산탄 휘익-쾅 / 바위 부서짐 / 간헐천 / 용암 첨벙
//   소리 장치는 첫 키·터치 뒤에 만듦. 스피커 앞은 audioMix.js가 감싸서 크기 설정·N(소리 끄기)·Esc 메뉴(잠시 끔)가 그대로 적용됨
//   (audioMix는 만든 파일 이름으로 종류를 나눔 → 이 파일 = 효과음)

const SPEED_OF_SOUND = 343;

export function createVolcanoAudio() {
  let ctx = null, out = null, noiseBuf = null, brownBuf = null, bubbleBuf = null, crackleBuf = null;
  const bed = {}; // 늘 깔리는 소리들의 GainNode·필터
  const A = {
    force: false, // 테스트용: 소리 장치가 멈춰 있어도 소리 만들기를 실행 (오류 확인)
    volume: 1, // 이 맵 소리 전체 크기 (조절 손잡이)
    get ctx() {
      return ctx;
    },
  };

  // ------------------------------------------------------------ 버퍼 (한 번만 만듦)
  function makeBuffers() {
    const sr = ctx.sampleRate;
    // 흰 소음 2초
    noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    {
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    // 갈색 소음 4초 (낮은 울림 재료)
    brownBuf = ctx.createBuffer(1, sr * 4, sr);
    {
      const d = brownBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
      // 이음새 없이 반복되게 끝을 처음으로 녹임
      const f = Math.floor(sr * 0.05);
      for (let i = 0; i < f; i++) {
        const k = i / f;
        d[d.length - f + i] = d[d.length - f + i] * (1 - k) + d[i] * k;
      }
    }
    // 보글보글 3초: 짧게 올라가는 낮은 "뽁" 소리를 마구 섞음
    bubbleBuf = ctx.createBuffer(1, sr * 3, sr);
    {
      const d = bubbleBuf.getChannelData(0);
      for (let n = 0; n < 70; n++) {
        const at = Math.floor(Math.random() * (d.length - sr * 0.2));
        const f0 = 90 + Math.random() * 260, dur = 0.04 + Math.random() * 0.12, len = Math.floor(sr * dur), amp = 0.25 + Math.random() * 0.6;
        let ph = 0;
        for (let i = 0; i < len; i++) {
          const k = i / len;
          ph += (2 * Math.PI * f0 * (1 + k * 1.8)) / sr;
          d[(at + i) % d.length] += Math.sin(ph) * amp * Math.sin(Math.PI * k) * (1 - k);
        }
      }
    }
    // 타닥타닥 2초: 드문드문 짧은 딸깍
    crackleBuf = ctx.createBuffer(1, sr * 2, sr);
    {
      const d = crackleBuf.getChannelData(0);
      for (let n = 0; n < 120; n++) {
        const at = Math.floor(Math.random() * (d.length - 400)), len = 20 + Math.floor(Math.random() * 260), amp = Math.random() < 0.15 ? 0.9 : 0.3 + Math.random() * 0.3;
        for (let i = 0; i < len; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.pow(1 - i / len, 3);
      }
    }
  }
  function loop(buf, rate = 1) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * buf.duration);
    return s;
  }
  function filter(type, f, q = 0.7) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  function gainNode(v = 0) {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  }

  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || ctx) return;
    ctx = new AC();
    out = gainNode(A.volume);
    out.connect(ctx.destination);
    makeBuffers();
    // 1) 깊은 화산 울림: 갈색 소음 → 낮은 통과 + 아주 낮은 사인 (천천히 출렁임)
    bed.rumble = gainNode(0);
    loop(brownBuf, 0.7).connect(filter('lowpass', 110, 0.9)).connect(bed.rumble);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 34;
    const subG = gainNode(0.35);
    sub.connect(subG).connect(bed.rumble);
    sub.start();
    bed.sub = sub;
    bed.rumble.connect(out);
    // 2) 용암: 보글보글 + 타닥
    bed.lava = gainNode(0);
    loop(bubbleBuf, 1).connect(filter('lowpass', 900, 0.8)).connect(bed.lava);
    const cr = gainNode(0.5);
    loop(crackleBuf, 1).connect(filter('highpass', 1400, 0.6)).connect(cr).connect(bed.lava);
    const hiss = gainNode(0.08);
    loop(noiseBuf, 1).connect(filter('bandpass', 3200, 0.5)).connect(hiss).connect(bed.lava);
    bed.lava.connect(out);
    // 3) 바람 울부짖음: 소음 → 좁은 띠 통과 2개 (주파수가 천천히 흔들림)
    bed.wind = gainNode(0);
    bed.windF1 = filter('bandpass', 520, 5);
    bed.windF2 = filter('bandpass', 1100, 3);
    const wsrc = loop(noiseBuf, 1);
    wsrc.connect(bed.windF1).connect(bed.wind);
    const w2 = gainNode(0.45);
    wsrc.connect(bed.windF2).connect(w2).connect(bed.wind);
    const wlow = gainNode(0.6);
    wsrc.connect(filter('lowpass', 300, 0.7)).connect(wlow).connect(bed.wind);
    bed.wind.connect(out);
  }
  const wake = () => {
    if (!ctx) init();
    else if (ctx.state === 'suspended') ctx.resume();
  };
  window.addEventListener('keydown', wake);
  window.addEventListener('pointerdown', wake);
  const ok = () => ctx && (ctx.state === 'running' || A.force);

  // ------------------------------------------------------------ 늘 깔리는 소리 크기 (매 화면, 부드럽게)
  let windPh = 0;
  /** levels: { rumble 0~1, lava 0~1, wind 0~1 }, dt: 초 */
  A.bed = (lv, dt) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    bed.rumble.gain.setTargetAtTime(0.16 * lv.rumble, t, 0.25);
    bed.lava.gain.setTargetAtTime(0.4 * lv.lava, t, 0.3);
    bed.wind.gain.setTargetAtTime(0.22 * lv.wind, t, 0.4);
    windPh += dt;
    // 바람: 휘이잉 하고 높낮이가 오르내림
    const f = 420 + Math.sin(windPh * 0.37) * 140 + Math.sin(windPh * 1.13) * 70 + lv.wind * 180;
    bed.windF1.frequency.setTargetAtTime(f, t, 0.2);
    bed.windF2.frequency.setTargetAtTime(f * 2.1, t, 0.2);
    bed.sub.frequency.setTargetAtTime(32 + Math.sin(windPh * 0.21) * 3, t, 0.5);
  };
  A.setVolume = (v) => {
    A.volume = v;
    if (out) out.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  };

  // ------------------------------------------------------------ 한 번 나는 소리 재료
  function panner(pan) {
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      p.connect(out);
      return p;
    }
    return out;
  }
  function noise(dest, t0, dur, vol, type, f0, f1, q = 0.8, attack = 0.005) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.05);
  }
  function brown(dest, t0, dur, vol, f, attack = 0.02) {
    const s = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = brownBuf;
    lp.type = 'lowpass';
    lp.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    s.connect(lp).connect(g).connect(dest);
    s.start(t0, Math.random() * 3);
    s.stop(t0 + dur + 0.05);
  }
  function tone(dest, t0, dur, vol, f0, f1, type = 'sine', attack = 0.01) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  // 거리 → 크기 (가까우면 1, maxD에서 0)
  const fall = (d, maxD) => Math.pow(Math.max(0, 1 - d / maxD), 1.6);

  /** 분화: 멀리서 쾅 → 길게 우르릉. dist m (소리는 거리만큼 늦게 옴, 최대 4초) */
  A.erupt = (strength = 1, dist = 900, pan = 0) => {
    if (!ok()) return;
    const t = ctx.currentTime + Math.min(4, dist / SPEED_OF_SOUND);
    const v = 0.7 * Math.max(0.3, Math.min(1.4, strength)), d = panner(pan * 0.6);
    brown(d, t, 5.5, v, 160, 0.04);
    noise(d, t, 1.6, v * 0.5, 'lowpass', 900, 80, 0.7, 0.01);
    tone(d, t, 3.2, v * 0.7, 52, 24);
    brown(d, t + 0.9, 4.5, v * 0.55, 90, 0.6); // 뒤따르는 우르릉
  };
  /** 천둥: 우지끈 + 굴러가는 우르릉, 거리만큼 늦게 (최대 5초) */
  A.thunder = (dist = 600, pan = 0) => {
    if (!ok()) return;
    const t = ctx.currentTime + Math.min(5, dist / SPEED_OF_SOUND);
    const near = Math.max(0, 1 - dist / 1500), d = panner(pan * 0.7);
    if (near > 0.4) noise(d, t, 0.35, 0.5 * near, 'highpass', 2500, 900, 0.6, 0.002);
    noise(d, t, 0.9, 0.35 * (0.4 + near), 'lowpass', 1800, 200, 0.6, 0.01);
    for (let k = 0; k < 3; k++) brown(d, t + 0.15 + k * (0.5 + Math.random() * 0.5), 2.2 + Math.random(), 0.35 * (0.5 + near) * (1 - k * 0.2), 140 + Math.random() * 60, 0.15);
  };
  /** 화산탄 날아오는 휘이잉 (dur초 뒤 떨어짐) */
  A.whistle = (dur, dist, pan = 0) => {
    if (!ok()) return;
    const v = 0.14 * fall(dist, 260);
    if (v < 0.004) return;
    const t = ctx.currentTime, d = panner(pan);
    tone(d, t, dur, v, 1500 + Math.random() * 300, 520, 'sine', dur * 0.7);
    noise(d, t, dur, v * 0.8, 'bandpass', 2400, 700, 4, dur * 0.8);
  };
  /** 화산탄 떨어짐: 쿵 + 와르르. big = 도로 위 (더 큼) */
  A.impact = (dist, pan = 0, big = false) => {
    if (!ok()) return;
    const v = (big ? 0.75 : 0.5) * fall(dist, big ? 500 : 380);
    if (v < 0.004) return;
    const t = ctx.currentTime + dist / SPEED_OF_SOUND, d = panner(pan);
    tone(d, t, 0.6, v, 90, 30);
    noise(d, t, 0.45, v * 0.8, 'lowpass', 2200, 140, 0.7, 0.003);
    brown(d, t + 0.02, 1.4, v * 0.6, 220, 0.02);
    noise(d, t + 0.05, 0.9, v * 0.25, 'bandpass', 2600, 1200, 1.2, 0.02); // 자갈 후드득
  };
  /** 내 차가 맞음: 쾅 + 금속 */
  A.hit = () => {
    if (!ok()) return;
    const t = ctx.currentTime, d = panner(0);
    tone(d, t, 0.5, 0.5, 70, 28);
    noise(d, t, 0.3, 0.5, 'lowpass', 3000, 300, 0.6, 0.002);
    tone(d, t, 0.35, 0.12, 420, 260, 'triangle');
  };
  /** 길 가장자리 부서짐: 작은 와르르 */
  A.crumble = (dist, pan = 0) => {
    if (!ok()) return;
    const v = 0.1 * fall(dist, 60);
    if (v < 0.003) return;
    const t = ctx.currentTime, d = panner(pan);
    noise(d, t, 0.5 + Math.random() * 0.4, v, 'bandpass', 1800 + Math.random() * 800, 500, 1.1, 0.01);
    brown(d, t, 0.7, v * 0.9, 260, 0.02);
  };
  /** 간헐천: 미리 우르르·보글 (warn초) → 푸쉬익 솟구침 */
  A.geyserWarn = (warn, dist, pan = 0) => {
    if (!ok()) return;
    const v = 0.3 * fall(dist, 220);
    if (v < 0.004) return;
    const t = ctx.currentTime, d = panner(pan);
    brown(d, t, warn + 0.4, v, 120, warn * 0.8);
    const s = ctx.createBufferSource(), g = ctx.createGain(), lp = filter('lowpass', 700, 0.8);
    s.buffer = bubbleBuf;
    s.playbackRate.value = 1.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * 1.4, t + warn);
    g.gain.exponentialRampToValueAtTime(0.0005, t + warn + 0.5);
    s.connect(lp).connect(g).connect(d);
    s.start(t, Math.random());
    s.stop(t + warn + 0.6);
  };
  A.geyserBurst = (dist, pan = 0) => {
    if (!ok()) return;
    const v = 0.42 * fall(dist, 260);
    if (v < 0.004) return;
    const t = ctx.currentTime, d = panner(pan);
    noise(d, t, 2.0, v, 'bandpass', 380, 1600, 0.9, 0.06);
    noise(d, t, 1.6, v * 0.5, 'highpass', 3000, 1500, 0.6, 0.1);
    tone(d, t, 0.7, v * 0.7, 75, 35);
  };
  /** 용암 첨벙 + 김 치익 */
  A.splash = (dist, pan = 0) => {
    if (!ok()) return;
    const v = 0.55 * fall(dist, 320);
    if (v < 0.004) return;
    const t = ctx.currentTime + dist / SPEED_OF_SOUND, d = panner(pan);
    tone(d, t, 0.5, v * 0.7, 110, 40);
    noise(d, t, 0.7, v, 'lowpass', 1600, 150, 0.8, 0.005);
    noise(d, t + 0.15, 2.4, v * 0.45, 'highpass', 4500, 2500, 0.5, 0.3);
  };
  /** 착지 불꽃 (작게 치직) */
  A.sizzle = (k = 1) => {
    if (!ok()) return;
    const t = ctx.currentTime, d = panner(0);
    noise(d, t, 0.6, 0.12 * k, 'highpass', 5000, 2600, 0.6, 0.01);
  };
  A.init = () => wake();
  return A;
}
