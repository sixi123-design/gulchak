import { expect, it } from 'vitest';
import * as THREE from 'three';
import { MACHINE } from '../src/config/machine';
import rules from '../src/config/rules.json';
import { PRACTICE } from '../src/core/ruleEngine';
import { DigSession, type RulesFile } from '../src/sim/session';
import { fk, ik, toWorld } from '../src/sim/kinematics';

// 화면 모델(three.js)을 캔버스 없이 만들기 위한 최소 대역
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop, set: () => true });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };

it('차체 들림: 버킷 쪽 바퀴만 들리고 반대쪽 바퀴는 땅에, 버킷은 시뮬 자리 그대로', async () => {
  const { ExcavatorView } = await import('../src/render/excavatorView');
  const s = new DigSession(MACHINE, rules as unknown as RulesFile, PRACTICE, () => 0.5);
  const v = new ExcavatorView(MACHINE, 'A') as any;
  for (const swing of [Math.PI, 0]) {
    s.setPose({ ...ik(MACHINE, 6, 0, -1.4)!, swing });
    s.lift = (5 * Math.PI) / 180;
    v.sync(s);
    v.root.updateMatrixWorld(true);
    const pin = new THREE.Vector3();
    v.bucket.getWorldPosition(pin);
    const P2 = toWorld(swing, fk(MACHINE, s.pose).P2);
    expect(pin.distanceTo(new THREE.Vector3(P2.x, P2.y, P2.z))).toBeLessThan(1e-6);
    const side = Math.sign(Math.cos(swing));
    const near = v.root.localToWorld(new THREE.Vector3(side * MACHINE.wheelbase / 2, 0, 0));
    const far = v.root.localToWorld(new THREE.Vector3(-side * MACHINE.wheelbase / 2, 0, 0));
    expect(near.y).toBeGreaterThan(0.15);
    expect(Math.abs(far.y)).toBeLessThan(1e-6);
  }
});
