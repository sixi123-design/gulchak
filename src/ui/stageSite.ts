import * as THREE from 'three';
import { toon } from '../render/toon';
import { blueprintCanvas } from './patterns';

/**
 * 오프닝·시작 무대 둘레의 공사 현장 (빈 배경이 허전하지 않게).
 * 바닥: 설계도 격자·등고선이 깔린 넓은 땅(안개로 지평선에서 배경색에 녹음).
 * 중간: 흙더미·컨테이너·방호벽·라바콘·측량 말뚝. 멀리: 흙 둔덕(외곽선·등고선), 타워크레인(선 골조, 지브가 천천히 돎).
 * 공중: 떠오르는 먼지. 무대 둘레 전체에 놓되, 카메라 쪽(굴착기 앞을 가리는 자리)에 온 것은 화면 밖에 있을 때 숨김.
 */
const LINE = 0x5b71c4;

type Item = { obj: THREE.Object3D; dir: THREE.Vector2; on: number; sphere: THREE.Sphere };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 선분 목록 → LineSegments */
function lines(seg: number[], color: number, opacity = 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

/** 타워크레인 골조 (마스트 높이 h, 지브 길이 j). 지브는 따로 돌림 */
function crane(h: number, j: number) {
  const root = new THREE.Group();
  const w = 1.3;
  const seg: number[] = [];
  const L = (a: number[], b: number[]) => seg.push(...a, ...b);
  const c = [
    [-w / 2, -w / 2],
    [w / 2, -w / 2],
    [w / 2, w / 2],
    [-w / 2, w / 2],
  ];
  const step = 1.6;
  for (let k = 0; k < 4; k++) L([c[k][0], 0, c[k][1]], [c[k][0], h, c[k][1]]);
  for (let y = 0; y < h; y += step)
    for (let k = 0; k < 4; k++) {
      const a = c[k];
      const b = c[(k + 1) % 4];
      L([a[0], y, a[1]], [b[0], y, b[1]]);
      L([a[0], y, a[1]], [b[0], Math.min(h, y + step), b[1]]);
    }
  root.add(lines(seg, LINE));
  // 지브(앞)·카운터 지브(뒤): 삼각 단면 트러스, 꼭대기 탑, 당김줄, 운전실, 균형추, 훅
  const jib = new THREE.Group();
  jib.position.y = h;
  const js: number[] = [];
  const J = (a: number[], b: number[]) => js.push(...a, ...b);
  const tri = (x: number) => [
    [x, 0, -0.55],
    [x, 0, 0.55],
    [x, 0.95, 0],
  ];
  const back = j * 0.32;
  for (let x = -back; x < j; x += step) {
    const p = tri(x);
    const q = tri(Math.min(j, x + step));
    for (let k = 0; k < 3; k++) {
      J(p[k], q[k]);
      J(p[k], p[(k + 1) % 3]);
      J(p[k], q[(k + 1) % 3]);
    }
  }
  const top = [0, 4.2, 0];
  for (const z of [-0.55, 0.55]) {
    J([-0.6, 0.95, z], top);
    J([0.6, 0.95, z], top);
  }
  J(top, [j * 0.6, 0.95, 0]);
  J(top, [-back, 0.95, 0]);
  const hookX = j * 0.55;
  J([hookX, 0, 0], [hookX, -h * 0.55, 0]);
  jib.add(lines(js, LINE));
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), toon(0xffc23a));
  cab.position.set(0.9, -0.5, 0.95);
  const weight = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.2), toon(0x3a4a8f));
  weight.position.set(-back + 1.3, -0.3, 0);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), toon(0xffc23a));
  hook.position.set(hookX, -h * 0.55, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4d5e }));
  lamp.position.set(top[0], top[1] + 0.3, 0);
  jib.add(cab, weight, hook, lamp);
  root.add(jib);
  return { root, jib, lamp };
}

/** 흙 둔덕: 깎인 원뿔대 (위가 평평) + 등고선 고리 */
function mound(r: number, h: number, rnd: () => number) {
  const g = new THREE.CylinderGeometry(r * 0.4, r, h, 9, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > -h / 2 + 1e-3) {
      const k = 0.85 + rnd() * 0.3;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
      p.setY(i, y + (rnd() - 0.5) * h * 0.12);
    }
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, toon(0x2c3a7e));
  const grp = new THREE.Group();
  grp.add(m);
  const seg: number[] = [];
  for (const f of [0.3, 0.6]) {
    const rr = r * (1 - 0.6 * f) * 1.01;
    const y = h * f;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 1) / 24) * Math.PI * 2;
      seg.push(Math.cos(a0) * rr, y, Math.sin(a0) * rr, Math.cos(a1) * rr, y, Math.sin(a1) * rr);
    }
  }
  grp.add(lines(seg, LINE, 0.8));
  return grp;
}

function heap(r: number, h: number) {
  const g = new THREE.ConeGeometry(r, h, 8, 1);
  g.translate(0, h / 2, 0);
  return new THREE.Mesh(g, toon(0x7a5030));
}

function container(color: number) {
  const grp = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.4), toon(color));
  b.position.y = 1.3;
  grp.add(b);
  // 골판 홈 느낌: 세로 줄
  const seg: number[] = [];
  for (let x = -2.7; x <= 2.71; x += 0.45) seg.push(x, 0.1, 1.21, x, 2.5, 1.21, x, 0.1, -1.21, x, 2.5, -1.21);
  grp.add(lines(seg, 0x0f1433, 0.5));
  return grp;
}

