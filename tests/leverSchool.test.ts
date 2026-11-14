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
  expect(L.steps.length).toBeGreaterThanOrEqual(5);
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
  expect((t.bag.load0 - t.s.load) / t.bag.load0).toBeLessThan(0.01);
  expect(L.grade!(t.s, t.bag).stars).toBe(3);
});

it('반대로 확 꺾으면 흙이 쏟아진다', () => {
  const t = tutor();
  until(t, { lx: -1 }); // 선회를 충분히 올린 뒤
  run(t, { lx: -1 }, 60);
  const l0 = t.s.load;
  run(t, { lx: 1 }, 30); // 중립을 거치지 않고 반대로
  expect((l0 - t.s.load) / l0).toBeGreaterThan(0.1);
  expect(t.s.maxJolt).toBeGreaterThan(R.params.joltSpill);
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
  // 처음 1.0 담았는데 0.7만 남음 = 30% 손실
  expect(L.grade!({ load: 0.7, maxJolt: 0.9 } as never, { load0: 1 }).stars).toBe(1);
  // 2% 손실
  expect(L.grade!({ load: 0.98, maxJolt: 0.05 } as never, { load0: 1 }).stars).toBe(2);
});

it('덜컹거리면 별 3개를 못 받는다', () => {
  const L = stop();
  expect(L.grade!({ load: 1, maxJolt: SMOOTH.warn + 0.01 } as never, { load0: 1 }).stars).toBeLessThan(3);
});

