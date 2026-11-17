// GP owns all changes here. No collision registration, global random or post-FX mutation.
import * as THREE from 'three';
import { gfxEnabled } from './gfxConfig.js';
import { gfxSurface } from './gfxTextures.js';
import { smoothVisualGeometry } from './gfxTerrain.js';
import { broadleafGeometry, spruceGeometry } from './gfxTrees.js';
const plants=new Map();
export function gpPlantGeometry(type){
 if(!gpOn()||!['pine','round','blossom'].includes(type))return null;
 if(!plants.has(type)){
  const g=type==='pine'?spruceGeometry(1,false,{snow:false,leaf:'#4c9b4e'}):broadleafGeometry(type==='blossom'?2:1,false,{leaf:type==='blossom'?'#ffb4d1':'#68bc46',segments:6,rings:4});
  g.scale(type==='pine'?8:8.8,type==='pine'?9.8:9,type==='pine'?8:8.8);plants.set(type,g);
 }
 return plants.get(type);
}
function layered(mat){
 gfxSurface(mat,'rock',{snow:false});const before=mat.onBeforeCompile;
 mat.onBeforeCompile=function(s,r){before.call(this,s,r);s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 float gpStrata=sin(vGfxWorld.y*1.7+gfxNoise(vGfxWorld.xz*.065)*4.);
 float seams=smoothstep(.87,.99,gpStrata)*.075;
 diffuseColor.rgb*=1.-seams;
 `);};const key=mat.customProgramCacheKey;mat.customProgramCacheKey=()=>key()+'|gpStrata1';
}
function smoothCopy(o,kind){
 const geo=smoothVisualGeometry(o.geometry),material=o.material.clone();
 if(o.geometry.attributes.color)geo.setAttribute('color',averageColors(o.geometry));
 material.flatShading=false;material.onBeforeCompile=o.material.onBeforeCompile;material.customProgramCacheKey=o.material.customProgramCacheKey;
 if(kind==='rock')layered(material);else gfxSurface(material,kind,{snow:false});
 const visual=new THREE.Mesh(geo,material);visual.name='gfx11:'+kind;visual.castShadow=o.castShadow;visual.receiveShadow=o.receiveShadow;visual.userData.noBatch=true;
 o.material=o.material.clone();o.material.visible=false;o.castShadow=false;o.add(visual);
}
export function gpVisualTrack(track){
 if(!gpOn())return;
 const list=[];track.group.traverse(o=>{if(o.isMesh&&o.material?.isMeshLambertMaterial&&o.material.vertexColors&&o.material.flatShading&&o.geometry.attributes.color)list.push(o);});
 for(const o of list)smoothCopy(o,'grass');
}
export function gpVisualScenery(group){
 if(!gpOn())return;
 const rocks=[];group.traverse(o=>{if(o.isMesh&&['islandUnderside','floatingRock','distantIslands'].includes(o.name))rocks.push(o);});
 for(const o of rocks)smoothCopy(o,'rock');
 const rounded=new Map();group.traverse(o=>{if(!o.isMesh||o.geometry.type!=='BoxGeometry'||Array.isArray(o.material)||o.material.map||o.material.transparent)return;const {width:w,height:h,depth:d}=o.geometry.parameters;if(Math.min(w,h,d)<.3)return;o.geometry.computeBoundingBox();const box=o.geometry.boundingBox,sz=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());if(Math.abs(sz.x-w)+Math.abs(sz.y-h)+Math.abs(sz.z-d)>.001)return;const key=[w,h,d,...center.toArray()].join(':');if(!rounded.has(key)){const g=roundedBox(w,h,d);g.translate(center.x,center.y,center.z);rounded.set(key,g);}o.geometry=rounded.get(key);});
}
export function gpSpaceRock(geo){
 if(!gpOn())return geo;
 // Shallow crater bowls on the small rocky planet; deterministic local visual vertices.
 if(geo.parameters?.detail>=4){const p=geo.attributes.position,v=new THREE.Vector3(),axis=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);const radius=v.length(),unit=v.clone().normalize();let dent=0;for(let k=0;k<14;k++){axis.set(Math.sin(k*7.13+1),Math.cos(k*3.77+2),Math.sin(k*5.19+4)).normalize();const d=1-unit.dot(axis),r=.007+(k%4)*.003;dent+=-.018*Math.exp(-d/r)+.008*Math.exp(-Math.pow((d-r*2.4)/r,2.));}v.copy(unit).multiplyScalar(radius*(1+dent));p.setXYZ(i,v.x,v.y,v.z);}geo.computeVertexNormals();}
 const out=smoothVisualGeometry(geo);if(geo.attributes.color)out.setAttribute('color',averageColors(geo));geo.dispose();return out;
}
export function gpPlanetMaterial(mat){
 if(!gpOn()||!mat?.isMeshStandardMaterial||mat.userData.gpSurface)return;
 mat.userData.gpSurface=true;mat.flatShading=false;layered(mat);
}

function averageColors(geo){
 const p=geo.attributes.position,c=geo.attributes.color,out=c.clone(),sums=new Map();
 const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(x=>x.toFixed(3)).join(',');
 for(let i=0;i<p.count;i++){const k=key(i),a=sums.get(k)||[0,0,0,0];a[0]+=c.getX(i);a[1]+=c.getY(i);a[2]+=c.getZ(i);a[3]++;sums.set(k,a);}
 for(let i=0;i<p.count;i++){const a=sums.get(key(i));out.setXYZ(i,a[0]/a[3],a[1]/a[3],a[2]/a[3]);}return out;
}


export function gpRockDetail(detail){return gpOn()&&detail===1?2:detail;}

function roundedBox(w,h,d){
 const g=new THREE.BoxGeometry(w,h,d,2,2,2),p=g.attributes.position,r=Math.min(w,h,d)*.07,v=new THREE.Vector3(),c=new THREE.Vector3();
 for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);c.set(THREE.MathUtils.clamp(v.x,-w/2+r,w/2-r),THREE.MathUtils.clamp(v.y,-h/2+r,h/2-r),THREE.MathUtils.clamp(v.z,-d/2+r,d/2-r));v.sub(c).normalize().multiplyScalar(r).add(c);p.setXYZ(i,v.x,v.y,v.z);}
 g.computeVertexNormals();return g;
}


function gpOn(){return new URLSearchParams(location.search).get('map')==='gp'&&gfxEnabled('gp');}
