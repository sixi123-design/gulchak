import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile, type Sticks } from '../src/sim/session';
import { LESSONS, Tutor } from '../src/sim/tutorial';

/**
 * 튜토리얼대로 하되 타이밍이 어긋나거나 중간에 다른 동작이 끼어도
 * 화면 안내(coach)를 따르면 막다른 길 없이 끝까지 갈 수 있는가.
 */
const deg = Math.PI / 180;
const mk = (autoEnd = false) => {
  const s = new DigSession(MACHINE, rules as unknown as RulesFile, { ...MODES.tutorial, autoEnd }, () => 0.5);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 0.8;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  return s;
};
const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
/** 화면 라벨 → 레버 축 */
const AXIS: Record<string, [keyof Sticks, number]> = {
  '암 펴기': ['ly', 1],
  '암 당기기': ['ly', -1],
  '선회 ◀': ['lx', -1],
  '▶ 선회': ['lx', 1],
  '붐 내림': ['ry', 1],
  '붐 올림': ['ry', -1],
  '버킷 오므림': ['rx', -1],
  '버킷 펴기': ['rx', 1],
};
type Policy = (s: DigSession) => Partial<Sticks>;
const far = (s: DigSession) => Math.max(s.frame.tip.r, s.frame.heel.r, s.frame.P2.r) - s.site.stations[0].zoneOut;
const vert = (s: DigSession) => (s.frame.thK * 180) / Math.PI + 90;
const skim = (dir: 1 | -1) => (s: DigSession) => {
  const g = s.groundGap();
  return g > 0.05 ? { ry: 0.5, ly: 0.3 * dir } : g < -0.08 ? { ly: dir, ry: -0.6 } : { ly: dir };
};
/** 단계별 기본 조작 (정석) */
const BASE: Record<string, Policy[]> = {
  deepScoop: [
    (s) => ({ ly: far(s) < -0.3 ? 0.5 : far(s) > -0.15 ? -0.4 : 0, rx: vert(s) < -12 ? 0.6 : vert(s) > 12 ? -0.6 : 0 }),
    // 붐 내림은 올림보다 빠르다(45°/s) — 꽂을 때는 살살
    (s) => ({ ry: 0.4, ly: far(s) < -0.35 ? 0.6 : 0 }),
    (s) => ({ rx: -s.pose.bucket < 40 * deg ? -0.6 : 0, ly: -0.6, ry: s.groundGap() > -0.2 ? 0.4 : s.groundGap() < -0.6 ? -0.3 : 0 }),
    (s) => ({ ry: -0.8, rx: s.fullyCurled ? 0 : -1 }),
  ],
  flatten: [
    () => ({ rx: 1 }),
    () => ({ ly: 1 }),
    skim(-1),
    () => ({ ry: -0.3, ly: -1 }),
    skim(1),
    (s) => (s.pose.bucket < s.m.limits.bucket[1] - 0.02 ? { rx: 1 } : s.groundGap() > 0.02 ? { ry: 0.5 } : {}),
  ],
};
/** 재현 가능한 난수 */
const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** 안내를 따르며 진행. noise: 가끔 멈추거나 엉뚱한 레버를 잠깐 섞음 */
function play(id: string, seed: number, noise: boolean, budget = 7200) {
  const L = lesson(id);
  let t = new Tutor(L, mk(L.autoEnd));
  const rand = rng(seed);
  let dist: Partial<Sticks> | null = null;
  let distN = 0;
  let resets = 0;
  const coached = new Set<string>();
  for (let i = 0; i < budget && !t.cleared; i++) {
    let inp: Partial<Sticks> = BASE[id][t.step](t.s);
    if (t.coach) {
      coached.add(t.coach.msg);
      inp = { ...inp };
      for (const l of t.coach.labels) {
        const [ax, sg] = AXIS[l];
        inp[ax] = 0.6 * sg;
      }
    }
    if (noise) {
      if (distN <= 0 && rand() < 1 / 80) {
        distN = 10 + Math.floor(rand() * 35);
        const k = Math.floor(rand() * 8);
        const axes: (keyof Sticks)[] = ['ly', 'ly', 'rx', 'rx', 'ry', 'ry', 'lx', 'lx'];
        dist = k === 7 ? {} : { [axes[k]]: (k % 2 ? -1 : 1) * (axes[k] === 'lx' ? 0.25 : 0.5) };
      }
      if (distN > 0) {
        distN--;
        inp = dist!;
      }
    }
    t.s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    t.s.step();
    t.update();
    if (t.wantReset) {
      resets++;
      const msg = t.notice;
      t = new Tutor(L, mk(L.autoEnd));
      t.notice = msg;
    }
  }
  return { cleared: t.cleared, step: t.step, rewinds: t.rewinds, resets, coached, load: t.s.load / t.s.m.struckCapacity };
}

describe('배우기: 어긋난 조작에도 안내 따라 끝까지 (막다른 길 없음)', () => {
  for (const id of ['deepScoop', 'flatten']) {
    it(`${id}: 정석이면 안내·되돌림 없이 완료`, () => {
      const r = play(id, 1, false);
      expect(r.cleared, JSON.stringify({ ...r, coached: [...r.coached] })).toBe(true);
      expect(r.rewinds, JSON.stringify({ ...r, coached: [...r.coached] })).toBe(0);
    });
    it(`${id}: 멈춤·엉뚱한 레버를 섞어도 안내 따라 완료 (30회)`, () => {
      const fails: unknown[] = [];
      for (let seed = 1; seed <= 30; seed++) {
        const r = play(id, seed * 7919, true);
        if (!r.cleared) fails.push({ seed, ...r, coached: [...r.coached] });
      }
      expect(fails, JSON.stringify(fails)).toEqual([]);
    });
  }
});
