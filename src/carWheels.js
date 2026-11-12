// 차종별 휠. 타이어/휠은 함께 회전하고 캘리퍼는 서스펜션에 고정된다.
import * as THREE from 'three';

function merge(parts) {
  const positions = [], normals = [];
  for (const source of parts) {
    const g = source.index ? source.toNonIndexed() : source;
    for (const v of g.attributes.position.array) positions.push(v);
    for (const v of g.attributes.normal.array) normals.push(v);
    if (g !== source) g.dispose();
    source.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return g;
}

export function buildWheel(add, spin, steer, M, look, r, width, side) {
  const offroad = look.tire === 'knobby';
  const formula = ['f1', 'proto'].includes(look.style);
  const classic = look.style === 'roadster';
  const kart = look.style === 'kart';
  const wheelR = r * (offroad ? 0.55 : formula ? 0.65 : 0.69);
  const half = width / 2;
  // 닫힌 타이어 단면: 둥근 어깨에서 옆면과 휠 안쪽까지 이어진다.
  const profile = [
    [wheelR * 0.97, -half * 0.94], [r * 0.77, -half * 1.01],
    [r * 0.9, -half * 0.99], [r * 0.975, -half * 0.79],
    [r, -half * 0.5], [r, half * 0.5],
    [r * 0.975, half * 0.79], [r * 0.9, half * 0.99],
    [r * 0.77, half * 1.01], [wheelR * 0.97, half * 0.94],
    [wheelR * 0.97, -half * 0.94],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const tire = new THREE.LatheGeometry(profile, 28).rotateZ(Math.PI / 2);
  add(tire, M.rubber, 0, 0, 0, spin);
  const rimParts = [], detailParts = [], brakeParts = [];
  rimParts.push(new THREE.CylinderGeometry(wheelR * 0.98, wheelR * 0.98, width * 0.76, 28, 1, true).rotateZ(Math.PI / 2));
  const torus = (radius, tube, x) => new THREE.TorusGeometry(radius, tube, 6, 28).rotateY(Math.PI / 2).translate(x, 0, 0);
  const bar = (x, radial, length, thickness, angle) => {
    const g = new THREE.BoxGeometry(width * 0.1, length, thickness);
    g.translate(x, radial, 0).rotateX(angle);
    return g;
  };
  for (const s of [-1, 1]) {
    const face = s * half * 0.89;
    rimParts.push(torus(wheelR, r * 0.022, s * half * 0.98));
    // Inner barrel, recessed spoke face and hub give the wheel real depth.
    rimParts.push(new THREE.CylinderGeometry(wheelR * 0.19, wheelR * 0.22, width * 0.13, 12).rotateZ(Math.PI / 2).translate(face, 0, 0));
    const count = classic ? 16 : kart ? 3 : offroad ? 6 : formula ? 8 : 5;
    for (let k = 0; k < count; k++) {
      const angle = k * Math.PI * 2 / count;
      if (formula) {
        detailParts.push(bar(face, wheelR * 0.52, wheelR * 0.72, r * 0.085, angle));
      } else if (classic) {
        rimParts.push(bar(face, wheelR * 0.55, wheelR * 0.85, r * 0.018, angle + 0.14));
      } else {
        for (const fork of offroad || kart ? [0] : [-1, 1]) {
          rimParts.push(bar(face, wheelR * 0.56, wheelR * 0.83, r * (offroad ? 0.1 : 0.065), angle + fork * 0.065));
        }
      }
      const boltAngle = angle + 0.2;
      detailParts.push(new THREE.SphereGeometry(r * 0.026, 5, 3).translate(face + s * r * 0.015, Math.cos(boltAngle) * wheelR * 0.26, Math.sin(boltAngle) * wheelR * 0.26));
    }
    brakeParts.push(new THREE.CylinderGeometry(wheelR * 0.83, wheelR * 0.83, 0.012, 24).rotateZ(Math.PI / 2).translate(s * half * 0.58, 0, 0));
    detailParts.push(torus(r * 0.86, r * 0.007, s * half * 1.005));
  }
  add(merge(rimParts), M.rimMat, 0, 0, 0, spin);
  add(merge(detailParts), formula ? M.carbon : M.darkMetal, 0, 0, 0, spin).castShadow = false;
  add(merge(brakeParts), M.metal, 0, 0, 0, spin).castShadow = false;
  if (!formula && !kart) {
    add(new THREE.BoxGeometry(width * 0.18, wheelR * 0.5, wheelR * 0.2), M.trim, side * half * 0.7, 0, -wheelR * 0.66, steer).castShadow = false;
  }
  if (look.wall) {
    const mat = new THREE.MeshStandardMaterial({ color: look.wall, roughness: 0.65 });
    add(merge([-1, 1].map((s) => torus(r * 0.84, r * (classic ? 0.045 : 0.012), s * half * 1.01))), mat, 0, 0, 0, spin).castShadow = false;
  }
}
