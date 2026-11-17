import { expect, it } from 'vitest';
import { flowShare } from '../src/sim/hydraulics';

const z = { swing: 0, boom: 0, arm: 0, bucket: 0 };

it('혼자 쓰면 모든 관절이 최고속도', () => {
  for (const j of ['swing', 'boom', 'arm', 'bucket'] as const) {
    expect(flowShare({ ...z, [j]: 1 }, true)[j]).toBe(1);
    expect(flowShare({ ...z, [j]: 1 }, false)[j]).toBe(1);
  }
});

it('붐 올리며 선회: 선회는 그대로, 붐은 합류가 줄어 느려진다', () => {
  const f = flowShare({ ...z, boom: 1, swing: 1 }, true);
  expect(f.swing).toBe(1);
  expect(f.boom).toBeGreaterThan(0.6);
  expect(f.boom).toBeLessThan(0.8);
});

it('붐 내리며 선회: 붐 내림은 자중 재생이라 안 느려진다', () => {
  const f = flowShare({ ...z, boom: 1, swing: 1 }, false);
  expect(f.boom).toBe(1);
  expect(f.swing).toBe(1);
});

it('암 당기며 버킷 오므리기: 둘 다 움직이고 암이 조금 느려진다', () => {
  const f = flowShare({ ...z, arm: 1, bucket: 1 }, true);
  expect(f.bucket).toBe(1);
  expect(f.arm).toBeGreaterThan(0.5);
  expect(f.arm).toBeLessThan(0.8);
});

it('반 레버 둘은 기름이 남아 안 느려진다 (붐 올림 반 + 선회 반)', () => {
  const f = flowShare({ ...z, boom: 0.5, swing: 0.5 }, true);
  expect(f.boom).toBe(1);
  expect(f.swing).toBe(1);
});

it('네 개를 다 끝까지 밀면 모두 느려지지만 서지는 않는다', () => {
  const f = flowShare({ swing: 1, boom: 1, arm: 1, bucket: 1 }, true);
  for (const j of ['swing', 'boom', 'arm', 'bucket'] as const) {
    expect(f[j]).toBeLessThan(1);
    expect(f[j]).toBeGreaterThan(0.2);
  }
});
