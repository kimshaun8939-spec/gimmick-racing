// 구름섬 그랑프리 전용 소품: 하늘 협곡의 비행 고리
//   고리를 통과하면 부스트 (car.startBoost) + 고리가 반짝이며 번호가 다음 고리로 넘어감
//   (props.js의 buildProps가 그랑프리 맵이면 이것을 대신 씀. update/reset/animate 모양은 같음)
import * as THREE from 'three';
import { canvasTexture } from './track.js';

export function buildGrandPrixProps(track, scene) {
  const group = new THREE.Group();
  group.userData.world = 'cloud'; // 우주 차원에 있을 때는 숨김 (gpSpace.js)
  scene.add(group);
  const rings = track.rings || [];

  // 고리 모양: 두꺼운 도넛 + 안쪽 얇은 빛 고리 + 가운데 화살표
  const arrowTex = canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 14;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const y of [0.3, 0.62]) {
      g.beginPath();
      g.moveTo(w * 0.25, h * (y + 0.18));
      g.lineTo(w * 0.5, h * y);
      g.lineTo(w * 0.75, h * (y + 0.18));
      g.stroke();
    }
  });
  arrowTex.wrapS = arrowTex.wrapT = THREE.ClampToEdgeWrapping;
  const items = rings.map((r, k) => {
    const g = new THREE.Group();
    g.position.copy(r.pos);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.dir);
    const col = new THREE.Color().setHSL(0.52 - k * 0.07, 0.9, 0.55);
    const ringMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.2 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(r.r, 0.75, 12, 40), ringMat);
    torus.castShadow = true;
    g.add(torus);
    const glowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.TorusGeometry(r.r - 1.05, 0.22, 6, 40), glowMat);
    g.add(glow);
    // 고리 둘레의 작은 전구
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff6c8' }), 12);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m4.makeTranslation(Math.cos(a) * r.r, Math.sin(a) * r.r, 0.8);
      bulbs.setMatrixAt(i, m4);
    }
    g.add(bulbs);
    const arrowMat = new THREE.MeshBasicMaterial({ map: arrowTex, color: col, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const arrow = new THREE.Mesh(new THREE.PlaneGeometry(r.r * 0.9, r.r * 0.9), arrowMat);
    arrow.rotation.x = 0; // 평면은 xy → 진행 방향(z)을 바라봄
    g.add(arrow);
    group.add(g);
    return { r, g, torus, glow, glowMat, ringMat, arrow, arrowMat, col, flash: 0, spin: k * 0.7 };
  });

  // 통과 판정: 지난 위치 → 지금 위치 선분이 고리 면을 지나가고, 지나간 점이 고리 안이면 통과
  const prev = new THREE.Vector3();
  let hasPrev = false;
  const d0 = new THREE.Vector3(), d1 = new THREE.Vector3(), hitP = new THREE.Vector3();
  let passed = 0;
  function update(dt, car) {
    if (!hasPrev) {
      prev.copy(car.pos);
      hasPrev = true;
      return;
    }
    if (prev.distanceToSquared(car.pos) > 400) {
      prev.copy(car.pos); // 순간 이동(복귀) → 판정 안 함
      return;
    }
    for (const it of items) {
      const { pos, dir, r } = it.r;
      if (car.pos.distanceToSquared(pos) > (r + 25) ** 2) continue;
      const a = d0.subVectors(prev, pos).dot(dir), b = d1.subVectors(car.pos, pos).dot(dir);
      if (a < 0 && b >= 0) {
        const u = a / (a - b);
        hitP.lerpVectors(prev, car.pos, u);
        if (hitP.distanceTo(pos) < r + 0.6) {
          car.startBoost(1.3, 1);
          car.events.push('ring');
          it.flash = 1;
          passed++;
        }
      }
    }
    prev.copy(car.pos);
  }

  function animate(time) {
    for (const it of items) {
      it.torus.rotation.z = time * 0.6 + it.spin;
      it.flash = Math.max(0, it.flash - 0.02);
      const pulse = 0.5 + 0.5 * Math.sin(time * 4 + it.spin);
      it.ringMat.emissiveIntensity = 0.45 + pulse * 0.35 + it.flash * 2;
      it.glowMat.opacity = 0.35 + pulse * 0.3 + it.flash * 0.5;
      it.g.scale.setScalar(1 + it.flash * 0.25);
      it.arrowMat.opacity = 0.45 + 0.35 * Math.sin(time * 6 + it.spin);
    }
  }
  function reset() {
    hasPrev = false;
    passed = 0;
    for (const it of items) it.flash = 0;
  }

  return { group, update, reset, animate, props: [], cubes: [], barricade: null, barricades: [], rings: items, stats: { rings: items.length, get passed() { return passed; } } };
}
