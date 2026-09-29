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

test('viewer box is clamped to the minimum and to the available space', async () => {
  const min = viewer.clampViewerRect({ width: 10, height: 10 });
  check(min.width === viewer.MIN_VIEWER_WIDTH, `width floors at the minimum, got ${min.width}`);
  check(min.height === viewer.MIN_VIEWER_HEIGHT, `height floors at the minimum, got ${min.height}`);
  // Never larger than the stage, so resizing cannot create a scrollbar.
  const capped = viewer.clampViewerRect({ width: 99999, height: 99999 }, { boundsWidth: 800, boundsHeight: 600 });
  check(capped.width === 800 && capped.height === 600, `capped to the workspace, got ${capped.width}x${capped.height}`);
  // When the stage is smaller than the minimum, the minimum still wins.
  const tiny = viewer.clampViewerRect({ width: 9999, height: 9999 }, { boundsWidth: 100, boundsHeight: 100 });
  check(tiny.width === viewer.MIN_VIEWER_WIDTH, 'minimum outranks a tiny stage');
  // The box is always fully inside the stage, so it can never overflow.
  const inside = viewer.clampViewerRect({ x: -500, y: -500, width: 400, height: 300 }, { boundsWidth: 800, boundsHeight: 600 });
  check(inside.x === 0 && inside.y === 0, 'a negative origin is pulled back to the stage');
  const far = viewer.clampViewerRect({ x: 9999, y: 9999, width: 400, height: 300 }, { boundsWidth: 800, boundsHeight: 600 });
  check(far.x === 400 && far.y === 300, `origin clamped so the box stays in bounds, got ${far.x},${far.y}`);
  check(far.x + far.width <= 800 && far.y + far.height <= 600, 'clamped box stays inside the stage');
  // A box below the minimum is grown first, so the origin bound accounts for it.
  const grown = viewer.clampViewerRect({ x: 9999, y: 0, width: 300, height: 300 }, { boundsWidth: 800, boundsHeight: 600 });
  check(grown.width === viewer.MIN_VIEWER_WIDTH, 'below-minimum width is grown');
  check(grown.x === 800 - viewer.MIN_VIEWER_WIDTH, `origin bound uses the enforced width, got ${grown.x}`);
  check(viewer.clampViewerRect({ width: NaN, height: NaN }).width === viewer.MIN_VIEWER_WIDTH, 'NaN is safe');
  check(viewer.clampViewerRect({ width: 640.4, height: 480.6 }).width === 640, 'sizes round to whole px');
});

test('dragging an edge moves that edge and leaves the opposite one alone', async () => {
  // Start inset from the stage origin so the west/north edges have room to move.
  const startRect = { x: 200, y: 200, width: 800, height: 600 };
  const base = { startRect, startClientX: 500, startClientY: 400, clientX: 500, clientY: 400 };
  const bounds = { boundsWidth: 1600, boundsHeight: 1200 };

  // East edge: the right boundary follows the pointer, the left stays put.
  const right = viewer.viewerRectFromDrag({ ...base, ...bounds, mode: 'e', clientX: 560 });
  check(right.width === 860, `right edge grows the width, got ${right.width}`);
  check(right.x === 200, 'right edge leaves the left edge alone');
  check(right.height === 600 && right.y === 200, 'right edge leaves the height alone');

  // West edge: the left boundary follows the pointer, the right stays put.
  const left = viewer.viewerRectFromDrag({ ...base, ...bounds, mode: 'w', clientX: 440 });
  check(left.x === 140, `left edge origin follows the pointer, got ${left.x}`);
  check(left.width === 860, `left edge grows the width, got ${left.width}`);
  check(left.x + left.width === 1000, 'left edge keeps the right edge anchored');

  const bottom = viewer.viewerRectFromDrag({ ...base, ...bounds, mode: 's', clientY: 470 });
  check(bottom.height === 670, `bottom edge grows the height, got ${bottom.height}`);
  check(bottom.width === 800, 'bottom edge leaves the width alone');
  const top = viewer.viewerRectFromDrag({ ...base, ...bounds, mode: 'n', clientY: 360 });
  check(top.y === 160 && top.height === 640, `top edge origin and height, got ${top.y},${top.height}`);
  check(top.y + top.height === 800, 'top edge keeps the bottom edge anchored');

  // A corner changes both axes at once.
  const corner = viewer.viewerRectFromDrag({ ...base, ...bounds, mode: 'se', clientX: 540, clientY: 450 });
  check(corner.width === 840 && corner.height === 650, `corner changes both axes, got ${corner.width}x${corner.height}`);
  check(corner.x === 200 && corner.y === 200, 'se corner keeps the top-left anchored');
  const nw = viewer.viewerRectFromDrag({ ...base, ...bounds, mode: 'nw', clientX: 560, clientY: 430 });
  check(nw.width === 740 && nw.height === 570, `nw corner shrinks both axes, got ${nw.width}x${nw.height}`);
  check(nw.x === 260 && nw.y === 230, `nw corner moves the origin with the pointer, got ${nw.x},${nw.y}`);
  check(nw.x + nw.width === 1000 && nw.y + nw.height === 800, 'nw corner anchors the opposite corner');
});

