import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Site } from '../sim/site';
import { toon } from './toon';

/**
 * 실제 시험 모드 배경: 가상의 '굴착기운전기능사 전용 실기시험장' (판정과 무관).
 * 응시 장비(노랑 차체 + 짙은 먹선)가 바로 읽히도록 배경은 노랑·금·남색·파랑을 쓰지 않는다.
 * 밝은 석재 담 + 세이지 그린 + 짙은 녹색 글자, 담 너머 다듬은 생울타리·가로수. 판타지·시계 없음.
 * 운전석 시점: 수평선 띠 = 밝은 담, 그 위 = 부드러운 초록 숲선, 그 위 = 옅은 하늘.
 * 작업장(마당) 안에는 아무것도 두지 않는다. 바닥 칠만 마당 바깥에.
 * 담 밖 벽돌 건물 3동(본관·관제탑·차고): 벽돌 + 석재 띠·머리돌로 담과 같은 언어.
 * 저가폰: 같은 색 부품은 합쳐 색당 드로우콜 1회. 텍스처 4장.
 */

const COL = {
  stone: 0xe4e1d8, // 담·기둥 (밝은 석재)
  coping: 0xf6f5f1, // 담 머리돌
  base: 0xa9b2a6, // 담 굽도리
  panel: 0x9cb5a2, // 담 벽판 (세이지)
  sage: 0x7f9e88, // 기둥 머리·띠
  deep: 0x3d6b56, // 짙은 녹색 (얇은 선·글자만)
  hedge: 0x6a9a72,
  treeA: 0x5c9468,
  treeB: 0x78ad7c,
  trunk: 0x9a8270,
  floorBand: 0x97a296,
  pad: 0xeff0eb,
  roof: 0xf4f3ef,
  chair: 0x5a625c,
  // 대기 장비: 응시 장비와 겹치지 않게 흰·회색
  idleBody: 0xe2e4e3,
  idleDark: 0x7d8580,
  idleGlass: 0xb9cfcf,
  soft: 0x7b8a80, // 은은한 외곽선
  // 벽돌 건물: 차분한 벽돌 + 석재 머리돌·띠 + 세이지빛 유리
  brick: 0xa8705c,
  glass: 0x93b3ad,
  glassTop: 0xc4dbd6,
  shutter: 0xc9cdc6,
};

/** 경기장 바닥 색 (SiteView가 땅 색으로 씀) */
export const EXAM_FLOOR = 0xa9b3a8;
/** 시험 하늘·안개 (main.ts가 실제 시험에서만 씀) */
export const EXAM_SKY = { top: 0x86bfe0, horizon: 0xe6f1ee, fogNear: 45, fogFar: 140 };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const FONT = 'system-ui, "Malgun Gothic", sans-serif';

/** 정문 현판: 흰 바탕 + 녹색 테·글자 */
function gateTexture() {
  return canvasTex(1024, 256, (g) => {
    g.fillStyle = '#f6f5f1';
    g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = '#3d6b56';
    g.lineWidth = 10;
    g.strokeRect(16, 16, 992, 224);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#5f8a72';
    g.font = `800 54px ${FONT}`;
    g.fillText('굴착기운전기능사', 512, 84);
    g.fillStyle = '#2f5a46';
    g.font = `900 88px ${FONT}`;
    g.fillText('실기시험장', 512, 168);
  });
}

/** 안내판: 시험명만 (시계·수험번호 없음) */
function boardTexture(task: string) {
  return canvasTex(512, 256, (g) => {
    g.fillStyle = '#f6f5f1';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#3d6b56';
    g.fillRect(0, 0, 512, 84);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = `800 44px ${FONT}`;
    g.fillText('굴착기운전기능사', 256, 44);
    g.fillStyle = '#2f5a46';
    g.font = `900 80px ${FONT}`;
    g.fillText(task, 256, 172);
  });
}

