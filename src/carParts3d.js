import * as T from 'three';

import {batchLocal} from './staticBatch.js';
// 사진 전용 참조. 게임의 메시·재질·그림 호출은 바꾸지 않는다.
const photoKits=new WeakMap();
export function isolatedPart(model,slot,look){
 const kit=photoKits.get(model.fp.body),out=new T.Group();
 if(!kit)return out;
 const source=slot==='tire'?kit.wheels[0].spin:look?model.root.getObjectByName('part-'+(slot==='aero'&&look.kind==='splitter'?'splitter':slot)):slot==='aero'?kit.spoiler:slot==='water'?kit.hull:null;
 if(source){const c=source.clone(true),hidden=[];c.traverse(o=>{if(o!==c&&(!o.visible||Math.max(o.scale.x,o.scale.y,o.scale.z)<.01))hidden.push(o);});for(const o of hidden)o.removeFromParent();c.position.set(0,0,0);c.quaternion.identity();c.scale.set(1,1,1);c.visible=true;out.add(c);}
 else if(slot==='engine'){
  if(kit.style==='f1'||kit.style==='kart'){
   // 순정 차체는 재질별로 합쳐져 있다. 엔진 구역 안의 삼각형만 사진용으로 복사.
   const region=kit.style==='kart'?new T.Box3(new T.Vector3(.20,.14,-1.15),new T.Vector3(.56,.60,-.33)):new T.Box3(new T.Vector3(-.13,.42,-2.18),new T.Vector3(.13,.61,-1.88));
   kit.body.traverse(o=>{if(!o.isMesh||o.userData.partVisual)return;for(let n=o;n;n=n.parent)if(!n.visible)return;if(kit.style==='f1'&&o.material?.color?.getHSL({}).s>.3)return;const pos=o.geometry.attributes.position,idx=o.geometry.index,points=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
    for(let i=0;i<(idx?.count||pos.count);i+=3){a.fromBufferAttribute(pos,idx?idx.getX(i):i).applyMatrix4(o.matrixWorld);b.fromBufferAttribute(pos,idx?idx.getX(i+1):i+1).applyMatrix4(o.matrixWorld);c.fromBufferAttribute(pos,idx?idx.getX(i+2):i+2).applyMatrix4(o.matrixWorld);if(region.containsPoint(a)&&region.containsPoint(b)&&region.containsPoint(c))points.push(...a.toArray(),...b.toArray(),...c.toArray());}
    if(points.length){const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(points,3));geo.computeVertexNormals();const m=new T.Mesh(geo,o.material);m.userData.photoGeometry=true;out.add(m);}
   });return out;
  }
  // 순정 배기처럼 차체와 별도인 작은 금속 메시만 추출한다.
  const b=new T.Box3(),v=new T.Vector3();
  const candidates=[];
  kit.body.traverse(o=>{if(!o.isMesh||o.userData.partVisual)return;for(let n=o;n;n=n.parent)if(!n.visible)return;o.geometry.computeBoundingBox();b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);b.getSize(v);const c=b.getCenter(new T.Vector3());if(c.z<-.45&&v.z<1.9&&v.y<.65&&v.x<1.65&&v.length()<2&&v.length()>.15&&o.material?.metalness>.4)candidates.push({o,volume:v.x*v.y*v.z});});
  // 작은 고정쇠나 다른 장치를 섞지 않고 독립된 주 부품만 꺼낸다.
  const o=candidates.sort((a,b)=>b.volume-a.volume)[0]?.o;
  if(o){const m=o.clone(false);m.matrix.copy(o.matrixWorld);m.matrix.decompose(m.position,m.quaternion,m.scale);out.add(m);}
 }
 return out;
}
// 차고 전용 복사본. 원본의 위치와 자원은 유지하며, 장면이 끝나면 반드시 dispose.
// bigparts (2026-11-15): 부품은 순정 위에 '덧붙는' 장치라(엔진 배기·변속기 하우징·날개 판·선체 장치),
//   교체 장면에서 움직이는 범위 = 실제로 차에서 생기거나 없어지는 그 부품 그룹(part-<칸>)만.
//   순정 칸은 움직일 메시가 없음(빈 group, none=true) → 순정 날개·배기·선체는 그대로 제자리.
//   타이어만 예외: 부품 타이어가 순정 옆면 띠를 바꾸므로 바퀴 하나 전체가 빠지고 들어옴(양쪽 같은 범위).
//   물 모듈의 워터젯은 순정 선외기 2개를 숨기므로(pose), 워터젯이 되는 쪽/풀리는 쪽에서는 선외기도 같이 빠지고 들어옴.
//   other = 반대편(바뀌기 전/후) 부품 look.
export function swapPart(root,slot,look,other){
 let body,kit;root.traverse(o=>{if(photoKits.has(o)){body=o;kit=photoKits.get(o);}});
 const group=new T.Group(),hidden=[];
 const empty={group,none:true,hide(){},restore(){},dispose(){group.removeFromParent();}};
 if(!kit)return empty;
 root.updateMatrixWorld(true);
 const sources=[];
 if(slot==='tire'){const w=kit.wheels.find(w=>w.side>0)?.spin;if(w)sources.push(w);}
 else if(look){const o=root.getObjectByName('part-'+(slot==='aero'&&look.kind==='splitter'?'splitter':slot));if(o)sources.push(o);}
 let motors=false;if(slot==='water'&&look?.hull!=='jet'&&other?.hull==='jet')for(const m of kit.motors||[])if(m.g.visible){sources.push(m.g);motors=true;}
 if(!sources.length)return empty;
 const inv=root.matrixWorld.clone().invert();
 for(const source of sources){
  const c=source.clone(true),drop=[];
  c.traverse(o=>{if(o!==c&&(!o.visible||Math.max(o.scale.x,o.scale.y,o.scale.z)<.01))drop.push(o);});drop.forEach(o=>o.removeFromParent());
  c.position.set(0,0,0);c.quaternion.identity();c.scale.set(1,1,1);c.visible=true;
  const copy=new T.Group();copy.add(c);copy.applyMatrix4(new T.Matrix4().multiplyMatrices(inv,source.matrixWorld));group.add(copy);hidden.push([source,source.visible]);
 }
 group.traverse(o=>{if(o.isMesh){o.geometry=o.geometry.clone();o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();o.castShadow=false;}});
 return {group,none:false,motors,hide(){for(const [o]of hidden)o.visible=false;},restore(){for(const [o,v]of hidden)o.visible=v;},dispose(){group.removeFromParent();group.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}};
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
export async function warmLevelShaders(renderer,scene,camera){
 if(!renderer||!scene||!camera||warmed.has(renderer))return false;warmed.add(renderer);
 const g=levelWarmObjects();scene.add(g);
 try{if(renderer.compileAsync)await renderer.compileAsync(scene,camera);else renderer.compile(scene,camera);}catch{}finally{g.userData.dispose();}
 return true;
}
const LV_GOLD=new T.Color('#c98410'),LV_GOLDGLOW=new T.Color('#3a2402');
/** 칸 그룹 하나를 단계 모양으로: 메시마다 꼭짓점 속성 + 공용 재질 (묶기 전에 부름) */
function styleLevel(g,lv){
 if(!(lv>1))return;const mat=levelMaterial(),acc=new T.Color(LV_ACCENT[Math.min(5,lv)]);
 g.traverse(o=>{
  if(!o.isMesh||!o.material||Array.isArray(o.material)||o.material===mat)return;const m=o.material,geo=o.geometry,n=geo.attributes.position.count;
  const ei=m.emissiveIntensity??1,emL=m.emissive?(m.emissive.r+m.emissive.g+m.emissive.b)*ei/3:0;
  const c=new T.Color().copy(m.color||LV_GOLD),lum=c.r*.3+c.g*.59+c.b*.11;
  let rough=m.roughness??.4,metal=m.metalness??.5,role=emL>.05?1:rough>.85?3:lum<.035&&metal<.75?2:0; // 3 = 고무(그대로)
  const e=new T.Color(0,0,0);if(m.emissive)e.copy(m.emissive).multiplyScalar(ei);
  if(role===1){ // 빛나는 곳: 단계 색으로 물들고 더 밝게
   e.lerp((lv>=5?new T.Color('#ff9f1c'):acc.clone()).multiplyScalar(Math.min(.9,Math.max(.25,emL))),lv>=5?.75:lv>=4?.55:lv>=3?.45:.25).multiplyScalar(1+.08*(lv-1));
   if(lv>=5){c.copy(LV_GOLD).lerp(new T.Color('#ffd25a'),.35);metal=.7;rough=.3;e.add(LV_GOLDGLOW).add(LV_GOLDGLOW);}
  }else if(role===0){
   if(lv>=5){c.copy(LV_GOLD).lerp(m.color||LV_GOLD,.1);metal=.85;rough=.32;e.add(LV_GOLDGLOW);}
   else if(lv>=4){if(lum<.12)role=2;else{c.multiplyScalar(.6).lerp(new T.Color('#2a2f3a'),.3);metal=Math.min(.9,metal+.1);rough=Math.max(.16,rough*.7);}}
   else if(lv>=3){rough=Math.max(.14,rough*.8);metal=Math.min(.95,metal+.05);}
   else rough=Math.max(.16,rough*.9);
  }
  const col=new Float32Array(n*3),rm=new Float32Array(n*3),em=new Float32Array(n*4);
  for(let i=0;i<n;i++){col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;rm[i*3]=rough;rm[i*3+1]=metal;rm[i*3+2]=role;em[i*4]=e.r;em[i*4+1]=e.g;em[i*4+2]=e.b;em[i*4+3]=lv;}
  geo.setAttribute('lvCol',new T.BufferAttribute(col,3));geo.setAttribute('lvRM',new T.BufferAttribute(rm,3));geo.setAttribute('lvEm',new T.BufferAttribute(em,4));
  o.material=mat;
 });
}
/** Lv5 칸들 둘레의 불티 Points 하나 (차체 좌표) */
function levelSparks(body,groups){
 if(!groups.length)return null;body.updateMatrixWorld(true);const inv=body.matrixWorld.clone().invert(),pos=[],seed=[],b=new T.Box3(),q=new T.Box3(),v=new T.Vector3(),s=new T.Vector3();
 let r=1;const rand=()=>{r=(r*16807)%2147483647;return (r-1)/2147483646;};
 for(const g of groups){g.updateMatrixWorld(true);b.makeEmpty();g.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();q.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);b.union(q);});if(b.isEmpty())continue;b.applyMatrix4(inv);b.getSize(s);
  const n=Math.round(Math.min(24,9+s.length()*7));
  for(let i=0;i<n;i++){v.set(b.min.x+rand()*s.x,b.min.y+rand()*s.y*.8,b.min.z+rand()*s.z);pos.push(v.x,v.y,v.z);seed.push(rand(),rand(),rand(),rand());}}
 if(!pos.length)return null;
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('seed',new T.Float32BufferAttribute(seed,4));geo.computeBoundingSphere();
 const pts=new T.Points(geo,sparkMaterial());pts.name='lv5-sparks';pts.frustumCulled=false;pts.renderOrder=4;pts.userData.noBatch=true;pts.userData.partVisual=true;pts.userData.lvSparks=true;
 pts.onBeforeRender=()=>{lvTime.value=performance.now()/1000;};
 return pts;
}
// 순정 날개/앞 범퍼를 차체 좌표가 아닌 해당 그룹의 지역 좌표로 잰다.
function bounds(group){group.updateMatrixWorld(true);const inv=group.matrixWorld.clone().invert(),b=new T.Box3(),q=new T.Box3();group.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();q.copy(o.geometry.boundingBox).applyMatrix4(new T.Matrix4().multiplyMatrices(inv,o.matrixWorld));b.union(q);});return b;}
export function createParts3d({body,spoiler,fWing,hull,wheels,A,M,drs,normalBounds,style}){
 const kitRef={body,spoiler,hull,wheels,style,motors:[],hullY:A.hull?.[1]||1};photoKits.set(body,kitRef);
 const rear=bounds(spoiler),front=bounds(fWing),nodes=[],resources=new Set(),materials=new Set();
 if(drs){drs.updateMatrix();drs.geometry.computeBoundingBox();rear.copy(drs.geometry.boundingBox).applyMatrix4(drs.matrix);}
 const rearSize=rear.getSize(new T.Vector3()),rearCenter=rear.getCenter(new T.Vector3());
 // 날개 그룹 좌표에서 땅 높이(차 원점 y=0): 큰 끝판이 땅에 닿지 않게.
 let top0=spoiler;while(top0.parent)top0=top0.parent;top0.updateMatrixWorld(true);
 const spRel=new T.Matrix4().copy(top0.matrixWorld).invert().multiply(spoiler.matrixWorld),groundY=new T.Vector3(0,0,0).applyMatrix4(spRel.clone().invert()).y;
 const mounts={rear:{width:rearSize.x,y:rear.max.y,z:rearCenter.z},front:{width:front.max.x-front.min.x,y:front.min.y,z:front.max.z}};
 let signature='',jet=false;
 const rearZ=style==='rocket'?-2.51:-normalBounds.back+.09;
 const rearY=Math.max(.20,Math.min(...A.wheels.map(w=>w[3]))*.65);
 mounts.engine={width:.76,y:rearY,z:rearZ};mounts.gearbox={width:.48,y:rearY-.11,z:rearZ};
 const mat=(color,o={})=>new T.MeshStandardMaterial({color,metalness:o.metal??.6,roughness:o.rough??.35,...(o.emissive?{emissive:o.emissive,emissiveIntensity:o.ei??1.4}:{})});
 // 뒷바퀴 안쪽 한계(배기 바깥쪽 끝)와 배기·변속기 중심 높이.
 const inner=Math.min(.64,...A.wheels.filter(w=>!w[2]).map(w=>Math.abs(w[0])-w[4]/2-.04)),lowY=rearY+.03;
 function clear(){for(const g of resources)g.dispose();resources.clear();for(const m of materials)if(!m.userData?.lvShared)m.dispose();materials.clear();for(const g of nodes){g.removeFromParent();}nodes.length=0;}
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
 // ????? ?? ???? ???? ?? ? ?? ???.
 function blockTread(width,r){const g=new T.BufferGeometry(),x=width*.49,z=r*.13,y=.015;g.setAttribute('position',new T.Float32BufferAttribute([-x,0,-z,x,0,-z,x,0,z,-x,0,z,-x,y,-z,x,y,-z,x,y,z,-x,y,z],3));g.setIndex([4,6,5,4,7,6,0,7,4,0,3,7,1,5,6,1,6,2]);g.computeVertexNormals();return g;}
 function setParts(parts={}){
  const next=JSON.stringify(parts||{});if(next===signature)return;signature=next;clear();parts=parts||{};jet=parts.water?.hull==='jet';setWalls(!parts.tire);
  if(parts.tire){const p=parts.tire,mat=new T.MeshStandardMaterial({color:p.sidewall||'#ef3947',roughness:.7});mat.userData.partOwned=true;
   const rubber=new T.MeshStandardMaterial({color:'#24262b',roughness:.92});
   for(let i=0;i<wheels.length;i++){const w=wheels[i],width=A.wheels[i][4],g=group(w.spin,'tire-'+i),side=w.side,r=w.r,t=p.tread;
    mesh(g,new T.RingGeometry(r*(t==='slick'?.84:t==='knob'?.67:.76),r*(t==='slick'?.865:.88),10).rotateY(side*Math.PI/2),mat,side*(width/2+.006),0,0);
    if(t!=='slick'){
     if(t==='drift')mesh(g,new T.RingGeometry(r*.70,r*.79,10).rotateY(side*Math.PI/2),M.metal,side*(width/2+.009),0,0);
     for(let j=0;j<4;j++){const a=j*Math.PI/2;
      const geo=t==='knob'?blockTread(width,r):new T.PlaneGeometry(width*.88,.025).rotateZ(.48);
      geo.rotateX(-Math.PI/2).translate(0,r-.002,0).rotateX(a);mesh(g,geo,t==='knob'?rubber:M.dark);
     }
    }
   }
  }
  // bigparts (2026-11-15, 사용자 "작은 부품이 많아 뭐가 바뀌었는지 모름"): 엔진·변속기·날개·물 모듈을
  //   멀리서도(기본 추격·차고 3D) 보이게 굵고 크게, 차체와 다른 색. 칸마다 삼각형 예산(엔진·변속기·날개·물 각 120 아래) 안.
  //   엔진 배기는 뒷범퍼 양쪽 아래, 변속기는 그 사이 가운데 아래 = 서로 겹치지 않고 운전 시야(가운데 위)에서 멂.
  if(parts.engine){
   const e=parts.engine,n=e.no||1,g=group(body,'engine'),y=lowY,z0=rearZ+.02;
   const glow=mat('#1a0d08',{metal:.2,rough:.6,emissive:e.glow||'#ff6a2a',ei:1.7}),bracket=mat('#2b2f36',{metal:.7,rough:.4});
   if(n===1){
    // 고회전: 가늘고 긴, 위로 솟은 쌍 파이프 + 그을린 티타늄 끝(보라빛) + 붉은 열기.
    const pipe=mat(e.exhaustColor||'#c9d2dc',{metal:.92,rough:.16}),tip=mat('#7b67d8',{metal:.85,rough:.24});
    const r=.1,len=.5,xs=inner-r-.04,tilt=.2,at=(geo,dz)=>geo.translate(0,0,dz).rotateX(tilt);
    for(const s of [-1,1]){
     box(g,.26,.22,.14,bracket,s*xs,y,z0+.03);
     mesh(g,at(new T.CylinderGeometry(r,r,len,8,1,true).rotateX(Math.PI/2),-len/2),pipe,s*xs,y,z0);
     mesh(g,at(new T.CylinderGeometry(r*1.2,r*1.2,.17,8,1,true).rotateX(Math.PI/2),-len+.07),tip,s*xs,y,z0);
     mesh(g,at(new T.CircleGeometry(r*1.02,8).rotateY(Math.PI),-len+.03),glow,s*xs,y,z0);
    }
   }else if(n===2){
    // 저회전 토크: 굵은 사각 파이프 양쪽 2개씩 + 위를 덮는 두꺼운 열 차단판.
    const pipe=mat('#aeb6c1',{metal:.85,rough:.3}),shield=mat(e.exhaustColor||'#3a3d44',{metal:.55,rough:.45});
    const r=.118,len=.34,step=.19,xo=inner-r*.71-.03;
    for(const s of [-1,1]){
     box(g,.44,.24,.14,bracket,s*(xo-step/2),y,z0+.03);
     for(const k of [0,1]){const x=s*(xo-k*step);
      mesh(g,new T.CylinderGeometry(r,r,len,4,1,true).rotateY(Math.PI/4).rotateX(Math.PI/2).translate(0,0,-len/2),pipe,x,y,z0);
      mesh(g,new T.CircleGeometry(r*.84,4).rotateZ(Math.PI/4).rotateY(Math.PI).translate(0,0,-len+.03),glow,x,y,z0);}
     box(g,.44,.05,.32,shield,s*(xo-step/2),y+r*.71+.035,z0-.14);
    }
   }else{
    // 터보: 아주 굵은 원형 청동 파이프 + 나팔처럼 벌어진 끝.
    const pipe=mat(e.exhaustColor||'#8a5a2e',{metal:.8,rough:.3}),lip=mat('#e0aa5c',{metal:.9,rough:.2});
    const r=.14,len=.34,xs=inner-r*1.32-.03;
    for(const s of [-1,1]){
     box(g,.3,.3,.14,bracket,s*xs,y,z0+.03);
     mesh(g,new T.CylinderGeometry(r,r,len,8,1,true).rotateX(Math.PI/2).translate(0,0,-len/2),pipe,s*xs,y,z0);
     mesh(g,new T.CylinderGeometry(r,r*1.32,.13,8,1,true).rotateX(Math.PI/2).translate(0,0,-len-.055),lip,s*xs,y,z0);
     mesh(g,new T.CircleGeometry(r*.96,8).rotateY(Math.PI).translate(0,0,-len+.02),glow,s*xs,y,z0);
    }
   }
  }
  if(parts.gearbox){
   // 변속기: 배기 사이 가운데 아래 6각 하우징. 뒷면 전체가 부품 색(숏 하늘·롱 주황·시퀀셜 빨강), 옆 색 줄.
   const gb=parts.gearbox,n=gb.no||1,g=group(body,'gearbox'),color=gb.color||(n===1?'#4fd1ff':n===2?'#ffb21a':'#ff4f6a');
   const housing=mat('#4a515c',{metal:.75,rough:.32}),accent=mat(color,{metal:.3,rough:.4,emissive:color,ei:.4}),dark=mat('#22262d',{metal:.6,rough:.5});
   const w=n===2?.34:.38,h=n===2?.25:.32,d=n===1?.3:n===2?.52:.4,y=lowY+(n===2?-.01:.02),z=rearZ+.05,k=h/w,tipR=w/2*.88;
   mounts.gearbox={width:w,y,z};
   box(g,w+.06,h+.04,.1,dark,0,y,z+.02);
   mesh(g,new T.CylinderGeometry(w/2,tipR,d,6).rotateX(Math.PI/2).translate(0,0,-d/2).scale(1,k,1),housing,0,y,z);
   mesh(g,new T.CircleGeometry(tipR*.97,6).rotateY(Math.PI).scale(1,k,1),accent,0,y,z-d-.006);
   for(const s of [-1,1])box(g,.03,h*.42,d*.86,accent,s*(w/2*.93+.012),y,z-d/2);
   if(n===1)for(let i=0;i<3;i++)box(g,w*.78,.045,.035,dark,0,y+h/2*.92+.02,z-d*(.22+i*.28));
   else if(n===2)box(g,.07,.05,d*.9,accent,0,y+h/2*.9+.02,z-d/2);
   else{
    const gold=mat('#e6c25a',{metal:.95,rough:.18});
    mesh(g,new T.RingGeometry(tipR*.5,tipR*.78,6).rotateY(Math.PI).scale(1,k,1),gold,0,y,z-d-.012);
    mesh(g,new T.CylinderGeometry(.055,.055,.14,6,1,true).rotateX(Math.PI/2),gold,0,y,z-d-.07);
    for(const s of [-1,1]){const o=box(g,.04,.2,.035,gold,s*(w/2+.03),y,z-d+.08);o.rotation.z=s*.32;}
   }
  }
  const p=parts.aero;if(p&&!rear.isEmpty()){
   const isLip=p.kind==='lip',isSplit=p.kind==='splitter',g=group(isSplit?fWing:spoiler,isSplit?'splitter':'aero');
   if(isSplit){
    // 앞 스플리터: 앞으로 크게 튀어나온 카본 판 + 주황 앞날 + 옆 울타리.
    // 좁고 긴 앞날개(로켓 등)는 운전석에서 보이는 거리라 앞으로 덜 나오게.
    const fw=A.wheels.filter(w=>w[2]),narrow=mounts.front.width<1.3,width=Math.min(2.15,mounts.front.width*1.02,narrow?2*(Math.min(...fw.map(w=>Math.abs(w[0])-w[4]/2))-.06):9),y=front.min.y+.008,z=front.max.z+(narrow?-.12:.06);
    const carbon=mat(p.color||'#20242b',{metal:.4,rough:.35}),edge=mat('#ff6b1f',{metal:.3,rough:.4,emissive:'#ff6b1f',ei:.35});
    box(g,width,.032,.66,carbon,0,y,z);box(g,width,.05,.06,edge,0,y+.01,z+.33);
    for(const s of [-1,1])box(g,.035,.1,.56,carbon,s*(width/2-.02),y+.06,z-.02);
   }else{
    // 낮은 날개(카트 뒤 범퍼 등)는 뒷바퀴 사이 폭까지만 = 끝판이 바퀴에 안 닿게.
    const rw=A.wheels.filter(w=>!w[2]),low=y0=>y0-groundY<2*Math.max(...rw.map(w=>w[3]))+.2;
    const w=Math.min(2.1,rearSize.x,low(rear.max.y)?2*(Math.min(...rw.map(w=>Math.abs(w[0])-w[4]/2))-.06)-.1:9),z=rearCenter.z,y=rear.max.y,dz=rearSize.z;
    if(isLip){
     // 로우 드래그: 날개 뒤로 길게 이어지는 은색 판 + 은색 끝 캡. 위로는 거의 안 솟음(시야).
     const silver=mat(p.color||'#cfd8e3',{metal:.88,rough:.18});
     const blade=box(g,w,.036,.32,silver,0,y-.012,z-dz/2-.1);blade.rotation.x=-.08;
     for(const s of [-1,1])box(g,.045,.13,.46,silver,s*(w/2+.012),y-.05,z-dz/2+.02);
    }else{
     // 하이 다운포스: 뒤쪽 큰 두 번째 판 + 아주 큰 끝판(주황 줄) + 거니 플랩. 위로는 8 cm만 = 추격 시점 가운데 위를 덜 가림.
     const carbon=mat(p.color||'#1b1e24',{metal:.45,rough:.3}),stripe=mat('#ff7a1a',{metal:.3,rough:.4,emissive:'#ff7a1a',ei:.4});
     // 높은 날개(지붕·GT)는 두 번째 판을 아래쪽 뒤로 = 추격 카메라에서 가운데 위로 솟아 보이지 않게.
     const hi=y-groundY>1.2,by=hi?y-.11:y-.005;
     const blade=box(g,w,.045,.36,carbon,0,by,z-dz/2-.1);blade.rotation.x=.26;
     const top=hi?y+.01:y+.08,eh=Math.max(.2,Math.min(.56,top-groundY-.16)),ed=Math.max(.62,dz+.44);
     for(const s of [-1,1]){box(g,.04,eh,ed,carbon,s*(w/2+.024),top-eh/2,z-.14);box(g,.05,.07,ed,stripe,s*(w/2+.028),top-.03,z-.14);}
     box(g,w,.04,.04,stripe,0,by+.067,z-dz/2-.27);
    }
   }
  }
  const water=parts.water;if(water){const g=group(hull,'water');
   if(water.hull==='deepv'){
    // 딥V: 아래로 깊은 금속 용골 + 양옆 아래로 꺾인 보라 카빙 핀 + 고물 세움 핀.
    const fin=mat('#9a5cff',{metal:.4,rough:.35,emissive:'#9a5cff',ei:.22}),steel=mat('#c8ced8',{metal:.85,rough:.25});
    const pos=[],idx=[];for(const [z,w,d]of [[2.3,.01,.16],[.8,.15,.5],[-2.3,.15,.42]])pos.push(-w,-.14,z,w,-.14,z,0,-d,z);
    for(let i=0;i<2;i++)for(let j=0;j<3;j++){const a=i*3+j,b=i*3+(j+1)%3;idx.push(a,a+3,b,b,a+3,b+3);}idx.push(0,1,2,6,8,7);
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();mesh(g,geo,steel);
    for(const s of [-1,1]){const f=box(g,.32,.045,3.6,fin,s*1.22,.2,.1);f.rotation.z=-s*.35;box(g,.045,.3,.55,fin,s*1.06,.36,-2.15);}
   }else if(water.hull==='jet'){
    // 워터젯: 굵은 쌍 노즐(파란 분사 빛) + 갑판 위 주황 흡기 혹.
    const pod=mat('#ff8a1f',{metal:.45,rough:.35}),dark=mat('#23272e',{metal:.7,rough:.35}),jet=mat('#0c1b22',{metal:.2,rough:.6,emissive:'#4fe0ff',ei:1.5});
    for(const s of [-1,1]){
     mesh(g,new T.CylinderGeometry(.24,.2,.5,8,1,true).rotateX(Math.PI/2),dark,s*.68,.18,-2.9);
     mesh(g,new T.RingGeometry(.12,.205,8).rotateY(Math.PI),pod,s*.68,.18,-3.152);
     mesh(g,new T.CircleGeometry(.125,8).rotateY(Math.PI),jet,s*.68,.18,-3.14);
     box(g,.36,.14,.9,pod,s*.66,.62,-2.05);
    }
   }else{
    // 플레이닝: 선체 바깥 넓은 하늘색 스폰슨(앞이 비스듬) + 연결대 + 물 끊는 계단.
    const c=mat('#29c6ff',{metal:.35,rough:.35,emissive:'#29c6ff',ei:.15}),d=mat('#262b33',{metal:.5,rough:.5});
    for(const s of [-1,1]){
     const geo=new T.BoxGeometry(.34,.16,4.3),a=geo.attributes.position;for(let i=0;i<a.count;i++)if(a.getZ(i)>0&&a.getY(i)<0)a.setZ(i,a.getZ(i)-.45);geo.computeVertexNormals();
     mesh(g,geo,c,s*1.34,.16,.05);box(g,.4,.12,.7,d,s*1.17,.22,-.35);box(g,.36,.04,.14,d,s*1.34,.25,-.95);
    }
   }
  }
  // 교체 그룹 안에서 먼저 PBR로 합치고 바깥 묶음으로부터 보호한다.
  // upgradeD1: 칸마다 강화 단계 모양 (묶기 전), Lv5 칸이 있으면 불티 하나
  const lvOf=g=>{const n=g.name.slice(5),slot=n.startsWith('tire')?'tire':n==='splitter'?'aero':n;return Math.max(1,Math.min(5,Math.floor(Number(parts[slot]?.lv)||1)));};
  for(const g of [...nodes])styleLevel(g,lvOf(g));
  {const fx=levelSparks(body,nodes.filter(g=>lvOf(g)>=5&&!g.name.startsWith('part-water')));if(fx){body.add(fx);nodes.push(fx);resources.add(fx.geometry);}}
  for(const g of nodes){const collect=()=>g.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material&&!o.material.userData.pbrBake&&!Object.values(M).includes(o.material))materials.add(o.material);});collect();g.userData.noBatch=false;batchLocal(g,{pbr:true});collect();g.traverse(o=>{o.userData.noBatch=true;});}
 }
 return {setParts,dispose(){clear();for(const w of wheels)if(w.wall)w.wall.visible=true;},mounts,pose(motors){kitRef.motors=motors;if(jet)for(const m of motors)m.g.visible=false;}};
}
