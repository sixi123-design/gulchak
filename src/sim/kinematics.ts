import type { MachineSpec } from '../config/machine';
import { v3, type V3 } from './vec';

/** 관절 상태. boom은 수평 기준 절대각, arm·bucket은 상대각 (모두 rad) */
export interface Pose {
  swing: number;
  boom: number;
  arm: number;
  bucket: number;
}

export type P2 = { r: number; y: number };

export interface Frame {
  P0: P2;
  P1: P2;
  P2: P2;
  tip: P2;
  heel: P2;
  thA: number;
  thK: number;
  /** 버킷 개구부가 향하는 방향 (반경-높이 평면 단위벡터) */
  nOpen: P2;
}

export function fk(m: MachineSpec, p: Pose): Frame {
  const P0 = { r: m.boomFoot.r, y: m.boomFoot.y };
  const P1 = { r: P0.r + m.L1 * Math.cos(p.boom), y: P0.y + m.L1 * Math.sin(p.boom) };
  const thA = p.boom + p.arm;
  const P2 = { r: P1.r + m.L2 * Math.cos(thA), y: P1.y + m.L2 * Math.sin(thA) };
  const thK = thA + p.bucket;
  const tip = { r: P2.r + m.L3 * Math.cos(thK), y: P2.y + m.L3 * Math.sin(thK) };
  const heel = {
    r: P2.r + m.heelLen * Math.cos(thK + m.heelAngle),
    y: P2.y + m.heelLen * Math.sin(thK + m.heelAngle),
  };
  const nOpen = { r: Math.cos(thK - Math.PI / 2), y: Math.sin(thK - Math.PI / 2) };
  return { P0, P1, P2, tip, heel, thA, thK, nOpen };
}

export const dirOf = (swing: number): V3 => v3(Math.cos(swing), 0, Math.sin(swing));
/** 선회 방향에 수직인 측면 축 (증가 방향 = ψ 증가 = 오른쪽) */
export const latOf = (swing: number): V3 => v3(-Math.sin(swing), 0, Math.cos(swing));
export const toWorld = (swing: number, q: P2, lat = 0): V3 =>
  v3(q.r * Math.cos(swing) - lat * Math.sin(swing), q.y, q.r * Math.sin(swing) + lat * Math.cos(swing));

/** 버킷 하부 샘플 (판정·흙 상호작용용): 끝 → 힐 4점 + 힐-핀 중점. t는 끝 기준 순번 */
export function bucketUnderside(f: Frame): P2[] {
  const out: P2[] = [];
  for (const t of [0, 0.33, 0.66, 1]) {
    out.push({ r: f.tip.r + (f.heel.r - f.tip.r) * t, y: f.tip.y + (f.heel.y - f.tip.y) * t });
  }
  out.push({ r: (f.heel.r + f.P2.r) / 2, y: (f.heel.y + f.P2.y) / 2 });
  return out;
}

/** 버킷 꼭짓점 6개 (핀·힐·끝 × 좌우) */
export function bucketCorners(m: MachineSpec, f: Frame, swing: number): V3[] {
  const h = m.bucketWidth / 2;
  const pts: V3[] = [];
  for (const q of [f.P2, f.heel, f.tip]) {
    pts.push(toWorld(swing, q, -h), toWorld(swing, q, h));
  }
  return pts; // [pinL,pinR, heelL,heelR, tipL,tipR]
}

export const BUCKET_EDGES: [number, number][] = [
  [4, 5], // 끝 날
  [2, 3], // 힐
  [4, 2],
  [5, 3], // 바닥 양옆
  [0, 2],
  [1, 3], // 뒷판
  [0, 4],
  [1, 5], // 개구부 양옆
];

/** 역기구학: 버킷 끝을 (r, y)에 두고 버킷 절대각을 thK로 하는 관절각. 도달 불가면 null */
export function ik(m: MachineSpec, r: number, y: number, thK: number): Omit<Pose, 'swing'> | null {
  const p2r = r - m.L3 * Math.cos(thK);
  const p2y = y - m.L3 * Math.sin(thK);
  const dx = p2r - m.boomFoot.r;
  const dy = p2y - m.boomFoot.y;
  const D2 = dx * dx + dy * dy;
  const c = (D2 - m.L1 * m.L1 - m.L2 * m.L2) / (2 * m.L1 * m.L2);
  if (c < -1 || c > 1) return null;
  const arm = -Math.acos(c);
  const boom = Math.atan2(dy, dx) - Math.atan2(m.L2 * Math.sin(arm), m.L1 + m.L2 * Math.cos(arm));
  return { boom, arm, bucket: thK - (boom + arm) };
}

/** ⓐ: 암 최대 펼침 + 버킷 일직선에서 버킷 끝이 지면(y=0)에 닿는 반경 */
export function groundReach(m: MachineSpec): number {
  const arm = m.limits.arm[1];
  let lo = m.limits.boom[0];
  let hi = m.limits.boom[1];
  const tipY = (b: number) => fk(m, { swing: 0, boom: b, arm, bucket: 0 }).tip.y;
  if (tipY(lo) > 0) return fk(m, { swing: 0, boom: lo, arm, bucket: 0 }).tip.r;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tipY(mid) < 0) lo = mid;
    else hi = mid;
  }
  return fk(m, { swing: 0, boom: (lo + hi) / 2, arm, bucket: 0 }).tip.r;
}

/** β: 붐 최대 세움 + 암 최대 오므림에서 암 끝 핀 높이와 반경 */
export function betaOf(m: MachineSpec): { beta: number; betaR: number } {
  const f = fk(m, { swing: 0, boom: m.limits.boom[1], arm: m.limits.arm[0], bucket: 0 });
  return { beta: f.P2.y, betaR: f.P2.r };
}
