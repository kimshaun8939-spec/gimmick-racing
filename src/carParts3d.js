import * as T from 'three';
import {partTireGeometry} from './carBody_wheels.js';
import {batchLocal} from './staticBatch.js';
// 순정 날개/앞 범퍼를 차체 좌표가 아닌 해당 그룹의 지역 좌표로 잰다.
function bounds(group){group.updateMatrixWorld(true);const inv=group.matrixWorld.clone().invert(),b=new T.Box3(),q=new T.Box3();group.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();q.copy(o.geometry.boundingBox).applyMatrix4(new T.Matrix4().multiplyMatrices(inv,o.matrixWorld));b.union(q);});return b;}
export function createParts3d({body,spoiler,fWing,hull,wheels,A,M,drs}){
 const rear=bounds(spoiler),front=bounds(fWing),nodes=[],resources=new Set(),materials=new Set();
 if(drs){drs.updateMatrix();drs.geometry.computeBoundingBox();rear.copy(drs.geometry.boundingBox).applyMatrix4(drs.matrix);}
 const rearSize=rear.getSize(new T.Vector3()),rearCenter=rear.getCenter(new T.Vector3());
 const mounts={rear:{width:rearSize.x,y:rear.max.y,z:rearCenter.z},front:{width:front.max.x-front.min.x,y:front.min.y,z:front.max.z}};
 let signature='',jet=false;
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
 function setParts(parts={}){
  const next=JSON.stringify(parts||{});if(next===signature)return;signature=next;clear();parts=parts||{};jet=parts.water?.hull==='jet';setWalls(!parts.tire);
  if(parts.tire){const p=parts.tire,mat=new T.MeshStandardMaterial({color:p.sidewall||'#ef3947',roughness:.7});mat.userData.partOwned=true;
   for(let i=0;i<wheels.length;i++){const w=wheels[i],g=group(w.spin,'tire-'+i);mesh(g,partTireGeometry(w.r,A.wheels[i][4],w.side,p.tread==='knob'),mat);}
  }
  const p=parts.aero;if(p&&!rear.isEmpty()){
   const isLip=p.kind==='lip',isSplit=p.kind==='splitter',g=group(isSplit?fWing:spoiler,isSplit?'splitter':'aero');
   if(isSplit){const width=Math.min(1.85,mounts.front.width*.92),y=front.min.y+.006,z=front.max.z-.12;box(g,width,.022,.40,M.carbon,0,y,z);}
   else {const w=Math.min(2.05,rearSize.x*.90),z=rearCenter.z,y=rear.max.y;
    // 작은 끝판으로 기존 날개에 직접 연결. 중앙 시야보다 낮게 유지.
    const gap=isLip?.018:.075;box(g,w,.024,isLip?.10:.18,M.carbon,0,y+gap,z);
    for(const s of [-1,1])box(g,.022,gap+.03,.16,M.carbon,s*(w/2-.011),y+gap/2,z);
   }
  }
  const water=parts.water;if(water){const g=group(hull,'water');
   if(water.hull==='deepv'){
    // 선체 바닥에 이어지는 삼각 용골: 위 모서리는 기존 V 바닥 안에 고정.
    const pos=[],idx=[];for(const [z,w,d]of [[2.3,.01,.15],[.8,.14,.36],[-2.3,.14,.30]])pos.push(-w,-.14,z,w,-.14,z,0,-d,z);
    for(let i=0;i<2;i++)for(let j=0;j<3;j++){const a=i*3+j,b=i*3+(j+1)%3;idx.push(a,a+3,b,b,a+3,b+3);}idx.push(0,1,2,6,8,7);
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();mesh(g,geo,M.carbon);
   }else if(water.hull==='jet')for(const s of [-1,1]){
    mesh(g,new T.CylinderGeometry(.16,.19,.30,8,1,true).rotateX(Math.PI/2),M.darkMetal,s*.68,.18,-2.78);
    mesh(g,new T.CircleGeometry(.145,8).rotateY(Math.PI),M.dark,s*.68,.18,-2.94);
    mesh(g,new T.TorusGeometry(.16,.012,3,8),M.metal,s*.68,.18,-2.935);
   }else for(const s of [-1,1]){
    box(g,.34,.045,3.8,M.carbon,s*.99,.035,.1);
    for(const z of [-.25,-1.35])box(g,.46,.035,.18,M.carbon,s*.99,.008,z);
   }
  }
  // 교체 그룹 안에서 먼저 PBR로 합치고 바깥 묶음으로부터 보호한다.
  for(const g of nodes){const collect=()=>g.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material&&!o.material.userData.pbrBake&&!Object.values(M).includes(o.material))materials.add(o.material);});collect();g.userData.noBatch=false;batchLocal(g,{pbr:true});collect();g.traverse(o=>{o.userData.noBatch=true;});}
 }
 return {setParts,dispose(){clear();for(const w of wheels)if(w.wall)w.wall.visible=true;},mounts,pose(motors){if(jet)for(const m of motors)m.g.visible=false;}};
}
