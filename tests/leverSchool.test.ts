import { expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { Tutor } from '../src/sim/tutorial';
import { BASIC_LESSONS, SMOOTH } from '../src/sim/leverSchool';

const R = rules as unknown as RulesFile;
type Inp = { lx?: number; ly?: number; rx?: number; ry?: number };

function sess() {
  const s = new DigSession(MACHINE, R, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  return s;
}
const stop = () => BASIC_LESSONS.find((l) => l.id === 'b-stop')!;
function tutor() {
  const t = new Tutor(stop(), sess());
  return t;
}
/** n프레임 동안 레버를 주고 미션을 돌린다 */
function run(t: Tutor, inp: Inp, n: number) {
  for (let i = 0; i < n; i++) {
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    t.s.step();
    t.update();
  }
}
/** 레버를 한 번에 놓지 않고 n프레임에 걸쳐 0으로 줄인다 (좋은 조작) */
function ease(t: Tutor, inp: Inp, n = 30) {
  for (let i = 0; i < n; i++) {
    const k = 1 - (i + 1) / n;
    const o: Inp = {};
    for (const key of Object.keys(inp) as (keyof Inp)[]) o[key] = (inp[key] ?? 0) * k;
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...o };
    t.s.step();
    t.update();
  }
  run(t, {}, 20);
}

/** 지금 단계를 통과할 때까지 레버를 준다 (최대 n프레임) */
function until(t: Tutor, inp: Inp, n = 600) {
  const from = t.step;
  for (let i = 0; i < n; i++) {
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    t.s.step();
    t.update();
    if (t.step !== from || t.cleared) return true;
  }
  return false;
}

/** 일곱 단계를 바르게 지나가는 레버 순서 (A→C는 선회가 줄어드는 쪽 = lx 음수) */
const PLAN: Inp[] = [{ lx: -1 }, {}, { lx: 1 }, {}, { lx: -1 }, {}, { lx: 1 }];

it('미션이 하나 있고 기본기 묶음이다', () => {
  const L = stop();
  expect(L.tier).toBe('기본기');
  expect(L.why).toBeTruthy();
  expect(L.grade).toBeTruthy();
  expect(L.steps.length).toBeGreaterThanOrEqual(6);
  // 1단계는 선회만 다룬다 — 고봉으로 담은 채 붐을 내리면 덜컹과 무관하게 흙이 흐른다(pour)
  expect(L.steps.every((st) => (st.labels ?? []).every((t) => t.includes('선회') || t === ''))).toBe(true);
});

it('고봉으로 담은 흙을 들고 시작한다', () => {
  const t = tutor();
  expect(t.s.load).toBeGreaterThan(MACHINE.struckCapacity);
});

it('멈추지 않으면 멈춤 단계를 통과하지 못한다', () => {
  const t = tutor();
  expect(until(t, { lx: -1 })).toBe(true); // 1단계: 선회로 C 쪽으로
  const at = t.step;
  run(t, { lx: -1 }, 200); // 계속 밀고 있으면 멈춤 단계는 통과 안 됨
  expect(t.step).toBe(at);
});

it('레버를 중립으로 놓고 서면 멈춤 단계를 통과한다', () => {
  const t = tutor();
  expect(until(t, { lx: -1 })).toBe(true);
  const at = t.step;
  expect(until(t, {}, 300)).toBe(true);
  expect(t.step).toBeGreaterThan(at);
});

it('멈춘 뒤에 바꾸면 흙이 안 쏟아지고 별 3개', () => {
  const t = tutor();
  const L = stop();
  // 각 단계를 레버를 서서히 주고 중립을 거쳐 통과한다
  for (const inp of PLAN) {
    if (t.cleared) break;
    until(t, inp, 900);
    ease(t, inp); // 다음 단계로 넘어갈 때마다 레버를 줄여서 놓고 완전히 세운다
  }
  expect(t.bag.lost ?? 0).toBeLessThan(0.01);
  expect(L.grade!(t.s, t.bag).stars).toBe(3);
});

it('반대로 확 꺾으면 흙이 쏟아진다', () => {
  const t = tutor();
  until(t, { lx: -1 }); // 선회를 충분히 올린 뒤
  run(t, { lx: -1 }, 60);
  run(t, { lx: 1 }, 30); // 중립을 거치지 않고 반대로
  expect(t.bag.lost ?? 0).toBeGreaterThan(0.1);
  expect(t.bag.maxJolt ?? 0).toBeGreaterThan(R.params.joltSpill);
});

it('반대로 꺾으면 코치가 멈추라고 한다', () => {
  const t = tutor();
  until(t, { lx: -1 });
  run(t, { lx: -1 }, 60);
  run(t, { lx: 1 }, 3);
  expect(t.coach?.msg ?? '').toMatch(/멈춘 뒤/);
});

it('흙을 쏟으면 별이 깎인다', () => {
  const L = stop();
  expect(L.grade!({} as never, { lost: 0.3, maxJolt: 0.9 }).stars).toBeLessThan(3);
  expect(L.grade!({} as never, { lost: 0.02, maxJolt: 0.05 }).stars).toBe(2);
});

it('덜컹거리면 별 3개를 못 받는다', () => {
  const L = stop();
  expect(L.grade!({} as never, { lost: 0, maxJolt: SMOOTH.warn + 0.01 }).stars).toBeLessThan(3);
});

it('별은 언제나 1~3 (보관함이 비어 있어도)', () => {
  const L = stop();
  expect([1, 2, 3]).toContain(L.grade!({} as never, {}).stars);
});

it('부드럽게 하면 막다른 길 없이 끝까지 간다', () => {
  const t = tutor();
  for (const inp of PLAN) {
    if (t.cleared) break;
    until(t, inp, 900);
    ease(t, inp);
  }
  expect(t.cleared).toBe(true);
});