test('a resize drag cannot shrink past the minimum or grow past the stage', async () => {
  const startRect = { x: 0, y: 0, width: 400, height: 400 };
  const base = { startRect, startClientX: 500, startClientY: 400, clientX: 500, clientY: 400 };
  const collapsed = viewer.viewerRectFromDrag({ ...base, mode: 'se', clientX: 0, clientY: 0, boundsWidth: 1600, boundsHeight: 1200 });
  check(collapsed.width === viewer.MIN_VIEWER_WIDTH, `width floors, got ${collapsed.width}`);
  check(collapsed.height === viewer.MIN_VIEWER_HEIGHT, `height floors, got ${collapsed.height}`);
  const overflow = viewer.viewerRectFromDrag({ ...base, mode: 'se', clientX: 99999, clientY: 99999, boundsWidth: 900, boundsHeight: 700 });
  check(overflow.width === 900 && overflow.height === 700, `capped at the stage, got ${overflow.width}x${overflow.height}`);
  // Pushing the west edge out of the stage stops at the origin instead of going negative.
  const out = viewer.viewerRectFromDrag({ ...base, mode: 'w', clientX: -99999, boundsWidth: 800, boundsHeight: 600 });
  check(out.x === 0, `west edge cannot leave the stage, got x=${out.x}`);
  check(out.width <= 800, 'west edge cannot outgrow the stage');
  // An unknown mode must not produce NaN geometry.
  const unknown = viewer.viewerRectFromDrag({ ...base, mode: '', clientX: 600, clientY: 500, boundsWidth: 800, boundsHeight: 600 });
  check(Number.isFinite(unknown.width) && Number.isFinite(unknown.height), 'unknown edge stays finite');
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

test('the Profile Viewer control bar is gone, with no replacement', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  check(!src.includes('studio-viewer-bar'), 'viewer bar markup is removed');
  check(!src.includes('data-viewer='), 'no data-viewer control attributes remain');
  check(!src.includes('studio-zoom-readout'), 'zoom percentage readout is removed');
  check(!src.includes('onViewerBarClick'), 'viewer bar click handler is removed');
  check(!src.includes('stepZoom') && !src.includes('fitZoom') && !src.includes('zoomPercent'), 'toolbar-only helpers are no longer used');
  // No zoom / fit / 100% / directional pan button may exist anywhere.
  for (const gone of ['zoom-in', 'zoom-out', 'data-viewer="fit"', 'data-viewer="actual"', 'pan-left', 'pan-right', 'pan-up', 'pan-down']) {
    check(!src.includes(gone), `${gone} is gone`);
  }
  // The viewer itself remains.
  check(src.includes('id="studio-viewer"'), 'viewer element still rendered');
  check(src.includes('id="studio-canvas-scroll"'), 'canvas still rendered');
});

test('the viewer exposes four edge grips and four corner grips', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  for (const edge of ['n', 's', 'w', 'e']) {
    check(src.includes(`data-viewer-edge="${edge}"`), `${edge} edge grip is rendered`);
  }
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    check(src.includes(`data-viewer-edge="${corner}"`), `${corner} corner grip is rendered`);
  }
  check(src.includes('studio-viewer-grip'), 'grips carry the grip class');
  // A grip is not inside the canvas, so a viewer drag can never become a
  // component drag and vice versa.
  check(src.includes("closest('[data-viewer-edge]')"), 'grips are detected by delegation');
  check(src.includes('startViewerResize(grip.dataset.viewerEdge, event)'), 'grip drag starts a viewer resize');
});

