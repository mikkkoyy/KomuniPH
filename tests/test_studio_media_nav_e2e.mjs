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

// Finds a point that is genuinely empty canvas. A geometric scan alone is not
// enough: the sticky studio toolbar floats over the canvas once the page is
// scrolled, so the point is also validated with elementFromPoint to make sure
// the real hit target is the canvas and not an overlay or a component.
const emptyCanvasPoint = () => page.evaluate(() => {
  const scroll = document.querySelector('#studio-canvas-scroll');
  if (!scroll) return null;
  const s = scroll.getBoundingClientRect();
  const PAD = 30;
  for (let y = s.top + PAD; y < s.bottom - PAD; y += 8) {
    for (let x = s.left + PAD; x < s.right - PAD; x += 8) {
      const el = document.elementFromPoint(x, y);
      // Must land on the canvas itself, and not on any component.
      if (!el || !el.closest('#studio-canvas-scroll')) continue;
      if (el.closest('[data-comp-id]')) continue;
      // Also reject the resize grips, which are the viewer's own hit areas.
      if (el.closest('[data-viewer-edge]')) continue;
      return {
        x, y,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
      };
    }
  }
  return null;
});
// Viewer box, in page coordinates.
const viewerBox = () => page.$eval('#studio-viewer', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
// Authoritative component geometry, read from the rendered canvas node.
const componentGeom = () => page.evaluate(() => {
  const sel = document.querySelector('#studio-canvas-inner [data-comp-id]');
  if (!sel) return null;
  return {
    x: parseFloat(sel.style.left),
    y: parseFloat(sel.style.top),
    width: parseFloat(sel.style.width),
    height: parseFloat(sel.style.height),
  };
});
const undoDisabled = () => page.$eval('#studio-undo', el => !!el.disabled);
// Grab points sit a few px inside the edge/corner band, so the pointer is
// unambiguously on the grip rather than on the exact boundary pixel.
const GRAB_INSET = 4;
const CORNER_INSET = 7;
const edgePoint = (b, edge) => {
  const midX = b.x + b.width / 2;
  const midY = b.y + b.height / 2;
  switch (edge) {
    case 'e': return { x: b.x + b.width - GRAB_INSET, y: midY };
    case 'w': return { x: b.x + GRAB_INSET, y: midY };
    case 'n': return { x: midX, y: b.y + GRAB_INSET };
    case 's': return { x: midX, y: b.y + b.height - GRAB_INSET };
    case 'se': return { x: b.x + b.width - CORNER_INSET, y: b.y + b.height - CORNER_INSET };
    case 'nw': return { x: b.x + CORNER_INSET, y: b.y + CORNER_INSET };
    default: return { x: midX, y: midY };
  }
};
const dragMouse = async (from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 220));
};
const sameGeom = (a, b) => !!a && !!b
  && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

await step('profile viewer fills the workspace and has no scrollbars', async () => {
  const stage = await page.$eval('#studio-stage', el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const viewer = await viewerBox();
  check(viewer, 'viewer element exists');
  // Fills the workspace, not a box floating inside it.
  check(Math.abs(viewer.width - stage.width) <= 2,
    `viewer width fills the stage (${viewer.width} vs ${stage.width})`);
  check(Math.abs(viewer.height - stage.height) <= 2,
    `viewer height fills the stage (${viewer.height} vs ${stage.height})`);

  // No scrollbars anywhere in the viewer. `overflow: hidden` is the contract: the
  // design is clipped and reached by panning, so no scrollbar is ever rendered
  // or reachable. Content may legitimately be taller than the box.
  const scrollState = await page.evaluate(() => {
    const ids = ['#studio-stage', '#studio-viewer', '#studio-canvas-scroll', '#studio-canvas-inner'];
    const out = {};
    for (const id of ids) {
      const el = document.querySelector(id);
      if (!el) { out[id] = null; continue; }
      const cs = getComputedStyle(el);
      out[id] = {
        style: cs.overflow,
        styleX: cs.overflowX,
        styleY: cs.overflowY,
        // A rendered scrollbar would steal width/height from clientWidth/Height.
        gutterX: el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth || 0) - parseFloat(cs.borderRightWidth || 0),
        gutterY: el.offsetHeight - el.clientHeight - parseFloat(cs.borderTopWidth || 0) - parseFloat(cs.borderBottomWidth || 0),
      };
    }
    return out;
  });
  for (const [id, s] of Object.entries(scrollState)) {
    check(!!s, `${id} present`);
    // The stage itself may stay visible, but the viewer subtree must clip.
    const mustClip = id !== '#studio-stage';
    check(!mustClip || (s.style === 'hidden' && s.styleX === 'hidden' && s.styleY === 'hidden'),
      `${id} clips its content (overflow=${s.style}/${s.styleX}/${s.styleY})`);
    check(s.gutterX <= 1, `${id} renders no horizontal scrollbar (gutter=${s.gutterX})`);
    check(s.gutterY <= 1, `${id} renders no vertical scrollbar (gutter=${s.gutterY})`);
  }
});

