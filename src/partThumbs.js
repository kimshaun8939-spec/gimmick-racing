// 부품의 실제 장착 모습을 확대 촬영하며, 숨은 렌더러 하나와 파일 해시 캐시를 재사용합니다.
import * as T from 'three';
import {createCarModel} from './carModel.js';
import {listCars} from './carRoster.js';
import {partOf,partLook} from './parts.js';
export {PART_VIEW} from './carParts3d.js';
import {PART_VIEW} from './carParts3d.js';

const VERSION=8,STORE='gimmick.partThumbs',mem=new Map();
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
 studio={renderer,scene,camera,env};return studio;
}
const fake=()=>({pos:new T.Vector3(),up:new T.Vector3(0,1,0),fwd:new T.Vector3(0,0,1),vel:new T.Vector3(),mode:'normal',sink:0,forwardSpeed:0,thr:0,grounded:true,surface:'road',drifting:false,driftDir:0,driftLevel:0,steerVisual:0,load:0,form:null,flying:false,boostTime:0,brk:0});
/** partThumb('engine_turbo', {carId:'f1',size:400}) → Promise<dataURL>.
 * size는 가로 폭, 세로는 2/3. {width,height}도 가능. 순정은 'stock' + slot 옵션.
 * 동시 요청은 차례로 처리하며 실패는 reject. UI 연결은 호출하는 쪽에서 담당.
 */
export function partThumb(partId,{carId='f1',size=400,slot='engine'}={}){
 const job=queue.then(async()=>{
  const p=partOf(partId);if(!p&&partId!=='stock')throw new Error('알 수 없는 부품: '+partId);
  slot=p?.slot||slot;if(!PART_VIEW[slot])throw new Error('알 수 없는 부품 칸: '+slot);
  const cars=await listCars(),car=cars.find(c=>c.id===carId);if(!car)throw new Error('알 수 없는 차: '+carId);
  const width=Math.max(64,Math.min(1024,Math.round(typeof size==='number'?size:size.width)||400)),height=Math.max(64,Math.min(1024,Math.round(typeof size==='number'?size*2/3:size.height)||267));
  const key=hash(JSON.stringify([VERSION,partId,carId,slot,width,height,await sourceHash(),car.look,p?.look]));
  if(mem.has(key))return mem.get(key);
  try{const old=JSON.parse(localStorage.getItem(STORE)||'{}');if(old[key]){mem.set(key,old[key]);return old[key];}}catch{}
  const st=await getStudio(),m=createCarModel(car.look,{parts:partLook(p?{[slot]:partId}:{})});
  try{
   const f=fake();if(slot==='water'){f.mode='boat';f.surface='water';}m.sync(f,2,0);st.scene.add(m.root);m.root.updateMatrixWorld(true);
   const v=PART_VIEW[slot],target=new T.Vector3(...v.look);let span=1.35;
   const group=m.root.getObjectByName('part-'+(slot==='tire'?'tire-0':slot==='aero'&&p?.look.kind==='splitter'?'splitter':slot));
   if(group){const b=new T.Box3().setFromObject(group);b.getCenter(target);span=Math.max(.65,b.getSize(new T.Vector3()).length());}
   else if(slot==='engine'||slot==='gearbox'){const a=m.partMounts[slot];target.set(0,a.y,a.z);span=1.35;}
   if(slot==='water'&&group){const b=new T.Box3().setFromObject(group);b.getCenter(target);span=p?.look.hull==='jet'?1.9:4.2;}
   if(slot==='tire')span=Math.max(span,2.1);
   if(slot==='aero'&&p?.look.kind==='splitter')span=Math.max(.9,span*.72);
   if(slot==='aero'&&p?.look.kind==='lip')span=Math.max(.9,span*.78);

   const cam=st.camera;cam.fov=v.fov;cam.aspect=width/height;cam.zoom=1;cam.position.copy(target).add((slot==='aero'&&p?.look.kind==='splitter'?new T.Vector3(2,.65,4):slot==='water'?new T.Vector3(5,-.45,-1.8):new T.Vector3(...v.pos).sub(new T.Vector3(...v.look))).normalize().multiplyScalar(span*.55/Math.min(1,width/height)/Math.tan(T.MathUtils.degToRad(v.fov/2))));cam.lookAt(target);cam.updateProjectionMatrix();cam.layers.mask=511;
   st.renderer.setSize(width,height,false);st.renderer.render(st.scene,cam);
   const url=st.renderer.domElement.toDataURL('image/webp',.88);mem.set(key,url);
   try{const old=JSON.parse(localStorage.getItem(STORE)||'{}');old[key]=url;const entries=Object.entries(old).slice(-60);localStorage.setItem(STORE,JSON.stringify(Object.fromEntries(entries)));}catch{}
   return url;
  }finally{m.dispose();}
 });queue=job.catch(()=>{});return job;
}
/** 메뉴 종료 시 GPU 자원 반환. 진행 중인 촬영이 끝난 뒤 실행. */
export function disposePartThumbs(){const job=queue.then(()=>{if(studio){studio.env.dispose();studio.renderer.dispose();studio.renderer.forceContextLoss();studio=null;}});queue=job.catch(()=>{});return job;}
