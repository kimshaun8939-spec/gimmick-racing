// 변신 연습장 맵 모듈 (data/starter.json 의 "module": "starterMap" → main.js가 이 파일을 불러 씀)
//   처음 온 사람의 첫 레이스: 한 바퀴에 가속 모드 · 배 · 비행 · 점프를 다 맛보는 짧은 코스 (2바퀴, 1~2분)
//   buildTrack   → starterTrack.js   (도로·연석·석호 물길·선착장·활주로·착륙장·점프대·풀밭 지형)
//   buildScenery → starterScenery.js (맑은 하늘·언덕·관중석·출발 게이트·놀이공원·석호 배·비행장·안내판 — 풍경)
//   buildProps   → starterProps.js   (비행 고리·상승 기류(gpProps 재사용) + 기믹 안내 알림)
//   ?stscenery=0 이면 풍경 없이 하늘색·빛만 (트랙 시험용). 풍경 만들기가 오류로 멈춰도 같은 기본 풍경으로 계속 (경고만)
import * as THREE from 'three';
import { buildStarterTrack } from './starterTrack.js';
import { buildStarterScenery } from './starterScenery.js';
import { buildStarterProps } from './starterProps.js';
import { batchStatic } from './staticBatch.js';

/** 풍경이 없을 때 쓰는 가장 단순한 풍경: 맑은 하늘색·안개·빛 (glacierMap과 같은 모양으로 돌려줌) */
function basicScenery(track, scene) {
  const FOG = new THREE.Color('#bfe3ff');
  scene.background = FOG.clone();
  scene.fog = new THREE.Fog(FOG.clone(), 380, 2200);
  const colliders = [];
  return {
    colliders,
    collideCar() {},
    addCollider(x, z, r, y0, y1) {
      colliders.push({ x, z, r, y0, y1 });
    },
    collidersNear: () => [],
    animate() {},
  };
}

export function buildTrack(data, scene) {
  const track = buildStarterTrack(data, scene);
  if (new URLSearchParams(location.search).get('batch') !== '0') {
    // 원래 도로·레이·충돌 배열은 그대로 두고 보이는 정지 메시만 넓은 칸으로 합친다.
    batchStatic([track.group], { cellFor: () => 480 });
  }
  return track;
}
export function buildScenery(track, scene) {
  if (new URLSearchParams(location.search).get('stscenery') === '0') return basicScenery(track, scene);
  try {
    return buildStarterScenery(track, scene);
  } catch (err) {
    console.warn('변신 연습장 풍경 만들기 실패 → 기본 풍경으로', err);
    return basicScenery(track, scene);
  }
}
export const buildProps = (track, scene) => buildStarterProps(track, scene);
