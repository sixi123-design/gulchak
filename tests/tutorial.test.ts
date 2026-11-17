import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile, type Sticks } from '../src/sim/session';
import { LESSONS, Tutor } from '../src/sim/tutorial';

const mk = (autoEnd = false) => {
  const s = new DigSession(MACHINE, rules as unknown as RulesFile, { ...MODES.tutorial, autoEnd }, () => 0.5);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 0.8;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  return s;
};
const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
/** 입력을 주며 진행. 단계가 끝날 때까지(최대 n프레임) */
function drive(t: Tutor, input: (s: DigSession) => Partial<Sticks>, n = 600) {
  const start = t.step;
  for (let i = 0; i < n && t.step === start && !t.cleared; i++) {
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...input(t.s) };
    t.s.step();
    t.update();
  }
  return t.step > start || t.cleared;
}

describe('배우기', () => {
  it('모든 미션: 시작하자마자 끝나 있지 않음', () => {
    for (const l of LESSONS) {
      const t = new Tutor(l, mk(l.autoEnd));
      t.s.step();
      expect(t.update(), l.id).toBe(false);
    }
  });
  it('깊어진 구덩이: 이빨 세워 먼 끝 → 꽂고 → 깊이 지키며 오므려 당기고 → 가상선 전에 들면 완료, 실격 없음', () => {
    const t = new Tutor(lesson('deepScoop'), mk());
    const sc = t.s.m.struckCapacity;
    const vert = (s: DigSession) => (s.frame.thK * 180) / Math.PI + 90;
    const far = (s: DigSession) => Math.max(s.frame.tip.r, s.frame.heel.r, s.frame.P2.r) - s.site.stations[0].zoneOut;
    const steps: ((s: DigSession) => Partial<Sticks>)[] = [
      (s) => ({ ly: far(s) < -0.3 ? 0.5 : far(s) > -0.15 ? -0.4 : 0, rx: vert(s) < -12 ? 0.6 : vert(s) > 12 ? -0.6 : 0 }),
      (s) => ({ ry: 0.6, ly: far(s) < -0.35 ? 0.6 : 0 }),
      // 반쯤 오므린 채(끝까지 오므리면 입구가 좁아져 안 들어옴) 암을 당겨 쓸어 담기
      (s) => ({ rx: s.pose.bucket > -0.8 ? -0.6 : 0, ly: -0.5, ry: s.groundGap() > -0.2 ? 0.6 : 0 }),
      (s) => ({ ry: -0.8, rx: s.fullyCurled ? 0 : -1 }),
    ];
    for (const [i, f] of steps.entries()) expect(drive(t, f, 1200), `단계 ${i + 1}`).toBe(true);
    expect(t.cleared).toBe(true);
    expect(t.s.load).toBeGreaterThanOrEqual(0.8 * sc);
    expect(t.s.engine.disqualifications()).toEqual([]);
  });
  it('평탄·마무리: 뒤집고 → 뻗고 → 끌어오고 → 밀 준비 → 밀고 → 내려놓으면 완료', () => {
    const t = new Tutor(lesson('flatten'), mk(true));
    expect(drive(t, () => ({ rx: 1 }), 400)).toBe(true);
    expect(t.s.flags.autoEnd).toBe(false);
    expect(drive(t, () => ({ ly: 1 }), 600)).toBe(true);
    // 흙 표면을 따라 긁기: 뜨면 붐 내림, 너무 박히면 붐 올림
    const skim = (dir: 1 | -1) => (s: DigSession) => {
      const g = s.groundGap();
      return g > 0.05 ? { ry: 0.5, ly: 0.3 * dir } : g < -0.08 ? { ly: dir, ry: -0.6 } : { ly: dir };
    };
    expect(drive(t, skim(-1), 900)).toBe(true);
    expect(drive(t, () => ({ ry: -0.6, ly: -1 }), 900)).toBe(true);
    expect(drive(t, skim(1), 900)).toBe(true);
    expect(t.s.flags.autoEnd).toBe(true);
    const open = (s: DigSession) => s.pose.bucket < s.m.limits.bucket[1] - 0.02;
    expect(drive(t, (s) => (open(s) ? { rx: 1 } : s.groundGap() > 0.02 ? { ry: 0.5 } : {}), 900)).toBe(true);
    expect(t.cleared).toBe(true);
    expect(t.s.engine.disqualifications()).toEqual([]);
  });
});
