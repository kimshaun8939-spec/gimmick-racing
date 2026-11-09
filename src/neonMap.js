// 네온 시티 맵 모듈 (data/neon.json 의 "module": "neonMap")
//   main.js가 buildTrack / buildScenery / buildProps 를 불러 씀
//   - 코스: neonTrack.js (도로·방호벽·자석 튜브·글리치 구간·저중력)
//   - 풍경: neonScenery.js (밤 도시·빌딩·네온 간판·홀로그램·비·관중석·출발 게이트·글리치 차원)
//   - 소품: 지금은 움직이는 소품 없음 (드론·홀로그램 움직임은 풍경 animate에서)
import { buildNeonTrack } from './neonTrack.js';
import { buildNeonScenery } from './neonScenery.js';

export function buildTrack(data, scene) {
  return buildNeonTrack(data, scene);
}

export function buildScenery(track, scene) {
  return buildNeonScenery(track, scene);
}

export function buildProps(track, scene) {
  void track;
  void scene;
  return {
    group: null,
    update() {},
    reset() {},
    animate() {},
    props: [],
    cubes: [],
    barricade: null,
    barricades: [],
    rings: [],
    stats: {},
  };
}
