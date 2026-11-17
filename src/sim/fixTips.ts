import type { Score } from './score';

/**
 * 결과 화면 '다음엔 이렇게' 한 줄: 가장 큰 문제 하나를 고를 행동으로 + 그 부분을 연습할 배우기 미션.
 * 실격이 있으면 첫 실격, 없으면 가장 많이 놓친 채점 항목.
 */
export interface FixTip {
  /** 무엇이 문제였나 (짧게) */
  what: string;
  /** 다음에 할 행동 */
  tip: string;
  /** 연습할 배우기 미션 id (없으면 연습 버튼 없음) */
  lesson?: string;
}

type T = [string, string | undefined];
const DIG_DQ: Record<string, T> = {
  'D-POLE': ['붐을 충분히 올려 폴·줄에서 멀리 돌리고, 멈출 곳 앞에서 선회 레버 미리 놓기', 'b-carry'],
  'D-DIGLINE': ['버킷을 굴착 표시 안쪽에 내린 뒤 파기', 'b-scoop'],
  'D-PASS': ['B지점 통과구역 쪽으로, 장애물선보다 높게 들고 선회', 'b-carry'],
  'D-COUNT': ['한 번에 오래 퍼지 말고 4회부터 채우기', 'b-scoop'],
  'D-NOFLAT': ['마지막에 버킷을 끝까지 펴서 C를 끌어오고 밀어 고르기', 'flatten'],
  'D-TIME': ['줄 위가 되면 바로 선회, 돌아오며 붐 내리기처럼 동작을 겹치기', 'cycle'],
  'D-STALL': ['흙에 걸리면 레버를 끝까지 밀지 말고 붐을 조금 올리기', 'b-scoop'],
  'D-LIFT': ['붐으로 누르지 말고 이빨이 안 보일 만큼만 꽂고 암 당기기', 'b-scoop'],
};
const DIG_ITEM: Record<string, T> = {
  '흙량 (평적 이상)': ['바닥을 땅과 평행하게 오므린 뒤 암을 당겨 평적까지 담기', 'b-scoop'],
  '안쪽까지 담기': ['이빨이 안 보이게 꽂고, 바닥을 평행하게 오므린 뒤 암 당기기', 'b-scoop'],
  '굴착 위치': ['굴착 표시 가운데에 버킷을 내리기', 'b-scoop'],
  '운반 중 흘림': ['선회하기 전에 버킷을 끝까지 오므리기', 'b-carry'],
  평탄: ['버킷 끝까지 펴고, 암·붐을 같이 써 높이를 지키며 끌고 밀기', 'flatten'],
  시간: ['줄 위가 되면 바로 선회, 돌아오며 붐 내리기처럼 동작을 겹치기', 'cycle'],
  '부드러운 조작': ['바닥·멈출 곳에 가까워지면 레버를 천천히 놓기', 'b-ready'],
  '굴착 4회': ['한 번에 오래 퍼지 말고 4회부터 채우기', 'b-scoop'],
};
const DRIVE_DQ: Record<string, T> = {
  'D-TIME': ['직선 구간에선 가속을 조금 더, 곡선 앞에서만 줄이기', 'd-start'],
  'D-START': ['점검이 끝나면 바로 기어 넣고 출발', 'd-start'],
  'D-PBRAKE': ['출발 전에 주차브레이크 풀기', 'd-start'],
  'D-NOSTOP': ['정지선을 넘자마자 브레이크로 완전히 멈추기', 'd-stop'],
  'D-NOEND': ['도착선을 완전히 넘은 뒤에 후진', 'd-arrive'],
  'D-LINE': ['왼쪽 선을 보며 핸들을 일찍, 조금씩 감기', 'd-arrive'],
  'D-COURSE': ['전진 S자 → 도착선 → 후진 순서대로', 'd-back'],
};
const DRIVE_ITEM: Record<string, T> = {
  '1분 안에 출발': ['점검이 끝나면 바로 기어 넣고 출발', 'd-start'],
  '정지선 정지': ['정지선을 넘자마자 브레이크로 완전히 멈추기', 'd-stop'],
  '왼쪽 선 간격 유지': ['왼쪽 선을 보며 핸들을 일찍, 조금씩 감기', 'd-arrive'],
  시간: ['직선 구간에선 가속을 조금 더, 곡선 앞에서만 줄이기', 'd-start'],
  주차: ['앞바퀴가 주차구역에 들어오면 바로 정차', 'd-park'],
  '부드러운 조작': ['완전히 멈춘 뒤에 기어 바꾸기', 'd-back'],
};
/** 시험용: 가리키는 미션 id 모두 */
export const TIP_LESSONS = [DIG_DQ, DIG_ITEM, DRIVE_DQ, DRIVE_ITEM].flatMap((m) => Object.values(m).map((t) => t[1]).filter((x): x is string => !!x));
const PRECHECK = new Set(['안전벨트', '안전레버 풀기', 'RPM 올리기']);

export function fixTip(kind: 'dig' | 'drive', dq: { id: string; title: string }[], score: Score | null): FixTip | null {
  const DQ = kind === 'drive' ? DRIVE_DQ : DIG_DQ;
  const ITEM = kind === 'drive' ? DRIVE_ITEM : DIG_ITEM;
  for (const d of dq) {
    const t = DQ[d.id];
    if (t) return { what: d.title, tip: t[0], lesson: t[1] };
  }
  if (!score) return null;
  const miss = score.items.filter((it) => it.got < it.max).sort((a, b) => b.max - b.got - (a.max - a.got));
  for (const it of miss) {
    if (PRECHECK.has(it.name)) return { what: it.name, tip: '시작 전에 안전벨트 · 안전레버 · RPM 먼저 확인' };
    const t = ITEM[it.name];
    if (t) return { what: it.name, tip: t[0], lesson: t[1] };
  }
  return null;
}
