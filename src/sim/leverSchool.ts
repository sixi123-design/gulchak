/**
 * 기본기 과정 (레버 교실). 초보자가 레버를 차근차근 익히는 미션들.
 * 기존 배우기(LESSONS)는 그대로 두고, main.ts가 이것을 목록 앞에 붙인다.
 *
 * 설계·측정 근거: docs/superpowers/specs/2026-11-14-lever-school-design.md
 * 단방향 import — tutorial.ts는 이 파일을 모른다.
 */
import { co, fill, hold, pose, type Grade, type Lesson, type Step } from './tutorial';
import { SCOOP_LESSON } from './digCourse';
import { LEVER_DRILL } from './leverDrill';
import type { DigSession } from './session';

type Mem = Record<string, number>;

const deg = Math.PI / 180;
const SWING_A = Math.PI;

/**
 * 부드러움 경계. 측정값에서 나왔다(설계 '측정한 것'):
 * 서서히 놓으면 0.000 · 급하게 놓으면 0.08~0.14 · 반대로 확 꺾으면 0.37~0.87.
 * warn은 시뮬레이터의 경고 임계(rules.json joltWarn)와 같은 값이다.
 */
export const SMOOTH = { warn: 0.1, perfect: 0.04 } as const;

/**
 * 멈춤으로 볼 관절 속도 (최고속도 대비)와 유지 프레임.
 * 시뮬레이터가 '반대로 꺾음'으로 세는 경계는 최고속도의 약 3%다. 배우기의 '멈췄다'를
 * 그보다 엄하게(1%) 잡아, 멈춤 단계를 통과한 사람이 바로 반대로 줘도 덜컹이 안 나게 한다.
 */
const STILL = { vel: 0.01, frames: 15 } as const;

type J = 'swing' | 'boom';
/** 그 관절을 움직이는 레버 값 (화면 레버 방향 기준) */
const leverOf = (s: DigSession, j: J) => (j === 'swing' ? s.input.lx : -s.input.ry);
const moving = (s: DigSession, j: J) => Math.abs(s.vel[j]) > STILL.vel * s.m.speeds[j];
/** 레버를 중립에 두고 관절이 실제로 선 상태 */
const still = (s: DigSession, j: J) => Math.abs(leverOf(s, j)) < 0.08 && !moving(s, j);
/** 가던 방향과 반대로 레버를 밀고 있다 (멈추지 않고 방향을 바꾸는 중) */
const reversing = (s: DigSession, j: J) => {
  const lv = leverOf(s, j);
  return moving(s, j) && Math.abs(lv) > 0.2 && Math.sign(lv) === -Math.sign(s.vel[j]);
};

/**
 * 등급 재료.
 * 충격은 세션이 직접 최댓값을 남긴다(s.maxJolt) — coach는 화면 프레임마다 한 번만
 * 불리는데 물리는 한 프레임에 여러 번 돌 수 있어, 여기서 쌓으면 정점을 놓친다.
 * 흙 손실은 처음 담았던 양(setup에서 기록)과 지금 양으로 바로 계산한다.
 */
const lostOf = (s: DigSession, bag: Mem) => (bag.load0 ? (bag.load0 - s.load) / bag.load0 : 0);

/** 처음 담았던 흙을 한 번만 기록한다 (setup은 bag을 못 받는다) */
const withLoad0 = (st: Step): Step => ({
  ...st,
  begin: (s, mem, bag) => {
    if (bag.load0 === undefined) bag.load0 = s.load;
    st.begin?.(s, mem, bag);
  },
});

/** 반대로 꺾는 중이면 멈추라고 한다. 아니면 넘긴 코치를 쓴다 */
const watched = (j: J | null, more?: Step['coach']): Step['coach'] =>
  (s, mem, bag) => {
    if (j && reversing(s, j)) {
      bag.flick = 1; // 중립을 거치지 않고 꺾은 적이 있다 (끝낸 뒤 뭘 고칠지 알려 주려고)
      return co('먼저 멈추세요 — 레버를 가운데로');
    }
    return more?.(s, mem, bag) ?? null;
  };

