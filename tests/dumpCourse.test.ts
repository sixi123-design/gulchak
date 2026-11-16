import { expect, it } from 'vitest';
import { BASIC_LESSONS } from '../src/sim/leverSchool';
import { ease, frame, tutorFor, until, type Hand as In } from './harness';

/** '쏟고 돌릴 자세'를 끝까지 — 정석으로 통과하고, 막다른 길이 없는지 */
const tutor = () => tutorFor(BASIC_LESSONS.find((l) => l.id === 'b-dump')!);
const both: In = { rx: -0.75, ry: -0.75 }; // 버킷 오므림 + 붐 올림 (오른쪽 레버 왼쪽 아래)

it('쏟고 → 오므리며 들고 → 천천히 놓으면 끝난다', () => {
  const t = tutor();
  expect(until(t, { rx: 0.8 }, 900), '쏟기').toBe(true);
  expect(until(t, both, 900), '오므리며 들기').toBe(true);
  ease(t, both);
  for (let i = 0; i < 300 && !t.cleared; i++) frame(t, {});
  expect(t.cleared).toBe(true);
});

it('하나씩 끝까지 써서 막히면, 쏟은 자세로 되돌려 다시 하게 한다', () => {
  const t = tutor();
  until(t, { rx: 0.8 }, 900);
  const step = t.step;
  // 버킷만 끝까지 오므리고, 그다음 붐만 끝까지
  for (let i = 0; i < 400 && t.step === step; i++) frame(t, { rx: -0.9 });
  for (let i = 0; i < 400 && t.step === step; i++) frame(t, {});
  for (let i = 0; i < 900 && t.step === step && !t.notice; i++) frame(t, i < 600 ? { ry: -0.9 } : {});
  expect(t.notice ?? '', '막혔다고 알려 줘야 한다').toMatch(/같이/);
  expect(t.step).toBe(step);
  expect(t.s.pose.bucket, '쏟은 자세로 돌아왔다').toBeGreaterThan(-60 * (Math.PI / 180));
  // 다시 같이 하면 통과
  expect(until(t, both, 900)).toBe(true);
});

it('멈추기에서 덜컹해도 레버를 다시 잡았다 천천히 놓으면 통과한다', () => {
  const t = tutor();
  until(t, { rx: 0.8 }, 900);
  until(t, both, 900);
  // 확 놓아 덜컹했다 (값을 직접 넣는다 — readyCourse와 같은 방식)
  frame(t, {});
  t.s.maxJolt = 0.2;
  for (let i = 0; i < 120; i++) frame(t, {});
  expect(t.cleared, '덜컹한 채로 끝나면 안 된다').toBe(false);
  // 살짝 다시 밀었다가 천천히
  const nudge: In = { ry: -0.3 };
  for (let i = 0; i < 20; i++) frame(t, nudge);
  ease(t, nudge, 60);
  for (let i = 0; i < 300 && !t.cleared; i++) frame(t, {});
  expect(t.cleared, '고쳐도 못 끝내면 막다른 길이다').toBe(true);
});

it('멈추기에는 진행 막대가 있다 — 잡고 있으면 0, 놓고 서면 끝까지 찬다', () => {
  const t = tutor();
  until(t, { rx: 0.8 }, 900);
  until(t, both, 900);
  expect(t.meter()?.v, '레버를 잡고 있다').toBe(0);
  expect(t.hud() ?? '').toMatch(/가운데로/);
  ease(t, both);
  let top = 0;
  for (let i = 0; i < 300 && !t.cleared; i++) {
    top = Math.max(top, t.meter()?.v ?? 0);
    frame(t, {});
  }
  expect(t.cleared).toBe(true);
  expect(top).toBeGreaterThan(0.9);
});
