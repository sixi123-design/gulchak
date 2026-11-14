import { describe, expect, it } from 'vitest';
import { Tutor, type Lesson, type Step } from '../src/sim/tutorial';

type Fake = { flags: { autoEnd: boolean }; n: number };
const fake = (): Fake => ({ flags: { autoEnd: false }, n: 0 });
const user = { lx: 0, ly: 0, rx: 0, ry: 1 };

/** 시범 60프레임 동안 붐을 ¼만 미는 단계 하나짜리 미션 */
function lesson(demo?: Step<Fake>['demo']): Lesson<Fake> {
  return {
    id: 'x',
    tier: '기본기',
    icon: 'stLevers',
    title: '시범',
    setup: () => {},
    steps: [{ text: '보세요', demo, done: (s: Fake) => s.n++ > 1e9 }],
  } as unknown as Lesson<Fake>;
}
const demo60: Step<Fake>['demo'] = (f) => (f < 60 ? { ry: -0.25 } : null);

describe('앱이 레버를 대신 미는 시범', () => {
  it('시범이 도는 동안 유저가 레버를 밀어도 무시된다', () => {
    const t = new Tutor(lesson(demo60), fake());
    for (let i = 0; i < 30; i++) t.drive(user);
    expect(t.demoState()).toBe('demo');
    expect(t.drive(user)).toEqual({ lx: 0, ly: 0, rx: 0, ry: -0.25 });
  });

  it('시범이 끝나면 노브가 가운데로 돌아와 잠깐 멈춘다', () => {
    const t = new Tutor(lesson(demo60), fake());
    for (let i = 0; i < 61; i++) t.drive(user);
    expect(t.drive(user)).toEqual({ lx: 0, ly: 0, rx: 0, ry: 0 });
    expect(t.demoState()).toBe('rest');
  });

  it('멈춤이 끝나면 유저 입력이 그대로 먹는다', () => {
    const t = new Tutor(lesson(demo60), fake());
    for (let i = 0; i < 60 + 40; i++) t.drive(user);
    expect(t.drive(user)).toEqual(user);
    expect(t.demoState()).toBe('user');
  });

  it('시범이 없는 단계는 처음부터 유저 입력이다', () => {
    const t = new Tutor(lesson(), fake());
    expect(t.drive(user)).toEqual(user);
    expect(t.demoState()).toBe('user');
  });

  it('단계가 바뀌면 시범이 처음부터 다시 돈다', () => {
    const t = new Tutor(lesson(demo60), fake());
    for (let i = 0; i < 200; i++) t.drive(user);
    expect(t.demoState()).toBe('user');
    t.restartStep();
    expect(t.drive(user)).toEqual({ lx: 0, ly: 0, rx: 0, ry: -0.25 });
  });
});
