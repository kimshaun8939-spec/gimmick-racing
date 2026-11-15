import * as T from 'three';

import {batchLocal} from './staticBatch.js';
// 사진 전용 참조. 게임의 메시·재질·그림 호출은 바꾸지 않는다.
const photoKits=new WeakMap();
export function isolatedPart(model,slot,look){
 const kit=photoKits.get(model.fp.body),out=new T.Group();
 if(!kit)return out;
 const source=slot==='tire'?kit.wheels[0].spin:look?model.root.getObjectByName('part-'+(slot==='aero'&&look.kind==='splitter'?'splitter':slot)):slot==='aero'?kit.spoiler:slot==='water'?kit.hull:null;
 if(source){const c=source.clone(true),hidden=[];c.traverse(o=>{if(o!==c&&(!o.visible||Math.max(o.scale.x,o.scale.y,o.scale.z)<.01))hidden.push(o);});for(const o of hidden)o.removeFromParent();c.position.set(0,0,0);c.quaternion.identity();c.scale.set(1,1,1);c.visible=true;out.add(c);}
 else if(slot==='engine'){
  if(kit.style==='f1'||kit.style==='kart'){
   // 순정 차체는 재질별로 합쳐져 있다. 엔진 구역 안의 삼각형만 사진용으로 복사.
   const region=kit.style==='kart'?new T.Box3(new T.Vector3(.20,.14,-1.15),new T.Vector3(.56,.60,-.33)):new T.Box3(new T.Vector3(-.13,.42,-2.18),new T.Vector3(.13,.61,-1.88));
   kit.body.traverse(o=>{if(!o.isMesh||o.userData.partVisual)return;for(let n=o;n;n=n.parent)if(!n.visible)return;if(kit.style==='f1'&&o.material?.color?.getHSL({}).s>.3)return;const pos=o.geometry.attributes.position,idx=o.geometry.index,points=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
    for(let i=0;i<(idx?.count||pos.count);i+=3){a.fromBufferAttribute(pos,idx?idx.getX(i):i).applyMatrix4(o.matrixWorld);b.fromBufferAttribute(pos,idx?idx.getX(i+1):i+1).applyMatrix4(o.matrixWorld);c.fromBufferAttribute(pos,idx?idx.getX(i+2):i+2).applyMatrix4(o.matrixWorld);if(region.containsPoint(a)&&region.containsPoint(b)&&region.containsPoint(c))points.push(...a.toArray(),...b.toArray(),...c.toArray());}
    if(points.length){const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(points,3));geo.computeVertexNormals();const m=new T.Mesh(geo,o.material);m.userData.photoGeometry=true;out.add(m);}
   });return out;
  }
  // 순정 배기처럼 차체와 별도인 작은 금속 메시만 추출한다.
  const b=new T.Box3(),v=new T.Vector3();
  const candidates=[];
  kit.body.traverse(o=>{if(!o.isMesh||o.userData.partVisual)return;for(let n=o;n;n=n.parent)if(!n.visible)return;o.geometry.computeBoundingBox();b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);b.getSize(v);const c=b.getCenter(new T.Vector3());if(c.z<-.45&&v.z<1.9&&v.y<.65&&v.x<1.65&&v.length()<2&&v.length()>.15&&o.material?.metalness>.4)candidates.push({o,volume:v.x*v.y*v.z});});
  // 작은 고정쇠나 다른 장치를 섞지 않고 독립된 주 부품만 꺼낸다.
  const o=candidates.sort((a,b)=>b.volume-a.volume)[0]?.o;
  if(o){const m=o.clone(false);m.matrix.copy(o.matrixWorld);m.matrix.decompose(m.position,m.quaternion,m.scale);out.add(m);}
 }
 return out;
}
// 차 지역 좌표: +x 오른쪽, +y 위, +z 앞. 조립 화면과 부품 사진 공용.
export const PART_VIEW=Object.freeze({
 engine:{pos:[2.8,1.3,-5.2],look:[0,.4,-1.8],fov:32},
 gearbox:{pos:[1.8,.65,-4.8],look:[0,.22,-1.8],fov:28},
 tire:{pos:[4,.85,1.4],look:[1,.4,1.4],fov:30},
 aero:{pos:[2.8,3,-5.2],look:[0,1.1,-1.9],fov:34},
 water:{pos:[5,1.5,-2.4],look:[0,.1,0],fov:42},
});
// 순정 날개/앞 범퍼를 차체 좌표가 아닌 해당 그룹의 지역 좌표로 잰다.
function bounds(group){group.updateMatrixWorld(true);const inv=group.matrixWorld.clone().invert(),b=new T.Box3(),q=new T.Box3();group.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();q.copy(o.geometry.boundingBox).applyMatrix4(new T.Matrix4().multiplyMatrices(inv,o.matrixWorld));b.union(q);});return b;}
export function createParts3d({body,spoiler,fWing,hull,wheels,A,M,drs,normalBounds,style}){
 photoKits.set(body,{body,spoiler,hull,wheels,style});
 const rear=bounds(spoiler),front=bounds(fWing),nodes=[],resources=new Set(),materials=new Set();
 if(drs){drs.updateMatrix();drs.geometry.computeBoundingBox();rear.copy(drs.geometry.boundingBox).applyMatrix4(drs.matrix);}
 const rearSize=rear.getSize(new T.Vector3()),rearCenter=rear.getCenter(new T.Vector3());
 const mounts={rear:{width:rearSize.x,y:rear.max.y,z:rearCenter.z},front:{width:front.max.x-front.min.x,y:front.min.y,z:front.max.z}};
 let signature='',jet=false;
 const rearZ=style==='rocket'?-2.51:-normalBounds.back+.09;
 const rearY=Math.max(.20,Math.min(...A.wheels.map(w=>w[3]))*.65);
 mounts.engine={width:.76,y:rearY,z:rearZ};mounts.gearbox={width:.48,y:rearY-.11,z:rearZ};
 const finish=color=>new T.MeshStandardMaterial({color,metalness:.65,roughness:.32});
 function clear(){for(const g of resources)g.dispose();resources.clear();for(const m of materials)m.dispose();materials.clear();for(const g of nodes){g.removeFromParent();}nodes.length=0;}
 // stockcalls: 순정 타이어 띠는 바퀴 묶음(batchLocal) 안에 합쳐져 있어 그림 호출이 늘지 않음.
 //   부품 타이어가 띠를 숨기거나 되돌릴 때만 그 바퀴 묶음을 풀고 다시 묶음 (숨은 띠는 혼자 남아 그려지지 않음).
 //   묶음 여부는 차 전체에서 봄 (띠가 숨어 있는 동안 그 바퀴엔 묶인 것이 하나도 없을 수 있음)
 function batchState(){let on=false,pbr=false;for(const r of [body,...wheels.map(w=>w.spin)])r.traverse(o=>{if(o.userData.batched){on=true;if(o.material?.userData?.pbrBake)pbr=true;}});return {on,pbr};}
 function setWalls(show){if(!wheels.some(w=>w.wall&&w.wall.visible!==show))return;const st=batchState();
  for(const w of wheels){const wall=w.wall;if(!wall||wall.visible===show)continue;
   for(const o of w.spin.children.filter(o=>o.userData.batched&&o.userData.undo))o.userData.undo();wall.visible=show;if(st.on)batchLocal(w.spin,{pbr:st.pbr});}}
 function group(parent,name){const g=new T.Group();g.name='part-'+name;g.userData.noBatch=true;g.userData.partVisual=true;parent.add(g);nodes.push(g);return g;}
 function mesh(g,geo,mat,x=0,y=0,z=0){const o=new T.Mesh(geo,mat);o.position.set(x,y,z);o.userData.partVisual=true;o.castShadow=false;g.add(o);return o;}
 const box=(g,w,h,d,mat,x,y,z)=>mesh(g,new T.BoxGeometry(w,h,d),mat,x,y,z);
 // ????? ?? ???? ???? ?? ? ?? ???.
 function blockTread(width,r){const g=new T.BufferGeometry(),x=width*.49,z=r*.13,y=.015;g.setAttribute('position',new T.Float32BufferAttribute([-x,0,-z,x,0,-z,x,0,z,-x,0,z,-x,y,-z,x,y,-z,x,y,z,-x,y,z],3));g.setIndex([4,6,5,4,7,6,0,7,4,0,3,7,1,5,6,1,6,2]);g.computeVertexNormals();return g;}
 function setParts(parts={}){
  const next=JSON.stringify(parts||{});if(next===signature)return;signature=next;clear();parts=parts||{};jet=parts.water?.hull==='jet';setWalls(!parts.tire);
  if(parts.tire){const p=parts.tire,mat=new T.MeshStandardMaterial({color:p.sidewall||'#ef3947',roughness:.7});mat.userData.partOwned=true;
   const rubber=new T.MeshStandardMaterial({color:'#24262b',roughness:.92});
   for(let i=0;i<wheels.length;i++){const w=wheels[i],width=A.wheels[i][4],g=group(w.spin,'tire-'+i),side=w.side,r=w.r,t=p.tread;
    mesh(g,new T.RingGeometry(r*(t==='slick'?.84:t==='knob'?.67:.76),r*(t==='slick'?.865:.88),10).rotateY(side*Math.PI/2),mat,side*(width/2+.006),0,0);
    if(t!=='slick'){
     if(t==='drift')mesh(g,new T.RingGeometry(r*.70,r*.79,10).rotateY(side*Math.PI/2),M.metal,side*(width/2+.009),0,0);
     for(let j=0;j<4;j++){const a=j*Math.PI/2;
      const geo=t==='knob'?blockTread(width,r):new T.PlaneGeometry(width*.88,.025).rotateZ(.48);
      geo.rotateX(-Math.PI/2).translate(0,r-.002,0).rotateX(a);mesh(g,geo,t==='knob'?rubber:M.dark);
     }
    }
   }
  }
  if(parts.engine){
   const n=parts.engine.no||1,g=group(body,'engine'),metal=finish(n===1?'#779acb':n===2?'#34373d':'#c28b4c');
   const count=n===1?2:n===2?4:1,r=n===1?.064:n===2?.075:.12;
   // 범퍼 낮은 중앙: 가속 모드 노즐 및 운전자 머리와 분리.
   box(g,.76,.12,.18,M.darkMetal,0,rearY,rearZ+.025);
   for(let i=0;i<count;i++){
    const x=(i-(count-1)/2)*(n===2?.15:.25);
    const pipe=(n===2?new T.CylinderGeometry(r,r,.14,4,1,true).rotateY(Math.PI/4):new T.CylinderGeometry(r,r*.88,n===1?.36:.23,8,1,true)).rotateX(Math.PI/2);if(n===1){const a=pipe.attributes.position;for(let j=0;j<a.count;j++)if(a.getZ(j)<-.1)a.setZ(j,a.getZ(j)+a.getX(j)*.5);pipe.computeVertexNormals();}mesh(g,pipe,metal,x,rearY,rearZ-.12);
    mesh(g,new T.CircleGeometry(r*.80,n===2?4:8).rotateY(Math.PI),M.dark,x,rearY,rearZ-.238);
   }
   if(n===3)for(const side of [-1,1]){box(g,.14,.20,.26,metal,side*.40,rearY+.09,rearZ+.04);box(g,.11,.13,.012,M.dark,side*.40,rearY+.09,rearZ-.096);}
   else for(let i=0;i<(n===1?5:3);i++)box(g,.06,.04,.22,metal,(i-(n===1?2:1))*.12,rearY+.085,rearZ+.04);
  }
  if(parts.gearbox){
   const n=parts.gearbox.no||1,g=group(body,'gearbox'),metal=finish('#454b55'),accent=finish(n===1?'#bf414b':n===2?'#4084c0':'#c5a458');
   // ? ???? ?? ?? ???. ?? ??? ???? ???.
   const y=rearY+.10,z=rearZ-.075,w=n===1?.34:n===2?.25:.29,h=n===1?.18:.12,d=n===2?.38:.20;
   mounts.gearbox={width:w,y,z};
   box(g,w+.02,h+.02,.12,M.darkMetal,0,y,z+.08);
   mesh(g,new T.CylinderGeometry(w/2,w*.43,d,6).rotateX(Math.PI/2).scale(1,h/w,1),metal,0,y,z-d/2+.07);
   for(let j=0;j<1;j++)box(g,w+.012,.015,.024,M.metal,0,y-h*.34+j*h*.34,z-d+.07);
   box(g,.07,.025,.012,accent,0,y+h*.37,z-d+.05);
   for(const side of [-1,1])mesh(g,new T.CylinderGeometry(.018,.018,.012,3).rotateX(Math.PI/2),M.metal,side*w*.38,y,z-d+.05);
   if(n===3){mesh(g,new T.TorusGeometry(.09,.012,3,6),accent,0,y,z-d+.045);for(const side of [-1,1]){const o=box(g,.035,.12,.025,M.metal,side*.19,y,z-.09);o.rotation.z=side*.3;}}
  }
  const p=parts.aero;if(p&&!rear.isEmpty()){
   const isLip=p.kind==='lip',isSplit=p.kind==='splitter',g=group(isSplit?fWing:spoiler,isSplit?'splitter':'aero');
   if(isSplit){const width=Math.min(1.85,mounts.front.width*.92),y=front.min.y+.006,z=front.max.z-.12;box(g,width,.022,.40,M.carbon,0,y,z);}
   else {const w=Math.min(2.05,rearSize.x*.90),z=rearCenter.z,y=rear.max.y;
    // 작은 끝판으로 기존 날개에 직접 연결. 중앙 시야보다 낮게 유지.
    const gap=isLip?.018:.095;const blade=box(g,w,.024,isLip?.10:.24,isLip?M.metal:M.carbon,0,y+gap,z);blade.rotation.x=isLip?-.12:.18;
    if(!isLip)for(const side of [-1,1]){const e=box(g,.025,.16,.28,M.carbon,side*(w/2-.012),y+gap+.085,z-.015);e.rotation.x=-.14;}
    for(const s of [-1,1])box(g,.022,gap+.03,.16,M.carbon,s*(w/2-.011),y+gap/2,z);
   }
  }
  const water=parts.water;if(water){const g=group(hull,'water');
   if(water.hull==='deepv'){
    // 선체 바닥에 이어지는 삼각 용골: 위 모서리는 기존 V 바닥 안에 고정.
    const pos=[],idx=[];for(const [z,w,d]of [[2.3,.01,.15],[.8,.14,.36],[-2.3,.14,.30]])pos.push(-w,-.14,z,w,-.14,z,0,-d,z);
    for(let i=0;i<2;i++)for(let j=0;j<3;j++){const a=i*3+j,b=i*3+(j+1)%3;idx.push(a,a+3,b,b,a+3,b+3);}idx.push(0,1,2,6,8,7);
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();mesh(g,geo,M.metal);
   }else if(water.hull==='jet')for(const s of [-1,1]){
    mesh(g,new T.CylinderGeometry(.16,.19,.30,6,1,true).rotateX(Math.PI/2),M.darkMetal,s*.68,.18,-2.78);
    mesh(g,new T.CircleGeometry(.145,6).rotateY(Math.PI),M.dark,s*.68,.18,-2.94);
    mesh(g,new T.TorusGeometry(.16,.012,3,4),M.metal,s*.68,.18,-2.935);
   }else for(const s of [-1,1]){
    box(g,.34,.045,3.8,M.metal,s*.99,.035,.1);
    for(const z of [-.25,-1.35])box(g,.46,.035,.18,M.carbon,s*.99,.008,z);
   }
  }
  // 교체 그룹 안에서 먼저 PBR로 합치고 바깥 묶음으로부터 보호한다.
  for(const g of nodes){const collect=()=>g.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material&&!o.material.userData.pbrBake&&!Object.values(M).includes(o.material))materials.add(o.material);});collect();g.userData.noBatch=false;batchLocal(g,{pbr:true});collect();g.traverse(o=>{o.userData.noBatch=true;});}
 }
 return {setParts,dispose(){clear();for(const w of wheels)if(w.wall)w.wall.visible=true;},mounts,pose(motors){if(jet)for(const m of motors)m.g.visible=false;}};
}
