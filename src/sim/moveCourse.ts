import { bucketLow, co, hold, ropeClear, SC, fill, type Grade, type Lesson, type Step } from './tutorial';
import { retrySpan, SMOOTH_MAX, spanCo, spanJolt, startSpan, tickSpan, type Joint } from './gauge';
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

/** 레버를 아직 잡고 있나 (손 자리) */
const handOn = (s: DigSession) => Math.hypot(s.stick.rx, s.stick.ry) > 0.12 || Math.hypot(s.stick.lx, s.stick.ly) > 0.12;
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
  /** 버킷 바닥이 이 높이에 닿을 때 레버가 3시에 와 있어야 한다 (m) */
  land: 0.25,
  /** 이 높이부터 레버를 3시로 굴리기 시작한다 (land + roll) */
  roll: 1.5,
} as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * 남은 높이에 맞는 레버 각도 (도). 땅이 멀면 12시(붐 내림), 가까워지면 3시(버킷 펴기).
 *
 * 내려오는 높이에 맞춰 레버를 굴리면 붐이 서서히 멈추고 버킷이 서서히 펴져서,
 * 흙 파기 직전 자세로 끊김 없이 이어진다.
 */
export const wantAngle = (s: DigSession) => 90 * clamp01((s.groundGap() - ARC.land) / ARC.roll);

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

