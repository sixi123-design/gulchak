import { expect, it } from 'vitest';
import { INTRO_KEY, wantIntro } from '../src/ui/prefs';

it('처음 온 사람은 오프닝을 본다', () => {
  expect(wantIntro(null, false)).toBe(true);
});

it('한 번 본 사람은 바로 시작 화면으로', () => {
  expect(wantIntro('1', false)).toBe(false);
});

it('?nointro면 처음이라도 생략', () => {
  expect(wantIntro(null, true)).toBe(false);
});

it('저장값이 깨져 있으면 본다', () => {
  expect(wantIntro('', false)).toBe(true);
  expect(wantIntro('0', false)).toBe(true);
  expect(wantIntro('yes', false)).toBe(true);
});

it('키는 exc- 로 시작', () => {
  expect(INTRO_KEY.startsWith('exc-')).toBe(true);
});
