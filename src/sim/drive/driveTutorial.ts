/**
 * 주행(코스운전) 배우기 미션 (판정명세_주행.md 8장).
 * 요령은 학원 시범·시험 조교 영상 기준: 왼쪽 선과 70~80cm, 왼쪽 앞바퀴를 정지선 사이에,
 * 뒷바퀴가 도착선을 완전히 넘은 뒤 정차, 후진은 사이드미러 보며 정지선에서 핸들 왼쪽 끝까지.
 */
import type { Coach, Lesson, Meter } from '../tutorial';
const co = (msg: string, ...labels: string[]): Coach => ({ msg, labels });
import { courseLength } from './course';
import type { DriveSession } from './driveSession';

const deg = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const needle = (x: number, lo: number, hi: number, a: number, b: number): Meter => ({
  v: clamp01((x - lo) / (hi - lo)),
  band: [(a - lo) / (hi - lo), (b - lo) / (hi - lo)],
});
/** 왼쪽 바퀴와 왼쪽 선 간격 게이지 (0~1.6m, 목표 0.6~0.9m) */
const gapMeter = (s: DriveSession): Meter => needle(s.leftGap() ?? 0.8, 0, 1.6, 0.6, 0.9);
/** 앞차축 위치 (중심선 거리) */
const frontD = (s: DriveSession) => s.progress() + s.m.wheelbase;
const ARC = (s: DriveSession) => courseLength(s.c) / 2;
/** 도착선 너머 뒷차축 거리(m): 이 안에 서야 오른쪽 끝까지 감고 바로 후진해도 선 안 밟음 */
const PAST_OK = 0.7;

/** 둘째 곡선(오른쪽으로 도는 곳): 오른쪽 끝까지 감은 채로. 바퀴가 선에 가까우면 그 반대로 */
const arcCoach = (s: DriveSession): Coach | null => {
  // 앞바퀴가 둘째 곡선에 들어간 뒤부터
  if (frontD(s) < ARC(s) + 0.5) return null;
  return lineCoach(s) ?? (s.speed > 0.05 && s.steer > -s.p.maxSteer + 3 * deg ? co('바퀴가 풀렸어요 → 오른쪽 끝까지 계속 감기', '▶ 핸들') : null);
};
/** 둘째 곡선 왼쪽 선 간격 (오른쪽 끝까지 감으면 0.4~0.6m) */
const gapMeter2 = (s: DriveSession): Meter => needle(s.leftGap() ?? 0.6, 0, 1.6, 0.35, 1.1);
const WN = ['왼쪽 앞바퀴', '오른쪽 앞바퀴', '왼쪽 뒷바퀴', '오른쪽 뒷바퀴'];
/**
 * 선에 가까운 바퀴 안내 (후진 땐 사이드미러로 보는 것과 같음).
 * 선 반대쪽으로 핸들을 돌리면 그 바퀴가 선에서 멀어짐. 단 후진 중 앞바퀴는 거꾸로(선 쪽으로 핸들)
 */
const lineCoach = (s: DriveSession, thr = 0.3, back = false, wheels = [0, 1, 2, 3]): Coach | null => {
  if (s.speed === 0) return null;
  const gs = s.wheelGaps();
  let k = -1;
  for (const i of wheels) if (gs[i] && gs[i]!.gap < thr && (k < 0 || gs[i]!.gap < gs[k]!.gap)) k = i;
  if (k < 0) return null;
  // 후진 땐 앞바퀴가 핸들 반대쪽으로 움직임 (뒷바퀴가 먼저 가고 앞이 따라 돎)
  const toLeft = back && k < 2 ? gs[k]!.side > 0 : gs[k]!.side < 0;
  return co(`${WN[k]}가 선에 가까워요 → 핸들 ${toLeft ? '왼쪽' : '오른쪽'}으로`, toLeft ? '핸들 ◀' : '▶ 핸들');
};
const backCoach = (s: DriveSession) => lineCoach(s, 0.25, true);
/**
 * 마지막 곡선(왼쪽 끝까지 감고 후진)용: 뒷바퀴만 본다 (아스트라 2026-11-15).
 * 끝까지 감은 채 가면 앞 바깥바퀴가 0.25m까지 붙었다가 다시 벌어진다(브라우저 실측). 여기서 앞바퀴 경고로 핸들을 풀게 하면
 * '끝까지 감기'와 번갈아 떠 풀었다 감는 사이 선을 밟았다
 */
