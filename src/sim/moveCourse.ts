import { bucketLow, co, hold, ropeClear, SC, fill, type Grade, type Lesson, type Step } from './tutorial';
import { SMOOTH_MAX, spanJolt, startSpan, tickSpan, type Joint } from './gauge';
import type { DigSession, Sticks } from './session';

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
  /**
   * 선회 전 오므림 각 (도): **다 접음** — 버킷 한계(−135°)에서 5° 안 (앱 주인 지적·아스트라 기준, 2026-11-17).
   * 쏟고 돌릴 자세·흙 퍼기 들기가 같은 기준
   */
  curl: 130,
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
export const still = (s: DigSession) =>
  (['boom', 'arm', 'bucket', 'swing'] as const).every((j) => Math.abs(s.vel[j]) < 0.02 * s.m.speeds[j]);

/** 레버를 아직 잡고 있나 (손 자리) */
export const handOn = (s: DigSession) => Math.hypot(s.stick.rx, s.stick.ry) > 0.12 || Math.hypot(s.stick.lx, s.stick.ly) > 0.12;
/** 얼마나 섰나 (0~1). 최고 속도의 100%면 0, still() 기준(2%) 아래면 1 — 로그로 고르게 */
const settled = (s: DigSession) => {
  const f = Math.max(...(['boom', 'arm', 'bucket', 'swing'] as const).map((j) => Math.abs(s.vel[j]) / (0.02 * s.m.speeds[j])));
  return f <= 1 ? 1 : Math.max(0, 1 - Math.log(f) / Math.log(50));
};

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
  /** 각도 허용 폭 (도) — 이보다 벗어나면 길잡이가 빨개진다 */
  angTol: 22,
  /** 각도를 한 프레임에 이만큼 넘게 꺾으면 '거칠다' (도/프레임) */
  jerkDeg: 4,
  /**
   * 레버 각도를 재기 전에 거치는 저역 필터 (0~1, 작을수록 둔하다).
   * 키보드는 좌우 키가 따로 올라와서 각도가 계단처럼 흔들린다 — 부드럽게 굴려도
   * 한 프레임에 6°씩 튀어 '꺾었다'로 잡혔다. 필터를 거치면 흔들림은 1° 아래로 줄고,
   * 정말 한 번에 꺾은 것(한 프레임 90°)은 18°로 남아 그대로 걸린다.
   */
  smooth: 0.2,
  /** 끝났다고 보는 각도 (3시 근처) */
  endAng: 12,
  /** 버킷 바닥이 이 높이에 닿을 때 레버가 3시에 와 있어야 한다 (m) — 결과 자세 창(READY_GOAL 0.15~0.75) 안 */
  land: 0.5,
  /** 이 높이부터 레버를 3시로 굴리기 시작한다 (land + roll) */
  roll: 2.8, // 시범처럼 붐이 내려가기 시작하면 바로 3시 쪽으로 (별점 지점: 2m에서 펴지기 시작, 1m 앞에서 거의 다)
} as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * 남은 높이에 맞는 레버 각도 (도). 땅이 멀면 12시(붐 내림), 가까워지면 3시(버킷 펴기).
 *
 * 내려오는 높이에 맞춰 레버를 굴리면 붐이 서서히 멈추고 버킷이 서서히 펴져서,
 * 흙 파기 직전 자세로 끊김 없이 이어진다.
 */
export const wantAngle = (s: DigSession) => {
  const g = s.groundGap();
  const base = 90 * clamp01((g - ARC.land) / ARC.roll);
  // 시범처럼 버킷을 본다: 높이에 비해 버킷이 늦으면 3시 쪽으로, 앞서면 12시 쪽으로 (높이만 보면 버킷이 끝내 안 펴진다)
  const want = DOT_BUCKET.top + (DOT_BUCKET.end - DOT_BUCKET.top) * clamp01((DOT_BUCKET.g1 - g) / (DOT_BUCKET.g1 - DOT_BUCKET.g2));
  return Math.max(0, Math.min(90, base - DOT_BUCKET.k * (want - s.pose.bucket / deg)));
};
/**
 * 노란 점이 따라가게 하는 버킷 각 (도): 높이 g1(시작 3.5m에서 조금 내려온 곳)에서 −120°,
 * g2(결과 창 위쪽)에서 −10° — 시범(wantBucket)과 같은 모양. 별점 지점(2m·1m)을 이 길이 지난다
 */
const DOT_BUCKET = { g1: 3.15, g2: 0.65, top: -120, end: -10, k: 1.5 } as const;

/** 각도(도)와 깊이로 오른쪽 레버값 */
const stickAt = (a: number, m: number = ARC.ring) => ({ rx: Math.cos(a * deg) * m, ry: Math.sin(a * deg) * m });


/**
 * 선회해서 돌아온 자세 `[측정]`.
 *
 * **붐 48°** — 앞 주인 기준은 핀-핀 각도가 아니라 **붐 실린더 각도 80~90°**다.
 * 실린더 각은 붐각을 따라간다: 붐 42°→80° · 48°→84° · 55°→89° · 57°→91° · 67°→98°.
 * 즉 붐을 끝까지(67°) 올리면 실린더가 98°로 지나친다. 48°가 실린더 84°다.
 *
 * **암 −72°** (2.1m 암 장비, 2026-11-15) — 붐 48°에서 암을 −79°보다 더 접으면 버킷 최저점이
 * B 장애물 줄(2.75m) 30cm 안으로 들어온다. −72°면 최저점이 줄보다 0.84m 위, 날 끝 r 4.22m로
 * ⓔ·ⓕ 폴 통과구역(2.50~6.27m) 가운데쯤을 지난다. 판정기(staticHits)로 직접 확인했다.
 * (옛 2.4m 암 장비에서는 −80°였다)
 *
 * 여기서 암을 펴면서 레버를 12시→3시로 굴려 파는 자리에 닿는다 (tests/readyCourse).
 */
