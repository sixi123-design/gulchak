import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { FREE, PRACTICE } from '../src/core/ruleEngine';
import { ik } from '../src/sim/kinematics';
import { DigSession, type RulesFile, type Sticks } from '../src/sim/session';
/** 꽂는 깊이를 붐 속도와 무관하게: 예전 붐 내림 속도(28°/s)와 같은 속도가 되는 레버 크기 */
/** 파는 중 '붐 살짝 올림': 예전 붐 올림 속도(28°/s)에서 0.1 레버와 같은 속도 */
const UP = (0.1 * 28 * Math.PI) / 180 / MACHINE.speeds.boom;
const DN = (28 * Math.PI) / 180 / (MACHINE.speeds.boom * MACHINE.boomDownGain);

/** 퍼 담기 요령: 각도를 잡고 얕게 꽂아 당기며 오므려 쓸어 담는다. 잘못된 각도·과한 힘은 부하·들림으로 드러난다 */
const R = rules as unknown as RulesFile;
function sess(rpm = 0.8) {
  const s = new DigSession(MACHINE, R, PRACTICE, () => 0.5);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = rpm;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  return s;
}
function run(s: DigSession, phases: [number, Partial<Sticks>][]) {
  let maxLift = 0;
  for (const [n, inp] of phases)
    for (let i = 0; i < n; i++) {
      s.input = { lx: 0, ly: 0, rx: 0, ry: 0, ...inp };
      s.step();
      maxLift = Math.max(maxLift, s.lift);
    }
  const ids = new Set(s.engine.violations.map((v) => v.id));
  return { ids, liftDeg: (maxLift * 180) / Math.PI };
}
const SC = MACHINE.struckCapacity;

