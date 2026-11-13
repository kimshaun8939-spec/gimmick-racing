// 실행 중 만든 실제 모델에서 읽는 기본/가속 외형. +z 앞, +y 위, normal은 b→a.
import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { createCarModel, normalizeLook } from './carModel.js';
const profiles=new Map(), objects=new WeakMap(), DEFAULT_LOOK={};
const EPS=1e-7, UP=new THREE.Vector3(0,1,0), Z=new THREE.Vector3(0,0,1);
const clamp=x=>Math.max(0,Math.min(1,x));
function hull3(points){
  if(points.length<4)return points;
  const hull=new ConvexHull().setFromPoints(points), set=new Set();
  for(const f of hull.faces){let e=f.edge;do{set.add(e.head().point);e=e.next;}while(e!==f.edge);}
  return [...set];
}
function convex(points){
  const p=points.map(v=>[v.x,v.z]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=a=>{const h=[];for(const v of a){while(h.length>1&&cross(h[h.length-2],h[h.length-1],v)<=1e-10)h.pop();h.push(v);}h.pop();return h;};
  return [...half(p),...half([...p].reverse())];
}
function bounds(points,padding=0){
  const b=new THREE.Box3().setFromPoints(points),raw=convex(points);
  const hull=padding?raw.map((p,i)=>{
    const prev=raw[(i+raw.length-1)%raw.length],next=raw[(i+1)%raw.length];
    const ax=p[0]-prev[0],az=p[1]-prev[1],al=Math.hypot(ax,az),bx=next[0]-p[0],bz=next[1]-p[1],bl=Math.hypot(bx,bz);
    const n1=[az/al,-ax/al],n2=[bz/bl,-bx/bl],d=Math.max(.001,1+n1[0]*n2[0]+n1[1]*n2[1]);
    return [p[0]+padding*(n1[0]+n2[0])/d,p[1]+padding*(n1[1]+n2[1])/d];
  }):raw;
  return {front:b.max.z+padding,back:-b.min.z+padding,half:Math.max(-b.min.x,b.max.x)+padding,bottom:b.min.y-padding,height:b.max.y-b.min.y+2*padding,points,hull};
}
function profileFor(source){
  const cfg=source.cfg||source;
  const input=cfg.look||source.look||(typeof cfg==='string'||cfg.style||typeof cfg.body==='string'||cfg.costume?cfg:DEFAULT_LOOK);
  const stamp=typeof input==='object'?Object.values(input).join('|'):input;
  const cached=objects.get(source);if(cached?.input===input&&cached.stamp===stamp)return cached.pr;
  const look=normalizeLook(input);
  const key=JSON.stringify(Object.keys(look).sort().map(k=>[k,look[k]]));
  let pr=profiles.get(key);
  if(!pr){
    const model=createCarModel(look), frames=new Map();
    pr={key,info:model.collisionInfo,frames,frame(i){
      i=Math.max(0,Math.min(64,i));if(frames.has(i))return frames.get(i);
      const groups=model.measureHitbox(i/64).map(g=>({...g,points:hull3(g.points)}));
      const value={groups,...bounds(groups.flatMap(g=>g.points))};frames.set(i,value);if(frames.size===65)model.dispose();return value;
    }};
    pr.normal=pr.frame(0);pr.accel=pr.frame(64);pr.first=pr.frame(1);
    pr.clearTime=Math.max(.1,...pr.first.points.map(v=>v.distanceTo(insideNormal(v,pr.normal))/2));
    profiles.set(key,pr);
  }
  if(source&&typeof source==='object')objects.set(source,{pr,input,stamp});
  return pr;
}
// 처음 보일 때 이미 펼쳐져 있는 부품은 주변 물체를 밀어낼 여유를 먼저 만든다.
function insideNormal(v,h){
  let t=1;for(let i=0;i<h.hull.length;i++){
    const a=h.hull[i],b=h.hull[(i+1)%h.hull.length],nx=b[1]-a[1],nz=a[0]-b[0],limit=nx*a[0]+nz*a[1],d=nx*v.x+nz*v.z;
    if(d>limit&&d>0)t=Math.min(t,limit/d);
  }
  return new THREE.Vector3(v.x*t,THREE.MathUtils.clamp(v.y,h.bottom,h.bottom+h.height),v.z*t);
}
function reserveProfile(pr){
  if(pr.reserve)return;
  const frames=[0,1,8,16,24,32,40,48,56,64].map(i=>pr.frame(i));
  const groups=frames[0].groups.map((g,i)=>({...g,points:hull3(frames.flatMap(f=>f.groups[i]?.points||[]))}));
  pr.reserve={groups,...bounds(groups.flatMap(g=>g.points))};
  pr.clearTime=Math.max(.1,...pr.reserve.points.map(v=>v.distanceTo(insideNormal(v,pr.normal))/2));
}
function needsClearance(c,pr){
  reserveProfile(pr);
  const radius=Math.hypot(Math.max(pr.reserve.front,pr.reserve.back),pr.reserve.half);
  if(c._hitboxPeers?.some(other=>other!==c&&other.pos.distanceToSquared(c.pos)<(radius+Math.hypot(Math.max(profileFor(other).accel.front,profileFor(other).accel.back),profileFor(other).accel.half))**2))return true;
  if(!c.track||!c.grounded)return false;
  const ti=c.track.nearest(c.pos),lim=c.track.railLimit?.(ti),b=basis(c);
  if(lim!=null&&Math.abs(ti.lateral)<lim+1&&Math.abs(c.pos.y-ti.sample.pos.y)<4){
    const sg=Math.sign(ti.lateral)||1,r=ti.sample.right;
    const reach=Math.max(...pr.reserve.points.map(v=>sg*(v.x*b.right.dot(r)+v.z*b.fwd.dot(r))));
    if(Math.abs(ti.lateral)+reach>lim-.05)return true;
  }
  if(c.track.castRay)for(const [x,z]of pr.reserve.hull){
    const dir=b.right.clone().multiplyScalar(x).addScaledVector(b.fwd,z),far=dir.length();dir.divideScalar(far);
    const hit=c.track.castRay(c.pos.clone().addScaledVector(c.up,.6),dir,far+.01);
    if(hit&&hit.normal.dot(c.up)<.5)return true;
  }
  return false;
}
// 모델·벽·차끼리 접촉·AI가 같은 물리 시간을 공유. 온라인은 받은 모드를 dt로 보간.
export function advanceHitbox(car,dt=0){
  const pr=profileFor(car);let s=car._hitboxState;
  if(!s){s=car._hitboxState={p:0,lean:0,pitch:0,leanV:0,pitchV:0,drift:0,t:car.simT??0,pr,pre:0,lastMode:Number.isFinite(car.simT)?car.mode:'normal'};}
  if(s.pr!==pr){s.pr=pr;s.box=null;if(s.reserved)reserveProfile(pr);}
  if(Number.isFinite(car.simT)){dt=Math.max(0,Math.min(.1,car.simT-s.t));s.t=car.simT;}
  if(dt>0){
    if(car.mode==='accel'&&s.lastMode!=='accel'&&s.p===0){
      s.reserved=needsClearance(car,pr);if(s.reserved)reserveProfile(pr);s.pre=s.reserved?0:1;
    }
    s.lastMode=car.mode;
    if(car.mode==='accel'&&(s.pre??1)<1){s.pre=Math.min(1,s.pre+dt/pr.clearTime);s.p=0;}
    else {
    s.p=Number.isFinite(car.hitboxProgress)?clamp(car.hitboxProgress):clamp(s.p+(car.mode==='accel'?dt/pr.info.duration:-dt/(pr.info.duration*.82)));
    if(car.mode!=='accel'&&s.p===0)s.pre=Math.max(0,(s.pre||0)-dt/pr.clearTime);
    }
    const feel=car.cfg?.feel||{}, hasG=typeof car.latG==='number';
    const lean=!car.grounded||car.flying||car.mode==='boat'?0:hasG?THREE.MathUtils.clamp(car.latG/17,-1.4,1.4)*pr.info.lean*(feel.roll??1)*(car.drifting?1.3:1):(car.steerVisual||0)*Math.min(1,Math.abs(car.forwardSpeed||0)/30)*pr.info.lean*(car.drifting?1.8:1);
    const pitch=!car.grounded||car.flying?THREE.MathUtils.clamp(-(car.vel?.dot(car.up)||0)*.015,-.3,.3):hasG?THREE.MathUtils.clamp(-car.lonG/17,-1,1.4)*pr.info.pitch*(feel.pitch??1):-(car.load||0)*.03;
    const k=feel.spring??90,c=(feel.damp??.6)*2*Math.sqrt(k),h=Math.min(dt,1/30);
    s.leanV+=(k*(lean-s.lean)-c*s.leanV)*h;s.lean+=s.leanV*h;
    s.pitchV+=(k*(pitch-s.pitch)-c*s.pitchV)*h;s.pitch+=s.pitchV*h;
    s.drift=THREE.MathUtils.lerp(s.drift,car.drifting?(car.driftDir||0)*-.15:0,1-Math.exp(-8*dt));
    s.box=null;
  }
  s.display=publishDisplay;
  return s;
}
/** 실측 꼭짓점의 볼록한 바깥 윤곽. 모든 단단한 부품을 감싸고 상자의 빈 모서리는 뺀다. */
export function hitboxFor(source={}){
  if(source._displayHitbox)return source._displayHitbox;
  const pr=profileFor(source);
  if(!source.pos)return source.normalBounds||pr.normal;
  const s=advanceHitbox(source),steer=source.steerVisual||0;
  if(s.box&&s.steer===steer&&s.boxMode===source.mode)return s.box;
  s.steer=steer;s.boxMode=source.mode;
  // 가까운 두 자세를 감싼다. 역변신도 같은 곡선, 전개 때 잠시 넘치는 움직임도 실측.
  const groundMode=source.mode!=='boat'&&source.mode!=='fly';
  const p=groundMode?s.p:0,at=p*64;
  const a=pr.frame(Math.floor(at)), b=pr.frame(Math.ceil(at));
  const points=[],q=new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch,0,-s.lean)),drift=new THREE.Quaternion().setFromAxisAngle(UP,s.drift),wq=new THREE.Quaternion();
  const preparing=groundMode&&s.reserved&&(s.pre||0)>0&&s.p<1;
  const frames=a===b?[a]:[a,b];
  if(preparing)frames.push({groups:pr.reserve.groups.map(g=>({...g,points:g.points.map(v=>insideNormal(v,pr.normal).lerp(v,s.pre))}))});
  for(const f of frames)for(const g of f.groups){
    wq.setFromAxisAngle(UP,g.front?-steer*.42:0);
    for(const v of g.points){const x=v.clone().sub(g.pivot).applyQuaternion(g.wheel?wq:q).add(g.pivot).applyQuaternion(drift);points.push(x);}
  }
  // 타이어 회전/가느다란 회전 부품의 꼭짓점 사이 오차만 감싸는 8 mm 접촉 여유.
  s.box=bounds(points,.008);return s.box;
}
function basis(c){
  const up=(c.up||UP).clone().normalize();if(up.lengthSq()<EPS)up.copy(UP);
  const fwd=(c.fwd||Z).clone().projectOnPlane(up);
  if(fwd.lengthSq()<EPS)fwd.copy(Z).projectOnPlane(up);
  if(fwd.lengthSq()<EPS)fwd.set(1,0,0).projectOnPlane(up);
  fwd.normalize();return {up,fwd,right:new THREE.Vector3().crossVectors(up,fwd).normalize()};
}
export function hitboxCorners(car){const h=hitboxFor(car),b=basis(car),out=[];for(const y of[h.bottom,h.bottom+h.height])for(const z of[-h.back,h.front])for(const x of[-h.half,h.half])out.push(car.pos.clone().addScaledVector(b.right,x).addScaledVector(b.fwd,z).addScaledVector(b.up,y));return out;}
export function hitboxOutline(car){const b=basis(car),h=hitboxFor(car);return h.hull.map(([x,z])=>car.pos.clone().addScaledVector(b.right,x).addScaledVector(b.fwd,z));}
function project(car,up){
  const b=basis(car),h=hitboxFor(car),points=[];let low=Infinity,high=-Infinity;
  // 실제 외곽을 높이 방향으로 감싼 기둥. 기울어진 차도 수평 투영을 빠뜨리지 않는다.
  for(const [x,z] of h.hull)for(const y of [h.bottom,h.bottom+h.height]){
    const v=car.pos.clone().addScaledVector(b.right,x).addScaledVector(b.up,y).addScaledVector(b.fwd,z);
    points.push(v);const d=v.dot(up);low=Math.min(low,d);high=Math.max(high,d);
  }
  return {points,low,high};
}
// SAT에 쓴 같은 볼록 외곽을 잘라 실제 겹친 영역의 가운데를 돌려준다.
function overlapPoint(pa,pb,x,z,up,low,high,fallback){
  let poly=pa;
  for(let i=0;i<pb.length&&poly.length;i++){
    const a=pb[i],b=pb[(i+1)%pb.length],dx=b[0]-a[0],dz=b[1]-a[1],input=poly;poly=[];
    const distance=p=>(p[0]-a[0])*dz-(p[1]-a[1])*dx;
    for(let j=0;j<input.length;j++){
      const p=input[j],q=input[(j+1)%input.length],dp=distance(p),dq=distance(q);
      if(dp<=EPS)poly.push(p);
      if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq);poly.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    }
  }
  if(!poly.length)return fallback;
  let px=0,pz=0;for(const p of poly){px+=p[0];pz+=p[1];}
  return x.clone().multiplyScalar(px/poly.length).addScaledVector(z,pz/poly.length).addScaledVector(up,(low+high)*.5);
}
export function obbOverlap(a,b){
  const ba=basis(a),bb=basis(b),up=ba.up.clone().add(bb.up);if(up.lengthSq()<EPS)up.copy(ba.up);up.normalize();
  const ra=project(a,up),rb=project(b,up),miss=()=>({hit:false,depth:0,normal:null,point:null});
  if(ra.high<rb.low-EPS||rb.high<ra.low-EPS)return miss();
  const x=ba.right.clone().projectOnPlane(up);
  if(x.lengthSq()<EPS)x.copy(ba.fwd).projectOnPlane(up);x.normalize();
  const z=new THREE.Vector3().crossVectors(x,up).normalize();
  const poly=r=>convex(r.points.map(v=>new THREE.Vector3(v.dot(x),0,v.dot(z))));
  const pa=poly(ra),pb=poly(rb);let depth=Infinity,normal=null;
  for(const polygon of[pa,pb])for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length],dx=q[0]-p[0],dz=q[1]-p[1],len=Math.hypot(dx,dz);if(len<EPS)continue;
    const nx=-dz/len,nz=dx/len;let alo=Infinity,ahi=-Infinity,blo=Infinity,bhi=-Infinity;
    // 축마다 임시 숫자 배열을 만들지 않아 8대 접전 때의 가비지 생성을 줄인다.
    for(const p of pa){const v=p[0]*nx+p[1]*nz;alo=Math.min(alo,v);ahi=Math.max(ahi,v);}
    for(const p of pb){const v=p[0]*nx+p[1]*nz;blo=Math.min(blo,v);bhi=Math.max(bhi,v);}
    if(ahi<blo-EPS||bhi<alo-EPS)return miss();
    // 한 윤곽이 다른 윤곽을 포함해도 완전히 분리되는 거리.
    const plus=bhi-alo,minus=ahi-blo,d=Math.min(plus,minus);
    if(d<depth){depth=Math.max(0,d);normal=x.clone().multiplyScalar(nx).addScaledVector(z,nz).multiplyScalar(plus<minus?1:-1);}
  }
  return {hit:true,depth,normal,point:overlapPoint(pa,pb,x,z,up,Math.max(ra.low,rb.low),Math.min(ra.high,rb.high),a.pos.clone().add(b.pos).multiplyScalar(.5))};
}

