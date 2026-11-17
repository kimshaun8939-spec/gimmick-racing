import * as T from 'three';
import {batchLocal} from './staticBatch.js';
const smooth=x=>{x=T.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
// 작은 공용 재질만 유지해야 미리 준비한 프로그램이 첫 교체 전에 폐기되지 않는다.
let shared;
function workshopMaterials(){return shared??=(Object.fromEntries([
 ['orange',new T.MeshStandardMaterial({color:'#dc7528',metalness:.6,roughness:.36})],['steel',new T.MeshStandardMaterial({color:'#8d9ba7',metalness:.8,roughness:.3})],['dark',new T.MeshStandardMaterial({color:'#202a34',metalness:.55,roughness:.5})],['yellow',new T.MeshStandardMaterial({color:'#e9bb4b',roughness:.6})],['light',new T.MeshBasicMaterial({color:'#d7f5ff'})],['spark',new T.LineBasicMaterial({color:'#ffd477',transparent:true,depthTest:false})]
]));}
// Workshop lives only inside a detail/upgrade operation. No timers or render loop.
export function createPitRobot(parent,center,extent,slot='engine'){
 const root=new T.Group();root.name='pit-workshop';parent.add(root);
 const pool=workshopMaterials(),{orange,steel,dark,yellow,light}=pool;
 const add=(p,geo,m,x=0,y=0,z=0)=>{const o=new T.Mesh(geo,m);o.position.set(x,y,z);p.add(o);return o;};
 const box=(p,w,h,d,m,x,y,z)=>add(p,new T.BoxGeometry(w,h,d),m,x,y,z);
 const staticRoot=new T.Group();root.add(staticRoot);
 box(staticRoot,6.4,.10,7.6,dark,0,-.18,0);
 for(const s of [-1,1]){box(staticRoot,.5,.17,6.2,steel,s*.78,-.06,0);box(staticRoot,.06,.012,7,yellow,s*2.45,-.12,0);for(let i=0;i<7;i++){const o=box(staticRoot,.26,.015,.09,yellow,s*1.25,-.12,-2.8+i*.15);o.rotation.y=-s*.65;}}
 // Back tool board and compact work lights avoid blocking the camera side.
 box(staticRoot,2.4,1.25,.10,dark,-1.5,.60,3.9);
 for(let i=0;i<9;i++){box(staticRoot,.05,.27,.04,steel,-2.45+i*.24,.75,3.81);add(staticRoot,new T.TorusGeometry(.055,.018,4,8),steel,-2.45+i*.24,.9,3.80);}
 for(const s of [-1,1]){box(staticRoot,.09,2.8,.09,steel,s*2.8,1.2,2.7);box(staticRoot,.55,.12,.15,light,s*2.8,2.6,2.7);}
 const trayX=slot==='tire'?2.0:slot==='water'?-4.5:-1.9,trayZ=center.z;
 for(const z of [-.5,.5])box(staticRoot,.07,.72,.07,steel,trayX,.23,trayZ+z);
 box(staticRoot,1.05,.10,1.35,steel,trayX,.64,trayZ);
 batchLocal(staticRoot,{pbr:true});
 const base=new T.Vector3(slot==='tire'?2.7:slot==='water'?-2.7:2.7,slot==='water'?.08:.25,center.z+(slot==='aero'?-1:(slot==='engine'||slot==='gearbox')&&center.z<0?-1.3:.7));
 add(root,new T.CylinderGeometry(.32,.4,.3,10),dark,...base.toArray());
 const segments=[add(root,new T.CylinderGeometry(.13,.18,1,8),orange),add(root,new T.CylinderGeometry(.105,.13,1,8),orange)];
 const joints=Array.from({length:3},()=>add(root,new T.SphereGeometry(.17,8,6),steel));
 const hand=new T.Group();root.add(hand);box(hand,.32,.13,.22,dark,0,0,0);
 const jaws=[-1,1].map(s=>box(hand,.055,.27,.15,steel,s*.17,-.14,0));
 const socket=add(hand,new T.CylinderGeometry(.06,.06,.23,6),steel,0,-.2,0);
 const sparkGeo=new T.BufferGeometry(),positions=new Float32Array(36);sparkGeo.setAttribute('position',new T.BufferAttribute(positions,3));
 const sparks=new T.LineSegments(sparkGeo,pool.spark);root.add(sparks);
 const top=new T.Vector3(0,slot==='water'?-extent.y*.5-.12:Math.min(.5,extent.y*.45)+.16,0),park=base.clone().add(new T.Vector3(-.3,1.2,-.1)),target=center.clone().add(top),last=target.clone();
 const up=new T.Vector3(0,1,0),tmp=new T.Vector3();
 const link=(o,a,b)=>{tmp.subVectors(b,a);o.position.copy(a).add(b).multiplyScalar(.5);o.scale.y=tmp.length();o.quaternion.setFromUnitVectors(up,tmp.normalize());};
 return {root,tray:new T.Vector3(trayX,.72,trayZ),top,
  update(p,outOffset=new T.Vector3(),inOffset=new T.Vector3()){
   const work=p<.22||p>.77&&p<.91,grip=p>.20&&p<.79;
   target.copy(center).add(top);
   if(p>=.22&&p<.49)target.add(outOffset);else if(p>=.49&&p<.56)target.add(outOffset.clone().lerp(inOffset,smooth((p-.49)/.07)));else if(p>=.56&&p<.82)target.add(inOffset);
   if(p<.13)target.lerp(park,1-smooth(p/.13));if(p>.91)target.lerp(park,smooth((p-.91)/.09));
   const d=target.clone().sub(base),length=d.length(),axis=d.clone().normalize();
   const normal=new T.Vector3(0,1,0).addScaledVector(axis,-axis.y).normalize();
   const elbow=base.clone().addScaledVector(d,.5).addScaledVector(normal,Math.sqrt(Math.max(.06,2.2*2.2-length*length/4)));
   link(segments[0],base,elbow);link(segments[1],elbow,target);joints[0].position.copy(base);joints[1].position.copy(elbow);joints[2].position.copy(target);hand.position.copy(target);socket.rotation.y=work?p*180:0;socket.visible=work;hand.rotation.z=slot==='tire'?-Math.PI/2:0;
   if(slot==='water')hand.rotation.z=Math.PI;
   jaws.forEach((o,i)=>o.position.x=(i?1:-1)*(grip?.13:.23));
   sparks.visible=work&&p>.13&&Math.sin(p*170)>.25;
   for(let i=0;i<6;i++){const a=i*2.4+p*41,r=.09+(i%3)*.045;const j=i*6;positions[j]=target.x;positions[j+1]=target.y-.24;positions[j+2]=target.z;positions[j+3]=target.x+Math.cos(a)*r;positions[j+4]=target.y-.17+(i%2)*.10;positions[j+5]=target.z+Math.sin(a)*r;}sparkGeo.attributes.position.needsUpdate=true;sparks.frustumCulled=false;
   const speed=target.distanceTo(last);last.copy(target);return {speed,work};
  },
  dispose(){const undo=[];root.traverse(o=>{if(o.userData.batched&&o.userData.undo)undo.push(o.userData.undo);});undo.forEach(f=>f());const geos=new Set(),mats=new Set();root.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])if(!m.userData.pbrBake&&!Object.values(pool).includes(m))mats.add(m);});for(const g of geos)g.dispose();for(const m of mats)m.dispose();root.removeFromParent();}
 };
}
