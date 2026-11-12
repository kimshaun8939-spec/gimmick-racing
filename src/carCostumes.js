// 차종별 전용 복장. 데이터/선택/UI는 분리, 미리보기에는 잠긴 복장도 입힐 수 있음.
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
const catalog = await fetch(new URL('../data/costumes.json', import.meta.url), { cache: 'no-cache' })
  .then(r => r.ok ? r.json() : {}).catch(() => ({}));
const all = Object.entries(catalog).flatMap(([carId, rows]) => rows.map(c => ({ ...c, carId })));
const byId = new Map(all.map(c => [c.id, c]));
export function listCostumes(carId) { return (catalog[carId] || []).map(c => ({ ...c, carId, look: { ...c.look } })); }
export function costumeOf(id) { const c = byId.get(id); return c ? { ...c, look: { ...c.look } } : null; }
export function applyCostume(look, id) {
  const base = typeof look === 'object' && look ? look : { style: 'f1', body: look || '#e8463a' };
  const c = byId.get(id ?? base.costume);
  if (!c || (base.carId && base.carId !== c.carId)) return { ...base, costume: '' };
  return { ...base, ...c.look, carId: c.carId, costume: c.id };
}

// 차체 좌표로 투영하는 2면 도장 atlas: 위쪽은 보닛/지붕, 아래쪽은 좌우 측면.
// 무늬는 앞→뒤로 이어지는 큰 형태 두 개 이내. R=미사용, G=거칠기, B=금속.
function livery(c) {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;
  const finish=canvas.cloneNode(),g=canvas.getContext('2d'),f=finish.getContext('2d');
  const {body,accent,trim}=c.look, p=c.pattern;
  const metal=c.finish==='chrome', pearl=c.finish==='pearl', satin=c.finish==='satin';
  const role=color=>color===body?(metal?'rgb(0,68,225)':satin?'rgb(0,164,24)':'rgb(0,112,34)'):color===trim?'rgb(0,58,180)':'rgb(0,58,88)';
  function shape(pts,color){for(const ctx of [g,f]){ctx.fillStyle=ctx===g?color:role(color);ctx.beginPath();pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}}
  function stripe(pts,color,w){for(const ctx of [g,f]){ctx.strokeStyle=ctx===g?color:role(color);ctx.lineWidth=w;ctx.lineCap='butt';ctx.lineJoin='round';ctx.beginPath();pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();}}
  function rect(x,y,w,h,color){shape([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],color);}
  function twins(width=38,gap=14){for(const s of [-1,1])rect(0,256+s*(gap/2+width/2)-width/2,1024,width,accent);for(const s of [-1,1])rect(0,256+s*(gap/2+width)-3,1024,4,trim);}
  // 위/옆은 각자의 자연스러운 면 좌표를 사용. 양쪽 측면은 같은 진행 방향.
  rect(0,0,1024,1024,body);
  g.save();f.save();g.beginPath();g.rect(0,0,1024,512);g.clip();f.beginPath();f.rect(0,0,1024,512);f.clip();
  if(['heritage','carbon','chrome'].includes(p)){
    twins(p==='carbon'?27:37,p==='chrome'?22:14);
    if(p==='carbon'){for(const s of [-1,1])stripe([[0,256+s*164],[330,256+s*164],[800,256+s*214],[1024,256+s*214]],trim,5);}
  }else if(['flame','magma'].includes(p)){
    // 불꽃은 앞바퀴 뒤에서 시작, 꼬리 쪽으로 길게. 노즈는 비워 둔다.
    for(const s of [-1,1]){
      const Y=y=>256+s*y;
      shape([[240,Y(148)],[430,Y(125)],[620,Y(150)],[830,Y(75)],[710,Y(157)],[1024,Y(116)],[1024,Y(238)],[670,Y(220)],[480,Y(175)]],accent);
      stripe([[300,Y(153)],[470,Y(147)],[650,Y(177)],[860,Y(144)]],trim,7);
    }
  }else if(p==='petal'){
    // 꽃잎 하나를 길게 편 흐르는 리본. 흩뿌린 꽃무늬 없음.
    for(const s of [-1,1]){const Y=y=>256+s*y;shape([[0,Y(16)],[180,Y(26)],[650,Y(156)],[1024,Y(185)],[1024,Y(234)],[640,Y(207)],[160,Y(76)],[0,Y(64)]],accent);stripe([[0,Y(76)],[160,Y(88)],[640,Y(219)],[1024,Y(246)]],trim,5);}
  }else if(p==='circuit'){
    twins(22,18);for(const s of [-1,1]){const Y=y=>256+s*y;stripe([[0,Y(162)],[300,Y(162)],[470,Y(204)],[1024,Y(204)]],accent,31);stripe([[0,Y(181)],[296,Y(181)],[468,Y(225)],[1024,Y(225)]],trim,5);}
  }else if(p==='cosmos'){
    // 항공 테스트 팀: 중앙 척추 + 뒤쪽의 단 하나인 임무 띠.
    rect(0,220,1024,72,accent);for(const y of [211,297])rect(0,y,1024,5,trim);
    rect(730,0,98,512,accent);rect(716,0,7,512,trim);
  }else if(p==='scales'){
    // 뱀 테마를 두 줄의 창 끝 모양으로 절제. 비늘은 카본 부품에만.
    for(const s of [-1,1]){const Y=y=>256+s*y;shape([[0,Y(39)],[400,Y(48)],[1024,Y(187)],[1024,Y(227)],[390,Y(96)]],accent);stripe([[170,Y(67)],[410,Y(82)],[1024,Y(218)]],trim,5);}
  }else if(p==='digital'){
    // 팀의 큰 계단형 하나. 디지털 위장 조각은 사용하지 않음.
    for(const s of [-1,1]){const Y=y=>256+s*y;shape([[0,Y(140)],[335,Y(140)],[335,Y(172)],[620,Y(172)],[620,Y(200)],[1024,Y(200)],[1024,Y(246)],[570,Y(246)],[570,Y(217)],[285,Y(217)],[285,Y(185)],[0,Y(185)]],accent);}
    twins(17,12);
  }else if(p==='shard'){
    for(const s of [-1,1]){const Y=y=>256+s*y;shape([[0,Y(30)],[340,Y(36)],[1024,Y(230)],[620,Y(211)],[225,Y(99)],[0,Y(84)]],accent);stripe([[0,Y(97)],[227,Y(111)],[622,Y(224)],[1024,Y(244)]],trim,6);}
  }else if(p==='prism'){
    // 프리즘은 한 쌍의 매끈한 검날. 넓은 빈 도장 면을 남긴다.
    for(const s of [-1,1]){const Y=y=>256+s*y;shape([[0,Y(18)],[235,Y(30)],[690,Y(149)],[1024,Y(168)],[1024,Y(221)],[660,Y(197)],[180,Y(77)],[0,Y(69)]],accent);stripe([[0,Y(83)],[180,Y(91)],[660,Y(210)],[1024,Y(234)]],trim,5);}
  }else if(p==='sunset'){
    // 꼬리로 갈수록 녹아드는 한 가지 포인트색. 옆 리본과 연결.
    for(const s of [-1,1]){const Y=y=>256+s*y;shape([[0,Y(90)],[400,Y(90)],[1024,Y(174)],[1024,Y(230)],[380,Y(146)],[0,Y(146)]],accent);stripe([[0,Y(158)],[380,Y(158)],[1024,Y(242)]],trim,6);}
  }else{
    for(const s of [-1,1]){const Y=y=>256+s*y;shape([[0,Y(26)],[380,Y(40)],[1024,Y(202)],[1024,Y(247)],[340,Y(95)],[0,Y(82)]],accent);stripe([[0,Y(95)],[340,Y(108)],[1024,Y(260)]],trim,6);}
  }
  g.restore();f.restore();
  // 측면의 한 덩어리 스피어. 모든 패턴의 그래픽이 길이 방향으로 읽힌다.
  const side=(pts,col)=>shape(pts.map(([x,y])=>[x,y+512]),col);
  const sideLine=(pts,col,w)=>stripe(pts.map(([x,y])=>[x,y+512]),col,w);
  if(['flame','magma'].includes(p)){
    side([[245,385],[400,320],[530,330],[720,225],[635,350],[1024,260],[1024,448],[590,440],[385,404]],accent);
    sideLine([[290,381],[418,351],[556,376],[815,330]],trim,8);
  }else if(p==='cosmos'){
    side([[0,320],[1024,320],[1024,424],[0,424]],accent);sideLine([[0,303],[1024,303]],trim,7);side([[730,0],[828,0],[828,512],[730,512]],accent);
  }else if(p==='digital'){
    side([[0,386],[300,386],[300,326],[610,326],[610,264],[1024,264],[1024,410],[660,410],[660,447],[0,447]],accent);sideLine([[0,460],[678,460],[678,427],[1024,427]],trim,6);
  }else if(p==='carbon'){
    side([[0,400],[280,392],[740,265],[1024,256],[1024,328],[750,337],[295,444],[0,450]],accent);sideLine([[0,466],[295,460],[750,355],[1024,346]],trim,5);
  }else{
    side([[0,400],[290,375],[740,232],[1024,220],[1024,325],[760,334],[320,450],[0,464]],accent);sideLine([[0,478],[322,464],[762,350],[1024,341]],trim,6);
  }
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
  const rm=new THREE.CanvasTexture(finish);rm.colorSpace=THREE.NoColorSpace;rm.anisotropy=4;
  return {tex,rm,metal,pearl,satin};
}
function teamDecal(c) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const g=canvas.getContext('2d');
  // 한 개의 큰 번호 원판 + 팀 이름. 작은 가짜 스폰서 문장들은 뺀다.
  g.fillStyle='#e8e9e2';g.beginPath();g.arc(123,128,108,0,Math.PI*2);g.fill();
  g.strokeStyle=c.look.accent;g.lineWidth=9;g.beginPath();g.arc(123,128,99,0,Math.PI*2);g.stroke();
  g.fillStyle='#10141c';g.textAlign='center';g.textBaseline='middle';g.font='italic 900 112px sans-serif';g.fillText(c.look.number,119,137,183);
  g.textAlign='left';g.fillStyle=c.look.numberFg;g.font='italic 900 37px sans-serif';g.fillText(c.brand,248,119,254);
  g.fillStyle=c.look.accent;g.fillRect(249,145,226,10);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
}

