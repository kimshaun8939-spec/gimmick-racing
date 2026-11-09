// 노을 해안 서킷 (data/sea.json "module": "seaMap") — main.js가 이 파일의 세 함수를 씀
//   buildTrack   → seaTrack.js  (도로·지형·바다·가드레일·레이싱 라인)
//   buildScenery → seaScenery.js (노을 하늘, 항구 마을, 등대섬, 배, 갈매기, 바다 동굴, 출발 게이트…)
//   buildProps   → 물 위 기믹 (소용돌이, 물 위 복귀 지점 기록)
import * as THREE from 'three';
import { buildSeaTrack } from './seaTrack.js';
import { buildSeaScenery } from './seaScenery.js';

export function buildTrack(data, scene) {
  return buildSeaTrack(data, scene);
}

export function buildScenery(track, scene) {
  return buildSeaScenery(track, scene);
}

export function buildProps(track, scene) {
  const data = track.data;
  // 소용돌이 (data.whirlpools [{p, offset, r, pull}]): 물길 옆 바다에서 배를 살짝 끌어당기고 돌림. 모습은 seaScenery.js
  const pools = (data.whirlpools || []).map((w) => {
    const s = track.sampleAt(track.tOfP(w.p));
    const c = track.surf(s, w.offset || 0, 0, new THREE.Vector3());
    return { x: c.x, z: c.z, r: w.r || 26, pull: w.pull ?? 5, spin: w.spin ?? 7 };
  });
  track.whirlpools = pools;
  return {
    update(dt, car) {
      // 물길 위에서도 복귀 지점 기록 (R이나 물에 빠졌을 때 물 위 그 자리 근처로 돌아옴. car.js는 땅에서만 기록)
      const ti = car.trackInfo;
      if (ti && car.grounded && car.surface === 'water' && car.pos.y < 0.3 && ti.sample && ti.sample.water && ti.dist < track.width / 2 + 2) car.lastSafeT = ti.t;
      // 소용돌이: 가까울수록 세게 안쪽으로 끌고 옆으로 돌림 (물 위에서만)
      if (car.surface !== 'water' || !car.grounded) return;
      for (const p of pools) {
        const dx = p.x - car.pos.x, dz = p.z - car.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > p.r || d < 0.5) continue;
        const k = 1 - d / p.r;
        // 안쪽으로 + 시계 반대로 도는 물살
        const ax = (dx / d) * p.pull * k + (-dz / d) * p.spin * k;
        const az = (dz / d) * p.pull * k + (dx / d) * p.spin * k;
        // 물살이 배를 옮김 (속도 ax, az m/s) + 뱃머리가 조금씩 돌아감
        car.pos.x += ax * dt;
        car.pos.z += az * dt;
        car.fwd.applyAxisAngle(car.up, k * 0.5 * dt);
      }
    },
    animate() {},
    reset() {},
  };
}
