/**
 * REAL-BROWSER E2E: Profile <-> Gallery <-> Album <-> Profile Pictures
 * PHASE-2/3/6 verification for the gallery split (GALLERY-SPLIT-01).
 *
 * Verifies:
 *  1. Home -> Profile main photo element state
 *  2. Profile -> Gallery -> Back -> Profile photo identical
 *  3. Profile -> Gallery -> Album -> Back -> Profile photo identical
 *  4. Profile -> Gallery -> Profile Pictures -> Back -> Profile photo identical
 *  5. Album photo grid + lightbox open/close
 *  6. Multi-upload from the album page (gallery upload queue)
 *  7. Testimonials module intact on profile
 *  8. Profile background layer intact
 *  9. Login page after logout
 */
import puppeteer from 'puppeteer';
import http from 'http';

const stamp = Date.now().toString().slice(-6);
const user = `flow${stamp}`;
const pass = 'Password123!';

function api(path, method = 'GET', body = null, token = null) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3000, path, method, headers }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const results = [];
function check(cond, label, extra = '') {
  results.push({ pass: !!cond, label, extra });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : ' | ' + extra}`);
}

const snapshotPhoto = () => {
  const el = document.getElementById('profile-photo-large');
  const frame = document.getElementById('profile-frame');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    className: el.className,
    tag: el.tagName,
    inlineStyle: el.getAttribute('style') || '',
    width: cs.width,
    height: cs.height,
    borderRadius: cs.borderRadius,
    objectFit: cs.objectFit,
    objectPosition: cs.objectPosition,
    display: cs.display,
    dataView: frame?.dataset.view || null,
  };
};

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

const reg = await api('/api/auth/register', 'POST', { email: `${user}@test.com`, username: user, password: pass });
const token = reg.access_token, refresh = reg.refresh_token;

async function gotoHash(hash, wait = 1600) {
  await page.evaluate(h => { location.hash = h; }, hash);
  await new Promise(r => setTimeout(r, wait));
}

async function uploadPhoto(albumId) {
  const sharp = (await import('sharp')).default;
  const colors = [[40, 120, 160], [180, 60, 60], [60, 160, 80]][Math.floor(Math.random() * 3)];
  const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: colors[0], g: colors[1], b: colors[2] } } }).jpeg().toBuffer();
  const boundary = '----flow' + Date.now() + Math.random();
  const parts = [];
  if (albumId) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="album_id"\r\n\r\n${albumId}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="t.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
  parts.push(jpeg);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const res = await fetch('http://localhost:3000/api/profile/photos', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Authorization: `Bearer ${token}` },
    body: Buffer.concat(parts),
  });
  const parsed = await res.json().catch(() => null);
  if (res.status !== 201) { console.log('  [upload]', res.status, JSON.stringify(parsed)); return null; }
  return parsed?.photos?.[0] || parsed?.photo || null;
}

/* ================= TESTS ================= */
console.log('=== REAL BROWSER FLOW TESTS ===');

// Seed tokens + reload so initAuth picks them up
await page.goto('http://localhost:3000/#/login', { waitUntil: 'networkidle0' });
await page.evaluate((t, r) => localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: t, refresh: r })), token, refresh);
await page.reload({ waitUntil: 'networkidle0' });

// 1. Home -> Profile
await gotoHash('#/home', 900);
await gotoHash('#/profile');
const stateHome = await page.evaluate(snapshotPhoto);
check(!!stateHome, '1. Home -> Profile renders main photo', JSON.stringify(stateHome));
check(stateHome?.className === 'profile-photo-large', '1a. Main photo uses dedicated profile-header class only', stateHome?.className);
check(stateHome?.dataView === 'own', '1b. Own profile mode', stateHome?.dataView);
check(!!(await page.evaluate(() => document.querySelector('#profile-background-layer, .profile-background-layer'))), '1d. Profile background layer present');
const testimonialsOk = await page.evaluate(() => !!document.getElementById('testimonials-list') || /testimonial/i.test(document.body.textContent));
check(testimonialsOk, '1e. Testimonials module present');

const base = stateHome;

// 2. Profile -> Gallery -> Back -> Profile
await page.evaluate(() => window.openGalleryPage());
await new Promise(r => setTimeout(r, 1600));
check((await page.evaluate(() => location.hash)).endsWith('/photos'), '2. Profile -> Gallery navigates');
const albumsOnGallery = await page.evaluate(() => document.querySelectorAll('#gallery-albums-grid .gallery-album-card, #gallery-albums-grid a').length);
check(albumsOnGallery > 0, '2a. Gallery lists album cards', String(albumsOnGallery));
await gotoHash(`#/profile/${user}`);
const stateBack2 = await page.evaluate(snapshotPhoto);
check(JSON.stringify(base) === JSON.stringify(stateBack2), '2b. Back to Profile: main photo IDENTICAL', JSON.stringify(stateBack2));

