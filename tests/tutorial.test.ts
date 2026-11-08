import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile, type Sticks } from '../src/sim/session';
import { ik, type Pose } from '../src/sim/kinematics';
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
  it('레버 익히기: 각 레버를 움직이면 단계가 넘어가 완료', () => {
    const t = new Tutor(lesson('levers'), mk());
    const seq: Partial<Sticks>[] = [{ ry: -1 }, { ry: 1 }, { ly: 1 }, { ly: -1 }, { rx: -1 }, { rx: 1 }, { lx: -1 }, { lx: 1 }];
    for (const inp of seq) expect(drive(t, () => inp, 300)).toBe(true);
    expect(t.cleared).toBe(true);
  });
  it('흙 쏟기: C 위에서 버킷을 펴면 완료, 흙은 C 구덩이에', () => {
    const t = new Tutor(lesson('dump'), mk());
    const g = t.s.soil.grids.find((x) => x.name === 'C')!;
    const vol = () => g.h.reduce((a, h, i) => a + h - g.h0[i], 0) * g.cell * g.cell;
    const v0 = vol();
    expect(drive(t, () => ({ rx: 1 }), 600)).toBe(true);
    expect(t.cleared).toBe(true);
    expect(vol() - v0).toBeGreaterThan(0.35);
  });
  // 자세를 직접 보간하며 진행 (레버 대신) — 미션 판정이 실제 동작으로 풀리는지 확인
  const via = (t: Tutor, r: number, y: number, thK: number, n: number) => {
    const q = ik(MACHINE, r, y, thK)!;
    const from = { ...t.s.pose };
    for (let i = 1; i <= n; i++) {
      const p: Partial<Pose> = {};
      for (const k of Object.keys(q) as (keyof Pose)[]) p[k] = from[k] + (((q as Pose)[k] as number) - from[k]) * (i / n);
      t.s.setPose(p);
      t.s.step();
      t.update();
    }
  };
  it('퍼 담기: 뻗고 → 이빨 세워 꽂고 → 당기며 오므리고 → 들어 올리면 완료', () => {
    const t = new Tutor(lesson('scoop'), mk());
    const A = t.s.site.stations[0];
    const r0 = t.s.digTarget.rho;
    const surf = t.s.soil.surfaceAt(-r0, 0);
    via(t, r0, 1.0, -1.0, 60);
    expect(t.step).toBe(2);
    via(t, r0, surf - 0.3, -1.0, 40);
    expect(t.step).toBe(3);
    via(t, A.pitIn + 0.5, surf - 0.25, -2.6, 100);
    expect(t.step).toBeGreaterThanOrEqual(5);
    via(t, A.pitIn + 0.6, 1.4, -Math.PI - 0.6, 40);
    expect(t.cleared).toBe(true);
  });
  it('평탄·마무리: 뒤집고 → 뻗고 → 끌어오고 → 밀고 → 내려놓으면 완료', () => {
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
    expect(drive(t, skim(1), 900)).toBe(true);
    expect(t.s.flags.autoEnd).toBe(true);
    const open = (s: DigSession) => s.pose.bucket < s.m.limits.bucket[1] - 0.02;
    expect(drive(t, (s) => (open(s) ? { rx: 1 } : s.groundGap() > 0.02 ? { ry: 0.5 } : {}), 900)).toBe(true);
    expect(t.cleared).toBe(true);
    expect(t.s.engine.disqualifications()).toEqual([]);
  });
  it('B 통과 선회: 오른쪽(B쪽)으로 선회하면 C에 도착, 실격 없음', () => {
    const t = new Tutor(lesson('carry'), mk());
    // A(π) → B(π/2) → C(0): 각도가 줄어드는 쪽
    expect(drive(t, () => ({ lx: -1 }), 900)).toBe(true);
    expect(t.cleared).toBe(true);
    expect(t.s.engine.disqualifications()).toEqual([]);
  });
});
