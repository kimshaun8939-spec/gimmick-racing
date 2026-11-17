// 빙하 시험판 전용: 이미지와 난수 소비 없이 실제 미터 단위로 표면을 새긴다.
export const gfx2Enabled = () => {
 const params = new URLSearchParams(location.search);
 return params.get('map') === 'glacier' && params.get('gfx') === '2';
};

const common = /* glsl */ `
varying vec3 vGfxWorld;
varying vec3 vGfxNormal;
float gfxHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float gfxNoise(vec2 p) {
 vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(gfxHash(i),gfxHash(i+vec2(1,0)),f.x),mix(gfxHash(i+vec2(0,1)),gfxHash(i+vec2(1,1)),f.x),f.y);
}
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
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.73,0.82,0.91),snowCap*0.13);
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
export function glacierSurface(material, kind = 'snow') {
 if (!gfx2Enabled() || material.userData.gfxSurface) return material;
 const oldCompile=material.onBeforeCompile;
 const oldKey=material.customProgramCacheKey();
 material.userData.gfxSurface=kind;
 material.onBeforeCompile=function(shader, renderer) {
  oldCompile.call(this,shader,renderer);
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
  `+(finishes[kind] || finishes.snow));
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

