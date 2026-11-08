import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { PRACTICE, EXAM, RuleEngine } from '../src/core/ruleEngine';
import { betaOf, fk, groundReach, ik } from '../src/sim/kinematics';
import { passHits } from '../src/sim/judge';
import { DigSession, type RulesFile } from '../src/sim/session';
import { buildSite } from '../src/sim/site';
import { makeStationGrid } from '../src/sim/soil';
import { segSegDist2, v3 } from '../src/sim/vec';

const R = rules as unknown as RulesFile;

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe('기하', () => {
  it('선분 거리', () => {
    expect(segSegDist2(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0), v3(1, 1, 0))).toBeCloseTo(1);
    expect(segSegDist2(v3(0, 0, 0), v3(1, 0, 0), v3(0.5, -1, 1), v3(0.5, 1, 1))).toBeCloseTo(1);
  });
  it('최대 도달거리는 14t급 실측(약 7.8m) 근처', () => {
    const reach = groundReach(MACHINE);
    expect(reach).toBeGreaterThan(7.5);
    expect(reach).toBeLessThan(8.2);
  });
});

describe('시험장 생성 (공개문제 치수)', () => {
  const site = buildSite(MACHINE);
  const [A] = site.stations;
  const W = MACHINE.bucketWidth;
  const Lb = MACHINE.bucketLength;
  it('ⓑ선은 ⓐ에서 안쪽 30cm, 구덩이는 ⓑ에서 30cm 안쪽', () => {
    expect(A.bLine).toBeCloseTo(site.reach - 0.3);
    expect(A.pitOut).toBeCloseTo(A.bLine - 0.3);
  });
  it('구덩이 크기: 버킷 가로 폭 × 세로 폭 2.5배', () => {
    expect(A.pitHalfW * 2).toBeCloseTo(W);
    expect(A.pitOut - A.pitIn).toBeCloseTo(2.5 * Lb);
  });
  it('ⓒ선: 구덩이 좌우 50cm, 길이 = 세로 폭 2.5배 + 80cm', () => {
    expect(A.zoneHalfW).toBeCloseTo(W / 2 + 0.5);
    expect(A.zoneOut - A.zoneIn).toBeCloseTo(2.5 * Lb + 0.8);
  });
  it('ⓓ선은 ⓒ선에서 20cm, 높이는 폴 상단 50cm 아래', () => {
    expect(A.overswingLat).toBeCloseTo(-(A.zoneHalfW + 0.2));
    const d = site.ropes.find((r) => r.name === 'A-ⓓ오버스윙제한선')!;
    expect(d.a.y).toBeCloseTo(site.beta - 0.5);
  });
  it('B지점: ⓔ = β지점+50cm, ⓕ = 도달거리-1m, 장애물선 = β-1m', () => {
    const { beta, betaR } = betaOf(MACHINE);
    expect(site.B.rE).toBeCloseTo(betaR + 0.5);
    expect(site.B.rF).toBeCloseTo(site.reach - 1);
    expect(site.B.ropeY).toBeCloseTo(beta - 1);
    expect(site.B.rF).toBeGreaterThan(site.B.rE);
  });
});

describe('흙 격자', () => {
  const site = buildSite(MACHINE);
  const init = { cell: 0.1, digSurface: -0.5, digFloor: -1.6, dumpFloor: -0.5, groundFloor: -1.2 };
  it('A 구덩이는 기준면 -0.5, C 구덩이 바닥 -0.5', () => {
    const gA = makeStationGrid(site.stations[0], init);
    const gC = makeStationGrid(site.stations[1], init);
    const mid = -(site.stations[0].pitIn + site.stations[0].pitOut) / 2;
    expect(gA.heightAt(mid, 0)).toBeCloseTo(-0.5);
    expect(gC.heightAt(-mid, 0)).toBeCloseTo(-0.5);
    expect(gA.floor[gA.cellAt(mid, 0)]).toBeCloseTo(-1.6);
  });
  it('완화는 부피를 보존', () => {
    const g = makeStationGrid(site.stations[1], init);
    const mid = (site.stations[1].pitIn + site.stations[1].pitOut) / 2;
    g.deposit(g.cellAt(mid, 0), 0.2);
    const before = g.volumeDelta();
    for (let i = 0; i < 200; i++) g.relax(Math.tan((35 * Math.PI) / 180) * 0.1, 2);
    expect(g.volumeDelta()).toBeCloseTo(before, 6);
    // 쌓인 흙이 퍼져서 봉우리가 낮아짐
    expect(g.heightAt(mid, 0)).toBeLessThan(-0.5 + 0.2 / 0.01);
  });
});

