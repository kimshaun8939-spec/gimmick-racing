// Soft procedural cloud billboards for the new map skies. No remote assets.
import * as THREE from 'three';
let cloudMap;
export function addMapCloud(parent,position,scale,color='#fff1dd',opacity=.32){
 if(!cloudMap){const c=document.createElement('canvas');c.width=512;c.height=192;const g=c.getContext('2d');let seed=3481;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};for(let k=0;k<65;k++){const x=70+rnd()*370,y=70+rnd()*45,r=22+rnd()*48,gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,'rgba(255,255,255,.22)');gr.addColorStop(.55,'rgba(255,255,255,.09)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2);}cloudMap=new THREE.CanvasTexture(c);cloudMap.colorSpace=THREE.SRGBColorSpace;}
 const o=new THREE.Sprite(new THREE.SpriteMaterial({map:cloudMap,color,transparent:true,opacity,depthWrite:false,fog:false}));o.position.copy(position);o.scale.set(...scale);parent.add(o);return o;
}
