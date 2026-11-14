import * as THREE from 'three';

/**
 * 실제 시험 화면의 시각·계절: 해 위치(서울 위도 37.5°의 실제 태양 고도·방위)와 빛 색, 하늘색, 나무 색.
 * 판정·시뮬과는 관계없는 화면 연출만.
 */
export type ExamTime = 'am' | 'pm';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
/** 설정값: auto = 기기 날짜 (시험을 앞둔 사람이 오늘 날씨처럼 연습) */
export type SeasonPick = 'auto' | Season;

/** 굴착기 실기 입실 08:30 · 12:30 (시험 안내 자료) → 시험은 9시 · 1시 무렵 */
export const EXAM_TIMES: { key: ExamTime; label: string; hour: number }[] = [
  { key: 'pm', label: '점심', hour: 13 },
  { key: 'am', label: '아침', hour: 9 },
];
/** 계절마다 대표 달의 태양 적위 (4월·7월·10월·1월) */
export const SEASONS: { key: Season; label: string; decl: number }[] = [
  { key: 'spring', label: '봄', decl: 9 },
  { key: 'summer', label: '여름', decl: 21 },
  { key: 'autumn', label: '가을', decl: -8 },
  { key: 'winter', label: '겨울', decl: -21 },
];
export const SEASON_PICKS: { key: SeasonPick; label: string }[] = [{ key: 'auto', label: '오늘 날짜' }, ...SEASONS];

/** 날짜의 태양 적위 (도) */
export function declOfDate(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  const n = Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
  return -23.44 * Math.cos(((2 * Math.PI) / 365) * (n + 10));
}

export function seasonOfMonth(m: number): Season {
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

export interface ExamLook {
  /** 해 방향 (땅 → 해, 단위 벡터) */
  sunDir: THREE.Vector3;
  /** 태양 고도 (도) */
  elev: number;
  sunColor: THREE.Color;
  sunI: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  foliage: { treeA: number; treeB: number; hedge: number };
  floor: number;
}

const LAT = (37.5 * Math.PI) / 180;
// 시험장 기준 남쪽·서쪽 (예전 고정 해 위치 (-6, 14, 9)가 남쪽 하늘에 오게)
const SOUTH = new THREE.Vector3(-6, 0, 9).normalize();
const WEST = new THREE.Vector3().crossVectors(SOUTH, new THREE.Vector3(0, 1, 0)).normalize();

const FOLIAGE: Record<Season, ExamLook['foliage']> = {
  spring: { treeA: 0x74a862, treeB: 0xa3cc84, hedge: 0x76a874 },
  summer: { treeA: 0x4f8a5c, treeB: 0x6aa472, hedge: 0x5e9268 },
  autumn: { treeA: 0xc0803c, treeB: 0xd5ac4c, hedge: 0x7f9460 },
  winter: { treeA: 0x5b7461, treeB: 0xa39b8f, hedge: 0x5f7a66 },
};
const FLOOR: Record<Season, number> = { spring: 0xa9b3a8, summer: 0xa6b0a4, autumn: 0xaeb2a4, winter: 0xb4b8b2 };

/** pick이 auto면 기기 날짜의 해 높이·계절 색, 아니면 그 계절의 대표 달 */
export function examLook(time: ExamTime, pick: SeasonPick, today = new Date()): ExamLook {
  const hour = EXAM_TIMES.find((t) => t.key === time)!.hour;
  const season: Season = pick === 'auto' ? seasonOfMonth(today.getMonth()) : pick;
  const decl = ((pick === 'auto' ? declOfDate(today) : SEASONS.find((s) => s.key === season)!.decl) * Math.PI) / 180;
  // 한국 표준시 정오 ≈ 태양시 12:30
  const ha = ((hour - 12.5) * 15 * Math.PI) / 180;
  const sinE = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(sinE);
  // 방위: 남쪽 기준, 서쪽이 +
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT));
  const sunDir = new THREE.Vector3()
    .addScaledVector(SOUTH, Math.cos(el) * Math.cos(az))
    .addScaledVector(WEST, Math.cos(el) * Math.sin(az))
    .add(new THREE.Vector3(0, Math.sin(el), 0))
    .normalize();
  const elev = (el * 180) / Math.PI;
  // 해가 낮을수록 노랗고 약한 빛, 하늘 아래쪽이 따뜻해짐 (35° 위는 한낮 빛)
  const warm = THREE.MathUtils.clamp(1 - (elev - 8) / 30, 0, 1);
  const cool = season === 'winter' ? 1 : season === 'summer' ? -0.4 : 0;
  const sunColor = new THREE.Color(0xffffff).lerp(new THREE.Color(0xffc184), warm * 0.75);
  if (cool > 0) sunColor.lerp(new THREE.Color(0xe8f0ff), 0.25 * (1 - warm));
  const sunI = 1.6 * (0.62 + 0.38 * THREE.MathUtils.clamp(sinE / 0.8, 0, 1)) * (season === 'summer' ? 1.06 : 1);
  const hemiSky = new THREE.Color(0xffffff).lerp(new THREE.Color(0xcfdcf0), 0.25 + 0.2 * Math.max(0, cool)).lerp(new THREE.Color(0xffe2c4), warm * 0.3);
  const hemiGround = new THREE.Color(0x9a8a70).lerp(new THREE.Color(0x8a8a86), season === 'winter' ? 0.5 : 0);
  const hemiI = 1.4 * (0.82 + 0.18 * THREE.MathUtils.clamp(sinE / 0.8, 0, 1));
  const skyTop = new THREE.Color(0x86bfe0);
  if (cool > 0) skyTop.lerp(new THREE.Color(0x9cbfd8), 0.5);
  if (cool < 0) skyTop.lerp(new THREE.Color(0x5fb0e6), 0.4);
  skyTop.lerp(new THREE.Color(0x8fb4d6), warm * 0.3);
  const skyHorizon = new THREE.Color(0xe6f1ee).lerp(new THREE.Color(0xf6dcc0), warm * 0.7);
  if (cool > 0) skyHorizon.lerp(new THREE.Color(0xe4eaee), 0.4 * (1 - warm));
  return { sunDir, elev, sunColor, sunI, hemiSky, hemiGround, hemiI, skyTop, skyHorizon, foliage: FOLIAGE[season], floor: FLOOR[season] };
}
