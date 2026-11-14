import * as THREE from 'three';

export const PALETTE = {
  ink: 0x1d1b2e,
  sun: 0xffc23a,
  sunDeep: 0xf29a1f,
  steel: 0x3a3850,
  glass: 0x8fe3ff,
  tire: 0x2b2a3a,
  dirt: 0x8c5a32, // 흙: 따뜻한 갈색 (판 흙·흙더미, 바닥보다 밝고 붉게)
  yard: 0xbfbdb6, // 포장 바닥 (콘크리트)
  sand: 0x5e5a55, // 굴착장 다진 바닥 (회갈색, 흙보다 어둡고 덜 붉게)
  rust: 0xb4b8bd, // 버킷 몸체: 밝은 회색 (흙과 구분)
  rustDark: 0x8d9298,
  metal: 0xe6e8ea, // 이빨·날
  cabin: 0x24232e, // 운전석 내부 프레임
  grass: 0x9bd36a,
  rope: 0xff7a1a,
  pole: 0xff4d5e,
  poleCap: 0xffffff,
  pass: 0x2fd27a,
};

let gradient: THREE.DataTexture | null = null;
export function gradientMap() {
  if (gradient) return gradient;
  const data = new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const toonCache = new Map<number, THREE.MeshToonMaterial>();
export function toon(color: number) {
  let m = toonCache.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
    toonCache.set(color, m);
  }
  return m;
}

export const outlineMat = new THREE.MeshBasicMaterial({ color: PALETTE.ink, side: THREE.BackSide });

/** 뒷면 외곽선: 절대 두께 t(m)만큼 바깥으로 */
export function withOutline(mesh: THREE.Mesh, size: THREE.Vector3, t = 0.05) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.set(1 + (2 * t) / Math.max(size.x, 1e-3), 1 + (2 * t) / Math.max(size.y, 1e-3), 1 + (2 * t) / Math.max(size.z, 1e-3));
  o.renderOrder = -1;
  mesh.add(o);
  return mesh;
}

export function box(w: number, h: number, d: number, color: number, outline = 0.05) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, toon(color));
  if (outline > 0) withOutline(m, new THREE.Vector3(w, h, d), outline);
  return m;
}
