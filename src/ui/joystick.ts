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
    this.el.setPointerCapture(e.pointerId);
    const r = this.el.getBoundingClientRect();
    this.cx = r.left + r.width / 2;
    this.cy = r.top + r.height / 2;
    this.radius = r.width * 0.36;
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
    const dz = 0.12;
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

/** 키보드: 왼쪽 레버 WASD, 오른쪽 레버 IJKL (방향키는 오른쪽) */
export class Keys {
  private down = new Set<string>();
  constructor() {
    addEventListener('keydown', (e) => this.down.add(e.code));
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }
  private ax(neg: string[], pos: string[]) {
    return (pos.some((k) => this.down.has(k)) ? 1 : 0) - (neg.some((k) => this.down.has(k)) ? 1 : 0);
  }
  get lx() {
    return this.ax(['KeyA'], ['KeyD']);
  }
  get ly() {
    return this.ax(['KeyS'], ['KeyW']);
  }
  get rx() {
    return this.ax(['KeyJ', 'ArrowLeft'], ['KeyL', 'ArrowRight']);
  }
  get ry() {
    return this.ax(['KeyK', 'ArrowDown'], ['KeyI', 'ArrowUp']);
  }
}
