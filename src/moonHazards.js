// 달 중력 기지 moon2 규칙 (2026-11-15, 사용자 "중력이 변하는 거는 의미 없는 거 같아. 주행에서 달라지는 게 없어")
//   1) 크레이터 롱 점프 지름길 (track.cut, 생성기 .debug/moon_gen.py): 갈림길에서 오른쪽 차선 → 램프 → 저중력으로 크레이터를 넘어 착지대.
//      쿠션 없음: 짧게 날면 크레이터에 빠짐 → 0.3초 뒤 갈림길 앞 본 도로로 복귀 (사람·봇 같은 규칙, 봇은 라인만 달려서 안 들어옴)
//   2) 약해진 중력 쿠션 (moonTrack CUSHION): 쿠션에 걸린 동안 앞으로 가는 속도가 줄어듦 = "살려 주지만 늦게 내려서 손해"
//   3) 알림 (사람만): 갈림길 앞 속도 칩(필요 속도 vs 지금), 성공·실패·쿠션 알림, 갈림길 표지판·착지대 불빛·구덩이 붉은 빛
//   &moon2=0 이면 moonTrack이 cut을 안 만들어서 이 파일은 아무것도 안 함 (쿠션 감속도 끔)
import * as THREE from 'three';
import { canvasTexture } from './moonTrack.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const MOON2_CFG = {
  needKmh: 175, // 롱 점프에 필요한 립 속도 (f1 기준 실측으로 맞춤, 표지판·속도 칩 글자)
  guideDeg: 9, // 공중에서 날아가는 방향을 착지대 쪽으로 돌리는 최대 속도 (°/초)
  fall: { below: 2.5, delay: 0.3 }, // 지름길 틈 위 '립→착지대' 선보다 below m 아래로 delay초 → 복귀
  cushion: { minV: 9, rate: 1.2, push: 7 }, // 쿠션에 걸린 동안: 앞 속도가 minV m/s까지 초당 rate 비율로 줄어듦, push m/s보다 느리면 밀어 줌
};

/** 글자 판 텍스처 */
function boardTex(lines, { w = 1024, h = 256, bg = 'rgba(8,14,30,0.92)', accent = '#5ff0ff', arrow = 0 } = {}) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = accent;
    g.lineWidth = 10;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const ax = arrow ? 120 : 0;
    if (arrow) {
      g.fillStyle = accent;
      g.beginPath();
      const cx = arrow < 0 ? 90 : w - 90, d = arrow < 0 ? -1 : 1;
      g.moveTo(cx + d * 50, h / 2);
      g.lineTo(cx - d * 30, h / 2 - 60);
      g.lineTo(cx - d * 30, h / 2 + 60);
      g.fill();
    }
    lines.forEach((ln, k) => {
      g.fillStyle = k === 0 ? '#ffffff' : accent;
      g.font = k === 0 ? '900 86px "Segoe UI","Malgun Gothic",sans-serif' : '700 46px "Segoe UI","Malgun Gothic",sans-serif';
      const y = lines.length === 1 ? h / 2 : k === 0 ? h * 0.38 : h * 0.76;
      g.fillText(ln, w / 2 + (arrow < 0 ? ax / 2 : -ax / 2), y);
    });
  }, false);
}

