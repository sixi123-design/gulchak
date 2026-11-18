import { PASS_MARGIN, shapeOf } from './judge';
import { bucketUnderside, ik, toWorld } from './kinematics';
import type { DigSession, Sticks } from './session';

/**
 * 배우기(튜토리얼): 구간별 짧은 미션. 순수 로직 — 화면은 main.ts가 그린다.
 * 각 미션은 그 구간에 맞는 자세·상태에서 바로 시작한다.
 */

/** 단계 메모(mem, 단계마다 초기화) · 미션 보관함(bag, 미션 끝까지 유지) */
type Mem = Record<string, number>;

export interface Step<S = DigSession> {
  /** 화면에 보이는 한 줄 지시 */
  text: string;
  /** 깜빡여 줄 레버 라벨 (화면의 조이스틱 라벨 글자와 같게) */
  labels?: string[];
  /** 레버를 이만큼 밀라고 가르치는 구간이면 목표 칸 수 (1~3). 화면의 3칸 표시에 쓴다 */
  gauge?: 1 | 2 | 3;
  /**
   * 앱이 레버를 대신 미는 시범. 단계가 시작된 뒤 지난 프레임 수를 받아 밀 값을 돌려준다.
   * `null`을 돌려주면 시범이 끝난 것이다 (영상으로 못 배우는 손맛을 먼저 보여 주는 장치).
   */
  demo?: (frame: number, s: S) => Partial<Sticks> | null;
  /** 이 단계에서 띄우지 않을 경고 id (시킨 동작을 꾸중하지 않게) */
  quiet?: string[];
  /** 이 단계가 시작될 때 운전석에서 시선을 내려 땅을 한 번 보여 줄까 */
  peek?: boolean;
  /** 시범 중 옆에서 보여 줄까 (각도가 중요한 토막: 운전석에서는 버킷 바닥 각이 안 보인다). 실습은 운전석 그대로 */
  side?: boolean;
  /** 땅에 "여기" 표식을 놓을 자리 (없으면 표식 없음) */
  spot?: (s: S) => { swing: number; r: number } | null;
  /**
   * 레버 길잡이. 오른쪽 스틱 위에 **어느 깊이로(ring), 어느 길로(arc)** 움직여야 하는지 그린다.
   * `at`은 지금 가야 할 각도(도, 0=3시·90=12시), `rough`면 레버가 빨개지고 흔들린다.
   */
  guide?: (s: S) => { ring: number; from: number; to: number; at: number; rough: boolean } | null;
  /** 이 단계가 시작될 때의 상태 기록 */
  begin?: (s: S, mem: Mem, bag: Mem) => void;
  done: (s: S, mem: Mem, bag: Mem) => boolean;
  /** 이 단계부터 '버킷 내려놓기' 종료 판정을 켬 (앞 단계에서 미리 끝나지 않게) */
  armEnd?: boolean;
  /** 되돌릴 수 없는 상태: 되돌아갈 단계 번호와 안내 문구 (없으면 null) */
  fail?: (s: S, mem: Mem, bag: Mem) => { to: number; msg: string } | null;
  /** 그 자리에서 바로잡을 수 있는 어긋남: 원인과 지금 할 레버 (없으면 null) */
  coach?: (s: S, mem: Mem, bag: Mem) => Coach | null;
  /** 미묘한 단계의 도움 게이지 (0~1). band가 있으면 바늘+목표 구간, 없으면 채워지는 막대 */
  meter?: (s: S, mem: Mem, bag: Mem) => Meter;
  /** 매 프레임 미션 박스에 띄울 짧은 한 줄 (세는 중 ●●○ · 멈춘 뒤 오차 cm) */
  hud?: (s: S, mem: Mem, bag: Mem) => string | null;
  /**
   * 고르는 단계: 화면에 '다시 보기 / 다음' 버튼을 띄우고 유저가 누를 때까지 기다린다.
   * `replay`는 다시 보기를 누르면 돌아갈 단계 번호 (시범의 첫 단계). done은 쓰이지 않는다.
   */
  ask?: { replay: number };
  /**
   * 고르기 문제 (기초교육): text가 문제, 보기 중 하나를 누르면 맞았는지·풀이를 보여 주고 '다음'으로 넘어간다.
   * 틀린 수는 bag.miss에 쌓인다 (별점). done은 쓰이지 않는다
   */
  quiz?: { options: string[]; answer: number; explain: string };
}

/** 미션을 끝냈을 때의 평가: 별 개수와 한 줄 평 */
export interface Grade {
  stars: 1 | 2 | 3;
  note: string;
}

export interface Coach {
  msg: string;
  labels: string[];
}

