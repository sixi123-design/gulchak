export type RuleKind = 'disqualify' | 'warning';

export interface RuleDef {
  id: string;
  basis: string;
  kind: RuleKind;
  title: string;
}

export interface ModeFlags {
  /** 실격 시 즉시 종료 (시험모드) */
  failEnds: boolean;
  /** 제한시간 강제 */
  timerEnforced: boolean;
  /** 단계 안내 표시 */
  guide: boolean;
}

export const PRACTICE: ModeFlags = { failEnds: false, timerEnforced: false, guide: true };
export const EXAM: ModeFlags = { failEnds: true, timerEnforced: true, guide: false };

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
