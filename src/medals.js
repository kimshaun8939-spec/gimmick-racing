// 기준 = 순정 f1, 혼자 달린 어려움 운전사의 완주 실측(보고서 참고).
export const MEDAL_BASE = {"starter":85,"gp":190,"sea":140,"neon":140,"moon":155,"jungle":145,"volcano":165,"glacier":160,"foundry":200,"mirage":190}; // mirage: 관제탑이 같은 방법(f1·어려움 봇·시드 99·타임 어택)으로 185.633초 측정 → 190
export const CLASS_FACTOR = {A:1,B:1.06,C:1.24};
export const MEDAL_REWARDS = [{pit:25,up:5},{pit:40,up:10,custom:5},{pit:60,up:15,custom:15}];
export const MEDAL_NAMES=['동','은','금'];
export function medalTargets(map,cls='A') {const b=MEDAL_BASE[map];return b?[1.35,1.16,1.02].map(f=>Math.ceil(b*f*(CLASS_FACTOR[cls]||1))):[];}
export function medalTier(map,time,cls='A'){return medalTargets(map,cls).reduce((tier,t,i)=>time>0&&time<=t?i+1:tier,0);}
export function medalTime(sec){return Math.floor(sec/60)+':'+(sec%60).toFixed(1).padStart(4,'0');}
export function medalIcon(tier=0){const color=['#657084','#cd9565','#d4e2ee','#ffcf59'][tier];return '<svg width="22" height="25" viewBox="0 0 24 28" aria-hidden="true"><path d="M5 1h5l4 11H9zM14 1h5l-4 11h-5z" fill="#f58c44"/><circle cx="12" cy="18" r="8" fill="'+color+'" stroke="#ffffff66"/><path d="m12 12 1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="#172333"/></svg>';}
export function medalHtml(map,claimed=0,cls='A'){const times=medalTargets(map,cls);if(!times.length)return '';return '<span class="mission-medal">'+medalIcon(claimed)+'<span>'+(claimed?MEDAL_NAMES[claimed-1]+'메달':'기록 메달')+' · '+(claimed<3?'다음 '+MEDAL_NAMES[claimed]+' '+medalTime(times[claimed]):'모두 달성')+'</span></span>';}

