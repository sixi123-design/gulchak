# 기본기 과정 (레버 교실) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 배우기 7개를 그대로 둔 채, 초보자가 레버를 차근차근 익히는 '기본기' 미션 4개를 배우기 목록 맨 위에 더한다 — 이론 카드 한 장과 별 등급으로 "왜"와 "잘했는지"를 알려준다.

**Architecture:** 기존 `Lesson`/`Step` 엔진을 쓴다. 엔진에는 둘만 더한다 — 미션이 끝날 때까지 지워지지 않는 `Tutor.bag`과, 클리어 화면의 별을 정하는 `Lesson.grade`. 새 미션은 `src/sim/leverSchool.ts`에 모아 두고 `main.ts`가 기존 `LESSONS` 앞에 붙여 한 목록으로 만든다 (단방향 import: leverSchool → tutorial).

**Tech Stack:** TypeScript (strict), three.js 0.170.0, vitest (`environment: 'node'`)

**Spec:** `docs/superpowers/specs/2026-11-14-lever-school-design.md`

## Global Constraints

- 물리 상수(`src/config/rules.json`)를 가르치기 편하게 바꾸지 않는다. 특히 `joltWarn` 0.1 · `joltSpill` 0.18 · `joltSafeDecel` 3.5는 그대로 둔다.
- 새 렌더 패스·새 캔버스·새 렌더 타깃을 만들지 않는다.
- 화면에 수치 그래프(속도 곡선·가속도)를 띄우지 않는다. 보이는 것은 흙·흔들림·소리·등급·cm 숫자뿐이다.
- 모든 localStorage 접근은 try/catch. 저장소가 막혀 있어도 기본값으로 동작한다.
- 키 접두사는 `exc-`.
- 기존 배우기 7개(`LESSONS`)와 주행 5개(`DRIVE_LESSONS`)의 동작은 한 글자도 바뀌지 않는다.
- 못해도 넘어갈 수 있다. 별이 1개여도 '다음' 버튼이 살아 있다.
- 미션 문구는 기존 미션들의 말투(명령형 짧은 한 줄, 레버 라벨은 화면 글자와 같게)를 따른다.
- 덜컹 소리는 이미 난다 — `main.ts:1657`이 `W-JOLT`·`W-IMPACT`에서 `sound.thump(0.8)`을 부른다. 새 소리를 만들지 않는다.
- `npm run build`(= `tsc --noEmit && vite build`)와 `npm test`가 통과해야 한다.

## Review Focus

- **옛 진행도**: `exc-tut`에 기존 7개 id만 든 사용자가 들어왔을 때 목록·'다음' 표시·진행도 숫자가 깨지지 않아야 한다 → Task 2.
- **저장소 차단**: 사파리 프라이빗처럼 localStorage가 던지는 환경에서 이론 카드가 매번 떠도 미션은 정상 시작돼야 한다 → Task 3.
- **빈 `bag`으로 grade 호출**: 단계를 다 안 거치고 클리어된 경우(되돌림·리셋 직후) 별이 `NaN`이거나 0개가 되지 않아야 한다 → Task 1.
- **grade 없는 미션**: 기존 7개는 클리어 화면이 지금과 똑같아야 한다(별 3개 고정 표시, 한 줄 평 없음) → Task 5.
- **장면 누수**: 3단계의 경로 선 객체가 미션을 떠날 때 장면에서 지워지고 geometry가 dispose돼야 한다 → Task 8.

---

### Task 1: 엔진 — `Tutor.bag`과 `Lesson.grade`

**Files:**
- Modify: `src/sim/tutorial.ts` (`Step`·`Lesson` 인터페이스, `Tutor` 클래스 580-642)
- Test: `tests/tutor-bag.test.ts`

