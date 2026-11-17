import { describe, expect, it } from 'vitest';
import type { Tutor } from '../src/sim/tutorial';
import { frame, tutorFor, until, type Hand } from './harness';
import { bite, bottomAngle, farR, SCOOP, SCOOP_LESSON, swingReady, toLine } from '../src/sim/digCourse';

const tutor = () => tutorFor(SCOOP_LESSON);
const SC = (t: Tutor) => t.s.m.struckCapacity;

/** 판정 위반(실격·주의)을 모은다 */
const watch = (t: Tutor) => {
  const ids: string[] = [];
  t.s.onViolation((v) => ids.push(v.id));
  return ids;
};
const toAsk = (t: Tutor) => {
  for (let i = 0; i < 5000 && !t.current?.ask; i++) frame(t, {});
  expect(t.current?.ask, '시범이 끝나지 않았다').toBeTruthy();
};
/** 시범을 건너뛰고 실습 첫 단계 */
const practice = () => {
  const t = tutor();
  t.skipDemo();
  return t;
};
/** 정석 손: 단계마다 사람이 하는 것처럼 (놓을 때는 천천히 가운데로) */
let last: Hand = {};
const hand = (t: Tutor): Hand => {
  const txt = t.current?.text ?? '';
  if (txt.startsWith('선회 자세가 되면')) return (last = { rx: (last.rx ?? 0) * 0.93, ry: (last.ry ?? 0) * 0.93 });
  last = handOf(t, txt);
  return last;
};
const handOf = (t: Tutor, txt: string): Hand => {
  if (txt.startsWith('왼쪽 레버를 12시로')) return { ly: 0.5 };
  if (txt.startsWith('오른쪽 레버를 12시로')) return bite(t.s) < 0.2 ? { ry: 0.45 } : {};
  if (txt.startsWith('오른쪽 레버를 9시로')) return bottomAngle(t.s) > 8 ? { rx: -0.7 } : {};
  if (txt.startsWith('왼쪽 레버를 6시로')) return { ly: -0.6 };
  if (txt.startsWith('오른쪽 레버를 7시로')) return { rx: -0.5, ry: -0.75 };
  return {};
};
const playPractice = (t: Tutor, h: (t: Tutor) => Hand = hand, n = 3000) => {
  for (let i = 0; i < n && !t.cleared; i++) frame(t, h(t));
};
const upTo = (t: Tutor, head: string) => {
  for (let i = 0; i < 3000 && !t.current!.text.startsWith(head); i++) frame(t, hand(t));
  expect(t.current!.text.startsWith(head), `${head} 단계까지 못 갔다`).toBe(true);
};

