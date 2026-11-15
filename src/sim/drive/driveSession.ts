/**
 * 코스운전 세션 (판정명세_주행.md). 60Hz 고정 간격, 물리엔진 없이 자전거 모델.
 * 좌표: 월드 (x, z). 진행 방향 heading h → (cos h, sin h). 왼쪽 = (sin h, -cos h).
 * 위치 기준점은 뒷차축 가운데.
 */
import type { MachineSpec } from '../../config/machine';
import { RuleEngine, type ModeFlags, type RuleDef, type Violation } from '../../core/ruleEngine';
import { buildCourse, centerline, courseLength, junctionU, lineSide, rectHitsArc, type Course, type P } from './course';

export type Gear = 'F' | 'N' | 'R';
export type DriveStage = 'READY' | 'GO' | 'ARRIVE' | 'BACK' | 'FINISH' | 'DONE';

export interface DriveInput {
  /** 핸들 돌리는 속도 (-1 오른쪽 ~ 1 왼쪽) */
  steer: number;
  /** 가속 페달 0~1 */
  accel: number;
  /** 브레이크 페달 0~1 */
  brake: number;
  /** 이번 프레임에 화면 핸들을 돌린 각(rad, +면 왼쪽). 유압 조향: 돌린 만큼만 바퀴가 꺾임 */
  wheelDelta?: number;
}

export interface DriveParams {
  maxSteer: number;
  steerRatio: number;
  steerDrift: number;
  steerRate: number;
  vFwd: number;
  vRev: number;
  /** 주차브레이크를 건 채 낼 수 있는 속도 (끌림) */
  vParkDrag: number;
  accel: number;
  brakeDecel: number;
  coastDecel: number;
  stopSpeed: number;
  stopHold: number;
  stopMoveTol: number;
  moveAgain: number;
  backTol: number;
  startLimit: number;
  timeLimit: number;
  wheelHalfTrack: number;
  wheelW: number;
  wheelL: number;
}

export const DRIVE_PARAMS: DriveParams = {
  // 최대 조향각: 끝까지 감고 돌면 왼쪽 선과 약 0.7~1.0m (학원 요령 '끝까지 감고 70~80cm'와 맞춤)
  maxSteer: (30 * Math.PI) / 180,
  // 핸들 감는 각 : 바퀴 조향각 (끝↔끝 3.5바퀴, src/ui/driveControls.ts 근거)
  steerRatio: 21,
  // 유압 조향: 핸들을 계속 감고 있지 않으면 달리는 동안 바퀴가 가운데로 풀림 (최고 속도에서 초당)
  steerDrift: (6 * Math.PI) / 180,
  steerRate: (60 * Math.PI) / 180,
  vFwd: 2.5,
  vRev: 1.6,
  vParkDrag: 0.4,
  accel: 1.2,
  brakeDecel: 4,
  coastDecel: 0.6,
  stopSpeed: 0.05,
  stopHold: 0.5,
  stopMoveTol: 0.05,
  moveAgain: 0.15,
  backTol: 0.1,
  startLimit: 60,
  timeLimit: 120,
  wheelHalfTrack: 1.0,
  wheelW: 0.5,
  wheelL: 1.0,
};

export const DRIVE_RULES: RuleDef[] = [
  { id: 'D-TIME', basis: 'Q1', kind: 'disqualify', title: '시간 초과 (2분)' },
  { id: 'D-START', basis: 'Q5', kind: 'disqualify', title: '1분 안에 출발 못 함' },
  { id: 'D-PBRAKE', basis: 'Q6', kind: 'disqualify', title: '주차브레이크 걸고 출발' },
  { id: 'D-NOSTOP', basis: 'Q7', kind: 'disqualify', title: '정지선에서 안 멈춤' },
  { id: 'D-NOEND', basis: 'Q8', kind: 'disqualify', title: '도착선 전에 후진' },
  { id: 'D-LINE', basis: 'Q9', kind: 'disqualify', title: '바퀴가 코스 선에 닿음' },
  { id: 'D-COURSE', basis: 'Q3', kind: 'disqualify', title: '코스대로 운전 안 함' },
  { id: 'W-SWINGLOCK', basis: '요구사항', kind: 'warning', title: '상부회전체 고정 안 함' },
  { id: 'W-PARK', basis: '요구사항', kind: 'warning', title: '주차구역 밖 주차' },
  { id: 'W-GEAR', basis: '해석', kind: 'warning', title: '움직이며 기어 변경' },
];

