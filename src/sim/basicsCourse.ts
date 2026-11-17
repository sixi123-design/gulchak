/**
 * 번외: 기초교육 (2026-11-17). 필기에서 배운 것과 시험장 규칙을 짧게 다시 본다.
 * 본 과정(기본기·마무리)은 레버 조작에 집중하고 여기에 넣지 않은 것들:
 * 시작 점검, 장비 부위 이름, 실격 사항, 조심할 것.
 *
 * 문제는 고르기(Step.quiz) — 틀리면 풀이를 보여 주고 넘어간다 (막히지 않게). 별은 틀린 수.
 * 실격 근거는 rules.json의 basis(큐넷 채점 기준 번호). [해석]은 이 앱의 해석이라고 밝힌다.
 */
import { MOVE, readyPose } from './moveCourse';
import { fill, type Grade, type Lesson, type Step } from './tutorial';

const deg = Math.PI / 180;

/** 맞힌 수로 별 (점수로 말한다: 'n/m 정답') */
const quizGrade = (steps: Step[]) => {
  const total = steps.filter((st) => st.quiz).length;
  return (_s: unknown, bag: Record<string, number>): Grade => {
    const m = bag.miss ?? 0;
    const score = `${total - m}/${total} 정답`;
    if (m === 0) return { stars: 3, note: `${score}. 모두 맞혔습니다` };
    if (m <= 2) return { stars: 2, note: `${score}. 틀린 문제의 풀이를 한 번 더 보세요` };
    return { stars: 1, note: `${score}. 다시 풀어 보세요` };
  };
};
/**
 * 보기 순서를 섞는다 — 정답 자리를 외워 맞히지 않게. 문항 글로 정해지는 순서라 다시 그려도 같다
 */
const shuffle = (key: string, options: string[], answer: number) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const idx = options.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 2654435761);
    const j = (h >>> 0) % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return { options: idx.map((i) => options[i]), answer: idx.indexOf(answer) };
};
const quiz = (text: string, options: string[], answer: number, explain: string): Step => ({
  text,
  labels: [],
  quiz: { ...shuffle(text + options.join('|'), options, answer), explain },
  done: () => false,
});

// ---------------------------------------------------------------- 시작 점검
export const CHECK_LESSON: Lesson = {
  id: 'k-check',
  tier: '기초교육',
  icon: 'check',
  title: '시작 점검',
  check: true,
  noFail: true,
  big: true,
  flat: true,
  why: {
    title: '시험은 점검부터',
    lines: [
      '실제 시험에서는 앉자마자 <b>안전벨트 → 안전레버 풀기 → RPM 작업</b> 순으로 점검합니다.',
      '그다음 <b>손을 들어</b> 감독관에게 준비됐다고 알리고, 호각이 울리면 시작합니다.',
      '실제 시험 모드에서는 이 점검을 직접 해야 합니다. 여기서 한 번 눌러 보세요.',
    ],
  },
  setup: (s) => {
    s.teleport(readyPose());
    s.belt = false;
    s.leverUnlocked = false;
    s.rpm = 0.3;
    s.signaled = false;
  },
  steps: [
    { text: '안전벨트 매기\n점검판의 벨트를 누르세요', labels: [], done: (s) => s.belt },
    { text: '안전레버 풀기\n잠겨 있으면 레버를 움직여도 장비가 안 움직입니다', labels: [], done: (s) => s.leverUnlocked },
    { text: 'RPM을 작업으로\n저속이면 장비가 굼뜹니다', labels: [], done: (s) => s.rpm >= 0.6 },
    { text: '손 들어 감독관에게 신호', labels: [], done: (s) => s.signaled },
    quiz(
      '작업 도중 잠깐 레버에서 손을 뗄 때는?',
      ['안전레버를 잠근다', 'RPM을 최대로 올린다', '그냥 둔다'],
      0,
      '안전레버를 잠그면 레버를 건드려도 장비가 움직이지 않습니다. 자리를 뜰 때도 잠급니다.',
    ),
  ],
};

