// 홈 화면·게임이 같이 쓰는 정보: 맵 목록(data/maps.json), 차 목록(carRoster.js), 마지막 선택, 맵 미리보기 그림
const LAST_KEY = 'gimmick.last'; // { map, car } 마지막으로 고른 맵·차

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 불러오기 실패`);
  return res.json();
}

// 맵 목록 (maps.json이 없거나 깨져도 게임은 되도록 기본값)
const FALLBACK_MAPS = [
  { id: 'gp', file: 'data/grandprix.json', title: '구름섬 그랑프리', tags: [], theme: ['#3b2b74', '#0e1030', '#9ad8ff'] },
  { id: 'sea', file: 'data/sea.json', title: '바닷가 코스', tags: [], theme: ['#1f5d7a', '#0b2233', '#7fe3ff'] },
];
// 새 맵 (2026-11-10 밤샘 작업): maps.json에 아직 없으면 이 기본 카드로 보여 줌 (맵 파일이 있을 때만, 홈 화면이 확인)
const EXTRA_MAPS = [
  { id: 'neon', file: 'data/neon.json', title: '네온 시티', subtitle: '밤의 네온 도시', desc: '빛나는 고층 빌딩 사이를 달리는 밤의 시가지 코스.', tags: ['🌃 야경', '🏙️ 시가지'], theme: ['#3a1460', '#0a0618', '#ff4fd8'], difficulty: 2, extra: true },
  { id: 'moon', file: 'data/moon.json', title: '달 중력 기지', subtitle: '가벼운 중력 · 큰 점프', desc: '중력이 약한 달 기지. 점프가 길고 높아요.', tags: ['🌙 낮은 중력', '🚀 점프'], theme: ['#2b2f45', '#07080f', '#d9e2ff'], difficulty: 2, extra: true },
  { id: 'jungle', file: 'data/jungle.json', title: '정글 유적', subtitle: '숲 속 고대 유적', desc: '울창한 정글과 고대 유적을 지나는 코스.', tags: ['🌴 정글', '🗿 유적'], theme: ['#1d4a2a', '#07160c', '#8dff8a'], difficulty: 3, extra: true },
];
let mapsPromise = null;
export function loadMaps() {
  if (!mapsPromise)
    mapsPromise = loadJSON('data/maps.json')
      .then((d) => d.maps)
      .catch(() => FALLBACK_MAPS)
      .then((list) => [...list, ...EXTRA_MAPS.filter((e) => !list.some((m) => m.id === e.id))]);
  return mapsPromise;
}

/**
 * 차 등급(클래스): data/cars.json의 classes + 차마다 class. 없으면 빈 목록 (홈 화면이 등급 탭 없이 보여 줌)
 * @returns {Promise<{ classes: {id,name,desc,color}[], classOf: Record<string,string> }>}
 */
let classesPromise = null;
export function loadCarClasses() {
  if (!classesPromise)
    classesPromise = loadJSON('data/cars.json')
      .then((d) => ({
        classes: Array.isArray(d.classes) ? d.classes.filter((c) => c && c.id) : [],
        classOf: Object.fromEntries((d.cars || []).filter((c) => c && c.id).map((c) => [c.id, c.class || null])),
      }))
      .catch(() => ({ classes: [], classOf: {} }));
  return classesPromise;
}

// 차 목록: carRoster.js (차 담당 에이전트가 만듦). 불러오기 실패하면 기본 차 하나만
let rosterPromise = null;
export function loadRoster() {
  if (!rosterPromise) {
    rosterPromise = import('./carRoster.js').catch((err) => {
      console.warn('carRoster.js 불러오기 실패 → 기본 차만 사용', err);
      return {
        DEFAULT_CAR_ID: 'f1',
        async listCars() {
          return [{ id: 'f1', name: '레드 포뮬러', tag: 'FORMULA', desc: '기본 차', stats: { speed: 3, accel: 4, handling: 4, grip: 4, boost: 3 }, look: '#e8463a' }];
        },
        async loadCarConfig() {
          const cfg = await loadJSON('data/car.json');
          cfg.carId = 'f1';
          cfg.carName = '레드 포뮬러';
          cfg.look = '#e8463a';
          return cfg;
        },
      };
    });
  }
  return rosterPromise;
}

export function getLast() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
export function setLast(v) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...getLast(), ...v }));
  } catch {}
}

/**
 * 게임 주소: ?map=..&car=..(&그 밖에)
 *   extra: { mode: 'race' | 'time', tutorial: 1, room: 'ABCD', ... } (값이 null/undefined/''/false면 안 넣음)
 */
export function raceUrl(map, car, extra = {}) {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('map', map);
  if (car) u.searchParams.set('car', car);
  for (const [k, v] of Object.entries(extra || {})) if (v != null && v !== '' && v !== false) u.searchParams.set(k, String(v));
  return u.toString();
}

/** 레이스 방식: 주소의 mode 값, 화면 이름 */
export const RACE_MODES = [
  { id: 'race', icon: '🏁', name: '봇 레이스', desc: '봇들과 순위 경쟁' },
  { id: 'item', icon: '🎁', name: '아이템전', desc: '아이템 상자를 먹고 부스터·로켓·방어막으로 싸우는 봇 레이스! 드리프트로 게이지를 채우면 부스터' },
  { id: 'champ', icon: '🏆', name: '챔피언십', desc: '여러 맵 시즌 · 점수로 챔피언 경쟁' },
  { id: 'time', icon: '⏱️', name: '타임 어택', desc: '혼자 달리며 고스트와 기록 경쟁' },
  { id: 'net', icon: '🌐', name: '멀티플레이', desc: '친구와 방 코드로 같이 달리기' },
  { id: 'free', icon: '🧭', name: '자유 연습', desc: '혼자 편하게 (기록은 남아요)' },
];
/** 튜토리얼 주소 (그랑프리) */
export function tutorialUrl(car, extra = {}) {
  return raceUrl(extra.map || 'gp', car, { tutorial: 1, ...extra, map: undefined });
}
/** 홈 화면 주소 (page = 'car' | 'map' 이면 그 화면부터) */
export function homeUrl(page) {
  const u = new URL(location.href);
  u.search = '';
  if (page) u.searchParams.set('menu', page);
  return u.toString();
}

/** Catmull-Rom 닫힌 곡선 → 촘촘한 점 [x, y, z] (미리보기·길이 계산용) */
export function sampleOutline(data, perSeg = 12) {
  const s = data.scale || 1;
  const P = (data.points || []).map((p) => (p.length >= 3 ? [p[0] * s, p[1] * s, p[2] * s] : [p[0] * s, 0, p[1] * s]));
  const n = P.length;
  const out = [];
  if (n < 3) return out;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
    }
  }
  return out;
}

export function outlineLength(pts) {
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return L;
}

/** 맵 미리보기 그림: 위에서 본 코스 모양 (빛나는 선 + 출발점) */
export function drawTrackThumb(canvas, pts, theme, opts = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const [c1, c2, line] = theme || ['#2b3f6b', '#141c33', '#ffcf3f'];
  const bg = g.createLinearGradient(0, 0, W * 0.3, H);
  bg.addColorStop(0, c1);
  bg.addColorStop(1, c2);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // 잔잔한 격자
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  for (let x = 0; x < W; x += 18) (g.beginPath(), g.moveTo(x + 0.5, 0), g.lineTo(x + 0.5, H), g.stroke());
  for (let y = 0; y < H; y += 18) (g.beginPath(), g.moveTo(0, y + 0.5), g.lineTo(W, y + 0.5), g.stroke());
  if (!pts.length) return;
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const pad = opts.pad ?? 18;
  const sc = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxZ - minZ || 1));
  const ox = (W - (maxX - minX) * sc) / 2, oz = (H - (maxZ - minZ) * sc) / 2;
  // 게임 미니맵과 같은 방향 (x 뒤집음)
  const to = (p) => [W - ox - (p[0] - minX) * sc, H - oz - (p[2] - minZ) * sc];
  g.lineJoin = g.lineCap = 'round';
  const path = () => {
    g.beginPath();
    pts.forEach((p, i) => {
      const [u, v] = to(p);
      i ? g.lineTo(u, v) : g.moveTo(u, v);
    });
    g.closePath();
  };
  path();
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 9;
  g.stroke();
  g.shadowColor = line;
  g.shadowBlur = 12;
  g.strokeStyle = line;
  g.lineWidth = 3.2;
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1.1;
  g.stroke();
  // 출발점 (체크 무늬 깃발 점)
  const [sx, sy] = to(pts[0]);
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(sx, sy, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(sx, sy, 2.4, 0, Math.PI * 2);
  g.fill();
}
