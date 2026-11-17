// Shared opt-in photo surfaces. No scene/physics mutations; URLs are relative to this module.
import * as THREE from 'three';
import { settings } from './settings.js';
const cache = new Map(), pending = [];
export const pbrStats = { loaded: 0, errors: [], textures: [] };
function texture(asset, kind) {
  const key = asset + '/' + kind;
  if (cache.has(key)) return cache.get(key);
  let done;
  pending.push(new Promise(resolve => { done = resolve; }));
  const t = new THREE.TextureLoader().load(new URL('./art/tex/' + key + '.webp', import.meta.url).href,
    tex => { pbrStats.loaded++; pbrStats.textures.push({key, width:tex.image.width,height:tex.image.height}); done(); },
    undefined, () => { pbrStats.errors.push(key); done(); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}
export const pbrReady = () => Promise.all(pending);
export function preloadPbr(assets) {
  for(const asset of assets){texture(asset,'diff');texture(asset,'arm');if(settings.get('quality')!=='medium')texture(asset,'nor_gl');}
  return pbrReady();
}

/** Photo PBR with metre-scale mapping. clone preserves shaders through staticBatch. */
export function photoMaterial(asset, options = {}) {
  const { scale = 4, snow = false, road = false, ice = false, paint = null, ...props } = options;
  const medium = settings.get('quality') === 'medium';
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0,
    envMapIntensity: .12, ...props, map:texture(asset,'diff'),
    normalMap: medium ? null : texture(asset,'nor_gl'),
    normalScale:new THREE.Vector2(road?.18:.28,road?.18:.28),
    roughnessMap:texture(asset,'arm'), aoMap:texture(asset,'arm'), aoMapIntensity:snow || asset==='snow_02' ? .06 : .3 });
  m.userData.photoSurface = asset;
  // Uniforms keep ARM and colour aligned even on meshes with no original UVs.
  m.onBeforeCompile = shader => {
    shader.uniforms.photoSnow = {value:snow ? texture('snow_02','diff') : m.map};
    if (paint) shader.uniforms.photoPaint = {value:paint};
    shader.vertexShader = 'varying vec3 photoWorld; varying vec3 photoN; varying vec2 photoUV;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 pp = vec4(transformed,1.); vec3 pn=objectNormal;
      #ifdef USE_INSTANCING
        pp=instanceMatrix*pp; pn=mat3(instanceMatrix)*pn;
      #endif
      photoWorld=(modelMatrix*pp).xyz; photoN=normalize(mat3(modelMatrix)*pn); photoUV=uv;
      #include <project_vertex>`);
    shader.fragmentShader = `varying vec3 photoWorld; varying vec3 photoN; varying vec2 photoUV;
      uniform sampler2D photoSnow; ${paint ? 'uniform sampler2D photoPaint;' : ''}
      vec3 photoBump(vec3 n, vec3 p, vec2 uv, vec3 nm) {
        vec3 q0=dFdx(p), q1=dFdy(p); vec2 st0=dFdx(uv),st1=dFdy(uv);
        vec3 t=q0*st1.y-q1*st0.y, b=-q0*st1.x+q1*st0.x;
        float inv=inversesqrt(max(max(dot(t,t),dot(b,b)),1e-12));
        return normalize(t*inv*nm.x+b*inv*nm.y+n*nm.z);
      }
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 an=abs(normalize(photoN));
      vec2 pu=an.y>.55 ? photoWorld.xz : (an.x>an.z ? photoWorld.zy : photoWorld.xy);
      pu/=${Number(scale).toFixed(3)};
      vec2 pv=mat2(.8,-.6,.6,.8)*pu*.371+vec2(13.7,7.3);
      float pf=smoothstep(45.,240.,length(cameraPosition-photoWorld));
      vec3 photo=mix(texture2D(map,pu).rgb,texture2D(map,pv).rgb,.24+pf*.46);
      ${road || paint ? 'photo=vec3(dot(photo,vec3(.2126,.7152,.0722)))*1.18;' : ''}
      ${road ? 'photo=photo*1.65+vec3(.018,.023,.030);' : ''}
      ${ice ? 'photo=mix(photo,vec3(.21,.43,.61),.55);' : ''}
      ${snow ? 'vec3 ps=mix(texture2D(photoSnow,photoWorld.xz*.45).rgb,texture2D(photoSnow,mat2(.8,-.6,.6,.8)*photoWorld.xz*.157+vec2(2.,7.)).rgb,.4); photo=mix(photo,ps,smoothstep(.48,.86,normalize(photoN).y)*.94); photo=mix(photo,vec3(dot(photo,vec3(.2126,.7152,.0722)))*vec3(.88,.95,1.05),.7);' : ''}
      ${snow || asset==='snow_02' ? `float snowCover=${snow ? 'smoothstep(.40,.80,normalize(photoN).y)' : '1.'}; float snowGrain=dot(photo,vec3(.2126,.7152,.0722)); photo=mix(photo,vec3(.90,.95,1.)*(.92+clamp(snowGrain,0.,1.)*.08),snowCover);` : ''}
      ${paint ? 'photo=mix(vec3(.88),vec3(1.),clamp(photo.r,0.,1.));' : ''}
      diffuseColor.rgb*=photo;
      ${paint ? 'diffuseColor.rgb*=texture2D(photoPaint,photoUV).rgb;' : ''}
      ${road ? `
        float ep=step(.025,photoUV.x)*step(photoUV.x,.045)+step(.955,photoUV.x)*step(photoUV.x,.975);
        float wear=smoothstep(.12,.27,texture2D(map,pu*1.7).r);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.68,.73,.78),ep*(.6+.4*wear));
        float aggregate=texture2D(map,pu*3.7).r; diffuseColor.rgb*=mix(1.,.78+aggregate*1.65,1.-smoothstep(8.,55.,length(cameraPosition-photoWorld)));
        float wheels=exp(-pow((photoUV.x-.35)*24.,2.))+exp(-pow((photoUV.x-.65)*24.,2.));
        diffuseColor.rgb*=1.-wheels*.18;
        // Broad repaired seams, with rough photo edges; no decal draw call.
        float repair=smoothstep(.075,.13,texture2D(map,pu*.087+vec2(4.1,9.7)).r);
        diffuseColor.rgb*=1.-repair*.13;
      ` : ''}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
      'float roughnessFactor=roughness*mix(texture2D(roughnessMap,pu).g,texture2D(roughnessMap,pv).g,.24+pf*.46); roughnessFactor=max(roughnessFactor,.48);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `
      float pao=mix(texture2D(aoMap,pu).r,texture2D(aoMap,pv).r,.24);
      reflectedLight.indirectDiffuse*=mix(1.,pao,aoMapIntensity);`);
    if (!medium) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      if(length(cameraPosition-photoWorld)<110.) {
        vec3 photoNormal=texture2D(normalMap,pu).xyz*2.-1.;
        photoNormal.xy*=normalScale*(1.-smoothstep(25.,110.,length(cameraPosition-photoWorld)));
        normal=photoBump(normal,-vViewPosition,pu,photoNormal);
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
      #include <fog_fragment>
      float lowMist=(1.-smoothstep(1.,9.,photoWorld.y))*smoothstep(28.,200.,length(cameraPosition-photoWorld))*.065;
      gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.40,.51,.66),lowMist);`);
  };
  m.customProgramCacheKey = () => 'photo8b:' + [asset,scale,snow,road,ice,!!paint,medium].join(':');
  const clone = m.clone;
  m.clone = function() { const c=clone.call(this); c.onBeforeCompile=this.onBeforeCompile;c.customProgramCacheKey=this.customProgramCacheKey;c.clone=this.clone;return c; };
  return m;
}