describe('규칙 엔진', () => {
  it('연습모드는 실격이어도 종료하지 않음, 시험모드는 종료', () => {
    const p = new RuleEngine(R.rules, PRACTICE).report('D-POLE', 1, 'x');
    const e = new RuleEngine(R.rules, EXAM).report('D-POLE', 1, 'x');
    expect(p.recorded && !p.endsTask).toBe(true);
    expect(e.endsTask).toBe(true);
  });
  it('같은 사유는 1.5초 안에 다시 기록하지 않음', () => {
    const r = new RuleEngine(R.rules, PRACTICE);
    expect(r.report('D-POLE', 1, 'x').recorded).toBe(true);
    expect(r.report('D-POLE', 2, 'x').recorded).toBe(false);
    expect(r.report('D-POLE', 2, 'y').recorded).toBe(true);
    expect(r.report('D-POLE', 4, 'x').recorded).toBe(true);
  });
  it('경고는 시험모드에서도 종료하지 않음', () => {
    expect(new RuleEngine(R.rules, EXAM).report('W-DANGER', 1, 'x').endsTask).toBe(false);
  });
});

function startedSession(seed = 7) {
  const s = new DigSession(MACHINE, R, PRACTICE, seeded(seed));
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 0.8;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  expect(s.phase).toBe('working');
  return s;
}

