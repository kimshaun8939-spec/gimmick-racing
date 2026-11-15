// night-meta · 업적/목표/상점. 저장은 이 브라우저. 온라인 XP만 기존 profile.bonus로 합침.
// 재화 개편 (upgradeB, 2026-11-15, 설계 .debug/design/upgrade-design.md 3장, API .debug/agents/wallet-contract.md):
//   예전 피트 코인 → 피트 조각 ⬡(차·부품) · 강화 조각 ◆(부품 강화) · 커스텀 조각 ✿(색·코스튬·세리머니), 세 조각 모두 0부터.
//   지급표·가격은 metaCatalog.js ECON·CAR_SHOP·가격 함수. 예전 저장(wv 없음)은 불러올 때 한 번 옮김 (산 물건·열린 차·받은 업적 그대로).
//   화면 호환: get().coins/earned/spent = 피트 조각, summary().coins/base/place/balance = 피트 조각, a.coins/g.coins = 피트 조각
import { profile, xpFor, levelStartXp } from './profile.js';
import { academy, LESSONS, LICENSES } from './academyStore.js';
import { listCostumes } from './carCostumes.js';
import { PAINTS, getPaint, setPaint, isPaintUnlocked, getCostume, setCostume, isCarOwned as carOwned, carPrice as carPriceOf, carUnlockLevel, carLegacyOpen, isLegacySave, carUnlockList, carInfo } from './unlocks.js';
import { partOf, partState, listParts, getBuild, setPart } from './parts.js'; // 부품 조립 1차 (2026-11-15): 부품 구매·상점 목록
import { ACHIEVEMENTS, RETIRED_ACHIEVEMENTS, CELEBRATIONS, GOAL_POOLS, SHOP_KINDS, SHOP_CURRENCY, CURRENCIES, CURRENCY_IDS, currencyId, ECON, CAR_SHOP, START_CARS, costumePrice, paintPrice, partPrice } from './metaCatalog.js';
export { CURRENCIES } from './metaCatalog.js';
const KEY='gimmick.meta', TUT_KEY='gimmick.tutorial', WALLET_V=2;
const num = v => Number.isFinite(Number(v)) ? Math.max(0,Number(v)) : 0;
const W0 = () => ({pit:0,up:0,custom:0});
const curLevel = () => { try { return profile.get().level || 1; } catch { return 1; } };
const tutorialDone = () => { try { return localStorage.getItem(TUT_KEY) === 'done'; } catch { return false; } };
const goalReward = (type,i) => ({...(type==='daily'?ECON.daily:ECON.weekly)[Math.max(0,Math.min(2,i))]});
// v는 1 그대로 (업데이트 전에 열어 둔 탭의 예전 meta.js가 v≠1이면 빈 저장으로 덮어써서), 지갑 버전은 wv
function fresh(){ return {v:1,wv:WALLET_V,wallet:W0(),earnedBy:W0(),spentBy:W0(),coins:0,earned:0,spent:0,stats:{},maps:{},cars:{},achievements:{},owned:{},title:'',celebration:'stock',academyPaid:{},login:{day:'',streak:0,total:0},periods:{},history:[],levelPaid:curLevel(),tutorialPaid:false,exchanged:{pit:0,up:0,custom:0,count:0}}; }
/** 지갑 → 예전 이름(coins·earned·spent = 피트 조각) */
function mirror(s=state){s.coins=s.wallet.pit;s.earned=s.earnedBy.pit;s.spent=s.spentBy.pit;}
function normalize(s){for(const k of ['stats','maps','cars','achievements','owned','academyPaid','periods'])if(!s[k]||typeof s[k]!=='object'||Array.isArray(s[k]))s[k]={};for(const k of ['wallet','earnedBy','spentBy']){const w=s[k]&&typeof s[k]==='object'?s[k]:{};if(w.cu!=null&&w.custom==null)w.custom=w.cu;s[k]={pit:Math.floor(num(w.pit)),up:Math.floor(num(w.up)),custom:Math.floor(num(w.custom))};}s.login={day:'',streak:0,total:0,...s.login};{const x=s.exchanged&&typeof s.exchanged==='object'?s.exchanged:{};s.exchanged={pit:Math.floor(num(x.pit)),up:Math.floor(num(x.up)),custom:Math.floor(num(x.custom)),count:Math.floor(num(x.count))};}s.history=Array.isArray(s.history)?s.history.slice(-60):[];s.levelPaid=Math.max(1,Math.floor(num(s.levelPaid))||curLevel());mirror(s);return s;}
/** 예전 저장(피트 코인) → 재화 3종. j = 예전 gimmick.meta (없으면 {}), legacy = 예전에 놀았던 사람 */
function migrate(j,legacy){
 const at=Date.now(),lv=curLevel(),old={coins:Math.floor(num(j.coins)),earned:num(j.earned),spent:num(j.spent),at};
 const s=normalize({...fresh(),...j,v:1,wv:WALLET_V,wallet:W0(),earnedBy:W0(),spentBy:W0(),levelPaid:lv});
 s.legacy=old;s.migratedAt=at;
 if(legacy){
  // 그때 열려 있던 차(예전 규칙: 15대 + 레벨이 된 새 차)·레벨이 된 색은 가진 것으로
  for(const c of carUnlockList())if(!START_CARS.includes(c.id)&&carLegacyOpen(c.id,lv)&&!s.owned['car:'+c.id])s.owned['car:'+c.id]={at,source:'migrate'};
  for(const p of PAINTS)if(p.level&&!p.license&&lv>=p.level&&!s.owned['paint:'+p.id])s.owned['paint:'+p.id]={at,source:'migrate'};
  s.welcome=true;s.tutorialPaid=tutorialDone();
 }
 // 아직 안 받은 목표는 새 보상으로 (받은 것은 그대로)
 for(const type of ['daily','weekly'])(s.periods[type]?.goals||[]).forEach((g,i)=>{if(!g.claimed){g.reward=goalReward(type,i);g.coins=g.reward.pit;}});
 if(legacy){s.migrationRecord={at,amount:0,kind:'pit',reason:'재화 개편: 피트 코인 '+old.coins.toLocaleString('ko-KR')+' → 0'};s.history.push(s.migrationRecord);}
 return s;
}
function load(){
 let j=null;try{j=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
 try{
  if(j?.v===1&&j.wv===WALLET_V)return normalize({...fresh(),...j});
  if(j?.v===1)return migrate(j,true);
  if(isLegacySave())return migrate({},true);
 }catch(e){console.warn('meta 옮기기 실패, 새 지갑으로',e);}
 return fresh();
}
let state=load(),dirty=false,started=false,scanning=false,silent=false,calendarAt=0,calendarCache=null;
let run=null, notifyQueue=[],notifyBusy=false;
const emit=(name,detail)=>{try{window.dispatchEvent(new CustomEvent(name,{detail}));}catch{}};
function save(){try{mirror();if(state.legacy&&state.migratedAt){state.migrationRecord ||= {at:state.migratedAt,amount:0,kind:'pit',reason:'재화 개편: 피트 코인 '+num(state.legacy.coins).toLocaleString('ko-KR')+' → 0'};state.history=[...state.history.filter(h=>!String(h.reason).startsWith('재화 개편:')),state.migrationRecord].slice(-60);}localStorage.setItem(KEY,JSON.stringify(state));dirty=false;return true;}catch{emit('gimmick:metaError',{message:'저장 공간이 부족해요. 이 창을 닫기 전에 브라우저 저장 공간을 확인해 주세요.'});return false;}}
export function ensureMetaStyle(){if(typeof document==='undefined'||document.querySelector('link[data-meta]'))return;const ln=document.createElement('link');ln.rel='stylesheet';ln.href=new URL('./meta.css',import.meta.url).href;ln.dataset.meta='1';document.head.appendChild(ln);}
/** '⬡ +25 · ◆ +8 · ✿ +8' */
export function rewardText(r,sep=' · '){return CURRENCY_IDS.filter(k=>num(r?.[k])>0).map(k=>CURRENCIES[k].icon+' +'+Math.floor(num(r[k])).toLocaleString('ko-KR')).join(sep);}
function announce(d){if(silent||typeof document==='undefined'||window.game?.race?.phase==='finished'||window.game?.tutorial?.academy||document.getElementById('results')?.classList.contains('on'))return;notifyQueue.push(d);if(notifyQueue.length>8)notifyQueue.splice(1,notifyQueue.length-8);nextNotice();}
function nextNotice(){if(notifyBusy||!notifyQueue.length)return;notifyBusy=true;ensureMetaStyle();const d=notifyQueue.shift();const el=document.createElement('div');el.className='mt-notice';el.setAttribute('role','status');el.setAttribute('aria-live','polite');const badge=document.createElement('span');badge.className='mt-notice-medal';badge.textContent=d.icon||'✦';const txt=document.createElement('div');const small=document.createElement('small');small.textContent=d.kicker||'업적 달성';const b=document.createElement('b');b.textContent=d.name;const reward=document.createElement('em');reward.textContent=[rewardText(d.reward||{pit:d.coins}),d.xp?'+'+d.xp+' XP':''].filter(Boolean).join(' · ');txt.append(small,b,reward);el.append(badge,txt);document.body.append(el);setTimeout(()=>el.classList.add('out'),3600);setTimeout(()=>{el.remove();notifyBusy=false;nextNotice();},4100);}
/** 한 재화 지급 (저장은 부른 쪽이). 돌려주는 값 = 실제로 준 양 */
function give(kind,amount,reason){kind=currencyId(kind);amount=Math.floor(num(amount));if(!kind||!amount)return 0;state.wallet[kind]+=amount;state.earnedBy[kind]+=amount;mirror();state.history.push({at:Date.now(),amount,kind,reason});state.history=state.history.slice(-60);if(run){run.gain[kind]+=amount;if(kind==='pit')run.coins+=amount;}dirty=true;emit('gimmick:wallet',{kind,delta:amount,balance:state.wallet[kind],wallet:{...state.wallet},reason});return amount;}
/** { pit, up, custom } 묶음 지급 → 실제로 준 { pit, up, custom } */
function grant(r,reason){const got=W0();for(const k of CURRENCY_IDS)got[k]=give(k,r?.[k],reason);if(run&&(got.pit||got.up||got.custom))run.lines.push({reason,...got});return got;}
function bonusXP(amount){if(!amount)return;if(run)run.xp+=amount;profile.bonus(amount);}
/** 레벨 업 보상 (레벨마다 한 번, 이 기기). 한 번에 크게 뛰면(계정 합치기·동기화) 보상 없이 기준만 올림 */
function checkLevel(){const lv=curLevel(),from=Math.max(1,num(state.levelPaid)||lv);if(lv<=from)return;state.levelPaid=lv;dirty=true;if(lv-from>ECON.levelUpMaxJump)return;let tiers=new Set();try{tiers=new Set(profile.tiers().map(t=>t.lv));}catch{}for(let L=from+1;L<=lv;L++){const tierUp=tiers.has(L),r=ECON.levelUp(L,tierUp);grant(r,'레벨 업 · Lv.'+L+(tierUp?' · 새 티어':''));announce({icon:'⬆',kicker:'레벨 업 보상',name:'Lv.'+L+(tierUp?' · 새 티어':''),reward:r});}}
function checkTutorial(){if(state.tutorialPaid||!tutorialDone())return;state.tutorialPaid=true;dirty=true;grant(ECON.tutorial,'입문 튜토리얼 완료');announce({icon:'🎓',kicker:'튜토리얼 완료',name:'강화 조각 선물',reward:ECON.tutorial});}
const dayKey=(date=new Date())=>date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
function calendar(date=new Date()){
 const d=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);const serial=Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);const day=dayKey(d);d.setDate(d.getDate()-((d.getDay()+6)%7));return {daily:day,weekly:dayKey(d),serial};
}
function periods(){const now=Date.now();const c=now-calendarAt<1000&&calendarCache?calendarCache:(calendarAt=now,calendarCache=calendar());for(const type of ['daily','weekly'])if(state.periods[type]?.key!==c[type]){const pool=GOAL_POOLS[type],seed=type==='daily'?c.serial:Math.floor(Date.parse(c.weekly+'T12:00:00Z')/86400000/7);const ids=type==='daily'?[seed%pool.length,(seed+3)%pool.length,(seed+5)%pool.length]:[0,1,2+seed%4];state.periods[type]={key:c[type],goals:ids.map((id,i)=>{const reward=goalReward(type,i);return {...pool[id],id:type+'-'+id,progress:0,claimed:false,coins:reward.pit,reward,xp:type==='daily'?35:120};})};dirty=true;}
// 드리프트 목표를 없앰 (2026-11-15): 이번 기간에 이미 뽑힌 드리프트 목표는 같은 칸의 새 목표로 바꿈 (받은 보상은 그대로)
for(const type of ['daily','weekly']){const p=state.periods[type];if(p&&Array.isArray(p.goals)&&p.goals.some(g=>g&&g.metric==='driftDistance')){p.goals=p.goals.map(g=>g&&g.metric==='driftDistance'?{...g,...(GOAL_POOLS[type][+String(g.id).split('-')[1]]||GOAL_POOLS[type][0]),progress:g.claimed?g.progress:0}:g);dirty=true;}}
return c;}
function checkGoals(){for(const type of ['daily','weekly'])state.periods[type].goals.forEach((g,i)=>{if(!g.claimed&&g.progress>=g.goal){g.claimed=true;const reward=g.reward||goalReward(type,i);grant(reward,g.name);bonusXP(g.xp);const d={...g,reward,kicker:type==='daily'?'일일 목표 완료':'주간 목표 완료'};if(run)run.goals.push(d);announce(d);}});}
function inc(metric,delta){delta=num(delta);if(!delta)return;periods();state.stats[metric]=num(state.stats[metric])+delta;for(const type of ['daily','weekly'])for(const g of state.periods[type].goals)if(g.metric===metric)g.progress=Math.min(g.goal,num(g.progress)+delta);dirty=true;}
function metricValue(a){if(a.metric.startsWith('map:'))return num(state.maps[a.metric.slice(4)]);return num(state.stats[a.metric]);}
function scan(){if(scanning)return;scanning=true;try{periods();checkTutorial();checkLevel();for(const a of ACHIEVEMENTS){if(state.achievements[a.id]||metricValue(a)<a.goal)continue;state.achievements[a.id]={at:Date.now(),coins:a.coins,reward:{...a.reward},xp:a.xp};if(a.costume)state.owned['costume:'+a.costume]={at:Date.now(),source:'achievement'};grant(a.reward,'업적 · '+a.name);bonusXP(a.xp);if(run)run.achievements.push(a.id);announce({...a,icon:['','🥉','🥈','🥇'][a.tier]});}checkGoals();checkLevel();if(dirty)save();emit('gimmick:meta');}finally{scanning=false;}}
function reconcileAcademy(){const all=academy.all();let done=0,gold=0;for(const l of LESSONS){const medal=num(all.lessons[l.id]?.medal);const tries=num(all.lessons[l.id]?.tries),tryKey='tries:'+l.id;if(!silent&&tries>num(state.academyPaid[tryKey])&&medal>0)inc('academySessions',1);state.academyPaid[tryKey]=tries;if(medal>0)done++;if(medal===3)gold++;const old=num(state.academyPaid[l.id]);if(medal>old){const A=ECON.academy;grant({pit:A.pit[medal]-A.pit[old],up:A.up[medal]-A.up[old]},'아카데미 · '+l.name);state.academyPaid[l.id]=medal;inc('academyMedals',medal-old);inc('lessons',old?0:1);inc('goldLessons',medal===3?1:0);}}
 // 예전에 딴 메달은 최초 연결 때 한 번만 인정. 진행은 저장된 최고 성적 기준.
 state.stats.lessons=Math.max(num(state.stats.lessons),done);state.stats.goldLessons=Math.max(num(state.stats.goldLessons),gold);
 for(const l of LICENSES)if(all.licenses[l.id]&&!state.academyPaid['license:'+l.id]){state.academyPaid['license:'+l.id]=1;grant(ECON.license[l.id],'라이선스 '+l.id);}
 if(all.licenses.S)state.stats.licenseS=1;scan();}
