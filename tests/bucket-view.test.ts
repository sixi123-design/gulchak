import { expect, it } from 'vitest';
import * as THREE from 'three';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { FREE } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { ik } from '../src/sim/kinematics';

/**
 * 운전석 눈으로 본 버킷 속 흙 (아스트라 합격 기준, 2026-11-12).
 * 버킷 입구 면을 고르게 표본화해 눈에서 광선을 쏘고, 첫 충돌을 버킷 속 흙 / 버킷 철판 / 지형 / 날 앞 흙 / 기타(암 등)로 나눈다.
 * 평적 30%인데 입구가 흙으로 꽉 차 보이던 문제(입구 위 고봉, 잘못된 쪽에 그린 날 쪽 흙)를 숫자로 막는다.
 */
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop, set: () => true });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };

const SC = MACHINE.struckCapacity;
const R = rules as unknown as RulesFile;

/** 실제 굴착(당기며 오므림)으로 평적 fill까지 채운 세션 */
function dug(fill: number) {
  const s = new DigSession(MACHINE, R, FREE, () => 0.5);
  s.belt = true;
  s.leverUnlocked = true;
  s.rpm = 0.8;
  s.ready();
  for (let i = 0; i < 100; i++) s.step();
  s.setPose(ik(MACHINE, s.digTarget.rho, 0.2, -0.9)!);
  for (let n = 0; n < 600; n++) {
    s.input = Object.assign({ lx: 0, ly: 0, rx: 0, ry: 0 }, n < 26 ? { ry: 1 } : { ly: -0.7, rx: -0.6, ry: -0.1 });
    s.step();
    if (n > 26 && s.load >= fill * SC) break;
  }
  return s;
}

type Hit = 'soil' | 'steel' | 'terrain' | 'ext' | 'other' | 'none';
async function measure(s: DigSession) {
  const { ExcavatorView } = await import('../src/render/excavatorView');
  const { SoilView } = await import('../src/render/siteView');
  const v = new ExcavatorView(MACHINE, 'A') as any;
  v.setCabView?.(true);
  v.sync(s);
  const sv = new SoilView(s.soil.grids) as any;
  sv.sync();
  const scene = new THREE.Scene();
  scene.add(v.root);
  for (const m of sv.meshes) scene.add(m);
  scene.updateMatrixWorld(true);
  const soilSet = new Set<THREE.Object3D>(v.soilMeshes);
  const extSet = new Set<THREE.Object3D>([v.lipMound, v.surMound]);
  const terrSet = new Set<THREE.Object3D>(sv.meshes);
  const kind = (o: THREE.Object3D): Hit => {
    if (soilSet.has(o)) return 'soil';
    if (extSet.has(o)) return 'ext';
    if (terrSet.has(o)) return 'terrain';
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === v.bucket) return 'steel';
    return 'other';
  };
  const eye = v.eyeWorld(new THREE.Vector3(), 0) as THREE.Vector3;
  const cav = v.cavity as [number, number][];
  const [x0, y0] = cav[0];
  const [x1] = cav[1];
  const W = MACHINE.bucketWidth * 0.9;
  const rc = new THREE.Raycaster();
  const objs: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) {
      let vis = true;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) vis = false;
      if (vis) objs.push(o);
    }
  });
  const cnt: Record<Hit, number> = { soil: 0, steel: 0, terrain: 0, ext: 0, other: 0, none: 0 };
  const nOut = new THREE.Vector3(0, -1, 0).transformDirection(v.bucket.matrixWorld);
  let facing = 0;
  let terrIn = 0;
  const N = 14;
  const M = 8;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      const p = v.bucket.localToWorld(new THREE.Vector3(x0 + ((x1 - x0) * (i + 0.5)) / N, y0, -W / 2 + (W * (j + 0.5)) / M));
      const d = p.clone().sub(eye);
      // 입구가 눈을 향할 때만 (입구 안을 들여다보는 광선)
      if (d.dot(nOut) >= 0) continue;
      facing++;
      const dist = d.length();
      rc.set(eye, d.normalize());
      const h = rc.intersectObjects(objs, false)[0];
      let k: Hit = h ? kind(h.object) : 'none';
      // 입구 면에 닿기 전에 버킷 테두리(철판)가 가리면 입구 안이 아님 → 제외
      if (k === 'steel' && h && h.distance < dist - 0.03) k = 'other';
      // 지형: 입구 면 앞(버킷을 가린 구덩이 벽)인지, 입구 면 너머(버킷 안으로 들어온 지형 = 잘못)인지
      if (k === 'terrain' && h && h.distance > dist + 0.03) terrIn++;
      cnt[k]++;
    }
  // 입구 위(-y, 입구 밖)로 나온 버킷 속 흙 부피: 흙 메시 정점 중 입구 밖 깊이의 최대값으로 근사
  let outMax = 0;
  for (const m of v.soilMeshes as THREE.Mesh[]) {
    if (!m.visible) continue;
    const p = m.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) outMax = Math.max(outMax, y0 - p.getY(k));
  }
  const seen = facing - cnt.other - cnt.none;
  const a = s.pose.boom + s.pose.arm + s.pose.bucket;
  return {
    tiltDeg: (Math.atan2(Math.sin(a), -Math.cos(a)) * 180) / Math.PI,
    fill: s.load / SC,
    back: s.loadBack / SC,
    sur: s.surcharge / SC,
    facing,
    cnt,
    soilFrac: seen > 0 ? cnt.soil / seen : NaN,
    steelFrac: seen > 0 ? cnt.steel / seen : NaN,
    anySoilFrac: seen > 0 ? (cnt.soil + cnt.ext + cnt.terrain) / seen : NaN,
    outMax,
    terrIn,
  };
}

