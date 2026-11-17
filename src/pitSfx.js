import './audioMix.js';
// All signals pass through audioMix's master/fx/mute bus and shared output limiter.
export function createPitSfx(){
 let ctx,bus,servo,amp,last=-1;const nodes=new Set();
 function init(){if(ctx)return true;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return false;ctx=new AC();bus=ctx.createGain();bus.gain.value=.28;const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-18;limiter.ratio.value=12;bus.connect(limiter).connect(ctx.destination);return true;}
 function tone(a,b,d=.1,v=.1,type='triangle',delay=0){if(!init())return;ctx.resume().catch(()=>{});const t=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(a,t);o.frequency.exponentialRampToValueAtTime(b,t+d);g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(v,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g).connect(bus);o.start(t);o.stop(t+d+.02);nodes.add(o);o.onended=()=>{nodes.delete(o);o.disconnect();g.disconnect();};}
 function hiss(d=.18){if(!init())return;const b=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*d),ctx.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*(1-i/a.length)*.09;const o=ctx.createBufferSource(),f=ctx.createBiquadFilter();f.type='highpass';f.frequency.value=1500;o.buffer=b;o.connect(f).connect(bus);o.start();nodes.add(o);o.onended=()=>{nodes.delete(o);o.disconnect();f.disconnect();};}
 function hit(){tone(160,42,.16,.25);tone(800,210,.055,.1);hiss();}
 return {start(){last=-1;if(!init())return;hiss(.3);servo=ctx.createOscillator();amp=ctx.createGain();servo.type='sine';servo.frequency.value=150;amp.gain.value=0;servo.connect(amp).connect(bus);servo.start();},
 update(p,speed=0){if(!ctx)return;servo?.frequency.setTargetAtTime(130+Math.min(1,speed*1.1)*360,ctx.currentTime,.035);amp?.gain.setTargetAtTime(p>.94?0:Math.min(.065,speed*.065),ctx.currentTime,.03);const phase=p<.13?0:p<.22?1:p<.49?2:p<.56?3:p<.78?4:p<.9?5:6;if(phase===last)return;last=phase;if(phase===1||phase===5){for(let i=0;i<6;i++)tone(110+i*20,55,.035,.15,'square',i*.025);tone(1250,600,.04,.07,'triangle',.04);}if(phase===2||phase===3){tone(420,100,.07,.2);hiss(.24);tone(90,180,.22,.07,'sine');}if(phase===5)hit();if(phase===6)tone(1100,1600,.17,.09,'sine');},clack:hit,
 stop(){for(const n of nodes)try{n.stop();}catch{}nodes.clear();try{servo?.stop();servo?.disconnect();amp?.disconnect();}catch{}servo=amp=null;last=-1;}
 };
}