describe('흙 퍼기 구분동작 시범 (정석)', () => {
  it('먼 끝 → 꽂기 → 평행하게 오므리기 → 암 당겨 담기 → 오므리며 들기 순서로, 판정 위반 없이 담아 선회 자세가 된다', () => {
    const t = tutor();
    const ids = watch(t);
    const seen: string[] = [];
    let peak = 0;
    let minLine = 9;
    for (let i = 0; i < 5000 && !t.current?.ask; i++) {
      const txt = t.current!.text.split(String.fromCharCode(10))[0];
      if (seen[seen.length - 1] !== txt) seen.push(txt);
      frame(t, t.demoState() === 'demo' ? { ry: 1, ly: 1 } : {}); // 시범 중에 레버를 건드려도 시범은 그대로
      peak = Math.max(peak, t.s.load);
      minLine = Math.min(minLine, toLine(t.s));
    }
    expect(seen).toEqual([
      '여기가 파는 자리',
      '퍼기 준비 자세에서 시작',
      '왼쪽 레버를 12시로',
      '오른쪽 레버를 12시로',
      '오른쪽 레버를 9시로',
      '오른쪽 레버를 놓고',
      '왼쪽 레버를 6시로',
      '점선 전에 오른쪽 레버 7시로',
      '선회 자세가 되면',
    ]);
    expect(ids, '시범이 실격·주의 동작을 보여 준다').toEqual([]);
    expect(minLine, '점선(가상굴착제한선) 앞에서 들어야 한다').toBeGreaterThan(SCOOP.lineMargin * 0.8);
    expect(peak / SC(t)).toBeGreaterThanOrEqual(SCOOP.fill);
    expect(t.s.load / SC(t), '들면서 흘렸다').toBeGreaterThanOrEqual(SCOOP.keep * SCOOP.fill);
    expect(swingReady(t.s)).toBe(true);
  });
  it('이빨은 꽂기 전 흙 표면에서 이빨이 안 보일 만큼(12~30cm) 들어가고, 오므리기는 바닥이 평행해지면 끝난다', () => {
    const t = tutor();
    while (!t.current!.text.startsWith('오른쪽 레버를 9시로')) frame(t, {});
    expect(bite(t.s)).toBeGreaterThanOrEqual(SCOOP.biteLo);
    expect(bite(t.s)).toBeLessThanOrEqual(SCOOP.biteHi);
    expect(t.s.frame.tip.r).toBeGreaterThan(farR(t.s) - 0.4); // 먼 끝에서 찍었다
    while (!t.current!.text.startsWith('왼쪽 레버를 6시로')) frame(t, {});
    expect(Math.abs(bottomAngle(t.s))).toBeLessThan(SCOOP.flat);
    // 암을 당기는 토막에서는 오른쪽 레버가 놓여 있다 (암만 당긴다)
    for (let i = 0; i < 30; i++) frame(t, {});
    expect(Math.abs(t.s.input.rx) + Math.abs(t.s.input.ry)).toBeLessThan(1e-6);
  });
  it('다시 보기는 구분동작 시범 첫 토막으로', () => {
    const t = tutor();
    toAsk(t);
    t.choose(true);
    expect(t.current?.text).toMatch(/퍼기 준비 자세에서 시작/);
  });
  it('실습은 시범이 판 흙을 메우고, 빈 버킷으로 퍼기 준비 자세에서 시작한다', () => {
    const t = tutor();
    const before = t.s.soil.volumeDelta();
    toAsk(t);
    expect(Math.abs(t.s.soil.volumeDelta() - before)).toBeGreaterThan(0.05); // 시범이 팠다
    t.choose(false);
    frame(t, {});
    expect(t.current?.text).toMatch(/암을 펴서 먼 끝/);
    expect(Math.abs(t.s.soil.volumeDelta() - before)).toBeLessThan(0.01);
    expect(t.s.load).toBe(0);
    expect(Math.abs(t.s.ledgerError())).toBeLessThan(1e-6);
  });
  it('시범을 두 번 보면 두 번 다 같게 흐른다', () => {
    const t = tutor();
    const run = () => {
      let n = 0;
      for (; n < 5000 && !t.current?.ask; n++) frame(t, {});
      return { n, load: t.s.load };
    };
    // 첫 시범(처음 흙을 저장)과 다시 보기(저장본으로 되돌림)가 같아야 한다
    for (let i = 0; i < 500 && t.current?.peek; i++) frame(t, {}); // '여기가 파는 자리'는 다시 보기에 없다
    const a = run();
    t.choose(true);
    const b = run();
    t.choose(true);
    const c = run();
    expect(Math.abs(b.n - c.n)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.n - b.n)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.load - b.load)).toBeLessThan(0.02 * SC(t));
  });
});

describe('흙 퍼기 실습', () => {
  it('다시 연습은 시범을 건너뛰고 실습 첫 단계(암 펴서 먼 끝)부터', () => {
    const t = tutor();
    expect(t.hasDemo).toBe(true);
    t.skipDemo();
    expect(t.current?.text).toMatch(/암을 펴서 먼 끝/);
    expect(t.demoState()).toBe('user');
  });
  it('정석대로 하면 판정 위반 없이 끝나고, 흘리지 않는다', () => {
    const t = practice();
    const ids = watch(t);
    playPractice(t);
    expect(t.cleared).toBe(true);
    expect(t.rewinds).toBe(0);
    expect(ids).toEqual([]);
    // 정석이면 별 3개를 받을 수 있다 (평적 초록 칸 · 흘리지 않음 · 덜컹 없음)
    expect(t.bag.peak).toBeGreaterThanOrEqual(SCOOP.full);
    expect(SCOOP_LESSON.grade!(t.s, t.bag).stars).toBe(3);
  });
  it('가만히 있으면 안 넘어간다', () => {
    const t = practice();
    const st = t.step;
    for (let i = 0; i < 400; i++) frame(t, {});
    expect(t.step).toBe(st);
  });
  it('너무 깊이 꽂으면 붐을 올리라고 알려 준다', () => {
    const t = practice();
    until(t, { ly: 0.5 }, 600);
    let msg = '';
    for (let i = 0; i < 600 && !msg.includes('너무 깊'); i++) {
      frame(t, { ry: 0.8 });
      msg = t.coach?.msg ?? '';
    }
    expect(msg).toMatch(/너무 깊어요/);
  });
  it('버킷만 오므려서는 덜 차고, 처음으로 되돌아간다 (막다른 길 아님) — 암을 당겨야 찬다', () => {
    const t = practice();
    const start = t.step;
    upTo(t, '왼쪽 레버를 6시로');
    for (let i = 0; i < 1500 && !t.notice; i++) frame(t, { rx: -1 }); // 암 대신 버킷만
    expect(t.s.load / SC(t)).toBeLessThan(SCOOP.fill);
    expect(t.step).toBe(start);
    expect(t.notice ?? '').toMatch(/암으로 당기/);
  });
  it('오므리지 않고 붐만 올리면 흘려서 다시 퍼기로', () => {
    const t = practice();
    const start = t.step;
    upTo(t, '오른쪽 레버를 7시로');
    for (let i = 0; i < 900 && t.step !== start; i++) frame(t, { rx: 0.5, ry: -0.8 });
    expect(t.cleared).toBe(false);
    expect(t.step).toBe(start);
    expect(t.notice ?? '').toMatch(/흘렀/);
  });
  it('되돌아오면 흙을 메우고 퍼기 준비 자세에서 다시', () => {
    const t = practice();
    const v0 = t.s.soil.volumeDelta();
    upTo(t, '오른쪽 레버를 7시로');
    expect(Math.abs(t.s.soil.volumeDelta() - v0)).toBeGreaterThan(0.05);
    for (let i = 0; i < 900 && !t.notice; i++) frame(t, { rx: 0.5, ry: -0.8 });
    frame(t, {});
    expect(Math.abs(t.s.soil.volumeDelta() - v0)).toBeLessThan(0.01);
    expect(t.s.load).toBe(0);
  });
});

