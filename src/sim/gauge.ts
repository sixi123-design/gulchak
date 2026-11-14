import type { DigSession } from './session';

export type Joint = 'swing' | 'boom' | 'arm' | 'bucket';
type Mem = Record<string, number>;

/**
 * 교육용 덜컹 임계.
 * 엔진의 경고선(`joltWarn` 0.1)은 선회 레버를 확 놓아야(측정 0.111) 겨우 뜨고,
 * 붐은 확 놓아도 0.005라 아예 안 뜬다. 가르치려면 더 엄한 선이 필요하다.
 */
export const SMOOTH_MAX = 0.06;

/** 이 비율보다 빠르면 '움직이는 중'으로 본다 (그 관절 최고 속도 대비) */
const MOVING = 0.02;

/**
 * 구간을 연다. 한 지시(구간)가 시작할 때 한 번 부른다.
 * `mem`은 단계마다 초기화되는 메모이므로 구간이 바뀌면 자동으로 비워진다.
 */
export function startSpan(s: DigSession, mem: Mem): void {
  s.maxJolt = 0;
  mem.gN = 0;
  mem.gCo = 0;
  mem.gV = s.engine.violations.length;
}

/** 매 프레임 부른다. `joints`에 적은 관절 중 둘 이상이 움직인 프레임을 센다 */
export function tickSpan(s: DigSession, mem: Mem, joints: Joint[] = []): void {
  mem.gN = (mem.gN ?? 0) + 1;
  let moving = 0;
  for (const j of joints) if (Math.abs(s.vel[j]) > MOVING * s.m.speeds[j]) moving++;
  if (moving >= 2) mem.gCo = (mem.gCo ?? 0) + 1;
}

/** 구간 동안의 최대 충격 */
export function spanJolt(s: DigSession, _mem: Mem): number {
  return s.maxJolt;
}

/** 구간 동안 관절 둘 이상이 같이 움직인 시간 비율 (0~1) */
export function spanCo(mem: Mem): number {
  return mem.gN ? (mem.gCo ?? 0) / mem.gN : 0;
}

/** 구간 동안 그 규칙이 몇 번 기록됐나 (구간 전의 것은 세지 않는다) */
export function spanHit(s: DigSession, mem: Mem, id: string): number {
  let n = 0;
  for (let i = mem.gV ?? 0; i < s.engine.violations.length; i++) if (s.engine.violations[i].id === id) n++;
  return n;
}
