import { bucketLow, co, hold, pose, ropeClear, SC, fill, type Grade, type Lesson, type Step } from './tutorial';
import { SMOOTH_MAX, spanCo, spanJolt, startSpan, tickSpan, type Joint } from './gauge';
import { digSpot } from './digCourse';
import type { DigSession } from './session';

const deg = Math.PI / 180;

/** 연속동작 두 단계의 기준값 */
export const MOVE = {
  /** 별 3개 기준: 두 관절 이상이 같이 움직인 시간 비율 */
  co: 0.3,
  /**
   * 통과 최소선. '겹쳐 쓰라'고 시켜 놓고 하나씩 써도 통과하면 지시가 거짓말이 된다.
   * 다만 위치와 정지를 해낸 초보를 실패 화면에 묶어 두지 않도록 낮게 잡는다 (기획자 의견).
   */
  coMin: 0.12,
  /** 이빨을 파는 자리에 맞출 때 허용 오차 */
  rTol: 0.6,
  /** 버킷 하부와 지면 사이 (이빨 높이가 아니라 이걸로 본다 — 구덩이가 지면 아래라서) */
  gapLo: 0.03,
  gapHi: 0.45,
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
/** 정말로 서 있나 (최고 속도의 2% 아래). 없으면 목표 범위를 지나가며 통과해 버린다 */
const still = (s: DigSession) =>
  (['boom', 'arm', 'bucket', 'swing'] as const).every((j) => Math.abs(s.vel[j]) < 0.02 * s.m.speeds[j]);

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
    // 흙을 쏟고 선회해서 돌아온 자세 (붐 높이·암 접힘·버킷 오므림).
    // 여기서 세 레버를 같이 쓰면 3초쯤에 굴착 자세에 닿는다 — 측정으로 잡은 값
    s.teleport({ swing: Math.PI, boom: 45 * deg, arm: -120 * deg, bucket: -110 * deg });
  },
  steps: [
    {
      text: '노란 표식이 파는 자리입니다',
      peek: true,
      spot: digSpot,
      begin: (_s, mem) => (mem.t = 0),
      // 표식을 알아보고 조작을 시작했는데 타이머가 발목을 잡으면 안 된다
      done: (s, mem) => {
        mem.t++;
        // 레버를 건드리면 **즉시** 넘어간다. 표식을 알아본 사람을 기다리게 하지 않는다
        const touched = Math.abs(s.input.ry) + Math.abs(s.input.ly) + Math.abs(s.input.rx) > 0.05;
        return touched || mem.t > 130;
      },
    },
    span(
      {
        text: '세 동작을 겹쳐 표식까지',
        spot: digSpot,
        labels: ['붐 내림', '암 펴기', '버킷 펴기'],
        // 맨숫자(42%)는 무엇을 재는지도, 올려야 하는지도 알 수 없다 (초심자 검수)
        hud: (_s, mem) => (spanCo(mem) >= MOVE.co ? '좋아요 — 그대로 표식까지' : '한 번에 하나씩 쓰고 있어요'),
        done: (s, mem, bag) => {
          // 구간 전체 비율로 본다. 매 프레임 최고값을 쌓으면 초반에 잠깐 겹친 것만으로 별 3개가 된다
          const ok = Math.abs(s.frame.tip.r - digSpot(s).r) < 1 && s.groundGap() < 0.7 && spanCo(mem) >= MOVE.coMin;
          if (ok) bag.co = spanCo(mem);
          return ok;
        },
        coach: (s, mem) =>
          spanCo(mem) < MOVE.co
            ? co('세 레버를 같이 밀기', '붐 내림', '암 펴기')
            : s.groundGap() > 1.5
              ? co('붐을 더 내리기', '붐 내림')
              : null,
      },
      ['boom', 'arm', 'bucket'],
    ),
    span(
      {
        text: '표식 위에서 멈추기',
        spot: digSpot,
        labels: ['붐 내림', '암 당기기'],
        hud: (s) => {
          const g = s.groundGap();
          const near = Math.abs(s.frame.tip.r - digSpot(s).r) < MOVE.rTol;
          // 멈출 자리에 왔는지를 말해 준다. 숫자만으로는 언제 멈출지 모른다 (초심자 검수)
          if (near && g > MOVE.gapLo && g < MOVE.gapHi) return '여기! 레버를 가운데로';
          return `버킷 바닥까지 ${Math.round(g * 100)}cm`;
        },
        done: (s, mem) => {
          const g = s.groundGap();
          const ok =
            Math.abs(s.frame.tip.r - digSpot(s).r) < MOVE.rTol &&
            g > MOVE.gapLo &&
            g < MOVE.gapHi &&
            still(s) &&
            smooth(s, mem);
          return hold(mem, ok, 15);
        },
        coach: (s, mem) => {
          if (!smooth(s, mem)) return co('덜컹했어요 — 레버를 천천히 가운데로');
          const d = s.frame.tip.r - digSpot(s).r;
          if (d > MOVE.rTol) return co('암을 당겨 가까이', '암 당기기');
          if (-d > MOVE.rTol) return co('암을 펴서 멀리', '암 펴기');
          return null;
        },
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
      text: '버킷을 펴서 흙 쏟기',
      labels: ['버킷 펴기'],
      hud: (s) => `버킷에 남은 흙 ${Math.round((s.load / SC(s)) * 100)}%`,
      done: (s) => s.load < MOVE.empty * SC(s),
    },
    span(
      {
        text: '오므리며 붐 올리기',
        labels: ['버킷 오므림', '붐 올림'],
        hud: (_s, mem) => (spanCo(mem) >= MOVE.co ? '좋아요 — 계속 접으며 올리기' : '한 번에 하나씩 쓰고 있어요'),
        done: (s, mem, bag) => {
          const ok = -s.pose.bucket / deg >= MOVE.curl && bucketLow(s) >= ropeClear(s) && spanCo(mem) >= MOVE.coMin;
          if (ok) bag.co = spanCo(mem);
          return ok;
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
        text: '그 자세로 멈추기',
        labels: ['붐 올림'],
        done: (s, mem) => hold(mem, bucketLow(s) >= ropeClear(s) && still(s) && smooth(s, mem), 15),
        coach: (s, mem) => (!smooth(s, mem) ? co('덜컹했어요 — 레버를 천천히 가운데로') : null),
      },
      ['boom', 'bucket'],
    ),
  ],
};
