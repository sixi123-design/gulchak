import { expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { Tutor } from '../src/sim/tutorial';
import { BASIC_LESSONS } from '../src/sim/leverSchool';

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
  expect(t.cleared, '막다른 길 없이 끝까지 간다').toBe(true);
  // 고봉으로 여러 번 선회하면 정석으로 해도 10% 안팎은 흘린다 (선회 관성).
  // 중요한 건 '반대로 확 꺾기'보다 훨씬 적다는 것 — 아래 테스트가 그걸 본다.
  expect((t.bag.load0 - t.s.load) / t.bag.load0).toBeLessThan(0.12);
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
  expect(t.coach?.msg ?? '').toMatch(/먼저 멈추/);
});

it('흙을 쏟으면 별이 깎인다', () => {
  const L = stop();
  // 처음 1.0 담았는데 0.7만 남음 = 30% 손실
  expect(L.grade!({ load: 0.7, maxJolt: 0.9 } as never, { load0: 1 }).stars).toBe(1);
  // 15% 손실 — 선회 관성이 들어온 뒤로 정석도 10% 안팎을 흘리므로 기준이 올라갔다
  expect(L.grade!({ load: 0.85, maxJolt: 0.05 } as never, { load0: 1 }).stars).toBe(2);
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
  expect(flick.note).toMatch(/멈추기 전에/);
  const release = L.grade!({ load: 1, maxJolt: 0.3 } as never, { load0: 1 });
  expect(release.note).toMatch(/놓을 때/);
});

// ---------- 2단계: 원하는 데서 멈추기 ----------
import { AIM } from '../src/sim/leverSchool';
const aim = () => BASIC_LESSONS.find((l) => l.id === 'b-aim')!;
function aimTutor() {
  return new Tutor(aim(), sess());
}

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

it('별 3개는 세 회차 다 잘해야 — 한 번 크게 틀리면 평균이 좋아도 안 된다', () => {
  const L = aim();
  expect(L.grade!({} as never, { err1: 0.02, err2: 0.03, err3: 0.01 }).stars).toBe(3);
  // 앞 둘을 완벽히 해도 한 회차가 12cm 빗나가면 별 3개가 아니다 (평균은 5cm)
  expect(L.grade!({} as never, { err1: 0, err2: 0, err3: 0.12 }).stars).toBeLessThan(3);
  // 세 번을 다 안 하면 별 3개가 될 수 없다
  expect(L.grade!({} as never, { err1: 0 }).stars).toBe(1);
});

// ---------- 3단계: 두 레버를 같이 쓰기 ----------
import { LINE } from '../src/sim/leverSchool';
const both = () => BASIC_LESSONS.find((l) => l.id === 'b-both')!;
const bothTutor = () => new Tutor(both(), sess());

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

it('높이는 지켰어도 한 레버만 썼으면 별 3개는 아니다', () => {
  const L = both();
  const g = L.grade!({} as never, { devSum: 0.02 * 100, devN: 100, multi: 5, frames: 100 });
  expect(g.stars).toBeLessThan(3);
  expect(g.note).toMatch(/동시에/);
});

// ---------- 4단계: 합치기 ----------
const all = () => BASIC_LESSONS.find((l) => l.id === 'b-all')!;

it('세 항목이 모두 좋으면 별 3개 (◎ 세 개)', () => {
  const L = all();
  const g = L.grade!({ load: 1, maxJolt: 0 } as never, { load0: 1, errAll: 0.02, devSum: 2, devN: 100, multi: 80, frames: 100 });
  expect(g.stars).toBe(3);
  expect((g.note.match(/◎/g) ?? []).length).toBe(3);
});

it('두 항목 이상 나쁘면 별 1개', () => {
  const L = all();
  const g = L.grade!({ load: 0.7, maxJolt: 0.5 } as never, { load0: 1, errAll: 0.3, devSum: 2, devN: 100, multi: 80, frames: 100 });
  expect(g.stars).toBe(1);
});

it('기본기 다섯 미션의 뼈대', () => {
  // 레버를 쓸 줄 모르는 사람에게 미션을 줄 수 없으니 레버 익히기가 맨 앞
  expect(BASIC_LESSONS.map((l) => l.id)).toEqual(['b-levers', 'b-stop', 'b-aim', 'b-both', 'b-all']);
  expect(BASIC_LESSONS.every((l) => l.tier === '기본기')).toBe(true);
  // 모두 '왜 배우나' 카드와 끝낸 뒤 한 줄이 있다
  expect(BASIC_LESSONS.every((l) => l.why && l.grade)).toBe(true);
  // 목록에서 구별되게: id·아이콘·제목이 겹치지 않는다
  for (const k of ['id', 'icon', 'title'] as const) {
    const v = BASIC_LESSONS.map((l) => l[k]);
    expect(new Set(v).size, k).toBe(v.length);
  }
  // 레버 익히기만 한 톤 배경 + 배경 지시문을 쓴다
  expect(BASIC_LESSONS.filter((l) => l.flat || l.big).map((l) => l.id)).toEqual(['b-levers']);
  // 선이 남는 미션은 동시조작을 가르치는 둘
  expect(BASIC_LESSONS.filter((l) => l.trail).map((l) => l.id)).toEqual(['b-both', 'b-all']);
});

// ---------- 실제 조작으로 끝까지 가는지 (가동범위·도달성까지 함께 막는다) ----------

