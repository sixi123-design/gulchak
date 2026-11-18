/**
 * 기본기 1단계 — 레버 익히기 (대사형).
 * 한 번에 레버 하나, 지시 → 반응 → 확인 → 다음. 틀리면 그 자리에서 다시.
 * 흙을 파는 데 쓰는 셋만 다룬다: 붐(높이) · 버킷(각도) · 암(거리).
 *
 * 설계: docs/superpowers/specs/2026-11-14-lever-drill-design.md
 * 화면 레버 글자 ↔ 관절 (index.html · ui/joystick.ts)
 *   오른쪽 레버 아래 = 붐 올림(ry-) · 위 = 붐 내림(ry+)
 *   오른쪽 레버 오른쪽 = 버킷 펴기(rx+) · 왼쪽 = 버킷 오므림(rx-)
 *   왼쪽 레버 위 = 암 펴기(ly+) · 아래 = 암 당기기(ly-)
 */
import { co, hold, type Lesson, type Step } from './tutorial';
import type { DigSession } from './session';

type Mem = Record<string, number>;
const deg = Math.PI / 180;
const SWING_A = Math.PI;

/** 시작 자세 (A 구덩이 위, 버킷은 양쪽으로 움직일 여유를 두고 조금만 오므림) */
export const DRILL_START = { swing: SWING_A, boom: 28 * deg, arm: -70 * deg, bucket: -20 * deg } as const;

/** 잘했다·잘못했다를 화면에 알리는 신호. 화면이 늘어난 값만 보고 연출을 재생한다 */
const cheer = (bag: Mem) => (bag.okN = (bag.okN ?? 0) + 1);
const scold = (bag: Mem) => (bag.badN = (bag.badN ?? 0) + 1);

export const DRILL = {
  /** 한 방향을 '움직였다'고 볼 각도 */
  move: 15 * deg,
  /** 버킷은 각이 크게 움직이므로 더 많이 */
  moveBucket: 30 * deg,
  /** 다른 관절이 이만큼 섞이면 알려 준다 */
  mixWarn: 5 * deg,
  /** 이만큼 섞이면 되돌려 다시 */
  mixBack: 12 * deg,
  /** 눌러 보기: 차체 들림이 경고 각도의 이 배수를 넘으면 '들린다' */
  liftShare: 0.6,
  /** 눌러 보기에서 안 들려도 넘어가는 시간 (프레임) */
  pressGiveUp: 150,
  /** 되돌아오는 속도 (매 프레임 남은 각의 비율) */
  homeRate: 0.12,
  /** 잘했다는 연출을 보여 주는 시간 (프레임) — 끝나면 다음 지시 */
  cheer: 72,
} as const;

type J = 'boom' | 'arm' | 'bucket';
const anyLever = (s: DigSession) => Math.max(Math.abs(s.input.lx), Math.abs(s.input.ly), Math.abs(s.input.rx), Math.abs(s.input.ry));

/** 처음 자세를 보관함에 한 번만 적는다 (setup은 bag을 못 받는다) */
function rememberHome(s: DigSession, bag: Mem) {
  if (bag.hBoom !== undefined) return;
  bag.hSwing = s.pose.swing;
  bag.hBoom = s.pose.boom;
  bag.hArm = s.pose.arm;
  bag.hBucket = s.pose.bucket;
}

/**
 * 처음 자세로 서서히 되돌린다. 다 돌아오면 true.
 * teleport를 쓴다 — setPose는 관절 속도와 흙 경로 기준을 그대로 둬서 돌아오는 길을
 * 흙 깎기로 세고 덜컹으로도 센다.
 */
function goHome(s: DigSession, bag: Mem): boolean {
  const t = { swing: bag.hSwing, boom: bag.hBoom, arm: bag.hArm, bucket: bag.hBucket };
  let far = 0;
  const next: Record<string, number> = {};
  for (const j of ['swing', 'boom', 'arm', 'bucket'] as const) {
    const d = (t[j] ?? s.pose[j]) - s.pose[j];
    far = Math.max(far, Math.abs(d));
    next[j] = s.pose[j] + d * DRILL.homeRate;
  }
  s.teleport(next);
  return far < 0.5 * deg;
}