export const READY_BOOM = 48;
export const READY_ARM = -72;

export const readyPose = () => ({
  swing: Math.PI,
  boom: READY_BOOM * deg,
  arm: READY_ARM * deg,
  bucket: -120 * deg,
});
/** 시범이 기계를 내려놓아도 실습은 늘 같은 자세에서 시작한다 */
const reready = (s: DigSession) => s.teleport(readyPose());


/**
 * 시범 속도: 글 읽을 시간 · 레버 깊이 · 결과 볼 시간 (60Hz 프레임).
 * 레버 깊이는 실습과 같은 점선 고리(ARC.ring) — 시범에서 본 손 자리 그대로 따라 하게.
 */
const DEMO = { pre: 75, lever: ARC.ring, post: 75 } as const;
/**
 * 레버 자리(손이 민 곳) → 기계에 들어가는 값. 화면의 레버 곡선(main.ts curve, 2.2제곱)과 같다.
 * 시범은 기계 값을 내야 하는데, 길잡이 고리·점은 레버 자리로 그려진다. 레버 자리로 짜고 여기서 바꾼다.
 */
const toMachine = (k: { rx: number; ry: number }) => ({
  rx: Math.sign(k.rx) * Math.abs(k.rx) ** 2.2,
  ry: Math.sign(k.ry) * Math.abs(k.ry) ** 2.2,
});

/**
 * 퍼기 준비 **결과 자세** (아스트라 기준, 2026-11-17) — 통과는 이것만 본다. 레버를 굴린 과정은 별점으로만.
 * 버킷이 암과 일직선(±8°), 버킷 바닥이 땅에서 0.15~0.75m (낮은 자세도 통과 — 앱 주인, 2026-11-18), 암·선회는 시작 그대로.
 * 과정으로 통과를 막으면 맞는 자세에 온 사람을 되돌려 보낸다 (앱 주인 지적)
 */
export const READY_GOAL = { bucketTol: 8, gapLo: 0.15, gapHi: 0.75, armTol: 5, swingTol: 8 } as const;
const readyErr = (s: DigSession) => ({
  bucket: s.pose.bucket / deg,
  gap: s.groundGap(),
  arm: s.pose.arm / deg - READY_ARM,
  swing: (s.pose.swing - Math.PI) / deg,
});
export const readyResult = (s: DigSession) => {
  const e = readyErr(s);
  const G = READY_GOAL;
  return Math.abs(e.bucket) <= G.bucketTol && e.gap >= G.gapLo && e.gap <= G.gapHi && Math.abs(e.arm) <= G.armTol && Math.abs(e.swing) <= G.swingTol;
};
/** 지금 자세에서 결과 자세로 가려면 무엇을 할지 — 어떤 자세에서든 이걸 따르면 도착한다 */
export const readyCoach = (s: DigSession) => {
  const e = readyErr(s);
  const G = READY_GOAL;
  if (e.gap < G.gapLo) return co('너무 낮아요 — 붐 조금 올리기', '붐 올림');
  if (e.bucket < -G.bucketTol) return co('버킷 조금 펴기 — 암과 일직선', '버킷 펴기');
  if (e.bucket > G.bucketTol) return co('너무 폈어요 — 버킷 조금 오므리기', '버킷 오므림');
  if (e.gap > G.gapHi) return co('조금 높아요 — 붐 조금 내리기', '붐 내림');
  if (e.arm > G.armTol) return co('암이 펴졌어요 — 암 조금 당기기', '암 당기기');
  if (e.arm < -G.armTol) return co('암이 접혔어요 — 암 조금 펴기', '암 펴기');
  if (Math.abs(e.swing) > G.swingTol) return co('몸통이 돌았어요 — 왼쪽 레버 좌우로 되돌리기');
  return co('맞았어요 — 레버 놓고 멈추기');
};
/**
 * 레버를 잡고 있어도 자세 안내가 먼저인 때: 목표 높이 창까지 내려왔거나(이제 자세를 맞출 때),
 * 버킷을 지나치게 폈을 때. 그 위에서 내려오는 동안은 노란 점이 안내한다
 */
const poseFirst = (s: DigSession) => s.groundGap() <= READY_GOAL.gapHi || s.pose.bucket / deg > READY_GOAL.bucketTol;
/**
 * 별점은 **몇 군데 지점**에서만 본다 (앱 주인, 2026-11-17): 그 지점을 지날 때 어느 범위에 있었는지 + 결과.
 * 매 프레임 재지 않는다. 결과 자세에 왔으면 절차 때문에 불합격시키지 않는다.
 * 지점을 처음 지날 때 한 번만 적는다 (1 = 범위 안, 0 = 밖). 안 지났으면(적힌 게 없으면) 깎지 않는다
 */
