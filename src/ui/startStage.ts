import * as THREE from 'three';
import { MACHINE } from '../config/machine';
import { ExcavatorView, type MachineStyleKey } from '../render/excavatorView';
import { toon } from '../render/toon';
import type { DigSession } from '../sim/session';
import { BLUEPRINT_PINGS, blueprintCanvas } from './patterns';
import { StageSite } from './stageSite';

/**
 * 시작 페이지(#precheck) 뒤 3D 무대: 오프닝과 같은 남색 측량 설계도 배경(격자·등고선·치수선, 천천히 흐름) + 굴착기.
 * 굴착: 제자리에서 퍼 올리기를 되풀이 / 주행: 무대 위를 둥글게 돈다 (앞바퀴 꺾고 바퀴 굴림).
 * 카메라는 천천히 돈다. 페이지가 보일 때만 그리며, 그동안 게임 장면은 그리지 않는다(main.ts 훅).
 * 같은 렌더러 사용 (WebGL 컨텍스트 하나). 오프닝도 이 무대·모델로 그리고(shot), 끝 장면을 넘겨받아(handoff) 이어 간다.
 */
type Kind = 'dig' | 'drive';
const DIG_PERIOD = 4.8;
/** 배경판 한 변(m), 설계도 타일 한 변(m) */
const BG = 220;
/** 바라보는 점에서 배경판(하늘)까지 거리(m): 현장 소품·크레인보다 뒤 */
const BG_DIST = 62;
const TILE = 32;
const CIRCLE_R = 4.2; // 조향 반경 (차체 중심 원은 이보다 1.35m 안쪽)

const ease = (x: number) => x * x * (3 - 2 * x);
/** 오프닝 → 시작 페이지 카메라·자세 섞는 시간(초) */
const HAND_BLEND = 1.3;
export type Pose4 = { boom: number; arm: number; bucket: number; swing: number };
/**
 * 굴착 흉내 한 사이클: 내려 긁는 척 → 오므려 들기 → 펴며 다시 앞으로.
 * 흙 없이, 버킷이 무대 바닥(y=0) 아래로 내려가지 않게 (이빨 끝·버킷 바닥 모두 y>0, kinematics로 구한 각)
 */
const DIG: [number, number, number, number][] = [
  // [시각(비율), 붐, 암, 버킷]
  [0, 0.44, -1.22, -0.62], // 앞으로 뻗음 (이빨 r6.4 y0.9)
  [0.25, 0.3, -1.17, -0.83], // 바닥 가까이 (r6.1 y0.2)
  [0.5, 0.27, -1.33, -1.4], // 바닥 위로 긁어 당기는 척 (r5.0 y0.25)
  [0.7, 0.35, -1.58, -2.67], // 오므려 들기
  [0.85, 0.38, -0.8, -2.18], // 든 채 앞으로
  [1, 0.44, -1.22, -0.62],
];
// 주행 자세: 붐 들고 버킷 오므림
const TRAVEL = { boom: 0.75, arm: -2.3, bucket: -1.9 };

export class StartStage {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private site = new StageSite();
  private fog = new THREE.Fog(0x1b2557, 30, 90);
  private exc!: ExcavatorView;
  private styleKey: MachineStyleKey | null = null;
  /** 뒤 배경판(격자) · 앞 배경판(등고선·치수·기준점, 더 빨리 흘러 깊이감) · 기준점 고리 · 오프닝 스캔 빔과 가림막 */
  private rays: THREE.Group;
  private bpTex: THREE.CanvasTexture;
  private mkTex: THREE.CanvasTexture;
  private marks: THREE.Mesh;
  private pings: { ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; u: number; v: number; phase: number }[] = [];
  private scanBeam: THREE.Mesh;
  private scanCover: THREE.Mesh;
  private zoom = 0;
  private active = false;
  private t = 0;
  private kind: Kind = 'dig';
  private kindT = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private size = new THREE.Vector2();
  private look = new THREE.Vector3(0, 2.0, 0);
  private roll = 0;
  private hand: { pos: THREE.Vector3; look: THREE.Vector3; fov: number; pose: Pose4; t: number } | null = null;
  private drv = { x: 0, z: 0, h: 0, steer: 0 };
  private handT = HAND_BLEND;
  private present = 0;
  private fake = {
    pose: { swing: 0, boom: 0, arm: 0, bucket: 0 },
    rock: { pitch: 0, pitchV: 0, roll: 0, rollV: 0 },
    lift: 0,
    load: 0,
    loadBack: 0,
    backCap: 1,
    m: MACHINE,
  };

