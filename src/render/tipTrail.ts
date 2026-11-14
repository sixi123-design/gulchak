import * as THREE from 'three';

/**
 * 이빨이 지나간 자리에 남는 선. 배우기 '두 레버를 같이 쓰기'에서 쓴다 —
 * 붐만 올리면 호가 그려지고, 암을 같이 써야 직선이 된다는 것을 눈으로 보여 준다.
 *
 * 저가폰: 버퍼를 한 번만 잡아 두고 drawRange만 옮긴다. 매 프레임 geometry를 새로
 * 만들지 않고, 새 렌더 패스·새 캔버스도 없다.
 */
export class TipTrail {
  readonly object: THREE.Line;
  private geo: THREE.BufferGeometry;
  private mat: THREE.LineBasicMaterial;
  private buf: Float32Array;
  private n = 0;
  private dead = false;
  private last: [number, number, number] | null = null;

  /**
   * @param max 남길 점 개수 상한 (넘으면 오래된 것부터 버린다)
   * @param minGap 이만큼(m) 움직였을 때만 점을 넣는다 (제자리에서 버퍼가 차지 않게)
   */
  constructor(
    private readonly max = 200,
    private readonly minGap = 0.03,
  ) {
    this.buf = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.buf, 3));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.LineBasicMaterial({ color: 0xffd34d });
    this.object = new THREE.Line(this.geo, this.mat);
    this.object.frustumCulled = false;
  }

  get count(): number {
    return this.n;
  }

  push(x: number, y: number, z: number): void {
    if (this.dead) return;
    if (this.last) {
      const [px, py, pz] = this.last;
      if ((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2 < this.minGap ** 2) return;
    }
    if (this.n >= this.max) {
      // 오래된 점 하나를 버리고 앞으로 당긴다
      this.buf.copyWithin(0, 3, this.n * 3);
      this.n--;
    }
    const i = this.n * 3;
    this.buf[i] = x;
    this.buf[i + 1] = y;
    this.buf[i + 2] = z;
    this.n++;
    this.last = [x, y, z];
    this.geo.setDrawRange(0, this.n);
    this.geo.getAttribute('position').needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.last = null;
    if (!this.dead) this.geo.setDrawRange(0, 0);
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.clear();
    this.object.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