/** 모델을 완성할 때 한 번만. 정적 부품은 기존 PBR 묶음에 참여. */
export function dressCar({ root, body, A, shell, M, look, add, wheels, shellMeshes, loft }) {
  const c=byId.get(look.costume);if(!c)return null;
  // 기본 사각 번호판과 전용 원판이 나란히 겹치지 않게 한다.
  const nativeNumbers=['hyper','ev','rocket','kart','wedge'].includes(look.style);
  if(!nativeNumbers)root.traverse(m=>{if(m.isMesh&&m.material===M.numMat)m.visible=false;});
  const surface=livery(c);M.paint.map=surface.tex;M.paint.color.set('#ffffff');
  M.paint.roughnessMap=surface.rm;M.paint.metalnessMap=surface.rm;
  M.paint.metalness=1;M.paint.roughness=1;
  M.paint.clearcoat=surface.satin?.12:surface.metal?.35:.48;M.paint.clearcoatRoughness=.3;
  M.paint.envMapIntensity=surface.metal?.68:.32;
  M.paint.ior=1.5;
  if(surface.pearl){M.paint.iridescence=.32;M.paint.iridescenceIOR=1.34;M.paint.iridescenceThicknessRange=[190,310];}
  M.carbon.color.set('#11151c');M.carbon.roughness=.67;
  M.accent.roughness=.24;M.accent.metalness=surface.metal?.8:.32;
  M.trim.roughness=.23;M.trim.metalness=.78;
  const neon=new THREE.MeshStandardMaterial({color:c.look.trim,emissive:c.look.trim,emissiveIntensity:c.glow?.65:.04,metalness:.55,roughness:.26});
  const animated=c.unlockLevel>=35; if(animated)neon.userData.live=true;
  const parts=new Set(c.parts||[]), wx=Math.max(...A.wheels.map(w=>Math.abs(w[0]))), rear=A.stab[2], wingY=A.stab[1], half=Math.min(1.33,wx+.3);
  const road=new THREE.Group();body.add(road);
  const box=(w,h,d,mat,x,y,z,parent=body)=>add(new THREE.BoxGeometry(w,h,d),mat,x,y,z,parent);
  const plate=(pts,t,mat,x=0,parent=body)=>{const sh=new THREE.Shape();sh.moveTo(...pts[0]);for(const p of pts.slice(1))sh.lineTo(...p);return add(new THREE.ExtrudeGeometry(sh,{depth:t,bevelEnabled:false}).rotateY(-Math.PI/2).translate(t/2,0,0),mat,x,0,0,parent);};
  const slab=(pts,t,mat,y,parent=body)=>{const sh=new THREE.Shape();sh.moveTo(...pts[0]);for(const p of pts.slice(1))sh.lineTo(...p);return add(new THREE.ExtrudeGeometry(sh,{depth:t,bevelEnabled:false}).rotateX(Math.PI/2),mat,0,y,0,parent);};
  const wing=(span,chord,y,z,mat=c.unlockLevel>=28?M.carbon:M.accent,sweep=.12,parent=shell.spoiler)=>{
    // 납작한 상자 대신 둥근 앞전·얇은 뒷전을 가진 실제 날개 단면.
    const stations=[[-span,.78],[-span*.62,1],[span*.62,1],[span,.78]];
    const pos=[],idx=[];
    for(const [x,k]of stations){const dz=Math.abs(x/span)*sweep;for(const [u,h]of [[.5,0],[.3,.045],[-.36,.018],[-.5,0],[-.36,-.015],[.3,-.022]])pos.push(x,y+h*k,z+u*chord*k+dz);}
    for(let j=0;j<3;j++)for(let i=0;i<6;i++){const a=j*6+i,b=j*6+(i+1)%6;idx.push(a,a+6,b,b,a+6,b+6);}
    for(const j of [0,3])for(let i=1;i<5;i++){const a=j*6;idx.push(a,a+i+(j?0:1),a+i+(j?1:0));}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();
    const mesh=add(geo,mat,0,0,0,parent);
    if(c.unlockLevel>=28)box(span*1.84,.018,.025,M.trim,0,y+.024,z+chord*.3,parent);
    return mesh;
  };
  const fin=(x,y,z,len,height,mat=M.accent,parent=body)=>plate([[z+len*.48,y],[z-len*.6,y],[z-len*.7,y+height],[z-len*.38,y+height],[z+len*.3,y+height*.2]],.035,mat,x,parent);
  // 큰 부품은 같은 차의 앵커에서 자라나며 원래 변신 날개와 함께 움직임.
  if(parts.has('ducktail')){shell.spoiler.scale.y=.68;shell.drs.scale.x=1.15;wing(half,.65,wingY+.16,rear+.08,M.accent,.2);}
  if(parts.has('longtail')){wing(half,.7,wingY-.08,rear-.27);for(const side of [-1,1])fin(side*half,wingY-.32,rear-.3,.95,.34,M.paint,shell.spoiler);}
  if(parts.has('doubleWing')||parts.has('twinWing')){shell.drs.scale.x=1.16;wing(half,.45,wingY+.34,rear+.06,M.accent,.22);for(const side of [-1,1])box(.045,.42,.15,M.carbon,side*(half-.15),wingY+.14,rear,shell.spoiler);}
  if(parts.has('tripleWing')){shell.drs.scale.x=1.2;wing(half,.38,wingY+.32,rear+.05);wing(half*.94,.3,wingY+.57,rear-.03,M.trim,.15);for(const side of [-1,1])fin(side*half,wingY-.06,rear,.73,.7,M.carbon,shell.spoiler);}
  if(parts.has('splitWing')||parts.has('petalWing')||parts.has('shardWing')){
    shell.drs.scale.x=1.22;
    for(const side of [-1,1]){const sw=parts.has('petalWing')?.5:.24;const w=slab([[side*.16,rear-.18],[side*half,rear-.38],[side*(half+.08),rear+.25],[side*.7,rear+sw],[side*.25,rear+.22]],.05,c.unlockLevel>=28?M.carbon:M.accent,wingY+.34,shell.spoiler);w.rotation.z=side*(parts.has('shardWing')?.12:.06);box(.045,.38,.14,M.carbon,side*.7,wingY+.15,rear,shell.spoiler);fin(side*half,wingY+.21,rear,.62,.31,neon,shell.spoiler);}
  }
  if(parts.has('ringWing')){
    // 뒤를 둘러싼 고리 날개. 작은 사진에서도 판 날개와 다른 윤곽.
    shell.spoiler.scale.y=.84;
    wing(half,.48,wingY+.45,rear+.04,M.carbon,.18);
    for(const side of [-1,1]){plate([[rear+.36,wingY-.07],[rear-.36,wingY-.07],[rear-.38,wingY+.5],[rear+.18,wingY+.5]],.06,M.carbon,side*half,shell.spoiler);box(.045,.035,.65,neon,side*(half+.02),wingY+.5,rear,shell.spoiler);}
  }
  if(parts.has('slattedWing')){for(let i=0;i<3;i++)wing(half,.16,wingY+.12+i*.07,rear-.28+i*.23,i%2?M.accent:M.trim,.05);}
  if(parts.has('lowWing')){shell.spoiler.scale.y=.83;wing(half*.94,.32,wingY+.07,rear,M.accent);}
  if(parts.has('wideWing')){shell.drs.scale.x=1.3;wing(half,.62,wingY+.18,rear,M.paint);}
  if(parts.has('shark'))fin(0,A.tailFin[1]-.12,A.tailFin[2]-.25,1.55,.66,M.accent);
  if(parts.has('twinFins')||parts.has('rocketFins'))for(const side of [-1,1])fin(side*(wx-.18),A.tailFin[1]-.25,A.tailFin[2]-.48,1.22,parts.has('rocketFins')?.82:.6,M.paint);
  if(parts.has('spine')){for(const side of [-1,1])fin(side*.3,A.tailFin[1]-.08,A.tailFin[2]-.4,1.3,.45,M.trim);}
  if(parts.has('scoop')||parts.has('cowling')){
    const sy=A.visor[0]+.27,z=A.helmet[2]-.5,w=parts.has('cowling')?.23:.3;
    add(loft([{z:z+.31,w:w*.85,h:.08,y:sy-.03,n:5},{z:z+.05,w,h:.12,y:sy-.04,n:5},{z:z-.64,w:w*.42,h:.04,y:sy-.14,n:5}],8),M.accent,0,0,0);
    box(w*1.5,.1,.025,M.dark,0,sy-.03,z+.32);box(w*1.52,.016,.028,neon,0,sy+.029,z+.335);
  }
  if(parts.has('wide')){
    // 적은 면으로 만든 와이드 펜더. 실제 타이어의 위치와 크기를 따라감.
    for(const [x,z,,r,wd]of A.wheels){const sh=new THREE.Shape();sh.absarc(0,0,r+.16,-.14,Math.PI+.14,false);sh.absarc(0,0,r+.07,Math.PI+.14,-.14,true);const geo=new THREE.ExtrudeGeometry(sh,{depth:wd+.19,bevelEnabled:false,curveSegments:6}).rotateY(Math.PI/2).translate(-(wd+.19)/2,0,0);add(geo,c.unlockLevel>=28?M.carbon:M.accent,x+Math.sign(x)*.03,r,z,road);}
  }
  if(parts.has('sidepipes'))for(const side of [-1,1]){
    add(new THREE.CylinderGeometry(.07,.07,1.28,8).rotateX(Math.PI/2),M.metal,side*(wx+.13),.28,-.35,road);
    add(new THREE.CylinderGeometry(.054,.07,.13,8).rotateX(Math.PI/2),M.darkMetal,side*(wx+.13),.28,-1.02,road);
    for(const z of [-.05,-.68])box(.06,.15,.08,M.carbon,side*(wx+.13),.3,z,road);
  }
  if(parts.has('streamliner'))for(const side of [-1,1])plate([[2.3,.25],[1.1,.25],[.8,.52],[1.65,.79],[2.25,.45]],.12,M.accent,side*.5,road);
  if(parts.has('rallyPod')){
    const sy=A.visor[0]+.2,z=A.helmet[2]-.25,ww=Math.min(.8,wx);
    for(const x of [-ww*.7,ww*.7])box(.055,.09,.9,M.metal,x,sy-.04,z);
    box(ww*1.8,.055,.12,M.carbon,0,sy+.02,z+.44);
    if(look.style!=='buggy'&&(look.style!=='truck'||look.variant==='pickup'))for(let i=0;i<4;i++){const x=(i-1.5)*ww*.42;add(new THREE.CylinderGeometry(.095,.095,.1,10).rotateX(Math.PI/2),M.carbon,x,sy+.08,z+.49);add(new THREE.CircleGeometry(.074,10),M.lamp,x,sy+.08,z+.547);}
    box(ww*1.35,.13,.46,M.accent,0,sy+.025,z-.12);
    for(const side of [-1,1])box(.05,.15,.48,M.carbon,side*ww*.45,sy+.04,z-.12);
  }
  if(parts.has('roofboard')){
    const sy=A.visor[0]+.37;
    for(const z of [-.5,.45])box(1.3,.06,.06,M.metal,0,sy-.1,z);
    // 타원형 롱보드와 중앙 지느러미. 두 고정 끈도 별도 돌출됨.
    add(loft([{z:1.15,w:.035,h:.035,y:sy,n:2},{z:.78,w:.33,h:.05,y:sy,n:3},{z:-.85,w:.31,h:.05,y:sy,n:3},{z:-1.19,w:.08,h:.035,y:sy,n:2}],10),M.accent,0,0,0);
    box(.14,.016,1.95,M.trim,0,sy+.06,0);
    for(const z of [-.5,.45])box(.68,.024,.07,M.carbon,0,sy+.08,z);
    fin(0,sy+.06,-.8,.3,.2,M.trim);
  }
  // 대형 스플리터: 앞바퀴 좌표에서 전방으로. 앞 오버행이 다른 카트/드래그스터도 대응.
  if(c.kit!=='classic')for(const side of [-1,1]){
    const fz=A.wheels.find(w=>w[2])[1]+.64, span=wx+.2;
    slab([[side*(wx-.2),fz-.5],[side*span,fz-.46],[side*(span+.03),fz+.15],[side*(wx-.3),fz+.12]],.035,M.carbon,.2,shell.fWing);
    fin(side*span,.2,fz-.1,.6,.2,M.accent,shell.fWing);
    box(.045,.03,1.65,neon,side*(wx+.05),.2,-.12,road);
    if(c.unlockLevel>=15){const blade=box(.29,.03,.43,M.accent,side*(wx+.02),.44,fz-.17,shell.fWing);blade.rotation.z=side*.2;blade.rotation.x=.16;}
  }
  for(const w of wheels){
    const wd=A.wheels.find(a=>Math.abs(Math.abs(a[0])-w.ax)<1e-5&&a[1]===w.z)?.[4]||.3;
    const radius=w.r*(parts.has('discs')?.88:.68),xx=w.side*(wd/2+.024);
    if(parts.has('discs')||c.kit==='orbit'){
      add(new THREE.CylinderGeometry(radius,radius,.025,12).rotateZ(Math.PI/2),M.accent,xx,0,0,w.spin);
      add(new THREE.CylinderGeometry(radius*.45,radius*.45,.031,10).rotateZ(Math.PI/2),M.carbon,xx+w.side*.016,0,0,w.spin);
      for(let i=0;i<3;i++){const b=box(.025,radius*.65,.035,neon,xx+w.side*.025,0,0,w.spin);b.rotation.x=i*Math.PI/4;}
    }else{
      add(new THREE.TorusGeometry(radius,.018,3,12).rotateY(Math.PI/2),c.kit==='classic'?M.metal:neon,xx,0,0,w.spin);
      for(let i=0;i<3;i++){const b=box(.028,radius*1.7,.035,M.trim,xx,0,0,w.spin);b.rotation.x=i*Math.PI/3;}
    }
  }
  root.updateMatrixWorld(true);
  const v=new THREE.Vector3(),n=new THREE.Vector3(),inv=new THREE.Matrix4().copy(root.matrixWorld).invert(),mtx=new THREE.Matrix4(),shells=[];
  const front=Math.max(...A.wheels.map(w=>w[1]+w[3]))+.4,back=Math.min(...A.wheels.map(w=>w[1]-w[3]))-.5;
  const height=Math.max(1.1,A.visor[0]+.4),width=(wx+.25)*2;
  root.traverse(m=>{
    if(!m.isMesh||m.material!==M.paint)return;shells.push(m);mtx.multiplyMatrices(inv,m.matrixWorld);
    // 한 삼각형 안에서 위/옆 atlas를 섞으면 작은 위장 조각처럼 찢어진다.
    // 면 단위로 투영을 고르되 원래 곡면 법선은 유지한다.
    const geo=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone(),p=geo.attributes.position,norm=geo.attributes.normal,uv=new Float32Array(p.count*2);
    for(let j=0;j<p.count;j+=3){
      let ny=0;for(let k=0;k<3;k++){n.fromBufferAttribute(norm,j+k).transformDirection(mtx);ny+=n.y;}
      const top=Math.abs(ny/3)>.55;
      for(let k=0;k<3;k++){
        const i=j+k;v.fromBufferAttribute(p,i).applyMatrix4(mtx);
        const u=THREE.MathUtils.clamp((front-v.z)/(front-back),.002,.998);
        const y=top?THREE.MathUtils.clamp(.5+v.x/width,.004,.996)*.5:.5+THREE.MathUtils.clamp(1-v.y/height,.004,.996)*.5;
        uv[i*2]=u;uv[i*2+1]=1-y;
      }
    }
    geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));m.geometry=geo;
  });
  const decalMat=new THREE.MeshStandardMaterial({map:teamDecal(c),transparent:true,alphaTest:.1,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,roughness:.55});
  const ray=new THREE.Raycaster(),targetZ=look.style==='rocket'?.3:look.style==='f1'?-.65:-.05;
  const targetY=look.style==='kart'?.24:['rally','truck','van'].includes(look.style)?.68:.54;
  for(const side of nativeNumbers?[]:[-1,1]){
    ray.set(new THREE.Vector3(side*4,targetY,targetZ),new THREE.Vector3(-side,0,0));
    const hit=ray.intersectObjects(shellMeshes||shells,false)[0];if(!hit)continue;
    const slim=['f1','rocket','kart'].includes(look.style);
    const size=slim?.28:.38;
    const geo=new DecalGeometry(hit.object,hit.point,new THREE.Euler(0,side*Math.PI/2,0),new THREE.Vector3(size,size,.6));
    const uv=geo.attributes.uv;for(let i=0;i<uv.count;i++)uv.setX(i,uv.getX(i)*.48);
    add(geo,decalMat,0,0,0).castShadow=false;
  }
  // 보닛 큰 무늬를 가리지 않게 번호 로고는 짧게 배치.
  ray.set(new THREE.Vector3(0,4,look.style==='rocket'?1.6:1.8),new THREE.Vector3(0,-1,0));
  const hit=ray.intersectObjects(shellMeshes||shells,false)[0];
  if(hit&&!nativeNumbers){const slim=['f1','rocket','kart'].includes(look.style);const size=slim?.24:.39;const geo=new DecalGeometry(hit.object,hit.point,new THREE.Euler(-Math.PI/2,0,0),new THREE.Vector3(size,size,.13));const uv=geo.attributes.uv;for(let i=0;i<uv.count;i++)uv.setX(i,uv.getX(i)*.48);add(geo,decalMat,0,0,0).castShadow=false;}
  return {luxury:animated,update(time,boat=0){road.visible=boat<.75;if(animated)neon.emissiveIntensity=.52+.16*Math.sin(time*1.3);}};
}
