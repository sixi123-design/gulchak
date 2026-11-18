/**
 * 앱 채점: 화면에는 합격·불합격과 항목별 ◎○△✗만 보이고 점수·등급은 내부 계산용 (60 이상 합격). 공단 세부 채점표는 공개되지 않아 앱이 정한 기준이다.
 * 실격이 하나라도 있으면 0점·불합격. 기권도 불합격.
 * 굴착: 시작 전 점검 · 굴착 횟수 · 흙량 · 안쪽까지 담기 · 굴착 위치 · 운반 흘림 · 평탄 · 시간 · 부드러운 조작
 * 주행: 시작 전 점검 · 출발 · 정지선 정지 · 선 간격 유지 · 시간 · 주차 · 부드러운 조작
 */
import type { ModeKey } from '../core/ruleEngine';
import type { DigResult } from './session';
import type { DriveSession } from './drive/driveSession';

export type Grade = 'S' | 'A' | 'B' | 'C' | 'F';
/** 항목 평가: ◎ 잘함 · ○ 보통 · △ 아쉬움 · ✗ 못함 */
export type Mark = '◎' | '○' | '△' | '✗';
export interface ScoreItem {
  name: string;
  got: number;
  max: number;
  /** 화면에는 점수 대신 이 표시 */
  mark: Mark;
  note?: string;
}
export interface Score {
  total: number;
  /** 화면에 보이는 등급: S·A·B·C 합격, F 불합격 (실격이면 F) */
  grade: Grade;
  pass: boolean;
  /** 실격으로 0점 처리됨 */
  dq: boolean;
  items: ScoreItem[];
}
export const PASS_LINE = 60;

/** good 이하면 만점, bad 이상이면 0점, 사이는 직선 (good < bad) */
const lin = (v: number, good: number, bad: number, max: number) => Math.round(max * Math.max(0, Math.min(1, (bad - v) / (bad - good))));
/** good 이상이면 만점, bad 이하면 0점 (good > bad) */
const linUp = (v: number, good: number, bad: number, max: number) => Math.round(max * Math.max(0, Math.min(1, (v - bad) / (good - bad))));
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const cm = (v: number) => `${Math.round(v * 100)}cm`;

/** 등급 경계 (내부 점수 기준): S 95 · A 85 · B 72 · C 60 · 그 아래 F */
export function gradeOf(total: number, pass: boolean): Grade {
  if (!pass) return 'F';
  return total >= 95 ? 'S' : total >= 85 ? 'A' : total >= 72 ? 'B' : 'C';
}
export const markOf = (got: number, max: number): Mark => {
  const r = max > 0 ? got / max : 0;
  return r >= 0.9 ? '◎' : r >= 0.6 ? '○' : r > 0 ? '△' : '✗';
};
type RawItem = Omit<ScoreItem, 'mark'>;
function finish(raw: RawItem[], dq: boolean, abandoned: boolean): Score {
  const items = raw.map((x) => ({ ...x, mark: markOf(x.got, x.max) }));
  const sum = items.reduce((s, x) => s + x.got, 0);
  const total = dq ? 0 : sum;
  const pass = !dq && !abandoned && total >= PASS_LINE;
  return { total, grade: gradeOf(total, pass), pass, dq, items };
}

const precheckItems = (pc: { belt: boolean; lever: boolean; rpm: boolean }): RawItem[] => [
  { name: '안전벨트', got: pc.belt ? 5 : 0, max: 5 },
  { name: '안전레버 풀기', got: pc.lever ? 5 : 0, max: 5 },
  { name: 'RPM 올리기', got: pc.rpm ? 5 : 0, max: 5 },
];

export function scoreDig(r: DigResult, o: { dq: boolean; abandoned: boolean; mode: ModeKey }): Score {
  const load = avg(r.loadRatios);
  const pack = avg(r.packRatios);
  const pos = avg(r.entries.map((e) => Math.max(Math.abs(e.dr), Math.abs(e.dl))));
  const fl = r.flattenVol > 0 ? r.flatness : null;
  const rough = r.impacts + r.jolts;
  const items: RawItem[] = [
    ...precheckItems(r.precheck),
    { name: '굴착 4회', got: r.digCount >= 4 ? 5 : 0, max: 5, note: `${r.digCount}회` },
    { name: '흙량 (평적 이상)', got: r.loadRatios.length ? linUp(load, 1.0, 0.6, 25) : 0, max: 25, note: r.loadRatios.length ? `평균 ${Math.round(load * 100)}%` : '-' },
    { name: '안쪽까지 담기', got: r.packRatios.length ? linUp(pack, 0.6, 0.3, 5) : 0, max: 5, note: r.packRatios.length ? `${Math.round(pack * 100)}%` : '-' },
    { name: '굴착 위치', got: r.entries.length ? lin(pos, 0.1, 0.4, 10) : 0, max: 10, note: r.entries.length ? `오차 ${cm(pos)}` : '-' },
    { name: '운반 중 흘림', got: lin(r.carrySpill, 0.005, 0.04, 10), max: 10, note: `${Math.round(r.carrySpill * 1000)}L` },
    { name: '평탄', got: fl ? lin(fl.meanDev, 0.05, 0.2, 20) : 0, max: 20, note: fl ? `편차 ${cm(fl.meanDev)}` : '안 함' },
    { name: '시간', got: lin(r.elapsed, 180, 240, 5), max: 5, note: `${Math.floor(r.elapsed / 60)}:${String(Math.floor(r.elapsed % 60)).padStart(2, '0')}` },
    { name: '부드러운 조작', got: Math.max(0, 5 - rough), max: 5, note: `충격·덜컹 ${rough}회` },
  ];
  return finish(items, o.dq, o.abandoned);
}

export function scoreDrive(s: DriveSession): Score {
  const dq = s.engine.disqualifications().length > 0;
  const dev = s.gapN ? s.gapDevSum / s.gapN : 1;
  const warns = s.engine.violations.filter((v) => v.id === 'W-GEAR' || v.id === 'W-SWINGLOCK').length;
  const started = s.stage !== 'READY';
  const done = s.stage === 'FINISH' || s.stage === 'DONE';
  const items: RawItem[] = [
    ...precheckItems(s.precheck),
    { name: '1분 안에 출발', got: started ? 5 : 0, max: 5 },
    { name: '정지선 정지', got: s.stopped ? 15 : 0, max: 15 },
    { name: '왼쪽 선 간격 유지', got: s.gapN ? lin(dev, 0.15, 0.6, 25) : 0, max: 25, note: s.gapN ? `평균 ${cm(dev)} 벗어남` : '-' },
    { name: '시간', got: done ? lin(s.taskT, 60, 120, 15) : 0, max: 15, note: started ? `${Math.floor(s.taskT / 60)}:${String(Math.floor(s.taskT % 60)).padStart(2, '0')}` : '-' },
    { name: '주차', got: s.parkedOk ? 15 : 0, max: 15, note: s.parkedOk === null ? '-' : s.parkedOk ? '구역 안' : '구역 밖' },
    { name: '부드러운 조작', got: Math.max(0, 10 - warns * 3), max: 10, note: `주의 ${warns}회` },
  ];
  return finish(items, dq, s.abandoned);
}
