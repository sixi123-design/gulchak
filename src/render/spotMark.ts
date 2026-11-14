import * as THREE from 'three';

/**
 * 땅에 놓는 "여기를 파세요" 표식.
 *
 * 테두리(원) + 이빨을 맞출 작은 점. 글자가 아니라 자리를 보여 주는 장치라
 * 초심자가 "파는 자리"가 어디인지 묻지 않아도 된다.
 *
 * 저가폰이 1순위라 단순 도형만 쓴다 — 새 렌더 패스도, 흐림 효과도 없다.
 * 공용 재질 캐시(`toon`)는 쓰지 않는다. 색을 바꾸면 다른 부품까지 물들기 때문이다.
 */
export class SpotMark {
  readonly object = new THREE.Group();
  private ring: THREE.Mesh;
  private dot: THREE.Mesh;
  private mats: THREE.Material[] = [];

  constructor(color = 0xffc23a) {
    this.object.visible = false;
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const dotMat = new THREE.MeshBasicMaterial({ color });
    this.mats.push(ringMat, dotMat);
    // 바닥에 눕힌 납작한 고리
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 24).rotateX(-Math.PI / 2), ringMat);
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12).rotateX(-Math.PI / 2), dotMat);
    this.dot.position.y = 0.002;
    this.object.add(this.ring, this.dot);
  }

  /** 선회각 `swing`, 반경 `r` 자리에 놓는다. `size`는 고리 크기 배율 */
  put(swing: number, r: number, size = 1): void {
    this.object.position.set(Math.cos(swing) * r, 0.02, Math.sin(swing) * r);
    this.object.scale.setScalar(size);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    for (const m of [this.ring, this.dot]) m.geometry.dispose();
    for (const m of this.mats) m.dispose();
    this.object.clear();
  }
}
