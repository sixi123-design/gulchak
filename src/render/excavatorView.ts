import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MachineSpec } from '../config/machine';
import type { DigSession } from '../sim/session';
import { outlineMat, PALETTE, toon } from './toon';

/**
 * 시험장 주력 14t급 휠 굴착기 3계열의 공통 구조와 색 조합.
 * 로고·회사명·모델명은 넣지 않는다 (리서치_시험장_화면.md, 큐넷 시험장별 기종 현황).
 */
export type MachineStyleKey = 'A' | 'B' | 'C';
export interface MachineStyle {
  key: MachineStyleKey;
  label: string;
  desc: string;
  body: number; // 상부·캐빈
  boom: number; // 붐·암
  lower: number; // 하부 차체
  counterweight: number;
  rim: number;
  trim: number; // 난간·프레임
  /** 캐빈 앞유리 기울기(m, 위쪽이 뒤로 들어간 정도), 앞면 둥글기 */
  cabSlope: number;
  cabRound: boolean;
  /** 카운터웨이트 모서리 둥글기 (m) */
  cwRound: number;
}

export const MACHINE_STYLES: Record<MachineStyleKey, MachineStyle> = {
  A: {
    key: 'A',
    label: 'A형',
    desc: '노랑 상부 + 남색 하부·카운터웨이트',
    body: 0xf2b01e,
    boom: 0xf2b01e,
    lower: 0x1f2a44,
    counterweight: 0x1f2a44,
    rim: 0xf2b01e,
    trim: 0x2b2a35,
    cabSlope: 0.08,
    cabRound: false,
    cwRound: 0.55,
  },
  B: {
    key: 'B',
    label: 'B형',
    desc: '노랑 상부 + 검은 붐·암·하부, 둥근 앞유리',
    body: 0xf5b800,
    boom: 0x2a2a2e,
    lower: 0x2a2a2e,
    counterweight: 0xf5b800,
    rim: 0xb9bcc2,
    trim: 0x2a2a2e,
    cabSlope: 0.16,
    cabRound: true,
    cwRound: 0.7,
  },
  C: {
    key: 'C',
    label: 'C형',
    desc: '주황빛 노랑 상부·붐·암 + 회색 하부, 각진 카운터웨이트',
    body: 0xf59a1b,
    boom: 0xf59a1b,
    lower: 0x3b3d42,
    counterweight: 0xf59a1b,
    rim: 0x8d9097,
    trim: 0x3b3d42,
    cabSlope: 0.04,
    cabRound: false,
    cwRound: 0.25,
  },
};

const CHROME = 0xd9dde2;
const CYL = 0x2d2c34;
const GLASS = PALETTE.glass;

/** 같은 색 부품을 하나로 합쳐 드로우콜을 줄이는 빌더 (외곽선도 합침) */
class Batch {
  private byColor = new Map<number, THREE.BufferGeometry[]>();
  private outlines: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, color: number, outline = 0.04) {
    const list = this.byColor.get(color) ?? [];
    list.push(geo);
    this.byColor.set(color, list);
    if (outline > 0) this.outlines.push(inflate(geo, outline));
  }
  build(parent: THREE.Object3D) {
    for (const [color, geos] of this.byColor) parent.add(new THREE.Mesh(mergeGeometries(geos.map(clean)), toon(color)));
    if (this.outlines.length) {
      const o = new THREE.Mesh(mergeGeometries(this.outlines.map(clean)), outlineMat);
      o.renderOrder = -1;
      parent.add(o);
    }
  }
}

/** mergeGeometries 호환: index·uv·normal만 남김 */
function clean(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.getAttribute('uv')) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2));
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  return n;
}

/** 외곽선용: 바운딩 박스 중심 기준으로 절대 두께만큼 키운 복제본 */
function inflate(g: THREE.BufferGeometry, t: number) {
  const o = g.clone();
  o.computeBoundingBox();
  const b = o.boundingBox!;
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3());
  o.translate(-c.x, -c.y, -c.z);
  o.scale(1 + (2 * t) / Math.max(s.x, 1e-3), 1 + (2 * t) / Math.max(s.y, 1e-3), 1 + (2 * t) / Math.max(s.z, 1e-3));
  o.translate(c.x, c.y, c.z);
  return o;
}

