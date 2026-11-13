import { accelProfile } from './carBody_accel.js';
// accel3: 21대별 정밀 서보·래칫·유압·블로워·전자음·귀여운 팝 등 전용 리듬.
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

  // 같은 모터음을 높낮이만 바꾸지 않고 음원·리듬도 전용으로 예약한다.
  function tone(t, duration, from, to, type, volume) {
    const osc=ctx.createOscillator(), g=ctx.createGain(); osc.type=type;
    osc.frequency.setValueAtTime(from,t);osc.frequency.exponentialRampToValueAtTime(Math.max(20,to),t+duration);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+.012);
    g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    osc.connect(g).connect(out);osc.start(t);osc.stop(t+duration+.02);
  }
  function accelSound(up,t) {
    const game=window.game;
    const p=accelProfile(game?.model?.look || {carId:game?.carId});
    const d=p.duration*(up?1:.82), heavy=['heavy','hydraulic','blower'].includes(p.sound);
    const pop=p.sound==='pop', electric=['electric','silk'].includes(p.sound);
    const at=u=>t+d*(up?u:1-u);
    if(pop) {
      p.steps.forEach((s,i)=>tone(at(s),.13,p.f0*(1+i*.16),p.f1*(1+i*.10),'sine',.10));
      tone(t+d*.24,d*.50,p.f0*.6,p.f1*.8,'triangle',.035);
    } else if(electric) {
      tone(t+.04,d*.86,up?p.f0:p.f1,up?p.f1:p.f0,'sine',.055);
      tone(t+.09,d*.76,up?p.f0*1.5:p.f1*1.5,up?p.f1*1.5:p.f0*1.5,'triangle',.022);
      p.steps.forEach((s,i)=>tone(at(s),.055,820+i*170,1260+i*190,'sine',.035));
    } else if(p.sound==='precision'||p.sound==='ratchet') {
      p.steps.forEach((s,i)=>{click(at(s),p.f0*4+i*210,.08);tone(at(s),.045,up?p.f0:p.f1,up?p.f1:p.f0,'triangle',.035);});
      if(p.sound==='ratchet')tone(t+d*.25,d*.45,up?180:360,up?360:180,'sawtooth',.018);
    } else {
      tone(t+.08,d*.75,up?p.f0:p.f1,up?p.f1:p.f0,heavy?'sawtooth':'triangle',heavy?.035:.025);
      p.steps.forEach((s,i)=>{click(at(s),heavy?650+i*180:1700+i*220,.10);tone(at(s),.10,heavy?110:220,heavy?45:95,'triangle',heavy?.10:.06);});
    }
    // 묵직한 유압은 낮은 잠금, 정밀 기계는 짧은 걸쇠, 전기는 맑은 확인음.
    // 큰 차체 레일과 하체가 잠기는 낮은 울림. 기존 차별 리듬/음색은 유지.
    tone(at(.56), heavy?.22:.15, heavy?86:145, heavy?32:58, 'triangle', heavy?.14:electric?.045:pop?.06:.075);
    const end=t+d;
    if(electric)tone(end,.13,p.f1,p.f1*1.25,'sine',.045);
    else if(pop)tone(end,.14,640,980,'sine',.075);
    else {click(end,heavy?900:2800,heavy?.14:.09);tone(end,heavy?.16:.06,heavy?110:320,heavy?42:170,'triangle',heavy?.16:.055);}
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
      if (accel) { accelSound(up,t); return; }
      const dur = up ? .55 : .4;
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
      const steps = up ? [.14, .27, .4] : [.12, .26];
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
