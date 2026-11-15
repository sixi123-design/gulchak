/**
 * 배우기 미션 자동 검수.
 *
 *   node scripts/review/run.mjs "흙 퍼기"
 *
 * 1) 미리보기 서버를 띄우고 **실제로 조작해서** 끝까지 가 본다
 * 2) 화면에 뜬 글자와 조작 기록을 모은다 (소스에서 긁지 않는다)
 * 3) 두 패널에 돌린다
 *    - 초심자: 자료를 **하나도 안 주고** 화면 글자만 (레포 밖에서 돌려 못 읽게 한다)
 *    - 디자이너·기획자·개발자: 기록과 코드를 같이 보고
 * 4) docs/reviews/<날짜>-<미션>.md 로 보고서를 쓴다
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { playLesson } from './play.mjs';

const title = process.argv[2];
if (!title) {
  console.error('쓰는 법: node scripts/review/run.mjs "미션 이름"');
  process.exit(1);
}
const PORT = 4173;
const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * codex 한 번. 프롬프트는 **표준입력**으로 준다 (셸에 태우면 따옴표·줄바꿈이 깨진다).
 * `isolated`면 레포 밖 빈 폴더에서 돌려 **코드를 못 읽게** 한다 — 초심자 검수의 핵심이다.
 */
function askPanel(prompt, { isolated = false, effort = 'high' } = {}) {
  const cwd = isolated ? mkdtempSync(join(tmpdir(), 'exc-review-')) : process.cwd();
  return execFileSync(
    'codex',
    ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-c', `model_reasoning_effort="${effort}"`, '-'],
    { cwd, input: prompt, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] },
  );
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
try {
  await sleep(3500);
  console.log(`[1/4] "${title}" 직접 조작 중…`);
  const r = await playLesson({ url: `http://localhost:${PORT}/`, title });
  console.log(`      구간 ${r.facts.length}개 · CLEAR ${r.cleared ? '됨' : '안 됨'} · 화면 ${r.shots.length}장`);

  const copy = [
    `(왜 배우나) ${r.whyTitle}`,
    ...r.why.map((l) => `  ${l}`),
    ...r.seen.map((x) => `[${x.kind}] ${x.text}`),
    r.clear.title ? `(끝나고) ${r.clear.title} — ${r.clear.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const facts = [
    `끝까지 감: ${r.cleared ? '예' : '아니오'}`,
    ...r.facts.map((f) => `${f.step}. "${f.text}"  ${JSON.stringify(f.state)}`),
  ].join('\n');

  const tpl = (n) => readFileSync(join(here, n), 'utf8');
  console.log('[2/4] 초심자 검수…');
  const naive = askPanel(tpl('naive.md').replace('{{COPY}}', copy), { isolated: true, effort: 'medium' });
  console.log('[3/4] 디자이너·기획자·개발자 검수…');
  const panel = askPanel(tpl('panel.md').replace('{{FACTS}}', facts).replace('{{COPY}}', copy));

  const day = new Date().toISOString().slice(0, 10);
  const out = join('docs', 'reviews', `${day}-${title.replace(/\s+/g, '')}.md`);
  mkdirSync(join('docs', 'reviews'), { recursive: true });
  writeFileSync(
    out,
    [
      `# 검수: ${title} (${day})`,
      '',
      '> `node scripts/review/run.mjs "' + title + '"` 로 자동 생성.',
      '> 직접 조작해서 끝까지 가 본 기록과, 화면에 뜬 글자만 패널에 넘긴 결과다.',
      '',
      `## 조작 기록 (CLEAR ${r.cleared ? '됨' : '**안 됨**'})`,
      '',
      '```',
      facts,
      '```',
      '',
      `화면 ${r.shots.length}장: \`${r.shotDir}\``,
      '',
      '## 화면에 뜬 글자',
      '',
      '```',
      copy,
      '```',
      '',
      '## 초심자 검수 (자료 없이 글자만)',
      '',
      naive.trim(),
      '',
      '## 디자이너 · 기획자 · 개발자 검수',
      '',
      panel.trim(),
      '',
      '## 처리',
      '',
      '- [ ] (고칠 것을 여기에 옮겨 적고 하나씩 지운다)',
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(`[4/4] 보고서: ${out}`);
} finally {
  server.kill();
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'vite preview' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { stdio: 'ignore' });
  } catch {
    /* 이미 꺼졌으면 그만 */
  }
}
