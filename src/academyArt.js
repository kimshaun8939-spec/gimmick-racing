// 드라이빙 아카데미 설명용 SVG. 외부 파일·DOM 없이 문자열로 사용한다.
export const ART_KEYS = Object.freeze([
  'brakePoint', 'trailBrake', 'liftOff', 'lateApex', 'chicane', 'kerbs',
  'slipstream', 'drs', 'drift', 'fly', 'boat',
]);
const C = { green: '#4dff7a', red: '#ff6b5e', gold: '#ffd23a', cyan: '#73dfff' };
let serial = 0; // 같은 그림·배지를 여러 번 넣어도 SVG 정의 id가 겹치지 않게
const path = (d, color, width = 4, extra = '') =>
  '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + width + '" stroke-linecap="round" stroke-linejoin="round" ' + extra + '/>';
const text = (x, y, label, color = '#edf2ff', size = 12, extra = '') =>
  '<text x="' + x + '" y="' + y + '" fill="' + color + '" font-size="' + size + '" font-weight="700" ' + extra + '>' + label + '</text>';
const dot = (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="5" fill="' + C.gold + '" stroke="#182031" stroke-width="2"/>';
function car(x, y, angle = 0, color = C.green, counter = false) {
  return '<g transform="translate(' + x + ' ' + y + ') rotate(' + angle + ')">' +
    '<rect x="-9" y="-12" width="4" height="8" rx="1" fill="#111722" transform="rotate(' + (counter ? -24 : 0) + ' -7 -8)"/>' +
    '<rect x="5" y="-12" width="4" height="8" rx="1" fill="#111722" transform="rotate(' + (counter ? -24 : 0) + ' 7 -8)"/>' +
    '<path d="M-7 8V13M7 8V13" stroke="#111722" stroke-width="4"/>' +
    '<rect x="-5.5" y="-14" width="11" height="29" rx="4" fill="' + color + '" stroke="#edf2ff" stroke-width="1"/>' +
    '<path d="M-4 -5H4V3H-4Z" fill="#233449"/><path d="M-9 12H9" stroke="' + color + '" stroke-width="3"/></g>';
}
function road(d, width = 54) {
  return path(d, '#8791aa', width + 3) + path(d, '#424a60', width);
}
const corner = 'M72 194V112Q72 50 139 50H335';
const line = 'M53 188V132Q53 101 108 79T222 34H300';
function scene(key, id) {
  const arrow = (d, color = C.green, width = 4, extra = '') =>
    path(d, color, width, extra + ' marker-end="url(#' + id + '-' + (color === C.red ? 'red' : color === C.cyan ? 'cyan' : 'go') + ')"');
  const kerb = (d) => path(d, 'url(#' + id + '-kerb)', 6);
  const apex = () => dot(109, 79) + text(139, 104, '에이펙스', C.gold, 11);
  switch (key) {
    case 'brakePoint':
      return road(corner) + arrow(line) +
        '<rect x="45" y="113" width="16" height="48" rx="3" fill="' + C.red + '" opacity=".85"/>' +
        [150, 100, 50].map((n, i) => '<g><rect x="10" y="' + (150 - i * 30) + '" width="28" height="17" rx="3" fill="#f2f5ff"/>' + text(24, 162 - i * 30, n, '#24304a', 10, 'text-anchor="middle"') + '</g>').join('') +
        car(53, 171) + text(107, 146, '곧게 제동', C.red) + text(207, 65, '코너 진입');
    case 'trailBrake':
      return road(corner) + arrow(line) +
        '<path d="M46 173L60 173L60 130Q60 104 110 81L133 69L110 76Q46 94 46 130Z" fill="' + C.red + '" opacity=".85"/>' +
        car(78, 99, 42) + text(128, 132, '꺾으며 살살 떼기', C.red) +
        arrow('M171 118Q153 94 121 84', C.red, 2) + apex();
    case 'liftOff':
      return road('M-15 131Q129 144 164 82T334 51', 64) +
        arrow('M10 139Q128 150 181 99T300 75', C.cyan, 3, 'stroke-dasharray="7 6"') +
        arrow('M10 139Q114 151 148 79T300 35') + car(127, 114, 38) +
        arrow('M126 104L141 84', C.red, 2) + text(13, 39, 'W 떼기 · 앞에 무게', C.red) +
        text(204, 119, '더 안쪽으로', C.green) + text(206, 151, '점선: 원래 라인', C.cyan, 10);
    case 'lateApex':
      return road(corner, 60) +
        path('M57 187V129Q57 76 126 53T298 62', C.cyan, 2, 'stroke-dasharray="6 5"') +
        arrow('M51 188V120Q51 90 137 80Q184 81 201 42L299 30') +
        dot(166, 78) + car(51, 149) + text(12, 29, '늦게 꺾기', C.gold) +
        text(196, 110, '늦은 에이펙스', C.gold, 11) + text(199, 152, '직선으로 가속!', C.green) +
        arrow('M242 129L272 48', C.cyan, 2);
    case 'chicane':
      return road('M-18 130C62 130 60 53 139 53S231 130 338 130', 48) +
        arrow('M5 143C77 143 62 68 140 68S235 112 302 112') +
        dot(98, 82) + dot(224, 101) + car(152, 71, 109) +
        text(14, 28, 'S자를 한 흐름으로', C.green) + text(91, 159, '첫 탈출 → 다음 진입', '#edf2ff', 12);
    case 'kerbs':
      return road(corner) + kerb('M100 180V113Q100 78 139 78H199') +
        kerb('M230 22H309') + arrow(line) + dot(108, 79) +
        car(112, 78, 65) + text(137, 115, '안쪽 연석', C.gold) +
        text(222, 151, '탈출 연석', C.gold) + arrow('M262 130L270 31', C.cyan, 2);
    case 'slipstream':
      return road('M105 194V-14', 138) +
        [76, 91, 119, 134].map((x) => path('M' + x + ' 53Q' + (x + (x < 105 ? -8 : 8)) + ' 88 ' + x + ' 138', C.cyan, 2, 'opacity=".55"')).join('') +
        car(105, 44, 0, C.gold) + car(105, 133) +
        arrow('M105 116V70') +
        text(197, 51, '뒤에서 따라가기', C.cyan, 11) +
        text(197, 105, '뒤에 붙으면', C.green) + text(197, 124, '빨라짐', C.green, 11);
    case 'drs':
      return road('M15 91H329', 63) +
        '<rect x="108" y="60" width="202" height="62" fill="#4dff7a" opacity=".09"/>' +
        path('M96 55V128', C.gold, 2, 'stroke-dasharray="5 4"') +
        text(10, 32, 'DRS DETECTION', C.gold, 10) + text(176, 52, 'DRS ZONE', C.green, 12) +
        car(189, 77, 90, C.gold) + car(123, 103, 90) +
        path('M124 138H190M124 134V142M190 134V142', C.cyan, 2) +
        text(157, 155, '1초 안', C.cyan, 11, 'text-anchor="middle"') +
        arrow('M210 104H296') +
        '<g transform="translate(240 135)"><path d="M0 21V7M47 21V7" stroke="#a9b4ca" stroke-width="3"/><path d="M-2 17H49" stroke="#8896ae" stroke-width="4"/><path d="M0 7L46 0" stroke="#4dff7a" stroke-width="5"/></g>' +
        text(237, 173, '날개 열림', C.green, 10);
    case 'drift':
      return road('M-10 148Q109 147 139 83T331 48', 68) +
        path('M16 155Q104 155 139 95', '#182031', 3, 'stroke-dasharray="7 4"') +
        path('M13 144Q97 146 128 87', '#182031', 3, 'stroke-dasharray="7 4"') +
        arrow('M19 143Q111 147 145 83T298 41') +
        car(143, 88, 6, C.green, true) +
        path('M147 62A28 28 0 0 1 168 75', C.gold, 3) +
        arrow('M130 60Q112 50 106 73', C.cyan, 2) +
        text(16, 27, '앞바퀴는 반대쪽', C.cyan, 11) + text(194, 123, '각도 유지', C.gold) +
        text(181, 148, '카운터 스티어', C.cyan, 11);
    case 'fly':
      return '<rect x="10" y="98" width="83" height="59" rx="5" fill="#424a60" stroke="#8791aa"/>' +
        '<rect x="237" y="43" width="73" height="59" rx="5" fill="#424a60" stroke="#8791aa"/>' +
        path('M15 128H82M247 73H305', '#edf2ff', 2, 'stroke-dasharray="8 6"') +
        arrow('M28 127Q86 131 115 90T208 69Q236 74 290 73') +
        [132, 175, 217].map((x, i) => '<ellipse cx="' + x + '" cy="' + (82 - i * 7) + '" rx="8" ry="25" fill="none" stroke="' + C.gold + '" stroke-width="4"/>').join('') +
        '<g transform="translate(169 76) rotate(80)"><path d="M0 -18L5 -2L20 8L19 12L4 7L4 17L9 21H-9L-4 17V7L-19 12L-20 8L-5 -2Z" fill="#edf2ff" stroke="#73dfff" stroke-width="2"/></g>' +
        text(18, 177, '이륙', C.green) + text(132, 32, '고리 통과', C.gold) + text(256, 124, '착륙', C.green);
    case 'boat':
      return '<rect x="5" y="13" width="310" height="151" rx="15" fill="#153f57" stroke="#38758a"/>' +
        [40, 75, 110, 145].map((y) => path('M16 ' + y + 'Q45 ' + (y - 8) + ' 74 ' + y + 'T133 ' + y + 'T192 ' + y + 'T251 ' + y + 'T304 ' + y, '#73dfff', 1.5, 'opacity=".2"')).join('') +
        path('M21 132Q102 158 145 91T294 49', '#d0faff', 18, 'opacity=".13"') +
        arrow('M21 132Q102 158 145 91T294 49') +
        '<g transform="translate(148 91) rotate(32)"><path d="M0 -24Q16 -10 12 18Q0 25 -12 18Q-16 -10 0 -24Z" fill="#edf2ff" stroke="#73dfff" stroke-width="2"/><path d="M-6 -4H6V13H-6Z" fill="#2f667a"/></g>' +
        text(18, 34, '드리프트 + 조향', C.cyan, 12) + text(205, 139, '크게 카빙', C.green);
    default: return '';
  }
}
/** 설명 카드에 넣을 SVG 문자열. 모르는 키는 빈 문자열. */
export function academyArt(key) {
  if (!ART_KEYS.includes(key)) return '';
  const id = 'academy-' + (++serial);
  const titles = {
    brakePoint: '브레이크 지점과 코너 진입', trailBrake: '꺾으며 브레이크를 줄이기',
    liftOff: '가속을 떼고 라인을 조이기', lateApex: '늦은 에이펙스와 탈출 가속',
    chicane: '연속 코너를 하나의 흐름으로', kerbs: '안쪽과 탈출 연석 활용',
    slipstream: '앞차 뒤 슬립스트림과 추월', drs: 'DRS 감지선과 가속 구간',
    drift: '드리프트 각도와 카운터 스티어', fly: '이륙과 고리 통과, 착륙', boat: '물 위 카빙',
  };
  const markers = [['go', C.green], ['red', C.red], ['cyan', C.cyan]].map(([name, color]) =>
    '<marker id="' + id + '-' + name + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1L9 5L1 9Z" fill="' + color + '"/></marker>').join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" class="tut-svg academy-art" viewBox="0 0 320 180" width="100%" style="display:block;width:100%;height:auto;font-family:system-ui,sans-serif" role="img" aria-labelledby="' + id + '-title">' +
    '<title id="' + id + '-title">' + titles[key] + '</title><defs>' + markers +
    '<pattern id="' + id + '-kerb" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="6" height="12" fill="#ff4b3a"/><rect x="6" width="6" height="12" fill="#fff"/></pattern></defs>' +
    '<rect width="320" height="180" rx="12" fill="#202738"/>' + scene(key, id) + '</svg>';
}
const BADGES = {
  C: ['#ffe0b7', '#b77943', '#68402b'],
  B: ['#ffffff', '#bccbdd', '#65768b'],
  A: ['#fff6b0', '#f3c74e', '#a66b19'],
  S: ['#8ff8ff', '#d698ff', '#874be4'],
};
/** 20px에서도 읽히는 라이선스 방패. 모르는 등급은 빈 문자열. */
export function licenseBadge(level, { size = 40 } = {}) {
  if (!Object.hasOwn(BADGES, level)) return '';
  const px = Number.isFinite(size) && size > 0 ? size : 40;
  const id = 'academy-badge-' + (++serial);
  const [light, mid, dark] = BADGES[level];
  const stops = level === 'S'
    ? '<stop stop-color="#8ff8ff"/><stop offset=".3" stop-color="#d698ff"/><stop offset=".65" stop-color="#ffb9e9"/><stop offset="1" stop-color="#9174ff"/>'
    : '<stop stop-color="' + light + '"/><stop offset=".48" stop-color="' + mid + '"/><stop offset="1" stop-color="' + dark + '"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" class="academy-badge" viewBox="0 0 40 40" width="' + px + '" height="' + px + '" style="display:inline-block;vertical-align:middle;flex-shrink:0" role="img" aria-label="' + level + ' 라이선스">' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' + stops + '</linearGradient></defs>' +
    '<path d="M20 2L36 8V22Q34 32 20 38Q6 32 4 22V8Z" fill="url(#' + id + ')" stroke="' + light + '" stroke-width="1.6"/>' +
    '<path d="M20 6L32 11V22Q30 29 20 34Q10 29 8 22V11Z" fill="#202332" stroke="' + mid + '" stroke-width="1"/>' +
    '<text x="20" y="28" text-anchor="middle" fill="' + light + '" font-family="system-ui,sans-serif" font-size="25" font-weight="900">' + level + '</text></svg>';
}
