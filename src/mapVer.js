// 코스 버전 (mapver, 2026-11-24): 코스 모양이 바뀐 맵은 기록·고스트·순위표를 예전 코스와 나눔
//   data/maps.json 맵마다 "ver" (없으면 1). ver 2 이상이면 저장 키 = '<맵>@<ver>' (예 'glacier@2'),
//   ver 1이면 맵 id 그대로 (예전과 완전히 같음).
//   이 키를 쓰는 곳: 로컬 기록 gimmick.records·구간 gimmick.sectors·고스트 gimmick.ghost.<키>.<차>·cornerBest:<키>:…·
//     온라인 순위표/올리기/친구 고스트(서버 map 칸, 24글자까지 = 서버 SQL 그대로)·불러오는 화면 최고 기록.
//   맵 id 그대로 쓰는 곳 (바꾸지 않음): 업적·XP·코인·미션(gimmick:raceDone의 map), 챔피언십 순서·결과, 주소 ?map=, 마지막 선택.
//   예전 코스 기록은 지우지 않음 (records.legacy()로 홈 기록 화면에 작게만 보이고 비교·순위에는 안 씀).
//   BUILTIN = maps.json을 아직 못 읽었거나 못 읽을 때 쓰는 값 → maps.json의 ver를 올리면 여기도 같이 올릴 것.
//   시험: 주소 &mapver=0 = 버전 나누기 끔 (모든 맵 예전 키)
const BUILTIN = { glacier: 2, mirage: 2, foundry: 2 };
const vers = { ...BUILTIN };
let off = false;
try {
  off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mapver') === '0';
} catch {}

/** maps.json 목록(loadMaps가 읽은 그대로)으로 버전 표를 맞춤. extra(기본값으로 채운 카드)는 건드리지 않음 */
export function setMapVers(list) {
  for (const m of list || []) if (m && typeof m.id === 'string' && !m.extra) vers[m.id] = Math.max(1, Math.floor(+m.ver) || 1);
}
/** 키에서 맵 id ('glacier@2' → 'glacier', 'gp' → 'gp') */
export const baseMap = (key) => (typeof key === 'string' ? key.replace(/@\d+$/, '') : key);
/** 키의 코스 버전 ('glacier@2' → 2, 'glacier' → 1) */
export function keyVer(key) {
  const m = typeof key === 'string' ? /@(\d+)$/.exec(key) : null;
  return m ? +m[1] : 1;
}
/** 지금 코스 버전 (맵 id 또는 키) */
export const mapVer = (id) => (off ? 1 : vers[baseMap(id)] || 1);
/** 기록 저장 키: 버전 1 = 맵 id 그대로, 2 이상 = '맵@ver'. 이미 키면 그대로 (두 번 불러도 같음) */
export function recKey(id) {
  if (typeof id !== 'string' || !id || /@\d+$/.test(id)) return id;
  const v = mapVer(id);
  return v > 1 ? `${id}@${v}` : id;
}
/** 이 키가 지금 코스의 키인가 (예전 코스 키면 false) */
export const isCurrentKey = (key) => recKey(baseMap(key)) === key;