/** 변신 확장/위치 분리로 생긴 벽 침범은 위치만 보정. 충격·afterImpact 없음. */
export function constrainHitbox(c) {
  if(!c.grounded||c.flying||!c.track)return;
  const h=hitboxFor(c),s=c._hitboxState;
  const growth=s.wallP!==s.p||s.wallPre!==s.pre;s.wallP=s.p;s.wallPre=s.pre;
  if(!growth&&!c._hitboxMoved)return;
  c._hitboxMoved=false;
  let ti=c.track.nearest(c.pos),lim=c.track.railLimit?.(ti);
  if(lim!=null&&Math.abs(ti.lateral)<=lim+1&&Math.abs(c.pos.y-ti.sample.pos.y)<4){
    const b=basis(c),sg=Math.sign(ti.lateral)||1,r=ti.sample.right;
    let reach=-Infinity;for(const v of h.points)reach=Math.max(reach,sg*(v.x*b.right.dot(r)+v.y*b.up.dot(r)+v.z*b.fwd.dot(r)));
    const excess=Math.abs(ti.lateral)+reach-(lim-.05);
    if(excess>0)c.pos.addScaledVector(r,-sg*excess);
  }
  const b=basis(c),org=c.pos.clone().addScaledVector(c.up,.6);
  // 외곽 꼭짓점 방향도 검사해 가운데 한 줄이 놓치는 얇은 벽 끝을 찾는다.
  for(const [x,z] of h.hull){
    const dir=b.right.clone().multiplyScalar(x).addScaledVector(b.fwd,z),reach=dir.length();if(reach<EPS)continue;dir.divideScalar(reach);
    const hit=c.track.castRay(org,dir,reach+.003);if(!hit||hit.normal.dot(c.up)>=.5)continue;
    const inward=-dir.dot(hit.normal);if(inward<.2||hit.distance>reach)continue;
    const depth=(reach-hit.distance+.003)*inward;
    c.pos.addScaledVector(hit.normal,depth);org.addScaledVector(hit.normal,depth);
  }
  c.trackInfo=c.track.nearest(c.pos);
}

