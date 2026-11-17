import * as T from 'three';
import {createPitEngine,enginePosition} from './pitEngine.js';
import {createPitRobot} from './pitRobot.js';

import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {batchLocal} from './staticBatch.js';
// 사진 전용 참조. 게임의 메시·재질·그림 호출은 바꾸지 않는다.
const photoKits=new WeakMap();
export function isolatedPart(model,slot,look){
 const kit=photoKits.get(model.fp.body),out=new T.Group();if(!kit)return out;
 if(slot==='water'){
  model.root.updateMatrixWorld(true);const inv=kit.hull.matrixWorld.clone().invert(),sources=[];
  if(look){const o=model.root.getObjectByName('part-water');if(o)sources.push(o);}
  if(look?.hull!=='jet')sources.push(...kit.motors.map(m=>m.g),...kit.waterJets);
  for(const source of sources){const c=source.clone(true),drop=[];c.traverse(o=>{if(o!==c&&!o.visible)drop.push(o);});drop.forEach(o=>o.removeFromParent());c.position.set(0,0,0);c.quaternion.identity();c.scale.set(1,1,1);c.visible=true;const copy=new T.Group();copy.add(c);copy.applyMatrix4(new T.Matrix4().multiplyMatrices(inv,source.matrixWorld));out.add(copy);}return out;
 }
 if(slot==='engine'){
  const e=createPitEngine(look?(look.no||({v10:1,v8:2,turbo:3}[look.garage])||1):0);
  const lv=look?kit.engineHint?.lv||1:1;
  if(lv>1){const mats=new Set();e.traverse(o=>{if(o.material)mats.add(o.material);});styleLevel(e,lv);for(const m of mats)m.dispose();}
  out.add(e);return out;
 }
 const source=slot==='tire'?kit.wheels[0].spin:look?model.root.getObjectByName('part-'+(slot==='aero'&&look.kind==='splitter'?'splitter':slot)):slot==='engine'?kit.stock.engine:slot==='aero'?kit.spoiler:slot==='water'?kit.hull:null;
 if(source){const c=(source.userData.partSource||source).clone(true),hidden=[];
  c.traverse(o=>{if(o!==c&&(!o.visible||Math.max(o.scale.x,o.scale.y,o.scale.z)<.01))hidden.push(o);});hidden.forEach(o=>o.removeFromParent());
  c.position.set(0,0,0);c.quaternion.identity();c.scale.set(1,1,1);c.visible=true;out.add(c);
 }return out;
}
// 차고 전용 복사본. 원본의 위치와 자원은 유지하며, 장면이 끝나면 반드시 dispose.
// partfit: 배기·날개는 순정 부분 자체가 교체된다. 복사본 범위도 실제 교체 범위와 같다.
// 엔진/기어가 함께 그려져도 칸별 원본 복사본과 표시 마스크를 따로 유지한다.
export function swapPart(root,slot,look,other){
 let body,kit;root.traverse(o=>{if(photoKits.has(o)){body=o;kit=photoKits.get(o);}});
 const group=new T.Group(),hidden=[];
 const empty={group,none:true,hide(){},restore(){},dispose(){group.removeFromParent();}};
 if(!kit)return empty;
 // 차고가 아직 펼치지 않은 임시 모델을 주어도 배 부품 복사본은 펼친 크기로 만든다.
 const poseSaved=[];
 if(slot==='water'&&kit.hull.scale.y<kit.hullY*.98){
  for(const o of [kit.hull,...kit.motors.map(m=>m.g)])poseSaved.push([o,o.position.clone(),o.quaternion.clone(),o.scale.clone(),o.visible]);
  kit.hull.position.set(0,0,kit.hullScale[3]||0);kit.hull.scale.set(...kit.hullScale.slice(0,3));kit.hull.visible=true;
  for(const m of kit.motors){m.g.visible=look?.hull!=='jet';m.g.scale.setScalar(1);m.g.rotation.x=.08;}
 }
 const restorePose=()=>{for(const [o,p,q,s,v]of poseSaved){o.position.copy(p);o.quaternion.copy(q);o.scale.copy(s);o.visible=v;}};
 root.updateMatrixWorld(true);
 const sources=[];
 if(slot==='tire'){const w=kit.wheels.find(w=>w.side>0)?.spin;if(w)sources.push(w);}
 else if(!look&&slot==='engine'){kit.hideEngine(false);sources.push(kit.stock.engine);}
 else if(!look&&slot==='aero'){sources.push(other?.kind==='splitter'?kit.fWing:kit.spoiler);}
 else if(look){const o=root.getObjectByName('part-'+(slot==='aero'&&look.kind==='splitter'?'splitter':slot));if(o)sources.push(o);}
 if(slot==='aero'&&look&&other&&((look.kind==='splitter')!==(other.kind==='splitter'))){sources.push(look.kind==='splitter'?kit.spoiler:kit.fWing);}
 let motors=false;if(slot==='water'&&look?.hull!=='jet'){for(const m of kit.motors||[])if(m.g.visible){sources.push(m.g);motors=true;}sources.push(...kit.waterJets);}
 if(!sources.length){restorePose();return empty;}
 const inv=root.matrixWorld.clone().invert();
 for(const source of sources){
  const c=(source.userData.partSource||source).clone(true),drop=[];
  c.traverse(o=>{if(o!==c&&(!o.visible||Math.max(o.scale.x,o.scale.y,o.scale.z)<.01))drop.push(o);});drop.forEach(o=>o.removeFromParent());
  c.position.set(0,0,0);c.quaternion.identity();c.scale.set(1,1,1);c.visible=true;
  const copy=new T.Group();copy.add(c);copy.applyMatrix4(new T.Matrix4().multiplyMatrices(inv,source===kit.stock.engine?kit.body.matrixWorld:source.matrixWorld));group.add(copy);hidden.push([source,source.visible]);
 }
 const temporary=[];
 if(!look&&slot==='engine'){const e=createPitEngine(0),[x,y,z,k]=enginePosition(kit.style);e.position.set(x,y,z);e.scale.setScalar(k);group.add(e);e.traverse(o=>{if(o.isMesh)temporary.push([o.geometry,o.material]);});}
 restorePose();
 group.traverse(o=>{if(o.isMesh){o.geometry=o.geometry.clone();o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();o.castShadow=false;}});
 for(const [geo,mat]of temporary){geo.dispose();mat.dispose();}
 return {group,none:false,motors,hide(){if(!look&&slot==='engine')kit.hideEngine(true);else for(const [o]of hidden){if(o.userData.partMask)o.userData.partMask.value=0;else o.visible=false;}},restore(){if(!look&&slot==='engine')kit.hideEngine(false);else for(const [o,v]of hidden){if(o.userData.partMask)o.userData.partMask.value=1;else o.visible=v;}},dispose(){group.removeFromParent();group.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}};
}
// 교체 장면을 시작해도 되는지: 물 모듈은 배 변신(선체·선외기)이 다 끝난 뒤에 실제 모양을 복사해야 같은 범위·크기.
export function partPoseReady(root,slot){
 if(slot!=='water')return true;let kit;root?.traverse(o=>{if(photoKits.has(o))kit=photoKits.get(o);});if(!kit)return true;
 return kit.hull.visible&&kit.hull.scale.y>=kit.hullY*.98&&kit.motors.every(m=>m.g.scale.x>=.98);
}
// 차 지역 좌표: +x 오른쪽, +y 위, +z 앞. 조립 화면과 부품 사진 공용.
export const PART_VIEW=Object.freeze({
 engine:{pos:[2.8,1.3,-5.2],look:[0,.4,-1.8],fov:32},
 gearbox:{pos:[1.8,.65,-4.8],look:[0,.22,-1.8],fov:28},
 tire:{pos:[4,.85,1.4],look:[1,.4,1.4],fov:30},
 aero:{pos:[2.8,3,-5.2],look:[0,1.1,-1.9],fov:34},
 water:{pos:[5,1.5,-2.4],look:[0,.1,0],fov:42},
});
// ───────── 부품 강화 단계 모양 (upgradeD1, 2026-11-15, 설계 .debug/design/upgrade-design.md 5.1·5.2) ─────────
//   Lv2 하늘색 쌍줄무늬 → Lv3 + 민트 빛 테두리 → Lv4 카본 무늬 + 보라 빛 → Lv5 금 크롬 + 시선 따라 도는 무지개 빛 + 2초 숨 쉬는 빛 + 금빛 불티.
//   새 삼각형 없음: 단계가 있는 부품 칸은 그 칸 메시 전부가 공용 재질 하나(levelMaterial)를 씀 → 칸 그룹이 예전처럼 한 묶음 = 그림 호출 그대로.
//   색·거칠기·금속·빛·역할(본체/빛/어두운 것)·단계는 꼭짓점 속성(lvCol·lvRM·lvEm)에 적고 무늬는 셰이더가 부품 좌표로 그림 (텍스처 없음).
//   Lv5만 차 한 대에 불티 Points 1개(+1 그림 호출). 시간 값은 공용 uniform(불티가 그려질 때 갱신) — 재질 값은 안 바뀌므로 묶음이 안 풀림.
//   재질은 페이지에 하나(모든 차·차고·사진 공용, userData.live·lvShared = 버리지 않음). clone해도 셰이더 유지(고스트·교체 장면 복사본).
export const LV_ACCENT={2:'#4fd1ff',3:'#5dffc8',4:'#a77bff',5:'#ffd34a'};
const lvTime={value:0};
let lvMat=null,sparkMat=null;
const LV_VERT_HEAD='attribute vec3 lvCol;\nattribute vec3 lvRM;\nattribute vec4 lvEm;\nvarying vec3 vLvCol;\nvarying vec3 vLvRM;\nvarying vec4 vLvEm;\nvarying vec3 vLvPos;\n';
const LV_FRAG_HEAD='uniform float uLvTime;\nvarying vec3 vLvCol;\nvarying vec3 vLvRM;\nvarying vec4 vLvEm;\nvarying vec3 vLvPos;\n'+
 'float lvBand(float t,float c,float w){float f=fract(t),a=fwidth(t)*1.2+1e-4;return 1.0-smoothstep(w-a,w+a,abs(f-c));}\n';
