import * as THREE from 'three';

/**
 * 버킷 속 흙 모양 (버킷 로컬 xy 단면 → 폭 방향으로 늘린 메시)
 *  - 다져진 흙(안쪽): 중력 쪽으로 고이고, 표면은 안식각까지만 기운다
 *  - 덜 들어간 흙(날 쪽): 날 근처에 덩어리로 걸려 입구 밖으로 불룩
 *  - 넘친 흙: 입구 위로 고봉
 * 입구는 핀→날 끝 직선(y≈0), 버킷 안쪽은 +y, 바깥(입구 밖)은 -y.
 */

type V2 = [number, number];
/** kind 0 = 벽(고정), 1 = 흙 표면, 2 = 고봉(base + u·h) */
interface OV {
  p: V2;
  kind: 0 | 1 | 2;
  h?: number;
}

/**
 * 흙 표면은 중력(수평)을 따르되, 다져진 흙은 버킷 쪽으로 조금 버틴다.
 * 수평에서 벗어나는 각 = 버킷 기울기의 HOLD 배, 최대 REPOSE(30°, 안식각 35°보다 조금 완만). 그보다 가파르게는 못 버팀
 * (전에는 입구 기준 ±25°로만 돌려, 버킷이 많이 기울면 흙이 버킷과 같이 기울어 보였음)
 */
const HOLD = 0.3;
const REPOSE = (30 * Math.PI) / 180;
/** 안쪽 흙이 적을 때 힐 모서리 쪽으로 기우는 각 (부호는 버킷 단면 기준) */
const PACK_LEAN = (18 * Math.PI) / 180;
const MOUTH_Y = 0.02;

function area(poly: V2[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** 반평면 n·p ≤ c 쪽만 남김. 잘린 선 위의 점은 표면(kind 1) */
function clipHalf(poly: OV[], n: V2, c: number): OV[] {
  const out: OV[] = [];
  const f = (v: OV) => v.p[0] * n[0] + v.p[1] * n[1] - c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if (fa <= 0 !== fb <= 0) {
      const t = fa / (fa - fb);
      out.push({ p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t], kind: 1 });
    }
  }
  return out;
}
const areaOf = (poly: OV[]) => Math.abs(area(poly.map((v) => v.p)));
/** 표면 점(kind 1)을 방향 d로 1만큼 밀었을 때 늘어나는 넓이 (같은 벡터로 미는 것이라 밀기 거리에 정비례) */
function pushArea(poly: OV[], d: V2): number {
  const moved = poly.map((v) => (v.kind === 1 ? [v.p[0] + d[0], v.p[1] + d[1]] : v.p) as V2);
  return Math.abs(area(moved)) - Math.abs(area(poly.map((v) => v.p)));
}

/** 넓이가 target이 되는 c를 이분법으로 */
function clipToArea(cav: OV[], n: V2, target: number): OV[] {
  return clipToAreaC(cav, n, target).poly;
}
function clipToAreaC(cav: OV[], n: V2, target: number): { poly: OV[]; c: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of cav) {
    const d = v.p[0] * n[0] + v.p[1] * n[1];
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (areaOf(clipHalf(cav, n, mid)) < target) lo = mid;
    else hi = mid;
  }
  return { poly: clipHalf(cav, n, hi), c: hi };
}

/** 표면(kind 1)끼리 잇는 긴 변을 잘게 나눔 (폭 방향 볼록·울퉁불퉁을 줄 점) */
function subdivideSurface(poly: OV[], step = 0.07): OV[] {
  const out: OV[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    out.push(a);
    if (a.kind === 1 && b.kind === 1) {
      const L = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
      const k = Math.floor(L / step);
      for (let j = 1; j < k; j++) {
        const t = j / k;
        out.push({ p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t], kind: 1 });
      }
    }
  }
  return out;
}

/** 입구 선 [a, b] 위로 솟는 고봉. u = 흙의 '위' 방향. 입구 선 위 점은 벽 취급 */
function heap(a: number, b: number, H: number, n = 12): OV[] {
  const out: OV[] = [{ p: [b, MOUTH_Y], kind: 0 }];
  for (let j = n - 1; j >= 1; j--) {
    const t = j / n;
    const h = H * Math.pow(Math.sin(Math.PI * t), 0.6);
    out.push({ p: [a + (b - a) * t, MOUTH_Y], kind: 2, h });
  }
  out.push({ p: [a, MOUTH_Y], kind: 0 });
  return out;
}

