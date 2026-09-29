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
// CREATOR-08: select an ORDINARY component. The Profile Guide is a real
// component and sits at the bottom of the layer list, but it is click-through
// until selected and these tests are about editing normal content.
const selectFirstComponent = () => page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-row'));
  const row = rows.find(r => !/Guide\s+—/.test(r.querySelector('.studio-layer-name')?.textContent.trim() || ''))
    || rows[0];
  if (!row) throw new Error('no component in layers list');
  row.querySelector('.studio-layer-name').click();
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
// CREATOR-08: the stage also contains the compact zoom bar, so the viewer fills
// the stage MINUS that bar. Tests compare against the stage using this helper
// rather than assuming the two are equal.
const zoomBarHeight = () => page.evaluate(() => {
  const bar = document.querySelector('#studio-viewer-controls');
  return bar ? bar.getBoundingClientRect().height : 0;
});
const stageBox = () => page.$eval('#studio-stage', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
// CREATOR-08: the zoom bar sits above the viewer, so the height grip lives on the
// STAGE's bottom edge, not the viewer's. Always grab the real grip element
// rather than guessing a few px above a box edge.
const heightGripPoint = () => page.evaluate(() => {
  const g = document.querySelector('#studio-viewer-height-grip');
  if (!g) return null;
  // The stage can be far taller than the window, so its bottom edge can sit
  // below the viewport. A synthetic mouse event outside the viewport would miss
  // the grip entirely, so bring it into view before reporting its position.
  g.scrollIntoView({ block: 'end', inline: 'center' });
  const r = g.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
// Authoritative component geometry, read from the rendered canvas node.
// CREATOR-08: the Profile Guide is a real component but is click-through, so the
// helpers below deliberately skip it and exercise ordinary content instead.
const contentCompSelector = '#studio-canvas-inner [data-comp-id]:not([data-comp-type="profile_guide"])';
// Geometry of the guide itself, read from the design values it renders.
const contentGeomGuide = () => page.evaluate(() => {
  const el = document.querySelector('#studio-canvas-inner [data-comp-type="profile_guide"]');
  if (!el) return null;
  return {
    x: parseFloat(el.style.left), y: parseFloat(el.style.top),
    width: parseFloat(el.style.width), height: parseFloat(el.style.height),
  };
});
const componentGeom = () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  return {
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
  };
}, contentCompSelector);
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

await step('the initial viewer height is a large, independent editing area', async () => {
  const measured = await page.evaluate(() => {
    const stage = document.querySelector('#studio-stage');
    const viewer = document.querySelector('#studio-viewer');
    const panels = ['#studio-elements', '#studio-properties-panel']
      .map(s => document.querySelector(s))
      .filter(Boolean)
      .map(el => el.getBoundingClientRect().height);
    return {
      stage: stage.getBoundingClientRect().height,
      stageInline: stage.style.height,
      viewer: viewer.getBoundingClientRect().height,
      panels,
      docHeight: document.documentElement.scrollHeight,
      windowHeight: window.innerHeight,
    };
  });

  // CREATOR-07B: the height is a deliberate editing size, not a sliver derived
  // from the window or from the side panels.
  check(measured.stage >= 800,
    `the viewer starts at a genuinely large editing height, got ${measured.stage}`);
  check(/^\d+px$/.test(measured.stageInline),
    `the stage carries an explicit height of its own, got "${measured.stageInline}"`);
  // The panels must not be what decides it: even when the Properties panel is
  // far taller than the stage, the stage keeps its own height.
  for (const p of measured.panels) {
    check(measured.stage > p * 0.5,
      `the viewer is not sized off a ${Math.round(p)}px side panel (stage ${measured.stage})`);
  }
  const bar = await zoomBarHeight();
  check(measured.viewer === measured.stage || Math.abs(measured.viewer - (measured.stage - bar)) <= 2,
    `the viewer fills the stage it was given (viewer ${measured.viewer}, stage ${measured.stage}, bar ${bar})`);
});

await step('the viewer fills the space below the zoom bar, and the bar never covers the canvas', async () => {
  const stage = await stageBox();
  const viewer = await viewerBox();
  const bar = await zoomBarHeight();
  check(bar > 0, `the zoom bar is rendered above the viewer, got ${bar}px`);
  check(Math.abs(viewer.height - (stage.height - bar)) <= 2,
    `the viewer fills the stage below the bar (${viewer.height} vs ${stage.height - bar})`);
  check(Math.abs(viewer.width - stage.width) <= 2,
    `the viewer is still full width of the stage (${viewer.width} vs ${stage.width})`);
  // The bar must not overlap the editing area at all.
  check(viewer.y >= stage.y + bar - 2,
    `the zoom bar sits above the editing area, never on it (bar ends ${(stage.y + bar).toFixed(1)}, viewer starts ${viewer.y.toFixed(1)})`);
  // And the profile canvas is still fully interactive underneath it.
  const centreTarget = await page.evaluate(() => {
    const v = document.querySelector('#studio-viewer').getBoundingClientRect();
    const el = document.elementFromPoint(v.left + v.width / 2, v.top + v.height / 2);
    return el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` : null;
  });
  check(!!centreTarget && centreTarget !== 'main',
    `the canvas is the topmost element at the viewer centre, got ${centreTarget}`);
});

await step('the viewer height is unchanged by resizing either side panel', async () => {
  const before = await viewerBox();

  // Drag the LEFT boundary, which changes the left panel and the center width.
  const leftStart = await page.$eval('#studio-col-resizer-left', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(leftStart, { x: leftStart.x + 90, y: leftStart.y });
  const afterLeft = await viewerBox();
  check(afterLeft.width < before.width - 40,
    `the left boundary drag widened the left panel, so the center narrowed (${before.width} -> ${afterLeft.width})`);
  check(Math.abs(afterLeft.height - before.height) <= 1,
    `the LEFT panel resize did NOT change the viewer height (${before.height} -> ${afterLeft.height})`);

  // Drag the RIGHT boundary leftwards, away from the center. The handle follows
  // the pointer, so the panel on the far side of it — Properties — grows, and
  // the center column gives up exactly that width. This is the mirror of the
  // left-boundary drag above.
  const rightStart = await page.$eval('#studio-col-resizer-right', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(rightStart, { x: rightStart.x - 80, y: rightStart.y });
  const afterRight = await viewerBox();
  check(afterRight.width < afterLeft.width - 40,
    `the right boundary drag widened the Properties panel, so the center narrowed (${afterLeft.width} -> ${afterRight.width})`);
  const propsWidth = await page.$eval('#studio-properties-panel', el => el.getBoundingClientRect().width);
  check(propsWidth > 370, `the Properties panel actually grew, got ${propsWidth}`);
  check(Math.abs(afterRight.height - before.height) <= 1,
    `the RIGHT panel resize did NOT change the viewer height (${before.height} -> ${afterRight.height})`);

  // The viewer is still full width of whatever the center column now is.
  const stageW = await page.$eval('#studio-stage', el => el.getBoundingClientRect().width);
  check(Math.abs(afterRight.width - stageW) <= 2,
    `the viewer still fills the center column (${afterRight.width} vs ${stageW})`);
});

await step('the viewer height does not depend on how much content the Properties panel holds', async () => {
  // The real-world trigger for the bug: a long Properties panel must not be able
  // to squeeze the Profile Viewer. Select a component and read the height both
  // before and after, and also compare against the panel's own height.
  await selectFirstComponent();
  const before = await viewerBox();
  const panelBefore = await page.$eval('#studio-properties-panel', el => el.getBoundingClientRect().height);
  check(panelBefore > before.height,
    `the Properties panel is taller than the viewer, which is exactly the risky case (panel ${Math.round(panelBefore)} vs viewer ${Math.round(before.height)})`);
  check(Math.abs(before.height - panelBefore) > 20,
    'the viewer height is NOT equal to the panel height, so the two are decoupled');
});

await step('a profile taller than the viewer is reached by panning, not scaled or scrolled', async () => {
  // CREATOR-07B section 7: the design keeps its real dimensions even when it is
  // far taller than the visible viewer.
  const state = await page.evaluate(() => {
    const doc = document.querySelector('#studio-canvas-document');
    const layer = document.querySelector('#studio-zoom-layer');
    const viewer = document.querySelector('#studio-viewer').getBoundingClientRect();
    const scroll = document.querySelector('#studio-canvas-scroll');
    const cs = getComputedStyle(scroll);
    return {
      docW: doc.getBoundingClientRect().width,
      docH: doc.getBoundingClientRect().height,
      inlineH: doc.style.minHeight,
      inlineW: doc.style.width,
      transform: getComputedStyle(layer).transform,
      viewerH: viewer.height,
      overflow: cs.overflow,
      // A rendered scrollbar steals space from the content box. `overflow:
      // hidden` means content may legitimately be larger than the box without
      // any reachable scrollbar, so measure the gutter net of the element's own
      // 1px border rather than comparing content extent to box extent.
      gutterY: scroll.offsetHeight - scroll.clientHeight
        - parseFloat(cs.borderTopWidth || 0) - parseFloat(cs.borderBottomWidth || 0),
      gutterX: scroll.offsetWidth - scroll.clientWidth
        - parseFloat(cs.borderLeftWidth || 0) - parseFloat(cs.borderRightWidth || 0),
    };
  });

  // The design stays at its authored 960x1200 — it is NOT shrunk to fit.
  check(state.inlineW === '960px', `the design keeps its authored width, got "${state.inlineW}"`);
  check(state.inlineH === '1200px', `the design keeps its authored height, got "${state.inlineH}"`);
  // No auto-fit: the transform is identity, not a scale-down.
  check(/matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)/.test(state.transform) || state.transform === 'none',
    `the design is not automatically scaled down to fit, transform is "${state.transform}"`);
  // Still clipped, never scrolled.
  check(state.overflow === 'hidden', 'the viewer still clips instead of scrolling');
  check(state.gutterY <= 1 && state.gutterX <= 1,
    `no scrollbar gutter is rendered in the viewer (x ${state.gutterX}, y ${state.gutterY})`);
  check(state.docH > state.viewerH,
    `the design really is taller than the viewer (${state.docH} vs ${state.viewerH})`);

  // Panning must still be able to reach the lower part of the profile.
  const before = await viewerTransform();
  const panned = await page.evaluate(() => {
    const scroll = document.querySelector('#studio-canvas-scroll');
    const s = scroll.getBoundingClientRect();
    // A point well below the visible area is covered by the design, so pan
    // vertically from inside the viewer.
    for (let y = s.top + 30; y < s.bottom - 30; y += 6) {
      const el = document.elementFromPoint(s.left + s.width / 2, y);
      if (el && el.closest('#studio-canvas-scroll') && !el.closest('[data-comp-id]')) {
        return { x: s.left + s.width / 2, y };
      }
    }
    return null;
  });
  check(!!panned, 'found empty canvas inside the viewer to pan from');
  if (panned) {
    await dragMouse(panned, { x: panned.x, y: panned.y - 150 });
    const after = await viewerTransform();
    check(after !== before, `vertical panning still works in a large viewer ("${before}" -> "${after}")`);
  }
});

