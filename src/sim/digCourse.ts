import { MOVE, phaseStep, type Phase } from './moveCourse';
import type { DigSession } from './session';
import { bucketLow, co, hold, ropeClear, SC, type Grade, type Lesson, type Meter, type Step } from './tutorial';
import { toWorld } from './kinematics';

const deg = Math.PI / 180;

/**
 * 흙 퍼기 — **정석**을 가르친다 (앱 주인, 2026-11-17).
 * 퍼기 준비 자세 → 암 펴서 먼 끝 → 이빨이 안 보이게 꽂기 → 9시로 오므려 바닥을 땅과 평행하게
 * → 6시로 암 당겨 흙 담기 (점선 = 가상굴착제한선 전에) → 7시로 오므리며 붐 올려 선회 자세 → 천천히 놓기.
 * 시범과 실습이 같은 자세·같은 순서·같은 판정이다 (검토: 시범과 실습이 어긋나면 따라 할 수 없다).
 */
export const SCOOP = {
  /** 꽂는 깊이: 꽂기 전 흙 표면에서 날 끝까지 (m). 이빨이 안 보일 만큼 — 깊게 욕심내 물면 과부하 */
  biteLo: 0.12,
  biteHi: 0.3,
  /** 시범이 꽂는 깊이 */
  biteDemo: 0.2,
  /** 버킷 바닥이 땅과 평행하다고 보는 각 (도): 이보다 서 있으면 아직, overCurl보다 더 오므리면 너무 많이 */
  flat: 20,
  overCurl: -15,
  /** 암으로 이만큼은 당겨야 '암으로 담았다' (도) — 버킷으로 긁어 담기 막기 */
  armPull: 8,
  /** 담기 통과 (평적 대비) */
  fill: 0.9,
  /**
   * 평적으로 보는 양 `[측정]` — 처음 흙에서 정석(12~30cm 꽂고 평행, 암으로 점선 앞까지)으로 0.95~0.98이 담긴다.
   * 눈으로는 테두리와 같은 높이라 이만큼을 평적(초록 칸 시작)으로 본다
   */
  full: 0.95,
  /** 가상굴착제한선(점선)에서 이만큼 앞이면 들 준비 (m) */
  lineMargin: 0.5,
  /** 들어 올리는 동안 지켜야 하는 비율 (담았던 양 대비) */
  keep: 0.9,
} as const;

/** 이보다 많이 담으면(평적 대비) 선회 중 흘린다고 알린다 — 막대 초록 칸 끝 */
const HEAP_WARN = 1.15;
/** 담기 막대 끝 (평적 대비) */
const LOAD_TOP = 1.3;

/** A 굴착구역 */
const zoneA = (s: DigSession) => s.site.stations.find((x) => x.name === 'A')!;
/** 먼 끝: 구덩이 바깥 끝에서 안쪽 25cm — 여기서 찍어야 가상선 전까지 당길 길이(약 2m)가 나온다 */
export const farR = (s: DigSession) => zoneA(s).pitOut - 0.25;
/** 파는 자리 표시 (먼 끝) */
export const digSpot = (s: DigSession) => ({ swing: Math.PI, r: farR(s) });
/**
 * 버킷이 가상굴착제한선(점선)까지 남은 거리 (m). 판정처럼 버킷 어느 점이든 작업 높이 아래에서 선 안쪽이면 넘은 것.
 * 작업 높이 위로 들었으면 넉넉한 값
 */
export const toLine = (s: DigSession) => {
  const f = s.frame;
  const low = [f.tip, f.heel, f.P2].filter((p) => p.y < s.params.workHeight);
  return low.length ? Math.min(...low.map((p) => p.r)) - zoneA(s).zoneIn : 9;
};

/** 버킷 바닥(날 끝→힐)이 땅과 이루는 각 (도). 0이면 평행, +면 이빨이 아래로 */
export const bottomAngle = (s: DigSession) => {
  const f = s.frame;
  return Math.atan2(f.heel.y - f.tip.y, f.heel.r - f.tip.r) / deg;
};
/**
 * 퍼기 준비 시범이 끝난 자세 `[측정]` — 붐을 내리며 버킷을 펴서 암과 일직선, 버킷 바닥이 흙 0.6m 위.
 * 시범도 실습도 여기서 시작한다
 */