const mark = (bag: Record<string, number>, key: string, reached: boolean, ok: () => boolean) => {
  if (bag[key] === undefined && reached) bag[key] = ok() ? 1 : 0;
};
const missed = (bag: Record<string, number>, keys: string[]) => keys.filter((k) => bag[k] === 0);
/** 퍼기 준비 지점: 내려오는 중간(높이 2m)에 버킷이 펴지기 시작했나, 땅 1m 앞에서 거의 펴졌나 */
const READY_CP = { midGap: 2.0, midBucket: -95, lowGap: 1.0, lowBucket: -50 } as const;
/** 아직 시작 자세 그대로인가 (손대기 전) */
const untouched = (s: DigSession) => s.groundGap() > 1.2 && s.pose.bucket < -90 * deg;

/**
 * 선회해서 온 자세 → 흙 파기 직전 자세. **오른쪽 레버 하나**로 붐 내림과 버킷 펴기를 잇는다.
 *
 * 오른손을 12시(붐 내림)에서 3시(버킷 펴기)로 굴린다. 암은 건드리지 않는다 —
 * 두 손을 같이 시키면 처음 하는 사람은 어지러워한다 (실사용 피드백). 암은 다음 미션에서.
 * 노란 점이 '지금 레버가 있어야 할 자리'를 남은 높이로 알려 준다.
 */
const arcStep = (): Step => ({
  text: '오른쪽 레버만\n노란 점 따라 붐 내림 → 버킷 펴기',
  labels: ['붐 내림', '버킷 펴기'],
  begin: (s, mem, bag) => {
    reready(s);
    mem.ang = 90;
    mem.rough = 0;
    delete bag.cpMid;
    delete bag.cpLow;
    delete bag.jolt;
  },
  guide: (s) => {
    const m = stickMag(s);
    const want = wantAngle(s);
    const a = m > 0.12 ? stickAngle(s) : 90;
    return {
      ring: ARC.ring,
      from: 90,
      to: 0,
      // 지금 가야 할 자리 — 남은 높이가 정한다
      at: want,
      rough: (m > 0.12 && Math.abs(a - want) > ARC.angTol) || Math.abs(m - ARC.ring) > ARC.ringTol,
    };
  },
  hud: (s, mem) => {
    const m = stickMag(s);
    // 손을 놓았으면 레버 길이 아니라 지금 자세로 말한다 (이미 맞는 사람을 처음으로 돌려보내지 않게)
    if (m <= 0.12) return untouched(s) ? '오른쪽 레버를 위(12시·붐 내림)로 밀며 시작' : null;
    // 자세 안내(코치)가 나오는 동안은 레버 길 안내를 겹쳐 띄우지 않는다 — 자세 오차가 먼저 (아스트라 기준)
    if (poseFirst(s)) return null;
    const a = stickAngle(s);
    // 12시~3시 사분면 밖 = 반대로 밀고 있다 (9시·6시). 높이 탓으로 설명하면 안 된다
    if (a > 120 || a < -30) return '반대쪽이에요 — 12시에서 3시로';
    if (Math.abs(m - ARC.ring) > ARC.ringTol) return m > ARC.ring ? '너무 깊어요 — 점선 고리 안으로' : '점선 고리까지 더 밀기';
    if (mem.rough) return '한 번에 꺾지 말고 천천히 굴리기';
    const want = wantAngle(s);
    // want가 크면(90=12시) 아직 내릴 높이가 남았다는 뜻이다
    if (want - a > ARC.angTol) return '아직 높아요 — 레버를 12시 쪽으로';
    if (a - want > ARC.angTol) return '땅이 가까워요 — 레버를 3시 쪽으로';
    // 잘 따라오는 동안에도 답을 준다 (맞게 움직이는데 화면이 조용하면 맞는지 모른다)
    const g = s.groundGap();
    return g > 1 ? '좋아요 — 점을 따라 그대로' : `버킷 바닥까지 ${Math.max(0, Math.round(g * 100))}cm`;
  },
  // 굴리는 중에는 노란 점이 안내한다. 손을 놓았거나 너무 낮으면 자세로 안내
  coach: (s) => (poseFirst(s) || (stickMag(s) <= 0.12 && !untouched(s)) ? readyCoach(s) : null),
  done: (s, mem, bag) => {
    // 한 번에 확 꺾으면 그 자리에서 알려 준다 (안내만 — 별점에는 안 넣는다)
    const m = stickMag(s);
    if (m > 0.12) {
      const prev = mem.ang;
      mem.ang = prev + (stickAngle(s) - prev) * ARC.smooth;
      if (Math.abs(mem.ang - prev) > ARC.jerkDeg) mem.rough = 20;
    }
    if (mem.rough > 0) mem.rough--;
    // 별점 지점 두 곳 (지날 때 한 번)
    const g = s.groundGap();
    const b = s.pose.bucket / deg;
    mark(bag, 'cpMid', g < READY_CP.midGap, () => b >= READY_CP.midBucket);
    mark(bag, 'cpLow', g < READY_CP.lowGap, () => b >= READY_CP.lowBucket);
    // 통과는 결과 자세만 본다. 어떤 순서로 왔든 맞는 자세면 '멈추기'로
    return hold(mem, readyResult(s), 3);
  },
});

