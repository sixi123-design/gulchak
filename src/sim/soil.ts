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
  readonly pit: Uint8Array;
  dirty = true;
  activeT = 0;
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
    this.pit = new Uint8Array(n);
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
  cut(k: number, y: number): number {
    const target = Math.max(y, this.floor[k]);
    const dh = this.h[k] - target;
    if (dh <= 0) return 0;
    this.h[k] = target;
    this.dirty = true;
    this.activeT = 2;
    return dh * this.area;
  }
  deposit(k: number, vol: number) {
    this.h[k] += vol / this.area;
    this.dirty = true;
    this.activeT = 2;
  }
  /** 중심 40%, 상하좌우 15%씩 나눠 쌓는다 (격자 밖 몫은 중심에) */
  depositSpread(k: number, vol: number) {
    const i = k % this.nx;
    const j = (k - i) / this.nx;
    let center = vol * 0.4;
    const share = vol * 0.15;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) center += share;
      else this.h[this.idx(ii, jj)] += share / this.area;
    }
    this.h[k] += center / this.area;
    this.dirty = true;
    this.activeT = 2;
  }
  /** 안식각 완화. 이동이 있었으면 true */
  relax(talus: number, iters: number): boolean {
    let moved = false;
    const { h, floor, nx, nz } = this;
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (i + 1 < nx) moved = this.pair(k, k + 1, talus, h, floor) || moved;
          if (j + 1 < nz) moved = this.pair(k, k + nx, talus, h, floor) || moved;
        }
      }
    }
    if (moved) this.dirty = true;
    return moved;
  }
  private pair(a: number, b: number, talus: number, h: Float32Array, floor: Float32Array): boolean {
    const diff = h[a] - h[b];
    if (diff > talus) {
      const mv = Math.min((diff - talus) * 0.25, h[a] - floor[a]);
      if (mv > 1e-6) {
        h[a] -= mv;
        h[b] += mv;
        return true;
      }
    } else if (-diff > talus) {
      const mv = Math.min((-diff - talus) * 0.25, h[b] - floor[b]);
      if (mv > 1e-6) {
        h[b] -= mv;
        h[a] += mv;
        return true;
      }
    }
    return false;
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
}

/** 지점(A·C)마다 구덩이를 포함한 격자를 만든다 */
export function makeStationGrid(s: Station, init: SoilInit): SoilGrid {
  const margin = 0.6;
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
        g.floor[k] = 0;
      }
      g.h0[k] = g.h[k];
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
  volumeDelta(): number {
    return this.grids.reduce((s, g) => s + g.volumeDelta(), 0);
  }
}
