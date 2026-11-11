// 미리 데우기 (렉 줄이기 2, 2026-11-11 perf2)
//
//   문제: 어떤 물체가 화면에 "처음" 나오는 순간 브라우저가 그 재질의 셰이더(그림 그리는 작은 프로그램)를 만들고
//         모양·그림 데이터를 그래픽카드로 올리느라 화면이 멈칫함.
//         예) 그랑프리 우주 포털을 처음 지날 때 0.7초 멈춤, 레이스 첫 화면 4.5초 멈춤, 화산 헬기·용암이 처음 보일 때 20~50 ms
//   해결: 불러오는 화면이 떠 있는 동안
//         1) 숨은 것까지 모든 재질의 셰이더를 미리 만들고 (compileAsync: 가능하면 화면을 안 멈추고 병렬로)
//         2) 모든 물체를 잠깐 보이게 + 화면 밖도 그리게 해서 1픽셀 크기로 한 번 그림 → 모양·그림 데이터가 미리 올라감
//         3) 원래대로 되돌림 (보이기·화면 밖 생략 설정)
//   모양·움직임은 하나도 안 바뀜. ?prewarm=0 이면 끔
//
//   extra: 아직 장면에 없는 물체(나중에 생기는 효과의 본보기 등)를 잠깐 넣어서 같이 데움 (선택)
import * as THREE from 'three';

export async function prewarm(renderer, scene, camera, extra = []) {
  const t0 = performance.now();
  const added = [];
  for (const o of extra) {
    if (o && !o.parent) {
      scene.add(o);
      added.push(o);
    }
  }
  // 조명은 지금 보이는 것만 (보이는 조명 수가 바뀌면 셰이더가 달라져서 데운 게 소용없어짐)
  const lightOff = [];
  scene.traverse((o) => {
    if (!o.isLight) return;
    let vis = true;
    for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
    if (!vis && o.visible) lightOff.push(o);
  });
  // 1) 셰이더 만들기
  try {
    await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 15000))]);
  } catch (e) {
    console.warn('셰이더 미리 만들기 실패 (괜찮음)', e);
  }
  const tCompile = performance.now();
  // 2) 한 번 그리기 (모두 보이게, 1픽셀만)
  const shown = [], culled = [];
  for (const l of lightOff) l.visible = false;
  scene.traverse((o) => {
    if (o.isLight) return;
    if (!o.visible) {
      o.visible = true;
      shown.push(o);
    }
    if (o.frustumCulled && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) {
      o.frustumCulled = false;
      culled.push(o);
    }
  });
  let tRender = performance.now();
  try {
    const sc = renderer.getScissorTest();
    const box = renderer.getScissor(new THREE.Vector4());
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, 1, 1);
    renderer.render(scene, camera);
    renderer.setScissor(box);
    renderer.setScissorTest(sc);
    // 다 올라갈 때까지 기다림 (불러오는 화면 동안)
    const gl = renderer.getContext();
    gl.finish && gl.finish();
  } catch (e) {
    console.warn('미리 그리기 실패 (괜찮음)', e);
  }
  tRender = performance.now() - tRender;
  // 3) 되돌리기
  for (const o of shown) o.visible = false;
  for (const o of culled) o.frustumCulled = true;
  for (const l of lightOff) l.visible = true;
  for (const o of added) scene.remove(o);
  const info = { ms: Math.round(performance.now() - t0), compileMs: Math.round(tCompile - t0), renderMs: Math.round(tRender), programs: renderer.info.programs.length, shown: shown.length };
  return info;
}
