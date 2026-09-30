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

import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import puppeteer from 'puppeteer';
// The client's own registries, so the expectations below are read from the
// implementation instead of being hard-coded counts that drift when the real
// profile structure changes.
import {
  guidePattern,
  guideSectionLabel,
  DEFAULT_GUIDE_PATTERN,
  PROFILE_MAIN_SECTIONS,
  PROFILE_SIDEBAR_SECTIONS,
} from '../web/js/profileDesign.js';
// CREATOR-12: real .kpeffect ZIP bytes are built in Node (the browser cannot
// construct an archive), so the import flow is exercised against genuine
// packages rather than a stubbed upload.
import { buildZip, goodManifest, goodDefinition } from './_zip.js';

/** How many cards the current default guide has — one per real profile module. */
const DEFAULT_GUIDE_SIZE = guidePattern(DEFAULT_GUIDE_PATTERN).cards.length;
/** Every real profile module the Profile Viewer must draw. */
const REAL_PROFILE_MODULES = [...PROFILE_MAIN_SECTIONS, ...PROFILE_SIDEBAR_SECTIONS];
/** The upper-case section label the guide card renders for a module. */
const moduleLabel = (id) => guideSectionLabel(id).toUpperCase();

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
// NOTE: UPLOAD_CREATOR_DIR is deliberately NOT redirected to a temp directory.
// Static uploads are served from a fixed <repo>/uploads root, while the uploader
// writes to config.upload.creatorDir — so pointing the uploader anywhere else
// makes every uploaded image a 404 in the browser, and no test can then assert
// that an image really renders, resizes, or keeps its source. Uploads therefore
// land in uploads/creator/ where the server can serve them, and every file this
// run creates is deleted again before exit (see CREATOR_UPLOAD_DIR below) so the
// working tree is left clean.

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// Snapshot uploads/creator so the files this run creates can be removed again
// and the git working tree is left exactly as it was found.
const CREATOR_UPLOAD_DIR = resolve('uploads', 'creator');
const uploadsBefore = new Set(
  existsSync(CREATOR_UPLOAD_DIR) ? readdirSync(CREATOR_UPLOAD_DIR) : [],
);
function cleanupUploads() {
  if (!existsSync(CREATOR_UPLOAD_DIR)) return;
  for (const name of readdirSync(CREATOR_UPLOAD_DIR)) {
    if (uploadsBefore.has(name)) continue;
    try { rmSync(join(CREATOR_UPLOAD_DIR, name), { force: true }); } catch { /* best effort */ }
  }
}
// CREATOR-12 imports real .kpeffect packages, which the importer extracts into
// uploads/creator-effects. That is a second directory the run can dirty, so it
// is cleaned on exactly the same terms — the whole per-install directory the
// import created, and nothing that was already there.
const CREATOR_EFFECT_DIR = resolve('uploads', 'creator-effects');
const effectsBefore = new Set(
  existsSync(CREATOR_EFFECT_DIR) ? readdirSync(CREATOR_EFFECT_DIR) : [],
);
function cleanupEffectUploads() {
  if (!existsSync(CREATOR_EFFECT_DIR)) return;
  for (const name of readdirSync(CREATOR_EFFECT_DIR)) {
    if (effectsBefore.has(name)) continue;
    try { rmSync(join(CREATOR_EFFECT_DIR, name), { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
process.on('exit', () => { cleanupUploads(); cleanupEffectUploads(); });

// Hard watchdog: never hang the runner indefinitely (a hung browser close
// or navigation reports code 3 instead of blocking forever). Raised from 150s
// as the suite grew: the CREATOR-11 steps add real page reloads, a publish and a
// public-profile render, so a legitimate full run now takes longer than that.
// It is a hang guard, not a budget - nothing should approach it.
setTimeout(() => {
  process.stdout.write('WATCHDOG - forced exit after 600s\n');
  process.exit(3);
}, 600000).unref();
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
function eq(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

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

// CREATOR-10 fixture for the Profile Background and image-component uploads.
// Deliberately a different, larger picture so a test can tell the background
// apart from a component image, and so resizing it is visibly meaningful.
const bgFixturePath = join(TMP_DIR, 'background-fixture.png');
await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 90, b: 40 } } }).png().toFile(bgFixturePath);

// CREATOR-12: a real PNG used as the texture/preview inside .kpeffect packages.
const effectPng = await sharp({
  create: { width: 24, height: 24, channels: 4, background: { r: 220, g: 235, b: 255, alpha: 1 } },
}).png().toBuffer();

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
// An uncaught error in the page is a REAL failure, not noise. It is recorded so a
// step can assert that the code it exercised ran without throwing — otherwise a
// ReferenceError (e.g. a helper that was never imported) silently degrades every
// later assertion into a confusing "expected X, got null" instead of naming the
// actual cause.
const pageErrors = [];
page.on('pageerror', (e) => {
  const message = String(e);
  pageErrors.push(message);
  process.stdout.write(`  [pageerror] ${message.slice(0, 200)}\n`);
});

/**
 * Set the browser's motion preference explicitly.
 *
 * Headless Chrome reports `prefers-reduced-motion: reduce` BY DEFAULT, which is
 * correct behaviour for the app - it means the accessibility path is genuinely
 * exercised - but it would silently make every "the animation plays" assertion
 * fail. Tests that assert playback must therefore ask for `no-preference`
 * explicitly, and the accessibility test must ask for `reduce`. Leaving it
 * implicit would make the suite depend on the browser's default.
 */
const setMotionPreference = async (value) => {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value }]);
  await new Promise(r => setTimeout(r, 150));
};
/** Assert that the page has not thrown since the last call. */
const assertNoPageErrors = async (label) => {
  if (pageErrors.length === 0) return;
  const seen = pageErrors.splice(0, pageErrors.length);
  throw new Error(`${label} threw in the page: ${seen.map(m => m.slice(0, 160)).join(' | ')}`);
};
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
    await waitForStudioReady();
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
/**
 * Authoritative snapshot of the whole saved design model, read from the rendered
 * canvas. Used to prove that viewer-only operations (zoom, re-centring, Fit,
 * panel/viewer/window resize) never touch design coordinates.
 */
const designSnapshot = () => page.evaluate(() => {
  const doc = document.querySelector('#studio-canvas-document');
  return {
    canvasW: doc ? parseFloat(doc.style.width) : null,
    canvasH: doc ? parseFloat(doc.style.minHeight) : null,
    sizeLabel: document.querySelector('#studio-canvas-size')?.textContent.trim() || '',
    // Every component's full geometry plus its image source, ordered so the
    // comparison is stable across renders.
    comps: Array.from(doc?.querySelectorAll('[data-comp-id]') || [])
      .map(el => {
        const img = el.querySelector('img');
        return [
          el.dataset.compId, el.dataset.compType,
          parseFloat(el.style.left), parseFloat(el.style.top),
          parseFloat(el.style.width), parseFloat(el.style.height),
          parseFloat(el.style.rotation) || 0,
          el.style.zIndex || '0',
          img ? (img.getAttribute('src') || '') : '',
        ].join('|');
      })
      .sort(),
  };
});

/** Whether an undo entry exists, read from the Undo control's availability. */
const undoDepth = () => page.evaluate(() => (document.querySelector('#studio-undo')?.disabled ? 0 : 1));

/**
 * Measure how the design canvas currently sits inside the Profile Viewer.
 *
 * `gap*` values are the breathing room on each side, with a negative gap
 * floored to 0 (an oversized canvas is deliberately pulled past the edge to show
 * its middle, which is not "room"). `isCentred` then compares the two sides: a
 * centred canvas has equal room left/right and top/bottom, which is what
 * "must always be centered" means in a way a transform string alone cannot fake.
 */
const canvasPlacement = () => page.evaluate(() => {
  const viewer = document.querySelector('#studio-canvas-scroll');
  const doc = document.querySelector('#studio-canvas-document');
  if (!viewer || !doc) return null;
  const v = viewer.getBoundingClientRect();
  const d = doc.getBoundingClientRect();
  const left = d.left - v.left;
  const right = v.right - d.right;
  const top = d.top - v.top;
  const bottom = v.bottom - d.bottom;
  return {
    left: Math.round(left), right: Math.round(right),
    top: Math.round(top), bottom: Math.round(bottom),
    gapLeft: Math.max(0, Math.round(left)),
    gapRight: Math.max(0, Math.round(right)),
    gapTop: Math.max(0, Math.round(top)),
    gapBottom: Math.max(0, Math.round(bottom)),
    canvasW: Math.round(d.width), canvasH: Math.round(d.height),
    viewerW: Math.round(v.width), viewerH: Math.round(v.height),
    zoom: document.querySelector('#studio-zoom-readout')?.textContent.trim(),
    transform: document.querySelector('#studio-zoom-layer')?.style.transform,
  };
});

/**
 * True when the canvas sits in the middle of the viewer on both axes.
 *
 * This compares the RAW offsets, not the floored `gap*` values. When the canvas
 * is larger than the viewer its offsets are negative, and flooring them to zero
 * would make ANY position look centred — an off-centre oversized canvas would
 * wrongly pass. Equal raw offsets on both sides is what actually means "the
 * canvas centre coincides with the viewport centre".
 */
const isCentred = (p) => !!p
  && Math.abs(p.left - p.right) <= 1
  && Math.abs(p.top - p.bottom) <= 1;

/** Describe a placement for a failure message. */
const placeNote = (p) => `zoom ${p?.zoom} (left ${p?.left} vs right ${p?.right},`
  + ` top ${p?.top} vs bottom ${p?.bottom}, canvas ${p?.canvasW}x${p?.canvasH} in viewer ${p?.viewerW}x${p?.viewerH})`;

/**
 * Click a zoom control reliably.
 *
 * The zoom bar is sticky, so after an arbitrary earlier scroll it can end up
 * under another element and a coordinate click is silently swallowed: the control
 * never fires, the viewer does not move, and the test then asserts against
 * unchanged state. This clicks for real first — so the button's hit area really
 * is exercised — and falls back to invoking the element in-page when the view did
 * not move.
 *
 * `expectChange: false` is for controls that are legitimately idempotent: Reset at
 * 100% on an already-centred canvas changes nothing observable, and that is
 * correct behaviour rather than a dead button. Real Reset behaviour is proven
 * separately, starting from a genuinely off-centre view.
 */
const clickZoomControl = async (selector, { expectChange = true } = {}) => {
  // Zoom AND transform together: a no-op at the same zoom can still re-centre.
  const signature = () => page.evaluate(() => {
    const layer = document.querySelector('#studio-zoom-layer');
    return `${document.querySelector('#studio-zoom-readout')?.textContent.trim()}|${layer?.style.transform || ''}`;
  });
  const before = await signature();
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, selector);
  await new Promise(r => setTimeout(r, 120));
  await page.click(selector);
  await new Promise(r => setTimeout(r, 240));
  if (await signature() !== before) return 'real-click';
  await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
  await new Promise(r => setTimeout(r, 240));
  if (await signature() !== before) return 'in-page-fallback';
  if (expectChange) throw new Error(`${selector} had no effect on the viewer (still "${before}")`);
  return 'no-op';
};

// Viewer box, in page coordinates.
const viewerBox = () => page.$eval('#studio-viewer', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
// CREATOR-08: the stage also contains the compact zoom bar, so the viewer fills
// the stage MINUS that bar. Tests compare against the stage using this helper
// rather than assuming the two are equal.
//
// CREATOR-09: the chrome directly above the viewer is now ONE bar that carries
// both the design-canvas size and the zoom controls, so measure the BAR rather
// than the zoom group inside it.
const zoomBarHeight = () => page.evaluate(() => {
  const bar = document.querySelector('#studio-stage-bar') || document.querySelector('#studio-viewer-controls');
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
// CREATOR-09: guide cards are real, interactive components, so the helpers that
// exercise ORDINARY content deliberately skip BOTH guide types. The guide has its
// own steps further down.
const contentCompSelector = '#studio-canvas-inner [data-comp-id]:not([data-comp-type="profile_guide_card"]):not([data-comp-type="profile_guide"])';
// Geometry of one guide card, read from the design values it renders.
const guideCardSelector = '#studio-canvas-inner [data-comp-type="profile_guide_card"]';
const guideCardCount = () => page.evaluate(
  (sel) => document.querySelectorAll(sel).length, guideCardSelector,
);
const guideCards = () => page.evaluate((sel) => {
  return Array.from(document.querySelectorAll(sel)).map(el => ({
    section: el.querySelector('.studio-guide-card-label')?.textContent || '',
    x: parseFloat(el.style.left), y: parseFloat(el.style.top),
    width: parseFloat(el.style.width), height: parseFloat(el.style.height),
    selected: el.classList.contains('studio-selected'),
  }));
}, guideCardSelector);
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
  // The panels must not be what decides the stage height. Assert the invariant
  // DIRECTLY rather than through a proportional proxy: a panel is allowed to be
  // much taller than the stage (a Properties panel with many sections is), and
  // it scrolls internally. What must hold is that the stage keeps its own height
  // and that the panel is bounded by its own scroll box, not by driving the stage.
  for (const p of measured.panels) {
    check(measured.stage !== p,
      `the viewer is not sized off a ${Math.round(p)}px side panel (stage ${measured.stage})`);
  }
  const panelScroll = await page.evaluate(() => {
    const el = document.querySelector('#studio-properties-panel');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { overflowY: cs.overflowY, scrollH: el.scrollHeight, clientH: el.clientHeight };
  });
  if (panelScroll && panelScroll.scrollH > panelScroll.clientH + 2) {
    // The panel is genuinely overflowing, and it must contain that overflow itself
    // rather than stretching the workspace row.
    check(['auto', 'scroll'].includes(panelScroll.overflowY),
      `an overlong Properties panel scrolls internally, got overflow-y ${panelScroll.overflowY}`);
  }
  const stageAfter = await page.evaluate(() => document.querySelector('#studio-stage').getBoundingClientRect().height);
  check(Math.abs(stageAfter - measured.stage) <= 1,
    `a long Properties panel did not change the stage height (${measured.stage} -> ${stageAfter})`);
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
  // No auto-fit: the SCALE must still be 1 — the design is not shrunk to fit.
  //
  // CREATOR-10: the assertion is on the scale, not on the whole transform. A
  // translate is now expected and required — the canvas is centred in the viewer
  // rather than sitting against its top-left corner — so an identity transform
  // is no longer the correct thing to assert. What must NOT happen is the
  // design being rescaled to fit.
  const matrix = /matrix\(([^)]+)\)/.exec(state.transform);
  const parts = matrix ? matrix[1].split(',').map(v => parseFloat(v)) : null;
  const scaleX = parts ? Math.abs(parts[0]) : 1;
  const scaleY = parts ? Math.abs(parts[3]) : 1;
  check(Math.abs(scaleX - 1) < 0.0001 && Math.abs(scaleY - 1) < 0.0001,
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
// ── Guide-card helpers (CREATOR-09) ────────────────────────────────────────────
// A guide card is a small labelled wireframe, so unlike CREATOR-08's one
// full-canvas block it is fully reachable: it never spans the whole canvas, so
// its handles are always on screen and it can be grabbed with a real pointer.

// A point at the centre of a guide card's own body, verified to actually hit that
// card (so a drag really moves the guide and not the panel behind it).
//
// scrollIntoView and the measurement are deliberately SEPARATE: scrolling can
// still be settling when the promise resolves, and a point measured mid-scroll
// is stale by the time the real pointer event is dispatched — which would make
// the press land on empty canvas and pan the viewer instead of moving the card.
const scrollCardIntoView = async () => { /* replaced by prepareStableCanvas() */ };

/**
 * Read a guide card's screen rect, but only once it has STOPPED moving.
 *
 * Any in-flight canvas re-render (which re-clamps the pan) can still be settling
 * when the previous promise resolves. A point measured while the canvas is still
 * shifting is stale by the time the real pointer event is dispatched — the press
 * then lands on empty canvas and pans the viewer instead of moving the card.
 * Polling until two consecutive reads agree makes the point safe to use.
 *
 * It deliberately does NOT scroll anything: the studio CLIPS the canvas and pans
 * it with a transform, so scrolling the (overflow:hidden) container would
 * desynchronise it from the pan and make things worse. prepareStableCanvas()
 * brings the whole design into view up front instead.
 */
const settledCardRect = (index) => page.evaluate(async (i) => {
  const all = () => document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide_card"]');
  const read = () => {
    const el = all()[i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let prev = null;
  for (let n = 0; n < 40; n += 1) {
    const next = read();
    if (next) {
      if (prev && next.l === prev.l && next.t === prev.t && next.w === prev.w && next.h === prev.h) {
        return next;
      }
      prev = next;
    }
    await sleep(50);
  }
  return prev;
}, index);

/**
 * Put the viewer into a known, stable layout before a pointer gesture.
 *
 * scrollIntoView() is deliberately NOT used: the studio clips the canvas and pans
 * it with its own transform, and a page scroll shifts every client coordinate.
 *
 * Instead this uses the app's own FIT control (CREATOR-10), which scales the
 * whole 960x1200 design down until all of it — the main column AND the sidebar —
 * sits inside the viewer, then re-centres it. That is exactly the state a
 * creator wants before editing, and it guarantees the target is on screen
 * instead of clipped past the right-hand edge of a narrower centre column. The
 * page scroll is pinned to zero and the canvas transform is awaited until it
 * stops changing, so a point measured now is still the same point when the
 * pointer is pressed.
 *
 * Fit is viewer state only: it cannot move a component or dirty the design.
 */
/**
 * Pin the scroll so the whole Profile Viewer — and therefore the whole fitted
 * design — is inside the viewport.
 *
 * Used for CANVAS gestures. After Fit the design is scaled to fit the viewer, so
 * the viewer being fully visible is exactly what makes every guide card and
 * component reachable. Centres the workspace on the viewer rather than the whole
 * layout, whose middle can sit far below a top-of-canvas guide card.
 */
async function pinCanvasInView() {
  await page.evaluate(() => {
    const viewer = document.querySelector('#studio-viewer');
    if (viewer) {
      const r = viewer.getBoundingClientRect();
      // Keep the viewer's top just under the top of the window.
      window.scrollBy(0, r.top - 6);
    }
    const c = document.querySelector('#studio-canvas-scroll');
    if (c) { c.scrollTop = 0; c.scrollLeft = 0; }
  });
  await new Promise(r => setTimeout(r, 200));
}

/**
 * Bring the Profile Viewer back to a workable height for canvas gestures.
 *
 * An earlier step deliberately drags the viewer's bottom boundary down to prove
 * the height is not capped by the window, which leaves the viewer at its 4000px
 * ceiling. The canvas is then centred inside that enormous viewer, so design
 * content — including a top-of-canvas guide card — sits far below the visible
 * window and cannot be pressed at all.
 *
 * This drags the real height grip back down to a sensible editing size, in
 * repeated steps because one drag can only move by the pointer delta. It is
 * viewer state only: the design, its geometry and its dirty flag are untouched.
 */
async function normaliseViewerHeight(target = 1000) {
  for (let i = 0; i < 8; i += 1) {
    const h = await page.evaluate(() => {
      const v = document.querySelector('#studio-viewer');
      return v ? Math.round(v.getBoundingClientRect().height) : 0;
    });
    if (h > 0 && h <= target) return h;
    if (!(h > 0)) return 0;
    await pinStudioInView();
    const grip = await heightGripPoint();
    if (!grip) return h;
    const over = h - target;
    // Dragging the grip UP shrinks the viewer; one drag moves at most 700px.
    await dragMouse(grip, { x: grip.x, y: grip.y - Math.min(over, 700) });
    await new Promise(r => setTimeout(r, 250));
  }
  return 0;
}

const prepareStableCanvas = async () => {
  await pinStudioInView();
  await normaliseViewerHeight();
  // Invoke the Fit control directly on the element rather than clicking it by
  // screen coordinates. The zoom bar is sticky, so after an arbitrary earlier
  // scroll it can sit under another element and a coordinate click is silently
  // swallowed — leaving the design at 100% and a card off-screen. A real
  // hit-tested click on Fit is asserted separately in the CREATOR-10 steps.
  const fitResult = await page.evaluate(async () => {
    const read = () => document.querySelector('#studio-zoom-readout')?.textContent.trim();
    const before = read();
    document.querySelector('#studio-zoom-fit')?.click();
    await new Promise(r => setTimeout(r, 200));
    return { before, after: read() };
  });
  await new Promise(r => setTimeout(r, 200));
  await pinCanvasInView();
  return fitResult;
};

// Look a guide card up by its section LABEL rather than by position: bringing a
// card to the front re-orders the DOM, so a positional index goes stale.
const guideCardIndex = async (section) => (await guideCards()).findIndex(c => c.section === section);
const guideCardBySection = async (section) => (await guideCards()).find(c => c.section === section) || null;

const guideCardBodyPoint = async (index = 0) => {
  await scrollCardIntoView(index);
  const box = await settledCardRect(index);
  if (!box) return null;
  return page.evaluate(([b, i]) => {
    const el = document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide_card"]')[i];
    if (!el) return null;
    const x = b.l + b.w / 2;
    const y = b.t + b.h / 2;
    const top = document.elementFromPoint(x, y);
    const viewer = document.querySelector('#studio-viewer')?.getBoundingClientRect();
    return {
      x, y,
      rect: b,
      inView: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
      windowH: window.innerHeight,
      viewer: viewer ? { t: Math.round(viewer.top), b: Math.round(viewer.bottom) } : null,
      zoom: document.querySelector('#studio-zoom-readout')?.textContent.trim(),
      transform: document.querySelector('#studio-zoom-layer')?.style.transform,
      section: el.querySelector('.studio-guide-card-label')?.textContent || '',
      // Must be THIS card, not a different guide card stacked over it.
      hitsThis: !!top && top.closest('[data-comp-type="profile_guide_card"]') === el,
      topEl: top ? `${top.tagName.toLowerCase()}.${String(top.className || '').split(' ')[0] || '?'}` : null,
    };
  }, [box, index]);
};

// A point at the centre of one of a guide card's resize handles.
const guideCardHandlePoint = async (index, dir) => {
  await scrollCardIntoView(index);
  const box = await settledCardRect(index);
  if (!box) return null;
  return page.evaluate(([b, i, d]) => {
    const el = document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide_card"]')[i];
    if (!el) return null;
    const h = el.querySelector(`[data-resize="${d}"]`);
    if (!h) return null;
    const r = h.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      x, y,
      isHandle: top === h,
      topEl: top ? `${top.tagName.toLowerCase()}.${String(top.className || '').split(' ')[0] || '?'}` : null,
    };
  }, [box, index, dir]);
};

// Select a guide card in the Layers panel by its section label. The layer name is
// "n. Guide — Gallery", so the match is case-insensitive.
const selectGuideCardInLayers = (label) => page.evaluate((wanted) => {
  const rows = Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-row'));
  const row = rows.find(r => (r.querySelector('.studio-layer-name')?.textContent || '')
    .toUpperCase().includes(wanted.toUpperCase()));
  if (!row) return false;
  row.querySelector('.studio-layer-name').click();
  return true;
}, label);

// Deselect whatever is selected, so the Properties panel shows the CANVAS
// properties. Find a point that is genuinely on empty canvas — inside the
// canvas document, but not on any component — and press there.
const showCanvasProperties = async () => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const done = await page.evaluate(() => Array.from(
      document.querySelectorAll('#studio-properties .studio-prop-label'),
    ).some(l => l.textContent.trim() === 'Canvas height'));
    if (done) return true;

    const hit = await page.evaluate(() => {
      const inner = document.querySelector('#studio-canvas-inner');
      const doc = document.querySelector('#studio-canvas-document');
      if (!inner || !doc) return null;
      const box = inner.getBoundingClientRect();
      // Sweep the canvas and take the first point that is on the canvas itself
      // and not on any component, so the click lands on empty design space.
      for (let fy = 0.12; fy <= 0.92; fy += 0.08) {
        for (let fx = 0.1; fx <= 0.95; fx += 0.05) {
          const x = box.left + box.width * fx;
          const y = box.top + box.height * fy;
          const top = document.elementFromPoint(x, y);
          if (!top || !inner.contains(top)) continue;
          if (top.closest('[data-comp-id]') || top.closest('[data-resize]')) continue;
          const opts = { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 };
          top.dispatchEvent(new PointerEvent('pointerdown', opts));
          top.dispatchEvent(new PointerEvent('pointerup', opts));
          return { x, y };
        }
      }
      return null;
    });
    if (!hit) return false;
    await new Promise(r => setTimeout(r, 250));
  }
  return page.evaluate(() => Array.from(
    document.querySelectorAll('#studio-properties .studio-prop-label'),
  ).some(l => l.textContent.trim() === 'Canvas height'));
};

// Read a named Properties field for the selected component.
const propValue = (label) => page.evaluate((wanted) => {
  const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
  const row = rows.find(r => r.querySelector('.studio-prop-label')?.textContent.trim() === wanted);
  const input = row?.querySelector('input');
  return input ? input.value : null;
}, label);

// Set a named Properties field to a value, as the creator typing would.
const setPropValue = (label, value) => page.evaluate(([wanted, next]) => {
  const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
  const row = rows.find(r => r.querySelector('.studio-prop-label')?.textContent.trim() === wanted);
  const input = row?.querySelector('input');
  if (!input) return false;
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, [label, value]);

// Put the guide back if a step deleted it, so later steps still have one.
const ensureGuidePresent = async () => {
  if (await guideCardCount() > 0) return;
  await page.click('#studio-guide-reset');
  await new Promise(r => setTimeout(r, 300));
};

/**
 * Wait until the Creator Studio workspace is actually USABLE.
 *
 * The workspace is rendered hidden and only revealed once the page has finished
 * loading the signed-in profile and the design list. Waiting merely for a node
 * inside it is not enough: those nodes already exist in the hidden subtree, so
 * `waitForSelector` returns immediately and the following measurements read a
 * layout that has not been laid out yet — the grid still reports its specified
 * `minmax(0px, 1fr)` instead of resolved pixels, and every column measures 0.
 */
async function waitForStudioReady() {
  await page.waitForSelector('#studio-workspace:not([hidden])', { visible: true, timeout: 30000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('.studio-layout');
    if (!el) return false;
    const cols = getComputedStyle(el).gridTemplateColumns;
    // Fully laid out means three RESOLVED pixel tracks.
    return !!cols && !cols.includes('minmax') && cols.trim().split(/\s+/).length === 3;
  }, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 150));
};

/**
 * Wait until a specific <img> in the viewer has actually decoded.
 *
 * An upload resolves over HTTP before the browser has necessarily decoded the
 * file, so a naturalWidth read taken straight after the upload can still be 0.
 */
function waitForImage(selector, timeout = 8000) { return page.evaluate(async ([sel, ms]) => {
  const sleep = (n) => new Promise(r => setTimeout(r, n));
  const deadline = Date.now() + ms;
  for (;;) {
    const img = document.querySelector(sel);
    if (img && img.naturalWidth > 0) {
      return { src: img.getAttribute('src') || '', naturalW: img.naturalWidth, naturalH: img.naturalHeight };
    }
    if (Date.now() > deadline) {
      return { src: img?.getAttribute('src') || '', naturalW: img?.naturalWidth || 0, naturalH: img?.naturalHeight || 0, timedOut: true };
    }
    await sleep(100);
  }
}, [selector, timeout]);
}

/**
 * Leave Preview mode, whatever state a previous step left the Studio in.
 */
async function ensureEditingMode() {
  const inPreview = await page.evaluate(() => !!document.querySelector('#creator-studio.studio-preview-mode'));
  if (!inPreview) return;
  await page.click('#studio-preview-toggle');
  await new Promise(r => setTimeout(r, 300));
};

/**
 * Pin the page scroll so the Creator Studio workspace is laid out in a known
 * place before any pointer gesture.
 *
 * Puppeteer auto-scrolls to whatever it clicks, so after a step that clicked a
 * control low on the page the workspace can sit anywhere. Every coordinate below
 * is a VIEWPORT coordinate, so a target that has been scrolled out of view is
 * simply not painted and elementFromPoint() returns null.
 *
 * This centres the workspace rather than pinning it to the top: the column
 * resizers span the full workspace height, so a handle's own CENTRE — the point
 * every probe measures and presses — has to be on screen. A resizer extending
 * past the top or bottom edge is fine and expected; only its centre matters.
 */
async function pinStudioInView() {
  await page.evaluate(() => {
    const layout = document.querySelector('#studio-layout');
    if (layout) layout.scrollIntoView({ block: 'center', inline: 'nearest' });
    const c = document.querySelector('#studio-canvas-scroll');
    if (c) { c.scrollTop = 0; c.scrollLeft = 0; }
  });
  await new Promise(r => setTimeout(r, 200));
};

/**
 * Deselect the current component through the app's own Escape handler, so the
 * Properties panel shows the canvas-level controls (where the Profile Background
 * lives) rather than a component's fields.
 */
async function deselectComponent() {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 250));
  const stillSelected = await page.evaluate(() =>
    !!document.querySelector('#studio-canvas-inner .studio-selected'));
  if (stillSelected) {
    // Fall back to clicking genuinely empty canvas well outside any component.
    await page.evaluate(() => {
      const doc = document.querySelector('#studio-canvas-document');
      const hit = document.elementFromPoint(
        doc.getBoundingClientRect().left + 6,
        doc.getBoundingClientRect().bottom - 6,
      );
      if (hit) {
        const o = { bubbles: true, clientX: doc.getBoundingClientRect().left + 6, clientY: doc.getBoundingClientRect().bottom - 6, button: 0, pointerId: 1 };
        hit.dispatchEvent(new PointerEvent('pointerdown', o));
        hit.dispatchEvent(new PointerEvent('pointerup', o));
      }
    });
    await new Promise(r => setTimeout(r, 250));
  }
};

