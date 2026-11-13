// night-meta · 피트 코인/업적/목표. 저장은 이 브라우저. 온라인 XP만 기존 profile.bonus로 합침.
import { profile, xpFor } from './profile.js';
import { academy, LESSONS, LICENSES } from './academyStore.js';
import { listCostumes } from './carCostumes.js';
import { PAINTS } from './unlocks.js';
import { ACHIEVEMENTS, CELEBRATIONS, GOAL_POOLS, costumePrice, paintPrice } from './metaCatalog.js';
const KEY='gimmick.meta';
const num = v => Number.isFinite(Number(v)) ? Math.max(0,Number(v)) : 0;
function fresh(){ return {v:1,coins:0,earned:0,spent:0,stats:{},maps:{},cars:{},achievements:{},owned:{},title:'',celebration:'stock',academyPaid:{},login:{day:'',streak:0,total:0},periods:{},history:[]}; }
function load(){ try { const j=JSON.parse(localStorage.getItem(KEY)||'null'); if(j?.v===1){const s={...fresh(),...j}; for(const k of ['stats','maps','cars','achievements','owned','academyPaid','periods']) if(!s[k]||typeof s[k]!=='object'||Array.isArray(s[k]))s[k]={}; s.coins=Math.floor(num(s.coins));s.earned=num(s.earned);s.spent=num(s.spent);s.login={day:'',streak:0,total:0,...s.login};s.history=Array.isArray(s.history)?s.history.slice(-30):[];return s;} }catch{} return fresh(); }
let state=load(),dirty=false,started=false,scanning=false,silent=false,calendarAt=0,calendarCache=null;
let run=null, notifyQueue=[],notifyBusy=false;
const emit=(name,detail)=>{try{window.dispatchEvent(new CustomEvent(name,{detail}));}catch{}};
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));dirty=false;return true;}catch{emit('gimmick:metaError',{message:'저장 공간이 부족해요. 이 창을 닫기 전에 브라우저 저장 공간을 확인해 주세요.'});return false;}}
export function ensureMetaStyle(){if(typeof document==='undefined'||document.querySelector('link[data-meta]'))return;const ln=document.createElement('link');ln.rel='stylesheet';ln.href=new URL('./meta.css',import.meta.url).href;ln.dataset.meta='1';document.head.appendChild(ln);}
function announce(d){if(silent||typeof document==='undefined'||window.game?.race?.phase==='finished'||window.game?.tutorial?.academy||document.getElementById('results')?.classList.contains('on'))return;notifyQueue.push(d);if(notifyQueue.length>8)notifyQueue.splice(1,notifyQueue.length-8);nextNotice();}
function nextNotice(){if(notifyBusy||!notifyQueue.length)return;notifyBusy=true;ensureMetaStyle();const d=notifyQueue.shift();const el=document.createElement('div');el.className='mt-notice';el.setAttribute('role','status');el.setAttribute('aria-live','polite');const badge=document.createElement('span');badge.className='mt-notice-medal';badge.textContent=d.icon||'✦';const txt=document.createElement('div');const small=document.createElement('small');small.textContent=d.kicker||'업적 달성';const b=document.createElement('b');b.textContent=d.name;const reward=document.createElement('em');reward.textContent='⬡ +'+d.coins+' 피트 코인'+(d.xp?' · +'+d.xp+' XP':'');txt.append(small,b,reward);el.append(badge,txt);document.body.append(el);setTimeout(()=>el.classList.add('out'),3600);setTimeout(()=>{el.remove();notifyBusy=false;nextNotice();},4100);}
function credit(amount,reason){amount=Math.floor(num(amount));if(!amount)return;state.coins+=amount;state.earned+=amount;state.history.push({at:Date.now(),amount,reason});state.history=state.history.slice(-30);if(run)run.coins+=amount;dirty=true;}
function bonusXP(amount){if(!amount)return;if(run)run.xp+=amount;profile.bonus(amount);}
const dayKey=(date=new Date())=>date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
function calendar(date=new Date()){
 const d=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);const serial=Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);const day=dayKey(d);d.setDate(d.getDate()-((d.getDay()+6)%7));return {daily:day,weekly:dayKey(d),serial};
}
function periods(){const now=Date.now();const c=now-calendarAt<1000&&calendarCache?calendarCache:(calendarAt=now,calendarCache=calendar());for(const type of ['daily','weekly'])if(state.periods[type]?.key!==c[type]){const pool=GOAL_POOLS[type],seed=type==='daily'?c.serial:Math.floor(Date.parse(c.weekly+'T12:00:00Z')/86400000/7);const ids=type==='daily'?[seed%pool.length,(seed+3)%pool.length,(seed+5)%pool.length]:[0,1,2+seed%4];state.periods[type]={key:c[type],goals:ids.map((id,i)=>({...pool[id],id:type+'-'+id,progress:0,claimed:false,coins:type==='daily'?[75,100,125][i]:[300,450,600][i],xp:type==='daily'?35:120}))};dirty=true;}return c;}
function checkGoals(){for(const type of ['daily','weekly'])for(const g of state.periods[type].goals){if(!g.claimed&&g.progress>=g.goal){g.claimed=true;credit(g.coins,g.name);bonusXP(g.xp);const d={...g,kicker:type==='daily'?'일일 목표 완료':'주간 목표 완료'};if(run)run.goals.push(d);announce(d);}}}
function inc(metric,delta){delta=num(delta);if(!delta)return;periods();state.stats[metric]=num(state.stats[metric])+delta;for(const type of ['daily','weekly'])for(const g of state.periods[type].goals)if(g.metric===metric)g.progress=Math.min(g.goal,num(g.progress)+delta);dirty=true;}
function metricValue(a){if(a.metric.startsWith('map:'))return num(state.maps[a.metric.slice(4)]);return num(state.stats[a.metric]);}
function scan(){if(scanning)return;scanning=true;try{periods();for(const a of ACHIEVEMENTS){if(state.achievements[a.id]||metricValue(a)<a.goal)continue;state.achievements[a.id]={at:Date.now(),coins:a.coins,xp:a.xp};if(a.costume)state.owned['costume:'+a.costume]={at:Date.now(),source:'achievement'};credit(a.coins,'업적 · '+a.name);bonusXP(a.xp);if(run)run.achievements.push(a.id);announce({...a,icon:['','🥉','🥈','🥇'][a.tier]});}checkGoals();if(dirty)save();emit('gimmick:meta');}finally{scanning=false;}}
function reconcileAcademy(){const all=academy.all();let done=0,gold=0;for(const l of LESSONS){const medal=num(all.lessons[l.id]?.medal);const tries=num(all.lessons[l.id]?.tries),tryKey='tries:'+l.id;if(!silent&&tries>num(state.academyPaid[tryKey])&&medal>0)inc('academySessions',1);state.academyPaid[tryKey]=tries;if(medal>0)done++;if(medal===3)gold++;const old=num(state.academyPaid[l.id]);if(medal>old){const amounts=[0,50,90,150];credit(amounts[medal]-amounts[old],'아카데미 · '+l.name);state.academyPaid[l.id]=medal;inc('academyMedals',medal-old);inc('lessons',old?0:1);inc('goldLessons',medal===3?1:0);}}
 // 예전에 딴 메달은 최초 연결 때 한 번만 인정. 진행은 저장된 최고 성적 기준.
 state.stats.lessons=Math.max(num(state.stats.lessons),done);state.stats.goldLessons=Math.max(num(state.stats.goldLessons),gold);
 for(const l of LICENSES)if(all.licenses[l.id]&&!state.academyPaid['license:'+l.id]){state.academyPaid['license:'+l.id]=1;credit({C:100,B:180,A:260,S:400}[l.id],'라이선스 '+l.id);}
 if(all.licenses.S)state.stats.licenseS=1;scan();}