/** 흙 표면(kind 1) 선의 길이: 표면 방향 u에 수직으로 잰 폭 */
function surfLen(poly: OV[], u: V2): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of poly) {
    if (v.kind !== 1) continue;
    const d = -v.p[0] * u[1] + v.p[1] * u[0];
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return hi > lo ? hi - lo : 0;
}
/** 폭 방향 볼록 (1 - zz²)의 평균 = 2/3, 고봉 (1 - zz²)^0.8의 평균 */
const CROWN_MEAN = 2 / 3;
const HEAP_W_MEAN = (() => {
  let a = 0;
  const n = 200;
  for (let i = 0; i < n; i++) {
    const x = -1 + (2 * (i + 0.5)) / n;
    a += Math.pow(1 - x * x, 0.8);
  }
  return a / n;
})();
/** 고봉 단면(sin^0.6) 평균 높이 비율 */
const HEAP_P_MEAN = (() => {
  let a = 0;
  const n = 200;
  for (let i = 0; i < n; i++) a += Math.pow(Math.sin((Math.PI * (i + 0.5)) / n), 0.6);
  return a / n;
})();

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s) - 0.5;
};

/**
 * 단면 윤곽을 폭 W로 늘린 메시. 표면 점은 폭 가운데가 볼록(crown)하고 울퉁불퉁(rough).
 */
