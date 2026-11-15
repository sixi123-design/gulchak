import { expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { MODES } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { Tutor } from '../src/sim/tutorial';
import { BASIC_LESSONS } from '../src/sim/leverSchool';
import { ARC, MOVE, READY_ARM, READY_BOOM, wantAngle } from '../src/sim/moveCourse';
import { digSpot } from '../src/sim/digCourse';
import { shapeOf, staticHits } from '../src/sim/judge';

const R = rules as unknown as RulesFile;
const deg = Math.PI / 180;

function sess() {
  const s = new DigSession(MACHINE, R, MODES.tutorial);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 1;
  s.ready();
  for (let i = 0; i < 60; i++) s.step();
  return s;
}
const ready = () => BASIC_LESSONS.find((l) => l.id === 'b-ready')!;
const tutor = () => new Tutor(ready(), sess());

/** 레버를 주고 n프레임 (시범 중에는 drive가 유저 입력을 무시한다 — 실제 앱과 같게) */
function run(t: Tutor, inp: { lx?: number; ly?: number; rx?: number; ry?: number }, n: number) {
  for (let i = 0; i < n; i++) {
    const hand = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
    t.s.input = t.drive(hand);
    t.s.stick = t.s.input === hand ? hand : { lx: 0, ly: 0, rx: 0, ry: 0 };
    t.s.step();
    t.update();
    if (t.cleared) return;
  }
}
/** 길잡이를 따라가는 두 손 — 남은 거리만큼 암을 펴고, 남은 높이에 맞는 각도로 레버를 둔다 */
function follow(t: Tutor, n: number) {
  for (let i = 0; i < n; i++) {
    const a = wantAngle(t.s) * deg;
    const need = digSpot(t.s).r - t.s.frame.tip.r;
    const hand = { lx: 0, ly: Math.max(-1, Math.min(1, need * 1.5)), rx: Math.cos(a) * ARC.ring, ry: Math.sin(a) * ARC.ring };
    t.s.input = t.drive(hand);
    t.s.stick = t.s.input === hand ? hand : { lx: 0, ly: 0, rx: 0, ry: 0 };
    t.s.step();
    t.update();
    if (t.cleared) return;
  }
}
/** 실습(원호 드릴) 단계의 번호 — 앞의 셋은 시범이다 */
const ARC_STEP = 3;
/** 시범 셋을 다 지나 실습 단계까지 */
function pastDemos(t: Tutor) {
  for (let i = 0; i < 2400 && t.step < ARC_STEP; i++) run(t, {}, 1);
  expect(t.step, '시범이 끝나지 않았다').toBe(ARC_STEP);
}

it('시작 자세는 선회 실격선을 통과하는 자세다', () => {
  const t = tutor();
  const p = t.s.pose;
  expect(p.boom / deg).toBeCloseTo(READY_BOOM, 0);
  expect(p.arm / deg).toBeCloseTo(READY_ARM, 0);
  expect(p.bucket / deg).toBeLessThan(-110);
  const f = t.s.frame;
  const { rE, rF, ropeY } = t.s.site.B;
  // 버킷이 ⓔ·ⓕ 폴 사이로 지나가고, 장애물 줄 위에 있다
  expect(f.tip.r, '통과구역 안쪽 끝').toBeGreaterThan(rE + 0.3);
  expect(f.tip.r, '통과구역 바깥 끝').toBeLessThan(rF - 0.3);
  expect(Math.min(f.tip.y, f.heel.y, f.P2.y), '줄 위').toBeGreaterThanOrEqual(ropeY + 0.3);
  // 그 자세 그대로 B를 지나도 폴·줄에 안 닿는다 (판정기로 직접)
  const hits = staticHits({ ...t.s.site, stations: [] as never }, shapeOf(MACHINE, f, Math.PI / 2), -Infinity);
  expect(hits.map((h) => h.detail)).toEqual([]);
});

it('시범이 기계를 내려놓아도 실습은 같은 자세에서 시작한다', () => {
  const t = tutor();
  const start = { ...t.s.pose };
  pastDemos(t);
  expect(t.s.pose.boom).toBeCloseTo(start.boom, 3);
  expect(t.s.pose.arm).toBeCloseTo(start.arm, 3);
  expect(t.s.pose.bucket).toBeCloseTo(start.bucket, 3);
});

it('길잡이 점을 따라가면 파는 자리에 내려놓고 끝난다 (별 3개)', () => {
  const t = tutor();
  pastDemos(t);
  // 점을 따라 내려오고
  for (let i = 0; i < 1200 && t.step === ARC_STEP; i++) follow(t, 1);
  expect(t.step, '원호 드릴을 통과하지 못했다').toBeGreaterThan(ARC_STEP);
  // 레버를 가운데로 놓아 멈춘다
  run(t, {}, 300);
  expect(t.cleared, '끝까지 못 갔다').toBe(true);
  const { r } = digSpot(t.s);
  expect(Math.abs(t.s.frame.tip.r - r), '파는 자리에서 벗어났다').toBeLessThan(MOVE.rTol);
  expect(ready().grade!(t.s, t.bag).stars).toBe(3);
});

it('처음부터 3시로 놓으면 통과하지 못하고 12시로 밀라고 알려 준다', () => {
  const t = tutor();
  pastDemos(t);
  run(t, { rx: ARC.ring }, 600);
  expect(t.cleared).toBe(false);
  expect(t.hud() ?? '').toMatch(/12시/);
});

it('실습 중에는 매 프레임 한 줄 피드백이 있다', () => {
  const t = tutor();
  pastDemos(t);
  for (let i = 0; i < 400 && t.step === ARC_STEP; i++) {
    const a = wantAngle(t.s) * deg;
    const hand = { lx: 0, ly: 0, rx: Math.cos(a) * ARC.ring * 0.4, ry: Math.sin(a) * ARC.ring * 0.4 };
    t.s.input = t.drive(hand);
    t.s.stick = hand;
    t.s.step();
    t.update();
    expect(t.hud() ?? '', `프레임 ${i}`).not.toBe('');
  }
});

it('반대로 밀면 높이 탓이 아니라 반대쪽이라고 말한다', () => {
  const t = tutor();
  pastDemos(t);
  run(t, { rx: -ARC.ring }, 30); // 9시 (버킷 오므림)
  expect(t.hud() ?? '').toMatch(/반대쪽/);
});

it('점에서 벗어난 채 끝나면 별 3개가 아니다', () => {
  const t = tutor();
  pastDemos(t);
  // 12시로 한참 내리다가 한 번에 3시로 꺾는다 (점을 따라가지 않음)
  for (let i = 0; i < 1200 && t.step === ARC_STEP; i++) {
    const far = t.s.groundGap() > 0.6;
    run(t, far ? { ry: ARC.ring } : { rx: ARC.ring }, 1);
  }
  expect(t.step, '통과는 한다 (막다른 길이 아니다)').toBeGreaterThan(ARC_STEP);
  run(t, {}, 300);
  expect(ready().grade!(t.s, t.bag).stars).toBeLessThan(3);
});

it('멈추기에서 한 번 덜컹해도 다시 내려오면 통과한다 (막다른 길 아님)', () => {
  const t = tutor();
  pastDemos(t);
  for (let i = 0; i < 1200 && t.step === ARC_STEP; i++) follow(t, 1);
  expect(t.step).toBeGreaterThan(ARC_STEP);
  t.s.maxJolt = 0.2; // 덜컹했다
  run(t, {}, 60);
  expect(t.cleared, '덜컹한 채로 끝나면 안 된다').toBe(false);
  // 붐을 올려 범위 밖으로 나갔다가 (= 다시 해 보기) 천천히 내려온다
  run(t, { ry: -0.5 }, 45);
  for (let i = 0; i < 1200 && !t.cleared; i++) run(t, t.s.groundGap() > 0.3 ? { ry: 0.25 } : {}, 1);
  expect(t.cleared, '고쳐도 못 끝내면 막다른 길이다').toBe(true);
});
