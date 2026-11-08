import type { MachineSpec } from '../config/machine';
import { RuleEngine, type ModeFlags, type RuleDef, type Violation } from '../core/ruleEngine';
import { bucketCorners, bucketUnderside, dirOf, fk, latOf, toWorld, type Frame, type Pose } from './kinematics';
import { passHits, shapeOf, staticHits } from './judge';
import { buildSite, type Site, type Station, type StationName } from './site';
import { makeStationGrid, SoilWorld, type SoilGrid } from './soil';
import { clamp, dot, len, sub, v3, type V3 } from './vec';

export interface RuleParams {
  digTimeLimitSec: number;
  minDigCount: number;
  workHeight: number;
  digSoilSurface: number;
  digHardFloor: number;
  dumpPitFloor: number;
  groundSoftFloor: number;
  passTopLimit: number | null;
  repeatCooldownSec: number;
  stallRpm: number;
  flattenMinVolume: number;
  endHoldSec: number;
  endOpenMarginDeg: number;
  endGroundTol: number;
  soilCell: number;
  reposeDeg: number;
  /** 유압 응답: 가속 시간상수(s), 정지 시간상수(s) */
  hydTauUp: number;
  hydTauDown: number;
  /** 이 감속도(최대속도의 배수/s)를 넘으면 충격 */
  joltSafeDecel: number;
  /** 경고를 띄우는 충격량 */
  joltWarn: number;
  /** 고봉 흙이 쏟아지는 충격량 */
  joltSpill: number;
  /** 굴착 목표: ⓑ선 안쪽 거리 (공개문제 30cm) */
  digTargetInset: number;
  /** 굴착 위치 허용 오차: 이내면 좋음 / 이내면 보통 (자체 연습 기준) */
  digPosTolGood: number;
  digPosTolOk: number;
  /** 작업 높이에서 선까지 이 거리 안이면 근접 경고 */
  nearLineMargin: number;
  /** 흙 저항: 관절 속도 배율 = 1 / (1 + soilResist × 초당 깎는 부피) */
  soilResist: number;
  /** 엔진이 감당하는 굴착 힘 (초당 '저항 부피'): powerBase + powerPerRpm × rpm */
  powerBase: number;
  powerPerRpm: number;
  /** 과부하 누적량(∫max(0,부하-1)dt, 1.5초 감쇠)이 이 값을 넘으면 경고 */
  overloadWarnSec: number;
  /** rpm이 낮을 때 과부하 누적량이 이 값을 넘으면 엔진 정지 */
  stallOverload: number;
  /** 차체 들림 경고 각도, 최대 각도 (도) */
  liftWarnDeg: number;
  liftMaxDeg: number;
}

/** 굴착 진입 위치: 목표점(ⓑ선 안쪽 30cm, 구덩이 중심선) 대비 */
export interface DigEntry {
  /** 반경 방향 오차 (+ = ⓑ선 쪽 바깥, - = 장비 쪽 안쪽), m */
  dr: number;
  /** 좌우 오차 (+ = B 쪽), m */
  dl: number;
  grade: 'good' | 'ok' | 'bad';
}

/** 차체 흔들림 (감쇠 진동). pitch: 버킷 방향으로 숙임(+), roll: 오른쪽으로 기움(+) */
export interface Rock {
  pitch: number;
  pitchV: number;
  roll: number;
  rollV: number;
}

export interface RulesFile {
  version: string;
  source: string;
  rules: RuleDef[];
  params: RuleParams;
}

/** 레버 입력: 화면 위쪽이 +y */
export interface Sticks {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

export type Phase = 'precheck' | 'ready' | 'working' | 'finished';

export interface Particle {
  p: V3;
  v: V3;
  vol: number;
}

export interface DigResult {
  digCount: number;
  dumpCount: number;
  loadRatios: number[];
  positionErrors: number[];
  entries: DigEntry[];
  connectedRatio: number;
  flatness: { meanDev: number; std: number; range: number; outsideVol: number } | null;
  impacts: number;
  precheck: { belt: boolean; lever: boolean; rpm: boolean };
  elapsed: number;
  flattenVol: number;
  jolts: number;
}

const STEP = 1 / 60;

export class DigSession {
  readonly site: Site;
  readonly soil: SoilWorld;
  readonly engine: RuleEngine;
  readonly params: RuleParams;
  phase: Phase = 'precheck';
  t = 0; // 작업 경과 시간
  readyT = 0;
  pose: Pose;
  vel = { swing: 0, boom: 0, arm: 0, bucket: 0 };
  input: Sticks = { lx: 0, ly: 0, rx: 0, ry: 0 };
  frame: Frame;
  load = 0;
  particles: Particle[] = [];
  spilled = 0;
  belt = false;
  leverUnlocked = false;
  rpm = 0.3;
  engineOn = true;
  // 카운터·지표
  digCount = 0;
  dumpCount = 0;
  loadRatios: number[] = [];
  positionErrors: number[] = [];
  entries: DigEntry[] = [];
  private entryListeners: ((e: DigEntry) => void)[] = [];
  impacts = 0;
  jolts = 0;
  rock: Rock = { pitch: 0, pitchV: 0, roll: 0, rollV: 0 };
  /** 엔진 부하 (0~, 1을 넘으면 과부하). 굴착 저항 ÷ 엔진 힘 */
  engineLoad = 0;
  /** 차체 들림 각도 (rad, 버킷 쪽이 들림) */
  lift = 0;
  /** 이번 스텝 굴착 저항 (저항 부피 m³)과 그중 아래로 누르는 비율 */
  private effort = 0;
  private effortDown = 0;
  /** 과부하 누적량: ∫max(0, 부하-1)dt, 1.5초에 걸쳐 서서히 빠짐 */
  overloadAcc = 0;
  maxOverloadAcc = 0;
  private downAvg = 0;
  /** 마지막 충격 세기 (화면 흔들림·진동용, 렌더에서 읽고 감쇠) */
  lastJolt = 0;
  private joltCd = 0;
  flattenVol = 0;
  precheck = { belt: false, lever: false, rpm: false };
  private tActive = 0;
  private tMulti = 0;
  private cycle = { cutInA: 0, firstCutRecorded: false, pouredInC: 0, dumpCounted: false };
  private prevTipStation: StationName | null = null;
  private prevStation: StationName | null = null;
  private prevBucket: V3[];
  private prevUnder: V3[][] = [];
  private stallT = 0;
  /** 직전 스텝의 초당 굴착량 (흙 저항용, m³/s) */
  cutRate = 0;
  /** 버킷 상대각 변화 속도 (rad/s, 음수 = 오므림) */
  bucketRate = 0;
  private prevBucketAngle: number | null = null;
  private endT = 0;
  pourAcc = 0;
  private impactCd = 0;
  private timeReported = false;
  private talus: number;
  private listeners: ((v: Violation) => void)[] = [];
  private finishListeners: (() => void)[] = [];
  /** 시험모드에서 실격으로 끝난 경우 */
  endedByRule: Violation | null = null;
  /** 디버그용: 마지막 스텝 계산 시간(ms) */
  simMs = 0;