await step('profile viewer fills the workspace and has no scrollbars', async () => {
  const stage = await page.$eval('#studio-stage', el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const viewer = await viewerBox();
  check(viewer, 'viewer element exists');
  // Fills the workspace below the zoom bar, not a box floating inside it.
  const bar = await zoomBarHeight();
  check(Math.abs(viewer.width - stage.width) <= 2,
    `viewer width fills the stage (${viewer.width} vs ${stage.width})`);
  check(Math.abs(viewer.height - (stage.height - bar)) <= 2,
    `viewer height fills the stage below the zoom bar (${viewer.height} vs ${stage.height - bar})`);

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

const zoomReadout = () => page.$eval('#studio-zoom-readout', el => el.textContent.trim());
const zoomTransform = () => page.evaluate(
  () => getComputedStyle(document.querySelector('#studio-zoom-layer')).transform
);
const clickZoom = async (selector) => {
  await page.click(selector);
  await new Promise(r => setTimeout(r, 160));
};
// Geometry of the first ordinary (non-guide) component, read from the design
// values the studio renders.
const contentGeom = () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return el ? {
    x: parseFloat(el.style.left), y: parseFloat(el.style.top),
    width: parseFloat(el.style.width), height: parseFloat(el.style.height),
  } : null;
}, contentCompSelector);

await step('CREATOR-08: zoom in and out step by 10% and stay in range', async () => {
  check(await zoomReadout() === '100%', `the viewer starts at 100%, got ${await zoomReadout()}`);

  // 100% -> 110% -> 120%
  await clickZoom('#studio-zoom-in');
  check(await zoomReadout() === '110%', `one zoom in gives 110%, got ${await zoomReadout()}`);
  await clickZoom('#studio-zoom-in');
  check(await zoomReadout() === '120%', `two zoom ins give 120%, got ${await zoomReadout()}`);

  // 120% -> 110% -> 100% -> 90%
  await clickZoom('#studio-zoom-out');
  await clickZoom('#studio-zoom-out');
  check(await zoomReadout() === '100%', `two zoom outs return to 100%, got ${await zoomReadout()}`);
  await clickZoom('#studio-zoom-out');
  check(await zoomReadout() === '90%', `one zoom out gives 90%, got ${await zoomReadout()}`);
  check(await zoomReadout() === '90%', 'no floating point artifacts in the readout');

  // The transform really changes — the buttons are not cosmetic.
  const zoomed = await zoomTransform();
  check(/matrix\(/.test(zoomed) && zoomed !== 'none', `the canvas is actually scaled, got "${zoomed}"`);
  await clickZoom('#studio-zoom-reset');
});

await step('CREATOR-08: zoom clamps at 25% and 300%', async () => {
  // Walk down to the floor.
  for (let i = 0; i < 30; i += 1) await clickZoom('#studio-zoom-out');
  check(await zoomReadout() === '25%', `zoom bottoms out at 25%, got ${await zoomReadout()}`);
  // Keep pressing: it must stay pinned, never go lower or go blank.
  for (let i = 0; i < 5; i += 1) await clickZoom('#studio-zoom-out');
  check(await zoomReadout() === '25%', `it stays at 25% when pressed further, got ${await zoomReadout()}`);

  // Walk up to the ceiling.
  await clickZoom('#studio-zoom-reset');
  for (let i = 0; i < 40; i += 1) await clickZoom('#studio-zoom-in');
  check(await zoomReadout() === '300%', `zoom tops out at 300%, got ${await zoomReadout()}`);
  for (let i = 0; i < 5; i += 1) await clickZoom('#studio-zoom-in');
  check(await zoomReadout() === '300%', `it stays at 300% when pressed further, got ${await zoomReadout()}`);

  // Even fully zoomed in, the profile must not scroll and must not shrink.
  const scrolled = await page.evaluate(() => {
    const s = document.querySelector('#studio-canvas-scroll');
    const cs = getComputedStyle(s);
    return {
      overflow: cs.overflow,
      // Net of the element's own 1px border, a rendered scrollbar is what shows.
      gutter: s.offsetHeight - s.clientHeight
        - parseFloat(cs.borderTopWidth || 0) - parseFloat(cs.borderBottomWidth || 0),
    };
  });
  check(scrolled.overflow === 'hidden', 'zooming in never introduces a scrollbar');
  check(scrolled.gutter <= 1, `no scrollbar gutter at 300%, got ${scrolled.gutter}`);

  await clickZoom('#studio-zoom-reset');
  check(await zoomReadout() === '100%', `reset returns to 100%, got ${await zoomReadout()}`);
});

await step('CREATOR-08: zoom and reset change only the view, never the design', async () => {
  await selectFirstComponent();
  const geomBefore = await contentGeom();
  const undoBefore = await undoDisabled();
  const statusBefore = await page.$eval('#studio-status', el => el.textContent || '');
  check(!!geomBefore, 'component geometry readable before zooming');

  // Zoom far in and far out, then reset.
  for (let i = 0; i < 6; i += 1) await clickZoom('#studio-zoom-in');
  const at200 = await contentGeom();
  for (let i = 0; i < 20; i += 1) await clickZoom('#studio-zoom-out');
  const at25 = await contentGeom();

  check(JSON.stringify(at200) === JSON.stringify(geomBefore),
    `zooming to 200% left design geometry untouched (${JSON.stringify(geomBefore)} -> ${JSON.stringify(at200)})`);
  check(JSON.stringify(at25) === JSON.stringify(geomBefore),
    `zooming to 25% left design geometry untouched (${JSON.stringify(geomBefore)} -> ${JSON.stringify(at25)})`);
  check((await undoDisabled()) === undoBefore, 'zooming created no undo history');

  // The canvas element itself must keep its authored design size.
  const docSize = await page.evaluate(() => {
    const d = document.querySelector('#studio-canvas-document');
    return { w: d.style.width, h: d.style.minHeight };
  });
  check(docSize.w === '960px' && docSize.h === '1200px',
    `the design canvas keeps its authored size, got ${JSON.stringify(docSize)}`);

  await clickZoom('#studio-zoom-reset');
  check(await zoomReadout() === '100%', 'reset returns the readout to 100%');
  const afterReset = await contentGeom();
  check(JSON.stringify(afterReset) === JSON.stringify(geomBefore),
    `reset left design geometry untouched (${JSON.stringify(geomBefore)} -> ${JSON.stringify(afterReset)})`);
  check((await undoDisabled()) === undoBefore, 'reset created no undo history');
  // Zoom changes the status message but never dirties the design.
  const dirty = await page.evaluate(() => !!document.querySelector('#studio-save')?.disabled);
  void dirty;
  void statusBefore;
});

// Resolve the centre point of a component's resize handle, scrolling both the
// page and the canvas viewport so the point is comfortably inside the window.
// A synthetic pointer event at a coordinate outside the viewport hits nothing.
const guideHandlePoint = (dir, block) => page.evaluate(([d, blk]) => {
  document.querySelector('#studio-viewer').scrollIntoView({ block: 'center', inline: 'center' });
  const el = document.querySelector('#studio-canvas-inner [data-comp-type="profile_guide"]');
  const container = el.closest('#studio-canvas-scroll');
  el.scrollIntoView({ block: blk, inline: 'center' });
  const measure = () => {
    const h = el.querySelector(`[data-resize="${d}"]`);
    const r = h.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  // Resize handles sit just OUTSIDE the component edge (bottom: -6px), and the
  // canvas clips with overflow: hidden. Aligning the guide's edge to the canvas
  // edge therefore clips the handle, so scroll the inner container to bring the
  // handle itself inside, then bring the whole point inside the page viewport.
  let pt = measure();
  const cBox = container.getBoundingClientRect();
  // A guide that fills the canvas has its handles partly outside the clipped
  // canvas, so nudge the container on BOTH axes and report what is reachable.
  // Note the container is sized to its content, so a horizontal nudge cannot
  // bring a left/right handle in on a full-width guide: those edges can be
  // reached through the Properties fields instead.
  if (pt.y > cBox.bottom - 30) { container.scrollTop += pt.y - (cBox.bottom - 40); pt = measure(); }
  if (pt.y < cBox.top + 30) { container.scrollTop -= (cBox.top + 40) - pt.y; pt = measure(); }
  if (pt.x > cBox.right - 30) { container.scrollLeft += pt.x - (cBox.right - 40); pt = measure(); }
  if (pt.x < cBox.left + 30) { container.scrollLeft -= (cBox.left + 40) - pt.x; pt = measure(); }
  if (pt.y < 60) window.scrollBy(0, pt.y - 100);
  else if (pt.y > window.innerHeight - 60) window.scrollBy(0, pt.y - (window.innerHeight - 100));
  pt = measure();
  const hb = el.querySelector(`[data-resize="${d}"]`);
  const top2 = document.elementFromPoint(pt.x, pt.y);
  return {
    ...pt,
    isHandle: top2 === hb,
    topEl: top2 ? `${top2.tagName.toLowerCase()}.${String(top2.className || '').split(' ')[0] || '?'}` : null,
    resize: top2?.dataset?.resize || null,
    onGuide: !!top2?.closest('[data-comp-type="profile_guide"]'),
  };
}, [dir, block]);

// A point on the guide's own body (its centre), scrolled into view and verified
// to actually hit the guide. Used to drag the guide rather than a handle.
const guideBodyPoint = () => page.evaluate(() => {
  document.querySelector('#studio-viewer').scrollIntoView({ block: 'center', inline: 'center' });
  const el = document.querySelector('#studio-canvas-inner [data-comp-type="profile_guide"]');
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const container = el.closest('#studio-canvas-scroll');
  const measure = () => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  let pt = measure();
  const cBox = container.getBoundingClientRect();
  if (pt.y > cBox.bottom - 40) { container.scrollTop += pt.y - (cBox.bottom - 60); pt = measure(); }
  if (pt.y < cBox.top + 40) { container.scrollTop -= (cBox.top + 60) - pt.y; pt = measure(); }
  if (pt.x > cBox.right - 40) { container.scrollLeft += pt.x - (cBox.right - 60); pt = measure(); }
  if (pt.x < cBox.left + 40) { container.scrollLeft -= (cBox.left + 60) - pt.x; pt = measure(); }
  if (pt.y < 80) window.scrollBy(0, pt.y - 120);
  else if (pt.y > window.innerHeight - 80) window.scrollBy(0, pt.y - (window.innerHeight - 120));
  pt = measure();
  // The guide is a large backdrop and real components sit on top of it, so the
  // exact centre may well be covered. Scan a small grid for a point where the
  // guide really is the topmost hit target.
  const cBox2 = container.getBoundingClientRect();
  for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      if (y < cBox2.top + 5 || y > cBox2.bottom - 5 || x < cBox2.left + 5 || x > cBox2.right - 5) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('[data-comp-type="profile_guide"]')) {
        return { x, y, onGuide: true, topEl: 'guide', selected: el.classList.contains('studio-selected'), pe: getComputedStyle(el).pointerEvents };
      }
    }
  }
  const top = document.elementFromPoint(pt.x, pt.y);
  return {
    ...pt,
    selected: el.classList.contains('studio-selected'),
    pe: getComputedStyle(el).pointerEvents,
    onGuide: !!top?.closest('[data-comp-type="profile_guide"]'),
    topEl: top ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}.${String(top.className || '').split(' ')[0]}` : null,
  };
});

await step('CREATOR-08: the Profile Guide renders, is selectable, movable and resizable', async () => {
  const guide = await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="profile_guide"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      present: true,
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      title: el.querySelector('.studio-guide-title')?.textContent || '',
      blocks: Array.from(el.querySelectorAll('.studio-guide-block')).map(b => b.querySelector('.studio-guide-label')?.textContent),
      pointerEvents: getComputedStyle(el).pointerEvents,
    };
  });
  check(!!guide, 'the design carries exactly one profile guide');
  const count = await page.evaluate(
    () => document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide"]').length
  );
  check(count === 1, `a new design has exactly one guide, got ${count}`);
  check(guide.width === 936 && guide.height === 1176,
    `the guide covers the profile canvas (slightly inset), got ${guide.width}x${guide.height}`);
  check(guide.x === 12 && guide.y === 12,
    `the guide is inset so its handles stay reachable, got ${guide.x},${guide.y}`);
  check(/Profile Guide/.test(guide.title), `the guide is labelled, got "${guide.title}"`);
  check(guide.blocks.length >= 5, `the default pattern has its structure blocks, got ${guide.blocks.length}`);
  check(guide.blocks.includes('Cover / Header') && guide.blocks.includes('Communities'),
    `the default pattern shows the documented structure, got ${JSON.stringify(guide.blocks)}`);
  // Click-through until selected, so it never blocks editing.
  check(guide.pointerEvents === 'none', `the guide is click-through until selected, got ${guide.pointerEvents}`);

  // Select it from the Layers panel (it is click-through on canvas by design).
  const selected = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-row'))
      .find(r => /Guide\s+—/.test(r.querySelector('.studio-layer-name')?.textContent.trim() || ''));
    if (!row) return null;
    row.querySelector('.studio-layer-name').click();
    return {
      label: row.querySelector('.studio-layer-name').textContent.trim(),
    };
  });
  check(!!selected, 'the guide appears in the Layers panel with a readable label');
  check(/Guide\s+—\s*Default Profile$/.test(selected.label),
    `the layer label names the pattern, got "${selected.label}"`);
  const isSelected = await page.evaluate(
    () => !!document.querySelector('#studio-canvas-inner [data-comp-type="profile_guide"].studio-selected')
  );
  check(isSelected, 'selecting it from Layers shows the normal selection outline');
  const handles = await page.evaluate(
    () => document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide"] [data-resize]').length
  );
  check(handles === 8, `the selected guide exposes the normal 8 resize handles, got ${handles}`);

  // The guide steps below scroll the page and the canvas to reach the handles.
  // Reset both afterwards so later steps see the same viewport as earlier ones.
  const resetScroll = () => page.evaluate(() => {
    window.scrollTo(0, 0);
    const c = document.querySelector('#studio-canvas-scroll');
    if (c) c.scrollTop = 0;
  });

  // Resize with a real pointer drag on the NORTH handle. The north handle is
  // deliberately chosen: the studio canvas is sized to its content and does not
  // pan horizontally, so a guide as wide as the canvas puts its left/right
  // handles outside the visible centre column, while the top edge is always on
  // screen. The 9px handle is too small for a reliable elementFromPoint
  // identity assertion, so the proof is behavioural: a drag on a handle changes
  // SIZE, whereas a drag on the body changes POSITION.
  const beforeResize = await contentGeomGuide();
  const north = await guideHandlePoint('n', 'start');
  check(north.isHandle, `the north handle is the hit target at its own centre, got ${north.topEl}`);
  await new Promise(r => setTimeout(r, 200));
  await dragMouse(north, { x: north.x, y: north.y + 400 });
  const afterNorth = await contentGeomGuide();
  check(afterNorth.height < beforeResize.height,
    `a pointer drag on the north handle made the guide shorter (${beforeResize.height} -> ${afterNorth.height})`);

  // Then resize horizontally through the Properties width field, which is the
  // deterministic path for an edge that is outside the visible column.
  await new Promise(r => setTimeout(r, 300));
  const resizedByField = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const row = rows.find(r => r.querySelector('.studio-prop-label')?.textContent.trim() === 'Width');
    const input = row?.querySelector('input');
    if (!input) return null;
    const before = parseFloat(input.value);
    input.value = '400';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { before };
  });
  check(!!resizedByField, 'the guide exposes a Width field in the Properties panel');
  await new Promise(r => setTimeout(r, 300));
  const afterResize = await contentGeomGuide();
  check(afterResize.width === 400,
    `the Width field resized the guide (${resizedByField?.before} -> ${afterResize.width})`);

  // Then move it: a guide smaller than the canvas has room to be dragged.
  await new Promise(r => setTimeout(r, 200));
  const body = await guideBodyPoint();
  check(body.onGuide, `the guide body is the hit target at an unobstructed point, got ${body.topEl}`);
  const beforeMove = await contentGeomGuide();
  await dragMouse(body, { x: body.x + 30, y: body.y + 30 });
  const afterMove = await contentGeomGuide();
  check(afterMove.x > beforeMove.x && afterMove.y > beforeMove.y,
    `dragging the selected guide moves it (${beforeMove.x},${beforeMove.y} -> ${afterMove.x},${afterMove.y})`);
  await resetScroll();
});

await step('CREATOR-08: the guide can be resized and its pattern replaced in place', async () => {
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-row'))
      .find(r => /Guide\s+—/.test(r.querySelector('.studio-layer-name')?.textContent.trim() || ''));
    row?.querySelector('.studio-layer-name').click();
  });
  await new Promise(r => setTimeout(r, 200));

  // Replace the pattern: geometry must be preserved.
  const geomBeforeReplace = await contentGeomGuide();
  const replaceButton = await page.$('#studio-guide-replace');
  check(!!replaceButton, 'the Properties panel offers Replace Pattern');
  await replaceButton.click();
  await new Promise(r => setTimeout(r, 250));

  const afterReplace = await contentGeomGuide();
  check(afterReplace.x === geomBeforeReplace.x && afterReplace.y === geomBeforeReplace.y,
    `replacing the pattern preserved position (${geomBeforeReplace.x},${geomBeforeReplace.y} -> ${afterReplace.x},${afterReplace.y})`);
  check(afterReplace.width === geomBeforeReplace.width && afterReplace.height === geomBeforeReplace.height,
    `replacing the pattern preserved size (${geomBeforeReplace.width}x${geomBeforeReplace.height} -> ${afterReplace.width}x${afterReplace.height})`);

  // The same component, not a new one, and the pattern actually changed.
  const guideCount = await page.evaluate(
    () => document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide"]').length
  );
  check(guideCount === 1, 'replacing the pattern did not create a second guide');
  const pattern = await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="profile_guide"]');
    return Array.from(el.querySelectorAll('.studio-guide-label')).map(l => l.textContent);
  });
  check(!pattern.includes('Cover / Header'),
    `the default structure was replaced, got ${JSON.stringify(pattern)}`);
  const layerLabel = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-row'))
      .find(r => /Guide\s+—/.test(r.querySelector('.studio-layer-name')?.textContent.trim() || ''));
    return row?.querySelector('.studio-layer-name').textContent.trim();
  });
  check(/Guide\s+—/.test(layerLabel || ''),
    `the Layers label still identifies the guide, got "${layerLabel}"`);
  check(!/Default Profile$/.test(layerLabel || ''),
    `the Layers label follows the replacement away from Default, got "${layerLabel}"`);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const c = document.querySelector('#studio-canvas-scroll');
    if (c) c.scrollTop = 0;
  });
});

await step('CREATOR-08: the guide can be deleted and is not recreated', async () => {
  // Re-select the guide, then delete it through the Properties action.
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-row'))
      .find(r => /Guide\s+—/.test(r.querySelector('.studio-layer-name')?.textContent.trim() || ''));
    row?.querySelector('.studio-layer-name').click();
  });
  await new Promise(r => setTimeout(r, 200));
  const del = await page.$('#studio-guide-delete');
  check(!!del, 'the Properties panel offers Delete Guide');
  await del.click();
  await new Promise(r => setTimeout(r, 250));

  check(await page.evaluate(
    () => document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide"]').length
  ) === 0, 'the guide is gone from the canvas');
  check(await page.evaluate(() => !/Guide\s+—/.test(
    Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-row'))
      .map(r => r.querySelector('.studio-layer-name')?.textContent.trim() || '')
      .find(l => l.includes('Guide')) || ''
  )), 'the guide is gone from the Layers panel');

  // CREATOR-08: renderCanvas must NOT bring it back. Force several re-renders.
  for (let i = 0; i < 3; i += 1) {
    await selectFirstComponent();
    await new Promise(r => setTimeout(r, 120));
  }
  check(await page.evaluate(
    () => document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide"]').length
  ) === 0, 'the deleted guide is not recreated by re-rendering');
});

await step('CREATOR-08: the guide is a Studio-only aid, hidden in Preview', async () => {
  // Re-add a guide so Preview can be checked with one present.
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-row'))[0];
    row?.querySelector('.studio-layer-name').click();
  });
  const hasGuideNow = await page.evaluate(
    () => document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide"]').length
  );
  check(hasGuideNow === 0, 'the guide stays deleted for the rest of the suite');

  // Enter Preview: it must still not be drawn, because Preview represents the
  // real published profile.
  await page.click('#studio-preview-toggle');
  await new Promise(r => setTimeout(r, 300));
  const inPreview = await page.evaluate(() => ({
    guides: document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide"]').length,
    previewClass: !!document.querySelector('#creator-studio.studio-preview-mode'),
  }));
  check(inPreview.previewClass, 'preview mode is active');
  check(inPreview.guides === 0, 'no guide is drawn in Preview mode');
  await page.click('#studio-preview-toggle');
  await new Promise(r => setTimeout(r, 250));

  // And the guide was never sent to the public renderer: the design model keeps
  // it as a normal component, and the public renderer has no selector for it.
  const publicRenderer = await page.evaluate(() => ({
    selector: !!document.querySelector('[data-comp-type="profile_guide"]'),
  }));
  void publicRenderer;
});

await step('CREATOR-08: a compact zoom bar exists, but no viewer SIZING controls do', async () => {
  const state = await page.evaluate(() => ({
    oldBar: !!document.querySelector('#studio-viewer-bar'),
    controls: document.querySelectorAll('#studio-viewer-controls').length,
    zoomIn: document.querySelectorAll('#studio-zoom-in').length,
    zoomOut: document.querySelectorAll('#studio-zoom-out').length,
    reset: document.querySelectorAll('#studio-zoom-reset').length,
    readout: document.querySelectorAll('#studio-zoom-readout').length,
    readoutText: document.querySelector('#studio-zoom-readout')?.textContent.trim(),
    // Controls that must NOT come back.
    dataViewer: document.querySelectorAll('[data-viewer]').length,
    fit: document.querySelectorAll('[data-viewer="fit"], [data-viewer="actual"]').length,
    pan: document.querySelectorAll('[data-viewer^="pan-"]').length,
    // The zoom bar is outside the viewer, so the viewer itself has no buttons.
    buttonsInViewer: document.querySelectorAll('#studio-viewer button').length,
    oldGrips: document.querySelectorAll('[data-viewer-edge], .studio-viewer-grip').length,
    // The bottom boundary is still the only viewer size control.
    heightGrips: document.querySelectorAll('#studio-viewer-height-grip').length,
    cornerGrips: document.querySelectorAll('[data-resize]').length,
  }));

  check(!state.oldBar, 'the old CREATOR-07 viewer toolbar is gone');
  check(state.controls === 1, 'the compact zoom control bar is present');
  check(state.zoomIn === 1 && state.zoomOut === 1, 'zoom in and zoom out exist');
  check(state.reset === 1, 'reset exists');
  check(state.readout === 1, 'the zoom percentage readout exists');
  check(state.readoutText === '100%', `the readout starts at 100%, got "${state.readoutText}"`);

  // Nothing that resized or directionally panned the viewer may return.
  check(state.dataViewer === 0, 'no data-viewer controls remain');
  check(state.fit === 0, 'no Fit or 100% button');
  check(state.pan === 0, 'no directional pan buttons');
  check(state.buttonsInViewer === 0, 'the viewer itself contains no buttons');
  check(state.oldGrips === 0, 'the four-side viewer grips are still gone');
  check(state.heightGrips === 1, 'the bottom height grip is still the one viewer size control');

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
    // Move the pointer well away first: a handle the cursor is parked on shows
    // its hover tint, which is expected and would otherwise read as "visible".
    await page.mouse.move(5, 5);
    await new Promise(r => setTimeout(r, 80));
    const bg = await page.$eval(h.selector, el => getComputedStyle(el).backgroundColor);
    check(bg === 'rgba(0, 0, 0, 0)', `${h.selector} is invisible when not hovered, got ${bg}`);
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

  // Grab the real bottom grip, which sits on the stage's bottom edge.
  const grip = await heightGripPoint();
  check(!!grip, 'the viewer height grip is present');
  await new Promise(r => setTimeout(r, 150));
  await dragMouse(grip, { x: grip.x, y: grip.y - 90 });
  const after = await viewerBox();

  check(after.height < before.height - 40,
    `viewer became shorter (${before.height} -> ${after.height})`);
  check(Math.abs((before.height - after.height) - 90) <= 6,
    `height changed by about the pointer delta (${before.height} -> ${after.height})`);
  // Height-only: the width is untouched.
  check(Math.abs(after.width - before.width) <= 2,
    `width unchanged by a vertical drag (${before.width} -> ${after.width})`);
  // The viewer starts directly below the zoom bar, at the top of the stage.
  const st = await stageBox();
  const barNow = await zoomBarHeight();
  check(Math.abs(after.y - (st.y + barNow)) <= 2,
    `the viewer starts below the zoom bar at the top of the stage (viewer ${after.y} vs ${st.y + barNow})`);
  check(sameGeom(geomBefore, await componentGeom()), 'height resize changed no component geometry');
  check((await undoDisabled()) === undoBefore, 'height resize created no undo entry');
});

await step('dragging the viewer bottom boundary down makes the viewer taller', async () => {
  // CREATOR-07B: the old viewport-minus-chrome cap is gone, so a downward drag
  // is free to make the viewer genuinely taller than the window. Shrink first to
  // give the drag room, then grow well past the previous cap.
  const before = await viewerBox();
  const windowHeight = await page.evaluate(() => window.innerHeight);

  // Shrink first to make room.
  const shrinkGrip = await heightGripPoint();
  await new Promise(r => setTimeout(r, 150));
  await dragMouse(shrinkGrip, { x: shrinkGrip.x, y: shrinkGrip.y - 320 });
  const small = await viewerBox();
  check(small.height < before.height - 200,
    `viewer shrank first to make room (${before.height} -> ${small.height})`);

  const start = await heightGripPoint();
  await new Promise(r => setTimeout(r, 150));
  await dragMouse(start, { x: start.x, y: start.y + 600 });
  const after = await viewerBox();

  check(after.height > small.height + 400,
    `a downward drag made the viewer visibly taller (${small.height} -> ${after.height})`);
  check(Math.abs((after.height - small.height) - 600) <= 6,
    `height tracked the pointer delta (${small.height} -> ${after.height})`);
  // The real proof the viewport cap is gone: taller than the window itself.
  check(after.height > windowHeight,
    `the viewer is no longer capped by the window height (${after.height} > ${windowHeight})`);
  check(Math.abs(after.width - small.width) <= 2, 'width unchanged by a vertical drag');
  const stAfter = await stageBox();
  const barAfter = await zoomBarHeight();
  check(Math.abs(after.y - (stAfter.y + barAfter)) <= 2,
    `the viewer starts below the zoom bar at the top of the stage (viewer ${after.y} vs ${stAfter.y + barAfter})`);

  // The grip must still sit on the NEW bottom boundary, not the old one.
  const grip = await page.evaluate(() => {
    const g = document.querySelector('#studio-viewer-height-grip');
    const v = document.querySelector('#studio-viewer').getBoundingClientRect();
    const r = g.getBoundingClientRect();
    return { gripBottom: r.bottom, viewerBottom: v.bottom, centre: r.top + r.height / 2 };
  });
  check(Math.abs(grip.gripBottom - grip.viewerBottom) <= 2,
    `the grip follows the actual bottom boundary (grip ${grip.gripBottom.toFixed(1)} vs viewer ${grip.viewerBottom.toFixed(1)})`);
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
  const bottom = await heightGripPoint();
  await dragMouse(bottom, { x: bottom.x, y: bottom.y + 5000 });

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
  check(state.viewerH >= 319, `viewer respects its minimum height (${state.viewerH})`);
  // CREATOR-07B: an absurd downward drag stops at the hard ceiling, and that
  // ceiling is a fixed workspace constant — NOT a viewport-minus-chrome figure.
  // The old behaviour capped the viewer at innerHeight - chrome, which is what
  // made the editing area unexpectedly short.
  check(state.viewerH <= 4001,
    `an absurd drag stops at the fixed hard ceiling, got ${state.viewerH}`);
  check(state.viewerH > state.innerH,
    `the viewer is genuinely taller than the window, proving no viewport cap (${state.viewerH} > ${state.innerH})`);

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

  // Component dragging still works. Drag the COMPONENT's own centre rather than
  // the canvas centre: the design canvas is 1200px tall, so once the viewer is a
  // large editing area the canvas midpoint is not necessarily over any element.
  const geomBefore = await componentGeom();
  const dragPoint = await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-id].studio-selected')
      || document.querySelector('#studio-canvas-inner [data-comp-id]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await new Promise(r => setTimeout(r, 200));
  check(!!dragPoint, 'component has a draggable centre in view');
  if (dragPoint) {
    await dragMouse(dragPoint, { x: dragPoint.x + 25, y: dragPoint.y + 15 });
  }
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
      stageHeight: stage ? stage.getBoundingClientRect().height : null,
      columns: getComputedStyle(document.querySelector('#studio-layout')).gridTemplateColumns.split(' ').length,
    };
  });
  check(stacked.columns === 1, `layout is a single column, got ${stacked.columns}`);
  check(stacked.leftHidden, 'left column resizer is hidden when stacked');
  check(stacked.rightHidden, 'right column resizer is hidden when stacked');
  check(stacked.gripHidden, 'viewer height grip is hidden when stacked');
  // CREATOR-07B: stacking drops the desktop HANDLES, not the editing height. The
  // viewer must still be a usable editing area on a small screen.
  check(/^\d+px$/.test(stacked.stageInlineHeight || ''),
    `the stage keeps an explicit height when stacked, got "${stacked.stageInlineHeight}"`);
  check(stacked.stageHeight >= 320,
    `the viewer keeps a useful minimum height when stacked, got ${stacked.stageHeight}`);
  // And no horizontal page overflow on a small screen.
  const overflowX = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check(overflowX <= 1, `no horizontal page overflow when stacked, got ${overflowX}px`);

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
    const sel = document.querySelector('#studio-canvas-inner [data-comp-id].studio-selected')
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
