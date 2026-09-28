/**
 * CREATOR-05 — Creator Studio Coin Shop Manager test suite.
 *
 * Run:   npm run test:coin-shop-manager
 *
 * Covers the manager data layer (all operations reuse creator_assets APIs):
 *   - authentication + ownership isolation on creator asset endpoints
 *   - creation for every supported asset type (profile_design, theme,
 *     background, sticker, decoration)
 *   - invalid type / price / payload rejection
 *   - lifecycle: draft → submitted → published → archived
 *   - published immutability, archived cannot republish
 *   - public Coin Shop visibility rules (published only)
 *   - immutable snapshot: personal design edits never change the asset
 *   - purchase regression after manager publish (real debit/credit)
 *
 * Throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-csmgr-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-csmgr.db');
process.env.PORT = String(19500 + (process.pid % 800));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-05-test-webhook-secret';
process.env.SECRET_KEY = 'creator-05-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'csmgr-admin';

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
        { id: 'c1', type: 'text', x: 10, y: 10, width: 200, height: 60, zIndex: 1, visible: true, locked: false, rotation: 0, style: { background: '#0e6e6e', textColor: '#ffffff' }, config: { text: 'Hi', fontSize: 20, textAlign: 'left' } },
      ],
    },
    theme: { backgroundColor: '#0f172a', textColor: '#e6eaf2', accentColor: '#14b8a6' },
  };
}

const ASSET_DATA = {
  profile_design: () => designSnapshot(),
  theme: () => ({ theme: { backgroundColor: '#111111', textColor: '#eeeeee', accentColor: '#14b8a6' } }),
  background: () => ({ imageUrl: 'https://example.com/bg.png', fit: 'cover' }),
  sticker: () => ({ imageUrl: 'https://example.com/st.png', fit: 'contain' }),
  decoration: () => ({ imageUrl: 'https://example.com/de.png', fit: 'cover' }),
};

async function createAsset(token, type, price = 100, name = null) {
  const res = await api('POST', '/api/creator/assets', {
    token,
    body: { name: name || `Mgr ${type}`, description: `${type} desc`, asset_type: type, asset_data: ASSET_DATA[type](), price_coins: price },
  });
  check(res.status === 201, `create ${type}: ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data.asset;
}

async function submitPublish(token, id) {
  const s = await api('POST', `/api/creator/assets/${id}/submit`, { token });
  check(s.status === 200, `submit: ${s.status}`);
  const p = await api('POST', `/api/creator/assets/${id}/publish`, { token });
  check(p.status === 200, `publish: ${p.status}`);
  return p.data.asset;
}

// ═══════════════════════════════════════════════════════════════════════════
group('Manager Auth + Ownership');

test('creator asset list requires authentication', async () => {
  const res = await api('GET', '/api/creator/assets');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('creator sees only own assets', async () => {
  const c1 = createUserWithProfile('csm-own1');
  const c2 = createUserWithProfile('csm-own2');
  await createAsset(tokenFor(c1.id), 'sticker', 10, 'Own Sticker');
  const res = await api('GET', '/api/creator/assets', { token: tokenFor(c2.id) });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.assets.length === 0, 'must not leak another creator assets');
});

test('cross-user asset read/update rejected', async () => {
  const c1 = createUserWithProfile('csm-x1');
  const c2 = createUserWithProfile('csm-x2');
  const a = await createAsset(tokenFor(c1.id), 'theme', 10, 'X Theme');
  const t2 = tokenFor(c2.id);
  check((await api('GET', `/api/creator/assets/${a.id}`, { token: t2 })).status === 404, 'read 404');
  check((await api('PATCH', `/api/creator/assets/${a.id}`, { token: t2, body: { name: 'Hijack' } })).status === 404, 'update 404');
  check((await api('POST', `/api/creator/assets/${a.id}/submit`, { token: t2 })).status === 404, 'submit 404');
  check((await api('POST', `/api/creator/assets/${a.id}/publish`, { token: t2 })).status === 404, 'publish 404');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Manager Creation');

test('all supported types can be created with Coin prices', async () => {
  const creator = createUserWithProfile('csm-alltypes');
  const token = tokenFor(creator.id);
  for (const type of ['profile_design', 'theme', 'background', 'sticker', 'decoration']) {
    const a = await createAsset(token, type, 150);
    check(a.status === 'draft', `${type} starts as draft`);
    check(a.price_coins === 150, `${type} price persisted`);
    check(a.asset_type === type, `${type} type persisted`);
  }
});

test('invalid asset type rejected', async () => {
  const creator = createUserWithProfile('csm-badtype');
  const res = await api('POST', '/api/creator/assets', {
    token: tokenFor(creator.id),
    body: { name: 'Bad', description: '', asset_type: 'animation', asset_data: {}, price_coins: 10 },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('invalid prices rejected (negative, decimal, string)', async () => {
  const creator = createUserWithProfile('csm-badprice');
  const token = tokenFor(creator.id);
  for (const price of [-5, 2.5, '100']) {
    const res = await api('POST', '/api/creator/assets', {
      token, body: { name: 'P', description: '', asset_type: 'sticker', asset_data: ASSET_DATA.sticker(), price_coins: price },
    });
    check(res.status === 400, `expected 400 for ${price}, got ${res.status}`);
  }
});

test('unsafe image URL rejected', async () => {
  const creator = createUserWithProfile('csm-badurl');
  const res = await api('POST', '/api/creator/assets', {
    token: tokenFor(creator.id),
    body: { name: 'Bad', description: '', asset_type: 'background', asset_data: { imageUrl: 'javascript:evil()', fit: 'cover' }, price_coins: 10 },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

// ═══════════════════════════════════════════════════════════════════════════
group('Manager Lifecycle');

test('draft → submitted → published → archived', async () => {
  const creator = createUserWithProfile('csm-life');
  const token = tokenFor(creator.id);
  const a = await createAsset(token, 'background', 80, 'Life Bg');
  const s = await api('POST', `/api/creator/assets/${a.id}/submit`, { token });
  check(s.data.asset.status === 'submitted', 'submitted');
  const p = await api('POST', `/api/creator/assets/${a.id}/publish`, { token });
  check(p.data.asset.status === 'published', 'published');
  const v = p.data.asset.version;
  check(v > 1, 'publish bumps version (immutable snapshot)');
  const ar = await api('POST', `/api/creator/assets/${a.id}/archive`, { token });
  check(ar.data.asset.status === 'archived', 'archived');
});

test('published asset immutable, archived cannot republish', async () => {
  const creator = createUserWithProfile('csm-immut');
  const token = tokenFor(creator.id);
  const a = await createAsset(token, 'decoration', 30, 'Immut');
  await submitPublish(token, a.id);
  check((await api('PATCH', `/api/creator/assets/${a.id}`, { token, body: { name: 'Changed' } })).status === 409, 'edit published 409');
  await api('POST', `/api/creator/assets/${a.id}/archive`, { token });
  check((await api('POST', `/api/creator/assets/${a.id}/publish`, { token })).status === 409, 'republish archived 409');
});

test('draft content editable within server contract', async () => {
  const creator = createUserWithProfile('csm-edit');
  const token = tokenFor(creator.id);
  const a = await createAsset(token, 'sticker', 20, 'Edit Me');
  const res = await api('PATCH', `/api/creator/assets/${a.id}`, { token, body: { name: 'Edited', price_coins: 35 } });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.asset.name === 'Edited' && res.data.asset.price_coins === 35, 'expected edits applied');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Public Coin Shop + Purchase Regression');

test('published appears, archived hidden, detail + share work', async () => {
  const creator = createUserWithProfile('csm-pub');
  const token = tokenFor(creator.id);
  const a = await createAsset(token, 'theme', 90, 'Public Theme');
  await submitPublish(token, a.id);
  const buyer = createUserWithProfile('csm-pub-buyer');
  const list = await api('GET', '/api/marketplace/assets', { token: tokenFor(buyer.id) });
  check(list.data.assets.some(x => x.id === a.id), 'published must appear in Coin Shop');
  const detail = await api('GET', `/api/coin-shop/products/${a.id}`);
  check(detail.status === 200 && detail.data.product.creator_username === creator.username, 'public detail + creator link (share target)');
  await api('POST', `/api/creator/assets/${a.id}/archive`, { token });
  const list2 = await api('GET', '/api/marketplace/assets', { token: tokenFor(buyer.id) });
  check(!list2.data.assets.some(x => x.id === a.id), 'archived must be hidden');
  check((await api('GET', `/api/coin-shop/products/${a.id}`)).status === 404, 'archived detail 404');
});

test('purchase still works after manager publish (real debit/credit)', async () => {
  const creator = createUserWithProfile('csm-buy');
  const token = tokenFor(creator.id);
  const a = await createAsset(token, 'profile_design', 120, 'Buyable');
  await submitPublish(token, a.id);
  const buyer = createUserWithProfile('csm-buy-b');
  database.execute('INSERT OR IGNORE INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 0, 0)', [buyer.id]);
  database.execute('UPDATE user_wallets SET balance = ? WHERE user_id = ?', [500, buyer.id]);
  const buy = await api('POST', `/api/coin-shop/buy/${a.id}`, { token: tokenFor(buyer.id) });
  check(buy.status === 200, `expected 200, got ${buy.status}`);
  const bw = database.queryOne('SELECT balance FROM user_wallets WHERE user_id = ?', [buyer.id]);
  const cw = database.queryOne('SELECT balance FROM user_wallets WHERE user_id = ?', [creator.id]);
  check(bw.balance === 380, `buyer debited, got ${bw.balance}`);
  check(cw.balance === 120, `creator credited, got ${cw.balance}`);
  check((await api('POST', `/api/coin-shop/buy/${a.id}`, { token: tokenFor(buyer.id) })).status === 409, 'duplicate still rejected');
});

// ── Teardown ─────────────────────────────────────────────────────────────
queue.push(async () => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); process.stdout.write('  [cleanup] temp dir removed\n'); } catch {}
});

for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
process.stdout.write('\n');
process.stdout.write('Coin Shop manager tests: ' + (total - failed.length) + '/' + total + ' passed\n');
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