  constructor(
    readonly m: MachineSpec,
    rules: RulesFile,
    flags: ModeFlags,
    private rand: () => number = Math.random,
  ) {
    this.params = rules.params;
    this.site = buildSite(m);
    const init = {
      cell: this.params.soilCell,
      digSurface: this.params.digSoilSurface,
      digFloor: this.params.digHardFloor,
      dumpFloor: this.params.dumpPitFloor,
      groundFloor: this.params.groundSoftFloor,
    };
    this.soil = new SoilWorld(this.site.stations.map((s) => makeStationGrid(s, init)));
    this.engine = new RuleEngine(rules.rules, flags, this.params.repeatCooldownSec);
    this.talus = Math.tan((this.params.reposeDeg * Math.PI) / 180) * this.params.soilCell;
    // 시작 자세: A를 향해 붐을 들고 버킷을 오므림
    this.pose = { swing: Math.PI, boom: 0.55, arm: -1.75, bucket: -0.9 };
    this.frame = fk(m, this.pose);
    this.prevBucket = bucketCorners(m, this.frame, this.pose.swing);
    this.prevUnder = this.underWorld(this.frame, this.pose.swing);
  }

  get flags() {
    return this.engine.flags;
  }
  get heapedCap() {
    return this.m.struckCapacity * this.m.heapedFactor;
  }
  onViolation(fn: (v: Violation) => void) {
    this.listeners.push(fn);
  }
  onDigEntry(fn: (e: DigEntry) => void) {
    this.entryListeners.push(fn);
  }
  /** 굴착 목표점 (A지점 국소 좌표) */
  get digTarget() {
    const st = this.site.stations[0];
    return { rho: st.bLine - this.params.digTargetInset, lat: 0 };
  }
  onFinish(fn: () => void) {
    this.finishListeners.push(fn);
  }
  inFlight(): number {
    return this.particles.reduce((s, p) => s + p.vol, 0);
  }
  /** 흙 장부 오차 (0이어야 함) */
  ledgerError(): number {
    return this.soil.volumeDelta() + this.load + this.inFlight() + this.pourAcc + this.spilled;
  }

  /** 준비 완료 → 호각 대기 */
  ready() {
    if (this.phase !== 'precheck') return;
    this.precheck = { belt: this.belt, lever: this.leverUnlocked, rpm: this.rpm >= 0.6 };
    this.phase = 'ready';
    this.readyT = 0;
  }
  restartEngine() {
    this.engineOn = true;
    this.stallT = 0;
  }
  /** 기권(중도 종료). 정상 종료는 버킷을 펴서 지면에 내려놓았을 때만 (명세 4장) */
  abandoned = false;
  abandon() {
    if (this.phase !== 'working' && this.phase !== 'ready') return;
    this.abandoned = true;
    this.phase = 'finished';
    for (const fn of this.finishListeners) fn();
  }

  private report(id: string, detail: string) {
    const r = this.engine.report(id, this.t, detail);
    if (r.recorded && r.violation) for (const fn of this.listeners) fn(r.violation);
    if (r.endsTask && r.violation && this.phase === 'working') {
      this.endedByRule = r.violation;
      this.phase = 'finished';
      for (const fn of this.finishListeners) fn();
    }
  }

  private underWorld(f: Frame, swing: number): V3[][] {
    const W = this.m.bucketWidth;
    const n = Math.max(2, Math.round(W / this.params.soilCell) + 1);
    return bucketUnderside(f).map((q) => {
      const row: V3[] = [];
      for (let i = 0; i < n; i++) row.push(toWorld(swing, q, -W / 2 + (W * i) / (n - 1)));
      return row;
    });
  }