const WHEELS = ['왼쪽 앞바퀴', '오른쪽 앞바퀴', '왼쪽 뒷바퀴', '오른쪽 뒷바퀴'] as const;

export class DriveSession {
  readonly c: Course;
  readonly p: DriveParams;
  readonly engine: RuleEngine;
  /** 뒷차축 가운데 */
  pos: P;
  heading: number;
  steer = 0;
  /** 핸들 자체의 각(rad, 바퀴 각과 따로 놂) */
  wheelAngle = 0;
  /** 끝에 닿은 채 더 돌리려 한 각(rad, 부호 = 방향). 화면이 읽고 0으로 */
  lockPush = 0;
  speed = 0;
  gear: Gear = 'N';
  parking = true;
  swingLock = true;
  /** 시작 전 점검 (실제 시험): 안전벨트 · 안전레버 · RPM. 출발 신호 때 기록 */
  belt = true;
  leverUnlocked = true;
  rpm = 0.8;
  precheck = { belt: false, lever: false, rpm: false };
  /** 바퀴가 굴러간 각 (렌더용) */
  roll = 0;
  input: DriveInput = { steer: 0, accel: 0, brake: 0 };
  /** 핸들 가운데로 (배우기·자유 연습 보조) */
  centering = false;

  stage: DriveStage = 'READY';
  /** 출발 신호(호각)를 받았나. 받기 전에는 시간이 흐르지 않음 */
  signaled = false;
  abandoned = false;
  /** 실격으로 끝났을 때 그 사유 */
  endedByRule: Violation | null = null;
  /** 출발 신호 뒤 지난 시간 */
  t = 0;
  /** 과제 시간 (앞바퀴 출발선 통과 ~ 종료선 통과) */
  taskT = 0;
  stopped = false;
  /** 채점용: 왼쪽 선과 간격(목표 0.75m)에서 벗어난 정도의 합과 표본 수 (곡선 주행 중) */
  gapDevSum = 0;
  gapN = 0;
  parkedOk: boolean | null = null;
  finished = false;
  private stillT = 0;
  private stillMove = 0;
  private backAcc = 0;
  private listeners: ((v: Violation) => void)[] = [];
  private finishListeners: (() => void)[] = [];
  private hint: ((msg: string) => void) | null = null;

  constructor(
    readonly m: MachineSpec,
    flags: ModeFlags,
    params: Partial<DriveParams> = {},
  ) {
    this.c = buildCourse(m);
    this.p = { ...DRIVE_PARAMS, ...params };
    this.engine = new RuleEngine(DRIVE_RULES, flags, 1.5);
    // 시작: 앞바퀴가 주차구역(출발선 뒤 1.5m 칸) 가운데, 출발 방향
    this.heading = Math.atan2(this.c.startDir.z, this.c.startDir.x);
    const frontAxle = { x: this.c.startMid.x, z: this.c.startMid.z - 0.1 - this.c.parkDepth / 2 };
    this.pos = { x: frontAxle.x - this.c.startDir.x * m.wheelbase, z: frontAxle.z - this.c.startDir.z * m.wheelbase };
    this.lastBackPast = this.frontPast(this.wheelRects(), 'back');
  }

