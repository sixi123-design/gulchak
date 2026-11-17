import { expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { LESSONS, Tutor } from '../src/sim/tutorial';
import { BASIC_LESSONS } from '../src/sim/leverSchool';

const R = rules as unknown as RulesFile;

function sess() {
  const s = new DigSession(MACHINE, R, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  return s;
}

it('기본기: 시험 한 사이클을 동작 순서대로', () => {
  // 레버 → 퍼기 준비 → 퍼기 → 선회해 C로 → 쏟고 돌릴 자세 → 돌아오기 (돌아오면 다시 퍼기 준비)
  expect(BASIC_LESSONS.map((l) => l.id)).toEqual(['b-levers', 'b-ready', 'b-scoop', 'b-carry', 'b-dump', 'b-back']);
  expect(BASIC_LESSONS.every((l) => l.tier === '기본기')).toBe(true);
  // 모두 '왜 배우나' 카드, 시범, 끝낸 뒤 별점이 있다
  expect(BASIC_LESSONS.every((l) => l.why && l.grade)).toBe(true);
  expect(BASIC_LESSONS.every((l) => l.steps.some((st) => st.demo))).toBe(true);
  // 한 톤 배경은 폴·줄이 필요 없는 미션만 — 선회 미션은 B의 폴·줄을 봐야 한다
  expect(BASIC_LESSONS.filter((l) => l.flat).map((l) => l.id)).toEqual(['b-levers', 'b-ready', 'b-scoop', 'b-dump']);
});

it('겹치는 옛 미션이 없다: 마무리는 깊어진 구덩이·평탄 둘만', () => {
  expect(LESSONS.map((l) => l.id)).toEqual(['deepScoop', 'flatten']);
  expect(LESSONS.every((l) => l.tier === '마무리')).toBe(true);
  const all = [...BASIC_LESSONS, ...LESSONS];
  // 목록에서 구별되게: id·제목이 겹치지 않는다
  for (const k of ['id', 'title'] as const) {
    const v = all.map((l) => l[k]);
    expect(new Set(v).size, k).toBe(v.length);
  }
});

it('모든 미션의 시작 자세가 가동범위 안', () => {
  const lim = MACHINE.limits;
  for (const L of [...BASIC_LESSONS, ...LESSONS]) {
    const t = new Tutor(L, sess());
    const p = t.s.pose;
    for (const j of ['boom', 'arm', 'bucket'] as const) {
      expect(p[j], `${L.id} ${j}`).toBeGreaterThanOrEqual(lim[j][0] - 1e-6);
      expect(p[j], `${L.id} ${j}`).toBeLessThanOrEqual(lim[j][1] + 1e-6);
    }
    expect(t.s.groundGap(), `${L.id} gap`).toBeGreaterThan(0);
  }
});
