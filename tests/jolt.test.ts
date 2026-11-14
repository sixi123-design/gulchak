import { expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';

const R = rules as unknown as RulesFile;
const d = (x: number) => (x * Math.PI) / 180;
const SC = MACHINE.struckCapacity;

/** 고봉으로 담은 버킷을 들고 팔을 뻗은 자세 (충격이 가장 크게 나는 조건) */
function laden() {
  const s = new DigSession(MACHINE, R, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  s.teleport({ swing: Math.PI, boom: d(25), arm: d(-40), bucket: MACHINE.limits.bucket[0] + d(2) });
  s.load = SC * 1.25;
  s.loadBack = s.load * 0.85;
  return s;
}
/** 레버를 놓고 그 관절이 정말로 설 때까지 (최고속도의 1% 아래) */
function settle(s: DigSession, j: 'swing' | 'boom', max = 600) {
  for (let i = 0; i < max; i++) {
    s.input = { lx: 0, ly: 0, rx: 0, ry: 0 };
    s.step();
    if (Math.abs(s.vel[j]) < 0.01 * s.m.speeds[j]) return i;
  }
  throw new Error(`${j}이 안 선다`);
}
function go(s: DigSession, inp: Partial<Record<'lx' | 'ly' | 'rx' | 'ry', number>>, n: number) {
  let mx = 0;
  for (let i = 0; i < n; i++) {
    s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp } as never;
    s.step();
    mx = Math.max(mx, s.lastJolt);
  }
  return mx;
}

it('멈춘 뒤에 반대로 주면 덜컹하지 않는다', () => {
  // 레버를 놓고 선 다음 반대 방향으로 미는 것은 바른 조작이다.
  // 남아 있던 아주 작은 속도 때문에 '반대로 확 꺾음'으로 쳐지면,
  // 바르게 한 사람의 흙이 쏟아져 배우기가 거짓말을 하게 된다.
  const s = laden();
  go(s, { ry: -1 }, 60); // 붐 올림
  settle(s, 'boom'); // 놓고 완전히 서기
  const mx = go(s, { ry: 1 }, 30); // 이제 반대로 (붐 내림)
  expect(mx).toBeLessThan(R.params.joltWarn);
});

it('선회도 완전히 선 뒤에 반대로 주면 덜컹하지 않는다', () => {
  // 선회는 흙을 실으면 감속 시정수가 0.144초라 붐보다 오래 끌린다.
  // 아직 끌리는 중에 반대로 주는 것은 진짜 덜컹이다 — 다 선 뒤를 본다.
  const s = laden();
  go(s, { lx: 1 }, 60);
  settle(s, 'swing');
  const l0 = s.load;
  const mx = go(s, { lx: -1 }, 30);
  expect(mx).toBeLessThan(R.params.joltWarn);
  expect(s.load).toBeCloseTo(l0, 6);
});

it('아직 끌리는 중에 반대로 주면 덜컹으로 센다', () => {
  // 배우기가 "멈췄다"를 덜컹 경계보다 엄하게(1%) 잡는 이유
  const s = laden();
  go(s, { lx: 1 }, 60);
  go(s, {}, 20);
  expect(Math.abs(s.vel.swing)).toBeGreaterThan(0.03 * MACHINE.speeds.swing);
  expect(go(s, { lx: -1 }, 30)).toBeGreaterThan(R.params.joltWarn);
});

it('움직이는 중에 반대로 확 꺾으면 덜컹하고 고봉 흙이 쏟아진다', () => {
  const s = laden();
  go(s, { ry: -1 }, 60);
  const l0 = s.load;
  const mx = go(s, { ry: 1 }, 30); // 중립을 거치지 않고
  expect(mx).toBeGreaterThan(R.params.joltSpill);
  expect((l0 - s.load) / SC).toBeGreaterThan(0.1);
});

it('멈춘 뒤에 바꾸면 선회를 몇 번 돌려도 흙이 그대로다', () => {
  const s = laden();
  const l0 = s.load;
  for (const inp of [{ lx: 1 }, { lx: -1 }, { lx: 1 }, { lx: -1 }] as const) {
    go(s, inp, 40);
    settle(s, 'swing');
  }
  expect((l0 - s.load) / SC).toBeLessThan(0.01);
});

it('고봉으로 담은 채 붐을 내리면 덜컹과 무관하게 흙이 흐른다', () => {
  // 입구가 기울어 버티지 못하는 것(session.pour)이고, 충격 때문이 아니다.
  // 배우기 1단계가 붐을 다루지 않고 선회만 다루는 이유 — 붐은 버킷을 같이
  // 오므려 입구를 세워야 하므로 동시조작(3단계) 내용이다.
  const s = laden();
  let mx = go(s, { ry: -1 }, 40); // 먼저 올린다 (올릴 때는 흐르지 않는다)
  settle(s, 'boom');
  const l0 = s.load;
  expect(l0 / SC).toBeCloseTo(1.25, 3);
  mx = Math.max(mx, go(s, { ry: 1 }, 40)); // 공중에서 내린다
  settle(s, 'boom');
  expect(s.groundGap()).toBeGreaterThan(0.5); // 아직 공중 (땅에 묻혀 멈춘 게 아니다)
  expect(mx).toBeLessThan(R.params.joltWarn); // 덜컹은 없다
  expect((l0 - s.load) / SC).toBeGreaterThan(0.05); // 그런데 흙은 흐른다
});
