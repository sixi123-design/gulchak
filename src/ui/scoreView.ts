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
    // 자유 연습·배우기: 채점을 하지 않는다. 채점표가 있다는 것만 보여준다
    el.innerHTML = locked
      ? '<p class="sc-lock-h">채점표</p><ul class="sc-lock"><li></li><li></li><li></li></ul><p class="sc-lock-f">시험 기준이 걸린 모드에서 채점돼요</p>'
      : '';
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
