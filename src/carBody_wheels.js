// 부드러운 타이어 단면은 유지하고, 눈에 거의 보이지 않는 안쪽 링·볼트의 면을 줄인 휠.
import * as THREE from 'three';
// 한 차의 바퀴는 같은 흐림 값을 쓰고, 같은 크기의 좌우 바퀴는 재질도 공유.
// 차 사이에는 공유하지 않아 서로 다른 속도/색과 dispose 수명을 분리한다.
const wheelMaterials = new WeakMap();
export function buildWheel(add,spin,steer,M,look,r,width,side){
  const formula=['f1','proto'].includes(look.style),classic=look.style==='roadster',kart=look.style==='kart',offroad=look.tire==='knobby';
  const R=r*(offroad?.55:formula?.65:.69),h=width/2, seg=(offroad||look.style==='rally')?12:14;
  const profile=[[R*.97,-h*.94],[r*.83,-h],[r*.975,-h*.79],[r,-h*.5],[r,h*.5],[r*.975,h*.79],[r*.83,h],[R*.97,h*.94],[R*.97,-h*.94]].map(([x,y])=>new THREE.Vector2(x,y));
  const rim=[],detail=[],brake=[],spokes=[];
  const wheelParts=[{g:new THREE.LatheGeometry(profile,seg).rotateZ(Math.PI/2),m:M.rubber,role:0}];
  const torus=(rr,t,x)=>new THREE.TorusGeometry(rr,t,3,seg).rotateY(Math.PI/2).translate(x,0,0);
  rim.push(new THREE.CylinderGeometry(R*.98,R*.98,width*.76,seg,1,true).rotateZ(Math.PI/2));
  for(const s of [-1,1]){
    const face=s*h*.89;rim.push(torus(R,r*.022,s*h*.98));
    rim.push(new THREE.CylinderGeometry(R*.2,R*.22,width*.13,8).rotateZ(Math.PI/2).translate(face,0,0));
    const count=classic?12:kart?3:offroad?6:formula?8:5;
    for(let k=0;k<count;k++){
      const angle=k*Math.PI*2/count;
      for(const fork of (!formula&&!classic&&!offroad&&!kart)?[-1,1]:[0]){
        const g=new THREE.BoxGeometry(width*.1,R*.8,r*(classic?.018:formula?.085:.065));g.translate(face,R*.54,0).rotateX(angle+fork*.065);spokes.push(g);
      }
      // 팔각 볼트 머리. 미세 구 대신 8면으로 읽히게 함.
      detail.push(new THREE.TetrahedronGeometry(r*.026).translate(face+s*r*.015,Math.cos(angle+.2)*R*.26,Math.sin(angle+.2)*R*.26));
    }
    brake.push(new THREE.CylinderGeometry(R*.83,R*.83,.012,seg).rotateZ(Math.PI/2).translate(s*h*.58,0,0));
    detail.push(torus(r*.86,r*.007,s*h*1.005));
  }
  const merge=parts=>{const p=[],n=[];for(const g of parts){const flat=g.index?g.toNonIndexed():g;p.push(...flat.attributes.position.array);n.push(...flat.attributes.normal.array);if(flat!==g)flat.dispose();g.dispose();}const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(p,3));out.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));return out;};
  wheelParts.push({g:merge(rim),m:M.rimMat,role:0},{g:merge(detail),m:formula?M.carbon:M.darkMetal,role:0},
    {g:merge(spokes),m:formula?M.carbon:M.rimMat,role:1},{g:merge(brake),m:M.metal,role:2});
  if(offroad)for(let i=0;i<16;i++)for(const s of [-1,1]){
    const a=i/16*Math.PI*2+(s>0?Math.PI/16:0);
    wheelParts.push({g:new THREE.BoxGeometry(width*.44,.06,.1).translate(s*width*.24,r+.015,0).rotateX(a),m:M.rubber,role:3});
  }
  // 같은 바퀴 안의 색·PBR 값을 꼭짓점에 담아 흐림도 한 번에 그림. 면 수는 기존과 같음.
  const attrs={position:[],normal:[],color:[],wheelSurface:[]};
  for(const {g,m,role}of wheelParts){const f=g.index?g.toNonIndexed():g,p=f.attributes.position,n=f.attributes.normal;
    for(let i=0;i<p.count;i++){
      attrs.position.push(p.getX(i),p.getY(i),p.getZ(i));attrs.normal.push(n.getX(i),n.getY(i),n.getZ(i));
      attrs.color.push(m.color.r,m.color.g,m.color.b);attrs.wheelSurface.push(m.roughness??.7,m.metalness??0,role);
    }if(f!==g)f.dispose();g.dispose();
  }
  const geo=new THREE.BufferGeometry();for(const [key,a]of Object.entries(attrs))geo.setAttribute(key,new THREE.Float32BufferAttribute(a,3));
  let shared=wheelMaterials.get(M);
  if(!shared){shared={blur:{value:0},materials:new Map()};wheelMaterials.set(M,shared);}
  const blur=shared.blur,key=R+'|'+h;
  let mat=shared.materials.get(key);
  if(!mat){
  mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:1,transparent:true,depthWrite:true});
  mat.userData.live=true;
  mat.onBeforeCompile=sh=>{
    sh.uniforms.wheelBlur=blur;
    sh.vertexShader='attribute vec3 wheelSurface; varying vec3 vWheelSurface; uniform float wheelBlur;\n'+sh.vertexShader;
    sh.vertexShader=sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vWheelSurface=wheelSurface;
      if(wheelSurface.z>1.5&&wheelSurface.z<2.5){transformed.yz*=mix(1.0,${(R/(R*.83)).toFixed(6)},wheelBlur);transformed.x+=sign(transformed.x)*wheelBlur*${(h*.46).toFixed(6)};}
    `);
    sh.fragmentShader='varying vec3 vWheelSurface; uniform float wheelBlur;\n'+sh.fragmentShader;
    sh.fragmentShader=sh.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      if(vWheelSurface.z>.5&&vWheelSurface.z<1.5)diffuseColor.a*=1.0-wheelBlur*.98;
      if(vWheelSurface.z>2.5)diffuseColor.a*=1.0-wheelBlur*.92;
      if(vWheelSurface.z>1.5&&vWheelSurface.z<2.5){diffuseColor.rgb=mix(diffuseColor.rgb,vec3(${M.rimMat.color.r.toFixed(5)},${M.rimMat.color.g.toFixed(5)},${M.rimMat.color.b.toFixed(5)})*.85,wheelBlur);diffuseColor.a=mix(1.0,.48,wheelBlur);}
    `).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n roughnessFactor=vWheelSurface.x;')
      .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\n metalnessFactor=vWheelSurface.y;');
  };
  mat.customProgramCacheKey=()=> 'wheelfeel-2-'+M.rimMat.color.getHexString()+'-'+R+'-'+h;
  shared.materials.set(key,mat);
  }
  const wheel=add(geo,mat,0,0,0,spin);wheel.userData.wheelBlur=blur;
  // 돌기 타이어는 16개씩 엇갈린 두 줄(32칸)이 가장 촘촘한 무늬다.
  // 바큇살 6개만 기준으로 제한하면 30~60 km/h에서 돌기가 뒤로 흐르는 착시가 난다.
  spin.userData.wheelFeel={blur,count:offroad?32:classic?12:kart?3:formula?8:5,r};
  if(!formula&&!kart)add(new THREE.BoxGeometry(width*.18,R*.5,R*.2),M.trim,side*h*.7,0,-R*.66,steer).castShadow=false;
  if(look.wall){const mat=new THREE.MeshStandardMaterial({color:look.wall,roughness:.65});const wall=add(merge([-1,1].map(s=>torus(r*.84,r*(classic?.045:.012),s*h*1.01))),mat,0,0,0,spin);wall.castShadow=false;
    // stockcalls: 이름·noBatch를 붙이면 묶음에서 빠져 순정 차가 바퀴마다 그림 호출 +1 → 표시만 해 두고 참조를 돌려줌 (부품 타이어가 숨길 때 carParts3d가 묶음을 다시 만듦)
    wall.userData.stockTireWall=true;return wall;}
  return null;
}

