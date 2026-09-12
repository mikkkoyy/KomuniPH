/**
 * PROFILE-03 — Theme Customization — focused verification
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
    import('file:///D:/FILES/project/KomuniPH/server/database.js').then(m => {
      const row = m.queryOne(${JSON.stringify(sql)}, ${JSON.stringify(params)});
      console.log('DBROW::' + JSON.stringify(row));
      process.exit(0);
    });`;
  const out = execSync('node --input-type=module -e "' + script.replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"', { encoding: 'utf8' });
  const line = out.split('\n').find(l => l.startsWith('DBROW::'));
  return line ? JSON.parse(line.slice(7)) : null;
}

const stamp = Date.now();
const ua = `p03a${stamp}`;
const ub = `p03b${stamp}`;
const uaEmail = `${ua}@test.com`;
const ubEmail = `${ub}@test.com`;

// ---------- Setup ----------
const tokA = await register(uaEmail, ua);
const tokB = await register(ubEmail, ub);
assert(!!tokA && !!tokB, 'T0 two users registered');

// ---------- T1: New user gets default theme ----------
let r = await api('/api/profile', 'GET', null, tokA);
assert(r.status === 200, 'T1 GET profile returns 200', `got ${r.status}`);
assert(r.json.theme && r.json.theme.id === 'default', 'T1 new user has default theme', JSON.stringify(r.json.theme));
assert(r.json.theme.config.background === '#fff7ec', 'T1 default background preserved');

// ---------- T2: Theme customization persists ----------
r = await api('/api/profile/theme', 'PATCH', {
  backgroundColor: '#111827',
  textColor: '#ffffff',
  mutedTextColor: '#94a3b8',
  accentColor: '#38bdf8',
  cardBackground: '#0f172a',
  cardOpacity: 0.92,
  cardBorderColor: '#334155',
  cardBorderRadius: 18
}, tokA);
assert(r.status === 200, 'T2 theme update returns 200', `got ${r.status}`);
assert(r.json.theme.config.backgroundColor === '#111827', 'T2 backgroundColor saved', JSON.stringify(r.json.theme.config));
assert(r.json.theme.config.textColor === '#ffffff', 'T2 textColor saved');
assert(r.json.theme.config.cardOpacity === 0.92, 'T2 cardOpacity saved');

// Verify in DB
const customRow = await dbGet('SELECT custom_theme_config FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ua]);
assert(customRow && customRow.custom_theme_config, 'T2 custom config stored in DB');
const customParsed = JSON.parse(customRow.custom_theme_config);
assert(customParsed.backgroundColor === '#111827', 'T2 DB has backgroundColor');

// ---------- T3: Theme persists after reload ----------
r = await api('/api/profile', 'GET', null, tokA);
assert(r.json.theme.config.backgroundColor === '#111827', 'T3 theme persists after reload', JSON.stringify(r.json.theme.config));

// ---------- T4: Public profile shows custom theme ----------
r = await api(`/api/profile/${ua}`, 'GET');
assert(r.status === 200, 'T4 public profile returns 200', `got ${r.status}`);
assert(r.json.theme.config.backgroundColor === '#111827', 'T4 public profile has custom theme', JSON.stringify(r.json.theme.config));

// ---------- T5: User isolation ----------
r = await api('/api/profile', 'GET', null, tokB);
assert(!r.json.theme.config.backgroundColor, 'T5 User B unaffected by A customization', JSON.stringify(r.json.theme.config));

// ---------- T6: Reset to default ----------
r = await api('/api/profile/theme', 'PATCH', {
  backgroundColor: null,
  textColor: null,
  cardOpacity: null,
  cardBorderRadius: null
}, tokA);
assert(r.status === 200, 'T6 reset returns 200', `got ${r.status}`);
assert(!r.json.theme.config.backgroundColor, 'T6 backgroundColor removed');
assert(!r.json.theme.config.cardOpacity, 'T6 cardOpacity removed');
assert(r.json.theme.config.background === '#fff7ec', 'T6 falls back to default background');

// ---------- T7: Background upload ----------
r = await api('/api/profile/theme', 'PATCH', {
  backgroundImage: '/uploads/backgrounds/test.webp'
}, tokA);
assert(r.status === 200, 'T7 direct background URL save returns 200');

// Test actual file upload
const { readFileSync } = await import('fs');
const testImagePath = 'D:\\FILES\\project\\KomuniPH\\.tmp-test\\test.webp';
const fileBuffer = Buffer.from(readFileSync(testImagePath));
const formData = new FormData();
formData.append('background', new Blob([fileBuffer], { type: 'image/webp' }), 'test.webp');

const uploadHeaders = { Authorization: `Bearer ${tokA}` };
const uploadRes = await fetch(`${BASE}/api/profile/background`, {
  method: 'POST',
  headers: uploadHeaders,
  body: formData,
});
assert(uploadRes.status === 200, 'T7 background upload returns 200', `got ${uploadRes.status}`);
const uploadJson = await uploadRes.json();
assert(uploadJson.background_url && uploadJson.background_url.startsWith('/uploads/backgrounds/'), 'T7 background URL returned', uploadJson.background_url);

// ---------- T8: Security - invalid values rejected ----------
const invalidTests = [
  [{ backgroundColor: 'red' }, 'invalid color format'],
  [{ backgroundGradient: 'rgb(0,0,0)' }, 'invalid gradient'],
  [{ backgroundPosition: 'invalid' }, 'invalid position'],
  [{ backgroundSize: 'invalid' }, 'invalid size'],
  [{ backgroundRepeat: 'invalid' }, 'invalid repeat'],
  [{ cardOpacity: 1.5 }, 'invalid opacity'],
  [{ cardBorderRadius: 200 }, 'invalid border radius'],
  [{ unknownField: 'value' }, 'unknown field']
];

for (const [payload, label] of invalidTests) {
  r = await api('/api/profile/theme', 'PATCH', payload, tokA);
  assert(r.status === 422, `T8 ${label} rejected 422`, `got ${r.status}`);
}

// ---------- T9: Unauthorized theme modification rejected ----------
r = await api('/api/profile/theme', 'PATCH', { backgroundColor: '#000000' });
assert(r.status === 401, 'T9 unauthenticated rejected 401', `got ${r.status}`);

// ---------- T10: Regression ----------
r = await api('/api/feed?limit=1&offset=0', 'GET', null, tokA);
assert(r.status === 200, 'T10 feed loads', `got ${r.status}`);
r = await api('/api/feed/posts', 'POST', { content: 'PROFILE-03 regression post' }, tokA);
assert(r.status === 201, 'T10 create post works', `got ${r.status}`);

console.log('DONE');
