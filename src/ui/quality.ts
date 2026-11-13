/**
 * 화질 3단. 저가폰이 1순위라 '보통'이 지금까지의 값이고, 올리는 쪽이 선택이다.
 *
 * 기본은 자동: 프레임이 느리면 내리고 넉넉하면 올린다. 설정에서 한 번 고르면
 * 그 단계로 고정하고 자동은 끈다 (고른 값을 기계가 덮어쓰면 안 된다).
 */
import { loadRaw, saveRaw } from './prefs';

export type QLevel = 0 | 1 | 2;

export const Q: Record<QLevel, { label: string; dprCap: number; aa: boolean; fx: number }> = {
  0: { label: '부드럽게', dprCap: 0.75, aa: false, fx: 0.6 },
  1: { label: '보통', dprCap: 1.25, aa: false, fx: 1 },
  2: { label: '선명하게', dprCap: 2, aa: true, fx: 1.4 },
};

const KEY = 'exc-q';

export function loadQuality(): QLevel | 'auto' {
  const raw = loadRaw(KEY);
  if (raw === '0' || raw === '1' || raw === '2') return Number(raw) as QLevel;
  return 'auto';
}

export function saveQuality(q: QLevel | 'auto'): void {
  saveRaw(KEY, String(q));
}

/** 설정값 → 시작 단계 (자동이면 보통에서 시작해 프레임을 보고 움직인다) */
export function levelOf(q: QLevel | 'auto'): QLevel {
  return q === 'auto' ? 1 : q;
}

/** 한 프레임 평균(ms)을 보고 다음 단계. 38ms(=26fps) 넘으면 내리고, 20ms(=50fps) 밑이면 올린다 */
export function autoLevel(frameAvgMs: number, cur: QLevel): QLevel {
  if (frameAvgMs > 38) return Math.max(0, cur - 1) as QLevel;
  if (frameAvgMs < 20) return Math.min(2, cur + 1) as QLevel;
  return cur;
}
