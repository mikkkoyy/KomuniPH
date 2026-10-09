const fs = require('fs');
const s = fs.readFileSync('tests/test_creator17_mp3_player.mjs', 'utf8');

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

const fileBlock = s.slice(
  s.indexOf("const database = await import"),
  s.indexOf("return { status: res.status, data, text };", s.indexOf('async function uploadPart')) + "return { status: res.status, data, text };".length
);

for (let i = 0; i < Math.max(oldBoot.length, fileBlock.length); i++) {
  const a = oldBoot[i] ?? '<END>';
  const b = fileBlock[i] ?? '<END>';
  if (a !== b) {
    console.log('first diff at index', i);
    console.log('oldBoot[' + i + '] =', JSON.stringify(a));
    console.log('fileBlock[' + i + '] =', JSON.stringify(b));
    console.log('--- context oldBoot ---');
    console.log(JSON.stringify(oldBoot.slice(Math.max(0,i-40), i+40)));
    console.log('--- context fileBlock ---');
    console.log(JSON.stringify(fileBlock.slice(Math.max(0,i-40), i+40)));
    break;
  }
}
console.log('oldBoot.length', oldBoot.length, 'fileBlock.length', fileBlock.length);
