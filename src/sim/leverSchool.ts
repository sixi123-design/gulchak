/**
 * 기본기 과정 (레버 교실). 초보자가 레버를 차근차근 익히는 미션들.
 * 기존 배우기(LESSONS)는 그대로 두고, main.ts가 이것을 목록 앞에 붙인다.
 *
 * 설계·측정 근거: docs/superpowers/specs/2026-11-14-lever-school-design.md
 * 단방향 import — tutorial.ts는 이 파일을 모른다.
 */
import { co, fill, hold, pose, type Grade, type Lesson, type Step } from './tutorial';
import type { DigSession } from './session';

type Mem = Record<string, number>;

const deg = Math.PI / 180;
const SWING_A = Math.PI;

/**
 * 부드러움 경계. 측정값에서 나왔다(설계 '측정한 것'):
 * 서서히 놓으면 0.000 · 급하게 놓으면 0.08~0.14 · 반대로 확 꺾으면 0.37~0.87.
 * warn은 시뮬레이터의 경고 임계(rules.json joltWarn)와 같은 값이다.
 */
export const SMOOTH = { warn: 0.1, perfect: 0.04 } as const;

/**
 * 멈춤으로 볼 관절 속도 (최고속도 대비)와 유지 프레임.
 * 시뮬레이터가 '반대로 꺾음'으로 세는 경계는 최고속도의 약 3%다. 배우기의 '멈췄다'를
 * 그보다 엄하게(1%) 잡아, 멈춤 단계를 통과한 사람이 바로 반대로 줘도 덜컹이 안 나게 한다.
 */
const STILL = { vel: 0.01, frames: 15 } as const;

type J = 'swing' | 'boom';
/** 그 관절을 움직이는 레버 값 (화면 레버 방향 기준) */
const leverOf = (s: DigSession, j: J) => (j === 'swing' ? s.input.lx : -s.input.ry);
const moving = (s: DigSession, j: J) => Math.abs(s.vel[j]) > STILL.vel * s.m.speeds[j];
/** 레버를 중립에 두고 관절이 실제로 선 상태 */
const still = (s: DigSession, j: J) => Math.abs(leverOf(s, j)) < 0.08 && !moving(s, j);
/** 가던 방향과 반대로 레버를 밀고 있다 (멈추지 않고 방향을 바꾸는 중) */
const reversing = (s: DigSession, j: J) => {
  const lv = leverOf(s, j);
  return moving(s, j) && Math.abs(lv) > 0.2 && Math.sign(lv) === -Math.sign(s.vel[j]);
};

/**
 * 등급 재료.
 * 충격은 세션이 직접 최댓값을 남긴다(s.maxJolt) — coach는 화면 프레임마다 한 번만
 * 불리는데 물리는 한 프레임에 여러 번 돌 수 있어, 여기서 쌓으면 정점을 놓친다.
 * 흙 손실은 처음 담았던 양(setup에서 기록)과 지금 양으로 바로 계산한다.
 */
const lostOf = (s: DigSession, bag: Mem) => (bag.load0 ? (bag.load0 - s.load) / bag.load0 : 0);

/** 처음 담았던 흙을 한 번만 기록한다 (setup은 bag을 못 받는다) */
const withLoad0 = (st: Step): Step => ({
  ...st,
  begin: (s, mem, bag) => {
    if (bag.load0 === undefined) bag.load0 = s.load;
    st.begin?.(s, mem, bag);
  },
});

/** 반대로 꺾는 중이면 멈추라고 한다. 아니면 넘긴 코치를 쓴다 */
const watched = (j: J | null, more?: Step['coach']): Step['coach'] =>
  (s, mem, bag) => {
    if (j && reversing(s, j)) {
      bag.flick = 1; // 중립을 거치지 않고 꺾은 적이 있다 (끝낸 뒤 뭘 고칠지 알려 주려고)
      return co('멈춘 뒤에 바꾸기 — 레버를 중립으로');
    }
    return more?.(s, mem, bag) ?? null;
  };