function sweep(outline: OV[], u: V2, W: number, crown: number, rough: number, M = 8): THREE.BufferGeometry | null {
  if (outline.length < 3) return null;
  // 반시계로 맞춤
  if (area(outline.map((v) => v.p)) < 0) outline = outline.slice().reverse();
  const N = outline.length;
  const pos: number[] = [];
  const at = (v: OV, z: number): V2 => {
    if (v.kind === 0) return v.p;
    const zz = (2 * z) / W;
    const n = rough * hash(v.p[0] * 9 + z * 3, v.p[1] * 9 - z * 5);
    // 고봉: 높이에 비례한 울퉁불퉁 (입구 아래로 파고들지 않게)
    const d = v.kind === 2 ? Math.max(0, (v.h ?? 0) * Math.pow(Math.max(0, 1 - zz * zz), 0.8) * (1 + 3 * n)) : crown * (1 - zz * zz) * (1 + 0.35 * Math.sin(z * 7 + v.p[0] * 5)) + n;
    return [v.p[0] + u[0] * d, v.p[1] + u[1] * d];
  };
  for (let k = 0; k <= M; k++) {
    const z = -W / 2 + (W * k) / M;
    for (const v of outline) {
      const q = at(v, z);
      pos.push(q[0], q[1], z);
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < M; k++) {
    for (let i = 0; i < N; i++) {
      const a = k * N + i;
      const b = k * N + ((i + 1) % N);
      const c = b + N;
      const d = a + N;
      idx.push(a, b, c, a, c, d);
    }
  }
  // 양 끝 뚜껑 (별도 정점: 각진 모서리)
  for (const [k, sign] of [
    [0, -1],
    [M, 1],
  ] as const) {
    const base = pos.length / 3;
    const ring: THREE.Vector2[] = [];
    for (let i = 0; i < N; i++) {
      const o = (k * N + i) * 3;
      pos.push(pos[o], pos[o + 1], pos[o + 2]);
      ring.push(new THREE.Vector2(pos[o], pos[o + 1]));
    }
    for (const [i, j, l] of THREE.ShapeUtils.triangulateShape(ring, [])) {
      const cw = THREE.ShapeUtils.area([ring[i], ring[j], ring[l]]) < 0;
      // +z 뚜껑은 반시계, -z 뚜껑은 시계
      if (cw === (sign > 0)) idx.push(base + i, base + l, base + j);
      else idx.push(base + i, base + j, base + l);
    }
  }
  // 입구보다 깊이 들어간 흙일수록 버킷 그늘로 어둡게 (위에서 내려다봐도 얼마나 찼는지 보이게)
  const col: number[] = [];
  for (let i = 1; i < pos.length; i += 3) {
    const k = 1 - 0.55 * Math.min(1, Math.max(0, (pos[i] - MOUTH_Y) / 0.4));
    col.push(k, k, k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface SoilParams {
  /** 다져진(안쪽) 흙, 평적 대비 비율 */
  packed: number;
  /** 덜 들어간(날 쪽) 흙, 평적 대비 비율 */
  loose: number;
  /** 중력 반대(수평 표면의 위)가 입구 바깥 방향에서 기운 각(rad). 표면은 안식각 안에서 수평을 따름 */
  tilt: number;
}

/** 입구 바깥 방향 (0,-1)을 θ만큼 돌린 단위 벡터 (버킷 로컬) */
const dirAt = (th: number): V2 => [Math.sin(th), -Math.cos(th)];

/**
 * 버킷 속 흙 단면 (버킷 로컬). 모든 흙 면은 중력 기준으로 잡는다:
 * 수평 표면의 위 = dirAt(tilt). 실제 면은 수평에서 최대 REPOSE까지만 벗어남 (버킷이 크게 기울어도 흙은 흘러내린 모양)
 */
export function bucketSoilSections(cavity: V2[], sp: SoilParams) {
  const cav: OV[] = cavity.map((p) => ({ p, kind: 0 }));
  const Ac = areaOf(cav);
  // 중력 기준으로 수평에서 벗어나는 각을 ±REPOSE로 제한한 면 방향
  const hold = (th: number) => sp.tilt + Math.max(-REPOSE, Math.min(REPOSE, th - sp.tilt));
  // 기본 표면: 다져진 흙이 버킷 쪽으로 조금 버팀 (버킷 기울기의 HOLD배)
  const t = hold(sp.tilt - sp.tilt * HOLD);
  const u: V2 = dirAt(t);
  const xL = cavity[0][0];
  const xT = cavity[1][0];

  // 다져진 흙: 안쪽부터 고임 (가득 차면 입구까지)
  // 표면 볼록함(crown)이 더하는 단면(폭 평균 2/3 × 표면 길이)만큼 덜 채워, 보이는 흙 양 = 실제 양(게이지)
  const crownP = 0.08 * Math.sqrt(Math.min(1, sp.packed));
  const packedA0 = Math.min(sp.packed, 1) * Ac * 0.97;
  let packedPoly: OV[] = [];
  let upP: V2 = u;
  // 다져진 흙 위 빈 공간 (덜 들어간 흙이 겹치지 않게 여기서만 자름)
  let rest = cav;
  if (packedA0 > Ac * 0.01) {
    // 밀려 들어간 흙은 바닥을 타고 들어가 힐 모서리(바닥과 등판이 만나는 곳)부터 쌓임:
    // 적을수록 표면이 힐 쪽으로 기울고(최대 PACK_LEAN), 다 차면 입구와 평행
    const lean = PACK_LEAN * (1 - Math.min(1, sp.packed));
    // 힐 쪽 기울임을 더해도 최종 면은 수평에서 REPOSE 안
    const up: V2 = dirAt(hold(t + lean));
    upP = up;
    let r = clipToAreaC(cav, up, packedA0);
    for (let it = 0; it < 2; it++) r = clipToAreaC(cav, up, Math.max(Ac * 0.005, packedA0 - CROWN_MEAN * crownP * surfLen(r.poly, up)));
    packedPoly = subdivideSurface(r.poly, 0.05);
    rest = clipHalf(cav, [-up[0], -up[1]], -r.c).map((v) => ({ ...v, kind: 0 as const }));
  }

  // 막 들어온 흙: 입구(날 쪽)부터 쌓임. 입구 안쪽 일부만 채우고 나머지는 날 위로 수북 (앞에만 찬 바가지)
  const looseA = sp.loose * Ac;
  const roomA = rest.length >= 3 ? areaOf(rest) * 0.97 : 0;
  // 버킷 안에 들어간 흙이므로 빈 자리가 있는 한 모두 안에 (입구 위로는 평적을 넘친 몫만)
  const inA = Math.min(looseA, roomA);
  let loosePoly: OV[] = [];
  let looseN: V2 = [0, 0];
  let x0 = xT;
  const amtL = Math.sqrt(Math.min(1, sp.loose / 0.4));
  const crownL = 0.07 * amtL;
  if (inA > Ac * 0.01) {
    // 경계면은 입구에서 안쪽으로 갈수록 날 쪽으로 비스듬히 무너진 면: 중력 기준 안식각(REPOSE) 경사.
    // (전에는 버킷 로컬 45°로 고정이라 버킷을 기울이면 이 면도 같이 돌았음)
    // 날 끝 안쪽 모서리부터 쌓임: 경계면은 수평에서 안식각(REPOSE) 안의 기울기 중 날 끝을 가장 확실히 덮는 쪽
    // (버킷이 어느 쪽으로 기울어도 날 쪽에 남음. 전에는 한 방향만 써서 날이 아래로 가면 핀 쪽에 그려졌음)
    const tx = cavity[1][0];
    const ty = cavity[1][1];
    let n: V2 = dirAt(sp.tilt - Math.PI + REPOSE);
    let best = -Infinity;
    for (const [ang, bonus] of [
      [sp.tilt + REPOSE, 0.05],
      [sp.tilt - REPOSE, 0.05],
      [sp.tilt - Math.PI + REPOSE, 0],
      [sp.tilt + Math.PI - REPOSE, 0],
    ] as const) {
      const c: V2 = dirAt(ang);
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of rest) {
        const d = v.p[0] * c[0] + v.p[1] * c[1];
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      const sc = (hi - (tx * c[0] + ty * c[1])) / Math.max(1e-6, hi - lo) + bonus;
      if (sc > best) [best, n] = [sc, c];
    }
    looseN = n;
    loosePoly = clipToArea(rest, n, inA);
    // 볼록함은 이 면의 바깥 법선(n) 방향으로 표면 점을 밀므로 그만큼 덜 채움. 더해지는 넓이는 표면 점을 n으로 1만큼 민
    // 다각형 넓이 차(밀기 거리에 정비례)로 정확히 셈 (전에는 고정 계수 0.7로 근사해 경계면 방향이 바뀌면 부피가 5~9% 어긋남)
    for (let it = 0; it < 3; it++) loosePoly = clipToArea(rest, n, Math.max(Ac * 0.005, inA - CROWN_MEAN * crownL * pushArea(loosePoly, n)));
    x0 = Math.min(...loosePoly.filter((v) => v.p[1] < MOUTH_Y + 0.05).map((v) => v.p[0]), xT);
    loosePoly = subdivideSurface(loosePoly, 0.05);
  }
  // 입구 밖으로 솟는 양: 안에 못 들어간 흙 + 넘친 흙. 밑이 흙으로 차 있는 입구 구간에만
  const outA = looseA - inA + Math.max(0, sp.packed - 1) * Ac;
  let heapSec: { a: number; b: number; H: number } | null = null;
  if (outA > Ac * 0.01) {
    const full = sp.packed >= 0.97;
    // 다 찼으면 입구 전체를 덮는 둥근 돔(고봉 용량 정의: 입구 양 끝에서 1:1 경사), 아니면 날 쪽만
    const b = xT + 0.04;
    // 너무 좁으면(입구 흙이 적을 때) 고봉이 빠져 보이는 양이 줄지 않게 최소 폭을 둠
    let a = full ? xL : Math.max(xL, Math.min(x0, b - 0.3));
    // 날 쪽만으로는 안식각을 넘어 못 쌓으면 입구 전체로 퍼짐 (보이는 양이 실제 양보다 줄지 않게)
    const need = (sp0: number) => outA / (HEAP_P_MEAN * sp0 * HEAP_W_MEAN);
    if (need(b - a) > ((b - a) / 2) * Math.tan((40 * Math.PI) / 180)) a = xL;
    const span = b - a;
    if (span > 0.1) {
      // 단면 sin^0.6 평균(HEAP_P_MEAN)·폭 방향 (1-zz²)^0.8 평균(HEAP_W_MEAN)으로 넓이를 맞춤.
      // 고봉 높이는 실제 양대로 (단면·폭 방향 평균으로 정확히). 높이는 안식각(40°) 삼각형을 넘지 않게
      // 고봉은 u(중력 쪽 위) 방향으로 솟으므로 입구에 수직인 몫은 cos t: 기울어도 보이는 양 = 실제 양
      const c = Math.max(0.3, -u[1]);
      const H = Math.min((span / 2) * Math.tan((40 * Math.PI) / 180), outA / (HEAP_P_MEAN * span * HEAP_W_MEAN)) / c;
      heapSec = { a, b, H };
    }
  }
  return { packedPoly, loosePoly, heapSec, u, upP, looseN, crownP, crownL, amtL };
}

/** 단면 cavity(입구 + 안쪽 벽)와 버킷 폭 W로 흙 두 덩어리 메시를 만든다 */
export function bucketSoilGeometry(cavity: V2[], L3: number, W: number, sp: SoilParams) {
  const sec = bucketSoilSections(cavity, sp);
  const { u, crownP, crownL, amtL } = sec;
  const Wi = W * 0.94;
  const heapGeo = sec.heapSec ? sweep(heap(sec.heapSec.a, sec.heapSec.b, sec.heapSec.H), u, Wi, 0, sp.loose > 0.05 ? 0.06 : 0.03) : null;
  // 볼록함·울퉁불퉁함은 흙 양에 비례 (적은 흙이 바닥 전체를 덮은 것처럼 보이지 않게)
  const amtP = Math.sqrt(Math.min(1, sp.packed));
  // 볼록함은 각 면의 바깥 법선 방향으로 (부피 보정과 같은 방향이라 기울어도 보이는 양 = 실제 양)
  const packedGeo = sweep(sec.packedPoly, sec.upP, Wi, crownP, 0.025 * amtP);
  const looseGeo = sweep(sec.loosePoly, sec.looseN, Wi, crownL, 0.06 * amtL);
  void L3;
  return { packed: packedGeo, loose: looseGeo, heap: heapGeo };
}

/** 날 앞에서 밀려 올라와 넘어 들어오는 흙 둔덕 (높이 1 기준, 입구 바깥 -y로). 크기는 mesh.scale.y로 */
export function lipMoundGeometry(cavity: V2[], W: number) {
  const xT = cavity[1][0];
  return sweep(heap(xT - 0.28, xT + 0.1, 1, 8), [0, -1], W * 0.7, 0, 0.12);
}

