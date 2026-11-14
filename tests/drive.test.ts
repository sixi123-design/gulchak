import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import { MODES } from '../src/core/ruleEngine';
import { centerline, courseLength, type P } from '../src/sim/drive/course';
import { DriveSession } from '../src/sim/drive/driveSession';
import { DRIVE_LESSONS } from '../src/sim/drive/driveTutorial';
import { Tutor } from '../src/sim/tutorial';
import { scoreDrive } from '../src/sim/score';

const mk = (mode: keyof typeof MODES = 'exam') => {
  const s = new DriveSession(MACHINE, MODES[mode]);
  s.ready();
  return s;
};

/** 중심선 (곡선 앞뒤로 직선 연장) */
function cl(s: DriveSession, d: number): P {
  const c = s.c;
  const len = courseLength(c);
  if (d < 0) return { x: c.startMid.x - c.startDir.x * -d * 0, z: c.startMid.z + d };
  if (d > len) return { x: c.arriveMid.x, z: c.arriveMid.z + (d - len) };
  return centerline(c, d).p;
}
function nearest(s: DriveSession, q: P) {
  let best = 0;
  let bd = Infinity;
  for (let d = -8; d <= courseLength(s.c) + 10; d += 0.05) {
    const p = cl(s, d);
    const e = Math.hypot(p.x - q.x, p.z - q.z);
    if (e < bd) [bd, best] = [e, d];
  }
  return best;
}
/** 순수 추종: 뒷차축이 중심선을 따라가도록 조향 입력 */
function steerTo(s: DriveSession, back: boolean, Ld = 2.2) {
  const d = nearest(s, s.pos);
  const tgt = cl(s, back ? d - Ld : d + Ld);
  const tv = { x: tgt.x - s.pos.x, z: tgt.z - s.pos.z };
  const f = s.fwd;
  const dirv = back ? { x: -f.x, z: -f.z } : f;
  const l = s.left;
  const a = Math.atan2(tv.x * l.x + tv.z * l.z, tv.x * dirv.x + tv.z * dirv.z);
  const want = Math.atan((2 * s.m.wheelbase * Math.sin(a)) / Ld);
  return Math.max(-1, Math.min(1, (want - s.steer) * 6));
}
function run(s: DriveSession, n: number, f: (s: DriveSession, i: number) => boolean | void) {
  for (let i = 0; i < n && !s.finished; i++) {
    if (f(s, i) === true) return true;
    s.step();
  }
  return false;
}

/** 정석 주행: 출발 → 정지선 정지 → 도착 → 후진 → 주차 */
function drive(s: DriveSession, opt: { skipStop?: boolean; keepParking?: boolean } = {}) {
  if (!opt.keepParking) s.setParking(false);
  s.setGear('F');
  // 전진: 정지선까지
  run(s, 60 * 40, (s) => {
    s.input = { steer: steerTo(s, false), accel: 0.5, brake: 0 };
    if (!opt.skipStop && s.stage === 'GO' && !s.stopped && s.inStopZone() && s.stopZonePos() > 0.4) return true;
    if (opt.skipStop && s.stage === 'ARRIVE') return true;
  });
  if (!opt.skipStop) {
    run(s, 60 * 3, (s) => {
      s.input = { steer: 0, accel: 0, brake: 1 };
      if (s.stopped) return true;
    });
    // 도착선까지
    run(s, 60 * 40, (s) => {
      s.input = { steer: steerTo(s, false), accel: 0.5, brake: 0 };
      if (s.stage === 'ARRIVE') return true;
    });
  }
  // 정차 후 후진
  run(s, 60 * 3, (s) => {
    s.input = { steer: steerTo(s, false), accel: 0, brake: 1 };
    if (s.speed === 0) return true;
  });
  s.setGear('R');
  run(s, 60 * 60, (s) => {
    s.input = { steer: steerTo(s, true), accel: 0.5, brake: 0 };
    if (s.stage === 'FINISH' && s.frontInParkZone()) return true;
  });
  run(s, 60 * 3, (s) => {
    s.input = { steer: 0, accel: 0, brake: 1 };
    if (s.speed === 0) return true;
  });
  s.setGear('N');
  s.setParking(true);
}

