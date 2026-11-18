import * as THREE from 'three';
import type { DigSession } from '../sim/session';
import { stationPoint, type Site } from '../sim/site';
import type { SoilGrid } from '../sim/soil';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { current as qNow, fxPlan } from '../ui/quality';
import { PALETTE, toon } from './toon';
import { buildExamSurroundings, EXAM_FLOOR } from './examSite';

/** 줄무늬 텍스처 (세로 반복) */
function stripes(a: string, b: string) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 4, 8);
  g.fillStyle = b;
  g.fillRect(0, 8, 4, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** UV를 실제 길이에 맞춰 늘려 줄무늬 간격을 일정하게 */
function scaleUv(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

function label(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.strokeStyle = '#1d1b2e';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#1d1b2e';
  g.font = '900 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(0.9, 0.9, 1);
  s.renderOrder = 10;
  return s;
}

export class SiteView {
  readonly group = new THREE.Group();
  /** A·B·C 글자 표지 (운전석 시점에서는 숨김: 실제 시험장에는 없음) */
  readonly labels: THREE.Sprite[] = [];
  /**
   * 레버 익히기용 '튜토리얼 공간': 펜스·건물·폴·줄·표시선을 다 비우고 바닥만 한 색으로.
   * 바닥 재질은 SiteView마다 새로 만드니(공유 캐시가 아니다) 색을 바꿔도 다른 화면에
   * 영향이 없다. 세션이 바뀌면 SiteView가 새로 만들어지므로 되돌릴 일도 없다.
   */
  bare(color: number, line = 0x8d97a0) {
    for (const c of this.group.children) {
      const keep = c.name === 'floor' || c.name === 'lines';
      c.visible = keep;
      if (!keep) continue;
      const m = (c as THREE.Mesh | THREE.LineSegments).material as THREE.Material & { color: THREE.Color };
      m.color.setHex(c.name === 'floor' ? color : line);
    }
    for (const s of this.labels) s.visible = false;
  }
  /** exam: 실제 시험 모드 배경(시험장)으로 */
  constructor(site: Site, grids: SoilGrid[], exam = false) {
    // 바닥: 넓은 잔디(작업장 자리는 구멍) + 작업장 흙마당(흙 격자 자리는 구멍)
    // 잔디가 구덩이(-0.5)를 위에서 덮지 않도록 잔디에도 구멍을 낸다
    const yardPts = [
      // 회전 후 z = -y → z 범위 -6 ~ 11 (B가 +z 쪽)
      new THREE.Vector2(-12, -11),
      new THREE.Vector2(12, -11),
      new THREE.Vector2(12, 6),
      new THREE.Vector2(-12, 6),
    ];
    const grassShape = new THREE.Shape([new THREE.Vector2(-60, -60), new THREE.Vector2(60, -60), new THREE.Vector2(60, 60), new THREE.Vector2(-60, 60)]);
    grassShape.holes.push(new THREE.Path([...yardPts].reverse()));
    const grassG = new THREE.ShapeGeometry(grassShape);
    grassG.rotateX(-Math.PI / 2);
    // 시험 경기장은 잔디 대신 밝은 단색 바닥
    const grass = new THREE.Mesh(grassG, exam ? toon(EXAM_FLOOR) : new THREE.MeshLambertMaterial({ color: PALETTE.grass }));
    grass.position.y = -0.01;
    grass.name = 'floor';
    this.group.add(grass);
    const yard = new THREE.Shape(yardPts);
    for (const g of grids) {
      const x0 = g.ox;
      const x1 = g.ox + (g.nx - 1) * g.cell;
      const z0 = g.oz;
      const z1 = g.oz + (g.nz - 1) * g.cell;
      // Shape는 (x, -z) 평면 → rotateX(-π/2) 후 z가 뒤집히므로 -z로 넣는다
      yard.holes.push(
        new THREE.Path([new THREE.Vector2(x0, -z0), new THREE.Vector2(x0, -z1), new THREE.Vector2(x1, -z1), new THREE.Vector2(x1, -z0)]),
      );
    }
    const yardG = new THREE.ShapeGeometry(yard);
    yardG.rotateX(-Math.PI / 2);
    const yardM = new THREE.Mesh(yardG, new THREE.MeshLambertMaterial({ color: PALETTE.yard }));
    yardM.name = 'floor';
    this.group.add(yardM);

    // 바닥 표시선 (구덩이·굴착구역·가상선)
    const solid: number[] = [];
    const dashed: number[] = [];
    const seg = (arr: number[], a: THREE.Vector3, b: THREE.Vector3) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (const s of site.stations) {
      const P = (rho: number, lat: number, y = 0.012) => {
        const p = stationPoint(s, rho, lat, y);
        return new THREE.Vector3(p.x, p.y, p.z);
      };
      const zh = s.zoneHalfW;
      seg(solid, P(s.zoneIn, -zh), P(s.zoneOut, -zh));
      seg(solid, P(s.zoneIn, zh), P(s.zoneOut, zh));
      seg(solid, P(s.zoneOut, -zh), P(s.zoneOut, zh));
      seg(dashed, P(s.zoneIn, -zh), P(s.zoneIn, zh)); // 가상굴착제한선
      const lab = label(s.name, s.name === 'A' ? '#ffc23a' : '#8fe3ff');
      const c = P(s.zoneOut + 0.9, 0, 1.2);
      lab.position.copy(c);
      this.group.add(lab);
      this.labels.push(lab);
    }
    // B 가상통과제한선: 폴에서 위로 (바닥 선과 따로 — 폴을 감추면 이것도 감춰야 한다)
    const upright: number[] = [];
    for (const r of [site.B.rE, site.B.rF]) {
      seg(upright, new THREE.Vector3(0, 0, r), new THREE.Vector3(0, site.beta + 1.6, r));
    }
    const solidG = new THREE.BufferGeometry();
    solidG.setAttribute('position', new THREE.Float32BufferAttribute(solid, 3));
    const solidL = new THREE.LineSegments(solidG, new THREE.LineBasicMaterial({ color: 0xffffff }));
    solidL.name = 'lines';
    this.group.add(solidL);
    const dashG = new THREE.BufferGeometry();
    dashG.setAttribute('position', new THREE.Float32BufferAttribute(dashed, 3));
    const dl = new THREE.LineSegments(dashG, new THREE.LineDashedMaterial({ color: 0x1d1b2e, dashSize: 0.25, gapSize: 0.18 }));
    dl.computeLineDistances();
    dl.name = 'lines';
    this.group.add(dl);
    const upG = new THREE.BufferGeometry();
    upG.setAttribute('position', new THREE.Float32BufferAttribute(upright, 3));
    const ul = new THREE.LineSegments(upG, new THREE.LineDashedMaterial({ color: 0x1d1b2e, dashSize: 0.25, gapSize: 0.18 }));
    ul.computeLineDistances();
    this.group.add(ul);
    const labB = label('B', '#2fd27a');
    labB.position.set(0, site.beta + 2.0, (site.B.rE + site.B.rF) / 2);
    this.group.add(labB);
    this.labels.push(labB);

    // B 통과구역 표시 (반투명)
    const passH = site.beta + 1.2 - site.B.ropeY;
    const pass = new THREE.Mesh(
      new THREE.PlaneGeometry(site.B.rF - site.B.rE, passH),
      new THREE.MeshBasicMaterial({ color: PALETTE.pass, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    pass.rotation.y = Math.PI / 2;
    pass.position.set(0, site.B.ropeY + passH / 2, (site.B.rE + site.B.rF) / 2);
    this.group.add(pass);

    // 폴: 노랑·검정 줄무늬 (25cm 간격), 하나로 합쳐 드로우콜 1회
    const poleGeos = site.poles.map((p) => {
      const g = new THREE.CylinderGeometry(0.045, 0.05, p.h, 8);
      scaleUv(g, 1, p.h / 0.5);
      g.translate(p.x, p.h / 2, p.z);
      return g;
    });
    const poleMat = new THREE.MeshLambertMaterial({ map: stripes('#ffd21f', '#1d1b2e') });
    this.group.add(new THREE.Mesh(mergeGeometries(poleGeos), poleMat));
    // 폴 받침 (콘크리트 블록)
    const baseGeos = site.poles.map((p) => new THREE.BoxGeometry(0.28, 0.12, 0.28).translate(p.x, 0.06, p.z));
    this.group.add(new THREE.Mesh(mergeGeometries(baseGeos), toon(0x9a978f)));

    // 줄: 빨강·흰 경고 줄 (20cm 간격)
    const ropeGeos = site.ropes.map((r) => {
      const a = new THREE.Vector3(r.a.x, r.a.y, r.a.z);
      const b = new THREE.Vector3(r.b.x, r.b.y, r.b.z);
      const dir = b.clone().sub(a);
      const L = dir.length();
      const g = new THREE.BoxGeometry(L, 0.035, 0.035);
      // BoxGeometry의 u는 x 방향 → 줄무늬를 길이 방향으로 두려고 uv를 맞바꿈
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, uv.getX(i) * (L / 0.4));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
      g.applyQuaternion(q);
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      return g;
    });
    this.group.add(new THREE.Mesh(mergeGeometries(ropeGeos), new THREE.MeshLambertMaterial({ map: stripes('#ff3b3b', '#ffffff') })));

    if (exam) this.group.add(buildExamSurroundings(site));
    else this.addSurroundings(site);
  }

  /** 연습용 굴착 목표 표시: ⓑ선 안쪽 30cm 가로줄(버킷 폭) + 구덩이 중심선 + 허용 범위 띠 */
  readonly guide = new THREE.Group();
  addDigGuide(site: Site, targetRho: number, bucketW: number, tol: number) {
    const st = site.stations[0];
    const P = (rho: number, lat: number, y = 0.03) => {
      const p = stationPoint(st, rho, lat, y);
      return new THREE.Vector3(p.x, p.y, p.z);
    };
    // 허용 범위 띠 (반투명 초록): 반경 ±tol, 좌우 ±W/2
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * tol, bucketW),
      new THREE.MeshBasicMaterial({ color: 0x2fd27a, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
    );
    band.rotation.x = -Math.PI / 2;
    band.position.copy(P(targetRho, 0, 0.025));
    this.guide.add(band);
    // 목표 가로줄(굵은 띠) + 구덩이 중심선 (휴대폰 화면에서도 보이게 면으로)
    const strip = (len: number, wid: number, rho: number, lat: number, alongRho: boolean) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(alongRho ? len : wid, alongRho ? wid : len),
        new THREE.MeshBasicMaterial({ color: 0x0b8f4d, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.copy(P(rho, lat, 0.035));
      this.guide.add(m);
    };
    strip(bucketW + 0.3, 0.06, targetRho, 0, false);
    strip(st.zoneOut - st.pitIn, 0.025, (st.zoneOut + st.pitIn) / 2, 0, true);
    this.group.add(this.guide);
  }

  /**
   * 평탄 기준 줄 (연습 모드): C 구덩이 양옆 끝에 말뚝을 박고 목표면(지면 높이)에 노란 줄을 띄움.
   * 줄보다 흙이 높으면 줄이 흙에 묻히고, 낮으면 줄 아래로 틈이 보임. 그림만 얹으며 판정·충돌 없음
   */
  addFlatGuide(site: Site) {
    const st = site.stations[1];
    const P = (rho: number, lat: number, y: number) => {
      const p = stationPoint(st, rho, lat, y);
      return new THREE.Vector3(p.x, p.y, p.z);
    };
    const stakeMat = new THREE.MeshLambertMaterial({ color: 0xf07a2a });
    const capMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
    const r0 = st.pitIn - 0.25;
    const r1 = st.pitOut + 0.25;
    for (const side of [-1, 1]) {
      const lat = side * (st.pitHalfW + 0.04);
      for (const rho of [r0, r1]) {
        const stake = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), stakeMat);
        stake.position.copy(P(rho, lat, 0.21));
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.055), capMat);
        cap.position.copy(P(rho, lat, 0.39));
        this.guide.add(stake, cap);
      }
      // 줄: 목표면보다 1cm 위 (흙이 딱 맞으면 줄이 흙에 거의 닿음)
      const a = P(r0, lat, 0.01);
      const b = P(r1, lat, 0.01);
      const line = new THREE.Mesh(new THREE.BoxGeometry(a.distanceTo(b), 0.014, 0.014), lineMat);
      line.position.copy(a).add(b).multiplyScalar(0.5);
      line.lookAt(b);
      line.rotateY(Math.PI / 2);
      this.guide.add(line);
    }
    this.group.add(this.guide);
  }

  /** 시험장 주변: 펜스, 건물, 컨테이너, 흙더미 (판정과 무관한 배경) */
  private addSurroundings(site: Site) {
    // 펜스: 작업장 둘레 녹색 망 (반투명) + 기둥
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x3f9b5a, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const postGeos: THREE.BufferGeometry[] = [];
    const panelGeos: THREE.BufferGeometry[] = [];
    const H = 1.8;
    const edges: [number, number, number, number][] = [
      [-13, -7, 13, -7],
      [13, -7, 13, 12],
      [13, 12, -13, 12],
      [-13, 12, -13, -7],
    ];
    for (const [x0, z0, x1, z1] of edges) {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.ceil(L / 2.5);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        postGeos.push(new THREE.BoxGeometry(0.08, H, 0.08).translate(x0 + (x1 - x0) * t, H / 2, z0 + (z1 - z0) * t));
      }
      const p = new THREE.PlaneGeometry(L, H);
      p.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      p.translate((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
      panelGeos.push(p);
    }
    this.group.add(new THREE.Mesh(mergeGeometries(postGeos), toon(0x2f6b42)));
    this.group.add(new THREE.Mesh(mergeGeometries(panelGeos), fenceMat));
    // 원경 건물 (학원 건물, 창고), 컨테이너
    const blocks: [number, number, number, number, number, number, number][] = [
      // w, h, d, x, z, 벽색, 지붕색
      [14, 7, 7, -6, -15, 0xece2cf, 0xc0503f],
      [10, 5, 8, 14, 20, 0xd9dde3, 0x5b7fa6],
      [6, 2.6, 2.4, 17, -2, 0x3d7fb8, 0x3d7fb8],
      [6, 2.6, 2.4, 17, 1, 0x4c9a6a, 0x4c9a6a],
      [12, 6, 6, -20, 10, 0xe8e6df, 0x8a8f99],
    ];
    for (const [w, h, d, x, z, wall, roof] of blocks) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(wall));
      b.position.set(x, h / 2, z);
      const r = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.4, d + 0.4), toon(roof));
      r.position.set(x, h + 0.2, z);
      this.group.add(b, r);
    }
    // 흙더미: 굴착장 바깥(도달거리 밖)에 쌓인 보충용 흙
    const moundGeos: THREE.BufferGeometry[] = [];
    for (const [x, z, r, h] of [
      [-(site.reach + 2.2), -2.5, 1.6, 0.9],
      [-(site.reach + 2.6), 1.8, 1.2, 0.7],
      [site.reach + 2.4, -2.2, 1.4, 0.8],
      [site.reach + 2.2, 2.4, 1.0, 0.6],
    ] as const) {
      moundGeos.push(new THREE.ConeGeometry(r, h, 12, 1).translate(x, h / 2, z));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(moundGeos), toon(PALETTE.dirt)));
  }
}

