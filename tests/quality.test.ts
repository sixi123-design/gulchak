import { beforeEach, expect, it } from 'vitest';
import { installFakeStorage } from './fakeStorage';
import { Q, autoLevel, loadQuality, saveQuality, levelOf, pick, current, tick, AUTO_MAX } from '../src/ui/quality';

installFakeStorage();
beforeEach(() => localStorage.clear());

it('보통이 현행 값', () => {
  expect(Q[1].dprCap).toBe(1.25);
  expect(Q[1].aa).toBe(false);
});
it('느리면 한 단 내린다', () => expect(autoLevel(45, 1)).toBe(0));
it('가장 낮은 단에서는 더 안 내려간다', () => expect(autoLevel(45, 0)).toBe(0));
it('빠르면 한 단 올린다', () => expect(autoLevel(14, 0)).toBe(1));
it('자동 상한(보통)에서는 더 안 올라간다', () => expect(autoLevel(14, 1)).toBe(1));
it('선명하게는 자동이 건드려 내리지 않는다', () => expect(autoLevel(14, 2)).toBe(2));
it('어중간하면 그대로', () => expect(autoLevel(28, 1)).toBe(1));
it('기본은 자동', () => expect(loadQuality()).toBe('auto'));
it('손으로 고른 값은 유지된다', () => {
  saveQuality(2);
  expect(loadQuality()).toBe(2);
});
it('저장값이 손상되면 자동으로 본다', () => {
  localStorage.setItem('exc-q', '7');
  expect(loadQuality()).toBe('auto');
  localStorage.setItem('exc-q', 'abc');
  expect(loadQuality()).toBe('auto');
});
it('자동일 때의 시작 단계는 보통', () => expect(levelOf('auto')).toBe(1));
it('고른 값이 있으면 그 단계', () => expect(levelOf(0)).toBe(0));

it('자동으로 되돌리면 자동이 다시 돈다', () => {
  pick(3); // 선명하게
  expect(current().pref).toBe(2);
  pick(0); // 자동
  expect(current().pref).toBe('auto');
  // 자동이면 느릴 때 단계가 내려가야 한다
  expect(tick(45)).toBe(0);
});

it('손으로 고르면 자동은 멈춘다', () => {
  pick(1); // 부드럽게
  expect(current().pref).toBe(0);
  expect(tick(14)).toBe(null);
});

it('자동은 보통보다 위로는 안 올린다', () => {
  pick(0);
  expect(AUTO_MAX).toBe(1);
  expect(tick(45)).toBe(0); // 내려가고
  expect(tick(14)).toBe(1); // 보통까지만 돌아온다
  expect(tick(14)).toBe(null); // 더는 안 올린다
});

it('안티에일리어싱 안내는 지금 켜져 있는 것과 비교한다', () => {
  pick(3); // 선명하게: 지금 렌더러는 AA 꺼짐 → 다시 켤 때 적용
  expect(current().aaChanged).toBe(true);
  pick(2); // 보통으로 되돌리면 렌더러와 같아지므로 안내할 것이 없다
  expect(current().aaChanged).toBe(false);
});
