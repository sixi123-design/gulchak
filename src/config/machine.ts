/**
 * 가상 장비 사양 (자체 설정, 특정 제조사 모델 아님).
 * 시험장 주력 기종(14t급 타이어식: 현대 HW145/R140W, 두산 DX140W, 볼보 EW145B 계열)의
 * 공통 치수에 맞춘 근사치: 버킷 고봉 약 0.58㎥·폭 약 1.05m, 최대 도달거리 약 7.9m.
 * 시험장 치수는 이 값에서 자동 계산된다.
 */
export interface MachineSpec {
  boomFoot: { r: number; y: number };
  L1: number; // 붐 길이
  L2: number; // 암 길이
  L3: number; // 핀 → 버킷 끝
  heelLen: number; // 핀 → 버킷 힐
  heelAngle: number; // rad, 버킷 끝 방향 기준 힐 각도(반시계)
  bucketWidth: number; // W (가로 폭)
  bucketLength: number; // Lb (세로 폭)
  struckCapacity: number; // 평적 용량 m³
  heapedFactor: number; // 고봉/평적
  limits: { boom: [number, number]; arm: [number, number]; bucket: [number, number] }; // rad
  speeds: { swing: number; boom: number; arm: number; bucket: number }; // rad/s (rpm 최대)
  radii: { boom: number; arm: number; bucket: number };
  wheelbase: number; // E
  trackWidth: number; // D
}

const d = (deg: number) => (deg * Math.PI) / 180;

export const MACHINE: MachineSpec = {
  boomFoot: { r: 0.6, y: 1.9 },
  L1: 4.3,
  L2: 2.4,
  L3: 1.15, // 버킷 회전 반경 (14t급 실측 약 1.15~1.2m)
  heelLen: 0.85,
  heelAngle: d(55),
  bucketWidth: 1.05,
  bucketLength: 1.0,
  struckCapacity: 0.45,
  heapedFactor: 1.3,
  limits: { boom: [d(-35), d(60)], arm: [d(-155), d(-30)], bucket: [d(-100), d(95)] },
  speeds: { swing: d(40), boom: d(28), arm: d(35), bucket: d(55) },
  radii: { boom: 0.22, arm: 0.16, bucket: 0.05 },
  wheelbase: 2.6,
  trackWidth: 2.5,
};
