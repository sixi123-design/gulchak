import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';

const R = rules as unknown as RulesFile;
const SC = MACHINE.struckCapacity;
const d = (x: number) => (x * Math.PI) / 180;
const go = (s: DigSession, lx: number, n: number) => {
  for (let i = 0; i < n; i++) {
    s.input = { lx, ly: 0, rx: 0, ry: 0 };
    s.step();
  }
};
/**
 * 흙을 싣고 운반하는 자세. `bucket`으로 오므림 정도를 정한다.
 * -133° = 제대로 오므림 (입구가 위를 봄), -60° = 어정쩡, 0° = 거의 안 오므림
 */
function carry(bucket: number, ratio = 1.25) {
  const s = new DigSession(MACHINE, R, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  s.teleport({ swing: Math.PI, boom: d(25), arm: d(-40), bucket: d(bucket) });
  s.load = SC * ratio;
  s.loadBack = s.load * 0.85;
  return s;
}
const lost = (s: DigSession, fn: (s: DigSession) => void) => {
  const b = s.load;
  fn(s);
  return ((b - s.load) / b) * 100;
};
/** 레버를 1초에 걸쳐 주고, 돌리고, 1초에 걸쳐 놓는다 */
const smooth = (s: DigSession) => {
  for (let i = 1; i <= 60; i++) go(s, i / 60, 1);
  go(s, 1, 120);
  for (let i = 60; i >= 0; i--) go(s, i / 60, 1);
};
const rough = (s: DigSession) => {
  go(s, 1, 120);
  go(s, 0, 120);
};
const flick = (s: DigSession) => {
  go(s, 1, 150);
  go(s, -1, 120);
};

describe('운반 중 흙 흘림', () => {
  it('제대로 오므리고 부드럽게 돌리면 거의 안 흘린다', () => {
    expect(lost(carry(-133), smooth)).toBeLessThan(2);
  });

  it('제대로 오므려도 레버를 확 주고 확 놓으면 흘린다', () => {
    expect(lost(carry(-133), rough)).toBeGreaterThan(lost(carry(-133), smooth) * 2);
  });

  it('반대로 확 꺾으면 가장 많이 흘린다', () => {
    const v = lost(carry(-133), flick);
    expect(v).toBeGreaterThan(lost(carry(-133), rough));
    expect(v).toBeGreaterThan(5);
  });

  it('어정쩡하게 오므린 채로 돌리면 부드럽게 해도 크게 흘린다', () => {
    const half = lost(carry(-60), smooth);
    expect(half).toBeGreaterThan(lost(carry(-133), smooth) * 5);
    expect(half).toBeGreaterThan(10);
  });

  it('평적만 담으면 고봉일 때보다 덜 흘린다', () => {
    expect(lost(carry(-133, 0.9), flick)).toBeLessThan(lost(carry(-133, 1.25), flick));
  });

  it('돌리지 않고 가만히 있으면 안 흘린다', () => {
    expect(lost(carry(-133), (s) => go(s, 0, 240))).toBeLessThan(0.5);
  });
});
