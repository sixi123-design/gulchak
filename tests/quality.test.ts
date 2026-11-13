import { beforeEach, expect, it } from 'vitest';
import { installFakeStorage } from './fakeStorage';
import { Q, autoLevel, loadQuality, saveQuality, levelOf } from '../src/ui/quality';

installFakeStorage();
beforeEach(() => localStorage.clear());

it('보통이 현행 값', () => {
  expect(Q[1].dprCap).toBe(1.25);
  expect(Q[1].aa).toBe(false);
});
it('느리면 한 단 내린다', () => expect(autoLevel(45, 1)).toBe(0));
it('가장 낮은 단에서는 더 안 내려간다', () => expect(autoLevel(45, 0)).toBe(0));
it('빠르면 한 단 올린다', () => expect(autoLevel(14, 1)).toBe(2));
it('가장 높은 단에서는 더 안 올라간다', () => expect(autoLevel(14, 2)).toBe(2));
it('어중간하면 그대로', () => expect(autoLevel(28, 1)).toBe(1));
it('기본은 자동', () => expect(loadQuality()).toBe('auto'));
it('손으로 고른 값은 유지된다', () => {
  saveQuality(2);
  expect(loadQuality()).toBe(2);
});
it('저장값이 손상되면 자동으로 본다', () => {
  localStorage.setItem('exc-q', '7');
  expect(loadQuality()).toBe('auto');
  localStorage.setItem('exc-q', 'abc');
  expect(loadQuality()).toBe('auto');
});
it('자동일 때의 시작 단계는 보통', () => expect(levelOf('auto')).toBe(1));
it('고른 값이 있으면 그 단계', () => expect(levelOf(0)).toBe(0));
