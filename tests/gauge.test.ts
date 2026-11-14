import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { pose } from '../src/sim/tutorial';
import { SMOOTH_MAX, spanCo, spanHit, spanJolt, startSpan, tickSpan, type Joint } from '../src/sim/gauge';

const R = rules as unknown as RulesFile;
const deg = Math.PI / 180;
type Inp = { lx?: number; ly?: number; rx?: number; ry?: number };

function sess() {
  const s = new DigSession(MACHINE, R, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 60; i++) s.step();
  pose(s, Math.PI, 5.5, 1.4, -60 * deg);
  return s;
}
/** 구간을 열고, 매 프레임 레버를 주며 재고, 닫는다 */
function span(s: DigSession, joints: Joint[], steps: [Inp, number][]) {
  const mem: Record<string, number> = {};
  startSpan(s, mem);
  for (const [inp, n] of steps)
    for (let i = 0; i < n; i++) {
      s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
      s.step();
      tickSpan(s, mem, joints);
    }
  return mem;
}

describe('구간 계측', () => {
  it('선회하다 반대로 확 꺾으면 덜컹이 교육 임계를 넘는다', () => {
    const s = sess();
    const mem = span(s, ['swing'], [[{ lx: 1 }, 90], [{ lx: -1 }, 60]]);
    expect(spanJolt(s, mem)).toBeGreaterThan(SMOOTH_MAX);
  });

  it('선회하다 레버를 천천히 가운데로 가져오면 덜컹이 임계 아래다', () => {
    const s = sess();
    const slow: [Inp, number][] = [[{ lx: 1 }, 90]];
    for (let i = 9; i >= 0; i--) slow.push([{ lx: i / 10 }, 6]);
    const mem = span(s, ['swing'], slow);
    expect(spanJolt(s, mem)).toBeLessThan(SMOOTH_MAX);
  });

  it('붐과 암을 같이 쓰면 동시 비율이 30%를 넘는다', () => {
    const s = sess();
    const mem = span(s, ['boom', 'arm'], [[{ ry: -0.6, ly: -0.6 }, 90]]);
    expect(spanCo(mem)).toBeGreaterThan(0.3);
  });

  it('붐과 암을 하나씩 쓰면 동시 비율이 30%에 못 미친다', () => {
    const s = sess();
    const mem = span(s, ['boom', 'arm'], [[{ ry: -0.6 }, 60], [{}, 20], [{ ly: -0.6 }, 60]]);
    expect(spanCo(mem)).toBeLessThan(0.3);
  });

  it('구간이 열리기 전에 난 경고는 세지 않는다', () => {
    const s = sess();
    // 구간 밖에서 미리 덜컹을 만들어 둔다
    for (const [inp, n] of [[{ lx: 1 }, 90], [{ lx: -1 }, 60]] as [Inp, number][])
      for (let i = 0; i < n; i++) ((s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp }), s.step());
    const before = s.engine.violations.filter((v) => v.id === 'W-JOLT').length;
    expect(before).toBeGreaterThan(0);
    // 장비가 다 멎은 뒤에 구간을 연다 (아직 감속 중이면 구간 안에서 새 덜컹이 난다)
    for (let i = 0; i < 150; i++) ((s.input = { lx: 0, ly: 0, rx: 0, ry: 0 }), s.step());
    const mem = span(s, ['swing'], [[{}, 60]]);
    expect(spanHit(s, mem, 'W-JOLT')).toBe(0);
  });

  it('구간 안에서 난 경고는 샌다', () => {
    const s = sess();
    const mem = span(s, ['swing'], [[{ lx: 1 }, 90], [{ lx: -1 }, 60]]);
    expect(spanHit(s, mem, 'W-JOLT')).toBeGreaterThan(0);
  });
});
