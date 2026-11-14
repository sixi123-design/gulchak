import * as THREE from 'three';
import type { ExcavatorView } from './excavatorView';

/**
 * 왼쪽 사이드미러: 거울 자리에서 눈의 반사 방향을 보는 가상 카메라를
 * 작은 렌더 타깃(160×220)에 2프레임에 1번 그리고, 거울면(좌우 뒤집힌 UV)에 붙인다.
 * 미러 렌더 동안 운전석 실내와 거울 자체는 숨긴다 (ExcavatorView.setMirrorPass).
 * 저가폰: 조명·그림자 추가 없음, 안티에일리어싱 없음.
 */
export class SideMirror {
  private rt: THREE.WebGLRenderTarget;
  private cam: THREE.PerspectiveCamera;
  private mat: THREE.MeshBasicMaterial;
  private prevMat: THREE.Material | THREE.Material[];
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private clear = new THREE.Color();
  private sky = new THREE.Color(0xcfeeff);

  constructor(
    private renderer: THREE.WebGLRenderer,
    private exc: ExcavatorView,
  ) {
    this.rt = new THREE.WebGLRenderTarget(160, 220, { depthBuffer: true });
    // 볼록 거울처럼 실제 평면 거울보다 조금 넓게
    this.cam = new THREE.PerspectiveCamera(40, 160 / 220, 0.1, 80);
    this.mat = new THREE.MeshBasicMaterial({ map: this.rt.texture });
    this.prevMat = exc.mirrorFace.material;
    exc.mirrorFace.material = this.mat;
  }

  /** frame: 앱의 프레임 번호. 짝수 프레임에만 다시 그림 */
  update(scene: THREE.Scene, frame: number) {
    if (frame % 2 !== 0) return;
    const r = this.renderer;
    this.exc.mirrorPose(this.pos, this.quat);
    this.cam.position.copy(this.pos);
    this.cam.quaternion.copy(this.quat);
    this.cam.updateMatrixWorld();
    // 앱 하늘은 CSS라 투명 → 거울엔 안개색(없으면 하늘색)을 깔아 준다
    const fog = scene.fog as THREE.Fog | null;
    const prevRT = r.getRenderTarget();
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(this.clear);
    const scissor = r.getScissorTest();
    r.setScissorTest(false);
    r.setClearColor(fog ? fog.color : this.sky, 1);
    this.exc.setMirrorPass(true);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, this.cam);
    r.setRenderTarget(prevRT);
    this.exc.setMirrorPass(false);
    r.setClearColor(this.clear, prevAlpha);
    r.setScissorTest(scissor);
  }

  dispose() {
    this.exc.mirrorFace.material = this.prevMat;
    this.mat.dispose();
    this.rt.dispose();
  }
}
