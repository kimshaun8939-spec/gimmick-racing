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

  // ---------------------------------------------------------------- 앵무새 떼: 가끔 플레이어 앞쪽 낮게 도로를 가로질러 날아감 (빨강·파랑·노랑·초록)
  const NPAR = 7;
  const wingL = new THREE.BufferGeometry();
  wingL.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.25, 0, 0, 0.35, -1.1, 0, 0.05], 3));
  wingL.computeVertexNormals();
  const wingR = wingL.clone().scale(-1, 1, 1);
  const parMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const bodyGeo = new THREE.ConeGeometry(0.22, 1.3, 5).rotateX(Math.PI / 2);
  const parts = [bodyGeo, wingL, wingR].map((geo) => {
    const im = new THREE.InstancedMesh(geo, parMat, NPAR);
    im.frustumCulled = false;
    im.count = 0;
    group.add(im);
    return im;
  });
  const parCols = ['#e8322a', '#2a7de8', '#ffcf3f', '#2fbf4a', '#ff8a1f', '#19b3a6', '#e8322a'];
  const pc = new THREE.Color();
  for (const im of parts) for (let i = 0; i < NPAR; i++) im.setColorAt(i, pc.set(parCols[i % parCols.length]));
  const parrots = { t: -1, next: 4, from: new THREE.Vector3(), dir: new THREE.Vector3(), birds: Array.from({ length: NPAR }, () => ({ o: new THREE.Vector3(R(-4, 4), R(-1.5, 1.5), R(-5, 5)), ph: R(0, 6.28) })) };
  let lastCar = null;
  const wq = new THREE.Quaternion(), wm = new THREE.Matrix4(), bm4 = new THREE.Matrix4(), axZ = new THREE.Vector3(0, 0, 1);
  function launchParrots(car) {
    const s = car.trackInfo && car.trackInfo.sample;
    if (!s || s.space) return; // 지하 세계에선 안 날림
    const side = rnd() < 0.5 ? -1 : 1;
    const ahead = 50 + rnd() * 30;
    const c = track.surf(s, 0, 0, new THREE.Vector3()).addScaledVector(s.tan, ahead);
    parrots.from.copy(c).addScaledVector(s.right, side * 60);
    parrots.from.y += 6 + rnd() * 4;
    parrots.dir.copy(s.right).multiplyScalar(-side).addScaledVector(s.tan, (rnd() - 0.5) * 0.6).normalize();
    parrots.t = 0;
  }

  return {
    group,
    update(dt, car) {
      lastCar = car;
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
      // 앵무새: 약 9~16초마다 한 번 (차가 빨리 달릴 때만), 4초 동안 가로질러 날아감
      const dtA = parrots.prevT === undefined ? 0 : Math.min(0.05, Math.max(0, time - parrots.prevT));
      parrots.prevT = time;
      parrots.next -= dtA;
      if (parrots.t < 0 && parrots.next <= 0 && lastCar && Math.abs(lastCar.speed) > 15) {
        launchParrots(lastCar);
        parrots.next = 9 + rnd() * 7;
      }
      if (parrots.t >= 0) {
        parrots.t += dtA;
        const yaw = Math.atan2(parrots.dir.x, parrots.dir.z);
        parrots.birds.forEach((b, i) => {
          p.copy(parrots.from).addScaledVector(parrots.dir, parrots.t * 30).add(b.o);
          p.y += Math.sin(parrots.t * 3 + b.ph) * 0.6;
          q.setFromEuler(e.set(0, yaw, 0));
          bm4.compose(p, q, sc.set(2.2, 2.2, 2.2));
          parts[0].setMatrixAt(i, bm4);
          const flap = Math.sin(time * 16 + b.ph) * 0.7;
          for (const [k, sgn] of [[1, 1], [2, -1]]) {
            wm.multiplyMatrices(bm4, m4.makeRotationFromQuaternion(wq.setFromAxisAngle(axZ, sgn * flap)));
            parts[k].setMatrixAt(i, wm);
          }
        });
        for (const im of parts) (im.count = NPAR), (im.instanceMatrix.needsUpdate = true);
        if (parrots.t > 4.2) {
          parrots.t = -1;
          for (const im of parts) im.count = 0;
        }
      }
    },
  };
}