describe('흙 퍼기: 점선(가상굴착제한선)', () => {
  it('다 담고 점선 앞이면 들라고 알리고 넘어간다', () => {
    const t = practice();
    upTo(t, '왼쪽 레버를 6시로');
    for (let i = 0; i < 2500 && t.current!.text.startsWith('왼쪽 레버를 6시로'); i++) frame(t, { ly: -0.6 }); // 손을 안 떼고 계속 당긴다
    expect(t.current!.text).toMatch(/7시로/);
    expect(t.s.load / SC(t)).toBeGreaterThanOrEqual(SCOOP.fill);
    expect(toLine(t.s)).toBeGreaterThan(0);
  });
  it('덜 찬 채 점선 앞에 오면 멈춰 있지 않고 처음부터 (막다른 길 아님)', () => {
    const t = practice();
    const start = t.step;
    upTo(t, '왼쪽 레버를 6시로');
    // 붐을 올리며 얕게 당겨 흙이 덜 들어오게 하고, 점선 앞에서 멈춘다
    for (let i = 0; i < 2500 && t.step === start + 3; i++) frame(t, toLine(t.s) > SCOOP.lineMargin - 0.1 ? { ly: -0.6, ry: -0.7 } : {});
    expect(t.s.load / SC(t)).toBeLessThan(SCOOP.fill);
    expect(t.step).toBe(start);
    expect(t.notice ?? '').toMatch(/덜 찼어요|점선을 넘었어요/);
  });
  it('평행보다 더 오므리면 안 넘어가고 조금 펴라고 알려 준다', () => {
    const t = practice();
    upTo(t, '오른쪽 레버를 9시로');
    let msg = '';
    for (let i = 0; i < 600 && !msg.includes('너무 오므렸'); i++) {
      frame(t, { rx: -0.7 });
      msg = t.coach?.msg ?? '';
    }
    expect(msg).toMatch(/너무 오므렸어요/);
    expect(t.current!.text).toMatch(/9시로/);
  });
  it('담는 중에 버킷으로 긁어 담으면 암만 당기라고 알려 준다', () => {
    const t = practice();
    upTo(t, '왼쪽 레버를 6시로');
    let msg = '';
    for (let i = 0; i < 600 && !msg.includes('암만 당기기'); i++) {
      frame(t, { rx: -0.7 });
      msg = t.coach?.msg ?? '';
    }
    expect(msg).toMatch(/암만 당기기/);
  });
  it('놓을 때 덜컹하면 별 2개', () => {
    expect(SCOOP_LESSON.grade!({} as never, { peak: 1.05, keep: 1.05, jolt: 1 }).stars).toBe(2);
    expect(SCOOP_LESSON.grade!({} as never, { peak: 1.05, keep: 1.05, jolt: 0 }).stars).toBe(3);
    expect(SCOOP_LESSON.grade!({} as never, { peak: 1.3, keep: 1.3 }).stars).toBe(2); // 초록 칸 넘게
  });
  it('점선 앞이면 들라고 알리고, 넘으면 시험처럼 실격이라 알린 뒤 처음부터', () => {
    const t = practice();
    const start = t.step;
    upTo(t, '왼쪽 레버를 6시로');
    // 흙을 덜 담도록 버킷을 조금 펴며 계속 당긴다 (담기 통과선 전에 점선에 닿게)
    let near = false;
    for (let i = 0; i < 2500 && t.step !== start && !t.current!.text.startsWith('오른쪽 레버를 7시로'); i++) {
      frame(t, { ly: -1, rx: 0.5 });
      if ((t.coach?.msg ?? '').includes('점선이 가까워요')) near = true;
    }
    if (t.current!.text.startsWith('오른쪽 레버를 7시로')) return; // 점선 전에 다 찼다 (정상 경로)
    expect(near, '점선 앞에서 미리 알려야 한다').toBe(true);
    expect(t.step).toBe(start);
    expect(t.notice ?? '').toMatch(/점선을 넘었어요/);
  });
});