export function bootMeta(){if(started)return;started=true;ensureMetaStyle();periods();if(!state.welcome){state.welcome=true;grant(ECON.welcome,'피트에 온 걸 환영해요');}
 const today=calendar(),login=state.login;if(login.day!==today.daily){const prev=login.day?Math.floor(Date.parse(login.day+'T12:00:00Z')/86400000):0;login.streak=today.serial-prev===1?num(login.streak)+1:1;login.day=today.daily;login.total=num(login.total)+1;const r=ECON.login(login.streak);login.rewards=r;login.reward=r.pit;grant(r,'오늘의 피트 체크인');state.stats.loginDays=login.total;}
 // 초기 로딩에서는 작은 완료 알림을 몰아서 띄우지 않음. 보상·업적 자체는 지급.
 silent=true;reconcileAcademy();silent=false;save();
 window.addEventListener('gimmick:resultsOpen',()=>{notifyQueue=[];document.querySelectorAll('.mt-notice').forEach(el=>el.remove());});
 window.addEventListener('gimmick:xp',()=>{if(scanning)return;checkLevel();if(dirty){save();emit('gimmick:meta');}});
 window.addEventListener('gimmick:academy',reconcileAcademy);window.addEventListener('pagehide',()=>dirty&&save());document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty)save();});window.addEventListener('storage',e=>{if(e.key===KEY){state=load();dirty=false;emit('gimmick:meta');}});
}

