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

const cases: [string, Lesson, number, 1 | -1][] = [['선회해 C로 (흙 실음)', CARRY_LESSON, 0, -1]];

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

  it('실습: 목표에 닿고서야 놓으면 ⓓ선을 넘어 실격 → 성공 없이 실습 처음으로 (막다른 길 없음)', () => {
    const t = tutorFor(L);
    practice(t);
    const at = t.step;
    for (let i = 0; i < 900 && remain(t) > 0; i++) frame(t, { lx: dir });
    for (let k = 1; k <= 10; k++) frame(t, { lx: dir * (1 - k / 10) });
    for (let i = 0; i < 300 && t.rewinds === 0 && !t.cleared; i++) frame(t, {});
    expect(t.cleared).toBe(false);
    expect(t.rewinds).toBe(1);
    expect(t.step).toBe(at);
    expect(t.notice).toContain('실격');
  });
  it('실습: 조금(12° 앞) 늦게 놓아 지나쳐도 선을 안 넘으면, 살살 돌아와 통과 (별 2)', () => {
    const t = tutorFor(L);
    practice(t);
    const back = (t: Tutor): Hand => (t.coach?.labels.includes(dir > 0 ? '선회 ◀' : '▶ 선회') ? { lx: -dir * 0.5 } : {});
    expect(swingTo(t, dir, () => remain(t), 12, 10, back)).toBe(true);
    expect(t.rewinds).toBe(0);
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


describe('돌아오기: B 지나면 붐 내리고 버킷 펴며 A 중심선에 바로 팔 자세로', () => {
  const lat = (t: Tutor) => (Math.PI - t.s.pose.swing) * t.s.frame.tip.r;
  const ready = (t: Tutor) => Math.abs(t.s.pose.bucket / deg) <= 20 && t.s.groundGap() <= 1 && t.s.groundGap() > 0;
  /** 정석: 끝까지 밀고, B(110°) 지나면 오른손으로 내리며 펴고, 미끄러질 만큼 앞에서 놓기 */
  const good = (t: Tutor, overlap = true) => {
    const coast = () => (Math.abs(t.s.vel.swing) / deg) * (25 / 60 / 4 + t.s.params.swingTauDown);
    const right = (): Hand => {
      const b = t.s.pose.bucket / deg;
      return { ry: t.s.groundGap() > 0.85 ? 0.6 : 0, rx: b < -4 ? 1 : b > 6 ? -0.6 : 0 };
    };
    const hand = (lx: number): Hand => ({ lx, ...(overlap && t.s.pose.swing / deg > 110 ? right() : {}) });
    for (let i = 0; i < 900 && (Math.PI - t.s.pose.swing) / deg > coast() && !t.cleared; i++) frame(t, hand(1));
    for (let k = 1; k <= 25 && !t.cleared; k++) frame(t, hand(1 - k / 25));
    // 선 뒤: 중심선에 살살 맞추고 자세 마무리
    for (let i = 0; i < 1500 && !t.cleared; i++) {
      const d = lat(t);
      const nudge = Math.abs(d) > 0.08 && Math.abs(t.s.vel.swing) < 0.02 ? Math.sign(d) * 0.35 : 0;
      frame(t, { lx: nudge, ...(ready(t) ? {} : right()) });
    }
  };

  it('시범: B를 줄 위로 지나 A 중심선(±10cm)에 바로 팔 자세로 선다, 위반 없음', () => {
    const t = tutorFor(BACK_LESSON);
    const ids: string[] = [];
    t.s.onViolation((v) => ids.push(v.id));
    expect(watch(t)).toBe(true);
    expect(Math.abs(lat(t)), '중심선').toBeLessThan(0.1);
    expect(ready(t), '팔 자세').toBe(true);
    expect(ids.filter((x) => x.startsWith('D-'))).toEqual([]);
  });

  it('실습: 겹쳐서 돌아와 중심선에 서면 별 3', () => {
    const t = tutorFor(BACK_LESSON);
    practice(t);
    const ids: string[] = [];
    t.s.onViolation((v) => ids.push(v.id));
    good(t);
    expect(t.cleared).toBe(true);
    expect(ids.filter((x) => x.startsWith('D-'))).toEqual([]);
    expect(BACK_LESSON.grade!(t.s, t.bag).stars, JSON.stringify(t.bag)).toBe(3);
  });

  it('실습: 선 다음에야 내리면 통과는 하되 별 2 (겹치기를 짚어 준다)', () => {
    const t = tutorFor(BACK_LESSON);
    practice(t);
    good(t, false);
    expect(t.cleared).toBe(true);
    const g = BACK_LESSON.grade!(t.s, t.bag);
    expect(g.stars).toBe(2);
    expect(g.note).toContain('B를 지나면');
  });

  it('A에 높이 든 채 서면 통과가 아니고 무엇을 할지 알려 준다', () => {
    const t = tutorFor(BACK_LESSON);
    practice(t);
    const coast = () => (Math.abs(t.s.vel.swing) / deg) * (25 / 60 / 4 + t.s.params.swingTauDown);
    for (let i = 0; i < 900 && (Math.PI - t.s.pose.swing) / deg > coast(); i++) frame(t, { lx: 1 });
    for (let k = 1; k <= 25; k++) frame(t, { lx: 1 - k / 25 });
    for (let i = 0; i < 200; i++) frame(t, {});
    expect(t.cleared).toBe(false);
    expect(t.coach?.labels.join()).toMatch(/붐 내림|선회/);
  });
});

it('돌아오기: 덜 와서 줄 아래로 내려 실격이 나면 성공으로 넘어가지 않는다', () => {
  const t = tutorFor(BACK_LESSON);
  t.skipDemo();
  for (let i = 0; i < 900 && t.s.pose.swing < 172 * deg; i++) frame(t, { lx: 1 });
  for (let i = 0; i < 120; i++) frame(t, {});
  // 중심 0.4m 넘게 앞에서 땅 가까이 내린다 (지시와 다르게)
  for (let i = 0; i < 300; i++) frame(t, { ry: 1, rx: 1 });
  const dq = t.s.engine.disqualifications().length;
  // 그다음 맞추고 자세를 다듬어도
  for (let i = 0; i < 900 && !t.cleared; i++) {
    const d = (Math.PI - t.s.pose.swing) * t.s.frame.tip.r;
    frame(t, { lx: Math.abs(d) > 0.08 && Math.abs(t.s.vel.swing) < 0.02 ? Math.sign(d) * 0.35 : 0, ry: t.s.groundGap() < 0.3 ? -0.5 : 0 });
  }
  if (dq > 0) expect(t.cleared, '실격 뒤 성공').toBe(false);
});
