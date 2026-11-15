import { bucketLow, co, hold, pose, ropeClear, SC, fill, type Grade, type Lesson, type Step } from './tutorial';
import { SMOOTH_MAX, spanCo, spanJolt, startSpan, tickSpan, type Joint } from './gauge';
import { digSpot } from './digCourse';
import type { DigSession } from './session';

const deg = Math.PI / 180;

/** 연속동작 두 단계의 기준값 */
export const MOVE = {
  /** 두 관절 이상이 같이 움직인 시간 비율 */
  co: 0.3,
  /** 이빨을 파는 자리에 맞출 때 허용 오차 */
  rTol: 0.5,
  yLo: 0.05,
  yHi: 0.5,
  /** 쏟았다고 보는 남은 양 */
  empty: 0.1,
  /** 선회 전 오므림 각 */
  curl: 60,
} as const;

/** 구간마다 덜컹·동시조작을 재는 껍데기 */
const span = (st: Step, joints: Joint[]): Step => ({
  ...st,
  begin: (s, mem, bag) => {
    startSpan(s, mem);
    st.begin?.(s, mem, bag);
  },
  done: (s, mem, bag) => {
    tickSpan(s, mem, joints);
    return st.done(s, mem, bag);
  },
});

const smooth = (s: DigSession, mem: Record<string, number>) => spanJolt(s, mem) < SMOOTH_MAX;

// ---------------------------------------------------------------- 2단계
export const READY_LESSON: Lesson = {
  id: 'b-ready',
  tier: '기본기',
  icon: 'stAim',
  title: '퍼기 준비 자세',
  noFail: true,
  big: true,
  flat: true,
  why: {
    title: '왜 옮겨 가는 동작부터 하나',
    lines: [
      '흙을 푸는 시간보다 <b>자세를 잡는 시간</b>이 깁니다.',
      '레버를 하나씩 쓰면 그만큼 느려집니다.',
      '붐을 내리면서 암을 펴고 버킷도 같이 여는 것 — <b>연속 동작</b>입니다.',
      '여기서는 흙을 안 팝니다. 자세만 잡습니다.',
    ],
  },
  grade: (_s, bag): Grade => {
    const c = bag.co ?? 0;
    if (c >= 0.5) return { stars: 3, note: '레버를 겹쳐 써서 한 번에 자세를 잡았습니다' };
    if (c >= MOVE.co) return { stars: 2, note: '조금 겹쳐 썼어요. 붐·암·버킷을 더 같이 움직여 보세요' };
    return { stars: 1, note: '레버를 하나씩 썼어요. 두 개를 같이 밀어야 빨라집니다' };
  },
  setup: (s) => {
    // 선회해서 돌아온 직후: 흙은 비었고 버킷은 높이 든 상태
    const { swing, r } = digSpot(s);
    pose(s, swing, r - 1.2, ropeClear(s) + 0.6, -60 * deg);
  },
  steps: [
    span(
      {
        text: '암을 펴서\n파는 자리 쪽으로',
        labels: ['암 펴기'],
        done: (s, mem) => hold(mem, s.frame.tip.r > digSpot(s).r - 1, 12),
        coach: (s) => (bucketLow(s) < ropeClear(s) - 0.5 ? co('버킷이 너무 낮아요 — 붐을 올리기', '붐 올림') : null),
      },
      ['arm'],
    ),
    span(
      {
        text: '붐을 내리면서\n암도 같이 펴기',
        labels: ['붐 내림', '암 펴기'],
        hud: (_s, mem) => `같이 쓴 시간 ${Math.round(spanCo(mem) * 100)}%`,
        done: (s, mem, bag) => {
          bag.co = Math.max(bag.co ?? 0, spanCo(mem));
          return s.frame.tip.y < MOVE.yHi + 0.6;
        },
        coach: (_s, mem) => (spanCo(mem) < MOVE.co ? co('두 레버를 같이 밀기', '붐 내림', '암 펴기') : null),
      },
      ['boom', 'arm'],
    ),
    span(
      {
        text: '이빨을 파는 자리 위에\n부드럽게 멈추기',
        spot: digSpot,
        labels: ['붐 내림', '암 당기기'],
        done: (s, mem) => {
          const t = s.frame.tip;
          const ok = Math.abs(t.r - digSpot(s).r) < MOVE.rTol && t.y > MOVE.yLo && t.y < MOVE.yHi && smooth(s, mem);
          return hold(mem, ok, 14);
        },
        coach: (s, mem) => (!smooth(s, mem) ? co('덜컹했어요 — 레버를 천천히 가운데로') : null),
      },
      ['boom', 'arm'],
    ),
  ],
};