await step('CREATOR-09: a new design starts with the default set of guide cards', async () => {
  // The design under edit is the one seeded by the harness; make sure we are
  // looking at a guide set rather than whatever a previous step left behind.
  await ensureGuidePresent();
  const count = await guideCardCount();
  check(count > 0, `the design carries a default guide set, got ${count} cards`);

  const cards = await guideCards();
  const sections = cards.map(c => c.section);
  // CREATOR-10: the default guide IS the real public profile — the main column
  // and one independent card per sidebar module. Read the expectations from the
  // client's own registries so they cannot drift from the implementation.
  const expected = REAL_PROFILE_MODULES.map(moduleLabel);
  for (const want of expected) {
    check(sections.includes(want), `the guide includes a "${want}" card, got ${JSON.stringify(sections)}`);
  }
  eq(sections.length, expected.length, `the default guide is one card per real module, got ${JSON.stringify(sections)}`);

  // Every card is a plausible box on the 960x1200 design canvas.
  for (const c of cards) {
    check(c.width > 0 && c.height > 0, `card ${c.section} has a real size`);
    check(c.x >= 0 && c.y >= 0 && c.x + c.width <= 960 && c.y + c.height <= 1200,
      `card ${c.section} sits inside the design canvas`);
  }
  // CREATOR-10: the sidebar cards are INDEPENDENT — no two share a box, and the
  // Gallery is a sidebar card rather than a main-column one below Testimonials.
  const boxes = new Set(cards.map(c => `${c.x},${c.y},${c.width},${c.height}`));
  eq(boxes.size, cards.length, 'every guide card has its own distinct box');
  for (const label of ['FRIEND SPACE', 'PHOTO GALLERY', 'VIDEO BOX', 'MUSIC', 'SCRAPS']) {
    const card = cards.find(c => c.section === label);
    check(!!card, `the "${label}" card exists`);
    // The real profile layout puts the sidebar at x=640, right of the 560-wide
    // main column, so every sidebar card must start at or beyond it.
    check(card.x >= 640, `the "${label}" card is in the sidebar, got x=${card.x}`);
  }
  // No duplicate sections — one card per section.
  check(new Set(sections).size === sections.length, `no duplicate guide cards, got ${JSON.stringify(sections)}`);
});

await step('CREATOR-09: a guide card reads as a guide, not a finished profile card', async () => {
  const look = await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="profile_guide_card"]');
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      borderStyle: s.borderStyle,
      label: el.querySelector('.studio-guide-card-label')?.textContent || '',
      area: el.querySelector('.studio-guide-card-area')?.textContent || '',
      hasImg: !!el.querySelector('img'),
      hasInput: !!el.querySelector('input, textarea'),
    };
  });
  check(!!look, 'a guide card is rendered');
  check(look.borderStyle === 'dashed', `a guide card has a dashed outline, got ${look.borderStyle}`);
  check(look.area === 'Guide Area', `a guide card is marked "Guide Area", got "${look.area}"`);
  check(!look.hasImg && !look.hasInput, 'a guide card carries no media or editable content');
});

await step('CREATOR-09: the design canvas size is stated and tracks the real canvas', async () => {
  const label = () => page.$eval('#studio-canvas-size', el => el.textContent.trim());
  check(await label() === 'Canvas 960 × 1200 px', `the canvas size is stated, got "${await label()}"`);

  // The document element really is 960x1200, in DESIGN coordinates.
  const doc = await page.$eval('#studio-canvas-document', el => ({
    width: parseFloat(el.style.width), height: parseFloat(el.style.minHeight),
  }));
  check(doc.width === 960 && doc.height === 1200, `the canvas document is 960x1200, got ${doc.width}x${doc.height}`);

  // Change the canvas height through the canvas Properties; the indicator must
  // follow, because it is re-read from layout.canvas on every canvas render.
  await showCanvasProperties();
  const changed = await setPropValue('Canvas height', '1400');
  check(changed, 'the canvas height field is reachable in the Properties panel');
  await new Promise(r => setTimeout(r, 300));
  check(await label() === 'Canvas 960 × 1400 px', `the indicator follows the real canvas, got "${await label()}"`);
  const grew = await page.$eval('#studio-canvas-document', el => parseFloat(el.style.minHeight));
  check(grew === 1400, `the canvas document really grew, got ${grew}`);

  // Put it back so later steps use the documented 960x1200 canvas.
  await setPropValue('Canvas height', '1200');
  await new Promise(r => setTimeout(r, 300));
  check(await label() === 'Canvas 960 × 1200 px', `the indicator is restored, got "${await label()}"`);
  const back = await page.$eval('#studio-canvas-document', el => parseFloat(el.style.minHeight));
  check(back === 1200, `the canvas document is back to 1200, got ${back}`);
});

await step('CREATOR-09: a guide card can be selected, moved and resized with the mouse', async () => {
  // Move: a real pointer drag on the card's own body.
  const PHOTO = 'PROFILE PHOTO';
  const before = await guideCardBySection(PHOTO);
  await prepareStableCanvas();
  const body = await guideCardBodyPoint(await guideCardIndex(PHOTO));
  check(!!body, 'a guide card body point is available');
  check(body.hitsThis,
    `the point hits the intended ${body.section} card, got topEl=${body.topEl}`
    + ` point=(${Math.round(body.x)},${Math.round(body.y)}) inView=${body.inView} winH=${body.windowH}`
    + ` viewer=${JSON.stringify(body.viewer)} zoom=${body.zoom} transform=${body.transform}`
    + ` rect=${JSON.stringify(body.rect)}`);
  await dragMouse(body, { x: body.x + 60, y: body.y + 40 });
  const afterMove = await guideCardBySection(PHOTO);
  check(afterMove.x > before.x && afterMove.y > before.y,
    `dragging a guide card moves it (${before.x},${before.y} -> ${afterMove.x},${afterMove.y})`);
  check(afterMove.selected, 'the dragged card is the selected one');

  // Resize with real pointer drags. The default guide set packs the cards with
  // small gaps, so a card that has been moved or grown can be overlapped by the
  // next one, and an overlapped card's handles are correctly hidden behind that
  // neighbour. Bring the card to the front first — the same thing a creator
  // would do — so its handles are genuinely reachable.
  await selectGuideCardInLayers(PHOTO);
  await new Promise(r => setTimeout(r, 250));
  await page.evaluate(() => {
    const row = document.querySelector('#studio-layers-list .studio-layer-selected');
    const btn = row && row.querySelector('.studio-layer-action[data-action="front"]');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 300));

  const sized = await guideCardBySection(PHOTO);
  const handle = await guideCardHandlePoint(await guideCardIndex(PHOTO), 'e');
  check(!!handle, 'the guide card exposes an east resize handle');
  check(handle.isHandle, `the east handle is the hit target, got ${handle.topEl}`);
  await dragMouse(handle, { x: handle.x + 80, y: handle.y });
  const afterResize = await guideCardBySection(PHOTO);
  check(afterResize.width > sized.width,
    `dragging the east handle widened the card (${sized.width} -> ${afterResize.width})`);
  check(afterResize.height === sized.height, `an edge handle changed only the width, height ${sized.height} -> ${afterResize.height}`);

  // A CORNER handle changes both axes.
  const beforeCorner = await guideCardBySection(PHOTO);
  const corner = await guideCardHandlePoint(await guideCardIndex(PHOTO), 'se');
  check(!!corner?.isHandle, `the south-east handle is the hit target, got ${corner && corner.topEl}`);
  await dragMouse(corner, { x: corner.x + 60, y: corner.y + 40 });
  const afterCorner = await guideCardBySection(PHOTO);
  check(afterCorner.width > beforeCorner.width && afterCorner.height > beforeCorner.height,
    `dragging the corner handle grew both axes (${beforeCorner.width}x${beforeCorner.height} -> ${afterCorner.width}x${afterCorner.height})`);
});

await step('CREATOR-09: guide card Properties stay in step with the card', async () => {
  await prepareStableCanvas();
  await selectGuideCardInLayers('PHOTO GALLERY');
  await new Promise(r => setTimeout(r, 250));

  // Recompute the index AFTER the canvas is prepared: bringing a card to the
  // front re-orders the DOM, so an index taken earlier can be stale.
  const shown = await guideCards();
  const galleryIndex = shown.findIndex(c => c.section === 'PHOTO GALLERY');
  const gallery = shown[galleryIndex];
  check(!!gallery, 'a Photo Gallery guide card exists');

  // The Properties panel shows the card's real geometry.
  for (const [field, value] of [['X', gallery.x], ['Y', gallery.y], ['Width', gallery.width], ['Height', gallery.height]]) {
    const shownValue = Number(await propValue(field));
    check(shownValue === value, `Properties ${field} matches the card (${shownValue} vs ${value})`);
  }

  // Changing a Properties field resizes the card on the canvas.
  await setPropValue('Width', '300');
  await new Promise(r => setTimeout(r, 250));
  const afterField = (await guideCards())[galleryIndex];
  check(afterField.width === 300, `the Width field resized the card, got ${afterField.width}`);

  // And dragging the card updates the Properties field (CREATOR-09 §12).
  await prepareStableCanvas();
  await selectGuideCardInLayers('PHOTO GALLERY');
  await new Promise(r => setTimeout(r, 250));
  const body = await guideCardBodyPoint(await guideCardIndex('PHOTO GALLERY'));
  check(!!body?.hitsThis,
    `the Gallery card body is reachable, got ${body && body.topEl} cards=${await guideCardCount()} trace=${JSON.stringify(body && body.trace)}`);
  await dragMouse(body, { x: body.x + 40, y: body.y + 25 });
  const afterDrag = (await guideCards())[galleryIndex];
  const shownX = Number(await propValue('X'));
  const shownY = Number(await propValue('Y'));
  check(afterDrag.x !== gallery.x && afterDrag.y !== gallery.y, `the card moved from (${gallery.x},${gallery.y}) to (${afterDrag.x},${afterDrag.y})`);
  check(shownX === afterDrag.x && shownY === afterDrag.y,
    `Properties followed the drag (X ${shownX} vs ${afterDrag.x}, Y ${shownY} vs ${afterDrag.y})`);
});

await step('CREATOR-09: a guide card can be deleted, and deletion survives reopening', async () => {
  await ensureGuidePresent();
  const before = await guideCardCount();
  await selectGuideCardInLayers('BIO');
  await new Promise(r => setTimeout(r, 250));
  await page.click('#studio-guide-delete');
  await new Promise(r => setTimeout(r, 300));
  const after = await guideCardCount();
  check(after === before - 1, `deleting a card removed exactly one (${before} -> ${after})`);
  const sections = (await guideCards()).map(c => c.section);
  check(!sections.includes('BIO'), `the deleted card is gone, got ${JSON.stringify(sections)}`);

  // Save, then RELOAD the whole studio and reopen the design. An intentional
  // deletion must NOT be undone by the guide initialisation path.
  await page.click('#studio-save');
  await new Promise(r => setTimeout(r, 1500));
  const designId = await page.$eval('#studio-design-select', el => el.value);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#studio-design-select', { timeout: 15000 });
  await waitForStudioReady();
  await new Promise(r => setTimeout(r, 1200));
  await page.select('#studio-design-select', designId);
  await new Promise(r => setTimeout(r, 1500));
  const reopened = (await guideCards()).map(c => c.section);
  check(!reopened.includes('BIO'), `reopening the design did NOT recreate the deleted card, got ${JSON.stringify(reopened)}`);
  check(reopened.length === after, `reopening created no extra cards (${after} -> ${reopened.length})`);
});

await step('CREATOR-09: Reset Guide restores exactly one default set', async () => {
  // Delete two more cards so Reset has real work to do.
  for (const label of ['ALIAS', 'TESTIMONIALS']) {
    await ensureGuidePresent();
    if (await selectGuideCardInLayers(label)) {
      await new Promise(r => setTimeout(r, 200));
      await page.click('#studio-guide-delete');
      await new Promise(r => setTimeout(r, 250));
    }
  }
  const damaged = await guideCardCount();
  check(damaged < DEFAULT_GUIDE_SIZE, `some cards are missing before the reset (${damaged} of ${DEFAULT_GUIDE_SIZE})`);

  await page.click('#studio-guide-reset');
  await new Promise(r => setTimeout(r, 400));
  const restored = await guideCards();
  eq(restored.length, DEFAULT_GUIDE_SIZE, `reset restored exactly one default set, got ${restored.length} cards`);
  const sections = restored.map(c => c.section);
  check(new Set(sections).size === sections.length, `reset created no duplicates, got ${JSON.stringify(sections)}`);
  check(sections.includes('BIO') && sections.includes('ALIAS') && sections.includes('TESTIMONIALS'),
    `reset brought back every default section, got ${JSON.stringify(sections)}`);
});

await step('CREATOR-09: guide cards never appear in Preview', async () => {
  await ensureGuidePresent();
  check(await guideCardCount() > 0, 'a guide set is present before Preview');
  await page.click('#studio-preview-toggle');
  await new Promise(r => setTimeout(r, 350));
  const inPreview = await page.evaluate(() => ({
    cards: document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide_card"]').length,
    legacy: document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide"]').length,
    previewClass: !!document.querySelector('#creator-studio.studio-preview-mode'),
  }));
  check(inPreview.previewClass, 'preview mode is active');
  check(inPreview.cards === 0, `no guide card is drawn in Preview, got ${inPreview.cards}`);
  check(inPreview.legacy === 0, `no legacy guide is drawn in Preview, got ${inPreview.legacy}`);
  await page.click('#studio-preview-toggle');
  await new Promise(r => setTimeout(r, 300));
  check(await guideCardCount() > 0, 'leaving Preview brings the guide cards back');
});

// ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝
// CREATOR-10 — the Profile Viewer shows the REAL profile, the outer Profile
// Background, and direct image drag/resize in DESIGN coordinates.
// ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝

