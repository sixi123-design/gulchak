# 설정창 재구성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 탭을 5개에서 3개로 줄이고, 레버 여백 · 진동 끄기 · 전체 음량 · 화질 3단 · 이용권 한 줄을 추가한다.

**Architecture:** 흩어져 있는 설정 값(`exc-*` localStorage, `UI_SIZES`, `labelsOn`, `dprCap`)을 `src/ui/prefs.ts` 한 곳으로 모은다. prefs는 순수 모듈(값·기본값·범위·CSS 변수 매핑)이라 vitest로 검증하고, DOM 배선은 `main.ts`에 남긴다. 화질·음량·진동도 "순수 계산 함수 + 얇은 배선"으로 나눠 계산 쪽만 테스트한다.

**Tech Stack:** TypeScript, Vite, three 0.170.0, vitest (`npm test`), 빌드 `npm run build`(tsc --noEmit 포함)

**Spec:** `docs/superpowers/specs/2026-11-13-settings-restructure-design.md`

## Global Constraints

- 저가폰이 1순위. 기본값은 현행 그대로여서 기존 사용자의 화면이 변하지 않아야 한다: 레버 여백 18px, dprCap 1.25, 안티에일리어싱 끔, 전체 음량 100%, 진동 켬.
- `src/sim/soil.ts`의 격자(`cell`)와 판정 코드는 이 작업에서 건드리지 않는다. 화질이 점수를 바꾸면 안 된다.
- 모든 localStorage 접근은 try/catch로 감싼다. 차단된 브라우저에서도 기본값으로 동작해야 한다.
- UI 문구는 짧은 한국어. 새 의존성 추가 금지.
- 저장 키는 기존 `exc-` 접두사를 따른다: `exc-z-edge`, `exc-buzz`, `exc-vol-all`, `exc-q`.

## Review Focus

- localStorage가 막힌 브라우저(사파리 프라이빗): 설정을 읽고 쓰는 모든 경로가 예외 없이 기본값으로 동작해야 한다 → Task 1.
- 저장값이 손상되거나 범위 밖(`exc-z-edge: "9"`, `exc-vol-all: "abc"`): 기본값으로 떨어져야 한다 → Task 1.
- `navigator.vibrate`가 없는 기기(iOS 사파리): 진동 설정이 켜져 있어도 조용히 넘어가야 한다 → Task 3.
- 음소거 중 전체 음량을 움직였을 때: 음소거는 유지되고, 해제하면 새 음량으로 울려야 한다 → Task 2.
- 자동 화질이 사용자가 손으로 고른 값을 덮어쓰면 안 된다. 자동일 때만 오르내린다 → Task 4.

---

### Task 1: prefs 모듈

**Files:**
- Create: `src/ui/prefs.ts`
- Create: `tests/fakeStorage.ts` (vitest 환경이 `node`라 `localStorage`가 없다 — `vite.config.ts`의 `test.environment: 'node'`)
- Test: `tests/prefs.test.ts`

**Interfaces:**
- Produces:
  - `type PrefKey = 'btn' | 'txt' | 'stick' | 'edge'`
  - `const STEPS: Record<PrefKey, { label: readonly string[]; v: readonly number[]; def: number }>`
    - `btn` `['작게','보통','크게']` / `[0.88, 1, 1.15]` / def 1
    - `txt` `['보통','크게','아주 크게']` / `[1, 1.18, 1.36]` / def 0
    - `stick` `['작게','보통','크게']` / `[0.85, 1, 1.18]` / def 1
    - `edge` `['좁게','보통','넓게']` / `[8, 18, 32]` / def 1
  - `function loadStep(k: PrefKey): number` — 범위 밖·손상·저장소 차단이면 `STEPS[k].def`
  - `function saveStep(k: PrefKey, i: number): void`
  - `function cssVars(): Record<string, string>` — `--z-btn/--z-txt/--z-stick`은 배수 문자열, `--stick-edge`는 `'18px'` 꼴
  - `function loadNum(key: string, def: number, lo: number, hi: number): number`
  - `function loadFlag(key: string, def: boolean): boolean`
  - `function saveRaw(key: string, v: string): void`
