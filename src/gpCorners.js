// 그랑프리 코너 표시 (F1 서킷처럼 "어디서 브레이크, 어디가 에이펙스"를 눈으로 알려 줌)
//
//   - 브레이크 표시판 150 / 100 / 50: 레이싱 라인이 빨갛게 바뀌는 곳(계획한 브레이크 지점)까지 남은 거리.
//     계획 속도가 크게 떨어지는 코너에만, 코너 바깥쪽에 세움 ("50" 판을 지나 조금 뒤에 브레이크)
//   - 코너 번호판 "T1, T2…": 가장 먼 브레이크 판 위 (브레이크가 없는 빠른 코너는 코너 80 m 앞에 따로)
//   - 에이펙스 표시등: 코너 안쪽 연석 바로 바깥의 작은 기둥. 에이펙스를 성공하면 잠깐 초록으로 빛남
//
// 위치는 모두 레이싱 라인과 속도 계획(cornerInfo.js)에서 자동으로 계산 → 맵 모양이 바뀌어도 따라감.
// 구름섬 구간은 흰 F1식 판, 우주 구간은 어두운 판에 네온 글자. 세계가 바뀌면 그쪽 것만 보임.
// 그리기 횟수: 세계마다 판 1개(합친 메시) + 기둥 1개 + 표시등 1개 (InstancedMesh)
import * as THREE from 'three';

const COLS = 8, ROWS = 8, CW = 256, CH = 160; // 글자 그림판 (칸 64개)
const BOARD_W = 2.4, BOARD_H = 1.5, BOARD_Y = 1.1; // 표시판 크기·바닥 높이 (m)
const TAG_W = 1.8, TAG_H = 1.0; // 코너 번호판
const BRAKE_MIN_DROP = 6; // 계획 속도가 이만큼(m/s, 약 22 km/h) 이상 떨어지는 코너에만 브레이크 판
const BOARDS = [150, 100, 50];

