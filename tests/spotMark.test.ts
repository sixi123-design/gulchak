import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SpotMark } from '../src/render/spotMark';

describe('땅 표식 (파는 자리)', () => {
  it('테두리와 이빨 맞출 점을 만든다', () => {
    const m = new SpotMark();
    m.put(Math.PI, 5.5, 1.2);
    expect(m.object.children.length).toBeGreaterThanOrEqual(2);
    expect(m.object.visible).toBe(true);
  });

  it('감추면 안 보이고, 다시 놓으면 보인다', () => {
    const m = new SpotMark();
    m.put(Math.PI, 5.5, 1.2);
    m.hide();
    expect(m.object.visible).toBe(false);
    m.put(0, 5, 1);
    expect(m.object.visible).toBe(true);
  });

  it('놓은 자리가 반경·방향과 맞는다', () => {
    const m = new SpotMark();
    m.put(0, 6, 1); // 선회 0 = +x 방향
    const p = m.object.position;
    expect(p.x).toBeCloseTo(6, 3);
    expect(p.z).toBeCloseTo(0, 3);
    expect(p.y).toBeCloseTo(0.02, 3);
  });

  it('여러 번 놓아도 자식이 늘지 않는다 (매 프레임 불러도 안전)', () => {
    const m = new SpotMark();
    m.put(0, 5, 1);
    const n = m.object.children.length;
    for (let i = 0; i < 10; i++) m.put(Math.PI, 6, 1.4);
    expect(m.object.children.length).toBe(n);
  });

  it('dispose하면 기하·재질을 모두 놓아준다', () => {
    const m = new SpotMark();
    m.put(0, 5, 1);
    const geos: THREE.BufferGeometry[] = [];
    m.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geos.push(mesh.geometry);
    });
    expect(geos.length).toBeGreaterThan(0);
    let freed = 0;
    for (const g of geos) g.addEventListener('dispose', () => freed++);
    m.dispose();
    expect(freed).toBe(geos.length);
  });

  it('공용 재질 캐시를 쓰지 않는다 (색을 바꿔도 다른 곳이 안 물든다)', () => {
    const a = new SpotMark();
    const b = new SpotMark();
    a.put(0, 5, 1);
    b.put(0, 5, 1);
    const matOf = (m: SpotMark) => ((m.object.children[0] as THREE.Mesh).material as THREE.Material);
    expect(matOf(a)).not.toBe(matOf(b));
  });
});
