import { describe, expect, it } from 'vitest';
import { BASIC_LESSONS } from '../src/sim/leverSchool';
import { ease, frame, tutorFor, until, type Hand } from './harness';
import { ARC, clearCoach, clearsB, MOVE, READY_ARM, READY_GOAL, readyResult, still, swingPose, wantAngle } from '../src/sim/moveCourse';
import { SCOOP_LESSON, swingReady } from '../src/sim/digCourse';
import { bucketLow, ropeClear, SC, type Tutor } from '../src/sim/tutorial';
import type { DigSession } from '../src/sim/session';

/**
 * 결과 자세로 판정한다 (아스트라 합격 기준, 2026-11-17).
 * 통과는 결과 자세 + 정지만, 레버를 굴린 과정은 별점으로만. 어떤 자세에서든 안내를 따르면 도착한다.
 */
const deg = Math.PI / 180;
const lesson = (id: string) => BASIC_LESSONS.find((l) => l.id === id)!;
const ready = () => {
  const t = tutorFor(lesson('b-ready'));
  t.skipDemo();
  return t;
};
const dump = () => {
  const t = tutorFor(lesson('b-dump'));
  t.skipDemo();
  return t;
};
/** 코치가 깜빡이는 레버 이름 → 손 자리 (사람이 안내를 그대로 따른다) */
const LEVER: Record<string, Hand> = {
  '붐 올림': { ry: -0.35 },
  '붐 내림': { ry: 0.35 },
  '버킷 펴기': { rx: 0.35 },
  '버킷 오므림': { rx: -0.35 },
  '암 펴기': { ly: 0.35 },
  '암 당기기': { ly: -0.35 },
};
const byCoach = (t: Tutor): Hand => Object.assign({}, ...(t.coach?.labels ?? []).map((l) => LEVER[l] ?? {}));
/** 안내만 따라 n프레임 */
const followCoach = (t: Tutor, n = 900) => {
  for (let i = 0; i < n && !t.cleared; i++) frame(t, byCoach(t));
  return t.cleared;
};
const ARC_STEP = () => lesson('b-ready').steps.findIndex((st) => st.text.startsWith('오른쪽 레버만'));
/** 노란 점을 따라가는 오른손 (12시 → 3시) */
const dot = (t: Tutor): Hand => {
  const a = wantAngle(t.s) * deg;
  return { rx: Math.cos(a) * ARC.ring, ry: Math.sin(a) * ARC.ring };
};
/** 값이 붐 각에 따라 늘어나는 f(boom)=target 인 붐 각 (도) — 이분법 */
const boomWhere = (s: DigSession, f: () => number, target: number, pose: { swing: number; bucket: number }) => {
  let lo = -20;
  let hi = 65;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    s.teleport({ swing: pose.swing, boom: mid * deg, arm: READY_ARM * deg, bucket: pose.bucket * deg });
    if (f() < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};
const goal = (s: DigSession, gap = 0.55, bucket = 0) => {
  const b = boomWhere(s, () => s.groundGap(), gap, { swing: Math.PI, bucket });
  s.teleport({ swing: Math.PI, boom: b * deg, arm: READY_ARM * deg, bucket: bucket * deg });
};
/** 줄 위 dy(m)에 버킷 최저점이 오는 붐 (선회 C쪽) */
const atRope = (s: DigSession, dy: number, bucket: number) => {
  const b = boomWhere(s, () => bucketLow(s) - ropeClear(s), dy, { swing: 0, bucket });
  s.teleport({ swing: 0, boom: b * deg, arm: READY_ARM * deg, bucket: bucket * deg });
};

describe('퍼기 준비: 결과 자세로 판정', () => {
  it('D1 ready_wrong_order_right_pose_passes — 붐 먼저 내리고 나중에 버킷을 펴도 통과 (별은 3개 미만)', () => {
    const t = ready();
    for (let i = 0; i < 900 && t.s.groundGap() > 0.6; i++) frame(t, { ry: 0.5 }); // 붐만
    ease(t, { ry: 0.5 }, 20);
    for (let i = 0; i < 900 && t.s.pose.bucket < -2 * deg; i++) frame(t, { rx: 0.4 }); // 버킷만
    ease(t, { rx: 0.4 }, 20);
    expect(followCoach(t), '맞는 자세인데 통과 못 함').toBe(true);
    expect(lesson('b-ready').grade!(t.s, t.bag).stars).toBeLessThan(3);
  });
  it('D2 ready_right_motion_wrong_pose_fails — 노란 점대로 12→3시로 굴리다 버킷 −12°에서 놓으면 통과 못 한다', () => {
    const t = ready();
    for (let i = 0; i < 1500 && t.s.pose.bucket < -12 * deg; i++) frame(t, dot(t));
    expect(t.s.pose.bucket / deg).toBeLessThan(-8);
    for (let i = 0; i < 300; i++) frame(t, {}); // 바로 놓는다
    expect(readyResult(t.s), `버킷 ${(t.s.pose.bucket / deg).toFixed(1)}°`).toBe(false);
    expect(t.cleared).toBe(false);
    expect(t.coach?.msg ?? '').toMatch(/펴기|올리기|내리기/);
  });
  it('D2 ready_right_motion_wrong_pose_fails — 일직선이어도 0.85m 높이에서 서면 통과 못 한다', () => {
    const t = ready();
    goal(t.s, 0.85);
    for (let i = 0; i < 300; i++) frame(t, {});
    expect(t.cleared).toBe(false);
    expect(t.coach?.msg ?? '').toMatch(/붐 조금 내리기/);
  });
  it('D3 ready_boundary — 버킷 ±8°, 높이 0.35/0.75m 경계', () => {
    const t = ready();
    const s = t.s;
    for (const [b, ok] of [[7.99, true], [-7.99, true], [8.01, false], [-8.01, false]] as const) {
      goal(s, 0.55, b);
      expect(readyResult(s), `버킷 ${b}°`).toBe(ok);
    }
    const G = READY_GOAL;
    for (const [g, ok] of [[G.gapLo + 0.005, true], [G.gapLo - 0.005, false], [G.gapHi - 0.005, true], [G.gapHi + 0.005, false]] as const) {
      goal(s, g);
      expect(readyResult(s), `높이 ${g}m`).toBe(ok);
    }
  });
  it('D3 ready_release — 레버 0.12까지는 놓은 것, 0.13은 잡은 것', () => {
    const t = ready();
    goal(t.s);
    for (let i = 0; i < 120 && !t.cleared; i++) frame(t, { rx: 0.12 });
    expect(t.cleared, '0.12면 놓은 것').toBe(true);
    const u = ready();
    goal(u.s);
    for (let i = 0; i < 200; i++) frame(u, { rx: 0.13 });
    expect(u.cleared, '0.13이면 아직 잡고 있다').toBe(false);
  });
  it('D3 ready_speed — 최고 속도 2% 미만이어야 선 것', () => {
    const t = ready();
    const s = t.s;
    for (const j of ['boom', 'arm', 'bucket', 'swing'] as const) {
      s.vel = { swing: 0, boom: 0, arm: 0, bucket: 0 };
      s.vel[j] = 0.0199 * s.m.speeds[j];
      expect(still(s), `${j} 1.99%`).toBe(true);
      s.vel[j] = 0.0201 * s.m.speeds[j];
      expect(still(s), `${j} 2.01%`).toBe(false);
    }
  });
  it('D3 ready_hold — 결과 자세에서 놓고 선 뒤 15프레임을 채워야 끝난다', () => {
    const t = ready();
    goal(t.s);
    let n = 0;
    const arc = t.step;
    while (t.step === arc && n < 30) frame(t, {}), n++;
    expect(t.step).toBeGreaterThan(arc);
    for (let i = 0; i < 14; i++) frame(t, {});
    expect(t.cleared, '14프레임에 끝났다').toBe(false);
    for (let i = 0; i < 2 && !t.cleared; i++) frame(t, {});
    expect(t.cleared, '15프레임을 채웠는데 안 끝났다').toBe(true);
  });
  for (const [name, bucket, boom] of [
    ['덜 펴짐·높음', -40, 35],
    ['너무 펴짐·높음', 25, 35],
    ['덜 펴짐·낮음', -40, 12],
    ['너무 펴짐·낮음', 25, 12],
    ['이미 목표', 0, 16.5],
  ] as const)
    it(`D4 ready_guidance_recovers — ${name}: 안내만 따르면 900프레임 안에 끝난다`, () => {
      const t = ready();
      t.s.teleport({ swing: Math.PI, boom: boom * deg, arm: READY_ARM * deg, bucket: bucket * deg });
      frame(t, {});
      if (name === '이미 목표') expect(t.coach?.msg ?? t.hud() ?? '').toMatch(/놓고 멈추기|멈추는 중|가운데로/);
      expect(followCoach(t, 900), `${name}: 안내를 따라도 못 끝남 — ${t.coach?.msg}`).toBe(true);
    });
  it('D5 ready_demo_matches_judge — 시범 마지막 15프레임이 결과 자세 + 정지, 판정 위반 없음', () => {
    const t = tutorFor(lesson('b-ready'));
    const ids: string[] = [];
    t.s.onViolation((v) => ids.push(v.id));
    const tail: boolean[] = [];
    let msg = '';
    for (let i = 0; i < 5000 && !t.current?.text.startsWith('한 번에 꺾으면'); i++) {
      if (t.current?.text.startsWith('일직선이면')) {
        tail.push(readyResult(t.s) && still(t.s));
        msg = `버킷 ${(t.s.pose.bucket / deg).toFixed(1)}° 높이 ${t.s.groundGap().toFixed(2)}m`;
      }
      frame(t, {});
    }
    expect(tail.length).toBeGreaterThanOrEqual(15);
    expect(tail.slice(-15).every(Boolean), msg).toBe(true);
    expect(ids).toEqual([]);
  });
  it('실습 첫 단계에 있어도 맞는 자세면 바로 멈추기로 넘어간다 (처음부터 하라고 하지 않는다)', () => {
    const t = ready();
    expect(t.step).toBe(ARC_STEP());
    goal(t.s);
    for (let i = 0; i < 10; i++) frame(t, {});
    expect(t.step).toBeGreaterThan(ARC_STEP());
    expect(t.hud() ?? '').not.toMatch(/12시/);
  });
});

describe('쏟고 돌릴 자세: 땅 가까이 쏟고, 다 접어 선회 자세', () => {
  it('D6 dump_demo_empties_near_ground_and_fully_curls — 쏟는 동안 0.1~0.8m, 마지막 15프레임 선회 자세로 정지', () => {
    const t = tutorFor(lesson('b-dump'));
    const ids: string[] = [];
    t.s.onViolation((v) => ids.push(v.id));
    let lo = 9;
    let hi = 0;
    let prev = t.s.load;
    const tail: boolean[] = [];
    for (let i = 0; i < 4000 && !t.current?.ask; i++) {
      frame(t, {});
      // 흙이 빠지는 동안의 높이
      if (t.s.load < prev - 1e-4 && t.s.load > MOVE.empty * SC(t.s)) (lo = Math.min(lo, t.s.groundGap())), (hi = Math.max(hi, t.s.groundGap()));
      prev = t.s.load;
      if (t.current?.text.startsWith('선회 자세가 되면')) tail.push(swingPose(t.s) && still(t.s));
    }
    expect(t.current?.ask, '시범이 끝나지 않았다').toBeTruthy();
    expect(lo, '땅에 박으며 쏟았다').toBeGreaterThanOrEqual(0.1);
    expect(hi, '높이서 쏟았다').toBeLessThanOrEqual(0.8);
    expect(t.s.load, '흙을 남긴 채 들었다').toBeLessThan(0.01 * SC(t.s));
    expect(-t.s.pose.bucket / deg).toBeGreaterThanOrEqual(130);
    expect(bucketLow(t.s)).toBeGreaterThanOrEqual(ropeClear(t.s));
    expect(tail.slice(-15).length).toBe(15);
    expect(tail.slice(-15).every(Boolean)).toBe(true);
    expect(ids, '시범이 실격·주의 동작을 보여 준다').toEqual([]);
  });
  for (const [b, ok] of [[-60, false], [-129, false], [-130, true]] as const)
    it(`D7 dump_practice_requires_full_curl — 실습에서 ${b}°로 줄 위에 놓고 서면 ${ok ? '끝난다' : '안 끝난다'}`, () => {
      const t = dump();
      expect(until(t, { rx: 0.8 }, 900), '쏟기').toBe(true);
      atRope(t.s, 0.3, b);
      for (let i = 0; i < 200 && !t.cleared; i++) frame(t, {});
      expect(t.cleared).toBe(ok);
    });
  it('D8 dump_wrong_order_right_pose_passes — 버킷 먼저 다 접고 붐을 올려도 통과, 되돌려 보내지 않는다', () => {
    const t = dump();
    expect(until(t, { rx: 0.8 }, 900), '쏟기').toBe(true);
    const step = t.step;
    for (let i = 0; i < 600 && -t.s.pose.bucket / deg < 133; i++) frame(t, { rx: -0.8 });
    ease(t, { rx: -0.8 }, 20);
    for (let i = 0; i < 900 && t.step === step; i++) frame(t, { ry: -0.8 });
    expect(t.step, '붐을 올렸는데 넘어가지 않는다').toBeGreaterThan(step);
    expect(t.notice).toBeNull();
    ease(t, { ry: -0.8 });
    for (let i = 0; i < 300 && !t.cleared; i++) frame(t, {});
    expect(t.cleared).toBe(true);
    expect(lesson('b-dump').grade!(t.s, t.bag).stars).toBeLessThan(3);
  });
  it('D9 dump_height_and_stop_required — 다 접었어도 줄 아래면 안 끝나고, 안내를 따르면 끝난다', () => {
    const t = dump();
    // 레슨대로 땅 가까이 내려 쏟고
    for (let i = 0; i < 900 && t.s.groundGap() > 0.8; i++) frame(t, { ry: 0.5 });
    ease(t, { ry: 0.5 }, 20);
    until(t, { rx: 0.8 }, 900);
    for (let i = 0; i < 600 && -t.s.pose.bucket / deg < 133; i++) frame(t, { rx: -0.8 });
    ease(t, { rx: -0.8 }, 20);
    for (let i = 0; i < 200; i++) frame(t, {});
    expect(bucketLow(t.s)).toBeLessThan(ropeClear(t.s));
    expect(t.cleared).toBe(false);
    expect(t.coach?.msg ?? '').toMatch(/붐을 더 올리기/);
    // 안내대로 올리고, 줄 위면 천천히 놓는다
    for (let i = 0; i < 900 && !t.cleared; i++) {
      const h = byCoach(t);
      frame(t, h.ry ? h : {});
    }
    expect(t.cleared, `막다른 길: ${t.coach?.msg}`).toBe(true);
  });
  it('D9 dump_stop — 줄 위·다 접음이어도 레버를 잡고 있거나 움직이는 동안은 안 끝난다', () => {
    const t = dump();
    until(t, { rx: 0.8 }, 900);
    atRope(t.s, 0.4, -132);
    for (let i = 0; i < 200; i++) frame(t, { rx: -0.2 }); // 잡고만 있다 (버킷은 끝에 닿아 섰다)
    expect(t.cleared, '레버를 잡고 있다').toBe(false);
    for (let i = 0; i < 60; i++) frame(t, { ry: -0.5 }); // 붐이 움직인다
    expect(t.cleared, '움직이는 중').toBe(false);
    ease(t, { ry: -0.5 }, 30);
    for (let i = 0; i < 300 && !t.cleared; i++) frame(t, {});
    expect(t.cleared).toBe(true);
  });
});

describe('흙 퍼기 들기: 같은 선회 자세 기준', () => {
  it('D10 swingReady — 다 접음(−130°)과 줄 높이 경계', () => {
    const t = dump();
    const s = t.s;
    for (const [b, ok] of [[-60, false], [-129, false], [-130, true]] as const) {
      atRope(s, 0.3, b);
      expect(swingReady(s), `${b}°`).toBe(ok);
      expect(swingPose(s)).toBe(ok);
    }
    // 높이 경계는 버킷 기준 그대로, 그 위에 '이대로 돌면 폴·줄에 안 닿는가'가 더해졌다 (붐이 낮으면 안쪽 폴에 걸림)
    atRope(s, 0.005, -132);
    expect(bucketLow(s) >= ropeClear(s), '줄 위 +5mm').toBe(true);
    expect(swingReady(s), '줄 위 +5mm: 폴에 안 닿을 때만').toBe(clearsB(s));
    atRope(s, -0.005, -132);
    expect(swingReady(s), '줄 위 −5mm').toBe(false);
  });
  it('붐이 낮아 가운데 안쪽 폴에 걸릴 자세는 선회 자세가 아니다 — 붐을 더 올리라고 알려 준다', () => {
    const s = dump().s;
    // 버킷은 줄 위·다 접음인데 붐 40°(폴 높이 3.75m 아래로 지나감)
    s.teleport({ swing: 0, boom: 40 * deg, arm: -60 * deg, bucket: -132 * deg });
    expect(bucketLow(s)).toBeGreaterThanOrEqual(ropeClear(s) - 0.1);
    expect(clearsB(s)).toBe(false);
    expect(swingPose(s)).toBe(false);
    expect(clearCoach(s)?.labels).toContain('붐 올림');
    s.teleport({ swing: 0, boom: 50 * deg, arm: -72 * deg, bucket: -132 * deg });
    expect(clearsB(s)).toBe(true);
  });
  for (const [b, ok] of [[-129, false], [-130, true]] as const)
    it(`D10 흙 퍼기 실습 들기 단계: ${b}°로 줄 위면 ${ok ? '넘어간다' : '안 넘어간다'}`, () => {
      const t = tutorFor(SCOOP_LESSON);
      const at = SCOOP_LESSON.steps.findIndex((st) => !st.demo && st.text.startsWith('오른쪽 레버를 7시로'));
      t.step = at;
      (t as unknown as { enter(): void }).enter();
      atRope(t.s, 0.3, b);
      t.s.load = SC(t.s);
      t.bag.peak = 1;
      // 들기 단계를 넘어갔는지 (흙을 순간이동으로 넣어서 그 뒤 쏟아짐은 보지 않는다)
      let passed = false;
      for (let i = 0; i < 30; i++) frame(t, {}), (passed ||= t.step > at);
      expect(passed).toBe(ok);
    });
});

describe('별점은 지점 몇 곳에서만 (매 프레임 재지 않는다)', () => {
  it('퍼기 준비: 지점 두 곳 다 범위 안이면 3, 하나 놓치면 2, 둘 다 놓치면 1 — 지점을 안 지났으면 깎지 않는다', () => {
    const g = lesson('b-ready').grade!;
    expect(g({} as never, { cpMid: 1, cpLow: 1 }).stars).toBe(3);
    expect(g({} as never, { cpMid: 0, cpLow: 1 }).stars).toBe(2);
    expect(g({} as never, { cpMid: 1, cpLow: 0 }).stars).toBe(2);
    expect(g({} as never, { cpMid: 0, cpLow: 0 }).stars).toBe(1);
    expect(g({} as never, {}).stars).toBe(3);
    expect(g({} as never, { cpMid: 1, cpLow: 1, jolt: 1 }).stars).toBe(2);
  });
  it('쏟고 돌릴 자세: 지점 세 곳', () => {
    const g = lesson('b-dump').grade!;
    expect(g({} as never, { cpDump: 1, cpLift: 1, cpCurl: 1 }).stars).toBe(3);
    expect(g({} as never, { cpDump: 0, cpLift: 1, cpCurl: 1 }).note).toMatch(/땅 가까이/);
    expect(g({} as never, { cpDump: 1, cpLift: 0, cpCurl: 1 }).stars).toBe(2);
    expect(g({} as never, { cpDump: 0, cpLift: 0, cpCurl: 1 }).stars).toBe(1);
  });
  it('쏟기 시범대로 하면(땅 가까이 쏟고 7시로 들기) 별 3개', () => {
    const t = dump();
    for (let i = 0; i < 900 && t.s.groundGap() > 1.6; i++) frame(t, { ry: 0.6 });
    until(t, (u) => (u.s.groundGap() > 0.6 ? { ry: 0.4, rx: 0.6 } : { rx: 0.6 }), 900); // 내리며 펴서 쏟고, 땅 가까이선 펴기만
    for (let i = 0; i < 110; i++) frame(t, { rx: -0.55 }); // 9시: 버킷 오므리기 (시범과 같게)
    const lift: Hand = { rx: -0.7 * Math.cos(40 * deg), ry: -0.7 * Math.sin(40 * deg) }; // 220°
    until(t, lift, 900);
    ease(t, lift, 50);
    for (let i = 0; i < 300 && !t.cleared; i++) frame(t, {});
    expect(t.cleared).toBe(true);
    expect(lesson('b-dump').grade!(t.s, t.bag), JSON.stringify(t.bag)).toMatchObject({ stars: 3 });
  });
});