  get flags() {
    return this.engine.flags;
  }
  onViolation(fn: (v: Violation) => void) {
    this.listeners.push(fn);
  }
  onFinish(fn: () => void) {
    this.finishListeners.push(fn);
  }
  onHint(fn: (msg: string) => void) {
    this.hint = fn;
  }

  // ---------- 차체 기하 ----------
  get fwd(): P {
    return { x: Math.cos(this.heading), z: Math.sin(this.heading) };
  }
  get left(): P {
    return { x: Math.sin(this.heading), z: -Math.cos(this.heading) };
  }
  /** 차체 가운데 (두 차축 가운데) */
  get center(): P {
    const f = this.fwd;
    const h = this.m.wheelbase / 2;
    return { x: this.pos.x + f.x * h, z: this.pos.z + f.z * h };
  }
  /** 바퀴 접지 중심: [왼앞, 오앞, 왼뒤, 오뒤] */
  wheelCenters(): P[] {
    const f = this.fwd;
    const l = this.left;
    const E = this.m.wheelbase;
    const k = this.p.wheelHalfTrack;
    const at = (a: number, s: number) => ({ x: this.pos.x + f.x * a + l.x * s, z: this.pos.z + f.z * a + l.z * s });
    return [at(E, k), at(E, -k), at(0, k), at(0, -k)];
  }
  /** 바퀴 사각형 꼭짓점 (앞바퀴는 조향각만큼 돌림) */
  wheelRects(): P[][] {
    const hw = this.p.wheelW / 2;
    const hl = this.p.wheelL / 2;
    return this.wheelCenters().map((c, i) => {
      const h = this.heading - (i < 2 ? this.steer : 0);
      const f = { x: Math.cos(h), z: Math.sin(h) };
      const l = { x: Math.sin(h), z: -Math.cos(h) };
      return [
        [hl, hw],
        [hl, -hw],
        [-hl, -hw],
        [-hl, hw],
      ].map(([a, b]) => ({ x: c.x + f.x * a + l.x * b, z: c.z + f.z * a + l.z * b }));
    });
  }

  // ---------- 조작 ----------
  setGear(g: Gear) {
    if (g === this.gear) return;
    if (Math.abs(this.speed) > this.p.stopSpeed) {
      this.report('W-GEAR', '멈춘 뒤 기어를 바꾸세요');
      return;
    }
    this.gear = g;
  }
  setParking(on: boolean) {
    this.parking = on;
    if (on && (this.stage === 'FINISH' || this.stage === 'DONE') && !this.finished) this.checkPark();
  }
  setSwingLock(on: boolean) {
    this.swingLock = on;
  }

  // ---------- 진행 ----------
  /** 출발 신호 (감독위원 호각) */
  ready() {
    this.signaled = true;
    this.precheck = { belt: this.belt, lever: this.leverUnlocked, rpm: this.rpm >= 0.6 };
  }
  abandon() {
    this.abandoned = true;
    this.finish();
  }

