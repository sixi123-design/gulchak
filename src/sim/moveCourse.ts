import { bucketLow, co, hold, pose, ropeClear, SC, fill, type Grade, type Lesson, type Step } from './tutorial';
import { SMOOTH_MAX, spanCo, spanJolt, startSpan, tickSpan, type Joint } from './gauge';
import { digSpot } from './digCourse';
import type { DigSession } from './session';

const deg = Math.PI / 180;

/** 연속동작 두 단계의 기준값 */
export const MOVE = {
  /** 별 3개 기준: 두 관절 이상이 같이 움직인 시간 비율 */
  co: 0.3,
  /**
   * 통과 최소선. '겹쳐 쓰라'고 시켜 놓고 하나씩 써도 통과하면 지시가 거짓말이 된다.
   * 다만 위치와 정지를 해낸 초보를 실패 화면에 묶어 두지 않도록 낮게 잡는다 (기획자 의견).
   */
  coMin: 0.12,
  /** 이빨을 파는 자리에 맞출 때 허용 오차 */
  rTol: 0.6,
  /** 버킷 하부와 지면 사이 (이빨 높이가 아니라 이걸로 본다 — 구덩이가 지면 아래라서) */
  gapLo: 0.03,
  gapHi: 0.45,
  /** 쏟았다고 보는 남은 양 */
  empty: 0.1,
  /** 선회 전 오므림 각 */
  curl: 60,
} as const;

/** 구간마다 덜컹·동시조작을 재는 껍데기 */
const span = (st: Step, joints: Joint[]): Step => ({
  ...st,
  begin: (s, mem, bag) => {
    startSpan(s, mem);
    st.begin?.(s, mem, bag);
  },
  done: (s, mem, bag) => {
    tickSpan(s, mem, joints);
    return st.done(s, mem, bag);
  },
});

const smooth = (s: DigSession, mem: Record<string, number>) => spanJolt(s, mem) < SMOOTH_MAX;
/** 정말로 서 있나 (최고 속도의 2% 아래). 없으면 목표 범위를 지나가며 통과해 버린다 */
const still = (s: DigSession) =>
  (['boom', 'arm', 'bucket', 'swing'] as const).every((j) => Math.abs(s.vel[j]) < 0.02 * s.m.speeds[j]);

// ---------------------------------------------------------------- 2단계

/** 오른쪽 레버의 각도 (도). 0 = 3시(버킷 펴기), 90 = 12시(붐 내림) */
const stickAngle = (s: DigSession) => (Math.atan2(s.stick.ry, s.stick.rx) * 180) / Math.PI;
/** 오른쪽 레버를 민 깊이 (0~1) */
const stickMag = (s: DigSession) => Math.hypot(s.stick.rx, s.stick.ry);

/** 12시 → 3시 원호 드릴의 기준값 */
export const ARC = {
  /** 레버를 이 깊이로 민다 (가동범위 링) */
  ring: 0.6,
  /** 깊이 허용 폭 */
  ringTol: 0.22,
  /** 각도 허용 폭 (도) — 이보다 벗어나면 길잡이 원호를 띄운다 */
  angTol: 22,
  /** 각도를 한 프레임에 이만큼 넘게 꺾으면 '거칠다' (도/프레임) */
  jerkDeg: 4,
  /** 끝났다고 보는 각도 (3시 근처) */
  endAng: 12,
} as const;

/**
 * 12시(붐 내림) → 3시(버킷 펴기) 로 레버를 부드럽게 옮기는 한 동작.
 *
 * 암은 건드리지 않는다. 붐을 내리던 힘을 서서히 줄이면서 버킷이 서서히 펴져,
 * 흙 파기 직전 자세로 **끊김 없이** 이어진다. 이 손놀림 하나가 2단계의 전부다.
 */
