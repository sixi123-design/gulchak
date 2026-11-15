import { describe, expect, it } from 'vitest';
import { MACHINE } from '../src/config/machine';
import { MODES } from '../src/core/ruleEngine';
import { DriveSession } from '../src/sim/drive/driveSession';
import { bTarget, DRIVE_LESSONS, sTarget } from '../src/sim/drive/driveTutorial';
import { Tutor } from '../src/sim/tutorial';

/**
 * 수험생이 화면 문구를 글자 그대로 따라 할 때 (화면 핸들을 사람 속도로 돌리고, 페달 세기·감는 속도를 바꿔 가며)
 * 미션이 실격 없이 끝나는가. 코치 문구가 뜨면 그 라벨대로 고친다.
 */
const deg = Math.PI / 180;
interface V {
  accel: number;
  /** 핸들 돌리는 속도 (바퀴/초) */
  rate: number;
}
type Ctl = (s: DriveSession, v: V) => { accel?: number; brake?: number; wheel?: number };
/** 핸들 방향: +1 왼쪽 감기, -1 오른쪽, 0 그대로. 'center'는 곧게 풀기 */
/** 게이지 바늘을 초록 칸에 */
const needleTrack = (s: DriveSession) => Math.max(-1, Math.min(1, (sTarget(s) - s.steer) / (5 * deg)));
const bTrack = (s: DriveSession) => Math.max(-1, Math.min(1, (bTarget(s) - s.steer) / (5 * deg)));
const toCenter = (s: DriveSession) => (Math.abs(s.steer) < 1 * deg ? 0 : -Math.sign(s.steer));

const POLICY: Record<string, Ctl[]> = {
  'd-start': [
    () => ({}),
    () => ({}),
    (_s, v) => ({ accel: v.accel }),
    () => ({ wheel: 1 }),
    (_s, v) => ({ accel: v.accel, wheel: 1 }),
  ],
  'd-stop': [(_s, v) => ({ accel: v.accel, wheel: 1 }), () => ({ brake: 1 })],
  'd-arrive': [
    // 게이지(맞출 핸들 각)를 보며 핸들
    (s, v) => ({ accel: v.accel * 0.6, wheel: needleTrack(s) }),
    (s, v) => ({ accel: v.accel * 0.6, wheel: needleTrack(s) }),
    (_s, v) => ({ accel: v.accel, wheel: -1 }),
    () => ({ brake: 1 }),
  ],
  'd-back': [
    () => ({}),
    () => ({ wheel: -1 }),
    (_s, v) => ({ accel: v.accel, wheel: -1 }),
    (s, v) => ({ accel: v.accel * 0.6, wheel: bTrack(s) }),
    (s, v) => ({ accel: v.accel * 0.6, wheel: bTrack(s) }),
    (_s, v) => ({ accel: v.accel, wheel: 1 }),
  ],
  'd-park': [
    (s, v) => ({ accel: v.accel, wheel: toCenter(s) }),
    (s, v) => (s.frontInParkZone() ? { brake: 1 } : { accel: Math.min(v.accel, 0.3) }),
    () => ({}),
  ],
};
const PRE: Record<string, ((s: DriveSession) => void)[]> = {
  'd-start': [(s) => s.setParking(false), (s) => s.setGear('F')],
  'd-back': [(s) => s.setGear('R')],
  'd-park': [() => {}, () => {}, (s) => (s.setGear('N'), s.setParking(true))],
};

/** 코치 안내 한 번에 돌리는 핸들 양 (바퀴) */
const NUDGE = 0.25;

function play(id: string, v: V) {
  const l = DRIVE_LESSONS.find((x) => x.id === id)!;
  const s = new DriveSession(MACHINE, MODES.tutorial);
  s.ready();
  const t = new Tutor(l, s);
  const pol = POLICY[id];
  const log: string[] = [];
  let lastStep = -1;
  let seen = '';
  let nudge = 0;
  let cyc = 0;
  for (let i = 0; i < 60 * 120 && !t.cleared; i++) {
    t.update();
    if (t.cleared) break;
    if (t.step !== lastStep) {
      lastStep = t.step;
      PRE[id]?.[t.step]?.(s);
    }
    const c = pol[t.step](s, v);
    let wheel = c.wheel ?? 0;
    let accel = c.accel ?? 0;
    let brake = c.brake ?? 0;
    // 코치 문구가 있으면 그 라벨대로 고침
    const co = t.coach;
    // 새 안내를 보면 그쪽으로 핸들을 1/4바퀴 돌리고 다시 원래대로 (사람처럼 한 번 보고 고침).
    // 보정은 시간이 아니라 양 기준: 손이 빠른 사람도 한 번에 1/4바퀴 (아스트라 2026-11-15. 0.4초 기준이면 2.5바퀴/초에서 한 번에 0.6바퀴를 휘두름)
    if (co && co.msg !== seen) (seen = co.msg), (nudge = NUDGE), (cyc = 0);
    // 같은 안내가 계속 떠 있으면 잠깐(0.4초) 보고 또 1/4바퀴
    if (co && nudge === 0 && ++cyc >= 24) (nudge = NUDGE), (cyc = 0);
    if (!co) seen = '';
    if (co) {
      if (!log.includes(co.msg)) log.push(co.msg);
      if (nudge > 0) {
        // 이번 프레임에 돌릴 양 (바퀴) — 남은 보정량을 넘지 않게
        const a = Math.min(0.6, nudge / (v.rate / 60));
        nudge = Math.max(0, nudge - a * (v.rate / 60));
        if (nudge < 1e-6) nudge = 0;
        if (co.labels.includes('▶ 핸들')) wheel = -a;
        if (co.labels.includes('핸들 ◀')) wheel = a;
      } else if (co.msg.includes('끝까지')) {
        // '끝까지' 안내는 끝까지 감음
        if (co.labels.includes('▶ 핸들')) wheel = -1;
        if (co.labels.includes('핸들 ◀')) wheel = 1;
      }
      if (co.labels.includes('브레이크')) (brake = 1), (accel = 0);
      if (co.labels.includes('가속') && !brake) accel = Math.max(accel, v.accel * 0.6);
    }
    s.input = { steer: 0, accel, brake, wheelDelta: (wheel * v.rate * 2 * Math.PI) / 60 };
    s.step();
  }
  return { s, t, log };
}

const VARS: V[] = [];
for (const accel of [0.3, 0.6, 1]) for (const rate of [0.8, 1.5, 2.5]) VARS.push({ accel, rate });

describe('주행 배우기: 문구 그대로 따라 하기', () => {
  for (const l of DRIVE_LESSONS) {
    it(l.title, () => {
      const bad: string[] = [];
      for (const v of VARS) {
        const r = play(l.id, v);
        const dq = r.s.engine.disqualifications().map((d) => `${d.id} ${d.detail}`);
        const line = `가속 ${v.accel} · 핸들 ${v.rate}바퀴/초 → ${r.t.cleared ? '완료' : `단계 ${r.t.step + 1} 멈춤`}${dq.length ? ' · ' + dq.join(', ') : ''}${r.log.length ? ' · 코치: ' + r.log.join(' / ') : ''}`;
        console.log(l.id, line);
        if (!r.t.cleared || dq.length) bad.push(line);
      }
      expect(bad, bad.join('\n')).toEqual([]);
    });
  }
});