  step(dt = 1 / 60) {
    if (this.finished) return;
    const p = this.p;
    const inp = this.input;
    if (this.signaled) this.t += dt;
    // 조향 (유압·오비트롤): 핸들을 돌린 만큼만 바퀴가 꺾이고, 끝에 닿으면 핸들도 더 안 돌아감.
    // 핸들 위치와 바퀴 각은 따로 놂(기계적으로 안 묶임). 계속 감고 있지 않으면 달리는 동안 바퀴가 풀림
    const clampS = (x: number) => Math.max(-p.maxSteer, Math.min(p.maxSteer, x));
    const wd = inp.wheelDelta ?? 0;
    const turning = Math.abs(wd) > 1e-4 || Math.abs(inp.steer) > 0.05;
    if (Math.abs(wd) > 1e-4) {
      this.centering = false;
      // 끝(실린더 끝)에 닿으면 핸들도 더 안 돌아감: 실제로 꺾인 만큼만 핸들이 돎
      const before = this.steer;
      this.steer = clampS(this.steer + wd / p.steerRatio);
      const done = (this.steer - before) * p.steerRatio;
      this.wheelAngle += done;
      // 끝에서 더 돌리려 한 양 (화면에서 '끝' 손맛 표시용)
      this.lockPush += wd - done;
      // 고정 60Hz로 여러 번 나눠 돌아도 한 번만 적용
      inp.wheelDelta = 0;
    } else if (this.centering && Math.abs(inp.steer) < 0.05) {
      const d = -this.steer;
      const m = Math.sign(d) * Math.min(Math.abs(d), p.steerRate * dt);
      this.steer += m;
      this.wheelAngle += m * p.steerRatio;
      if (Math.abs(this.steer) < 1e-3) this.centering = false;
    } else {
      if (Math.abs(inp.steer) > 0.05) this.centering = false;
      const before = this.steer;
      this.steer = clampS(this.steer + inp.steer * p.steerRate * dt);
      this.wheelAngle += (this.steer - before) * p.steerRatio;
    }
    if (!turning && !this.centering && this.steer !== 0) {
      const k = Math.min(1, Math.abs(this.speed) / p.vFwd);
      const m = Math.min(Math.abs(this.steer), p.steerDrift * k * dt);
      this.steer -= Math.sign(this.steer) * m;
    }
    // 속도
    const dir = this.gear === 'F' ? 1 : this.gear === 'R' ? -1 : 0;
    let vmax = this.gear === 'F' ? p.vFwd : this.gear === 'R' ? p.vRev : 0;
    if (this.parking) vmax = Math.min(vmax, p.vParkDrag);
    const target = dir * vmax * inp.accel;
    let v = this.speed;
    if (inp.brake > 0.02) {
      const dv = p.brakeDecel * inp.brake * dt;
      v = Math.abs(v) <= dv ? 0 : v - Math.sign(v) * dv;
    } else if (inp.accel > 0.02 && dir !== 0) {
      const dv = p.accel * dt;
      v += Math.max(-dv, Math.min(dv, target - v));
      // 반대 방향으로 굴러가지 않음
      if (v * dir < 0) v = 0;
    } else {
      const dv = p.coastDecel * dt;
      v = Math.abs(v) <= dv ? 0 : v - Math.sign(v) * dv;
    }
    if (this.parking && Math.abs(v) > p.vParkDrag) v = Math.sign(v) * p.vParkDrag;
    this.speed = v;
    // 이동 (뒷차축 기준 자전거 모델)
    const ds = v * dt;
    const before = this.snapshot();
    this.heading -= (ds * Math.tan(this.steer)) / this.m.wheelbase;
    const f = this.fwd;
    this.pos = { x: this.pos.x + f.x * ds, z: this.pos.z + f.z * ds };
    this.roll += ds / 0.55;
    if ((this.stage === 'GO' || this.stage === 'BACK') && Math.abs(ds) > 1e-4) {
      const g = this.leftGap();
      if (g !== null) {
        this.gapDevSum += Math.abs(g - 0.75);
        this.gapN++;
      }
    }
    this.judge(dt, ds, before);
  }

  private snapshot() {
    const rects = this.wheelRects();
    return {
      startFront: this.frontPast(rects, 'start'),
      arriveRear: this.rearPast(rects),
      stopFrontLF: this.lfPastFrontStop(rects),
    };
  }

