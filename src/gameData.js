// 홈 화면·게임이 같이 쓰는 정보: 맵 목록(data/maps.json), 차 목록(carRoster.js), 마지막 선택, 맵 미리보기 그림
const LAST_KEY = 'gimmick.last'; // { map, car } 마지막으로 고른 맵·차

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 불러오기 실패`);
  return res.json();
}

// 맵 목록 (maps.json이 없거나 깨져도 게임은 되도록 기본값)
const FALLBACK_MAPS = [
  {
    "id": "glacier",
    "file": "data/glacier.json",
    "title": "빙하 하이웨이",
    "subtitle": "오로라 설원 고속 서킷 · 시원하게 쭉쭉",
    "desc": "오로라가 춤추는 밤의 빙하 위를 달리는 고속 코스. 코너가 적고 길이 넓어서 마음껏 밟을 수 있어요. 1 km 직선, 얼음 터널을 지나는 큰 내리막, 얼어붙은 강 위 다리, 기울어진 고속 스위퍼. 2바퀴.",
    "tags": [
      "🏔️ 설원",
      "🌌 오로라",
      "💨 고속 직선",
      "🧊 얼음 터널",
      "🌉 빙하 다리"
    ],
    "theme": [
      "#1d4f7a",
      "#060d1c",
      "#7fffd4"
    ],
    "difficulty": 1
  },
  {
    "id": "sea",
    "file": "data/sea.json",
    "title": "노을 해안 서킷",
    "subtitle": "하얀 마을 · 절벽 · 바다 위 배 구간",
    "desc": "노을 진 항구에서 출발해 하얀 마을과 절벽 헤어핀을 지나, 사장교를 건너 등대섬으로. 바다에 들어가면 배로 변신해 부표 길·파도 점프·바다 동굴을 지나 해변으로 돌아와요. 2바퀴.",
    "tags": [
      "🌅 노을 해안",
      "🚤 배 변신",
      "🌊 파도 점프",
      "⛰️ 절벽 헤어핀",
      "🌉 사장교"
    ],
    "theme": [
      "#ff8a5c",
      "#2a1838",
      "#7fe3ff"
    ],
    "difficulty": 2
  },
  {
    "id": "jungle",
    "file": "data/jungle.json",
    "title": "정글 유적",
    "subtitle": "사원 포털 + 용암 지하 세계",
    "desc": "울창한 정글의 피라미드 터널로 들어가면 용암이 끓는 지하 세계! 나선 도로를 돌아 폭포 절벽으로 나와, 밧줄 다리와 둥실 뜨는 저중력 언덕, 동굴을 지나요. 2바퀴.",
    "tags": [
      "🌋 차원 이동",
      "🌀 450° 나선",
      "🌉 밧줄 다리",
      "🪨 저중력",
      "🦇 동굴"
    ],
    "theme": [
      "#2f6f25",
      "#1a0c06",
      "#ffb347"
    ],
    "difficulty": 2
  },
  {
    "id": "neon",
    "file": "data/neon.json",
    "title": "네온 시티",
    "subtitle": "비 내리는 사이버펑크 야간 서킷",
    "desc": "네온 빌딩 숲 사이 시가지 서킷. 나선 고가를 올라 자기 위를 넘고, 빌딩을 뚫는 자석 튜브에서 벽과 천장을 달리고, 포털 너머 글리치 차원의 저중력 언덕을 날아 도시로 돌아온다. 2바퀴.",
    "tags": [
      "🌃 야간 시가지",
      "🧲 벽·천장 튜브",
      "⚡ 글리치 차원",
      "🪐 저중력 점프",
      "🌉 고가 교차"
    ],
    "theme": [
      "#2a0a4a",
      "#07051a",
      "#ff2f8e"
    ],
    "difficulty": 2
  },
  {
    "id": "mirage",
    "file": "data/mirage.json",
    "title": "미라지 캐니언",
    "subtitle": "청록 비콘 모래폭풍 · 협곡 벽타기 · 오아시스",
    "desc": "붉은 사암 협곡을 달리며 15° 벽타기 코너를 돌아요. 움직이는 모래폭풍 안에서는 청록 비콘과 노면 선이 길을 알려 줘요. 측풍·순풍, 매끈한 모래 능선, 태양 신전과 오아시스까지. 5.48 km · 2바퀴.",
    "tags": [
      "🏜️ 사막 협곡",
      "💠 모래폭풍 비콘",
      "⤴️ 협곡 벽타기",
      "🌴 오아시스",
      "🎈 열기구"
    ],
    "theme": [
      "#c18b57",
      "#23576c",
      "#ffdc8c"
    ],
    "difficulty": 3,
    "length": 5480
  },
  {
    "id": "foundry",
    "file": "data/foundry.json",
    "title": "클록워크 파운드리",
    "subtitle": "용광로 도시 · 교차 고가 · 움직이는 도로",
    "desc": "거대한 톱니와 쇳물이 흐르는 공장 도시를 달려요. 25 m 교차 고가, 18° 용광로 사발, 헤어핀과 시케인, 회전 이송대, 순방향·역방향 분류 벨트와 횡이송 적재장. 머리 위 화물열차와 로봇팔도 움직여요. 5.73 km · 2바퀴.",
    "tags": [
      "⚙️ 분류 컨베이어",
      "🔄 회전 이송대",
      "🌉 교차 고가",
      "🔥 용광로 사발",
      "🚂 움직이는 공장"
    ],
    "theme": [
      "#a9793c",
      "#173f3f",
      "#ffdc91"
    ],
    "difficulty": 3,
    "length": 5733
  },
  {
    "id": "moon",
    "file": "data/moon.json",
    "title": "달 중력 기지",
    "subtitle": "저중력 점프 + 중력 루프",
    "desc": "지구가 뜬 검은 하늘 아래 달 기지를 도는 코스. 저중력 구역에서는 협곡을 둥실 뛰어넘고, 무거운 고중력 내리막을 지나, 자석 루프에서 거꾸로 한 바퀴 돌아요. 2바퀴.",
    "tags": [
      "🌙 저중력 점프",
      "🔄 중력 루프",
      "⬇️ 고중력 구역",
      "🛰️ 달 기지"
    ],
    "theme": [
      "#2b3350",
      "#05060c",
      "#c08cff"
    ],
    "difficulty": 3
  },
  {
    "id": "gp",
    "file": "data/grandprix.json",
    "title": "구름섬 그랑프리",
    "subtitle": "하늘 섬 + 우주 차원",
    "desc": "구름 위 섬들을 다리로 잇는 긴 그랑프리. 포털을 지나 우주를 달리고, 활주로에서는 비행기로 변신해 고리를 통과해요.",
    "tags": [
      "🌌 우주 차원",
      "✈️ 비행 루트",
      "🌉 다리",
      "🏁 긴 코스"
    ],
    "theme": [
      "#3b2b74",
      "#0e1030",
      "#9ad8ff"
    ],
    "difficulty": 3
  },
  {
    "id": "volcano",
    "file": "data/volcano.json",
    "title": "화산 지대",
    "subtitle": "낭떠러지 산길 · 용암 점프 · 아주 어려움",
    "desc": "불을 뿜는 화산을 지나는 아주 어려운 코스. 지그재그 헤어핀으로 산을 올라, 양쪽이 낭떠러지인 칼날 능선을 달리고, 용암 협곡을 뛰어넘고 절벽에서 뛰어내려요. 길 끝 밖은 용암! 1바퀴 약 3분.",
    "tags": [
      "🌋 화산",
      "⛰️ 낭떠러지 산길",
      "🔥 용암 점프",
      "🪂 절벽 낙하",
      "💀 아주 어려움"
    ],
    "theme": [
      "#7a1e0c",
      "#140504",
      "#ff8a2a"
    ],
    "difficulty": 4
  }
];
// 누락된 카드도 같은 난이도 순서로 복구.
const EXTRA_MAPS = FALLBACK_MAPS.map(m => ({ ...m, extra: true }));
const MAP_ORDER = ["glacier","sea","jungle","neon","mirage","foundry","moon","gp","volcano"];
let mapsPromise = null;
export function loadMaps() {
  if (!mapsPromise)
    mapsPromise = loadJSON('data/maps.json')
      .then((d) => d.maps)
      .catch(() => FALLBACK_MAPS)
      .then((list) => [...list, ...EXTRA_MAPS.filter((e) => !list.some((m) => m.id === e.id))].sort((a, b) => MAP_ORDER.indexOf(a.id) - MAP_ORDER.indexOf(b.id)));
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