// 표시 보간과 root의 방향 보간 뒤에도 실측 외곽을 한 번 더 분리한다.
let displayTime=null,displayCars=[];
function publishDisplay(model,car,time){
  if(displayTime!==time){displayTime=time;displayCars=[];}
  if(car.mode==='boat'||car.mode==='fly')return; // 기존 배/비행 크기 유지
  const h=hitboxFor(car),undo=new THREE.Quaternion().setFromAxisAngle(UP,-(car._hitboxState?.drift||0));
  const points=h.points.map(v=>v.clone().applyQuaternion(undo));
  const root=model.root;
  const v={pos:root.position.clone(),up:UP.clone().applyQuaternion(root.quaternion),fwd:Z.clone().applyQuaternion(root.quaternion),_displayHitbox:bounds(points,.008),root,remote:!car.cfg};
  // LOD 복귀 때 같은 모델을 한 프레임에 두 번 sync해도 자기 자신과 충돌하지 않는다.
  displayCars=displayCars.filter(other=>other.root!==root);
  displayCars.push(v);
  for(let pass=0;pass<32;pass++){
    let max=0;for(let i=0;i<displayCars.length;i++)for(let j=i+1;j<displayCars.length;j++){
      const a=displayCars[i],b=displayCars[j];if(a.remote&&b.remote||a.pos.distanceToSquared(b.pos)>144)continue;
      const c=obbOverlap(a,b);if(!c.hit||c.depth<.0001)continue;max=Math.max(max,c.depth);
      const share=a.remote?0:b.remote?1:.5,d=c.depth+.002;
      a.pos.addScaledVector(c.normal,d*share);b.pos.addScaledVector(c.normal,-d*(1-share));
    }
    if(max<.0001)break;
  }
  for(const v of displayCars){v.root.position.copy(v.pos);v.root.updateMatrixWorld(true);}
}
