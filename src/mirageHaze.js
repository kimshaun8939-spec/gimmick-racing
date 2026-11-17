import {gfxEnabled} from './gfxConfig.js';
import {settings} from './settings.js';
// All deformation is visual. Geometry, ray targets and simulation stay unchanged.
export function buildMirageHaze(track,weather,scenery){
 const time={value:0},strength={value:1},motion={value:0};
 if(!gfxEnabled())return {enabled:false,animate(){}};
 const materials=new Set(),ground=new Set();track.group.traverse(o=>{if(o.isMesh&&!Array.isArray(o.material)&&(o.material?.isMeshStandardMaterial||o.material?.isMeshLambertMaterial)){materials.add(o.material);ground.add(o.material);}});
 scenery?.traverse(o=>{if(o.isMesh&&!Array.isArray(o.material)&&(o.material?.customProgramCacheKey?.().includes('gfx9Sandstone')||o.name?.startsWith('gfx9Mesa')))materials.add(o.material);});
 for(const m of materials){const old=m.onBeforeCompile,key=m.customProgramCacheKey;m.onBeforeCompile=function(s,r){old.call(this,s,r);Object.assign(s.uniforms,{mirageClock:time,mirageClear:strength,mirageMotion:motion});
 s.vertexShader='varying vec3 mirageWorld;uniform float mirageClock;uniform float mirageMotion;\n'+s.vertexShader;
 s.vertexShader=s.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
 vec4 mirageVertex=vec4(transformed,1.);
 #ifdef USE_INSTANCING
 mirageVertex=instanceMatrix*mirageVertex;
 #endif
 mirageWorld=(modelMatrix*mirageVertex).xyz;
 float hd=length(cameraPosition-mirageWorld);float hf=smoothstep(160.,600.,hd)*(1.-smoothstep(.08,.25,abs(normalize(mirageWorld-cameraPosition).y)));
 gl_Position.x+=sin(mirageWorld.y*1.4+mirageWorld.x*.06+mirageClock*.8)*.00032*gl_Position.w*hf*mirageMotion;`);
 s.fragmentShader='varying vec3 mirageWorld;uniform float mirageClock;uniform float mirageClear;\n'+s.fragmentShader;
 if(ground.has(m))s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>',`
 vec3 mv=normalize(cameraPosition-mirageWorld);float md=length(cameraPosition-mirageWorld);
 float grazing=1.-smoothstep(.035,.25,abs(mv.y));
 float flatGround=smoothstep(.83,.98,abs(inverseTransformDirection(normal,viewMatrix).y));
 float pools=.45+.55*smoothstep(-.25,.2,sin(mirageWorld.x*.027+sin(mirageWorld.z*.018)*2.1));
 float sheen=smoothstep(85.,165.,md)*(1.-smoothstep(580.,850.,md))*grazing*pools*mirageClear*flatGround;
 float flicker=.94+.06*sin(mirageWorld.z*.9+mirageClock*1.2);
 outgoingLight=mix(outgoingLight,vec3(.12,.34,.46),sheen*${m.metalness===.06?".95":".78"}*flicker);
 #include <opaque_fragment>`);};m.customProgramCacheKey=()=>key.call(m)+(ground.has(m)?'|mirage2Ground':'|mirage2Air');}
 return {enabled:true,state:{time,strength,motion},animate(t){time.value=t;strength.value=1-(weather.state.strength||0);motion.value=strength.value*(settings.get('shake')===0||matchMedia('(prefers-reduced-motion: reduce)').matches?0:.65);}};
}
