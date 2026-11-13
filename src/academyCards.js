import { keybinds } from './keybinds.js';
import { academyArt } from './academyArt.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]);

// 키 이름은 렌더링할 때 읽어 배치를 바꾼 뒤에도 새 안내를 보여 줘요.
const keyText = (value) => String(value ?? '').replace(/\{([a-zA-Z]+)\}/g, (_, action) => keybinds.label(action));

/**
 * 그림 하나 + 키 행동 최대 세 줄 + 한 줄 팁.
 * art는 academyArt의 그림 키, buttons와 keyHtml만 호출 화면에서 만든 HTML을 받아요.
 * 예: shortCard({ ...LESSON_TEXT.brake, badge: '레슨 1/11', buttons: buttonHtml })
 */
export function shortCard({ art, title, keys = [], tip = '', more = '', badge = '', buttons = '', keyHtml }) {
  // 보조 문장도 호출 화면의 터치·패드·현재 키 배치를 따라가요.
  const text = value => keyHtml ? String(value ?? '').replace(/\{[a-zA-Z]+\}/g, token => {
    const label = document.createElement('span');
    label.innerHTML = keyHtml(token);
    return label.textContent;
  }) : keyText(value);
  const svg = academyArt(art);
  const rows = (Array.isArray(keys) ? keys : []).slice(0, 3).map(([key, action]) =>
    '<li class="ac-short-keyrow">' + (keyHtml
      ? '<span class="ac-short-kbd ac-short-controls">' + keyHtml(key) + '</span>'
      : '<kbd class="ac-short-kbd">' + escapeHtml(text(key)) + '</kbd>') +
    '<span class="ac-short-action">' + escapeHtml(text(action)) + '</span></li>',
  ).join('');
  return '<article class="ac-short-card" aria-label="' + escapeHtml(text(title)) + '">' +
    '<header class="ac-short-header">' +
      (badge ? '<span class="ac-short-badge">' + escapeHtml(badge) + '</span>' : '') +
      '<h2 class="ac-short-title">' + escapeHtml(text(title)) + '</h2>' +
    '</header>' +
    '<div class="ac-short-body' + (svg ? '' : ' ac-short-noart') + '">' +
      (svg ? '<div class="ac-short-art">' + svg + '</div>' : '') +
      '<ul class="ac-short-keys">' + rows + '</ul>' +
    '</div>' +
    (tip ? '<p class="ac-short-tip"><span aria-hidden="true">💡</span> ' + escapeHtml(text(tip)) + '</p>' : '') +
    (more ? '<details class="ac-short-more"><summary class="ac-short-summary">자세히</summary>' +
      '<p class="ac-short-explanation">' + escapeHtml(text(more)) + '</p></details>' : '') +
    (buttons ? '<footer class="ac-short-buttons">' + buttons + '</footer>' : '') +
  '</article>';
}

// K는 호출 화면의 키 설정·패드·터치 안내를 그대로 사용해요.
export function shortKeys(label, K) {
  return String(label).split(/(\{[a-zA-Z]+\})/g).map((part) => {
    const action = /^\{([a-zA-Z]+)\}$/.exec(part);
    return action ? K(action[1]) : part === 'Enter' ? '<kbd>Enter</kbd>' : escapeHtml(part);
  }).join('');
}
