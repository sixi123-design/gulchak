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
  it('퍼 담기: 버킷 펴고 → 뻗고 → 꽂고 → 반쯤 오므리고 → 암 당겨 눌러 담고 → 오므리며 들면 완료', () => {
    const t = new Tutor(lesson('scoop'), mk());
    const deg = Math.PI / 180;
    const steps: ((s: DigSession) => Partial<Sticks>)[] = [
      (s) => ({ rx: s.pose.bucket < -5 * deg ? 1 : s.pose.bucket > 5 * deg ? -1 : 0 }),
      () => ({ ly: 0.8 }),
      (s) => {
        const r = s.frame.tip.r;
        const want = s.digTarget.rho - 0.4;
        return { ry: 0.6, ly: r < want - 0.15 ? 0.6 : r > want + 0.15 ? -0.6 : 0 };
      },
      () => ({ rx: -0.6, ry: -0.1 }),
      // 오므림 멈추고 암만 당겨 눌러 담기, 너무 깊으면 붐 올림
      (s) => ({ ly: -0.7, ry: s.groundGap() < -0.6 ? -0.4 : 0 }),
      () => ({ rx: -1, ry: -1 }),
    ];
    for (const [i, f] of steps.entries()) expect(drive(t, f, 900), `단계 ${i + 1}`).toBe(true);
    expect(t.notice).toBe(null);
    expect(t.rewinds).toBe(0);
    expect(t.cleared).toBe(true);
    // 무거운 흙: 같은 스크립트 동작이면 조금 덜 참 (75% 이상)
    expect(t.s.load).toBeGreaterThanOrEqual(0.75 * t.s.m.struckCapacity);
    expect(t.s.engine.disqualifications()).toEqual([]);
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
  it('선회·흙 쏟기: 붐 들고 → B 지나 C → 쏟고 → A로 돌아오면 완료, 흙은 C에, 실격 없음', () => {
    const t = new Tutor(lesson('carryDump'), mk());
    const g = t.s.soil.grids.find((x) => x.name === 'C')!;
    const vol = () => g.h.reduce((a, h, i) => a + h - g.h0[i], 0) * g.cell * g.cell;
    const v0 = vol();
    expect(drive(t, () => ({ ly: -1, ry: -1 }), 600), '암 당기고 붐 올림').toBe(true);
    // A(π) → B(π/2) → C(0): 각도가 줄어드는 쪽
    // 흙을 실으면 붐이 굼떠 암이 먼저 다 당겨짐 → 선회하며 암을 조금 펴서 C 위에 맞춤
    const Cst = t.s.site.stations[1];
    expect(drive(t, (s) => ({ lx: -1, ly: s.frame.tip.r < (Cst.zoneIn + Cst.zoneOut) / 2 ? 0.6 : 0 }), 900), 'C로 선회').toBe(true);
    expect(drive(t, () => ({ rx: 1 }), 600), '쏟기').toBe(true);
    expect(vol() - v0).toBeGreaterThan(0.35);
    expect(drive(t, () => ({ lx: 1 }), 900), 'A로 돌아옴').toBe(true);
    expect(t.cleared).toBe(true);
    expect(t.s.engine.disqualifications()).toEqual([]);
  });
});
