/** 터치·마우스 가상 레버. 화면 위쪽이 +y */
export class Joystick {
  x = 0;
  y = 0;
  private id: number | null = null;
  private knob: HTMLElement;
  private cx = 0;
  private cy = 0;
  private radius = 60;
  /**
   * 입력은 건드리지 않고 **노브만** 그 자리로 옮긴다 (-1~1).
   * 앱이 레버를 대신 미는 시범에서, 유저가 보는 손잡이도 같이 움직여야 배울 게 생긴다.
   */
  show(x: number, y: number) {
    // 손가락이 올라가 있어도 시범 자리를 그린다 — 시범 중에는 입력이 무시되므로,
    // 엄지를 레버에 올려 둔 사람에게 노브가 안 움직이면 시범을 못 본다 (개발 검토)
    this.showing = true;
    // x·y는 레버값(this.x/this.y와 같은 뜻: 위가 +). 화면 자리로 되돌린다 —
    // 데드존을 다시 붙이고, 화면은 아래가 +라서 y를 뒤집는다 (안 뒤집어서 시범 노브가 거꾸로 갔다)
    const un = (v: number) => (Math.abs(v) < 1e-3 ? 0 : Math.sign(v) * (DEADZONE + Math.min(1, Math.abs(v)) * (1 - DEADZONE)));
    const r = this.el.getBoundingClientRect().width * 0.42;
    const sc = r / Math.max(1, this.el.offsetWidth * 0.42);
    this.knob.style.transform = `translate(${(un(x) * r) / Math.max(sc, 1e-6)}px, ${(-un(y) * r) / Math.max(sc, 1e-6)}px)`;
  }
  /** 시범이 끝났다: 노브를 손가락 자리로 (손을 안 댔으면 가운데로). 안 하면 시범 마지막 자리에 남는다 */
  unshow() {
    if (!this.showing) return;
    this.showing = false;
    this.knob.style.transform = this.id !== null ? this.finger : '';
  }
  /** 시범이 노브를 그리는 중 */
  private showing = false;
  /** 손가락이 둔 노브 자리 (시범이 끝나면 여기로 돌려 놓는다) */
  private finger = '';
  constructor(readonly el: HTMLElement) {
    this.knob = el.querySelector('.knob') as HTMLElement;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('lostpointercapture', (e) => this.up(e));
    // 손가락을 화면 가장자리 밖으로 빼거나 시스템 제스처가 끼어들면 pointerup이 레버에 안 올 때가 있음 → 레버가 끝에 걸려 안 돌아옴.
    // 창 전체에서 한 번 더 받고, 터치가 끝났는데 이 레버를 누르는 손가락이 남아 있지 않으면 놓은 것으로 침
    addEventListener('pointerup', (e) => this.up(e), true);
    addEventListener('pointercancel', (e) => this.up(e), true);
    const touchEnd = (e: TouchEvent) => {
      if (this.id === null) return;
      for (const t of Array.from(e.touches)) if (t.target instanceof Node && el.contains(t.target)) return;
      this.release();
    };
    addEventListener('touchend', touchEnd, true);
    addEventListener('touchcancel', touchEnd, true);
    addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => document.hidden && this.release());
  }
  private down(e: PointerEvent) {
    if (this.id !== null) return;
    this.id = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트 등 캡처 불가 시 무시 */
    }
    const r = this.el.getBoundingClientRect();
    this.cx = r.left + r.width / 2;
    this.cy = r.top + r.height / 2;
    this.radius = r.width * 0.42; // 손가락 움직임 범위를 넓혀 덜 예민하게
    this.el.classList.add('active');
    this.move(e);
    e.preventDefault();
  }
  private move(e: PointerEvent) {
    if (e.pointerId !== this.id) return;
    let dx = (e.clientX - this.cx) / this.radius;
    let dy = (e.clientY - this.cy) / this.radius;
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    // 레버 크기 설정(scale)으로 키우면 손잡이 이동도 같이 커지므로 화면 px → 레버 안 px
    const s = this.el.getBoundingClientRect().width / Math.max(1, this.el.offsetWidth);
    this.finger = `translate(${(dx * this.radius) / s}px, ${(dy * this.radius) / s}px)`;
    if (!this.showing) this.knob.style.transform = this.finger;
    const dz = DEADZONE;
    const shape = (v: number) => (Math.abs(v) < dz ? 0 : Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz)));
    this.x = shape(dx);
    this.y = -shape(dy);
    e.preventDefault();
  }
  private up(e: PointerEvent) {
    if (e.pointerId !== this.id) return;
    this.release();
  }
  /** 레버 놓기 (가운데로) */
  release() {
    const id = this.id;
    if (id === null) return;
    this.id = null;
    try {
      this.el.releasePointerCapture(id);
    } catch {
      /* 이미 풀림 */
    }
    this.x = 0;
    this.y = 0;
    this.finger = '';
    if (!this.showing) this.knob.style.transform = '';
    this.el.classList.remove('active');
  }
}