test('viewer state is kept out of the saved design layout', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  // Viewer coordinates live in module state, never inside layout.
  check(/let\s+zoom\s*=/.test(src), 'zoom is module state');
  check(/let\s+viewerPan\s*=/.test(src), 'viewerPan is module state');
  check(/let\s+viewerSize\s*=/.test(src), 'viewerSize is module state');
  const layoutWrites = src.match(/viewerPan\.[xy]\s*=[^=]/g) || [];
  check(layoutWrites.every(w => /^\s*viewerPan\.[xy]\s*=/.test(w)), 'viewerPan is only ever assigned directly');
  // Viewer size is applied to the element, never to the design payload.
  check(src.includes('viewer.style.width'), 'viewer size is applied to the DOM');
  check(!/viewerSize[^;]*\bcomp\./.test(src), 'viewer size is never written to a component');
  // Panning must never mark the design dirty.
  check(/const wasPan = drag\.mode === 'pan';/.test(src), 'pointer-up distinguishes a pan');
  check(/if \(wasPan\) \{[\s\S]*?return;[\s\S]*?\}\s*dirty = true;/.test(src), 'pan returns before dirty = true');
});

test('resizing the viewer is not an edit', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve('web/js/creatorStudio.js'), 'utf8');
  check(src.includes("mode: 'viewer-resize'"), 'viewer resize drag mode exists');
  check(src.includes('if (drag.mode === \'viewer-resize\')'), 'pointer move handles the resize separately');
  // It must bail out of the dirty/history path exactly like a pan does.
  check(/const wasViewerResize = drag\.mode === 'viewer-resize';/.test(src), 'pointer-up distinguishes a viewer resize');
  check(/if \(wasViewerResize\) \{[\s\S]*?return;[\s\S]*?\}\s*if \(wasPan\)/.test(src), 'resize returns before dirty = true');
  // No history entry is pushed for a viewer resize.
  check(!/startViewerResize[\s\S]{0,400}?pushHistory\(/.test(src), 'resizing pushes no undo entry');
  // The resize branch must not reference component geometry at all.
  const branch = src.match(/if \(drag\.mode === 'viewer-resize'\) \{[\s\S]*?\n  \}/);
  check(!!branch, 'resize branch found');
  check(!/\bcomp\.(x|y|width|height|zIndex)\s*=/.test(branch ? branch[0] : ''), 'resize writes no component geometry');
  check(!/history\.|pushHistory\(/.test(branch ? branch[0] : ''), 'resize touches no history');
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
  // Full available area: the viewer box fills the stage on both axes.
  check(/#studio-viewer\s*\{[^}]*inset:\s*0/.test(css), 'viewer fills the stage by default');
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
  // Cursor contract for each grip: the first cursor declared in the rule that
  // owns the edge selector is the one that applies to it.
  const cursorFor = (edge) => {
    const at = css.indexOf(`data-viewer-edge="${edge}"`);
    if (at < 0) return null;
    const forward = css.slice(at, at + 400);
    const end = forward.indexOf('}');
    return (forward.slice(0, end < 0 ? undefined : end).match(/cursor:\s*([a-z-]+)/) || [])[1] || null;
  };
  for (const [edge, cursor] of [['n', 'ns-resize'], ['s', 'ns-resize'], ['w', 'ew-resize'], ['e', 'ew-resize'],
                                ['nw', 'nwse-resize'], ['se', 'nwse-resize'], ['ne', 'nesw-resize'], ['sw', 'nesw-resize']]) {
    check(cursorFor(edge) === cursor, `${edge} grip uses ${cursor}, got ${cursorFor(edge)}`);
  }
  // No visible resize affordance: the grips stay unstyled boxes.
  check(!/\.studio-viewer-grip\s*\{[^}]*background:\s*(?!none)/.test(css), 'grips have no visible fill');
  check(!/\.studio-viewer-grip\s*\{[^}]*border:\s*(?!0|none)/.test(css), 'grips have no visible border');
  // The removed toolbar leaves no CSS behind.
  check(!css.includes('.studio-viewer-bar'), 'viewer bar CSS removed');
  check(!css.includes('.studio-viewer-btn'), 'viewer button CSS removed');
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
