// Industrial finishes only: preserve all labels, emission, moving parts and collision.
import * as THREE from 'three';
import { gfxEnabled } from './gfxConfig.js';
import { gfxSurface } from './gfxTextures.js';
export function foundryFinishes(group){
 if(!gfxEnabled())return;
 const copies=new Map();group.traverse(o=>{
 const src=o.material;if(!src?.isMeshStandardMaterial||src.map||src.transparent)return;
 if(copies.has(src)){o.material=copies.get(src);return;}
 const m=src.clone();m.onBeforeCompile=src.onBeforeCompile;m.customProgramCacheKey=src.customProgramCacheKey;
 gfxSurface(m,'dirt',{snow:false});const old=m.onBeforeCompile,key=m.customProgramCacheKey;
 m.onBeforeCompile=function(s,r){old.call(this,s,r);s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 vec2 face=vec2(dot(vGfxWorld.xz,vec2(-vGfxNormal.z,vGfxNormal.x)),vGfxWorld.y);
 float wear=gfxNoise(face*.37),fine=gfxNoise(face*19.);
 float brick=smoothstep(2.,2.5,diffuseColor.r/max(.001,diffuseColor.g))*(1.-smoothstep(.29,.34,diffuseColor.r));
 vec2 grid=face/vec2(.85,.34);grid.x+=mod(floor(grid.y),2.)*.5;vec2 q=fract(grid);vec2 aa=max(fwidth(grid),vec2(.015));
 float mortar=max(1.-smoothstep(.025,.025+aa.x,min(q.x,1.-q.x)),1.-smoothstep(.025,.025+aa.y,min(q.y,1.-q.y)));
 float rust=smoothstep(.53,.78,wear)*(.35+.35*gfxNoise(face*2.));
 float oil=smoothstep(.68,.86,gfxNoise(face*vec2(.4,.06)));
 float scratch=pow(.5+.5*sin(face.x*79.+gfxNoise(face*.9)*9.),18.);
 vec3 wornMetal=mix(diffuseColor.rgb,vec3(.25,.095,.035),rust*.32)*(1.-oil*.18);
 vec3 masonry=mix(diffuseColor.rgb*(.88+wear*.2),diffuseColor.rgb*vec3(.66,.79,.85),mortar*.65);
 diffuseColor.rgb=mix(wornMetal,masonry,brick)*(.97+fine*.06);
 float concrete=smoothstep(.24,.36,min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b)));
 float joint=1.-smoothstep(.012,.028,abs(sin(face.x*1.57)*sin(face.y*1.05)));
 diffuseColor.rgb*=1.-concrete*(joint*.09+oil*.06);
 diffuseColor.rgb+=scratch*.012*(1.-brick)*(1.-smoothstep(8.,45.,length(cameraPosition-vGfxWorld)));
 `);};m.customProgramCacheKey=()=>key()+'|gfx9BakedFactory';
 o.material=m;copies.set(src,m);
 });
}
export function foundryHorizon(track,group){
 if(!gfxEnabled())return;
 const b=track.terrainBox,cx=(b.min.x+b.max.x)/2,cz=(b.min.y+b.max.y)/2,r=Math.hypot(b.max.x-b.min.x,b.max.y-b.min.y)*.52;
 const matrix=new THREE.Matrix4();
 for(let layer=0;layer<2;layer++){const m=new THREE.MeshBasicMaterial({color:['#b4a39b','#c1ada5'][layer],fog:false,toneMapped:false}),im=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),m,96);for(let i=0;i<96;i++){const a=i/96*Math.PI*2+layer*.03,h=i%3?22+18*(1+Math.sin(i*7)):65+25*Math.sin(i*11);matrix.makeScale(i%3?28:6,h+400,i%3?30:6);matrix.setPosition(cx+Math.cos(a)*(r+layer*180),h/2-209,cz+Math.sin(a)*(r+layer*180));im.setMatrixAt(i,matrix);}im.computeBoundingSphere();m.onBeforeCompile=s=>{s.vertexShader=s.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\ngl_Position.z=gl_Position.w*.9999999;');};m.customProgramCacheKey=()=> 'gfx9DistantFactory';im.renderOrder=-1;im.name='gfx9IndustrialHorizon'+layer;im.userData.noBatch=true;group.add(im);}
}
