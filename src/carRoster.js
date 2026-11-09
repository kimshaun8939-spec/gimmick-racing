// 고를 수 있는 차 목록 (data/cars.json)
// 모든 차는 data/car.json(기본 성능)에서 시작하고, 차마다 tune에 적힌 값만 덮어씀
//   - 객체는 안쪽까지 합침, 배열(기어·토크 표 등)은 통째로 바꿈
// 사용법:
//   const cars = await listCars();            // 홈 화면 목록 [{ id, name, tag, desc, stats, look, class }]
//   const classes = await listClasses();      // 차 등급 [{ id, name, desc, color }] (C 루키 → B 스포츠 → A 레전드, 느린 등급부터)
//   const cfg = await loadCarConfig('muscle'); // 게임용 전체 설정 (car.json + tune, cfg.look, cfg.carId)
//   const model = createCarModel(cfg.look);

export const DEFAULT_CAR_ID = 'f1';

const BASE_URL = new URL('../data/car.json', import.meta.url);
const ROSTER_URL = new URL('../data/cars.json', import.meta.url);

let basePromise = null;
let rosterPromise = null;

async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' }); // 차 데이터를 고친 뒤 예전 파일이 캐시에 남지 않게 (서버에 바뀌었는지 물어봄)
  if (!res.ok) throw new Error(`${url} 불러오기 실패`);
  return res.json();
}

function loadBase() {
  if (!basePromise) basePromise = loadJSON(BASE_URL).catch((e) => ((basePromise = null), Promise.reject(e)));
  return basePromise;
}

function loadRoster() {
  if (!rosterPromise) rosterPromise = loadJSON(ROSTER_URL).catch((e) => ((rosterPromise = null), Promise.reject(e)));
  return rosterPromise;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** 깊은 합치기: 객체는 안쪽까지 합치고, 배열·숫자·문자열은 덮어씀. 원본은 안 바뀜 */
export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return clone(over === undefined ? base : over);
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith('_')) continue; // "_설명" 같은 메모는 건너뜀
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v);
  }
  return out;
}

function findCar(roster, id) {
  const cars = roster.cars || [];
  return (
    cars.find((c) => c.id === id) ||
    cars.find((c) => c.id === (roster.default || DEFAULT_CAR_ID)) ||
    cars[0] ||
    null
  );
}

/** 홈 화면용 차 목록 (성능 값 tune은 빼고). class = 차 등급 id (listClasses 참고) */
export async function listCars() {
  const roster = await loadRoster();
  return (roster.cars || []).map(({ id, name, tag, desc, stats, look, class: cls }) => ({
    id,
    name,
    tag,
    desc,
    stats: { ...stats },
    look: clone(look) || {},
    class: cls || null,
  }));
}

/** 차 등급 목록 [{ id, name, desc, color }] — 느린 등급부터 (같은 등급끼리는 실력이 비슷하고, 등급이 오르면 확실히 빨라짐) */
export async function listClasses() {
  const roster = await loadRoster();
  return (roster.classes || []).map((c) => ({ ...c }));
}

/** 이 등급의 차 id 목록 (봇 고르기용). 등급이 없거나 모르면 모든 차 */
export async function carsInClass(classId) {
  const roster = await loadRoster();
  const all = roster.cars || [];
  const same = all.filter((c) => c.class === classId);
  return (same.length ? same : all).map((c) => c.id);
}

/** 차 하나의 전체 설정: car.json + 그 차의 tune. 모르는 id면 기본 차 */
export async function loadCarConfig(id) {
  const [base, roster] = await Promise.all([loadBase(), loadRoster().catch(() => ({ cars: [] }))]);
  const entry = findCar(roster, id);
  const cfg = deepMerge(base, (entry && entry.tune) || {});
  cfg.carId = entry ? entry.id : DEFAULT_CAR_ID;
  cfg.carName = entry ? entry.name : '';
  cfg.carClass = (entry && entry.class) || null;
  cfg.look = clone(entry && entry.look) || { style: 'f1', body: '#e8463a' };
  return cfg;
}
