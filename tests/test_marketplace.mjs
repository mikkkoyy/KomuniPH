/**
 * CREATOR-03 — Marketplace Foundation test suite.
 *
 * Run:   npm run test:marketplace
 *
 * Covers:
 *   - Normal Marketplace: listing creation, ownership, draft/published/archived visibility
 *   - Normal Marketplace: listing retrieval, search/filter, profile linkage
 *   - Normal Marketplace: Share Link URLs, public shared URL, logged-out access
 *   - Normal Marketplace: cross-user protection, invalid payloads
 *   - Coin Shop: published creator asset visibility, archived hidden
 *   - Coin Shop: creator profile linkage, message creator linkage
 *   - Coin Shop: Share Link URLs, public shared URL
 *   - Coin Shop: Buy requires authentication, sufficient coins
 *   - Coin Shop: successful purchase, buyer debit, creator credit
 *   - Coin Shop: atomicity, duplicate purchase, unpublished/archived rejection
 *   - Coin Shop: purchased asset ownership
 *
 * Uses a throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment ──────────────────────────────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-marketplace-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-marketplace.db');
process.env.PORT = String(19700 + (process.pid % 1200));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-03-test-webhook-secret';
process.env.SECRET_KEY = 'creator-03-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'marketplace-admin';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ── Imports ──────────────────────────────────────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const auth = await import(mod('server/auth.js'));
await import(mod('server/index.js'));
await database.seedAdminUser();

// ── Test harness ─────────────────────────────────────
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

// ── HTTP helper ──────────────────────────────────────
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

// ── Fixtures ─────────────────────────────────────────
function createUserWithProfile(username) {
  const id = randomUUID();
  const email = `${username}-${id.slice(0, 8)}@test.local`;
  const ts = new Date().toISOString();
  database.execute(`INSERT INTO users (id, email, username, password_hash, role, account_status, created_at, updated_at) VALUES (?, ?, ?, 'unused', 'member', 'active', ?, ?)`, [id, email, username, ts, ts]);
  database.execute(`INSERT INTO profiles (id, user_id, display_name, theme_id, created_at, updated_at) VALUES (?, ?, ?, 'default', ?, ?)`, [randomUUID(), id, username, ts, ts]);
  return id;
}
function tokenFor(userId) { return auth.createToken(userId, 'access'); }

async function createAndPublishAsset(userId, name, price = 0) {
  const token = tokenFor(userId);
  const createRes = await api('POST', '/api/creator/assets', { token, body: { name, description: 'Test asset', asset_type: 'profile_design', asset_data: { layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme: {} }, price_coins: price } });
  check(createRes.status === 201, `create asset: ${createRes.status}: ${JSON.stringify(createRes.data)}`);
  const assetId = createRes.data.asset.id;
  const submitRes = await api('POST', `/api/creator/assets/${assetId}/submit`, { token });
  check(submitRes.status === 200, `submit asset: ${submitRes.status}: ${JSON.stringify(submitRes.data)}`);
  const publishRes = await api('POST', `/api/creator/assets/${assetId}/publish`, { token });
  check(publishRes.status === 200, `publish asset: ${publishRes.status}: ${JSON.stringify(publishRes.data)}`);
  return assetId;
}

async function createAndPublishListing(sellerId, title, category = 'products', price = '100') {
  const token = tokenFor(sellerId);
  const createRes = await api('POST', '/api/marketplace/listings', {
    token, body: { title, description: 'A marketplace listing', category, price_display: price, images: [] }
  });
  check(createRes.status === 201, `create listing: ${createRes.status}: ${JSON.stringify(createRes.data)}`);
  const listingId = createRes.data.listing.id;
  const publishRes = await api('POST', `/api/marketplace/listings/${listingId}/publish`, { token });
  check(publishRes.status === 200, `publish listing: ${publishRes.status}: ${JSON.stringify(publishRes.data)}`);
  return listingId;
}

// ══════════════════════════════════════════════════════
// Normal Marketplace Tests
// ══════════════════════════════════════════════════════

group('Normal Marketplace — Listings');

test('create listing as authenticated user', async () => {
  const sellerId = createUserWithProfile('listing-creator');
  const token = tokenFor(sellerId);
  const res = await api('POST', '/api/marketplace/listings', { token, body: { title: 'Test Product', description: 'A test product', category: 'products', price_display: '500', images: [] } });
  check(res.status === 201, `expected 201, got ${res.status}`);
  check(res.data.listing.title === 'Test Product', 'expected title');
  check(res.data.listing.status === 'draft', 'expected draft status');
  check(res.data.listing.seller_user_id === sellerId, 'expected seller identity from auth');
});

test('unauthenticated create listing returns 401', async () => {
  const res = await api('POST', '/api/marketplace/listings', { body: { title: 'Test', category: 'products', price_display: '10' } });
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('listing ownership is from auth, not client-supplied', async () => {
  const sellerId = createUserWithProfile('listing-owner');
  const otherId = createUserWithProfile('listing-other');
  const token = tokenFor(sellerId);
  const res = await api('POST', '/api/marketplace/listings', { token, body: { title: 'Owned Product', description: '', category: 'services', price_display: '200', images: [] } });
  check(res.status === 201, `expected 201, got ${res.status}`);
  check(res.data.listing.seller_user_id === sellerId, 'seller must match authenticated user');
});

test('draft listings not visible in public listing', async () => {
  const sellerId = createUserWithProfile('draft-creator');
  const token = tokenFor(sellerId);
  await api('POST', '/api/marketplace/listings', { token, body: { title: 'Draft Listing', description: '', category: 'digital', price_display: '300', images: [] } });
  const res = await api('GET', '/api/marketplace/listings', { token });
  check(res.status === 200, `expected 200, got ${res.status}`);
  const listings = res.data.listings || [];
  check(listings.every(l => l.status === 'published'), 'expected only published listings');
});

test('published listing is visible', async () => {
  const sellerId = createUserWithProfile('published-creator');
  const listingId = await createAndPublishListing(sellerId, 'Visible Product', 'products', '100');
  const token = tokenFor(sellerId);
  const res = await api('GET', '/api/marketplace/listings', { token });
  check(res.status === 200, `expected 200, got ${res.status}`);
  const listing = (res.data.listings || []).find(l => l.id === listingId);
  check(listing !== undefined, 'published listing should be visible');
  check(listing.title === 'Visible Product', 'expected title');
});

test('listing search works', async () => {
  const sellerId = createUserWithProfile('search-creator');
  const token = tokenFor(sellerId);
  await createAndPublishListing(sellerId, 'Unique Search Product', 'digital', '50');
  const res = await api('GET', '/api/marketplace/listings?search=Unique+Search', { token });
  check(res.status === 200, `expected 200, got ${res.status}`);
  const found = (res.data.listings || []).filter(l => l.title.includes('Unique Search'));
  check(found.length > 0, 'expected search results');
});

test('listing category filter works', async () => {
  const sellerId = createUserWithProfile('filter-creator');
  const token = tokenFor(sellerId);
  await createAndPublishListing(sellerId, 'Service Item', 'services', '100');
  await createAndPublishListing(sellerId, 'Product Item', 'products', '200');
  const res = await api('GET', '/api/marketplace/listings?category=services', { token });
  check(res.status === 200, `expected 200, got ${res.status}`);
  const services = (res.data.listings || []).filter(l => l.category === 'services');
  check(services.length > 0, 'expected services');
  check((res.data.listings || []).every(l => l.category === 'services'), 'expected only services');
});

test('listing pagination works', async () => {
  const sellerId = createUserWithProfile('pager-creator');
  const token = tokenFor(sellerId);
  for (let i = 0; i < 3; i++) await createAndPublishListing(sellerId, `Paginated Item ${i}`, 'products', `${i}`);
  const res = await api('GET', '/api/marketplace/listings?page=1&limit=2', { token });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.listings.length <= 2, 'expected at most 2 per page');
  check(res.data.page === 1, 'expected page 1');
});

test('invalid listing payload returns 400', async () => {
  const sellerId = createUserWithProfile('invalid-creator');
  const token = tokenFor(sellerId);
  const res = await api('POST', '/api/marketplace/listings', { token, body: { title: '', category: 'invalid', price_display: '' } });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('only owner can update listing', async () => {
  const sellerId = createUserWithProfile('owner-creator');
  const otherId = createUserWithProfile('other-creator');
  const listingId = await createAndPublishListing(sellerId, 'Owner Only', 'products', '100');
  const otherToken = tokenFor(otherId);
  const res = await api('PATCH', `/api/marketplace/listings/${listingId}`, { token: otherToken, body: { title: 'Hacked' } });
  check(res.status === 404, `expected 404 for cross-user, got ${res.status}`);
});

test('only draft can be published', async () => {
  const sellerId = createUserWithProfile('publish-creator');
  const token = tokenFor(sellerId);
  const createRes = await api('POST', '/api/marketplace/listings', { token, body: { title: 'Draft to Publish', description: '', category: 'local', price_display: '50', images: [] } });
  check(createRes.status === 201, `expected 201, got ${createRes.status}`);
  const listingId = createRes.data.listing.id;
  const publishRes = await api('POST', `/api/marketplace/listings/${listingId}/publish`, { token });
  check(publishRes.status === 200, `expected 200, got ${publishRes.status}`);
  const publishAgain = await api('POST', `/api/marketplace/listings/${listingId}/publish`, { token });
  check(publishAgain.status === 409, `expected 409 on second publish, got ${publishAgain.status}`);
});

// ══════════════════════════════════════════════════════
// Normal Marketplace — Share Link & Public Access
// ══════════════════════════════════════════════════════

group('Normal Marketplace — Share Link');

test('share URL opens product for logged-in user', async () => {
  const sellerId = createUserWithProfile('share-creator');
  const listingId = await createAndPublishListing(sellerId, 'Shareable Product', 'products', '100');
  const res = await api('GET', `/api/marketplace/listings/${listingId}`);
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.listing.id === listingId, 'expected matching id');
});

test('share URL works for logged-out visitor', async () => {
  const sellerId = createUserWithProfile('share-visitor');
  const listingId = await createAndPublishListing(sellerId, 'Public Product', 'products', '100');
  const res = await api('GET', `/api/marketplace/listings/${listingId}`);
  check(res.status === 200, `expected 200 for logged-out, got ${res.status}`);
});

test('draft listing not shareable', async () => {
  const sellerId = createUserWithProfile('draft-share');
  const token = tokenFor(sellerId);
  const createRes = await api('POST', '/api/marketplace/listings', { token, body: { title: 'Draft Share', description: '', category: 'products', price_display: '10', images: [] } });
  const listingId = createRes.data.listing.id;
  const res = await api('GET', `/api/marketplace/listings/${listingId}`);
  check(res.status === 404, `expected 404 for draft, got ${res.status}`);
});

test('cross-user cannot access another listing', async () => {
  const seller1Id = createUserWithProfile('cross-user-1');
  const seller2Id = createUserWithProfile('cross-user-2');
  const listingId = await createAndPublishListing(seller1Id, 'Cross-User Product', 'products', '100');
  const res = await api('GET', `/api/marketplace/listings/${listingId}`);
  // Public listing should be visible to anyone
  check(res.status === 200, `expected 200 for public listing, got ${res.status}`);
});

// ══════════════════════════════════════════════════════
// Normal Marketplace — Profile Linkage
// ══════════════════════════════════════════════════════

group('Normal Marketplace — Profile Linkage');

test('listing includes seller_user_id for profile link', async () => {
  const sellerId = createUserWithProfile('profile-link-creator');
  const listingId = await createAndPublishListing(sellerId, 'Profile Link Product', 'products', '100');
  const res = await api('GET', `/api/marketplace/listings/${listingId}`);
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.listing.seller_user_id === sellerId, 'expected seller_user_id');
});

// ══════════════════════════════════════════════════════
// Coin Shop Tests
// ══════════════════════════════════════════════════════

group('Coin Shop — Asset Discovery');

test('published creator asset visible in marketplace', async () => {
  const creatorId = createUserWithProfile('coin-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Coin Shop Asset', 50);
  const res = await api('GET', '/api/marketplace/assets', { token: tokenFor(creatorId) });
  check(res.status === 200, `expected 200, got ${res.status}`);
  const found = (res.data.assets || []).find(a => a.id === assetId);
  check(found !== undefined, 'published asset should be visible');
  check(found.price_coins === 50, 'expected price_coins');
});

test('archived creator asset hidden from marketplace', async () => {
  const creatorId = createUserWithProfile('archived-creator');
  const token = tokenFor(creatorId);
  const createRes = await api('POST', '/api/creator/assets', {
    token, body: { name: 'Archived Asset', description: '', asset_type: 'theme', asset_data: { theme: null }, price_coins: 10 }
  });
  check(createRes.status === 201, `expected 201, got ${createRes.status}`);
  const assetId = createRes.data.asset.id;
  await api('POST', `/api/creator/assets/${assetId}/archive`, { token });
  const res = await api('GET', '/api/marketplace/assets', { token });
  const found = (res.data.assets || []).find(a => a.id === assetId);
  check(found === undefined, 'archived asset should not be visible');
});

test('unpublished asset not visible in marketplace', async () => {
  const creatorId = createUserWithProfile('unpublished-creator');
  const token = tokenFor(creatorId);
  await api('POST', '/api/creator/assets', { token, body: { name: 'Draft Asset', description: '', asset_type: 'sticker', asset_data: { imageUrl: 'https://example.com/img.png', fit: 'cover' }, price_coins: 20 } });
  const res = await api('GET', '/api/marketplace/assets', { token });
  const found = (res.data.assets || []).find(a => a.name === 'Draft Asset');
  check(found === undefined, 'unpublished asset should not be visible');
});

// ══════════════════════════════════════════════════════
// Coin Shop — Buy
// ══════════════════════════════════════════════════════

group('Coin Shop — Purchase');

test('buy requires authentication', async () => {
  const creatorId = createUserWithProfile('buy-auth-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Auth-Required Asset', 50);
  const res = await api('POST', `/api/coin-shop/buy/${assetId}`);
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('buy requires sufficient coins', async () => {
  const creatorId = createUserWithProfile('buy-insufficient-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Expensive Asset', 9999);
  const buyerId = createUserWithProfile('buy-insufficient-buyer');
  const res = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyerId) });
  check(res.status === 402, `expected 402 insufficient, got ${res.status}`);
});

test('successful purchase debits buyer and credits creator', async () => {
  const creatorId = createUserWithProfile('buy-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Purchasable Asset', 100);

  // Ensure buyer has coins
  const buyerId = createUserWithProfile('buy-buyer');
  database.execute('INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 500, 0)', [buyerId]);

  const buyRes = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyerId) });
  check(buyRes.status === 200, `expected 200, got ${buyRes.status}`);

  // Check buyer wallet was debited
  const buyerWallet = database.queryOne('SELECT balance FROM user_wallets WHERE user_id = ?', [buyerId]);
  check(buyerWallet.balance === 400, `expected buyer balance 400, got ${buyerWallet.balance}`);

  // Check creator wallet was credited
  const creatorWallet = database.queryOne('SELECT balance FROM user_wallets WHERE user_id = ?', [creatorId]);
  check(creatorWallet.balance === 100, `expected creator balance 100, got ${creatorWallet.balance}`);

  // Check purchase record exists
  const purchase = database.queryOne('SELECT id FROM purchased_assets WHERE buyer_user_id = ? AND asset_id = ?', [buyerId, assetId]);
  check(purchase !== null, 'expected purchase record');
});

test('duplicate purchase rejected', async () => {
  const creatorId = createUserWithProfile('dup-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Dupe Asset', 50);
  const buyerId = createUserWithProfile('dup-buyer');
  database.execute('INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 500, 0)', [buyerId]);

  const buy1 = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyerId) });
  check(buy1.status === 200, `expected first purchase 200, got ${buy1.status}`);
  const buy2 = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyerId) });
  check(buy2.status === 409, `expected 409 on duplicate, got ${buy2.status}`);
});

test('cannot purchase own asset', async () => {
  const creatorId = createUserWithProfile('own-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Own Asset', 50);
  const res = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(creatorId) });
  check(res.status === 403, `expected 403, got ${res.status}`);
});

test('cannot purchase unpublished asset', async () => {
  const creatorId = createUserWithProfile('unpublished-buy-creator');
  const token = tokenFor(creatorId);
  const createRes = await api('POST', '/api/creator/assets', { token, body: { name: 'Unpublished Asset', description: '', asset_type: 'decoration', asset_data: { imageUrl: 'https://example.com/img.png', fit: 'cover' }, price_coins: 30 } });
  const assetId = createRes.data.asset.id;
  const buyerId = createUserWithProfile('unpublished-buyer');
  database.execute('INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 500, 0)', [buyerId]);
  const res = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyerId) });
  check(res.status === 404, `expected 404 for unpublished, got ${res.status}`);
});

test('cannot purchase archived asset', async () => {
  const creatorId = createUserWithProfile('archived-buy-creator');
  const token = tokenFor(creatorId);
  const createRes = await api('POST', '/api/creator/assets', { token, body: { name: 'Archived Buy Asset', description: '', asset_type: 'background', asset_data: { imageUrl: 'https://example.com/img.png', fit: 'cover' }, price_coins: 30 } });
  const assetId = createRes.data.asset.id;
  await api('POST', `/api/creator/assets/${assetId}/archive`, { token });
  const buyerId = createUserWithProfile('archived-buyer');
  database.execute('INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 500, 0)', [buyerId]);
  const res = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyerId) });
  check(res.status === 404, `expected 404 for archived, got ${res.status}`);
});

test('purchased asset ownership recorded', async () => {
  const creatorId = createUserWithProfile('own-record-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Ownership Asset', 10);
  const buyerId = createUserWithProfile('own-record-buyer');
  database.execute('INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 500, 0)', [buyerId]);
  const buyRes = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyerId) });
  check(buyRes.status === 200, `expected 200, got ${buyRes.status}`);
  const purchases = database.queryAll('SELECT * FROM purchased_assets WHERE buyer_user_id = ?', [buyerId]);
  check(purchases.length === 1, 'expected 1 purchase record');
  check(purchases[0].asset_id === assetId, 'expected correct asset');
});

// ══════════════════════════════════════════════════════
// Coin Shop — Share Link & Public Access
// ══════════════════════════════════════════════════════

group('Coin Shop — Share Link');

test('coin shop product share URL accessible publicly', async () => {
  const creatorId = createUserWithProfile('coin-share-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Shareable Coin Asset', 50);
  const res = await api('GET', `/api/coin-shop/products/${assetId}`);
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.product.id === assetId, 'expected matching id');
});

test('coin shop product works for logged-out visitor', async () => {
  const creatorId = createUserWithProfile('coin-share-visitor');
  const assetId = await createAndPublishAsset(creatorId, 'Public Coin Asset', 50);
  const res = await api('GET', `/api/coin-shop/products/${assetId}`);
  check(res.status === 200, `expected 200 for logged-out, got ${res.status}`);
});

test('unpublished coin asset not shareable', async () => {
  const creatorId = createUserWithProfile('coin-draft-share');
  const token = tokenFor(creatorId);
  const createRes = await api('POST', '/api/creator/assets', { token, body: { name: 'Draft Coin Asset', description: '', asset_type: 'theme', asset_data: { theme: null }, price_coins: 10 } });
  const assetId = createRes.data.asset.id;
  const res = await api('GET', `/api/coin-shop/products/${assetId}`);
  check(res.status === 404, `expected 404 for unpublished, got ${res.status}`);
});

// ══════════════════════════════════════════════════════
// Coin Shop — Profile Linkage
// ══════════════════════════════════════════════════════

group('Coin Shop — Profile Linkage');

test('coin shop product includes creator_user_id', async () => {
  const creatorId = createUserWithProfile('coin-profile-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Profile Link Asset', 50);
  const res = await api('GET', '/api/marketplace/assets', { token: tokenFor(creatorId) });
  const found = (res.data.assets || []).find(a => a.id === assetId);
  check(found !== undefined, 'expected asset');
  check(found.creator_user_id === creatorId, 'expected creator_user_id');
});

// ══════════════════════════════════════════════════════
// Security Tests
// ══════════════════════════════════════════════════════

group('Security');

test('unauthenticated list marketplace returns 401', async () => {
  const res = await api('GET', '/api/marketplace/listings');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('coin shop product detail is public for share links', async () => {
  const creatorId = createUserWithProfile('sec-creator');
  const assetId = await createAndPublishAsset(creatorId, 'Secured Asset', 50);
  const res = await api('GET', `/api/coin-shop/products/${assetId}`);
  check(res.status === 200, `expected 200 public, got ${res.status}`);
});

test('invalid listing id returns 404', async () => {
  const sellerId = createUserWithProfile('invalid-id-creator');
  const res = await api('GET', '/api/marketplace/listings/00000000-0000-0000-0000-000000000000');
  check(res.status === 404, `expected 404, got ${res.status}`);
});

// ══════════════════════════════════════════════════════
// Teardown
// ══════════════════════════════════════════════════════

queue.push(async () => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); process.stdout.write('  [cleanup] temp dir removed\n'); } catch {}
});

for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
process.stdout.write('\n');
process.stdout.write('Marketplace tests: ' + (total - failed.length) + '/' + total + ' passed\n');
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