/** 그 관절을 한쪽으로 amount 이상 돌렸는가 (반대쪽으로 가장 멀리 간 곳부터 셈) */
const turned = (j: J, dir: 1 | -1, amount: number, text: string, label: string): Step => ({
  text,
  labels: [label],
  begin: (s, mem) => (mem.p = s.pose[j]),
  done: (s, mem) => {
    mem.p = dir > 0 ? Math.min(mem.p, s.pose[j]) : Math.max(mem.p, s.pose[j]);
    return (s.pose[j] - mem.p) * dir >= amount;
  },
  coach: watched(j),
});

/** 레버를 중립으로 놓고 완전히 설 때까지 */
const stopStep = (j: J, text: string): Step => ({
  text,
  labels: [],
  done: (s, mem) => hold(mem, still(s, j), STILL.frames),
  meter: (_s, mem) => ({ v: Math.min(1, (mem.hold ?? 0) / STILL.frames) }),
  coach: watched(j, (s) => (moving(s, j) ? co('레버를 중립으로 놓고 서기까지 기다리기') : null)),
});

const stopFirst: Lesson = {
  id: 'b-stop',
  tier: '기본기',
  icon: 'stStop',
  title: '멈춘 뒤에 바꾸기',
  noFail: true,
  why: {
    title: '왜 멈춘 뒤에 바꾸나',
    lines: [
      '선회 레버를 반대로 확 꺾으면, 돌고 있던 수십 톤이 그 자리에서 방향을 바꿔야 합니다.',
      '그 힘이 갈 데가 없어 차체와 버킷의 흙으로 갑니다. 흙이 쏟아지면 그만큼 점수입니다.',
      '중립에서 한 번 세우고 바꾸세요. 레버를 놓는 것과 멈추는 것은 다릅니다.',
    ],
  },
  // 고봉으로 담은 흙을 들고 A 쪽에 서 있는 자세 (팔을 뻗어 둬 흔들림이 크게 느껴진다)
  setup: (s) => {
    pose(s, SWING_A, s.digTarget.rho - 0.6, s.site.B.ropeY + 1.1, 95 * deg, s.m.limits.bucket[0] + 2 * deg);
    fill(s, 1.25); // 고봉: 평적을 넘은 흙만 충격에 쏟아진다 (session.ts joltSpill)
    s.maxJolt = 0;
  },
  grade: (s, bag): Grade => {
    const lost = lostOf(s, bag);
    const jolt = s.maxJolt ?? 0;
    const flick = !!bag.flick;
    if (lost >= 0.05) return { stars: 1, note: '방향을 바꿀 때 흙이 쏟아졌어요. 중립에서 한 번 세우고 바꾸세요' };
    if (lost >= 0.01) return { stars: 2, note: '흙이 조금 흘렀어요. 중립에서 완전히 선 다음에 바꾸세요' };
    if (jolt < SMOOTH.warn) return { stars: 3, note: '멈춘 뒤에 바꿨어요. 흙도 그대로입니다' };
    return flick
      ? { stars: 2, note: '중립을 거르고 꺾은 적이 있어요. 완전히 선 다음에 바꾸세요' }
      : { stars: 2, note: '레버를 놓을 때 덜컹했어요. 한 번에 놓지 말고 조금씩 줄이며 놓아보세요' };
  },
  steps: [
    turned('swing', -1, 35 * deg, '선회 레버를 왼쪽으로 — C 쪽으로 돌리기', '선회 ◀'),
    stopStep('swing', '레버를 중립으로 놓고, 완전히 설 때까지 기다리기'),
    turned('swing', 1, 30 * deg, '이제 반대로 — A 쪽으로 돌아오기', '▶ 선회'),
    stopStep('swing', '한 번 더 — 중립으로 놓고 완전히 멈추기'),
    turned('swing', -1, 45 * deg, '마지막으로 C 쪽으로, 조금 더 멀리', '선회 ◀'),
  ].map(withLoad0),
};

export const BASIC_LESSONS: Lesson[] = [stopFirst];
