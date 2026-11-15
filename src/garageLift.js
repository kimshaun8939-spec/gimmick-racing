import * as T from 'three';
import {createCarModel} from './carModel.js';
import {PART_VIEW,swapPart} from './carParts3d.js';
import {partLook,partOf,slotOf} from './parts.js';
import {createPartSfx} from './partFx.js';
// partsUI가 기존 replacePart 콜백에 전달하는 일회성 장면 정보.
let pending;
export function prepareGarageSwap(context){pending=context;}
const ease=x=>{x=T.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
const fake=mode=>({pos:new T.Vector3(),up:new T.Vector3(0,1,0),fwd:new T.Vector3(0,0,1),vel:new T.Vector3(),mode,sink:0,forwardSpeed:0,thr:0,grounded:true,surface:mode==='boat'?'water':'road',drifting:false,driftDir:0,driftLevel:0,steerVisual:0,load:0,form:null,flying:false,boostTime:0,brk:0});
const partName=(id,slot)=>partOf(id)?.name||'순정 '+(slotOf(slot)?.name||'부품');
export function createGarageLift(table){
 const sfx=createPartSfx();let state=null;
 function apply(s){if(s.applied)return;s.out?.restore();s.applied=true;s.apply();sfx.clack();}
 function finish(skipped=false){
  if(!state)return;const s=state;state=null;
  if(skipped)s.onSkip?.();
  try{apply(s);}finally{
   s.scene.onBeforeRender=s.previousRender;s.preview.setMode(s.originalMode);
   s.out?.dispose();s.incoming?.dispose();s.donor?.dispose();
   s.root.removeFromParent();s.root.traverse(o=>{if(o.isLineSegments){o.geometry.dispose();o.material.dispose();}});
   s.label.remove();sfx.stop();s.resolve();
  }
 }
 function setup(holder){
  const s=state;if(!s||s.ready||!holder)return;s.ready=true;s.holder=holder;
  const live=holder.children[0];s.out=swapPart(live,s.slot,partOf(s.before[s.slot])?.look);
  s.donor=createCarModel(s.car.look);s.donor.setParts(partLook(s.after));s.donor.sync(fake(s.slot==='water'?'boat':'normal'),2,0);s.donor.root.updateMatrixWorld(true);
  s.incoming=swapPart(s.donor.root,s.slot,partOf(s.after[s.slot])?.look);
  s.root=new T.Group();holder.add(s.root);s.root.add(s.out.group,s.incoming.group);s.incoming.group.visible=false;
  holder.updateMatrixWorld(true);const inv=holder.matrixWorld.clone().invert();
  const b=new T.Box3().setFromObject(s.out.group).applyMatrix4(inv),next=new T.Box3().setFromObject(s.incoming.group).applyMatrix4(inv);
  if(b.isEmpty())b.copy(next);
  s.center=b.isEmpty()?new T.Vector3(...PART_VIEW[s.slot].look):b.getCenter(new T.Vector3());
  s.extent=b.isEmpty()?new T.Vector3(.4,.2,.3):b.getSize(new T.Vector3());s.out.group.visible=false;
  let hasMesh=false;s.out.group.traverse(o=>{if(o.isMesh)hasMesh=true;});s.integrated=!hasMesh;
  const shape=hasMesh?s.out.group:s.incoming.group;s.outline=new T.Group();s.root.add(s.outline);
  shape.updateMatrixWorld(true);const local=s.root.matrixWorld.clone().invert();
  shape.traverse(o=>{if(!o.isMesh)return;const e=new T.LineSegments(new T.EdgesGeometry(o.geometry,24),new T.LineBasicMaterial({color:0x87ffe3,transparent:true,opacity:.9,depthTest:false}));e.applyMatrix4(new T.Matrix4().multiplyMatrices(local,o.matrixWorld));e.renderOrder=100;s.outline.add(e);});
  s.scan=s.outline.clone(true);s.scan.traverse(o=>{if(o.isLineSegments){o.geometry=o.geometry.clone();o.material=o.material.clone();}});s.root.add(s.scan);s.scan.visible=false;
 }
 function render(renderer,scene,camera){
  const s=state;if(!s?.ready)return;s.previousRender?.call(scene,renderer,scene,camera);
  const p=s.progress,slot=s.slot;if(!s.applied&&p>.22)s.out.hide();
  const rect=document.querySelector('.h-carstage')?.getBoundingClientRect(),view=PART_VIEW[slot];
  const direction=new T.Vector3(...view.pos).sub(new T.Vector3(...view.look)).normalize();
  const center=s.center.clone().applyMatrix4(s.holder.matrixWorld),small=rect&&rect.width<500;
  const size=slot==='water'?Math.max(7,s.extent.length()*1.2):Math.max(s.extent.length()*1.15,slot==='tire'?2.5:slot==='aero'?3.7:2.2);
  const fraction=Math.max(120,Math.min(rect?.height||innerHeight,rect?.width||innerWidth))/innerHeight;
  const distance=size/(2*Math.tan(T.MathUtils.degToRad(view.fov/2))*fraction)*(small?.86:1);
  const target=center.clone().addScaledVector(direction,Math.max(slot==='water'?6:3,distance));
  camera.position.lerpVectors(s.startCamera,target,s.reduced?1:ease(p/.19));camera.fov=view.fov;camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  if(rect){
    // 3D 칸 위쪽 버튼(차 목록·비교·정면으로) 아래에 띄움 — 버튼과 겹치지 않게 (관제탑 2026-11-15)
    let top=rect.top+8;
    for(const b of document.querySelectorAll('button')){const r=b.getBoundingClientRect();if(!r.width||b.offsetParent===null)continue;if(r.left<rect.right&&r.right>rect.left&&r.top>=rect.top-4&&r.top<rect.top+90)top=Math.max(top,r.bottom+8);}
    s.label.style.left=rect.left+8+'px';s.label.style.top=top+'px';s.label.style.width=Math.max(130,rect.width-16)+'px';
  }
 }
 return {get active(){return !!state;},skip(){finish(true);},
  play(callback){
   finish();const c=pending;pending=null;const preview=c?.preview||window.home?.preview;
   if(!c||!preview){callback();return Promise.resolve();}
   const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,label=document.createElement('div');label.className='pu-swap-label';label.setAttribute('role','status');document.body.append(label);
   const scene=preview.scene,previousRender=scene.onBeforeRender,originalMode=document.querySelector('#hForms button.on')?.dataset.mode||'normal';preview.setMode(c.slot==='water'?'boat':'normal');
   return new Promise(resolve=>{state={...c,preview,scene,previousRender,originalMode,label,resolve,apply:callback,at:performance.now(),duration:reduced?450:(c.duration||2400),reduced,applied:false,ready:false,progress:0,startCamera:preview.camera.position.clone(),root:new T.Group()};scene.onBeforeRender=render;});
  },
  update(holder){
   if(!state)return;setup(holder);const s=state;if(!s.ready)return;
   const p=Math.min(1,(performance.now()-s.at)/s.duration);s.progress=p;holder.position.y+=s.reduced?0:.10*Math.sin(Math.PI*p);
   const outgoing=ease((p-.22)/.23),arrival=ease((p-.51)/.18),seat=ease((p-.72)/.10);
   const right=new T.Vector3().setFromMatrixColumn(s.preview.camera.matrixWorld,0);right.y=0;right.normalize();const reach=Math.max(.9,Math.min(2,s.extent.length()*.7));
   s.out.group.visible=!s.reduced&&p>.22&&p<.51;s.out.group.position.copy(right).multiplyScalar(-reach*outgoing);s.out.group.position.y=.48*Math.sin(outgoing*Math.PI/2);s.out.group.position.z-=.35*outgoing;
   s.incoming.group.visible=!s.reduced&&p>.51&&p<.82;s.incoming.group.position.copy(right).multiplyScalar(reach*(1-arrival));s.incoming.group.position.y=.48*(1-seat);
   s.outline.visible=p<.82;s.outline.traverse(o=>{if(o.material)o.material.opacity=.55+.35*Math.sin(p*25);});
   s.scan.visible=p>=.82&&p<.96;
   s.scan.traverse(o=>{if(!o.isLineSegments)return;const count=o.geometry.attributes.position.count,trace=ease((p-.82)/.14);o.geometry.setDrawRange(0,Math.floor(count*trace/2)*2);o.material.color.setHex(0xe0fff5);o.material.opacity=1-trace*.6;});
   if(p>=(s.reduced?.5:.82))apply(s);
   const phase=s.reduced?(s.applied?'✓ 장착 완료':'교체 위치'):p<.22?'교체 위치':p<.51?'① 기존 부품 빼기':p<.72?'② 새 부품 가져오기':p<.82?'③ 자리에 맞추기':'✓ 장착 완료';
   s.label.replaceChildren();const title=document.createElement('b');title.textContent='🔧 '+(slotOf(s.slot)?.name||'부품')+' 교체 · '+phase;s.label.append(title);
   for(const [cls,text]of [['pu-swap-old',(s.integrated?'기존  ':'빼기  ')+partName(s.before[s.slot],s.slot)+(s.integrated?' · 차체 일체형':'')],['pu-swap-new',(s.applied?'장착!  ':'넣기  ')+partName(s.after[s.slot],s.slot)]]){const line=document.createElement('span');line.className=cls;line.textContent=text;s.label.append(line);}
   if(p>=1)finish();
  }
 };
}
