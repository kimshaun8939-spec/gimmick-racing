// brakefollow (2026-11-26, 사용자 "내가 더 빠르면 옆으로 피해서 추월하고 밟거나, 뒤에서 맞춰 가면서 밟으면 안 됨?"):
//   브레이크 구간·코너 앞에서 앞차가 있을 때 봇이 하는 판단은 이 함수 하나 (예전 follow·brakepass·dodge·boldpass·sling·nofollow 대신, &bfollow=0 = 예전).
//   side   : 내 계획 속도가 앞차보다 확실히 빠르고 옆에 차 전체가 들어갈 줄이 있으면 → 그 줄로 빠지고 내 계획대로 밟음 (늦은 제동 다이브)
//   match  : 자리가 없으면 → 앞차 뒤 시간 간격을 지키며 앞차의 '곧 될 속도'(실제 감속도로 미리 봄)에 맞춤. 앞차보다 더 많이는 안 줄임
//   safety : 둘 다 못 지키는 진짜 위험(범퍼가 곧 닿음)만 '닿지 않을 만큼' 제동
//   사람·봇 같은 규칙, 운전 판단만 (차 성능·물리 그대로). 숫자는 모두 BF에.
export const BF = {
  look: 70,        // 앞차를 찾는 거리 (범퍼 간격, m)
  overlap: 0.08,   // '같은 줄' = 옆 간격이 차 폭 + 이 값보다 작음 (m)
  besideK: 0.4,    // 범퍼가 이미 겹쳤는데 옆 간격이 차 폭 × 이 값보다 크면 나란히 = 앞차 아님
  hGap: 0.25,      // 앞차 뒤 목표 간격 (초; 2차에서 0.12 → 0.25: 0.12는 사람과 강한 접촉이 늘었음)
  margin: 0.5,     // 범퍼 여유 (m)
  tauGap: 0.8,     // 간격 오차를 메우는 시간 (초)
  tauV: 0.5,       // 앞차와의 속도 차를 메우는 시간 (초)
  tauAcc: 0.3,     // 앞차 감속을 미리 보는 시간 (초)
  under: 0.5,      // 앞차 속도보다 이만큼 넘게 느려지면 그 차 때문에는 더 안 밟음 (m/s, 더 줄일 일은 범퍼 안전 한계가 맡음)
  cut: 1,          // 범퍼 여유가 이미 없으면 앞차 속도 − 이 값 (m/s)
  keepSec: 0.9,    // 따라갈 때 줄이 앞 (25 + 속도×이 값) m 동안 길 안이어야 함 (초)
  sideSec: 0.9,    // 옆 줄은 앞 (25 + 속도×이 값) m 동안 길 안이어야 함 (초)
  pushed: 0.3,     // 길이 좁아져 내 줄이 이만큼 넘게 밀리면 밀려 들어갈 줄의 앞차도 따라감 (m)
  react: 0.15,     // 페달 지연 (초)
  myBrake: 0.8,    // 안전 계산에 쓰는 내 제동력 비율
  aRelMin: 2,      // 앞차가 나만큼 세게 밟을 때도 남겨 두는 상대 감속 (m/s²)
  faster: 2.5,     // 옆 추월: 내 계획 속도가 앞차 곧 될 속도보다 이만큼 빠름 (m/s)
  sideGap: 0.5,    // 옆 줄 = 앞차 줄 ± (차 폭 + 이 값)
  maxOut: 6.4,     // 코너 바깥쪽으로는 라인에서 이만큼까지만 (m)
  sideRate: 4.5,   // 옆으로 빠지는 속도 (m/s)
  backRate: 2.0,   // 따라갈 때 라인으로 돌아오는 속도 (m/s)
  steerLag: 0.35,  // 핸들 지연 (초)
  clearK: 0.8,     // 다 비키는 시간이 범퍼 닿는 시간의 이 비율 안이면 그 차 때문에는 안 밟음
  // sidejoin (2026-11-26): 나란히(범퍼가 겹친) 차
  noseK: 0.5,      // 내 코가 그 차보다 (범퍼 겹침 길이 × 이 값) 넘게 앞이면 내 줄 유지 = 그 차가 비킴 (앞선 쪽 우선)
  predT: 0.8,      // 나란히 차가 곧 쓸 줄 = 지금 줄 + 옆 속도 × 이 시간 (초), 그쪽 도로 끝 안으로 자름
  besideGap: 0.3,  // 나란히 차와 남길 옆 여유 (차 폭 위에, m)
  dropV: 1.0,      // 비킬 자리가 길 안에 없으면 그 차 속도 − 이 값으로 뒤로 빠짐 (m/s)
};

// 범퍼가 닿을 때까지 시간: 내 속도 그대로, 앞차는 지금 감속도 그대로라고 봄
function timeToHit(gap, closing, dec) {
  if (gap <= 0) return 0;
  if (dec > 0.1) return (-closing + Math.sqrt(Math.max(0, closing * closing + 2 * dec * gap))) / dec;
  return closing > 0.1 ? gap / closing : Infinity;
}

