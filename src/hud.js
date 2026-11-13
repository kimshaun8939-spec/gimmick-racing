import { keybinds } from './keybinds.js';
import { mixState } from './audioMix.js';
import { touchWanted } from './touch.js';
import { pad as gamepad } from './gamepad.js';
import { metaResultsHtml, playMetaCelebration } from './metaUI.js';
// 화면 위 정보 표시 (랩, 시간, 속도, 드리프트 게이지, 미니맵, 안내 문구)
import { academy, licenseChip } from './academyStore.js'; // 결과 화면 라이선스 배지 (드라이빙 아카데미, 2026-11-12)
const $ = (id) => document.getElementById(id);

export function fmtTime(sec) {
  if (!isFinite(sec)) return '--:--.---';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** 결과표 순위 줄들 (rows = raceSystem.results) */
function standRows(rows) {
  const esc = (x) => String(x ?? '').replace(/</g, '&lt;');
  const lead = rows[0].total;
  return (
    '<tr class="hd"><td>순위</td><td>이름</td><td>최고 랩</td><td>기록</td></tr>' +
    rows
      .map((r, i) => {
        const time = i === 0 ? fmtTime(r.total) : `+${(r.total - lead).toFixed(3)}`;
        return `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.pos}</td><td class="nm"><i style="background:${esc(r.color)}"></i>${esc(r.name)}<small>${esc(r.carName || '')}</small></td><td>${r.bestLap ? fmtTime(r.bestLap) : '-'}</td><td>${r.projected ? `<span class="proj" title="아직 달리는 중: 예상 기록">≈${time}</span>` : time}</td></tr>`;
      })
      .join('')
  );
}

/** 시상대 (1·2·3위): rows = [{ name, color, carName, sub }] (1위부터) */
/** 코너 분석 (cornerReport.summary): 개선할 코너 TOP 3 + 한 줄 팁, 코너마다 기준 대비 ± */
function cornerHtml(c) {
  if (!c || !c.rows || !c.rows.length) return '';
  const esc = (x) => String(x ?? '').replace(/</g, '&lt;');
  const sgn = (d) => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2);
  const refName = c.refKind === 'bot' ? '가장 빠른 봇' : c.refKind === 'me' ? '내 예전 최고' : '';
  const top = c.top.length
    ? c.top.slice(0, 2).map((r) => `<div class="ct"><b>T${esc(r.num)}</b>${r.delta != null && r.delta > 0 ? `<span class="lost">${sgn(r.delta)}초</span>` : ''}<span class="tip">${esc(r.tip.text)}</span></div>`).join('')
    : '<div class="ct ok">모든 코너 깔끔해요! 👍</div>';
  const chips = c.rows
    .map((r) => {
      const cls = r.delta == null ? '' : r.delta > 0.05 ? ' slow' : r.delta < -0.02 ? ' fast' : '';
      return `<span class="cc${cls}" title="${esc(r.tip.text)}">T${esc(r.num)}${r.delta != null ? ` ${sgn(r.delta)}` : ''}</span>`;
    })
    .join('');
  return `<div class="cana"><div class="hd">🔍 코너 분석${refName ? ` <small>기준: ${refName}${c.lost > 0.05 ? ` · 합계 ${c.lost.toFixed(2)}초 느림` : ''}</small>` : ''}</div>
    <div class="ctop">${top}</div><details class="res-detail"><summary>코너별 기록 자세히</summary><div class="cchips">${chips}</div></details></div>`;
}

