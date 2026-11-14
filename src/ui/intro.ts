import * as THREE from 'three';
import type { Pose4, StartStage } from './startStage';

/**
 * 오프닝 (약 4초, 탭·아무 키로 건너뜀).
 * 시작 페이지와 같은 3D 무대·같은 굴착기(StartStage)를 그린다: 모델을 미리 만들어 두고,
 * 끝 장면(카메라·자세)을 그대로 넘겨 시작 페이지가 이어서 돌아가게 → 넘어갈 때 덜컹 없음.
 * 굴착기가 붐을 올리며 한 번 퍼 올리는 동안 카메라가 낮은 앵글에서 돌아 나오고,
 * 글자(태그 → 로고 쾅 → 빛줄기)는 CSS. 끝에는 글자만 걷히고, 시작 페이지 패널·카드가 이어서 들어온다.
 * 움직임 줄이기: 정지 화면을 잠깐 보여 주고 넘어감.
 */
const END = 4.0;
const END_STATIC = 1.6;

type Key = Pose4 & { t: number };
// 붐 들기 → 암·버킷 오므려 퍼 올리기 → 카메라 쪽으로 살짝 선회
const POSE: Key[] = [
  // 시작: 바닥 바로 위로 뻗은 자세 (예전 값은 버킷이 무대 바닥 아래 0.9m까지 들어감)
  { t: 0, boom: 0.35, arm: -1.27, bucket: -0.38, swing: -0.25 },
  { t: 1.5, boom: 0.5, arm: -1.85, bucket: -1.8, swing: 0.1 },
  { t: 2.6, boom: 0.58, arm: -2.0, bucket: -1.95, swing: 0.4 },
  { t: END, boom: 0.6, arm: -2.05, bucket: -2.0, swing: 0.5 },
];
type CamKey = { t: number; pos: [number, number, number]; look: [number, number, number] };
// 앞쪽 낮은 앵글에서 시작해 옆으로 돌며 물러남 (위쪽 1/3은 로고 자리)
const CAM: CamKey[] = [
  { t: 0, pos: [9.5, 0.7, 2.2], look: [2.2, 2.4, 0.4] },
  { t: 2.0, pos: [8.0, 1.6, 7.6], look: [2.0, 3.0, 0.8] },
  { t: END, pos: [2.6, 2.6, 11.5], look: [1.6, 3.2, 0.8] },
];

const ease = (x: number) => x * x * (3 - 2 * x);
function sample<T extends { t: number }>(keys: T[], t: number): [T, T, number] {
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i + 1].t) return [keys[i], keys[i + 1], ease((t - keys[i].t) / (keys[i + 1].t - keys[i].t))];
  }
  const l = keys[keys.length - 1];
  return [l, l, 0];
}

export class Intro {
  private el: HTMLElement;
  private t = 0;
  private done = false;
  private reduced: boolean;
  private size = new THREE.Vector2();
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fov = 42;
  private pose: Pose4 = { boom: 0, arm: 0, bucket: 0, swing: 0 };
  private onKey = () => this.finish();
  private onTap = (e: Event) => {
    e.preventDefault();
    this.finish();
  };

  constructor(
    private renderer: THREE.WebGLRenderer,
    private stage: StartStage,
    private onDone: () => void,
  ) {
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.el = document.getElementById('intro')!;
    this.el.hidden = false;
    this.el.classList.toggle('static', this.reduced);
    // 시작 페이지는 오프닝 동안 미리 배치만 해 두고(보이지 않게·애니메이션 멈춤), 끝나면 그대로 드러남
    document.body.classList.add('intro-on', 'stage-on');
    this.el.addEventListener('pointerup', this.onTap);
    addEventListener('keydown', this.onKey);
    this.stage.ensureModel();
    this.apply(this.reduced ? 2.6 : 0);
  }

  /** 한 프레임: 자세·카메라를 시간에 맞추고 그림. 끝나면 false */
  frame(dt: number) {
    if (this.done) return false;
    this.t += this.reduced ? dt * (END / END_STATIC) : dt;
    this.apply(this.reduced ? 2.6 : Math.min(this.t, END));
    this.stage.shot(this.pose, this.pos, this.look, this.fov, this.t);
    if (this.t >= END) this.finish();
    return true;
  }

  private apply(t: number) {
    const [a, b, k] = sample(POSE, t);
    this.pose.boom = a.boom + (b.boom - a.boom) * k;
    this.pose.arm = a.arm + (b.arm - a.arm) * k;
    this.pose.bucket = a.bucket + (b.bucket - a.bucket) * k;
    this.pose.swing = a.swing + (b.swing - a.swing) * k;
    const [c0, c1, kc] = sample(CAM, t);
    this.pos.set(...c0.pos).lerp(new THREE.Vector3(...c1.pos), kc);
    this.look.set(...c0.look).lerp(new THREE.Vector3(...c1.look), kc);
    // 세로 화면: 더 넓게, 조금 뒤로
    this.renderer.getSize(this.size);
    const aspect = this.size.x / Math.max(1, this.size.y);
    this.fov = aspect >= 1 ? 42 : 68;
    if (aspect < 1) this.pos.sub(this.look).multiplyScalar(1.25).add(this.look);
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.el.removeEventListener('pointerup', this.onTap);
    removeEventListener('keydown', this.onKey);
    this.el.hidden = true;
    // 지금 장면을 시작 무대에 넘김 → 다음 프레임부터 그대로 이어서 돈다
    this.stage.handoff(this.pos, this.look, this.fov, this.pose, this.t);
    document.body.classList.remove('intro-on');
    this.onDone();
  }
}
