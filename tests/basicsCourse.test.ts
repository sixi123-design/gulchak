import { expect, it } from 'vitest';
import { frame, tutorFor } from './harness';
import { BASICS_LESSONS, CHECK_LESSON, PARTS_LESSON, RULES_LESSON } from '../src/sim/basicsCourse';
import { DIG_COURSE } from '../src/sim/leverSchool';
import { TIERS, type Tutor } from '../src/sim/tutorial';

/** 문제를 다 푼다: right면 정답, 아니면 첫 오답 */
function solve(t: Tutor, right = true) {
  for (let i = 0; i < 5000 && !t.cleared; i++) {
    const q = t.current?.quiz;
    if (q) {
      t.answer(right ? q.answer : (q.answer + 1) % q.options.length);
      t.nextQuiz();
    } else frame(t, {});
  }
}

it('기초교육은 번외 칸(맨 끝), 넷 다 왜 카드·별점', () => {
  expect(TIERS[TIERS.length - 1].key).toBe('기초교육');
  expect(DIG_COURSE.slice(-4).map((l) => l.id)).toEqual(['k-check', 'k-parts', 'k-rules', 'k-care']);
  for (const L of BASICS_LESSONS) {
    expect(L.tier).toBe('기초교육');
    expect(L.why && L.grade, L.id).toBeTruthy();
    // 문제마다 정답이 보기 안에 있고 풀이가 있다
    for (const st of L.steps) if (st.quiz) {
      expect(st.quiz.answer).toBeGreaterThanOrEqual(0);
      expect(st.quiz.answer).toBeLessThan(st.quiz.options.length);
      expect(st.quiz.explain.length).toBeGreaterThan(5);
    }
  }
});

it('고르기: 한 번만 답하고, 틀리면 풀이를 보고 넘어간다 (막히지 않음), 틀린 수로 별', () => {
  const t = tutorFor(RULES_LESSON);
  const q = t.current!.quiz!;
  expect(t.answer((q.answer + 1) % q.options.length)).toBe(false);
  expect(t.answer(q.answer), '두 번 답할 수 없다').toBe(null);
  t.nextQuiz();
  expect(t.step).toBe(1);
  solve(t, true);
  expect(t.cleared).toBe(true);
  expect(RULES_LESSON.grade!(t.s, t.bag).stars).toBe(2);
  const all = tutorFor(RULES_LESSON);
  solve(all, true);
  expect(RULES_LESSON.grade!(all.s, all.bag).stars).toBe(3);
  const none = tutorFor(RULES_LESSON);
  solve(none, false);
  expect(RULES_LESSON.grade!(none.s, none.bag).stars).toBe(1);
});

it('시작 점검: 벨트 → 레버 → RPM → 손 들기 순으로 넘어가고, 잠겨 있으면 장비가 안 움직인다', () => {
  const t = tutorFor(CHECK_LESSON);
  expect(t.s.belt).toBe(false);
  expect(t.s.leverUnlocked).toBe(false);
  const b0 = t.s.pose.boom;
  for (let i = 0; i < 60; i++) frame(t, { ry: -1 });
  expect(t.s.pose.boom, '안전레버가 잠겨 있으면 안 움직인다').toBeCloseTo(b0, 5);
  t.s.belt = true;
  frame(t, {});
  expect(t.step).toBe(1);
  t.s.leverUnlocked = true;
  frame(t, {});
  expect(t.step).toBe(2);
  t.s.rpm = 0.8;
  frame(t, {});
  expect(t.step).toBe(3);
  t.s.signaled = true;
  frame(t, {});
  expect(t.current?.quiz).toBeTruthy();
  solve(t);
  expect(t.cleared).toBe(true);
});

it('장비 부위: 시범으로 그 부위만 움직인다', () => {
  const t = tutorFor(PARTS_LESSON);
  const p0 = { ...t.s.pose };
  for (let i = 0; i < 70; i++) frame(t, {});
  // 첫 시범은 붐
  expect(Math.abs(t.s.pose.boom - p0.boom)).toBeGreaterThan(0.05);
  expect(Math.abs(t.s.pose.arm - p0.arm)).toBeLessThan(0.01);
  expect(Math.abs(t.s.pose.swing - p0.swing)).toBeLessThan(0.01);
  solve(t);
  expect(t.cleared).toBe(true);
});

it('보기 순서를 섞어 정답 자리가 한쪽으로 몰리지 않는다, 결과는 n/m 정답', () => {
  for (const L of BASICS_LESSONS) {
    const pos = L.steps.filter((st) => st.quiz).map((st) => st.quiz!.answer);
    if (pos.length < 3) continue;
    const most = Math.max(...pos.map((p) => pos.filter((x) => x === p).length));
    expect(most / pos.length, `${L.id} 정답 자리 ${pos.join(',')}`).toBeLessThanOrEqual(0.7);
  }
  const t = tutorFor(RULES_LESSON);
  solve(t, true);
  expect(RULES_LESSON.grade!(t.s, t.bag).note).toMatch(/^9\/9 정답/);
});

it('마무리 미션 별점: 경고 없으면 별 3, 많이 받은 경고에 맞춘 한 줄', async () => {
  const { LESSONS } = await import('../src/sim/tutorial');
  const g = (ids: string[]) =>
    LESSONS[0].grade!({ engine: { violations: ids.map((id) => ({ id, kind: id.startsWith('W') ? 'warning' : 'disqualify' })) } } as never, {});
  expect(g([]).stars).toBe(3);
  expect(g(['W-LIFT', 'W-LIFT']).stars).toBe(2);
  expect(g(['W-LIFT', 'W-LIFT']).note).toContain('이빨이 안 보일 만큼만');
  expect(g(['W-JOLT', 'W-JOLT', 'W-OVERLOAD']).stars).toBe(1);
  expect(LESSONS.every((l) => l.grade)).toBe(true);
});

it('문제를 푸는 동안 레버를 밀어도 장비가 안 움직인다', () => {
  const t = tutorFor(RULES_LESSON);
  const p0 = { ...t.s.pose };
  for (let i = 0; i < 60; i++) frame(t, { lx: 1, ly: 1, rx: 1, ry: 1 });
  expect(t.s.pose.boom).toBeCloseTo(p0.boom, 6);
  expect(t.s.pose.swing).toBeCloseTo(p0.swing, 6);
});
