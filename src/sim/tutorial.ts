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
}

export interface Lesson {
  id: string;
  icon: string;
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
  done: (s, mem) => (s.pose[j] - mem[j]) * dir >= amount,
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
const tipStation = (s: DigSession) => s.stationOf(toWorld(s.pose.swing, s.frame.tip))?.name ?? null;
/** 흙에 닿은 채 dir(1 = 바깥, -1 = 몸 쪽)으로 움직인 거리 누적 */
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
    icon: '🕹️',
    title: '레버 익히기',
    setup: () => {},
    steps: [
      moved('boom', 1, 12 * deg, '붐 올리기', ['붐 올림']),
      moved('boom', -1, 12 * deg, '붐 내리기', ['붐 내림']),
      moved('arm', 1, 15 * deg, '암 펴기', ['암 펴기']),
      moved('arm', -1, 15 * deg, '암 당기기', ['암 당기기']),
      moved('bucket', -1, 25 * deg, '버킷 오므리기', ['버킷 오므림']),
      moved('bucket', 1, 25 * deg, '버킷 펴기', ['버킷 펴기']),
      moved('swing', -1, 15 * deg, '왼쪽으로 선회', ['선회 ◀']),
      moved('swing', 1, 15 * deg, '오른쪽으로 선회', ['▶ 선회']),
    ],
  },
  {
    id: 'scoop',
    icon: '🪣',
    title: '퍼 담기',
    setup: (s) => {
      // 흙을 쏟고 돌아온 자세: 버킷 오므리고 몸 가까이
      pose(s, SWING_A, s.digTarget.rho - 1.6, 1.3, -130 * deg);
    },
    steps: [
      {
        text: '암과 버킷을 일렬로 펴기',
        labels: ['암 펴기', '버킷 펴기'],
        done: (s) => Math.abs(s.pose.bucket) <= 12 * deg && s.frame.tip.r >= s.digTarget.rho - 0.8,
      },
      {
        text: '붐 내려 ⓑ선 안쪽에 이빨 꽂기',
        labels: ['붐 내림'],
        done: (s) => tipStation(s) === 'A' && s.groundGap() < -0.05,
      },
      {
        text: '버킷 오므려 윗면을 바닥과 평행하게',
        labels: ['버킷 오므림'],
        // 버킷 개구부가 몸 쪽을 봄 (핀→이빨 선이 수직 ±15°) = 윗면이 수평
        done: (s) => Math.abs(s.frame.thK + 90 * deg) <= 15 * deg && s.groundGap() < 0,
      },
      {
        text: '암 당겨 흙 긁어오기',
        labels: ['암 당기기'],
        done: (s) => s.load >= 0.35 * s.m.struckCapacity,
      },
      {
        text: '버킷 오므려 흙 담기',
        labels: ['버킷 오므림'],
        done: (s) => s.load >= 0.7 * s.m.struckCapacity,
      },
      {
        text: '버킷 끝까지 오므리기',
        labels: ['버킷 오므림'],
        done: (s) => s.fullyCurled,
      },
      {
        text: '붐 올리기',
        labels: ['붐 올림'],
        done: (s) => s.fullyCurled && s.groundGap() > 0.8 && s.load >= 0.6 * s.m.struckCapacity,
      },
    ],
  },
  {
    id: 'carry',
    icon: '↪️',
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
    icon: '⛰️',
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
    icon: '🧹',
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
        done: (s) => s.pose.bucket >= s.m.limits.bucket[1] - 15 * deg,
      },
      {
        text: '암 펴서 흙더미 너머로 뻗기',
        labels: ['암 펴기'],
        done: (s) => s.frame.tip.r >= s.site.stations[1].pitOut - 0.4,
      },
      {
        text: '붐 내려 흙에 대고, 암 당겨 한 번 끌어오기',
        labels: ['붐 내림', '암 당기기'],
        begin: (s, mem) => ((mem.r = s.frame.tip.r), (mem.d = 0)),
        done: (s, mem) => contactTravel(s, mem, -1) >= 0.8,
      },
      {
        text: '암 펴며 흙더미를 밀어 고르기',
        labels: ['암 펴기', '붐 내림'],
        begin: (s, mem) => ((mem.r = s.frame.tip.r), (mem.d = 0)),
        done: (s, mem) => contactTravel(s, mem, 1) >= 0.8 && s.flattenVol >= s.params.flattenMinVolume,
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
