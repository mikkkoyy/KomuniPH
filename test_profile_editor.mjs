/** Run against a disposable local KomuniPH database: node test_profile_editor.mjs.
 * Uses the existing Puppeteer + Sharp dependencies; creates test accounts/uploads.
 * Set TEST_BASE_URL when using a port other than 3000. No credentials are logged.
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local test server required');
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(12000);
const jsErrors = [];
const httpErrors = [];
let expectedFailure = false;
page.on('pageerror', error => jsErrors.push(error.message));
page.on('response', response => {
  if (response.status() >= 400 && !expectedFailure) httpErrors.push(`${response.status()} ${response.url()}`);
});
page.on('requestfailed', request => {
  if (!expectedFailure && !request.failure()?.errorText.includes('ABORTED')) httpErrors.push(request.failure()?.errorText);
});
const report = label => console.log('PASS:', label);
const api = async (path, method = 'GET', body, token) => {
  const response = await fetch(base + '/api' + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
};
async function register(suffix) {
  const username = `pe${Date.now()}${suffix}`;
  const result = await api('/auth/register', 'POST', { username, email: `${username}@example.test`, password: 'EditorTest123!' });
  assert.equal(result.status, 201);
  return { username, token: result.data.access_token, refresh: result.data.refresh_token };
}
async function route(hash, selector) {
  await page.evaluate(hash => { location.hash = hash; }, hash);
  await page.waitForSelector(selector, { visible: true });
}
async function field(id, value) {
  await page.$eval('#' + id, (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function status(text) {
  await page.waitForFunction(text => document.getElementById('editor-status')?.textContent.includes(text), {}, text);
}
const jpeg = await sharp({ create: { width: 480, height: 320, channels: 3, background: '#278c8c' } }).jpeg().toBuffer();
async function chooseImage(selector, type = 'image/jpeg') {
  await page.$eval(selector, (input, encoded, type) => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'editor-test.jpg', { type }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, jpeg.toString('base64'), type);
}

try {
  const owner = await register('a');
  const other = await register('b');
  const own = async () => (await api('/profile', 'GET', undefined, owner.token)).data;
  await page.goto(base + '/#/profile/edit', { waitUntil: 'networkidle0' });
  assert.equal(await page.evaluate(() => location.hash), '#/login');
  report('Unauthenticated editor redirects to login');
  await page.evaluate(owner => localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: owner.token, refresh: owner.refresh })), owner);
  await page.reload({ waitUntil: 'networkidle0' });
  await route('/profile', 'a[href="#/profile/edit"]');
  assert.equal(await page.$('#theme-customization-panel'), null);
  assert.equal(await page.$('#photo-input'), null);
  assert.equal(await page.$('#profile-edit'), null);
  await page.click('a[href="#/profile/edit"]');
  await page.waitForSelector('#edit-display-name', { visible: true });
  await field('edit-display-name', 'Profile Editor Identity');
  await field('edit-first-name', 'Editor');
  await field('edit-last-name', 'Owner');
  await field('edit-bio', 'A profile made for viewing.');
  await field('edit-alias', owner.username + 'alias');
  assert.equal(await page.$eval('#profile-name', element => element.textContent), 'Profile Editor Identity');
  await page.click('#save-profile-btn');
  await status('information saved successfully');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#edit-display-name', e => e.value), 'Profile Editor Identity');
  assert.equal(await page.$eval('#edit-bio', e => e.value), 'A profile made for viewing.');
  assert.equal(await page.$eval('#edit-alias', e => e.value), owner.username + 'alias');
  assert.equal((await own()).username, owner.username);
  report('Identity, bio and alias persist; username unchanged; public profile has no editor controls');

  await chooseImage('#editor-photo-input', 'text/plain');
  assert.match(await page.$eval('#editor-photo-status', e => e.textContent), /JPEG/);
  await chooseImage('#editor-photo-input');
  assert.equal(await page.$eval('#editor-photo-preview', e => e.hidden), false);
  await page.click('#editor-photo-upload');
  await page.waitForFunction(() => document.getElementById('editor-photo-status').textContent.includes('saved successfully'));
  const photo = (await own()).profile_photo_url;
  assert.match(photo, /\.webp$/);
  assert.equal((await fetch(base + photo)).status, 200);
  await page.reload({ waitUntil: 'networkidle0' });
  assert.ok((await page.$eval('#profile-photo-display img', e => e.src)).endsWith(photo));
  report('Photo selection, validation, upload, optimized WebP and refreshed preview');

  await page.click('#customize-tab');
  await page.click('input[name="bg-type"][value="image"]');
  await chooseImage('#theme-background-input');
  await page.waitForFunction(() => document.getElementById('theme-background-status').textContent.includes('uploaded and saved'));
  const background = (await own()).theme.custom.backgroundImage;
  assert.ok(background);
  await field('theme-backgroundPosition', 'top left');
  await field('theme-backgroundSize', 'contain');
  await field('theme-cardBorderRadius', '0');
  await field('theme-cardOpacity', '0.65');
  await field('theme-accentColor', '#22aaaa');
  await page.click('#editor-save-theme');
  await status('customization saved successfully');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click('#customize-tab');
  for (const [id, value] of Object.entries({ 'theme-cardBorderRadius': '0', 'theme-backgroundSize': 'contain', 'theme-backgroundPosition': 'top left', 'theme-cardOpacity': '0.65', 'theme-accentColor': '#22aaaa' })) {
    assert.equal(await page.$eval('#' + id, e => e.value), value);
  }
  assert.ok((await page.$eval('#theme-background-preview img', e => e.src)).endsWith(background));
  await page.click('.editor-heading a');
  await page.waitForFunction(() => !document.getElementById('profile-editor') && document.getElementById('profile-name')?.textContent === 'Profile Editor Identity');
  assert.equal(await page.$eval('#profile-frame', e => e.style.getPropertyValue('--theme-card-radius')), '0px');
  assert.ok((await page.$eval('#profile-background-layer', e => e.style.backgroundImage)).includes(background));
  assert.ok((await page.$eval('#profile-photo-large', e => e.src)).endsWith(photo));
  const photoSize = await page.$eval('#profile-photo-large', e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }));
  assert.ok(photoSize.width <= 320 && photoSize.height <= 400, JSON.stringify(photoSize));
  report('Background and card settings persist on actual profile; photo stays compact');

  await page.click('a[href="#/profile/edit"]');
  await page.waitForSelector('#edit-display-name', { visible: true });
  await page.click('#customize-tab');
  await page.click('#editor-remove-background');
  await status('Background image removed and saved');
  assert.ok(!(await own()).theme.custom.backgroundImage);
  await page.click('#editor-save-theme');
  await status('customization saved successfully');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#profile-background-layer', e => e.style.backgroundImage.includes('/uploads/backgrounds/')), false);
  await page.click('#customize-tab');
  await page.click('input[name="bg-type"][value="gradient"]');
  await field('theme-backgroundGradient', 'linear-gradient(135deg, #0e6e6e, #134e4a)');
  await page.click('#editor-save-theme');
  await status('customization saved successfully');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal((await own()).theme.custom.backgroundGradient, 'linear-gradient(135deg, #0e6e6e, #134e4a)');
  assert.match(await page.$eval('#profile-background-layer', e => e.style.backgroundImage), /linear-gradient/);
  report('Background removal and gradient selection persist after refresh');

  for (const width of [1280, 768, 390]) {
    await page.setViewport({ width, height: 900 });
    for (const tab of ['identity', 'customize']) {
      await page.click(`#${tab}-tab`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width} / ${tab}`);
      assert.equal(await page.$eval(`#${tab}-panel`, e => e.hidden), false);
    }
    await page.screenshot({ path: `.tmp-editor-${width}.png`, fullPage: true });
  }
  await page.click('#identity-tab');
  await chooseImage('#editor-photo-input');
  await page.click('#editor-photo-upload');
  await page.waitForFunction(() => document.getElementById('editor-photo-status').textContent.includes('saved successfully'));
  report('Desktop, tablet, mobile tabs/no overflow; mobile photo upload');

  await field('edit-first-name', '');
  await page.click('#save-profile-btn');
  assert.match(await page.$eval('#edit-profile-error', e => e.textContent), /First name is required/);
  await field('edit-first-name', 'Editor');
  expectedFailure = true;
  await page.setRequestInterception(true);
  const failSave = request => {
    if (request.url().endsWith('/api/profile') && request.method() === 'PATCH') {
      request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test save unavailable' } }) });
    } else request.continue();
  };
  page.on('request', failSave);
  await page.click('#save-profile-btn');
  await page.waitForFunction(() => document.getElementById('edit-profile-error').textContent.includes('Test save unavailable'));
  page.off('request', failSave);
  await page.setRequestInterception(false);
  expectedFailure = false;
  page.once('dialog', dialog => dialog.dismiss());
  await page.click('.editor-heading a');
  await page.waitForFunction(() => location.hash === '#/profile/edit');
  assert.equal(await page.$eval('#edit-first-name', e => e.value), 'Editor');
  await page.click('#save-profile-btn');
  await status('information saved successfully');
  report('Validation, failed-save feedback, retry, and cancelled navigation preserve drafts');

  await page.click('#customize-tab');
  page.once('dialog', dialog => dialog.accept());
  await page.click('#editor-reset-theme');
  await status('Default profile theme restored and saved');
  assert.deepEqual((await own()).theme.custom, {});
  await page.click('.editor-heading a');
  await page.waitForSelector('#profile-create-album-btn', { visible: true });
  await page.click('#profile-create-album-btn');
  await field('profile-create-album-name', 'Editor Regression Album');
  await page.click('#profile-create-album-submit');
  await page.waitForFunction(() => document.getElementById('profile-albums-grid').textContent.includes('Editor Regression Album'));
  await page.click('#photo-gallery-view-all');
  await page.waitForSelector('#gallery-albums-grid', { visible: true });
  await page.waitForFunction(() => document.getElementById('gallery-albums-grid').textContent.includes('Profile Pictures'));
  const albumLink = await page.$$eval('#gallery-albums-grid a', links => links.find(a => a.textContent.includes('Editor Regression Album'))?.getAttribute('href'));
  assert.ok(albumLink);
  await route(albumLink.slice(1), '#album-title');
  await chooseImage('#gallery-photo-input');
  await page.waitForSelector('#album-photos-grid .photo-gallery-item', { visible: true });
  await page.click('#album-photos-grid .photo-gallery-item');
  await page.waitForSelector('#gallery-lightbox', { visible: true });
  await page.keyboard.press('Escape');
  report('Reset theme, Create Album, gallery, Profile Pictures album, album upload and lightbox');

  const before = await own();
  for (const [path, method] of [['/profile', 'PATCH'], ['/profile/theme', 'PATCH'], ['/profile/photo', 'POST'], ['/profile/background', 'POST']]) {
    assert.equal((await api(path, method, {})).status, 401);
  }
  // Supplying another owner in the body/query cannot override the token subject.
  assert.equal((await api('/profile?user_id=' + before.user_id, 'PATCH', { user_id: before.user_id, username: owner.username, display_name: 'Other account only' }, other.token)).status, 200);
  assert.equal((await api('/profile/theme', 'PATCH', { user_id: before.user_id, accentColor: '#ff0000' }, other.token)).status, 422);
  assert.equal((await api('/profile/theme?user_id=' + before.user_id, 'PATCH', { accentColor: '#ff0000' }, other.token)).status, 200);
  assert.equal((await api('/profile/' + owner.username, 'PATCH', { bio: 'Cannot modify owner' }, other.token)).status, 404);
  for (const endpoint of ['photo', 'background']) {
    const form = new FormData();
    form.append(endpoint, new Blob([jpeg], { type: 'image/jpeg' }), 'ownership.jpg');
    form.append('user_id', before.user_id);
    const response = await fetch(base + '/api/profile/' + endpoint + '?user_id=' + before.user_id, {
      method: 'POST', headers: { Authorization: `Bearer ${other.token}` }, body: form
    });
    assert.ok(response.ok, `Other owner's own ${endpoint} upload: ${response.status}`);
  }
  const after = await own();
  for (const key of ['display_name', 'bio', 'alias', 'profile_photo_url', 'theme']) assert.deepEqual(after[key], before[key]);
  assert.equal((await api('/profile/albums/' + albumLink.split('/').pop(), 'PATCH', { name: 'Stolen' }, other.token)).status, 403);
  await route('/profile/' + other.username, '#profile-name');
  await page.waitForFunction(() => document.getElementById('profile-name').textContent === 'Other account only');
  assert.equal(await page.$('a[href="#/profile/edit"]'), null);
  assert.equal(await page.$('#theme-customization-panel'), null);
  report('Server auth and ownership across identity, theme, photo, background and album; visitor has no edit action');
  assert.deepEqual(jsErrors, []);
  assert.deepEqual(httpErrors, []);
  console.log('PROFILE EDITOR ACCEPTANCE PASS — zero unexpected browser JS/HTTP errors');
} finally {
  await browser.close();
}
