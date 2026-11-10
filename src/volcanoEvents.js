// 화산 지대 살아 있는 이벤트 (volcanoProps.js가 만들고 매 물리 스텝 update, 매 화면 animate를 부름)
//
//   1) 화산탄: 빛나는 바위가 하늘에서 플레이어 앞쪽으로 떨어짐 (연기·불티 꼬리)
//      - 대부분 길 밖(가장자리 2~15 m 밖, 또는 낭떠러지 아래)에 떨어져 불꽃·먼지·번쩍·쾅
//      - 약 1/3은 앞 도로 위: 1.6초 전부터 빨간 경고 원 + 빛기둥 + 화면 위 "⚠ 화산탄!" → 떨어질 때 반지름 3.5 m 안 차는
//        속도 ×0.85 + 'bump' (옆으로 밀지 않음: 좁은 낭떠러지 길에서 떨어지지 않게). 뒤에 불타는 구덩이가 4초 남고 지나가면 살짝 느려짐
//      - 점프 립·착지 60 m 안에는 안 떨어짐, 출발 신호 중·처음 10초·튜토리얼·리플레이·테스트(game.paused / controlsOverride) 중에는 없음
//        (테스트에서 켜려면 cfg.force = true). 난수는 씨앗이 있어 테스트가 늘 같음
//      - 능선·RIM·T5~T7·용암 헤어핀(T11~T16)은 "화산탄 구역" (더 자주), 분화 직후 12초는 더 자주
//   2) 무너지는 길 가장자리: 좁은 낭떠러지 길에서 차 옆·바로 뒤 가장자리 바위 조각이 떨어져 굴러 내려감 (보기만, 인스턴스 바위)
//   3) 용암 간헐천: 용암 구간 길옆·점프 협곡·분화구 호수에서 주기적으로 우르르 → 높이 솟구침 (보기·소리만)
//   4) 용암 첨벙: 차가 떨어지거나 용암에 빠질 때, 큰 점프 착지 때 불꽃
//   5) 소리 (volcanoAudio.js): 화산 울림·용암 보글보글·낭떠러지 바람 + 분화 쾅·천둥 (거리만큼 늦게)·화산탄 휘익-쾅
//   분화·번개는 풍경(volcanoScenery.js)이 보내는 window 이벤트 'volcano:erupt' {strength} · 'volcano:lightning' {x,y,z}를 들음
//   (없으면 scenery.erupt.n이 바뀌는 것을 보거나, 그것도 없으면 스스로 30~42초마다)
//
//   그리기 호출: 빛 알갱이 1 + 연기 1 + 바닥 무늬(경고 원·구덩이·간헐천 웅덩이) 1 + 빛기둥(경고·간헐천) 1 + 바위(화산탄·조각) 1 = 5
import * as THREE from 'three';
import { createVolcanoAudio } from './volcanoAudio.js';

/** 조절 손잡이 (game.props.events.cfg 로 바로 바꿀 수 있음) */
export const VEV_CFG = {
  seed: 20261110,
  force: false, // true = 테스트(game.paused 등) 중에도 화산탄
  bombs: {
    enabled: true,
    startAfter: 10, // 출발 뒤 몇 초부터
    warn: 1.6, // 도로 위 화산탄: 경고 원이 보이는 시간 = 날아오는 시간 (초)
    radius: 3.5, // 맞는 반지름 (m)
    slow: 0.85, // 맞으면 속도 ×
    craterLife: 4, // 구덩이 남는 시간 (초)
    craterR: 2.8, // 구덩이 반지름 (m)
    craterDrag: 0.25, // 구덩이 위에서 1초에 잃는 속도 비율
    zoneEvery: [2.6, 4.4], // 화산탄 구역: 다음 화산탄까지 (초)
    openEvery: [6, 10], // 나머지 구간
    eruptMul: 0.45, // 분화 직후 간격 ×
    eruptWindow: 12, // 분화 직후 몇 초
    onRoad: 0.3, // 도로 위로 떨어질 확률 (나머지 구간)
    zoneOnRoad: 0.38, // 화산탄 구역
    onRoadGap: 3.5, // 도로 위 화산탄끼리 최소 간격 (초)
    jumpClear: 60, // 점프 립·착지에서 이만큼(m) 안에는 도로 위 화산탄 없음
    minAhead: 45, // 도로 위 화산탄은 적어도 이만큼(m) 앞
    lead: [-0.05, 0.35], // 차가 도착하는 때보다 이만큼(초) 먼저 떨어짐
    onLine: 0.45, // 도로 위 화산탄 중 레이싱 라인 위로 오는 비율 (나머지는 한쪽으로 치우침)
    offRoad: [2, 15], // 길 밖 화산탄: 가장자리에서 m
    zones: ['ridge', 'K1', 'ridge2', 'K2', 'RIM', 'T5', 'T6', 'T7', 'T11', 'T12', 'g', 'T14', 'j', 'T15', 'k', 'T16'],
  },
  crumble: { enabled: true, maxHw: 6.4, perMeter: 0.15, minSpeed: 8 }, // perMeter: 달린 1 m마다 떨어지는 조각 수
  geysers: { enabled: true, period: [7, 11], warn: 1.5, burst: 1.9, height: [16, 30] },
  sound: { enabled: true },
};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = THREE.MathUtils.clamp;

// ================================================================ 알갱이 (Points 하나, 알갱이마다 크기·색·투명도)
const PT_VS = /* glsl */ `
attribute float psize; attribute float palpha; attribute vec3 pcolor;
uniform float uScale;
varying vec3 vC; varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = clamp(psize * uScale / max(d, 0.6), 0.0, 480.0);
  vC = pcolor;
  vA = palpha * (1.0 - smoothstep(520.0, 1200.0, d)) * smoothstep(0.3, 1.2, d);
}`;
const PT_FS = (soft) => /* glsl */ `
varying vec3 vC; varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float m = ${soft ? '(1.0 - r) * (1.0 - r * 0.5)' : 'pow(1.0 - r, 1.6)'};
  gl_FragColor = vec4(vC, vA * m);
}`;
function makeParticles(max, additive, name) {
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  const vel = new Float32Array(max * 3), c0 = new Float32Array(max * 3), c1 = new Float32Array(max * 3);
  const life = new Float32Array(max), maxL = new Float32Array(max), s0 = new Float32Array(max), s1 = new Float32Array(max), a0 = new Float32Array(max), grav = new Float32Array(max), drag = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const aAlpha = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('pcolor', aCol);
  geo.setAttribute('psize', aSize);
  geo.setAttribute('palpha', aAlpha);
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 } },
    vertexShader: PT_VS,
    fragmentShader: PT_FS(!additive),
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.name = name;
  points.frustumCulled = false;
  points.userData.noBatch = true;
  points.renderOrder = additive ? 3 : 2;
  let n = 0;
  const P = { points, mat, max, get count() { return n; } };
  /** 알갱이 하나: 위치, 속도, 수명, 크기(처음→끝), 투명도, 중력(+ 아래로), 공기 저항, 색(처음 rgb → 끝 rgb) */
  P.spawn = (x, y, z, vx, vy, vz, L, sz0, sz1, al, g, dr, r0, g0, b0, r1, g1, b1) => {
    if (n >= max) return;
    const i = n++, o = i * 3;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
    c0[o] = r0; c0[o + 1] = g0; c0[o + 2] = b0;
    c1[o] = r1; c1[o + 1] = g1; c1[o + 2] = b1;
    col[o] = r0; col[o + 1] = g0; col[o + 2] = b0;
    life[i] = 0; maxL[i] = L; s0[i] = sz0; s1[i] = sz1; a0[i] = al; grav[i] = g; drag[i] = dr;
    size[i] = sz0;
    alpha[i] = al;
  };
  function move(d, s) {
    const od = d * 3, os = s * 3;
    for (let k = 0; k < 3; k++) {
      pos[od + k] = pos[os + k];
      vel[od + k] = vel[os + k];
      c0[od + k] = c0[os + k];
      c1[od + k] = c1[os + k];
      col[od + k] = col[os + k];
    }
    life[d] = life[s]; maxL[d] = maxL[s]; s0[d] = s0[s]; s1[d] = s1[s]; a0[d] = a0[s]; grav[d] = grav[s]; drag[d] = drag[s];
    size[d] = size[s];
    alpha[d] = alpha[s];
  }
  P.step = (dt) => {
    for (let i = 0; i < n; ) {
      life[i] += dt;
      if (life[i] >= maxL[i]) {
        n--;
        if (i !== n) move(i, n);
        continue;
      }
      const k = life[i] / maxL[i], o = i * 3;
      const dk = Math.max(0, 1 - drag[i] * dt);
      vel[o] *= dk;
      vel[o + 1] = vel[o + 1] * dk - grav[i] * dt;
      vel[o + 2] *= dk;
      pos[o] += vel[o] * dt;
      pos[o + 1] += vel[o + 1] * dt;
      pos[o + 2] += vel[o + 2] * dt;
      size[i] = s0[i] + (s1[i] - s0[i]) * k;
      alpha[i] = a0[i] * Math.min(1, k * 12) * (1 - k * k);
      col[o] = c0[o] + (c1[o] - c0[o]) * k;
      col[o + 1] = c0[o + 1] + (c1[o + 1] - c0[o + 1]) * k;
      col[o + 2] = c0[o + 2] + (c1[o + 2] - c0[o + 2]) * k;
      i++;
    }
  };
  P.commit = () => {
    geo.setDrawRange(0, n);
    if (n) {
      aPos.needsUpdate = aCol.needsUpdate = aSize.needsUpdate = aAlpha.needsUpdate = true;
    }
  };
  P.clear = () => {
    n = 0;
    geo.setDrawRange(0, 0);
  };
  return P;
}