const boxG = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** xy 평면 윤곽을 z 방향 두께 d로 (z 중심 zc) */
function extrude(pts: [number, number][], d: number, zc = 0) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: d, bevelEnabled: false });
  return g.translate(0, 0, zc - d / 2);
}

/** 버킷 단면: 핀(0,0) → 등판 → 둥근 바닥 → 날 끝. 개구부는 -y 쪽 */
function bucketShapes(m: MachineSpec) {
  const tip = new THREE.Vector2(m.L3, 0);
  const heel = new THREE.Vector2(Math.cos(m.heelAngle) * m.heelLen, Math.sin(m.heelAngle) * m.heelLen);
  const outer: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(-0.07, 0.38),
    new THREE.Vector2(heel.x * 0.35, heel.y * 1.0),
    new THREE.Vector2(heel.x * 0.75, heel.y * 1.06),
    heel,
    new THREE.Vector2(heel.x + (tip.x - heel.x) * 0.5, heel.y * 0.52),
    tip,
  ];
  const chord = (p: THREE.Vector2) => {
    const t = THREE.MathUtils.clamp(p.dot(tip) / tip.lengthSq(), 0, 1);
    return tip.clone().multiplyScalar(t);
  };
  const inner = outer.slice(1, -1).map((p) => chord(p).lerp(p, 0.78)).reverse();
  const shell = new THREE.Shape([...outer, new THREE.Vector2(tip.x - 0.06, 0.03), ...inner, new THREE.Vector2(0.06, 0.03)]);
  const side = new THREE.Shape(outer);
  // 버킷 안쪽 공간: 입구(핀→날 끝 직선) + 안쪽 벽 곡선
  const cavity: [number, number][] = [[0.06, 0.02], [m.L3 - 0.1, 0.02], ...inner.map((p): [number, number] => [p.x, p.y])];
  return { shell, side, cavity };
}

/** 다각형을 y ≥ c 쪽만 남기고 자름 (Sutherland–Hodgman) */
function clipAbove(poly: [number, number][], c: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ain = a[1] >= c;
    const bin = b[1] >= c;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (c - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, c]);
    }
  }
  return out;
}

/** 버킷 속 흙: 안쪽을 바닥(버킷 등)부터 채우고, 평적을 넘으면 입구 위로 울퉁불퉁한 고봉 */
function soilFillGeometry(cavity: [number, number][], L3: number, W: number, fill: number) {
  const ymax = Math.max(...cavity.map((p) => p[1]));
  const parts: THREE.BufferGeometry[] = [];
  const f = Math.min(1, fill);
  const poly = clipAbove(cavity, (1 - f) * ymax);
  if (poly.length >= 3) parts.push(extrude(poly, W * 0.94));
  if (fill > 1.001) {
    // 고봉: 입구 위(-y 쪽)로 솟은 흙더미. 꼭짓점을 흔들어 흙덩이 느낌
    const h = Math.min(0.32, ((fill - 1) / 0.3) * 0.3);
    const cap = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = cap.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const n = 1 + 0.12 * Math.sin(i * 12.9898) * Math.sin(i * 78.233);
      pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n, pos.getZ(i) * n);
    }
    cap.scale(L3 * 0.4, h, W * 0.45);
    cap.rotateX(Math.PI); // 입구 바깥(-y)으로
    cap.translate(L3 * 0.5, 0.0, 0);
    parts.push(cap.toNonIndexed());
  }
  if (!parts.length) return null;
  return mergeGeometries(parts.map(clean));
}

