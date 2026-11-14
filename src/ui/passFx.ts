/**
 * 합격 연출 (결과표 전에). 멈춘 운전석 화면 위에 DOM 오버레이만 얹는다: 새 렌더·캔버스 없음.
 * 실제 시험처럼 합격·불합격만 (등급 없음): 확인 메달 쾅 → '합격' 띠 → 부제 → 확인 인장 → 증서 무늬(길로셰). 장난스러운 스티커 없음.
 * 크기: 고칠 것 없이 합격은 가장 크게(금빛 증서 무늬·반짝이, 약 3.6초) · 실제 시험 약 3.2초 · 연습 시험 약 2.1초.
 * 탭하면 바로 결과표. 움직임 줄이기: 정지 화면을 잠깐. CSS transform·opacity만 움직임.
 */
import { installPatterns } from './patterns';

const SLAM_AT = 0.35; // 메달이 박히는 순간 (CSS 지연과 맞춤)

let running: { finish: () => void } | null = null;

export function playPass(o: { perfect: boolean; exam: boolean }, onSlam: () => void, onDone: () => void) {
  running?.finish();
  installPatterns();
  const el = document.getElementById('pass-fx')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const size = o.perfect ? 'super' : o.exam ? 'big' : 'small';
  const dur = size === 'super' ? 3.6 : size === 'big' ? 3.2 : 2.1;
  // 색은 예전 메달 색을 그대로: 완벽 = 금(S), 그 외 = A
  el.className = `${size} g-${o.perfect ? 'S' : 'A'}` + (reduced ? ' static' : '');
  el.querySelector('.pf-tag')!.textContent = o.exam ? '실제 시험' : '연습 시험';
  el.querySelector('.pf-grade')!.textContent = '✓';
  // 시험 결과처럼 담백하게 (과장·장난 문구 없음)
  el.querySelector('.pf-sub')!.textContent = o.perfect ? '모든 항목 통과' : '합격 기준 충족';
  // 색종이: 한 번만 만들고 재사용 (방향·색은 CSS 변수)
  const conf = el.querySelector('.pf-confetti')!;
  if (!conf.childElementCount) {
    const cols = ['#ffc23a', '#ffffff', '#f2d27a'];
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('i');
      const a = (i / 28) * Math.PI * 2 + (i % 3) * 0.2;
      const r = 38 + (i % 5) * 9; // vmin
      p.style.setProperty('--x', `${Math.cos(a) * r}vmin`);
      p.style.setProperty('--y', `${Math.sin(a) * r * 0.75 - 6}vmin`);
      p.style.setProperty('--r', `${((i * 137) % 720) - 360}deg`);
      p.style.setProperty('--d', `${(i % 7) * 0.03}s`);
      p.style.background = cols[i % cols.length];
      conf.appendChild(p);
    }
  }
  // 애니메이션을 처음부터 다시
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
  const timers: number[] = [];
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    running = null;
    timers.forEach(clearTimeout);
    el.removeEventListener('pointerup', finish);
    el.hidden = true;
    onDone();
  };
  running = { finish };
  timers.push(window.setTimeout(onSlam, (reduced ? 0 : SLAM_AT) * 1000));
  timers.push(window.setTimeout(finish, (reduced ? 1.2 : dur) * 1000));
  el.addEventListener('pointerup', finish);
}
