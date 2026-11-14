import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bucketSoilGeometry, lipMoundGeometry } from './bucketSoil';
import type { MachineSpec } from '../config/machine';
import type { DigSession } from '../sim/session';
import type { SoilGrid } from '../sim/soil';
import { fk } from '../sim/kinematics';
import { gradientMap, outlineMat, PALETTE, toon } from './toon';

/**
 * 시험장 주력 14t급 휠 굴착기 3계열의 공통 구조와 색 조합.
 * 로고·회사명·모델명은 넣지 않는다 (리서치_시험장_화면.md, 큐넷 시험장별 기종 현황).
 */
export type MachineStyleKey = 'A' | 'B' | 'C';
/** 튜토리얼 공간에서 쓰는 겉모습. 시험장 기종 목록(sites.json)에는 없다 */
export type LookKey = MachineStyleKey | 'T';
export interface MachineStyle {
  key: LookKey;
  label: string;
  desc: string;
  body: number; // 상부·캐빈
  boom: number; // 붐·암
  lower: number; // 하부 차체
  counterweight: number;
  /** 카운터웨이트 아래쪽 띠 색 (없으면 한 색) */
  cwLower?: number;
  /** 아래 띠 높이 (m) */
  cwBand?: number;
  rim: number;
  trim: number; // 난간·프레임
  /** 캐빈 앞유리 기울기(m, 위쪽이 뒤로 들어간 정도), 앞면 둥글기 */
  /** 유압 실린더 통 (없으면 CYL 검정). 튜토리얼 장비는 글자를 가리지 않게 밝은 회색 */
  cyl?: number;
  /** 캐빈 창틀 (없으면 기본 짙은 회색) */
  frame?: number;
  cabSlope: number;
  cabRound: boolean;
  /** 카운터웨이트 모서리 둥글기 (m) */
  cwRound: number;
}

/**
 * 시험장 주력 3기종의 겉모습 (제조사 카탈로그·시험장 사진 기준 색 근사). 로고·회사 마크는 넣지 않음.
 * 크기·조작감은 셋 다 같음 (src/config/machine.ts). 시험장 목록(sites.json)의 style과 같은 키.
 *  A 현대 HW145 계열: 노랑 상부·붐·암, 짙은 남색 하부·카운터웨이트, 검은 휠, 곧은 앞유리
 *  B 두산 DX140W 계열: 주황 상부·붐·암·카운터웨이트, 짙은 회색 하부, 검은 휠, 둥근 앞면
 *  C 볼보 EW145B 계열: 노랑 상부, 짙은 회색 붐·암·하부, 카운터웨이트 아래 회색 면, 노랑 림, 큰 유리
 */
/**
 * 레버 익히기(튜토리얼 공간)용 겉모습. A형과 같은 노랑 상부에, 검정·남색이던
 * 하부·카운터웨이트·림·난간을 밝은 회색으로. 배경이 한 색이라 검정 덩어리가
 * 있으면 글자와 부딪힌다.
 */
export const TUTOR_LOOK: MachineStyle = {
  key: 'T',
  label: '배우기용',
  desc: '검정 없이 밝은 회색 하부',
  body: 0xf2b51c,
  boom: 0xf2b51c,
  lower: 0x9aa4ae,
  counterweight: 0x9aa4ae,
  rim: 0xb9c2ca,
  trim: 0x8e97a1,
  cyl: 0xb3bcc4,
  frame: 0xa8b2ba,
  cabSlope: 0.08,
  cabRound: false,
  cwRound: 0.55,
};

export const MACHINE_STYLES: Record<MachineStyleKey, MachineStyle> = {
  A: {
    key: 'A',
    label: 'A형 · 노랑/남색',
    desc: '노랑 상부·붐·암 + 남색 하부·카운터웨이트',
    body: 0xf2b51c,
    boom: 0xf2b51c,
    lower: 0x253044,
    // 실제 HW145: 뒤 카운터웨이트 전체가 짙은 남색, 휠도 검정 (국내 매물 사진)
    counterweight: 0x253044,
    rim: 0x2e3340,
    trim: 0x2b2a35,
    cabSlope: 0.08,
    cabRound: false,
    cwRound: 0.55,
  },
  B: {
    key: 'B',
    label: 'B형 · 주황',
    desc: '주황 상부·붐·암·카운터웨이트 + 짙은 회색 하부, 둥근 앞면',
    body: 0xe97821,
    boom: 0xe97821,
    lower: 0x414247,
    counterweight: 0xe97821,
    rim: 0x34363c, // 실제 DX140W-5: 검은 휠
    trim: 0x34353a,
    cabSlope: 0.14,
    cabRound: true,
    cwRound: 0.8,
  },
  C: {
    key: 'C',
    label: 'C형 · 노랑/검은 붐',
    desc: '노랑 상부 + 짙은 회색 붐·암·하부, 카운터웨이트 아래 회색 면',
    body: 0xe8b51d,
    boom: 0x303238,
    lower: 0x3a3c42,
    counterweight: 0xe8b51d,
    cwLower: 0x4a4d55,
    cwBand: 0.7,
    rim: 0xe8b51d,
    trim: 0x2a2b30,
    cabSlope: 0.06,
    cabRound: false,
    cwRound: 0.95,
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

/** 모서리를 깎은 상자 (b: 깎는 폭). 장난감 같은 날 선 상자 대신 */
function bevelBox(w: number, h: number, d: number, x: number, y: number, z: number, b = 0.06) {
  const hw = w / 2 - b;
  const hh = h / 2 - b;
  const sh = new THREE.Shape([new THREE.Vector2(-hw, -hh), new THREE.Vector2(hw, -hh), new THREE.Vector2(hw, hh), new THREE.Vector2(-hw, hh)]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1 });
  return g.translate(x, y, z - (d - 2 * b) / 2);
}

/** 윤곽을 모서리 깎아 두께 d로 (붐·암 상자 단면 느낌). 윤곽은 b만큼 커짐 */
function extrudeBevel(pts: [number, number][], d: number, b: number, zc = 0) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), {
    depth: d - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
  });
  return g.translate(0, 0, zc - (d - 2 * b) / 2);
}

/** z축 원통 (핀·보스): 반지름 r, 폭 w, 중심 (x, y, z) */
const pinG = (r: number, w: number, x: number, y: number, z = 0, seg = 14) => new THREE.CylinderGeometry(r, r, w, seg).rotateX(Math.PI / 2).translate(x, y, z);

/** 유압 호스: xy 평면 점들을 지나는 관 (z 고정) */
function hoseG(pts: [number, number][], z: number, r = 0.028) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, z)));
  return new THREE.TubeGeometry(curve, 24, r, 5, false);
}

/** 두 점 사이 가는 봉 (난간·손잡이) */
function barG(a: [number, number, number], b: [number, number, number], r = 0.025) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  return new THREE.CylinderGeometry(r, r, d.length(), 6)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()))
    .translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}

