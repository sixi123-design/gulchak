import { ik, toWorld, type Pose } from './kinematics';
import type { DigSession } from './session';

/**
 * 배우기(튜토리얼): 구간별 짧은 미션. 순수 로직 — 화면은 main.ts가 그린다.
 * 각 미션은 그 구간에 맞는 자세·상태에서 바로 시작한다.
 */

type Joint = keyof Pose;

export interface Step {
  /** 화면에 보이는 한 줄 지시 */
  text: string;
  /** 깜빡여 줄 레버 라벨 (화면의 조이스틱 라벨 글자와 같게) */
  labels?: string[];
  /** 이 단계가 시작될 때의 상태 기록 */
  begin?: (s: DigSession, mem: Record<string, number>) => void;
  done: (s: DigSession, mem: Record<string, number>) => boolean;
  /** 이 단계부터 '버킷 내려놓기' 종료 판정을 켬 (앞 단계에서 미리 끝나지 않게) */
  armEnd?: boolean;
  /** 미묘한 단계의 도움 게이지 (0~1). band가 있으면 바늘+목표 구간, 없으면 채워지는 막대 */
  meter?: (s: DigSession, mem: Record<string, number>) => Meter;
}

export interface Meter {
  v: number;
  band?: [number, number];
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 시작값 → 목표값까지 얼마나 왔는가 (begin에서 mem.g0 기록) */
const toward = (now: number, mem: Record<string, number>, goal: number): Meter => ({
  v: clamp01((now - mem.g0) / (goal - mem.g0 || 1e-6)),
});
/** 값 x를 [lo, hi] 범위의 바늘로, 목표 [a, b] */
const needle = (x: number, lo: number, hi: number, a: number, b: number): Meter => ({
  v: clamp01((x - lo) / (hi - lo)),
  band: [(a - lo) / (hi - lo), (b - lo) / (hi - lo)],
});

export interface Lesson {
  id: string;
  /** 아이콘 이름 (src/ui/icons.ts) */
  icon: 'stLevers' | 'stScoop' | 'stCarry' | 'stDump' | 'stFlat';
  title: string;
  /** 마지막 단계에서 '버킷 내려놓기' 종료 판정을 켬 */
  autoEnd?: boolean;
  setup: (s: DigSession) => void;
  steps: Step[];
}

const deg = Math.PI / 180;
const SWING_A = Math.PI; // A를 향함
const SWING_C = 0; // C를 향함

/** 관절을 한쪽 방향으로 일정 각도 이상 움직였는가 */
const moved = (j: Joint, dir: 1 | -1, amount: number, text: string, labels: string[]): Step => ({
  text,
  labels,
  begin: (s, mem) => (mem[j] = s.pose[j]),
  // 시작점은 반대쪽으로 가장 멀리 간 곳: 앞 단계 레버를 계속 밀어 넘어가도(관성) 되돌린 만큼 다 셈
  done: (s, mem) => {
    mem[j] = dir > 0 ? Math.min(mem[j], s.pose[j]) : Math.max(mem[j], s.pose[j]);
    return (s.pose[j] - mem[j]) * dir >= amount;
  },
});

/**
 * 버킷 날 끝을 (r, y)에 두는 자세로 순간이동. bucketRel: 버킷 관절각(없으면 ik 그대로).
 * 버킷 각을 바꾸면 날 끝이 움직이므로 몇 번 되풀이해 맞춘다.
 */
function pose(s: DigSession, swing: number, r: number, y: number, bucketAbs: number, bucketRel?: number) {
  let tr = r;
  let ty = y;
  for (let i = 0; i < 6; i++) {
    const q = ik(s.m, tr, ty, bucketAbs);
    if (!q) break;
    s.teleport({ swing, ...q, ...(bucketRel !== undefined ? { bucket: bucketRel } : {}) });
    const tip = s.frame.tip;
    tr += r - tip.r;
    ty += y - tip.y;
  }
}
const tipStation =(s: DigSession) => s.stationOf(toWorld(s.pose.swing, s.frame.tip))?.name ?? null;
/** 흙에 닿은 채 dir(1 = 바깥, -1 = 몸 쪽)으로 움직인 거리 누적 */
/** 버킷 바닥(힐→이빨)이 수평(이빨이 몸 쪽)에서 기운 각(°, +면 이빨이 위) */
const bottomSigned = (s: DigSession) => {
  const f = s.frame;
  return (Math.atan2(f.tip.y - f.heel.y, f.heel.r - f.tip.r) * 180) / Math.PI;
};
const bottomTilt = (s: DigSession) => Math.abs(bottomSigned(s));
const contactTravel = (s: DigSession, mem: Record<string, number>, dir: 1 | -1) => {
  const r = s.frame.tip.r;
  const dr = (r - mem.r) * dir;
  if (dr > 0 && s.groundGap() < 0.12) mem.d += dr;
  mem.r = r;
  return mem.d;
};
const fill = (s: DigSession, ratio: number) => {
  s.load = s.m.struckCapacity * ratio;
  s.loadBack = s.load * 0.85;
};

export const LESSONS: Lesson[] = [
  {
    id: 'levers',
    icon: 'stLevers',
    title: '레버 익히기',
    setup: () => {},
    steps: [
      moved('boom', 1, 12 * deg, '붐 올리기', ['붐 올림']),
      moved('boom', -1, 12 * deg, '붐 내리기', ['붐 내림']),
      moved('arm', 1, 15 * deg, '암 펴기', ['암 펴기']),
      moved('arm', -1, 15 * deg, '암 당기기', ['암 당기기']),
      moved('bucket', -1, 25 * deg, '버킷 오므리기', ['버킷 오므림']),
      moved('bucket', 1, 25 * deg, '버킷 펴기', ['버킷 펴기']),
    ],
  },
  {
    id: 'scoop',
    icon: 'stScoop',
    title: '퍼 담기',
    setup: (s) => {
      // 흙을 쏟고 돌아온 자세: 버킷 오므리고 몸 가까이
      pose(s, SWING_A, s.digTarget.rho - 1.6, 1.3, -130 * deg);
    },
    steps: [
      {
        text: '붐 올리며 버킷을 암 각도로 펴기',
        labels: ['붐 올림', '버킷 펴기'],
        // 버킷 관절 0° = 핀→이빨 선이 암과 일직선
        done: (s) => Math.abs(s.pose.bucket) <= 12 * deg,
        meter: (s) => needle(s.pose.bucket / deg, -90, 90, -12, 12),
      },
      {
        text: '암 펴서 ⓑ선 안쪽까지 뻗기',
        labels: ['암 펴기'],
        begin: (s, mem) => (mem.g0 = s.frame.tip.r),
        done: (s) => s.frame.tip.r >= s.digTarget.rho - 0.5,
        meter: (s, mem) => toward(s.frame.tip.r, mem, s.digTarget.rho - 0.5),
      },
      {
        text: '붐 내려 이빨 꽂기',
        labels: ['붐 내림'],
        done: (s) => tipStation(s) === 'A' && s.groundGap() < -0.05,
        meter: (s) => ({ v: clamp01((0.6 - s.groundGap()) / 0.65) }),
      },
      {
        text: '버킷 오므려 바닥면을 수평으로',
        labels: ['버킷 오므림'],
        // 버킷 바닥(힐→이빨)이 수평 ±20°, 이빨이 몸 쪽
        done: (s) => bottomTilt(s) <= 20 && s.groundGap() < 0,
        meter: (s) => needle(bottomSigned(s), -60, 60, -20, 20),
      },
      {
        text: '암 당겨 흙 긁어오기',
        labels: ['암 당기기'],
        begin: (s, mem) => ((mem.r = s.frame.tip.r), (mem.d = 0)),
        done: (s, mem) => contactTravel(s, mem, -1) >= 0.6,
        meter: (_s, mem) => ({ v: clamp01(mem.d / 0.6) }),
      },
      {
        text: '버킷 오므리며 암 한 번 더 당겨 가득 담기',
        labels: ['버킷 오므림', '암 당기기'],
        done: (s) => s.load >= 0.8 * s.m.struckCapacity,
        meter: (s) => ({ v: clamp01(s.load / (0.8 * s.m.struckCapacity)) }),
      },
      {
        text: '붐 올리며 버킷 끝까지 오므리기',
        labels: ['붐 올림', '버킷 오므림'],
        done: (s) => s.fullyCurled && s.groundGap() > 0.8 && s.load >= 0.6 * s.m.struckCapacity,
        meter: (s) => ({ v: Math.min(clamp01(s.groundGap() / 0.8), s.fullyCurled ? 1 : 0.5) }),
      },
    ],
  },
  {
    id: 'carry',
    icon: 'stCarry',
    title: 'B 통과 선회',
    setup: (s) => {
      const B = s.site.B;
      pose(s, SWING_A, (B.rE + B.rF) / 2, B.ropeY + 1.0, 95 * deg, s.m.limits.bucket[0] + 2 * deg);
      fill(s, 1);
    },
    steps: [
      {
        text: '두 폴 사이, 줄 위로 지나 C까지 선회',
        labels: ['▶ 선회', '선회 ◀'],
        begin: (s, mem) => (mem.v = s.engine.violations.length),
        done: (s) => tipStation(s) === 'C' && s.load >= 0.5 * s.m.struckCapacity,
      },
    ],
  },
  {
    id: 'dump',
    icon: 'stDump',
    title: '흙 쏟기',
    setup: (s) => {
      const C = s.site.stations[1];
      pose(s, SWING_C, C.pitIn + 0.1, 2.2, 95 * deg, s.m.limits.bucket[0] + 2 * deg);
      fill(s, 1);
    },
    steps: [
      {
        text: 'C 구덩이 위에서 버킷을 펴 쏟기',
        labels: ['버킷 펴기'],
        done: (s) => s.load < 0.1 * s.m.struckCapacity && s.particles.length === 0,
      },
    ],
  },
  {
    id: 'flatten',
    icon: 'stFlat',
    title: '평탄·마무리',
    autoEnd: true,
    setup: (s) => {
      const C = s.site.stations[1];
      const g = s.soil.grids.find((x) => x.name === 'C')!;
      const mid = (C.pitIn + C.pitOut) / 2;
      // 덤프 4번 한 것처럼 흙을 쌓아 둠
      for (const dx of [-0.6, -0.2, 0.2, 0.6]) g.depositSpread(g.cellAt(C.axis.x * (mid + dx), 0), 0.4);
      g.relax(Math.tan((s.params.reposeDeg * Math.PI) / 180) * s.params.soilCell, 400);
      s.digCount = Math.max(s.digCount, s.params.minDigCount);
      s.dumpCount = Math.max(s.dumpCount, 1);
      pose(s, SWING_C, C.pitIn - 0.1, 1.2, -10 * deg, -30 * deg);
    },
    steps: [
      {
        text: '버킷 끝까지 펴서 뒤집기',
        labels: ['버킷 펴기'],
        begin: (s, mem) => (mem.g0 = s.pose.bucket),
        done: (s) => s.pose.bucket >= s.m.limits.bucket[1] - 15 * deg,
        meter: (s, mem) => toward(s.pose.bucket, mem, s.m.limits.bucket[1] - 15 * deg),
      },
      {
        text: '암 펴서 흙더미 너머로 뻗기',
        labels: ['암 펴기'],
        begin: (s, mem) => (mem.g0 = s.frame.tip.r),
        done: (s) => s.frame.tip.r >= s.site.stations[1].pitOut - 0.4,
        meter: (s, mem) => toward(s.frame.tip.r, mem, s.site.stations[1].pitOut - 0.4),
      },
      {
        text: '흙에 대고 암 당기며 붐 올려 끌어오기',
        labels: ['붐 내림', '암 당기기', '붐 올림'],
        begin: (s, mem) => ((mem.r = s.frame.tip.r), (mem.d = 0)),
        done: (s, mem) => contactTravel(s, mem, -1) >= 0.8,
        meter: (_s, mem) => ({ v: clamp01(mem.d / 0.8) }),
      },
      {
        text: '붐 올리고 암 당겨 밀 준비',
        labels: ['붐 올림', '암 당기기'],
        begin: (s, mem) => (mem.g0 = s.frame.tip.r),
        done: (s) => s.frame.tip.r <= s.site.stations[1].pitIn + 0.2,
        meter: (s, mem) => toward(s.frame.tip.r, mem, s.site.stations[1].pitIn + 0.2),
      },
      {
        text: '암·붐 동시에 살살 밀어 고르기',
        labels: ['암 펴기', '붐 내림'],
        begin: (s, mem) => ((mem.r = s.frame.tip.r), (mem.d = 0)),
        done: (s, mem) => contactTravel(s, mem, 1) >= 1.0 && s.flattenVol >= s.params.flattenMinVolume,
        meter: (s, mem) => ({ v: Math.min(clamp01(mem.d / 1.0), clamp01(s.flattenVol / s.params.flattenMinVolume)) }),
      },
      {
        text: '버킷 끝까지 편 채로 흙 위에 내려놓기',
        labels: ['붐 내림', '버킷 펴기'],
        armEnd: true,
        done: (s) => s.phase === 'finished',
      },
    ],
  },
];

/** 미션 진행: 매 프레임 update()를 부르면 단계가 넘어간다 */
export class Tutor {
  step = 0;
  cleared = false;
  private mem: Record<string, number> = {};
  constructor(
    readonly lesson: Lesson,
    readonly s: DigSession,
  ) {
    lesson.setup(s);
    this.enter();
  }
  private enter() {
    this.mem = {};
    const st = this.lesson.steps[this.step];
    if (this.lesson.autoEnd) this.s.flags.autoEnd = !!st?.armEnd;
    st?.begin?.(this.s, this.mem);
  }
  get current(): Step | null {
    return this.lesson.steps[this.step] ?? null;
  }
  /** 지금 단계의 도움 게이지 (없으면 null) */
  meter(): Meter | null {
    if (this.cleared) return null;
    return this.current?.meter?.(this.s, this.mem) ?? null;
  }
  /** 이번 프레임에 단계가 넘어갔으면 true */
  update(): boolean {
    if (this.cleared) return false;
    const st = this.current;
    if (!st || !st.done(this.s, this.mem)) return false;
    this.step++;
    if (this.step >= this.lesson.steps.length) this.cleared = true;
    else this.enter();
    return true;
  }
}