/** 심사위원석 판: 문장(방패+버킷) + '심사위원석' */
function crestTexture() {
  return canvasTex(256, 320, (g) => {
    g.fillStyle = '#f6f5f1';
    g.fillRect(0, 0, 256, 320);
    const shield = new Path2D('M128 18 L222 52 L212 158 Q198 226 128 260 Q58 226 44 158 L34 52 Z');
    g.fillStyle = '#3d6b56';
    g.fill(shield);
    g.lineWidth = 8;
    g.strokeStyle = '#9cb5a2';
    g.stroke(shield);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(84, 100);
    g.lineTo(172, 100);
    g.quadraticCurveTo(180, 172, 128, 184);
    g.lineTo(84, 184);
    g.closePath();
    g.fill();
    for (const x of [90, 112, 134]) {
      g.beginPath();
      g.moveTo(x, 184);
      g.lineTo(x + 17, 184);
      g.lineTo(x + 8.5, 210);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#2f5a46';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 46px ${FONT}`;
    g.fillText('심사위원석', 128, 292);
  });
}

/** 색별 부품 모음 → 색당 메시 1개. 은은한 외곽선(뒷면 확대 상자)도 한 메시로 */
class Parts {
  private byColor = new Map<number, THREE.BufferGeometry[]>();
  private ink: THREE.BufferGeometry[] = [];
  /** 설정하면 이후 추가하는 조각에 이 변환을 더 적용 (한 덩어리를 통째로 돌려 놓을 때) */
  xf: THREE.Matrix4 | null = null;
  /** ol: 외곽선 두께(m). 0이면 없음 */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, ry = 0, ol = 0) {
    this.add(new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z), color);
    if (ol > 0) {
      const g = new THREE.BoxGeometry(w + 2 * ol, h + 2 * ol, d + 2 * ol).rotateY(ry).translate(x, y, z);
      if (this.xf) g.applyMatrix4(this.xf);
      this.ink.push(Parts.strip(g));
    }
  }
  add(g: THREE.BufferGeometry, color: number) {
    if (this.xf) g.applyMatrix4(this.xf);
    const list = this.byColor.get(color) ?? [];
    list.push(Parts.strip(g));
    this.byColor.set(color, list);
  }
  private static strip(g: THREE.BufferGeometry) {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    return n;
  }
  build(parent: THREE.Object3D) {
    for (const [color, geos] of this.byColor) parent.add(new THREE.Mesh(mergeGeometries(geos), toon(color)));
    if (this.ink.length) {
      const o = new THREE.Mesh(mergeGeometries(this.ink), new THREE.MeshBasicMaterial({ color: COL.soft, side: THREE.BackSide }));
      o.renderOrder = -1;
      parent.add(o);
    }
  }
}

const WALL_H = 2.8;

/** 담 한 구간 (a→b): 석재 담 + 굽도리 + 머리돌 + 세이지 벽판 리듬 (안쪽 면에) */
function wall(P: Parts, ax: number, az: number, bx: number, bz: number) {
  const L = Math.hypot(bx - ax, bz - az);
  const ry = -Math.atan2(bz - az, bx - ax);
  const ux = (bx - ax) / L;
  const uz = (bz - az) / L;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  // 안쪽(마당 쪽) 법선
  const flip = -uz * (0 - mx) + ux * (2.5 - mz) < 0 ? -1 : 1;
  const nx = -uz * flip;
  const nz = ux * flip;
  P.box(L, WALL_H, 0.5, mx, WALL_H / 2, mz, COL.stone, ry, 0.03);
  P.box(L + 0.04, 0.4, 0.56, mx, 0.2, mz, COL.base, ry);
  P.box(L + 0.1, 0.18, 0.7, mx, WALL_H + 0.09, mz, COL.coping, ry, 0.03);
  const n = Math.max(1, Math.round(L / 5));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const px = ax + (bx - ax) * t + nx * 0.27;
    const pz = az + (bz - az) * t + nz * 0.27;
    P.box((L / n) * 0.72, 1.3, 0.06, px, 1.45, pz, COL.panel, ry);
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = ax + (bx - ax) * t + nx * 0.1;
    const pz = az + (bz - az) * t + nz * 0.1;
    P.box(0.6, WALL_H + 0.3, 0.7, px, (WALL_H + 0.3) / 2, pz, COL.stone, ry, 0.03);
    P.box(0.7, 0.16, 0.8, px, WALL_H + 0.38, pz, COL.sage, ry);
  }
}

/** 둥글게 다듬은 가로수 (각진 툰 덩어리) */
function tree(P: Parts, x: number, z: number, h: number, color: number) {
  P.add(new THREE.CylinderGeometry(0.16, 0.22, h * 0.45, 6).translate(x, (h * 0.45) / 2, z), COL.trunk);
  const r = h * 0.3;
  P.add(new THREE.IcosahedronGeometry(r, 0).scale(1, 1.25, 1).translate(x, h - r * 1.1, z), color);
}

