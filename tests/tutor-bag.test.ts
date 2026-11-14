import { expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { Tutor, type Lesson } from '../src/sim/tutorial';

const R = rules as unknown as RulesFile;

function sess() {
  const s = new DigSession(MACHINE, R, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  return s;
}

it('bag은 단계가 넘어가도 남는다', () => {
  const L: Lesson = {
    id: 't-bag',
    icon: 'stLevers',
    title: '보관함',
    setup: () => {},
    steps: [
      { text: '1', done: (_s, _mem, bag) => ((bag.x = 7), true) },
      { text: '2', done: (_s, _mem, bag) => bag.x === 7 },
    ],
  };
  const t = new Tutor(L, sess());
  t.update(); // 1단계 통과
  expect(t.bag.x).toBe(7);
  t.update(); // 2단계는 bag.x를 보고 통과
  expect(t.cleared).toBe(true);
});

it('mem은 단계마다 비워진다', () => {
  let seen: number | undefined = -1;
  const L: Lesson = {
    id: 't-mem',
    icon: 'stLevers',
    title: '메모',
    setup: () => {},
    steps: [
      { text: '1', done: (_s, mem) => ((mem.y = 7), true) },
      { text: '2', begin: (_s, mem) => (seen = mem.y), done: () => true },
    ],
  };
  const t = new Tutor(L, sess());
  t.update();
  expect(seen).toBeUndefined();
});

it('grade는 bag을 받아 별을 돌려준다', () => {
  const L: Lesson = {
    id: 't-grade',
    icon: 'stLevers',
    title: '등급',
    grade: (_s, bag) => ({ stars: bag.hit > 0 ? 3 : 1, note: bag.hit > 0 ? '좋음' : '아쉬움' }),
    setup: () => {},
    steps: [{ text: '1', done: (_s, _mem, bag) => ((bag.hit = 1), true) }],
  };
  const t = new Tutor(L, sess());
  t.update();
  expect(L.grade!(t.s, t.bag)).toEqual({ stars: 3, note: '좋음' });
});

it('bag이 비어 있어도 별은 1~3 사이', () => {
  const L: Lesson = {
    id: 't-empty',
    icon: 'stLevers',
    title: '빈 보관함',
    grade: (_s, bag) => ({ stars: bag.lost < 0.01 ? 3 : bag.lost < 0.05 ? 2 : 1, note: '' }),
    setup: () => {},
    steps: [{ text: '1', done: () => false }],
  };
  const t = new Tutor(L, sess());
  // 아무 단계도 거치지 않아 bag이 비어 있다 (bag.lost는 undefined)
  const g = L.grade!(t.s, t.bag);
  expect([1, 2, 3]).toContain(g.stars);
});

it('meter와 coach도 bag을 받는다', () => {
  const L: Lesson = {
    id: 't-pass',
    icon: 'stLevers',
    title: '전달',
    setup: () => {},
    steps: [
      {
        text: '1',
        begin: (_s, _mem, bag) => (bag.n = 3),
        meter: (_s, _mem, bag) => ({ v: bag.n / 10 }),
        coach: (_s, _mem, bag) => (bag.n === 3 ? { msg: '셋', labels: [] } : null),
        done: () => false,
      },
    ],
  };
  const t = new Tutor(L, sess());
  expect(t.meter()).toEqual({ v: 0.3 });
  t.update();
  expect(t.coach?.msg).toBe('셋');
});
