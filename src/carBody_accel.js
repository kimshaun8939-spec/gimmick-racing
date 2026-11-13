// accel2: 21대의 전용 기구·순서. 공용인 것은 기하 도우미와 완료 뒤 병합뿐.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const clamp=x=>Math.max(0,Math.min(1,x));
const phase=(p,a,b)=>clamp((p-a)/(b-a));
const smooth=x=>x*x*(3-2*x);
const back=x=>x<=0?0:x>=1?1:1+2.3*(x-1)**3+1.3*(x-1)**2;
// [초, 소리 성격, 단계 시각(진행도), 시작/끝 주파수]
const SPECS={
 f1:[.84,'precision',[.08,.19,.30,.43,.60,.83],560,1160], junior:[.94,'ratchet',[.12,.25,.48,.72,.89],420,880],
 proto:[1.24,'hydraulic',[.09,.34,.63,.93],115,310], nova:[1.32,'electric',[.10,.29,.57,.77,.95],230,780],
 hyper:[1.12,'silk',[.08,.31,.53,.91],310,820], volt:[1.02,'electric',[.12,.26,.40,.54,.84],520,1380],
 gt:[1.16,'blower',[.06,.24,.52,.86],145,380], midnight:[.96,'precision',[.10,.36,.58,.89],360,940],
 muscle:[1.34,'heavy',[.08,.40,.71,.94],75,170], rocket:[1.38,'heavy',[.08,.28,.58,.91],90,240],
 rally:[1.06,'ratchet',[.08,.29,.49,.71,.91],220,580], blizzard:[1.18,'hydraulic',[.10,.36,.64,.92],160,390],
 buggy:[.90,'pop',[.19,.47,.81],250,690], scorpion:[1.22,'ratchet',[.10,.33,.57,.89],130,450],
 kart:[.82,'pop',[.14,.41,.76],440,1040], hatch:[.98,'ratchet',[.09,.32,.56,.88],320,720],
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

export function buildAccelKit({body,spoiler,A,M,look,add,light,shell}) {
 const profile=accelProfile(look),id=profile.id;
 const kit=new THREE.Group();kit.name='accel-'+id;body.add(kit);
 const motions=[],spinners=[];
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
   add(new THREE.CircleGeometry(r*.86,12).rotateY(Math.PI),M.dark,0,0,-.24,g);
   const rotor=group('rotor',0,0,-.28,g);
   for(let i=0;i<5;i++){const blade=box(r*.13,.025,r*.7,M.metal,0,0,0,rotor);blade.geometry.rotateX(Math.PI/2).translate(0,r*.48,0).rotateZ(i*Math.PI*2/5);}
   cyl(r*.16,r*.18,.10,M.trim,0,0,-.29,g);
   spin(rotor,'z',22);g.userData.continuous=true;return g;
 };
 const exhaust=(name,x,y,z,r,parent=kit)=>{
   const g=group(name,x,y,z,parent);cyl(r*.78,r,.38,M.darkMetal,0,0,0,g,true);
   add(new THREE.TorusGeometry(r,.025,4,10),M.trim,0,0,-.20,g);
   add(new THREE.CircleGeometry(r*.72,10).rotateY(Math.PI),M.dark,0,0,-.17,g);
   const flameMat=new THREE.MeshBasicMaterial({color:look.costume?look.trim:'#ffab45',transparent:true,opacity:.65,depthWrite:false,blending:THREE.AdditiveBlending});flameMat.userData.live=true;
   const flame=add(new THREE.ConeGeometry(r*.75,.55,8,1,true).rotateX(-Math.PI/2).translate(0,0,-.27),flameMat,0,0,-.21,g);
   spinners.push((p,t)=>{flame.visible=p>.86;flame.scale.z=.55+.12*Math.sin(t*39);});
   g.userData.continuous=true;return g;
 };
 let squat=.025,pitch=0,hop=0,drs=.12;
 if(id==='f1'||id==='junior') {
   const junior=id==='junior'; drs=junior?.42:.92;
   // 실제 앞날개 3단. 어린 포뮬러는 양쪽 끝판을 먼저 접는 다른 리듬.
   for(const [n,f]of (shell.accelFlaps||[]).entries()){const i=n%3;move(f,junior?.40+i*.10:.04+i*.11,junior?.67+i*.10:.20+i*.11,q=>f.rotation.x=-(junior?.30:.52)*q,false);}
   for(const side of [-1,1]) {
     if(junior) {
       const g=hinge('junior-outrigger',side,.77,.43,-.78,.37,.80,.02,.42,-.78,M.carbon);
       box(.3,.035,.12,M.accent,side*.18,.02,-.28,g);
     } else for(let i=0;i<5;i++) {
       const g=group('sequential-cooling-louver',side*(.56-i*.028),.727-i*.012,-.28-i*.16);
       box(.29,.022,.115,M.carbon,0,0,0,g);box(.27,.009,.018,M.trim,0,.014,-.045,g);
       move(g,.30+i*.075,.48+i*.075,q=>g.rotation.x=-.92*q,false);
     }
   }
 } else if(id==='proto'||id==='nova') {
   const nova=id==='nova'; squat=.045; drs=.26;
   if(!nova){
     const g=group('telescopic-shark',0,1.06,-1.2);
     fin([[.45,0],[.2,.48],[-1.18,.66],[-1.40,0]],.034,M.carbon,g);
     box(.04,.028,1.30,M.trim,0,.40,-.5,g).rotation.x=.14;
     move(g,.03,.45,q=>{reveal(g,q);g.scale.y=Math.max(.001,q);});
   }else for(const side of [-1,1]){
     const g=group('nova-split-keel',side*.39,.87,-1.9);
     fin([[.50,0],[.10,.62],[-.80,.90],[-.95,0]],.045,M.carbon,g);
     fin([[.12,.56],[-.78,.87],[-.82,.78],[.04,.49]],.05,M.trim,g);
     move(g,.10+(side>0?.13:0),.65,q=>{reveal(g,q);g.rotation.z=side*.35*q;g.scale.y=Math.max(.001,q);});
   }
   const tail=group(nova?'nova-tail-bridge':'longtail-sleeve',0,.65,-2.30);
   slab([[-.72,.24],[.72,.24],[.64,-.70],[.36,-1.02],[-.36,-1.02],[-.64,-.70]],.06,M.carbon,tail);
   for(const side of [-1,1]){
     fin([[.24,-.12],[.24,.14],[-.62,.12],[-1.00,.02],[-1.00,-.10]],.045,M.carbon,tail).position.x=side*.57;
     box(.12,.025,.70,M.accent,side*.55,.13,-.24,tail);
     box(.12,.02,.06,light,side*.52,.10,-.72,tail);
     const shutter=group('headlamp-shutter',side*.7,.48,2.48);
     box(.38,.045,.45,M.carbon,0,0,0,shutter);
     move(shutter,.69,.97,q=>{reveal(shutter,q);shutter.scale.z=Math.max(.001,q);},false);
   }
   move(tail,nova?.48:.25,1,q=>{reveal(tail,q);tail.position.z=-2.05-.58*q;tail.scale.z=Math.max(.001,q);});
 } else if(id==='hyper') {
   squat=.085;drs=.35;
   for(const side of [-1,1]){
     const g=group('butterfly-aero',side*.89,.65,-.28);
     slab([[0,.68],[side*.28,.54],[side*.82,-.48],[side*.59,-1.1],[0,-.80]],.035,M.carbon,g);
     box(.055,.022,1.15,M.trim,side*.51,.02,-.28,g).rotation.y=side*.20;
     box(.045,.10,.15,M.darkMetal,0,-.05,.46,g);
     move(g,.07+(side>0?.09:0),.78,q=>g.rotation.z=side*.94*q);
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
     const g=group('battery-cooling-petal',side*.91,.61,.36-i*.36);
     slab([[0,.12],[side*.42,.18],[side*.48,-.13],[0,-.13]],.025,M.carbon,g);
     box(.28,.012,.018,light,side*.23,.018,.07,g);
     move(g,.04+i*.13,.30+i*.13,q=>{g.rotation.z=side*.52*q;g.position.x=side*(.91+.08*q);});
   }
   const bridge=group('induction-bridge',0,.69,-2.25);
   for(const side of [-1,1])box(.045,.36,.08,M.trim,side*.64,.18,0,bridge);
   box(1.32,.045,.08,M.carbon,0,.36,0,bridge);box(1.16,.015,.03,light,0,.382,0,bridge);
   move(bridge,.53,1,q=>{reveal(bridge,q);bridge.scale.y=Math.max(.001,q);});
 } else if(id==='gt') {
   squat=.045;drs=.18;
   for(const side of [-1,1])hinge('split-bonnet',side,.31,.80,1.40,.29,.73,.02,.32,1.12,M.accent);
   const blower=group('triple-trumpet',0,.79,1.40);
   box(.52,.17,.68,M.darkMetal,0,.085,0,blower);box(.53,.035,.60,M.metal,0,.17,0,blower);
   for(let i=-1;i<=1;i++){cyl(.09,.065,.24,M.metal,i*.16,.26,.19,blower,true);add(new THREE.CircleGeometry(.073,10),M.dark,i*.16,.26,.315,blower);}
   move(blower,.24,.69,q=>{reveal(blower,q);blower.position.y=.79+.22*q;blower.scale.y=Math.max(.001,q);});
   for(const side of [-1,1]){
     const pipe=exhaust('side-exhaust',side*1.0,.35,-.3,.10);
     pipe.rotation.y=-side*Math.PI/2;
     box(.44,.04,.22,M.carbon,0,-.1,.10,pipe);
     move(pipe,.55,.94,q=>{reveal(pipe,q);pipe.position.x=side*(1+.27*q);});
   }
 } else if(id==='midnight') {
   squat=.065;drs=.36;
   for(const side of [-1,1]){
     const g=group('night-swing-wing',side*.48,1.13,-2.20);
     slab([[0,.18],[side*.67,.26],[side*.98,-.3],[side*.25,-.47],[0,-.27]],.035,M.carbon,g);
     box(.55,.015,.035,M.trim,side*.46,.025,-.26,g);
     box(.045,.28,.08,M.darkMetal,0,-.14,0,g);
     move(g,side<0?.03:.23,side<0?.60:.80,q=>{reveal(g,q);g.rotation.y=-side*(1-q)*1.40;g.position.y=1.13+.14*q;});
     for(let i=0;i<3;i++)radiator('night-quarter-gill',side*1.01,.65,-.6-i*.21,.16,.16,.55+i*.07,.83+i*.07);
   }
 } else if(id==='muscle') {
   squat=.085;pitch=-.015;drs=0;
   // 원래 블로워 자체를 올리고 흡기 나비판·벨트를 구동.
   if(shell.blower){move(shell.blower,.12,.62,q=>shell.blower.position.y=.23*q);for(const f of shell.butterflies||[])move(f,.44,.88,q=>f.rotation.x=-1.12*q);}
   const belt=group('blower-drive',0,.95,1.78);
   add(new THREE.TorusGeometry(.11,.025,4,12),M.carbon,0,0,0,belt);
   const pulley=group('belt-pulley',0,0,.01,belt);for(let i=0;i<3;i++)box(.18,.022,.02,M.trim,0,0,0,pulley).rotation.z=i*Math.PI/3;
   spin(pulley,'z',32);belt.userData.continuous=true;
   move(belt,.20,.65,q=>{reveal(belt,q);belt.position.y=.95+.23*q;});
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
   const engine=exhaust('single-main-rocket',0,0,0,.30,cradle);
   for(let i=0;i<3;i++)add(new THREE.TorusGeometry(.21+i*.023,.024,4,12),M.metal,0,0,.13-i*.12,engine);
   move(cradle,.22,.83,q=>{reveal(cradle,q);cradle.position.z=-2.1-.63*q;cradle.rotation.z=Math.PI*.5*(1-q);});
   cradle.userData.continuous=true;
   const bar=group('wheelie-bar',0,.20,-2.0);for(const side of [-1,1])box(.045,.045,.95,M.carbon,side*.30,0,-.46,bar);
   cyl(.07,.07,.65,M.rubber,0,0,-.95,bar).rotation.y=Math.PI/2;
   move(bar,.61,1,q=>{reveal(bar,q);bar.scale.z=Math.max(.001,q);});
 } else if(id==='rally'||id==='blizzard') {
   const snow=id==='blizzard';drs=.08;
   if(!snow){
     const scoop=group('rally-roof-mouth',0,1.29,-.40);
     box(.58,.18,.57,M.carbon,0,.09,0,scoop);box(.47,.09,.025,M.dark,0,.11,.30,scoop);box(.53,.04,.58,M.accent,0,.20,0,scoop);
     move(scoop,.03,.42,q=>{reveal(scoop,q);scoop.scale.y=Math.max(.001,q);});
   }else for(const side of [-1,1]){
     const g=group('polar-snorkel',side*.93,.80,.66);
     box(.13,.60,.15,M.carbon,0,.30,0,g);box(.22,.12,.32,M.accent,0,.62,.04,g);box(.15,.07,.025,M.dark,0,.64,.21,g);
     move(g,.02+(side>0?.1:0),.56,q=>{reveal(g,q);g.scale.y=Math.max(.001,q);});
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
     const x=kart?.57:.79,y=kart?.47:.91,z=kart?-1.10:-1.66;
     const pod=exhaust(kart?'soda-rocket':'spring-rocket',side*x,y,z,kart?.15:.19);
     box(.06,.22,.18,M.carbon,0,-.17,.1,pod);
     if(kart){
       add(new THREE.TorusGeometry(.16,.025,4,10),M.accent,0,0,.06,pod);
       box(.12,.07,.09,M.accent,0,.20,.02,pod);
     }else fin([[.16,0],[-.2,.23],[-.2,0]],.035,M.accent,pod).position.x=side*.14;
     move(pod,side<0?.05:.34,side<0?.45:.74,q=>{reveal(pod,q);pod.position.y=y+(kart?.23:.28)*q;pod.position.x=side*(x+.18*q);pod.rotation.y=-side*.12*q;});
   }
 } else if(id==='scorpion') {
   drs=0;
   // 전갈 꼬리: 차체 뒤 엔진에 붙은 3관절. 로켓 쌍둥이 대신 하나의 집게형 흡기.
   const root=group('scorpion-tail-root',0,.98,-1.60);
   box(.22,.58,.20,M.carbon,0,.29,0,root);
   const joint=group('scorpion-tail-elbow',0,.56,0,root);box(.17,.76,.17,M.accent,0,.38,0,joint);
   const head=group('scorpion-tail-sting',0,.74,0,joint);
   box(.48,.18,.40,M.carbon,0,.05,.10,head);box(.39,.07,.025,light,0,.06,.315,head);
   for(const side of [-1,1])fin([[.02,0],[.40,.08],[.45,-.03],[.03,-.11]],.04,M.trim,head).position.x=side*.23;
   for(const j of [root,joint,head]){const hub=add(new THREE.CylinderGeometry(.12,.12,.27,10).rotateZ(Math.PI/2),M.trim,0,0,0,j);hub.castShadow=false;}
   move(root,.02,.43,q=>{reveal(root,q);root.rotation.x=-1.1*(1-q);});
   move(joint,.25,.73,q=>joint.rotation.x=-.65*q);move(head,.53,1,q=>head.rotation.x=.95*q);
 } else if(id==='hatch') {
   squat=.035;drs=.23;
   const duck=group('hot-hatch-roof-extension',0,1.32,-1.70);
   box(1.34,.055,.58,M.carbon,0,0,-.10,duck);box(1.28,.022,.06,M.accent,0,.04,-.34,duck);
   for(const side of [-1,1])box(.045,.24,.09,M.trim,side*.48,-.12,.02,duck);
   move(duck,.03,.64,q=>{reveal(duck,q);duck.position.y=1.32+.20*q;duck.position.z=-1.70-.36*q;duck.rotation.x=-.23*q;});
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
     move(tonneau,side<0?.02:.25,side<0?.58:.82,q=>{reveal(tonneau,q);tonneau.position.y=.72+.17*q;tonneau.rotation.x=-.14*q;});
     const horn=group('side-ram-trumpet',side*.79,.63,.80);cyl(.11,.065,.32,M.metal,0,0,0,horn,true);add(new THREE.CircleGeometry(.09,10),M.dark,0,0,.17,horn);
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
       const fan=turbine('desert-cooling-fan',side*.29,.24,-.12,.23,base);fan.rotation.x=-.33;
     }
   }
   if(farm){box(.74,.20,.64,M.accent,0,.16,.02,base);box(.60,.035,.025,light,0,.27,.35,base);}
   else box(1.0,.03,.10,M.trim,0,.50,0,base);
   move(base,.12,.87,q=>{reveal(base,q);base.position.y=.92+.41*q;base.rotation.x=-(farm?.18:.40)*q;});
   base.userData.continuous=!farm;
   for(const side of [-1,1])hinge('bed-hatch',side,.6,.96,-1.38,.28,.94,.02,.40,.92,M.accent);
 } else if(id==='cube') {
   drs=0;hop=.025;
   // 짐/서프보드와 겹치지 않게 지붕 뒤 오버행에 힌지로 연결한 리프트.
   const lift=group('roof-jet-lift',0,1.58,-1.88);
   for(const side of [-1,1])box(.055,.53,.055,M.metal,side*.34,.26,-.12,lift);
   box(.82,.07,.58,M.carbon,0,.52,-.18,lift);
   for(const side of [-1,1]){box(.12,.31,.60,M.accent,side*.31,.77,-.18,lift);box(.055,.46,.055,M.carbon,side*.34,.25,-.12,lift);}
   const jet=turbine('roof-turbofan',0,.85,-.21,.34,lift);
   box(.055,.21,.12,M.carbon,0,-.34,0,jet);
   move(lift,.23,.92,q=>{reveal(lift,q);lift.scale.y=Math.max(.001,q);});lift.userData.continuous=true;
   for(const side of [-1,1])hinge('van-delivery-wing',side,.91,1.0,-.82,.39,1.16,.02,.55,.95,M.accent);
 } else if(id==='razor') {
   squat=.06;drs=.22;
   // 뒤 창 위 부채꼴 계단 루버. 날카로운 쐐기 꼬리가 순서대로 펼쳐짐.
   for(let i=0;i<5;i++){
     const g=group('wedge-stair-blade',0,.96+i*.015,-.85-i*.25);
     slab([[-.61,0],[.61,0],[.84,-.28],[-.84,-.28]],.035,i%2?M.carbon:M.accent,g);
     box(1.16,.012,.025,M.trim,0,.022,-.22,g);
     move(g,.02+i*.12,.32+i*.12,q=>{g.rotation.x=-.48*q;g.position.y=.96+i*.015+i*.065*q;});
   }
   for(const side of [-1,1])hinge('razor-splitter',side,.82,.25,2.10,.33,.72,.50,.98,-.20,M.carbon);
 }
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
   ...profile,drs,squat,pitch,
   dispose:unlock,
   pose(p,other=0,time=0){
     if(p<1||other>.1)unlock();
     kit.visible=p>.001&&other<.35;
     // 완료 병합에 포함되지 않는 기존 날개도 매번 절대값으로 배치.
     for(const fn of motions)fn(p);
     for(const fn of spinners)fn(p,time);
     if(locked)locked.visible=kit.visible;
     light.emissiveIntensity=.40+.9*smooth(phase(p,.70,1));
     const k=smooth(phase(p,.12,.92));body.position.y-=squat*k;
     body.position.y+=hop*Math.sin(phase(p,.1,.95)*Math.PI*2)**2*(p<1?1:0);
     body.rotation.x+=pitch*k;
     if(p>=1&&other<.1)lockKit();
   },
 };
}