// ---------------------------------------------------------------- 3단계
export const DUMP_LESSON: Lesson = {
  id: 'b-dump',
  tier: '기본기',
  icon: 'stDump',
  title: '쏟고 돌릴 자세',
  noFail: true,
  big: true,
  flat: true,
  why: {
    title: '쏟고 나서가 더 중요합니다',
    lines: [
      '흙을 쏟는 것은 버킷을 펴면 끝입니다.',
      '문제는 <b>그다음</b> — 다시 돌리려면 버킷을 오므리고 높이 들어야 합니다.',
      '그 둘을 같이 하면 한 동작이 됩니다.',
      '여기서도 몸통은 안 돌립니다. 자세만 잡습니다.',
    ],
  },
  grade: (_s, bag): Grade => {
    const c = bag.co ?? 0;
    if (c >= 0.5) return { stars: 3, note: '오므리면서 들어 한 번에 선회 자세가 됐습니다' };
    if (c >= MOVE.co) return { stars: 2, note: '조금 겹쳐 썼어요. 버킷과 붐을 더 같이 움직여 보세요' };
    return { stars: 1, note: '하나씩 했어요. 오므리면서 드는 연습을 해보세요' };
  },
  setup: (s) => {
    // 흙을 담고 버리는 자리에 온 상태
    const c = s.site.stations.find((x) => x.name === 'C');
    const r = c ? (c.zoneIn + c.zoneOut) / 2 : 6;
    pose(s, 0, r, 1.6, -40 * deg, -110 * deg);
    fill(s, 1.1);
  },
  steps: [
    {
      text: '버킷을 천천히 펴서\n흙을 쏟으세요',
      labels: ['버킷 펴기'],
      hud: (s) => `남은 흙 ${Math.round((s.load / SC(s)) * 100)}%`,
      done: (s) => s.load < MOVE.empty * SC(s),
    },
    span(
      {
        text: '버킷을 오므리면서\n붐을 올리기',
        labels: ['버킷 오므림', '붐 올림'],
        hud: (_s, mem) => `같이 쓴 시간 ${Math.round(spanCo(mem) * 100)}%`,
        done: (s, mem, bag) => {
          bag.co = Math.max(bag.co ?? 0, spanCo(mem));
          return -s.pose.bucket / deg >= MOVE.curl && bucketLow(s) >= ropeClear(s);
        },
        coach: (s, mem) =>
          -s.pose.bucket / deg < MOVE.curl
            ? co('버킷을 더 오므리기', '버킷 오므림')
            : spanCo(mem) < MOVE.co
              ? co('붐도 같이 올리기', '붐 올림')
              : null,
      },
      ['bucket', 'boom'],
    ),
    span(
      {
        text: '그 자세로\n부드럽게 멈추기',
        labels: ['붐 올림'],
        done: (s, mem) => hold(mem, bucketLow(s) >= ropeClear(s) && smooth(s, mem), 16),
        coach: (s, mem) => (!smooth(s, mem) ? co('덜컹했어요 — 레버를 천천히 가운데로') : null),
      },
      ['boom', 'bucket'],
    ),
  ],
};