/** 흙 높이맵 메시 */
/** 땅 위에 흘린 흙이 이 높이(m)부터 온전한 흙색 — 그보다 얇으면 바닥색과 섞는다 */
const FADE_H = 0.1;

export class SoilView {
  readonly meshes: THREE.Mesh[] = [];
  private base = new THREE.Color(PALETTE.dirt);
  private ground = new THREE.Color(PALETTE.sand);
  /** 흙 주변 다진 바닥색. 튜토리얼 공간에서는 글자가 잘 보이게 밝게 올린다 */
  setGround(hex: number) {
    this.ground.setHex(hex);
    for (const g of this.grids) g.dirty = true;
  }
  private dark = new THREE.Color(0x24160c);
  private tmp = new THREE.Color();
  /** 굴착장 바닥: 여러 번 파고 밟아 흙이 깔린 땅 (구덩이만 갈색이면 '구덩이에만 흙'처럼 보였다 — 앱 주인 지적) */
  private trampled = new THREE.Color(0x7a5a3e);
  private gnd = new THREE.Color();
  /** 흙 격자 가장자리에서 이 거리(m)까지 바닥색 → 밟힌 흙색으로 서서히 (격자는 구역선 밖 1.2m까지) */
  private static EDGE = 1.2;
  /** 평탄 도움(연습 모드, 첫 덤프 뒤): C 흙을 목표면(지면 0) 대비 높으면 밝게·낮으면 어둡게, 버킷이 고른 자리는 몇 초 매끈한 자국 */
  flatGuide = false;
  /** 시뮬 시각 (긁은 자국이 바래는 기준) */
  now = 0;
  private flatGuidePrev = false;
  private high = new THREE.Color(0xe3b479);
  private low = new THREE.Color(0x3a2414);
  private smooth = new THREE.Color(0x8a5a32);
  /** 화면에 올라간 높이 (격자별). 날 앞 흙더미가 같은 높이 위에 놓이도록 */
  private shown = new Map<SoilGrid, Float32Array>();
  shownOf(g: SoilGrid): ArrayLike<number> {
    return this.shown.get(g) ?? g.h;
  }
  constructor(private grids: SoilGrid[]) {
    for (const g of grids) {
      this.shown.set(g, Float32Array.from(g.h));
      const n = g.nx * g.nz;
      const pos = new Float32Array(n * 3);
      for (let j = 0; j < g.nz; j++)
        for (let i = 0; i < g.nx; i++) {
          const k = g.idx(i, j);
          pos[k * 3] = g.xOf(i);
          pos[k * 3 + 2] = g.zOf(j);
        }
      const idx: number[] = [];
      for (let j = 0; j < g.nz - 1; j++)
        for (let i = 0; i < g.nx - 1; i++) {
          const a = g.idx(i, j);
          const b = g.idx(i + 1, j);
          const c = g.idx(i, j + 1);
          const d = g.idx(i + 1, j + 1);
          idx.push(a, c, b, b, c, d);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      this.meshes.push(mesh);
      g.dirty = true;
    }
  }
  /**
   * 바뀐 흙판만 화면 모양에 반영. 흙 판정·움직임은 시뮬레이션이 초당 60번 하고, 보이는 모양은 초당 약 20번만 갱신 (저가폰 부담 1/3).
   * 빛 받는 방향(노멀)은 범용 삼각형 계산 대신 격자의 옆 칸 높이 차로 같은 반복문에서 바로 구함.
   */
  private lastSync = -1e9;
  sync() {
    const now = performance.now();
    if (now - this.lastSync < 45) return;
    this.lastSync = now;
    const TRAIL = 6; // 긁은 자국이 남는 시간 (초)
    if (this.flatGuide !== this.flatGuidePrev) {
      this.flatGuidePrev = this.flatGuide;
      for (const g of this.grids) if (g.name === 'C') g.dirty = true;
    }
    this.grids.forEach((g, gi) => {
      const guide = this.flatGuide && g.name === 'C';
      // 자국이 바래는 동안은 계속 다시 칠함
      if (guide && this.now - g.touchLast < TRAIL + 0.1) g.dirty = true;
      if (!g.dirty) return;
      g.dirty = false;
      const geo = this.meshes[gi].geometry;
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const col = geo.getAttribute('color') as THREE.BufferAttribute;
      const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
      const { h, h0, nx, nz } = g;
      const shown = this.shown.get(g)!;
      const inv2c = 1 / (2 * g.cell);
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          pos.setY(k, h[k]);
          shown[k] = h[k];
          // 노멀: (-dh/dx, 1, -dh/dz) (가장자리는 한쪽 차이)
          const hx = ((i < nx - 1 ? h[k + 1] : h[k]) - (i > 0 ? h[k - 1] : h[k])) * (i > 0 && i < nx - 1 ? inv2c : 2 * inv2c);
          const hz = ((j < nz - 1 ? h[k + nx] : h[k]) - (j > 0 ? h[k - nx] : h[k])) * (j > 0 && j < nz - 1 ? inv2c : 2 * inv2c);
          const il = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
          nrm.setXYZ(k, -hx * il, il, -hz * il);
          const inPit = guide && g.pit[k] > 0;
          // 이 칸의 '바닥' 색: 격자 가장자리는 둘레 바닥색, 구역 안쪽으로 갈수록 밟힌 흙색
          const edge = Math.min(i, nx - 1 - i, j, nz - 1 - j) * g.cell;
          const we = THREE.MathUtils.smoothstep(edge, 0, SoilView.EDGE);
          this.gnd.copy(this.ground).lerp(this.trampled, we);
          if (Math.abs(h[k] - h0[k]) < 0.003 && h0[k] === 0 && !inPit) {
            col.setXYZ(k, this.gnd.r, this.gnd.g, this.gnd.b);
            continue;
          }
          // 오목하면 어둡게(가짜 그늘), 볼록하면 밝게
          const nb =
            (i > 0 ? h[k - 1] : h[k]) + (i < nx - 1 ? h[k + 1] : h[k]) + (j > 0 ? h[k - nx] : h[k]) + (j < nz - 1 ? h[k + nx] : h[k]);
          const lap = h[k] - nb / 4;
          // 깊을수록 어둡게, 오목·볼록은 더 또렷하게 (바닥·흙더미·구덩이 구분)
          const depthShade = Math.min(1, Math.max(0, -h[k] / 1.4));
          this.tmp.copy(this.base).lerp(this.dark, depthShade * 0.7);
          // 이빨 골(10cm 안팎) 같은 잔물결은 은은하게: 너무 세면 줄무늬가 솟은 손가락처럼 보임
          let s = THREE.MathUtils.clamp(1 + lap * 6, 0.8, 1.2);
          if (inPit) {
            // 목표면(0) 대비: ±4cm까지는 그대로, 그 위는 밝게(높음), 아래는 어둡게(낮음)
            const d = h[k];
            if (d > 0.04) this.tmp.lerp(this.high, Math.min(1, (d - 0.04) / 0.2) * 0.6);
            else if (d < -0.04) this.tmp.lerp(this.low, Math.min(1, (-d - 0.04) / 0.25) * 0.6);
            // 방금 버킷이 고른 자리: 매끈하게 다져진 색, 잔물결 없음 → 천천히 원래대로
            const age = this.now - g.touch[k];
            if (age >= 0 && age < TRAIL) {
              const w = 1 - age / TRAIL;
              this.tmp.lerp(this.smooth, 0.45 * w);
              s += (1 - s) * w;
            }
          }
          // 땅 위(처음 높이 0)에 얇게 흘린 흙: 높이만큼 바닥색에서 흙색으로 서서히.
          // 꼭짓점마다 둘 중 하나로 칠하면 얇은 흙더미 가장자리가 삼각형 톱니로 끊겨 보인다 (유저 검토)
          if (h0[k] === 0 && !inPit) {
            const w = Math.min(1, Math.abs(h[k] - h0[k]) / FADE_H);
            this.tmp.multiplyScalar(s).lerp(this.gnd, 1 - w);
            col.setXYZ(k, this.tmp.r, this.tmp.g, this.tmp.b);
            continue;
          }
          col.setXYZ(k, this.tmp.r * s, this.tmp.g * s, this.tmp.b * s);
        }
      // 칸마다 높이 차가 작은 대각선으로 삼각형을 나눔: 비스듬한 구덩이 벽이 톱니(뾰족한 손가락)처럼 보이지 않게
      const index = geo.getIndex()!;
      const ia = index.array as Uint16Array | Uint32Array;
      let q = 0;
      for (let j = 0; j < nz - 1; j++)
        for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i;
          const b = a + 1;
          const c = a + nx;
          const d = c + 1;
          if (Math.abs(h[a] - h[d]) < Math.abs(h[b] - h[c])) {
            ia[q] = a; ia[q + 1] = c; ia[q + 2] = d; ia[q + 3] = a; ia[q + 4] = d; ia[q + 5] = b;
          } else {
            ia[q] = a; ia[q + 1] = c; ia[q + 2] = b; ia[q + 3] = b; ia[q + 4] = c; ia[q + 5] = d;
          }
          q += 6;
        }
      index.needsUpdate = true;
      pos.needsUpdate = true;
      col.needsUpdate = true;
      nrm.needsUpdate = true;
    });
  }
}

