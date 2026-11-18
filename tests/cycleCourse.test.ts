import { expect, it } from 'vitest';
import { frame, tutorFor } from './harness';
import { CYCLE_LESSON, prepCoach } from '../src/sim/cycleCourse';
import { DIG_COURSE } from '../src/sim/leverSchool';
import { MOVE, readyPose } from '../src/sim/moveCourse';
import { fill, type Tutor } from '../src/sim/tutorial';

const deg = Math.PI / 180;

/** 목표 선회각까지: 끝까지 밀다가 미끄러질 만큼 앞에서 놓는다 */
function swingTo(t: Tutor, to: number) {
  const dir = Math.sign(to - t.s.pose.swing);
  const coast = () => {
    const wf = Math.min(1, t.s.load / t.s.heapedCap);
    return (Math.abs(t.s.vel.swing) / deg) * (25 / 60 / 4 + t.s.params.swingTauDown * (1 + t.s.params.loadSwingInertia * wf));
  };
  const from = t.step;
  for (let i = 0; i < 900 && (to - t.s.pose.swing) * dir / deg > coast(); i++) frame(t, { lx: dir });
  for (let k = 1; k <= 25; k++) frame(t, { lx: dir * (1 - k / 25) });
  for (let i = 0; i < 600 && t.step === from && !t.cleared; i++) frame(t, {});
}

it('마무리 첫 미션: 한 사이클 이어서 (기본기 다음, 깊어진 구덩이·평탄 앞)', () => {
  const ids = DIG_COURSE.map((l) => l.id);
  expect(ids.indexOf('cycle')).toBe(6);
  expect(ids.slice(7, 9)).toEqual(['deepScoop', 'flatten']);
  expect(CYCLE_LESSON.why && CYCLE_LESSON.grade).toBeTruthy();
});

/** A에서 붐 내리고 버킷 펴 퍼기 준비 자세 */
function prepare(t: Tutor) {
  for (let i = 0; i < 1500 && !t.cleared; i++) {
    const b = t.s.pose.bucket / deg;
    frame(t, { ry: t.s.groundGap() > 0.6 ? 0.6 : 0, rx: b < -10 ? 0.7 : b > 10 ? -0.5 : 0 });
  }
}

/** 붐 내려 땅 가까이 → 버킷 펴 쏟기 → 오므리며 붐 올려 선회 자세 (손 자리) */
function dumpAndCurl(t: Tutor) {
  const from = t.step;
  for (let i = 0; i < 600 && t.s.groundGap() > 1.5; i++) frame(t, { ry: 0.7 });
  for (let i = 0; i < 900 && t.s.load > MOVE.empty * t.s.m.struckCapacity * 0.5; i++) frame(t, { rx: 0.8 });
  for (let i = 0; i < 900 && t.step === from; i++) frame(t, { rx: -0.8, ry: -0.8 });
  for (let i = 0; i < 120 && t.step === from; i++) frame(t, {});
  return t.step > from;
}

it('담고 → C에 서고 → 쏟고 선회 자세 → A에 서면 끝, 실격 없음, 걸린 시간으로 별', () => {
  const t = tutorFor(CYCLE_LESSON);
  const ids: string[] = [];
  t.s.onViolation((v) => ids.push(v.id));
  // 1) 퍼서 선회 자세 (퍼기는 흙 퍼기 미션에서 따로 시험한다 — 여기서는 결과 자세로)
  t.s.teleport({ ...readyPose(), bucket: -(MOVE.curl + 2) * deg });
  fill(t.s, 1.1);
  frame(t, {});
  expect(t.step, '선회 자세가 되면 다음').toBe(1);
  // 2) C로
  swingTo(t, 0);
  expect(t.step, 'C에 서면 다음').toBe(2);
  // 3) 실제로 쏟고 다시 선회 자세: 붐 내려 땅 가까이 → 버킷 펴 쏟기 → 오므리며 붐 올리기
  expect(dumpAndCurl(t), '쏟고 선회 자세면 다음').toBe(true);
  expect(t.step).toBe(3);
  // 4) A로, 그다음 붐 내리고 버킷 펴 퍼기 준비 자세 (그때 시간이 멈춘다)
  swingTo(t, Math.PI);
  expect(t.cleared, 'A에 섰다고 끝나지 않는다').toBe(false);
  prepare(t);
  expect(t.cleared).toBe(true);
  expect(ids.filter((x) => x.startsWith('D-'))).toEqual([]);
  // 순간이동으로 줄인 사이클이라 빠르다 → 별 3
  const g = CYCLE_LESSON.grade!(t.s, t.bag);
  expect(g.stars).toBe(3);
  expect(g.note).toMatch(/초/);
});

