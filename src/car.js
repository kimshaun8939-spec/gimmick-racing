// 자동차 물리 (아케이드 스타일, 벽과 천장 주행 지원).
// 화면 그리기와 분리되어 있어서, 같은 코드를 AI 차나 다른 플레이어 차에도 그대로 씁니다.
//
// 핵심 아이디어: 차가 자기만의 "위쪽(up)"과 "앞쪽(fwd)"을 가집니다.
// 땅에 붙어 있을 때 up은 바닥면의 방향과 같아서, 벽과 천장도 "기울어진 바닥"일 뿐입니다.
// 실제로 움직이는 방향은 fwd를 up 축으로 slip만큼 돌린 방향입니다 (slip = 미끄러짐 = 드리프트).
//
// 운전 모델 (data/car.json에서 수치 조절)
//   - 엔진: 회전수(rpm)마다 힘이 다르고, 6단 기어 (자동/수동 T). 변속하는 동안은 힘이 끊김
//   - 페달·핸들: 키를 눌러도 서서히 끝까지 감 (확 꺾이지 않음)
//   - 타이어 한계: 저단에서 풀 가속 → 바퀴가 헛돎(휠스핀), 너무 빨리 꺾음 → 앞이 밀림(언더스티어),
//     뒤가 버티지 못함 → 꼬리가 돌아감(오버스티어, 반대로 핸들을 꺾어 잡아야 함)
//   - 무게 이동: 가속하면 뒤로 쏠려 앞이 가벼워지고, 브레이크를 밟으면 앞으로 쏠려 뒤가 가벼워짐
//   - 다운포스: 빠를수록 차가 눌려 접지력이 커짐. 공기 저항 때문에 최고 속도가 자연스럽게 정해짐
import * as THREE from 'three';
import { analyzeCorners } from './cornerInfo.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

// 복귀(R)하면 안 되는 곳 표 (트랙마다 한 번만 만듦): 1 = 루프·자석 도로·튜브·점프·점프대·파도 근처
const _respawnMasks = new WeakMap();
function respawnMask(tr) {
  let bad = _respawnMasks.get(tr);
  if (bad) return bad;
  const S = tr.samples, M = S.length - 1, ds = tr.length / M;
  const mS = (m) => Math.max(1, Math.round(m / ds));
  bad = new Uint8Array(M);
  const mark = (i0, i1) => {
    for (let i = i0; i <= i1; i++) bad[((i % M) + M) % M] = 1;
  };
  for (let i = 0; i < M; i++) {
    const s = S[i];
    if (s.roll || s.magnet || s.gap) mark(i - mS(15), i + mS(15)); // 루프·자석 도로·끊긴 도로(협곡)
    if (tr.tubeK && tr.tubeK[i] > 0) mark(i - mS(10), i + mS(10)); // 자석 튜브 (네온)
  }
  for (const j of tr.jumps || []) if (j.lipI !== undefined && j.landI !== undefined) mark(j.lipI - mS(40), j.landI + mS(20)); // 점프 (달 협곡)
  for (const r of tr.ramps || []) if (r.t !== undefined) mark(Math.round(r.t * M) - mS(25), Math.round(r.t * M) + mS(45)); // 점프대 (네온)
  for (const w of tr.waves || []) {
    const i = w.s ? (w.s.i ?? Math.round(w.s.t * M)) : null; // 파도 점프 (바닷가)
    if (i !== null) mark(i - mS(15), i + mS((w.len || 16) + 40));
  }
  _respawnMasks.set(tr, bad);
  return bad;
}

/** x를 target 쪽으로 초당 rate만큼 이동 */
function approach(x, target, rate, dt) {
  return x < target ? Math.min(target, x + rate * dt) : Math.max(target, x - rate * dt);
}