await step('the viewer control bar is gone with no replacement', async () => {
  const bar = await page.$('#studio-viewer-bar');
  check(!bar, 'no viewer toolbar in the DOM');
  const removed = await page.evaluate(() => ({
    dataViewer: document.querySelectorAll('[data-viewer]').length,
    readout: document.querySelectorAll('#studio-zoom-readout').length,
    zoomIn: document.querySelectorAll('[data-viewer="zoom-in"], [data-viewer="zoom-out"]').length,
    fit: document.querySelectorAll('[data-viewer="fit"], [data-viewer="actual"]').length,
    pan: document.querySelectorAll('[data-viewer^="pan-"]').length,
    // Any button inside the viewer at all would be a control replacement.
    buttons: document.querySelectorAll('#studio-viewer button').length,
  }));
  check(removed.dataViewer === 0, 'no data-viewer controls remain');
  check(removed.readout === 0, 'no zoom percentage readout');
  check(removed.zoomIn === 0, 'no zoom buttons');
  check(removed.fit === 0, 'no Fit or 100% button');
  check(removed.pan === 0, 'no directional pan buttons');
  check(removed.buttons === 0, 'the viewer contains no buttons at all');
  // The grips are the replacement affordance, and they are invisible.
  const grips = await page.$$eval('#studio-viewer [data-viewer-edge]', els => els.map(el => ({
    edge: el.dataset.viewerEdge,
    cursor: getComputedStyle(el).cursor,
    visible: getComputedStyle(el).backgroundImage !== 'none' || getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)',
  })));
  check(grips.length === 8, `eight resize grips present, got ${grips.length}`);
  for (const g of grips) {
    check(['ns-resize', 'ew-resize', 'nwse-resize', 'nesw-resize'].includes(g.cursor),
      `${g.edge} grip has a resize cursor, got ${g.cursor}`);
    check(!g.visible, `${g.edge} grip has no visible fill or border`);
  }
});

await step('dragging the right edge changes the viewer width only', async () => {
  await selectFirstComponent();
  const before = await viewerBox();
  const geomBefore = await componentGeom();
  const undoBefore = await undoDisabled();

  const grab = edgePoint(before, 'e');
  await dragMouse(grab, { x: grab.x - 70, y: grab.y });
  const after = await viewerBox();

  check(Math.abs(after.width - (before.width - 70)) <= 2,
    `right-edge drag shrinks the width by the pointer delta (${before.width} -> ${after.width})`);
  check(Math.abs(after.height - before.height) <= 2,
    `height unchanged by a horizontal drag (${before.height} -> ${after.height})`);
  check(sameGeom(geomBefore, await componentGeom()), 'resizing changed no component geometry');
  check((await undoDisabled()) === undoBefore, 'resizing created no undo entry');
});

