/**
 * COINS-02A — Locked reward coin accounting test suite.
 *
 * Run:   npm run test:coin-rewards
 *
 * Covers:
 *   - identity reward: exactly 15, locked, once, idempotent
 *   - locked-reward migration backfill (no double award, balances preserved)
 *   - gift restrictions against transferable balance
 *   - received gifts are transferable (and re-giftable)
 *   - cash-out restrictions (locked never withdrawable)
 *   - personal spending consumes locked-first (Coin Shop purchase)
 *   - atomicity of failed reward/purchase/gift operations
 *
 * Throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-rewards-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-rewards.db');
process.env.PORT = String(19300 + (process.pid % 600));
process.env.PAYMONGO_WEBHOOK_SECRET = 'coins-02a-test-webhook-secret';
process.env.SECRET_KEY = 'coins-02a-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'rewards-admin';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ── Imports ────────────────────────────────────────────────────────────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const auth = await import(mod('server/auth.js'));
const coins = await import(mod('server/coins.js'));
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
function createUserWithProfile(username, displayName = null) {
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
    [randomUUID(), id, displayName || username, ts, ts]
  );
  return { id, username };
}
function tokenFor(userId) { return auth.createToken(userId, 'access'); }
function fund(userId, amount) {
  database.execute('INSERT OR IGNORE INTO user_wallets (user_id, balance, frozen_balance, locked_reward_balance) VALUES (?, 0, 0, 0)', [userId]);
  database.execute('UPDATE user_wallets SET balance = ?, frozen_balance = 0 WHERE user_id = ?', [amount, userId]);
}
function walletOf(userId) {
  return database.queryOne('SELECT balance, frozen_balance, locked_reward_balance FROM user_wallets WHERE user_id = ?', [userId]);
}
function notificationsFor(userId) {
  return database.queryAll('SELECT id FROM notifications WHERE user_id = ?', [userId]);
}
function verifyUser(userId) {
  const ts = new Date().toISOString();
  database.execute(
    `INSERT INTO identity_verifications (id, user_id, legal_name, birthday, address, status, submitted_at, verified_at, reward_awarded, created_at, updated_at)
     VALUES (?, ?, 'Test Person', '1990-01-01', '123 Test Street, Test City', 'verified', ?, ?, 0, ?, ?)`,
    [randomUUID(), userId, ts, ts, ts, ts]
  );
}
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
async function publishPricedAsset(creatorId, price, name = 'Reward Test Asset') {
  const token = tokenFor(creatorId);
  const c = await api('POST', '/api/creator/assets', {
    token,
    body: { name, description: 'd', asset_type: 'profile_design', asset_data: designSnapshot(), price_coins: price },
  });
  check(c.status === 201, `create asset: ${c.status}`);
  await api('POST', `/api/creator/assets/${c.data.asset.id}/submit`, { token });
  await api('POST', `/api/creator/assets/${c.data.asset.id}/publish`, { token });
  return c.data.asset.id;
}

// ═══════════════════════════════════════════════════════════════════════════
group('Identity Reward');

test('first verification awards exactly 15 locked coins', async () => {
  const u = createUserWithProfile('rw-first');
  fund(u.id, 0);
  verifyUser(u.id);
  const res = coins.awardVerificationReward(u.id);
  check(res.awarded === true, 'expected awarded');
  const w = walletOf(u.id);
  check(w.balance === 15, `balance 15, got ${w.balance}`);
  check(w.locked_reward_balance === 15, `locked 15, got ${w.locked_reward_balance}`);
  const bal = coins.getCoinBalance(u.id);
  check(bal.transferable_available === 0, `transferable 0, got ${bal.transferable_available}`);
});

test('second reward attempt awards zero additional coins', async () => {
  const u = createUserWithProfile('rw-once');
  verifyUser(u.id);
  coins.awardVerificationReward(u.id);
  const again = coins.awardVerificationReward(u.id);
  check(again.awarded === false, 'expected not awarded');
  const w = walletOf(u.id);
  check(w.balance === 15 && w.locked_reward_balance === 15, 'unchanged at 15/15');
  const rows = database.queryAll(
    `SELECT id FROM coin_transactions WHERE user_id = ? AND type = 'verification_reward'`, [u.id]
  );
  check(rows.length === 1, `exactly one ledger row, got ${rows.length}`);
  const flag = database.queryOne('SELECT reward_awarded FROM identity_verifications WHERE user_id = ?', [u.id]);
  check(flag.reward_awarded === 1, 'reward_awarded flag set');
});

test('repeated processing stays idempotent', async () => {
  const u = createUserWithProfile('rw-idem');
  verifyUser(u.id);
  for (let i = 0; i < 3; i++) coins.awardVerificationReward(u.id);
  const w = walletOf(u.id);
  check(w.balance === 15 && w.locked_reward_balance === 15, 'still exactly 15 locked');
});

test('reward without verified record throws, no rows', async () => {
  const u = createUserWithProfile('rw-none');
  const beforeTx = database.queryOne('SELECT COUNT(*) as c FROM coin_transactions').c;
  let threw = false;
  try { coins.awardVerificationReward(u.id); } catch { threw = true; }
  check(threw, 'expected throw');
  check(database.queryOne('SELECT COUNT(*) as c FROM coin_transactions').c === beforeTx, 'no ledger rows');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Migration Backfill');

test('legacy rewarded wallet is classified without double award', async () => {
  const u = createUserWithProfile('rw-legacy');
  fund(u.id, 100);
  verifyUser(u.id);
  // Simulate a pre-COINS-02A issuance: ledger row exists (referencing the
  // verification record, exactly as the legacy flow wrote it), nothing locked.
  const rec = database.queryOne('SELECT id FROM identity_verifications WHERE user_id = ?', [u.id]);
  database.execute(
    `INSERT INTO coin_transactions (id, user_id, amount, direction, type, reference_type, reference_id, description, balance_before, balance_after)
     VALUES (?, ?, 15, 'credit', 'verification_reward', 'identity_verification', ?, 'legacy reward', 100, 115)`,
    [randomUUID(), u.id, rec.id]
  );
  database.execute('UPDATE user_wallets SET balance = 115, locked_reward_balance = 0 WHERE user_id = ?', [u.id]);
  database.execute('UPDATE identity_verifications SET reward_awarded = 1 WHERE user_id = ?', [u.id]);
  // Restart-equivalent: re-run schema init against the same file.
  database.closeDatabase();
  database.initDatabase();
  const w = walletOf(u.id);
  check(w.balance === 115, `balance preserved, got ${w.balance}`);
  check(w.locked_reward_balance === 15, `locked classified 15, got ${w.locked_reward_balance}`);
  const rows = database.queryAll(
    `SELECT id FROM coin_transactions WHERE user_id = ? AND type = 'verification_reward'`, [u.id]
  );
  check(rows.length === 1, `no duplicate reward, got ${rows.length}`);
});

test('backfill never locks more than held', async () => {
  const u = createUserWithProfile('rw-legacy-spent');
  fund(u.id, 5);
  verifyUser(u.id);
  const rec2 = database.queryOne('SELECT id FROM identity_verifications WHERE user_id = ?', [u.id]);
  database.execute(
    `INSERT INTO coin_transactions (id, user_id, amount, direction, type, reference_type, reference_id, description, balance_before, balance_after)
     VALUES (?, ?, 15, 'credit', 'verification_reward', 'identity_verification', ?, 'legacy reward', 0, 15)`,
    [randomUUID(), u.id, rec2.id]
  );
  database.execute('UPDATE identity_verifications SET reward_awarded = 1 WHERE user_id = ?', [u.id]);
  database.closeDatabase();
  database.initDatabase();
  const w = walletOf(u.id);
  check(w.locked_reward_balance === 5, `capped at held 5, got ${w.locked_reward_balance}`);
  check(w.balance === 5, 'balance untouched');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Gift Restrictions');

test('locked-only wallet cannot gift', async () => {
  const sender = createUserWithProfile('rw-gift-locked');
  const receiver = createUserWithProfile('rw-gift-locked-r');
  verifyUser(sender.id);
  coins.awardVerificationReward(sender.id);
  const res = await api('POST', '/api/coins/gift', {
    token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 1, idempotency_key: randomUUID() },
  });
  check(res.status === 422, `expected 422, got ${res.status}`);
  check(walletOf(sender.id).balance === 15, 'sender untouched');
  check(notificationsFor(receiver.id).length === 0, 'no notification');
});

test('50 locked + 100 transferable gifts exactly 100', async () => {
  const sender = createUserWithProfile('rw-gift-mix');
  const receiver = createUserWithProfile('rw-gift-mix-r');
  fund(sender.id, 100);
  coins.awardLockedRewardCoins({ userId: sender.id, amount: 25, type: 'earn', description: 'test reward 1', referenceType: 'test_reward', referenceId: randomUUID() });
  coins.awardLockedRewardCoins({ userId: sender.id, amount: 25, type: 'earn', description: 'test reward 2', referenceType: 'test_reward', referenceId: randomUUID() });
  let w = walletOf(sender.id);
  check(w.balance === 150 && w.locked_reward_balance === 50, `150/50, got ${w.balance}/${w.locked_reward_balance}`);
  const ok = await api('POST', '/api/coins/gift', {
    token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 100, idempotency_key: randomUUID() },
  });
  check(ok.status === 200, `gift 100: ${ok.status}`);
  w = walletOf(sender.id);
  check(w.balance === 50 && w.locked_reward_balance === 50, `locked intact 50/50, got ${w.balance}/${w.locked_reward_balance}`);
  const over = await api('POST', '/api/coins/gift', {
    token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 1, idempotency_key: randomUUID() },
  });
  check(over.status === 422, `gift beyond transferable 422, got ${over.status}`);
});

test('spec example: 150 total, 50 locked → gift 101 rejected', async () => {
  const sender = createUserWithProfile('rw-gift-101');
  const receiver = createUserWithProfile('rw-gift-101-r');
  fund(sender.id, 100);
  coins.awardLockedRewardCoins({ userId: sender.id, amount: 50, type: 'earn', description: 'test reward', referenceType: 'test_reward', referenceId: randomUUID() });
  const res = await api('POST', '/api/coins/gift', {
    token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 101, idempotency_key: randomUUID() },
  });
  check(res.status === 422, `expected 422, got ${res.status}`);
  check(walletOf(sender.id).balance === 150, 'untouched');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Received Gifts Are Transferable');

test('receiver gets transferable coins and can re-gift', async () => {
  const alice = createUserWithProfile('rw-regift-a');
  const bob = createUserWithProfile('rw-regift-b');
  const carol = createUserWithProfile('rw-regift-c');
  fund(alice.id, 100);
  verifyUser(alice.id);
  coins.awardVerificationReward(alice.id); // alice: 115 total, 15 locked, 100 transferable
  const g1 = await api('POST', '/api/coins/gift', {
    token: tokenFor(alice.id), body: { recipient: bob.username, amount: 25, idempotency_key: randomUUID() },
  });
  check(g1.status === 200, `alice gifts 25: ${g1.status}`);
  check(walletOf(alice.id).locked_reward_balance === 15, 'alice locked intact');
  const wb = walletOf(bob.id);
  check(wb.balance === 25 && wb.locked_reward_balance === 0, `bob 25 transferable, got ${wb.balance}/${wb.locked_reward_balance}`);
  const g2 = await api('POST', '/api/coins/gift', {
    token: tokenFor(bob.id), body: { recipient: carol.username, amount: 25, idempotency_key: randomUUID() },
  });
  check(g2.status === 200, `bob re-gifts 25: ${g2.status}`);
  check(walletOf(carol.id).balance === 25, 'carol received');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Cash Out Restrictions');

test('locked coins cannot be withdrawn, transferable can', async () => {
  const u = createUserWithProfile('rw-cashout');
  fund(u.id, 100);
  verifyUser(u.id);
  coins.awardVerificationReward(u.id); // 115 total, 15 locked, 100 transferable
  const token = tokenFor(u.id);
  const over = await api('POST', '/api/coins/withdraw', {
    token, body: { coins_amount: 101, payment_method: 'gcash', account_number: '09170000000', account_name: 'Tester' },
  });
  check(over.status === 422, `withdraw 101 (only 100 transferable): ${over.status}`);
  const ok = await api('POST', '/api/coins/withdraw', {
    token, body: { coins_amount: 100, payment_method: 'gcash', account_number: '09170000000', account_name: 'Tester' },
  });
  check(ok.status === 200 || ok.status === 201, `withdraw 100: ${ok.status}`);
  const w = walletOf(u.id);
  check(w.frozen_balance === 100, `frozen 100, got ${w.frozen_balance}`);
  check(w.locked_reward_balance === 15, `locked intact, got ${w.locked_reward_balance}`);
  check(w.balance === 115, 'total unchanged (frozen, not settled)');
});

test('locked-only wallet cannot withdraw', async () => {
  const u = createUserWithProfile('rw-cashout-locked');
  verifyUser(u.id);
  coins.awardVerificationReward(u.id);
  const res = await api('POST', '/api/coins/withdraw', {
    token: tokenFor(u.id), body: { coins_amount: 100, payment_method: 'maya', account_number: '09170000001', account_name: 'Tester' },
  });
  check(res.status === 422, `expected 422, got ${res.status}`);
});

// ═══════════════════════════════════════════════════════════════════════════
group('Personal Spending');

test('spec example: spend 30 consumes locked first', async () => {
  const creator = createUserWithProfile('rw-spend-creator');
  const assetId = await publishPricedAsset(creator.id, 30);
  const buyer = createUserWithProfile('rw-spend-buyer');
  fund(buyer.id, 100);
  coins.awardLockedRewardCoins({ userId: buyer.id, amount: 25, type: 'earn', description: 'r1', referenceType: 'test_reward', referenceId: randomUUID() });
  coins.awardLockedRewardCoins({ userId: buyer.id, amount: 25, type: 'earn', description: 'r2', referenceType: 'test_reward', referenceId: randomUUID() });
  // Total 150, locked 50, transferable 100.
  const buy = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyer.id) });
  check(buy.status === 200, `buy 30: ${buy.status}: ${JSON.stringify(buy.data)}`);
  const w = walletOf(buyer.id);
  check(w.balance === 120, `total 120, got ${w.balance}`);
  check(w.locked_reward_balance === 20, `locked 20, got ${w.locked_reward_balance}`);
  check(w.balance - w.frozen_balance - w.locked_reward_balance === 100, 'transferable still 100');
  // Spent locked coins cannot later be gifted: only 100 transferable.
  const gift = await api('POST', '/api/coins/gift', {
    token: tokenFor(buyer.id), body: { recipient: creator.username, amount: 101, idempotency_key: randomUUID() },
  });
  check(gift.status === 422, `gift 101 after spend: ${gift.status}`);
});

test('locked-only buyer can afford a small purchase', async () => {
  const creator = createUserWithProfile('rw-spend-creator2');
  const assetId = await publishPricedAsset(creator.id, 10);
  const buyer = createUserWithProfile('rw-spend-lockedonly');
  verifyUser(buyer.id);
  coins.awardVerificationReward(buyer.id); // 15 locked, 0 transferable
  const buy = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyer.id) });
  check(buy.status === 200, `buy with locked: ${buy.status}`);
  const w = walletOf(buyer.id);
  check(w.balance === 5 && w.locked_reward_balance === 5, `5/5, got ${w.balance}/${w.locked_reward_balance}`);
});

test('overspend purchase fails with no partial state', async () => {
  const creator = createUserWithProfile('rw-spend-creator3');
  const assetId = await publishPricedAsset(creator.id, 200);
  const buyer = createUserWithProfile('rw-spend-overspend');
  fund(buyer.id, 100);
  verifyUser(buyer.id);
  coins.awardVerificationReward(buyer.id); // 115 total
  const before = walletOf(buyer.id);
  const buy = await api('POST', `/api/coin-shop/buy/${assetId}`, { token: tokenFor(buyer.id) });
  check(buy.status === 402, `expected 402, got ${buy.status}`);
  const after = walletOf(buyer.id);
  check(JSON.stringify(after) === JSON.stringify(before), 'wallet untouched');
  check(database.queryAll('SELECT id FROM purchased_assets WHERE buyer_user_id = ?', [buyer.id]).length === 0, 'no purchase row');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Atomicity');

test('failed reward claims leave no partial state', async () => {
  const u = createUserWithProfile('rw-atom-reward');
  const beforeTx = database.queryOne('SELECT COUNT(*) as c FROM coin_transactions').c;
  let threw = false;
  try {
    coins.awardLockedRewardCoins({ userId: u.id, amount: 10, type: 'earn', description: 'x', referenceType: '', referenceId: '' });
  } catch { threw = true; }
  check(threw, 'expected throw on missing reference');
  check(database.queryOne('SELECT COUNT(*) as c FROM coin_transactions').c === beforeTx, 'no ledger rows');
  check(!database.queryOne('SELECT user_id FROM user_wallets WHERE user_id = ?', [u.id]) || walletOf(u.id).balance === 0, 'no credited wallet');
});

// ── Teardown ─────────────────────────────────────────────────────────────
queue.push(async () => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); process.stdout.write('  [cleanup] temp dir removed\n'); } catch {}
});

for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
process.stdout.write('\n');
process.stdout.write('Coin rewards tests: ' + (total - failed.length) + '/' + total + ' passed\n');
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
