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

it('결제 벽은 바깥 가격과 비교하지 않고, 한 번 내면 끝이라는 것만 말한다', () => {
  const pw = html.slice(html.indexOf('id="paywall"'), html.indexOf('id="paywall"') + 1400);
  expect(pw).toMatch(/한 번만 결제/);
  expect(pw).not.toMatch(/학원|만원 아/);
});

it('이론 카드 자리가 있고 id가 유일하다', () => {
  for (const id of ['why', 'why-title', 'why-art', 'why-text', 'btn-why-go', 'btn-why', 'btn-why-back']) {
    expect([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, id).toBe(1);
  }
});

it('이론 카드 버튼도 손가락 크기만큼 크다', () => {
  // 미션 박스의 '왜?' (#btn-why는 .m-why로 모양을 받는다)
  for (const sel of ['.m-why', '.why-back']) {
    const blocks = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter(([, s2]) => s2.includes(sel));
    expect(blocks.some(([, , body]) => /min-height:\s*4[4-9]px|min-height:\s*5\dpx/.test(body)), sel).toBe(true);
  }
});

it('클리어 화면에 별 세 개와 한 줄 평 자리가 있다', () => {
  const stars = html.slice(html.indexOf('cl-stars'), html.indexOf('cl-stars') + 120);
  expect([...stars.matchAll(/<i>/g)].length).toBe(3);
  expect([...html.matchAll(/id="clear-note"/g)].length).toBe(1);
});

it('등급 없는 미션은 클리어 화면을 건드리지 않는다', () => {
  // 기존 배우기 7개·주행 5개는 grade가 없다. 별을 끄거나 한 줄 평을 띄우면 안 된다
  const fn = main.slice(main.indexOf('function onLessonClear'), main.indexOf('function onLessonClear') + 2200);
  expect(fn).toMatch(/L\.grade/);
});

it('이론 카드가 떠 있는 동안은 미션 판정도 멈춘다', () => {
  // 물리만 멈추면 '중립으로 놓고 멈추기' 단계가 카드 뒤에서 저절로 끝난다
  expect([...main.matchAll(/tutor && \$\('why'\)\.hidden && tutor\.update\(\)/g)].length).toBe(2);
});

it('이론 카드는 읽고 해보기를 누른 뒤에 본 것으로 적는다', () => {
  // 띄울 때 적으면 카드만 보고 나간 사람에게 다시 안 보여 준다
  const i = main.indexOf('loadSeen(WHY_KEY).includes');
  expect(i).toBeGreaterThan(0);
  const near = main.slice(i, i + 260);
  expect(near.indexOf('markSeen')).toBeGreaterThan(near.indexOf('openWhy'));
});

it('시작 카드 배지 번호가 목록의 다음 번호와 같다', () => {
  // 옛 사용자가 '이어서 8단계'를 보는데 목록에서는 1번이 다음으로 뜨던 문제
  const i = main.indexOf("'처음이면 여기부터'");
  const near = main.slice(Math.max(0, i - 400), i + 200);
  expect(near).toMatch(/findIndex\(\(l\) => !done\.has\(l\.id\)\)/);
  expect(near).toMatch(/이어서 \$\{next \+ 1\}단계/);
});

it('이빨 경로 선은 쓰는 미션에서만 남고, 떠나면 지워진다', () => {
  // 장면 누수·메모리: 세션이 바뀌면 dispose, 다른 미션에서는 clear
  expect(main).toMatch(/trail\?\.dispose\(\)/);
  expect(main).toMatch(/tutor\?\.lesson\.trail/);
  const i = main.indexOf('tutor?.lesson.trail');
  expect(main.slice(i, i + 320)).toMatch(/trail\.clear\(\)/);
});