/** 회전수에 따른 엔진 힘 비율 (표를 선형 보간) */
function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1], [r1, t1] = curve[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

/** a를 up 축으로 돌려 b가 되는 각도 (부호 있음) */
function signedAngle(a, b, up) {
  const cross = _v.crossVectors(a, b);
  return Math.atan2(cross.dot(up), a.dot(b));
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(); // 레일 검사용 임시 벡터
// 땅 위 이동(매 스텝, 차마다)에 쓰는 임시 벡터 (렉 줄이기 2: 예전엔 스텝마다 새 벡터 7~8개 → 쓰레기 청소로 가끔 멈칫)
const _mv = new THREE.Vector3(), _md = new THREE.Vector3(), _org = new THREE.Vector3(), _dir = new THREE.Vector3(), _np = new THREE.Vector3(), _probe = new THREE.Vector3(), _down = new THREE.Vector3();

export class Car {
  /**
   * @param {object} cfg data/car.json
   * @param {object} track buildTrack()의 결과
   */
  constructor(cfg, track) {
    this.cfg = cfg;
    this.track = track;
    this.pos = new THREE.Vector3();
    this.up = WORLD_UP.clone();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.speed = 0; // 앞으로 +, 후진 -
    this.slip = 0; // 차가 바라보는 방향과 실제 이동 방향의 각도 차이
    this.vel = new THREE.Vector3(); // 3D 속도 (공중에서는 이게 실제 상태, 땅에서는 계산 결과)

    this.grounded = true;
    this.surface = 'ground';
    this.magnet = false;
    this.offroad = false;
    this.offK = 0; // 0~1 차 폭 중 잔디(도로 밖)에 걸친 비율 → 속도·접지력이 이만큼 부드럽게 줄어듦
    this.kerbK = 0; // 0~1 차 폭 중 연석 위 비율 (덜덜 울림, 접지력 조금 ↓)
    this.runoff = false; // 도로 밖이 잔디가 아니라 포장 갓길(다리 위)
    this.apexWatch = null; // 지나가는 중인 에이펙스 { ap, best }
    this.apexCombo = 0; // 에이펙스 연속 성공 수
    this.lastApexInfo = null; // HUD용 { perfect, combo }
    // 코너 탈출·연계 판정 (checkCorner)
    this.simT = 0; // 차 시뮬레이션 시간 (초) — 코너 시간 재기용
    this.apexHits = new Set(); // 이번에 성공한 에이펙스 번호 (코너 탈출 때 확인 후 지움)
    this.cornerPrevIdx = null;
    this.cornerStart = new Map(); // 코너 번호 → 들어간 시각
    this.cornerChain = 0; // 이어진 코너를 연달아 깔끔하게 돈 수
    this.chainLastK = -1; // 마지막으로 깔끔하게 돈 코너
    this.lastCornerInfo = null;
    this.airTime = 0;
    this.lastSafeT = 0;
    this.trackInfo = null;
    this.wasOnPad = false;

    // 드리프트와 부스트
    this.drifting = false;
    this.driftDir = 0;
    this.driftTime = 0;
    this.driftLevel = 0; // 0, 1, 2
    this.boostTime = 0;

    // 변신
    // 부스터 (E): 무제한, 켜면 3초 동안 빨라지고 스파이크 장갑 모습으로 바뀜
    this.form = null; // null | 'spike' (부스터 사용 중)
    this.formTime = 0; // 부스터 남은 시간

    // 주행 모드 (1 일반 / 2 가속 / 3 배). 리스폰해도 그대로 유지
    this.mode = 'normal'; // 'normal' | 'accel' | 'boat' | 'fly'
    // 비행 모드 상태
    this.flying = false; // 비행기처럼 날고 있는 중
    this.pitch = 0; // 기수 각도 (+ 위)
    this.bank = 0; // 날개 기울기 (+ 오른쪽으로 기움)
    this.stallFall = 0; // 실속(너무 느림)으로 떨어지는 속도
    this.sink = 0; // 0~1 배 모드가 아닌데 물에 빠져 가라앉는 정도 (1이 되면 복귀)
    this.autoBoatFrom = null; // 물에 닿아 자동으로 배 모드가 됐을 때, 원래 모드
    this.autoFlyFrom = null; // 활주로에서 자동으로 비행 모드가 됐을 때, 원래 모드

    // 운전 (엔진, 기어, 페달, 타이어)
    this.manual = false; // 수동 변속
    this.gear = 1; // -1 = 후진
    this.rpm = cfg.engine.idleRpm;
    this.shiftTimer = 0; // 변속 중 (힘이 끊김)
    this.thr = 0; // 가속 페달 0~1 (서서히 밟힘)
    this.brk = 0; // 브레이크 페달 0~1
    this.steerIn = 0; // 핸들 -1~1 (서서히 꺾임)
    this.load = 0; // 무게 이동: + 뒤로 쏠림(가속), - 앞으로 쏠림(브레이크)
    this.yawRate = 0;
    this.wheelspin = 0; // 0~1 바퀴 헛돎
    this.spool = 0; // 0~1 터보 압력 (engine.turbo가 있는 차만: 밟고 잠깐 뒤에 힘이 붙음)
    this.understeer = 0; // 0~1 앞이 밀림
    this.sliding = 0; // 0~1 뒤가 미끄러짐
    this.limiter = false; // 회전수 한계에 닿음
    // 손맛 (2026-11-10 2라운드)
    this.itemBoostT = this.itemSlowT = 0; // 아이템전: 부스터·전기 충격 남은 시간 (items.js가 넣음)
    this.draft = 0; // 0~1 슬립스트림: 앞차 바로 뒤 (raceSystem이 매 스텝 밖에서 넣어 줌) → 공기 저항 ↓
    // 견인·슬링샷 (2026-11-12, raceSystem이 넣어 줌): tow 0~1 = 1등에게 많이 뒤처짐 → 공기 저항 ↓·최고 속도·힘 살짝 ↑ (cfg.tow)
    //   slingT = 슬링샷 남은 시간 (충전된 슬립스트림에서 옆으로 빠짐), assistDraft = 봇 따라잡기의 보이지 않는 슬립스트림 (예전 세기)
    this.tow = this.slingT = this.assistDraft = 0;
    this.latG = 0; // 옆 가속 (m/s², + = 오른쪽으로 도는 중) → 차체 기울기 (carModel)
    this.lonG = 0; // 앞뒤 가속 (m/s², + 가속, - 브레이크) → 차체 앞뒤 숙임
    this.tyreSlip = 0; // 0~1 타이어가 비명을 지르는 정도 (미끄러짐·헛돎·앞 밀림·바퀴 잠김·드리프트) → 타이어 소리
    this.thrHeld = 0; // 가속 페달을 꽉 밟고 있던 시간 (리프트오프 감지)
    this.liftKick = 0; // 리프트오프 순간 1 → 0.45초 동안 0으로
    this.liftOff = 0; // 0~1 코너 중 액셀을 확 뗌 → 뒤가 가벼워져 꼬리가 살짝 돎
    this.driftAngle = 0; // 드리프트 각도 (rad, 도는 쪽이 +)
    this.driftHold = 0; // 좋은 각도 창 안에서 버틴 시간 (초)
    this.driftLoss = 0; // 이번 드리프트로 잃은 속도 (m/s)
    this.exitRefund = 0; // 깔끔한 드리프트 탈출로 돌려받을 남은 속도 (m/s)
    this.lastDriftInfo = null; // HUD용 { clean, quality, gain, hold, spin, t }
    this.launchTime = 0; // 완벽한 출발 효과 남은 시간
    this.launchSpin = 0; // 출발 실패(휠스핀) 남은 시간
    this.hitT = 0; // 세게 부딪힌 뒤 차가 자세를 되찾는 남은 시간 (이 동안은 꼬리가 더 돌아가지 않음)
    this.hitTurn = 0; // 부딪힌 뒤 차 방향을 진행 방향 쪽으로 아직 더 돌려야 하는 각도 (한 번에 확 돌지 않고 0.1초쯤에 걸쳐)

    // 화면 연출용 값
    this.forwardSpeed = 0;
    this.steerVisual = 0;
    this.events = []; // 'boost', 'land', 'bump', 'lava', 'booster', 'takeoff', 'modeChange' 등
  }

  get yaw() {
    return Math.atan2(this.fwd.x, this.fwd.z);
  }
  get right() {
    return new THREE.Vector3().crossVectors(this.fwd, this.up).normalize();
  }
  get moveDir() {
    return this.fwd.clone().applyAxisAngle(this.up, this.slip);
  }
  /** moveDir와 같지만 새 벡터를 안 만듦 (out에 넣음) */
  moveDirTo(out) {
    return out.copy(this.fwd).applyAxisAngle(this.up, this.slip);
  }
  /** 벽이나 천장을 달리는 중인가 */
  get onWall() {
    return this.grounded && this.up.y < 0.6;
  }

  /** 코스의 t 위치에 차를 놓습니다. */
  placeAt(t, lateral = 0) {
    this.resetCornerState();
    const s = this.track.sampleAt(t);
    this.pos.copy(s.pos).addScaledVector(s.right, lateral);
    const hit = this.track.castRay(new THREE.Vector3(this.pos.x, 30, this.pos.z), DOWN, 60);
    this.pos.y = hit ? hit.point.y : 0;
    this.up.copy(WORLD_UP);
    this.fwd.copy(s.tan);
    this.speed = 0;
    this.slip = 0;
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.surface = hit ? hit.surface : 'ground';
    this.magnet = this.surface === 'magnet';
    this.airTime = 0;
    this.drifting = false;
    this.driftTime = 0;
    this.driftLevel = 0;
    this.boostTime = 0;
    this.form = null;
    this.formTime = 0;
    this.lastSafeT = t;
    this.gear = 1;
    this.rpm = this.cfg.engine.idleRpm;
    this.shiftTimer = 0;
    this.thr = this.brk = this.steerIn = 0;
    this.load = this.yawRate = 0;
    this.wheelspin = this.understeer = this.sliding = 0;
    this.spool = 0;
    this.latG = this.lonG = this.tyreSlip = this.thrHeld = this.liftKick = this.liftOff = 0;
    this.driftAngle = this.driftHold = this.driftLoss = this.exitRefund = 0;
    this.draft = 0;
    this.tow = this.slingT = this.assistDraft = 0;
    this.itemBoostT = this.itemSlowT = 0; // 아이템전: 부스터·전기 충격 남은 시간 (items.js가 넣음)
    if (this._pv) this._pv.set(0, 0, 0);
    this.launchTime = this.launchSpin = 0;
    this.hitT = this.hitTurn = 0;
    this.jumpStall = 0; // 부정 출발로 시동 꺼진 남은 시간
    this.needRelease = false; // 부정 출발 뒤 W를 한 번 떼야 다시 출발
    this.sink = 0;
    this.forwardSpeed = 0;
    this.flying = false;
    this.pitch = this.bank = this.stallFall = this.forceSink = 0;
    this.forceLanding = false;
    this.surgeT = this.surgeK = this.boatCarve = 0; // 배: 물살 가속 남은 시간·세기, 카빙 정도 (0~1)
  }

  /**
   * 배 물살 가속 (2026-11-10): 부표 게이트·급류(seaGates.js)가 부름. sec초 동안 세기 k만큼 (modes.boat.surge)
   *   이미 더 센 가속 중이면 시간만 늘림
   */
  boatSurge(sec, k = 1) {
    if (!(sec > 0)) return;
    this.surgeK = this.surgeT > 0 ? Math.max(this.surgeK, k) : k;
    this.surgeT = Math.max(this.surgeT || 0, sec);
  }

  /** 월드 좌표 (x, z)에 yaw 방향(라디안, 0 = +z)으로 차를 놓습니다. (테스트 맵의 자유 공간용) */
  placeAtPos(x, z, yaw) {
    this.placeAt(0, 0);
    this.pos.set(x, 0, z);
    const hit = this.track.castRay(new THREE.Vector3(x, 30, z), DOWN, 60);
    this.pos.y = hit ? hit.point.y : 0;
    this.surface = hit ? hit.surface : 'ground';
    this.magnet = this.surface === 'magnet';
    this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.safeSpots = [];
    this.safeClock = 0;
  }

  /** 마지막으로 안전했던 도로로 되돌리기 */
  respawn() {
    if (this.track.arena && this.safeSpots && this.safeSpots.length) {
      // 자유 공간: 1~1.5초 전에 서 있던 평지로
      const s = this.safeSpots[Math.max(0, this.safeSpots.length - 3)];
      this.placeAtPos(s.x, s.z, s.yaw);
    } else if (this.track.arena) {
      const sp = this.track.spawn;
      this.placeAtPos(sp.x, sp.z, sp.yaw);
    } else {
      this.respawnOnRoad();
    }
    this.events.push('respawn');
  }

  /**
   * 코스 위로 복귀 (2026-11-10 고침: 복귀하면 차 머리가 앞 코너와 안 맞던 문제)
   *   1) 자리: 마지막 안전 지점 30 m 뒤. 루프·자석 도로·튜브·점프 근처면 그 구간을 피함
   *      (이미 구간을 지나왔으면 구간이 끝난 바로 뒤로, 아니면 구간 앞으로)
   *   2) 옆 위치: 레이싱 라인 위 (연석에는 안 올라가게 도로 안쪽으로 줄임)
   *   3) 방향: 0.5초쯤 앞 레이싱 라인 점을 바라봄 → 앞 코너 쪽으로 이미 살짝 돌아가 있음
   *      차의 위(up) = 바닥 면 방향, 앞(fwd) = 그 면에 눕힌 방향 (예전엔 위를 늘 하늘로 해서 경사·뱅크에서 기울어 있었음)
   *   4) 속도: 레이싱 라인 속도의 80%로 굴러가며 시작 (예전과 같음)
   */
  respawnOnRoad() {
    const tr = this.track, S = tr.samples, M = S.length - 1, ds = tr.length / M;
    const line = tr.racingLine;
    const bad = respawnMask(tr);
    const wrap = (i) => ((i % M) + M) % M;
    const iSafe = wrap(Math.round(this.lastSafeT * M));
    let iPick = wrap(iSafe - Math.round(30 / ds));
    if (bad[iPick]) {
      // 마지막 안전 지점까지 앞으로 가며 처음 나오는 안전한 곳 (구간을 이미 지나온 경우)
      let found = -1;
      for (let k = 1, n = wrap(iSafe - iPick); k <= n; k++)
        if (!bad[wrap(iPick + k)]) {
          found = wrap(iPick + k);
          break;
        }
      // 없으면 뒤로 가며 구간 앞의 안전한 곳
      if (found < 0)
        for (let k = 1; k < M; k++)
          if (!bad[wrap(iPick - k)]) {
            found = wrap(iPick - k);
            break;
          }
      if (found >= 0) iPick = found;
    }
    const HW = tr.width / 2;
    const offAt = (i) => (line && line.offset ? THREE.MathUtils.clamp(line.offset[i % line.N] || 0, -(HW - 1.6), HW - 1.6) : 0);
    // 바닥이 없거나(끊긴 곳)·점프대·용암·자석이면 20 m씩 더 뒤로 (최대 6번)
    for (let tryN = 0; tryN < 6; tryN++) {
      this.placeAt(iPick / M, offAt(iPick));
      const ok = this.surface !== 'ramp' && this.surface !== 'lava' && this.surface !== 'magnet' && this.track.castRay(_v.copy(this.pos).addScaledVector(WORLD_UP, 1.5), DOWN, 3);
      if (ok) break;
      iPick = wrap(iPick - Math.round(20 / ds));
    }
    // 바닥 면 방향으로 차 세우기
    const ground = this.track.castRay(new THREE.Vector3().copy(this.pos).addScaledVector(WORLD_UP, 1.5), DOWN, 3);
    if (ground && ground.normal.y > 0.6) this.up.copy(ground.normal);
    // 굴러가는 출발 속도 (레이싱 라인 속도의 80%, 예전과 같음)
    const v = line ? 0.8 * this.lineSpeed(iPick % line.N) : 0;
    // 바라볼 곳: 약 0.5초 앞(12~30 m)의 레이싱 라인 점. 그 점이 루프·튜브 안이면 도로 방향 그대로
    const look = Math.round(THREE.MathUtils.clamp(v * 0.5, 12, 30) / ds);
    const j = wrap(iPick + look);
    const dir = new THREE.Vector3();
    if (line && !bad[j]) {
      const sj = S[j];
      dir.copy(sj.pos).addScaledVector(sj.right, offAt(j)).sub(this.pos);
    } else dir.copy(S[iPick].tan3 || S[iPick].tan);
    dir.addScaledVector(this.up, -dir.dot(this.up));
    if (dir.lengthSq() < 1e-6) dir.copy(S[iPick].tan).addScaledVector(this.up, -S[iPick].tan.dot(this.up));
    this.fwd.copy(dir.normalize());
    this.yawRate = 0;
    if (line && this.trackInfo) {
      this.speed = v;
      this.vel.copy(this.fwd).multiplyScalar(v);
      this.fitGear();
      this.spool = 0.7;
    }
  }

  /** 출발 전 공회전: W를 누르고 있으면 회전수가 올라가고, 떼면 내려감 */
  revEngine(dt, throttle) {
    const e = this.cfg.engine;
    this.thr = throttle ? 1 : 0;
    this.rpm = throttle ? Math.min(e.limiter, this.rpm + e.revRise * dt) : Math.max(e.idleRpm, this.rpm - e.revFall * dt);
  }

  /**
   * 빨간불 5개가 꺼지는 순간 (F1식 출발)
   *   W를 미리 누르고 있었으면 = 부정 출발 → 시동이 꺼져 멈춤. 최소 stallTime초 동안, 그리고 W를 한 번 뗐다가 다시 눌러야 출발
   *   불이 꺼진 뒤에 W를 누르면 정상 출발 (빨리 반응하면 perfectReaction → 완벽한 출발 보너스, main.js가 reactionLaunch 호출)
   */
  launch(throttleHeld) {
    const e = this.cfg.engine;
    this.launchSpin = 0;
    if (throttleHeld) {
      this.jumpStall = e.stallTime ?? 1.2;
      this.needRelease = true;
      this.rpm = 0;
      this.thr = 0;
      this.events.push('jumpStart');
    }
  }

  /** 불이 꺼진 뒤 처음 W를 누른 순간: 반응이 빠르면 완벽한 출발 */
  reactionLaunch(reaction) {
    const e = this.cfg.engine;
    if (reaction <= (e.perfectReaction ?? 0.3)) {
      this.launchTime = e.launchTime;
      this.events.push('perfectLaunch');
    }
  }

  /** 부정 출발로 시동이 꺼져 있는지 */
  get stalled() {
    return this.jumpStall > 0 || this.needRelease;
  }

  /** 페달과 핸들: 키보드는 0/1이지만 실제 값은 서서히 따라감 */
  updatePedals(dt, c) {
    const ic = this.cfg.input;
    this.thr = approach(this.thr, c.throttle, c.throttle > this.thr ? ic.throttleRise : ic.throttleFall, dt);
    this.brk = approach(this.brk, c.brake, c.brake > this.brk ? ic.brakeRise : ic.brakeFall, dt);
    // 같은 방향으로 더 꺾을 때는 천천히, 풀거나 반대로 꺾을 때는 빠르게 (빠를수록 더 천천히 꺾임)
    const more = c.steer !== 0 && Math.sign(c.steer) === Math.sign(this.steerIn || c.steer) && Math.abs(c.steer) > Math.abs(this.steerIn);
    // (배로 물 위에서는 빨라도 핸들이 느려지지 않음: 부표 게이트 사이를 빠르게 좌우로 누빌 수 있게, 2026-11-10)
    const fast = this.mode === 'boat' && this.surface === 'water' ? 0 : Math.min(1, Math.abs(this.speed) / this.cfg.maxSpeed);
    this.steerIn = approach(this.steerIn, c.steer, more ? ic.steerRise * (1 - (ic.steerRiseHighSpeed ?? 0.35) * fast) : ic.steerReturn, dt);
  }

  /** 주행 모드 바꾸기: 'normal' | 'accel' | 'boat' */
  setMode(mode, quiet = false) {
    if (mode !== 'normal' && !(this.cfg.modes[mode] && typeof this.cfg.modes[mode] === 'object')) return;
    if (mode === this.mode) return;
    this.mode = mode;
    if (!quiet) this.events.push('modeChange');
  }

  /** 기어별 레드라인 속도. 가속 모드는 기어가 길어져 최고 속도가 올라감 */
  gearSpeeds() {
    if (this.mode !== 'accel') return this.cfg.gears;
    return (this._accelGears ||= this.cfg.gears.map((g) => g * this.cfg.modes.accel.gearFactor));
  }

  /** 지금 속도에 맞는 기어로 바로 바꿈 (착지·복귀 직후: 변속을 여러 번 하느라 힘이 끊기지 않게) */
  fitGear() {
    const v = Math.max(0, this.speed), G = this.gearSpeeds(), e = this.cfg.engine;
    const i = G.findIndex((g) => g >= v * 1.15);
    this.gear = i < 0 ? G.length : i + 1;
    this.shiftTimer = 0;
    this.rpm = Math.max(e.idleRpm, Math.min(e.redline, (e.redline * v) / G[this.gear - 1]));
  }

  /** 기어 변속 (자동: 회전수를 보고 알아서, 수동: X 올림 / Z 내림) */
  updateGearbox(dt, c) {
    const e = this.cfg.engine, G = this.gearSpeeds();
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.gear < 1) return; // 후진 중
    const rpmIn = (g) => (e.redline * Math.abs(this.speed)) / G[g - 1];
    const shift = (g, time, ev) => {
      this.gear = g;
      this.shiftTimer = time;
      this.events.push(ev);
    };
    if (this.manual) {
      if (c.shiftUp && this.gear < G.length) {
        // 레드라인 근처에서 올리면 "완벽한 변속": 힘이 거의 안 끊기고 살짝 밀어줌
        const perfect = this.grounded && this.rpm >= e.redline * e.perfectShift && this.shiftTimer <= 0;
        shift(this.gear + 1, perfect ? e.perfectShiftTime : e.shiftTime, perfect ? 'perfectShift' : 'shift');
        if (perfect) this.speed += e.perfectShiftKick;
      }
      if (c.shiftDown && this.gear > 1) {
        if (rpmIn(this.gear - 1) > e.limiter * 1.03) this.events.push('overRev'); // 너무 빨라서 내리면 엔진이 터짐
        else shift(this.gear - 1, e.downShiftTime, 'shift');
      }
    } else if (this.shiftTimer <= 0 && this.grounded) {
      if (this.gear < G.length && this.rpm > e.redline * e.autoUp && this.thr > 0.2) shift(this.gear + 1, e.shiftTime, 'shift');
      else if (this.gear > 1 && rpmIn(this.gear) < e.redline * e.autoDown && rpmIn(this.gear - 1) < e.redline * 0.9) shift(this.gear - 1, e.downShiftTime, 'shift');
    }
  }

  /** 아이템에 맞음: 가던 방향 그대로 속도만 k배 (옆으로 밀지 않음 → 낭떠러지에서 안 떨어짐) */
  itemHit(k) {
    this.speed *= k;
    this.vel.multiplyScalar(k);
    this.itemBoostT = 0;
  }

  startBoost(seconds, minSpeedFactor = 1, fromBooster = false) {
    // E 부스터는 booster.enabled, 그 밖의 부스트(패드·드리프트·고리)는 boostsEnabled로 켜고 끔
    if (!(fromBooster ? this.cfg.booster.enabled ?? true : this.cfg.boostsEnabled)) return;
    this.boostTime = Math.max(this.boostTime, seconds);
    this.speed = Math.max(this.speed, this.cfg.maxSpeed * minSpeedFactor);
    this.events.push('boost');
  }

  /** 부스터: 언제든 무제한. 3초 동안 빨라지고 스파이크 장갑 모습이 됨 (사용 중에 다시 누르면 3초로 다시 채움) */
  useBooster() {
    const b = this.cfg.booster;
    if (b.enabled === false) return;
    if (this.form === 'spike') return; // 부스터를 쓰는 중에는 다시 못 씀 (3초가 끝나거나 S로 끈 뒤에 다시)
    this.events.push('booster');
    this.form = 'spike';
    this.formTime = b.duration;
    this.startBoost(b.duration, b.minSpeedFactor, true);
  }

  /**
   * 그랑프리 가드레일 안쪽에 붙잡아 둠
   *   벽 충돌은 차 가운데에서 쏘는 레이 하나라서, 비스듬히 박으면 차 앞부분이 레일을 1 m 넘게 뚫고 들어갔음
   *   → 차 네 귀퉁이(앞 2.5 m, 뒤 2.3 m, 옆 1 m) 중 하나라도 레일 선을 넘으면 그만큼 안쪽으로 밀고, 바깥으로 가는 속도는 없앰
   */
  keepInsideRail() {
    const ti = this.trackInfo;
    if (!this.track.railLimit || !this.grounded || this.flying || !ti) return;
    const lim = this.track.railLimit(ti);
    if (lim == null) return;
    const s = ti.sample, sg = Math.sign(ti.lateral) || 1;
    if (Math.abs(ti.lateral) > lim + 1 || Math.abs(this.pos.y - s.pos.y) > 4) return; // 이미 훨씬 바깥(다른 도로 등)은 건드리지 않음
    const side = _v1.crossVectors(this.fwd, this.up).normalize();
    const outX = s.right.x * sg, outZ = s.right.z * sg;
    // 귀퉁이가 바깥쪽으로 얼마나 나가 있는지 (차 가운데 기준)
    const fo = this.fwd.x * outX + this.fwd.z * outZ, so = side.x * outX + side.z * outZ;
    const reach = Math.max(2.5 * fo, -2.3 * fo) + Math.abs(so) * 1.0;
    const excess = Math.abs(ti.lateral) + reach - (lim - 0.05);
    if (excess <= 0) return;
    this.pos.x -= outX * excess;
    this.pos.z -= outZ * excess;
    const out = _v2.set(outX, 0, outZ);
    const v = this.moveDir.multiplyScalar(this.speed);
    const vn = v.dot(out);
    if (vn > 0) {
      v.addScaledVector(out, -vn * 1.2);
      if (vn > 8) this.events.push('bump');
      this.setVelocityOnSurface(v);
      this.afterImpact(-vn);
    }
  }

  /** 부스트(부스터 E·부스트 패드) 즉시 끄기 */
  cancelBoost() {
    if (this.boostTime <= 0 && this.form !== 'spike') return;
    this.boostTime = 0;
    if (this.form === 'spike') {
      this.form = null;
      this.formTime = 0;
      this.events.push('boosterEnd');
    }
    this.events.push('boostCancel');
  }

  /** (예전 에너지 큐브용) 이제 게이지가 없어서 아무 일도 하지 않음 */
  addCharge() {}

  /**
   * 세게 부딪힌 직후 (벽·블록·건물·가드레일): 진행 방향만 꺾이고 차 방향은 그대로면 미끄러짐(slip)이 40~70°로 커지고,
   * 그러면 뒷바퀴 한계(오버스티어) 계산이 꼬리를 계속 돌려서 차가 빙글빙글 멈추지 않았음.
   * → 부딪힌 세기만큼: 옆으로 긁히며 속도를 잃고, 차 방향을 새 진행 방향 쪽으로 돌려 미끄러짐을 작게 줄이고,
   *   돌던 회전과 드리프트를 끊고, 잠깐(impact.recover초) 동안은 꼬리가 더 돌아가지 않게 함
   * vn: 벽 쪽으로 들어가던 속도 (m/s, 음수). setVelocityOnSurface를 부른 뒤에 부름
   */
  afterImpact(vn) {
    const I = this.cfg.impact;
    if (!I || this.flying) return;
    const hard = THREE.MathUtils.clamp((Math.abs(vn) - I.minSpeed) / I.fullSpeed, 0, 1);
    if (hard <= 0) return;
    // 벽에 긁히는 마찰: 들이받은 세기에 비례해서 속도 손해 (최대 maxLoss 비율)
    const s = Math.abs(this.speed);
    const loss = Math.min(I.maxLoss * s, I.friction * Math.abs(vn) * hard);
    this.speed = Math.sign(this.speed) * (s - loss);
    // 차 방향을 진행 방향 쪽으로: align 비율만큼 돌리고, 그래도 maxSlip보다 크면 거기까지
    let turn = this.slip * I.align * hard;
    const rest = this.slip - turn;
    if (Math.abs(rest) > I.maxSlip) turn += rest - Math.sign(rest) * I.maxSlip;
    this.hitTurn = turn; // 실제로 돌리는 건 updateGround에서 alignRate 빠르기로 (한 프레임에 확 돌면 순간이동처럼 보임)
    this.yawRate *= 1 - (1 - I.yawKeep) * hard;
    if (this.drifting) this.endDrift(false);
    this.hitT = Math.max(this.hitT, I.recover * hard);
  }

  /**
   * 건물, 나무, 바리케이드 같은 물체에 부딪혔을 때 밀어내기.
   * normal: 물체에서 차 쪽을 향하는 수평 방향, depth: 겹친 깊이
   */
  applyPush(normal, depth) {
    this.pos.addScaledVector(normal, depth);
    const v = this.vel.clone();
    const vn = v.dot(normal);
    if (vn >= 0) return;
    v.addScaledVector(normal, -vn * 1.3);
    if (vn < -8) this.events.push('bump');
    if (this.grounded) {
      this.setVelocityOnSurface(v);
      this.afterImpact(vn);
      this.vel.copy(this.moveDir).multiplyScalar(this.speed);
    } else {
      this.vel.copy(v);
    }
  }

  leaveGround(vel) {
    this.vel.copy(vel);
    this.grounded = false;
    this.airTime = 0;
  }

  /** 새 바닥 방향에 맞춰 차의 방향을 최소한으로 돌림 */
  alignTo(normal) {
    _q.setFromUnitVectors(this.up, normal);
    this.fwd.applyQuaternion(_q);
    this.up.copy(normal);
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
  }

  /** 3D 속도를 바닥 위의 speed와 slip으로 바꿈 */
  setVelocityOnSurface(v) {
    const tangential = v.clone().addScaledVector(this.up, -v.dot(this.up));
    const s = tangential.length();
    if (s < 1e-4) {
      this.speed = 0;
      this.slip = 0;
      return;
    }
    tangential.divideScalar(s);
    let a = signedAngle(this.fwd, tangential, this.up);
    if (Math.abs(a) > Math.PI / 2) {
      // 뒤로 움직이는 중
      this.speed = -s;
      a = Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI));
    } else this.speed = s;
    this.slip = THREE.MathUtils.clamp(a, -1.2, 1.2);
  }

  /**
   * @param {number} dt
   * @param {import('./input.js').ControlState} c
   */
  update(dt, c) {
    this.simT += dt;
    this.trackInfo = this.track.nearest(this.pos);
    this.keepInsideRail();

    if (this.form) {
      this.formTime -= dt;
      if (this.formTime <= 0) {
        this.form = null;
        this.formTime = 0;
        this.events.push('boosterEnd');
      }
    }
    if (c.booster) this.useBooster();
    // 앞으로 가는 중에 S(브레이크) → 부스터·부스트 패드 효과를 바로 끄고 평소처럼 감속
    if (c.brake > 0.2 && !c.booster && this.speed > 0.5 && (this.cfg.booster.cancelOnBrake ?? true)) this.cancelBoost();
    if (c.mode && this.cfg.modes.manualSelect) this.setMode(c.mode); // 지금은 자동 전환만 (manualSelect false)
    // 부정 출발: 시동 꺼짐 → W를 계속 누르고 있으면 그대로 서 있음
    if (this.jumpStall > 0) this.jumpStall -= dt;
    if (this.needRelease && !(c.throttle > 0)) this.needRelease = false;
    if (this.stalled) {
      c = { ...c, throttle: 0 };
      this.rpm = 0;
    }
    this.updatePedals(dt, c);
    this.updateGearbox(dt, c);
    if (this.launchTime > 0) this.launchTime -= dt;
    if (this.launchSpin > 0) this.launchSpin -= dt;
    if (this.hitT > 0) this.hitT -= dt;

    if (this.grounded) this.updateGround(dt, c);
    else this.updateAir(dt, c);

    if (this.boostTime > 0) this.boostTime -= dt;
    if (this.itemBoostT > 0) this.itemBoostT -= dt;
    if (this.slingT > 0) this.slingT -= dt;
    if (this.itemSlowT > 0) this.itemSlowT -= dt;
    if (this.pos.y < -30 || (!this.grounded && this.airTime > 8)) this.respawn();

    // 차가 받는 가속 (옆·앞뒤): 차체 기울기·숙임 연출용. 복귀·착지 같은 순간 이동은 잘라 냄
    const pv = this._pv || (this._pv = this.vel.clone());
    if (dt > 0) {
      const ax = (this.vel.x - pv.x) / dt, ay = (this.vel.y - pv.y) / dt, az = (this.vel.z - pv.z) / dt;
      const r = this.right, onG = this.grounded && !this.flying;
      const lat = onG ? THREE.MathUtils.clamp(ax * r.x + ay * r.y + az * r.z, -40, 40) : 0;
      const lon = onG ? THREE.MathUtils.clamp(ax * this.fwd.x + ay * this.fwd.y + az * this.fwd.z, -45, 30) : 0;
      const k = 1 - Math.exp(-dt / 0.09);
      this.latG += (lat - this.latG) * k;
      this.lonG += (lon - this.lonG) * k;
    }
    pv.copy(this.vel);
    if (!this.grounded || this.flying || this.surface === 'water') this.tyreSlip = 0;

    this.forwardSpeed = this.speed;
    this.steerVisual = this.steerIn;
  }

  updateGround(dt, c) {
    const cfg = this.cfg;
    const spike = this.form === 'spike';
    let f = this.speed;
    // 비행 모드: 충분히 빠를 때 Space로 이륙
    if (this.mode === 'fly' && c.climb && this.up.y > 0.7 && f >= cfg.modes.fly.takeoffSpeed && this.surface !== 'water' && this.flightAllowed()) {
      this.takeOff();
      return;
    }
    // 배 모드로 물 위: 엔진·타이어 대신 배처럼 움직임 (아래 이동·바닥 찾기는 같이 씀)
    motion: {
    if (this.mode === 'boat' && this.surface === 'water') {
      this.boatMotion(dt, c);
      f = this.speed;
      break motion;
    }
    const boosting = this.boostTime > 0;
    const M = cfg.modes;
    const accel = this.mode === 'accel', boatOnLand = this.mode === 'boat';
    let maxSpeed = cfg.maxSpeed * (boosting ? cfg.boost.speedFactor : 1) * (spike ? cfg.booster.speedFactor : 1);
    // 잔디: 차가 걸친 만큼 서서히 느려짐 (두 바퀴만 빠지면 조금, 완전히 나가면 많이). 포장 갓길은 덜 느려짐
    const offK = spike ? 0 : this.offK;
    const offSpeed = this.runoff ? cfg.offroad.runoffSpeedFactor ?? 0.85 : cfg.offroad.maxSpeedFactor;
    if (!boosting) maxSpeed *= 1 - (1 - offSpeed) * offK;
    if (accel) maxSpeed *= M.accel.speedFactor;
    if (boatOnLand && !boosting) maxSpeed *= M.boat.landSpeedFactor; // 배 바닥이 땅에 끌림
    // 활주로(비행 모드로 땅을 달리는 중): 비행 최고 속도까지 빠르게 줄임 (가속 모드로 너무 빨리 들어오면 이륙 뒤 고리 쪽으로 못 돎)
    // (착륙한 뒤 활주로 밖에서는 안 줄임: 착륙장에서 비행 최고 속도로 확 깎이지 않게)
    const flyGround = this.mode === 'fly' && M.fly && this.rwZoneLast > 0;
    // 슬립스트림: 최고 속도도 (추월 가능). 봇 따라잡기의 보이지 않는 슬립스트림(assistDraft)은 예전 세기 그대로, 둘 중 큰 쪽만
    //   견인(tow)·슬링샷(slingT)은 따로 곱함 (raceSystem이 넣어 줌, data/car.json draft·tow)
    const DR = cfg.draft || {}, TW = cfg.tow || {};
    const drK = Math.min(1, this.draft || 0), adK = Math.min(1, this.assistDraft || 0), twK = Math.min(1, this.tow || 0);
    if (!flyGround) {
      const top = Math.max(drK * (DR.topGain ?? 0.04), adK * (DR.assistTopGain ?? 0.04));
      if (top > 0) maxSpeed *= 1 + top;
      if (twK > 0) maxSpeed *= 1 + (TW.topGain ?? 0) * twK;
      if (this.slingT > 0) maxSpeed *= 1 + (DR.slingTop ?? 0.06);
    }
    // 아이템전: 부스터 = 최고 속도 ↑, 전기 충격 = 최고 속도 ↓ (items.js가 시간을 넣음)
    const IT = cfg.items || {};
    if (this.itemBoostT > 0 && !flyGround) maxSpeed *= IT.boostTop ?? 1.22;
    if (this.itemSlowT > 0) maxSpeed *= IT.shockTop ?? 0.75;
    if (flyGround) maxSpeed = Math.min(maxSpeed, M.fly.maxSpeed);
    const e = cfg.engine, G = this.gearSpeeds(), tire = cfg.tire;
    const v = Math.abs(f);

    // 타이어 한계: 다운포스(빠를수록 ↑), 노면(잔디 ↓, 스파이크 ↑), 무게 이동에 따라 달라짐
    const df = cfg.aero.downforce * Math.min(1.6, (v / cfg.maxSpeed) ** 2);
    const offGrip = this.runoff ? 0.9 : cfg.offroad.gripFactor;
    let surfGrip = (1 - (1 - offGrip) * offK) * (1 - (cfg.kerb?.gripLoss ?? 0) * this.kerbK);
    if (spike) surfGrip *= cfg.booster.gripFactor;
    if (accel) surfGrip *= M.accel.gripFactor; // 힘이 세진 만큼 타이어가 버거움
    if (boatOnLand) surfGrip *= M.boat.landGrip;
    const launchK = this.launchTime > 0 ? 1.5 : 1;
    // 구동 방식 (2026-11-10, 차마다 손맛): cfg.drivetrain
    //   'rwd' 뒷바퀴 굴림(기본): 가속하면 무게가 뒤로 쏠려 출발 접지↑, 바퀴가 헛돌면 꼬리가 미끄러짐(파워 오버스티어)
    //   'fwd' 앞바퀴 굴림: 가속하면 앞이 가벼워져 출발 접지↓, 헛돌면 앞이 밀림(언더스티어), 꼬리는 안정
    //   'awd' 네 바퀴 굴림: 출발 접지 ×awdTraction, 헛돌아도 앞뒤가 반씩만 흔들림
    const drv = cfg.drivetrain || 'rwd';
    const loadT = drv === 'fwd' ? 1 - tire.loadShift * this.load : drv === 'awd' ? 1 + 0.4 * tire.loadShift * this.load : 1 + tire.loadShift * this.load;
    const drvK = drv === 'awd' ? tire.awdTraction ?? 1.12 : 1;
    const tractionLimit = tire.traction * (1 + df) * loadT * drvK * surfGrip * launchK;
    const rearSpinK = drv === 'fwd' ? 0 : drv === 'awd' ? 0.5 : 1; // 헛돌 때 뒤가 약해지는 비율
    const frontSpinK = drv === 'fwd' ? 0.8 : drv === 'awd' ? 0.3 : 0; // 헛돌 때 앞이 밀리는 비율
    const brakeLimit = tire.brakeGrip * (1 + df) * surfGrip;

    // --- 엔진 → 바퀴 (drive), 브레이크·저항 (dec) ---
    let drive = 0, dec = 0, brakeOver = 0;
    this.wheelspin = 0;
    this.limiter = false;
    const reverse = f < -0.5 || (f <= 0.5 && c.brake > 0 && !c.throttle);
    if (reverse) {
      this.gear = -1;
      if (c.brake && f > -cfg.maxReverse) drive -= cfg.reverseAccel * this.brk;
      if (this.thr > 0 && f < 0) dec += Math.min(cfg.brake, brakeLimit) * this.thr; // 후진 중 W = 브레이크
      this.rpm = e.idleRpm + (e.redline * 0.55 - e.idleRpm) * Math.min(1, v / cfg.maxReverse);
    } else {
      if (this.gear < 1) this.gear = 1;
      const g = this.gear;
      const wheelRpm = (e.redline * v) / G[g - 1];
      // 1단 저속에서는 클러치가 미끄러지며 회전수를 유지
      const clutchRpm = g === 1 ? e.idleRpm + (e.launchRpm - e.idleRpm) * this.thr : e.idleRpm;
      const target = Math.min(Math.max(wheelRpm, clutchRpm), e.limiter + 200);
      this.rpm = THREE.MathUtils.lerp(this.rpm, target, 1 - Math.exp(-18 * dt));
      this.limiter = wheelRpm >= e.limiter && !boosting;
      if (this.limiter) this.rpm = e.limiter - Math.random() * 500; // 회전수 한계: 힘이 끊기며 덜덜
      // 터보 (engine.turbo = { share, lag }): 힘의 share 비율이 터보 몫. 밟으면 lag초쯤 걸려 차오르고(터보 랙), 떼면 빨리 빠짐
      //   회전수가 낮으면 덜 참 → 코너에서 너무 떨어뜨리면 탈출이 굼뜸. 계속 밟고 있으면 100%라 속도 계획(lineCarModel)과 같음
      const tb = e.turbo;
      if (tb) {
        const tgt = this.thr * THREE.MathUtils.clamp((this.rpm - e.idleRpm) / (e.redline * 0.72 - e.idleRpm), 0, 1);
        this.spool += (tgt - this.spool) * (1 - Math.exp(-dt / (tgt > this.spool ? tb.lag : tb.lag * 0.35)));
      }
      const turboK = tb ? 1 - tb.share * (1 - this.spool) : 1;
      if (this.shiftTimer <= 0 && wheelRpm < e.limiter && this.thr > 0) {
        const modeK = accel ? M.accel.powerFactor : boatOnLand ? M.boat.landPowerFactor : 1;
        const towP = twK > 0 ? 1 + (TW.powerGain ?? 0) * twK : 1; // 견인: 힘 살짝 ↑ (타이어 한계는 그대로)
        const want = (this.thr * e.power * modeK * torqueAt(e.torque, this.rpm) * launchK * turboK * towP) / G[g - 1];
        if (want > tractionLimit) {
          // 타이어가 버티지 못함 → 바퀴가 헛돌며 힘이 새어 나감
          this.wheelspin = Math.min(1, ((want - tractionLimit) / tractionLimit) * 2.5);
          drive = tractionLimit * (1 - 0.12 * this.wheelspin);
        } else drive = want;
      }
      if (this.launchSpin > 0 && this.thr > 0) {
        this.wheelspin = Math.max(this.wheelspin, 0.9);
        drive *= 0.45;
      }
      if (v > 0.5) dec += e.engineBrake * (1 - this.thr) * Math.min(1, this.rpm / e.redline); // 엔진 브레이크
      if (this.brk > 0 && f > 0) {
        dec += Math.min(cfg.brake * this.brk, brakeLimit);
        // 타이어 한계 가까이 밟음 → 바퀴가 잠기기 직전 '끼익' (소리만)
        if (v > 6) brakeOver = THREE.MathUtils.clamp(((cfg.brake * this.brk) / brakeLimit - 0.85) * 2.5, 0, 1);
      }
    }
    // 공기 저항 + 구름 저항. 슬립스트림(앞차 바로 뒤, car.draft 0~1)이면 공기 저항이 draft.dragCut만큼 줄어듦
    //   봇 따라잡기의 보이지 않는 슬립스트림(assistDraft)은 예전 세기(assistDragCut), 진짜 슬립스트림과 겹치면 큰 쪽만. 견인은 따로 곱함
    const draftK = (1 - Math.max(drK * (DR.dragCut ?? 0.3), adK * (DR.assistDragCut ?? 0.3))) * (twK > 0 ? 1 - (TW.dragCut ?? 0) * twK : 1);
    dec += cfg.aero.drag * v * v * draftK + cfg.aero.rolling;
    f += drive * dt;
    f = Math.sign(f) * Math.max(0, Math.abs(f) - dec * dt); // 저항은 속도를 0까지만 줄임
    // 무게 이동: 가속 → 뒤로, 감속 → 앞으로 쏠림
    const accelNow = drive - dec * Math.sign(f || 1);
    this.load = THREE.MathUtils.lerp(this.load, THREE.MathUtils.clamp(accelNow / tire.loadAccel, -1, 1), 1 - Math.exp(-6 * dt));
    // 구동 바퀴가 쓰는 힘의 비율 (0~1): 타이어는 앞뒤로 쓰는 만큼 옆으로 버티는 힘이 줄어듦 (마찰원)
    const powerUse = drive > 0 ? Math.min(1, drive / Math.max(1, tractionLimit)) : 0;
    // 리프트오프: 빠른 코너에서 액셀을 꽉 밟고 있다가(0.6초 이상) 확 떼면 무게가 앞으로 쏠려 뒤가 순간 가벼워짐
    //   (코너 중에 W를 톡톡 끊어 밟는 것으로는 안 생김 → 키보드로 속도 맞추기는 그대로 편함). 0.45초 동안 줄어듦
    const latUse = THREE.MathUtils.clamp((Math.abs(this.yawRate) * v) / Math.max(1, tire.lateral), 0, 1);
    if (this.thr > 0.8) this.thrHeld = (this.thrHeld || 0) + dt;
    else if (this.thr < 0.3) {
      if (this.thrHeld > 0.6 && latUse > 0.5 && v > 15) this.liftKick = 1;
      this.thrHeld = 0;
    }
    this.liftKick = Math.max(0, (this.liftKick || 0) - dt / 0.45);
    this.liftOff = this.liftKick * THREE.MathUtils.clamp((latUse - 0.35) / 0.4, 0, 1);

    if (boosting && f < maxSpeed) f = Math.min(maxSpeed, f + cfg.boost.accel * dt);
    if (this.itemBoostT > 0 && f > -1 && f < maxSpeed) f = Math.min(maxSpeed, f + (IT.boostAccel ?? 16) * dt); // 아이템 부스터: 세게 밀어 줌
    if (this.slingT > 0 && f > 5 && f < maxSpeed && this.thr > 0.3) f = Math.min(maxSpeed, f + (DR.slingAccel ?? 6) * dt); // 슬링샷: 앞차 옆으로 튀어 나감
    // 깔끔한 드리프트 탈출: 드리프트로 잃은 속도 일부를 0.3초쯤에 걸쳐 돌려받음 (부스트 아님: 최고 속도를 넘지 않음)
    if (this.exitRefund > 0) {
      const a = Math.min(this.exitRefund, (cfg.drift.exitRate ?? 16) * dt);
      this.exitRefund -= a;
      if (f > 0 && f < maxSpeed) f = Math.min(maxSpeed, f + a);
    }
    if (f > maxSpeed) f = THREE.MathUtils.lerp(f, maxSpeed, 1 - Math.exp(-(flyGround ? 5 : 2.5) * dt));
    if (offK > 0) f -= f * cfg.offroad.drag * offK * (this.runoff ? 0.3 : 1) * dt;
    // 일반 경사(자석 도로 아님)에서는 오르막에서 느려지고 내리막에서 빨라짐
    if (!this.magnet) f -= cfg.gravity * this.gravityScale() * this.moveDirTo(_md).y * 0.5 * dt;

    // 드리프트 시작 / 종료
    if (!this.drifting && c.drift && this.mode !== 'fly' && Math.abs(c.steer) > 0.3 && f > cfg.drift.minSpeed && !(this.hitT > 0)) {
      this.drifting = true;
      this.driftDir = Math.sign(c.steer);
      this.driftTime = 0;
      this.driftLevel = 0;
      this.driftHold = this.driftLoss = this.exitRefund = 0;
      this.events.push('driftStart');
      if (this.up.y > 0.9) {
        // 평지에서는 살짝 점프하며 드리프트 진입
        this.speed = f;
        this.leaveGround(this.moveDir.multiplyScalar(f).addScaledVector(this.up, 4));
        return;
      }
    }
    if (this.drifting && (!c.drift || f < cfg.drift.minSpeed * 0.6)) this.endDrift(f >= cfg.drift.minSpeed * 0.6, !c.drift);

    // 방향 전환
    const speedK = THREE.MathUtils.clamp(Math.abs(f) / 8, 0, 1);
    const vNow = Math.abs(f);
    // 빠를수록 핸들이 덜 먹음: 끝까지 꺾어도 옆 가속이 steerLat을 넘지 않음 (150 km/h에서 느릴 때의 약 절반)
    // 다운포스가 붙는 고속에서는 조금 더 돌 수 있고(steerLatDownforce), 브레이크로 앞이 눌리면 더 잘 돌고
    // 가속으로 앞이 들리면 덜 돎(steerLatLoad) → "천천히 들어가서 빨리 나오기", 코너 진입 때 브레이크를 살짝 남기기
    // 경사(뱅크) 코너 (2026-11-09): 도로가 도는 쪽으로 기울어 있으면 중력의 도로 방향 성분이 차를 안쪽으로 눌러 줌
    //   → 그만큼 옆 한계(m/s²)가 늘어남. 반대로 기울면 줄어듦 (자석 도로·벽은 제외)
    let bankLat = 0;
    if (cfg.bankGrip && !this.magnet && this.up.y > 0.8 && this.up.y < 0.9995) {
      const downSlopeRight = this.up.y * this.up.dot(this.right) - this.right.y; // 도로 면을 따라 내려가는 방향의 오른쪽 성분 (= sin 기울기, 오른쪽이 낮으면 +)
      const dir = Math.sign(this.steerIn * (f || 1)) || Math.sign(this.yawRate);
      bankLat = 9.81 * downSlopeRight * dir * cfg.bankGrip;
    }
    const latCap = Math.max(0.5 * cfg.steerLat, cfg.steerLat * (1 + (cfg.steerLatDownforce || 0) * df) * (1 - (cfg.steerLatLoad || 0) * this.load) + bankLat);
    const highK = Math.min(1, latCap / (cfg.steerRate * Math.max(1, vNow)));
    const fastK = THREE.MathUtils.clamp(vNow / cfg.maxSpeed, 0, 1);
    const lat = Math.max(0.5 * tire.lateral, tire.lateral * (1 + df) * surfGrip + bankLat * surfGrip); // 코너링 한계 (m/s², 경사 포함)
    let turn;
    this.understeer = 0;
    if (this.drifting) {
      turn = this.driftDir * (cfg.drift.baseTurn + c.steer * this.driftDir * cfg.drift.steerTurn);
      // 드리프트도 아주 빠르면 덜 돎 (그래도 그냥 꺾는 것보다는 많이 돎)
      turn *= Math.min(1, cfg.drift.highSpeedLat / (Math.max(1, vNow) * (cfg.drift.baseTurn + cfg.drift.steerTurn * 0.5)));
      this.yawRate = turn;
      // 드리프트 각도 창: holdAngle [최소, 최대] rad 안에서 버티면 드리프트가 쌓임 (레벨·탈출 보상)
      //   안쪽으로 꺾으면 각도↑, 카운터(반대로 꺾기)면 각도↓, 뒷바퀴 굴림은 액셀을 밟을수록 각도↑ / 떼면↓ (앞바퀴 굴림은 반대: 밟으면 펴짐)
      const win = cfg.drift.holdAngle || [0.28, 0.75];
      const ang = this.slip * this.driftDir;
      this.driftAngle = ang;
      const inWin = ang >= win[0] && ang <= win[1];
      if (inWin) this.driftHold += dt;
      this.driftTime += dt * (inWin ? 1 : 0.35);
      const lvl = this.driftTime > cfg.drift.level2Time ? 2 : this.driftTime > cfg.drift.level1Time ? 1 : 0;
      if (lvl > this.driftLevel) this.events.push('driftLevel');
      this.driftLevel = lvl;
    } else {
      let want = this.steerIn * cfg.steerRate * speedK * highK * Math.sign(f || 1);
      // 앞바퀴 한계: 무게가 뒤로 쏠리면(가속 중) 앞이 가벼워져 덜 돎 → 언더스티어
      //   앞바퀴 굴림(fwd)은 헛돌면 앞이 더 밀림 (frontSpinK)
      //   앞바퀴 굴림은 코너에서 힘을 많이 쓰면 앞이 옆으로 덜 버팀 (tire.powerPush, 토크 언더스티어)
      const powerPush = (tire.powerPush ?? 0.25) * frontSpinK * powerUse * powerUse;
      const yawMax = vNow > 2 ? (lat * (1 - tire.loadShift * this.load) * (1 - tire.wheelspinSlide * frontSpinK * this.wheelspin) * (1 - powerPush)) / vNow : Infinity;
      if (Math.abs(want) > yawMax) {
        this.understeer = Math.min(1, (1 - yawMax / Math.abs(want)) * 1.6);
        want = Math.sign(want) * yawMax;
      }
      // 차체는 무게가 있어서 회전도 서서히 붙음
      // 빠를수록 차체가 묵직하게 늦게 돎
      const yawResp = tire.yawResponse * (1 - (tire.yawResponseHighSpeed || 0) * fastK);
      this.yawRate = THREE.MathUtils.lerp(this.yawRate, want, 1 - Math.exp(-yawResp * dt));
      turn = this.yawRate;
    }
    let dYaw = -turn * dt;
    // 벽 위에서는 중력 때문에 진행 방향이 점점 아래로 휨 (천장에서는 중력이 수직이라 영향 없음)
    if (this.magnet && this.up.y < 0.9 && f > 5 && !spike) {
      const gT = DOWN.clone().addScaledVector(this.up, -DOWN.dot(this.up)); // 벽면을 따라 아래로
      const side = gT.dot(this.right);
      dYaw -= (cfg.wallGravity * side / f) * dt;
    }
    // 연석 위: 빠를수록 차가 살짝 들썩이며 방향이 미세하게 흔들림
    if (this.kerbK > 0 && vNow > 8 && cfg.kerb) dYaw += (Math.random() - 0.5) * cfg.kerb.jitter * this.kerbK * Math.min(1, vNow / 30) * dt;
    this.fwd.applyAxisAngle(this.up, dYaw);
    this.slip -= dYaw; // 차는 돌았지만 이동 방향은 그대로 → 미끄러짐

    // 접지력: 이동 방향이 차 방향을 따라잡음
    if (this.drifting) {
      const D = cfg.drift;
      const thrA = drv === 'fwd' ? -(D.fwdThrottleAngle ?? 0.3) : (D.throttleAngle ?? 0.35) * (drv === 'awd' ? 0.6 : 1);
      this.slip *= Math.exp(-D.grip * (1 - thrA * (this.thr - 0.5) * 2) * dt);
      // 너무 많이 돌아감 → 스핀: 드리프트가 끊기고 속도 손해
      if (this.slip * this.driftDir > (D.spinAngle ?? 1.1)) {
        f *= 1 - (D.spinLoss ?? 0.15);
        this.endDrift(false, false, true);
      }
    } else {
      let grip = cfg.grip * (1 - 0.4 * offK);
      if (spike) grip *= cfg.booster.gripFactor;
      const natural = this.slip * (1 - Math.exp(-grip * dt));
      // 뒷바퀴 한계: 브레이크로 앞에 쏠리거나, 바퀴가 헛돌면 뒤가 약해짐
      //   + 파워 오버스티어: 뒷바퀴 굴림이 코너에서 힘을 많이 쓰면(powerUse) 뒤가 옆으로 덜 버팀 (tire.powerSlide)
      //   + 리프트오프 오버스티어: 코너에서 액셀을 확 떼면 잠깐 뒤가 가벼워짐 (tire.liftOff)
      const powerSlide = (tire.powerSlide ?? 0.3) * rearSpinK * powerUse * powerUse;
      const rearCap = lat * tire.rearGrip * (1 + tire.loadShift * this.load) * (1 - tire.wheelspinSlide * rearSpinK * this.wheelspin) * (1 - (tire.capShare ?? 0.5) * Math.min(0.6, powerSlide + (tire.liftOff ?? 0.4) * this.liftOff));
      const capStep = vNow > 2 ? (rearCap / vNow) * dt : Infinity;
      if (Math.abs(natural) > capStep) {
        // 뒤가 버티지 못함 → 꼬리가 바깥으로 돌아 차가 더 돌아감 (오버스티어)
        const sgn = Math.sign(this.slip);
        this.slip -= sgn * capStep;
        // swingFade [a, b]: 미끄러짐이 a rad를 넘으면 꼬리가 돌아가는 힘이 줄어 b rad에서 0
        //   (예전엔 미끄러짐이 클수록 더 세게 돌아서, 크게 미끄러지면 스스로 멈추지 못하고 계속 돌았음)
        const sf = tire.swingFade;
        const fade = this.hitT > 0 ? 0 : sf ? THREE.MathUtils.clamp((sf[1] - Math.abs(this.slip)) / (sf[1] - sf[0]), 0, 1) : 1;
        const swing = -sgn * (Math.abs(natural) - capStep) * tire.rearSwing * fade;
        this.fwd.applyAxisAngle(this.up, swing);
        this.slip -= swing;
      } else this.slip -= natural;
      // 리프트오프·파워 오버스티어가 눈에 보이게: 뒤가 가벼워진 만큼 꼬리가 바깥으로 돌아 차 머리가 안쪽으로 더 돎
      //   (뒤 접지 한계는 여유가 커서 한계만 줄여서는 거의 안 느껴졌음). 세기 = 도는 속도 × (리프트오프 + 파워) × tire.tuck
      //   → 액셀을 확 떼거나 낮은 단에서 꽉 밟으면 꼬리가 살짝 흐르고 '끼익', 카운터로 잡거나 페달을 부드럽게 쓰면 안 흐름
      if (!(this.hitT > 0) && vNow > 6) {
        // 꼬리가 도는 건 미끄러짐이 tuckMax rad가 될 때까지만 (그 위로는 줄어듦) → 살짝 흐르고 스스로 잡힘, 계속 돌지는 않음
        //   리프트오프는 liftTuck배, tuckMax와 0.2 rad 중 작은 쪽까지 (크게 흐르면 봇·키보드가 못 잡음), 파워는 tuck배, tuckMax까지
        const liftK = Math.min(0.6, (tire.liftOff ?? 0.4) * this.liftOff);
        const sNow = this.slip * Math.sign(this.yawRate);
        const room = (m) => THREE.MathUtils.clamp((m - sNow) / (0.5 * m), 0, 1);
        const tm = tire.tuckMax ?? 0.2;
        const tuck = (liftK * (tire.liftTuck ?? 1.4) * room(Math.min(tm, 0.2)) + Math.min(0.55, powerSlide) * (tire.tuck ?? 1.4) * room(tm)) * this.yawRate;
        if (tuck) {
          const sw = -tuck * dt;
          this.fwd.applyAxisAngle(this.up, sw);
          this.slip -= sw;
        }
      }
      this.slip = THREE.MathUtils.clamp(this.slip, -1.3, 1.3);
    }
    this.sliding = this.drifting ? 0 : THREE.MathUtils.clamp((Math.abs(this.slip) - 0.12) / 0.35, 0, 1);
    {
      // 옆으로 미끄러지면 느려짐. 드리프트 중 좋은 각도 창 안이면 덜 느려짐 (drift.holdDrag)
      const D = cfg.drift, win = D.holdAngle || [0.28, 0.75];
      const inWin = this.drifting && this.driftAngle >= win[0] && this.driftAngle <= win[1];
      const lost = f * Math.abs(Math.sin(this.slip)) * D.slipDrag * (inWin ? D.holdDrag ?? 0.7 : 1) * dt;
      f -= lost;
      if (this.drifting) this.driftLoss += Math.abs(lost);
    }
    // 타이어 소리 크기 (0~1): 가장 심한 것 하나. 잔디 위에서는 비명 대신 흙 소리(offroadFx)라 줄임
    {
      const dAng = this.drifting ? THREE.MathUtils.clamp(0.45 + Math.abs(this.slip) * 0.7, 0, 1) : 0;
      const sl = Math.max(this.sliding * 0.95, this.understeer * 0.6, this.wheelspin * 0.85, brakeOver * 0.7, dAng, this.liftOff * 0.5);
      this.tyreSlip = sl * (1 - 0.85 * offK) * Math.min(1, vNow / 6) * (this.magnet ? 0.6 : 1);
    }
    this.speed = f;
    } // motion

    // 부딪힌 뒤: 차 방향을 진행 방향 쪽으로 남은 만큼 부드럽게 돌림 (진행 방향은 그대로, 미끄러짐만 줄어듦)
    if (this.hitTurn) {
      let d = Math.abs(this.hitTurn) < 1e-3 ? this.hitTurn : this.hitTurn * (1 - Math.exp(-(cfg.impact?.alignRate ?? 20) * dt));
      if (Math.sign(d) !== Math.sign(this.slip)) d = this.hitTurn = 0; // 그사이 미끄러짐이 이미 반대로 바뀜 → 그만
      else if (Math.abs(d) > Math.abs(this.slip)) (d = this.slip), (this.hitTurn = d); // 진행 방향을 넘어 돌지 않게
      this.fwd.applyAxisAngle(this.up, d);
      this.slip -= d;
      this.hitTurn -= d;
    }

    // --- 이동: 앞에 벽이 있는지 확인 ---
    let move = this.moveDirTo(_mv).multiplyScalar(f * dt);
    const dist = move.length();
    if (dist > 1e-6) {
      const origin = _org.copy(this.pos).addScaledVector(this.up, 0.6);
      const wall = this.track.castRay(origin, _dir.copy(move).divideScalar(dist), dist + 2.0);
      if (wall && wall.normal.dot(this.up) < 0.5) {
        // 너무 가파른 면 = 벽. 벽을 따라 미끄러지며 살짝 튕김
        const v = this.moveDir.multiplyScalar(f);
        const vn = v.dot(wall.normal);
        if (vn < 0) {
          v.addScaledVector(wall.normal, -vn * 1.25);
          if (vn < -8) this.events.push('bump');
          if (this.drifting) this.endDrift(false);
          this.setVelocityOnSurface(v);
          this.afterImpact(vn);
          move = this.moveDirTo(_mv).multiplyScalar(this.speed * dt);
        }
      }
    }
    const newPos = _np.copy(this.pos).add(move);

    // --- 바닥 찾기 (차 기준 아래 방향으로) ---
    const sticky = this.magnet;
    const probeUp = 1.5;
    const probeDown = sticky ? 2.5 : 0.7;
    const hit = this.track.castRay(_probe.copy(newPos).addScaledVector(this.up, probeUp), _down.copy(this.up).negate(), probeUp + probeDown);
    if (!hit) {
      // 바닥 끝(점프대 끝, 벽 끝)을 벗어남 → 공중으로
      this.pos.copy(newPos);
      this.leaveGround(this.moveDir.multiplyScalar(this.speed));
      return;
    }
    const h = (hit.point.x - newPos.x) * this.up.x + (hit.point.y - newPos.y) * this.up.y + (hit.point.z - newPos.z) * this.up.z;
    if (h > cfg.stepHeight) {
      // 너무 높은 턱 → 못 올라감
      this.speed *= -0.3;
      this.events.push('bump');
      return;
    }
    this.pos.copy(hit.point);
    this.alignTo(hit.normal);
    this.surface = hit.surface;
    this.magnet = hit.surface === 'magnet';
    const nowSticky = this.magnet;

    // 벽/천장에 붙어 있으려면 자석 도로 + 최소 속도가 필요
    if (this.up.y < 0.35 && (!nowSticky || Math.abs(this.speed) < cfg.wallMinSpeed)) {
      this.leaveGround(this.moveDir.multiplyScalar(this.speed).addScaledVector(this.up, 2));
      this.events.push('fall');
      return;
    }

    // 노면 효과
    const edge = this.surface === 'ground' && this.track.edgeInfo ? this.track.edgeInfo(this.pos, this.trackInfo) : null;
    if (this.surface === 'water') (this.offK = 1), (this.kerbK = 0), (this.runoff = false);
    else if (edge) (this.offK = edge.off), (this.kerbK = edge.kerb), (this.runoff = edge.runoff);
    else (this.offK = this.surface === 'ground' && !this.track.isOnRoad(this.pos, this.trackInfo) ? 1 : 0), (this.kerbK = 0), (this.runoff = false);
    if (this.magnet) (this.offK = 0), (this.kerbK = 0);
    this.offroad = this.offK > 0.5 && !this.runoff;
    this.checkApex();
    this.checkCorner();
    // 물에 닿으면 자동으로 배 모드 (물에서 나오면 원래 모드로 돌아감)
    if (this.surface === 'water' && this.mode !== 'boat' && this.cfg.modes.boat.autoSwitch) {
      this.autoBoatFrom = this.mode;
      this.setMode('boat');
      this.events.push('autoBoat');
    } else if (this.surface !== 'water' && this.autoBoatFrom && this.mode === 'boat') {
      this.setMode(this.autoBoatFrom);
      this.autoBoatFrom = null;
    }
    if (this.mode !== 'boat') this.autoBoatFrom = null; // 직접 다른 모드를 고르면 자동 복귀 취소
    if (this.surface !== 'water') this.surgeT = this.boatCarve = 0; // 물살 가속·카빙은 물 위에서만
    // 활주로(그랑프리 비행 루트)에 들어서면 자동으로 비행 모드, 내려앉아 활주로 밖이면 원래 모드로
    if (this.track.runway && cfg.modes.fly.autoSwitch) {
      const zone = (this.rwZoneLast = this.runwayZone());
      if (zone === 2 && this.mode !== 'fly' && this.mode !== 'boat') {
        this.autoFlyFrom = this.mode;
        this.setMode('fly');
        this.events.push('autoFly');
      }
      // 비행 구역(활주로 → 고리 → 착륙장) 밖의 땅이면 바로 원래 모드로 (다시 이륙해서 끝까지 날아가는 것 막기)
      if (this.mode === 'fly' && zone === 0 && !this.flightAllowed()) {
        this.setMode(this.autoFlyFrom || 'normal');
        this.autoFlyFrom = null;
      }
      // 활주로 가장자리에서 잠깐 벗어난 것으로는 돌아가지 않게, 0.5초 이상 활주로 밖에서 땅을 달릴 때 원래 모드로
      this.offRunway = zone === 0 && !this.flying ? (this.offRunway || 0) + dt : 0;
      if (this.offRunway > 0.5 && this.autoFlyFrom && this.mode === 'fly') {
        this.setMode(this.autoFlyFrom);
        this.autoFlyFrom = null;
      }
    }
    if (this.mode !== 'fly') this.autoFlyFrom = null;
    // 땅 위: 일반 ↔ 가속 모드를 속도로 자동 전환 (오르는 기준 150, 내리는 기준 135 km/h로 달리해서 들락날락하지 않게)
    //   올라갈 때는 핸들이 거의 곧을 때만 (코너 한가운데서 힘이 갑자기 세지면 밀려 나감)
    //   내려갈 때는 속도만 봄 (예전엔 크게 꺾어도 내려가서 코너마다 1초 간격으로 바뀌었음), 바뀐 뒤 autoHold초는 그대로 유지
    const A = cfg.modes.accel;
    if (this.modeHold > 0) this.modeHold -= dt;
    if (A && A.autoSpeed && this.grounded && !this.autoBoatFrom && !this.autoFlyFrom && (this.mode === 'normal' || this.mode === 'accel') && !(this.modeHold > 0)) {
      const kmh = Math.abs(this.speed) * 3.6;
      const steer = Math.abs(this.steerIn || 0);
      if (this.mode === 'normal' && kmh >= A.autoSpeed && steer < (A.autoSteerMax ?? 0.2)) {
        this.setMode('accel', true);
        this.modeHold = A.autoHold ?? 1.5;
        this.events.push('autoAccel');
      } else if (this.mode === 'accel' && kmh < (A.autoSpeedOff ?? A.autoSpeed - 15)) {
        this.setMode('normal', true);
        this.modeHold = A.autoHold ?? 1.5;
        this.events.push('autoNormal');
      }
    }
    // 물: 배 모드가 아니면 가라앉다가 복귀 (autoSwitch를 끄면)
    if (this.surface === 'water' && this.mode !== 'boat') {
      if (this.sink === 0) this.events.push('splash');
      this.sink = Math.min(1, this.sink + dt / cfg.modes.boat.sinkTime);
      this.speed *= Math.exp(-2.5 * dt);
      if (this.sink >= 1) {
        this.events.push('sink');
        this.respawn();
        return;
      }
    } else this.sink = Math.max(0, this.sink - dt * 3);
    if (this.surface === 'lava' && !spike) {
      this.events.push('lava');
      this.respawn();
      return;
    }
    // 테스트 맵: 평지에 서 있으면 0.5초마다 복귀 지점 기록
    if (this.track.arena && this.up.y > 0.95 && this.surface === 'ground' && this.safeSpots) {
      this.safeClock -= dt;
      if (this.safeClock <= 0) {
        this.safeClock = 0.5;
        this.safeSpots.push({ x: this.pos.x, z: this.pos.z, yaw: this.yaw });
        if (this.safeSpots.length > 6) this.safeSpots.shift();
      }
    }
    // 복귀 지점은 본 도로 위에서만 기록 (지름길 위에서는 t가 정확하지 않음)
    if (this.up.y > 0.95 && this.trackInfo.dist < this.track.width / 2 + 1.6 && this.surface !== 'lava' && this.surface !== 'water' && this.surface !== 'ramp') this.lastSafeT = this.trackInfo.t;
    // 부스트 패드: 올라선 순간에만 발동 (S로 브레이크를 밟고 있으면 발동 안 함)
    const pad = this.track.boostPadAt(this.pos);
    const braking = this.brk > 0.2 && (this.cfg.booster.cancelOnBrake ?? true);
    if (pad && !this.wasOnPad && !braking) this.startBoost(pad.duration, 1.15);
    this.wasOnPad = !!pad;

    this.moveDirTo(this.vel).multiplyScalar(this.speed);
  }

  /**
   * 에이펙스: 코너 안쪽 끝(레이싱 라인이 연석에 붙는 곳)을 빠르게 스치면 성공.
   * 에이펙스 앞뒤 구간을 지나는 동안 가장 안쪽으로 붙은 거리와 속도를 기억했다가, 구간을 벗어날 때 판정
   */
  checkApex() {
    const line = this.track.racingLine, k = this.cfg.kerb;
    if (!line || !k || !this.trackInfo) return;
    if (!line.apexIndex) {
      // 지점 번호 → 에이펙스 (앞뒤 apexWindow m 안)
      line.apexIndex = new Int16Array(line.N).fill(-1);
      const w = Math.max(2, Math.round((k.apexWindow / this.track.length) * line.N));
      line.apexes.forEach((ap, n) => {
        for (let j = -w; j <= w; j++) line.apexIndex[(ap.i + j + line.N) % line.N] = n;
      });
    }
    const n = this.trackInfo.index < line.N ? line.apexIndex[this.trackInfo.index] : -1;
    const w = this.apexWatch;
    if (w && w.n !== n) {
      // 구간을 벗어남 → 판정
      const ap = line.apexes[w.n];
      const need = this.lineSpeed(ap.i);
      if (w.skip) {
        // 비행 모드로 지나감 (활주로 루트 등) → 판정 안 함, 연속 기록도 유지
        this.apexWatch = null;
        return;
      }
      const hwAp = this.track.halfWidthAt ? this.track.halfWidthAt(ap.i) : this.track.width / 2; // 도로 폭이 구간마다 다른 맵 (화산)
      const inside = w.best >= hwAp - k.apexReach; // 차 중심이 도로 끝에서 apexReach m 안 (안쪽 바퀴가 연석 위)
      const fast = w.speed >= need * k.apexSpeedRatio;
      if (inside && fast && w.n !== this.lastApexN) {
        const perfect = w.speed >= need * 0.97;
        this.apexCombo++;
        this.speed += perfect ? k.apexKick * 1.5 : k.apexKick;
        this.lastApexInfo = { perfect, combo: this.apexCombo };
        this.events.push(perfect ? 'apexPerfect' : 'apex');
        this.apexHits.add(w.n);
        this.lastApexN = w.n;
      } else if (w.n !== this.lastApexN) {
        if (this.apexCombo > 0 && inside === false) this.events.push('apexMiss');
        this.apexCombo = 0;
        this.lastApexN = w.n;
      }
      this.apexWatch = null;
    }
    if (n >= 0 && this.grounded) {
      const ap = line.apexes[n];
      const lat = this.trackInfo.lateral * ap.side; // + = 안쪽
      if (!this.apexWatch) this.apexWatch = { n, best: -Infinity, speed: 0, skip: false };
      if (this.mode === 'fly') this.apexWatch.skip = true;
      if (lat > this.apexWatch.best) {
        this.apexWatch.best = lat;
        this.apexWatch.speed = Math.abs(this.speed);
      }
    }
  }

  resetCornerState() {
    this.cornerPrevIdx = null;
    this.cornerStart.clear();
    this.apexHits.clear();
    this.cornerChain = 0;
    this.chainLastK = -1;
    this.exitStat = null;
  }

  /** 코너 정보 (cornerInfo.js). 처음 부를 때 계산 */
  get cornerInfo() {
    const line = this.track.racingLine;
    if (!line) return null;
    if (!this._cornerInfo) {
      this.lineSpeed(0);
      this._cornerInfo = analyzeCorners(line, this._lineProfile, this.track.length, { linkGap: this.cfg.corner?.linkGap });
    }
    return this._cornerInfo;
  }

  /**
   * 코너 탈출 판정: 코너의 탈출 지점을 지날 때
   *   좋은 탈출 = 라인에서 exitTol m 안 + 계획 속도의 exitSpeedRatio 이상 + 잔디 아님
   *   깔끔한 코너 = 에이펙스 성공 + 좋은 탈출 → 작은 가속 보너스(exitKick)
   *   연계 = 이어진 코너(cornerInfo의 linkedPrev)를 연달아 깔끔하게 → 보너스가 chainKick씩 커짐 (chainMax번까지)
   * 들어간 시각(startI)부터 탈출까지 걸린 시간도 재서 lastCornerInfo.time에 넣음 (HUD에서 내 기록과 비교)
   */
  checkCorner() {
    const k = this.cfg.corner;
    if (!k || !k.enabled || !this.trackInfo) return;
    const ci = this.cornerInfo;
    if (!ci || !ci.corners.length) return;
    const N = ci.N, idx = this.trackInfo.index % N;
    const prev = this.cornerPrevIdx;
    this.cornerPrevIdx = idx;
    if (prev == null) return;
    const d = (idx - prev + N) % N;
    if (d === 0 || d > 40) return; // 뒤로 가거나 순간이동(복귀)은 무시
    // 탈출 구간(마지막 에이펙스 ~ 탈출 지점): 브레이크를 밟았는지, 액셀을 얼마나 밟았는지
    // (속도 계획도 감속하는 곳 = 바로 다음 코너 브레이크 구간은 빼고 봄)
    const z = ci.exitZone[idx];
    if (z >= 0 && !this._lineProfile.brake[idx]) {
      const ez = this.exitStat && this.exitStat.k === z ? this.exitStat : (this.exitStat = { k: z, thr: 0, n: 0, brk: 0 });
      ez.thr += this.thr;
      ez.n++;
      ez.brk = Math.max(ez.brk, this.brk);
    }
    for (let s = 1; s <= d; s++) {
      const q = (prev + s) % N;
      const st = ci.startAt.get(q);
      if (st) this.cornerStart.set(st.k, this.simT);
      const c = ci.exitAt.get(q);
      if (c) this.judgeCorner(c, q);
    }
  }

  judgeCorner(c, q) {
    const k = this.cfg.corner, line = this.track.racingLine, ci = this._cornerInfo;
    const t0 = this.cornerStart.get(c.k);
    this.cornerStart.delete(c.k);
    const time = t0 != null && this.simT - t0 < 40 ? this.simT - t0 : null;
    const apexHit = c.apexes.some((a) => this.apexHits.has(a.n));
    for (const a of c.apexes) this.apexHits.delete(a.n);
    const ez = this.exitStat && this.exitStat.k === c.k ? this.exitStat : null;
    this.exitStat = null;
    // 코너 들어가는 걸 못 봤거나(복귀·출발 직후) 비행·배 모드로 지나가면 판정 안 함 (연계 기록은 그대로)
    if (t0 == null || this.mode === 'fly' || this.mode === 'boat' || !this.grounded) return;
    const latErr = Math.abs(this.trackInfo.lateral - line.offset[q]);
    const ratio = Math.abs(this.speed) / Math.max(1, this.lineSpeed(q));
    // 좋은 탈출 = 라인대로 바깥까지 쓰며 나옴 + 에이펙스 뒤로 브레이크 없이 액셀을 밟음 + 속도가 너무 느리지 않음
    const thrAvg = ez && ez.n ? ez.thr / ez.n : 1;
    const noBrake = !ez || ez.brk < 0.3; // 살짝 대는 정도(0.3 미만)는 봐줌
    const goodExit = latErr <= k.exitTol && noBrake && thrAvg >= k.exitThrottle && ratio >= k.exitSpeedRatio && this.offK < 0.5;
    const clean = apexHit && goodExit;
    const nc = ci.corners.length;
    let chain = 0, bonus = 0;
    const broke = !clean && this.cornerChain >= 2;
    if (clean) {
      chain = c.linkedPrev && this.chainLastK === (c.k - 1 + nc) % nc ? this.cornerChain + 1 : 1;
      this.cornerChain = chain;
      this.chainLastK = c.k;
      bonus = k.exitKick + k.chainKick * Math.min(chain - 1, k.chainMax);
    } else {
      this.cornerChain = 0;
      this.chainLastK = -1;
      if (goodExit) bonus = k.exitKick * 0.5;
    }
    if (bonus > 0 && this.speed > 0) this.speed += bonus;
    const next = ci.corners[(c.k + 1) % nc];
    this.lastCornerInfo = { num: c.num, k: c.k, clean, goodExit, apexHit, chain, broke, bonus, latErr, ratio, thrAvg, noBrake, time, nextLinked: next.linkedPrev, nextNum: next.num };
    this.events.push('corner');
  }

  /** 레이싱 라인 지점 i에서 이 차로 낼 수 있는 속도 (m/s). 처음 부를 때 계산 */
  lineSpeed(i) {
    const line = this.track.racingLine;
    if (!line) return this.cfg.maxSpeed;
    if (!this._lineProfile) this._lineProfile = line.profile(lineCarModel(this.cfg));
    return this._lineProfile.speed[i];
  }

  /** 배 모드로 물 위: 프로펠러 추진 + 물 저항, 키(방향타)로 돌고 옆으로 잘 미끄러짐 */
  boatMotion(dt, c) {
    const cfg = this.cfg, b = cfg.modes.boat, e = cfg.engine;
    let f = this.speed;
    const boosting = this.boostTime > 0;
    let maxF = b.maxSpeed * (boosting ? cfg.boost.speedFactor : 1);
    let thrust = b.thrust;
    const IT = cfg.items || {};
    if (this.itemBoostT > 0) (maxF *= IT.boostTop ?? 1.22), (thrust += IT.boostAccel ?? 16); // 아이템 부스터 (물 위)
    if (this.itemSlowT > 0) maxF *= IT.shockTop ?? 0.75;
    // 물살 가속 (부표 게이트·급류): 잠깐 최고 속도·추진력이 올라감
    const SG = b.surge;
    if (this.surgeT > 0 && SG) {
      this.surgeT -= dt;
      const k = this.surgeK * Math.min(1, this.surgeT / 0.4 + 0.25); // 끝날 때 부드럽게
      maxF *= 1 + SG.speed * k;
      thrust += SG.thrust * k;
      if (this.thr <= 0) f += SG.thrust * 0.5 * k * dt; // 페달을 떼도 물살이 조금 밀어 줌
    } else this.surgeT = 0;
    // 추진: W 앞으로, S 브레이크 → 멈추면 뒤로
    if (this.thr > 0 && f > -0.5) f += this.thr * thrust * dt;
    if (this.brk > 0) {
      if (f > 0.5) f -= b.brake * this.brk * dt;
      else if (f > -b.maxReverse) f -= b.reverse * this.brk * dt;
    }
    if (boosting && f < maxF) f = Math.min(maxF, f + cfg.boost.accel * dt);
    // 물 저항 (속도² + 기본)
    const dec = b.drag * f * f + b.rolling;
    f = Math.sign(f) * Math.max(0, Math.abs(f) - dec * dt);
    if (f > maxF) f = THREE.MathUtils.lerp(f, maxF, 1 - Math.exp(-2 * dt));
    const v = Math.abs(f);

    // 카빙 (2026-11-10): 드리프트 키 + 핸들 → 물을 깎으며 확 돎 (대신 속도를 조금 잃고 옆으로 더 미끄러짐)
    const CV = b.carve;
    const carving = !!(CV && c && c.drift && v > CV.minSpeed && Math.abs(this.steerIn) > 0.25 && f > 0);
    if (carving && this.boatCarve < 0.05) this.events.push('boatCarve');
    this.boatCarve = THREE.MathUtils.lerp(this.boatCarve || 0, carving ? 1 : 0, 1 - Math.exp(-(carving ? 7 : 4) * dt));
    const cv = CV ? this.boatCarve : 0;
    // 방향타: 움직일 때만 돌고, 빠를수록 조금 덜 돎
    const rudder = THREE.MathUtils.clamp(v / 6, 0, 1) * (1 - 0.35 * Math.min(1, v / b.maxSpeed));
    const want = this.steerIn * b.turnRate * rudder * Math.sign(f || 1) * (1 + ((CV ? CV.turn : 1) - 1) * cv);
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, want, 1 - Math.exp(-((b.yawResponse ?? 4) + 3 * cv) * dt));
    const dYaw = -this.yawRate * dt;
    this.fwd.applyAxisAngle(this.up, dYaw);
    this.slip -= dYaw; // 배는 옆으로 잘 미끄러짐 (천천히 진행 방향을 따라감)
    this.slip *= Math.exp(-b.grip * (1 + ((CV ? CV.grip : 1) - 1) * cv) * dt);
    this.slip = THREE.MathUtils.clamp(this.slip, -1.2, 1.2);
    f -= f * Math.abs(Math.sin(this.slip)) * 0.8 * dt;
    if (cv > 0) f -= f * CV.drag * cv * dt;
    if (this.drifting) this.endDrift(false);

    // 엔진: 프로펠러 부하라 속도보다 가속 페달을 더 따라감
    this.gear = f < -0.5 ? -1 : 1;
    const target = e.idleRpm + (e.redline - e.idleRpm) * THREE.MathUtils.clamp(0.45 * this.thr + 0.55 * (v / b.maxSpeed), 0, 1);
    this.rpm = THREE.MathUtils.lerp(this.rpm, target, 1 - Math.exp(-5 * dt));
    this.limiter = false;
    this.wheelspin = this.understeer = 0;
    this.sliding = THREE.MathUtils.clamp((Math.abs(this.slip) - 0.25) / 0.4, 0, 1);
    this.load = THREE.MathUtils.lerp(this.load, this.thr * 0.6 + (this.surgeT > 0 ? 0.3 : 0), 1 - Math.exp(-3 * dt)); // 뱃머리가 들림
    this.speed = f;
  }

  /**
   * 활주로 위치: 0 = 활주로 밖, 1 = 활주로 위 (아직 도로와 겹친 곳),
   * 2 = 도로에서 활주로 쪽으로 갈라져 활주로 방향으로 달리는 중 (여기서 자동으로 비행 모드)
   */
  runwayZone() {
    const rw = this.track.runway;
    const s0 = rw.samples[0];
    const dx = this.pos.x - s0.pos.x, dz = this.pos.z - s0.pos.z;
    const d = dx * s0.tan.x + dz * s0.tan.z;
    const lat = dx * s0.right.x + dz * s0.right.z;
    if (d < 0 || d > rw.end.dist + 3 || Math.abs(lat) > rw.half + 2 || Math.abs(this.pos.y - s0.pos.y) > 4) return 0;
    if (this.rwTrack !== this.track) {
      this.rwTrack = this.track;
      this.rwSide = Math.sign(this.track.nearest(rw.end.pos).lateral) || 1; // 활주로가 도로 어느 쪽으로 갈라지는지
    }
    const off = this.trackInfo.lateral * this.rwSide; // 도로 중심에서 활주로 쪽으로 얼마나 벗어났는지
    const along = this.fwd.x * s0.tan.x + this.fwd.z * s0.tan.z;
    return d > 16 && off > 2.2 && along > 0.85 ? 2 : 1;
  }

  /**
   * 여기서 날아도 되는지: 비행 구역 = 활주로 시작 → 고리들 → 착륙장 착지점을 잇는 선에서 옆으로 modes.fly.zoneRadius m 안
   *   (사용자 요청 2026-11-09: 비행 모드로 결승선까지 날아가는 게 사기 → 구역 밖에서는 무조건 땅으로)
   *   활주로가 없는 맵은 항상 true. 높이는 안 봄 (고리 사이에서 낮게 날아도 괜찮게)
   */
  flightAllowed() {
    const tr = this.track, R = this.cfg.modes.fly.zoneRadius;
    if (!tr.runway || !tr.skyPath || !tr.skyPath.length || !R) return true;
    const pts = (this._flyPts ||= [tr.runway.start.pos, ...tr.skyPath]);
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const u = THREE.MathUtils.clamp(((this.pos.x - a.x) * abx + (this.pos.z - a.z) * abz) / (abx * abx + abz * abz || 1), 0, 1);
      if (Math.hypot(this.pos.x - (a.x + abx * u), this.pos.z - (a.z + abz * u)) < R) return true;
    }
    return false;
  }

  /** 이 자리의 중력 배수 (1 = 보통, 0.3 = 달처럼 가벼움, 1.5 = 무거움). 맵의 track.gravityAt(pos)가 없으면 1 */
  gravityScale() {
    const g = this.track.gravityAt ? this.track.gravityAt(this.pos) : 1;
    return Number.isFinite(g) ? g : 1;
  }

  /** 땅에서 날아오름 */
  takeOff() {
    this.flying = true;
    this.pitch = 0.22;
    this.bank = 0;
    this.stallFall = 0;
    if (this.drifting) this.endDrift(false);
    this.leaveGround(this.moveDir.multiplyScalar(this.speed).addScaledVector(WORLD_UP, 4));
    this.events.push('takeoff');
  }

  /**
   * 비행 모드: 비행기처럼 날기 (글라이더가 아님)
   *   W 추력, S 공기 브레이크, A/D 날개를 기울여 선회, Space 기수 올림(상승), Shift 기수 내림(하강)
   *   너무 느리면 실속해서 기수가 떨어지며 추락, 너무 높이 오르면 더 못 올라감
   */
  updateFlight(dt, c) {
    const cfg = this.cfg, F = cfg.modes.fly, e = cfg.engine;
    this.airTime = 0; // 날고 있는 동안은 "공중에 너무 오래" 복귀 없음
    // 강제 착륙으로 더해 둔 아래 속도는 빼고 잼 (안 빼면 매 스텝 속도가 불어남)
    let s = this.forceSink ? Math.hypot(this.vel.x, this.vel.y + this.forceSink, this.vel.z) : this.vel.length();
    const boosting = this.boostTime > 0;
    const maxS = F.maxSpeed * (boosting ? cfg.boost.speedFactor : 1);
    // 속도: 추력 - 공기 저항 - 브레이크 - 오르막 손해(내리막이면 이득)
    s += (this.thr * F.thrust - F.drag * s * s - this.brk * F.brake - F.climbDecel * Math.sin(this.pitch)) * dt;
    if (boosting && s < maxS) s = Math.min(maxS, s + cfg.boost.accel * dt);
    if (s > maxS) s = THREE.MathUtils.lerp(s, maxS, 1 - Math.exp(-1.5 * dt));
    s = Math.max(0, s);

    // 선회: 날개를 기울인 만큼 돎
    this.bank = THREE.MathUtils.lerp(this.bank, this.steerIn * F.bankMax, 1 - Math.exp(-F.bankRate * dt));
    const turn = F.turnRate * (this.bank / F.bankMax) * THREE.MathUtils.clamp(s / F.minSpeed, 0.3, 1);
    let heading = Math.atan2(this.fwd.x, this.fwd.z) - turn * dt;

    // 비행 구역 밖: 강제 착륙 (Space 상승 무시, 기수를 내리고 속도를 줄이며 점점 더 빨리 내려감)
    const forced = !this.flightAllowed();
    if (forced && !this.forceLanding) this.events.push('forceLand');
    this.forceLanding = forced;
    this.forceSink = forced ? Math.min(F.forceSinkMax ?? 30, (this.forceSink || 0) + (F.forceSinkRate ?? 15) * dt) : 0;
    if (forced && s > F.takeoffSpeed) s = Math.max(F.takeoffSpeed, s - (F.forceBrake ?? F.brake) * dt); // 강제 착륙 감속 (forceBrake, 예전엔 brake 10으로 확 줄었음)
    // 기수: Space 위, Shift 아래, 둘 다 안 누르면 수평으로
    let pT = (c.climb && !forced ? F.pitchMax : 0) - (c.dive ? F.pitchMax : 0);
    if (forced) pT = Math.min(pT, -(F.forceDive ?? 0.5));
    const stall = s < F.minSpeed;
    if (stall) pT = Math.min(pT, -0.45); // 실속: 기수가 떨어짐
    if (this.pos.y > F.maxAltitude) pT = Math.min(pT, -0.15); // 너무 높음
    this.pitch = THREE.MathUtils.lerp(this.pitch, pT, 1 - Math.exp(-F.pitchRate * dt));
    this.stallFall = stall
      ? this.stallFall + F.stallFall * (1 - s / F.minSpeed) * dt
      : this.stallFall * Math.exp(-2 * dt);

    // 방향과 자세 (fwd에 기수 각도, up에 날개 기울기)
    const cp = Math.cos(this.pitch);
    this.fwd.set(Math.sin(heading) * cp, Math.sin(this.pitch), Math.cos(heading) * cp).normalize();
    const right0 = new THREE.Vector3().crossVectors(this.fwd, WORLD_UP).normalize();
    const up0 = new THREE.Vector3().crossVectors(right0, this.fwd).normalize();
    this.up.copy(up0).multiplyScalar(Math.cos(this.bank)).addScaledVector(right0, Math.sin(this.bank)).normalize();
    this.vel.copy(this.fwd).multiplyScalar(s);
    this.vel.y -= this.stallFall + (this.forceSink || 0);

    this.speed = s;
    this.slip = 0;
    this.gear = Math.min(this.cfg.gears.length, Math.max(1, Math.ceil((s / F.maxSpeed) * this.cfg.gears.length)));
    const target = e.idleRpm + (e.redline - e.idleRpm) * THREE.MathUtils.clamp(0.4 * this.thr + 0.6 * (s / F.maxSpeed), 0, 1);
    this.rpm = THREE.MathUtils.lerp(this.rpm, target, 1 - Math.exp(-5 * dt));
    this.limiter = false;
  }

  updateAir(dt, c) {
    const cfg = this.cfg;
    // 비행 모드: 충분히 빠르면(또는 이미 날고 있으면) 비행기처럼
    const F = cfg.modes.fly;
    if (this.mode === 'fly' && (this.flying || Math.hypot(this.vel.x, this.vel.z) > F.minSpeed)) {
      if (!this.flying) {
        this.flying = true;
        this.pitch = Math.asin(THREE.MathUtils.clamp(this.vel.y / Math.max(1, this.vel.length()), -0.6, 0.6));
        this.bank = 0;
        this.stallFall = 0;
        this.events.push('takeoff');
      }
      this.wheelspin = this.understeer = this.sliding = 0;
      this.load *= Math.exp(-4 * dt);
      this.sink = 0;
      if (this.drifting) this.endDrift(false);
      this.updateFlight(dt, c);
    } else {
      this.flying = false;
      this.updateFall(dt, c);
    }
    this.moveInAir(dt);
  }

  /** 비행이 아닌 공중: 중력으로 떨어짐 (점프대, 낭떠러지) */
  updateFall(dt, c) {
    const cfg = this.cfg;
    this.airTime += dt;
    if (this.drifting) this.driftTime += dt;
    // 공중: 바퀴가 떠서 엔진이 헛돎
    const e = cfg.engine;
    this.rpm = THREE.MathUtils.lerp(this.rpm, e.idleRpm + (e.limiter - e.idleRpm) * this.thr, 1 - Math.exp(-6 * dt));
    this.wheelspin = this.understeer = this.sliding = 0;
    this.load *= Math.exp(-4 * dt);
    this.sink = Math.max(0, this.sink - dt * 3);

    // 중력 (맵이 track.gravityAt(pos)를 주면 구역마다 배수: 달 기지 저중력 등)
    this.vel.y -= cfg.gravity * this.gravityScale() * dt;

    // 공중 조작: 살짝 방향 전환
    const turn = -c.steer * 0.8 * dt;
    this.fwd.applyAxisAngle(WORLD_UP, turn);
    // 공기 저항: 초당 airDragPerSec 비율 (2026-11-10: 예전엔 물리 스텝(1/120초)마다 airDrag 0.2%씩이라 초당 21%나 줄었음
    //   → 점프·저중력에서 착지 속도가 30~40% 깎였음. 지금은 시간 기준 초당 약 5%)
    this.vel.multiplyScalar(Math.exp(-(cfg.airDragPerSec ?? 0.05) * dt));

    // 공중에서 천천히 똑바로 돌아옴 (천장에서 떨어지면 뒤집힌 채로 회전)
    _q.setFromUnitVectors(this.up, WORLD_UP);
    _q.slerp(new THREE.Quaternion(), Math.exp(-3 * dt));
    this.fwd.applyQuaternion(_q);
    this.up.applyQuaternion(_q).normalize();
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
  }

  /** 공중 이동: 가는 길에 부딪히는 면이 있으면 착지하거나 튕겨남 */
  moveInAir(dt) {
    const cfg = this.cfg;
    // 이동: 가는 길에 부딪히는 면이 있는지 확인
    const step = this.vel.clone().multiplyScalar(dt);
    const len = step.length();
    let hit = null;
    if (len > 1e-6) {
      hit = this.track.castRay(this.pos.clone().addScaledVector(this.up, 0.3), step.clone().divideScalar(len), len + 0.35);
    }
    if (!hit && this.vel.dot(this.up) <= 0) {
      hit = this.track.castRay(this.pos.clone().addScaledVector(this.up, 0.5), this.up.clone().negate(), 0.55);
    }
    if (hit && this.vel.dot(hit.normal) < 0) {
      const canLand = hit.surface === 'magnet' || hit.normal.y > 0.5;
      if (canLand) {
        const wasFlying = this.flying;
        let landS = 0, landHard = 0;
        if (this.flying) {
          // 비행 착지 (2026-11-10 고침: 예전엔 착지할 때 속도가 확 줄었음)
          //   예전: 내려오는 속도가 crashSpeed(22)를 넘으면 무조건 속도 ×0.45, 게다가 강제 착륙의 "억지로 끌어내리는 속도"(forceSink)까지
          //   내려오는 속도로 쳐서, 강제 착륙이나 Shift로 내려앉으면 거의 항상 쿵 → 180 km/h가 70 km/h로 떨어졌음
          //   지금: 억지로 끌어내린 속도는 빼고 재고, 아주 세게 내리꽂을 때만 조금(crashLoss까지) 잃음
          const F = cfg.modes.fly, fs = this.forceSink || 0;
          const descent = -this.vel.dot(hit.normal) - fs * Math.max(0, hit.normal.y);
          landS = Math.hypot(this.vel.x, this.vel.y + fs, this.vel.z); // 진짜 비행 속도 (끌어내린 속도 뺌)
          landHard = THREE.MathUtils.clamp((descent - F.crashSpeed) / (F.crashRange ?? 20), 0, 1);
          if (landHard > 0) this.events.push('bump');
          this.flying = false;
          this.pitch = this.bank = this.stallFall = 0;
          if (this.forceLanding && this.mode === 'fly') {
            this.setMode(this.autoFlyFrom || 'normal');
            this.autoFlyFrom = null;
          }
          this.forceLanding = false;
          this.forceSink = 0;
          // 날개 기울기를 풀고 바닥에 맞춤
          this.up.copy(WORLD_UP);
          this.fwd.setY(0).normalize();
        }
        this.pos.copy(hit.point);
        this.alignTo(hit.normal);
        this.setVelocityOnSurface(this.vel);
        if (wasFlying) {
          // 땅과 나란한 속도 + 내려오던 속도의 대부분(landKeep)을 앞으로 이어 줌 → 부드럽게 내려앉으면 속도가 거의 그대로
          const F = cfg.modes.fly, tang = Math.max(0, this.speed);
          const keep = tang + Math.max(0, landS - tang) * (F.landKeep ?? 0.8);
          this.speed = Math.min(landS, keep) * (1 - (F.crashLoss ?? 0.35) * landHard);
          this.fitGear(); // 비행 중 기어(대충 정한 값)를 이 속도에 맞는 기어로 → 착지 뒤 변속을 여러 번 하느라 힘이 끊기지 않게
        }
        this.grounded = true;
        this.surface = hit.surface;
        this.magnet = hit.surface === 'magnet';
        if (this.airTime > 0.35) this.events.push('land');
        this.airTime = 0;
        return;
      }
      // 착지할 수 없는 가파른 일반 벽 → 튕겨남
      const vn = this.vel.dot(hit.normal);
      this.vel.addScaledVector(hit.normal, -vn * 1.3);
      if (this.flying) {
        // 날다가 벽에 부딪힘: 튕겨 나간 방향으로 기수를 돌리고 느려짐
        this.vel.multiplyScalar(0.6);
        this.fwd.copy(this.vel).setY(0).normalize();
      } else if (this.cfg.impact && vn < -this.cfg.impact.minSpeed) {
        // 점프 중에 벽에 튕김: 차 방향을 튕겨 나간 수평 방향 쪽으로 돌려 둠 (착지 후 빙글빙글 방지)
        const h = _v1.copy(this.vel).setY(0);
        const fh = _v2.copy(this.fwd).setY(0);
        if (h.lengthSq() > 1 && fh.lengthSq() > 1e-4) {
          h.normalize();
          fh.normalize();
          let a = signedAngle(fh, h, WORLD_UP);
          if (Math.abs(a) > Math.PI / 2) a -= Math.sign(a) * Math.PI; // 뒤로 튕기면 차 축만 맞춤
          this.fwd.applyAxisAngle(WORLD_UP, a * this.cfg.impact.align);
          this.hitT = Math.max(this.hitT, this.cfg.impact.recover);
        }
      }
      this.events.push('bump');
      return;
    }
    this.pos.add(step);
  }

  /**
   * 드리프트 끝. released = 드리프트 키를 떼서 끝냄, spun = 너무 돌아가 스핀
   * 깔끔한 탈출 (2026-11-10): 키를 뗄 때 각도가 exitAngle 아래(차가 이미 나갈 쪽을 봄) + 각도 창 안에서 exitMinHold초 이상 버팀
   *   → 이번 드리프트로 잃은 속도의 exitKeep 비율(버틴 시간·탈출 각도에 따라, 최대 exitMax m/s)을 돌려받고, 미끄러짐이 exitAlign만큼 바로 펴짐
   */
  endDrift(giveBoost, released = false, spun = false) {
    const D = this.cfg.drift;
    if (giveBoost && this.driftLevel > 0) {
      this.startBoost(this.driftLevel === 2 ? D.level2Boost : D.level1Boost);
    }
    const ang = this.slip * this.driftDir;
    const exitA = D.exitAngle ?? 0.6, good = D.exitGood ?? 0.35;
    const clean = !spun && released && giveBoost && this.driftHold >= (D.exitMinHold ?? 0.4) && ang < exitA && ang > -0.15 && !(this.hitT > 0);
    let quality = 0, gain = 0;
    if (clean) {
      const holdQ = THREE.MathUtils.clamp(0.35 + (0.65 * this.driftHold) / (D.level2Time || 2), 0, 1);
      const angQ = ang <= good ? 1 : 1 - (0.5 * (ang - good)) / Math.max(0.01, exitA - good);
      quality = holdQ * angQ;
      gain = Math.min(D.exitMax ?? 5, this.driftLoss * (D.exitKeep ?? 0.6) * quality);
      this.exitRefund = gain;
      this.slip *= 1 - (D.exitAlign ?? 0.4) * quality; // 진행 방향이 차 머리 쪽으로 바로 펴짐 (쭉 뻗어 나감)
      this.events.push('driftExit');
    } else if (spun) this.events.push('driftSpin');
    if (this.driftTime > 0.3 || spun) this.lastDriftInfo = { clean, quality, gain, hold: this.driftHold, angle: ang, spin: spun, level: this.driftLevel, t: this.simT };
    this.drifting = false;
    this.driftAngle = 0;
    this.driftHold = this.driftLoss = 0;
    this.driftTime = 0;
    this.driftLevel = 0;
  }

  /** 네트워크 전송/리플레이용 상태 스냅샷 */
  snapshot() {
    return {
      pos: this.pos.toArray(), up: this.up.toArray(), fwd: this.fwd.toArray(), vel: this.vel.toArray(),
      speed: this.speed, slip: this.slip, grounded: this.grounded, gear: this.gear, rpm: this.rpm,
      drifting: this.drifting, driftLevel: this.driftLevel, boostTime: this.boostTime,
      form: this.form, formTime: this.formTime, mode: this.mode, sink: this.sink, flying: this.flying,
    };
  }
}

