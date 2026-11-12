import * as THREE from 'three';
import {canvasTexture} from './foundryTrack.js';
// Deterministic, gently sweeping dust. It only changes visibility: never the road or the car.
export function stormState(track,t,time=0){
 const clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
 for(const zone of track.data.storms||[]){
  const d=((t-zone.t0+1)%1)*track.length,len=((zone.t1-zone.t0+1)%1)*track.length;
  if(d>len)continue;
  const envelope=smooth(d/(zone.fade||65))*smooth((len-d)/(zone.fade||65));
  // A broad moving front takes several seconds to pass a driver, with no opaque flashes.
  const wave=.5+.5*Math.sin(time*Math.PI*2/(zone.period||20)-d/115);
  const strength=envelope*(.62+.38*wave*wave);
  return {zone,d,len,strength,visibility:zone.visibility+(950-zone.visibility)*(1-strength)**2};
 }
 return {zone:null,d:0,len:0,strength:0,visibility:950};
}

/** Low draw-count visual weather. Beacons sit behind the rail and never block a car. */
export function buildMirageWeather(track,scene,parent,sky){
 const group=new THREE.Group();group.name='mirageWeather';parent.add(group);
 const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),curtains=[];
 const poleMat=new THREE.MeshStandardMaterial({color:'#45616a',roughness:.8});
 const lightMat=new THREE.MeshBasicMaterial({color:'#7dfff0',toneMapped:false,fog:false});
 const capMat=new THREE.MeshStandardMaterial({color:'#efd2a0',roughness:.8});
 const poleGeo=new THREE.CylinderGeometry(.16,.22,3.7,6),lampGeo=new THREE.OctahedronGeometry(.68,0),baseGeo=new THREE.CylinderGeometry(.65,.9,.45,8),bandGeo=new THREE.CylinderGeometry(.28,.28,.22,6);
 const arrowTex=canvasTexture(256,256,(c,w,h)=>{c.clearRect(0,0,w,h);c.strokeStyle='#9cfff1';c.lineWidth=24;c.lineJoin='round';for(const y of [90,170]){c.beginPath();c.moveTo(45,y+30);c.lineTo(128,y-25);c.lineTo(211,y+30);c.stroke();}});
 const arrowMat=new THREE.MeshBasicMaterial({map:arrowTex,transparent:true,depthWrite:false,opacity:.9,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2,side:THREE.DoubleSide});
 const arrowGeo=new THREE.PlaneGeometry(3.6,5.2);
 const lineMat=new THREE.MeshBasicMaterial({color:'#75dacc',toneMapped:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
 const curtainTex=canvasTexture(256,128,(c,w,h)=>{c.clearRect(0,0,w,h);for(let k=0;k<19;k++){const x=10+(k*47)%240,y=30+(k*19)%60,r=28+(k*11)%36,g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'rgba(255,255,255,.24)');g.addColorStop(.45,'rgba(255,255,255,.10)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);}});
 const curtainGeo=new THREE.PlaneGeometry(135,45);
 for(const zone of track.data.storms||[]){
  const len=(zone.t1-zone.t0)*track.length;
  for(let d=-40;d<=len+40;d+=22){const t=zone.t0+d/track.length,s=track.sampleAt(t);
   for(const side of [-1,1]){const p=track.surf(s,side*(s.hw+2.8));
    const pole=new THREE.Mesh(poleGeo,poleMat);pole.position.copy(p).y+=1.9;group.add(pole);
    const base=new THREE.Mesh(baseGeo,capMat);base.position.copy(p).y+=.22;group.add(base);
    const lamp=new THREE.Mesh(lampGeo,lightMat);lamp.position.copy(p).y+=3.9;lamp.scale.set(.65,1.5,.65);group.add(lamp);
    for(const y of [1,2.5]){const band=new THREE.Mesh(bandGeo,lightMat);band.position.copy(p).y+=y;group.add(band);}
   }
   if(d>=0&&Math.round((d+40)/22)%2===0){const arrow=new THREE.Mesh(arrowGeo,arrowMat);arrow.position.copy(track.surf(s,0,.045));const x=V().crossVectors(s.tan3,s.up);arrow.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,s.tan3,s.up));group.add(arrow);}
  }
  const list=track.spanList(track.indexAt(zone.t0-35/track.length),track.indexAt(zone.t1+35/track.length));
  for(const side of [-1,1])track.strip(list,s=>[[side*(s.hw-.65),.035],[side*(s.hw-.45),.035]],lineMat,{parent:group,chunk:240});
  for(let d=30;d<len-25;d+=70){const t=zone.t0+d/track.length,s=track.sampleAt(t),mat=new THREE.MeshBasicMaterial({map:curtainTex,color:'#d7b889',transparent:true,opacity:.1,depthWrite:false,side:THREE.DoubleSide});const o=new THREE.Mesh(curtainGeo,mat);o.name='mirageSweepingDust';o.userData.dynamic=true;o.position.copy(s.pos).y+=18;o.rotation.y=Math.atan2(s.tan.x,s.tan.z);group.add(o);curtains.push({o,t,p:o.position.clone(),right:s.right.clone(),phase:d/65});}
 }
 const fogColor=new THREE.Color('#d7b78d'),stormColor=new THREE.Color('#c9a572'),skyTop=sky.material.uniforms.top.value.clone(),skyBottom=sky.material.uniforms.bottom.value.clone();
 const state={strength:0,visibility:950};
 function animate(time,car){const clock=window.game?.props?.clock??time;const w=stormState(track,car?.trackInfo?.t??track.nearest(car?.pos||V()).t,clock);Object.assign(state,w);
  scene.fog.near=24+(420-24)*(1-w.strength)**2;scene.fog.far=w.visibility;scene.fog.color.copy(fogColor).lerp(stormColor,w.strength*.6);
  sky.material.uniforms.top.value.copy(skyTop).lerp(stormColor,w.strength*.88);sky.material.uniforms.bottom.value.copy(skyBottom).lerp(stormColor,w.strength*.8);
  for(const c of curtains){const pulse=stormState(track,c.t,clock).strength;c.o.position.copy(c.p).addScaledVector(c.right,Math.sin(clock*.25+c.phase)*42);c.o.material.opacity=.07+.19*pulse;c.o.rotation.z=Math.sin(clock*.16+c.phase)*.03;}
 }
 return {group,animate,state,curtains};
}