/** 대기 굴착기 (흰·회색 도색). ry=0이면 -z를 봄 */
function idleExcavator(P: Parts, wx: number, wz: number, ry = 0) {
  P.xf = new THREE.Matrix4().makeRotationY(ry).setPosition(wx, 0, wz);
  const x = 0;
  const z = 0;
  const Y = COL.idleBody;
  const D = COL.idleDark;
  P.box(2.4, 0.5, 3.2, x, 0.55, z, D);
  for (const dx of [-1.05, 1.05]) for (const dz of [-1.0, 1.0]) P.add(new THREE.CylinderGeometry(0.42, 0.42, 0.4, 10).rotateZ(Math.PI / 2).translate(x + dx, 0.42, z + dz), D);
  P.box(2.5, 0.9, 3.0, x, 1.3, z + 0.3, Y, 0, 0.03);
  P.box(2.5, 0.8, 0.7, x, 1.25, z + 1.9, D);
  P.box(1.0, 1.4, 1.2, x - 0.65, 2.45, z - 0.5, Y, 0, 0.03);
  P.box(0.95, 0.9, 0.05, x - 0.65, 2.55, z - 1.12, COL.idleGlass);
  const seg = (y0: number, z0: number, y1: number, z1: number, w: number, t: number) => {
    const L = Math.hypot(y1 - y0, z1 - z0);
    P.add(new THREE.BoxGeometry(w, t, L).rotateX(Math.atan2(-(y1 - y0), z1 - z0)).translate(x + 0.35, (y0 + y1) / 2, z + (z0 + z1) / 2), Y);
  };
  seg(1.6, -1.1, 3.7, -3.0, 0.42, 0.5);
  seg(3.7, -3.0, 1.0, -4.0, 0.34, 0.36);
  P.box(1.0, 0.75, 0.85, x + 0.35, 0.45, z - 4.2, D);
  P.xf = null;
}

/** 본관 간판: '실기시험장' */
function signTexture() {
  return canvasTex(512, 128, (g) => {
    g.fillStyle = '#f6f5f1';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#2f5a46';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 76px ${FONT}`;
    g.fillText('실기시험장', 256, 68);
  });
}

/**
 * 벽돌 덩어리 (축 정렬): 층마다 사방으로 두른 띠창 + 석재 창턱, 위 석재 파라펫 + 세이지 머리돌.
 * 벽돌 무늬 없음. 층고 3.2m.
 */
function brickMass(P: Parts, x: number, z: number, w: number, d: number, floors: number, base = 0) {
  const FH = 3.2;
  const h = floors * FH;
  P.box(w, h, d, x, base + h / 2, z, COL.brick, 0, 0.06);
  for (let f = 0; f < floors; f++) {
    const y = base + f * FH;
    P.box(w + 0.1, 1.1, d + 0.1, x, y + 1.75, z, COL.glass);
    P.box(w + 0.18, 0.2, d + 0.18, x, y + 1.12, z, COL.stone);
  }
  P.box(w + 0.3, 0.5, d + 0.3, x, base + h + 0.25, z, COL.stone, 0, 0.04);
  P.box(w + 0.4, 0.14, d + 0.4, x, base + h + 0.55, z, COL.sage);
  P.box(w + 0.12, 0.35, d + 0.12, x, base + 0.17, z, COL.base);
  return base + h + 0.6;
}

/** 하늘 돔: 꼭대기 옅은 하늘색 → 지평선 거의 흰색 (안개 무시, 깊이 안 씀) */
/** 하늘 돔 색칠: 꼭대기 → 지평선 */
function paintSky(g: THREE.BufferGeometry, top: THREE.Color, hor: THREE.Color) {
  const R = 100;
  const pos = g.getAttribute('position');
  let ca = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!ca) {
    ca = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
    g.setAttribute('color', ca);
  }
  const col = ca.array as Float32Array;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / R / 0.6));
    c.copy(hor).lerp(top, Math.pow(t, 0.6));
    col.set([c.r, c.g, c.b], i * 3);
  }
  ca.needsUpdate = true;
}

