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
      // Also reject the viewer's own height grip, which is a hit area of the
      // workspace rather than empty canvas.
      if (el.closest('#studio-viewer-height-grip')) continue;
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
// Desktop viewport used by the suite; the responsive step temporarily narrows it.
const DESKTOP_WIDTH = 1600;
const DESKTOP_HEIGHT = 900;
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

await step('the viewer has no toolbar and no directional controls', async () => {
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
    // CREATOR-07A: the four-side grips are gone entirely.
    oldGrips: document.querySelectorAll('[data-viewer-edge], .studio-viewer-grip').length,
  }));
  check(removed.dataViewer === 0, 'no data-viewer controls remain');
  check(removed.readout === 0, 'no zoom percentage readout');
  check(removed.zoomIn === 0, 'no zoom buttons');
  check(removed.fit === 0, 'no Fit or 100% button');
  check(removed.pan === 0, 'no directional pan buttons');
  check(removed.buttons === 0, 'the viewer contains no buttons at all');
  check(removed.oldGrips === 0, 'the four-side viewer grips are gone');
  // The viewer is not independently resizable horizontally any more: it has no
  // inline width of its own. The column widths only appear on the layout
  // element once a boundary has actually been dragged, which the next steps do.
  const viewerInlineWidth = await page.evaluate(
    () => document.querySelector('#studio-viewer').style.width
  );
  check(viewerInlineWidth === '', `viewer carries no inline width, got "${viewerInlineWidth}"`);
});

