// 네온 시티 맵 모듈 (data/neon.json 의 "module": "neonMap")
//   main.js가 buildTrack / buildScenery / buildProps 를 불러 씀
//   - 코스: neonTrack.js (도로·방호벽·자석 튜브·글리치 구간·저중력)
//   - 풍경: neonScenery.js (밤 도시·빌딩·네온 간판·홀로그램·비·관중석·출발 게이트·글리치 차원)
//   - 소품: neonProps.js (부딪히면 날아가는 라바콘·상자, 배달 드론, 결승선 홀로그램 쇼, 길가 관중)
//     소품 부딪힘은 scenery.collideCar(car)에서 함 → main.js(플레이어)와 raceSystem(봇) 모두 부르기 때문
import { buildNeonTrack } from './neonTrack.js';
import { buildNeonScenery } from './neonScenery.js';
import { buildNeonProps } from './neonProps.js';

let propsRef = null; // buildProps가 만든 소품 (scenery.collideCar가 씀)

export function buildTrack(data, scene) {
  propsRef = null;
  return buildNeonTrack(data, scene);
}

export function buildScenery(track, scene) {
  const sc = buildNeonScenery(track, scene);
  const orig = sc.collideCar;
  sc.collideCar = (car) => {
    orig(car);
    if (propsRef) propsRef.hit(car);
  };
  return sc;
}

export function buildProps(track, scene) {
  propsRef = buildNeonProps(track, scene);
  return propsRef;
}
