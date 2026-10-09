// Transform the CREATOR-17 test file: wrap the server-boot + api/uploadPart
// helpers in an async main() so the module has no top-level await, eliminating
// any CJS/ESM parser ambiguity on this platform.
const fs = require('fs');
const p = 'tests/test_creator17_mp3_player.mjs';
let s = fs.readFileSync(p, 'utf8');

// 1) Build the main() body that contains all top-level-await logic.
const mainBody = [
  'async function main() {',
  "  const database = await import('../server/database.js');",
  '  await database.initDatabase();',
  '',
  "  const auth = await import('../server/auth.js');",
  "  await (await import('../server/index.js')); // boots HTTP",
  '',
  "  const BASE_URL = (await import('../server/index.js')).BASE_URL;",
  '',
  '  // ---- HTTP helpers ----',
  '  function api(method, path, { token, body } = {}) {',
  "    const headers = {};",
  "    if (token) headers.Authorization = `Bearer ${token}`;",
  "    const res = await fetch(`${BASE_URL}${path}`, {",
  '      method,',
  '      headers,',
  '      body: body === undefined ? undefined : JSON.stringify(body),',
  '    });',
  "    const text = await res.text();",
  '    let data = null;',
  '    try { data = JSON.parse(text); } catch { /* non-JSON */ }',
  "    return { status: res.status, data, text };",
  '  }',
  '',
  '  async function uploadPart(path, token, fieldName, filename, bytes, type) {',
  '    const fd = new FormData();',
  "    fd.append(fieldName, new Blob([bytes], { type }), filename);",
  "    const res = await fetch(`${BASE_URL}${path}`, {",
  "      method: 'POST',",
  "      headers: token ? { Authorization: `Bearer ${token}` } : {},",
  '      body: fd,',
  '    });',
  "    const text = await res.text();",
  '    let data = null;',
  '    try { data = JSON.parse(text); } catch { /* non-JSON */ }',
  "    return { status: res.status, data, text };",
  '  }',
  '}',
].join('\n');

// 2) Replace the existing top-level-await boot block with the main() body.
//    Current file layout (exact):
//      const database = await import('../server/database.js');
//      await database.initDatabase();
//      (blank)
//      const auth = await import('../server/auth.js');
//      await import('../server/index.js'); // boots HTTP on port 0
//      (blank)
//      (blank)
//      function api(method, path, { token, body } = {}) { ... }
//      (blank)
//      async function uploadPart(...) { ... }
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

let idx = s.indexOf(oldBoot);
if (idx === -1) {
  console.error('FATAL: old boot block not found (len=' + oldBoot.length + ')');
  process.exit(1);
}
s = s.slice(0, idx) + mainBody + s.slice(idx + oldBoot.length);

// 3) Finish the file: add main() invocation + cleanup after the existing
//    `main().catch(...)` runner, or append if missing.
const runnerEnd = [
  'main().then(() => {',
  '  console.log(`All CREATOR-17 tests passed.`);',
  '  process.exit(0);',
  '}).catch((err) => {',
  '  console.error(err);',
  '  process.exit(1);',
  '});',
].join('\n');

if (s.indexOf('function main()') === -1) {
  console.error('FATAL: main() not created');
  process.exit(1);
}
if (s.indexOf('main().then') === -1) {
  s = s.replace('});', runnerEnd) + '\n';
}

fs.writeFileSync(p, s, 'utf8');
console.log('transform complete; new length', s.length);