describe('굴착 세션', () => {
  it('무작위 조작 3000스텝 동안 흙 장부가 맞음', () => {
    const s = startedSession();
    const rnd = seeded(3);
    for (let i = 0; i < 3000; i++) {
      if (i % 30 === 0) s.input = { lx: rnd() * 2 - 1, ly: rnd() * 2 - 1, rx: rnd() * 2 - 1, ry: rnd() * 2 - 1 };
      s.step();
      // float32 격자 누적 오차만 허용
      expect(Math.abs(s.ledgerError())).toBeLessThan(1e-5);
    }
  });
  it('관절은 한계를 넘지 않음', () => {
    const s = startedSession();
    s.input = { lx: 0, ly: 1, rx: 1, ry: -1 };
    for (let i = 0; i < 600; i++) s.step();
    const L = MACHINE.limits;
    expect(s.pose.arm).toBeLessThanOrEqual(L.arm[1] + 1e-9);
    expect(s.pose.bucket).toBeLessThanOrEqual(L.bucket[1] + 1e-9);
    expect(s.pose.boom).toBeLessThanOrEqual(L.boom[1] + 1e-9);
  });
  it('안전레버가 잠겨 있으면 움직이지 않음', () => {
    const s = startedSession();
    s.leverUnlocked = false;
    const before = { ...s.pose };
    s.input = { lx: 1, ly: 1, rx: 1, ry: 1 };
    for (let i = 0; i < 60; i++) s.step();
    expect(s.pose).toEqual(before);
  });
  it('B 반대쪽(뒤쪽)으로 선회하면 D-PASS', () => {
    const s = startedSession();
    s.input = { lx: 1, ly: 0, rx: 0, ry: 0 }; // 오른쪽 선회: A(π) → 뒤쪽(3π/2) → C
    for (let i = 0; i < 400 && s.pose.swing < 2 * Math.PI + 0.2; i++) s.step();
    expect(s.engine.violations.some((v) => v.id === 'D-PASS' && v.detail.includes('반대쪽'))).toBe(true);
  });
  it('버킷을 낮게 들고 B로 선회하면 D-PASS(장애물선 아래) 또는 줄 접촉', () => {
    const s = startedSession();
    // 버킷 끝 높이 약 0.65m (장애물선 β-1 ≈ 2.6m보다 낮음)
    s.setPose({ boom: 0.35, arm: -1.3, bucket: -1.2 });
    s.input = { lx: -1, ly: 0, rx: 0, ry: 0 };
    for (let i = 0; i < 400 && s.pose.swing > Math.PI / 2 - 0.3; i++) s.step();
    expect(s.pose.swing).toBeLessThan(Math.PI / 2);
    const ids = s.engine.violations.map((v) => v.id);
    expect(ids.includes('D-PASS') || ids.includes('D-POLE')).toBe(true);
  });
  it('버킷을 통과구역 높이로 들고 B를 지나면 D-PASS 없음', () => {
    const s = startedSession();
    // 붐 최대로 들고 버킷 오므림: 버킷이 장애물선(≈2.6m) 위, 반경 ⓔ~ⓕ 사이
    s.setPose({ boom: 1.0, arm: -1.9, bucket: -1.4 });
    s.input = { lx: -1, ly: 0, rx: 0, ry: 0 };
    for (let i = 0; i < 400 && s.pose.swing > Math.PI / 2 - 0.3; i++) s.step();
    expect(s.engine.violations.filter((v) => v.id === 'D-PASS' || v.id === 'D-POLE')).toEqual([]);
  });
  it('굴착 없이 버킷을 내려놓아 종료하면 D-COUNT와 D-NOFLAT', () => {
    const s = startedSession();
    const A = s.site.stations[0];
    const q = ik(MACHINE, (A.pitIn + A.pitOut) / 2 + 0.3, 0.3, 0)!;
    s.setPose({ ...q, bucket: MACHINE.limits.bucket[1] });
    // 지면에 닿을 때까지 붐을 내리고, 닿으면 멈춰 기다림
    for (let i = 0; i < 800 && s.phase === 'working'; i++) {
      if (s.groundGap() > 0.02) s.setPose({ boom: s.pose.boom - 0.001 });
      s.step();
    }
    for (let i = 0; i < 90; i++) s.step();
    expect(s.phase).toBe('finished');
    const ids = s.engine.violations.map((v) => v.id);
    expect(ids).toContain('D-COUNT');
    expect(ids).toContain('D-NOFLAT');
  });
  it('그만하기는 기권 처리: 종료 판정(D-COUNT 등)을 하지 않음', () => {
    const s = startedSession();
    s.abandon();
    expect(s.phase).toBe('finished');
    expect(s.abandoned).toBe(true);
    expect(s.engine.violations.filter((v) => v.id === 'D-COUNT')).toEqual([]);
  });
  it('버킷이 흙에 묻힌 상태에서는 종료되지 않음', () => {
    const s = startedSession();
    const A = s.site.stations[0];
    const q = ik(MACHINE, (A.pitIn + A.pitOut) / 2, -0.9, 0)!; // 흙 표면(-0.5)보다 40cm 아래
    s.setPose({ ...q, bucket: MACHINE.limits.bucket[1] });
    for (let i = 0; i < 120; i++) s.step();
    expect(s.phase).toBe('working');
  });
  it('B 통과: 가상통과제한선에 딱 닿아도 D-PASS', () => {
    const site = buildSite(MACHINE);
    const y = site.B.ropeY + 0.5;
    const hits = passHits(site, [v3(-0.1, y, site.B.rE)], [v3(0.1, y, site.B.rE)]);
    expect(hits.map((h) => h.id)).toContain('D-PASS');
    const ok = passHits(site, [v3(-0.1, y, (site.B.rE + site.B.rF) / 2)], [v3(0.1, y, (site.B.rE + site.B.rF) / 2)]);
    expect(ok).toEqual([]);
  });
  it('유압: 빠르게 움직이다 레버를 즉시 놓으면 덜컹(W-JOLT), 서서히 놓으면 없음', () => {
    const run = (release: (t: number) => number) => {
      const s = startedSession();
      s.setPose({ boom: 0.9, arm: -1.6, bucket: -1.0 });
      for (let i = 0; i < 180; i++) {
        const t = i / 60;
        s.input = { lx: t < 1.5 ? -1 : -release(t - 1.5), ly: 0, rx: 0, ry: 0 };
        s.step();
      }
      return s;
    };
    const abrupt = run(() => 0);
    const gentle = run((t) => Math.max(0, 1 - t / 0.6));
    expect(abrupt.jolts).toBeGreaterThan(0);
    expect(Math.abs(abrupt.rock.roll) + Math.abs(abrupt.rock.rollV)).toBeGreaterThan(0);
    expect(gentle.jolts).toBe(0);
  });
  it('유압: 레버를 밀면 바로 최고속이 아니라 서서히 붙음', () => {
    const s = startedSession();
    s.input = { lx: -1, ly: 0, rx: 0, ry: 0 };
    s.step();
    expect(Math.abs(s.vel.swing)).toBeLessThan(MACHINE.speeds.swing * 0.15);
    for (let i = 0; i < 60; i++) s.step();
    expect(Math.abs(s.vel.swing)).toBeGreaterThan(MACHINE.speeds.swing * 0.7);
  });
  it('고봉으로 실은 흙은 큰 충격에 쏟아지고, 장부는 맞음', () => {
    const s = startedSession();
    s.setPose({ boom: 0.9, arm: -1.9, bucket: -1.4 });
    s.load = s.heapedCap;
    s.spilled -= s.heapedCap; // 장부 맞추기: 시험용으로 흙을 외부에서 넣음
    const before = s.load;
    for (let i = 0; i < 180; i++) {
      s.input = { lx: i < 90 ? -1 : 1, ly: 0, rx: 0, ry: 0 }; // 선회 중 반대로 꺾기
      s.step();
    }
    expect(s.load).toBeLessThan(before);
    expect(Math.abs(s.ledgerError())).toBeLessThan(1e-5);
  });
  it('선회가 3° 비뚤어도 레버로 A 구덩이에 버킷이 박힘 (구덩이 둘레도 흙)', () => {
    const s = startedSession();
    const A = s.site.stations[0];
    const q = ik(MACHINE, (A.pitIn + A.pitOut) / 2, 0.2, -Math.PI / 2)!;
    s.setPose({ ...q, swing: Math.PI + (3 * Math.PI) / 180 });
    for (let i = 0; i < 240; i++) {
      s.input = { lx: 0, ly: 0, rx: 0, ry: 1 };
      s.step();
    }
    expect(s.frame.tip.y).toBeLessThan(-0.8);
  });
  it('굴착 위치 교육: 첫 삽 위치를 목표(ⓑ선 안쪽 30cm) 대비 앞뒤·좌우로 알려줌', () => {
    const s = startedSession();
    const got: { dr: number; dl: number; grade: string }[] = [];
    s.onDigEntry((e) => got.push(e));
    const T = s.digTarget.rho;
    // 목표보다 15cm 바깥, 정중앙에서 버킷을 수직으로 내려 찍음
    const q = ik(MACHINE, T + 0.15, 0.1, -1.2)!;
    s.setPose(q);
    s.step();
    for (let i = 1; i <= 40; i++) {
      s.setPose(ik(MACHINE, T + 0.15, 0.1 - i * 0.02, -1.2)!);
      s.step();
    }
    expect(got.length).toBe(1);
    expect(got[0].dr).toBeGreaterThan(0.1);
    expect(got[0].dr).toBeLessThan(0.2);
    expect(Math.abs(got[0].dl)).toBeLessThan(0.02);
    expect(got[0].grade).toBe('ok');
  });
  it('선 근접 경고: 작업 높이에서 ⓑ선 15cm 안쪽이면 W-NEAR (실격 아님)', () => {
    const s = startedSession();
    const A = s.site.stations[0];
    // 버킷 끝(가장 바깥 꼭짓점)이 ⓑ선 8cm 안쪽, 높이 0.3m
    const q = ik(MACHINE, A.zoneOut - 0.08, 0.3, -0.6);
    expect(q).not.toBeNull();
    s.setPose(q!);
    s.step();
    s.step();
    const ids = s.engine.violations.map((v) => v.id);
    expect(ids).toContain('W-NEAR');
    expect(ids).not.toContain('D-DIGLINE');
  });
  it('fk: 시작 자세에서 버킷이 흙을 담는 방향', () => {
    const s = startedSession();
    expect(fk(MACHINE, s.pose).nOpen.y).toBeGreaterThan(0);
  });
});
