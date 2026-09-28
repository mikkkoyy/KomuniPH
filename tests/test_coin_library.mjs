/**
 * CREATOR-04 — Coin Shop buyer library test suite.
 *
 * Run:   npm run test:coin-library
 *
 * Covers:
 *   - purchase history auth + empty library
 *   - purchased asset appears with metadata + creator identity
 *   - cross-user ownership isolation
 *   - public creator product remains accessible
 *   - install authorization (owned profile_design installs to buyer draft)
 *   - install without purchase rejected
 *   - unsupported asset type install rejected (no fabricated behavior)
 *   - creator original asset untouched by install
 *   - invalid asset install behavior
 *   - creator cannot read buyer-only ownership as buyer
 *
 * Throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-library-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-library.db');
process.env.PORT = String(19900 + (process.pid % 1000));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-04-test-webhook-secret';
process.env.SECRET_KEY = 'creator-04-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'library-admin';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ── Imports ────────────────────────────────────────────────────────────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const auth = await import(mod('server/auth.js'));
await import(mod('server/index.js')); // boots the HTTP server
await database.seedAdminUser();

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

// ── HTTP helper ────────────────────────────────────────────────────────────
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

// ── Fixtures ───────────────────────────────────────────────────────────────
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

function designSnapshot() {
  return {
    layout: {
      canvas: { width: 960, minHeight: 1200 },
      components: [
        { id: 'c-head', type: 'text', x: 40, y: 40, width: 320, height: 96, zIndex: 1, visible: true, locked: false, rotation: 0, style: { background: '#0e6e6e', textColor: '#ffffff' }, config: { text: 'Hello world', fontSize: 24, textAlign: 'left' } },
      ],
    },
    theme: { backgroundColor: '#0f172a', textColor: '#e6eaf2', accentColor: '#14b8a6' },
  };
}

async function createAsset(creatorToken, { name, asset_type, asset_data, price_coins }) {
  const res = await api('POST', '/api/creator/assets', { token: creatorToken, body: { name, description: `${name} desc`, asset_type, asset_data, price_coins } });
  check(res.status === 201, `create asset: ${res.status}: ${JSON.stringify(res.data)}`);
  const id = res.data.asset.id;
  const sub = await api('POST', `/api/creator/assets/${id}/submit`, { token: creatorToken });
  check(sub.status === 200, `submit asset: ${sub.status}`);
  const pub = await api('POST', `/api/creator/assets/${id}/publish`, { token: creatorToken });
  check(pub.status === 200, `publish asset: ${pub.status}`);
  return id;
}

async function buyAsset(buyerId, assetId, coins = 500) {
  database.execute('INSERT OR IGNORE INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 0, 0)', [buyerId]);
  database.execute('UPDATE user_wallets SET balance = ? WHERE user_id = ?', [coins, buyerId]);
  const res = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyerId) });
  check(res.status === 200, `buy: ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data.purchase;
}

// ═══════════════════════════════════════════════════════════════════════════
group('Library');

test('purchases require authentication', async () => {
  const res = await api('GET', '/api/coin-shop/purchases');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('empty library', async () => {
  const buyer = createUserWithProfile('lib-empty');
  const res = await api('GET', '/api/coin-shop/purchases', { token: tokenFor(buyer.id) });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(Array.isArray(res.data.purchases) && res.data.purchases.length === 0, 'expected empty purchases');
});

test('purchased asset appears with metadata + creator identity', async () => {
  const creator = createUserWithProfile('lib-creator');
  const assetId = await createAsset(tokenFor(creator.id), { name: 'Library Design', asset_type: 'profile_design', asset_data: designSnapshot(), price_coins: 60 });
  const buyer = createUserWithProfile('lib-buyer');
  await buyAsset(buyer.id, assetId);
  const res = await api('GET', '/api/coin-shop/purchases', { token: tokenFor(buyer.id) });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.purchases.length === 1, 'expected 1 purchase');
  const p = res.data.purchases[0];
  check(p.asset_id === assetId, 'expected asset id');
  check(p.asset_name === 'Library Design', 'expected asset name');
  check(p.price_coins === 60, 'expected purchase price');
  check(typeof p.purchased_at === 'string', 'expected purchase date');
  check(p.asset_type === 'profile_design', 'expected asset type');
  // Creator identity resolves through the public product record.
  const product = await api('GET', `/api/coin-shop/products/${assetId}`);
  check(product.status === 200, `expected 200, got ${product.status}`);
  check(product.data.product.creator_user_id === creator.id, 'expected creator identity');
  check(product.data.product.creator_username === creator.username, 'expected creator username');
});

test('cross-user ownership isolation', async () => {
  const creator = createUserWithProfile('lib-iso-creator');
  const assetId = await createAsset(tokenFor(creator.id), { name: 'Iso Design', asset_type: 'profile_design', asset_data: designSnapshot(), price_coins: 10 });
  const buyerA = createUserWithProfile('lib-iso-a');
  const buyerB = createUserWithProfile('lib-iso-b');
  await buyAsset(buyerA.id, assetId);
  const resB = await api('GET', '/api/coin-shop/purchases', { token: tokenFor(buyerB.id) });
  check(resB.data.purchases.length === 0, 'buyer B must not see buyer A purchases');
  const checkB = await api('GET', `/api/coin-shop/purchased/${assetId}`, { token: tokenFor(buyerB.id) });
  check(checkB.data.purchased === false, 'expected purchased=false for non-owner');
  const checkA = await api('GET', `/api/coin-shop/purchased/${assetId}`, { token: tokenFor(buyerA.id) });
  check(checkA.data.purchased === true, 'expected purchased=true for owner');
});

test('creator sees only own buyer records (none)', async () => {
  const creator = createUserWithProfile('lib-creatoronly');
  const assetId = await createAsset(tokenFor(creator.id), { name: 'Creator Only', asset_type: 'profile_design', asset_data: designSnapshot(), price_coins: 10 });
  const buyer = createUserWithProfile('lib-creatoronly-b');
  await buyAsset(buyer.id, assetId);
  const res = await api('GET', '/api/coin-shop/purchases', { token: tokenFor(creator.id) });
  check(res.data.purchases.length === 0, 'creator must not read buyer ownership as buyer');
});

test('public creator product remains accessible', async () => {
  const creator = createUserWithProfile('lib-public');
  const assetId = await createAsset(tokenFor(creator.id), { name: 'Public Asset', asset_type: 'sticker', asset_data: { imageUrl: 'https://example.com/s.png', fit: 'cover' }, price_coins: 5 });
  const res = await api('GET', `/api/coin-shop/products/${assetId}`);
  check(res.status === 200, `expected 200 public, got ${res.status}`);
});

// ═══════════════════════════════════════════════════════════════════════════
group('Install');

test('owned profile_design installs to buyer draft design', async () => {
  const creator = createUserWithProfile('lib-inst-creator');
  const assetId = await createAsset(tokenFor(creator.id), { name: 'Installable', asset_type: 'profile_design', asset_data: designSnapshot(), price_coins: 25 });
  const buyer = createUserWithProfile('lib-inst-buyer');
  await buyAsset(buyer.id, assetId);
  const res = await api('POST', `/api/coin-shop/install/${assetId}`, { token: tokenFor(buyer.id) });
  check(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
  check(res.data.asset_id === assetId, 'expected asset id');
  check(res.data.design.status === 'draft', 'expected buyer-owned draft');
  // Buyer design state exists through the existing profile-design API.
  const designs = await api('GET', '/api/profile/design', { token: tokenFor(buyer.id) });
  check(designs.status === 200, `expected 200, got ${designs.status}`);
  const installed = (designs.data.designs || []).find(d => d.id === res.data.design.id);
  check(installed !== undefined, 'installed design must appear in buyer designs');
  check(installed.layout.components.length === 1, 'installed layout must carry the snapshot');
});

test('install without purchase is rejected', async () => {
  const creator = createUserWithProfile('lib-nopurch-creator');
  const assetId = await createAsset(tokenFor(creator.id), { name: 'No Purchase', asset_type: 'profile_design', asset_data: designSnapshot(), price_coins: 25 });
  const stranger = createUserWithProfile('lib-nopurch-stranger');
  const res = await api('POST', `/api/coin-shop/install/${assetId}`, { token: tokenFor(stranger.id) });
  check(res.status === 403, `expected 403, got ${res.status}`);
});

test('install requires authentication', async () => {
  const res = await api('POST', '/api/coin-shop/install/some-id');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('unsupported asset type install rejected without fabrication', async () => {
  const creator = createUserWithProfile('lib-unsup-creator');
  const assetId = await createAsset(tokenFor(creator.id), { name: 'Sticker', asset_type: 'sticker', asset_data: { imageUrl: 'https://example.com/s.png', fit: 'cover' }, price_coins: 5 });
  const buyer = createUserWithProfile('lib-unsup-buyer');
  await buyAsset(buyer.id, assetId);
  const res = await api('POST', `/api/coin-shop/install/${assetId}`, { token: tokenFor(buyer.id) });
  check(res.status === 422, `expected 422, got ${res.status}`);
  // Library still shows it with metadata.
  const lib = await api('GET', '/api/coin-shop/purchases', { token: tokenFor(buyer.id) });
  check(lib.data.purchases.some(p => p.asset_id === assetId), 'asset must remain listed in library');
});

test('creator original asset untouched by install', async () => {
  const creator = createUserWithProfile('lib-untouched-creator');
  const cToken = tokenFor(creator.id);
  const assetId = await createAsset(cToken, { name: 'Untouched', asset_type: 'profile_design', asset_data: designSnapshot(), price_coins: 25 });
  const before = await api('GET', `/api/creator/assets/${assetId}`, { token: cToken });
  const buyer = createUserWithProfile('lib-untouched-buyer');
  await buyAsset(buyer.id, assetId);
  await api('POST', `/api/coin-shop/install/${assetId}`, { token: tokenFor(buyer.id) });
  const after = await api('GET', `/api/creator/assets/${assetId}`, { token: cToken });
  check(after.status === 200, `expected 200, got ${after.status}`);
  check(JSON.stringify(after.data.asset.asset_data) === JSON.stringify(before.data.asset.asset_data), 'creator snapshot must be unchanged');
  check(after.data.asset.status === 'published', 'creator asset must stay published');
});

test('install of missing asset is rejected', async () => {
  const buyer = createUserWithProfile('lib-missing-buyer');
  const res = await api('POST', '/api/coin-shop/install/00000000-0000-0000-0000-000000000000', { token: tokenFor(buyer.id) });
  check(res.status === 403 || res.status === 404, `expected 403/404, got ${res.status}`);
});

test('message creator target resolves to actual creator', async () => {
  const creator = createUserWithProfile('lib-msg-creator');
  const assetId = await createAsset(tokenFor(creator.id), { name: 'Msg Asset', asset_type: 'theme', asset_data: { theme: null }, price_coins: 5 });
  const buyer = createUserWithProfile('lib-msg-buyer');
  const product = await api('GET', `/api/coin-shop/products/${assetId}`);
  check(product.data.product.creator_user_id === creator.id, 'recipient must be the actual creator');
  const conv = await api('POST', '/api/messages/conversations', { token: tokenFor(buyer.id), body: { user_id: product.data.product.creator_user_id } });
  check(conv.status === 201, `expected 201, got ${conv.status}`);
});

// ── Teardown ─────────────────────────────────────────────────────────────
queue.push(async () => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); process.stdout.write('  [cleanup] temp dir removed\n'); } catch {}
});

for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
process.stdout.write('\n');
process.stdout.write('Coin library tests: ' + (total - failed.length) + '/' + total + ' passed\n');
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
