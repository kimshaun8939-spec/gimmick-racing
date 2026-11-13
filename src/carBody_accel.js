// 가속 모드 전용 기계 키트. 위치는 차체 좌표(m), 물리/모드 규칙에는 관여하지 않는다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// [옆 덮개 x,y,z,길이, 날개 연장폭, 솟는 높이, 성격]
const FIT = {
  f1: [.67,.59,-.78,1.1,.52,.18,'aero'], proto: [.86,.58,-.65,1.12,.5,.18,'aero'],
  hyper: [.99,.57,-.45,1.04,.48,.15,'aero'], ev: [.89,.59,-.65,.94,.45,.14,'electric'],
  gt: [.98,.58,-.12,.98,.43,.16,'blower'], muscle: [.95,.65,-.12,1.02,.4,.15,'blower'],
  wedge: [.95,.54,-.32,1.04,.53,.14,'aero'], roadster: [.76,.52,-.3,.85,.35,.13,'classic'],
  rally: [.94,.69,-.45,.84,.38,.12,'rally'], hatch: [.88,.64,-.42,.82,.36,.12,'rally'],
  truck: [1.02,.84,-.45,1.0,.38,.13,'rally'],
  rocket: [.48,.53,-.55,.86,.45,0,'rocket'], buggy: [.79,.58,-.65,.75,.38,.12,'rocket'],
  kart: [.56,.28,-.28,.62,.32,.1,'rocket'], van: [.87,.66,-.95,.86,.36,.1,'rocket'],
};
const clamp = x => Math.max(0, Math.min(1,x));
const phase = (p,a,b) => clamp((p-a)/(b-a));
const smooth = x => x*x*(3-2*x);
// 약한 탄성: 끝에서 살짝 넘었다 제자리로 잠긴다.
const settle = x => x<=0?0:x>=1?1:1+2.1*(x-1)**3+1.1*(x-1)**2;