describe('코스 (공식 도면 작도)', () => {
  it('곡선 1 끝과 곡선 2 시작이 이어지고, 출발선·도착선이 곡선 끝에 있다', () => {
    const s = mk();
    const c = s.c;
    const arc = (135 * Math.PI * c.rc) / 180;
    const a = centerline(c, arc - 1e-6);
    const b = centerline(c, arc + 1e-6);
    expect(Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z)).toBeLessThan(1e-3);
    expect(Math.hypot(a.dir.x - b.dir.x, a.dir.z - b.dir.z)).toBeLessThan(1e-3);
    const s0 = centerline(c, 0).p;
    expect(Math.hypot(s0.x - c.startMid.x, s0.z - c.startMid.z)).toBeLessThan(1e-6);
    const e = centerline(c, courseLength(c)).p;
    expect(Math.hypot(e.x - c.arriveMid.x, e.z - c.arriveMid.z)).toBeLessThan(1e-6);
    // 공식 수치: L = 2.7E, 폭 1.8D, 중심선 L - 0.9D
    expect(c.L).toBeCloseTo(2.7 * MACHINE.wheelbase);
    expect(c.width).toBeCloseTo(1.8 * MACHINE.trackWidth);
    expect(c.rc).toBeCloseTo(c.L - 0.9 * MACHINE.trackWidth);
  });
  it('시작: 앞바퀴가 주차구역 안, 주차브레이크·중립', () => {
    const s = mk();
    expect(s.frontInParkZone()).toBe(true);
    expect(s.parking).toBe(true);
    expect(s.gear).toBe('N');
  });
});

describe('코스운전 판정', () => {
  it('정석대로 돌면 실격 없이 끝나고 주차 인정', () => {
    const s = mk();
    let minGap = Infinity;
    s.onHint(() => {});
    const orig = s.step.bind(s);
    s.step = (dt?: number) => {
      orig(dt);
      const g = s.leftGap();
      if (g !== null && s.stage === 'GO') minGap = Math.min(minGap, g);
    };
    drive(s);
    console.log('task', s.taskT.toFixed(1), 'viol', s.engine.violations.map((v) => v.id + ':' + v.detail), 'minLeftGap', minGap.toFixed(2), 'stage', s.stage);
    expect(s.engine.disqualifications()).toEqual([]);
    expect(s.finished).toBe(true);
    expect(s.parkedOk).toBe(true);
    const sc = scoreDrive(s);
    expect(sc.pass, JSON.stringify(sc.items)).toBe(true);
    expect(sc.total).toBeGreaterThanOrEqual(80);
    expect(s.taskT).toBeGreaterThan(10);
    expect(s.taskT).toBeLessThan(120);
  });
  it('정지선에서 안 멈추면 D-NOSTOP', () => {
    const s = mk('practice');
    drive(s, { skipStop: true });
    expect(s.engine.disqualifications().map((v) => v.id)).toContain('D-NOSTOP');
  });
  it('주차브레이크 걸린 채 출발선을 넘으면 D-PBRAKE', () => {
    const s = mk('practice');
    s.setGear('F');
    run(s, 60 * 30, (s) => {
      s.input = { steer: steerTo(s, false), accel: 1, brake: 0 };
      if (s.stage === 'GO') return true;
    });
    expect(s.engine.disqualifications().map((v) => v.id)).toContain('D-PBRAKE');
  });
  it('도착선 전에 후진하면 D-NOEND', () => {
    const s = mk('practice');
    s.setParking(false);
    s.setGear('F');
    run(s, 60 * 10, (s) => {
      s.input = { steer: steerTo(s, false), accel: 0.5, brake: 0 };
    });
    run(s, 60 * 3, (s) => {
      s.input = { steer: 0, accel: 0, brake: 1 };
      if (s.speed === 0) return true;
    });
    s.setGear('R');
    run(s, 60 * 2, (s) => {
      s.input = { steer: 0, accel: 0.5, brake: 0 };
    });
    expect(s.engine.disqualifications().map((v) => v.id)).toContain('D-NOEND');
  });
  it('핸들을 안 감고 직진하면 바퀴가 선에 닿아 D-LINE', () => {
    const s = mk('practice');
    s.setParking(false);
    s.setGear('F');
    run(s, 60 * 15, (s) => {
      s.input = { steer: 0, accel: 0.5, brake: 0 };
    });
    expect(s.engine.disqualifications().map((v) => v.id)).toContain('D-LINE');
  });
  it('1분 안에 출발 안 하면 D-START', () => {
    const s = mk('practice');
    run(s, 60 * 61, () => {});
    expect(s.engine.disqualifications().map((v) => v.id)).toContain('D-START');
  });
  it('움직이는 중 기어 변경은 무시하고 경고', () => {
    const s = mk('practice');
    s.setParking(false);
    s.setGear('F');
    run(s, 60 * 2, (s) => {
      s.input = { steer: 0, accel: 1, brake: 0 };
    });
    s.setGear('R');
    expect(s.gear).toBe('F');
    expect(s.engine.violations.map((v) => v.id)).toContain('W-GEAR');
  });
  it('실제 시험: 실격하면 바로 끝', () => {
    const s = mk('exam');
    s.setParking(false);
    s.setGear('F');
    run(s, 60 * 15, (s) => {
      s.input = { steer: 0, accel: 0.5, brake: 0 };
    });
    expect(s.finished).toBe(true);
  });
});