export function bootMeta(){if(started)return;started=true;ensureMetaStyle();periods();if(!state.welcome){state.welcome=true;credit(120,'피트에 온 걸 환영해요');}
 const today=calendar(),login=state.login;if(login.day!==today.daily){const prev=login.day?Math.floor(Date.parse(login.day+'T12:00:00Z')/86400000):0;login.streak=today.serial-prev===1?num(login.streak)+1:1;login.day=today.daily;login.total=num(login.total)+1;login.reward=40+10*Math.min(7,login.streak);credit(login.reward,'오늘의 피트 체크인');state.stats.loginDays=login.total;}
 // 초기 로딩에서는 작은 완료 알림을 몰아서 띄우지 않음. 보상·업적 자체는 지급.
 silent=true;reconcileAcademy();silent=false;save();
 window.addEventListener('gimmick:resultsOpen',()=>{notifyQueue=[];document.querySelectorAll('.mt-notice').forEach(el=>el.remove());});
 window.addEventListener('gimmick:academy',reconcileAcademy);window.addEventListener('pagehide',()=>dirty&&save());document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty)save();});window.addEventListener('storage',e=>{if(e.key===KEY){state=load();dirty=false;emit('gimmick:meta');}});
}
export const meta={
 get(){bootMeta();periods();return structuredClone(state);},
 achievements(){bootMeta();return ACHIEVEMENTS.map(a=>({...a,value:metricValue(a),done:!!state.achievements[a.id],at:state.achievements[a.id]?.at||null}));},
 owns(key){return key==='celebration:stock'||!!state.owned[key];},
 title(){const a=ACHIEVEMENTS.find(a=>a.id===state.title&&state.achievements[a.id]);return a?.title||'';},
 setTitle(id){if(id&&!ACHIEVEMENTS.some(a=>a.id===id&&a.title&&state.achievements[id]))return false;state.title=id;save();emit('gimmick:meta');return true;},
 celebration(){return CELEBRATIONS.find(c=>c.id===state.celebration)||CELEBRATIONS[0];},
 equipCelebration(id){if(!CELEBRATIONS.some(c=>c.id===id)||!this.owns('celebration:'+id))return false;state.celebration=id;save();emit('gimmick:meta');return true;},
 buy(kind,item){bootMeta();let key,price;if(kind==='costume'){const c=listCostumes(item.carId).find(c=>c.id===item.id);if(!c)return {ok:false,message:'이 코스튬을 찾지 못했어요'};if(profile.get().level<c.unlockLevel)return {ok:false,message:'Lv.'+c.unlockLevel+'부터 구매할 수 있어요. 잠긴 모습도 미리 볼 수 있어요.'};key='costume:'+c.id;price=costumePrice(c);}else if(kind==='paint'){item=PAINTS.find(p=>p.id===item?.id);if(!item||item.license||!Number.isInteger(item.id)||item.id<3||item.id>10)return {ok:false,message:'이 색은 레벨 또는 아카데미로 열려요.'};key='paint:'+item.id;price=paintPrice(item);}else if(kind==='celebration'){const c=CELEBRATIONS.find(c=>c.id===item.id);if(!c)return {ok:false,message:'상품을 찾지 못했어요'};key='celebration:'+c.id;price=c.price;}else return {ok:false,message:'상품을 찾지 못했어요'};
 if(this.owns(key))return {ok:true,owned:true,price:0};if(state.coins<price)return {ok:false,message:'⬡ '+(price-state.coins).toLocaleString()+' 피트 코인이 더 필요해요. 레이스·목표·아카데미에서 모아 보세요.'};
 const before=structuredClone(state);state.coins-=price;state.spent+=price;state.owned[key]={at:Date.now(),price};state.history.push({at:Date.now(),amount:-price,reason:item.name||key});inc('purchases',1);if(!save()){state=before;return {ok:false,message:'저장하지 못했어요. 구매는 취소했어요.'};}scan();emit('gimmick:meta');return {ok:true,price};
 },
 flush:save,
};

