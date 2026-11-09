// 잔디·물에 들어가 느려질 때의 연출
//   뒷바퀴에서 풀잎/흙(물이면 물보라)이 튀고, 흙먼지가 뭉게뭉게 남음
//   화면 가장자리가 살짝 초록-갈색으로 물들고, 카메라가 덜덜 떨림 (느려지는 게 느껴지도록)
import * as THREE from 'three';

const MAX_BITS = 260;
const MAX_PUFFS = 40;
const COLORS = {
  grass: ['#4f9a3a', '#6fb64c', '#3d7f2e', '#7a5a36', '#8a6a40'],
  water: ['#e8f6ff', '#bfe4ff', '#9fd3ff', '#ffffff'],
};

export function createOffroadFx(scene) {
  // 작은 조각 (풀잎, 흙덩이, 물방울)
  const bitGeo = new THREE.BoxGeometry(0.16, 0.05, 0.22);
  const bitMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const bits = new THREE.InstancedMesh(bitGeo, bitMat, MAX_BITS);
  bits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bits.frustumCulled = false;
  scene.add(bits);
  const bitList = Array.from({ length: MAX_BITS }, () => ({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), s: 1 }));
  let bitNext = 0;

  // 흙먼지 / 물안개 덩어리
  const puffGeo = new THREE.IcosahedronGeometry(0.6, 1);
  const puffs = Array.from({ length: MAX_PUFFS }, () => {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshLambertMaterial({ color: '#b39a72', transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    return { m, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1 };
  });
  let puffNext = 0;

  // 화면 가장자리 물들이기
  const edge = document.createElement('div');
  Object.assign(edge.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', opacity: '0',
    transition: 'background 0.3s',
  });
  document.getElementById('game').after(edge); // HUD보다 아래에 깔림
  let edgeK = 0;
  let edgeKind = '';

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const color = new THREE.Color();
  const tmp = new THREE.Vector3();
  let bitAcc = 0, puffAcc = 0;
  let rumble = 0;

  function spawnBit(origin, back, side, kind, speedK) {
    const idx = bitNext;
    const b = bitList[idx];
    bitNext = (bitNext + 1) % MAX_BITS;
    b.life = b.max = 0.45 + Math.random() * 0.4;
    b.pos.copy(origin).addScaledVector(side, (Math.random() - 0.5) * 0.4);
    // 뒤로 + 위로 튀고, 바깥쪽으로 조금 퍼짐
    b.vel.copy(back).multiplyScalar(3 + Math.random() * 5 * speedK)
      .addScaledVector(side, (Math.random() - 0.3) * 3)
      .add(tmp.set(0, (kind === 'water' ? 4 : 3) + Math.random() * 4 * speedK, 0));
    b.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    b.spin.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
    b.s = 0.7 + Math.random() * 0.8;
    // 맵이 코스 밖 색을 주면 그 색 (달 = 회색 돌가루 등), 없으면 풀잎
    const tr = window.game && window.game.track;
    const list = kind === 'grass' && tr && tr.offroadColors ? tr.offroadColors : COLORS[kind];
    bits.setColorAt(idx, color.set(list[Math.floor(Math.random() * list.length)]));
  }

  let smokeAcc = 0;
  function spawnPuff(origin, back, kind) {
    const p = puffs[puffNext];
    puffNext = (puffNext + 1) % MAX_PUFFS;
    p.life = p.max = 0.7 + Math.random() * 0.5;
    p.m.position.copy(origin).add(tmp.set((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6));
    p.vel.copy(back).multiplyScalar(1 + Math.random() * 2).add(tmp.set(0, 0.8 + Math.random(), 0));
    p.grow = 1.4 + Math.random();
    p.m.material.color.set(kind === 'smoke' ? (Math.random() < 0.5 ? '#e4e4e4' : '#c9c9cc') : kind === 'water' ? '#eef8ff' : Math.random() < 0.5 ? '#b39a72' : '#9c8a62');
    p.m.visible = true;
  }

  return {
    /** 매 프레임: 차 상태를 보고 조각을 뿌리고 움직임 */
    update(car, dt) {
      const speed = Math.abs(car.speed);
      const active = car.offroad && car.grounded && speed > 3 && car.up.y > 0.8;
      // 배 모드로 물 위: 물보라(항적)는 튀지만 감속 화면 효과와 덜컹거림은 없음
      const sailing = car.mode === 'boat' && car.surface === 'water';
      const kind = car.surface === 'water' ? 'water' : 'grass';
      const speedK = Math.min(1, speed / 30);

      if (active) {
        const right = car.right;
        const back = car.moveDir.negate().setY(0).normalize();
        // 속도가 빠를수록 많이 튐 (초당 최대 약 150조각)
        bitAcc += dt * (40 + 110 * speedK);
        puffAcc += dt * (6 + 10 * speedK);
        for (const sgn of [-1, 1]) {
          const wheel = tmp.copy(car.pos).addScaledVector(right, sgn * 0.86).addScaledVector(car.fwd, -1.6).setY(car.pos.y + 0.15);
          const origin = wheel.clone();
          const side = right.clone().multiplyScalar(sgn);
          for (let n = 0; n < Math.floor(bitAcc / 2); n++) spawnBit(origin, back, side, kind, speedK);
          if (puffAcc >= 2) spawnPuff(origin, back, kind);
        }
        bitAcc %= 2;
        if (puffAcc >= 2) puffAcc %= 2;
        if (bits.instanceColor) bits.instanceColor.needsUpdate = true;
      }

      // 도로 위 타이어 연기: 바퀴가 헛돌거나 뒤가 미끄러질 때
      const smoke = !car.offroad && car.grounded && !car.drifting ? Math.max(car.wheelspin || 0, car.sliding || 0) : 0;
      if (smoke > 0.25) {
        smokeAcc += dt * 18 * smoke;
        const right = car.right;
        const back = car.moveDir.negate();
        while (smokeAcc >= 1) {
          smokeAcc -= 1;
          const sgn = Math.random() < 0.5 ? -1 : 1;
          spawnPuff(tmp.copy(car.pos).addScaledVector(right, sgn * 0.86).addScaledVector(car.fwd, -1.5).addScaledVector(car.up, 0.2), back.clone().multiplyScalar(0.6), 'smoke');
        }
      }

      // 조각 움직이기
      for (let i = 0; i < MAX_BITS; i++) {
        const b = bitList[i];
        if (b.life > 0) {
          b.life -= dt;
          b.vel.y -= 22 * dt;
          b.vel.multiplyScalar(Math.exp(-1.5 * dt));
          b.pos.addScaledVector(b.vel, dt);
          if (b.pos.y < 0.03) {
            b.pos.y = 0.03;
            b.vel.set(0, 0, 0);
          }
          b.rot.x += b.spin.x * dt;
          b.rot.y += b.spin.y * dt;
          b.rot.z += b.spin.z * dt;
        }
        const k = b.life > 0 ? b.s * Math.min(1, (b.life / b.max) * 2.5) : 0;
        q.setFromEuler(b.rot);
        m4.compose(b.pos, q, sc.set(k, k, k));
        bits.setMatrixAt(i, m4);
      }
      bits.instanceMatrix.needsUpdate = true;

      for (const p of puffs) {
        if (!p.m.visible) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.m.visible = false;
          continue;
        }
        const u = 1 - p.life / p.max;
        p.m.position.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.exp(-2 * dt));
        p.m.scale.setScalar(0.6 + u * p.grow * 1.6);
        p.m.material.opacity = 0.45 * (1 - u) * Math.min(1, u * 6);
      }

      // 화면 가장자리: 잔디는 초록-갈색, 물은 하늘색
      edgeK = THREE.MathUtils.lerp(edgeK, active && !sailing ? 0.35 + 0.65 * speedK : 0, 1 - Math.exp(-(active ? 6 : 3) * dt));
      if (active && kind !== edgeKind) {
        edgeKind = kind;
        edge.style.background = kind === 'water'
          ? 'radial-gradient(ellipse at center, transparent 55%, rgba(120, 190, 255, 0.55) 120%)'
          : 'radial-gradient(ellipse at center, transparent 55%, rgba(96, 120, 40, 0.6) 115%)';
      }
      edge.style.opacity = edgeK.toFixed(3);
      rumble = active && !sailing ? 0.015 + 0.03 * speedK : 0; // 예전의 절반 (진동 줄이기)
    },
    /** 울퉁불퉁한 땅 느낌: 카메라를 아주 조금 떨게 함 (updateCamera 다음에 호출) */
    shakeCamera(camera) {
      if (rumble <= 0) return;
      camera.position.x += (Math.random() - 0.5) * rumble;
      camera.position.y += (Math.random() - 0.5) * rumble * 1.4;
      camera.position.z += (Math.random() - 0.5) * rumble;
    },
  };
}