const READY_END = { swing: Math.PI, boom: 18.4 * deg, arm: -72 * deg, bucket: -4.5 * deg };
/** 퍼기 준비 자세의 날 끝 반경 (먼 끝 진행 막대 시작) */
const READY_TIP_R = 6.28;
/** 먼 끝 허용 (준비 자세 그대로는 안 된다 — 암을 실제로 펴야 넘어간다) */
const FAR_TOL = 0.08;
/** 먼 끝 바깥 한계: 구덩이 바깥 끝 바로 안쪽 */
const farMax = (s: DigSession) => zoneA(s).pitOut - 0.05;

/** 세션마다: 처음 흙 상태(되돌리기)와 그때의 흙 높이(꽂는 깊이를 재는 기준) */
interface Fresh {
  restore: () => void;
  h: Float32Array[];
}
const FRESH = new WeakMap<DigSession, Fresh>();
/**
 * 시범·실습 시작: 퍼기 준비 자세에서, 처음 흙 그대로.
 * 자세를 먼저 옮기고(덧쌓임이 내려놓인다) 흙·흙 장부를 되돌린다 — 저장도 같은 자세에서 했다
 */
export const scoopStart = (s: DigSession) => {
  s.teleport(READY_END);
  const f = FRESH.get(s);
  if (f) f.restore();
  else {
    s.load = s.loadBack = 0;
    FRESH.set(s, { restore: s.checkpoint(), h: s.soil.grids.map((g) => g.h.slice()) });
  }
};
/** 꽂은 깊이: 꽂기 전(처음) 흙 표면에서 날 끝까지. 지금 표면은 날이 깎으며 같이 내려가 깊이를 못 잰다 */
export const bite = (s: DigSession) => {
  const w = toWorld(s.pose.swing, s.frame.tip);
  const f = FRESH.get(s);
  const gi = s.soil.grids.findIndex((g) => g.cellAt(w.x, w.z) >= 0);
  const y0 = f && gi >= 0 ? s.soil.grids[gi].heightAt(w.x, w.z, f.h[gi]) : s.soil.surfaceAt(w.x, w.z);
  return Number.isNaN(y0) ? 0 : y0 - s.frame.tip.y;
};
/** 선회 자세: 끝까지 가깝게 오므리고, 버킷 최저점이 줄보다 넉넉히 위 (쏟고 돌릴 자세와 같은 기준) */
export const swingReady = (s: DigSession) => -s.pose.bucket / deg >= MOVE.curl && bucketLow(s) >= ropeClear(s);

/** 오른쪽 레버 길잡이: 7시 → 9시 → 12시 */
const SCOOP_ARC: [number, number] = [240, 90];
/** 7시 (도) — 오므리면서 붐 올리기 */
const SEVEN = 240;
const ph = (p: Phase): Step => phaseStep({ arc: SCOOP_ARC, ...p });

const T_FAR = '왼쪽 레버를 12시로\n암을 펴서 먼 끝으로';
const T_BITE = '오른쪽 레버를 12시로\n이빨이 안 보이게 꽂기';
const T_FLAT = '오른쪽 레버를 9시로\n바닥을 땅과 평행하게';
const T_PULL = '왼쪽 레버를 6시로\n암을 당겨서 버킷 안에 흙을 담으세요';
const T_RELEASE = '선회 자세가 되면\n레버를 천천히 놓기';

/** 흙 퍼기 구분동작 시범 (앱 주인이 짠 순서 + 강사 검토: 먼 끝에서 찍고 가상선 전에 든다) */
const scoopDemo = (): Step[] => [
  ph({ text: '퍼기 준비 자세에서 시작\n암과 버킷이 일직선', side: true, labels: [], a: 90, m: 0, ramp: 1, min: 90, reset: scoopStart }),
  ph({ text: T_FAR, labels: ['암 펴기'], a: 90, m: 0, ly: 0.55, ramp: 40, min: 60, until: (s) => s.frame.tip.r >= farR(s) }),
  ph({ text: T_BITE, labels: ['붐 내림'], a: 90, m: 0.45, ly: 0, ramp: 40, min: 60, until: (s) => bite(s) >= SCOOP.biteDemo }),
  // 버킷이 흙 속이라 옆에서도 안 보인다 — 평행까지 남은 정도를 막대로 (실습과 같은 막대)
  { ...ph({ text: T_FLAT, labels: ['버킷 오므림'], a: 180, from: 180, m: 0.7, ramp: 60, min: 60, until: (s) => bottomAngle(s) <= 12 }), meter: (s) => flatMeter(s) },
  // 오른쪽 레버를 먼저 놓는다 — 놓는 동안 오므림이 이어지면 '암만 당기기'가 아니게 된다 (개발 검토)
  ph({ text: '오른쪽 레버를 놓고', labels: [], a: 180, m: 0, ramp: 15, min: 20 }),
  ph({
    text: T_PULL,
    labels: ['암 당기기'],
    a: 180,
    m: 0,
    ly: -0.6,
    ramp: 40,
    min: 60,
    until: (s) => s.load >= SCOOP.full * SC(s) || toLine(s) <= SCOOP.lineMargin,
  }),
  ph({ text: '점선 전에 오른쪽 레버 7시로\n오므리면서 붐 올리기', labels: ['버킷 오므림', '붐 올림'], a: SEVEN, from: SEVEN, m: 0.75, ly: 0, ramp: 40, min: 60, until: swingReady }),
  ph({ text: T_RELEASE, labels: [], a: SEVEN, m: 0, ramp: 50, min: 70 }),
];