  /** 앞바퀴 둘 다 출발선을 진행 방향(코스 쪽)으로 완전히 넘었나: 'start' = 코스 쪽, 'back' = 주차 쪽 */
  private frontPast(rects: P[][], side: 'start' | 'back') {
    const l = this.c.start;
    return [rects[0], rects[1]].every((r) =>
      r.every((q) => (side === 'start' ? lineSide(q, l) < 0 : lineSide(q, l) > l.w)),
    );
  }
  /** 뒷바퀴 둘 다 도착선을 완전히 넘었나 */
  private rearPast(rects: P[][]) {
    const l = this.c.arrive;
    return [rects[2], rects[3]].every((r) => r.every((q) => lineSide(q, l) > l.w));
  }
  /** 왼쪽 앞바퀴가 앞 정지선을 완전히 넘었나 */
  private lfPastFrontStop(rects: P[][]) {
    return rects[0].every((q) => junctionU(this.c, q) > this.c.stopFront[1]);
  }
  /** 왼쪽 앞바퀴 접지 중심이 정지선 구간(선에 물림 포함) 안인가 */
  inStopZone() {
    const u = junctionU(this.c, this.wheelCenters()[0]);
    return u >= this.c.stopRear[0] && u <= this.c.stopFront[1];
  }
  /** 왼쪽 앞바퀴의 정지선 구간 안 위치 (0 = 뒷선 바깥 끝, 1 = 앞선 바깥 끝) */
  stopZonePos() {
    const u = junctionU(this.c, this.wheelCenters()[0]);
    return (u - this.c.stopRear[0]) / (this.c.stopFront[1] - this.c.stopRear[0]);
  }
  /** 왼쪽 바퀴 바깥 면에서 왼쪽 경계선까지 거리 (곡선 안일 때만, 아니면 null) */
  leftGap(): number | null {
    const ws = this.wheelCenters();
    let best: number | null = null;
    for (const i of [0, 2]) {
      const w = ws[i];
      for (const b of this.c.bounds) {
        const r = Math.hypot(w.x - b.c.x, w.z - b.c.z);
        const a = Math.atan2(w.z - b.c.z, w.x - b.c.x);
        if (!angleOk(a, b.a0, b.a1)) continue;
        // 왼쪽에 있는 경계: 바퀴 왼쪽 방향과 중심 쪽 방향 비교
        const toC = { x: b.c.x - w.x, z: b.c.z - w.z };
        const l = this.left;
        const leftIsInner = toC.x * l.x + toC.z * l.z > 0;
        const isInner = b.r1 <= this.c.L;
        if (leftIsInner !== isInner) continue;
        const gap = isInner ? r - b.r1 - this.p.wheelW / 2 : b.r0 - r - this.p.wheelW / 2;
        if (best === null || gap < best) best = gap;
      }
    }
    return best;
  }
  /**
   * 바퀴마다 가장 가까운 코스 경계선까지 거리(바퀴 바깥 면 기준, 곡선 안일 때만).
   * 순서: 왼쪽 앞, 오른쪽 앞, 왼쪽 뒤, 오른쪽 뒤. side: 선이 바퀴의 왼쪽(+1)/오른쪽(-1)
   */
  wheelGaps(): ({ gap: number; side: 1 | -1 } | null)[] {
    const ws = this.wheelCenters();
    const rects = this.wheelRects();
    const l = this.left;
    return ws.map((w, i) => {
      let best: { gap: number; side: 1 | -1 } | null = null;
      for (const b of this.c.bounds) {
        const isInner = b.r1 <= this.c.L;
        // 바퀴 네 모서리 중 선에 가장 가까운 것 (실격 판정과 같은 바퀴 사각형)
        let gap = Infinity;
        for (const q of rects[i]) {
          if (!angleOk(Math.atan2(q.z - b.c.z, q.x - b.c.x), b.a0, b.a1)) continue;
          const r = Math.hypot(q.x - b.c.x, q.z - b.c.z);
          gap = Math.min(gap, isInner ? r - b.r1 : b.r0 - r);
        }
        if (gap === Infinity) continue;
        // 선이 놓인 쪽: 안쪽 선이면 중심 쪽, 바깥 선이면 그 반대
        const toC = { x: b.c.x - w.x, z: b.c.z - w.z };
        const cLeft = toC.x * l.x + toC.z * l.z > 0;
        const side: 1 | -1 = cLeft === isInner ? 1 : -1;
        if (!best || gap < best.gap) best = { gap, side };
      }
      return best;
    });
  }
  /** 앞바퀴가 주차구역 안인가 (접지 중심 기준) */
  frontInParkZone() {
    const l = this.c.start;
    const ws = this.wheelCenters();
    return [ws[0], ws[1]].every((q) => {
      const s = lineSide(q, l);
      const x0 = Math.min(l.p0.x, l.p1.x);
      const x1 = Math.max(l.p0.x, l.p1.x);
      return s > l.w && s < l.w + this.c.parkDepth && q.x > x0 && q.x < x1;
    });
  }

