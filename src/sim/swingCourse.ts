/**
 * 기본기 4·6단계: 선회해 C로 / 돌아오기 (2026-11-17, 강사 검수 반영).
 *
 * 상부는 무거워서 선회 레버를 놓아도 더 돈다 (끝까지 밀다 놓으면 빈 버킷 약 13°, 흙 실으면 약 16°).
 * 그래서 **목표 앞에서 레버를 미리 놓아** 미끄러져 서게 하는 게 정석이다.
 * 반대로 꺾어 세우면 덜컹하고 흙이 쏟아진다 — 통과는 막지 않고 별에서 깎는다 (억울하지 않게).
 *
 * 통과는 결과만 본다: 목표 위(±6°, C면 버킷이 구덩이 위)에 레버를 놓고 섰는가.
 * 별점도 결과로: 지나쳤나(되돌렸나), ±3° 안에 섰나, 반대로 꺾어 덜컹·흘림이 있었나.
 * 천천히 다가가 정확히 서면 놓은 자리와 상관없이 별 3 (강사 검수: 억울하지 않게).
 */
import { MOVE, handOn, readyPose, still } from './moveCourse';
import { co, fill, passFix, SC, type Grade, type Lesson, type Step } from './tutorial';
import { prepared, prepCoach } from './cycleCourse';
import type { DigSession } from './session';

const deg = Math.PI / 180;
const SWING_A = Math.PI;
const SWING_C = 0;

/** 선회 자세(다 접음·줄 위)로 A 또는 C를 향해 선다 */
const swingSetup = (swing: number, load: number) => (s: DigSession) => {
  s.teleport({ ...readyPose(), swing, bucket: -(MOVE.curl + 2) * deg });
  fill(s, load);
};

/**
 * 놓는 자리 (목표까지 남은 각, 도). 끝까지 밀던 레버를 0.5초에 걸쳐 놓으면 그동안 약 10°, 놓은 뒤 13~16° 더 돈다
 * `[측정]` — 그래서 시범은 지금 속도로 계산한 만큼 앞에서 놓기 시작한다 (coast).
 */
const RELEASE = { ease: 30 } as const;
/** 목표에 섰다고 볼 범위(도): 통과 ±6° (C 구덩이 폭 ±0.5m와 같다), 별 3은 ±3° */
const TOL = { pass: 6, star: 3 } as const;

interface SwingSpec {
  id: string;
  title: string;
  icon: Lesson['icon'];
  from: number;
  to: number;
  load: number;
  name: 'A' | 'C';
  /** 시범이 놓기 시작하는 자리의 여유 (도): 계산한 미끄러짐에 더한다 */
  release: number;
  why: Lesson['why'];
}

