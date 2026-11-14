// 노을 해안 서킷 (data/sea.json "module": "seaMap") — main.js가 이 파일의 세 함수를 씀
//   buildTrack   → seaTrack.js  (도로·지형·바다·가드레일·레이싱 라인)
//   buildScenery → seaScenery.js (노을 하늘, 항구 마을, 등대섬, 배, 갈매기, 바다 동굴, 출발 게이트…)
//   buildProps   → 물 위 복귀 지점 기록 + seaGates.js (파도 높이·물살 레인·소용돌이(2026-11-15 boat3, 봇도 같은 규칙)·물길 부표·배 물보라·물살 소리)
import * as THREE from 'three';
import { buildSeaTrack } from './seaTrack.js';
import { buildSeaScenery } from './seaScenery.js';
import { createSeaGates } from './seaGates.js';

export function buildTrack(data, scene) {
  return buildSeaTrack(data, scene);
}

export function buildScenery(track, scene) {
  return buildSeaScenery(track, scene);
}

export function buildProps(track, scene) {
  // 소용돌이·물살 레인·파도 높이는 seaGates.js가 모든 배(플레이어 + 봇)에 같은 규칙으로 (boat3 2026-11-15)
  const gates = createSeaGates(track, scene);
  return {
    update(dt, car) {
      gates.update(dt, car);
      // 물길 위에서도 복귀 지점 기록 (R이나 물에 빠졌을 때 물 위 그 자리 근처로 돌아옴. car.js는 땅에서만 기록)
      const ti = car.trackInfo;
      if (ti && car.grounded && car.surface === 'water' && car.pos.y < 0.3 && ti.sample && ti.sample.water && ti.dist < track.width / 2 + 2) car.lastSafeT = ti.t;
    },
    animate(time) {
      gates.animate(time);
    },
    reset() {
      gates.reset();
    },
  };
}
