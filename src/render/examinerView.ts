import * as THREE from 'three';
import { box, toon, withOutline } from './toon';

/**
 * 실제 시험 감독위원 3명 (원본 디자인: 흰 안전모·에메랄드 감독위원 조끼·완장·서류판).
 * 평소엔 장비(버킷)를 지켜보며 몸을 돌리고, 실격이면 팔을 들고 호각, 시간 초과면 초시계를 든다.
 */
const C = {
  vest: 0x0e8a6e, // 에메랄드: 남색 벽·회청 바닥과 구분
  stripe: 0xd8dde6,
  shirt: 0xeef2f6,
  pants: 0x2a2d33,
  shoe: 0x15171a,
  band: 0xffc23a,
  hatBand: 0x1f2f4f,
  skin: 0xf0c49a,
  hat: 0xffffff,
  board: 0x8a5a32,
  watch: 0xd8dde3,
  shade: 0x14161c, // 선글라스
};

let vestTex: THREE.CanvasTexture | null = null;
/** 조끼 등판 글자 */
function vestText() {
  if (vestTex) return vestTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0e8a6e';
  g.fillRect(0, 0, 256, 80);
  g.fillStyle = '#ffffff';
  g.font = '800 52px system-ui, "Malgun Gothic", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('감독위원', 128, 42);
  vestTex = new THREE.CanvasTexture(c);
  vestTex.colorSpace = THREE.SRGBColorSpace;
  return vestTex;
}

/** 둥근 부품 (외곽선 포함) */
function part(geo: THREE.BufferGeometry, color: number, outline = 0.02) {
  const m = new THREE.Mesh(geo, toon(color));
  if (outline > 0) {
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    withOutline(m, new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), outline);
  }
  return m;
}
const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 10);

