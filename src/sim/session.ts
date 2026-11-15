import type { MachineSpec } from '../config/machine';
import { RuleEngine, type ModeFlags, type RuleDef, type Violation } from '../core/ruleEngine';
import { bucketCorners, bucketOutline, bucketUnderside, dirOf, fk, ik, latOf, toWorld, type Frame, type Pose } from './kinematics';
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
  /** 평탄 왕복: C 흙에 닿은 채 당겨 온 거리·밀어 낸 거리 각각 최소 (m). 한 방향만 하면 평탄 안 한 것으로 봄 */
  flattenMinPass: number;
  endSinkTol: number;
  endHoldSec: number;
  endOpenMarginDeg: number;
  endGroundTol: number;
  soilCell: number;
  reposeDeg: number;
  /** 다져진 흙 벽이 이웃 칸과 버티는 최대 높이 차(m). 넘으면 무너짐 (깊게 판 구덩이 벽) */
  wallStableHeight: number;
  /** 유압 응답: 가속 시간상수(s), 정지 시간상수(s) */
  hydTauUp: number;
  hydTauDown: number;
  /** 선회: 상부 차체가 무거워 천천히 붙고 천천히 멈춤 */
  swingTauUp: number;
  swingTauDown: number;
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
  /** 흙 저항: 관절 속도 배율 = 1 / (1 + soilResist × 초당 굴착 저항) */
  soilResist: number;
  /** 버킷이 찰수록 흙을 더 밀어 넣기 힘듦: 저항 × (1 + fillResist × 찬 비율) */
  fillResist: number;
  /** 흙 무게: 가득(고봉) 실었을 때 붐 올림·선회·암 속도 감소 비율 */
  loadSlowBoom: number;
  loadSlowSwing: number;
  loadSlowArm: number;
  /** 흙 무게: 가득 실었을 때 선회가 붙고 멈추는 시간 증가 비율 */
  loadSwingInertia: number;
  loadSway: number;
  loadEngine: number;
  /** 평적(100%)을 넘긴 뒤 더 담기는 비율 (고봉은 쉽게 쌓이지 않음) */
  heapIntake: number;
  throatDepth: number;
  dragFillRatio: number;
  /** 다져진 흙에 이빨이 이 깊이(m)보다 깊이 박히면 더 박는 동작이 무거워짐 */
  biteFree: number;
  /** 박힘 저항: 더 깊이 박는 이동 비율 = 1 / (1 + biteResist × (박힌 깊이 - biteFree) / 0.1m × 각도 나쁨) */
  biteResist: number;
  /** 밀어내는 흙 저항: 담기지 않고 날 앞으로 밀리는 흙(초당 부피)만큼 느려짐 */
  pushResist: number;
  /** 날 앞 덧쌓임(버킷과 같이 밀려가는 흙) 최대 높이 (m). 넘치면 양옆으로 흘러내림 */
  surchargeHeight: number;
  /** 덧쌓임을 미는 저항: 덧쌓임 부피 × 날 이동 거리 × 이 값을 밀린 흙 부피로 (느려짐) */
  surchargeResist: number;
  /** 덧쌓임을 미는 엔진 부하: 덧쌓임 부피 × 날 이동 거리 × 이 값 (스텝당) */
  surchargeEffort: number;
  /** 오므림(버킷 회전)으로 긁는 거리 중 입구로 들어오는 몫 (암 당김 = 1 기준) */
  curlIntake: number;
  /** 박힌 깊이가 만드는 엔진 부하: 레버를 민 만큼 × (박힌 깊이 - biteFree)/0.1m × 이 값 (스텝당) */
  biteLoad: number;
  /** 이 깊이(m)보다 깊이 묻히면 오므림도 무거워짐 (너무 깊이 물면 버킷이 안 오므라짐) */
  curlFree: number;
  /** 깊이 묻힌 오므림 저항: 오므림 이동 비율 ÷ (1 + curlBite × (묻힌 깊이 - curlFree)/0.1m) */
  curlBite: number;
  /** 엔진이 감당하는 굴착 힘 (초당 '저항 부피'): powerBase + powerPerRpm × rpm */
  powerBase: number;
  powerPerRpm: number;
  /** 과부하 누적량(∫max(0,부하-1)dt, 1.5초 감쇠)이 이 값을 넘으면 경고 */
  overloadWarnSec: number;
  /** rpm이 낮을 때 과부하 누적량이 이 값을 넘으면 엔진 정지 */
  stallOverload: number;
  /** 이빨 길이 (날 끝보다 앞으로 튀어나온 길이, m) */
  toothLen: number;
  /** 버킷 안쪽(바닥) 칸 용량 = 평적 × 이 비율. 나머지는 입구 쪽(앞) */
  backCapRatio: number;
  /** 앞쪽 칸과 오므림만으로 채울 수 있는 안쪽 칸의 평적 대비 용량 */
  curlBackCapRatio: number;
  /** 암으로 밀어 넣기 전에 입구에 먼저 쌓이는 양 (평적 대비) */
  frontFirstRatio: number;
  /** 흙을 긁으며 암을 당길 때 안쪽으로 밀어 넣는 속도 */
  armPackRate: number;
  /** 앞쪽 흙이 안쪽으로 들어가는 속도: 오므림(1/s), 입구가 위를 향할 때 무게(1/s) */
  curlPackRate: number;
  /** 차체 들림 경고 각도, 최대 각도 (도) */
  liftWarnDeg: number;
  liftMaxDeg: number;
  /** 시험 순서 모드(연습 시험·실제 시험)에서 이만큼 넘게 들리면 실격 (Q2 해석) */
  liftFailDeg: number;
  /** 흙 면압 (kPa·kN): 단위중량 γ(kN/m³), 수동토압계수, 다져진 흙 점착력, 지지력 계수(Nγ·Nq·Nc), 버킷 바닥 폭 */
  pressGamma: number;
  pressKp: number;
  pressCohesion: number;
  pressNg: number;
  pressNq: number;
  pressNc: number;
  pressB: number;
  /** 버킷에 걸 수 있는 힘 (kN): 붐 내림(차체가 들리기 전), 붐 올림, 암, 버킷 오므림, 버킷 펴기 */
  forceBoomDown: number;
  forceBoomUp: number;
  forceArm: number;
  forceCurl: number;
  forceOpen: number;
  /** 버킷이 이만큼(m) 넘게 흙에 덮이면(윤곽 맨 위가 앞뒤 지표 아래) 밀린 흙이 지표로 솟을 자리가 없음 (coverDepth) */
  heaveDepth: number;
  /** 과부하가 1을 넘어 이만큼 더 커지면 흙을 미는 관절이 유압 릴리프로 멈춤 */
  reliefSpan: number;
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
  /** 화면에서 덩어리 모양을 고정하기 위한 번호 */
  id: number;
}

/** 흙이 땅에 떨어진 자리 (화면 먼지·소리용, 화면이 꺼내 감) */
export interface LandEvent {
  p: V3;
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
  packRatios: number[];
  carrySpill: number;
  flattenOpenRatio: number;
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
  /** 관절별 실제 이동 비율 (흙 저항·릴리프 반영, 0~1). 덜컹 충격 크기에 사용 */
  private velEff = { swing: 1, boom: 1, arm: 1, bucket: 1 };
  input: Sticks = { lx: 0, ly: 0, rx: 0, ry: 0 };
  /**
   * 커브를 먹이기 **전**의 레버 위치 (손이 실제로 민 자리, -1~1).
   * 기계에 들어가는 값은 `input`이고, 이건 "레버를 12시에서 3시로 옮겼나" 같은
   * **손놀림**을 볼 때 쓴다. 커브(|v|^2.2)를 먹인 값으로는 각도가 일그러진다.
   */
  stick: Sticks = { lx: 0, ly: 0, rx: 0, ry: 0 };
  frame: Frame;
  load = 0;
  /** 버킷 안쪽(바닥)까지 밀려 들어간 흙. 나머지(load - loadBack)는 입구 쪽에 수북한 흙 */
  loadBack = 0;
  /** 입구로 더 들어올 수 있는 흙 (m³, interactSoil 참고) */
  private throatBank = 0;
  /** 이번 스텝에 버킷 날(맨 앞줄)이 흙을 깎았는지: 입구가 흙에 막혀 있음 */
  private frontCutting = false;
  /** 날 앞에 밀려 쌓여 버킷과 같이 움직이는 흙 (m³). 지형에 바로 쓰지 않아 같은 흙을 매 프레임 다시 깎지 않음 */
  surcharge = 0;
  private sur = { grid: null as SoilGrid | null, dir: v3(0, 0, 0), idle: 0 };
  /** 직전 흙 상호작용 때의 버킷 각 (날 이동을 '오므림 회전'과 '암·붐으로 끄는 이동'으로 나눔) */
  private soilBucketPrev: number | null = null;
  /** 직전 흙 상호작용 때의 자세 (버킷이 한 스텝에 반 칸 넘게 움직이면 그 사이 경로도 비움) */
  private soilPosePrev: Pose | null = null;
  /** 직전 스텝 흙 흘러내림 뒤 버킷 공간에서 비운 부피 (굴착량에 합산) */
  private relaxCleared = 0;
  /** 덧쌓임을 미는 방향 (수평 단위 벡터, 화면용) */
  get surchargeDir(): V3 {
    return this.sur.dir;
  }
  /** 운반 중(A를 떠나 C에 닿기 전) 흘린 흙 */
  carrySpill = 0;
  /** 실린더 끝에 닿은 채 레버를 미는 정도 (0~1): 릴리프 밸브 소리 */
  reliefLevel = 0;
  /** 유압으로 움직이는 정도 (0~): 유압 흐르는 소리 */
  motionLevel = 0;
  /** 굴착마다 안쪽까지 담긴 비율 */
  packRatios: number[] = [];
  /** 평탄작업 중 '버킷을 펴고 이빨로 앞으로 민' 부피 */
  flattenOpenVol = 0;
  /** 평탄작업 중 흙에 닿은 채 날이 장비 쪽으로 움직인 거리 / 바깥으로 움직인 거리 (m, 왕복 판정) */
  flattenPullDist = 0;
  flattenPushDist = 0;
  /** 직전 스텝 끝의 날 위치 (평탄 왕복 이동 재기) */
  private flatTipPrev: { r: number; y: number } | null = null;
  particles: Particle[] = [];
  private particleId = 0;
  /** 버킷에서 흙이 빠져나가는 양 (m³/s, 부드럽게): '쏴아' 소리 */
  pourRate = 0;
  /** 흙이 땅에 떨어지는 양 (m³/s, 부드럽게): '우르르' 소리 */
  landRate = 0;
  /** 최근 떨어진 자리 (최대 48개, 화면이 비움) */
  landEvents: LandEvent[] = [];
  private pourStep = 0;
  private landStep = 0;
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
  /** 굴착 저항 속도 (초당 저항 부피, 평활) — 흙 저항 감속에 사용 */
  effortRate = 0;
  private effortDown = 0;
  /** 이번 스텝 버킷 면으로 흙을 누르는 힘 (엔진 부하·차체 들림만; 흙 절삭 저항처럼 다른 관절을 느리게 하지 않음) */
  private pressEff = 0;
  private pressEffDown = 0;
  /** 과부하 누적량: ∫max(0, 부하-1)dt, 1.5초에 걸쳐 서서히 빠짐 */
  overloadAcc = 0;
  maxOverloadAcc = 0;
  private downAvg = 0;
  /** 마지막 충격 세기 (화면 흔들림·진동용, 렌더에서 읽고 감쇠) */
  lastJolt = 0;
  /** 이번 판에서 가장 컸던 충격 (화면 프레임 수와 무관하게 정확히 남는다 — 배우기 등급이 읽는다) */
  maxJolt = 0;
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
  /** 날 앞으로 밀려나는(담기지 않은) 흙 초당 부피 */
  pushRate = 0;
  private pushStep = 0;
  /** 직전 절삭의 날 방향 어긋남 (0 = 날 방향으로 가름) */
  private lastMis = 0.5;
  /** 직전 스텝 날 끝의 반경 방향 이동 (+ = 바깥) */
  private tipDr = 0;
  /** 이번 스텝 시작 때 날 끝이 묻힌 깊이 (m) */
  private lastBite = 0;
  /** 직전 스텝 암·붐 당김이 날 앞 흙을 입구로 쓸어 넣는 정도 (0~1, 오므림과 같이 당기는 정석이면 1) */
  private lastPullIntake = 0;
  /** 직전 스텝 입구로 받을 수 있는 한도 (오므림·자세에 따라 평적~고봉) */
  private lastFillLimit = Infinity;
  /** 직전 스텝 버킷 면이 흙을 미는 데 필요한 힘 / 낼 수 있는 힘 (관절 중 최대, 1 넘으면 막힘) */
  pressRatio = 0;
  /**
   * 관절(유압 회로)별 부하: 그 관절이 버킷 면으로 흙을 누르는 힘 + 흙 절삭 저항 중 그 관절이 날을 움직인 몫.
   * 회로 부하가 1을 넘으면 그 관절만 릴리프로 멈춤 (다른 관절은 펌프를 나눠 써서 느려지기만)
   */
  private jointShare = { swing: 0, boom: 0, arm: 0, bucket: 0 };
  private jointPressRate = { swing: 0, boom: 0, arm: 0, bucket: 0 };
  private jointPressStep = { swing: 0, boom: 0, arm: 0, bucket: 0 };
  /** 관절별 회로 부하 (디버그·테스트용) */
  jointLoad = { swing: 0, boom: 0, arm: 0, bucket: 0 };
  /** 흙이 빠질 곳이 없어 막힌 횟수 (누적) */
  pressBlocks = 0;
  /** 흙 장부(부피 배정): 버킷이 밀어낸 흙 누적, 그중 갈 곳(버킷·덧쌓임 여유·얕은 지표 솟음) 없이 옮겨진 흙 누적 (m³) */
  dispTotal = 0;
  unassignedTotal = 0;
  /** 이번 스텝 장부용: 깎여 버킷에 담긴 흙, 덧쌓임·내려놓기·밀기로 간 흙 */
  private stepIntake = 0;
  private ledgerOn = false;
  private stepSurAdd = 0;
  private stepDrop = 0;
  /** 버킷 상대각 변화 속도 (rad/s, 음수 = 오므림) */
  bucketRate = 0;
  private prevBucketAngle: number | null = null;
  private prevArmAngle: number | null = null;
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

