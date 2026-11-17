// Sea-only photo grain: preserve the sunset palette and every collision mesh.
import * as THREE from 'three';
import {gfxEnabled} from './gfxConfig.js';
const enabled=gfxEnabled('sea')&&new URLSearchParams(location.search).get('seapbr')==='1'; // 사진 질감은 효과가 작아 기본 끔(2026-11-17), &seapbr=1로만
const assets=['asphalt_track','concrete_floor','coast_sand_01','aerial_rocks_02','cliff_side','sparse_grass','gravel_floor_02'];
const tex=new Map();let hdr;
// Offline PMREM of the supplied sunset HDRI, RGBA16F, no runtime convolution.
async function loadSunsetEnvironment(){
 const response=await fetch(new URL('./art/tex/belfast_sunset_pmrem.bin.gz',import.meta.url));
 if(!response.ok)throw new Error('Sunset environment '+response.status);
 const bytes=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 hdr=new THREE.DataTexture(new Uint16Array(bytes),384,512,THREE.RGBAFormat,THREE.HalfFloatType);
 hdr.mapping=THREE.CubeUVReflectionMapping;hdr.minFilter=hdr.magFilter=THREE.LinearFilter;
 hdr.colorSpace=THREE.LinearSRGBColorSpace;hdr.generateMipmaps=false;hdr.needsUpdate=true;
}
export const seaPhotoStats={errors:[],ready:false};
export async function prepareSeaPhotos(){
 if(!enabled)return;
 const loader=new THREE.TextureLoader();
 await Promise.all(assets.flatMap(a=>['diff','nor_gl','arm'].map(async k=>{try{const t=await loader.loadAsync(new URL(`./art/tex/${a}/${k}.webp`,import.meta.url).href);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=k==='diff'?THREE.SRGBColorSpace:THREE.NoColorSpace;t.anisotropy=8;tex.set(a+'/'+k,t);}catch(e){seaPhotoStats.errors.push(String(e));}})).concat([loadSunsetEnvironment().catch(e=>seaPhotoStats.errors.push(String(e)))]));
 seaPhotoStats.ready=true;
}
// Keep existing painted UV maps (kerbs, windows and pavement joints).
export function seaPhoto(old,asset,scale=3,strength=.35,terrain=false){
 if(!enabled)return old;
 const m=new THREE.MeshStandardMaterial({color:old.color,vertexColors:old.vertexColors,map:old.map,side:old.side,transparent:old.transparent,opacity:old.opacity,roughness:.9,metalness:0,envMapIntensity:.08});
 m.userData.seaPhoto=asset;
 m.onBeforeCompile=s=>{
  for(const [n,k] of [['spMap','diff'],['spArm','arm'],['spNormal','nor_gl']])s.uniforms[n]={value:tex.get(asset+'/'+k)};
  if(terrain)for(const [n,key]of [['spGrassArm','sparse_grass/arm'],['spRockArm','cliff_side/arm'],['spGrassNormal','sparse_grass/nor_gl'],['spRockNormal','cliff_side/nor_gl']])s.uniforms[n]={value:tex.get(key)};
  s.uniforms.spSand={value:tex.get('coast_sand_01/diff')};s.uniforms.spGrass={value:tex.get('sparse_grass/diff')};s.uniforms.spRock={value:tex.get('cliff_side/diff')};
  s.vertexShader='varying vec3 spWorld; varying vec3 spN;\n'+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <project_vertex>',`vec4 sp=vec4(transformed,1.);vec3 sn=objectNormal;\n#ifdef USE_INSTANCING\nsp=instanceMatrix*sp;sn=mat3(instanceMatrix)*sn;\n#endif\nspWorld=(modelMatrix*sp).xyz;spN=normalize(mat3(modelMatrix)*sn);\n#include <project_vertex>`);
  s.fragmentShader='varying vec3 spWorld;varying vec3 spN;uniform sampler2D spMap,spArm,spNormal,spSand,spGrass,spRock,spGrassArm,spRockArm,spGrassNormal,spRockNormal;\n'+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec3 an=abs(spN);vec2 su=(an.y>.55?spWorld.xz:(an.x>an.z?spWorld.zy:spWorld.xy))/${scale.toFixed(3)};
   float grain=dot(texture2D(spMap,su).rgb,vec3(.333));
   ${terrain?`float grassy=smoothstep(.04,.18,vColor.g-vColor.r);float rocky=1.-smoothstep(.5,.8,abs(spN.y));grain=mix(dot(texture2D(spSand,su).rgb,vec3(.333))/.1704,dot(texture2D(spGrass,su).rgb,vec3(.333))/.0464,grassy);grain=mix(grain,dot(texture2D(spRock,su).rgb,vec3(.333))/.1127,rocky);`:`grain/= ${asset==='asphalt_track'?'.0144':asset==='concrete_floor'?'.253':asset==='aerial_rocks_02'?'.116':'.32'};`}
   float detail=mix(1.,clamp(grain,.5,1.65),${strength.toFixed(3)}*(1.-smoothstep(70.,260.,length(cameraPosition-spWorld))));
   ${asset==='asphalt_track'?"detail=mix(detail,1.,smoothstep(.1,.3,max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b)))*.85);":''}
   diffuseColor.rgb*=detail;
   ${terrain?'float wet=(1.-smoothstep(.15,1.5,spWorld.y))*smoothstep(-.3,.1,spWorld.y);diffuseColor.rgb*=1.-wet*.18;':''}
  `);
  s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`float roughnessFactor=clamp(texture2D(spArm,su).g*.9,.58,.98);${terrain?'roughnessFactor=mix(roughnessFactor,texture2D(spGrassArm,su).g,grassy);roughnessFactor=mix(roughnessFactor,texture2D(spRockArm,su).g,rocky);roughnessFactor=mix(roughnessFactor,.32,wet);':''}`);
  s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition);vec2 st0=dFdx(su),st1=dFdy(su);vec3 tt=q0*st1.y-q1*st0.y,bb=-q0*st1.x+q1*st0.x;float inv=inversesqrt(max(max(dot(tt,tt),dot(bb,bb)),1e-12));vec3 nm=texture2D(spNormal,su).xyz*2.-1.;${terrain?'nm=mix(nm,texture2D(spGrassNormal,su).xyz*2.-1.,grassy);nm=mix(nm,texture2D(spRockNormal,su).xyz*2.-1.,rocky);':''}nm.xy*=.16*(1.-smoothstep(25.,100.,length(cameraPosition-spWorld)));normal=normalize(tt*inv*nm.x+bb*inv*nm.y+normal*nm.z);`);
 };
 m.customProgramCacheKey=()=>`seaPhoto1:${asset}:${scale}:${strength}:${terrain}`;
 const clone=m.clone;m.clone=function(){const c=clone.call(this);c.onBeforeCompile=this.onBeforeCompile;c.customProgramCacheKey=this.customProgramCacheKey;c.clone=this.clone;return c;};return m;
}
export function seaPhotoScenery(group,scene){
 if(!enabled)return;
 const cache=new Map();group.traverse(o=>{if(!o.isMesh||Array.isArray(o.material))return;const old=o.material;let a,scale=3,k=.25;
 if(o.name==='rocks'||old.userData.gfxSurface==='rock'){a='aerial_rocks_02';scale=5;k=.45;}
 else if(['houses','roofs','flatRoofs','domes','bridgePiers'].includes(o.name)){a='concrete_floor';scale=1.5;k=.28;}
 if(a){if(!cache.has(old))cache.set(old,seaPhoto(old,a,scale,k));o.material=cache.get(old);}
 });
 // Background remains the original procedural sunset sky.
 if(hdr)scene.environment=hdr;
 scene.traverse(o=>{if(o.isMesh&&(o.name.startsWith('seaWave')||o.material?.emissiveIntensity>0)&&o.material)o.material.envMapIntensity=.015;});
 window.__seapbr={ready:true,stats:seaPhotoStats};
 scene.traverse(o=>{if(o.isDirectionalLight&&o.shadow){const c=o.shadow.camera;c.left=c.bottom=-105;c.right=c.top=105;c.updateProjectionMatrix();}});
}
