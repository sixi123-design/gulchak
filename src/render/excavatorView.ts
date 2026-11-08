import * as THREE from 'three';
import type { MachineSpec } from '../config/machine';
import type { DigSession } from '../sim/session';
import { box, outlineMat, PALETTE, toon, withOutline } from './toon';

/** 버킷 단면: 핀(0,0) → 등판 곡선 → 힐 → 끝. 개구부는 -y 쪽 */
function bucketShapes(m: MachineSpec) {
  const tip = new THREE.Vector2(m.L3, 0);
  const heel = new THREE.Vector2(Math.cos(m.heelAngle) * m.heelLen, Math.sin(m.heelAngle) * m.heelLen);
  // 범용(GP) 버킷: 곧은 뒷판 → 둥근 바닥 → 곧은 바닥판 → 날 끝
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
  private cabInterior!: THREE.Group;
  /** 운전석 눈 위치 (상부 선회체 로컬) */
  static readonly EYE = new THREE.Vector3(0.32, 2.62, -0.7);
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
    // 차체는 운전석 오른쪽(붐 쪽)과 뒤쪽에만 — 운전석 자리를 비운다
    const house = box(2.6, 1.05, 1.45, C.sun);
    house.position.set(-0.75, 1.95, 0.52);
    this.upper.add(house);
    const hood = box(1.75, 0.95, 0.95, C.sun);
    hood.position.set(-1.18, 1.9, -0.7);
    this.upper.add(hood);
    const deck = box(1.35, 0.12, 1.0, C.steel, 0.03); // 운전석 바닥 받침
    deck.position.set(0.35, 1.39, -0.7);
    this.upper.add(deck);
    const counter = box(0.7, 0.9, 2.3, C.sunDeep);
    counter.position.set(-2.25, 1.85, 0.15);
    this.upper.add(counter);
    // 운전석: 붐 왼쪽 앞 (바닥 약 1.45m, 지붕 약 3.15m)
    const cab = box(1.3, 1.7, 0.95, C.sun);
    cab.position.set(0.35, 2.3, -0.7);
    this.upper.add(cab);
    const glass = box(0.05, 1.35, 0.8, C.glass, 0);
    glass.position.set(1.01, 2.35, -0.7);
    this.upper.add(glass);
    const glassSide = box(0.9, 1.0, 0.05, C.glass, 0);
    glassSide.position.set(0.35, 2.5, -1.18);
    this.upper.add(glassSide);
    this.cabParts.push(cab, glass, glassSide);
    this.cabInterior = this.buildCabInterior();
    this.upper.add(this.cabInterior);
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
    const shellM = new THREE.Mesh(shellG, toon(C.rust));
    withOutline(shellM, new THREE.Vector3(1.4, 0.9, W), 0.035);
    this.bucket.add(shellM);
    // 두꺼운 옆판
    const sideG = new THREE.ExtrudeGeometry(side, { depth: 0.06, bevelEnabled: false });
    for (const z of [-W / 2 - 0.06, W / 2]) {
      const sm = new THREE.Mesh(sideG, toon(C.rustDark));
      sm.position.z = z;
      sm.add(new THREE.Mesh(sideG, outlineMat)).scale.set(1.04, 1.06, 2.0);
      this.bucket.add(sm);
    }
    // 날판 + 이빨 5개 (닳은 금속색)
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, W + 0.1), toon(C.metal));
    edge.position.set(m.L3 - 0.04, 0.01, 0);
    this.bucket.add(edge);
    const toothG = new THREE.ConeGeometry(0.045, 0.2, 4);
    toothG.rotateZ(-Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Mesh(toothG, toon(C.metal));
      t.position.set(m.L3 + 0.08, 0.0, -W / 2 + 0.08 + ((W - 0.16) * i) / 4);
      this.bucket.add(t);
    }
    // 위쪽 링크 브래킷
    for (const z of [-0.18, 0.18]) {
      const ear = box(0.34, 0.16, 0.05, C.rustDark, 0.02);
      ear.position.set(0.05, 0.22, z);
      this.bucket.add(ear);
    }
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

  /** 운전석 시점: 외부 모형을 숨기고 내부 프레임(기둥·지붕·핸들·미러)을 보인다 */
  setCabView(on: boolean) {
    for (const o of this.cabParts) o.visible = !on;
    this.cabInterior.visible = on;
  }

  /** 월드 좌표: 운전석 눈, 버킷 끝 */
  eyeWorld(out: THREE.Vector3) {
    return this.upper.localToWorld(out.copy(ExcavatorView.EYE));
  }
  bucketWorld(out: THREE.Vector3) {
    return this.bucket.localToWorld(out.set(0.6, -0.1, 0));
  }

  /** 운전석 내부: 실제 휠 굴착기 운전석 시야 구성 (리서치_시험장_화면.md 3장) */
  private buildCabInterior() {
    const g = new THREE.Group();
    g.visible = false;
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.cabin });
    const dash = new THREE.MeshBasicMaterial({ color: 0x3a3946 });
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material = mat) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      g.add(b);
      return b;
    };
    // 앞유리 테두리: 양쪽 기둥, 위·아래 프레임
    add(0.07, 1.7, 0.06, 1.0, 2.3, -1.15); // 왼쪽 A필러
    add(0.07, 1.7, 0.07, 1.0, 2.3, -0.25); // 오른쪽 A필러 (붐 쪽)
    add(0.12, 0.12, 1.0, 1.0, 3.1, -0.7); // 위 프레임
    add(0.1, 0.12, 1.0, 1.0, 1.55, -0.7); // 아래 프레임 (앞유리가 바닥 근처까지)
    add(1.4, 0.06, 1.0, 0.35, 3.17, -0.7); // 지붕
    // 옆창 프레임
    add(0.09, 1.7, 0.09, -0.3, 2.3, -1.15);
    add(1.3, 0.1, 0.09, 0.35, 3.1, -1.15);
    add(1.3, 0.5, 0.09, 0.35, 1.7, -1.15);
    add(1.3, 0.1, 0.09, 0.35, 3.1, -0.25);
    add(1.3, 0.55, 0.09, 0.35, 1.72, -0.25);
    // 계기판·핸들 (휠 굴착기): 낮게, 핸들 너머로 구덩이가 보이게
    add(0.22, 0.16, 0.42, 0.78, 1.88, -0.72, dash);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 6), mat);
    col.position.set(0.76, 1.95, -0.72);
    col.rotation.z = 0.75;
    g.add(col);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.024, 6, 22), mat);
    wheel.position.set(0.66, 2.06, -0.72);
    wheel.rotation.y = Math.PI / 2;
    wheel.rotation.x = 0.7;
    g.add(wheel);
    // 왼쪽 기둥 바깥 둥근 미러
    const mirror = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: 0x8fb4c8, side: THREE.DoubleSide }));
    mirror.position.set(1.12, 2.75, -1.32);
    mirror.rotation.y = Math.PI / 2 + 0.5;
    g.add(mirror);
    add(0.2, 0.03, 0.03, 1.06, 2.75, -1.22);
    // 좌우 레버 손잡이
    for (const z of [-1.02, -0.38]) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat);
      k.position.set(0.3, 1.95, z);
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
    // 차체 흔들림: 버킷 방향으로 숙임(pitch), 좌우 기울기(roll)
    this.axA.set(-Math.sin(p.swing), 0, Math.cos(p.swing)); // 측면 축
    this.axB.set(Math.cos(p.swing), 0, Math.sin(p.swing)); // 전방 축
    this.qa.setFromAxisAngle(this.axA, -s.rock.pitch + s.lift);
    this.qb.setFromAxisAngle(this.axB, s.rock.roll);
    this.root.quaternion.copy(this.qa).multiply(this.qb);
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