/** 자세 바꾸기: 날 끝 (r, y), 버킷 '위' 기울기 tiltDeg (tilt = 입구 바깥 방향에서 중력 반대가 기운 각) */
function poseTilt(s: DigSession, r: number, y: number, tiltDeg: number) {
  const th = Math.PI - (tiltDeg * Math.PI) / 180;
  const thK = Math.atan2(Math.sin(th), Math.cos(th));
  let q = null;
  for (const dr of [0, -0.3, -0.6, -0.9, -1.2]) for (const dy of [0, 0.4, -0.3]) q ??= ik(MACHINE, r + dr, y + dy, thK);
  if (!q) throw new Error('ik');
  s.setPose({ ...q, swing: s.pose.swing });
}

/**
 * 아스트라 최종 합격 기준 (2차 판정). dig = 실제 굴착 자세(입구가 운전석 쪽·약간 아래): 시선이 버킷 안 흙 면에 먼저 닿아
 * 첫 충돌 비율로는 양을 가릴 수 없으므로 입구 밖 돌출(outMax, 꽉 찬 돔)로 막고, 양의 구분은 들어 올린 두 자세에서 본다.
 */
const CRIT: Record<string, Record<number, { outMax?: number; soilMax?: number; steelMin?: number; soilMin?: number }>> = {
  dig: { 0.3: { outMax: 0.02 }, 0.6: { outMax: 0.035 }, 0.95: { outMax: 0.08 } },
  'lift-54': { 0.3: { soilMax: 0.65, steelMin: 0.35 }, 0.6: { soilMax: 0.75, steelMin: 0.25 }, 0.95: { soilMin: 0.85 } },
  lift0: { 0.3: { soilMax: 0.45, steelMin: 0.55 }, 0.6: { soilMax: 0.55, steelMin: 0.45 }, 0.95: { soilMin: 0.75 } },
};

for (const fill of [0.3, 0.6, 0.95])
  it(`운전석에서 본 버킷 속 흙: 평적 ${fill * 100}% (굴착 중 · 들어 올림 -54° · 0°)`, async () => {
    const s = dug(fill);
    const rows: [string, Awaited<ReturnType<typeof measure>>][] = [['dig', await measure(s)]];
    for (const t of [-54, 0]) {
      poseTilt(s, s.digTarget.rho - 0.6, 1.0, t);
      rows.push([`lift${t}`, await measure(s)]);
    }
    for (const [name, r] of rows) {
      const c = CRIT[name][fill];
      const tag = `${name} ${JSON.stringify({ soil: r.soilFrac, steel: r.steelFrac, out: r.outMax })}`;
      expect(r.fill, tag).toBeGreaterThan(fill - 0.03);
      expect(r.fill, tag).toBeLessThan(fill + 0.03);
      expect(r.terrIn, tag).toBe(0);
      if (c.outMax !== undefined) expect(r.outMax, tag).toBeLessThanOrEqual(c.outMax);
      if (c.soilMax !== undefined) expect(r.soilFrac, tag).toBeLessThanOrEqual(c.soilMax);
      if (c.steelMin !== undefined) expect(r.steelFrac, tag).toBeGreaterThanOrEqual(c.steelMin);
      if (c.soilMin !== undefined) expect(r.soilFrac, tag).toBeGreaterThanOrEqual(c.soilMin);
    }
  });

