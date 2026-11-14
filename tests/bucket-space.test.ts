import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { PRACTICE } from '../src/core/ruleEngine';
import { ik, toWorld } from '../src/sim/kinematics';
import { DigSession, type RulesFile, type Sticks } from '../src/sim/session';

/**
 * 버킷이 흙 속에서 차지하는 공간과 흙 흐름 (감독 합격 기준)
 *  - 오므림만 하면 깎인 흙은 날 앞 덧쌓임으로, 각도 맞춰 암을 당겨야 버킷 안으로
 *  - 버킷 입구·내부 공간을 지형이 덮지 않음 (조금 담겼는데 꽉 차 보이던 문제)
 */
const R = rules as unknown as RulesFile;
const SC = MACHINE.struckCapacity;
function sess() {
  const s = new DigSession(MACHINE, R, PRACTICE, () => 0.5);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 0.8;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  return s;
}
type Track = { maxSur: number; maxLed: number; minStore: number; maxLoad: number; firstSurUp: number; firstLoadUp: number; n: number };
const track0 = (): Track => ({ maxSur: 0, maxLed: 0, minStore: 0, maxLoad: 0, firstSurUp: -1, firstLoadUp: -1, n: 0 });
function run(s: DigSession, n: number, inp: Partial<Sticks>, t: Track, each?: (s: DigSession) => void) {
  for (let i = 0; i < n; i++) {
    const l0 = s.load;
    const s0 = s.surcharge;
    s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    s.step();
    t.n++;
    if (t.firstSurUp < 0 && s.surcharge > s0 + 1e-6) t.firstSurUp = t.n;
    if (t.firstLoadUp < 0 && s.load > l0 + 1e-6) t.firstLoadUp = t.n;
    t.maxSur = Math.max(t.maxSur, s.surcharge);
    t.maxLed = Math.max(t.maxLed, Math.abs(s.ledgerError()));
    t.minStore = Math.min(t.minStore, s.load, s.surcharge, s.loadBack);
    t.maxLoad = Math.max(t.maxLoad, s.load);
    each?.(s);
  }
}

/**
 * 버킷 윤곽이 덮는 모든 격자점에서 지형이 버킷 아래 끝보다 높은 칸 수 (버킷 위를 덮은 흙 포함).
 * 허용 높이 = 그 위치 버킷 단면의 아래 끝 (버킷 속 흙은 load로 따로 그림, 덮은 흙은 덧쌓임)
 */
function spaceCheck(s: DigSession) {
  const f = s.frame;
  const sw = s.pose.swing;
  const W = MACHINE.bucketWidth;
  // 화면 버킷 모양 그대로의 바깥 윤곽 (excavatorView bucketShapes 점을 여기서 따로 계산: 시뮬 코드와 독립)
  const hx = Math.cos(MACHINE.heelAngle) * MACHINE.heelLen;
  const hy = Math.sin(MACHINE.heelAngle) * MACHINE.heelLen;
  const loc: [number, number][] = [[0, 0], [-0.07, 0.38], [hx * 0.35, hy], [hx * 0.75, hy * 1.06], [hx, hy], [hx + (MACHINE.L3 - hx) * 0.5, hy * 0.52], [MACHINE.L3, 0]];
  const ca = Math.cos(f.thK);
  const sa = Math.sin(f.thK);
  const poly = loc.map(([x, y]) => ({ r: f.P2.r + x * ca - y * sa, y: f.P2.y + x * sa + y * ca }));
  let checked = 0;
  let bad = 0;
  let worst = -Infinity;
  for (const g of s.soil.grids) {
    for (let j = 0; j < g.nz; j++)
      for (let i = 0; i < g.nx; i++) {
        const x = g.xOf(i);
        const z = g.zOf(j);
        const r = x * Math.cos(sw) + z * Math.sin(sw);
        const lat = -x * Math.sin(sw) + z * Math.cos(sw);
        if (Math.abs(lat) > W / 2 - 0.02) continue; // 폭 끝까지 (격자점이 옆판에 걸친 것만 제외)
        const ys: number[] = [];
        for (let a = 0; a < poly.length; a++) {
          const p = poly[a];
          const q = poly[(a + 1) % poly.length];
          if ((p.r - r) * (q.r - r) > 0 || p.r === q.r) continue;
          ys.push(p.y + ((q.y - p.y) * (r - p.r)) / (q.r - p.r));
        }
        if (ys.length < 2) continue;
        const ylo = Math.min(...ys);
        const h = g.h[g.idx(i, j)];
        if (h <= g.floor[g.idx(i, j)] + 1e-6) continue; // 단단한 바닥은 못 깎음
        checked++;
        const over = h - (ylo + 0.02);
        worst = Math.max(worst, over);
        if (over > 0.03) bad++;
      }
  }
  const mid = toWorld(sw, { r: (f.tip.r + f.P2.r) / 2, y: (f.tip.y + f.P2.y) / 2 });
  return { checked, bad, worst, mouthCover: s.soil.surfaceAt(mid.x, mid.z) - mid.y };
}