const LAMP = 0xfff3c4;
const BEACON = 0xff8a1f;

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
    cyl = CYL,
  ) {
    // 통: 양 끝에 굵은 고리(헤드·캡)가 있는 선반 단면 (길이 1로 두고 늘림)
    const R = rBarrel * 1.2;
    const bg = new THREE.LatheGeometry(
      [
        [0, -0.5],
        [R, -0.5],
        [R, -0.45],
        [rBarrel, -0.43],
        [rBarrel, 0.43],
        [R, 0.45],
        [R, 0.5],
        [0.001, 0.5],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      10,
    );
    const rg = new THREE.CylinderGeometry(rRod, rRod, 1, 8);
    this.barrel = new THREE.Mesh(bg, toon(cyl));
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

/**
 * 버킷 이빨 하나 (x = 날 쪽으로 뻗는 방향, 원점 = 받침 뒤끝).
 * 받침: 날 위아래를 감싸는 두꺼운 블록 → 이빨: 폭은 조금, 두께는 많이 줄어 끝이 일자 날.
 */
function toothGeometry() {
  // [x, 반폭, 위 두께, 아래 두께] 단면을 이어 붙임
  const secs: [number, number, number, number][] = [
    [0, 0.06, 0.05, 0.045],
    [0.08, 0.062, 0.05, 0.045],
    [0.11, 0.06, 0.04, 0.035],
    [0.17, 0.055, 0.02, 0.018],
    [0.22, 0.048, 0.006, 0.006],
  ];
  const pos: number[] = [];
  const ring = (k: number) => {
    const [x, hw, up, dn] = secs[k];
    // 위쪽 모서리를 깎은 6각 단면 (z, y)
    return [
      [x, dn * -1, -hw],
      [x, dn * -1, hw],
      [x, up * 0.6, hw],
      [x, up, hw * 0.6],
      [x, up, -hw * 0.6],
      [x, up * 0.6, -hw],
    ];
  };
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let k = 0; k < secs.length - 1; k++) {
    const A = ring(k);
    const B = ring(k + 1);
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      quad(A[i], B[i], B[j], A[j]);
    }
  }
  const fan = (R: number[][], flip: boolean) => {
    for (let i = 1; i < 5; i++) pos.push(...R[0], ...(flip ? R[i + 1] : R[i]), ...(flip ? R[i] : R[i + 1]));
  };
  fan(ring(0), false);
  fan(ring(secs.length - 1), true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // 감김 방향이 섞여도 보이게: 법선을 바깥 기준으로 다시 맞춤
  g.computeVertexNormals();
  return g;
}

/** 굴러 들어가는 흙덩이 최대 개수 */
const MAX_CLUMPS = 40;

/** 덜 들어간(푸석한) 흙 색 */
const LOOSE_DIRT = 0xa8763f;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TMP_M = new THREE.Matrix4();
const TMP_V = new THREE.Vector3();

/** 주행 계기판: F·N·R (현재 단 밝게) + 주차브레이크 등(P) + 상부 고정 등 */
function drawDash(c: HTMLCanvasElement, d: { gear: 'F' | 'N' | 'R'; parking: boolean; swingLock: boolean }) {
  const g = c.getContext('2d')!;
  g.fillStyle = '#16151d';
  g.fillRect(0, 0, 256, 128);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lit: Record<string, string> = { F: '#3ee07a', N: '#ffffff', R: '#ffb02e' };
  (['F', 'N', 'R'] as const).forEach((k, i) => {
    const x = 34 + i * 48;
    const on = d.gear === k;
    g.fillStyle = on ? lit[k] : '#2c2b36';
    g.fillRect(x - 20, 14, 40, 52);
    g.fillStyle = on ? '#16151d' : '#5c5b68';
    g.font = '900 40px system-ui, sans-serif';
    g.fillText(k, x, 42);
  });
  // 주차브레이크: 빨간 원 P
  g.beginPath();
  g.arc(210, 40, 26, 0, Math.PI * 2);
  g.fillStyle = d.parking ? '#ff3b2f' : '#2c2b36';
  g.fill();
  g.fillStyle = d.parking ? '#ffffff' : '#5c5b68';
  g.font = '900 34px system-ui, sans-serif';
  g.fillText('P', 210, 42);
  // 상부 고정
  g.fillStyle = d.swingLock ? '#ffb02e' : '#2c2b36';
  g.fillRect(14, 84, 228, 34);
  g.fillStyle = d.swingLock ? '#16151d' : '#5c5b68';
  g.font = '800 24px system-ui, "Malgun Gothic", sans-serif';
  g.fillText('상부 고정', 128, 102);
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
  /** 버킷 속 흙: 다져진 흙 · 덜 들어간 흙 · 고봉 */
  private soilMeshes: THREE.Mesh[] = [];
  /** 담기는 중: 날 앞 둔덕 + 굴러 들어가는 흙덩이 */
  private lipMound!: THREE.Mesh;
  private surMound!: THREE.Mesh;
  private surShown = 0;
  private toothTip: [number, number] = [0, 0];
  /** 덧쌓임 더미 치수 (테스트·디버그용): 높이, 미는 방향 길이 */
  surHeap = { h: 0, run: 0 };
  /** 그린 덧쌓임 더미의 지표 위 부피 (시뮬 surcharge와 같아야 함, 테스트용) */
  surHeapVol = 0;
  private surOutline: Float32Array | null = null;
  private surPts: Float32Array | null = null;
  private surTmp = new THREE.Vector3();
  private surDist: Float32Array | null = null;
  private surBase: Float32Array | null = null;
  private surBump: Float32Array | null = null;
  private surInv = new THREE.Matrix4();
  /** 화면에 올라간 지형 높이 (SoilView가 넣어 줌. 없으면 시뮬 높이) */
  soilShown?: (g: SoilGrid) => ArrayLike<number>;
  private surLift: Float32Array | null = null;
  private clumps!: THREE.InstancedMesh;
  private clumpState: { t: number; life: number; x0: number; z: number; x1: number; y1: number; sz: number; spin: number }[] = [];
  private intake = 0;
  private lastLoad = 0;
  private lastT = 0;
  private spawnAcc = 0;
  private cm = new THREE.Matrix4();
  private cq = new THREE.Quaternion();
  private ce = new THREE.Euler();
  private cp = new THREE.Vector3();
  private cs = new THREE.Vector3();
  private fillCache = new Map<number, ReturnType<typeof bucketSoilGeometry>>();
  /** 버킷 흙 모양 캐시 해제 (화면에 안 붙은 것도 GPU에 올라가 있을 수 있음). 모델을 버리기 전에 부름 */
  disposeCache() {
    for (const g of this.fillCache.values()) for (const x of [g.packed, g.loose, g.heap]) x?.dispose();
    this.fillCache.clear();
    this.fillKey = -1;
  }
  private fillKey = -1;
  private cavity: [number, number][];
  private cabParts: THREE.Object3D[] = [];
  private cabInterior: THREE.Group;
  /** 바퀴 4개: steer(앞바퀴만 꺾임) 안에 spin(굴러감) */
  private wheels: { steer: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  /** 주행: 차체 방향(요) · 흔들림 쿼터니언 */
  private yawQ = new THREE.Quaternion();
  private rockQ = new THREE.Quaternion();
  /** 주행 위치 (굴착 모드 원점). 들림은 뒤쪽 받침을 축으로 돌므로 그만큼 옮김 */
  private basePos = new THREE.Vector3();
  private liftQ = new THREE.Quaternion();
  private pivotV = new THREE.Vector3();
  private pivotW = new THREE.Vector3();
  /** 운전석 내부: 굴착용 / 주행용 */
  private digCab!: THREE.Group;
  private driveCab!: THREE.Group;
  private driveCabOn = false;
  private cabOn = false;
  private steerWheel!: THREE.Group;
  private dashTex!: THREE.CanvasTexture;
  private dashKey = '';
  /** 왼쪽 사이드미러 거울면 (상부 바깥, 앞 왼쪽 팔). SideMirror가 렌더 결과를 붙임 */
  readonly mirrorFace: THREE.Mesh;
  private mirrorGroup = new THREE.Group();
  private mirrorCamLocal = new THREE.Matrix4();
  private mirrorSaved: boolean[] = [];
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
    styleKey: LookKey = 'A',
  ) {
    const S = (this.style = styleKey === 'T' ? TUTOR_LOOK : MACHINE_STYLES[styleKey]);
    this.K = [m.L2 - 0.3, 0.06];

    // ---------- 하부 주행체 (x축 방향) ----------
    const lower = new Batch();
    lower.add(bevelBox(3.1, 0.55, 1.45, 0, 0.98, 0, 0.09), S.lower);
    lower.add(bevelBox(1.2, 0.3, 1.8, 0, 1.3, 0, 0.06), S.lower, 0.03); // 선회 베어링 받침
    lower.add(new THREE.CylinderGeometry(0.98, 0.98, 0.09, 28).translate(0, 1.465, 0), PALETTE.tire, 0); // 선회 베어링 링
    // 옆 발판 (오르내리는 계단)
    for (const z of [-0.8, 0.8]) lower.add(boxG(0.5, 0.05, 0.22, -0.2, 0.62, z * 1.0), S.lower, 0.02);
    // 차축 하우징 + 둥근 흙받이 (바퀴는 굴러가고 앞바퀴는 꺾이므로 따로: buildWheel)
    const fenderShape = new THREE.Shape();
    {
      const [r0, r1, a0, a1] = [0.64, 0.71, 0.32, Math.PI - 0.32];
      fenderShape.absarc(0, 0, r1, a0, a1, false);
      fenderShape.absarc(0, 0, r0, a1, a0, true);
    }
    const fenderG = new THREE.ExtrudeGeometry(fenderShape, { depth: 0.64, bevelEnabled: false, curveSegments: 10 });
    for (const x of [-m.wheelbase / 2, m.wheelbase / 2]) {
      lower.add(boxG(0.3, 0.26, 1.5, x, 0.55, 0), S.lower, 0.02); // 차축
      lower.add(boxG(0.5, 0.36, 0.5, x, 0.72, 0), S.lower, 0.02); // 차동기 뭉치
      for (const z of [-0.98, 0.98]) {
        lower.add(fenderG.clone().translate(x, 0.55, z - 0.32), S.lower, 0.025);
        lower.add(boxG(0.5, 0.38, 0.05, x - 0.62 * Math.sign(x), 0.42, z), PALETTE.tire, 0); // 흙받이 고무
      }
    }
    // 앞 도저 블레이드 (+x)
    {
      // 도저 블레이드: 앞으로 오목한 곡면 판 + 아래 날(어두운 띠) + 위 테
      const bx = m.wheelbase / 2 + 0.95;
      lower.add(
        extrude(
          [
            [bx + 0.13, 0.12],
            [bx + 0.03, 0.3],
            [bx, 0.48],
            [bx + 0.04, 0.66],
            [bx + 0.14, 0.76],
            [bx + 0.02, 0.78],
            [bx - 0.12, 0.6],
            [bx - 0.13, 0.3],
            [bx - 0.06, 0.12],
          ],
          2.5,
        ),
        S.body,
      );
      lower.add(boxG(0.1, 0.07, 2.52, bx + 0.1, 0.12, 0), PALETTE.tire, 0);
      for (const z of [-1.25, 1.25]) lower.add(boxG(0.3, 0.6, 0.06, bx - 0.06, 0.45, z), S.body, 0.02); // 옆 귀
    }
    lower.add(boxG(0.7, 0.14, 0.5, m.wheelbase / 2 + 0.6, 0.72, -0.6), S.lower, 0.02);
    lower.add(boxG(0.7, 0.14, 0.5, m.wheelbase / 2 + 0.6, 0.72, 0.6), S.lower, 0.02);
    lower.build(this.root);
    for (const x of [m.wheelbase / 2, -m.wheelbase / 2]) for (const z of [-0.98, 0.98]) this.wheels.push(this.buildWheel(x, z, x > 0));

    // ---------- 상부 선회체 (로컬 +x = 작업 방향, -z = 운전석 쪽) ----------
    this.root.add(this.upper);
    const up = new Batch();
    up.add(bevelBox(3.3, 0.16, 2.45, -0.55, 1.5, 0, 0.04), S.trim, 0.02); // 선회 프레임
    // 카운터웨이트: 위에서 본 모서리를 둥글린 판을 세로로 세움
    {
      const r = S.cwRound;
      const x0 = S.key === 'B' ? -2.88 : -2.75; // 두산: 뒤로 더 두툼한 주물 덩어리
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
      // 아래 띠가 있으면 위(차체 색) 0.65m + 아래 띠 0.35m 두 덩어리로
      const band = S.cwLower !== undefined ? (S.cwBand ?? 0.35) : 0;
      // 두산: 위·아래 모서리도 둥글게 (주물 느낌), 볼보: 노란 윗덮개가 회색 면 위로 살짝 덮임
      const bev = S.key === 'B' ? { bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3 } : { bevelEnabled: false };
      const cw = new THREE.ExtrudeGeometry(sh, { depth: 1.0 - band - (S.key === 'B' ? 0.24 : 0), curveSegments: 6, ...bev });
      cw.rotateX(Math.PI / 2); // shape의 y → z, 두께는 아래(-y)로
      cw.translate(0, S.key === 'B' ? 2.4 - 0.12 : 2.4, 0);
      if (S.key === 'C') {
        cw.translate(2.35, 0, 0).scale(1.03, 1, 1.03).translate(-2.35, 0, 0);
      }
      up.add(cw, S.counterweight);
      if (band) {
        const cl = new THREE.ExtrudeGeometry(sh, { depth: band, bevelEnabled: false, curveSegments: 6 });
        cl.rotateX(Math.PI / 2);
        cl.translate(0, 2.4 - (1.0 - band), 0);
        up.add(cl, S.cwLower!);
      }
    }
    // 엔진 후드 (볼보는 모서리를 크게 둥글린 매끈한 덮개)
    up.add(bevelBox(1.75, 0.82, 2.3, -1.05, 1.98, 0.05, S.key === 'C' ? 0.26 : 0.12), S.body);
    up.add(bevelBox(1.55, 0.95, 0.72, 0.35, 2.03, 0.82, 0.08), S.body); // 오른쪽 탱크·공구함 (붐 오른쪽)
    up.add(boxG(1.35, 0.12, 1.0, 0.35, 1.52, -0.85), S.trim, 0.02); // 운전석 받침
    // 엔진 후드 양옆 통풍 루버 + 위 라디에이터 그릴
    for (let i = 0; i < 6; i++) {
      const x = -1.62 + i * 0.15;
      up.add(boxG(0.06, 0.36, 0.03, x, 1.98, -1.115), S.trim, 0);
      if (S.key === 'B') up.add(boxG(0.06, 0.36, 0.03, x, 1.98, 1.215), S.trim, 0);
    }
    up.add(boxG(0.7, 0.03, 0.9, -1.25, 2.395, 0.35), S.trim, 0);
    // 난간: 탱크 위 + 후드 오른쪽 가장자리 (가는 봉)
    up.add(barG([-1.75, 2.62, 1.12], [1.0, 2.82, 1.12]), S.trim, 0);
    for (const [x, y0] of [
      [-1.7, 2.39],
      [-0.6, 2.39],
      [0.2, 2.5],
      [0.95, 2.5],
    ] as const)
      up.add(barG([x, y0, 1.12], [x, 2.62 + ((x + 1.75) / 2.75) * 0.2, 1.12]), S.trim, 0);
    // 배기구: 둥근 관 + 비스듬한 캡
    up.add(new THREE.CylinderGeometry(0.07, 0.08, 0.55, 10).translate(-1.6, 2.62, 0.6), S.trim, 0.015);
    up.add(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 10).rotateZ(0.35).translate(-1.6, 2.92, 0.6), S.trim, 0);
    // 운전석 문 아래 발판 2단
    for (const y of [1.2, 0.92]) up.add(boxG(0.45, 0.04, 0.24, 0.05, y, -1.3), S.trim, 0.012);
    up.add(boxG(0.04, 0.4, 0.04, -0.17, 1.12, -1.38), S.trim, 0);
    up.add(boxG(0.04, 0.4, 0.04, 0.27, 1.12, -1.38), S.trim, 0);
    // 계열별 엔진룸·상부 모양 (같은 색끼리 합쳐지므로 드로우콜은 늘지 않음)
    if (S.key === 'A') {
      // 현대: 오른쪽 뒤 큰 측면 커버 + 촘촘한 통풍구
      up.add(bevelBox(1.3, 0.62, 0.05, -1.2, 1.96, 1.235, 0.02), S.body, 0.015);
      up.add(boxG(1.18, 0.46, 0.02, -1.2, 1.96, 1.265), S.counterweight, 0); // 통풍구 안쪽 짙은 면
      for (let i = 0; i < 9; i++) up.add(boxG(0.045, 0.46, 0.03, -1.7 + i * 0.125, 1.96, 1.28), S.body, 0);
      // 아래 공구함
      up.add(bevelBox(0.6, 0.32, 0.12, 0.6, 1.3, 1.2, 0.02), S.trim, 0.015);
    } else if (S.key === 'B') {
      // 두산: 뒷면 양끝 후미등 뭉치
      for (const z of [-0.5, 0.5]) up.add(bevelBox(0.06, 0.16, 0.3, -2.99, 2.0, z, 0.02), S.trim, 0);
      // 두산: 뒤가 높고 두툼한 엔진 덮개 + 위쪽 가드레일
      up.add(bevelBox(0.75, 0.16, 2.2, -1.55, 2.46, 0.05, 0.06), S.body, 0.02);
      for (const z of [-1.08, 1.08]) {
        up.add(barG([-1.85, 2.85, z], [-0.95, 2.85, z]), S.trim, 0);
        for (const x of [-1.85, -1.4, -0.95]) up.add(barG([x, 2.54, z], [x, 2.85, z]), S.trim, 0);
      }
    } else {
      // 볼보: 캐빈 뒤 서비스 통로 (미끄럼 방지판) + 왼쪽 난간
      up.add(boxG(0.75, 0.03, 0.62, -0.78, 2.405, -0.75), S.trim, 0.01);
      up.add(barG([-1.7, 2.75, -1.08], [-0.42, 2.75, -1.08]), S.trim, 0);
      for (const x of [-1.7, -1.05, -0.42]) up.add(barG([x, 2.39, -1.08], [x, 2.75, -1.08]), S.trim, 0);
      // 오른쪽 큰 검은 그릴 면 + 가로 살
      up.add(bevelBox(1.25, 0.5, 0.05, -1.15, 1.95, 1.225, 0.02), S.cwLower!, 0.015);
      for (let i = 0; i < 4; i++) up.add(boxG(1.15, 0.035, 0.025, -1.15, 1.77 + i * 0.12, 1.255), S.trim, 0);
    }
    up.build(this.upper);

    // 운전석: 옆에서 본 윤곽을 두께 0.95로 (앞유리 기울기·둥글기는 계열별)
    // 위 모서리(앞·뒤)는 둥글게 → 상자 대신 실제 캐빈 윤곽
    const cabPts: [number, number][] = S.cabRound
      ? [
          [-0.35, 1.58],
          [1.0, 1.58],
          [1.05, 2.0],
          [1.02 - S.cabSlope * 0.4, 2.7],
          [1.0 - S.cabSlope, 3.0],
          [0.94 - S.cabSlope, 3.11],
          [0.82 - S.cabSlope, 3.16],
          // 지붕 뒤쪽은 살짝 낮아짐 (실제 휠 굴착기 캐빈 윤곽)
          [0.2, 3.14],
          [-0.24, 3.06],
          [-0.32, 3.0],
          [-0.35, 2.92],
        ]
      : [
          [-0.35, 1.58],
          [1.0, 1.58],
          [1.02, 2.0],
          [1.0 - S.cabSlope * 0.92, 3.02],
          [0.95 - S.cabSlope, 3.12],
          [0.86 - S.cabSlope, 3.15],
          [0.2, 3.13],
          [-0.24, 3.05],
          [-0.32, 2.99],
          [-0.35, 2.91],
        ];
    // 모서리를 둥글게 깎은 캐빈 (각진 상자 대신). 깎은 폭 CB만큼 겉면이 바깥으로 나옴
    const CB = 0.045;
    const cab = new THREE.Mesh(extrudeBevel(cabPts, 0.95, CB, -0.85), toon(S.body));
    const cabOut = new THREE.Mesh(inflate(cab.geometry, 0.04), outlineMat);
    cabOut.renderOrder = -1;
    cab.add(cabOut);
    this.upper.add(cab);
    // 앞면 x(y): 윤곽의 앞쪽 선을 따라
    const frontLine = cabPts.slice(1, -1);
    const xf = (y: number) => {
      for (let i = 0; i < frontLine.length - 1; i++) {
        const [x0, y0] = frontLine[i];
        const [x1, y1] = frontLine[i + 1];
        if (y <= y1 || i === frontLine.length - 2) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0 || 1);
      }
      return frontLine[0][0];
    };
    // 유리는 겉면에 딱 붙여 기둥·테두리 안쪽에만 (밖으로 튀어나오지 않게). 뒤에 검은 고무 테두리
    const glassMat = new THREE.MeshLambertMaterial({ color: GLASS, side: THREE.DoubleSide });
    const rubberMat = new THREE.MeshBasicMaterial({ color: 0x2a2e35, side: THREE.DoubleSide });
    const zMid = -0.85;
    // 앞면 굴곡을 따라 여러 줄로 (둥근 앞유리 계열도 겉면 밖에 붙게)
    const quadFront = (y0: number, y1: number, hw: number, out: number) => {
      const N = 6;
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= N; i++) {
        const y = y0 + ((y1 - y0) * i) / N;
        pos.push(xf(y) + CB + out, y, zMid - hw, xf(y) + CB + out, y, zMid + hw);
        if (i < N) idx.push(2 * i, 2 * i + 1, 2 * i + 3, 2 * i, 2 * i + 3, 2 * i + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const front = new THREE.Mesh(quadFront(1.78, 2.98, 0.37, 0.03), glassMat);
    front.add(new THREE.Mesh(quadFront(1.74, 3.02, 0.41, 0.024), rubberMat));
    // 아래 앞유리와 위 앞유리 사이 가로 테 (실제 캐빈처럼 두 장)
    front.add(new THREE.Mesh(quadFront(2.16, 2.2, 0.41, 0.036), rubberMat));
    // 옆창: 앞쪽은 앞유리 기울기를 따라 비스듬히
    const sideShape = (x0: number, y0: number, y1: number, inset: number) =>
      new THREE.ShapeGeometry(
        new THREE.Shape([
          new THREE.Vector2(x0, y0),
          new THREE.Vector2(xf(y0) - inset, y0),
          new THREE.Vector2(xf(y1) - inset, y1),
          new THREE.Vector2(x0, y1),
        ]),
      );
    const zL = zMid - 0.475 - CB;
    // 볼보: 옆도 거의 전부 유리 + 검은 기둥 (현대·두산은 노란 면이 보임)
    const sx = S.key === 'C' ? -0.3 : -0.2;
    const side = new THREE.Mesh(sideShape(sx, S.key === 'C' ? 1.66 : 1.74, 2.98, 0.12).translate(0, 0, zL - 0.008), glassMat);
    side.add(new THREE.Mesh(sideShape(sx - 0.04, S.key === 'C' ? 1.62 : 1.7, 3.02, 0.08).translate(0, 0, zL - 0.004), rubberMat));
    // 오른쪽(붐 쪽) 창 + 뒤창
    const zR = zMid + 0.475 + CB;
    side.add(new THREE.Mesh(sideShape(0.1, 2.1, 3.0, 0.12).translate(0, 0, zR + 0.008), glassMat));
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.48).rotateY(-Math.PI / 2).translate(-0.35 - CB - 0.008, 2.6, zMid), glassMat);
    side.add(rear);
    this.upper.add(front, side);
    this.cabParts.push(cab, front, side);
    {
      // 캐빈 바깥 디테일: 지붕 차양, 문틀·손잡이, 와이퍼, 지붕 작업등, 경광등 (운전석 시점에선 숨김). 작은 부품이라 외곽선 없음
      const cx = new THREE.Group();
      const cb = new Batch();
      const top = S.cabRound ? 3.15 : 3.14;
      if (S.key === 'A') {
        cb.add(bevelBox(1.0, 0.06, 1.06, 0.48 - S.cabSlope / 2, top + 0.03, -0.85, 0.025), S.body, 0); // 낮고 평평한 지붕 덮개
        cb.add(boxG(0.4, 0.02, 0.6, 0.15, top + 0.07, -0.85), S.trim, 0); // 선루프
      } else if (S.key === 'B') {
        // 짧게 앞으로 나온 빗물 차양 + 투명 지붕창
        cb.add(bevelBox(0.32, 0.05, 1.04, 0.9 - S.cabSlope, top + 0.02, -0.85, 0.02).rotateZ(0), S.body, 0);
        cb.add(boxG(0.5, 0.02, 0.62, 0.3, top + 0.015, -0.85), S.trim, 0);
      } else {
        cb.add(bevelBox(1.25, 0.05, 1.04, 0.33 - S.cabSlope / 2, top + 0.02, -0.85, 0.02), S.body, 0); // 평평한 노란 지붕
      }
      // 문틀 (왼쪽 면)
      const zf = -0.85 - 0.475 - CB - 0.012;
      // 문틀은 가늘고 짙은 회색 (굵은 검정이면 만화처럼 보임)
      const FRAME = S.frame ?? (S.key === 'C' ? 0x1e2024 : 0x3a3f48);
      if (S.key === 'A') cb.add(boxG(1.1, 0.04, 0.025, 0.32, 2.3, zf), S.trim, 0); // 현대: 옆유리 위·아래 각진 분할
      if (S.key === 'B') {
        // 왼쪽 문 2분할 미닫이 창
        cb.add(boxG(0.03, 0.78, 0.025, 0.32, 2.6, zf), FRAME, 0);
        cb.add(boxG(1.1, 0.03, 0.025, 0.32, 2.21, zf), FRAME, 0);
      }
      const fw = S.key === 'C' ? 0.05 : 0.035; // 볼보: 검은 기둥
      cb.add(boxG(fw, 1.36, 0.025, -0.22, 2.36, zf), FRAME, 0);
      cb.add(boxG(fw, 1.36, 0.025, 0.86, 2.36, zf), FRAME, 0);
      cb.add(boxG(1.1, 0.035, 0.025, 0.32, 3.0, zf), FRAME, 0);
      cb.add(boxG(1.1, 0.035, 0.025, 0.32, 1.7, zf), FRAME, 0);
      cb.add(boxG(0.14, 0.035, 0.04, 0.72, 2.2, zf - 0.01), S.trim, 0); // 문손잡이
      cb.add(barG([0.94, 1.95, zf - 0.04], [0.94, 2.75, zf - 0.04], 0.02), S.trim, 0); // 승강 손잡이
      // 와이퍼: 앞유리 위
      cb.add(new THREE.BoxGeometry(0.02, 0.6, 0.025).rotateX(0.55).translate(xf(2.3) + CB + 0.03, 2.3, -0.75), S.trim, 0);
      // 지붕 작업등 2개 + 경광등
      for (const z of [-1.18, -0.52]) {
        cb.add(boxG(0.14, 0.1, 0.14, 0.9 - S.cabSlope, top + 0.11, z), S.trim, 0);
        cb.add(boxG(0.02, 0.07, 0.1, 0.98 - S.cabSlope, top + 0.11, z), LAMP, 0);
      }
      cb.add(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 10).translate(0.12, top + 0.06, -1.15), S.trim, 0);
      cb.add(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 10).translate(0.12, top + 0.145, -1.15), BEACON, 0);
      cb.build(cx);
      this.upper.add(cx);
      this.cabParts.push(cx);
    }
    this.cabInterior = this.buildCabInterior();
    this.upper.add(this.cabInterior);
    this.mirrorFace = this.buildMirror();

    // ---------- 붐: 꺾인 바나나형, 핀 선은 (0,0)→(L1,0) ----------
    const L1 = m.L1;
    this.boom.position.set(m.boomFoot.r, m.boomFoot.y, 0);
    this.upper.add(this.boom);
    const bm = new Batch();
    // 상자 단면 붐: 모서리를 깎아 철판 상자처럼 (윤곽은 핀 선 기준 그대로, 깎은 만큼만 커짐)
    bm.add(
      extrudeBevel(
        [
          [-0.15, -0.21],
          [0.35 * L1, 0.17],
          [0.55 * L1, 0.23],
          [L1 + 0.11, -0.19],
          [L1 + 0.13, 0.17],
          [0.56 * L1, 0.81],
          [0.36 * L1, 0.79],
          [-0.15, 0.25],
        ],
        0.42,
        0.035,
      ),
      S.boom,
    );
    // 핀 보스(굵은 원통) + 핀 머리(어두운 원판): 붐 발 · 붐 끝 · 붐 실린더 연결
    bm.add(pinG(0.24, 0.5, 0, 0.02), S.boom, 0.02);
    bm.add(pinG(0.19, 0.48, L1, 0), S.boom, 0.02);
    bm.add(pinG(0.15, 0.66, 0.38 * L1, 0.1), S.boom, 0.02);
    bm.add(boxG(0.4, 0.22, 0.2, 0.42 * L1, 0.92, 0), S.boom, 0.02); // 암 실린더 받침
    bm.add(pinG(0.09, 0.28, 0.42 * L1, 0.98), S.boom, 0);
    for (const [x, y, w] of [
      [0, 0.02, 0.6],
      [L1, 0, 0.56],
      [0.38 * L1, 0.1, 0.74],
      [0.42 * L1, 0.98, 0.32],
    ])
      bm.add(pinG(0.075, w, x, y, 0, 10), S.trim, 0);
    // 유압 호스 2줄: 붐 등을 따라 끝까지
    for (const z of [-0.13, 0.13])
      bm.add(
        hoseG(
          [
            [0.15, 0.36],
            [0.3 * L1, 0.84],
            [0.56 * L1, 0.9],
            [0.82 * L1, 0.6],
            [L1 - 0.05, 0.3],
          ],
          z,
        ),
        S.trim,
        0,
      );
    bm.build(this.boom);
    for (const z of [-0.3, 0.3]) this.boomCyls.push(new Cylinder(this.upper, 0.085, 0.05, 1.25, z, S.cyl ?? CYL));
    this.armCyl = new Cylinder(this.boom, 0.08, 0.048, 1.15, 0, S.cyl ?? CYL);

    // ---------- 암: 붐 쪽이 굵고 끝으로 가늘어짐, 뒤로 실린더 연결 브래킷 ----------
    const L2 = m.L2;
    this.arm.position.x = L1;
    this.boom.add(this.arm);
    const am = new Batch();
    am.add(
      extrudeBevel(
        [
          [-0.27, -0.25],
          [L2 + 0.05, -0.1],
          [L2 + 0.07, 0.1],
          [0.45, 0.3],
          [-0.42, 0.59],
          [-0.65, 0.43],
        ],
        0.34,
        0.03,
      ),
      S.boom,
    );
    // 핀 보스: 버킷 핀 · 암 실린더 연결 · 버킷 실린더 받침
    am.add(pinG(0.14, 0.42, L2, 0), S.boom, 0.02);
    am.add(pinG(0.12, 0.4, -0.62, 0.52), S.boom, 0.02);
    am.add(pinG(0.1, 0.4, 0.4, 0.36), S.boom, 0.02);
    for (const [x, y, w] of [
      [L2, 0, 0.5],
      [-0.62, 0.52, 0.48],
      [0.4, 0.36, 0.48],
      [0, 0, 0.44],
    ])
      am.add(pinG(0.06, w, x, y, 0, 10), S.trim, 0);
    // 양옆 보강판 (얇은 판이 살짝 튀어나옴)
    for (const z of [-0.18, 0.18]) am.add(boxG(0.9, 0.22, 0.02, 0.9, 0.05, z), S.boom, 0);
    // 호스: 암 등을 따라 버킷 실린더까지
    for (const z of [-0.1, 0.1])
      am.add(
        hoseG(
          [
            [-0.35, 0.7],
            [0.0, 0.56],
            [0.32, 0.46],
          ],
          z,
          0.025,
        ),
        S.trim,
        0,
      );
    am.build(this.arm);
    this.bucketCyl = new Cylinder(this.arm, 0.07, 0.042, 0.95, 0, this.style.cyl ?? CYL);
    // H링크: 아이들러 링크 2장, 푸시로드 2장
    // 링크는 붐·암 색. 버킷은 세 모델 공통 밝은 회색 (흙 갈색과 잘 구분되게, 실제 버킷도 모델별 차이 거의 없음)
    const linkMat = toon(S.boom);
    const bucketSide = PALETTE.rustDark;
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
    bk.add(sideG.clone().translate(0, 0, -W / 2 - 0.06), bucketSide, 0.02);
    bk.add(sideG.clone().translate(0, 0, W / 2), bucketSide, 0.02);
    // 날판·이빨은 바닥판(힐→날 끝) 연장선 방향으로 앞을 향함 (판정의 이빨 위치와 같은 방향)
    const heelP = { x: Math.cos(m.heelAngle) * m.heelLen, y: Math.sin(m.heelAngle) * m.heelLen };
    const bladeAng = Math.atan2(-heelP.y, m.L3 - heelP.x);
    bk.add(boxG(0.1, 0.04, W + 0.1, -0.04, 0.01, 0).rotateZ(bladeAng).translate(m.L3, 0, 0), PALETTE.metal, 0);
    // 이빨: 날에 끼운 받침(어댑터) + 넓적한 쐐기 (끝은 일자 날)
    const toothG = toothGeometry();
    // 받침 0.08m는 날 뒤로 덮고 0.14m 앞으로 튀어나옴 (판정 toothLen 0.12와 비슷하게)
    toothG.translate(-0.08, 0, 0).rotateZ(bladeAng);
    // 이빨 끝 (버킷 로컬): 덧쌓임 더미가 버킷·이빨 앞에 붙도록 앞 경계에 포함
    this.toothTip = [m.L3 + 0.14 * Math.cos(bladeAng), 0.005 + 0.14 * Math.sin(bladeAng)];
    for (let i = 0; i < 5; i++) bk.add(toothG.clone().translate(m.L3, 0.005, -W / 2 + 0.09 + ((W - 0.18) * i) / 4), PALETTE.metal, 0.012);
    for (const z of [-0.18, 0.18]) bk.add(boxG(0.34, 0.16, 0.05, 0.05, 0.22, z), bucketSide, 0.02);
    bk.build(this.bucket);
    // 다져진 흙은 진하게, 덜 들어간(푸석한) 흙은 밝게
    this.lipMound = new THREE.Mesh(lipMoundGeometry(cavity, W) ?? new THREE.BufferGeometry(), toon(LOOSE_DIRT));
    this.lipMound.visible = false;
    this.bucket.add(this.lipMound);
    // 날 앞 덧쌓임: 땅 위 흙더미. 매 프레임 지표를 따라 정점을 다시 잡으므로 차체(root) 좌표로 직접 씀
    this.surMound = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshToonMaterial({ color: LOOSE_DIRT, gradientMap: gradientMap(), side: THREE.DoubleSide }));
    this.surMound.visible = false;
    this.surMound.frustumCulled = false;
    this.root.add(this.surMound);
    this.clumps = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.05, 0), toon(LOOSE_DIRT), MAX_CLUMPS);
    this.clumps.count = 0;
    this.clumps.frustumCulled = false;
    this.bucket.add(this.clumps);
    this.soilMeshes = [PALETTE.dirt, LOOSE_DIRT, LOOSE_DIRT].map((c) => new THREE.MeshToonMaterial({ color: c, gradientMap: gradientMap(), vertexColors: true })).map((mat) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.visible = false;
      this.bucket.add(mesh);
      return mesh;
    });
  }

  /** 운전석 시점: 외부 모형을 숨기고 내부 프레임(기둥·지붕·핸들·미러)을 보인다 */
  /** 배우기: 부위 강조 (밝은 몸체 + 주황 테두리). 빈 배열이면 원래대로 */
  private hl: { m: THREE.Mesh; mat: THREE.Material | THREE.Material[] }[] = [];
  private static hlLine = new THREE.MeshBasicMaterial({ color: 0xff5a1f, side: THREE.BackSide });
  highlight(parts: ('boom' | 'arm' | 'bucket')[]) {
    for (const h of this.hl) h.m.material = h.mat;
    this.hl = [];
    const stop = new Set<THREE.Object3D>([this.boom, this.arm, this.bucket]);
    const fill = toon(0xfff1b0);
    const walk = (o: THREE.Object3D, top: boolean) => {
      if (!top && stop.has(o)) return; // 아래 부위(붐 안의 암 등)는 제외
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        this.hl.push({ m, mat: m.material });
        m.material = m.material === outlineMat ? ExcavatorView.hlLine : fill;
      }
      for (const c of o.children) walk(c, false);
    };
    for (const p of parts) walk(this[p], true);
  }
  setCabView(on: boolean) {
    this.cabOn = on;
    for (const o of this.cabParts) o.visible = !on;
    this.cabInterior.visible = on;
    // 굴착 운전석은 예전 실내 거울, 바깥 사이드미러는 주행 운전석·외부 시점에서
    this.mirrorGroup.visible = !on || this.driveCabOn;
  }
  /** 운전석 내부 전환: true = 주행(핸들 뭉치·계기판·사이드미러), false = 굴착 (기본) */
  setDriveCab(on: boolean) {
    this.driveCabOn = on;
    this.driveCab.visible = on;
    this.digCab.visible = !on;
    this.mirrorGroup.visible = !this.cabOn || on;
  }

  /**
   * 주행: 루트를 월드 (x, 0, z)에 두고 heading 방향으로 (로컬 +x → (cos h, 0, sin h)).
   * steer: 앞바퀴 조향각(rad, +는 왼쪽 = 로컬 -z 쪽). roll: 바퀴가 굴러간 누적 각(rad).
   * 굴착 모드는 부르지 않으므로 기본값(원점·0)은 예전과 같다.
   */
  setDrive(x: number, z: number, heading: number, steer: number, roll: number) {
    this.root.position.set(x, 0, z);
    this.basePos.set(x, 0, z);
    this.yawQ.setFromAxisAngle(Y_AXIS, -heading);
    this.root.quaternion.copy(this.yawQ).multiply(this.rockQ);
    for (const w of this.wheels) {
      w.steer.rotation.y = w.front ? steer : 0;
      w.spin.rotation.z = -roll;
    }
  }
  /** 핸들 돌림 각(rad, +는 왼쪽 = 운전자가 볼 때 반시계) */
  setSteeringWheel(angle: number) {
    this.steerWheel.rotation.y = angle;
  }
  /** 계기판: 전후진(F·N·R), 주차브레이크 등, 상부 고정 등. 값이 바뀔 때만 다시 그림 */
  setDash(d: { gear: 'F' | 'N' | 'R'; parking: boolean; swingLock: boolean }) {
    const key = `${d.gear}${+d.parking}${+d.swingLock}`;
    if (key === this.dashKey) return;
    this.dashKey = key;
    drawDash(this.dashTex.image as HTMLCanvasElement, d);
    this.dashTex.needsUpdate = true;
  }
  /** 사이드미러 가상 카메라 자세(월드): 거울 가운데에서 눈의 반사 방향을 봄 (카메라 -z가 시선) */
  mirrorPose(outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    this.upper.updateWorldMatrix(true, false);
    TMP_M.multiplyMatrices(this.upper.matrixWorld, this.mirrorCamLocal);
    TMP_M.decompose(outPos, outQuat, TMP_V);
  }
  /** 미러 렌더 동안: 실내·거울은 숨기고 바깥 캐빈은 보이게 (false면 원래대로) */
  setMirrorPass(on: boolean) {
    const objs: THREE.Object3D[] = [this.cabInterior, this.mirrorGroup, ...this.cabParts];
    if (on) {
      this.mirrorSaved = objs.map((o) => o.visible);
      this.cabInterior.visible = false;
      this.mirrorGroup.visible = false;
      for (const o of this.cabParts) o.visible = true;
    } else if (this.mirrorSaved.length) {
      objs.forEach((o, i) => (o.visible = this.mirrorSaved[i]));
      this.mirrorSaved = [];
    }
  }

  /** 바퀴 하나: 복륜 타이어(트레드 블록) + 강철 림 + 허브·너트. spin은 굴러가고 steer는 꺾임 */
  private buildWheel(x: number, z: number, front: boolean) {
    const steer = new THREE.Group();
    steer.position.set(x, 0.55, z);
    const spin = new THREE.Group();
    steer.add(spin);
    this.root.add(steer);
    const side = Math.sign(z); // 바깥 면 방향
    const b = new Batch();
    const TIRE = PALETTE.tire;
    // 복륜: 두 타이어 사이에 틈
    for (const dz of [-0.13, 0.13]) {
      b.add(new THREE.CylinderGeometry(0.53, 0.53, 0.23, 20).rotateX(Math.PI / 2).translate(0, 0, dz), TIRE, 0.025);
      // 트레드: 엇갈린 사선 블록
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = ((i + (dz > 0 ? 0.5 : 0)) / n) * Math.PI * 2;
        const lug = new THREE.BoxGeometry(0.06, 0.12, 0.15)
          .rotateY(dz > 0 ? 0.35 : -0.35)
          .translate(0.53, 0, 0)
          .rotateZ(a)
          .translate(0, 0, dz + (dz > 0 ? 0.03 : -0.03));
        b.add(lug, TIRE, 0);
      }
    }
    // 림: 바깥 면 강철 원판 + 둘레 테, 안쪽은 어두운 원판
    b.add(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 18).rotateX(Math.PI / 2).translate(0, 0, side * 0.235), this.style.rim, 0.015);
    b.add(new THREE.TorusGeometry(0.33, 0.025, 4, 18).translate(0, 0, side * 0.255), CHROME, 0);
    b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 14).rotateX(Math.PI / 2).translate(0, 0, -side * 0.235), CYL, 0);
    // 림 구멍 (굴러가는 게 보이게)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.24, Math.sin(a) * 0.24, side * 0.245), TIRE, 0);
    }
    // 허브 + 너트 8개
    b.add(new THREE.CylinderGeometry(0.13, 0.15, 0.1, 10).rotateX(Math.PI / 2).translate(0, 0, side * 0.29), CHROME, 0.015);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.add(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.17, Math.sin(a) * 0.17, side * 0.275), CHROME, 0);
    }
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8).rotateX(Math.PI / 2).translate(0, 0, side * 0.35), CYL, 0);
    b.build(spin);
    return { steer, spin, front };
  }

  /** 왼쪽 사이드미러: 캐빈 앞 왼쪽 모서리에서 뻗은 팔 + 하우징 + 거울면 (상부 로컬) */
  private buildMirror() {
    const g = this.mirrorGroup;
    this.upper.add(g);
    const E = ExcavatorView.EYE;
    const M = new THREE.Vector3(1.75, 2.45, -1.52); // 거울 가운데: 눈에서 앞 왼쪽 약 25°
    // 거울이 비출 곳: 왼쪽 뒤 바퀴·바닥선 (뒤 왼쪽 아래)
    const target = new THREE.Vector3(-4.2, 0.0, -2.7);
    const v = M.clone().sub(E).normalize();
    const r = target.clone().sub(M).normalize();
    const n = r.clone().sub(v).normalize(); // 거울 법선 (눈 쪽)
    const up = new THREE.Vector3(0, 1, 0);
    const fy = up.clone().addScaledVector(n, -up.dot(n)).normalize();
    const fx = fy.clone().cross(n);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fx, fy, n));
    const W = 0.24;
    const H = 0.34;
    const hb = new Batch();
    // 하우징: 얇은 테 + 짙은 회색 뒤판 (앞에서 볼 때 새까만 구멍처럼 보이지 않게)
    hb.add(new THREE.BoxGeometry(W + 0.03, H + 0.03, 0.06).applyQuaternion(q).translate(M.x - n.x * 0.035, M.y - n.y * 0.035, M.z - n.z * 0.035), 0x4a505a, 0.015);
    // 팔: 캐빈 앞 왼쪽 위 모서리 → 하우징 윗면 뒤 (눈에서 볼 때 거울면을 가로지르지 않게)
    const a0 = new THREE.Vector3(1.0, 2.95, -1.36);
    const a1 = M.clone().addScaledVector(fy, H / 2 + 0.01).addScaledVector(n, -0.05);
    const armV = a1.clone().sub(a0);
    const arm = new THREE.CylinderGeometry(0.025, 0.025, armV.length(), 6)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, armV.clone().normalize()))
      .translate((a0.x + a1.x) / 2, (a0.y + a1.y) / 2, (a0.z + a1.z) / 2);
    hb.add(arm, CYL, 0.012);
    hb.add(boxG(0.08, 0.12, 0.08, a0.x, a0.y, a0.z), CYL, 0.012); // 받침
    hb.build(g);
    // 거울면: 좌우 뒤집힌 UV (거울상)
    const fg = new THREE.PlaneGeometry(W, H);
    const uv = fg.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    const face = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0x9fbfd0 }));
    face.quaternion.copy(q);
    face.position.copy(M).addScaledVector(n, 0.002);
    g.add(face);
    // 가상 카메라: 거울 가운데에서 반사 방향(r)을 봄
    this.mirrorCamLocal.lookAt(M, M.clone().add(r), up).setPosition(M);
    return face;
  }

  /** 월드 좌표: 운전석 눈, 버킷 */
  /** 운전석 눈 위치. dy: 키에 따른 앉은키 차이(m) */
  eyeWorld(out: THREE.Vector3, dy = 0) {
    out.copy(ExcavatorView.EYE);
    out.y += dy;
    return this.upper.localToWorld(out);
  }
  bucketWorld(out: THREE.Vector3) {
    return this.bucket.localToWorld(out.set(0.55, -0.1, 0));
  }

  /** 운전석 내부: 실제 휠 굴착기 운전석 시야 구성 (리서치_시험장_화면.md 3장) */
  private buildCabInterior() {
    const g = new THREE.Group();
    g.visible = false;
    const mat = new THREE.MeshBasicMaterial({ color: this.style.frame ?? PALETTE.cabin });
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
    for (const dz of [-0.32, 0.32]) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat);
      k.position.set(0.3, 1.97, zc + dz);
      g.add(k);
    }
    // ----- 굴착 운전석 (예전 그대로): 작은 계기판·핸들·실내 거울 -----
    const dig = (this.digCab = new THREE.Group());
    g.add(dig);
    const addTo = (o: THREE.Mesh, x: number, y: number, z: number) => {
      o.position.set(x, y, z);
      dig.add(o);
      return o;
    };
    addTo(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.42), dash), 0.78, 1.9, zc - 0.02); // 계기판
    const col = addTo(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 6), mat), 0.76, 1.97, zc - 0.02);
    col.rotation.z = 0.75;
    const wheel = addTo(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.024, 6, 22), mat), 0.66, 2.08, zc - 0.02);
    wheel.rotation.y = Math.PI / 2;
    wheel.rotation.x = 0.7;
    const mirror = addTo(new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: 0x8fb4c8, side: THREE.DoubleSide })), 1.12, 2.75, zc - 0.62);
    mirror.rotation.y = Math.PI / 2 + 0.5;
    addTo(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), mat), 1.06, 2.75, zc - 0.52);
    // ----- 주행 운전석: 핸들 뭉치·계기판·조이스틱 콘솔·문틀·좌석 -----
    this.driveCab = this.buildDriveCab(mat, zc);
    this.driveCab.visible = false;
    g.add(this.driveCab);
    return g;
  }

  /** 주행 운전석 실내 (상부 로컬). 어두운 단색 + 밝은 손잡이로 읽히게 */
  private buildDriveCab(mat: THREE.Material, zc: number) {
    const g = new THREE.Group();
    const grey = new THREE.MeshBasicMaterial({ color: 0x4a4958 });
    const light = new THREE.MeshBasicMaterial({ color: 0x8d8c99 });
    const rubber = new THREE.MeshBasicMaterial({ color: 0x15141c });
    const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      g.add(o);
      return o;
    };
    const E = ExcavatorView.EYE;
    // 핸들 뭉치: 기둥 축이 눈 쪽으로 기울어짐 (축 = pivot 로컬 +y)
    const C = new THREE.Vector3(0.8, 2.2, zc + 0.02);
    const axis = new THREE.Vector3(-0.62, 0.78, 0).normalize();
    const pivot = new THREE.Group();
    pivot.position.copy(C);
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    g.add(pivot);
    // 기둥 + 기둥 덮개
    pivot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.75, 8).translate(0, -0.4, 0), mat));
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.16).translate(0, -0.14, 0), grey));
    const sw = (this.steerWheel = new THREE.Group());
    pivot.add(sw);
    sw.add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 6, 28).rotateX(Math.PI / 2), rubber)); // 테
    sw.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 12), grey)); // 가운데 뭉치
    sw.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.055, 10).translate(0, 0.005, 0), light));
    // 살 3개
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.BoxGeometry(0.13, 0.018, 0.035).translate(0.095, 0, 0).rotateY(Math.PI / 2 + (i * 2 * Math.PI) / 3);
      sw.add(new THREE.Mesh(spoke, grey));
    }
    // 핸들 손잡이 노브 (밝게, 돌아가는 게 보이게)
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 8).translate(0, 0.045, 0), light);
    knob.position.set(Math.cos(-0.6) * 0.17, 0, Math.sin(-0.6) * 0.17);
    sw.add(knob);
    // 계기판: 핸들 너머 경사 판 + 표시 텍스처 (눈을 봄)
    const panel = put(new THREE.BoxGeometry(0.34, 0.17, 0.04), mat, 1.0, 2.2, zc + 0.02);
    panel.lookAt(E);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    this.dashTex = new THREE.CanvasTexture(c);
    this.dashTex.colorSpace = THREE.SRGBColorSpace;
    drawDash(c, { gear: 'N', parking: true, swingLock: true });
    this.dashKey = 'N11';
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshBasicMaterial({ map: this.dashTex }));
    face.position.set(0, 0, 0.022);
    panel.add(face);
    // 조이스틱 콘솔 (좌우) + 손잡이 막대
    for (const dz of [-0.32, 0.32]) {
      put(new THREE.BoxGeometry(0.55, 0.14, 0.18), grey, 0.12, 1.86, zc + dz);
      put(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 6), mat, 0.3, 1.92, zc + dz);
    }
    // 좌석 앞 모서리
    put(new THREE.BoxGeometry(0.14, 0.12, 0.5), grey, 0.02, 1.8, zc);
    // 왼쪽 문틀: 세로 프레임 + 손잡이
    put(new THREE.BoxGeometry(0.06, 1.45, 0.06), mat, 0.62, 2.38, zc - 0.47);
    put(new THREE.BoxGeometry(0.16, 0.035, 0.035), light, 0.5, 2.25, zc - 0.43);
    // 바닥 페달 2개 (가속·브레이크)
    for (const dz of [0.1, 0.24]) {
      const ped = put(new THREE.BoxGeometry(0.03, 0.18, 0.09), grey, 0.92, 1.72, zc + dz);
      ped.rotation.z = 0.5;
    }
    return g;
  }

  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private axA = new THREE.Vector3();
  private axB = new THREE.Vector3();

  /**
   * 날 앞 덧쌓임 (시뮬 surcharge 부피 그대로): 버킷이 밀고 가는 흙을 버킷(이빨 포함) 앞 경계에 붙여 실제 지형 위에 부은 흙더미로 그림.
   * 윗면 = 꼭대기 높이 − tanφ × (날 폭 선분까지의 거리) (안식각 쐐기·원뿔). 땅이 그보다 높으면 땅이 보이고(구덩이 벽을 타고 오르지 않음),
   * 낮으면 흙이 채움(구덩이를 따라 퍼짐). 지표 위 부피가 시뮬 양과 같아지도록 꼭대기 높이를 이분법으로 구함.
   * (전: 고정 0.55m × 폭 판 → 1cm 사각 판 / 정점마다 지표 위에 모양을 더함 → 벽을 천처럼 타고 오름)
   */
  private buildSurHeap(s: DigSession, V: number) {
    const d = s.surchargeDir;
    const dl = Math.hypot(d.x, d.z) || 1;
    const fx = d.x / dl;
    const fz = d.z / dl;
    const px = -fz;
    const pz = fx;
    const t = Math.tan((s.params.reposeDeg * Math.PI) / 180);
    const W = this.m.bucketWidth;
    this.bucket.updateWorldMatrix(true, false);
    const mid = this.bucket.localToWorld(this.surTmp.set(this.m.L3 * 0.5, 0.2, 0));
    const midX = mid.x;
    const midZ = mid.z;
    const g0 = s.soil.surfaceAt(midX, midZ);
    // 평평한 땅이라면의 쐐기 높이 (뒷면 경계를 정하는 데만 씀): V = W·h²/(2tanφ)
    const hEst = Math.min(0.6, Math.sqrt((2 * V * t) / W));
    // 윤곽 변을 2cm 간격으로 잘게 (입구 변처럼 긴 변의 중간이 더미 높이를 지나가도 놓치지 않게). 버킷 로컬 점은 한 번만 만들어 둠
    if (!this.surOutline) {
      const L: number[] = [];
      for (const zz of [-W / 2, 0, W / 2]) {
        for (let i = 0; i < this.cavity.length; i++) {
          const [ax, ay] = this.cavity[i];
          const [bx, by] = this.cavity[(i + 1) % this.cavity.length];
          const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.02));
          for (let k = 0; k < n; k++) L.push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, zz);
        }
        L.push(this.toothTip[0], this.toothTip[1], zz);
      }
      this.surOutline = new Float32Array(L);
    }
    const OL = this.surOutline;
    const me = this.bucket.matrixWorld.elements;
    const np = OL.length / 3;
    const px3 = this.surPts ?? (this.surPts = new Float32Array(OL.length));
    let front = -Infinity;
    let lowest = Infinity;
    for (let k = 0; k < np; k++) {
      const x = OL[k * 3];
      const y = OL[k * 3 + 1];
      const z = OL[k * 3 + 2];
      px3[k * 3] = me[0] * x + me[4] * y + me[8] * z + me[12];
      px3[k * 3 + 1] = me[1] * x + me[5] * y + me[9] * z + me[13];
      px3[k * 3 + 2] = me[2] * x + me[6] * y + me[10] * z + me[14];
      lowest = Math.min(lowest, px3[k * 3 + 1]);
    }
    // 더미 꼭대기 높이(+3cm) 아래를 지나는 버킷 부분은 모두 더미 뒤에 오게 (위로 걸친 등판·입구는 더미 위로 지나감).
    // 입구가 아래를 보면(바깥 법선 y < -0.3부터) 입구 밑 땅은 버킷이 덮은 자리라 흙더미가 거기 있으면 '땅을 보는 버킷 속 흙'으로 보임:
    // 높이와 상관없이 버킷 전체(입구 투영 포함)보다 앞에 놓음
    const nOut = this.surTmp.set(0, -1, 0).transformDirection(this.bucket.matrixWorld);
    const above = nOut.y < -0.3 ? Infinity : hEst + 0.03;
    const yCut = Math.max(g0, lowest) + above;
    for (let k = 0; k < np; k++) if (px3[k * 3 + 1] < yCut) front = Math.max(front, px3[k * 3] * fx + px3[k * 3 + 2] * fz);
    // 버킷 철판 두께만큼 띄움
    front += 0.03;
    const cl = midX * px + midZ * pz;
    let gFront = Infinity;
    for (const lv of [-W / 2, 0, W / 2]) gFront = Math.min(gFront, s.soil.surfaceAt((front + 0.02) * fx + (cl + lv) * px, (front + 0.02) * fz + (cl + lv) * pz));
    // 더미는 흙 격자의 정점 위에 그림 (월드에 고정된 정점 · 지형과 같은 삼각형 분할 · 화면에 올라간 지형 높이 기준).
    // 버킷을 따라 움직이는 격자로 그리면 정점이 지형 위를 미끄러지며 매 프레임 지형을 뚫었다 말았다 해서 번쩍였음
    const grid = s.soil.gridAt(midX, midZ);
    const HI = 1.2;
    if (!grid) {
      this.surMound.visible = false;
      this.surHeapVol = 0;
      this.surHeap = { h: 0, run: 0 };
      return;
    }
    const hb = this.soilShown?.(grid) ?? grid.h;
    const c = grid.cell;
    const Rmax = (1.1 * HI) / t + 0.02;
    // 더미가 놓일 수 있는 범위(앞 Rmax, 옆 W/2+Rmax)의 격자 정점 범위
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [sv, lv] of [[0, -W / 2 - Rmax], [0, W / 2 + Rmax], [Rmax, -W / 2 - Rmax], [Rmax, W / 2 + Rmax]]) {
      const x = (front + sv) * fx + (cl + lv) * px;
      const z = (front + sv) * fz + (cl + lv) * pz;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const i0 = Math.max(0, Math.floor((x0 - grid.ox) / c));
    const i1 = Math.min(grid.nx - 1, Math.ceil((x1 - grid.ox) / c));
    const j0 = Math.max(0, Math.floor((z0 - grid.oz) / c));
    const j1 = Math.min(grid.nz - 1, Math.ceil((z1 - grid.oz) / c));
    const ni = Math.max(0, i1 - i0 + 1);
    const nj = Math.max(0, j1 - j0 + 1);
    const nn = ni * nj;
    if (!this.surDist || this.surDist.length < nn) {
      this.surDist = new Float32Array(nn);
      this.surBase = new Float32Array(nn);
      this.surLift = new Float32Array(nn);
      this.surBump = new Float32Array(nn);
    }
    const dist = this.surDist;
    const base = this.surBase!;
    const lift = this.surLift!;
    const bmp = this.surBump!;
    // 위치 고정 해시로 ±4% 울퉁불퉁 (같은 정점은 같은 모양)
    for (let jj = 0; jj < nj; jj++)
      for (let ii = 0; ii < ni; ii++) {
        const q = jj * ni + ii;
        const gi = i0 + ii;
        const gj = j0 + jj;
        const x = grid.ox + gi * c;
        const z = grid.oz + gj * c;
        base[q] = hb[gj * grid.nx + gi];
        const sv = x * fx + z * fz - front;
        const lv = x * px + z * pz - cl;
        // 날 폭 선분(뒷면)까지의 수평 거리. 버킷 뒤쪽(sv < 0)엔 더미 없음
        dist[q] = sv < 0 ? Infinity : Math.hypot(sv, Math.max(0, Math.abs(lv) - W / 2));
        const hh = Math.sin(gi * 127.1 + gj * 311.7) * 43758.5453;
        bmp[q] = 1 + (hh - Math.floor(hh) - 0.5) * 0.08;
      }
    // 흙이 없는 정점은 땅속 1cm, 8mm 미만은 그 사이를 이어 줌 (지형과 거의 같은 높이의 면이 겹쳐 깜빡이지 않게, 양은 끊김 없이)
    const MIN = 0.008;
    const SINK = 0.01;
    let minBase = Infinity;
    for (let q = 0; q < nn; q++) if (dist[q] < Infinity) minBase = Math.min(minBase, base[q]);
    const A6 = (c * c) / 6;
    const diagAD = (q: number) => Math.abs(base[q] - base[q + ni + 1]) < Math.abs(base[q + 1] - base[q + ni]);
    const shape = (top: number) => {
      for (let q = 0; q < nn; q++) {
        const e = (top - t * dist[q] - base[q]) * bmp[q];
        lift[q] = e >= MIN ? e : e <= 0 ? -SINK : -SINK + (e * (MIN + SINK)) / MIN;
      }
      // 삼각형마다 넓이 × 세 꼭짓점 높이 평균 (그리는 면과 같은 분할)
      let v = 0;
      for (let jj = 0; jj < nj - 1; jj++)
        for (let ii = 0; ii < ni - 1; ii++) {
          const a = jj * ni + ii;
          const la = Math.max(0, lift[a]), lb = Math.max(0, lift[a + 1]), lc = Math.max(0, lift[a + ni]), ld = Math.max(0, lift[a + ni + 1]);
          if (la + lb + lc + ld === 0) continue;
          v += A6 * (diagAD(a) ? 2 * la + lc + 2 * ld + lb : la + 2 * lb + 2 * lc + ld);
        }
      return v;
    };
    // 지표 위 부피 = 시뮬 덧쌓임: 꼭대기 높이로 이분법 (버킷 앞 땅 위로 최대 1.2m, 아래로는 주변 가장 낮은 땅까지: 구덩이로 흘러내린 흙)
    let lo = Math.min(gFront, minBase);
    let hi = gFront + HI;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) / 2;
      if (shape(m) < V) lo = m;
      else hi = m;
    }
    this.surHeapVol = shape(hi);
    // 더미 높이 = 꼭대기 − 흙이 얹힌 가장 낮은 땅
    let foot = Infinity;
    for (let q = 0; q < nn; q++) if (lift[q] > 0) foot = Math.min(foot, base[q]);
    const hh = foot < Infinity ? Math.max(0, hi - foot) : 0;
    this.surHeap = { h: hh, run: Math.max(1e-6, hh) / t };
    // 정점: 흙이 있는 칸과 그 둘레만 그림
    const g = this.surMound.geometry;
    let pa = g.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pa || pa.count < nn) {
      const cap = Math.max(nn, 64 * 64);
      pa = new THREE.Float32BufferAttribute(new Float32Array(cap * 3), 3);
      g.setAttribute('position', pa);
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(cap * 3), 3));
      g.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(cap * 6), 1));
    }
    const ix = g.getIndex()!;
    const ia = ix.array as Uint32Array;
    let n = 0;
    for (let jj = 0; jj < nj - 1; jj++)
      for (let ii = 0; ii < ni - 1; ii++) {
        const a = jj * ni + ii;
        const b1 = a + 1, cc = a + ni, d1 = a + ni + 1;
        if (lift[a] <= 0 && lift[b1] <= 0 && lift[cc] <= 0 && lift[d1] <= 0) continue;
        if (diagAD(a)) {
          ia[n] = a; ia[n + 1] = cc; ia[n + 2] = d1; ia[n + 3] = a; ia[n + 4] = d1; ia[n + 5] = b1;
        } else {
          ia[n] = a; ia[n + 1] = cc; ia[n + 2] = b1; ia[n + 3] = b1; ia[n + 4] = cc; ia[n + 5] = d1;
        }
        n += 6;
      }
    this.root.updateWorldMatrix(true, false);
    const inv = this.surInv.copy(this.root.matrixWorld).invert();
    const pos = pa.array as Float32Array;
    const na = g.getAttribute('normal') as THREE.BufferAttribute;
    const nrm = na.array as Float32Array;
    const wv = this.surTmp;
    const yAt = (q: number) => base[q] + lift[q];
    for (let jj = 0; jj < nj; jj++)
      for (let ii = 0; ii < ni; ii++) {
        const q = jj * ni + ii;
        const y = yAt(q);
        wv.set(grid.ox + (i0 + ii) * c, y, grid.oz + (j0 + jj) * c).applyMatrix4(inv);
        pos[q * 3] = wv.x;
        pos[q * 3 + 1] = wv.y;
        pos[q * 3 + 2] = wv.z;
        // 노멀: 옆 정점 높이 차 (지형과 같은 방식). 월드 → root 방향으로 돌림
        const hx = ((ii < ni - 1 ? yAt(q + 1) : y) - (ii > 0 ? yAt(q - 1) : y)) / (c * (ii > 0 && ii < ni - 1 ? 2 : 1));
        const hz = ((jj < nj - 1 ? yAt(q + ni) : y) - (jj > 0 ? yAt(q - ni) : y)) / (c * (jj > 0 && jj < nj - 1 ? 2 : 1));
        wv.set(-hx, 1, -hz).transformDirection(inv);
        nrm[q * 3] = wv.x;
        nrm[q * 3 + 1] = wv.y;
        nrm[q * 3 + 2] = wv.z;
      }
    g.setDrawRange(0, n);
    ix.needsUpdate = true;
    pa.needsUpdate = true;
    na.needsUpdate = true;
    this.surMound.visible = n > 0;
    // 테스트 광선용 경계 (화면은 frustumCulled = false)
    g.computeBoundingSphere();
  }

  /** 흙이 담기는 속도에 맞춰 날 앞 둔덕과 굴러 들어가는 흙덩이를 그림 (화면 연출만) */
  private syncIntake(s: DigSession) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - (this.lastT || now)));
    this.lastT = now;
    const gain = Math.max(0, s.load - this.lastLoad);
    this.lastLoad = s.load;
    // 초당 담기는 양(평적 대비), 부드럽게
    const rate = dt > 0 ? gain / s.m.struckCapacity / dt : 0;
    this.intake += (rate - this.intake) * Math.min(1, dt * (rate > this.intake ? 12 : 4));
    const k = Math.min(1, this.intake / 0.6);
    // 둔덕: 담기는 속도만큼 날 앞에 솟음 (최대 12cm)
    this.lipMound.visible = k > 0.03;
    this.lipMound.scale.set(1, 0.03 + 0.09 * k, 1);
    // 날 앞 덧쌓임: 시뮬 부피 그대로 (내려놓은 흙은 지형으로 바로 넘어가므로 그때는 즉시 사라짐)
    // 시뮬 부피를 지연 없이 그대로 (작은 양도 안식각 더미로: 0.1L 넘으면 보임)
    this.surShown = Math.max(0, s.surcharge);
    this.surMound.visible = this.surShown > 1e-4;
    if (this.surMound.visible) this.buildSurHeap(s, this.surShown);
    else this.surHeapVol = 0;
    // 흙덩이: 날 끝에서 생겨 안쪽으로 굴러 들어감
    const L3 = this.m.L3;
    const W = this.m.bucketWidth;
    this.spawnAcc += k * dt * 40;
    while (this.spawnAcc >= 1 && this.clumpState.length < MAX_CLUMPS) {
      this.spawnAcc -= 1;
      const r = Math.random;
      this.clumpState.push({
        t: 0,
        life: 0.35 + r() * 0.35,
        x0: L3 - 0.05 + r() * 0.1,
        z: (r() - 0.5) * W * 0.8,
        x1: L3 * (0.35 + r() * 0.35),
        y1: 0.12 + r() * 0.15,
        sz: 0.6 + r() * 1.1,
        spin: 4 + r() * 8,
      });
    }
    if (this.spawnAcc >= 1) this.spawnAcc = 0;
    this.clumpState = this.clumpState.filter((c) => (c.t += dt) < c.life);
    let n = 0;
    for (const c of this.clumpState) {
      const u = c.t / c.life;
      // 날 바깥(-y)에서 솟았다가 입구를 넘어 안쪽(+y)으로 떨어짐
      const x = c.x0 + (c.x1 - c.x0) * u;
      const y = -0.12 * Math.sin(Math.PI * Math.min(1, u * 1.6)) + c.y1 * Math.max(0, u - 0.5) * 2;
      this.cp.set(x, y, c.z);
      this.ce.set(c.t * c.spin, c.t * c.spin * 0.7, 0);
      this.cq.setFromEuler(this.ce);
      const sz = c.sz * (u < 0.15 ? u / 0.15 : u > 0.8 ? (1 - u) / 0.2 : 1);
      this.cs.set(sz, sz * 0.75, sz);
      this.cm.compose(this.cp, this.cq, this.cs);
      this.clumps.setMatrixAt(n++, this.cm);
    }
    // 예열: 시작 직후 몇 프레임 동안 입구 앞에 흙덩이 하나를 실제 크기로 그려 둠.
    // 처음 그릴 때 그래픽 드라이버가 셰이더를 마저 준비하느라 첫 흙이 들어오는 순간 한 프레임이 끊겼음
    // (CPU 6배 저속 측정 67~107ms). 버킷 안쪽·크기 0으로 그리면 칠해지는 픽셀이 없어 준비가 안 됨
    if (n === 0 && this.warmFrames > 0) {
      this.warmFrames--;
      this.cm.makeTranslation(this.warmAt.x, this.warmAt.y, this.warmAt.z);
      this.clumps.setMatrixAt(n++, this.cm);
    }
    this.clumps.count = n;
    this.clumps.instanceMatrix.needsUpdate = true;
  }
  /** 흙덩이 예열 남은 프레임 (warmClumps로 다시 켬) */
  private warmFrames = 0;
  private warmAt = new THREE.Vector3();
  /** at = 화면에 확실히 보이는 월드 위치 (카메라 바로 앞). 버킷 기준으로 두면 땅속·버킷 안에 가려 칠해지지 않을 수 있음 */
  warmClumps(at: THREE.Vector3) {
    this.bucket.updateWorldMatrix(true, false);
    this.warmAt.copy(at);
    this.bucket.worldToLocal(this.warmAt);
    this.warmFrames = 3;
  }

  /** 상부·붐·암·버킷 자세와 실린더·링크 (굴착 sync와 주행 주행자세가 같이 씀) */
  private applyPose(p: { swing: number; boom: number; arm: number; bucket: number }) {
    const m = this.m;
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

  }
  /** 주행 자세: 상부 정면 고정, 붐·암·버킷 각 */
  setTravelPose(boom: number, arm: number, bucket: number) {
    this.applyPose({ swing: 0, boom, arm, bucket });
  }

  sync(s: DigSession) {
    const p = s.pose;
    const m = this.m;
    // 차체 흔들림 + 들림
    this.axA.set(-Math.sin(p.swing), 0, Math.cos(p.swing));
    this.axB.set(Math.cos(p.swing), 0, Math.sin(p.swing));
    this.qa.setFromAxisAngle(this.axA, -s.rock.pitch + s.lift);
    this.qb.setFromAxisAngle(this.axB, s.rock.roll);
    this.rockQ.copy(this.qa).multiply(this.qb);
    this.root.quaternion.copy(this.yawQ).multiply(this.rockQ);
    // 들림: 버킷이 땅을 눌러 받치므로 버킷 반대쪽 바퀴 접지선을 축으로 (블레이드는 땅에서 떠 있음) 버킷 쪽 차체가 들림.
    // 버킷은 흙에 박힌 그 자리(시뮬 위치)에 남고, 붐·암이 차체 기운 만큼 더 내려간 자세로 보임
    const L = s.lift;
    const u = { x: Math.cos(p.swing), z: Math.sin(p.swing) };
    let d = 0;
    const hb = m.wheelbase / 2;
    const hw = m.trackWidth / 2;
    for (const [x, z] of [[hb, hw], [hb, -hw], [-hb, hw], [-hb, -hw]]) d = Math.max(d, -(x * u.x + z * u.z));
    this.liftQ.setFromAxisAngle(this.axA, L);
    this.pivotV.set(-d * u.x, 0, -d * u.z);
    this.pivotW.copy(this.pivotV).applyQuaternion(this.liftQ).negate().add(this.pivotV).applyQuaternion(this.yawQ);
    this.root.position.copy(this.basePos).add(this.pivotW);
    let pose = p;
    if (L > 1e-5) {
      // 버킷 핀(시뮬 위치)을 기운 상부 기준으로 옮겨 붐·암 2절 역기구학
      const f = fk(m, p);
      const c = Math.cos(-L);
      const sn = Math.sin(-L);
      const qr = -d + (f.P2.r + d) * c - f.P2.y * sn;
      const qy = (f.P2.r + d) * sn + f.P2.y * c;
      const dr = qr - m.boomFoot.r;
      const dy = qy - m.boomFoot.y;
      const D = Math.hypot(dr, dy);
      const ca = Math.max(-1, Math.min(1, (D * D - m.L1 * m.L1 - m.L2 * m.L2) / (2 * m.L1 * m.L2)));
      const arm = -Math.acos(ca);
      const boom = Math.atan2(dy, dr) - Math.atan2(m.L2 * Math.sin(arm), m.L1 + m.L2 * Math.cos(arm));
      pose = { swing: p.swing, boom, arm, bucket: f.thK - L - boom - arm };
    }
    this.applyPose(pose);

    this.syncIntake(s);
    // 버킷 속 흙: 양(2.5% 단위)·기울기(4° 단위)로 모양을 캐시
    const sc = m.struckCapacity;
    // 안쪽이 다 차기 전까지 앞쪽 흙은 날 쪽에 걸려 있고(푸석), 안쪽이 차면 나머지는 그 위로 고르게 앉음
    const front = Math.max(0, s.load - s.loadBack);
    const wedge = Math.min(front, Math.max(0, s.backCap - s.loadBack));
    const packed = (s.load - wedge) / sc;
    const loose = wedge / sc;
    // 흙의 '위'(중력 반대)가 버킷 입구 바깥 방향에서 기운 각
    const a = p.boom + p.arm + p.bucket;
    const tilt = Math.atan2(Math.sin(a), -Math.cos(a));
    const kp = Math.round(packed * 40);
    const kl = Math.round(loose * 40);
    const kt = Math.round(Math.max(-100, Math.min(100, (tilt * 180) / Math.PI)) / 4);
    const key = kp + kl * 100 + (kt + 30) * 10000;
    if (key !== this.fillKey) {
      this.fillKey = key;
      let g = this.fillCache.get(key);
      if (g) {
        // 최근에 쓴 것을 뒤로 (LRU)
        this.fillCache.delete(key);
        this.fillCache.set(key, g);
      } else {
        if (this.fillCache.size >= 120) {
          const [oldKey, old] = this.fillCache.entries().next().value!;
          this.fillCache.delete(oldKey);
          for (const x of [old.packed, old.loose, old.heap]) x?.dispose();
        }
        g = kp + kl > 0 ? bucketSoilGeometry(this.cavity, m.L3, m.bucketWidth, { packed: kp / 40, loose: kl / 40, tilt: (kt * 4 * Math.PI) / 180 }) : { packed: null, loose: null, heap: null };
        this.fillCache.set(key, g);
      }
      const [mp, ml, mh] = this.soilMeshes;
      for (const [mesh, geo] of [
        [mp, g.packed],
        [ml, g.loose],
        [mh, g.heap],
      ] as const) {
        mesh.visible = !!geo;
        if (geo) mesh.geometry = geo;
      }
      // 고봉: 거의 다 다져졌으면 진한 흙
      mh.material = toon(loose < 0.1 ? PALETTE.dirt : LOOSE_DIRT);
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