export function createMoonHazards(track, scene, { showToast = () => {}, chime = () => {} } = {}) {
  const cut = track.cut;
  if (!cut || !track.moon2) return null;
  const S = track.samples, N = S.length - 1, ds = track.length / N;
  const wrap = (i) => ((i % N) + N) % N;
  const HW = track.width / 2;
  const L = cut.samples, H = cut.half;
  const stats = { falls: 0, playerFalls: 0, botFalls: 0, where: [], tries: 0, success: 0, botOnCut: 0, cushion: {}, cushionBots: 0, cushionPlayer: 0, lipKmh: [], landKmh: [] };
  const group = new THREE.Group();
  group.name = 'moonHazards';
  scene.add(group);

  // ---------------------------------------------------------------- 갈림길 표지판 (갈림길 30 m 앞, 길 위로 가로지르는 문 + 판 두 장)
  const M = {
    dark: new THREE.MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.6, metalness: 0.4 }),
    white: new THREE.MeshStandardMaterial({ color: '#e9edf3', roughness: 0.5 }),
    cyan: new THREE.MeshBasicMaterial({ color: '#5ff0ff', toneMapped: false }),
    orange: new THREE.MeshBasicMaterial({ color: '#ffb02e', toneMapped: false }),
    red: new THREE.MeshBasicMaterial({ color: '#ff3b30', toneMapped: false }),
  };
  const iFork = Math.round(cut.tFork * N);
  const UP = new THREE.Vector3(0, 1, 0);
  const basisAt = (s) => new THREE.Matrix4().makeBasis(s.right.clone().negate(), UP, s.tan.clone());
  {
    const s = S[wrap(iFork - Math.round(34 / ds))];
    const g = new THREE.Group();
    const span = HW + (track.curb || 1.6) + 2.6;
    for (const sd of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9, 0.9), M.white);
      leg.position.set(sd * span, 4.5, 0);
      g.add(leg);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.16, 8, 0.16), sd > 0 ? M.cyan : M.orange);
      st.position.set(sd * (span - 0.55), 4.5, 0.5);
      g.add(st);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1, 0.9, 0.9), M.dark);
    beam.position.y = 8.9;
    g.add(beam);
    // 판: 왼쪽 = 본 도로(안전), 오른쪽 = 롱 점프 (차가 오는 쪽(-z)에서 보이게 PI 회전 → 왼·오가 뒤집히므로 x도 뒤집음)
    const mk = (lines, accent, arrow, x, w) => {
      const tex = boardTex(lines, { accent, arrow });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
      m.position.set(x, 7.1, -0.5);
      m.rotation.y = Math.PI;
      g.add(m);
    };
    mk(['테두리 길', '안전 · T4 제동'], '#ffb02e', -1, 4.6, 8.6); // 운전자 왼쪽 (+x가 운전자 왼쪽: 판이 PI 돌아 있음)
    mk(['롱 점프', `${MOON2_CFG.needKmh} km/h 이상 · 쿠션 없음`], '#5ff0ff', 1, -4.6, 8.6);
    g.quaternion.setFromRotationMatrix(basisAt(s));
    g.position.copy(s.pos);
    group.add(g);
  }
  // 오른쪽 차선 도로 칠: 갈림길 70 m 앞부터 오른쪽 반에 하늘색 화살표 (지름길 차선 입구)
  {
    const tex = canvasTexture(128, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = '#5ff0ff';
      c.lineWidth = 14;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(24, 92);
      c.lineTo(64, 40);
      c.lineTo(104, 92);
      c.stroke();
    }, false);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const geo = new THREE.PlaneGeometry(4.5, 4.5);
    const list = [];
    for (let m = 64; m >= 8; m -= 14) list.push(S[wrap(iFork - Math.round(m / ds))]);
    // 차선 안 (램프 앞까지)
    const lane = L.filter((c) => (c.kind === 'lane' || c.kind === 'ramp') && c.q > 10 && c.q < cut.lipQ - 6 && Math.round(c.q) % 14 < 2);
    const im = new THREE.InstancedMesh(geo, mat, list.length + lane.length);
    const m4 = new THREE.Matrix4();
    let n = 0;
    for (const s of list) {
      const p = track.surf(s, HW * 0.5, 0.05, new THREE.Vector3());
      m4.makeBasis(s.rightB, s.tan3, s.up).setPosition(p);
      im.setMatrixAt(n++, m4);
    }
    for (const c of lane) {
      const p = c.pos.clone().addScaledVector(c.up, 0.06);
      m4.makeBasis(c.rightB, c.tan3, c.up).setPosition(p);
      im.setMatrixAt(n++, m4);
    }
    im.count = n;
    im.renderOrder = 2;
    group.add(im);
  }
  // 램프 끝 양옆 경고등 + 착지대 양옆 주황 불빛 줄 + 크레이터 바닥 붉은 빛
  const beacons = [];
  const lampGeo = new THREE.SphereGeometry(0.45, 10, 8);
  for (const sd of [-1, 1]) {
    const p = cut.lip.pos.clone().addScaledVector(cut.lip.right, sd * (H + 1.9));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 2.6, 8), M.dark);
    post.position.copy(p).setY(p.y - 0.6);
    group.add(post);
    const b = new THREE.Mesh(lampGeo, M.cyan.clone());
    b.position.copy(p).setY(p.y + 0.9);
    group.add(b);
    beacons.push({ m: b, ph: 0, on: '#5ff0ff', off: '#0d3a40' });
  }
  {
    const pad = L.filter((c) => c.kind === 'pad');
    const pts = [];
    for (let k = 0; k < pad.length; k += 3) for (const sd of [-1, 1]) pts.push(pad[k].pos.clone().addScaledVector(pad[k].right, sd * (H + 1.9)).addScaledVector(pad[k].up, 0.35));
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), M.orange, pts.length);
    const m4 = new THREE.Matrix4();
    pts.forEach((p, k) => im.setMatrixAt(k, m4.makeTranslation(p.x, p.y, p.z)));
    group.add(im);
    // 착지대 앞 큰 'LAND' 판 (구덩이 건너편에서 보이게 착지대 뒤 끝에 세움)
    const last = pad[pad.length - 1], first = pad[0];
    if (last && first) {
      const tex = boardTex(['LANDING ZONE', '롱 점프 착지대'], { accent: '#ffb02e', w: 1024, h: 256 });
      const g = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
      plate.position.y = 5.2;
      plate.rotation.y = Math.PI;
      g.add(plate);
      for (const sd of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), M.dark);
        leg.position.set(sd * 5.2, 2, 0);
        g.add(leg);
      }
      // 착지대 오른쪽 바깥 (길을 가리지 않게), 구덩이 쪽을 봄
      const s = pad[Math.min(pad.length - 1, 6)];
      g.quaternion.setFromRotationMatrix(basisAt(s));
      g.position.copy(s.pos).addScaledVector(s.right, H + 9);
      g.position.y = s.pos.y - 0.4;
      group.add(g);
    }
  }
  {
    const P = cut.data.pit;
    if (P) {
      const ax = P.x1 - P.x0, az = P.z1 - P.z0;
      for (let k = 0; k < 14; k++) {
        const u = (k + 0.5) / 14, sd = k % 2 ? 1 : -1;
        const hw = (P.halfW0 + (P.halfW1 - P.halfW0) * u) * 0.45;
        const len = Math.hypot(ax, az), ux = ax / len, uz = az / len;
        const x = P.x0 + ax * u - uz * sd * hw * (0.3 + (k % 3) * 0.3), z = P.z0 + az * u + ux * sd * hw * (0.3 + (k % 3) * 0.3);
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), M.red);
        l.position.set(x, track.heightAt(x, z) + 0.7, z);
        group.add(l);
      }
    }
  }

  // ---------------------------------------------------------------- 속도 칩 (사람만): 갈림길 140 m 앞 ~ 램프 끝
  const chip = document.createElement('div');
  chip.id = 'moonCutChip';
  chip.style.cssText =
    'position:fixed;left:50%;top:29%;transform:translateX(-50%);z-index:5;pointer-events:none;opacity:0;transition:opacity .2s;' +
    'padding:6px 14px 7px;border-radius:12px;background:rgba(8,12,26,0.7);border:1px solid rgba(95,240,255,0.55);' +
    'font:800 17px/1.25 "Segoe UI","Malgun Gothic",sans-serif;color:#eaf6ff;text-align:center;white-space:nowrap';
  if (document.body) document.body.append(chip);
  let chipShown = false, chipTxt = '';
  function setChip(on, html, color) {
    if (on !== chipShown) {
      chip.style.opacity = on ? '1' : '0';
      chipShown = on;
    }
    if (on && html !== chipTxt) {
      chip.innerHTML = html;
      chip.style.borderColor = color;
      chip.style.boxShadow = `0 0 14px ${color}55`;
      chipTxt = html;
    }
  }

  // ---------------------------------------------------------------- 매 물리 스텝: 차마다 (사람·봇 같은 규칙)
  const state = new WeakMap();
  const chordY = (q) => {
    const a = cut.lip, b = cut.pad;
    const u = THREE.MathUtils.clamp((q - a.q) / Math.max(1, b.q - a.q), 0, 1);
    return a.pos.y + (b.pos.y - a.pos.y) * u;
  };
  const CF = MOON2_CFG.cushion, FL = MOON2_CFG.fall, GUIDE = THREE.MathUtils.degToRad(MOON2_CFG.guideDeg);
  let toastCool = 0;
  function stepCar(car, dt, isPlayer, name) {
    let st = state.get(car);
    if (!st) state.set(car, (st = { fallT: 0, air: null, cushT: 0, cushShown: false, onCutT: 0 }));
    if (car.events.includes('respawn')) (st.fallT = 0), (st.air = null);
    // (가) 약해진 쿠션: 걸린 동안 앞 속도를 깎음 (사람·봇 같음)
    const ti = car.trackInfo;
    if (ti && !car.grounded && !car.flying && track.cushionAt) {
      // 쿠션이 차를 떠받치는 동안(중력이 0보다 작아질 만큼 깊이 = 느리게 뛰어 가라앉은 차)만. 제대로 뛴 차는 쿠션 판보다 높이 날아 안 걸림
      const sc = S[ti.index % N];
      const d0 = sc.cushionOff !== undefined ? track.cushionAt(car.pos, sc) : 0;
      const d = d0 > sc.grav / (track.cushion ? track.cushion.K : 0.7) + 0.1 ? d0 : 0;
      if (d > 0) {
        const vx = car.vel.x, vz = car.vel.z, vh = Math.hypot(vx, vz);
        if (vh > CF.minV) {
          const k = (vh - (vh - CF.minV) * (1 - Math.exp(-CF.rate * dt))) / vh;
          car.vel.x *= k;
          car.vel.z *= k;
        } else if (vh < CF.push) {
          const s = S[ti.index % N];
          car.vel.x += s.tan.x * (CF.push - vh) * Math.min(1, dt * 3);
          car.vel.z += s.tan.z * (CF.push - vh) * Math.min(1, dt * 3);
        }
        st.cushT += dt;
        stats.cushion[name] = +((stats.cushion[name] || 0) + dt).toFixed(2);
        if (isPlayer && !st.cushShown && st.cushT > 0.3) {
          st.cushShown = true;
          stats.cushionPlayer++;
          showToast('🫧 중력 쿠션', '느리게 뛰어 쿠션에 걸렸어요 — 살았지만 속도를 잃어요', '#7ff3ff');
        } else if (!isPlayer && st.cushT > 0.3 && !st.cushCounted) (st.cushCounted = true), stats.cushionBots++;
      } else if (car.grounded) (st.cushT = 0), (st.cushShown = false), (st.cushCounted = false);
    } else if (car.grounded) (st.cushT = 0), (st.cushShown = false), (st.cushCounted = false);

    // (나) 지름길: 위치
    const n = track.cutNear(car.pos);
    if (!n || car.flying) {
      st.fallT = 0;
      return;
    }
    if (!isPlayer && track.onAltPath(car.pos, 0)) stats.botOnCut += dt;
    // 착지 유도 (램프 ~ 착지대): 공중에서 날아가는 방향을 착지대 가운데 쪽으로 초당 최대 GUIDE° (높이·거리는 그대로 = 속도가 모자라면 그대로 떨어짐)
    //   램프 앞 굽이(반지름 350)를 고속으로 돌면 차가 조금 바깥(왼쪽)으로 미끄러진 채 떠서, 100 m 비행 뒤 착지대 옆으로 떨어졌음
    if (!car.grounded && n.q > cut.lipQ - 2 && n.q < cut.pad1 && Math.abs(n.lat) < H + 20) {
      const tgt = L[Math.min(L.length - 1, n.k + 12)];
      const vx = car.vel.x, vz = car.vel.z, vl = Math.hypot(vx, vz);
      if (vl > 3) {
        const want = Math.atan2(tgt.pos.z - car.pos.z, tgt.pos.x - car.pos.x), have = Math.atan2(vz, vx);
        let d = want - have;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const a = THREE.MathUtils.clamp(d, -GUIDE * dt, GUIDE * dt), ca = Math.cos(a), sa = Math.sin(a);
        car.vel.x = vx * ca - vz * sa;
        car.vel.z = vx * sa + vz * ca;
      }
    }
    // 공중 자세 잡기 (램프 ~ 착지대 뒤): 차 머리를 날아가는 방향으로 천천히 (moonProps airAlign과 같음)
    if (!car.grounded && n.q > cut.lipQ - 6 && n.q < cut.pad1 + 30) {
      const vx = car.vel.x, vz = car.vel.z, vl = Math.hypot(vx, vz), fl = Math.hypot(car.fwd.x, car.fwd.z);
      if (vl > 3 && fl > 0.3) {
        const a = Math.atan2((car.fwd.z * vx - car.fwd.x * vz) / (vl * fl), (car.fwd.x * vx + car.fwd.z * vz) / (vl * fl));
        car.fwd.applyAxisAngle(UP, a * (1 - Math.exp(-5 * dt)));
      }
    }
    // 이륙·착지 기록
    if (!car.grounded && !st.air && n.q > cut.lipQ - 4 && n.q < cut.lipQ + 12 && Math.abs(n.lat) < H + 2) {
      st.air = { v: Math.abs(car.speed) * 3.6, t: 0 };
      if (isPlayer) stats.tries++;
      if (stats.lipKmh.length < 40) stats.lipKmh.push(`${name}:${Math.round(st.air.v)}`);
    }
    if (st.air) {
      st.air.t += dt;
      if (car.grounded && track.onCut(car.pos, 0.5) && n.q >= cut.pad0 - 2) {
        if (isPlayer) {
          stats.success++;
          showToast('🌙 롱 점프 성공!', `${st.air.t.toFixed(1)}초 비행 · 착지 ${Math.round(Math.abs(car.speed) * 3.6)} km/h`, '#5ff0ff');
          chime('low');
        }
        if (stats.landKmh.length < 40) stats.landKmh.push(`${name}:${Math.round(Math.abs(car.speed) * 3.6)}/${st.air.t.toFixed(2)}s`);
        st.air = null;
      } else if (car.grounded && st.air.t > 0.3) st.air = null;
    }
    // 크레이터에 빠짐: 틈 구간에서 '립→착지대' 선보다 below m 아래 (땅에 닿아 있어도)
    const inGap = n.q > cut.lipQ - 1 && n.q < cut.pad0 + 10 && Math.abs(n.lat) < H + 26;
    const onMain = ti && ti.dist < HW + 4.6 && Math.abs(car.pos.y - S[ti.index % N].pos.y) < 3; // 본 도로(테두리 길) 위 차는 빼고
    const falling = inGap && !onMain && car.pos.y < chordY(n.q) - FL.below && !(car.grounded && track.onCut(car.pos, 0));
    st.fallT = falling ? st.fallT + dt : 0;
    if (st.fallT > FL.delay) {
      st.fallT = 0;
      st.air = null;
      car.respawn();
      stats.falls++;
      if (isPlayer) stats.playerFalls++;
      else stats.botFalls++;
      if (stats.where.length < 60) stats.where.push(`${name}@q${Math.round(n.q)}`);
      if (isPlayer) showToast('🕳 크레이터에 빠졌어요!', `롱 점프는 립에서 ${MOON2_CFG.needKmh} km/h 이상 · 똑바로`, '#ff8a5a');
    }
  }

  // 속도 칩: 갈림길 140 m 앞 ~ 램프 끝 (사람만)
  function chipFor(car) {
    const ti = car.trackInfo;
    if (!ti) return setChip(false);
    let d = (iFork - ti.index) * ds;
    if (d < -track.length / 2) d += track.length;
    const n = track.cutNear(car.pos);
    const onLane = n && !n.c.gap && n.q < cut.lipQ + 2 && Math.abs(n.lat) < H + 1.5 && n.q > 4;
    if (!((d > -2 && d < 140) || onLane) || car.flying) return setChip(false);
    const v = Math.abs(car.speed) * 3.6, need = MOON2_CFG.needKmh, ok = v >= need;
    const color = ok ? '#5fff9a' : '#ff8a5a';
    setChip(true, `🚀 롱 점프 <span style="opacity:.75;font-weight:700">필요 ${need}</span> · <span style="color:${color}">지금 ${Math.round(v)} km/h ${ok ? '✓' : '✗'}</span>` + (onLane ? '' : '<div style="font-size:12px;font-weight:700;opacity:.8">오른쪽 차선 = 지름길 · 왼쪽 = 안전한 길</div>'), color);
  }

  function update(dt, car) {
    if (!car) return;
    stepCar(car, dt, true, 'P');
    const rs = window.game && window.game.raceSys;
    if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car !== car) stepCar(b.car, dt, false, b.name);
    chipFor(car);
    if (toastCool > 0) toastCool -= dt;
  }
  function animate(time) {
    const on = Math.sin(time * 6) > 0;
    for (const b of beacons) b.m.material.color.set(on ? b.on : b.off);
  }
  function reset() {
    setChip(false);
  }
  return { group, update, animate, reset, stats, cfg: MOON2_CFG };
}