  stationOf(p: V3): Station | null {
    for (const s of this.site.stations) {
      const rho = dot(p, s.axis);
      const lat = p.z;
      if (rho > s.zoneIn - 0.5 && rho < s.zoneOut + 0.5 && Math.abs(lat) < s.zoneHalfW + 0.8) return s;
    }
    return null;
  }

  /** 한 고정 스텝 진행 */
  step(dt = STEP) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    if (this.phase === 'ready') {
      this.readyT += dt;
      if (this.readyT >= 1.5) this.phase = 'working';
    }
    const working = this.phase === 'working';
    if (working) this.t += dt;

    // 1) 관절 구동
    const active = working && this.engineOn && this.leverUnlocked;
    const rf = 0.35 + 0.65 * clamp(this.rpm, 0, 1);
    const sp = this.m.speeds;
    const tgt = active
      ? {
          swing: this.input.lx * sp.swing * rf,
          arm: this.input.ly * sp.arm * rf,
          boom: -this.input.ry * sp.boom * rf,
          bucket: this.input.rx * sp.bucket * rf,
        }
      : { swing: 0, arm: 0, boom: 0, bucket: 0 };
    let blocked = false;
    let impactSpeed = 0;
    const prevFrame = this.frame;
    const prevSwing = this.pose.swing;
    // 관성 가중치: 붐이 길게 뻗고 흙을 많이 실을수록 충격이 크다
    const reachF = clamp(this.frame.P2.r / 6, 0.4, 1.3);
    const loadF = 1 + this.load / this.m.struckCapacity;
    const inertia = { swing: 1.2 * reachF * loadF, boom: 1.0 * reachF * loadF, arm: 0.7 * loadF, bucket: 0.35 * loadF };
    // 흙 저항: 흙을 많이 깎는 중일수록 느려진다 (한 번에 깊이 박히지 않음)
    const resist = 1 / (1 + this.params.soilResist * this.cutRate);
    let curPen = this.penetration(this.frame, this.pose.swing).each;
    // 과부하면 유압이 더 밀지 못한다 (릴리프)
    const relief = this.engineLoad > 1 ? 1 / this.engineLoad : 1;
    let pitchImp = 0;
    let rollImp = 0;
    let shock = 0;
    for (const j of ['swing', 'boom', 'arm', 'bucket'] as const) {
      // 유압 응답: 레버를 밀면 천천히 붙고, 놓으면 밸브가 빨리 닫혀 급정지
      const v0 = this.vel[j];
      const speeding = Math.abs(tgt[j]) > Math.abs(v0) && (v0 === 0 || Math.sign(tgt[j]) === Math.sign(v0));
      const tau = speeding ? this.params.hydTauUp : this.params.hydTauDown;
      this.vel[j] += (tgt[j] - v0) * Math.min(1, dt / tau);
      // 급감속 충격
      const vmax = sp[j] * rf;
      // 원래 방향 기준 속도 감소량 (반대로 꺾으면 더 큰 충격)
      const along = Math.sign(this.vel[j]) === Math.sign(v0) ? Math.abs(this.vel[j]) : -Math.abs(this.vel[j]);
      const decel = (Math.abs(v0) - along) / dt;
      const safe = this.params.joltSafeDecel * vmax;
      if (v0 !== 0 && decel > safe) {
        const imp = ((decel - safe) * dt * inertia[j]) / Math.max(sp[j], 1e-6);
        shock += imp;
        if (j === 'swing') rollImp += imp * Math.sign(v0);
        else pitchImp += imp * (j === 'boom' ? -Math.sign(v0) : Math.sign(v0)); // 붐 내리다 멈춤 → 앞으로 숙임
      }
      if (Math.abs(this.vel[j]) < 1e-5) continue;
      const old = this.pose[j];
      let nv = old + this.vel[j] * dt * resist * relief;
      if (j !== 'swing') {
        const lim = this.m.limits[j];
        nv = clamp(nv, lim[0], lim[1]);
        if (nv === lim[0] || nv === lim[1]) {
          // 실린더 끝(스트로크 엔드)에 부딪힘
          const frac = Math.abs(this.vel[j]) / Math.max(sp[j], 1e-6);
          if (frac > 0.3) {
            const imp = (frac - 0.3) * 0.6 * inertia[j];
            shock += imp;
            pitchImp += imp * (j === 'boom' ? -Math.sign(this.vel[j]) : Math.sign(this.vel[j]));
          }
          this.vel[j] = 0;
        }
      }
      this.pose[j] = nv;
      const f = fk(this.m, this.pose);
      const pen = this.penetration(f, this.pose.swing);
      // 단단한 바닥 아래로 '더 깊이' 파고드는 동작만 막는다 (바닥에 닿은 채 오므리기·들기는 허용).
      // 하부 점마다 따로 비교해서, 느리게 조금씩 뚫거나 다른 점이 새로 뚫는 것도 막는다
      let deeper = false;
      for (let q = 0; q < pen.each.length; q++) {
        if (pen.each[q] > 0.01 && pen.each[q] > (curPen[q] ?? 0) + 1e-4) {
          deeper = true;
          break;
        }
      }
      if (deeper) {
        this.pose[j] = old;
        blocked = true;
        impactSpeed = Math.max(impactSpeed, Math.abs(this.vel[j]) * 3);
        // 단단한 바닥을 미는 힘: 레버를 민 만큼 저항 (붐 내림은 차체를 들어 올림)
        const push = (Math.abs(tgt[j]) / Math.max(sp[j], 1e-6)) * 0.016;
        this.effort += push;
        if (j === 'boom' || j === 'arm') this.effortDown += push;
        this.vel[j] = 0;
      } else curPen = pen.each;
    }
    this.frame = fk(this.m, this.pose);
    if (this.prevBucketAngle !== null) this.bucketRate = (this.pose.bucket - this.prevBucketAngle) / dt;
    this.prevBucketAngle = this.pose.bucket;
    // 과부하로 유압이 막힌 상태에서 레버를 계속 밀면(벽을 계속 밂) 부하가 유지된다
    if (relief < 1 && this.cutRate > 0.002) {
      const demand = (Math.abs(tgt.boom) / sp.boom + Math.abs(tgt.arm) / sp.arm + Math.abs(tgt.bucket) / sp.bucket) / 3;
      const hold = demand * (1 - relief) * 0.02;
      this.effort += hold;
      this.effortDown += hold * 0.5;
    }
    this.applyJolt(dt, shock, pitchImp, rollImp, working);

