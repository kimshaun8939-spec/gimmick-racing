// 아이템전 (?mode=item): 봇 레이스 + 아이템 상자·아이템 5종·드리프트 게이지
//   - 상자: 코스 직선 6~9곳에 4개씩 한 줄 (샘플에서 자동으로 고름: 점프·물·자석·루프·포털 근처는 뺌)
//   - 아이템: 🚀 부스터 / 🛡 방어막 / 🛢 기름 웅덩이 / 🎯 유도 로켓 / ⚡ 전기 충격 (뒤쪽 순위만)
//   - 맞으면 가던 방향 그대로 속도만 줄어듦 (옆으로 안 밀림 → 낭떠러지에서 안 떨어짐)
//   - 드리프트 게이지: 드리프트로 채우면 부스터 1개
//   - 화면(슬롯·게이지·경고)은 이 파일이 직접 만듦. 값은 아래 CFG (물리 값 3개는 data/car.json "items")
import * as THREE from 'three';

export const ITEMS = {
  boost: { icon: '🚀', name: '부스터' },
  shield: { icon: '🛡', name: '방어막' },
  oil: { icon: '🛢', name: '기름 웅덩이' },
  rocket: { icon: '🎯', name: '유도 로켓' },
  shock: { icon: '⚡', name: '전기 충격' },
};
const KINDS = Object.keys(ITEMS);

export const CFG = {
  startSkip: 150, // 출발 뒤 이만큼(m)은 상자 없음
  rowEvery: 800, // 상자 줄 간격 목표 (m) → 한 바퀴 6~9줄
  rowMin: 6, rowMax: 9,
  boxPerRow: 4,
  boxRespawn: 0.7, // 먹힌 상자가 다시 생기는 시간 (초). 길면 앞 무리가 다 먹어서 뒤차가 못 먹음 (3초일 때 그랬음)
  pickR: 2.3, // 상자 먹는 거리 (m)
  roulette: 0.9, // 룰렛 도는 시간 (초)
  boostSec: 2.2,
  shieldSec: 6,
  oilSec: 20, oilR: 2.7, oilSlow: 0.65, oilMax: 12,
  rocketSlow: 0.6, rocketSpeed: 30, rocketMin: 75, rocketLife: 8, rocketRange: 500,
  shockSec: 2,
  immuneBot: 2, immunePlayer: 6, // 한 번 맞은 뒤 다시 안 맞는 시간 (플레이어는 길게 = 연속으로 안 맞게)
  gaugeFill: 5, // 드리프트 이만큼(초) 하면 게이지 가득 (좋은 코너 2~3개)
};

