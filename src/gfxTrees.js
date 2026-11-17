import * as THREE from 'three';
export function spruceNeedles(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
 const ctx=canvas.getContext('2d');ctx.strokeStyle='#fff';ctx.lineWidth=2.4;
 // A dense branch fan with broken needle tips, reused by every near tree.
 for(let k=0;k<19;k++){
  const a=-1.18+k*.131,length=75+16*Math.sin(k*3.7),ex=64+Math.sin(a)*length,ey=120-Math.cos(a)*length;
  ctx.beginPath();ctx.moveTo(64,126);ctx.lineTo(ex,ey);ctx.stroke();
  for(let j=3;j<13;j++){
   const t=j/14,x=64+(ex-64)*t,y=126+(ey-126)*t;
   for(const side of [-1,1]){const n=a+side*.8,ln=8+7*(1-t);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.sin(n)*ln,y-Math.cos(n)*ln);ctx.stroke();}
  }
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
// Branch whorls: individual drooping lobes, exposed trunk, snow on upward fans.
export function spruceGeometry(variant=0,far=false,options={}){
 const p=[],c=[];const green=new THREE.Color(['#24463d','#29483d','#203f39','#345047'][variant]),snow=new THREE.Color(options.snow === false ? (options.leaf || '#42744b') : '#dce8ef'),wood=new THREE.Color('#624d3c');
 const tri=(a,b,d,col)=>{p.push(...a,...b,...d);for(let i=0;i<3;i++)c.push(col.r,col.g,col.b);};
 if(far){
  // Crossed stepped silhouettes, 16 triangles; no thousands of branch fans at distance.
  for(let plane=0;plane<2;plane++)for(let l=0;l<3;l++){
   const a=plane*Math.PI/2+variant*.19,y=.17+l*.235,r=.39*(1-l*.25);
   const v=(x,h)=>[Math.cos(a)*x,h,Math.sin(a)*x];
   tri(v(-r,y),v(r,y),v(.018,y+.36),green);
   tri(v(-r*.83,y+.055),v(r*.83,y+.055),v(.018,y+.36),snow);
  }
  for(let plane=0;plane<2;plane++){
   const a=plane*Math.PI/2,v=(x,h)=>[Math.cos(a)*x,h,Math.sin(a)*x];
   tri(v(-.022,0),v(.022,0),v(.022,.75),wood);tri(v(-.022,0),v(.022,.75),v(-.022,.75),wood);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.computeVertexNormals();return g;
 }
 const tiers=far?5:7,arms=far?5:6;
 for(let l=0;l<tiers;l++){
  const y=.16+l*(.78/tiers),r=.41*(1-l/tiers)*(.92+.08*Math.sin(l*2.3+variant));
  for(let a=0;a<arms;a++){
   const ang=a*Math.PI*2/arms+l*2.399+variant,spread=far?.85:.83;
   const len=r*(.8+.2*Math.sin(a*4.1+l+variant));
   const point=(theta,rad,h)=>[Math.cos(theta)*rad+variant*.005*y,h,Math.sin(theta)*rad];
   const root=point(ang,.018,y+.065),left=point(ang-spread,len*.86,y+.015),tip=point(ang,len,y-.03),right=point(ang+spread,len*.86,y+.015);
   tri(root,tip,left,snow);tri(root,right,tip,snow);
   const under=point(ang,.02,y-.095);tri(under,left,tip,green);tri(under,tip,right,green);
  }
 }
 for(let i=0;i<5;i++){const a=i*6.283/5,b=(i+1)*6.283/5;const v=(t,y)=>[Math.cos(t)*.022,y,Math.sin(t)*.022];tri(v(a,0),v(b,0),v(a,.79),wood);tri(v(b,0),v(b,.79),v(a,.79),wood);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
 const uv=[];for(let i=0;i<p.length/9;i++)uv.push(...(i<p.length/9-10?[.5,0,.05,.92,.95,.92]:[.5,.02,.5,.02,.5,.02]));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
export function broadleafGeometry(variant=0,far=false,options={}) {
 const parts=[],colors=[],wood=new THREE.Color('#66513a'),leaf=new THREE.Color(options.leaf||['#4e813e','#648e48','#3e7344','#79934a'][variant%4]);
 const add=(g,col)=>{g=g.index?g.toNonIndexed():g;parts.push(g);for(let i=0;i<g.attributes.position.count;i++)colors.push(col.r,col.g,col.b);};
 const branch=(a,b,r)=>{const d=new THREE.Vector3().subVectors(b,a),g=new THREE.CylinderGeometry(r*.48,r,d.length(),far?4:5,1);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());add(g,wood);};
 branch(new THREE.Vector3(0,0,0),new THREE.Vector3(.025,.74,0),.032);
 const n=far?4:7;for(let k=0;k<n;k++){const a=k*2.399+variant*.7,y=.55+(k%3)*.11,r=.18+(k%2)*.035,tip=new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r);if(!far)branch(new THREE.Vector3(0,.34,0),tip,.014);const g=new THREE.SphereGeometry(1,far?5:7,far?3:5);g.scale(.22+(k%2)*.025,.19,.21);g.translate(tip.x,tip.y,tip.z);add(g,leaf.clone().multiplyScalar(.88+(k%3)*.075));}
 const p=[],norm=[];for(const g of parts){p.push(...g.attributes.position.array);norm.push(...g.attributes.normal.array);g.dispose();}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return g;
}
export function buildVisualForest(group,items,{near=110,far=650,snow=false,shadows=false}={}){
 const mat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,emissive:0x152410}),chunks=new Map();
 for(const it of items){const key=[Math.floor(it.x/360),Math.floor(it.z/360),it.type==='pine'?'pine':'leaf'].join(':');if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(it);}
 const geoCache=new Map();
 const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),sc=new THREE.Vector3();
 for(const list of chunks.values()){const tree=new THREE.LOD();tree.name='gfx5Forest';tree.userData.noBatch=true;const cx=list.reduce((a,b)=>a+b.x,0)/list.length,cz=list.reduce((a,b)=>a+b.z,0)/list.length;tree.position.set(cx,0,cz);
 for(const distant of [false,true]){const pine=list[0].type==='pine',v=list[0].variant||0;const key=pine+':'+v+':'+distant;let geo=geoCache.get(key);if(!geo){geo=pine?spruceGeometry(v,distant,{snow}):broadleafGeometry(v,distant);geoCache.set(key,geo);}const im=new THREE.InstancedMesh(geo,mat,list.length);list.forEach((it,i)=>{q.setFromAxisAngle(new THREE.Vector3(0,1,0),it.yaw);matrix.compose(p.set(it.x-cx,it.y,it.z-cz),q,sc.set(it.s*(it.width??10),it.s*(it.height??12),it.s*(it.width??10)));im.setMatrixAt(i,matrix);});im.castShadow=shadows;im.receiveShadow=shadows;im.computeBoundingSphere();tree.addLevel(im,distant?near:0);}tree.addLevel(new THREE.Group(),far);group.add(tree);}
}