    // 2) 흙 상호작용
    let cutTotal = 0;
    if (working || this.phase === 'ready') cutTotal = this.interactSoil();
    this.cutRate += (cutTotal / dt - this.cutRate) * Math.min(1, dt * 10);

    // 3) 쏟기, 입자
    this.pour(dt);
    this.updateParticles(dt);
    for (const g of this.soil.grids) {
      if (g.activeT > 0) {
        g.activeT -= dt;
        g.relax(this.talus, 2);
      }
    }

    // 4) 판정
    if (working) {
      this.judge(prevFrame, prevSwing);
      // 지표: 연결동작
      const maxes = [sp.swing, sp.boom, sp.arm, sp.bucket];
      const vs = [this.vel.swing, this.vel.boom, this.vel.arm, this.vel.bucket];
      const nAct = vs.filter((v, i) => Math.abs(v) > 0.1 * maxes[i] * 0.35).length;
      if (nAct >= 1) this.tActive += dt;
      if (nAct >= 2) this.tMulti += dt;
      // 충격
      this.impactCd -= dt;
      if (blocked && impactSpeed > 0.4 && this.impactCd <= 0) {
        this.impacts++;
        this.impactCd = 0.4;
        this.report('W-IMPACT', '버킷이 바닥·지면에 부딪힘');
      }
      // 엔진 정지
      this.updateLoad(dt);
      if (this.engineOn && this.rpm < this.params.stallRpm && this.overloadAcc > this.params.stallOverload) {
        this.stallT += dt;
        if (this.stallT > 0) {
          this.engineOn = false;
          this.report('D-STALL', '낮은 rpm에서 무리한 굴착으로 엔진 정지');
        }
      } else this.stallT = Math.max(0, this.stallT - dt);
      // 시간
      if (!this.timeReported && this.t > this.params.digTimeLimitSec) {
        this.timeReported = true;
        this.report('D-TIME', '4분 초과');
      }
      this.trackCycles();
      this.checkEnd(dt);
    }
    this.simMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  }

  /** 굴착 저항 → 엔진 부하 → 과부하 경고·차체 들림 */
  private updateLoad(dt: number) {
    const power = this.params.powerBase + this.params.powerPerRpm * clamp(this.rpm, 0, 1);
    const target = this.engineOn ? this.effort / dt / power : 0;
    this.engineLoad += (target - this.engineLoad) * Math.min(1, dt / 0.25);
    const downFrac = this.effort > 1e-9 ? this.effortDown / this.effort : 0;
    this.effort = 0;
    this.effortDown = 0;
    // 아래로 누르는 과부하만큼 버킷 쪽 차체가 들린다
    const maxL = (this.params.liftMaxDeg * Math.PI) / 180;
    this.downAvg += (downFrac - this.downAvg) * Math.min(1, dt / 0.3);
    const want = clamp(this.overloadAcc * 0.45 * (0.4 + 0.6 * this.downAvg), 0, maxL);
    this.lift += (want - this.lift) * Math.min(1, dt / (want > this.lift ? 0.35 : 0.2));
    this.overloadAcc = this.overloadAcc * Math.exp(-dt / 1.5) + Math.max(0, this.engineLoad - 1) * dt;
    this.maxOverloadAcc = Math.max(this.maxOverloadAcc, this.overloadAcc);
    if (this.overloadAcc > this.params.overloadWarnSec) this.report('W-OVERLOAD', '버킷 날 방향으로 가르지 않고 밀고 있음: 각도를 바꾸거나 덜 깊게');
    if (this.lift > (this.params.liftWarnDeg * Math.PI) / 180) this.report('W-LIFT', '버킷으로 땅을 너무 눌러 차체가 들림');
  }