/** 2단 유압 실린더 (통 + 크롬 막대). 부모 그룹의 xy 평면 안에서 a→b */
class Cylinder {
  readonly barrel: THREE.Mesh;
  readonly rod: THREE.Mesh;
  constructor(
    parent: THREE.Object3D,
    rBarrel: number,
    rRod: number,
    private barrelLen: number,
    readonly z: number,
  ) {
    const bg = new THREE.CylinderGeometry(rBarrel, rBarrel, 1, 10);
    const rg = new THREE.CylinderGeometry(rRod, rRod, 1, 8);
    this.barrel = new THREE.Mesh(bg, toon(CYL));
    this.rod = new THREE.Mesh(rg, toon(CHROME));
    parent.add(this.barrel, this.rod);
  }
  set(ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy) || 1e-3;
    const ang = Math.atan2(dy, dx) - Math.PI / 2;
    const bl = Math.min(this.barrelLen, L * 0.9);
    const rl = Math.max(0.05, L - bl * 0.6); // 막대는 통 안으로 들어가 겹침
    this.barrel.position.set(ax + (dx / L) * (bl / 2), ay + (dy / L) * (bl / 2), this.z);
    this.barrel.scale.set(1, bl, 1);
    this.barrel.rotation.set(0, 0, ang);
    this.rod.position.set(bx - (dx / L) * (rl / 2), by - (dy / L) * (rl / 2), this.z);
    this.rod.scale.set(1, rl, 1);
    this.rod.rotation.set(0, 0, ang);
  }
}

