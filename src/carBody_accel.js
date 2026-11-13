// flame2: 낮은 기구 유지. 범퍼에 붙는 속 빈 금속 노즐과 그 안쪽에 결합된 공유 불꽃/전기 아크.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const clamp=x=>Math.max(0,Math.min(1,x));
const phase=(p,a,b)=>clamp((p-a)/(b-a));
const smooth=x=>x*x*(3-2*x);
const back=x=>x<=0?0:x>=1?1:1+2.3*(x-1)**3+1.3*(x-1)**2;
// [초, 소리 성격, 단계 시각(진행도), 시작/끝 주파수]
const SPECS={
 f1:[1.10,'precision',[.08,.19,.30,.43,.60,.83],560,1160], junior:[1.06,'ratchet',[.12,.25,.48,.72,.89],420,880],
 proto:[1.24,'hydraulic',[.09,.34,.63,.93],115,310], nova:[1.32,'electric',[.10,.29,.57,.77,.95],230,780],
 hyper:[1.12,'silk',[.08,.31,.53,.91],310,820], volt:[1.02,'electric',[.12,.26,.40,.54,.84],520,1380],
 gt:[1.16,'blower',[.06,.24,.52,.86],145,380], midnight:[1.16,'precision',[.10,.36,.58,.89],360,940],
 muscle:[1.34,'heavy',[.08,.40,.71,.94],75,170], rocket:[1.38,'heavy',[.08,.28,.58,.91],90,240],
 rally:[1.06,'ratchet',[.08,.29,.49,.71,.91],220,580], blizzard:[1.18,'hydraulic',[.10,.36,.64,.92],160,390],
 buggy:[1.12,'pop',[.19,.47,.81],250,690], scorpion:[1.22,'ratchet',[.10,.33,.57,.89],130,450],
 kart:[1.04,'pop',[.14,.41,.76],440,1040], hatch:[1.12,'ratchet',[.09,.32,.56,.88],320,720],
 roadster:[1.20,'classic',[.12,.36,.62,.91],150,430], trophy:[1.28,'hydraulic',[.10,.38,.68,.92],100,270],
 pickup:[1.36,'heavy',[.08,.30,.61,.94],80,210], cube:[1.40,'pop',[.10,.33,.67,.93],180,510],
 razor:[1.08,'precision',[.08,.22,.39,.60,.90],390,1020],
};
export function accelIdentity(look={}) {
 const named=look.accelId||look.carId||look.costume?.split('-')[0];
 if(SPECS[named])return named;
 const variant={f1:{'3':'junior'},proto:{'1':'nova'},gt:{'77':'midnight'},rally:{'21':'blizzard'},buggy:{'13':'scorpion'}};
 return variant[look.style]?.[String(look.number)]||(look.style==='truck'?(look.variant==='pickup'?'pickup':'trophy'):look.style==='van'?'cube':look.style==='ev'?'volt':look.style==='wedge'?'razor':look.style)||'f1';
}
export function accelProfile(look={}) {
 const id=accelIdentity(look),s=SPECS[id]||SPECS.f1;
 return {id,duration:s[0],sound:s[1],steps:s[2],f0:s[3],f1:s[4]};
}