/** 실습 첫 단계 (되돌아갈 곳) — 앞에 시범이 있어 번호를 박아 두면 틀린다 */
const pracStart = () => SCOOP_LESSON.steps.findIndex((st) => st.text === T_FAR && !st.demo);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 평행까지: 꽂은 자세(이빨 세움, 바닥 각 약 70°)에서 평행(15°)까지 얼마나 왔나 */
/** 값 x를 [lo, hi] 바늘로, 목표 구간 [a, b] (hi < lo도 된다) */
const needle = (x: number, lo: number, hi: number, a: number, b: number): Meter => {
  const t = (y: number) => (y - lo) / (hi - lo);
  return { v: clamp01(t(x)), band: [Math.min(t(a), t(b)), Math.max(t(a), t(b))] };
};
const flatMeter = (s: DigSession) => needle(bottomAngle(s), 70, -25, SCOOP.flat, SCOOP.overCurl);
const flatOk = (s: DigSession) => bottomAngle(s) <= SCOOP.flat && bottomAngle(s) >= SCOOP.overCurl;
/** 담은 양 (평적 = 1) */
const fillOf = (s: DigSession) => s.load / SC(s);
const loadMeter = (s: DigSession) => needle(fillOf(s), 0, LOAD_TOP, SCOOP.full, HEAP_WARN);
const loadHud = (s: DigSession) => (fillOf(s) > HEAP_WARN ? '초록 칸을 넘었어요 — 선회할 때 흘릴 수 있어요' : `담긴 흙 ${Math.round(fillOf(s) * 100)}%`);
/** 담은 최고치를 계속 센다 (들면서 오므려 더 들어온 것도) */
const track = (s: DigSession, bag: Record<string, number>) => (bag.peak = Math.max(bag.peak ?? 0, fillOf(s)));

