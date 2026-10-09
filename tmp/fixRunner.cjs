const fs = require('fs');
const p = 'tests/test_creator17_mp3_player.mjs';
let s = fs.readFileSync(p, 'utf8');

// Remove everything from 'main().then(() => {' to the end (the runner was
// misplaced/duplicated by earlier edits) and replace with a clean runner.
const anchor = 'main().then(() => {';
const ai = s.indexOf(anchor);
if (ai === -1) {
  console.error('anchor not found');
  process.exit(1);
}
// Keep content BEFORE the runner, then write the runner fresh.
const head = s.slice(0, ai);
const runner = [
  'main().then(() => {',
  '  console.log(`All CREATOR-17 tests passed.`);',
  '  process.exit(0);',
  '}).catch((err) => {',
  '  console.error(err);',
  '  process.exit(1);',
  '});',
].join('\n');

s = head + '\n' + runner + '\n';
fs.writeFileSync(p, s, 'utf8');
console.log('runner replaced; new length', s.length);
