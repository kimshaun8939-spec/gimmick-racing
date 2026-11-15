// 장면의 장착 순간에만 철컥 소리를 낸다. 전체/효과음 설정을 그대로 따른다.
export function createPartSfx(){
 let ctx,nodes=[];
 function stop(){for(const n of nodes)try{n.stop();}catch{}nodes=[];}
 function clack(){
  let settings={};try{settings=JSON.parse(localStorage.getItem('gimmick.settings')||'{}');}catch{}
  if(settings.muted)return;const level=(settings.masterVol??1)*(settings.fxVol??1);if(!level)return;
  const vol=window.AudioContext?.__mixed?1:level;
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;ctx||=new AC();ctx.resume().catch(()=>{});
  const t=ctx.currentTime;for(const [delay,dur,a,b,gain]of [[0,.055,850,180,.045],[.055,.13,150,42,.09],[.12,.1,620,1000,.018]]){
   const osc=ctx.createOscillator(),g=ctx.createGain();osc.type='triangle';osc.frequency.setValueAtTime(a,t+delay);osc.frequency.exponentialRampToValueAtTime(b,t+delay+dur);g.gain.setValueAtTime(.0001,t+delay);g.gain.exponentialRampToValueAtTime(Math.max(.0001,gain*vol),t+delay+.008);g.gain.exponentialRampToValueAtTime(.0001,t+delay+dur);osc.connect(g).connect(ctx.destination);osc.start(t+delay);osc.stop(t+delay+dur+.02);osc.onended=()=>{osc.disconnect();g.disconnect();nodes=nodes.filter(n=>n!==osc);};nodes.push(osc);
  }
 }
 return {stop,clack,play:clack};
}
