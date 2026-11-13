import { beforeEach, expect, it } from 'vitest';
import { installFakeStorage } from './fakeStorage';
import { bumpRuns, loadRuns } from '../src/core/practiceLog';

installFakeStorage();
beforeEach(() => localStorage.clear());

it('처음엔 0판', () => {
  expect(loadRuns('2026-11-14')).toEqual({ total: 0, today: 0 });
});

it('한 판 끝낼 때마다 쌓인다', () => {
  bumpRuns('2026-11-14');
  bumpRuns('2026-11-14');
  expect(loadRuns('2026-11-14')).toEqual({ total: 2, today: 2 });
});

it('날이 바뀌면 오늘만 다시 센다', () => {
  bumpRuns('2026-11-14');
  bumpRuns('2026-11-14');
  bumpRuns('2026-11-15');
  expect(loadRuns('2026-11-15')).toEqual({ total: 3, today: 1 });
});

it('읽을 때 날이 바뀌어 있으면 오늘은 0', () => {
  bumpRuns('2026-11-14');
  expect(loadRuns('2026-11-15')).toEqual({ total: 1, today: 0 });
});

it('저장값이 깨져 있어도 0부터', () => {
  localStorage.setItem('exc-runs', '{{');
  expect(loadRuns('2026-11-14')).toEqual({ total: 0, today: 0 });
  bumpRuns('2026-11-14');
  expect(loadRuns('2026-11-14')).toEqual({ total: 1, today: 1 });
});
