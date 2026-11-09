// 정글 유적 맵 모듈 (data/jungle.json 의 "module": "jungleMap")
//   main.js가 buildTrack → buildScenery → buildProps 순서로 부름
//   코스: jungleTrack.js (gpTrack.js 복사본), 풍경: jungleScenery.js, 지하 세계: jungleWorld.js, 소품: jungleProps.js
import { buildJungleTrack } from './jungleTrack.js';
import { buildJungleScenery } from './jungleScenery.js';
import { buildJungleProps } from './jungleProps.js';

export function buildTrack(data, scene) {
  return buildJungleTrack(data, scene);
}

export function buildScenery(track, scene) {
  return buildJungleScenery(track, scene);
}

export function buildProps(track, scene) {
  return buildJungleProps(track, scene);
}