// Curved coastal fronds with tapered leaflets; one instanced draw, no simulation.
export function coastalPalmGeometry(){
 const parts=[],colors=[];
 const add=(g,color)=>{g=g.index?g.toNonIndexed():g;parts.push(g);const c=new THREE.Color(color);for(let i=0;i<g.attributes.position.count;i++)colors.push(c.r,c.g,c.b);};
 for(let i=0;i<9;i++){const y=i*.95,x=.015*y*y;const g=new THREE.CylinderGeometry(.23-i*.014,.25-i*.014,.99,8);g.rotateZ(-.03*y);g.translate(x,y+.48,0);add(g,i%2?'#876044':'#765339');}
 const top=new THREE.Vector3(.015*8.55*8.55,8.55,0);
 for(let a=0;a<11;a++){const theta=a*2.399,dir=new THREE.Vector3(Math.cos(theta),0,Math.sin(theta)),side=new THREE.Vector3(-dir.z,0,dir.x);const p=[];
 for(let j=0;j<11;j++){const u=j/11,v=(j+1)/11;const point=t=>top.clone().addScaledVector(dir,t*4.8).add(new THREE.Vector3(0,Math.sin(t*Math.PI)*1.1-t*t*1.6,0));const q=point(u),r=point(v),w=Math.sin((u+.06)*Math.PI)*.62;const l=q.clone().addScaledVector(side,w).addScaledVector(dir,-.3),h=q.clone().addScaledVector(side,-w).addScaledVector(dir,-.3);p.push(...q.toArray(),...l.toArray(),...r.toArray(),...q.toArray(),...r.toArray(),...h.toArray());}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();add(g,a%2?'#408637':'#5b9d42');}
 const pos=[],norm=[];for(const g of parts){pos.push(...g.attributes.position.array);norm.push(...g.attributes.normal.array);g.dispose();}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return g;
}