// 범퍼에 안 닿는 가장 빠른 속도 (내 제동력 − 앞차 감속으로 남는 간격을 다 씀)
function safeSpeed(o, me) {
  const room = o.gap - BF.margin - Math.max(0, me.v - o.v) * BF.react;
  if (room <= 0) return Math.max(0, o.v - BF.cut);
  const aRel = Math.max(BF.aRelMin, BF.myBrake * me.aBrake - Math.max(0, -o.acc));
  return o.v + Math.sqrt(2 * aRel * room);
}

// 앞차 뒤에서 맞춰 가기: 앞차만큼 밟음(앞차 실제 감속) + 속도 차·간격 차를 천천히 메움. 앞차보다 느려졌으면 더 안 밟음
//   원하는 감속을 목표 속도로 바꿈 (봇 브레이크 = (속도 − 목표) × me.pedal) → { v, safety: 범퍼 안전 한계가 더 낮았나 }
function matchSpeed(o, me) {
  const gapErr = o.gap - BF.margin - me.v * BF.hGap;
  let aDes = Math.max(0, -o.acc) + (me.v - o.v) / BF.tauV - gapErr / (BF.tauGap * BF.tauV);
  if (me.v < o.v - BF.under) aDes = Math.min(aDes, 0);
  const keep = me.v - aDes / (me.pedal * Math.max(1, me.aBrake)), safe = safeSpeed(o, me);
  return { v: Math.min(keep, safe), safety: safe < keep };
}

// 따라갈 때 줄: 지금 지시한 줄 그대로 (코너 안에서 라인으로 모이면 핸들이 모자라 브레이크, 밀려난 실제 자리를 따라가면 점점 바깥으로).
//   길이 좁아지면 길 끝 안으로 자름 (라인을 넘어 반대쪽으로는 안 밂)
function keepLane(me, env) {
  return inRoom(me.cmdLane, env);
}
function inRoom(lane, env) {
  return lane > 0 ? Math.min(lane, Math.max(0, env.room(1, BF.keepSec))) : Math.max(lane, Math.min(0, env.room(-1, BF.keepSec)));
}

// 나란히 차가 predT 뒤에 있을 줄: 지금 옆 속도로 가다 도로 끝 안으로 잘림, 단 predT 동안 max(backRate, 지금 옆 속도)보다 빨리는 못 옮김
function predLane(o, env) {
  const m = Math.max(BF.backRate, Math.abs(o.latV)) * BF.predT, tgt = inRoom(o.lane + o.latV * BF.predT, env);
  return o.lane + Math.min(m, Math.max(-m, tgt - o.lane));
}

// sidejoin: 나란히(범퍼가 겹친) 차가 곧 쓸 줄(지금 줄 + 옆 속도, 도로 끝 안 = 라인 쪽으로 모여 오는 것)을 보고 내 줄을 정함.
//   내 코가 반 대 넘게 앞이면 내 줄 유지(hold), 아니면 그 차 줄 + 차 폭만큼 내 쪽에 머묾(yield: 바깥이면 바깥, 안쪽이면 안쪽),
//   길 안에 그 자리가 없으면 코가 더 앞인 차 뒤로 빠짐(drop; 내가 조금이라도 앞이면 내 줄 유지). 사람·봇 같은 판단(위치·속도만) → { lane, rate, speed, sj }
function besideLane(me, cars, env, home) {
  let lo = -Infinity, hi = Infinity, vAhead = Infinity, sj = null, key = null;
  for (const o of cars) {
    if (Math.abs(o.dm) >= o.len) continue;
    if (o.dm < -BF.noseK * o.len) { sj = sj || 'hold'; continue; }
    const sd = Math.sign(me.lane - o.lane) || 1, edge = predLane(o, env) + sd * (o.width + BF.besideGap);
    if (sd > 0 ? edge <= home : edge >= home) continue;
    if (sd > 0) lo = Math.max(lo, edge); else hi = Math.min(hi, edge);
    if (o.dm > 0 && o.v < vAhead) { vAhead = o.v; key = o.key; }
    key = key ?? o.key;
  }
  if (lo === -Infinity && hi === Infinity) return { lane: home, rate: BF.backRate, speed: Infinity, sj, key };
  const a = Math.max(lo, inRoom(-99, env)), b = Math.min(hi, inRoom(99, env));
  if (a <= b) return { lane: Math.min(Math.max(home, a), b), rate: BF.sideRate, speed: Infinity, sj: 'yield', key };
  return { lane: home, rate: BF.backRate, speed: vAhead - BF.dropV, sj: vAhead < Infinity ? 'drop' : 'hold', key };
}