const rearCoach = (s: DriveSession) => lineCoach(s, 0.25, true, [2, 3]);
/**
 * 정지선에서 둘째 곡선으로 넘어갈 때 맞출 바퀴 각 (게이지 초록 칸): 코스 가운데를 따라가는 각을 실시간으로.
 * 대략: 첫 곡선 각 그대로 조금 가다가 서서히 풀어 뒷바퀴가 정지선에 올 때 곧게, 이어서 2m쯤 동안 오른쪽 끝까지.
 * 끝↔끝 3.5바퀴를 약 4m에: 1m/s면 초당 1바퀴쯤. 빠르면 손이 못 따라감. 여유가 20~40cm라 미리 정한 각으론 안 되고 보면서 고쳐야 함
 */
export const sTarget = (s: DriveSession) => s.guideSteer(false);
const sMeter = (s: DriveSession): Meter => {
  const w = sTarget(s) / deg;
  return needle(s.steer / deg, -35, 35, w - 6, w + 6);
};
const sCoach = (s: DriveSession): Coach | null => {
  if (Math.abs(s.speed) < 0.05) return s.steer < sTarget(s) - 12 * deg ? co('서서 감지 말고 → 가면서 조금씩', '가속') : null;
  if (s.speed > 0.75) return co('너무 빨라요 → 천천히 (핸들이 못 따라가요)', '브레이크');
  const d = s.steer - sTarget(s);
  if (d > 8 * deg) return co('늦어요 → 핸들 오른쪽으로 더', '▶ 핸들');
  if (d < -8 * deg) return co('너무 빨라요 → 핸들 조금 덜', '핸들 ◀');
  return null;
};
/**
 * 후진으로 정지선을 넘어갈 때 맞출 바퀴 각 (게이지 초록 칸, 실시간):
 * 대략 오른쪽 끝 → 뒷바퀴가 정지선 2m쯤 앞에서 풀기 시작 → 정지선에서 곧게 → 2~3m 동안 왼쪽 끝까지
 */
