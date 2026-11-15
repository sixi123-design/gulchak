/**
 * 가상 장비 사양 (자체 설정, 특정 제조사 모델 아님).
 * 시험장 주력 기종(14t급 타이어식: 현대 HW145/R140W, 두산 DX140W, 볼보 EW145B 계열)의
 * 공통 치수에 맞춘 근사치: 버킷 고봉 약 0.58㎥·폭 약 1.05m, 최대굴삭반경 약 7.6m, 축간거리 2.8m.
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
  // 붐 발·가동범위: 시험장 3사 기본 사양(현대 HW145+ 4.3m 붐 + 2.1m 암, 두산 DX140W-7·볼보 EW145B 4.4m + 2.1m)에
  // 맞춰 HW145+ 카탈로그(2020.6) 2.1m 암 작업범위표를 역산 (2026-11-15).
  // 목표 → 결과: 최대굴삭반경 7.59→7.59 · 지면 7.37→7.37 · 깊이 4.63→4.65 · 높이 8.11→8.10 · 덤프 5.70→5.80(검증용)
  boomFoot: { r: 0.35, y: 1.8 },
  L1: 4.3,
  L2: 2.1,
  L3: 1.15, // 버킷 회전 반경 (14t급 실측 약 1.15~1.2m)
  heelLen: 0.85,
  heelAngle: d(55),
  bucketWidth: 1.05,
  bucketLength: 1.0,
  struckCapacity: 0.45,
  heapedFactor: 1.3,
  // 붐 -48~+70°(폭 118°), 암 -155~-38°(폭 117°): 위 작업범위표 역산값.
  // 버킷 205°: 캐터필러 E 시리즈 single-pin 링크가 실제로 205° (일반 설계는 160~180°).
  limits: { boom: [d(-48), d(70)], arm: [d(-155), d(-38)], bucket: [d(-135), d(70)] },
  // 선회 69°/s = 11.5rpm (HW145+ 카탈로그 최고 선회속도. DX140W-7은 12.2rpm)
  speeds: { swing: d(69), boom: d(28), arm: d(35), bucket: d(55) },
  radii: { boom: 0.22, arm: 0.16, bucket: 0.05 },
  wheelbase: 2.8, // 축간거리: HW145+·DX140W-7 모두 2,800mm
  trackWidth: 2.5,
};