/** 모든 단계 공통: 처음 자세 기억 + 되돌리는 중이면 되돌린다 */
const wrap = (st: Step): Step => ({
  ...st,
  begin: (s, mem, bag) => {
    rememberHome(s, bag);
    mem.back = 0;
    st.begin?.(s, mem, bag);
  },
  done: (s, mem, bag) => {
    if (mem.back) {
      // 되돌리는 중: 매 프레임 teleport가 레버 결과를 덮어쓴다. 다 돌아오면 같은 단계를 처음부터
      if (goHome(s, bag)) {
        mem.back = 0;
        st.begin?.(s, mem, bag);
      }
      return false;
    }
    return st.done(s, mem, bag);
  },
  hud: (s, mem, bag) => (mem.back ? '처음 자세로 돌아갑니다' : (st.hud?.(s, mem, bag) ?? null)),
  coach: (s, mem, bag) => (mem.back ? null : (st.coach?.(s, mem, bag) ?? null)),
});

/**
 * 한 방향 익히기: 지시 → 그 관절이 amount만큼 움직이면 반응을 보여 주고 넘어간다.
 * 다른 관절이 섞이면 알려 주고, 많이 섞이면 되돌려 다시.
 */
function dir(o: {
  j: J;
  way: 1 | -1;
  amount?: number;
  text: string;
  label: string;
  said: string;
  /** 섞이면 안 되는 관절 */
  keep?: J[];
}): Step {
  const amount = o.amount ?? (o.j === 'bucket' ? DRILL.moveBucket : DRILL.move);
  return wrap({
    // 방향만 말하면 '아래로 당기는데 붐이 올라간다'에서 멈칫한다 — 깜빡이는 이름표와 같은 말을 같이 쓴다 (검토)
    text: `${o.text}
→ ${o.label}`,
    labels: [o.label],
    begin: (s, mem) => {
      mem.p = s.pose[o.j];
      mem.say = 0;
      for (const k of o.keep ?? []) mem['k_' + k] = s.pose[k];
    },
    done: (s, mem, bag) => {
      if (mem.say) {
        // 잘했다는 연출을 보여 준 뒤 다음 지시로
        mem.say++;
        return mem.say > DRILL.cheer;
      }
      // 섞임: 많이 벗어나면 되돌려 다시
      for (const k of o.keep ?? []) {
        if (Math.abs(s.pose[k] - mem['k_' + k]) > DRILL.mixBack) {
          if (!mem.back) scold(bag);
          mem.back = 1;
          return false;
        }
      }
      mem.p = o.way > 0 ? Math.min(mem.p, s.pose[o.j]) : Math.max(mem.p, s.pose[o.j]);
      if ((s.pose[o.j] - mem.p) * o.way >= amount) {
        mem.say = 1;
        cheer(bag);
      }
      return false;
    },
    hud: (_s, mem) => (mem.say ? o.said : null),
    coach: (s, mem) => {
      for (const k of o.keep ?? []) {
        if (Math.abs(s.pose[k] - mem['k_' + k]) > DRILL.mixWarn) return co(k === 'boom' ? '붐은 그대로 두세요' : '그 레버만 쓰세요', o.label);
      }
      // 다른 레버를 움직이고 있으면 그게 무엇인지 바로 말해 준다 (첫 단계부터)
      const wrong = movingOther(s, o.j);
      if (wrong && !mem.say) return co(`그건 ${wrong}예요 — ${o.text}`, o.label, wrong);
      return null;
    },
  });
}

/** 지시한 관절 말고 다른 관절이 움직이는 중이면 그 동작 이름 (라벨과 같은 말) */
const NAMES: Record<J | 'swing', [string, string]> = {
  boom: ['붐 올림', '붐 내림'],
  arm: ['암 펴기', '암 당기기'],
  bucket: ['버킷 펴기', '버킷 오므림'],
  swing: ['선회 ◀', '▶ 선회'],
};
const movingOther = (s: DigSession, j: J): string | null => {
  for (const k of ['boom', 'arm', 'bucket', 'swing'] as const) {
    if (k === j) continue;
    const v = s.vel[k];
    if (Math.abs(v) > 0.15 * s.m.speeds[k]) return k === 'swing' ? NAMES.swing[v > 0 ? 1 : 0] : NAMES[k][v > 0 ? 0 : 1];
  }
  return null;
};
/** 2 붐 내리기 — 바닥에 닿을 때까지 */
const toGround = (): Step =>
  wrap({
    text: '오른쪽 레버를 위로\n바닥에 닿을 때까지',
    labels: ['붐 내림'],
    begin: (_s, mem) => (mem.say = 0),
    done: (s, mem, bag) => {
      if (mem.say) {
        mem.say++;
        return mem.say > DRILL.cheer;
      }
      if (s.groundGap() <= 0.02) {
        mem.say = 1;
        cheer(bag);
      }
      return false;
    },
    hud: (_s, mem) => (mem.say ? '바닥에 닿았습니다' : null),
    // 시킨 일이다 — 바닥 충격 경고로 꾸중하지 않는다
    quiet: ['W-IMPACT'],
  });

