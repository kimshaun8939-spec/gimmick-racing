// gfx3: SAO removed. Small highlight bloom shares the grading pass (8 samples, no extra draws).
// 빙하 그래픽 시험판. 선형 색으로 효과를 쌓고 OutputPass에서만 화면 색으로 변환한다.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';


import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const MAP_GRADES = { glacier: { contrast: 1.035, saturation: 0.96, vignette: 0.12, bloom: 0.11 } };
export function createPostFx(renderer, scene, camera, quality) {
  // Three UUID 생성도 레이스 난수 흐름과 분리한다.
  const random = Math.random; let seed = 92517;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  try { return buildPostFx(renderer, scene, camera, quality); }
  finally { Math.random = random; }
}
function buildPostFx(renderer, scene, camera, quality) {
  const grade = MAP_GRADES.glacier;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(1);
  const scenePass = new RenderPass(scene, camera);
  composer.addPass(scenePass);
  const color = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, pixel: {value: new THREE.Vector2()}, glow: {value: grade.bloom}, contrast: { value: grade.contrast }, saturation: { value: grade.saturation }, vignette: { value: grade.vignette } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 pixel; uniform float glow,contrast,saturation,vignette; varying vec2 vUv;
      vec3 bright(vec2 o){return max(texture2D(tDiffuse,vUv+o*pixel).rgb-vec3(1.6),vec3(0.));}
      void main(){vec4 src=texture2D(tDiffuse,vUv); vec3 c=src.rgb;
      vec3 halo=bright(vec2(3.,0.))+bright(vec2(-3.,0.))+bright(vec2(0.,3.))+bright(vec2(0.,-3.));
      halo+=.5*(bright(vec2(5.,5.))+bright(vec2(-5.,5.))+bright(vec2(5.,-5.))+bright(vec2(-5.,-5.)));
      c+=halo*(glow/6.);
      float l=dot(c,vec3(.2126,.7152,.0722));
      c=mix(vec3(l),c,saturation);
      c*=mix(vec3(.975,.995,1.025),vec3(1.018,1.004,.984),smoothstep(.15,1.3,l));
      c=max(vec3(0.),(c-.18)*contrast+.18);
      vec2 p=(vUv-.5)*2.; c*=1.-vignette*smoothstep(.3,1.65,dot(p,p));
      gl_FragColor=vec4(c,src.a); }`
  });
  composer.addPass(color);
  const aa = new ShaderPass(FXAAShader);
  composer.addPass(aa);
  composer.addPass(new OutputPass());
  let width = 0, height = 0;
  let effectsOn = null;
  const size = new THREE.Vector2();
  function resize() {
    renderer.getDrawingBufferSize(size);
    if (size.x === width && size.y === height) return;
    width = size.x; height = size.y;
    composer.setSize(width, height);
    effectsOn = null;
    aa.uniforms.resolution.value.set(1 / width, 1 / height);
    color.uniforms.pixel.value.set(1 / width, 1 / height);
  }
  function render() {
    resize();
    color.uniforms.glow.value = quality() === 'low' ? 0 : grade.bloom;
    composer.render();
  }
  function stats() {
    const targets = new Set([composer.renderTarget1, composer.renderTarget2]);
    for (const pass of composer.passes) for (const value of Object.values(pass)) {
      if (value?.isWebGLRenderTarget) targets.add(value);
      else if (Array.isArray(value)) for (const target of value) if (target?.isWebGLRenderTarget) targets.add(target);
    }
    let targetBytes = 0;
    for (const target of targets) {
      const channelBytes = target.texture.type === THREE.HalfFloatType ? 2 : target.texture.type === THREE.FloatType ? 4 : 1;
      targetBytes += target.width * target.height * (4 * channelBytes + (target.depthBuffer ? 4 : 0));
    }
    return { width, height, aoWidth: 0, aoHeight: 0, ao: false, bloom: quality() !== 'low', targetMiB: +(targetBytes / 1048576).toFixed(2) };
  }
  return { render, resize, composer, stats,
    warm() {
      const t = performance.now();
      resize();
      // Scene/shadow variants have already been drawn by prewarm. Prepare the actual
      // full-size post targets and all post shaders without drawing the same scene again.
      const oldTarget=renderer.getRenderTarget(),oldClear=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha();
      scenePass.enabled=false;
      try {
        renderer.setClearColor(0,0);
        for(const target of [composer.readBuffer,composer.writeBuffer]){renderer.setRenderTarget(target);renderer.clear();}
        renderer.setRenderTarget(oldTarget);
        color.uniforms.glow.value=grade.bloom;
        composer.render();
        renderer.getContext().finish();
      } finally {
        scenePass.enabled=true;
        renderer.setRenderTarget(oldTarget);
        renderer.setClearColor(oldClear,oldAlpha);
      }
      return { ms: Math.round(performance.now() - t), width, height };
    },
    dispose() { for (const pass of composer.passes) pass.dispose?.(); composer.dispose(); }
  };
}
