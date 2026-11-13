// 백미러 (사용자 요청 2026-11-12 "다른 사람이 가까이 오면 뒤에 백미러가 자동으로 쳐져서 작은 화면에 보이게")
//
//   다른 차(봇·온라인 상대)가 바로 뒤에 붙으면 화면 위 가운데에 작은 백미러가 위에서 아래로 내려오고,
//   아무도 없으면 조금 뒤에 다시 올라가 숨음. 설정 '백미러' = 자동(기본) / 항상 / 끔 (settings.values.mirror)
//
//   그리는 법 (렉 안 나게):
//   - 따로 그림판(render target)을 쓰지 않고 게임 화면 캔버스의 작은 칸(viewport + scissor)에 한 번 더 그림
//     → 셰이더가 게임 화면과 똑같아서 새 셰이더를 만들지 않음 (멈칫 없음, prewarm 그대로)
//   - 그림자 지도는 방금 게임 화면이 만든 것을 그대로 씀 (shadowMap.autoUpdate 잠시 끔 → 그림자 다시 안 그림)
//   - 물체 위치 계산(updateMatrixWorld)도 게임 화면이 이미 했으니 건너뜀
//   - 보일 때만 그림 (안 보이면 비용 0). 칸이 작아서 픽셀 비용은 거의 없음, 비용은 그림 호출 수 (뒤쪽만 보여서 화면의 약 절반 이하)
//   - 거울처럼 좌우를 뒤집음: 투영 행렬의 x를 뒤집고, 그 때문에 앞/뒷면이 바뀌는 것을 setMaterial에서 되돌림
//   - 내 차 모델·이름표(글자가 뒤집혀 보임)는 거울 그릴 때만 잠깐 숨김
//
//   main.js: createMirror({...}) 하나 + 매 프레임 게임 화면을 그린 바로 뒤 mirror.frame(dt, { phase, intro, override })
//   모양은 src/mirror.css (이 파일이 스스로 불러옴). 숨는 때: 출발 신호·그리드 소개·리플레이·결과 화면·ESC 메뉴·HUD 숨김·상대 없는 레이스
import * as THREE from 'three';
import { settings, graphicsTier } from './settings.js';

export const MIRROR_CFG = {
  showM: 35, // 이 거리(m, 코스를 따라) 안에 뒤차가 있으면 내려옴
  showSec: 1.2, // 또는 내 속도로 1.2초 거리 안 (빠를수록 일찍), 단 maxM까지
  maxM: 60,
  hideExtraM: 12, // 보이는 중에는 이만큼 더 멀어져야 '없음' (깜빡임 방지)
  linger: 1.5, // 아무도 없어진 뒤 이 시간(초) 뒤에 올라감
  inDur: 0.24, // 내려오는 시간
  outDur: 0.3, // 올라가는 시간
  fovV: 18, // 세로 시야각 (가로는 칸 비율로 약 70°)
  near: 0.3,
  far: 1400, // 하늘 돔이 잘리지 않을 만큼
  eye: [0, 1.12, 0.1], // 눈 위치 (차 기준: 오른쪽, 위, 앞)
  look: 26, // 이만큼 뒤(m)를 바라봄
  fullM: 9, // 이보다 가까운 상대 차는 진짜 모델로 (멀면 한 덩어리 모형 = 그림 호출 1번)
  halfRate: true, // 다 내려온 뒤에는 두 프레임에 한 번만 장면을 그림 (사이 프레임은 복사본, ?mirrorrate=1이면 매 프레임)
  lookDown: 1.0, // 바라보는 점 높이 (차 기준 위, 낮을수록 아래를 봄)
};

