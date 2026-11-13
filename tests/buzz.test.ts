import { beforeEach, expect, it } from 'vitest';
import { installFakeStorage } from './fakeStorage';
import { buzz, buzzOn, setBuzz, _setVibrate } from '../src/ui/buzz';

installFakeStorage();

let calls: (number | number[])[];
beforeEach(() => {
  localStorage.clear();
  calls = [];
  _setVibrate((p) => calls.push(p));
  setBuzz(true);
});

it('켜져 있으면 그대로 전달', () => {
  buzz(15);
  expect(calls).toEqual([15]);
});

it('패턴도 그대로 전달', () => {
  buzz([30, 40, 30]);
  expect(calls).toEqual([[30, 40, 30]]);
});

it('꺼져 있으면 호출하지 않음', () => {
  setBuzz(false);
  buzz(15);
  expect(calls).toEqual([]);
});

it('끈 값은 저장되고 다시 읽힌다', () => {
  setBuzz(false);
  expect(buzzOn()).toBe(false);
  expect(localStorage.getItem('exc-buzz')).toBe('0');
});

it('진동을 못 쓰는 기기에서도 터지지 않음', () => {
  _setVibrate(null);
  expect(() => buzz([30, 40])).not.toThrow();
});
