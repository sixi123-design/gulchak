import { expect, it } from 'vitest';
import { masterGain } from '../src/ui/audio';

it('음량 100%는 지금과 같은 0.8', () => expect(masterGain(1, false)).toBeCloseTo(0.8));
it('절반이면 0.4', () => expect(masterGain(0.5, false)).toBeCloseTo(0.4));
it('음소거는 음량과 무관하게 0', () => expect(masterGain(0.5, true)).toBe(0));
it('범위를 벗어난 값은 0~1로 자른다', () => {
  expect(masterGain(2, false)).toBeCloseTo(0.8);
  expect(masterGain(-1, false)).toBe(0);
});
it('숫자가 아니면 100%로 본다', () => expect(masterGain(NaN, false)).toBeCloseTo(0.8));
