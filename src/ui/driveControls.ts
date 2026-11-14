/**
 * 주행 조작: 왼쪽은 돌리는 핸들, 오른쪽은 브레이크·가속 페달.
 * 핸들은 손가락으로 원을 그리듯 돌린 각만큼 감기고, 놓으면 그 자리에 머문다 (휠 굴착기 유압 조향처럼).
 */

/**
 * 핸들 감는 각 : 바퀴 조향각 = DRIVE_PARAMS.steerRatio (끝↔끝 3.5바퀴).
 * 기종별 공식 수치 없음. 조향 유닛 일반 설계 범위 3~5바퀴(Danfoss) 안의 추정값, 세 기종 공통.
 */
export class SteeringWheel {
  /** 마지막으로 가져간 뒤 돌린 각(rad, +면 왼쪽) */
  private delta = 0;
  touching = false;
  private id: number | null = null;
  private last = 0;
  private cx = 0;
  private cy = 0;
  private rim: HTMLElement;
  constructor(readonly el: HTMLElement) {
    this.rim = el.querySelector('.wh-rim') as HTMLElement;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('lostpointercapture', (e) => this.up(e));
  }
  private at(e: PointerEvent) {
    return Math.atan2(e.clientY - this.cy, e.clientX - this.cx);
  }
  private down(e: PointerEvent) {
    if (this.id !== null) return;
    this.id = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트 등 */
    }
    const r = this.el.getBoundingClientRect();
    this.cx = r.left + r.width / 2;
    this.cy = r.top + r.height / 2;
    this.last = this.at(e);
    this.touching = true;
    this.el.classList.add('active');
    e.preventDefault();
  }
  private move(e: PointerEvent) {
    if (e.pointerId !== this.id) return;
    // 가운데 근처는 각이 튀므로 무시
    if (Math.hypot(e.clientX - this.cx, e.clientY - this.cy) < 14) return;
    const a = this.at(e);
    let d = a - this.last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    this.last = a;
    // 화면에서 시계 방향(d>0)으로 돌리면 오른쪽 = 각 감소
    this.delta -= d;
  }
  private up(e: PointerEvent) {
    if (e.pointerId !== this.id) return;
    this.id = null;
    this.touching = false;
    this.el.classList.remove('active');
  }
  /** 이번 프레임에 돌린 각을 가져감 */
  take() {
    const d = this.delta;
    this.delta = 0;
    this.lastDelta = d;
    return d;
  }
  private lastDelta = 0;
  /** 끝에 닿은 채 더 미는 양(rad): 손을 떼거나 반대로 돌리면 0 */
  private push = 0;
  /** 이번 프레임에 끝을 새로 쳤으면 true (소리·진동 한 번) */
  hitLock = false;
  /**
   * 핸들 그림: 시뮬레이션의 핸들 각 그대로.
   * 끝에서 더 돌리면 고무줄처럼 조금(최대 9°)만 따라오다 손을 떼면 되돌아가고, 테두리에 '끝' 표시
   */
  draw(angle: number, lockPush: number, side: number) {
    const was = this.push !== 0;
    if (!this.touching) this.push = 0;
    else if (lockPush !== 0) this.push = Math.sign(lockPush) === Math.sign(this.push) || this.push === 0 ? this.push + lockPush : lockPush;
    else if (this.lastDelta !== 0 && Math.sign(this.lastDelta) !== Math.sign(this.push)) this.push = 0;
    this.hitLock = !was && this.push !== 0;
    const extra = Math.sign(this.push) * 9 * Math.tanh(Math.abs(this.push) / 1.2);
    this.rim.style.transform = `rotate(${(-angle * 180) / Math.PI - extra}deg)`;
    this.el.classList.toggle('springing', !this.touching);
    // 끝에 닿아 있음: 어느 쪽 끝인지 (side: +1 왼쪽 끝, -1 오른쪽 끝, 0 아님)
    this.el.classList.toggle('at-lock', side !== 0);
    this.el.classList.toggle('lock-l', side > 0);
    this.el.classList.toggle('lock-r', side < 0);
    this.el.classList.toggle('pushing', this.push !== 0);
  }
}

/** 누르고 있으면 서서히 깊게 밟힘 (0.5초에 끝까지), 떼면 바로 0 */
export class Pedal {
  value = 0;
  private held = false;
  private id: number | null = null;
  constructor(readonly el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (this.id !== null) return;
      this.id = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 합성 이벤트 등 */
      }
      this.held = true;
      this.value = Math.max(this.value, 0.3);
      el.classList.add('active');
      e.preventDefault();
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.id) return;
      this.id = null;
      this.held = false;
      this.value = 0;
      el.classList.remove('active');
      el.style.setProperty('--press', '0');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }
  update(dt: number) {
    if (!this.held) return;
    this.value = Math.min(1, this.value + dt * 1.4);
    this.el.style.setProperty('--press', this.value.toFixed(2));
  }
}
