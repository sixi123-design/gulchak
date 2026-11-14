import { describe, expect, it } from 'vitest';
import { bucketSoilGeometry, bucketSoilSections } from '../src/render/bucketSoil';

describe('버킷 고봉 메시', () => {
  it('평적 초과분은 입구 위로 솟고 폭 양끝보다 가운데가 높다', () => {
    const geo = bucketSoilGeometry([[0, 0], [1, 0], [1, 0.5], [0, 0.5]], 1, 1, {
      packed: 1.2,
      loose: 0,
      tilt: 0,
    });
    expect(geo.heap).not.toBeNull();
    const p = geo.heap!.getAttribute('position');
    let centerY = Infinity;
    let edgeY = Infinity;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      if (Math.abs(z) < 0.01) centerY = Math.min(centerY, p.getY(i));
      if (Math.abs(z) > 0.46) edgeY = Math.min(edgeY, p.getY(i));
    }
    expect(centerY).toBeLessThan(-0.12); // 넘친 0.2 × 단면 0.5 = 0.1을 실제 양대로 (가운데 약 0.16)
    expect(edgeY - centerY).toBeGreaterThan(0.12);
    geo.packed?.dispose();
    geo.loose?.dispose();
    geo.heap?.dispose();
  });
});

describe('버킷 흙 메시 부피 = 실제 양', () => {
  // 메시 부피 (닫힌 메시: 발산 정리)
  const vol = (g: import('three').BufferGeometry | null) => {
    if (!g) return 0;
    const p = g.getAttribute('position');
    const ix = g.getIndex()!;
    let v = 0;
    for (let t = 0; t < ix.count; t += 3) {
      const [a, b, c] = [ix.getX(t), ix.getX(t + 1), ix.getX(t + 2)];
      const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
      const bx = p.getX(b), by = p.getY(b), bz = p.getZ(b);
      const cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    return Math.abs(v);
  };
  // D자 단면 (입구 y=0.02, 안쪽 +y)
  const cav: [number, number][] = [[0.06, 0.02], [1.05, 0.02]];
  for (let i = 0; i <= 16; i++) {
    const a = (Math.PI * i) / 16;
    cav.push([0.555 + 0.5 * Math.cos(a), 0.02 + 0.5 * Math.sin(a)]);
  }
  const W = 1;
  const Wi = W * 0.94;
  let A = 0;
  for (let i = 0; i < cav.length; i++) {
    const [x1, y1] = cav[i];
    const [x2, y2] = cav[(i + 1) % cav.length];
    A += x1 * y2 - x2 * y1;
  }
  A = Math.abs(A) / 2;
  for (const [packed, loose] of [[0.3, 0], [0.58, 0], [0.9, 0], [1.2, 0], [0.2, 0.3], [0, 0.1], [0, 0.4], [0.5, 0.2], [0.85, 0.3]] as const) {
    it(`안쪽 ${packed} · 입구 ${loose}: 보이는 흙 부피가 실제 양의 ±5% 안`, () => {
      const g = bucketSoilGeometry(cav, 1.15, W, { packed, loose, tilt: 0 });
      const shown = vol(g.packed) + vol(g.loose) + vol(g.heap);
      const want = (packed + loose) * A * Wi * 0.97;
      expect(Math.abs(shown / want - 1)).toBeLessThan(0.05);
    });
  }
  // 버킷이 기울어도 흙은 중력을 따름: 단면의 모든 흙 면(안쪽 흙 표면·입구 흙의 무너진 면·고봉 방향)이
  // 수평에서 안식각(35°)보다 가파르지 않고, 보이는 부피도 그대로 (낮은 적재·덜 들어간 흙·고봉 포함)
  const REPOSE_DEG = 35;
  const slopeDeg = (pts: [number, number][], tilt: number) => {
    // 중력 기준 좌표: 위 g = 입구 바깥(0,-1)을 tilt만큼 돌린 것, 가로 h ⟂ g. 최소제곱 직선의 기울기
    const g = [Math.sin(tilt), -Math.cos(tilt)];
    const h = [-g[1], g[0]];
    const xs = pts.map((q) => q[0] * h[0] + q[1] * h[1]);
    const ys = pts.map((q) => q[0] * g[0] + q[1] * g[1]);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxx = 0;
    let sxy = 0;
    for (let k = 0; k < xs.length; k++) {
      sxx += (xs[k] - mx) ** 2;
      sxy += (xs[k] - mx) * (ys[k] - my);
    }
    return sxx < 1e-6 ? 90 : (Math.atan(Math.abs(sxy / sxx)) * 180) / Math.PI;
  };
  const surf = (poly: { p: [number, number]; kind: number }[]) => poly.filter((v) => v.kind === 1).map((v) => v.p);
  for (const deg of [-80, -50, -25, 0, 25, 50, 80])
    for (const [packed, loose] of [[0.1, 0], [0.5, 0], [0.9, 0], [0.2, 0.3], [0.5, 0.4], [1.2, 0]] as const) {
      it(`버킷 ${deg}° · 안쪽 ${packed} · 입구 ${loose}: 흙 면이 수평에서 35° 이내, 부피 ±5%`, () => {
        const tilt = (deg * Math.PI) / 180;
        const sec = bucketSoilSections(cav, { packed, loose, tilt });
        const ps = surf(sec.packedPoly);
        if (ps.length >= 2) expect(slopeDeg(ps, tilt)).toBeLessThan(REPOSE_DEG + 1);
        const ls = surf(sec.loosePoly);
        if (ls.length >= 2) expect(slopeDeg(ls, tilt)).toBeLessThan(REPOSE_DEG + 1);
        // 고봉은 u 방향으로 솟음: u가 중력 위에서 35° 이내
        if (sec.heapSec) {
          const g = [Math.sin(tilt), -Math.cos(tilt)];
          const ang = (Math.acos(Math.max(-1, Math.min(1, sec.u[0] * g[0] + sec.u[1] * g[1]))) * 180) / Math.PI;
          expect(ang).toBeLessThan(REPOSE_DEG + 1);
        }
        const g = bucketSoilGeometry(cav, 1.15, W, { packed, loose, tilt });
        const shown = vol(g.packed) + vol(g.loose) + vol(g.heap);
        const want = (packed + loose) * A * Wi * 0.97;
        expect(Math.abs(shown / want - 1)).toBeLessThan(0.05);
      });
    }
});