/**
 * 퍼기 준비 시범 — **구분동작** (기획자가 짠 순서, 2026-11-16).
 *
 * 한 번에 굴리면 무엇을 언제 하는지 안 보인다. 단계마다 글을 바꿔 가며 레버를 옮긴다:
 * 1) 서서히 12시로 → 2) 움직이기 시작하면 더 밀기 → 3) 붐이 내려가기 시작하면 조금씩 3시 쪽으로
 * → 4) 내려가며 버킷이 열림 → 5) 중간쯤 오면 더 3시 가깝게 → 6) 목표 높이에서 3시로,
 * 암과 버킷이 일직선이 될 때까지만 → 레버 놓기.
 *
 * 레버 자리(각도·깊이)는 단계를 넘어가도 이어져야 한다 — 단계 메모(mem)는 매번 지워지므로 여기 둔다.
 */
interface RdState {
  /** 지금 레버 자리 (도, 0~1) */
  a: number;
  m: number;
  /** 이 단계가 시작될 때의 레버 자리 (여기서 목표까지 서서히 옮긴다) */
  a0: number;
  m0: number;
  /** 시범 시작 높이 (중간 지점 계산) */
  g0: number;
  /** 시범 시작 버킷 각 (도) */
  b0: number;
  /** 피드백 전 레버 각도 (단계가 짠 각도) */
  base: number;
  /** 마지막으로 계산한 시범 프레임과 그 값 */
  f: number;
  out: Partial<Sticks>;
  /** 왼쪽 레버 앞뒤 (손 자리, −가 암 당기기) */
  ly: number;
  ly0: number;
  /** 레버를 가운데로 거쳐서 옮기는 중 (from) */
  via: boolean;
}
/** 세션마다 따로 (모듈 전역이면 세션 둘이 — 테스트·다시 시작 — 서로의 레버 자리를 덮어쓴다. 개발 검토) */
const RDS = new WeakMap<DigSession, RdState>();
const rd = (s: DigSession): RdState => {
  let v = RDS.get(s);
  if (!v) RDS.set(s, (v = { a: 90, m: 0, a0: 90, m0: 0, g0: s.groundGap(), b0: s.pose.bucket / deg, base: 90, f: -1, out: {}, ly: 0, ly0: 0, via: false }));
  return v;
};
/** 목표 높이: 버킷 바닥이 땅에서 이만큼 (m) */
const RD_LAND = 0.6;
/** 암과 버킷이 일직선 (버킷 상대각 0°) 으로 본다 */
const RD_LINE = -3 * deg;
const rdMid = (s: DigSession) => (rd(s).g0 + RD_LAND) / 2;
/** 시작 높이에서 목표까지 k만큼 내려온 높이 */
const rdAt = (s: DigSession, k: number) => rd(s).g0 + (RD_LAND - rd(s).g0) * k;

export interface Phase {
  text: string;
  labels: string[];
  /** 옮겨 갈 레버 자리 */
  a: number;
  m: number;
  /** 거기까지 옮기는 프레임 */
  ramp: number;
  /** 최소한 이만큼은 보여 준다 (글 읽을 시간) */
  min: number;
  /** 다음으로 넘어갈 조건 (없으면 min만) */
  until?: (s: DigSession) => boolean;
  /** 버킷이 높이를 따라 펴지게 레버 각도를 고친다 (늦으면 3시 쪽으로 더) */
  track?: boolean;
  /** 시범 첫 토막: 기계를 시작 자세로 되돌린다 (다시 보기에도 같은 자리에서) */
  reset?: (s: DigSession) => void;
  /** 레버가 가운데 있을 때 각도를 바로 이 자리로 (돌려 옮기면 반대쪽 동작을 거친다) */
  from?: number;
  /** 길잡이 원호 [시작, 끝] (도, 화면 시계방향). 기본은 12시→3시 */
  arc?: [number, number];
  /** 왼쪽 레버 앞뒤 (손 자리, −가 6시·암 당기기). 오른쪽 레버와 같이 서서히 옮긴다. 없으면 그대로 */
  ly?: number;
  /** 옆에서 보여 주기 (Step.side) */
  side?: boolean;
}
/**
 * 내려가는 높이에 맞춰 버킷이 얼마나 펴져 있어야 하나 (도).
 * 붐이 내려가기 시작한 높이에서 -120°, **거의 다 내려왔을 때(목표 + 15cm) -10°** —
 * 다 내려온 뒤에 버킷을 펴면 순서가 틀린 시범이다 (앱 주인 지적, 2026-11-16)
 */