/** 플레이어 한 대만 집계. main의 실제 물리 스텝에서 호출. 봇·시범·리플레이·테스트 운전은 caller와 여기서 모두 제외. */
export function createMetaTracker(o){bootMeta();let sinceScan=0,lastMode=null,hadBad=false,wasLast=false,modes=new Set(),elapsed=0,lastTime=0;
 function reset(){run={coins:0,xp:0,achievements:[],goals:[],before:structuredClone(state.stats),id:crypto.randomUUID(),completed:false,beforeLevel:profile.get().level};sinceScan=0;lastMode=null;hadBad=false;wasLast=false;modes=new Set();elapsed=0;lastTime=0;}
 function allowed(){const g=window.game;return !o.excluded()&&!(g&&(g.paused||g.controlsOverride||g.tutorial||g.replay?.active||g.academy?.demo));}
 function sample(dt,c,place,total){if(!allowed()||o.phase()!=='racing'||!run||run.completed)return;dt=Math.max(0,Math.min(.05,dt));elapsed+=dt;if(c.events?.some(e=>['bump','respawn','lava','fall','sink'].includes(e)))hadBad=true;const speed=Math.abs(Number(c.speed)||0),distance=speed*dt;inc('distance',distance);state.stats.maxSpeed=Math.max(num(state.stats.maxSpeed),speed*3.6);if(c.drifting&&c.grounded)inc('driftDistance',distance);if(c.mode==='boat')inc('boatDistance',distance);if(c.flying)inc('flyDistance',distance);if(!c.grounded&&!c.flying&&c.mode!=='boat')inc('jumpSeconds',dt);if(c.drs>.5)inc('drsSeconds',dt);if(c.draft>.15)inc('draftSeconds',dt);const form=c.flying?'fly':c.mode==='boat'?'boat':'land';if(distance>.01)modes.add(form);if(lastMode!==null&&lastMode!==c.mode)inc('transforms',1);lastMode=c.mode;if(total>2&&place===total&&elapsed>8)wasLast=true;sinceScan+=dt;if(sinceScan>=2){sinceScan=0;scan();}}
 function event(e,c){if(!allowed()||o.phase()!=='racing'||!run||run.completed)return;if(['bump','respawn','lava','fall','sink'].includes(e))hadBad=true;if(e==='perfectLaunch')inc('perfectLaunch',1);if(e==='apex'||e==='apexPerfect')inc('apex',1);if(e==='driftExit'&&(c.lastDriftInfo?.quality||0)>.8)inc('perfectDrifts',1);}
 function finish(d){if(!allowed()||!run||run.completed||elapsed<10||!(d.time>10))return;run.completed=true;run.raceXp=xpFor(d);inc('races',1);state.maps[d.map]=num(state.maps[d.map])+1;state.cars[d.car]=num(state.cars[d.car])+1;state.stats.uniqueMaps=Object.keys(state.maps).length;state.stats.uniqueCars=Object.keys(state.cars).length;
 if(d.total>1&&d.place>0&&d.place<=3){inc('podiums',1);if(wasLast)inc('comebacks',1);}if(d.total>1&&d.place===1){inc('wins',1);if(['hard','master'].includes(o.level()))inc('hardWins',1);}if(!hadBad)inc('cleanRaces',1);if(modes.size===3)inc('threeForms',1);const hour=new Date().getHours();if(hour>=22||hour<5)inc('nightFinishes',1);
 const base=100+Math.min(100,Math.floor(d.time/30)*10),place=d.total>1?(d.place===1?80:d.place<=3?40:20):20;credit(base+place,'완주 · '+d.map);run.base=base;run.place=place;scan();save();emit('gimmick:metaFinish',summary());}
 function summary(){if(!run?.completed)return null;const progress=ACHIEVEMENTS.filter(a=>!state.achievements[a.id]&&metricValue(a)>num(run.before[a.metric])&& !a.metric.startsWith('map:')).map(a=>({...a,value:metricValue(a),delta:metricValue(a)-num(run.before[a.metric])})).sort((a,b)=>b.value/b.goal-a.value/a.goal).filter((a,i,arr)=>arr.findIndex(b=>b.family===a.family)===i).slice(0,3);return {...run,profile:profile.get(),progress,celebration:meta.celebration(),title:meta.title(),balance:state.coins};}
 window.addEventListener('gimmick:raceDone',e=>finish(e.detail||{}));reset();return {reset,sample,event,summary};
}