describe('퍼 담기 요령', () => {
  it('이빨을 박고 버킷만 오므리면 입구 쪽에만 조금 담기고 나머지는 날 앞에 쌓임 (암을 당겨야 가득 참)', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    let maxSur = 0;
    for (let i = 0; i < 170; i++) {
      s.input = { lx: 0, ly: 0, ...(i < 35 ? { rx: 0, ry: DN } : { rx: -0.6, ry: 0 }) }; // 꽂은 뒤 버킷 레버만
      s.step();
      maxSur = Math.max(maxSur, s.surcharge);
    }
    // 입구 쪽에 조금은 담기고(앞쪽 위주), 가득 차려면 암을 당겨야 함
    expect(s.load).toBeGreaterThan(0.15 * SC);
    expect(s.load).toBeLessThan(0.6 * SC);
    expect(s.load - s.loadBack).toBeGreaterThan(s.loadBack);
    expect(maxSur).toBeGreaterThan(0.1 * SC);
    expect(s.loadBack).toBeLessThanOrEqual((R.params.curlBackCapRatio + 0.01) * SC);
  });
  it('흙에 닿은 채 암을 당기며 오므리면 입구부터 쌓인 뒤 안쪽으로 밀려 들어가 고봉까지 찬다', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[26, { ry: DN }], [30, { ly: -0.7, rx: -0.6, ry: -UP }]]);
    // 처음 0.5초: 입구 쪽이 먼저
    expect(s.load - s.loadBack).toBeGreaterThan(s.loadBack);
    run(s, [[190, { ly: -0.7, rx: -0.6, ry: -UP }]]);
    expect(s.load).toBeGreaterThan(SC);
    expect(s.loadBack).toBeGreaterThan(0.75 * SC);
    expect(s.load).toBeLessThanOrEqual(s.heapedCap + 1e-9);
  });
  it('수직으로 꽂기만 하면 흙이 담기지 않음', () => {
    const s = sess();
    const A = s.site.stations[0];
    s.setPose(ik(MACHINE, (A.pitIn + A.pitOut) / 2 + 0.3, 0.2, -Math.PI / 2)!);
    run(s, [[150, { ry: 1 }]]);
    expect(s.load).toBeLessThan(0.05 * SC);
  });
  it('비스듬히 꽂으면 조금만 들어가고, 당기며 오므려야 가득 찬다 (경고 없음)', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[26, { ry: DN }]]); // 흙 표면에서 20~30cm만 물기
    expect(s.load).toBeLessThan(0.25 * SC);
    // 암을 당기며 오므리고, 붐을 살짝 올려 깊이를 유지 (바른 요령)
    const r = run(s, [[200, { ly: -0.7, rx: -0.6, ry: -UP }]]);
    expect(s.load).toBeGreaterThan(SC);
    expect(s.loadBack / s.load).toBeGreaterThan(0.5); // 안쪽까지 밀려 들어감
    expect(r.ids.has('W-OVERLOAD')).toBe(false);
    expect(r.ids.has('W-LIFT')).toBe(false);
  });
  it('버킷을 편 채 암만 당겨 흙을 밀면, 밀린 흙이 벽처럼 솟지 않고 흘러내린다', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho + 0.3, -0.35, -0.2)!);
    // 밀고 나서 붐을 들어 버킷을 흙에서 완전히 빼고(버킷 옆판이 받치던 흙·날 앞 흙더미가 풀림) 흘러내리기를 기다림
    run(s, [[300, { ly: -0.8, ry: 0.15 }], [150, { ry: -1 }], [150, {}]]);
    expect(s.surcharge).toBe(0);
    const g = s.soil.grids[0];
    const phi = (R.params.reposeDeg * Math.PI) / 180;
    const talus = Math.tan(phi) * g.cell;
    let peak = -9;
    let step = 0;
    let loose = 0;
    for (let k = 0; k < g.h.length; k++) {
      peak = Math.max(peak, g.h[k]);
      loose += Math.max(0, g.h[k] - g.firm[k]) * g.area;
    }
    // x·z 두 방향 이웃 모두 (옆으로 밀려 생긴 둑의 경사 포함)
    const pairStep = (a: number, b: number) => {
      // 흐트러진 흙끼리의 경사만 (다져진 벽은 버팀)
      if (Math.max(g.h[a], g.h[b]) > Math.max(g.firm[a], g.firm[b]) + 0.05) step = Math.max(step, Math.abs(g.h[a] - g.h[b]));
    };
    for (let j = 0; j < g.nz; j++)
      for (let i = 0; i < g.nx; i++) {
        if (i + 1 < g.nx) pairStep(g.idx(i, j), g.idx(i + 1, j));
        if (j + 1 < g.nz) pairStep(g.idx(i, j), g.idx(i, j + 1));
      }
    // 본 기준: 벽처럼 선 흐트러진 흙 없음 — 이웃 칸 높이 차가 안식각(35°) 이내
    expect(step).toBeLessThan(talus * 1.05);
    // 높이: 버킷 몸통이 지나간 공간의 흙까지 밀려나므로(측정: 흐트러진 흙 약 1.1m³) 고정 30cm 대신 물리 상한으로 —
    // 같은 부피를 안식각 원뿔 하나로 쌓은 높이보다 낮아야 함 (한 점에 기둥처럼 솟지 않음)
    const cone = Math.cbrt((3 * loose * Math.tan(phi) ** 2) / Math.PI);
    expect(peak).toBeLessThan(cone);
    expect(loose).toBeGreaterThan(0.3);
  });
  it('첫 삽을 너무 깊이 박으면 버킷이 잘 안 오므라지고 과부하, 적당하면 오므라짐', () => {
    const scoop = (plunge: number) => {
      const s = sess();
      s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
      const r = run(s, [[plunge, { ry: DN }], [180, { ly: -0.5, rx: -1 }]]);
      return { bucket: s.pose.bucket, ids: r.ids };
    };
    const ok = scoop(35);
    const deep = scoop(70);
    expect(ok.bucket).toBeLessThan(-0.6);
    expect(ok.ids.has('W-OVERLOAD')).toBe(false);
    expect(deep.bucket).toBeGreaterThan(-0.45); // 거의 안 오므라짐
    expect(deep.ids.has('W-OVERLOAD')).toBe(true);
  });
  it('깊게 욕심내 물면 엔진 과부하', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    const r = run(s, [[90, { ry: 1 }], [150, { ly: -0.6, rx: -1 }]]);
    expect(r.ids.has('W-OVERLOAD')).toBe(true);
  });
  it('버킷 등으로 구덩이 벽을 밀면 과부하·차체 들림', () => {
    const s = sess();
    const A = s.site.stations[0];
    s.setPose(ik(MACHINE, A.pitIn + 0.6, -0.6, 0.3)!);
    const r = run(s, [[200, { ly: 1, ry: 0.4 }]]);
    expect(r.ids.has('W-OVERLOAD')).toBe(true);
    expect(r.liftDeg).toBeGreaterThan(2);
  });
  it('붐으로 단단한 땅을 누르면 차체가 들림 (W-LIFT)', () => {
    const s = sess();
    s.setPose(ik(MACHINE, 3.6, 0.3, -Math.PI / 2)!);
    const r = run(s, [[200, { ry: 1 }]]);
    expect(r.ids.has('W-LIFT')).toBe(true);
    expect(r.liftDeg).toBeGreaterThan(2);
  });
  it('시험 순서 모드: 붐으로 계속 눌러 크게 들리면 실격 (D-LIFT), 살짝 들리면 경고만', () => {
    const s = sess();
    s.setPose(ik(MACHINE, 3.6, 0.3, -Math.PI / 2)!);
    const r = run(s, [[400, { ry: 1 }]]);
    expect(r.liftDeg).toBeGreaterThan(R.params.liftFailDeg);
    expect(r.ids.has('D-LIFT')).toBe(true);
    const s2 = sess();
    s2.setPose(ik(MACHINE, s2.digTarget.rho, 0.2, -0.9)!);
    const r2 = run(s2, [[26, { ry: DN }], [220, { ly: -0.7, rx: -0.6, ry: -UP }]]);
    expect(r2.ids.has('D-LIFT')).toBe(false);
  });
  it('자유 연습에서는 크게 들려도 실격 없음 (경고만)', () => {
    const s = new DigSession(MACHINE, R, FREE, () => 0.5);
    s.belt = true;
    s.leverUnlocked = true;
    s.rpm = 0.8;
    s.ready();
    for (let i = 0; i < 100; i++) s.step();
    s.setPose(ik(MACHINE, 3.6, 0.3, -Math.PI / 2)!);
    const r = run(s, [[400, { ry: 1 }]]);
    expect(r.ids.has('W-LIFT')).toBe(true);
    expect(r.ids.has('D-LIFT')).toBe(false);
  });
  it('rpm을 낮춘 채 파면 엔진이 꺼진다 (D-STALL, Q10)', () => {
    const s = sess(0.3);
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    const r = run(s, [[90, { ry: 1 }], [150, { ly: -0.6, rx: -1 }]]);
    expect(r.ids.has('D-STALL')).toBe(true);
  });
  it('흙이 조금 떨어져도 C 구덩이 벽은 무너지지 않음 (다져진 흙)', () => {
    const s = sess();
    const g = s.soil.grids[1];
    const C = s.site.stations[1];
    const mid = (C.pitIn + C.pitOut) / 2;
    g.depositSpread(g.cellAt(mid, 0), 0.01);
    for (let i = 0; i < 300; i++) s.step();
    expect(g.heightAt(C.pitOut + 0.1, 0)).toBeGreaterThan(-0.02);
    expect(g.heightAt(mid, C.pitHalfW + 0.1)).toBeGreaterThan(-0.02);
  });
});