  private judge(dt: number, ds: number, before: ReturnType<DriveSession['snapshot']>) {
    const p = this.p;
    const rects = this.wheelRects();
    const now = this.snapshot();
    const moving = Math.abs(this.speed) > p.stopSpeed;
    // 상부회전체 고정
    if (!this.swingLock && moving) this.report('W-SWINGLOCK', '상부회전체를 고정하세요');
    // 선 접촉 (경계선만)
    for (let i = 0; i < 4; i++) for (const b of this.c.bounds) if (rectHitsArc(rects[i], b)) this.report('D-LINE', `${WHEELS[i]} · ${b.name}`);
    // 코스 이탈 ①: 네 바퀴 모두 코스 밖
    if (this.stage !== 'READY' && this.wheelCenters().every((q) => !this.onCourse(q))) this.report('D-COURSE', '코스 밖으로 나감');

    switch (this.stage) {
      case 'READY':
        if (this.signaled && this.flags.timeLimit && this.t > p.startLimit) this.report('D-START', '출발 신호 뒤 1분');
        if (!before.startFront && now.startFront && ds > 0) {
          if (this.parking) this.report('D-PBRAKE', '주차브레이크 걸린 채 출발선 통과');
          this.stage = 'GO';
          this.taskT = 0;
          this.say('출발');
        }
        break;
      case 'GO': {
        this.taskT += dt;
        // 정지 인정
        if (!this.stopped) {
          if (this.inStopZone() && Math.abs(this.speed) <= p.stopSpeed) {
            this.stillT += dt;
            this.stillMove += Math.abs(ds);
            if (this.stillT >= p.stopHold && this.stillMove <= p.stopMoveTol) {
              this.stopped = true;
              this.say('정지 확인');
            }
          } else if (Math.abs(this.speed) > p.moveAgain || !this.inStopZone()) {
            this.stillT = 0;
            this.stillMove = 0;
          }
          if (!before.stopFrontLF && now.stopFrontLF && ds > 0) this.report('D-NOSTOP', '왼쪽 앞바퀴가 정지선을 그냥 지남');
        }
        // 도착 전 후진
        if (ds < 0) this.backAcc += -ds;
        else if (ds > 0) this.backAcc = 0;
        if (this.backAcc > p.backTol) {
          this.report('D-NOEND', '뒷바퀴가 도착선을 넘기 전에 후진');
          this.backAcc = 0;
        }
        // 코스 이탈 ②: 출발선을 다시 뒤로 넘음
        if (before.startFront && !now.startFront && ds < 0 && this.frontPast(rects, 'back')) this.report('D-COURSE', '출발선 뒤로 되돌아감');
        if (!before.arriveRear && now.arriveRear && ds > 0) {
          this.stage = 'ARRIVE';
          this.say('도착선 통과');
        }
        break;
      }
      case 'ARRIVE':
        this.taskT += dt;
        if (ds < 0) {
          this.stage = 'BACK';
        }
        this.checkRunout();
        break;
      case 'BACK':
        this.taskT += dt;
        // 코스 이탈 ③: 뒷바퀴가 도착선을 다시 앞으로 넘음
        if (!before.arriveRear && now.arriveRear && ds > 0) this.report('D-COURSE', '도착선을 다시 넘어 전진');
        this.checkRunout();
        if (!this.frontPastBack(before) && this.frontPast(rects, 'back') && ds < 0) {
          this.stage = 'FINISH';
          this.say('종료선 통과');
          if (this.parking) this.checkPark();
        }
        break;
      case 'FINISH':
      case 'DONE':
        break;
    }
    if (this.flags.timeLimit && (this.stage === 'GO' || this.stage === 'ARRIVE' || this.stage === 'BACK') && this.taskT > p.timeLimit) {
      this.report('D-TIME', '2분 초과');
    }
  }
  private lastBackPast = false;
  private frontPastBack(_before: unknown) {
    const was = this.lastBackPast;
    this.lastBackPast = this.frontPast(this.wheelRects(), 'back');
    return was;
  }
  private checkRunout() {
    // 코스 이탈 ④: 도착선 너머 빈 바닥을 벗어남
    const l = this.c.arrive;
    if (lineSide(this.pos, l) > l.w + this.c.runout) this.report('D-COURSE', '도착선 너머로 너무 멀리 감');
  }
  private checkPark() {
    const ok = this.frontInParkZone() && Math.abs(this.speed) <= this.p.stopSpeed;
    this.parkedOk = ok;
    if (!ok) this.report('W-PARK', '앞바퀴를 주차구역 안에 두세요');
    this.stage = 'DONE';
    this.finish();
  }
  /** 바퀴 접지 중심이 코스(곡선 띠, 주차구역 칸, 도착선 너머 빈 바닥) 위인가 */
  onCourse(q: P) {
    const c = this.c;
    for (const [ctr, a0, a1] of [
      [c.A2, c.bounds[0].a0, c.bounds[0].a1],
      [c.A, c.bounds[2].a0, c.bounds[2].a1],
    ] as const) {
      const r = Math.hypot(q.x - ctr.x, q.z - ctr.z);
      if (r >= c.L - c.width - 0.3 && r <= c.L + 0.3 && angleOk(Math.atan2(q.z - ctr.z, q.x - ctr.x), a0, a1, 0.05)) return true;
    }
    const s = c.start;
    const x0 = Math.min(s.p0.x, s.p1.x) - 0.3;
    const x1 = Math.max(s.p0.x, s.p1.x) + 0.3;
    if (q.x > x0 && q.x < x1 && lineSide(q, s) > -0.3 && lineSide(q, s) < 2 * c.E + 0.3) return true;
    const a = c.arrive;
    const ax0 = Math.min(a.p0.x, a.p1.x) - 1.5;
    const ax1 = Math.max(a.p0.x, a.p1.x) + 1.5;
    if (q.x > ax0 && q.x < ax1 && lineSide(q, a) > -0.3 && lineSide(q, a) < c.runout + 0.3) return true;
    return false;
  }

