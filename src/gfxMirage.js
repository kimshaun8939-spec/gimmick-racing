// Mirage-only rendering. Never registered with groundMeshes, colliders or fastTrack.
import * as THREE from 'three';
import { gfxEnabled } from './gfxConfig.js';
import { gfxSurface } from './gfxTextures.js';
import { broadleafGeometry } from './gfxTrees.js';

export function sandstone(m){
 gfxSurface(m,'rock',{snow:false});m.flatShading=false;
 const old=m.onBeforeCompile,key=m.customProgramCacheKey;
 m.onBeforeCompile=function(s,r){old.call(this,s,r);s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float bed=vGfxWorld.y*.67+gfxNoise(vGfxWorld.xz*.035)*1.7;
 float band=sin(bed)+.32*sin(bed*3.7);
 float seam=1.-smoothstep(.025,.085,abs(sin(bed*.52)));
 diffuseColor.rgb*=mix(vec3(.89,.70,.54),vec3(1.06,.98,.85),smoothstep(-.8,.8,band));
 diffuseColor.rgb*=1.-seam*.08;
 `);};m.customProgramCacheKey=()=>key()+'|gfx9Sandstone';return m;
}
export function desertRock(k=0){
 const g=new THREE.SphereGeometry(1,12,7),p=g.attributes.position;
 for(let i=0;i<p.count;i++){let x=p.getX(i),y=p.getY(i),z=p.getZ(i);const a=Math.atan2(z,x),r=1+.09*Math.sin(a*5+k)+.045*Math.sin(y*14+a*3);const h=k===1?y:Math.tanh(y*2.8)*.58;p.setXYZ(i,x*r,h,z*r);}
 g.computeVertexNormals();return g;
}
export function mirageTerrain(track){
 if(!gfxEnabled())return;
 const meshes=[];track.group.traverse(o=>{if(o.isMesh && o.visible && o.material?.visible && o.material?.isMeshLambertMaterial && o.material.flatShading && o.geometry.attributes.color)meshes.push(o);});
 const sums=new Map(),key=(p,i)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(3)).join(',');
 for(const o of meshes){const {position:p,normal:n,color:c}=o.geometry.attributes;for(let i=0;i<p.count;i++){const k=key(p,i),a=sums.get(k)||[0,0,0,0,0,0,0];for(let j=0;j<3;j++){a[j]+=n.array[i*3+j];a[j+3]+=c.array[i*3+j];}a[6]++;sums.set(k,a);}}
 for(const o of meshes){const g=o.geometry.clone(),{position:p,normal:n,color:c}=g.attributes;for(let i=0;i<p.count;i++){const a=sums.get(key(p,i)),len=Math.hypot(...a.slice(0,3))||1;n.setXYZ(i,a[0]/len,a[1]/len,a[2]/len);c.setXYZ(i,a[3]/a[6],a[4]/a[6],a[5]/a[6]);}
 const m=o.material.clone();m.flatShading=false;gfxSurface(m,'sand',{snow:false});const old=m.onBeforeCompile,k=m.customProgramCacheKey;
 m.onBeforeCompile=function(s,r){old.call(this,s,r);s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float ripple=sin(vGfxWorld.x*3.1+vGfxWorld.z*.9+sin(vGfxWorld.z*.14)*2.);
 float fade=1.-smoothstep(25.,145.,length(cameraPosition-vGfxWorld));
 diffuseColor.rgb*=1.+ripple*.045*fade;
 `);};m.customProgramCacheKey=()=>k()+'|gfx9Dunes';
 // These are render-only batches. Original collision meshes remain in groundMeshes.
 o.geometry=g;o.material=m;o.name='gfx9MirageTerrain';
 }
}
export function mirageHorizon(track,group){
 const b=track.terrainBox,cx=(b.min.x+b.max.x)/2,cz=(b.min.y+b.max.y)/2,rx=(b.max.x-b.min.x)/2+110,rz=(b.max.y-b.min.y)/2+110;
 for(let layer=0;layer<3;layer++){const p=[],idx=[],n=144;for(let i=0;i<=n;i++){const a=i/n*Math.PI*2,h=45+24*Math.sin(a*7+layer)+14*Math.sin(a*19);for(let j=0;j<3;j++){const d=layer*140+j*140;p.push(cx+Math.cos(a)*(rx+d),j===1?h+layer*25:-20,cz+Math.sin(a)*(rz+d));}}for(let i=0;i<n;i++)for(let j=0;j<2;j++){const a=i*3+j;idx.push(a,a+3,a+1,a+1,a+3,a+4);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();const m=new THREE.MeshBasicMaterial({color:['#b68163','#c3997e','#cfad91'][layer],side:THREE.DoubleSide});const o=new THREE.Mesh(g,m);o.name='gfx9Mesa'+layer;o.userData.noBatch=true;group.add(o);}
 // Sparse branching desert scrub uses a single instanced draw, outside the shoulders.
 const geo=broadleafGeometry(1,true,{leaf:'#71835a',segments:4,rings:3}),m=new THREE.MeshLambertMaterial({vertexColors:true});
 const count=64,im=new THREE.InstancedMesh(geo,m,count),d=new THREE.Object3D();
 for(let i=0;i<count;i++){const s=track.sampleAt(i/count),p=track.surf(s,(i%2?1:-1)*(s.hw+35));d.position.copy(p);d.position.y=track.heightAt(p.x,p.z);d.scale.setScalar(.65+.25*Math.sin(i*7));d.rotation.y=i*2.4;d.updateMatrix();im.setMatrixAt(i,d.matrix);}im.computeBoundingSphere();im.name='gfx9DesertScrub';im.userData.noBatch=true;group.add(im);
}

export function desertArch(){
 const g=new THREE.TorusGeometry(27,4.6,8,48,Math.PI),p=g.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(y,x);p.setXYZ(i,x*(1+.015*Math.sin(a*11)),14+y,z*1.25+.3*Math.sin(a*9));}g.computeVertexNormals();return g;
}
