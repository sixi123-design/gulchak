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
  let moving = 0;
  for (const j of joints) if (Math.abs(s.vel[j]) > MOVING * s.m.speeds[j]) moving++;
  // 분모는 '하나라도 움직인 프레임'. 가만히 있던 시간(지시문 읽기·멈춰 생각하기)까지 세면
  // 완벽하게 같이 써도 비율이 떨어지고, 늦게 시작하면 영영 기준을 못 넘는다 (개발 검토)
  if (moving >= 1) mem.gN = (mem.gN ?? 0) + 1;
  if (moving >= 2) mem.gCo = (mem.gCo ?? 0) + 1;
}

/**
 * 충격 측정만 다시 연다 (같은 구간에서 다시 해 보는 경우).
 * 구간 최대값은 한 번 올라가면 안 내려가므로, 한 번 덜컹하면 영영 못 통과한다 —
 * 막다른 길이다. 다시 접근할 때마다 새로 재야 고쳐서 통과할 수 있다.
 */
export function retrySpan(s: DigSession): void {
  s.maxJolt = 0;
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
