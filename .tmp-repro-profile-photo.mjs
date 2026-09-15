/**
 * PHASE-2 REPRO: Profile -> Gallery -> Profile Pictures -> Back to Profile
 * Compare the main profile photo element in both states (real browser).
 */
import puppeteer from 'puppeteer';
import http from 'http';

const stamp = Date.now().toString().slice(-6);
const user = `repro${stamp}`;
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

function snapshotPhoto() {
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      className: el.className,
      id: el.id,
      inlineStyle: el.getAttribute('style') || '',
      width: cs.width,
      height: cs.height,
      borderRadius: cs.borderRadius,
      objectFit: cs.objectFit,
      objectPosition: cs.objectPosition,
      display: cs.display,
      border: cs.border,
      src: (el.src || '').split('/').pop(),
    };
  };
  return {
    hash: location.hash,
    dataView: document.getElementById('profile-frame')?.dataset.view || null,
    large: pick(document.getElementById('profile-photo-large')),
    initials: pick(document.getElementById('profile-photo-initials')),
    publicDisplay: document.getElementById('profile-photo-display')
      ? document.getElementById('profile-photo-display').innerHTML.slice(0, 200)
      : null,
  };
}


async function settle(page, ms = 1200) {
  await new Promise(r => setTimeout(r, ms));
}

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));

const reg = await api('/api/auth/register', 'POST', { email: `${user}@test.com`, username: user, password: pass });
const token = reg.access_token;
const refresh = reg.refresh_token;

// Upload a real photo so the main profile photo renders as <img>
const sharp = (await import('sharp')).default;
const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 40, g: 120, b: 160 } } }).jpeg().toBuffer();
const boundary = '----repro' + Date.now();
const mp = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="me.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
  jpeg,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);
const upRes = await fetch('http://localhost:3000/api/profile/photos', {
  method: 'POST',
  headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Authorization: `Bearer ${token}` },
  body: mp,
});
console.log('photo upload status:', upRes.status);

// Load app with tokens pre-seeded
await page.goto('http://localhost:3000/#/login', { waitUntil: 'networkidle0' });
await page.evaluate((t, r) => localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: t, refresh: r })), token, refresh);
await page.reload({ waitUntil: 'networkidle0' });
console.log('registered as', user, 'token?', !!token);

// 1. Home -> Profile
await page.evaluate(() => { location.hash = '#/home'; });
await settle(page, 800);
await page.evaluate(() => { location.hash = '#/profile'; });
await settle(page, 2000);
const homeProfile = await page.evaluate(snapshotPhoto);
console.log('\n=== STATE A: Home -> Profile ===');
console.log(JSON.stringify(homeProfile, null, 2));

// 2. Profile -> Gallery
await page.evaluate(() => window.openGalleryPage());
await settle(page, 2000);
const galleryState = await page.evaluate(() => ({
  hash: location.hash,
  albumLinks: [...document.querySelectorAll('a')].filter(a => /photos\//.test(a.hash)).map(a => a.hash),
}));
console.log('\n=== STATE B: Gallery ===');
console.log(JSON.stringify(galleryState, null, 2));

// 3. Gallery -> Profile Pictures album
const profileAlbumHash = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a')].filter(a => /\/photos\/.+/.test(a.hash || ''));
  const pp = links.find(a => /profile pictures/i.test(a.closest('[class*="album"]')?.textContent || ''));
  return (pp || links[0])?.hash || null;
});
console.log('\nProfile Pictures album hash:', profileAlbumHash);
if (profileAlbumHash) {
  await page.evaluate(h => { location.hash = h; }, profileAlbumHash);
  await settle(page, 2000);
  const albumState = await page.evaluate(() => ({
    hash: location.hash,
    title: document.getElementById('album-title')?.textContent,
    meta: document.getElementById('album-meta')?.textContent,
    photos: document.querySelectorAll('#album-photos-grid .photo-gallery-item').length,
  }));
  console.log('\n=== STATE C: Profile Pictures album ===');
  console.log(JSON.stringify(albumState, null, 2));
}

// 4. Back to Profile (the "Profile" nav link)
await page.evaluate((u) => { location.hash = `#/profile/${u}`; }, user);
await settle(page, 2000);
const backProfile = await page.evaluate(snapshotPhoto);
console.log('\n=== STATE D: Back to Profile ===');
console.log(JSON.stringify(backProfile, null, 2));

// 5. Browser Back button path (history)
await page.goBack();
await settle(page, 2000);
const historyBack = await page.evaluate(snapshotPhoto);
console.log('\n=== STATE E: History Back (album -> profile) ===');
console.log(JSON.stringify(historyBack, null, 2));

function diff(a, b, labelA, labelB) {
  console.log(`\n=== DIFF ${labelA} vs ${labelB} ===`);
  if (!a?.large || !b?.large) { console.log('MISSING ELEMENT', a?.large, b?.large); return; }
  const keys = ['tag','className','id','inlineStyle','width','height','borderRadius','objectFit','objectPosition','display','border','src'];
  let same = true;
  for (const k of keys) {
    if (a.large[k] !== b.large[k]) { same = false; console.log(`  large.${k}: "${a.large[k]}" -> "${b.large[k]}"`); }
  }
  if (a.dataView !== b.dataView) { same = false; console.log(`  dataView: "${a.dataView}" -> "${b.dataView}"`); }
  if (same) console.log('  IDENTICAL OK');
}
diff(homeProfile, backProfile, 'A(home)', 'D(back)');
diff(homeProfile, historyBack, 'A(home)', 'E(history-back)');

await browser.close();

