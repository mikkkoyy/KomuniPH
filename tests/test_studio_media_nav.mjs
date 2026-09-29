/**
 * CREATOR-06 — Creator Studio media upload + navigation test suite.
 *
 * Run:   npm run test:studio-media
 *
 * Covers:
 *   Upload (POST /api/creator/media):
 *   - valid JPG / JPEG / PNG / WEBP accepted (content-validated)
 *   - GIF, text, empty-missing, wrong-field, oversized rejected
 *   - unauthenticated rejected
 *   - generated filename is safe; traversal filenames neutralized
 *   - uploaded bytes served back through the application URL
 *   - uploaded URL accepted by design validation + creator-asset validation
 *   - javascript: URLs still rejected everywhere
 *   Navigation (render-structure, no browser required):
 *   - every required page exposes its specified Back action
 *
 * Throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-studio-media-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-studio-media.db');
process.env.PORT = String(19200 + (process.pid % 500));
process.env.UPLOAD_MAX_FILE_SIZE = String(8 * 1024); // 8 KB: oversize tests stay fast
process.env.UPLOAD_CREATOR_DIR = join(TMP_DIR, 'uploads-creator'); // isolate test uploads
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-06-test-webhook-secret';
process.env.SECRET_KEY = 'creator-06-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'studio-media-admin';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ── Imports ────────────────────────────────────────────────────────────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const auth = await import(mod('server/auth.js'));
await import(mod('server/index.js')); // boots the HTTP server
await database.seedAdminUser();

// Frontend render modules are pure string builders — import-safe in Node.
const marketplaceUi = await import(mod('web/js/marketplace.js'));
const coinShopManagerUi = await import(mod('web/js/coinShopManager.js'));
const coinsUi = await import(mod('web/js/coins.js'));

// ── Harness ────────────────────────────────────────────────────────────────
const results = [];
const queue = [];
let groupName = '';
function group(name) { groupName = name; }
function test(name, fn) {
  const grp = groupName;
  queue.push(async () => {
    const full = `${grp} › ${name}`;
    try { await fn(); results.push({ name: full, ok: true }); process.stdout.write(`  ok   ${full}\n`); }
    catch (err) { results.push({ name: full, ok: false, error: err }); process.stdout.write(`  FAIL ${full} — ${err.message}\n`); }
  });
}
function check(cond, msg = 'condition failed') { if (!cond) throw new Error(msg); }

// ── Helpers ────────────────────────────────────────────────────────────────
async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

async function upload({ buffer, filename, mime, token, field = 'image' }) {
  const form = new FormData();
  form.append(field, new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`${BASE}/api/creator/media`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

function createUserWithProfile(username) {
  const id = randomUUID();
  const email = `${username}-${id.slice(0, 8)}@test.local`;
  const ts = new Date().toISOString();
  database.execute(
    `INSERT INTO users (id, email, username, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, 'unused', 'member', 'active', ?, ?)`,
    [id, email, username, ts, ts]
  );
  database.execute(
    `INSERT INTO profiles (id, user_id, display_name, theme_id, created_at, updated_at)
     VALUES (?, ?, ?, 'default', ?, ?)`,
    [randomUUID(), id, username, ts, ts]
  );
  return { id, username };
}
function tokenFor(userId) { return auth.createToken(userId, 'access'); }

async function makeImage(format) {
  const base = sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 120, b: 120 } } });
  if (format === 'jpeg') return base.jpeg().toBuffer();
  if (format === 'webp') return base.webp().toBuffer();
  return base.png().toBuffer();
}
// Minimal valid 1x1 GIF89a (animated-capable container; must be rejected).
const GIF_BYTES = Buffer.from('R0lGODdhAQABAIAAAP///////ywAAAAAAQABAAACAkQBADs=', 'base64');

// ═══════════════════════════════════════════════════════════════════════════
group('Upload Security + Formats');

test('unauthenticated upload rejected', async () => {
  const res = await upload({ buffer: await makeImage('png'), filename: 'a.png', mime: 'image/png' });
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('valid PNG accepted with safe generated URL', async () => {
  const u = createUserWithProfile('media-png');
  const res = await upload({ buffer: await makeImage('png'), filename: 'photo.png', mime: 'image/png', token: tokenFor(u.id) });
  check(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
  check(/^\/uploads\/creator\/[0-9a-f]{32}\.webp$/.test(res.data.url), `unsafe url: ${res.data.url}`);
});

test('valid JPG accepted', async () => {
  const u = createUserWithProfile('media-jpg');
  const res = await upload({ buffer: await makeImage('jpeg'), filename: 'photo.jpg', mime: 'image/jpeg', token: tokenFor(u.id) });
  check(res.status === 201, `expected 201, got ${res.status}`);
});

test('valid JPEG + WEBP accepted', async () => {
  const u = createUserWithProfile('media-jw');
  const token = tokenFor(u.id);
  const jpeg = await upload({ buffer: await makeImage('jpeg'), filename: 'p.jpeg', mime: 'image/jpeg', token });
  check(jpeg.status === 201, `jpeg: ${jpeg.status}`);
  const webp = await upload({ buffer: await makeImage('webp'), filename: 'p.webp', mime: 'image/webp', token });
  check(webp.status === 201, `webp: ${webp.status}`);
});

test('GIF rejected (no safe GIF contract)', async () => {
  const u = createUserWithProfile('media-gif');
  const res = await upload({ buffer: GIF_BYTES, filename: 'anim.gif', mime: 'image/gif', token: tokenFor(u.id) });
  check(res.status === 422, `expected 422, got ${res.status}`);
});

test('text file rejected', async () => {
  const u = createUserWithProfile('media-txt');
  const res = await upload({ buffer: Buffer.from('<script>alert(1)</script>'), filename: 'evil.html', mime: 'text/html', token: tokenFor(u.id) });
  check(res.status === 422, `expected 422, got ${res.status}`);
});

test('oversized file rejected', async () => {
  const u = createUserWithProfile('media-big');
  const big = await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
  check(big.length > 8 * 1024, `fixture must exceed limit, got ${big.length}`);
  const res = await upload({ buffer: big, filename: 'big.png', mime: 'image/png', token: tokenFor(u.id) });
  check(res.status === 422, `expected 422, got ${res.status}`);
});

test('wrong field name and missing file rejected', async () => {
  const u = createUserWithProfile('media-field');
  const token = tokenFor(u.id);
  const wrong = await upload({ buffer: await makeImage('png'), filename: 'a.png', mime: 'image/png', token, field: 'photo' });
  check(wrong.status === 422, `expected 422, got ${wrong.status}`);
  const res = await fetch(`${BASE}/api/creator/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  check(res.status === 422, `expected 422, got ${res.status}`);
});

test('traversal filename neutralized, bytes served', async () => {
  const u = createUserWithProfile('media-trav');
  const res = await upload({ buffer: await makeImage('png'), filename: '../../evil.png', mime: 'image/png', token: tokenFor(u.id) });
  check(res.status === 201, `expected 201, got ${res.status}`);
  check(/^\/uploads\/creator\/[0-9a-f]{32}\.webp$/.test(res.data.url), `unsafe url: ${res.data.url}`);
  const got = await fetch(`${BASE}${res.data.url}`);
  check(got.status === 200, `expected served 200, got ${got.status}`);
  const bytes = new Uint8Array(await got.arrayBuffer());
  check(bytes.length > 0, 'expected image bytes');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Uploaded URL Integration');

test('design validation accepts uploaded URL', async () => {
  const u = createUserWithProfile('media-design');
  const token = tokenFor(u.id);
  const up = await upload({ buffer: await makeImage('png'), filename: 'd.png', mime: 'image/png', token });
  check(up.status === 201, `upload: ${up.status}`);
  const res = await api('POST', '/api/profile/design', {
    token,
    body: {
      name: 'Upload Design',
      layout: {
        canvas: { width: 960, minHeight: 1200 },
        components: [
          { id: 'img-1', type: 'image', x: 10, y: 10, width: 200, height: 150, zIndex: 1, visible: true, locked: false, rotation: 0, style: {}, config: { imageUrl: up.data.url, fit: 'cover' } },
        ],
      },
      theme: {},
    },
  });
  check(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
});

test('creator asset accepts uploaded URL, javascript: still rejected', async () => {
  const u = createUserWithProfile('media-asset');
  const token = tokenFor(u.id);
  const up = await upload({ buffer: await makeImage('jpeg'), filename: 'a.jpg', mime: 'image/jpeg', token });
  const ok = await api('POST', '/api/creator/assets', {
    token,
    body: { name: 'Uploaded Sticker', description: '', asset_type: 'sticker', asset_data: { imageUrl: up.data.url, fit: 'cover' }, price_coins: 10 },
  });
  check(ok.status === 201, `expected 201, got ${ok.status}`);
  const bad = await api('POST', '/api/creator/assets', {
    token,
    body: { name: 'Bad', description: '', asset_type: 'sticker', asset_data: { imageUrl: 'javascript:evil()', fit: 'cover' }, price_coins: 10 },
  });
  check(bad.status === 400, `expected 400, got ${bad.status}`);
});

// ═══════════════════════════════════════════════════════════════════════════
group('Navigation Structure');

const listingFixture = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  title: 'Fixture Product',
  description: 'A fixture.',
  category: 'products',
  price_display: '₱100',
  images: [],
  external_url: null,
  contact_info: null,
  status: 'published',
  seller_user_id: 'seller-id',
  seller_username: 'selleruser',
  seller_display_name: 'Seller User',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  published_at: '2026-01-02T00:00:00.000Z',
};
const productFixture = {
  id: 'ffffffff-1111-2222-3333-444444444444',
  name: 'Fixture Asset',
  description: 'A fixture asset.',
  asset_type: 'sticker',
  status: 'published',
  version: 2,
  preview_data: { imageUrl: 'https://example.com/s.png', fit: 'cover' },
  asset_data: { imageUrl: 'https://example.com/s.png', fit: 'cover' },
  price_coins: 50,
  creator_user_id: 'creator-id',
  creator_username: 'creatoruser',
  creator_display_name: 'Creator User',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

test('back button helper renders deterministic route link', async () => {
  const html = marketplaceUi.renderBackButton({ label: 'Back to Coin Shop', href: '#/coin-shop' });
  check(html.includes('href="#/coin-shop"'), 'expected href');
  check(html.includes('Back to Coin Shop'), 'expected label');
  check(!html.includes('history'), 'no history hacks');
});

test('marketplace product detail has Back to Marketplace', async () => {
  const html = marketplaceUi.renderMarketplaceProductDetail(listingFixture);
  check(html.includes('Back to Marketplace'), 'expected back label');
  check(html.includes('href="#/marketplace"'), 'expected marketplace route');
  check(html.includes('Fixture Product'), 'product content intact');
});

test('coin shop product detail has Back to Coin Shop', async () => {
  const html = marketplaceUi.renderCoinShopProductDetailPage(productFixture);
  check(html.includes('Back to Coin Shop'), 'expected back label');
  check(html.includes('href="#/coin-shop"'), 'expected coin-shop route');
  check(html.includes('Buy — 50 coins'), 'buy action intact');
});

test('seller center has Back to Marketplace', async () => {
  const html = await marketplaceUi.renderManagePage();
  check(html.includes('Back to Marketplace'), 'expected back label');
  check(html.includes('Marketplace Seller Center'), 'expected header intact');
});

test('library keeps Back to Coin Shop', async () => {
  const html = marketplaceUi.renderLibraryPage();
  check(html.includes('Back to Coin Shop'), 'expected back label');
  check(html.includes('href="#/coin-shop"'), 'expected coin-shop route');
});

test('coin shop manager has Studio + Coin Shop return paths', async () => {
  const html = coinShopManagerUi.renderCoinShopManagerPage();
  check(html.includes('Back to Creator Studio'), 'expected studio return');
  check(html.includes('href="#/creator-studio"'), 'expected studio route');
  check(html.includes('Back to Coin Shop'), 'expected shop return');
});

test('wallet has Back to Profile without resetting sections', async () => {
  const html = coinsUi.renderWalletPage();
  check(html.includes('Back to Profile'), 'expected back label');
  check(html.includes('href="#/profile"'), 'expected profile route');
  check(html.includes('Cash In') && html.includes('Cash Out') && html.includes('Gift'), 'wallet actions intact');
});

test('marketplace catalog has Back to Profile', async () => {
  globalThis.window = { location: { hash: '#/marketplace', origin: 'http://127.0.0.1' } };
  try {
    const html = marketplaceUi.renderMarketplacePage();
    check(html.includes('Back to Profile'), 'expected back label');
    check(html.includes('href="#/profile"'), 'expected profile route');
    check(html.includes('Marketplace'), 'marketplace content intact');
  } finally { delete globalThis.window; }
});

test('coin shop catalog has Back to Marketplace', async () => {
  globalThis.window = { location: { hash: '#/coin-shop', origin: 'http://127.0.0.1' } };
  try {
    const html = marketplaceUi.renderCoinShopPage();
    check(html.includes('Back to Marketplace'), 'expected back label');
    check(html.includes('href="#/marketplace"'), 'expected marketplace route');
  } finally { delete globalThis.window; }
});

test('creator studio properties expose Move Up / Move Down + align (source)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  check(src.includes('Move Up'), 'expected Move Up control');
  check(src.includes('Move Down'), 'expected Move Down control');
  check(src.includes('Canvas align'), 'expected alignment controls');
  check(src.includes('moveLayer(comp.id, 1)'), 'Move Up must reuse moveLayer');
  check(src.includes('moveLayer(comp.id, -1)'), 'Move Down must reuse moveLayer');
  check(src.includes('ArrowUp') && src.includes('ArrowDown') && src.includes('ArrowLeft') && src.includes('ArrowRight'), 'arrow-key movement intact');
});

test('design geometry persists after save + reload (X/Y/resize/rotation)', async () => {
  const u = createUserWithProfile('media-persist');
  const token = tokenFor(u.id);
  const layout = {
    canvas: { width: 960, minHeight: 1200 },
    components: [
      { id: 'persist-1', type: 'text', x: 111, y: 222, width: 320, height: 96, zIndex: 0, visible: true, locked: false, rotation: 15, style: {}, config: { text: 'persist me' } },
    ],
  };
  const created = await api('POST', '/api/profile/design', { token, body: { name: 'Persist', layout, theme: {} } });
  check(created.status === 201, `create: ${created.status}`);
  const id = created.data.design.id;
  const moved = {
    canvas: { width: 960, minHeight: 1200 },
    components: [
      { id: 'persist-1', type: 'text', x: 333, y: 444, width: 400, height: 200, zIndex: 1, visible: true, locked: false, rotation: 45, style: {}, config: { text: 'persist me' } },
    ],
  };
  const saved = await api('PATCH', `/api/profile/design/${id}`, { token, body: { layout: moved } });
  check(saved.status === 200, `save: ${saved.status}`);
  const reloaded = await api('GET', `/api/profile/design/${id}`, { token });
  check(reloaded.status === 200, `reload: ${reloaded.status}`);
  const comp = reloaded.data.design.layout.components.find(c => c.id === 'persist-1');
  check(comp && comp.x === 333 && comp.y === 444, `XY persisted, got ${comp && comp.x},${comp && comp.y}`);
  check(comp.width === 400 && comp.height === 200, 'size persisted');
  check(comp.rotation === 45, 'rotation persisted');
  const bad = await api('PATCH', `/api/profile/design/${id}`, { token, body: { layout: { canvas: { width: 960, minHeight: 1200 }, components: [{ id: 'persist-1', type: 'text', x: 'far', y: 0, width: 10, height: 10, zIndex: 0, visible: true, locked: false, rotation: 0, style: {}, config: { text: 'x' } }] } } });
  check(bad.status === 400, `invalid coords rejected, got ${bad.status}`);
});

// ── Profile Viewer (CREATOR-06) ─────────────────────────────────────────────
const viewer = await import(mod('web/js/studioViewer.js'));

group('Profile Viewer Geometry');

test('zoom is clamped to the supported range', async () => {
  check(viewer.clampZoom(0.01) === viewer.MIN_ZOOM, 'under-range clamps to MIN_ZOOM');
  check(viewer.clampZoom(99) === viewer.MAX_ZOOM, 'over-range clamps to MAX_ZOOM');
  check(viewer.clampZoom(1) === 1, '1 stays 1');
  check(viewer.clampZoom('nonsense') === 1, 'invalid falls back to 1');
});

test('panel widths are clamped to a minimum and to the space available', async () => {
  check(viewer.clampPanelWidth(10) === viewer.MIN_PANEL_WIDTH, 'width floors at the panel minimum');
  check(viewer.clampPanelWidth(99999) === 99999, 'unbounded stays as given when no max');
  check(viewer.clampPanelWidth(99999, { max: 400 }) === 400, 'capped at the supplied max');
  check(viewer.clampPanelWidth(640.4) === 640, 'widths round to whole px');
  check(viewer.clampPanelWidth(NaN) === viewer.MIN_PANEL_WIDTH, 'NaN is safe');
  // A max below the minimum must not produce an impossible width.
  check(viewer.clampPanelWidth(10, { max: 50 }) === viewer.MIN_PANEL_WIDTH, 'minimum outranks a tiny max');
});

test('dragging a column boundary resizes that panel and leaves the other alone', async () => {
  const base = { startLeft: 300, startRight: 370, startClientX: 300, clientX: 300, totalWidth: 1400 };

  // Left boundary: the left panel follows the pointer, the right panel is fixed.
  const widerLeft = viewer.columnWidthsFromDrag({ ...base, edge: 'left', clientX: 380 });
  check(widerLeft.left === 380, `left panel grew, got ${widerLeft.left}`);
  check(widerLeft.right === 370, 'right panel unchanged while dragging the left boundary');

  const narrowerLeft = viewer.columnWidthsFromDrag({ ...base, edge: 'left', clientX: 240 });
  check(narrowerLeft.left === 240, `left panel shrank, got ${narrowerLeft.left}`);

  // Right boundary: dragging left widens the Properties panel.
  const widerRight = viewer.columnWidthsFromDrag({ ...base, edge: 'right', clientX: 250 });
  check(widerRight.right === 420, `properties panel grew, got ${widerRight.right}`);
  check(widerRight.left === 300, 'left panel unchanged while dragging the right boundary');

  // The center column absorbs the difference.
  const centerAfter = base.totalWidth - widerLeft.left - widerLeft.right;
  const centerBefore = base.totalWidth - base.startLeft - base.startRight;
  check(centerAfter < centerBefore, 'a wider left panel leaves less room for the viewer');
  check(centerAfter === 1400 - 380 - 370, 'center width is whatever is left over');
});

test('column drag cannot starve the center column or a panel minimum', async () => {
  const base = { startLeft: 300, startRight: 370, startClientX: 300, clientX: 300, totalWidth: 1400 };

  const hugeLeft = viewer.columnWidthsFromDrag({ ...base, edge: 'left', clientX: 5000 });
  check(hugeLeft.left + hugeLeft.right <= 1400 - viewer.MIN_CENTER_WIDTH,
    `left panel stops before starving the center, got ${hugeLeft.left}`);
  check(hugeLeft.left >= viewer.MIN_PANEL_WIDTH, 'left panel keeps its minimum');

  const tinyLeft = viewer.columnWidthsFromDrag({ ...base, edge: 'left', clientX: -5000 });
  check(tinyLeft.left === viewer.MIN_PANEL_WIDTH, `left panel floors, got ${tinyLeft.left}`);

  const hugeRight = viewer.columnWidthsFromDrag({ ...base, edge: 'right', clientX: -5000 });
  check(hugeRight.left + hugeRight.right <= 1400 - viewer.MIN_CENTER_WIDTH,
    `properties panel stops before starving the center, got ${hugeRight.right}`);

  const tinyRight = viewer.columnWidthsFromDrag({ ...base, edge: 'right', clientX: 5000 });
  check(tinyRight.right === viewer.MIN_PANEL_WIDTH, `properties panel floors, got ${tinyRight.right}`);

  // An unknown edge changes nothing and never yields NaN.
  const unknown = viewer.columnWidthsFromDrag({ ...base, edge: 'nope', clientX: 900 });
  check(unknown.left === 300 && unknown.right === 370, 'an unknown edge is a no-op');
  check(Number.isFinite(unknown.left) && Number.isFinite(unknown.right), 'stays finite');
});

test('viewer height is independent of the panels and of the window (CREATOR-07B)', async () => {
  check(viewer.clampViewerHeight(10) === viewer.MIN_VIEWER_HEIGHT, 'floors at the minimum height');
  check(viewer.clampViewerHeight(600) === 600, 'a sensible height is kept exactly');
  check(viewer.clampViewerHeight(640.6) === 641, 'heights round to whole px');

  // CREATOR-07B: the default is a deliberate editing size, not a derived one.
  // It must be a real workspace height, and must be a large fraction of the
  // 1200px design canvas rather than a short viewport-minus-chrome estimate.
  check(viewer.DEFAULT_VIEWER_HEIGHT >= 800,
    `default viewer height is a large editing area, got ${viewer.DEFAULT_VIEWER_HEIGHT}`);
  check(viewer.DEFAULT_VIEWER_HEIGHT < 1200,
    `default viewer height shows most of the 1200px design, got ${viewer.DEFAULT_VIEWER_HEIGHT}`);

  // The old `viewportHeight - chrome` ceiling is gone entirely: passing one must
  // not shorten the viewer, and a short window must not cap it either.
  check(!('VIEWER_HEIGHT_CHROME' in viewer), 'the viewport-chrome constant is removed');
  const ignored = viewer.clampViewerHeight(1500, { viewportHeight: 400 });
  check(ignored === 1500, `a short window does not shorten the viewer, got ${ignored}`);
  const tall = viewer.clampViewerHeight(99999);
  check(tall === viewer.MAX_VIEWER_HEIGHT, `an absurd drag hits the hard ceiling, got ${tall}`);

  // A non-numeric or unusable value falls back to the deliberate default rather
  // than to the minimum, so a bad value can never silently collapse the viewer.
  check(viewer.clampViewerHeight(NaN) === viewer.DEFAULT_VIEWER_HEIGHT, 'NaN falls back to the default');
  check(viewer.clampViewerHeight(undefined) === viewer.DEFAULT_VIEWER_HEIGHT, 'undefined falls back to the default');
  check(viewer.clampViewerHeight(0) === viewer.DEFAULT_VIEWER_HEIGHT, 'zero falls back to the default');

  // The floor still outranks an explicit ceiling below it.
  const cramped = viewer.clampViewerHeight(900, { min: 300, max: 100 });
  check(cramped === 300, `the minimum outranks a too-small ceiling, got ${cramped}`);
});

test('pan is bounded so the design can never be dragged out of reach', async () => {
  // Design much larger than the viewport.
  const big = viewer.clampPan({ panX: 99999, panY: 99999, viewportW: 800, viewportH: 600, contentW: 4000, contentH: 3000 });
  check(big.x < 99999 && big.y < 99999, 'pan is clamped on the high side');
  const far = viewer.clampPan({ panX: -99999, panY: -99999, viewportW: 800, viewportH: 600, contentW: 4000, contentH: 3000 });
  check(far.x > -99999 && far.y > -99999, 'pan is clamped on the low side');
  // Design smaller than the viewport is centred rather than left off-screen.
  const small = viewer.clampPan({ panX: 500, panY: 500, viewportW: 1000, viewportH: 900, contentW: 400, contentH: 300 });
  check(small.x === 300, `centred horizontally, got ${small.x}`);
  check(small.y === 300, `centred vertically, got ${small.y}`);
});

test('viewer transform composes pan and zoom independently', async () => {
  check(viewer.viewerTransform({ zoom: 1, panX: 0, panY: 0 }) === 'translate(0px, 0px) scale(1)', 'identity');
  check(viewer.viewerTransform({ zoom: 1.5, panX: 10.4, panY: -20.6 }) === 'translate(10px, -21px) scale(1.5)', 'pans and scales together');
});

test('CREATOR-08 zoom steps, clamps and formats cleanly', async () => {
  check(viewer.DEFAULT_ZOOM === 1, 'default zoom is 1');
  check(viewer.ZOOM_STEP === 0.1, 'step is 10%');

  // 100% -> 110% -> 120%
  check(viewer.stepZoom(1, 'in') === 1.1, 'one step in from 100%');
  check(viewer.stepZoom(viewer.stepZoom(1, 'in'), 'in') === 1.2, 'two steps in');
  // 100% -> 90% -> 80%
  check(viewer.stepZoom(1, 'out') === 0.9, 'one step out from 100%');
  check(viewer.stepZoom(viewer.stepZoom(1, 'out'), 'out') === 0.8, 'two steps out');

  // Repeated stepping must not accumulate float noise.
  let z = 1;
  for (let i = 0; i < 10; i += 1) z = viewer.stepZoom(z, 'in');
  check(z === 2, `ten steps in reaches exactly 200%, got ${z}`);
  for (let i = 0; i < 10; i += 1) z = viewer.stepZoom(z, 'out');
  check(z === 1, `and back to exactly 100%, got ${z}`);

  // Bounds: 25%..300%.
  check(viewer.clampZoom(0.01) === viewer.MIN_ZOOM, `floors at 25%, got ${viewer.clampZoom(0.01)}`);
  check(viewer.clampZoom(99) === viewer.MAX_ZOOM, `caps at 300%, got ${viewer.clampZoom(99)}`);
  let low = 1;
  for (let i = 0; i < 40; i += 1) low = viewer.stepZoom(low, 'out');
  check(low === viewer.MIN_ZOOM, `stepping out bottoms out at 25%, got ${low}`);
  let high = 1;
  for (let i = 0; i < 40; i += 1) high = viewer.stepZoom(high, 'in');
  check(high === viewer.MAX_ZOOM, `stepping in tops out at 300%, got ${high}`);
  check(viewer.stepZoom(1, 'nonsense') === 1, 'an unknown direction is a no-op');

  // Clean percentages, never float artifacts.
  check(viewer.zoomPercent(1) === '100%', '100%');
  check(viewer.zoomPercent(0.75) === '75%', '75%');
  check(viewer.zoomPercent(1.25) === '125%', '125%');
  check(viewer.zoomPercent(2) === '200%', '200%');
  check(viewer.zoomPercent(viewer.stepZoom(1, 'in')) === '110%', '110% from a step');
  check(viewer.zoomPercent(viewer.MIN_ZOOM) === '25%', '25% at the minimum');
  check(viewer.zoomPercent(viewer.MAX_ZOOM) === '300%', '300% at the maximum');
  for (const ratio of [0.3333333, 1.7777777, 2.0000001]) {
    check(!/\d\.\d/.test(viewer.zoomPercent(ratio)), `${ratio} renders without decimals`);
  }

  // Reset restores zoom 1 and a neutral pan — viewer state only.
  const reset = viewer.defaultViewerState();
  check(reset.zoom === 1, 'reset zoom is 1');
  check(reset.pan.x === 0 && reset.pan.y === 0, 'reset pan is neutral before clamping');

  // Zoom is viewer state: the transform is the only thing it feeds.
  check(viewer.viewerTransform({ zoom: 2, panX: 0, panY: 0 }) === 'translate(0px, 0px) scale(2)',
    'zoom reaches only the viewer transform');
});

test('CREATOR-08 guide patterns are a small, closed, safe registry', async () => {
  const design = await import(mod('web/js/profileDesign.js'));
  const server = await import(mod('server/profileDesign.js'));

  // All three required patterns exist with the documented labels.
  for (const id of ['default', 'minimal', 'classic']) {
    check(design.GUIDE_PATTERN_IDS.includes(id), `pattern "${id}" exists client-side`);
    check(server.GUIDE_PATTERNS.has(id), `pattern "${id}" is allowed server-side`);
  }
  check(design.GUIDE_PATTERN_IDS.length === 3, 'exactly three patterns, not a giant hard-coded block');
  for (const id of design.GUIDE_PATTERN_IDS) {
    const pattern = design.guidePattern(id);
    // CREATOR-09: a pattern is a list of CARD PLACEMENTS, each naming one real
    // profile section and its geometry in design coordinates.
    check(Array.isArray(pattern.cards) && pattern.cards.length > 0, `pattern "${id}" has cards`);
    for (const card of pattern.cards) {
      check(design.GUIDE_SECTION_IDS.includes(card.section), `card section "${card.section}" is a real profile section`);
      for (const key of ['x', 'y', 'width', 'height']) {
        check(typeof card[key] === 'number' && Number.isFinite(card[key]), `card ${key} is numeric`);
      }
      // A card carries no content of any kind: no text, no URL, no markup.
      check(Object.keys(card).length === 5, `card carries only placement data, got ${Object.keys(card)}`);
    }
    // Every card stays on the 960x1200 design canvas.
    for (const card of pattern.cards) {
      check(card.x >= 0 && card.y >= 0 && card.x + card.width <= 960 && card.y + card.height <= 1200,
        `card "${card.section}" stays inside the 960x1200 canvas`);
    }
  }

  // An unknown id falls back instead of throwing or rendering something raw.
  check(design.guidePattern('nope').id === 'default', 'an unknown pattern falls back to default');
  check(design.guidePattern(undefined).id === 'default', 'a missing pattern falls back to default');
  check(design.guideLabel('classic') === 'Guide — Classic Profile', `layers label is readable, got "${design.guideLabel('classic')}"`);

  // CREATOR-09: a guide CARD is a studio-only type: it must not be renderable as
  // profile content, and the public renderer must exclude it explicitly.
  check(design.GUIDE_CARD_COMPONENT_TYPE === 'profile_guide_card', 'dedicated guide-card type');
  check(design.LEGACY_GUIDE_COMPONENT_TYPE === 'profile_guide', 'the legacy guide type is kept only for migration');
  for (const type of [design.GUIDE_CARD_COMPONENT_TYPE, design.LEGACY_GUIDE_COMPONENT_TYPE]) {
    check(!design.CONTENT_COMPONENT_TYPES.has(type), `${type} is NOT a public content component`);
    check(design.PUBLIC_RENDER_EXCLUDED_TYPES.has(type), `${type} is explicitly excluded from public rendering`);
  }
  check(design.GUIDE_SECTION_IDS.length === 8, 'the guide covers exactly the 8 real profile sections');
  for (const section of ['profile_photo', 'name', 'alias', 'bio', 'personal_info', 'gallery', 'testimonials', 'communities']) {
    check(design.GUIDE_SECTION_IDS.includes(section), `guide section "${section}" exists`);
    check(server.GUIDE_SECTIONS.has(section), `guide section "${section}" is allowed server-side`);
  }

  // The server accepts only known section ids.
  check(!server.GUIDE_SECTIONS.has('__proto__'), 'prototype keys are not sections');
  check(!server.GUIDE_SECTIONS.has('<script>'), 'markup is not a section');
});

test('pointer -> design point ignores viewer pan and divides out zoom', async () => {
  // The rect already reflects the applied pan+scale, so only zoom is divided.
  // This is what keeps "pan the viewer" from corrupting component X/Y.
  const rect = { left: 137, top: 51 };
  const pt = viewer.designPoint({ clientX: 337, clientY: 251, rect, zoom: 2 });
  check(pt.x === 100, `x = 200/2, got ${pt.x}`);
  check(pt.y === 100, `y = 200/2, got ${pt.y}`);
  const zoomed = viewer.designPoint({ clientX: 137, clientY: 51, rect, zoom: 0.5 });
  check(zoomed.x === 0 && zoomed.y === 0, 'rect origin maps to 0,0 at any zoom');
});

group('Profile Viewer Wiring (source)');

test('CREATOR-08: zoom controls exist, but no viewer SIZING controls do', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');

  // CREATOR-08 reintroduces a compact zoom bar. The CREATOR-07 ban still stands
  // for everything that resized the VIEWER or panned it by direction.
  check(src.includes('id="studio-viewer-controls"'), 'compact zoom control bar is rendered');
  check(src.includes('id="studio-zoom-in"'), 'zoom in is rendered');
  check(src.includes('id="studio-zoom-out"'), 'zoom out is rendered');
  check(src.includes('id="studio-zoom-reset"'), 'reset is rendered');
  check(src.includes('studio-zoom-readout'), 'zoom percentage readout is rendered');
  check(src.includes('zoomBy') && src.includes('resetViewerView'), 'zoom handlers are wired');

  // The old CREATOR-07 controls stay gone — none of them may return.
  check(!src.includes('data-viewer='), 'no data-viewer control attributes remain');
  check(!src.includes('fitZoom'), 'no Fit zoom helper');
  check(!src.includes('onViewerBarClick'), 'old viewer bar click handler is removed');
  for (const gone of ['data-viewer="fit"', 'data-viewer="actual"', 'pan-left', 'pan-right', 'pan-up', 'pan-down']) {
    check(!src.includes(gone), `${gone} is gone`);
  }

  // Zoom must never control viewer size, and the viewer must stay the workspace.
  check(!/zoom[^;\n]*stage\.style\.height/.test(src), 'zoom never sets the stage height');
  check(!/zoom[^;\n]*studio-col-/.test(src), 'zoom never touches the column widths');
  check(src.includes('id="studio-viewer"'), 'viewer element still rendered');
  check(src.includes('id="studio-canvas-scroll"'), 'canvas still rendered');
});

test('the workspace exposes two column resizers and one viewer height grip', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  check(src.includes('data-resize-col="left"'), 'left column resizer is rendered');
  check(src.includes('data-resize-col="right"'), 'right column resizer is rendered');
  check(src.includes('data-resize-height'), 'viewer height grip is rendered');
  // CREATOR-07A replaces the four-side viewer grips entirely.
  for (const gone of ['data-viewer-edge', 'studio-viewer-grip', 'studio-viewer-grip-corner']) {
    check(!src.includes(gone), `${gone} is gone`);
  }
  // The handles must be reachable by real pointer events.
  check(src.includes("closest('[data-resize-col]')"), 'column resizers are detected by delegation');
  check(src.includes("closest('[data-resize-height]')"), 'height grip is detected by delegation');
  check(src.includes('setPointerCapture'), 'handles capture the pointer for fast drags');
  // The column resizers live in the layout, not inside the scrollable panels.
  check(src.includes("querySelector('#studio-layout')?.addEventListener('pointerdown'"),
    'column resizers are wired on the layout container');
});

test('workspace state is kept out of the saved design layout', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  // Workspace state lives in module scope, never inside the design layout.
  check(/let\s+zoom\s*=/.test(src), 'zoom is module state');
  check(/let\s+viewerPan\s*=/.test(src), 'viewerPan is module state');
  check(/let\s+panelWidths\s*=/.test(src), 'panelWidths is module state');
  check(/let\s+viewerHeight\s*=/.test(src), 'viewerHeight is module state');
  const layoutWrites = src.match(/viewerPan\.[xy]\s*=[^=]/g) || [];
  check(layoutWrites.every(w => /^\s*viewerPan\.[xy]\s*=/.test(w)), 'viewerPan is only ever assigned directly');
  // The viewer has no width of its own any more: it always fills the column.
  check(!/viewer\.style\.width/.test(src), 'no inline width is written to the viewer');
  check(src.includes("setProperty('--studio-col-left'"), 'panel widths go to CSS custom properties');
  check(!/panelWidths[^;]*\bcomp\./.test(src), 'panel widths are never written to a component');
  check(!/viewerHeight[^;]*\bcomp\./.test(src), 'viewer height is never written to a component');

  // CREATOR-07B: the stage height is never derived from the window, and it is
  // never left unset (an unset height would let the grid row decide it).
  check(!/viewportHeight:\s*window\.innerHeight/.test(src), 'no viewport-derived viewer height');
  check(!/stage\.style\.height\s*=\s*''/.test(src), 'the stage height is never released to the layout');
  const heightWrites = src.match(/stage\.style\.height\s*=/g) || [];
  check(heightWrites.length >= 2, 'every layout branch assigns the stage height');
  check(/let\s+viewerHeight\s*=\s*DEFAULT_VIEWER_HEIGHT/.test(src),
    'the viewer height starts from the deliberate default, not null');
  // A window resize must not re-derive the viewer height.
  check(/function clampWorkspaceToWindow\(\)\s*\{[\s\S]*?applyWorkspaceState\(\);\s*\}/.test(src),
    'clampWorkspaceToWindow exists');
  const windowClamp = src.match(/function clampWorkspaceToWindow\(\)\s*\{[\s\S]*?\n\}/);
  check(windowClamp && !/viewerHeight\s*=/.test(windowClamp[0]),
    'the window resize handler never reassigns the viewer height');
  // Panning must never mark the design dirty.
  check(/const wasPan = drag\.mode === 'pan';/.test(src), 'pointer-up distinguishes a pan');
  check(/if \(wasPan\) \{[\s\S]*?return;[\s\S]*?\}\s*dirty = true;/.test(src), 'pan returns before dirty = true');
});

test('workspace resizing is not an edit', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  check(src.includes("mode: 'panel-resize'"), 'panel resize drag mode exists');
  check(src.includes("mode: 'viewer-height'"), 'viewer height drag mode exists');
  check(src.includes("if (drag.mode === 'panel-resize')"), 'pointer move handles panel resize separately');
  check(src.includes("if (drag.mode === 'viewer-height')"), 'pointer move handles height resize separately');
  // Both must bail out of the dirty/history path exactly like a pan does.
  check(/const wasWorkspaceResize = drag\.mode === 'panel-resize' \|\| drag\.mode === 'viewer-height';/.test(src),
    'pointer-up distinguishes a workspace resize');
  check(/if \(wasWorkspaceResize\) \{[\s\S]*?return;[\s\S]*?\}\s*if \(wasPan\)/.test(src),
    'workspace resize returns before dirty = true');
  // Neither start path may push history.
  check(!/startPanelResize[\s\S]{0,700}?pushHistory\(/.test(src), 'panel resize pushes no undo entry');
  check(!/startViewerHeightResize[\s\S]{0,700}?pushHistory\(/.test(src), 'height resize pushes no undo entry');
  // Neither branch may touch component geometry or history.
  for (const mode of ['panel-resize', 'viewer-height']) {
    const branch = src.match(new RegExp(`if \\(drag\\.mode === '${mode}'\\) \\{[\\s\\S]*?\\n  \\}`));
    check(!!branch, `${mode} branch found`);
    check(!/\bcomp\.(x|y|width|height|zIndex)\s*=/.test(branch ? branch[0] : ''), `${mode} writes no component geometry`);
    check(!/history\.|pushHistory\(/.test(branch ? branch[0] : ''), `${mode} touches no history`);
  }
});

test('panel resizing is disabled in the single-column layout', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  check(src.includes("matchMedia('(max-width: 960px)')"), 'single-column mode is detected at the breakpoint');
  check(/function isSingleColumn\(\)/.test(src), 'single-column helper exists');
  // Both resize entry points refuse to start when stacked.
  check(/function startPanelResize[\s\S]{0,200}?if \(!layout \|\| isSingleColumn\(\)\) return;/.test(src),
    'panel resize refuses to start when stacked');
  // CREATOR-08: the height resize measures the stage as well as the viewer,
  // because the stage is the box whose height this state owns.
  check(/function startViewerHeightResize[\s\S]{0,200}?if \(!stage \|\| !viewer \|\| isSingleColumn\(\)\) return;/.test(src),
    'height resize refuses to start when stacked');
  // And the handles are hidden rather than left dangling over the stack.
  check(src.includes('el.hidden = true'), 'handles are hidden in single-column mode');
  // CREATOR-07B: only the COLUMN widths are released to the stylesheet. The
  // viewer height is independent workspace state and is kept, so stacking is
  // never a reason to shrink the editing area.
  const singleColumn = src.match(/if \(isSingleColumn\(\)\) \{[\s\S]*?\n  \}/);
  check(!!singleColumn, 'single-column branch found');
  check(singleColumn && singleColumn[0].includes("removeProperty('--studio-col-left')"),
    'column widths are released back to the stylesheet');
  check(singleColumn && /stage\.style\.height\s*=\s*`\$\{clampViewerHeight/.test(singleColumn[0]),
    'the viewer keeps its own height in single-column mode');
  check(singleColumn && !/stage\.style\.height\s*=\s*''/.test(singleColumn[0]),
    'the stage height is never released to the layout');
});

test('empty-canvas drag pans the viewer and component drag still moves components', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  check(src.includes("mode: 'pan'"), 'pan drag mode exists');
  check(src.includes("startPan(event)"), 'empty canvas starts a pan');
  check(src.includes("if (drag.mode === 'pan')"), 'pointer move handles pan separately');
  check(src.includes('startMove(comp, event)'), 'component drag still starts a move');
  // Pan must be measured in screen pixels, not design pixels.
  check(src.includes('pointerClientX') && src.includes('pointerClientY'), 'pan tracks client coords');
});

test('arrow keys move the selected component and pan the viewer otherwise', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  check(src.includes('event.shiftKey ? 10 : 1'), 'Shift+Arrow moves by 10');
  check(src.includes('comp.x + arrows'), 'arrows adjust component x');
  check(src.includes("viewerArrows[event.key]"), 'arrows fall through to viewer pan');
  check(src.includes("panViewer(viewerArrows[event.key])"), 'unselected arrows pan the viewer');
  // Typing must never be hijacked.
  check(src.includes("target.closest('input, textarea, select')"), 'text inputs are excluded');
});

group('Creator Studio Layout');

test('lower Layers panel is compact and the viewer keeps the space', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(resolve('web/css/creatorStudio.css'), 'utf8');
  check(/#studio-layers\.studio-panel\s*\{[^}]*min-height:\s*0/.test(css), 'layers panel drops the 480px minimum');
  check(/#studio-layers-list\s*\{[^}]*overflow-y:\s*auto/.test(css), 'layers list scrolls');
  check(/#studio-layers-list\s*\{[^}]*max-height:\s*1\d\dpx/.test(css), 'layers list is height-capped');
  // Side editor panels keep their useful editing height.
  check(/\.studio-panel\s*\{[^}]*min-height:\s*480px/.test(css), 'side panels keep 480px editing height');
  // The viewer takes the flexible majority.
  check(/#studio-canvas-scroll\s*\{[^}]*flex:\s*1 1 auto/.test(css), 'viewer grows to fill the stage');
});

test('the viewer fills the workspace and shows no scrollbars', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(resolve('web/css/creatorStudio.css'), 'utf8');
  // CREATOR-08: the viewer fills the stage below the compact zoom bar. It is a
  // flex item rather than an absolute overlay, so the bar can never cover the
  // profile canvas.
  check(/#studio-viewer\s*\{[^}]*position:\s*relative/.test(css), 'viewer is the stage positioning context');
  check(/#studio-viewer\s*\{[^}]*flex:\s*1 1 auto/.test(css), 'viewer fills the stage below the zoom bar');
  check(/#studio-viewer-controls\s*\{[^}]*flex:\s*0 0 auto/.test(css), 'the zoom bar does not grow into the viewer');
  check(/#studio-stage\s*\{[^}]*position:\s*relative/.test(css), 'stage is the viewer positioning context');
  // No scrollbars, and none merely hidden behind a styling trick.
  const scroll = css.match(/#studio-canvas-scroll\s*\{[^}]*\}/);
  check(!!scroll, 'canvas rule found');
  check(/overflow:\s*hidden/.test(scroll ? scroll[0] : ''), 'viewer clips instead of scrolling');
  // No scroll container anywhere inside the viewer box itself. (The side editor
  // panels and the Layers list scroll on purpose; the viewer must not.)
  for (const rule of css.match(/#studio-(?:stage|viewer|canvas-scroll|canvas-inner|zoom-layer|canvas-document)[^{]*\{[^}]*\}/g) || []) {
    check(!/overflow(-[xy])?:\s*(auto|scroll)/.test(rule), `no scroll container in ${rule.split('{')[0].trim()}`);
  }
  // The inner canvas fills the viewer so the whole box is grabbable empty canvas.
  check(/#studio-canvas-inner\s*\{[^}]*min-height:\s*100%/.test(css), 'inner canvas fills the viewer height');

  // The side columns are driven by custom properties, and the layout is the
  // positioning context for the boundary handles.
  check(/\.studio-layout\s*\{[^}]*position:\s*relative/.test(css), 'layout is the resizer positioning context');
  check(/\.studio-layout\s*\{[^}]*grid-template-columns:\s*var\(--studio-col-left/.test(css),
    'grid columns are driven by --studio-col-left/right');
  check(css.includes('var(--studio-col-right'), 'the right column uses --studio-col-right');

  // CREATOR-07B: the decoupling itself, asserted on the stylesheet. If the grid
  // ever goes back to `stretch`, or the stage loses its own height, the side
  // panels' height becomes the Profile Viewer's height again.
  const layoutRule = css.match(/\.studio-layout\s*\{[^}]*\}/);
  check(/align-items:\s*start/.test(layoutRule ? layoutRule[0] : ''),
    'the grid does not stretch, so panel height cannot become viewer height');
  const stageRule = css.match(/#studio-stage\s*\{[^}]*\}/);
  check(!!stageRule, 'stage rule found');
  check(/height:\s*\d+px/.test(stageRule ? stageRule[0] : ''), 'the stage declares its own height');
  // The panels scroll internally rather than growing the row.
  const panelRule = css.match(/\.studio-panel\s*\{[^}]*\}/);
  check(/overflow:\s*auto/.test(panelRule ? panelRule[0] : ''), 'side panels scroll internally');
  check(!/max-height:\s*calc\(100vh/.test(panelRule ? panelRule[0] : ''),
    'panel height is not tied to the window height');
  // The viewer keeps no width of its own (min-width is fine; an explicit
  // width would fight the center column).
  const viewerRule = css.match(/#studio-viewer\s*\{[^}]*\}/);
  check(!!viewerRule, 'viewer rule found');
  check(!/(?<!min-)width:/.test(viewerRule ? viewerRule[0] : ''), 'no explicit width on the viewer');

  // Cursor contract: column boundaries are ew-resize, the viewer bottom is ns-resize.
  const colRule = css.match(/\.studio-col-resizer\s*\{[^}]*\}/);
  check(!!colRule, 'column resizer rule found');
  check(/cursor:\s*ew-resize/.test(colRule ? colRule[0] : ''), 'column boundary uses ew-resize');
  const gripRule = css.match(/\.studio-viewer-height-grip\s*\{[^}]*\}/);
  check(!!gripRule, 'viewer height grip rule found');
  check(/cursor:\s*ns-resize/.test(gripRule ? gripRule[0] : ''), 'viewer bottom boundary uses ns-resize');
  // A generous, invisible hit area — not a 1px target.
  check(/width:\s*1?\dpx/.test(colRule ? colRule[0] : ''), 'column resizer has a grabbable width');
  check(/height:\s*1?\dpx/.test(gripRule ? gripRule[0] : ''), 'height grip has a grabbable height');
  const colRuleText = colRule ? colRule[0] : '';
  const gripRuleText = gripRule ? gripRule[0] : '';
  check(parseInt(colRuleText.match(/width:\s*(\d+)px/)?.[1] || '0', 10) >= 8, 'column hit area is at least 8px');
  check(parseInt(gripRuleText.match(/height:\s*(\d+)px/)?.[1] || '0', 10) >= 8, 'height hit area is at least 8px');
  // No visible resize affordance: both handles stay transparent.
  check(/background:\s*transparent/.test(colRule ? colRule[0] : ''), 'column resizer is invisible');
  check(/background:\s*transparent/.test(gripRule ? gripRule[0] : ''), 'height grip is invisible');
  // Both handles must stack above panel content and the canvas.
  check(/z-index:\s*4\d/.test(colRule ? colRule[0] : ''), 'column resizer stacks above the panels');
  check(/z-index:\s*\d/.test(gripRule ? gripRule[0] : ''), 'height grip stacks above the canvas');

  // The removed toolbar and four-side grips leave no CSS behind.
  for (const gone of ['.studio-viewer-bar', '.studio-viewer-btn', '.studio-viewer-grip', 'data-viewer-edge']) {
    check(!css.includes(gone), `${gone} CSS removed`);
  }
  // Single-column mode drops the custom properties and hides the handles.
  check(/@media \(max-width: 960px\)[\s\S]*?grid-template-columns:\s*1fr/.test(css),
    'single column does not use the side-column properties');
});

// ── Teardown ─────────────────────────────────────────────────────────────
queue.push(async () => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); process.stdout.write('  [cleanup] temp dir removed\n'); } catch {}
});

for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
process.stdout.write('\n');
process.stdout.write('Studio media/nav tests: ' + (total - failed.length) + '/' + total + ' passed\n');
if (failed.length) {
  process.stdout.write('FAILURES:\n');
  for (const f of failed) {
    process.stdout.write('  ✗ ' + f.name + '\n    ' + (f.error?.message || f.error) + '\n');
  }
}

database.closeDatabase();
if (process.env.KEEP_TEST_DIR !== '1') {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
}

process.exit(failed.length ? 1 : 0);