describe('주행 배우기', () => {
  const lesson = (id: string) => DRIVE_LESSONS.find((l) => l.id === id)!;
  /** 미션 하나: 단계마다 조작 함수, 조작 전 한 번 할 일 */
  function play(id: string, ctl: ((s: DriveSession) => Partial<DriveSession['input']> | void)[], pre: ((s: DriveSession) => void)[] = []) {
    const s = mk('tutorial');
    const t = new Tutor(lesson(id), s);
    expect(t.cleared).toBe(false);
    for (let k = 0; k < ctl.length && !t.cleared; k++) {
      pre[k]?.(s);
      const start = t.step;
      for (let i = 0; i < 60 * 60 && t.step === start && !t.cleared; i++) {
        const inp = ctl[k](s);
        s.input = { steer: 0, accel: 0, brake: 0, ...(inp ?? {}) };
        t.update();
        if (t.step !== start || t.cleared) break;
        s.step();
      }
    }
    return { s, t };
  }
  const fwd = (s: DriveSession) => ({ steer: steerTo(s, false), accel: 0.5 });
  const back = (s: DriveSession) => ({ steer: steerTo(s, true), accel: 0.5 });
  const brake = () => ({ brake: 1 });
  const ok = (r: { s: DriveSession; t: Tutor<DriveSession> }) => {
    expect(r.t.cleared, `단계 ${r.t.step + 1}에서 멈춤`).toBe(true);
    expect(r.s.engine.disqualifications()).toEqual([]);
  };
  it('출발 · 첫 곡선: 출발선에서 끝까지 감고 계속 감으며 돌면 선 안 밟음', () =>
    ok(play('d-start', [() => {}, () => {}, () => ({ accel: 0.6 }), () => ({ steer: 1, accel: 0.6 }), () => ({ steer: 1, accel: 0.6 })], [(s) => s.setParking(false), (s) => s.setGear('F')])));
  it('출발 · 첫 곡선: 출발 전에 미리 끝까지 감으면 안쪽 선을 밟음 (예전 잘못된 안내)', () => {
    const s = new DriveSession(MACHINE, MODES.practice);
    s.ready();
    s.setParking(false);
    s.setGear('F');
    for (let i = 0; i < 60 * 15 && !s.engine.disqualifications().length; i++) {
      s.input = { steer: 1, accel: 0.6, brake: 0 };
      s.step(1 / 60);
    }
    expect(s.engine.disqualifications().map((d) => d.id)).toContain('D-LINE');
  });
  it('정지선 정지', () => ok(play('d-stop', [fwd, brake])));
  it('도착선 통과: 서서히 출발하며 조금씩 감아 왼쪽 선 80cm', () => ok(play('d-arrive', [fwd, fwd, fwd, brake])));
  it('S자 후진: 도착선 막 넘어 서서 오른쪽 끝까지 감고 후진 → 정지선 앞에서 풀기', () =>
    ok(play('d-back', [() => {}, () => ({ steer: -1 }), () => ({ steer: -1, accel: 0.5 }), back, back, back], [(s) => s.setGear('R')])));
  it('S자 후진 (중심선 따라)', () => ok(play('d-back', [() => {}, () => ({ steer: -1 }), back, back, back, back], [(s) => s.setGear('R')])));
  it('종료·주차', () =>
    ok(
      play('d-park', [back, (s) => (s.frontInParkZone() ? brake() : { ...back(s), accel: 0.3 }), () => {}], [
        () => {},
        () => {},
        (s) => {
          s.setGear('N');
          s.setParking(true);
        },
      ]),
    ));
  it('모든 미션: 시작하자마자 끝나 있지 않음', () => {
    for (const l of DRIVE_LESSONS) {
      const s = mk('tutorial');
      const t = new Tutor(l, s);
      t.update();
      expect(t.step, l.id).toBe(0);
    }
  });
});