function swingLesson(sp: SwingSpec): Lesson {
  const dir = Math.sign(sp.to - sp.from); // +면 선회 각이 커지는 쪽 (▶ 선회 = lx +)
  const label = dir > 0 ? '▶ 선회' : '선회 ◀';
  const back = dir > 0 ? '선회 ◀' : '▶ 선회';
  /** 목표까지 남은 각 (도, 지나쳤으면 음수) */
  const left = (s: DigSession) => ((sp.to - s.pose.swing) * dir) / deg;
  const onTarget = (s: DigSession) => Math.abs(left(s)) <= TOL.pass;
  const setup = swingSetup(sp.from, sp.load);
  /** 지금 속도로 레버를 서서히 놓으면 더 도는 각 (도) */
  const coast = (s: DigSession) => {
    const wf = Math.min(1, s.load / s.heapedCap);
    const tau = s.params.swingTauDown * (1 + s.params.loadSwingInertia * wf);
    return (Math.abs(s.vel.swing) / deg) * (RELEASE.ease / 60 / 4 + tau) + sp.release;
  };
  /** 손 자리(0~1) → 기계 값: 선회 레버 곡선은 3제곱 (main.ts curveSwing) */
  const lx = (h: number) => dir * h ** 3;

  const demo: Step[] = [
    {
      text: `선회 자세에서 시작\n버킷 다 접고 줄 위`,
      labels: [],
      begin: (s, mem) => {
        setup(s);
        mem.t = 0;
      },
      demo: () => ({}),
      done: (_s, mem) => ++mem.t >= 75,
    },
    {
      text: `왼쪽 레버를 ${dir > 0 ? '오른쪽' : '왼쪽'} 끝까지\n${sp.name} 쪽으로 선회`,
      labels: [label],
      demo: (f) => ({ lx: lx(Math.min(1, f / 30)) }),
      // 놓는 자리는 지금 선회 속도로 정한다 (rpm·흙 무게에 따라 미끄러지는 거리가 다르다):
      // 0.5초에 걸쳐 놓는 동안 약 v·T/4, 놓은 뒤 v·τ(흙 실으면 τ가 길다) `[측정]`
      done: (s) => left(s) <= coast(s),
    },
    {
      text: `${sp.name} 앞에서 레버를 서서히 놓기\n상부가 미끄러지며 더 돕니다`,
      labels: [],
      begin: (_s, mem) => (mem.t = 0),
      demo: (f) => (f < RELEASE.ease ? { lx: lx(1 - f / RELEASE.ease) } : {}),
      // 다 설 때까지 보여 준다 (조건이 안 오면 6초에 넘어간다)
      done: (s, mem) => ++mem.t >= 60 && (still(s) || mem.t > 360),
    },
    {
      text: '시범 끝\n다시 볼까요?',
      labels: [],
      ask: { replay: 0 },
      demo: () => ({}),
      done: () => false,
    },
  ];

  const practice: Step = {
    text: `${sp.name}까지 선회\n${sp.name} 앞에서 레버 미리 놓기`,
    labels: [label],
    begin: (s, mem, bag) => {
      setup(s);
      for (const k of ['over', 'err', 'jolt', 'spill']) delete bag[k];
      mem.j0 = s.jolts;
      mem.l0 = s.load;
      mem.dq0 = s.engine.disqualifications().length;
    },
    // 폴·줄·ⓓ선에 닿아 실격이 나면 실습 처음으로 (성공으로 넘기지 않고, 막다른 길도 없게)
    fail: (s, mem) => (s.engine.disqualifications().length > mem.dq0 ? { to: demo.length, msg: '폴·줄·선에 닿았어요 (시험이면 실격) — 다시' } : null),
    done: (s, mem, bag) => {
      // 목표 범위를 넘어 지나쳤나 (늦게 놓았다는 결과)
      if (left(s) < -TOL.pass) bag.over = 1;
      if (s.jolts > mem.j0) bag.jolt = 1;
      if (mem.l0 > 0 && s.load < mem.l0 - 0.05 * SC(s)) bag.spill = 1;
      // 통과는 결과만: 목표 위에서 레버를 놓고 섰다
      // 놓고 1초 기다렸다가 채점 — 모자라게 섰으면 그 사이 살짝 더 돌려 맞출 수 있다 (현장에서도 정상)
      mem.hold = onTarget(s) && !handOn(s) && still(s) ? (mem.hold ?? 0) + 1 : 0;
      if (mem.hold >= 60) bag.err = Math.abs(left(s));
      return mem.hold >= 60;
    },
    coach: (s) => {
      // B 통과 중 버킷이 줄·폴에 닿을 자세면 먼저 그것 (흙 실은 쪽만 — 빈 버킷은 다 접혀 있어 같은 자세)
      if (s.pose.swing > 20 * deg && s.pose.swing < 160 * deg) {
        const fix = passFix(s);
        if (fix) return fix;
      }
      if (left(s) < -TOL.pass && !handOn(s)) return co(`지나쳤어요 — 살살 ${sp.name} 쪽으로 되돌리기 · 시험에서는 ⓓ선을 넘으면 실격`, back);
      if (left(s) > TOL.pass && !handOn(s) && still(s)) return co(`${sp.name}까지 조금 더`, label);
      return null;
    },
    hud: (s) => (Math.abs(left(s)) < 60 ? `${sp.name}까지 ${Math.max(0, Math.round(left(s)))}°` : null),
  };

  return {
    id: sp.id,
    tier: '기본기',
    icon: sp.icon,
    title: sp.title,
    big: true,
    why: sp.why,
    // 결과로: 반대로 꺾어 세움(덜컹·흘림) > 지나침 > 정확도. 목표 위에 섰으면 통과는 이미 했다
    grade: (_s, bag): Grade => {
      const rough = !!(bag.jolt || bag.spill);
      const why = bag.spill ? '덜컹하고 흙이 쏟아졌어요' : '덜컹했어요';
      if (rough && bag.over) return { stars: 1, note: `${sp.name}에 섰어요. 늦게 놓고 반대로 꺾어 세웠어요 — ${why}. 앞에서 미리 놓아 미끄러지게` };
      if (rough) return { stars: 2, note: `${sp.name}에 섰어요. 반대로 꺾어 세웠어요 — ${why}. 미리 놓아 미끄러지게` };
      if (bag.over) return { stars: 2, note: `${sp.name}에 섰어요. 지나쳤다 돌아왔어요 — 레버를 더 앞에서 놓기` };
      // 화면에 보이는 반올림 값으로 비교 ('3° 비켜 섰어요'인데 별 3 기준이 ±3°면 모순, QA)
      if (Math.round(bag.err ?? 0) > TOL.star) return { stars: 2, note: `${sp.name}에 섰어요. ${Math.round(bag.err)}° 비켜 섰어요 — 조금 더 맞춰 보기` };
      return { stars: 3, note: `${sp.name} 위에 정확히 섰습니다` };
    },
    setup,
    steps: [...demo, practice],
  };
}

