import type { Station } from './site';

/**
 * 높이맵 흙. 격자 꼭짓점마다 표면 높이 h와 깎을 수 없는 바닥 floor를 가진다.
 * 부피 = Σ (h - h0) × cell² 로 장부 관리.
 */
export class SoilGrid {
  readonly nx: number;
  readonly nz: number;
  readonly area: number;
  readonly h: Float32Array;
  readonly h0: Float32Array;
  readonly floor: Float32Array;
  /** 다져진 흙의 윗면: 이 아래는 깎을 수는 있지만 흘러내리지 않는다 (원래 지면, 버킷이 깎아낸 면) */
  readonly firm: Float32Array;
  readonly pit: Uint8Array;
  /** 화면 표시 전용: 평탄 중 버킷이 마지막으로 닿은 시각 (긁은 자국). 흙 계산·판정에는 쓰지 않음 */
  readonly touch: Float32Array;
  touchLast = -1e9;
  dirty = true;
  activeT = 0;
  /** relax가 볼 범위: 최근 흙이 바뀐 꼭짓점의 사각형 (ri0 > ri1이면 없음). 처음엔 전체 */
  private ri0 = 0;
  private ri1 = -1;
  private rj0 = 0;
  private rj1 = -1;
  private relaxAll = true;
  /** 꼭짓점 k의 흙이 바뀜 → 다음 relax 범위에 넣기 */
  private mark(k: number) {
    const i = k % this.nx;
    const j = (k - i) / this.nx;
    if (this.ri0 > this.ri1) {
      this.ri0 = this.ri1 = i;
      this.rj0 = this.rj1 = j;
      return;
    }
    if (i < this.ri0) this.ri0 = i;
    if (i > this.ri1) this.ri1 = i;
    if (j < this.rj0) this.rj0 = j;
    if (j > this.rj1) this.rj1 = j;
  }
  constructor(
    readonly name: string,
    readonly ox: number,
    readonly oz: number,
    readonly cell: number,
    sx: number,
    sz: number,
  ) {
    this.nx = Math.round(sx / cell) + 1;
    this.nz = Math.round(sz / cell) + 1;
    const n = this.nx * this.nz;
    this.h = new Float32Array(n);
    this.h0 = new Float32Array(n);
    this.floor = new Float32Array(n);
    this.firm = new Float32Array(n);
    this.pit = new Uint8Array(n);
    this.touch = new Float32Array(n).fill(-1e9);
    this.area = cell * cell;
  }
  idx(i: number, j: number) {
    return j * this.nx + i;
  }
  xOf(i: number) {
    return this.ox + i * this.cell;
  }
  zOf(j: number) {
    return this.oz + j * this.cell;
  }
  /** 가장 가까운 꼭짓점 인덱스, 격자 밖이면 -1 */
  cellAt(x: number, z: number): number {
    const i = Math.round((x - this.ox) / this.cell);
    const j = Math.round((z - this.oz) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return this.idx(i, j);
  }
  /** 쌍선형 보간 표면 높이 (격자 밖이면 NaN) */
  heightAt(x: number, z: number): number {
    const fx = (x - this.ox) / this.cell;
    const fz = (z - this.oz) / this.cell;
    if (fx < 0 || fz < 0 || fx > this.nx - 1 || fz > this.nz - 1) return NaN;
    const i = Math.min(Math.floor(fx), this.nx - 2);
    const j = Math.min(Math.floor(fz), this.nz - 2);
    const tx = fx - i;
    const tz = fz - j;
    const a = this.h[this.idx(i, j)];
    const b = this.h[this.idx(i + 1, j)];
    const c = this.h[this.idx(i, j + 1)];
    const d = this.h[this.idx(i + 1, j + 1)];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  /** y 높이까지 깎고 깎은 부피 반환 */
  /** 직전 cut에서 깎인 다져진 흙 부피 (굴착 저항 계산용) */
  lastFirmCut = 0;
  cut(k: number, y: number): number {
    const target = Math.max(y, this.floor[k]);
    const dh = this.h[k] - target;
    this.lastFirmCut = 0;
    if (dh <= 0) return 0;
    this.lastFirmCut = Math.max(0, Math.min(this.firm[k], this.h[k]) - target) * this.area;
    this.h[k] = target;
    if (this.firm[k] > target) this.firm[k] = target; // 깎아낸 면은 다져진 채로 남음
    this.mark(k);
    this.dirty = true;
    this.activeT = 2;
    return dh * this.area;
  }
  deposit(k: number, vol: number) {
    this.h[k] += vol / this.area;
    this.mark(k);
    this.dirty = true;
    this.activeT = 2;
  }
  /** 중심 64%, 상하좌우 9%씩 나눠 쌓는다 (무거운 흙: 떨어진 자리에 뭉쳐 쌓임. 격자 밖 몫은 중심에) */
  depositSpread(k: number, vol: number) {
    const i = k % this.nx;
    const j = (k - i) / this.nx;
    let center = vol * 0.64;
    const share = vol * 0.09;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) center += share;
      else {
        this.h[this.idx(ii, jj)] += share / this.area;
        this.mark(this.idx(ii, jj));
      }
    }
    this.h[k] += center / this.area;
    this.mark(k);
    this.dirty = true;
    this.activeT = 2;
  }
  /** 밀린 흙: 바로 앞 40%, 그 앞 20%, 앞-왼쪽·앞-오른쪽 20%씩 (날 앞에 쌓였다가 앞·옆으로 비어져 나감). 격자 밖 몫은 가장 가까운 칸에 */
  depositPushed(x: number, z: number, dx: number, dz: number, vol: number) {
    const put = (px: number, pz: number, v: number) => {
      const i = Math.max(0, Math.min(this.nx - 1, Math.round((px - this.ox) / this.cell)));
      const j = Math.max(0, Math.min(this.nz - 1, Math.round((pz - this.oz) / this.cell)));
      this.h[this.idx(i, j)] += v / this.area;
      this.mark(this.idx(i, j));
    };
    const c = this.cell * 1.2;
    put(x + dx * c, z + dz * c, vol * 0.4);
    put(x + dx * c * 2, z + dz * c * 2, vol * 0.2);
    // 옆으로: 진행 방향을 ±45° 돌린 쪽
    const r = Math.SQRT1_2;
    put(x + (dx * r - dz * r) * c, z + (dz * r + dx * r) * c, vol * 0.2);
    put(x + (dx * r + dz * r) * c, z + (dz * r - dx * r) * c, vol * 0.2);
    this.dirty = true;
    this.activeT = 2;
  }
  /**
   * 안식각 완화. 이동이 있었으면 true.
   * wallMax: 다져진 흙 벽이 한 칸 사이에서 버틸 수 있는 높이 차(m). 넘으면 벽이 무너져 흐트러진 흙으로 아래에 쌓인다
   */
  relax(talus: number, iters: number, wallMax = Infinity): boolean {
    // 흙이 바뀐 칸 근처만 본다: 안정했던 두 칸 사이는 둘 중 하나가 바뀌어야 다시 불안정해지므로,
    // 바뀐 칸 사각형 + 1칸 여유만 훑고, 이번에 움직인 칸으로 다음 반복 범위를 다시 잡는다 (흘러내림이 번지면 범위도 따라 넓어짐)
    let moved = false;
    const { h, firm, nx, nz } = this;
    for (let it = 0; it < iters; it++) {
      let i0: number, i1: number, j0: number, j1: number;
      if (this.relaxAll) {
        this.relaxAll = false;
        i0 = 0; i1 = nx - 1; j0 = 0; j1 = nz - 1;
      } else {
        if (this.ri0 > this.ri1) break; // 바뀐 칸 없음 = 안정
        i0 = Math.max(0, this.ri0 - 1); i1 = Math.min(nx - 1, this.ri1 + 1);
        j0 = Math.max(0, this.rj0 - 1); j1 = Math.min(nz - 1, this.rj1 + 1);
      }
      this.ri1 = -1;
      this.ri0 = 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i;
          if (i + 1 < nx && this.pair(k, k + 1, talus, wallMax, h, firm)) { moved = true; this.mark(k); this.mark(k + 1); }
          if (j + 1 < nz && this.pair(k, k + nx, talus, wallMax, h, firm)) { moved = true; this.mark(k); this.mark(k + nx); }
        }
      }
    }
    if (moved) this.dirty = true;
    return moved;
  }
  /** 흐트러진 흙(h - firm)은 안식각 넘으면 흐르고, 다져진 벽은 wallMax 넘으면 무너진다 */
  private pair(a: number, b: number, talus: number, wallMax: number, h: Float32Array, firm: Float32Array): boolean {
    const diff = h[a] - h[b];
    if (diff > talus) return this.slide(a, b, diff, talus, wallMax, h, firm);
    if (-diff > talus) return this.slide(b, a, -diff, talus, wallMax, h, firm);
    return false;
  }
  /** 높은 쪽 hi에서 낮은 쪽 lo로 흙 이동 */
  private slide(hi: number, lo: number, diff: number, talus: number, wallMax: number, h: Float32Array, firm: Float32Array): boolean {
    let mv = Math.min((diff - talus) * 0.25, h[hi] - firm[hi]);
    if (diff > wallMax) {
      // 벽 무너짐: 다져진 흙도 바닥(floor)까지 허물어져 흐트러진 흙이 됨 (질량 보존)
      mv = Math.max(mv, Math.min((diff - wallMax) * 0.25, h[hi] - this.floor[hi]));
    }
    if (mv <= 1e-6) return false;
    h[hi] -= mv;
    h[lo] += mv;
    if (firm[hi] > h[hi]) firm[hi] = h[hi];
    return true;
  }
  /** 초기 대비 부피 변화 (m³) */
  volumeDelta(): number {
    let s = 0;
    for (let k = 0; k < this.h.length; k++) s += this.h[k] - this.h0[k];
    return s * this.area;
  }
}