/** 그 관절을 한쪽으로 amount 이상 돌렸는가 (반대쪽으로 가장 멀리 간 곳부터 셈) */
const turned = (j: J, dir: 1 | -1, amount: number, text: string, label: string): Step => ({
  text,
  labels: [label],
  begin: (s, mem) => (mem.p = s.pose[j]),
  done: (s, mem) => {
    mem.p = dir > 0 ? Math.min(mem.p, s.pose[j]) : Math.max(mem.p, s.pose[j]);
    return (s.pose[j] - mem.p) * dir >= amount;
  },
  coach: watched(j),
});

/** 레버를 중립으로 놓고 완전히 설 때까지 */
const stopStep = (j: J, text: string): Step => ({
  text,
  labels: [],
  done: (s, mem) => hold(mem, still(s, j), STILL.frames),
  meter: (_s, mem) => ({ v: Math.min(1, (mem.hold ?? 0) / STILL.frames) }),
  coach: watched(j, (s) => (moving(s, j) ? co('레버를 가운데에 두고, 완전히 멈출 때까지 기다리세요') : null)),
});

/**
 * 2단계 상수.
 * 목표는 '이빨을 흙 위 N cm에 세우기' — 꽂기 직전에 멈추는 것이 정석이고, 흙 표면이
 * 보이니 새 표시가 필요 없다. 회차마다 목표가 낮아지고 허용 오차가 좁아진다.
 */
export const AIM = {
  targets: [0.3, 0.2, 0.1],
  tol: [0.12, 0.07, 0.04],
  /** 멈춤으로 볼 관절 속도 (최고속도 대비) */
  vel: 0.01,
  /** 멈춘 것으로 인정하기까지 유지할 프레임 (0.3초) */
  frames: 18,
} as const;

/**
 * 버킷 밑이 흙 위 gap에 오도록 자세를 잡는다.
 * groundGap()은 이빨이 아니라 버킷 하부에서 가장 낮은 점을 재므로(session.ts groundGap),
 * 날 끝 높이로 자세를 잡으면 실제 간격이 달라진다.
 */
function poseAtGap(s: DigSession, swing: number, r: number, gap: number, bucketAbs: number, bucketRel?: number) {
  let y = gap;
  for (let i = 0; i < 6; i++) {
    pose(s, swing, r, y, bucketAbs, bucketRel);
    const d = s.groundGap() - gap;
    if (Math.abs(d) < 0.01) break;
    y -= d;
  }
}

const JOINTS = ['swing', 'boom', 'arm', 'bucket'] as const;
/** 네 관절이 다 서 있고 레버도 중립 */
const allStill = (s: DigSession) =>
  JOINTS.every((j) => Math.abs(s.vel[j]) < AIM.vel * s.m.speeds[j]) &&
  Math.abs(s.input.lx) < 0.08 &&
  Math.abs(s.input.ly) < 0.08 &&
  Math.abs(s.input.rx) < 0.08 &&
  Math.abs(s.input.ry) < 0.08;
const cm = (m: number) => `${Math.round(Math.abs(m) * 100)}cm`;
/** 오차에 따른 한 마디 */
const aimWord = (err: number, tol: number) => (err <= tol * 0.4 ? '완벽!' : err <= tol ? '좋음' : '아쉬움');