const RD_BUCKET_END = -10;
const wantBucket = (s: DigSession) => {
  const g1 = rdAt(s, 0.12);
  const p = clamp01((g1 - s.groundGap()) / (g1 - (RD_LAND + 0.15)));
  return rd(s).b0 + (RD_BUCKET_END - rd(s).b0) * p;
};
/** 버킷이 늦은 1°마다 레버를 3시 쪽으로 이만큼 (도) */
const RD_K = 1.5;
/** 손이 레버 각도를 한 스텝에 옮기는 최대 (도) — 피드백이 레버를 튀게 하지 않게 */
const RD_TURN = 1.2;
export const phaseStep = (ph: Phase): Step => ({
  text: ph.text,
  labels: ph.labels,
  side: ph.side,
  demo: (f, s) => {
    const RD = rd(s);
    // 한 스텝에 여러 번 불린다(demoState도 부른다). 각도를 누적해 옮기므로 같은 프레임이면 같은 값
    if (f === RD.f) return RD.out;
    RD.f = f;
    const k = Math.min(1, f / Math.max(1, ph.ramp));
    // 서서히: 처음과 끝을 부드럽게 (손이 확 꺾이지 않게)
    const e = k * k * (3 - 2 * k);
    RD.base = RD.a0 + (ph.a - RD.a0) * e;
    let want = RD.base;
    if (ph.track) want = Math.max(10, Math.min(90, RD.base - RD_K * (wantBucket(s) - s.pose.bucket / deg)));
    // 피드백이 레버를 튀게 하지 않게 (따라가는 토막만 — 나머지는 이미 서서히 옮긴다)
    RD.a = ph.track ? RD.a + Math.max(-RD_TURN, Math.min(RD_TURN, want - RD.a)) : want;
    RD.m = RD.m0 + (ph.m - RD.m0) * e;
    if (RD.via) {
      // 밀던 레버를 가운데로 놓았다가(앞 절반) 새 자리로 민다(뒤 절반) — 돌려 옮기면 사이 동작을 거친다
      const h = Math.min(1, k * 2);
      const eh = h * h * (3 - 2 * h);
      if (k < 0.5) (RD.a = RD.a0), (RD.m = RD.m0 * (1 - eh));
      else {
        const h2 = Math.min(1, (k - 0.5) * 2);
        RD.a = RD.base = ph.from!;
        RD.m = ph.m * h2 * h2 * (3 - 2 * h2);
      }
    }
    if (ph.ly !== undefined) RD.ly = RD.ly0 + (ph.ly - RD.ly0) * e;
    const r = RD.m < 0.01 ? {} : toMachine(stickAt(RD.a, RD.m));
    RD.out = Math.abs(RD.ly) < 0.01 ? r : { ...r, ly: Math.sign(RD.ly) * Math.abs(RD.ly) ** 2.2 };
    return RD.out;
  },
  guide: (s) => ({ ring: Math.max(0.2, rd(s).m), from: ph.arc?.[0] ?? 90, to: ph.arc?.[1] ?? 0, at: rd(s).a, rough: false }),
  begin: (s, mem) => {
    const RD = rd(s);
    if (ph.reset) {
      ph.reset(s);
      RD.a = RD.base = ph.from ?? ph.a;
      RD.m = 0;
      RD.g0 = s.groundGap();
      RD.b0 = s.pose.bucket / deg;
      RD.ly = 0;
    } else if (ph.from !== undefined && RD.m < 0.01) RD.a = RD.base = ph.from;
    RD.via = ph.from !== undefined && RD.m >= 0.01 && Math.abs(RD.a - ph.from) > 1;
    RD.a0 = RD.base;
    RD.ly0 = RD.ly;
    RD.f = -1;
    RD.m0 = RD.m;
    mem.t = 0;
  },
  // 조건이 끝내 안 오면(저사양 등) 10초에 넘어간다 — 시범이 멈춰 서면 안 된다
  done: (s, mem) => ++mem.t >= Math.max(ph.min, ph.ramp) && (!ph.until || ph.until(s) || mem.t > 600),
});
const readyDemo = (): Step[] => [
  phaseStep(
    { text: '오른쪽 레버를\n서서히 12시로', labels: ['붐 내림'], a: 90, m: 0.32, ramp: 70, min: 140, reset: reready },
  ),
  phaseStep({
    text: '붐이 움직이기 시작하면\n조금 더 밀기',
    labels: ['붐 내림'],
    a: 90,
    m: 0.5,
    ramp: 45,
    min: 70,
    until: (s) => s.groundGap() < rdAt(s, 0.12),
  }),
  phaseStep({
    text: '붐이 내려가기 시작 —\n조금씩 3시 쪽으로',
    track: true,
    labels: ['붐 내림', '버킷 펴기'],
    a: 62,
    m: 0.6,
    ramp: 50,
    min: 70,
    until: (s) => s.groundGap() < rdAt(s, 0.3),
  }),
  phaseStep({
    text: '붐이 내려가면서\n버킷이 열립니다',
    track: true,
    labels: ['붐 내림', '버킷 펴기'],
    a: 62,
    m: 0.6,
    ramp: 1,
    min: 45,
    until: (s) => s.groundGap() <= rdMid(s),
  }),
  phaseStep({
    text: '중간쯤 왔으면\n더 3시 가깝게',
    track: true,
    labels: ['붐 내림', '버킷 펴기'],
    // 레버 곡선이 축마다 걸려서, 3시에 너무 붙이면 붐이 거의 멈춘다 — 40°·조금 깊게
    a: 40,
    m: 0.7,
    ramp: 50,
    min: 60,
    // 버킷이 먼저 다 열리면 일직선을 지나친다 — 그 전에 3시로 넘어간다
    until: (s) => s.groundGap() <= RD_LAND || s.pose.bucket >= (RD_BUCKET_END - 2) * deg,
  }),
  phaseStep({
    text: '목표 높이 — 3시로\n암과 버킷이 일직선이 될 때까지',
    labels: ['버킷 펴기'],
    // 남은 건 10°쯤 — 살짝만 민다. 오래 밀면 일직선을 지나친다
    // (읽을 시간은 앱이 지시문이 바뀔 때 시범을 세워서 준다 — 여기서 min을 길게 잡으면 그동안 계속 펴진다)
    a: 0,
    m: 0.5,
    ramp: 20,
    min: 20,
    // 레버를 놓는 동안에도 조금 더 펴진다 — 그만큼 앞에서 놓는다
    until: (s) => s.pose.bucket >= RD_LINE - 4 * deg,
  }),
  // 실습과 같은 판정으로 끝난다: 결과 자세에서 다 섰을 때 (아스트라 기준)
  phaseStep({ text: '일직선이면\n레버를 놓아 멈춤', labels: [], a: 0, m: 0, ramp: 20, min: 100, until: (s) => readyResult(s) && still(s) }),
];