/** 몸 전체 크기(키 약 1.68m), 머리 크기 */
const BODY_SCALE = 0.93;
const HEAD_SCALE = 1.18;

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
  private elbowR = new THREE.Group();
  constructor(withWatch: boolean) {
    const add = <T extends THREE.Object3D>(g: THREE.Object3D, m: T, x: number, y: number, z: number) => {
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    this.root.add(this.body);
    // 다리: 허벅지·정강이 (살짝 벌리고 선 자세), 둥근 안전화
    for (const x of [-0.1, 0.1]) {
      add(this.body, part(cap(0.085, 0.3), C.pants), x, 0.7, 0);
      add(this.body, part(cap(0.07, 0.32), C.pants), x, 0.3, 0.01);
      const shoe = part(cap(0.065, 0.14).rotateX(Math.PI / 2), C.shoe, 0.015);
      shoe.scale.set(1.15, 0.7, 1);
      add(this.body, shoe, x, 0.055, 0.05);
    }
    // 골반·허리 (벨트)
    const hip = part(new THREE.CylinderGeometry(0.19, 0.18, 0.2, 12), C.pants);
    hip.scale.z = 0.7;
    add(this.body, hip, 0, 0.92, 0);
    const belt = part(new THREE.CylinderGeometry(0.195, 0.195, 0.04, 12), 0x1b1c20, 0);
    belt.scale.z = 0.72;
    add(this.body, belt, 0, 1.01, 0);
    // 몸통: 흰 셔츠 위 에메랄드 감독위원 조끼 (앞 지퍼, 반사띠 1줄)
    const torso = part(new THREE.CylinderGeometry(0.205, 0.175, 0.5, 12), C.shirt);
    torso.scale.z = 0.68;
    add(this.body, torso, 0, 1.24, 0);
    const vest = part(new THREE.CylinderGeometry(0.22, 0.19, 0.44, 12), C.vest, 0.015);
    vest.scale.z = 0.72;
    add(this.body, vest, 0, 1.2, 0);
    const stripe = part(new THREE.CylinderGeometry(0.223, 0.214, 0.04, 12), C.stripe, 0);
    stripe.scale.z = 0.73;
    add(this.body, stripe, 0, 1.09, 0);
    add(this.body, box(0.015, 0.42, 0.01, 0x0a5c4a, 0), 0, 1.2, 0.158);
    // 승모근: 목에서 어깨로 비스듬히 내려가는 선 (어깨가 솟아 보이지 않게)
    const trap = part(new THREE.CylinderGeometry(0.07, 0.205, 0.09, 12), C.shirt, 0.015);
    trap.scale.z = 0.66;
    add(this.body, trap, 0, 1.52, 0);
    // 어깨 (둥글게, 몸통 윗면보다 조금 아래)
    for (const x of [-0.205, 0.205]) add(this.body, part(new THREE.SphereGeometry(0.08, 10, 8), C.shirt, 0.015), x, 1.41, 0);
    // 등: '감독위원' 글자
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.11), new THREE.MeshBasicMaterial({ map: vestText() }));
    back.rotation.y = Math.PI;
    add(this.body, back, 0, 1.28, -0.161);
    // 목에 건 출입증 (줄 + 카드)
    add(this.body, box(0.07, 0.095, 0.008, 0xffffff, 0), 0.07, 1.26, 0.165);
    add(this.body, box(0.012, 0.16, 0.006, 0x1f2f4f, 0), 0.05, 1.37, 0.15).rotation.z = 0.35;
    // 목·머리 (코·귀)
    add(this.body, part(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), C.skin, 0), 0, 1.5, 0);
    const head = part(new THREE.SphereGeometry(0.105, 16, 12), C.skin);
    head.scale.set(0.92, 1.1, 1);
    add(this.body, head, 0, 1.63, 0.005);
    add(this.body, part(new THREE.SphereGeometry(0.02, 8, 6), C.skin, 0), 0, 1.61, 0.105);
    for (const x of [-0.096, 0.096]) {
      const ear = part(new THREE.SphereGeometry(0.025, 8, 6), C.skin, 0);
      ear.scale.set(0.5, 1, 0.8);
      add(this.body, ear, x, 1.62, 0);
    }
    // 선글라스: 짙은 렌즈 두 알 + 코걸이 + 다리 (얼굴 곡면 따라 살짝 감쌈)
    for (const x of [-0.042, 0.042]) {
      const lens = box(0.06, 0.032, 0.01, C.shade, 0.006);
      lens.rotation.y = x * 4;
      add(this.body, lens, x, 1.645, 0.1);
      const arm = box(0.006, 0.008, 0.1, C.shade, 0);
      add(this.body, arm, x > 0 ? 0.093 : -0.093, 1.648, 0.05);
    }
    add(this.body, box(0.026, 0.006, 0.008, C.shade, 0), 0, 1.652, 0.106);
    // 흰 안전모: 둥근 머리통 + 가운데 줄기 + 앞챙
    const dome = part(new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), C.hat);
    dome.scale.set(0.95, 0.9, 1.08);
    add(this.body, dome, 0, 1.68, 0);
    add(this.body, part(new THREE.CylinderGeometry(0.15, 0.155, 0.014, 18), C.hat, 0.012), 0, 1.68, 0.025).scale.set(0.95, 1, 1.15);
    add(this.body, box(0.03, 0.02, 0.24, 0xe9edf2, 0), 0, 1.795, 0);
    add(this.body, part(new THREE.CylinderGeometry(0.128, 0.128, 0.03, 16), C.hatBand, 0), 0, 1.7, 0).scale.set(0.96, 1, 1.09);
    // 팔: 어깨 → 위팔 → 팔꿈치 → 아래팔·손
    const arm = (g: THREE.Group, elbow: THREE.Group, x: number) => {
      g.position.set(x, 1.4, 0);
      add(g, part(cap(0.055, 0.2), C.shirt, 0.015), 0, -0.14, 0);
      elbow.position.set(0, -0.29, 0);
      g.add(elbow);
      add(elbow, part(cap(0.047, 0.19), C.shirt, 0.015), 0, -0.13, 0);
      const hand = part(new THREE.SphereGeometry(0.048, 10, 8), C.skin, 0.012);
      hand.scale.set(0.8, 1.15, 0.9);
      add(elbow, hand, 0, -0.29, 0);
      this.body.add(g);
    };
    const elbowL = new THREE.Group();
    arm(this.armR, this.elbowR, -0.245);
    arm(this.armL, elbowL, 0.245);
    // 팔을 몸에서 살짝 떼어 편하게 (오른팔은 -z가 바깥, 왼팔은 +z)
    this.armL.rotation.z = 0.14;
    // 왼팔 노란 완장
    add(this.armL, part(new THREE.CylinderGeometry(0.062, 0.062, 0.07, 12), C.band, 0), 0, -0.1, 0);
    // 왼손 서류판: 팔꿈치 굽혀 가슴 앞에 (집게 달린 판 + 종이)
    this.armL.rotation.x = -0.25;
    elbowL.rotation.x = -1.25;
    const board = new THREE.Group();
    board.add(box(0.23, 0.31, 0.015, C.board, 0.012));
    board.add(box(0.2, 0.26, 0.004, 0xf7f7f2, 0).translateZ(0.01).translateY(-0.015));
    board.add(box(0.08, 0.03, 0.02, 0x9aa0a8, 0).translateY(0.15).translateZ(0.012));
    board.position.set(-0.04, -0.3, 0.07);
    board.rotation.set(0.3, 0, 0.15);
    elbowL.add(board);
    // 오른손 초시계 (시간 감독관만, 들 때 보임)
    this.watch = new THREE.Group();
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16).rotateX(Math.PI / 2), toon(C.watch));
    withOutline(w, new THREE.Vector3(0.12, 0.12, 0.03), 0.012);
    this.watch.add(w);
    this.watch.add(box(0.02, 0.03, 0.02, C.watch, 0).translateY(0.07));
    this.watch.position.set(0, -0.33, 0.04);
    this.watch.visible = false;
    if (withWatch) this.elbowR.add(this.watch);
    // 오른팔: 살짝 굽혀 편하게
    this.elbowR.rotation.x = -0.2;
    // 머리(얼굴·선글라스·안전모)를 목 위에서 한 덩어리로 키움
    const NECK = 1.55;
    const headG = new THREE.Group();
    headG.position.set(0, NECK, 0);
    for (const c of [...this.body.children]) {
      if (c.position.y > 1.56) {
        c.position.y -= NECK;
        headG.add(c);
      }
    }
    headG.scale.setScalar(HEAD_SCALE);
    this.body.add(headG);
    // 키는 조금 작게
    this.body.scale.setScalar(BODY_SCALE);
  }
  /** 바로 그쪽을 보게 (처음 서 있을 때) */
  snap(look: THREE.Vector3) {
    this.yaw = Math.atan2(look.x - this.root.position.x, look.z - this.root.position.z);
    this.root.rotation.y = this.yaw;
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
    this.armR.rotation.z = -0.14 * (1 - this.raise) + this.raise * 0.15;
    // 들 때 팔꿈치 펴기
    this.elbowR.rotation.x = -0.2 * (1 - this.raise);
  }
}