  private say(msg: string) {
    this.hint?.(msg);
  }
  report(id: string, detail: string) {
    const r = this.engine.report(id, this.t, detail);
    if (!r.recorded || !r.violation) return;
    const c = this.center;
    r.violation.at = { x: c.x, y: 0, z: c.z };
    for (const fn of this.listeners) fn(r.violation);
    if (r.endsTask) {
      this.endedByRule = r.violation;
      this.finish();
    }
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    for (const fn of this.finishListeners) fn();
  }
  /** 뒷차축이 중심선 위 거리 d(출발선 0, 음수는 출발선 뒤 직선, 길이 넘으면 도착선 너머 직선)에 오도록 놓음.
   *  조향은 그 자리 곡선에 맞춤. 배우기 미션 시작용 */
  /** side: 중심선에서 왼쪽(+)·오른쪽(−)으로 비켜 선 거리(m), yaw: 중심선 방향에서 돌아간 각(rad, 반시계 +) */
  placeOnCourse(d: number, o: { stage?: DriveStage; gear?: Gear; parking?: boolean; stopped?: boolean; side?: number; yaw?: number } = {}) {
    const c = this.c;
    const len = courseLength(c);
    const arc = len / 2;
    let p: P;
    let h: number;
    let steer = 0;
    if (d < 0) {
      p = { x: c.startMid.x + c.startDir.x * d, z: c.startMid.z + c.startDir.z * d };
      h = Math.atan2(c.startDir.z, c.startDir.x);
    } else if (d > len) {
      p = { x: c.arriveMid.x, z: c.arriveMid.z + (d - len) };
      h = Math.PI / 2;
    } else {
      const q = centerline(c, d);
      p = q.p;
      h = Math.atan2(q.dir.z, q.dir.x);
      steer = (d < arc ? 1 : -1) * Math.atan(this.m.wheelbase / c.rc);
    }
    if (o.side) p = { x: p.x + Math.sin(h) * o.side, z: p.z - Math.cos(h) * o.side };
    if (o.yaw) h += o.yaw;
    this.teleport(p, h, steer);
    // 핸들도 그 조향각만큼 감긴 자리에서 시작
    this.wheelAngle = this.steer * this.p.steerRatio;
    if (o.stage) this.stage = o.stage;
    if (o.gear) this.gear = o.gear;
    if (o.parking !== undefined) this.parking = o.parking;
    if (o.stopped !== undefined) this.stopped = o.stopped;
    this.signaled = true;
  }
  /** 중심선을 따라 잰 뒷차축 위치 (대략, 곡선 구간만 정확) */
  progress() {
    const c = this.c;
    const len = courseLength(c);
    let best = 0;
    let bd = Infinity;
    for (let d = -6; d <= len + 8; d += 0.1) {
      const q = d < 0 ? { x: c.startMid.x, z: c.startMid.z + d } : d > len ? { x: c.arriveMid.x, z: c.arriveMid.z + (d - len) } : centerline(c, d).p;
      const e = Math.hypot(q.x - this.pos.x, q.z - this.pos.z);
      if (e < bd) [bd, best] = [e, d];
    }
    return best;
  }
  /**
   * 배우기 게이지용: 코스 가운데를 따라가려면 지금 맞출 바퀴 각(rad, +왼쪽).
   * 뒷차축 앞(후진이면 뒤) Ld m의 중심선 점을 향하는 순수 추종
   */
  guideSteer(back = false, Ld = 0.85 * this.m.wheelbase) {
    // 앞보기 거리는 축간거리에 비례 (코스·회전반경이 모두 E에 비례하므로). E 2.6m에서 2.2m였다
    const c = this.c;
    const len = courseLength(c);
    const at = (d: number): P => (d < 0 ? { x: c.startMid.x, z: c.startMid.z + d } : d > len ? { x: c.arriveMid.x, z: c.arriveMid.z + (d - len) } : centerline(c, d).p);
    const d = this.progress();
    const q = at(back ? d - Ld : d + Ld);
    const tv = { x: q.x - this.pos.x, z: q.z - this.pos.z };
    const f = back ? { x: -this.fwd.x, z: -this.fwd.z } : this.fwd;
    const l = this.left;
    const a = Math.atan2(tv.x * l.x + tv.z * l.z, tv.x * f.x + tv.z * f.z);
    const w = Math.atan((2 * this.m.wheelbase * Math.sin(a)) / Ld);
    return Math.max(-this.p.maxSteer, Math.min(this.p.maxSteer, w));
  }
  /** 순간이동 (배우기 미션 시작용) */
  teleport(rearAxle: P, heading: number, steer = 0) {
    this.pos = { ...rearAxle };
    this.heading = heading;
    this.steer = steer;
    this.speed = 0;
    this.lastBackPast = this.frontPast(this.wheelRects(), 'back');
  }
}

function angleOk(a: number, a0: number, a1: number, margin = 0) {
  const TWO = Math.PI * 2;
  const t = (((a - a0 + margin) % TWO) + TWO) % TWO;
  return t <= a1 - a0 + 2 * margin;
}