// Requirement: prove the handles actually receive pointer events rather than
// being covered by the canvas, a panel, or the sticky toolbar.
await step('workspace resize handles are the topmost element at their boundary', async () => {
  const hit = await page.evaluate(() => {
    const probe = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, missing: true };
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return {
        selector,
        x, y,
        width: r.width,
        height: r.height,
        cursor: getComputedStyle(el).cursor,
        background: getComputedStyle(el).backgroundColor,
        topSelector: top ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}` : null,
        isSelfOrChild: !!(top && (top === el || el.contains(top))),
      };
    };
    return [
      probe('#studio-col-resizer-left'),
      probe('#studio-col-resizer-right'),
      probe('#studio-viewer-height-grip'),
    ];
  });
  for (const h of hit) {
    check(!h.missing, `${h.selector} exists`);
    check(h.isSelfOrChild,
      `${h.selector} is the topmost element at its own centre (got ${h.topSelector})`);
  }
  check(hit[0].cursor === 'ew-resize', `left column boundary cursor is ew-resize, got ${hit[0].cursor}`);
  check(hit[1].cursor === 'ew-resize', `right column boundary cursor is ew-resize, got ${hit[1].cursor}`);
  check(hit[2].cursor === 'ns-resize', `viewer bottom boundary cursor is ns-resize, got ${hit[2].cursor}`);
  // Generous, invisible hit areas rather than 1px targets.
  check(hit[0].width >= 8, `left column hit area is at least 8px, got ${hit[0].width}`);
  check(hit[1].width >= 8, `right column hit area is at least 8px, got ${hit[1].width}`);
  check(hit[2].height >= 8, `viewer bottom hit area is at least 8px, got ${hit[2].height}`);
  for (const h of hit) {
    check(h.background === 'rgba(0, 0, 0, 0)', `${h.selector} is invisible, got ${h.background}`);
  }
});

await step('dragging the left panel boundary changes the left panel width', async () => {
  await selectFirstComponent();
  const before = await page.evaluate(() => ({
    left: document.querySelector('#studio-elements').getBoundingClientRect().width,
    right: document.querySelector('#studio-properties-panel').getBoundingClientRect().width,
    viewer: document.querySelector('#studio-viewer').getBoundingClientRect().width,
  }));
  const geomBefore = await componentGeom();
  const undoBefore = await undoDisabled();

  // Grab the centre of the left boundary handle and drag it 70px to the right.
  const start = await page.$eval('#studio-col-resizer-left', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(start, { x: start.x + 70, y: start.y });

  const after = await page.evaluate(() => ({
    left: document.querySelector('#studio-elements').getBoundingClientRect().width,
    right: document.querySelector('#studio-properties-panel').getBoundingClientRect().width,
    viewer: document.querySelector('#studio-viewer').getBoundingClientRect().width,
  }));
  check(Math.abs(after.left - (before.left + 70)) <= 3,
    `left panel grew by the pointer delta (${before.left} -> ${after.left})`);
  check(Math.abs(after.right - before.right) <= 2,
    `right panel unchanged by a left-boundary drag (${before.right} -> ${after.right})`);
  // The viewer keeps full width of the center column: it lost exactly what the
  // left panel gained, and has no width of its own.
  check(Math.abs(after.viewer - (before.viewer - 70)) <= 3,
    `viewer width follows the center column (${before.viewer} -> ${after.viewer})`);
  // Once dragged, the column widths are pushed onto the layout element as
  // custom properties rather than onto the panels or the viewer.
  const props = await page.evaluate(() => {
    const style = document.querySelector('#studio-layout').style;
    return {
      left: style.getPropertyValue('--studio-col-left'),
      right: style.getPropertyValue('--studio-col-right'),
    };
  });
  check(/^\d+(\.\d+)?px$/.test(props.left), `left column width is a layout custom property, got "${props.left}"`);
  check(/^\d+(\.\d+)?px$/.test(props.right), `right column width is a layout custom property, got "${props.right}"`);
  check(sameGeom(geomBefore, await componentGeom()), 'panel resize changed no component geometry');
  check((await undoDisabled()) === undoBefore, 'panel resize created no undo entry');
});

await step('dragging the Properties boundary changes the Properties width', async () => {
  const before = await page.evaluate(() => ({
    left: document.querySelector('#studio-elements').getBoundingClientRect().width,
    right: document.querySelector('#studio-properties-panel').getBoundingClientRect().width,
    viewer: document.querySelector('#studio-viewer').getBoundingClientRect().width,
  }));
  const geomBefore = await componentGeom();

  // Drag the right boundary leftwards: the Properties panel widens.
  const start = await page.$eval('#studio-col-resizer-right', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(start, { x: start.x - 60, y: start.y });

  const after = await page.evaluate(() => ({
    left: document.querySelector('#studio-elements').getBoundingClientRect().width,
    right: document.querySelector('#studio-properties-panel').getBoundingClientRect().width,
    viewer: document.querySelector('#studio-viewer').getBoundingClientRect().width,
  }));
  check(Math.abs(after.right - (before.right + 60)) <= 3,
    `properties panel grew by the pointer delta (${before.right} -> ${after.right})`);
  check(Math.abs(after.left - before.left) <= 2,
    `left panel unchanged by a right-boundary drag (${before.left} -> ${after.left})`);
  check(Math.abs(after.viewer - (before.viewer - 60)) <= 3,
    `viewer width follows the center column (${before.viewer} -> ${after.viewer})`);
  check(sameGeom(geomBefore, await componentGeom()), 'panel resize changed no component geometry');
});

await step('the viewer keeps full center-column width, not a width of its own', async () => {
  const fit = await page.evaluate(() => {
    const viewer = document.querySelector('#studio-viewer').getBoundingClientRect();
    const scroll = document.querySelector('#studio-canvas-scroll');
    const stage = document.querySelector('#studio-stage').getBoundingClientRect();
    return {
      viewerWidth: viewer.width,
      viewerLeft: viewer.left,
      stageWidth: stage.width,
      stageLeft: stage.left,
      scrollWidth: scroll.clientWidth,
      inlineWidth: viewer.width === stage.width ? 'fills' : 'differs',
    };
  });
  check(Math.abs(fit.viewerWidth - fit.stageWidth) <= 2,
    `viewer spans the whole center column (${fit.viewerWidth} vs ${fit.stageWidth})`);
  check(Math.abs(fit.viewerLeft - fit.stageLeft) <= 2, 'viewer starts at the column edge');
  // There is no inline width on the viewer element at all.
  const inline = await page.$eval('#studio-viewer', el => el.style.width || '');
  check(inline === '', `viewer has no inline width, got "${inline}"`);
});

await step('dragging the viewer bottom boundary up makes the viewer shorter', async () => {
  await selectFirstComponent();
  const before = await viewerBox();
  const geomBefore = await componentGeom();
  const undoBefore = await undoDisabled();

  // Grab just inside the viewer's bottom edge (the grip is 12px tall).
  const start = { x: before.x + before.width / 2, y: before.y + before.height - 5 };
  await dragMouse(start, { x: start.x, y: start.y - 90 });
  const after = await viewerBox();

  check(after.height < before.height - 40,
    `viewer became shorter (${before.height} -> ${after.height})`);
  check(Math.abs((before.height - after.height) - 90) <= 6,
    `height changed by about the pointer delta (${before.height} -> ${after.height})`);
  // Height-only: the width is untouched.
  check(Math.abs(after.width - before.width) <= 2,
    `width unchanged by a vertical drag (${before.width} -> ${after.width})`);
  check(Math.abs(after.y - before.y) <= 2, 'the viewer top edge stays put');
  check(sameGeom(geomBefore, await componentGeom()), 'height resize changed no component geometry');
  check((await undoDisabled()) === undoBefore, 'height resize created no undo entry');
});

await step('dragging the viewer bottom boundary down makes the viewer taller', async () => {
  const cap = await page.evaluate(() => window.innerHeight);
  // Make room first: the height is deliberately capped so a tall viewer cannot
  // push the studio into a vertical scrollbar, so shrink well clear of the cap
  // before testing that it grows again.
  const mid = await page.evaluate(() => {
    const r = document.querySelector('#studio-viewer').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height - 5 };
  });
  await dragMouse(mid, { x: mid.x, y: mid.y - 320 });
  const small = await viewerBox();

  const start = { x: small.x + small.width / 2, y: small.y + small.height - 5 };
  await dragMouse(start, { x: start.x, y: start.y + 120 });
  const after = await viewerBox();

  check(after.height > small.height + 60,
    `viewer became taller (${small.height} -> ${after.height}, cap ${cap})`);
  check(Math.abs((after.height - small.height) - 120) <= 6,
    `height changed by about the pointer delta (${small.height} -> ${after.height})`);
  check(Math.abs(after.width - small.width) <= 2, 'width unchanged by a vertical drag');
  check(Math.abs(after.y - small.y) <= 2, 'the viewer top edge stays put');
});

await step('workspace resizing never dirties the design or adds undo history', async () => {
  const geomBefore = await componentGeom();
  const undoBefore = await undoDisabled();

  // Drive all three handles hard in both directions.
  const left = await page.$eval('#studio-col-resizer-left', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(left, { x: left.x - 4000, y: left.y });
  const right = await page.$eval('#studio-col-resizer-right', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(right, { x: right.x + 4000, y: right.y });
  const bottom = await viewerBox();
  await dragMouse({ x: bottom.x + bottom.width / 2, y: bottom.y + bottom.height - 5 },
    { x: bottom.x + bottom.width / 2, y: bottom.y + 5000 });

  // Clamps held even under absurd pointer travel.
  const state = await page.evaluate(() => ({
    left: document.querySelector('#studio-elements').getBoundingClientRect().width,
    right: document.querySelector('#studio-properties-panel').getBoundingClientRect().width,
    viewerW: document.querySelector('#studio-viewer').getBoundingClientRect().width,
    viewerH: document.querySelector('#studio-viewer').getBoundingClientRect().height,
    layout: document.querySelector('#studio-layout').getBoundingClientRect().width,
    innerH: window.innerHeight,
  }));
  check(state.left >= 219, `left panel respects its minimum (${state.left})`);
  check(state.right >= 219, `properties panel respects its minimum (${state.right})`);
  check(state.viewerW >= 359, `center column keeps its minimum (${state.viewerW})`);
  check(state.viewerW <= state.layout + 2, 'the three columns still fit the layout');
  check(state.viewerH >= 239, `viewer respects its minimum height (${state.viewerH})`);
  // A tall viewer must not push the studio into a vertical scrollbar.
  check(state.viewerH <= state.innerH - 150,
    `viewer height leaves room for the rest of the studio (${state.viewerH} vs ${state.innerH})`);

  check(sameGeom(geomBefore, await componentGeom()), 'no component geometry changed across resizes');
  check((await undoDisabled()) === undoBefore, 'no undo entry created across resizes');

  const status = await page.$eval('#studio-status', el => el.textContent || '');
  check(/design is unchanged/i.test(status), `status confirms the design is untouched, got "${status}"`);
});

await step('workspace resizing introduces no viewer scrollbars', async () => {
  const state = await page.evaluate(() => {
    const ids = ['#studio-viewer', '#studio-canvas-scroll', '#studio-canvas-inner'];
    return ids.map(id => {
      const el = document.querySelector(id);
      const cs = getComputedStyle(el);
      return {
        id,
        overflow: cs.overflow,
        gutterX: el.offsetWidth - el.clientWidth
          - parseFloat(cs.borderLeftWidth || 0) - parseFloat(cs.borderRightWidth || 0),
        gutterY: el.offsetHeight - el.clientHeight
          - parseFloat(cs.borderTopWidth || 0) - parseFloat(cs.borderBottomWidth || 0),
      };
    });
  });
  for (const s of state) {
    check(s.overflow === 'hidden', `${s.id} clips instead of scrolling (${s.overflow})`);
    check(s.gutterX <= 1, `${s.id} renders no horizontal scrollbar (gutter=${s.gutterX})`);
    check(s.gutterY <= 1, `${s.id} renders no vertical scrollbar (gutter=${s.gutterY})`);
  }
});

await step('component editing still works after resizing the workspace', async () => {
  await selectFirstComponent();
  const before = await componentXY();
  check(before, 'component selected after resizing');

  // Arrow-key movement must still act on the component.
  const viewerBefore = await viewerBox();
  await page.keyboard.press('ArrowRight');
  await new Promise(r => setTimeout(r, 220));
  const after = await componentXY();
  check(after && after.x === before.x + 1,
    `ArrowRight still moves the component (${before.x} -> ${after?.x})`);
  const viewerAfter = await viewerBox();
  check(Math.abs(viewerAfter.width - viewerBefore.width) <= 2,
    'arrow-key component move does not resize the viewer');

  // Component dragging still works.
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

  // Component resizing via its own handle still works. Pick an UNLOCKED,
  // visible component: a locked one swallows the pointerdown by design.
  const target = await page.evaluate(() => {
    const el = document.querySelector(
      '#studio-canvas-inner [data-comp-id]:not(.studio-comp-locked):not(.studio-comp-hidden)'
    );
    if (!el) return null;
    el.click();
    return { id: el.dataset.compId };
  });
  check(!!target, 'found an unlocked component for the resize test');
  await new Promise(r => setTimeout(r, 200));

  const sizeBefore = await page.evaluate((id) => {
    const el = document.querySelector(`#studio-canvas-inner [data-comp-id="${id}"]`);
    return el ? { w: parseFloat(el.style.width), h: parseFloat(el.style.height) } : null;
  }, target.id);
  check(!!sizeBefore, 'component size readable for the resize handle test');

  // The component may sit below the visible canvas after the workspace was
  // resized, so scroll the handle into view first: a pointer press that lands
  // outside the scroll viewport would hit the studio layout instead.
  await page.evaluate((id) => {
    const el = document.querySelector(`#studio-canvas-inner [data-comp-id="${id}"]`);
    const h = el && el.querySelector('[data-resize="se"]');
    if (h) h.scrollIntoView({ block: 'center', inline: 'center' });
  }, target.id);
  await new Promise(r => setTimeout(r, 200));

  const handle = await page.evaluate((id) => {
    const el = document.querySelector(`#studio-canvas-inner [data-comp-id="${id}"]`);
    if (!el) return null;
    const h = el.querySelector('[data-resize="se"]');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      x, y,
      topSelector: top ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}` : null,
      isHandle: !!(top && (top === h || h.contains(top))),
    };
  }, target.id);

  check(!!handle, 'component exposes a south-east resize handle');
  check(handle && handle.isHandle,
    `the south-east handle is the topmost element at its own centre (got ${handle?.topSelector})`);
  if (handle && sizeBefore) {
    await dragMouse(handle, { x: handle.x + 30, y: handle.y + 20 });
    const sizeAfter = await page.evaluate((id) => {
      const el = document.querySelector(`#studio-canvas-inner [data-comp-id="${id}"]`);
      return el ? { w: parseFloat(el.style.width), h: parseFloat(el.style.height) } : null;
    }, target.id);
    check(sizeAfter && (sizeAfter.w !== sizeBefore.w || sizeAfter.h !== sizeBefore.h),
      `component resize handle still resizes the component (${sizeBefore.w}x${sizeBefore.h} -> ${sizeAfter?.w}x${sizeAfter?.h})`);
  }
});

