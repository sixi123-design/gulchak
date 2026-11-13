import { beforeEach, expect, it } from 'vitest';
import { installFakeStorage } from './fakeStorage';
import { STEPS, loadStep, saveStep, cssVars, loadNum, loadFlag, loadRaw, saveRaw } from '../src/ui/prefs';

installFakeStorage();
beforeEach(() => localStorage.clear());

it('저장값이 없으면 기본값', () => {
  expect(loadStep('edge')).toBe(STEPS.edge.def);
  expect(STEPS.edge.v[STEPS.edge.def]).toBe(18); // 현행 유지
});

it('범위 밖·손상값은 기본값', () => {
  localStorage.setItem('exc-z-edge', '9');
  expect(loadStep('edge')).toBe(STEPS.edge.def);
  localStorage.setItem('exc-z-edge', 'abc');
  expect(loadStep('edge')).toBe(STEPS.edge.def);
});

it('저장하면 다시 읽힌다', () => {
  saveStep('edge', 2);
  expect(loadStep('edge')).toBe(2);
});

it('cssVars는 레버 여백을 px로 준다', () => {
  saveStep('edge', 0);
  expect(cssVars()['--stick-edge']).toBe('8px');
  expect(cssVars()['--z-btn']).toBe('1');
});

it('loadNum·loadFlag도 범위와 기본값을 지킨다', () => {
  localStorage.setItem('exc-vol-all', 'abc');
  expect(loadNum('exc-vol-all', 1, 0, 1)).toBe(1);
  expect(loadFlag('exc-buzz', true)).toBe(true);
});

it('loadNum은 범위 밖 숫자도 기본값으로', () => {
  localStorage.setItem('exc-vol-all', '5');
  expect(loadNum('exc-vol-all', 1, 0, 1)).toBe(1);
  localStorage.setItem('exc-vol-all', '0.4');
  expect(loadNum('exc-vol-all', 1, 0, 1)).toBeCloseTo(0.4);
});

it('loadFlag는 0만 꺼짐으로 읽는다', () => {
  saveRaw('exc-buzz', '0');
  expect(loadFlag('exc-buzz', true)).toBe(false);
  saveRaw('exc-buzz', '1');
  expect(loadFlag('exc-buzz', true)).toBe(true);
});

it('loadRaw는 없으면 null', () => {
  expect(loadRaw('exc-q')).toBe(null);
  saveRaw('exc-q', 'auto');
  expect(loadRaw('exc-q')).toBe('auto');
});

it('저장소가 막혀 있어도 기본값으로 동작한다', () => {
  const real = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });
  try {
    expect(loadStep('edge')).toBe(STEPS.edge.def);
    expect(loadNum('exc-vol-all', 1, 0, 1)).toBe(1);
    expect(loadFlag('exc-buzz', true)).toBe(true);
    expect(loadRaw('exc-q')).toBe(null);
    expect(() => saveStep('edge', 2)).not.toThrow();
    expect(() => saveRaw('exc-q', '2')).not.toThrow();
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: real });
  }
});
