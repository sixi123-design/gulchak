export type RuleKind = 'disqualify' | 'warning';

export interface RuleDef {
  id: string;
  basis: string;
  kind: RuleKind;
  title: string;
}

export type ModeKey = 'tutorial' | 'free' | 'practice' | 'exam';

export interface ModeFlags {
  key: ModeKey;
  /** 실격 시 즉시 종료 (실제 시험) */
  failEnds: boolean;
  /** 4분 제한 판정 (D-TIME) */
  timeLimit: boolean;
  /** 버킷을 펴서 내려놓으면 종료 + 횟수·평탄 판정 */
  autoEnd: boolean;
  /** 단계 안내 문구 */
  guide: boolean;
  /** 경고 알림·굴착 위치 피드백·바닥 목표선 */
  feedback: boolean;
}

/** 자유 연습: 시간·순서 없이 마음대로. 경고와 피드백만 */
export const FREE: ModeFlags = { key: 'free', failEnds: false, timeLimit: false, autoEnd: false, guide: false, feedback: true };
/** 시험 연습: 시험 순서대로, 안내·피드백을 받으며. 실격돼도 계속 */
export const PRACTICE: ModeFlags = { key: 'practice', failEnds: false, timeLimit: true, autoEnd: true, guide: true, feedback: true };
/** 실제 시험: 안내 없음, 실격이면 그 자리에서 종료 */
export const EXAM: ModeFlags = { key: 'exam', failEnds: true, timeLimit: true, autoEnd: true, guide: false, feedback: false };
/** 배우기: 자유 연습과 같되 미션이 진행을 맡음 */
export const TUTORIAL: ModeFlags = { ...FREE, key: 'tutorial' };
export const MODES: Record<ModeKey, ModeFlags> = { tutorial: TUTORIAL, free: FREE, practice: PRACTICE, exam: EXAM };

export interface Violation {
  id: string;
  basis: string;
  kind: RuleKind;
  title: string;
  detail: string;
  t: number;
}

export interface ReportResult {
  recorded: boolean;
  violation?: Violation;
  endsTask: boolean;
}

/** 순수 규칙 엔진: 판정 센서가 보낸 이벤트를 기록하고 모드 플래그에 따라 처리한다 */
export class RuleEngine {
  readonly violations: Violation[] = [];
  private lastAt = new Map<string, number>();
  private byId: Map<string, RuleDef>;
  constructor(
    rules: RuleDef[],
    readonly flags: ModeFlags,
    readonly cooldown = 1.5,
  ) {
    this.byId = new Map(rules.map((r) => [r.id, r]));
  }
  report(id: string, t: number, detail: string): ReportResult {
    const def = this.byId.get(id);
    if (!def) throw new Error(`unknown rule ${id}`);
    const key = `${id}|${detail}`;
    const last = this.lastAt.get(key);
    this.lastAt.set(key, t);
    if (last !== undefined && t - last < this.cooldown) return { recorded: false, endsTask: false };
    const v: Violation = { id, basis: def.basis, kind: def.kind, title: def.title, detail, t };
    this.violations.push(v);
    return { recorded: true, violation: v, endsTask: def.kind === 'disqualify' && this.flags.failEnds };
  }
  disqualifications(): Violation[] {
    return this.violations.filter((v) => v.kind === 'disqualify');
  }
  /** 실격 사유를 규칙 ID별로 묶는다 (결과 화면용) */
  summary(): { id: string; title: string; basis: string; kind: RuleKind; count: number; details: string[] }[] {
    const m = new Map<string, { id: string; title: string; basis: string; kind: RuleKind; count: number; details: string[] }>();
    for (const v of this.violations) {
      const e = m.get(v.id) ?? { id: v.id, title: v.title, basis: v.basis, kind: v.kind, count: 0, details: [] };
      e.count++;
      if (!e.details.includes(v.detail)) e.details.push(v.detail);
      m.set(v.id, e);
    }
    return [...m.values()];
  }
}
