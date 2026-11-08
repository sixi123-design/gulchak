import * as THREE from 'three';
import { box, toon, withOutline } from './toon';

/**
 * 실제 시험 감독관 3명 (원본 디자인: 안전모·형광 조끼·서류판).
 * 평소엔 장비(버킷)를 지켜보며 몸을 돌리고, 실격이면 팔을 들고 호각, 시간 초과면 초시계를 든다.
 */
const C = {
  vest: 0xc8f03c,
  stripe: 0xe8e8f0,
  shirt: 0x4a6fa5,
  pants: 0x2b2f45,
  skin: 0xf0c49a,
  hat: 0xffffff,
  board: 0x8a5a32,
  watch: 0xd8dde3,
};

class Person {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private armR = new THREE.Group();
  private armL = new THREE.Group();
  readonly watch: THREE.Group;
  /** 팔 들기 0~1 */
  raise = 0;
  raiseTarget = 0;
  private yaw = 0;
  private phase = Math.random() * 6;
  constructor(withWatch: boolean) {
    const add = (g: THREE.Object3D, m: THREE.Mesh, x: number, y: number, z: number) => {
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    this.root.add(this.body);
    for (const x of [-0.1, 0.1]) add(this.body, box(0.17, 0.82, 0.2, C.pants, 0.03), x, 0.41, 0);
    add(this.body, box(0.48, 0.64, 0.3, C.vest, 0.03), 0, 1.14, 0);
    for (const y of [1.0, 1.22]) add(this.body, box(0.49, 0.05, 0.31, C.stripe, 0), 0, y, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 5), toon(C.skin));
    withOutline(head, new THREE.Vector3(0.26, 0.26, 0.26), 0.025);
    add(this.body, head, 0, 1.6, 0);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.155, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), toon(C.hat));
    withOutline(hat, new THREE.Vector3(0.31, 0.16, 0.31), 0.025);
    add(this.body, hat, 0, 1.66, 0);
    add(this.body, box(0.34, 0.025, 0.36, C.hat, 0.015), 0, 1.66, 0.03);
    // 팔: 어깨 축에서 아래로
    for (const [g, x] of [
      [this.armR, -0.3],
      [this.armL, 0.3],
    ] as const) {
      g.position.set(x, 1.4, 0);
      add(g, box(0.13, 0.62, 0.13, C.shirt, 0.025), 0, -0.3, 0);
      this.body.add(g);
    }
    // 왼손 서류판
    const board = box(0.24, 0.32, 0.025, C.board, 0.015);
    board.position.set(0.02, -0.55, 0.12);
    board.rotation.x = -0.5;
    this.armL.add(board);
    this.armL.rotation.x = -0.6;
    // 오른손 초시계 (시간 감독관만, 들 때 보임)
    this.watch = new THREE.Group();
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 8).rotateX(Math.PI / 2), toon(C.watch));
    withOutline(w, new THREE.Vector3(0.22, 0.22, 0.05), 0.02);
    this.watch.add(w);
    this.watch.add(box(0.03, 0.04, 0.03, C.watch, 0).translateY(0.09));
    this.watch.position.set(0, -0.66, 0.05);
    this.watch.visible = false;
    if (withWatch) this.armR.add(this.watch);
  }
  update(dt: number, t: number, look: THREE.Vector3) {
    // 지켜보는 쪽으로 천천히 몸을 돌림
    const want = Math.atan2(look.x - this.root.position.x, look.z - this.root.position.z);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-dt * 1.5));
    this.root.rotation.y = this.yaw;
    this.body.position.y = Math.sin(t * 1.3 + this.phase) * 0.008;
    this.raise += (this.raiseTarget - this.raise) * (1 - Math.exp(-dt * 10));
    // 오른팔: 내림 → 위로 번쩍
    this.armR.rotation.x = -this.raise * Math.PI * 0.92;
    this.armR.rotation.z = this.raise * 0.15;
  }
}

export class ExaminerView {
  readonly group = new THREE.Group();
  readonly people: Person[] = [];
  /** 시간을 재는 감독관 번호 */
  readonly timer = 2;
  private look = new THREE.Vector3();
  constructor(spots: [number, number][]) {
    spots.forEach(([x, z], i) => {
      const p = new Person(i === this.timer);
      p.root.position.set(x, 0, z);
      this.people.push(p);
      this.group.add(p.root);
    });
  }
  /** 버킷을 지켜봄 */
  update(dt: number, t: number, bucket: THREE.Vector3) {
    this.look.copy(bucket);
    for (const p of this.people) p.update(dt, t, this.look);
  }
  nearest(at: { x: number; z: number }): number {
    let best = 0;
    let bd = Infinity;
    this.people.forEach((p, i) => {
      const d = Math.hypot(p.root.position.x - at.x, p.root.position.z - at.z);
      if (d < bd) (bd = d), (best = i);
    });
    return best;
  }
  /** 실격 신호: 팔을 번쩍 (시간 초과면 초시계를 든 손) */
  signal(i: number, watch = false) {
    const p = this.people[i];
    p.raiseTarget = 1;
    p.watch.visible = watch;
  }
  /** 사람 i의 얼굴 높이 위치 */
  headOf(i: number, out: THREE.Vector3) {
    return out.copy(this.people[i].root.position).setY(1.5);
  }
}
