import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { MAP_GRADES, NEUTRAL_GRADE } from './gfxConfig.js';
export { MAP_GRADES } from './gfxConfig.js';
export function createPostFx(renderer,scene,camera,quality,map='glacier'){
 const random=Math.random;let seed=92517;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 try{return build(renderer,scene,camera,quality,map);}finally{Math.random=random;}
}
function build(renderer,scene,camera,quality,map){
 const grade=MAP_GRADES[map]||NEUTRAL_GRADE;
 const composer=new EffectComposer(renderer,new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType}));composer.setPixelRatio(1);
 // r160 enables per-material tone mapping only on screen/XR targets.
 // Match screen encoding and transparent blending before the final grade.
 for(const target of [composer.renderTarget1,composer.renderTarget2]){target.isXRRenderTarget=true;target.texture.colorSpace=THREE.SRGBColorSpace;}
 const scenePass=new RenderPass(scene,camera);composer.addPass(scenePass);
 const uniforms=THREE.UniformsUtils.clone(FXAAShader.uniforms);
 Object.assign(uniforms,{pixel:{value:new THREE.Vector2()},glow:{value:grade.bloom},gfxContrast:{value:grade.contrast},saturation:{value:grade.saturation},vignette:{value:grade.vignette},cool:{value:new THREE.Vector3(...grade.cool)},warm:{value:new THREE.Vector3(...grade.warm)},toneMappingExposure:{value:renderer.toneMappingExposure}});
 const fused=new ShaderPass({uniforms,vertexShader:FXAAShader.vertexShader,
 fragmentShader:'#include <tonemapping_pars_fragment>\nuniform vec3 cool,warm;\n'+FXAAShader.fragmentShader.replace('void main()', 'void fxaaMain()')+" uniform vec2 pixel; uniform float glow,gfxContrast,saturation,vignette; \n      vec3 bright(vec2 o){return max(texture2D(tDiffuse,vUv+o*pixel).rgb-vec3(.94),vec3(0.));}\n      void main(){fxaaMain(); vec4 src=gl_FragColor; vec3 c=src.rgb;\n      vec3 halo=bright(vec2(3.,0.))+bright(vec2(-3.,0.))+bright(vec2(0.,3.))+bright(vec2(0.,-3.));\n      halo+=.5*(bright(vec2(5.,5.))+bright(vec2(-5.,5.))+bright(vec2(5.,-5.))+bright(vec2(-5.,-5.)));\n      c+=halo*(glow/6.);\n      float l=dot(c,vec3(.2126,.7152,.0722));\n      c=mix(vec3(l),c,saturation);\n      c*=mix(cool,warm,smoothstep(.15,1.3,l));\n      c=max(vec3(0.),(c-.5)*gfxContrast+.5);\n      vec2 p=(vUv-.5)*2.; c*=1.-vignette*smoothstep(.3,1.65,dot(p,p));\n      gl_FragColor=vec4(c,src.a); }"});
 fused.material.toneMapped=false;fused.needsSwap=false;composer.addPass(fused);
 let width=0,height=0;const size=new THREE.Vector2();
 function resize(){renderer.getDrawingBufferSize(size);if(size.x===width&&size.y===height)return;width=size.x;height=size.y;// Final pass writes straight to the screen: keep the unused ping-pong target tiny.
 composer.setSize(width,height);composer.writeBuffer.setSize(1,1);fused.uniforms.resolution.value.set(1/width,1/height);fused.uniforms.pixel.value.set(1/width,1/height);}
 function render(){resize();fused.uniforms.toneMappingExposure.value=renderer.toneMappingExposure;composer.render();}
 return {render,resize,composer,stats:()=>({width,height,passes:2,fullscreenPasses:1,bloom:true,targetMiB:+((width*height*12+12)/1048576).toFixed(2)}),
 warm(){const t=performance.now();resize();const target=renderer.getRenderTarget();scenePass.enabled=false;try{for(const b of [composer.readBuffer,composer.writeBuffer]){renderer.setRenderTarget(b);renderer.clear();}renderer.setRenderTarget(target);composer.render();renderer.getContext().finish();}finally{scenePass.enabled=true;renderer.setRenderTarget(target);}return{ms:Math.round(performance.now()-t),width,height};},
 dispose(){for(const p of composer.passes)p.dispose?.();composer.dispose();}};
}
