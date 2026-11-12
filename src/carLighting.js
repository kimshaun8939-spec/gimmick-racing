// 자동차 전용 반사. 도로/풍경의 재질과 scene.environment는 건드리지 않는다.
// 실시간 큐브 카메라 없이 시작할 때 512×256 하늘을 한 번만 흐리게 굽는다.
import * as THREE from 'three';

let reflection = null;
let reflectionTarget = null;

/** main에서 차를 만들기 전에 한 번 호출. 홈/썸네일은 기존 전시실 반사를 쓴다. */
export function initCarLighting(renderer, mapName) {
  if (reflectionTarget) reflectionTarget.dispose();
  reflection = reflectionTarget = null;
  // 도시에는 이미 전용 야경 반사가 있다. 원래 반사를 그대로 사용한다.
  if (mapName === 'neon') return;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const palettes = {
    sea: ['#99b5d2', '#f9ebd9', '#a09b91', '#363b40'],
    moon: ['#202b44', '#8796af', '#424958', '#151922'],
    volcano: ['#52556a', '#c5ac9a', '#75615a', '#28242a'],
    glacier: ['#91b8d8', '#f3f8ff', '#c0cbd5', '#515c6b'],
  };
  const p = palettes[mapName] || ['#91b4d5', '#f0f3f5', '#a2a9ad', '#3d454d'];
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, p[0]);
  sky.addColorStop(0.43, p[1]);
  sky.addColorStop(0.51, p[2]);
  sky.addColorStop(0.69, p[3]);
  sky.addColorStop(1, p[3]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 256);
  // 넓은 구름 띠 두 곳이 곡면을 따라 부드럽게 흐른다. 밝은 점광원은 쓰지 않는다.
  for (const [x, y, w, h, strength] of [[116, 73, 115, 40, 0.7], [400, 93, 76, 30, 0.5]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w, h);
    const glow = ctx.createRadialGradient(0, 0, 0.08, 0, 0, 1);
    glow.addColorStop(0, `rgba(255,255,255,${strength})`);
    glow.addColorStop(0.55, `rgba(245,249,255,${strength * 0.5})`);
    glow.addColorStop(1, 'rgba(245,249,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  const source = new THREE.CanvasTexture(canvas);
  source.colorSpace = THREE.SRGBColorSpace;
  source.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  reflectionTarget = pmrem.fromEquirectangular(source);
  reflection = reflectionTarget.texture;
  source.dispose();
  pmrem.dispose();
}

/** 새로 만든 차의 주요 재질에만 적용. 공유 반사는 개별 차를 지울 때 파기하지 않는다. */
export function applyCarLighting(materials) {
  if (!reflection) return;
  const strengths = { paint: 0.42, accent: 0.3, glass: 0.65, rimMat: 0.55, metal: 0.48, darkMetal: 0.4 };
  for (const [name, intensity] of Object.entries(strengths)) {
    const material = materials[name];
    if (!material) continue;
    material.envMap = reflection;
    material.envMapIntensity = intensity;
    material.needsUpdate = true;
  }
}