it('별은 언제나 1~3 (보관함이 비어 있어도)', () => {
  const L = stop();
  expect([1, 2, 3]).toContain(L.grade!({ load: 0, maxJolt: 0 } as never, {}).stars);
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

it('충격 최대값은 세션이 기록한다 (화면 프레임 수와 무관)', () => {
  // coach에서 쌓으면 한 프레임에 물리가 여러 번 돌 때 정점을 놓친다
  const t = tutor();
  expect(t.s.maxJolt).toBe(0); // setup에서 0으로
  until(t, { lx: -1 });
  run(t, { lx: -1 }, 60);
  run(t, { lx: 1 }, 20);
  expect(t.s.maxJolt).toBeGreaterThan(0.2);
});

it('중립을 거르고 꺾었으면 그렇게 말해 준다', () => {
  const L = stop();
  const flick = L.grade!({ load: 1, maxJolt: 0.3 } as never, { load0: 1, flick: 1 });
  expect(flick.note).toMatch(/중립을 거르/);
  const release = L.grade!({ load: 1, maxJolt: 0.3 } as never, { load0: 1 });
  expect(release.note).toMatch(/놓을 때/);
});

it('단계는 다섯 개 (같은 왕복을 네 번 하면 지루하다)', () => {
  expect(stop().steps.length).toBe(5);
});

// ---------- 2단계: 원하는 데서 멈추기 ----------
import { AIM } from '../src/sim/leverSchool';
const aim = () => BASIC_LESSONS.find((l) => l.id === 'b-aim')!;
function aimTutor() {
  return new Tutor(aim(), sess());
}

it('2단계가 있고 기본기 묶음이다', () => {
  const L = aim();
  expect(L.tier).toBe('기본기');
  expect(L.why).toBeTruthy();
  expect(L.grade).toBeTruthy();
  expect(L.steps.length).toBe(AIM.targets.length);
});

it('허용 오차는 회차마다 좁아진다', () => {
  expect(AIM.tol).toEqual([0.12, 0.07, 0.04]);
  expect(AIM.targets).toEqual([0.3, 0.2, 0.1]);
});

it('멈추지 않으면 통과하지 못한다', () => {
  const t = aimTutor();
  // 레버를 계속 밀고 있으면 목표 높이를 지나가더라도 통과 안 됨
  run(t, { ry: 1 }, 300);
  expect(t.step).toBe(0);
});

/** 한 회차: 붐을 내리다가 놓고, 멈춤이 인정돼 다음 회차로 넘어갈 때까지 */
function aimRound(t: Tutor, push = 40) {
  const from = t.step;
  run(t, { ry: 1 }, push);
  for (let i = 0; i < 300; i++) {
    run(t, {}, 1);
    if (t.step !== from || t.cleared) return true;
  }
  return false;
}

it('멈추면 통과하고 오차가 기록된다 (맞췄든 못 맞췄든)', () => {
  const t = aimTutor();
  expect(aimRound(t)).toBe(true);
  expect(t.step).toBeGreaterThan(0);
  expect(typeof t.bag.err1).toBe('number');
});

it('멈추는 동안은 세는 것을, 멈춘 뒤에는 오차 cm를 보여 준다', () => {
  const t = aimTutor();
  const seen: string[] = [];
  run(t, { ry: 1 }, 40); // 붐 내림
  for (let i = 0; i < 150; i++) {
    run(t, {}, 1);
    const h = t.hud();
    if (h) seen.push(h);
    if (t.step > 0) break;
  }
  expect(seen.some((h) => /●/.test(h))).toBe(true); // 세는 중
  expect(seen.some((h) => /cm/.test(h))).toBe(true); // 멈춘 뒤 오차
});

it('오차를 보여 준 뒤에 다음 회차로 넘어간다', () => {
  const t = aimTutor();
  aimRound(t);
  expect(t.step).toBe(1);
  expect(t.bag.err1).toBeTypeOf('number');
  // 다음 회차에서도 앞 회차 결과가 남아 있다
  expect(t.hud() ?? '').toMatch(/지난 회차/);
});

it('세 번 다 4cm 안이면 별 3개', () => {
  const L = aim();
  expect(L.grade!({} as never, { err1: 0.02, err2: 0.03, err3: 0.01 }).stars).toBe(3);
});

it('평균 8cm 안이면 별 2개', () => {
  const L = aim();
  expect(L.grade!({} as never, { err1: 0.06, err2: 0.07, err3: 0.08 }).stars).toBe(2);
});

it('많이 벗어나면 별 1개', () => {
  const L = aim();
  expect(L.grade!({} as never, { err1: 0.3, err2: 0.25, err3: 0.4 }).stars).toBe(1);
});

it('2단계도 별은 언제나 1~3', () => {
  expect([1, 2, 3]).toContain(aim().grade!({} as never, {}).stars);
});

it('기본기 미션 id가 모두 다르다', () => {
  const ids = BASIC_LESSONS.map((l) => l.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it('세 회차를 다 돌면 끝난다', () => {
  const t = aimTutor();
  for (let i = 0; i < 3; i++) if (!t.cleared) aimRound(t, 20);
  expect(t.cleared).toBe(true);
  expect(aim().grade!(t.s, t.bag).stars).toBeGreaterThanOrEqual(1);
});

// ---------- 3단계: 두 레버를 같이 쓰기 ----------
import { LINE } from '../src/sim/leverSchool';
const both = () => BASIC_LESSONS.find((l) => l.id === 'b-both')!;
const bothTutor = () => new Tutor(both(), sess());

it('3단계가 있고 선을 남긴다', () => {
  const L = both();
  expect(L.tier).toBe('기본기');
  expect(L.trail).toBe(true);
  expect(L.why).toBeTruthy();
  expect(L.grade).toBeTruthy();
});

it('목표 높이와 등급 경계가 정해져 있다', () => {
  expect(LINE.good).toBe(0.04);
  expect(LINE.ok).toBe(0.1);
  expect(LINE.height).toBeGreaterThan(0);
});

it('붐만 쓰면 높이가 벗어난다 (호를 그린다)', () => {
  const t = bothTutor();
  run(t, { ry: -1 }, 120); // 붐만 올림
  const dev = t.bag.devN ? t.bag.devSum / t.bag.devN : 0;
  expect(dev).toBeGreaterThan(LINE.ok);
});

it('이빨이 높으면 붐 내림, 낮으면 붐 올림을 알려 준다', () => {
  const t = bothTutor();
  run(t, { ry: -1 }, 120); // 붐만 올려 높아지게
  expect(t.coach?.msg ?? '').toMatch(/붐 내림/);
  const t2 = bothTutor();
  run(t2, { ry: 1 }, 60); // 붐만 내려 낮아지게
  expect(t2.coach?.msg ?? '').toMatch(/붐 올림/);
});

it('동시조작 비율을 센다', () => {
  const t = bothTutor();
  run(t, { ry: -1, ly: 1 }, 60); // 붐과 암을 같이
  expect(t.bag.frames).toBeGreaterThan(0);
  expect((t.bag.multi ?? 0) / t.bag.frames).toBeGreaterThan(0.5);
  const t2 = bothTutor();
  run(t2, { ry: -1 }, 60); // 붐만 — 같이 움직인 프레임이 아예 없다
  expect(t2.bag.frames).toBeGreaterThan(0);
  expect((t2.bag.multi ?? 0) / t2.bag.frames).toBeLessThan(0.2);
});

it('높이를 잘 지키면 별 3개', () => {
  const L = both();
  expect(L.grade!({} as never, { devSum: 0.02 * 100, devN: 100, multi: 80, frames: 100 }).stars).toBe(3);
});

it('높이가 많이 벗어나면 별 1개', () => {
  const L = both();
  expect(L.grade!({} as never, { devSum: 0.4 * 100, devN: 100, multi: 80, frames: 100 }).stars).toBe(1);
});

it('높이는 지켰어도 한 레버만 썼으면 별 3개는 아니다', () => {
  const L = both();
  const g = L.grade!({} as never, { devSum: 0.02 * 100, devN: 100, multi: 5, frames: 100 });
  expect(g.stars).toBeLessThan(3);
  expect(g.note).toMatch(/같이|한 번에/);
});

it('3단계도 별은 언제나 1~3', () => {
  expect([1, 2, 3]).toContain(both().grade!({} as never, {}).stars);
});

// ---------- 4단계: 합치기 ----------
const all = () => BASIC_LESSONS.find((l) => l.id === 'b-all')!;

it('4단계가 있고 세 가지를 다 본다', () => {
  const L = all();
  expect(L.tier).toBe('기본기');
  expect(L.trail).toBe(true);
  expect(L.why).toBeTruthy();
  expect(L.grade).toBeTruthy();
});

it('세 항목을 ◎○△로 보여 준다', () => {
  const L = all();
  const g = L.grade!({ load: 1, maxJolt: 0 } as never, { load0: 1, err1: 0.02, devSum: 2, devN: 100, multi: 80, frames: 100 });
  expect(g.note).toMatch(/[◎○△]/);
  expect((g.note.match(/[◎○△]/g) ?? []).length).toBe(3);
});

it('세 항목이 모두 좋으면 별 3개 (◎ 세 개)', () => {
  const L = all();
  const g = L.grade!({ load: 1, maxJolt: 0 } as never, { load0: 1, err1: 0.02, devSum: 2, devN: 100, multi: 80, frames: 100 });
  expect(g.stars).toBe(3);
  expect((g.note.match(/◎/g) ?? []).length).toBe(3);
});

it('한 항목만 나쁘면 별 2개', () => {
  const L = all();
  // 흙을 30% 쏟음, 나머지는 좋음
  const g = L.grade!({ load: 0.7, maxJolt: 0.5 } as never, { load0: 1, err1: 0.02, devSum: 2, devN: 100, multi: 80, frames: 100 });
  expect(g.stars).toBe(2);
});

it('두 항목 이상 나쁘면 별 1개', () => {
  const L = all();
  const g = L.grade!({ load: 0.7, maxJolt: 0.5 } as never, { load0: 1, err1: 0.3, devSum: 2, devN: 100, multi: 80, frames: 100 });
  expect(g.stars).toBe(1);
});

it('4단계도 별은 언제나 1~3', () => {
  expect([1, 2, 3]).toContain(all().grade!({} as never, {}).stars);
});

it('기본기는 네 미션이고 순서대로다', () => {
  expect(BASIC_LESSONS.map((l) => l.id)).toEqual(['b-stop', 'b-aim', 'b-both', 'b-all']);
  expect(BASIC_LESSONS.every((l) => l.tier === '기본기')).toBe(true);
  expect(BASIC_LESSONS.every((l) => l.why && l.grade)).toBe(true);
});

it('기본기 네 미션의 아이콘이 모두 다르다', () => {
  const icons = BASIC_LESSONS.map((l) => l.icon);
  expect(new Set(icons).size).toBe(icons.length);
});
