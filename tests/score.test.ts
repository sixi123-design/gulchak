import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import { MODES } from '../src/core/ruleEngine';
import { DriveSession } from '../src/sim/drive/driveSession';
import { scoreDig, scoreDrive, PASS_LINE } from '../src/sim/score';
import type { DigResult } from '../src/sim/session';

const perfect: DigResult = {
  digCount: 4,
  dumpCount: 4,
  loadRatios: [1.1, 1.05, 1.0, 1.2],
  positionErrors: [],
  entries: [0, 0, 0, 0].map(() => ({ dr: 0.02, dl: 0.03 }) as never),
  connectedRatio: 0.5,
  flatness: { meanDev: 0.03, std: 0.02, range: 0.08, outsideVol: 0 },
  impacts: 0,
  precheck: { belt: true, lever: true, rpm: true },
  elapsed: 170,
  flattenVol: 0.3,
  jolts: 0,
  packRatios: [0.8, 0.8, 0.8, 0.8],
  carrySpill: 0,
  flattenOpenRatio: 0.8,
};

describe('채점표', () => {
  it('굴착: 만점 합 100, 잘하면 100점 합격', () => {
    const s = scoreDig(perfect, { dq: false, abandoned: false, mode: 'exam' });
    expect(s.items.reduce((a, x) => a + x.max, 0)).toBe(100);
    expect(s.total).toBe(100);
    expect(s.pass).toBe(true);
    expect(s.grade).toBe('S');
    expect(s.items.every((x) => x.mark === '◎')).toBe(true);
  });
  it('굴착: 실격이면 0점 불합격, 점검 빠뜨리면 감점', () => {
    expect(scoreDig(perfect, { dq: true, abandoned: false, mode: 'exam' })).toMatchObject({ total: 0, pass: false, dq: true });
    const s = scoreDig({ ...perfect, precheck: { belt: false, lever: true, rpm: false } }, { dq: false, abandoned: false, mode: 'exam' });
    expect(s.total).toBe(90);
  });
  it('굴착: 흙 적고 위치·평탄 엉성하면 60점 미만 불합격', () => {
    const s = scoreDig(
      { ...perfect, loadRatios: [0.6, 0.6, 0.6, 0.6], entries: [0, 0, 0, 0].map(() => ({ dr: 0.4, dl: 0.1 }) as never), carrySpill: 0.04, flatness: { meanDev: 0.2, std: 0.1, range: 0.4, outsideVol: 0 } },
      { dq: false, abandoned: false, mode: 'practice' },
    );
    expect(s.total).toBeLessThan(PASS_LINE);
    expect(s.pass).toBe(false);
    expect(s.grade).toBe('F');
  });
  it('주행: 만점 합 100, 출발도 안 하면 불합격', () => {
    const d = new DriveSession(MACHINE, MODES.exam);
    d.ready();
    const s = scoreDrive(d);
    expect(s.items.reduce((a, x) => a + x.max, 0)).toBe(100);
    expect(s.pass).toBe(false);
  });
});
