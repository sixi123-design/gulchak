/**
 * 펌프 유량 분배 (14t급 2펌프 오픈센터 근사).
 *
 * - P1: 붐·버킷이 주(main), 암 합류(confluence)
 * - P2: 암·선회가 주, 붐 올림 합류
 * - 붐 올림·암은 혼자 쓸 때 두 펌프를 합쳐 최고속도. 다른 레버를 같이 쓰면 합류분이 줄어 느려진다.
 * - 붐 내림은 자중 재생으로 P1만으로 최고속도 → 선회하며 붐 내리기는 거의 안 느려진다.
 * - 선회·버킷은 펌프 하나의 일부만 쓴다(need < 1) → 남는 기름이 합류로 간다.
 * 각 펌프는 주 회로에 먼저(주끼리는 요구량에 비례), 남는 기름을 합류에 준다.
 * 계산은 축 4개 산술뿐이라 저가폰 부담 없음.
 */
export type Joint = 'swing' | 'boom' | 'arm' | 'bucket';
export type Demand = Record<Joint, number>; // 레버 크기 0~1 (부호 없이)

export interface PumpSpec {
  /** 최고속도에 필요한 유량 (펌프 1대 = 1) */
  need: { boomUp: number; boomDown: number; arm: number; bucket: number; swing: number };
}

export const PUMPS: PumpSpec = {
  need: { boomUp: 2, boomDown: 1, arm: 2, bucket: 0.8, swing: 0.6 },
};

const share = (mains: number[]) => {
  const sum = mains.reduce((a, b) => a + b, 0);
  const k = sum > 1 ? 1 / sum : 1;
  return { k, left: Math.max(0, 1 - sum * k) };
};

/** 레버 크기와 붐 방향으로 각 관절의 속도 배율(0~1)을 낸다. 혼자 쓰면 1 */
export function flowShare(d: Demand, boomUp: boolean, p: PumpSpec = PUMPS): Record<Joint, number> {
  const n = p.need;
  const want = {
    boom: d.boom * (boomUp ? n.boomUp : n.boomDown),
    arm: d.arm * n.arm,
    bucket: d.bucket * n.bucket,
    swing: d.swing * n.swing,
  };
  // 두 펌프를 쓰는 관절(붐 올림·암)은 제 펌프에서 반을 주 회로로 받는다. 붐 내림은 P1 하나로 충분
  const boomMain = boomUp ? want.boom / 2 : want.boom;
  const armMain = want.arm / 2;
  const p1 = share([boomMain, want.bucket]);
  const p2 = share([armMain, want.swing]);
  // 나머지는 남는 기름에서: 먼저 다른 펌프(합류), 그래도 모자라면 제 펌프에 남은 것
  let boom = boomMain * p1.k;
  let arm = armMain * p2.k;
  let left1 = p1.left;
  let left2 = p2.left;
  const take = (need: number, avail: number) => Math.max(0, Math.min(need, avail));
  const bc = take(want.boom - boom, left2);
  boom += bc;
  left2 -= bc;
  const ac = take(want.arm - arm, left1);
  arm += ac;
  left1 -= ac;
  boom += take(want.boom - boom, left1);
  arm += take(want.arm - arm, left2);
  const got = { boom, arm, bucket: want.bucket * p1.k, swing: want.swing * p2.k };
  const out = { swing: 1, boom: 1, arm: 1, bucket: 1 };
  for (const j of ['swing', 'boom', 'arm', 'bucket'] as const) if (want[j] > 1e-9) out[j] = Math.min(1, got[j] / want[j]);
  return out;
}