/**
 * 날 앞 덧쌓임 더미 (아스트라 기준, 2026-11-13): 조금만 닿아도 이빨 앞에 납작한 사각 판이 생기고,
 * 평적 0%인데 입구 아래·안에 흙이 보이던 문제. 더미는 땅에 붙은 안식각 쐐기로, 버킷 안에 들어가거나 입구로 보이면 안 됨
 */
async function heapCheck(s: DigSession, V: number, push = false) {
  const { ExcavatorView } = await import('../src/render/excavatorView');
  const { SoilView } = await import('../src/render/siteView');
  s.load = 0;
  s.loadBack = 0;
  s.surcharge = V;
  // 운전석 쪽으로 당기며 민 흙
  const sw = s.pose.swing;
  const sg = push ? 1 : -1;
  (s as any).sur.dir = { x: sg * Math.cos(sw), y: 0, z: sg * Math.sin(sw) };
  const v = new ExcavatorView(MACHINE, 'A') as any;
  v.setCabView?.(true);
  // 실제 화면 갱신 경로 그대로 (표시 부피를 강제로 넣지 않음)
  v.sync(s);
  const sv = new SoilView(s.soil.grids) as any;
  sv.sync();
  const scene = new THREE.Scene();
  scene.add(v.root);
  for (const m of sv.meshes) scene.add(m);
  scene.updateMatrixWorld(true);
  const mound = v.surMound as THREE.Mesh;
  expect(mound.visible).toBe(true);
  // 1) 입구 광선 중 첫 충돌이 더미인 것
  const eye = v.eyeWorld(new THREE.Vector3(), 0) as THREE.Vector3;
  const cav = v.cavity as [number, number][];
  const W = MACHINE.bucketWidth;
  const objs: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
    objs.push(o);
  });
  const rc = new THREE.Raycaster();
  const nOut = new THREE.Vector3(0, -1, 0).transformDirection(v.bucket.matrixWorld);
  let rays = 0;
  let onMound = 0;
  let moundBeyond = 0;
  for (let i = 0; i < 14; i++)
    for (let j = 0; j < 8; j++) {
      const p = v.bucket.localToWorld(new THREE.Vector3(cav[0][0] + ((cav[1][0] - cav[0][0]) * (i + 0.5)) / 14, cav[0][1], -0.45 * W + (0.9 * W * (j + 0.5)) / 8));
      const d = p.clone().sub(eye);
      if (d.dot(nOut) >= 0) continue;
      rays++;
      const dist = d.length();
      rc.set(eye, d.normalize());
      const h = rc.intersectObjects(objs, false)[0];
      if (h && h.object === mound) {
        onMound++;
        // 입구 면 너머(버킷 안)에서 더미에 맞으면 '버킷 속 흙'처럼 보이는 것 → 0이어야 함. 입구 면 앞(버킷 밖 땅 위)은 실제 가림
        if (h.distance > dist + 0.005) moundBeyond++;
      }
    }
  // 2) 더미 정점이 버킷 속 공간(입구 다각형 안, 폭 안)에 들어간 깊이 · 3) 밑면이 지표에서 뜸/묻힘 · 4) 높이/길이
  const pos = mound.geometry.attributes.position;
  const inv = new THREE.Matrix4().copy(v.bucket.matrixWorld).invert();
  const inside = (x: number, y: number) => {
    let c = false;
    for (let a = 0, b = cav.length - 1; a < cav.length; b = a++) {
      const [xa, ya] = cav[a];
      const [xb, yb] = cav[b];
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
    }
    return c;
  };
  const edgeDist = (x: number, y: number) => {
    let m = Infinity;
    for (let a = 0, b = cav.length - 1; a < cav.length; b = a++) {
      const [xa, ya] = cav[a];
      const [xb, yb] = cav[b];
      const ex = xb - xa;
      const ey = yb - ya;
      const t = Math.max(0, Math.min(1, ((x - xa) * ex + (y - ya) * ey) / (ex * ex + ey * ey)));
      m = Math.min(m, Math.hypot(x - xa - ex * t, y - ya - ey * t));
    }
    return m;
  };
  let pen = 0;
  let baseGap = 0;
  let below = 0;
  const wv = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    wv.set(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(mound.matrixWorld);
    const g = s.soil.surfaceAt(wv.x, wv.z);
    below = Math.max(below, g - wv.y);
    // 밑면(높이 0) 정점은 지표에 붙어야 함
    if (wv.y - g < 0.004) baseGap = Math.max(baseGap, Math.abs(wv.y - g));
    const q = wv.clone().applyMatrix4(inv);
    if (Math.abs(q.z) <= W / 2 && inside(q.x, q.y)) pen = Math.max(pen, edgeDist(q.x, q.y));
  }
  // 그린 더미가 지표 위에 차지한 부피 (삼각형마다 수평 투영 넓이 × 세 꼭짓점의 지표 위 높이 평균) — 시뮬 surcharge와 같아야 함
  let meshVol = 0;
  {
    const ix = mound.geometry.index!;
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let t = 0; t < ix.count; t += 3) {
      for (let c = 0; c < 3; c++) P[c].set(pos.getX(ix.getX(t + c)), pos.getY(ix.getX(t + c)), pos.getZ(ix.getX(t + c))).applyMatrix4(mound.matrixWorld);
      const area = Math.abs((P[1].x - P[0].x) * (P[2].z - P[0].z) - (P[2].x - P[0].x) * (P[1].z - P[0].z)) / 2;
      const hm = P.reduce((acc, q) => acc + Math.max(0, q.y - s.soil.surfaceAt(q.x, q.z)), 0) / 3;
      meshVol += area * hm;
    }
  }
  // 입구 아래: 입구 면(핀→날 변, 폭 W)을 땅에 내려 비춘 자리 안에 지표보다 1cm 넘게 솟은 더미 정점 수
  // (입구가 땅을 보는 자세에선 운전석 광선이 입구에 안 닿으므로 이것으로 '땅을 보는 버킷 속 흙'을 판정)
  const m0 = v.bucket.localToWorld(new THREE.Vector3(cav[0][0], cav[0][1], -W / 2));
  const m1 = v.bucket.localToWorld(new THREE.Vector3(cav[1][0], cav[1][1], -W / 2));
  const m2 = v.bucket.localToWorld(new THREE.Vector3(cav[1][0], cav[1][1], W / 2));
  const m3 = v.bucket.localToWorld(new THREE.Vector3(cav[0][0], cav[0][1], W / 2));
  const quad = [m0, m1, m2, m3];
  const inQuad = (x: number, z: number) => {
    let c = false;
    for (let a = 0, b = 3; a < 4; b = a++) {
      const A = quad[a];
      const B = quad[b];
      if (A.z > z !== B.z > z && x < ((B.x - A.x) * (z - A.z)) / (B.z - A.z) + A.x) c = !c;
    }
    return c;
  };
  // 입구가 아래를 볼 때만 (입구 바깥 법선이 아래쪽)
  let underMouth = 0;
  if (nOut.y < -0.5)
    for (let k = 0; k < pos.count; k++) {
      wv.set(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(mound.matrixWorld);
      if (wv.y - s.soil.surfaceAt(wv.x, wv.z) > 0.01 && inQuad(wv.x, wv.z)) underMouth++;
    }
  return { meshVol, shownVol: v.surHeapVol, rays, onMound, moundBeyond, underMouth, mouthDown: nOut.y < -0.5, pen, baseGap, below, ratio: v.surHeap.h / v.surHeap.run, h: v.surHeap.h };
}