const readyPose = () => ({
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
    startSpan(s, mem);
    mem.ang = 90;
    mem.rough = 0;
    mem.swept = 0;
    mem.started = 0;
    bag.rough = bag.rough ?? 0;
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
    if (m < 0.12) return '오른쪽 레버를 위(12시·붐 내림)로 밀며 시작';
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
  coach: (s) => (s.groundGap() <= 0.02 ? co('너무 깊어요 — 붐을 조금 올리기', '붐 올림') : null),
  done: (s, mem, bag) => {
    tickSpan(s, mem, ['boom', 'bucket']);
    const m = stickMag(s);
    const a = stickAngle(s);
    if (m > 0.12) {
      // 12시 근처에서 출발했는가 (여기는 손이 실제로 둔 자리를 본다)
      if (a >= 90 - ARC.angTol && a <= 90 + ARC.angTol) mem.started = 1;
      // 점을 얼마나 따라갔는가 — 별점의 재료 (통과만 보면 '지나가며' 지나갈 수 있다).
      // 평균이 아니라 **벗어난 프레임의 비율**이다 — 맞는 자리에서 오래 기다려도 희석되지 않게
      if (mem.started) {
        bag.offN = (bag.offN ?? 0) + 1;
        if (Math.abs(a - wantAngle(s)) > ARC.angTol) bag.offBad = (bag.offBad ?? 0) + 1;
      }
      const prev = mem.ang;
      mem.ang = prev + (a - prev) * ARC.smooth;
      // 한 번에 확 꺾으면 거칠다. 한 번의 꺾음을 한 번으로만 센다
      if (Math.abs(mem.ang - prev) > ARC.jerkDeg) {
        if (!mem.rough) bag.rough = (bag.rough ?? 0) + 1;
        mem.rough = 20;
      }
      // 12시에서 3시로 내려온 만큼만 쌓는다 (되돌아간 것은 안 센다)
      if (prev - mem.ang > 0) mem.swept += prev - mem.ang;
    }
    if (mem.rough > 0) mem.rough--;
    // 원호를 실제로 그리고, 땅 가까이 와야 한다. 3시에 레버를 툭 놓는 것으로는 안 된다.
    // 멈추기 단계의 창(gapHi)보다 안쪽이어야 한다 — 0.5로 두면 45~50cm에서 통과해 다음 단계에 갇힌다
    const ok = m > 0.12 && a <= ARC.endAng && a >= -ARC.angTol && s.groundGap() < MOVE.gapHi - 0.05;
    if (ok) bag.co = spanCo(mem);
    // 한 프레임 스치고 지나가면 안 된다 — 그 자세로 잠깐은 있어야 한다
    return mem.started > 0 && mem.swept > 60 && hold(mem, ok, 10);
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
  phaseStep({ text: '일직선이면\n레버를 놓아 멈춤', labels: [], a: 0, m: 0, ramp: 20, min: 100 }),
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
  grade: (_s, bag): Grade => {
    const r = bag.rough ?? 0;
    // 점에서 벗어난 프레임 비율 + 두 손을 겹쳐 쓴 비율
    const off = bag.offN ? (bag.offBad ?? 0) / bag.offN : 0;
    const c = bag.co ?? 0;
    if (r === 0 && off < 0.05 && c >= MOVE.co) return { stars: 3, note: '레버를 끊김 없이 굴려 내려놨습니다' };
    if (r <= 3 && off < 0.25) return { stars: 2, note: '조금 끊겼어요. 노란 점을 따라 천천히 굴려 보세요' };
    return { stars: 1, note: '하나씩 했어요. 붐 내림에서 버킷 펴기로 굴려 보세요' };
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
        hud: (s) => {
          const g = s.groundGap();
          if (g > MOVE.gapLo && g < MOVE.gapHi)
            return stickMag(s) > 0.12 || Math.hypot(s.stick.lx, s.stick.ly) > 0.12
              ? '레버가 아직 밀려 있어요'
              : still(s)
                ? '멈추는 중 — 그대로'
                : '여기! 레버를 가운데로 놓기';
          if (g <= MOVE.gapLo) return '너무 깊어요 — 붐을 조금 올리기';
          return `조금 더 — 버킷 바닥까지 ${Math.round(g * 100)}cm`;
        },
        done: (s, mem, bag) => {
          const g = s.groundGap();
          const inWin = g > MOVE.gapLo && g < MOVE.gapHi;
          // 범위 밖으로 나가면 '다시 내려오는 중'이다 — 충격을 새로 잰다 (덜컹 한 번에 막히지 않게)
          if (!inWin) retrySpan(s);
          // 레버를 실제로 놓아야 한다 — 이 단계가 가르치는 것이 '놓아서 멈추기'다
          const hands = stickMag(s) < 0.12 && Math.hypot(s.stick.lx, s.stick.ly) < 0.12;
          const ok = inWin && hands && still(s) && smooth(s, mem);
          if (ok) bag.rough = bag.rough ?? 0;
          return hold(mem, ok, 15);
        },
        coach: (s, mem) => (!smooth(s, mem) ? co('덜컹했어요 — 붐을 조금 올렸다 다시 내리기', '붐 올림') : null),
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
/** 7시 (도) — 9시(180°)와 6시(270°) 사이에서 6시 쪽: 오므리면서 붐을 올린다 */
const SEVEN = 240;
/**
 * 쏟고 돌릴 자세 시범 — 구분동작 (앱 주인이 짠 순서, 2026-11-16).
 * 선회해 온 안전 자세 → 서서히 12시 → 12시에서 3시로 옮기며(붐 내림+버킷 펴기) 흙이 다 쏟아짐
 * → 가운데 → 9시(오므림) → 7시(오므리며 붐 올림) → 선회 자세에서 천천히 놓기.
 * 읽을 시간은 앱이 지시문이 바뀔 때마다 시범을 세워서 준다. 여기서는 레버를 천천히 옮기는 데만 시간을 쓴다
 */
const dumpDemo = (): Step[] => [
  phaseStep({ text: '선회해 온 자세에서 시작\n줄 위로 안전한 높이', labels: [], a: 90, m: 0, ramp: 1, min: 90, reset: dumpSetup, arc: [90, 0] }),
  phaseStep({ text: '오른쪽 레버를\n서서히 12시로', labels: ['붐 내림'], a: 90, m: 0.4, ramp: 60, min: 80, arc: [90, 0] }),
  phaseStep({
    text: '12시에서 3시로 옮기면서\n붐 내림 + 버킷 펴기',
    labels: ['붐 내림', '버킷 펴기'],
    a: 0,
    m: 0.65,
    // 손이 2.5초에 걸쳐 3시로 굴러간다 — 그 사이 버킷이 열리며 흙이 저절로 쏟아진다
    ramp: 150,
    min: 150,
    until: (s) => s.load < MOVE.empty * SC(s),
  }),
  phaseStep({ text: '흙이 다 쏟아지면\n레버를 가운데로', labels: [], a: 0, m: 0, ramp: 30, min: 50, arc: [90, 0] }),
  phaseStep({ text: '레버를 9시로\n버킷 오므리기', labels: ['버킷 오므림'], a: 180, from: 180, m: 0.55, ramp: 40, min: 110, arc: DUMP_ARC }),
  // 놓는 동안에도 붐이 30cm쯤 더 올라간다 — 줄 바로 아래에서 놓기 시작하면 줄 위 알맞은 높이에 선다
  phaseStep({ text: '7시로 옮기며\n오므리면서 붐 올리기', labels: ['버킷 오므림', '붐 올림'], a: SEVEN, m: 0.7, ramp: 60, min: 60, arc: DUMP_ARC, until: (s) => -s.pose.bucket / deg >= MOVE.curl && bucketLow(s) >= ropeClear(s) - 0.2 }),
  phaseStep({ text: '선회 자세가 되면\n레버를 천천히 놓기', labels: [], a: SEVEN, m: 0, ramp: 50, min: 70, arc: DUMP_ARC }),
];

/** '오므리며 붐 올리기' 단계 번호 (막혔을 때 되돌아갈 곳 — 앞에 시범이 있어 번호를 박아 두면 틀린다) */
const dumpLiftStep = () => DUMP_LESSON.steps.findIndex((st) => st.text === '오므리며 붐 올리기');

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
      text: '레버를 12시에서 3시로\n옮기며 흙 쏟기',
      // 시범이 흙을 쏟고 자세를 바꿔 놓았다 — 같은 자리·같은 흙으로
      begin: (s) => dumpSetup(s),
      // 시범처럼 12시→3시로 옮기며 (붐 내림 + 버킷 펴기). 버킷만 펴도 쏟아지니 판정은 흙만 본다
      labels: ['붐 내림', '버킷 펴기'],
      hud: (s) => `버킷에 남은 흙 ${Math.round((s.load / SC(s)) * 100)}%`,
      done: (s) => s.load < MOVE.empty * SC(s),
    },
    span(
      {
        text: '오므리며 붐 올리기',
        labels: ['버킷 오므림', '붐 올림'],
        // 다시 할 때 돌아올 자세 (쏟은 직후)
        begin: (s, _mem, bag) => {
          if (bag.dumpRetry) {
            s.teleport({ boom: bag.dB, arm: bag.dA, bucket: bag.dK });
            bag.dumpRetry = 0;
          } else {
            bag.dB = s.pose.boom;
            bag.dA = s.pose.arm;
            bag.dK = s.pose.bucket;
          }
        },
        // 하나씩 끝까지 써 버리면 더 움직일 수가 없어 비율이 영영 안 오른다 — 막다른 길. 쏟은 자세로 되돌려 다시
        fail: (s, mem, bag) => {
          const lim = s.m.limits;
          const atEnd = s.pose.boom >= lim.boom[1] - 2 * deg || s.pose.bucket <= lim.bucket[0] + 2 * deg;
          mem.stuck = atEnd && still(s) && spanCo(mem) < MOVE.coMin ? (mem.stuck ?? 0) + 1 : 0;
          if (mem.stuck < 40) return null;
          bag.dumpRetry = 1;
          return { to: dumpLiftStep(), msg: '같이 움직여야 해요 — 다시' };
        },
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
        labels: [],
        done: (s, mem) => {
          // 덜컹은 한 번 올라가면 안 내려간다 — 레버를 다시 잡으면 새로 잰다 (안 그러면 막다른 길)
          if (handOn(s)) retrySpan(s);
          return hold(mem, bucketLow(s) >= ropeClear(s) && still(s) && smooth(s, mem), 15);
        },
        coach: (s, mem) => {
          if (!smooth(s, mem)) return co('덜컹했어요 — 레버를 살짝 다시 밀었다 천천히 놓기');
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