describe('퍼 담기 요령 (아스트라 검토 반영)', () => {
  it('여러 버킷 각도로 수직 하강만 하면 담기지 않음', () => {
    for (const thK of [-Math.PI / 2, -Math.PI / 2 - 0.4, -Math.PI / 2 + 0.4, -1.0]) {
      const s = sess();
      const A = s.site.stations[0];
      const q = ik(MACHINE, (A.pitIn + A.pitOut) / 2 + 0.3, 0.2, thK)!;
      s.setPose(q);
      // 붐 대신 자세를 직접 아래로만 이동 (순수 하강)
      for (let i = 1; i <= 60; i++) {
        const qq = ik(MACHINE, (A.pitIn + A.pitOut) / 2 + 0.3, 0.2 - i * 0.012, thK);
        if (qq) s.setPose(qq);
        s.step();
      }
      expect(s.load).toBeLessThan(0.02 * SC);
    }
  });
  it('오므리지 않고 암으로 끌기만 하면 덜 담기고, 오므리면 더 담김', () => {
    const drag = (curl: number) => {
      const s = sess();
      s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
      run(s, [[40, { ry: DN }]]);
      // 오므림은 반쯤(정석)까지만: 끝까지 오므리면 입구가 좁아져 덜 들어옴 (코치도 '반쯤 펴기')
      const step = (n: number) => {
        for (let i = 0; i < n; i++) {
          s.input = { lx: 0, ly: -0.7, rx: s.pose.bucket > -0.8 ? curl : 0, ry: 0 };
          s.step();
        }
      };
      step(130);
      const early = s.load;
      // 오므림은 흙을 날 앞에 모으고 암 당김이 쓸어 담으므로, 담김 한도까지 갈 만큼 더 당김
      step(400);
      return { early, load: s.load };
    };
    const noCurl = drag(0);
    const withCurl = drag(-0.6);
    // 원래 시간대(130스텝) 회귀값: 둘 다 평적 40% 이상은 담김
    expect(noCurl.early).toBeGreaterThan(0.4 * SC);
    expect(withCurl.early).toBeGreaterThan(0.4 * SC);
    // 끝까지 당기면: 끌기만 하면 평적 절반 남짓에서 멈추고, 반쯤 오므려 당기면 훨씬 더 담김
    expect(withCurl.load).toBeGreaterThan(noCurl.load * 1.4);
  });
  it('천천히 내려도 단단한 바닥을 뚫지 않음', () => {
    const s = sess();
    s.setPose(ik(MACHINE, 3.6, 0.3, -Math.PI / 2)!);
    run(s, [[1500, { ry: 0.25 }]]); // 아주 느린 붐 내림
    const floor = s.soil.floorAt(-s.frame.tip.r, 0);
    expect(s.frame.tip.y).toBeGreaterThan(floor - 0.012);
  });
  it('첫 삽 위치는 버킷 날이 처음 깎은 지점', () => {
    const s = sess();
    const got: number[] = [];
    s.onDigEntry((e) => got.push(e.dr));
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[40, { ry: DN }]]);
    expect(got.length).toBe(1);
    expect(Math.abs(got[0])).toBeLessThan(0.2);
  });
});

