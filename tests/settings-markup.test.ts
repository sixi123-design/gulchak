import { expect, it } from 'vitest';
// 파일을 글자 그대로 읽는다. html·ts는 vite의 ?raw로 되지만 css는 vitest가 비워서 fs로 읽는다.
// (선언은 tests/node-fs.d.ts)
import { readFileSync } from 'node:fs';
import html from '../index.html?raw';
import main from '../src/main.ts?raw';

const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

it('main.ts가 찾는 요소가 모두 index.html에 있다', () => {
  const used = new Set([...main.matchAll(/\$(?:<[^>]+>)?\('([a-z0-9-]+)'\)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !ids.has(id));
  expect(missing).toEqual([]);
});

it('설정 탭은 조작·화면·시험장 셋', () => {
  const tabs = [...html.matchAll(/<button data-tab="([a-z]+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
  expect(tabs).toEqual([
    ['keys', '조작'],
    ['view', '화면'],
    ['machine', '시험장'],
  ]);
});

it('탭마다 짝이 되는 칸이 있다 (좌석은 버튼으로 들어가는 숨은 칸)', () => {
  const panes = [...html.matchAll(/data-pane="([a-z]+)"/g)].map((m) => m[1]);
  expect(new Set(panes)).toEqual(new Set(['keys', 'view', 'machine', 'seat']));
});

it('새 설정 항목이 모두 있다', () => {
  for (const id of ['z-edge', 'z-labels', 'buzz-row', 'q-row', 'vol-all', 'btn-seat-go', 'btn-reset-tut', 'pro-state', 'btn-restore'])
    expect(ids.has(id), id).toBe(true);
});

it('레버 여백은 CSS 변수로 움직인다', () => {
  expect(css).toMatch(/--stick-edge:\s*18px/);
  expect(css).toMatch(/bottom: max\(var\(--stick-edge\)/);
  // 레버 글자 토글도 레버 위에 붙어 있으니 같이 움직여야 한다
  expect(css).toMatch(/\.lab-toggle \{[^}]*var\(--stick-edge\)/);
});

it('진동은 buzz()로만 쓴다', () => {
  expect(main).not.toMatch(/navigator\.vibrate/);
});

it('id는 문서에서 겹치지 않는다', () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = all.filter((id, i) => all.indexOf(id) !== i);
  expect(dup).toEqual([]);
});

it('레버 글자 토글의 가장자리 값이 모두 CSS 변수를 쓴다', () => {
  // .lab-toggle 규칙이 여러 번 덮어써서, 뒤쪽 규칙에 고정 px가 남아 있으면 레버와 따로 논다
  const blocks = [...css.matchAll(/([^{}]*\.lab-toggle[^{}]*)\{([^}]*)\}/g)];
  const stuck = blocks
    .filter(([, , body]) => /safe-area-inset-(left|bottom)/.test(body) && /max\(\s*\d+px/.test(body))
    .map(([, sel]) => sel.trim());
  expect(stuck).toEqual([]);
});

it('저장된 전체 음량이 시작할 때 적용된다', () => {
  // 슬라이더를 건드려야만 적용되면 새로고침 뒤 소리가 예전 크기로 난다
  const start = main.slice(main.indexOf('const sound = new MachineSound()'));
  expect(start.slice(0, 600)).toMatch(/sound\.setMaster\(/);
});
