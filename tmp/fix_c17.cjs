// Focused transform: the file currently has top-level `api` + `uploadPart`
// definitions AND top-level `await` for server boot. This script moves them
// into an async main() so the module has no top-level await (fixes a CJS/ESM
// parser ambiguity on this platform).
const fs = require('fs');
const p = 'tests/test_creator17_mp3_player.mjs';
let s = fs.readFileSync(p, 'utf8');

// Remove the top-level `api` function body (re-define inside main()).
// Match from 'function api(method, path, { token, body } = {}) {' through its closing '}\n\n'.
const apiRegex = /function api\(method, path, \{ token, body \} = \{\} \{\n  const headers = \ \{\};\n  if \(token\) headers\.Authorization = `Bearer \$\{token\}`;\n  const res = await fetch\(\`\$\{BASE_URL\}\{path\}\`, \{\n    method, headers,\n    body: body === undefined \? undefined : JSON\.stringify\(body\),\n  \}\);\n  const text = await res\.text\(\);\n  let data = null;\n  try \{ data = JSON\.parse\(text\); \} catch \{ \/\* non-JSON \*\/ \}\n  return \{ status: res\.status, data, text \};\n\}\n\n/g;
s = s.replace(apiRegex, '');

// Remove the top-level `uploadPart` function body.
const upRegex = /async function uploadPart\(path, token, fieldName, filename, bytes, type\) \{\n  const fd = new FormData\(\);\n  fd\.append\(fieldName, new Blob\(\[bytes\], \{ type \}\)\), filename\);\n  const res = await fetch\(\`\$\{BASE_URL\}\{path\}\`, \{\n    method: 'POST',\n    headers: token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\},\n    body: fd,\n  \}\);\n  const text = await res\.text\(\);\n  let data = null;\n  try \{ data = JSON\.parse\(text\); \} catch \{ \/\* non-JSON \*\/ \}\n  return \{ status: res\.status, data, text \};\n\}\n\n/g;
s = s.replace(upRegex, '');

// Now ensure the file has a `main()` async function wrapping the top-level-await
// boot + the api/uploadPart helpers. Currently the file has:
//   const database = await import('../server/database.js');
//   await database.initDatabase();
//   const auth = await import('../server/auth.js');
//   await import('../server/index.js'); // boots HTTP
// (no BASE_URL constant now).
if (!s.includes('function main()')) {
  const mainFn = [
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
    '    const headers = {};',
    "    if (token) headers.Authorization = `Bearer ${token}`;",
    "    const res = await fetch(`${BASE_URL}${path}`, {",
    '    method, headers,',
    '    body: body === undefined ? undefined : JSON.stringify(body),',
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
    "    method: 'POST',",
    "    headers: token ? { Authorization: `Bearer ${token}` } : {},",
    '    body: fd,',
    '    });',
    "    const text = await res.text();",
    '    let data = null;',
    '    try { data = JSON.parse(text); } catch { /* non-JSON */ }',
    "    return { status: res.status, data, text };",
    '  }',
    '}',
  ].join('\n');

  // Insert the main() right after the top-level `await import('../server/index.js')` line.
  const anchor = "await import('../server/index.js'); // boots HTTP";
  const idx = s.indexOf(anchor);
  if (idx === -1) { console.error('anchor not found'); process.exit(1); }
  s = s.slice(0, idx) + '\n' + mainFn + '\n' + s.slice(idx);

  // Replace the existing top-level `api`/`uploadPart` (already removed above) — nothing left.
  // Attach the runner.
  const runner = [
    'main().then(() => {',
    '  console.log(`All CREATOR-17 tests passed.`);',
    '  process.exit(0);',
    '}).catch((err) => {',
    '  console.error(err);',
    '  process.exit(1);',
    '});',
  ].join('\n');
  // Append runner before the final section if missing.
  if (s.indexOf('main().then') === -1) {
    s = s.replace(/\}\)\);$/m, runner + '\n}');
  }
  s = s.replace('main().then', runner + '\nmain().then');
}

fs.writeFileSync(p, s, 'utf8');
console.log('transform OK; length', s.length);
