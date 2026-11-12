// Foundry-only machine bed and fair advance warning chimes. Global audioMix owns mute / volume.
import {mixState} from './audioMix.js';
export function createFoundryAudio(track){
 let ctx=null,out=null,hum=null,hiss=null,whirr=null,pan=null,last=-10,next=0;
 const stats={warnings:0,started:false};
 function init(){if(ctx)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;ctx=new AC();out=ctx.createGain();out.gain.value=.28;out.connect(ctx.destination);pan=ctx.createStereoPanner();pan.connect(out);
 const osc=ctx.createOscillator();osc.type='triangle';osc.frequency.value=62;hum=ctx.createGain();hum.gain.value=0;osc.connect(hum).connect(pan);osc.start();
 const motor=ctx.createOscillator();motor.type='sawtooth';motor.frequency.value=118;const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=380;whirr=ctx.createGain();whirr.gain.value=0;motor.connect(lp).connect(whirr).connect(pan);motor.start();
 const buf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;const noise=ctx.createBufferSource();noise.buffer=buf;noise.loop=true;const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=850;bp.Q.value=.7;hiss=ctx.createGain();hiss.gain.value=0;noise.connect(bp).connect(hiss).connect(pan);noise.start();stats.started=true;
 }
 const unlock=()=>{init();if(ctx?.state==='suspended')ctx.resume().catch(()=>{});};window.addEventListener('pointerdown',unlock,{passive:true});window.addEventListener('keydown',unlock,{passive:true});
 function cue(kind='belt'){stats.warnings++;if(!ctx||mixState().muted||window.game?.paused)return;const t=ctx.currentTime;if(t-last<2.5)return;last=t;for(let k=0;k<2;k++){const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.value=(kind==='table'?392:523)*(k?1.25:1);g.gain.setValueAtTime(.001,t+k*.19);g.gain.exponentialRampToValueAtTime(.12,t+k*.19+.012);g.gain.exponentialRampToValueAtTime(.001,t+k*.19+.15);o.connect(g).connect(out);o.start(t+k*.19);o.stop(t+k*.19+.17);}}
 function update(clock,car){if(!ctx||clock<next)return;next=clock+.12;const silent=mixState().muted||window.game?.paused||!car;let belt=0,furnace=0,table=0,p=0;if(!silent){const t=car.trackInfo?.t||0;for(let b of track.data.belts){const d=Math.min((t-b.t0+1)%1,(b.t0-t+1)%1)*track.length;belt=Math.max(belt,Math.max(0,1-d/180));}const s=track.sampleAt(track.data.landmarks.furnace);furnace=Math.max(0,1-car.pos.distanceTo(s.pos)/190);table=Math.max(0,1-car.pos.distanceTo(track.turntable.center)/130);p=THREEClamp(car.trackInfo?.lateral||0,-10,10)/15;}const t=ctx.currentTime;hum.gain.setTargetAtTime(furnace*.15+table*.06,t,.2);hiss.gain.setTargetAtTime(furnace*.09,t,.2);whirr.gain.setTargetAtTime(belt*.055+table*.035,t,.2);pan.pan.setTargetAtTime(p,t,.15);}
 function reset(){next=0;last=-10;}return {update,cue,reset,stats};
}
const THREEClamp=(x,a,b)=>Math.max(a,Math.min(b,x));
