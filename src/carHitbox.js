// 실행 중 만든 실제 모델에서 읽는 기본/가속 외형. +z 앞, +y 위, normal은 b→a.
import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { createCarModel, normalizeLook } from './carModel.js';
const profiles=new Map(), objects=new WeakMap(), DEFAULT_LOOK={};
const EPS=1e-7, UP=new THREE.Vector3(0,1,0), Z=new THREE.Vector3(0,0,1);
const clamp=x=>Math.max(0,Math.min(1,x));
// 바퀴는 y축으로만 조향한다. x/z 외곽과 y 최솟값/최댓값을 만드는
// 실제 꼭짓점만 먼저 계산해도 최종 2D 외곽/높이는 완전히 같다.
const keepGroup=g=>g;
function wheelOutline(g){
  if(!g.wheel)return g;
  const outline=convex(g.points),keep=new Set();
  for(const [x,z]of outline)keep.add(g.points.find(v=>v.x===x&&v.z===z));
  let low=g.points[0],high=low;for(const v of g.points){if(v.y<low.y)low=v;if(v.y>high.y)high=v;}
  keep.add(low);keep.add(high);return {...g,outline:[...keep]};
}
function hull3(points){
  if(points.length<4)return points;
  const hull=new ConvexHull().setFromPoints(points), set=new Set();
  for(const f of hull.faces){let e=f.edge;do{set.add(e.head().point);e=e.next;}while(e!==f.edge);}
  return [...set];
}
function convex(points){
  return convexPairs(points.map(v=>[v.x,v.z]));
}
const compare2=(a,b)=>a[0]-b[0]||a[1]-b[1];
function convexPairs(p,ordered=false){
  if(!ordered)p.sort(compare2);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=a=>{const h=[];for(const v of a){while(h.length>1&&cross(h[h.length-2],h[h.length-1],v)<=1e-10)h.pop();h.push(v);}h.pop();return h;};
  return [...half(p),...half([...p].reverse())];
}
// 바뀐 자세에서도 직전 x/z 정렬 순서는 거의 같다. 삽입 정렬로 순서만 고쳐
// 같은 단조 체인 외곽을 만든다(양자화/외곽 근사 없음). 작업 배열만 재사용한다.
function movingConvex(points,work){
  const n=points.length,order=work.order||(work.order=[]),stack=work.stack||(work.stack=[]);
  if(order.length!==n){order.length=n;for(let i=0;i<n;i++)order[i]=i;}
  for(let i=1;i<n;i++){
    const index=order[i],p=points[index];let j=i;
    while(j>0){const q=points[order[j-1]];if(q.x<p.x||q.x===p.x&&q.z<=p.z)break;order[j]=order[j-1];j--;}
    order[j]=index;
  }
  let k=0;
  for(let i=0;i<n;i++){
    const c=points[order[i]];
    while(k>1){const a=stack[k-2],b=stack[k-1];if((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x)>1e-10)break;k--;}
    stack[k++]=c;
  }
  const lower=k; // 마지막 점은 상/하 반쪽이 공유한다.
  for(let i=n-2;i>=0;i--){
    const c=points[order[i]];
    while(k>lower){const a=stack[k-2],b=stack[k-1];if((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x)>1e-10)break;k--;}
    stack[k++]=c;
  }
  const hull=[];for(let i=0;i<k-1;i++)hull.push([stack[i].x,stack[i].z]);return hull;
}
function bounds(points,padding=0,work){
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const p of points){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
  const raw=work?movingConvex(points,work):convex(points);
  const hull=padding?raw.map((p,i)=>{
    const prev=raw[(i+raw.length-1)%raw.length],next=raw[(i+1)%raw.length];
    const ax=p[0]-prev[0],az=p[1]-prev[1],al=Math.hypot(ax,az),bx=next[0]-p[0],bz=next[1]-p[1],bl=Math.hypot(bx,bz);
    const n1=[az/al,-ax/al],n2=[bz/bl,-bx/bl],d=Math.max(.001,1+n1[0]*n2[0]+n1[1]*n2[1]);
    return [p[0]+padding*(n1[0]+n2[0])/d,p[1]+padding*(n1[1]+n2[1])/d];
  }):raw;
  return {front:maxZ+padding,back:-minZ+padding,half:Math.max(-minX,maxX)+padding,bottom:minY-padding,height:maxY-minY+2*padding,points,hull,rawHull:raw};
}
function profileFor(source){
  const cfg=source.cfg||source;
  const input=cfg.look||source.look||(typeof cfg==='string'||cfg.style||typeof cfg.body==='string'||cfg.costume?cfg:DEFAULT_LOOK);
  const cached=objects.get(source);
  if(cached?.input===input){
    let same=true,count=0;
    if(input&&typeof input==='object'){for(const k in input)if(Object.hasOwn(input,k)){count++;if(cached.values[k]!==input[k]){same=false;break;}}if(count!==cached.count)same=false;}
    if(same)return cached.pr;
  }
  const look=normalizeLook(input);
  const key=JSON.stringify(Object.keys(look).sort().map(k=>[k,look[k]]));
  let pr=profiles.get(key);
  if(!pr){
    const model=createCarModel(look), frames=new Map();
    pr={key,info:model.collisionInfo,frames,frame(i){
      i=Math.max(0,Math.min(64,i));if(frames.has(i))return frames.get(i);
      const groups=model.measureHitbox(i/64).map(g=>wheelOutline({...g,points:hull3(g.points)}));
      const value={groups,...bounds(groups.flatMap(g=>g.points))};frames.set(i,value);if(frames.size===65)model.dispose();return value;
    }};
    pr.normal=pr.frame(0);pr.accel=pr.frame(64);pr.first=pr.frame(1);
    pr.clearTime=Math.max(.1,...pr.first.points.map(v=>v.distanceTo(insideNormal(v,pr.normal))/2));
    profiles.set(key,pr);
  }
  if(source&&typeof source==='object')objects.set(source,{pr,input,values:input&&typeof input==='object'?{...input}:null,count:input&&typeof input==='object'?Object.keys(input).length:0});
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
  const groups=frames[0].groups.map((g,i)=>({wheel:g.wheel,front:g.front,pivot:g.pivot,points:hull3(frames.flatMap(f=>f.groups[i]?.points||[]))}));
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
export function advanceHitbox(car,dt=0){return advanceState(car,profileFor(car),dt);}
function advanceState(car,pr,dt=0){
  let s=car._hitboxState;
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
  }
  s.display=publishDisplay;
  return s;
}
/** 실측 꼭짓점의 볼록한 바깥 윤곽. 모든 단단한 부품을 감싸고 상자의 빈 모서리는 뺀다. */
export function hitboxFor(source={}){
  if(source._displayHitbox)return source._displayHitbox;
  const pr=profileFor(source);
  if(!source.pos)return source.normalBounds||pr.normal;
  const s=advanceState(source,pr),steer=source.steerVisual||0;
  if(s.box&&s.steer===steer&&s.boxMode===source.mode&&s.boxP===s.p&&s.boxPre===s.pre&&s.boxLean===s.lean&&s.boxPitch===s.pitch&&s.boxDrift===s.drift&&s.boxReserved===s.reserved)return s.box;
  s.steer=steer;s.boxMode=source.mode;s.boxP=s.p;s.boxPre=s.pre;s.boxLean=s.lean;s.boxPitch=s.pitch;s.boxDrift=s.drift;s.boxReserved=s.reserved;
  // 가까운 두 자세를 감싼다. 역변신도 같은 곡선, 전개 때 잠시 넘치는 움직임도 실측.
  const groundMode=source.mode!=='boat'&&source.mode!=='fly';
  const p=groundMode?s.p:0,at=p*64;
  const a=pr.frame(Math.floor(at)), b=pr.frame(Math.ceil(at));
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch,0,-s.lean)),drift=new THREE.Quaternion().setFromAxisAngle(UP,s.drift);
  const preparing=groundMode&&s.reserved&&(s.pre||0)>0&&s.p<1;
  const frames=a===b?[a]:[a,b],pre=s.pre,driftAngle=s.drift;
  if(preparing){
    // 최대 여유를 확보한 뒤의 전개/역변신은 같은 준비 외곽이다.
    // 안쪽으로 접은 시작점도 실측 프로필에 한 번만 계산한다.
    if(!pr.reserve.starts)pr.reserve.starts=pr.reserve.groups.map(g=>g.points.map(v=>insideNormal(v,pr.normal)));
    let reserve=pre===1?pr.prepared:null;
    if(!reserve){reserve={groups:pr.reserve.groups.map((g,i)=>(pre===1?wheelOutline:keepGroup)({...g,points:g.points.map((v,j)=>pr.reserve.starts[i][j].clone().lerp(v,pre))}))};if(pre===1)pr.prepared=reserve;}
    frames.push(reserve);
  }
  const transform=full=>{
    const points=[],wq=new THREE.Quaternion();
    for(const f of frames)for(const g of f.groups){
      wq.setFromAxisAngle(UP,g.front?-steer*.42:0);
      if(!full&&g.outline){
        // 뒤 바퀴는 변신 단계 안에서 고정, 앞 바퀴도 조향이 같으면 같은 점.
        // 캐시는 그룹당 마지막 각도 하나뿐이라 주행 시간만큼 늘어나지 않는다.
        const angle=g.front?steer:0;
        if(g.cachedSteer!==angle){g.cachedSteer=angle;g.steered=g.outline.map(v=>v.clone().sub(g.pivot).applyQuaternion(wq).add(g.pivot));}
        for(const v of g.steered)points.push(driftAngle===0?v:v.clone().applyQuaternion(drift));
      }else for(const v of g.points){const x=v.clone().sub(g.pivot).applyQuaternion(g.wheel?wq:q).add(g.pivot);if(driftAngle!==0)x.applyQuaternion(drift);points.push(x);}
    }
    return points;
  };
  // 기존 points API를 읽을 때만 전체 3D 점을 만든다. 차량 SAT/AI는 축약한
  // 바퀴 외곽으로 같은 결과를 얻는다. 반환된 배열은 다음 스텝에 덮어쓰지 않는다.
  const points=transform(false),box=bounds(points,.008,s.hullWork||(s.hullWork={}));
  let fullPoints;Object.defineProperty(box,'points',{get(){return fullPoints||(fullPoints=transform(true));}});
  box.support=(axis,sign=1)=>{
    let max=-Infinity;
    const take=v=>{max=Math.max(max,sign*(v.x*axis.x+v.y*axis.y+v.z*axis.z));};
    if(fullPoints){for(const v of fullPoints)take(v);return max;}
    const v=new THREE.Vector3(),wq=new THREE.Quaternion();
    for(const f of frames)for(const g of f.groups){
      wq.setFromAxisAngle(UP,g.front?-steer*.42:0);
      for(const point of g.points){v.copy(point).sub(g.pivot).applyQuaternion(g.wheel?wq:q).add(g.pivot);if(driftAngle!==0)v.applyQuaternion(drift);take(v);}
    }
    return max;
  };
  s.box=box;return box;
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
// 외곽 기둥의 위/아래 면은 각각 순서가 있는 볼록 다각형이다.
// 네 개의 단조 체인을 합쳐 x/z 순서를 O(n)에 얻는다. 경사도 동일한
// 원래 투영 점/단조 체인을 쓰며, 수치상 순서가 깨진 경우에만 일반 경로로 간다.
function prismConvex(points,x,z){
  const p=points.map(v=>[v.dot(x),v.dot(z)]),n=p.length/2,chains=[];
  for(let layer=0;layer<2;layer++){
    let lo=0,hi=0;
    for(let i=1;i<n;i++){if(compare2(p[i*2+layer],p[lo*2+layer])<0)lo=i;if(compare2(p[i*2+layer],p[hi*2+layer])>0)hi=i;}
    for(const dir of [1,-1]){
      const chain=[];let i=lo;
      for(let k=0;k<n;k++){
        const v=p[i*2+layer];if(chain.length&&compare2(chain[chain.length-1],v)>0)return convexPairs(p);
        chain.push(v);if(i===hi)break;i=(i+dir+n)%n;
      }
      chains.push(chain);
    }
  }
  const at=[0,0,0,0],sorted=[];
  for(;;){
    let chosen=-1,v;
    for(let j=0;j<4;j++){const q=chains[j][at[j]];if(q&&(chosen<0||compare2(q,v)<0)){v=q;chosen=j;}}
    if(chosen<0)break;at[chosen]++;
    const last=sorted[sorted.length-1];if(!last||compare2(last,v)!==0)sorted.push(v);
  }
  return convexPairs(sorted,true);
}
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
const worldBounds=new WeakMap();
// 같은 스텝의 위치 분리 반복에서는 자세/외곽이 같다. 원점을 뺀 3D AABB를
// 캐시하고 현재 위치만 더해, 확실히 떨어진 쌍을 정밀 투영 전에 제외한다.
function broadBounds(c){
  const h=hitboxFor(c),u=c.up||UP,f=c.fwd||Z,old=worldBounds.get(c);
  if(old&&old.h===h&&old.ux===u.x&&old.uy===u.y&&old.uz===u.z&&old.fx===f.x&&old.fy===f.y&&old.fz===f.z)return old;
  const b=basis(c),out={h,b,ux:u.x,uy:u.y,uz:u.z,fx:f.x,fy:f.y,fz:f.z,minX:Infinity,minY:Infinity,minZ:Infinity,maxX:-Infinity,maxY:-Infinity,maxZ:-Infinity};
  for(const [x,z]of h.hull)for(const y of[h.bottom,h.bottom+h.height]){
    const px=b.right.x*x+b.up.x*y+b.fwd.x*z,py=b.right.y*x+b.up.y*y+b.fwd.y*z,pz=b.right.z*x+b.up.z*y+b.fwd.z*z;
    out.minX=Math.min(out.minX,px);out.maxX=Math.max(out.maxX,px);out.minY=Math.min(out.minY,py);out.maxY=Math.max(out.maxY,py);out.minZ=Math.min(out.minZ,pz);out.maxZ=Math.max(out.maxZ,pz);
  }
  worldBounds.set(c,out);return out;
}
function separatedOn(a,ga,b,gb,axis){
  const extent=g=>{
    const r=g.b.right.dot(axis),f=g.b.fwd.dot(axis),u=g.b.up.dot(axis),h=g.h;let lo=Infinity,hi=-Infinity;
    for(const p of h.hull){const d=p[0]*r+p[1]*f;lo=Math.min(lo,d);hi=Math.max(hi,d);}
    const y0=h.bottom*u,y1=(h.bottom+h.height)*u;return [lo+Math.min(y0,y1),hi+Math.max(y0,y1)];
  };
  const aa=extent(ga),bb=extent(gb),d=b.pos.dot(axis)-a.pos.dot(axis);
  return aa[1]<bb[0]+d-EPS-1e-9||bb[1]+d<aa[0]-EPS-1e-9;
}
const MISS=Object.freeze({hit:false,depth:0,normal:null,point:null});
export function obbOverlap(a,b){
  const ga=broadBounds(a),gb=broadBounds(b),ap=a.pos,bp=b.pos;
  if(ga.ux===gb.ux&&ga.uy===gb.uy&&ga.uz===gb.uz&&(ga.maxX+ap.x<gb.minX+bp.x-EPS||gb.maxX+bp.x<ga.minX+ap.x-EPS||ga.maxY+ap.y<gb.minY+bp.y-EPS||gb.maxY+bp.y<ga.minY+ap.y-EPS||ga.maxZ+ap.z<gb.minZ+bp.z-EPS||gb.maxZ+bp.z<ga.minZ+ap.z-EPS))return MISS;
  const ba=ga.b,bb=gb.b,up=ba.up.clone().add(bb.up);if(up.lengthSq()<EPS)up.copy(ba.up);up.normalize();
  const x=ba.right.clone().projectOnPlane(up);
  if(x.lengthSq()<EPS)x.copy(ba.fwd).projectOnPlane(up);x.normalize();
  const z=new THREE.Vector3().crossVectors(x,up).normalize();
  // 높이가 다른 두 차도 기존 공통 평면의 축으로만 제외한다. 경사에서
  // 3D AABB만 쓰면 기존 투영 SAT의 보수적인 접촉을 빠뜨릴 수 있다.
  if(separatedOn(a,ga,b,gb,z)||separatedOn(a,ga,b,gb,x)||separatedOn(a,ga,b,gb,up))return MISS;
  const ra=project(a,up),rb=project(b,up),miss=()=>MISS;
  if(ra.high<rb.low-EPS||rb.high<ra.low-EPS)return miss();
  const poly=r=>prismConvex(r.points,x,z);
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
    const reach=h.support(new THREE.Vector3(b.right.dot(r),b.up.dot(r),b.fwd.dot(r)),sg);
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
  // 표시 방향은 drift의 역 y회전뿐이다. 전체 3D 점 대신 같은 x/z 외곽과
  // 두 높이만 돌리면 bounds 결과가 같다(벽용 원본 점은 건드리지 않음).
  const points=[];for(const [x,z]of h.rawHull)points.push(new THREE.Vector3(x,h.bottom+.008,z).applyQuaternion(undo));
  points.push(new THREE.Vector3(points[0].x,h.bottom+h.height-.008,points[0].z));
  const root=model.root;
  const v={pos:root.position.clone(),up:UP.clone().applyQuaternion(root.quaternion),fwd:Z.clone().applyQuaternion(root.quaternion),_displayHitbox:bounds(points,.008,car._hitboxState.displayWork||(car._hitboxState.displayWork={})),root,remote:!car.cfg};
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