describe('버킷 공간과 흙 흐름 (감독 기준)', () => {
  it('1. 오므림만: 입구 쪽에 조금 담기고(앞쪽 위주) 나머지는 날 앞에 쌓임', () => {
    const s = sess();
    s.restOnSoil(Math.PI, s.digTarget.rho);
    const t = track0();
    run(s, 240, { rx: -1 }, t); // 버킷 레버만
    // 오므리기만 해도 입구 쪽엔 흙이 들어옴 (사용자: '오므리기만 해도 버킷에 흙이 쌓이긴 해야지'), 가득 차지는 않음
    expect(s.load).toBeGreaterThanOrEqual(0.15 * SC);
    expect(s.load).toBeLessThanOrEqual(0.6 * SC);
    expect(s.loadBack).toBeLessThan(s.load - s.loadBack); // 입구 쪽 위주
    expect(t.maxSur).toBeGreaterThanOrEqual(0.08 * SC);
    expect(t.maxLed).toBeLessThan(1e-6);
  });
  it('2·3. 순서: 오므리면 덧쌓임이 먼저, 각도 맞춰 암 당기면 버킷으로', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    const t = track0();
    run(s, 35, { ry: 1 }, t);
    run(s, 135, { rx: -0.6, ry: -0.1 }, t);
    expect(s.load).toBeLessThan(0.4 * SC);
    expect(t.maxSur).toBeGreaterThanOrEqual(0.08 * SC);
    expect(t.firstSurUp).toBeGreaterThan(0);
    expect(t.firstSurUp).toBeLessThanOrEqual(t.firstLoadUp < 0 ? Infinity : t.firstLoadUp);
    const l0 = s.load;
    const arm0 = s.pose.arm;
    run(s, 180, { ly: -0.7, ry: -0.1 }, t);
    expect(Math.abs(s.pose.arm - arm0)).toBeGreaterThan(0.2);
    expect(s.load).toBeGreaterThanOrEqual(0.8 * SC);
    expect(s.load - l0).toBeGreaterThanOrEqual(0.4 * SC);
    expect(s.loadBack / s.load).toBeGreaterThanOrEqual(0.5);
    expect(t.maxLed).toBeLessThan(1e-6);
    expect(t.minStore).toBeGreaterThanOrEqual(-1e-9);
    expect(t.maxLoad).toBeLessThanOrEqual(s.heapedCap + 1e-9);
  });
  it('4. 바른 굴착(당기며 오므림): 평적 이상, 경고 없음', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    const t = track0();
    run(s, 26, { ry: 1 }, t);
    run(s, 200, { ly: -0.7, rx: -0.6, ry: -0.1 }, t);
    expect(s.load).toBeGreaterThanOrEqual(SC);
    expect(s.load).toBeLessThanOrEqual(s.heapedCap + 1e-9);
    expect(s.loadBack / s.load).toBeGreaterThanOrEqual(0.5);
    const ids = new Set(s.engine.violations.map((v) => v.id));
    expect(ids.has('W-OVERLOAD')).toBe(false);
    expect(ids.has('W-LIFT')).toBe(false);
    expect(t.maxLed).toBeLessThan(1e-6);
  });
  it('5. 오므림만 한 뒤(버킷이 흙에 묻힌 채): 지형이 버킷 입구·안을 덮지 않음', () => {
    const s = sess();
    s.restOnSoil(Math.PI, s.digTarget.rho);
    const t = track0();
    const bads: unknown[] = [];
    let k = 0;
    run(s, 240, { rx: -1, ry: 0.15 }, t, (s) => {
      if (k++ % 10) return;
      const c = spaceCheck(s);
      if (c.bad > 0 || c.mouthCover > 0.02) bads.push({ k, ...c });
    });
    const c = spaceCheck(s);
    expect(c.checked).toBeGreaterThanOrEqual(3);
    expect(bads, JSON.stringify(bads.slice(0, 3))).toEqual([]);
  });
  it('5b. 암 당겨 담는 중 평적 20~28%일 때도 지형이 버킷 안을 덮지 않음', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    const t = track0();
    let hit: ReturnType<typeof spaceCheck> | null = null;
    const cap = (s: DigSession) => {
      if (!hit && s.load >= 0.2 * SC && s.load <= 0.28 * SC) hit = spaceCheck(s);
    };
    run(s, 35, { ry: 1 }, t);
    run(s, 135, { rx: -0.6, ry: -0.1 }, t, cap);
    run(s, 180, { ly: -0.7, ry: -0.1 }, t, cap);
    expect(hit).not.toBe(null);
    const c = hit!;
    expect(c.checked).toBeGreaterThanOrEqual(3);
    expect(c.bad, JSON.stringify(c)).toBe(0);
    expect(c.mouthCover, JSON.stringify(c)).toBeLessThanOrEqual(0.02);
  });
  it('6. 오므렸다 멈춰도(흙 흘러내림·덧쌓임 내려놓기 뒤에도) 버킷 안에 지형이 다시 차오르지 않음', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    const t = track0();
    const bads: unknown[] = [];
    let k = 0;
    const chk = (s: DigSession) => {
      if (k++ % 5) return;
      const c = spaceCheck(s);
      if (c.bad > 0) bads.push({ k, ...c });
    };
    run(s, 35, { ry: 1 }, t);
    run(s, 60, { rx: -0.6 }, t, chk);
    run(s, 60, {}, t, chk);
    expect(bads, JSON.stringify(bads.slice(0, 3))).toEqual([]);
    expect(t.maxLed).toBeLessThan(1e-6);
  });
});
