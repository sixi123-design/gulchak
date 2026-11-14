/**
 * 게임패드 (표준 배치: 플스 듀얼쇼크·듀얼센스, 닌텐도 프로콘, 엑스박스 패드).
 * 왼쪽 스틱 = 왼쪽 레버, 오른쪽 스틱 = 오른쪽 레버 (화면 레버와 같은 방향, 위가 +y).
 * 주행: 왼쪽 스틱 좌우 = 핸들, R2(ZR) = 가속, L2(ZL) = 브레이크.
 */
export class Pad {
  lx = 0;
  ly = 0;
  rx = 0;
  ry = 0;
  accel = 0;
  brake = 0;
  /** 연결된 패드 이름 (없으면 '') */
  name = '';
  onChange: (() => void) | null = null;
  private dz = 0.15;
  constructor() {
    const ch = () => this.onChange?.();
    addEventListener('gamepadconnected', ch);
    addEventListener('gamepaddisconnected', ch);
  }
  private pick(): Gamepad | null {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    let any: Gamepad | null = null;
    for (const g of list) {
      if (!g || !g.connected) continue;
      if (g.mapping === 'standard') return g;
      any ??= g;
    }
    return any;
  }
  /** 매 프레임 한 번 */
  poll() {
    const g = this.pick();
    const name = g ? padLabel(g.id) : '';
    if (name !== this.name) {
      this.name = name;
      this.onChange?.();
    }
    if (!g || g.axes.length < 4) {
      this.lx = this.ly = this.rx = this.ry = this.accel = this.brake = 0;
      return;
    }
    // 스틱마다 원형 무감 구간 (가운데 흔들림 무시) → 나머지를 0~1로 다시 폄
    const stick = (ax: number, ay: number): [number, number] => {
      const x = g.axes[ax] ?? 0;
      const y = g.axes[ay] ?? 0;
      const l = Math.hypot(x, y);
      if (l < this.dz) return [0, 0];
      const k = Math.min(1, (l - this.dz) / (1 - this.dz)) / l;
      return [x * k, -y * k];
    };
    [this.lx, this.ly] = stick(0, 1);
    [this.rx, this.ry] = stick(2, 3);
    const trig = (i: number) => {
      const b = g.buttons[i];
      if (!b) return 0;
      const v = b.value || (b.pressed ? 1 : 0);
      return v < 0.05 ? 0 : v;
    };
    this.brake = trig(6);
    this.accel = trig(7);
  }
}

/** 브라우저가 주는 패드 id → 짧은 이름 */
export function padLabel(id: string): string {
  const s = id.toLowerCase();
  if (/dualsense|054c.*0ce6/.test(s)) return '듀얼센스';
  if (/dualshock|wireless controller|054c/.test(s)) return '듀얼쇼크';
  if (/pro controller|057e.*2009/.test(s)) return '프로콘';
  if (/joy-?con|057e/.test(s)) return '조이콘';
  if (/xbox|xinput|045e/.test(s)) return '엑스박스 패드';
  return '게임패드';
}