- Produces (테스트용): `tests/fakeStorage.ts`의 `export function installFakeStorage(): void` — Map 기반 `Storage`를 `globalThis.localStorage`에 꽂는다. Task 4도 같은 것을 쓴다.

- [ ] **Step 1: Write the failing test** — `tests/fakeStorage.ts`와 `tests/prefs.test.ts`

```ts
import { beforeEach, expect, it } from 'vitest';
import { installFakeStorage } from './fakeStorage';
import { STEPS, loadStep, saveStep, cssVars, loadNum, loadFlag } from '../src/ui/prefs';

installFakeStorage();
beforeEach(() => localStorage.clear());

it('저장값이 없으면 기본값', () => {
  expect(loadStep('edge')).toBe(STEPS.edge.def);
  expect(STEPS.edge.v[STEPS.edge.def]).toBe(18); // 현행 유지
});
it('범위 밖·손상값은 기본값', () => {
  localStorage.setItem('exc-z-edge', '9');
  expect(loadStep('edge')).toBe(STEPS.edge.def);
  localStorage.setItem('exc-z-edge', 'abc');
  expect(loadStep('edge')).toBe(STEPS.edge.def);
});
it('저장하면 다시 읽힌다', () => {
  saveStep('edge', 2);
  expect(loadStep('edge')).toBe(2);
});
it('cssVars는 레버 여백을 px로 준다', () => {
  saveStep('edge', 0);
  expect(cssVars()['--stick-edge']).toBe('8px');
  expect(cssVars()['--z-btn']).toBe('1');
});
it('loadNum·loadFlag도 범위와 기본값을 지킨다', () => {
  localStorage.setItem('exc-vol-all', 'abc');
  expect(loadNum('exc-vol-all', 1, 0, 1)).toBe(1);
  expect(loadFlag('exc-buzz', true)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/prefs.test.ts` / Expected: FAIL (`src/ui/prefs` 없음)

- [ ] **Step 3: Implement `tests/fakeStorage.ts`와 `src/ui/prefs.ts`** — Interfaces의 시그니처 그대로. prefs는 저장소 접근을 전부 try/catch로 감싸고(`globalThis.localStorage`가 없으면 기본값), 숫자는 `Number()` 후 `Number.isFinite`와 범위로 거른다. `vite.config.ts`는 건드리지 않는다.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/prefs.test.ts` / Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/prefs.ts tests/prefs.test.ts
git commit -m "설정: 환경설정 값을 prefs 모듈로 모음"
```

---

### Task 2: 전체 음량

**Files:**
- Modify: `src/ui/audio.ts:60-62, 206-209`
- Modify: `index.html` (소리 "전체" 줄에 슬라이더 `id="vol-all"`)
- Modify: `src/main.ts:319-341` (`syncSoundUi`, `mute-all` 배선)
- Test: `tests/audio-master.test.ts`

**Interfaces:**
- Consumes: Task 1의 `loadNum('exc-vol-all', 1, 0, 1)`, `saveRaw`
- Produces: `export function masterGain(vol: number, muted: boolean): number` (`src/ui/audio.ts`), `Sound.setMaster(v: number): void`

- [ ] **Step 1: Write the failing test** — `tests/audio-master.test.ts`

```ts
import { expect, it } from 'vitest';
import { masterGain } from '../src/ui/audio';

it('음량 100%는 지금과 같은 0.8', () => expect(masterGain(1, false)).toBeCloseTo(0.8));
it('절반이면 0.4', () => expect(masterGain(0.5, false)).toBeCloseTo(0.4));
it('음소거는 음량과 무관하게 0', () => expect(masterGain(0.5, true)).toBe(0));
it('범위를 벗어난 값은 0~1로 자른다', () => {
  expect(masterGain(2, false)).toBeCloseTo(0.8);
  expect(masterGain(-1, false)).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/audio-master.test.ts` / Expected: FAIL (`masterGain` 없음)

