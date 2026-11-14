// 부드러운 타이어 단면은 유지하고, 눈에 거의 보이지 않는 안쪽 링·볼트의 면을 줄인 휠.
import * as THREE from 'three';
export function buildWheel(add,spin,steer,M,look,r,width,side){
  const formula=['f1','proto'].includes(look.style),classic=look.style==='roadster',kart=look.style==='kart',offroad=look.tire==='knobby';
  const R=r*(offroad?.55:formula?.65:.69),h=width/2, seg=(offroad||look.style==='rally')?12:14;
  const profile=[[R*.97,-h*.94],[r*.83,-h],[r*.975,-h*.79],[r,-h*.5],[r,h*.5],[r*.975,h*.79],[r*.83,h],[R*.97,h*.94],[R*.97,-h*.94]].map(([x,y])=>new THREE.Vector2(x,y));
  add(new THREE.LatheGeometry(profile,seg).rotateZ(Math.PI/2),M.rubber,0,0,0,spin);
  const rim=[],detail=[],brake=[];
  const torus=(rr,t,x)=>new THREE.TorusGeometry(rr,t,3,seg).rotateY(Math.PI/2).translate(x,0,0);
  rim.push(new THREE.CylinderGeometry(R*.98,R*.98,width*.76,seg,1,true).rotateZ(Math.PI/2));
  for(const s of [-1,1]){
    const face=s*h*.89;rim.push(torus(R,r*.022,s*h*.98));
    rim.push(new THREE.CylinderGeometry(R*.2,R*.22,width*.13,8).rotateZ(Math.PI/2).translate(face,0,0));
    const count=classic?12:kart?3:offroad?6:formula?8:5;
    for(let k=0;k<count;k++){
      const angle=k*Math.PI*2/count;
      for(const fork of (!formula&&!classic&&!offroad&&!kart)?[-1,1]:[0]){
        const g=new THREE.BoxGeometry(width*.1,R*.8,r*(classic?.018:formula?.085:.065));g.translate(face,R*.54,0).rotateX(angle+fork*.065);(formula?detail:rim).push(g);
      }
      // 팔각 볼트 머리. 미세 구 대신 8면으로 읽히게 함.
      detail.push(new THREE.TetrahedronGeometry(r*.026).translate(face+s*r*.015,Math.cos(angle+.2)*R*.26,Math.sin(angle+.2)*R*.26));
    }
    brake.push(new THREE.CylinderGeometry(R*.83,R*.83,.012,seg).rotateZ(Math.PI/2).translate(s*h*.58,0,0));
    detail.push(torus(r*.86,r*.007,s*h*1.005));
  }
  const merge=parts=>{const p=[],n=[];for(const g of parts){const flat=g.index?g.toNonIndexed():g;p.push(...flat.attributes.position.array);n.push(...flat.attributes.normal.array);if(flat!==g)flat.dispose();g.dispose();}const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(p,3));out.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));return out;};
  add(merge(rim),M.rimMat,0,0,0,spin);add(merge(detail),formula?M.carbon:M.darkMetal,0,0,0,spin).castShadow=false;add(merge(brake),M.metal,0,0,0,spin).castShadow=false;
  if(!formula&&!kart)add(new THREE.BoxGeometry(width*.18,R*.5,R*.2),M.trim,side*h*.7,0,-R*.66,steer).castShadow=false;
  if(look.wall){const mat=new THREE.MeshStandardMaterial({color:look.wall,roughness:.65});const wall=add(merge([-1,1].map(s=>torus(r*.84,r*(classic?.045:.012),s*h*1.01))),mat,0,0,0,spin);wall.castShadow=false;
    // stockcalls: 이름·noBatch를 붙이면 묶음에서 빠져 순정 차가 바퀴마다 그림 호출 +1 → 표시만 해 두고 참조를 돌려줌 (부품 타이어가 숨길 때 carParts3d가 묶음을 다시 만듦)
    wall.userData.stockTireWall=true;return wall;}
  return null;
}

// Part tire ring follows the original wheel transform.
export function partTireGeometry(r,width,side,knob=false){
 const geos=[],ring=new THREE.RingGeometry(r*.77,r*.88,12);
 ring.rotateY(side*Math.PI/2).translate(side*(width/2+.005),0,0);geos.push(ring);
 if(knob)for(let i=0;i<8;i++){const a=i*Math.PI/4;geos.push(new THREE.BoxGeometry(width*.75,.012,r*.20).translate(0,r+.003,0).rotateX(a));}
 const pos=[],norm=[];for(const g of geos){const f=g.index?g.toNonIndexed():g;pos.push(...f.attributes.position.array);norm.push(...f.attributes.normal.array);if(f!==g)f.dispose();g.dispose();}
 const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));out.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));return out;
}