export const READY_LESSON: Lesson = {
  id: 'b-ready',
  tier: '기본기',
  icon: 'stAim',
  title: '퍼기 준비 자세',
  noFail: true,
  big: true,
  flat: true,
  why: {
    title: '레버 하나로 이어지는 동작',
    lines: [
      '흙을 푸기 <b>직전 자세</b>를 만드는 연습입니다.',
      '오른쪽 레버 하나로 <b>붐을 내리면서 버킷을 엽니다</b>.',
      '레버를 위(12시·붐 내림)에서 시작해, 내려갈수록 오른쪽(3시·버킷 펴기)으로 조금씩 옮깁니다.',
      '이번에는 <b>오른쪽 레버만</b> 씁니다. 암은 그대로 두세요.',
    ],
  },
  // 지점 두 곳(중간 높이·땅 1m 앞)에서 버킷이 범위 안이었나 + 덜컹. 결과 자세엔 이미 왔다
  grade: (_s, bag): Grade => {
    const miss = missed(bag, ['cpMid', 'cpLow']);
    if (miss.length >= 2) return { stars: 1, note: '목표 자세는 맞았어요. 다음엔 내려오면서 버킷을 같이 펴 보세요' };
    if (miss[0] === 'cpMid') return { stars: 2, note: '자세는 맞았어요. 붐이 내려가기 시작하면 버킷도 같이 펴세요' };
    if (miss[0] === 'cpLow') return { stars: 2, note: '자세는 맞았어요. 땅에 가까워지기 전에 버킷을 거의 다 펴 두세요' };
    if (bag.jolt) return { stars: 2, note: '자세는 맞았어요. 레버를 천천히 놓아 보세요' };
    return { stars: 3, note: '내려오면서 버킷을 같이 펴 한 번에 맞췄습니다' };
  },
  setup: (s) => {
    s.teleport(readyPose());
  },
  steps: [
    // ---- 시범: 무엇을 움직이고 무엇을 조심할지 ----
    // 글을 먼저 읽고(DEMO.pre) → 천천히 움직이고 → 결과를 보고(DEMO.post) 넘어간다.
    // 시범은 단계가 끝날 때까지 빈 입력({})을 내서 '시범 중'을 유지한다 (보는 동안 손이 섞이지 않게).
    // 실제 속도로 보여 주면 2초 안에 지나가 무엇을 했는지 모른다 (실사용 피드백)
    ...readyDemo(),
    {
      text: '한 번에 꺾으면' + '\n' + '덜컹합니다',
      labels: ['붐 내림', '버킷 펴기'],
      demo: (f) => (f < DEMO.pre ? {} : f < DEMO.pre + 30 ? toMachine(stickAt(90)) : f < DEMO.pre + 80 ? toMachine(stickAt(0)) : {}),
      guide: () => ({ ring: ARC.ring, from: 90, to: 0, at: 45, rough: true }),
      begin: (s, mem) => {
        reready(s);
        mem.t = 0;
      },
      done: (_s, mem) => ++mem.t > DEMO.pre + 80 + DEMO.post,
    },
    {
      // 보고 이해했는지는 본인이 안다 — 한 번 더 볼지 고르게 한다
      text: '시범 끝'+'\n'+'다시 볼까요?',
      ask: { replay: 0 },
      demo: () => ({}),
      done: () => false,
    },
    // ---- 직접 ----
    arcStep(),
    span(
      {
        text: '레버를 가운데로 놓아\n멈추기',
        // 멈추는 단계에서 방향 이름표를 깜빡이면 '계속 밀라'로 읽힌다 (검토)
        labels: [],
        hud: (s) => (readyResult(s) ? (handOn(s) ? '레버가 아직 밀려 있어요' : still(s) ? '멈추는 중 — 그대로' : '여기! 레버를 가운데로 놓기') : null),
        done: (s, mem, bag) => {
          // 같은 결과 자세 판정 + 레버 놓고 정지. 덜컹은 통과를 막지 않고 별에서 깎는다
          if (!smooth(s, mem)) bag.jolt = 1;
          const hands = !handOn(s);
          return hold(mem, readyResult(s) && hands && still(s), 15);
        },
        // 자세가 벗어났으면 무엇을 할지 (맞으면 '놓고 멈추기')
        coach: (s) => (readyResult(s) && !handOn(s) ? null : readyCoach(s)),
      },
      ['boom', 'bucket'],
    ),
  ],
};
// ---------------------------------------------------------------- 3단계
/** 흙을 담고 버리는 자리(C)에 온 상태 */
/**
 * 흙을 담고 C로 선회해 온 자세: 퍼기 준비와 같은 **선회해도 안전한 자세**
 * (붐 48°·암 −72°·버킷 오므림 — 줄 위로 지나간다). 여기서 쏟기 시작한다 (앱 주인이 짠 순서, 2026-11-16)
 */
