// City-only shader details: keep original reflection maps, signs and glitch surfaces.
import * as THREE from 'three';
import { gfxEnabled } from './gfxConfig.js';
import { gfxSurface } from './gfxTextures.js';
function preserveClone(m){const clone=m.clone;m.clone=function(){const c=clone.call(this);c.onBeforeCompile=this.onBeforeCompile;c.customProgramCacheKey=this.customProgramCacheKey;c.clone=this.clone;return c;};}
export function neonVisualSurfaces(track,facades,city){
 if(!gfxEnabled())return;
 // Three depth layers, one instanced call each; no extra light or reflection pass.
 const center=track.groundCenter,box=track.bbox,radius=Math.hypot(box.max.x-box.min.x,box.max.y-box.min.y)*.65+500;
 const matrix=new THREE.Matrix4();
 for(let layer=0;layer<3;layer++){
  const im=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:['#17152c','#24203b','#302443'][layer],fog:false}),72);
  im.name='gfx7CityHorizon'+layer;im.userData.noBatch=true;
  for(let i=0;i<72;i++){const a=i/72*Math.PI*2+layer*.039,r=radius+layer*230,h=45+95*(.5+.5*Math.sin(i*17.7+layer*3.1));matrix.makeScale(24+(i%4)*9,h,30);matrix.setPosition(center.x+Math.cos(a)*r,h/2-15,center.y+Math.sin(a)*r);im.setMatrixAt(i,matrix);}im.computeBoundingSphere();city.add(im);
 }

 facades.forEach((m,k)=>{
  // Windows are procedural: release the unused repeating facade textures.
  m.map?.dispose();m.emissiveMap?.dispose();m.map=null;m.emissiveMap=null;
  m.onBeforeCompile=s=>{
   s.vertexShader='varying vec3 cityP;varying vec3 cityN;\n'+s.vertexShader;
   s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ncityP=(modelMatrix*vec4(position,1.)).xyz;cityN=normalize(mat3(modelMatrix)*normal);');
   s.fragmentShader=`varying vec3 cityP;varying vec3 cityN;
 float cityHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 `+s.fragmentShader;
   s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
 vec2 facade=vec2(dot(cityP.xz,vec2(-cityN.z,cityN.x)),cityP.y);
 vec2 grid=facade/vec2(2.25,3.6);vec2 cell=floor(grid);vec2 q=fract(grid);
 float room=cityHash(cell+${(k*19.37).toFixed(2)});
 float aa=min(.12,max(fwidth(grid.x),fwidth(grid.y)));
 float windowMask=smoothstep(.16-aa,.16+aa,q.x)*(1.-smoothstep(.8-aa,.8+aa,q.x))*smoothstep(.22-aa,.22+aa,q.y)*(1.-smoothstep(.78-aa,.78+aa,q.y));
 float blind=mix(1.,.58,step(.83,cityHash(cell+41.)))*mix(.75,1.,step(.5,q.y));
 float lit=step(.58,room)*windowMask*blind;
 vec3 roomColor=mix(vec3(.19,.56,.72),vec3(.78,.53,.29),step(.74,room));
 diffuseColor.rgb=mix(vec3(.024,.028,.051),vec3(.055,.068,.09),cityHash(floor(facade/24.)));
 diffuseColor.rgb*=.88+.12*smoothstep(.03,.09,fract(cityP.y/3.6));`);
   s.fragmentShader=s.fragmentShader.replace('#include <emissivemap_fragment>',`totalEmissiveRadiance=roomColor*lit*(.3+room*.5);`);
  };
  m.customProgramCacheKey=()=> 'gfx7CityFacade'+k;preserveClone(m);
 });
 const seen=new Set();track.group.traverse(o=>{const m=o.material;if(!m?.isMeshStandardMaterial||!m.roughnessMap||m.envMapIntensity!==1.1||seen.has(m))return;seen.add(m);
 gfxSurface(m,'dirt',{snow:false});const old=m.onBeforeCompile;
 m.onBeforeCompile=function(s,r){old.call(this,s,r);s.fragmentShader=s.fragmentShader.replace('*0.007','*0.0015');s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
 float puddle=smoothstep(.52,.72,gfxNoise(vGfxWorld.xz*.075));
 roughnessFactor=mix(roughnessFactor,max(.055,roughnessFactor*.75),puddle);
 `);};const key=m.customProgramCacheKey;m.customProgramCacheKey=()=>key()+'|cityPuddles';
 });
}

