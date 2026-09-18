/** COMMUNITY-01 browser verification: /community + detail + join/leave + mobile.
 * Run against a disposible local KomuniPH server: node verify_community_browser.mjs
 * Set TEST_BASE_URL when using a port other than 3000. No credentials logged.
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local test server required');

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(15000);
const jsErrors = [];
const httpErrors = [];
page.on('pageerror', error => jsErrors.push(error.message));
page.on('response', response => {
  if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
});
page.on('requestfailed', request => {
  if (!request.failure()?.errorText.includes('ABORTED')) httpErrors.push(request.failure()?.errorText);
});
page.on('dialog', dialog => dialog.accept());

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log('  PASS:', label); }
  else { failed++; console.log('  FAIL:', label); }
};

const stamp = Date.now().toString().slice(-6);
const username = `bw${stamp}`;
const tokenKey = 'komuniph_auth_tokens';

console.log('=== COMMUNITY-01 BROWSER VERIFICATION ===');

// 1. Register + set location via same-origin API, then seed auth in localStorage.
await page.goto(base + '/', { waitUntil: 'networkidle0' });
const reg = await page.evaluate(async (username, password) => {
  const url = '/api/auth/register';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@example.test`, password }),
  });
  const data = await res.json();
  return { status: res.status, access: data.access_token, refresh: data.refresh_token };
}, username, 'BrowserTest123!');
check(reg.status === 201 && reg.access, 'Register browser test user');

const profile = await page.evaluate(async (token) => {
  const res = await fetch('/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      first_name: 'Bianca', last_name: 'Wong', display_name: 'Bianca Wong',
      country: 'Philippines', city: 'Manila', barangay: 'Intramuros',
    }),
  });
  return { status: res.status, data: await res.json() };
}, reg.access);
check(profile.status === 200, 'Set profile location (Manila, Intramuros)');

await page.evaluate((key, access, refresh) => {
  localStorage.setItem(key, JSON.stringify({ access, refresh }));
}, tokenKey, reg.access, reg.refresh);
await page.reload({ waitUntil: 'networkidle0' });
await page.evaluate(() => { location.hash = '#/community'; });

// 2. Directory page renders all three scopes with correct hierarchy.
await page.waitForSelector('.community-section', { visible: true, timeout: 15000 });
const sectionText = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.community-section'))
    .map(s => ({ key: s.dataset.scope, title: s.querySelector('.community-section-title')?.textContent })),
);
const hasNationwide = sectionText.some(s => s.key === 'nationwide');
const hasCity = sectionText.some(s => s.key === 'city');
const hasBarangay = sectionText.some(s => s.key === 'barangay');
check(hasNationwide && hasCity && hasBarangay, 'Directory shows Nationwide / My City / My Barangay sections');

const cardNames = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.community-card-name')).map(e => e.textContent),
);
check(
  cardNames.includes('Philippines') && cardNames.includes('Manila') && cardNames.includes('Intramuros'),
  'Cards list Philippines (nationwide), Manila (city), Intramuros (barangay)',
);
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Directory has no horizontal overflow');

// 3. Open the Manila city community detail page.
await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.community-card')).find(c => c.querySelector('.community-card-name')?.textContent === 'Manila');
  const open = card?.querySelector('a.btn-secondary');
  open?.click();
});
await page.waitForSelector('.community-header-name', { visible: true });
const detailHeader = await page.evaluate(() => document.querySelector('.community-header-name')?.textContent);
check(detailHeader === 'Manila', 'Community detail opens (Manila)');
check(
  await page.evaluate(() => !!document.querySelector('.community-header-scope') && !!document.querySelector('.community-header-stats')),
  'Detail shows scope + stats (member count, membership)',
);

// 4. Join via detail page, member count updates.
const membersBefore = await page.evaluate(() => document.querySelector('.community-header-stat strong')?.textContent);
const joinBtn = await page.$('.community-header-join');
if (joinBtn) {
  await joinBtn.click();
  await page.waitForFunction(() => !document.querySelector('.community-header-join'), { timeout: 15000 });
}
check(await page.evaluate(() => !!document.querySelector('.community-header-leave')), 'Join succeeds and becomes Leave');
const membersAfter = await page.evaluate(() => document.querySelector('.community-header-stat strong')?.textContent);
check(Number(membersAfter) === (Number(membersBefore) || 0) + 1, `Member count updated (${membersBefore} -> ${membersAfter})`);

// 5. Feed tab renders composer for members and posting works.
await page.evaluate(() => Array.from(document.querySelectorAll('.community-tab')).find(t => t.dataset.tab === 'feed')?.click());
await page.waitForSelector('.community-composer textarea', { visible: true });
const posted = await page.evaluate(async () => {
  const ta = document.querySelector('.community-composer textarea');
  ta.value = 'Posting from browser verification';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#community-post-submit').click();
});
await page.waitForFunction(() =>
  Array.from(document.querySelectorAll('.post-card')).some(p => p.textContent.includes('Posting from browser verification')),
  { timeout: 15000 },
);
check(true, 'Member can post to community feed (appears in feed)');

// 6. Members tab shows the member with public identity.
await page.evaluate(() => Array.from(document.querySelectorAll('.community-tab')).find(t => t.dataset.tab === 'members')?.click());
await page.waitForSelector('.community-member-list .community-member-row', { visible: true });
const memberText = await page.evaluate(() => document.querySelector('.community-member-list')?.textContent || '');
check(memberText.includes('Bianca Wong'), 'Members tab lists member with Display Name');

// 7. About tab renders.
await page.evaluate(() => Array.from(document.querySelectorAll('.community-tab')).find(t => t.dataset.tab === 'about')?.click());
await page.waitForSelector('.community-about-card', { visible: true });
check(await page.evaluate(() => /Geographic scope/.test(document.querySelector('.community-about-card')?.textContent || '')), 'About tab shows geographic scope');

// 8. Leave works and member count drops.
await page.waitForSelector('.community-header-leave', { visible: true });
await page.click('.community-header-leave');
await page.waitForFunction(() => !!document.querySelector('.community-header-join'), { timeout: 15000 });
check(true, 'Leave works and returns to Join state');

// 9. Mobile layout: directory + menu sheet reachable, no overflow.
await page.setViewport({ width: 390, height: 844 });
await page.evaluate(() => { location.hash = '#/community'; });
await page.waitForSelector('.mobile-nav', { visible: true });
await page.evaluate(() => document.getElementById('mobile-menu-btn')?.click());
await page.waitForSelector('.mobile-menu-sheet.open', { visible: true });
const menuHasCommunities = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.mobile-menu-item')).some(a => a.getAttribute('href') === '#/community'),
);
check(menuHasCommunities, 'Mobile menu sheet offers Communities link');
await page.evaluate(() => document.querySelector('.mobile-menu-close')?.click());
check(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  'Mobile directory has no horizontal overflow',
);

console.log('\n=== BROWSER RESULTS ===');
console.log(`  ${passed} PASS, ${failed} FAIL`);
if (jsErrors.length) {
  console.log('\nJS errors:');
  jsErrors.forEach(e => console.log('  -', e));
  failed += jsErrors.length;
}
if (httpErrors.length) {
  console.log('\nHTTP errors:');
  httpErrors.forEach(e => console.log('  -', e));
  failed += httpErrors.length;
}

await browser.close();
if (failed > 0) process.exit(1);