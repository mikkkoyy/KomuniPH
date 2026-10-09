const fs = require('fs');
const s = fs.readFileSync('tests/test_creator17_mp3_player.mjs', 'utf8');
// Find oldBoot candidate: from 'const database = await import' through the END of uploadPart's return
const start = s.indexOf("const database = await import");
// Find the end: the '} ' that closes uploadPart. Walk from start.
let end = s.indexOf('async function uploadPart', start);
// skip to the closing brace of that function: find the last '}' before '\n\n' at top level is hard;
// instead, find the region that the transform expects: start .. end of uploadPart's 'return {...}'
const ai = s.indexOf('function api', start);
const au = s.indexOf('async function uploadPart', start);
const ret = s.indexOf("return { status: res.status, data, text };", au);
console.log('start', start, 'ai', ai, 'au', au, 'ret', ret);
const region = s.slice(start, ret + "return { status: res.status, data, text };".length);
console.log('regionLength', region.length);
console.log(JSON.stringify(region));
// compare with transform oldBoot: recompute oldBoot and print its length
const oldBoot = [
  "const database = await import('../server/database.js');",
  'await database.initDatabase();',
  '',
  "const auth = await import('../server/auth.js');",
  "await import('../server/index.js'); // boots HTTP on port 0",
  '',
  '',
  'function api(method, path, { token, body } = {}) {',
  "  const headers = {};",
  "  if (token) headers.Authorization = `Bearer ${token}`;",
  "  const res = await fetch(`${BASE_URL}${path}`, {",
  '    method,',
  '    headers,',
  '    body: body === undefined ? undefined : JSON.stringify(body),',
  '  });',
  "  const text = await res.text();",
  '  let data = null;',
  '  try { data = JSON.parse(text); } catch { /* non-JSON */ }',
  "  return { status: res.status, data, text };",
  '}',
  '',
  'async function uploadPart(path, token, fieldName, filename, bytes, type) {',
  '  const fd = new FormData();',
  "  fd.append(fieldName, new Blob([bytes], { type }), filename);",
  "  const res = await fetch(`${BASE_URL}${path}`, {",
  "    method: 'POST',",
  "    headers: token ? { Authorization: `Bearer ${token}` } : {},",
  '    body: fd,',
  '  });',
  "  const text = await res.text();",
  '  let data = null;',
  '  try { data = JSON.parse(text); } catch { /* non-JSON */ }',
  "  return { status: res.status, data, text };",
  '}',
].join('\n');
console.log('oldBootLength', oldBoot.length);
console.log('regionLength vs oldBootLength:', region.length, oldBoot.length);
console.log('region === oldBoot ?', region === oldBoot);