// ───────── 지갑 API (.debug/agents/wallet-contract.md) ─────────
/** 보유량 (kind = 'pit' | 'up' | 'custom', 별칭 'cu') */
export function balance(kind){bootMeta();const k=currencyId(kind);return k?state.wallet[k]:0;}
/** { pit, up, custom } 복사본 */
export function wallet(){bootMeta();return {...state.wallet};}
/** 지급하고 저장 → 새 보유량 */
export function credit(kind,amount,reason='지급'){bootMeta();const k=currencyId(kind);if(!k)return 0;if(give(k,amount,reason)){save();emit('gimmick:meta');}return state.wallet[k];}
/** 쓰기: 모자라거나 잘못된 값·저장 실패면 false (하나도 안 뺌), 되면 true */
export function spend(kind,amount,reason='사용'){bootMeta();const k=currencyId(kind),n=Math.ceil(Number(amount));if(!k||!Number.isFinite(n)||n<0)return false;if(n===0)return true;if(state.wallet[k]<n)return false;const before=structuredClone(state);state.wallet[k]-=n;state.spentBy[k]+=n;mirror();state.history.push({at:Date.now(),amount:-n,kind:k,reason});state.history=state.history.slice(-60);if(!save()){state=before;return false;}emit('gimmick:wallet',{kind:k,delta:-n,balance:state.wallet[k],wallet:{...state.wallet},reason});emit('gimmick:meta');return true;}
// ───────── 교환소 (exchange, 2026-11-15): 피트 조각 → 강화·커스텀 조각, 반대 방향 없음. 비율 = metaCatalog ECON.exchange ─────────
const xchFail=(to,message,extra={})=>({ok:false,from:'pit',to,spent:0,got:0,wallet:{...state.wallet},message,...extra});
/** 바꾸기 전 계산 (아무것도 안 바꿈). → { ok, from:'pit', to, times, spent, got, have, missing, after:{pit, [to]}, rate } */
export function exchangeQuote(to,times=1){bootMeta();const k=currencyId(to),rate=k&&k!=='pit'?ECON.exchange?.[k]:null,t=Math.floor(Number(times));
 if(!rate)return xchFail(to,'피트 조각은 강화 조각·커스텀 조각으로만 바꿀 수 있어요');
 if(!Number.isFinite(t)||t<1||t>(ECON.exchangeMaxTimes||100))return xchFail(k,'바꿀 횟수가 올바르지 않아요');
 const spent=rate.pit*t,got=rate.get*t,have=state.wallet.pit,missing=Math.max(0,spent-have);
 return {ok:!missing,from:'pit',to:k,times:t,spent,got,have,missing,rate:{...rate},after:{pit:have-spent,[k]:state.wallet[k]+got},wallet:{...state.wallet},...(missing?{message:missingText('pit',missing)}:{})};}
