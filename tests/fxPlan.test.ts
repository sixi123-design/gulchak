import { describe, expect, it } from 'vitest';
import { fxPlan } from '../src/ui/quality';

describe('화질 단계별 연출 예산', () => {
  it('저가폰(0단)은 먼지를 아예 안 쓴다', () => {
    expect(fxPlan(0).dust).toBe(0);
  });

  it('저가폰(0단)은 흙 알갱이를 덩어리 하나로만 그린다', () => {
    expect(fxPlan(0).clumps).toBe(1);
    expect(fxPlan(1).clumps).toBeGreaterThan(1);
  });

  it('단계가 올라갈수록 알갱이 수가 는다', () => {
    expect(fxPlan(0).particles).toBeLessThan(fxPlan(1).particles);
    expect(fxPlan(1).particles).toBeLessThan(fxPlan(2).particles);
  });

  it('그려야 할 인스턴스 수가 0단에서 1단보다 훨씬 적다 (저가폰이 1순위)', () => {
    const inst = (l: 0 | 1 | 2) => fxPlan(l).particles * fxPlan(l).clumps + fxPlan(l).dust;
    expect(inst(0) * 4).toBeLessThan(inst(1));
  });

  it('어느 단계에서도 미리 잡아 둔 자리를 넘지 않는다', () => {
    const cap = fxPlan(2).particles * fxPlan(2).clumps;
    for (const l of [0, 1, 2] as const) expect(fxPlan(l).particles * fxPlan(l).clumps).toBeLessThanOrEqual(cap);
  });
});
