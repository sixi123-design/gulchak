import { expect, it } from 'vitest';
import { BASIC_LESSONS } from '../src/sim/leverSchool';
import { ease, frame, tutorFor, until, type Hand as In } from './harness';
import { MOVE } from '../src/sim/moveCourse';
import { bucketLow, ropeClear, SC } from '../src/sim/tutorial';
import { SMOOTH_MAX } from '../src/sim/gauge';

const deg = Math.PI / 180;

/** '쏟고 돌릴 자세'를 끝까지 — 정석으로 통과하고, 막다른 길이 없는지 */
/** 실습부터 (시범 건너뜀 — 시범은 아래에서 따로 본다) */
const tutor = () => {
  const t = tutorFor(BASIC_LESSONS.find((l) => l.id === 'b-dump')!);
  t.skipDemo();
  return t;
};
const both: In = { rx: -0.75, ry: -0.75 }; // 버킷 오므림 + 붐 올림 (오른쪽 레버 왼쪽 아래)

it('쏟고 → 오므리며 들고 → 천천히 놓으면 끝난다', () => {
  const t = tutor();
  expect(until(t, { rx: 0.8 }, 900), '쏟기').toBe(true);
  expect(until(t, both, 900), '오므리며 들기').toBe(true);
  ease(t, both);
  for (let i = 0; i < 300 && !t.cleared; i++) frame(t, {});
  expect(t.cleared).toBe(true);
});

// '하나씩 끝까지 써서 막히면 되돌리기'는 없앴다 — 결과 자세로 판정하고 순서는 별점으로 (tests/outcomeJudge)

it('멈추기에서 덜컹하면 통과는 하되 별 3개는 아니다 (막다른 길 아님 — 아스트라 기준)', () => {
  const t = tutor();
  until(t, { rx: 0.8 }, 900);
  until(t, both, 900);
  // 확 놓아 덜컹했다 (값을 직접 넣는다 — readyCourse와 같은 방식)
  frame(t, {});
  t.s.maxJolt = 0.2;
  for (let i = 0; i < 300 && !t.cleared; i++) frame(t, {});
  expect(t.cleared, '덜컹 한 번에 막히면 안 된다').toBe(true);
  expect(BASIC_LESSONS.find((l) => l.id === 'b-dump')!.grade!(t.s, t.bag).stars).toBeLessThan(3);
});

it('멈추기에는 진행 막대가 있다 — 잡고 있으면 0, 놓고 서면 끝까지 찬다', () => {
  const t = tutor();
  until(t, { rx: 0.8 }, 900);
  until(t, both, 900);
  expect(t.meter()?.v, '레버를 잡고 있다').toBe(0);
  expect(t.hud() ?? '').toMatch(/가운데로/);
  let top = 0;
  // 서서히 놓는 동안에도 막대를 본다 (버킷이 이미 끝까지 접혀 있어 놓는 도중에 다 설 수 있다)
  for (let i = 1; i <= 40 && !t.cleared; i++) {
    top = Math.max(top, t.meter()?.v ?? 0);
    frame(t, { rx: both.rx! * (1 - i / 40), ry: both.ry! * (1 - i / 40) });
  }
  for (let i = 0; i < 300 && !t.cleared; i++) {
    top = Math.max(top, t.meter()?.v ?? 0);
    frame(t, {});
  }
  expect(t.cleared).toBe(true);
  expect(top).toBeGreaterThan(0.9);
});

it('시범: 쏟고 → 오므리며 붐 올려 줄 위 선회 자세에서 덜컹 없이 멈춘다 → 다시 볼까요?', () => {
  const t = tutorFor(BASIC_LESSONS.find((l) => l.id === 'b-dump')!);
  let maxJolt = 0;
  for (let i = 0; i < 3000 && !t.current?.ask; i++) {
    frame(t, { ry: 1 }); // 시범 중 손을 대도 무시된다
    maxJolt = Math.max(maxJolt, t.s.maxJolt);
  }
  expect(t.current?.ask, '시범이 끝나지 않았다').toBeTruthy();
  expect(-t.s.pose.bucket / deg).toBeGreaterThanOrEqual(MOVE.curl);
  expect(bucketLow(t.s)).toBeGreaterThanOrEqual(ropeClear(t.s));
  expect(maxJolt).toBeLessThan(SMOOTH_MAX);
  // 다음 → 실습은 흙이 다시 담긴 처음 자세에서
  t.choose(false);
  expect(t.current?.text).toMatch(/흙 쏟기/);
  expect(t.s.load).toBeGreaterThan(MOVE.empty * SC(t.s));
});
