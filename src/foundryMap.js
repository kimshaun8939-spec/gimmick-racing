// data/foundry.json 전용 모듈. 원판의 수평 접촉면은 회전해도 같은 평면이므로 fastTrack 캐시와 호환.
import * as THREE from 'three';
import { buildFoundryTrack, canvasTexture } from './foundryTrack.js';
export { buildFoundryScenery as buildScenery } from './foundryScenery.js';
export { buildFoundryProps as buildProps } from './foundryProps.js';
export function buildTrack(data,scene){const tr=buildFoundryTrack(data,scene),cfg=data.turntable,s=tr.sampleAt(cfg.t),p=s.pos.clone();
 const tex=canvasTexture(1024,1024,(g,w,h)=>{g.fillStyle='#143f43';g.fillRect(0,0,w,h);g.translate(w/2,h/2);for(let k=0;k<32;k++){g.rotate(Math.PI/16);g.fillStyle=k%4?'#8b7450':'#ffbc45';g.fillRect(65,-3,438,6);}g.strokeStyle='#ffcb64';g.lineWidth=18;for(let r of [82,205,385,495]){g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.stroke();}g.fillStyle='#8fffe0';g.beginPath();g.arc(0,0,48,0,Math.PI*2);g.fill();for(let k=0;k<8;k++){g.save();g.rotate(k*Math.PI/4);g.translate(0,-320);g.rotate(-Math.PI/2);g.fillStyle='#ffe09c';g.beginPath();g.moveTo(-40,0);g.lineTo(0,-55);g.lineTo(40,0);g.lineTo(16,0);g.lineTo(16,55);g.lineTo(-16,55);g.lineTo(-16,0);g.closePath();g.fill();g.restore();}});
 const disk=new THREE.Mesh(new THREE.CircleGeometry(cfg.radius,96),new THREE.MeshStandardMaterial({map:tex,roughness:.6,metalness:.18,emissive:'#30433a',emissiveIntensity:.35}));disk.name='foundryTurntable';disk.userData.dynamic=true;disk.userData.surface='ground';disk.rotation.x=-Math.PI/2;disk.position.copy(p).y+=.07;disk.receiveShadow=true;tr.group.add(disk);tr.groundMeshes.push(disk);
 const rim=new THREE.Mesh(new THREE.TorusGeometry(cfg.radius,.32,6,96),new THREE.MeshStandardMaterial({color:'#cf9e4a',roughness:.5,metalness:.5}));rim.rotation.x=Math.PI/2;rim.position.copy(p);tr.group.add(rim);
 const oldEdge=tr.edgeInfo,oldRoad=tr.isOnRoad,oldLineY=tr.lineY;const inDisk=pos=>Math.hypot(pos.x-p.x,pos.z-p.z)<cfg.radius-.4&&Math.abs(pos.y-p.y)<3;
 tr.edgeInfo=(pos,near)=>inDisk(pos)?{off:0,kerb:0,offK:0,kerbK:0,runoff:false}:oldEdge(pos,near);tr.isOnRoad=(pos,near)=>inDisk(pos)||oldRoad(pos,near);
 tr.lineY=(i,d=0)=>oldLineY(i,d)+(Math.hypot(tr.samples[i].pos.x-p.x,tr.samples[i].pos.z-p.z)<cfg.radius?.1:0);
 tr.turntable={...cfg,center:p,disk,inDisk};const anim=tr.animate;tr.animate=t=>{anim(t);disk.rotation.z=t*cfg.angularSpeed;};tr.group.updateMatrixWorld(true);return tr;}
