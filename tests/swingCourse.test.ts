import { describe, expect, it } from 'vitest';
import { frame, tutorFor, type Hand } from './harness';
import { BACK_LESSON, CARRY_LESSON } from '../src/sim/swingCourse';
import type { Lesson, Tutor } from '../src/sim/tutorial';

const deg = Math.PI / 180;

/** 시범을 끝까지 본다 ('다시 볼까요?'까지) */
function watch(t: Tutor) {
  for (let i = 0; i < 3000 && !t.current?.ask; i++) frame(t, {});
  return !!t.current?.ask;
}
/** 실습으로: '다음'을 누른 것처럼 */
function practice(t: Tutor) {
  t.skipDemo();
}
/** 목표 쪽으로 손 1로 밀다가, 남은 각이 relAt 이하가 되면 n프레임에 걸쳐 놓는다. 그다음 손 놓고 기다림 */
function swingTo(t: Tutor, dir: 1 | -1, left: () => number, relAt: number, easeN = 25, after?: (t: Tutor) => Hand) {
  let i = 0;
  for (; i < 900 && left() > relAt && !t.cleared; i++) frame(t, { lx: dir });
  for (let k = 1; k <= easeN && !t.cleared; k++) frame(t, { lx: dir * (1 - k / easeN) });
  for (let k = 0; k < 900 && !t.cleared; k++) frame(t, after ? after(t) : {});
  return t.cleared;
}

const cases: [string, Lesson, number, 1 | -1][] = [
  ['선회해 C로 (흙 실음)', CARRY_LESSON, 0, -1],
  ['돌아오기 (빈 버킷)', BACK_LESSON, Math.PI, 1],
];

describe.each(cases)('%s', (_name, L, to, dir) => {
  const remain = (t: Tutor) => (Math.sign(to - t.s.pose.swing || dir) === dir ? Math.abs(to - t.s.pose.swing) / deg : -Math.abs(to - t.s.pose.swing) / deg);

  it('시범: 앞에서 놓아 목표 위에 미끄러져 서고, 판정 위반·덜컹·흘림 없음', () => {
    const t = tutorFor(L);
    const ids: string[] = [];
    t.s.onViolation((v) => ids.push(v.id));
    const l0 = t.s.load;
    expect(watch(t), '시범이 끝나지 않았다').toBe(true);
    expect(remain(t), '목표에서 멀다').toBeLessThan(6);
    expect(remain(t), '지나쳤다').toBeGreaterThan(-6);
    expect(ids.filter((x) => x !== 'W-JOLT')).toEqual([]);
    expect(t.s.jolts).toBe(0);
    expect(l0 - t.s.load).toBeLessThan(0.05 * t.s.m.struckCapacity);
  });

  it('실습: 끝까지 밀다 앞에서 놓으면 통과·별 3', () => {
    const t = tutorFor(L);
    practice(t);
    const ids: string[] = [];
    t.s.onViolation((v) => ids.push(v.id));
    // 미션 시범과 같은 계산: 지금 속도로 놓으면 미끄러질 거리만큼 앞에서 놓는다
    const coast = () => {
      const wf = Math.min(1, t.s.load / t.s.heapedCap);
      return (Math.abs(t.s.vel.swing) / deg) * (25 / 60 / 4 + t.s.params.swingTauDown * (1 + t.s.params.loadSwingInertia * wf));
    };
    expect(swingTo(t, dir, () => remain(t) - coast(), 0)).toBe(true);
    expect(ids).toEqual([]);
    expect(L.grade!(t.s, t.bag).stars, JSON.stringify(t.bag)).toBe(3);
  });

  it('실습: 목표에 닿고서야 놓으면 지나치지만, 안내대로 살살 돌아오면 통과 (별 2 이하)', () => {
    const t = tutorFor(L);
    practice(t);
    // 지나친 뒤에는 안내 라벨대로 살살 (손 0.5)
    const back = (t: Tutor): Hand => (t.coach?.labels.includes(dir > 0 ? '선회 ◀' : '▶ 선회') ? { lx: -dir * 0.5 } : {});
    expect(swingTo(t, dir, () => remain(t), 0, 10, back)).toBe(true);
    expect(L.grade!(t.s, t.bag).stars).toBeLessThanOrEqual(2);
  });

  it('실습: 반대로 확 꺾어 세우면 덜컹 — 통과는 하되 별 2 이하', () => {
    const t = tutorFor(L);
    practice(t);
    for (let i = 0; i < 900 && remain(t) > 8; i++) frame(t, { lx: dir });
    for (let i = 0; i < 12; i++) frame(t, { lx: -dir });
    for (let i = 0; i < 900 && !t.cleared; i++) {
      // 남은 만큼 살살
      const r = remain(t);
      frame(t, Math.abs(r) > 4 && Math.abs(t.s.vel.swing) < 0.05 ? { lx: Math.sign(r) * dir * 0.5 } : {});
    }
    expect(t.cleared).toBe(true);
    expect(L.grade!(t.s, t.bag).stars).toBeLessThanOrEqual(2);
  });


  it('실습: 아주 천천히(손 0.3) 다가가 목표 전에 놓으면 정확히 서서 별 3 (놓은 자리 상관없이)', () => {
    const t = tutorFor(L);
    practice(t);
    for (let i = 0; i < 20000 && remain(t) > 2 && !t.cleared; i++) frame(t, { lx: dir * 0.3 });
    for (let i = 0; i < 900 && !t.cleared; i++) frame(t, {});
    expect(t.cleared).toBe(true);
    expect(t.bag.over).toBeUndefined();
    expect(L.grade!(t.s, t.bag).stars).toBe(3);
  });
});