export function createItems(o) {
  const { scene, track, car, raceSys, hud } = o;
  const keyLabel = o.keyLabel || (() => 'E');
  // 온라인 아이템전: 내 차만 상자를 먹고(봇은 아이템 없음), 다른 사람에게 주는 효과는 작은 메시지로 보냄 (아래 '온라인' 부분)
  const online = !!o.online;
  const opps = o.opponents || null;
  const remotes = () => (online && opps ? opps.entries.filter((e) => e.remote) : []);
  let myPid = '', netSend = null, oilSeq = 0;
  const pidOf = (e) => (e && e.remote ? String(e.id).replace(/^net:/, '') : myPid);
  const send = (m) => {
    if (online && netSend) {
      try {
        netSend({ t: 'item', ...m });
      } catch {}
    }
  };
  const L = track.length;
  const samples = track.samples || [];
  const NS = samples.length;
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
  const rightOf = (s) => s.rightB || s.right;
  const wrapI = (i) => ((i % NS) + NS) % NS;

  // ---------- 상자 자리 고르기 ----------
  function rayAt(s, lat) {
    const r = rightOf(s);
    _v.copy(s.pos).addScaledVector(r, lat);
    _v.y += 3;
    let h = null;
    try {
      h = track.castRay(_v, DOWN, 9);
    } catch {}
    if (!h || h.surface !== 'ground' || !h.point) return null;
    if (Math.abs(h.point.y - s.pos.y) > 1.1) return null;
    if (h.normal && h.normal.y < 0.88) return null;
    return h;
  }
  const flagged = (s) => !s || s.gap || s.roll || s.magnet || s.tube || s.loop || s.jump || s.water || !rightOf(s) || !s.pos;
  function halfW(i) {
    const s = samples[i];
    return s.hw || (track.halfWidthAt ? track.halfWidthAt(i) : 0) || (track.width || 12) / 2;
  }
  function validSpot(i, maxBend) {
    const step = L / NS;
    const s = samples[i];
    if (flagged(s)) return false;
    // 앞뒤 25·50 m도 평범한 도로여야 함 (점프·물·자석·포털 근처 빼기)
    for (const m of [-55, -28, 28, 55]) {
      const s2 = samples[wrapI(i + Math.round(m / step))];
      if (flagged(s2) || !!s2.space !== !!s.space || !rayAt(s2, 0)) return false;
    }
    const a = samples[wrapI(i - Math.round(18 / step))], b = samples[wrapI(i + Math.round(18 / step))];
    const ta = a.tan || a.tan3, tb = b.tan || b.tan3;
    if (ta && tb) {
      const d = Math.min(1, Math.max(-1, (ta.x * tb.x + ta.z * tb.z) / (Math.hypot(ta.x, ta.z) * Math.hypot(tb.x, tb.z) || 1)));
      if (Math.acos(d) > maxBend) return false;
    }
    const hw = halfW(i);
    return !!(rayAt(s, 0) && rayAt(s, -hw * 0.62) && rayAt(s, hw * 0.62));
  }
  const rows = []; // { i, dist, center, boxes: [{ pos, normal, respT, pop }] }
  function placeRows() {
    if (NS < 50 || !track.castRay) return;
    const K = Math.max(CFG.rowMin, Math.min(CFG.rowMax, Math.round(L / CFG.rowEvery)));
    const span = (L - CFG.startSkip - 60) / K;
    const step = L / NS;
    const reach = Math.floor((span * 0.45) / step);
    for (let k = 0; k < K; k++) {
      const i0 = Math.round((CFG.startSkip + (k + 0.5) * span) / step);
      let found = -1;
      for (const bend of [0.1, 0.3, 0.6]) {
        for (let d = 0; d <= reach && found < 0; d += 2) {
          for (const sg of d ? [1, -1] : [1]) {
            const i = wrapI(i0 + sg * d);
            if (i * step < CFG.startSkip || i * step > L - 40) continue;
            if (validSpot(i, bend)) {
              found = i;
              break;
            }
          }
        }
        if (found >= 0) break;
      }
      if (found < 0) continue;
      const s = samples[found], hw = halfW(found), r = rightOf(s);
      const row = { i: found, dist: found * step, center: s.pos.clone(), boxes: [] };
      const n = CFG.boxPerRow;
      for (let j = 0; j < n; j++) {
        const lat = (-0.62 + (1.24 * j) / (n - 1)) * hw;
        const h = rayAt(s, lat);
        if (!h) continue;
        const nrm = h.normal ? h.normal.clone().normalize() : UP.clone();
        if (nrm.y < 0) nrm.negate();
        row.boxes.push({ pos: h.point.clone().addScaledVector(nrm, 1.35), normal: nrm, respT: 0, pop: 1, phase: (k * 4 + j) * 0.7 });
      }
      if (row.boxes.length) rows.push(row);
    }
  }
  placeRows();

  // ---------- 3D 물체 ----------
  const root = new THREE.Group();
  root.name = 'itemsRoot';
  scene.add(root);
  const nBox = rows.reduce((a, r) => a + r.boxes.length, 0);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xffc83a, emissive: 0xff8a00, emissiveIntensity: 1.1, transparent: true, opacity: 0.68, roughness: 0.2, metalness: 0.1, depthWrite: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const boxMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), boxMat, Math.max(1, nBox));
  const coreMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.5), coreMat, Math.max(1, nBox));
  for (const m of [boxMesh, coreMesh]) {
    m.name = 'itemBoxes';
    m.frustumCulled = false;
    m.castShadow = m.receiveShadow = false;
    m.count = nBox;
    root.add(m);
  }
  const dummy = new THREE.Object3D();
  function drawBoxes(elapsed) {
    let n = 0;
    for (const row of rows) {
      for (const b of row.boxes) {
        const sc = b.respT > 0 ? 0.0001 : b.pop;
        _q.setFromUnitVectors(UP, b.normal);
        _q2.setFromAxisAngle(UP, elapsed * 1.6 + b.phase);
        dummy.position.copy(b.pos).addScaledVector(b.normal, Math.sin(elapsed * 2.2 + b.phase) * 0.18);
        dummy.quaternion.copy(_q).multiply(_q2);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        boxMesh.setMatrixAt(n, dummy.matrix);
        _q2.setFromAxisAngle(UP, -elapsed * 3 + b.phase);
        dummy.quaternion.copy(_q).multiply(_q2);
        dummy.updateMatrix();
        coreMesh.setMatrixAt(n, dummy.matrix);
        n++;
      }
    }
    boxMesh.instanceMatrix.needsUpdate = coreMesh.instanceMatrix.needsUpdate = true;
  }
  // 기름 웅덩이 (미리 만들어 두고 돌려 씀)
  const oilGeo = new THREE.CircleGeometry(CFG.oilR, 20);
  oilGeo.rotateX(-Math.PI / 2);
  const oilMat = new THREE.MeshStandardMaterial({ color: 0x15101c, roughness: 0.08, metalness: 0.85, emissive: 0x3a1466, emissiveIntensity: 0.35, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const oils = [];
  for (let i = 0; i < CFG.oilMax; i++) {
    const m = new THREE.Mesh(oilGeo, oilMat);
    m.visible = false;
    root.add(m);
    oils.push({ mesh: m, t: 0, owner: null, pos: new THREE.Vector3() });
  }
  // 로켓 (최대 4발)
  const rkGeo = new THREE.ConeGeometry(0.42, 1.9, 10);
  rkGeo.rotateX(Math.PI / 2);
  const rkMat = new THREE.MeshStandardMaterial({ color: 0xff4a3a, emissive: 0xff2a10, emissiveIntensity: 1.4 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  const glowGeo = new THREE.SphereGeometry(0.55, 10, 8);
  const rockets = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(rkGeo, rkMat));
    const gl = new THREE.Mesh(glowGeo, glowMat);
    gl.position.z = -1.1;
    g.add(gl);
    g.visible = false;
    root.add(g);
    rockets.push({ mesh: g, on: false, d: 0, lat: 0, v: 0, life: 0, owner: null, target: null });
  }
  // 차마다: 방어막 방울·부스터 불꽃
  const auraGeo = new THREE.SphereGeometry(2.7, 18, 12);
  const flameGeo = new THREE.ConeGeometry(0.55, 3.2, 10);
  flameGeo.rotateX(-Math.PI / 2);
  flameGeo.translate(0, 0.45, -3.6);

  // ---------- 선수 상태 ----------
  const states = new Map();
  function racers() {
    return online ? [raceSys.me] : [raceSys.me, ...raceSys.bots];
  }
  /** 순위 계산용: 온라인이면 다른 사람·봇도 포함 */
  function everyone() {
    return online ? [raceSys.me, ...remotes(), ...raceSys.bots] : racers();
  }
  const carOf = (e) => e.car || e.view;
  function st(e) {
    let s = states.get(e);
    if (!s) {
      const aura = new THREE.Mesh(auraGeo, new THREE.MeshBasicMaterial({ color: 0x6fe0ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
      const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
      aura.visible = flame.visible = false;
      root.add(aura, flame);
      s = { slots: [null, null], roulT: 0, shieldT: 0, immuneT: 0, holdT: 0, thinkT: Math.random() * 0.3, useAt: 0, gauge: 0, aura, flame, hits: 0, used: 0, picked: 0 };
      states.set(e, s);
    }
    return s;
  }
  function rankOf(e) {
    let r = 1;
    for (const x of everyone()) if (x !== e && x.progress > e.progress) r++;
    return r;
  }
  /** 순위에 따라 아이템 뽑기: 앞쪽 = 방어막·기름, 뒤쪽 = 부스터·로켓·전기 충격 */
  function roll(e) {
    const all = everyone();
    const n = all.length, rank = rankOf(e);
    const r = n > 1 ? (rank - 1) / (n - 1) : 0.5;
    const w = {
      shield: 3 - 2.2 * r,
      oil: n > 1 ? 3 - 2.4 * r : 0,
      boost: 1 + 2.6 * r,
      rocket: rank > 1 ? 0.3 + 2.7 * r : 0,
      shock: n > (online ? 1 : 2) && r >= 0.5 ? 1.6 * r : 0,
    };
    let sum = 0;
    for (const k of KINDS) sum += w[k];
    let x = Math.random() * sum;
    for (const k of KINDS) {
      x -= w[k];
      if (x <= 0) return k;
    }
    return 'boost';
  }
  function giveTo(e, kind, quick = false) {
    const s = st(e);
    const slot = s.slots[0] == null ? 0 : s.slots[1] == null ? 1 : -1;
    if (slot < 0) return false;
    s.slots[slot] = kind || roll(e);
    s.picked++;
    if (slot === 0) {
      s.roulT = quick ? 0 : CFG.roulette;
      s.holdT = 0;
      s.useAt = 1.2 + Math.random() * 3;
    }
    if (e.isPlayer) {
      hudDirty = true;
      if (!quick) sfx('pick');
    }
    return true;
  }

  // ---------- 효과 ----------
  const isMe = (e) => e === raceSys.me;
  function say(text) {
    if (hud && hud.toast) hud.toast(text);
  }
  /** 맞음: 방어막이 있으면 막음. k = 남는 속도 비율 */
  let lastBlocked = false;
  function hit(e, k, text) {
    if (e.remote) return false; // 온라인 상대: 맞았는지는 그 사람 컴퓨터가 정함
    const s = st(e), c = carOf(e);
    lastBlocked = false;
    if (e.finished || s.immuneT > 0) return false;
    if (s.shieldT > 0) {
      s.shieldT = 0;
      s.immuneT = 0.8;
      lastBlocked = true;
      send({ k: 'fx', fx: 'block' });
      if (isMe(e)) {
        say('🛡 방어막이 막았어요!');
        sfx('block');
        hudDirty = true;
      }
      return false;
    }
    if (c.flying) return false;
    if (c.itemHit) c.itemHit(k);
    s.immuneT = isMe(e) ? CFG.immunePlayer : CFG.immuneBot;
    s.hits++;
    s.hitFxT = 0.6; // 맞은 차 둘레가 잠깐 빨갛게
    if (isMe(e)) {
      say(text + ' · 잠깐 감속해요. 가속해서 속도를 되찾아요');
      s.notice = text.startsWith('🛢') ? '🛢 기름 · 감속!' : '🎯 로켓 · 감속!';
      s.noticeT = 2;
      sfx('hit');
      if (hud.flash) hud.flash('#ff6a4a', 0.5);
      if (hud.shake) hud.shake(0.35);
    }
    return true;
  }
  function use(e) {
    const s = st(e), c = carOf(e);
    if (e.finished || s.roulT > 0 || !s.slots[0]) return false;
    const kind = s.slots[0];
    const me = isMe(e);
    if (kind === 'rocket' && !rockets.some((r) => !r.on)) return false;
    s.slots[0] = s.slots[1];
    s.slots[1] = null;
    s.holdT = 0;
    s.useAt = 1.5 + Math.random() * 3;
    s.used++;
    if (me) {
      hudDirty = true;
      const messages = { boost: '🚀 부스터! 잠깐 빨라져요', shield: '🛡 방어막! 다음 공격을 한 번 막아요', oil: '🛢 뒤에 기름을 놓았어요. 뒤차가 밟으면 감속해요', rocket: '🎯 앞차를 향해 로켓 발사!' };
      if (messages[kind]) say(messages[kind]);
    }
    if (kind === 'boost') {
      c.itemBoostT = CFG.boostSec;
      if (me) send({ k: 'fx', fx: 'boost' });
      if (me) {
        sfx('boost');
        if (hud.flash) hud.flash('#ffb040', 0.4);
      }
    } else if (kind === 'shield') {
      s.shieldT = CFG.shieldSec;
      if (me) sfx('shield'), send({ k: 'fx', fx: 'shield' });
    } else if (kind === 'oil') {
      let slot = oils.find((x) => x.t <= 0) || oils.reduce((a, b) => (a.t < b.t ? a : b));
      slot.t = CFG.oilSec;
      slot.owner = e;
      slot.ownerT = 1.5;
      slot.pos.copy(c.pos).addScaledVector(c.fwd, -4.5);
      slot.mesh.position.copy(slot.pos).addScaledVector(c.up, 0.06);
      slot.mesh.quaternion.setFromUnitVectors(UP, c.up);
      slot.mesh.visible = visible;
      slot.id = myPid + ':' + ++oilSeq;
      if (me) send({ k: 'oil', oid: slot.id, p: slot.pos.toArray().map(r2), u: c.up.toArray().map(r2) });
      if (me) sfx('drop');
    } else if (kind === 'rocket') {
      const r = rockets.find((x) => !x.on);
      // 바로 앞 차를 겨냥
      let tgt = null, best = CFG.rocketRange / L;
      for (const x of online ? remotes() : racers()) {
        if (x === e || x.finished) continue;
        const d = x.progress - e.progress;
        if (d > 0 && d < best) (best = d), (tgt = x);
      }
      Object.assign(r, { on: true, owner: e, target: tgt, d: e.progress * L + 5, lat: latOf(e), v: Math.max(CFG.rocketMin, Math.abs(c.speed) + CFG.rocketSpeed), life: tgt ? CFG.rocketLife : 2.5 });
      r.mesh.position.copy(c.pos);
      r.mesh.visible = visible;
      if (me) send({ k: 'rocket', to: tgt ? pidOf(tgt) : null, d: r2(r.d), lat: r2(r.lat), v: r2(r.v) });
      if (me) sfx('rocket');
      if (tgt && isMe(tgt)) sfx('warn');
    } else if (kind === 'shock') {
      let n = 0;
      if (me) send({ k: 'shock', pr: e.progress });
      for (const x of online ? remotes() : racers()) {
        if (x === e || x.finished || x.progress <= e.progress) continue;
        const xs = st(x);
        if (x.remote) {
          // 온라인 상대: 느려지는 것은 그 사람 컴퓨터가 함. 여기서는 번쩍이는 모습만
          xs.shockT = carOf(x).itemSlowT = CFG.shockSec;
          n++;
          continue;
        }
        if (xs.shieldT > 0) {
          xs.shieldT = 0;
          if (isMe(x)) say('🛡 방어막이 전기 충격을 막았어요!'), (hudDirty = true);
          continue;
        }
        carOf(x).itemSlowT = CFG.shockSec;
        xs.shockT = CFG.shockSec;
        n++;
        if (isMe(x)) {
          say(`⚡ ${e.name}의 전기 충격! 잠깐 느려져요`);
          sfx('shock');
          if (hud.flash) hud.flash('#fff25a', 0.5);
        }
      }
      if (me) {
        sfx('shock');
        say(n ? `⚡ 앞차 ${n}대가 느려졌어요!` : '⚡ 앞에 아무도 없어요');
        if (hud.flash) hud.flash('#fff25a', 0.3);
      }
    }
    return true;
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  function latOf(e) {
    const c = carOf(e);
    const s = samples[wrapI(Math.round((((e.progress % 1) + 1) % 1) * NS))];
    if (!s || !rightOf(s)) return 0;
    const r = rightOf(s);
    return (c.pos.x - s.pos.x) * r.x + (c.pos.y - s.pos.y) * r.y + (c.pos.z - s.pos.z) * r.z;
  }
  function pointAt(d, lat, out) {
    const f = (((d / L) % 1) + 1) % 1;
    const x = f * NS, i = Math.floor(x) % NS, k = x - Math.floor(x);
    const a = samples[i], b = samples[(i + 1) % NS];
    out.copy(a.pos).lerp(b.pos, k);
    const r = rightOf(a);
    if (r) out.addScaledVector(r, lat);
    out.y += 1.0;
    return out;
  }

  // ---------- 물리 스텝 (1/120초마다) ----------
  let shown = false, hintDone = false, raceT = 0;
  function step(dt, racing) {
    if (!racing) return;
    raceT += dt;
    const all = racers();
    if (!hintDone && raceT > 1.2) {
      hintDone = true;
      say(document.body.classList.contains('touch-on') ? '🎁 상자를 지나 아이템 획득 → 화면 위 아이템 칸을 눌러 사용해요' : `🎁 상자를 지나면 아이템! ${keyLabel('booster', 'E')} 키로 사용해요`);
    }
    // 상자
    for (const row of rows) {
      for (const b of row.boxes) {
        if (b.respT > 0) {
          b.respT -= dt;
          if (b.respT <= 0) b.pop = 0.01;
        } else if (b.pop < 1) b.pop = Math.min(1, b.pop + dt * 4);
      }
      for (const e of all) {
        if (e.finished) continue;
        const c = carOf(e), p = c.pos;
        const dx = p.x - row.center.x, dz = p.z - row.center.z;
        if (dx * dx + dz * dz > 400 || Math.abs(p.y - row.center.y) > 6 || c.flying) continue;
        for (const b of row.boxes) {
          if (b.respT > 0) continue;
          if (p.distanceToSquared(b.pos) < CFG.pickR * CFG.pickR + 1.2) {
            if (giveTo(e)) b.respT = CFG.boxRespawn;
            break;
          }
        }
      }
    }
    // 선수마다
    for (const e of all) {
      const s = st(e), c = carOf(e);
      if (s.roulT > 0) {
        s.roulT -= dt;
        if (s.roulT <= 0 && isMe(e)) (hudDirty = true), sfx('ready');
      }
      if (s.shieldT > 0) {
        s.shieldT -= dt;
        if (s.shieldT <= 0 && isMe(e)) hudDirty = true;
      }
      if (s.immuneT > 0) s.immuneT -= dt;
      if (s.shockT > 0) s.shockT -= dt;
      if (s.slots[0]) s.holdT += dt;
      if (isMe(e)) {
        // 드리프트 게이지
        if (!e.finished && c.drifting && c.grounded && Math.abs(c.speed) > 12) s.gauge = Math.min(1, s.gauge + dt / CFG.gaugeFill);
        if (s.gauge >= 1 && giveTo(e, 'boost', true)) {
          s.gauge = 0;
          say('🔥 드리프트 게이지 가득! 부스터 획득');
          sfx('ready');
        }
      } else if (!e.finished && s.slots[0] && s.roulT <= 0) {
        s.thinkT -= dt;
        if (s.thinkT <= 0) {
          s.thinkT = 0.3;
          botThink(e, s, c, all);
        }
      }
    }
    // 온라인 상대: 보이는 효과 시간만 줄임
    for (const e of remotes()) {
      const s = states.get(e);
      if (!s) continue;
      const c = carOf(e);
      if (s.shieldT > 0) s.shieldT -= dt;
      if (s.shockT > 0) s.shockT -= dt;
      if (c.itemBoostT > 0) c.itemBoostT -= dt;
      if (c.itemSlowT > 0) c.itemSlowT -= dt;
    }
    // 기름
    for (const oil of oils) {
      if (oil.t <= 0) continue;
      oil.t -= dt;
      if (oil.ownerT > 0) oil.ownerT -= dt;
      if (oil.t <= 0) {
        oil.mesh.visible = false;
        continue;
      }
      for (const e of all) {
        if (e === oil.owner && oil.ownerT > 0) continue;
        const c = carOf(e), p = c.pos;
        const dx = p.x - oil.pos.x, dz = p.z - oil.pos.z;
        if (dx * dx + dz * dz < (CFG.oilR + 0.9) ** 2 && Math.abs(p.y - oil.pos.y) < 1.6 && c.grounded) {
          const blocked = st(e).shieldT > 0;
          const got = hit(e, CFG.oilSlow, '🛢 기름을 밟았어요!');
          if (got || blocked) {
            oil.t = 0;
            oil.mesh.visible = false;
            if (oil.id) send({ k: 'oilgone', oid: oil.id });
            if (oil.owner && oil.owner.remote) send({ k: 'hit', by: pidOf(oil.owner), what: 'oil', blocked: !got });
          }
          break;
        }
      }
    }
    // 로켓
    for (const r of rockets) {
      if (!r.on) continue;
      r.life -= dt;
      r.d += r.v * dt;
      const t = r.target;
      if (t && !t.finished) {
        const tl = latOf(t);
        r.lat += Math.max(-14 * dt, Math.min(14 * dt, tl - r.lat));
        const td = t.progress * L;
        const tp = carOf(t).pos;
        pointAt(r.d, r.lat, _v2);
        if (r.d >= td - 4) {
          if (_v2.distanceToSquared(tp) < 100) {
            const got = hit(t, CFG.rocketSlow, `🎯 ${r.owner.name}의 로켓에 맞았어요!`);
            if (isMe(t) && r.owner.remote && (got || lastBlocked)) send({ k: 'hit', by: pidOf(r.owner), what: 'rocket', blocked: !got });
            if (isMe(r.owner) && !t.remote) say(`🎯 ${t.name} 명중!`), sfx('hit'); // (온라인 상대는 '맞았다'는 답이 오면 알림)
            r.life = 0;
          } else if (r.d > td + 14) r.life = 0; // 지름길·비행 중이라 놓침
        }
      }
      if (r.life <= 0) {
        r.on = false;
        r.mesh.visible = false;
      }
    }
  }
  function botThink(e, s, c, all) {
    const kind = s.slots[0];
    let ahead = Infinity, behind = Infinity;
    for (const x of all) {
      if (x === e || x.finished) continue;
      const d = (x.progress - e.progress) * L;
      if (d > 0 && d < ahead) ahead = d;
      if (d < 0 && -d < behind) behind = -d;
    }
    if (s.holdT < 1) return;
    let go = false;
    if (kind === 'boost') go = c.thr > 0.8 && Math.abs(c.yawRate || 0) < 0.07 && c.grounded && !c.flying && Math.abs(c.speed) > 18;
    else if (kind === 'rocket') go = (ahead > 8 && ahead < 60) || s.holdT > 14;
    else if (kind === 'oil') go = (behind < 25 && c.grounded && !c.flying) || s.holdT > 12;
    else if (kind === 'shield') go = rockets.some((r) => r.on && r.target === e) || s.holdT > 4 + s.useAt * 2;
    else if (kind === 'shock') go = s.holdT > s.useAt;
    if (go) use(e);
  }

  // ---------- 화면 ----------
  let visible = true, hudDirty = true;
  const css = document.createElement('style');
  css.textContent = `
#itemHud { position: fixed; left: max(270px, calc(50% - 250px)); bottom: 20px; transform: translateX(-100%); display: flex; align-items: flex-end; gap: 8px; z-index: 31; pointer-events: none; font-family: inherit; user-select: none; -webkit-user-select: none; }
#itemHud .slot { position: relative; width: 66px; height: 66px; border-radius: 16px; background: rgba(10, 14, 26, 0.72); border: 2px solid rgba(255,255,255,0.35); display: flex; align-items: center; justify-content: center; font-size: 36px; line-height: 1; color:#fff; font-family:inherit; pointer-events: auto; cursor: pointer; touch-action: none; transition: transform 0.12s, border-color 0.2s; }
#itemHud .slot.s2::after { content:'다음'; position:absolute; top:-18px; left:0; width:100%; color:#e1e8f8; font:800 12px/1.2 system-ui,sans-serif; text-align:center; text-shadow:0 1px 3px #000; }
#itemHud .item-name { max-width:150px; color:#fff3c4; font:800 12px/1.4 system-ui,sans-serif; text-shadow:0 1px 3px #000; }
#itemHud .slot.s1:focus-visible { outline:3px solid #fff; outline-offset:3px; }
#itemHud .slot.s2 { width: 46px; height: 46px; font-size: 24px; border-radius: 12px; opacity: 0.85; }
#itemHud .slot.has { border-color: #ffd23a; box-shadow: 0 0 14px rgba(255, 190, 40, 0.55); }
#itemHud .slot.roul { border-color: #fff; }
#itemHud .slot.pop { transform: scale(1.18); }
#itemHud .slot kbd { position: absolute; left: 50%; bottom: -9px; transform: translateX(-50%); font: 800 11px/1 system-ui, sans-serif; padding: 2px 6px; border-radius: 6px; background: #fff; color: #111; white-space: nowrap; }
#itemHud .col { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
#itemHud .gauge { width: 120px; height: 12px; border-radius: 7px; background: rgba(10, 14, 26, 0.72); border: 1px solid rgba(255,255,255,0.35); overflow: hidden; }
#itemHud .gauge i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, #ffb13a, #ff5a2a); transition: width 0.1s linear; }
#itemHud .gl { font: 800 11px/1 system-ui, sans-serif; color: #ffe1b0; text-shadow: 0 1px 2px #000; }
#itemHud .fx { font: 800 12px/1 system-ui, sans-serif; color: #9fe8ff; text-shadow: 0 1px 2px #000; min-height: 12px; }
#itemWarn { position: fixed; left: 50%; top: 24%; transform: translateX(-50%); padding: 8px 22px; border-radius: 12px; background: rgba(200, 30, 20, 0.85); color: #fff; font: 900 26px/1.1 system-ui, sans-serif; letter-spacing: 0.04em; z-index: 6; pointer-events: none; display: none; animation: itemWarnBlink 0.35s steps(2) infinite; }
@keyframes itemWarnBlink { 50% { opacity: 0.45; } }
@media (max-width: 900px), (pointer: coarse) { #itemHud { left: 50%; bottom: auto; top: 70px; transform: translateX(-50%) scale(0.85); transform-origin: top center; } }
body.touch-on.item-race #toast { top:146px; font-size:13px; line-height:1.4; white-space:normal; text-align:center; max-width:min(420px, calc(100vw - 40px)); }
body.touch-on.item-race #itemWarn { top:146px; font-size:15px; padding:6px 14px; z-index:33; }
body.touch-on #itemHud { left: 50%; bottom: auto; top: 70px; transform: translateX(-50%) scale(0.85); transform-origin: top center; }
`;
  document.head.appendChild(css);
  document.body.classList.add('item-race');
  const box = document.createElement('div');
  box.id = 'itemHud';
  box.innerHTML = `<div class="col"><div class="fx" role="status"></div><div class="item-name"></div><div class="gl">🔥 드리프트 게이지</div><div class="gauge"><i></i></div></div><div class="slot s2" title="다음 아이템 · 지금 것을 쓰면 이 칸이 앞으로 와요"></div><button type="button" class="slot s1" aria-label="아이템 사용"><span></span><kbd></kbd></button>`;
  document.body.appendChild(box);
  const warn = document.createElement('div');
  warn.id = 'itemWarn';
  warn.textContent = '⚠ 로켓!';
  document.body.appendChild(warn);
  const el = { s1: box.querySelector('.s1'), s1i: box.querySelector('.s1 span'), kbd: box.querySelector('kbd'), s2: box.querySelector('.s2'), g: box.querySelector('.gauge i'), fx: box.querySelector('.fx') };
  for (const ev of ['pointerdown', 'touchstart']) {
    el.s1.addEventListener(ev, (x) => {
      x.stopPropagation();
      // click을 유지해야 터치·키보드·화면 읽기 도구에서도 쓸 수 있어요.
    }, { passive: false });
  }
  el.s1.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); usePlayer(); });
  let roulI = 0, roulAcc = 0, lastG = -1, lastFx = '', warnOn = false;
  function drawHud(dt) {
    const s = st(raceSys.me);
    if (s.roulT > 0) {
      roulAcc += dt;
      if (roulAcc > 0.07) {
        roulAcc = 0;
        roulI = (roulI + 1) % KINDS.length;
        el.s1i.textContent = ITEMS[KINDS[roulI]].icon;
      }
      el.s1.className = 'slot s1 roul';
    } else if (hudDirty) {
      el.s1i.textContent = s.slots[0] ? ITEMS[s.slots[0]].icon : '';
      el.s1.className = 'slot s1' + (s.slots[0] ? ' has pop' : '');
      setTimeout(() => el.s1.classList.remove('pop'), 140);
    }
    if (hudDirty) {
      el.s2.textContent = s.slots[1] ? ITEMS[s.slots[1]].icon : '';
      el.s2.className = 'slot s2' + (s.slots[1] ? ' has' : '');
      el.kbd.textContent = document.body.classList.contains('touch-on') ? '누르기' : keyLabel('booster', 'E');
      const item = s.slots[0] && ITEMS[s.slots[0]];
      box.querySelector('.item-name').textContent = item ? item.icon + ' ' + item.name + ' · 지금 사용' : '🎁 상자를 통과해 획득';
      el.s1.setAttribute('aria-label', item ? item.name + ' 사용' : '빈 아이템 칸 · 상자를 통과해 획득해요');
      el.s2.setAttribute('aria-label', s.slots[1] ? '다음 아이템: ' + ITEMS[s.slots[1]].name : '다음 아이템 없음');
      hudDirty = false;
    }
    const g = Math.round(s.gauge * 100);
    if (g !== lastG) el.g.style.width = (lastG = g) + '%';
    const c = carOf(raceSys.me);
    if (s.noticeT > 0) s.noticeT = Math.max(0, s.noticeT - dt);
    const fx = s.noticeT > 0 ? s.notice : s.shieldT > 0 ? `🛡 ${Math.ceil(s.shieldT)}초` : c.itemBoostT > 0 ? '🚀 부스터!' : c.itemSlowT > 0 ? '⚡ 감전!' : '';
    if (fx !== lastFx) el.fx.textContent = lastFx = fx;
    const w = rockets.some((r) => r.on && r.target === raceSys.me);
    if (w !== warnOn) warn.style.display = (warnOn = w) ? 'block' : 'none';
  }
  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    root.visible = v;
    box.style.display = v ? 'flex' : 'none';
    if (!v) warn.style.display = 'none', (warnOn = false);
  }
  /** 매 화면: 상자 돌리기, 방어막·불꽃·로켓 그리기, HUD */
  function update(dt, elapsed) {
    if (!visible) return;
    drawBoxes(elapsed);
    const shownNow = online ? [raceSys.me, ...remotes()] : racers();
    if (online) for (const [e, s] of states) if (!shownNow.includes(e)) s.aura.visible = s.flame.visible = false; // 나간 사람
    for (const e of shownNow) {
      const s = states.get(e);
      if (!s) continue;
      const c = carOf(e);
      const shield = s.shieldT > 0, shock = s.shockT > 0 && c.itemSlowT > 0;
      const hurt = s.hitFxT > 0;
      if (hurt) s.hitFxT -= dt;
      s.aura.visible = shield || shock || hurt;
      if (s.aura.visible) {
        s.aura.position.copy(c.pos).addScaledVector(c.up, 0.6);
        s.aura.material.color.setHex(hurt ? 0xff5a3a : shield ? 0x6fe0ff : 0xfff25a);
        s.aura.material.opacity = hurt ? 0.5 * Math.max(0, s.hitFxT / 0.6) : shield ? 0.22 + 0.08 * Math.sin(elapsed * 9) : Math.random() < 0.5 ? 0.35 : 0.08;
        s.aura.scale.setScalar(shield && !hurt ? 1 : 0.8);
      }
      s.flame.visible = c.itemBoostT > 0;
      if (s.flame.visible) {
        s.flame.position.copy(c.pos);
        _v.copy(c.pos).add(c.fwd);
        s.flame.up.copy(c.up);
        s.flame.lookAt(_v);
        s.flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
      }
    }
    for (const r of rockets) {
      if (!r.on) continue;
      pointAt(r.d + 3, r.lat, _v);
      pointAt(r.d, r.lat, r.mesh.position);
      r.mesh.lookAt(_v);
    }
    drawHud(dt);
  }
  function usePlayer() {
    const g = window.game;
    if (!visible || (g && g.race && g.race.phase !== 'racing')) return false;
    const ok = use(raceSys.me);
    if (!ok && st(raceSys.me).roulT <= 0) sfx('none');
    return ok;
  }
  function reset() {
    for (const s of states.values()) {
      Object.assign(s, { slots: [null, null], roulT: 0, shieldT: 0, immuneT: 0, holdT: 0, gauge: 0, shockT: 0, hitFxT: 0, noticeT: 0, notice: '', hits: 0, used: 0, picked: 0 });
      s.aura.visible = s.flame.visible = false;
    }
    for (const e of racers()) {
      const c = carOf(e);
      c.itemBoostT = c.itemSlowT = 0;
    }
    for (const row of rows) for (const b of row.boxes) (b.respT = 0), (b.pop = 1);
    for (const oil of oils) (oil.t = 0), (oil.mesh.visible = false);
    for (const r of rockets) (r.on = false), (r.mesh.visible = false);
    raceT = 0;
    hintDone = false;
    hudDirty = true;
  }

  // ---------- 소리 (합성음, N 키로 같이 꺼짐) ----------
  let ctx = null, out = null, muted = false;
  function initAudio() {
    if (ctx) return ctx.state === 'suspended' && ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = 0.5;
      out.connect(ctx.destination);
    } catch {
      ctx = null;
    }
  }
  window.addEventListener('keydown', initAudio);
  window.addEventListener('pointerdown', initAudio);
  function tone(type, f0, f1, dur, vol, delay = 0) {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }
  function sfx(name) {
    if (!ctx || muted || ctx.state !== 'running' || (window.game && window.game.paused)) return;
    try {
      if (name === 'pick') tone('square', 520, 1040, 0.12, 0.18), tone('square', 780, 1560, 0.12, 0.14, 0.09);
      else if (name === 'ready') tone('triangle', 880, 1320, 0.16, 0.25);
      else if (name === 'boost') tone('sawtooth', 140, 900, 0.55, 0.3), tone('square', 300, 1400, 0.4, 0.1, 0.05);
      else if (name === 'shield') tone('sine', 400, 1200, 0.35, 0.3), tone('sine', 600, 1800, 0.35, 0.15, 0.08);
      else if (name === 'block') tone('triangle', 1400, 500, 0.25, 0.35);
      else if (name === 'drop') tone('sine', 300, 70, 0.3, 0.35);
      else if (name === 'rocket') tone('sawtooth', 220, 1500, 0.45, 0.25);
      else if (name === 'warn') tone('square', 980, 980, 0.1, 0.22), tone('square', 980, 980, 0.1, 0.22, 0.18), tone('square', 980, 980, 0.1, 0.22, 0.36);
      else if (name === 'hit') tone('sawtooth', 320, 50, 0.4, 0.4), tone('square', 90, 40, 0.3, 0.3);
      else if (name === 'shock') tone('square', 1800, 200, 0.3, 0.2), tone('sawtooth', 90, 60, 0.35, 0.25);
      else if (name === 'none') tone('square', 180, 150, 0.08, 0.12);
    } catch {}
  }

  // ---------- 온라인: 다른 사람이 쓴 아이템 받기 (netRace.js가 넘겨 줌) ----------
  function netRecv(m, from) {
    if (!online || !m || from === myPid) return;
    const ent = remotes().find((e) => pidOf(e) === from) || null;
    const who = ent || { remote: true, id: 'net:' + from, name: m.n || '상대', progress: 0, view: { pos: new THREE.Vector3(), up: UP, fwd: UP } };
    const me = raceSys.me;
    if (m.k === 'fx') {
      if (!ent) return;
      if (m.fx === 'boost') carOf(ent).itemBoostT = CFG.boostSec;
      else if (m.fx === 'shield') st(ent).shieldT = CFG.shieldSec;
      else if (m.fx === 'block') st(ent).shieldT = 0;
    } else if (m.k === 'oil' && Array.isArray(m.p)) {
      const slot = oils.find((x) => x.t <= 0) || oils.reduce((a, b) => (a.t < b.t ? a : b));
      slot.t = CFG.oilSec;
      slot.owner = who;
      slot.ownerT = 0;
      slot.id = m.oid;
      slot.pos.fromArray(m.p);
      _v.fromArray(m.u || [0, 1, 0]).normalize();
      slot.mesh.position.copy(slot.pos).addScaledVector(_v, 0.06);
      slot.mesh.quaternion.setFromUnitVectors(UP, _v);
      slot.mesh.visible = visible;
    } else if (m.k === 'oilgone') {
      for (const oil of oils) if (oil.id === m.oid && oil.t > 0) (oil.t = 0), (oil.mesh.visible = false);
    } else if (m.k === 'rocket') {
      const r = rockets.find((x) => !x.on);
      if (!r) return;
      const tgt = m.to === myPid ? me : remotes().find((e) => pidOf(e) === m.to) || null;
      Object.assign(r, { on: true, owner: who, target: tgt, d: +m.d || 0, lat: +m.lat || 0, v: Math.max(CFG.rocketMin, +m.v || 0), life: tgt ? CFG.rocketLife : 2.5 });
      pointAt(r.d, r.lat, r.mesh.position);
      r.mesh.visible = visible;
      if (tgt === me) sfx('warn');
    } else if (m.k === 'shock') {
      if (me.finished || !(me.progress > m.pr)) return;
      const s = st(me);
      if (s.shieldT > 0) {
        s.shieldT = 0;
        hudDirty = true;
        say('🛡 방어막이 전기 충격을 막았어요!');
        send({ k: 'fx', fx: 'block' });
        return;
      }
      carOf(me).itemSlowT = CFG.shockSec;
      s.shockT = CFG.shockSec;
      say(`⚡ ${who.name}의 전기 충격! 잠깐 느려져요`);
      sfx('shock');
      if (hud.flash) hud.flash('#fff25a', 0.5);
    } else if (m.k === 'hit') {
      if (ent && !m.blocked) st(ent).hitFxT = 0.6;
      if (m.by !== myPid) return;
      if (m.what === 'oil') say(m.blocked ? `🛡 ${who.name}의 방어막이 기름을 막았어요` : `🛢 ${who.name} 님이 내 기름을 밟았어요!`);
      else say(m.blocked ? `🛡 ${who.name}의 방어막에 막혔어요` : `🎯 ${who.name} 명중!`);
      if (!m.blocked) sfx('hit');
    }
  }

  return {
    online,
    /** 온라인: netRace.js가 내 아이디와 보내는 함수를 알려 줌 */
    netInit(pid, sendFn) {
      myPid = pid;
      netSend = sendFn;
    },
    netRecv,
    cfg: CFG, rows, oils, rockets, states,
    step, update, usePlayer, reset, setVisible,
    setMuted(m) {
      muted = !!m;
    },
    /** 테스트: 플레이어(또는 who = raceSys.bots[n])에게 아이템 주기 */
    give(kind, who) {
      return giveTo(who || raceSys.me, kind, true);
    },
    use(who) {
      return use(who || raceSys.me);
    },
    get state() {
      const s = st(raceSys.me);
      return { slots: s.slots.slice(), gauge: s.gauge, shield: s.shieldT, roulette: s.roulT, rank: rankOf(raceSys.me), boxes: nBox, rows: rows.length, hits: s.hits, used: s.used, picked: s.picked };
    },
    botStates() {
      return raceSys.bots.map((b) => {
        const s = st(b);
        return { name: b.name, slots: s.slots.slice(), hits: s.hits, used: s.used, picked: s.picked };
      });
    },
    dispose() {
      scene.remove(root);
      box.remove();
      warn.remove();
      css.remove();
      document.body.classList.remove('item-race');
    },
  };
}