/** 2D 회전 */
const rot = (x: number, y: number, a: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

export class ExcavatorView {
  readonly root = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly boom = new THREE.Group();
  readonly arm = new THREE.Group();
  readonly bucket = new THREE.Group();
  readonly style: MachineStyle;
  private loadMesh: THREE.Mesh;
  private fillCache = new Map<number, THREE.BufferGeometry | null>();
  private fillKey = -1;
  private cavity: [number, number][];
  private cabParts: THREE.Object3D[] = [];
  private cabInterior: THREE.Group;
  private boomCyls: Cylinder[] = [];
  private armCyl: Cylinder;
  private bucketCyl: Cylinder;
  private links: { idler: THREE.Mesh[]; push: THREE.Mesh[] };
  /** 운전석 눈 위치 (상부 선회체 로컬): 붐 중심에서 왼쪽 0.85m, 지면에서 약 2.6m */
  static readonly EYE = new THREE.Vector3(0.32, 2.62, -0.85);
  // 링크 치수 (암 로컬): 아이들러 링크 피벗, 길이, 버킷 귀 위치, 푸시로드 길이
  private K: [number, number];
  private readonly r1 = 0.36;
  private readonly r2 = 0.42;
  private readonly ear: [number, number] = [-0.06, 0.3];

  constructor(
    private m: MachineSpec,
    styleKey: MachineStyleKey = 'A',
  ) {
    const S = (this.style = MACHINE_STYLES[styleKey]);
    this.K = [m.L2 - 0.3, 0.06];

    // ---------- 하부 주행체 (x축 방향) ----------
    const lower = new Batch();
    lower.add(boxG(3.1, 0.55, 1.45, 0, 0.98, 0), S.lower);
    lower.add(boxG(1.2, 0.3, 1.8, 0, 1.3, 0), S.lower, 0.03); // 선회 베어링 받침
    const tireG = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 16).rotateX(Math.PI / 2);
    const rimG = new THREE.CylinderGeometry(0.3, 0.3, 0.52, 12).rotateX(Math.PI / 2);
    for (const x of [-m.wheelbase / 2, m.wheelbase / 2]) {
      for (const z of [-0.98, 0.98]) {
        lower.add(tireG.clone().translate(x, 0.55, z), PALETTE.tire, 0.03);
        lower.add(rimG.clone().translate(x, 0.55, z * 1.01), S.rim, 0);
        lower.add(boxG(1.25, 0.08, 0.6, x, 1.18, z), S.lower, 0.02); // 펜더
      }
    }
    // 앞 도저 블레이드 (+x), 뒤 아웃리거 (-x)
    lower.add(boxG(0.18, 0.62, 2.5, m.wheelbase / 2 + 0.95, 0.42, 0), S.body);
    lower.add(boxG(0.7, 0.14, 0.5, m.wheelbase / 2 + 0.6, 0.72, -0.6), S.lower, 0.02);
    lower.add(boxG(0.7, 0.14, 0.5, m.wheelbase / 2 + 0.6, 0.72, 0.6), S.lower, 0.02);
    for (const z of [-1.0, 1.0]) {
      const leg = new THREE.BoxGeometry(0.9, 0.16, 0.22).rotateY(z > 0 ? -0.5 : 0.5).rotateZ(-0.45);
      lower.add(leg.translate(-m.wheelbase / 2 - 0.85, 0.62, z * 1.05), S.body);
      lower.add(boxG(0.4, 0.06, 0.4, -m.wheelbase / 2 - 1.2, 0.2, z * 1.25), S.lower, 0.02);
    }
    lower.build(this.root);

    // ---------- 상부 선회체 (로컬 +x = 작업 방향, -z = 운전석 쪽) ----------
    this.root.add(this.upper);
    const up = new Batch();
    up.add(boxG(3.3, 0.16, 2.45, -0.55, 1.5, 0), S.trim, 0.02); // 선회 프레임
    // 카운터웨이트: 위에서 본 모서리를 둥글린 판을 세로로 세움
    {
      const r = S.cwRound;
      const x0 = -2.75;
      const x1 = -1.95;
      const zh = 1.22;
      const sh = new THREE.Shape();
      sh.moveTo(x1, -zh);
      sh.lineTo(x0 + r, -zh);
      sh.quadraticCurveTo(x0, -zh, x0, -zh + r);
      sh.lineTo(x0, zh - r);
      sh.quadraticCurveTo(x0, zh, x0 + r, zh);
      sh.lineTo(x1, zh);
      sh.lineTo(x1, -zh);
      const cw = new THREE.ExtrudeGeometry(sh, { depth: 1.0, bevelEnabled: false, curveSegments: 6 });
      cw.rotateX(Math.PI / 2); // shape의 y → z, 두께는 아래(-y)로
      cw.translate(0, 2.4, 0);
      up.add(cw, S.counterweight);
    }
    up.add(boxG(1.75, 0.82, 2.3, -1.05, 1.98, 0.05), S.body); // 엔진 후드
    up.add(boxG(1.55, 0.95, 0.72, 0.35, 2.03, 0.82), S.body); // 오른쪽 탱크·공구함 (붐 오른쪽)
    up.add(boxG(1.35, 0.12, 1.0, 0.35, 1.52, -0.85), S.trim, 0.02); // 운전석 받침
    // 난간
    up.add(boxG(1.4, 0.05, 0.05, -1.0, 2.62, 1.12), S.trim, 0);
    for (const x of [-1.6, -0.4]) up.add(boxG(0.05, 0.3, 0.05, x, 2.47, 1.12), S.trim, 0);
    up.add(boxG(0.14, 0.55, 0.14, -1.6, 2.65, 0.6), S.trim, 0); // 배기구
    up.build(this.upper);

    // 운전석: 옆에서 본 윤곽을 두께 0.95로 (앞유리 기울기·둥글기는 계열별)
    const cabPts: [number, number][] = S.cabRound
      ? [
          [-0.35, 1.58],
          [1.0, 1.58],
          [1.05, 2.0],
          [1.02 - S.cabSlope * 0.4, 2.7],
          [1.0 - S.cabSlope, 3.08],
          [0.85 - S.cabSlope, 3.15],
          [-0.35, 3.15],
        ]
      : [
          [-0.35, 1.58],
          [1.0, 1.58],
          [1.02, 2.0],
          [1.0 - S.cabSlope, 3.12],
          [-0.35, 3.15],
        ];
    const cab = new THREE.Mesh(extrude(cabPts, 0.95, -0.85), toon(S.body));
    const cabOut = new THREE.Mesh(inflate(cab.geometry, 0.04), outlineMat);
    cabOut.renderOrder = -1;
    cab.add(cabOut);
    this.upper.add(cab);
    // 유리: 앞유리(기울기 따라), 옆창
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 0.82),
      new THREE.MeshLambertMaterial({ color: GLASS, side: THREE.DoubleSide }),
    );
    const fx = 1.02 - S.cabSlope / 2;
    front.position.set(fx + 0.012, 2.47, -0.85);
    front.rotation.set(0, Math.PI / 2, 0);
    front.rotateX(-Math.atan2(S.cabSlope, 1.1));
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), front.material);
    side.position.set(0.32, 2.5, -1.33);
    this.upper.add(front, side);
    this.cabParts.push(cab, front, side);
    this.cabInterior = this.buildCabInterior();
    this.upper.add(this.cabInterior);

    // ---------- 붐: 꺾인 바나나형, 핀 선은 (0,0)→(L1,0) ----------
    const L1 = m.L1;
    this.boom.position.set(m.boomFoot.r, m.boomFoot.y, 0);
    this.upper.add(this.boom);
    const bm = new Batch();
    bm.add(
      extrude(
        [
          [-0.18, -0.24],
          [0.35 * L1, 0.14],
          [0.55 * L1, 0.2],
          [L1 + 0.14, -0.22],
          [L1 + 0.16, 0.2],
          [0.56 * L1, 0.84],
          [0.36 * L1, 0.82],
          [-0.18, 0.28],
        ],
        0.42,
      ),
      S.boom,
    );
    bm.add(boxG(0.36, 0.3, 0.62, 0.38 * L1, 0.16, 0), S.boom, 0.02); // 붐 실린더 연결 보스
    bm.add(boxG(0.4, 0.22, 0.2, 0.42 * L1, 0.92, 0), S.boom, 0.02); // 암 실린더 받침
    bm.build(this.boom);
    for (const z of [-0.3, 0.3]) this.boomCyls.push(new Cylinder(this.upper, 0.085, 0.05, 1.25, z));
    this.armCyl = new Cylinder(this.boom, 0.08, 0.048, 1.15, 0);

    // ---------- 암: 붐 쪽이 굵고 끝으로 가늘어짐, 뒤로 실린더 연결 브래킷 ----------
    const L2 = m.L2;
    this.arm.position.x = L1;
    this.boom.add(this.arm);
    const am = new Batch();
    am.add(
      extrude(
        [
          [-0.3, -0.28],
          [L2 + 0.08, -0.13],
          [L2 + 0.1, 0.13],
          [0.45, 0.33],
          [-0.42, 0.62],
          [-0.68, 0.46],
        ],
        0.34,
      ),
      S.boom,
    );
    am.build(this.arm);
    this.bucketCyl = new Cylinder(this.arm, 0.07, 0.042, 0.95, 0);
    // H링크: 아이들러 링크 2장, 푸시로드 2장
    const linkMat = toon(S.boom === 0x2a2a2e ? 0x3c3c42 : S.trim);
    const mkLink = (z: number) => {
      const lk = new THREE.Mesh(new THREE.BoxGeometry(1, 0.09, 0.05), linkMat);
      lk.position.z = z;
      this.arm.add(lk);
      return lk;
    };
    this.links = { idler: [mkLink(-0.2), mkLink(0.2)], push: [mkLink(-0.13), mkLink(0.13)] };

    // ---------- 버킷 ----------
    this.bucket.position.x = L2;
    this.arm.add(this.bucket);
    const W = m.bucketWidth;
    const { shell, side: bside, cavity } = bucketShapes(m);
    this.cavity = cavity;
    const bk = new Batch();
    bk.add(new THREE.ExtrudeGeometry(shell, { depth: W, bevelEnabled: false }).translate(0, 0, -W / 2), PALETTE.rust, 0.03);
    const sideG = new THREE.ExtrudeGeometry(bside, { depth: 0.06, bevelEnabled: false });
    bk.add(sideG.clone().translate(0, 0, -W / 2 - 0.06), PALETTE.rustDark, 0.02);
    bk.add(sideG.clone().translate(0, 0, W / 2), PALETTE.rustDark, 0.02);
    bk.add(boxG(0.1, 0.04, W + 0.1, m.L3 - 0.04, 0.01, 0), PALETTE.metal, 0);
    const toothG = new THREE.ConeGeometry(0.04, 0.15, 4).rotateZ(-Math.PI / 2);
    for (let i = 0; i < 5; i++) bk.add(toothG.clone().translate(m.L3 + 0.05, 0, -W / 2 + 0.08 + ((W - 0.16) * i) / 4), PALETTE.metal, 0);
    for (const z of [-0.18, 0.18]) bk.add(boxG(0.34, 0.16, 0.05, 0.05, 0.22, z), PALETTE.rustDark, 0.02);
    bk.build(this.bucket);
    this.loadMesh = new THREE.Mesh(new THREE.BufferGeometry(), toon(PALETTE.dirt));
    this.loadMesh.visible = false;
    this.bucket.add(this.loadMesh);
  }

  /** 운전석 시점: 외부 모형을 숨기고 내부 프레임(기둥·지붕·핸들·미러)을 보인다 */
  setCabView(on: boolean) {
    for (const o of this.cabParts) o.visible = !on;
    this.cabInterior.visible = on;
  }

  /** 월드 좌표: 운전석 눈, 버킷 */
  eyeWorld(out: THREE.Vector3) {
    return this.upper.localToWorld(out.copy(ExcavatorView.EYE));
  }
  bucketWorld(out: THREE.Vector3) {
    return this.bucket.localToWorld(out.set(0.55, -0.1, 0));
  }

  /** 운전석 내부: 실제 휠 굴착기 운전석 시야 구성 (리서치_시험장_화면.md 3장) */
  private buildCabInterior() {
    const g = new THREE.Group();
    g.visible = false;
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.cabin });
    const dash = new THREE.MeshBasicMaterial({ color: 0x3a3946 });
    const zc = -0.85;
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, mm: THREE.Material = mat) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mm);
      b.position.set(x, y, z);
      g.add(b);
      return b;
    };
    add(0.07, 1.6, 0.06, 1.0, 2.36, zc - 0.45); // 왼쪽 A필러
    add(0.07, 1.6, 0.07, 1.0, 2.36, zc + 0.45); // 오른쪽 A필러 (붐 쪽)
    add(0.12, 0.12, 1.0, 1.0 - this.style.cabSlope, 3.1, zc); // 위 프레임
    add(0.1, 0.12, 1.0, 1.0, 1.62, zc); // 아래 프레임 (앞유리가 바닥 근처까지)
    add(1.4, 0.06, 1.0, 0.35, 3.17, zc); // 지붕
    add(0.09, 1.6, 0.09, -0.3, 2.36, zc - 0.45);
    add(1.3, 0.1, 0.09, 0.35, 3.1, zc - 0.45);
    add(1.3, 0.45, 0.09, 0.35, 1.78, zc - 0.45);
    add(1.3, 0.1, 0.09, 0.35, 3.1, zc + 0.45);
    add(1.3, 0.5, 0.09, 0.35, 1.8, zc + 0.45);
    add(0.22, 0.16, 0.42, 0.78, 1.9, zc - 0.02, dash); // 계기판
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 6), mat);
    col.position.set(0.76, 1.97, zc - 0.02);
    col.rotation.z = 0.75;
    g.add(col);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.024, 6, 22), mat);
    wheel.position.set(0.66, 2.08, zc - 0.02);
    wheel.rotation.y = Math.PI / 2;
    wheel.rotation.x = 0.7;
    g.add(wheel);
    const mirror = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: 0x8fb4c8, side: THREE.DoubleSide }));
    mirror.position.set(1.12, 2.75, zc - 0.62);
    mirror.rotation.y = Math.PI / 2 + 0.5;
    g.add(mirror);
    add(0.2, 0.03, 0.03, 1.06, 2.75, zc - 0.52);
    for (const dz of [-0.32, 0.32]) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat);
      k.position.set(0.3, 1.97, zc + dz);
      g.add(k);
    }
    return g;
  }

  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private axA = new THREE.Vector3();
  private axB = new THREE.Vector3();

  sync(s: DigSession) {
    const p = s.pose;
    const m = this.m;
    // 차체 흔들림 + 들림
    this.axA.set(-Math.sin(p.swing), 0, Math.cos(p.swing));
    this.axB.set(Math.cos(p.swing), 0, Math.sin(p.swing));
    this.qa.setFromAxisAngle(this.axA, -s.rock.pitch + s.lift);
    this.qb.setFromAxisAngle(this.axB, s.rock.roll);
    this.root.quaternion.copy(this.qa).multiply(this.qb);
    this.upper.rotation.y = -p.swing;
    this.boom.rotation.z = p.boom;
    this.arm.rotation.z = p.arm;
    this.bucket.rotation.z = p.bucket;

    // 붐 실린더 2개: 상부 프레임(붐 발 앞 아래) → 붐 아래 보스 (상부 로컬 xy)
    const L1 = m.L1;
    const [bx, by] = rot(0.38 * L1, 0.1, p.boom);
    for (const c of this.boomCyls) c.set(m.boomFoot.r + 0.8, 1.35, m.boomFoot.r + bx, m.boomFoot.y + by);
    // 암 실린더: 붐 위 받침 → 암 뒤 브래킷 (붐 로컬)
    const [ax, ay] = rot(-0.62, 0.52, p.arm);
    this.armCyl.set(0.42 * L1, 0.98, L1 + ax, ay);
    // 버킷 링크 (암 로컬): 아이들러 K→J, 푸시로드 J→귀 E, 버킷 실린더 통 → J
    const [ex, ey] = rot(this.ear[0], this.ear[1], p.bucket);
    const E: [number, number] = [m.L2 + ex, ey];
    const J = circleHit(this.K, this.r1, E, this.r2);
    this.bucketCyl.set(0.4, 0.36, J[0], J[1]);
    for (const lk of this.links.idler) placeLink(lk, this.K, J);
    for (const lk of this.links.push) placeLink(lk, J, E);

    // 버킷 속 흙: 채움 비율을 5% 단위로 나눠 모양을 캐시
    const fill = Math.min(1.3, s.load / s.m.struckCapacity);
    const key = Math.round(fill * 20);
    if (key !== this.fillKey) {
      this.fillKey = key;
      if (!this.fillCache.has(key)) this.fillCache.set(key, key > 0 ? soilFillGeometry(this.cavity, m.L3, m.bucketWidth, key / 20) : null);
      const g = this.fillCache.get(key);
      this.loadMesh.visible = !!g;
      if (g) this.loadMesh.geometry = g;
    }
  }
}

/** 두 원(K, r1)·(E, r2)의 교점 중 위쪽 (H링크 관절). 닿지 않으면 두 점 사이 비례점 */
function circleHit(K: [number, number], r1: number, E: [number, number], r2: number): [number, number] {
  const dx = E[0] - K[0];
  const dy = E[1] - K[1];
  const d = Math.hypot(dx, dy);
  if (d < 1e-6 || d > r1 + r2 || d < Math.abs(r1 - r2)) {
    const t = r1 / (r1 + r2);
    return [K[0] + dx * t, K[1] + dy * t];
  }
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = K[0] + (dx * a) / d;
  const my = K[1] + (dy * a) / d;
  const p1: [number, number] = [mx - (dy * h) / d, my + (dx * h) / d];
  const p2: [number, number] = [mx + (dy * h) / d, my - (dx * h) / d];
  return p1[1] >= p2[1] ? p1 : p2;
}

function placeLink(lk: THREE.Mesh, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  lk.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, lk.position.z);
  lk.scale.set(Math.hypot(dx, dy) || 0.01, 1, 1);
  lk.rotation.set(0, 0, Math.atan2(dy, dx));
}
