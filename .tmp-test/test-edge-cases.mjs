import { execSync } from 'child_process';

const BASE = 'http://localhost:3000';
const stamp = Date.now();
let pass = 0, fail = 0;

function assert(cond, label) {
  if (cond) { pass++; console.log('PASS:', label); }
  else { fail++; console.log('FAIL:', label); }
}

async function api(path, method = 'GET', body = null, token = null) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body !== null ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  return { status: res.status, json };
}

async function check() {
  // Register a fresh user
  const username = 'edge' + stamp;
  const reg = await api('/api/auth/register', 'POST', { email: username + '@test.com', username: username, password: 'Password123!' });
  const token = reg.json.access_token;

  // Get the profile
  let r = await api('/api/profile', 'GET', null, token);

  // Edge case 1: custom_theme_config = NULL (default state)
  assert(r.json.theme && r.json.theme.id === 'default', 'E1: NULL custom_theme_config - default theme works');
  assert(r.json.theme.config.background === '#fff7ec', 'E1: NULL custom_theme_config - background correct');

  // Edge case 2: custom_theme_config = {} (via API - reset all)
  r = await api('/api/profile/theme', 'PATCH', {}, token);
  assert(r.status === 200, 'E2: Empty object via API - profile updates');
  assert(r.json.theme && r.json.theme.id === 'default', 'E2: Empty object - default theme');

  // Edge case 5: Custom theme with textColor only (via API)
  r = await api('/api/profile/theme', 'PATCH', { textColor: '#ffffff' }, token);
  assert(r.status === 200, 'E5: Custom textColor via API');
  assert(r.json.theme.config.textColor === '#ffffff', 'E5: Custom textColor preserved');
  assert(r.json.theme.config.background === '#fff7ec', 'E5: Missing background falls back to default');

  // Edge case 6: Custom theme with backgroundColor only (via API)
  r = await api('/api/profile/theme', 'PATCH', { backgroundColor: '#000000' }, token);
  assert(r.status === 200, 'E6: Custom backgroundColor via API');
  assert(r.json.theme.config.backgroundColor === '#000000', 'E6: backgroundColor preserved');

  // Edge case: Public profile with custom theme
  r = await api('/api/profile/' + username, 'GET');
  assert(r.status === 200, 'E7: Public profile loads');
  assert(r.json.theme.config.backgroundColor === '#000000', 'E7: Public profile has custom theme');

  console.log('\n=== EDGE CASES: ' + pass + ' PASS, ' + fail + ' FAIL ===');
  if (fail > 0) process.exit(1);
}

check().catch(e => { console.error(e); process.exit(1); });
