// 빙하 하이웨이 맵 모듈 (data/glacier.json 의 "module": "glacierMap" → main.js가 이 파일을 불러 씀)
//   buildTrack   → glacierTrack.js   (넓은 도로·연석·가드레일·얼음 터널 벽·다리·얼어붙은 강·눈 지형)
//   buildScenery → glacierScenery.js (오로라 하늘·눈산·터널 지붕·장식 — 풍경 담당)
//   buildProps   → glacierProps.js   (내리는 눈·강에 빠졌을 때 복귀)
//   ?glscenery=0 이면 풍경 없이 하늘색·빛만 (트랙 시험용). 풍경 만들기가 오류로 멈춰도 같은 기본 풍경으로 계속 (경고만)
import * as THREE from 'three';
import { buildGlacierTrack } from './glacierTrack.js';
import { buildGlacierScenery } from './glacierScenery.js';
import { buildGlacierProps } from './glacierProps.js';

/** 풍경이 없을 때 쓰는 가장 단순한 풍경: 밤하늘 색·안개·빛 (volcanoScenery와 같은 모양으로 돌려줌) */
function basicScenery(track, scene) {
  const FOG = new THREE.Color('#1b2a44');
  scene.background = FOG.clone();
  scene.fog = new THREE.Fog(FOG.clone(), 350, 2600);
  scene.traverse((o) => {
    if (o.isHemisphereLight) {
      o.color.set('#bcd6ff');
      o.groundColor.set('#33445e');
      o.intensity = 1.1;
    } else if (o.isDirectionalLight) {
      o.color.set('#dbe8ff');
      o.intensity = 1.9;
    }
  });
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

export const buildTrack = (data, scene) => buildGlacierTrack(data, scene);
export function buildScenery(track, scene) {
  if (new URLSearchParams(location.search).get('glscenery') === '0') return basicScenery(track, scene);
  try {
    return buildGlacierScenery(track, scene);
  } catch (err) {
    console.warn('빙하 풍경 만들기 실패 → 기본 풍경으로', err);
    return basicScenery(track, scene);
  }
}
export const buildProps = (track, scene) => buildGlacierProps(track, scene);
