import { gfxEnabled } from './gfxConfig.js';
import { visualGround, mineralScenery, distantRanges, mineralSurface } from './gfxMoon.js';
export function volcanoVisuals(track,scenery,scene){
 if(!gfxEnabled('volcano'))return;
 visualGround(track,true);const root=scene.getObjectByName('volcanoScenery');
 const seen=new Set();track.group.traverse(o=>{if(['volcanoRockWall','volcanoCliff','volcanoPoolLip'].includes(o.name)&&!seen.has(o.material)){seen.add(o.material);mineralSurface(o.material,'basalt');}});
 const horizon=root.getObjectByName('volcanoHorizon');
 if(horizon){const geo=horizon.geometry.clone(),p=geo.attributes.position,columns=p.count/5-1;
  for(let pass=0;pass<4;pass++){const ys=Array.from({length:p.count},(_,i)=>p.getY(i));for(let k=0;k<=columns;k++)for(let row=1;row<5;row++){const prev=((k-1+columns)%columns)*5+row,next=((k+1)%columns)*5+row,i=k*5+row;p.setY(i,(ys[prev]+ys[i]*2+ys[next])/4);}}
  geo.computeVertexNormals();horizon.geometry=geo;
 }
 mineralScenery(root,true);distantRanges(track,root,true);
 // Existing cliff gradients, haze/glow shaders, lava and hazard lights are untouched.
}
