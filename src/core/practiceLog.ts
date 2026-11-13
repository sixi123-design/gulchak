/**
 * 연습 판수. 많이 연습할수록 좋으니 막지 않고 쌓아서 보여준다.
 * (결과 화면의 "연습 N판째", 결제 벽의 "지금까지 N판")
 */
import { loadRaw, saveRaw } from '../ui/prefs';

const KEY = 'exc-runs';

interface Log {
  total: number;
  day: string;
  today: number;
}

function read(): Log {
  try {
    const v = JSON.parse(loadRaw(KEY) ?? '') as Partial<Log>;
    const total = Number(v?.total);
    const today = Number(v?.today);
    return {
      total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
      day: typeof v?.day === 'string' ? v.day : '',
      today: Number.isFinite(today) && today > 0 ? Math.floor(today) : 0,
    };
  } catch {
    return { total: 0, day: '', today: 0 };
  }
}

/** 오늘 날짜(YYYY-MM-DD)를 받아 지금까지·오늘 판수를 돌려준다 */
export function loadRuns(today: string): { total: number; today: number } {
  const l = read();
  return { total: l.total, today: l.day === today ? l.today : 0 };
}

/** 한 판 끝냈을 때 */
export function bumpRuns(today: string): { total: number; today: number } {
  const l = read();
  const next = { total: l.total + 1, day: today, today: l.day === today ? l.today + 1 : 1 };
  saveRaw(KEY, JSON.stringify(next));
  return { total: next.total, today: next.today };
}

/** 오늘 날짜 문자열 (기기 시간 기준) */
export function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
