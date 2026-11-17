// Jungle-only visual copies. Source ray meshes and seeded placement are untouched.
import * as THREE from 'three';
import { gfxEnabled } from './gfxConfig.js';
import { gfxSurface } from './gfxTextures.js';
import { broadleafGeometry } from './gfxTrees.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothVisualGeometry } from './gfxTerrain.js';
export function junglePlants(p) {
 for (const [key,far] of [['kapok',false],['kapokLo',true]]) {
  p[key]=broadleafGeometry(2,far,{leaf:'#528d3d',segments:5,rings:far?3:4});p[key].scale(19,25,19);
  if (!far) {
   const crown=p[key].attributes.position;
   for(let i=0;i<crown.count;i++){const x=crown.getX(i),y=crown.getY(i),z=crown.getZ(i);if(y>12){const ripple=.18*Math.sin(x*1.9+y*.8)*Math.cos(z*1.7-y);crown.setXYZ(i,x+ripple,y+ripple*.6,z-ripple*.8);}}
   const parts=[p[key]];
   for(let j=0;j<5;j++){const g=new THREE.CylinderGeometry(.055,.07,6+j*.6,3).toNonIndexed();g.translate(Math.sin(j*2.4)*3.6,11.5,Math.cos(j*2.4)*3.6);const c=[];for(let i=0;i<g.attributes.position.count;i++)c.push(.055,.16,.035);g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.deleteAttribute('uv');parts.push(g);}
   p[key]=mergeGeometries(parts);for(const g of parts)g.dispose();
  }
 }
 p.palm=junglePalm();p.palm.scale(1.05,1.6,1.05);
 // Existing far palm, bamboo, fern and flower LOD distances remain unchanged.
 const rockColor=p.rock.attributes.color; p.rock=smoothVisualGeometry(p.rock);p.rock.setAttribute('color',rockColor.clone());
}
export function jungleRanges(){
 const g=new THREE.SphereGeometry(1,12,5,0,Math.PI*2,0,Math.PI/2);
 const p=g.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),y=p.getY(i);p.setXYZ(i,x*(1+.12*Math.sin(z*5)),y*.82-.5,z*(1+.1*Math.sin(x*7)));}
 g.computeVertexNormals();return g;
}
export function mossStone(mat){
 gfxSurface(mat,'rock',{snow:false});
 const old=mat.onBeforeCompile;
 mat.onBeforeCompile=function(s,r){old.call(this,s,r);s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float moss=gfxNoise(vGfxWorld.xz*.19+vGfxWorld.y*.09);
 float topMoss=smoothstep(.15,.85,vGfxNormal.y);
 diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.49,.79,.34),smoothstep(.40,.73,moss)*(.24+topMoss*.5));`);};
 const key=mat.customProgramCacheKey;mat.customProgramCacheKey=()=>key()+'|jungleMoss';
}
export function jungleVisualTrack(track){
 if(!gfxEnabled())return;
 const candidates=[];
 track.group.traverse(o=>{if(o.isMesh&&o.material?.isMeshLambertMaterial&&o.material.vertexColors&&o.material.flatShading&&o.geometry.attributes.color)candidates.push(o);});
 // Smooth vertex color and normal seams across all visible plateau chunks.
 const averages=new Map();
 for(const o of candidates){const g=o.geometry,p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color;for(let i=0;i<p.count;i++){const k=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>x.toFixed(3)).join(',');let a=averages.get(k);if(!a){a=[0,0,0,0,0,0,0];averages.set(k,a);}a[0]+=n.getX(i);a[1]+=n.getY(i);a[2]+=n.getZ(i);a[3]+=c.getX(i);a[4]+=c.getY(i);a[5]+=c.getZ(i);a[6]++;}}
 for(const o of candidates){const geo=o.geometry.clone(),p=geo.attributes.position,n=geo.attributes.normal,c=geo.attributes.color;for(let i=0;i<p.count;i++){const a=averages.get([p.getX(i),p.getY(i),p.getZ(i)].map(x=>x.toFixed(3)).join(',')),len=Math.hypot(a[0],a[1],a[2])||1;n.setXYZ(i,a[0]/len,a[1]/len,a[2]/len);c.setXYZ(i,a[3]/a[6],a[4]/a[6],a[5]/a[6]);}
 const material=o.material.clone();material.flatShading=false;gfxSurface(material,'grass',{snow:false});
 const visual=new THREE.Mesh(geo,material);visual.name='gfx7JungleTerrain';visual.castShadow=o.castShadow;visual.receiveShadow=o.receiveShadow;visual.userData.noBatch=true;
 // Child follows the track's existing jungle/underworld visibility transition.
 o.material=o.material.clone();o.material.visible=false;o.castShadow=false;o.add(visual);
 }
 const seen=new Set();track.group.traverse(o=>{const m=o.material;if(m?.isMeshStandardMaterial&&m.map&&m.roughness===.88&&!seen.has(m)){seen.add(m);gfxSurface(m,'dirt',{snow:false});}});
}

function junglePalm(){
 const parts=[];
 const add=(g,color)=>{g=g.index?g.toNonIndexed():g;g.deleteAttribute('uv');const c=new THREE.Color(color),a=[];for(let i=0;i<g.attributes.position.count;i++)a.push(c.r,c.g,c.b);g.setAttribute('color',new THREE.Float32BufferAttribute(a,3));parts.push(g);};
 for(let i=0;i<6;i++){const y=i*1.4,g=new THREE.CylinderGeometry(.24-i*.025,.27-i*.025,1.45,5,1,true);g.rotateZ(-.03*y);g.translate(.015*y*y,y+.7,0);add(g,i%2?'#876044':'#765339');}
 for(let a=0;a<8;a++){const angle=a*2.399,p=[];const point=(u,w)=>{const r=u*4.8;return [1.05+Math.cos(angle)*r-Math.sin(angle)*w,8.4+Math.sin(u*Math.PI)*1.1-u*u*1.6,Math.sin(angle)*r+Math.cos(angle)*w];};for(let j=0;j<4;j++){const u=j/4,v=(j+1)/4,w=Math.sin((u+.06)*Math.PI)*.6;p.push(...point(u,0),...point(u,-w),...point(v,0),...point(u,0),...point(v,0),...point(u,w));}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();add(g,a%2?'#408637':'#5b9d42');}
 const g=mergeGeometries(parts);for(const p of parts)p.dispose();return g;
}