describe('버킷 속 흙 분포·이빨', () => {
  it('실기 요령: 버킷 오므린 뒤 오므림을 멈추고 암만 당겨도 눌러 담겨 평적 80% 이상', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[40, { ry: DN }], [150, { rx: -0.6, ry: -UP }]]);
    expect(s.load).toBeLessThan(0.8 * SC); // 오므림만으론 덜 참
    run(s, [[120, { ly: -0.7 }]]); // 무거운 흙: 암 당김 시간 여유
    expect(s.load).toBeGreaterThan(0.8 * SC);
    expect(s.loadBack / s.load).toBeGreaterThan(0.5);
  });
  it('오므리지 않고 끌기만 하면 흙이 앞쪽에 몰리고, 들어 올리면 앞쪽 흙이 쏟아진다', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[26, { ry: DN }], [130, { ly: -0.7, rx: 0, ry: -UP }]]);
    const before = s.load;
    expect(s.loadBack / Math.max(before, 1e-9)).toBeLessThan(0.5); // 앞쪽에만 수북
    run(s, [[90, { ry: -1 }]]); // 오므리지 않고 붐만 올림
    expect(s.load).toBeLessThan(before * 0.8);
  });
  it('오므려 안쪽까지 밀어 넣으면 들어 올려도 버틴다', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    // 당기며 오므린 뒤, 오므리면서 들어 올림 (흙 속에서는 오므림이 무거워 느림)
    run(s, [[26, { ry: DN }], [200, { ly: -0.7, rx: -0.6, ry: -UP }], [200, { rx: -0.8, ry: -0.5 }]]);
    expect(s.pose.bucket).toBeLessThan(-1.3); // 오므리며 들어 올리면 75° 이상 오므려짐
    const before = s.load;
    expect(s.loadBack / before).toBeGreaterThan(0.6);
    run(s, [[90, { ry: -1 }]]);
    // 고봉 위의 푸석한 흙(무너진 구덩이 벽 흙 포함)만 흘러내리고, 안쪽까지 다져 담은 흙은 평적 85% 이상 남음
    expect(s.load).toBeGreaterThan(MACHINE.struckCapacity * 0.85);
  });
  it('버킷을 펴고 이빨로 밀면 이빨 자국(골)이 남는다', () => {
    const s = sess();
    const C = s.site.stations[1];
    s.setPose({ swing: 0 });
    // 구덩이 밖 굴착장 흙바닥(높이 0)을 버킷을 펴서 날 끝이 살짝 숙인 채 앞으로 밂
    const lat = 0;
    const path = (r: number) => ik(MACHINE, r, -0.03, -0.35);
    s.setPose(path(C.zoneIn - 0.9)!);
    for (let i = 0; i <= 60; i++) {
      const q = path(C.zoneIn - 0.9 + (0.7 * i) / 60);
      if (q) s.setPose(q);
      s.step();
    }
    const g = s.soil.grids[1];
    const r = C.zoneIn - 0.5;
    const W = MACHINE.bucketWidth;
    const teeth = [0, 1, 2, 3, 4].map((i) => g.heightAt(r, lat - W / 2 + 0.08 + ((W - 0.16) * i) / 4));
    const gaps = [0, 1, 2, 3].map((i) => g.heightAt(r, lat - W / 2 + 0.08 + ((W - 0.16) * (i + 0.5)) / 4));
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(gaps) - avg(teeth)).toBeGreaterThan(0.01);
  });
});