it('느리면 별이 줄고 무엇을 겹칠지 알려 준다', () => {
  expect(CYCLE_LESSON.grade!(null as never, { sec: 52 }).stars).toBe(2);
  expect(CYCLE_LESSON.grade!(null as never, { sec: 80 }).stars).toBe(1);
  expect(CYCLE_LESSON.grade!(null as never, { sec: 52 }).note).toContain('돌아오며 붐 내리기');
});

it('C를 벗어나 쏟으면 넘어가지 않고, 다 쏟았으면 처음(퍼기)으로 — 막다른 길 없음', () => {
  const t = tutorFor(CYCLE_LESSON);
  t.s.teleport({ ...readyPose(), bucket: -(MOVE.curl + 2) * deg });
  fill(t.s, 1.1);
  frame(t, {});
  swingTo(t, 0);
  expect(t.step).toBe(2);
  // C에서 30° 비켜서 쏟는다
  for (let i = 0; i < 300 && t.s.pose.swing < 30 * deg; i++) frame(t, { lx: 0.6 });
  for (let i = 0; i < 300; i++) frame(t, {});
  // 아직 실었으면 C 위로 돌아오라고 한다
  frame(t, {});
  expect(t.coach?.msg).toContain('구덩이 위로');
  dumpAndCurl(t);
  expect(t.step, 'C 밖에서 쏟으면 다음(A로)으로 안 넘어가고 처음으로').toBe(0);
  expect(t.notice).toContain('다시 퍼 오기');
});

it('45.4초는 별 3이 아니다 (반올림 전 시간으로)', () => {
  expect(CYCLE_LESSON.grade!(null as never, { sec: 45.4 }).stars).toBe(2);
  expect(CYCLE_LESSON.grade!(null as never, { sec: 60.4 }).stars).toBe(1);
});

it('C로 가다 흙을 쏟아 버리면 처음(퍼기)으로 — 막다른 길 없음', () => {
  const t = tutorFor(CYCLE_LESSON);
  t.s.teleport({ ...readyPose(), bucket: -(MOVE.curl + 2) * deg });
  fill(t.s, 1.1);
  frame(t, {});
  expect(t.step).toBe(1);
  // 버킷을 펴서 쏟아 버린다
  for (let i = 0; i < 600 && t.step === 1; i++) frame(t, { rx: 1 });
  expect(t.step).toBe(0);
  expect(t.notice).toContain('다시 퍼 오기');
});

it('겹치기: C에서 다 쏟고 오므리며 붐 올리다 바로 선회해도 처음으로 안 돌아간다', () => {
  const t = tutorFor(CYCLE_LESSON);
  t.s.teleport({ ...readyPose(), bucket: -(MOVE.curl + 2) * deg });
  fill(t.s, 1.1);
  frame(t, {});
  swingTo(t, 0);
  expect(t.step).toBe(2);
  // C에서 쏟기
  for (let i = 0; i < 600 && t.s.groundGap() > 1.5; i++) frame(t, { ry: 0.7 });
  for (let i = 0; i < 900 && t.s.load > 0.1 * t.s.m.struckCapacity; i++) frame(t, { rx: 0.8 });
  // 오므리며 붐 올리면서 바로 A 쪽 선회 (선회 자세가 되기 전에 C를 벗어난다)
  for (let i = 0; i < 900 && t.step === 2; i++) frame(t, { rx: -0.8, ry: -0.8, lx: 0.5 });
  expect(t.step, '처음으로 되돌아가지 않고 다음으로').toBe(3);
  expect(t.notice ?? '').not.toContain('C 밖');
});

it('A에서 자세 안내는 모자란 쪽으로 (경우마다)', () => {
  const at = (gap: number, bucketDeg: number) =>
    prepCoach({ groundGap: () => gap, pose: { swing: Math.PI, boom: 0, arm: 0, bucket: bucketDeg * deg } } as never).labels;
  expect(at(-0.1, 0)).toEqual(['붐 올림']); // 땅에 닿음
  expect(at(0, 45)).toEqual(['붐 올림']);
  expect(at(1.5, 0)).toEqual(['붐 내림']); // 높음
  expect(at(0.5, -60)).toEqual(['버킷 펴기']); // 덜 펴짐
  expect(at(0.5, 45)).toEqual(['버킷 오므림']); // 지나치게 펴짐
});
