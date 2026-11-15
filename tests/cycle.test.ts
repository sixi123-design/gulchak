import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { PRACTICE } from '../src/core/ruleEngine';
import { ik, type Pose } from '../src/sim/kinematics';
import { DigSession, type RulesFile } from '../src/sim/session';

const R = rules as unknown as RulesFile;
const PI = Math.PI;

/** 자동 조작: 관절각을 보간하며 매 스텝 시뮬레이션 진행 (레버 입력 없이 자세 직접 지정) */
function driver(s: DigSession) {
  const to = (target: Partial<Pose>, steps: number) => {
    const from = { ...s.pose };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p: Partial<Pose> = {};
      for (const k of Object.keys(target) as (keyof Pose)[]) p[k] = from[k] + ((target[k] as number) - from[k]) * t;
      s.setPose(p);
      s.step();
    }
  };
  const tip = (r: number, y: number, thK: number, steps: number) => {
    const q = ik(MACHINE, r, y, thK);
    if (!q) throw new Error(`도달 불가 r=${r} y=${y}`);
    to(q, steps);
  };
  /** 날 끝을 직선으로 끌며(암·붐) 버킷 각도도 함께 바꿈: 관절각 보간은 핀이 거의 안 움직이는 '오므림만'이 되어 흙이 날 앞에만 쌓임 */
  const pull = (r: number, y: number, thK: number, steps: number) => {
    const f0 = s.frame;
    const r0 = f0.tip.r;
    const y0 = f0.tip.y;
    const k0 = f0.thK;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const q = ik(MACHINE, r0 + (r - r0) * t, y0 + (y - y0) * t, k0 + (thK - k0) * t);
      if (!q) throw new Error(`도달 불가 r=${r} y=${y}`);
      s.setPose(q);
      s.step();
    }
  };
  const wait = (n: number) => {
    for (let i = 0; i < n; i++) s.step();
  };
  return { to, tip, pull, wait };
}

function runCycle(s: DigSession, d: ReturnType<typeof driver>, c = 0) {
  const [A, C] = s.site.stations;
  const CURL = -PI - 0.6;
  // 현재 흙 표면(목표 지점) 기준으로 파기: 구덩이가 깊어져도 같은 동작
  // 굴착할 때마다 시작 지점을 안쪽으로 옮김 (같은 자리만 파지 않음)
  const r0 = A.pitOut - 0.1 - 0.35 * c;
  const surf = Math.max(s.soil.surfaceAt(-r0, 0), -1.3);
  d.tip(r0, surf + 0.3, -1.0, 40); // A 구덩이 위 (버킷 날을 앞으로 숙임)
  d.tip(r0, surf - 0.2, -1.0, 40); // 비스듬히 꽂기 (20cm: 더 깊이 억지로 밀어 넣으면 차체가 크게 들림)
  d.pull(Math.max(A.pitIn + 0.5, r0 - 1.6), surf - 0.25, -1.5, 100); // 반쯤 오므린 채 암으로 당겨 쓸어 담기 (끝까지 오므림은 들 때)
  d.pull(A.pitIn + 0.6, 1.2, CURL, 40); // 오므리며 들어 올리기 (날 끝을 곧게 끌어올림: 관절각 보간은 2.1m 암에서 버킷이 땅을 한 번 누르고 지나간다)
  d.to({ boom: 1.0, arm: -1.9, bucket: -1.4 }, 40); // B 통과 자세 (붐 높이 들기)
  d.to({ swing: 0 }, 160); // A → B → C (왼쪽 선회)
  d.tip(C.pitIn, 1.2, CURL, 40); // C 구덩이 안쪽 위
  d.tip((C.pitIn + C.pitOut) / 2, 1.0, 0.3, 50); // 버킷 펴서 쏟기
  d.wait(60);
  d.to({ boom: 1.0, arm: -1.9, bucket: -1.4 }, 40);
  d.to({ swing: PI }, 160); // C → B → A (오른쪽 선회)
}

