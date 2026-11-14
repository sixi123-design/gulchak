/**
 * 코스운전 코스 (판정명세_주행.md 3장). 큐넷 공개문제(2022) 6-5쪽 작도법을 그대로 따른다.
 *
 * 도면 좌표(px, py, py가 위)를 월드 (x, z) = (px - ox, -(py - oy))로 옮긴다.
 *  - A = 곡선 2의 중심, A' = 곡선 1의 중심. |AA'| = L + (L - 1.8D), AA'는 AB와 135°.
 *  - 출발선 F–F'는 A'의 왼쪽 수평선, 도착선 B–B'는 A의 오른쪽 수평선.
 *  - 출발할 때 진행 방향은 도면 아래(월드 +z). 곡선 1은 왼쪽 135°, 곡선 2는 오른쪽 135°.
 * 선 두께는 코스 바깥쪽에 둔다(도면 치수는 선 두께를 뺀 안쪽 간격).
 */
import type { MachineSpec } from '../../config/machine';

export type P = { x: number; z: number };
export const LINE_W = 0.1;

/** 원호 띠: 중심, 반지름 [r0, r1], 각도 범위(atan2(z, x) 기준, a0 → a1 방향으로 증가) */
export interface ArcBand {
  name: string;
  c: P;
  r0: number;
  r1: number;
  a0: number;
  a1: number;
}

/** 직선 띠: p0 → p1 선분을 따라 두께 w (한쪽으로 n 방향으로 w만큼) */
export interface LineBand {
  name: string;
  p0: P;
  p1: P;
  /** 두께 방향 단위벡터 (p0→p1에 수직) */
  n: P;
  w: number;
}

export interface Course {
  L: number;
  D: number;
  E: number;
  width: number;
  /** 코스 중심선 반지름 = L - 0.9D */
  rc: number;
  A: P;
  A2: P; // A'
  /** 판정 대상 경계선 (노란 선) */
  bounds: ArcBand[];
  /** 가로선 (흰 선, 접촉 판정 제외) */
  start: LineBand;
  /** 두 곡선이 만나는 곳 (C–C' 가운데): 진행 방향 t, 코스 가로 방향 n. 정지선은 t 방향 거리 u로 정의 */
  junction: { p: P; t: P; n: P };
  /** 정지선 띠 (u 범위). 뒷선 [-0.65, -0.55], 앞선 [0.55, 0.65] */
  stopRear: [number, number];
  stopFront: [number, number];
  arrive: LineBand;
  /** 주차선(좌우)·주차구역선·주차선 끝 (흰 선, 접촉 판정 제외) */
  parking: LineBand[];
  /** 주차구역(앞바퀴를 두는 1.5m 칸): 출발선에서 뒤로 [0, 1.5] */
  parkDepth: number;
  /** 출발 방향 (월드) */
  startDir: P;
  /** 출발선 가운데 */
  startMid: P;
  /** 도착선 가운데 */
  arriveMid: P;
  /** 도착선 너머 빈 바닥 길이 */
  runout: number;
  /** 바닥 범위 (렌더용) */
  bbox: { x0: number; x1: number; z0: number; z1: number };
}

const deg = Math.PI / 180;