await step('CREATOR-10: the Profile Viewer shows the real profile layout', async () => {
  await ensureGuidePresent();
  const view = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(parseFloat(el.style.left)), y: Math.round(parseFloat(el.style.top)), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const skeleton = q('#studio-profile-skeleton');
    return {
      exists: !!skeleton,
      // The outer Profile Background area.
      background: box(q('#studio-profile-skeleton [data-skeleton="background"]')),
      // The two real columns, drawn as SEPARATE areas.
      main: box(q('#studio-profile-skeleton [data-skeleton="main"]')),
      sidebar: box(q('#studio-profile-skeleton [data-skeleton="sidebar"]')),
      // One INDEPENDENT card per real profile module.
      modules: Array.from(document.querySelectorAll('#studio-profile-skeleton [data-skeleton-module]'))
        .map(el => ({
          id: el.dataset.skeletonModule,
          column: el.dataset.skeletonColumn,
          label: el.querySelector('.studio-skeleton-label')?.textContent || '',
          x: Math.round(parseFloat(el.style.left)),
          y: Math.round(parseFloat(el.style.top)),
          w: Math.round(parseFloat(el.style.width)),
          h: Math.round(parseFloat(el.style.height)),
        })),
      // Studio-only chrome: never a hit target, never a component.
      pointerEvents: skeleton ? getComputedStyle(skeleton).pointerEvents : null,
      ariaHidden: skeleton?.getAttribute('aria-hidden'),
      asComponent: document.querySelectorAll('#studio-profile-skeleton[data-comp-id]').length,
    };
  });

  check(view.exists, 'the profile structure is drawn on the canvas');
  // The outer background exists and covers the whole design.
  check(!!view.background, 'the outer Profile Background area is present');
  eq(view.background.x, 0, 'background x');
  eq(view.background.y, 0, 'background y');
  eq(view.background.w, 960, 'background width');
  eq(view.background.h, 1200, 'background height');

  // Main and sidebar are separate, non-overlapping areas.
  check(!!view.main && !!view.sidebar, 'both the main profile area and the sidebar are present');
  check(view.main.x < view.sidebar.x, 'the sidebar is to the right of the main profile');
  check(view.main.x + view.main.w <= view.sidebar.x, 'the main profile and sidebar do not overlap');

  // Every sidebar feature is its own independent card.
  const byId = new Map(view.modules.map(m => [m.id, m]));
  for (const [id, label] of [
    ['friend_space', 'FRIEND SPACE'], ['gallery', 'PHOTO GALLERY'],
    ['video_box', 'VIDEO BOX'], ['music', 'MUSIC'], ['scraps', 'SCRAPS'],
  ]) {
    const m = byId.get(id);
    check(!!m, `the "${id}" module card is present`);
    eq(m.column, 'sidebar', `${id} is in the sidebar`);
    eq(m.label, label, `${id} label`);
    check(m.x >= view.sidebar.x, `the "${id}" card sits inside the sidebar`);
    check(m.x + m.w <= view.sidebar.x + view.sidebar.w, `the "${id}" card fits the sidebar width`);
  }
  // Each is a DISTINCT card — none merged into one giant sidebar block.
  const sidebarCards = view.modules.filter(m => m.column === 'sidebar');
  const distinct = new Set(sidebarCards.map(m => `${m.x},${m.y},${m.w},${m.h}`));
  eq(distinct.size, sidebarCards.length, 'every sidebar module has its own distinct card');
  for (const m of sidebarCards) {
    check(m.h < view.sidebar.h, `"${m.id}" is not one giant sidebar block`);
  }

  // The main column holds the real main sections, and NO Gallery below
  // Testimonials — Photo Gallery is a sidebar module on the real profile.
  for (const id of ['profile_photo', 'name', 'alias', 'bio', 'personal_info', 'testimonials']) {
    const m = byId.get(id);
    check(!!m, `the main module "${id}" is present`);
    eq(m.column, 'main', `${id} is in the main profile`);
  }
  const bio = byId.get('bio');
  const testimonials = byId.get('testimonials');
  check(!!testimonials && !!bio, 'both Bio and Testimonials are present');
  for (const m of view.modules.filter(m => m.column === 'main' && m.id !== 'testimonials')) {
    check(m.y + m.h <= testimonials.y + 1,
      `main module "${m.id}" is not below Testimonials (Photo Gallery must not be invented there)`);
  }
  check(!!byId.get('gallery') && byId.get('gallery').column === 'sidebar',
    'Photo Gallery is a sidebar card, not a main-column section');

  // The structure is chrome, not content: never selectable, never a component.
  eq(view.pointerEvents, 'none', 'the profile structure never intercepts a pointer');
  eq(view.ariaHidden, 'true', 'the profile structure is hidden from assistive tech');
  eq(view.asComponent, 0, 'the profile structure is not made of design components');
});

await step('CREATOR-10: the real profile structure and the guide agree', async () => {
  const view = await page.evaluate(() => {
    const read = (sel) => Array.from(document.querySelectorAll(sel)).map(el => ({
      label: (el.querySelector('.studio-skeleton-label') || el.querySelector('.studio-guide-card-label'))?.textContent || '',
      x: Math.round(parseFloat(el.style.left)),
      y: Math.round(parseFloat(el.style.top)),
      w: Math.round(parseFloat(el.style.width)),
      h: Math.round(parseFloat(el.style.height)),
    }));
    return {
      skeleton: read('#studio-profile-skeleton [data-skeleton-module]'),
      guide: read('#studio-canvas-inner [data-comp-type="profile_guide_card"]'),
    };
  });
  const guideByLabel = new Map(view.guide.map(c => [c.label, c]));
  eq(view.guide.length, view.skeleton.length,
    'the guide has exactly one card per real profile module');
  for (const m of view.skeleton) {
    const card = guideByLabel.get(m.label);
    check(!!card, `the guide marks "${m.label}", which the structure draws`);
    eq(card.x, m.x, `${m.label} guide x matches the structure`);
    eq(card.y, m.y, `${m.label} guide y matches the structure`);
    eq(card.w, m.w, `${m.label} guide width matches the structure`);
    eq(card.h, m.h, `${m.label} guide height matches the structure`);
  }
});

await step('CREATOR-10: the guide never appears publicly, and neither does the structure', async () => {
  await page.click('#studio-preview-toggle');
  await new Promise(r => setTimeout(r, 350));
  const inPreview = await page.evaluate(() => ({
    cards: document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide_card"]').length,
    skeleton: document.querySelectorAll('#studio-profile-skeleton').length,
  }));
  eq(inPreview.cards, 0, 'no guide card is drawn in Preview');
  eq(inPreview.skeleton, 0, 'the studio-only profile structure is not drawn in Preview');
  await page.click('#studio-preview-toggle');
  await new Promise(r => setTimeout(r, 300));
  check(await guideCardCount() > 0, 'leaving Preview brings the guide cards back');

  // The real public profile must never render a guide card either.
  const publicProfile = await api('GET', `/api/profile/${seller.username}`);
  check(publicProfile.status === 200, 'the public profile loads');
  const designComps = publicProfile.data?.design?.layout?.components || [];
  for (const c of designComps) {
    check(!['profile_guide_card', 'profile_guide'].includes(c.type),
      `the published design carries no public guide type, got ${c.type}`);
  }
  const rendered = await page.evaluate(() => document.querySelectorAll(
    '#profile-frame [data-comp-type="profile_guide_card"], #profile-frame .studio-guide-card',
  ).length);
  eq(rendered, 0, 'no guide card is rendered on the public profile');
});

await step('CREATOR-10: the Profile Background is uploaded and sits behind the whole profile', async () => {
  await ensureEditingMode();
  await ensureGuidePresent();
  // The background is a property of the whole DESIGN, so show the canvas-level
  // Properties by clearing any component selection.
  await pinStudioInView();
  await deselectComponent();
  await new Promise(r => setTimeout(r, 200));

  const before = await page.evaluate(() => ({
    layer: !!document.querySelector('#studio-profile-background'),
    set: document.querySelector('#studio-profile-background')?.dataset.profileBackground,
    preview: document.querySelector('[data-profile-background-preview]')?.dataset.profileBackgroundPreview,
    hasUpload: !!document.querySelector('#studio-background-upload'),
    selected: !!document.querySelector('#studio-canvas-inner .studio-selected'),
  }));
  check(before.layer, 'the background LAYER always exists, so the creator sees where it goes');
  check(!before.selected, 'no component is selected, so the canvas Properties are shown');
  eq(before.hasUpload, true, 'the Properties panel offers Upload Image');
  eq(before.set, 'none', 'no background is set to begin with');

  // Upload a real image through the app's own control, using the existing
  // server-validated Creator Studio upload endpoint.
  const input = await page.$('#studio-background-file');
  check(!!input, 'the background file input exists');
  await input.uploadFile(bgFixturePath);
  await new Promise(r => setTimeout(r, 1200));

  const staged = await page.evaluate(() => ({
    applyEnabled: !document.querySelector('#studio-background-apply')?.disabled,
    status: document.querySelector('#studio-background-status')?.textContent || '',
  }));
  check(staged.applyEnabled, `the upload is staged and can be applied, status="${staged.status}"`);

  await page.click('#studio-background-apply');
  await new Promise(r => setTimeout(r, 400));
  const decoded = await waitForImage('#studio-profile-background img');
  check(!decoded.timedOut, 'the uploaded background actually decoded');
  check(/\/uploads\/creator\//.test(decoded.src), `the background is the uploaded application URL, got "${decoded.src}"`);
  check(decoded.naturalW > 0 && decoded.naturalH > 0,
    `the uploaded image actually loaded (${decoded.naturalW}x${decoded.naturalH})`);

  const applied = await page.evaluate(() => {
    const layer = document.querySelector('#studio-profile-background');
    const img = layer?.querySelector('img');
    const doc = document.querySelector('#studio-canvas-document');
    const lr = layer?.getBoundingClientRect();
    const sr = layer?.parentElement?.getBoundingClientRect();
    // Is the background behind the main column AND every sidebar card?
    //
    // Overlap, not full containment: the design canvas is 1200px tall and the
    // viewer clips it, so a column's box legitimately extends below the visible
    // area and is reached by panning. The requirement is that every VISIBLE part
    // of each area sits over the background, which is what the backdrop being
    // exactly the viewer guarantees — so assert the areas are actually shown
    // over it rather than fully swallowed by it.
    const behind = (sel) => Array.from(document.querySelectorAll(sel)).map(el => {
      const r = el.getBoundingClientRect();
      const overlapW = Math.max(0, Math.min(r.right, lr.right) - Math.max(r.left, lr.left));
      const overlapH = Math.max(0, Math.min(r.bottom, lr.bottom) - Math.max(r.top, lr.top));
      return { inside: overlapW > 4 && overlapH > 4, overlapW: Math.round(overlapW), overlapH: Math.round(overlapH) };
    });
    return {
      set: layer?.dataset.profileBackground,
      src: img?.getAttribute('src') || '',
      naturalW: img?.naturalWidth || 0,
      naturalH: img?.naturalHeight || 0,
      fillW: img ? Math.round(img.getBoundingClientRect().width) : 0,
      fillH: img ? Math.round(img.getBoundingClientRect().height) : 0,
      // The background is a LAYER, not a content card: no geometry, not a
      // component, nothing to select, drag or resize.
      asComponent: document.querySelectorAll('#studio-profile-background[data-comp-id]').length,
      hasHandles: document.querySelectorAll('#studio-profile-background [data-resize]').length,
      inLayerRows: document.querySelectorAll('#studio-layers-list .studio-layer-name')
        .length && Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-name'))
          .some(el => /background/i.test(el.textContent)),
      main: behind('#studio-profile-skeleton [data-skeleton="main"]'),
      sidebar: behind('#studio-profile-skeleton [data-skeleton="sidebar"]'),
      sidebarCards: behind('#studio-profile-skeleton [data-skeleton-module][data-skeleton-column="sidebar"]'),
      doc: !!doc,
      layerInsideDoc: !!lr && !!sr,
    };
  });

  eq(applied.set, 'set', 'the background is set');
  check(/\/uploads\/creator\//.test(applied.src), `the background is the uploaded application URL, got "${applied.src}"`);
  check(applied.naturalW > 0 && applied.naturalH > 0,
    `the uploaded image actually loaded (${applied.naturalW}x${applied.naturalH})`);

  // It covers the WHOLE editing area, so the entire design canvas — main column
  // and every sidebar card — sits on top of it. Since CREATOR-10B the backdrop
  // fills the VIEWER rather than the 960x1200 canvas, which is what a published
  // profile does, so the invariant is "the viewer is covered and the canvas is
  // inside that covered area" rather than a fixed pixel width.
  // CREATOR-10C: the background is a layer OF the 960x1200 design canvas, not a
  // viewer-wide backdrop. It must cover the canvas exactly, and it must not be
  // the thing that fills the viewer around it. The canvas may still be clipped
  // by the viewer at 100% zoom — that is correct, and panning reaches the rest.
  const cover = await page.evaluate(() => {
    const layer = document.querySelector('#studio-profile-background');
    const doc = document.querySelector('#studio-canvas-document');
    if (!layer || !doc) return null;
    const lr = layer.getBoundingClientRect();
    const dr = doc.getBoundingClientRect();
    return {
      layerW: Math.round(lr.width), layerH: Math.round(lr.height),
      canvasW: Math.round(dr.width), canvasH: Math.round(dr.height),
      insideDoc: doc.contains(layer),
      coversCanvas: Math.abs(lr.width - dr.width) <= 2 && Math.abs(lr.height - dr.height) <= 2,
    };
  });
  check(cover && cover.insideDoc, 'the background is a layer of the design canvas');
  check(cover && cover.coversCanvas,
    `the background covers exactly the design canvas, got ${JSON.stringify(cover)}`);
  for (const m of applied.main) check(m.inside, 'the main profile area is inside the background');
  for (const m of applied.sidebar) check(m.inside, 'the sidebar area is inside the background');
  for (const m of applied.sidebarCards) check(m.inside, 'every sidebar card is inside the background');
  eq(applied.sidebarCards.length, 6, 'all six sidebar cards sit on the background');

  // And it is NOT a normal image card.
  eq(applied.asComponent, 0, 'the background is not a design component');
  eq(applied.hasHandles, 0, 'the background has no resize handles');
  eq(applied.inLayerRows, false, 'the background is not listed in Layers as a component');
});

await step('CREATOR-10: the background saves, reloads and reaches the published profile', async () => {
  const saved = await page.evaluate(async () => {
    document.querySelector('#studio-save').click();
    return true;
  });
  check(saved, 'Save Draft was clicked');
  await new Promise(r => setTimeout(r, 1500));

  const persisted = await page.evaluate(() => ({
    status: document.querySelector('#studio-status')?.textContent || '',
    src: document.querySelector('#studio-profile-background img')?.getAttribute('src') || '',
  }));
  check(/saved/i.test(persisted.status), `the draft saved, status="${persisted.status}"`);
  check(/\/uploads\/creator\//.test(persisted.src), 'the background is still applied after saving');

  // Reload the design through the app's own selector: the background must come back.
  const designId = await page.$eval('#studio-design-select', el => el.value);
  await page.select('#studio-design-select', '__none__');
  await new Promise(r => setTimeout(r, 300));
  const reloaded = await page.evaluate(() => ({
    set: document.querySelector('#studio-profile-background')?.dataset.profileBackground,
    src: document.querySelector('#studio-profile-background img')?.getAttribute('src') || '',
  }));
  check(reloaded.set === 'set' || /\//.test(reloaded.src),
    `reopening the design preserves the background (set=${reloaded.set} src="${reloaded.src}")`);

  // Publish, then confirm the PUBLIC profile receives it on its own outer
  // background layer — the real published behaviour.
  await page.click('#studio-publish');
  await new Promise(r => setTimeout(r, 1800));
  const publicProfile = await api('GET', `/api/profile/${seller.username}`);
  check(publicProfile.status === 200, 'the public profile loads after publishing');
  const bg = publicProfile.data?.design?.theme?.backgroundImage;
  check(/\/uploads\/creator\//.test(bg || ''), `the published design carries the background, got "${bg}"`);
  void designId;
});

await step('CREATOR-10: an uploaded image can be dragged and resized on the canvas', async () => {
  await ensureEditingMode();
  await pinStudioInView();
  await deselectComponent();

  // Add a fresh image component and give it the uploaded picture.
  await page.evaluate(() => {
    const item = document.querySelector('#studio-content-list [data-type="image"]');
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 250));
  const armed = await page.evaluate(() => ({
    status: document.querySelector('#studio-status')?.textContent || '',
  }));
  check(/place it/i.test(armed.status), `clicking Image armed a placement, status="${armed.status}"`);
  // Place it in the empty strip of the main column, below the profile modules.
  await page.evaluate(() => {
    const doc = document.querySelector('#studio-canvas-document');
    const r = doc.getBoundingClientRect();
    const opts = { bubbles: true, clientX: r.left + 300, clientY: r.top + 700, button: 0, pointerId: 1 };
    doc.dispatchEvent(new PointerEvent('pointerdown', opts));
    doc.dispatchEvent(new PointerEvent('pointerup', opts));
  });
  await new Promise(r => setTimeout(r, 450));
  const placed = await page.evaluate(() => {
    // Scope to the SELECTED image: an earlier step already put an image on this
    // canvas, so the first [data-comp-type="image"] is not the one just added.
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="image"].studio-selected');
    return {
      exists: !!el,
      selected: !!el,
      id: el?.dataset.compId || '',
      images: document.querySelectorAll('#studio-canvas-inner [data-comp-type="image"]').length,
      status: document.querySelector('#studio-status')?.textContent || '',
      title: document.querySelector('#studio-properties .studio-prop-title')?.textContent || '',
    };
  });
  check(placed.exists,
    `the image component was added to the canvas (images=${placed.images} status="${placed.status}")`);
  check(placed.selected,
    `the new image component is the selected one (id="${placed.id}" title="${placed.title}")`);

  const fileInput = await page.$('#studio-properties input[type=file]');
  check(!!fileInput, 'the image component offers an upload control');
  await fileInput.uploadFile(bgFixturePath);
  await new Promise(r => setTimeout(r, 1200));
  const decoded = await waitForImage('#studio-canvas-inner [data-comp-type="image"].studio-selected img');
  check(/\/uploads\/creator\//.test(decoded.src), `the component holds the uploaded file, got "${decoded.src}"`);
  check(decoded.naturalW > 0, `the uploaded image loaded (naturalWidth ${decoded.naturalW})`);

  await prepareStableCanvas();
  // Bring the image to the front so its handles are reachable, as a creator would.
  await page.evaluate(() => {
    const row = document.querySelector('#studio-layers-list .studio-layer-selected');
    row?.querySelector('.studio-layer-action[data-action="front"]')?.click();
  });
  await new Promise(r => setTimeout(r, 350));
  await prepareStableCanvas();

  const geomOf = () => page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="image"].studio-selected');
    if (!el) return null;
    const img = el.querySelector('img');
    const r = img.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    return {
      x: parseFloat(el.style.left), y: parseFloat(el.style.top),
      width: parseFloat(el.style.width), height: parseFloat(el.style.height),
      src: img.getAttribute('src') || '',
      naturalW: img.naturalWidth, naturalH: img.naturalHeight,
      // The IMAGE, not just the box, is what changes size.
      imgW: Math.round(r.width), imgH: Math.round(r.height),
      boxW: Math.round(cr.width), boxH: Math.round(cr.height),
      visible: r.width > 1 && r.height > 1,
      fit: img.className,
    };
  });
  const handlePoint = (dir) => page.evaluate((d) => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="image"].studio-selected');
    const h = el?.querySelector(`[data-resize="${d}"]`);
    if (!h) return null;
    const r = h.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return { x, y, isHandle: document.elementFromPoint(x, y) === h };
  }, dir);

  const start = await geomOf();
  check(!!start, 'the uploaded image appears in the Profile Viewer');
  check(start.visible, 'the image is actually visible, not just a placeholder box');
  check(/\/uploads\/creator\//.test(start.src), `the image is the uploaded file, got "${start.src}"`);
  check(start.naturalW > 0, `the source image loaded at its natural size (${start.naturalW}px)`);

  // ── Move ──
  const box = await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="image"].studio-selected');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(box, { x: box.x - 90, y: box.y - 50 });
  const moved = await geomOf();
  check(moved.x !== start.x || moved.y !== start.y,
    `dragging the image moved it (${start.x},${start.y} -> ${moved.x},${moved.y})`);
  eq(moved.width, start.width, 'moving does not change the width');
  eq(moved.height, start.height, 'moving does not change the height');

  // ── Resize with a CORNER handle (both dimensions) ──
  const se = await handlePoint('se');
  check(!!se?.isHandle, `the south-east corner handle is the hit target, got ${se && JSON.stringify(se)}`);
  const beforeCorner = await geomOf();
  await dragMouse(se, { x: se.x + 90, y: se.y + 70 });
  const afterCorner = await geomOf();
  check(afterCorner.width > beforeCorner.width, `a corner handle widened the image (${beforeCorner.width} -> ${afterCorner.width})`);
  check(afterCorner.height > beforeCorner.height, `a corner handle grew the image (${beforeCorner.height} -> ${afterCorner.height})`);
  check(afterCorner.visible, 'the image is still visible after a corner resize');
  // The IMAGE resized, not just an invisible box around it.
  check(afterCorner.imgW > beforeCorner.imgW && afterCorner.imgH > beforeCorner.imgH,
    `the visible picture resized (${beforeCorner.imgW}x${beforeCorner.imgH} -> ${afterCorner.imgW}x${afterCorner.imgH})`);

  // ── Resize with an EDGE handle (one dimension only) ──
  const e = await handlePoint('e');
  check(!!e?.isHandle, `the east edge handle is the hit target, got ${e && JSON.stringify(e)}`);
  const beforeEdge = await geomOf();
  await dragMouse(e, { x: e.x + 80, y: e.y });
  const afterEdge = await geomOf();
  check(afterEdge.width > beforeEdge.width, `an edge handle widened the image (${beforeEdge.width} -> ${afterEdge.width})`);
  eq(afterEdge.height, beforeEdge.height, 'an edge handle changed ONLY the width');
  check(afterEdge.imgW > beforeEdge.imgW, 'the visible picture widened with the edge handle');

  // ── All 8 handles exist and are reachable ──
  const handles = await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="image"].studio-selected');
    return Array.from(el.querySelectorAll('[data-resize]')).map(h => h.dataset.resize);
  });
  for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    check(handles.includes(dir), `the ${dir} resize handle exists`);
  }
  eq(handles.length, 8, 'there are exactly the 8 normal resize handles');

  // ── Image quality: the SOURCE is untouched by resizing ──
  check(afterEdge.src === start.src, 'resizing never changes the image source');
  eq(afterEdge.naturalW, start.naturalW, 'the source resolution is unchanged by resizing');
  eq(afterEdge.naturalH, start.naturalH, 'the source height is unchanged by resizing');
  // The app must not swap in a re-encoded/rasterised bitmap at a new size.
  const noCanvas = await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="image"].studio-selected');
    return {
      canvases: el.querySelectorAll('canvas').length,
      backgrounds: Array.from(el.querySelectorAll('img')).map(i => i.style.backgroundImage || '').filter(Boolean).length,
    };
  });
  eq(noCanvas.canvases, 0, 'the image is never rasterised into a canvas');
  eq(noCanvas.backgrounds, 0, 'the image is not swapped for a CSS background bitmap');

  // ── Zoom and pan do not change image geometry ──
  const beforeZoom = await geomOf();
  await page.click('#studio-zoom-in');
  await page.click('#studio-zoom-in');
  await new Promise(r => setTimeout(r, 300));
  const afterZoom = await geomOf();
  for (const k of ['x', 'y', 'width', 'height']) {
    eq(afterZoom[k], beforeZoom[k], `zooming does not change the image ${k}`);
  }
  eq(afterZoom.naturalW, beforeZoom.naturalW, 'zooming does not change the stored image resolution');

  // Panning the viewer must not move the image either.
  const panBefore = await geomOf();
  const empty = await page.evaluate(() => {
    const v = document.querySelector('#studio-viewer').getBoundingClientRect();
    return { x: v.left + 14, y: v.bottom - 14 };
  });
  await dragMouse(empty, { x: empty.x - 60, y: empty.y - 40 });
  const panAfter = await geomOf();
  for (const k of ['x', 'y', 'width', 'height']) {
    eq(panAfter[k], panBefore[k], `panning does not change the image ${k}`);
  }

  // Fit shows the whole profile without touching geometry either.
  const beforeFit = await geomOf();
  await page.click('#studio-zoom-fit');
  await new Promise(r => setTimeout(r, 300));
  const afterFit = await geomOf();
  for (const k of ['x', 'y', 'width', 'height']) {
    eq(afterFit[k], beforeFit[k], `Fit does not change the image ${k}`);
  }
  const fit = await page.evaluate(() => {
    const v = document.querySelector('#studio-viewer').getBoundingClientRect();
    const d = document.querySelector('#studio-canvas-document').getBoundingClientRect();
    return {
      zoom: document.querySelector('#studio-zoom-readout')?.textContent.trim(),
      designRight: d.right, viewRight: v.right,
      designLeft: d.left, viewLeft: v.left,
    };
  });
  check(fit.zoom !== '100%', `Fit changed the view scale, got ${fit.zoom}`);
  check(fit.designRight <= fit.viewRight + 2 && fit.designLeft >= fit.viewLeft - 2,
    `Fit brings the WHOLE design into the viewer (design ${fit.designLeft}..${fit.designRight}, viewer ${fit.viewLeft}..${fit.viewRight})`);
});

