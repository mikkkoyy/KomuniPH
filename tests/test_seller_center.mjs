/**
 * CREATOR-05 — Marketplace Seller Center test suite.
 *
 * Run:   npm run test:seller-center
 *
 * Covers the Seller Center (#/marketplace/seller) data layer:
 *   - my-listings search / status / category / sort (server-authoritative)
 *   - dashboard counts stay global while the list is filtered
 *   - seller profile identity linkage on own listings
 *   - external sales fields round-trip through management
 *   - creator sales summary: auth, empty state, accuracy, isolation
 *   - core lifecycle + ownership (create/edit/publish/archive/republish)
 *
 * Throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-seller-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-seller.db');
process.env.PORT = String(19600 + (process.pid % 900));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-05-test-webhook-secret';
process.env.SECRET_KEY = 'creator-05-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'seller-admin';

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

async function createListing(token, overrides = {}) {
  const res = await api('POST', '/api/marketplace/listings', {
    token,
    body: {
      title: 'Seller Center Product', description: 'Seller center fixture', category: 'products',
      price_display: '₱100', images: [], external_url: null, contact_info: null, ...overrides,
    },
  });
  check(res.status === 201, `create: ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data.listing;
}

// ═══════════════════════════════════════════════════════════════════════════
group('Seller Search + Filter + Sort');

test('search filters own listings by title', async () => {
  const seller = createUserWithProfile('sc-search');
  const token = tokenFor(seller.id);
  await createListing(token, { title: 'Blue Handwoven Basket' });
  await createListing(token, { title: 'Red Clay Pot' });
  const res = await api('GET', '/api/marketplace/my-listings?search=basket', { token });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.listings.length === 1, `expected 1, got ${res.data.listings.length}`);
  check(res.data.listings[0].title.includes('Basket'), 'expected the basket listing');
  check(res.data.counts.total === 2, 'counts must stay global while filtered');
});

test('status filter isolates drafts/published/archived', async () => {
  const seller = createUserWithProfile('sc-status');
  const token = tokenFor(seller.id);
  const d = await createListing(token, { title: 'Status Draft' });
  const p = await createListing(token, { title: 'Status Pub' });
  await api('POST', `/api/marketplace/listings/${p.id}/publish`, { token });
  const a = await createListing(token, { title: 'Status Arch' });
  await api('POST', `/api/marketplace/listings/${a.id}/archive`, { token });
  const drafts = await api('GET', '/api/marketplace/my-listings?status=draft', { token });
  check(drafts.data.listings.length === 1 && drafts.data.listings[0].id === d.id, 'expected only the draft');
  const pubs = await api('GET', '/api/marketplace/my-listings?status=published', { token });
  check(pubs.data.listings.length === 1 && pubs.data.listings[0].id === p.id, 'expected only the published');
  const archs = await api('GET', '/api/marketplace/my-listings?status=archived', { token });
  check(archs.data.listings.length === 1 && archs.data.listings[0].id === a.id, 'expected only the archived');
  check(drafts.data.counts.total === 3, 'counts must stay global');
});

test('category filter works', async () => {
  const seller = createUserWithProfile('sc-cat');
  const token = tokenFor(seller.id);
  await createListing(token, { title: 'Cat Service', category: 'services' });
  await createListing(token, { title: 'Cat Product', category: 'products' });
  const res = await api('GET', '/api/marketplace/my-listings?category=services', { token });
  check(res.data.listings.length === 1, `expected 1, got ${res.data.listings.length}`);
  check(res.data.listings[0].category === 'services', 'expected services only');
});

test('title sort orders A-Z', async () => {
  const seller = createUserWithProfile('sc-sort');
  const token = tokenFor(seller.id);
  await createListing(token, { title: 'Zebra Item' });
  await createListing(token, { title: 'Apple Item' });
  await createListing(token, { title: 'Mango Item' });
  const res = await api('GET', '/api/marketplace/my-listings?sort=title', { token });
  const titles = res.data.listings.map(l => l.title);
  check(JSON.stringify(titles) === JSON.stringify(['Apple Item', 'Mango Item', 'Zebra Item']), `unexpected order: ${titles}`);
});

test('invalid status filter is ignored safely', async () => {
  const seller = createUserWithProfile('sc-badstatus');
  const token = tokenFor(seller.id);
  await createListing(token, { title: 'Bad Status Item' });
  const res = await api('GET', '/api/marketplace/my-listings?status=nope', { token });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.listings.length === 1, 'invalid status must not filter everything out');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Seller Identity + External Sales');

test('own listings carry seller profile identity', async () => {
  const seller = createUserWithProfile('sc-identity');
  const token = tokenFor(seller.id);
  await createListing(token, { title: 'Identity Item' });
  const res = await api('GET', '/api/marketplace/my-listings', { token });
  const item = res.data.listings[0];
  check(item.seller_user_id === seller.id, 'expected seller_user_id');
  check(item.seller_username === seller.username, 'expected seller_username (login identifier linkage)');
  check(typeof item.seller_display_name === 'string' && item.seller_display_name.length > 0, 'expected display identity, not just username');
});

test('external sales fields round-trip through management', async () => {
  const seller = createUserWithProfile('sc-external');
  const token = tokenFor(seller.id);
  const created = await createListing(token, {
    title: 'External Item', external_url: 'https://www.facebook.com/testshop', contact_info: 'GCash 0917-000-0000',
  });
  check(created.external_url === 'https://www.facebook.com/testshop', 'expected external_url');
  const edited = await api('PATCH', `/api/marketplace/listings/${created.id}`, {
    token, body: { external_url: 'https://shopee.ph/testshop', contact_info: 'Shopee chat only' },
  });
  check(edited.status === 200, `expected 200, got ${edited.status}`);
  check(edited.data.listing.external_url === 'https://shopee.ph/testshop', 'expected updated external_url');
  const cleared = await api('PATCH', `/api/marketplace/listings/${created.id}`, { token, body: { external_url: null } });
  check(cleared.data.listing.external_url === null, 'expected external_url clearable');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Seller Lifecycle Core');

test('full lifecycle: draft → publish → archive → republish', async () => {
  const seller = createUserWithProfile('sc-life');
  const token = tokenFor(seller.id);
  const d = await createListing(token, { title: 'Lifecycle Item' });
  check(d.status === 'draft', 'starts as draft');
  const pub = await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token });
  check(pub.data.listing.status === 'published', 'published');
  const seen = await api('GET', `/api/marketplace/listings/${d.id}`);
  check(seen.status === 200, 'publicly visible');
  const arch = await api('POST', `/api/marketplace/listings/${d.id}/archive`, { token });
  check(arch.data.listing.status === 'archived', 'archived');
  check((await api('GET', `/api/marketplace/listings/${d.id}`)).status === 404, 'hidden when archived');
  const repub = await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token });
  check(repub.data.listing.status === 'published', 'republished');
});

test('cross-user management rejected', async () => {
  const s1 = createUserWithProfile('sc-x1');
  const s2 = createUserWithProfile('sc-x2');
  const d = await createListing(tokenFor(s1.id), { title: 'X Item' });
  const t2 = tokenFor(s2.id);
  check((await api('PATCH', `/api/marketplace/listings/${d.id}`, { token: t2, body: { title: 'Hijack' } })).status === 404, 'edit 404');
  check((await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token: t2 })).status === 404, 'publish 404');
  check((await api('POST', `/api/marketplace/listings/${d.id}/archive`, { token: t2 })).status === 404, 'archive 404');
  check((await api('GET', '/api/marketplace/my-listings', { token: t2 })).data.listings.length === 0, 'no leak');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Creator Sales Summary');

test('sales summary requires authentication', async () => {
  const res = await api('GET', '/api/creator/assets/sales');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('empty creator summary is zeroed', async () => {
  const creator = createUserWithProfile('sc-sales-empty');
  const res = await api('GET', '/api/creator/assets/sales', { token: tokenFor(creator.id) });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.totals.sales === 0 && res.data.totals.earned_coins === 0 && res.data.totals.assets === 0, 'expected zeroed totals');
});

test('sales summary reflects real purchases only', async () => {
  const creator = createUserWithProfile('sc-sales');
  const cToken = tokenFor(creator.id);
  const mkAsset = async (name, price) => {
    const c = await api('POST', '/api/creator/assets', {
      token: cToken,
      body: { name, description: `${name} desc`, asset_type: 'profile_design', asset_data: { layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme: {} }, price_coins: price },
    });
    check(c.status === 201, `create: ${c.status}`);
    await api('POST', `/api/creator/assets/${c.data.asset.id}/submit`, { token: cToken });
    await api('POST', `/api/creator/assets/${c.data.asset.id}/publish`, { token: cToken });
    return c.data.asset.id;
  };
  const a1 = await mkAsset('Sales Hit', 40);
  const a2 = await mkAsset('Sales Flop', 70);
  const buyer = createUserWithProfile('sc-sales-buyer');
  database.execute('INSERT OR IGNORE INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 0, 0)', [buyer.id]);
  database.execute('UPDATE user_wallets SET balance = ? WHERE user_id = ?', [500, buyer.id]);
  const buy = await api('POST', `/api/coin-shop/buy/${a1}`, { token: tokenFor(buyer.id) });
  check(buy.status === 200, `buy: ${buy.status}`);
  const res = await api('GET', '/api/creator/assets/sales', { token: cToken });
  check(res.data.totals.assets === 2, `expected 2 assets, got ${res.data.totals.assets}`);
  check(res.data.totals.sales === 1, `expected 1 sale, got ${res.data.totals.sales}`);
  check(res.data.totals.earned_coins === 40, `expected 40 earned, got ${res.data.totals.earned_coins}`);
  const hit = res.data.assets.find(a => a.asset_id === a1);
  const flop = res.data.assets.find(a => a.asset_id === a2);
  check(hit.sales === 1 && hit.earned_coins === 40, 'hit must show its real sale');
  check(flop.sales === 0 && flop.earned_coins === 0, 'flop must show zero, not fabricated');
});

test('sales summary never leaks another creator stats', async () => {
  const c1 = createUserWithProfile('sc-sales-c1');
  const c2 = createUserWithProfile('sc-sales-c2');
  const res = await api('GET', '/api/creator/assets/sales', { token: tokenFor(c2.id) });
  check(res.data.totals.assets === 0 && res.data.totals.sales === 0, 'creator B must see only own stats');
  void c1;
});

// ── Teardown ─────────────────────────────────────────────────────────────
queue.push(async () => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); process.stdout.write('  [cleanup] temp dir removed\n'); } catch {}
});

for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
process.stdout.write('\n');
process.stdout.write('Seller center tests: ' + (total - failed.length) + '/' + total + ' passed\n');
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
