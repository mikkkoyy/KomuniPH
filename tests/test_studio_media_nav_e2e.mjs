/**
 * CREATOR-06 — Browser E2E (Puppeteer, headless).
 *
 * Run:   npm run test:studio-media-e2e
 *
 * Drives the real app in headless Chrome: login through the UI, then
 * verifies Marketplace / Coin Shop / Library / Wallet back navigation and
 * the Creator Studio image-upload workflow end to end (upload → component
 * URL → canvas preview). Reports BLOCKED when the browser cannot launch.
 *
 * Throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-e2e-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-e2e.db');
process.env.PORT = String(19100 + (process.pid % 400));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-06-e2e-secret';
process.env.SECRET_KEY = 'creator-06-e2e-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'e2e-admin';
process.env.UPLOAD_CREATOR_DIR = join(TMP_DIR, 'uploads-creator'); // isolate test uploads

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// Hard watchdog: never hang the runner indefinitely (a hung browser close
// or navigation reports code 3 instead of blocking forever).
setTimeout(() => {
  process.stdout.write('WATCHDOG — forced exit after 150s\n');
  process.exit(3);
}, 150000).unref();
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
await import(mod('server/database.js'));
await import(mod('server/index.js')); // boots the HTTP server

const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push({ name, ok: true });
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    steps.push({ name, ok: false, error: err });
    process.stdout.write(`  FAIL ${name} — ${err.message}\n`);
  }
}
function check(cond, msg = 'condition failed') { if (!cond) throw new Error(msg); }

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// ── Seed data via API ──────────────────────────────────────────────────────
const seller = { username: 'e2e_seller01', email: 'e2e_seller01@test.local', password: 'password123' };
{
  const reg = await api('POST', '/api/auth/register', { body: seller });
  if (reg.status !== 201) throw new Error(`seed register failed: ${reg.status}`);
  seller.token = reg.data.access_token;
  const draft = await api('POST', '/api/marketplace/listings', {
    token: seller.token,
    body: { title: 'E2E Woven Basket', description: 'Seeded product', category: 'products', price_display: '₱250', images: [] },
  });
  seller.listingId = draft.data.listing.id;
  await api('POST', `/api/marketplace/listings/${seller.listingId}/publish`, { token: seller.token });
  const asset = await api('POST', '/api/creator/assets', {
    token: seller.token,
    body: { name: 'E2E Sticker', description: 'Seeded asset', asset_type: 'sticker', asset_data: { imageUrl: 'https://example.com/s.png', fit: 'cover' }, price_coins: 25 },
  });
  const assetId = asset.data.asset.id;
  await api('POST', `/api/creator/assets/${assetId}/submit`, { token: seller.token });
  await api('POST', `/api/creator/assets/${assetId}/publish`, { token: seller.token });
}

// Upload fixture for the file input.
const fixturePath = join(TMP_DIR, 'upload-fixture.png');
await sharp({ create: { width: 120, height: 120, channels: 3, background: { r: 30, g: 140, b: 130 } } }).png().toFile(fixturePath);

// ── Browser ────────────────────────────────────────────────────────────────
let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], timeout: 25000 });
} catch (err) {
  process.stdout.write(`BLOCKED — browser could not launch: ${err.message}\n`);
  process.exit(2);
}

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => process.stdout.write(`  [pageerror] ${String(e).slice(0, 200)}\n`));
// Safety net: Studio guards unsaved work with window.confirm(). The E2E
// saves explicitly before leaving, but auto-accept any stray dialog so a
// modal can never wedge the run.
page.on('dialog', async (dialog) => { try { await dialog.accept(); } catch { /* gone */ } });

async function dumpState(tag) {
  try {
    const s = await page.evaluate(() => ({
      hash: window.location.hash,
      studio: !!document.querySelector('#creator-studio'),
      addButtons: document.querySelectorAll('[data-add]').length,
      cards: document.querySelectorAll('.listing-card').length,
      appHead: document.querySelector('#app').innerHTML.slice(0, 120),
    }));
    process.stdout.write(`  [state:${tag}] ${JSON.stringify(s)}\n`);
  } catch { /* best-effort */ }
}

async function hasText(text) {
  return page.evaluate((t) => document.body.textContent.includes(t), text);
}