// 옆 줄 고르기: 내가 이미 있는 쪽으로만 (브레이크 구간에서 앞차 뒤를 가로지르지 않음), 차 폭만큼 비킴,
//   도로 안·지나가는 폭에 다른 차 없음·그 줄 코너 속도 괜찮음(env.laneOK) → { lane, tClear(다 비키는 시간) } 또는 null
function sideLane(o, me, env) {
  const w = o.width + BF.sideGap, sd = Math.sign(me.lane - o.lane) || me.turnSide || 1;
  let lane = sd * (0 - o.lane) >= w ? 0 : o.lane + sd * w;
  if (lane !== 0) { const r = env.room(sd, BF.sideSec); lane = sd > 0 ? Math.min(lane, r) : Math.max(lane, r); }
  if (sd * (lane - o.lane) < o.width + 0.2) return null;
  if (Math.abs(lane) > BF.maxOut && sd !== me.turnSide) return null;
  if (!env.laneOK(lane, o.key)) return null;
  return { lane, tClear: BF.steerLag + Math.max(0, o.width + 0.1 - Math.abs(o.dLat)) / BF.sideRate };
}

// 옆으로 빠지는 중: 앞차는 다 비키는 시간이 범퍼 닿는 시간보다 충분히 짧으면 한계 없음, 아니면 범퍼 안전 한계. 다른 앞차는 범퍼 안전 한계
function sideLimit(o, isLead, side, me) {
  if (!isLead) return safeSpeed(o, me);
  const tHit = timeToHit(o.gap - BF.margin, me.v - o.v, Math.max(0, -o.acc));
  return side.tClear < BF.clearK * tHit ? Infinity : safeSpeed(o, me);
}

/**
 * me:   { v, lane(라인 기준 지금 옆 거리), cmdLane(지금 지시한 줄), turnSide, aBrake(내 제동 m/s²), pedal(브레이크 = (속도−목표)×pedal), planAt(m 앞 → 내 계획 속도) }
 * cars: [{ key, dm(가운데끼리 앞뒤, + = 앞), len(범퍼가 겹치는 앞뒤 길이), gap(범퍼 간격 m), dLat(옆 간격, 도로 기준), width(겹치지 않을 옆 간격), lane(라인 기준), latV(라인 기준 옆 속도), v, acc(실제 가감속) }]
 * env:  { sidejoin(나란히 차 판단 켬), laneOK(off, key): 그 줄에 차 전체가 들어가고 그 줄 근처에 (key 말고) 다른 차가 없나, room(side, sec): 앞 (25+속도×sec) m 동안 그쪽 도로 끝 }
 * → { mode: 'side'|'match'|'safety'|null, side(옆으로 빠지는 중), lane, rate, speed(앞차 때문의 속도 한계, 없으면 Infinity), key }
 */
export function brakeZoneFollow(me, cars, env) {
  const bs = env.sidejoin ? besideLane(me, cars, env, keepLane(me, env)) : { lane: keepLane(me, env), rate: BF.backRate, speed: Infinity, sj: null, key: null };
  const homeLane = bs.lane;
  // 앞차 = 지금 내 앞을 막는 차 + (길이 좁아져 내 줄이 밀려 들어가면) 그 줄에 있는 앞차. 범퍼가 겹친 채 옆으로 비켜 있는 차는 나란히 = 앞차 아님
  const pushed = Math.abs(homeLane - me.lane) > BF.pushed;
  const blocks = (o) => (Math.abs(o.dLat) < o.width + BF.overlap && !(o.gap < 0 && Math.abs(o.dLat) > o.width * BF.besideK)) || (pushed && Math.abs(o.lane - homeLane) < o.width);
  const front = cars.filter((o) => o.dm > 0 && o.gap < BF.look && blocks(o));
  if (!front.length) return { mode: bs.speed < Infinity ? 'beside' : null, lane: homeLane, rate: bs.rate, speed: bs.speed, key: null, sj: bs.sj, sjKey: bs.key };
  const lead = front.reduce((a, b) => (b.gap < a.gap ? b : a));
  const vSoon = lead.v + Math.min(0, lead.acc) * BF.tauAcc;
  const faster = me.planAt(lead.gap) > vSoon + BF.faster && me.v > lead.v - 0.5;
  const side = faster ? sideLane(lead, me, env) : null;
  let speed = Infinity, mode = side ? 'side' : 'match';
  for (const o of front) {
    const lim = side ? sideLimit(o, o === lead, side, me) : matchSpeed(o, me);
    const v = typeof lim === 'number' ? lim : lim.v;
    if (v < speed) { speed = v; mode = side ? (v < Infinity ? 'safety' : 'side') : lim.safety ? 'safety' : 'match'; }
  }
  if (bs.speed < speed) { speed = bs.speed; mode = 'beside'; }
  return { mode, side: !!side, lane: side ? side.lane : homeLane, rate: side ? BF.sideRate : bs.rate, speed, key: lead.key, sj: bs.sj, sjKey: bs.key };
}