/** 시작 자세가 장비 가동범위 안이어야 한다 */
it('네 미션의 시작 자세가 모두 가동범위 안', () => {
  const lim = MACHINE.limits;
  for (const L of BASIC_LESSONS) {
    const t = new Tutor(L, sess());
    const p = t.s.pose;
    expect(p.boom, `${L.id} boom`).toBeGreaterThanOrEqual(lim.boom[0] - 1e-6);
    expect(p.boom, `${L.id} boom`).toBeLessThanOrEqual(lim.boom[1] + 1e-6);
    expect(p.arm, `${L.id} arm`).toBeGreaterThanOrEqual(lim.arm[0] - 1e-6);
    expect(p.arm, `${L.id} arm`).toBeLessThanOrEqual(lim.arm[1] + 1e-6);
    expect(p.bucket, `${L.id} bucket`).toBeGreaterThanOrEqual(lim.bucket[0] - 1e-6);
    expect(p.bucket, `${L.id} bucket`).toBeLessThanOrEqual(lim.bucket[1] + 1e-6);
    expect(t.s.groundGap(), `${L.id} gap`).toBeGreaterThan(0);
  }
});

/**
 * 목표 높이를 지키며 암을 펴거나 당긴다 (붐으로 높이를 보정하는 자동 조작).
 * 사람보다 정확하다 — 도달 가능성과 막다른 길을 막는 용도다.
 */
function holdLine(t: Tutor, armDir: 1 | -1, target: number, frames = 1200) {
  const from = t.step;
  for (let i = 0; i < frames; i++) {
    const e = t.s.groundGap() - target;
    t.s.input = { lx: 0, ly: armDir, rx: 0, ry: Math.max(-1, Math.min(1, e * 4)) };
    t.s.step();
    t.update();
    if (t.step !== from || t.cleared) return true;
  }
  return false;
}
/**
 * 목표 높이로 다가가 멈춘다. 가까워질수록 레버를 줄인다 — 이 단계가 가르치려는 조작.
 * (레버를 끝까지 주고 놓으면 15cm쯤 더 내려가 허용 오차를 넘는다)
 *
 * 매 프레임 groundGap을 보고 레버를 보정하므로 사람보다 정확하다. 이 테스트가
 * 증명하는 것은 '사람이 쉽게 한다'가 아니라 '장비 가동범위 안에서 완주 가능하고
 * 등급이 제대로 매겨진다'이다 — 도달 불가·막다른 길을 막는 용도.
 */
function aimAuto(t: Tutor, target: number) {
  const from = t.step;
  for (let i = 0; i < 1500; i++) {
    const e = t.s.groundGap() - target; // + 면 높다 → 붐 내림(ry +)
    if (Math.abs(e) < 0.008) break;
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: Math.max(-1, Math.min(1, e * 2)) };
    t.s.step();
    t.update();
    if (t.step !== from || t.cleared) return true;
  }
  for (let i = 0; i < 400; i++) {
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: 0 };
    t.s.step();
    t.update();
    if (t.step !== from || t.cleared) return true;
  }
  return false;
}

it('2단계: 세 회차를 목표에 맞춰 끝내면 별 2개 이상', () => {
  const t = aimTutor();
  for (const target of AIM.targets) {
    if (t.cleared) break;
    expect(aimAuto(t, target), `회차 ${target}`).toBe(true);
  }
  expect(t.cleared).toBe(true);
  expect(aim().grade!(t.s, t.bag).stars).toBeGreaterThanOrEqual(2);
});

it('3단계: 두 레버를 같이 써서 끝까지 가고 별 2개 이상', () => {
  const t = bothTutor();
  expect(holdLine(t, 1, LINE.height), '바깥으로 긋기').toBe(true);
  expect(holdLine(t, -1, LINE.height), '당겨 오기').toBe(true);
  expect(t.cleared).toBe(true);
  expect(both().grade!(t.s, t.bag).stars).toBeGreaterThanOrEqual(2);
});

it('4단계: 끝까지 가고 흙도 지킨다', () => {
  const t = new Tutor(all(), sess());
  expect(holdLine(t, 1, LINE.height), '긋기').toBe(true);
  expect(aimAuto(t, AIM.targets[1]), '멈추기').toBe(true); // 4단계는 aimStep(1) = 20cm
  expect(t.cleared).toBe(true);
  const g = all().grade!(t.s, t.bag);
  expect(g.stars).toBeGreaterThanOrEqual(2);
  expect(g.note).toMatch(/흙 [◎○]/); // 흙을 쏟지 않았다
});

it('레버를 톡 건드리고 기다리는 것으로는 통과하지 못한다', () => {
  const t = aimTutor();
  run(t, { ry: 1 }, 3); // 아주 짧게
  run(t, {}, 200); // 그리고 기다리기만
  expect(t.step).toBe(0);
});

it('아무것도 안 하면 통과하지 못한다', () => {
  const t = aimTutor();
  run(t, {}, 300);
  expect(t.step).toBe(0);
});

it('반대 방향으로 더 밀었다가 돌아와도 밀어낸 만큼부터 센다', () => {
  // 앞 단계 레버를 계속 밀어 넘어가도 막다른 길이 되지 않게, 가장 멀리 간 곳을 기준으로 센다
  const t = tutor();
  until(t, { lx: -1 }); // 1단계: 왼쪽으로
  until(t, {}, 400); // 2단계: 멈춤
  const at = t.step; // 3단계: 오른쪽으로 30도
  run(t, { lx: -1 }, 90); // 반대로 더 밀어 버린다
  const far = t.s.pose.swing;
  expect(until(t, { lx: 1 }, 900)).toBe(true);
  // 밀어낸 자리에서 30도만 돌아오면 통과 (처음 자리까지 다 돌아올 필요 없음)
  expect(t.s.pose.swing - far).toBeGreaterThan(29 * (Math.PI / 180));
  expect(t.step).toBeGreaterThan(at);
});
