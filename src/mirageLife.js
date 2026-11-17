import * as THREE from 'three';
// Render-only instanced wildlife. No simulation state or random source is touched.
export function buildMirageLife(track,parent){
 const root=new THREE.Group();root.name='mirage2Life';root.userData.dynamic=true;parent.add(root);
 const d=new THREE.Object3D(),anchors=[],look=new THREE.Vector3(),delta=new THREE.Vector3();let activeCamera;const lastView=new THREE.Vector3(Infinity,0,0);
 function inst(g,m,n,name){const o=new THREE.InstancedMesh(g,m,n);o.name=name;o.userData.dynamic=true;o.userData.active=new Uint8Array(n);root.add(o);return o;}
 // Broad soaring wings, splayed primaries, a small head and a fanned tail.
 const outline=[[-3,0],[-2.6,.1],[-2.9,.3],[-2.4,.25],[-2.65,.5],[-2.15,.4],[-1.8,.65],[-.6,.5],[-.24,.25],[-.18,1],[-.08,1.25],[.08,1.25],[.18,1],[.24,.25],[.6,.5],[1.8,.65],[2.15,.4],[2.65,.5],[2.4,.25],[2.9,.3],[2.6,.1],[3,0],[1.8,-.25],[.45,-.15],[.18,-.45],[.4,-.95],[-.4,-.95],[-.18,-.45],[-.45,-.15],[-1.8,-.25]];
 const shape=new THREE.Shape(outline.map(([x,z])=>new THREE.Vector2(x,z))),bg=new THREE.ShapeGeometry(shape);bg.rotateX(-Math.PI/2);const birds=inst(bg,new THREE.MeshBasicMaterial({color:'#493d35',side:THREE.DoubleSide}),8,'mirage2Vultures');
 const points=[];
 // Dry branching stems, irregular and open, rather than intersecting wire hoops.
 for(let j=0;j<44;j++){const a=j*2.39996,b=j*.91;const start=new THREE.Vector3(Math.sin(a)*.15,Math.cos(b)*.2,Math.cos(a)*.15),end=new THREE.Vector3(Math.sin(a)*(.7+(j%7)*.06),Math.cos(b)*.95,Math.cos(a)*(.75+(j%5)*.06));const mid=start.clone().lerp(end,.65).add(new THREE.Vector3(Math.sin(j*7)*.17,Math.cos(j*3)*.17,0));for(const [v,w]of [[start,mid],[mid,end],[mid,mid.clone().add(new THREE.Vector3(Math.cos(a+1)*.4,Math.sin(b+1)*.4,Math.sin(a+1)*.4))]]){const dir=w.clone().sub(v),g=new THREE.CylinderGeometry(.012,.025,dir.length(),3).toNonIndexed();g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize()));g.translate(...v.clone().add(w).multiplyScalar(.5).toArray());points.push(...g.attributes.position.array);g.dispose();}}
 const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(points,3));wg.computeVertexNormals();const weeds=inst(wg,new THREE.MeshLambertMaterial({color:'#806f49'}),18,'mirage2Tumbleweed');
 const dm=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{clock:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;uniform float clock;void main(){float width=.05+.22*vUv.y;float x=vUv.x-.5+.08*sin(vUv.y*11.-clock);float a=exp(-x*x/(width*width))*sin(vUv.y*3.14159);a*=.55+.45*sin(vUv.y*45.+clock*2.+vUv.x*12.);gl_FragColor=vec4(.65,.46,.27,a*.26);}'});
 const dust=inst(new THREE.PlaneGeometry(14,28),dm,10,'mirage2DustDevils');
 const ribbons=inst(new THREE.PlaneGeometry(26,2),dm,8,'mirage2DuneStreamers');
 for(let i=0;i<18;i++)anchors.push(track.sampleAt((i+.5)/18));let last=-10;
 function put(o,i,p,s,ry=0,rz=0){if(activeCamera){delta.copy(p).sub(activeCamera.position);const hidden=delta.lengthSq()>650*650||delta.dot(look)<-50;if(hidden){if(o.userData.active[i]===2)return;d.scale.setScalar(0);d.updateMatrix();o.setMatrixAt(i,d.matrix);o.userData.active[i]=2;return;}}o.userData.active[i]=1;d.position.copy(p);d.scale.set(...s);d.rotation.set(0,ry,rz);d.updateMatrix();o.setMatrixAt(i,d.matrix);}
 return {animate(t,camera){if(t>=last&&t-last<.1&&camera&&lastView.distanceToSquared(camera.position)<4)return;last=t;if(camera)lastView.copy(camera.position);activeCamera=camera;if(camera)camera.getWorldDirection(look);dm.uniforms.clock.value=t;
 for(let i=0;i<8;i++){let a=t*.05+i*2.4,p=anchors[i*2].pos.clone().add(new THREE.Vector3(Math.cos(a)*45,65+Math.sin(a*.7)*8,Math.sin(a)*45));put(birds,i,p,[1,1,1],-a,Math.sin(t*.7+i)*.12);}
 for(let i=0;i<18;i++){const s=anchors[i],p=track.surf(s,((t*2.3+i*7.13)%100)-50);p.y=track.heightAt(p.x,p.z)+1.2;put(weeds,i,p,[1,1,1],t*.6,t*1.9+i);}
 for(let i=0;i<10;i++){const s=anchors[i],p=track.surf(s,(i%2?1:-1)*(s.hw+70));p.x+=Math.sin(t*.08+i)*8;p.y=track.heightAt(p.x,p.z)+13;put(dust,i,p,[.6+i%3*.3,1,1],camera?Math.atan2(camera.position.x-p.x,camera.position.z-p.z):0);}
 for(let i=0;i<8;i++){const s=anchors[i*2],p=track.surf(s,(i%2?1:-1)*(s.hw+100));p.y=track.heightAt(p.x,p.z)+1.2;put(ribbons,i,p,[1,1,1],camera?Math.atan2(camera.position.x-p.x,camera.position.z-p.z):0,Math.sin(t*.2+i)*.07);}
 for(const o of [birds,weeds,dust,ribbons]){o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();}
 }};
}
