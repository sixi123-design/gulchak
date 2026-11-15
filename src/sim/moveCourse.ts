import { bucketLow, co, hold, pose, ropeClear, SC, fill, type Grade, type Lesson, type Step } from './tutorial';
import { retrySpan, SMOOTH_MAX, spanCo, spanJolt, startSpan, tickSpan, type Joint } from './gauge';
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

/** 시범이 사람처럼 오른쪽 레버를 굴린다 (유저가 할 일을 그대로 보여 준다 — 암은 안 쓴다) */
const showMove = (s: DigSession, m: number = ARC.ring) => stickAt(wantAngle(s), m);

/** 시범 속도: 글 읽을 시간 · 레버 깊이(얕게 = 느리게) · 결과 볼 시간 (60Hz 프레임) */
const DEMO = { pre: 75, lever: 0.42, post: 75 } as const;

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
      '선회해서 돌아오면 붐은 올라가 있고 버킷은 오므려져 있습니다.',
      '오른쪽 레버 하나를 <b>12시(붐 내림)에서 3시(버킷 펴기)로</b> 굴립니다.',
      '붐이 내려가는 힘이 줄면서 버킷이 펴집니다.',
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
    {
      // 시범이다 — 명령으로 읽히지 않게 '굴리면'으로 끝낸다
      text: '오른쪽 레버를 12시에서 3시로 굴리면'+'\n'+'내려가며 버킷이 펴집니다',
      labels: ['붐 내림', '버킷 펴기'],
      // 남은 높이에 맞춰 레버를 굴린다 — 유저가 할 일을 그대로, 천천히 보여 준다
      demo: (f, s) => (f >= DEMO.pre && f < DEMO.pre + 900 && s.groundGap() > ARC.land ? showMove(s, DEMO.lever) : {}),
      guide: (s) => ({ ring: DEMO.lever, from: 90, to: 0, at: wantAngle(s), rough: false }),
      begin: (s, mem) => {
        reready(s);
        mem.t = 0;
        mem.end = 0;
      },
      done: (s, mem) => {
        mem.t++;
        if (!mem.end && mem.t > DEMO.pre + 30 && (s.groundGap() <= ARC.land + 0.2 || mem.t > DEMO.pre + 940)) mem.end = mem.t;
        return mem.end > 0 && mem.t > mem.end + DEMO.post;
      },
    },
    {
      text: '한 번에 꺾으면' + '\n' + '덜컹합니다',
      labels: ['붐 내림', '버킷 펴기'],
      demo: (f) => (f < DEMO.pre ? {} : f < DEMO.pre + 30 ? stickAt(90) : f < DEMO.pre + 80 ? stickAt(0) : {}),
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
        labels: ['붐 내림'],
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