  /** 버킷을 끝까지 편 채 흙 위에 얹은 자세로 순간이동 (r = 버킷 끝 반경). 시험 시작 = 앞 수험자의 마지막 자세 */
  restOnSoil(swing: number, r: number) {
    const open = this.m.limits.bucket[1];
    let th = 0;
    let best = Infinity;
    for (let d = -180; d <= 60; d += 0.25) {
      const q = ik(this.m, r, 0.5, (d * Math.PI) / 180);
      if (q && Math.abs(q.bucket - open) < best) [best, th] = [Math.abs(q.bucket - open), (d * Math.PI) / 180];
    }
    let y = 0.5;
    const place = () => {
      const q = ik(this.m, r, y, th);
      if (q) this.teleport({ swing, ...q, bucket: open });
      return !!q;
    };
    for (let i = 0; i < 6 && place(); i++) y -= this.groundGap() - 0.01;
    // 버킷 옆·모서리가 구덩이 가장자리 흙에 박히면 그만큼 들어 올림 (가만히 있어도 깎이지 않게)
    for (let i = 0; i < 4; i++) {
      let sink = 0;
      for (const c of bucketCorners(this.m, this.frame, swing)) sink = Math.max(sink, this.soil.surfaceAt(c.x, c.z) - c.y);
      if (sink <= 0) break;
      y += sink + 0.01;
      place();
    }
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
    return this.soil.volumeDelta() + this.load + this.surcharge + this.inFlight() + this.pourAcc + this.spilled;
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
    if (r.violation && id !== 'D-TIME') r.violation.at ??= toWorld(this.pose.swing, this.frame.tip);
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
    const rows = bucketUnderside(f).map((q) => {
      const row: V3[] = [];
      for (let i = 0; i < n; i++) row.push(toWorld(swing, q, -W / 2 + (W * i) / (n - 1)));
      return row;
    });
    // 이빨 5개: 날 방향(힐→끝)으로 앞에 튀어나와 먼저 파고들고 골을 남긴다
    const br = f.tip.r - f.heel.r;
    const by = f.tip.y - f.heel.y;
    const bl = Math.hypot(br, by) || 1;
    const T = this.params.toothLen;
    const tq = { r: f.tip.r + (br / bl) * T, y: f.tip.y + (by / bl) * T };
    for (let i = 0; i < 5; i++) rows[0].push(toWorld(swing, tq, -W / 2 + 0.08 + ((W - 0.16) * i) / 4));
    return rows;
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
    // 흙 무게: 많이 실을수록 붐 올림·선회·암이 굼뜨다 (가득 = 고봉)
    const wf = clamp(this.load / this.heapedCap, 0, 1);
    if (tgt.boom > 0) tgt.boom *= 1 - this.params.loadSlowBoom * wf;
    tgt.swing *= 1 - this.params.loadSlowSwing * wf;
    tgt.arm *= 1 - this.params.loadSlowArm * wf;
    let blocked = false;
    let impactSpeed = 0;
    const prevFrame = this.frame;
    const prevSwing = this.pose.swing;
    // 관성 가중치: 붐이 길게 뻗고 흙을 많이 실을수록 충격이 크다
    const reachF = clamp(this.frame.P2.r / 6, 0.4, 1.3);
    const loadF = 1 + this.load / this.m.struckCapacity;
    const inertia = { swing: 1.2 * reachF * loadF, boom: 1.0 * reachF * loadF, arm: 0.7 * loadF, bucket: 0.35 * loadF };
    // 흙 저항: 흙을 많이 깎는 중일수록 느려진다 (한 번에 깊이 박히지 않음)
    // 흙 저항: 다져진 흙을 무리하게 깎을수록 느려진다 (흐트러진 흙을 다시 미는 양은 거의 영향 없음)
    // 버킷이 찰수록 흙을 더 밀어 넣기 힘들다
    const resistLoad = this.params.soilResist * this.effortRate * (1 + this.params.fillResist * wf);
    const resist = 1 / (1 + resistLoad);
    // 버킷 오므림은 굴착력(브레이크아웃)이 가장 세서 흙 저항을 덜 받는다
    const pen0 = this.penetration(this.frame, this.pose.swing);
    // 단, 너무 깊이 물면(curlFree 넘게 묻힘) 오므림도 흙에 막혀 무거워진다
    this.lastBite = pen0.bite;
    const curlOver = Math.max(0, pen0.bite - this.params.curlFree) / 0.1;
    const resistCurl = 1 / (1 + 0.25 * resistLoad) / (1 + this.params.curlBite * curlOver);
    let curPen = pen0.each;
    let curBite = pen0.bite;
    // 밀려나는 흙이 많을수록 무겁다 (날 앞에 흙이 쌓여 버팀)
    const pushF = 1 / (1 + this.params.pushResist * this.pushRate);
    // 과부하면 유압이 더 밀지 못한다 (릴리프)
    const relief = this.engineLoad > 1 ? 1 / this.engineLoad : 1;
    // 흙을 미는 관절(붐 내림·암·버킷)은 과부하가 클수록 유압이 릴리프되어 멈춘다 (부하 1+reliefSpan에서 정지).
    // 붐 올림(흙에서 빼기)과 선회는 예전처럼 느려지기만 함 → 언제든 빠져나올 수 있음
    const power = this.params.powerBase + this.params.powerPerRpm * clamp(this.rpm, 0, 1);
    for (const j of ['boom', 'arm', 'bucket'] as const) this.jointLoad[j] = (this.jointShare[j] * this.effortRate + this.jointPressRate[j]) / power;
    const stallOf = (j: 'swing' | 'boom' | 'arm' | 'bucket') => {
      const L = this.jointLoad[j];
      return L > 1 ? clamp(1 - (L - 1) / this.params.reliefSpan, 0, 1) : 1;
    };
    const tipMove = { swing: 0, boom: 0, arm: 0, bucket: 0 };
    let joltCause: { imp: number; why: 'release' | 'reverse' | 'stroke' } = { imp: 0, why: 'release' };
    let reliefPush = 0;
    let motion = 0;
    let pitchImp = 0;
    let rollImp = 0;
    // 흙 장부·선검사: 이번 스텝 버킷이 지나간 자세들 (관절마다 확정된 자세), 처음 자세가 차지한 흙
    const ledgerOn = working || this.phase === 'ready';
    const path: Pose[] = [{ ...this.pose }];
    const occ0 = ledgerOn ? this.occupiedSoil(path) : 0;
    let shock = 0;
    let stepPress = 0;
    this.stepIntake = 0;
    this.stepSurAdd = 0;
    this.stepDrop = 0;

    for (const j of ['swing', 'boom', 'arm', 'bucket'] as const) {
      // 유압 응답: 레버를 밀면 천천히 붙고, 놓으면 밸브가 빨리 닫혀 급정지
      const v0 = this.vel[j];
      const speeding = Math.abs(tgt[j]) > Math.abs(v0) && (v0 === 0 || Math.sign(tgt[j]) === Math.sign(v0));
      const tau =
        j === 'swing'
          ? (speeding ? this.params.swingTauUp : this.params.swingTauDown) * (1 + this.params.loadSwingInertia * wf)
          : speeding ? this.params.hydTauUp : this.params.hydTauDown;
      this.vel[j] += (tgt[j] - v0) * Math.min(1, dt / tau);
      // 흙을 실은 채 선회·붐을 출발·정지하면 무게가 쏠려 차체가 출렁인다 (급조작 '덜컹'보다 약한 상시 출렁임)
      if (wf > 0 && (j === 'swing' || j === 'boom')) {
        const dv = ((this.vel[j] - v0) / Math.max(sp[j], 1e-6)) * wf * this.params.loadSway * reachF;
        if (j === 'swing') rollImp -= dv;
        else pitchImp -= dv;
      }
      // 급감속 충격
      const vmax = sp[j] * rf;
      // 원래 방향 기준 속도 감소량 (반대로 꺾으면 더 큰 충격)
      // 덜컹은 레버 조작으로 '실제로 움직이던' 무게가 급히 멈출 때 생긴다.
      //  - 감속은 레버(유압 명령) 변화로만 센다: 흙 저항으로 느려지는 것은 충격이 아님
      //  - 크기는 직전에 실제로 움직이던 비율(흙 저항·릴리프)에 비례: 흙에 막혀 거의 안 움직이던 중이면 충격 작음
      const moveF = this.velEff[j]; // 직전 스텝의 실제 이동 비율 (0~1)
      const e0 = v0 * moveF;
      const e1 = this.vel[j] * moveF;
      this.velEff[j] = j === 'swing' ? 1 : resist * relief;
      // 반대로 꺾으면 '없앤 운동량'에 되돌리는 몫까지 더해 충격이 커진다.
      // 다만 되돌리는 몫은 원래 움직이던 양을 넘지 않는다 — 멈춘 관절에 반대 방향 레버를
      // 주는 것(바른 조작: 중립에서 세우고 바꾸기)은 덜컹이 아니다. 이 상한이 없으면
      // 다 선 뒤에 바꿔도 남아 있던 미세한 속도 때문에 가짜 덜컹이 나고 고봉 흙이 쏟아졌다.
      const back = Math.min(Math.abs(e1), Math.abs(e0));
      const along = Math.sign(e1) === Math.sign(e0) ? Math.abs(e1) : -back;
      const decel = (Math.abs(e0) - along) / dt;
      const safe = this.params.joltSafeDecel * vmax;
      if (e0 !== 0 && decel > safe) {
        const imp = ((decel - safe) * dt * inertia[j]) / Math.max(sp[j], 1e-6);
        shock += imp;
        if (imp > joltCause.imp) joltCause = { imp, why: Math.sign(tgt[j]) === -Math.sign(v0) && tgt[j] !== 0 ? 'reverse' : 'release' };
        if (j === 'swing') rollImp += imp * Math.sign(e0);
        else pitchImp += imp * (j === 'boom' ? -Math.sign(e0) : Math.sign(e0)); // 붐 내리다 멈춤 → 앞으로 숙임
      }
      // 실린더 쿠션: 관절 한계 6° 앞부터 저절로 감속해 부드럽게 멈춘다 (이 감속은 충격이 아님).
      // 시험에서는 퍼 담은 뒤 버킷을 끝까지 오므리는 게 기본이라, 끝까지 시원하게 가도록 구간을 짧게
      if (j !== 'swing') {
        const lim = this.m.limits[j];
        const dist = this.vel[j] < 0 ? this.pose[j] - lim[0] : lim[1] - this.pose[j];
        const cap = sp[j] * rf * clamp(dist / ((6 * Math.PI) / 180), 0.25, 1);
        if (Math.abs(this.vel[j]) > cap) this.vel[j] = Math.sign(this.vel[j]) * cap;
      }
      // 릴리프: 실린더 끝(0.5° 이내)에서 그쪽으로 레버를 계속 밀면 밸브가 열린다
      if (j !== 'swing' && active) {
        const lim = this.m.limits[j];
        const atMin = this.pose[j] <= lim[0] + 0.009 && tgt[j] < 0;
        const atMax = this.pose[j] >= lim[1] - 0.009 && tgt[j] > 0;
        if (atMin || atMax) reliefPush = Math.max(reliefPush, Math.abs(tgt[j]) / Math.max(sp[j] * rf, 1e-6));
      }
      motion += Math.abs(this.vel[j]) / Math.max(sp[j], 1e-6);
      if (Math.abs(this.vel[j]) < 1e-5) continue;
      const old = this.pose[j];
      const rj = j === 'bucket' && this.vel.bucket < 0 ? resistCurl : resist;
      // 회로 부하가 넘친 관절만 멈춤. 붐 올림(흙에서 빼기)·선회는 느려지기만 함
      const rl = j === 'swing' || (j === 'boom' && this.vel.boom > 0) ? relief : Math.min(relief, stallOf(j));
      let nv = old + this.vel[j] * dt * rj * rl * (j === 'swing' ? 1 : pushF);
      if (j !== 'swing') {
        const lim = this.m.limits[j];
        nv = clamp(nv, lim[0], lim[1]);
        if (nv === lim[0] || nv === lim[1]) {
          // 실린더 끝(스트로크 엔드)에 부딪힘
          const frac = Math.abs(this.vel[j]) / Math.max(sp[j], 1e-6);
          if (frac > 0.3) {
            const imp = (frac - 0.3) * 0.6 * inertia[j];
            shock += imp;
            if (imp > joltCause.imp) joltCause = { imp, why: 'stroke' };
            pitchImp += imp * (j === 'boom' ? -Math.sign(this.vel[j]) : Math.sign(this.vel[j]));
          }
          this.vel[j] = 0;
        }
      }
      const fBefore = fk(this.m, this.pose);
      this.pose[j] = nv;
      let f = fk(this.m, this.pose);

      // 흙은 일정 부피 이상 압축되지 않는다: 버킷 면(바닥·등·입구)이 흙을 밀어낼 때 그 흙이 빠질 곳
      // (입구로 들어감 / 지표로 솟음)이 없으면 지지력·수동토압만큼 힘이 든다. 낼 수 있는 힘을 넘으면 그 동작은 막힘
      if (j !== 'swing' && nv !== old) {
        const pr = this.facePress(fBefore, f, this.pose.swing, j);
        const Fav =
          j === 'boom'
            ? this.vel.boom < 0
              ? this.params.forceBoomDown
              : this.params.forceBoomUp
            : j === 'arm'
              ? this.params.forceArm
              : this.vel.bucket < 0
                ? this.params.forceCurl
                : this.params.forceOpen;
        const ratio = pr.F / Fav;
        stepPress = Math.max(stepPress, ratio);
        const lever = Math.abs(tgt[j]) / Math.max(sp[j], 1e-6);
        const downF = pr.F > 1e-9 ? pr.Fdown / pr.F : 0;
        if (ratio > 1) {
          // 막힘: 밀어붙인 힘은 엔진 부하(릴리프), 아래로 누른 몫은 차체 들림
          this.pose[j] = old;
          this.vel[j] = 0;
          this.pressBlocks++;
          const push = lever * 0.02 * Math.min(2, ratio);
          this.pressEff += push;
          this.jointPressStep[j] += push;
          this.pressEffDown += push * downF;
          continue;
        }
        if (ratio > 0) {
          // 버틸 만한 흙이라도 미는 힘이 클수록 느리고 무겁다
          const fr = 1 / (1 + 2 * ratio * ratio);
          this.pose[j] = old + (nv - old) * fr;
          f = fk(this.m, this.pose);
          const e = lever * 0.008 * ratio;
          this.pressEff += e;
          this.jointPressStep[j] += e;
          this.pressEffDown += e * downF;
        }
      }
      let pen = this.penetration(f, this.pose.swing);
      // 다져진 흙에 더 깊이 박는 이동은 무겁다: 박힌 깊이·각도 나쁨에 비례해 덜 움직임 (흙이 버팀)
      // 오므림·암 당김은 버킷이 원래 흙을 가르는 길이라 제외: 붐으로 내리꽂기·암 밀기·버킷 펴기만
      const digPath = (j === 'bucket' && this.vel.bucket < 0) || (j === 'arm' && this.vel.arm < 0);
      if (j !== 'swing' && !digPath && pen.bite > curBite + 1e-4 && pen.bite > this.params.biteFree) {
        const over = (pen.bite - this.params.biteFree) / 0.1;
        // 날 방향으로 가르며 들어가면 거의 그대로, 등·옆으로 밀어 박으면 무겁다
        const frac = 1 / (1 + this.params.biteResist * over * (0.1 + 1.5 * this.lastMis * this.lastMis));
        this.pose[j] = old + (nv - old) * frac;
        // 버티는 흙을 미는 힘은 엔진 부하로 (과부하·차체 들림·엔진 정지 판정과 같은 경로)
        const push = (1 - frac) * (Math.abs(tgt[j]) / Math.max(sp[j], 1e-6)) * 0.012;
        this.effort += push;
        if (j === 'boom' || j === 'arm') this.effortDown += push;
        f = fk(this.m, this.pose);
        pen = this.penetration(f, this.pose.swing);
      }
      // 단단한 바닥 아래로 '더 깊이' 파고드는 동작만 막는다 (바닥에 닿은 채 오므리기·들기는 허용).
      // 하부 점마다 따로 비교해서, 느리게 조금씩 뚫거나 다른 점이 새로 뚫는 것도 막는다
      const deeperThan = (each: number[]) => {
        for (let q = 0; q < each.length; q++) if (each[q] > 0.01 && each[q] > (curPen[q] ?? 0) + 1e-4) return true;
        return false;
      };
      let deeper = deeperThan(pen.each);
      // 바닥에 닿은 채 오므리거나 암을 당기면, 버킷이 바닥을 타고 올라간다 (붐이 밀려 조금 들림).
      // 멈춰 버리면 레버를 밀수록 과부하·차체 들림만 쌓여 차체가 계속 흔들림
      if (deeper && (j === 'bucket' || j === 'arm')) {
        const boom0 = this.pose.boom;
        for (let k = 1; k <= 8 && deeper; k++) {
          this.pose.boom = Math.min(this.m.limits.boom[1], boom0 + k * 0.004);
          f = fk(this.m, this.pose);
          pen = this.penetration(f, this.pose.swing);
          deeper = deeperThan(pen.each);
        }
        if (deeper) {
          this.pose.boom = boom0;
        } else {
          // 바닥을 긁는 힘만큼 약한 부하 (차체를 누르지는 않음)
          this.effort += (Math.abs(tgt[j]) / Math.max(sp[j], 1e-6)) * 0.001;
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
      } else {
        curPen = pen.each;
        curBite = pen.bite;
      }
      {
        const fa = toWorld(this.pose.swing, fBefore.tip);
        const fz = toWorld(this.pose.swing, f.tip);
        tipMove[j] = Math.hypot(fz.x - fa.x, fz.y - fa.y, fz.z - fa.z);
      }
      path.push({ ...this.pose });
    }
    // 깊이 박힌 채 레버를 밀면 흙이 버티는 힘이 엔진 부하가 된다 (느려져도 부하는 그대로)
    if (active) {
      const biteOver = Math.max(0, curBite - this.params.biteFree) / 0.1;
      // 오므림은 굴착력이 세서 제외 (붐·암으로 밀어 넣는 힘, 버킷 펴기만)
      const demand = Math.abs(tgt.boom) / sp.boom + Math.abs(tgt.arm) / sp.arm + Math.max(0, tgt.bucket) / sp.bucket;
      // 너무 깊이 문 채 오므리면 그 힘도 엔진 부하 (과부하 → 릴리프 → 버킷이 멈춤)
      const curlOverNow = Math.max(0, curBite - this.params.curlFree) / 0.1;
      const curlDemand = Math.max(0, -tgt.bucket) / sp.bucket;
      const bl = (biteOver * demand + curlOverNow * curlDemand * 1.5) * this.params.biteLoad;
      this.effort += bl;
      this.effortDown += bl * 0.5;
    }
    this.pressRatio = stepPress;
    {
      const tot = tipMove.boom + tipMove.arm + tipMove.bucket;
      const k = Math.min(1, dt * 10);
      for (const j of ['boom', 'arm', 'bucket'] as const) {
        if (tot > 1e-6) this.jointShare[j] += (tipMove[j] / tot - this.jointShare[j]) * k;
        this.jointPressRate[j] += (this.jointPressStep[j] / dt - this.jointPressRate[j]) * k;
        this.jointPressStep[j] = 0;
      }
    }
    this.frame = fk(this.m, this.pose);
    if (this.prevBucketAngle !== null) this.bucketRate = (this.pose.bucket - this.prevBucketAngle) / dt;
    this.prevBucketAngle = this.pose.bucket;
    // 과부하로 유압이 막힌 상태에서 레버를 계속 밀면(벽을 계속 밂) 부하가 유지된다
    if (relief < 1 && this.cutRate > 0.002) {
      // 오므림은 굴착력이 세서 벽을 미는 힘으로 치지 않음 (바닥 근처에서 오므리면 부하가 계속 남던 문제)
      const demand = (Math.abs(tgt.boom) / sp.boom + Math.abs(tgt.arm) / sp.arm + Math.max(0, tgt.bucket) / sp.bucket) / 3;
      const hold = demand * (1 - relief) * 0.02;
      this.effort += hold;
      this.effortDown += hold * 0.5;
    }
    this.reliefLevel += (clamp(reliefPush, 0, 1) - this.reliefLevel) * Math.min(1, dt * 12);
    this.motionLevel += (motion - this.motionLevel) * Math.min(1, dt * 10);
    this.applyJolt(dt, shock, pitchImp, rollImp, working, joltCause.why);

    // 흙 장부용: 이번 스텝 버킷이 움직여 버킷 자리로 밀고 들어간 흙 = 깎기 전 지형에서 (끝 자세 점유 흙 - 처음 자세 점유 흙)
    const motionVol = ledgerOn ? Math.max(0, this.occupiedSoil([...path, { ...this.pose }]) - occ0) : 0;
    // 2) 흙 상호작용
    // 흙은 압축되지 않는다 (부피 배정): 깊이 묻혀(지표로 못 솟는 깊이) 흙을 미는 이동은, 이번 스텝 흙 처리를 실제로 해 보고
    // 밀어낸 흙이 모두 버킷에 담겼는지 본다. 남는 흙이 있으면(갈 곳 없음) 흙 처리와 이번 스텝 이동을 통째로 되돌려 막음
    const rising = (fa: Frame, fb: Frame) =>
      fb.P2.y + fb.tip.y - fa.P2.y - fa.tip.y > 0.7 * (Math.hypot(fb.P2.r - fa.P2.r, fb.P2.y - fa.P2.y) + Math.hypot(fb.tip.r - fa.tip.r, fb.tip.y - fa.tip.y));
    const deepPush =
      motionVol > 0 && !rising(prevFrame, this.frame) && this.coverDepth(this.frame, this.pose.swing) > this.params.heaveDepth;
    const snap = deepPush ? this.soilSnapshot() : null;
    let motionAcc = motionVol;
    let cutTotal = 0;
    if (working || this.phase === 'ready') {
      this.ledgerOn = true;
      cutTotal = this.interactSoil(dt) + this.relaxCleared;
      this.ledgerOn = false;
      if (snap && motionVol - Math.min(motionVol, this.stepIntake) > 0.01 * motionVol + 1e-9) {
        this.soilRestore(snap);
        this.pose = { ...path[0] };
        this.frame = fk(this.m, this.pose);
        this.prevBucketAngle = this.pose.bucket;
        this.bucketRate = 0;
        let lever = 0;
        for (const j of ['swing', 'boom', 'arm', 'bucket'] as const) {
          if (Math.abs(tgt[j]) > 1e-6) lever = Math.max(lever, Math.abs(tgt[j]) / Math.max(sp[j], 1e-6));
          this.vel[j] = 0;
        }
        this.pressBlocks++;
        this.pressRatio = Math.max(this.pressRatio, 1.01);
        this.pressEff += lever * 0.02;
        cutTotal = 0;
        motionAcc = 0;
      }
    } else {
      this.frontCutting = false;
      this.releaseSurcharge();
    }
    this.relaxCleared = 0;
    // 평탄 왕복: 첫 덤프 뒤 C 구덩이 위에서 버킷이 흙에 닿은(3cm 이내) 스텝마다 날의 수평 이동을 당기기·밀기로 나눠 누적
    // (버킷 등으로 밀든 날로 끌든 같음. 주로 위아래로 움직인 스텝은 제외)
    const tp = this.flatTipPrev;
    if (tp && working && this.dumpCount >= 1 && this.stationOf(toWorld(this.pose.swing, this.frame.tip))?.name === 'C' && this.groundGap() < 0.03) {
      const dr = this.frame.tip.r - tp.r;
      if (Math.abs(dr) > 0.7 * Math.hypot(dr, this.frame.tip.y - tp.y)) {
        if (dr > 0) this.flattenPushDist += dr;
        else this.flattenPullDist -= dr;
      }
      // 화면 표시용 긁은 자국: 흙에 닿은(3cm 이내) 버킷 밑면 칸에 닿은 시각만 기록 (흙 높이·판정과 무관)
      const gC = this.soil.grids.find((g) => g.name === 'C');
      if (gC)
        for (const row of this.underWorld(this.frame, this.pose.swing))
          for (const q of row) {
            const k = gC.cellAt(q.x, q.z);
            if (k >= 0 && q.y - gC.h[k] < 0.03) {
              gC.touch[k] = this.t;
              gC.touchLast = this.t;
            }
          }
    }
    this.flatTipPrev = { r: this.frame.tip.r, y: this.frame.tip.y };
    // 흙 장부 (매 스텝): 버킷이 민 흙 motionVol(경로 점유 - 처음 점유, 흘러든 흙은 빠짐)과 실제 배정의 차이.
    // 배정되는 곳: 버킷에 담김(stepIntake), 지표로 솟음·날 앞 흙더미(얕을 때만), 위로 빠져나오며 덮인 흙을 들어 올림.
    // 깊이 묻혀(지표로 못 솟는 깊이) 위로 빠지는 것도 아니면 버킷에 담긴 양만 배정
    {
      const f0 = prevFrame;
      const f1 = this.frame;
      this.dispTotal += motionAcc;
      const surfaceOK = rising(f0, f1) || this.coverDepth(f1, this.pose.swing) <= this.params.heaveDepth;
      const assigned = surfaceOK ? motionAcc : Math.min(motionAcc, this.stepIntake);
      this.unassignedTotal += motionAcc - assigned;
    }
    this.cutRate += (cutTotal / dt - this.cutRate) * Math.min(1, dt * 10);
    this.pushRate += (this.pushStep / dt - this.pushRate) * Math.min(1, dt * 10);
    this.pushStep = 0;


    // 3) 암으로 흙 속을 끌 때 안쪽까지 눌러 담는다.
    this.packSoil(dt, cutTotal > 0);
    // 쏟기, 입자
    // 날 앞이 흙(깎는 흙이나 덧쌓임)에 막혀 있으면 입구로 쏟아지지 않음
    this.pour(dt, this.frontCutting || this.surcharge > 0.005);
    this.updateParticles(dt);
    this.pourRate += (this.pourStep / dt - this.pourRate) * Math.min(1, dt * 12);
    this.landRate += (this.landStep / dt - this.landRate) * Math.min(1, dt * 12);
    this.pourStep = 0;
    this.landStep = 0;
    for (const g of this.soil.grids) {
      if (g.activeT > 0) {
        g.activeT -= dt;
        g.relax(this.talus, 4, this.params.wallStableHeight); // 밀린 흙더미가 안식각(35°)으로 흘러내리게 (1~2회면 쌓이는 속도를 못 따라가 벽처럼 솟음)
      }
    }
    // 흘러내린 흙이 버킷 안 공간으로 다시 들어오면 비움 (덧쌓임으로)
    if (working || this.phase === 'ready') this.relaxCleared += this.clearBucketSpace(this.frame, this.pose.swing, this.sur.dir);

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
          this.report('D-STALL', '낮은 RPM에서 무리하게 파서 엔진 정지');
        }
      } else this.stallT = Math.max(0, this.stallT - dt);
      // 시간
      if (this.flags.timeLimit && !this.timeReported && this.t > this.params.digTimeLimitSec) {
        this.timeReported = true;
        this.report('D-TIME', '4분 초과');
      }
      this.trackCycles();
      if (this.flags.autoEnd) this.checkEnd(dt);
    }
    this.simMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  }

  /** 굴착 저항 → 엔진 부하 → 과부하 경고·차체 들림 */
  private updateLoad(dt: number) {
    const power = this.params.powerBase + this.params.powerPerRpm * clamp(this.rpm, 0, 1);
    this.effortRate += (this.effort / dt - this.effortRate) * Math.min(1, dt * 10);
    // 흙 무게를 드는 일: 붐 올림·선회·암에 실린 흙만큼 엔진이 힘듦 (소리가 무거워짐)
    const wf = clamp(this.load / this.heapedCap, 0, 1);
    const sp = this.m.speeds;
    const carry = wf * this.params.loadEngine * (Math.max(0, this.vel.boom) / sp.boom + 0.5 * Math.abs(this.vel.swing) / sp.swing + 0.3 * Math.abs(this.vel.arm) / sp.arm);
    const eTot = this.effort + this.pressEff;
    const target = this.engineOn ? eTot / dt / power + carry : 0;
    this.engineLoad += (target - this.engineLoad) * Math.min(1, dt / 0.25);
    const downFrac = eTot > 1e-9 ? (this.effortDown + this.pressEffDown) / eTot : 0;
    this.effort = 0;
    this.effortDown = 0;
    this.pressEff = 0;
    this.pressEffDown = 0;
    // 아래로 누르는 과부하만큼 버킷 쪽 차체가 들린다
    const maxL = (this.params.liftMaxDeg * Math.PI) / 180;
    this.downAvg += (downFrac - this.downAvg) * Math.min(1, dt / 0.3);
    const want = clamp(this.overloadAcc * 0.45 * (0.4 + 0.6 * this.downAvg), 0, maxL);
    this.lift += (want - this.lift) * Math.min(1, dt / (want > this.lift ? 0.35 : 0.2));
    this.overloadAcc = this.overloadAcc * Math.exp(-dt / 1.5) + Math.max(0, this.engineLoad - 1) * dt;
    this.maxOverloadAcc = Math.max(this.maxOverloadAcc, this.overloadAcc);
    if (this.overloadAcc > this.params.overloadWarnSec)
      this.report('W-OVERLOAD', this.lastBite > this.params.curlFree ? '너무 깊이 물었음: 붐 살짝 올려 얕게' : '날 방향이 아니라 밀고 있음: 각도를 바꾸거나 얕게');
    if (this.lift > (this.params.liftWarnDeg * Math.PI) / 180) this.report('W-LIFT', '땅을 너무 눌러 차체가 들림');
    // 안전사고·장비 손상 우려 (Q2): 시험 순서 모드에서만 실격
    if (this.flags.timeLimit && this.lift > (this.params.liftFailDeg * Math.PI) / 180) this.report('D-LIFT', '버킷으로 땅을 눌러 차체가 크게 들림');
  }

  /** 충격 → 차체 흔들림, 경고, 고봉 흙 쏟아짐 */
  private applyJolt(dt: number, shock: number, pitchImp: number, rollImp: number, working: boolean, why: 'release' | 'reverse' | 'stroke') {
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
    if (working) this.maxJolt = Math.max(this.maxJolt, shock);
    this.joltCd -= dt;
    if (!working || shock < this.params.joltWarn) return;
    if (this.joltCd <= 0) {
      this.jolts++;
      this.joltCd = 0.6;
      const msg = {
        release: '레버를 갑자기 놓음: 서서히 놓으세요',
        reverse: '레버를 반대로 확 꺾음: 멈춘 뒤 바꾸세요',
        stroke: '실린더 끝에 세게 닿음',
      }[why];
      this.report('W-JOLT', msg);
    }
    // 고봉으로 담긴 흙은 충격에 쏟아진다
    const sc = this.m.struckCapacity;
    if (shock >= this.params.joltSpill && this.load > sc) {
      const v = Math.min(this.load - sc, (this.load - sc) * clamp(shock, 0, 1) + 0.01);
      if (this.isCarrying()) this.carrySpill += v;
      this.load -= v;
      this.pourStep += v;
      this.loadBack = Math.min(this.loadBack, this.load);
      const W = this.m.bucketWidth;
      const n = Math.max(1, Math.min(6, Math.round(v / 0.004)));
      for (let i = 0; i < n; i++) {
        const tip = toWorld(this.pose.swing, this.frame.tip, (this.rand() - 0.5) * W * 0.8);
        const p = { p: tip, v: v3((this.rand() - 0.5) * 0.8, 0.3, (this.rand() - 0.5) * 0.8), vol: v / n, id: this.particleId++ };
        if (this.particles.length < 140) this.particles.push(p);
        else this.land(tip, v / n);
      }
    }
  }

  /**
   * 버킷 면이 흙을 미는 데 필요한 힘 (kN). fa → fb로 움직일 때 바깥쪽으로 나아가는 윤곽 면마다
   *  - 아래를 향한 면(바닥·힐로 누름): 지지력 γ(B/2·Nγ + D·Nq) + c·Nc — 흙이 옆·위로 빠지려면 지반이 파괴돼야 함
   *  - 옆을 향한 면(등으로 밂): 수동토압 γ·D·Kp + 2c√Kp — 깊을수록 위 흙을 들어 올려야 해 무거움
   *  - 위를 향한 면: 위 흙 무게 γ·D + c
   *  - 입구 면: 버킷 안으로 들어가는 몫은 힘이 안 들고, 나머지는 수동토압(+점착력). 날 앞 흙더미에 자리가 있으면 30cm까지는 거기로
   * D = 면 앞쪽(10·30·50cm) 지표 기준 깊이. 면과 거의 나란히 움직이면(입사 20° 미만) 가르며 지나감
   */
  private facePress(fa: Frame, fb: Frame, swing: number, j: 'boom' | 'arm' | 'bucket'): { F: number; Fdown: number; Dw: number; Aw: number; intake: number } {
    const out = { F: 0, Fdown: 0, Dw: 0, Aw: 0, intake: 0 };
    const pb = bucketOutline(this.m, fb);
    let lowY = Infinity;
    for (const q of pb) lowY = Math.min(lowY, q.y);
    const tw = toWorld(swing, fb.tip);
    if (lowY > this.soil.surfaceAt(tw.x, tw.z) + 0.3 && lowY > 0.3) return out; // 흙 근처가 아니면 생략
    const pa = bucketOutline(this.m, fa);
    let area2 = 0;
    for (let a = 0; a < pb.length; a++) {
      const b = (a + 1) % pb.length;
      area2 += pb[a].r * pb[b].y - pb[b].r * pb[a].y;
    }
    const sgn = area2 > 0 ? 1 : -1; // 반시계면 바깥 = 진행 방향 오른쪽
    // 날(이빨)이 진행 방향 맨 앞에서 길을 내는지: 그러면 뒤따르는 비탈진 바닥은 날이 가른 틈으로 흙을 옆으로 밀며 들어감.
    // 날이 앞장서지 않으면(등·힐·둥근 바닥이 먼저) 비탈진 면도 흙을 갈라 줄 날이 없어 지반을 눌러야 함(지지력)
    let mr = 0;
    let my = 0;
    for (let a = 0; a < pb.length; a++) {
      mr += pb[a].r - pa[a].r;
      my += pb[a].y - pa[a].y;
    }
    const ml = Math.hypot(mr, my);
    let tipLeads = true;
    if (ml > 1e-9) {
      const pj = pb.map((q) => (q.r * mr + q.y * my) / ml);
      tipLeads = pj[pb.length - 1] >= Math.max(...pj) - 0.05;
    }
    const P = this.params;
    const W = this.m.bucketWidth;
    const c = Math.cos(swing);
    const sn = Math.sin(swing);
    const surf = (r: number, l: number) => this.soil.surfaceAt(r * c - l * sn, r * sn + l * c);

    // 입구로 들어가는 몫: 버킷이 덜 찼을 때, 오므림은 curlIntake, 암·붐은 입구 방향으로 움직인 정도
    const roomy = this.load < this.lastFillLimit - 1e-3;
    const nO = fb.nOpen;
    const tr = fb.tip.r - fa.tip.r;
    const ty = fb.tip.y - fa.tip.y;
    const tl = Math.hypot(tr, ty);
    // 아래로 찌르는 이동은 입구로 담기지 않음 (interactSoil의 담기 규칙과 같게)
    const stab = tl > 1e-6 && ty < -0.6 * tl;
    const align = tl > 1e-6 && !stab ? clamp(((tr * nO.r + ty * nO.y) / tl - 0.2) / 0.5, 0, 1) : 0;
    // 오므리며 같이 당기면(정석) 오므림이 긁은 흙도 당김에 쓸려 들어감
    const intake = roomy ? (j === 'bucket' ? Math.max(P.curlIntake, this.lastPullIntake) : align) : 0;
    out.intake = intake;
    const surFull = this.surcharge >= 0.95 * this.surchargeCap();
    const lats = [-W / 3, 0, W / 3];
    for (let a = 0; a < pb.length; a++) {
      const b = (a + 1) % pb.length;
      const mouth = a === pb.length - 1;
      const er = pb[b].r - pb[a].r;
      const ey = pb[b].y - pb[a].y;
      const el = Math.hypot(er, ey);
      if (el < 1e-6) continue;
      const nr = (sgn * ey) / el;
      const ny = (-sgn * er) / el;
      const ns = Math.max(1, Math.ceil(el / 0.12));
      const dA = (el / ns) * (W / lats.length);
      for (let k = 0; k < ns; k++) {
        const t = (k + 0.5) / ns;
        const r1 = pb[a].r + er * t;
        const y1 = pb[a].y + ey * t;
        const vr = r1 - (pa[a].r + (pa[b].r - pa[a].r) * t);
        const vy = y1 - (pa[a].y + (pa[b].y - pa[a].y) * t);
        const vl = Math.hypot(vr, vy);
        if (vl < 1e-7) continue;
        const vn = (vr * nr + vy * ny) / vl;
        // 진행 방향으로 받는 힘 = 면압 × 면적 × 면이 진행 방향을 향한 정도(vn). 20° 미만으로 비스듬히 지나가면 가름(0)
        const w = vn * clamp((vn - 0.34) / 0.3, 0, 1);
        if (w <= 0) continue;
        for (const l of lats) {
          // 닿음: 아래로 누르는 면은 바로 밑(10cm 앞) 흙, 옆·위·입구 면은 앞쪽 지표가 이 점보다 높음.
          // (높이맵은 묻힌 버킷 위 흙을 덧쌓임으로 옮겨 두므로, 버킷 자리 칸만 보지 않고 더 앞 지표로 묻힘을 판단)
          const ra = r1 + nr * 0.1;
          const xa = ra * c - l * sn;
          const za = ra * sn + l * c;
          const hA = this.soil.surfaceAt(xa, za);
          // 위 흙 두께는 면 앞쪽(흙이 밀려 나갈 쪽) 지표로 (양옆 구덩이 벽은 상관없음)
          const amb = Math.max(hA, surf(r1 + nr * 0.3, l), surf(r1 + nr * 0.5, l));
          if ((ny < -0.5 ? hA : amb) <= y1 + 1e-4) continue;
          const D = Math.max(0, amb - y1);
          let p: number;
          const cc = this.soil.firmAt(xa, za) > y1 ? P.pressCohesion : 0;
          if (mouth) {
            // 버킷이 못 받는 흙은 수동 파괴로 밀려 나가야 함 (다져진 흙이면 점착력도).
            // 날 앞 흙더미에 자리가 남았으면 얕은 몫(30cm 이내)은 지표로 솟아 흙더미가 됨. 흙더미가 차면 그 자리도 없음
            const free = surFull ? 0 : 0.3;
            const deep = free > 0 ? clamp((D - free) / 0.3, 0, 1) : 1;
            p = (P.pressGamma * Math.max(0, D - free) * P.pressKp + 2 * cc * Math.sqrt(P.pressKp) * deep) * (1 - intake);
          } else {
            // 날이 앞장서면 거의 수평으로 아래를 향한 면(약 25° 이내)만 지지력, 비탈진 면은 날이 가른 틈으로 흙이 옆으로 밀려남(수동토압).
            // 날이 앞장서지 않으면 아래쪽(60° 이내)을 향한 면은 모두 지지력
            const down = tipLeads ? clamp((-ny - 0.88) / 0.08, 0, 1) : clamp((-ny - 0.45) / 0.2, 0, 1);
            const up = clamp((ny - 0.88) / 0.08, 0, 1);
            const side = 1 - down - up;
            const qb = P.pressGamma * (0.5 * P.pressB * P.pressNg + D * P.pressNq) + cc * P.pressNc;
            const pp = P.pressGamma * D * P.pressKp + 2 * cc * Math.sqrt(P.pressKp);
            const pu = P.pressGamma * D + cc;
            p = down * qb + side * pp + up * pu;
            out.Fdown += w * down * qb * dA;
          }
          out.F += w * p * dA;
          // 버킷이 못 받는 흙을 미는 면의 평균 깊이 (지표로 솟을 수 있는지)
          const aw = w * dA * (mouth ? 1 - intake : 1);
          out.Aw += aw;
          out.Dw += aw * D;
        }
      }
    }
    return out;
  }

  /** 버킷 하부가 단단한 바닥 아래로 들어간 깊이 */
  private penetration(f: Frame, swing: number) {
    let depth = 0;
    let bite = 0;
    const each: number[] = [];
    const rows = this.underWorld(f, swing);
    for (let r = 0; r < rows.length; r++) {
      for (const p of rows[r]) {
        const d = this.soil.floorAt(p.x, p.z) - p.y;
        each.push(d);
        if (d > depth) depth = d;
      }
    }
    // 묻힌 깊이: 날 끝에서 버킷이 나아가는 쪽 25cm 앞 흙 높이 - 날 끝 높이 (보통은 끌어오는 장비 쪽).
    // 뒤쪽 벽·옆(구덩이 밖 지면)은 버킷이 밀고 가는 흙이 아니라 재지 않음
    {
      const row0 = rows[0];
      const p = row0[Math.floor(row0.length / 2)];
      const sx = Math.cos(swing);
      const sz = Math.sin(swing);
      // 버킷이 나아가는 쪽 흙: 바깥으로 밀면 바깥, 아니면 장비 쪽
      const out = this.tipDr > 0.002 ? 1 : -1;
      // 밀려 올라온 흐트러진 흙더미는 빼고 다져진 흙 높이로, 15·30cm 두 점 평균 (튀는 값 완화)
      // 날 끝 앞 15·30cm (이제 깎을 흙 두께). 그 자리가 버킷 윤곽 안이면(버킷 공간으로 비워진 곳) 윤곽 밖까지 5cm씩 더 나가서 잼
      const poly = bucketOutline(this.m, f);
      const inside = (r: number, y: number) => {
        let c = false;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const A = poly[a];
          const B = poly[b];
          if (A.y > y !== B.y > y && r < ((B.r - A.r) * (y - A.y)) / (B.y - A.y) + A.r) c = !c;
        }
        return c;
      };
      const fa = (d0: number) => {
        let d = d0;
        for (let k = 0; k < 12; k++) {
          const r = f.tip.r + out * d;
          const y = this.soil.firmAt(p.x + out * sx * d, p.z + out * sz * d);
          if (!inside(r, Math.min(y, f.tip.y + 0.3))) return y;
          d += 0.05;
        }
        return this.soil.firmAt(p.x + out * sx * d, p.z + out * sz * d);
      };
      const around = (fa(0.15) + fa(0.3)) / 2;
      bite = Math.max(0, around - p.y);
    }
    return { depth, each, bite };
  }

  private interactSoil(dt: number): number {
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
    // 버킷 오므림이 주된 동작이면 날이 원래 가르는 길(원호)이라 '나쁜 각도'가 아니고, 차체를 누르지도 않는다
    const curlDom = clamp(-this.bucketRate / (0.3 * this.m.speeds.bucket), 0, 1);
    const misBucket = (tml > 1e-5 ? 1 - Math.max(0, dot(tmv, bladeW) / tml) : 0.5) * (1 - 0.7 * curlDom);
    const downBucket = (tml > 1e-5 ? clamp(-tmv.y / tml, 0, 1) : 0.5) * (1 - 0.8 * curlDom);
    this.lastMis = misBucket;
    this.tipDr = dot(tmv, v3(Math.cos(swing), 0, Math.sin(swing)));
    // 날 이동 = 버킷 오므림(회전) + 암·붐으로 끄는 이동. 흙이 버킷 바닥을 타고 들어오는 건 끄는 이동뿐:
    // 오므리기만 하면 깎인 흙은 날 앞에 쌓이고, 각도를 맞춰 암을 당겨야 그 흙이 안으로 쓸려 들어간다
    let pmv = tmv;
    if (this.soilBucketPrev !== null) {
      const fb = fk(this.m, { ...this.pose, bucket: this.soilBucketPrev });
      const tb = toWorld(swing, { r: fb.tip.r, y: fb.tip.y });
      const tn = toWorld(swing, { r: f.tip.r, y: f.tip.y });
      pmv = sub(tmv, sub(tn, tb));
    }
    this.soilBucketPrev = this.pose.bucket;
    const pml = len(pmv);
    // 끄는 이동이 입구 방향과 맞는 정도 (0~1)
    // 붐으로 아래로 찔러 넣는 이동은 끄는 게 아니라 박는 것 (입구가 아래를 향해도 흙이 쓸려 들어오지 않음)
    const pullDown = pml > 1e-5 ? clamp(-pmv.y / pml, 0, 1) : 0;
    const pullAlign = pml > 1e-5 ? clamp((dot(pmv, nOpenW) / pml - 0.2) / 0.5, 0, 1) * clamp((0.75 - pullDown) / 0.35, 0, 1) : 0;
    // 입구 한도: 깎인 흙이 버킷 바닥을 타고 들어올 수 있는 양은 '폭 × 입구 두께 × 날 이동 거리'까지.
    // 그보다 많이 깎이면(깊게 박음) 남는 흙은 앞으로 밀려 쌓인다(불도저처럼).
    // 버킷이 찰수록 입구가 막혀 덜 들어오고, 오므려 주면 안쪽에 자리가 생겨 다시 들어온다 (끌기만 하면 반쯤에서 막힘).
    // 너무 일찍 끝까지 오므리면 입구가 좁아져 덜 들어온다.
    const curlNow = clamp(-this.bucketRate / (0.25 * this.m.speeds.bucket), 0, 1);
    const SC = this.m.struckCapacity;
    // 반쯤 오므려 둔 자세로 끌면(정석) 입구 흙이 안쪽으로 밀려 평적까지, 고봉은 오므리는 동작이 있어야
    const heldNow = clamp((-this.pose.bucket - (20 * Math.PI) / 180) / ((25 * Math.PI) / 180), 0, 1);
    const dragLim = SC * (this.params.dragFillRatio + (1 - this.params.dragFillRatio) * Math.max(curlNow, heldNow));
    const fillLimit = dragLim + (this.heapedCap - dragLim) * curlNow;
    this.lastFillLimit = Math.max(fillLimit, dragLim + (this.heapedCap - dragLim) * 0.5);
    const room = clamp((fillLimit - this.load) / (0.25 * SC), 0, 1);
    const openF = clamp((this.pose.bucket - this.m.limits.bucket[0]) / ((35 * Math.PI) / 180), 0.25, 1);
    // 격자 칸을 지날 때 몰아서 깎이므로 한도는 몇 칸 분량까지 모아 둔다
    const bankMax = this.m.bucketWidth * cell * 2 * this.params.throatDepth;
    // 날이 흙에 들어가 있을 때만 쌓임 (허공에서 버킷을 휘저어 미리 모아 두지 못하게)
    let frontIn = false;
    for (const p of under[0]) {
      const g = this.soil.gridAt(p.x, p.z);
      if (g && g.h[g.cellAt(p.x, p.z)] > p.y) {
        frontIn = true;
        break;
      }
    }
    // 오므림(회전)으로 날이 입구 방향으로 긁는 몫도 일부는 입구로 들어옴 (입구 쪽에만 조금 쌓임). 나머지는 날 앞 흙더미로
    const rmv = sub(tmv, pmv);
    const rml = len(rmv);
    const rotAlign = rml > 1e-5 ? clamp((dot(rmv, nOpenW) / rml - 0.2) / 0.5, 0, 1) : 0;
    this.lastPullIntake = pullAlign * clamp(pml / Math.max(1e-6, 0.5 * rml), 0, 1);
    const bankStep = this.m.bucketWidth * (pml * pullAlign + this.params.curlIntake * rml * rotAlign) * this.params.throatDepth * room * openF;
    if (frontIn) this.throatBank = Math.min(bankMax, this.throatBank + bankStep);
    else this.throatBank = Math.min(this.throatBank, bankStep);
    if (room <= 0) this.throatBank = 0;
    let frontCut = false;
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
        if (s === 0) frontCut = true;
        // 흐트러진 흙은 밀어낸 것을 다시 미는 경우가 많아 아주 가볍게(5%) 센다
        const hard = g.lastFirmCut + (vol - g.lastFirmCut) * 0.05;
        {
          // 굴착 저항 = 흙 단단함 × 부위 × 각도 나쁨
          //  - 다져진 흙(원래 지면·벽)이 흐트러진 흙보다 무겁다
          //  - 날이 가른 길을 몸통이 따라가므로 몸통 줄은 절반
          //  - 날이 날 방향(힐→끝)으로 움직이면 가볍고, 등·바닥으로 밀면 무겁다 (버킷 전체 기준 misBucket)
          // 날 끝: 날 방향으로 가르면 가볍고, 힐(등) 쪽이 앞장서면 무겁다
          // 몸통: 날이 앞장서면 이미 갈라진 길을 따라가므로, 몸통이 다져진 흙을 깎는 것 자체가 나쁜 각도의 신호
          const e = s === 0 ? hard * (0.3 + 2 * misBucket) : hard * (1.5 - 0.8 * curlDom);
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
        const frac = stabbing && curl < 0.2 ? 0 : Math.max(align, pullAlign) * (0.35 + 0.65 * curl);
        const front = s === 0;
        if (front && frac > 0 && this.load < this.heapedCap) {
          // 평적을 넘긴 뒤에는 흙이 흘러내려 조금씩만 더 쌓인다
          // 고봉은 오므림을 유지하며 긁을 때만 (끌기만 하면 평적에서 멈춤)
          const heapF = this.load >= this.m.struckCapacity ? (curl > 0.3 ? this.params.heapIntake : 0) : 1;
          const take = Math.max(0, Math.min(vol * frac * heapF, this.heapedCap - this.load, this.throatBank, Math.max(0, fillLimit - this.load)));
          this.throatBank -= take;
          this.load += take;
          if (this.ledgerOn) this.stepIntake += take;
          if (g.name === 'A') this.cycle.cutInA += take;
          if (vol > take) {
            // 밀리는 흙 저항: 다져진 흙 위주 (흐트러진 흙을 다시 미는 건 가볍게)
            this.pushStep += (vol - take) * (hard / vol);
            this.addSurcharge(g, vol - take, mv);
          }
        } else {
          const flat = g.name === 'C' && this.dumpCount >= 1;
          this.pushStep += hard * (flat ? 0.5 : 1);
          // 버킷이 민 흙은 덧쌓임으로 (평탄 작업은 판정 때문에 지금처럼 바로 지형에).
          // 몸통 줄이 깎은 흙도 버킷 자리의 흙이라 같은 덧쌓임으로 (깊은 자리에서 옆 칸으로 바로 밀어 넣으면 압축된 셈)
          if (!flat) this.addSurcharge(g, vol, mv);
          else this.push(g, p, mv, center, vol, cell, flat);
          if (g.name === 'C' && this.dumpCount >= 1) {
            this.flattenVol += vol;
            const openish = this.pose.bucket >= this.m.limits.bucket[1] - (25 * Math.PI) / 180;
            const outward = dot(sub(p, prow[i]), v3(Math.cos(swing), 0, Math.sin(swing))) > 0;
            if (openish && outward) this.flattenOpenVol += vol;
          }
        }
      }
    }
    // 버킷이 지나간 경로: 날이 반 칸 넘게 움직였으면 중간 자세들도 (빠르게 휘둘러도 공간이 빠짐없이 비워지게)
    const pp = this.soilPosePrev;
    // 버킷 윤곽 점 중 가장 많이 움직인 거리 기준으로 반 칸 간격 (회전으로 등·힐이 날보다 더 움직이는 경우 포함)
    let bodyMove = tml;
    if (pp) {
      const fp = fk(this.m, pp);
      const a0 = bucketOutline(this.m, fp);
      const a1 = bucketOutline(this.m, f);
      for (let q = 0; q < a0.length; q++) {
        const p0 = toWorld(pp.swing, a0[q]);
        const p1 = toWorld(swing, a1[q]);
        bodyMove = Math.max(bodyMove, Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z));
      }
    }
    // 한 스텝에 50cm 넘게 움직였으면 조작이 아니라 자세를 바로 놓은 것(setPose·teleport): 경로 없음
    if (pp && bodyMove > cell / 2 && bodyMove < 0.5) {
      // 한 스텝 유압 이동은 몇 cm라 보통 1~2분할, 32분할이면 50cm까지 반 칸 간격 보장
      const n = Math.min(32, Math.ceil(bodyMove / (cell / 2)));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const q: Pose = { swing: pp.swing + (swing - pp.swing) * t, boom: pp.boom + (this.pose.boom - pp.boom) * t, arm: pp.arm + (this.pose.arm - pp.arm) * t, bucket: pp.bucket + (this.pose.bucket - pp.bucket) * t };
        total += this.clearBucketSpace(fk(this.m, q), q.swing, pmv);
      }
    }
    total += this.clearBucketSpace(f, swing, pmv);
    this.soilPosePrev = { ...this.pose };
    this.updateSurcharge(dt, under, frontIn, tmv, tml, pullAlign, curlNow, fillLimit);
    this.prevUnder = under;
    this.frontCutting = frontCut;
    return total;
  }

  /**
   * 버킷이 차지한 공간의 흙 비우기: 버킷 단면(핀·끝·바닥) 안에 들어온 지형, 그리고 입구가 위를 향할 때 입구 아래 칸은
   * 버킷 바닥 높이까지 깎아 날 앞 덧쌓임으로 보낸다 (버킷 속 흙은 load로 따로 있으므로 지형이 버킷 안을 덮지 않게).
   * 하부 샘플 점만 깎으면 묻힌 버킷 입구 위로 지면이 남아 조금만 담겨도 꽉 차 보였다
   */
  /**
   * 미리 재기: 이 자세의 버킷(윤곽 + 밑면 줄·이빨)이 차지한 자리에 지금 든 흙 부피 (깎지 않음).
   * 같은 지형에서 직전 자세 값과의 차이가 이번 이동으로 버킷이 밀고 들어간 흙 (흘러든 흙은 두 값에 같이 들어 빠짐)
   */
  private occupiedSoil(poses: Pose[]): number {
    // 칸마다 경로 중 버킷(윤곽·밑면 줄·이빨)이 가장 낮게 차지한 높이 → 그 위의 흙 (칸마다 한 번)
    const cellMin = new Map<number, number>();
    const cell = this.params.soilCell;
    let prev: Pose | null = null;
    let fPrev: Frame | null = null;
    for (const q of poses) {
      const fq = fk(this.m, q);
      let n = 1;
      if (prev && fPrev) {
        // 이동 경로: 윤곽 점이 가장 많이 움직인 거리 기준 반 칸 간격 (interactSoil 경로와 같은 규칙, 최대 32분할)
        const a0 = bucketOutline(this.m, fPrev);
        const a1 = bucketOutline(this.m, fq);
        let mvMax = 0;
        for (let k = 0; k < a0.length; k++) {
          const p0 = toWorld(prev.swing, a0[k]);
          const p1 = toWorld(q.swing, a1[k]);
          mvMax = Math.max(mvMax, Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z));
        }
        n = Math.min(32, Math.max(1, Math.ceil(mvMax / (cell / 2))));
      }
      for (let k = prev ? 1 : 0; k <= (prev ? n : 0); k++) {
        const t = prev ? k / n : 1;
        const pp: Pose = prev
          ? { swing: prev.swing + (q.swing - prev.swing) * t, boom: prev.boom + (q.boom - prev.boom) * t, arm: prev.arm + (q.arm - prev.arm) * t, bucket: prev.bucket + (q.bucket - prev.bucket) * t }
          : q;
        this.occCells(k === n || !prev ? fq : fk(this.m, pp), pp.swing, cellMin);
      }
      prev = q;
      fPrev = fq;
    }
    let vol = 0;
    for (const [key, y] of cellMin) {
      const g = this.soil.grids[Math.floor(key / 1e7)];
      const k = key % 1e7;
      if (g.name === 'C' && this.dumpCount >= 1) continue;
      vol += Math.max(0, g.h[k] - y) * g.area;
    }
    return vol;
  }

  /** 한 자세의 버킷이 차지한 칸과 가장 낮은 높이를 cellMin에 더함 (흙 위로 떠 있으면 생략) */
  private occCells(f: Frame, swing: number, cellMin: Map<number, number>) {
    const rows = this.underWorld(f, swing);
    let above = true;
    for (const row of rows) for (const p of row) if (p.y < this.soil.surfaceAt(p.x, p.z) + 0.02) above = false;
    if (above)
      for (const q of bucketOutline(this.m, f)) {
        const w = toWorld(swing, q);
        if (w.y < this.soil.surfaceAt(w.x, w.z) + 0.02) above = false;
      }
    if (above) return;
    for (const row of rows)
      for (const p of row) {
        const gi = this.soil.grids.findIndex((g) => g.cellAt(p.x, p.z) >= 0);
        if (gi < 0) continue;
        const key = gi * 1e7 + this.soil.grids[gi].cellAt(p.x, p.z);
        const y = cellMin.get(key);
        if (y === undefined || p.y < y) cellMin.set(key, p.y);
      }
    this.clearBucketSpace(f, swing, v3(0, 0, 0), true, cellMin);
  }

  private clearBucketSpace(f: Frame, swing: number, mv: V3, dry = false, rowMin?: Map<number, number>): number {
    const poly = bucketOutline(this.m, f);
    const W = this.m.bucketWidth;
    const c = Math.cos(swing);
    const sn = Math.sin(swing);
    let rMin = Infinity;
    let rMax = -Infinity;
    for (const q of poly) {
      rMin = Math.min(rMin, q.r);
      rMax = Math.max(rMax, q.r);
    }
    // 버킷 투영 AABB (+한 칸)
    const cell = this.params.soilCell;
    const xs: number[] = [];
    const zs: number[] = [];
    for (const r of [rMin, rMax])
      for (const l of [-W / 2, W / 2]) {
        xs.push(r * c - l * sn);
        zs.push(r * sn + l * c);
      }
    const x0 = Math.min(...xs) - cell;
    const x1 = Math.max(...xs) + cell;
    const z0 = Math.min(...zs) - cell;
    const z1 = Math.max(...zs) + cell;
    const flat = this.dumpCount >= 1;
    let total = 0;
    for (const g of this.soil.grids) {
      if (flat && g.name === 'C') continue; // 평탄 작업은 기존 밀기 판정 그대로
      const i0 = Math.max(0, Math.ceil((x0 - g.ox) / g.cell));
      const i1 = Math.min(g.nx - 1, Math.floor((x1 - g.ox) / g.cell));
      const j0 = Math.max(0, Math.ceil((z0 - g.oz) / g.cell));
      const j1 = Math.min(g.nz - 1, Math.floor((z1 - g.oz) / g.cell));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = g.xOf(i);
          const z = g.zOf(j);
          const lat = -x * sn + z * c;
          if (Math.abs(lat) > W / 2) continue;
          const r = x * c + z * sn;
          if (r < rMin || r > rMax) continue;
          let ylo = Infinity;
          let yhi = -Infinity;
          for (let a = 0; a < poly.length; a++) {
            const p = poly[a];
            const q = poly[(a + 1) % poly.length];
            if ((p.r - r) * (q.r - r) > 0 || p.r === q.r) continue;
            const y = p.y + ((q.y - p.y) * (r - p.r)) / (q.r - p.r);
            ylo = Math.min(ylo, y);
            yhi = Math.max(yhi, y);
          }
          if (!(yhi > ylo)) continue;
          const k = g.idx(i, j);
          const h = g.h[k];
          if (dry && rowMin) {
            // 점유 재기: 칸마다 버킷이 차지한 가장 낮은 높이만 기록 (흙 부피는 occupiedSoil에서 한 번만 셈)
            const key = this.soil.grids.indexOf(g) * 1e7 + k;
            const ry = rowMin.get(key);
            if (ry === undefined || ylo < ry) rowMin.set(key, ylo);
            continue;
          }
          if (h <= ylo) continue;
          if (dry) {
            // 미리 재기: 이 자세로 가면 비워질 흙
            total += (h - ylo) * g.area;
            continue;
          }
          // 버킷이 차지한 높이 [ylo, yhi]와 겹치는 흙은 모두 비움. 버킷 위를 덮은 흙(묻힘)도 같이:
          // 높이맵은 버킷 아래 빈 공간을 못 나타내므로, 덮은 흙은 버킷에 얹혀 같이 밀리는 덧쌓임으로 본다
          // (암을 당기면 그 흙이 버킷으로 쓸려 들어옴)
          const vol = g.cut(k, ylo);
          if (vol <= 0) continue;
          total += vol;
          // 버킷 안 공간으로 들어오는 흙이라 날로 가르는 저항보다 훨씬 가볍다 (미는 저항은 덧쌓임 부피로 따로 셈)
          this.effort += (g.lastFirmCut + (vol - g.lastFirmCut) * 0.05) * 0.3;
          this.addSurcharge(g, vol, mv);
        }
    }
    return total;
  }

  /** 담기지 않은 흙을 날 앞 덧쌓임에 더함 */
  private addSurcharge(g: SoilGrid, vol: number, mv: V3) {
    if (this.ledgerOn) this.stepSurAdd += vol;
    this.surcharge += vol;
    this.sur.grid = g;
    const l = Math.hypot(mv.x, mv.z);
    if (l > 1e-5) this.sur.dir = v3(mv.x / l, 0, mv.z / l);
  }

  /**
   * 날 앞 덧쌓임: 버킷과 같이 밀려가며
   *  - 날이 개구부 쪽으로 움직이면 입구 한도만큼 버킷으로 굴러 들어가고
   *  - 안식각 쐐기(폭 × 높이² / 2tanφ)를 넘으면 양옆으로 흘러내려 둑이 되고
   *  - 멈추거나 들거나 반대로 움직이면 날 앞에 내려놓는다
   */
  private updateSurcharge(dt: number, under: V3[][], frontIn: boolean, tmv: V3, tml: number, pullAlign: number, curlNow: number, fillLimit: number) {
    if (this.surcharge <= 0) {
      this.sur.idle = 0;
      return;
    }
    const dir = this.sur.dir;
    const fwd = tml > 1e-5 ? (tmv.x * dir.x + tmv.z * dir.z) / tml : 0;
    const moving = tml / dt > 0.03 && fwd > 0;
    // 미는 저항·부하: 덧쌓임 부피 × 앞으로 민 거리 (날 앞 흙을 다시 깎는 대신)
    if (moving) {
      const d = tml * fwd;
      this.pushStep += this.surcharge * d * this.params.surchargeResist;
      const e = this.surcharge * d * this.params.surchargeEffort;
      this.effort += e;
      // 아래로 누르며 밀면 차체를 들어 올림
      this.effortDown += e * clamp((-2 * tmv.y) / tml, 0, 1);
    }
    // 버킷으로 굴러 들어감: 새로 깎은 흙이 먼저 쓰고 남은 입구 한도만큼
    if (frontIn && this.load < this.heapedCap) {
      const heapF = this.load >= this.m.struckCapacity ? (curlNow > 0.3 ? this.params.heapIntake : 0) : 1;
      const frac = pullAlign * (0.35 + 0.65 * curlNow) * heapF;
      const t = Math.max(0, Math.min(this.surcharge, this.throatBank * frac, this.heapedCap - this.load, fillLimit - this.load));
      if (t > 0) {
        this.surcharge -= t;
        this.throatBank -= t;
        this.load += t;
        if (this.ledgerOn) this.stepIntake += t;
        if (this.sur.grid?.name === 'A') this.cycle.cutInA += t;
      }
    }
    const row = under[0];
    // 넘침: 안식각 쐐기(폭 × 높이² / 2tanφ)보다 많으면
    const h = this.params.surchargeHeight;
    const cap = this.surchargeCap();
    if (this.surcharge > cap) {
      const over = this.surcharge - cap;
      this.surcharge = cap;
      // 쐐기를 넘친 흙은 흙더미 앞쪽 비탈로 흘러내림: 날 앞 쐐기 길이(높이/tanφ)만큼 앞에 폭 전체로.
      // 버킷이 계속 밀면 다시 덧쌓임이 되는 흙 (불도저 날 앞처럼). 옆 한 점에 몰면 벽처럼 솟음
      const ahead = h / Math.tan((this.params.reposeDeg * Math.PI) / 180);
      const n = 5;
      for (let q = 0; q < n; q++) {
        const p = row[Math.round((q * (row.length - 1)) / (n - 1))];
        this.dropAt(p.x + dir.x * ahead, p.z + dir.z * ahead, over / n);
      }
    }
    // 내려놓기: 버킷이 흙에서 빠졌거나 흙더미 반대쪽으로 물러날 때만 (멈춰 있으면 날 앞에 그대로 있음)
    const away = tml / dt > 0.03 && fwd < -0.5;
    this.sur.idle = !frontIn ? this.sur.idle + dt * 3 : away ? this.sur.idle + dt : 0;
    // 깊이 묻힌 채로는 내려놓을 데가 없음 (흙더미는 버킷과 같이 있다가 얕아지면 내려놓음)
    if (this.sur.idle > 0.3 && this.coverDepth(this.frame, this.pose.swing) <= this.params.heaveDepth) this.releaseSurcharge(row);
  }

  /** 흙 처리 시험용: 지형·흙 관련 상태 저장 / 되돌림 */
  private soilSnapshot() {
    return {
      grids: this.soil.grids.map((g) => ({ h: g.h.slice(), firm: g.firm.slice(), activeT: g.activeT, dirty: g.dirty, lastFirmCut: g.lastFirmCut })),
      v: {
        throatBank: this.throatBank,
        surcharge: this.surcharge,
        sur: { ...this.sur },
        pushStep: this.pushStep,
        effort: this.effort,
        effortDown: this.effortDown,
        stepIntake: this.stepIntake,
        stepDrop: this.stepDrop,
        stepSurAdd: this.stepSurAdd,
        spilled: this.spilled,
        load: this.load,
        loadBack: this.loadBack,
        cycle: { ...this.cycle },
        tipDr: this.tipDr,
        soilPosePrev: this.soilPosePrev,
        soilBucketPrev: this.soilBucketPrev,
        prevUnder: this.prevUnder,
        lastPullIntake: this.lastPullIntake,
        lastMis: this.lastMis,
        lastFillLimit: this.lastFillLimit,
        frontCutting: this.frontCutting,
        flattenVol: this.flattenVol,
        flattenOpenVol: this.flattenOpenVol,
        flattenPullDist: this.flattenPullDist,
        flattenPushDist: this.flattenPushDist,
      },
      entries: this.entries.length,
      posErr: this.positionErrors.length,
    };
  }
  private soilRestore(sn: ReturnType<DigSession['soilSnapshot']>) {
    this.soil.grids.forEach((g, i) => {
      const q = sn.grids[i];
      g.h.set(q.h);
      g.firm.set(q.firm);
      g.activeT = q.activeT;
      g.dirty = true;
      g.lastFirmCut = q.lastFirmCut;
    });
    Object.assign(this, sn.v);
    this.entries.length = sn.entries;
    this.positionErrors.length = sn.posErr;
  }

  /**
   * 버킷이 흙에 덮인 깊이: 버킷 윤곽의 가장 높은 점이 버킷 앞뒤(반경 방향, 윤곽 바깥 15cm) 지표 중 낮은 쪽보다 얼마나 아래인지.
   * 0보다 크면 버킷 전체가 흙 속이라 밀린 흙이 지표로 솟거나 날 앞에 쌓일 자리가 없음 (덮인 흙을 들어 올리는 수밖에 없음).
   * 버킷 자리 칸은 비워 두므로(흙은 덧쌓임으로) 그 칸 대신 바깥 지표로 잼. 자세만으로 정해져 시험·장부가 같은 값을 씀
   */
  private coverDepth(f: Frame, swing: number) {
    const poly = bucketOutline(this.m, f);
    let rMin = Infinity;
    let rMax = -Infinity;
    let top = -Infinity;
    for (const q of poly) {
      rMin = Math.min(rMin, q.r);
      rMax = Math.max(rMax, q.r);
      top = Math.max(top, q.y);
    }
    const a = toWorld(swing, { r: rMin - 0.15, y: 0 });
    const b = toWorld(swing, { r: rMax + 0.15, y: 0 });
    return Math.min(this.soil.surfaceAt(a.x, a.z), this.soil.surfaceAt(b.x, b.z)) - top;
  }
  /** 지금 자세에서 버킷이 흙에 덮인 깊이 (coverDepth, 테스트·화면용) */
  get bucketCover() {
    return this.coverDepth(this.frame, this.pose.swing);
  }

  /** 날 앞 덧쌓임 상한: 안식각 쐐기 (폭 × 높이² / 2tanφ) */
  private surchargeCap() {
    const h = this.params.surchargeHeight;
    return (this.m.bucketWidth * h * h) / (2 * Math.tan((this.params.reposeDeg * Math.PI) / 180));
  }

  /** 덧쌓임을 날 앞에 폭 전체로 내려놓음 */
  private releaseSurcharge(row: V3[] = this.underWorld(this.frame, this.pose.swing)[0]) {
    if (this.surcharge <= 0) return;
    const vol = this.surcharge;
    this.surcharge = 0;
    this.sur.idle = 0;
    if (this.ledgerOn) this.stepDrop += vol;
    const dir = this.sur.dir;
    const cell = this.params.soilCell;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const p = row[Math.round((i * (row.length - 1)) / (n - 1))];
      this.dropAt(p.x + dir.x * cell, p.z + dir.z * cell, vol / n);
    }
  }

  /** 땅 위 한 점에 흙을 내려놓음 (격자 밖이면 흘린 흙) */
  private dropAt(x: number, z: number, vol: number) {
    const g = this.soil.gridAt(x, z) ?? this.sur.grid;
    const k = g ? g.cellAt(x, z) : -1;
    if (g && k >= 0) g.depositSpread(k, vol);
    else this.spilled += vol;
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

  /** 버킷에 담기지 않은 흙을 날 앞으로 밂. flatten: 평탄 작업(C, 덤프 뒤)이면 앞·옆으로 비어져 나가게 */
  private push(g: SoilGrid, p: V3, mv: V3, center: V3, vol: number, cell: number, flatten = false) {
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
    if (flatten) {
      // 평탄: 날 앞에 쌓였다가 앞·옆으로 비어져 나감. 격자 끝이면 가장자리 칸에 (지형에서 사라지지 않게)
      const g2 = g.cellAt(tx, tz) >= 0 ? g : (this.soil.gridAt(tx, tz) ?? g);
      g2.depositPushed(p.x, p.z, dx / l, dz / l, vol);
      return;
    }
    if (this.ledgerOn) this.stepDrop += vol;
    const kk = g.cellAt(tx, tz);
    if (kk >= 0) g.depositSpread(kk, vol);
    else {
      const g2 = this.soil.gridAt(tx, tz);
      if (g2) g2.depositSpread(g2.cellAt(tx, tz), vol);
      else this.spilled += vol;
    }
  }

  /** 흙을 담아 A에서 C로 옮기는 중인지 (버킷 끝이 A·C 영역 밖) */
  isCarrying() {
    if (this.phase !== 'working') return false;
    const st = this.stationOf(toWorld(this.pose.swing, this.frame.tip))?.name ?? null;
    return st === null;
  }
  /** 버킷이 끝까지(한계 20° 이내) 오므려졌는지 */
  /** 평탄작업 인정: 민 부피가 기준 이상이고, 당겨 오기·밀어 내기를 한 번씩은 함 (왕복) */
  get flattenDone() {
    const P = this.params;
    return this.flattenVol >= P.flattenMinVolume && this.flattenPullDist >= P.flattenMinPass && this.flattenPushDist >= P.flattenMinPass;
  }
  get fullyCurled() {
    return this.pose.bucket <= this.m.limits.bucket[0] + (20 * Math.PI) / 180;
  }
  get backCap() {
    return this.m.struckCapacity * this.params.backCapRatio;
  }
  private packSoil(dt: number, soilContact: boolean) {
    const armRate = this.prevArmAngle === null ? 0 : clamp((this.prevArmAngle - this.pose.arm) / (dt * 0.25 * this.m.speeds.arm), 0, 1);
    this.prevArmAngle = this.pose.arm;
    const front = this.load - this.loadBack;
    if (front <= 1e-6) return;
    const curl = clamp(-this.bucketRate / (0.25 * this.m.speeds.bucket), 0, 1);
    // 오므림·무게만으로는 입구 쪽 흙이 조금만 안쪽으로 굴러감 (앞에만 찬 바가지)
    // 오므리는 동작만 입구 흙을 안쪽으로 굴림 (가만히 들고만 있으면 흙은 이빨 쪽 덩어리 그대로)
    const curlRate = this.params.curlPackRate * curl;
    // 많이 오므릴수록(범위의 60% 넘게) 날이 위로 올라가 날 쪽 흙이 바닥(등판)으로 떨어짐. 덜 오므리면 이빨 쪽 덩어리 그대로
    const [bMin, bMax] = this.m.limits.bucket;
    const curledness = clamp((bMax - this.pose.bucket) / (bMax - bMin), 0, 1);
    const curlCapRatio = this.params.curlBackCapRatio + (this.params.backCapRatio - this.params.curlBackCapRatio) * clamp((curledness - 0.6) / 0.35, 0, 1);
    const curlRoom = Math.max(0, this.m.struckCapacity * curlCapRatio - this.loadBack);
    const curlMove = Math.min(front, front * curlRate * dt, curlRoom);
    // 흙에 박힌 채 오므리며 암으로 끌면, 새로 들어오는 흙이 앞의 흙을 안쪽(등판)까지 밀어 넣음 (끌기만 하면 앞에만 참)
    const armRoom = Math.max(0, this.backCap - this.loadBack - curlMove);
    // 입구에 흙이 어느 정도 쌓여야(평적의 frontFirstRatio) 그 흙이 밀려 들어감 → 입구부터 쌓이는 순서
    const pushable = Math.max(0, front - curlMove - this.m.struckCapacity * this.params.frontFirstRatio);
    // 버킷을 어느 정도(20°→45°) 오므려 둔 채 암만 당겨도 눌러 담김 (실기 요령: 오므림 → 암 당겨 눌러 담기 → 오므려 마무리)
    const held = clamp((-this.pose.bucket - (20 * Math.PI) / 180) / ((25 * Math.PI) / 180), 0, 1);
    const armMove = soilContact ? Math.min(pushable, front * this.params.armPackRate * armRate * Math.max(curl, held) * dt, armRoom) : 0;
    // 입구로 들어온 흙은 물처럼 흐르지 않아 들어 올려도 이빨 쪽에 덩어리로 남는다 (안쪽은 암으로 눌러 담거나 오므려야 참)
    const mv = curlMove + armMove;
    if (mv > 0) this.loadBack += mv;
  }

  /** 직전 프레임의 선회 각속도 (각가속도를 내려고 들고 있는다) */
  private prevSwingVel = 0;

  /**
   * 선회 중에 흘리는 양 (m³/프레임).
   *
   * 흘리는 원인은 **회전 그 자체가 아니다.** 현장 기준으로는
   *   1) 돌리는 중에 레버를 확 주거나 확 꺾어 **덜컹거리는 것**(조작 미숙)
   *   2) 버킷을 제대로 오므리지 않은 **어정쩡한 자세로 돌리는 것**
   * 이 둘이다. 고봉으로 담았으면 둘 다 더 심해진다.
   * 반대로 **잘 오므린 버킷을 부드럽게 돌리면 거의 안 흘린다.**
   *
   * 저가폰에서도 돌아야 하므로 스칼라 몇 개로만 센다 — 흙 격자를 훑거나 입자를 늘리지 않는다.
   * 연출(입자·먼지)은 이 값을 받아 화질 높은 기기에서만 재생한다.
   */
  private spinSpill(dt: number, ny: number, r: number): number {
    const w = this.vel.swing;
    const alpha = dt > 0 ? (w - this.prevSwingVel) / dt : 0;
    this.prevSwingVel = w;
    const S = this.m.struckCapacity;
    const H = this.heapedCap;
    // 고봉으로 쌓인 만큼이 먼저 흘러내린다. 평적 이하면 0 (증폭 계수로만 쓴다)
    const heap = clamp((this.load - S) / Math.max(1e-6, H - S), 0, 1);
    // 1) 덜컹: 선회 접선 가속도. 측정값 — 1초에 걸쳐 주고 놓으면 0.25g, 0.5초면 0.57g,
    //    레버를 확 주고 확 놓으면 1.66g, 반대로 확 꺾으면 3.3g.
    //    0.5초 안팎으로 다루는 건 덜컹이 아니다. 그 위부터 센다.
    const jerk = clamp((r * Math.abs(alpha) / 9.81 - 0.6) / 2.5, 0, 1);
    // 2) 어정쩡한 자세로 돌리기: 입구가 덜 오므려진 채 움직이는 동안만
    const moving = clamp((Math.abs(w) - 0.05) / 0.25, 0, 1);
    // 측정: 제대로 오므린 운반 자세는 ny 0.85~0.99, 반쯤 오므리면 -0.26, 안 오므리면 -0.97.
    const tilt = clamp((0.6 - ny) / 0.6, 0, 1) * moving;
    if (jerk <= 0 && tilt <= 0) return 0;
    return dt * H * (jerk * (0.10 + 0.30 * heap) + tilt * (0.06 + 0.18 * heap));
  }

  private pour(dt: number, cutting = false) {
    const f = this.frame;
    const tipW = toWorld(this.pose.swing, f.tip);
    // 버킷이 흙에 묻혀 있으면(날 끝이 표면 아래) 흙이 빠져나갈 수 없다
    const buried = tipW.y < this.soil.surfaceAt(tipW.x, tipW.z) - 0.02;
    const ny = f.nOpen.y;
    // 선회 관성 흘림은 **공중에 떠 있으면 늘** 센다.
    // 날 앞 덧쌓임(surcharge)이 남아 cutting이 켜져 있어도 운반 중에는 흘러야 한다.
    let v = buried ? 0 : this.spinSpill(dt, ny, Math.max(0.5, f.tip.r));
    if (buried) this.prevSwingVel = this.vel.swing;
    // 흙을 깎으며 나아가는 중이면 입구를 새 흙이 막고 있어 기울기로는 쏟아지지 않는다
    if (!buried && !cutting) {
      const retainAll = clamp((ny + 0.35) / 0.9, 0, 1) * this.heapedCap;
      // 입구 쪽에 걸친 흙은 입구가 충분히 위를 향해야(오므려야) 버틴다
      const frontCap = this.heapedCap - this.backCap;
      const retainFront = clamp((ny - 0.15) / 0.6, 0, 1) * frontCap;
      const retain = Math.min(retainAll, Math.min(this.loadBack, retainAll) + retainFront);
      v += Math.min(Math.max(0, this.load - retain), 0.8 * dt);
    }
    v = Math.min(this.load, v);
    if (v <= 1e-6) return;
    this.load -= v;
    this.pourStep += v;
    this.loadBack = Math.min(this.loadBack, this.load);
    this.pourAcc += v;
    if (this.isCarrying()) this.carrySpill += v;
    if (this.pourAcc > 0.004 || this.load < 1e-4) {
      const W = this.m.bucketWidth;
      const tip = toWorld(this.pose.swing, f.tip, (this.rand() - 0.5) * W * 0.8);
      const vel = v3((this.rand() - 0.5) * 0.4, -0.5, (this.rand() - 0.5) * 0.4);
      if (this.particles.length < 140) this.particles.push({ p: tip, v: vel, vol: this.pourAcc, id: this.particleId++ });
      else this.land(tip, this.pourAcc);
      this.pourAcc = 0;
    }
  }

  private land(p: V3, vol: number) {
    this.landStep += vol;
    if (this.landEvents.length < 48) this.landEvents.push({ p: v3(p.x, p.y, p.z), vol });
    const g = this.soil.gridAt(p.x, p.z);
    if (g) {
      const k = g.cellAt(p.x, p.z);
      g.depositSpread(k, vol);
      // 덤프 판정: 흙이 실제로 C 구덩이에 떨어진 양으로 센다 (버킷 위치가 아니라)
      if (g.name === 'C' && g.pit[k]) this.cycle.pouredInC += vol;
    } else this.spilled += vol;
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
          this.report('W-DANGER', '버킷이 흙 속에 있는데 선회');
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
        this.packRatios.push(this.load > 0 ? this.loadBack / this.load : 0);
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
    // 지면에 닿으면 인정. 흙 위에 내려놓으면 버킷이 조금 묻히는 게 정상이라 endSinkTol까지 인정
    // (구덩이 속 깊이 묻힌 채로는 불인정)
    if (open && this.onFlatC() && gap <= this.params.endGroundTol && gap >= -this.params.endSinkTol && still) {
      this.endT += dt;
      if (this.endT >= this.params.endHoldSec) this.finish();
    } else this.endT = 0;
  }

  /** 버킷 바닥 가운데가 C(흙을 메우고 평탄한 곳) 구덩이 위에 있는가 — 마지막 평탄 동작에 이어 그 자리에 내려놓는다 */
  onFlatC(): boolean {
    const g = this.soil.grids.find((x) => x.name === 'C');
    if (!g) return false;
    let x = 0;
    let z = 0;
    let n = 0;
    for (const row of this.underWorld(this.frame, this.pose.swing)) for (const p of row) (x += p.x), (z += p.z), n++;
    const k = g.cellAt(x / n, z / n);
    return k >= 0 && g.pit[k] === 1;
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
    else if (this.flattenPullDist < this.params.flattenMinPass) this.report('D-NOFLAT', '평탄: 밀기만 하고 당겨 오기 없음 (왕복 1회 필요)');
    else if (this.flattenPushDist < this.params.flattenMinPass) this.report('D-NOFLAT', '평탄: 당겨 오기만 하고 밀기 없음 (왕복 1회 필요)');
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
      packRatios: this.packRatios,
      carrySpill: this.carrySpill,
      flattenOpenRatio: this.flattenVol > 0 ? this.flattenOpenVol / this.flattenVol : 0,
    };
  }

  /** 안내 문구 */
  guide(): string {
    if (this.phase === 'precheck') return '';
    if (this.phase === 'ready') return '호각! 작업을 시작합니다';
    if (this.phase === 'finished') return '작업 종료';
    if (!this.engineOn) return '엔진 꺼짐: 시동 누르기';
    if (!this.leverUnlocked) return '안전레버 잠김';
    const sc = this.m.struckCapacity;
    const tipSt = this.stationOf(toWorld(this.pose.swing, this.frame.tip))?.name ?? null;
    if (this.load >= 0.3 * sc) {
      if (tipSt === 'C') return 'C 위에서 버킷 펴 쏟기';
      if (!this.fullyCurled) return '버킷 끝까지 오므려 들기';
      return '붐 올려 B 폴 사이로 선회';
    }
    if (this.digCount < this.params.minDigCount)
      return 'A: ⓑ선 안쪽 당기며 퍼 담기';
    if (this.flattenVol < this.params.flattenMinVolume) return 'C 평탄: 버킷 펴서 밀기';
    if (this.flattenPullDist < this.params.flattenMinPass) return 'C 평탄: 흙에 대고 당겨 오기 (왕복)';
    if (this.flattenPushDist < this.params.flattenMinPass) return 'C 평탄: 버킷 펴서 밀기 (왕복)';
    const open = this.pose.bucket >= this.m.limits.bucket[1] - (this.params.endOpenMarginDeg * Math.PI) / 180;
    const cm = Math.round(this.groundGap() * 100);
    if (!open) return '마무리: 버킷 끝까지 펴기';
    if (!this.onFlatC()) return '마무리: C 평탄면에 내려놓기';
    return `마무리: 내려놓기 ${Math.max(0, cm)}cm`;
  }

  /** 디버그·테스트용 */
  setPose(p: Partial<Pose>) {
    Object.assign(this.pose, p);
    this.frame = fk(this.m, this.pose);
  }
  /** 자세를 순간이동 (배우기 미션 시작용): 이동 경로를 판정하지 않고 속도도 0 */
  teleport(p: Partial<Pose>) {
    this.releaseSurcharge();
    this.setPose(p);
    this.vel = { swing: 0, boom: 0, arm: 0, bucket: 0 };
    this.prevBucket = bucketCorners(this.m, this.frame, this.pose.swing);
    this.prevUnder = this.underWorld(this.frame, this.pose.swing);
    this.prevBucketAngle = null;
    this.prevArmAngle = null;
    this.soilBucketPrev = null;
    this.soilPosePrev = null;
    this.prevStation = this.stationOf(toWorld(this.pose.swing, this.frame.tip))?.name ?? null;
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
