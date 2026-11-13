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

it('설정 탭은 조작·화면·소리·시험장 넷', () => {
  const tabs = [...html.matchAll(/<button data-tab="([a-z]+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
  expect(tabs).toEqual([
    ['keys', '조작'],
    ['view', '화면'],
    ['sound', '소리'],
    ['machine', '시험장'],
  ]);
});

it('탭마다 짝이 되는 칸이 있다 (좌석은 버튼으로 들어가는 숨은 칸)', () => {
  const panes = [...html.matchAll(/data-pane="([a-z]+)"/g)].map((m) => m[1]);
  expect(new Set(panes)).toEqual(new Set(['keys', 'view', 'sound', 'machine', 'seat']));
});

it('새 설정 항목이 모두 있다', () => {
  for (const id of ['z-edge', 'z-labels', 'buzz-row', 'q-row', 'vol-all', 'btn-seat-go', 'btn-reset-tut', 'btn-restore', 'redeem-input'])
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

it('설정 탭 칸 수가 탭 개수와 맞는다', () => {
  // 폰(pointer: coarse)에서만 5칸으로 두던 규칙이 남으면 탭 3개가 화면 왼쪽 60%에 몰린다
  const tabRules = [...css.matchAll(/([^{}]*\.tabs[^{}]*)\{([^}]*grid-template-columns[^}]*)\}/g)];
  const wrong = tabRules.filter(([, , body]) => !/repeat\(4,/.test(body)).map(([, sel]) => sel.trim());
  expect(wrong).toEqual([]);
});

it('설정을 닫아도 마지막 탭이 남는다', () => {
  // 확인으로 닫을 때 탭을 조작으로 되돌리면, 소리에서 음량 만지고 닫았다 열면 조작 탭이 뜬다
  const close = main.slice(main.indexOf("$('btn-settings-ok').onclick"));
  expect(close.slice(0, 400)).not.toMatch(/showTab\('(keys|view|sound|machine)'\)/);
});

it('누르는 것들은 손가락 크기만큼 높다', () => {
  // 장갑 낀 손가락 기준. 칩·탭 모두 최소 높이를 둔다
  for (const sel of ['.lk-chip', '.settings-card .tabs button']) {
    const blocks = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter(([, s2]) => s2.includes(sel));
    expect(blocks.some(([, , body]) => /min-height:\s*4[4-9]px|min-height:\s*5\dpx/.test(body)), sel).toBe(true);
  }
});

it('채점하지 않은 판에 통과라고 쓰지 않는다', () => {
  // 자유 연습은 시간도 채점도 안 걸린다. 여기서 '통과'라고 쓰면 진짜 시험에서 떨어졌을 때 거짓말이 된다
  expect(main).not.toMatch(/모든 과정 통과/);
});

it('결제 벽 문구가 파는 것을 말한다 (판정이 아니라 시험 기준이 걸린 판)', () => {
  const perks = main.slice(main.indexOf("$('pw-perks')"), main.indexOf("$('pw-perks')") + 400);
  expect(perks).toMatch(/굴착 4분/);
  expect(perks).toMatch(/주행 2분/);
  expect(perks).not.toMatch(/합격(할지|인지|여부)/);
});
