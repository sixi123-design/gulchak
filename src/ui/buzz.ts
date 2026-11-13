/**
 * 진동 한 곳. 설정에서 끌 수 있고, 진동을 못 쓰는 기기(아이폰 사파리)에서는 조용히 넘어간다.
 */
import { loadFlag, saveRaw } from './prefs';

type Vibrate = (p: number | number[]) => void;

let vibrate: Vibrate | null =
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' ? (p) => navigator.vibrate(p) : null;

let on = loadFlag('exc-buzz', true);

export function buzzOn(): boolean {
  return on;
}

export function setBuzz(v: boolean): void {
  on = v;
  saveRaw('exc-buzz', v ? '1' : '0');
}

export function buzz(p: number | number[]): void {
  if (!on || !vibrate) return;
  try {
    vibrate(p);
  } catch {
    /* 기기가 거절하면 무시 */
  }
}

/** 테스트용 주입 */
export function _setVibrate(fn: Vibrate | null): void {
  vibrate = fn;
}
