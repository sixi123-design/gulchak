import type { ModeKey } from './ruleEngine';

/**
 * 이용권: 자유 연습(·배우기)은 무료, 연습 시험·실제 시험은 유료.
 *
 * 지금은 결제 연동 전이라 이 기기 저장소의 표시로만 판단한다 (임시).
 * 결제 붙일 때 이 파일의 hasPro()를 결제/스토어 영수증 확인으로 바꾼다.
 * 테스트용: 주소 끝에 ?pro=1 → 잠금 해제, ?pro=0 → 다시 잠금.
 */
export const PAID_MODES: readonly ModeKey[] = ['practice', 'exam'];

const KEY = 'exc-pro';
try {
  const q = new URLSearchParams(location.search).get('pro');
  if (q === '1') localStorage.setItem(KEY, '1');
  if (q === '0') localStorage.removeItem(KEY);
} catch {
  /* 무시 */
}

export function hasPro(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 구매 코드로 이용권 되살리기. 계정·로그인 없이 코드 하나로 복원한다.
 * TODO: 서명 키 검증 (결제처에서 발급한 서명을 공개키로 확인). 지금은 받아줄 코드가 없다.
 */
export function redeem(_code: string): boolean {
  return false;
}

export const isLocked = (m: ModeKey) => PAID_MODES.includes(m) && !hasPro();
