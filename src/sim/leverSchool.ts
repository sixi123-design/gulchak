/**
 * 기본기 과정: 시험 한 사이클을 동작별로 (2026-11-17 정리).
 *
 * 레버 익히기 → 퍼기 준비 자세 → 흙 퍼기 → 선회해 C로 → 쏟고 돌릴 자세 → 돌아오기.
 * 마지막 '돌아오기'가 끝난 자세에서 다시 '퍼기 준비 자세'로 이어진다.
 * 미션마다 시범 → 실습 → 별점. 통과는 결과 자세로, 과정은 별점으로 (억울하지 않게).
 *
 * 예전 레버 교실(높이 맞춰 멈추기·곧게 옮기기·몸통 멈추기·셋 합치기)과 옛 배우기의
 * 퍼 담기·선회 쏟기·복합 조작은 이 과정과 겹쳐 걷어냈다.
 */
import { LESSONS, type Lesson } from './tutorial';
import { SCOOP_LESSON } from './digCourse';
import { DUMP_LESSON, READY_LESSON } from './moveCourse';
import { LEVER_DRILL } from './leverDrill';
import { BACK_LESSON, CARRY_LESSON } from './swingCourse';
import { CYCLE_LESSON } from './cycleCourse';
import { BASICS_LESSONS } from './basicsCourse';

export const BASIC_LESSONS: Lesson[] = [LEVER_DRILL, READY_LESSON, SCOOP_LESSON, CARRY_LESSON, DUMP_LESSON, BACK_LESSON];

/** 굴착 배우기 전체 목록 (화면 순서): 기본기 → 마무리(한 사이클 이어서 → 깊어진 구덩이 → 평탄) → 번외 기초교육 */
export const DIG_COURSE: Lesson[] = [...BASIC_LESSONS, CYCLE_LESSON, ...LESSONS, ...BASICS_LESSONS];
