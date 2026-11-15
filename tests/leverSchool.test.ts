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
/** n프레임 동안 레버를 주고 미션을 돌린다 */
function run(t: Tutor, inp: Inp, n: number) {
  for (let i = 0; i < n; i++) {
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    t.s.step();
    t.update();
  }
}
/** 레버를 한 번에 놓지 않고 n프레임에 걸쳐 0으로 줄인다 (좋은 조작) */


/** 일곱 단계를 바르게 지나가는 레버 순서 (A→C는 선회가 줄어드는 쪽 = lx 음수) */

/** 한 회차: 붐을 내리다가 놓고, 멈춤이 인정돼 다음 회차로 넘어갈 때까지 */

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

it('기본기 미션의 뼈대', () => {
  // 레버를 쓸 줄 모르는 사람에게 미션을 줄 수 없으니 레버 익히기가 맨 앞,
  // 그다음이 새 과정의 2단계 '흙 퍼기' (옛 b-stop~b-all은 Task 11에서 걷어낸다)
  expect(BASIC_LESSONS.map((l) => l.id)).toEqual(['b-levers', 'b-ready', 'b-dump', 'b-scoop', 'b-both', 'b-all']);
  expect(BASIC_LESSONS.every((l) => l.tier === '기본기')).toBe(true);
  // 모두 '왜 배우나' 카드와 끝낸 뒤 한 줄이 있다
  expect(BASIC_LESSONS.every((l) => l.why && l.grade)).toBe(true);
  // 목록에서 구별되게: id·아이콘·제목이 겹치지 않는다
  for (const k of ['id', 'icon', 'title'] as const) {
    const v = BASIC_LESSONS.map((l) => l[k]);
    expect(new Set(v).size, k).toBe(v.length);
  }
  // 가운데 글자 형식(big)을 쓰는 것: 레버 익히기와 새 2단계.
  // 한 톤 배경(flat)은 레버 익히기만 (2단계부터는 실제 시험장을 봐야 한다)
  expect(BASIC_LESSONS.filter((l) => l.big).map((l) => l.id)).toEqual(['b-levers', 'b-ready', 'b-dump', 'b-scoop']);
  expect(BASIC_LESSONS[3].id, '흙 퍼기는 4번째').toBe('b-scoop');
  // 한 톤 배경: 레버 익히기와 흙 퍼기 (실제 시험장 배경에서는 어두운 글자가 묻힌다).
  // 폴·줄이 필요한 것은 장애물을 넘는 단계부터다
  expect(BASIC_LESSONS.filter((l) => l.flat).map((l) => l.id)).toEqual(['b-levers', 'b-ready', 'b-dump', 'b-scoop']);
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

it('3단계: 두 레버를 같이 써서 끝까지 가고 별 2개 이상', () => {
  const t = bothTutor();
  expect(holdLine(t, 1, LINE.height), '바깥으로 긋기').toBe(true);
  expect(holdLine(t, -1, LINE.height), '당겨 오기').toBe(true);
  expect(t.cleared).toBe(true);
  expect(both().grade!(t.s, t.bag).stars).toBeGreaterThanOrEqual(2);
});

