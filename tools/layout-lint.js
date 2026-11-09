// 화면 간격 검사: 브라우저 콘솔(또는 CDP eval)에 붙여 넣어 실행. 보이는 맨 위 요소끼리 겹침·12px 미만 간격·36px 미만 버튼·글자 넘침·카드 스크롤을 찾음
(() => {
  // 보이는 버튼끼리 간격 12px 미만 / 겹침, 44px 미만 터치 영역, 글자 넘침, 카드 스크롤
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (!(r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0' && e.closest('[hidden]') === null)) return false; const t = document.elementFromPoint(Math.min(innerWidth-1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight-1, Math.max(0, r.top + r.height / 2))); return !!t && (e === t || e.contains(t) || t.contains(e)); };
  const els = [...document.querySelectorAll('button, .btn, input, .chip, .lab')].filter((e) => !e.matches('.site-row')).filter(vis);
  const out = [];
  const name = (e) => (e.id ? '#' + e.id : '') + '「' + (e.textContent || e.title || e.placeholder || '').trim().slice(0, 10) + '」';
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j];
    if (a.contains(b) || b.contains(a)) continue;
    const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    const dx = Math.max(q.left - r.right, r.left - q.right), dy = Math.max(q.top - r.bottom, r.top - q.bottom);
    const gap = Math.max(dx, dy);
    if (gap < 0 && dx < 0 && dy < 0) out.push(`겹침 ${name(a)} ${name(b)}`);
    else if (gap < 12 && !(a.parentElement === b.parentElement && a.parentElement.matches('.tabs,.sp-kind,.machine-pick,.key-pad,.chips,.actions,.hero,.stick,.mode-pick'))) out.push(`간격 ${Math.round(gap)}px ${name(a)} ${name(b)}`);
  }
  for (const e of els) { const r = e.getBoundingClientRect(); if (e.matches('button,.btn') && Math.min(r.width, r.height) < 36) out.push(`작음 ${Math.round(r.width)}x${Math.round(r.height)} ${name(e)}`); if (e.scrollWidth > e.clientWidth + 1) out.push(`글자넘침 ${name(e)}`); }
  for (const c of document.querySelectorAll('.card')) if (vis(c) && c.scrollHeight > c.clientHeight + 1) out.push(`스크롤 ${c.className}`);
  return out.join('\n') || 'OK';
})()
