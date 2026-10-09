const fs = require('fs');
const p = 'tests/test_creator17_mp3_player.mjs';
let s = fs.readFileSync(p, 'utf8');
const needle = "import { existsSync, rmSync } from 'node:fs';";
const repl = "import { existsSync, rmSync } from 'node:fs';\nconsole.log('FILE-RUNNING-OK');\n";
if (s.includes(needle)) {
  s = s.replace(needle, repl);
  fs.writeFileSync(p, s, 'utf8');
  console.log('instrumented');
} else {
  console.log('needle not found');
}
