// 변신 연습장 소품·안내 (starterMap.js의 buildProps)
//   - 비행 고리 + 상승 기류·착지계·착지 흙먼지: 그랑프리 소품(gpProps.js)을 그대로 씀 (track.rings / thermals / skyPath가 같은 형식)
//   - 기믹 미리 알림: 처음 온 사람이 놀라지 않게, 기믹 앞에서 큰 안내 카드 한 번 (data.signs의 t 지점을 지날 때)
//       1바퀴: 가속·물길·점프·활주로·마지막 코너 전부 / 2바퀴: 활주로만 짧게 ("직진하면 하늘길")
//     플레이어만 (봇·고스트 없음). 리플레이·튜토리얼·아카데미에서는 안 띄움
import * as THREE from 'three';
import { buildGrandPrixProps } from './gpProps.js';

const CARDS = {
  accel: { icon: '⚡', text: '쭉 밟아요!', sub: '150 km/h를 넘기면 가속 모드로 변신' },
  water: { icon: '🚤', text: '곧 물길!', sub: '그대로 들어가면 배로 변신해요' },
  jump: { icon: '🦘', text: '점프!', sub: '앞쪽 화살표를 따라 똑바로 · 넓은 착지판이 받아 줘요' },
  runway: { icon: '✈️', text: '직진하면 활주로!', sub: '끝에서 저절로 날아요 · 고리를 지나 착륙장으로 · 오른쪽은 땅길' },
  final: { icon: '🏁', text: '마지막 코너!', sub: '기울어진 길이라 빠르게 돌 수 있어요' },
};
const LAP2 = { runway: { icon: '✈️', text: '하늘길 한 번 더!', sub: '활주로로 직진 · Space 위로 / Shift 아래로' } };

export function buildStarterProps(track, scene) {
  const gp = buildGrandPrixProps(track, scene);
  const S = track.samples, N = S.length - 1;
  const signs = (track.data && track.data.signs) || {};
  // 발사대 표시는 바뀐 노면을 따라 놓음 (충돌 없음). 기존 JUMP 아치도 kickN을 따라 이동한다.
  const arrow = new THREE.Shape();
  arrow.moveTo(-0.55, -1.5); arrow.lineTo(0.55, -1.5); arrow.lineTo(0.55, 0);
  arrow.lineTo(1.15, 0); arrow.lineTo(0, 1.5); arrow.lineTo(-1.15, 0); arrow.lineTo(-0.55, 0); arrow.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrow);
  const arrowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
  for (const j of track.jumps || []) for (const back of [22, 14, 6]) {
    const s = S[(j.lipI - Math.round(back / (track.length / N)) + N) % N];
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    const mat = new THREE.Matrix4().makeBasis(s.rightB, s.tan3, s.up);
    mesh.quaternion.setFromRotationMatrix(mat);
    mesh.position.copy(track.surf(s, 0, 0.055));
    gp.group.add(mesh);
  }

  const qs = new URLSearchParams(location.search);
  const quiet = !!(qs.get('tutorial') || qs.get('academy') || qs.get('stcards') === '0');

  // ---------------------------------------------------------------- 안내 카드 (DOM)
  const card = document.createElement('div');
  card.id = 'starterCard';
  card.style.cssText =
    'position:fixed;left:50%;top:17%;transform:translateX(-50%) translateY(-8px) scale(.96);z-index:5;pointer-events:none;opacity:0;transition:opacity .28s, transform .28s;' +
    'display:flex;align-items:center;gap:14px;padding:10px 22px 11px 16px;border-radius:999px;background:rgba(10,24,48,.62);border:1px solid rgba(255,255,255,.28);' +
    'box-shadow:0 6px 24px rgba(0,0,0,.25);backdrop-filter:blur(6px);color:#fff;white-space:nowrap;font-family:"Pretendard","Malgun Gothic",sans-serif';
  if (document.body) document.body.append(card);
  let cardT = 0;
  function showCard(c) {
    card.innerHTML = `<span style="font-size:34px;line-height:1">${c.icon}</span><span><b style="display:block;font-size:24px;font-weight:900;letter-spacing:.5px;line-height:1.15">${c.text}</b><span style="display:block;font-size:14px;font-weight:600;opacity:.9;margin-top:2px">${c.sub}</span></span>`;
    card.style.opacity = '1';
    card.style.transform = 'translateX(-50%) translateY(0) scale(1)';
    cardT = 3.2;
  }
  const shown = new Set();
  let lastT = null;
  const stats = { cards: [] };

  function update(dt, car) {
    gp.update(dt, car);
    if (cardT > 0) {
      cardT -= dt;
      if (cardT <= 0) {
        card.style.opacity = '0';
        card.style.transform = 'translateX(-50%) translateY(-8px) scale(.96)';
      }
    }
    if (quiet) return;
    const G = window.game;
    const race = G && G.race;
    if (!race || race.phase !== 'racing' || (G.replay && G.replay.active) || !car.trackInfo) {
      lastT = null;
      return;
    }
    if (track.onShortcut && track.onShortcut(car.pos)) return; // 활주로·하늘 위에서는 코스 위치가 들쭉날쭉
    const t = car.trackInfo.t;
    if (lastT !== null && car.forwardSpeed > 3) {
      for (const [key, st] of Object.entries(signs)) {
        // lastT → t 사이에 표지 지점을 앞으로 지나감 (출발선 넘김 처리)
        let a = lastT, b = t;
        if (b < a - 0.5) b += 1;
        let s = st;
        if (s < a - 0.5) s += 1;
        if (!(a < s && s <= b) || b - a > 0.05) continue;
        const id = `${race.lap}:${key}`;
        if (shown.has(id)) continue;
        shown.add(id);
        const c = race.lap === 1 ? CARDS[key] : LAP2[key];
        if (c) {
          showCard(c);
          stats.cards.push({ key, lap: race.lap, time: +race.time.toFixed(2) });
        }
      }
    }
    lastT = t;
  }
  function reset() {
    gp.reset();
    shown.clear();
    lastT = null;
    cardT = 0;
    card.style.opacity = '0';
    stats.cards.length = 0;
  }
  return { ...gp, update, reset, animate: (time) => gp.animate(time), starterStats: stats, showCard };
}
