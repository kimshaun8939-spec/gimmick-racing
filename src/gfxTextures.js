import * as THREE from 'three';
import { gfxEnabled } from './gfxConfig.js';
﻿// 공용 표면: 실제 미터 단위의 공유 잡음 텍스처. glacierSurface/gfx2Enabled는 기존 호출 호환 이름.
export const gfx2Enabled = gfxEnabled;

let noiseMap;
function surfaceNoise(){
 if(noiseMap)return noiseMap;
 const n=128,d=new Uint8Array(n*n*4);for(let y=0;y<n;y++)for(let x=0;x<n;x++){let h=Math.imul(x,374761393)^Math.imul(y,668265263);h=Math.imul(h^(h>>>13),1274126177);let v=((h^(h>>>16))>>>0)>>>24;let i=(y*n+x)*4;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;}
 noiseMap=new THREE.DataTexture(d,n,n);noiseMap.wrapS=noiseMap.wrapT=THREE.RepeatWrapping;noiseMap.magFilter=THREE.LinearFilter;noiseMap.minFilter=THREE.LinearMipmapLinearFilter;noiseMap.generateMipmaps=true;noiseMap.needsUpdate=true;return noiseMap;
}
const common = /* glsl */ `
varying vec3 vGfxWorld;
varying vec3 vGfxNormal;
float gfxHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
uniform sampler2D gfxNoiseMap;uniform vec3 gfxTint;uniform float gfxSnow;
float gfxNoise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);return texture2D(gfxNoiseMap,(i+f+.5)/128.).r; }
vec3 gfxBump(vec3 n, vec3 surface, float h) {
 vec3 sx=dFdx(surface), sy=dFdy(surface);
 vec3 r1=cross(sy,n), r2=cross(n,sx);
 float det=dot(sx,r1);
 vec3 grad=sign(det)*(dFdx(h)*r1+dFdy(h)*r2);
 vec3 bumped=abs(det)*n-grad;
 return dot(bumped,bumped)>1e-16 ? normalize(bumped) : n;
}
`;
const finishes = {
 coast: 'float dry=smoothstep(.2,2.7,vGfxWorld.y); float slope=1.-smoothstep(.6,.85,abs(vGfxNormal.y)); float grain=gfxNoise(p*mix(22.,3.,dry)); float broad=gfxNoise(p*.08); diffuseColor.rgb*=1.+(grain-.5)*mix(.045,.09,dry)*nearFade+(broad-.5)*.06*dry; diffuseColor.rgb*=1.-slope*.025; diffuseColor.rgb*=mix(vec3(.92,.94,.96),vec3(1.),smoothstep(.05,.6,vGfxWorld.y));',
 grass: 'float g=gfxNoise(p*3.); float patchNoise=gfxNoise(p*.025); diffuseColor.rgb*=.88+patchNoise*.18+(g-.5)*.10*nearFade;',
 dirt: 'diffuseColor.rgb*=.82+gfxNoise(p*.13)*.24+(gfxNoise(p*9.)-.5)*.14*nearFade;',
 sand: 'diffuseColor.rgb*=.92+gfxNoise(p*.11)*.10+(gfxNoise(p*22.)-.5)*.06*nearFade;',
 asphalt: /* glsl */ `
 // Keep the two edge lines, but replace metre-sized frost flecks with fine aggregate.
 float edgePaint=step(0.025,vGfxUV.x)*step(vGfxUV.x,0.045)+step(0.955,vGfxUV.x)*step(vGfxUV.x,0.975);
 diffuseColor.rgb=mix(vec3(0.026,0.031,0.039),vec3(0.80,0.85,0.91),edgePaint);
 float aggregate=gfxNoise(p*27.0);
 float roadPatch=gfxNoise(p*0.12)*gfxNoise(p*0.47);
 float worn=gfxNoise(p*5.0);
 diffuseColor.rgb*=0.91+roadPatch*0.21+(aggregate-0.5)*0.30*nearFade;
 // Existing lane paint remains in the map; its small chips fade before they can shimmer.
 diffuseColor.rgb*=1.0-smoothstep(0.79,0.94,worn)*0.17*nearFade;
 float trackU=vGfxUV.x;
 float wheel=min(abs(trackU-0.35),abs(trackU-0.65));
 diffuseColor.rgb*=1.0-(1.0-smoothstep(0.035,0.11,wheel))*(0.07+roadPatch*0.10);
`,
 snow: /* glsl */ `
 float drift=gfxNoise(p*vec2(0.11,0.025));
 float wind=sin(p.x*2.1+p.y*0.43+gfxNoise(p*0.08)*7.0);
 float grain=gfxNoise(p*32.0);
 diffuseColor.rgb*=mix(vec3(.73,.81,.91),vec3(.96,.97,.98),drift)+wind*0.012*midFade+(grain-0.5)*0.045*nearFade;
 diffuseColor.rgb+=vec3(0.018,0.025,0.030)*smoothstep(0.89,0.98,grain)*nearFade;
`,
 rock: /* glsl */ `
 float strata=sin(vGfxWorld.y*2.9+gfxNoise(p*0.15)*5.0);
 float grain=gfxNoise(p*8.0+vGfxWorld.y);
 float snowCap=smoothstep(0.48,0.86,normalize(vGfxNormal).y);
 diffuseColor.rgb*=0.86+gfxNoise(p*0.17)*0.22+strata*0.065*midFade+(grain-0.5)*0.12*nearFade;
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.73,0.82,0.91),snowCap*0.13*gfxSnow);
`,
 ice: /* glsl */ `
 vec2 cell=floor(p*2.4); vec2 local=fract(p*2.4)-0.5;
 float bubble=(1.0-smoothstep(0.015,0.075,length(local)))*step(0.83,gfxHash(cell));
 float vein=1.0-smoothstep(0.015,0.055,abs(sin(p.x*1.6+gfxNoise(p*0.23)*9.0)));
 diffuseColor.rgb*=0.93+gfxNoise(p*0.16)*0.13;
 diffuseColor.rgb+=vec3(0.09,0.12,0.14)*(vein*0.26*midFade+bubble*0.4*nearFade);
`,
};