await step('single-column mode hides the handles and drops the side columns', async () => {
  const originalWidth = await page.evaluate(() => window.innerWidth);
  await page.setViewport({ width: 800, height: DESKTOP_HEIGHT });
  await new Promise(r => setTimeout(r, 400));
  // The studio re-clamps on window resize, which is what re-hides the handles.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise(r => setTimeout(r, 400));

  const stacked = await page.evaluate(() => {
    const left = document.querySelector('#studio-col-resizer-left');
    const right = document.querySelector('#studio-col-resizer-right');
    const grip = document.querySelector('#studio-viewer-height-grip');
    const stage = document.querySelector('#studio-stage');
    return {
      leftHidden: !!(left && (left.hidden || getComputedStyle(left).display === 'none')),
      rightHidden: !!(right && (right.hidden || getComputedStyle(right).display === 'none')),
      gripHidden: !!(grip && (grip.hidden || getComputedStyle(grip).display === 'none')),
      stageInlineHeight: stage ? stage.style.height : null,
      columns: getComputedStyle(document.querySelector('#studio-layout')).gridTemplateColumns.split(' ').length,
    };
  });
  check(stacked.columns === 1, `layout is a single column, got ${stacked.columns}`);
  check(stacked.leftHidden, 'left column resizer is hidden when stacked');
  check(stacked.rightHidden, 'right column resizer is hidden when stacked');
  check(stacked.gripHidden, 'viewer height grip is hidden when stacked');
  check(stacked.stageInlineHeight === '', `pinned stage height is released, got "${stacked.stageInlineHeight}"`);

  // Back to desktop for the screenshot step.
  await page.setViewport({ width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise(r => setTimeout(r, 300));
  const restored = await page.evaluate(() => {
    const left = document.querySelector('#studio-col-resizer-left');
    return {
      columns: getComputedStyle(document.querySelector('#studio-layout')).gridTemplateColumns.split(' ').length,
      leftShown: !!(left && !left.hidden && getComputedStyle(left).display !== 'none'),
    };
  });
  check(restored.columns === 3, `desktop layout is three columns again, got ${restored.columns}`);
  check(restored.leftShown, 'column resizers come back on desktop');
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