export const CARRY_LESSON = swingLesson({
  id: 'b-carry',
  title: '선회해 C로',
  icon: 'stCarry',
  from: SWING_A,
  to: SWING_C,
  load: 1.1,
  name: 'C',
  release: 0,
  why: {
    title: '선회는 놓는 자리가 전부입니다',
    lines: [
      '흙을 실은 상부는 무겁습니다. 레버를 놓아도 <b>그대로 더 돕니다</b>.',
      '그래서 C에 닿은 다음 놓으면 지나칩니다. C 뒤 <b>ⓓ오버스윙 제한선</b>을 넘으면 시험에서는 실격입니다. <b>C 앞에서 미리</b> 서서히 놓으세요.',
      '레버를 반대로 꺾어 세우면 덜컹하고 흙이 쏟아집니다.',
      'B의 두 폴 사이, 줄 위로 지나갑니다. 흙 퍼기에서 만든 선회 자세면 닿지 않습니다.',
    ],
  },
});

/**
 * 기본기 6단계: 돌아오기 (2026-11-18 강사 재검수로 다시 만듦).
 *
 * 쏟은 뒤 A로 돌아올 때 정석: B를 지나면 선회하면서 붐 내리고 버킷 펴기 → A에 서는 순간 바로 팔 자세.
 * A는 쏟는 곳이 아니라 **파는 곳**이라 구덩이 중심선에 좌우 ±20cm로 맞춰 서야 한다
 * (각도로 ±6°면 굴착 반경 6.6m에서 0.7m — 그대로 파면 굴착 위치 감점·실격 `[측정: 강사]`).
 * 통과: A 중심 ±0.2m + 퍼기 준비 자세(버킷 ±20°, 땅에서 1m 안) + 레버 놓고 섬.
 * 별: 중심 ±0.1m, 지나침(되돌림) 없음, 덜컹 없음, 서기 전에 붐·버킷을 같이 움직였나(겹치기).
 */
/**
 * 돌아오며 내리는 높이: A ⓒ선 줄(0.5m) 위 0.85m까지만 (강사 재검수 2) — 중심에 서기 전에 줄 아래로 내리면
 * 조금만 덜 와도 버킷이 줄에 닿아 실격. 퍼기 준비 자세(prepared, 땅에서 1m 안)는 이 높이로 이미 된다
 */
