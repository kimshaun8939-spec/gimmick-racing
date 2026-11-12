// Mirage Canyon: predictable wind, a readable storm route and advance information.
import * as THREE from 'three';
import {canvasTexture} from './foundryTrack.js';
import {mixState} from './audioMix.js';
import {stormState} from './mirageWeather.js';
const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
export function buildMirageProps(track,scene){
 const group=new THREE.Group();group.name='mirageProps';scene.add(group);
 const winds=track.data.winds||[],effects={cross:0,tail:0,bots:0};let clock=0,lastCue='',ctx=null,noiseGain=null,nextAudio=0;
 // Wind direction is printed on the road, in the same coordinates used by the physical force.
 for(const w of winds){const tex=canvasTexture(512,512,(c,W,H)=>{c.clearRect(0,0,W,H);c.strokeStyle=w.type==='cross'?'#ffd08a':'#bcefe3';c.lineWidth=24;c.lineCap='round';for(const y of [130,330]){c.beginPath();if(w.type==='cross'){c.moveTo(100,y);c.lineTo(410,y);c.moveTo(330,y-60);c.lineTo(410,y);c.lineTo(330,y+60);}else{c.moveTo(200,y+70);c.lineTo(200,y-70);c.moveTo(140,y-10);c.lineTo(200,y-70);c.lineTo(260,y-10);}c.stroke();}});
 const ma=new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
 track.strip(track.spanList(track.indexAt(w.t0),track.indexAt(w.t1)),s=>[[-s.hw+.5,.035],[s.hw-.5,.035]],ma,{vScale:22,parent:group,chunk:160});}
 const toast=document.createElement('div');toast.id='mirageToast';
 toast.style.cssText='position:fixed;top:94px;left:50%;transform:translateX(-50%);z-index:5;pointer-events:none;opacity:0;transition:opacity .2s;color:#fff0c8;background:#173e4ded;border:1px solid #c9b888;padding:10px 20px;border-radius:9px;font-family:Malgun Gothic,sans-serif;text-align:center;box-shadow:0 3px 14px #142f3840;max-width:calc(100vw - 32px);box-sizing:border-box';
 const title=document.createElement('div'),hint=document.createElement('div');title.style.cssText='font-size:clamp(14px,2.1vw,20px);font-weight:900;line-height:1.4';hint.style.cssText='font-size:clamp(12px,1.7vw,15px);line-height:1.6;color:#d3eee7';toast.append(title,hint);document.body.append(toast);
 function init(){if(ctx)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;ctx=new AC();const buf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),a=buf.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=Math.random()*2-1;const src=ctx.createBufferSource();src.buffer=buf;src.loop=true;const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=470;bp.Q.value=.5;noiseGain=ctx.createGain();noiseGain.gain.value=0;src.connect(bp).connect(noiseGain).connect(ctx.destination);src.start();}
 const unlock=()=>{init();if(ctx?.state==='suspended')ctx.resume().catch(()=>{});};window.addEventListener('keydown',unlock,{passive:true});window.addEventListener('pointerdown',unlock,{passive:true});
 function chime(kind){if(!ctx||mixState().muted||window.game?.paused)return;const t=ctx.currentTime,notes=kind==='storm'?[392,523,659]:[392,494,587];for(let k=0;k<3;k++){const o=ctx.createOscillator(),v=ctx.createGain();o.frequency.value=notes[k];o.type='sine';v.gain.setValueAtTime(.001,t+k*.12);v.gain.exponentialRampToValueAtTime(.045,t+k*.12+.01);v.gain.exponentialRampToValueAtTime(.001,t+k*.12+.2);o.connect(v).connect(ctx.destination);o.start(t+k*.12);o.stop(t+k*.12+.21);}}
 const gust=t=>.72+.28*Math.sin(t*.65);
 function apply(car,dt,player){const n=car?.trackInfo;if(!n||!car.grounded||Math.abs(n.lateral)>n.sample.hw+2)return;
 for(const w of winds){if(n.t<w.t0||n.t>w.t1)continue;const e=smooth((n.t-w.t0)*track.length/22)*smooth((w.t1-n.t)*track.length/22),k=w.accel*e*gust(clock);
 car.vel.addScaledVector(w.type==='tail'?n.sample.tan:n.sample.right,k*dt*w.dir);car.setVelocityOnSurface(car.vel);effects[player?w.type==='tail'?'tail':'cross':'bots']+=dt;}}
 const notices=winds.map(w=>({...w,kind:'wind',title:w.type==='cross'?'바람의 협곡 →':'순풍 능선 ↑',hint:w.type==='cross'?'오른쪽으로 밀려요 · 왼쪽 조향으로 중심 유지':'순풍으로 속도를 얻고 · 다음 코너 전에 제동'}));
 // All information is useful even with the optional racing line switched off.
 for(const zone of track.data.storms||[])notices.push({...zone,kind:'storm',title:'모래폭풍 · 청록 항로',hint:'청록 비콘과 노면 선을 따라가요 · 길은 계속 이어져요'});
 if(track.data.wallRide)notices.push({...track.data.wallRide,id:'wall',kind:'bank',title:'협곡 벽타기 ↷',hint:'기울어진 도로를 따라 부드럽게 · 청록 선 안쪽 유지'});
 function showNotice(car){const t=car?.trackInfo?.t;if(t==null){toast.style.opacity='0';return;}
 let active=notices.find(w=>t>=w.t0&&t<=w.t1),ahead=null,dist=Infinity;
 if(!active)for(const w of notices){const d=((w.t0-t+1)%1)*track.length;if(d<dist&&d<180){dist=d;ahead=w;}}
 const w=active||ahead;if(!w){toast.style.opacity='0';lastCue='';return;}
 if(lastCue!==w.id){lastCue=w.id;chime(w.kind);}
 title.textContent=(active?'':Math.ceil(dist/10)*10+' m 앞 · ')+w.title;hint.textContent=w.hint;toast.style.opacity='1';}
 function update(dt,car){clock+=dt;apply(car,dt,true);for(const b of window.game?.raceSys?.bots||[])if(b.car!==car)apply(b.car,dt,false);showNotice(car);
 let vol=0;const t=car?.trackInfo?.t;if(t!=null){for(const w of winds)if(t>w.t0&&t<w.t1)vol=.045*gust(clock);vol=Math.max(vol,stormState(track,t,clock).strength*.065);}
 if(noiseGain&&clock>nextAudio){nextAudio=clock+.1;noiseGain.gain.setTargetAtTime(mixState().muted||window.game?.paused?0:vol,ctx.currentTime,.2);}}
 return {group,update,animate(){},reset(){clock=0;nextAudio=0;lastCue='';toast.style.opacity='0';for(const k of Object.keys(effects))effects[k]=0;},props:[],cubes:[],barricades:[],barricade:null,winds,effects,gust,apply,get clock(){return clock;},notices};
}