  /** 충격 → 차체 흔들림, 경고, 고봉 흙 쏟아짐 */
  private applyJolt(dt: number, shock: number, pitchImp: number, rollImp: number, working: boolean) {
    const r = this.rock;
    const GAIN = 1.8; // 아케이드 연출: 실제보다 크게 보이게
    r.pitchV += pitchImp * GAIN;
    r.rollV += rollImp * GAIN * 0.7;
    // 감쇠 진동 (약 1.6Hz, 감쇠비 0.2)
    const K = (2 * Math.PI * 1.6) ** 2;
    const C = 2 * 0.2 * 2 * Math.PI * 1.6;
    r.pitchV += (-K * r.pitch - C * r.pitchV) * dt;
    r.rollV += (-K * r.roll - C * r.rollV) * dt;
    r.pitch += r.pitchV * dt;
    r.roll += r.rollV * dt;
    this.lastJolt = Math.max(this.lastJolt * Math.exp(-dt * 6), shock);
    this.joltCd -= dt;
    if (!working || shock < this.params.joltWarn) return;
    if (this.joltCd <= 0) {
      this.jolts++;
      this.joltCd = 0.6;
      this.report('W-JOLT', '레버를 급하게 놓거나 끝까지 밀어 장비가 덜컹거림');
    }
    // 고봉으로 담긴 흙은 충격에 쏟아진다
    const sc = this.m.struckCapacity;
    if (shock >= this.params.joltSpill && this.load > sc) {
      const v = Math.min(this.load - sc, (this.load - sc) * clamp(shock, 0, 1) + 0.01);
      this.load -= v;
      const W = this.m.bucketWidth;
      const n = Math.max(1, Math.min(6, Math.round(v / 0.004)));
      for (let i = 0; i < n; i++) {
        const tip = toWorld(this.pose.swing, this.frame.tip, (this.rand() - 0.5) * W * 0.8);
        const p = { p: tip, v: v3((this.rand() - 0.5) * 0.8, 0.3, (this.rand() - 0.5) * 0.8), vol: v / n };
        if (this.particles.length < 140) this.particles.push(p);
        else this.land(tip, v / n);
      }
    }
  }

  /** 버킷 하부가 단단한 바닥 아래로 들어간 깊이 */
  private penetration(f: Frame, swing: number) {
    let depth = 0;
    const each: number[] = [];
    for (const row of this.underWorld(f, swing)) {
      for (const p of row) {
        const d = this.soil.floorAt(p.x, p.z) - p.y;
        each.push(d);
        if (d > depth) depth = d;
      }
    }
    return { depth, each };
  }

  private interactSoil(): number {
    const f = this.frame;
    const swing = this.pose.swing;
    const under = this.underWorld(f, swing);
    const nOpen = toWorld(swing, f.nOpen);
    const nOpenW = v3(nOpen.x, nOpen.y, nOpen.z);
    const center = toWorld(swing, { r: (f.tip.r + f.P2.r) / 2, y: (f.tip.y + f.P2.y) / 2 });
    const cell = this.params.soilCell;
    // 버킷 날 방향 (힐 → 끝)
    const bl = { r: f.tip.r - f.heel.r, y: f.tip.y - f.heel.y };
    const bn = Math.hypot(bl.r, bl.y) || 1;
    const bladeW = toWorld(swing, { r: bl.r / bn, y: bl.y / bn });
    // 버킷 날 끝의 이동 방향과 날 방향의 어긋남 (0 = 날 방향으로 가름, 1 = 직각으로 밈)
    const tipNow = under[0][Math.floor(under[0].length / 2)];
    const tipPrev = (this.prevUnder[0] ?? under[0])[Math.floor(under[0].length / 2)];
    const tmv = sub(tipNow, tipPrev);
    const tml = len(tmv);
    // 0 = 날 방향으로 가름, 1 = 직각이거나 힐이 앞장섬(뒤로 밈)
    const misBucket = tml > 1e-5 ? 1 - Math.max(0, dot(tmv, bladeW) / tml) : 0.5;
    const downBucket = tml > 1e-5 ? clamp(-tmv.y / tml, 0, 1) : 0.5;
    let total = 0;
    for (let s = 0; s < under.length; s++) {
      const row = under[s];
      const prow = this.prevUnder[s] ?? row;
      for (let i = 0; i < row.length; i++) {
        const p = row[i];
        const g = this.soil.gridAt(p.x, p.z);
        if (!g) continue;
        const kk = g.cellAt(p.x, p.z);
        if (g.h[kk] <= p.y) continue;
        const vol = g.cut(kk, p.y);
        if (vol <= 0) continue;
        total += vol;
        {
          // 굴착 저항 = 흙 단단함 × 부위 × 각도 나쁨
          //  - 다져진 흙(원래 지면·벽)이 흐트러진 흙보다 무겁다
          //  - 날이 가른 길을 몸통이 따라가므로 몸통 줄은 절반
          //  - 날이 날 방향(힐→끝)으로 움직이면 가볍고, 등·바닥으로 밀면 무겁다 (버킷 전체 기준 misBucket)
          const firm = g.lastFirmCut;
          // 흐트러진 흙은 밀어낸 것을 다시 미는 경우가 많아 아주 가볍게(5%) 센다
          const hard = firm + (vol - firm) * 0.05;
          // 날 끝: 날 방향으로 가르면 가볍고, 힐(등) 쪽이 앞장서면 무겁다
          // 몸통: 날이 앞장서면 이미 갈라진 길을 따라가므로, 몸통이 다져진 흙을 깎는 것 자체가 나쁜 각도의 신호
          const e = s === 0 ? hard * (0.3 + 2 * misBucket) : hard * 1.5;
          this.effort += e;
          this.effortDown += e * downBucket;
        }
        if (s === 0 && g.name === 'A' && !this.cycle.firstCutRecorded && this.phase === 'working') this.recordEntry(f, swing);
        const mv = sub(p, prow[i]);
        // 흙은 버킷 날(맨 앞줄)로만, 날이 개구부 쪽(45° 이내)으로 움직일 때만 담긴다.
        // → 수직으로 찍으면 옆으로 밀릴 뿐이고, 각도를 잡고 오므리거나 당겨야 쓸려 들어온다.
        // 담기는 비율: 개구부 방향과 잘 맞을수록(45°→18°) 0→1, 아래로 찌르는 동작이면 30%만
        const ml = len(mv);
        const cosA = ml > 1e-4 ? dot(mv, nOpenW) / ml : 0;
        const align = clamp((cosA - 0.7) / 0.25, 0, 1);
        // 실제로 버킷을 오므리는 정도 (자세 변화 기준이라 레버·자동 조작 모두 반영)
        const curl = clamp(-this.bucketRate / (0.25 * this.m.speeds.bucket), 0, 1);
        const stabbing = ml > 1e-4 && mv.y < -0.6 * ml;
        // 오므리지 않고 끌기만 하면 35%, 오므려야 100%. 오므림 없이 아래로 찌르기만 하면 0
        const frac = stabbing && curl < 0.2 ? 0 : align * (0.35 + 0.65 * curl);
        const front = s === 0;
        if (front && frac > 0 && this.load < this.heapedCap) {
          const take = Math.min(vol * frac, this.heapedCap - this.load);
          this.load += take;
          if (g.name === 'A') this.cycle.cutInA += take;
          if (vol > take) this.push(g, p, mv, center, vol - take, cell);
        } else {
          this.push(g, p, mv, center, vol, cell);
          if (g.name === 'C' && this.dumpCount >= 1) this.flattenVol += vol;
        }
      }
    }
    this.prevUnder = under;
    return total;
  }