export function buildCourse(m: MachineSpec): Course {
  const E = m.wheelbase;
  const D = m.trackWidth;
  const L = 2.7 * E; // 앞뒤 차폭 같음
  const W = 1.8 * D;
  const Li = L - W;
  const rc = L - W / 2;
  // 도면 좌표: A = (0, 0), A' = (2L - W) * (cos135, sin135)
  const dA2 = 2 * L - W;
  const pA = { x: 0, y: 0 };
  const pA2 = { x: dA2 * Math.cos(135 * deg), y: dA2 * Math.sin(135 * deg) };
  // 원점: 코스 가운데쯤 (A와 A' 중간)
  const ox = (pA.x + pA2.x) / 2;
  const oy = (pA.y + pA2.y) / 2;
  const w = (px: number, py: number): P => ({ x: px - ox, z: -(py - oy) });
  const A = w(pA.x, pA.y);
  const A2 = w(pA2.x, pA2.y);
  // 도면 각도 θ(반시계, y 위) → 월드 각도 atan2(z, x) = -θ
  const wa = (thetaDeg: number) => -thetaDeg * deg;

  // 곡선 1: 중심 A', 도면 각도 180° → 315° (반시계). 월드 각도는 -180° → -315° (감소)
  //   ArcBand는 a0 < a1로 저장: [-315°, -180°]
  // 곡선 2: 중심 A, 도면 각도 135° → 0° (시계). 월드 각도 -135° → 0° (증가): [-135°, 0°]
  const arc1 = { a0: wa(315), a1: wa(180) };
  const arc2 = { a0: wa(135), a1: wa(0) };
  const bounds: ArcBand[] = [
    // 곡선 1: 안쪽 반지름 Li (C–F'), 바깥 L (C'–F)
    { name: '곡선1 안쪽 선', c: A2, r0: Li - LINE_W, r1: Li, ...arc1 },
    { name: '곡선1 바깥 선', c: A2, r0: L, r1: L + LINE_W, ...arc1 },
    // 곡선 2: 안쪽 Li (B'–C'), 바깥 L (B–C)
    { name: '곡선2 안쪽 선', c: A, r0: Li - LINE_W, r1: Li, ...arc2 },
    { name: '곡선2 바깥 선', c: A, r0: L, r1: L + LINE_W, ...arc2 },
  ];

  // 출발선 F–F': A'의 왼쪽 수평선 (도면 각도 180°), 두께는 주차구역 쪽(도면 위, 월드 -z)
  const F = w(pA2.x - L, pA2.y);
  const F2 = w(pA2.x - Li, pA2.y);
  const up: P = { x: 0, z: -1 }; // 도면 위 = 월드 -z = 출발 반대 방향
  const start: LineBand = { name: '출발선', p0: F, p1: F2, n: up, w: LINE_W };
  // 도착선 B–B': A의 오른쪽 수평선, 두께는 코스 바깥(도면 아래, 월드 +z)
  const B = w(pA.x + L, pA.y);
  const B2 = w(pA.x + Li, pA.y);
  const arrive: LineBand = { name: '도착선', p0: B2, p1: B, n: { x: 0, z: 1 }, w: LINE_W };

  // 정지선: 접점 C–C'(곡선 1 끝)에서 진행 방향으로 ±0.55 ~ ±0.65 (안쪽 간격 1.10m, 선 두께 0.1m)
  const ja = wa(315);
  const jp = { x: A2.x + rc * Math.cos(ja), z: A2.z + rc * Math.sin(ja) };
  const jt = { x: Math.sin(ja), z: -Math.cos(ja) };
  const junction = { p: jp, t: jt, n: { x: -jt.z, z: jt.x } };
  const half = 1.1 / 2;
  const stopRear: [number, number] = [-half - LINE_W, -half];
  const stopFront: [number, number] = [half, half + LINE_W];

  // 주차: 출발선 뒤(월드 -z)로 주차구역 1.5m, 주차선 2E
  const parkDepth = 1.5;
  const P2 = 2 * E;
  const zS = F.z;
  const parking: LineBand[] = [
    { name: '주차선', p0: { x: F.x - LINE_W, z: zS }, p1: { x: F.x - LINE_W, z: zS - P2 }, n: { x: 1, z: 0 }, w: LINE_W },
    { name: '주차선', p0: { x: F2.x, z: zS }, p1: { x: F2.x, z: zS - P2 }, n: { x: 1, z: 0 }, w: LINE_W },
    { name: '주차구역선', p0: { x: F.x, z: zS - LINE_W - parkDepth }, p1: { x: F2.x, z: zS - LINE_W - parkDepth }, n: { x: 0, z: -1 }, w: LINE_W },
    { name: '주차선', p0: { x: F.x - LINE_W, z: zS - P2 }, p1: { x: F2.x + LINE_W, z: zS - P2 }, n: { x: 0, z: -1 }, w: LINE_W },
  ];
  const runout = 6;
  const pts = [F, F2, B, B2, { x: A.x + L, z: A.z }, { x: A2.x - L, z: A2.z }, { x: A.x, z: A.z - L - 1 }, { x: A2.x, z: A2.z + L + 1 }, { x: F.x, z: zS - P2 }, { x: B.x, z: B.z + runout }];
  const bbox = {
    x0: Math.min(...pts.map((p) => p.x)) - 3,
    x1: Math.max(...pts.map((p) => p.x)) + 3,
    z0: Math.min(...pts.map((p) => p.z)) - 3,
    z1: Math.max(...pts.map((p) => p.z)) + 3,
  };
  return {
    L,
    D,
    E,
    width: W,
    rc,
    A,
    A2,
    bounds,
    start,
    junction,
    stopRear,
    stopFront,
    arrive,
    parking,
    parkDepth,
    startDir: { x: 0, z: 1 },
    startMid: { x: (F.x + F2.x) / 2, z: zS },
    arriveMid: { x: (B.x + B2.x) / 2, z: B.z },
    runout,
    bbox,
  };
}