const dumpSetup = (s: DigSession) => {
  s.teleport({ ...readyPose(), swing: 0 });
  fill(s, 1.1);
};
/** 오므리기·붐 올리기를 같이 하는 레버 자리: 9시(180°)와 6시(270°) 사이 */
const DUMP_ARC: [number, number] = [270, 180];


/** 들기 레버 자리 (도): 7시보다 9시 쪽 — 버킷을 **다 접는** 동안 붐이 줄 위까지만 오른다 `[측정]` */
const LIFT_ANG = 220;
/** 쏟는 높이 (버킷 바닥~땅, m): 이 높이까지 붐을 내린 뒤 펴기 시작 — 다 쏟을 때 0.1~0.8m */
/** start: 시범이 쏟기 시작하는 높이 / coachHigh: 실습에서 '너무 높아요' 안내 (시범 높이와 따로) */
const DUMP_LOW = { start: 2.0, coachHigh: 2.0 } as const;
/** 쏟고 돌릴 자세 별점 지점 (넉넉하게): 반쯤 쏟을 때 1.2m 안 / 90° 접었을 때 붐으로 0.4m 이상 / 줄 0.5m 아래에서 80° 이상 */
const DUMP_CP = { gap: 1.2, half: 90, rise: 0.4, below: 0.5, curlAt: 80 } as const;
/**
 * 쏟고 돌릴 자세 시범 — 구분동작 (앱 주인이 짠 순서, 2026-11-16).
 * 선회해 온 안전 자세 → 서서히 12시 → 12시에서 3시로 옮기며(붐 내림+버킷 펴기) 흙이 다 쏟아짐
 * → 가운데 → 9시(오므림) → 7시(오므리며 붐 올림) → 선회 자세에서 천천히 놓기.
 * 읽을 시간은 앱이 지시문이 바뀔 때마다 시범을 세워서 준다. 여기서는 레버를 천천히 옮기는 데만 시간을 쓴다
 */
const dumpDemo = (): Step[] => [
  phaseStep({ text: '선회해 온 자세에서 시작\n줄 위로 안전한 높이', labels: [], a: 90, m: 0, ramp: 1, min: 90, reset: dumpSetup, arc: [90, 0] }),
  // 쏟는 자리는 땅 가까이 — 높이서 쏟으면 흙이 튄다 (앱 주인 지적, 2026-11-17). 붐부터 내려 땅 가까이 온 뒤 쏟는다
  phaseStep({ text: '오른쪽 레버를 12시로\n붐 내려 땅 가까이', labels: ['붐 내림'], a: 90, m: 0.55, ramp: 60, min: 80, arc: [90, 0], until: (s) => s.groundGap() < DUMP_LOW.start }),
  phaseStep({
    text: '12시에서 3시로 옮기면서\n붐 내림 + 버킷 펴기',
    labels: ['붐 내림', '버킷 펴기'],
    a: 0,
    m: 0.7,
    // 손이 2.5초에 걸쳐 3시로 굴러간다 — 그 사이 버킷이 열리며 흙이 저절로 쏟아진다
    ramp: 90,
    min: 90,
    // 시범은 다 쏟을 때까지 끝까지 편다 (실습 판정은 MOVE.empty로 너그럽게)
    until: (s) => s.load < 0.01 * SC(s),
  }),
  phaseStep({ text: '흙이 다 쏟아지면\n레버를 가운데로', labels: [], a: 0, m: 0, ramp: 30, min: 50, arc: [90, 0] }),
  phaseStep({ text: '레버를 9시로\n버킷 오므리기', labels: ['버킷 오므림'], a: 180, from: 180, m: 0.55, ramp: 40, min: 110, arc: DUMP_ARC }),
  // 놓는 동안에도 붐이 30cm쯤 더 올라간다 — 줄 바로 아래에서 놓기 시작하면 줄 위 알맞은 높이에 선다
  phaseStep({ text: '7시로 옮기며\n버킷 다 접으면서 붐 올리기', labels: ['버킷 오므림', '붐 올림'], a: LIFT_ANG, m: 0.7, ramp: 60, min: 60, arc: DUMP_ARC, until: (s) => swingPose(s) }),
  phaseStep({ text: '선회 자세가 되면\n레버를 천천히 놓기', labels: [], a: LIFT_ANG, m: 0, ramp: 50, min: 70, arc: DUMP_ARC, until: (s) => swingPose(s) && still(s) }),
];

