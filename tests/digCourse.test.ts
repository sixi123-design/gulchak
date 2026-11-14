import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile, type Sticks } from '../src/sim/session';
import { Tutor } from '../src/sim/tutorial';
import { digSpot, SCOOP, SCOOP_LESSON } from '../src/sim/digCourse';

const R = rules as unknown as RulesFile;
const deg = Math.PI / 180;
const ZERO: Sticks = { lx: 0, ly: 0, rx: 0, ry: 0 };

function tutor() {
  const s = new DigSession(MACHINE, R, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 60; i++) s.step();
  return new Tutor(SCOOP_LESSON, s);
}
/** 시범까지 포함해 한 프레임을 돈다 (main.ts와 같은 순서) */
function frame(t: Tutor, user: Partial<Sticks>) {
  t.s.input = t.drive({ ...ZERO, ...user });
  t.s.step();
  t.update();
}
/** 지금 단계가 넘어갈 때까지 (최대 n프레임). user가 함수면 매 프레임 판단한다 */
function until(t: Tutor, user: Partial<Sticks> | ((t: Tutor) => Partial<Sticks>), n = 900) {
  const from = t.step;
  for (let i = 0; i < n; i++) {
    frame(t, typeof user === 'function' ? user(t) : user);
    if (t.step !== from || t.cleared) return true;
  }
  return false;
}
/** 이빨이 목표 높이에 들어오면 레버를 놓는다 (사람이 하는 것처럼) */
const toSpot = (t: Tutor): Partial<Sticks> => (t.s.frame.tip.y > SCOOP.yHi ? { ry: 0.4 } : {});

/** 시범 3회 → 따라 하기(한 칸 밀었다 놓기) → 파는 자리 보기 까지 */
function warmup(t: Tutor) {
  for (let i = 0; i < 3; i++) expect(until(t, {}, 400)).toBe(true);
  for (let i = 0; i < 40; i++) frame(t, { ry: -0.3 }); // 한 칸만 민다
  expect(until(t, {}, 200)).toBe(true); // 놓으면 넘어간다
  expect(until(t, {}, 400)).toBe(true); // 파는 자리 보여주기 (시간이 지나면 넘어감)
}

describe('2단계 흙 퍼기', () => {
  it('목표 자세가 모두 관절 한계 안이다', () => {
    const t = tutor();
    const { r } = digSpot(t.s);
    const A = t.s.site.stations.find((x) => x.name === 'A')!;
    expect(r).toBeGreaterThan(A.zoneIn);
    expect(r).toBeLessThan(A.zoneOut);
    // 이 자리에 이빨을 지면 가까이 둘 수 있나
    t.s.teleport({ swing: Math.PI, boom: 13 * deg, arm: -100 * deg, bucket: 67 * deg });
    expect(t.s.pose.bucket).toBeLessThanOrEqual(MACHINE.limits.bucket[1]);
    expect(Math.abs(t.s.frame.tip.r - r)).toBeLessThan(SCOOP.rTol);
    expect(t.s.frame.tip.y).toBeLessThan(SCOOP.yHi);
  });

  it('시범 세 토막은 앱이 레버를 미는 동안 유저 입력을 무시한다', () => {
    const t = tutor();
    frame(t, { ry: 1 }); // 유저가 반대로 밀어도
    expect(t.s.input.ry).toBeLessThan(0); // 앱이 미는 값(붐 올림)이 들어간다
    expect(t.demoState()).toBe('demo');
  });

  it('정석대로 하면 끝까지 간다', () => {
    const t = tutor();
    warmup(t);
    expect(until(t, toSpot, 900), '이빨 맞추기').toBe(true);
    expect(until(t, { ry: 0.5 }, 900), '흙에 넣기').toBe(true);
    expect(until(t, { ly: -0.6, rx: -0.5 }, 900), '채우기').toBe(true);
    expect(until(t, { rx: -1, ry: -0.5 }, 1200), '오므리며 들기').toBe(true);
    expect(t.cleared).toBe(true);
    expect(SCOOP_LESSON.grade!(t.s, t.bag).stars).toBeGreaterThanOrEqual(2);
  });

  it('오므리지 않고 그냥 들면 다 쏟아서 못 넘어간다', () => {
    const t = tutor();
    warmup(t);
    until(t, toSpot, 900);
    until(t, { ry: 0.5 }, 900);
    until(t, { ly: -0.6, rx: -0.5 }, 900);
    expect(until(t, { ry: -0.5 }, 600)).toBe(false);
    expect(t.s.load).toBeLessThan(0.1 * t.s.m.struckCapacity);
  });

  it('흙이 가득 차면 버킷이 더 안 오므려진다 (먼저 다 오므리고 들 수는 없다)', () => {
    const t = tutor();
    warmup(t);
    until(t, toSpot, 900);
    until(t, { ry: 0.5 }, 900);
    until(t, { ly: -0.6, rx: -0.5 }, 900);
    for (let i = 0; i < 600; i++) frame(t, { rx: -1 });
    expect(t.s.pose.bucket).toBeGreaterThan(0); // 아직 펴진 쪽에서 막혀 있다
  });

  it('아무것도 안 하면 통과하지 않는다', () => {
    const t = tutor();
    warmup(t);
    // 이빨 맞추기부터는 가만히 있으면 안 넘어간다
    expect(until(t, {}, 400)).toBe(false);
  });
});