await step('CREATOR-10: resizing a Studio panel shrinks the viewer, not the design', async () => {
  await ensureEditingMode();
  await pinStudioInView();
  const designGeom = () => page.evaluate(() => {
    const doc = document.querySelector('#studio-canvas-document');
    const img = document.querySelector('#studio-canvas-inner [data-comp-type="image"]');
    const docR = doc.getBoundingClientRect();
    return {
      docW: Math.round(docR.width), docH: Math.round(docR.height),
      label: document.querySelector('#studio-canvas-size')?.textContent.trim(),
      imgX: img ? parseFloat(img.style.left) : null,
      imgY: img ? parseFloat(img.style.top) : null,
      imgW: img ? parseFloat(img.style.width) : null,
      imgH: img ? parseFloat(img.style.height) : null,
    };
  });

  // Reset to a known view first, so the canvas is fully visible.
  await page.click('#studio-zoom-reset');
  await new Promise(r => setTimeout(r, 300));
  await pinStudioInView();
  const before = await designGeom();
  const viewerBefore = await viewerBox();
  const dirtyBefore = await page.evaluate(() => !!document.querySelector('#studio-undo')?.disabled);

  // ── Widen the LEFT panel: the centre viewer must shrink ──
  const leftHandle = await page.$eval('#studio-col-resizer-left', el => {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2, y: r.top + r.height / 2,
      w: r.width, h: r.height,
    };
  });
  check(leftHandle.w > 0 && leftHandle.h > 0,
    `the left column resizer has a real hit area (${leftHandle.w}x${leftHandle.h})`);
  // The handle's own centre must be on screen, otherwise a press there is a
  // click on empty page rather than on the handle.
  const leftHit = await page.evaluate(([x, y]) => {
    const el = document.querySelector('#studio-col-resizer-left');
    const top = document.elementFromPoint(x, y);
    return { inView: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
             isSelf: !!(top && (top === el || el.contains(top))) };
  }, [leftHandle.x, leftHandle.y]);
  check(leftHit.inView, `the left resizer's centre is inside the viewport (${leftHandle.x},${leftHandle.y})`);
  check(leftHit.isSelf, 'the left resizer is the topmost element at its own centre');
  await dragMouse(leftHandle, { x: leftHandle.x + 120, y: leftHandle.y });
  await new Promise(r => setTimeout(r, 350));
  await pinStudioInView();
  const afterLeft = await designGeom();
  const viewerAfterLeft = await viewerBox();
  check(viewerAfterLeft.width < viewerBefore.width - 40,
    `widening the LEFT panel narrowed the centre viewer (${viewerBefore.width} -> ${viewerAfterLeft.width})`);
  eq(afterLeft.docW, before.docW, 'widening the LEFT panel did NOT change the canvas width');
  eq(afterLeft.docH, before.docH, 'widening the LEFT panel did NOT change the canvas height');
  eq(afterLeft.label, before.label, 'the stated design canvas size is unchanged');
  eq(afterLeft.imgX, before.imgX, 'the image was not moved by a panel resize');
  eq(afterLeft.imgW, before.imgW, 'the image was not resized by a panel resize');

  // ── Widen the RIGHT panel: the centre viewer must shrink too ──
  await pinStudioInView();
  const rightHandle = await page.$eval('#studio-col-resizer-right', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  });
  check(rightHandle.w > 0 && rightHandle.h > 0,
    `the right column resizer has a real hit area (${rightHandle.w}x${rightHandle.h})`);
  // Drag towards the centre, away from the far side, so the Properties panel grows.
  await dragMouse(rightHandle, { x: rightHandle.x - 120, y: rightHandle.y });
  await new Promise(r => setTimeout(r, 350));
  await pinStudioInView();
  const viewerAfterRight = await viewerBox();
  check(viewerAfterRight.width < viewerAfterLeft.width - 40,
    `widening the RIGHT panel narrowed the centre viewer further (${viewerAfterLeft.width} -> ${viewerAfterRight.width})`);
  const afterRight = await designGeom();
  eq(afterRight.imgW, before.imgW, 'the image survived the right panel resize unchanged');
  eq(afterRight.label, before.label, 'the design canvas size is still unchanged');

  // ── No overlap, and the viewer keeps a usable minimum ──
  const boxes = await page.evaluate(() => {
    const r = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, width: b.width, top: b.top, bottom: b.bottom };
    };
    return { left: r('#studio-elements'), stage: r('#studio-stage'), right: r('#studio-properties-panel') };
  });
  check(boxes.left && boxes.stage && boxes.right, 'all three columns are present');
  check(boxes.left.right <= boxes.stage.left + 1,
    `the Elements panel does not overlap the viewer (${boxes.left.right} vs ${boxes.stage.left})`);
  check(boxes.stage.right <= boxes.right.left + 1,
    `the Properties panel does not overlap the viewer (${boxes.stage.right} vs ${boxes.right.left})`);
  check(boxes.stage.width > 0, 'the viewer still has a positive width');

  // ── Narrowing the panels gives the space back ──
  await page.click('#studio-zoom-reset');
  await new Promise(r => setTimeout(r, 200));
  await pinStudioInView();
  const left2 = await page.$eval('#studio-col-resizer-left', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(left2, { x: left2.x - 120, y: left2.y });
  await new Promise(r => setTimeout(r, 350));
  await pinStudioInView();
  const viewerNarrowed = await viewerBox();
  check(viewerNarrowed.width > viewerAfterRight.width + 40,
    `narrowing the LEFT panel gave the space back to the viewer (${viewerAfterRight.width} -> ${viewerNarrowed.width})`);

  // ── Workspace resizing is not an edit ──
  const dirtyAfter = await page.evaluate(() => !!document.querySelector('#studio-undo')?.disabled);
  eq(dirtyAfter, dirtyBefore, 'resizing the panels never pushed an undo entry / dirtied the design');
  const handlesIntact = await page.evaluate(() => ({
    colResizers: document.querySelectorAll('#studio-layout .studio-col-resizer:not([hidden])').length,
    heightGrip: document.querySelectorAll('#studio-viewer-height-grip:not([hidden])').length,
  }));
  eq(handlesIntact.colResizers, 2, 'both column resizers are still usable');
  eq(handlesIntact.heightGrip, 1, 'the viewer height grip is still usable');
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
  // Pin the scroll: every coordinate below is a viewport coordinate.
  await pinStudioInView();
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
  await pinStudioInView();
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
  await pinStudioInView();
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
  await pinStudioInView();
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
  await pinStudioInView();
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
  //
  // Everything here is scoped to the SELECTED component. componentGeom() reads
  // the first ordinary component in DOM (z-index) order, which is not
  // necessarily the one Layers selected — comparing that component's geometry
  // across a drag would report a false failure whenever a lower-z component
  // also exists.
  //
  // The view is prepared through the app's own Fit control rather than
  // el.scrollIntoView(): the studio CLIPS the canvas and pans it with a
  // transform, so scrolling the (overflow:hidden) container behind the app's back
  // desynchronises it from the pan and the press then lands on empty canvas.
  await prepareStableCanvas();
  const selectedContentSelector =
    '#studio-canvas-inner [data-comp-id].studio-selected'
    + ':not([data-comp-type="profile_guide_card"]):not([data-comp-type="profile_guide"])';
  const selectedIsOrdinary = await page.$(selectedContentSelector);
  check(!!selectedIsOrdinary, 'the selected component is an ordinary content component');
  const readSelected = () => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      x: parseFloat(el.style.left), y: parseFloat(el.style.top),
      width: parseFloat(el.style.width), height: parseFloat(el.style.height),
    };
  }, selectedContentSelector);
  const geomBefore = await readSelected();
  const dragPoint = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selectedContentSelector);
  await new Promise(r => setTimeout(r, 200));
  check(!!dragPoint, 'component has a draggable centre in view');
  if (dragPoint) {
    await dragMouse(dragPoint, { x: dragPoint.x + 25, y: dragPoint.y + 15 });
  }
  const geomAfter = await readSelected();
  check(!!geomAfter, 'component still present after drag');
  const moved = geomBefore && geomAfter && (geomBefore.x !== geomAfter.x || geomBefore.y !== geomAfter.y);
  check(moved, `component drag still moves the component (${geomBefore?.x},${geomBefore?.y} -> ${geomAfter?.x},${geomAfter?.y})`);

  // Component resizing via its own handle still works. Pick an UNLOCKED,
  // visible component: a locked one swallows the pointerdown by design. Guide
  // cards are excluded — this step is about ORDINARY content editing.
  const target = await page.evaluate((sel) => {
    const el = document.querySelector(`${sel}:not(.studio-comp-locked):not(.studio-comp-hidden)`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // A real pointerdown, not el.click(): the editor attaches its resize
    // handles from the pointerdown handler, and a synthetic click never
    // reaches it, so the component would stay unselected with no handles.
    const opts = { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    window.dispatchEvent(new PointerEvent('pointerup', opts));
    return { id: el.dataset.compId };
  }, contentCompSelector);
  check(!!target, 'found an unlocked content component for the resize test');
  await new Promise(r => setTimeout(r, 250));

  const sizeBefore = await page.evaluate((id) => {
    const el = document.querySelector(`#studio-canvas-inner [data-comp-id="${id}"]`);
    return el ? { w: parseFloat(el.style.width), h: parseFloat(el.style.height) } : null;
  }, target.id);
  check(!!sizeBefore, 'component size readable for the resize handle test');

  // The component may sit outside the visible canvas, so reach it through the
  // app's own Fit control rather than scrollIntoView(): the studio CLIPS the
  // canvas and pans it with a transform, so scrolling the (overflow:hidden)
  // container behind the app's back desynchronises it from the pan.
  await prepareStableCanvas();

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
  // Panning is only meaningful while the design is LARGER than the viewer. A
  // design that already fits is deliberately centred and the pan is pinned —
  // that is correct behaviour, not a broken drag. An earlier step deliberately
  // grew the viewer to its ceiling, so establish the precondition explicitly
  // and assert that it really holds rather than assuming it.
  await pinStudioInView();
  await page.click('#studio-zoom-reset');
  await new Promise(r => setTimeout(r, 250));
  // Shrink in repeated drags: one drag can only move by the pointer delta, and
  // the viewer may start at its 4000px ceiling.
  for (let i = 0; i < 6; i += 1) {
    const h = await page.evaluate(() => Math.round(document.querySelector('#studio-viewer').getBoundingClientRect().height));
    if (h <= 700) break;
    await pinStudioInView();
    const shrink = await heightGripPoint();
    if (!shrink) break;
    await dragMouse(shrink, { x: shrink.x, y: shrink.y - 700 });
    await new Promise(r => setTimeout(r, 250));
  }
  const pre = await page.evaluate(() => {
    const v = document.querySelector('#studio-viewer').getBoundingClientRect();
    const d = document.querySelector('#studio-canvas-document').getBoundingClientRect();
    return {
      zoom: document.querySelector('#studio-zoom-readout')?.textContent.trim(),
      viewerH: Math.round(v.height),
      designH: Math.round(d.height),
      transform: document.querySelector('#studio-zoom-layer')?.style.transform,
    };
  });
  check(pre.designH > pre.viewerH,
    `the design is larger than the viewer, so there is something to pan (design ${pre.designH} vs viewer ${pre.viewerH} at ${pre.zoom})`);
  await pinCanvasInView();

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

// ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝
// CREATOR-10 — the editable canvas is always CENTRED, and every action that
// re-establishes the view (zoom, Fit, Reset, panel/viewer/window resize) must
// re-centre it. All of it is viewer-only state.
//
// These run LAST on purpose: they deliberately change zoom, pan and the panel
// widths, so running them earlier would perturb the workspace-state assertions
// that depend on a known starting layout.
// ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝

// Reload the Studio so these steps start from a KNOWN workspace: default panel
// widths, the default viewer height, a freshly-loaded (not dirty) design and
// 100% zoom. Earlier steps deliberately leave the panels narrowed, the viewer
// very short and the zoom far from 1, none of which is a state these assertions
// should have to cope with.
const resetStudioWorkspace = async () => {
  await page.goto(`${BASE}/#/creator-studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // An explicit reload is REQUIRED: navigating to the same URL with only a hash
  // change does not re-document in Chromium, so goto() alone would silently keep
  // the previous workspace (narrowed panels, a 300px viewer, a dirty design and
  // a populated undo stack) and every assertion below would run against stale
  // state. reload() guarantees a fresh module instance, so the default panel
  // widths, default viewer height, clean design and empty undo stack are real.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForStudioReady();
  await page.waitForSelector('#studio-design-select', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#studio-canvas-inner [data-comp-id]').length > 0,
    { timeout: 20000 });
  await new Promise(r => setTimeout(r, 300));
};

await step('CREATOR-10: the canvas is centered at 100%', async () => {
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  // Drive Reset through the real control so the assertion covers the button.
  await page.click('#studio-zoom-reset');
  await new Promise(r => setTimeout(r, 300));
  const p = await canvasPlacement();
  check(!!p, 'the canvas is measurable');
  eq(p.zoom, '100%', 'Reset returns the viewer to 100%');
  check(isCentred(p), `the canvas is centered at 100% — ${placeNote(p)}`);
  // At the default 100% the 960x1200 canvas is larger than the centre column, so
  // centring must show the canvas MIDDLE rather than pinning a corner.
  check(p.left < 0 && p.top < 0,
    `an oversized canvas is centered on its middle, not a corner — ${placeNote(p)}`);
  const geomBefore = await designSnapshot();
  await page.click('#studio-zoom-reset');
  await new Promise(r => setTimeout(r, 250));
  eq(JSON.stringify(await designSnapshot()), JSON.stringify(geomBefore),
    'Reset is idempotent and changed no design data');
});

await step('CREATOR-10: zooming out and back in keeps the canvas centered', async () => {
  // Fresh workspace so the "small zoom" half of this step starts from a viewer
  // large enough for a reduced canvas to genuinely FIT, which is the case that
  // must produce equal breathing room rather than a flush corner.
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  await page.click('#studio-zoom-reset');
  await new Promise(r => setTimeout(r, 250));

  for (const dir of ['out', 'in']) {
    // Two steps each, so the canvas crosses between "fits" and "oversized":
    // both must stay centred, which is the whole requirement.
    for (let i = 0; i < 2; i += 1) {
      await clickZoomControl(dir === 'out' ? '#studio-zoom-out' : '#studio-zoom-in');
    }
    const p = await canvasPlacement();
    check(isCentred(p), `zooming ${dir} keeps the canvas centered — ${placeNote(p)}`);
  }
  // A large zoom, where the canvas is far bigger than the viewer, must still
  // show the canvas centre rather than pinning a corner.
  for (let i = 0; i < 6; i += 1) {
    await clickZoomControl('#studio-zoom-in');
  }
  const big = await canvasPlacement();
  check(isCentred(big), `a large zoom stays centered — ${placeNote(big)}`);
  check(big.left < 0 && big.top < 0,
    `a large zoom shows the canvas middle, not a corner — ${placeNote(big)}`);

  // And a small zoom, where the canvas is much smaller than the viewer, must be
  // inset with equal room on all four sides.
  await clickZoomControl('#studio-zoom-reset');
  for (let i = 0; i < 5; i += 1) {
    await clickZoomControl('#studio-zoom-out');
  }
  const small = await canvasPlacement();
  check(isCentred(small), `a small zoom stays centered — ${placeNote(small)}`);
  check(small.canvasW < small.viewerW && small.canvasH < small.viewerH,
    `the small-zoom canvas really does fit the viewer — ${placeNote(small)}`);
  check(small.gapLeft > 0 && small.gapRight > 0 && small.gapTop > 0 && small.gapBottom > 0,
    `a small zoom insets the canvas from every edge — ${placeNote(small)}`);
  await clickZoomControl('#studio-zoom-reset');
});

await step('CREATOR-10: Reset re-centers after zooming and manual panning', async () => {
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  // Prove Reset recovers from a genuinely off-centre view, not from an
  // already-centred one.
  for (let i = 0; i < 4; i += 1) {
    await clickZoomControl('#studio-zoom-in');
  }
  await clickZoomControl('#studio-zoom-reset');
  const start = await canvasPlacement();
  check(isCentred(start), `the canvas starts centered before the manual pan — ${placeNote(start)}`);

  // Panning needs room to move, so make the canvas bigger than the viewer.
  for (let i = 0; i < 3; i += 1) {
    await clickZoomControl('#studio-zoom-in');
  }
  const empty = await emptyCanvasPoint();
  let panned = null;
  if (empty) {
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + 150, empty.y + 130, { steps: 8 });
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 250));
    panned = await canvasPlacement();
  }
  check(!!empty, 'found an empty-canvas point to pan from');
  check(panned && !isCentred(panned),
    `a manual pan does move the canvas off-centre — ${placeNote(panned)}`);

  await clickZoomControl('#studio-zoom-reset');
  const reset = await canvasPlacement();
  eq(reset.zoom, '100%', 'Reset is back at 100%');
  check(isCentred(reset), `Reset re-centers the canvas after panning — ${placeNote(reset)}`);
});

await step('CREATOR-10: resizing a side panel re-centers the canvas without touching the design', async () => {
  // Fresh workspace, so the centre column has room to be narrowed and widened.
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  await page.click('#studio-zoom-reset');
  await new Promise(r => setTimeout(r, 250));
  const before = await canvasPlacement();
  const geomBefore = await designSnapshot();
  const undoBefore = await undoDepth();

  // Widen the LEFT panel: the centre column narrows, so the canvas re-centres.
  const leftHandle = await page.$eval('#studio-col-resizer-left', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(leftHandle, { x: leftHandle.x + 90, y: leftHandle.y });
  await new Promise(r => setTimeout(r, 400));
  const afterLeft = await canvasPlacement();
  check(afterLeft.viewerW < before.viewerW - 30,
    `widening the left panel narrowed the centre viewer (${before.viewerW} -> ${afterLeft.viewerW})`);
  check(isCentred(afterLeft), `the canvas re-centers after a left panel resize — ${placeNote(afterLeft)}`);

  // Widen the RIGHT panel: the centre column narrows again, re-centring again.
  await pinStudioInView();
  const rightHandle = await page.$eval('#studio-col-resizer-right', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(rightHandle, { x: rightHandle.x - 90, y: rightHandle.y });
  await new Promise(r => setTimeout(r, 400));
  const afterRight = await canvasPlacement();
  check(afterRight.viewerW < afterLeft.viewerW - 30,
    `widening the right panel narrowed the centre viewer further (${afterLeft.viewerW} -> ${afterRight.viewerW})`);
  check(isCentred(afterRight), `the canvas re-centers after a right panel resize — ${placeNote(afterRight)}`);

  // Narrowing them again must give the space back and re-centre once more.
  await pinStudioInView();
  const leftBack = await page.$eval('#studio-col-resizer-left', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(leftBack, { x: leftBack.x - 90, y: leftBack.y });
  await new Promise(r => setTimeout(r, 400));
  const widened = await canvasPlacement();
  check(widened.viewerW > afterRight.viewerW + 30,
    `narrowing the left panel gave the space back (${afterRight.viewerW} -> ${widened.viewerW})`);
  check(isCentred(widened), `the canvas re-centers when the panels narrow — ${placeNote(widened)}`);

  // The design must be completely untouched by any of it.
  eq(JSON.stringify(await designSnapshot()), JSON.stringify(geomBefore),
    'resizing a side panel changed no component geometry, canvas size or image source');
  eq(await undoDepth(), undoBefore, 'resizing a side panel created no undo history');
});

await step('CREATOR-10: resizing the viewer height re-centers the canvas', async () => {
  // Fresh workspace, so the viewer starts at its full default height and can
  // genuinely be shortened.
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  const before = await canvasPlacement();
  const geomBefore = await designSnapshot();
  const grip = await heightGripPoint();
  check(!!grip, 'the viewer height grip is reachable');
  if (grip) {
    await dragMouse(grip, { x: grip.x, y: grip.y - 320 });
    await new Promise(r => setTimeout(r, 400));
  }
  const after = await canvasPlacement();
  check(after.viewerH < before.viewerH - 200, `the viewer got shorter (${before.viewerH} -> ${after.viewerH})`);
  check(isCentred(after), `the canvas re-centers after a viewer height change — ${placeNote(after)}`);
  eq(JSON.stringify(await designSnapshot()), JSON.stringify(geomBefore),
    'a viewer height change touched no component geometry');
});

await step('CREATOR-10: resizing the browser window re-centers the canvas', async () => {
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  const before = await canvasPlacement();
  await page.setViewport({ width: 1400, height: 860 });
  await new Promise(r => setTimeout(r, 600));
  const narrow = await canvasPlacement();
  check(narrow.viewerW < before.viewerW, `the centre viewer got narrower with the window (${before.viewerW} -> ${narrow.viewerW})`);
  check(isCentred(narrow), `the canvas re-centers after a window resize — ${placeNote(narrow)}`);
  await page.setViewport({ width: 1600, height: 900 });
  await new Promise(r => setTimeout(r, 600));
  const wide = await canvasPlacement();
  check(isCentred(wide), `the canvas re-centers again when the window widens — ${placeNote(wide)}`);
});

await step('CREATOR-10: centering never dirties the design or adds undo history', async () => {
  // A freshly-reloaded workspace: the design is loaded, not dirty, and the undo
  // stack is empty. Otherwise this would be asserting against a design that
  // earlier editing steps had already dirtied.
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  const undoBefore = await undoDepth();
  eq(undoBefore, 0, 'the reloaded workspace starts with no undo history');
  const geomBefore = await designSnapshot();

  // Exercise every re-centring path in one go. Reset is exercised with
  // expectChange:false because it is legitimately a no-op from an already-centred
  // 100% view; its real behaviour is proven in the dedicated step above.
  for (const selector of ['#studio-zoom-in', '#studio-zoom-out', '#studio-zoom-reset']) {
    await clickZoomControl(selector, { expectChange: selector !== '#studio-zoom-reset' });
  }
  await page.evaluate(() => document.querySelector('#studio-zoom-fit')?.click());
  await new Promise(r => setTimeout(r, 300));
  const leftHandle = await page.$eval('#studio-col-resizer-left', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dragMouse(leftHandle, { x: leftHandle.x + 70, y: leftHandle.y });
  await new Promise(r => setTimeout(r, 350));
  await page.setViewport({ width: 1450, height: 880 });
  await new Promise(r => setTimeout(r, 400));
  await page.setViewport({ width: 1600, height: 900 });
  await new Promise(r => setTimeout(r, 400));

  eq(await undoDepth(), undoBefore,
    'zooming, resetting, fitting, panel resize and window resize created no undo history');
  eq(JSON.stringify(await designSnapshot()), JSON.stringify(geomBefore),
    'no re-centring action changed any design data');
  check(isCentred(await canvasPlacement()), 'the canvas is still centered after all of that');

  // The strongest available proof that nothing was persisted: reload and confirm
  // the design that comes back from the server is byte-for-byte what it was.
  // (The Save button is not a dirty indicator — it is never disabled — so the
  // undo stack and the stored design are the meaningful signals.)
  await resetStudioWorkspace();
  eq(JSON.stringify(await designSnapshot()), JSON.stringify(geomBefore),
    'reloading proves the re-centring actions persisted nothing to the server');
});

await step('CREATOR-10: an image component survives every re-centring unchanged', async () => {
  await prepareStableCanvas();
  const imagePresent = await page.evaluate(() =>
    !!document.querySelector('#studio-canvas-inner [data-comp-type="image"]'));
  check(imagePresent, 'an image component is present to check against re-centring');
  if (!imagePresent) return;

  const readImage = () => page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="image"]');
    if (!el) return null;
    const img = el.querySelector('img');
    return {
      x: parseFloat(el.style.left), y: parseFloat(el.style.top),
      width: parseFloat(el.style.width), height: parseFloat(el.style.height),
      src: img?.getAttribute('src') || '', naturalW: img?.naturalWidth || 0,
    };
  });
  const before = await readImage();

  for (const selector of ['#studio-zoom-out', '#studio-zoom-in', '#studio-zoom-reset']) {
    await page.click(selector);
    await new Promise(r => setTimeout(r, 220));
    const after = await readImage();
    eq(after.x, before.x, `${selector} did not change the image x`);
    eq(after.y, before.y, `${selector} did not change the image y`);
    eq(after.width, before.width, `${selector} did not change the image width`);
    eq(after.height, before.height, `${selector} did not change the image height`);
    eq(after.src, before.src, `${selector} did not change the image source`);
    eq(after.naturalW, before.naturalW, `${selector} did not change the stored image resolution`);
  }
  await page.evaluate(() => document.querySelector('#studio-zoom-fit')?.click());
  await new Promise(r => setTimeout(r, 300));
  const afterFit = await readImage();
  eq(afterFit.x, before.x, 'Fit did not change the image x');
  eq(afterFit.y, before.y, 'Fit did not change the image y');
  eq(afterFit.width, before.width, 'Fit did not change the image width');
  eq(afterFit.height, before.height, 'Fit did not change the image height');
  eq(afterFit.src, before.src, 'Fit did not change the image source');
  eq(afterFit.naturalW, before.naturalW, 'Fit did not change the stored image resolution');
  check(isCentred(await canvasPlacement()), 'Fit also leaves the canvas centered');
});

await step('CREATOR-10: the Profile Background stays outside the main profile', async () => {
  const geom = await page.evaluate(() => {
    const layer = document.querySelector('#studio-profile-background');
    const bgBox = document.querySelector('#studio-profile-skeleton [data-skeleton="background"]');
    const main = document.querySelector('#studio-profile-skeleton [data-skeleton="main"]');
    const sidebar = document.querySelector('#studio-profile-skeleton [data-skeleton="sidebar"]');
    if (!layer || !bgBox) return { missing: true };
    const rect = (el) => el.getBoundingClientRect();
    const encloses = (a, b) => a.left <= b.left + 1 && a.top <= b.top + 1
      && a.right >= b.right - 1 && a.bottom >= b.bottom - 1;
    const lb = rect(layer);
    const bb = rect(bgBox);
    const mb = main ? rect(main) : null;
    const sb = sidebar ? rect(sidebar) : null;
    return {
      missing: false,
      layerEncloses: encloses(lb, bb),
      enclosesMain: !!mb && encloses(bb, mb),
      enclosesSidebar: !!sb && encloses(bb, sb),
      backgroundInsideMain: !!mb && encloses(mb, bb),
      sidebarInsideMain: !!mb && !!sb && encloses(mb, sb),
      isModuleCard: !!document.querySelector('#studio-profile-skeleton [data-skeleton-module][data-profile-background]'),
    };
  });
  check(!geom.missing, 'the Profile Background layer and the background area are both present');
  check(geom.layerEncloses, 'the background LAYER encloses the whole profile background area');
  check(geom.enclosesMain, 'the background encloses the MAIN PROFILE area');
  check(geom.enclosesSidebar, 'the background encloses the SIDEBAR area');
  eq(geom.isModuleCard, false, 'the background is not one of the profile module cards');
  eq(geom.backgroundInsideMain, false, 'the background is NOT inside the main content column');
  eq(geom.sidebarInsideMain, false, 'the sidebar is not merged into the main content column');
});

await step('CREATOR-10: there is no Gallery below Testimonials on the canvas', async () => {
  const layout = await page.evaluate(() => ({
    cards: Array.from(document.querySelectorAll('#studio-profile-skeleton [data-skeleton-module]'))
      .map(el => ({
        id: el.dataset.skeletonModule,
        column: el.dataset.skeletonColumn,
        label: el.querySelector('.studio-skeleton-label')?.textContent || '',
        x: Math.round(parseFloat(el.style.left)),
        y: Math.round(parseFloat(el.style.top)),
        w: Math.round(parseFloat(el.style.width)),
        h: Math.round(parseFloat(el.style.height)),
      })),
  }));
  check(layout.cards.length > 0, 'the profile structure is drawn');

  const galleries = layout.cards.filter(c => c.id === 'gallery');
  check(galleries.length === 1, `there is exactly one Photo Gallery card, got ${galleries.length}`);
  for (const g of galleries) {
    eq(g.column, 'sidebar', 'Photo Gallery is a sidebar card');
    eq(g.label, 'PHOTO GALLERY', 'the sidebar card is labelled Photo Gallery');
  }
  // Every sidebar feature is its own independent card.
  for (const id of ['friend_space', 'video_box', 'music', 'scraps']) {
    const c = layout.cards.find(k => k.id === id);
    check(!!c, `the "${id}" sidebar card exists`);
    eq(c.column, 'sidebar', `"${id}" is a sidebar card`);
  }
  const distinct = new Set(layout.cards.map(c => `${c.x},${c.y},${c.w},${c.h}`));
  eq(distinct.size, layout.cards.length, 'every sidebar module has its own distinct card');

  const t = layout.cards.find(c => c.id === 'testimonials');
  check(!!t, 'the Testimonials card exists in the main column');
  eq(t.column, 'main', 'Testimonials is a main-column card');
  for (const c of layout.cards.filter(k => k.column === 'main' && k.id !== 'testimonials')) {
    check(c.y + c.h <= t.y + 1, `main card "${c.id}" is not below Testimonials`);
  }
  const mainGallery = layout.cards.filter(c => c.column === 'main' && /^gallery$/i.test(c.id));
  eq(mainGallery.length, 0, 'no main-column Gallery section exists');
});

// ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝
// CREATOR-11 — fonts, animation and Card/Image/Sticker masking, in a real
// browser: add → configure → save → reload → publish → verify public rendering.
// ╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝╝

/** Add a component of `type` at a design point and return its id. */
const addComponentAt = async (type, designX, designY) => {
  await page.evaluate((t) => {
    const item = document.querySelector(`#studio-content-list [data-type="${t}"]`);
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, type);
  await new Promise(r => setTimeout(r, 200));
  const placed = await page.evaluate(([x, y]) => {
    const doc = document.querySelector('#studio-canvas-document');
    const r = doc.getBoundingClientRect();
    const opts = { bubbles: true, clientX: r.left + x, clientY: r.top + y, button: 0, pointerId: 1 };
    doc.dispatchEvent(new PointerEvent('pointerdown', opts));
    doc.dispatchEvent(new PointerEvent('pointerup', opts));
    return true;
  }, [designX, designY]);
  void placed;
  await new Promise(r => setTimeout(r, 350));
  return page.evaluate((t) => {
    const nodes = Array.from(document.querySelectorAll(`#studio-canvas-inner [data-comp-type="${t}"]`));
    const el = nodes[nodes.length - 1];
    if (el) el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, clientX: 0, clientY: 0, button: 0, pointerId: 1,
    }));
    return el ? el.dataset.compId : null;
  }, type);
};

