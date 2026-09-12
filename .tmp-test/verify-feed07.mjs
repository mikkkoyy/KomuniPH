/**
 * FEED-07 — Profile Edit — focused verification
 * Tests PATCH /api/profile (display_name, bio, alias), validation,
 * auth, duplicate alias, persistence, and FEED regression.
 */
const BASE = 'http://localhost:3000';
const { execSync } = await import('child_process');

function assert(cond, label, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : ' ' + extra}`);
  if (!cond) process.exitCode = 1;
}

async function api(path, method = 'GET', body = null, token = null, rawBody = null) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: rawBody !== null ? rawBody : body !== null ? JSON.stringify(body) : undefined,
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

// DB read helper (separate WAL-safe connection)
async function dbGet(sql, params = []) {
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
const ua = `f07a${stamp}`; // user A
const ub = `f07b${stamp}`; // user B
const emailA = `${ua}@test.com`, emailB = `${ub}@test.com`;

const tokA = await register(emailA, ua);
const tokB = await register(emailB, ub);
assert(!!tokA && !!tokB, 'setup: two users registered');

// ---------- Test 1: display_name ----------
let r = await api('/api/profile', 'PATCH', { display_name: 'Alice Edited' }, tokA);
assert(r.status === 200, 'T1 display_name returns 200', `got ${r.status}`);
let row = await dbGet('SELECT display_name FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ua]);
assert(row && row.display_name === 'Alice Edited', 'T1 display_name persisted in SQLite', JSON.stringify(row));
assert(r.json && r.json.display_name === 'Alice Edited' && !('password_hash' in r.json), 'T1 response returns updated profile, no secrets');

// ---------- Test 2: bio ----------
r = await api('/api/profile', 'PATCH', { bio: '  Hello from FEED-07  ' }, tokA);
assert(r.status === 200, 'T2 bio returns 200', `got ${r.status}`);
row = await dbGet('SELECT bio FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ua]);
assert(row && row.bio === 'Hello from FEED-07', 'T2 bio persisted + trimmed', JSON.stringify(row));

// Partial update safety: PATCH only bio must NOT blank display_name/alias
r = await api('/api/profile', 'PATCH', { bio: 'second bio only' }, tokA);
row = await dbGet('SELECT display_name, alias FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ua]);
assert(row && row.display_name === 'Alice Edited', 'T2b partial update keeps display_name', JSON.stringify(row));

// ---------- Test 3: alias ----------
r = await api('/api/profile', 'PATCH', { alias: '  aliA_07  ' }, tokA);
assert(r.status === 200, 'T3 alias returns 200', `got ${r.status} ${JSON.stringify(r.json)}`);
row = await dbGet('SELECT alias FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ua]);
assert(row && row.alias === 'aliA_07', 'T3 alias persisted + trimmed', JSON.stringify(row));

// ---------- Test 4: duplicate alias ----------
r = await api('/api/profile', 'PATCH', { alias: 'aliA_07' }, tokB);
assert(r.status === 409, 'T4 duplicate alias rejected 409', `got ${r.status}`);
row = await dbGet('SELECT alias FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ub]);
assert(!row.alias, 'T4 user B alias unchanged', JSON.stringify(row));

// Case-insensitive duplicate check
r = await api('/api/profile', 'PATCH', { alias: 'ALIA_07' }, tokB);
assert(r.status === 409, 'T4b case-insensitive duplicate alias rejected', `got ${r.status}`);

// ---------- Test 5: validation ----------
const invalid = [
  [{ display_name: '' }, 'empty display_name'],
  [{ display_name: 'x'.repeat(101) }, 'display_name > 100'],
  [{ bio: 'x'.repeat(501) }, 'bio > 500'],
  [{ alias: '' }, 'empty alias'],
  [{ alias: 'x'.repeat(51) }, 'alias > 50'],
  [{ alias: 'bad alias!' }, 'alias invalid chars'],
  [{ alias: 'bad alias' }, 'alias spaces'],
];
for (const [payload, label] of invalid) {
  r = await api('/api/profile', 'PATCH', payload, tokA);
  assert(r.status === 422, `T5 ${label} rejected 422`, `got ${r.status}`);
}
row = await dbGet('SELECT display_name, bio, alias FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ua]);
assert(row && row.display_name === 'Alice Edited' && row.bio === 'second bio only' && row.alias === 'aliA_07',
  'T5 database unchanged after invalid attempts', JSON.stringify(row));

// ---------- Test 6: authentication ----------
r = await api('/api/profile', 'PATCH', { display_name: 'Hacker' });
assert(r.status === 401, 'T6 unauthenticated rejected 401', `got ${r.status}`);
r = await api('/api/profile', 'PATCH', { display_name: 'Hacker' }, 'invalid.token.here');
assert(r.status === 401, 'T6b invalid token rejected 401', `got ${r.status}`);
row = await dbGet('SELECT display_name FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ua]);
assert(row && row.display_name === 'Alice Edited', 'T6 no profile modified', JSON.stringify(row));

// ---------- Test 7: persistence (fresh DB process already proves SQLite) ----------
row = await dbGet('SELECT display_name, bio, alias FROM profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', [ua]);
assert(row && row.display_name === 'Alice Edited' && row.alias === 'aliA_07', 'T7 changes persisted in SQLite', JSON.stringify(row));

// ---------- Test 8: regression ----------
// Feed loads
r = await api('/api/feed?limit=20&offset=0', 'GET', null, tokA);
assert(r.status === 200 && Array.isArray(r.json.posts), 'T8 feed loads', `got ${r.status}`);

// Create post, like, comment
r = await api('/api/feed/posts', 'POST', { content: 'FEED-07 regression post' }, tokA);
assert(r.status === 201 && r.json.id, 'T8 create post works', `got ${r.status}`);
const postId = r.json.id;
r = await api(`/api/feed/posts/${postId}/like`, 'POST', null, tokB);
assert(r.status === 200 || r.status === 201, 'T8 like works', `got ${r.status}`);
r = await api(`/api/feed/posts/${postId}/comments`, 'POST', { content: 'regression comment' }, tokB);
assert(r.status === 201, 'T8 comment works', `got ${r.status}`);
r = await api(`/api/feed/posts/${postId}/comments`, 'GET', null, tokA);
assert(r.status === 200 && r.json.comments.length === 1, 'T8 comments retrieve works', `got ${r.status}`);

// Author profile_photo_url in feed still matches profile
r = await api('/api/profile', 'GET', null, tokA);
assert(r.status === 200, 'T8 profile GET works', `got ${r.status}`);
const photoUrl = r.json.profile_photo_url;
r = await api('/api/feed?limit=1&offset=0', 'GET', null, tokA);
const feedAuthor = r.json.posts[0]?.author;
assert(feedAuthor && feedAuthor.profile_photo_url === photoUrl, 'T8 PostCard author photo matches profile');

console.log('DONE');