  constructor(
    private renderer: THREE.WebGLRenderer,
    private getStyle: () => MachineStyleKey,
  ) {
    const sc = this.scene;
    sc.background = new THREE.Color(0x1b2557);
    sc.fog = this.fog;
    sc.add(this.site.root);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x5a6aa8, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(6, 12, 8);
    sc.add(sun);
    // 배경: 이어 붙는 설계도 (1칸 = 약 1m, 타일 32m). 카메라를 정면으로 보는 판 두 장이 다른 속도로 흐름
    const mkTexOf = (cv: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.repeat.set(BG / TILE, BG / TILE);
      return t;
    };
    this.bpTex = mkTexOf(blueprintCanvas('grid'));
    this.mkTex = mkTexOf(blueprintCanvas('marks'));
    this.rays = new THREE.Group();
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(BG, BG), new THREE.MeshBasicMaterial({ map: this.bpTex, fog: false }));
    this.marks = new THREE.Mesh(new THREE.PlaneGeometry(BG, BG), new THREE.MeshBasicMaterial({ map: this.mkTex, transparent: true, depthWrite: false, fog: false }));
    this.marks.position.z = 0.6;
    this.rays.add(grid, this.marks);
    // 노란 기준점마다 2.6초 간격으로 퍼지는 고리 (점마다 시차) (앞판과 같이 흐름). 타일마다 하나씩, 보이는 범위만큼 미리 만들어 둠
    const ringG = new THREE.RingGeometry(0.86, 1, 40);
    BLUEPRINT_PINGS.forEach(([u, v], bi) => {
      for (let i = 0; i < 7; i++)
        for (let j = 0; j < 7; j++) {
          const mat = new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, depthWrite: false, fog: false });
          const ring = new THREE.Mesh(ringG, mat);
          ring.position.z = 0.05;
          this.marks.add(ring);
          this.pings.push({ ring, mat, u: u + i, v: 1 - v + j, phase: bi * 0.83 });
        }
    });
    // 오프닝 스캔(눈부시지 않게 흰 심 없이 옅은 노랑): 빔이 왼쪽에서 오른쪽으로 지나가며, 빔 오른쪽은 아직 바탕색(가림막)으로 덮여 있음
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 1;
    const cg = cv.getContext('2d')!;
    const gr = cg.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, '#ffc23a00');
    gr.addColorStop(0.75, '#ffc23a33');
    gr.addColorStop(0.95, '#ffc23a88');
    gr.addColorStop(1, '#ffc23a00');
    cg.fillStyle = gr;
    cg.fillRect(0, 0, 64, 1);
    const beamTex = new THREE.CanvasTexture(cv);
    beamTex.colorSpace = THREE.SRGBColorSpace;
    this.scanBeam = new THREE.Mesh(new THREE.PlaneGeometry(6, BG), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.scanBeam.position.z = 1.2;
    this.scanCover = new THREE.Mesh(new THREE.PlaneGeometry(BG, BG), new THREE.MeshBasicMaterial({ color: 0x1b2557, fog: false }));
    this.scanCover.position.z = 1.0;
    this.scanBeam.visible = this.scanCover.visible = false;
    this.rays.add(this.scanBeam, this.scanCover);
    sc.add(this.rays);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 40).rotateX(-Math.PI / 2), toon(0x3b4f9e));
    const rim = new THREE.Mesh(new THREE.RingGeometry(7, 7.35, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0f1433 }));
    rim.position.y = 0.005;
    // 주행 원 표시 (점선 느낌의 얇은 고리)
    const lane = new THREE.Mesh(new THREE.RingGeometry(CIRCLE_R - 1.45, CIRCLE_R - 1.3, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5b71c4 }));
    lane.position.y = 0.006;
    sc.add(floor, rim, lane);
  }

  /** 페이지가 보이면 무대를 그리고 true. 안 보이면 false (게임이 평소대로 그림) */
  frame(dt: number, kind: Kind) {
    const pc = document.getElementById('precheck');
    const show =
      !!pc && !pc.hidden && !document.body.classList.contains('intro-on') && !document.querySelector('#settings.seat:not([hidden])');
    if (!show) {
      if (this.active) {
        this.active = false;
        document.body.classList.remove('stage-on');
      }
      return false;
    }
    if (!this.active) {
      // 다시 열릴 때마다 처음부터
      this.active = true;
      this.t = 0;
      this.kindT = 0;
      document.body.classList.add('stage-on');
      this.handT = this.hand ? 0 : HAND_BLEND;
      // 배경 흐름·카메라 궤도도 오프닝 시각에서 이어서
      if (this.hand) this.t = this.hand.t;
    }
    this.ensureModel();
    if (kind !== this.kind) {
      this.kind = kind;
      this.kindT = 0;
    }
    const step = this.reduced ? 0 : dt;
    this.t += step;
    this.kindT += step;
    this.camera(this.reduced ? 0 : this.t);
    this.pose(this.reduced ? 1.2 : this.kindT, step);
    // 오프닝에서 넘어온 직후: 오프닝 마지막 카메라·자세에서 이어서 부드럽게 (끊김 없이)
    if (this.hand && this.handT < HAND_BLEND) {
      this.handT += dt;
      this.blendFromHand(ease(Math.min(1, this.handT / HAND_BLEND)));
      if (this.handT >= HAND_BLEND) this.hand = null;
    }
    this.site.update(this.cam, this.look, this.t, this.reduced, this.fog);
    this.renderer.render(this.scene, this.cam);
    return true;
  }

  /** 모델이 없거나 계열이 바뀌었으면 만든다 (오프닝 때 미리 만들어 넘김 순간 멈칫 없게) */
  ensureModel() {
    const st = this.getStyle();
    if (st === this.styleKey) return;
    if (this.exc) this.scene.remove(this.exc.root);
    this.exc = new ExcavatorView(MACHINE, st);
    this.scene.add(this.exc.root);
    this.styleKey = st;
  }

  /** 오프닝이 같은 무대·같은 모델로 한 장면을 그림 (카메라는 화면 가운데 기준) */
  shot(pose: Pose4, pos: THREE.Vector3, look: THREE.Vector3, fov: number, rayT: number) {
    this.ensureModel();
    this.exc.setDrive(0, 0, 0, 0, 0);
    Object.assign(this.fake.pose, pose);
    this.exc.sync(this.fake as unknown as DigSession);
    this.renderer.getSize(this.size);
    this.cam.aspect = this.size.x / Math.max(1, this.size.y);
    this.cam.fov = fov;
    this.cam.clearViewOffset();
    this.cam.position.copy(pos);
    this.look.copy(look);
    this.cam.lookAt(look);
    this.cam.updateProjectionMatrix();
    this.placeRays(rayT, true);
    this.site.update(this.cam, this.look, rayT, this.reduced, this.fog);
    this.renderer.render(this.scene, this.cam);
  }

  /** 오프닝 마지막 장면을 넘겨받음: 다음에 페이지가 열리면 여기서부터 섞어 이어감 */
  handoff(pos: THREE.Vector3, look: THREE.Vector3, fov: number, pose: Pose4, rayT: number) {
    this.hand = { pos: pos.clone(), look: look.clone(), fov, pose: { ...pose }, t: rayT };
  }

  private blendFromHand(k: number) {
    const h = this.hand!;
    const look = h.look.clone().lerp(this.look, k);
    this.cam.position.lerpVectors(h.pos, this.cam.position, k);
    this.cam.fov = h.fov + (this.cam.fov - h.fov) * k;
    if (this.cam.view) {
      this.cam.view.offsetX *= k;
      this.cam.view.offsetY *= k;
    }
    this.cam.lookAt(look);
    this.cam.updateProjectionMatrix();
    const p = this.fake.pose;
    p.boom = h.pose.boom + (p.boom - h.pose.boom) * k;
    p.arm = h.pose.arm + (p.arm - h.pose.arm) * k;
    p.bucket = h.pose.bucket + (p.bucket - h.pose.bucket) * k;
    p.swing = h.pose.swing * (1 - k);
    if (this.kind === 'dig') this.exc.setDrive(0, 0, this.present * k, 0, 0);
    else this.exc.setDrive(this.drv.x * k, this.drv.z * k, this.drv.h * k, this.drv.steer * k, this.roll);
    this.exc.sync(this.fake as unknown as DigSession);
    this.look.copy(look);
    this.placeRays(this.t);
  }

  /** 배경판을 카메라 정면에 두고 흐르게. intro: 오프닝 시각 t에 스캔 빔이 지나감 */
  private placeRays(t: number, intro = false) {
    const back = this.look.clone().sub(this.cam.position).normalize();
    this.rays.position.copy(this.look).addScaledVector(back, BG_DIST);
    this.rays.lookAt(this.cam.position);
    const still = this.reduced;
    const tt = still ? 0 : t;
    // 뒤 격자는 느리게, 앞 표기는 더 빨리 (타일 비율/초)
    this.bpTex.offset.set(tt * 0.008, tt * 0.004);
    const ox = tt * 0.02;
    const oy = tt * 0.009;
    this.mkTex.offset.set(ox, oy);
    // 기준점 고리: 앞판 무늬와 같은 자리 (판 좌표 = (타일좌표 − 오프셋) × 타일 − 반폭)
    const wrap = (a: number) => a - Math.floor(a);
    for (const p of this.pings) {
      const x = (wrap(p.u - ox) + Math.floor(p.u)) * TILE - BG / 2;
      const y = (wrap(p.v - oy) + Math.floor(p.v)) * TILE - BG / 2;
      p.ring.position.x = x;
      p.ring.position.y = y;
      const k = still ? 0.5 : wrap((t + p.phase) / 2.6);
      const r = 0.25 + 1.5 * (1 - (1 - k) ** 3);
      p.ring.scale.setScalar(r);
      p.mat.opacity = still ? 0.35 : 0.85 * (1 - k) ** 1.5;
    }
    // 오프닝 스캔: 0.25~1.45초 동안 화면 왼쪽 끝 → 오른쪽 끝
    const SCAN0 = 0.25;
    const SCAN1 = 1.45;
    const on = intro && !still && t < SCAN1;
    this.scanBeam.visible = this.scanCover.visible = on;
    if (on) {
      const k = Math.max(0, (t - SCAN0) / (SCAN1 - SCAN0));
      const half = this.cam.position.distanceTo(this.rays.position) * Math.tan((this.cam.fov * Math.PI) / 360) * Math.max(1, this.cam.aspect) * 1.3 + 4;
      const x = -half + 2 * half * (k * k * (3 - 2 * k));
      this.scanBeam.position.x = x - 3;
      this.scanCover.position.x = x + BG / 2;
    }
  }

  private pose(t: number, dt: number) {
    const p = this.fake.pose;
    // 주행으로 바뀌면 0.6초에 걸쳐 원 위로 출발
    const blend = ease(Math.min(1, t / 0.6));
    let b = TRAVEL.boom;
    let a = TRAVEL.arm;
    let k = TRAVEL.bucket;
    if (this.kind === 'dig') {
      const u = (t % DIG_PERIOD) / DIG_PERIOD;
      let i = 0;
      while (i < DIG.length - 2 && u > DIG[i + 1][0]) i++;
      const [u0, b0, a0, k0] = DIG[i];
      const [u1, b1, a1, k1] = DIG[i + 1];
      const e = ease((u - u0) / (u1 - u0));
      b = b0 + (b1 - b0) * e;
      a = a0 + (a1 - a0) * e;
      k = k0 + (k1 - k0) * e;
      // 붐이 늘 화면 왼쪽 앞(카드 반대편)을 향하게 차체를 돌려 세움
      this.exc.setDrive(0, 0, this.present, 0, 0);
    } else {
      // 무대 위 원을 돈다: 반시계, 앞바퀴는 원에 맞춰 왼쪽으로 꺾음
      const w = 0.42;
      const th = t * w * blend;
      const x = Math.cos(th) * (CIRCLE_R - 1.35) * blend;
      const z = Math.sin(th) * (CIRCLE_R - 1.35) * blend;
      this.roll += (w * (CIRCLE_R - 1.35) * blend * dt) / 0.55;
      const steer = Math.atan(MACHINE.wheelbase / CIRCLE_R) * blend;
      // 진행 방향 = 반지름에 수직 (heading: 로컬 +x → (cos h, sin h))
      this.drv = { x, z, h: th + Math.PI / 2, steer: -steer };
      this.exc.setDrive(x, z, th + Math.PI / 2, -steer, this.roll);
    }
    p.swing = 0;
    p.boom = b;
    p.arm = a;
    p.bucket = k;
    this.exc.sync(this.fake as unknown as DigSession);
  }

  private camera(t: number) {
    this.renderer.getSize(this.size);
    const w = this.size.x;
    const h = Math.max(1, this.size.y);
    const aspect = w / h;
    const ang = 0.9 + t * 0.1;
    // 화면 왼쪽 = (-sin, cos), 카메라 쪽 = (cos, sin) → 둘 사이로 붐을 향하게
    this.present = Math.atan2(Math.cos(ang) * 0.6 + Math.sin(ang) * 0.8, -Math.sin(ang) * 0.6 + Math.cos(ang) * 0.8);
    // 원근을 줄여 직교에 가깝게: 화각을 좁히고 그만큼 멀리서 봄 (보이는 크기·내려다보는 각도는 그대로)
    const fov = aspect >= 1 ? 18 : 28;
    const [fov0, R0, y0] = aspect >= 1 ? [42, 16, 3.6] : [62, 19, 4.4];
    // 원래보다 가까이: 가로는 과목 버튼을 카드 위로 옮겨 왼쪽이 비어서 더 크게
    // 주행은 원을 돌며 움직이니 덜 당김 (카드 뒤로 숨지 않게)
    const zTarget = aspect >= 1 ? (this.kind === 'drive' ? 1.2 : 1.38) : 1.3;
    // 과목을 바꾸면 줌도 부드럽게 따라감
    this.zoom = this.zoom ? this.zoom + (zTarget - this.zoom) * 0.08 : zTarget;
    const ZOOM = this.zoom;
    const R = (R0 * Math.tan((fov0 * Math.PI) / 360)) / Math.tan((fov * Math.PI) / 360) / ZOOM;
    this.look.set(0, 1.7, 0);
    this.cam.position.set(Math.cos(ang) * R, 1.7 + ((y0 - 1.7) * R) / R0, Math.sin(ang) * R);
    this.cam.lookAt(this.look);
    this.cam.aspect = aspect;
    this.cam.fov = fov;
    // 가로: 굴착기를 왼쪽(카드 반대편)으로, 세로: 위쪽으로
    if (aspect >= 1) this.cam.setViewOffset(w, h, w * 0.21, 0, w, h);
    else this.cam.setViewOffset(w, h, 0, h * 0.2, w, h);
    this.cam.updateProjectionMatrix();
    this.placeRays(t);
  }
}