function surSession(kind: 'mouthDown' | 'toothTouch' | 'photo' | 'digging') {
  if (kind === 'digging') return dug(0.3);
  const s = new DigSession(MACHINE, R, FREE, () => 0.5);
  s.belt = true;
  s.leverUnlocked = true;
  s.ready();
  for (let i = 0; i < 50; i++) s.step();
  const A = s.site.stations[0];
  const r = (A.pitIn + A.pitOut) / 2;
  const sw = s.pose.swing;
  const g = s.soil.surfaceAt(Math.cos(sw) * r, Math.sin(sw) * r);
  // 입구가 땅을 봄: 버킷 절대각 0(핀→날이 앞으로 수평, 입구 아래), 날이 지표에 닿음 / 이빨만 살짝: 날 끝 1cm 묻힘
  // photo: 사용자 사진(u2_3·u2_4)과 비슷한 자세 — 날 끝 5cm 묻힘, 버킷 절대각 -0.4rad (입구가 아래·운전석 쪽)
  const q = kind === 'mouthDown' ? ik(MACHINE, r, g + 0.0, 0) : kind === 'photo' ? ik(MACHINE, r, g - 0.05, -0.4) : ik(MACHINE, r, g - 0.01, -0.9);
  s.setPose({ ...q!, swing: sw });
  return s;
}

