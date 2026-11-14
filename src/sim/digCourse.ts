import type { DigSession } from './session';
import { co, hold, pose, SC, type Grade, type Lesson, type Step } from './tutorial';

const deg = Math.PI / 180;

/** 2단계 기준값. 전부 실측으로 잡았다 (docs/.../2026-11-14-digging-course-design.md 5-2) */
export const SCOOP = {
  /** 이빨을 맞출 반경 허용 오차 */
  rTol: 0.4,
  /** 이빨 높이 (지면 위) */
  yLo: 0.05,
  yHi: 0.35,
  /** 흙에 닿았다고 보는 간격 */
  bite: 0.05,
  /**
   * 담기 통과 (정석이면 0.90이 담긴다).
   * 0.6에서 끊으면 버킷이 덜 오므려진 채로 들게 되어, 드는 동안 다 흘린다 (측정).
   */
  fill: 0.75,
  /**
   * 들어 올리는 동안 지켜야 하는 비율 (담았던 양 대비).
   * 측정: **오므리며 들면 67%**, 안 오므리고 그냥 들면 **0%**(다 쏟는다).
   * '먼저 끝까지 오므린 뒤에 들기'는 안 된다 — 흙이 가득 차면 버킷이 +23°에서 막힌다.
   */
  keep: 0.6,
  /** 들어 올렸다고 보는 이빨 높이 */
  lift: 0.2,
} as const;

/** 파는 자리 (A 굴착구역 한가운데) */
export const digSpot = (s: DigSession) => {
  const a = s.site.stations.find((x) => x.name === 'A');
  return { swing: Math.PI, r: a ? (a.zoneIn + a.zoneOut) / 2 : 6 };
};

/** 시범 한 토막: `frames` 동안 `inp`를 밀고, 그 뒤 다음 단계로 */
const show = (text: string, frames: number, inp: (f: number) => Record<string, number>, gauge?: 1 | 2 | 3, label = '붐 올림'): Step => ({
  text,
  gauge,
  labels: [label],
  demo: (f) => (f < frames ? inp(f) : null),
  begin: (_s, mem) => (mem.t = 0),
  // 시범 + 가운데로 돌아와 쉬는 0.5초까지 보고 넘어간다
  done: (_s, mem) => ++mem.t > frames + 40,
});