  /** 이번 굴착의 첫 삽 위치 기록: 버킷 날 중심 vs 목표점 */
  private recordEntry(f: Frame, swing: number) {
    this.cycle.firstCutRecorded = true;
    const st = this.site.stations[0];
    const tipC = toWorld(swing, f.tip);
    const dr = dot(tipC, st.axis) - this.digTarget.rho;
    const dl = tipC.z;
    const e = Math.max(Math.abs(dr), Math.abs(dl));
    const grade = e <= this.params.digPosTolGood ? 'good' : e <= this.params.digPosTolOk ? 'ok' : 'bad';
    const entry: DigEntry = { dr, dl, grade };
    this.entries.push(entry);
    this.positionErrors.push(Math.hypot(dr, dl));
    for (const fn of this.entryListeners) fn(entry);
  }

  private push(g: SoilGrid, p: V3, mv: V3, center: V3, vol: number, cell: number) {
    let dx = mv.x;
    let dz = mv.z;
    let l = Math.hypot(dx, dz);
    if (l < 1e-4) {
      dx = p.x - center.x;
      dz = p.z - center.z;
      l = Math.hypot(dx, dz) || 1;
    }
    const tx = p.x + (dx / l) * cell * 1.2;
    const tz = p.z + (dz / l) * cell * 1.2;
    const kk = g.cellAt(tx, tz);
    if (kk >= 0) g.depositSpread(kk, vol);
    else {
      const g2 = this.soil.gridAt(tx, tz);
      if (g2) g2.depositSpread(g2.cellAt(tx, tz), vol);
      else this.spilled += vol;
    }
  }

  private pour(dt: number) {
    const f = this.frame;
    // 버킷이 흙에 묻혀 있으면(날 끝이 표면 아래) 흙이 빠져나갈 수 없다
    const tipW = toWorld(this.pose.swing, f.tip);
    if (tipW.y < this.soil.surfaceAt(tipW.x, tipW.z) - 0.02) return;
    const ny = f.nOpen.y;
    const retain = clamp((ny + 0.35) / 0.9, 0, 1) * this.heapedCap;
    if (this.load <= retain + 1e-6) return;
    const v = Math.min(this.load - retain, 0.8 * dt);
    this.load -= v;
    this.pourAcc += v;
    const st = this.stationOf(toWorld(this.pose.swing, f.tip));
    if (st?.name === 'C') this.cycle.pouredInC += v;
    if (this.pourAcc > 0.004 || this.load < 1e-4) {
      const W = this.m.bucketWidth;
      const tip = toWorld(this.pose.swing, f.tip, (this.rand() - 0.5) * W * 0.8);
      const vel = v3((this.rand() - 0.5) * 0.4, -0.5, (this.rand() - 0.5) * 0.4);
      if (this.particles.length < 140) this.particles.push({ p: tip, v: vel, vol: this.pourAcc });
      else this.land(tip, this.pourAcc);
      this.pourAcc = 0;
    }
  }

  private land(p: V3, vol: number) {
    const g = this.soil.gridAt(p.x, p.z);
    if (g) g.depositSpread(g.cellAt(p.x, p.z), vol);
    else this.spilled += vol;
  }