**Interfaces:**
- Produces:
  - `Tutor.bag: Record<string, number>` — 미션 시작부터 끝까지 유지. `enter()`에서 지우지 않는다.
  - `Step` 콜백의 세 번째 인자: `begin?(s, mem, bag)` · `done(s, mem, bag)` · `fail?(s, mem, bag)` · `coach?(s, mem, bag)` · `meter?(s, mem, bag)`
  - `Grade { stars: 1 | 2 | 3; note: string }`
  - `Lesson.grade?: (s: S, bag: Record<string, number>) => Grade`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/tutor-bag.test.ts`

```ts
it('bag은 단계가 넘어가도 남는다', () => {
  // 1단계에서 bag.x = 7을 쓰고, 2단계 done에서 bag.x를 읽는 미션
  // 2단계가 bag.x === 7을 보고 통과하면 성공
});
it('mem은 단계마다 비워진다', () => {
  // 1단계에서 mem.y = 7, 2단계 begin에서 mem.y === undefined
});
it('grade는 bag을 받아 별을 돌려준다', () => {
  // grade: (_s, bag) => ({ stars: bag.hit > 0 ? 3 : 1, note: '...' })
});
it('bag이 비어 있어도 별은 1~3 사이', () => {
  // 아무 단계도 안 거친 Tutor에 grade를 불러 stars가 1, 2, 3 중 하나임을 확인
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 본다**

Run: `npx vitest run tests/tutor-bag.test.ts`
Expected: FAIL — `bag`이 `Tutor`에 없음

- [ ] **Step 3: `src/sim/tutorial.ts`에 구현한다**

`Tutor`에 `bag: Record<string, number> = {}` (public, `enter()`에서 손대지 않음). `enter()`·`update()`·`meter()`가 콜백에 `this.mem, this.bag` 순으로 넘긴다. `Step`의 다섯 콜백과 `Lesson.grade` 타입을 위 Interfaces대로 추가한다. 세 번째 인자는 선택이므로 기존 7개 미션은 수정하지 않는다.

- [ ] **Step 4: 테스트가 통과하는 것을 본다**

Run: `npx vitest run tests/tutor-bag.test.ts` → PASS
Run: `npx vitest run` → 기존 251개 전부 통과 (기존 미션 동작 불변)

- [ ] **Step 5: 커밋**

```bash
git add src/sim/tutorial.ts tests/tutor-bag.test.ts
git commit -m "배우기 엔진: 미션 단위 보관함(bag)과 별 등급(grade)"
```

---

### Task 2: '기본기' 묶음 자리

**Files:**
- Modify: `src/sim/tutorial.ts` (`Lesson.tier` 타입, `TIERS` 추가)
- Modify: `src/main.ts` (`renderLessonMap` 968-999)
- Modify: `src/ui/styles.css` (`.stage-map.tiers` 5797 근처)
- Test: `tests/tiers.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Lesson`
- Produces:
  - `Lesson.tier?: '기본기' | '기초' | '숙련'`
  - `export const TIERS: readonly { key: '기본기' | '기초' | '숙련'; sub: string; wide?: boolean }[]`
    — 순서가 목록 순서다. `기본기`는 첫 항목이고 `wide: true`.
    `sub` 문구: 기본기 `'레버부터 제대로'` · 기초 `'한 사이클 익히기'` · 숙련 `'시험처럼 매끄럽게'`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/tiers.test.ts`

```ts
it('기본기가 첫 칸', () => {
  expect(TIERS[0].key).toBe('기본기');
  expect(TIERS[0].wide).toBe(true);
});
it('모든 미션의 tier는 TIERS 안에 있다', () => {
  // LESSONS와 BASIC_LESSONS 전부
});
it('옛 진행도(기존 id만)여도 깨지지 않는다', () => {
  // ['levers','scoop'] 같은 목록으로 tierProgress를 불러 숫자가 NaN이 아님
});
```

`tierProgress(lessons, done, tier): { n: number; of: number }` 를 `src/sim/tutorial.ts`에 둔다 (순수 함수라 테스트 가능 — `renderLessonMap`의 DOM 코드에서 세는 부분을 이 함수로 바꾼다).

- [ ] **Step 2: 테스트가 실패하는 것을 본다**

Run: `npx vitest run tests/tiers.test.ts` → FAIL (`TIERS` 없음)

- [ ] **Step 3: `src/sim/tutorial.ts`에 `TIERS`와 `tierProgress`를 구현한다**

- [ ] **Step 4: `src/main.ts`의 `renderLessonMap`을 `TIERS`로 돌게 고친다**

하드코딩된 `(['기초','숙련'] as const)`를 `TIERS`로 바꾸고, `sub` 문구를 `TIERS`에서 읽고, 세는 부분을 `tierProgress`로 바꾼다. `wide`인 칸의 `<div>`에 `wide` 클래스를 더한다. 미션이 없는 tier는 칸을 그리지 않는다(0으로 나누기 방지).

- [ ] **Step 5: `src/ui/styles.css`에 `.stage-map.tiers .tier-col.wide { grid-column: 1 / -1 }`을 넣는다**

기존 `grid-template-columns: 1fr 1fr`은 그대로 둔다.

- [ ] **Step 6: 테스트·빌드 확인**

Run: `npx vitest run` → 전부 통과
Run: `npm run build` → 통과

- [ ] **Step 7: 커밋**

```bash
git add src/sim/tutorial.ts src/main.ts src/ui/styles.css tests/tiers.test.ts
git commit -m "배우기 목록: 묶음을 TIERS 데이터로, 기본기 칸은 가로 전체"
```

---

### Task 3: 이론 카드

**Files:**
- Modify: `index.html` (새 modal `#why`, `#mission`에 '왜?' 버튼)
- Modify: `src/ui/prefs.ts` (본 미션 기억)
- Modify: `src/sim/tutorial.ts` (`Lesson.why`)
- Modify: `src/main.ts` (`startLesson` 1029 근처)
- Modify: `src/ui/styles.css`
- Test: `tests/seen.test.ts`, `tests/settings-markup.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 1의 `Lesson`
- Produces:
  - `src/ui/prefs.ts`: `loadSeen(key: string): string[]` · `markSeen(key: string, id: string): void` · `export const WHY_KEY = 'exc-why'`
  - `Lesson.why?: { title: string; lines: readonly string[] }`
    — 그림은 그 미션의 `icon`을 크게 쓴다. 카드 전용 그림을 따로 만들지 않는다(sim 층은 SVG를 들지 않고, 아이콘 네 개로 끝낸다).
  - `index.html` 새 id: `why` (modal) · `why-title` · `why-art` · `why-text` · `btn-why-go` · `btn-why` (미션 박스의 '왜?')

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/seen.test.ts`

```ts
it('처음엔 아무것도 안 봤다', () => expect(loadSeen(WHY_KEY)).toEqual([]));
it('본 것이 쌓인다', () => { markSeen(WHY_KEY, 'a'); markSeen(WHY_KEY, 'b'); expect(loadSeen(WHY_KEY)).toEqual(['a','b']); });
it('같은 걸 두 번 넣어도 하나', () => { markSeen(WHY_KEY, 'a'); markSeen(WHY_KEY, 'a'); expect(loadSeen(WHY_KEY)).toEqual(['a']); });
it('저장값이 깨져 있으면 빈 목록', () => { localStorage.setItem(WHY_KEY, '{{'); expect(loadSeen(WHY_KEY)).toEqual([]); });
it('저장소가 던져도 던지지 않는다', () => { /* fakeStorage를 던지게 바꿔 markSeen·loadSeen 호출 */ });
```

`tests/settings-markup.test.ts`에 추가: `#why` 안의 네 id가 있고 전체 문서에서 유일하다 · `#btn-why-go`와 `#btn-why`의 최소 크기가 44px 이상이다.

- [ ] **Step 2: 테스트가 실패하는 것을 본다**

Run: `npx vitest run tests/seen.test.ts tests/settings-markup.test.ts` → FAIL

- [ ] **Step 3: `src/ui/prefs.ts`에 `loadSeen`·`markSeen`·`WHY_KEY`를 구현한다**

`loadRaw`/`saveRaw` 위에 JSON 배열로. 깨진 값·던지는 저장소는 빈 배열.

- [ ] **Step 4: `index.html`에 `#why` 카드와 미션 박스의 '왜?' 버튼을 넣는다**

`#lessons`와 같은 `modal page` 구조. 안에 제목(`#why-title`) · 그림(`#why-art`) · 글(`#why-text`) · `해보기 ▶`(`#btn-why-go`). `#mission` 안에 작은 `#btn-why` ('왜?').

- [ ] **Step 5: `src/sim/tutorial.ts`에 `Lesson.why` 타입을 더한다**

- [ ] **Step 6: `src/main.ts`를 고친다**

`startLesson(i, again, lv)`: `again`이 아니고 `L.why`가 있고 아직 안 본 미션이면, 미션을 시작하지 않고 `#why`를 띄운다. `markSeen`은 카드를 띄울 때 한다. `#btn-why-go`를 누르면 `#why`를 닫고 원래 시작 경로를 탄다. `#btn-why`는 지금 미션의 `why`를 다시 띄우고(이때 `markSeen` 없음) 닫으면 미션으로 돌아간다. `#btn-why`는 `L.why`가 없으면 숨긴다. `#why`는 `.modal`이므로 `operating()`이 자동으로 거짓이 되어 조작이 멈춘다.

- [ ] **Step 7: `src/ui/styles.css`에 `#why` 모양을 넣는다**

`.settings-card`와 같은 카드 폭 규칙을 따른다. `#why-art`는 폭 96px 고정.

- [ ] **Step 8: 테스트·빌드 확인**

Run: `npx vitest run` → 전부 통과
Run: `npm run build` → 통과

- [ ] **Step 9: 커밋**

```bash
git add index.html src/ui/prefs.ts src/ui/styles.css src/sim/tutorial.ts src/main.ts tests/seen.test.ts tests/settings-markup.test.ts
git commit -m "배우기: 미션 앞 이론 카드 한 장 ('왜?'로 다시 보기)"
```

---

### Task 4: 1단계 미션 — 멈춘 뒤에 방향 바꾸기

**Files:**
- Create: `src/sim/leverSchool.ts`
- Modify: `src/main.ts` (`curLessons` 943)
- Modify: `src/sim/tutorial.ts` (`Lesson.icon` 유니온에 `stStop`·`stAim`·`stBoth`·`stAll` 추가)
- Modify: `src/ui/icons.ts` (같은 네 아이콘)
- Test: `tests/leverSchool.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Tutor.bag`·`Lesson.grade`, Task 2의 `Lesson.tier`, Task 3의 `Lesson.why`
- Produces:
  - `src/sim/leverSchool.ts`: `export const BASIC_LESSONS: Lesson[]` — 지금은 1단계 하나. tier `'기본기'`, id `'b-stop'`, icon `'stStop'`.
  - `export const SMOOTH = { warn: 0.1, perfect: 0.04 }` — 측정값에서 나온 경계 (설계 '측정한 것' 표)
  - `src/main.ts`: `const DIG_LESSONS = [...BASIC_LESSONS, ...LESSONS]`, `curLessons()`가 이것을 돌려준다

1단계 미션의 내용 (설계 '1단계'):
- 3단계. 각 단계는 고봉으로 담은 흙을 들고 ① 선회로 A→C 간 뒤 **중립에서 멈추고** 되돌아오기 ② 붐을 올렸다가 멈추고 내리기 ③ 둘을 이어서.
- "멈췄다"의 판정: 그 관절 레버가 중립(`|input| < 0.08`)이고 관절 속도가 최고속도의 3% 아래로 0.25초(15프레임) 유지.
- `bag.maxJolt` = 미션 전체 `s.lastJolt` 최대값. `bag.lost` = 미션 시작 적재 대비 잃은 흙 비율.
- `grade`: 별 3개 = `lost < 0.01 && maxJolt < SMOOTH.warn` · 별 2개 = `lost < 0.05` · 그 밖 별 1개.
  `note`: 별 3개면 `'멈춘 뒤에 바꿨어요'`, 흙을 흘렸으면 `'반대로 꺾을 때 흙이 쏟아졌어요'`, 아니면 `'덜컹거렸어요 — 멈춘 뒤에 바꾸기'`.
- `coach`: 레버가 중립을 거치지 않고 부호가 바뀌면 `'멈춘 뒤에 바꾸기'`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/leverSchool.test.ts`

`tests/cycle.test.ts`의 세션 준비 방식(`DigSession` + `ready()` + 100스텝)과 `tests/tutorial.test.ts`의 레버 구동 방식을 쓴다. 고봉 적재는 `s.load = SC * heapedFactor`.

```ts
it('멈춘 뒤에 바꾸면 흙이 안 쏟아지고 별 3개', () => {
  // 선회 레버 1 → 중립 0.3초 → 레버 -1
  // expect(bag.lost).toBeLessThan(0.01); expect(grade.stars).toBe(3)
});
it('반대로 확 꺾으면 흙이 쏟아지고 별이 깎인다', () => {
  // 선회 레버 1 → 바로 -1
  // expect(bag.lost).toBeGreaterThan(0.2); expect(grade.stars).toBeLessThan(3)
});
it('반대로 꺾으면 코치가 멈추라고 한다', () => { /* coach.msg에 '멈춘 뒤' */ });
it('부드럽게 해도 미션은 끝까지 간다 (막다른 길 없음)', () => {
  // 3단계 전부 통과해 tutor.cleared
});
it('별은 언제나 1~3', () => { /* 아무것도 안 하고 grade 호출 */ });
```

- [ ] **Step 2: 테스트가 실패하는 것을 본다**

Run: `npx vitest run tests/leverSchool.test.ts` → FAIL (`BASIC_LESSONS` 없음)

- [ ] **Step 3: `src/sim/leverSchool.ts`를 만든다**

`tutorial.ts`에서 `import type { Lesson, Step }`과 필요한 헬퍼를 가져온다. `tutorial.ts`는 `leverSchool.ts`를 import하지 않는다(단방향). `tutorial.ts`의 헬퍼 중 필요한 것(`pose`·`fill`·`hold`·`co`·`SC`)이 아직 export가 아니면 export한다 — 옮기지는 않는다.

- [ ] **Step 4: 아이콘 네 개와 `Lesson.icon` 유니온을 넓힌다**

- [ ] **Step 5: `src/main.ts`의 `curLessons`가 `BASIC_LESSONS`를 앞에 붙이게 고친다**

- [ ] **Step 6: 테스트·빌드 확인**

Run: `npx vitest run` → 전부 통과
Run: `npm run build` → 통과

- [ ] **Step 7: 커밋**

```bash
git add src/sim/leverSchool.ts src/sim/tutorial.ts src/ui/icons.ts src/main.ts tests/leverSchool.test.ts
git commit -m "기본기 1단계: 멈춘 뒤에 방향 바꾸기"
```

---

### Task 5: 별 등급 클리어 화면

**Files:**
- Modify: `src/main.ts` (`onLessonClear` 1242-1275)
- Modify: `index.html` (`#clear`에 한 줄 평)
- Modify: `src/ui/styles.css` (`.cl-stars`)
- Test: `tests/settings-markup.test.ts` (추가)

**Interfaces:**
- Consumes: Task 1의 `Lesson.grade`·`Tutor.bag`, Task 4의 1단계 미션
- Produces: `index.html` 새 id `clear-note`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/settings-markup.test.ts`에 추가

```ts
it('클리어 화면에 별 3개와 한 줄 평 자리가 있다', () => {
  // .cl-stars 안의 <i>가 3개, #clear-note가 있고 id가 유일
});
it('main.ts가 grade 없는 미션에서는 별을 건드리지 않는다', () => {
  // main.ts 원문에 L.grade 분기가 있고, 없을 때 cl-stars를 비우지 않는 것을 확인
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 본다**

Run: `npx vitest run tests/settings-markup.test.ts` → FAIL (`#clear-note` 없음)

- [ ] **Step 3: `index.html`에 `#clear-note`를 넣고 `styles.css`에 꺼진 별 모양을 넣는다**

꺼진 별은 `.cl-stars i.off`에 낮은 불투명도. 켜진 별은 지금 모양 그대로.

- [ ] **Step 4: `src/main.ts`의 `onLessonClear`를 고친다**

`L.grade`가 있으면 `L.grade(tutor.s, tutor.bag)`을 불러 별 n개만 켜고 나머지에 `off`를 붙이고, `#clear-note`에 `note`를 쓴다. 없으면 지금과 똑같이(별 3개 다 켜짐, `#clear-note` 숨김). 별이 1개여도 `#btn-clear-next`는 지금 규칙(마지막 미션이 아니면 보임)을 그대로 따른다.

- [ ] **Step 5: 테스트·빌드 확인**

Run: `npx vitest run` → 전부 통과
Run: `npm run build` → 통과

- [ ] **Step 6: 커밋**

```bash
git add index.html src/main.ts src/ui/styles.css tests/settings-markup.test.ts
git commit -m "배우기 클리어: 별 등급과 한 줄 평 (등급 있는 미션만)"
```

**여기까지가 1단계 '끝까지'다. 돌려 보고, 재미없으면 멈추고 설계를 다시 본다.**

---

### Task 6: 2단계 미션 — 원하는 데서 멈추기

**Files:**
- Modify: `src/sim/leverSchool.ts`
- Modify: `src/main.ts` (`renderMission` 1194 — 정지 카운트·오차 표시)
- Modify: `index.html`, `src/ui/styles.css`
- Test: `tests/leverSchool.test.ts` (추가)

**Interfaces:**
- Consumes: Task 4의 `BASIC_LESSONS`·`SMOOTH`
- Produces:
  - `BASIC_LESSONS`에 id `'b-aim'`, icon `'stAim'`, tier `'기본기'` 추가
  - `export const AIM = { tol: [0.12, 0.07, 0.04] as const, stopVel: 0.03, stopHold: 18 }`
    — 허용 오차 12·7·4cm, '멈춤'은 관절 속도 합이 최고속도의 3% 아래로 18프레임(0.3초)
  - `bag.err1`·`bag.err2`·`bag.err3` (m 단위 오차), `bag.hold` (지금 차고 있는 프레임 수 — 화면이 읽는다)
  - `index.html` 새 id `m-hold` (미션 박스 안, `●●○` 자리)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('멈춰 있어야 오차를 잰다', () => {
  // 목표선 위에 이빨을 두고 레버를 계속 밀고 있으면 통과하지 않는다
});
it('0.3초 멈추면 그때 오차가 bag에 들어간다', () => { /* err1이 기록됨 */ });
it('세 번 다 4cm 안이면 별 3개', () => {});
it('허용 오차는 회차마다 좁아진다', () => { expect(AIM.tol).toEqual([0.12, 0.07, 0.04]); });
it('멈추는 동안 bag.hold가 0에서 18까지 찬다', () => {});
```

- [ ] **Step 2: 테스트가 실패하는 것을 본다** → FAIL

- [ ] **Step 3: `leverSchool.ts`에 2단계를 구현한다**

- [ ] **Step 4: `index.html`·`main.ts`·`styles.css`에 `●●○` 표시와 멈춘 뒤 cm 표시를 넣는다**

`renderMission`이 `tutor.bag.hold`를 읽어 `#m-hold`에 점 세 개 중 찬 만큼을 채운다. 멈춘 판정이 난 순간의 오차는 기존 토스트(`showToast`)로 `'3cm · 완벽'` 형태로 띄운다 — 새 UI를 만들지 않는다.

- [ ] **Step 5: 테스트·빌드 확인** → 전부 통과

- [ ] **Step 6: 커밋**

```bash
git commit -m "기본기 2단계: 원하는 데서 멈추기 (오차 cm·0.3초 표시)"
```

---

### Task 7: 이빨 경로 선

**Files:**
- Create: `src/render/tipTrail.ts`
- Modify: `src/main.ts` (프레임 갱신·미션 떠날 때 정리)
- Test: `tests/tipTrail.test.ts`

**Interfaces:**
- Produces: `src/render/tipTrail.ts`
  - `export class TipTrail { readonly object: THREE.Object3D; constructor(max?: number); push(x: number, y: number, z: number): void; clear(): void; dispose(): void; get count(): number }`
  - 점 상한 기본 200. 상한을 넘으면 가장 오래된 점을 버린다. `dispose()`는 geometry·material을 해제한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('점을 넣으면 쌓인다', () => {});
it('상한을 넘으면 오래된 것부터 버린다', () => { /* max 3에 5개 넣으면 count === 3 */ });
it('clear하면 비고, 다시 쓸 수 있다', () => {});
it('dispose 뒤에 push해도 던지지 않는다', () => {});
```

three.js는 node 환경에서 import된다(기존 `tests/bucket-view.test.ts`가 같은 방식).

- [ ] **Step 2: 테스트가 실패하는 것을 본다** → FAIL

- [ ] **Step 3: `src/render/tipTrail.ts`를 만든다**

`THREE.BufferGeometry` + `setDrawRange`로 점 상한을 고정 할당한다. 매 프레임 새 geometry를 만들지 않는다.

- [ ] **Step 4: `main.ts`가 3단계 미션 중에만 점을 넣고, 미션을 떠날 때 `clear()`를 부르게 한다**

`newSession()`에서 장면을 다시 만들 때 `dispose()`.

- [ ] **Step 5: 테스트·빌드 확인** → 전부 통과

- [ ] **Step 6: 커밋**

```bash
git commit -m "이빨이 지나간 자리에 선 남기기 (점 200개 상한, 재사용 버퍼)"
```

---

### Task 8: 3단계 미션 — 두 레버를 같이 쓰기

**Files:**
- Modify: `src/sim/leverSchool.ts`
- Modify: `src/main.ts`
- Test: `tests/leverSchool.test.ts` (추가)

**Interfaces:**
- Consumes: Task 7의 `TipTrail`, 기존 `flowTrack`(`tutorial.ts:239`)
- Produces:
  - `BASIC_LESSONS`에 id `'b-both'`, icon `'stBoth'`
  - `export const LINE = { good: 0.04, ok: 0.1, height: 0.6 }` — 평균 벗어남 4cm·10cm, 목표 높이 땅 위 60cm
  - `bag.devSum`·`bag.devN` (높이 벗어남 누적), `bag.multi`·`bag.frames` (동시조작 비율)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('붐만 쓰면 높이가 벗어나 별이 깎인다', () => {});
it('붐과 암을 같이 쓰면 높이가 유지돼 별 3개', () => {});
it('이빨이 높으면 붐 내림, 낮으면 붐 올림을 코치한다', () => {});
it('장면 정리: 미션을 떠나면 선이 비워진다', () => { /* TipTrail.count === 0 */ });
```

- [ ] **Step 2: 테스트가 실패하는 것을 본다** → FAIL

- [ ] **Step 3: `leverSchool.ts`에 3단계를 구현한다**

- [ ] **Step 4: 테스트·빌드 확인** → 전부 통과

- [ ] **Step 5: 커밋**

```bash
git commit -m "기본기 3단계: 두 레버를 같이 써 직선 긋기"
```

---

### Task 9: 4단계 미션 — 합치기

**Files:**
- Modify: `src/sim/leverSchool.ts`
- Test: `tests/leverSchool.test.ts` (추가)

**Interfaces:**
- Consumes: Task 4·6·8의 `SMOOTH`·`AIM`·`LINE`
- Produces: `BASIC_LESSONS`에 id `'b-all'`, icon `'stAll'`. `grade`의 `note`는 세 항목을 `◎○△`로 보여준다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
it('세 항목이 모두 좋으면 별 3개', () => {});
it('한 항목만 나쁘면 별 2개', () => {});
it('note에 세 항목이 ◎○△로 들어간다', () => {});
it('기본기 네 미션의 id가 모두 다르다', () => {});
```

- [ ] **Step 2: 테스트가 실패하는 것을 본다** → FAIL

- [ ] **Step 3: `leverSchool.ts`에 4단계를 구현한다**

- [ ] **Step 4: 테스트·빌드 확인** → 전부 통과

- [ ] **Step 5: 커밋**

```bash
git commit -m "기본기 4단계: 셋을 한 번에"
```