const arcStep = (): Step => ({
  text: '노란 점을 따라\n레버를 12시에서 3시로',
  labels: ['붐 내림', '버킷 펴기'],
  spot: digSpot,
  begin: (s, mem, bag) => {
    startSpan(s, mem);
    mem.ang = 90;
    mem.rough = 0;
    mem.swept = 0;
    mem.started = 0;
    bag.rough = bag.rough ?? 0;
  },
  guide: (s) => {
    const m = stickMag(s);
    const a = m > 0.12 ? stickAngle(s) : 90;
    const off = Math.abs(a - (90 - (90 - Math.max(ARC.endAng, Math.min(90, a)))));
    return {
      ring: ARC.ring,
      from: 90,
      to: 0,
      // 지금 가야 할 자리: 레버가 범위 안이면 그 자리, 벗어났으면 되돌아갈 자리
      at: Math.max(0, Math.min(90, a)),
      rough: off > ARC.angTol || Math.abs(m - ARC.ring) > ARC.ringTol,
    };
  },
  hud: (s, mem) => {
    const m = stickMag(s);
    if (m < 0.12) return '레버를 12시로 (위로) 밀기';
    if (Math.abs(m - ARC.ring) > ARC.ringTol) return m > ARC.ring ? '너무 깊어요 — 점선 안으로' : '조금 더 밀어 점선까지';
    if (mem.rough) return '한 번에 꺾지 말고 천천히 돌리기';
    return '노란 점을 따라 3시로';
  },
  done: (s, mem, bag) => {
    tickSpan(s, mem, ['boom', 'bucket']);
    const m = stickMag(s);
    const a = stickAngle(s);
    if (m > 0.12) {
      // 12시 근처에서 출발했는가
      if (a >= 90 - ARC.angTol) mem.started = 1;
      // 한 번에 확 꺾으면 거칠다. 한 번의 꺾음을 한 번으로만 센다
      const d = Math.abs(a - mem.ang);
      if (d > ARC.jerkDeg) {
        if (!mem.rough) bag.rough = (bag.rough ?? 0) + 1;
        mem.rough = 20;
      }
      // 12시에서 3시로 내려온 만큼만 쌓는다 (되돌아간 것은 안 센다)
      if (mem.ang - a > 0) mem.swept += mem.ang - a;
      mem.ang = a;
    }
    if (mem.rough > 0) mem.rough--;
    // **원호를 실제로 그려야** 통과한다. 3시에 레버를 툭 놓는 것으로는 안 된다
    return mem.started > 0 && mem.swept > 60 && m > 0.12 && a <= ARC.endAng && s.groundGap() < 0.5;
  },
});

export const READY_LESSON: Lesson = {
  id: 'b-ready',
  tier: '기본기',
  icon: 'stAim',
  title: '퍼기 준비 자세',
  noFail: true,
  big: true,
  flat: true,
  why: {
    title: '레버 하나로 이어 가기',
    lines: [
      '붐을 내리고 버킷을 펴는 것은 <b>따로 하는 두 동작이 아닙니다</b>.',
      '오른쪽 레버를 <b>12시에서 3시로</b> 천천히 돌리면 한 동작이 됩니다.',
      '붐이 내려가는 힘이 줄면서 버킷이 펴집니다.',
      '암은 건드리지 않습니다.',
    ],
  },
  grade: (_s, bag): Grade => {
    const r = bag.rough ?? 0;
    if (r === 0) return { stars: 3, note: '12시에서 3시까지 끊김 없이 돌렸습니다' };
    if (r <= 3) return { stars: 2, note: '몇 번 끊겼어요. 레버를 멈추지 말고 돌려 보세요' };
    return { stars: 1, note: '레버를 꺾어 썼어요. 원을 그리듯 천천히 옮기세요' };
  },
  setup: (s) => {
    // 암을 미리 펴 둔 자세. 여기서 레버를 12시→3시로 돌리면 파는 자리에 닿는다 (측정)
    s.teleport({ swing: Math.PI, boom: 45 * deg, arm: -65 * deg, bucket: -110 * deg });
  },
  steps: [
    // ---- 시범: 무엇을 움직이고 무엇을 조심할지 ----
    {
      text: '레버를 12시로' + '\n' + '붐이 내려갑니다',
      labels: ['붐 내림'],
      demo: (f) => (f < 80 ? { ry: ARC.ring } : null),
      guide: () => ({ ring: ARC.ring, from: 90, to: 0, at: 90, rough: false }),
      begin: (_s, mem) => (mem.t = 0),
      done: (_s, mem) => ++mem.t > 120,
    },
    {
      text: '3시로 옮기면' + '\n' + '버킷이 펴집니다',
      labels: ['버킷 펴기'],
      demo: (f) => {
        if (f >= 150) return null;
        const t = f / 149;
        const a = ((Math.PI / 2) * (1 - t));
        return { rx: Math.cos(a) * ARC.ring, ry: Math.sin(a) * ARC.ring };
      },
      guide: (s) => ({ ring: ARC.ring, from: 90, to: 0, at: Math.max(0, Math.min(90, stickMag(s) > 0.12 ? stickAngle(s) : 90)), rough: false }),
      begin: (_s, mem) => (mem.t = 0),
      done: (_s, mem) => ++mem.t > 190,
    },
    {
      text: '한 번에 꺾으면' + '\n' + '덜컹하고 흙이 튑니다',
      labels: ['붐 내림', '버킷 펴기'],
      demo: (f) => (f < 20 ? { ry: ARC.ring } : f < 60 ? { rx: ARC.ring } : null),
      guide: () => ({ ring: ARC.ring, from: 90, to: 0, at: 45, rough: true }),
      begin: (_s, mem) => (mem.t = 0),
      done: (_s, mem) => ++mem.t > 110,
    },
    // ---- 직접 ----
    arcStep(),
    span(
      {
        text: '레버를 가운데로 놓아\n멈추기',
        spot: digSpot,
        labels: ['붐 내림'],
        hud: (s) => {
          const g = s.groundGap();
          if (g > MOVE.gapLo && g < MOVE.gapHi) return '여기! 레버를 가운데로 놓기';
          if (g <= MOVE.gapLo) return '너무 깊어요 — 붐을 조금 올리기';
          return `조금 더 — 버킷 바닥까지 ${Math.round(g * 100)}cm`;
        },
        done: (s, mem, bag) => {
          const g = s.groundGap();
          const ok = g > MOVE.gapLo && g < MOVE.gapHi && still(s) && smooth(s, mem);
          if (ok) bag.rough = bag.rough ?? 0;
          return hold(mem, ok, 15);
        },
        coach: (s, mem) => (!smooth(s, mem) ? co('덜컹했어요 — 레버를 천천히 가운데로') : null),
      },
      ['boom', 'bucket'],
    ),
  ],
};

