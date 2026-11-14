import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { fill, pose } from '../src/sim/tutorial';

const R = rules as unknown as RulesFile;
const deg = Math.PI / 180;
const go = (s: DigSession, inp: Record<string, number>, n: number) => {
  for (let i = 0; i < n; i++) {
    s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    s.step();
  }
};
/** 한 삽 퍼서 완전히 오므리고 운반 높이로 든 상태 */
function carry(heaped: boolean) {
  const s = new DigSession(MACHINE, R, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 60; i++) s.step();
  const A = s.site.stations.find((x) => x.name === 'A')!;
  pose(s, Math.PI, (A.zoneIn + A.zoneOut) / 2, 0.1, -20 * deg);
  go(s, { ry: 0.5 }, 40);
  go(s, { ly: -0.6, rx: -0.5 }, heaped ? 260 : 160);
  go(s, { rx: -1, ry: -0.4 }, 120);
  go(s, { rx: -1 }, 300); // 끝까지 오므림
  go(s, { ry: -0.5 }, 60);
  // 정석으로 파면 평적을 못 넘는다. 고봉 운반을 보려면 올려 담은 상태로 맞춘다
  // (완전히 오므린 버킷은 이렇게 채워도 그대로 유지된다 — 측정으로 확인)
  if (heaped) fill(s, 1.25);
  return s;
}
/** 흙을 몇 % 흘렸나 */
const lost = (s: DigSession, fn: (s: DigSession) => void) => {
  const b = s.load;
  fn(s);
  return ((b - s.load) / b) * 100;
};

describe('운반 중 흙 흘림 (현장 기준)', () => {
  it('완전히 오므리고 가만히 있으면 거의 안 흘린다', () => {
    expect(lost(carry(false), (s) => go(s, {}, 240))).toBeLessThan(2);
  });

  it('완전히 오므리고 평적이면 최고 속도로 돌려도 거의 안 흘린다', () => {
    expect(lost(carry(false), (s) => go(s, { lx: 1 }, 300))).toBeLessThan(5);
  });

  it('고봉으로 담으면 돌릴 때 흘리기 시작한다 (평적은 안 흘린다)', () => {
    // 이 장비는 흙을 실으면 선회가 느려져 정속 원심력이 0.1g 수준이다.
    // 그래서 '최고속으로 돌리기'만으로는 조금 샌다. 크게 흘리는 것은 급조작이다 — 아래 테스트.
    const heaped = lost(carry(true), (s) => go(s, { lx: 1 }, 300));
    const struck = lost(carry(false), (s) => go(s, { lx: 1 }, 300));
    expect(heaped).toBeGreaterThan(0.2);
    expect(heaped).toBeGreaterThan(struck * 5);
  });

  it('고봉으로 레버를 확 주고 확 놓으면 살살 돌릴 때보다 많이 흘린다', () => {
    const rough = lost(carry(true), (s) => { go(s, { lx: 1 }, 120); go(s, {}, 120); });
    const gentle = lost(carry(true), (s) => go(s, { lx: 0.3 }, 600));
    expect(rough).toBeGreaterThan(gentle * 3);
  });

  it('고봉으로 담고 반대로 확 꺾으면 크게 흘린다 (10~30%)', () => {
    const v = lost(carry(true), (s) => {
      go(s, { lx: 1 }, 150);
      go(s, { lx: -1 }, 120);
    });
    expect(v).toBeGreaterThan(10);
    expect(v).toBeLessThan(30);
  });

  it('고봉이어도 천천히 돌리면 적게 흘린다 (급선회보다 덜)', () => {
    const slow = lost(carry(true), (s) => go(s, { lx: 0.3 }, 600));
    const fast = lost(carry(true), (s) => go(s, { lx: 1 }, 300));
    expect(slow).toBeLessThan(fast);
  });
});
