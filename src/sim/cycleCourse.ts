/**
 * 마무리 1: 한 사이클 이어서 (2026-11-17, 강사 검수 반영).
 *
 * 기본기는 동작을 하나씩 끊어 배운다. 실기는 4분에 굴착 4회 이상과 평탄까지 해야 해서
 * 한 사이클을 약 45초 안에 끝내야 한다 `[추정: 강사]`. 그러려면 동작을 **겹쳐야** 한다:
 * 오므리며 붐 올리다 줄 위가 되면 선회 시작, 돌아오는 길에 B를 지나면 붐 내리며 버킷 펴기.
 *
 * 시범 없이 바로 한다 (기본기에서 다 봤다). 통과는 결과(쏟고 A로 돌아옴), 별은 걸린 시간.
 * 레버를 같이 밀면 기름을 나눠 써서 조금씩 느려진다 — 그래도 하나씩 하는 것보다 빠르다.
 */
import { swingReady } from './digCourse';
import { MOVE, readyPose } from './moveCourse';
import { co, passFix, SC, type Grade, type Lesson, type Step } from './tutorial';
import type { DigSession } from './session';

const deg = Math.PI / 180;
const SWING_A = Math.PI;
const SWING_C = 0;
/** 별 기준 (초): 시험 페이스 */
const PACE = { good: 45, ok: 60 } as const;
/** 목표에 섰다고 볼 선회 범위 (도) — 선회 미션과 같다 */
const TOL = 6;

const near = (s: DigSession, to: number) => Math.abs(s.pose.swing - to) <= TOL * deg;
const slow = (s: DigSession) => Math.abs(s.vel.swing) < 0.05 * s.m.speeds.swing;
/** B를 지나는 중 폴·줄에 닿을 자세면 먼저 그것 */
const passing = (s: DigSession) => (s.pose.swing > 20 * deg && s.pose.swing < 160 * deg ? passFix(s) : null);
/** 퍼기 준비 자세 (넉넉하게): 버킷이 암과 거의 일직선, 버킷 바닥이 땅에서 1m 안 */
export const PREP = { bucket: 20, gap: 1.0 } as const;
export const prepared = (s: DigSession) => Math.abs(s.pose.bucket / deg) <= PREP.bucket && s.groundGap() <= PREP.gap && s.groundGap() > 0;
/** 퍼기 준비 자세까지 무엇을 할지: 땅에 닿았으면 올리기, 높으면 내리기, 버킷은 모자란 쪽으로 */
export const prepCoach = (s: Pick<DigSession, 'groundGap' | 'pose'>) => {
  const g = s.groundGap();
  const b = s.pose.bucket / deg;
  if (g <= 0) return co('땅에 닿았어요 — 붐 살짝 올리기', '붐 올림');
  if (g > PREP.gap) return co('붐 내려 땅 가까이', '붐 내림');
  return b < -PREP.bucket ? co('버킷 펴서 암과 일직선', '버킷 펴기') : co('버킷 조금 오므려 암과 일직선', '버킷 오므림');
};
const elapsed = (s: DigSession, bag: Record<string, number>) => s.t - (bag.t0 ?? s.t);