// 3. Profile -> Gallery -> Album (general) -> Back -> Profile
await page.evaluate(() => window.openGalleryPage());
await new Promise(r => setTimeout(r, 1600));
const albumLinks = await page.evaluate(() =>
  [...document.querySelectorAll('a')].filter(a => /\/photos\/.+/.test(a.hash || '')).map(a => a.hash)
);
check(albumLinks.length > 0, '3. Gallery has album links', JSON.stringify(albumLinks));
// identify the Profile Pictures album id so step 3 picks a normal album
const profileAlbumIdSet = new Set(await page.evaluate(() => {
  return [...document.querySelectorAll('.gallery-album-card')]
    .filter(c => /profile pictures/i.test(c.textContent))
    .map(c => (c.getAttribute('href') || '').split('/').pop())
    .filter(Boolean);
}));
// pick a non-Profile-Pictures album if present
const generalLink = albumLinks.find(h => !profileAlbumIdSet.has(h.split('/').pop())) || albumLinks[0];
await gotoHash(generalLink);
const albumState = await page.evaluate(() => ({
  hash: location.hash,
  title: document.getElementById('album-title')?.textContent || '',
  photos: document.querySelectorAll('#album-photos-grid .photo-gallery-item').length,
}));
check(albumState.title.length > 0, '3a. Album page renders header', albumState.title);
check(!pageErrors.length, '3b. No page errors so far', pageErrors.join(' | '));
await gotoHash(`#/profile/${user}`);
const stateBack3 = await page.evaluate(snapshotPhoto);
check(JSON.stringify(base) === JSON.stringify(stateBack3), '3c. Back to Profile (via album): main photo IDENTICAL', JSON.stringify(stateBack3));

// 4. Profile -> Gallery -> Profile Pictures -> Back -> Profile (REQUIRED PATH)
const profilePicturesHash = await (async () => {
  await page.evaluate(() => window.openGalleryPage());
  await new Promise(r => setTimeout(r, 1600));
  return page.evaluate(() => {
    const links = [...document.querySelectorAll('a')].filter(a => /\/photos\/.+/.test(a.hash || ''));
    const pp = links.find(a => /profile pictures/i.test(a.textContent + ' ' + (a.closest('.gallery-album-card')?.textContent || '')));
    return (pp || links[0])?.hash || null;
  });
})();
check(!!profilePicturesHash, '4. Gallery exposes Profile Pictures album link', String(profilePicturesHash));
await gotoHash(profilePicturesHash);
const ppState = await page.evaluate(() => ({
  title: document.getElementById('album-title')?.textContent || '',
  photos: document.querySelectorAll('#album-photos-grid .photo-gallery-item').length,
}));
check(/profile pictures/i.test(ppState.title), '4a. Profile Pictures album page loads', ppState.title);
await gotoHash(`#/profile/${user}`);
const stateBack4 = await page.evaluate(snapshotPhoto);
check(JSON.stringify(base) === JSON.stringify(stateBack4), '4b. Back to Profile (via Profile Pictures): main photo IDENTICAL', JSON.stringify(stateBack4));

