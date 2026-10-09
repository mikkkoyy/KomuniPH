const fs = require('fs');
const p = 'tests/test_creator17_mp3_player.mjs';
let s = fs.readFileSync(p, 'utf8');
const m2 = 10266; // second 'async function main()' start (from prior analysis)
const mshim = s.indexOf('// Minimal DOM shim');
if (m2 < 0 || mshim < 0) { console.error('indices missing'); process.exit(1); }
// Remove from m2 up to (but not including) the start of '// Minimal DOM shim'.
s = s.slice(0, m2) + s.slice(mshim);
fs.writeFileSync(p, s, 'utf8');
console.log('cleaned; new length', s.length);
console.log('main count:', (s.match(/async function main\(\)/g) || []).length);
