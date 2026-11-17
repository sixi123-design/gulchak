import type { Score } from '../sim/score';

/**
 * 결과표 성적판: 고칠 것 목록(만점 항목은 숨김, 많이 놓친 순). 실제 시험처럼 합격·불합격만 (등급·점수 숫자는 안 보임).
 * 데이터는 main.ts가 src/sim/score.ts 결과로 넘긴다. null이면 성적판을 숨김.
 */
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MARK_CLS: Record<string, string> = { '◎': 'm-best', '○': 'm-good', '△': 'm-meh', '✗': 'm-bad' };

export function renderScore(el: HTMLElement, v: Score | null, locked = false) {
  el.hidden = !v && !locked;
  el.classList.toggle('locked', !v && locked);
  if (!v) {
    // 자유 연습: 채점하지 않는다고 그대로 말한다 (흐린 가짜 채점표는 쓰지 않는다 — 유료 유도처럼 보임)
    el.innerHTML = locked ? '<p class="sc-lock-f">자유 연습은 채점하지 않아요 · 채점은 연습 시험에서</p>' : '';
    return;
  }
  // 고칠 것만, 많이 놓친 순서로 (만점 항목은 숨김)
  const fix = v.items.filter((it) => it.got < it.max).sort((a, b) => b.max - b.got - (a.max - a.got));
  const rows = fix
    .map(
      (it, i) =>
        `<li class="sc-row ${MARK_CLS[it.mark]}" style="--i:${i}">` +
        `<b class="sc-mark">${it.mark}</b>` +
        `<span class="sc-name">${esc(it.name)}</span>` +
        `<small class="sc-note">${esc(it.note && it.note !== '-' ? it.note : '')}</small></li>`,
    )
    .join('');
  el.className = 'res-score no-grade';
  el.innerHTML =
    // 합격·불합격은 도장이 말함
    (fix.length ? `<ul class="sc-rows"><li class="sc-head">고칠 것</li>${rows}</ul>` : `<ul class="sc-rows"><li class="sc-head sc-perfect">고칠 것 없음 · 완벽해요!</li></ul>`);
}
