// 드라이버 프로필: 경험치(XP)·레벨·라이선스 (2026-11-10, 카트 게임 분석 → "계속 하고 싶게 만드는 성장")
//   아무것도 잠그지 않음 (차·맵은 처음부터 다 열려 있음). 달릴수록 레벨과 라이선스 이름만 올라감
//   저장: localStorage `gimmick.profile` { xp, races, wins, podiums }
//   받는 신호: window 이벤트 `gimmick:raceDone` detail { map, car, mode, place, total, time }
//     (main.js가 완주 때 보냄. 기록을 저장할 수 있는 진짜 플레이일 때만)
//   쓰는 법: profile.get() → { xp, level, title, icon, color, have, need, pct, races, wins, podiums }
const KEY = 'gimmick.profile';
const TIERS = [
  { lv: 1, title: '루키 라이선스', icon: '🔰', color: '#8fd3ff' },
  { lv: 3, title: '브론즈 라이선스', icon: '🥉', color: '#d9935a' },
  { lv: 6, title: '실버 라이선스', icon: '🥈', color: '#cfd8e3' },
  { lv: 10, title: '골드 라이선스', icon: '🥇', color: '#ffd24a' },
  { lv: 15, title: '플래티넘 라이선스', icon: '💠', color: '#7ef0e0' },
  { lv: 20, title: '다이아 라이선스', icon: '💎', color: '#9db4ff' },
  { lv: 30, title: '레전드 라이선스', icon: '👑', color: '#ff8ad8' },
];
const needFor = (lv) => 200 + (lv - 1) * 80; // 이 레벨에서 다음 레벨까지 필요한 XP

/** 프로필이 아직 없을 때 한 번만: 예전에 세운 기록(맵+차마다 완주 1개 = 120 XP, 최대 1500)으로 XP를 미리 줌 */
function seedFromRecords() {
  let n = 0;
  try {
    const rec = JSON.parse(localStorage.getItem('gimmick.records') || '{}') || {};
    for (const cars of Object.values(rec)) {
      if (!cars || typeof cars !== 'object') continue;
      for (const r of Object.values(cars)) if (r && r.race > 0) n++;
    }
  } catch {}
  return Math.min(1500, n * 120);
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const j = JSON.parse(raw || 'null');
    if (j && typeof j.xp === 'number') return { xp: j.xp, races: j.races || 0, wins: j.wins || 0, podiums: j.podiums || 0, seeded: true };
    if (raw == null) {
      const p = { xp: seedFromRecords(), races: 0, wins: 0, podiums: 0, seeded: true };
      localStorage.setItem(KEY, JSON.stringify(p)); // 다시는 안 하게 바로 저장
      return p;
    }
  } catch {}
  return { xp: 0, races: 0, wins: 0, podiums: 0, seeded: true };
}
function save(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
function describe(p) {
  let lv = 1, left = p.xp;
  while (left >= needFor(lv) && lv < 99) {
    left -= needFor(lv);
    lv++;
  }
  let tier = TIERS[0];
  for (const t of TIERS) if (lv >= t.lv) tier = t;
  const need = needFor(lv);
  return { ...p, level: lv, title: tier.title, icon: tier.icon, color: tier.color, have: Math.floor(left), need, pct: Math.max(0, Math.min(1, left / need)) };
}

/** 완주 한 번의 XP: 기본 60 + 순위 보너스 + 방식 보너스 */
export function xpFor(d = {}) {
  let xp = 60;
  const place = d.place || 0, total = d.total || 0;
  if (total > 1 && place > 0) {
    xp += place === 1 ? 100 : place === 2 ? 60 : place === 3 ? 40 : 15;
    xp += Math.min(40, (total - 1) * 6); // 상대가 많을수록 조금 더
  } else xp += 20; // 혼자·타임 어택
  if (d.mode === 'item') xp += 10;
  return xp;
}

export const profile = {
  get: () => describe(load()),
  tiers: () => TIERS.slice(),
  /** 완주 보상. 돌려주는 값 { gained, before, after, levelUp, tierUp } */
  award(d = {}) {
    const p = load();
    const before = describe(p);
    const gained = xpFor(d);
    p.xp += gained;
    p.races++;
    if (d.total > 1 && d.place === 1) p.wins++;
    if (d.total > 1 && d.place > 0 && d.place <= 3) p.podiums++;
    save(p);
    const after = describe(p);
    return { gained, before, after, levelUp: after.level > before.level, tierUp: after.title !== before.title };
  },
  reset() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ xp: 0, races: 0, wins: 0, podiums: 0, seeded: true })); // 지우면 예전 기록 XP를 또 받으므로 0으로 저장
    } catch {}
  },
};

// 게임 화면: 완주 신호를 받으면 XP를 주고 작은 알림을 띄움
function pill(r) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('xpPill');
  if (!el) {
    el = document.createElement('div');
    el.id = 'xpPill';
    el.style.cssText =
      'position:fixed;left:50%;bottom:22px;transform:translate(-50%,20px);z-index:60;padding:10px 18px;border-radius:999px;' +
      'background:rgba(12,18,32,.88);border:1px solid rgba(255,255,255,.18);color:#fff;font:700 15px/1.2 system-ui,sans-serif;' +
      'box-shadow:0 8px 30px rgba(0,0,0,.45);opacity:0;transition:opacity .35s,transform .35s;pointer-events:none;white-space:nowrap';
    document.body.appendChild(el);
  }
  const a = r.after;
  el.innerHTML =
    `<span style="color:#7dffb0">+${r.gained} XP</span> · <span style="color:${a.color}">${a.icon} Lv.${a.level} ${a.title}</span>` +
    (r.tierUp ? ' · <span style="color:#ffd24a">새 라이선스!</span>' : r.levelUp ? ' · <span style="color:#ffd24a">레벨 업!</span>' : '') +
    `<span style="display:block;margin-top:6px;height:5px;border-radius:3px;background:rgba(255,255,255,.15);overflow:hidden">` +
    `<span style="display:block;height:100%;width:${Math.round(a.pct * 100)}%;background:${a.color}"></span></span>`;
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%,0)';
  });
  clearTimeout(pill.t);
  pill.t = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%,20px)';
  }, 6000);
}
if (typeof window !== 'undefined' && !window.__gimmickProfileHooked) {
  window.__gimmickProfileHooked = true;
  window.addEventListener('gimmick:raceDone', (e) => {
    try {
      const r = profile.award(e.detail || {});
      pill(r);
      window.dispatchEvent(new CustomEvent('gimmick:xp', { detail: r }));
    } catch {}
  });
}