/** 3 눌러 보기 — 왜 실격인지 몸으로. 우리가 시킨 일이므로 벌을 주지 않는다 */
const pressDown = (): Step =>
  wrap({
    text: '바닥에 닿은 채로\n오른쪽 레버를 위로 더 밀어 보기',
    labels: ['붐 내림'],
    begin: (_s, mem) => {
      mem.t = 0;
      mem.lifted = 0;
    },
    done: (s, mem, bag) => {
      mem.t++;
      const warn = (s.params.liftWarnDeg * Math.PI) / 180;
      // 시킨 일이다 — '잘못' 연출(scold)은 하지 않는다. 화면 글(hud)이 무슨 일이 일어났는지만 말한다 (QA)
      if (s.lift > warn * DRILL.liftShare && !mem.lifted) mem.lifted = 1;
      // 들렸거나, 살살 해서 시간이 지났으면 손을 떼는 단계로
      if (!mem.lifted && mem.t < DRILL.pressGiveUp) return false;
      mem.ask = 1;
      // 버킷이 바닥에 있으니 반드시 처음 자세로 돌려보낸다 (다음 단계가 흙에 막힌다)
      return anyLever(s) < 0.08 && goHome(s, bag);
    },
    hud: (_s, mem) => {
      if (!mem.ask) return null;
      // 시킨 대로 했는데 '실격'이라고 판정하면 억울하다. 일어난 일과 규칙을 나눠 말한다
      // 안 들렸는데 '그게 맞다'고 칭찬하면 시킨 것과 반대다 — 무엇을 보여 주려 했는지만 말한다 (검토)
      return mem.lifted ? '차체가 들렸습니다 — 시험에서는 실격입니다' : '더 세게 누르면 차체가 들립니다 — 시험에서는 실격';
    },
    coach: (s, mem) =>
      mem.ask && anyLever(s) >= 0.08 ? co(mem.lifted ? '실격 자세예요 — 레버에서 손을 떼세요' : '레버에서 손을 떼세요') : null,
  });

// ---- 손맛: 레버를 얼마나 미는지 (흙 퍼기에서 옮겨 옴 — 흙 퍼기는 정석만 가르친다) ----
/** 손 자리 → 기계 값 (앱의 레버 곡선 2.2와 같게) */
const curve = (v: number) => Math.sign(v) * Math.abs(v) ** 2.2;
/**
 * 시범 한 토막: `frames` 동안 `hand`(손이 둘 레버 자리)를 밀고, 그 뒤 다음 단계로.
 * 3칸 표시는 손 자리로 센다 — 기계 값으로 세면 붐이 움직이는데 0칸인 구간이 생긴다 (개발 검토)
 */
