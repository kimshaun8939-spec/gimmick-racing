// 1인칭 전용 작은 실내. 레이어 9는 운전석 카메라에서만 보이며 다른 시점의 모델은 그대로.
import * as THREE from 'three';
export function buildCockpit({body,A,M,look,add}){
  const closed=['gt','rally','hatch','muscle','truck','van','wedge'].includes(look.style);
  const eye=new THREE.Vector3(A.helmet[0],A.helmet[1]+(closed?.17:look.style==='hyper'?.22:.16),A.helmet[2]+.2);
  const interior=new THREE.Group();body.add(interior);
  interior.position.copy(eye);
  const mesh=(g,m,x,y,z,p=interior)=>{const o=add(g,m,x,y,z,p);o.layers.set(9);o.userData.fpInterior=true;o.castShadow=false;return o;};
  const cabin = new THREE.MeshStandardMaterial({ color:'#10161d', roughness:.94, metalness:0, envMapIntensity:.08 });
  const box=(w,h,d,m,x,y,z,p)=>mesh(new THREE.BoxGeometry(w,h,d),m,x,y,z,p);
  // 가운데를 기준으로 대칭인 가죽 대시와 계기판 덮개. 운전석은 실제 좌석의 x를 따름.
  box(closed?1.65:.88,.18,.34,cabin,0,-.47,.77);
  box(.51,.03,.28,cabin,0,-.34,.74);
  box(closed?1.62:.86,.012,.025,M.trim,0,-.365,.6);
  const c=document.createElement('canvas');c.width=256;c.height=128;const g=c.getContext('2d');
  g.fillStyle='#07141c';g.fillRect(0,0,256,128);g.strokeStyle=look.trim;g.lineWidth=3;g.strokeRect(5,5,246,118);
  g.fillStyle=look.trim;for(let i=0;i<12;i++)g.fillRect(18+i*19,15,13,7);
  g.font='bold 25px monospace';g.fillStyle='#e4f5f5';g.fillText('RACE',17,58);g.font='bold 18px monospace';g.fillStyle=look.accent;g.fillText('WORKS '+String(look.number||'7'),17,86);
  for(let i=0;i<3;i++){g.fillStyle=i===0?look.trim:'#38535e';g.fillRect(166,42+i*23,64-i*12,7);}
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  const screenMat=new THREE.MeshBasicMaterial({map:tex,toneMapped:false});const screen=mesh(new THREE.PlaneGeometry(.4,.2),screenMat,0,-.35,.585);screen.rotation.y=Math.PI;
  // 핸들 피벗을 별도로 둬서 조향 때 좌우로 회전. 윗부분은 시야 아래쪽에 자연스럽게 걸침.
  const wheel=new THREE.Group();wheel.position.set(0,-.38,.44);interior.add(wheel);
  const rim=mesh(new THREE.TorusGeometry(closed?.2:.19,.022,5,20),M.dark,0,0,0,wheel);rim.scale.y=.83;
  box(.33,.035,.045,M.metal,0,-.025,0,wheel);box(.04,.13,.04,M.metal,0,-.085,0,wheel);box(.12,.075,.055,M.carbon,0,-.015,-.005,wheel);
  box(.025,.022,.05,M.trim,0,.153,0,wheel);
  for(const side of [-1,1]){box(.045,.045,.018,M.trim,side*.11,-.025,-.03,wheel);box(.025,.12,.025,M.metal,side*.15,-.025,.035,wheel);}
  if(closed){
    // 끊긴 원래 A필러 대신 운전자 앞 유리 테두리를 온전한 좌우 한 쌍으로 표시.
    for(const side of [-1,1]){const pillar=box(.045,1.12,.055,cabin,side*.82,.12,.96);pillar.rotation.z=side*.14;}
    box(1.52,.07,.08,cabin,0,.67,.96);
  }
  if (['hyper','proto','ev'].includes(look.style)) {
    // 잘라 숨긴 펜더 안쪽이 뚫려 보이지 않도록 실내 쪽의 낮은 덮개를 온전한 좌우 한 쌍으로.
    for (const side of [-1,1]) { box(.44,.2,.85,cabin,side*.54,-.48,1.04); box(.035,.025,.87,M.trim,side*.34,-.37,1.04); }
  }
  return{eye,interior,wheel};
}
