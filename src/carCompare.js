// 차고 비교: 실제 설정에서 계산한 공통 100점 지표. 물리/해금/외형 데이터는 변경하지 않음.
import { statScore } from './carRoster.js';
import { loadCarThumbs, thumbUrl } from './garageThumbQueue.js';
import { spatialMove, uiSound } from './settings.js';
const KEY = 'gimmick.compare';
const COLORS = ['#79caff', '#ffc969', '#d4a4ff'];
const STATS = [
 ['speed','최고 속도','직선 속도','topKmh','km/h',0],
 ['accel','가속','0→100 km/h · 짧을수록 좋음','zero100Sec','초',2],
 ['handling','핸들링','방향 전환과 조향 반응'],
 ['grip','접지력','150 km/h에서 옆 가속 한계','lateral150','m/s²',1],
 ['brake','브레이크','100→0 km/h · 짧을수록 좋음','brake100M','m',0],
 ['drift','드리프트','미끄러짐을 유지하기 쉬운 정도'],
 ['offroad','오프로드','잔디에서 속도 유지율','offroadKeep','%',0],
 ['boat','배 성능','물 위 최고 속도','boatKmh','km/h',0],
];
const esc = s => String(s ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function createCarCompare({ host, cars, classOf, isOpen, onPick, onVisibility }) {
 let ids = [];
 try { const saved=JSON.parse(localStorage.getItem(KEY)||'[]'); ids=[...new Set(Array.isArray(saved)?saved:[])].filter(id=>cars.some(c=>c.id===id)).slice(0,3); } catch {}
 let overlay=null, panel=null, previous=null, picker=null, job=null, inert=[];
 const carOf = id => cars.find(c=>c.id===id);
 const save = () => { try { localStorage.setItem(KEY,JSON.stringify(ids)); } catch {} };
 const btn = (action,text,extra='') => '<button type="button" class="gm-btn" data-nav data-cp="'+action+'" '+extra+'>'+text+'</button>';
 function photo(c) { const url=thumbUrl(c.id); return '<span class="cp-photo" data-photo="'+c.id+'">'+(url?'<img src="'+url+'" alt="'+esc(c.name)+'" draggable="false">':'<span class="cp-placeholder">🏎</span>')+'</span>'; }
 function badge(c) { const k=classOf(c.class); return '<span class="cp-class" style="--cc:'+esc(k?.color||'#b4c4df')+'">'+esc(c.class||'—')+' · '+esc(k?.name?.replace(/^[ABC]\s*/, '')||'차량')+'</span>'+(isOpen(c.id)?'':'<span class="cp-lock">🔒 Lv.'+c.unlockLevel+'</span>'); }
 function updateThumb(id,url) { if(!overlay)return; for(const box of overlay.querySelectorAll('[data-photo="'+id+'"]')) { box.innerHTML='<img src="'+url+'" alt="'+esc(carOf(id)?.name)+'" draggable="false">'; } }
 function photos(list) { job?.cancel(); job=loadCarThumbs(list,{first:ids[0],channel:'compare',onThumb:updateThumb}); job.done.catch(()=>{}); }
 function focus(sel) { panel.querySelector(sel)?.focus({preventScroll:true}); }
 function close() {
  if(!overlay)return;
  job?.cancel(); window.removeEventListener('keydown',onKey,true);
  overlay.remove(); overlay=null; panel=null; picker=null;
  for(const [el,was] of inert) el.inert=was; inert=[];
  host.classList.remove('compare-open'); onVisibility?.(false);
  if(previous?.isConnected)previous.focus({preventScroll:true});
  uiSound('back');
 }
 function summary(list) {
  if(list.length<2)return '차를 한 대 더 넣으면 8가지 성능을 바로 비교할 수 있어요.';
  const phrases={speed:'직선 속도',accel:'출발 가속',handling:'방향 전환',grip:'코너 접지력',brake:'제동',drift:'드리프트 유지',offroad:'잔디 주행',boat:'물 위 주행'};
  const parts=list.map(c=> {
   const ranked=STATS.map(([key])=>({key,d:statScore(c.stats,key)-Math.max(...list.filter(o=>o!==c).map(o=>statScore(o.stats,key)))})).sort((a,b)=>b.d-a.d);
   return ranked[0].d>0 ? c.name+'는 '+phrases[ranked[0].key]+'에 강해요' : '';
  }).filter(Boolean);
  return parts.length ? parts.join(' · ') : '성능 점수가 같아요. 마음에 드는 디자인으로 골라 보세요.';
 }
 function render(focusSelector) {
  picker=null;
  const list=ids.map(carOf).filter(Boolean), count=Math.max(2,list.length);
  panel.style.setProperty('--cp-cols',count);
  panel.innerHTML='<header class="cp-head"><div><span class="cp-kicker">GARAGE / COMPARE</span><h2 id="cp-title">차량 비교 <small>'+list.length+' / 3</small></h2></div>'+btn('close','‹ 차고로','aria-label="비교 닫고 차고로"')+'</header><div class="cp-scroll"><div class="cp-intro">평지 예상 성능 · 내 주행 스타일에 맞는 차를 찾아보세요.<span>차 사진을 누르면 다른 차로 바꿀 수 있어요.</span></div><div class="cp-grid cp-cars"><div class="cp-axis"><b>어떤 차가<br>나에게 맞을까?</b><small>최대 3대 나란히 비교</small></div>'+Array.from({length:count},(_,i)=>{
   const c=list[i];
   if(!c)return '<div class="cp-slot cp-empty">'+btn('change','<b>＋</b><span>비교할 차 추가</span>','data-slot="'+i+'"')+'</div>';
   return '<article class="cp-slot" style="--cp-color:'+COLORS[i]+'"><div class="cp-carbuttons">'+btn('remove','×','data-slot="'+i+'" aria-label="'+esc(c.name)+' 비교에서 빼기"')+'</div><button type="button" class="cp-change gm-btn" data-nav data-cp="change" data-slot="'+i+'" aria-label="'+esc(c.name)+' 다른 차로 바꾸기">'+photo(c)+'<span class="cp-badges">'+badge(c)+'</span><b class="cp-name">'+esc(c.name)+'</b><small>차 바꾸기 ↔</small></button>'+btn('pick',isOpen(c.id)?'이 차로 정하기':'🔒 Lv.'+c.unlockLevel,'data-id="'+c.id+'" '+(isOpen(c.id)?'':'disabled'))+'</article>';
  }).join('')+'</div><div class="cp-legend cp-grid"><span>능력치 / 100<small class="cp-tablehint"><i class="cp-win">▲ 우세</i> · <i class="cp-loss">▼ 최고와 점수 차이</i></small></span>'+Array.from({length:count},(_,i)=>'<span class="cp-key" style="--cp-color:'+COLORS[i]+'">'+esc(list[i]?.name||'차 추가 대기')+'</span>').join('')+'</div><div class="cp-stats">'+STATS.map(([key,label,hint,metric,unit,digits])=>{
   const scores=list.map(c=>statScore(c.stats,key)), best=Math.max(...scores), next=Math.max(...scores.filter(s=>s<best)), winners=scores.filter(s=>s===best).length;
   return '<section class="cp-grid cp-row" aria-label="'+label+'"><div class="cp-label"><b>'+label+'</b><small>'+hint+'</small></div>'+Array.from({length:count},(_,i)=>{
    const c=list[i]; if(!c)return '<div class="cp-value cp-missing">—</div>';
    const value=scores[i], win=list.length>1&&value===best&&winners<list.length, diff=value-best;
    const verdict=list.length<2?'비교 대기':winners===list.length?'＝ 동일':win?(winners>1?'＝ 공동 우세':'▲ 우세 +'+(value-next)):(diff===0?'＝ 같음':'▼ '+diff);
    const raw=c.stats?.metrics?.[metric];
    const actual=Number.isFinite(raw)?raw.toFixed(digits)+' <small>'+unit+'</small>':(key==='handling'?'조향 반응 점수':'유지 용이성 점수');
    return '<div class="cp-value'+(win?' is-win':'')+'" style="--cp-color:'+COLORS[i]+'" aria-label="'+esc(c.name)+' '+value+'점 '+verdict+'"><div class="cp-score"><strong>'+value+'</strong><span class="'+(win?'cp-win':diff<0?'cp-loss':'')+'">'+verdict+'</span></div><div class="cp-bar" role="meter" aria-label="'+esc(c.name)+' '+label+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+value+'"><i style="width:'+value+'%"></i></div><div class="cp-actual">'+actual+'</div></div>';
   }).join('')+'</section>';
  }).join('')+'</div><div class="cp-summary"><b>나에게 맞는 선택</b><p>'+esc(summary(list))+'</p></div><details class="cp-method"><summary data-nav>예상 수치와 비교 기준 안내</summary><p>모든 차를 같은 평지 조건으로 계산한 예상 성능이며 실제 주행 기록과 달라요. 가속 변신을 포함하고 부스터·견인은 제외해요. 100점 점수는 전체 차량 사이의 상대 성능이에요. 초·제동 거리는 짧을수록, 나머지 수치는 클수록 좋아요. 우세와 차이는 100점 점수를 기준으로 표시해요.</p><p>핸들링은 조향·입력·회전 반응, 드리프트는 미끄러짐 유지 용이성이에요. 이 두 항목은 실제 단위 대신 점수로 비교해요. 접지력은 150 km/h에서의 옆 가속 한계예요.</p></details></div><footer class="cp-foot"><span>↑↓←→ 이동 · Enter / A 확인 · Esc / B 뒤로<span class="cp-scrollhint">아래로 스크롤해 8개 항목 비교</span></span>'+(list.length<3?btn('change','＋ 차 추가','data-slot="'+list.length+'"'):'<span>3대 비교 중</span>')+'</footer>';
  if(focusSelector)focus(focusSelector);
  photos(list);
 }
 function choose(slot) {
  picker=slot;
  panel.innerHTML='<header class="cp-head"><div><span class="cp-kicker">COMPARE / SELECT</span><h2 id="cp-title">비교할 차 고르기</h2></div>'+btn('cancel','‹ 비교로')+'</header><div class="cp-search"><label>차 이름 찾기<input data-nav type="search" placeholder="이름 또는 등급으로 찾기" aria-label="비교할 차 이름 찾기" autocomplete="off"></label><span>🔒 잠긴 차도 성능을 비교할 수 있어요</span></div><div class="cp-picker cp-scroll"></div><footer class="cp-foot"><span>Esc / B · 비교 화면으로 돌아가기</span></footer>';
  const input=panel.querySelector('input');
  const draw=()=>{
   const q=input.value.trim().toLocaleLowerCase();
   const filtered=cars.filter(c=>(c.name+' '+c.id+' '+c.class+' '+(classOf(c.class)?.name||'')).toLocaleLowerCase().includes(q));
   panel.querySelector('.cp-picker').innerHTML=filtered.length?filtered.map(c=>{
    const used=ids.includes(c.id)&&ids[slot]!==c.id;
    return '<button type="button" class="gm-btn cp-option" data-nav data-cp="option" data-id="'+c.id+'" '+(used?'disabled':'')+'>'+photo(c)+'<span class="cp-badges">'+badge(c)+'</span><b>'+esc(c.name)+'</b><small>'+(used?'이미 비교 중':ids[slot]===c.id?'현재 비교 중':'비교에 넣기 ＋')+'</small></button>';
   }).join(''):'<p class="cp-noresults" role="status">찾는 차가 없어요. 다른 이름을 입력해 보세요.</p>';
  };
  input.addEventListener('input',draw); draw(); photos(cars); focus('[data-cp="cancel"]');
 }
 function onClick(e) {
  const b=e.target.closest('[data-cp]'); if(!b||b.disabled)return;
  const action=b.dataset.cp, slot=Number(b.dataset.slot);
  if(action==='close')return close();
  if(action==='cancel')return render('[data-cp="change"][data-slot="'+picker+'"]');
  if(action==='change')return choose(slot);
  if(action==='remove'){ids.splice(slot,1);save();render('[data-cp="change"][data-slot="'+Math.min(slot,Math.max(1,ids.length)-1)+'"]');return;}
  if(action==='option'){
   const chosen=picker; ids[chosen]=b.dataset.id; ids=ids.filter(Boolean); save(); uiSound('select'); render('[data-cp="change"][data-slot="'+chosen+'"]'); return;
  }
  if(action==='pick'&&isOpen(b.dataset.id)){const id=b.dataset.id;close();onPick(id);}
 }
 function onKey(e) {
  if(!overlay)return;
  e.stopImmediatePropagation();
  const k=e.code||e.key, input=/INPUT|TEXTAREA/.test(e.target?.tagName);
  if(k==='Escape'||(k==='Backspace'&&!input)){e.preventDefault();if(picker!==null){const slot=picker;render('[data-cp="change"][data-slot="'+slot+'"]');}else close();return;}
  if(k==='Tab'){
   const items=[...panel.querySelectorAll('button:not(:disabled),input,summary')].filter(el=>el.offsetParent!==null);
   const i=items.indexOf(document.activeElement),next=(i+(e.shiftKey?-1:1)+items.length)%items.length;e.preventDefault();items[next]?.focus();return;
  }
  if(input){if(k==='ArrowDown'||k==='Enter'){e.preventDefault();panel.querySelector('.cp-option:not(:disabled)')?.focus();}return;}
  const dir={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',KeyW:'up',KeyS:'down',KeyA:'left',KeyD:'right'}[k];
  if(dir){
   e.preventDefault();
   // 나란한 차 카드에서는 같은 동작끼리 이동 (교체 → 옆 차 교체).
   const active=document.activeElement, slot=active?.closest('.cp-slot');
   if(slot&&(dir==='left'||dir==='right')){
    const slots=[...panel.querySelectorAll('.cp-slot')], i=slots.indexOf(slot)+(dir==='left'?-1:1);
    const next=slots[i]?.querySelector('[data-cp="'+active.dataset.cp+'"]:not(:disabled)');
    if(next){next.focus();uiSound('move');return;}
   }
   if(spatialMove(panel,dir))uiSound('move');return;
  }
  if(['Enter','NumpadEnter','Space'].includes(k)){e.preventDefault();document.activeElement?.click();}
 }
 function open(id) {
  if(overlay)return;
  if(carOf(id)&&!ids.includes(id)){if(ids.length===3)ids[2]=id;else ids.push(id);}
  if(!ids.length)ids=[cars[0].id]; save();
  previous=document.activeElement;
  overlay=document.createElement('div'); overlay.className='cp-overlay';
  panel=document.createElement('div'); panel.className='cp-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','cp-title');
  overlay.appendChild(panel); overlay.addEventListener('click',onClick);
  inert=[...host.children].map(el=>[el,el.inert]); for(const [el] of inert)el.inert=true;
  host.appendChild(overlay);host.classList.add('compare-open');onVisibility?.(true);
  window.addEventListener('keydown',onKey,true); render('[data-cp="change"]');uiSound('select');
 }
 return {open,close,updateThumb,get ids(){return [...ids];}};
}
