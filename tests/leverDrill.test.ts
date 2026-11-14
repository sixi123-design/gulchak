import { expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { Tutor } from '../src/sim/tutorial';
import { DRILL, DRILL_START, LEVER_DRILL } from '../src/sim/leverDrill';
import { MACHINE_STYLES, TUTOR_LOOK } from '../src/render/excavatorView';

const R = rules as unknown as RulesFile;
const deg = Math.PI / 180;
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
const drill = () => new Tutor(LEVER_DRILL, sess());
/** n프레임 동안 레버를 주고 미션을 돌린다 */
function run(t: Tutor, inp: Inp, n: number) {
  for (let i = 0; i < n; i++) {
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    t.s.step();
    t.update();
  }
}
/** 지금 단계가 넘어갈 때까지 (최대 n프레임) */
function until(t: Tutor, inp: Inp, n = 900) {
  const from = t.step;
  for (let i = 0; i < n; i++) {
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    t.s.step();
    t.update();
    if (t.step !== from || t.cleared) return true;
  }
  return false;
}

it('시작 자세가 가동범위 안이고 버킷이 공중에 있다', () => {
  const t = drill();
  const lim = MACHINE.limits;
  expect(t.s.pose.boom).toBeGreaterThanOrEqual(lim.boom[0]);
  expect(t.s.pose.boom).toBeLessThanOrEqual(lim.boom[1]);
  expect(t.s.pose.arm).toBeGreaterThanOrEqual(lim.arm[0]);
  expect(t.s.pose.arm).toBeLessThanOrEqual(lim.arm[1]);
  expect(t.s.pose.bucket).toBeGreaterThanOrEqual(lim.bucket[0]);
  expect(t.s.pose.bucket).toBeLessThanOrEqual(lim.bucket[1]);
  expect(t.s.groundGap()).toBeGreaterThan(0.3);
});

it('모든 단계에 지시문과 깜빡일 레버 글자가 있다', () => {
  // 레버 글자가 없으면 어느 레버인지 알 수 없다
  for (const st of LEVER_DRILL.steps) {
    expect(st.text.length, st.text).toBeGreaterThan(0);
    expect((st.labels ?? []).length, st.text).toBeGreaterThan(0);
  }
});

it('1단계: 오른쪽 레버를 아래로 하면 붐이 올라가고 넘어간다', () => {
  const t = drill();
  const b0 = t.s.pose.boom;
  expect(until(t, { ry: -1 })).toBe(true);
  expect(t.s.pose.boom).toBeGreaterThan(b0 + DRILL.move * 0.9);
  expect(t.step).toBe(1);
});

it('1단계: 반응을 보여 준 뒤에 넘어간다', () => {
  const t = drill();
  // 붐이 충분히 올라간 순간에는 아직 단계가 그대로이고, 반응이 떠 있다
  for (let i = 0; i < 900; i++) {
    run(t, { ry: -1 }, 1);
    if (t.hud()) break;
  }
  expect(t.hud()).toBe('붐이 올라갑니다');
  expect(t.step, '잘했다는 연출을 보여 주는 동안은 넘어가지 않는다').toBe(0);
  run(t, {}, DRILL.cheer + 10);
  expect(t.step).toBe(1);
});

it('아무 레버도 안 쓰면 1단계를 통과하지 못한다', () => {
  const t = drill();
  run(t, {}, 400);
  expect(t.step).toBe(0);
});

it('2단계: 바닥에 닿을 때까지 내리면 넘어간다', () => {
  const t = drill();
  until(t, { ry: -1 });
  expect(LEVER_DRILL.steps[1].text).toMatch(/바닥에 닿을 때까지/);
  expect(until(t, { ry: 1 })).toBe(true);
  expect(t.s.groundGap()).toBeLessThan(0.1);
  expect(t.step).toBe(2);
});

it('3단계: 눌러서 차체가 들리면 실격을 알려 주고, 손을 떼면 처음 자세로 돌아온다', () => {
  const t = drill();
  until(t, { ry: -1 });
  until(t, { ry: 1 });
  expect(t.step).toBe(2);
  run(t, { ry: 1 }, 200); // 계속 누른다
  expect(t.s.lift).toBeGreaterThan(0);
  expect(t.hud() ?? '').toMatch(/차체가 들렸습니다/);
  expect(t.coach?.msg ?? '').toMatch(/실격/);
  expect(t.step).toBe(2); // 손을 떼야 넘어간다
  expect(until(t, {}, 600)).toBe(true);
  // 처음 자세로 돌아왔다
  expect(Math.abs(t.s.pose.boom - DRILL_START.boom)).toBeLessThan(2 * deg);
  expect(Math.abs(t.s.pose.arm - DRILL_START.arm)).toBeLessThan(2 * deg);
});

it('3단계: 살살 누른 사람도 막히지 않는다', () => {
  const t = drill();
  until(t, { ry: -1 });
  until(t, { ry: 1 });
  expect(until(t, {}, 900)).toBe(true); // 아예 안 누르고 기다려도 넘어간다
  expect(t.step).toBe(3);
});

it('4단계: 버킷만 펴면 넘어간다', () => {
  const t = drill();
  until(t, { ry: -1 });
  until(t, { ry: 1 });
  until(t, {}, 900);
  expect(t.step).toBe(3);
  const b0 = t.s.pose.bucket;
  expect(until(t, { rx: 1 })).toBe(true);
  expect(t.s.pose.bucket).toBeGreaterThan(b0 + DRILL.moveBucket * 0.9);
});

it('4단계: 붐을 같이 움직이면 알려 준다', () => {
  const t = drill();
  until(t, { ry: -1 });
  until(t, { ry: 1 });
  until(t, {}, 900);
  run(t, { rx: 1, ry: -1 }, 40); // 버킷과 붐을 같이
  expect(t.coach?.msg ?? '').toMatch(/붐은 그대로/);
});

it('4단계: 붐이 많이 섞이면 처음 자세로 되돌리고 같은 단계를 다시', () => {
  const t = drill();
  until(t, { ry: -1 });
  until(t, { ry: 1 });
  until(t, {}, 900);
  const at = t.step;
  run(t, { ry: -1 }, 120); // 버킷은 안 쓰고 붐만 크게
  expect(t.step).toBe(at); // 되돌리는 중이라 안 넘어간다
  expect(t.hud() ?? '').toMatch(/처음 자세/);
  run(t, {}, 200);
  expect(Math.abs(t.s.pose.boom - DRILL_START.boom)).toBeLessThan(2 * deg);
  expect(t.step).toBe(at);
  // 되돌아온 뒤에는 다시 할 수 있다
  expect(until(t, { rx: 1 })).toBe(true);
});

it('아홉 단계를 레버로 끝까지 간다', () => {
  const t = drill();
  const plan: Inp[] = [
    { ry: -1 }, // 1 붐 올림
    { ry: 1 }, // 2 바닥까지 내림
    {}, // 3 눌러 보기 (살살 — 기다리면 넘어간다)
    { rx: 1 }, // 4 버킷 펴기
    { rx: -1 }, // 5 버킷 오므리기
    { ly: -1 }, // 6 암 당기기
    { ly: 1 }, // 7 암 펴기
  ];
  for (const inp of plan) {
    if (t.cleared) break;
    expect(until(t, inp, 1200), `단계 ${t.step}: ${t.current?.text}`).toBe(true);
  }
  // 8 중간에서 멈추기: 올리다가 놓는다
  expect(t.step).toBe(7);
  run(t, { ry: -1 }, 40);
  expect(until(t, {}, 600)).toBe(true);
  expect(t.cleared).toBe(true);
});

it('끝까지 오면 별 3개 (익히는 자리라 깎지 않는다)', () => {
  const g = LEVER_DRILL.grade!({} as never, {});
  expect(g.stars).toBe(3);
  expect(g.note).toMatch(/붐|버킷|암/);
});


it('잘하면 잘했다는 신호를 올린다 (연출 재생용)', () => {
  const t = drill();
  expect(t.bag.okN ?? 0).toBe(0);
  until(t, { ry: -1 }); // 1단계 성공
  expect(t.bag.okN).toBe(1);
  expect(t.bag.badN ?? 0).toBe(0);
});

it('붐이 많이 섞이면 잘못했다는 신호를 올린다 (프레임마다 울리지 않는다)', () => {
  const t = drill();
  until(t, { ry: -1 });
  until(t, { ry: 1 });
  until(t, {}, 900); // 3단계까지 (살살)
  const bad0 = t.bag.badN ?? 0;
  run(t, { ry: -1 }, 45); // 버킷 단계인데 붐만 크게
  // 한 번의 잘못에 한 번만 (45프레임을 돌렸는데 45번 울리면 안 된다)
  expect((t.bag.badN ?? 0) - bad0).toBe(1);
  expect(t.hud() ?? '', '되돌리는 중').toMatch(/처음 자세/);
});

it('차체가 들리면 잘못했다는 신호를 올린다', () => {
  const t = drill();
  until(t, { ry: -1 });
  until(t, { ry: 1 });
  const bad0 = t.bag.badN ?? 0;
  run(t, { ry: 1 }, 200); // 계속 누른다
  expect(t.bag.badN).toBe(bad0 + 1);
});

it('배우기용 겉모습에는 검정이 없다', () => {
  // 배경이 한 색이라 검정 덩어리가 있으면 글자와 부딪힌다
  const dark = (c: number) => {
    const r = (c >> 16) & 255;
    const g = (c >> 8) & 255;
    const b = c & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b < 110;
  };
  for (const k of ['lower', 'counterweight', 'rim', 'trim'] as const) {
    expect(dark(TUTOR_LOOK[k]), `${k}=${TUTOR_LOOK[k].toString(16)}`).toBe(false);
  }
  // 상부는 A형과 같은 노랑
  expect(TUTOR_LOOK.body).toBe(MACHINE_STYLES.A.body);
});

it('시험장 기종 목록에는 배우기용이 섞이지 않는다', () => {
  expect(Object.keys(MACHINE_STYLES)).toEqual(['A', 'B', 'C']);
});
