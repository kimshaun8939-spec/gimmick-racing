// 차체 모양: buildGT (썬더 GT, 미드나잇 쿠페). 변신 부품·바퀴 등 공통 부분은 carModel.js
// 2026-11-12: 휠 아치를 포함한 연속 차체, 곡선 패스트백, 얇은 램프와 둥근 날개.
// 차체 모양만 바꾸며 물리와 변신 부품의 자리(A)는 유지한다.
import * as THREE from 'three';
import { R, doorNumber, loft, makeHelmet, rodGeometry } from './carModel.js';

// ---- 이 파일 안에서만 쓰는 도우미
/** 여러 조각을 한 덩어리로 (그리는 횟수 줄이기) */
function merge(geos) {
  const pos = [], nor = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const n of g.attributes.position.array) pos.push(n);
    for (const n of g.attributes.normal.array) nor.push(n);
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}
/** 자리·기울기를 미리 넣은 상자 */
function bx(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
}
/** 앞뒤(z) 방향으로 누운 원통 */
function cz(r0, r1, len, x, y, z, seg = 12, open = false) {
  return new THREE.CylinderGeometry(r0, r1, len, seg, 1, open).rotateX(Math.PI / 2).translate(x, y, z);
}
/** 차체 윗면을 따라가는 얇은 띠 ([z, 윗면 높이] 목록, 가운데 x, 반폭) */
function ribbon(pts, x, hw, th = 0.012) {
  return loft(pts.map(([z, y]) => R(z, hw, y - 0.012, y + th, 4, x)), 8);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 큰 면이 앞뒤로 이어지는 차체. 바퀴 위에서는 아래 테두리도 들어 올려 실제 휠 아치를 만든다.
function shellGeometry() {
  const sections = [[2.94, .64, .53, .27], [2.74, .88, .62, .22], [2.22, 1.025, .70, .22],
    [1.62, 1.04, .76, .22], [.7, .97, .82, .23], [-.2, .96, .83, .24],
    [-1.5, 1.075, .87, .25], [-2.15, 1.04, .89, .26], [-2.58, .91, .82, .31], [-2.67, .79, .74, .37]];
  const sample = (z) => {
    let i = 0;
    while (i < sections.length - 2 && z < sections[i + 1][0]) i++;
    const a = sections[i], b = sections[i + 1];
    const u = THREE.MathUtils.clamp((a[0] - z) / (a[0] - b[0]), 0, 1), t = u * u * (3 - 2 * u);
    return a.slice(1).map((n, j) => THREE.MathUtils.lerp(n, b[j + 1], t));
  };
  const pos = [], idx = [], N = 36;
  const ring = [[0, 1], [.48, .99], [.78, .97], [.95, .86], [1, .63], [1, 0], [.69, 0], [.58, 0], [0, 0],
    [-.58, 0], [-.69, 0], [-1, 0], [-1, .63], [-.95, .86], [-.78, .97], [-.48, .99]];
  for (let i = 0; i <= N; i++) {
    const z = THREE.MathUtils.lerp(2.94, -2.67, i / N), [w, top, floor] = sample(z);
    const fender = .16 * Math.exp(-Math.pow((z - 1.62) / .55, 2)) + .12 * Math.exp(-Math.pow((z + 1.5) / .62, 2));
    let cut = floor;
    for (const [zw, r] of [[1.62, .37], [-1.5, .4]]) {
      const dz = z - zw, opening = r + .046;
      if (Math.abs(dz) < opening) cut = Math.max(cut, r + Math.sqrt(opening * opening - dz * dz));
    }
    for (const [xf, yf] of ring) {
      const low = Math.abs(xf) >= .69 ? cut : floor;
      const high = Math.max(top + fender * xf * xf, low + .065);
      pos.push(xf * w, THREE.MathUtils.lerp(low, high, yf), z);
    }
  }
  const M = ring.length;
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c = a + M, d = b + M;
    idx.push(a, b, c, b, d, c);
  }
  for (const [row, front] of [[0, true], [N, false]]) {
    const start = pos.length / 3, z = row ? -2.67 : 2.94, [, top, floor] = sample(z);
    pos.push(0, (top + floor) / 2, z);
    for (let j = 0; j < M; j++) for (let k = 0; k < 3; k++) pos.push(pos[(row * M + j) * 3 + k]);
    for (let j = 0; j < M; j++) {
      const a = start + 1 + j, b = start + 1 + (j + 1) % M;
      if (front) idx.push(start, b, a); else idx.push(start, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 모서리에 실제 둥근 두께를 두어 얇은 빛이 흐르게 한다.
function softBox(w, h, d, x, y, z, radius = .025, rx = 0, ry = 0) {
  const r = Math.min(radius, w * .24, h * .24, d * .24), sh = new THREE.Shape();
  const a = w / 2 - r, b = h / 2 - r;
  sh.moveTo(-a, -h / 2); sh.lineTo(a, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -b);
  sh.lineTo(w / 2, b); sh.quadraticCurveTo(w / 2, h / 2, a, h / 2);
  sh.lineTo(-a, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, b);
  sh.lineTo(-w / 2, -b); sh.quadraticCurveTo(-w / 2, -h / 2, -a, -h / 2);
  return new THREE.ExtrudeGeometry(sh, { depth: d - 2 * r, steps: 1, bevelEnabled: true,
    bevelSize: r, bevelThickness: r, bevelSegments: 1, curveSegments: 2 })
    .translate(0, 0, -d / 2 + r).rotateX(rx).rotateY(ry).translate(x, y, z);
}

function smoothLoft(sections, sides = 12) {
  const dense = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    for (let j = 0; j < 2; j++) {
      const t = j / 2, u = t * t * (3 - 2 * t), s = {};
      for (const k of ['w', 'h', 'y', 'x', 'n']) s[k] = THREE.MathUtils.lerp(a[k] || 0, b[k] || 0, u);
      s.z = THREE.MathUtils.lerp(a.z, b.z, t); dense.push(s);
    }
  }
  dense.push(sections[sections.length - 1]);
  return loft(dense, sides);
}

export function buildGT({ add, body, M }) {
  const { paint, accent, trim, carbon, dark, metal, glass, lamp, tailMat } = M;
  const W = [
    [-0.88, 1.62, true, 0.37, 0.3, 0.42],
    [0.88, 1.62, true, 0.37, 0.3, 0.42],
    [-0.9, -1.5, false, 0.4, 0.38, 0.45],
    [0.9, -1.5, false, 0.4, 0.38, 0.45],
  ];
  // 문·앞뒤 펜더·범퍼를 한 표면으로 연결한다.
  add(shellGeometry(), paint, 0, 0, 0);
  // 유리 지붕(캐빈) + 차체색 지붕판
  add(smoothLoft([R(1.02, .65, .8, .84, 3), R(.35, .65, .82, 1.2, 3), R(-.5, .63, .84, 1.28, 3), R(-1.3, .61, .86, 1.12, 3), R(-1.98, .58, .88, .95, 3)]), glass, 0, 0, 0);
  add(smoothLoft([R(.3, .56, 1.19, 1.235, 3), R(-.1, .60, 1.25, 1.295, 3), R(-.6, .60, 1.26, 1.3, 3), R(-1.05, .57, 1.18, 1.23, 3)]), paint, 0, 0, 0);
  for (const side of [-1, 1]) {
    // 가운데 기둥(B필러) + 옆 유리 아래 크롬 띠
    const bp = add(new THREE.BoxGeometry(0.05, 0.36, 0.12), paint, side * 0.66, 1.05, -0.6);
    bp.rotation.z = side * -0.12;
    add(new THREE.BoxGeometry(0.012, 0.012, 2.2), trim, side * 0.655, 0.86, -0.45).castShadow = false;
  }
  // 창틀: 앞 기둥(A필러) + 지붕 옆 테 + 와이퍼 + 앞유리 위 색 띠
  add(merge([
    rodGeometry(V(0.66, 0.83, 1.0), V(0.57, 1.17, 0.34), 0.028), rodGeometry(V(-0.66, 0.83, 1.0), V(-0.57, 1.17, 0.34), 0.028),
    rodGeometry(V(0.57, 1.17, 0.34), V(0.56, 1.2, -1.0), 0.024), rodGeometry(V(-0.57, 1.17, 0.34), V(-0.56, 1.2, -1.0), 0.024),
    rodGeometry(V(0.56, 1.2, -1.0), V(0.6, 0.9, -1.95), 0.026), rodGeometry(V(-0.56, 1.2, -1.0), V(-0.6, 0.9, -1.95), 0.026),
    rodGeometry(V(0.05, 0.87, 1.0), V(0.42, 0.95, 0.86), 0.012), rodGeometry(V(-0.45, 0.87, 1.0), V(-0.08, 0.95, 0.86), 0.012),
    bx(0.5, 0.03, 0.16, 0, 0.845, 1.08, 0.1),
  ]), carbon, 0, 0, 0);
  const band = add(bx(1.02, 0.014, 0.09, 0, 1.165, 0.42, 0.52), carbon, 0, 0, 0);
  band.castShadow = false;
  // 보닛 가운데 파워 벌지 + 그 위 쌍줄 스트라이프 (보닛 → 지붕 → 트렁크)
  const HOOD = [[2.55, .67], [2.22, .723], [1.62, .785], [1.05, .823]];
  add(smoothLoft([R(2.6, .2, .61, .655, 3), R(2.22, .26, .65, .72, 3), R(1.62, .30, .7, .782, 3), R(1.05, .32, .75, .82, 3)], 20), paint, 0, 0, 0);
  const stripes = [];
  for (const sx of [-0.1, 0.1]) {
    stripes.push(ribbon(HOOD, sx, .041), smoothLoft([
      R(.3, .041, 1.237, 1.242, 4, sx), R(-.1, .041, 1.297, 1.302, 4, sx),
      R(-.6, .041, 1.302, 1.307, 4, sx), R(-1.05, .041, 1.232, 1.237, 4, sx),
    ], 8));
    stripes.push(ribbon([[2.90, .55], [2.74, .63], [2.56, .67]], sx, .041));
  }
  add(merge(stripes), accent, 0, 0, 0).castShadow = false;
  // 보닛 통풍구 (검은 홈 + 차체색 살 3개), 앞바퀴 위 펜더 루버
  const holes = [], slats = [];
  for (const side of [-1, 1]) {
    holes.push(softBox(.20, .012, .36, side * .48, .80, 1.34, .003, .06));
    for (let i = 0; i < 2; i++) slats.push(bx(.18, .014, .025, side * .48, .805 + i * .008, 1.44 - i * .13, .25));
  }
  add(merge(holes), dark, 0, 0, 0).castShadow = false;
  add(merge(slats), paint, 0, 0, 0).castShadow = false;
  // ---------------------------------------------------------------- 앞: 큰 아래 그릴(살 + 테) + 옆 흡입구 + 헤드라이트 뭉치
  add(merge([softBox(.98, .15, .035, 0, .365, 2.952, .008), bx(0.26, 0.11, 0.04, 0.72, 0.36, 2.79, 0, 0.5), bx(0.26, 0.11, 0.04, -0.72, 0.36, 2.79, 0, -0.5)]), dark, 0, 0, 0);
  add(merge([
    bx(.94, .009, .014, 0, .335, 2.974), bx(.94, .009, .014, 0, .395, 2.974),
    bx(1.0, .010, .014, 0, .445, 2.974), bx(1.0, .010, .014, 0, .287, 2.974),
    bx(0.24, 0.014, 0.02, 0.725, 0.36, 2.81, 0, 0.5), bx(0.24, 0.014, 0.02, -0.725, 0.36, 2.81, 0, -0.5),
  ]), trim, 0, 0, 0).castShadow = false;
  add(bx(.14, .045, .008, 0, .365, 2.985), accent, 0, 0, 0).castShadow = false;
  const housings = [], drls = [];
  for (const side of [-1, 1]) {
    // 어두운 얇은 렌즈 안에 두 줄의 시그니처 램프를 넣는다.
    housings.push(softBox(.38, .045, .28, side * .65, .650, 2.52, .009, .25, side * .16));
    for (const dz of [-.065, .065]) drls.push(softBox(.30, .018, .025, side * .65, .681 - dz * .25, 2.52 + dz, .004, .25, side * .16));
  }
  add(merge(housings), dark, 0, 0, 0).castShadow = false;
  add(merge(drls), lamp, 0, 0, 0).castShadow = false;
  // ---------------------------------------------------------------- 옆: 펜더 배출구 + 문 선·손잡이 + 뒷바퀴 앞 흡입구 + 사이드 스커트 + 백미러
  const sideDark = [], sideTrim = [], sidePaint = [], sideAccent = [], sideMetal = [], sideCarbon = [];
  for (const side of [-1, 1]) {
    const X = side * 1.0;
    sideDark.push(bx(0.02, 0.16, 0.36, side * 0.996, 0.6, 0.98)); // 앞바퀴 뒤 공기 배출구
    sideAccent.push(bx(.012, .009, .24, side * 1.005, .635, .98));
    // 문 선 (앞·뒤·아래), 손잡이
    sideDark.push(bx(.012, .40, .009, side * .979, .55, .72), bx(.012, .40, .009, side * .979, .55, -.68));
    sideMetal.push(bx(.018, .018, .12, side * .98, .75, -.5));
    // 뒷바퀴 앞 흡입구 (검은 입 + 차체색 날)
    sideDark.push(bx(0.03, 0.2, 0.26, side * 0.99, 0.56, -0.88));
    sidePaint.push(bx(0.05, 0.22, 0.03, side * 1.0, 0.56, -1.02, 0, side * -0.5));
    sideTrim.push(bx(0.024, 0.014, 0.24, side * 1.004, 0.67, -0.88));
    // 사이드 스커트 (카본 + 색 줄) + 뒤 끝 작은 날
    sideCarbon.push(bx(0.05, 0.08, 2.34, X, 0.265, 0.05), bx(0.03, 0.12, 0.18, side * 1.03, 0.3, -1.02));
    sideTrim.push(bx(0.02, 0.02, 2.3, side * 1.028, 0.31, 0.05));
    // 백미러: 받침 + 차체색 통 + 색 띠 + 거울
    sideCarbon.push(bx(0.14, 0.02, 0.05, side * 0.76, 0.94, 0.76), bx(0.02, 0.085, 0.012, side * 0.85, 0.975, 0.705));
    sidePaint.push(softBox(.19, .075, .13, side * .85, .975, .765, .016));
    sideAccent.push(bx(.16, .009, .10, side * .85, 1.012, .765));
    // 주유구 (오른쪽 뒤 펜더 위)
    if (side > 0) sideMetal.push(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 12).translate(side * 0.74, 0.985, -1.75));
  }
  add(merge(sideDark), dark, 0, 0, 0).castShadow = false;
  add(merge(sideTrim), trim, 0, 0, 0).castShadow = false;
  add(merge(sidePaint), paint, 0, 0, 0);
  add(merge(sideAccent), accent, 0, 0, 0).castShadow = false;
  add(merge(sideMetal), metal, 0, 0, 0).castShadow = false;
  add(merge(sideCarbon), carbon, 0, 0, 0);
  doorNumber(add, M, .978, .56, .05, .34);
  // ---------------------------------------------------------------- 뒤: 넓은 트윈 램프, 범퍼 안에 들어간 디퓨저
  add(merge([softBox(1.55, .14, .03, 0, .69, -2.667, .007), softBox(1.55, .13, .06, 0, .39, -2.64, .014)]), dark, 0, 0, 0).castShadow = false;
  const tails = [];
  for (const side of [-1, 1]) for (const dy of [-.029, .029]) tails.push(softBox(.55, .021, .025, side * .46, .69 + dy, -2.692, .005));
  tails.push(bx(0.3, 0.02, 0.02, 0, 1.0, -1.93)); // 뒷유리 아래 보조 브레이크등
  add(merge(tails), tailMat, 0, 0, 0).castShadow = false;
  add(softBox(.3, .085, .015, 0, .51, -2.687, .005), carbon, 0, 0, 0).castShadow = false;
  const fins = [bx(1.42, .035, .44, 0, .25, -2.45, -.20)];
  for (const x of [-0.56, -0.19, 0.19, 0.56]) fins.push(bx(0.025, 0.13, 0.4, x, 0.25, -2.5, -0.32));
  fins.push(softBox(1.65, .08, .07, 0, .35, -2.64, .016));
  add(merge(fins), carbon, 0, 0, 0);
  const tipsM = [], tipsD = [];
  for (const x of [-0.45, -0.3, 0.3, 0.45]) {
    tipsM.push(cz(0.062, 0.066, 0.24, x, 0.31, -2.6, 12, true), new THREE.TorusGeometry(0.064, 0.012, 5, 12).translate(x, 0.31, -2.72));
    tipsD.push(new THREE.CircleGeometry(0.058, 12).rotateY(Math.PI).translate(x, 0.31, -2.66));
  }
  add(merge(tipsM), M.darkMetal, 0, 0, 0);
  add(merge(tipsD), dark, 0, 0, 0).castShadow = false;
  // 덕테일 (트렁크 끝이 살짝 들림) + 지붕 안테나
  add(smoothLoft([R(-2.25, .95, .86, .90, 4), R(-2.45, .92, .87, .93, 4), R(-2.63, .80, .84, .91, 4)], 32), paint, 0, 0, 0);
  add(rodGeometry(V(0.25, 1.28, -0.85), V(0.25, 1.5, -1.05), 0.008), carbon, 0, 0, 0).castShadow = false;

  // 앞 립 스포일러 (부스터 충각이 덮을 때 살짝 좁아짐)
  const fWing = new THREE.Group();
  body.add(fWing);
  add(merge([
    bx(1.84, 0.03, 0.34, 0, 0.19, 2.8), bx(0.03, 0.09, 0.3, 0.92, 0.225, 2.76), bx(0.03, 0.09, 0.3, -0.92, 0.225, 2.76),
    bx(0.26, 0.02, 0.15, 0.84, 0.4, 2.68, 0, 0, 0.25), bx(0.26, 0.02, 0.15, -0.84, 0.4, 2.68, 0, 0, -0.25),
    bx(0.03, 0.08, 0.05, 0.3, 0.235, 2.9), bx(0.03, 0.08, 0.05, -0.3, 0.235, 2.9),
  ]), carbon, 0, 0, 0, fWing);
  add(bx(1.8, 0.012, 0.03, 0, 0.207, 2.955), trim, 0, 0, 0, fWing).castShadow = false;

  // 뒷날개 (짧은 기둥 위 넓은 날개)
  const spoiler = new THREE.Group();
  body.add(spoiler);
  add(softBox(1.84, .048, .32, 0, 0, 0, .011), carbon, 0, 1.13, -2.3, spoiler);
  const drs = add(softBox(1.80, .032, .19, 0, 0, 0, .007), paint, 0, 1.205, -2.43, spoiler);
  drs.rotation.x = .32;
  add(bx(1.78, .009, .014, 0, 1.252, -2.515, .32), trim, 0, 0, 0, spoiler).castShadow = false;
  const ends = [], necks = [], endTop = [];
  for (const side of [-1, 1]) {
    ends.push(softBox(.025, .15, .40, side * .92, 1.15, -2.34, .006));
    endTop.push(bx(.028, .012, .36, side * .92, 1.231, -2.34));
    // 받침 (트렁크에서 날개 밑으로)
    necks.push(bx(0.045, 0.24, 0.14, side * 0.45, 1.0, -2.2, 0.25), bx(0.1, 0.02, 0.2, side * 0.45, 0.905, -2.16));
  }
  add(merge(ends), paint, 0, 0, 0, spoiler);
  add(merge(endTop), accent, 0, 0, 0, spoiler).castShadow = false;
  add(merge(necks), carbon, 0, 0, 0, spoiler);
  // 옆면 덮개가 위로 열리며 날개가 나오는 통로를 만든다.
  const wingDoors = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * .968, .69, 0);
    body.add(pivot);
    add(softBox(.025, .15, .74, side * .008, -.075, 0, .005), paint, 0, 0, 0, pivot);
    add(bx(.028, .008, .64, side * .008, -.15, 0), carbon, 0, 0, 0, pivot).castShadow = false;
    return { pivot, side };
  });
  const helmet = makeHelmet(add, body, M);
  helmet.position.set(0.3, 0.98, -0.35);
  return {
    helmet, fWing, spoiler, drs,
    poseFly(p) {
      const t = THREE.MathUtils.smoothstep(p, 0, .35);
      for (const { pivot, side } of wingDoors) pivot.rotation.z = side * 1.15 * t;
    },
    A: {
      wheels: W,
      tuck: { f: [0.8, 0.6], r: [0.9, 0.7] },
      helmet: [0.3, 0.98, -0.35],
      visor: [1.12, -0.8],
      armor: { y: 0.8, x: 0.84 },
      ram: { y: 0.12, z: 1.78 },
      spines: [[-0.1, 1.27], [-0.5, 1.3], [-0.95, 1.22], [-1.4, 1.06]],
      booster: { x: 0.36, y0: 0.6, y1: 1.1, z0: -0.85, dz: -1.15 },
      lift: { y: 0.92, z: -2.22, h: 0.3 },
      stab: [0.88, 1.12, -2.34],
      tailFin: [0, 1.28, -0.7],
      wing: [0.92, 0.6, 0.0],
      nitro: { x: 0.68, y: 0.42, z: -2.2, dz: -0.45 },
      vents: [[0.56, 0.76, 1.54], [0.56, 0.772, 1.42], [0.56, 0.785, 1.3]],
      glow: { y: 0.795, z: 1.78, len: 1.4, rot: 0.108, w: 0.05 },
      flames: [[-0.3, 0.31, 0.45, -2.68], [0.3, 0.31, 0.45, -2.68], [-0.45, 0.31, 0.45, -2.68], [0.45, 0.31, 0.45, -2.68]],
      motor: [0.42, 0.38, -2.68],
      spark: [0.9, 0.25, -2.0],
      seams: [1.0, 0.22, 0.05],
      lean: 0.06,
    },
  };
}