export interface Meter {
  v: number;
  band?: [number, number];
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 시작값 → 목표값까지 얼마나 왔는가 (begin에서 mem.g0 기록) */
const toward = (now: number, mem: Record<string, number>, goal: number): Meter => ({
  v: clamp01((now - mem.g0) / (goal - mem.g0 || 1e-6)),
});
/** 값 x를 [lo, hi] 범위의 바늘로, 목표 [a, b] */
const needle = (x: number, lo: number, hi: number, a: number, b: number): Meter => ({
  v: clamp01((x - lo) / (hi - lo)),
  band: [(a - lo) / (hi - lo), (b - lo) / (hi - lo)],
});

export type Tier = '기본기' | '마무리' | '기초교육';

/**
 * 배우기 목록의 묶음. 순서가 화면 순서다.
 * 기본기는 처음 온 사람이 가야 할 곳이라 맨 위 가로 전체(wide)를 쓴다.
 */
export const TIERS: readonly { key: Tier; sub: string; wide?: boolean }[] = [
  { key: '기본기', sub: '시험 한 사이클을 동작별로', wide: true },
  { key: '마무리', sub: '구덩이가 깊어진 뒤 · 평탄으로 끝내기' },
  { key: '기초교육', sub: '번외 · 점검·부위·실격·주의 다시 보기' },
];

/** 한 묶음의 진행도. of가 0이면 화면은 그 칸을 그리지 않는다 (0으로 나누기 방지) */
export function tierProgress(lessons: readonly Lesson<never>[] | readonly Lesson<any>[], done: ReadonlySet<string>, tier: Tier): { n: number; of: number } {
  const items = lessons.filter((l) => l.tier === tier);
  return { n: items.filter((l) => done.has(l.id)).length, of: items.length };
}

export interface Lesson<S = DigSession> {
  id: string;
  /** 아이콘 이름 (src/ui/icons.ts) */
  icon: 'stLevers' | 'stScoop' | 'stCarry' | 'stDump' | 'stFlat' | 'kDrive' | 'stStop' | 'stAim' | 'stBoth' | 'stAll' | 'check' | 'kWritten';
  title: string;
  /** 마지막 단계에서 '버킷 내려놓기' 종료 판정을 켬 */
  autoEnd?: boolean;
  /** 배우기 목록 묶음 (TIERS 참고) */
  tier?: Tier;
  /** 레버만 익힘: 시험장 판정(실격·경고)을 안 보여 줌 */
  noFail?: boolean;
  /** 시작 점검 미션: 시험의 점검판(안전벨트·안전레버·RPM·손 들기)을 띄운다 */
  check?: boolean;
  /**
   * 끝났을 때 별 몇 개인지와 한 줄 평. 없으면 클리어 화면은 지금까지와 똑같다(별 3개).
   * bag이 비어 있을 수도 있으니(단계를 다 안 거치고 끝난 경우) 별은 반드시 1~3을 돌려준다.
   */
  grade?: (s: S, bag: Record<string, number>) => Grade;
  /**
   * 미션 앞에 한 장 보여 줄 이론. 처음 한 번만 뜨고, 미션 화면의 '왜?'로 다시 본다.
   * 그림은 이 미션의 icon을 크게 쓴다 (sim 층은 SVG를 들지 않는다).
   */
  why?: { title: string; lines: readonly string[] };
  /** 이빨이 지나간 자리에 선을 남긴다 (동시조작을 눈으로 보여 주는 미션) */
  trail?: boolean;
  /** 배경을 한 톤으로 (레버 익히기: 지시문과 움직이는 것에 눈이 가게) */
  flat?: boolean;
  /** 지시문을 작은 미션 판 대신 화면 가운데 위에 크게 */
  big?: boolean;
  setup: (s: S) => void;
  steps: Step<S>[];
}

const deg = Math.PI / 180;
const SWING_A = Math.PI; // A를 향함
const SWING_C = 0; // C를 향함

/**
 * 버킷 날 끝을 (r, y)에 두는 자세로 순간이동. bucketRel: 버킷 관절각(없으면 ik 그대로).
 * 버킷 각을 바꾸면 날 끝이 움직이므로 몇 번 되풀이해 맞춘다.
 */
export function pose(s: DigSession, swing: number, r: number, y: number, bucketAbs: number, bucketRel?: number) {
  let tr = r;
  let ty = y;
  for (let i = 0; i < 6; i++) {
    const q = ik(s.m, tr, ty, bucketAbs);
    if (!q) break;
    s.teleport({ swing, ...q, ...(bucketRel !== undefined ? { bucket: bucketRel } : {}) });
    const tip = s.frame.tip;
    tr += r - tip.r;
    ty += y - tip.y;
  }
}
export const tipStation = (s: DigSession) => s.stationOf(toWorld(s.pose.swing, s.frame.tip))?.name ?? null;
/**
 * 버킷(날 끝·힐)이 C 작업구역 폭 안 위에 있나. tipStation은 구역 옆 0.8m까지 C로 쳐서, 거기서 쏟으면
 * 버킷을 펴는 동안 흙이 구덩이 옆(흙 격자 밖)으로 떨어진다 (실측: 선회 24°에서 쏟으면 0.45m³ 중 0.2~0.3m³)
 */
export const overC = (s: DigSession) => {
  const C = s.site.stations.find((x) => x.name === 'C')!;
  return [s.frame.tip, s.frame.heel].every((q) => {
    const p = toWorld(s.pose.swing, q);
    const rho = p.x * C.axis.x + p.z * C.axis.z;
    return rho > C.zoneIn && rho < C.zoneOut && Math.abs(p.z) < C.zoneHalfW;
  });
};
/** 흙에 닿은 채 dir(1 = 바깥, -1 = 몸 쪽)으로 움직인 거리 누적 */
/** 버킷 바닥(힐→이빨)이 수평(이빨이 몸 쪽)에서 기운 각(°, +면 이빨이 위) */
const contactTravel = (s: DigSession, mem: Record<string, number>, dir: 1 | -1) => {
  const r = s.frame.tip.r;
  const dr = (r - mem.r) * dir;
  if (dr > 0 && s.groundGap() < 0.12) mem.d += dr;
  mem.r = r;
  return mem.d;
};
/** 시범이 끝나고 노브를 가운데에 두고 쉬는 프레임 (0.5초 @60Hz) */
const DEMO_REST = 30;

export const SC = (s: DigSession) => s.m.struckCapacity;
/** 버킷 관절이 암에서 오므려진 각(°) */
const curlDeg = (s: DigSession) => -s.pose.bucket / deg;
export const co = (msg: string, ...labels: string[]): Coach => ({ msg, labels });
/** 선회가 목표(A=π, C=0)에서 벗어났으면 되돌아갈 방향 */
const swingBack = (s: DigSession, target: number, name: string): Coach | null => {
  const d = s.pose.swing - target;
  if (Math.abs(d) < 8 * deg) return null;
  return co(`${name}으로 돌아오기`, d < 0 ? '▶ 선회' : '선회 ◀');
};
/** 암을 멈추고 있는 시간(프레임) 세기 */
const armIdle = (s: DigSession, mem: Record<string, number>) => {
  const moving = mem.armP !== undefined && Math.abs(s.pose.arm - mem.armP) > 0.0015;
  mem.armP = s.pose.arm;
  mem.idle = moving ? 0 : (mem.idle ?? 0) + 1;
  return mem.idle > 45;
};
/** 흙이 버킷에서 흐르는 중 (쏟는 단계가 아닐 때) */
const spilling = (s: DigSession) => s.pourRate > 0.03 && s.load > 0.05 * SC(s);
/** 너무 깊게 물거나 눌러 엔진이 버거움·차체 들림 */
const straining = (s: DigSession) => s.engineLoad > 1.05 || s.lift > 1 * deg;
/**
 * 퍼 담기 공통 지도: 버킷 반쯤 오므린 채 이빨이 흙 속에 있어야 암을 당길 때 눌러 담김.
 * 오므림이 지나치면 반쯤 펴게 (흙 속에서는 펴도 흙이 안 쏟아짐 — session.pour)
 */
const packCoach = (s: DigSession, mem: Record<string, number>): Coach | null => {
  const sw = swingBack(s, SWING_A, '파는 곳');
  if (sw) return sw;
  if (straining(s)) return co('너무 깊어요 → 붐 살짝 올림', '붐 올림');
  const c = curlDeg(s);
  if (c > 80) mem.reopen = 1;
  if (c < 55) mem.reopen = 0;
  if (mem.reopen) return co('너무 오므렸어요 → 버킷 조금 펴서 바닥 평행하게', '버킷 펴기');
  if (s.groundGap() > 0.05) return co('이빨이 떴어요 → 붐 내림', '붐 내림');
  if (c < 20) return co('버킷 조금 더 오므리기', '버킷 오므림');
  if (armIdle(s, mem)) return co('암 계속 당기기', '암 당기기');
  return null;
};
/** 담은 채 흙 속에 있으면 먼저 붐 올려 빼기 (흙 속에서는 암을 펴면 버킷 등이 밀려 안 펴짐) */
// 흙을 실은 채 흙에 닿아 있거나, 버킷 등이 흙을 밀어 막히면(흙은 눌려 들어가지 않음) 먼저 들기
const liftFirst = (s: DigSession): Coach | null =>
  (s.groundGap() < 0.15 && s.load > 0.1 * SC(s)) || s.pressRatio > 0.9 ? co('붐 올려 흙에서 빼기', '붐 올림') : null;
/** 암을 끝까지 당겼는데 덜 담김 */
const armSpent = (s: DigSession) => s.pose.arm <= s.m.limits.arm[0] + 4 * deg && s.load < 0.8 * SC(s);
/** 평탄: 흙에 댄 채 끌기·밀기 지도 */
const skimCoach = (s: DigSession, mem: Record<string, number>, pull: boolean): Coach | null => {
  const sw = swingBack(s, SWING_C, '쏟는 곳');
  if (sw) return sw;
  if (s.pose.bucket < s.m.limits.bucket[1] - 30 * deg) return co('버킷 끝까지 펴기', '버킷 펴기');
  if (straining(s)) return co('너무 눌러요 → 붐 살짝 올림', '붐 올림');
  if (s.groundGap() > 0.12) return co('흙에서 떴어요 → 붐 살짝 내림', '붐 내림');
  if (armIdle(s, mem)) return pull ? co('암 계속 당기기', '암 당기기') : co('암 계속 펴기', '암 펴기');
  return null;
};
/** 버킷 하부에서 가장 낮은 점의 높이 */
export const bucketLow = (s: DigSession) => Math.min(...bucketUnderside(s.frame).map((q) => q.y), s.frame.tip.y);
/** 줄(B 장애물선)을 여유 있게 넘는 높이 */
export const ropeClear = (s: DigSession) => s.site.B.ropeY + 0.3;
/**
 * 지금 자세 그대로 B(선회 π/2)를 지날 때 버킷이 통과구역(ⓔ~ⓕ 가상통과제한선 사이, 줄 위)을 지나는가.
 * 판정기(passHits)와 같은 버킷 꼭짓점·여유로 보고, 0.1m 더 여유를 둔다. 고칠 레버를 돌려준다
 */
export const passFix = (s: DigSession): Coach | null => {
  const b = shapeOf(s.m, s.frame, Math.PI / 2).bucket;
  const m = PASS_MARGIN + 0.1;
  if (Math.max(...b.map((p) => p.z)) >= s.site.B.rF - m) return co('버킷이 바깥 폴 쪽 선에 닿아요 → 암 당기기', '암 당기기');
  if (Math.min(...b.map((p) => p.z)) <= s.site.B.rE + m) return co('버킷이 안쪽 폴 쪽 선에 닿아요 → 암 펴기', '암 펴기');
  if (Math.min(...b.map((p) => p.y)) <= s.site.B.ropeY + m) return co('줄보다 낮아요 → 붐 올림', '붐 올림');
  return null;
};
/** 버킷에서 가장 먼 점의 반경 (등·힐·날 끝·핀) */
const bucketFar = (s: DigSession) => Math.max(s.frame.tip.r, s.frame.heel.r, s.frame.P2.r);
/** A의 ⓑ선 반경 */
const bLine = (s: DigSession) => s.site.stations[0].zoneOut;
/** 이빨(핀→날 끝)이 수직 아래에서 기운 각(°) */
/** 붐을 내리는데 버킷 바닥(배)이 흙을 눌러 막힘: 이빨이 먼저 들어가게 버킷을 펴야 함 */
const bellyPress = (s: DigSession): Coach | null =>
  s.input.ry > 0.1 && s.pressRatio > 0.6 ? co('버킷 배가 땅을 눌러요 → 버킷 펴서 이빨부터', '버킷 펴기') : null;
const teethVertical = (s: DigSession) => Math.abs((s.frame.thK * 180) / Math.PI + 90);
/** A 구덩이를 두 번 퍼낸 모양으로: 가운데가 depth만큼 패이고 먼 끝(ⓑ선 쪽)·장비 쪽에 흙이 남음 */
const carvePit = (s: DigSession, depth: number) => {
  const st = s.site.stations[0];
  const g = s.soil.grids.find((x) => x.name === 'A')!;
  const half = s.m.bucketWidth / 2 + 0.05;
  const mid = st.pitIn + (st.pitOut - st.pitIn) * 0.48;
  const w = (st.pitOut - st.pitIn) * 0.3;
  for (let j = 0; j < g.nz; j++)
    for (let i = 0; i < g.nx; i++) {
      const x = g.xOf(i);
      const z = g.zOf(j);
      const rho = x * st.axis.x + z * st.axis.z;
      if (Math.abs(z) > half || rho < st.pitIn || rho > st.pitOut) continue;
      // 가운데가 가장 깊고 양 끝으로 갈수록 얕아지는 골
      const t = Math.max(0, 1 - ((rho - mid) / w) ** 2);
      const k = g.idx(i, j);
      g.cut(k, g.h[k] - depth * t * (1 - 0.3 * (Math.abs(z) / half) ** 4));
    }
  g.relax(Math.tan((s.params.reposeDeg * Math.PI) / 180) * s.params.soilCell, 200);
};
export const fill = (s: DigSession, ratio: number) => {
  s.load = s.m.struckCapacity * ratio;
  s.loadBack = s.load * 0.85;
};

/** 조건이 잠깐 스치는 게 아니라 0.2초 머물러야 */
export const hold = (mem: Record<string, number>, ok: boolean, n = 12) => {
  mem.hold = ok ? (mem.hold ?? 0) + 1 : 0;
  return mem.hold >= n;
};

/**
 * 마무리 미션 별점: 결과(완료)는 이미 했다 — 별은 주의 경고 수로. 가장 많이 받은 경고에 맞춰 다음에 할 것 한 줄
 */
const WARN_TIP: Record<string, string> = {
  'W-LIFT': '붐으로 누르지 말고 이빨이 안 보일 만큼만',
  'W-OVERLOAD': '깊이 물면 붐을 살짝 올려 힘 빼기',
  'W-JOLT': '레버를 확 놓지 말고 서서히',
  'W-IMPACT': '땅 가까이서는 레버를 줄여 살살',
  'W-DANGER': '흙에 박힌 채 선회하지 않기',
  'W-NEAR': '선에서 거리 두기',
};
const warnGrade = (s: DigSession): Grade => {
  const ws = s.engine.violations.filter((v) => v.kind === 'warning');
  if (ws.length === 0) return { stars: 3, note: '경고 없이 끝냈습니다' };
  const by = new Map<string, number>();
  for (const v of ws) by.set(v.id, (by.get(v.id) ?? 0) + 1);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const tip = WARN_TIP[top] ?? '경고가 뜬 곳을 다시 보기';
  return { stars: ws.length <= 2 ? 2 : 1, note: `주의 ${ws.length}번. ${tip}` };
};

export const LESSONS: Lesson[] = [
  {
    id: 'deepScoop',
    tier: '마무리',
    grade: warnGrade,
    icon: 'stScoop',
    title: '깊어진 구덩이 퍼기',
    why: {
      title: '두세 번 퍼면 구덩이가 깊어집니다',
      lines: [
        '가운데는 비고 흙은 <b>먼 끝</b>에 남습니다. 거기까지 뻗어 이빨을 세워 꽂습니다.',
        '깊은 데서 퍼면 이빨이 빠지기 쉽습니다. 빠지면 <b>붐을 살짝 내려</b> 깊이를 지킵니다.',
        '장비 쪽 가상선 전에 오므리며 들어야 합니다 — 넘으면 실격입니다.',
      ],
    },
    setup: (s) => {
      // 두 번 퍼낸 뒤: A 구덩이 먼 쪽이 깊게 파여 있음
      carvePit(s, 0.5);
      pose(s, SWING_A, s.digTarget.rho - 1.6, 1.3, -130 * deg);
    },
    steps: [
      {
        text: '이빨 수직으로 세우고 암 펴서 먼 끝으로',
        labels: ['버킷 펴기', '암 펴기'],
        coach: (s) => swingBack(s, SWING_A, '파는 곳') ?? liftFirst(s),
        // 가운데는 이미 비었고 흙은 먼 끝에 남음. 버킷 등이 ⓑ선에 닿으면 실격
        done: (s) => bucketFar(s) >= bLine(s) - 0.4 && bucketFar(s) <= bLine(s) - 0.08 && teethVertical(s) <= 20,
        meter: (s) => needle(bucketFar(s) - bLine(s), -1.8, 0.2, -0.4, -0.08),
      },
      {
        text: '붐 내려 이빨이 안 보이게 꽂기',
        labels: ['붐 내림'],
        begin: (s, mem) => (mem.g0 = s.groundGap()),
        done: (s) => tipStation(s) === 'A' && s.groundGap() < -0.15,
        meter: (s, mem) => ({ v: clamp01((mem.g0 - s.groundGap()) / (mem.g0 + 0.15 || 1e-6)) }),
        // 붐을 내리면 버킷이 장비 쪽으로 눕는다. 이빨이 장비 쪽으로 넘어가면 버킷 바닥(배)이 흙을 눌러 안 들어감
        coach: (s) => swingBack(s, SWING_A, '파는 곳') ?? bellyPress(s),
      },
      {
        text: '바닥을 땅과 평행하게 오므리고 암 당겨 담기 · 이빨 빠지면 붐 살짝 내림',
        labels: ['버킷 오므림', '암 당기기', '붐 내림'],
        done: (s) => s.load >= 0.85 * s.m.struckCapacity,
        meter: (s) => ({ v: clamp01(s.load / (0.85 * s.m.struckCapacity)) }),
        coach: packCoach,
        fail: (s) => (armSpent(s) ? { to: 0, msg: '암이 끝까지 왔어요. 다시 먼 끝부터' } : null),
      },
      {
        text: '가상선 전에 오므리며 붐 올려 들기',
        labels: ['버킷 오므림', '붐 올림'],
        // 끝까지 오므리고 작업 높이 위로 (그 전에 장비 쪽 가상선을 넘으면 실격)
        done: (s) => s.fullyCurled && bucketLow(s) > s.params.workHeight && s.load >= 0.75 * s.m.struckCapacity,
        meter: (s) => ({ v: Math.min(clamp01(bucketLow(s) / s.params.workHeight), s.fullyCurled ? 1 : 0.7) }),
        coach: (s) => (spilling(s) ? co('흙이 흘러요 → 버킷 더 오므림', '버킷 오므림') : null),
        fail: (s) => (s.load < 0.75 * SC(s) ? { to: 1, msg: '흙이 흘렀어요. 다시 꽂아 채우기' } : null),
      },
    ],
  },
  {
    id: 'flatten',
    tier: '마무리',
    grade: warnGrade,
    icon: 'stFlat',
    title: '평탄·마무리',
    why: {
      title: '마지막은 쏟은 구덩이를 평평하게',
      lines: [
        '쏟은 흙을 버킷을 <b>끝까지 편</b> 채로 끌어오고 밀어 고릅니다.',
        '암을 쓰는 동안 <b>붐을 같이</b> 써야 높이가 일정합니다. 붐을 세게 누르면 차체가 들립니다.',
        '다 고르면 버킷을 흙 위에 내려놓아 끝냅니다.',
      ],
    },
    autoEnd: true,
    setup: (s) => {
      const C = s.site.stations[1];
      const g = s.soil.grids.find((x) => x.name === 'C')!;
      const mid = (C.pitIn + C.pitOut) / 2;
      // 덤프 4번 한 것처럼 흙을 쌓아 둠
      for (const dx of [-0.6, -0.2, 0.2, 0.6]) g.depositSpread(g.cellAt(C.axis.x * (mid + dx), 0), 0.4);
      g.relax(Math.tan((s.params.reposeDeg * Math.PI) / 180) * s.params.soilCell, 400);
      s.digCount = Math.max(s.digCount, s.params.minDigCount);
      s.dumpCount = Math.max(s.dumpCount, 1);
      pose(s, SWING_C, C.pitIn - 0.1, 1.2, -10 * deg, -30 * deg);
    },
    steps: [
      {
        text: '버킷 끝까지 펴서 뒤집기',
        labels: ['버킷 펴기'],
        begin: (s, mem) => (mem.g0 = s.pose.bucket),
        done: (s) => s.pose.bucket >= s.m.limits.bucket[1] - 15 * deg,
        meter: (s, mem) => toward(s.pose.bucket, mem, s.m.limits.bucket[1] - 15 * deg),
      },
      {
        text: '암 펴서 흙더미 너머로 뻗기',
        labels: ['암 펴기'],
        coach: (s) => swingBack(s, SWING_C, '쏟는 곳') ?? (s.frame.tip.y > 2.2 ? co('너무 높아요 → 붐 내림', '붐 내림') : null),
        begin: (s, mem) => (mem.g0 = s.frame.tip.r),
        done: (s) => s.frame.tip.r >= s.site.stations[1].pitOut - 0.4,
        meter: (s, mem) => toward(s.frame.tip.r, mem, s.site.stations[1].pitOut - 0.4),
      },
      {
        text: '흙에 대고 암 당기며 붐 올려 끌어오기',
        labels: ['붐 내림', '암 당기기', '붐 올림'],
        begin: (s, mem) => ((mem.r = s.frame.tip.r), (mem.d = 0)),
        done: (s, mem) => contactTravel(s, mem, -1) >= 0.8,
        meter: (_s, mem) => ({ v: clamp01(mem.d / 0.8) }),
        coach: (s, mem) => skimCoach(s, mem, true),
        // 흙에 덜 댄 채 몸 앞까지 와 버림: 다시 뻗어서
        fail: (s, mem) => (s.frame.tip.r < s.site.stations[1].pitIn - 0.1 && mem.d < 0.8 ? { to: 1, msg: '흙에 덜 닿았어요. 다시 뻗어 끌어오기' } : null),
      },
      {
        text: '붐 올리고 암 당겨 밀 준비',
        labels: ['붐 올림', '암 당기기'],
        coach: (s) => swingBack(s, SWING_C, '쏟는 곳'),
        begin: (s, mem) => (mem.g0 = s.frame.tip.r),
        done: (s) => s.frame.tip.r <= s.site.stations[1].pitIn + 0.2,
        meter: (s, mem) => toward(s.frame.tip.r, mem, s.site.stations[1].pitIn + 0.2),
      },
      {
        text: '암·붐 동시에 살살 밀어 고르기',
        labels: ['암 펴기', '붐 내림'],
        begin: (s, mem) => ((mem.r = s.frame.tip.r), (mem.d = 0)),
        done: (s, mem) => contactTravel(s, mem, 1) >= 1.0 && s.flattenDone,
        meter: (s, mem) => ({ v: Math.min(clamp01(mem.d / 1.0), clamp01(s.flattenVol / s.params.flattenMinVolume)) }),
        coach: (s, mem) => skimCoach(s, mem, false),
        // 구덩이 끝까지 밀었는데 덜 고름: 다시 당겨 와서
        fail: (s, mem) =>
          s.frame.tip.r > s.site.stations[1].pitOut + 0.3 && !(mem.d >= 1.0 && s.flattenDone)
            ? { to: 3, msg: '덜 골랐어요. 다시 당겨 와서 밀기' }
            : null,
      },
      {
        text: '버킷 끝까지 편 채로 흙 위에 내려놓기',
        labels: ['붐 내림', '버킷 펴기'],
        coach: (s) =>
          swingBack(s, SWING_C, '쏟는 곳') ??
          (s.pose.bucket < s.m.limits.bucket[1] - 10 * deg
            ? co('버킷 끝까지 펴기', '버킷 펴기')
            : s.groundGap() < -s.params.endSinkTol
              ? co('흙에 묻혔어요 → 붐 살짝 올림', '붐 올림')
              : null),
        armEnd: true,
        done: (s) => s.phase === 'finished',
      },
    ],
  },
];

/** 미션 진행: 매 프레임 update()를 부르면 단계가 넘어간다 */
/** 미션 진행기: 굴착(DigSession)과 주행(DriveSession) 공용 */
export class Tutor<S extends { flags: { autoEnd: boolean } } = DigSession> {
  step = 0;
  cleared = false;
  /** 실패로 되돌아갔을 때 안내 (다음 단계로 넘어가면 지움) */
  notice: string | null = null;
  /** 되돌아간 횟수 (화면 갱신 신호) */
  rewinds = 0;
  /** 세 번째 되돌림부터: 흙·자세를 미션 처음으로 (구덩이가 계속 깊어지거나 흙이 바닥나지 않게) */
  wantReset = false;
  /** 지금 바로잡을 것 (잠깐 사라져도 0.5초는 유지해 깜빡이지 않게) */
  coach: Coach | null = null;
  private coachHold = 0;
  /** 시범이 시작된 뒤 지난 프레임 수 */
  private demoFrame = 0;
  /** 시범이 끝난 뒤 노브를 가운데에 두고 쉬는 프레임 (0.5초) */
  private demoRest = 0;
  private mem: Mem = {};
  /** 미션 보관함: 단계가 넘어가도 지워지지 않는다 (등급 재료를 쌓는 곳) */
  readonly bag: Mem = {};
  constructor(
    readonly lesson: Lesson<S>,
    readonly s: S,
  ) {
    lesson.setup(s);
    this.enter();
  }
  private enter() {
    this.picked = null;
    this.mem = {};
    this.coach = null;
    this.coachHold = 0;
    this.demoFrame = 0;
    this.demoRest = DEMO_REST;
    const st = this.lesson.steps[this.step];
    if (this.lesson.autoEnd) this.s.flags.autoEnd = !!st?.armEnd;
    st?.begin?.(this.s, this.mem, this.bag);
  }
  get current(): Step<S> | null {
    return this.lesson.steps[this.step] ?? null;
  }
  /** 지금 단계의 도움 게이지 (없으면 null) */
  meter(): Meter | null {
    if (this.cleared) return null;
    return this.current?.meter?.(this.s, this.mem, this.bag) ?? null;
  }
  /** 지금 단계가 띄울 짧은 한 줄 (없으면 null) */
  hud(): string | null {
    if (this.cleared) return null;
    return this.current?.hud?.(this.s, this.mem, this.bag) ?? null;
  }
  /**
   * 이번 프레임에 기계가 받을 레버값.
   *
   * 시범이 도는 동안에는 **유저 입력을 무시한다** — 손가락을 올려 둔 채로 보는 사람이 있고,
   * 그 입력이 섞이면 "앱이 보여 준 것"과 "기계가 한 것"이 달라져 배울 게 없어진다.
   * 시범이 끝나면 노브를 가운데로 되돌리고 0.5초 쉰 뒤에 조작을 넘긴다.
   */
  drive(user: Sticks): Sticks {
    // 문제를 푸는 동안은 레버가 기계를 움직이지 않는다 (키보드·게임패드 포함)
    if (!this.cleared && this.current?.quiz) return { lx: 0, ly: 0, rx: 0, ry: 0 };
    const d = this.cleared ? null : (this.current?.demo?.(this.demoFrame, this.s) ?? null);
    if (d) {
      this.demoFrame++;
      return { lx: 0, ly: 0, rx: 0, ry: 0, ...d };
    }
    if (this.demoFrame > 0 && this.demoRest > 0) {
      this.demoRest--;
      return { lx: 0, ly: 0, rx: 0, ry: 0 };
    }
    return user;
  }
  /** 지금 화면이 무엇을 보여 줘야 하나 (배지·노브 모양) */
  demoState(): 'demo' | 'rest' | 'user' {
    if (!this.cleared && this.current?.demo?.(this.demoFrame, this.s)) return 'demo';
    return this.demoFrame > 0 && this.demoRest > 0 ? 'rest' : 'user';
  }
  /**
   * 실습이 시작되는 단계: 마지막 '다시 볼까요?' 다음, 없으면 시범이 아닌 첫 단계.
   * 반복 연습할 때마다 시범을 다시 보게 하면 안 된다 (기획 검토, 2026-11-16)
   */
  practiceStart(): number {
    const st = this.lesson.steps;
    let ask = -1;
    st.forEach((x, i) => x.ask && (ask = i));
    if (ask >= 0) return ask + 1;
    const i = st.findIndex((x) => !x.demo);
    return i < 0 ? 0 : i;
  }
  /** 이 미션에 시범이 있나 */
  get hasDemo(): boolean {
    return this.lesson.steps.some((x) => x.demo);
  }
  /** 시범을 건너뛰고 실습부터 */
  skipDemo(): void {
    const at = this.practiceStart();
    if (at <= 0 || at >= this.lesson.steps.length) return;
    this.step = at;
    this.enter();
  }
  /** 이 단계를 처음부터 다시 (시범도 다시 돈다) */
  restartStep(): void {
    this.enter();
  }
  /** 고르는 단계(ask)에서 유저가 누른 것: again이면 시범 처음으로, 아니면 다음 단계로 */
  /** 고르기 문제의 답 (한 번만). 맞았나를 돌려준다 — 화면이 풀이를 보여 주고 '다음'을 띄운다 */
  picked: number | null = null;
  answer(i: number): boolean | null {
    const q = this.current?.quiz;
    if (this.cleared || !q || this.picked !== null) return null;
    this.picked = i;
    const ok = i === q.answer;
    if (!ok) this.bag.miss = (this.bag.miss ?? 0) + 1;
    return ok;
  }
  /** 풀이를 본 뒤 다음 문제로 */
  nextQuiz(): void {
    if (this.cleared || !this.current?.quiz || this.picked === null) return;
    this.picked = null;
    this.step++;
    this.notice = null;
    if (this.step >= this.lesson.steps.length) this.cleared = true;
    else this.enter();
  }
  choose(again: boolean): void {
    const ask = this.current?.ask;
    if (this.cleared || !ask) return;
    this.step = again ? ask.replay : this.step + 1;
    this.notice = null;
    if (this.step >= this.lesson.steps.length) this.cleared = true;
    else this.enter();
  }
  /** 이번 프레임에 단계가 넘어갔으면 true */
  update(): boolean {
    if (this.cleared) return false;
    const st = this.current;
    if (!st) return false;
    const f = st.fail?.(this.s, this.mem, this.bag);
    if (f) {
      this.step = f.to;
      this.notice = f.msg;
      this.rewinds++;
      if (this.rewinds >= 3) this.wantReset = true;
      this.enter();
      return false;
    }
    const c = st.coach?.(this.s, this.mem, this.bag) ?? null;
    if (c) {
      this.coach = c;
      this.coachHold = 30;
    } else if (this.coachHold > 0 && --this.coachHold === 0) this.coach = null;
    // 고르는 단계는 버튼(choose·answer)으로만 넘어간다
    if (st.ask || st.quiz) return false;
    if (!st.done(this.s, this.mem, this.bag)) return false;
    this.step++;
    this.notice = null;
    if (this.step >= this.lesson.steps.length) this.cleared = true;
    else this.enter();
    return true;
  }
}