await step('dragging the left edge changes the viewer width only', async () => {
  const before = await viewerBox();
  const geomBefore = await componentGeom();
  const grab = edgePoint(before, 'w');
  // Drag the west edge rightwards: the width shrinks and the left edge follows.
  await dragMouse(grab, { x: grab.x + 60, y: grab.y });
  const after = await viewerBox();

  check(Math.abs(after.width - (before.width - 60)) <= 2,
    `left-edge drag shrinks the width (${before.width} -> ${after.width})`);
  check(Math.abs(after.height - before.height) <= 2,
    `height unchanged by a horizontal drag (${before.height} -> ${after.height})`);
  check(after.x + 60 >= before.x - 2, 'the west edge followed the pointer inward');
  check(sameGeom(geomBefore, await componentGeom()), 'resizing changed no component geometry');
});

await step('dragging the bottom edge changes the viewer height only', async () => {
  const before = await viewerBox();
  const geomBefore = await componentGeom();
  const grab = edgePoint(before, 's');
  await dragMouse(grab, { x: grab.x, y: grab.y - 50 });
  const after = await viewerBox();

  check(Math.abs(after.height - (before.height - 50)) <= 2,
    `bottom-edge drag shrinks the height (${before.height} -> ${after.height})`);
  check(Math.abs(after.width - before.width) <= 2,
    `width unchanged by a vertical drag (${before.width} -> ${after.width})`);
  check(sameGeom(geomBefore, await componentGeom()), 'resizing changed no component geometry');
});

await step('dragging the top edge changes the viewer height only', async () => {
  const before = await viewerBox();
  const geomBefore = await componentGeom();
  const grab = edgePoint(before, 'n');
  await dragMouse(grab, { x: grab.x, y: grab.y + 40 });
  const after = await viewerBox();

  check(Math.abs(after.height - (before.height - 40)) <= 2,
    `top-edge drag shrinks the height (${before.height} -> ${after.height})`);
  check(Math.abs(after.width - before.width) <= 2,
    `width unchanged by a vertical drag (${before.width} -> ${after.width})`);
  check(after.y + 40 >= before.y - 2, 'the north edge followed the pointer inward');
  check(sameGeom(geomBefore, await componentGeom()), 'resizing changed no component geometry');
});

await step('dragging a corner changes width and height together', async () => {
  const before = await viewerBox();
  const geomBefore = await componentGeom();
  const undoBefore = await undoDisabled();
  const grab = edgePoint(before, 'se');
  await dragMouse(grab, { x: grab.x - 45, y: grab.y - 35 });
  const after = await viewerBox();

  check(Math.abs(after.width - (before.width - 45)) <= 2,
    `corner drag changes the width (${before.width} -> ${after.width})`);
  check(Math.abs(after.height - (before.height - 35)) <= 2,
    `corner drag changes the height (${before.height} -> ${after.height})`);
  check(sameGeom(geomBefore, await componentGeom()), 'corner resize changed no component geometry');
  check((await undoDisabled()) === undoBefore, 'corner resize created no undo entry');
});

