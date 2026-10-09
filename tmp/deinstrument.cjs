const fs = require('fs');
const p = 'tests/test_creator17_mp3_player.mjs';
let s = fs.readFileSync(p, 'utf8');
const needle = "import { existsSync, rmSync } from 'node:fs';\nconsole.log('FILE-RUNNING-OK');\n";
const repl = "import { existsSync, rmSync } from 'node:fs';\n";
if (s.includes(needle)) {
  s = s.replace(needle, repl);
  fs.writeFileSync(p, s, 'utf8');
  console.log('uninstrumented');
} else {
  console.log('needle not found, length', s.length);
}