export function buildAccelKit({body,spoiler,A,M,look,add,light}) {
  const [x,y,z,len,span,rise,kind] = FIT[look.style] || FIT.f1;
  
  const kit = new THREE.Group(); kit.name='accel-mechanism'; body.add(kit);
  // 움직이는 그룹 안의 작은 고정 부품은 batchLocal로 묶는다.
  const box=(w,h,d,mat,px,py,pz,parent=kit)=>add(new THREE.BoxGeometry(w,h,d),mat,px,py,pz,parent);
  const group=(parent,px,py,pz,name)=>{const g=new THREE.Group();g.position.set(px,py,pz);g.name=name;parent.add(g);return g;};
  const pods=[], blades=[], ends=[], pistons=[];
  for(const side of [-1,1]) {
    const pod=group(kit,side*x,y,z,'accel-side-cassette');
    // 검은 테 안에서 흡입구가 나온다. 열린 덮개는 공기를 모으는 날개가 된다.
    box(.10,.20,len,M.carbon,0,-.07,0,pod);
    const door=group(pod,side*.035,.045,0,'accel-panel');
    box(.045,.24,len+.08,M.accent,side*.022,-.12,0,door);
    box(.052,.018,len*.78,M.trim,side*.027,-.22,0,door);
    const core=group(pod,0,-.08,0,'accel-intake');
    box(.25,.14,len*.88,M.darkMetal,side*.10,0,0,core);
    box(.018,.09,len*.7,M.dark,side*.233,0,0,core);
    // 흡입구의 살은 단순한 상자를 쓰고 같은 재질끼리 묶는다.
    for(let i=0;i<3;i++)box(.025,.11,.035,M.metal,side*.246,0,(i-1)*len*.23,core);
    box(.026,.018,len*.74,light,side*.25,-.065,0,core).castShadow=false;
    const blade=group(pod,0,-.14,len*.40,'accel-canard');
    box(.5,.035,.4,M.carbon,side*.23,0,-.09,blade);
    box(.025,.08,.32,M.trim,side*.47,.025,-.08,blade);
    pods.push({pod,door,core,blade,side});
    // 날개는 옆으로 넓게 확장. 로켓은 원래 주 날개 높이 1.12 m를 유지한다.
    const end=group(spoiler,side*(A.stab[0]-.15),A.stab[1]+.035,A.stab[2],'accel-wing-extension');
    box(span,.045,.46,M.carbon,side*span*.5,0,0,end);
    box(span,.014,.045,M.accent,side*span*.5,.031,.18,end);
    box(.032,.19,.48,M.trim,side*span,.04,0,end);
    box(span*.8,.012,.022,light,side*span*.53,.03,-.21,end).castShadow=false;
    ends.push({end,side});
    const piston=group(body,side*.38,A.lift.y,A.lift.z,'accel-wing-ram');
    const ramHeight=Math.max(.08,A.stab[1]-A.lift.y+rise+.04);
    box(.045,ramHeight,.065,M.metal,0,ramHeight*.5,0,piston);pistons.push(piston);
    // 도로 아래로 내려가지 않는 하부 디퓨저.
    const diffuserY=['truck','buggy'].includes(look.style)?Math.max(.35,A.nitro.y-.05):look.style==='kart'?.18:.24;
    const fin=group(kit,side*(x-.08),diffuserY,A.nitro.z-.12,'accel-diffuser');
    box(.42,.035,.62,M.carbon,0,0,-.08,fin);
    box(.07,.06,1.0,M.carbon,0,.02,.58,fin); // 차체 하부에서 뒤 판까지 이어지는 레일
    box(.025,.15,.58,M.carbon,side*.18,.04,-.08,fin);
    box(.32,.016,.025,light,0,.02,-.36,fin).castShadow=false;
    blades.push(fin);
  }
  let intake=null, hood=[];
  if(kind==='blower'||kind==='classic') {
    // 보닛 덮개 두 장이 열리고 그 사이에서 흡입구가 솟는다.
    const hy=A.glow.y+.025, hz=A.glow.z-.18;
    intake=group(kit,0,hy,hz,'accel-supercharger');
    box(.42,.12,.50,M.darkMetal,0,.04,0,intake);
    box(.46,.08,.22,M.metal,0,.13,.14,intake);
    box(.36,.065,.025,M.dark,0,.13,.262,intake);
    for(const px of [-.12,0,.12])box(.025,.07,.03,M.trim,px,.13,.28,intake);
    for(const side of [-1,1]){
      const d=group(kit,side*.24,hy,hz,'accel-hood-door');
      box(.24,.035,.61,M.accent,-side*.12,0,0,d);hood.push({d,side});
    }
  } else if(kind==='rally') {
    // 지붕 짐·코스튬을 피한 좌우 스노클 흡입구.
    for(const pod of pods) {
      const s=group(pod.core,pod.side*.06,.06,-len*.23,'accel-rally-scoop');
      box(.16,.20,.26,M.accent,0,.07,0,s);
      box(.12,.08,.025,M.dark,0,.13,.14,s);
      box(.14,.018,.025,light,0,.18,.145,s).castShadow=false;
    }
  }
  // 움직인 뒤 눈앞에 오는 부품도 1인칭 레이어에 포함한다.
  kit.traverse(m=>{if(m.isMesh)m.userData.accelMoving=true;});
  const restScale=spoiler.scale.clone();
  // 잠긴 뒤에는 움직임이 끝난 부품을 차체 좌표로 모아 그림 호출을 줄인다.
  // 원래 경첩 그룹은 잠시 장면에서 빼고 보관. 접기 시작 전에 복원한다.
  let locked=null, parked=[];
  const movingRoots=[kit,...ends.map(v=>v.end),...pistons];
  function unlock(){
    if(!locked)return;
    locked.traverse(m=>{if(m.geometry)m.geometry.dispose();});
    locked.removeFromParent();locked=null;
    for(const {part,parent} of parked)parent.add(part);
    parked=[];
  }
  function lockKit(){
    if(locked)return;
    body.updateWorldMatrix(true,true);
    const inv=new THREE.Matrix4().copy(body.matrixWorld).invert(),matrix=new THREE.Matrix4(),groups=new Map();
    for(const part of movingRoots)part.traverse(m=>{
      if(!m.isMesh)return;
      let visible=true;for(let o=m;o&&o!==body;o=o.parent)if(!o.visible)visible=false;
      if(!visible)return;
      const key=[m.material.uuid,m.layers.mask,m.castShadow?1:0,Object.keys(m.geometry.attributes).sort().join(',')].join('|');
      if(!groups.has(key))groups.set(key,{sample:m,geos:[]});
      matrix.multiplyMatrices(inv,m.matrixWorld);
      groups.get(key).geos.push(m.geometry.clone().applyMatrix4(matrix));
    });
    locked=new THREE.Group();locked.name='accel-locked';body.add(locked);
    for(const {sample,geos}of groups.values()){
      const geometry=mergeGeometries(geos,false);for(const g of geos)g.dispose();
      if(!geometry){unlock();return;}
      const mesh=new THREE.Mesh(geometry,sample.material);mesh.layers.mask=sample.layers.mask;
      mesh.castShadow=sample.castShadow;mesh.receiveShadow=sample.receiveShadow;
      mesh.userData.accelMoving=true;locked.add(mesh);
    }
    parked=movingRoots.map(part=>({part,parent:part.parent}));
    for(const {part}of parked)part.removeFromParent();
  }
  return {
    kind, rise,
    dispose: unlock,
    pose(p,other=0) {
      if(p < 1 || other > .1)unlock();
      kit.visible=other<.35;
      const open=settle(phase(p,.02,.33));
      const slide=settle(phase(p,.22,.63));
      const aero=settle(phase(p,.42,.88));
      const lock=smooth(phase(p,.79,1));
      for(const {pod,door,core,blade,side} of pods){
        door.rotation.z=side*1.12*open;
        core.visible=slide>.001;core.position.x=side*.23*slide;
        core.scale.x=Math.max(.001,slide);
        blade.visible=aero>.001;blade.scale.x=Math.max(.001,aero);
        blade.rotation.y=-side*.22*aero;blade.rotation.z=side*.12*aero;
        pod.position.x=side*(x+.04*slide);
      }
      for(const {end,side} of ends){end.visible=aero>.001&&other<.35;end.scale.x=Math.max(.001,aero);end.rotation.x=-.16*lock;end.position.x=side*(A.stab[0]-.15+.12*aero);}
      for(const piston of pistons){piston.visible=p>.35&&other<.35;piston.scale.y=Math.max(.001,aero);}
      for(const fin of blades){fin.visible=aero>.001;fin.position.z=A.nitro.z-.12-.26*aero;fin.rotation.x=-.18*aero;fin.scale.z=Math.max(.001,aero);}
      if(intake){intake.visible=slide>.001;intake.position.y=A.glow.y+.025+.16*slide;intake.scale.y=Math.max(.001,slide);for(const {d,side} of hood)d.rotation.z=-side*1.2*open;}
      // 코스튬의 기존 날개 높이 배율을 유지한다.
      spoiler.position.y+=rise*aero;
      spoiler.scale.x=restScale.x*(1+.08*aero);
      light.emissiveIntensity=.65+1.0*lock+.45*Math.sin(Math.PI*phase(p,.85,1));
      if(p >= 1 && other < .1)lockKit();
    },
  };
}