// flame: 한 재질/차당 한 호출. 불꽃, 입구 번짐, 불티, 열 아지랑이는 모두 작은 인스턴스 쿼드.
// 모든 차가 이 재질을 공유하고 onBeforeRender에서 그 차의 uniform만 갱신한다.
let sharedFire=null,fireUsers=0,fireSerial=0;
function acquireFire(){
 if(!sharedFire){
  sharedFire=new THREE.ShaderMaterial({
   name:'accel-combustion-plasma',transparent:true,depthWrite:false,side:THREE.DoubleSide,
   blending:THREE.CustomBlending,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,toneMapped:false,
   uniforms:{uTime:{value:0},uPower:{value:0},uSpeed:{value:0},uOn:{value:0},uPop:{value:0},uElectric:{value:0},uAccent:{value:new THREE.Color()}},
   vertexShader:`
    attribute vec4 fireData; attribute float fireHeight;
    uniform float uTime,uPower,uSpeed,uOn,uPop,uElectric;
    varying vec2 vUv; varying vec4 vFire;
    void main(){
     float kind=fireData.x, seed=fireData.y;
     float beat=1.0+.07*sin(uTime*37.0+seed*23.0)+.045*sin(uTime*61.0+seed*41.0);
     float len=fireData.z*(.20+1.16*uPower+.20*uSpeed)*beat*(1.0+.22*uPop);
     float pulse=(.78+.22*uPower)*(1.0+.04*sin(uTime*43.0+seed*29.0));
     vec4 origin=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
     vec3 axis=(modelViewMatrix*instanceMatrix*vec4(0.,0.,-1.,0.)).xyz;
     vec3 dir=normalize(axis);
     vec3 side=cross(dir,normalize(-origin.xyz));
     side=length(side)>.001?normalize(side):vec3(1.,0.,0.);
     vec3 bx=(modelViewMatrix*instanceMatrix*vec4(1.,0.,0.,0.)).xyz;
     vec3 by=(modelViewMatrix*instanceMatrix*vec4(0.,1.,0.,0.)).xyz;
     // 납작한 슬롯은 보는 각도에 맞는 타원 단면. 넓은 폭을 세로 불기둥으로 돌리지 않는다.
     float wide=length(vec2(dot(side,bx)*fireData.w,dot(side,by)*fireHeight));
     vec3 p=origin.xyz;
     float age=fract(uTime*(.85+.3*seed)+seed*17.0);
     if(kind<.5){
      float flare=1.0+1.0*sin(uv.y*3.14159);
      p+=axis*(uv.y*len)+side*(position.x*wide*flare*mix(1.,pulse,smoothstep(.02,.20,uv.y)));
     }else if(kind<1.5){
      // 입구 광륜은 카메라를 바라보는 작은 스프라이트, 차체 뒤 낮은 위치 고정.
      p+=(bx*position.x*fireData.w+by*position.y*fireHeight)*(1.18+.45*uPop);
     }else{
      float travel=kind<2.5?age:fract(age+.37);
      p+=axis*(len*(.18+1.12*travel));
      p+=side*(sin(seed*74.0+travel*7.0)*wide*(.16+.30*travel));
      p.y+=(kind<2.5?.08:.13)*sin(seed*19.0+travel*5.0)*travel;
      float size=kind<2.5?.016+.018*seed:.055+.06*travel;
      p.xy+=position.xy*size*(kind<2.5?1.:1.7);
     }
     vUv=vec2(uv.x*2.-1.,uv.y);vFire=vec4(kind,seed,age,uOn);
     gl_Position=projectionMatrix*vec4(p,1.);
    }`,
   fragmentShader:`
    precision highp float;
    uniform float uTime,uPower,uSpeed,uPop,uElectric;
    uniform vec3 uAccent;
    varying vec2 vUv; varying vec4 vFire;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
    void main(){
     float x=vUv.x,y=vUv.y,seed=vFire.y,t=uTime;
     vec3 col;float alpha;
     if(vFire.x<.5){
      float n=noise(vec2(x*3.+seed*31.,y*9.-t*13.));
      float fine=noise(vec2(x*9.-t*2.,y*23.-t*27.+seed*13.));
      // 소용돌이치는 불꽃 혀. 끝이 뾰족해지며 투명하게 사라진다.
      float sway=sin(y*10.-t*24.+seed*17.)*.09*y;
      float r=abs(x+sway);
      float envelope=pow(max(0.,1.-y),.68)*(.72+.20*sin(y*3.14));
      envelope*=.64+.45*n+.18*fine;
      envelope=mix(.99,envelope,smoothstep(.015,.13,y));
      float edge=1.-smoothstep(envelope-.13,envelope+.03,r);
      float tongue=noise(vec2(x*5.+seed*9.,t*11.));
      edge*=1.-smoothstep(.64+.24*tongue,1.,y);
      float core=(1.-smoothstep(.05,.42,r))* (1.-smoothstep(.12,.57,y));
      col=mix(vec3(.95,.012,.001),vec3(1.,.31,.008),1.-smoothstep(.15,.80,y));
      col=mix(col,vec3(1.,.83,.27),core*.80);
      col=mix(col,vec3(1.8,1.65,1.34),core*core*.92);
      col*=.80+.30*n+.12*fine;
      // 3개의 희미한 마하 다이아몬드. 별도 메시/호출 없음.
      float d=0.;for(int i=0;i<3;i++){
       float c=.22+float(i)*.22+.012*sin(t*12.+seed);
       float diamond=abs(y-c)/.065+r/(.32-float(i)*.055);
       d+=pow(max(0.,1.-diamond),2.);
      }
      col+=mix(vec3(.45,.40,.20),uAccent*.30,.18)*d*.65;
      if(uElectric>.5){
       float arc=exp(-abs(x-.19*sin(y*29.-t*37.+seed*13.)) * 54.);
       col=mix(vec3(.025,.19,1.),vec3(.64,.93,1.),core)+arc*vec3(.6,.85,1.);
       col+=uAccent*d*.12;
      }
      alpha=edge*(.86+.12*n)*(1.-smoothstep(.70,1.,y));
      alpha*=.66+.30*uPower;
     }else if(vFire.x<1.5){
      float r=length(vec2(x,(y-.5)*2.));
      float hot=exp(-r*r*12.),halo=exp(-r*r*4.0);
      col=mix(vec3(1.,.16,.015),vec3(1.,.94,.64),hot);
      if(uElectric>.5)col=mix(vec3(.02,.25,1.),vec3(.78,.98,1.),hot);
      col+=uAccent*pow(max(0.,1.-abs(r-.7)*5.),2.)*.10;
      alpha=(hot*.38+halo*.11)*(1.+uPop*.65);
     }else{
      float r=length(vec2(x,(y-.5)*2.));
      float life=sin(vFire.z*3.14159);
      col=uElectric>.5?vec3(.22,.63,1.):vec3(1.,.24,.025);
      alpha=max(0.,1.-r)*life*(vFire.x<2.5?.58:.035)*(.25+.75*uPower);
      if(vFire.x>2.5)col=mix(col,vec3(.5,.58,.66),.65);
     }
     alpha*=vFire.w;if(alpha<.003)discard;
     gl_FragColor=vec4(col,alpha);
    }`
  });
  sharedFire.userData.live=true;sharedFire.userData.sharedFlame=true;
 }
 fireUsers++;return sharedFire;
}
function buildFire(body,emitters,id,colour){
 const material=acquireFire(),perPort=7,phaseOffset=(fireSerial++*.61803398875)%1;
 const geo=new THREE.PlaneGeometry(1,1);
 const data=new Float32Array(emitters.length*perPort*4),heights=new Float32Array(emitters.length*perPort);
 for(let j=0;j<emitters.length;j++)for(let k=0;k<perPort;k++){
  const e=emitters[j],i=(j*perPort+k)*4;
  heights[j*perPort+k]=e.height;
  data.set([k===0?0:k===1?1:k<5?2:3,(j*.371+k*.173+Object.keys(SPECS).indexOf(id)*.113+phaseOffset)%1,e.len,e.width],i);
 }
 geo.setAttribute('fireData',new THREE.InstancedBufferAttribute(data,4));
 geo.setAttribute('fireHeight',new THREE.InstancedBufferAttribute(heights,1));
 const mesh=new THREE.InstancedMesh(geo,material,emitters.length*perPort);
 mesh.name='accel-fire-'+id;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 mesh.userData.accelMoving=true;body.add(mesh);
 const state={time:0,power:.7,speed:0,on:0,pop:0,electric:id==='volt'||id==='nova'?1:0};
 mesh.onBeforeRender=()=>{
  const u=material.uniforms;u.uTime.value=state.time;u.uPower.value=state.power;u.uSpeed.value=state.speed;
  u.uOn.value=state.on;u.uPop.value=state.pop;u.uElectric.value=state.electric;u.uAccent.value.copy(colour);
  material.uniformsNeedUpdate=true;
 };
 const inv=new THREE.Matrix4(),m=new THREE.Matrix4(),shift=new THREE.Matrix4();
 let previous=0,popAge=1;
 return {
  update(p,other,time,throttle,speed,dt){
   const on=smooth(phase(p,.76,.97))*(1-smooth(phase(other,.1,.35)));
   // 점화/소화 때 노즐 주변만 0.18초 팡 켜졌다 사라진다.
   if((on>.03&&previous<=.03)||(on<.94&&previous>=.94))popAge=0;
   popAge+=Math.min(.1,Math.max(0,dt));previous=on;
   state.pop=Math.max(0,1-popAge/.18);state.time=time;
   const goal=clamp(throttle),blend=dt>=1?1:1-Math.exp(-Math.max(0,dt)*15);
   state.power+=(goal-state.power)*blend;state.speed=clamp(Math.abs(speed)/70);state.on=on;
   mesh.visible=on>.001;
   body.updateWorldMatrix(true,false);inv.copy(body.matrixWorld).invert();
   for(let j=0;j<emitters.length;j++){
    const e=emitters[j];e.node.updateWorldMatrix(true,false);
    let attached=false;for(let n=e.node;n;n=n.parent)if(n===body){attached=true;break;}
    // 병합으로 관 그룹이 잠시 빠져도 같은 body 기준 좌표를 유지한다(중첩된 4연 배기 포함).
    if(attached){m.multiplyMatrices(inv,e.node.matrixWorld);e.local??=new THREE.Matrix4();e.local.copy(m);}else m.copy(e.local);
    shift.makeTranslation(0,0,e.z);m.multiply(shift);
    for(let k=0;k<perPort;k++)mesh.setMatrixAt(j*perPort+k,m);
   }
   mesh.instanceMatrix.needsUpdate=true;
  },
  dispose(){mesh.removeFromParent();mesh.dispose();geo.dispose();if(--fireUsers===0){sharedFire.dispose();sharedFire=null;}}
 };
}