/**
 * 레버 데드존. 이 안에서는 기계가 전혀 안 움직인다.
 * 화면의 3칸 표시도 같은 값을 써야 "밀었는데 안 움직인다"가 안 생긴다.
 */
export const DEADZONE = 0.15;

/**
 * 레버를 얼마나 밀었나를 칸 수로 (0~3). **손 자리**(데드존을 뺀 레버 값, 곡선 전)로 센다.
 * 기계 값(곡선 뒤)으로 세면 손을 0.4까지 밀어도 0칸이라 '붐은 움직이는데 칸이 안 찬다' (개발 검토).
 *
 * 숫자(%)는 쓰지 않는다 — 초심자 검수에서 "무엇의 25%인지 모르겠다"가 나왔다.
 * 칸은 읽을 글자가 없고, 한 칸과 세 칸의 차이가 바로 보인다.
 */
export function gaugeLevel(v: number): 0 | 1 | 2 | 3 {
  const a = Math.abs(v);
  // 데드존은 레버에서 이미 뺐다 — 0이 아니면 기계가 움직인다
  if (a < 0.02) return 0;
  if (a <= 0.4) return 1;
  if (a <= 0.7) return 2;
  return 3;
}

/** 키보드 조작: 동작마다 키 하나 (설정 > 조작키에서 바꿈). 이름은 화면 레버 라벨과 같게 */
export const KEY_ACTIONS = [
  { id: 'ly+', label: '암 펴기', def: 'KeyW' },
  { id: 'ly-', label: '암 당기기', def: 'KeyS' },
  { id: 'lx-', label: '선회 ◀', def: 'KeyA' },
  { id: 'lx+', label: '▶ 선회', def: 'KeyD' },
  { id: 'ry+', label: '붐 내림', def: 'KeyI' },
  { id: 'ry-', label: '붐 올림', def: 'KeyK' },
  { id: 'rx-', label: '버킷 오므림', def: 'KeyJ' },
  { id: 'rx+', label: '버킷 펴기', def: 'KeyL' },
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number]['id'];
const KEY_STORE = 'exc-keys';

/** 키 코드 → 화면 표시 (KeyW → W, ArrowUp → ↑) */
export function keyName(code: string) {
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space' };
  if (arrows[code]) return arrows[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

export class Keys {
  private down = new Set<string>();
  map: Record<KeyAction, string>;
  /** 다음 키 하나를 받는 중이면 콜백 (조작키 바꾸기) */
  private capture: ((code: string | null) => void) | null = null;
  constructor() {
    this.map = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.def])) as Record<KeyAction, string>;
    try {
      Object.assign(this.map, JSON.parse(localStorage.getItem(KEY_STORE) ?? '{}'));
    } catch {
      /* 무시 */
    }
    addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code === 'Escape' ? null : e.code);
        return;
      }
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }
  /** 동작 id에 다음에 누르는 키를 지정 (이미 다른 동작에 쓰던 키면 서로 맞바꿈). Esc = 취소 */
  rebind(id: KeyAction, done: () => void) {
    this.capture = (code) => {
      if (code) {
        const other = (Object.keys(this.map) as KeyAction[]).find((k) => k !== id && this.map[k] === code);
        if (other) this.map[other] = this.map[id];
        this.map[id] = code;
        this.persist();
      }
      done();
    };
  }
  cancelRebind() {
    this.capture = null;
  }
  reset() {
    for (const a of KEY_ACTIONS) this.map[a.id] = a.def;
    this.persist();
  }
  private persist() {
    try {
      localStorage.setItem(KEY_STORE, JSON.stringify(this.map));
    } catch {
      /* 무시 */
    }
  }
  private ax(neg: KeyAction, pos: KeyAction) {
    return (this.down.has(this.map[pos]) ? 1 : 0) - (this.down.has(this.map[neg]) ? 1 : 0);
  }
  get lx() {
    return this.ax('lx-', 'lx+');
  }
  get ly() {
    return this.ax('ly-', 'ly+');
  }
  get rx() {
    return this.ax('rx-', 'rx+');
  }
  get ry() {
    return this.ax('ry-', 'ry+');
  }
}
