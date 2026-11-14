import { describe, expect, it } from 'vitest';
import { fixTip, TIP_LESSONS } from '../src/sim/fixTips';
import { LESSONS } from '../src/sim/tutorial';
import { BASIC_LESSONS } from '../src/sim/leverSchool';
import { DRIVE_LESSONS } from '../src/sim/drive/driveTutorial';

describe('결과 고칠 점 한 줄', () => {
  it('가리키는 배우기 미션이 모두 있음', () => {
    const ids = new Set([...BASIC_LESSONS, ...LESSONS, ...DRIVE_LESSONS].map((l) => l.id));
    const refs = TIP_LESSONS;
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(ids.has(r), r).toBe(true);
  });
  it('실격이 있으면 실격 이유가 먼저', () => {
    const t = fixTip('drive', [{ id: 'D-NOSTOP', title: '정지선에서 안 멈춤' }], null);
    expect(t?.lesson).toBe('d-stop');
  });
  it('실격이 없으면 가장 많이 놓친 항목', () => {
    const t = fixTip('dig', [], {
      total: 70, grade: 'B', pass: true, dq: false,
      items: [
        { name: '평탄', got: 5, max: 20, mark: '△' },
        { name: '시간', got: 4, max: 5, mark: '○' },
      ],
    });
    expect(t?.lesson).toBe('flatten');
  });
});
