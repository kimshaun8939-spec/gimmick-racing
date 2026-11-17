import * as THREE from 'three';
import { gfxEnabled } from './gfxConfig.js';
import { gfxSurface } from './gfxTextures.js';
import { smoothVisualGeometry } from './gfxTerrain.js';

function smoothColors(g){
 const p=g.attributes.position,c=g.attributes.color;if(!c)return;const sums=new Map();
 for(let i=0;i<p.count;i++){const k=p.getX(i).toFixed(3)+','+p.getY(i).toFixed(3)+','+p.getZ(i).toFixed(3);let v=sums.get(k);if(!v){v=[0,0,0,0];sums.set(k,v);}v[0]+=c.getX(i);v[1]+=c.getY(i);v[2]+=c.getZ(i);v[3]++;}
 for(let i=0;i<p.count;i++){const v=sums.get(p.getX(i).toFixed(3)+','+p.getY(i).toFixed(3)+','+p.getZ(i).toFixed(3));c.setXYZ(i,v[0]/v[3],v[1]/v[3],v[2]/v[3]);}
}
// Copies are draw-only children: original ray meshes and their geometry stay intact.
export function visualGround(track, volcanic=false) {
 const meshes=[];track.group.traverse(o=>{if(o.isMesh&&o.material?.isMeshLambertMaterial&&o.material.flatShading&&o.material.vertexColors&&o.geometry.attributes.color)meshes.push(o);});
 const materials=new Map();
 for(const o of meshes){
  const geo=smoothVisualGeometry(o.geometry,track.heightAt);geo.setAttribute('color',o.geometry.attributes.color.clone());smoothColors(geo);
  let mat=materials.get(o.material);if(!mat){mat=o.material.clone();mat.flatShading=false;mineralSurface(mat,volcanic?'basalt':'regolith');materials.set(o.material,mat);}
  const visual=new THREE.Mesh(geo,mat);visual.name=volcanic?'':'gfx10Terrain';visual.receiveShadow=o.receiveShadow;visual.userData.noBatch=!volcanic;
  o.material=o.material.clone();o.material.visible=false;o.castShadow=false;o.add(visual);
 }
}
export function mineralSurface(mat,kind){
 if(kind==='regolith')mat.fog=false;
 gfxSurface(mat,kind==='metal'?'dirt':'sand',{snow:false});const old=mat.onBeforeCompile;
 mat.onBeforeCompile=function(s,r){old.call(this,s,r);s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 vec2 mineralP=vGfxWorld.xz+vGfxWorld.y*.31;
 float mineralFade=1.-smoothstep(25.,170.,length(cameraPosition-vGfxWorld));
 ${kind==='regolith'?`vec2 cell=floor(mineralP*.6);vec2 uv=fract(mineralP*.6)-.5;
 vec2 offset=vec2(gfxHash(cell),gfxHash(cell+17.))*.48-.24;
 float radius=.08+gfxHash(cell+42.)*.13;
 float crater=length(uv-offset)/radius;
 float rim=exp(-pow((crater-1.)*5.,2.))*.09;
 float bowl=(1.-smoothstep(.3,.95,crater))*.14;
 diffuseColor.rgb*=1.+(rim-bowl)*mineralFade;
 diffuseColor.rgb*=.96+(gfxNoise(mineralP*.035)-.5)*.13+(gfxNoise(mineralP*38.)-.5)*.07*mineralFade;`:
 kind==='basalt'?`float flow=gfxNoise(mineralP*.25+gfxNoise(mineralP*.06)*3.);
 float seam=1.-smoothstep(.012,.045,abs(flow-.48));
 float hot=(1.-smoothstep(-24.,-5.,vGfxWorld.y));
 diffuseColor.rgb*=.92+flow*.14-seam*.16;
 diffuseColor.rgb+=vec3(.035,.002,.0001)*seam*hot;`:
 `vec2 panel=fract(vec2(vGfxWorld.x+vGfxWorld.z,vGfxWorld.y)/vec2(2.4,1.2));
 float edge=min(min(panel.x,1.-panel.x),min(panel.y,1.-panel.y));
 diffuseColor.rgb*=mix(.77,1.,smoothstep(.008,.024,edge));
 diffuseColor.rgb*=1.+sin((vGfxWorld.y+vGfxWorld.x)*190.)*.018*mineralFade;`}
 `);};
 const key=mat.customProgramCacheKey;mat.customProgramCacheKey=()=>key()+'|gfx10'+kind;
}
export function mineralScenery(root,volcanic=false){
 const seen=new Set(),geos=new Map();root.traverse(o=>{
  if(!o.isMesh||!o.material||Array.isArray(o.material))return;const m=o.material;
  if(m.isMeshLambertMaterial&&m.flatShading){
   let g=geos.get(o.geometry);if(!g){let source=o.geometry;
    if(volcanic&&o.isInstancedMesh&&m.color?.getHexString()==='2a1e18'){
     source=source.clone();const p=source.attributes.position;
     for(let i=0;i<p.count;i++){const y=Math.max(0,p.getY(i));p.setXYZ(i,p.getX(i)+Math.sin(y*.8)*.15+y*y*.012,p.getY(i),p.getZ(i)+Math.sin(y*1.15)*.12);}
     source.computeVertexNormals();source.computeBoundingSphere();
    }
    g=smoothVisualGeometry(source);if(o.geometry.attributes.color)g.setAttribute('color',o.geometry.attributes.color.clone());smoothColors(g);geos.set(o.geometry,g);}o.geometry=g;
   if(!seen.has(m)){seen.add(m);m.flatShading=false;if(!o.geometry.attributes.glow)mineralSurface(m,volcanic?'basalt':'regolith');}
  }else if(m.isMeshStandardMaterial&&!m.map&&!m.transparent&&m.metalness>=.2&&!seen.has(m)){
   seen.add(m);mineralSurface(m,'metal');
  }
 });
}
export function distantRanges(track,root,volcanic=false){
 const b=track.terrainBox,cx=(b.min.x+b.max.x)/2,cz=(b.min.y+b.max.y)/2;
 const radius=Math.max(b.max.x-b.min.x,b.max.y-b.min.y)*.54+200;
 for(let layer=0;layer<2;layer++){
  const p=[],idx=[],n=200,rows=9;
  for(let i=0;i<=n;i++){const a=i/n*Math.PI*2,r=radius+layer*230,h=90+layer*35+28*Math.sin(a*7+layer)+16*Math.sin(a*13+.8);
   for(let j=0;j<rows;j++){const u=j/(rows-1),rr=r+(u-.5)*620;const profile=Math.pow(Math.sin(u*Math.PI),1.8);p.push(cx+Math.cos(a)*rr,-12+h*profile,cz+Math.sin(a)*rr);}
  }
  for(let i=0;i<n;i++)for(let j=0;j<rows-1;j++){const a=i*rows+j;idx.push(a,a+rows,a+1,a+1,a+rows,a+rows+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();
  const mat=new THREE.MeshLambertMaterial({color:volcanic?['#542d28','#6b3930'][layer]:['#97948f','#77787c'][layer],side:THREE.DoubleSide});
  mineralSurface(mat,volcanic?'basalt':'regolith');const mesh=new THREE.Mesh(g,mat);mesh.name='gfx10Ranges'+layer;mesh.userData.noBatch=true;root.add(mesh);
 }
}
export function moonVisuals(track,scenery,scene){
 if(!gfxEnabled('moon'))return;
 const sky=scene.getObjectByName('moonSky');
 const backdrop=new THREE.Mesh(new THREE.SphereGeometry(2800,16,8),new THREE.MeshBasicMaterial({color:'#010207',side:THREE.BackSide,toneMapped:false,fog:false,depthWrite:false}));
 backdrop.name='gfx10MoonBackground';backdrop.renderOrder=-100;backdrop.userData.noBatch=true;sky.add(backdrop);
 visualGround(track);const root=scene.getObjectByName('moonScenery');mineralScenery(root);distantRanges(track,root);
 // Fog is disabled only on regolith. Original sky, Earth and signs keep their color path.
}
