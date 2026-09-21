/**
 * KomuniPH COMMUNITY-05 — focused Community post composer test.
 *
 * Requires a running server on localhost:3000. Registers fresh throwaway
 * accounts at a real, currently unused barangay, exercises ONLY the composer
 * features (text, photo, video, mentions, location, feeling, association,
 * authorization, invalid media), then removes every row and uploaded media
 * file it created so re-runs start from a clean slate.
 */

import http from 'http';
import { unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../server/database.js';
import { getAllLocations } from '../server/locations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_HOST = 'localhost';
const BASE_PORT = 3000;
const stamp = Date.now().toString().slice(-6);
const P = 'Password123!';

const api = (path, method = 'GET', body = null, token = null) => {
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (data) headers['Content-Length'] = Buffer.byteLength(data);
  return new Promise((resolveP, rejectP) => {
    const req = http.request({ hostname: BASE_HOST, port: BASE_PORT, path, method, headers }, (res) => {
      let b = '';
      res.on('data', (chunk) => (b += chunk.toString()));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch { parsed = { raw: b }; }
        resolveP({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', rejectP);
    if (data) req.write(data);
    req.end();
  });
};

/** POST multipart/form-data (composer contract). fields: {name: value}. */
const multipart = (path, token, fields, file = null) =>
  new Promise((resolveP, rejectP) => {
    const boundary = '----komuniph' + Math.random().toString(16).slice(2);
    const parts = [];
    for (const [name, value] of Object.entries(fields || {})) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    if (file) {
      const fieldName = file.field || 'media';
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`
      ));
      parts.push(file.data);
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.request({ hostname: BASE_HOST, port: BASE_PORT, path, method: 'POST', headers }, (res) => {
      let b = '';
      res.on('data', (chunk) => (b += chunk.toString()));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch { parsed = { raw: b }; }
        resolveP({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', rejectP);
    req.write(body);
    req.end();
  });

const db = getDb();
let pass = 0;
let fail = 0;
const assert = (cond, label, extra) => {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
};
const log = (m) => console.log('\n' + m);

// Valid 1x1 PNG (bytes preserved); tiny but structurally valid MP4 header.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const MP4_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypmp42'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('mp42isom'),
  Buffer.from([0x00, 0x00, 0x00, 0x08]),
  Buffer.from('free'),
]);

async function register(username, profile) {
  const reg = await api('/api/auth/register', 'POST', {
    email: `${username}@test.com`, username, password: P,
  });
  if (reg.status !== 201) return null;
  const token = reg.body.access_token;
  const prof = await api('/api/profile', 'PATCH', profile, token);
  if (prof.status !== 200) return null;
  return token;
}

async function runTests() {
  console.log('=== COMMUNITY-05 COMPOSER TEST ===');

  // Pick a real unused barangay (same convention as test_community.mjs).
  const { countries, barangays } = getAllLocations();
  const country = 'Philippines';
  const cityList = countries.includes(country) ? barangays[country] : {};
  let city = null, barangay = null;
  outer: for (const c of Object.keys(cityList)) {
    const hasCityComm = db.prepare(
      "SELECT id FROM communities WHERE type = 'city' AND country = ? AND city = ?"
    ).get(country, c);
    if (!hasCityComm) continue;
    for (const b of cityList[c] || []) {
      const hasBrgy = db.prepare(
        "SELECT id FROM communities WHERE type = 'barangay' AND country = ? AND city = ? AND barangay = ?"
      ).get(country, c, b);
      if (!hasBrgy) { city = c; barangay = b; break outer; }
    }
  }
  assert(!!city && !!barangay, 'Found an unused real barangay', { city, barangay });

  const owner = `cmpA${stamp}`, member = `cmpB${stamp}`, tagme = `cmpC${stamp}`, outsider = `cmpE${stamp}`;
  const tOwner = await register(owner, { first_name: 'O', last_name: 'Owner', display_name: 'Owner O', country, city, barangay });
  const tMember = await register(member, { first_name: 'M', last_name: 'Member', display_name: 'Member M', country, city, barangay });
  const tTag = await register(tagme, { first_name: 'T', last_name: 'Tag', display_name: 'Tag T', country, city, barangay });
  const tOut = await register(outsider, { first_name: 'E', last_name: 'Out', display_name: 'Out E', country: 'Philippines', city: 'Manila', barangay: 'Quiapo' });
  assert(!!tOwner && !!tMember && !!tTag && !!tOut, 'All 4 test users registered');

  const list = await api('/api/communities', 'GET', null, tOwner);
  const community = list.body.communities.find((c) => c.type === 'barangay' && c.barangay === barangay);
  assert(!!community, 'Barangay community exists for test location');
  const cid = community && community.id;
  const postPath = `/api/communities/${cid}/posts`;

  await api(`/api/communities/${cid}/join`, 'POST', null, tOwner);
  await api(`/api/communities/${cid}/join`, 'POST', null, tMember);
  await api(`/api/communities/${cid}/join`, 'POST', null, tTag);
  assert(true, 'Owner + members joined the community');

  const createdPosts = [];
  const createdMedia = [];

  log('--- TEXT: composer text post still works ---');
  const textPost = await multipart(postPath, tOwner, { content: `Hello ${barangay}!` });
  assert(textPost.status === 201, 'Text-only multipart post returns 201', textPost.status);
  assert(textPost.body.content === `Hello ${barangay}!`, 'Text content round-trips');
  assert(textPost.body.community_id === cid, 'Text post bound to community_id');
  assert(textPost.body.media_url === null && textPost.body.media_type === null, 'Text post has no media');
  createdPosts.push(textPost.body.id);

  log('--- PHOTO: image attachment pipeline ---');
  const photoPost = await multipart(postPath, tMember, { content: 'Sunset photo' }, { name: 'sunset.png', type: 'image/png', data: PNG_1X1 });
  assert(photoPost.status === 201, 'Photo post returns 201', photoPost.status);
  assert(photoPost.body.media_type === 'image', 'Photo post media_type is image');
  assert(typeof photoPost.body.media_url === 'string' && photoPost.body.media_url.startsWith('/uploads/community/'), 'media_url points at uploads/community', photoPost.body.media_url);
  createdMedia.push(photoPost.body.media_url);
  createdPosts.push(photoPost.body.id);

  log('--- VIDEO: video attachment pipeline ---');
  const videoPost = await multipart(postPath, tOwner, { content: 'Fiesta clip' }, { name: 'clip.mp4', type: 'video/mp4', data: MP4_BYTES });
  assert(videoPost.status === 201, 'Video post returns 201', videoPost.status);
  assert(videoPost.body.media_type === 'video', 'Video post media_type is video');
  assert(typeof videoPost.body.media_url === 'string' && videoPost.body.media_url.endsWith('.mp4'), 'Video media_url keeps mp4 extension', videoPost.body.media_url);
  createdMedia.push(videoPost.body.media_url);
  createdPosts.push(videoPost.body.id);

  log('--- MEDIA FILE: attached files are served ---');
  const fileResp = await new Promise((resolveP) => {
    http.get({ hostname: BASE_HOST, port: BASE_PORT, path: photoPost.body.media_url }, (r) => { r.resume(); r.on('end', () => resolveP(r.statusCode)); }).on('error', () => resolveP(0));
  });
  assert(fileResp === 200, 'Uploaded media file is publicly served (200)', fileResp);

  log('--- ASSOCIATION: media lands on the right community post ---');
  const feed = await api(postPath, 'GET', null, tMember);
  assert(feed.status === 200, 'Member can read community feed');
  const feedPhoto = feed.body.posts.find((p) => p.id === photoPost.body.id);
  const feedVideo = feed.body.posts.find((p) => p.id === videoPost.body.id);
  assert(!!feedPhoto && feedPhoto.community_id === cid && feedPhoto.media_type === 'image', 'Feed returns photo post with correct community + media_type');
  assert(!!feedVideo && feedVideo.community_id === cid && feedVideo.media_type === 'video', 'Feed returns video post with correct community + media_type');



  log('--- TAGS: mentions resolve only real users ---');
  const tagPost = await multipart(postPath, tOwner, {
    content: `Welcome @${tagme} and @${member}!`,
  });
  assert(tagPost.status === 201, 'Post with mentions returns 201', tagPost.status);
  assert(Array.isArray(tagPost.body.mentions) && tagPost.body.mentions.length === 2, 'Two valid mentions stored', tagPost.body.mentions);
  const tagged = tagPost.body.mentions.map((m) => m.username.toLowerCase());
  assert(tagged.includes(tagme.toLowerCase()) && tagged.includes(member.toLowerCase()), 'Mentions reference the actual KomuniPH accounts');
  assert(tagPost.body.mentions.every((m) => !('bio' in m) && !('email' in m)), 'Mentions expose only public fields');
  const ghostTagPost = await multipart(postPath, tOwner, { content: 'Say hi to @ghost_user_42' });
  assert(ghostTagPost.status === 201, 'Post with non-existent mention still posts');
  assert(Array.isArray(ghostTagPost.body.mentions) && ghostTagPost.body.mentions.length === 0, 'Arbitrary @text is NOT treated as a user');
  createdPosts.push(tagPost.body.id, ghostTagPost.body.id);

  const feed2 = await api(postPath, 'GET', null, tMember);
  const feedTag = feed2.body.posts.find((p) => p.id === tagPost.body.id);
  assert(!!feedTag && Array.isArray(feedTag.mentions) && feedTag.mentions.length === 2, 'Feed returns stored mentions for the post');

  log('--- LOCATION: optional, validated against the shared model ---');
  const noLoc = await multipart(postPath, tMember, { content: 'No location here' });
  assert(noLoc.status === 201 && noLoc.body.location === null, 'Post without location has location: null');
  createdPosts.push(noLoc.body.id);
  const withLoc = await multipart(postPath, tOwner, {
    content: 'Meetup spot',
    location_country: country,
    location_city: city,
    location_barangay: barangay,
  });
  assert(withLoc.status === 201, 'Post with valid location returns 201', withLoc.status);
  assert(withLoc.body.location && withLoc.body.location.country === country && withLoc.body.location.city === city && withLoc.body.location.barangay === barangay, 'Location round-trips (country/city/barangay)');
  createdPosts.push(withLoc.body.id);
  const badCity = await multipart(postPath, tOwner, { content: 'bad', location_country: country, location_city: 'Atlantis' });
  assert(badCity.status === 422, 'Unknown city rejected (422)', badCity.status);
  const badBrgy = await multipart(postPath, tOwner, { content: 'bad', location_country: country, location_city: city, location_barangay: 'Nowhere' });
  assert(badBrgy.status === 422, 'Unknown barangay rejected (422)', badBrgy.status);
  const orphanCity = await multipart(postPath, tOwner, { content: 'bad', location_city: city });
  assert(orphanCity.status === 422, 'City without country rejected (422)', orphanCity.status);
  const feed3 = await api(postPath, 'GET', null, tMember);
  const feedLoc = feed3.body.posts.find((p) => p.id === withLoc.body.id);
  assert(!!feedLoc && feedLoc.location && feedLoc.location.barangay === barangay, 'Feed returns post location');

  log('--- FEELING: structured feeling/activity ---');
  const feeling = await multipart(postPath, tMember, { content: 'Game day', feeling_type: 'celebrating', feeling_value: 'fiesta week' });
  assert(feeling.status === 201, 'Feeling post returns 201', feeling.status);
  assert(feeling.body.feeling_type === 'celebrating' && feeling.body.feeling_value === 'fiesta week', 'Feeling type + value round-trip');
  createdPosts.push(feeling.body.id);
  const bareType = await multipart(postPath, tOwner, { content: 'On the road', feeling_type: 'traveling' });
  assert(bareType.status === 201 && bareType.body.feeling_type === 'traveling' && bareType.body.feeling_value === null, 'Type without value allowed (Traveling)');
  createdPosts.push(bareType.body.id);
  const badType = await multipart(postPath, tOwner, { content: 'bad', feeling_type: 'vibing' });
  assert(badType.status === 422, 'Non-whitelisted feeling type rejected (422)', badType.status);
  const orphanValue = await multipart(postPath, tOwner, { content: 'bad', feeling_value: 'something' });
  assert(orphanValue.status === 422, 'Value without type rejected (422)', orphanValue.status);
  const feed4 = await api(postPath, 'GET', null, tMember);
  const feedFeel = feed4.body.posts.find((p) => p.id === feeling.body.id);
  assert(!!feedFeel && feedFeel.feeling_type === 'celebrating', 'Feed returns feeling for the post');

  log('--- AUTHORIZATION: membership rules preserved ---');
  const notJoined = await multipart(postPath, tOut, { content: 'let me in' });
  assert(notJoined.status === 403, 'Non-member cannot post (403)', notJoined.status);
  const noAuth = await multipart(postPath, null, { content: 'anon' });
  assert(noAuth.status === 401, 'Unauthenticated request rejected (401)', noAuth.status);
  const badComm = await multipart('/api/communities/nonexistent-community-id/posts', tOwner, { content: 'ghost' });
  assert(badComm.status === 404, 'Nonexistent community rejected (404)', badComm.status);

  log('--- INVALID MEDIA: validation intact ---');
  const fakePng = await multipart(postPath, tOwner, { content: 'tricky' }, { name: 'evil.png', type: 'image/png', data: Buffer.from('MZ this is not an image') });
  assert(fakePng.status === 400 || fakePng.status === 422, 'Fake PNG (text bytes with image MIME) rejected', fakePng.status);
  const textAsVideo = await multipart(postPath, tOwner, { content: 'tricky2' }, { name: 'movie.mp4', type: 'video/mp4', data: Buffer.from('plain text, not video') });
  assert(textAsVideo.status === 400 || textAsVideo.status === 422, 'Text bytes with video MIME rejected', textAsVideo.status);

  log('--- BACK-COMPAT: main feed JSON post endpoint untouched ---');
  const feedPost = await api('/api/feed/posts', 'POST', { content: 'plain feed post' }, tOwner);
  assert(feedPost.status === 201 && !('media_url' in feedPost.body), 'Feed JSON create works; response shape unchanged');

  log('--- CLEANUP: remove all created rows and media files ---');
  let deleted = 0;
  for (const pid of createdPosts) {
    if (!pid) continue;
    const d = await api(`/api/feed/posts/${pid}`, 'DELETE', null, tOwner);
    if (d.status === 200) deleted++;
  }
  assert(deleted === createdPosts.filter(Boolean).length, `Deleted ${deleted}/${createdPosts.filter(Boolean).length} test posts`);
  for (const m of createdMedia) {
    if (!m) continue;
    const abs = resolve(__dirname, '..', m.replace(/^\//, ''));
    try { unlinkSync(abs); } catch {}
  }
  assert(true, `Removed ${createdMedia.filter(Boolean).length} uploaded media files from uploads/community`);

  console.log(`\n=== RESULT: ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail === 0 ? 0 : 1);
}

runTests().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

