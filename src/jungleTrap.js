// 정글 유적 사원 함정: 피라미드 터널 입구의 돌문이 "쿠구궁" 내려옴 (보이기만 하는 연출, 충돌 없음 → 공정)
//   - 플레이어 차가 입구 150 m 앞에 오면 돌문이 천천히 내려오기 시작해 입구 앞 40 m에서 가장 낮아짐
//     (가장 낮아도 도로 위 5.5 m: 차·카메라는 항상 아래로 지나감 → 아슬아슬하게 빠져나가는 느낌)
//   - 지나간 뒤에는 다시 천천히 올라감. 내려올 때 먼지·돌 부스러기·흔들림 + 낮은 쿵쿵 소리 (N으로 꺼짐)
//   - 봇 차는 신경 쓰지 않음 (플레이어 차 기준)
import * as THREE from 'three';
import { canvasTexture, glowTexture, seededRandom, TAU } from './jungleUtil.js';

/**
 * @param track  정글 트랙
 * @param parent 붙일 그룹 (정글 세계 그룹)
 * @param opt    { sP: 포털 A 샘플, d: 포털에서 문까지 거리(음수 = 앞), TW: 터널 반폭, top: 터널 천장 높이, stoneMat, goldMat }
 */
export function buildTempleGate(track, parent, { sP, d = -70, TW = 12, top = 11, stoneMat, goldMat }) {
  const rnd = seededRandom(404);
  const g = new THREE.Group();
  const pos = sP.pos.clone().addScaledVector(sP.tan, d);
  g.position.copy(pos);
  g.rotation.y = Math.atan2(sP.tan.x, sP.tan.z);
  parent.add(g);
  const gateDist = sP.t * track.length + d; // 코스 거리 (m)
  const LOW = 5.5, HIGH = top; // 문 아래 끝 높이: 가장 낮을 때 / 다 올라갔을 때
  const SLAB_H = 10, W = TW * 2 + 1.2;

  // 문 판: 큰 돌판 + 가운데 금빛 해 얼굴 + 아래 이빨 모양 톱니
  const faceTex = canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = '#6f6754';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) {
      const v = Math.floor(rnd() * 40 - 20);
      c.fillStyle = `rgba(${100 + v},${94 + v},${78 + v},0.5)`;
      c.fillRect(rnd() * w, rnd() * h, 3, 3);
    }
    c.strokeStyle = 'rgba(30,26,18,0.8)';
    c.lineWidth = 5;
    for (let x = 0; x < w; x += 64) c.strokeRect(x + 6, 10, 52, h - 20);
    // 해 얼굴
    c.fillStyle = 'rgba(30,26,18,0.85)';
    c.beginPath();
    c.arc(w / 2, h / 2, 70, 0, TAU);
    c.fill();
    c.fillStyle = '#f2c94c';
    c.beginPath();
    c.arc(w / 2, h / 2, 60, 0, TAU);
    c.fill();
    c.fillStyle = '#2a2318';
    c.fillRect(w / 2 - 30, h / 2 - 18, 16, 10);
    c.fillRect(w / 2 + 14, h / 2 - 18, 16, 10);
    c.fillRect(w / 2 - 26, h / 2 + 18, 52, 8);
    // 경고 줄무늬 (위험!)
    c.fillStyle = 'rgba(200,60,30,0.7)';
    for (let x = -h; x < w; x += 48) {
      c.beginPath();
      c.moveTo(x, h);
      c.lineTo(x + 24, h);
      c.lineTo(x + 24 + 26, h - 26);
      c.lineTo(x + 26, h - 26);
      c.fill();
    }
  });
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.9 });
  const slab = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, SLAB_H, 1.6), [stoneMat, stoneMat, stoneMat, stoneMat, faceMat, faceMat]);
  body.position.y = SLAB_H / 2;
  body.castShadow = true;
  slab.add(body);
  // 아래 톱니 (돌 이빨)
  const teeth = Math.floor(W / 2.2);
  for (let i = 0; i < teeth; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 4), stoneMat);
    t.rotation.x = Math.PI;
    t.position.set(-W / 2 + 1.1 + i * 2.2, -0.6, 0);
    slab.add(t);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.25, 6, 20), goldMat);
  ring.position.set(0, SLAB_H * 0.42, 0.85);
  slab.add(ring);
  g.add(slab);
  // 양옆 홈 기둥 (문이 미끄러지는 길) + 쇠사슬 감는 바퀴
  const wheels = [];
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, top + 1, 2.6), stoneMat);
    post.position.set(sx * (TW - 0.2), (top + 1) / 2, 0);
    post.castShadow = true;
    g.add(post);
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 10), goldMat);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(sx * (TW - 0.2), top - 1.2, 1.6);
    g.add(wh);
    wheels.push(wh);
  }

  // 먼지 (문 아래 끝에서 옆으로 퍼짐) + 떨어지는 돌 부스러기
  const dustMat = new THREE.SpriteMaterial({ map: glowTexture('rgba(210,195,160,0.9)', 'rgba(180,160,120,0.35)'), color: '#c9b48a', transparent: true, depthWrite: false, opacity: 0 });
  const dust = [];
  for (let i = 0; i < 14; i++) {
    const sp = new THREE.Sprite(dustMat.clone());
    sp.visible = false;
    g.add(sp);
    dust.push({ sp, life: 0, vx: 0, vy: 0 });
  }
  const pebGeo = new THREE.DodecahedronGeometry(0.35, 0);
  const NP = 30;
  const pebbles = new THREE.InstancedMesh(pebGeo, stoneMat, NP);
  pebbles.frustumCulled = false;
  g.add(pebbles);
  const peb = Array.from({ length: NP }, () => ({ x: 0, y: -99, z: 0, vy: 0, s: 0.6 + rnd() * 1.2 }));
  const m4 = new THREE.Matrix4();

  // 소리: 낮게 갈리는 돌 소리 (노이즈 저음) + 마지막에 쿵
  let actx = null;
  // 키·터치 모두 소리를 준비해요. 음소거 상태는 공통 믹서 한 곳에서만 기억해요.
  const wakeAudio = () => {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } else if (actx.state === 'suspended') actx.resume().catch(() => {});
  };
  window.addEventListener('keydown', wakeAudio);
  window.addEventListener('pointerdown', wakeAudio, { passive: true });
  function rumble(len = 1.6, thud = true) {
    if (!actx || actx.state !== 'running') return;
    const t0 = actx.currentTime;
    const n = Math.floor(actx.sampleRate * len);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const dd = buf.getChannelData(0);
    for (let i = 0; i < n; i++) dd[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 900));
    const src = actx.createBufferSource();
    src.buffer = buf;
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const gg = actx.createGain();
    gg.gain.setValueAtTime(0.0001, t0);
    gg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.2);
    gg.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(lp).connect(gg).connect(actx.destination);
    src.start(t0);
    if (thud) {
      const o = actx.createOscillator();
      o.frequency.setValueAtTime(70, t0 + len * 0.8);
      o.frequency.exponentialRampToValueAtTime(30, t0 + len * 0.8 + 0.5);
      const og = actx.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.setValueAtTime(0.0001, t0 + len * 0.8);
      og.gain.exponentialRampToValueAtTime(0.6, t0 + len * 0.8 + 0.03);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + len * 0.8 + 0.6);
      o.connect(og).connect(actx.destination);
      o.start(t0);
      o.stop(t0 + len + 0.8);
    }
  }

  let y = HIGH, phase = 'up', shake = 0;
  const puff = (n) => {
    for (let k = 0; k < n; k++) {
      const d0 = dust.find((q) => q.life <= 0);
      if (!d0) break;
      d0.life = 1;
      d0.sp.visible = true;
      d0.sp.position.set((rnd() - 0.5) * W, y, (rnd() - 0.5) * 2);
      d0.vx = (rnd() - 0.5) * 6;
      d0.vy = -1 - rnd() * 2;
    }
    for (let k = 0; k < 6; k++) {
      const p = peb.find((q) => q.y < -50);
      if (!p) break;
      p.x = (rnd() - 0.5) * W;
      p.y = y;
      p.z = (rnd() - 0.5) * 1.5;
      p.vy = 0;
    }
  };
  slab.position.y = y;

  return {
    group: g,
    /** 지금 문 아래 끝 높이 (테스트용) */
    get height() {
      return y;
    },
    update(time, dt, car) {
      if (!dt) return; // 멈춤(메뉴 등) 중에는 그대로
      dt = Math.min(dt, 0.05);
      let target = HIGH;
      if (car && car.trackInfo) {
        let ahead = gateDist - car.trackInfo.t * track.length; // 문까지 남은 거리
        if (ahead < -track.length / 2) ahead += track.length;
        if (ahead > 0 && ahead < 150) target = THREE.MathUtils.lerp(HIGH, LOW, THREE.MathUtils.smoothstep(150 - ahead, 0, 110));
      }
      const prev = y;
      if (target < y) {
        // 내려옴: 무겁게 (초당 약 3.5 m)
        if (phase !== 'down') (phase = 'down'), rumble(1.8, true);
        y = Math.max(target, y - 3.5 * dt);
        if (Math.random() < dt * 10) puff(2);
        shake = 0.08;
      } else if (target > y + 0.01) {
        phase = 'up';
        y = Math.min(target, y + 1.2 * dt); // 올라갈 땐 천천히
      }
      if (prev > LOW + 0.05 && y <= LOW + 0.05) puff(10); // 쿵: 먼지 펑
      shake *= Math.exp(-6 * dt);
      slab.position.set((Math.random() - 0.5) * shake, y, 0);
      for (const w of wheels) w.rotation.x += (prev - y) * 0.9;
      for (const d0 of dust) {
        if (d0.life <= 0) continue;
        d0.life -= dt * 0.7;
        d0.sp.position.x += d0.vx * dt;
        d0.sp.position.y = Math.max(0.6, d0.sp.position.y + d0.vy * dt);
        d0.sp.scale.setScalar(2 + (1 - d0.life) * 7);
        d0.sp.material.opacity = Math.max(0, d0.life) * 0.55;
        if (d0.life <= 0) d0.sp.visible = false;
      }
      peb.forEach((p, i) => {
        if (p.y > -50) {
          p.vy -= 18 * dt;
          p.y += p.vy * dt;
          if (p.y < 0.2) p.y = -99;
        }
        m4.makeScale(p.s, p.s, p.s).setPosition(p.x, p.y, p.z);
        pebbles.setMatrixAt(i, m4);
      });
      pebbles.instanceMatrix.needsUpdate = true;
    },
  };
}
