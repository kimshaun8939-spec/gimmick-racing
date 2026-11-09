// 정글 유적 맵 공용 도우미: 텍스처, 난수, 노이즈, 지하 세계 도로 재질
// (track.js는 다른 에이전트가 고치는 중이라 필요한 것만 복사해 둠)
import * as THREE from 'three';

export const TAU = Math.PI * 2;

/** 같은 seed면 항상 같은 순서의 난수 (0~1) */
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 캔버스에 그려서 텍스처로 */
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 정글 아스팔트 (살짝 따뜻한 회색 + 흰 선 + 가운데 노란 점선 + 떨어진 잎) */
export function roadTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3c3d40';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 50 + Math.random() * 32;
      g.fillStyle = `rgba(${v + 4},${v + 2},${v},0.35)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // 바퀴 자국 (조금 어두운 띠)
    g.fillStyle = 'rgba(20,20,22,0.18)';
    g.fillRect(w * 0.22, 0, w * 0.12, h);
    g.fillRect(w * 0.66, 0, w * 0.12, h);
    g.fillStyle = '#f2f2f2';
    g.fillRect(w * 0.03, 0, w * 0.025, h);
    g.fillRect(w * 0.945, 0, w * 0.025, h);
    g.fillStyle = '#e8c547';
    g.fillRect(w * 0.49, 0, w * 0.02, h * 0.5);
    // 가장자리 쪽 떨어진 잎
    for (let i = 0; i < 26; i++) {
      const x = Math.random() < 0.5 ? Math.random() * w * 0.12 : w - Math.random() * w * 0.12;
      g.fillStyle = `rgba(${60 + Math.random() * 60},${90 + Math.random() * 60},${30},0.55)`;
      g.beginPath();
      g.ellipse(x, Math.random() * h, 3, 1.6, Math.random() * 3, 0, TAU);
      g.fill();
    }
  });
}

export function curbTexture(a = '#d93a3a', b = '#f4f4f4') {
  return canvasTexture(16, 64, (g, w, h) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = b;
    g.fillRect(0, h / 2, w, h / 2);
  });
}

export function checkerTexture() {
  return canvasTexture(64, 16, (g, w, h) => {
    const s = 8;
    for (let x = 0; x < w / s; x++)
      for (let y = 0; y < h / s; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
        g.fillRect(x * s, y * s, s, s);
      }
  });
}

/** 나무 판자 (밧줄 다리 상판) */
export function plankTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#8f6238' : '#7d5430';
      g.fillRect(0, (i * h) / 8, w, h / 8);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, ((i + 1) * h) / 8 - 2, w, 2);
      g.fillStyle = 'rgba(40,25,10,0.5)';
      for (let k = 0; k < 6; k++) g.fillRect(Math.random() * w, (i * h) / 8 + 3 + Math.random() * 8, 10 + Math.random() * 20, 1);
    }
  });
}

/** 이끼 낀 사원 돌 (블록 무늬) */
export function stoneTexture(base = '#9a917c', moss = true) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const y = (r * h) / rows;
      const off = r % 2 ? 32 : 0;
      for (let x = -off; x < w; x += 64) {
        const v = Math.random() * 30 - 15;
        g.fillStyle = `rgba(${130 + v},${122 + v},${100 + v},0.55)`;
        g.fillRect(x + 2, y + 2, 60, h / rows - 4);
      }
      g.fillStyle = 'rgba(40,35,25,0.55)';
      g.fillRect(0, y, w, 2);
      for (let x = -off; x < w; x += 64) g.fillRect(x, y, 2, h / rows);
    }
    if (moss) {
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(${50 + Math.random() * 30},${100 + Math.random() * 50},${30 + Math.random() * 20},${0.25 + Math.random() * 0.35})`;
        g.beginPath();
        g.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 18, 2 + Math.random() * 8, Math.random() * 3, 0, TAU);
        g.fill();
      }
    }
  });
}

/** 둥근 빛 점 텍스처 (반딧불, 불씨, 빛무리) */
export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  return canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.25, mid);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