/** 글자 그림판: 0~2 = 150/100/50, 3 = 뒷면, 4~ = T1, T2… */
function atlas(space, nums) {
  const c = document.createElement('canvas');
  c.width = COLS * CW;
  c.height = ROWS * CH;
  const g = c.getContext('2d');
  const cell = (k, draw) => {
    const x = (k % COLS) * CW, y = Math.floor(k / COLS) * CH;
    g.save();
    g.translate(x, y);
    draw();
    g.restore();
  };
  const round = (x, y, w, h, r) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  };
  const labels = ['150', '100', '50'];
  labels.forEach((t, k) =>
    cell(k, () => {
      if (space) {
        g.fillStyle = '#0b0820';
        g.fillRect(0, 0, CW, CH);
        g.strokeStyle = '#ff4fd8';
        g.lineWidth = 10;
        round(10, 10, CW - 20, CH - 20, 18);
        g.stroke();
        g.shadowColor = '#4fe8ff';
        g.shadowBlur = 18;
        g.fillStyle = '#bff6ff';
      } else {
        g.fillStyle = '#f4f5f7';
        g.fillRect(0, 0, CW, CH);
        // F1식: 위아래 빨간 띠
        g.fillStyle = '#e10600';
        g.fillRect(0, 0, CW, 16);
        g.fillRect(0, CH - 16, CW, 16);
        g.fillStyle = '#15151e';
      }
      g.font = `900 ${t.length > 2 ? 104 : 116}px system-ui, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t, CW / 2, CH / 2 + 6);
    }),
  );
  cell(3, () => {
    g.fillStyle = space ? '#120d2c' : '#9aa1ad';
    g.fillRect(0, 0, CW, CH);
  });
  nums.forEach((n, j) =>
    cell(4 + j, () => {
      g.fillStyle = space ? '#0b0820' : '#15151e';
      g.fillRect(0, 0, CW, CH);
      g.strokeStyle = space ? '#4fe8ff' : '#ffd21f';
      g.lineWidth = 9;
      round(9, 9, CW - 18, CH - 18, 20);
      g.stroke();
      if (space) (g.shadowColor = '#ff4fd8'), (g.shadowBlur = 16);
      g.fillStyle = space ? '#ffd6f6' : '#ffffff';
      g.font = '900 100px system-ui, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`T${n}`, CW / 2, CH / 2 + 6);
    }),
  );
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createGpCorners(scene, track, car, scenery) {
  const ci = car.cornerInfo;
  const line = track.racingLine;
  if (!ci || !line || !ci.corners.length) return null;
  const N = ci.N, ds = ci.ds;
  const W = (i) => ((i % N) + N) % N;
  const HW = track.width / 2;
  const samples = track.samples;
  const collider = scenery && scenery.addCollider;
  const tmp = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);

  /**
   * 지점 i, 쪽 side(±1)에 세울 자리. 레일이 있으면 레일 바로 뒤, 없으면 연석 밖 3 m (땅이 없으면 null)
   * → { p, s, solid(부딪히는 기둥이 필요한지), space }
   */
  function spot(i, side) {
    // 바깥쪽 3 m → 1.8 m → (땅이 없으면) 반대쪽 순서로 찾아봄
    return spotAt(i, side, 3.0) || spotAt(i, side, 1.8) || spotAt(i, -side, 3.0);
  }
  function spotAt(i, side, gap) {
    const s = samples[W(i)];
    const rail = track.railLimit ? track.railLimit({ lateral: side, index: W(i), sample: s }) : null;
    const base = rail != null ? rail + 0.45 : HW + track.kerbAt(W(i), side) + gap;
    const lat = side * base;
    const p = track.surf(s, lat, 0, new THREE.Vector3());
    // 8자 교차점·다른 길(활주로 등) 바로 옆이면 세우지 않음
    if (track.nearestRaw(tmp.set(p.x, 0, p.z)) < HW + 1.5) return null;
    if (track.onAltPath && track.onAltPath(p, 3)) return null;
    if (!s.space && !s.bridge && rail == null) {
      if (track.fieldAt(p.x, p.z) < 0.5) return null; // 섬 밖 (허공)
      const y = track.heightAt(p.x, p.z);
      if (y === null || Math.abs(y - s.pos.y) > 6) return null;
      p.y = y;
    }
    return { p, s, solid: rail == null && !s.space, space: !!s.space };
  }

  const nums = ci.corners.map((c) => c.num);
  const worlds = { cloud: makeWorld(false), space: makeWorld(true) };
  function makeWorld(space) {
    return { space, pos: [], uv: [], posts: [], lights: [] };
  }
  const cellUV = (k) => {
    const col = k % COLS, row = Math.floor(k / COLS);
    return [col / COLS, 1 - (row + 1) / ROWS, (col + 1) / COLS, 1 - row / ROWS];
  };
  /** 차가 오는 쪽을 보는 판 (앞면 + 회색 뒷면) */
  function addBoard(wd, p, tan, cellK, y0, w, h) {
    const r = new THREE.Vector3(-tan.z, 0, tan.x).normalize(); // 차가 볼 때 오른쪽
    const f = new THREE.Vector3(tan.x, 0, tan.z).normalize();
    const quad = (k, flip, off) => {
      const [u0, v0, u1, v1] = cellUV(k);
      const c = p.clone().addScaledVector(f, off);
      const a = c.clone().addScaledVector(r, -w / 2), b = c.clone().addScaledVector(r, w / 2);
      const P = [
        [a.x, c.y + y0, a.z, u0, v0], [b.x, c.y + y0, b.z, u1, v0], [b.x, c.y + y0 + h, b.z, u1, v1], [a.x, c.y + y0 + h, a.z, u0, v1],
      ];
      const tri = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const t of tri) {
        wd.pos.push(P[t][0], P[t][1], P[t][2]);
        wd.uv.push(P[t][3], P[t][4]);
      }
    };
    quad(cellK, false, 0);
    quad(3, true, 0.04);
  }
  function addPosts(wd, sp, tan, top, w, solid) {
    const r = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    for (const u of [-w * 0.36, w * 0.36]) {
      const x = sp.p.x + r.x * u, z = sp.p.z + r.z * u;
      wd.posts.push({ x, y: sp.p.y, z, h: top, ry: Math.atan2(tan.x, tan.z) });
      // 2026-11-09: 판 기둥은 부딪히지 않음 (가드레일 없는 활주로 입구에서 넓게 나간 차가 가는 기둥에 걸려 멈췄음)
      void solid;
    }
  }

  // ------------------------------------------------ 브레이크 판 + 코너 번호
  const placed = { boards: 0, tags: 0, lights: 0, skipped: [] }; // 디버그: 세운 수, 자리가 없어 못 세운 판
  for (const c of ci.corners) {
    const outSide = -c.side;
    const tagCell = 4 + nums.indexOf(c.num);
    // 짧고 굵은 감속만 (300 m 넘게 천천히 줄어드는 곳은 '브레이크 지점'이 아님)
    const hasBrake = c.drop >= BRAKE_MIN_DROP && c.brakeLen >= 20 && c.brakeLen <= 300;
    let tagDone = false;
    if (hasBrake) {
      // 앞 코너 탈출 뒤에 들어가는 판만 (짧은 직선이면 150 판은 빼고 100·50만)
      const room = c.gapPrev ?? Infinity;
      for (let b = 0; b < BOARDS.length; b++) {
        const dist = BOARDS[b];
        if (dist > room - 25) continue;
        const i = W(c.brakeI - Math.round(dist / ds));
        const sp = spot(i, outSide);
        if (!sp) {
          placed.skipped.push(`T${c.num}:${dist}`);
          continue;
        }
        const wd = sp.space ? worlds.space : worlds.cloud;
        const tan = sp.s.tan;
        addBoard(wd, sp.p, tan, b, BOARD_Y, BOARD_W, BOARD_H);
        let top = BOARD_Y + BOARD_H;
        if (!tagDone) {
          // 가장 먼 판 위에 코너 번호
          addBoard(wd, sp.p, tan, tagCell, top + 0.12, TAG_W, TAG_H);
          top += 0.12 + TAG_H;
          tagDone = true;
          placed.tags++;
        }
        addPosts(wd, sp, tan, top, BOARD_W, sp.solid);
        placed.boards++;
      }
    }
    if (!tagDone) {
      // 빠른 코너: 첫 에이펙스 80 m 앞 바깥쪽에 번호판만
      const i = W(c.apexI - Math.round(80 / ds));
      const sp = spot(i, outSide);
      if (sp) {
        const wd = sp.space ? worlds.space : worlds.cloud;
        addBoard(wd, sp.p, sp.s.tan, tagCell, 1.3, TAG_W, TAG_H);
        addPosts(wd, sp, sp.s.tan, 1.3 + TAG_H, TAG_W, sp.solid);
        placed.tags++;
      }
    }
    // 에이펙스 표시등 (코너 안쪽, 연석 바로 바깥)
    for (const a of c.apexes) {
      const s = samples[a.i];
      const rail = track.railLimit ? track.railLimit({ lateral: c.side, index: a.i, sample: s }) : null;
      const kerbOut = HW + track.kerbAt(a.i, c.side);
      const lat = c.side * (rail != null ? Math.max(rail + 0.35, kerbOut + 0.6) : kerbOut + 1.3);
      const p = track.surf(s, lat, 0, new THREE.Vector3());
      if (!s.space && !s.bridge && rail == null) {
        const y = track.fieldAt(p.x, p.z) >= 0.3 ? track.heightAt(p.x, p.z) : null;
        if (y === null || Math.abs(y - s.pos.y) > 4) continue;
        p.y = y;
      }
      const wd = s.space ? worlds.space : worlds.cloud;
      wd.lights.push({ n: a.n, p });
      placed.lights++;
    }
  }

  // ------------------------------------------------ 메시 만들기
  const groups = {};
  const lightIndex = new Map(); // 에이펙스 번호 → { im, k, base }
  const lit = []; // 빛나는 중 { im, k, base, t }
  const postGeo = new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0);
  // 레일(높이 1 m) 뒤에서도 보이게 머리 등은 1.3 m 위
  const lightGeo = new THREE.CylinderGeometry(0.1, 0.18, 1.5, 8).translate(0, 0.75, 0);
  const capGeo = new THREE.SphereGeometry(0.36, 14, 10).translate(0, 1.75, 0);
  for (const key of ['cloud', 'space']) {
    const wd = worlds[key];
    const g = new THREE.Group();
    g.name = 'gpCorners_' + key;
    g.visible = key === 'cloud';
    groups[key] = g;
    scene.add(g);
    if (wd.pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wd.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(wd.uv, 2));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const map = atlas(wd.space, nums);
      const mat = wd.space ? new THREE.MeshBasicMaterial({ map, toneMapped: false }) : new THREE.MeshLambertMaterial({ map });
      const m = new THREE.Mesh(geo, mat);
      m.name = 'cornerBoards';
      g.add(m);
    }
    if (wd.posts.length) {
      const mat = wd.space ? new THREE.MeshBasicMaterial({ color: '#4fe8ff', toneMapped: false }) : new THREE.MeshLambertMaterial({ color: '#8d949e' });
      const im = new THREE.InstancedMesh(postGeo, mat, wd.posts.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      wd.posts.forEach((p, k) => {
        q.setFromAxisAngle(UPV, p.ry);
        m4.compose(new THREE.Vector3(p.x, p.y - 0.3, p.z), q, new THREE.Vector3(1, p.h + 0.3, 1));
        im.setMatrixAt(k, m4);
      });
      im.computeBoundingSphere();
      g.add(im);
    }
    if (wd.lights.length) {
      // 기둥(흰/어두운) + 머리 등(주황/분홍 → 성공하면 초록)
      const body = new THREE.InstancedMesh(lightGeo, new THREE.MeshLambertMaterial({ color: wd.space ? '#1a1440' : '#f2f2f2' }), wd.lights.length);
      const head = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), wd.lights.length);
      const base = new THREE.Color(track.apexColor || (wd.space ? '#ff4fd8' : '#ff8a1f')); // 맵이 색을 주면 그 색 (달 = 하늘색)
      const m4 = new THREE.Matrix4();
      wd.lights.forEach((l, k) => {
        m4.makeTranslation(l.p.x, l.p.y, l.p.z);
        body.setMatrixAt(k, m4);
        head.setMatrixAt(k, m4);
        head.setColorAt(k, base);
        lightIndex.set(l.n, { im: head, k, base });
      });
      body.computeBoundingSphere();
      head.computeBoundingSphere();
      g.add(body, head);
    }
  }

  const GREEN = new THREE.Color('#5dff7a'), tc = new THREE.Color();
  let inSpace = false;
  return {
    info: ci,
    placed,
    groups,
    /** 에이펙스 성공 → 그 표시등이 잠깐 초록 */
    apexHit(n) {
      const L = lightIndex.get(n);
      if (!L) return;
      L.t = 1.6;
      if (!lit.includes(L)) lit.push(L);
    },
    update(car, dt) {
      const sp = !!track.inSpace;
      if (sp !== inSpace) {
        inSpace = sp;
        groups.cloud.visible = !sp;
        groups.space.visible = sp;
      }
      for (let j = lit.length - 1; j >= 0; j--) {
        const L = lit[j];
        L.t -= dt;
        const u = Math.max(0, Math.min(1, L.t / 0.8));
        L.im.setColorAt(L.k, tc.copy(L.base).lerp(GREEN, u));
        L.im.instanceColor.needsUpdate = true;
        if (L.t <= 0) lit.splice(j, 1);
      }
    },
  };
}
