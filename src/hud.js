// 화면 위 정보 표시 (랩, 시간, 속도, 드리프트 게이지, 미니맵, 안내 문구)
const $ = (id) => document.getElementById(id);

export function fmtTime(sec) {
  if (!isFinite(sec)) return '--:--.---';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function createHud(track) {
  const el = {
    lap: $('lap'), time: $('time'), best: $('best'), speed: $('speed'),
    driftFill: $('driftFill'), big: $('bigText'), toast: $('toast'),
    results: $('results'), speedUnit: $('speedUnit'),
    gear: $('gear'), tach: $('tach'), tachFill: $('tachFill'), tachRed: $('tachRed'), tachGreen: $('tachGreen'),
    gearMode: $('gearMode'), tireState: $('tireState'), shiftPerfect: $('shiftPerfect'),
    modes: { normal: $('modeNormal'), accel: $('modeAccel'), boat: $('modeBoat'), fly: $('modeFly') }, sinkWarn: $('sinkWarn'),
  };
  let shiftPerfectTimer = 0;
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

  function drawMinimap(pos, yaw) {
    g.clearRect(0, 0, mm.width, mm.height);
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
      el.lap.textContent = s.label || `LAP ${s.lap}/${s.laps}`;
      el.time.textContent = fmtTime(s.time);
      el.best.textContent = `최고 랩 ${fmtTime(s.best)}`;
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
      el.gearMode.textContent = s.manual ? '수동 · X↑ Z↓' : '자동 · T';
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
      drawMinimap(s.carPos, s.carYaw);

      // 부스터: 사용 중이면 남은 시간
      const on = s.form === 'spike';
      booster.el.classList.toggle('active', on);
      booster.fill.style.width = `${on ? Math.max(0, s.formTime / s.cfg.booster.duration) * 100 : 0}%`;
      // 비행 정보: 날고 있을 때 높이와 실속 경고
      if (s.mode === 'fly') {
        el.flightInfo.style.display = 'block';
        el.flightInfo.textContent = s.flying
          ? `✈️ 높이 ${Math.max(0, s.altitude).toFixed(0)}m${s.speed / 3.6 < s.cfg.modes.fly.minSpeed ? ' · ⚠️ 실속! Shift로 기수를 내려요' : ''}`
          : s.speed / 3.6 >= s.cfg.modes.fly.takeoffSpeed ? '🛫 Space를 누르면 이륙!' : `이륙 속도 ${spd(s.cfg.modes.fly.takeoffSpeed * 3.6).toFixed(0)} ${unitName()}까지 가속`;
      } else el.flightInfo.style.display = 'none';
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
    /**
     * 완주 결과 화면
     * info = { map, car, newLap, newRace, prevRace, hasNext, onAction(name) }  (name: restart | next | home | car)
     */
    showResults(lapTimes, best, info = {}) {
      const total = lapTimes.reduce((a, b) => a + b, 0);
      const esc = (x) => String(x ?? '').replace(/</g, '&lt;');
      const badges = [];
      if (info.newRace) badges.push('<span class="badge">🏆 새 완주 기록!</span>');
      if (info.newLap) badges.push('<span class="badge">⚡ 새 최고 랩!</span>');
      if (!info.newRace && info.prevRace) badges.push(`<span class="badge gray">내 기록 ${fmtTime(info.prevRace)} (${total - info.prevRace >= 0 ? '+' : '−'}${Math.abs(total - info.prevRace).toFixed(3)}초)</span>`);
      el.results.innerHTML = `<div class="res">
        <div class="flag">🏁</div><h2>완주!</h2>
        <div class="who">${esc(info.map || '')}${info.car ? ' · ' + esc(info.car) : ''}</div>
        <div class="total">${fmtTime(total)}</div>
        <div>${badges.join('')}</div>
        <table>${lapTimes.map((t, i) => `<tr class="${t === best ? 'best' : ''}"><td>LAP ${i + 1}${t === best ? ' ⭐' : ''}</td><td>${fmtTime(t)}</td></tr>`).join('')}</table>
        <div class="btns">
          <button class="gm-btn primary" data-res="restart">다시 하기 <kbd>Enter</kbd></button>
          ${info.hasNext ? '<button class="gm-btn" data-res="next">다음 맵 ›</button>' : ''}
          <button class="gm-btn" data-res="car">차·맵 바꾸기</button>
          <button class="gm-btn" data-res="home">홈으로</button>
        </div></div>`;
      el.results.querySelectorAll('[data-res]').forEach((b) =>
        b.addEventListener('click', (ev) => {
          ev.preventDefault();
          b.blur();
          info.onAction && info.onAction(b.dataset.res);
        }),
      );
      el.results.classList.add('on');
      // 결과 화면 위에 남은 안내 글자는 지움
      el.toast.style.opacity = 0;
      toastTimer = 0;
      el.big.textContent = '';
    },
    hideResults() {
      el.results.classList.remove('on');
      el.results.innerHTML = '';
    },
    get resultsOpen() {
      return el.results.classList.contains('on');
    },
  };
}