/** 같은 seed면 같은 지형이 나오는 값 노이즈 (여러 겹) */
export function makeNoise(seed) {
  const rand = seededRandom(seed);
  const perm = new Uint8Array(512), val = new Float32Array(256);
  for (let i = 0; i < 256; i++) (perm[i] = i), (val[i] = rand() * 2 - 1);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (x, z) => val[perm[(x & 255) + perm[z & 255]]];
  const noise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
    const a = v(xi, zi), b = v(xi + 1, zi), c = v(xi, zi + 1), d = v(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return (x, z, oct = 3) => {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += noise(x * f + o * 17.3, z * f - o * 9.1) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return s / norm;
  };
}

// ---------------------------------------------------------------- 용암 지하 세계 도로 재질
function underRoadTextures() {
  const draw = (glowOnly) => (g, w, h) => {
    g.fillStyle = glowOnly ? '#000' : '#26201e';
    g.fillRect(0, 0, w, h);
    if (!glowOnly) {
      for (let i = 0; i < 2000; i++) {
        const v = 30 + Math.random() * 28;
        g.fillStyle = `rgba(${v + 6},${v},${v - 4},0.4)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    }
    // 갈라진 틈 사이로 빛나는 용암
    g.strokeStyle = glowOnly ? 'rgba(255,110,30,0.9)' : 'rgba(255,90,20,0.55)';
    g.lineWidth = 1.6;
    for (let k = 0; k < 9; k++) {
      let x = w * (0.12 + Math.random() * 0.76), y = Math.random() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (Math.random() - 0.5) * 26;
        y += 6 + Math.random() * 14;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = glowOnly ? '#ffb347' : '#ffcf7a';
    g.fillRect(w * 0.03, 0, w * 0.025, h);
    g.fillRect(w * 0.945, 0, w * 0.025, h);
    g.fillStyle = '#ff6a1f';
    g.fillRect(w * 0.49, 0, w * 0.02, h * 0.5);
  };
  return { map: canvasTexture(256, 256, draw(false)), glow: canvasTexture(256, 256, draw(true)) };
}

let _under = null;
/** 지하 세계 구간 도로·연석·상판·난간 재질 (gpSpace.spaceTrackMaterials와 같은 이름) */
export function underTrackMaterials() {
  if (_under) return _under;
  const road = underRoadTextures();
  const curb = curbTexture('#ff7a1f', '#1a1412');
  const curbGlow = curbTexture('#ff7a1f', '#000000');
  const deck = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#2e2420';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      const v = 40 + Math.random() * 25;
      g.fillStyle = `rgba(${v},${v - 6},${v - 10},0.6)`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    g.strokeStyle = 'rgba(255,120,40,0.45)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
  });
  const panel = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(255,90,20,0)');
    grd.addColorStop(0.5, 'rgba(255,140,40,1)');
    grd.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, h * 0.35, w, h * 0.3);
  });
  _under = {
    road: new THREE.MeshStandardMaterial({ map: road.map, emissive: '#ffffff', emissiveMap: road.glow, emissiveIntensity: 0.9, roughness: 0.75, metalness: 0.1 }),
    curb: new THREE.MeshStandardMaterial({ map: curb, emissive: '#ffffff', emissiveMap: curbGlow, emissiveIntensity: 0.7, roughness: 0.6 }),
    deck: new THREE.MeshStandardMaterial({ map: deck, emissive: '#3a1004', emissiveIntensity: 0.4, roughness: 0.85, side: THREE.DoubleSide }),
    side: new THREE.MeshStandardMaterial({ color: '#2a1d18', emissive: '#ff4a10', emissiveIntensity: 0.35, roughness: 0.9, side: THREE.DoubleSide }),
    under: new THREE.MeshBasicMaterial({ map: panel, color: '#ffffff', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    rail: new THREE.MeshStandardMaterial({ color: '#3a302c', emissive: '#ff9a3a', emissiveIntensity: 0.25, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }),
    rail2: new THREE.MeshStandardMaterial({ color: '#ffb070', emissive: '#ff5a10', emissiveIntensity: 1.5, roughness: 0.4, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: '#2a2220', emissive: '#ff5a10', emissiveIntensity: 0.25, roughness: 0.6, metalness: 0.4 }),
  };
  return _under;
}