// ---------- 기하 도우미 ----------

const sub = (a: P, b: P): P => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a: P, b: P) => a.x * b.x + a.z * b.z;
const len = (a: P) => Math.hypot(a.x, a.z);

/** 각도 a가 [a0, a1] 안에 있는가 (2π 주기) */
export function angleIn(a: number, a0: number, a1: number, margin = 0) {
  const TWO = Math.PI * 2;
  const t = (((a - a0 + margin) % TWO) + TWO) % TWO;
  return t <= a1 - a0 + 2 * margin;
}

/** 점과 선분 사이 거리 */
function segDist(p: P, a: P, b: P) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, { x: a.x + ab.x * t, z: a.z + ab.z * t }));
}

/** 바퀴 사각형(꼭짓점 4개, 볼록)이 원호 띠와 겹치는가 */
export function rectHitsArc(rect: P[], band: ArcBand) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < rect.length; i++) {
    const d = len(sub(rect[i], band.c));
    max = Math.max(max, d);
    min = Math.min(min, segDist(band.c, rect[i], rect[(i + 1) % rect.length]));
  }
  if (min > band.r1 || max < band.r0) return false;
  // 각도 범위: 사각형 중 하나라도 원호 범위 안 (사각형은 작아서 꼭짓점·가운데로 충분)
  const cx = rect.reduce((s, q) => s + q.x, 0) / rect.length;
  const cz = rect.reduce((s, q) => s + q.z, 0) / rect.length;
  for (const q of [...rect, { x: cx, z: cz }]) {
    if (angleIn(Math.atan2(q.z - band.c.z, q.x - band.c.x), band.a0, band.a1)) return true;
  }
  return false;
}

/** 점이 직선 띠의 어느 쪽에 있는가: 띠 두께 방향(n) 좌표. 0~w면 띠 위 */
export function lineSide(p: P, l: LineBand) {
  return dot(sub(p, l.p0), l.n);
}

/** 점이 원호 위 어디쯤인가: 중심 기준 월드 각도 */
export function arcAngle(p: P, c: P) {
  return Math.atan2(p.z - c.z, p.x - c.x);
}

/** 중심선 위 점과 진행 방향: 코스 시작(출발선)부터 잰 거리 s (0 ~ 두 곡선 길이) */
export function centerline(c: Course, s: number): { p: P; dir: P } {
  const arc = 135 * deg * c.rc;
  if (s <= arc) {
    // 곡선 1: A' 기준 월드 각도 -180° 에서 감소
    const a = -Math.PI - s / c.rc;
    const p = { x: c.A2.x + c.rc * Math.cos(a), z: c.A2.z + c.rc * Math.sin(a) };
    return { p, dir: { x: Math.sin(a), z: -Math.cos(a) } };
  }
  const a = -135 * deg + (s - arc) / c.rc;
  const p = { x: c.A.x + c.rc * Math.cos(a), z: c.A.z + c.rc * Math.sin(a) };
  return { p, dir: { x: -Math.sin(a), z: Math.cos(a) } };
}
export const courseLength = (c: Course) => 2 * 135 * deg * c.rc;

/** 정지선 기준 좌표: 접점에서 진행 방향 거리 u */
export function junctionU(c: Course, p: P) {
  return dot(sub(p, c.junction.p), c.junction.t);
}
