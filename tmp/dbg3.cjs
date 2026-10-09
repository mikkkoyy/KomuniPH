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

const i = s.indexOf(oldBoot);
console.log('oldBoot found at', i);
if (i === -1) {
  // find where the file's api function starts
  const ai = s.indexOf('function api');
  const au = s.indexOf('async function uploadPart', ai);
  const ret = s.indexOf("return { status: res.status, data, text };", au);
  console.log('file api starts at', ai, 'uploadPart at', au, 'return at', ret);
  const filePart = s.slice(ai, ret + "return { status: res.status, data, text };".length);
  console.log('filePartLength', filePart.length, 'oldBootLength', oldBoot.length);
  console.log('--- file part ---');
  console.log(JSON.stringify(filePart));
  console.log('--- oldBoot ---');
  console.log(JSON.stringify(oldBoot));
}
