import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEADZONE, gaugeLevel } from '../src/ui/joystick';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/ui/styles.css', 'utf8');

describe('레버 3칸 표시', () => {
  it('손을 안 대면 0칸', () => {
    expect(gaugeLevel(0)).toBe(0);
  });

  it('손 자리로 센다 — 조금이라도 밀면(기계가 움직이면) 1칸', () => {
    // 레버 값은 데드존을 이미 뺀 손 자리다. 기계 값(곡선 뒤)으로 세면 0.4를 밀어도 0칸이었다
    expect(gaugeLevel(0.05)).toBe(1);
    expect(gaugeLevel(DEADZONE)).toBe(1);
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

  it('hidden일 때 정말로 숨는다 (display를 지정하면 [hidden]이 먹히지 않는다)', () => {
    expect(css).toMatch(/\.dr-gauge\[hidden\]\s*\{\s*display:\s*none/);
  });

  it('맞춘 칸은 색으로만 알리지 않는다 (테두리 모양도 바뀐다)', () => {
    expect(css).toMatch(/\.dr-gauge i\.want[\s\S]*?border-style: dashed/);
  });
});
