// dist/ 를 gh-pages 브랜치로 강제 푸시 (GitHub Pages: gh-pages 브랜치 / 루트)
import { execSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
const remote = execSync('git remote get-url origin').toString().trim();
const run = (c) => execSync(c, { cwd: 'dist', stdio: 'inherit' });
rmSync('dist/.git', { recursive: true, force: true }); // 이전 배포 기록 제거
writeFileSync('dist/.nojekyll', '');
run('git init -q -b gh-pages');
run('git add -A');
run('git -c user.name="deploy" -c user.email="deploy@users.noreply.github.com" commit -q --allow-empty -m "deploy"');
run(`git push -f ${remote} gh-pages`);
console.log('gh-pages 배포 완료');
