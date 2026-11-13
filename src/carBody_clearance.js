// 차체/펜더에서 실제 바퀴가 움직일 공간을 잘라 내는 정적 휠하우스.
// 생성할 때 한 번만 계산한다. UV/꼭짓점 색/법선을 보간하므로 코스튬·batchLocal도 그대로 쓴다.
import * as THREE from 'three';
export function wheelWells(meshes, body, wheels, drop=.12) {
 body.updateWorldMatrix(true,true);
 const bodyInv=body.matrixWorld.clone().invert();
 for(const mesh of meshes){
  if(!mesh.isMesh||mesh.isInstancedMesh||mesh.material.transparent)continue;
  const source=mesh.geometry, p=source.attributes.position;if(!p)continue;
  const rel=bodyInv.clone().multiply(mesh.matrixWorld);source.computeBoundingBox();const bb=source.boundingBox.clone().applyMatrix4(rel);
  let planes=[];
  for(const [x,z,front,r,wd] of wheels){
   const inner=Math.abs(x)-wd/2-(front?r*Math.sin(.42):0)-.035;
   const cy=r+drop*.5, ry=r+.13+drop*.5, rz=r+.075;
   if(bb.max.y<cy-ry||bb.min.y>cy+ry||bb.max.z<z-rz||bb.min.z>z+rz||Math.max(Math.abs(bb.min.x),Math.abs(bb.max.x))<inner)continue;
   const side=Math.sign(x),ps=[new THREE.Plane(new THREE.Vector3(-side,0,0),inner)];
   for(let j=0;j<12;j++){const a=j*Math.PI/6,ny=Math.sin(a)/ry,nz=Math.cos(a)/rz;ps.push(new THREE.Plane(new THREE.Vector3(0,ny,nz),-1-ny*cy-nz*z));}planes.push(ps);
  }
  if(!planes.length)continue;
  const names=Object.keys(source.attributes), output=Object.fromEntries(names.map(n=>[n,[]]));let changed=false;
  const vertex=i=>{const at={};for(const n of names){const a=source.attributes[n];at[n]=Array.from({length:a.itemSize},(_,k)=>a.array[i*a.itemSize+k]);}return at;};
  const mix=(a,b,t)=>Object.fromEntries(names.map(n=>[n,a[n].map((v,i)=>v+(b[n][i]-v)*t)]));
  const dist=(v,pl)=>pl.distanceToPoint(new THREE.Vector3(...v.position).applyMatrix4(rel));
  const split=(poly,pl)=>{const inside=[],outside=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=dist(a,pl),db=dist(b,pl);(da<=1e-7?inside:outside).push(a);if((da<0&&db>0)||(da>0&&db<0)){const v=mix(a,b,da/(da-db));inside.push(v);outside.push(v);}}return [inside,outside];};
  const ix=source.index,n=ix?ix.count:p.count;
  for(let i=0;i<n;i+=3){let polys=[[vertex(ix?ix.getX(i):i),vertex(ix?ix.getX(i+1):i+1),vertex(ix?ix.getX(i+2):i+2)]];
   for(const ps of planes){const kept=[];for(const poly of polys){if(ps.some(pl=>poly.every(v=>dist(v,pl)>1e-7))){kept.push(poly);continue;}let pending=poly;for(const pl of ps){if(pending.length<3)break;const [inside,outside]=split(pending,pl);if(outside.length>=3)kept.push(outside);pending=inside;}if(pending.length>=3)changed=true;}polys=kept;}
   for(const poly of polys)for(let j=1;j<poly.length-1;j++){const tri=[poly[0],poly[j],poly[j+1]];const a=new THREE.Vector3(...tri[0].position),b=new THREE.Vector3(...tri[1].position),c=new THREE.Vector3(...tri[2].position);if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-16)continue;for(const v of tri)for(const key of names)output[key].push(...v[key]);}
  }
  if(!changed)continue;
  const geo=new THREE.BufferGeometry();for(const n of names){const a=source.attributes[n];geo.setAttribute(n,new THREE.Float32BufferAttribute(output[n],a.itemSize,a.normalized));}geo.normalizeNormals();geo.computeBoundingBox();geo.computeBoundingSphere();mesh.geometry=geo;mesh.userData.wheelWell=true;
 }
}