const show = (text: string, frames: number, hand: (f: number) => number, gauge?: 1 | 2 | 3, label = '붐 올림', start?: (s: DigSession) => void): Step => ({
  text,
  gauge,
  labels: [label],
  demo: (f) => (f < frames ? { ry: curve(hand(f)) } : null),
  begin: (s, mem) => {
    start?.(s);
    mem.t = 0;
  },
  // 시범 + 가운데로 돌아와 쉬는 0.7초까지 보고 넘어간다
  done: (_s, mem) => ++mem.t > frames + 40,
});
/** 한 칸 = 손 자리 0.35 (3칸 표시의 1칸 한가운데쯤) */
const HAND1 = 0.35;
/** 따라 하기: 한 칸에 이만큼(프레임) 이어서 버틴다 */
const HOLD1 = 30;
// 올림 → 내림 → 올림으로 짜서 시범이 끝나면 처음 높이로 돌아온다. 처음 보는 사람이 읽고 볼 수 있게 길게 (유저 검토: 1.5초는 못 읽음)
const feelSteps = (): Step[] => [
  show('레버는 미는 만큼 빨라집니다\n오른쪽 레버를 아래로 한 칸만', 120, () => -HAND1, 1, '붐 올림', (s) => s.teleport({ ...DRILL_START })),
  // 붐 내림이 45°/s로 빨라져 40프레임을 끝까지 밀면 버킷이 땅에 박혔다 (QA) — 짧게 끝까지, 서서히 놓기
  show('오른쪽 레버를 위로\n끝까지 — 빠릅니다', 75, (f) => (f < 14 ? 1 : f < 34 ? 1 - (f - 14) / 20 : 0), 3, '붐 내림'),
  show('레버를 가운데로\n천천히 놓기', 120, (f) => (f < 60 ? -HAND1 : -HAND1 * (1 - (f - 60) / 60))),
  {
    text: '이제 직접\n오른쪽 레버를 아래로 한 칸만',
    gauge: 1,
    labels: ['붐 올림'],
    begin: (_s, mem) => ((mem.used = 0), (mem.ok = 0)),
    hud: (_s, mem) => ((mem.used ?? 0) >= HOLD1 ? '이제 천천히 가운데로' : '한 칸에 두고 잠깐 버티기'),
    // 손 자리로 본다 (화면 3칸과 같은 기준). 아래(음수)로 한 칸에 이어서 버티고, 천천히 놓아야 한다
    done: (s, mem) => {
      const y = s.stick.ry;
      const v = Math.abs(y);
      const one = y < -0.05 && y >= -0.4;
      if ((mem.used ?? 0) < HOLD1) mem.used = one ? (mem.used ?? 0) + 1 : 0;
      else if (y > 0.05 || y < -0.4) mem.used = 0; // 버틴 뒤 엉뚱하게 밀면 다시
      // 한 프레임에 가운데로 = 손을 확 뗐다
      if (v < 0.05 && (mem.prev ?? 0) >= 0.2) ((mem.used = 0), (mem.snap = 1));
      if (v > 0.05) mem.snap = 0;
      mem.prev = v;
      return hold(mem, (mem.used ?? 0) >= HOLD1 && v < 0.05, 20);
    },
    coach: (s, mem) =>
      s.stick.ry > 0.05
        ? co('반대예요 — 아래로', '붐 올림')
        : s.stick.ry < -0.4
          ? co('너무 많이 — 한 칸만', '붐 올림')
          : mem.snap
            ? co('손을 확 뗐어요 — 다시 한 칸, 천천히 놓기', '붐 올림')
            : null,
  },
];

export const LEVER_DRILL: Lesson = {
  id: 'b-levers',
  tier: '기본기',
  icon: 'stLevers',
  title: '레버 익히기',
  noFail: true,
  flat: true,
  big: true,
  why: {
    title: '왜 레버부터 하나',
    lines: [
      '굴착기는 레버 두 개로 움직입니다.',
      '흙을 파는 데는 셋을 씁니다 — <b>붐</b>(높이) · <b>버킷</b>(각도) · <b>암</b>(거리).',
      '지시할 때마다 움직일 곳이 <b>화면에서 깜빡이고</b>, 그 이름을 알려 드립니다.',
      '하나씩 밀어 보고 무엇이 움직이는지 보세요.',
    ],
  },
  setup: (s) => {
    s.teleport({ ...DRILL_START });
  },
  // 익히는 자리다. 끝까지 오면 별 3개 — 깎지 않는다
  grade: () => ({ stars: 3, note: '붐으로 높이 · 버킷으로 각도 · 암으로 거리. 왼쪽 레버 좌우는 몸통 돌리기 — 「반대편으로 선회」에서' }),
  steps: [
    dir({ j: 'boom', way: 1, text: '오른쪽 레버를 아래로', label: '붐 올림', said: '붐이 올라갑니다' }),
    toGround(),
    pressDown(),
    dir({ j: 'bucket', way: 1, text: '오른쪽 레버를 오른쪽으로', label: '버킷 펴기', said: '버킷이 펼쳐집니다', keep: ['boom'] }),
    dir({ j: 'bucket', way: -1, text: '오른쪽 레버를 왼쪽으로', label: '버킷 오므림', said: '버킷이 오므라듭니다', keep: ['boom'] }),
    dir({ j: 'arm', way: -1, text: '왼쪽 레버를 아래로', label: '암 당기기', said: '암이 접힙니다 — 버킷이 몸 쪽으로', keep: ['boom'] }),
    dir({ j: 'arm', way: 1, text: '왼쪽 레버를 위로', label: '암 펴기', said: '암이 펴집니다 — 버킷이 멀어집니다', keep: ['boom'] }),
    ...feelSteps(),
  ],
};
