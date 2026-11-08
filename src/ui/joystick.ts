/** 터치·마우스 가상 레버. 화면 위쪽이 +y */
export class Joystick {
  x = 0;
  y = 0;
  private id: number | null = null;
  private knob: HTMLElement;
  private cx = 0;
  private cy = 0;
  private radius = 60;
  constructor(readonly el: HTMLElement) {
    this.knob = el.querySelector('.knob') as HTMLElement;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('lostpointercapture', (e) => this.up(e));
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
    this.knob.style.transform = `translate(${dx * this.radius}px, ${dy * this.radius}px)`;
    const dz = 0.15;
    const shape = (v: number) => (Math.abs(v) < dz ? 0 : Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz)));
    this.x = shape(dx);
    this.y = -shape(dy);
    e.preventDefault();
  }
  private up(e: PointerEvent) {
    if (e.pointerId !== this.id) return;
    this.id = null;
    this.x = 0;
    this.y = 0;
    this.knob.style.transform = '';
    this.el.classList.remove('active');
  }
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