const BACK = { pass: 0.2, star: 0.1, over: 0.4, passB: 110, overlapAt: 10, carryGap: 0.85, rope: 0.6 } as const;
function backLesson(): Lesson {
  const setup = swingSetup(SWING_C, 0);
  /** A까지 남은 각 (도, 지나쳤으면 음수) */
  const left = (s: DigSession) => (SWING_A - s.pose.swing) / deg;
  /** A 중심선에서 버킷 끝이 좌우로 비켜 선 거리 (m, +면 아직 덜 옴) */
  const lat = (s: DigSession) => (SWING_A - s.pose.swing) * s.frame.tip.r;
  const coast = (s: DigSession) => (Math.abs(s.vel.swing) / deg) * (RELEASE.ease / 60 / 4 + s.params.swingTauDown);
  const lx = (h: number) => h ** 3;
  /** 시범의 오른손: 땅 가까이까지 붐 내림, 버킷은 암과 일직선까지 펴기 (닫힌 고리 — 저사양에서도 같은 자세) */
  // 버킷을 먼저·빠르게 펴고, 붐은 줄 위 높이까지만 약하게 (다 내려온 뒤 버킷을 펴면 순서가 틀린 시범)
  const lower = (s: DigSession) => ({
    ry: s.groundGap() > BACK.carryGap ? 0.4 : 0,
    rx: s.pose.bucket / deg < -4 ? 1 : s.pose.bucket / deg > 6 ? -0.4 : 0,
  });
  const demo: Step[] = [
    {
      text: '쏟고 나서 선회 자세\n버킷 다 접고 줄 위',
      labels: [],
      begin: (s, mem) => {
        setup(s);
        mem.t = 0;
      },
      demo: () => ({}),
      done: (_s, mem) => ++mem.t >= 75,
    },
    {
      text: '왼쪽 레버를 오른쪽 끝까지\nA 쪽으로 선회 — 줄 위 그대로',
      labels: ['▶ 선회'],
      demo: (f) => ({ lx: lx(Math.min(1, f / 30)) }),
      done: (s) => s.pose.swing / deg >= BACK.passB,
    },
    {
      text: 'B를 지나면 선회하면서\n버킷 펴고 붐은 줄 위까지만',
      labels: ['▶ 선회', '붐 내림', '버킷 펴기'],
      demo: (_f, s) => ({ lx: 1, ...lower(s) }),
      done: (s) => left(s) <= coast(s),
    },
    {
      text: 'A 앞에서 선회 레버를 서서히 놓기\n중심선에 서면 바로 팔 자세',
      // (줄 위 높이에서 선다 — 땅 가까이는 중심에 선 뒤 흙 퍼기에서)
      labels: ['붐 내림', '버킷 펴기'],
      begin: (_s, mem) => (mem.t = 0),
      demo: (f, s) => ({ ...(f < RELEASE.ease ? { lx: lx(1 - f / RELEASE.ease) } : {}), ...lower(s) }),
      done: (s, mem) => ++mem.t >= 60 && ((still(s) && prepared(s)) || mem.t > 480),
    },
    {
      text: '시범 끝\n다시 볼까요?',
      labels: [],
      ask: { replay: 0 },
      demo: () => ({}),
      done: () => false,
    },
  ];
  const practice: Step = {
    text: 'A로 돌아오기 · B 지나면 붐 내리고 버킷 펴기\nA 중심선에 맞춰 서기',
    labels: ['▶ 선회', '붐 내림', '버킷 펴기'],
    begin: (s, mem, bag) => {
      setup(s);
      for (const k of ['over', 'err', 'jolt', 'overlap', 'near']) delete bag[k];
      mem.n0 = s.engine.violations.filter((v) => v.id === 'W-NEAR').length;
      mem.j0 = s.jolts;
      mem.b0 = s.pose.boom;
      mem.dq0 = s.engine.disqualifications().length;
    },
    // 줄·선에 닿아 실격이 나면 실습 처음으로 (성공으로 넘기지 않고, 막다른 길도 없게)
    fail: (s, mem) => (s.engine.disqualifications().length > mem.dq0 ? { to: demo.length, msg: '줄·선에 닿았어요 (시험이면 실격) — 다시' } : null),
    done: (s, mem, bag) => {
      if (lat(s) < -BACK.over) bag.over = 1;
      if (s.engine.violations.filter((v) => v.id === 'W-NEAR').length > mem.n0) bag.near = 1;
      if (s.jolts > mem.j0) bag.jolt = 1;
      // 겹치기: A 10° 앞을 지날 때 붐을 내리기 시작했거나 버킷을 펴기 시작했나 (지날 때 한 번)
      if (bag.overlap === undefined && left(s) <= BACK.overlapAt)
        bag.overlap = s.pose.boom < mem.b0 - 8 * deg || s.pose.bucket > -(MOVE.curl - 30) * deg ? 1 : 0;
      const ok = Math.abs(lat(s)) <= BACK.pass && prepared(s) && !handOn(s) && still(s);
      mem.hold = ok ? (mem.hold ?? 0) + 1 : 0;
      if (mem.hold >= 60) bag.err = Math.abs(lat(s));
      return mem.hold >= 60;
    },
    coach: (s) => {
      if (s.pose.swing > 60 * deg && s.pose.swing < 120 * deg) {
        const fix = passFix(s);
        if (fix) return fix;
      }
      const d = lat(s);
      // 중심에 맞추기 전에 줄 높이 아래로 내려가면 ⓒ선 줄에 닿는다
      if (Math.abs(d) > BACK.pass && left(s) < 15 && s.groundGap() < BACK.rope + 0.2)
        return co('중심선에 맞춘 다음 내리기 — 줄에 닿으면 실격', '붐 올림');
      if (handOn(s) || !still(s)) return null;
      if (left(s) > 15 && left(s) < 150) return co(`A까지 ${Math.round(left(s))}° — 더 돌리기`, '▶ 선회');
      if (left(s) >= 150) return null;
      if (d < -BACK.pass) return co(`지나쳤어요 — 살살 되돌리기 (${Math.round(-d * 100)}cm) · 시험에서는 ⓓ선을 넘으면 실격`, '선회 ◀');
      if (d > BACK.pass) return co(`A 중심선까지 ${Math.round(d * 100)}cm — 살살 더`, '▶ 선회');
      if (!prepared(s)) return prepCoach(s);
      return null;
    },
    hud: (s) => {
      const L = left(s);
      if (L > 15) return L < 90 ? `A까지 ${Math.round(L)}°` : null;
      const d = Math.round(lat(s) * 100);
      return d === 0 ? 'A 중심선' : d > 0 ? `중심선까지 ${d}cm` : `${-d}cm 지나침`;
    },
  };
  return {
    id: 'b-back',
    tier: '기본기',
    icon: 'stStop',
    title: '돌아오기',
    big: true,
    why: {
      title: '돌아오면 바로 팔 자세로',
      lines: [
        '쏟고 나면 줄 위 그대로 A 쪽으로 돌립니다. 두 폴 사이를 지나갑니다.',
        '<b>B를 지나면</b> 선회하면서 <b>버킷 펴고, 붐은 줄 위까지만</b> 내리기 — A에 서는 순간 바로 팔 수 있게.',
        '중심에 서기 전에 줄 아래로 내리면 A의 줄에 닿아 실격입니다.',
        'A는 파는 곳입니다. <b>구덩이 중심선</b>에 맞춰 서야 합니다. 비켜 서서 파면 선을 넘어 실격입니다.',
        '빈 버킷도 상부가 더 돕니다. A 앞에서 미리 놓으세요.',
      ],
    },
    grade: (_s, bag): Grade => {
      if (bag.jolt && bag.over) return { stars: 1, note: 'A에 섰어요. 늦게 놓고 반대로 꺾어 세웠어요. 앞에서 미리 놓아 미끄러지게' };
      if (bag.jolt) return { stars: 2, note: 'A에 섰어요. 반대로 꺾어 세워 덜컹했어요. 미리 놓아 미끄러지게' };
      if (bag.over) return { stars: 2, note: 'A에 섰어요. 지나쳤다 돌아왔어요. 레버를 더 앞에서 놓기' };
      if (bag.near) return { stars: 2, note: 'A에 섰어요. 줄에 가까웠어요 (시험이면 실격 직전). 중심선에 맞춘 다음 내리기' };
      if (bag.overlap === 0) return { stars: 2, note: 'A에 섰어요. 서고 나서 내렸어요. B를 지나면 선회하면서 붐 내리고 버킷 펴기' };
      if (Math.round((bag.err ?? 0) * 100) > BACK.star * 100) return { stars: 2, note: `A에 섰어요. 중심선에서 ${Math.round((bag.err ?? 0) * 100)}cm 비켜 섰어요. 조금 더 맞춰 보기` };
      return { stars: 3, note: '돌아오며 내려 A 중심선에 바로 팔 자세로 섰습니다' };
    },
    setup,
    steps: [...demo, practice],
  };
}
export const BACK_LESSON = backLesson();
