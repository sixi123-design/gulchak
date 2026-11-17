import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { PRACTICE } from '../src/core/ruleEngine';
import { bucketOutline, fk, groundReach, ik, toWorld } from '../src/sim/kinematics';
import { DigSession, type RulesFile, type Sticks } from '../src/sim/session';
/** 꽂는 깊이를 붐 속도와 무관하게: 예전 붐 내림 속도(28°/s)와 같은 속도가 되는 레버 크기 */
/** 파는 중 '붐 살짝 올림': 예전 붐 올림 속도(28°/s)에서 0.1 레버와 같은 속도 */
const UP = (0.1 * 28 * Math.PI) / 180 / MACHINE.speeds.boom;
const DN = (28 * Math.PI) / 180 / (MACHINE.speeds.boom * MACHINE.boomDownGain);

/**
 * 흙은 일정 부피 이상 압축되지 않는다 (아스트라 감독 기준).
 * 흙이 빠질 곳 없이 버킷 면으로 누르는 동작(붐으로 누르기, 바닥을 댄 채 암 당기기, 깊이 묻고 오므리기)은
 * 막히고(흙 없을 때 대비 이동 ≤10%) 과부하가 나며, 아래로 누르면 차체가 들린다.
 */
const R = rules as unknown as RulesFile;
const SC = MACHINE.struckCapacity;
function sess(noSoil = false) {
  const s = new DigSession(MACHINE, R, PRACTICE, () => 0.5);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 0.8;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  if (noSoil)
    // 비교용: 같은 자리에 흙이 없는 세계 (지형을 모두 깊이 내림)
    for (const g of s.soil.grids) for (const a of [g.h, g.h0, g.firm, g.floor]) a.fill(-8);
  return s;
}
type Rec = { maxLoad: number; lift: number; ids: Set<string>; maxPress: number };
/** 스텝마다: 그 스텝 미배정 흙 - 1% × 그 스텝 밀어낸 흙 의 최댓값 (0 이하여야 함) */
let stepViol = -Infinity;
function run(s: DigSession, n: number, inp: Partial<Sticks>, rec?: Rec) {
  for (let i = 0; i < n; i++) {
    s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    const u0 = s.unassignedTotal;
    const d0 = s.dispTotal;
    s.step();
    stepViol = Math.max(stepViol, s.unassignedTotal - u0 - 0.01 * (s.dispTotal - d0));
    if (rec) {
      rec.maxLoad = Math.max(rec.maxLoad, s.engineLoad);
      rec.lift = Math.max(rec.lift, s.lift);
      rec.maxPress = Math.max(rec.maxPress, s.pressRatio);
    }
  }
  if (rec) for (const v of s.engine.violations) rec.ids.add(v.id);
}
const newRec = (): Rec => ({ maxLoad: 0, lift: 0, ids: new Set(), maxPress: 0 });
/** 버킷 윤곽이 주변 지표(버킷 옆 바깥 30cm)보다 가장 깊이 들어간 깊이 (+ = 묻힘). top: 가장 얕은 점의 깊이 */
function sinkOf(s: DigSession) {
  let d = -9;
  let top = 9;
  const off = MACHINE.bucketWidth / 2 + 0.3;
  for (const q of bucketOutline(MACHINE, s.frame)) {
    const w = toWorld(s.pose.swing, q);
    const a = toWorld(s.pose.swing, q, off);
    const b = toWorld(s.pose.swing, q, -off);
    const amb = Math.max(s.soil.surfaceAt(a.x, a.z), s.soil.surfaceAt(b.x, b.z));
    d = Math.max(d, amb - w.y);
    top = Math.min(top, amb - w.y);
  }
  return { d, top };
}
const sink = (s: DigSession) => sinkOf(s).d;
/** 바닥(힐→날)이 수평이고 입구가 위를 향한 버킷 절대각 */
const hx = Math.cos(MACHINE.heelAngle) * MACHINE.heelLen;
const hy = Math.sin(MACHINE.heelAngle) * MACHINE.heelLen;
const FLAT = Math.PI + Math.atan2(hy, MACHINE.L3 - hx) - 2 * Math.PI;
/** 바닥이 지표에 닿도록 날 높이를 찾음 */
function flatPose(s: DigSession, rho: number) {
  for (let y = 0; y > -1.5; y -= 0.005) {
    const p = ik(MACHINE, rho, y, FLAT);
    if (!p) continue;
    s.setPose(p);
    // 윤곽 점 바로 아래 지표와 비교 (setPose는 흙을 깎지 않음)
    let d = -9;
    for (const q of bucketOutline(MACHINE, s.frame)) {
      const w = toWorld(s.pose.swing, q);
      d = Math.max(d, s.soil.surfaceAt(w.x, w.z) - w.y);
    }
    if (d > 0.005) return y;
  }
  throw new Error('no contact');
}
const deg = (r: number) => (r * 180) / Math.PI;
/** 흙 장부: 버킷이 밀어낸 흙 중 갈 곳 없이 옮겨진 흙 ≤ 1% */
function expectAssigned(s: DigSession, tag: string) {
  console.log(tag, 'disp', s.dispTotal.toFixed(4), 'unassigned', s.unassignedTotal.toFixed(5));
  expect(s.unassignedTotal).toBeLessThanOrEqual(0.01 * s.dispTotal + 1e-6);
}

