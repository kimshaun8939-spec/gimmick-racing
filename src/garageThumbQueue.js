// 차고가 기본 차/코스튬/색 사진을 동시에 요청해도 공용 3D 스튜디오는 한 번에 하나만 씀.
// carThumbs의 공개 API만 사용 (원본 모델/촬영 코드는 변경하지 않음).
import { loadCarThumbs as renderThumbs } from './carThumbs.js';
export { thumbUrl } from './carThumbs.js';
let tail=Promise.resolve();
const channels=new Map();
export function loadCarThumbs(cars,opts={}){
 let job=null,cancelled=false,first=opts.first;
 const cancel=()=>{cancelled=true;job?.cancel();};
 if(opts.channel){channels.get(opts.channel)?.cancel();channels.set(opts.channel,{cancel});}
 const captured=cars.map(c=>({...c,look:c.look&&typeof c.look==='object'?{...c.look}:c.look}));
 const done=tail.then(async()=>{if(cancelled)return {rendered:0,cached:0,ms:0,cancelled:true};job=renderThumbs(captured,{...opts,first});return job.done;});
 tail=done.catch(e=>console.warn('차 사진 준비',e));
 return {done,cancel,prioritize(id){first=id;job?.prioritize(id);}};
}
