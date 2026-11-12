// 차체와 함께 접혀 나오는 레이싱 보트 키트. 선체는 실제 V자 단면과 두 개의 차인을 가짐.
import * as THREE from 'three';
export function buildRacingBoat({add,hull,M,look,A,loft}) {
  const race=['f1','proto','hyper','rocket','ev','wedge'].includes(look.style);
  const utility=['truck','van','buggy'].includes(look.style);
  const width=race?1.15:utility?1.2:1.09;
  const stations=[[3.28,.025,.38],[3.02,.28,.39],[2.56,.64,.4],[1.8,.96,.41],[.7,width,.42],[-.7,width,.43],[-1.8,width*.97,.44],[-2.55,width*.9,.43]];
  const pos=[], idx=[];
  for(const [z,w,deck] of stations){
    // 낮은 갑판 → 선체 어깨 → 차인 → 중앙 용골 단면.
    for(const [x,y]of [[-w,deck],[-w*.99,.2],[-w*.7,.02],[0,-.22],[w*.7,.02],[w*.99,.2],[w,deck],[w*.7,deck+.045],[-w*.7,deck+.045]])pos.push(x,deck+(y-deck)*Math.min(1,w/.7),z);
  }
  const N=9;for(let s=0;s<stations.length-1;s++)for(let j=0;j<N;j++){const a=s*N+j,b=s*N+(j+1)%N;idx.push(a,a+N,b,b,a+N,b+N);}
  for(const s of [0,stations.length-1])for(let j=1;j<N-1;j++){const a=s*N;idx.push(a,a+j+(s?0:1),a+j+(s?1:0));}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(idx);geo.computeVertexNormals();
  add(geo,M.paint,0,0,0,hull);
  const line=(points,mat,r=.018)=>add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),8,r,4,false),mat,0,0,0,hull);
  const box=(w,h,d,mat,x,y,z)=>add(new THREE.BoxGeometry(w,h,d),mat,x,y,z,hull);
  // 양쪽 스폰슨: 수면을 타는 넓고 납작한 발. 위는 도장, 아래는 카본 스텝.
  for(const side of [-1,1]){
    const sx=side*(race?.99:1.01);
    const sections=[{z:2.82,w:.025,h:.04,y:.33},{z:2.35,w:.16,h:.13,y:.28},{z:.9,w:.23,h:.15,y:.2},{z:-1.3,w:.23,h:.16,y:.2},{z:-2.48,w:.2,h:.14,y:.22}];
    add(loft(sections,10),M.paint,sx,0,0,hull);
    add(loft(sections.map(s=>({...s,h:.028,y:.08})),8),M.carbon,sx,0,0,hull);
    line(stations.slice(1).map(([z,w,y])=>[side*w,y+.018,z]),M.trim,.023);
    for(const z of [-.25,-1.35])box(.42,.035,.12,M.carbon,sx,.04,z); // 스텝 헐의 날카로운 물끊기
    line([[side*.22,.46,2.74],[side*.5,.47,1.8],[side*.66,.47,.8]],M.accent,.026);
    // 엔진 덮개와 아가미. 자동차 엔진룸 바로 아래 선미까지 이어짐.
    add(loft([{z:-.6,w:.18,h:.08,y:.48},{z:-1.4,w:.27,h:.15,y:.51},{z:-2.4,w:.25,h:.11,y:.48}],10),M.paint,side*.65,0,0,hull);
    for(let i=0;i<4;i++)box(.26,.018,.055,M.carbon,side*.65,.66-i*.012,-1.35-i*.2);
    box(.14,.02,.1,M.metal,side*.85,.49,-2.34); // 묶는 고리
    // 워터젯: 낮은 원형 분사구, 안쪽 팬과 보호 링.
    add(new THREE.CylinderGeometry(.13,.15,.28,12,1,true).rotateX(Math.PI/2),M.darkMetal,side*.68,.18,-2.64,hull);
    add(new THREE.TorusGeometry(.14,.025,5,12),M.metal,side*.68,.18,-2.79,hull);
    add(new THREE.CircleGeometry(.115,12).rotateY(Math.PI),M.dark,side*.68,.18,-2.77,hull);
    box(.2,.023,.025,M.trim,side*.68,.18,-2.8);
  }
  // 수납된 바퀴를 감싸는 연속된 선체 어깨. 원래 차 폭·바퀴 높이로 계산.
  // 트럭은 높은 캐빈 아래까지, 카트는 축소된 선체 안쪽 좌표로 맞춘다.
  const hs=A.hull||[1,1,1,0], front=A.wheels.find(w=>w[2]), back=A.wheels.find(w=>!w[2]);
  const zf=(front[1]-(hs[3]||0))/hs[2],zr=(back[1]-(hs[3]||0))/hs[2];
  const rf=front[3]/hs[1],rr=back[3]/hs[1], ax=Math.max(...A.wheels.map(w=>Math.abs(w[0])))/hs[0];
  const capW=Math.max(front[4],back[4])*.65/hs[0]+.07;
  const shoulder=[
    {z:Math.min(3.02,zf+front[3]/hs[2]+.38),w:.06,h:.07,y:.44},
    {z:zf+.32,w:capW*.84,h:rf*.53,y:.28+rf*.65},
    {z:zf-.28,w:capW,h:rf*.53,y:.28+rf*.65},
    {z:(zf+zr)/2,w:capW*.88,h:.17,y:.46},
    {z:zr+.3,w:capW,h:rr*.52,y:.28+rr*.68},
    {z:zr-.3,w:capW*.93,h:rr*.5,y:.28+rr*.65},
    {z:Math.max(-2.65,zr-back[3]/hs[2]-.36),w:capW*.5,h:.1,y:.44},
  ];
  for(const side of [-1,1]){
    add(loft(shoulder,8),M.paint,side*ax,0,0,hull);
    line(shoulder.map(s=>[side*(ax+s.w*.8),s.y+s.h*.32,s.z]),M.accent,.022);
    // 작은 검은 흡입구 대신 닫힌 밝은 방수 패널 + 선체 분할 이음선.
    for(const z of [zf,zr])box(.025,.17,.64,M.accent,side*(ax+capW*.86),.53,z);
  }
  // 선수 갑판: 길고 뾰족한 중앙 해치와 얇은 통풍구.
  add(loft([{z:3.1,w:.025,h:.018,y:.42},{z:2.48,w:.28,h:.035,y:.46},{z:1.25,w:.5,h:.045,y:.49}],10),M.accent,0,0,0,hull);
  box(.025,.012,1.3,M.trim,0,.54,1.94);
  for(const x of [-.31,.31])for(let i=0;i<3;i++)box(.14,.012,.045,M.carbon,x,.54,1.33+i*.13);
  // 낮은 분할 바람막이. 원래 차 유리와 자연스럽게 이어지며 중앙 시야는 비워 둠.
  for(const side of [-1,1]){
    const sh=new THREE.Shape();sh.moveTo(.16,0);sh.lineTo(.98,0);sh.lineTo(.86,.25);sh.lineTo(.4,.3);
    const glass=add(new THREE.ExtrudeGeometry(sh,{depth:.018,bevelEnabled:false}),M.glass,0,.48,.88,hull);
    glass.scale.x=side;glass.rotation.x=-.42;
    line([[side*.18,.49,.9],[side*.42,.78,.99],[side*.87,.72,.97],[side*.99,.49,.9]],M.trim,.014);
  }
  if(utility){
    // 트럭·밴은 넓은 작업 보트 갑판과 좌우 손잡이.
    for(const side of [-1,1])line([[side*1.08,.48,-.9],[side*1.08,.62,-1.1],[side*1.06,.62,-2.08],[side*1.02,.48,-2.25]],M.metal,.018);
  }
}
