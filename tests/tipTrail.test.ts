import { expect, it } from 'vitest';
import * as THREE from 'three';
import { TipTrail } from '../src/render/tipTrail';

it('점을 넣으면 쌓인다', () => {
  const t = new TipTrail();
  expect(t.count).toBe(0);
  t.push(0, 1, 0);
  t.push(1, 1, 0);
  expect(t.count).toBe(2);
  t.dispose();
});

it('상한을 넘으면 오래된 것부터 버린다', () => {
  const t = new TipTrail(3);
  for (let i = 0; i < 5; i++) t.push(i, 0, 0);
  expect(t.count).toBe(3);
  // 남은 것은 마지막 세 개 (x = 2, 3, 4)
  const pos = (t.object as THREE.Line).geometry.getAttribute('position');
  expect([pos.getX(0), pos.getX(1), pos.getX(2)]).toEqual([2, 3, 4]);
  t.dispose();
});

it('너무 가까운 점은 넣지 않는다 (버퍼가 한자리에서 다 차지 않게)', () => {
  const t = new TipTrail(100, 0.05);
  t.push(0, 0, 0);
  t.push(0.01, 0, 0); // 1cm — 건너뜀
  t.push(0.2, 0, 0); // 20cm — 넣음
  expect(t.count).toBe(2);
  t.dispose();
});

it('clear하면 비고 다시 쓸 수 있다', () => {
  const t = new TipTrail();
  t.push(0, 0, 0);
  t.push(1, 0, 0);
  t.clear();
  expect(t.count).toBe(0);
  t.push(2, 0, 0);
  expect(t.count).toBe(1);
  t.dispose();
});

it('dispose 뒤에 써도 던지지 않는다', () => {
  const t = new TipTrail();
  t.push(0, 0, 0);
  t.dispose();
  expect(() => t.push(1, 0, 0)).not.toThrow();
  expect(() => t.clear()).not.toThrow();
  expect(() => t.dispose()).not.toThrow();
  expect(t.count).toBe(0);
});

it('매 프레임 새 geometry를 만들지 않는다 (저가폰)', () => {
  const t = new TipTrail(50);
  const g = (t.object as THREE.Line).geometry;
  for (let i = 0; i < 40; i++) t.push(i * 0.5, 0, 0);
  expect((t.object as THREE.Line).geometry).toBe(g);
  t.dispose();
});
