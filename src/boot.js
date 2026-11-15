// launchqa3: 첫 방문은 필요한 화면만 받고, 재방문 업데이트 때만 옛 캐시를 갱신해요.
const status = document.getElementById('ldStatus');
const progress = document.getElementById('ldProgress');
const title = document.getElementById('ldMap');
const home = !new URLSearchParams(location.search).get('map');
// wheelfx: 앞 화면이 바퀴를 굴려 넣으며 넘겨준 제목이 있으면 그대로 둠 (index.html 인라인 바퀴 엔진이 채움)
if (title && !document.getElementById('loading')?.hasAttribute('data-wf-title')) title.textContent = home ? '트랜스폼 레이서에 오신 걸 환영해요' : '첫 레이스를 준비해요';
let downloading = true, count = 0, lastProgressAt = 0;
const say = text => { if (status) status.textContent = text; };
say('기본 파일 불러오기');
// 퍼센트를 추측하지 않고 실제 도착한 파일 수를 알려 줘요.
const observer = typeof PerformanceObserver === 'function' ? new PerformanceObserver(list => {
  count += list.getEntries().length;
  if (downloading && performance.now()-lastProgressAt>400 && status?.textContent.startsWith('기본 파일')) {
    lastProgressAt=performance.now();
    say('기본 파일 · ' + count + '개 도착');
  }
}) : null;
observer?.observe({ type: 'resource', buffered: true });
try {
  const localDev = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!localDev) {
    try {
      const r = await fetch('version.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const ver = await r.json();
        let old = null;
        try { old = localStorage.getItem('gimmick.ver'); } catch {}
        // 버전 기록이 없어도 예전에 놀았던 브라우저(gimmick.* 저장이 있음)는 옛 캐시가 남았을 수 있음 → 새로 받기
        let visited = !!old;
        if (!visited) try { for (let i = 0; i < localStorage.length; i++) if ((localStorage.key(i) || '').startsWith('gimmick.')) { visited = true; break; } } catch {}
        if (ver.v && visited && ver.v !== old) {
          let done = 0;
          // src/vendor/는 폴더 이름에 버전이 붙은 안 바뀌는 파일(three·PeerJS·글꼴) → 새 버전마다 다시 받지 않음
          const files = (ver.files || []).filter(f => !String(f).replace(/^\.\//, '').startsWith('src/vendor/'));
          say('새 버전 준비 중 · 0 / ' + files.length + '개');
          progress?.style.setProperty('--wheel-progress', 0);
          const loaded = await Promise.all(files.map(async f => {
            let ok = false;
            try { ok = (await fetch(f, { cache: 'reload', signal: AbortSignal.timeout(20000) })).ok; } catch {}
            done++;
            say('새 버전 준비 중 · ' + done + ' / ' + files.length + '개');
            progress?.style.setProperty('--wheel-progress', Math.round(done / Math.max(1, files.length) * 100));
            return ok;
          }));
          if (!loaded.every(Boolean)) throw new Error('업데이트 파일을 다 받지 못했어요.');
        }
        // 처음 방문한 브라우저에는 오래된 캐시가 없으므로 전체 미리 받기가 필요 없어요.
        if (ver.v) try { localStorage.setItem('gimmick.ver', ver.v); } catch {}
      }
    } catch (err) {
      // 버전 서버 연결 실패만으로 게임 입구를 막지 않아요. 다음 방문에 다시 확인해요.
      say('연결을 다시 확인하며 게임을 준비해요');
    }
  }
  // 갱신 진행 100%는 업데이트 파일만 뜻해요. 화면에 필요한 나머지는 별도 준비예요.
  progress?.style.setProperty('--wheel-progress', 12);
  say('기본 파일 · ' + count + '개 도착');
  if (home) {
    // 주행 물리·봇·다른 코스는 레이스를 시작할 때 main.js가 불러와요.
    await import('./audioMix.js');
    const { runHome } = await import('./home.js');
    downloading = false;
    say('차고와 코스 목록을 준비해요');
    await runHome();
    progress?.style.setProperty('--wheel-progress', 100);
  } else {
    await import('./main.js');
    downloading = false;
  }
} catch (err) {
  downloading = false;
  say('파일을 다 받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
  const retry = document.createElement('button');
  retry.className = 'gm-btn primary';
  retry.textContent = '다시 불러오기';
  retry.style.marginTop = '18px';
  retry.addEventListener('click', () => location.reload());
  status?.parentElement.appendChild(retry);
  const tip = document.getElementById('ldTip');
  if (tip) tip.textContent = '기록과 설정은 그대로예요. 잠시 뒤 다시 눌러 보세요.';
  console.error('게임 불러오기 실패', err);
} finally {
  observer?.disconnect();
}
