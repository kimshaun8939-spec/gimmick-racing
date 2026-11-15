// wheelfx (2026-11-15, 사용자 요청 "아주 큰 바퀴가 오른쪽에서 날아 들어와 애니메이션 → 준비되면 왼쪽으로 가면서 화면 전환"):
// 화면 전환 바퀴. 그림·움직임 엔진은 index.html 안 인라인 스크립트(window.__wf)라서 첫 화면부터 바로 보임. 이 모듈은 그 이름표.
//   go(url, {title, sub})  : 지금 화면 위로 바퀴가 굴러 들어와 다 덮으면 그 주소로 이동 (두 번 눌러도 한 번만). 새 페이지는 바퀴가 가운데에 있는 채로 시작
//   wheelOut({title, sub}) : 이동 없이 덮기만. 다 덮이면 풀리는 Promise → 그 뒤 할 일을 하고 받은 ctrl.ready()로 굴려 내보냄
//   ready()                : 이 페이지의 불러오는 바퀴(#loading)를 왼쪽으로 굴려 내보냄 (준비 끝). 아직 들어오는 중이면 다 들어온 뒤에
// 움직임 줄이기(기기 설정 또는 게임 설정 reducedMotion)면 짧은 페이드만(소리 없음).
// wheelfx2: 소리는 src/wheelSfx.js (부우웅·쉬익·쿵 통통 / 위이잉 / 끼익-휘익, audioMix 크기·끄기 그대로)
import './wheelSfx.js';
const W = () => (typeof window !== 'undefined' ? window.__wf : null);

export function go(url, opts = {}) {
  const w = W();
  if (!url) return false;
  if (!w) { location.href = url; return true; }
  const home = !new URL(url, location.href).searchParams.has('map');
  return w.go(url, { ...opts, sub: opts.sub === '트랜스폼 레이서' ? '' : opts.sub, status: opts.status || (home ? '홈으로 가는 중' : '레이스를 준비해요') });
}

export function wheelOut(opts = {}) {
  const w = W();
  if (!w) return Promise.resolve({ ready() {} });
  const c = w.cover(opts);
  return new Promise((res) => setTimeout(() => res(c), Math.max(0, c.endAt - performance.now())));
}

export function ready() {
  const w = W();
  if (w && w.main) w.main.ready();
  else {
    const l = typeof document !== 'undefined' && document.getElementById('loading');
    if (l) { l.classList.add('out'); setTimeout(() => l.remove(), 450); }
  }
}

/** 지금 화면이 바뀌는 중인가 (go를 이미 불렀나) */
export const busy = () => !!(W() && W().busy());
export const reducedMotion = () => !!(W() && W().RM);