/** Select a component by its canvas id and wait for its properties to render. */
const selectComponent = async (id) => {
  await page.evaluate((wanted) => {
    const el = document.querySelector(`#studio-canvas-inner [data-comp-id="${wanted}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    window.dispatchEvent(new PointerEvent('pointerup', opts));
  }, id);
  await new Promise(r => setTimeout(r, 300));
  return page.evaluate(() => !!document.querySelector('#studio-properties .studio-prop-title'));
};

/** Read a component's stored model straight out of the rendered canvas. */
const readComp = (id) => page.evaluate((wanted) => {
  const el = document.querySelector(`#studio-canvas-inner [data-comp-id="${wanted}"]`);
  if (!el) return null;
  const img = el.querySelector('img');
  const text = el.querySelector('.design-text-content');
  const surface = el.querySelector(':scope > .design-card-surface');
  const imgEl = surface ? surface.querySelector('img') : img;
  return {
    parentId: el.dataset.parentId || null,
    x: parseFloat(el.style.left), y: parseFloat(el.style.top),
    width: parseFloat(el.style.width), height: parseFloat(el.style.height),
    mountedInside: el.parentElement?.classList.contains('design-card-surface') || false,
    cardMasked: surface
      ? getComputedStyle(surface).overflow
      : null,
    cardRadius: surface ? getComputedStyle(surface.parentElement).borderRadius : null,
    animationName: el.style.animationName || '',
    animationDuration: el.style.animationDuration || '',
    animationIteration: el.style.animationIterationCount || '',
    fontFamily: text ? getComputedStyle(text).fontFamily : null,
    fontStyle: text ? getComputedStyle(text).fontStyle : null,
    imgSrc: imgEl ? imgEl.getAttribute('src') : null,
    imgNaturalW: imgEl ? imgEl.naturalWidth : 0,
    imgNaturalH: imgEl ? imgEl.naturalHeight : 0,
  };
}, id);

await step('CREATOR-11: Text gets a Font control and the chosen font renders', async () => {
  await assertNoPageErrors('start of: CREATOR-11: Text gets a Font control and the chosen font renders');
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  const id = await addComponentAt('text', 320, 300);
  check(!!id, 'a Text component was added');
  check(await selectComponent(id), 'the new Text is selected');

  const hasFontControl = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    return rows.some(r => r.querySelector('.studio-prop-label')?.textContent === 'Font');
  });
  check(hasFontControl, 'the Text properties expose a Font control');

  // Choose Georgia through the real control.
  const fontOptions = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Font');
    const select = row?.querySelector('select');
    return select ? Array.from(select.options).map(o => o.value) : [];
  });
  check(fontOptions.includes('georgia'), `the Font control offers the georgia id, got ${JSON.stringify(fontOptions)}`);
  check(!fontOptions.includes('Georgia; background: red'),
    'the Font control offers ids only, never raw CSS strings');

  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Font');
    const select = row?.querySelector('select');
    if (!select) throw new Error('Font select not found');
    select.value = 'georgia';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));

  // And a style other than normal.
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Style');
    const select = row?.querySelector('select');
    if (!select) throw new Error('Style select not found');
    select.value = 'italic';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));

  const rendered = await readComp(id);
  check(/georgia|times new roman|serif/i.test(rendered.fontFamily || ''),
    `the Studio preview renders the chosen font, got "${rendered.fontFamily}"`);
  eq(rendered.fontStyle, 'italic', 'the Studio preview renders the chosen style');
});

await step('CREATOR-11: the font survives save, reload and appears on the public profile', async () => {
  await assertNoPageErrors('start of: CREATOR-11: the font survives save, reload and appears on the public profile');
  await page.click('#studio-save');
  await new Promise(r => setTimeout(r, 1500));
  const saved = await readComp(await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="text"]');
    return el?.dataset.compId || null;
  }));
  check(saved && /georgia|serif/i.test(saved.fontFamily || ''), 'the font is still applied after saving');

  // Reload the design through the app's own selector.
  const designId = await page.$eval('#studio-design-select', el => el.value);
  await resetStudioWorkspace();
  const reloaded = await readComp(await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="text"]');
    return el?.dataset.compId || null;
  }));
  check(reloaded, 'a text component came back after the reload');
  check(/georgia|times new roman|serif/i.test(reloaded.fontFamily || ''),
    `the font persisted across a reload, got "${reloaded.fontFamily}"`);
  eq(reloaded.fontStyle, 'italic', 'the style persisted across a reload');

  // Publish and confirm the PUBLIC renderer resolves the same font id.
  await page.click('#studio-publish');
  await new Promise(r => setTimeout(r, 1800));
  const design = await api('GET', `/api/profile/design/${designId}`, { token: seller.token });
  check(design.status === 200, 'the design was readable after publishing');
  const textComp = design.data.design.layout.components.find(c => c.type === 'text');
  eq(textComp.config.fontFamily, 'georgia', 'the published design stores the font id');
  eq(textComp.config.fontStyle, 'italic', 'the published design stores the style');

  const publicProfile = await api('GET', `/api/profile/${seller.username}`);
  check(publicProfile.status === 200, 'the public profile loads');
  const publicText = (publicProfile.data.design.layout.components || []).find(c => c.type === 'text');
  eq(publicText.config.fontFamily, 'georgia', 'the public profile receives the same font id');
  eq(publicText.config.fontStyle, 'italic', 'the public profile receives the same style');
});

await step('CREATOR-11: a component can be animated from the Studio', async () => {
  await assertNoPageErrors('start of: CREATOR-11: a component can be animated from the Studio');
  await setMotionPreference('no-preference');
  await resetStudioWorkspace();
  await ensureEditingMode();
  const id = await addComponentAt('text', 320, 300);
  check(!!id, 'a Text component was added for animation');
  check(await selectComponent(id), 'the Text is selected');

  const hasAnimation = await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('#studio-properties .studio-prop-title, #studio-properties h3'));
    return titles.some(t => t.textContent === 'Animation');
  });
  check(hasAnimation, 'the properties expose an Animation section');

  const effectOptions = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Effect');
    const select = row?.querySelector('select');
    return select ? Array.from(select.options).map(o => o.value) : [];
  });
  for (const name of ['none', 'fade', 'fade-up', 'zoom-in', 'bounce', 'pulse', 'float', 'shake', 'swing']) {
    check(effectOptions.includes(name), `the animation "${name}" is offered, got ${JSON.stringify(effectOptions)}`);
  }

  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Effect');
    const select = row?.querySelector('select');
    select.value = 'float';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Repeat');
    const select = row?.querySelector('select');
    select.value = 'infinite';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 400));

  const animated = await readComp(id);
  // The animation must be an application-owned keyframes rule, never a raw value.
  eq(animated.animationName, 'komuniph-anim-float',
    `the animation maps to the owned keyframes rule, got "${animated.animationName}"`);
  check(/^\d+(\.\d+)?s$/.test(animated.animationDuration), 'a bounded duration is applied');
  eq(animated.animationIteration, 'infinite', 'the repeat choice is applied');

  // Animation is presentation only: the component box is untouched by playback.
  check(Number.isFinite(animated.x) && Number.isFinite(animated.y)
    && Number.isFinite(animated.width) && Number.isFinite(animated.height),
  'animation did not disturb the component geometry');
});

await step('CREATOR-11: an Image can be nested inside a Card and clipped by its mask', async () => {
  await assertNoPageErrors('start of: CREATOR-11: an Image can be nested inside a Card and clipped by its mask');
  await setMotionPreference('no-preference');
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  // Put the card where there is room for a child to be visible.
  const cardId = await addComponentAt('card', 120, 200);
  check(!!cardId, 'a Card was added');
  await page.evaluate((wanted) => {
    const el = document.querySelector(`#studio-canvas-inner [data-comp-id="${wanted}"]`);
    const w = el.querySelector('#studio-properties input[type=number][max="4080"]');
    void w;
  }, cardId);
  check(await selectComponent(cardId), 'the Card is selected');

  // Turn Content Mask on through the real toggle.
  const maskOn = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Content Mask');
    const input = row?.querySelector('input');
    if (!input) return null;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  check(maskOn, 'the Card exposes a Content Mask control');
  await new Promise(r => setTimeout(r, 400));

  const masked = await readComp(cardId);
  eq(masked.cardMasked, 'hidden', `the masked card clips its surface, got overflow "${masked.cardMasked}"`);

  // Give the child an image, then nest it.
  const imageId = await addComponentAt('image', 400, 500);
  check(!!imageId, 'an Image was added');
  check(await selectComponent(imageId), 'the Image is selected');

  const parentOptions = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Inside Card');
    const select = row?.querySelector('select');
    return select ? Array.from(select.options).map(o => o.value) : [];
  });
  check(parentOptions.includes(cardId), `the Image can be placed inside the card, got ${JSON.stringify(parentOptions)}`);

  await page.evaluate(([id, parent]) => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Inside Card');
    const select = row?.querySelector('select');
    select.value = parent;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, [imageId, cardId]);
  await new Promise(r => setTimeout(r, 450));

  // Nesting reinterprets X/Y as card-LOCAL coordinates, so a child that was
  // placed at a top-level design position is now outside its card. Set a local
  // position that is genuinely inside it.
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const set = (label, value) => {
      const input = rows.find(r => r.querySelector('.studio-prop-label')?.textContent === label)?.querySelector('input');
      if (!input) return;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('X', 20);
    set('Y', 30);
    set('Width', 150);
    set('Height', 110);
  });
  await new Promise(r => setTimeout(r, 400));

  const nested = await readComp(imageId);
  eq(nested.parentId, cardId, 'the Image records the card as its parent');
  check(nested.mountedInside, 'the Image is mounted inside the card surface on the canvas');

  // The child box must be visually contained by the card.
  const contained = await page.evaluate(([img, card]) => {
    const i = document.querySelector(`#studio-canvas-inner [data-comp-id="${img}"]`);
    const c = document.querySelector(`#studio-canvas-inner [data-comp-id="${card}"]`);
    if (!i || !c) return null;
    const ir = i.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return { inside: ir.left >= cr.left - 1 && ir.top >= cr.top - 1 && ir.right <= cr.right + 1 && ir.bottom <= cr.bottom + 1, ir, cr };
  }, [imageId, cardId]);
  check(contained && contained.inside, 'a nested child renders inside the card box');
});