// Part tire ring follows the original wheel transform.
export function partTireGeometry(r,width,side,tread=false){
 const geos=[],ring=new THREE.RingGeometry(r*.77,r*.88,10);
 ring.rotateY(side*Math.PI/2).translate(side*(width/2+.005),0,0);geos.push(ring);
 if(tread===true||tread==='knob')for(let i=0;i<8;i++){const a=i*Math.PI/4;geos.push(new THREE.PlaneGeometry(width*.75,r*.20).rotateX(-Math.PI/2).translate(0,r+.006,0).rotateX(a));}
 const sharp=tread==='sharp';const ticks=tread==='slick'?3:sharp?8:6;
 for(let i=0;i<ticks;i++){const a=i*Math.PI*2/ticks;geos.push(new THREE.PlaneGeometry(r*(sharp?.08:.18),r*.06).rotateY(side*Math.PI/2).translate(side*(width/2+.012),r*.70,0).rotateX(a));}
 if(sharp)for(let i=0;i<6;i++){const a=i*Math.PI/3;geos.push(new THREE.PlaneGeometry(width*.70,.014).rotateX(-Math.PI/2).rotateY(.35).translate(0,r+.006,0).rotateX(a));}
 // 측면 S / AT / D 글자를 얇은 금형 무늬로 바퀴 묶음에 합침. 텍스처 불필요.
 const strokes=tread==='slick'?[[0,0,0,1],[0,0,.5,0],[.5,0,.5,1],[.5,1,1,1],[1,0,1,1]]:tread==='knob'?[[0,0,1,.3],[1,.3,0,.6],[.4,.12,.4,.48],[1,.7,1,1.3],[1,1,0,1]]:[[0,0,1,0],[1,0,.8,.8],[.8,.8,.2,.8],[.2,.8,0,0]];
 for(const [a,b,c,d]of strokes){const y0=-r*.84+a*r*.11,z0=(b-.6)*r*.12,y1=-r*.84+c*r*.11,z1=(d-.6)*r*.12,len=Math.hypot(y1-y0,z1-z0),ny=-(z1-z0)/len*r*.008,nz=(y1-y0)/len*r*.008,x=side*(width/2+.017);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([x,y0+ny,z0+nz,x,y1+ny,z1+nz,x,y1-ny,z1-nz,x,y0-ny,z0-nz],3));g.setIndex(side>0?[0,2,1,0,3,2]:[0,1,2,0,2,3]);g.computeVertexNormals();geos.push(g);}
 const pos=[],norm=[];for(const g of geos){const f=g.index?g.toNonIndexed():g;pos.push(...f.attributes.position.array);norm.push(...f.attributes.normal.array);if(f!==g)f.dispose();g.dispose();}
 const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));out.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));return out;
}