export class ExaminerView {
  readonly group = new THREE.Group();
  readonly people: Person[] = [];
  /** 시간을 재는 감독관 번호 */
  readonly timer = 2;
  private look = new THREE.Vector3();
  private moves = new Map<number, { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number }>();
  /** 사람 i만 따로 바라볼 곳 (없으면 버킷) */
  private lookAt = new Map<number, THREE.Vector3>();
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
    this.people.forEach((p, i) => {
      const m = this.moves.get(i);
      if (m) {
        // 걸어서 자리 옮김: 가는 쪽을 보며 (살짝 출렁)
        m.t = Math.min(m.dur, m.t + dt);
        const k = m.t / m.dur;
        const e = k * k * (3 - 2 * k);
        p.root.position.lerpVectors(m.from, m.to, e);
        p.root.position.y = Math.abs(Math.sin(m.t * 9)) * 0.04;
        p.update(dt * 3, t, m.to);
        if (m.t >= m.dur) {
          p.root.position.y = 0;
          this.moves.delete(i);
        }
        return;
      }
      p.update(dt, t, this.lookAt.get(i) ?? this.look);
    });
  }
  /** 사람 i를 (x, z)로 dur초 동안 걸어가게 */
  moveTo(i: number, x: number, z: number, dur: number) {
    const p = this.people[i];
    this.moves.set(i, { from: p.root.position.clone(), to: new THREE.Vector3(x, 0, z), t: 0, dur });
  }
  /** 사람 i가 처음부터 그곳을 보고 서 있게 (계속 봄) */
  face(i: number, at: THREE.Vector3) {
    this.people[i].snap(at);
    this.lookAt.set(i, at.clone());
  }
  /** 사람 i가 바라볼 곳 (null이면 다시 버킷) */
  watchPoint(i: number, at: THREE.Vector3 | null) {
    if (at) this.lookAt.set(i, at.clone());
    else this.lookAt.delete(i);
  }
  /** 팔 내림 */
  lower(i: number) {
    const p = this.people[i];
    p.raiseTarget = 0;
    p.watch.visible = false;
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
    return out.copy(this.people[i].root.position).setY(1.5 * BODY_SCALE);
  }
}