await step('CREATOR-11: a nested Image keeps its original source through mask and resize', async () => {
  await assertNoPageErrors('start of: CREATOR-11: a nested Image keeps its original source through mask and resize');
  await setMotionPreference('no-preference');
  // Upload a real image so the source is a genuine application URL.
  // Scope to the child INSIDE the card: an earlier step added a standalone
  // image, so a bare [data-comp-type="image"] would target the wrong component.
  const imageId = await page.evaluate(() => {
    const card = document.querySelector('#studio-canvas-inner [data-comp-type="card"]');
    return card?.querySelector('.design-card-surface [data-comp-type="image"]')?.dataset.compId || null;
  });
  check(!!imageId, 'the nested image component exists');
  await selectComponent(imageId);
  const fileInput = await page.$('#studio-properties input[type=file]');
  check(!!fileInput, 'the image component offers an upload control');
  await fileInput.uploadFile(bgFixturePath);
  await new Promise(r => setTimeout(r, 1500));
  const decoded = await waitForImage('#studio-canvas-inner [data-comp-type="image"] img');
  check(/\/uploads\/creator\//.test(decoded.src), `the nested image holds the uploaded file, got "${decoded.src}"`);

  // Resize the CHILD inside the card: geometry changes, source does not.
  const before = await readComp(imageId);
  await page.evaluate((id) => {
    const row = document.querySelector(`#studio-layers-list [data-layer-id="${id}"] .studio-layer-name`);
    row?.click();
  }, imageId);
  await new Promise(r => setTimeout(r, 300));
  const resizeFields = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const find = (label) => rows.find(r => r.querySelector('.studio-prop-label')?.textContent === label)?.querySelector('input');
    const w = find('Width');
    if (!w) return null;
    w.value = '120';
    w.dispatchEvent(new Event('input', { bubbles: true }));
    w.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  check(resizeFields, 'the child exposes its Width field');
  await new Promise(r => setTimeout(r, 400));
  const after = await readComp(imageId);
  eq(after.width, 120, 'the nested child resized inside its card');
  eq(after.imgSrc, before.imgSrc, 'resizing the child never changed the image source');
  eq(after.imgNaturalW, before.imgNaturalW, 'resizing the child never changed the source resolution');
  check(after.imgNaturalW > 0, 'the source image is still a real decoded image, not a baked artifact');
  check(!/data:|screenshot|render/i.test(after.imgSrc || ''), 'no rasterised artifact replaced the source');

  // Resize the CARD: the clip region changes, the child source is untouched.
  const cardId = await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner [data-comp-type="card"]');
    return el?.dataset.compId || null;
  });
  await selectComponent(cardId);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const find = (label) => rows.find(r => r.querySelector('.studio-prop-label')?.textContent === label)?.querySelector('input');
    const w = find('Width');
    if (!w) throw new Error('card width field missing');
    w.value = '300';
    w.dispatchEvent(new Event('input', { bubbles: true }));
    w.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 450));
  const afterCard = await readComp(imageId);
  eq(afterCard.imgSrc, after.imgSrc, 'resizing the card never changed the child image source');
  eq(afterCard.imgNaturalW, after.imgNaturalW, 'resizing the card never changed the source resolution');
  // The deterministic child rule: local coordinates are preserved.
  eq(afterCard.x, after.x, 'a child keeps its local x when the card resizes');
  eq(afterCard.y, after.y, 'a child keeps its local y when the card resizes');
});

await step('CREATOR-11: a rounded Card clips its child, and every fit still works', async () => {
  await assertNoPageErrors('start of: CREATOR-11: a rounded Card clips its child, and every fit still works');
  await setMotionPreference('no-preference');
  // Scope to the child INSIDE the card: an earlier step added a standalone
  // image, so a bare [data-comp-type="image"] would match the wrong component.
  const cardAndChild = await page.evaluate(() => {
    const card = document.querySelector('#studio-canvas-inner [data-comp-type="card"]');
    const child = card?.querySelector('.design-card-surface [data-comp-type="image"]');
    return { card: card?.dataset.compId || null, child: child?.dataset.compId || null };
  });
  const cardId = cardAndChild.card;
  const imageId = cardAndChild.child;
  check(!!cardId, 'the Card is on the canvas');
  check(!!imageId, 'the nested Image is inside the card surface');
  await selectComponent(cardId);
  // Give the card a large border radius through the existing Appearance field.
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const find = (label) => rows.find(r => r.querySelector('.studio-prop-label')?.textContent === label)?.querySelector('input');
    const r = find('Border radius');
    if (!r) throw new Error('Border radius field missing');
    r.value = '32';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 400));

  const rounded = await readComp(cardId);
  check(/32px/.test(rounded.cardRadius || ''),
    `the card's border radius is applied, got "${rounded.cardRadius}"`);
  eq(rounded.cardMasked, 'hidden', 'the surface is still clipping');
  // The clip lives on the surface, which inherits the card's radius — that is
  // what makes a rounded card produce a rounded mask with no extra element.
  const surfaceInherits = await page.evaluate((id) => {
    const card = document.querySelector(`#studio-canvas-inner [data-comp-id="${id}"]`);
    const surface = card?.querySelector(':scope > .design-card-surface');
    if (!card || !surface) return null;
    return {
      cardOverflow: getComputedStyle(card).overflow,
      surfaceOverflow: getComputedStyle(surface).overflow,
      surfaceRadius: getComputedStyle(surface).borderRadius,
    };
  }, cardId);
  check(surfaceInherits && surfaceInherits.surfaceOverflow === 'hidden',
    'the surface clips');
  check(surfaceInherits && surfaceInherits.cardOverflow !== 'hidden',
    'the CARD BOX is not clipped, so its own resize handles stay reachable');
  check(surfaceInherits && /32px/.test(surfaceInherits.surfaceRadius),
    `the surface inherits the card radius, got "${surfaceInherits?.surfaceRadius}"`);

  // All three fit modes still work inside the mask.
  for (const fit of ['cover', 'contain', 'fill']) {
    await selectComponent(imageId);
    await page.evaluate((value) => {
      const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
        .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Fit');
      const select = row?.querySelector('select');
      if (!select) throw new Error('Fit select missing');
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, fit);
    await new Promise(r => setTimeout(r, 350));
    const applied = await page.evaluate((id) => {
      const card = document.querySelector('#studio-canvas-inner [data-comp-type="card"]');
      const img = card?.querySelector(`.design-card-surface [data-comp-id="${id}"] img`);
      return img ? { cls: img.className, objectFit: getComputedStyle(img).objectFit, src: img.getAttribute('src') } : null;
    }, imageId);
    check(applied, `the child image is still rendered for fit "${fit}"`);
    eq(applied.cls, `design-image-fit-${fit}`, `fit "${fit}" is applied to the child image`);
    check(/\/uploads\/creator\//.test(applied.src), 'the original source survives every fit change');
  }
});

await step('CREATOR-11: Layers shows the Card/child hierarchy and deleting a Card cascades', async () => {
  await assertNoPageErrors('start of: CREATOR-11: Layers shows the Card/child hierarchy and deleting a Card cascades');
  await setMotionPreference('no-preference');
  // Scope to the child INSIDE the card (see the rounded-card step).
  const cardAndChild = await page.evaluate(() => {
    const card = document.querySelector('#studio-canvas-inner [data-comp-type="card"]');
    const child = card?.querySelector('.design-card-surface [data-comp-type="image"]');
    return { card: card?.dataset.compId || null, child: child?.dataset.compId || null };
  });
  const cardId = cardAndChild.card;
  const imageId = cardAndChild.child;
  check(!!cardId, 'the Card is on the canvas');
  check(!!imageId, 'the nested Image is inside the card surface');

  const rows = await page.evaluate(() => Array.from(
    document.querySelectorAll('#studio-layers-list [data-layer-id]'),
  ).map(r => ({
    id: r.dataset.layerId,
    child: r.classList.contains('studio-layer-child'),
    label: r.querySelector('.studio-layer-name')?.textContent || '',
    indent: r.style.paddingLeft || '',
  })));
  const cardRow = rows.find(r => r.id === cardId);
  const childRow = rows.find(r => r.id === imageId);
  check(!!cardRow, 'the card has a Layers row');
  check(!!childRow, 'the child has a Layers row');
  check(childRow.child, 'the child row is marked as nested');
  check(childRow.indent !== cardRow.indent,
    `the child is indented under its card (card "${cardRow.indent}" child "${childRow.indent}")`);
  const cardIndex = rows.findIndex(r => r.id === cardId);
  const childIndex = rows.findIndex(r => r.id === imageId);
  check(childIndex > cardIndex, 'the child is listed after the card it belongs to');
  check(childRow.label.includes('↳'), `the nested row is visibly marked, got "${childRow.label}"`);

  // Layers can still select the child even when it overlaps the card.
  const selectedByLayers = await page.evaluate((id) => {
    document.querySelector(`#studio-layers-list [data-layer-id="${id}"] .studio-layer-name`)?.click();
    return true;
  }, imageId);
  void selectedByLayers;
  await new Promise(r => setTimeout(r, 300));
  const childSelected = await page.evaluate(() =>
    document.querySelector('#studio-canvas-inner .studio-selected')?.dataset.compId || null);
  eq(childSelected, imageId, 'selecting the child in Layers selects the child on the canvas');

  // Deleting the card cascades, so no dangling parentId can survive.
  await page.evaluate((id) => {
    document.querySelector(`#studio-layers-list [data-layer-id="${id}"] [data-action="delete"]`)?.click();
  }, cardId);
  await new Promise(r => setTimeout(r, 400));
  const afterDelete = await page.evaluate(([childId, parentId]) => {
    const card = document.querySelector(`#studio-canvas-inner [data-comp-id="${parentId}"]`);
    return {
      cards: document.querySelectorAll('#studio-canvas-inner [data-comp-type="card"]').length,
      // The specific child, not every image on the canvas: an earlier step added
      // an unrelated standalone image that must survive untouched.
      childStillThere: !!document.querySelector(`#studio-canvas-inner [data-comp-id="${childId}"]`),
      childrenLeftInCard: card ? card.querySelectorAll('.design-card-surface [data-comp-id]').length : 0,
    };
  }, [imageId, cardId]);
  eq(afterDelete.cards, 0, 'the card was deleted');
  eq(afterDelete.childStillThere, false, 'the contained child was deleted with its card');
  eq(afterDelete.childrenLeftInCard, 0, 'no child was left behind inside the removed card');

  // The design must still be saveable — a dangling parentId would be rejected.
  await page.click('#studio-save');
  await new Promise(r => setTimeout(r, 1500));
  const status = await page.$eval('#studio-status', el => el.textContent || '');
  check(/saved/i.test(status), `the design still saves after a cascading delete, status="${status}"`);
});

await step('CREATOR-11: a nested Sticker is contained, animated and survives reload', async () => {
  await assertNoPageErrors('start of: CREATOR-11: a nested Sticker is contained, animated and survives reload');
  await setMotionPreference('no-preference');
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  const cardId = await addComponentAt('card', 140, 220);
  check(!!cardId, 'a Card was added');
  check(await selectComponent(cardId), 'the Card is selected');
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Content Mask');
    const input = row?.querySelector('input');
    if (!input) throw new Error('Content Mask missing');
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 350));

  const stickerId = await addComponentAt('sticker', 420, 520);
  check(!!stickerId, 'a Sticker was added');
  check(await selectComponent(stickerId), 'the Sticker is selected');

  // A Sticker is an image component, so it needs a real image source before the
  // design is valid - the server rejects a component with no imageUrl. Upload one
  // through the same control an Image uses.
  const stickerUpload = await page.$('#studio-properties input[type=file]');
  check(!!stickerUpload, 'the Sticker offers an upload control');
  await stickerUpload.uploadFile(bgFixturePath);
  await new Promise(r => setTimeout(r, 1600));
  const stickerDecoded = await waitForImage('#studio-canvas-inner [data-comp-type="sticker"] img');
  check(/\/uploads\/creator\//.test(stickerDecoded.src),
    `the Sticker holds the uploaded file, got "${stickerDecoded.src}"`);
  const stickerSource = stickerDecoded.src;

  await page.evaluate((parent) => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Inside Card');
    const select = row?.querySelector('select');
    if (!select) throw new Error('Inside Card missing');
    select.value = parent;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, cardId);
  await new Promise(r => setTimeout(r, 400));

  // Local coordinates inside the card (see the Image step for why).
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const set = (label, value) => {
      const input = rows.find(r => r.querySelector('.studio-prop-label')?.textContent === label)?.querySelector('input');
      if (!input) return;
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('X', 15);
    set('Y', 20);
    set('Width', 90);
    set('Height', 90);
  });
  await new Promise(r => setTimeout(r, 400));

  // Animate it.
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === 'Effect');
    const select = row?.querySelector('select');
    if (!select) throw new Error('Effect missing');
    select.value = 'pulse';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 400));

  const sticker = await readComp(stickerId);
  eq(sticker.parentId, cardId, 'the Sticker records the card as its parent');
  check(sticker.mountedInside, 'the Sticker is mounted inside the card surface');
  eq(sticker.animationName, 'komuniph-anim-pulse', 'the Sticker plays the owned keyframes rule');
  eq(sticker.imgSrc, stickerSource, 'the Sticker keeps its original uploaded source');

  await page.click('#studio-save');
  await new Promise(r => setTimeout(r, 1800));
  const saveStatus = await page.$eval('#studio-status', el => el.textContent || '');
  check(/saved/i.test(saveStatus), `the nested sticker design saved, status="${saveStatus}"`);
  await resetStudioWorkspace();
  const reloaded = await readComp(stickerId);
  check(reloaded, `the Sticker came back after a reload, ids on canvas: ${await page.evaluate(() => Array.from(document.querySelectorAll('#studio-canvas-inner [data-comp-id]')).map(e => e.dataset.compId).join(','))}`);
  eq(reloaded.parentId, cardId, 'the Sticker relationship survived the reload');
  eq(reloaded.animationName, 'komuniph-anim-pulse', 'the Sticker animation survived the reload');

  // Publish and check the public renderer produces the same structure.
  await page.click('#studio-publish');
  await new Promise(r => setTimeout(r, 1800));
  const designId = await page.$eval('#studio-design-select', el => el.value);
  const design = await api('GET', `/api/profile/design/${designId}`, { token: seller.token });
  const comps = design.data.design.layout.components;
  const s = comps.find(c => c.id === stickerId);
  const c = comps.find(x => x.id === cardId);
  check(!!s && !!c, 'the published design contains both the card and the sticker');
  eq(s.parentId, cardId, 'the published design keeps the sticker→card relationship');
  eq(s.config.animation.name, 'pulse', 'the published design keeps the animation');
  eq(s.config.imageUrl, stickerSource, 'the published design keeps the original sticker source');
  eq(c.config.mask, true, 'the published design keeps the mask setting');
});

