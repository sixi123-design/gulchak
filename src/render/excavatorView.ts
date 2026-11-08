import * as THREE from 'three';
import type { MachineSpec } from '../config/machine';
import type { DigSession } from '../sim/session';
import { box, outlineMat, PALETTE, toon, withOutline } from './toon';

/** 버킷 단면: 핀(0,0) → 등판 곡선 → 힐 → 끝. 개구부는 -y 쪽 */
function bucketShapes(m: MachineSpec) {
  const tip = new THREE.Vector2(m.L3, 0);
  const heel = new THREE.Vector2(Math.cos(m.heelAngle) * m.heelLen, Math.sin(m.heelAngle) * m.heelLen);
  const outer: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(-0.05, 0.3),
    new THREE.Vector2(heel.x * 0.55, heel.y * 1.05),
    heel,
    new THREE.Vector2(heel.x + (tip.x - heel.x) * 0.55, heel.y * 0.55),
    tip,
  ];
  const chord = (p: THREE.Vector2) => {
    const t = THREE.MathUtils.clamp(p.dot(tip) / tip.lengthSq(), 0, 1);
    return tip.clone().multiplyScalar(t);
  };
  const inner = outer.slice(1, -1).map((p) => chord(p).lerp(p, 0.78)).reverse();
  const shell = new THREE.Shape([...outer, new THREE.Vector2(tip.x - 0.06, 0.03), ...inner, new THREE.Vector2(0.06, 0.03)]);
  const side = new THREE.Shape(outer);
  return { shell, side, tip, heel };
}