  private updateParticles(dt: number) {
    const keep: Particle[] = [];
    for (const q of this.particles) {
      q.v.y -= 9.8 * dt;
      q.p.x += q.v.x * dt;
      q.p.y += q.v.y * dt;
      q.p.z += q.v.z * dt;
      if (q.p.y <= this.soil.surfaceAt(q.p.x, q.p.z)) this.land(q.p, q.vol);
      else keep.push(q);
    }
    this.particles = keep;
  }

  private judge(prevFrame: Frame, prevSwing: number) {
    const m = this.m;
    // 연속 경로: 이동량에 따라 보간 분할
    const curB = bucketCorners(m, this.frame, this.pose.swing);
    let maxMove = 0;
    for (let i = 0; i < curB.length; i++) maxMove = Math.max(maxMove, len(sub(curB[i], this.prevBucket[i])));
    const n = Math.max(1, Math.ceil(maxMove / 0.03));
    let prev = this.prevBucket;
    const ids = new Set<string>();
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const swing = prevSwing + (this.pose.swing - prevSwing) * t;
      const pf: Pose = { swing, ...lerpAngle(prevFrame, this.frame, t) };
      const f = fk(m, pf);
      const shape = shapeOf(m, f, swing);
      for (const h of staticHits(this.site, shape, this.params.workHeight)) {
        const key = h.id + h.detail;
        if (!ids.has(key)) {
          ids.add(key);
          this.report(h.id, h.detail);
        }
      }
      for (const h of passHits(this.site, prev, shape.bucket)) {
        const key = h.id + h.detail;
        if (!ids.has(key)) {
          ids.add(key);
          this.report(h.id, h.detail);
        }
      }
      prev = shape.bucket;
    }
    this.prevBucket = curB;
    this.nearLine(curB);
    // 위험: 버킷이 흙 속에 있는데 선회
    if (Math.abs(this.vel.swing) > (3 * Math.PI) / 180) {
      for (const p of curB) {
        if (p.y < this.soil.surfaceAt(p.x, p.z) - 0.05) {
          this.report('W-DANGER', '버킷이 흙 속에 있는 상태에서 선회');
          break;
        }
      }
    }
  }

  /** 작업 높이의 버킷이 굴착구역 안에서 선에 가까우면 미리 경고 (실격 전 교육용) */
  private nearLine(pts: V3[]) {
    const M = this.params.nearLineMargin;
    for (const st of this.site.stations) {
      for (const p of pts) {
        if (p.y >= this.params.workHeight + 0.1) continue;
        const rho = dot(p, st.axis);
        const lat = p.z;
        const inZone = rho >= st.zoneIn && rho <= st.zoneOut && Math.abs(lat) <= st.zoneHalfW;
        if (!inZone) continue;
        const dOut = st.zoneOut - rho;
        const dIn = rho - st.zoneIn;
        const dSide = st.zoneHalfW - Math.abs(lat);
        const d = Math.min(dOut, dIn, dSide);
        if (d < M) {
          const which = d === dOut ? 'ⓑ선' : d === dIn ? '가상굴착제한선' : 'ⓒ선';
          this.report('W-NEAR', `${st.name}지점 ${which}에 가까움`);
          return;
        }
      }
    }
  }

  private trackCycles() {
    const center = toWorld(this.pose.swing, {
      r: (this.frame.tip.r + this.frame.P2.r) / 2,
      y: (this.frame.tip.y + this.frame.P2.y) / 2,
    });
    const st = this.stationOf(center)?.name ?? null;
    const sc = this.m.struckCapacity;
    if (this.prevStation === 'A' && st !== 'A') {
      if (this.cycle.cutInA >= 0.2 * sc && this.load >= 0.3 * sc) {
        this.digCount++;
        this.loadRatios.push(this.load / sc);
      }
      this.cycle.cutInA = 0;
      this.cycle.firstCutRecorded = false;
    }
    // 덤프: 한 번 퍼 담은 흙(굴착 1회)당 한 번만 센다.
    // C에 평적 20% 이상 쏟은 뒤 버킷이 거의 비거나, 다음 굴착을 시작하면 1회.
    // 쏟은 양은 버킷 끝 위치로 집계하므로 C 이탈도 버킷 끝 기준으로 판단한다
    const tipSt = this.stationOf(toWorld(this.pose.swing, this.frame.tip))?.name ?? null;
    const leftC = this.prevTipStation === 'C' && tipSt !== 'C';
    this.prevTipStation = tipSt;
    const startedNextDig = this.cycle.cutInA > 0;
    if (!this.cycle.dumpCounted && this.cycle.pouredInC >= 0.2 * sc && (this.load < 0.1 * sc || leftC || startedNextDig)) {
      this.dumpCount++;
      this.cycle.dumpCounted = true;
    }
    if (startedNextDig && this.cycle.dumpCounted) {
      this.cycle.pouredInC = 0;
      this.cycle.dumpCounted = false;
    }
    this.prevStation = st;
  }

  private checkEnd(dt: number) {
    const lim = this.m.limits.bucket[1];
    const open = this.pose.bucket >= lim - (this.params.endOpenMarginDeg * Math.PI) / 180;
    const gap = this.groundGap();
    const still =
      Math.max(Math.abs(this.vel.swing), Math.abs(this.vel.boom), Math.abs(this.vel.arm), Math.abs(this.vel.bucket)) <
      (2 * Math.PI) / 180;
    // 표면에서 ±허용오차 이내 (흙에 묻힌 상태는 불인정)
    if (open && Math.abs(gap) <= this.params.endGroundTol && still) {
      this.endT += dt;
      if (this.endT >= this.params.endHoldSec) this.finish();
    } else this.endT = 0;
  }

  /** 버킷 하부의 가장 낮은 점과 흙 표면(또는 지면) 사이 거리. 음수면 묻힘 */
  groundGap(): number {
    let gap = Infinity;
    for (const row of this.underWorld(this.frame, this.pose.swing)) {
      for (const p of row) gap = Math.min(gap, p.y - this.soil.surfaceAt(p.x, p.z));
    }
    return gap;
  }

  /** 종료 조건 만족 정도 (0~1, 안내 표시용) */
  get endProgress() {
    return clamp(this.endT / this.params.endHoldSec, 0, 1);
  }

  private finish() {
    if (this.phase !== 'working') return;
    if (this.digCount < this.params.minDigCount) this.report('D-COUNT', `유효 굴착 ${this.digCount}회`);
    if (this.flattenVol < this.params.flattenMinVolume) this.report('D-NOFLAT', '평탄작업 수행 기록 없음');
    this.phase = 'finished';
    for (const fn of this.finishListeners) fn();
  }

  flatness(): DigResult['flatness'] {
    const g = this.soil.grids.find((x) => x.name === 'C');
    if (!g) return null;
    const vals: number[] = [];
    let outside = 0;
    for (let k = 0; k < g.h.length; k++) {
      if (g.pit[k]) vals.push(g.h[k]);
      else outside += Math.max(0, g.h[k] - g.h0[k]) * g.area;
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const meanDev = vals.reduce((a, b) => a + Math.abs(b - 0), 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const range = Math.max(...vals) - Math.min(...vals);
    return { meanDev, std, range, outsideVol: outside };
  }

  result(): DigResult {
    return {
      digCount: this.digCount,
      dumpCount: this.dumpCount,
      loadRatios: this.loadRatios,
      positionErrors: this.positionErrors,
      entries: this.entries,
      connectedRatio: this.tActive > 0 ? this.tMulti / this.tActive : 0,
      flatness: this.flatness(),
      impacts: this.impacts,
      precheck: this.precheck,
      elapsed: this.t,
      flattenVol: this.flattenVol,
      jolts: this.jolts,
    };
  }

  /** 안내 문구 */
  guide(): string {
    if (this.phase === 'precheck') return '시작 전 점검: 안전벨트 → 안전레버 해제 → rpm 올리기 → 준비 완료';
    if (this.phase === 'ready') return '호각! 작업을 시작합니다';
    if (this.phase === 'finished') return '작업 종료';
    if (!this.engineOn) return '엔진이 꺼졌습니다. 시동을 다시 거세요 (rpm을 올리고 작업)';
    if (!this.leverUnlocked) return '안전레버가 잠겨 있어 레버가 움직이지 않습니다';
    const sc = this.m.struckCapacity;
    const tipSt = this.stationOf(toWorld(this.pose.swing, this.frame.tip))?.name ?? null;
    if (this.load >= 0.3 * sc) {
      if (tipSt === 'C') return 'C지점 구덩이 위에서 버킷을 펴 흙을 쏟으세요';
      return '흙을 담은 채 붐을 올리고 B지점 통과구역(두 폴 사이, 줄 위)으로 선회하세요';
    }
    if (this.digCount < this.params.minDigCount)
      return `A지점: ⓑ선 안쪽 30cm에 버킷을 넣고 당기며 퍼 담으세요 (${this.digCount}/${this.params.minDigCount})`;
    if (this.flattenVol < this.params.flattenMinVolume) return 'C지점: 버킷 바닥으로 흙을 고르게 밀어 평탄작업을 하세요';
    const open = this.pose.bucket >= this.m.limits.bucket[1] - (this.params.endOpenMarginDeg * Math.PI) / 180;
    const cm = Math.round(this.groundGap() * 100);
    if (!open) return '마무리: 버킷을 끝까지 펴세요 (버킷 펴기)';
    return `마무리: 편 버킷을 구역 안 지면에 내려놓고 1초 멈추세요 (지면까지 ${Math.max(0, cm)}cm)`;
  }

  /** 디버그·테스트용 */
  setPose(p: Partial<Pose>) {
    Object.assign(this.pose, p);
    this.frame = fk(this.m, this.pose);
  }
  swingDir() {
    return dirOf(this.pose.swing);
  }
  lateralDir() {
    return latOf(this.pose.swing);
  }
}

function lerpAngle(a: Frame, b: Frame, t: number) {
  // Frame에서 관절각 복원: thA = boom + arm, thK = thA + bucket
  const boomA = Math.atan2(a.P1.y - a.P0.y, a.P1.r - a.P0.r);
  const boomB = Math.atan2(b.P1.y - b.P0.y, b.P1.r - b.P0.r);
  const armA = a.thA - boomA;
  const armB = b.thA - boomB;
  const bkA = a.thK - a.thA;
  const bkB = b.thK - b.thA;
  return {
    boom: boomA + (boomB - boomA) * t,
    arm: armA + (armB - armA) * t,
    bucket: bkA + (bkB - bkA) * t,
  };
}