/**
 * 레이싱 라인 속도 계산에 쓰는 이 차의 대략적인 성능 (일반 모드 기준)
 *   aLat: 코너에서 버틸 수 있는 옆 가속, aAcc: 가속, aBrake: 감속 (속도에 따라 달라짐, m/s²)
 */
export function lineCarModel(cfg) {
  const df = (v) => cfg.aero.downforce * Math.min(1.6, (v / cfg.maxSpeed) ** 2);
  // 자동 가속 모드: autoSpeed 이상에서는 최고 속도·힘·기어가 늘고 접지력은 조금 줄어듦 → 속도 계획에도 반영
  const A = cfg.modes && cfg.modes.accel;
  const autoV = A && A.autoSpeed && !cfg.modes.manualSelect ? A.autoSpeed / 3.6 : Infinity;
  const hi = (v) => v >= autoV;
  return {
    vMax: autoV < Infinity ? cfg.maxSpeed * A.speedFactor : cfg.maxSpeed,
    aLat: (v) => 0.94 * (hi(v) ? A.gripFactor : 1) * Math.min(cfg.steerLat * (1 + (cfg.steerLatDownforce || 0) * df(v)), cfg.tire.lateral * (1 + df(v))),
    // 그 속도에 맞는 기어의 엔진 힘 (토크 약 0.9) − 공기·구름 저항, 타이어 한계 안에서
    aAcc: (v) => {
      const gears = hi(v) ? cfg.gears.map((g) => g * A.gearFactor) : cfg.gears;
      const G = gears.find((g) => g >= v * 1.06) ?? gears[gears.length - 1];
      const eng = (cfg.engine.power * 0.9 * (hi(v) ? A.powerFactor : 1)) / G - cfg.aero.drag * v * v - cfg.aero.rolling;
      // 구동 방식: 네 바퀴 굴림은 출발 접지↑, 앞바퀴 굴림은 가속 때 앞이 들려 약간↓ (car.js updateGround와 같은 효과를 대략)
      const drvK = cfg.drivetrain === 'awd' ? cfg.tire.awdTraction ?? 1.12 : cfg.drivetrain === 'fwd' ? 0.9 : 1;
      return Math.max(0.4, Math.min(cfg.tire.traction * drvK * (1 + df(v)) * (hi(v) ? A.gripFactor : 1), eng));
    },
    bankGrip: cfg.bankGrip || 0,
    // 물 위(배): 프로펠러 추진 − 물 저항, 방향타로 도는 옆 한계 (배는 옆으로 미끄러져서 이론값의 절반쯤만)
    boat: cfg.modes && cfg.modes.boat ? (() => {
      const b = cfg.modes.boat;
      return {
        vMax: Math.min(b.maxSpeed, Math.sqrt(Math.max(1, b.thrust - b.rolling) / b.drag)),
        aLat: (v) => Math.max(4, 0.5 * v * b.turnRate * (1 - 0.35 * Math.min(1, v / b.maxSpeed))),
        aAcc: (v) => Math.max(0.3, b.thrust - b.drag * v * v - b.rolling),
        aBrake: (v) => 0.85 * b.brake + b.drag * v * v + b.rolling,
      };
    })() : null,
    aBrake: (v) => 0.85 * Math.min(cfg.brake, cfg.tire.brakeGrip * (1 + df(v))) + cfg.aero.drag * v * v,
  };
}