export const SCOOP_LESSON: Lesson = {
  id: 'b-scoop',
  tier: '기본기',
  icon: 'stScoop',
  title: '흙 퍼기',
  noFail: true,
  big: true,
  // 한 톤 배경 + 밝은 장비. 바닥 표시선(점선 = 가상굴착제한선)은 남는다
  flat: true,
  why: {
    title: '정석대로 한 번에',
    lines: [
      '<b>먼 끝</b>에 이빨이 안 보일 만큼 꽂습니다.',
      '버킷 바닥을 땅과 <b>평행</b>하게 오므린 뒤, <b>암을 당겨</b> 담습니다. 목표는 <b>평적</b>(버킷 테두리까지) — 막대의 초록 칸.',
      '<b>점선</b>(가상굴착제한선)을 넘으면 실격 — 그 전에 듭니다.',
      '들 때는 <b>오므리면서</b> 붐을 올려야 안 쏟습니다.',
    ],
  },
  /** 평적만큼 담았나 + 들면서 지켰나 */
  grade: (_s, bag): Grade => {
    const peak = bag.peak ?? 0;
    const kept = peak ? (bag.keep ?? 0) / peak : 0;
    const inBand = peak >= SCOOP.full && peak <= HEAP_WARN;
    if (bag.jolt && kept >= 0.93) return { stars: 2, note: '레버를 확 놓아 덜컹했어요. 천천히 가운데로' };
    if (inBand && kept >= 0.97) return { stars: 3, note: '평적(초록 칸)만큼 담아 흘리지 않고 들었습니다' };
    if (kept >= 0.93)
      return {
        stars: 2,
        note: peak < SCOOP.full ? '평적에 조금 모자라요. 조금 더 깊이(20cm쯤) 꽂아 보세요' : peak > HEAP_WARN ? '너무 많이 담았어요. 초록 칸까지만' : '조금 흘렸어요. 들 때 버킷을 더 오므려 보세요',
      };
    return { stars: 1, note: '흘렸어요. 오므리면서 드세요' };
  },
  setup: (s) => scoopStart(s),
  steps: [
    {
      text: '여기가 파는 자리',
      peek: true,
      spot: digSpot,
      begin: (_s, mem) => (mem.t = 0),
      done: (_s, mem) => ++mem.t > 110,
    },
    ...scoopDemo(),
    {
      text: '시범 끝\n다시 볼까요?',
      labels: [],
      // 다시 보기는 구분동작 시범 첫 토막으로 — 아래에서 번호를 넣는다
      ask: { replay: 0 },
      demo: () => ({}),
      done: () => false,
    },
    // ---- 실습: 시범과 같은 자세·순서·판정 ----
    {
      text: T_FAR,
      spot: digSpot,
      labels: ['암 펴기'],
      // 시범이 판 흙을 메우고 퍼기 준비 자세로 (되돌아왔을 때도)
      begin: (s, _mem, bag) => {
        scoopStart(s);
        bag.peak = bag.keep = 0;
      },
      done: (s, mem) => hold(mem, s.frame.tip.r >= farR(s) - FAR_TOL && s.frame.tip.r <= farMax(s), 10),
      meter: (s) => needle(s.frame.tip.r, READY_TIP_R, farMax(s) + 0.25, farR(s) - FAR_TOL, farMax(s)),
      coach: (s) => (s.frame.tip.r > farMax(s) ? co('너무 멀어요 — 암을 조금 당기기', '암 당기기') : null),
    },
    {
      text: T_BITE,
      spot: digSpot,
      labels: ['붐 내림'],
      // 꽂고 멈춰야 넘어간다 (붐이 내려가는 중에 창을 지나치기만 하면 안 됨)
      done: (s, mem) => hold(mem, bite(s) >= SCOOP.biteLo && bite(s) <= SCOOP.biteHi && Math.abs(s.vel.boom) < 0.05 * s.m.speeds.boom, 10),
      meter: (s) => needle(bite(s), 0, 0.4, SCOOP.biteLo, SCOOP.biteHi),
      coach: (s) => (bite(s) > SCOOP.biteHi || s.lift > 2 * deg ? co('너무 깊어요 — 붐을 살짝 올리기', '붐 올림') : null),
    },
    {
      text: T_FLAT,
      labels: ['버킷 오므림'],
      // 평행에서 멈춰야 넘어간다 (오므리는 중에 지나치기만 하면 안 됨)
      done: (s, mem) => hold(mem, flatOk(s) && Math.abs(s.vel.bucket) < 0.05 * s.m.speeds.bucket, 8),
      meter: (s) => flatMeter(s),
      coach: (s) =>
        bottomAngle(s) < SCOOP.overCurl ? co('너무 오므렸어요 — 버킷을 조금 펴기', '버킷 펴기') : bite(s) < 0.03 ? co('이빨이 떴어요 — 붐 살짝 내리기', '붐 내림') : null,
    },
    {
      text: T_PULL,
      labels: ['암 당기기'],
      hud: (s) => loadHud(s),
      begin: (s, mem) => (mem.arm0 = s.pose.arm),
      // 암으로 당겨 담고, 암을 멈추거나(손을 뗌) 점선 앞에 오면 넘어간다. 평적에 모자라면 별에서 깎는다
      done: (s, mem, bag) => {
        track(s, bag);
        const pulled = mem.arm0 - s.pose.arm >= SCOOP.armPull * deg;
        const armStill = Math.abs(s.vel.arm) < 0.02 * s.m.speeds.arm;
        const atLine = toLine(s) <= SCOOP.lineMargin;
        return pulled && fillOf(s) >= SCOOP.fill && (atLine || hold(mem, armStill, 8));
      },
      meter: (s) => loadMeter(s),
      fail: (s, mem) => {
        // 점선 앞까지 왔는데 덜 찼다 — 더 당길 자리가 없다
        if (toLine(s) <= SCOOP.lineMargin && fillOf(s) < SCOOP.fill) {
          mem.short = (mem.short ?? 0) + 1;
          if (mem.short >= 45) return { to: pracStart(), msg: '덜 찼어요 — 깊이 맞춰 꽂고, 암으로 당겨 담기' };
        } else mem.short = 0;
        // 점선(가상굴착제한선)을 넘으면 시험에서는 실격 — 처음부터 다시
        if (toLine(s) < 0) return { to: pracStart(), msg: '점선을 넘었어요 (시험이면 실격) — 다시' };
        // 버킷을 끝까지 닫았거나 암을 끝까지 당겼는데 덜 찼다 — 더 담을 길이 없다 (막다른 길 아님: 처음부터)
        const lim = s.m.limits;
        const spent = s.pose.bucket <= lim.bucket[0] + 3 * deg || s.pose.arm <= lim.arm[0] + 3 * deg;
        const still = Math.abs(s.vel.arm) < 0.02 * s.m.speeds.arm && Math.abs(s.vel.bucket) < 0.02 * s.m.speeds.bucket;
        mem.stuck = spent && still ? (mem.stuck ?? 0) + 1 : 0;
        return mem.stuck >= 45 ? { to: pracStart(), msg: '덜 찼어요 — 담는 중엔 버킷은 평행 그대로, 암으로 당기기' } : null;
      },
      coach: (s, mem) => {
        if (toLine(s) < SCOOP.lineMargin) return fillOf(s) >= SCOOP.fill ? co('점선이 가까워요 — 이제 들기', '붐 올림') : null;
        // 버킷으로 긁어 담으면 안 된다 — 정석은 평행 그대로 암으로
        if (bottomAngle(s) < SCOOP.overCurl) return co('담는 중엔 버킷은 그대로 — 암만 당기기', '암 당기기');
        if (bite(s) > SCOOP.biteHi + 0.1 || s.lift > 2 * deg) return co('너무 깊어요 — 붐을 살짝 올리기', '붐 올림');
        // 암을 멈추고 있으면 안 찬다
        mem.idle = Math.abs(s.vel.arm) < 0.02 * s.m.speeds.arm ? (mem.idle ?? 0) + 1 : 0;
        return mem.idle > 50 ? co('암을 계속 당기기', '암 당기기') : null;
      },
    },
    {
      text: '오른쪽 레버를 7시로\n오므리면서 붐 올리기',
      labels: ['버킷 오므림', '붐 올림'],
      // 고봉을 넘기면 선회할 때 흘린다 — 알려 준다 (실격은 아님)
      hud: (s) => loadHud(s),
      meter: (s) => loadMeter(s),
      done: (s, _mem, bag) => {
        track(s, bag);
        bag.keep = fillOf(s);
        return swingReady(s) && bag.keep >= SCOOP.keep * bag.peak;
      },
      fail: (s, _mem, bag) =>
        s.load / SC(s) < SCOOP.keep * (bag.peak ?? 1) - 1e-6
          ? { to: pracStart(), msg: '흙이 흘렀어요 — 다시 퍼기' }
          : toLine(s) < 0
            ? { to: pracStart(), msg: '점선을 넘었어요 (시험이면 실격) — 다시' }
            : null,
      coach: (s) =>
        -s.pose.bucket / deg < MOVE.curl ? co('드는 중 — 버킷을 더 오므리기', '버킷 오므림') : bucketLow(s) < ropeClear(s) ? co('붐을 더 올리기', '붐 올림') : null,
    },
    {
      text: T_RELEASE,
      labels: [],
      hud: (s) => loadHud(s),
      // 가운데로 놓고 멈추면 끝. 확 놓아 덜컹하면(시뮬레이터의 덜컹 판정) 별에서 깎는다
      begin: (s, mem, bag) => ((mem.j0 = s.jolts), (bag.jolt = 0)),
      done: (s, mem, bag) => {
        bag.keep = Math.min(bag.keep ?? 1, fillOf(s));
        if (s.jolts > mem.j0) bag.jolt = 1;
        const v = Math.max(Math.abs(s.stick.rx), Math.abs(s.stick.ry), Math.abs(s.stick.lx), Math.abs(s.stick.ly));
        const still = Math.abs(s.vel.boom) < 0.02 * s.m.speeds.boom && Math.abs(s.vel.bucket) < 0.02 * s.m.speeds.bucket;
        return hold(mem, v < 0.05 && still, 20);
      },
      fail: (s, _mem, bag) => (fillOf(s) < SCOOP.keep * (bag.peak ?? 1) - 1e-6 ? { to: pracStart(), msg: '흙이 흘렀어요 — 다시 퍼기' } : null),
    },
  ],
};
{
  const st = SCOOP_LESSON.steps;
  const at = st.findIndex((x) => x.text.startsWith('퍼기 준비 자세에서 시작'));
  if (at < 0 || pracStart() < 0) throw new Error('흙 퍼기: 시범 첫 토막·실습 첫 단계를 못 찾음');
  st.find((x) => x.ask)!.ask!.replay = at;
}
