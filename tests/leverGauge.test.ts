import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEADZONE, gaugeLevel } from '../src/ui/joystick';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/ui/styles.css', 'utf8');

describe('레버 3칸 표시', () => {
  it('데드존 안이면 0칸 — 기계가 안 움직이는 구간이다', () => {
    expect(gaugeLevel(0)).toBe(0);
    expect(gaugeLevel(DEADZONE - 0.01)).toBe(0);
    expect(gaugeLevel(DEADZONE)).toBe(0);
  });

  it('데드존을 넘으면 1칸', () => {
    expect(gaugeLevel(DEADZONE + 0.01)).toBe(1);
    expect(gaugeLevel(0.4)).toBe(1);
  });

  it('반쯤 밀면 2칸', () => {
    expect(gaugeLevel(0.41)).toBe(2);
    expect(gaugeLevel(0.7)).toBe(2);
  });

  it('끝까지 밀면 3칸', () => {
    expect(gaugeLevel(0.71)).toBe(3);
    expect(gaugeLevel(1)).toBe(3);
  });

  it('반대 방향으로 밀어도 같은 칸 (부호는 안 본다)', () => {
    for (const v of [0.3, 0.55, 0.9]) expect(gaugeLevel(-v)).toBe(gaugeLevel(v));
  });

  it('1을 넘겨도 3칸을 넘지 않는다', () => {
    expect(gaugeLevel(1.5)).toBe(3);
  });
});

describe('3칸 표시 마크업', () => {
  it('칸이 정확히 세 개다', () => {
    const box = html.match(/<div class="dr-gauge"[^>]*>([\s\S]*?)<\/div>/);
    expect(box).toBeTruthy();
    expect((box![1].match(/<i>/g) ?? []).length).toBe(3);
  });

  it('평소에는 숨어 있다 (레버 양을 가르치는 구간에서만 띄운다)', () => {
    expect(html).toMatch(/<div class="dr-gauge"[^>]*\shidden/);
  });

  it('숫자를 쓰지 않는다 — 글자가 들어갈 자리가 없다', () => {
    const box = html.match(/<div class="dr-gauge"[^>]*>([\s\S]*?)<\/div>/)![1];
    expect(box.replace(/<\/?i>/g, '').trim()).toBe('');
  });

  it('지시문·부품 줄과 겹치지 않게 아래에 붙는다', () => {
    expect(html.indexOf('id="dr-text"')).toBeLessThan(html.indexOf('id="dr-gauge"'));
    expect(html.indexOf('id="dr-gauge"')).toBeLessThan(html.indexOf('id="dr-part"'));
  });

  it('맞춘 칸은 색으로만 알리지 않는다 (테두리 모양도 바뀐다)', () => {
    expect(css).toMatch(/\.dr-gauge i\.want[\s\S]*?border-style: dashed/);
  });
});
