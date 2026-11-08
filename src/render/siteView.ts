import * as THREE from 'three';
import type { DigSession } from '../sim/session';
import { stationPoint, type Site } from '../sim/site';
import type { SoilGrid } from '../sim/soil';
import { PALETTE, toon } from './toon';

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

    // B 통과구역 표시 (반투명)
    const passH = site.beta + 1.2 - site.B.ropeY;
    const pass = new THREE.Mesh(
      new THREE.PlaneGeometry(site.B.rF - site.B.rE, passH),
      new THREE.MeshBasicMaterial({ color: PALETTE.pass, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    pass.rotation.y = Math.PI / 2;
    pass.position.set(0, site.B.ropeY + passH / 2, (site.B.rE + site.B.rF) / 2);
    this.group.add(pass);

    // 폴: 인스턴싱 (몸통 빨강 + 흰 머리)
    const poleG = new THREE.CylinderGeometry(0.045, 0.045, 1, 8);
    poleG.translate(0, 0.5, 0);
    const poles = new THREE.InstancedMesh(poleG, toon(PALETTE.pole), site.poles.length);
    const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), toon(PALETTE.poleCap), site.poles.length);
    const mtx = new THREE.Matrix4();
    site.poles.forEach((p, i) => {
      mtx.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.h, 1));
      poles.setMatrixAt(i, mtx);
      mtx.makeTranslation(p.x, p.h, p.z);
      caps.setMatrixAt(i, mtx);
    });
    this.group.add(poles, caps);

    // 줄: 얇은 상자 인스턴싱
    const ropeG = new THREE.BoxGeometry(1, 0.035, 0.035);
    const ropes = new THREE.InstancedMesh(ropeG, toon(PALETTE.rope), site.ropes.length);
    site.ropes.forEach((r, i) => {
      const a = new THREE.Vector3(r.a.x, r.a.y, r.a.z);
      const b = new THREE.Vector3(r.b.x, r.b.y, r.b.z);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
      mtx.compose(mid, q, new THREE.Vector3(dir.length(), 1, 1));
      ropes.setMatrixAt(i, mtx);
    });
    this.group.add(ropes);
  }
}

/** 흙 높이맵 메시 */
export class SoilView {
  readonly meshes: THREE.Mesh[] = [];
  private base = new THREE.Color(PALETTE.dirt);
  private ground = new THREE.Color(PALETTE.yard);
  private dark = new THREE.Color(0x5c3418);
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
          const loose = h[k] - floor[k] > 0.004 || floor[k] < -0.01;
          if (!loose && Math.abs(h[k] - h0[k]) < 0.003) {
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

/** 떨어지는 흙 입자 + 버킷 그림자 */
export class FxView {
  readonly particles: THREE.InstancedMesh;
  readonly bucketShadow: THREE.Mesh;
  readonly machineShadow: THREE.Mesh;
  private mtx = new THREE.Matrix4();
  constructor() {
    this.particles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), toon(PALETTE.dirt), 160);
    this.particles.count = 0;
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1d1b2e, transparent: true, opacity: 0.3, depthWrite: false });
    this.bucketShadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), shadowMat);
    this.bucketShadow.rotation.x = -Math.PI / 2;
    this.machineShadow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), shadowMat.clone());
    this.machineShadow.rotation.x = -Math.PI / 2;
    this.machineShadow.position.y = 0.01;
    (this.machineShadow.material as THREE.MeshBasicMaterial).opacity = 0.22;
  }
  sync(s: DigSession) {
    const n = Math.min(s.particles.length, 160);
    for (let i = 0; i < n; i++) {
      const p = s.particles[i].p;
      this.mtx.makeTranslation(p.x, p.y, p.z);
      this.particles.setMatrixAt(i, this.mtx);
    }
    this.particles.count = n;
    this.particles.instanceMatrix.needsUpdate = true;
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
