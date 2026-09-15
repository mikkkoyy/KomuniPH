import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';

const out = [];
out.push('LOG:\n' + execSync('git --no-pager log -3 --format="%h | %cd | %s" --date=iso').toString());
out.push('STATUS:\n' + execSync('git status --short').toString());
out.push('current profile.js lines: ' + readFileSync('web/js/profile.js', 'utf8').split(/\r?\n/).length);
out.push('HEAD profile.js lines: ' + execSync('git show HEAD:web/js/profile.js').toString().split(/\r?\n/).length);
out.push('DIFF STAT profile.js:\n' + execSync('git --no-pager diff --stat -- web/js/profile.js').toString());
out.push('DIFF STAT all:\n' + execSync('git --no-pager diff --stat').toString());
out.push('HEAD has initGalleryPage: ' + execSync('git show HEAD:web/js/profile.js').toString().includes('initGalleryPage'));
out.push('HEAD has renderGalleryShell: ' + execSync('git show HEAD:web/js/profile.js').toString().includes('renderGalleryShell'));

writeFileSync('.tmp-test/git-facts.txt', out.join('\n\n'), 'utf8');
console.log('ok');