export interface SoilInit {
  cell: number;
  digSurface: number;
  digFloor: number;
  dumpFloor: number;
  /** 굴착장 격자 안의 지면도 흙이다 (이 깊이까지 깎임). 격자 밖은 단단한 바닥 */
  groundFloor: number;
}

/** 지점(A·C)마다 구덩이를 포함한 격자를 만든다 */
export function makeStationGrid(s: Station, init: SoilInit): SoilGrid {
  const margin = 1.2; // 굴착장 흙바닥 (구역선 밖 1.2m까지)
  const rho0 = s.zoneIn - margin;
  const rho1 = s.zoneOut + margin;
  const lat = s.zoneHalfW + margin;
  const x0 = Math.min(s.axis.x * rho0, s.axis.x * rho1);
  const x1 = Math.max(s.axis.x * rho0, s.axis.x * rho1);
  const g = new SoilGrid(s.name, x0, -lat, init.cell, x1 - x0, 2 * lat);
  for (let j = 0; j < g.nz; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = g.idx(i, j);
      const rho = g.xOf(i) * s.axis.x;
      const l = g.zOf(j);
      const inPit = rho >= s.pitIn - 1e-6 && rho <= s.pitOut + 1e-6 && Math.abs(l) <= s.pitHalfW + 1e-6;
      if (inPit) {
        g.pit[k] = 1;
        if (s.name === 'A') {
          g.h[k] = init.digSurface;
          g.floor[k] = init.digFloor;
        } else {
          g.h[k] = init.dumpFloor;
          g.floor[k] = init.dumpFloor;
        }
      } else {
        g.h[k] = 0;
        g.floor[k] = init.groundFloor;
      }
      g.h0[k] = g.h[k];
      g.firm[k] = g.h[k];
    }
  }
  return g;
}

export class SoilWorld {
  constructor(readonly grids: SoilGrid[]) {}
  gridAt(x: number, z: number): SoilGrid | null {
    for (const g of this.grids) if (g.cellAt(x, z) >= 0) return g;
    return null;
  }
  /** 표면 높이 (격자 밖은 지면 0) */
  surfaceAt(x: number, z: number): number {
    for (const g of this.grids) {
      const v = g.heightAt(x, z);
      if (!Number.isNaN(v)) return v;
    }
    return 0;
  }
  /** 깎을 수 없는 바닥 높이 (격자 밖은 0) */
  floorAt(x: number, z: number): number {
    const g = this.gridAt(x, z);
    if (!g) return 0;
    return g.floor[g.cellAt(x, z)];
  }
  /** 다져진(손대지 않은) 흙 높이. 흐트러진 흙은 빼고 (격자 밖은 0) */
  firmAt(x: number, z: number): number {
    const g = this.gridAt(x, z);
    if (!g) return 0;
    return g.firm[g.cellAt(x, z)];
  }
  volumeDelta(): number {
    return this.grids.reduce((s, g) => s + g.volumeDelta(), 0);
  }
}