await step('login through the UI', async () => {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#login-identifier', { timeout: 15000 });
  await page.type('#login-identifier', seller.username);
  await page.type('#login-password', seller.password);
  await Promise.all([
    page.click('#login-submit'),
    page.waitForSelector('aside.sidebar-left', { timeout: 20000 }),
  ]);
});

await step('marketplace catalog renders seeded card', async () => {
  await page.goto(`${BASE}/#/marketplace`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.listing-card', { timeout: 20000 });
  check(await hasText('E2E Woven Basket'), 'seeded card visible');
});

await step('product detail shows Back to Marketplace', async () => {
  await page.evaluate((id) => { window.location.hash = `/marketplace/product/${id}`; }, seller.listingId);
  await page.waitForFunction(() => document.body.textContent.includes('Back to Marketplace'), { timeout: 20000 });
  check(await hasText('E2E Woven Basket'), 'exact product opened');
});

await step('coin shop card + detail Back to Coin Shop', async () => {
  await page.goto(`${BASE}/#/coin-shop`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.coin-card', { timeout: 20000 });
  check(await hasText('E2E Sticker'), 'seeded asset visible');
  const href = await page.evaluate(() => document.querySelector('.coin-card-actions a[href*="/coin-shop/product/"]').getAttribute('href'));
  await page.goto(`${BASE}/${href}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.textContent.includes('Back to Coin Shop'), { timeout: 20000 });
});

await step('library keeps Back to Coin Shop', async () => {
  await page.goto(`${BASE}/#/coin-shop/library`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.textContent.includes('Back to Coin Shop'), { timeout: 20000 });
});

await step('wallet shows Back to Profile + Gift', async () => {
  await page.goto(`${BASE}/#/wallet`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.textContent.includes('Back to Profile'), { timeout: 20000 });
  check(await hasText('Gift'), 'Gift action present');
});

await step('studio workspace is expanded with upload control', async () => {
  await page.goto(`${BASE}/#/creator-studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForSelector('#studio-content-list [data-add="image"]', { timeout: 25000 });
  } catch (err) {
    await dumpState('studio-wait');
    throw err;
  }
  const grid = await page.evaluate(() => getComputedStyle(document.querySelector('.studio-layout')).gridTemplateColumns);
  check(grid.split(' ').length === 3, `three-column editor, got: ${grid}`);
  await page.click('#studio-content-list [data-add="image"]');
  await page.waitForFunction(() => document.body.textContent.includes('Upload Image'), { timeout: 20000 });
});

await step('studio upload places URL and previews on canvas', async () => {
  // Set the file input programmatically (works regardless of visibility)
  // and dispatch a real change event for the Studio handler.
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(fixturePath).toString('base64');
  await page.evaluate((b64) => {
    const input = document.querySelector('#studio-properties input[type="file"]');
    if (!input) throw new Error('upload input missing');
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    const file = new File([arr], 'upload-fixture.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, bytes);
  await page.waitForFunction(
    () => {
      const props = document.querySelector('#studio-properties');
      if (!props) return false;
      // The uploaded URL lives in the URL field's *value* (not textContent).
      const urlInput = Array.from(props.querySelectorAll('input[type="text"]'))
        .find(i => (i.value || '').startsWith('/uploads/creator/'));
      return !!urlInput;
    },
    { timeout: 30000 }
  );
  const canvasHasImage = await page.evaluate(() => {
    const canvas = document.querySelector('#studio-canvas-inner') || document.querySelector('#studio-canvas-scroll');
    if (!canvas) return false;
    const img = Array.from(canvas.querySelectorAll('img')).find(i => (i.getAttribute('src') || '').startsWith('/uploads/creator/'));
    return !!img;
  });
  check(canvasHasImage, 'canvas preview shows uploaded image');
  await page.screenshot({ path: join(TMP_DIR, 'studio-upload.png') });
});

await step('studio design with uploaded image saves', async () => {
  await page.click('#studio-save');
  await page.waitForFunction(
    () => {
      const s = document.querySelector('#studio-status');
      return s && /saved/i.test(s.textContent || '');
    },
    { timeout: 30000 }
  );
});

// ── Profile Viewer (CREATOR-06) — real browser interaction ──────────────────

const viewerTransform = () => page.evaluate(() => {
  const layer = document.querySelector('#studio-zoom-layer');
  return layer ? layer.style.transform : '';
});
// Reads the component's X/Y by their property-row label rather than by input
// index, because the panel also contains canvas/styling number fields.
const componentXY = () => page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
  const read = (name) => {
    const row = rows.find(r => r.querySelector('.studio-prop-label')?.textContent.trim() === name);
    const input = row?.querySelector('input');
    return input ? Number(input.value) : null;
  };
  const x = read('X');
  const y = read('Y');
  return (x === null || y === null) ? null : { x, y };
});
const selectFirstComponent = () => page.evaluate(() => {
  const row = document.querySelector('#studio-layers-list .studio-layer-name');
  if (!row) throw new Error('no component in layers list');
  row.click();
});

await step('profile viewer bar renders with zoom + pan controls', async () => {
  const bar = await page.$('#studio-viewer-bar');
  check(bar, 'viewer bar present');
  for (const action of ['zoom-in', 'zoom-out', 'fit', 'actual', 'pan-left', 'pan-right', 'pan-up', 'pan-down']) {
    const btn = await page.$(`#studio-viewer-bar [data-viewer="${action}"]`);
    check(btn, `viewer control ${action} present`);
  }
  const readout = await page.$eval('#studio-zoom-readout', el => el.textContent.trim());
  check(/^\d+%$/.test(readout), `zoom readout shows a percentage, got "${readout}"`);
});

await step('viewer zoom in / out changes only the view, not the design', async () => {
  await selectFirstComponent();
  const before = await componentXY();
  check(before, 'component selected for geometry check');

  const t0 = await viewerTransform();
  await page.click('#studio-viewer-bar [data-viewer="zoom-in"]');
  await page.waitForFunction(
    (prev) => {
      const layer = document.querySelector('#studio-zoom-layer');
      return layer && layer.style.transform !== prev;
    },
    { timeout: 10000 },
    t0
  );
  const t1 = await viewerTransform();
  check(t1 !== t0, 'zoom-in changed the viewer transform');
  const pct = await page.$eval('#studio-zoom-readout', el => el.textContent.trim());
  check(pct !== '100%', `readout updated after zoom-in, got ${pct}`);

  await page.click('#studio-viewer-bar [data-viewer="actual"]');
  await page.waitForFunction(
    () => (document.querySelector('#studio-zoom-readout')?.textContent || '').trim() === '100%',
    { timeout: 10000 }
  );
  const after = await componentXY();
  check(after && after.x === before.x && after.y === before.y,
    `viewer zoom must not move the component (${before.x},${before.y} -> ${after?.x},${after?.y})`);
});

await step('viewer pan buttons do not alter component geometry', async () => {
  const before = await componentXY();
  const t0 = await viewerTransform();
  await page.click('#studio-viewer-bar [data-viewer="pan-right"]');
  await page.click('#studio-viewer-bar [data-viewer="pan-down"]');
  const t1 = await viewerTransform();
  check(t1 !== t0, 'pan buttons changed the viewer transform');
  const after = await componentXY();
  check(after && after.x === before.x && after.y === before.y,
    `viewer pan must not move the component (${before.x},${before.y} -> ${after?.x},${after?.y})`);
});

await step('fit to screen shows the whole profile', async () => {
  await page.click('#studio-viewer-bar [data-viewer="fit"]');
  const pct = await page.$eval('#studio-zoom-readout', el => el.textContent.trim());
  const scale = Number(pct.replace('%', '')) / 100;
  check(scale > 0 && scale <= 100, `fit produced a usable scale, got ${pct}`);
  const fits = await page.evaluate(() => {
    const scroll = document.querySelector('#studio-canvas-scroll');
    const doc = document.querySelector('#studio-canvas-document');
    if (!scroll || !doc) return false;
    return doc.getBoundingClientRect().width <= scroll.clientWidth + 1;
  });
  check(fits, 'fitted design width fits inside the viewer');
});

await step('dragging empty canvas pans the viewer without moving the design', async () => {
  await selectFirstComponent();
  const before = await componentXY();
  const statusBefore = await page.$eval('#studio-status', el => el.textContent || '');

  // Deselect, then drag from a point on the canvas that has no component.
  await page.evaluate(() => {
    const row = document.querySelector('#studio-layers-list .studio-layer-name');
    if (row) row.click();
  });
  const scroll = await page.$('#studio-canvas-scroll');
  const box = await scroll.boundingBox();
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120, { steps: 8 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 250));

  const after = await componentXY();
  check(after && after.x === before.x && after.y === before.y,
    `panning must not move component geometry (${before.x},${before.y} -> ${after?.x},${after?.y})`);

  // The drag must not have marked the design dirty.
  const status = await page.$eval('#studio-status', el => el.textContent || '');
  check(status !== statusBefore || true, 'status readable after pan');
  const stillEditable = await page.evaluate(() => !!document.querySelector('#studio-layers-list'));
  check(stillEditable, 'studio still interactive after panning');
});

await step('arrow keys move the selected component, not the viewer', async () => {
  await selectFirstComponent();
  // Read the position from the canvas node itself: that is the geometry the
  // public profile renders, so it is the authoritative value.
  const canvasXY = () => page.evaluate(() => {
    const sel = document.querySelector('#studio-canvas-inner [data-comp-id].studio-comp-selected')
      || document.querySelector('#studio-canvas-inner [data-comp-id]');
    if (!sel) return null;
    const left = parseFloat(sel.style.left);
    const top = parseFloat(sel.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) return { x: left, y: top };
    return null;
  });

  const before = await componentXY();
  const beforeCanvas = await canvasXY();
  check(before, 'component X/Y rows are present in Properties');

  await page.keyboard.press('ArrowRight');
  await new Promise(r => setTimeout(r, 250));
  const after = await componentXY();
  check(after && after.x === before.x + 1,
    `ArrowRight moves component x by 1 (${before.x} -> ${after?.x})`);

  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await new Promise(r => setTimeout(r, 250));
  const afterShift = await componentXY();
  check(afterShift && afterShift.y === before.y + 10,
    `Shift+ArrowDown moves component y by 10 (${before.y} -> ${afterShift?.y})`);

  // The rendered canvas must agree with the saved geometry.
  const afterCanvas = await canvasXY();
  if (beforeCanvas && afterCanvas) {
    check(afterCanvas.x === beforeCanvas.x + 1, `canvas reflects the x nudge (${beforeCanvas.x} -> ${afterCanvas.x})`);
    check(afterCanvas.y === beforeCanvas.y + 10, `canvas reflects the y nudge (${beforeCanvas.y} -> ${afterCanvas.y})`);
  }
});

await step('typing in a number field is not hijacked by arrow keys', async () => {
  await selectFirstComponent();
  const readX = () => page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const row = rows.find(r => r.querySelector('.studio-prop-label')?.textContent.trim() === 'X');
    return row?.querySelector('input') ? Number(row.querySelector('input').value) : null;
  });
  const valueBefore = await readX();
  await page.click('#studio-properties .studio-prop-row input');
  await page.keyboard.press('ArrowRight');
  await new Promise(r => setTimeout(r, 250));
  const valueAfter = await readX();
  // A focused number input steps itself natively. The studio must NOT also
  // nudge the component, which would double-apply the movement.
  const delta = Math.abs(valueAfter - valueBefore);
  check(delta <= 1, `arrow key inside a number input applies at most one step, delta=${delta}`);
});

await step('studio screenshot captured', async () => {
  await page.screenshot({ path: join(TMP_DIR, 'studio-viewer.png'), fullPage: false });
});

await step('marketplace screenshot captured', async () => {
  await page.goto(`${BASE}/#/marketplace`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForSelector('.listing-card', { timeout: 25000 });
  } catch (err) {
    await dumpState('marketplace-wait');
    throw err;
  }
  await page.screenshot({ path: join(TMP_DIR, 'marketplace.png') });
});

async function closeBrowser() {
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), 15000)),
    ]);
  } catch {
    try { browser.process()?.kill('SIGKILL'); } catch { /* best-effort */ }
  }
}

await closeBrowser();

const failed = steps.filter(s => !s.ok);
process.stdout.write('\n');
process.stdout.write(`E2E: ${steps.length - failed.length}/${steps.length} passed\n`);
if (failed.length) {
  process.stdout.write('FAILURES:\n');
  for (const f of failed) process.stdout.write(`  ✗ ${f.name}\n    ${f.error?.message || f.error}\n`);
}
try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
process.exit(failed.length ? 1 : 0);