// ---------------------------------------------------------------- 3단계
export const DUMP_LESSON: Lesson = {
  id: 'b-dump',
  tier: '기본기',
  icon: 'stDump',
  title: '쏟고 돌릴 자세',
  noFail: true,
  big: true,
  flat: true,
  why: {
    title: '쏟고 나서가 더 중요합니다',
    lines: [
      '흙을 쏟는 것은 버킷을 펴면 끝입니다.',
      '문제는 <b>그다음</b> — 다시 돌리려면 버킷을 오므리고 높이 들어야 합니다.',
      '그 둘을 같이 하면 한 동작이 됩니다.',
      '여기서도 몸통은 안 돌립니다. 자세만 잡습니다.',
    ],
  },
  grade: (_s, bag): Grade => {
    const c = bag.co ?? 0;
    if (c >= 0.5) return { stars: 3, note: '오므리면서 들어 한 번에 선회 자세가 됐습니다' };
    if (c >= MOVE.co) return { stars: 2, note: '조금 겹쳐 썼어요. 버킷과 붐을 더 같이 움직여 보세요' };
    return { stars: 1, note: '하나씩 했어요. 오므리면서 드는 연습을 해보세요' };
  },
  setup: (s) => {
    // 흙을 담고 버리는 자리에 온 상태
    const c = s.site.stations.find((x) => x.name === 'C');
    const r = c ? (c.zoneIn + c.zoneOut) / 2 : 6;
    pose(s, 0, r, 1.6, -40 * deg, -110 * deg);
    fill(s, 1.1);
  },
  steps: [
    {
      text: '버킷을 펴서 흙 쏟기',
      labels: ['버킷 펴기'],
      hud: (s) => `버킷에 남은 흙 ${Math.round((s.load / SC(s)) * 100)}%`,
      done: (s) => s.load < MOVE.empty * SC(s),
    },
    span(
      {
        text: '오므리며 붐 올리기',
        labels: ['버킷 오므림', '붐 올림'],
        hud: (_s, mem) => (spanCo(mem) >= MOVE.co ? '좋아요 — 계속 접으며 올리기' : '한 번에 하나씩 쓰고 있어요'),
        done: (s, mem, bag) => {
          const ok = -s.pose.bucket / deg >= MOVE.curl && bucketLow(s) >= ropeClear(s) && spanCo(mem) >= MOVE.coMin;
          if (ok) bag.co = spanCo(mem);
          return ok;
        },
        coach: (s, mem) =>
          -s.pose.bucket / deg < MOVE.curl
            ? co('버킷을 더 오므리기', '버킷 오므림')
            : spanCo(mem) < MOVE.co
              ? co('붐도 같이 올리기', '붐 올림')
              : null,
      },
      ['bucket', 'boom'],
    ),
    span(
      {
        text: '그 자세로 멈추기',
        labels: ['붐 올림'],
        done: (s, mem) => hold(mem, bucketLow(s) >= ropeClear(s) && still(s) && smooth(s, mem), 15),
        coach: (s, mem) => (!smooth(s, mem) ? co('덜컹했어요 — 레버를 천천히 가운데로') : null),
      },
      ['boom', 'bucket'],
    ),
  ],
};
