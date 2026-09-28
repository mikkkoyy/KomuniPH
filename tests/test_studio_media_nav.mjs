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