describe('자연스러운 퍼 올리기', () => {
  it('퍼면서 최대한 오므리며 흙에서 꺼내도 덜컹 경고가 없다 (실린더 쿠션)', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    // 꽂고 → 잠깐 멈춤 → 당기며 오므림 → 최대한 오므리며 들어 올림 (자연스러운 손동작)
    run(s, [[26, { ry: DN }], [12, {}], [200, { ly: -0.7, rx: -0.6, ry: -UP }], [240, { rx: -1, ry: -0.6 }], [60, { ry: -0.6 }]]);
    expect(s.pose.bucket).toBeLessThan(MACHINE.limits.bucket[0] + 0.14); // 끝까지 오므려짐 (쿠션 구간에서는 천천히)
    expect(s.engine.violations.filter((v) => v.id === 'W-JOLT')).toEqual([]);
  });
});

describe('끝까지 오므리기 (시험 기본 동작)', () => {
  it('흙 밖에서 버킷을 끝까지 오므리는 데 오래 걸리지 않는다 (쿠션 구간 짧음)', () => {
    const s = sess();
    s.setPose({ boom: 0.8, arm: -1.5, bucket: 0.5 });
    let t = 0;
    while (s.pose.bucket > MACHINE.limits.bucket[0] + 0.02 && t < 600) {
      s.input = { lx: 0, ly: 0, rx: -1, ry: 0 };
      s.step();
      t++;
    }
    // 205° 회전: 최대 속도(약 48°/s)로 약 4.3초 + 가속·쿠션 여유
    expect(t / 60).toBeLessThan(5.2);
    expect(s.engine.violations.filter((v) => v.id === 'W-JOLT')).toEqual([]);
  });
  it('끝까지 오므린 채 선회하면 흙을 거의 흘리지 않는다', () => {
    const s = sess();
    s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
    run(s, [[26, { ry: DN }], [12, {}], [130, { ly: -0.7, rx: -0.6, ry: -UP }], [150, { rx: -1, ry: -0.6 }], [80, { ry: -0.6 }]]);
    const before = s.load;
    run(s, [[200, { lx: -0.5 }]]); // A → B 쪽으로 선회
    expect(s.carrySpill).toBeLessThan(before * 0.05);
  });
});