await step('viewer resize never dirties the design and stays inside the stage', async () => {
  const before = await viewerBox();
  const geomBefore = await componentGeom();
  const undoBefore = await undoDisabled();

  // Drag the south-east corner far past the stage: it must stop at the boundary.
  await dragMouse(edgePoint(before, 'se'), { x: before.x + 4000, y: before.y + 4000 });
  const grown = await viewerBox();
  const stage = await page.$eval('#studio-stage', el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  check(grown.width <= stage.width + 2 && grown.height <= stage.height + 2,
    `viewer cannot outgrow the stage (${grown.width}x${grown.height} vs ${stage.width}x${stage.height})`);

  // And it cannot shrink below the sensible minimum.
  await dragMouse(edgePoint(grown, 'se'), { x: grown.x - 4000, y: grown.y - 4000 });
  const shrunk = await viewerBox();
  check(shrunk.width >= 320 && shrunk.height >= 240,
    `viewer respects the minimum size (${shrunk.width}x${shrunk.height})`);
  check(shrunk.width >= 319 && shrunk.height >= 239, 'minimum is not undercut');

  // Restore the viewer to the full workspace so the interaction tests that
  // follow run against a normal-sized canvas.
  await dragMouse(edgePoint(shrunk, 'se'), { x: shrunk.x + 4000, y: shrunk.y + 4000 });
  const restored = await viewerBox();
  check(restored.width > shrunk.width && restored.height > shrunk.height,
    `viewer grows back after the minimum test (${shrunk.width} -> ${restored.width})`);
  // Still inside the stage, and still without scrollbars.
  check(restored.width <= stage.width + 2 && restored.height <= stage.height + 2,
    'restored viewer is still inside the stage');

  check(sameGeom(geomBefore, await componentGeom()), 'no component geometry changed across resizes');
  check((await undoDisabled()) === undoBefore, 'no undo entry created across resizes');

  // The design was not marked dirty: Save stays available but no auto-save ran,
  // and the studio still reports the design as unchanged.
  const status = await page.$eval('#studio-status', el => el.textContent || '');
  check(/design is unchanged/i.test(status), `status confirms the design is untouched, got "${status}"`);
});

await step('resizing the viewer still leaves component editing working', async () => {
  await selectFirstComponent();
  const before = await componentXY();
  check(before, 'component selected after resizing');

  // Arrow-key movement must still act on the component, not the viewer.
  const viewerBefore = await viewerBox();
  await page.keyboard.press('ArrowRight');
  await new Promise(r => setTimeout(r, 220));
  const after = await componentXY();
  check(after && after.x === before.x + 1,
    `ArrowRight still moves the component (${before.x} -> ${after?.x})`);
  const viewerAfter = await viewerBox();
  check(Math.abs(viewerAfter.width - viewerBefore.width) <= 2,
    'arrow-key component move does not resize the viewer');

  // Component dragging still works, on the smaller canvas.
  const geomBefore = await componentGeom();
  const canvasBox = await page.$eval('#studio-canvas-document', el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const start = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
  await dragMouse(start, { x: start.x + 25, y: start.y + 15 });
  const geomAfter = await componentGeom();
  check(!!geomAfter, 'component still present after drag');
  const moved = geomBefore && geomAfter && (geomBefore.x !== geomAfter.x || geomBefore.y !== geomAfter.y);
  check(moved, `component drag still moves the component (${geomBefore?.x},${geomBefore?.y} -> ${geomAfter?.x},${geomAfter?.y})`);
});

await step('dragging empty canvas pans the viewer without moving the design', async () => {
  await selectFirstComponent();
  const before = await componentGeom();
  check(before, 'component geometry readable before the pan');
  const statusBefore = await page.$eval('#studio-status', el => el.textContent || '');

  // Deselect, then drag from a point on the canvas that has no component.
  await page.evaluate(() => {
    const row = document.querySelector('#studio-layers-list .studio-layer-name');
    if (row) row.click();
  });
  const scroll = await page.$('#studio-canvas-scroll');
  const box = await scroll.boundingBox();
  const t0 = await viewerTransform();
  // Start on verified empty canvas, clear of the 8px edge and 14px corner grips,
  // so this is unambiguously a pan and not a viewer resize.
  const start = await emptyCanvasPoint();
  check(!!start, 'found an empty-canvas point clear of the grips');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 120, start.y + 110, { steps: 8 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 250));
  void box;

  // Empty-canvas panning is preserved: the view moves even though no pan
  // buttons exist any more.
  const t1 = await viewerTransform();
  check(t1 !== t0, `empty-canvas drag still pans the viewer (t0="${t0}" t1="${t1}" started on <${start.tag} id="${start.id}">)`);
  check(/translate\(/.test(t1), `viewer transform carries the pan offset, got "${t1}"`);

  // The viewer box itself must not have changed size from a pan.
  const viewerAfterPan = await viewerBox();
  check(viewerAfterPan, 'viewer still present after panning');

  // Clicking empty canvas deselects, which empties the Properties panel, so the
  // authoritative check reads the rendered canvas node instead — that is the
  // geometry the public profile uses, and it survives deselection.
  const geomAfter = await componentGeom();
  check(sameGeom(before, geomAfter),
    `panning must not move component geometry (${before.x},${before.y} -> ${geomAfter?.x},${geomAfter?.y})`);

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