/** 선회 자세: 버킷 다 접음 + 버킷 최저점이 줄보다 넉넉히 위 (흙 퍼기 들기와 같은 기준) */
export const swingPose = (s: DigSession) => -s.pose.bucket / deg >= MOVE.curl - 1e-6 && bucketLow(s) >= ropeClear(s);

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
  // 지점 세 곳: 반쯤 쏟았을 때 높이, 버킷을 반쯤(90°) 접었을 때 붐이 올라오고 있었나, 줄 0.8m 아래를 지날 때 버킷이 반쯤 접혀 있었나
  grade: (_s, bag): Grade => {
    const miss = missed(bag, ['cpDump', 'cpLift', 'cpCurl']);
    if (miss.length >= 2) return { stars: 1, note: '자세는 맞았어요. 땅 가까이서 쏟고, 오므리면서 들어 보세요' };
    if (miss[0] === 'cpDump') return { stars: 2, note: '자세는 맞았어요. 붐을 내려 땅 가까이서 쏟아 보세요' };
    if (miss[0] === 'cpLift') return { stars: 2, note: '자세는 맞았어요. 오므리면서 붐도 같이 올려 보세요' };
    if (miss[0] === 'cpCurl') return { stars: 2, note: '자세는 맞았어요. 붐을 올리면서 버킷도 같이 접어 보세요' };
    if (bag.jolt) return { stars: 2, note: '자세는 맞았어요. 레버를 천천히 놓아 덜컹하지 않게' };
    return { stars: 3, note: '땅 가까이서 쏟고, 오므리면서 들어 한 번에 선회 자세가 됐습니다' };
  },
  setup: (s) => dumpSetup(s),
  steps: [
    ...dumpDemo(),
    {
      text: '시범 끝\n다시 볼까요?',
      labels: [],
      ask: { replay: 0 },
      // 고르는 동안 레버가 기계를 움직이지 않게 (퍼기 준비와 같게)
      demo: () => ({}),
      done: () => false,
    },
    {
      text: '12시로 붐 내려 땅 가까이\n3시로 옮기며 흙 쏟기',
      // 시범이 흙을 쏟고 자세를 바꿔 놓았다 — 같은 자리·같은 흙으로
      begin: (s, _mem, bag) => {
        dumpSetup(s);
        for (const k of ['cpDump', 'cpLift', 'cpCurl', 'jolt']) delete bag[k];
      },
      // 시범처럼 12시→3시로 옮기며 (붐 내림 + 버킷 펴기). 버킷만 펴도 쏟아지니 판정은 흙만 본다
      labels: ['붐 내림', '버킷 펴기'],
      hud: (s) => `버킷에 남은 흙 ${Math.round((s.load / SC(s)) * 100)}%`,
      done: (s, _mem, bag) => {
        mark(bag, 'cpDump', s.load < 0.5 * SC(s), () => s.groundGap() <= DUMP_CP.gap);
        return s.load < MOVE.empty * SC(s);
      },
      // 높이서 쏟으면 흙이 튄다 — 땅 가까이에서 (막지는 않는다)
      coach: (s) =>
        s.groundGap() < 0.05
          ? co('너무 낮아요 — 붐 조금 올리기', '붐 올림')
          : s.groundGap() > DUMP_LOW.coachHigh && s.pose.bucket > -100 * deg && s.load > MOVE.empty * SC(s)
            ? co('높아요 — 붐 내려 땅 가까이에서 쏟기', '붐 내림')
            : null,
    },
    span(
      {
        text: '오므리며 붐 올리기',
        labels: ['버킷 오므림', '붐 올림'],
        // 통과는 결과 자세(다 접음 + 줄 위)만. 같이 움직였는지는 지점 두 곳에서만 본다 (되돌려 보내지 않는다)
        begin: (s, mem) => (mem.low0 = bucketLow(s)),
        done: (s, mem, bag) => {
          const curl = -s.pose.bucket / deg;
          mark(bag, 'cpLift', curl >= DUMP_CP.half, () => bucketLow(s) >= mem.low0 + DUMP_CP.rise);
          mark(bag, 'cpCurl', bucketLow(s) >= ropeClear(s) - DUMP_CP.below, () => curl >= DUMP_CP.curlAt);
          return swingPose(s);
        },
        coach: (s) =>
          -s.pose.bucket / deg < MOVE.curl
            ? co('버킷을 끝까지 오므리기', '버킷 오므림')
            : bucketLow(s) < ropeClear(s)
              ? co('붐을 더 올리기', '붐 올림')
              : null,
      },
      ['bucket', 'boom'],
    ),
    span(
      {
        text: '그 자세로 멈추기',
        labels: [],
        // 결과 자세 + 레버 놓음 + 정지. 덜컹은 통과를 막지 않고 별에서 깎는다 (퍼기 준비와 같게 — 아스트라 기준).
        // 레버를 놓아야 한다 — 버킷이 끝에 닿으면 잡은 채로도 선다
        done: (s, mem, bag) => {
          if (!smooth(s, mem)) bag.jolt = 1;
          return hold(mem, swingPose(s) && !handOn(s) && still(s), 15);
        },
        coach: (s) => {
          if (!handOn(s) && -s.pose.bucket / deg < MOVE.curl) return co('버킷을 끝까지 오므리기', '버킷 오므림');
          // 줄보다 낮으면 멈춰도 안 넘어간다 — 말해 주지 않으면 막대만 차고 끝이 안 난다
          if (!handOn(s) && bucketLow(s) < ropeClear(s)) return co('버킷이 줄보다 낮아요 — 붐 올리기', '붐 올림');
          return null;
        },
        hud: (s) => (handOn(s) ? '레버를 천천히 가운데로' : null),
        // 진행: 레버를 놓으면 기계가 서는 만큼 차고, 다 서면 끝까지
        meter: (s, mem) => {
          if (handOn(s)) return { v: 0 };
          return { v: Math.min(1, 0.85 * settled(s) + 0.15 * Math.min(1, (mem.hold ?? 0) / 15)) };
        },
      },
      ['boom', 'bucket'],
    ),
  ],
};
