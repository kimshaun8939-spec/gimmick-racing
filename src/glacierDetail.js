// Glacier-only render detail. Never registered as collision/ray geometry.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { photoMaterial, pbrReady, pbrStats, preloadPbr } from './gfxPbr.js';
import { seededRandom } from './moonTrack.js';
let hdrPromise;
function glacierHDR(){
  if(!hdrPromise)hdrPromise=new RGBELoader().loadAsync(new URL('./art/tex/snowy_field_512.hdr',import.meta.url).href).catch(error=>{pbrStats.errors.push('HDRI: '+error);return null;});
  return hdrPromise;
}
export async function prepareGlacierPhotos(){
  await Promise.all([preloadPbr(['asphalt_track','snow_02','cliff_side','aerial_rocks_02','gravel_floor_02','concrete_floor']),glacierHDR()]);
}

export function glacierPhotoDetail(group, scene, track) {
  const savedRandom=Math.random; Math.random=seededRandom(880314);
  try { return build(group,scene,track); } finally { Math.random=savedRandom; }
}
function build(group,scene,track) {
  const snow=photoMaterial('snow_02',{scale:2,color:'#ffffff'});
  const rock=photoMaterial('aerial_rocks_02',{scale:3,snow:true,color:'#b5c7db',vertexColors:true,side:THREE.DoubleSide});
  const cliff=photoMaterial('cliff_side',{scale:16,snow:true,color:'#9cb5d2',side:THREE.DoubleSide});
  const gravel=photoMaterial('gravel_floor_02',{scale:2,color:'#9ba8b8'});
  const concrete=photoMaterial('concrete_floor',{scale:3,color:'#acbdd0',vertexColors:true});
  const replaced=new Map();
  const sceneryNodes=new Set();group.traverse(o=>sceneryNodes.add(o));
  scene.traverse(o=>{
    if(!o.isMesh || !o.material || Array.isArray(o.material))return;
    const old=o.material;
    if(old.userData.photoSurface)return;
    const kind=old.userData.gfxSurface;
    let next;
    if(o.name.startsWith('gfx3AlpineRange'))next=cliff;
    else if(o.name==='gfx2RockHills')next=rock;
    else if(o.name==='gfx2Gravel')next=gravel;
    else if(kind==='snow')next=snow;
    else if(kind==='rock')next=rock;
    if(next){
      if(!replaced.has(old)){const m=next.clone();m.vertexColors=old.vertexColors;m.side=old.side;replaced.set(old,m);}
      o.material=replaced.get(old);
    }
    if(!next && sceneryNodes.has(o) && !o.isInstancedMesh && old.isMeshLambertMaterial && !old.map && !old.vertexColors && old.color){
      const hsl={};old.color.getHSL(hsl);
      if(hsl.s<.16 && hsl.l>.2){
        if(!replaced.has(old)){const m=concrete.clone();m.color.copy(old.color);m.vertexColors=false;replaced.set(old,m);}
        o.material=replaced.get(old);
      }
    }
    // Existing tiny scatter now follows the requested 60 m neighbourhood.
    if(['gfx2Gravel','gfx2DryGrass'].includes(o.name))o.visible=false;
    if(o.geometry?.type==='BoxGeometry' && !o.isInstancedMesh){
      const p=o.geometry.parameters;
      if(Math.max(p.width,p.height,p.depth)<.3)return;
      const radius=Math.min(.13,Math.min(p.width,p.height,p.depth)*.16);
      const geo=new THREE.BoxGeometry(p.width,p.height,p.depth,3,3,3),a=geo.attributes.position;
      const v=new THREE.Vector3(),core=new THREE.Vector3();
      for(let i=0;i<a.count;i++){
        v.fromBufferAttribute(a,i);core.set(THREE.MathUtils.clamp(v.x,-p.width/2+radius,p.width/2-radius),THREE.MathUtils.clamp(v.y,-p.height/2+radius,p.height/2-radius),THREE.MathUtils.clamp(v.z,-p.depth/2+radius,p.depth/2-radius));
        v.sub(core).normalize().multiplyScalar(radius).add(core);a.setXYZ(i,v.x,v.y,v.z);
      }
      geo.computeVertexNormals();o.geometry=geo;
      if(old.isMeshStandardMaterial&&!old.map&&old.metalness<.2){const m=concrete.clone();m.color.copy(old.color);m.vertexColors=false;o.material=m;}
    }
  });
  // Close roadside: rounded snow lip and compacted gravel ribbon, one call each.
  const S=track.samples,N=S.length-1;
  const snowP=[],snowI=[],gravelP=[],gravelI=[];
  for(const side of [-1,1])for(let i=0;i<N;i+=2){
    const s=S[i],next=S[(i+2)%N];
    if(s.gap || track.inTunnel?.(i/N) || track.onBridge?.[i])continue;
    const edge=s.hw+(track.kerbAt?.(i,side)??1.6);
    const en=next.hw+(track.kerbAt?.((i+2)%N,side)??1.6);
    const profile=[[.12,-.02],[.24,.12],[.48,.23],[.85,.18],[1.6,-.14]];
    const base=snowP.length/3;
    for(const [samp,ee]of [[s,edge],[next,en]])for(const [off,h]of profile){
      const lat=side*(ee+off);snowP.push(samp.pos.x+samp.right.x*lat,samp.pos.y+Math.tan(samp.bank||0)*lat+h,samp.pos.z+samp.right.z*lat);
    }
    for(let k=0;k<4;k++){const a=base+k,b=a+5;snowI.push(a,b,a+1,b,b+1,a+1);}
    const gb=gravelP.length/3;
    for(const [samp,ee]of [[s,edge],[next,en]])for(const off of [.02,2.15]){
      const lat=side*(ee+off),x=samp.pos.x+samp.right.x*lat,z=samp.pos.z+samp.right.z*lat;
      gravelP.push(x,Math.min(track.heightAt(x,z)+.025,samp.pos.y+Math.tan(samp.bank||0)*lat-.015),z);
    }
    gravelI.push(gb,gb+2,gb+1,gb+2,gb+3,gb+1);
  }
  function mesh(p,idx,mat,name){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.name=name;m.receiveShadow=true;m.userData.noBatch=true;group.add(m);return m;}
  snow.side=THREE.DoubleSide;gravel.side=THREE.DoubleSide;
  mesh(snowP,snowI,snow,'gfx8SnowEdge');mesh(gravelP,gravelI,gravel,'gfx8GravelShoulder');
  // Fixed world candidates, uploaded only when car moves > 8 m. Two instanced draws.
  const candidates=[],rand=seededRandom(888731),q=new THREE.Quaternion(),mat=new THREE.Matrix4(),v=new THREE.Vector3(),scale=new THREE.Vector3();
  for(let i=0;i<N;i+=3){const s=S[i];if(s.gap)continue;
    for(const side of [-1,1])for(let k=0;k<3;k++){
      const lat=side*(s.hw+(track.kerbAt?.(i,side)??1.6)+2+rand()*6),x=s.pos.x+s.right.x*lat,z=s.pos.z+s.right.z*lat;
      const y=track.heightAt(x,z);if(Math.abs(y-s.pos.y)>3)continue;
      candidates.push({x,y,z,angle:rand()*6.28,size:.06+rand()*.2,type:k===0?1:0});
    }
  }
  const stone=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),gravel,600);
  const blades=new THREE.BufferGeometry();blades.setAttribute('position',new THREE.Float32BufferAttribute([-.09,0,0,.09,0,0,.02,.65,.04,0,0,-.09,0,0,.09,-.04,.46,0],3));blades.computeVertexNormals();
  const grass=new THREE.InstancedMesh(blades,new THREE.MeshStandardMaterial({color:'#7b7766',roughness:1,side:THREE.DoubleSide}),260);
  for(const [m,name]of [[stone,'gfx8CloseStones'],[grass,'gfx8CloseGrass']]){m.name=name;m.count=0;m.frustumCulled=false;m.userData.noBatch=true;group.add(m);}
  const last=new THREE.Vector3(Infinity,Infinity,Infinity);
  const lightStrengths=new Map();
  let prepared=false,disposed=false,envTarget,sourceEnv,pmrem,oldEnv=scene.environment;
  const sun=scene.children.find(o=>o.isDirectionalLight&&o.castShadow);
  const shadowOld=sun?{left:sun.shadow.camera.left,right:sun.shadow.camera.right,top:sun.shadow.camera.top,bottom:sun.shadow.camera.bottom,far:sun.shadow.camera.far,radius:sun.shadow.radius}:null;
  // Existing 2048 map: 220 m span instead of 140 m, no extra shadow pass.
  if(sun){Object.assign(sun.shadow.camera,{left:-110,right:110,top:110,bottom:-110,far:380});sun.shadow.camera.updateProjectionMatrix();sun.shadow.radius=2.1;}
  const readyMesh=group.getObjectByName('gfx8SnowEdge');
  readyMesh.onBeforeRender=(renderer,sc,camera)=>{
    if(prepared)return;prepared=true;
    window.__gfx8={pbr:pbrStats,ready:false,environment:false};
    const start=performance.now();
    glacierHDR().then(async texture=>{
      if(!texture)return;
      if(disposed){texture.dispose();return;}
      sourceEnv=texture;sourceEnv.mapping=THREE.EquirectangularReflectionMapping;
      pmrem=new THREE.PMREMGenerator(renderer);envTarget=pmrem.fromEquirectangular(sourceEnv);
      scene.environment=envTarget.texture;pmrem.dispose();sourceEnv.dispose();
      // Explicit car envMaps from carLighting take precedence over scene.environment.
      scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m?.isMeshStandardMaterial&&!m.envMap){if(!lightStrengths.has(m))lightStrengths.set(m,m.envMapIntensity);m.envMapIntensity=Math.min(m.envMapIntensity,.16);}});
      await pbrReady();if(disposed)return;
      renderer.compile(scene,camera);window.__gfx8.ready=true;window.__gfx8.environment=true;window.__gfx8.loadMs=performance.now()-start;
    }).catch(error=>{pbrStats.errors.push('HDRI compile: '+error);});
  };
  group.addEventListener('removed',()=>{disposed=true;if(scene.environment===envTarget?.texture)scene.environment=oldEnv;envTarget?.dispose();for(const [m,strength] of lightStrengths)m.envMapIntensity=strength;if(sun&&shadowOld){const {radius,...bounds}=shadowOld;Object.assign(sun.shadow.camera,bounds);sun.shadow.radius=radius;sun.shadow.camera.updateProjectionMatrix();}});
  return (time,dt,car)=>{
    if(envTarget && scene.environment!==envTarget.texture)scene.environment=envTarget.texture;
    if(!car?.pos||last.distanceToSquared(car.pos)<64)return;last.copy(car.pos);
    let a=0,b=0;
    for(const c of candidates){if((c.x-car.pos.x)**2+(c.z-car.pos.z)**2>3600)continue;
      const m=c.type?grass:stone,idx=c.type?b++:a++;if(idx>=m.instanceMatrix.count)continue;
      q.setFromAxisAngle(new THREE.Vector3(0,1,0),c.angle);v.set(c.x,c.y,c.z);scale.set(c.size*1.4,c.size*.65,c.size);
      if(c.type)scale.setScalar(.45+c.size);mat.compose(v,q,scale);m.setMatrixAt(idx,mat);
    }
    stone.count=Math.min(a,600);grass.count=Math.min(b,260);stone.instanceMatrix.needsUpdate=true;grass.instanceMatrix.needsUpdate=true;
  };
}
