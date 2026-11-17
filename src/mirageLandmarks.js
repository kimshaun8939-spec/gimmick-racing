import * as THREE from 'three';
import {sandstone,desertRock} from './gfxMirage.js';
import {gfxEnabled} from './gfxConfig.js';
import {batchLocal} from './staticBatch.js';
// Render-only landmarks. No collider registration, random draws, or road mutations.
export function buildMirageLandmarks(track,parent){
 const stone=new THREE.MeshStandardMaterial({color:'#c89672',roughness:.95});if(gfxEnabled())sandstone(stone);
 const rust=new THREE.MeshStandardMaterial({color:'#875c44',roughness:.9,metalness:.25});
 const steel=new THREE.MeshStandardMaterial({color:'#383c3b',roughness:.8,metalness:.45}),glass=new THREE.MeshStandardMaterial({color:'#172b31',roughness:.3}),paint=new THREE.MeshStandardMaterial({color:'#747e73',roughness:.85}),sand=new THREE.MeshStandardMaterial({color:'#cba071',roughness:1});
 const bone=new THREE.MeshStandardMaterial({color:'#d8cdb4',roughness:.87});

 {const m=rust;m.onBeforeCompile=s=>{s.vertexShader='varying vec3 wearP;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwearP=position;');s.fragmentShader='varying vec3 wearP;\n'+s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat grain=fract(sin(dot(floor(wearP*7.),vec3(12.9898,78.233,39.425)))*43758.5453);diffuseColor.rgb*=.86+.14*grain;');};m.customProgramCacheKey=()=> 'mirage3Wear';}

 {const m=bone;m.onBeforeCompile=s=>{s.vertexShader='varying vec3 wearP;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwearP=position;');s.fragmentShader='varying vec3 wearP;\n'+s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat grain=fract(sin(dot(floor(wearP*7.),vec3(12.9898,78.233,39.425)))*43758.5453);diffuseColor.rgb*=.86+.14*grain;');};m.customProgramCacheKey=()=> 'mirage3Wear';}

 {const m=paint;m.onBeforeCompile=s=>{s.vertexShader='varying vec3 wearP;\n'+s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwearP=position;');s.fragmentShader='varying vec3 wearP;\n'+s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat grain=fract(sin(dot(floor(wearP*7.),vec3(12.9898,78.233,39.425)))*43758.5453);diffuseColor.rgb*=.86+.14*grain;');};m.customProgramCacheKey=()=> 'mirage3Wear';}
 const ball=new THREE.SphereGeometry(1,16,10),tube=new THREE.CylinderGeometry(1,1,1,12),cube=new THREE.BoxGeometry(1,1,1),rock=desertRock(1),groups=[],moving=[];
 function add(f,g,m,x,y,z,sx,sy,sz){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);f.add(o);return o;}
 function beam(f,a,b,w,m=rust){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av),o=add(f,tube,m,...av.add(bv).multiplyScalar(.5).toArray(),w,d.length(),w);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;}
 function site(t,lat,name){const s=track.sampleAt(t),p=track.surf(s,lat);p.y=track.heightAt(p.x,p.z);const f=new THREE.Group();f.position.copy(p);f.rotation.y=Math.atan2(s.tan.x,s.tan.z);f.name='mirage2'+name;f.userData.dynamic=true;parent.add(f);groups.push(f);return f;}
 // Navigator removed after three visual reviews: facial silhouette below quality bar.
 const ruins=site(.43,-135,'LostGate');ruins.scale.setScalar(1.4);ruins.rotation.y+=Math.PI/2;
 for(const x of [-15,15]){add(ruins,cube,stone,x,1,0,11,2,12);for(let i=0;i<5;i++)add(ruins,cube,stone,x,4+i*5.2,0,8.5,5,9);add(ruins,cube,stone,x,28,0,11,2.4,11);
 for(let i=0;i<5;i++){add(ruins,cube,rust,x,5+i*4,4.53,3,.25,.12);add(ruins,cube,stone,x-1,6+i*4,4.7,.45,1.5,.4);}}
 add(ruins,cube,stone,-9,31,0,24,4,10);
 const broken=add(ruins,cube,stone,14,30,0,12,4,10);broken.rotation.z=-.17;
 for(let i=0;i<14;i++){const o=add(ruins,cube,stone,(i*17%55)-27,1.3,(i*13%30)-10,3+i%4,2+i%3,3+i%5);o.rotation.set(i*.2,i*1.7,i*.13);}
 const mesas=site(.255,-145,'SculptedMesa');for(let i=0;i<12;i++){const h=25+(i*23%55),o=add(mesas,desertRock(i%3),stone,(i%4)*30-40,h*.42,Math.floor(i/4)*27,10+(i*7%16),h,9+(i*3%13));o.rotation.y=i*1.71;}
 // Aircraft removed after three visual reviews: sheet-like wings and pristine body below quality bar.
 const pumps=site(.385,-105,'WindPumps');pumps.rotation.y+=Math.PI/2;
 for(let k=0;k<2;k++){const x=k*35;
 for(const sx of [-1,1])for(const sz of [-1,1])beam(pumps,[x+sx*5,0,sz*5],[x+sx*1.5,29,sz*1.5],.19,steel);
 for(let y=0;y<27;y+=5){const w=5-y*.12,w2=5-(y+5)*.12;for(const z of [-1,1]){beam(pumps,[x-w,y,z*w],[x+w2,y+5,z*w2],.09,steel);beam(pumps,[x+w,y,z*w],[x-w2,y+5,z*w2],.09,steel);}for(const xx of [-1,1])beam(pumps,[x+xx*w,y,-w],[x+xx*w2,y+5,w2],.09,steel);}
 const wheel=new THREE.Group();wheel.position.set(x,31,1.7);pumps.add(wheel);
 for(let j=0;j<22;j++){const a=j*Math.PI*2/22;const fin=add(wheel,cube,paint,Math.cos(a)*5.5,Math.sin(a)*5.5,0,3.5,.95,.1);fin.rotation.set(.2,0,a+.2);beam(wheel,[0,0,0],[Math.cos(a)*7,Math.sin(a)*7,0],.045,steel);}
 add(wheel,new THREE.TorusGeometry(7,.07,4,64),steel,0,0,0,1,1,1);add(wheel,tube,rust,0,0,0,.55,1,.55).rotation.x=Math.PI/2;
 beam(pumps,[x,31,0],[x+11,31,-1],.14,steel);const vane=add(pumps,cube,paint,x+10,31,-1,5,3,.12);vane.rotation.y=.2;
 batchLocal(wheel);moving.push({o:wheel,kind:'wheel'});
 }
 add(pumps,tube,paint,-18,5,3,6,10,6);add(pumps,tube,rust,-18,10.2,3,6.3,.4,6.3);
 for(let y=1;y<10;y+=2) add(pumps,new THREE.TorusGeometry(6.03,.08,4,40),steel,-18,y,3,1,1,1).rotation.x=Math.PI/2;
 const derrick=site(.745,-150,'OilDerrick');for(const x of [-1,1])for(const z of [-1,1])beam(derrick,[x*9,0,z*9],[x*2,43,z*2],.55);for(let y=5;y<40;y+=7){for(const z of [-1,1]){beam(derrick,[-8,y,z*7],[5,y+7,z*4],.25);beam(derrick,[8,y,z*7],[-5,y+7,z*4],.25);}}add(derrick,cube,rust,0,43,0,8,2,8);beam(derrick,[0,43,0],[0,51,0],.6);
 const train=site(.52,-220,'FreightTrain');train.position.y=24;
 // Diesel locomotive and a mixed freight consist, local -Z is forward.
 for(let i=0;i<8;i++){const z=i*19;add(train,cube,steel,0,2,z,7.5,.8,17);add(train,cube,steel,0,2,z+9.2,1,.45,2.2);
 for(const dz of [-5.6,5.6]){add(train,cube,steel,0,1.3,z+dz,6.8,.8,3.7);for(const ax of [-1,1])for(const x of [-3.5,3.5]){const w=add(train,tube,steel,x,1.1,z+dz+ax*1.15,1.1,.65,1.1);w.rotation.z=Math.PI/2;add(train,tube,rust,x*1.03,1.1,z+dz+ax*1.15,.45,.7,.45).rotation.z=Math.PI/2;}}
 if(i===0){add(train,cube,paint,0,4.8,1,5.8,4.8,13);add(train,cube,paint,0,6,-5.8,6.7,7,4.8);add(train,cube,bone,0,9.6,-5.8,7.4,.5,5.4);
 add(train,cube,glass,0,7.4,-8.24,5.5,1.8,.08);for(const x of [-1,1])add(train,cube,glass,x*3.4,7.4,-5.7,.08,1.8,3);
 for(let j=0;j<14;j++)for(const x of [-1,1])add(train,cube,steel,x*2.94,5.3,-.5+j*.47,.1,2.6,.18);
 for(const x of [-2,2])add(train,cube,bone,x,5,-8.3,.65,.65,.2);
 add(train,cube,steel,0,2,-9,7,1.4,.7);for(const x of [-1,1]){beam(train,[x*3.6,3,-8],[x*3.6,3,8],.065,bone);for(let zz=-7;zz<9;zz+=3)beam(train,[x*3.6,2.4,zz],[x*3.6,4,zz],.055,bone);}
 add(train,cube,steel,0,7.8,4,1.5,1.4,1.2);
 }else if(i%3===1){const tank=new THREE.CylinderGeometry(3.1,3.1,13,24);tank.rotateX(Math.PI/2);add(train,tank,paint,0,5.7,z,1,1,1);for(const zz of [-6.5,6.5])add(train,ball,paint,0,5.7,z+zz,3.1,3.1,.6);add(train,tube,steel,0,9,z,1,1,1);for(const zz of [-4,4]){add(train,cube,steel,0,3,z+zz,6,1,1);}}
 else if(i%3===2){add(train,cube,rust,0,6,z,6.7,7,15.5);for(let zz=-7;zz<=7;zz+=.65)for(const x of [-1,1])add(train,cube,paint,x*3.4,6,z+zz,.12,6.7,.12);add(train,cube,steel,0,6,z-7.8,.12,6.5,.1);}
 else{add(train,cube,rust,0,6,z,7,5,14);for(let zz=-5;zz<=5;zz+=5){const hopper=add(train,cube,rust,0,3.4,z+zz,4,3,4);hopper.rotation.z=Math.PI/4;}add(train,cube,steel,0,8.55,z,6.2,.15,13);}
 }
 moving.push({o:train,kind:'train',base:train.position.clone(),dir:track.sampleAt(.52).tan.clone()});
 const rail=site(.52,-220,'DistantRail');rail.position.y=24;for(const x of [-3,3])add(rail,cube,steel,x,.3,0,.22,.45,640);for(let z=-318;z<320;z+=2.2)add(rail,cube,rust,0,-.1,z,8,.25,.65);add(rail,cube,stone,0,-1.4,0,10,2,640);
 for(let z=-300;z<=300;z+=40){const p=rail.localToWorld(new THREE.Vector3(0,0,z)),h=Math.max(1,24-track.heightAt(p.x,p.z));add(rail,tube,stone,0,-h/2,z,2,h,2);}
 const lods=[];for(const f of groups){const far=f.clone(true);far.name=f.name+'Far';far.traverse(o=>{if(o.isMesh){if(o.geometry===ball)o.geometry=new THREE.SphereGeometry(1,7,5);else if(o.geometry===tube)o.geometry=new THREE.CylinderGeometry(1,1,1,5);}});parent.add(far);batchLocal(f);batchLocal(far);lods.push(far);}
 return {groups,animate(t,camera){for(let i=0;i<groups.length;i++){const f=groups[i],far=lods[i],d=camera?camera.position.distanceToSquared(f.position):0;f.visible=d<360*360;far.visible=d>=360*360&&d<900*900;far.position.copy(f.position);}for(const x of moving){if(!x.o.visible)continue;if(x.kind==='wheel')x.o.rotation.z=t*.16;else x.o.position.copy(x.base).addScaledVector(x.dir,Math.sin(t*.012)*160);}}};
}