- [ ] **Step 3: Implement** — `audio.ts`에 `masterGain`을 추가하고, `master.gain` 초기값(`audio.ts:61`)과 `setMuted`(`audio.ts:206-209`)가 이 함수를 쓰게 바꾼다. `setMaster(v)`는 현재 음량을 필드에 저장한 뒤 같은 함수로 게인을 다시 건다(`setTargetAtTime(..., 0.05)`).

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/audio-master.test.ts` / Expected: PASS

- [ ] **Step 5: UI 배선** — `index.html`의 `.vol-row.all`에 다른 줄과 같은 `<input type="range" id="vol-all" min="0" max="100" />`를 넣는다. `main.ts`의 `syncSoundUi`에서 값을 채우고, `oninput`에서 `sound.setMaster(v / 100)` + `saveRaw('exc-vol-all', String(v / 100))`. 음소거 상태는 건드리지 않는다. 시작 시 `sound.setMaster(loadNum('exc-vol-all', 1, 0, 1))`.

- [ ] **Step 6: 확인** — `npm run build` 통과. `npm run dev`로 열어 전체 슬라이더를 반으로 내리면 전체 소리가 줄고, 음소거를 켰다 끄면 줄어든 음량으로 돌아오는지 본다.

- [ ] **Step 7: Commit**

```bash
git add src/ui/audio.ts src/main.ts index.html tests/audio-master.test.ts
git commit -m "설정: 전체 음량 조절 추가"
```

---

### Task 3: 진동 한 곳으로 + 끄기

**Files:**
- Create: `src/ui/buzz.ts`
- Modify: `src/main.ts` (`navigator.vibrate` 호출 8곳 → `buzz(...)`)
- Test: `tests/buzz.test.ts`

**Interfaces:**
- Consumes: Task 1의 `loadFlag('exc-buzz', true)`, `saveRaw`
- Produces: `export function setBuzz(on: boolean): void`, `export function buzzOn(): boolean`, `export function buzz(p: number | number[]): void`, `export function _setVibrate(fn: ((p: number | number[]) => void) | null): void` (테스트 주입용)

- [ ] **Step 1: Write the failing test** — `tests/buzz.test.ts`

```ts
import { beforeEach, expect, it } from 'vitest';
import { buzz, setBuzz, _setVibrate } from '../src/ui/buzz';

let calls: (number | number[])[];
beforeEach(() => {
  calls = [];
  _setVibrate((p) => calls.push(p));
  setBuzz(true);
});

it('켜져 있으면 그대로 전달', () => { buzz(15); expect(calls).toEqual([15]); });
it('꺼져 있으면 호출하지 않음', () => { setBuzz(false); buzz(15); expect(calls).toEqual([]); });
it('진동을 못 쓰는 기기에서도 터지지 않음', () => { _setVibrate(null); expect(() => buzz([30, 40])).not.toThrow(); });
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/buzz.test.ts` / Expected: FAIL

- [ ] **Step 3: Implement `src/ui/buzz.ts`** — 기본 vibrate는 `navigator.vibrate`가 있으면 그것을 바인딩하고 없으면 `null`. 설정값은 `loadFlag('exc-buzz', true)`로 초기화하고 `setBuzz`가 저장까지 한다.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/buzz.test.ts` / Expected: PASS

- [ ] **Step 5: `main.ts`의 `navigator.vibrate(...)` 호출 8곳을 `buzz(...)`로 교체** — 패턴 인자는 그대로 옮긴다. `grep -rn "navigator.vibrate" src`가 비면 끝.

- [ ] **Step 6: 확인** — `npm test` 전체 통과, `npm run build` 통과.

- [ ] **Step 7: Commit**

```bash
git add src/ui/buzz.ts src/main.ts tests/buzz.test.ts
git commit -m "설정: 진동을 buzz()로 모으고 끌 수 있게"
```

---

### Task 4: 화질 3단

**Files:**
- Create: `src/ui/quality.ts`
- Modify: `src/main.ts:40-62` (렌더러 생성·`applySize`), `src/main.ts:2059-2065` (자동 하향)
- Test: `tests/quality.test.ts`

