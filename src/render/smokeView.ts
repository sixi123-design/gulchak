import * as THREE from 'three';

/**
 * 배기구 연기: 부하(엔진 힘)를 눈으로 보이게.
 * 공회전·가벼운 작업 = 옅고 드문 회색, 무거울수록 자주·크게·검게 뿜는다.
 */
const MAX = 40;
type Puff = { p: THREE.Vector3; v: THREE.Vector3; age: number; life: number; size: number; dark: number };

export class SmokeView {
  readonly mesh: THREE.InstancedMesh;
  private puffs: Puff[] = [];
  private acc = 0;
  private mtx = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private scl = new THREE.Vector3();
  private col = new THREE.Color();
  private light = new THREE.Color(0xb8b4ae);
  private black = new THREE.Color(0x1a1714);
  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 0), mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, this.light);
  }
  /** tip: 배기구 끝(월드), load: 엔진 부하(1 = 힘 100%), on: 시동 */
  update(dt: number, tip: THREE.Vector3, load: number, on: boolean, wind: THREE.Vector3) {
    if (on) {
      const l = Math.min(1.6, Math.max(0, load));
      // 초당 뿜는 수: 공회전 2 → 과부하 18
      this.acc += dt * (2 + 10 * l * l);
      while (this.acc >= 1 && this.puffs.length < MAX) {
        this.acc -= 1;
        const dark = Math.min(1, Math.max(0, (l - 0.35) / 0.8));
        this.puffs.push({
          p: tip.clone(),
          v: new THREE.Vector3((Math.random() - 0.5) * 0.3, 1.2 + 1.4 * l, (Math.random() - 0.5) * 0.3).add(wind),
          age: 0,
          life: 1.1 + 0.8 * l + Math.random() * 0.4,
          size: 0.5 + 0.9 * l + Math.random() * 0.2,
          dark,
        });
      }
      if (this.acc > 1) this.acc = 1;
    }
    let k = 0;
    this.puffs = this.puffs.filter((f) => (f.age += dt) < f.life);
    for (const f of this.puffs) {
      const u = f.age / f.life;
      f.v.y *= 1 - dt * 1.2; // 올라가며 느려짐
      f.p.addScaledVector(f.v, dt);
      const s = f.size * (0.4 + 1.6 * Math.sqrt(u)) * (1 - u * u * u);
      this.scl.setScalar(s);
      this.mtx.compose(f.p, this.q, this.scl);
      this.mesh.setMatrixAt(k, this.mtx);
      // 퍼질수록 옅은 색으로 (투명도 대신 색으로 흐려짐)
      this.col.copy(this.black).lerp(this.light, 1 - f.dark * (1 - u * 0.7));
      this.mesh.setColorAt(k, this.col);
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() {
    this.puffs.length = 0;
    this.mesh.count = 0;
  }
}
