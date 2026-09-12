/**
 * PROFILE-02 — Default Profile Theme — focused verification
 */
const BASE = 'http://localhost:3000';

function assert(cond, label, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : ' ' + extra}`);
  if (!cond) process.exitCode = 1;
}

async function api(path, method = 'GET', body = null, token = null) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  return { status: res.status, json, headers: res.headers };
}

async function register(email, username, password = 'Password123!') {
  const r = await api('/api/auth/register', 'POST', { email, username, password });
  if (r.status !== 200 && r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.access_token;
}

async function dbGet(sql, params = []) {
  const { execSync } = await import('child_process');
  const script = `
    import('./server/database.js').then(m => {
      const row = m.queryOne(${JSON.stringify(sql)}, ${JSON.stringify(params)});
      console.log('DBROW::' + JSON.stringify(row));
      process.exit(0);
    });`;
  const out = execSync('node --input-type=module -e "' + script.replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"', { encoding: 'utf8' });
  const line = out.split('\n').find(l => l.startsWith('DBROW::'));
  return line ? JSON.parse(line.slice(7)) : null;
}

const stamp = Date.now();
const ua = `p02a${stamp}`;
const uaEmail = `${ua}@test.com`;

// ---------- T1: New registration gets default theme ----------
const tokA = await register(uaEmail, ua);
assert(!!tokA, 'T1 registration succeeds');

let r = await api('/api/profile', 'GET', null, tokA);
assert(r.status === 200, 'T1 GET profile returns 200', `got ${r.status}`);
assert(r.json.theme && r.json.theme.id === 'default', 'T1 new user has default theme', JSON.stringify(r.json.theme));
assert(r.json.theme.name === 'KomuniPH Default', 'T1 theme name is KomuniPH Default');
assert(r.json.theme.type === 'system', 'T1 theme type is system');
assert(r.json.theme.is_free === true, 'T1 theme is_free is true');
assert(r.json.theme.config && typeof r.json.theme.config.background === 'string', 'T1 theme config has background');

// ---------- T2: DB backfill verified ----------
const profileRow = await dbGet('SELECT theme_id FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ua]);
assert(profileRow && profileRow.theme_id === 'default', 'T2 new profile has theme_id=default in DB', JSON.stringify(profileRow));

// ---------- T3: Public profile also exposes theme ----------
r = await api(`/api/profile/${ua}`, 'GET');
assert(r.status === 200, 'T3 public profile returns 200', `got ${r.status}`);
assert(r.json.theme && r.json.theme.id === 'default', 'T3 public profile has default theme', JSON.stringify(r.json.theme));

// ---------- T4: Existing user backfill does not overwrite ----------
const ub = `p02b${stamp}`;
const tokB = await register(`${ub}@test.com`, ub);

// Manually set a different theme for this user to simulate "already had a valid theme"
const { execSync: execSync2 } = await import('child_process');
const customThemeScript = `
  import('./server/database.js').then(m => {
    m.execute('INSERT OR IGNORE INTO profile_themes (id, name, type, is_free, config) VALUES (?, ?, ?, ?, ?)', ['custom', 'Custom Theme', 'system', 1, '{}']);
    m.execute('UPDATE profiles SET theme_id = ? WHERE user_id = (SELECT id FROM users WHERE username = ?)', ['custom', ${JSON.stringify(ub)}]);
    console.log('DONE');
    process.exit(0);
  });`;
execSync2('node --input-type=module -e "' + customThemeScript.replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"', { encoding: 'utf8' });

// Re-run seed to verify it doesn't overwrite
const seedScript = `
  import('./server/database.js').then(m => {
    m.seedDefaultTheme();
    console.log('DONE');
    process.exit(0);
  });`;
execSync2('node --input-type=module -e "' + seedScript.replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"', { encoding: 'utf8' });

const customRow = await dbGet('SELECT theme_id FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ub]);
assert(customRow && customRow.theme_id === 'custom', 'T4 existing valid theme not overwritten', JSON.stringify(customRow));

// ---------- T5: Theme persists across login ----------
r = await api('/api/auth/login', 'POST', { email: uaEmail, username: ua, password: 'Password123!' });
assert(r.status === 200, 'T5 login succeeds', `got ${r.status}`);
const tokA2 = r.json.access_token;
r = await api('/api/profile', 'GET', null, tokA2);
assert(r.json.theme && r.json.theme.id === 'default', 'T5 theme persists after login', JSON.stringify(r.json.theme));

// ---------- T6: Regression - auth and feed still work ----------
r = await api('/api/feed?limit=1&offset=0', 'GET', null, tokA);
assert(r.status === 200, 'T6 feed loads', `got ${r.status}`);
r = await api('/api/feed/posts', 'POST', { content: 'PROFILE-02 regression post' }, tokA);
assert(r.status === 201, 'T6 create post works', `got ${r.status}`);

console.log('DONE');