/** 교환: ⬡ (rate.pit×times) 빼고 + (rate.get×times) 넣기를 한 번에 (부족·저장 실패면 둘 다 안 됨). → { ok, from, to, spent, got, wallet, message?, missing? } */
export function exchange(to,times=1){const q=exchangeQuote(to,times);if(!q.ok)return {ok:false,from:'pit',to:q.to,spent:0,got:0,wallet:{...state.wallet},message:q.message,...(q.missing?{missing:q.missing}:{})};
 const k=q.to,before=structuredClone(state),at=Date.now(),ci=CURRENCIES[k];
 state.wallet.pit-=q.spent;state.spentBy.pit+=q.spent;state.wallet[k]+=q.got;state.earnedBy[k]+=q.got;mirror();
 const x=state.exchanged;x.pit+=q.spent;x[k]+=q.got;x.count+=q.times;
 state.history.push({at,amount:-q.spent,kind:'pit',reason:'교환 → '+ci.name},{at,amount:q.got,kind:k,reason:'교환 ← 피트 조각'});state.history=state.history.slice(-60);
 if(!save()){state=before;return {ok:false,from:'pit',to:k,spent:0,got:0,wallet:{...state.wallet},message:'저장하지 못했어요. 교환은 취소했어요.'};}
 const w={...state.wallet},reason='교환 · '+CURRENCIES.pit.icon+' '+q.spent+' → '+ci.icon+' '+q.got;
 emit('gimmick:wallet',{kind:'pit',delta:-q.spent,balance:w.pit,wallet:w,reason});emit('gimmick:wallet',{kind:k,delta:q.got,balance:w[k],wallet:{...w},reason});emit('gimmick:meta');
 return {ok:true,from:'pit',to:k,times:q.times,spent:q.spent,got:q.got,wallet:{...w}};}