/** Works with Standard and Lambert, including the existing fog material callback. */
export function gfxSurface(material, kind = 'snow', options = {}) {
 if (!gfx2Enabled() || material.userData.gfxSurface) return material;
 const oldCompile=material.onBeforeCompile;
 const oldKey=material.customProgramCacheKey();
 material.userData.gfxSurface=kind;
 material.onBeforeCompile=function(shader, renderer) {
  oldCompile.call(this,shader,renderer);
  shader.uniforms.gfxNoiseMap={value:surfaceNoise()};
  shader.uniforms.gfxTint={value:new THREE.Color(options.tint??0xffffff)};
  shader.uniforms.gfxSnow={value:options.snow===false?0:1};
  shader.vertexShader='varying vec3 vGfxWorld;\nvarying vec3 vGfxNormal;\n'+(kind==='asphalt'?'varying vec2 vGfxUV;\n':'')+shader.vertexShader;
  if(kind==='asphalt') shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvGfxUV=uv;');
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>', /* glsl */ `
   vec4 gfxP=vec4(transformed,1.0); vec3 gfxN=objectNormal;
   #ifdef USE_INSTANCING
    gfxP=instanceMatrix*gfxP; gfxN=mat3(instanceMatrix)*gfxN;
   #endif
   vGfxWorld=(modelMatrix*gfxP).xyz;
   vGfxNormal=normalize(mat3(modelMatrix)*gfxN);
   #include <project_vertex>
  `);
  shader.fragmentShader=common+(kind==='asphalt'?'varying vec2 vGfxUV;\n':'')+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n'+/* glsl */ `
   vec2 p=vGfxWorld.xz;
   float gfxDist=length(cameraPosition-vGfxWorld);
   float nearFade=1.0-smoothstep(9.0,48.0,gfxDist);
   float midFade=1.0-smoothstep(45.0,180.0,gfxDist);
  `+(finishes[kind] || finishes.snow)+'\ndiffuseColor.rgb*=gfxTint;');
  if(material.isMeshStandardMaterial) {
   const amplitude=kind==='rock'?'0.055':kind==='ice'?'0.012':kind==='asphalt'?'0.003':'0.007';
   shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',/* glsl */ `
    #include <normal_fragment_maps>
    float gfxHeight=(gfxNoise(vGfxWorld.xz*${kind==='rock'?'2.4':'12.0'}+vGfxWorld.y*0.7)-0.5)*${amplitude};
    ${kind==='rock'?'gfxHeight+=sin(vGfxWorld.y*3.4+gfxNoise(vGfxWorld.xz*0.16)*3.0)*0.027;':''}
    gfxHeight*=1.0-smoothstep(35.0,135.0,length(cameraPosition-vGfxWorld));
    normal=gfxBump(normal,-vViewPosition,gfxHeight);
   `);
  }
 };
 material.customProgramCacheKey=()=>oldKey+'|glacierSurface2:'+kind;
 // staticBatch의 색 굽기 복제에도 절차 표면을 보존한다 (Three의 기본 clone은 콜백을 복사하지 않는다).
 const baseClone=material.clone;
 material.clone=function() {
  const copy=baseClone.call(this);
  copy.onBeforeCompile=this.onBeforeCompile;
  copy.customProgramCacheKey=this.customProgramCacheKey;
  copy.clone=this.clone;
  return copy;
 };
 material.needsUpdate=true;
 return material;
}


export const glacierSurface = gfxSurface;
