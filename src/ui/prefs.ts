/**
 * 화면·조작 환경설정 값 한 곳.
 *
 * 저장은 localStorage(`exc-*`). 사파리 프라이빗처럼 저장소가 막힌 곳에서도
 * 터지지 않고 기본값으로 동작해야 해서 모든 접근을 try/catch로 감싼다.
 */

export type PrefKey = 'btn' | 'txt' | 'stick' | 'edge';

/** 단계 설정: 라벨과 실제 값. `def`는 지금 화면과 같은 기본 단계 */
export const STEPS: Record<PrefKey, { label: readonly string[]; v: readonly number[]; def: number }> = {
  btn: { label: ['작게', '보통', '크게'], v: [0.88, 1, 1.15], def: 1 },
  txt: { label: ['보통', '크게', '아주 크게'], v: [1, 1.18, 1.36], def: 0 },
  stick: { label: ['작게', '보통', '크게'], v: [0.85, 1, 1.18], def: 1 },
  // 레버를 화면 가장자리에서 얼마나 띄울지 (px). 보통 18px = 지금 CSS 값
  edge: { label: ['좁게', '보통', '넓게'], v: [8, 18, 32], def: 1 },
};

export function loadRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveRaw(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 저장소가 막혀 있으면 이번 판에만 적용 */
  }
}

export function loadStep(k: PrefKey): number {
  const s = STEPS[k];
  const raw = loadRaw(`exc-z-${k}`);
  if (raw === null || raw === '') return s.def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n >= s.v.length) return s.def;
  return n;
}

export function saveStep(k: PrefKey, i: number): void {
  saveRaw(`exc-z-${k}`, String(i));
}

export function loadNum(key: string, def: number, lo: number, hi: number): number {
  const raw = loadRaw(key);
  if (raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < lo || n > hi) return def;
  return n;
}

export function loadFlag(key: string, def: boolean): boolean {
  const raw = loadRaw(key);
  if (raw === null) return def;
  return raw !== '0';
}

/** 설정 값 → CSS 변수 (크기는 배수, 레버 여백은 px) */
export function cssVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const k of ['btn', 'txt', 'stick'] as const) vars[`--z-${k}`] = String(STEPS[k].v[loadStep(k)]);
  vars['--stick-edge'] = `${STEPS.edge.v[loadStep('edge')]}px`;
  return vars;
}

/** 저장해 둔 탭 이름이 지금도 있는 탭일 때만 쓴다 (옛 버전의 'sound'·'seat'가 남아 있을 수 있다) */
export function pickTab(saved: string | null, tabs: readonly string[], def: string): string {
  return saved !== null && tabs.includes(saved) ? saved : def;
}

/** 오프닝을 본 적 있는지 */
export const INTRO_KEY = 'exc-seen-intro';

/**
 * 오프닝을 재생할지. 처음 온 사람에게만 보여주고, 두 번째부터는 바로 시작 화면으로 간다
 * (링크를 누른 사람이 조작까지 가는 시간이 4초 짧아진다). `?nointro`면 언제나 생략.
 */
export function wantIntro(saved: string | null, noIntro: boolean): boolean {
  return !noIntro && saved !== '1';
}
