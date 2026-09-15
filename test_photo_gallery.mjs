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

async function uploadMultipart(path, fileBuffer, filename, fieldname, token) {
  const boundary = '----formdata' + Date.now();
  const bodyBuf = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="${fieldname}"; filename="${filename}"\r\n`),
    Buffer.from(`Content-Type: image/jpeg\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return new Promise((resolve) => {
    const req = http.request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
        'Authorization': `Bearer ${token}`,
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
}

const userA = `gphtesta${stamp}`;
const userB = `gphtestb${stamp}`;
const testPass = 'Password123!';

const galleryResults = {};

async function runTests() {
  let pass = 0, fail = 0;
  const assert = (cond, label) => {
    if (cond) { pass++; console.log('  PASS:', label); }
    else { fail++; console.log('  FAIL:', label); }
    galleryResults[label] = cond;
  };

  console.log('=== PHOTO GALLERY TESTS ===');

  // Setup users
  console.log('\n--- Setup: Create users ---');
  const regA = await api('/api/auth/register', 'POST', {
    email: `${userA}@test.com`, username: userA, password: testPass
  });
  assert(regA.status === 201 && regA.body.access_token, 'User A registration');
  const tokenA = regA.body.access_token;

  const regB = await api('/api/auth/register', 'POST', {
    email: `${userB}@test.com`, username: userB, password: testPass
  });
  assert(regB.status === 201 && regB.body.access_token, 'User B registration');
  const tokenB = regB.body.access_token;

  // Setup profiles with names
  await api('/api/profile', 'PATCH', {
    first_name: 'Alice', last_name: 'Anderson',
    country: 'Philippines', city: 'Marikina', barangay: 'Parang'
  }, tokenA);

  await api('/api/profile', 'PATCH', {
    first_name: 'Bob', last_name: 'Brown',
    country: 'Philippines', city: 'Marikina', barangay: 'Parang'
  }, tokenB);

  // Generate test images using sharp
  const { default: sharp } = await import('sharp');
  
  const createTestImage = async (width, height, color) => {
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="${color}"/></svg>`;
    return await sharp(Buffer.from(svg), { density: 72 })
      .resize({ width, height, fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();
  };

  const img1 = await createTestImage(800, 600, '#ff6f4f'); // landscape
  const img2 = await createTestImage(600, 800, '#0e6e6e'); // portrait
  const img3 = await createTestImage(600, 600, '#7b5aa6'); // square

  console.log('\n--- TEST 1: Empty gallery ---');
  const emptyGallery = await api(`/api/profiles/${userB}/photos`);
  assert(
    emptyGallery.status === 200 &&
    Array.isArray(emptyGallery.body.photos) &&
    emptyGallery.body.photos.length === 0,
    'Profile B has zero photos initially'
  );

  console.log('\n--- TEST 2: Authenticated upload ---');
  const upload1 = await uploadMultipart('/api/profile/photos', img1, 'photo1.jpg', 'photo', tokenA);
  assert(
    upload1.status === 201 && upload1.body.photo && upload1.body.photo.id,
    'Photo upload successful'
  );
  assert(
    upload1.body.photo.image_url && upload1.body.photo.thumbnail_url,
    'Photo has image_url and thumbnail_url'
  );
  assert(
    upload1.body.photo.image_url.includes('/uploads/gallery/'),
    'Image URL points to gallery uploads'
  );
  assert(
    upload1.body.photo.thumbnail_url.includes('/uploads/gallery/thumbnails/'),
    'Thumbnail URL points to thumbnails'
  );

  const photoId1 = upload1.body.photo.id;

  console.log('\n--- TEST 3: Photo appears in public gallery ---');
  const publicGallery = await api(`/api/profiles/${userA}/photos`);
  assert(
    publicGallery.status === 200 && publicGallery.body.photos.length === 1,
    'Photo appears in public gallery'
  );
  assert(
    publicGallery.body.photos[0].id === photoId1,
    'Correct photo ID in gallery'
  );
  assert(
    !!publicGallery.body.photos[0].created_at,
    'Photo has created_at timestamp'
  );

  console.log('\n--- TEST 4: Photo persists after refresh ---');
  await new Promise(r => setTimeout(r, 100));
  const persisted = await api(`/api/profiles/${userA}/photos`);
  assert(
    persisted.status === 200 && persisted.body.photos.length === 1 &&
    persisted.body.photos[0].id === photoId1,
    'Photo persists after refresh'
  );

  console.log('\n--- TEST 5: Thumbnail generation ---');
  const thumbRes = await new Promise((resolve) => {
    const req = http.request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path: persisted.body.photos[0].thumbnail_url,
      method: 'GET',
    }, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
  assert(
    thumbRes.status === 200 && thumbRes.headers['content-type']?.includes('image/'),
    'Thumbnail is accessible and is an image'
  );

  const origRes = await new Promise((resolve) => {
    const req = http.request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path: persisted.body.photos[0].image_url,
      method: 'GET',
    }, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
  assert(
    origRes.status === 200 && origRes.headers['content-type']?.includes('image/'),
    'Original image is accessible and is an image'
  );

  console.log('\n--- TEST 6: Multiple photos ---');
  const upload2 = await uploadMultipart('/api/profile/photos', img2, 'photo2.jpg', 'photo', tokenA);
  assert(upload2.status === 201 && upload2.body.photo, 'Second photo upload');

  const upload3 = await uploadMultipart('/api/profile/photos', img3, 'photo3.jpg', 'photo', tokenA);
  assert(upload3.status === 201 && upload3.body.photo, 'Third photo upload');

  const multiGallery = await api(`/api/profiles/${userA}/photos`);
  assert(
    multiGallery.status === 200 && multiGallery.body.photos.length === 3,
    'All three photos appear in gallery'
  );

  console.log('\n--- TEST 7: Unauthorized upload rejected ---');
  const unauthUpload = await uploadMultipart('/api/profile/photos', img1, 'photo.jpg', 'photo', null);
  assert(unauthUpload.status === 401, 'Unauthenticated upload rejected (401)');

  console.log('\n--- TEST 8: User B cannot upload to User A profile ---');
  // Note: The API is /api/profile/photos which uses authenticated user's own profile
  // So this test verifies User B can only upload to their own profile
  const uploadB = await uploadMultipart('/api/profile/photos', img1, 'photob.jpg', 'photo', tokenB);
  assert(uploadB.status === 201 && uploadB.body.photo, 'User B can upload to own profile');
  
  const galleryB = await api(`/api/profiles/${userB}/photos`);
  assert(
    galleryB.body.photos.length === 1 && galleryB.body.photos[0].id === uploadB.body.photo.id,
    'User B photo appears in User B gallery only'
  );

  console.log('\n--- TEST 9: Owner can delete own photo ---');
  const photoToDelete = multiGallery.body.photos[0]; // Most recent
  const deleteRes = await api(`/api/profile/photos/${photoToDelete.id}`, 'DELETE', null, tokenA);
  assert(deleteRes.status === 200, 'Owner can delete own photo');

  const afterDelete = await api(`/api/profiles/${userA}/photos`);
  assert(
    afterDelete.body.photos.length === 2 &&
    !afterDelete.body.photos.find(p => p.id === photoToDelete.id),
    'Deleted photo removed from gallery'
  );

  console.log('\n--- TEST 10: Non-owner cannot delete ---');
  const photoB = galleryB.body.photos[0];
  const unauthDelete = await api(`/api/profile/photos/${photoB.id}`, 'DELETE', null, tokenA);
  assert(unauthDelete.status === 403, 'Non-owner delete rejected (403)');

  const galleryBAfter = await api(`/api/profiles/${userB}/photos`);
  assert(
    galleryBAfter.body.photos.length === 1 && galleryBAfter.body.photos[0].id === photoB.id,
    'Photo B still exists after unauthorized delete attempt'
  );

  console.log('\n--- TEST 11: Invalid file rejected ---');
  const invalidFile = Buffer.from('not an image');
  const invalidUpload = await uploadMultipart('/api/profile/photos', invalidFile, 'test.txt', 'photo', tokenA);
  assert(invalidUpload.status === 422, 'Invalid file rejected (422)');

  console.log('\n--- TEST 12: Oversized file rejected ---');
  const largeFile = Buffer.alloc(6 * 1024 * 1024, 'x'); // 6MB > 5MB limit
  const largeUpload = await uploadMultipart('/api/profile/photos', largeFile, 'large.jpg', 'photo', tokenA);
  assert(largeUpload.status === 422, 'Oversized file rejected (422)');

  console.log('\n=== FINAL SUMMARY ===');
  console.log('\nGallery:');
  Object.entries(galleryResults).forEach(([k, v]) => console.log(`  ${v ? 'PASS' : 'FAIL'}: ${k}`));

  console.log(`\n=== RESULTS: ${pass} PASS, ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });