// 처음 방문한 코스에서 한 번만 읽는 출발 전 안내. 온라인/학습 진행은 막지 않아요.
import { confirmDialog, settings } from './settings.js';
import { touchWanted } from './touch.js';
import { keybinds } from './keybinds.js';
import { pad, padKbd } from './gamepad.js';

export const COURSE_TIPS = {
  glacier: ['넓은 고속 코스예요. 직선 끝 빨간 라인 전에 속도를 줄여요', '눈밭은 느리고 미끄러워요. 도로 안쪽으로 부드럽게 돌아와요'],
  sea: ['물에 닿으면 자동으로 배가 돼요. 가속을 유지하며 부표가 이어진 물길을 따라가요', '물에서 꺾으며 드리프트를 누르면 더 날카롭게 돌아요. 땅에 오르면 자동차로 돌아와요'],
  jungle: ['사원 포털을 지나면 용암 동굴로 이어져요. 놀라지 말고 도로와 화살표를 따라가요', '저중력 언덕에서는 차가 오래 떠요. 점프 전에 방향을 맞추고 용암과 길 끝을 피해요'],
  neon: ['자석 튜브에서는 벽과 천장에 붙어 달려요. 도로의 선을 따라 조향하면 돼요', '포털 뒤 저중력 구역에서는 차가 오래 떠요. 점프 전에 방향을 맞춰요'],
  mirage: ['모래폭풍에서는 청록 안내등과 도로 위 선을 따라가요. 길은 계속 이어져요', '옆바람 구간에서는 바람 반대쪽으로 조금 꺾어 중심을 잡아요'],
  foundry: ['민트색 ↑ 벨트는 가속, 노란색 ↓ 벨트는 감속해요', '회전 원판은 가운데로 지나가요. 옆으로 미는 벨트에서는 반대쪽으로 조금 꺾어요'],
  moon: ['저중력 구역에서는 차가 오래 떠요. 점프 전에 도로 가운데로 방향을 맞춰요', '자석 루프에서는 거꾸로 달려도 떨어지지 않아요. 선을 따라 계속 가속해요'],
  gp: ['포털은 우주 도로로 이어져요. 화살표와 레이싱 라인을 계속 따라가요', '활주로에서는 비행 모드가 돼요. 속도를 낸 뒤 상승을 눌러 이륙하고 고리를 따라 착륙해요'],
  volcano: ['가드레일 없는 좁은 길이 많아요. 코너 전에 감속하고 길 끝을 피해요', '빨간 고리는 화산탄이 떨어질 자리예요. 빈 쪽으로 피하고, 용암에 닿거나 추락하면 도로로 복귀해요'],
};

export function showCourseGuide({ map, title, mode, championship, params, onClose, onHome }) {
  const state = { open: false };
  if (params.has('room') || params.has('tutorial') || params.has('academy')) return state;
  // 테스트 주소(intro=0·guide=0)나 자동화 브라우저에선 안 띄움 → game.tick 테스트가 멈추지 않게. guide=1이면 강제로 보임
  if (params.get('guide') !== '1' && (params.get('guide') === '0' || params.get('intro') === '0' || navigator.webdriver)) return state;
  const key = 'gimmick.courseIntro.v1.' + map;
  try { if (localStorage.getItem(key)) return state; } catch {}
  const tips = COURSE_TIPS[map];
  if (!tips) return state;
  const touch = touchWanted();
  const usingPad = pad.connected() && !touch;
  const label = id => usingPad ? pad.label(id) : keybinds.label(id);
  const drive = usingPad
    ? '왼쪽 스틱 조향 · ' + label('throttle') + ' 가속 · ' + label('brake') + ' 브레이크 · ' + label('respawn') + ' 복귀'
    : touch
    ? (settings.get('tilt') ? '휴대폰을 좌우로 기울여 조향' : settings.get('touchSteer') === 'buttons' ? '왼쪽 ◀ ▶ 버튼으로 조향' : '왼쪽 화면을 옆으로 끌어 조향') + ' · 오른쪽 ▲ 가속 / ▼ 브레이크 · ↺ 복귀'
    : keybinds.label('throttle') + ' 가속 · ' + keybinds.label('brake') + ' 브레이크 · ' + keybinds.label('respawn') + ' 복귀';
  const fly = map === 'gp' ? (touch ? '\n비행: 💨 버튼이 ⬆ 상승으로 바뀌고 ⬇ 하강 버튼이 생겨요.' : '\n비행: ' + label('climb') + ' 상승 · ' + label('dive') + ' 하강') : '';
  const rules = mode === 'item'
    ? '\n🎁 상자를 지나 아이템 획득 → 화면 위 아이템 칸' + (touch ? '을 눌러 사용해요.' : '을 누르거나 ' + label('booster') + (usingPad ? ' 버튼으로 사용해요.' : ' 키로 사용해요.'))
    : championship ? '\n🏆 여러 코스의 순위 점수를 합쳐 챔피언을 정해요. 결과에서 다음 경기로 이어가요.'
    : mode === 'time' ? '\n⏱️ 고스트는 기록을 보여 주는 차예요. 부딪히지 않으며, 완주한 총 시간으로 경쟁해요.' : mode === 'race' && params.get('rookie') === '1' ? '\n💨 앞차 뒤에서는 바람 저항이 줄어요. 🧲 뒤처지면 자동 견인이 도와줘요. 직접 누를 버튼은 없어요.' : '';
  state.open = true;
  const answer = confirmDialog(title + ' · 처음 달리나요?', tips.map(t => '• ' + t).join('\n') + fly + rules + '\n\n' + drive + '\n빨간불 5개가 모두 꺼진 뒤 가속하세요. 지금은 출발 신호가 멈춰 있어요.', '확인하고 출발', '홈으로');
  const dialog = document.querySelector('.gm-confirm');
  dialog?.classList.add('course-guide');
  if (usingPad) { const hint = dialog?.querySelector('[data-r="1"] kbd'); if (hint) hint.outerHTML = padKbd(0); }
  answer.then(ok => {
    if (ok) { try { localStorage.setItem(key, 'seen'); } catch {} }
    state.open = false;
    onClose();
    if (!ok) onHome();
  });
  return state;
}