/** 떨어지는 흙 덩어리 + 떨어진 자리 먼지 + 버킷 그림자 */
// 미리 잡아 두는 자리는 가장 높은 단계 기준. 실제로 그리는 수는 화질 단계가 정한다 (fxPlan)
const CLUMPS = fxPlan(2).clumps;
const MAX_P = fxPlan(2).particles;
const MAX_DUST = fxPlan(2).dust;
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export class FxView {
  readonly particles: THREE.InstancedMesh;
  readonly dust: THREE.InstancedMesh;
  readonly bucketShadow: THREE.Mesh;
  readonly machineShadow: THREE.Mesh;
  private mtx = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private pos = new THREE.Vector3();
  private scl = new THREE.Vector3();
  private puffs: { x: number; y: number; z: number; age: number; life: number; size: number }[] = [];
  private lastT = performance.now();
  /** 흙 알갱이·먼지 예열 남은 프레임 (warm으로 다시 켬) */
  private warmFrames = 0;
  private warmAt = new THREE.Vector3();
  /** at = 화면에 확실히 보이는 월드 위치 (카메라 바로 앞) */
  warm(at: THREE.Vector3) {
    this.warmAt.copy(at);
    this.warmFrames = 3;
  }
  constructor() {
    this.particles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.06, 0), toon(0xffffff).clone(), MAX_P * CLUMPS);
    this.particles.count = 0;
    this.particles.frustumCulled = false;
    // 흙 덩어리 색: 마른 황토 / 젖은 짙은 흙 / 모래빛 섞기
    const tones = [new THREE.Color(PALETTE.dirt), new THREE.Color(0x5c3a22), new THREE.Color(0xa8763f)];
    for (let i = 0; i < MAX_P * CLUMPS; i++) this.particles.setColorAt(i, tones[Math.floor(hash(i * 3.1) * 3)]);
    // 젖은 흙: 먼지 대신 어두운 흙 튐이 살짝
    const dustMat = new THREE.MeshBasicMaterial({ color: 0x5a3f2c, transparent: true, opacity: 0.25, depthWrite: false });
    this.dust = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), dustMat, MAX_DUST);
    this.dust.count = 0;
    this.dust.frustumCulled = false;
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1d1b2e, transparent: true, opacity: 0.3, depthWrite: false });
    this.bucketShadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), shadowMat);
    this.bucketShadow.rotation.x = -Math.PI / 2;
    this.machineShadow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), shadowMat.clone());
    this.machineShadow.rotation.x = -Math.PI / 2;
    this.machineShadow.position.y = 0.01;
    (this.machineShadow.material as THREE.MeshBasicMaterial).opacity = 0.22;
  }
  sync(s: DigSession) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const tsec = now / 1000;
    // 떨어지는 흙: 입자 하나 = 크기·색이 다른 덩어리 3개, 굴러 떨어지며 회전
    // 저가폰에서는 알갱이를 적게, 덩어리도 하나만 그린다. 흘린 양·문구 판정은 그대로다
    const plan = fxPlan(qNow().level);
    const n = Math.min(s.particles.length, plan.particles);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const pt = s.particles[i];
      const big = Math.cbrt(Math.max(pt.vol, 0.0005) / 0.004);
      for (let j = 0; j < plan.clumps; j++) {
        const h = pt.id * 7 + j;
        const sz = (0.7 + hash(h) * 0.9) * THREE.MathUtils.clamp(big, 0.5, 1.6) * (pt.big ? 1.7 : 1);
        this.pos.set(
          pt.p.x + (hash(h + 0.3) - 0.5) * 0.22,
          pt.p.y + (hash(h + 0.6) - 0.5) * 0.25 + j * 0.06,
          pt.p.z + (hash(h + 0.9) - 0.5) * 0.22,
        );
        this.e.set(tsec * (3 + hash(h + 1.2) * 6), tsec * (2 + hash(h + 1.5) * 5), 0);
        this.q.setFromEuler(this.e);
        this.scl.set(sz, sz * (0.7 + hash(h + 1.8) * 0.5), sz);
        this.mtx.compose(this.pos, this.q, this.scl);
        this.particles.setMatrixAt(k++, this.mtx);
      }
    }
    this.particles.count = k;
    this.particles.instanceMatrix.needsUpdate = true;
    // 떨어진 자리: 먼지가 피어올라 퍼지며 사라짐 (가까운 곳에 겹치면 키우기만)
    for (const ev of s.landEvents) {
      if (ev.vol < 0.0015) continue;
      const y = s.soil.surfaceAt(ev.p.x, ev.p.z);
      const size = THREE.MathUtils.clamp(0.35 + Math.cbrt(ev.vol) * 2.2, 0.4, 1.3);
      const near = this.puffs.find((p) => p.age < 0.25 && Math.hypot(p.x - ev.p.x, p.z - ev.p.z) < 0.5);
      if (near) near.size = Math.min(1.6, near.size + size * 0.15);
      else if (this.puffs.length < plan.dust) this.puffs.push({ x: ev.p.x, y, z: ev.p.z, age: 0, life: 0.9 + Math.random() * 0.5, size });
    }
    s.landEvents.length = 0;
    let d = 0;
    this.puffs = this.puffs.filter((p) => (p.age += dt) < p.life);
    for (const p of this.puffs) {
      const u = p.age / p.life;
      const grow = p.size * (0.35 + 0.9 * Math.sqrt(u)) * (1 - u * u); // 퍼졌다가 옅어지듯 줄어듦
      this.pos.set(p.x, p.y + 0.1 + u * 0.45, p.z);
      this.scl.set(grow, grow * 0.55, grow);
      this.q.identity();
      this.mtx.compose(this.pos, this.q, this.scl);
      this.dust.setMatrixAt(d++, this.mtx);
    }
    // 예열: 시작 직후 몇 프레임 동안 버킷 끝 근처에 흙 알갱이·먼지 하나씩을 실제 크기로 그려 둠.
    // 처음 그릴 때 그래픽 드라이버가 셰이더를 마저 준비하느라 처음 흙을 쏟는 순간 한 프레임이 끊겼음
    if (this.warmFrames > 0 && (k === 0 || d === 0)) {
      this.warmFrames--;
      this.pos.copy(this.warmAt);
      this.q.identity();
      this.scl.set(1, 1, 1);
      this.mtx.compose(this.pos, this.q, this.scl);
      if (k === 0) {
        this.particles.setMatrixAt(0, this.mtx);
        this.particles.count = 1;
      }
      if (d === 0) {
        // 먼지는 반지름 0.5m라 그대로면 카메라 앞에 번쩍임 → 작게 (몇 픽셀만 칠해지면 됨)
        this.scl.set(0.08, 0.08, 0.08);
        this.mtx.compose(this.pos, this.q, this.scl);
        this.dust.setMatrixAt(0, this.mtx);
        d = 1;
      }
    }
    this.dust.count = d;
    this.dust.instanceMatrix.needsUpdate = true;
    // 버킷 끝 바로 아래 그림자: 높을수록 옅게
    const f = s.frame;
    const c = s.pose.swing;
    const r = (f.tip.r + f.heel.r) / 2;
    const x = r * Math.cos(c);
    const z = r * Math.sin(c);
    const ground = s.soil.surfaceAt(x, z);
    const hgt = Math.min(f.tip.y, f.heel.y) - ground;
    this.bucketShadow.position.set(x, ground + 0.02, z);
    const m = this.bucketShadow.material as THREE.MeshBasicMaterial;
    m.opacity = THREE.MathUtils.clamp(0.45 - hgt * 0.07, 0.08, 0.45);
    const sc = THREE.MathUtils.clamp(0.7 + hgt * 0.08, 0.7, 1.3);
    this.bucketShadow.scale.set(sc, sc, sc);
  }
}