for (const kind of ['mouthDown', 'toothTouch', 'photo', 'digging'] as const)
  it(`날 앞 덧쌓임 더미: ${kind} — 입구로 안 보이고, 버킷에 안 파고들고, 땅에 붙고, 납작한 판이 아님`, async () => {
    for (const V of [0.0005, 0.003, 0.0045, 0.02]) for (const push of [false, true]) {
      const r = await heapCheck(surSession(kind), V, push);
      const tag = `${kind} V${V} ${push ? 'push' : 'pull'} ${JSON.stringify(r)}`;
      // 아스트라 최종 기준: 버킷 밖 더미가 입구 아래쪽을 앞에서 가리는 것은 허용, 입구 면 너머(버킷 안) 더미는 0
      expect(r.moundBeyond, tag).toBe(0);
      // 부피 보존: 그린 더미 = 시뮬 덧쌓임 부피 ±5%
      expect(Math.abs(r.meshVol / V - 1), tag).toBeLessThan(0.05);
      expect(Math.abs(r.shownVol / V - 1), tag).toBeLessThan(0.01);
      // 입구가 아래를 보는 모든 자세(바깥 법선 y < -0.5, 자세 이름과 무관): '입구 밑 흙'을 직접 셈 (toothTouch pull 반례 포함)
      expect(r.underMouth, tag).toBe(0);
      // 입구가 아래를 보는 자세(mouthDown·photo)는 운전석 광선이 입구에 안 닿을 수 있어 underMouth로, 나머지는 광선으로 판정
      if (kind === 'mouthDown' || kind === 'photo') expect(r.mouthDown, tag).toBe(true);
      else expect(r.rays, tag).toBeGreaterThan(50);
      expect(r.pen, tag).toBeLessThanOrEqual(0.02);
      expect(r.baseGap, tag).toBeLessThanOrEqual(0.02);
      expect(r.below, tag).toBeLessThanOrEqual(0.02);
      expect(r.ratio, tag).toBeGreaterThanOrEqual(0.35);
    }
  });

// 번쩍임(폰 사진 2026-11-13): 버킷을 따라 움직이는 격자로 그리던 더미는 정점이 지형 위를 미끄러져 매 프레임 지형을 뚫었다 말았다 함.
// 더미 정점은 흙 격자 정점에 고정되고, 흙 없는 정점은 지형 아래, 흙 있는 정점은 지형에서 8mm 넘게 떨어져야 함 (거의 겹친 면 없음)
it('날 앞 덧쌓임 더미: 정점이 흙 격자에 고정 (버킷이 움직여도 미끄러지지 않음)', async () => {
  const { ExcavatorView } = await import('../src/render/excavatorView');
  const s = dug(0.3);
  s.surcharge = 0.05;
  const v = new ExcavatorView(MACHINE, 'A') as any;
  const g = s.soil.gridAt(s.frame.tip.r * Math.cos(s.pose.swing), s.frame.tip.r * Math.sin(s.pose.swing))!;
  const heights = new Map<string, number>();
  for (const dr of [0, 0.013, 0.027]) {
    const q = ik(MACHINE, s.frame.tip.r + dr, s.frame.tip.y, -0.9);
    if (q) s.setPose({ ...q, swing: s.pose.swing });
    v.sync(s);
    v.root.updateMatrixWorld(true);
    const m = v.surMound as THREE.Mesh;
    expect(m.visible).toBe(true);
    const pos = m.geometry.attributes.position;
    const ix = m.geometry.index!;
    const used = new Set<number>();
    for (let k = 0; k < m.geometry.drawRange.count && k < ix.count; k++) used.add(ix.getX(k));
    const wv = new THREE.Vector3();
    for (const k of used) {
      wv.set(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(m.matrixWorld);
      const fi = (wv.x - g.ox) / g.cell;
      const fj = (wv.z - g.oz) / g.cell;
      expect(Math.abs(fi - Math.round(fi))).toBeLessThan(1e-3);
      expect(Math.abs(fj - Math.round(fj))).toBeLessThan(1e-3);
      const d = wv.y - g.h[g.idx(Math.round(fi), Math.round(fj))];
      // 땅과 거의 같은 높이(±2mm)인 정점 없음
      expect(Math.abs(d)).toBeGreaterThan(0.002);
      heights.set(`${Math.round(fi)},${Math.round(fj)}`, d);
    }
  }
  expect(heights.size).toBeGreaterThan(4);
});
