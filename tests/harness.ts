import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile, type Sticks } from '../src/sim/session';
import { Tutor, type Lesson } from '../src/sim/tutorial';

/**
 * 튜토리얼 테스트 공용 — **실제 앱(main.ts)과 같은 순서·같은 값**으로 한 스텝을 돈다.
 *
 * 테스트마다 따로 짜면 손 자리(stick)를 안 넣거나 레버 곡선을 빼먹는다. 그러면
 * 테스트는 통과하는데 앱에서는 안 되는 일이 생긴다 (개발 검토, 2026-11-16).
 */
export type Hand = Partial<Sticks>;

export function session() {
  const s = new DigSession(MACHINE, rules as unknown as RulesFile, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 60; i++) s.step();
  return s;
}
export const tutorFor = (lesson: Lesson) => new Tutor(lesson, session());

/** 레버 곡선 — main.ts의 curve(2.2)·curveSwing(3)과 같다 */
const curve = (v: number, p = 2.2) => Math.sign(v) * Math.abs(v) ** p;

/** 한 스텝: 손 자리 → 기계 값(곡선) → 시범이 덮어쓰기 → 시뮬 → 판정 */
export function frame(t: Tutor, hand: Hand = {}) {
  const h: Sticks = { lx: 0, ly: 0, rx: 0, ry: 0, ...hand };
  t.s.stick = h;
  t.s.input = t.drive({ lx: curve(h.lx, 3), ly: curve(h.ly), rx: curve(h.rx), ry: curve(h.ry) });
  t.s.step();
  t.update();
}

/** 지금 단계가 바뀔 때까지 (되감기 포함). hand가 함수면 매 스텝 판단한다 */
export function until(t: Tutor, hand: Hand | ((t: Tutor) => Hand), n = 900) {
  const from = t.step;
  for (let i = 0; i < n; i++) {
    frame(t, typeof hand === 'function' ? hand(t) : hand);
    if (t.step !== from || t.cleared) return true;
  }
  return false;
}

/** 서서히 놓기 (덜컹 없이) */
export function ease(t: Tutor, from: Hand, n = 40) {
  for (let i = 1; i <= n; i++) {
    const k = 1 - i / n;
    frame(t, { lx: (from.lx ?? 0) * k, ly: (from.ly ?? 0) * k, rx: (from.rx ?? 0) * k, ry: (from.ry ?? 0) * k });
  }
}
