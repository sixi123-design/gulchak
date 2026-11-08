import type { MachineSpec } from '../config/machine';
import { BUCKET_EDGES, bucketCorners, toWorld, type Frame } from './kinematics';
import type { Site } from './site';
import { dot, lerp, segSegDist2, v3, type V3 } from './vec';

export interface Capsule {
  a: V3;
  b: V3;
  r: number;
  part: '붐' | '암' | '버킷';
}

export interface Shape {
  capsules: Capsule[];
  bucket: V3[]; // 꼭짓점 6개
  armEnd: V3;
}

export function shapeOf(m: MachineSpec, f: Frame, swing: number): Shape {
  const P0 = toWorld(swing, f.P0);
  const P1 = toWorld(swing, f.P1);
  const P2 = toWorld(swing, f.P2);
  const bucket = bucketCorners(m, f, swing);
  const capsules: Capsule[] = [
    { a: P0, b: P1, r: m.radii.boom, part: '붐' },
    { a: P1, b: P2, r: m.radii.arm, part: '암' },
  ];
  for (const [i, j] of BUCKET_EDGES) capsules.push({ a: bucket[i], b: bucket[j], r: m.radii.bucket, part: '버킷' });
  return { capsules, bucket, armEnd: P2 };
}

export interface Hit {
  id: 'D-POLE' | 'D-DIGLINE' | 'D-PASS';
  detail: string;
}

const POLE_R = 0.03;
const ROPE_R = 0.015;

/** 한 시점 형상에 대한 정적 판정 (폴·줄 접촉, 오버스윙, 굴착구역) */
export function staticHits(site: Site, s: Shape, workHeight: number): Hit[] {
  const hits: Hit[] = [];
  for (const p of site.poles) {
    const a = v3(p.x, 0, p.z);
    const b = v3(p.x, p.h, p.z);
    for (const c of s.capsules) {
      const rr = c.r + POLE_R;
      if (segSegDist2(c.a, c.b, a, b) < rr * rr) {
        hits.push({ id: 'D-POLE', detail: `${c.part}가 ${p.name}에 접촉` });
        break;
      }
    }
  }
  for (const rope of site.ropes) {
    for (const c of s.capsules) {
      const rr = c.r + ROPE_R;
      if (segSegDist2(c.a, c.b, rope.a, rope.b) < rr * rr) {
        hits.push({ id: 'D-POLE', detail: `${c.part}가 ${rope.name}에 접촉` });
        break;
      }
    }
  }
  for (const st of site.stations) {
    // 오버스윙: 암 끝·버킷 꼭짓점이 ⓓ선 바깥으로
    for (const p of [s.armEnd, ...s.bucket]) {
      const rho = dot(p, st.axis);
      if (rho >= st.zoneIn - 0.5 && rho <= site.reach + 0.5 && p.z < st.overswingLat) {
        hits.push({ id: 'D-POLE', detail: `${st.name}지점 ⓓ오버스윙제한선을 넘음` });
        break;
      }
    }
    // 굴착구역: 작업 높이에서 구역 밖
    for (const p of s.bucket) {
      if (p.y >= workHeight) continue;
      const rho = dot(p, st.axis);
      const lat = p.z;
      const inBand = rho >= st.zoneIn - 1.0 && rho <= st.zoneOut + 1.0 && Math.abs(lat) <= st.zoneHalfW + 1.0;
      if (!inBand) continue;
      const inZone = rho >= st.zoneIn && rho <= st.zoneOut && Math.abs(lat) <= st.zoneHalfW;
      if (!inZone) {
        const where = rho < st.zoneIn ? '가상굴착제한선' : rho > st.zoneOut ? 'ⓑ선' : 'ⓒ선(굴착구역선)';
        hits.push({ id: 'D-DIGLINE', detail: `${st.name}지점 ${where} 밖에서 버킷 작업` });
        break;
      }
    }
  }
  return hits;
}

/** 버킷 두께만큼 제한선 접촉을 넉넉히 본다 (접촉도 위반) */
const PASS_MARGIN = 0.05;
/** 버킷 꼭짓점이 B 평면(x=0)을 가로지를 때의 판정 */
export function passHits(site: Site, prev: V3[], cur: V3[]): Hit[] {
  const hits: Hit[] = [];
  for (let i = 0; i < cur.length; i++) {
    const a = prev[i];
    const b = cur[i];
    if (a.x === b.x || Math.sign(a.x) === Math.sign(b.x)) continue;
    const t = a.x / (a.x - b.x);
    const c = lerp(a, b, t);
    if (c.z <= 0) {
      hits.push({ id: 'D-PASS', detail: 'B지점 반대쪽으로 선회 (통과구역을 지나지 않음)' });
      break;
    }
    if (c.z <= site.B.rE + PASS_MARGIN || c.z >= site.B.rF - PASS_MARGIN) {
      const inner = c.z < (site.B.rE + site.B.rF) / 2;
      hits.push({ id: 'D-PASS', detail: `버킷이 가상통과제한선(${inner ? 'ⓔ폴' : 'ⓕ폴'} 쪽)에 닿거나 밖으로 통과` });
      break;
    }
    if (c.y <= site.B.ropeY + PASS_MARGIN) {
      hits.push({ id: 'D-PASS', detail: '버킷이 장애물선보다 낮게 통과' });
      break;
    }
  }
  return hits;
}