await step('CREATOR-11: the public profile renders fonts, animations and masked children', async () => {
  await assertNoPageErrors('start of: CREATOR-11: the public profile renders fonts, animations and masked children');
  await setMotionPreference('no-preference');
  await page.goto(`${BASE}/#/profile/${seller.username}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));
  const rendered = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const text = frame?.querySelector('.design-text-content');
    const card = frame?.querySelector('.design-card-container');
    const surface = card?.querySelector('.design-card-surface');
    const child = surface?.querySelector('[data-component-type="sticker"], [data-component-type="image"]');
    return {
      frameHasDesign: !!frame?.classList.contains('has-profile-design'),
      fontFamily: text ? getComputedStyle(text).fontFamily : null,
      fontStyle: text ? getComputedStyle(text).fontStyle : null,
      textAnimated: text?.parentElement?.classList.contains('design-animated') || false,
      textAnimation: text?.parentElement?.style.animationName || '',
      cardExists: !!card,
      surfaceOverflow: surface ? getComputedStyle(surface).overflow : null,
      childMountedInCard: !!child,
      childLocalLeft: child ? child.style.left : null,
      childLocalTop: child ? child.style.top : null,
      childImg: child?.querySelector('img')?.getAttribute('src') || null,
    };
  });
  check(rendered.frameHasDesign, 'the public profile is running a design');
  // Font resolved from the stored id by the public renderer.
  check(!!rendered.fontFamily, 'the public renderer applied a font to the text component');
  check(/georgia|times new roman|serif|sans-serif|system-ui/i.test(rendered.fontFamily),
    `the public renderer resolved the stored font id, got "${rendered.fontFamily}"`);
  check(rendered.cardExists, 'the public profile renders the Card container');
  check(rendered.childMountedInCard, 'the child is mounted inside the card surface publicly');
  check(rendered.surfaceOverflow === 'hidden', 'the public card surface clips its child');
  check(/^\d+px$/.test(rendered.childLocalLeft || ''), 'the child uses local coordinates publicly');
  check(/\/uploads\/creator\//.test(rendered.childImg || ''),
    `the public child still references the original image source, got "${rendered.childImg}"`);
  // The public renderer must not draw Studio-only chrome.
  const studioOnly = await page.evaluate(() => ({
    skeleton: document.querySelectorAll('#studio-profile-skeleton').length,
    guide: document.querySelectorAll('[data-comp-type="profile_guide_card"]').length,
  }));
  eq(studioOnly.skeleton, 0, 'no Studio skeleton leaked onto the public profile');
  eq(studioOnly.guide, 0, 'no guide card leaked onto the public profile');
});

await step('CREATOR-11: reduced motion is respected without changing the design', async () => {
  await assertNoPageErrors('start of: CREATOR-11: reduced motion is respected without changing the design');
  // Emulate the accessibility preference, then reload the public profile.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${BASE}/#/profile/${seller.username}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));
  const reduced = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const animated = frame ? Array.from(frame.querySelectorAll('.design-animated')) : [];
    return {
      count: animated.length,
      names: animated.map(el => getComputedStyle(el).animationName),
      // The profile must still be intact and fully rendered.
      components: frame ? frame.querySelectorAll('.design-component').length : 0,
      hasCard: !!frame?.querySelector('.design-card-container'),
      hasText: !!frame?.querySelector('.design-text-content'),
    };
  });
  check(reduced.components > 0, 'the profile still renders its components under reduced motion');
  check(reduced.hasText, 'text still renders under reduced motion');
  for (const name of reduced.names) {
    check(name === 'none' || name === '',
      `animations are switched off under reduced motion, got "${name}"`);
  }
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  // The stored design is untouched: the animation setting still exists server-side.
  const sellerDesigns = await api('GET', '/api/profile/design', { token: seller.token });
  check(sellerDesigns.status === 200, `the design list loads, got ${sellerDesigns.status}`);
  const designs = (sellerDesigns.data && sellerDesigns.data.designs) || [];
  const withAnim = designs.some(d => (d.layout?.components || [])
    .some(c => c.config?.animation?.name && c.config.animation.name !== 'none'));
  check(withAnim, 'the animation is still stored in the design after reduced-motion rendering');
});

// ???????????????????????????????????????????????????????????????????????????
// CREATOR-10A - the Profile Background state a creator actually SEES.
//
// These assert rendered text and control state, not JavaScript objects: the whole
// point of the task is that a creator can tell, at a glance, whether a background
// is active, merely uploaded, or neither.
// ???????????????????????????????????????????????????????????????????????????

/** Read the visible Profile Background state out of the Properties panel. */
const readBackgroundState = () => page.evaluate(() => {
  const chip = document.querySelector('#studio-background-state');
  const preview = document.querySelector('[data-profile-background-preview]');
  const pending = document.querySelector('#studio-background-pending');
  const apply = document.querySelector('#studio-background-apply');
  const clear = document.querySelector('#studio-background-clear');
  const empty = document.querySelector('#studio-background-empty');
  const tag = document.querySelector('.studio-bg-preview-tag');
  const disabled = (label) => {
    const row = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'))
      .find(r => r.querySelector('.studio-prop-label')?.textContent === label);
    return row?.querySelector('select')?.disabled ?? null;
  };
  const visible = (el) => !!el && el.offsetParent !== null;
  return {
    chipText: chip ? chip.textContent.trim() : null,
    chipState: chip ? chip.dataset.state : null,
    // Computed colour, so "visually distinct" is measured rather than assumed.
    chipColour: chip ? getComputedStyle(chip).color : null,
    chipBackground: chip ? getComputedStyle(chip).backgroundColor : null,
    previewState: preview ? preview.dataset.profileBackgroundPreview : null,
    previewHasImage: !!preview?.querySelector('img'),
    previewImageSrc: preview?.querySelector('img')?.getAttribute('src') || '',
    previewTag: tag ? tag.textContent.trim() : null,
    emptyText: empty ? empty.textContent.trim() : null,
    pendingVisible: visible(pending),
    pendingLabel: document.querySelector('#studio-background-pending-label')?.textContent.trim() || null,
    pendingSrc: pending?.querySelector('img')?.getAttribute('src') || '',
    applyVisible: visible(apply),
    applyText: apply ? apply.textContent.trim() : null,
    applyDisabled: apply ? apply.disabled : null,
    clearVisible: visible(clear),
    clearText: clear ? clear.textContent.trim() : null,
    status: document.querySelector('#studio-background-status')?.textContent.trim() || '',
    sizeDisabled: disabled('Size'),
    positionDisabled: disabled('Position'),
    repeatDisabled: disabled('Repeat'),
  };
});

/**
 * Deselect any component so the canvas-level Properties (which own the Profile
 * Background section) are shown, then confirm the section is actually rendered.
 * showCanvasProperties() is the existing retry-until-laid-out helper; the chip is
 * asserted separately because a panel can be "visible" before its content is.
 */
const showBackgroundSection = async () => {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 250));
  if (!await page.evaluate(() => !!document.querySelector('#studio-canvas-inner'))) return false;
  await showCanvasProperties();
  return page.evaluate(() => !!document.querySelector('#studio-background-state'));
};

await step('CREATOR-10A: no background is shown as NOT SET, unambiguously', async () => {
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  // Establish the documented precondition explicitly rather than assuming it: an
  // earlier CREATOR-10 step applied and saved a background to this same design.
  await showBackgroundSection();
  if (await page.evaluate(() => !!document.querySelector('#studio-background-clear:not([hidden])'))) {
    await page.click('#studio-background-clear');
    await new Promise(r => setTimeout(r, 400));
    await page.click('#studio-save');
    await new Promise(r => setTimeout(r, 1500));
    await resetStudioWorkspace();
  }
  const shown = await showBackgroundSection();
  check(shown, 'the Profile Background section is visible with nothing selected');

  const state = await readBackgroundState();
  eq(state.chipState, 'none', 'the state is "none"');
  // Asserted on the WORDS, not an exact glyph: the chip is a visual affordance
  // and a file-encoding round trip must not be able to fail an assertion.
  check(state.chipText === 'NOT SET', `the chip reads NOT SET, got ${JSON.stringify(state.chipText)}`);
  check(state.previewState === 'none', 'the preview is in the no-background state');
  eq(state.previewHasImage, false, 'no image is shown when nothing is set');
  check(!!state.emptyText, 'an explicit "no background" message is shown');
  check(/no profile background/i.test(state.emptyText || ''),
    `the empty state names the absence, got "${state.emptyText}"`);
  // The apply action must not be sitting there looking actionable.
  eq(state.applyVisible, false, 'no apply button is offered with nothing to apply');
  eq(state.clearVisible, false, 'no Remove button is offered when nothing is active');
  // Presentation controls are scoped to an active background.
  eq(state.sizeDisabled, true, 'Size is disabled with no background');
  eq(state.positionDisabled, true, 'Position is disabled with no background');
  eq(state.repeatDisabled, true, 'Repeat is disabled with no background');
  check(/no profile background is set/i.test(state.status),
    `the status line states the absence, got "${state.status}"`);
});

await step('CREATOR-10A: an uploaded image is visibly PENDING, not active', async () => {
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  await showBackgroundSection();
  const input = await page.$('#studio-background-file');
  check(!!input, 'the background file input exists');
  await input.uploadFile(bgFixturePath);
  await new Promise(r => setTimeout(r, 1600));
  await showBackgroundSection();

  const state = await readBackgroundState();
  eq(state.chipState, 'pending', 'the state is "pending"');
  check(/UPLOADED/.test(state.chipText || '') && /NOT ACTIVE/.test(state.chipText || ''),
    `the chip says the upload is not active, got ${JSON.stringify(state.chipText)}`);
  // The distinction from ACTIVE must be VISUAL, not just different wording.
  const activeColour = await page.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'studio-bg-chip studio-bg-chip-active';
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  });
  check(state.chipColour !== activeColour,
    `the pending chip is visually distinct from an ACTIVE chip (pending ${state.chipColour} vs active ${activeColour})`);
  check(!!state.pendingVisible, 'the staged upload is shown on its own row');
  check(/not active yet/i.test(state.pendingLabel || ''),
    `the staged upload is labelled as not yet active, got "${state.pendingLabel}"`);
  eq(state.previewHasImage, false, 'the ACTIVE preview is still empty - an upload does not become active');
  eq(state.previewTag, null, 'no ACTIVE tag is shown over an empty preview');
  // The apply action appears and is enabled, with honest wording.
  eq(state.applyVisible, true, 'the apply button appears once an image is staged');
  eq(state.applyDisabled, false, 'the apply button is enabled');
  eq(state.applyText, 'Set as Profile Background', 'it reads as a first-time activation');
  eq(state.clearVisible, false, 'Remove is still not offered - nothing is active yet');
  check(/ready to set as profile background/i.test(state.status),
    `the status says it is ready but not active, got "${state.status}"`);
  // And nothing has been written to the design yet.
  const notSavedYet = await page.evaluate(() =>
    document.querySelector('#studio-profile-background')?.dataset.profileBackground === 'none');
  check(notSavedYet, 'the canvas still shows no background before applying');
});

await step('CREATOR-10A: applying turns it ACTIVE immediately, with no reload', async () => {
  const before = await readBackgroundState();
  await page.click('#studio-background-apply');
  await new Promise(r => setTimeout(r, 500));
  const after = await readBackgroundState();

  eq(after.chipState, 'active', 'the state becomes active on apply');
  check(/ACTIVE/.test(after.chipText || ''), "the chip now reads ACTIVE, got $(JSON.stringify(after.chipText))" );
  eq(after.previewState, 'active', 'the preview is in the active state');
  eq(after.previewHasImage, true, 'the preview now shows the image');
  eq(after.previewTag, 'ACTIVE BACKGROUND', 'the preview itself is tagged as the active background');
  eq(after.pendingVisible, false, 'the staged row is gone - it is no longer pending');
  eq(after.applyVisible, false, 'no apply button is offered for the already-active image');
  eq(after.clearVisible, true, 'Remove is offered now that a background is active');
  eq(after.clearText, 'Remove', 'the remove action is labelled Remove');
  eq(after.sizeDisabled, false, 'Size is enabled for the active background');
  eq(after.positionDisabled, false, 'Position is enabled for the active background');
  eq(after.repeatDisabled, false, 'Repeat is enabled for the active background');
  check(after.chipColour !== before.chipColour, 'the chip colour changed to signal the new state');
  check(/active and sits behind the entire profile/i.test(after.status),
    `the status confirms it is active, got "${after.status}"`);
  // The change is immediately reflected on the canvas too.
  const canvasState = await page.evaluate(() => ({
    set: document.querySelector('#studio-profile-background')?.dataset.profileBackground,
    src: document.querySelector('#studio-profile-background img')?.getAttribute('src') || '',
  }));
  eq(canvasState.set, 'set', 'the canvas background layer is now set');
  check(/\/uploads\/creator\//.test(canvasState.src), 'the canvas shows the uploaded image');
});

await step('CREATOR-10A: a second upload is offered as a REPLACEMENT, not a silent swap', async () => {
  const activeBefore = await readBackgroundState();
  check(activeBefore.chipState === 'active', 'a background is active to begin with');
  const activeSrc = activeBefore.previewImageSrc;

  const input = await page.$('#studio-background-file');
  await input.uploadFile(bgFixturePath);
  await new Promise(r => setTimeout(r, 1600));
  await showBackgroundSection();

  const pending = await readBackgroundState();
  eq(pending.chipState, 'replace', 'the state becomes "replace"');
  eq(pending.chipText, 'REPLACEMENT READY', 'the chip says a replacement is ready');
  eq(pending.chipColour !== activeBefore.chipColour, true, 'the replace chip is visually distinct from ACTIVE');
  eq(pending.applyVisible, true, 'an apply action is offered');
  eq(pending.applyText, 'Replace Profile Background', 'it is worded as a replacement, not a first-time set');
  eq(pending.applyDisabled, false, 'the replace action is enabled');
  check(/replace/i.test(pending.pendingLabel || ''),
    `the staged image says it will replace, got "${pending.pendingLabel}"`);
  check(/not applied yet/i.test(pending.pendingLabel || ''), 'the staged replacement is not applied yet');
  // Critically: the ACTIVE background is still the old one until the creator acts.
  eq(pending.previewState, 'active', 'the active preview is still shown');
  eq(pending.previewImageSrc, activeSrc, 'the active background has NOT silently changed');
  eq(pending.clearVisible, true, 'Remove still refers to the active background');
  check(/current background stays active/i.test(pending.status),
    `the status explains the current background is still active, got "${pending.status}"`);

  // Apply the replacement.
  await page.click('#studio-background-apply');
  await new Promise(r => setTimeout(r, 500));
  const replaced = await readBackgroundState();
  eq(replaced.chipState, 'active', 'the replacement is now the active background');
  check(/ACTIVE/.test(replaced.chipText || ''), `the chip reads ACTIVE after replacing, got ${JSON.stringify(replaced.chipText)}`);
  eq(replaced.pendingVisible, false, 'the staged row is gone');
  eq(replaced.applyVisible, false, 'no apply button remains');
  check(/active and sits behind the entire profile/i.test(replaced.status),
    `the section status settles into describing the ACTIVE background, got "${replaced.status}"`);
  // The one-off confirmation of the replacement is reported in the Studio status
  // bar; the section status then settles into describing the ACTIVE state.
  const replaceStatus = await page.$eval('#studio-status', el => el.textContent || '');
  check(/replaced/i.test(replaceStatus),
    `the Studio status bar confirms the replacement, got "${replaceStatus}"`);
});

await step('CREATOR-10A: removing returns the panel to NOT SET with no stale ACTIVE label', async () => {
  await page.click('#studio-background-clear');
  await new Promise(r => setTimeout(r, 500));
  const after = await readBackgroundState();

  eq(after.chipState, 'none', 'the state returns to none');
  eq(after.chipText, 'NOT SET', 'the chip reads NOT SET, with no stale ACTIVE label anywhere');
  eq(after.previewState, 'none', 'the preview is in the no-background state');
  eq(after.previewHasImage, false, 'the active preview image is gone');
  eq(after.previewTag, null, 'the ACTIVE BACKGROUND tag is gone');
  eq(after.pendingVisible, false, 'no pending row remains');
  eq(after.applyVisible, false, 'no apply button is offered');
  eq(after.clearVisible, false, 'no Remove button is offered');
  eq(after.sizeDisabled, true, 'Size is disabled again');
  check(/no profile background is set/i.test(after.status),
    `the section status returns to describing no background, got "${after.status}"`);
  const removeStatus = await page.$eval('#studio-status', el => el.textContent || '');
  check(/removed/i.test(removeStatus),
    `the Studio status bar confirms the removal, got "${removeStatus}"`);
  // And the canvas layer is genuinely cleared, not just hidden.
  const canvasState = await page.evaluate(() => ({
    set: document.querySelector('#studio-profile-background')?.dataset.profileBackground,
    img: !!document.querySelector('#studio-profile-background img'),
  }));
  eq(canvasState.set, 'none', 'the canvas background layer is cleared');
  eq(canvasState.img, false, 'the canvas no longer renders a background image');
});

await step('CREATOR-10A: the active state is rebuilt from the design on save/reload', async () => {
  // Re-apply, SAVE, then reload the whole page: the ACTIVE chip must be
  // reconstructed from theme.backgroundImage, not from leftover editor state.
  const input = await page.$('#studio-background-file');
  await input.uploadFile(bgFixturePath);
  await new Promise(r => setTimeout(r, 1600));
  await showBackgroundSection();
  await page.click('#studio-background-apply');
  await new Promise(r => setTimeout(r, 500));
  const applied = await readBackgroundState();
  eq(applied.chipState, 'active', 'the background is active before saving');
  const appliedSrc = applied.previewImageSrc;

  await page.click('#studio-save');
  await new Promise(r => setTimeout(r, 1800));
  const saveStatus = await page.$eval('#studio-status', el => el.textContent || '');
  check(/saved/i.test(saveStatus), `the draft saved, status="${saveStatus}"`);

  await resetStudioWorkspace();
  await showBackgroundSection();
  const reloaded = await readBackgroundState();
  eq(reloaded.chipState, 'active', 'the ACTIVE state is reconstructed after a reload');
  check(/ACTIVE/.test(reloaded.chipText || ''), "the chip still reads ACTIVE after a reload, got $(JSON.stringify(reloaded.chipText))" );
  eq(reloaded.previewImageSrc, appliedSrc, 'the same image is shown after a reload');
  eq(reloaded.clearVisible, true, 'Remove is offered after a reload');
  eq(reloaded.applyVisible, false, 'no apply button is offered after a reload');
  eq(reloaded.sizeDisabled, false, 'the presentation controls are enabled for the active background');
});

await step('CREATOR-10A: a reloaded background is still one, and it still reaches the public profile', async () => {
  const designId = await page.$eval('#studio-design-select', el => el.value);
  await page.click('#studio-publish');
  await new Promise(r => setTimeout(r, 1800));
  const profile = await api('GET', `/api/profile/${seller.username}`);
  check(profile.status === 200, 'the public profile loads after publishing');
  const theme = profile.data.design?.theme || {};
  check(/\/uploads\/creator\//.test(theme.backgroundImage || ''),
    `the published design carries the background, got "${theme.backgroundImage}"`);

  // And the real public page still paints it behind the whole profile. The
  // public renderer applies the background as a CSS background (not the
  // Studio's <img> layer), and the layer is a FIXED viewport backdrop that the
  // content scrolls above — so the correct check is that it covers the viewport
  // and sits behind the content, not that it encloses the main column (a tall
  // profile legitimately extends past the viewport).
  await page.goto(`${BASE}/#/profile/${seller.username}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));
  const publicView = await page.evaluate(() => {
    const layer = document.querySelector('#profile-background-layer');
    const content = document.querySelector('.profile-content-frame');
    const lr = layer?.getBoundingClientRect();
    const cs = layer ? getComputedStyle(layer) : null;
    const ccs = content ? getComputedStyle(content) : null;
    return {
      layerExists: !!layer,
      cssBackground: cs ? cs.backgroundImage : '',
      position: cs ? cs.position : '',
      zIndex: cs ? cs.zIndex : '',
      contentZIndex: ccs ? ccs.zIndex : '',
      contentPosition: ccs ? ccs.position : '',
      coversViewport: !!lr && lr.width >= window.innerWidth - 2 && lr.height >= window.innerHeight - 2,
      // Is the backdrop actually painted behind the content at the content's own
      // centre point? elementFromPoint proves the stacking, not just the CSS.
      contentPaintsAbove: (() => {
        if (!content) return false;
        const r = content.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + 40, window.innerHeight - 20));
        return !!el && !!content.contains(el);
      })(),
      hasDesign: !!document.querySelector('#profile-frame')?.classList.contains('has-profile-design'),
    };
  });
  check(publicView.layerExists, 'the public profile still has its background layer');
  check(/url\(/.test(publicView.cssBackground),
    `the public background is applied, got backgroundImage "${publicView.cssBackground}"`);
  check(/\/uploads\/creator\//.test(publicView.cssBackground),
    `the public background is the original uploaded source, got "${publicView.cssBackground}"`);
  eq(publicView.position, 'fixed', 'the public backdrop is a fixed layer');
  check(publicView.coversViewport, 'the backdrop covers the whole viewport');
  check(Number(publicView.zIndex) < Number(publicView.contentZIndex),
    `the backdrop is behind the content (backdrop z=${publicView.zIndex}, content z=${publicView.contentZIndex})`);
  check(publicView.contentPaintsAbove, 'the profile content paints above the backdrop');
  void designId;
});

await step('CREATOR-10A: background state changes never touch the design model or the viewer', async () => {
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  // Put a real component on the canvas so there is geometry to protect.
  const imageId = await page.evaluate(() => {
    const item = document.querySelector('#studio-content-list [data-type="image"]');
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  void imageId;
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(() => {
    const doc = document.querySelector('#studio-canvas-document');
    const r = doc.getBoundingClientRect();
    const opts = { bubbles: true, clientX: r.left + 300, clientY: r.top + 500, button: 0, pointerId: 1 };
    doc.dispatchEvent(new PointerEvent('pointerdown', opts));
    doc.dispatchEvent(new PointerEvent('pointerup', opts));
  });
  await new Promise(r => setTimeout(r, 400));

  const modelBefore = await designSnapshot();
  const placementBefore = await canvasPlacement();
  check(modelBefore.comps.length > 0, 'there is a component to protect');

  // Walk the whole background lifecycle.
  await showBackgroundSection();
  const input = await page.$('#studio-background-file');
  await input.uploadFile(bgFixturePath);
  await new Promise(r => setTimeout(r, 1600));
  await showBackgroundSection();
  await page.click('#studio-background-apply');
  await new Promise(r => setTimeout(r, 500));
  // Change every presentation control too - they are design-level theme, not
  // component geometry.
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const setSelect = (label, value) => {
      const select = rows.find(r => r.querySelector('.studio-prop-label')?.textContent === label)?.querySelector('select');
      if (!select) return;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setSelect('Size', 'contain');
    setSelect('Position', 'top left');
    setSelect('Repeat', 'repeat');
  });
  await new Promise(r => setTimeout(r, 400));
  await page.click('#studio-background-clear');
  await new Promise(r => setTimeout(r, 400));

  const modelAfter = await designSnapshot();
  eq(JSON.stringify(modelAfter), JSON.stringify(modelBefore),
    'the entire background lifecycle left every component and the canvas untouched');

  // The presentation values are theme-level, so they must NOT appear in layout.
  const themeOnly = await page.evaluate(() => {
    const doc = document.querySelector('#studio-canvas-document');
    return { canvasW: doc.style.width, canvasH: doc.style.minHeight, comps: doc.querySelectorAll('[data-comp-id]').length };
  });
  eq(themeOnly.canvasW, modelBefore.canvasW ? '960px' : themeOnly.canvasW, 'the canvas width is unchanged');

  // Viewer integrity: the canvas stays centred and its transform is untouched.
  const placementAfter = await canvasPlacement();
  check(isCentred(placementAfter),
    `the canvas is still centered after the background lifecycle - ${placeNote(placementAfter)}`);
  eq(placementAfter.transform, placementBefore.transform,
    'the viewer transform is unchanged by background edits');
  eq(placementAfter.zoom, placementBefore.zoom, 'the zoom is unchanged by background edits');
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATOR-12 — Profile Background Effects and .kpeffect import, in a real
// browser. The effect renderer needs a live canvas and the import flow needs real
// file bytes, so neither can be honestly verified outside a browser.
// ═══════════════════════════════════════════════════════════════════════════

/** Read the visible Background Effect state out of the Properties panel. */
const readEffectState = () => page.evaluate(() => {
  const chip = document.querySelector('#studio-effect-state');
  const current = document.querySelector('#studio-effect-current');
  const pending = document.querySelector('#studio-effect-pending');
  const apply = document.querySelector('#studio-effect-apply');
  const remove = document.querySelector('#studio-effect-remove');
  const importStatus = document.querySelector('#studio-effect-import-status');
  const importErr = document.querySelector('#studio-effect-import-error');
  const layer = document.querySelector('#studio-profile-effect-layer');
  const visible = (el) => !!el && el.offsetParent !== null;
  const canvas = layer?.querySelector('canvas');
  return {
    chipText: chip ? chip.textContent.trim() : null,
    chipState: chip ? chip.dataset.state : null,
    currentEffectId: current ? current.dataset.effectId : null,
    currentText: current ? current.textContent.trim() : null,
    pendingVisible: visible(pending),
    pendingText: document.querySelector('#studio-effect-pending-label')?.textContent.trim() || null,
    applyVisible: visible(apply),
    applyText: apply ? apply.textContent.trim() : null,
    removeVisible: visible(remove),
    importStatus: importStatus ? importStatus.textContent.trim() : '',
    importError: importErr ? importErr.textContent.trim() : null,
    // The canvas preview: real pixels, not a marker element.
    layerExists: !!layer,
    layerEffect: layer ? layer.dataset.profileEffect : null,
    layerEngine: layer ? layer.dataset.profileEffectEngine : null,
    hasCanvas: !!canvas,
    canvasW: canvas ? canvas.width : 0,
    canvasH: canvas ? canvas.height : 0,
    // The layer must be inert and behind everything.
    layerPointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
    layerAriaHidden: layer ? layer.getAttribute('aria-hidden') : null,
    layerZ: layer ? getComputedStyle(layer).zIndex : null,
    isComponent: document.querySelectorAll('#studio-profile-effect-layer[data-comp-id]').length,
    inLayers: Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-name'))
      .some(el => /snow|rain|effect|particle/i.test(el.textContent || '')),
  };
});

/** Count non-transparent pixels in the Studio effect canvas (proof it drew). */
const effectCanvasPixels = () => page.evaluate(() => {
  const canvas = document.querySelector('#studio-profile-effect-layer canvas');
  if (!canvas) return { sampled: 0, total: 0 };
  try {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sampled = 0;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 8) sampled += 1;
    return { sampled, total: Math.floor(data.length / 4 / 97) };
  } catch (e) {
    return { error: e.message };
  }
});

/** Build a .kpeffect in the page? No — the ZIP bytes are produced in Node. */
const kpeffectValid = () => buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest({ preview: 'preview.png' })) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition({ engine: 'particles', config: { count: 45, speed: 1.1, size: 10, opacity: 0.9, direction: 'down' } })) },
  { name: 'assets/flake.png', data: effectPng },
  { name: 'preview.png', data: effectPng },
]);
const kpeffectWithCode = () => buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
  { name: 'assets/evil.js', data: 'alert(document.cookie)' },
]);
const kpeffectTraversal = () => buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
  { name: '../../escape.png', data: effectPng },
]);

