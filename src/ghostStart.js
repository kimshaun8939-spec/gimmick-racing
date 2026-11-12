// 고스트의 출발점: 새 기록은 start, 옛 기록은 압축된 첫 위치로 확인.
export function ghostStart(json, track) {
  if (json.start) {
    const s = json.start;
    if (Number.isFinite(s.x) && Number.isFinite(s.z)) return { x: s.x, z: s.z };
    if (Number.isFinite(s.t) && track) return track.sampleAt(s.t).pos;
    return null;
  }
  try {
    if (typeof json.data !== 'string' || json.data.length < 32) return null;
    const first = atob(json.data.slice(0, 32)); // 첫 샘플 24바이트만 읽음
    const bytes = Uint8Array.from(first, c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    return { x: view.getInt32(0, true) / 100, z: view.getInt32(8, true) / 100 };
  } catch { return null; }
}
export const startDistance = (a, b) => a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity;
export function matchingStart(json, start, track) {
  return startDistance(ghostStart(json, track), start) <= 5;
}
/** 일반 출발과 떨어져 있고, 알려진 그리드 칸의 좌우 위치까지 일치할 때만 확정. */
export function gridStart(json, track) {
  const p = ghostStart(json, track);
  if (!p || startDistance(p, track.sampleAt(0.992).pos) <= 5) return false;
  const lat = Math.min(3.4, (track.width || 16) / 2 * 0.42);
  for (let k = 0; k < 8; k++) {
    const t = ((1 - (9 + 8 * k) / track.length) % 1 + 1) % 1;
    const s = track.sampleAt(t), offset = (k % 2 === 0 ? -1 : 1) * lat;
    const slot = { x: s.pos.x + s.right.x * offset, z: s.pos.z + s.right.z * offset };
    if (startDistance(p, slot) <= 1.5) return true; // 홈 곡선과 실제 트랙 샘플의 반올림 오차 허용
  }
  return false;
}
