// night-meta · 데이터만 있는 업적/상점. Three.js·서버 의존성 없음.
import { LESSONS } from './academyStore.js';
export const COIN = { name: '피트 코인', icon: '⬡', short: 'PC' };
export const CATEGORIES = [ ['all','전체','✦'], ['drive','주행','🏎️'], ['race','레이스','🏁'], ['map','맵 탐험','🗺️'], ['gimmick','기믹','✨'], ['academy','아카데미','🎓'], ['collect','수집','🎨'], ['secret','숨은 업적','🔮'] ];
const medals = ['동','은','금'];
export const ACHIEVEMENTS = [];
function series(id, category, name, metric, goals, unit, icon, title) {
  goals.forEach((goal,i) => ACHIEVEMENTS.push({ id: id+'-'+(i+1), family:id, category, name:name+' '+['I','II','III'][i], metric, goal, unit, icon, tier:i+1, medal:medals[i], coins:[45,110,260][i], xp:[25,60,140][i], title:i===2?title:null }));
}
series('road','drive','끝없이 달려요','distance',[5000,50000,250000],'m','🛣️','로드 트래블러');
series('pace','drive','바람보다 빠르게','maxSpeed',[150,220,280],'km/h','⚡','스피드 스타');
series('apex','drive','코너의 정석','apex',[10,100,500],'회','↪','에이펙스 장인');
series('launch','drive','불이 꺼지는 순간','perfectLaunch',[1,10,30],'회','🚦','번개 반응');
series('finish','race','체커기를 향해','races',[1,15,75],'회','🏁','완주의 달인');
series('podium','race','시상대 단골','podiums',[1,10,40],'회','🥈','포디움 헌터');
series('win','race','가장 먼저 도착','wins',[1,5,25],'회','🏆','체커 챔피언');
series('hard','race','진짜 승부사','hardWins',[1,5,15],'회','👑','마스터 브레이커');
series('drift','gimmick','옆으로도 질주','driftDistance',[200,2000,15000],'m','🌀','드리프트 마에스트로');
series('sea','gimmick','파도 위의 레이서','boatDistance',[300,3000,20000],'m','🚤','파도 지배자');
series('flight','gimmick','하늘도 서킷','flyDistance',[200,2000,12000],'m','✈️','스카이 캡틴');
series('form','gimmick','변신은 나의 힘','transforms',[5,50,250],'회','🔧','메타모포시스');
series('drs','gimmick','날개를 열어요','drsSeconds',[5,60,300],'초','🟩','오픈 윙');
series('draft','gimmick','바람의 길','draftSeconds',[10,120,600],'초','💨','윈드 체이서');
series('jump','gimmick','지면을 떠나','jumpSeconds',[3,30,180],'초','🪽','에어 타임');
series('lesson','academy','배움의 레이싱','lessons',[1,6,LESSONS.length],'개','📖','드라이빙 스콜라');
series('gold','academy','금빛 성적표','goldLessons',[1,6,LESSONS.length],'개','🎓','아카데미 수석');
series('collector','collect','나만의 차고','purchases',[1,5,15],'개','🎨','피트 큐레이터');
series('explorer','map','모든 길을 달려','uniqueMaps',[2,5,8],'곳','🧭','월드 투어러');
for (const [id,name,icon] of [['glacier','빙하','❄️'],['sea','노을 해안','🌊'],['jungle','정글','🌿'],['neon','네온 시티','🌃'],['foundry','파운드리','⚙️'],['moon','달 기지','🌙'],['gp','그랑프리','🌌'],['volcano','화산','🌋']]) series('map-'+id,'map',name+'의 발자취','map:'+id,[1,5,20],'회',icon,name+' 정복자');
for (const a of [
 {id:'secret-clean',name:'흠집 없는 여정',metric:'cleanRaces',goal:1,hint:'벽 충돌·복귀 없이 완주해 보세요.',title:'클린 드라이버'},
 {id:'secret-triple',name:'세 가지 세계',metric:'threeForms',goal:1,hint:'한 레이스에서 땅·물·하늘을 모두 달려 보세요.',title:'트리플 모드'},
 {id:'secret-comeback',name:'끝까지 포기하지 마',metric:'comebacks',goal:1,hint:'한때 꼴찌였다가 시상대에 올라 보세요.',title:'역전의 주인공'},
 {id:'secret-s',name:'마스터의 증명',metric:'licenseS',goal:1,hint:'아카데미에서 가장 높은 라이선스를 따 보세요.',title:'S 마스터'},
 {id:'secret-night',name:'별이 빛나는 질주',metric:'nightFinishes',goal:1,hint:'밤 10시부터 새벽 5시 사이에 완주해 보세요.',title:'나이트 레이서'},
 {id:'secret-exit',name:'미끄러짐의 미학',metric:'perfectDrifts',goal:5,hint:'좋은 각도로 드리프트를 마무리해 보세요.',title:'사이드웨이즈'}
]) ACHIEVEMENTS.push({...a,category:'secret',family:a.id,unit:'회',icon:'🔮',tier:3,medal:'금',coins:180,xp:100,secret:true});
// 월드 투어 금메달은 F1 클래식 복장도 증정. 레벨 조건은 유지되어 Lv5부터 착용.
ACHIEVEMENTS.find(a=>a.id==='explorer-3').costume='f1-heritage';
export const CELEBRATIONS = [
 {id:'stock',name:'클래식 체커',desc:'깔끔한 흑백 피니시',price:0,colors:['#ffffff','#9ca9bc'],icon:'🏁'},
 {id:'sunrise',name:'골든 피니시',desc:'황금빛 종이꽃과 빛의 링',price:180,colors:['#ffd45a','#ff975a','#fff1b0'],icon:'☀️'},
 {id:'aurora',name:'오로라 피니시',desc:'민트와 보라로 물드는 결승선',price:320,colors:['#67f6c2','#b592ff','#8eeaff'],icon:'💠'},
 {id:'petal',name:'벚꽃 피니시',desc:'분홍빛 꽃잎으로 완주 축하',price:450,colors:['#ffb4da','#fff0f5','#ed71a8'],icon:'🌸'},
 {id:'cosmos',name:'스타라이트',desc:'별빛이 쏟아지는 피니시',price:600,colors:['#bda6ff','#67d8ff','#ffffff'],icon:'🌌'}
];
export const costumePrice = c => 160 + Math.ceil((Number(c.unlockLevel)||5)/5)*80;
export const paintPrice = p => !p || p.license || !p.level ? 0 : 80+Number(p.level)*20;
export const GOAL_POOLS = {
 daily:[
 {metric:'distance',goal:5000,name:'오늘의 드라이브',unit:'m',icon:'🛣️'},
 {metric:'races',goal:2,name:'두 번의 체커기',unit:'회',icon:'🏁'},
 {metric:'driftDistance',goal:500,name:'사이드 스텝',unit:'m',icon:'🌀'},
 {metric:'podiums',goal:1,name:'시상대에 서기',unit:'회',icon:'🥉'},
 {metric:'boatDistance',goal:800,name:'파도 산책',unit:'m',icon:'🚤'},
 {metric:'academySessions',goal:1,name:'오늘도 한 가지 배움',unit:'개',icon:'🎓'},
 {metric:'draftSeconds',goal:20,name:'바람 따라 달리기',unit:'초',icon:'💨'},
 {metric:'apex',goal:12,name:'코너의 리듬',unit:'회',icon:'↪'}
 ],
 weekly:[
 {metric:'distance',goal:50000,name:'주간 로드 트립',unit:'m',icon:'🧭'},
 {metric:'races',goal:8,name:'레이스 위크',unit:'회',icon:'🏁'},
 {metric:'podiums',goal:3,name:'시상대 수집가',unit:'회',icon:'🏆'},
 {metric:'driftDistance',goal:3000,name:'드리프트 위크',unit:'m',icon:'🌀'},
 {metric:'boatDistance',goal:5000,name:'코스트 투어',unit:'m',icon:'🌊'},
 {metric:'apex',goal:80,name:'코너 마스터 클래스',unit:'회',icon:'↪'}
 ]
};
