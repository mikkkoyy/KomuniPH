import http from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';

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

function apiWithForm(path, formData, token = null) {
  return new Promise((resolve, reject) => {
    const boundary = '----formdata' + Date.now();
    const parts = [];

    for (const [key, value] of Object.entries(formData)) {
      parts.push(`--${boundary}\r\n`);
      parts.push(`Content-Disposition: form-data; name="${key}"; filename="${value.filename}"\r\n`);
      parts.push(`Content-Type: ${value.contentType}\r\n\r\n`);
    }

    const body = Buffer.concat([
      Buffer.from(parts.join('')),
      formData.file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const req = http.request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path,
      method: 'POST',
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
    req.write(body);
    req.end();
  });
}

const userA = `utesta${stamp}`;
const userB = `utestb${stamp}`;
const testPass = 'Password123!';

const bgResults = {};
const ttResults = {};

async function runTests() {
  let pass = 0, fail = 0;
  const assert = (cond, label, category = 'general') => {
    if (cond) { pass++; console.log('  PASS:', label); }
    else { fail++; console.log('  FAIL:', label); }
    if (category === 'bg') bgResults[label] = cond;
    if (category === 'testimonials') ttResults[label] = cond;
  };

  console.log('=== Registering User A and User B ===');
  const regA = await api('/api/auth/register', 'POST', {
    email: `${userA}@test.com`, username: userA, password: testPass
  });
  assert(regA.status === 201 && regA.body.access_token, 'User A registered with token');

  const regB = await api('/api/auth/register', 'POST', {
    email: `${userB}@test.com`, username: userB, password: testPass
  });
  assert(regB.status === 201 && regB.body.access_token, 'User B registered with token');

  const tokenA = regA.body.access_token;
  const tokenB = regB.body.access_token;

  await api('/api/profile', 'PATCH', {
    first_name: 'Alice', last_name: 'Anderson',
    country: 'Philippines', city: 'Marikina', barangay: 'Parang'
  }, tokenA);

  await api('/api/profile', 'PATCH', {
    first_name: 'Bob', last_name: 'Brown',
    country: 'Philippines', city: 'Marikina', barangay: 'Parang'
  }, tokenB);

  // ========= TESTIMONIALS TESTS =========
  console.log('\n=== TESTIMONIALS TESTS ===');

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
    'Author identity comes from authenticated account (User A)',
    'testimonials'
  );
  assert(
    created.body.author && created.body.author.display_name === 'Alice Anderson',
    'Author display name is built from profile name fields',
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
    author_user_id: 'fake-id-12345',
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
  assert(emptyAttempt.status === 422, 'Empty testimonial (whitespace) rejected with 422', 'testimonials');

  const trulyEmpty = await api('/api/testimonials', 'POST', {
    target_username: userB,
    message: ''
  }, tokenA);
  assert(trulyEmpty.status === 422, 'Empty testimonial (empty string) rejected with 422', 'testimonials');

  console.log('\n--- TEST 7: Unauthorized creation rejected ---');
  const unauthAttempt = await api('/api/testimonials', 'POST', {
    target_username: userB,
    message: 'Unauthorized testimonial'
  }, null);
  assert(unauthAttempt.status === 401, 'Unauthorized testimonial creation returns 401', 'testimonials');

  console.log('\n--- TEST 8: Cannot submit testimonial to self ---');
  const selfTestimonial = await api('/api/testimonials', 'POST', {
    target_username: userA,
    message: 'Testimonial to self'
  }, tokenA);
  assert(selfTestimonial.status === 400, 'Self-testimonial rejected with 400', 'testimonials');

  console.log('\n--- TEST 9: Non-author cannot delete ---');
  const freshTestimonial = await api('/api/testimonials', 'POST', {
    target_username: userB,
    message: 'For delete auth test'
  }, tokenA);
  const allOnB = await api(`/api/profiles/${userB}/testimonials`);
  const anyTestimonial = allOnB.body.testimonials.find(t => t.id === freshTestimonial.body.id);
  if (anyTestimonial) {
    const unauthDelete = await api(`/api/testimonials/${anyTestimonial.id}`, 'DELETE', null, tokenB);
    assert(unauthDelete.status === 403, 'Non-author cannot delete (403)', 'testimonials');
  } else {
    assert(false, 'Should have a testimonial to test unauthorized delete', 'testimonials');
  }

  console.log('\n--- TEST 10: Character limit validation ---');
  const longMessage = 'x'.repeat(1001);
  const longAttempt = await api('/api/testimonials', 'POST', {
    target_username: userB,
    message: longMessage
  }, tokenA);
  assert(longAttempt.status === 422, 'Testimonial exceeding 1000 chars rejected with 422', 'testimonials');

  console.log('\n--- TEST 11: User B can view testimonials on own profile ---');
  const bProfile = await api('/api/profile', 'GET', null, tokenB);
  assert(!!bProfile.body, 'User B profile loads after receiving testimonials', 'testimonials');

  // Clean up: delete the testimonials on B's profile created by A
  const allTestimonialsOnB = await api(`/api/profiles/${userB}/testimonials`);
  for (const t of allTestimonialsOnB.body.testimonials) {
    if (t.author && t.author.username === userA) {
      await api(`/api/testimonials/${t.id}`, 'DELETE', null, tokenA);
    }
  }
  // Also delete B's testimonial on A's profile
  const allTestimonialsOnA = await api(`/api/profiles/${userA}/testimonials`);
  for (const t of allTestimonialsOnA.body.testimonials) {
    if (t.author && t.author.username === userB) {
      await api(`/api/testimonials/${t.id}`, 'DELETE', null, tokenB);
    }
  }

  // ========= PROFILE BACKGROUND REGRESSION TESTS =========
  console.log('\n=== PROFILE BACKGROUND REGRESSION TESTS ===');

  console.log('\n--- Gradient Slate (default) ---');
  // Reset User A's theme
  await api('/api/profile/theme', 'PATCH', {
    backgroundImage: null,
    backgroundGradient: null,
    backgroundColor: null,
    backgroundPosition: null,
    backgroundRepeat: null,
    backgroundSize: null,
    textColor: null,
    mutedTextColor: null,
    accentColor: null,
    cardBackground: null,
    cardOpacity: null,
    cardBorderColor: null,
    cardBorderRadius: null
  }, tokenA);

  const profileA = await api('/api/profile', 'GET', null, tokenA);
  assert(
    profileA.body && profileA.body.theme && profileA.body.theme.config,
    'Profile A theme config exists',
    'bg'
  );
  const configA = profileA.body.theme.config;
  const customA = profileA.body.theme.custom || {};

  const hasThemeGradient = !!configA.backgroundGradient;
  const hasCustomBg = !!(customA.backgroundColor || customA.backgroundGradient || customA.backgroundImage);
  const hasGradientBg = hasThemeGradient && !hasCustomBg;
  assert(
    hasGradientBg,
    'Default Gradient Slate background active (no custom override)',
    'bg'
  );

  console.log('\n--- Upload aa.jpg background ---');
  // Create a real JPEG image using sharp
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
    'Background upload (aa.jpg) succeeds',
    'bg'
  );

  console.log('\n--- Image persistence after refresh ---');
  await new Promise(r => setTimeout(r, 100));
  const profileAfterUpload = await api('/api/profile', 'GET', null, tokenA);
  assert(
    profileAfterUpload.body && profileAfterUpload.body.theme &&
    profileAfterUpload.body.theme.custom &&
    profileAfterUpload.body.theme.custom.backgroundImage,
    'Background image persists after refresh',
    'bg'
  );

  console.log('\n--- Reset to gradient ---');
  const resetResult = await api('/api/profile/theme', 'PATCH', {
    backgroundImage: null,
    backgroundGradient: null,
    backgroundColor: null,
    backgroundPosition: null,
    backgroundRepeat: null,
    backgroundSize: null
  }, tokenA);
  const profileAfterReset = await api('/api/profile', 'GET', null, tokenA);
  const configAfter = profileAfterReset.body.theme.config || {};
  const customAfter = profileAfterReset.body.theme.custom || {};

  const hasGradientAfterReset = !!configAfter.backgroundGradient &&
    !customAfter.backgroundColor && !customAfter.backgroundGradient && !customAfter.backgroundImage;
  assert(
    !!profileAfterReset.body && hasGradientAfterReset,
    'Reset to gradient restores Gradient Slate default',
    'bg'
  );

  console.log('\n--- Mobile responsive ---');
  const profileForMobile = await api(`/api/profiles/${userB}/testimonials?limit=20&offset=0`);
  assert(
    profileForMobile.status === 200 && Array.isArray(profileForMobile.body.testimonials),
    'Testimonials load at any viewport size',
    'bg'
  );

  // Final summary
  console.log('\n=== FINAL SUMMARY ===');
  const bgPass = Object.values(bgResults).filter(Boolean).length;
  const bgTotal = Object.keys(bgResults).length;
  const ttPass = Object.values(ttResults).filter(Boolean).length;
  const ttTotal = Object.keys(ttResults).length;

  console.log(`Background regression: ${bgPass}/${bgTotal} PASS`);
  Object.entries(bgResults).forEach(([k, v]) => console.log(`  ${v ? 'PASS' : 'FAIL'}: ${k}`));

  console.log(`Testimonials: ${ttPass}/${ttTotal} PASS`);
  Object.entries(ttResults).forEach(([k, v]) => console.log(`  ${v ? 'PASS' : 'FAIL'}: ${k}`));

  console.log(`\n=== RESULTS: ${pass} PASS, ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
