// 정글 유적 소품: 저중력 언덕의 떠 있는 돌 (차가 지나가면 살짝 밀려 올라감) + 정글 새 떼
//   main.js가 props.update(dt, car) (물리 스텝마다), props.reset(), props.animate(time)을 부름
import * as THREE from 'three';
import { seededRandom } from './jungleUtil.js';

export function buildJungleProps(track, scene) {
  const group = new THREE.Group();
  group.userData.world = 'cloud'; // 지하 세계에서는 숨김 (jungleWorld.js)
  scene.add(group);
  const rnd = seededRandom(77);
  const R = (a, b) => a + rnd() * (b - a);

  // ---------------------------------------------------------------- 떠 있는 돌 (저중력 구역 양옆, 위아래로 둥실)
  const rocks = [];
  const rockMat = new THREE.MeshStandardMaterial({ color: '#7d7a68', roughness: 0.95, flatShading: true });
  const runeMat = new THREE.MeshBasicMaterial({ color: '#7dffd8' });
  for (const z of track.gravZones || []) {
    const pts = z.pts;
    for (let k = 0; k < pts.length; k += 2) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.25) continue;
        const near = track.nearest(pts[k]);
        const s = near.sample;
        const lat = side * (track.width / 2 + R(7, 22));
        const p = track.surf(s, lat, 0, new THREE.Vector3());
        const g = track.heightAt(p.x, p.z);
        if (g === null) continue;
        const size = R(0.8, 2.6);
        const geo = new THREE.DodecahedronGeometry(size, 0);
        const m = new THREE.Mesh(geo, rockMat);
        m.castShadow = true;
        const base = g + R(2, 7) + size;
        m.position.set(p.x, base, p.z);
        m.rotation.set(R(0, 6), R(0, 6), R(0, 6));
        // 빛나는 룬 띠
        const rune = new THREE.Mesh(new THREE.TorusGeometry(size * 0.95, 0.07, 4, 16), runeMat);
        rune.rotation.x = Math.PI / 2;
        m.add(rune);
        group.add(m);
        rocks.push({ m, base, ph: R(0, 6.28), sp: R(0.5, 1.1), spin: R(-0.4, 0.4), lift: 0 });
      }
    }
  }

  // ---------------------------------------------------------------- 새 떼 (정글 위를 빙빙)
  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.9, 0, 0.2, 0, 0, -0.3, 0, 0, 0.4, 0.9, 0, 0.2, 0, 0, -0.3, 0, 0, 0.4], 3));
  birdGeo.computeVertexNormals();
  const birdMat = new THREE.MeshBasicMaterial({ color: '#1d2a1a', side: THREE.DoubleSide });
  const NB = 36;
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, NB);
  birds.frustumCulled = false;
  group.add(birds);
  const flocks = [
    { c: new THREE.Vector3(60, 70, 380), r: 140, w: 0.11 },
    { c: new THREE.Vector3(-150, 60, 120), r: 90, w: -0.16 },
    { c: new THREE.Vector3(250, 80, 650), r: 120, w: 0.13 },
  ];
  const bird = Array.from({ length: NB }, (_, i) => ({ f: flocks[i % flocks.length], ph: R(0, 6.28), dr: R(-14, 14), dy: R(-6, 6), flap: R(6, 9) }));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();

  return {
    group,
    update(dt, car) {
      // 차가 가까이 지나가면 떠 있는 돌이 살짝 위로 밀려남
      if (!car) return;
      for (const r of rocks) {
        const d2 = (r.m.position.x - car.pos.x) ** 2 + (r.m.position.z - car.pos.z) ** 2;
        if (d2 < 400) r.lift = Math.min(3, r.lift + dt * Math.abs(car.speed) * 0.08);
      }
    },
    reset() {
      for (const r of rocks) r.lift = 0;
    },
    animate(time) {
      for (const r of rocks) {
        r.lift *= 0.985;
        r.m.position.y = r.base + Math.sin(time * r.sp + r.ph) * 0.8 + r.lift;
        r.m.rotation.y += r.spin * 0.016;
      }
      bird.forEach((b, i) => {
        const a = time * b.f.w + b.ph;
        p.set(b.f.c.x + Math.cos(a) * (b.f.r + b.dr), b.f.c.y + b.dy + Math.sin(time * 0.7 + b.ph) * 3, b.f.c.z + Math.sin(a) * (b.f.r + b.dr));
        e.set(0, -a + (b.f.w > 0 ? 0 : Math.PI), Math.sin(time * b.flap + b.ph) * 0.6);
        q.setFromEuler(e);
        sc.set(1.6, 1.6, 1.6);
        m4.compose(p, q, sc);
        birds.setMatrixAt(i, m4);
      });
      birds.instanceMatrix.needsUpdate = true;
    },
  };
}