/** 한 회차: 버킷을 목표 높이에 세운다. 멈추면(맞췄든 못 맞췄든) 오차를 적고 넘어간다 */
const aimStep = (round: number, key = `err${round + 1}`, of: number = AIM.targets.length, no = round + 1): Step => {
  const target = AIM.targets[round];
  const tol = AIM.tol[round];
  return {
    text: `붐을 내려 버킷을 흙 위 ${Math.round(target * 100)}cm에 세우세요${of > 1 ? ` (${no}/${of})` : ''}`,
    labels: ['붐 내림', '붐 올림'],
    begin: (_s, mem) => {
      mem.hold = 0;
      mem.used = 0;
    },
    done: (s, mem, bag) => {
      if (mem.done) {
        // 오차를 0.75초 보여 준 뒤 다음 회차로 (바로 넘기면 숫자를 못 본다)
        mem.show = (mem.show ?? 0) + 1;
        return mem.show >= 45;
      }
      // 가만히 있어도 '멈췄다'가 되지 않게: 붐 레버를 10프레임(약 0.17초) 이상 쓴
      // 뒤부터 센다. 한 번 톡 건드리는 것으로는 안 된다.
      // (거리로 재면, 앞 회차에서 지나쳐 내려온 사람은 다음 목표가 5cm 위라 길이 막힌다)
      if (Math.abs(s.input.ry) > 0.03) mem.used = (mem.used ?? 0) + 1;
      mem.hold = (mem.used ?? 0) >= 10 && allStill(s) ? (mem.hold ?? 0) + 1 : 0;
      if (mem.hold < AIM.frames) return false;
      mem.done = 1;
      mem.err = Math.abs(s.groundGap() - target);
      bag[key] = mem.err;
      bag.lastErr = mem.err;
      bag.lastTol = tol;
      return false;
    },
    // 바늘 + 목표 구간: 목표 높이를 가운데 두고 ±2배 범위
    meter: (s) => {
      const lo = target - tol * 3;
      const hi = target + tol * 3;
      const v = Math.min(1, Math.max(0, (s.groundGap() - lo) / (hi - lo)));
      const a = (target - tol - lo) / (hi - lo);
      const b = (target + tol - lo) / (hi - lo);
      return { v, band: [a, b] };
    },
    hud: (_s, mem, bag) => {
      if (mem.done) return `${cm(mem.err)} · ${aimWord(mem.err, tol)}`;
      if ((mem.hold ?? 0) > 0) {
        const n = Math.min(3, Math.floor(((mem.hold ?? 0) / AIM.frames) * 3 + 0.001));
        return `멈춤 ${'●'.repeat(n)}${'○'.repeat(3 - n)}`;
      }
      // 아직 멈추기 전이면 앞 회차 결과를 남겨 둔다
      if (bag.lastErr !== undefined) return `지난 회차 ${cm(bag.lastErr)} · ${aimWord(bag.lastErr, bag.lastTol)}`;
      if ((mem.used ?? 0) >= 10) return null;
      return _s.groundGap() > target ? '붐을 내려 보세요' : '붐을 올려 보세요';
    },
    coach: (s) => {
      if (s.groundGap() < 0) return co('버킷이 흙에 닿았어요 → 붐을 살짝 올리세요', '붐 올림');
      return null;
    },
  };
};

const aimAt: Lesson = {
  id: 'b-aim',
  tier: '기본기',
  icon: 'stAim',
  title: '버킷 높이 맞춰 멈추기',
  noFail: true,
  why: {
    title: '왜 이걸 배우나',
    lines: [
      '흙을 파려면 <b>버킷</b>(팔 끝의 흙 담는 부분)을 흙 바로 위에 내렸다가 꽂습니다.',
      '너무 내리면 땅을 긁고, 덜 내리면 흙이 얕게 담깁니다. 둘 다 점수가 깎입니다.',
      '버킷 높이는 <b>오른쪽 레버를 위아래로</b> 움직여 바꿉니다. 위로 밀면 내려가고, 아래로 당기면 올라갑니다.',
      '레버를 가운데로 놓아도 버킷은 바로 서지 않고 조금 더 내려갑니다.',
      '그래서 목표에 닿기 <b>전에</b> 레버를 조금씩 줄여야 합니다. 세 번 해 보며 익히세요.',
    ],
  },
  // 버킷 밑을 A 구덩이 위 1.2m에 둔 자세 (붐만 내리면 목표 높이에 닿는다)
  setup: (s) => {
    poseAtGap(s, SWING_A, s.digTarget.rho - 0.5, 1.2, -10 * deg, 0);
    fill(s, 0);
  },
  grade: (_s, bag): Grade => {
    const errs = [bag.err1, bag.err2, bag.err3].filter((x) => typeof x === 'number' && Number.isFinite(x));
    if (errs.length < AIM.targets.length) return { stars: 1, note: '세 번 다 해 보세요' };
    const avg = errs.reduce((a, b) => a + b, 0) / errs.length;
    const worst = Math.max(...errs);
    // 세 번 다 잘해야 별 3개 — 평균으로 보면 한 번 크게 틀려도 가려진다
    if (worst <= 0.04) return { stars: 3, note: `세 번 다 ${cm(worst)} 안쪽 — 멈추는 자리를 잡았어요` };
    if (avg <= 0.08) return { stars: 2, note: `평균 ${cm(avg)}, 가장 많이 빗나간 게 ${cm(worst)} — 조금 더 미리 줄여 보세요` };
    return { stars: 1, note: `평균 ${cm(avg)} 빗나갔어요 — 목표 한참 전부터 레버를 줄여 보세요` };
  },
  steps: AIM.targets.map((_t, i) => aimStep(i)),
};