export function createMirror({ renderer, scene, car, model, raceSys, opponents, track }) {
  const C = MIRROR_CFG;
  // 모양 (mirror.css): 하위 주소(/gimmick-racing/)에서도 되게 이 파일 기준 상대 경로
  try {
    if (!document.getElementById('mirrorCss')) {
      const link = document.createElement('link');
      link.id = 'mirrorCss';
      link.rel = 'stylesheet';
      link.href = new URL('./mirror.css', import.meta.url).href;
      document.head.appendChild(link);
    }
  } catch {}
  const el = document.createElement('div');
  el.id = 'rearMirror';
  el.className = 'hud';
  el.innerHTML = '<div class="rm-sheen"></div><div class="rm-tag"><span class="rm-gap"></span><span class="rm-name"></span></div>';
  document.body.appendChild(el);
  const tagEl = el.querySelector('.rm-tag');
  const gapEl = el.querySelector('.rm-gap');
  const nameEl = el.querySelector('.rm-name');

  const cam = new THREE.PerspectiveCamera(C.fovV, 4, C.near, C.far);
  cam.matrixAutoUpdate = true;
  const _eye = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _v = new THREE.Vector4();
  const _s = new THREE.Vector4();

  const st = { k: 0, want: false, active: false, noneT: 99, near: null, tagT: 0, hudT: 0, hudOk: true, rect: null, rectDirty: true, lastTag: '', calls: 0, ms: 0, renders: 0, reused: 0, flip: false, buildMs: 0 };
  addEventListener('resize', () => (st.rectDirty = true));

  // --- 상대 차 한 덩어리 모형 (거울 전용, 렉 줄이기) ---
  //   봇 차 한 대 = 그림 호출 약 20~30번 → 거울에 5대면 100~150번. 그래서 거울에서는 차 부품 전부를 한 메시로 합친 모형을 씀 (1번)
  //   모양·색은 진짜 모델 그대로 (부품을 그대로 합침, 바퀴만 안 돎). 재질은 차가 이미 쓰는 공용 굽기 재질(staticBatch pbrBake)
  //   → 새 셰이더 없음. 가까운 차(C.fullM 안)·배/비행 변신 중인 차는 진짜 모델. ?mirrorproxy=0이면 끔
  const PROXY_OFF = /[?&]mirrorproxy=0/.test(location.search);
  const proxies = new Map(); // entry → { mesh, tris } 또는 null(못 만듦)
  const _inv = new THREE.Matrix4(), _mm = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _p = new THREE.Vector3();
  function buildProxy(e) {
    const root = e.model && e.model.root;
    if (!root) return null;
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    let mat = null, recv = false;
    const parts = [];
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry || !o.geometry.attributes.position || !o.geometry.attributes.normal) return;
      for (let q = o; q && q !== root; q = q.parent) if (!q.visible) return; // 숨은 부품(변신용)은 뺌
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      if (m.userData && m.userData.pbrBake && o.geometry.attributes.bakeRM) {
        if (!mat) (mat = m), (recv = o.receiveShadow);
        parts.push([o, true]);
      } else if (m.isMeshStandardMaterial && !m.transparent && !m.map && !m.alphaMap && !m.emissiveMap && (!o.geometry.attributes.color || m.vertexColors)) parts.push([o, false]); // 색만 구운 묶음(vertexColors)도
    });
    if (!mat || !parts.length) return null;
    let nv = 0, ni = 0;
    for (const [o] of parts) {
      const g = o.geometry;
      nv += g.attributes.position.count;
      ni += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), rm = new Float32Array(nv * 2), em = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vb = 0, ib = 0;
    for (const [o, baked] of parts) {
      const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, I = g.index, m = o.material;
      _mm.multiplyMatrices(_inv, o.matrixWorld);
      _nm.getNormalMatrix(_mm);
      const flip = _mm.determinant() < 0; // 거울로 뒤집힌 부품: 삼각형 순서를 바꿔야 앞면이 맞음
      const cnt = P.count;
      const C3 = baked ? g.attributes.color : null, RM = baked ? g.attributes.bakeRM : null, EM = baked ? g.attributes.bakeEm : null;
      const ei = m.emissiveIntensity ?? 1;
      for (let i = 0; i < cnt; i++) {
        const w = vb + i;
        _p.fromBufferAttribute(P, i).applyMatrix4(_mm);
        pos[w * 3] = _p.x, pos[w * 3 + 1] = _p.y, pos[w * 3 + 2] = _p.z;
        _p.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
        nor[w * 3] = _p.x, nor[w * 3 + 1] = _p.y, nor[w * 3 + 2] = _p.z;
        if (baked) {
          col[w * 3] = C3.getX(i), col[w * 3 + 1] = C3.getY(i), col[w * 3 + 2] = C3.getZ(i);
          rm[w * 2] = RM.getX(i), rm[w * 2 + 1] = RM.getY(i);
          em[w * 3] = EM.getX(i), em[w * 3 + 1] = EM.getY(i), em[w * 3 + 2] = EM.getZ(i);
        } else {
          const VC = m.vertexColors ? g.attributes.color : null;
          col[w * 3] = m.color.r * (VC ? VC.getX(i) : 1), col[w * 3 + 1] = m.color.g * (VC ? VC.getY(i) : 1), col[w * 3 + 2] = m.color.b * (VC ? VC.getZ(i) : 1);
          rm[w * 2] = m.roughness, rm[w * 2 + 1] = m.metalness;
          em[w * 3] = m.emissive.r * ei, em[w * 3 + 1] = m.emissive.g * ei, em[w * 3 + 2] = m.emissive.b * ei;
        }
      }
      const n = I ? I.count : cnt;
      for (let i = 0; i < n; i += 3) {
        const a = I ? I.getX(i) : i, b = I ? I.getX(i + 1) : i + 1, c = I ? I.getX(i + 2) : i + 2;
        idx[ib++] = vb + a;
        idx[ib++] = vb + (flip ? c : b);
        idx[ib++] = vb + (flip ? b : c);
      }
      vb += cnt;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('bakeRM', new THREE.BufferAttribute(rm, 2));
    geo.setAttribute('bakeEm', new THREE.BufferAttribute(em, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'mirrorProxy';
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = recv;
    mesh.visible = false; // 거울을 그릴 때만 잠깐 보임
    scene.add(mesh);
    return { mesh, tris: ni / 3 };
  }
  function proxyOf(e) {
    if (PROXY_OFF) return null;
    if (!proxies.has(e)) {
      let p = null;
      const t0 = performance.now();
      try {
        p = buildProxy(e);
        st.buildMs += performance.now() - t0;
      } catch (err) {
        console.warn('백미러 모형 만들기 실패 (진짜 모델로 그림)', err);
      }
      proxies.set(e, p);
    }
    return proxies.get(e);
  }
  // 불러올 때 미리 만듦 (레이스 중 멈칫 없게, prewarm이 모양도 미리 올림). 나중에 들어온 온라인 상대는 처음 보일 때
  for (const e of opponents.entries) if (e.view && e.view.mode === 'normal' && !e.view.form) proxyOf(e);
  if (opponents.onChange) {
    opponents.onChange((what, e) => {
      if (what === 'add') {
        if (e.view && e.view.mode === 'normal' && !e.view.form) proxyOf(e); // 온라인 상대: 들어올 때 (대기실·출발 전) 미리
        return;
      }
      if (what !== 'remove') return;
      const p = proxies.get(e);
      if (p) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
      }
      proxies.delete(e);
    });
  }

  const L = (track && track.length) || 1;
  /** 바로 뒤에 있는 가장 가까운 상대: { e, d(m), gap(초) } */
  function findBehind() {
    const me = raceSys.me;
    if (!me) return null;
    let best = null;
    for (const e of opponents.entries) {
      if (!e.view || !e.view.pos) continue;
      let diff = me.progress - e.progress;
      if (!isFinite(diff)) continue;
      diff -= Math.floor(diff); // 바퀴 수가 달라도 (한 바퀴 뒤진 차가 바로 뒤에 있어도) 진짜 거리
      let d = diff * L;
      if (d > L - 3) d -= L; // 아주 조금 앞 = 옆에 나란히
      if (d < -1) continue;
      const dx = e.view.pos.x - car.pos.x, dy = e.view.pos.y - car.pos.y, dz = e.view.pos.z - car.pos.z;
      const real = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (real > Math.max(d, 8) * 1.5 + 12) continue; // 코스 진행은 가깝지만 실제로 멀리 (고가도로 위·아래 등)
      if (!best || d < best.d) best = { e, d };
    }
    if (best) {
      const v = Math.max(6, Math.abs(car.forwardSpeed || 0), car.vel ? car.vel.length() : 0);
      best.gap = Math.max(0, best.d) / v;
    }
    return best;
  }

  function hudVisible() {
    if (document.body.classList.contains('replaying')) return false;
    const sb = document.getElementById('speedBox') || document.getElementById('topLeft');
    return !sb || sb.getClientRects().length > 0; // display:none(조상 포함)이면 0
  }

  function measure() {
    // 화면 칸 (CSS px, 테두리 안쪽). transform(scaleY)과 상관없는 offset 값으로
    const w = el.clientWidth, h = el.clientHeight;
    // CSS가 translateX(-50%)로 가운데 맞춤 → offsetLeft는 옮기기 전 자리라서 폭의 절반을 뺌
    st.rect = { x: Math.round(el.offsetLeft - el.offsetWidth / 2 + el.clientLeft), y: el.offsetTop + el.clientTop, w, h };
    st.rectDirty = false;
  }

  const ease = (k) => 1 - Math.pow(1 - k, 3);
  let shownK = -1;
  function applyDom() {
    const k = st.k;
    if (k === shownK) return;
    shownK = k;
    if (k <= 0) {
      el.classList.remove('on');
      el.style.transform = '';
      el.style.opacity = '';
      return;
    }
    el.classList.add('on');
    el.style.transform = k >= 1 ? '' : `translateX(-50%) scaleY(${ease(k).toFixed(3)})`;
    el.style.opacity = k >= 1 ? '' : Math.min(1, k * 2.5).toFixed(3);
  }

  function setTag(near) {
    const txt = near ? `${near.gap.toFixed(1)}초|${near.e.name || ''}` : '';
    if (txt === st.lastTag) return;
    st.lastTag = txt;
    tagEl.classList.toggle('on', !!near);
    if (near) {
      gapEl.textContent = `◀ ${near.gap.toFixed(1)}초`;
      nameEl.textContent = near.e.name || '';
      const c = near.e.color;
      // 차 색은 테두리로만 구분하고 이름은 늘 밝게 읽히게 해요.
      nameEl.style.color = '#f3f6fb';
      tagEl.style.borderLeftColor = typeof c === 'string' ? c : c != null && c.getHexString ? `#${c.getHexString()}` : '#f3f6fb';
    }
  }

  /** 거울 장면 그리기 (게임 화면을 그린 바로 뒤) */
  function render(renderCar = car) {
    if (st.rectDirty || !st.rect) measure();
    const r = st.rect;
    if (!r || r.w < 8 || r.h < 8) return;
    const ek = ease(Math.min(1, st.k));
    const h = Math.max(1, r.h * ek);
    const H = renderer.domElement.clientHeight || innerHeight;
    const glY = H - (r.y + h); // WebGL은 아래에서 위로 셈
    const t0 = performance.now();
    // 두 프레임에 한 번만 장면을 그리고, 그 사이 프레임은 지난 그림(복사해 둔 것)을 붙임 (다 내려온 뒤에만)
    const pr = renderer.getPixelRatio();
    const key = `${r.x},${r.y},${r.w},${r.h},${pr}`;
    const half = C.halfRate && !HALF_OFF && st.k >= 1;
    if (!half || fb.key !== key) fb.ok = false;
    // CPU 여유가 적어도 거울은 유지. 2프레임마다 그리던 것을 낮음에서 3프레임마다.
    const stride = graphicsTier() === 2 ? 3 : 2;
    st.copyFrame = ((st.copyFrame || 0) + 1) % stride;
    if (half && fb.ok && st.copyFrame !== 0) {
      drawCopy(r, glY, h);
      st.ms = performance.now() - t0;
      st.reused++;
      return;
    }

    // 카메라: 운전자 눈 위치에서 뒤를 봄 (차가 기울면 같이 기울어짐 = 진짜 거울처럼)
    _eye.copy(renderCar.pos).addScaledVector(renderCar.right, C.eye[0]).addScaledVector(renderCar.up, C.eye[1]).addScaledVector(renderCar.fwd, C.eye[2]);
    _look.copy(renderCar.pos).addScaledVector(renderCar.fwd, -C.look).addScaledVector(renderCar.up, C.lookDown);
    cam.position.copy(_eye);
    cam.up.copy(car.up);
    cam.lookAt(_look);
    cam.aspect = r.w / r.h;
    cam.near = C.near;
    cam.far = C.far;
    cam.fov = C.fovV;
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[0] *= -1; // 좌우 뒤집기 (거울)
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld();

    // 상태 저장
    renderer.getViewport(_v);
    renderer.getScissor(_s);
    const scissorTest = renderer.getScissorTest();
    const smAuto = renderer.shadowMap.autoUpdate;
    const mwAuto = scene.matrixWorldAutoUpdate;
    const infoAuto = renderer.info.autoReset;
    const callsBefore = renderer.info.render.calls;
    const modelVis = model && model.root ? model.root.visible : null;
    const tags = [];
    const swapped = []; // [entry, proxy] 거울에서만 한 덩어리 모형으로
    for (const e of opponents.entries) {
      const root = e.model && e.model.root;
      if (!root || !root.visible || e.lod !== 'full') continue;
      const v = e.view;
      if (v && (v.mode === 'boat' || v.mode === 'fly' || v.flying)) continue; // 모양이 크게 바뀌는 변신은 진짜 모델
      const dx = root.position.x - _eye.x, dy = root.position.y - _eye.y, dz = root.position.z - _eye.z;
      if (dx * dx + dy * dy + dz * dz < C.fullM * C.fullM) continue;
      const p = proxyOf(e);
      if (!p) continue;
      p.mesh.matrix.copy(root.matrixWorld);
      p.mesh.matrixWorld.copy(root.matrixWorld);
      p.mesh.visible = true;
      root.visible = false;
      swapped.push(e, p);
    }
    for (const e of opponents.entries) if (e.tag && e.tag.sprite && e.tag.sprite.visible) (tags.push(e.tag.sprite), (e.tag.sprite.visible = false));
    const state = renderer.state;
    const setMat = state.setMaterial;
    try {
      renderer.setScissorTest(true);
      renderer.setViewport(r.x, glY, r.w, h);
      renderer.setScissor(r.x, glY, r.w, h);
      renderer.shadowMap.autoUpdate = false; // 그림자는 방금 만든 것 그대로
      scene.matrixWorldAutoUpdate = false; // 위치 계산도 방금 한 것 그대로
      renderer.info.autoReset = false; // 이번 프레임 그림 호출 수에 거울도 더해짐
      if (model && model.root) model.root.visible = false;
      // 좌우를 뒤집으면 삼각형의 앞/뒷면이 바뀜 → 면 방향을 반대로 알려 줌
      state.setMaterial = function (material, frontFaceCW, hardwareClipping) {
        return setMat.call(state, material, !frontFaceCW, hardwareClipping);
      };
      renderer.render(scene, cam); // autoClear: 이 칸만 지움 (scissor)
    } finally {
      state.setMaterial = setMat;
      renderer.setScissorTest(scissorTest);
      renderer.setViewport(_v);
      renderer.setScissor(_s);
      renderer.shadowMap.autoUpdate = smAuto;
      scene.matrixWorldAutoUpdate = mwAuto;
      renderer.info.autoReset = infoAuto;
      if (modelVis != null) model.root.visible = modelVis;
      for (const s of tags) s.visible = true;
      for (let i = 0; i < swapped.length; i += 2) {
        swapped[i].model.root.visible = true;
        swapped[i + 1].mesh.visible = false;
      }
    }
    st.calls = renderer.info.render.calls - callsBefore;
    if (half) saveCopy(r, glY, h, pr, key);
    st.ms = performance.now() - t0;
    st.renders++;
  }

  // --- 반 박자 그리기용: 거울 칸을 텍스처로 복사해 두고 다음 프레임에 그대로 붙임 ---
  //   복사·붙이기는 그래픽카드 안에서 하는 작은 일 (그림 호출 1번). 붙이는 재질은 텍스처 값을 그대로 내보냄(색 변환·톤 매핑 없음)
  const HALF_OFF = /[?&]mirrorrate=1/.test(location.search);
  const fb = { tex: null, w: 0, h: 0, ok: false, key: '' };
  const quadMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }',
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  try {
    renderer.compile(quadScene, quadCam); // 불러올 때 셰이더 미리 (작은 것 하나)
  } catch {}
  const _fbPos = new THREE.Vector2();
  function saveCopy(r, glY, h, pr, key) {
    const w = Math.round(r.w * pr), hh = Math.round(h * pr);
    if (w < 2 || hh < 2) return;
    if (!fb.tex || fb.w !== w || fb.h !== hh) {
      if (fb.tex) fb.tex.dispose();
      fb.tex = new THREE.FramebufferTexture(w, hh);
      fb.tex.minFilter = fb.tex.magFilter = THREE.NearestFilter;
      fb.tex.generateMipmaps = false;
      fb.w = w;
      fb.h = hh;
      quadMat.uniforms.map.value = fb.tex;
    }
    _fbPos.set(Math.round(r.x * pr), Math.round(glY * pr));
    try {
      renderer.copyFramebufferToTexture(_fbPos, fb.tex);
      fb.ok = true;
      fb.key = key;
    } catch (err) {
      fb.ok = false;
      C.halfRate = false; // 안 되는 브라우저면 매 프레임 그리기로
    }
  }
  function drawCopy(r, glY, h) {
    renderer.getViewport(_v);
    renderer.getScissor(_s);
    const scissorTest = renderer.getScissorTest();
    const autoClear = renderer.autoClear;
    const infoAuto = renderer.info.autoReset;
    try {
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      renderer.setScissorTest(true);
      renderer.setViewport(r.x, glY, r.w, h);
      renderer.setScissor(r.x, glY, r.w, h);
      renderer.render(quadScene, quadCam);
    } finally {
      renderer.autoClear = autoClear;
      renderer.info.autoReset = infoAuto;
      renderer.setScissorTest(scissorTest);
      renderer.setViewport(_v);
      renderer.setScissor(_s);
    }
  }

  /**
   * 매 프레임 (게임 화면을 그린 바로 뒤에 부름)
   *   ctx = { phase, intro, override }
   */
  function frame(dt, ctx = {}) {
    const mode = settings.values.mirror ?? 'auto';
    st.hudT -= dt;
    if (st.hudT <= 0) {
      st.hudT = 0.5;
      st.hudOk = hudVisible();
    }
    const g = window.game;
    const menuOpen = !!(g && g.menu && g.menu.isOpen); // 온라인에서는 메뉴가 열려도 게임이 돌아감
    const allowed = mode !== 'off' && raceSys.active() && ctx.phase === 'racing' && !ctx.intro && !ctx.override && !menuOpen && st.hudOk;
    let near = null;
    if (allowed) {
      near = findBehind();
      const v = Math.abs(car.forwardSpeed || 0);
      const show = Math.min(C.maxM, Math.max(C.showM, v * C.showSec));
      const close = near && near.d < show + (st.active ? C.hideExtraM : 0);
      if (close) {
        st.noneT = 0;
        st.active = true;
      } else {
        st.noneT += dt;
        if (st.noneT > C.linger) st.active = false;
      }
      if (!close && near && near.d > show + C.hideExtraM) near = null;
    } else {
      st.active = false;
      st.noneT = 99;
    }
    st.want = allowed && (mode === 'on' || st.active);
    st.near = near;
    const prevK = st.k;
    st.k = st.want ? Math.min(1, st.k + dt / C.inDur) : Math.max(0, st.k - dt / C.outDur);
    if (!allowed) st.k = 0; // 출발 신호·결과 화면·메뉴 등은 바로 숨김
    if (prevK <= 0 && st.k > 0) st.rectDirty = true; // 나올 때마다 자리 다시 재기 (터치 배치 등)
    applyDom();
    st.tagT -= dt;
    if (st.tagT <= 0 || !near !== !st.lastTag) {
      st.tagT = 0.2;
      setTag(st.k > 0 && near && near.d < C.maxM + C.hideExtraM ? near : null);
    }
    if (st.k > 0) render(ctx.renderCar);
  }

  function reset() {
    st.k = 0;
    st.active = false;
    st.noneT = 99;
    applyDom();
  }

  return {
    el,
    cfg: C,
    frame,
    reset,
    /** 테스트용 */
    get state() {
      return { proxies: [...proxies.values()].map((p) => (p ? p.tris | 0 : null)), k: +st.k.toFixed(3), want: st.want, active: st.active, near: st.near ? { name: st.near.e.name, d: +st.near.d.toFixed(1), gap: +st.near.gap.toFixed(2) } : null, calls: st.calls, ms: +st.ms.toFixed(2), renders: st.renders, reused: st.reused, half: C.halfRate, buildMs: Math.round(st.buildMs), rect: st.rect };
    },
  };
}
