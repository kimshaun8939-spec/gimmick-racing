// 달 중력 기지 맵 모듈 (data/moon.json 의 "module": "moonMap" → main.js가 이 파일을 불러 씀)
//   buildTrack   → moonTrack.js   (도로·지형·점프·코르크스크루·중력 구역)
//   buildScenery → moonScenery.js (검은 하늘·별·지구·달 기지 건물·크레이터 바위·출발 게이트·중력 구역 문)
//   buildProps   → moonProps.js   (중력 표시 HUD·저중력 먼지·구역 알림)
import { buildMoonTrack } from './moonTrack.js';
import { buildMoonScenery } from './moonScenery.js';
import { buildMoonProps } from './moonProps.js';

export const buildTrack = (data, scene) => buildMoonTrack(data, scene);
export const buildScenery = (track, scene) => buildMoonScenery(track, scene);
export const buildProps = (track, scene) => buildMoonProps(track, scene);
