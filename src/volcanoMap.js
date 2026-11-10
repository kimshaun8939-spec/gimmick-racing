// 화산 지대 맵 모듈 (data/volcano.json 의 "module": "volcanoMap" → main.js가 이 파일을 불러 씀)
//   buildTrack   → volcanoTrack.js   (도로·폭·낭떠러지·바위벽·용암 바다·점프·분화구)
//   buildScenery → volcanoScenery.js (붉은 하늘·화산·연기·바위·출발 게이트·표지판)
//   buildProps   → volcanoProps.js   (낭떠러지 추락 감지·불티·화산재·열기)
import { buildVolcanoTrack } from './volcanoTrack.js';
import { buildVolcanoScenery } from './volcanoScenery.js';
import { buildVolcanoProps } from './volcanoProps.js';

export const buildTrack = (data, scene) => buildVolcanoTrack(data, scene);
export const buildScenery = (track, scene) => buildVolcanoScenery(track, scene);
export const buildProps = (track, scene) => buildVolcanoProps(track, scene);