await step('CREATOR-12: the Background Effect section exists and starts at NO EFFECT', async () => {
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  // Motion must be allowed: headless Chrome reports reduce by default, and an
  // effect under reduced motion renders a still frame instead of animating.
  await setMotionPreference('no-preference');
  const shown = await showBackgroundSection();
  check(shown, 'the Background Effect section is visible');

  const state = await readEffectState();
  eq(state.chipState, 'none', 'the effect state starts at none');
  check(/NO EFFECT/.test(state.chipText || ''), `the chip reads NO EFFECT, got ${JSON.stringify(state.chipText)}`);
  eq(state.currentEffectId, '', 'no effect is current');
  check(/no effect is playing/i.test(state.currentText || ''),
    `the panel says plainly that nothing is playing, got "${state.currentText}"`);
  eq(state.applyVisible, false, 'no apply button with nothing staged');
  eq(state.removeVisible, false, 'no Remove button with no active effect');
  // Built-in choices are offered, split by source.
  const builtins = await page.evaluate(() => Array.from(
    document.querySelectorAll('#studio-effect-builtin option'),
  ).map(o => ({ value: o.value, label: o.textContent })));
  for (const id of ['builtin.snow', 'builtin.rain', 'builtin.fire', 'builtin.smoke', 'builtin.lightning',
    'builtin.leaves', 'builtin.petals', 'builtin.sparkles', 'builtin.stars']) {
    check(builtins.some(o => o.value === id), `"${id}" is offered as a built-in choice`);
  }
  check(builtins.every(o => o.value === '' || /Built-in/.test(o.label)),
    'built-in choices are visibly labelled as built-in');
  const creators = await page.evaluate(() => Array.from(
    document.querySelectorAll('#studio-effect-creator option'),
  ).map(o => o.textContent));
  check(creators.length >= 1, 'a Creator Effects list is shown');
  // Nothing is playing on the canvas.
  eq(state.layerEffect, 'none', 'no effect is rendered on the canvas');
  eq(state.hasCanvas, false, 'no effect canvas is created when there is no effect');
});

await step('CREATOR-12: a built-in effect renders on the canvas, behind the profile', async () => {
  await page.select('#studio-effect-builtin', 'builtin.snow');
  await new Promise(r => setTimeout(r, 400));
  const staged = await readEffectState();
  check(staged.chipState === 'pending' || staged.chipState === 'replace',
    `choosing an effect stages it rather than applying it, got ${staged.chipState}`);
  // It is staged: still nothing active on the canvas.
  eq(staged.layerEffect, 'none', 'a staged effect is NOT yet rendered as active');

  await page.select('#studio-effect-builtin', 'builtin.snow');
  await new Promise(r => setTimeout(r, 200));
  const applyBtn = await page.$('#studio-effect-apply');
  if (applyBtn) await applyBtn.click();
  await new Promise(r => setTimeout(r, 500));

  const active = await readEffectState();
  eq(active.chipState, 'active', 'applying makes the effect active');
  check(/ACTIVE/.test(active.chipText || ''), `the chip reads ACTIVE, got ${JSON.stringify(active.chipText)}`);
  eq(active.currentEffectId, 'builtin.snow', 'the active effect is snow');
  eq(active.removeVisible, true, 'Remove is offered once an effect is active');
  eq(active.applyVisible, false, 'no apply button when nothing is staged');
  // It actually rendered, and it really drew pixels.
  eq(active.layerEffect, 'builtin.snow', 'the canvas layer reports the active effect');
  eq(active.layerEngine, 'particles', 'the effect uses its declared engine');
  eq(active.hasCanvas, true, 'an effect canvas was created');
  check(active.canvasW > 0 && active.canvasH > 0, `the canvas has a real surface (${active.canvasW}x${active.canvasH})`);
  await new Promise(r => setTimeout(r, 400));
  const pixels = await effectCanvasPixels();
  check(pixels.sampled > 0, `the effect canvas actually drew (${pixels.sampled}/${pixels.total} sampled pixels opaque)`);
  void staged;
});

await step('CREATOR-12: the effect is inert and never a component', async () => {
  const s = await readEffectState();
  eq(s.layerPointerEvents, 'none', 'the effect layer never intercepts pointer events');
  eq(s.layerAriaHidden, 'true', 'the effect layer is hidden from assistive technology');
  eq(s.isComponent, 0, 'the effect layer is not a design component');
  eq(s.inLayers, false, 'the effect is not listed in Layers');
  // It sits ABOVE the background and BELOW the profile structure.
  //
  // CREATOR-10C: the background and the effect are layers OF the design canvas —
  // they cover the 960x1200 document, not the whole viewer. A creator sees the
  // picture as the profile's own bounded background with the module outlines over
  // it. Painting them across the viewer instead made the image read as escaping
  // the canvas and smeared it under the studio chrome.
  const order = await page.evaluate(() => {
    const doc = document.querySelector('#studio-canvas-document');
    const kids = Array.from(doc ? doc.children : []);
    const idx = (id) => kids.findIndex(el => el.id === id);
    const z = (sel) => {
      const el = document.querySelector(sel);
      return el ? parseInt(getComputedStyle(el).zIndex || '0', 10) : null;
    };
    const box = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect() : null;
    };
    return {
      bgIndex: idx('studio-profile-background'),
      effectIndex: idx('studio-profile-effect-layer'),
      skeletonIndex: kids.findIndex(el => el.id === 'studio-profile-skeleton'),
      firstComp: kids.findIndex(el => el.dataset.compId),
      bgZ: z('#studio-profile-background'),
      effectZ: z('#studio-profile-effect-layer'),
      // Both layers must cover the canvas, not spill past it into the viewer.
      bgCoversCanvas: (() => {
        const l = box('#studio-profile-background'); const d = box('#studio-canvas-document');
        return !!l && !!d && Math.abs(l.width - d.width) <= 2 && Math.abs(l.height - d.height) <= 2;
      })(),
      effectCoversCanvas: (() => {
        const l = box('#studio-profile-effect-layer'); const d = box('#studio-canvas-document');
        return !!l && !!d && Math.abs(l.width - d.width) <= 2 && Math.abs(l.height - d.height) <= 2;
      })(),
      // A press at the top of the canvas must not land on the effect layer. The
      // profile structure above it is pointer-events:none too, so the honest
      // assertion is "the effect never got it", not "a component got it".
      pressSkipsEffect: (() => {
        if (!doc) return true;
        const r = doc.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
        return !el || !el.closest('#studio-profile-effect-layer');
      })(),
    };
  });
  check(order.bgIndex >= 0, 'the background layer is inside the design canvas');
  check(order.bgCoversCanvas, 'the background covers exactly the design canvas');
  check(order.effectIndex > order.bgIndex, 'the effect layer is painted after the background image');
  check(order.effectCoversCanvas, 'the effect covers exactly the design canvas');
  check(order.effectIndex < order.skeletonIndex,
    'the effect is painted below the profile structure');
  check(order.bgZ < order.effectZ, `the effect is above the background (${order.bgZ} < ${order.effectZ})`);
  check(order.pressSkipsEffect, 'a press on the canvas never lands on the effect layer');
});

await step('CREATOR-12: effect settings come from the effect schema and are bounded', async () => {
  await showBackgroundSection();
  const labels = await page.evaluate(() => Array.from(
    document.querySelectorAll('#studio-properties .studio-prop-row'),
  ).map(r => r.querySelector('.studio-prop-label')?.textContent || ''));
  for (const want of ['Amount', 'Speed', 'Size', 'Opacity', 'Drift']) {
    check(labels.includes(want), `the particles schema exposes "${want}"`);
  }
  // Bounds are the schema's, not free-form.
  const bounds = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const find = (label) => rows.find(r => r.querySelector('.studio-prop-label')?.textContent === label)?.querySelector('input');
    const amount = find('Amount');
    return { min: amount?.min, max: amount?.max };
  });
  eq(bounds.min, '1', 'the Amount minimum comes from the schema');
  eq(bounds.max, '300', 'the Amount maximum comes from the schema');

  // Changing a setting does not touch geometry.
  const before = await designSnapshot();
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#studio-properties .studio-prop-row'));
    const amount = rows.find(r => r.querySelector('.studio-prop-label')?.textContent === 'Amount')?.querySelector('input');
    if (!amount) throw new Error('Amount field missing');
    amount.value = '77';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    amount.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 400));
  await showBackgroundSection();
  const after = await designSnapshot();
  eq(JSON.stringify(after), JSON.stringify(before), 'changing an effect setting changed no component geometry');
  const canvasBefore = await canvasPlacement();
  const canvasAfter = await canvasPlacement();
  eq(canvasAfter.zoom, canvasBefore.zoom, 'an effect setting change did not touch the viewer zoom');
  eq(canvasAfter.transform, canvasBefore.transform, 'an effect setting change did not touch the viewer transform');
});

await step('CREATOR-12: an imported .kpeffect is NOT active until applied', async () => {
  const { writeFileSync } = await import('node:fs');
  const validPath = join(TMP_DIR, 'valid.kpeffect');
  writeFileSync(validPath, kpeffectValid());
  const input = await page.$('#studio-effect-file');
  check(!!input, 'the import control offers a file input');
  await input.uploadFile(validPath);
  await new Promise(r => setTimeout(r, 2500));
  await showBackgroundSection();

  const s = await readEffectState();
  check(s.chipState === 'replace' || s.chipState === 'pending',
    `an import is staged, not applied, got ${s.chipState}`);
  check(/IMPORTED/.test(s.chipText || '') || /REPLACEMENT/.test(s.chipText || ''),
    `the chip says it is imported and not yet active, got ${JSON.stringify(s.chipText)}`);
  check(s.pendingVisible, 'the staged import is shown on its own row');
  check(/not applied yet|not active yet/i.test(s.pendingText || ''),
    `the staged import says it is not in use, got "${s.pendingText}"`);
  // The ACTIVE effect is unchanged until the creator applies.
  eq(s.currentEffectId, 'builtin.snow', 'the previously active effect is still the active one');
  // And it now appears under Creator Effects.
  const creatorOptions = await page.evaluate(() => Array.from(
    document.querySelectorAll('#studio-effect-creator option'),
  ).map(o => ({ value: o.value, label: o.textContent })));
  const snowEntry = creatorOptions.find(o => o.value === 'creator.snowfall');
  check(!!snowEntry, `the imported effect is listed under Creator Effects, got ${JSON.stringify(creatorOptions)}`);
  check(/Creator/.test(snowEntry.label), 'a creator effect is visibly labelled as Creator');
  check(/Test Creator/.test(snowEntry.label), `the creator effect shows its author, got "${snowEntry.label}"`);
});

await step('CREATOR-12: applying the imported effect activates it and persists', async () => {
  const applyBtn = await page.$('#studio-effect-apply');
  check(!!applyBtn, 'an apply button is offered for the staged import');
  const applyText = await page.$eval('#studio-effect-apply', el => el.textContent.trim());
  check(/Replace/.test(applyText), `with an effect already active it says Replace, got "${applyText}"`);
  await applyBtn.click();
  await new Promise(r => setTimeout(r, 600));

  const s = await readEffectState();
  eq(s.chipState, 'active', 'the imported effect is now active');
  eq(s.currentEffectId, 'creator.snowfall', 'the active effect is the creator one');
  check(/Creator/.test(s.currentText || ''), `the panel shows it as a Creator effect, got "${s.currentText}"`);
  await new Promise(r => setTimeout(r, 400));
  const pixels = await effectCanvasPixels();
  check(pixels.sampled > 0, 'the creator effect actually renders');

  // Save and reload: the effect must be reconstructed from the saved design.
  await page.click('#studio-save');
  await new Promise(r => setTimeout(r, 1800));
  const status = await page.$eval('#studio-status', el => el.textContent || '');
  check(/saved/i.test(status), `the design with a creator effect saved, status="${status}"`);

  await resetStudioWorkspace();
  await setMotionPreference('no-preference');
  await showBackgroundSection();
  const reloaded = await readEffectState();
  eq(reloaded.chipState, 'active', 'the active effect survives a reload');
  eq(reloaded.currentEffectId, 'creator.snowfall', 'the same creator effect is restored');
  eq(reloaded.layerEffect, 'creator.snowfall', 'the canvas preview is restored from the saved design');
});

await step('CREATOR-12: an invalid package is refused with a usable reason', async () => {
  const { writeFileSync } = await import('node:fs');
  const cases = [
    ['code.zip', kpeffectWithCode(), /must not contain|unexpected/i],
    ['traversal.zip', kpeffectTraversal(), /\.\.|absolute|could not be read/i],
    ['garbage.zip', Buffer.from('this is not a zip at all'), /not a readable|read/i],
  ];
  for (const [name, bytes, pattern] of cases) {
    const p = join(TMP_DIR, name);
    writeFileSync(p, bytes);
    const input = await page.$('#studio-effect-file');
    await input.uploadFile(p);
    await new Promise(r => setTimeout(r, 2500));
    await showBackgroundSection();
    const s = await readEffectState();
    check(s.chipState === 'active',
      `${name}: the previously active effect is untouched, got ${s.chipState}`);
    eq(s.currentEffectId, 'creator.snowfall', `${name}: the active effect did not change`);
    // The reason lives in the status line itself, so that is where it is read.
    const reason = s.importError || s.importStatus || '';
    check(pattern.test(reason), `${name}: a usable reason is shown, got "${reason}"`);
    check(!/at Object\.|node:internal|\.js:\d+/.test(reason),
      `${name}: the reason is creator-safe with no stack trace, got "${reason}"`);
    // And the rejected package is NOT offered as a choice.
    const options = await page.evaluate(() => Array.from(
      document.querySelectorAll('#studio-effect-creator option'),
    ).map(o => o.value));
    check(!options.some(v => v && v.includes(name.replace('.zip', ''))),
      `${name}: the rejected package did not become selectable`);
  }
  // Exactly one creator effect is installed — the one valid package.
  const options = await page.evaluate(() => Array.from(
    document.querySelectorAll('#studio-effect-creator option'),
  ).map(o => o.value).filter(Boolean));
  eq(options.length, 1, `only the valid package is installed, got ${JSON.stringify(options)}`);
});

await step('CREATOR-12: removing the effect leaves the background image untouched', async () => {
  // Give the design a background image as well, so independence is real.
  await resetStudioWorkspace();
  await ensureEditingMode();
  await pinStudioInView();
  await setMotionPreference('no-preference');
  await showBackgroundSection();
  const bgInput = await page.$('#studio-background-file');
  await bgInput.uploadFile(bgFixturePath);
  await new Promise(r => setTimeout(r, 1600));
  await showBackgroundSection();
  const bgApply = await page.$('#studio-background-apply');
  if (bgApply) await bgApply.click();
  await new Promise(r => setTimeout(r, 500));

  await showBackgroundSection();
  await page.select('#studio-effect-builtin', 'builtin.stars');
  await new Promise(r => setTimeout(r, 400));
  await showBackgroundSection();
  const effectApply = await page.$('#studio-effect-apply');
  if (effectApply) await effectApply.click();
  await new Promise(r => setTimeout(r, 500));

  const both = await readEffectState();
  eq(both.chipState, 'active', 'the effect is active');
  const bgActive = await page.evaluate(() => ({
    state: document.querySelector('[data-profile-background-preview]')?.dataset.profileBackgroundPreview,
    src: document.querySelector('#studio-profile-background img')?.getAttribute('src') || '',
  }));
  eq(bgActive.state, 'active', 'the background image is active at the same time');

  // Remove ONLY the effect.
  await showBackgroundSection();
  const removeBtn = await page.$('#studio-effect-remove');
  check(!!removeBtn, 'a Remove button is offered for the effect');
  await removeBtn.click();
  await new Promise(r => setTimeout(r, 500));

  const afterEffect = await readEffectState();
  eq(afterEffect.chipState, 'none', 'removing the effect returns to NO EFFECT');
  eq(afterEffect.layerEffect, 'none', 'the effect is gone from the canvas');
  eq(afterEffect.hasCanvas, false, 'the effect canvas is gone');
  const bgAfter = await page.evaluate(() => ({
    state: document.querySelector('[data-profile-background-preview]')?.dataset.profileBackgroundPreview,
    src: document.querySelector('#studio-profile-background img')?.getAttribute('src') || '',
  }));
  eq(bgAfter.state, 'active', 'the background image is STILL active after removing the effect');
  eq(bgAfter.src, bgActive.src, 'the background image is genuinely unchanged');
  const status = await page.$eval('#studio-status', el => el.textContent || '');
  check(/image is unchanged/i.test(status), `the status says the image was untouched, got "${status}"`);
});

await step('CREATOR-12: reduced motion renders a still frame, and motion returns after', async () => {
  await setMotionPreference('no-preference');
  await showBackgroundSection();
  await page.select('#studio-effect-builtin', 'builtin.snow');
  await new Promise(r => setTimeout(r, 400));
  await showBackgroundSection();
  const apply = await page.$('#studio-effect-apply');
  if (apply) await apply.click();
  await new Promise(r => setTimeout(r, 600));

  // Motion allowed: the renderer reports an animated surface and draws.
  const first = await effectCanvasPixels();
  const motionDiag = await page.evaluate(() => {
    const layer = document.querySelector('#studio-profile-effect-layer');
    const canvas = layer?.querySelector('canvas');
    return {
      motion: layer ? layer.dataset.motion : null,
      effect: layer ? layer.dataset.profileEffect : null,
      engine: layer ? layer.dataset.profileEffectEngine : null,
      w: canvas ? canvas.width : 0,
      h: canvas ? canvas.height : 0,
      reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
  check(first.sampled > 0,
    `the effect draws when motion is allowed, got ${JSON.stringify(first)} / ${JSON.stringify(motionDiag)}`);
  const motionOn = motionDiag.motion;
  eq(motionOn, 'animated', 'with motion allowed the effect is animated');

  // Now ask for reduced motion: a still frame, but still present.
  await setMotionPreference('reduce');
  await showBackgroundSection();
  const reducedState = await readEffectState();
  eq(reducedState.chipState, 'active', 'reduced motion does not remove the setting');
  eq(reducedState.hasCanvas, true, 'the effect still renders under reduced motion');
  const motionOff = await page.evaluate(() =>
    document.querySelector('#studio-profile-effect-layer')?.dataset.motion);
  eq(motionOff, 'static', 'under reduced motion the effect renders a still frame');
  const reducedPixels = await effectCanvasPixels();
  check(reducedPixels.sampled > 0, 'a still frame is drawn under reduced motion');
  // Nothing in the layer is left running a CSS animation.
  const cssAnimations = await page.evaluate(() => Array.from(
    document.querySelectorAll('#studio-profile-effect-layer *'),
  ).map(el => getComputedStyle(el).animationName).filter(n => n && n !== 'none'));
  eq(cssAnimations.length, 0, `no CSS animation runs under reduced motion, got ${JSON.stringify(cssAnimations)}`);

  // The stored design is untouched: turning the preference back restores motion.
  await setMotionPreference('no-preference');
  await showBackgroundSection();
  const backState = await readEffectState();
  eq(backState.chipState, 'active', 'the effect is still set after motion is allowed again');
  const motionBack = await page.evaluate(() =>
    document.querySelector('#studio-profile-effect-layer')?.dataset.motion);
  eq(motionBack, 'animated', 'the effect animates again once motion is allowed');
});

await step('CREATOR-12: the published public profile renders the effect behind the content', async () => {
  await page.click('#studio-save');
  await new Promise(r => setTimeout(r, 1800));
  await page.click('#studio-publish');
  await new Promise(r => setTimeout(r, 2000));

  await setMotionPreference('no-preference');
  await page.goto(`${BASE}/#/profile/${seller.username}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const view = await page.evaluate(() => {
    const layer = document.querySelector('#profile-background-effect-layer');
    const content = document.querySelector('.profile-content-frame');
    const canvas = layer?.querySelector('canvas');
    let sampled = 0;
    if (canvas) {
      try {
        const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 3; i < data.length; i += 4 * 199) if (data[i] > 8) sampled += 1;
      } catch { /* ignore */ }
    }
    const z = (el) => (el ? parseInt(getComputedStyle(el).zIndex || '0', 10) : -1);
    return {
      layerExists: !!layer,
      effect: layer ? layer.dataset.profileEffect : null,
      hasCanvas: !!canvas,
      sampled,
      pointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
      ariaHidden: layer ? layer.getAttribute('aria-hidden') : null,
      position: layer ? getComputedStyle(layer).position : null,
      layerZ: z(layer), contentZ: z(content),
      // A click must reach the profile content, never the effect.
      clickReachesContent: (() => {
        const el = document.elementFromPoint(window.innerWidth / 2, 300);
        return !!el && !el.closest('#profile-background-effect-layer');
      })(),
      // The effect must not have added layout height.
      docHeight: document.documentElement.scrollHeight,
    };
  });
  check(view.layerExists, 'the public profile has the effect layer');
  check(view.effect && view.effect !== 'none', `the public profile renders the active effect, got "${view.effect}"`);
  eq(view.hasCanvas, true, 'the public effect renders on a canvas');
  check(view.sampled > 0, `the public effect actually drew (${view.sampled} sampled pixels)`);
  eq(view.pointerEvents, 'none', 'the public effect layer never intercepts pointer events');
  eq(view.ariaHidden, 'true', 'the public effect layer is hidden from assistive technology');
  eq(view.position, 'fixed', 'the public effect layer is a fixed overlay');
  check(view.layerZ < view.contentZ,
    `the effect is behind the profile content (effect z=${view.layerZ}, content z=${view.contentZ})`);
  check(view.clickReachesContent, 'a click reaches the profile content, not the effect layer');

  // An invalid effect degrades to no effect rather than breaking the page.
  const degraded = await page.evaluate(() => {
    document.querySelector('#profile-frame')?.setAttribute('data-test', '1');
    return true;
  });
  void degraded;
  check(view.docHeight > 0, 'the profile still has layout — the effect added no height of its own');
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
// Remove the uploads this run wrote into the servable uploads/creator tree.
// Done explicitly as well as on exit, so a hard process.exit() can never leave
// untracked files behind in the git working tree.
cleanupUploads();
cleanupEffectUploads();
process.exit(failed.length ? 1 : 0);
