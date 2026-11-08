import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { PRACTICE } from '../src/core/ruleEngine';
import { ik } from '../src/sim/kinematics';
import { DigSession, type RulesFile, type Sticks } from '../src/sim/session';

/** 퍼 담기 요령: 각도를 잡고 얕게 꽂아 당기며 오므려 쓸어 담는다. 잘못된 각도·과한 힘은 부하·들림으로 드러난다 */
const R = rules as unknown as RulesFile;
function sess(rpm = 0.8) {
  const s = new DigSession(MACHINE, R, PRACTICE, () => 0.5);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = rpm;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  return s;
}
function run(s: DigSession, phases: [number, Partial<Sticks>][]) {
  let maxLift = 0;
  for (const [n, inp] of phases)
    for (let i = 0; i < n; i++) {
      s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
      s.step();
      maxLift = Math.max(maxLift, s.lift);
    }
  const ids = new Set(s.engine.violations.map((v) => v.id));
  return { ids, liftDeg: (maxLift * 180) / Math.PI };
}
const SC = MACHINE.struckCapacity;

describe('퍼 담기 요령', () => {
  it('수직으로 꽂기만 하면 흙이 담기지 않음', () => {
    const s = sess();
    const A = s.site.stations[0];
    s.setPose(ik(MACHINE, (A.pitIn + A.pitOut) / 2 + 0.3, 0.2, -Math.PI / 2)!);
    run(s, [[150, { ry: 1 }]]);
    expect(s.load).toBeLessThan(0.05 * SC);
  });
  it('비스듬히 꽂으면 조금만 들어가고, 당기며 오므려야 가득 찬다 (경고 없음)', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[40, { ry: 1 }]]);
    expect(s.load).toBeLessThan(0.25 * SC);
    const r = run(s, [[130, { ly: -0.7, rx: -0.6 }]]);
    expect(s.load).toBeGreaterThan(SC);
    expect(r.ids.has('W-OVERLOAD')).toBe(false);
    expect(r.ids.has('W-LIFT')).toBe(false);
  });
  it('깊게 욕심내 물면 엔진 과부하', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    const r = run(s, [[90, { ry: 1 }], [150, { ly: -0.6, rx: -1 }]]);
    expect(r.ids.has('W-OVERLOAD')).toBe(true);
  });
  it('버킷 등으로 구덩이 벽을 밀면 과부하·차체 들림', () => {
    const s = sess();
    const A = s.site.stations[0];
    s.setPose(ik(MACHINE, A.pitIn + 0.6, -0.6, 0.3)!);
    const r = run(s, [[200, { ly: 1, ry: 0.4 }]]);
    expect(r.ids.has('W-OVERLOAD')).toBe(true);
    expect(r.liftDeg).toBeGreaterThan(2);
  });
  it('붐으로 단단한 땅을 누르면 차체가 들림 (W-LIFT)', () => {
    const s = sess();
    s.setPose(ik(MACHINE, 3.6, 0.3, -Math.PI / 2)!);
    const r = run(s, [[200, { ry: 1 }]]);
    expect(r.ids.has('W-LIFT')).toBe(true);
    expect(r.liftDeg).toBeGreaterThan(2);
  });
  it('rpm을 낮춘 채 파면 엔진이 꺼진다 (D-STALL, Q10)', () => {
    const s = sess(0.3);
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    const r = run(s, [[90, { ry: 1 }], [150, { ly: -0.6, rx: -1 }]]);
    expect(r.ids.has('D-STALL')).toBe(true);
  });
  it('흙이 조금 떨어져도 C 구덩이 벽은 무너지지 않음 (다져진 흙)', () => {
    const s = sess();
    const g = s.soil.grids[1];
    const C = s.site.stations[1];
    const mid = (C.pitIn + C.pitOut) / 2;
    g.depositSpread(g.cellAt(mid, 0), 0.01);
    for (let i = 0; i < 300; i++) s.step();
    expect(g.heightAt(C.pitOut + 0.1, 0)).toBeGreaterThan(-0.02);
    expect(g.heightAt(mid, C.pitHalfW + 0.1)).toBeGreaterThan(-0.02);
  });
});

describe('퍼 담기 요령 (아스트라 검토 반영)', () => {
  it('여러 버킷 각도로 수직 하강만 하면 담기지 않음', () => {
    for (const thK of [-Math.PI / 2, -Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4, -1.0]) {
      const s = sess();
      const A = s.site.stations[0];
      const q = ik(MACHINE, (A.pitIn + A.pitOut) / 2 + 0.3, 0.2, thK)!;
      s.setPose(q);
      // 붐 대신 자세를 직접 아래로만 이동 (순수 하강)
      for (let i = 1; i <= 60; i++) {
        const qq = ik(MACHINE, (A.pitIn + A.pitOut) / 2 + 0.3, 0.2 - i * 0.012, thK);
        if (qq) s.setPose(qq);
        s.step();
      }
      expect(s.load).toBeLessThan(0.02 * SC);
    }
  });
  it('오므리지 않고 암으로 끌기만 하면 덜 담기고, 오므리면 더 담김', () => {
    const drag = (curl: number) => {
      const s = sess();
      s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
      run(s, [[40, { ry: 1 }], [130, { ly: -0.7, rx: curl }]]);
      return s.load;
    };
    const noCurl = drag(0);
    const withCurl = drag(-0.6);
    expect(withCurl).toBeGreaterThan(noCurl * 1.4);
  });
  it('천천히 내려도 단단한 바닥을 뚫지 않음', () => {
    const s = sess();
    s.setPose(ik(MACHINE, 3.6, 0.3, -Math.PI / 2)!);
    run(s, [[1500, { ry: 0.25 }]]); // 아주 느린 붐 내림
    const floor = s.soil.floorAt(-s.frame.tip.r, 0);
    expect(s.frame.tip.y).toBeGreaterThan(floor - 0.012);
  });
  it('첫 삽 위치는 버킷 날이 처음 깎은 지점', () => {
    const s = sess();
    const got: number[] = [];
    s.onDigEntry((e) => got.push(e.dr));
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[40, { ry: 1 }]]);
    expect(got.length).toBe(1);
    expect(Math.abs(got[0])).toBeLessThan(0.2);
  });
});
