import type { MachineSpec } from '../config/machine';
import { betaOf, groundReach } from './kinematics';
import { v3, type V3 } from './vec';

export type StationName = 'A' | 'C';

export interface Station {
  name: StationName;
  axis: V3; // 반경 단위벡터
  azimuth: number;
  bLine: number; // ⓑ선 반경
  pitIn: number;
  pitOut: number;
  pitHalfW: number;
  zoneIn: number; // 가상굴착제한선 반경
  zoneOut: number; // = bLine
  zoneHalfW: number;
  overswingLat: number; // ⓓ선 측면 위치 (음수: B 반대편)
}

export interface Pole {
  x: number;
  z: number;
  h: number;
  name: string;
}
export interface Rope {
  a: V3;
  b: V3;
  name: string;
}

export interface Site {
  reach: number;
  beta: number;
  betaR: number;
  stations: [Station, Station];
  B: { rE: number; rF: number; ropeY: number; poleTop: number };
  poles: Pole[];
  ropes: Rope[];
}

/** 지점 국소 좌표 (ρ, λ) → 월드 */
export const stationPoint = (s: Station, rho: number, lat: number, y = 0): V3 =>
  v3(s.axis.x * rho, y, lat);

export function buildSite(m: MachineSpec): Site {
  const reach = groundReach(m);
  const { beta, betaR } = betaOf(m);
  const W = m.bucketWidth;
  const bLine = reach - 0.3;
  const pitOut = bLine - 0.3;
  const pitIn = pitOut - 2.5 * m.bucketLength;
  const zoneIn = pitIn - 0.5;
  const zoneHalfW = W / 2 + 0.5;

  const mk = (name: StationName, axisX: number, azimuth: number): Station => ({
    name,
    axis: v3(axisX, 0, 0),
    azimuth,
    bLine,
    pitIn,
    pitOut,
    pitHalfW: W / 2,
    zoneIn,
    zoneOut: bLine,
    zoneHalfW,
    overswingLat: -(zoneHalfW + 0.2),
  });
  const A = mk('A', -1, Math.PI);
  const C = mk('C', 1, 0);

  const poles: Pole[] = [];
  const ropes: Rope[] = [];
  for (const s of [A, C]) {
    const P = (rho: number, lat: number, y = 0) => stationPoint(s, rho, lat, y);
    const corners: [number, number, string][] = [
      [s.zoneOut, -zoneHalfW, 'ⓑ좌'],
      [s.zoneOut, zoneHalfW, 'ⓑ우'],
      [s.zoneIn, -zoneHalfW, 'ⓒ안좌'],
      [s.zoneIn, zoneHalfW, 'ⓒ안우'],
    ];
    for (const [rho, lat, n] of corners) {
      const p = P(rho, lat);
      poles.push({ x: p.x, z: p.z, h: 0.5, name: `${s.name}-${n}폴` });
    }
    ropes.push({ a: P(s.zoneOut, -zoneHalfW, 0.5), b: P(s.zoneOut, zoneHalfW, 0.5), name: `${s.name}-ⓑ선` });
    ropes.push({ a: P(s.zoneIn, -zoneHalfW, 0.5), b: P(s.zoneOut, -zoneHalfW, 0.5), name: `${s.name}-ⓒ선(바깥쪽)` });
    ropes.push({ a: P(s.zoneIn, zoneHalfW, 0.5), b: P(s.zoneOut, zoneHalfW, 0.5), name: `${s.name}-ⓒ선(B쪽)` });
    // ⓓ 오버스윙제한선
    const d0 = P(s.zoneIn, s.overswingLat);
    const d1 = P(reach, s.overswingLat);
    poles.push({ x: d0.x, z: d0.z, h: beta, name: `${s.name}-ⓓ폴(안)` });
    poles.push({ x: d1.x, z: d1.z, h: beta, name: `${s.name}-ⓓ폴(밖)` });
    ropes.push({ a: { ...d0, y: beta - 0.5 }, b: { ...d1, y: beta - 0.5 }, name: `${s.name}-ⓓ오버스윙제한선` });
  }

  const rE = betaR + 0.5;
  const rF = reach - 1.0;
  const ropeY = beta - 1.0;
  poles.push({ x: 0, z: rE, h: beta, name: 'B-ⓔ폴' });
  poles.push({ x: 0, z: rF, h: beta, name: 'B-ⓕ폴' });
  ropes.push({ a: v3(0, ropeY, rE), b: v3(0, ropeY, rF), name: 'B-장애물선' });

  return { reach, beta, betaR, stations: [A, C], B: { rE, rF, ropeY, poleTop: beta }, poles, ropes };
}