function barrier() {
  const grp = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.45), toon(i % 2 ? 0xffffff : 0xff4d5e));
    b.position.set((i - 1) * 1.25, 0.4, 0);
    grp.add(b);
  }
  return grp;
}

function cone() {
  const grp = new THREE.Group();
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 10), toon(0xff7a1a));
  c.position.y = 0.375;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.14, 10), toon(0xffffff));
  band.position.y = 0.42;
  grp.add(c, band);
  return grp;
}

function stake() {
  const grp = new THREE.Group();
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.6, 0.09), toon(0xffffff));
  s.position.y = 0.8;
  const f = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshBasicMaterial({ color: 0xff4d5e, side: THREE.DoubleSide }));
  f.position.set(0.25, 1.42, 0);
  grp.add(s, f);
  return grp;
}

export class StageSite {
  readonly root = new THREE.Group();
  private items: Item[] = [];
  private cranes: (ReturnType<typeof crane> & { base: number })[] = [];
  private frustum = new THREE.Frustum();
  private mat = new THREE.Matrix4();
  private first = true;

  constructor() {
    const rnd = rng(20261112);
    // 바닥: 설계도 격자 + 등고선·치수 (가까이는 또렷, 멀리는 안개로 배경색)
    const SIZE = 192;
    const tex = (layer: 'grid' | 'marks') => {
      const t = new THREE.CanvasTexture(blueprintCanvas(layer));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.repeat.set(SIZE / 32, SIZE / 32);
      return t;
    };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex('grid') }));
    ground.position.y = -0.03;
    const marks = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex('marks'), transparent: true, depthWrite: false }));
    marks.position.y = -0.02;
    this.root.add(ground, marks);

    const place = (obj: THREE.Object3D, ang: number, r: number, radius: number) => {
      obj.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      this.root.add(obj);
      this.items.push({ obj, dir: new THREE.Vector2(Math.cos(ang), Math.sin(ang)), on: 1, sphere: new THREE.Sphere(obj.position.clone(), radius) });
    };
    // 먼 흙 둔덕 (반지름 25~31m)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd() * 0.25;
      const r = 3 + rnd() * 4;
      const h = 1.8 + rnd() * 3.2;
      const m = mound(r, h, rnd);
      m.rotation.y = rnd() * 6;
      place(m, a, 25 + rnd() * 6, r + h);
    }
    // 타워크레인 3기 (반지름 38~44m)
    for (const [a, r, h, j] of [
      [0.5, 40, 22, 20],
      [2.6, 44, 26, 24],
      [4.4, 38, 20, 18],
    ]) {
      const c = crane(h, j);
      this.cranes.push({ ...c, base: a * 3 });
      place(c.root, a, r, h + j);
    }
    // 중간 소품 (반지름 14~20m: 시작 페이지 카메라 쪽으로 돌아도 화면 밖)
    const makers: [() => THREE.Object3D, number][] = [
      [() => heap(1.6 + rnd() * 1.2, 1.2 + rnd() * 0.8), 3],
      [() => container([0xc8582a, 0x2f86a8, 0x5266b8, 0x8a4a9c][Math.floor(rnd() * 4)]), 4],
      [barrier, 2.2],
      [cone, 0.6],
      [stake, 1],
    ];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rnd() * 0.15;
      const [mk, rad] = makers[i % makers.length];
      const o = mk();
      o.rotation.y = rnd() * 6;
      place(o, a, 14 + rnd() * 6, rad);
      // 라바콘·말뚝은 몇 개씩 줄지어
      if (rad < 1.5)
        for (let k = 1; k < 4; k++) {
          const o2 = mk();
          const a2 = a + k * 0.045;
          place(o2, a2, 14.5 + k * 0.2 + rnd(), rad);
        }
    }
  }

  /** 카메라에 맞춰 갱신 (그리기 직전, 카메라 행렬이 정해진 뒤) */
  update(cam: THREE.PerspectiveCamera, look: THREE.Vector3, t: number, still: boolean, fog: THREE.Fog) {
    // 안개: 카메라~바라보는 점 거리 기준 (오프닝은 가깝고 시작 페이지는 멀어도 같은 느낌)
    const d = cam.position.distanceTo(look);
    fog.near = d + 2;
    fog.far = d + 55;
    // 카메라 쪽(카메라 방향과 30° 안쪽 반대편 반원 너머)에 온 것은 숨김. 화면 안에 있을 땐 바꾸지 않음 (튀지 않게)
    cam.updateMatrixWorld();
    this.mat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.mat);
    const cx = cam.position.x;
    const cz = cam.position.z;
    const cl = Math.hypot(cx, cz) || 1;
    for (const it of this.items) {
      const c = -(it.dir.x * cx + it.dir.y * cz) / cl; // 1 = 굴착기 바로 뒤
      const want = c > -0.15 ? 1 : 0;
      if (want !== it.on && (this.first || !this.frustum.intersectsSphere(it.sphere))) {
        it.on = want;
        it.obj.visible = !!want;
      }
    }
    this.first = false;
    const tt = still ? 0 : t;
    for (const c of this.cranes) {
      c.jib.rotation.y = c.base + tt * 0.06;
      (c.lamp.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(tt * 1.2) % 2 ? 0x5a1a22 : 0xff4d5e);
    }
  }
}
