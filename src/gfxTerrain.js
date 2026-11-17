// Visual-only mountains: no ray, collision, occupancy or global random calls.
import * as THREE from 'three';
let alpineTexture;
function rockTexture(){
 if(alpineTexture)return alpineTexture;
 const size=128,data=new Uint8Array(size*size*4);
 const hash=(x,y)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;};
 const value=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y);let u=x-ix,v=y-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);const h=(a,b)=>hash((a%8+8)%8,(b%8+8)%8);return (h(ix,iy)*(1-u)+h(ix+1,iy)*u)*(1-v)+(h(ix,iy+1)*(1-u)+h(ix+1,iy+1)*u)*v;};
 for(let z=0;z<size;z++)for(let x=0;x<size;x++){const i=(z*size+x)*4,v=Math.round(value(x/16,z/16)*255);data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}
 alpineTexture=new THREE.DataTexture(data,size,size);alpineTexture.wrapS=alpineTexture.wrapT=THREE.RepeatWrapping;
 alpineTexture.magFilter=THREE.LinearFilter;alpineTexture.minFilter=THREE.LinearMipmapLinearFilter;alpineTexture.generateMipmaps=true;alpineTexture.needsUpdate=true;
 return alpineTexture;
}
export function alpineMaterial(layer=0) {
 const m=new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide});
 m.onBeforeCompile=s=>{
  s.uniforms.alpineLayer={value:layer};
  s.uniforms.alpineRock={value:rockTexture()};
  s.vertexShader='varying vec3 alpineP; varying vec3 alpineN;\n'+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nalpineP=position; alpineN=normal;');
  s.fragmentShader=`varying vec3 alpineP; varying vec3 alpineN; uniform float alpineLayer; uniform sampler2D alpineRock;
  `+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   vec3 p=alpineP; float slope=abs(normalize(alpineN).y);
   float dist=length(cameraPosition-p);
   float detail=(1.-smoothstep(180.,700.,dist))*(1.-smoothstep(.35,1.3,length(fwidth(p.xz))*.045));
   float broad=texture2D(alpineRock,p.xz*.0005+vec2(p.y*.0002,0.)).r;
   float grain=(texture2D(alpineRock,p.xz*.003+vec2(0.,p.y*.001)).r-.5)*detail;
   float snow=smoothstep(alpineLayer<0.? .59:.79,alpineLayer<0.? .91:.97,slope+(broad-.5)*.16+grain*.035);
   vec3 rock=mix(vec3(.065,.105,.16),vec3(.20,.27,.35),broad);
   rock*=1.+grain*.16;
   vec3 snowColor=mix(vec3(.48,.60,.73),vec3(.77,.84,.91),broad);
   vec3 c=mix(rock,snowColor,snow);
   float glacier=(1.-smoothstep(.46,.72,slope))*smoothstep(25.,90.,p.y)*(1.-smoothstep(160.,290.,p.y));
   glacier*=smoothstep(.63,.85,broad);
   c=mix(c,vec3(.22,.45,.60),glacier*.35);
   diffuseColor.rgb=c;
  `);
  s.fragmentShader=s.fragmentShader.replace('#include <fog_fragment>',`#include <fog_fragment>
   float valley=(1.-smoothstep(18.,110.,alpineP.y))*smoothstep(650.,1900.,vFogDepth)*.065;
   gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.43,.56,.7),valley);
  `);
 };
 m.customProgramCacheKey=()=> 'gfx4AlpineShared';
 const clone=m.clone;
 m.clone=function(){const out=clone.call(this);out.onBeforeCompile=this.onBeforeCompile;out.customProgramCacheKey=this.customProgramCacheKey;out.clone=this.clone;return out;};
 return m;
}
const gradientCaches=new WeakMap();
export function smoothVisualGeometry(source,heightAt){
 if(heightAt){
  // Reuse grid gradients across render chunks, and copy only the two attributes we draw.
  // Positions, heights and the exact central-difference normal remain identical.
  let cache=gradientCaches.get(heightAt);if(!cache){cache=new Map();gradientCaches.set(heightAt,cache);}
  const g=new THREE.BufferGeometry(),p=source.attributes.position.clone(),n=new THREE.BufferAttribute(new Float32Array(p.count*3),3);
  g.setAttribute('position',p);g.setAttribute('normal',n);if(source.index)g.setIndex(source.index.clone());
  for(let i=0;i<p.count;i++){
   const x=p.getX(i),z=p.getZ(i);let row=cache.get(x);if(!row){row=new Map();cache.set(x,row);}
   let v=row.get(z);if(!v){v=new THREE.Vector3(heightAt(x-8,z)-heightAt(x+8,z),16,heightAt(x,z-8)-heightAt(x,z+8)).normalize();row.set(z,v);}
   n.setXYZ(i,v.x,v.y,v.z);
  }
  return g;
 }

 const g=source.clone(),p=g.attributes.position,n=g.attributes.normal,byPosition=new Map();
 // Average only render normals. Original triangles/face normals stay on the collision mesh.
 for(let i=0;i<p.count;i++){
  const key=p.getX(i).toFixed(3)+','+p.getY(i).toFixed(3)+','+p.getZ(i).toFixed(3);
  let a=byPosition.get(key);if(!a){a={v:new THREE.Vector3(),ids:[]};byPosition.set(key,a);}
  a.v.x+=n.getX(i);a.v.y+=n.getY(i);a.v.z+=n.getZ(i);a.ids.push(i);
 }
 for(const a of byPosition.values()){
  a.v.normalize();for(const i of a.ids)n.setXYZ(i,a.v.x,a.v.y,a.v.z);
 }
 g.deleteAttribute('color');return g;
}
export function buildAlpineRanges(group,M,noise){
 // Radial bands about 16 / 34 / 76 m; shared vertices give smooth shading.
 for(let layer=0;layer<3;layer++){
  const n=[400,240,160][layer],jMax=[26,16,10][layer];
  const d0=[-40,380,920][layer],span=[420,540,760][layer];
  const pos=new Float32Array((n+1)*(jMax+1)*3),idx=new Uint32Array(n*jMax*6);let pi=0,ii=0;
  for(let k=0;k<=n;k++){
   const u=k/n,f=u*M.N,i=Math.min(M.N-1,Math.floor(f)),t=f-i;
   const a=M.dirs[i],b=M.dirs[i+1],mix=(x,y)=>x+(y-x)*t;
   const bx=mix(a.bx,b.bx),bz=mix(a.bz,b.bz),nx=mix(a.nx,b.nx),nz=mix(a.nz,b.nz),base=mix(M.baseOf[i],M.baseOf[i+1]);
   const s=u*M.per;
   // Broad shared ridges: sample once per column, avoid absolute-noise needle cusps.
   const ridge1=.5+.5*noise(s/660,11.3,2),ridge2=.5+.5*noise(s/950,27.9,2);
   for(let j=0;j<=jMax;j++){
    const d=d0+span*j/jMax,x=bx+nx*d,z=bz+nz*d;

    let h=base+28*THREE.MathUtils.smoothstep(d,-40,150)
      +Math.exp(-(((d-450)/290)**2))*(155+240*ridge1)
      +Math.exp(-(((d-1160)/440)**2))*(260+350*ridge2);
    const amp=THREE.MathUtils.smoothstep(d,0,180);
    const ridge=1-Math.abs(noise(x/125,z/125,2));
    const ravine=1-Math.abs(noise(s/130+d/310,d/460,2));
    h+=amp*((ridge-.65)*18+(ravine-.65)*46);
    pos[pi++]=x;pos[pi++]=h;pos[pi++]=z;
   }
  }
  for(let k=0;k<n;k++)for(let j=0;j<jMax;j++){const a=k*(jMax+1)+j,b=a+jMax+1;idx[ii++]=a;idx[ii++]=b;idx[ii++]=b+1;idx[ii++]=a;idx[ii++]=b+1;idx[ii++]=a+1;}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(new THREE.BufferAttribute(idx,1));g.computeVertexNormals();
  const mesh=new THREE.Mesh(g,alpineMaterial(layer));mesh.name='gfx3AlpineRange'+layer;mesh.userData.noBatch=true;group.add(mesh);
 }
}