// ---------------------------------------------------------------- 장비 부위
/** 시범으로 한 부위만 앞뒤로 움직인다 (2초씩) */
const move = (text: string, inp: (k: number) => Partial<Record<'lx' | 'ly' | 'rx' | 'ry', number>>): Step => ({
  text,
  labels: [],
  side: true,
  begin: (s, mem) => {
    s.teleport({ ...readyPose(), boom: 30 * deg, bucket: -60 * deg });
    fill(s, 0);
    mem.t = 0;
  },
  demo: (f) => {
    const k = f < 60 ? 0.6 : f < 80 ? 0 : f < 140 ? -0.6 : 0;
    return inp(k);
  },
  done: (_s, mem) => ++mem.t >= 170,
});
const PARTS = ['붐', '암', '버킷', '선회(상부)'];

export const PARTS_LESSON: Lesson = {
  id: 'k-parts',
  tier: '기초교육',
  icon: 'stLevers',
  title: '장비 부위',
  noFail: true,
  big: true,
  flat: true,
  why: {
    title: '이름을 알아야 안내가 들립니다',
    lines: [
      '<b>붐</b>: 차체에서 나온 큰 팔. 버킷 높이를 바꿉니다.',
      '<b>암</b>: 붐 끝의 팔. 버킷을 멀리·가까이 보냅니다.',
      '<b>버킷</b>: 흙을 담는 통. 오므리고 폅니다. <b>선회</b>: 운전석이 있는 상부가 통째로 돕니다.',
      '앱이 한 곳을 움직여 보이면, 어디가 움직였는지 고르세요.',
    ],
  },
  setup: (s) => s.teleport({ ...readyPose(), boom: 30 * deg, bucket: -60 * deg }),
  steps: [
    move('어디가 움직이나 보세요', (k) => ({ ry: -k })),
    quiz('방금 움직인 곳은?', PARTS, 0, '붐입니다. 오른쪽 레버 앞뒤 — 버킷이 통째로 오르내립니다.'),
    move('이번에는?', (k) => ({ ly: k })),
    quiz('방금 움직인 곳은?', PARTS, 1, '암입니다. 왼쪽 레버 앞뒤 — 버킷이 멀어지고 가까워집니다.'),
    move('이번에는?', (k) => ({ rx: k })),
    quiz('방금 움직인 곳은?', PARTS, 2, '버킷입니다. 오른쪽 레버 좌우 — 오므리고 폅니다.'),
    move('마지막', (k) => ({ lx: k * 0.9 })),
    quiz('방금 움직인 곳은?', PARTS, 3, '선회입니다. 왼쪽 레버 좌우 — 운전석까지 통째로 돕니다.'),
    quiz(
      '흙을 퍼 담을 때 버킷을 몸 쪽으로 당기는 것은?',
      ['붐 올리기', '암 당기기', '선회'],
      1,
      '암을 당기면 버킷이 흙을 긁으며 몸 쪽으로 옵니다. 바닥을 땅과 평행하게 오므린 다음 당깁니다.',
    ),
  ],
};

// ---------------------------------------------------------------- 실격 사항
const DQ = ['실격', '실격 아님'];
export const RULES_LESSON: Lesson = {
  id: 'k-rules',
  tier: '기초교육',
  icon: 'kWritten',
  title: '실격 사항',
  noFail: true,
  big: true,
  flat: true,
  why: {
    title: '하나만 해도 바로 불합격',
    lines: [
      '굴착 작업은 점수보다 먼저 <b>실격</b>을 피해야 합니다. 실격이면 그 자리에서 끝납니다.',
      '폴·줄 닿기, 선 넘기, 4분 넘기기, 4번 미만, 평탄 안 함, 엔진 꺼뜨리기가 대표적입니다.',
      '상황을 보고 실격인지 고르세요.',
    ],
  },
  setup: (s) => s.teleport(readyPose()),
  steps: [
    quiz('선회하다 버킷이 B의 폴에 살짝 닿았다', DQ, 0, '실격입니다. 폴·줄에 닿으면 세게든 살짝이든 실격입니다.'),
    quiz('C에서 못 멈추고 오버스윙 제한선을 넘었다', DQ, 0, '실격입니다. ⓓ오버스윙 제한선은 C 뒤쪽 선입니다. 그래서 C 앞에서 선회 레버를 미리 놓습니다.'),
    quiz('A에서 파다가 버킷이 굴착 구역선 밖으로 나갔다', DQ, 0, '실격입니다. 장비 쪽 가상굴착제한선을 넘어 당겨도 실격입니다.'),
    quiz('B를 지날 때 두 폴 사이가 아니라 바깥으로 지났다', DQ, 0, '실격입니다. B는 두 폴 사이 통과구역, 줄 위로 지나야 합니다.'),
    quiz('4분 안에 굴착을 다섯 번 했다', DQ, 1, '실격이 아닙니다. 4번 이상이면 됩니다. 3번 이하가 실격입니다.'),
    quiz('마지막에 평탄작업 없이 버킷을 내려놓았다', DQ, 0, '실격입니다. 끝내기 전에 C를 평평하게 골라야 합니다.'),
    quiz('흙을 쏟다가 C 구덩이 옆에 조금 흘렸다', DQ, 1, '실격은 아닙니다. 다만 흘린 만큼 손해이니 땅 가까이서 쏟습니다.'),
    quiz('무리하게 눌러 엔진이 꺼졌다', DQ, 0, '실격입니다. 엔진이 버거운 소리를 내면 붐을 살짝 올려 힘을 빼세요.'),
    quiz(
      '다음 중 실격이 아닌 것은?',
      ['작업 시간 4분 넘김', '버킷이 줄에 닿음', '덜컹하며 멈춤'],
      2,
      '덜컹(레버를 확 놓거나 꺾어 생기는 급정지 충격)은 경고입니다. 흙이 쏟아질 수 있어 손해지만 실격은 아닙니다.',
    ),
  ],
};

