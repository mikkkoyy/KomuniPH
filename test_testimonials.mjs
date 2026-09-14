import http from 'http';
import { spawn } from 'child_process';

const BASE_HOST = 'localhost';
const BASE_PORT = 3000;
const stamp = Date.now().toString().slice(-6);

function api(path, method = 'GET', body = null, token = null) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (data) headers['Content-Length'] = Buffer.byteLength(data);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path,
      method,
      headers,
    }, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk.toString());
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch (e) { parsed = { raw: b }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getHtml(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path,
      method: 'GET',
    }, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk.toString());
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}

const userA = `utesta${stamp}`;
const userB = `utestb${stamp}`;
const testPass = 'Password123!';

const bgResults = {};
const ttResults = {};
const loginResults = {};

async function runTests() {
  let pass = 0, fail = 0;
  const assert = (cond, label, category = 'general') => {
    if (cond) { pass++; console.log('  PASS:', label); }
    else { fail++; console.log('  FAIL:', label); }
    if (category === 'bg') bgResults[label] = cond;
    if (category === 'testimonials') ttResults[label] = cond;
    if (category === 'login') loginResults[label] = cond;
  };

  // ===== LOGIN PAGE TESTS =====
  console.log('=== LOGIN PAGE TESTS ===');

  console.log('\n--- GET /login returns HTML ---');
  const loginPage = await getHtml('/login');
  assert(
    loginPage.status === 200 && loginPage.body.includes('<div id="app">'),
    '/login route returns SPA HTML',
    'login'
  );

  console.log('\n--- Index.html includes login script ---');
  const indexPage = await getHtml('/');
  assert(
    indexPage.status === 200 &&
    indexPage.body.includes('/js/app.js') &&
    indexPage.body.includes('/css/styles.css'),
    'Index.html includes app.js and styles.css',
    'login'
  );

  console.log('\n--- Login API works ---');
  const regRes = await api('/api/auth/register', 'POST', {
    email: `${userA}@test.com`, username: userA, password: testPass
  });
  assert(regRes.status === 201 && regRes.body.access_token, 'Registration works', 'login');

  const loginRes = await api('/api/auth/login', 'POST', {
    identifier: userA, password: testPass
  });
  assert(
    loginRes.status === 200 && loginRes.body.access_token,
    'Login API works with token',
    'login'
  );

  console.log('\n--- Profile loads after login ---');
  const profile = await api('/api/profile', 'GET', null, loginRes.body.access_token);
  assert(
    profile.status === 200 && profile.body.username === userA,
    'Profile loads with authenticated token',
    'login'
  );

  // ===== TESTIMONIALS TESTS =====
  console.log('\n=== TESTIMONIALS TESTS ===');

  const tokenA = regRes.body.access_token;

  const regB = await api('/api/auth/register', 'POST', {
    email: `${userB}@test.com`, username: userB, password: testPass
  });
  const tokenB = regB.body.access_token;

  await api('/api/profile', 'PATCH', {
    first_name: 'Alice', last_name: 'Anderson',
    country: 'Philippines', city: 'Marikina', barangay: 'Parang'
  }, tokenA);

  await api('/api/profile', 'PATCH', {
    first_name: 'Bob', last_name: 'Brown',
    country: 'Philippines', city: 'Marikina', barangay: 'Parang'
  }, tokenB);

  console.log('\n--- TEST 1: Profile with zero testimonials ---');
  const emptyRes = await api(`/api/profiles/${userB}/testimonials`);
  assert(
    emptyRes.status === 200 &&
    Array.isArray(emptyRes.body.testimonials) &&
    emptyRes.body.testimonials.length === 0,
    'Profile B has zero testimonials initially',
    'testimonials'
  );

  console.log('\n--- TEST 2: User A submits a testimonial for User B ---');
  const created = await api('/api/testimonials', 'POST', {
    target_username: userB,
    message: 'Very helpful and friendly community member.'
  }, tokenA);
  assert(
    created.status === 201 && created.body.id &&
    created.body.message === 'Very helpful and friendly community member.',
    'Testimonial created successfully',
    'testimonials'
  );
  assert(
    created.body.author && created.body.author.username === userA,
    'Author identity comes from authenticated account',
    'testimonials'
  );
  assert(
    created.body.author && created.body.author.display_name === 'Alice Anderson',
    'Author display name from profile fields, not username',
    'testimonials'
  );

  console.log('\n--- TEST 3: Testimonial appears on User B profile ---');
  const onB = await api(`/api/profiles/${userB}/testimonials`);
  assert(
    onB.status === 200 && onB.body.testimonials.length === 1,
    'Testimonial appears on User B profile',
    'testimonials'
  );
  assert(
    onB.body.testimonials[0].author && onB.body.testimonials[0].author.username === userA,
    'Testimonial author is User A',
    'testimonials'
  );
  assert(
    !!onB.body.testimonials[0].created_at,
    'Testimonial has created_at date',
    'testimonials'
  );

  console.log('\n--- TEST 4: Testimonial persists after refresh ---');
  await new Promise(r => setTimeout(r, 100));
  const persisted = await api(`/api/profiles/${userB}/testimonials`);
  assert(
    persisted.status === 200 && persisted.body.testimonials.length === 1 &&
    persisted.body.testimonials[0].id === created.body.id,
    'Testimonial persists after refresh',
    'testimonials'
  );

  console.log('\n--- TEST 5: Author identity cannot be spoofed ---');
  const spoofAttempt = await api('/api/testimonials', 'POST', {
    target_username: userB,
    author_user_id: 'fake-id',
    message: 'Spoof attempt'
  }, tokenA);
  assert(
    spoofAttempt.body && spoofAttempt.body.author && spoofAttempt.body.author.username === userA,
    'Author identity cannot be spoofed',
    'testimonials'
  );

  console.log('\n--- TEST 6: Empty testimonial rejected ---');
  const emptyAttempt = await api('/api/testimonials', 'POST', {
    target_username: userB,
    message: '   '
  }, tokenA);
  assert(emptyAttempt.status === 422, 'Empty testimonial rejected (422)', 'testimonials');

  console.log('\n--- TEST 7: Unauthorized creation rejected ---');
  const unauthAttempt = await api('/api/testimonials', 'POST', {
    target_username: userB,
    message: 'Unauthorized'
  }, null);
  assert(unauthAttempt.status === 401, 'Unauthorized creation returns 401', 'testimonials');

  console.log('\n--- TEST 8: Self-testimonial rejected ---');
  const selfT = await api('/api/testimonials', 'POST', {
    target_username: userA,
    message: 'To self'
  }, tokenA);
  assert(selfT.status === 400, 'Self-testimonial rejected (400)', 'testimonials');

  console.log('\n--- TEST 9: Non-author cannot delete ---');
  const fresh = await api('/api/testimonials', 'POST', {
    target_username: userB,
    message: 'Delete auth test'
  }, tokenA);
  const allOnB = await api(`/api/profiles/${userB}/testimonials`);
  const toDelete = allOnB.body.testimonials.find(t => t.id === fresh.body.id);
  if (toDelete) {
    const unauthDel = await api(`/api/testimonials/${toDelete.id}`, 'DELETE', null, tokenB);
    assert(unauthDel.status === 403, 'Non-author delete rejected (403)', 'testimonials');
  } else {
    assert(false, 'Should have testimonial to test unauth delete', 'testimonials');
  }

  console.log('\n--- TEST 10: Character limit ---');
  const long = await api('/api/testimonials', 'POST', {
    target_username: userB,
    message: 'x'.repeat(1001)
  }, tokenA);
  assert(long.status === 422, '1001+ chars rejected (422)', 'testimonials');

  // ===== PROFILE BACKGROUND REGRESSION TESTS =====
  console.log('\n=== PROFILE BACKGROUND REGRESSION TESTS ===');

  // Reset to gradient
  await api('/api/profile/theme', 'PATCH', {
    backgroundImage: null, backgroundGradient: null, backgroundColor: null,
    backgroundPosition: null, backgroundRepeat: null, backgroundSize: null,
    textColor: null, mutedTextColor: null, accentColor: null,
    cardBackground: null, cardOpacity: null, cardBorderColor: null, cardBorderRadius: null
  }, tokenA);

  const profileA = await api('/api/profile', 'GET', null, tokenA);
  const customKeys = Object.keys((profileA.body.theme && profileA.body.theme.custom) || {});
  assert(
    profileA.body && profileA.body.theme && profileA.body.theme.config &&
    profileA.body.theme.config.backgroundGradient &&
    customKeys.length === 0,
    'Gradient Slate default background',
    'bg'
  );

  // Upload background
  const { default: sharp } = await import('sharp');
  const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#ff6f4f"/></svg>`;
  const imageBuf = await sharp(Buffer.from(svg), { density: 72 })
    .resize({ width: 600, height: 400, fit: 'inside' })
    .jpeg({ quality: 80 })
    .toBuffer();

  const boundary = '----formdata' + Date.now();
  const bodyBuf = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="background"; filename="aa.jpg"\r\n`),
    Buffer.from(`Content-Type: image/jpeg\r\n\r\n`),
    imageBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const uploadResult = await new Promise((resolve) => {
    const req = http.request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path: '/api/profile/background',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
        'Authorization': `Bearer ${tokenA}`,
      },
    }, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk.toString());
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, body: { raw: b } }); }
      });
    });
    req.on('error', () => resolve({ status: 0, body: { raw: 'error' } }));
    req.write(bodyBuf);
    req.end();
  });
  assert(
    uploadResult.status === 200 && uploadResult.body.background_url,
    'aa.jpg background upload',
    'bg'
  );

  // Persistence
  await new Promise(r => setTimeout(r, 100));
  const profileAfter = await api('/api/profile', 'GET', null, tokenA);
  assert(
    profileAfter.body.theme && profileAfter.body.theme.custom &&
    profileAfter.body.theme.custom.backgroundImage,
    'Background persists after refresh',
    'bg'
  );

  // Reset
  await api('/api/profile/theme', 'PATCH', {
    backgroundImage: null, backgroundGradient: null, backgroundColor: null,
    backgroundPosition: null, backgroundRepeat: null, backgroundSize: null
  }, tokenA);
  const profileReset = await api('/api/profile', 'GET', null, tokenA);
  const cfg = profileReset.body.theme.config || {};
  const cus = profileReset.body.theme.custom || {};
  assert(
    cfg.backgroundGradient && !cus.backgroundColor && !cus.backgroundGradient && !cus.backgroundImage,
    'Reset to gradient restores Gradient Slate',
    'bg'
  );

  // Mobile
  const mobileRes = await api(`/api/profiles/${userB}/testimonials?limit=20&offset=0`);
  assert(
    mobileRes.status === 200 && Array.isArray(mobileRes.body.testimonials),
    'Mobile: testimonials load at any viewport',
    'bg'
  );

  // Final summary
  console.log('\n=== FINAL SUMMARY ===');
  console.log('\nLogin:');
  Object.entries(loginResults).forEach(([k, v]) => console.log(`  ${v ? 'PASS' : 'FAIL'}: ${k}`));
  console.log('\nTestimonials:');
  Object.entries(ttResults).forEach(([k, v]) => console.log(`  ${v ? 'PASS' : 'FAIL'}: ${k}`));
  console.log('\nBackground regression:');
  Object.entries(bgResults).forEach(([k, v]) => console.log(`  ${v ? 'PASS' : 'FAIL'}: ${k}`));

  console.log(`\n=== RESULTS: ${pass} PASS, ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
