import * as THREE from 'three';
export function spruceNeedles(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
 const ctx=canvas.getContext('2d');ctx.strokeStyle='#fff';ctx.lineWidth=2.4;
 // A dense branch fan with broken needle tips, reused by every near tree.
 for(let k=0;k<19;k++){
  const a=-1.18+k*.131,length=75+16*Math.sin(k*3.7),ex=64+Math.sin(a)*length,ey=120-Math.cos(a)*length;
  ctx.beginPath();ctx.moveTo(64,126);ctx.lineTo(ex,ey);ctx.stroke();
  for(let j=3;j<13;j++){
   const t=j/14,x=64+(ex-64)*t,y=126+(ey-126)*t;
   for(const side of [-1,1]){const n=a+side*.8,ln=8+7*(1-t);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.sin(n)*ln,y-Math.cos(n)*ln);ctx.stroke();}
  }
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
// Branch whorls: individual drooping lobes, exposed trunk, snow on upward fans.
export function spruceGeometry(variant=0,far=false){
 const p=[],c=[];const green=new THREE.Color(['#24463d','#29483d','#203f39','#345047'][variant]),snow=new THREE.Color('#dce8ef'),wood=new THREE.Color('#624d3c');
 const tri=(a,b,d,col)=>{p.push(...a,...b,...d);for(let i=0;i<3;i++)c.push(col.r,col.g,col.b);};
 if(far){
  // Crossed stepped silhouettes, 16 triangles; no thousands of branch fans at distance.
  for(let plane=0;plane<2;plane++)for(let l=0;l<3;l++){
   const a=plane*Math.PI/2+variant*.19,y=.17+l*.235,r=.39*(1-l*.25);
   const v=(x,h)=>[Math.cos(a)*x,h,Math.sin(a)*x];
   tri(v(-r,y),v(r,y),v(.018,y+.36),green);
   tri(v(-r*.83,y+.055),v(r*.83,y+.055),v(.018,y+.36),snow);
  }
  for(let plane=0;plane<2;plane++){
   const a=plane*Math.PI/2,v=(x,h)=>[Math.cos(a)*x,h,Math.sin(a)*x];
   tri(v(-.022,0),v(.022,0),v(.022,.75),wood);tri(v(-.022,0),v(.022,.75),v(-.022,.75),wood);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.computeVertexNormals();return g;
 }
 const tiers=far?5:7,arms=far?5:6;
 for(let l=0;l<tiers;l++){
  const y=.16+l*(.78/tiers),r=.41*(1-l/tiers)*(.92+.08*Math.sin(l*2.3+variant));
  for(let a=0;a<arms;a++){
   const ang=a*Math.PI*2/arms+l*2.399+variant,spread=far?.85:.83;
   const len=r*(.8+.2*Math.sin(a*4.1+l+variant));
   const point=(theta,rad,h)=>[Math.cos(theta)*rad+variant*.005*y,h,Math.sin(theta)*rad];
   const root=point(ang,.018,y+.065),left=point(ang-spread,len*.86,y+.015),tip=point(ang,len,y-.03),right=point(ang+spread,len*.86,y+.015);
   tri(root,tip,left,snow);tri(root,right,tip,snow);
   const under=point(ang,.02,y-.095);tri(under,left,tip,green);tri(under,tip,right,green);
  }
 }
 for(let i=0;i<5;i++){const a=i*6.283/5,b=(i+1)*6.283/5;const v=(t,y)=>[Math.cos(t)*.022,y,Math.sin(t)*.022];tri(v(a,0),v(b,0),v(a,.79),wood);tri(v(b,0),v(b,.79),v(a,.79),wood);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
 const uv=[];for(let i=0;i<p.length/9;i++)uv.push(...(i<p.length/9-10?[.5,0,.05,.92,.95,.92]:[.5,.02,.5,.02,.5,.02]));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