export class ExcavatorView {
  readonly root = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly boom = new THREE.Group();
  readonly arm = new THREE.Group();
  readonly bucket = new THREE.Group();
  private loadMesh: THREE.Mesh;
  private cabParts: THREE.Object3D[] = [];
  private cylinders: { mesh: THREE.Mesh; a: THREE.Object3D; b: THREE.Object3D }[] = [];
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(m: MachineSpec) {
    const C = PALETTE;
    // 하부 주행체 (x축 방향으로 놓임)
    const chassis = box(3.0, 0.55, 1.6, C.steel);
    chassis.position.y = 0.95;
    this.root.add(chassis);
    const wheelG = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 14);
    wheelG.rotateX(Math.PI / 2);
    for (const x of [-m.wheelbase / 2, m.wheelbase / 2]) {
      for (const z of [-0.95, 0.95]) {
        const w = new THREE.Mesh(wheelG, toon(C.tire));
        withOutline(w, new THREE.Vector3(1.1, 1.1, 0.45), 0.04);
        w.position.set(x, 0.55, z);
        this.root.add(w);
      }
    }
    const blade = box(0.25, 0.55, 2.4, C.sunDeep, 0.04);
    blade.position.set(m.wheelbase / 2 + 0.9, 0.45, 0);
    this.root.add(blade);
    const turntable = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.25, 16), toon(C.ink));
    turntable.position.y = 1.3;
    this.root.add(turntable);

    // 상부 선회체 (로컬 +x = 작업 방향, -z = 운전석 쪽)
    this.root.add(this.upper);
    const house = box(2.6, 1.05, 2.3, C.sun);
    house.position.set(-0.75, 1.95, 0.15);
    this.upper.add(house);
    const counter = box(0.7, 0.9, 2.3, C.sunDeep);
    counter.position.set(-2.25, 1.85, 0.15);
    this.upper.add(counter);
    const cab = box(1.35, 1.35, 0.95, C.sun);
    cab.position.set(0.35, 2.75, -0.7);
    this.upper.add(cab);
    const glass = box(0.05, 0.85, 0.8, C.glass, 0);
    glass.position.set(1.04, 2.85, -0.7);
    this.upper.add(glass);
    const glassSide = box(0.9, 0.75, 0.05, C.glass, 0);
    glassSide.position.set(0.4, 2.85, -1.18);
    this.upper.add(glassSide);
    this.cabParts.push(cab, glass, glassSide);
    const pipe = box(0.16, 0.6, 0.16, C.ink, 0);
    pipe.position.set(-1.5, 2.75, 0.8);
    this.upper.add(pipe);

    // 붐
    this.boom.position.set(m.boomFoot.r, m.boomFoot.y, 0.1);
    this.upper.add(this.boom);
    const boomMesh = box(m.L1, 0.42, 0.36, C.sun);
    boomMesh.position.x = m.L1 / 2;
    this.boom.add(boomMesh);
    // 암
    this.arm.position.x = m.L1;
    this.boom.add(this.arm);
    const armMesh = box(m.L2 + 0.25, 0.32, 0.28, C.sun);
    armMesh.position.x = m.L2 / 2 - 0.1;
    this.arm.add(armMesh);
    // 버킷
    this.bucket.position.x = m.L2;
    this.arm.add(this.bucket);
    const { shell, side } = bucketShapes(m);
    const W = m.bucketWidth;
    const shellG = new THREE.ExtrudeGeometry(shell, { depth: W, bevelEnabled: false });
    shellG.translate(0, 0, -W / 2);
    const shellM = new THREE.Mesh(shellG, toon(C.steel));
    withOutline(shellM, new THREE.Vector3(1.2, 0.8, W), 0.035);
    this.bucket.add(shellM);
    const sideG = new THREE.ExtrudeGeometry(side, { depth: 0.04, bevelEnabled: false });
    for (const z of [-W / 2 - 0.04, W / 2]) {
      const sm = new THREE.Mesh(sideG, toon(C.steel));
      sm.position.z = z;
      sm.add(new THREE.Mesh(sideG, outlineMat)).scale.set(1.04, 1.06, 2.2);
      this.bucket.add(sm);
    }
    // 이빨
    const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, W * 0.95), toon(C.poleCap));
    teeth.position.set(m.L3 + 0.02, 0, 0);
    this.bucket.add(teeth);
    // 적재 흙
    this.loadMesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(C.dirt));
    this.bucket.add(this.loadMesh);

    // 유압 실린더 (양 끝을 잇는 원통)
    const anchor = (parent: THREE.Object3D, x: number, y: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, 0);
      parent.add(o);
      return o;
    };
    const cyl = (a: THREE.Object3D, b: THREE.Object3D, r: number) => {
      const g = new THREE.CylinderGeometry(r, r, 1, 8);
      g.translate(0, 0.5, 0);
      const mesh = new THREE.Mesh(g, toon(C.ink));
      this.root.add(mesh);
      this.cylinders.push({ mesh, a, b });
    };
    cyl(anchor(this.upper, m.boomFoot.r + 0.5, 1.45), anchor(this.boom, 1.9, -0.25), 0.11);
    cyl(anchor(this.boom, 2.6, 0.35), anchor(this.arm, -0.35, 0.25), 0.09);
    cyl(anchor(this.arm, 0.5, 0.22), anchor(this.bucket, -0.08, 0.32), 0.07);
  }

  /** 운전석 시점에서는 운전석 모형을 숨겨 카메라가 갇히지 않게 한다 */
  setCabView(on: boolean) {
    for (const o of this.cabParts) o.visible = !on;
  }

  sync(s: DigSession) {
    const p = s.pose;
    this.upper.rotation.y = -p.swing;
    this.boom.rotation.z = p.boom;
    this.arm.rotation.z = p.arm;
    this.bucket.rotation.z = p.bucket;
    const fill = Math.min(1.3, s.load / s.m.struckCapacity);
    this.loadMesh.visible = fill > 0.03;
    if (this.loadMesh.visible) {
      // 개구부(-y) 쪽에 흙더미를 엎어 놓은 모양
      this.loadMesh.position.set(s.m.L3 * 0.5, 0.02, 0);
      this.loadMesh.rotation.set(Math.PI, 0, 0);
      this.loadMesh.scale.set(1.0, 0.15 + 0.45 * fill, s.m.bucketWidth * 0.95);
    }
    this.root.updateMatrixWorld(true);
    for (const c of this.cylinders) {
      c.a.getWorldPosition(this.tmpA);
      c.b.getWorldPosition(this.tmpB);
      const dir = this.tmpB.clone().sub(this.tmpA);
      const L = dir.length();
      c.mesh.position.copy(this.tmpA);
      c.mesh.quaternion.setFromUnitVectors(this.up, dir.normalize());
      c.mesh.scale.set(1, L, 1);
    }
  }
}
