import * as T from 'three';
// One engine assembly, also used by stock workshop props. No stock game geometry is added.
export function enginePosition(style){
 const p={f1:[0,.70,-1.12,.72],proto:[0,.64,-1.55,.85],hyper:[0,.68,-1.55,.8],rocket:[0,.85,-1.15,.67],buggy:[0,.78,-1.63,.8],kart:[.22,.37,-.60,.38],gt:[0,.67,1.55,.7],rally:[0,.70,1.57,.65],muscle:[0,.66,1.95,.65],hatch:[0,.65,1.3,.6],roadster:[0,.63,1.35,.64],truck:[0,.82,1.5,.7],van:[0,.55,-2.05,.65],ev:[0,.65,-1.6,.75],wedge:[0,.62,-1.5,.75]};return p[style]||p.f1;
}
export function createPitEngine(n=0){
 const g=new T.Group(),steel=new T.MeshStandardMaterial({color:'#9caab8',metalness:.8,roughness:.29}),dark=new T.MeshStandardMaterial({color:'#20272e',metalness:.45,roughness:.5}),cover=new T.MeshStandardMaterial({color:n===1?'#9b333d':n===2?'#426c97':n===3?'#a87839':'#647078',metalness:.65,roughness:.3}),rubber=new T.MeshStandardMaterial({color:'#111419',roughness:.9});
 const add=(geo,m,x=0,y=0,z=0)=>{const o=new T.Mesh(geo,m);o.position.set(x,y,z);o.userData.photoGeometry=true;g.add(o);return o;};
 const box=(w,h,d,m,x,y,z)=>add(new T.BoxGeometry(w,h,d),m,x,y,z);
 const pipe=(a,b,r,m=steel)=>{const v=new T.Vector3(...a),w=new T.Vector3(...b),d=w.clone().sub(v);const o=add(new T.CylinderGeometry(r,r,d.length(),4),m,...v.add(w).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());return o;};
 box(n===2?.76:.59,.32,.82,dark,0,.12,0);box(.43,.12,.72,steel,0,-.10,0);
 for(const s of [-1,1]){
  const head=box(n===2?.30:.24,.20,.84,cover,s*.25,.33,0);head.rotation.z=-s*.32;
  for(let i=0;i<4;i++){const z=-.3+i*.2;box(.27,.018,.025,steel,s*.26,.44,z);
   const path=new T.CatmullRomCurve3([new T.Vector3(s*.32,.24,z),new T.Vector3(s*.48,.05,z-.04),new T.Vector3(s*.40,-.02,-.48)]);
   add(new T.TubeGeometry(path,2,n===2?.045:.035,4,false),steel);
   if(n===1||n===0){const x=s*(n===1?.15:.13),h=n===1?.22:.10;add(new T.CylinderGeometry(.054,.031,h,8,1,true),steel,x,.45+h/2,z);add(new T.CircleGeometry(.043,8).rotateX(-Math.PI/2),dark,x,.45+h-.012,z);}
  }
 }
 // Front belt drive, flywheel and two pulleys.
 for(const [x,y,r]of [[0,.12,.14],[.21,.36,.08],[-.21,.36,.08]])add(new T.CylinderGeometry(r,r,.05,10).rotateX(Math.PI/2),steel,x,y,.47);
 for(const s of [-1,1])pipe([0,.0,.505],[s*.24,.39,.505],.022,rubber);
 if(n===2){box(.65,.16,.46,steel,0,.55,0);for(let i=0;i<3;i++)add(new T.CylinderGeometry(.085,.085,.18,8).rotateX(Math.PI/2),dark,(i-1)*.18,.56,.31);}
 if(n===3){
  for(const s of [-1,1]){add(new T.TorusGeometry(.145,.065,4,10),steel,s*.49,.31,-.13);add(new T.CylinderGeometry(.095,.095,.10,8).rotateX(Math.PI/2),dark,s*.49,.31,-.08);pipe([s*.49,.31,.04],[s*.39,.49,.39],.065);pipe([s*.39,.49,.39],[s*.28,.15,.59],.065);}
  box(.69,.24,.12,steel,0,.15,.61);for(let i=0;i<7;i++)box(.61,.012,.018,dark,0,.06+i*.03,.678);
 }
 for(const s of [-1,1]){pipe([s*.4,-.02,-.48],[s*.25,.0,-.66],.055);add(new T.CylinderGeometry(.07,.06,.14,8,1,true).rotateX(Math.PI/2),steel,s*.25,0,-.70);}
 g.userData.dispose=()=>{g.traverse(o=>{if(o.isMesh)o.geometry.dispose();});for(const m of [steel,dark,cover,rubber])m.dispose();};return g;
}
