// 부품의 조립되지 않은 단독 모습을 촬영하며, 숨은 렌더러 하나와 파일 해시 캐시를 재사용합니다.
import * as T from 'three';
import {createCarModel} from './carModel.js';
import {listCars} from './carRoster.js';
import {partOf,partLook,partLevel} from './parts.js';
export {PART_VIEW} from './carParts3d.js';
import {PART_VIEW,isolatedPart} from './carParts3d.js';

const VERSION=12,STORE='gimmick.partThumbs',mem=new Map();
let studio,queue=Promise.resolve(),source;
const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36);};
async function sourceHash(){
 source??=(async()=>{
  const files=['partThumbs','carParts3d','carModel','carWheels','carLighting','carCostumes','staticBatch','carBody_clearance','carBody_boat','carBody_accel','carBody_wheels','carBody_cockpit',...['f1','gt','rally','proto','rocket','buggy','hatch','muscle','hyper','kart','roadster','truck','ev','wedge','van'].map(s=>'carBody_'+s)];
  const texts=await Promise.all(files.map(f=>fetch(new URL('./'+f+'.js',import.meta.url)).then(r=>{if(!r.ok)throw Error(f);return r.text();})));
  return hash(texts.join('|'));
 })();return source;
}
async function getStudio(){
 if(studio)return studio;
 const renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setClearColor(0,0);renderer.toneMapping=T.ACESFilmicToneMapping;
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1.5,.02,100);
 scene.add(new T.HemisphereLight('#e3efff','#363b49',2));
 for(const [pos,col,power]of [[[4,6,-6],'#fff3e4',3],[[-4,3,-4],'#b6d9ff',2],[[0,5,5],'#ffffff',2]]){const l=new T.DirectionalLight(col,power);l.position.set(...pos);scene.add(l);}
 const {RoomEnvironment}=await import('three/addons/environments/RoomEnvironment.js');
 const pm=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pm.fromScene(room,.04);scene.environment=env.texture;room.dispose();pm.dispose();
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
 const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(64,64,4,64,64,64);gradient.addColorStop(0,'#0007');gradient.addColorStop(1,'#0000');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
 const shadowMap=new T.CanvasTexture(canvas),shadow=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.visible=false;scene.add(shadow);
 studio={renderer,scene,camera,env,shadow,shadowMap};return studio;
}
function stockIcon(slot,width,height){
 const labels={engine:'순정 배기',gearbox:'순정 · 차체 일체형',tire:'순정 휠',aero:'순정 날개',water:'순정 추진 장치'};
 const paths={gearbox:'M55 60L83 42H129L153 60V99L129 117H83L55 99ZM70 70H138M70 86H138M88 43V116M119 43V116',engine:'M55 62H145V98H55ZM68 98V117H83V98M116 98V117H131V98',aero:'M37 70H171V81H37ZM67 81V111M141 81V111',water:'M35 61H174L147 106H65ZM65 106L105 125L147 106'};
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 210 160"><g fill="#344b60" stroke="#acc6d9" stroke-width="4" stroke-linejoin="round"><path d="'+(paths[slot]||paths.gearbox)+'"/></g><text x="105" y="150" text-anchor="middle" fill="#cee6ed" font-size="15" font-family="sans-serif">'+labels[slot]+'</text></svg>';
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
const fake=()=>({pos:new T.Vector3(),up:new T.Vector3(0,1,0),fwd:new T.Vector3(0,0,1),vel:new T.Vector3(),mode:'normal',sink:0,forwardSpeed:0,thr:0,grounded:true,surface:'road',steerVisual:0,load:0,form:null,flying:false,boostTime:0,brk:0});
/** partThumb('engine_turbo', {carId:'f1',size:400}) → Promise<dataURL>.
 * size는 가로 폭, 세로는 2/3. {width,height}도 가능. 순정은 'stock' + slot 옵션.
 * 동시 요청은 차례로 처리하며 실패는 reject. UI 연결은 호출하는 쪽에서 담당.
 */
export function partThumb(partId,{carId='f1',size=400,slot='engine',lv}={}){
 // upgradeD1: lv = 강화 단계 모양 (없으면 내 단계). 캐시 키에 들어감
 lv=Math.max(1,Math.min(5,Math.floor(Number(lv??(partOf(partId)?partLevel(partId):1)))||1));
 const job=queue.then(async()=>{
  const p=partOf(partId);if(!p&&partId!=='stock')throw new Error('알 수 없는 부품: '+partId);
  slot=p?.slot||slot;if(!PART_VIEW[slot])throw new Error('알 수 없는 부품 칸: '+slot);
  const cars=await listCars(),car=cars.find(c=>c.id===carId);if(!car)throw new Error('알 수 없는 차: '+carId);
  const width=Math.max(64,Math.min(1024,Math.round(typeof size==='number'?size:size.width)||400)),height=Math.max(64,Math.min(1024,Math.round(typeof size==='number'?size*2/3:size.height)||267));
  const key=hash(JSON.stringify([VERSION,partId,carId,slot,width,height,await sourceHash(),car.look,p?.look,lv]));
  if(mem.has(key))return mem.get(key);
  try{const old=JSON.parse(localStorage.getItem(STORE)||'{}');if(old[key]){mem.set(key,old[key]);return old[key];}}catch{}
  const st=await getStudio();
  if(st.carId!==carId){st.model?.dispose();st.model=createCarModel(car.look);st.carId=carId;}
  // partfit: 배기·날개 순정 카드도 실제 교체되는 부분을 그대로 촬영한다.
  if(!p&&!['tire','engine','aero','water'].includes(slot)){const url=stockIcon(slot,width,height);mem.set(key,url);return url;}
  const m=st.model;m.setParts(partLook(p?{[slot]:partId}:{},{levels:p?{[partId]:lv}:false}));
  try{
   const f=fake();if(slot==='water'){f.mode='boat';f.surface='water';}m.sync(f,2,0);m.root.updateMatrixWorld(true);
   const product=isolatedPart(m,slot,p?.look);st.scene.add(product);st.product=product;
   // 순정에 독립된 메시가 없는 칸은 명확한 순정 표식으로 표시.
   if(!product.children.length){const url=stockIcon(slot,width,height);mem.set(key,url);return url;}
   const bounds=new T.Box3().setFromObject(product);if(bounds.isEmpty()){const url=stockIcon(slot,width,height);mem.set(key,url);return url;}
   const center=bounds.getCenter(new T.Vector3());product.position.sub(center);product.updateMatrixWorld(true);
   const extent=bounds.getSize(new T.Vector3());st.shadow.scale.set(Math.max(extent.x,.3)*1.35,Math.max(extent.z,.3)*1.35,1);st.shadow.position.set(0,-extent.y/2-.025,0);st.shadow.visible=true;
   const cam=st.camera;cam.fov=32;cam.aspect=width/height;cam.zoom=1;cam.layers.mask=511;
   const direction=(slot==='tire'?new T.Vector3(-3,1.4,-4):slot==='water'?new T.Vector3(4,3,-5):new T.Vector3(2.7,2.1,-4)).normalize();
   cam.position.copy(direction);cam.lookAt(0,0,0);cam.updateMatrixWorld(true);
   const inv=cam.matrixWorldInverse,box=new T.Box3().setFromObject(product),q=new T.Vector3();let distance=0;
   const tan=Math.tan(T.MathUtils.degToRad(cam.fov/2));
   // 8개 모서리를 카메라 축에 투영: 길고 얇은 부품도 잘림 없이 꽉 채운다.
   for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){q.set(x,y,z).applyMatrix4(inv);q.z+=1;distance=Math.max(distance,q.z+Math.abs(q.x)/(tan*cam.aspect),q.z+Math.abs(q.y)/tan);}
   cam.position.copy(direction).multiplyScalar(distance*1.14);cam.lookAt(0,0,0);cam.updateProjectionMatrix();
   st.product=product;
   st.renderer.setSize(width,height,false);st.renderer.render(st.scene,cam);
   const url=st.renderer.domElement.toDataURL('image/webp',.88);mem.set(key,url);
   try{const old=JSON.parse(localStorage.getItem(STORE)||'{}');old[key]=url;const entries=Object.entries(old).slice(-60);localStorage.setItem(STORE,JSON.stringify(Object.fromEntries(entries)));}catch{}
   return url;
  }finally{st.shadow.visible=false;if(st.product){st.product.traverse(o=>{if(o.userData.photoGeometry)o.geometry.dispose();});st.scene.remove(st.product);st.product=null;}}
 });queue=job.catch(()=>{});return job;
}
/** 메뉴 종료 시 GPU 자원 반환. 진행 중인 촬영이 끝난 뒤 실행. */
export function disposePartThumbs(){const job=queue.then(()=>{if(studio){studio.model?.dispose();studio.shadow.geometry.dispose();studio.shadow.material.dispose();studio.shadowMap.dispose();studio.env.dispose();studio.renderer.dispose();studio.renderer.forceContextLoss();studio=null;}});queue=job.catch(()=>{});return job;}