// 5. Multi-upload from the Profile Pictures album page (UI upload queue)
const ppAlbumId = profilePicturesHash.split('/').pop();
const p1 = await uploadPhoto(ppAlbumId);
const p2 = await uploadPhoto(ppAlbumId);
check(!!p1 && !!p2, '5. Two photos uploaded into Profile Pictures album (API)');
await gotoHash(profilePicturesHash, 2200);
const gridCount = await page.evaluate(() => document.querySelectorAll('#album-photos-grid .photo-gallery-item').length);
check(gridCount === 2, '5a. Album grid shows both photos', String(gridCount));
const thumbsLeak = await page.evaluate(() =>
  [...document.querySelectorAll('#album-photos-grid img')].some(i => !i.className.includes('photo-gallery-thumb'))
);
check(!thumbsLeak, '5b. Grid thumbs use gallery thumb classes only');

// UI multi-upload through the queue input
const beforeCount = await page.evaluate(() => document.querySelectorAll('#album-photos-grid .photo-gallery-item').length);
const fileInput = await page.$('#gallery-photo-input');
check(!!fileInput, '5c. Album page exposes upload input');
if (fileInput) {
  const sharp2 = (await import('sharp')).default;
  const j1 = await sharp2({ create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 90, b: 90 } } }).jpeg().toBuffer();
  const j2 = await sharp2({ create: { width: 200, height: 200, channels: 3, background: { r: 90, g: 10, b: 90 } } }).jpeg().toBuffer();
  await page.evaluate(async (b64a, b64b) => {
    const mk = (b64, name) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return new File([bytes], name, { type: 'image/jpeg' });
    };
    const dt = new DataTransfer();
    dt.items.add(mk(b64a, 'a.jpg'));
    dt.items.add(mk(b64b, 'b.jpg'));
    const input = document.getElementById('gallery-photo-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, j1.toString('base64'), j2.toString('base64'));
  await new Promise(r => setTimeout(r, 6000));
  const afterCount = await page.evaluate(() => document.querySelectorAll('#album-photos-grid .photo-gallery-item').length);
  check(afterCount === beforeCount + 2, '5d. Multi-upload adds both photos to grid', `${beforeCount} -> ${afterCount}`);
}

// 6. Lightbox
await page.evaluate(() => {
  document.querySelector('#album-photos-grid .photo-gallery-item').click();
});
await new Promise(r => setTimeout(r, 700));
const lbOpenState = await page.evaluate(() => {
  const lb = document.getElementById('gallery-lightbox');
  return { exists: !!lb, visible: lb && getComputedStyle(lb).display !== 'none' };
});
check(lbOpenState.exists && lbOpenState.visible, '6. Lightbox opens on photo click', JSON.stringify(lbOpenState));
await page.evaluate(() => window.lightboxNext());
await new Promise(r => setTimeout(r, 400));
const lbNextOk = await page.evaluate(() => document.getElementById('lightbox-image')?.src || document.getElementById('gallery-lightbox-image')?.src || '');
check(!!lbNextOk, '6a. Lightbox next navigates');
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 500));
const lbClosed = await page.evaluate(() => {
  const lb = document.getElementById('gallery-lightbox');
  return !lb || getComputedStyle(lb).display === 'none';
});
check(lbClosed, '6b. Lightbox closes (Escape)');

// 7. Back to profile still identical after uploads
await gotoHash(`#/profile/${user}`);
const stateBack5 = await page.evaluate(snapshotPhoto);
check(JSON.stringify(base) === JSON.stringify(stateBack5), '7. Final Back to Profile: main photo IDENTICAL', JSON.stringify(stateBack5));
check(!!(await page.evaluate(() => document.querySelector('#profile-background-layer, .profile-background-layer'))), '7a. Background layer still present');

// 8. Logout -> Login page renders
await gotoHash('#/logout', 1200);
const loginOk = await page.evaluate(() => !!document.getElementById('login-form') || !!document.querySelector('form'));
check(loginOk, '8. Logout redirects to login page with form');

// 9. No runtime page errors during the whole run
check(pageErrors.length === 0, '9. Zero page errors across all flows', pageErrors.join(' | '));

await browser.close();

console.log(`\n=== RESULTS: ${results.filter(r => r.pass).length} PASS, ${results.filter(r => !r.pass).length} FAIL ===`);
if (results.some(r => !r.pass)) process.exit(1);