export const bTarget = (s: DriveSession) => s.guideSteer(true);
const bMeter = (s: DriveSession): Meter => {
  const w = bTarget(s) / deg;
  return needle(s.steer / deg, -35, 35, w - 6, w + 6);
};
const bCoach = (s: DriveSession): Coach | null => {
  if (Math.abs(s.speed) < 0.05) return null;
  if (Math.abs(s.speed) > 0.75) return co('너무 빨라요 → 천천히 (핸들이 못 따라가요)', '브레이크');
  const c = backCoach(s);
  if (c) return c;
  const d = s.steer - bTarget(s);
  if (d > 8 * deg) return co('너무 빨라요 → 핸들 조금 덜', '▶ 핸들');
  if (d < -8 * deg) return co('늦어요 → 핸들 왼쪽으로 더', '핸들 ◀');
  return null;
};
export const DRIVE_LESSONS: Lesson<DriveSession>[] = [
  {
    id: 'd-start',
    icon: 'kDrive',
    title: '출발 · 첫 곡선',
    setup: () => {},
    steps: [
      { text: '주차브레이크 풀기', done: (s) => !s.parking },
      { text: 'F(전진) 기어 넣기', done: (s) => s.gear === 'F' },
      {
        // 일찍 감으면 곡선이 시작되기 전에 꺾여 안쪽 선을 밟음 (곡선은 출발선에서 시작)
        text: '핸들 똑바로 두고 천천히 가속 · 뒷바퀴가 출발선에 닿을 때까지',
        labels: ['가속'],
        done: (s) => s.progress() >= -0.6,
        meter: (s) => ({ v: clamp01((s.progress() + 3.4) / 2.8) }),
        coach: (s) =>
          Math.abs(s.steer) > 5 * deg
            ? co('아직 감지 마세요 → 핸들 똑바로', s.steer > 0 ? '▶ 핸들' : '핸들 ◀')
            : s.speed > 1.0
              ? co('너무 빨라요 → 천천히 (빠르면 감기 전에 곡선에 들어감)', '브레이크')
              : null,
      },
      {
        text: '지금! 가속 떼고 핸들을 왼쪽 끝까지 빠르게',
        labels: ['핸들 ◀'],
        done: (s) => s.steer >= s.p.maxSteer - 2 * deg,
        meter: (s) => ({ v: clamp01(s.steer / s.p.maxSteer) }),
        coach: (s) => (s.progress() > 0.4 && s.steer < s.p.maxSteer - 5 * deg ? co('늦었어요 → 빨리 끝까지 감기', '핸들 ◀') : null),
      },
      {
        text: '끝까지 감은 채 왼쪽 선과 70~80cm · 바퀴가 풀리니 핸들 계속 감기',
        labels: ['가속', '핸들 ◀'],
        done: (s) => s.progress() >= 6,
        meter: gapMeter,
        coach: (s) => {
          const g = s.leftGap();
          if (g !== null && g < 0.5) return co('선에 가까워요 → 핸들 반 바퀴 풀었다 다시 감기', '▶ 핸들');
          if (s.steer < s.p.maxSteer - 3 * deg) return co('바퀴가 풀렸어요 → 핸들 계속 감기', '핸들 ◀');
          return null;
        },
      },
    ],
  },
  {
    id: 'd-stop',
    icon: 'kDrive',
    title: '정지선 정지',
    // '출발 · 첫 곡선'이 끝나는 자리(중심선 6m)에서 이어서: 곡선을 마저 돌아 정지선까지
    setup: (s) => s.placeOnCourse(6.0, { stage: 'GO', gear: 'F', parking: false }),
    steps: [
      {
        text: '핸들 계속 감으며 · 왼쪽 앞바퀴를 흰 정지선 사이 가운데로',
        labels: ['가속', '핸들 ◀'],
        done: (s) => s.inStopZone() && s.stopZonePos() >= 0.3 && s.stopZonePos() <= 0.75,
        meter: (s) => needle(s.stopZonePos(), -1.5, 1.5, 0.3, 0.75),
      },
      {
        text: '브레이크로 멈추기',
        labels: ['브레이크'],
        done: (s) => s.stopped,
        meter: (s) => ({ v: clamp01(1 - Math.abs(s.speed) / 1.2) }),
      },
    ],
  },
  {
    id: 'd-arrive',
    icon: 'kDrive',
    title: '도착선 통과',
    setup: (s) => s.placeOnCourse(ARC(s) - s.m.wheelbase, { stage: 'GO', gear: 'F', parking: false, stopped: true }),
    steps: [
      {
        // 정지선에 서면 앞바퀴는 이미 둘째 곡선 입구, 뒷바퀴는 아직 첫 곡선 안.
        // 서서 바로 풀거나 오른쪽으로 감으면 첫 곡선 바깥(오른쪽) 선, 늦게 풀면 둘째 곡선 바깥(왼쪽) 선을 밟음
        text: '서서히 출발하며 핸들 조금씩 풀기 · 뒷바퀴가 정지선에 오면 바퀴 곧게',
        labels: ['가속', '▶ 핸들'],
        done: (s) => s.progress() >= ARC(s) - 0.1,
        meter: sMeter,
        coach: sCoach,
      },
      {
        text: '이어서 오른쪽으로 계속 감기 · 오른쪽 끝까지',
        labels: ['가속', '▶ 핸들'],
        done: (s) => s.steer <= -s.p.maxSteer + 2 * deg || s.progress() >= ARC(s) + 1.23 * s.m.wheelbase,
        meter: sMeter,
        coach: sCoach,
      },
      {
        text: '오른쪽 끝까지 감은 채 · 왼쪽 선 보며 · 도착선 앞에서 속도 줄이기',
        labels: ['가속', '▶ 핸들'],
        done: (s) => s.stage === 'ARRIVE',
        meter: gapMeter2,
        // 빠르게 들어오면 넘자마자 서도 많이 지나침 → 후진이 어려움
        coach: (s) => arcCoach(s) ?? (s.progress() > courseLength(s.c) - 2.5 && s.speed > 1.0 ? co('도착선 가까워요 → 속도 줄이기', '브레이크') : null),
      },
      {
        // 많이 지나쳐 서면 오른쪽 끝까지 감고 후진할 때 뒷바퀴가 둘째 곡선 안쪽 선을 밟음
        text: '넘자마자 브레이크로 정차',
        labels: ['브레이크'],
        done: (s) => s.stage === 'ARRIVE' && s.speed === 0,
        coach: (s) => (s.progress() > courseLength(s.c) + PAST_OK ? co('너무 지나가요 → 후진 때 안쪽 선 밟아요', '브레이크') : null),
      },
    ],
  },
  {
    id: 'd-back',
    icon: 'kDrive',
    title: 'S자 후진',
    // 앞 레슨('도착선 통과')을 오른쪽 끝까지 감고 끝낸 실제 자리 `[측정]`: 뒷차축이 선 너머 약 1m,
    // 중심선 오른쪽 0.5~0.57m, 차체가 17~19° 돌아감. 중심선에 곧게 세우는 자리는 실제로 나오지 않는다
    // (E 2.8m에서는 그 자리에서 끝까지 감고 후진하면 안쪽 뒷바퀴가 선에 닿는다)
    setup: (s) =>
      s.placeOnCourse(courseLength(s.c) + 1.0, { stage: 'ARRIVE', gear: 'N', parking: false, stopped: true, side: -0.5, yaw: 17 * deg }),
    steps: [
      { text: 'R(후진) 기어 넣기', done: (s) => s.gear === 'R' },
      {
        text: '서서 핸들 오른쪽 끝까지',
        labels: ['▶ 핸들'],
        done: (s) => s.steer <= -s.p.maxSteer + 2 * deg,
        meter: (s) => ({ v: clamp01(-s.steer / s.p.maxSteer) }),
      },
      {
        text: '끝까지 감은 채 · 사이드미러 보며 후진',
        labels: ['가속', '▶ 핸들'],
        // 둘째 곡선 대부분을 끝까지 감은 채로 (뒷차축이 정지선 3.5m 앞까지. 더 가면 이음점에서 오른쪽 뒷바퀴가 선에 닿음)
        done: (s) => s.progress() <= ARC(s) + 1.35 * s.m.wheelbase,
        coach: (s) =>
          backCoach(s) ??
          (s.speed !== 0 && s.steer > -s.p.maxSteer + 3 * deg
            ? co('핸들 오른쪽 끝까지 계속 감기', '▶ 핸들')
            : s.progress() < ARC(s) + 1.92 * s.m.wheelbase && Math.abs(s.speed) > 0.6
              ? co('정지선 가까워요 → 천천히 (곧 핸들 풀어야 해요)', '브레이크')
              : null),
      },
      {
        // 끝까지 감은 채 정지선까지 가면 S자 넘어가는 곳에서 선을 밟음
        text: '정지선이 다가오면 핸들 조금씩 풀기 · 뒷바퀴가 정지선에 오면 바퀴 곧게',
        labels: ['가속', '핸들 ◀'],
        done: (s) => s.progress() <= ARC(s) + 0.1,
        meter: bMeter,
        coach: bCoach,
      },
      {
        text: '이어서 왼쪽으로 계속 감기 · 왼쪽 끝까지',
        labels: ['가속', '핸들 ◀'],
        done: (s) => s.steer >= s.p.maxSteer - 2 * deg || s.progress() <= ARC(s) - 1.23 * s.m.wheelbase,
        meter: bMeter,
        coach: bCoach,
      },
      {
        text: '왼쪽 끝까지 감은 채 후진 · 미러로 바퀴와 선 보며 · 앞바퀴가 출발선을 넘을 때까지',
        labels: ['가속', '핸들 ◀'],
        done: (s) => s.stage === 'FINISH' || s.stage === 'DONE',
        meter: (s) => ({ v: clamp01(1 - frontD(s) / (ARC(s) + s.m.wheelbase)) }),
        coach: (s) => rearCoach(s) ?? (s.speed !== 0 && frontD(s) > 3 && s.steer < s.p.maxSteer - 3 * deg ? co('바퀴가 풀렸어요 → 왼쪽 끝까지 계속 감기', '핸들 ◀') : null),
      },
    ],
  },
  {
    id: 'd-park',
    icon: 'kDrive',
    title: '종료 · 주차',
    setup: (s) => s.placeOnCourse(2.0, { stage: 'BACK', gear: 'R', parking: false, stopped: true }),
    steps: [
      {
        text: '핸들 풀며 후진 · 앞바퀴가 출발선을 넘을 때까지',
        labels: ['가속'],
        done: (s) => s.stage === 'FINISH' || s.stage === 'DONE',
        // 빠르면 주차구역을 지나쳐 코스 밖으로 나감
        coach: (s) => backCoach(s) ?? (frontD(s) < 2 && Math.abs(s.speed) > 0.8 ? co('출발선 가까워요 → 천천히', '브레이크') : null),
      },
      {
        text: '앞바퀴를 주차구역 가운데에 세우기',
        labels: ['브레이크'],
        done: (s) => s.frontInParkZone() && s.speed === 0,
        // 앞차축이 출발선 뒤 0.1~1.6m(주차구역)
        meter: (s) => needle(-frontD(s), -0.5, 2.5, 0.35, 1.35),
      },
      { text: '중립 · 주차브레이크 걸기', done: (s) => s.parking && s.gear === 'N' },
    ],
  },
];
