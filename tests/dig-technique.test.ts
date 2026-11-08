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
    run(s, [[26, { ry: 1 }]]); // 흙 표면에서 20~30cm만 물기
    expect(s.load).toBeLessThan(0.25 * SC);
    // 암을 당기며 오므리고, 붐을 살짝 올려 깊이를 유지 (바른 요령)
    const r = run(s, [[130, { ly: -0.7, rx: -0.6, ry: -0.1 }]]);
    expect(s.load).toBeGreaterThan(SC);
    expect(s.loadBack / s.load).toBeGreaterThan(0.5); // 안쪽까지 밀려 들어감
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

describe('버킷 속 흙 분포·이빨', () => {
  it('오므리지 않고 끌기만 하면 흙이 앞쪽에 몰리고, 들어 올리면 앞쪽 흙이 쏟아진다', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[26, { ry: 1 }], [130, { ly: -0.7, rx: 0, ry: -0.1 }]]);
    const before = s.load;
    expect(s.loadBack / Math.max(before, 1e-9)).toBeLessThan(0.5); // 앞쪽에만 수북
    run(s, [[90, { ry: -1 }]]); // 오므리지 않고 붐만 올림
    expect(s.load).toBeLessThan(before * 0.8);
  });
  it('오므려 안쪽까지 밀어 넣으면 들어 올려도 버틴다', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    // 당기며 오므린 뒤, 오므리면서 들어 올림 (흙 속에서는 오므림이 무거워 느림)
    run(s, [[26, { ry: 1 }], [130, { ly: -0.7, rx: -0.6, ry: -0.1 }], [120, { rx: -0.8, ry: -0.3 }]]);
    expect(s.pose.bucket).toBeLessThan(-1.3); // 오므리며 들어 올리면 75° 이상 오므려짐
    const before = s.load;
    expect(s.loadBack / before).toBeGreaterThan(0.6);
    run(s, [[90, { ry: -1 }]]);
    expect(s.load).toBeGreaterThan(before * 0.85); // 고봉 일부만 흘러내림 (앞쪽에만 담은 경우는 20% 넘게 쏟아짐)
  });
  it('버킷을 펴고 이빨로 밀면 이빨 자국(골)이 남는다', () => {
    const s = sess();
    const C = s.site.stations[1];
    s.setPose({ swing: 0 });
    // 구덩이 밖 굴착장 흙바닥(높이 0)을 버킷을 펴서 날 끝이 살짝 숙인 채 앞으로 밂
    const lat = 0;
    const path = (r: number) => ik(MACHINE, r, -0.03, -0.35);
    s.setPose(path(C.zoneIn - 0.9)!);
    for (let i = 0; i <= 60; i++) {
      const q = path(C.zoneIn - 0.9 + (0.7 * i) / 60);
      if (q) s.setPose(q);
      s.step();
    }
    const g = s.soil.grids[1];
    const r = C.zoneIn - 0.5;
    const W = MACHINE.bucketWidth;
    const teeth = [0, 1, 2, 3, 4].map((i) => g.heightAt(r, lat - W / 2 + 0.08 + ((W - 0.16) * i) / 4));
    const gaps = [0, 1, 2, 3].map((i) => g.heightAt(r, lat - W / 2 + 0.08 + ((W - 0.16) * (i + 0.5)) / 4));
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(gaps) - avg(teeth)).toBeGreaterThan(0.01);
  });
});

describe('자연스러운 퍼 올리기', () => {
  it('퍼면서 최대한 오므리며 흙에서 꺼내도 덜컹 경고가 없다 (실린더 쿠션)', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    // 꽂고 → 잠깐 멈춤 → 당기며 오므림 → 최대한 오므리며 들어 올림 (자연스러운 손동작)
    run(s, [[26, { ry: 1 }], [12, {}], [130, { ly: -0.7, rx: -0.6, ry: -0.1 }], [150, { rx: -1, ry: -0.6 }], [60, { ry: -0.6 }]]);
    expect(s.pose.bucket).toBeLessThan(MACHINE.limits.bucket[0] + 0.14); // 끝까지 오므려짐 (쿠션 구간에서는 천천히)
    expect(s.engine.violations.filter((v) => v.id === 'W-JOLT')).toEqual([]);
  });
});

describe('끝까지 오므리기 (시험 기본 동작)', () => {
  it('흙 밖에서 버킷을 끝까지 오므리는 데 오래 걸리지 않는다 (쿠션 구간 짧음)', () => {
    const s = sess();
    s.setPose({ boom: 0.8, arm: -1.5, bucket: 0.5 });
    let t = 0;
    while (s.pose.bucket > MACHINE.limits.bucket[0] + 0.02 && t < 600) {
      s.input = { lx: 0, ly: 0, rx: -1, ry: 0 };
      s.step();
      t++;
    }
    // 205° 회전: 최대 속도(약 48°/s)로 약 4.3초 + 가속·쿠션 여유
    expect(t / 60).toBeLessThan(5.2);
    expect(s.engine.violations.filter((v) => v.id === 'W-JOLT')).toEqual([]);
  });
  it('끝까지 오므린 채 선회하면 흙을 거의 흘리지 않는다', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[26, { ry: 1 }], [12, {}], [130, { ly: -0.7, rx: -0.6, ry: -0.1 }], [150, { rx: -1, ry: -0.6 }], [80, { ry: -0.6 }]]);
    const before = s.load;
    run(s, [[200, { lx: -0.5 }]]); // A → B 쪽으로 선회
    expect(s.carrySpill).toBeLessThan(before * 0.05);
  });
});