/** 차: 가진 차인가 · 값(⬡) · 사기 */
export const isCarOwned = (id) => carOwned(id);
export const carPrice = (id) => carPriceOf(id);
export const buyCar = (id) => meta.buy('car', { id });
const missingText=(cur,missing)=>CURRENCIES[cur].icon+' '+missing.toLocaleString('ko-KR')+' '+CURRENCIES[cur].name+'이 더 필요해요. 레이스·목표·아카데미에서 모아 보세요.';
const carName=id=>carInfo(id)?.name||carUnlockList().find(c=>c.id===id)?.name||id;

export const meta={
 migrationNotice(){bootMeta();return state.legacy&&state.migratedAt&&!state.migrationNoticeSeen?{coins:num(state.legacy.coins)}:null;},
 acknowledgeMigration(){state.migrationNoticeSeen=true;return save();},
 get(){bootMeta();periods();return structuredClone(state);},
 achievements(){bootMeta();return ACHIEVEMENTS.map(a=>({...a,value:metricValue(a),done:!!state.achievements[a.id],at:state.achievements[a.id]?.at||null}));},
 owns(key){if(key==='celebration:stock')return true;if(String(key).startsWith('car:'))return carOwned(String(key).slice(4))||!!state.owned[key];return !!state.owned[key];},
 title(){const a=[...ACHIEVEMENTS,...RETIRED_ACHIEVEMENTS].find(a=>a.id===state.title&&state.achievements[a.id]);return a?.title||'';},
 setTitle(id){if(id&&!ACHIEVEMENTS.some(a=>a.id===id&&a.title&&state.achievements[id]))return false;state.title=id;save();emit('gimmick:meta');return true;},
 celebration(){return CELEBRATIONS.find(c=>c.id===state.celebration)||CELEBRATIONS[0];},
 equipCelebration(id){if(!CELEBRATIONS.some(c=>c.id===id)||!this.owns('celebration:'+id))return false;state.celebration=id;save();emit('gimmick:meta');return true;},
 balance, wallet, credit, spend, buyCar, carPrice, isCarOwned, exchange, exchangeQuote,
 /** 교환 합계 { pit(쓴 ⬡), up, custom(받은 양), count(바꾼 횟수) } */
 exchanged(){bootMeta();return {...state.exchanged};},
 /** 구매: kind = 'car'·'part'(피트 조각) | 'costume'·'paint'·'celebration'(커스텀 조각). → { ok, price, currency, owned?, message?, missing? } */
 buy(kind,item){bootMeta();let key,price,name;const cur=SHOP_CURRENCY[kind];const lv=curLevel();
  if(kind==='car'){const id=item?.id||item?.carId;if(START_CARS.includes(id))return {ok:true,owned:true,price:0,currency:cur};if(!CAR_SHOP[id])return {ok:false,currency:cur,message:'이 차를 찾지 못했어요'};if(carOwned(id))return {ok:true,owned:true,price:0,currency:cur};const need=carUnlockLevel(id);if(lv<need)return {ok:false,currency:cur,message:'Lv.'+need+'부터 피트 조각으로 살 수 있어요. 잠긴 차도 미리 볼 수 있어요.'};key='car:'+id;price=carPriceOf(id);name=carName(id);}
  else if(kind==='costume'){const c=listCostumes(item?.carId).find(c=>c.id===item?.id);if(!c)return {ok:false,currency:cur,message:'이 코스튬을 찾지 못했어요'};if(lv<c.unlockLevel)return {ok:false,currency:cur,message:'Lv.'+c.unlockLevel+'부터 구매할 수 있어요. 잠긴 모습도 미리 볼 수 있어요.'};key='costume:'+c.id;price=costumePrice(c);name=c.name;}
  else if(kind==='paint'){const p=PAINTS.find(p=>p.id===Number(item?.id));if(!p)return {ok:false,currency:cur,message:'이 색을 찾지 못했어요'};if(p.license)return {ok:false,currency:cur,message:'이 색은 아카데미 라이선스를 따면 열려요.'};if(!p.level||isPaintUnlocked(p.id))return {ok:true,owned:true,price:0,currency:cur};if(lv<p.level)return {ok:false,currency:cur,message:'Lv.'+p.level+'부터 커스텀 조각으로 살 수 있어요.'};key='paint:'+p.id;price=paintPrice(p);name=p.name;}
  else if(kind==='celebration'){const c=CELEBRATIONS.find(c=>c.id===item?.id);if(!c)return {ok:false,currency:cur,message:'상품을 찾지 못했어요'};key='celebration:'+c.id;price=c.price;name=c.name;}
  else if(kind==='part'){const p=partOf(item?.id),st=p&&partState(p.id);if(!p||!st)return {ok:false,currency:cur,message:'이 부품을 찾지 못했어요'};if(st.owned)return {ok:true,owned:true,price:0,currency:cur};if(!st.levelOk)return {ok:false,currency:cur,message:st.lockReason};key='part:'+p.id;price=partPrice(p);name=p.name;}
  else return {ok:false,message:'상품을 찾지 못했어요'};
  if(this.owns(key))return {ok:true,owned:true,price:0,currency:cur};const have=state.wallet[cur];if(have<price)return {ok:false,currency:cur,missing:price-have,message:missingText(cur,price-have)};
  const before=structuredClone(state);state.wallet[cur]-=price;state.spentBy[cur]+=price;mirror();state.owned[key]={at:Date.now(),price,currency:cur};state.history.push({at:Date.now(),amount:-price,kind:cur,reason:name||key});state.history=state.history.slice(-60);inc('purchases',1);if(!save()){state=before;return {ok:false,currency:cur,message:'저장하지 못했어요. 구매는 취소했어요.'};}
  emit('gimmick:wallet',{kind:cur,delta:-price,balance:state.wallet[cur],wallet:{...state.wallet},reason:name||key});scan();emit('gimmick:meta');return {ok:true,price,currency:cur};
 },
 flush:save,
 /** 부품 상자: 재화 개편으로 없앰 (늘 null). 예전 화면 코드가 불러도 괜찮음 */
 claimPartsBox(){return null;},
 /** 예전에 받은 부품 상자 기록 (없으면 null) */
 partsBox(){return state.partsBox?{...state.partsBox}:null;},
 /**
  * 상점 공통 목록: 차·부품·코스튬·색·세리머니를 한 줄로. opts = { kinds: ['car','part','costume','paint','celebration'], carId, carIds }
  *   코스튬은 carId(또는 carIds) 차의 것만, 색·부품의 '착용'도 carId 기준. 항목:
  *   { key, kind, id, carId?, slot?, name, desc, icon, price, currency, balance, level, owned, equipped, canBuy, locked, lockReason, altText?, canAfford, missing, buy() → buy 결과, equip() → { ok, message? } }
  *   canBuy = 지금 살 수 있음(재화는 canAfford·missing = 그 상품의 currency 기준), locked = 레벨·라이선스가 아직 안 됨
  */
 shop(opts={}){bootMeta();const kinds=opts.kinds||SHOP_KINDS.map(k=>k[0]),lv=curLevel(),out=[];const money=(price,cur)=>{const have=state.wallet[cur]||0;return {currency:cur,balance:have,canAfford:have>=price,missing:Math.max(0,price-have)};};const carIds=opts.carIds||(opts.carId?[opts.carId]:[]);
  if(kinds.includes('car'))for(const id of Object.keys(CAR_SHOP).sort((a,b)=>CAR_SHOP[a].level-CAR_SHOP[b].level||CAR_SHOP[a].price-CAR_SHOP[b].price)){const info=carInfo(id)||{},price=carPriceOf(id),level=carUnlockLevel(id),owned=carOwned(id),levelOk=lv>=level;out.push({key:'car:'+id,kind:'car',id,carId:id,name:info.name||id,desc:info.tag||info.desc||'',class:info.class||'',icon:'🚗',price,level,owned,equipped:false,canBuy:!owned&&levelOk,locked:!owned&&!levelOk,lockReason:owned||levelOk?'':'Lv.'+level+'부터 피트 조각으로 살 수 있어요',...money(price,'pit'),buy:()=>meta.buy('car',{id}),equip:()=>owned?{ok:true}:{ok:false,message:'먼저 구매해 주세요'}});}
  if(kinds.includes('part')){const cur=opts.carId?getBuild(opts.carId):null;for(const p of listParts()){const price=partPrice(p);out.push({key:'part:'+p.id,kind:'part',id:p.id,slot:p.slot,slotName:p.slotName,name:p.name,desc:p.desc,icon:p.icon,pros:p.pros,cons:p.cons,shines:p.shines,price,level:p.level,owned:p.owned,equipped:!!cur&&cur[p.slot]===p.id,canBuy:p.canBuy,locked:p.locked,lockReason:p.lockReason,altText:p.altText,source:p.source,...money(price,'pit'),buy:()=>meta.buy('part',{id:p.id}),equip:()=>opts.carId?setPart(opts.carId,p.slot,p.id):{ok:false,message:'차를 먼저 골라 주세요'}});}}
  if(kinds.includes('costume'))for(const carId of carIds)for(const c of listCostumes(carId)){const price=costumePrice(c),key='costume:'+c.id,equipped=getCostume(carId)===c.id,owned=meta.owns(key)||equipped,levelOk=lv>=c.unlockLevel;out.push({key,kind:'costume',id:c.id,carId,name:c.name,desc:c.desc||'',icon:'✦',price,level:c.unlockLevel,owned,equipped,canBuy:!owned&&levelOk,locked:!levelOk,lockReason:levelOk?'':'Lv.'+c.unlockLevel+'부터 구매·착용할 수 있어요',...money(price,'custom'),buy:()=>meta.buy('costume',c),equip:()=>owned&&setCostume(carId,c.id)?{ok:true}:{ok:false,message:owned?'Lv.'+c.unlockLevel+'부터 입을 수 있어요':'먼저 구매해 주세요'}});}
  if(kinds.includes('paint'))for(const p of PAINTS){if(!p.id)continue;const owned=isPaintUnlocked(p.id),price=p.license||!p.level?0:paintPrice(p),levelOk=lv>=(p.level||0),canBuy=!owned&&!p.license&&!!p.level&&levelOk;out.push({key:'paint:'+p.id,kind:'paint',id:p.id,name:p.name,desc:p.license?p.license+' 라이선스 색':'모든 차에 쓸 수 있는 색',icon:'🎨',color:p.body,price,level:p.level,license:p.license||null,owned,equipped:!!opts.carId&&getPaint(opts.carId)===p.id,canBuy,locked:!owned&&!canBuy,lockReason:owned||canBuy?'':p.license?p.license+' 라이선스를 따면 열려요':'Lv.'+p.level+'부터 커스텀 조각으로 살 수 있어요',...money(price,'custom'),buy:()=>meta.buy('paint',p),equip:()=>{if(!opts.carId)return {ok:false,message:'차를 먼저 골라 주세요'};if(!isPaintUnlocked(p.id))return {ok:false,message:'아직 잠긴 색이에요'};setPaint(opts.carId,p.id);return {ok:true};}});}
  if(kinds.includes('celebration'))for(const c of CELEBRATIONS){const key='celebration:'+c.id,owned=meta.owns(key);out.push({key,kind:'celebration',id:c.id,name:c.name,desc:c.desc,icon:c.icon,price:c.price,level:0,owned,equipped:state.celebration===c.id,canBuy:!owned,locked:false,lockReason:'',...money(c.price,'custom'),buy:()=>meta.buy('celebration',c),equip:()=>meta.equipCelebration(c.id)?{ok:true}:{ok:false,message:'먼저 구매해 주세요'}});}
  return out;},
};