// 무늬·색 (color_fragment 뒤): lvL 단계, lvRole 0 본체·1 빛나는 곳·2 어두운 판(Lv4~ 카본)·3 고무(그대로), lvStripe 줄무늬
const LV_COLOR=`
float lvL=vLvEm.w, lvRole=vLvRM.z;
vec3 lvP=vLvPos;
vec3 lvBase=vLvCol;
float lvRough=vLvRM.x, lvMetal=vLvRM.y;
float lvT=dot(lvP,vec3(.62,.85,1.05))*2.4;
float lvStripe=(lvL>1.5&&lvRole<.5)?clamp(lvBand(lvT,.10,.06)+lvBand(lvT,.25,.032),0.,1.):0.;
vec3 lvAcc=lvL<3.5?vec3(.31,.82,1.):lvL<4.5?vec3(.66,.48,1.):vec3(1.,.93,.62);
if(lvL>3.5&&lvRole>1.5&&lvRole<2.5){
 vec2 lvUV=vec2(lvP.x+lvP.z*.72,lvP.y+lvP.z*.41)*42.;vec2 lvC=floor(lvUV);
 float lvTw=mod(lvC.x+lvC.y,4.)<2.?1.:0.;float lvSh=.7+.3*fract(lvUV.x+lvUV.y);
 lvBase=(lvL>4.5?mix(vec3(.035,.03,.022),vec3(.15,.12,.07),lvTw):mix(vec3(.03,.032,.04),vec3(.11,.115,.135),lvTw))*lvSh*1.3;
 lvRough=.24;lvMetal=lvL>4.5?.5:.35;
}
lvBase=mix(lvBase,lvAcc*(lvL>4.5?1.:.85),lvStripe*(lvL>4.5?.4:.9));
lvRough=mix(lvRough,.22,lvStripe);
diffuseColor.rgb*=lvBase;
`;
const LV_EMIT=`
#include <emissivemap_fragment>
{
 vec3 lvN=normalize(normal), lvV=normalize(vViewPosition);
 float lvFres=pow(1.-clamp(abs(dot(lvN,lvV)),0.,1.),3.2);
 float lvPulse=.72+.28*sin(uLvTime*3.14159);
 totalEmissiveRadiance=vLvEm.rgb*(lvL>4.5?lvPulse*1.35:1.);
 totalEmissiveRadiance+=lvAcc*lvStripe*(lvL<2.5?.32:lvL<3.5?.4:.55);
 if(lvL>2.5&&lvL<3.5)totalEmissiveRadiance+=vec3(.36,1.,.78)*lvFres*.6;
 if(lvL>3.5&&lvL<4.5)totalEmissiveRadiance+=vec3(.66,.48,1.)*lvFres*.95;
 if(lvL>4.5){vec3 lvRain=.5+.5*cos(6.2832*(lvFres*.85+dot(lvP,vec3(.9,.55,.7))+uLvTime*.11+vec3(0.,.33,.67)));
  totalEmissiveRadiance+=(lvRain*.75+vec3(.35,.25,.05))*lvFres*(.85+.35*lvPulse);}
}
`;
function patchLevelShader(sh){
 sh.uniforms.uLvTime=lvTime;
 sh.vertexShader=LV_VERT_HEAD+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvLvCol=lvCol;vLvRM=lvRM;vLvEm=lvEm;vLvPos=position;');
 sh.fragmentShader=LV_FRAG_HEAD+sh.fragmentShader
  .replace('#include <color_fragment>','#include <color_fragment>\n'+LV_COLOR)
  .replace('#include <roughnessmap_fragment>','float roughnessFactor=lvRough;')
  .replace('#include <metalnessmap_fragment>','float metalnessFactor=lvMetal;')
  .replace('#include <emissivemap_fragment>',LV_EMIT);
}
const keepShaderClone=m=>{m.clone=function(){const c=T.MeshStandardMaterial.prototype.clone.call(this);c.onBeforeCompile=this.onBeforeCompile;c.customProgramCacheKey=this.customProgramCacheKey;return keepShaderClone(c);};return m;};
/** 강화 단계 부품 공용 재질 (한 페이지에 하나) */
export function levelMaterial(){
 if(lvMat)return lvMat;
 lvMat=new T.MeshStandardMaterial({color:'#ffffff',roughness:.4,metalness:.5});
 lvMat.name='partLevel';lvMat.userData={live:true,lvShared:true};
 lvMat.onBeforeCompile=patchLevelShader;lvMat.customProgramCacheKey=()=>'partLevel1';
 return keepShaderClone(lvMat);
}
/** Lv5 금빛 불티 재질 (Points, 공용) */
export function sparkMaterial(){
 if(sparkMat)return sparkMat;
 sparkMat=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,uniforms:{uLvTime:lvTime,uScale:{value:420}},
  vertexShader:'uniform float uLvTime;uniform float uScale;attribute vec4 seed;varying float vA;varying float vH;\nvoid main(){float k=fract(uLvTime*(.32+seed.y*.3)+seed.x);vec3 p=position;p.y+=k*(.32+seed.z*.3);p.x+=sin(k*6.2832+seed.w*9.)*.05;p.z+=cos(k*6.2832+seed.w*7.)*.05;vA=sin(k*3.14159)*(.6+.4*seed.z);vH=seed.w;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((.026+.022*seed.y)*uScale/max(.3,-mv.z),1.,14.);}',
  fragmentShader:'varying float vA;varying float vH;\nvoid main(){vec2 d=gl_PointCoord-.5;float r=length(d);if(r>.5)discard;float c=pow(1.-r*2.,1.6);vec3 col=mix(vec3(1.,.82,.32),vec3(1.,.97,.8),c);col=mix(col,.6+.4*cos(6.2832*(vH+vec3(0.,.33,.67))),.22);gl_FragColor=vec4(col*vA*c*1.6,1.);}'});
 sparkMat.name='partLevelSparks';sparkMat.userData={live:true,lvShared:true};
 return sparkMat;
}
/** 미리 데우기용 본보기 (prewarm·차고): 단계 재질 메시 + 불티. 쓰고 나면 g.userData.dispose() */
export function levelWarmObjects(){
 const g=new T.Group();g.name='partLevelWarm';
 const geo=new T.BoxGeometry(.01,.01,.01),n=geo.attributes.position.count;
 geo.setAttribute('lvCol',new T.Float32BufferAttribute(new Float32Array(n*3).fill(1),3));
 geo.setAttribute('lvRM',new T.Float32BufferAttribute(new Float32Array(n*3).fill(.5),3));
 const em=new Float32Array(n*4);for(let i=0;i<n;i++)em[i*4+3]=5;geo.setAttribute('lvEm',new T.Float32BufferAttribute(em,4));
 const m=new T.Mesh(geo,levelMaterial());m.userData.lvWarm=true;m.frustumCulled=false;g.add(m);
 const pg=new T.BufferGeometry();pg.setAttribute('position',new T.Float32BufferAttribute([0,0,0],3));pg.setAttribute('seed',new T.Float32BufferAttribute([0,0,0,0],4));
 const pts=new T.Points(pg,sparkMaterial());pts.frustumCulled=false;g.add(pts);
 g.userData.dispose=()=>{geo.dispose();pg.dispose();g.removeFromParent();};
 return g;
}
/** 차고 렌더러에서 단계 셰이더를 미리 만들어 둠 (첫 강화 때 멈칫 없게). 한 렌더러에 한 번 */
const warmed=new WeakSet();
const pitWarmMaterials=new WeakMap();
export async function warmLevelShaders(renderer,scene,camera){
 if(!renderer||!scene||!camera||warmed.has(renderer))return false;warmed.add(renderer);
 const g=levelWarmObjects();scene.add(g);const robot=createPitRobot(g,new T.Vector3(0,.5,-1),new T.Vector3(.7,.4,1));
 let sample;
 const target=new T.WebGLRenderTarget(32,32);
 const compile=async()=>{
  if(renderer.compileAsync)await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);
  // GPU 드라이버의 첫 실제 그리기 준비도 작은 숨은 버퍼에서 끝낸다.
  const prev=renderer.getRenderTarget(),vp=renderer.getViewport(new T.Vector4()),sc=renderer.getScissor(new T.Vector4()),test=renderer.getScissorTest();
  try{renderer.setRenderTarget(target);renderer.setViewport(0,0,32,32);renderer.setScissorTest(false);renderer.render(scene,camera);}finally{renderer.setRenderTarget(prev);renderer.setViewport(vp);renderer.setScissor(sc);renderer.setScissorTest(test);}
 };
 try{
  await compile();
  // 로봇뿐 아니라 새 카메라 가림 셰이더도 실제 장착 때와 같은 키로 준비.
  // 호출자는 차고 정지 프레임을 보관하므로 본보기 차는 화면에 그려지지 않음.
  const {createCarModel}=await import('./carModel.js');sample=createCarModel('#cc3333');g.add(sample.root);
  const keep=new Set();pitWarmMaterials.set(renderer,keep);
  renderer.domElement.addEventListener('webglcontextlost',()=>{for(const m of keep)m.dispose();keep.clear();},{once:true});
  for(const hints of [{engine:{no:3}},{engine:{no:3,lv:2}},{engine:{no:3},gearbox:{no:1}}]){
   sample.setParts(hints);await compile();
   // 셰이더 재질 3개만 보관. 본보기의 면은 전부 버리지만 프로그램은 첫 장착까지 유지.
   sample.root.traverse(o=>{if(o.material?.userData.pitCamera){o.material.userData.lvShared=true;keep.add(o.material);}});
  }
 }catch{}finally{sample?.dispose();robot.dispose();g.userData.dispose();target.dispose();}
 return true;
}
const LV_GOLD=new T.Color('#c98410'),LV_GOLDGLOW=new T.Color('#3a2402');
/** 칸 그룹 하나를 단계 모양으로: 메시마다 꼭짓점 속성 + 공용 재질 (묶기 전에 부름) */
function styleLevel(g,lv,force=false){
 if(!(lv>1)&&!force)return;const mat=levelMaterial(),acc=new T.Color(LV_ACCENT[Math.min(5,lv)]);
 g.traverse(o=>{
  if(!o.isMesh||!o.material||Array.isArray(o.material)||o.material===mat||o.material.userData.reviewEffect)return;const m=o.material,geo=o.geometry,n=geo.attributes.position.count;
  const ei=m.emissiveIntensity??1,emL=m.emissive?(m.emissive.r+m.emissive.g+m.emissive.b)*ei/3:0;
  const c=new T.Color().copy(m.color||LV_GOLD),lum=c.r*.3+c.g*.59+c.b*.11;
  let rough=m.roughness??.4,metal=m.metalness??.5,role=emL>.05?1:rough>.85?3:lum<.035&&metal<.75?2:0; // 3 = 고무(그대로)
  const e=new T.Color(0,0,0);if(m.emissive)e.copy(m.emissive).multiplyScalar(ei);
  if(role===1&&lv>=2){ // 빛나는 곳: 단계 색으로 물들고 더 밝게
   e.lerp((lv>=5?new T.Color('#ff9f1c'):acc.clone()).multiplyScalar(Math.min(.9,Math.max(.25,emL))),lv>=5?.75:lv>=4?.55:lv>=3?.45:.25).multiplyScalar(1+.08*(lv-1));
   if(lv>=5){c.copy(LV_GOLD).lerp(new T.Color('#ffd25a'),.35);metal=.7;rough=.3;e.add(LV_GOLDGLOW).add(LV_GOLDGLOW);}
  }else if(role===0){
   if(lv>=5){c.copy(LV_GOLD).lerp(m.color||LV_GOLD,.1);metal=.85;rough=.32;e.add(LV_GOLDGLOW);}
   else if(lv>=4){if(lum<.12)role=2;else{c.multiplyScalar(.6).lerp(new T.Color('#2a2f3a'),.3);metal=Math.min(.9,metal+.1);rough=Math.max(.16,rough*.7);}}
   else if(lv>=3){rough=Math.max(.14,rough*.8);metal=Math.min(.95,metal+.05);}
   else if(lv>=2)rough=Math.max(.16,rough*.9);
  }
  const col=new Float32Array(n*3),rm=new Float32Array(n*3),em=new Float32Array(n*4);
  for(let i=0;i<n;i++){col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;rm[i*3]=rough;rm[i*3+1]=metal;rm[i*3+2]=role;em[i*4]=e.r;em[i*4+1]=e.g;em[i*4+2]=e.b;em[i*4+3]=lv;}
  geo.setAttribute('lvCol',new T.BufferAttribute(col,3));geo.setAttribute('lvRM',new T.BufferAttribute(rm,3));geo.setAttribute('lvEm',new T.BufferAttribute(em,4));
  o.material=mat;
 });
}
/** Lv5 칸들 둘레의 불티 Points 하나 (차체 좌표) */
function levelSparks(body,groups){
 if(!groups.length)return null;body.updateMatrixWorld(true);const inv=body.matrixWorld.clone().invert(),pos=[],seed=[],foldIndices=[],foldGearIndices=[],b=new T.Box3(),q=new T.Box3(),v=new T.Vector3(),s=new T.Vector3();
 let r=1;const rand=()=>{r=(r*16807)%2147483647;return (r-1)/2147483646;};
 for(const g of groups){g.updateMatrixWorld(true);b.makeEmpty();g.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();q.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);b.union(q);});if(b.isEmpty())continue;b.applyMatrix4(inv);b.getSize(s);
  const n=Math.round(Math.min(24,9+s.length()*7));
  for(let i=0;i<n;i++){v.set(b.min.x+rand()*s.x,b.min.y+rand()*s.y*.8,b.min.z+rand()*s.z);if(g.name==='part-engine')foldIndices.push(pos.length/3);if(g.name==='part-gearbox')foldGearIndices.push(pos.length/3);pos.push(v.x,v.y,v.z);seed.push(rand(),rand(),rand(),rand());}}
 if(!pos.length)return null;
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('seed',new T.Float32BufferAttribute(seed,4));geo.computeBoundingSphere();
 const pts=new T.Points(geo,sparkMaterial());pts.name='lv5-sparks';pts.frustumCulled=false;pts.renderOrder=4;pts.userData.noBatch=true;pts.userData.partVisual=true;pts.userData.lvSparks=true;
 pts.userData.foldIndices=foldIndices;pts.userData.foldGearIndices=foldGearIndices;pts.userData.restPositions=new Float32Array(pos);
 pts.onBeforeRender=()=>{lvTime.value=performance.now()/1000;};
 return pts;
}
// 순정 날개/앞 범퍼를 차체 좌표가 아닌 해당 그룹의 지역 좌표로 잰다.
function bounds(group){group.updateMatrixWorld(true);const inv=group.matrixWorld.clone().invert(),b=new T.Box3(),q=new T.Box3();group.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();q.copy(o.geometry.boundingBox).applyMatrix4(new T.Matrix4().multiplyMatrices(inv,o.matrixWorld));b.union(q);});return b;}
export function createParts3d({body,spoiler,fWing,hull,wheels,A,M,drs,normalBounds,style}){
 const kitRef={body,spoiler,fWing,hull,wheels,style,motors:body.children.filter(o=>o.isGroup&&Math.abs(Math.abs(o.position.x)-A.motor[0])<.001&&Math.abs(o.position.y-A.motor[1])<.001&&Math.abs(o.position.z-A.motor[2])<.001).map(g=>({g})),hullScale:A.hull||[1,1,1,0],hullY:A.hull?.[1]||1,stock:{}};photoKits.set(body,kitRef);
 const rear=bounds(spoiler),front=bounds(fWing),nodes=[],resources=new Set(),materials=new Set();
 if(drs){drs.updateMatrix();drs.geometry.computeBoundingBox();rear.copy(drs.geometry.boundingBox).applyMatrix4(drs.matrix);}
 const rearSize=rear.getSize(new T.Vector3()),rearCenter=rear.getCenter(new T.Vector3());
 // 날개 그룹 좌표에서 땅 높이(차 원점 y=0): 큰 끝판이 땅에 닿지 않게.
 let top0=spoiler;while(top0.parent)top0=top0.parent;top0.updateMatrixWorld(true);
 const spRel=new T.Matrix4().copy(top0.matrixWorld).invert().multiply(spoiler.matrixWorld),groundY=new T.Vector3(0,0,0).applyMatrix4(spRel.clone().invert()).y;
 const mounts={rear:{width:rearSize.x,y:rear.max.y,z:rearCenter.z},front:{width:front.max.x-front.min.x,y:front.min.y,z:front.max.z}};
 let signature='',jet=false,engine=null,gearboxNode=null,driveFold=null;
 const drsBindings=[],drsDelta=new T.Matrix4(),drsPoint=new T.Vector3();
 // partfit: 원래 배기 끝의 차체 좌표. 같은 차체를 쓰는 차도 이 자리를 함께 쓴다.
 const exhausts={f1:[[0,.5,-2.10,.07]],proto:[[-.13,.42,-2.68,.055],[.13,.42,-2.68,.055]],
  hyper:[[0,.42,-2.75,.10]],gt:[[-.375,.31,-2.72,.085],[.375,.31,-2.72,.085]],
  rally:[[-.45,.32,-2.38,.085]],hatch:[[0,.32,-2.20,.075]],muscle:[[-.55,.30,-2.71,.065],[.55,.30,-2.71,.065],[-1,.3,-.72,.07],[1,.3,-.72,.07]],
  roadster:[[-.4,.33,-2.31,.055],[.735,.36,-.782,.055]],truck:[[-.6,A.motor[1]-.04,-2.66,.065],[.6,A.motor[1]-.04,-2.66,.065]],
  van:[[.5,.26,-2.15,.05]],wedge:[[-.4,.4,-2.47,.085],[.4,.4,-2.47,.085]],
  kart:[[.31,.44,-1.30,.045]],buggy:[[-.335,1.27,-2.19,.05],[.335,1.27,-2.19,.05]],
  rocket:[[-.54,1.02,-1.56,.06],[.54,1.02,-1.56,.06]],ev:[[0,.4,-2.80,.08]]};
 const ports=exhausts[style]||exhausts.f1;
 const rearZ=-normalBounds.back+.06,rearY=Math.max(.22,Math.min(...A.wheels.map(w=>w[3]))*.75);
 mounts.engine={width:Math.max(.2,...ports.map(p=>Math.abs(p[0])*2+.2)),y:ports[0][1],z:ports[0][2]};
 mounts.gearbox={width:style==='kart'?.22:.38,y:style==='kart'?.24:style==='buggy'?.46:style==='truck'?A.motor[1]-.14:rearY,z:style==='rocket'?-1.95:style==='buggy'?-1.97:rearZ+.10};
 const tireLoose=[],wheelChanged=[];
 const waterJets=hull.children.filter(o=>{if(!o.isMesh)return false;const b=new T.Box3().setFromObject(o).applyMatrix4(hull.matrixWorld.clone().invert()),v=b.getSize(new T.Vector3()),c=b.getCenter(new T.Vector3());return Math.abs(Math.abs(c.x)-.68)<.03&&c.z<-2.45&&c.z>-2.9&&c.y<.4&&v.x<.5&&v.y<.5;});kitRef.waterJets=waterJets;
 const originals={rear:spoiler.children.filter(o=>o.visible),front:fWing.children.filter(o=>o.visible),waterJets},changed=[],hiddenStock=[];
 const stockEngine=new T.Group();kitRef.stock.engine=stockEngine;
 let cutReady=false;
 function unbatch(){const list=[];body.traverse(o=>{if(o.userData.batched&&o.userData.undo)list.push(o);});for(const o of list)o.userData.undo();}
 function cutGeometry(src,indices){let g=src.clone();g.setIndex(indices);if(!src.index){const flat=g.toNonIndexed();g.dispose();g=flat;}g.computeBoundingBox();g.computeBoundingSphere();return g;}
 function prepareCuts(){if(cutReady)return;cutReady=true;body.updateWorldMatrix(true,true);const inv=body.matrixWorld.clone().invert(),rows=[];
  body.traverse(o=>{if(!o.isMesh||Array.isArray(o.material)||o.material.transparent||o.userData.partVisual)return;
   for(let n=o;n&&n!==body;n=n.parent)if(n===spoiler||n===fWing||n===hull||/^accel-/.test(n.name))return;
   if(o.material===M.paint||o.material===M.accent||o.material===M.trim||o.material===M.tailMat||o.material===M.glass)return;
   if(style==='ev')return;
   const src=o.geometry,pos=src.attributes.position,ix=src.index,yes=[],no=[],m=new T.Matrix4().multiplyMatrices(inv,o.matrixWorld),q=new T.Vector3();
   for(let i=0;i<(ix?.count||pos.count);i+=3){const ids=[0,1,2].map(k=>ix?ix.getX(i+k):i+k);const match=ids.every(j=>{q.fromBufferAttribute(pos,j).applyMatrix4(m);return ports.some(([x,y,z,r])=>Math.abs(q.x-x)<(style==='rocket'?.15:r*2.1+.035)&&Math.abs(q.y-y)<(style==='buggy'?.18:style==='rocket'?.32:r*1.6+.025)&&q.z<z+.33&&q.z>z-.09);});(match?yes:no).push(...ids);}
   if(yes.length)rows.push({o,src,yes,no,m});
  });
  for(const r of rows){const removed=cutGeometry(r.src,r.yes),remain=cutGeometry(r.src,r.no);const c=new T.Mesh(removed,r.o.material);c.applyMatrix4(r.m);stockEngine.add(c);changed.push({...r,removed,remain,visible:r.o.visible,parent:r.o.parent});}
 }
 function hideEngine(on){prepareCuts();unbatch();for(const r of changed){r.o.geometry=on?r.remain:r.src;r.o.visible=r.visible;if(on&&!r.no.length)r.o.removeFromParent();else if(!r.o.parent)r.parent.add(r.o);}}
 function restoreStock(){for(const r of changed){r.o.geometry=r.src;r.o.visible=r.visible;if(!r.o.parent)r.parent.add(r.o);}for(const [o,v,parent]of hiddenStock){if(!o.parent)parent.add(o);o.visible=v;}hiddenStock.length=0;}
 function hideOriginal(which){for(const o of originals[which]){hiddenStock.push([o,o.visible,o.parent]);o.removeFromParent();}}
 kitRef.stock.aero=spoiler;kitRef.stock.splitter=fWing;kitRef.hideEngine=hideEngine;
 const mat=(color,o={})=>new T.MeshStandardMaterial({color,metalness:o.metal??.6,roughness:o.rough??.35,...(o.emissive?{emissive:o.emissive,emissiveIntensity:o.ei??1.4}:{})});
 // 뒷바퀴 안쪽 한계(배기 바깥쪽 끝)와 배기·변속기 중심 높이.
 const lowY=rearY+.03;
 function clear(){unbatch();drsBindings.length=0;for(const r of wheelChanged){r.o.geometry=r.geo;r.o.material=r.mat;}wheelChanged.length=0;for(const w of wheels){for(const o of [...w.spin.children])if(o.userData.batched&&o.userData.undo)o.userData.undo();}for(const o of tireLoose)o.removeFromParent();tireLoose.length=0;restoreStock();engine=gearboxNode=null;driveFold=null;for(const g of resources)g.dispose();resources.clear();for(const m of materials)if(!m.userData?.lvShared)m.dispose();materials.clear();for(const g of nodes){g.removeFromParent();}nodes.length=0;}
 // stockcalls: 순정 타이어 띠는 바퀴 묶음(batchLocal) 안에 합쳐져 있어 그림 호출이 늘지 않음.
 //   부품 타이어가 띠를 숨기거나 되돌릴 때만 그 바퀴 묶음을 풀고 다시 묶음 (숨은 띠는 혼자 남아 그려지지 않음).
 //   묶음 여부는 차 전체에서 봄 (띠가 숨어 있는 동안 그 바퀴엔 묶인 것이 하나도 없을 수 있음)
 function batchState(){let on=false,pbr=false;for(const r of [body,...wheels.map(w=>w.spin)])r.traverse(o=>{if(o.userData.batched){on=true;if(o.material?.userData?.pbrBake)pbr=true;}});return {on,pbr};}
 function setWalls(show){if(!wheels.some(w=>w.wall&&w.wall.visible!==show))return;const st=batchState();
  for(const w of wheels){const wall=w.wall;if(!wall||wall.visible===show)continue;
   for(const o of w.spin.children.filter(o=>o.userData.batched&&o.userData.undo))o.userData.undo();wall.visible=show;if(st.on)batchLocal(w.spin,{pbr:st.pbr});}}
 function group(parent,name){const g=new T.Group();g.name='part-'+name;g.userData.noBatch=true;g.userData.partVisual=true;parent.add(g);nodes.push(g);return g;}
 function mesh(g,geo,mat,x=0,y=0,z=0){const o=new T.Mesh(geo,mat);o.position.set(x,y,z);o.userData.partVisual=true;o.castShadow=false;g.add(o);return o;}
 const box=(g,w,h,d,mat,x,y,z)=>mesh(g,new T.BoxGeometry(w,h,d),mat,x,y,z);
 // 그리는 면을 늘리지 않고 강화 카메라에 해당 부품의 범위만 전달한다.
 function markBounds(g,source){const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute([],3));geo.boundingBox=bounds(source);g.geometry=geo;resources.add(geo);}
 // ????? ?? ???? ???? ?? ? ?? ???.
 function blockTread(width,r){const g=new T.BufferGeometry(),x=width*.49,z=r*.13,y=.015;g.setAttribute('position',new T.Float32BufferAttribute([-x,0,-z,x,0,-z,x,0,z,-x,0,z,-x,y,-z,x,y,-z,x,y,z,-x,y,z],3));g.setIndex([4,6,5,4,7,6,0,7,4,0,3,7,1,5,6,1,6,2]);g.computeVertexNormals();return g;}
 function setParts(parts={}){
  const next=JSON.stringify(parts||{});if(next===signature)return;signature=next;clear();parts=parts||{};kitRef.engineHint=parts.engine;jet=parts.water?.hull==='jet';setWalls(!parts.tire);
  if(parts.tire){const p=parts.tire,mat=new T.MeshStandardMaterial({color:p.sidewall||'#ef3947',roughness:.7});mat.userData.partOwned=true;
   const rubber=new T.MeshStandardMaterial({color:'#24262b',roughness:.92});
   for(let i=0;i<wheels.length;i++){const w=wheels[i],width=A.wheels[i][4],g=group(w.spin,'tire-'+i),side=w.side,r=w.r,t=p.tread;
    mesh(g,new T.RingGeometry(r*(t==='slick'?.84:t==='knob'?.67:.76),r*(t==='slick'?.865:.88),10).rotateY(side*Math.PI/2),mat,side*(width/2+.006),0,0);
    if(t!=='slick'){
     if(t==='sharp')mesh(g,new T.RingGeometry(r*.70,r*.79,10).rotateY(side*Math.PI/2),M.metal,side*(width/2+.009),0,0);
     for(let j=0;j<4;j++){const a=j*Math.PI/2;
      const geo=t==='knob'?blockTread(width,r):new T.PlaneGeometry(width*.88,.025).rotateZ(.48);
      geo.rotateX(-Math.PI/2).translate(0,r-.002,0).rotateX(a);mesh(g,geo,t==='knob'?rubber:M.dark);
     }
    }
   }
  }
  // 배기 끝만 교체한다. 차체 안으로 이어지는 짧은 목을 둬 공중에 매달리지 않게.
  if(parts.engine){
   hideEngine(true);const e=parts.engine,n=e.no||1,g=group(body,'engine');engine=g;
   const block=createPitEngine(n),[ex,ey,ez,ek]=enginePosition(style);block.position.set(ex,ey,ez);block.scale.setScalar(ek);g.add(block);
   const metal=mat(e.exhaustColor||'#c3cbd7',{metal:.88,rough:.24}),tip=mat(n===3?'#c6995c':n===1?'#8076bd':'#aab1bb',{metal:.86,rough:.24}),dark=mat('#151b21',{metal:.25,rough:.6});
   // 터보 한 구는 원래 구멍 무리의 중심. 좌우로 멀리 떨어진 구멍은 각각 한 구로 유지.
   for(const [x,y,z,r0]of ports){const r=Math.max(.048,r0),raised=style==='buggy'||style==='rocket',len=style==='kart'?.16:raised?.22:.24;
    const pod=group(g,'port');nodes.pop();pod.name='';pod.position.set(x,y,z+(raised||style==='kart'?.09:.20));
    if(style==='buggy')pod.rotation.x=.75;if(style==='rocket')pod.rotation.x=.55;
    const radius=n===3?r*1.35:n===2?r*.60:r*.66,offset=n===3?[0]:n===2?[-1.2,-.4,.4,1.2]:[-.72,.72];
    for(const k of offset){const px=k*r;
     mesh(pod,new T.CylinderGeometry(radius,radius*.92,len,n===2?4:8,1,true).rotateY(n===2?Math.PI/4:0).rotateX(Math.PI/2),metal,px,0,-len/2);
     mesh(pod,new T.CylinderGeometry(radius*1.10,radius,.045,n===2?4:8,1,true).rotateY(n===2?Math.PI/4:0).rotateX(Math.PI/2),tip,px,0,-len+.015);
     mesh(pod,new T.CircleGeometry(radius*.9,n===2?4:8).rotateZ(n===2?Math.PI/4:0).rotateY(Math.PI),dark,px,0,-len+.025);
    }
   }
   if(n===3){ // 흡기 덕트도 실제 엔진룸 근처에, 차 안을 가리지 않는 낮은 입구.
    const a=style==='kart'?[.4,.40,-.48]:style==='buggy'?[0,1.10,-1.62]:style==='rocket'?[0,1.16,-1.2]:null;
    if(a){box(g,.18,.045,.14,tip,...a);box(g,.14,.025,.015,dark,a[0],a[1]+.008,a[2]+.075);}
   }
  }
  if(parts.gearbox){
   const gb=parts.gearbox,n=gb.no||1,g=group(body,'gearbox');gearboxNode=g;
   const housing=mat('#454e58',{metal:.72,rough:.4}),accent=mat(gb.color||'#51c8e8',{metal:.5,rough:.35}),dark=mat('#242a30',{metal:.5,rough:.5});
   const {width:w,y,z}=mounts.gearbox,h=style==='kart'?.12:.16,d=n===2?.32:.24;
   // 뒤 충돌 구조물 안으로 뻗는 커버: 끝면만 보이며 범퍼 뒤로 튀어나오지 않는다.
   mesh(g,new T.CylinderGeometry(w*.5,w*.39,d,6).rotateX(Math.PI/2).scale(1,h/w,1),housing,0,y,z+d*.35);
   box(g,w*.7,.022,.035,accent,0,y+h*.45,z-d*.12);
   for(let i=0;i<(n===1?3:2);i++)box(g,w*.7,.016,.025,dark,0,y+h*.42,z+i*.055);
   if(n===3)mesh(g,new T.RingGeometry(.025,.045,6).rotateY(Math.PI),accent,0,y,z-d*.16-.003);
  }
  const p=parts.aero;if(p){
   const split=p.kind==='splitter',which=split?'front':'rear',parent=split?fWing:spoiler,g=group(parent,split?'splitter':'aero');
   const base=split?front:bounds(spoiler);if(!split)g.userData.drsRest=drs.matrix.clone().invert();
   // 날개 전체를 같은 고정점에서 교체한다. 지지대·범퍼 연결은 원래 모양을 보존.
   const inv=parent.matrixWorld.clone().invert(),isLip=p.kind==='lip';
   for(const original of originals[which])original.traverse(o=>{
    if(!o.isMesh)return;for(let n=o;n&&n!==parent;n=n.parent)if(!n.visible)return;const geo=o.geometry.clone(),m=new T.Matrix4().multiplyMatrices(inv,o.matrixWorld);geo.applyMatrix4(m);
    const a=geo.attributes.position;for(let i=0;i<a.count;i++){let x=a.getX(i),y=a.getY(i),z=a.getZ(i);
     if(split){const t=Math.max(0,Math.min(1,(z-base.min.z)/Math.max(.01,base.max.z-base.min.z)));z+=.07*t;y-=.012*t;}
     else if(y>rearCenter.y-.04){const safeY=groundY+(2*Math.max(...A.wheels.map(w=>w[3]))+.18)/Math.max(.1,Math.abs(spRel.elements[5])),t=Math.max(0,Math.min(1,(y-(rearCenter.y-.04))/.15))*Math.max(0,Math.min(1,(y-safeY)/.15));z=rearCenter.z+(z-rearCenter.z)*(1+(isLip?-.12:.20)*t);y+=(isLip?-.025:.035)*t;}
     a.setXYZ(i,x,y,z);
    }geo.computeVertexNormals();
    if(!split)geo.setAttribute('partDRS',new T.Float32BufferAttribute(new Float32Array(a.count).fill(o===drs?1:0),1));
    const material=o.material.clone();if(material.color&&o.material!==M.tailMat&&o.material!==M.numMat){material.color.lerp(new T.Color(p.color||'#333a42'),.45);}
    const copy=mesh(g,geo,material);copy.castShadow=o.castShadow;if(material.userData.reviewEffect)copy.userData.noBatch=true;
   });
   hideOriginal(which);
  }
  const water=parts.water;if(water){const g=group(hull,'water');
   if(water.hull==='deepv'){
    // 딥V: 선체 아래 중심 용골과 선체에 닿은 낮은 카빙 핀.
    const fin=mat('#9a5cff',{metal:.4,rough:.35,emissive:'#9a5cff',ei:.22}),steel=mat('#c8ced8',{metal:.85,rough:.25});
    const pos=[],idx=[];for(const [z,w,d]of [[2.3,.01,.18],[.8,.10,.35],[-2.3,.10,.32]])pos.push(-w,-.14,z,w,-.14,z,0,-d,z);
    for(let i=0;i<2;i++)for(let j=0;j<3;j++){const a=i*3+j,b=i*3+(j+1)%3;idx.push(a,a+3,b,b,a+3,b+3);}idx.push(0,1,2,6,8,7);
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();mesh(g,geo,steel);
    for(const s of [-1,1]){const f=box(g,.32,.045,3.6,fin,s*.94,.05,.1);f.rotation.z=-s*.35;box(g,.045,.3,.55,fin,s*.94,.17,-2.15);}
   }else if(water.hull==='jet'){hideOriginal('waterJets');
    // 워터젯: 기존 쌍 분사구 자리와 엔진 덮개에 붙은 낮은 흡기.
    const pod=mat('#ff8a1f',{metal:.45,rough:.35}),dark=mat('#23272e',{metal:.7,rough:.35}),jet=mat('#0c1b22',{metal:.2,rough:.6,emissive:'#4fe0ff',ei:1.5});
    const hs=A.hull||[1,1,1,0],mx=A.motor[0]/hs[0],my=Math.max(.08,Math.min(.28,(A.motor[1]-.30)/hs[1])),mz=(A.motor[2]-(hs[3]||0))/hs[2]-.12;
    for(const s of [-1,1]){
     // 원래 선외기 고정점에서 낮은 분사구까지 이어지는 펌프 케이스.
     const mountY=A.motor[1]/hs[1];box(g,.28,Math.max(.12,mountY-my),.24,dark,s*mx,(mountY+my)/2,mz+.12);
     mesh(g,new T.CylinderGeometry(.17,.15,.30,8,1,true).rotateX(Math.PI/2),dark,s*mx,my,mz);
     mesh(g,new T.RingGeometry(.12,.17,8).rotateY(Math.PI),pod,s*mx,my,mz-.152);
     mesh(g,new T.CircleGeometry(.125,8).rotateY(Math.PI),jet,s*mx,my,mz-.14);
     box(g,.25,.045,.42,pod,s*.66,.615,-1.85);
    }
   }else{
    // 플레이닝: 원래 선체 옆 부력통에 겹쳐 붙는 하늘색 발과 물끊기 스텝.
    const c=mat('#29c6ff',{metal:.35,rough:.35,emissive:'#29c6ff',ei:.15}),d=mat('#262b33',{metal:.5,rough:.5});
    for(const s of [-1,1]){
     const geo=new T.BoxGeometry(.28,.12,4.3),a=geo.attributes.position;for(let i=0;i<a.count;i++)if(a.getZ(i)>0&&a.getY(i)<0)a.setZ(i,a.getZ(i)-.45);geo.computeVertexNormals();
     mesh(g,geo,c,s*1.10,.16,.05);box(g,.24,.08,.7,d,s*1.02,.18,-.35);box(g,.36,.04,.14,d,s*1.10,.23,-.95);
    }
   }
  }
  // 교체 그룹 안에서 먼저 PBR로 합치고 바깥 묶음으로부터 보호한다.
  // upgradeD1: 칸마다 강화 단계 모양 (묶기 전), Lv5 칸이 있으면 불티 하나
  const lvOf=g=>{const n=g.name.slice(5),slot=n.startsWith('tire')?'tire':n==='splitter'?'aero':n;return Math.max(1,Math.min(5,Math.floor(Number(parts[slot]?.lv)||1)));};
  for(const g of [...nodes]){
   if(g===engine){g.updateWorldMatrix(true,true);const inv=g.matrixWorld.clone().invert(),list=[];g.traverse(o=>{if(o.isMesh)list.push(o);});for(const o of list){const m=new T.Matrix4().multiplyMatrices(inv,o.matrixWorld);o.geometry.applyMatrix4(m);g.add(o);o.position.set(0,0,0);o.quaternion.identity();o.scale.set(1,1,1);}}
   g.traverse(o=>{if(o.isMesh){if(o.geometry.index){const old=o.geometry;o.geometry=old.toNonIndexed();old.dispose();}o.castShadow=false;}});
   g.traverse(o=>{if(o.material&&!o.material.userData.lvShared&&!Object.values(M).includes(o.material))materials.add(o.material);});
   styleLevel(g,lvOf(g));
  }
  {const fx=levelSparks(body,nodes.filter(g=>lvOf(g)>=5&&!g.name.startsWith('part-water')));if(fx){body.add(fx);nodes.push(fx);resources.add(fx.geometry);}}
  // 엔진과 변속기 커버는 한 번에 그리되 배기만 셰이더에서 수납한다.
  // 교체용 복사본은 칸별로 보관하여 빠지는 범위가 합쳐지지 않는다.
  if(engine&&gearboxNode){
   const draw=group(body,'drivetrain'),geos=[],fold={value:new T.Vector3()},engineMask={value:1},gearMask={value:1};driveFold=fold;
   for(const [g,isEngine]of [[engine,true],[gearboxNode,false]]){
    const lv=lvOf(g);styleLevel(g,lv,true);g.updateWorldMatrix(true,true);
    const snapshot=g.clone(true);snapshot.userData={};g.userData.partSource=snapshot;g.userData.partMask=isEngine?engineMask:gearMask;markBounds(g,snapshot);
    for(const o of [...g.children]){if(!o.isMesh)continue;resources.add(o.geometry);if(!o.material.userData.lvShared)materials.add(o.material);
     const geo=o.geometry.clone();o.updateMatrix();geo.applyMatrix4(o.matrix);geo.deleteAttribute('uv');geo.setAttribute('partFold',new T.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(isEngine?1:0),1));geos.push(geo);o.removeFromParent();
    }
   }
   const geo=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());
   const material=keepShaderClone(levelMaterial().clone());material.userData={live:true};
   material.onBeforeCompile=sh=>{patchLevelShader(sh);sh.uniforms.uPartFold=fold;sh.uniforms.uEngineMask=engineMask;sh.uniforms.uGearMask=gearMask;
    sh.vertexShader='attribute float partFold; varying float vPartFold; uniform vec3 uPartFold;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n transformed+=uPartFold*partFold;vPartFold=partFold;');
    sh.fragmentShader='varying float vPartFold;uniform float uEngineMask;uniform float uGearMask;\n'+sh.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\n if(mix(uGearMask,uEngineMask,vPartFold)<.5)discard;');};
   material.customProgramCacheKey=()=> 'partfit-drivetrain-1';mesh(draw,geo,material);
  }
  for(const g of nodes){const collect=()=>g.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material&&!o.material.userData.pbrBake&&!Object.values(M).includes(o.material))materials.add(o.material);});collect();
   if(g.name.startsWith('part-tire-')){
    markBounds(g,g);
    const spin=g.parent;for(const o of [...spin.children])if(o.userData.batched&&o.userData.undo)o.userData.undo();
    const wheel=spin.children.find(o=>o.isMesh&&o.geometry.attributes.wheelSurface);
    if(wheel){
     const geos=[],fill=(geo,color,rm,em,ws)=>{const n=geo.attributes.position.count;
      const attr=(name,size,values)=>{if(geo.attributes[name])return;const a=new Float32Array(n*size);for(let i=0;i<n;i++)a.set(values,i*size);geo.setAttribute(name,new T.BufferAttribute(a,size));};
      attr('color',3,color);attr('lvCol',3,color);attr('lvRM',3,rm);attr('lvEm',4,em);attr('wheelSurface',3,ws);geo.deleteAttribute('uv');
     };
     const base=wheel.geometry.clone();fill(base,[1,1,1],[.7,0,3],[0,0,0,0],[.7,0,0]);
     // 순정 바퀴 PBR·흐림은 꼭짓점 값 그대로, 부품 쪽만 공용 강화 셰이더를 쓴다.
     const wa=base.attributes.wheelSurface,rm=base.attributes.lvRM;for(let i=0;i<wa.count;i++)rm.setXYZ(i,wa.getX(i),wa.getY(i),3);
     geos.push(base);
     for(const o of [...g.children]){if(!o.isMesh)continue;const geo=o.geometry.clone(),m=o.material,c=m.color||new T.Color('white');
      fill(geo,[c.r,c.g,c.b],[m.roughness??.7,m.metalness??0,0],[0,0,0,1],[m.roughness??.7,m.metalness??0,0]);
      {const col=geo.attributes.color;for(let i=0;i<col.count;i++)col.setXYZ(i,1,1,1);}
      geos.push(geo);o.removeFromParent();
     }
     const combined=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());
     if(combined){const original=wheel.material,material=keepShaderClone(original.clone()),compile=original.onBeforeCompile,key=original.customProgramCacheKey();
      material.onBeforeCompile=sh=>{compile(sh);sh.fragmentShader=sh.fragmentShader.replace('roughnessFactor=vWheelSurface.x;','').replace('metalnessFactor=vWheelSurface.y;','');patchLevelShader(sh);};
      material.customProgramCacheKey=()=>key+'-partfit';material.userData={live:true};
      wheelChanged.push({o:wheel,geo:wheel.geometry,mat:original});wheel.geometry=combined;wheel.material=material;resources.add(combined);materials.add(material);
     }
    }
   }
   else{g.userData.noBatch=false;batchLocal(g,{pbr:true});collect();g.traverse(o=>{o.userData.noBatch=true;});}
  }
  // 차고 카메라(0번 층)는 그대로 보이고, 게임의 1인칭 숨김 규칙을 따름.
  // 카메라가 공용 5번 층을 쓰되 8번 층을 숨기는 순간만 엔진을 가린다.
  // 엔진+기어 묶음을 유지하므로 새 그림 호출은 없다.
  for(const g of nodes)if(g===engine||g.name==='part-drivetrain')g.traverse(o=>{
   if(!o.isMesh)return;const old=o.material,compile=old.onBeforeCompile,key=old.customProgramCacheKey(),visible={value:1},m=keepShaderClone(old.clone());
   m.userData={live:true,pitCamera:true};
   m.onBeforeCompile=sh=>{compile.call(old,sh);sh.uniforms.uPitVisible=visible;sh.fragmentShader='uniform float uPitVisible;\n'+sh.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(uPitVisible<.5)discard;');};
   m.customProgramCacheKey=()=>key+'-pit-camera1';o.material=m;materials.add(m);
   const render=o.onBeforeRender;o.onBeforeRender=function(r,s,c,...args){render?.call(this,r,s,c,...args);visible.value=(c.layers.mask&(1<<5))&&!(c.layers.mask&(1<<8))?0:1;};
  });
  for(const g of nodes)if(g.name==='part-aero')g.traverse(o=>{const tag=o.geometry?.attributes.partDRS;if(!tag)return;const indices=[];for(let i=0;i<tag.count;i++)if(tag.getX(i)>.5)indices.push(i);if(indices.length)drsBindings.push({o,indices,rest:g.userData.drsRest,p:new Float32Array(o.geometry.attributes.position.array),n:new Float32Array(o.geometry.attributes.normal.array)});});
 }
 return {setParts,dispose(){clear();for(const r of changed){r.removed.dispose();r.remain.dispose();}for(const w of wheels)if(w.wall)w.wall.visible=true;},mounts,pose(motors,accelP=0){
  // 노즐 전개 초반에 배기를 안쪽·아래로 수납하고, 역변신 때 같은 경로로 복원한다.
  const t=Math.max(0,Math.min(1,accelP/.28)),q=t*t*(3-2*t);
  // 원래 DRS 축의 움직임을 교체된 날개에도 전한다. 합쳐 그리는 구조는 그대로다.
  if(drsBindings.length){drs.updateMatrix();for(const b of drsBindings){drsDelta.multiplyMatrices(drs.matrix,b.rest);const p=b.o.geometry.attributes.position,n=b.o.geometry.attributes.normal;for(const i of b.indices){drsPoint.fromArray(b.p,i*3).applyMatrix4(drsDelta);p.setXYZ(i,drsPoint.x,drsPoint.y,drsPoint.z);drsPoint.fromArray(b.n,i*3).transformDirection(drsDelta);n.setXYZ(i,drsPoint.x,drsPoint.y,drsPoint.z);}p.needsUpdate=n.needsUpdate=true;b.o.geometry.computeBoundingBox();b.o.geometry.computeBoundingSphere();}}
  const foldY=style==='buggy'?-.48:style==='rocket'?-.30:-.08,foldZ=style==='buggy'?.55:.34;
  if(engine)engine.position.set(0,foldY*q,foldZ*q);if(driveFold)driveFold.value.set(0,foldY*q,foldZ*q);
  // 변속기 커버는 차체 안에 고정한다.
  if(gearboxNode)gearboxNode.position.z=0;
  // Lv5 불티도 같은 거리만큼 수납한다. 기존 Points 한 번 그리기를 유지한다.
  const fx=nodes.find(g=>g.userData.lvSparks);if(fx&&fx.userData.lastFold!==q){fx.userData.lastFold=q;const a=fx.geometry.attributes.position,r=fx.userData.restPositions;
   for(const i of fx.userData.foldIndices)a.setXYZ(i,r[i*3],r[i*3+1]+foldY*q,r[i*3+2]+foldZ*q);
   a.needsUpdate=true;
  }
  kitRef.motors=motors;if(jet)for(const m of motors)m.g.visible=false;}};
}