export function buildAccelKit({body,spoiler,A,M,look,add,light,shell}) {
 const profile=accelProfile(look),id=profile.id;
 const kit=new THREE.Group();kit.name='accel-'+id;body.add(kit);
 const motions=[],spinners=[],emitters=[];
 const group=(name,x=0,y=0,z=0,parent=kit)=>{const g=new THREE.Group();g.name=name;g.position.set(x,y,z);parent.add(g);return g;};
 const box=(w,h,d,mat,x=0,y=0,z=0,parent=kit)=>add(new THREE.BoxGeometry(w,h,d),mat,x,y,z,parent);
 const slab=(pts,t,mat,parent=kit)=>{const s=new THREE.Shape();s.moveTo(...pts[0]);for(const p of pts.slice(1))s.lineTo(...p);return add(new THREE.ExtrudeGeometry(s,{depth:t,bevelEnabled:false}).rotateX(Math.PI/2),mat,0,0,0,parent);};
 const fin=(pts,t,mat,parent)=>{const s=new THREE.Shape();s.moveTo(...pts[0]);for(const p of pts.slice(1))s.lineTo(...p);return add(new THREE.ExtrudeGeometry(s,{depth:t,bevelEnabled:false}).rotateY(-Math.PI/2).translate(t/2,0,0),mat,0,0,0,parent);};
 const cyl=(r1,r2,len,mat,x,y,z,parent,open=false)=>add(new THREE.CylinderGeometry(r1,r2,len,10,1,open).rotateX(Math.PI/2),mat,x,y,z,parent);
 const move=(g,a,b,fn,elastic=true)=>motions.push((p)=>{const q=(elastic?back:smooth)(phase(p,a,b));fn(q);});
 const reveal=(g,q)=>{g.visible=q>.001;};
 const spin=(g,axis,speed)=>{spinners.push((p,t)=>{g.rotation[axis]=t*speed*smooth(phase(p,.35,.95));});};
 const hinge=(name,side,x,y,z,w,d,a,b,angle,mat=M.accent)=>{
   const g=group(name,side*x,y,z);box(w,.035,d,mat,side*w*.5,0,0,g);
   box(w*.85,.014,.025,M.trim,side*w*.52,.022,d*.35,g);
   move(g,a,b,q=>g.rotation.z=side*angle*q);return g;
 };
 const radiator=(name,x,y,z,w,d,a,b)=>{
   const g=group(name,x,y,z);box(w,.09,d,M.carbon,0,0,0,g);
   for(let i=0;i<4;i++)box(w*.88,.016,.024,M.metal,0,.05,(i-1.5)*d*.2,g);
   move(g,a,b,q=>{reveal(g,q);g.position.y=y+.19*q;g.rotation.x=-.36*q;});return g;
 };
 // 회전하는 팬은 고정 병합 밖의 독립 그룹. 작은 부품은 그 그룹 안에서 batchLocal 가능.
 const turbine=(name,x,y,z,r,parent=kit)=>{
   const g=group(name,x,y,z,parent);
   cyl(r*.85,r,.52,M.carbon,0,0,0,g,true);
   add(new THREE.TorusGeometry(r,.035,4,12),M.trim,0,0,-.27,g);
   if(id!=='cube')add(new THREE.CircleGeometry(r*.86,12).rotateY(Math.PI),M.dark,0,0,-.24,g);
   const rotor=group('rotor',0,0,-.28,g);
   for(let i=0;i<5;i++){const blade=box(r*.13,.025,r*.7,M.metal,0,0,0,rotor);blade.geometry.rotateX(Math.PI/2).translate(0,r*.48,0).rotateZ(i*Math.PI*2/5);}
   cyl(r*.16,r*.18,.10,M.trim,0,0,-.29,g);
   spin(rotor,'z',22);g.userData.continuous=true;return g;
 };

 // flame2: 속이 빈 금속 나팔. 표면/그을음/안쪽 벽을 한 지오메트리로 만들어 batchLocal 가능.
 const nozzleMetal=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.72,roughness:.36,side:THREE.DoubleSide});
 const hotWall=new THREE.MeshStandardMaterial({color:id==='volt'||id==='nova'?'#73bdff':'#e99148',emissive:id==='volt'||id==='nova'?'#208dff':'#ff440c',emissiveIntensity:1,metalness:.45,roughness:.43,side:THREE.DoubleSide});
 hotWall.userData.live=true;
 const throat=(g,w,h,d,shape='oval')=>{
   const N=id==='midnight'?6:['gt','trophy'].includes(id)?8:12,pts=[];
   for(let i=0;i<N;i++){
     const a=i/N*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
     const square=(shape==='slot'||shape==='split')&&id!=='proto';
     // 슬롯도 둥근 모서리의 실제 관. 삼각 배기는 세 갈래의 부드러운 나팔.
     const r=shape==='delta'?1+.14*Math.sin(a*3):1;
     pts.push([square?Math.sign(c)*Math.abs(c)**.40:c*r,square?Math.sign(s)*Math.abs(s)**.40:s*r]);
   }
   const positions=[],colors=[],indices=[];
   const ring=(scale,z,hex)=>{const col=new THREE.Color(hex);for(const [x,y]of pts){positions.push(x*w*.5*scale,y*h*.5*scale,z);colors.push(col.r,col.g,col.b);}};
   ring(.68,d*.52,'#4f5364');if(!['gt','trophy','midnight'].includes(id))ring(.97,-d*.34,'#858d9c');ring(1,-d*.50,'#b4a18d');
   ring(.81,-d*.50,'#3c293b');ring(.67,-d*.14,'#251c21');ring(.49,d*.40,'#080a0d');
   for(let j=0;j<positions.length/(3*N)-1;j++)for(let i=0;i<N;i++){const a=j*N+i,b=j*N+(i+1)%N,c=b+N,e=a+N;indices.push(a,b,e,b,c,e);}
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
   const tube=add(geo,nozzleMetal,0,0,0,g);tube.name='hollow-burnished-nozzle';
   const hotPos=[],hotIdx=[];
   for(const [scale,z]of [[.79,-d*.48],[.72,-d*.29]])for(const [x,y]of pts)hotPos.push(x*w*.5*scale,y*h*.5*scale,z);
   for(let i=0;i<N;i++){const a=i,b=(i+1)%N;hotIdx.push(a,b,a+N,b,b+N,a+N);}
   const hg=new THREE.BufferGeometry();hg.setAttribute('position',new THREE.Float32BufferAttribute(hotPos,3));hg.setIndex(hotIdx);hg.computeVertexNormals();add(hg,hotWall,0,0,0,g).name='hot-inner-wall';
   // 검은 바닥은 입구보다 깊숙이 둔다. 발광판으로 구멍을 막지 않는다.
   add(new THREE.CircleGeometry(1,N).rotateY(Math.PI).scale(w*.245,h*.245,1),M.dark,0,0,d*.39,g);
   g.userData.nozzle={width:w*.81,height:h*.81,mouth:-d*.50,start:-d*.37,depth:d,shape};
   if(id==='volt'||id==='nova'){
     // 절연대의 마주 보는 전극: 전기 아크가 나오는 곳.
     for(const s of [-1,1]){
       box(w*.12,h*.26,d*.28,M.carbon,s*w*.48,0,-d*.05,g);
       box(w*.13,h*.10,d*.30,M.metal,s*w*.35,0,-d*.30,g);
       box(w*.06,h*.12,.025,hotWall,s*w*.32,0,-d*.47,g);
     }
   }
   return {node:g,z:-d*.37,width:w*.81,height:h*.81,len:id==='rocket'?1.55:id==='kart'?.66:id==='buggy'?.86:id==='nova'?1.22:.93};
 };
 const exhaust=(name,x,y,z,r,parent=kit)=>{
   const g=group(name,x,y,z,parent);
   emitters.push(throat(g,r*2,r*2,.52));
   // 로켓 몸통과 차체를 잇는 금속 새들/플랜지. 불꽃과 관은 같은 g 기준.
   box(r*1.4,.065,.27,M.darkMetal,0,-r*.73,.19,g);
   box(.075,r*.85,.20,M.metal,0,-r*.65,.22,g);
   g.userData.continuous=true;return g;
 };
 let squat=.025,pitch=0,hop=0,drs=.12;
 if(id==='f1'||id==='junior') {
   const junior=id==='junior'; drs=junior?.75:1.12;
   // 실제 앞날개 3단. 어린 포뮬러는 양쪽 끝판을 먼저 접는 다른 리듬.
   for(const [n,f]of (shell.accelFlaps||[]).entries()){const i=n%3;move(f,junior?.40+i*.10:.04+i*.11,junior?.67+i*.10:.20+i*.11,q=>f.rotation.x=-(junior?.30:.52)*q,false);}
   for(const side of [-1,1]) {
     if(junior) {
       const g=hinge('junior-outrigger',side,.77,.43,-.78,.63,1.20,.02,.42,-.78,M.carbon);
       box(.3,.035,.12,M.accent,side*.18,.02,-.28,g);
     } else for(let i=0;i<5;i++) {
       const g=group('sequential-cooling-louver',side*(.56-i*.028),.727-i*.012,-.28-i*.16);
       box(.29,.022,.115,M.carbon,0,0,0,g);box(.27,.009,.018,M.trim,0,.014,-.045,g);
       move(g,.30+i*.075,.48+i*.075,q=>g.rotation.x=-.92*q,false);
     }
   }
 } else if(id==='proto'||id==='nova') {
   const nova=id==='nova'; squat=.045; drs=.26;
   // 롱테일/중앙 샤크핀 대신 차체 옆 낮은 슬라이딩 냉각 레일.
   for(const side of [-1,1]){
     const rail=group(nova?'nova-split-keel':'proto-side-channel',side*.90,.52,-.95);
     fin([[.65,0],[.36,.17],[-.90,.17],[-1.12,0]],.065,M.carbon,rail);
     box(.045,.025,1.35,light,0,.17,-.15,rail);
     box(.23,.045,.80,M.accent,side*.10,.015,-.28,rail);
     move(rail,nova?.10+(side>0?.13:0):.03,nova?.65:.45,q=>{reveal(rail,q);rail.position.x=side*(.90+.34*q);rail.scale.y=Math.max(.001,q);});
     const tail=group(nova?'nova-side-slider':'proto-side-slider',side*1.10,.42,-1.6);
     box(.20,.12,.65,M.paint,0,0,0,tail);box(.12,.025,.48,light,0,.068,0,tail);
     move(tail,nova?.48:.25,1,q=>{reveal(tail,q);tail.position.z=-1.55-.20*q;tail.scale.z=Math.max(.001,q);});
     const shutter=group('headlamp-shutter',side*.7,.48,2.48);
     box(.38,.045,.45,M.carbon,0,0,0,shutter);
     move(shutter,.69,.97,q=>{reveal(shutter,q);shutter.scale.z=Math.max(.001,q);},false);
   }
 } else if(id==='hyper') {
   squat=.085;drs=.35;
   for(const side of [-1,1]){
     const g=group('butterfly-aero',side*.89,.65,-.28);
     slab([[0,.68],[side*.62,.72],[side*1.34,-.65],[side*.98,-1.62],[0,-1.20]],.035,M.carbon,g);
     box(.055,.022,1.15,M.trim,side*.51,.02,-.28,g).rotation.y=side*.20;
     box(.045,.10,.15,M.darkMetal,0,-.05,.46,g);
     move(g,.07+(side>0?.09:0),.78,q=>g.rotation.z=side*.12*q);
     const cheek=hinge('front-active-cheek',side,.85,.37,2.12,.30,.54,.40,.93,.30,M.carbon);
     box(.20,.015,.04,M.trim,side*.16,.022,.18,cheek);
     for(let i=0;i<6;i++){
       const led=group('flow-cell',side*1.01,.52,1.45-i*.53);box(.018,.02,.24,light,0,0,0,led);
       move(led,.08+i*.12,.22+i*.12,q=>{reveal(led,q);led.scale.z=Math.max(.001,q);},false);
     }
   }
 } else if(id==='volt') {
   squat=.055;drs=.08;
   // 전기차에는 연소 노즐 대신 양옆 배터리 냉각판 8장과 뒤 고리 열교환기.
   for(const side of [-1,1])for(let i=0;i<4;i++){
     const g=group('battery-cooling-petal',side*.91,.38,.36-i*.36);
     slab([[0,.12],[side*.72,.26],[side*.86,-.22],[0,-.13]],.025,M.carbon,g);
     box(.28,.012,.018,light,side*.23,.018,.07,g);
     move(g,.04+i*.13,.30+i*.13,q=>{g.rotation.z=side*.20*q;g.position.x=side*(.91+.34*q);});
   }
   const bridge=group('induction-bridge',0,.40,-1.95);
   for(const side of [-1,1])box(.045,.12,.08,M.trim,side*.64,.06,0,bridge);
   box(1.32,.045,.08,M.carbon,0,.12,0,bridge);box(1.16,.015,.03,light,0,.142,0,bridge);
   move(bridge,.53,1,q=>{reveal(bridge,q);bridge.scale.y=Math.max(.001,q);});
 } else if(id==='gt') {
   squat=.045;drs=.18;
   for(const side of [-1,1])hinge('split-bonnet',side,.31,.80,1.40,.52,1.05,.02,.32,.18,M.accent);
   const blower=group('triple-trumpet',0,.79,1.40);
   box(.52,.17,.68,M.darkMetal,0,.085,0,blower);box(.53,.035,.60,M.metal,0,.17,0,blower);
   for(let i=-1;i<=1;i++){cyl(.09,.065,.24,M.metal,i*.16,.26,.19,blower,true);add(new THREE.CircleGeometry(.073,10),M.dark,i*.16,.26,.315,blower);}
   move(blower,.24,.69,q=>{reveal(blower,q);blower.position.y=.79+.04*q;blower.scale.set(1.3,Math.max(.001,.78*q),1.25);});
   for(const side of [-1,1]){
     const pipe=exhaust('side-exhaust',side*1.0,.35,-.3,.22);
     pipe.rotation.y=-side*Math.PI/2;
     box(.34,.06,.58,M.carbon,0,-.14,.27,pipe);
     add(new THREE.CylinderGeometry(.13,.13,.70,8,1,true).rotateX(Math.PI/2),M.darkMetal,0,0,.42,pipe);
     move(pipe,.55,.94,q=>{reveal(pipe,q);pipe.position.x=side*(1+.45*q);});
   }
 } else if(id==='midnight') {
   squat=.065;drs=.36;
   for(const side of [-1,1]){
     const g=group('night-swing-wing',side*.98,.56,-1.60);
     slab([[0,.18],[side*1.02,.38],[side*1.48,-.48],[side*.38,-.78],[0,-.27]],.035,M.carbon,g);
     box(.55,.015,.035,M.trim,side*.46,.025,-.26,g);
     box(.045,.28,.08,M.darkMetal,0,-.14,0,g);
     move(g,side<0?.03:.23,side<0?.60:.80,q=>{reveal(g,q);g.rotation.y=-side*(1-q)*1.40;g.position.y=.56+.015*q;});
     for(let i=0;i<3;i++)radiator('night-quarter-gill',side*1.01,.65,-.6-i*.21,.16,.16,.55+i*.07,.83+i*.07);
   }
 } else if(id==='muscle') {
   squat=.085;pitch=-.015;drs=0;
   // 원래 블로워 자체를 올리고 흡기 나비판·벨트를 구동.
   if(shell.blower){move(shell.blower,.12,.62,q=>{shell.blower.position.y=.06*q;shell.blower.scale.set(1+.33*q,1,1);});for(const f of shell.butterflies||[])move(f,.44,.88,q=>f.rotation.x=-1.12*q);}
   const riser=group('blower-telescopic-plenum',0,.78,1.35);
   box(.49,.06,.57,M.darkMetal,0,.03,0,riser);
   for(let i=0;i<3;i++)box(.50,.01,.59,M.trim,0,.01+i*.02,0,riser);
   move(riser,.12,.62,q=>{reveal(riser,q);riser.scale.y=Math.max(.001,q);});
   const belt=group('blower-drive',0,.95,1.78);
   add(new THREE.TorusGeometry(.11,.025,4,12),M.carbon,0,0,0,belt);
   const pulley=group('belt-pulley',0,0,.01,belt);for(let i=0;i<3;i++)box(.18,.022,.02,M.trim,0,0,0,pulley).rotation.z=i*Math.PI/3;
   spin(pulley,'z',32);belt.userData.continuous=true;
   move(belt,.20,.65,q=>{reveal(belt,q);belt.position.y=.95+.03*q;});
   for(const side of [-1,1]){
     const g=group('hood-power-shoulder',side*.40,.79,1.36);box(.15,.07,.78,M.accent,0,0,0,g);
     move(g,.03,.33,q=>{g.rotation.z=side*.32*q;g.position.y=.79+.07*q;});
   }
 } else if(id==='rocket') {
   pitch=-.026;squat=0;drs=0;
   for(const side of [-1,1]){
     const door=hinge('parachute-shell',side,.09,.70,-2.20,.36,.50,.01,.32,.95,M.accent);
     move(door,.01,.32,q=>door.rotation.y=side*1.10*q);
   }
   const cradle=group('rocket-gimbal',0,.66,-2.22);
   box(.10,.17,.85,M.carbon,0,-.17,.26,cradle);
   const engine=exhaust('single-main-rocket',0,0,0,.53,cradle);
   cyl(.38,.46,.60,M.accent,0,0,.34,engine,true);
   for(let i=0;i<3;i++)add(new THREE.TorusGeometry(.41+i*.025,.024,4,12),M.metal,0,0,.13-i*.12,engine);
   move(cradle,.22,.83,q=>{reveal(cradle,q);cradle.position.z=-2.1-.12*q;cradle.rotation.z=Math.PI*.5*(1-q);});
   cradle.userData.continuous=true;
   const bar=group('wheelie-bar',0,.20,-2.0);for(const side of [-1,1])box(.045,.045,.95,M.carbon,side*.30,0,-.46,bar);
   cyl(.07,.07,.65,M.rubber,0,0,-.95,bar).rotation.y=Math.PI/2;
   move(bar,.61,1,q=>{reveal(bar,q);bar.scale.z=Math.max(.001,q);});
 } else if(id==='rally'||id==='blizzard') {
   const snow=id==='blizzard';drs=.08;
   if(!snow){
     const scoop=group('rally-roof-mouth',0,1.29,-.40);
     box(.58,.18,.57,M.carbon,0,.09,0,scoop);box(.47,.09,.025,M.dark,0,.11,.30,scoop);box(.53,.04,.58,M.accent,0,.20,0,scoop);
     move(scoop,.03,.42,q=>{reveal(scoop,q);scoop.scale.set(1.5,Math.max(.001,.40*q),1.45);});
   }else for(const side of [-1,1]){
     const g=group('polar-snorkel',side*.93,.80,.66);
     box(.13,.60,.15,M.carbon,0,.30,0,g);box(.22,.12,.32,M.accent,0,.62,.04,g);box(.15,.07,.025,M.dark,0,.64,.21,g);
     move(g,.02+(side>0?.1:0),.56,q=>{reveal(g,q);g.scale.set(1.3,Math.max(.001,.65*q),1.2);});
   }
   for(const side of [-1,1]){
     const lights=group(snow?'polar-searchlight':'rally-light-pod',side*.56,.69,2.19);
     box(.51,.10,.10,M.carbon,0,0,0,lights);
     for(let i=0;i<2;i++){cyl(.105,.115,.10,M.carbon,(i-.5)*.25,.08,.02,lights);add(new THREE.CircleGeometry(.082,10),light,(i-.5)*.25,.08,.08,lights);}
     move(lights,.25+(side>0?.14:0),.77,q=>{reveal(lights,q);lights.rotation.x=-1.40*(1-q);lights.position.y=.69+.16*q;});
     const flap=group('deploying-mudflap',side*.9,.42,-1.80);box(.28,.29,.025,M.rubber,0,-.14,0,flap);box(.23,.025,.03,M.trim,0,-.26,0,flap);
     move(flap,.65,1,q=>{reveal(flap,q);flap.scale.y=Math.max(.001,q);});
   }
 } else if(id==='buggy'||id==='kart') {
   const kart=id==='kart';hop=kart?.07:.09;drs=0;
   for(const side of [-1,1]){
     const x=kart?.57:.79,y=kart?.37:.49,z=kart?-1.48:-2.03;
     const pod=exhaust(kart?'soda-rocket':'spring-rocket',side*x,y,z,kart?.25:.32);
     cyl(kart?.24:.30,kart?.24:.30,kart?.52:.72,M.accent,0,0,.32,pod,true);
     box(.08,.13,.56,M.carbon,-side*.15,-.12,.32,pod);
     if(kart){
       add(new THREE.TorusGeometry(.16,.025,4,10),M.accent,0,0,.06,pod);
       box(.12,.07,.09,M.accent,0,.20,.02,pod);
     }else fin([[.16,0],[-.2,.23],[-.2,0]],.035,M.accent,pod).position.x=side*.14;
     move(pod,side<0?.05:.34,side<0?.45:.74,q=>{reveal(pod,q);pod.position.y=y+(kart?.04:.04)*q;pod.position.x=side*(x+(kart?.30:.42)*q);pod.rotation.y=-side*.12*q;});
   }
 } else if(id==='scorpion') {
   drs=0;
   // 관절 꼬리를 옆으로 접힌 집게 암으로 전환. 관절 시간차는 그대로.
   for(const side of [-1,1]){
     const root=group('scorpion-side-root',side*.86,.48,-1.10);
     box(.48,.13,.22,M.carbon,side*.24,0,0,root);
     const joint=group('scorpion-side-elbow',side*.45,0,0,root);
     box(.16,.12,.62,M.accent,0,0,-.25,joint);
     const head=group('scorpion-side-sting',0,0,-.53,joint);
     for(const s of [-1,1])box(.055,.10,.35,M.accent,s*.13,0,-.06,head);
     box(.30,.08,.06,M.trim,0,0,.10,head);box(.22,.025,.16,light,0,.06,0,head);
     for(const j of [root,joint])add(new THREE.CylinderGeometry(.09,.09,.15,8),M.trim,0,0,0,j);
     move(root,.02,.43,q=>{reveal(root,q);root.rotation.y=side*.18*q;root.scale.x=Math.max(.001,q);});
     move(joint,.25,.73,q=>joint.rotation.y=-side*.4*q);move(head,.53,1,q=>head.rotation.y=side*.3*q);
   }
 } else if(id==='hatch') {
   squat=.035;drs=.23;
   for(const side of [-1,1]){
     const duck=group('hot-hatch-side-extension',side*.95,.55,-1.30);
     box(.40,.055,.62,M.carbon,side*.16,0,0,duck);box(.30,.022,.06,light,side*.16,.04,-.24,duck);
     move(duck,.03,.64,q=>{reveal(duck,q);duck.position.x=side*(.95+.22*q);duck.scale.x=Math.max(.001,q);duck.rotation.z=side*.12*q;});
   }
   for(const side of [-1,1])for(let i=0;i<3;i++){
     const g=group('fender-fan',side*.9,.67,1.03-i*.18);box(.13,.025,.14,M.accent,0,0,0,g);
     move(g,.32+i*.14,.58+i*.14,q=>g.rotation.z=side*.85*q);
   }
 } else if(id==='roadster') {
   drs=0;
   // 전쟁 전 레코드카처럼 긴 방울형 토노와 옆 흡기 트럼펫. 운전석은 열어 둔다.
   for(const side of [-1,1]){
     const tonneau=group('folding-speed-hump',side*.43,.72,-1.23);
     slab([[-.19,.45],[.19,.45],[.22,-.44],[0,-.83],[-.22,-.44]],.075,M.accent,tonneau);
     box(.028,.025,.9,M.trim,0,.03,-.10,tonneau);
     move(tonneau,side<0?.02:.25,side<0?.58:.82,q=>{reveal(tonneau,q);tonneau.position.y=.72+.015*q;tonneau.rotation.x=-.04*q;tonneau.scale.set(1.30,.80,1.10);});
     const horn=group('side-ram-trumpet',side*.79,.63,.80);cyl(.19,.105,.51,M.metal,0,0,0,horn,true);add(new THREE.CircleGeometry(.09,10),M.dark,0,0,.17,horn);
     move(horn,.51,.98,q=>{reveal(horn,q);horn.position.x=side*(.79+.14*q);});
   }
 } else if(id==='trophy'||id==='pickup') {
   const farm=id==='pickup';squat=.025;drs=0;
   const base=group(farm?'pickup-bed-machine':'desert-radiator-lift',0,.92,-1.48);
   box(1.15,.09,.90,M.carbon,0,0,0,base);
   for(const side of [-1,1]){
     box(.07,.47,.08,M.metal,side*.47,-.18,0,base);
     if(farm){
       const stack=group('pickup-twin-stack',side*.44,.13,-.25,base);cyl(.12,.12,.75,M.darkMetal,0,0,0,stack,true).rotation.x=0;
       box(.18,.48,.18,M.carbon,0,.15,0,stack);cyl(.14,.12,.26,M.trim,0,.43,.12,stack).rotation.x=.95;
     }else{
       const fan=turbine('desert-cooling-fan',side*.29,.24,-.12,.37,base);fan.rotation.x=-.33;
     }
   }
   if(farm){box(.74,.20,.64,M.accent,0,.16,.02,base);box(.60,.035,.025,light,0,.27,.35,base);}
   else box(1.0,.03,.10,M.trim,0,.50,0,base);
   move(base,.12,.87,q=>{reveal(base,q);base.position.y=.72+.025*q;base.scale.set(1.2,.52,1.10);base.rotation.x=-(farm?.05:.12)*q;});
   base.userData.continuous=!farm;
   for(const side of [-1,1])hinge('bed-hatch',side,.6,.96,-1.38,.28,.94,.02,.40,.92,M.accent);
 } else if(id==='cube') {
   drs=0;hop=.025;
   // 짐/서프보드와 겹치지 않게 지붕 뒤 오버행에 힌지로 연결한 리프트.
   const lift=group('cargo-low-fan',0,.36,-1.75);
   for(const side of [-1,1])box(.055,.53,.055,M.metal,side*.34,.26,-.12,lift);
   box(.82,.07,.58,M.carbon,0,.52,-.18,lift);
   for(const side of [-1,1]){box(.12,.31,.60,M.accent,side*.31,.77,-.18,lift);box(.055,.46,.055,M.carbon,side*.34,.25,-.12,lift);}
   const jet=turbine('roof-turbofan',0,.65,-.21,.52,lift);
   box(.055,.21,.12,M.carbon,0,-.34,0,jet);
   move(lift,.23,.92,q=>{reveal(lift,q);lift.scale.set(1.45,Math.max(.001,.48*q),.80);});lift.userData.continuous=true;
   for(const side of [-1,1])hinge('van-delivery-wing',side,.91,.65,-.82,.75,1.50,.02,.55,.18,M.accent);
 } else if(id==='razor') {
   squat=.06;drs=.22;
   // 뒤 창 위 부채꼴 계단 루버. 날카로운 쐐기 꼬리가 순서대로 펼쳐짐.
   for(let i=0;i<5;i++){
     const g=group('wedge-stair-blade',0,.82+i*.008,-.85-i*.25);
     slab([[-.76,0],[.76,0],[1.16,-.44],[-1.16,-.44]],.035,i%2?M.carbon:M.accent,g);
     box(1.16,.012,.025,M.trim,0,.022,-.22,g);
     move(g,.02+i*.12,.32+i*.12,q=>{g.rotation.x=-.08*q;g.position.y=.82+i*.008;g.position.z=-.85-i*.25-.04*q;});
   }
   for(const side of [-1,1])hinge('razor-splitter',side,.82,.25,2.10,.33,.72,.50,.98,-.20,M.carbon);
 }

 // 낮아진 차고와 넓어진 트랙. 차체/뒷날개 길이는 늘리지 않고 중앙을 비워 둔다.
 // [바퀴 한쪽 확장, 3차 차체 폭/길이 참고값, 차고 하강, 어두운 차의 빛 보조색]
 const stance={
   f1:[.28,.055,.04,.10,'#52cfff'], junior:[.25,.04,.035,.08,'#ffda4c'],
   proto:[.27,.07,.07,.11,'#52a7ff'], nova:[.30,.075,.08,.11,'#cc84ff'],
   hyper:[.32,.075,.055,.12,'#37e7ff'], volt:[.26,.06,.045,.10,'#3bffe0'],
   gt:[.27,.075,.035,.11,'#ffbd45'], midnight:[.28,.07,.05,.11,'#ad72ff'],
   muscle:[.31,.065,.025,.12,'#ff7834'], rocket:[.34,.04,.06,.08,'#a970ff'],
   rally:[.29,.065,.025,.09,'#a5ff47'], blizzard:[.28,.06,.03,.09,'#91e9ff'],
   buggy:[.30,.05,.03,.09,'#ff7545'], scorpion:[.32,.06,.035,.10,'#ffdc37'],
   kart:[.23,.04,.03,.065,'#ff4b91'], hatch:[.25,.07,.04,.10,'#ff5da8'],
   roadster:[.25,.045,.08,.09,'#ffdf97'], trophy:[.31,.055,.03,.12,'#ff9752'],
   pickup:[.32,.05,.04,.12,'#ffc26b'], cube:[.27,.04,.045,.10,'#ff9c4d'],
   razor:[.29,.075,.055,.11,'#ff404e'],
 }[id]||[.26,.05,.04,.10,'#62caff'];
 const [trackOut,wide3,long3,drop,heat]=stance;
 const bodyWide=Math.min(wide3,.025),bodyLong=0;
 const colour=new THREE.Color(look.costume?look.trim:look.body||heat);
 if(colour.getHSL({}).l<.12)colour.set(look.accent);
 if(colour.getHSL({}).l<.12)colour.set(heat);
 light.color.copy(colour).lerp(new THREE.Color('white'),.16);light.emissive.copy(colour);
 // 차마다 다른 바닥 가장자리: 사다리꼴/쐐기/둥근 보트테일. 넓어진 바퀴까지 이어진다.
 const sillShape={
   f1:[.28,.48,.36],junior:[.38,.32,.32],proto:[.32,.37,.58],nova:[.48,.24,.68],
   hyper:[.60,.18,.64],volt:[.44,.46,.34],gt:[.34,.48,.35],midnight:[.24,.53,.54],
   muscle:[.28,.51,.28],rocket:[.16,.35,.70],rally:[.40,.43,.24],blizzard:[.51,.32,.27],
   buggy:[.36,.29,.34],scorpion:[.59,.16,.48],kart:[.29,.36,.18],hatch:[.31,.44,.37],
   roadster:[.18,.43,.66],trophy:[.42,.46,.20],pickup:[.25,.50,.38],cube:[.35,.39,.42],razor:[.65,.10,.72],
 }[id];
 const axle=Math.max(...A.wheels.map(w=>Math.abs(w[0])));
 const small=id==='kart';
 for(const side of [-1,1]) {
   const g=group('wide-'+id+'-sill',side*(axle-.20),small?.22:.29,small?-.25:-.48);
   const [front,middle,tail]=sillShape, len=small?1.25:2.50;
   slab([[0,len*.46],[side*front,len*.34],[side*middle,-len*.20],[side*tail,-len*.57],[0,-len*.65]],.075,M.carbon,g);
   box(.055,.035,len*.75,light,side*middle*.80,.025,-.05,g);
   box(.13,.055,len*.60,M.accent,side*.10,.03,-.15,g);
   move(g,.08+(side>0?.06:0),.59,q=>{reveal(g,q);g.scale.x=Math.max(.001,q);});
 }
 // 추진부도 전용 실루엣: 직사각 벤투리, 삼각 제트, 타원 배기, 전기 고리.
 // 단면 도형만 공유하고 개수·비율·위치·벌어지는 방향은 21대 각각 정한다.

 const port=(name,x,y,z,w,h,d,shape='slot',cant=0)=>{
   // 차마다 다른 범퍼 끝. 공통 z 제한으로 프로토 배기가 차체 속에 묻히던 문제 제거.
   const rear={f1:-2.42,junior:-2.42,proto:-2.66,nova:-2.66,hyper:-2.69,volt:-2.78,gt:-2.66,midnight:-2.66,muscle:-2.63,rally:-2.24,blizzard:-2.24,hatch:-2.13,roadster:-2.28,trophy:-2.40,pickup:-2.40,cube:-2.09,scorpion:-2.08,razor:-2.41}[id];
   const settings={proto:[.66,.44,.36],nova:[.67,.51,.48],hyper:[.73,.55,.32],volt:[.60,.61,.40],muscle:[.72,.62,.36],roadster:[.48,.40,.40],trophy:[.69,.54,.39],pickup:[.66,.48,.42],scorpion:[.72,.45,.43]}[id];
   if(settings){x=Math.sign(x)*settings[0];w=settings[1];h=settings[2];}else h*=.78;
   y=Math.min(y,id==='volt'?.49:.46);d=Math.min(.46,d*.68);
   const g=group(name,x,y,rear+.12);
   // 고정 받침은 범퍼 내부까지 들어가고 관 앞쪽과 겹쳐 붙는다.
   const fixed=group(name+'-mount',x,y,rear+.13);
   box(w*1.04,h*1.02,.12,M.carbon,0,0,0,fixed);
   for(const s of [-1,1])box(.045,h*1.08,.17,M.metal,s*w*.50,0,-.035,fixed);
   if(id==='f1'||id==='junior')box(w*.70,.14,.52,M.carbon,-Math.sign(x)*.14,-h*.55,.20,fixed);
   move(fixed,.22,.54,q=>reveal(fixed,q),false);
   // 받침 속에서 뒤로 미끄러져 나온다. 관 지름은 일정하다.
   move(g,.32+(x>0?.07:0),.91,q=>{reveal(g,q);g.position.z=rear+.12-.23*q;g.rotation.z=cant*q;},false);
   if(id==='midnight'){
     for(const s of [-1,1]){const outlet=group('night-separated-throat',s*w*.255,0,0,g);emitters.push(throat(outlet,w*.46,h,d,'slot'));}
   }else emitters.push(throat(g,w,h,d,shape));
   return g;
 };
 switch(id) {
   case 'f1':for(const s of [-1,1])port('f1-twin-venturi',s*.72,.62,-2.46,.78,.32,.62,'split');break;
   case 'junior':for(const s of [-1,1])port('junior-canted-duct',s*.77,.57,-2.28,.54,.42,.54,'slot',s*.26);break;
   case 'proto':for(const s of [-1,1])port('longtail-outlet',s*.79,.68,-2.91,.44,.56,.72,'split');break;
   case 'nova':for(const s of [-1,1])port('nova-ion-keel',s*.92,.69,-3.05,.63,.75,.62,'delta',s*.20);break;
   case 'hyper':for(const s of [-1,1])port('hyper-blade-jet',s*1.08,.73,-2.12,.82,.48,.82,'delta',s*.33);break;
   case 'volt':for(const s of [-1,1])port('volt-induction-ring',s*.70,.81,-2.20,.90,.90,.46,'ring');break;
   case 'gt':for(let i=-1;i<=1;i++)port('gt-triple-header',i*.77,.54,-2.18,.62,.43,.55,'oval');break;
   case 'midnight':for(const s of [-1,1])port('night-quad-slot',s*.75,.54,-2.23,.88,.29,.66,'split');break;
   case 'muscle':for(const s of [-1,1])port('muscle-big-block-exhaust',s*1.14,.62,-2.13,.82,.56,.66,'oval',s*-.23);break;
   case 'rally':port('rally-box-turbo',0,.79,-2.04,1.74,.42,.58,'split');break;
   case 'blizzard':for(const s of [-1,1])port('polar-square-jet',s*.86,.68,-2.05,.65,.46,.66,'slot',s*.16);break;
   case 'hatch':port('hatch-center-megaphone',0,.57,-2.07,1.22,.43,.64,'slot');break;
   case 'roadster':for(const s of [-1,1])port('record-chrome-fishtail',s*.68,.62,-2.50,.40,.66,.84,'oval',s*-.20);break;
   case 'trophy':for(const s of [-1,1])port('baja-underslung-jet',s*.98,.76,-2.34,.70,.47,.69,'delta',s*-.18);break;
   case 'pickup':for(const s of [-1,1])port('farm-stack-elbow',s*.90,.79,-2.10,.60,.72,.73,'oval');break;
   case 'cube':port('van-low-cargo-jet',0,.72,-2.02,1.46,.42,.58,'split');break;
   case 'scorpion':for(const s of [-1,1])port('scorpion-stinger-jets',s*.84,.72,-1.98,.62,.65,.55,'delta',s*.30);break;
   case 'razor':port('razor-letterbox-drive',0,.61,-2.35,2.15,.25,.74,'split');break;
   // rocket/buggy/kart는 위의 전용 원형 엔진을 크게 키워 사용한다.
 }

 if(id==='rally')for(const side of [-1,1]){
   const g=group('rally-foldout-mudguard',side*.94,.65,-1.48);
   slab([[0,.62],[side*.28,.76],[side*.67,.05],[side*.58,-.78],[0,-.64]],.055,M.accent,g);
   box(.045,.18,.72,M.paint,side*.61,.04,-.32,g);
   box(.045,.035,.72,light,side*.58,.055,-.22,g);
   move(g,.28+(side>0?.12:0),.85,q=>{reveal(g,q);g.scale.x=Math.max(.001,q);g.rotation.z=side*.20*q;});
 }
 // 포뮬러는 낮고 폭넓은 보조판. 가운데를 높이 올리지 않는다.
 if(id==='f1'||id==='junior')for(const s of [-1,1]) {
   const junior=id==='junior';
   const g=group('formula-wide-endplane',s*1.10,.43,-.90);
   slab(junior?[[0,.25],[s*.52,.32],[s*.77,-.36],[s*.58,-.50],[0,-.42]]:[[0,.27],[s*.66,.40],[s*.98,-.30],[s*.83,-.54],[0,-.52]],.055,junior?M.paint:M.accent,g);
   if(junior)box(.56,.045,.20,M.accent,s*.40,.13,-.14,g);
   box(.045,junior?.17:.25,junior?.43:.66,M.carbon,s*(junior?.73:.88),.10,-.13,g);
   box(junior?.43:.55,.045,.04,light,s*.44,.025,-.47,g);
   move(g,id==='junior'?.12:.43,.94,q=>{reveal(g,q);g.scale.set(Math.max(.001,.68*q),1,.68);g.rotation.x=-.04*q;});
 }
 // 낮은 옆면 흐름 빛. 완료 병합 뒤에도 독립 갱신.
 const flow=group('low-flow-'+id);flow.userData.continuous=true;
 const idx=Object.keys(SPECS).indexOf(id),cells=3+idx%3;
 const fxMat=new THREE.MeshBasicMaterial({color:colour,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});fxMat.userData.live=true;
 const strips=[];
 const cell=(w,h,d,x,y,z,i,side,angle=0)=>strips.push({w,h,d,x,y,z,i,side,angle});
 for(const side of [-1,1]){
   for(let i=0;i<cells;i++)cell(.04,.025,.20+(idx%3)*.055,side*(axle+trackOut+.045),small?.25:.34,.65-i*(small?.34:.56),i,side,side*(idx%2?.12:-.12));
   cell(.07,.035,small?.36:.58,side*(small?.56:.83),small?.30:.44,small?-1.4:-2.28,cells,side);
   cell(small?.22:.36,.045,.035,side*(small?.62:axle+.05),small?.31:.40,small?-1.46:-2.38,cells+1,side);
 }
 // 모든 움직이는 빛 조각을 한 번에 그린다. batchLocal이 인스턴스를 합치지 않는다.
 const stream=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),fxMat,strips.length);
 stream.instanceMatrix.setUsage(THREE.DynamicDrawUsage);stream.frustumCulled=false;flow.add(stream);
 const cellPose=new THREE.Object3D();
 spinners.push((p,t)=>{
   const q=smooth(phase(p,.54,1));flow.visible=q>.001;fxMat.opacity=.78*q;
   strips.forEach((s,j)=>{const wave=(t*(1.7+(idx%4)*.22)+s.i/cells+(s.side>0?.18:0))%1;
     cellPose.position.set(s.x,s.y,s.z);cellPose.rotation.set(0,s.angle,0);cellPose.scale.set(s.w,s.h,s.d*(.45+.55*Math.sin(wave*Math.PI)**2));cellPose.updateMatrix();stream.setMatrixAt(j,cellPose.matrix);
   });stream.instanceMatrix.needsUpdate=true;
 });
 // 기존 배기에도 차별/코스튬 색 적용. live 재질은 공유 병합에 섞이지 않는다.
 kit.traverse(m=>{if(m.isMesh&&m.material.isMeshBasicMaterial&&m.material.transparent&&m.material.userData.live)m.material.color.copy(colour);});
 const fire=buildFire(body,emitters,id,colour);
 squat=Math.max(squat,drop);

 kit.traverse(m=>{if(m.isMesh)m.userData.accelMoving=true;});
 for(const f of shell.accelFlaps||[])f.traverse(m=>{if(m.isMesh)m.userData.accelMoving=true;});
 shell.blower?.traverse(m=>{if(m.isMesh)m.userData.accelMoving=true;});
 // 전개 완료 시 정지한 기구만 body 좌표로 병합. 팬/불꽃/벨트는 계속 독립 회전.
 let locked=null,parked=[];
 function unlock(){if(!locked)return;locked.traverse(m=>m.geometry?.dispose());locked.removeFromParent();locked=null;for(const {part,parent}of parked)parent.add(part);parked=[];}
 function lockKit(){
   if(locked)return;
   const roots=kit.children.filter(o=>!o.userData.continuous);
   body.updateWorldMatrix(true,true);const inv=new THREE.Matrix4().copy(body.matrixWorld).invert(),matrix=new THREE.Matrix4(),bins=new Map();
   for(const part of roots)part.traverse(m=>{
     if(!m.isMesh)return;for(let q=m;q&&q!==body;q=q.parent)if(!q.visible)return;
     const key=[m.material.uuid,m.layers.mask,m.castShadow?1:0,Object.keys(m.geometry.attributes).sort().join(',')].join('|');
     if(!bins.has(key))bins.set(key,{sample:m,geos:[]});matrix.multiplyMatrices(inv,m.matrixWorld);const geo=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();bins.get(key).geos.push(geo.applyMatrix4(matrix));
   });
   locked=new THREE.Group();locked.name='accel-locked-'+id;body.add(locked);
   for(const {sample,geos}of bins.values()){
     const geometry=mergeGeometries(geos,false);for(const g of geos)g.dispose();
     if(!geometry){unlock();return;}const mesh=new THREE.Mesh(geometry,sample.material);mesh.layers.mask=sample.layers.mask;mesh.castShadow=sample.castShadow;mesh.userData.accelMoving=true;locked.add(mesh);
   }
   parked=roots.map(part=>({part,parent:part.parent}));for(const {part}of parked)part.removeFromParent();
 }
 return {
   ...profile,drs,squat,pitch,trackOut,bodyWide,bodyLong,colour,
   dispose(){unlock();stream.dispose();fire.dispose();},
   pose(p,other=0,time=0,throttle=.7,speed=0,dt=1/60){
     if(p<1||other>.1)unlock();
     kit.visible=p>.001&&other<.35;
     // 완료 병합에 포함되지 않는 기존 날개도 매번 절대값으로 배치.
     for(const fn of motions)fn(p);
     for(const fn of spinners)fn(p,time);
     if(locked)locked.visible=kit.visible;
     light.emissiveIntensity=.65+2.3*smooth(phase(p,.60,1));
     hotWall.emissiveIntensity=(.30+2.7*smooth(phase(p,.69,.97)))*(.70+.30*clamp(throttle));
     const k=smooth(phase(p,.12,.92));body.position.y-=squat*k;
     body.position.y+=hop*Math.sin(phase(p,.1,.95)*Math.PI*2)**2*(p<1?1:0);
     body.rotation.x+=pitch*k;
     fire.update(p,other,time,throttle,speed,dt);
     if(p>=1&&other<.1)lockKit();
   },
 };
}