describe('흙은 압축되지 않는다', () => {
  beforeEach(() => {
    stepViol = -Infinity;
  });
  afterEach(() => {
    // 모든 시나리오의 매 스텝: 버킷이 민 흙 중 갈 곳 없이 옮겨진 흙 ≤ 1% (+수치 오차 1e-7)
    expect(stepViol).toBeLessThanOrEqual(1e-7);
  });
  it('바닥을 댄 버킷을 붐으로 누르면 막히고 과부하·차체 들림', () => {
    const s = sess();
    const rho = 5.6; // 구덩이 A 안 (평평한 흙)
    flatPose(s, rho);
    const free = sess(true);
    free.setPose({ ...s.pose, swing: s.pose.swing });
    const b0 = s.pose.boom;
    const rec = newRec();
    run(s, 200, { ry: 1 }, rec);
    const fb0 = free.pose.boom;
    run(free, 200, { ry: 1 });
    const ratio = Math.abs(s.pose.boom - b0) / Math.abs(free.pose.boom - fb0);
    console.log('press boom', { b0, b1: s.pose.boom, fb0, fb1: free.pose.boom, ratio, load: rec.maxLoad, lift: deg(rec.lift), ids: [...rec.ids], sink: sink(s), blocks: s.pressBlocks });
    expect(Math.abs(free.pose.boom - fb0)).toBeGreaterThan(0.2); // 비교군은 관절 한계에 걸리지 않고 움직임
    expect(ratio).toBeLessThanOrEqual(0.1);
    expect(rec.maxLoad).toBeGreaterThan(1);
    expect(rec.ids.has('W-OVERLOAD')).toBe(true);
    expect(rec.ids.has('W-LIFT')).toBe(true);
    expect(deg(rec.lift)).toBeGreaterThan(2);
    expect(Math.abs(s.ledgerError())).toBeLessThan(1e-5);
    expectAssigned(s, 'press boom');
  });

  it('버킷을 편 채 등(둥근 뒷판)으로 비스듬히 누르면 날이 길을 내지 않으므로 파고들지 않고 과부하·들림', () => {
    for (const thK of [0.6, 0.9]) {
      const s = sess();
      // 등이 지표에 닿을 때까지 내림 (setPose는 흙을 깎지 않음)
      for (let y = 0; y > -1.5; y -= 0.005) {
        const p = ik(MACHINE, 5.6, y, thK);
        if (!p) continue;
        s.setPose(p);
        let d = -9;
        for (const q of bucketOutline(MACHINE, s.frame)) {
          const w = toWorld(s.pose.swing, q);
          d = Math.max(d, s.soil.surfaceAt(w.x, w.z) - w.y);
        }
        if (d > 0.005) break;
      }
      const low0 = Math.min(...bucketOutline(MACHINE, s.frame).map((q) => q.y));
      const rec = newRec();
      run(s, 200, { ry: 1 }, rec);
      const low1 = Math.min(...bucketOutline(MACHINE, s.frame).map((q) => q.y));
      console.log('back press', thK, { sink: low0 - low1, load: rec.maxLoad, lift: deg(rec.lift) });
      expect(low0 - low1).toBeLessThan(0.03); // 측정(수정 전): thK 0.6에서 0.44m 파고듦
      expect(rec.ids.has('W-OVERLOAD')).toBe(true);
      expect(deg(rec.lift)).toBeGreaterThan(2);
    }
  });

  it('바닥을 흙에 댄 채 암을 당겨 누르면 막히고 과부하·차체 들림', () => {
    const s = sess();
    // 암 당김이 버킷을 아래로 끌어내리는 먼 자리 (ⓐ 도달거리의 75%)
    const rho = 0.75 * groundReach(MACHINE);
    flatPose(s, rho);
    const f0 = fk(MACHINE, s.pose);
    const f1 = fk(MACHINE, { ...s.pose, arm: s.pose.arm - 0.02 });
    expect(f1.tip.y).toBeLessThan(f0.tip.y); // 이 자세에서 암 당김은 버킷을 아래로 누름
    const free = sess(true);
    free.setPose({ ...s.pose });
    const a0 = s.pose.arm;
    const rec = newRec();
    run(s, 200, { ly: -0.8 }, rec);
    const fa0 = free.pose.arm;
    run(free, 200, { ly: -0.8 });
    const ratio = Math.abs(s.pose.arm - a0) / Math.abs(free.pose.arm - fa0);
    console.log('press arm', { ratio, load: rec.maxLoad, lift: deg(rec.lift), ids: [...rec.ids], sink: sink(s), blocks: s.pressBlocks });
    expect(Math.abs(free.pose.arm - fa0)).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThanOrEqual(0.1);
    expect(rec.maxLoad).toBeGreaterThan(1);
    expect(rec.ids.has('W-OVERLOAD')).toBe(true);
    expect(deg(rec.lift)).toBeGreaterThan(2);
    expect(Math.abs(s.ledgerError())).toBeLessThan(1e-5);
    expectAssigned(s, 'press arm');
  });

  it('버킷을 깊이 묻은 뒤 오므리면 막히고 과부하 (흙이 갈 곳이 없음)', () => {
    const s = sess();
    const A = s.site.stations[0];
    s.setPose(ik(MACHINE, (A.pitIn + A.pitOut) / 2 + 0.6, 0, -0.9)!);
    // 굴착 각도로 붐을 계속 내려 버킷이 통째로 묻힐 때까지(또는 더 못 들어갈 때까지) 박기
    const pb0 = s.pressBlocks;
    for (let i = 0; i < 400 && sinkOf(s).top <= 0.05; i++) run(s, 1, { ry: 1 });
    const plungeBlocks = s.pressBlocks - pb0;
    const { d: buried, top } = sinkOf(s);
    const free = sess(true);
    free.setPose({ ...s.pose });
    const k0 = s.pose.bucket;
    const disp0 = s.dispTotal;
    const un0 = s.unassignedTotal;
    const rec = newRec();
    run(s, 180, { rx: -1 }, rec);
    const fk0 = free.pose.bucket;
    run(free, 180, { rx: -1 });
    const dK = Math.abs(s.pose.bucket - k0);
    const ratio = dK / Math.abs(free.pose.bucket - fk0);
    console.log('deep curl', { buried, top, plungeBlocks, dK, ratio, load: rec.maxLoad, ids: [...rec.ids], fill: s.load / SC, blocks: s.pressBlocks });
    // 더 못 들어갈 만큼 박힘: 붐이 흙에 막혔고(흙이 갈 곳이 없어 더 박히지도 않음) 날이 1m 넘게 묻힘
    expect(plungeBlocks).toBeGreaterThan(0);
    expect(buried).toBeGreaterThan(1.0);
    expect(Math.abs(free.pose.bucket - fk0)).toBeGreaterThan(1);
    expect(ratio).toBeLessThanOrEqual(0.1);
    expect(dK).toBeLessThanOrEqual(0.15);
    expect(rec.maxLoad).toBeGreaterThan(1);
    expect(rec.ids.has('W-OVERLOAD')).toBe(true);
    expect(Math.abs(s.ledgerError())).toBeLessThan(1e-5);
    expectAssigned(s, 'deep curl (묻기+오므림)');
    // 오므림 구간만 따로
    expect(s.unassignedTotal - un0).toBeLessThanOrEqual(0.01 * (s.dispTotal - disp0) + 1e-6);
  });

  /** 굴착 각도로 붐이 막힐 때까지 깊이 박은 세션 */
  function buried() {
    const s = sess();
    const A = s.site.stations[0];
    s.setPose(ik(MACHINE, (A.pitIn + A.pitOut) / 2 + 0.6, 0, -0.9)!);
    const pb0 = s.pressBlocks;
    for (let i = 0; i < 400 && sinkOf(s).top <= 0.05; i++) run(s, 1, { ry: 1 });
    expect(s.pressBlocks - pb0).toBeGreaterThan(0);
    // 박기로는 버킷이 통째로 덮이지 않음(덮이면 밀린 흙이 갈 곳이 없어 막힘). 통째로 덮인 경우를 만들려고
    // 주변을 다져진 흙 1m로 덮음 (처음부터 있던 원지반으로 보고 장부 기준(h0)도 같이 올림. 다져진 벽이라 흘러내리지 않음)
    // 버킷이 차지한 자리(윤곽의 반경 범위 × 폭)는 덮지 않음 (흙이 버킷과 겹치지 않게)
    const tip = toWorld(s.pose.swing, s.frame.tip);
    const ol = bucketOutline(MACHINE, s.frame);
    const rMin = Math.min(...ol.map((q) => q.r)) - 0.1;
    const rMax = Math.max(...ol.map((q) => q.r)) + 0.1;
    const c = Math.cos(s.pose.swing);
    const sn = Math.sin(s.pose.swing);
    for (const g of s.soil.grids)
      for (let j = 0; j < g.nz; j++)
        for (let i = 0; i < g.nx; i++) {
          const x = g.xOf(i);
          const z = g.zOf(j);
          if (Math.hypot(x - tip.x, z - tip.z) > 2.5) continue;
          const r = x * c + z * sn;
          const lat = -x * sn + z * c;
          if (r > rMin && r < rMax && Math.abs(lat) < MACHINE.bucketWidth / 2 + 0.1) continue;
          const k = g.idx(i, j);
          g.h[k] += 1.0;
          g.h0[k] += 1.0;
          g.firm[k] += 1.0;
        }
    console.log('buried hd', s.bucketCover);
    expect(s.bucketCover).toBeGreaterThan(R.params.heaveDepth + 0.1);
    return s;
  }
  it('깊이 묻힌 채 버킷 등으로 암을 밀면(입구로 못 받음) 깊은 동안은 움직이기 전에 막히고, 흙이 갈 곳 없이 옮겨지지 않음', () => {
    const s = buried();
    const hd = R.params.heaveDepth;
    const disp0 = s.dispTotal;
    const un0 = s.unassignedTotal;
    const free = sess(true);
    free.setPose({ ...s.pose });
    run(free, 1, { ly: 0.8 });
    // 깊은 자리(지표로 못 솟는 깊이)에서 시작한 스텝의 암 이동 합 vs 흙 없을 때 같은 스텝 수의 이동
    let deepMove = 0;
    let deepSteps = 0;
    const rec = newRec();
    for (let i = 0; i < 120; i++) {
      const deep = s.bucketCover > hd + 0.02;
      const a = s.pose.arm;
      run(s, 1, { ly: 0.8 }, rec);
      if (deep) {
        deepMove += Math.abs(s.pose.arm - a);
        deepSteps++;
      }
    }
    const fa0 = free.pose.arm;
    run(free, 119, { ly: 0.8 });
    const freePerStep = Math.abs(free.pose.arm - fa0) / 119;
    console.log('deep push', { deepSteps, deepMove, freePerStep, load: rec.maxLoad, du: s.unassignedTotal - un0, dd: s.dispTotal - disp0, hd: s.bucketCover });
    expect(deepSteps).toBeGreaterThan(60); // 대부분 깊은 채로 밀어 봄
    expect(deepMove).toBeLessThanOrEqual(0.1 * freePerStep * deepSteps);
    expect(rec.maxLoad).toBeGreaterThan(1);
    expect(s.unassignedTotal - un0).toBeLessThanOrEqual(0.01 * (s.dispTotal - disp0) + 1e-6);
  });
  it('깊이 묻힌 채 선회하면(옆판이 흙을 밂, 입구로 못 받음) 깊은 동안은 움직이기 전에 막힘', () => {
    const s = buried();
    const hd = R.params.heaveDepth;
    const free = sess(true);
    free.setPose({ ...s.pose });
    let deepMove = 0;
    let deepSteps = 0;
    const rec = newRec();
    for (let i = 0; i < 120; i++) {
      const deep = s.bucketCover > hd + 0.02;
      const a = s.pose.swing;
      run(s, 1, { lx: 0.6 }, rec);
      if (deep) {
        deepMove += Math.abs(s.pose.swing - a);
        deepSteps++;
      }
    }
    const f0 = free.pose.swing;
    run(free, 120, { lx: 0.6 });
    const freePerStep = Math.abs(free.pose.swing - f0) / 120;
    console.log('deep swing', { deepSteps, deepMove, freePerStep, load: rec.maxLoad, blocks: s.pressBlocks });
    expect(deepSteps).toBeGreaterThan(60);
    expect(deepMove).toBeLessThanOrEqual(0.1 * freePerStep * deepSteps);
    expect(rec.maxLoad).toBeGreaterThan(1);
    expectAssigned(s, 'deep swing');
  });
  it('깊이 묻힌 채 멈추면 날 앞 흙을 깊은 자리에 내려놓지 않고, 들어 올려 얕아진 뒤 내려놓음', () => {
    const s = buried();
    const sur0 = s.surcharge;
    const un0 = s.unassignedTotal;
    run(s, 120, {});
    console.log('deep idle', { sur0, sur: s.surcharge, du: s.unassignedTotal - un0 });
    // 깊은 자리에서는 내려놓지 않고 들고 있음 (흘러든 흙이 상한을 넘친 몫만 넘침으로 빠짐)
    const cap = (MACHINE.bucketWidth * R.params.surchargeHeight ** 2) / (2 * Math.tan((R.params.reposeDeg * Math.PI) / 180));
    expect(sur0).toBeGreaterThan(0.5 * cap);
    expect(s.surcharge).toBeGreaterThan(Math.min(sur0, cap) - 1e-3);
    expect(s.unassignedTotal - un0).toBeLessThanOrEqual(1e-6);
    run(s, 300, { ry: -1 }); // 붐 올려 빼기
    run(s, 60, {});
    console.log('deep lift', { sur: s.surcharge, du: s.unassignedTotal - un0, disp: s.dispTotal });
    expect(s.surcharge).toBe(0); // 얕아지거나 흙에서 빠지면 내려놓음
    expect(s.unassignedTotal).toBeLessThanOrEqual(0.01 * s.dispTotal + 1e-6);
    expect(Math.abs(s.ledgerError())).toBeLessThan(1e-5);
  });
  it('정상 굴착(얕게 꽂고 당기며 오므리기)은 막히지 않고 경고 없이 평적 이상', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    const rec = newRec();
    run(s, 26, { ry: DN }, rec);
    run(s, 200, { ly: -0.7, rx: -0.6, ry: -UP }, rec);
    console.log('normal', { fill: s.load / SC, back: s.loadBack / s.load, press: rec.maxPress, blocks: s.pressBlocks, ids: [...rec.ids] });
    expect(s.load).toBeGreaterThanOrEqual(SC);
    expect(s.load).toBeLessThanOrEqual(s.heapedCap + 1e-9);
    expect(s.loadBack / s.load).toBeGreaterThanOrEqual(0.5);
    expect(rec.ids.has('W-OVERLOAD')).toBe(false);
    expect(rec.ids.has('W-LIFT')).toBe(false);
    expectAssigned(s, 'normal');
  });
});