// ================================================================ 바닥 무늬 (경고 원 / 불타는 구덩이 / 간헐천 웅덩이) — 한 장 그림에 3칸
function decalAtlas() {
  const T = 256, c = document.createElement('canvas');
  c.width = T * 3;
  c.height = T;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, T);
  g.globalCompositeOperation = 'lighter';
  const h = T / 2;
  // 1칸: 경고 원 (빨강 = 원 띠, 초록 = 반짝이는 안쪽 무늬)
  g.strokeStyle = 'rgb(255,0,0)';
  g.lineWidth = 16;
  g.beginPath();
  g.arc(h, h, h - 14, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 6;
  g.setLineDash([18, 14]);
  g.beginPath();
  g.arc(h, h, h * 0.62, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  {
    const rg = g.createRadialGradient(h, h, 0, h, h, h - 20);
    rg.addColorStop(0, 'rgba(255,0,0,0.55)');
    rg.addColorStop(1, 'rgba(255,0,0,0.12)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(h, h, h - 20, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgb(0,255,0)';
  for (let k = 0; k < 4; k++) {
    // 가운데를 가리키는 삼각형 4개
    const a = (k * Math.PI) / 2;
    g.save();
    g.translate(h, h);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, -h * 0.18);
    g.lineTo(-h * 0.13, -h * 0.42);
    g.lineTo(h * 0.13, -h * 0.42);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.beginPath();
  g.arc(h, h, 9, 0, Math.PI * 2);
  g.fill();
  // 2칸: 불탄 구덩이 (빨강 = 검게 그을림, 초록 = 빛나는 금)
  {
    const x0 = T;
    const rg = g.createRadialGradient(x0 + h, h, 0, x0 + h, h, h);
    rg.addColorStop(0, 'rgba(255,0,0,1)');
    rg.addColorStop(0.55, 'rgba(255,0,0,0.85)');
    rg.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(x0, 0, T, T);
    g.strokeStyle = 'rgb(0,255,0)';
    for (let k = 0; k < 11; k++) {
      let a = (k / 11) * Math.PI * 2 + Math.random() * 0.4, r = 8;
      g.lineWidth = 5 - (k % 3);
      g.beginPath();
      g.moveTo(x0 + h + Math.cos(a) * r, h + Math.sin(a) * r);
      while (r < h * 0.85) {
        r += 10 + Math.random() * 14;
        a += (Math.random() - 0.5) * 0.5;
        g.lineTo(x0 + h + Math.cos(a) * r, h + Math.sin(a) * r);
      }
      g.stroke();
    }
    const cg = g.createRadialGradient(x0 + h, h, 0, x0 + h, h, h * 0.32);
    cg.addColorStop(0, 'rgba(0,255,0,1)');
    cg.addColorStop(1, 'rgba(0,255,0,0)');
    g.fillStyle = cg;
    g.fillRect(x0, 0, T, T);
  }
  // 3칸: 간헐천 웅덩이 (빨강 = 달아오른 웅덩이, 초록 = 거품)
  {
    const x0 = T * 2;
    const rg = g.createRadialGradient(x0 + h, h, 0, x0 + h, h, h);
    rg.addColorStop(0, 'rgba(255,0,0,1)');
    rg.addColorStop(0.5, 'rgba(255,0,0,0.6)');
    rg.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(x0, 0, T, T);
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * h * 0.55, br = 5 + Math.random() * 14;
      const bg = g.createRadialGradient(x0 + h + Math.cos(a) * r, h + Math.sin(a) * r, 0, x0 + h + Math.cos(a) * r, h + Math.sin(a) * r, br);
      bg.addColorStop(0, 'rgba(0,255,0,0.9)');
      bg.addColorStop(1, 'rgba(0,255,0,0)');
      g.fillStyle = bg;
      g.fillRect(x0, 0, T, T);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
const DECAL_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vI;
void main() {
  vUv = uv;
  vI = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  vI = instanceColor;
#endif
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DECAL_FS = /* glsl */ `
uniform sampler2D map; uniform float uTime;
varying vec2 vUv; varying vec3 vI;
void main() {
  float kind = floor(vI.b * 2.0 + 0.5);
  float fade = vI.r, glow = vI.g;
  vec4 tx = texture2D(map, vec2((vUv.x + kind) / 3.0, vUv.y));
  if (kind < 0.5) {
    // 경고 원: 더하기 빛 (알파 0)
    gl_FragColor = vec4(vec3(1.0, 0.1, 0.04) * tx.r * fade * (1.3 + 2.0 * glow) + vec3(1.0, 0.75, 0.3) * tx.g * fade * glow * 1.4, 0.0);
  } else if (kind < 1.5) {
    float sc = tx.r * fade;
    float fl = 0.7 + 0.3 * sin(uTime * 9.0 + vUv.x * 23.0 + vUv.y * 17.0);
    gl_FragColor = vec4(vec3(0.035, 0.025, 0.02) * sc + vec3(1.0, 0.38, 0.06) * tx.g * glow * fl * 1.6, sc * 0.93);
  } else {
    float fl = 0.75 + 0.25 * sin(uTime * 6.0 + vUv.x * 30.0);
    gl_FragColor = vec4(vec3(1.0, 0.5, 0.1) * tx.r * glow * 1.3 + vec3(1.0, 0.85, 0.4) * tx.g * glow * fl, 0.0);
  }
}`;
// 빛기둥 (경고 기둥·간헐천 분출): 열린 원기둥, 아래 0 ~ 위 1
const COL_VS = /* glsl */ `
varying float vY; varying vec3 vI; varying vec3 vN; varying vec3 vV; varying float vAng;
void main() {
  vY = position.y;
  vAng = atan(position.x, position.z);
  vI = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  vI = instanceColor;
#endif
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const COL_FS = /* glsl */ `
uniform float uTime;
varying float vY; varying vec3 vI; varying vec3 vN; varying vec3 vV; varying float vAng;
void main() {
  float fres = abs(dot(normalize(vN), normalize(vV)));
  float a = smoothstep(0.0, 0.06, vY) * (1.0 - smoothstep(0.45, 1.0, vY));
  float n = 0.6 + 0.4 * sin(vY * 26.0 - uTime * 22.0 + vAng * 3.0) * sin(vY * 9.0 - uTime * 7.0 + vAng * 2.0);
  gl_FragColor = vec4(vI * a * n * (0.25 + fres * fres), 1.0);
}`;
// 바위 (화산탄·떨어지는 가장자리 조각): 평평한 면 + 인스턴스 색 = 스스로 빛남
const ROCK_VS = /* glsl */ `
varying vec3 vW; varying vec3 vI; varying float vD;
void main() {
  vI = vec3(0.0);
#ifdef USE_INSTANCING_COLOR
  vI = instanceColor;
#endif
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const ROCK_FS = /* glsl */ `
uniform vec3 uBase; uniform vec3 uFog; uniform vec2 uFogR; uniform vec3 uLight;
varying vec3 vW; varying vec3 vI; varying float vD;
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  float l = 0.32 + 0.68 * max(dot(n, uLight), 0.0) + 0.18 * max(-n.y, 0.0);
  vec3 c = uBase * l * vec3(1.05, 0.92, 0.85) + vI;
  float f = smoothstep(uFogR.x, uFogR.y, vD);
  gl_FragColor = vec4(mix(c, uFog, f * 0.9), 1.0);
}`;

export function createVolcanoEvents(track, scene, parent, opts = {}) {
  const cfg = VEV_CFG;
  const S = track.samples, N = track.sampleCount || S.length - 1;
  const ds = (track.length || S[N].dist) / N;
  const wrap = (i) => ((i % N) + N) % N;
  const mS = (m) => Math.max(1, Math.round(m / ds));
  const EDGE = track.EDGE || { open: 0, cliff: 1, wall: 2, rail: 3, lava: 4 };
  const lavaY = track.lavaY ?? -26;
  const edgeAt = track.edgeAt || (() => 0);
  const kerbAt = track.kerbAt || (() => 0);
  const hwAt = (i) => S[wrap(i)].hw;
  const groundY = (x, z) => (track.heightAt ? track.heightAt(x, z) : lavaY);
  const roadY = (s, lat) => (track.roadYAt ? track.roadYAt(s, lat) : s.pos.y);
  const params = new URLSearchParams(location.search);
  if (params.get('bombs') === '0') cfg.bombs.enabled = false;
  if (params.get('vev') === '0') cfg.bombs.enabled = cfg.crumble.enabled = cfg.geysers.enabled = false;

  const group = new THREE.Group();
  group.name = 'volcanoEvents';
  group.userData.noBatch = true;
  parent.add(group);
  const audio = createVolcanoAudio();

  // ---------------------------------------------------------------- 코스 미리 계산
  const sections = (track.data && track.data.sections) || {};
  const zone = new Uint8Array(N), noBomb = new Uint8Array(N), crumbleL = new Uint8Array(N), crumbleR = new Uint8Array(N);
  const lavaProx = new Float32Array(N), windProx = new Float32Array(N);
  const idxOf = (t) => wrap(Math.round((((t % 1) + 1) % 1) * N));
  for (const name of cfg.bombs.zones) {
    const r = sections[name];
    if (!r) continue;
    let a = idxOf(r[0]), b = idxOf(r[1]);
    if (b < a) b += N;
    for (let i = a; i <= b; i++) zone[wrap(i)] = 1;
  }
  const jumps = track.jumps || [];
  for (const j of jumps) {
    const clear = mS(cfg.bombs.jumpClear);
    let a = j.lipI - clear - (j.kickN || 0), b = j.landI + clear;
    if (b < a) b += N;
    for (let i = a; i <= b; i++) noBomb[wrap(i)] = 1;
  }
  for (let i = 0; i < N; i++) {
    const s = S[i];
    if (s.gap) noBomb[i] = 1;
    const narrow = s.hw <= cfg.crumble.maxHw && !s.gap;
    if (narrow && edgeAt(i, -1) === EDGE.cliff) crumbleL[i] = 1;
    if (narrow && edgeAt(i, 1) === EDGE.cliff) crumbleR[i] = 1;
    // 출발선 앞뒤 80 m는 도로 위 화산탄 없음
    if (s.dist < 80 || s.dist > N * ds - 80) noBomb[i] = 1;
  }
  // 용암 가까움: 가장자리가 용암이거나 점프 협곡이면 1, 60 m에 걸쳐 줄어듦
  {
    const src = new Float32Array(N);
    for (let i = 0; i < N; i++) if (edgeAt(i, -1) === EDGE.lava || edgeAt(i, 1) === EDGE.lava || S[i].gap) src[i] = 1;
    const R = mS(60);
    for (let i = 0; i < N; i++) {
      if (!src[i]) continue;
      for (let k = -R; k <= R; k++) {
        const q = wrap(i + k), v = 1 - Math.abs(k) / R;
        if (v > lavaProx[q]) lavaProx[q] = v;
      }
    }
  }
  // 바람: 양쪽 낭떠러지(또는 한쪽 낭떠러지 + 좁은 길) + 용암 위로 높을수록
  {
    const src = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const cl = (edgeAt(i, -1) === EDGE.cliff) + (edgeAt(i, 1) === EDGE.cliff);
      const base = cl >= 2 ? 1 : cl === 1 ? (S[i].hw <= 6.2 ? 0.6 : 0.35) : 0;
      src[i] = base * clamp((S[i].pos.y - lavaY - 12) / 70, 0, 1);
    }
    const R = mS(30);
    for (let i = 0; i < N; i++) {
      let acc = 0, w = 0;
      for (let k = -R; k <= R; k += 2) {
        acc += src[wrap(i + k)];
        w++;
      }
      windProx[i] = acc / w;
    }
  }
  // 화산 자리 (풍경과 같은 계산, 분화 소리 거리·화산탄 날아오는 방향)
  const VOL = new THREE.Vector3();
  {
    const tb = track.terrainBox;
    if (tb && tb.min && isFinite(tb.min.x)) VOL.set((tb.min.x + tb.max.x) / 2 - 60, 300, tb.max.y + 640);
    else {
      const b = new THREE.Box3();
      for (let i = 0; i < N; i += 8) b.expandByPoint(S[i].pos);
      VOL.set((b.min.x + b.max.x) / 2 - 60, 300, b.max.z + 900);
    }
  }

  // ---------------------------------------------------------------- 그리기 재료
  const add = makeParticles(2200, true, 'volcanoFxGlow');
  const smoke = makeParticles(800, false, 'volcanoFxSmoke');
  group.add(smoke.points, add.points);

  const RING_N = 4, CRATER_N = 6, VENT_MAX = 16;
  const DEC_RING = 0, DEC_CRATER = RING_N, DEC_VENT = RING_N + CRATER_N, DEC_N = RING_N + CRATER_N + VENT_MAX;
  const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const decalMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: decalAtlas() }, uTime: { value: 0 } },
    vertexShader: DECAL_VS,
    fragmentShader: DECAL_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const decals = new THREE.InstancedMesh(decalGeo, decalMat, DEC_N);
  decals.name = 'volcanoFxDecals';
  decals.userData.noBatch = true;
  decals.frustumCulled = false;
  decals.renderOrder = 1;
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const cTmp = new THREE.Color();
  for (let i = 0; i < DEC_N; i++) {
    decals.setMatrixAt(i, ZERO);
    decals.setColorAt(i, cTmp.setRGB(0, 0, 0));
  }
  group.add(decals);

  const BEAM_N = RING_N * 2, COL_N = BEAM_N + VENT_MAX; // 경고마다 빛기둥 + 낮은 빛 울타리
  const colGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 8, true).translate(0, 0.5, 0);
  const colMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: COL_VS,
    fragmentShader: COL_FS,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const columns = new THREE.InstancedMesh(colGeo, colMat, COL_N);
  columns.name = 'volcanoFxColumns';
  columns.userData.noBatch = true;
  columns.frustumCulled = false;
  columns.renderOrder = 3;
  for (let i = 0; i < COL_N; i++) {
    columns.setMatrixAt(i, ZERO);
    columns.setColorAt(i, cTmp.setRGB(0, 0, 0));
  }
  group.add(columns);

  const BOMB_N = 10, CHUNK_N = 64, ROCK_N = BOMB_N + CHUNK_N;
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  {
    // 바위처럼 조금 찌그러뜨림
    const p = rockGeo.attributes.position, r = mulberry(7);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + r() * 0.4), p.getY(i) * (0.7 + r() * 0.35), p.getZ(i) * (0.8 + r() * 0.4));
  }
  const rockMat = new THREE.ShaderMaterial({
    uniforms: { uBase: { value: new THREE.Color('#3b3330') }, uFog: { value: new THREE.Color('#6e2f1f') }, uFogR: { value: new THREE.Vector2(320, 2500) }, uLight: { value: new THREE.Vector3(60, 110, 40).normalize() } },
    vertexShader: ROCK_VS,
    fragmentShader: ROCK_FS,
  });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_N);
  rocks.name = 'volcanoFxRocks';
  rocks.userData.noBatch = true;
  rocks.frustumCulled = false;
  for (let i = 0; i < ROCK_N; i++) {
    rocks.setMatrixAt(i, ZERO);
    rocks.setColorAt(i, cTmp.setRGB(0, 0, 0));
  }
  group.add(rocks);

  // ---------------------------------------------------------------- 상태
  let rnd = mulberry(cfg.seed);
  const R = (a, b) => a + (b - a) * rnd();
  const vr = Math.random; // 보기만 하는 것 (게임에 영향 없음)
  const VR = (a, b) => a + (b - a) * vr();
  let T = 0; // 물리 시계 (update dt 합)
  let nextBomb = 0, lastOnRoad = -99, eruptAt = -99, pendingErupt = 0, lastEventErupt = -99, ownErupt = 40;
  const stats = { bombs: 0, onRoad: 0, hitPlayer: 0, hitBots: 0, nearMiss: 0, craterT: 0, crumbles: 0, geyserBursts: 0, erupts: 0, thunders: 0, splashes: 0 };

  const bombs = [];
  for (let k = 0; k < BOMB_N; k++)
    bombs.push({ on: false, onRoad: false, t0: 0, t1: 0, p0: new THREE.Vector3(), v0: new THREE.Vector3(), imp: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), idx: 0, lat: 0, ring: -1, size: 1, spin: new THREE.Vector3(), lava: false, embAcc: 0, smkAcc: 0 });
  const rings = [];
  for (let k = 0; k < RING_N; k++) rings.push({ on: false, bomb: null, m: new THREE.Matrix4(), base: new THREE.Matrix4() });
  const craters = [];
  for (let k = 0; k < CRATER_N; k++) craters.push({ on: false, t0: 0, pos: new THREE.Vector3(), m: new THREE.Matrix4(), smkAcc: 0 });
  const chunks = [];
  for (let k = 0; k < CHUNK_N; k++) chunks.push({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), size: 1, life: 0, y0: 0, bounces: 0, glow: 0 });
  // 화면 효과 줄 (물리 스텝에서 생긴 일을 다음 화면에 그림; 테스트처럼 화면이 안 돌아도 넘치지 않게 고리 모양)
  const FXQ = 24;
  const fxq = [];
  for (let k = 0; k < FXQ; k++) fxq.push({ kind: 0, x: 0, y: 0, z: 0, k: 1 });
  let fxHead = 0, fxLen = 0;
  function queueFx(kind, x, y, z, k = 1) {
    const e = fxq[(fxHead + fxLen) % FXQ];
    if (fxLen < FXQ) fxLen++;
    else fxHead = (fxHead + 1) % FXQ;
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.z = z;
    e.k = k;
  }
  const FX_BOOM = 1, FX_LAVA = 2, FX_ROAD = 3, FX_SPLASH = 4, FX_LAND = 5;

  // ---------------------------------------------------------------- 듣는 사람 (카메라) 기준 거리·좌우
  const lisPos = new THREE.Vector3(), lisRight = new THREE.Vector3(1, 0, 0), vTmp = new THREE.Vector3(), vTmp2 = new THREE.Vector3();
  function listener() {
    const g = window.game;
    if (g && g.camera) {
      lisPos.copy(g.camera.position);
      lisRight.setFromMatrixColumn(g.camera.matrixWorld, 0);
    } else if (g && g.car) lisPos.copy(g.car.pos);
  }
  function distPan(x, y, z) {
    vTmp.set(x - lisPos.x, y - lisPos.y, z - lisPos.z);
    const d = vTmp.length();
    return [d, d > 0.1 ? vTmp.dot(lisRight) / d : 0];
  }
  const sfx = (fn, x, y, z, ...rest) => {
    if (!cfg.sound.enabled) return;
    listener();
    const [d, p] = distPan(x, y, z);
    fn(d, p, ...rest);
  };

  // ---------------------------------------------------------------- 화면 위 경고 (도로 위 화산탄)
  const warnEl = document.createElement('div');
  warnEl.id = 'volcanoWarn';
  warnEl.style.cssText =
    'position:fixed;left:50%;top:13%;transform:translateX(-50%);z-index:5;pointer-events:none;opacity:0;transition:opacity .12s;' +
    'font:800 20px/1.2 "Segoe UI","Malgun Gothic",sans-serif;color:#fff;padding:6px 16px;border-radius:999px;background:rgba(150,10,0,.72);' +
    'box-shadow:0 0 18px rgba(255,40,0,.7);white-space:nowrap;text-shadow:0 1px 3px #000';
  if (document.body) document.body.append(warnEl);
  let warnShown = '';
  function setWarn(text) {
    if (text === warnShown) return;
    warnShown = text;
    if (text) warnEl.textContent = text;
    warnEl.style.opacity = text ? '1' : '0';
  }

  // ---------------------------------------------------------------- 지금 화산탄이 떨어져도 되나
  function gameState() {
    const g = window.game;
    if (!g || !g.race) return 0;
    if (g.replay && g.replay.active) return 0;
    if (!cfg.force && (g.paused || g.controlsOverride || g.tutorial)) return 0;
    if (g.race.phase !== 'racing' || g.race.time < cfg.bombs.startAfter) return 0;
    return 1;
  }

  // ---------------------------------------------------------------- 화산탄
  const GRAV = 26; // 보기 좋게 조금 센 중력
  function freeBomb() {
    for (const b of bombs) if (!b.on) return b;
    return null;
  }
  function launch(b, flight) {
    // 화산 쪽 위에서 날아옴
    vTmp.set(VOL.x - b.imp.x, 0, VOL.z - b.imp.z);
    if (vTmp.lengthSq() < 1) vTmp.set(0, 0, 1);
    vTmp.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, VR(-0.5, 0.5));
    const H = VR(55, 100), V = VR(70, 110);
    b.p0.copy(b.imp).addScaledVector(vTmp, H);
    b.p0.y += V;
    b.t0 = T;
    b.t1 = T + flight;
    // p(t) = p0 + v0 t - ½ g t² → p(flight) = imp
    b.v0.copy(b.imp).sub(b.p0).multiplyScalar(1 / flight);
    b.v0.y += 0.5 * GRAV * flight;
    b.size = VR(1.4, 2.1);
    b.spin.set(VR(-4, 4), VR(-4, 4), VR(-4, 4));
    b.embAcc = b.smkAcc = 0;
    b.on = true;
    stats.bombs++;
  }
  function bombPos(b, t, out) {
    const tt = clamp(t - b.t0, 0, b.t1 - b.t0);
    return out.copy(b.p0).addScaledVector(b.v0, tt).setY(b.p0.y + b.v0.y * tt - 0.5 * GRAV * tt * tt);
  }
  /** 도로 위 화산탄: 샘플 idx, 옆 lat 에 flight초 뒤 */
  function spawnRoadBomb(idx, lat, flight) {
    const b = freeBomb();
    if (!b) return null;
    const ring = rings.find((r) => !r.on);
    if (!ring) return null;
    const s = S[wrap(idx)];
    b.onRoad = true;
    b.lava = false;
    b.idx = wrap(idx);
    b.lat = lat;
    b.imp.copy(s.pos).addScaledVector(s.right, lat);
    b.imp.y = roadY(s, lat);
    b.up.copy(s.up || THREE.Object3D.DEFAULT_UP);
    launch(b, flight);
    ring.on = true;
    ring.bomb = b;
    b.ring = rings.indexOf(ring);
    // 경고 원 자리 (도로 면에 맞게)
    vTmp2.copy(s.right);
    const fwd = vTmp.crossVectors(vTmp2, b.up).normalize().negate();
    const r2 = cfg.bombs.radius * 2.15;
    ring.base.makeBasis(vTmp2.clone().multiplyScalar(r2), b.up.clone(), fwd.multiplyScalar(r2));
    ring.base.setPosition(b.imp.x + b.up.x * 0.07, b.imp.y + b.up.y * 0.07, b.imp.z + b.up.z * 0.07);
    stats.onRoad++;
    lastOnRoad = T;
    sfx(audio.whistle, b.imp.x, b.imp.y, b.imp.z, flight);
    return b;
  }
  /** 길 밖 화산탄 */
  function spawnOffBomb(idx, side, out, flight) {
    const b = freeBomb();
    if (!b) return null;
    const i = wrap(idx), s = S[i];
    const lat = side * (s.hw + kerbAt(i, side) + out);
    const x = s.pos.x + s.right.x * lat, z = s.pos.z + s.right.z * lat;
    const gy = groundY(x, z);
    b.onRoad = false;
    b.ring = -1;
    b.lava = gy < lavaY + 0.6;
    b.imp.set(x, Math.max(gy, lavaY), z);
    b.up.set(0, 1, 0);
    launch(b, flight);
    if (vr() < 0.4) sfx(audio.whistle, x, b.imp.y, z, flight);
    return b;
  }
  /** 테스트·사진용: 플레이어 앞 ahead m, 옆 lat 에 화산탄 하나 (onRoad=false면 길 밖 side 쪽 out m) */
  function spawnBomb(o = {}) {
    const car = window.game && window.game.car;
    if (!car || !car.trackInfo) return null;
    const idx = car.trackInfo.index + mS(o.ahead ?? 80);
    if (o.onRoad === false) return spawnOffBomb(idx, o.side ?? 1, o.out ?? 6, o.flight ?? 1.6);
    return spawnRoadBomb(idx, o.lat ?? 2, o.flight ?? cfg.bombs.warn);
  }

  function scheduleBombs(car) {
    const B = cfg.bombs;
    if (!B.enabled || !car.trackInfo) return;
    if (T < nextBomb) return;
    const idx = car.trackInfo.index ?? Math.round(car.trackInfo.t * N);
    const inZone = zone[wrap(idx + mS(60))] || zone[wrap(idx)];
    const erupting = T - eruptAt < B.eruptWindow;
    const every = inZone ? B.zoneEvery : B.openEvery;
    nextBomb = T + R(every[0], every[1]) * (erupting ? B.eruptMul : 1);
    const s = S[wrap(idx)];
    const fwdV = car.vel.x * s.tan.x + car.vel.z * s.tan.z;
    if (fwdV < 6 || !car.grounded) return; // 거꾸로 가거나 공중이면 건너뜀
    const v = Math.max(18, fwdV);
    const roadOK = T - lastOnRoad > B.onRoadGap && !bombs.some((b) => b.on && b.onRoad) && !(car.respawnT > 0);
    if (roadOK && rnd() < (inZone ? B.zoneOnRoad : B.onRoad)) {
      // 차가 도착할 즈음 떨어지게
      const d = clamp(v * (B.warn + R(B.lead[0], B.lead[1])), B.minAhead, 170);
      const ti = wrap(idx + mS(d));
      let ok = true;
      for (let k = -mS(8); k <= mS(8); k++) if (noBomb[wrap(ti + k)]) ok = false;
      if (ok) {
        // 가끔은 레이싱 라인 위 (피해야 함), 아니면 한쪽으로 치우쳐서. 어느 쪽이든 반대편에 지나갈 틈이 남게 가운데에서 0.3×폭 이상 비킴
        const hw = hwAt(ti), lo = Math.min(hw * 0.3, hw - 1.6), hi = hw - 1.5;
        const line = track.racingLine && track.racingLine.offset ? track.racingLine.offset[ti] || 0 : 0;
        let lat;
        if (rnd() < B.onLine) {
          lat = line + R(-1.2, 1.2);
          const sd = lat < 0 ? -1 : 1;
          lat = sd * clamp(Math.abs(lat), lo, hi);
        } else lat = (rnd() < 0.5 ? -1 : 1) * R(lo, hi);
        spawnRoadBomb(ti, lat, B.warn);
        return;
      }
    }
    // 길 밖: 앞쪽에 (가끔은 차가 지나가는 바로 옆)
    const flight = R(1.2, 2.0);
    const d = vr() < 0.3 ? v * flight + R(-5, 10) : v * R(1.0, 2.4) + R(15, 45);
    const ti = wrap(idx + mS(d));
    let side = rnd() < 0.5 ? -1 : 1;
    if (edgeAt(ti, side) === EDGE.wall && rnd() < 0.7) side = -side;
    spawnOffBomb(ti, side, R(B.offRoad[0], B.offRoad[1]), flight);
  }

  const carList = [];
  function cars(player) {
    carList.length = 0;
    carList.push(player);
    const rs = window.game && window.game.raceSys;
    if (rs && rs.bots) for (const b of rs.bots) if (b.car && b.car !== player) carList.push(b.car);
    return carList;
  }
  function slowCar(c, k) {
    c.speed *= k;
    c.vel.multiplyScalar(k);
  }
  function impact(b, player) {
    b.on = false;
    const I = b.imp;
    if (b.onRoad) {
      const Rr = cfg.bombs.radius;
      for (const c of cars(player)) {
        const dx = c.pos.x - I.x, dz = c.pos.z - I.z;
        if (dx * dx + dz * dz < Rr * Rr && Math.abs(c.pos.y - I.y) < 3.2) {
          slowCar(c, cfg.bombs.slow);
          c.events.push('bump');
          if (c === player) {
            stats.hitPlayer++;
            if (opts.toast) opts.toast('💥 화산탄에 맞았어요!', '빨간 원이 보이면 옆으로 피해요');
            if (cfg.sound.enabled) audio.hit();
          } else stats.hitBots++;
        } else if (c === player && dx * dx + dz * dz < 14 * 14) {
          c.events.push('land'); // 가까이 떨어짐: 작게 흔들림
          stats.nearMiss++;
        }
      }
      if (b.ring >= 0) {
        rings[b.ring].on = false;
        rings[b.ring].bomb = null;
        b.ring = -1;
      }
      // 불타는 구덩이
      let cr = craters.find((c) => !c.on);
      if (!cr) cr = craters.reduce((a, c) => (c.t0 < a.t0 ? c : a), craters[0]);
      cr.on = true;
      cr.t0 = T;
      cr.pos.copy(I);
      {
        const s = S[b.idx], up = b.up;
        vTmp2.copy(s.right);
        const fwd = vTmp.crossVectors(vTmp2, up).normalize().negate();
        const r2 = cfg.bombs.craterR * 2.3;
        cr.m.makeBasis(vTmp2.clone().multiplyScalar(r2), up.clone(), fwd.multiplyScalar(r2));
        cr.m.setPosition(I.x + up.x * 0.05, I.y + up.y * 0.05, I.z + up.z * 0.05);
      }
      queueFx(FX_ROAD, I.x, I.y, I.z, 1.2);
      sfx(audio.impact, I.x, I.y, I.z, true);
    } else {
      queueFx(b.lava ? FX_LAVA : FX_BOOM, I.x, I.y, I.z, 1);
      sfx(audio.impact, I.x, I.y, I.z, false);
      const dx = player.pos.x - I.x, dz = player.pos.z - I.z;
      if (dx * dx + dz * dz < 26 * 26 && Math.abs(player.pos.y - I.y) < 20) player.events.push('smash');
    }
  }
  function craterStep(dt, player) {
    const B = cfg.bombs;
    for (const cr of craters) {
      if (!cr.on) continue;
      if (T - cr.t0 > B.craterLife) {
        cr.on = false;
        continue;
      }
      const r2 = B.craterR * B.craterR;
      for (const c of cars(player)) {
        if (!c.grounded) continue;
        const dx = c.pos.x - cr.pos.x, dz = c.pos.z - cr.pos.z;
        if (dx * dx + dz * dz < r2 && Math.abs(c.pos.y - cr.pos.y) < 2) {
          slowCar(c, Math.max(0, 1 - B.craterDrag * dt));
          if (c === player) stats.craterT += dt;
        }
      }
    }
  }

  // ---------------------------------------------------------------- 분화·번개 (풍경이 보내는 이벤트)
  function onErupt(strength = 1, x, z) {
    stats.erupts++;
    pendingErupt = Math.max(pendingErupt, strength || 1);
    listener();
    const [d, p] = distPan(x ?? VOL.x, 300, z ?? VOL.z);
    if (cfg.sound.enabled) audio.erupt(strength, d, p);
    rumbleAt = performance.now() / 1000 + Math.min(4, d / 343);
    rumbleK = clamp(strength, 0.3, 1.4);
    if (stats.erupts <= 2 && gameState() && opts.toast) opts.toast('🌋 화산 분화!', '화산탄이 쏟아져요 · 도로 위 빨간 원을 피하세요');
  }
  let rumbleAt = -1, rumbleK = 0, rumbleNext = 0;
  const evErupt = (e) => {
    lastEventErupt = performance.now() / 1000;
    const d = (e && e.detail) || {};
    onErupt(d.strength ?? 1, d.x, d.z);
  };
  const evLightning = (e) => {
    const d = (e && e.detail) || {};
    stats.thunders++;
    if (!cfg.sound.enabled) return;
    listener();
    const [dist, pan] = distPan(d.x ?? lisPos.x + 400, d.y ?? 300, d.z ?? lisPos.z);
    audio.thunder(dist, pan);
  };
  window.addEventListener('volcano:erupt', evErupt);
  window.addEventListener('volcano:lightning', evLightning);
  let lastEruptN = null;

  // ---------------------------------------------------------------- 매 물리 스텝
  const landSt = new WeakMap();
  function update(dt, car) {
    T += dt;
    if (pendingErupt) {
      eruptAt = T;
      // 분화하고 2~3초 뒤 화산탄 몇 개가 한꺼번에 (길 밖)
      nextBomb = Math.min(nextBomb, T + 2.2);
      pendingErupt = 0;
    }
    const live = gameState();
    for (const b of bombs) if (b.on && T >= b.t1) impact(b, car);
    craterStep(dt, car);
    if (live && cfg.bombs.enabled) scheduleBombs(car);
    let st = landSt.get(car);
    if (!st) landSt.set(car, (st = { air: 0, was: true, lavaLen: 0 }));
    // 용암에 빠짐 (car.js 'lava' 이벤트): 첨벙
    const ev = car.events;
    if (ev.length < st.lavaLen) st.lavaLen = 0;
    for (let k = st.lavaLen; k < ev.length; k++) {
      if (ev[k] === 'lava') splashAt(car.pos.x, Math.max(lavaY, car.pos.y - 1), car.pos.z);
      if (ev[k] === 'respawn') st.air = 0;
    }
    st.lavaLen = ev.length;
    // 큰 점프 착지: 불꽃 (플레이어만)
    if (!car.grounded) st.air += dt;
    else {
      if (!st.was && st.air > 0.7) queueFx(FX_LAND, car.pos.x, car.pos.y, car.pos.z, Math.min(1.5, st.air / 1.5));
      st.air = 0;
    }
    st.was = car.grounded;
  }
  /** 차가 떨어짐 (volcanoProps의 추락 감지가 부름): 용암에 닿을 곳에서 첨벙 */
  function carFell(car) {
    const vy = Math.min(0, car.vel.y), dy = Math.max(1, car.pos.y - lavaY);
    const tFall = (vy + Math.sqrt(vy * vy + 2 * 9.81 * dy)) / 9.81;
    const x = car.pos.x + car.vel.x * tFall, z = car.pos.z + car.vel.z * tFall;
    splashAt(x, Math.max(lavaY, groundY(x, z)), z, true);
  }
  const lastSplash = new THREE.Vector3();
  function splashAt(x, y, z, delayed = false) {
    stats.splashes++;
    lastSplash.set(x, y, z);
    queueFx(FX_SPLASH, x, y, z, delayed ? 1.3 : 1);
    sfx(audio.splash, x, y, z);
  }

  // ---------------------------------------------------------------- 화면 효과 만들기
  function sparks(x, y, z, n, sp, k = 1) {
    for (let i = 0; i < n; i++) {
      const a = vr() * Math.PI * 2, u = vr() * 0.9 + 0.1, v = VR(sp * 0.4, sp);
      add.spawn(x, y + 0.3, z, Math.cos(a) * Math.sqrt(1 - u * u) * v, u * v, Math.sin(a) * Math.sqrt(1 - u * u) * v, VR(0.5, 1.3), VR(0.3, 0.65) * k, 0.1, 1, 20, 0.6, 1, 0.85, 0.4, 0.9, 0.2, 0.02);
    }
  }
  function blobs(x, y, z, n, sp, up, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = vr() * Math.PI * 2, v = VR(sp * 0.3, sp);
      add.spawn(x, y + 0.2, z, Math.cos(a) * v, VR(up * 0.5, up), Math.sin(a) * v, VR(1.0, 1.9), VR(0.7, 1.4) * size, 0.3 * size, 1, 22, 0.2, 1, 0.55, 0.12, 0.6, 0.08, 0.0);
    }
  }
  function flash(x, y, z, size, life = 0.25) {
    add.spawn(x, y + 1, z, 0, 0, 0, life, size, size * 1.6, 1, 0, 0, 1, 0.62, 0.25, 0.8, 0.2, 0.05);
  }
  function dust(x, y, z, n, spread, size, dark = false) {
    for (let i = 0; i < n; i++) {
      const a = vr() * Math.PI * 2, r = vr() * spread;
      const c = dark ? VR(0.1, 0.16) : VR(0.28, 0.4);
      smoke.spawn(x + Math.cos(a) * r, y + VR(0, 1.2), z + Math.sin(a) * r, Math.cos(a) * VR(1, 4), VR(1.5, 5.5), Math.sin(a) * VR(1, 4), VR(1.6, 3.0), size * VR(0.6, 1.0), size * VR(2.2, 3.2), VR(0.55, 0.8), -0.4, 1.2, c * 1.25, c, c * 0.85, c * 0.7, c * 0.62, c * 0.6);
    }
  }
  function steam(x, y, z, n, size) {
    for (let i = 0; i < n; i++) {
      const a = vr() * Math.PI * 2, r = vr() * size * 0.6;
      smoke.spawn(x + Math.cos(a) * r, y + 0.5, z + Math.sin(a) * r, Math.cos(a) * 1.5, VR(3, 7), Math.sin(a) * 1.5, VR(2.2, 3.6), size * 0.5, size * 2.4, VR(0.35, 0.55), -0.6, 0.9, 0.85, 0.75, 0.7, 0.55, 0.5, 0.5);
    }
  }
  function drainFx() {
    for (; fxLen > 0; fxLen--, fxHead = (fxHead + 1) % FXQ) {
      const e = fxq[fxHead], { x, y, z, k } = e;
      if (e.kind === FX_BOOM || e.kind === FX_ROAD) {
        flash(x, y, z, 34 * k, 0.3);
        flash(x, y, z, 14 * k, 0.6);
        sparks(x, y, z, Math.round(80 * k), 26, 1.2);
        blobs(x, y, z, Math.round(12 * k), 10, 14);
        dust(x, y, z, Math.round(16 * k), 4, 5, e.kind === FX_ROAD);
      } else if (e.kind === FX_LAVA) {
        flash(x, y, z, 18);
        blobs(x, y, z, 26, 8, 16);
        sparks(x, y, z, 25, 14);
        steam(x, y, z, 6, 6);
      } else if (e.kind === FX_SPLASH) {
        flash(x, y, z, 40 * k, 0.4);
        blobs(x, y, z, Math.round(60 * k), 11, 22, 1.8);
        sparks(x, y, z, 40, 18, 1.3);
        steam(x, y, z, Math.round(18 * k), 12);
      } else if (e.kind === FX_LAND) {
        sparks(x, y - 0.3, z, Math.round(36 * k), 11, 0.8);
        dust(x, y - 0.4, z, Math.round(5 * k), 2, 2.2);
        if (cfg.sound.enabled) audio.sizzle(k);
      }
    }
  }

  // ---------------------------------------------------------------- 무너지는 가장자리
  let crumAccL = 0, crumAccR = 0, crumSnd = 0;
  const eTmp = new THREE.Euler(), qTmp = new THREE.Quaternion(), mTmp = new THREE.Matrix4(), sTmp = new THREE.Vector3(), pTmp = new THREE.Vector3();
  function spawnChunk(idx, side, car) {
    const c = chunks.find((q) => !q.on);
    if (!c) return;
    const i = wrap(idx), s = S[i];
    if (s.gap) return;
    const lat = side * (s.hw + kerbAt(i, side) + VR(-0.3, 0.5));
    c.pos.copy(s.pos).addScaledVector(s.right, lat);
    c.pos.y = roadY(s, side * s.hw) - VR(0.1, 0.35);
    c.vel.copy(s.right).multiplyScalar(side * VR(1.2, 4));
    c.vel.addScaledVector(s.tan, VR(-1.5, 1.5) + car.speed * 0.04);
    c.vel.y = VR(0.5, 3);
    c.spin.set(VR(-6, 6), VR(-6, 6), VR(-6, 6));
    c.rot.set(vr() * 6, vr() * 6, vr() * 6);
    c.size = vr() < 0.75 ? VR(0.15, 0.45) : VR(0.5, 0.8);
    c.life = 0;
    c.y0 = c.pos.y;
    c.bounces = 0;
    c.glow = vr() < 0.3 ? VR(0.15, 0.4) : 0;
    c.on = true;
    stats.crumbles++;
    // 먼지·불티
    dust(c.pos.x, c.pos.y, c.pos.z, 2, 0.8, 1.8);
    for (let k = 0; k < 3; k++) add.spawn(c.pos.x, c.pos.y, c.pos.z, VR(-1, 1) + side * s.right.x * 2, VR(1, 4), VR(-1, 1) + side * s.right.z * 2, VR(0.6, 1.2), VR(0.2, 0.35), 0.05, 1, 6, 0.5, 1, 0.7, 0.3, 0.8, 0.15, 0.02);
    if (crumSnd <= 0) {
      crumSnd = 0.3;
      sfx(audio.crumble, c.pos.x, c.pos.y, c.pos.z);
    }
  }
  function crumbleFrame(dt, car) {
    crumSnd -= dt;
    if (!cfg.crumble.enabled || !car || !car.trackInfo) return;
    const g = window.game;
    if (g && g.race && g.race.phase === 'countdown') return;
    const idx = wrap(car.trackInfo.index ?? 0);
    if (car.grounded && car.speed > cfg.crumble.minSpeed) {
      const m = car.speed * dt * cfg.crumble.perMeter;
      if (crumbleL[idx]) crumAccL += m;
      if (crumbleR[idx]) crumAccR += m;
      while (crumAccL >= 1) {
        crumAccL -= 1;
        spawnChunk(idx - Math.round(VR(-1, 5)), -1, car);
      }
      while (crumAccR >= 1) {
        crumAccR -= 1;
        spawnChunk(idx - Math.round(VR(-1, 5)), 1, car);
      }
    }
  }
  function chunksStep(dt) {
    for (let k = 0; k < CHUNK_N; k++) {
      const c = chunks[k];
      if (!c.on) continue;
      c.life += dt;
      c.vel.y -= 14 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      c.rot.z += c.spin.z * dt;
      // 비탈에 부딪히면 한두 번 튀고 계속 굴러 떨어짐
      if (c.life > 0.15 && c.bounces < 2) {
        const gy = groundY(c.pos.x, c.pos.z);
        if (c.pos.y < gy && gy > lavaY + 0.5 && c.pos.y > gy - 3) {
          c.pos.y = gy;
          c.vel.y = Math.abs(c.vel.y) * 0.35;
          c.vel.x *= 1.15;
          c.vel.z *= 1.15;
          c.bounces++;
          if (vr() < 0.5) dust(c.pos.x, c.pos.y, c.pos.z, 1, 0.5, 1.2);
        }
      }
      let dead = c.life > 5 || c.pos.y < c.y0 - 60;
      if (c.pos.y < lavaY) {
        dead = true;
        blobs(c.pos.x, lavaY, c.pos.z, 4, 3, 6, 0.6);
        steam(c.pos.x, lavaY, c.pos.z, 1, 3);
      }
      if (dead) {
        c.on = false;
        rocks.setMatrixAt(BOMB_N + k, ZERO);
        continue;
      }
      qTmp.setFromEuler(c.rot);
      rocks.setMatrixAt(BOMB_N + k, mTmp.compose(c.pos, qTmp, sTmp.setScalar(c.size)));
      rocks.setColorAt(BOMB_N + k, cTmp.setRGB(c.glow, c.glow * 0.28, c.glow * 0.05));
    }
  }

  // ---------------------------------------------------------------- 용암 간헐천
  const geysers = [];
  {
    const G = cfg.geysers;
    const gr = mulberry(cfg.seed + 5);
    const GR = (a, b) => a + (b - a) * gr();
    const tryAdd = (x, z, y = lavaY) => {
      if (geysers.length >= VENT_MAX) return false;
      for (const q of geysers) if ((q.x - x) ** 2 + (q.z - z) ** 2 < 50 * 50) return false;
      if (y <= lavaY + 0.1 && groundY(x, z) > lavaY + 0.4) return false; // 용암 바다가 아니라 땅
      // 다른 도로 바로 옆이면 안 됨
      if (track.nearestRaw || track.nearest) {
        const n = (track.nearestRaw || track.nearest)(pTmp.set(x, y, z));
        if (n && n.sample && Math.abs(n.sample.pos.y - y) < 12 && n.dist < n.sample.hw + 6) return false;
      }
      geysers.push({ x, y: y + 0.05, z, period: GR(G.period[0], G.period[1]), phase: GR(0, 10), H: GR(G.height[0], G.height[1]), w: GR(1.6, 2.6), st: 0, emA: 0, glow: 0 });
      return true;
    };
    // 용암 웅덩이 길옆 (웅덩이는 연석 끝 0.3~30 m 바깥, 도로보다 1.4 m 아래 = volcanoTrack.js)
    for (let i = 0; i < N; i += mS(25)) {
      for (const side of [-1, 1]) {
        if (edgeAt(i, side) !== EDGE.lava || edgeAt(i + mS(12), side) !== EDGE.lava || edgeAt(i - mS(12), side) !== EDGE.lava) continue;
        const s = S[i];
        const e = s.hw + kerbAt(i, side), lat = side * (e + GR(8, 19));
        tryAdd(s.pos.x + s.right.x * lat, s.pos.z + s.right.z * lat, roadY(s, side * e) - 1.4);
      }
    }
    // 점프 협곡 아래 (도로에서 25~35 m 옆)
    for (const c of track.chasms || []) for (const sd of [-1, 1]) tryAdd(c.mid.x + c.across.x * sd * GR(24, 34), c.mid.z + c.across.z * sd * GR(24, 34));
    // 분화구 용암 호수
    const lake = track.lake;
    if (lake) for (let k = 0; k < 2; k++) tryAdd(lake.x + GR(-0.4, 0.4) * lake.r, lake.z + GR(-0.4, 0.4) * lake.r);
    // 바닥 웅덩이 무늬 자리
    geysers.forEach((q, k) => {
      const r = q.w * 3.4;
      decals.setMatrixAt(DEC_VENT + k, mTmp.makeScale(r, 1, r).setPosition(q.x, q.y + 0.04, q.z));
      decals.setColorAt(DEC_VENT + k, cTmp.setRGB(1, 0.2, 1));
    });
  }
  let gT = 0;
  const qId = new THREE.Quaternion();
  function geysersFrame(dt) {
    const G = cfg.geysers;
    if (!G.enabled) return;
    gT += dt;
    for (let k = 0; k < geysers.length; k++) {
      const q = geysers[k];
      const dx = q.x - lisPos.x, dz = q.z - lisPos.z, far = dx * dx + dz * dz > 520 * 520;
      const cyc = (gT + q.phase) % q.period, w0 = q.period - G.warn - G.burst;
      let st = 0, glow = 0.18, h = 0;
      if (cyc >= w0 && cyc < w0 + G.warn) {
        st = 1;
        glow = 0.18 + 0.9 * ((cyc - w0) / G.warn);
      } else if (cyc >= w0 + G.warn) {
        st = 2;
        const b = (cyc - w0 - G.warn) / G.burst;
        h = Math.sin(Math.PI * Math.min(1, b * 1.25)) * (b < 0.8 ? 1 : 1 - (b - 0.8) * 5);
        glow = 1.1 - b * 0.6;
      }
      if (st !== q.st) {
        if (!far && st === 1) sfx(audio.geyserWarn, q.x, q.y, q.z, G.warn);
        if (!far && st === 2) {
          sfx(audio.geyserBurst, q.x, q.y, q.z);
          stats.geyserBursts++;
          flash(q.x, q.y, q.z, 16, 0.3);
        }
        q.st = st;
      }
      decals.setColorAt(DEC_VENT + k, cTmp.setRGB(1, glow, 1));
      const H = q.H * Math.max(0, h);
      if (H > 0.3) columns.setMatrixAt(BEAM_N + k, mTmp.compose(pTmp.set(q.x, q.y, q.z), qId, sTmp.set(q.w * (0.7 + h * 0.5), H, q.w * (0.7 + h * 0.5))));
      else columns.setMatrixAt(BEAM_N + k, ZERO);
      columns.setColorAt(BEAM_N + k, cTmp.setRGB(1.0, 0.42, 0.08).multiplyScalar(0.9 * h + 0.05));
      if (far) continue;
      // 알갱이
      if (st === 1) {
        q.emA += dt * 26;
        while (q.emA >= 1) {
          q.emA--;
          const a = vr() * 6.283, r = vr() * q.w * 1.5;
          add.spawn(q.x + Math.cos(a) * r, q.y + 0.2, q.z + Math.sin(a) * r, 0, VR(1.5, 4.5), 0, VR(0.4, 0.8), VR(0.5, 0.9), 0.2, 1, 9, 0, 1, 0.6, 0.15, 0.7, 0.1, 0);
        }
      } else if (st === 2 && h > 0.05) {
        q.emA += dt * 200 * h;
        const top = q.H * h;
        while (q.emA >= 1) {
          q.emA--;
          const a = vr() * 6.283, sp = VR(1, 5);
          add.spawn(q.x + Math.cos(a) * q.w * 0.5, q.y + 0.5, q.z + Math.sin(a) * q.w * 0.5, Math.cos(a) * sp, Math.sqrt(2 * 15 * top) * VR(0.6, 1.08), Math.sin(a) * sp, VR(1.6, 2.6), VR(0.6, 1.3), 0.35, 1, 15, 0.1, 1, 0.75, 0.25, 0.65, 0.1, 0.0);
        }
        if (vr() < dt * 8) steam(q.x, q.y + top * 0.3, q.z, 1, 5);
      } else q.emA = 0;
    }
  }

  // ---------------------------------------------------------------- 매 화면
  let lastEl = null, frameT = 0;
  const sndLv = { rumble: 0.6, lava: 0, wind: 0 };
  let bedRumble = 0.6, bedLava = 0, bedWind = 0, swell = 0, swellT = 0;
  const pB = new THREE.Vector3();
  function animate(elapsed) {
    const g = window.game;
    let dt = lastEl == null ? 1 / 60 : elapsed - lastEl;
    lastEl = elapsed;
    if (!(dt >= 0)) dt = 0;
    dt = Math.min(0.1, dt);
    frameT += dt;
    // 먼저 움직이고(오래된 알갱이 지움) → 이번 화면 알갱이를 새로 넣음 (한 화면만 사는 둘레 빛이 그려지게)
    add.step(dt);
    smoke.step(dt);
    listener();
    const replaying = !!(g && g.replay && g.replay.active);
    group.visible = true;
    decalMat.uniforms.uTime.value = colMat.uniforms.uTime.value = frameT;
    // 알갱이 크기: 화면 높이에 맞춤
    if (g && g.renderer && g.camera) {
      const h = g.renderer.domElement.height || 800;
      add.mat.uniforms.uScale.value = smoke.mat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(g.camera.fov) / 2));
    }
    if (scene.fog) {
      rockMat.uniforms.uFog.value.copy(scene.fog.color);
      if (scene.fog.near != null) rockMat.uniforms.uFogR.value.set(scene.fog.near, scene.fog.far);
    }
    // 분화: 풍경의 erupt.n이 바뀌었는데 이벤트가 안 왔으면 스스로 (풍경이 이벤트를 안 보낼 때 대비)
    const se = g && g.scenery && g.scenery.erupt;
    const now = performance.now() / 1000;
    if (se && typeof se.n === 'number') {
      if (lastEruptN != null && se.n !== lastEruptN && now - lastEventErupt > 1.5) onErupt(1);
      lastEruptN = se.n;
    } else if (!se && now - lastEventErupt > 60) {
      ownErupt -= dt;
      if (ownErupt <= 0) {
        ownErupt = 30 + Math.random() * 12;
        onErupt(1);
      }
    }
    // 분화 진동: 소리가 도착한 뒤 1.4초 동안 (플레이어 차에 'smash' = 작은 흔들림, 설정의 흔들림 세기를 따름)
    if (rumbleAt > 0 && now >= rumbleAt && g && g.car && !replaying) {
      if (now - rumbleAt > 1.4) rumbleAt = -1;
      else if (now >= rumbleNext) {
        rumbleNext = now + 0.22;
        if (rumbleK >= 0.6) g.car.events.push('smash');
      }
      swell = Math.max(swell, rumbleK);
    }
    swell = Math.max(0, swell - dt * 0.35);

    // 화산탄 그리기 + 꼬리
    for (let k = 0; k < BOMB_N; k++) {
      const b = bombs[k];
      if (!b.on || replaying) {
        rocks.setMatrixAt(k, ZERO);
        continue;
      }
      bombPos(b, T, pB);
      eTmp.set(b.spin.x * T, b.spin.y * T, b.spin.z * T);
      qTmp.setFromEuler(eTmp);
      rocks.setMatrixAt(k, mTmp.compose(pB, qTmp, sTmp.setScalar(b.size)));
      rocks.setColorAt(k, cTmp.setRGB(1.6, 0.55, 0.12));
      // 둘레 빛 (이번 화면만)
      add.spawn(pB.x, pB.y, pB.z, 0, 0, 0, 0.001, b.size * 8, b.size * 8, 0.8, 0, 0, 1, 0.45, 0.12, 1, 0.45, 0.12);
      b.embAcc += dt * 55;
      while (b.embAcc >= 1) {
        b.embAcc--;
        add.spawn(pB.x + VR(-0.6, 0.6), pB.y + VR(-0.6, 0.6), pB.z + VR(-0.6, 0.6), VR(-2, 2), VR(-1, 2), VR(-2, 2), VR(0.4, 0.9), VR(0.35, 0.7), 0.08, 1, -1, 0.5, 1, 0.8, 0.35, 0.8, 0.15, 0.02);
      }
      b.smkAcc += dt * 24;
      while (b.smkAcc >= 1) {
        b.smkAcc--;
        const c = VR(0.1, 0.17);
        smoke.spawn(pB.x, pB.y, pB.z, VR(-0.6, 0.6), VR(0, 1), VR(-0.6, 0.6), VR(1.0, 1.6), b.size * 1.6, b.size * 4.5, 0.6, -0.5, 1.2, c * 1.4, c, c * 0.8, c, c, c);
      }
    }
    // 경고 원 + 빛기둥 (떨어지기 직전에 빨라지는 깜박임)
    let warnTxt = '';
    for (let k = 0; k < RING_N; k++) {
      const r = rings[k];
      if (!r.on || !r.bomb || replaying) {
        decals.setMatrixAt(DEC_RING + k, ZERO);
        columns.setMatrixAt(k, ZERO);
        columns.setMatrixAt(RING_N + k, ZERO);
        continue;
      }
      const b = r.bomb, left = Math.max(0, b.t1 - T), u = 1 - left / (b.t1 - b.t0);
      const blink = 0.5 + 0.5 * Math.sin(frameT * (10 + u * 22));
      const grow = Math.min(1, u * 5);
      mTmp.copy(r.base);
      sTmp.setScalar(0.6 + 0.4 * grow);
      mTmp.scale(sTmp);
      decals.setMatrixAt(DEC_RING + k, mTmp);
      decals.setColorAt(DEC_RING + k, cTmp.setRGB(0.55 + 0.45 * grow, blink * (0.4 + u * 0.6), 0));
      columns.setMatrixAt(k, mTmp.compose(b.imp, qId, sTmp.set(0.45, 14 + u * 8, 0.45)));
      columns.setColorAt(k, cTmp.setRGB(1, 0.08, 0.03).multiplyScalar(0.55 + blink * 0.9));
      // 낮은 빛 울타리: 낮은 카메라에서도 원의 크기가 보이게 (맞는 반지름 그대로)
      const rr = cfg.bombs.radius * (0.6 + 0.4 * grow);
      columns.setMatrixAt(RING_N + k, mTmp.compose(b.imp, qId, sTmp.set(rr, 1.6 + u * 0.8, rr)));
      columns.setColorAt(RING_N + k, cTmp.setRGB(1, 0.12, 0.04).multiplyScalar(0.9 + blink * 1.1));
      // 화면 위 알림: 내 차가 이 원 쪽으로 오고 있으면 (앞 0~220 m)
      const car = g && g.car;
      if (car && car.trackInfo) {
        let ahead = b.idx - car.trackInfo.index;
        if (ahead < -N / 2) ahead += N;
        if (ahead > N / 2) ahead -= N;
        const m = ahead * ds;
        if (m > -2 && m < 220) {
          const myLat = car.trackInfo.lateral ?? 0;
          const go = b.lat > myLat ? '◀ 왼쪽으로' : '오른쪽으로 ▶';
          warnTxt = Math.abs(myLat - b.lat) > cfg.bombs.radius + 1.2 ? '⚠ 화산탄!' : `⚠ 화산탄! ${go}`;
        }
      }
    }
    setWarn(warnTxt);
    // 구덩이
    for (let k = 0; k < CRATER_N; k++) {
      const c = craters[k];
      if (!c.on || replaying) {
        decals.setMatrixAt(DEC_CRATER + k, ZERO);
        continue;
      }
      const age = T - c.t0, life = cfg.bombs.craterLife, fade = Math.min(1, (life - age) / 0.8);
      decals.setMatrixAt(DEC_CRATER + k, c.m);
      decals.setColorAt(DEC_CRATER + k, cTmp.setRGB(Math.max(0, fade), Math.max(0, 1 - age / life) * 1.2, 0.5));
      c.smkAcc += dt * 9 * fade;
      while (c.smkAcc >= 1) {
        c.smkAcc--;
        const q = VR(0.12, 0.2);
        smoke.spawn(c.pos.x + VR(-1.5, 1.5), c.pos.y + 0.3, c.pos.z + VR(-1.5, 1.5), VR(-0.4, 0.4), VR(1.5, 3), VR(-0.4, 0.4), VR(1.6, 2.6), 1.2, 4.5, 0.5, -0.3, 0.8, q * 1.3, q, q * 0.9, q, q, q);
        if (vr() < 0.6) add.spawn(c.pos.x + VR(-1.2, 1.2), c.pos.y + 0.2, c.pos.z + VR(-1.2, 1.2), VR(-0.5, 0.5), VR(1, 3.5), VR(-0.5, 0.5), VR(0.5, 1.1), VR(0.25, 0.45), 0.05, 1, -0.5, 0.4, 1, 0.75, 0.3, 0.9, 0.2, 0.02);
      }
    }
    const car = g && g.car;
    if (!replaying) crumbleFrame(dt, car);
    chunksStep(dt);
    geysersFrame(dt);
    drainFx();
    add.commit();
    smoke.commit();
    decals.instanceMatrix.needsUpdate = true;
    if (decals.instanceColor) decals.instanceColor.needsUpdate = true;
    columns.instanceMatrix.needsUpdate = true;
    if (columns.instanceColor) columns.instanceColor.needsUpdate = true;
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;

    // 늘 깔리는 소리
    if (cfg.sound.enabled && car && !replaying) {
      const idx = car.trackInfo ? wrap(car.trackInfo.index ?? 0) : 0;
      const hLava = 1 - clamp((car.pos.y - lavaY) / 45, 0, 1);
      let gey = 0;
      for (const q of geysers) {
        const d = Math.hypot(q.x - car.pos.x, q.z - car.pos.z);
        if (d < 90) gey = Math.max(gey, (1 - d / 90) * (q.st ? 1 : 0.5));
      }
      swellT -= dt;
      if (swellT <= 0) {
        swellT = 3 + Math.random() * 5;
        if (Math.random() < 0.4) swell = Math.max(swell, 0.3 + Math.random() * 0.3);
      }
      const spd = clamp(Math.abs(car.speed) / 55, 0, 1);
      const k = 1 - Math.exp(-dt * 3);
      bedRumble += (0.55 + swell * 0.6 - bedRumble) * k;
      bedLava += (Math.max(hLava * 0.9, lavaProx[idx], gey) - bedLava) * k;
      bedWind += (windProx[idx] * (0.45 + 0.55 * spd) - bedWind) * k * 0.6;
      sndLv.rumble = bedRumble;
      sndLv.lava = bedLava;
      sndLv.wind = bedWind;
      audio.bed(sndLv, dt);
    }
  }

  function reset() {
    rnd = mulberry(cfg.seed);
    T = 0;
    nextBomb = 0;
    lastOnRoad = -99;
    eruptAt = -99;
    pendingErupt = 0;
    for (const b of bombs) {
      b.on = false;
      b.ring = -1;
    }
    for (const r of rings) {
      r.on = false;
      r.bomb = null;
    }
    for (const c of craters) c.on = false;
    for (const c of chunks) c.on = false;
    for (let i = 0; i < ROCK_N; i++) rocks.setMatrixAt(i, ZERO);
    for (let i = 0; i < DEC_RING + RING_N + CRATER_N; i++) decals.setMatrixAt(i, ZERO);
    for (let i = 0; i < BEAM_N; i++) columns.setMatrixAt(i, ZERO);
    rocks.instanceMatrix.needsUpdate = decals.instanceMatrix.needsUpdate = columns.instanceMatrix.needsUpdate = true;
    fxLen = 0;
    add.clear();
    smoke.clear();
    setWarn('');
    rumbleAt = -1;
    for (const k of Object.keys(stats)) stats[k] = 0;
  }

  return {
    group, cfg, stats, audio, update, animate, reset, carFell, spawnBomb, geysers, onErupt,
    get time() {
      return T;
    },
    debug: { bombs, rings, craters, chunks, add, smoke, zone, noBomb, lavaProx, windProx, VOL, lastSplash },
  };
}
