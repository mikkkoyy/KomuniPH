/**
 * FEED-06A verification script — exercises the exact flow the profile UI uses:
 * FormData multipart POST /api/profile/photo with Bearer token.
 * Also validates content-authoritative MIME handling.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

const BASE = 'http://localhost:3000';
const TMP = '.tmp-test';
const UPLOADS = 'uploads/profile';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error('login failed: ' + JSON.stringify(json));
  return json.access_token;
}

async function upload(tok, filePath, fileName, mimeType, field = 'photo') {
  const blob = new Blob([readFileSync(filePath)], { type: mimeType });
  const fd = new FormData();
  fd.append(field, blob, fileName);
  const res = await fetch(`${BASE}/api/profile/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
    body: fd,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function getProfile(tok) {
  const res = await fetch(`${BASE}/api/profile`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  return res.json();
}

// Read the DB reference through the HTTP API exactly as the UI does
async function apiPhotoUrl(tok) {
  const profile = await getProfile(tok);
  return profile.profile_photo_url || null;
}

function fileList() {
  return readdirSync(UPLOADS).filter((f) => !f.startsWith('.write-probe'));
}

// Verify output via HTTP (same transport the browser uses), avoiding file
// handle locks on Windows. Returns { width, height, format }.
async function webpMeta(photoUrl, tok = null) {
  const url = photoUrl.startsWith('http')
    ? photoUrl
    : `${BASE}${photoUrl}`;
  const res = await fetch(url, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
  if (res.status !== 200) throw new Error(`fetch ${photoUrl} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { format, width, height } = await sharp(buf).metadata();
  return { format, width, height };
}

const beforeFiles = new Set(fileList());

async function main() {
  const tok = await login('feed06repro@test.com', 'Password123!');
  const profile = await getProfile(tok);
  const userId = profile.user_id;
  const originalPhoto = profile.profile_photo_url;
  console.log('user:', profile.username, '| initial photo:', originalPhoto);
  console.log('---');

  // TEST 1 — JPEG (1200x800)
  let r = await upload(tok, `${TMP}/test-big.jpg`, 'photo-real.jpg', 'image/jpeg');
  check('TEST1 JPEG upload 200', r.status === 200, JSON.stringify(r.json));
  let photoUrl = r.json?.profile_photo_url;
  check('TEST1 photo URL returned', !!photoUrl, photoUrl);
  let d = await webpMeta(photoUrl);
  check('TEST1 output is webp', d.format === 'webp', d.format);
  check('TEST1 dims <=1024', d.width <= 1024 && d.height <= 1024, `${d.width}x${d.height}`);
  check('TEST1 aspect ratio kept', Math.abs(d.width / d.height - 1200 / 800) < 0.01, `${d.width}x${d.height} vs 3:2`);

  // TEST 2 — PNG (2000x1200)
  r = await upload(tok, `${TMP}/test-big-png.png`, 'photo.png', 'image/png');
  check('TEST2 PNG upload 200', r.status === 200, JSON.stringify(r.json));
  photoUrl = r.json?.profile_photo_url;
  d = await webpMeta(photoUrl);
  check('TEST2 PNG -> webp + dims <=1024', d.format === 'webp' && d.width <= 1024 && d.height <= 1024, `${d.format} ${d.width}x${d.height}`);
  check('TEST2 PNG aspect ratio', Math.abs(d.width / d.height - 2000 / 1200) < 0.01, `${d.width}x${d.height} vs 5:3`);

  // TEST 3 — WebP (500x500)
  r = await upload(tok, `${TMP}/test.webp`, 'photo.webp', 'image/webp');
  check('TEST3 WebP upload 200', r.status === 200, JSON.stringify(r.json));
  photoUrl = r.json?.profile_photo_url;
  d = await webpMeta(photoUrl);
  check('TEST3 webp processed, dims <=1024', d.format === 'webp' && d.width <= 1024 && d.height <= 1024, `${d.format} ${d.width}x${d.height}`);

  // TEST 4 — Small image (600x400) must NOT be upscaled
  r = await upload(tok, `${TMP}/test-small.png`, 'small.png', 'image/png');
  check('TEST4 small PNG upload 200', r.status === 200, JSON.stringify(r.json));
  photoUrl = r.json?.profile_photo_url;
  const smallName = photoUrl.split('/').pop();
  d = await webpMeta(photoUrl);
  check('TEST4 NO upscale (600x400 kept)', d.width === 600 && d.height === 400, `${d.width}x${d.height}`);

  // TEST 5 — Replacement: new upload replaces and deletes old file
  const photoBeforeReplace = photoUrl;
  const smallFilePath = join(UPLOADS, smallName);
  r = await upload(tok, `${TMP}/test-big.jpg`, 'replacement.jpg', 'image/jpeg');
  check('TEST5 replacement upload 200', r.status === 200, JSON.stringify(r.json));
  const replacedUrl = r.json?.profile_photo_url;
  check('TEST5 new URL differs from old', replacedUrl !== photoBeforeReplace, `${photoBeforeReplace} -> ${replacedUrl}`);
  const dbUrlAfter = await apiPhotoUrl(tok);
  check('TEST5 DB updated to new URL', dbUrlAfter === replacedUrl, dbUrlAfter);
  const smallGone = !existsSync(smallFilePath);
  check('TEST5 old file deleted after commit', smallGone, smallFilePath);
  const repName = replacedUrl.split('/').pop();
  d = await webpMeta(replacedUrl);
  check('TEST5 new webp valid', d.format === 'webp' && d.width === 1024 && d.height === 683, `${repName} ${d.width}x${d.height}`);

  // TEST 6 — Invalid file must be rejected safely; existing photo intact
  r = await upload(tok, `${TMP}/test-invalid.txt`, 'fake.jpg', 'text/plain');
  check('TEST6 invalid file rejected', r.status === 422, `status=${r.status} body=${JSON.stringify(r.json)}`);
  const dbAfterInvalid = await apiPhotoUrl(tok);
  check('TEST6 DB unchanged after invalid', dbAfterInvalid === replacedUrl, dbAfterInvalid);
  check('TEST6 existing photo intact', existsSync(join(UPLOADS, repName)), repName);
  const photoFetch = await fetch(`${BASE}${replacedUrl}`);
  check('TEST6 profile photo serves via HTTP', photoFetch.status === 200, `status=${photoFetch.status}`);

  await secondHalf(tok, userId, repName, replacedUrl);
}
async function secondHalf(tok, userId, repName, replacedUrl) {
  // TEST 7 — Content-authoritative MIME: valid JPEG sent with harmless-but-unexpected MIME
  let r = await upload(tok, `${TMP}/test-big.jpg`, 'photo.jpg', 'application/octet-stream');
  check('TEST7 valid JPEG + octet-stream MIME accepted', r.status === 200, `status=${r.status}`);
  let photoUrl = r.json?.profile_photo_url;
  const flexName = photoUrl.split('/').pop();
  let d = await webpMeta(photoUrl);
  check('TEST7 processed correctly', d.format === 'webp', `${d.format} ${d.width}x${d.height}`);

  // TEST 8 — File without a usable extension (drag-drop style) must still work
  r = await upload(tok, `${TMP}/test-small.png`, 'dragdrop', 'image/png');
  check('TEST8 extension-less filename accepted', r.status === 200, `status=${r.status}`);
  photoUrl = r.json?.profile_photo_url;
  d = await webpMeta(photoUrl);
  check('TEST8 processed correctly', d.format === 'webp' && d.width === 600, `${d.format} ${d.width}x${d.height}`);

  // TEST 9 — Empty buffer must be rejected safely with the canonical process error
  const fdEmpty = new FormData();
  fdEmpty.append('photo', new Blob([Buffer.alloc(0)], { type: 'image/jpeg' }), 'empty.jpg');
  const resEmpty = await fetch(`${BASE}/api/profile/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
    body: fdEmpty,
  });
  let jsonEmpty = null;
  try { jsonEmpty = await resEmpty.json(); } catch { /* noop */ }
  check('TEST9 empty file rejected', resEmpty.status === 422, `status=${resEmpty.status} body=${JSON.stringify(jsonEmpty)}`);
  check('TEST9 DB unchanged after empty', await apiPhotoUrl(tok) === photoUrl, await apiPhotoUrl(tok));

  // TEST 10 — Legacy corrupt reference can be replaced safely (testfeed06)
  let rTok2 = null;
  try {
    rTok2 = await login('testfeed06@test.com', 'Password123!');
  } catch {
    console.log('SKIP | TEST10 testfeed06 login failed (password unknown)');
  }
  if (rTok2) {
    const prof2 = await getProfile(rTok2);
    const legacyUrl = prof2.profile_photo_url;
    console.log('TEST10 testfeed06 legacy photo:', legacyUrl);
    const r10 = await upload(rTok2, `${TMP}/test-big.jpg`, 'fix-legacy.jpg', 'image/jpeg');
    check('TEST10 replacement of corrupt legacy photo 200', r10.status === 200, JSON.stringify(r10.json));
    const legacyReplaced = r10.json?.profile_photo_url;
    check('TEST10 DB updated', await apiPhotoUrl(rTok2) === legacyReplaced, legacyReplaced);
    if (legacyUrl && legacyUrl.startsWith('/uploads/profile/')) {
      const legacyFile = legacyUrl.split('/').pop();
      check('TEST10 corrupt old file cleaned up', !existsSync(join(UPLOADS, legacyFile)), legacyFile);
    }
  }

  console.log('---');
  console.log('SUMMARY:');
  let allPass = true;
  for (const res of results) {
    if (!res.pass) allPass = false;
  }
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  return allPass ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error('SCRIPT ERROR:', e); process.exit(2); });