**Interfaces:**
- Consumes: Task 1의 `loadNum`/`saveRaw`
- Produces:
  - `type QLevel = 0 | 1 | 2`
  - `const Q: Record<QLevel, { label: string; dprCap: number; aa: boolean; fx: number }>` — 0 `부드럽게`/0.75/false/0.6, 1 `보통`/1.25/false/1, 2 `선명하게`/2/true/1.4
  - `function loadQuality(): QLevel | 'auto'`
  - `function saveQuality(q: QLevel | 'auto'): void`
  - `function autoLevel(frameAvgMs: number, cur: QLevel): QLevel` — 38ms 넘으면 한 단 내림, 20ms 밑이면 한 단 올림, 사이면 유지

- [ ] **Step 1: Write the failing test** — `tests/quality.test.ts`

```ts
import { beforeEach, expect, it } from 'vitest';
import { installFakeStorage } from './fakeStorage';
import { Q, autoLevel, loadQuality, saveQuality } from '../src/ui/quality';

installFakeStorage();
beforeEach(() => localStorage.clear());

it('보통이 현행 값', () => { expect(Q[1].dprCap).toBe(1.25); expect(Q[1].aa).toBe(false); });
it('느리면 한 단 내린다', () => expect(autoLevel(45, 1)).toBe(0));
it('가장 낮은 단에서는 더 안 내려간다', () => expect(autoLevel(45, 0)).toBe(0));
it('빠르면 한 단 올린다', () => expect(autoLevel(14, 1)).toBe(2));
it('가장 높은 단에서는 더 안 올라간다', () => expect(autoLevel(14, 2)).toBe(2));
it('어중간하면 그대로', () => expect(autoLevel(28, 1)).toBe(1));
it('기본은 자동', () => expect(loadQuality()).toBe('auto'));
it('손으로 고른 값은 유지된다', () => { saveQuality(2); expect(loadQuality()).toBe(2); });
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/quality.test.ts` / Expected: FAIL

- [ ] **Step 3: Implement `src/ui/quality.ts`** — 저장 키 `exc-q`(`'auto' | '0' | '1' | '2'`), 그 밖의 값은 `'auto'`로 읽는다.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/quality.test.ts` / Expected: PASS

- [ ] **Step 5: `main.ts` 배선** — `dprCap`을 현재 단계의 `Q[lv].dprCap`에서 가져온다. 프레임 루프의 자동 하향 블록(`main.ts:2059-2065`)을 `autoLevel`로 바꾸되, **저장값이 `'auto'`일 때만** 단계가 바뀐다. 설정에서 사용자가 고르면 그 값으로 고정하고 자동을 끈다. 안티에일리어싱은 WebGL 컨텍스트 생성 옵션이라 **다음 실행부터 적용**하고, 설정에서 바꾸면 그 줄 아래에 "다음에 켤 때 적용" 한 줄을 띄운다. `fx`는 상수로 내보내기만 하고 쓰지 않는다(먼지 양 조절부가 아직 한 곳이 아니라 다음 작업).

- [ ] **Step 6: 확인** — `npm run build` 통과. `?debug`로 열어 화질을 바꿀 때 왼쪽 위 `dpr` 표시가 따라 바뀌는지 본다.

- [ ] **Step 7: Commit**

```bash
git add src/ui/quality.ts src/main.ts tests/quality.test.ts
git commit -m "설정: 화질 3단(자동 포함) 추가"
```

---

### Task 5: 레버 여백 + 설정창 3탭 재구성

**Files:**
- Modify: `src/ui/styles.css:245-257` (`.stick` 여백 → `--stick-edge`), 설정 탭·푸터 규칙
- Modify: `index.html:131-212` (탭 3개, 칸 재배치, 새 항목, 이용권 푸터)
- Modify: `src/main.ts:538-612` (`UI_SIZES` → prefs, `showTab`, `openSettings`)
- Modify: `src/core/entitlement.ts`

**Interfaces:**
- Consumes: Task 1 `STEPS`/`loadStep`/`saveStep`/`cssVars`, Task 3 `setBuzz`/`buzzOn`, Task 4 `Q`/`loadQuality`/`saveQuality`
- Produces: `export function redeem(code: string): boolean` (`src/core/entitlement.ts`)

- [ ] **Step 1: CSS 변수화** — `:root`에 `--stick-edge: 18px`를 두고 `.stick`의 `bottom`/`left`/`right`를 `max(var(--stick-edge), env(safe-area-inset-*))`로 바꾼다. `main.ts`는 `cssVars()`의 값을 `document.documentElement.style.setProperty`로 한 번에 적용한다(기존 `applyUiSize` 자리).

- [ ] **Step 2: 탭 3개로** — `index.html`의 탭 버튼을 `조작 · 화면 · 시험장`으로 줄이고 각 `section[data-pane]`을 설계의 배치대로 옮긴다. 좌석 높이는 탭에서 빼고 화면 탭 안의 `<button id="btn-seat-go">좌석 높이 맞추기</button>`로 들어간다. 기존 `showTab('seat')`·`seatFrom` 되돌리기 로직은 그대로 쓰고, `seatFrom`의 기본값만 `'view'`로 바꾼다.

- [ ] **Step 3: 새 항목 UI** — 화면 탭에 화질(`id="q-row"`), 조작 탭에 레버 여백(`id="z-edge"`)·진동(`id="buzz-row"`)·레버 글자(`id="z-labels"`, HUD의 `btn-labels`와 같은 `exc-labels` 값을 본다). 모두 기존 `.lk-row.s3` 칩 모양을 따른다. `renderUiSize`를 `renderViewPrefs()` 하나로 합쳐 prefs에서 그린다.

- [ ] **Step 4: 이용권 푸터** — `.set-foot` 위에 한 줄: 상태(`hasPro()` → "이용 중" / "무료")와 `<button id="btn-restore">구매 복원</button>`. 복원을 누르면 코드 입력 칸을 펼치고, 확인 시 `redeem(code)` 결과에 따라 한 줄 안내. 탭은 늘리지 않는다.

- [ ] **Step 5: 시험장 탭에 "배운 내용 초기화" 추가** — `exc-tut`를 지우고 배우기 진행도를 되돌린다(`main.ts:875`, `main.ts:1174`가 읽고 쓰는 값). 되돌릴 수 없으니 한 번 더 묻는 확인 줄을 거친다. `confirm()`은 쓰지 않고 버튼이 "정말 지울까요? [지움]"으로 바뀌는 식으로 한다.

- [ ] **Step 6: `entitlement.ts`에 `redeem(code: string): boolean` 추가** — 지금은 언제나 `false`를 돌려주고 `// TODO: 서명 키 검증` 주석을 단다. 호출부는 "코드를 확인할 수 없어요"를 띄운다.

- [ ] **Step 7: 확인** — `npm test` 전체 통과, `npm run build` 통과. `npm run dev`로 열어 확인한다: 탭이 3개로 보이고 / 레버 여백 3단이 실제로 레버를 움직이고 / 좌석 높이 버튼으로 들어갔다 취소하면 화면 탭으로 돌아오고 / 설정을 끈 뒤 새로고침해도 고른 값이 남아 있는지.

- [ ] **Step 8: Commit**

```bash
git add index.html src/ui/styles.css src/main.ts src/core/entitlement.ts
git commit -m "설정: 탭 3개로 재구성, 레버 여백·이용권 줄 추가"
```

---

### Task 6: 마무리

**Files:**
- Modify: `README.md` (설정 설명이 있을 때만)

- [ ] **Step 1: README에 설정 구성 설명이 있으면 새 3탭 구성으로 고친다.** 없으면 건너뛰고 그렇게 적는다.
- [ ] **Step 2: `npm test`와 `npm run build`를 한 번씩 돌려 전부 통과하는지 확인한다.**
- [ ] **Step 3: Commit** — `git commit -m "문서: 설정 구성 갱신"`
