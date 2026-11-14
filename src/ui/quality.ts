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

/**
 * 단계별 연출 예산. **판정은 이 값과 무관하다** — 덜컹·흙량 손해·흘림 문구는 어느 기기에서나 같고,
 * 여기서 줄이는 것은 눈에 보이는 연출뿐이다 (저가폰이 1순위).
 *
 * `fx`는 예전에 선언만 해 두고 아무 데서도 쓰지 않았다. 이 함수가 그 자리를 대신한다.
 */
export function fxPlan(level: QLevel): { particles: number; clumps: number; dust: number } {
  // 0단: 흙 알갱이를 덩어리 하나로만, 먼지는 끈다 (그릴 인스턴스 40개)
  if (level === 0) return { particles: 40, clumps: 1, dust: 0 };
  if (level === 1) return { particles: 160, clumps: 3, dust: 40 };
  return { particles: 220, clumps: 3, dust: 60 };
}

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

/**
 * 자동이 올릴 수 있는 최고 단계. '선명하게'는 사람이 고르는 것이지 기계가 올려주는 것이 아니다.
 * (60Hz 화면은 아무리 여유가 있어도 한 프레임이 16.7ms 밑으로 안 내려가서, 여유를 프레임 시간으로는 알 수 없다.
 *  그래서 자동은 자기가 내린 만큼만 되돌린다.)
 */
export const AUTO_MAX: QLevel = 1;

/** 한 프레임 평균(ms)을 보고 다음 단계. 38ms(=26fps) 넘으면 내리고, 20ms(=50fps) 밑이면 올린다 */
export function autoLevel(frameAvgMs: number, cur: QLevel): QLevel {
  if (frameAvgMs > 38) return Math.max(0, cur - 1) as QLevel;
  if (frameAvgMs < 20) return (cur >= AUTO_MAX ? cur : cur + 1) as QLevel;
  return cur;
}

// ---- 지금 상태 (화면이 쓰는 값은 여기 하나뿐) ----
let pref: QLevel | 'auto' = loadQuality();
let level: QLevel = levelOf(pref);
/** 지금 켜져 있는 렌더러가 어떤 안티에일리어싱으로 만들어졌는지 (바뀌면 다음에 켤 때 적용된다) */
let aaNow = Q[level].aa;

export function current(): { pref: QLevel | 'auto'; level: QLevel; aaChanged: boolean } {
  return { pref, level, aaChanged: Q[level].aa !== aaNow };
}

/** 설정 칩: 0 = 자동, 1~3 = 부드럽게·보통·선명하게 */
export function pick(choice: number): QLevel {
  pref = choice === 0 ? 'auto' : ((choice - 1) as QLevel);
  level = levelOf(pref);
  saveQuality(pref);
  return level;
}

/** 자동일 때만 프레임을 보고 단계를 바꾼다. 바뀌면 새 단계, 아니면 null */
export function tick(frameAvgMs: number): QLevel | null {
  if (pref !== 'auto') return null;
  const next = autoLevel(frameAvgMs, level);
  if (next === level) return null;
  level = next;
  return level;
}

/** 렌더러를 새로 만들었을 때 (지금 켜진 안티에일리어싱을 다시 기준으로 삼는다) */
export function markRendererAa(aa: boolean): void {
  aaNow = aa;
}
