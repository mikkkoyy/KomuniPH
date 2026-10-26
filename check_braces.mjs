import { readFileSync } from 'fs';
const code = readFileSync('tests/test_creator17_mp3_player.mjs', 'utf8');
let open = 0;
let inString = false;
let stringChar = '';
let line = 1;
let lastOpenLine = 0;
for (let i = 0; i < code.length; i++) {
  const ch = code[i];
  if (ch === '\n') line++;
  if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
    inString = true;
    stringChar = ch;
  } else if (inString && ch === stringChar && code[i-1] !== '\\') {
    inString = false;
  }
  if (!inString) {
    if (ch === '{') { open++; lastOpenLine = line; }
    else if (ch === '}') open--;
  }
}
console.log('Net braces (excl strings):', open);
console.log('Last unclosed brace at line:', lastOpenLine);