const steps: Step[] = [
  {
    text: 'A에서 흙 퍼서 선회 자세까지\n시간을 잽니다',
    labels: [],
    begin: (s, _mem, bag) => {
      bag.t0 = s.t;
      delete bag.sec;
    },
    done: (s) => s.load >= 0.9 * SC(s) && swingReady(s),
    coach: (s) =>
      s.load >= 0.9 * SC(s) && !swingReady(s)
        ? -s.pose.bucket / deg < MOVE.curl
          ? co('버킷 끝까지 오므리며 붐 올리기', '버킷 오므림', '붐 올림')
          : co('줄 위까지 붐 올리기', '붐 올림')
        : null,
    hud: (s, _m, bag) => `${Math.floor(elapsed(s, bag))}초`,
  },
  {
    text: 'B 지나 C로 — C 앞에서 미리 놓기',
    labels: ['선회 ◀'],
    // 흙을 실은 채로 C에 서야 한다 (가다 쏟았으면 아니다)
    done: (s) => near(s, SWING_C) && slow(s) && s.load >= 0.7 * SC(s),
    // 가다가 흙을 쏟아 버렸으면 다시 퍼 와야 한다 (막다른 길이 되지 않게 처음으로)
    fail: (s) => (s.load < 0.7 * SC(s) ? { to: 0, msg: '가다가 흙을 쏟았어요. A에서 다시 퍼 오기' } : null),
    coach: (s) => passing(s),
    hud: (s, _m, bag) => `${Math.floor(elapsed(s, bag))}초`,
  },
  {
    text: '땅 가까이 쏟고\n오므리며 붐 올려 선회 자세',
    labels: ['붐 내림', '버킷 펴기'],
    // 어디서 쏟았나는 흙이 반쯤 빠져나간 **그 순간**의 자리로 본다 (지날 때 한 번).
    // 다 쏟은 뒤 오므리며 붐 올리다 선회를 시작하는 건 정석(겹치기)이다 — 그때 C를 벗어나도 벌하지 않는다
    begin: (_s, _mem, bag) => delete bag.dumpAtC,
    done: (s, _mem, bag) => {
      if (bag.dumpAtC === undefined && s.load < 0.5 * SC(s)) bag.dumpAtC = near(s, SWING_C) ? 1 : 0;
      return bag.dumpAtC === 1 && s.load < MOVE.empty * SC(s) && swingReady(s);
    },
    // C 밖에서 쏟아 버렸으면 다시 퍼 와야 한다 (막다른 길이 되지 않게 처음으로)
    fail: (_s, _mem, bag) => (bag.dumpAtC === 0 ? { to: 0, msg: 'C 밖에서 쏟았어요. A에서 다시 퍼 오기' } : null),
    coach: (s) =>
      !near(s, SWING_C) && s.load >= 0.5 * SC(s)
        ? co('C 위로 돌아와 쏟기', s.pose.swing > 0 ? '선회 ◀' : '▶ 선회')
        : s.load < MOVE.empty * SC(s) && !swingReady(s)
          ? co('오므리며 붐 올려 선회 자세', '버킷 오므림', '붐 올림')
          : null,
    hud: (s, _m, bag) => `${Math.floor(elapsed(s, bag))}초`,
  },
  {
    text: 'A로 돌아오며 붐 내리고 버킷 펴기\n퍼기 준비 자세가 되면 끝',
    labels: ['▶ 선회', '붐 내림', '버킷 펴기'],
    // 시간은 A에서 **퍼기 준비 자세**(버킷 펴고 땅 가까이)가 될 때 멈춘다 — 돌아오며 겹쳐 내리면 그만큼 빠르다
    done: (s, _mem, bag) => {
      const ok = near(s, SWING_A) && slow(s) && prepared(s);
      if (ok) bag.sec = elapsed(s, bag);
      return ok;
    },
    coach: (s) =>
      passing(s) ??
      (near(s, SWING_A) && slow(s) && !prepared(s) ? prepCoach(s) : null),
    hud: (s, _m, bag) => `${Math.floor(elapsed(s, bag))}초`,
  },
];

export const CYCLE_LESSON: Lesson = {
  id: 'cycle',
  tier: '마무리',
  icon: 'stAll',
  title: '한 사이클 이어서',
  why: {
    title: '이제 끊지 말고 이어서',
    lines: [
      '시험은 4분 안에 네 번 퍼고 평탄까지 합니다. 한 사이클을 <b>45초</b> 안에 끝내야 여유가 있습니다.',
      '동작을 <b>겹치세요</b>: 오므리며 붐 올리다 줄 위가 되면 선회 시작, 돌아오다 B를 지나면 붐 내리며 버킷 펴기.',
      '레버를 같이 밀면 기름을 나눠 써서 하나하나는 조금 느려집니다. 그래도 끊어 하는 것보다 빠릅니다.',
      '시범은 없습니다. 기본기에서 배운 대로 한 번 이어서 해 보세요.',
    ],
  },
  setup: (s) => {
    s.teleport(readyPose());
    s.load = 0;
    s.loadBack = 0;
  },
  // 걸린 시간 (통과는 이미: 쏟고 A로 돌아왔다)
  grade: (_s, bag): Grade => {
    const raw = bag.sec ?? 999;
    const t = Math.round(raw);
    if (raw <= PACE.good) return { stars: 3, note: `한 사이클 ${t}초 — 시험 페이스입니다` };
    if (raw <= PACE.ok) return { stars: 2, note: `한 사이클 ${t}초. 줄 위가 되면 바로 선회, 돌아오며 붐 내리기로 줄여 보세요` };
    return { stars: 1, note: `한 사이클 ${t}초. 동작을 겹치면 ${PACE.good}초 안에 됩니다` };
  },
  steps,
};