export const SCOOP_LESSON: Lesson = {
  id: 'b-scoop',
  tier: '기본기',
  icon: 'stScoop',
  title: '흙 퍼기',
  noFail: true,
  big: true,
  why: {
    title: '왜 손맛부터 하나',
    lines: [
      '시험 영상으로는 <b>레버를 얼마나 미는지</b>를 못 배웁니다.',
      '조금 밀면 천천히, 끝까지 밀면 빠르게 움직입니다.',
      '먼저 <b>앱이 해 보이고</b>, 그다음 따라 하면 됩니다.',
      '흙은 <b>오므리면서</b> 들어 올려야 안 쏟습니다.',
    ],
  },
  /** 들어 올리면서 **담았던 흙을 얼마나 지켰나** (절대 적재량이 아니라 비율로 본다) */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  grade: (_s, bag): Grade => {
    const kept = bag.peak ? (bag.keep ?? 0) / bag.peak : 0;
    if (kept >= 0.65) return { stars: 3, note: '오므리면서 들어 흙을 잘 지켰습니다' };
    if (kept >= 0.45) return { stars: 2, note: '조금 흘렸어요. 들어 올릴 때 버킷을 더 오므려 보세요' };
    return { stars: 1, note: '많이 흘렸어요. 다 퍼고 나서 오므리면 늦습니다 — 오므리면서 드세요' };
  },
  setup: (s) => {
    const { swing, r } = digSpot(s);
    pose(s, swing, r, 1.2, -20 * deg);
  },
  steps: [
    // ---- 손맛 시범 3회 ----
    // 올림 → 내림 → 올림으로 짜서 시범이 끝나면 처음 높이로 돌아온다
    show('이만큼만 미세요', 70, () => ({ ry: -0.25 }), 1),
    show('끝까지 미세요', 45, () => ({ ry: 1 }), 3, '붐 내림'),
    show('레버를 가운데로 천천히', 110, (f) => ({ ry: f < 60 ? -0.25 : -0.25 * (1 - (f - 60) / 50) })),
    // ---- 따라 하기 ----
    {
      text: '같이 해보세요\n붐을 한 칸만 올리기',
      gauge: 1,
      labels: ['붐 올림'],
      begin: (_s, mem) => ((mem.used = 0), (mem.ok = 0)),
      hud: (_s, mem) => (mem.used ? null : '오른쪽 레버를 아래로 조금만'),
      done: (s, mem) => {
        const v = Math.abs(s.input.ry);
        if (v > 0.15 && v <= 0.4) mem.used = (mem.used ?? 0) + 1;
        return hold(mem, (mem.used ?? 0) >= 30 && v < 0.05, 20);
      },
    },
    // ---- 파는 자리 보여주기 ----
    {
      text: '여기가 파는 자리',
      peek: true,
      spot: digSpot,
      begin: (_s, mem) => (mem.t = 0),
      done: (_s, mem) => ++mem.t > 110,
    },
    // ---- 이빨 맞추기 ----
    {
      text: '이빨을 표시에 맞추세요',
      spot: digSpot,
      labels: ['붐 내림', '암 당기기'],
      done: (s, mem) => {
        const { r } = digSpot(s);
        const t = s.frame.tip;
        const ok = Math.abs(t.r - r) < SCOOP.rTol && t.y > SCOOP.yLo && t.y < SCOOP.yHi;
        return hold(mem, ok, 18);
      },
      coach: (s) => {
        const { r } = digSpot(s);
        const t = s.frame.tip;
        if (t.y >= SCOOP.yHi) return co('이빨을 더 내리기', '붐 내림');
        if (t.r - r > SCOOP.rTol) return co('암을 당겨 가까이', '암 당기기');
        if (r - t.r > SCOOP.rTol) return co('암을 펴서 멀리', '암 펴기');
        return null;
      },
    },
    // ---- 흙에 넣기 ----
    {
      text: '이빨을 흙에 넣으세요',
      spot: digSpot,
      labels: ['붐 내림'],
      done: (s) => s.groundGap() <= SCOOP.bite,
      coach: (s) => (s.lift > 2 * deg ? co('너무 눌렀어요 — 붐을 살짝 올리기', '붐 올림') : null),
    },
    // ---- 채우기 ----
    {
      text: '버킷 오므리며\n암 당기기',
      labels: ['버킷 오므림', '암 당기기'],
      hud: (s) => `담긴 흙 ${Math.round((s.load / SC(s)) * 100)}%`,
      done: (s) => s.load >= SCOOP.fill * SC(s),
      coach: (s) => (s.lift > 2 * deg ? co('너무 깊어요 — 붐을 살짝 올리기', '붐 올림') : null),
    },
    // ---- 오므리며 들기 ----
    {
      text: '오므리면서\n붐을 올리세요',
      labels: ['버킷 오므림', '붐 올림'],
      hud: (s) => `담긴 흙 ${Math.round((s.load / SC(s)) * 100)}%`,
      begin: (s, _mem, bag) => (bag.peak = s.load / SC(s)),
      done: (s, _mem, bag) => {
        bag.keep = s.load / SC(s);
        bag.kept = bag.peak ? bag.keep / bag.peak : 0;
        return s.frame.tip.y > SCOOP.lift && bag.keep >= SCOOP.keep * bag.peak;
      },
      coach: (s, _mem, bag) => (s.load / SC(s) < SCOOP.keep * (bag.peak ?? 1) ? co('버킷을 더 오므리기', '버킷 오므림') : null),
    },
  ],
};
