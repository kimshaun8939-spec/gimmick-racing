// 로딩 중 숨은 물체·차원/품질별 셰이더와 GPU 자원을 준비 (launchqa7).
// extra: 나중에 생기는 효과의 본보기를 잠깐 추가할 수 있음. ?prewarm=0이면 main에서 생략.
import * as THREE from 'three';

export async function prewarm(renderer, scene, camera, extra = [], options = {}) {
  const t0 = performance.now(), added = [], shown = [], culled = [], lightOff = [], shadowLights = [];
  const environment = scene.environment;
  const shadowStates = new Map();
  // 움직여 묶음이 풀릴 때의 원래 재질도 셰이더만 준비. 원본 메시/물리용 행렬은 건드리지 않음.
  const compileOnly = [], seen = new Set();
  for (const o of options.originals || []) {
    if (!o.geometry || !o.material || Array.isArray(o.material)) continue;
    const attrs = Object.entries(o.geometry.attributes).map(([k, a]) => k + a.itemSize).sort().join(',');
    const key = o.material.uuid + '|' + o.receiveShadow + '|' + attrs;
    if (seen.has(key)) continue;
    seen.add(key);
    const copy = new THREE.Mesh(o.geometry, o.material);
    copy.receiveShadow = o.receiveShadow;
    compileOnly.push(copy);
  }
  const scissorTest = renderer.getScissorTest(), box = renderer.getScissor(new THREE.Vector4());
  let compileMs = 0, renderMs = 0, variants = 0;
  for (const o of extra) if (o && !o.parent) { scene.add(o); added.push(o); }
  scene.traverse(o => {
    if (!o.isLight) return;
    let visible = true;
    for (let p = o; p; p = p.parent) if (!p.visible) visible = false;
    if (!visible && o.visible) lightOff.push(o);
    if (visible && o.castShadow) shadowLights.push(o);
  });
  // 자동 품질이 이미 그림자를 끄고 시작했어도, 나중에 회복할 때 쓰는 셰이더까지 준비.
  if (options.shadowLight && !shadowLights.includes(options.shadowLight)) shadowLights.push(options.shadowLight);
  for (const light of shadowLights) shadowStates.set(light, light.castShadow);
  async function compile() {
    let timer;
    const start = performance.now();
    try {
      for (const copy of compileOnly) scene.add(copy);
      return await Promise.race([renderer.compileAsync(scene, camera).then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, 15000 - (performance.now() - t0))); })]);
    } finally {
      for (const copy of compileOnly) scene.remove(copy);
      clearTimeout(timer);
      compileMs += performance.now() - start;
    }
  }
  try {
    for (const light of lightOff) light.visible = false;
    scene.traverse(o => {
      if (o.isLight) return;
      if (!o.visible) { o.visible = true; shown.push(o); }
      if (o.frustumCulled && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) { o.frustumCulled = false; culled.push(o); }
    });
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, 1, 1);
    // 네온 반사의 켬/끔과 그림자 켬/끔을 미리 준비해 주행 중 품질 변경 때도 멈칫을 줄임.
    const envs = environment ? [environment, null] : [environment];
    warming: for (const env of envs) {
      scene.environment = env;
      for (const shadows of shadowLights.length ? [true, false] : [true]) {
        for (const light of shadowLights) light.castShadow = shadows;
        if (!await compile()) break warming;
        const start = performance.now();
        renderer.render(scene, camera);
        renderMs += performance.now() - start;
        variants++;
      }
    }
    const gl = renderer.getContext();
    if (gl.finish) gl.finish();
  } catch (err) {
    console.warn('미리 데우기 실패 (게임은 계속해요)', err);
  } finally {
    scene.environment = environment;
    for (const [light, castShadow] of shadowStates) light.castShadow = castShadow;
    for (const o of shown) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
    for (const light of lightOff) light.visible = true;
    for (const o of added) scene.remove(o);
    renderer.setScissor(box);
    renderer.setScissorTest(scissorTest);
  }
  return { ms: Math.round(performance.now() - t0), compileMs: Math.round(compileMs), renderMs: Math.round(renderMs), programs: renderer.info.programs.length, shown: shown.length, variants };
}