/** 하늘 돔: 꼭대기 옅은 하늘색 → 지평선 거의 흰색 (안개 무시, 깊이 안 씀) */
function skyDome() {
  const g = new THREE.SphereGeometry(100, 16, 10);
  paintSky(g, new THREE.Color(EXAM_SKY.top), new THREE.Color(EXAM_SKY.horizon));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10;
  m.frustumCulled = false;
  m.userData.examSky = true;
  return m;
}

/** 시각·계절 색을 시험장에 입힘: 하늘 돔(root 아래 전부) · 나무 · 생울타리 · 바닥 */
export function paintExamSite(root: THREE.Object3D, look: { skyTop: THREE.Color; skyHorizon: THREE.Color; foliage: { treeA: number; treeB: number; hedge: number }; floor: number }) {
  root.traverse((o) => {
    if (o.userData.examSky) paintSky((o as THREE.Mesh).geometry, look.skyTop, look.skyHorizon);
  });
  // 나무·울타리·바닥 재질은 시험장 전용 색이라 공유 재질 색만 바꿈
  toon(COL.treeA).color.setHex(look.foliage.treeA);
  toon(COL.treeB).color.setHex(look.foliage.treeB);
  toon(COL.hedge).color.setHex(look.foliage.hedge);
  toon(EXAM_FLOOR).color.setHex(look.floor);
}

const IDLE_X = 18.4;