describe('굴착 작업 한 바퀴 (자동 조작)', () => {
  it('4회 굴착·덤프 → 평탄(당기고 밀기 왕복) → 종료: 실격 없음, 장부 일치', () => {
    const s = new DigSession(MACHINE, R, PRACTICE, () => 0.5);
    s.belt = true;
    s.leverUnlocked = true;
    s.rpm = 0.8;
    s.ready();
    for (let i = 0; i < 100; i++) s.step();
    const d = driver(s);
    for (let c = 0; c < 4; c++) runCycle(s, d, c);
    expect(s.digCount).toBe(4);
    expect(s.dumpCount).toBe(4);
    for (const r of s.loadRatios) expect(r).toBeGreaterThan(0.5);

    // 평탄: C로 가서 먼 쪽에 버킷을 대고 당겨 온 뒤, 바깥쪽으로 밀고 지나감 (왕복 1회)
    const C = s.site.stations[1];
    d.to({ boom: 1.0, arm: -1.9, bucket: -1.4 }, 40);
    d.to({ swing: 0 }, 160);
    d.tip(C.pitOut - 0.5, 0.4, -PI / 2, 40);
    d.tip(C.pitOut - 0.5, -0.02, -PI / 2, 30);
    d.tip(C.pitIn + 0.1, -0.02, -PI / 2, 120); // 장비 쪽으로 당겨 오기
    d.tip(C.pitOut - 0.2, -0.02, -1.0, 120); // 바깥쪽으로 밀며 고르기
    d.tip(C.pitOut - 0.4, 0.3, -1.0, 20);
    expect(s.flattenVol).toBeGreaterThan(R.params.flattenMinVolume);
    expect(s.flattenPullDist).toBeGreaterThan(R.params.flattenMinPass);
    expect(s.flattenPushDist).toBeGreaterThan(R.params.flattenMinPass);
    expect(s.flattenDone).toBe(true);
    // 화면 표시용 긁은 자국: 평탄 중 버킷이 닿은 C 칸에 시각 기록 (흙 높이와 무관)
    const gC = s.soil.grids.find((g) => g.name === 'C')!;
    expect(gC.touchLast).toBeGreaterThan(0);
    expect(gC.touch.filter((t) => t > 0).length).toBeGreaterThan(50);

    // 종료: 버킷을 완전히 펴서 구역 안 지면에 내려놓음
    const q = ik(MACHINE, (C.pitIn + C.pitOut) / 2 + 0.3, 0.3, 0)!;
    d.to({ ...q }, 30);
    d.to({ bucket: MACHINE.limits.bucket[1] }, 30);
    // 가장 낮은 점이 지면에 닿을 때까지 붐을 조금씩 내림
    // 지면에 닿을 때까지 붐을 내리고, 닿으면 멈춰 기다림
    for (let i = 0; i < 800 && s.phase === 'working'; i++) {
      if (s.groundGap() > 0.02) s.setPose({ boom: s.pose.boom - 0.001 });
      s.step();
    }
    d.wait(90);
    expect(s.phase).toBe('finished');
    const dq = s.engine.disqualifications();
    expect(dq.map((v) => `${v.id}:${v.detail}`)).toEqual([]);
    expect(Math.abs(s.ledgerError())).toBeLessThan(1e-3);
    const fl = s.result().flatness!;
    expect(fl.meanDev).toBeLessThan(0.3);
  });

  it('평탄을 한 방향(밀기)만 하면 평탄 안 한 것: 종료 때 D-NOFLAT (왕복 필요)', () => {
    const s = new DigSession(MACHINE, R, PRACTICE, () => 0.5);
    s.belt = true;
    s.leverUnlocked = true;
    s.rpm = 0.8;
    s.ready();
    for (let i = 0; i < 100; i++) s.step();
    const d = driver(s);
    for (let c = 0; c < 4; c++) runCycle(s, d, c);
    const C = s.site.stations[1];
    d.to({ boom: 1.0, arm: -1.9, bucket: -1.4 }, 40);
    d.to({ swing: 0 }, 160);
    d.tip(C.pitIn + 0.1, 0.4, -PI / 2, 40);
    d.tip(C.pitIn + 0.1, -0.02, -PI / 2, 30);
    d.tip(C.pitOut - 0.2, -0.02, -1.0, 120); // 밀기만
    d.tip(C.pitOut - 0.4, 0.3, -1.0, 20);
    expect(s.flattenVol).toBeGreaterThan(R.params.flattenMinVolume);
    expect(s.flattenPullDist).toBeLessThan(R.params.flattenMinPass);
    expect(s.flattenDone).toBe(false);
    const q = ik(MACHINE, (C.pitIn + C.pitOut) / 2 + 0.3, 0.3, 0)!;
    d.to({ ...q }, 30);
    d.to({ bucket: MACHINE.limits.bucket[1] }, 30);
    for (let i = 0; i < 800 && s.phase === 'working'; i++) {
      if (s.groundGap() > 0.02) s.setPose({ boom: s.pose.boom - 0.001 });
      s.step();
    }
    d.wait(90);
    expect(s.phase).toBe('finished');
    const dq = s.engine.disqualifications().map((v) => `${v.id}:${v.detail}`);
    expect(dq).toEqual(['D-NOFLAT:평탄: 밀기만 하고 당겨 오기 없음 (왕복 1회 필요)']);
  });

  it('조금씩 나눠 쏟아도 굴착 1회당 덤프는 1회', () => {
    const s = new DigSession(MACHINE, R, PRACTICE, () => 0.5);
    s.belt = true;
    s.leverUnlocked = true;
    s.rpm = 0.8;
    s.ready();
    for (let i = 0; i < 100; i++) s.step();
    const d = driver(s);
    const [A, C] = s.site.stations;
    d.tip(A.pitOut - 0.1, 0.3, -1.0, 40);
    d.tip(A.pitOut - 0.1, -0.75, -1.0, 40);
    d.pull(A.pitIn + 0.3, -0.65, -1.5, 100); // 반쯤 오므린 채 암으로 당겨 담기
    d.tip(A.pitIn + 0.6, 1.2, -PI - 0.6, 40);
    d.to({ boom: 1.0, arm: -1.9, bucket: -1.4 }, 40);
    d.to({ swing: 0 }, 160);
    d.tip(C.pitIn, 1.2, -PI - 0.6, 40);
    // 조금 쏟고 오므리기를 5번 반복
    for (let k = 0; k < 5; k++) {
      d.tip(C.pitIn + 0.3, 1.1, -PI / 2 + 0.2, 25);
      d.wait(10);
      d.tip(C.pitIn, 1.2, -PI - 0.6, 15);
    }
    d.tip((C.pitIn + C.pitOut) / 2, 1.0, 0.3, 40);
    d.wait(60);
    expect(s.digCount).toBe(1);
    expect(s.dumpCount).toBe(1);
  });

  it('반쯤 쏟고 흙이 남은 채 C를 벗어나도 덤프 1회', () => {
    const s = new DigSession(MACHINE, R, PRACTICE, () => 0.5);
    s.belt = true;
    s.leverUnlocked = true;
    s.rpm = 0.8;
    s.ready();
    for (let i = 0; i < 100; i++) s.step();
    const d = driver(s);
    const [A, C] = s.site.stations;
    d.tip(A.pitOut - 0.1, 0.3, -1.0, 40);
    d.tip(A.pitOut - 0.1, -0.75, -1.0, 40);
    d.pull(A.pitIn + 0.3, -0.65, -1.5, 100); // 반쯤 오므린 채 암으로 당겨 담기
    d.tip(A.pitIn + 0.6, 1.2, -PI - 0.6, 40);
    d.to({ boom: 1.0, arm: -1.9, bucket: -1.4 }, 40);
    d.to({ swing: 0 }, 160);
    d.tip(C.pitIn, 1.2, -PI - 0.6, 40);
    d.tip(C.pitIn + 0.3, 1.1, -PI / 2 + 0.3, 30); // 일부만 쏟음
    d.tip(C.pitIn, 1.2, -PI - 0.6, 15);
    expect(s.load).toBeGreaterThan(0.1 * MACHINE.struckCapacity);
    d.to({ boom: 1.0, arm: -1.9, bucket: -1.4 }, 40);
    d.to({ swing: PI / 2 }, 80); // C를 벗어남
    expect(s.dumpCount).toBe(1);
    expect(Math.abs(s.ledgerError())).toBeLessThan(1e-5);
  });
});