/**
 * 3단계 상수. 목표는 '이빨을 땅 위 일정 높이로 유지하며 직선으로 옮기기'.
 * 붐만 올리면 이빨이 호를 그려 높이가 벗어난다 — 암을 같이 써야 직선이 된다.
 */
export const LINE = {
  /** 평균 벗어남: 이 아래면 잘함 */
  good: 0.04,
  /** 이 아래면 보통 */
  ok: 0.1,
  /** 지킬 높이 (땅 위, m) */
  height: 0.6,
  /** 이 비율 이상 두 관절을 같이 움직여야 '같이 썼다' */
  multi: 0.35,
  /** 한 방향으로 그을 거리 (m) */
  dist: 1.6,
  /** 4단계는 고봉 흙을 든 채라 버킷을 끝까지 오므리고 있어 반경 여유가 적다 */
  distLaden: 0.7,
} as const;

/** 이빨 높이가 목표에서 얼마나 벗어났는지 매 프레임 쌓는다 + 동시조작 비율 */
function lineWatch(s: DigSession, bag: Mem) {
  bag.devSum = (bag.devSum ?? 0) + Math.abs(s.groundGap() - LINE.height);
  bag.devN = (bag.devN ?? 0) + 1;
  const mv = (['boom', 'arm', 'bucket'] as const).filter((j) => Math.abs(s.vel[j]) > 0.02 * s.m.speeds[j]).length;
  if (mv > 0) bag.frames = (bag.frames ?? 0) + 1;
  if (mv >= 2) bag.multi = (bag.multi ?? 0) + 1;
}
const devOf = (bag: Mem) => (bag.devN ? bag.devSum / bag.devN : 0);
const multiOf = (bag: Mem) => (bag.frames ? (bag.multi ?? 0) / bag.frames : 0);

/** 한 방향 긋기: 버킷을 목표 높이로 유지하며 dir(1 바깥 · -1 몸 쪽)으로 dist만큼 옮긴다 */
const lineStep = (dir: 1 | -1, dist: number, text: string, label: string): Step => ({
  text,
  labels: [label, '붐 올림', '붐 내림'],
  begin: (s, mem) => (mem.r0 = s.frame.tip.r),
  done: (s, mem, bag) => {
    lineWatch(s, bag);
    return (s.frame.tip.r - mem.r0) * dir >= dist;
  },
  meter: (s) => {
    const lo = LINE.height - LINE.ok * 3;
    const hi = LINE.height + LINE.ok * 3;
    const v = Math.min(1, Math.max(0, (s.groundGap() - lo) / (hi - lo)));
    const a = (LINE.height - LINE.good - lo) / (hi - lo);
    const b = (LINE.height + LINE.good - lo) / (hi - lo);
    return { v, band: [a, b] };
  },
  hud: (s) => {
    const d = s.groundGap() - LINE.height;
    return Math.abs(d) < LINE.good ? '높이 좋음' : `${d > 0 ? '높음' : '낮음'} ${cm(d)}`;
  },
  coach: (s) => {
    const d = s.groundGap() - LINE.height;
    if (d > LINE.good) return co('버킷이 높아요 → 붐 내림도 같이 쓰세요', '붐 내림', label);
    if (d < -LINE.good) return co('버킷이 낮아요 → 붐 올림도 같이 쓰세요', '붐 올림', label);
    return null;
  },
});