export function buildExamSurroundings(site: Site, task = '굴착작업'): THREE.Group {
  const group = new THREE.Group();
  group.add(skyDome());
  const P = new Parts();
  const reach = site.reach;
  const text = (tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
    return m;
  };

  // ---------- 시험장 크기 ----------
  const [X0, X1, Z0, Z1] = [-21, 21, -15, 20];

  // ---------- 바닥 칠 (마당 바깥만): 흰 패드 · 세이지 선 · 담 앞 띠 ----------
  // 마당: x ±12, z -6 ~ 11 (SiteView yard)
  const ring = (x0: number, x1: number, z0: number, z1: number, w: number, y: number, color: number) => {
    P.box(x1 - x0 + 2 * w, 0.02, w, (x0 + x1) / 2, y, z0 - w / 2, color);
    P.box(x1 - x0 + 2 * w, 0.02, w, (x0 + x1) / 2, y, z1 + w / 2, color);
    P.box(w, 0.02, z1 - z0, x0 - w / 2, y, (z0 + z1) / 2, color);
    P.box(w, 0.02, z1 - z0, x1 + w / 2, y, (z0 + z1) / 2, color);
  };
  ring(-12, 12, -6, 11, 1.4, 0.004, COL.pad);
  ring(-13.4, 13.4, -7.4, 12.4, 0.25, 0.004, COL.deep);
  const BW = 2.2;
  ring(X0 + BW, X1 - BW, Z0 + BW, Z1 - BW, BW, 0.003, COL.floorBand);

  // ---------- 담 (B 쪽은 정문 자리 비움) ----------
  const GX = 3; // 정문: 운전석에서 붐에 가리지 않게 B 축에서 +x로 비킴
  const GW = 4.2;
  wall(P, X0, Z0, X1, Z0);
  wall(P, X1, Z0, X1, Z1);
  wall(P, X0, Z1, X0, Z0);
  wall(P, X1, Z1, GX + GW + 0.9, Z1);
  wall(P, GX - GW - 0.9, Z1, X0, Z1);

  // ---------- 담 너머: 생울타리 + 가로수 (부드러운 초록 숲선) ----------
  const hedge = (ax: number, az: number, bx: number, bz: number) => {
    const L = Math.hypot(bx - ax, bz - az);
    P.box(L, 3.6, 1.4, (ax + bx) / 2, 1.8, (az + bz) / 2, COL.hedge, -Math.atan2(bz - az, bx - ax));
  };
  const o = 1.4;
  hedge(X0 - o, Z0 - o, X1 + o, Z0 - o);
  hedge(X1 + o, Z0 - o, X1 + o, Z1 + o);
  hedge(X0 - o, Z1 + o, X0 - o, Z0 - o);
  hedge(X1 + o, Z1 + o, GX + GW + 0.9, Z1 + o);
  hedge(GX - GW - 0.9, Z1 + o, X0 - o, Z1 + o);
  const ot = 4.2;
  let k = 0;
  const treeLine = (ax: number, az: number, bx: number, bz: number, skip?: (x: number) => boolean) => {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.round(L / 4.2);
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      if (skip?.(x)) continue;
      k++;
      tree(P, x, z, k % 2 ? 8.2 : 7.0, k % 2 ? COL.treeA : COL.treeB);
    }
  };
  treeLine(X0 - ot, Z0 - ot, X1 + ot, Z0 - ot);
  treeLine(X1 + ot, Z0 - ot + 4.2, X1 + ot, Z1 + ot);
  treeLine(X0 - ot, Z0 - ot + 4.2, X0 - ot, Z1 + ot);
  treeLine(X0 - ot + 4.2, Z1 + ot, X1 + ot - 4.2, Z1 + ot, (x) => Math.abs(x - GX) < GW + 1);

  // ---------- 정문 (B 쪽): 석재 기둥 두 개 + 흰 현판 ----------
  const gz = Z1;
  for (const dx of [GX - GW, GX + GW]) {
    P.box(1.6, 5.0, 1.6, dx, 2.5, gz, COL.stone, 0, 0.04);
    P.box(1.8, 0.3, 1.8, dx, 5.15, gz, COL.sage, 0, 0.03);
    P.box(1.8, 0.5, 1.8, dx, 0.25, gz, COL.base);
  }
  P.box(2 * GW + 1.6, 1.8, 0.9, GX, 4.0, gz, COL.stone, 0, 0.04);
  P.box(2 * GW + 1.8, 0.22, 1.0, GX, 5.0, gz, COL.sage);
  text(gateTexture(), 6.8, 1.7, GX, 4.0, gz - 0.47, Math.PI);
  // 정문까지 흰 진입로
  P.box(2 * GW - 1.6, 0.02, Z1 - 12.4, GX, 0.005, (Z1 + 12.4) / 2, COL.pad);

  // ---------- 심사위원석 (A 쪽 밖, +x를 봄): 흰 차양 정자. 붐에 가리지 않게 +z로 비킴 ----------
  const jx = -(reach + 10);
  const jz = 4.5;
  P.box(4.2, 0.6, 7, jx, 0.3, jz, COL.stone, 0, 0.03);
  for (let i = 0; i < 2; i++) P.box(0.45, 0.2 * (2 - i), 3, jx + 2.3 + i * 0.45, 0.1 * (2 - i), jz, COL.stone);
  P.box(0.9, 0.08, 5.6, jx + 1.0, 1.38, jz, COL.coping, 0, 0.02);
  P.box(0.06, 0.7, 5.6, jx + 1.45, 1.0, jz, COL.panel);
  for (const dz of [-1.8, 0, 1.8]) {
    P.box(0.55, 0.08, 0.55, jx + 0.1, 1.1, jz + dz, COL.chair);
    P.box(0.08, 0.85, 0.55, jx - 0.2, 1.5, jz + dz, COL.chair);
  }
  for (const dz of [-3.2, 3.2]) P.box(0.25, 3.6, 0.25, jx + 1.8, 2.4, jz + dz, COL.coping, 0, 0.02);
  P.box(4.8, 0.3, 7.6, jx, 4.35, jz, COL.roof, 0, 0.03);
  P.box(4.9, 0.12, 7.7, jx, 4.2, jz, COL.sage);
  // 뒤 판 + 문장
  P.box(0.3, 3.8, 6.6, jx - 1.8, 2.5, jz, COL.panel, 0, 0.03);
  text(crestTexture(), 1.85, 2.3, jx - 1.64, 3.05, jz, Math.PI / 2);

  // ---------- 안내판 (B 쪽 담 앞, 정문 왼쪽(+x). -z를 봄) ----------
  const sx = GX + GW + 6.5;
  const sz = Z1 - 1.6;
  for (const dx of [-2.1, 2.1]) P.box(0.3, 3.4, 0.3, sx + dx, 1.7, sz, COL.stone, 0, 0.03);
  P.box(5.6, 2.9, 0.4, sx, 3.9, sz, COL.stone, 0, 0.04);
  P.box(5.7, 0.16, 0.5, sx, 5.4, sz, COL.sage);
  text(boardTexture(task), 5.0, 2.5, sx, 3.9, sz - 0.21, Math.PI);

  // ---------- 대기 장비 3대 (C 너머 담 앞, 마당을 보고 나란히: C를 볼 때 운전석 왼쪽에 보임) ----------
  for (let i = 0; i < 3; i++) {
    const z = -3.2 - i * 3.6;
    P.box(6.6, 0.02, 3.2, IDLE_X - 1.4, 0.008, z, COL.floorBand);
    idleExcavator(P, IDLE_X, z, Math.PI / 2);
  }

  // ---------- 담 밖 벽돌 건물 3동 (C 쪽엔 없음). 높이·폭 제각각, 나무에 일부 가림 ----------
  // 본관 (넓은 2층): B 정문 뒤, 정문 틀 안에 현관이 보이게
  const mz = Z1 + 11;
  brickMass(P, GX, mz, 9, 7, 2, 0); // 가운데 현관동
  P.box(9.5, 1.2, 7.4, GX, 7.2, mz, COL.brick, 0, 0.05); // 현관동만 한 단 높게
  P.box(9.8, 0.4, 7.7, GX, 8.0, mz, COL.stone, 0, 0.04);
  brickMass(P, GX - 10.5, mz + 1.2, 12, 6, 2, 0); // 왼쪽 날개 (조금 뒤로)
  brickMass(P, GX + 9.5, mz + 2.2, 10, 6, 1, 0); // 오른쪽 날개 (1층, 더 뒤로)
  // 현관: 석재 포털 + 어두운 유리문 + 간판
  P.box(5.2, 3.6, 1.0, GX, 1.8, mz - 3.9, COL.stone, 0, 0.05);
  P.box(3.4, 2.6, 0.2, GX, 1.3, mz - 4.42, COL.idleDark);
  P.box(6.0, 0.3, 1.8, GX, 3.75, mz - 4.2, COL.coping, 0, 0.03);
  text(signTexture(), 4.4, 1.1, GX, 5.1, mz - 3.58, Math.PI);

  // 감독 관제탑 (높음): A 뒤, 심사위원석 옆 (+z 쪽: 붐에 가리지 않게)
  const tx = X0 - 7;
  const tz = jz + 7.5;
  const towerTop = brickMass(P, tx, tz, 4.6, 4.6, 2, 0);
  P.box(6.2, 0.3, 6.2, tx, towerTop + 0.1, tz, COL.stone, 0, 0.04); // 전망층 바닥
  P.box(5.6, 2.6, 5.6, tx, towerTop + 1.55, tz, COL.glassTop, 0, 0.05); // 유리 전망층
  for (const dx of [-2.75, 0, 2.75]) for (const dz of [-2.75, 2.75]) {
    P.box(0.18, 2.6, 0.18, tx + dx, towerTop + 1.55, tz + dz, COL.stone);
    P.box(0.18, 2.6, 0.18, tx + dz, towerTop + 1.55, tz + dx, COL.stone);
  }
  P.box(6.8, 0.45, 6.8, tx, towerTop + 3.05, tz, COL.stone, 0, 0.05); // 처마
  P.box(7.0, 0.14, 7.0, tx, towerTop + 3.3, tz, COL.sage);
  P.box(0.12, 2.2, 0.12, tx + 1.6, towerTop + 4.4, tz - 1.6, COL.idleDark); // 안테나

  // 장비 차고 (작은 1층): 대기 장비 근처 A 뒤 구석, 셔터가 담 쪽(+x)
  const cx = X0 - 9;
  const cz = -9.5;
  brickMass(P, cx, cz, 6, 8.5, 1, 0);
  for (const dz of [-2.0, 2.0]) {
    P.box(0.12, 2.6, 3.0, cx + 3.06, 1.5, cz + dz, COL.shutter, 0, 0.03);
    for (let i = 0; i < 4; i++) P.box(0.14, 0.06, 3.0, cx + 3.08, 0.6 + i * 0.6, cz + dz, COL.base);
  }

  // 건물 앞 나무 몇 그루 (불규칙): 덩어리를 일부 가리고 줄 맞춤을 깬다
  for (const [x, z, h, c] of [
    [GX - 6.5, mz - 5.5, 7.6, COL.treeB],
    [GX + 6.2, mz - 4.8, 6.4, COL.treeA],
    [GX - 15.5, mz - 2.8, 8.8, COL.treeA],
    [GX + 15, mz - 1.5, 7.2, COL.treeB],
    [tx - 2.0, tz + 4.4, 7.8, COL.treeB],
    [tx - 4.0, tz - 3.6, 6.6, COL.treeA],
    [cx - 2.5, cz + 6.2, 7.4, COL.treeA],
  ] as const)
    tree(P, x, z, h, c);

  P.build(group);
  return group;
}
