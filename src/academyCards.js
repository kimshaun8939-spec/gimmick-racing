import { academyArt } from './academyArt.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]);

/**
 * 그림 하나 + 키 행동 최대 세 줄 + 한 줄 팁.
 * art는 academyArt의 그림 키, buttons와 keyHtml만 호출 화면에서 만든 HTML을 받아요.
 * 예: shortCard({ ...LESSON_TEXT.brake, badge: '레슨 1/11', buttons: buttonHtml })
 */
export function shortCard({ art, title, keys = [], tip = '', more = '', badge = '', buttons = '', keyHtml }) {
  const svg = academyArt(art);
  const rows = (Array.isArray(keys) ? keys : []).slice(0, 3).map(([key, action]) =>
    '<li class="ac-short-keyrow">' + (keyHtml
      ? '<span class="ac-short-kbd ac-short-controls">' + keyHtml(key) + '</span>'
      : '<kbd class="ac-short-kbd">' + escapeHtml(key) + '</kbd>') +
    '<span class="ac-short-action">' + escapeHtml(action) + '</span></li>',
  ).join('');
  return '<article class="ac-short-card" aria-label="' + escapeHtml(title) + '">' +
    '<header class="ac-short-header">' +
      (badge ? '<span class="ac-short-badge">' + escapeHtml(badge) + '</span>' : '') +
      '<h2 class="ac-short-title">' + escapeHtml(title) + '</h2>' +
    '</header>' +
    '<div class="ac-short-body' + (svg ? '' : ' ac-short-noart') + '">' +
      (svg ? '<div class="ac-short-art">' + svg + '</div>' : '') +
      '<ul class="ac-short-keys">' + rows + '</ul>' +
    '</div>' +
    (tip ? '<p class="ac-short-tip"><span aria-hidden="true">💡</span> ' + escapeHtml(tip) + '</p>' : '') +
    (more ? '<details class="ac-short-more"><summary class="ac-short-summary">자세히</summary>' +
      '<p class="ac-short-explanation">' + escapeHtml(more) + '</p></details>' : '') +
    (buttons ? '<footer class="ac-short-buttons">' + buttons + '</footer>' : '') +
  '</article>';
}

// K는 호출 화면의 키 설정·패드·터치 안내를 그대로 사용해요.
export function shortKeys(label, K, shiftAction = 'drift') {
  const actions = { W: 'throttle', S: 'brake', A: 'left', D: 'right', Shift: shiftAction, Space: 'climb', R: 'respawn', Esc: 'menu', V: 'camView' };
  return String(label).split(/(Shift|Space|Enter|Esc|[WSADRV])/g).map((part) =>
    actions[part] ? K(actions[part]) : part === 'Enter' ? '<kbd>Enter</kbd>' : escapeHtml(part),
  ).join('');
}