describe('화면 핸들 (유압 조향)', () => {
  const run = (s: DriveSession, n: number, inp: Partial<{ steer: number; accel: number; brake: number; wheelDelta: number }>) => {
    for (let i = 0; i < n; i++) {
      s.input = { steer: 0, accel: 0, brake: 0, ...inp };
      s.step(1 / 60);
    }
  };
  it('핸들을 돌린 만큼(조향비 18) 바퀴가 꺾이고, 끝에 닿으면 핸들도 더 안 돌아감', () => {
    const s = new DriveSession(MACHINE, MODES.free);
    const turn = 2 * Math.PI; // 한 바퀴
    run(s, 60, { wheelDelta: turn / 60 });
    expect(s.steer).toBeCloseTo(turn / s.p.steerRatio, 3);
    expect(s.wheelAngle).toBeCloseTo(turn, 3);
    run(s, 60, { wheelDelta: turn / 60 }); // 한 바퀴 더 → 끝(35°)에서 멈춤
    expect(s.steer).toBeCloseTo(s.p.maxSteer, 3);
    expect(s.wheelAngle).toBeCloseTo(s.p.maxSteer * s.p.steerRatio, 3); // 1.75바퀴에서 핸들도 멈춤
    expect(s.lockPush).toBeCloseTo(2 * Math.PI - (s.p.maxSteer * s.p.steerRatio - 2 * Math.PI), 3); // 끝에서 더 돌리려 한 양 (화면 '끝' 표시용)
  });
  it('서 있으면 그대로, 달리는 동안 계속 감지 않으면 바퀴가 풀림', () => {
    const s = new DriveSession(MACHINE, MODES.free);
    s.setParking(false);
    s.setGear('F');
    run(s, 60, { wheelDelta: (2 * Math.PI) / 60 });
    const a = s.steer;
    run(s, 60, {});
    expect(s.steer).toBeCloseTo(a, 6); // 정지: 안 풀림
    run(s, 120, { accel: 1 });
    expect(s.steer).toBeLessThan(a - (2 * Math.PI) / 180); // 달리면 풀림
    const b = s.steer;
    run(s, 60, { accel: 1, wheelDelta: 0.02 }); // 계속 감으면 유지·증가
    expect(s.steer).toBeGreaterThan(b);
  });
});