// ---------------------------------------------------------------- 조심할 것
export const CARE_LESSON: Lesson = {
  id: 'k-care',
  tier: '기초교육',
  icon: 'stStop',
  title: '조심할 것',
  noFail: true,
  big: true,
  flat: true,
  why: {
    title: '실격은 아니어도 위험한 것',
    lines: [
      '앱은 위험한 조작에 <b>경고</b>를 띄웁니다. 실제 장비에서는 사고로 이어질 수 있는 것들입니다.',
      '경고가 뜨면 무엇을 해야 하는지 고르세요.',
    ],
  },
  setup: (s) => {
    s.teleport({ ...readyPose(), bucket: -(MOVE.curl + 2) * deg });
    fill(s, 1);
  },
  steps: [
    quiz(
      '버킷이 흙에 박힌 채로 선회하려 한다',
      ['그대로 선회', '붐을 올려 흙에서 뺀 뒤 선회', '버킷을 펴고 선회'],
      1,
      '흙 속에서 돌리면 장비에 큰 힘이 걸립니다. 붐을 올려 빼고 돌립니다.',
    ),
    quiz(
      '돌던 상부를 세우고 싶다',
      ['레버를 반대로 확 꺾는다', '목표 앞에서 레버를 서서히 놓는다', '레버를 끝까지 밀고 기다린다'],
      1,
      '반대로 꺾으면 덜컹하고 흙이 쏟아집니다. 상부는 놓아도 더 도니 미리 놓습니다.',
    ),
    quiz(
      '붐으로 땅을 세게 누르니 차체 앞이 들린다',
      ['더 세게 누른다', '붐을 살짝 올린다', '선회한다'],
      1,
      '차체가 들리면 넘어질 수 있습니다. 붐을 올려 힘을 뺍니다.',
    ),
    quiz(
      '엔진이 버거운 소리를 낸다 (과부하)',
      ['레버를 끝까지 더 민다', '너무 깊이 물었으니 붐을 살짝 올린다', 'RPM을 낮춘다'],
      1,
      '깊이 물면 엔진이 버겁습니다. 이빨이 안 보일 만큼만 꽂고 암을 당기는 게 정석입니다.',
    ),
    quiz(
      '버킷을 땅에 쿵 내려놓았다 (바닥 충격)',
      ['괜찮다', '땅 가까이서는 레버를 줄여 살살 내린다', '더 빨리 내린다'],
      1,
      '쿵 찍으면 장비와 땅이 상합니다. 가까워지면 레버를 줄입니다.',
    ),
    quiz(
      '버킷이 폴·줄에 가까워졌다는 경고가 떴다',
      ['그대로 지나간다', '붐을 올리거나 암으로 거리를 벌린다', '레버를 반대로 꺾는다'],
      1,
      '닿으면 실격입니다. 줄 위로 높이, 두 폴 사이로 거리를 맞춥니다.',
    ),
  ],
};

for (const L of [CHECK_LESSON, PARTS_LESSON, RULES_LESSON, CARE_LESSON]) L.grade = quizGrade(L.steps);
export const BASICS_LESSONS: Lesson[] = [CHECK_LESSON, PARTS_LESSON, RULES_LESSON, CARE_LESSON];