/** 플레이어 한 대만 집계. main의 실제 물리 스텝에서 호출. 봇·시범·리플레이·테스트 운전은 caller와 여기서 모두 제외. */
export function createMetaTracker(o){bootMeta();let sinceScan=0,lastMode=null,hadBad=false,wasLast=false,modes=new Set(),elapsed=0,lastTime=0;
 function reset(){run={coins:0,gain:W0(),lines:[],xp:0,achievements:[],goals:[],before:structuredClone(state.stats),id:crypto.randomUUID(),completed:false,beforeLevel:profile.get().level};sinceScan=0;lastMode=null;hadBad=false;wasLast=false;modes=new Set();elapsed=0;lastTime=0;}
 function allowed(){const g=window.game;return !o.excluded()&&!(g&&(g.paused||g.controlsOverride||g.tutorial||g.replay?.active||g.academy?.demo));}
 function sample(dt,c,place,total){if(!allowed()||o.phase()!=='racing'||!run||run.completed)return;dt=Math.max(0,Math.min(.05,dt));elapsed+=dt;if(c.events?.some(e=>['bump','respawn','lava','fall','sink'].includes(e)))hadBad=true;const speed=Math.abs(Number(c.speed)||0),distance=speed*dt;inc('distance',distance);state.stats.maxSpeed=Math.max(num(state.stats.maxSpeed),speed*3.6);if(c.mode==='boat')inc('boatDistance',distance);if(c.flying)inc('flyDistance',distance);if(!c.grounded&&!c.flying&&c.mode!=='boat')inc('jumpSeconds',dt);if(c.drs>.5)inc('drsSeconds',dt);if(c.draft>.15)inc('draftSeconds',dt);const form=c.flying?'fly':c.mode==='boat'?'boat':'land';if(distance>.01)modes.add(form);if(lastMode!==null&&lastMode!==c.mode)inc('transforms',1);lastMode=c.mode;if(total>2&&place===total&&elapsed>8)wasLast=true;sinceScan+=dt;if(sinceScan>=2){sinceScan=0;scan();}}
 function event(e,c){if(!allowed()||o.phase()!=='racing'||!run||run.completed)return;if(['bump','respawn','lava','fall','sink'].includes(e))hadBad=true;if(e==='perfectLaunch')inc('perfectLaunch',1);if(e==='apex'||e==='apexPerfect')inc('apex',1);}
 function finish(d){if(!allowed()||!run||run.completed||elapsed<10||!(d.time>10))return;run.completed=true;run.raceXp=xpFor(d);const firstStarter=d.map==='starter'&&d.mode==='race'&&profile.get().races===1&&!num(state.stats.races);const firstMap=!num(state.maps[d.map]),firstCar=!num(state.cars[d.car]);inc('races',1);state.maps[d.map]=num(state.maps[d.map])+1;state.cars[d.car]=num(state.cars[d.car])+1;state.stats.uniqueMaps=Object.keys(state.maps).length;state.stats.uniqueCars=Object.keys(state.cars).length;
 if(d.total>1&&d.place>0&&d.place<=3){inc('podiums',1);if(wasLast)inc('comebacks',1);}if(d.total>1&&d.place===1){inc('wins',1);if(['hard','master'].includes(o.level()))inc('hardWins',1);}if(!hadBad)inc('cleanRaces',1);if(modes.size===3)inc('threeForms',1);const hour=new Date().getHours();if(hour>=22||hour<5)inc('nightFinishes',1);
 // 완주 보상 (설계 3.2): 기본 ⬡40 + 30초마다 10(최대 60) · ◆6 · ✿3, 순위(상대가 없으면 '그 밖'), 깔끔한 완주 ◆3, 맵·차 첫 완주 ✿20·✿10
 const base={...ECON.finishBase,pit:ECON.finishBase.pit+Math.min(ECON.finishPitMax,Math.floor(d.time/30)*ECON.finishPitPer30s)};const pl=d.total>1&&d.place>0?(d.place===1?ECON.place.first:d.place<=3?ECON.place.podium:ECON.place.other):ECON.place.other;
 grant(base,'완주 · '+d.map);grant(pl,d.total>1?'순위 · '+d.place+'위':'완주 보너스');run.base=base.pit;run.place=pl.pit||0;if(!hadBad)grant(ECON.clean,'깔끔한 완주');if(firstMap)grant(ECON.firstMap,'첫 완주 · '+d.map);if(firstCar)grant(ECON.firstCar,'첫 완주 · '+carName(d.car));
 scan();
 // firstrace: 첫 변신 연습장 완주만 Lv3 부족분 보충. 순위·주행 업적·날짜 목표에 의존하지 않음.
 // profile 완주 이벤트가 먼저 지급된 뒤라 races===1. 기존 XP 곡선과 이후 판 보상은 그대로.
 if(firstStarter){const extra=Math.max(0,levelStartXp(3)-profile.get().xp);if(extra){bonusXP(extra);checkLevel();}}
 state.recentXp=[...(Array.isArray(state.recentXp)?state.recentXp:[]),num(run.raceXp)+num(run.xp)].slice(-5);save();/* rewards1: 최근 5판 XP(완주+업적·목표) → rewardPath.racesToLevel '약 n판' */emit('gimmick:metaFinish',summary());}
 function summary(){if(!run?.completed)return null;const progress=ACHIEVEMENTS.filter(a=>!state.achievements[a.id]&&metricValue(a)>num(run.before[a.metric])&& !a.metric.startsWith('map:')).map(a=>({...a,value:metricValue(a),delta:metricValue(a)-num(run.before[a.metric])})).sort((a,b)=>b.value/b.goal-a.value/a.goal).filter((a,i,arr)=>arr.findIndex(b=>b.family===a.family)===i).slice(0,3);return {...run,gain:{...run.gain},lines:run.lines.slice(),profile:profile.get(),progress,celebration:meta.celebration(),title:meta.title(),balance:state.wallet.pit,wallet:{...state.wallet}};}
 window.addEventListener('gimmick:raceDone',e=>finish(e.detail||{}));reset();return {reset,sample,event,summary};
}

// 계정 클라우드 저장 (cloudSave.js, 2026-11-15): 올리기 전에 미뤄 둔 저장을 바로 씀 / 서버 진행으로 바꾼 뒤 다시 읽음
export function metaFlush(){if(dirty)save();}
export function metaReload(){state=load();dirty=false;emit('gimmick:meta');}
