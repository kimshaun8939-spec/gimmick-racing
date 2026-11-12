// 공정한 컨베이어: 시간에 따라 바뀌지 않고, 차종·봇에 같은 가속도를 적용.
// 12 m 진입·이탈 완충, 차가 도로 위에 접지했을 때만. 방향은 움직이는 화살표와 같음.
import * as THREE from 'three';
import {createFoundryAudio} from './foundryAudio.js';
import { canvasTexture } from './foundryTrack.js';
const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
export function buildFoundryProps(track,scene){
 const group=new THREE.Group();group.name='foundryProps';scene.add(group);
 const belts=track.data.belts||[],mats=[],audio=createFoundryAudio(track);
 function texture(color,dir,cross=false){return canvasTexture(512,512,(g,W,H)=>{g.scale(2,2);const w=256,h=256;g.fillStyle=cross?'#33291e':'#112d37';g.fillRect(0,0,w,h);g.strokeStyle='#53717b';g.lineWidth=4;for(let y=0;y<h;y+=32){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}g.strokeStyle=color;g.lineWidth=22;g.lineCap='square';for(let y=40;y<h;y+=128){g.beginPath();if(cross){g.moveTo(68,y-25);g.lineTo(120,y);g.lineTo(68,y+25);}else{g.moveTo(65,y-dir*25);g.lineTo(128,y+dir*25);g.lineTo(191,y-dir*25);}g.stroke();}});}
 for(const b of belts){const a=track.indexAt(b.t0),z=track.indexAt(b.t1),L=track.spanList(a,z);const split=b.type==='split';for(let side of (split?[-1,1]:[0])){const dir=side===1?-1:1,tex=texture(!split?'#ffce7b':side===1?'#ffc766':'#7bf3cc',-dir,!split);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;const ma=new THREE.MeshStandardMaterial({map:tex,roughness:.6,metalness:.25,emissive:!split?'#5a3a0e':side===1?'#5a3300':'#0e6453',emissiveIntensity:.45,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});ma.userData.live=true;const profile=s=>split?(side<0?[[-s.hw+.5,.035],[-.25,.035]]:[[.25,.035],[s.hw-.5,.035]]):[[-s.hw+.5,.035],[s.hw-.5,.035]];track.strip(L,profile,ma,{vScale:12,chunk:120,parent:group});mats.push({ma,dir,cross:!split});}
 }
 const toast=document.createElement('div');toast.id='foundryToast';toast.style.cssText='position:fixed;left:50%;top:94px;transform:translateX(-50%);z-index:5;pointer-events:none;opacity:0;transition:opacity .2s;color:#ffe4ac;background:#142f3aee;border:1px solid #b3a077;border-radius:9px;padding:10px 20px;font-family:Malgun Gothic,sans-serif;text-align:center;max-width:calc(100vw - 32px);box-sizing:border-box;box-shadow:0 3px 14px #142f3840';
 const title=document.createElement('div'),hint=document.createElement('div');title.style.cssText='font-size:clamp(14px,2.1vw,20px);font-weight:900;line-height:1.4';hint.style.cssText='font-size:clamp(12px,1.7vw,15px);line-height:1.6;color:#d2e9de';toast.append(title,hint);document.body.append(toast);
 let clock=0,lastWarning='';
 const warnings=belts.map(b=>({id:b.id,t0:b.t0,t1:b.t1,kind:'belt',name:b.name,msg:b.type==='split'?'민트 ↑ 가속 · 황색 ↓ 감속 · 민트 쪽이 빨라요':'오른쪽으로 밀려요 → 왼쪽 조향으로 중심 유지'}));
 warnings.push({id:'table',t0:track.turntable.t-track.turntable.radius/track.length,t1:track.turntable.t+track.turntable.radius/track.length,kind:'table',name:'회전 이송대',msg:'중앙을 곧게 통과하면 빨라요 · 가장자리는 회전 방향으로 밀림'});
 const bowl=track.data.bank?.[0];if(bowl)warnings.push({id:'bowl',...bowl,kind:'bank',name:'용광로 사발 코너',msg:'경사진 도로를 따라 부드럽게 꺾어요 · 안쪽 선 유지'});
 const state=new WeakMap();const effects={forward:0,reverse:0,cross:0,turntable:0,bots:0};
 const active=(t,b)=>t>=b.t0&&t<=b.t1;
 function apply(car,dt,player){if(!car?.trackInfo)return;const n=car.trackInfo,t=n.t;let changed=false;const table=track.turntable;if(table&&car.grounded&&table.inDisk(car.pos)){changed=true;const dx=car.pos.x-table.center.x,dz=car.pos.z-table.center.z,edge=smooth((table.radius-Math.hypot(dx,dz))/5);car.vel.x+=dz*table.angularSpeed*table.friction*edge*dt;car.vel.z-=dx*table.angularSpeed*table.friction*edge*dt;if(player)effects.turntable+=dt;}const st=state.get(car)||{belt:null};state.set(car,st);let id=null;for(const b of belts){if(!active(t,b)||Math.abs(n.lateral)>n.sample.hw-.4||!car.grounded||car.pos.y>n.sample.pos.y+3)continue;id=b.id;changed=true;const w=smooth((t-b.t0)*track.length/12)*smooth((b.t1-t)*track.length/12);if(b.type==='split'){// 1.5 m 중앙 이음새에서는 방향이 부드럽게 바뀜.
 const k=THREE.MathUtils.clamp(-n.lateral/1.5,-1,1);car.vel.addScaledVector(n.sample.tan,b.accel*k*w*dt);if(player)effects[k>0?'forward':'reverse']+=dt;
 }else{car.vel.addScaledVector(n.sample.right,b.accel*w*dt);if(player)effects.cross+=dt;}if(!player)effects.bots+=dt;
 break;}if(changed)car.setVelocityOnSurface(car.vel);st.belt=id;}
 function update(dt,car){clock+=dt;apply(car,dt,true);
 const t=car?.trackInfo?.t;let w=null,active=false,dist=Infinity;
 if(t!=null){w=warnings.find(v=>t>=v.t0&&t<=v.t1);active=!!w;
 if(!w)for(const v of warnings){const d=((v.t0-t+1)%1)*track.length;if(d<160&&d<dist){dist=d;w=v;}}
 }
 if(w){if(lastWarning!==w.id){lastWarning=w.id;audio.cue(w.kind);}title.textContent=(active?'':Math.ceil(dist/10)*10+' m 앞 · ')+w.name;hint.textContent=w.msg;toast.style.opacity='1';}
 else{toast.style.opacity='0';lastWarning='';}
 audio.update(clock,car);for(const b of window.game?.raceSys?.bots||[])if(b.car&&b.car!==car)apply(b.car,dt,false);
 }
 function animate(t){for(const m of mats){m.ma.map.offset.y=m.cross?0:-t*.6*m.dir;if(m.cross)m.ma.map.offset.x=-t*.2;}}
 function reset(){audio.reset();lastWarning='';clock=0;toast.style.opacity='0';for(const k of Object.keys(effects))effects[k]=0;}
 return {group,update,animate,reset,props:[],cubes:[],barricades:[],barricade:null,effects,belts,apply,audio};
}