const bothLevers: Lesson = {
  id: 'b-both',
  tier: '기본기',
  icon: 'stBoth',
  title: '버킷 곧게 옮기기',
  noFail: true,
  trail: true,
  why: {
    title: '왜 이걸 배우나',
    lines: [
      '시험에는 파낸 자리를 <b>평평하게 고르는</b> 과정이 있습니다. 바닥이 울퉁불퉁하면 점수가 깎입니다.',
      '<b>오른쪽 레버 위아래</b>는 버킷 높이를 바꿉니다(붐). <b>왼쪽 레버 위아래</b>는 버킷을 앞뒤로 보냅니다(암).',
      '왼쪽 레버만 밀면 버킷이 둥글게 휩니다 — 팔이 한 점을 중심으로 돌기 때문입니다.',
      '그래서 왼쪽 레버를 쓰는 동안 <b>오른쪽 레버로 높이를 같이</b> 맞춰야 곧게 갑니다.',
      '지나간 자리에 노란 선이 남습니다. 휘었으면 오른쪽 레버로 고치세요.',
    ],
  },
  // 버킷 밑을 목표 높이에 두고 몸 가까이. 버킷은 암과 일직선(평탄 자세) — 가동범위 안
  setup: (s) => {
    poseAtGap(s, SWING_A, s.digTarget.rho - 2.2, LINE.height, -10 * deg, 0);
    fill(s, 0);
  },
  grade: (_s, bag): Grade => {
    const dev = devOf(bag);
    const multi = multiOf(bag);
    if (!bag.devN) return { stars: 1, note: '해 보세요' };
    if (dev > LINE.ok) return { stars: 1, note: `높이가 평균 ${cm(dev)} 흔들렸어요. 암을 쓰는 동안 붐도 같이 쓰세요` };
    if (dev > LINE.good) return { stars: 2, note: `높이가 평균 ${cm(dev)} 흔들렸어요. 거의 다 됐습니다` };
    if (multi < LINE.multi) return { stars: 2, note: '높이는 지켰지만 레버를 번갈아 썼어요. 두 개를 동시에 움직여 보세요' };
    return { stars: 3, note: `높이가 ${cm(dev)}밖에 안 흔들렸어요 — 선이 곧습니다` };
  },
  steps: [
    lineStep(1, LINE.dist, '암을 펴 버킷을 앞으로 보내세요 — 높이는 붐으로 맞추면서', '암 펴기'),
    lineStep(-1, LINE.dist, '이제 암을 당겨 돌아오세요 — 높이는 그대로 지키면서', '암 당기기'),
  ],
};

const stopFirst: Lesson = {
  id: 'b-stop',
  tier: '기본기',
  icon: 'stStop',
  title: '몸통 돌리고 멈추기',
  noFail: true,
  why: {
    title: '왜 이걸 먼저 하나',
    lines: [
      '시험은 흙을 퍼서 <b>몸통을 돌려</b> 옆에 붓는 일을 네 번 되풀이합니다. 그 돌리기가 이 미션입니다.',
      '몸통을 돌리는 레버는 왼쪽 레버를 좌우로 미는 것입니다 (화면에 <b>선회</b>라고 적혀 있습니다).',
      '돌아가는 중에 레버를 반대로 꺾으면 버킷의 흙이 쏟아집니다. 쏟은 만큼 점수가 깎입니다.',
      '레버를 <b>가운데</b>로 옮겨 몸통이 완전히 멈춘 뒤에 반대로 돌리세요. 레버를 놓는 것과 멈추는 것은 다릅니다.',
    ],
  },
  // 고봉으로 담은 흙을 들고 A 쪽에 서 있는 자세 (팔을 뻗어 둬 흔들림이 크게 느껴진다)
  setup: (s) => {
    pose(s, SWING_A, s.digTarget.rho - 0.6, s.site.B.ropeY + 1.1, 95 * deg, s.m.limits.bucket[0] + 2 * deg);
    fill(s, 1.25); // 고봉: 평적을 넘은 흙만 충격에 쏟아진다 (session.ts joltSpill)
    s.maxJolt = 0;
  },
  grade: (s, bag): Grade => {
    const lost = lostOf(s, bag);
    const jolt = s.maxJolt ?? 0;
    const flick = !!bag.flick;
    // 고봉으로 담고 선회를 여러 번 하면 정석으로 해도 10% 안팎은 흘린다 (측정).
    // 선회 관성 흘림이 들어오기 전 기준(1%/5%)은 이제 아무도 못 넘는다.
    if (lost >= 0.4) return { stars: 1, note: '방향을 바꿀 때 흙이 쏟아졌어요. 완전히 멈춘 다음에 반대로 돌리세요' };
    if (lost >= 0.25) return { stars: 2, note: '흙이 꽤 흘렀어요. 레버를 서서히 주고 서서히 놓으세요' };
    if (jolt < SMOOTH.warn) return { stars: 3, note: '멈춘 다음에 돌렸어요. 흙도 거의 그대로입니다' };
    return flick
      ? { stars: 2, note: '멈추기 전에 반대로 꺾은 적이 있어요. 한 번 세우고 나서 돌리세요' }
      : { stars: 2, note: '레버를 놓을 때 덜컹했어요. 한 번에 놓지 말고 조금씩 줄이며 놓아보세요' };
  },
  steps: [
    turned('swing', -1, 35 * deg, '왼쪽 레버를 왼쪽으로 밀어 몸통을 돌리세요', '선회 ◀'),
    stopStep('swing', '레버를 가운데로 — 몸통이 완전히 멈출 때까지 기다리세요'),
    turned('swing', 1, 30 * deg, '멈췄으면 이제 오른쪽으로 돌리세요', '▶ 선회'),
    stopStep('swing', '다시 가운데로 — 완전히 멈출 때까지'),
    turned('swing', -1, 45 * deg, '마지막으로 왼쪽으로, 조금 더 멀리', '선회 ◀'),
  ].map(withLoad0),
};