describe('소리 상태', () => {
  it('버킷을 끝까지 오므린 채 레버를 계속 당기면 릴리프 상태가 된다', () => {
    const s = sess();
    s.setPose({ boom: 0.8, arm: -1.5, bucket: -1.0 });
    run(s, [[400, { rx: -1 }]]);
    expect(s.reliefLevel).toBeGreaterThan(0.8);
    run(s, [[40, {}]]);
    expect(s.reliefLevel).toBeLessThan(0.1); // 레버를 놓으면 멈춤
  });
  it('버킷을 펴서 흙을 쏟으면 쏟는 소리 → 떨어지는 소리·먼지 자리가 생긴다', () => {
    const s = sess();
    s.setPose({ boom: 0.6, arm: -1.2, bucket: -2.0 });
    s.load = SC;
    s.loadBack = SC * 0.8;
    expect(s.pourRate).toBe(0);
    let maxPour = 0;
    let maxLand = 0;
    let events = 0;
    for (let i = 0; i < 300; i++) {
      s.input = { lx: 0, ly: 0, rx: i < 160 ? 1 : 0, ry: 0 };
      s.step();
      maxPour = Math.max(maxPour, s.pourRate);
      maxLand = Math.max(maxLand, s.landRate);
      events += s.landEvents.length;
      s.landEvents.length = 0;
    }
    expect(maxPour).toBeGreaterThan(0.2);
    expect(maxLand).toBeGreaterThan(0.1);
    expect(events).toBeGreaterThan(5);
    expect(s.pourRate).toBeLessThan(0.01); // 다 쏟고 나면 조용해짐
    expect(s.landRate).toBeLessThan(0.01);
  });
});

describe('깊은 구덩이 벽', () => {
  it('다져진 벽도 0.6m 넘게 깎아 세우면 무너져 바닥에 쌓이고, 흙 양은 그대로', () => {
    const s = sess();
    const g = s.soil.grids.find((x) => x.name === 'A')!;
    const st = s.site.stations[0];
    // 구덩이 가운데 한 줄을 1.1m 깊이로 수직으로 깎음 (옆 칸과 0.6m 넘는 단차)
    const v0 = g.volumeDelta();
    let cutVol = 0;
    for (let j = 0; j < g.nz; j++)
      for (let i = 0; i < g.nx; i++) {
        const k = g.idx(i, j);
        const rho = g.xOf(i) * st.axis.x;
        if (g.pit[k] && Math.abs(rho - (st.pitIn + st.pitOut) / 2) < 0.06) cutVol += g.cut(k, -1.6);
      }
    const maxStep = () => {
      let m = 0;
      for (let k = 0; k + 1 < g.h.length; k++) if ((k + 1) % g.nx) m = Math.max(m, Math.abs(g.h[k] - g.h[k + 1]));
      return m;
    };
    expect(maxStep()).toBeGreaterThan(0.9);
    const talus = Math.tan((s.params.reposeDeg * Math.PI) / 180) * s.params.soilCell;
    for (let n = 0; n < 200; n++) g.relax(talus, 2, s.params.wallStableHeight);
    expect(maxStep()).toBeLessThan(s.params.wallStableHeight + 0.05);
    expect(g.volumeDelta()).toBeCloseTo(v0 - cutVol, 6);
  });
});