function podiumHtml(rows, cls = '') {
  const esc = (x) => String(x ?? '').replace(/</g, '&lt;');
  if (!rows || rows.length < 2) return '';
  const order = [1, 0, 2].filter((i) => rows[i]); // 2위 · 1위 · 3위 순서로 놓음
  return `<div class="podium ${cls}">${order
    .map((i) => {
      const r = rows[i];
      return `<div class="pd p${i + 1}${r.isPlayer ? ' me' : ''}"><div class="who"><i style="background:${esc(r.color)}"></i>${esc(r.name)}</div><small>${esc(r.sub || r.carName || '')}</small><div class="blk">${i + 1}</div></div>`;
    })
    .join('')}</div>`;
}
/** 챔피언십 순위표: table = [{ pos, name, color, points, gained, isPlayer, wins }] */
function champHtml(c) {
  const esc = (x) => String(x ?? '').replace(/</g, '&lt;');
  const dots = c.maps
    .map((m, i) => `<span class="${i < c.no ? 'done' : ''}${i === c.no - 1 ? ' now' : ''}">${esc(m)}</span>`)
    .join('');
  return `<div class="champ"><div class="ct">🏆 챔피언십 ${c.final ? '최종 순위' : `${c.no}/${c.total} 경기 뒤 순위`}</div><div class="cmaps">${dots}</div>
    <table class="cst"><tr class="hd"><td>순위</td><td>이름</td><td>이번 경기</td><td>점수</td></tr>${c.table
      .map((r) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.pos}</td><td class="nm"><i style="background:${esc(r.color)}"></i>${esc(r.name)}${r.wins ? ` <small>🏆×${r.wins}</small>` : ''}</td><td class="gain">${r.gained ? '+' + r.gained : '-'}</td><td><b>${r.points}</b></td></tr>`)
      .join('')}</table></div>`;
}
/** 꽃가루 (우승·시즌 우승) */
function confetti(box, n = 70) {
  const cols = ['#ffd23a', '#ff5a6e', '#5cff8a', '#4fc3ff', '#c98bff', '#ffffff'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = cols[i % cols.length];
    p.style.animationDelay = `${Math.random() * 1.6}s`;
    p.style.animationDuration = `${2.4 + Math.random() * 2}s`;
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty('--rot', `${Math.random() * 900 - 450}deg`);
    wrap.appendChild(p);
  }
  box.appendChild(wrap);
  setTimeout(() => wrap.remove(), 6200);
}

// 믹서의 효과음 버스를 사용하므로 음소거·전체/효과음 크기가 실시간으로 적용됨.
let recordAudio, recordNotes = [];
const reducedResultsMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function stopRecordSound() {
  for (const note of recordNotes) { try { note.stop(); } catch {} }
  recordNotes = [];
}
function recordCelebration(box, full) {
  stopRecordSound();
  if (!reducedResultsMotion()) {
    const particles = document.createElement('div');
    particles.className = 'record-particles';
    particles.setAttribute('aria-hidden', 'true');
    particles.innerHTML = Array.from({ length: full ? 30 : 10 }, (_, i) => '<i style="--x:' + (i * 37 % 100) + '%;--dx:' + ((i % 7 - 3) * 22) + 'px;--delay:' + (i % 5 * .08) + 's;--turn:' + (i * 43) + 'deg"></i>').join('');
    box.appendChild(particles);
    setTimeout(() => particles.remove(), 2500);
  }
  if (mixState().muted || !navigator.userActivation?.hasBeenActive) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    recordAudio ||= new AC();
    const ctx = recordAudio;
    // 같은 오디오를 재사용해 다시 할 때 컨텍스트가 늘지 않게 함.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t = ctx.currentTime + .03;
    (full ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 783.99]).forEach((hz, i) => {
      const note = ctx.createOscillator(), gain = ctx.createGain();
      note.type = 'sine'; note.frequency.value = hz;
      gain.gain.setValueAtTime(0, t + i * .11);
      gain.gain.linearRampToValueAtTime(full ? .09 : .045, t + i * .11 + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, t + i * .11 + .38);
      note.connect(gain); gain.connect(ctx.destination);
      note.onended = () => { note.disconnect(); gain.disconnect(); recordNotes = recordNotes.filter(n => n !== note); };
      recordNotes.push(note); note.start(t + i * .11); note.stop(t + i * .11 + .4);
    });
  } catch { /* 오디오를 쓸 수 없는 기기에서는 시각 효과만 */ }
}

export function createHud(track) {
  const route = new URLSearchParams(location.search);
  let firstReady = false, firstComplete = false;
  try { firstReady = localStorage.getItem('gimmick.firstRun') === 'ready'; firstComplete = !!localStorage.getItem('gimmick.firstComplete'); } catch {}
  const rookie = !route.has('tutorial') && !route.has('academy') && !firstComplete && (route.get('rookie') === '1' || firstReady);
  const rookieHint = rookie ? document.createElement('div') : null;
  if (rookieHint) { rookieHint.className = 'nr-hints'; rookieHint.hidden = true; rookieHint.setAttribute('aria-live', 'polite'); document.body.appendChild(rookieHint); }
  let rookieText = '';
  const rookieKey = (id) => gamepad.usingPad() && gamepad.get(id) != null ? gamepad.html(id) : touchWanted() ? ({ throttle: '▲ 가속', brake: '▼ 브레이크', respawn: '↺ 복귀' })[id] : keybinds.html(id, 1);
  function firstHints(s) {
    if (!rookieHint) return;
    if (firstComplete) { rookieHint.hidden = true; return; }
    const active = !document.getElementById('results')?.classList.contains('on');
    const show = active && (s.countdown || s.time < 24) && toastTimer <= 0 && bigTimer <= 0 && bannerTimer <= 0 && !document.querySelector('.mt-notice:not(.out)');
    rookieHint.hidden = !show;
    if (!show) return;
    const text = s.countdown ? '<b>불이 모두 꺼지면 출발!</b>지금은 가속에서 손을 떼고 기다려요.'
      : s.time < 10 ? '<b>첫 코너까지 천천히 익혀요</b>' + rookieKey('throttle') + ' 가속 · 핸들은 짧게 톡톡'
      : '<b>도로의 색이 브레이크 타이밍이에요</b>🟢 가속 · 🟡 가속 놓기 · 🔴 ' + rookieKey('brake') + ' 브레이크';
    if (text !== rookieText) { rookieHint.innerHTML = text; rookieText = text; }
  }

  const el = {
    lap: $('lap'), time: $('time'), best: $('best'), speed: $('speed'),
    driftFill: $('driftFill'), driftAng: $('driftAng'), driftWin: $('driftWin'), driftNeedle: $('driftNeedle'), big: $('bigText'), toast: $('toast'),
    results: $('results'), speedUnit: $('speedUnit'),
    gear: $('gear'), tach: $('tach'), tachFill: $('tachFill'), tachRed: $('tachRed'), tachGreen: $('tachGreen'),
    gearMode: $('gearMode'), tireState: $('tireState'), shiftPerfect: $('shiftPerfect'),
    modes: { normal: $('modeNormal'), accel: $('modeAccel'), boat: $('modeBoat'), fly: $('modeFly') }, sinkWarn: $('sinkWarn'),
  };
  let shiftPerfectTimer = 0;
  // 구간·고스트·레이스 순위 (raceSystem·sectors·ghost)
  el.sectorRow = $('sectorRow');
  el.ghostDelta = $('ghostDelta');
  el.raceBox = $('raceBox');
  el.racePos = $('racePos');
  el.raceGaps = $('raceGaps');
  el.tower = $('tower');
  el.lapSum = $('lapSum');
  const secBoxes = [...el.sectorRow.children].map((div) => ({ div, span: div.querySelector('span') }));
  let secOn = false, ghostOn = false, raceOn = false, lastPos = 0, lapSumTimer = 0;
  // 2라운드: 배너(남은 바퀴·최고 랩), 순위 변화, 슬립스트림, 출발 그리드 소개
  el.banner = $('banner');
  el.posFlash = $('posFlash');
  el.draft = $('draftBox');
  el.draftLines = $('draftLines');
  el.intro = $('introBox');
  let bannerTimer = 0, draftShown = -1, introKey = '';
  const escH = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // 속도 단위 (설정): km/h 또는 mph
  let unit = 'kmh';
  const KMH_TO_MPH = 0.621371;
  const spd = (kmh) => (unit === 'mph' ? kmh * KMH_TO_MPH : kmh);
  const unitName = () => (unit === 'mph' ? 'mph' : 'km/h');
  let bigTimer = 0, toastTimer = 0, shakeAmt = 0, persistentToast = '';
  const booster = { el: $('boosterBtn'), fill: $('boosterBtn').querySelector('.fill') };
  el.flightInfo = $('flightInfo');

  // 미니맵 준비
  const mm = $('minimap');
  const g = mm.getContext('2d');
  const xs = track.outline.map((p) => p[0]), zs = track.outline.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const pad = 16;
  const scale = Math.min((mm.width - pad * 2) / (maxX - minX), (mm.height - pad * 2) / (maxZ - minZ));
  // 화면에서 보는 방향과 맞추기 위해 x는 뒤집음 (카메라 기준 오른쪽 = -x 쪽)
  const toMap = (x, z) => [mm.width - pad - (x - minX) * scale - ((mm.width - pad * 2) - (maxX - minX) * scale) / 2,
    mm.height - pad - (z - minZ) * scale - ((mm.height - pad * 2) - (maxZ - minZ) * scale) / 2];

  // 렉 줄이기 2: 코스 그림(바뀌지 않음)은 한 번만 그려 두고 매 화면은 그 그림 + 차 점만 그림
  //   (예전엔 매 화면 코스 점 수백 개를 다시 계산하고 선 4번을 새로 그렸음). 크기가 바뀌면 다시 그림
  let trackLayer = null;
  function drawMinimap(pos, yaw, others) {
    if (!trackLayer || trackLayer.width !== mm.width || trackLayer.height !== mm.height) {
      trackLayer = document.createElement('canvas');
      trackLayer.width = mm.width;
      trackLayer.height = mm.height;
      drawTrackLayer(trackLayer.getContext('2d'));
    }
    g.clearRect(0, 0, mm.width, mm.height);
    g.drawImage(trackLayer, 0, 0);
    drawCars(pos, yaw, others);
  }
  function drawTrackLayer(g) {
    g.lineJoin = 'round';
    g.beginPath();
    track.outline.forEach(([x, z], i) => {
      const [u, v] = toMap(x, z);
      i ? g.lineTo(u, v) : g.moveTo(u, v);
    });
    g.closePath();
    if (track.pad) {
      // 테스트 맵 시험장 바닥
      const [a, b] = toMap(track.pad.x0, track.pad.z0), [c, d] = toMap(track.pad.x1, track.pad.z1);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
    }
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 9;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    g.stroke();
    // 다른 차원 구간 (정글 지하 세계 등, track.minimapParts가 있을 때만): 본 코스 위에 겹쳐 보이지 않게 어둡게 지우고 색 점선으로
    if (track.minimapParts)
      for (const part of track.minimapParts) {
        if (!part.pts || part.pts.length < 2) continue;
        g.beginPath();
        part.pts.forEach(([x, z], i) => {
          const [a, b] = toMap(x, z);
          i ? g.lineTo(a, b) : g.moveTo(a, b);
        });
        g.setLineDash([]);
        g.strokeStyle = 'rgba(8,10,18,0.85)';
        g.lineWidth = 6;
        g.stroke();
        g.setLineDash(part.dash || [5, 4]);
        g.strokeStyle = part.color || '#b98cff';
        g.lineWidth = 4;
        g.stroke();
        g.setLineDash([]);
      }
  }
  function drawCars(pos, yaw, others) {
    // 상대 차 (봇·온라인): 차 색 점
    if (others)
      for (const o of others) {
        const [a, b] = toMap(o.x, o.z);
        g.fillStyle = '#0009';
        g.beginPath();
        g.arc(a, b, 4.2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = o.color || '#4fc3ff';
        g.beginPath();
        g.arc(a, b, 3.2, 0, Math.PI * 2);
        g.fill();
      }
    const [u, v] = toMap(pos.x, pos.z);
    g.save();
    g.translate(u, v);
    g.rotate(Math.PI - yaw); // 맵 좌표계에 맞춘 회전 (위쪽 = +z)
    g.fillStyle = '#ff4b3a';
    g.beginPath();
    g.moveTo(0, 7);
    g.lineTo(5, -5);
    g.lineTo(-5, -5);
    g.closePath();
    g.fill();
    g.restore();
  }

  return {
    update(s) {
      firstHints(s);
      el.lap.textContent = s.label || `LAP ${s.lap}/${s.laps}`;
      el.time.textContent = fmtTime(s.time);
      // 내 최고 기록 = 완주 시간 (여러 바퀴면 합). 아직 없으면 이번 레이스 최고 랩
      const bestTxt = s.record ? `최고 기록 ${fmtTime(s.record)}${s.recordNote ? ` · ${s.recordNote}` : ''}` : `최고 랩 ${fmtTime(s.best)}`;
      if (bestTxt !== el.best._t) el.best.textContent = el.best._t = bestTxt;
      el.speed.textContent = Math.round(spd(s.speed));
      // 속도감: 200 km/h 넘으면 숫자가 따뜻하게 빛나고, 부스터 중에는 초록빛
      const fastNow = s.speed >= 200;
      if (fastNow !== el.speed._fast) el.speed.classList.toggle('fast', (el.speed._fast = fastNow));
      const boostNow = s.form === 'spike';
      if (boostNow !== el.speed._boost) el.speed.classList.toggle('boost', (el.speed._boost = boostNow));

      const d = s.cfg.drift;
      const pct = s.drifting ? Math.min(1, s.driftTime / d.level2Time) : 0;
      el.driftFill.style.width = `${pct * 100}%`;
      el.driftFill.style.background = ['#ffffff', 'var(--blue)', 'var(--orange)'][s.driftLevel];
      // 드리프트 각도 막대: 초록 칸 = 버티면 좋은 각도 (car.cfg.drift.holdAngle), 바늘 = 지금 각도. 드리프트 중에만 보임
      if (el.driftAng) {
        const on = !!s.drifting;
        if (on !== el.driftAng._on) el.driftAng.classList.toggle('on', (el.driftAng._on = on));
        if (on) {
          const win = d.holdAngle || [0.28, 0.75], MAXA = 1.1; // 막대 끝 = 1.1 rad (약 63°)
          const px = (a) => Math.max(0, Math.min(1, a / MAXA)) * 100;
          if (el.driftWin._w !== win) {
            el.driftWin._w = win;
            el.driftWin.style.left = `${px(win[0])}%`;
            el.driftWin.style.width = `${px(win[1]) - px(win[0])}%`;
          }
          const a = s.driftAngle || 0, inWin = a >= win[0] && a <= win[1];
          el.driftNeedle.style.left = `${px(a)}%`;
          el.driftNeedle.className = inWin ? 'in' : a > win[1] ? 'over' : '';
        }
      }

      // 회전수계: 0 ~ 한계 회전수. 빨간 구간 = 레드라인 이상, 초록 = 출발 구간(카운트다운 중)
      const e = s.cfg.engine;
      const top = e.limiter + 500;
      el.tachFill.style.width = `${Math.min(1, s.rpm / top) * 100}%`;
      el.tachRed.style.width = `${(1 - e.redline / top) * 100}%`;
      el.tachGreen.style.display = 'none'; // 예전 회전수 맞추기 출발 구간 (F1식 출발로 바뀌어 안 씀)
      el.tachGreen.style.left = `${((e.launchWindow[0] * e.redline) / top) * 100}%`;
      el.tachGreen.style.width = `${(((e.launchWindow[1] - e.launchWindow[0]) * e.redline) / top) * 100}%`;
      el.tach.classList.toggle('shiftNow', s.manual && s.gear >= 1 && s.gear < s.cfg.gears.length && s.rpm >= e.redline * e.perfectShift);
      el.tach.classList.toggle('limiter', s.limiter);
      el.gear.textContent = s.gear < 1 ? 'R' : String(s.gear);
      el.gear.classList.toggle('shifting', s.shifting);
      el.gearMode.textContent = s.manual ? `수동 · ${keybinds.label('shiftUp')}↑ ${keybinds.label('shiftDown')}↓` : `자동 · ${keybinds.label('gearbox')}`;
      // 주행 모드 표시, 가라앉는 중 경고
      for (const [name, box] of Object.entries(el.modes)) box.classList.toggle('on', (s.mode || 'normal') === name);
      el.sinkWarn.style.opacity = s.sink > 0 ? Math.min(1, 0.4 + s.sink).toFixed(2) : 0;
      // 타이어 상태: 가장 심한 것 하나만
      const tire = s.wheelspin > 0.3 ? ['휠스핀', '#ff9a2e'] : s.sliding > 0.25 ? ['미끄러짐!', '#ff4b3a'] : s.understeer > 0.6 ? ['언더스티어', '#ffcf3f'] : ['', ''];
      el.tireState.textContent = tire[0];
      el.tireState.style.color = tire[1];
      if (shiftPerfectTimer > 0) {
        shiftPerfectTimer -= 1 / 60;
        if (shiftPerfectTimer <= 0) el.shiftPerfect.style.opacity = 0;
      }

      if (bigTimer > 0) {
        bigTimer -= 1 / 60;
        if (bigTimer <= 0) el.big.textContent = '';
      }
      if (lapSumTimer > 0) {
        lapSumTimer -= 1 / 60;
        if (lapSumTimer <= 0) el.lapSum.style.opacity = 0;
      }
      if (toastTimer > 0) {
        toastTimer -= 1 / 60;
        if (toastTimer <= 0) el.toast.style.opacity = 0;
      }
      const warn = s.wrongWay ? '역주행 중!' : '';
      if (warn !== persistentToast) {
        persistentToast = warn;
        if (warn) {
          el.toast.textContent = warn;
          el.toast.style.opacity = 1;
          toastTimer = 0;
        } else if (toastTimer <= 0) el.toast.style.opacity = 0;
      }
      drawMinimap(s.carPos, s.carYaw, s.others);
      // 슬립스트림·견인 칩(#draftBox·#towBox)과 바람 줄(#draftLines)은 2026-11-12부터 src/slipFx.js가 그림 (raceSystem.update)
      if (bannerTimer > 0) {
        bannerTimer -= 1 / 60;
        if (bannerTimer <= 0) el.banner.classList.remove('on');
      }
      // 구간 기록 칸 (S1 S2 S3)
      if (s.sectors !== undefined) {
        const on = !!s.sectors;
        if (on !== secOn) el.sectorRow.classList.toggle('on', (secOn = on));
        if (on)
          s.sectors.forEach((c, i) => {
            const box = secBoxes[i];
            const txt = c.time == null ? '-' : c.color === 'live' ? c.time.toFixed(1) : c.time.toFixed(3);
            if (box._t !== txt) box.span.textContent = box._t = txt;
            if (box._c !== c.color) {
              box.div.className = 'sec ' + c.color + (c.color !== 'live' && c.color !== 'none' ? ' flash' : '');
              box._c = c.color;
            }
          });
      }
      // 고스트와 시간 차이
      const gd = s.ghostDelta;
      const gOn = gd != null && isFinite(gd);
      if (gOn !== ghostOn) el.ghostDelta.classList.toggle('on', (ghostOn = gOn));
      if (gOn) {
        const txt = `<small>👻 ${s.ghostLabel || '고스트'}</small>${gd < 0 ? '−' : '+'}${Math.abs(gd).toFixed(2)}`;
        if (txt !== el.ghostDelta._t) {
          el.ghostDelta.innerHTML = el.ghostDelta._t = txt;
          el.ghostDelta.style.color = gd < 0 ? '#7dff6a' : '#ff8a7e';
        }
      }

      // 부스터: 사용 중이면 남은 시간
      const on = s.form === 'spike';
      booster.el.classList.toggle('active', on);
      booster.fill.style.width = `${on ? Math.max(0, s.formTime / s.cfg.booster.duration) * 100 : 0}%`;
      // 비행 정보: 날고 있을 때 높이와 실속 경고
      if (s.mode === 'fly') {
        el.flightInfo.style.display = 'block';
        el.flightInfo.textContent = s.flying
          ? `✈️ 높이 ${Math.max(0, s.altitude).toFixed(0)}m${s.speed / 3.6 < s.cfg.modes.fly.minSpeed ? ` · ⚠️ 실속! ${keybinds.label('dive')}로 기수를 내려요` : ''}`
          : s.speed / 3.6 >= s.cfg.modes.fly.takeoffSpeed ? `🛫 ${keybinds.label('climb')}를 누르면 이륙!` : `이륙 속도 ${spd(s.cfg.modes.fly.takeoffSpeed * 3.6).toFixed(0)} ${unitName()}까지 가속`;
      } else el.flightInfo.style.display = 'none';
    },
    /**
     * 레이스 순위 패널 (raceSystem.hudInfo). null이면 숨김
     * info = { pos, total, ahead: { name, gap }, behind: { name, gap }, tower: [{ pos, name, color, gap, isPlayer, finished }] }
     */
    race(info) {
      const on = !!info;
      if (on !== raceOn) el.raceBox.classList.toggle('on', (raceOn = on));
      if (!on) return;
      el.racePos.innerHTML = `P${info.pos}<small>/${info.total}</small>`;
      if (lastPos && info.pos !== lastPos) {
        el.racePos.classList.remove('up', 'down');
        void el.racePos.offsetWidth;
        el.racePos.classList.add(info.pos < lastPos ? 'up' : 'down');
        // 순위가 바뀌면 옆에 ▲2 / ▼1 이 잠깐 떴다 사라짐
        if (el.posFlash && !info.quiet) {
          const d = lastPos - info.pos;
          el.posFlash.textContent = d > 0 ? `▲${d}` : `▼${-d}`;
          el.posFlash.className = d > 0 ? 'up' : 'down';
          void el.posFlash.offsetWidth;
          el.posFlash.classList.add('go');
        }
      }
      lastPos = info.pos;
      const g = (x) => (!x ? '' : x.laps ? `${x.laps}랩` : `${Math.max(0, x.sec).toFixed(1)}초`);
      el.raceGaps.innerHTML =
        (info.ahead ? `<div class="a">▲ ${escH(info.ahead.name)}${info.ahead.gap ? ` ${g(info.ahead.gap)} 앞` : ''}</div>` : '<div class="a">🏁 선두!</div>') +
        (info.behind ? `<div class="b">▼ ${escH(info.behind.name)}${info.behind.gap ? ` ${g(info.behind.gap)} 뒤` : ''}</div>` : '');
      el.tower.innerHTML = info.tower
        .map((r) => `<div class="tw${r.isPlayer ? ' me' : ''}${r.finished ? ' done' : ''}"><b>${r.pos}</b><i style="background:${escH(r.color)}"></i><span>${escH(r.name)}${r.remote ? ' 🌐' : ''}</span><em>${escH(r.gap)}</em></div>`)
        .join('');
    },
    /** 화면 위 띠 알림: 남은 바퀴·마지막 바퀴·최고 랩 (kind = 'final' | 'laps' | 'fastest' | 'champ') */
    banner(text, sub = '', kind = 'laps', seconds = 2.4) {
      if (!el.banner) return;
      el.banner.innerHTML = `<b>${escH(text)}</b>${sub ? `<span>${escH(sub)}</span>` : ''}`;
      el.banner.className = 'hud ' + kind;
      void el.banner.offsetWidth;
      el.banner.classList.add('on');
      bannerTimer = seconds;
    },
    /**
     * 출발 그리드 소개 (카메라가 그리드를 훑는 동안). null이면 숨김
     * info = { title, sub, card: { pos, name, carName, color, isPlayer }, hint }
     */
    intro(info) {
      if (!el.intro) return;
      if (!info) {
        if (introKey) el.intro.classList.remove('on');
        introKey = '';
        return;
      }
      const c = info.card;
      const key = info.title + '|' + (c ? c.pos + c.name : '');
      if (key === introKey) return;
      introKey = key;
      el.intro.innerHTML = `<div class="it"><b>${escH(info.title)}</b><span>${escH(info.sub || '')}</span></div>${
        c
          ? `<div class="ic${c.isPlayer ? ' me' : ''}" style="--c:${escH(c.color)}"><em>P${c.pos}</em><div><b>${escH(c.name)}${c.isPlayer ? ' (나)' : ''}</b><small>${escH(c.carName || '')}</small></div></div>`
          : ''
      }<div class="ih">${escH(info.hint || '')}</div>`;
      el.intro.classList.add('on');
    },
    /** 바퀴 끝 요약: LAP 2 1:05.123 + 구간 색 칸 */
    lapSummary(lapNum, lapTime, splits) {
      if (!splits) return;
      el.lapSum.innerHTML =
        `<span>LAP ${lapNum} ${fmtTime(lapTime)}</span>` +
        splits.map((sp, i) => (sp ? `<span class="sx ${sp.color}">S${i + 1} ${sp.time.toFixed(2)}</span>` : `<span class="sx">S${i + 1} -</span>`)).join('');
      el.lapSum.style.opacity = 1;
      lapSumTimer = 3.2;
    },
    /** 모드가 바뀔 때 아래 모드 버튼이 살짝 커졌다 돌아옴 */
    modePulse(mode) {
      const box = el.modes[mode];
      if (!box) return;
      box.classList.remove('pulse');
      void box.offsetWidth;
      box.classList.add('pulse');
    },
    /** 출발 신호등: n = 켜진 빨간불 개수 (0~5), -1이면 숨김 */
    startLights(n) {
      const box = $('startLights');
      if (!box) return;
      box.style.display = n < 0 ? 'none' : 'flex';
      if (n < 0) return;
      [...box.children].forEach((d, i) => d.classList.toggle('on', i < n));
    },
    big(text, seconds = 0) {
      el.big.textContent = text;
      bigTimer = seconds;
    },
    toast(text) {
      el.toast.textContent = text;
      el.toast.style.opacity = 1;
      toastTimer = 1.8;
    },
    /** 화면 가장자리가 색으로 번쩍임 (변신 순간 등) */
    flash(color = '#ffffff', seconds = 0.6) {
      const f = $('flash');
      f.style.setProperty('--flash', color);
      f.style.transition = 'none';
      f.style.opacity = 1;
      void f.offsetWidth; // 다시 그리기 강제
      f.style.transition = `opacity ${seconds}s ease-out`;
      f.style.opacity = 0;
    },
    /** 완벽한 변속 표시 */
    shiftFlash() {
      el.shiftPerfect.style.opacity = 1;
      shiftPerfectTimer = 0.8;
    },
    shake(amount) {
      shakeAmt = Math.max(shakeAmt, amount);
    },
    shakeCamera(camera, dt) {
      if (shakeAmt <= 0.001) return;
      camera.position.x += (Math.random() - 0.5) * shakeAmt;
      camera.position.y += (Math.random() - 0.5) * shakeAmt;
      shakeAmt *= Math.exp(-8 * dt);
    },
    /** 속도 단위 바꾸기 ('kmh' | 'mph') */
    setUnit(u) {
      unit = u === 'mph' ? 'mph' : 'kmh';
      if (el.speedUnit) el.speedUnit.textContent = unitName();
    },
    /** 결과 화면의 온라인 순위표 한 줄 (html, 빈 문자열이면 숨김) */
    setOnline(html) {
      const o = el.results.querySelector('[data-online]');
      if (o) {
        o.innerHTML = html || '';
        o.style.display = html ? '' : 'none';
      }
    },
    /**
     * 완주 결과 화면
     * info = { map, car, newLap, newRace, prevRace, hasNext, onAction(name) }  (name: restart | next (챔피언십) | replay | home | car)
     */
    showResults(lapTimes, best, info = {}) {
      if (rookieHint) rookieHint.hidden = true;
      let firstNext = '';
      if (rookie && !firstComplete) {
        firstComplete = true;
        try { localStorage.setItem('gimmick.firstComplete', '1'); localStorage.setItem('gimmick.firstRun', 'done'); } catch {}
        firstNext = '<div class="nr-next"><b>첫 완주, 해냈어요!</b><p>다음 도전은 아래 <strong>차·맵 바꾸기</strong>에서 골라요. 물 위를 달리는 바닷가 코스도 있어요.</p></div>';
      }
      const nextBtn = (o) => '<button class="gm-btn primary next" data-res="next">' + escH(o.nextLabel || '다음 경기') + '</button>';
      const total = lapTimes.reduce((a, b) => a + b, 0);
      const esc = (x) => String(x ?? '').replace(/</g, '&lt;');
      const badges = [];
      const canCompare = !route.has('room') && route.get('mode') !== 'item' && !(info.standings?.length > 1);
      const modeName = route.has('room') ? (route.get('mode') === 'item' ? '온라인 아이템전' : '온라인 레이스') : info.champ ? '챔피언십' : route.get('mode') === 'item' ? '아이템전' : route.get('mode') === 'time' ? '타임 어택' : info.standings?.length > 1 ? '봇 레이스' : '혼자 달리기';
      // 최고 기록 = 완주 시간 (여러 바퀴면 모든 바퀴 합)으로 판단 (사용자 요청 2026-11-10)
      const diff = info.prevRace ? total - info.prevRace : 0;
      const diffTxt = `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(3)}초`;
      if (canCompare && info.newRace) badges.push('<span class="badge record-chip">🏆 새 최고 기록!</span>');
      const pn = info.prevNote ? ` · ${esc(info.prevNote)}` : ''; // 다른 차로 낸 기록이면 그 차 이름
      if (canCompare && info.newRace && info.prevRace) badges.push(`<span class="badge gray">이전 ${fmtTime(info.prevRace)}${pn} → <strong class="record-delta">${diffTxt}</strong></span>`);
      if (canCompare && !info.newRace && info.prevRace) badges.push(`<span class="badge gray">최고 기록 ${fmtTime(info.prevRace)}${pn} (${diffTxt})</span>`);
      if (canCompare && info.carRecord) badges.push('<span class="badge">🏎️ 이 차 최고 기록!</span>');
      if (canCompare && info.newLap && lapTimes.length > 1) badges.push('<span class="badge gray">⚡ 최고 랩 갱신</span>');
      else if (canCompare && info.newLap && !info.newRace) badges.push('<span class="badge">⚡ 새 최고 랩!</span>');
      if (info.assist) badges.push('<span class="badge gray" title="브레이크·조향 도움을 켜거나 견인(뒤처지면 끌어당겨 줌)을 받고 달린 기록">🛟 도움 켬</span>');
      // 레이스(봇·온라인): 순위 결과표, 구간 기록표
      const SC = { purple: '#c98bff', green: '#5cff8a', yellow: '#ffd23a' };
      const standHtml = info.standings && info.standings.length > 1 ? `<table class="stand">${standRows(info.standings)}</table>` : '';
      // 랩·섹터를 한 표로 묶고 긴 경주만 펼쳐 보기.
      const hasSectors = !!info.sectorLaps?.length;
      const lapRow = (t, i) => '<tr class="' + (t === best ? 'best' : '') + '"><td>L' + (i + 1) + (t === best ? ' ★' : '') + '</td><td>' + fmtTime(t) + '</td>' + (hasSectors ? [0,1,2].map(k => { const sp = info.sectorLaps[i]?.[k]; return '<td style="color:' + (SC[sp?.color] || '#bccbdf') + '">' + (sp ? sp.time.toFixed(3) : '—') + '</td>'; }).join('') : '') + '</tr>';
      const tableHead = '<tr class="hd"><td>랩</td><td>시간</td>' + (hasSectors ? '<td>S1</td><td>S2</td><td>S3</td>' : '') + '</tr>';
      const lapHtml = '<table class="laps res-times">' + tableHead + lapTimes.slice(0,4).map(lapRow).join('') + '</table>' + (lapTimes.length > 4 ? '<details class="res-detail"><summary>전체 ' + lapTimes.length + '바퀴 보기</summary><table class="res-times">' + tableHead + lapTimes.slice(4).map((t,i) => lapRow(t,i+4)).join('') + '</table></details>' : '') + (info.theoretical ? '<div class="res-theory">이론상 최고 랩 <b>' + fmtTime(info.theoretical) + '</b></div>' : '');
      const ch = info.champ;
      // 순위는 아래 순위표와 같은 standings에서 (온라인: 먼저 들어온 상대가 늦게 알려져도 표·제목·시상대가 같게)
      const myRow = info.standings && info.standings.find((r) => r.isPlayer);
      if (myRow && myRow.pos) info.position = myRow.pos;
      el.results._pos = info.position;
      el.results._seasonFinal = !!(ch && ch.final);
      let title = info.position ? (info.position === 1 ? '우승!' : `${info.position}위`) : '완주!';
      if (ch && ch.final) title = ch.table[0] && ch.table[0].isPlayer ? '시즌 챔피언!' : `시즌 ${(ch.table.find((r) => r.isPlayer) || {}).pos || '-'}위`;
      // 시상대: 시즌이 끝났으면 시즌 순위, 아니면 이번 경기 순위
      const podRows = ch && ch.final
        ? ch.table.slice(0, 3).map((r) => ({ ...r, sub: `${r.points}점` }))
        : info.standings && info.standings.length > 2
          ? info.standings.slice(0, 3)
          : null;
      const champMe = ch?.table.find(r => r.isPlayer);
      const champBlock = ch ? '<details class="res-detail res-champ"><summary>🏆 시즌 ' + (champMe?.pos || '—') + '위 · ' + (champMe?.points || 0) + '점' + (ch.final ? ' · 최종' : ' · ' + ch.no + '/' + ch.total + '경기') + '</summary>' + champHtml(ch) + '</details>' : '';
      el.results.innerHTML = `<div class="res res-dashboard${standHtml || ch ? ' wide has-rivals' : ''}${ch && ch.final ? ' final' : ''}${info.newRace ? ' new-record' : info.newLap ? ' new-lap' : ''}">
        <div class="res-head">
        <div class="res-identity"><div class="res-title"><span class="flag">${info.position === 1 || (ch && ch.final) ? '🏆' : '🏁'}</span><h2>${title}</h2></div><div class="who">${esc(info.map || '')}${info.car ? ' · ' + esc(info.car) : ''} · ${modeName}${academy.top() ? licenseChip(academy.top(), 20) : ''}</div></div>
        <div class="res-clock"><small>완주 시간</small><div class="total">${fmtTime(total)}</div></div>
        <div class="badges">${badges.join('')}</div>
        <div class="online" data-online></div>
        </div>
        <div class="res-scroll">
        <div class="res-grid">
          <section class="res-panel res-records"><h3>주행 기록 <small>${lapTimes.length} LAP</small></h3>${lapHtml}${firstNext || cornerHtml(info.corners)}</section>
          ${info.meta ? '<section class="res-panel res-rewards"><h3>경험치 · 보상</h3>' + metaResultsHtml(info.meta) + '</section>' : ''}
          ${standHtml || ch ? '<section class="res-panel res-rank"><h3>레이스 결과' + (info.position ? '<small>' + info.position + '위 / ' + (info.standings?.length || '') + '</small>' : '') + '</h3>' + (podRows ? podiumHtml(podRows, ch?.final ? 'season' : '') : '') + standHtml + champBlock + '</section>' : ''}
        </div>
        </div>
        <div class="btns">
          <div class="ra-main">
            ${info.noRestart ? '' : '<button class="gm-btn primary" data-res="restart"><span class="ic">↻</span>다시 하기 <kbd>Enter</kbd></button>'}
            ${ch && (info.hasNext || ch.final) ? nextBtn(info) : ''}
          </div>
          <div class="ra-sub">
            ${info.replay ? '<button class="gm-btn sub" data-res="replay"><span class="ic">▶</span>리플레이</button>' : ''}
            <button class="gm-btn sub" data-res="car"><span class="ic">🚗</span>차·맵 바꾸기</button>
            <button class="gm-btn sub" data-res="home"><span class="ic">🏠</span>홈으로</button>
          </div>
        </div></div>`;
      el.results.querySelectorAll('[data-res]').forEach((b) =>
        b.addEventListener('click', (ev) => {
          ev.preventDefault();
          b.blur();
          info.onAction && info.onAction(b.dataset.res);
        }),
      );
      el.results.classList.add('on');
      // 완주 보상은 결과 표에서 합계를 보여 줌. 별도의 XP·업적 알림은 겹치지 않게 정리.
      document.getElementById('xpPill')?.remove();
      window.dispatchEvent(new CustomEvent('gimmick:resultsOpen'));
      if (info.meta && !info.newRace && !info.newLap && !reducedResultsMotion()) {
        playMetaCelebration(el.results.querySelector('.res'), info.meta.celebration);
      }
      if (info.newRace || info.newLap) recordCelebration(el.results.querySelector('.res'), !!info.newRace);
      else if (!reducedResultsMotion() && (!info.meta?.celebration || info.meta.celebration.id === 'stock') && (info.position === 1 || (ch?.final && ch.table[0]?.isPlayer))) confetti(el.results.querySelector('.res'), ch?.final ? 60 : 36);
      // 결과 화면 위에 남은 안내 글자는 지움
      el.toast.style.opacity = 0;
      toastTimer = 0;
      el.big.textContent = '';
    },
    /** 결과표의 순위 부분만 다시 (봇이 계속 들어오는 중) */
    updateStandings(rows) {
      const t = el.results.querySelector('table.stand');
      if (t && rows) t.innerHTML = standRows(rows);
      const positionNote = el.results.querySelector('.res-rank h3 > small');
      const playerRow = rows?.find(r => r.isPlayer);
      if (positionNote && playerRow) positionNote.textContent = playerRow.pos + '위 / ' + rows.length;
      // 내 순위가 바뀌었으면(온라인 상대의 완주가 늦게 도착) 제목·깃발·시상대도 같이 고침. 시즌 끝 화면은 시즌 순위라 그대로
      const me = rows && rows.find((r) => r.isPlayer);
      if (!me || !me.pos || me.pos === el.results._pos || el.results._seasonFinal) return;
      el.results._pos = me.pos;
      const h = el.results.querySelector('.res h2'), f = el.results.querySelector('.res .flag');
      if (h) h.textContent = me.pos === 1 ? '우승!' : `${me.pos}위`;
      if (f) f.textContent = me.pos === 1 ? '🏆' : '🏁';
      const pd = el.results.querySelector('.res .podium');
      if (pd && rows.length > 2) pd.outerHTML = podiumHtml(rows.slice(0, 3));
    },
    hideResults() {
      stopRecordSound();
      el.results.classList.remove('on');
      el.results.innerHTML = '';
    },
    get resultsOpen() {
      return el.results.classList.contains('on');
    },
  };
}
