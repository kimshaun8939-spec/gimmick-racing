// 실제 시계 기준. 백그라운드·장시간 정지 구간은 소급해 더하지 않아요.
export function activeSeconds({dt, visible, lastInput, now, racing}) {
  if (!visible || dt <= 0 || dt > 5) return 0;
  return racing ? dt : Math.max(0, Math.min(dt, (lastInput + 60000 - (now - dt * 1000)) / 1000));
}
export function startPlaytime(add) {
  let last=Date.now(), input=0;
  const touch=()=>{input=Date.now();};
  for(const name of ['keydown','pointerdown','pointermove','wheel','touchstart']) window.addEventListener(name,touch,{passive:true});
  const poll=()=>{
    const now=Date.now(), dt=(now-last)/1000;last=now;
    try {const pads=Array.from(navigator.getGamepads?.()||[]).filter(Boolean);if(pads.some(p=>p.axes.some(a=>Math.abs(a)>.15)||p.buttons.some(b=>b.pressed)))touch();}catch{}
    const g=window.game, excluded=g&&(g.paused||g.controlsOverride||g.tutorial||g.replay?.active||g.academy?.demo);
    const racing=!excluded&&!g?.menu?.isOpen&&!g?.intro?.on&&g?.race?.phase==='racing'&&Math.abs(g.car?.speed||0)>.1;
    const sec=activeSeconds({dt,visible:!document.hidden&&!excluded,lastInput:input,now,racing});
    add(sec,now-dt*1000,now);
    setTimeout(poll,1000);
  };
  document.addEventListener('visibilitychange',()=>{last=Date.now();});
  setTimeout(poll,1000);
}
