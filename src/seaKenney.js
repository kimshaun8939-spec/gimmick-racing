import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gfxEnabled } from './gfxConfig.js';
// All assets finish before scenery creation and the existing shader prewarm.
export const kenneySeaEnabled = gfxEnabled('sea') && new URLSearchParams(location.search).get('kenneysea') !== '0';
const models = new Map();
const catalog = {
 houses:['city-kit-suburban/building-type-a','city-kit-suburban/building-type-c','city-kit-suburban/building-type-f','city-kit-suburban/building-type-h','city-kit-commercial/building-a','city-kit-commercial/building-d'],
 sail:['watercraft-kit/boat-sail-a'],fish:['watercraft-kit/boat-fishing-small'],speed:['watercraft-kit/boat-speed-a'],tug:['watercraft-kit/boat-tug-a'],buoy:['watercraft-kit/buoy'],palm:['nature-kit/tree_palmDetailedTall'],bush:['nature-kit/plant_bushLarge'],lamp:['city-kit-roads/light-curved'],sign:['city-kit-roads/road-sign-street']
};
// Kenney palette textures use flat UV islands: bake their original colours once.
// A single vertex-colour material then works with InstancedMesh/staticBatch.
async function loadModel(loader,id) {
 const gltf=await loader.loadAsync(new URL('./art/models/kenney/'+id+'.glb',import.meta.url).href), parts=[];
 gltf.scene.updateMatrixWorld(true);
 gltf.scene.traverse(o=>{
  if(!o.isMesh)return;
  const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);
  const mat=o.material, uv=g.attributes.uv, image=mat.map?.image;
  let pixels,w,h;
  if(image){w=image.width;h=image.height;const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);pixels=ctx.getImageData(0,0,w,h).data;}
  const a=new Float32Array(g.attributes.position.count*3),color=new THREE.Color();
  for(let i=0;i<a.length/3;i++){
   color.copy(mat.color);
   if(pixels&&uv){const x=Math.min(w-1,Math.max(0,Math.floor(uv.getX(i)*w))),y=Math.min(h-1,Math.max(0,Math.floor((mat.map.flipY?1-uv.getY(i):uv.getY(i))*h))),k=(y*w+x)*4;color.multiply(new THREE.Color().setRGB(pixels[k]/255,pixels[k+1]/255,pixels[k+2]/255,THREE.SRGBColorSpace));}
   a.set([color.r,color.g,color.b],i*3);
  }
  for(const n of Object.keys(g.attributes))if(n!=='position'&&n!=='normal')g.deleteAttribute(n);
  g.setAttribute('color',new THREE.BufferAttribute(a,3));parts.push(g);
 });
 const geo=mergeGeometries(parts);parts.forEach(g=>g.dispose());geo.computeBoundingBox();const b=geo.boundingBox,size=b.getSize(new THREE.Vector3());geo.translate(-(b.min.x+b.max.x)/2,-b.min.y,-(b.min.z+b.max.z)/2);geo.scale(1/size.x,1/size.y,1/size.z);geo.userData.nativeSize=size.toArray();models.set(id,geo);
 gltf.scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});
}
export async function prepareSeaKenney(){
 if(!kenneySeaEnabled)return;
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');const loader=new GLTFLoader();
 await Promise.all(Object.values(catalog).flat().map(id=>loadModel(loader,id)));
}
export function seaKenneyGeometry(kind,width,height,depth,variant=0,waterline=0){
 if(!kenneySeaEnabled)return null;
 const ids=catalog[kind],g=models.get(ids[variant%ids.length])?.clone();if(!g)throw new Error('Kenney model not prepared: '+kind);
 if(kind==='lamp') {const n=g.userData.nativeSize;g.scale(n[0]/n[1]*height,height,n[2]/n[1]*height);}else g.scale(width,height,depth);
 if(kind==='houses'){const a=g.attributes.color;const roofs=['#b75d3a','#be7350','#667e84','#bf8b62','#ae6043','#577c79'],c=new THREE.Color(roofs[variant%6]);for(let i=0;i<a.count;i++){const r=a.getX(i),green=a.getY(i),b=a.getZ(i);if(g.attributes.position.getY(i)>height*.54&&green>r*1.3&&green>b*1.1)a.setXYZ(i,c.r,c.g,c.b);}}
 g.translate(0,waterline,0);return g;
}
export const seaKenneyMaterial=new THREE.MeshLambertMaterial({vertexColors:true});
export function seaKenneyObject(kind,w,h,d){const geo=seaKenneyGeometry(kind,w,h,d);return geo?new THREE.Mesh(geo,seaKenneyMaterial):null;}
