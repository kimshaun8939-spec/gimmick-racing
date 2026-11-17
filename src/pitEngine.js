import * as T from 'three';
// Workshop-only surgery: keep the original buffers/batches untouched while driving.
// Clip every vertex attribute together, including baked paint/PBR and cockpit layers.
export function createEngineHood(root,style='f1'){
 const [cx,cy,cz,k]=enginePosition(style),exposed=['buggy','kart','rocket'].includes(style);
 const front=cz>0,half=.72*k,depth=style==='van'?.72:1.06*k,floor=Math.max(.18,cy-.26);
 // The concealed hinge sits below the skin. At 85 degrees the entire lid,
 // including its lower lip, projects outside the block's vertical envelope.
 const hinge=new T.Vector3(cx,style==='van'?1.57:floor,cz+(front?-depth:depth)),angle=85*Math.PI/180;
 const group=new T.Group();group.name='workshop-engine-cover';root.add(group);group.position.copy(hinge);
 const saved=[],resources=[],coverMaterials=new Map(),bay=new T.Group();bay.name='engine-bay';root.add(bay);bay.visible=false;
 const dark=new T.MeshStandardMaterial({color:'#141b22',roughness:.88,metalness:.25,side:T.DoubleSide});
 function plate(w,h,d,x,y,z){const geo=new T.BoxGeometry(w,h,d),m=new T.Mesh(geo,dark);m.position.set(x,y,z);bay.add(m);resources.push(geo);}
 const handle=new T.Vector3(cx,style==='van'?1.58:cy+.12,cz+(front?depth:-depth)*.8);
 let built=false,disposed=false;
 function reset(){for(const [m,g]of saved)m.geometry=g;saved.length=0;group.clear();bay.clear();resources.splice(0).forEach(g=>g.dispose());for(const m of coverMaterials.values())m.dispose();coverMaterials.clear();built=false;}
 function build(){
  built=true;if(exposed)return;
  root.updateMatrixWorld(true);const rootInv=root.matrixWorld.clone().invert();
  const planes=[[0,1,cx-half],[0,-1,-cx-half],[2,1,cz-depth],[2,-1,-cz-depth],[1,1,floor]];
  const meshes=[];root.traverseVisible(o=>{if(!o.isMesh||o.isInstancedMesh||o.isSkinnedMesh||!o.geometry?.attributes.normal||Array.isArray(o.material))return;
   for(let a=o;a&&a!==root;a=a.parent)if(a===group||a===bay||a.name.startsWith('part-')||a.userData.partVisual||a.userData.fpInterior)return;
   if(o.geometry.drawRange.count===0||!o.material.visible||o.material.isShaderMaterial||o.material.opacity===0||o.material.blending===T.AdditiveBlending)return;meshes.push(o);
  });
  for(const mesh of meshes){
   const source=mesh.geometry,local=new T.Matrix4().multiplyMatrices(rootInv,mesh.matrixWorld),inv=local.clone().invert();
   const box=new T.Box3().setFromBufferAttribute(source.attributes.position).applyMatrix4(local);
   if(box.max.x<cx-half||box.min.x>cx+half||box.max.z<cz-depth||box.min.z>cz+depth||box.max.y<floor)continue;
   const names=Object.keys(source.attributes),sizes=names.map(n=>source.attributes[n].itemSize),offsets=[];let stride=0;
   sizes.forEach(s=>{offsets.push(stride);stride+=s;});const pi=names.indexOf('position'),po=offsets[pi];
   const outside=[],inside=[],idx=source.index,count=idx?idx.count:source.attributes.position.count;
   const vertex=i=>{const v=[];for(const n of names){const a=source.attributes[n];for(let j=0;j<a.itemSize;j++)v.push(a.array[i*a.itemSize+j]);}const p=new T.Vector3(v[po],v[po+1],v[po+2]).applyMatrix4(local);v[po]=p.x;v[po+1]=p.y;v[po+2]=p.z;return v;};
   const emit=(poly,dst)=>{for(let i=1;i+1<poly.length;i++)dst.push(poly[0],poly[i],poly[i+1]);};
   for(let i=0;i<count;i+=3){let poly=[0,1,2].map(j=>vertex(idx?idx.getX(i+j):i+j));
    for(const [axis,sign,bound]of planes){if(!poly.length)break;const yes=[],no=[];
     for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],da=a[po+axis]*sign-bound,db=b[po+axis]*sign-bound;
      (da>=0?yes:no).push(a);if((da>=0)!==(db>=0)){const t=da/(da-db),v=a.map((n,q)=>n+(b[q]-n)*t);yes.push(v);no.push(v);}}
     emit(no,outside);poly=yes;
    }emit(poly,inside);
   }
   if(!inside.length)continue;
   function geometry(rows){const g=new T.BufferGeometry();for(let n=0;n<names.length;n++){const a=source.attributes[names[n]],data=new a.array.constructor(rows.length*sizes[n]);for(let i=0;i<rows.length;i++)for(let j=0;j<sizes[n];j++)data[i*sizes[n]+j]=rows[i][offsets[n]+j];g.setAttribute(names[n],new T.BufferAttribute(data,sizes[n],a.normalized));}
    const p=g.attributes.position;for(let i=0;i<p.count;i++){const v=new T.Vector3(p.getX(i),p.getY(i),p.getZ(i)).applyMatrix4(inv);p.setXYZ(i,v.x,v.y,v.z);}resources.push(g);return g;}
   // Thin loft panels had no underside; retain their paint and baked shader on both sides.
   if(!coverMaterials.has(mesh.material)){const m=mesh.material.clone();m.onBeforeCompile=mesh.material.onBeforeCompile;m.customProgramCacheKey=mesh.material.customProgramCacheKey;m.side=T.DoubleSide;coverMaterials.set(mesh.material,m);}
   const cover=new T.Mesh(geometry(inside),coverMaterials.get(mesh.material));cover.layers.mask=mesh.layers.mask;cover.castShadow=mesh.castShadow;cover.receiveShadow=mesh.receiveShadow;
   group.add(cover);cover.applyMatrix4(new T.Matrix4().makeTranslation(-hinge.x,-hinge.y,-hinge.z).multiply(local));
   saved.push([mesh,source]);mesh.geometry=geometry(outside);
  }
  // A closed-bottom well: no sky/floor visible through the service opening.
  const bayZ=style==='van'?-1.63:cz,bayDepth=style==='van'?.36:depth;
  plate(half*2,.045,bayDepth*2,cx,floor-.025,bayZ);
  for(const s of [-1,1]){plate(.035,.32,bayDepth*2,cx+s*half,floor+.14,bayZ);plate(half*2,.32,.035,cx,floor+.14,bayZ+s*bayDepth);}
  for(const s of [-1,1])plate(.055,.06,bayDepth*1.8,cx+s*half*.72,floor+.05,bayZ);
 }
 return {exposed,hinge,handle,opening:{half,depth,floor,center:[cx,cy,cz]},
  set(p){if(disposed)return;p=T.MathUtils.clamp(p,0,1);if(p===0){if(built)reset();bay.visible=false;group.rotation.x=0;group.position.copy(hinge);return;}if(!built)build();bay.visible=!exposed;group.position.copy(hinge);group.rotation.x=style==='van'?0:(front?-1:1)*p*angle;if(style==='van')group.position.add(new T.Vector3(Math.max(0,p-.5)*2.6,Math.min(1,p*2)*1.5,0));root.updateMatrixWorld(true);},
  grip(p){if(style==='van')return handle.clone().add(new T.Vector3(Math.max(0,p-.5)*2.6,Math.min(1,p*2)*1.5,0));return handle.clone().sub(hinge).applyAxisAngle(new T.Vector3(1,0,0),(front?-1:1)*p*angle).add(hinge);},
  dispose(){if(disposed)return;disposed=true;reset();group.removeFromParent();bay.removeFromParent();dark.dispose();}
 };
}
// One engine assembly, also used by stock workshop props. No stock game geometry is added.
export function enginePosition(style){
 const p={f1:[0,.70,-1.12,.72],proto:[0,.64,-1.55,.85],hyper:[0,.68,-1.55,.8],rocket:[0,.85,-1.15,.67],buggy:[0,.78,-1.63,.8],kart:[.22,.37,-.60,.38],gt:[0,.67,1.55,.7],rally:[0,.70,1.57,.65],muscle:[0,.66,1.95,.65],hatch:[0,.65,1.3,.6],roadster:[0,.63,1.35,.64],truck:[0,.82,1.5,.7],van:[0,.55,-2.05,.65],ev:[0,.65,-1.6,.75],wedge:[0,.62,-1.5,.75]};return p[style]||p.f1;
}
export function createPitEngine(n=0){
 const g=new T.Group(),steel=new T.MeshStandardMaterial({color:'#9caab8',metalness:.8,roughness:.29}),dark=new T.MeshStandardMaterial({color:'#20272e',metalness:.45,roughness:.5}),cover=new T.MeshStandardMaterial({color:n===1?'#9b333d':n===2?'#426c97':n===3?'#a87839':'#647078',metalness:.65,roughness:.3}),rubber=new T.MeshStandardMaterial({color:'#111419',roughness:.9});
 const add=(geo,m,x=0,y=0,z=0)=>{const o=new T.Mesh(geo,m);o.position.set(x,y,z);o.userData.photoGeometry=true;g.add(o);return o;};
 const box=(w,h,d,m,x,y,z)=>add(new T.BoxGeometry(w,h,d),m,x,y,z);
 const pipe=(a,b,r,m=steel)=>{const v=new T.Vector3(...a),w=new T.Vector3(...b),d=w.clone().sub(v);const o=add(new T.CylinderGeometry(r,r,d.length(),4),m,...v.add(w).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return o;};
 box(n===2?.76:.59,.32,.82,dark,0,.12,0);box(.43,.12,.72,steel,0,-.10,0);
 for(const s of [-1,1]){
  const head=box(n===2?.30:.24,.20,.84,cover,s*.25,.33,0);head.rotation.z=-s*.32;
  for(let i=0;i<4;i++){const z=-.3+i*.2;box(.27,.018,.025,steel,s*.26,.44,z);
   const path=new T.CatmullRomCurve3([new T.Vector3(s*.32,.24,z),new T.Vector3(s*.48,.05,z-.04),new T.Vector3(s*.40,-.02,-.48)]);
   add(new T.TubeGeometry(path,2,n===2?.045:.035,4,false),steel);
   if(n===1||n===0){const x=s*(n===1?.15:.13),h=n===1?.22:.10;add(new T.CylinderGeometry(.054,.031,h,8,1,true),steel,x,.45+h/2,z);add(new T.CircleGeometry(.043,8).rotateX(-Math.PI/2),dark,x,.45+h-.012,z);}
  }
 }
 // Front belt drive, flywheel and two pulleys.
 for(const [x,y,r]of [[0,.12,.14],[.21,.36,.08],[-.21,.36,.08]])add(new T.CylinderGeometry(r,r,.05,10).rotateX(Math.PI/2),steel,x,y,.47);
 for(const s of [-1,1])pipe([0,.0,.505],[s*.24,.39,.505],.022,rubber);
 if(n===2){box(.65,.16,.46,steel,0,.55,0);for(let i=0;i<3;i++)add(new T.CylinderGeometry(.085,.085,.18,8).rotateX(Math.PI/2),dark,(i-1)*.18,.56,.31);}
 if(n===3){
  for(const s of [-1,1]){add(new T.TorusGeometry(.145,.065,4,10),steel,s*.49,.31,-.13);add(new T.CylinderGeometry(.095,.095,.10,8).rotateX(Math.PI/2),dark,s*.49,.31,-.08);pipe([s*.49,.31,.04],[s*.39,.49,.39],.065);pipe([s*.39,.49,.39],[s*.28,.15,.59],.065);}
  box(.69,.24,.12,steel,0,.15,.61);for(let i=0;i<7;i++)box(.61,.012,.018,dark,0,.06+i*.03,.678);
 }
 for(const s of [-1,1]){pipe([s*.4,-.02,-.48],[s*.25,.0,-.66],.055);add(new T.CylinderGeometry(.07,.06,.14,8,1,true).rotateX(Math.PI/2),steel,s*.25,0,-.70);}
 g.userData.dispose=()=>{g.traverse(o=>{if(o.isMesh)o.geometry.dispose();});for(const m of [steel,dark,cover,rubber])m.dispose();};return g;
}
