/**
 * CREATOR-04 — Marketplace seller management test suite.
 *
 * Run:   npm run test:marketplace-manage
 *
 * Covers:
 *   - seller dashboard: auth, empty state, per-status counts
 *   - create listing with images + external sales/contact fields
 *   - draft editing (incl. image add/remove/reorder payloads)
 *   - server-side image URL + external URL validation (scheme rejection)
 *   - publish / archive / re-publish lifecycle
 *   - cross-user edit/publish/archive rejection
 *   - public visibility + archived hiding + share URL + seller linkage
 *   - messaging context: recipient resolved from the product record,
 *     fabricated parameters cannot change it, existing messaging intact
 *
 * Throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-manage-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-manage.db');
process.env.PORT = String(19800 + (process.pid % 1100));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-04-test-webhook-secret';
process.env.SECRET_KEY = 'creator-04-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'manage-admin';

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

function listingBody(overrides = {}) {
  return {
    title: 'Manage Test Product',
    description: 'A product for seller management tests',
    category: 'products',
    price_display: '₱500',
    images: ['https://example.com/img1.png'],
    external_url: 'https://shopee.ph/test-product',
    contact_info: 'Message me on Facebook',
    ...overrides,
  };
}

async function createDraft(sellerToken, overrides = {}) {
  const res = await api('POST', '/api/marketplace/listings', { token: sellerToken, body: listingBody(overrides) });
  check(res.status === 201, `create draft: ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data.listing;
}

// ═══════════════════════════════════════════════════════════════════════════
group('Seller Dashboard');

test('my-listings requires authentication', async () => {
  const res = await api('GET', '/api/marketplace/my-listings');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('empty dashboard returns zero counts', async () => {
  const seller = createUserWithProfile('manage-empty');
  const res = await api('GET', '/api/marketplace/my-listings', { token: tokenFor(seller.id) });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.counts.total === 0, 'expected zero total');
  check(res.data.counts.draft === 0 && res.data.counts.published === 0 && res.data.counts.archived === 0, 'expected zero counts');
  check(Array.isArray(res.data.listings) && res.data.listings.length === 0, 'expected empty listings');
});

test('dashboard counts track lifecycle', async () => {
  const seller = createUserWithProfile('manage-counts');
  const token = tokenFor(seller.id);
  const d = await createDraft(token, { title: 'Count Draft' });
  const p = await createDraft(token, { title: 'Count Published' });
  await api('POST', `/api/marketplace/listings/${p.id}/publish`, { token });
  const a = await createDraft(token, { title: 'Count Archived' });
  await api('POST', `/api/marketplace/listings/${a.id}/archive`, { token });
  const res = await api('GET', '/api/marketplace/my-listings', { token });
  check(res.data.counts.total === 3, `expected 3, got ${res.data.counts.total}`);
  check(res.data.counts.draft === 1, `expected 1 draft, got ${res.data.counts.draft}`);
  check(res.data.counts.published === 1, `expected 1 published, got ${res.data.counts.published}`);
  check(res.data.counts.archived === 1, `expected 1 archived, got ${res.data.counts.archived}`);
  check(res.data.listings.every(l => l.seller_user_id === seller.id), 'dashboard must only contain own listings');
});

test('dashboard never leaks another seller listings', async () => {
  const s1 = createUserWithProfile('manage-leak1');
  const s2 = createUserWithProfile('manage-leak2');
  await createDraft(tokenFor(s1.id), { title: 'Leak Test' });
  const res = await api('GET', '/api/marketplace/my-listings', { token: tokenFor(s2.id) });
  check(res.data.listings.length === 0, 'must not leak cross-seller listings');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Listing Create + Validation');

test('create listing with images and external fields', async () => {
  const seller = createUserWithProfile('manage-create');
  const listing = await createDraft(tokenFor(seller.id), {
    title: 'Full Listing',
    images: ['https://example.com/a.png', 'https://example.com/b.jpg'],
    external_url: 'https://www.lazada.com.ph/test',
    contact_info: 'GCash 0917-000-0000',
  });
  check(listing.status === 'draft', 'expected draft');
  check(listing.images.length === 2, 'expected 2 images');
  check(listing.external_url === 'https://www.lazada.com.ph/test', 'expected external_url');
  check(listing.contact_info === 'GCash 0917-000-0000', 'expected contact_info');
  check(listing.seller_username === seller.username, 'expected seller_username linkage');
});

test('javascript: image URL is rejected', async () => {
  const seller = createUserWithProfile('manage-badimg');
  const res = await api('POST', '/api/marketplace/listings', {
    token: tokenFor(seller.id), body: listingBody({ images: ['javascript:alert(1)'] }),
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('data: image URL is rejected', async () => {
  const seller = createUserWithProfile('manage-badimg2');
  const res = await api('POST', '/api/marketplace/listings', {
    token: tokenFor(seller.id), body: listingBody({ images: ['data:image/png;base64,AAA'] }),
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('more than 10 images rejected', async () => {
  const seller = createUserWithProfile('manage-manyimg');
  const res = await api('POST', '/api/marketplace/listings', {
    token: tokenFor(seller.id),
    body: listingBody({ images: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.png`) }),
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('javascript: external URL is rejected', async () => {
  const seller = createUserWithProfile('manage-badext');
  const res = await api('POST', '/api/marketplace/listings', {
    token: tokenFor(seller.id), body: listingBody({ external_url: 'javascript:steal()' }),
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('markup in contact_info is rejected', async () => {
  const seller = createUserWithProfile('manage-badcontact');
  const res = await api('POST', '/api/marketplace/listings', {
    token: tokenFor(seller.id), body: listingBody({ contact_info: '<script>alert(1)</script>' }),
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('invalid listing payloads rejected', async () => {
  const seller = createUserWithProfile('manage-invalid');
  const token = tokenFor(seller.id);
  const bad1 = await api('POST', '/api/marketplace/listings', { token, body: { title: '', category: 'products', price_display: '1' } });
  check(bad1.status === 400, `expected 400 for empty title, got ${bad1.status}`);
  const bad2 = await api('POST', '/api/marketplace/listings', { token, body: { title: 'X', category: 'nope', price_display: '1' } });
  check(bad2.status === 400, `expected 400 for bad category, got ${bad2.status}`);
});

// ═══════════════════════════════════════════════════════════════════════════
group('Listing Lifecycle');

test('draft editing incl. image reorder', async () => {
  const seller = createUserWithProfile('manage-edit');
  const token = tokenFor(seller.id);
  const d = await createDraft(token, { images: ['https://example.com/1.png', 'https://example.com/2.png'] });
  const res = await api('PATCH', `/api/marketplace/listings/${d.id}`, {
    token, body: { title: 'Edited Title', images: ['https://example.com/2.png', 'https://example.com/3.png'], contact_info: 'Updated contact' },
  });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.listing.title === 'Edited Title', 'expected edited title');
  check(JSON.stringify(res.data.listing.images) === JSON.stringify(['https://example.com/2.png', 'https://example.com/3.png']), 'expected reordered images');
});

test('published listing cannot be edited', async () => {
  const seller = createUserWithProfile('manage-noedit');
  const token = tokenFor(seller.id);
  const d = await createDraft(token);
  await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token });
  const res = await api('PATCH', `/api/marketplace/listings/${d.id}`, { token, body: { title: 'Sneaky Edit' } });
  check(res.status === 409, `expected 409, got ${res.status}`);
});

test('publish then re-publish rejected, archive then re-publish works', async () => {
  const seller = createUserWithProfile('manage-repub');
  const token = tokenFor(seller.id);
  const d = await createDraft(token);
  const pub = await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token });
  check(pub.status === 200 && pub.data.listing.status === 'published', 'expected published');
  const pub2 = await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token });
  check(pub2.status === 409, `expected 409 on double publish, got ${pub2.status}`);
  const arch = await api('POST', `/api/marketplace/listings/${d.id}/archive`, { token });
  check(arch.status === 200 && arch.data.listing.status === 'archived', 'expected archived');
  const repub = await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token });
  check(repub.status === 200 && repub.data.listing.status === 'published', 'expected re-publish after archive');
});

test('archive is idempotent', async () => {
  const seller = createUserWithProfile('manage-archidem');
  const token = tokenFor(seller.id);
  const d = await createDraft(token);
  const a1 = await api('POST', `/api/marketplace/listings/${d.id}/archive`, { token });
  const a2 = await api('POST', `/api/marketplace/listings/${d.id}/archive`, { token });
  check(a1.status === 200 && a2.status === 200, 'expected 200 both times');
  check(a2.data.listing.status === 'archived', 'expected archived');
});

test('archived listing hidden publicly, visible in dashboard', async () => {
  const seller = createUserWithProfile('manage-archvis');
  const token = tokenFor(seller.id);
  const d = await createDraft(token, { title: 'Archived Hidden' });
  await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token });
  await api('POST', `/api/marketplace/listings/${d.id}/archive`, { token });
  const pub = await api('GET', `/api/marketplace/listings/${d.id}`);
  check(pub.status === 404, `expected 404 public, got ${pub.status}`);
  const mine = await api('GET', '/api/marketplace/my-listings', { token });
  check(mine.data.listings.some(l => l.id === d.id && l.status === 'archived'), 'expected archived in dashboard');
});

test('published listing publicly visible with external + seller linkage', async () => {
  const seller = createUserWithProfile('manage-pubvis');
  const token = tokenFor(seller.id);
  const d = await createDraft(token, { title: 'Public Full', external_url: 'https://facebook.com/testshop' });
  await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token });
  const res = await api('GET', `/api/marketplace/listings/${d.id}`);
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.listing.external_url === 'https://facebook.com/testshop', 'expected external_url public');
  check(res.data.listing.seller_username === seller.username, 'expected seller_username');
  check(res.data.listing.seller_user_id === seller.id, 'expected seller_user_id');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Cross-User Protection');

test('cross-user edit rejected', async () => {
  const s1 = createUserWithProfile('manage-xedit1');
  const s2 = createUserWithProfile('manage-xedit2');
  const d = await createDraft(tokenFor(s1.id));
  const res = await api('PATCH', `/api/marketplace/listings/${d.id}`, { token: tokenFor(s2.id), body: { title: 'Hijack' } });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

test('cross-user publish rejected', async () => {
  const s1 = createUserWithProfile('manage-xpub1');
  const s2 = createUserWithProfile('manage-xpub2');
  const d = await createDraft(tokenFor(s1.id));
  const res = await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token: tokenFor(s2.id) });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

test('cross-user archive rejected', async () => {
  const s1 = createUserWithProfile('manage-xarch1');
  const s2 = createUserWithProfile('manage-xarch2');
  const d = await createDraft(tokenFor(s1.id));
  const res = await api('POST', `/api/marketplace/listings/${d.id}/archive`, { token: tokenFor(s2.id) });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

test('archive requires authentication', async () => {
  const res = await api('POST', '/api/marketplace/listings/some-id/archive');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

// ═══════════════════════════════════════════════════════════════════════════
group('Messaging Context');

test('message seller target resolves to actual seller', async () => {
  const seller = createUserWithProfile('manage-msgseller');
  const buyer = createUserWithProfile('manage-msgbuyer');
  const d = await createDraft(tokenFor(seller.id), { title: 'Context Product' });
  await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token: tokenFor(seller.id) });
  // Recipient is resolved server-side from the published record.
  const product = await api('GET', `/api/marketplace/listings/${d.id}`);
  check(product.status === 200, `expected 200, got ${product.status}`);
  check(product.data.listing.seller_user_id === seller.id, 'recipient must be the actual seller');
  const conv = await api('POST', '/api/messages/conversations', { token: tokenFor(buyer.id), body: { user_id: product.data.listing.seller_user_id } });
  check(conv.status === 201, `expected 201, got ${conv.status}: ${JSON.stringify(conv.data)}`);
});

test('fabricated seller parameter cannot change the record', async () => {
  const seller = createUserWithProfile('manage-fab1');
  const impostor = createUserWithProfile('manage-fab2');
  const d = await createDraft(tokenFor(seller.id), { title: 'Fab Product' });
  await api('POST', `/api/marketplace/listings/${d.id}/publish`, { token: tokenFor(seller.id) });
  // Even if the UI query says ?to=<impostor>, the authoritative record stays.
  const product = await api('GET', `/api/marketplace/listings/${d.id}?to=${impostor.username}`);
  check(product.data.listing.seller_user_id === seller.id, 'record must still point at the real seller');
  check(product.data.listing.seller_user_id !== impostor.id, 'impostor must not become the recipient');
});

test('invalid product id yields no conversation target', async () => {
  const res = await api('GET', '/api/marketplace/listings/00000000-0000-0000-0000-000000000000');
  check(res.status === 404, `expected 404, got ${res.status}`);
});

test('cannot open conversation with yourself', async () => {
  const seller = createUserWithProfile('manage-selfmsg');
  const res = await api('POST', '/api/messages/conversations', { token: tokenFor(seller.id), body: { user_id: seller.id } });
  check(res.status === 422, `expected 422, got ${res.status}`);
});

test('existing messaging still works end to end', async () => {
  const a = createUserWithProfile('manage-chat1');
  const b = createUserWithProfile('manage-chat2');
  const conv = await api('POST', '/api/messages/conversations', { token: tokenFor(a.id), body: { user_id: b.id } });
  check(conv.status === 201, `expected 201, got ${conv.status}`);
  const sent = await api('POST', `/api/messages/conversations/${conv.data.id}/messages`, { token: tokenFor(a.id), body: { body: 'Hello about your listing' } });
  check(sent.status === 201, `expected 201, got ${sent.status}`);
  const read = await api('GET', `/api/messages/conversations/${conv.data.id}/messages`, { token: tokenFor(b.id) });
  check(read.status === 200 && read.data.messages.length === 1, 'expected the message to arrive');
});

// ── Teardown ─────────────────────────────────────────────────────────────
queue.push(async () => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); process.stdout.write('  [cleanup] temp dir removed\n'); } catch {}
});

for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
process.stdout.write('\n');
process.stdout.write('Marketplace management tests: ' + (total - failed.length) + '/' + total + ' passed\n');
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