/** 항목 평가 표시 (채점표와 같은 기호) */
const mark = (good: boolean, ok: boolean) => (good ? '◎' : ok ? '○' : '△');

/**
 * 4단계: 셋을 한 번에. 고봉으로 담은 흙을 들고, 두 레버를 같이 써서 목표 높이로
 * 옮긴 다음, 목표 높이에 멈춘다. 세 항목을 각각 ◎○△로 보여 준다.
 */
const allTogether: Lesson = {
  id: 'b-all',
  tier: '기본기',
  icon: 'stAll',
  title: '흘리지 않고 곧게 멈추기',
  noFail: true,
  trail: true,
  why: {
    title: '왜 합쳐서 하나',
    lines: [
      '실제 작업은 앞의 세 가지를 <b>동시에</b> 합니다. 하나씩 따로 되는 것과는 다릅니다.',
      '흙을 흘리지 않게, 두 레버를 같이 쓰면서, 목표 높이에 멈추세요.',
      '끝나면 세 가지를 따로 보여 드립니다. 약한 쪽만 다시 연습하면 됩니다.',
    ],
  },
  setup: (s) => {
    poseAtGap(s, SWING_A, s.digTarget.rho - 2.6, LINE.height, 95 * deg, s.m.limits.bucket[0] + 2 * deg);
    fill(s, 1.25);
    s.maxJolt = 0;
  },
  grade: (s, bag): Grade => {
    const lost = lostOf(s, bag);
    const jolt = s.maxJolt ?? 0;
    const err = typeof bag.errAll === 'number' ? bag.errAll : Infinity;
    const dev = devOf(bag);
    const multi = multiOf(bag);
    // 흙 지키기 · 동시조작(높이 유지) · 멈추기
    const soil = mark(lost < 0.01 && jolt < SMOOTH.warn, lost < 0.05);
    const line = mark(bag.devN > 0 && dev <= LINE.good && multi >= LINE.multi, bag.devN > 0 && dev <= LINE.ok);
    const stop = mark(err <= 0.04, err <= 0.08);
    const note = `흙 ${soil} · 직선 ${line} · 멈춤 ${stop}`;
    const marks = [soil, line, stop];
    const bad = marks.filter((m) => m === '△').length;
    // 별 3개는 셋 다 ◎일 때만 — ○ 세 개로 3개를 주면 앞 단계들보다 느슨해진다
    if (marks.every((m) => m === '◎')) return { stars: 3, note };
    return { stars: bad >= 2 ? 1 : 2, note };
  },
  steps: [
    {
      ...lineStep(1, LINE.distLaden, '흙을 흘리지 않게, 두 레버를 같이 써서 앞으로 보내세요', '암 펴기'),
      labels: ['암 펴기', '붐 올림', '붐 내림'],
    },
    aimStep(1, 'errAll', 1),
  ],
};

// 레버 익히기가 맨 앞 — 레버를 쓸 줄 모르는 사람에게 미션을 줄 수 없다
export const BASIC_LESSONS: Lesson[] = [LEVER_DRILL, SCOOP_LESSON, stopFirst, aimAt, bothLevers, allTogether];
