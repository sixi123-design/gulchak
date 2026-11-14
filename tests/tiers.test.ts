import { expect, it } from 'vitest';
import { LESSONS, TIERS, tierProgress, type Lesson } from '../src/sim/tutorial';

it('기본기가 첫 칸이고 가로 전체', () => {
  expect(TIERS[0].key).toBe('기본기');
  expect(TIERS[0].wide).toBe(true);
});

it('칸 순서는 기본기 · 기초 · 숙련', () => {
  expect(TIERS.map((t) => t.key)).toEqual(['기본기', '기초', '숙련']);
});

it('칸마다 부제가 있다', () => {
  for (const t of TIERS) expect(t.sub.length).toBeGreaterThan(0);
});

it('모든 미션의 tier는 TIERS 안에 있다', () => {
  const keys = TIERS.map((t) => t.key);
  for (const l of LESSONS) if (l.tier) expect(keys).toContain(l.tier);
});

const mk = (id: string, tier: Lesson['tier']): Lesson => ({ id, tier, icon: 'stLevers', title: id, setup: () => {}, steps: [] });

it('진행도를 센다', () => {
  const ls = [mk('a', '기초'), mk('b', '기초'), mk('c', '숙련')];
  expect(tierProgress(ls, new Set(['a']), '기초')).toEqual({ n: 1, of: 2 });
  expect(tierProgress(ls, new Set(['a']), '숙련')).toEqual({ n: 0, of: 1 });
});

it('미션이 없는 칸은 of가 0 (0으로 나누지 않도록 화면이 건너뛴다)', () => {
  expect(tierProgress([mk('a', '기초')], new Set(), '기본기')).toEqual({ n: 0, of: 0 });
});

it('옛 진행도(기존 id만)여도 숫자가 깨지지 않는다', () => {
  // exc-tut에 기존 7개 id만 든 사용자
  const done = new Set(['levers', 'scoop', 'carryDump']);
  for (const t of TIERS) {
    const p = tierProgress(LESSONS, done, t.key);
    expect(Number.isFinite(p.n)).toBe(true);
    expect(Number.isFinite(p.of)).toBe(true);
    expect(p.n).toBeLessThanOrEqual(p.of);
  }
});

it('목록에 없는 id가 저장돼 있어도 세지 않는다', () => {
  const ls = [mk('a', '기초')];
  expect(tierProgress(ls, new Set(['a', '사라진미션']), '기초')).toEqual({ n: 1, of: 1 });
});
