import * as THREE from 'three';
import type { DigSession } from '../sim/session';
import { stationPoint, type Site } from '../sim/site';
import type { SoilGrid } from '../sim/soil';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, toon } from './toon';

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
  constructor(site: Site, grids: SoilGrid[]) {
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
    const grass = new THREE.Mesh(grassG, new THREE.MeshLambertMaterial({ color: PALETTE.grass }));
    grass.position.y = -0.01;
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
    // B 가상통과제한선: 폴에서 위로
    for (const r of [site.B.rE, site.B.rF]) {
      seg(dashed, new THREE.Vector3(0, 0, r), new THREE.Vector3(0, site.beta + 1.6, r));
    }
    const solidG = new THREE.BufferGeometry();
    solidG.setAttribute('position', new THREE.Float32BufferAttribute(solid, 3));
    this.group.add(new THREE.LineSegments(solidG, new THREE.LineBasicMaterial({ color: 0xffffff })));
    const dashG = new THREE.BufferGeometry();
    dashG.setAttribute('position', new THREE.Float32BufferAttribute(dashed, 3));
    const dl = new THREE.LineSegments(dashG, new THREE.LineDashedMaterial({ color: 0x1d1b2e, dashSize: 0.25, gapSize: 0.18 }));
    dl.computeLineDistances();
    this.group.add(dl);
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

    this.addSurroundings(site);
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
export class SoilView {
  readonly meshes: THREE.Mesh[] = [];
  private base = new THREE.Color(PALETTE.dirt);
  private ground = new THREE.Color(PALETTE.sand);
  private dark = new THREE.Color(0x7d5a35);
  private tmp = new THREE.Color();
  constructor(private grids: SoilGrid[]) {
    for (const g of grids) {
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
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      this.meshes.push(mesh);
      g.dirty = true;
    }
  }
  sync() {
    this.grids.forEach((g, gi) => {
      if (!g.dirty) return;
      g.dirty = false;
      const geo = this.meshes[gi].geometry;
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const col = geo.getAttribute('color') as THREE.BufferAttribute;
      const { h, h0, floor, nx, nz } = g;
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          pos.setY(k, h[k]);
          void floor;
          if (Math.abs(h[k] - h0[k]) < 0.003 && h0[k] === 0) {
            col.setXYZ(k, this.ground.r, this.ground.g, this.ground.b);
            continue;
          }
          // 오목하면 어둡게(가짜 그늘), 볼록하면 밝게
          const nb =
            (i > 0 ? h[k - 1] : h[k]) + (i < nx - 1 ? h[k + 1] : h[k]) + (j > 0 ? h[k - nx] : h[k]) + (j < nz - 1 ? h[k + nx] : h[k]);
          const lap = h[k] - nb / 4;
          const depthShade = Math.min(1, Math.max(0, -h[k] / 1.6));
          this.tmp.copy(this.base).lerp(this.dark, depthShade * 0.6);
          const s = THREE.MathUtils.clamp(1 + lap * 8, 0.7, 1.25);
          col.setXYZ(k, this.tmp.r * s, this.tmp.g * s, this.tmp.b * s);
        }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      geo.computeVertexNormals();
    });
  }
}

/** 떨어지는 흙 덩어리 + 떨어진 자리 먼지 + 버킷 그림자 */
const CLUMPS = 3; // 입자 하나를 덩어리 3개로 그림
const MAX_P = 160;
const MAX_DUST = 40;
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
  constructor() {
    this.particles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.06, 0), toon(0xffffff).clone(), MAX_P * CLUMPS);
    this.particles.count = 0;
    this.particles.frustumCulled = false;
    // 흙 덩어리 색: 마른 황토 / 젖은 짙은 흙 / 모래빛 섞기
    const tones = [new THREE.Color(PALETTE.dirt), new THREE.Color(0x8a5f37), new THREE.Color(0xc9a06a)];
    for (let i = 0; i < MAX_P * CLUMPS; i++) this.particles.setColorAt(i, tones[Math.floor(hash(i * 3.1) * 3)]);
    const dustMat = new THREE.MeshBasicMaterial({ color: 0xd8bf96, transparent: true, opacity: 0.4, depthWrite: false });
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
    const n = Math.min(s.particles.length, MAX_P);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const pt = s.particles[i];
      const big = Math.cbrt(Math.max(pt.vol, 0.0005) / 0.004);
      for (let j = 0; j < CLUMPS; j++) {
        const h = pt.id * 7 + j;
        const sz = (0.7 + hash(h) * 0.9) * THREE.MathUtils.clamp(big, 0.5, 1.6);
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
      else if (this.puffs.length < MAX_DUST) this.puffs.push({ x: ev.p.x, y, z: ev.p.z, age: 0, life: 0.9 + Math.random() * 0.5, size });
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
