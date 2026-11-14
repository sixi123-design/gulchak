import { beforeEach, expect, it } from 'vitest';
import { installFakeStorage } from './fakeStorage';
import { loadSeen, markSeen, WHY_KEY } from '../src/ui/prefs';

installFakeStorage();
beforeEach(() => localStorage.clear());

it('처음엔 아무것도 안 봤다', () => {
  expect(loadSeen(WHY_KEY)).toEqual([]);
});

it('본 것이 쌓인다', () => {
  markSeen(WHY_KEY, 'a');
  markSeen(WHY_KEY, 'b');
  expect(loadSeen(WHY_KEY)).toEqual(['a', 'b']);
});

it('같은 걸 두 번 넣어도 하나', () => {
  markSeen(WHY_KEY, 'a');
  markSeen(WHY_KEY, 'a');
  expect(loadSeen(WHY_KEY)).toEqual(['a']);
});

it('저장값이 깨져 있으면 빈 목록', () => {
  localStorage.setItem(WHY_KEY, '{{');
  expect(loadSeen(WHY_KEY)).toEqual([]);
  markSeen(WHY_KEY, 'a');
  expect(loadSeen(WHY_KEY)).toEqual(['a']);
});

it('저장값이 배열이 아니면 빈 목록', () => {
  localStorage.setItem(WHY_KEY, '{"a":1}');
  expect(loadSeen(WHY_KEY)).toEqual([]);
});

it('배열 안에 문자열이 아닌 게 있으면 걸러낸다', () => {
  localStorage.setItem(WHY_KEY, '["a",3,null,"b"]');
  expect(loadSeen(WHY_KEY)).toEqual(['a', 'b']);
});

it('저장소가 막혀 있어도 던지지 않는다', () => {
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = broken;
  expect(() => loadSeen(WHY_KEY)).not.toThrow();
  expect(loadSeen(WHY_KEY)).toEqual([]);
  expect(() => markSeen(WHY_KEY, 'a')).not.toThrow();
  installFakeStorage();
});

it('키는 exc- 로 시작', () => {
  expect(WHY_KEY.startsWith('exc-')).toBe(true);
});
