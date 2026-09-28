/**
 * COINS-02 — Gift Coins + receiver notification test suite.
 *
 * Run:   npm run test:coin-gift
 *
 * Covers:
 *   - recipient search (auth, username/display-name, limits, no private data)
 *   - gift validation (recipient, self, amount shapes, balance, frozen)
 *   - successful gift (balances, both ledger entries, receiver notification)
 *   - atomicity (failures leave zero partial rows)
 *   - idempotency (replayed key settles exactly once)
 *   - notification API (list, unread count, mark read, isolation, link)
 *
 * Throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-gift-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-gift.db');
process.env.PORT = String(19400 + (process.pid % 700));
process.env.PAYMONGO_WEBHOOK_SECRET = 'coins-02-test-webhook-secret';
process.env.SECRET_KEY = 'coins-02-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'gift-admin';

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
  return { id, username, displayName: displayName || username };
}
function tokenFor(userId) { return auth.createToken(userId, 'access'); }
function fund(userId, amount) {
  database.execute('INSERT OR IGNORE INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 0, 0)', [userId]);
  database.execute('UPDATE user_wallets SET balance = ?, frozen_balance = 0 WHERE user_id = ?', [amount, userId]);
}
function balanceOf(userId) {
  return database.queryOne('SELECT balance, frozen_balance FROM user_wallets WHERE user_id = ?', [userId]);
}
function giftRows(key) {
  // One idempotent gift = two ledger legs (:out debit, :in credit).
  return database.queryAll(
    `SELECT user_id, direction, type, reference_id FROM coin_transactions
     WHERE reference_type = 'coin_gift' AND reference_id IN (?, ?)`,
    [`gift:${key}:out`, `gift:${key}:in`]
  );
}
function notificationsFor(userId) {
  return database.queryAll('SELECT * FROM notifications WHERE user_id = ?', [userId]);
}

// ═══════════════════════════════════════════════════════════════════════════
group('Recipient Search');

test('search requires authentication', async () => {
  const res = await api('GET', '/api/users/search?q=ab');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('short query returns empty', async () => {
  const u = createUserWithProfile('gift-searcher');
  const res = await api('GET', '/api/users/search?q=a', { token: tokenFor(u.id) });
  check(res.status === 200 && res.data.users.length === 0, 'expected empty for short query');
});

test('username and display-name search work', async () => {
  const me = createUserWithProfile('gift-me');
  createUserWithProfile('gift-alice', 'Alice Wonder');
  createUserWithProfile('gift-bob', 'Bobby Tables');
  const token = tokenFor(me.id);
  const byUser = await api('GET', '/api/users/search?q=gift-alice', { token });
  check(byUser.data.users.some(u => u.username === 'gift-alice'), 'expected username match');
  const byName = await api('GET', '/api/users/search?q=Bobby', { token });
  check(byName.data.users.some(u => u.username === 'gift-bob'), 'expected display-name match');
});

test('search exposes no private data, flags self', async () => {
  const me = createUserWithProfile('gift-priv');
  createUserWithProfile('gift-priv-other');
  const res = await api('GET', '/api/users/search?q=gift-priv', { token: tokenFor(me.id) });
  check(res.data.users.length > 0, 'expected results');
  for (const u of res.data.users) {
    const keys = Object.keys(u).sort().join(',');
    check(keys === 'display_name,id,is_self,profile_photo_url,username', `private data leaked: ${keys}`);
  }
  const self = res.data.users.find(u => u.id === me.id);
  check(self && self.is_self === true, 'expected self flagged');
  check(res.data.users.length <= 10, 'expected result limit');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Gift Validation');

test('gift requires authentication', async () => {
  const res = await api('POST', '/api/coins/gift', { body: { recipient: 'x', amount: 10 } });
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('missing/invalid recipient rejected', async () => {
  const sender = createUserWithProfile('gift-val-sender');
  fund(sender.id, 500);
  const token = tokenFor(sender.id);
  check((await api('POST', '/api/coins/gift', { token, body: { amount: 10 } })).status === 422, 'missing recipient 422');
  check((await api('POST', '/api/coins/gift', { token, body: { recipient: 'no-such-user-xyz', amount: 10 } })).status === 404, 'unknown recipient 404');
});

test('self-gift rejected', async () => {
  const sender = createUserWithProfile('gift-selfie');
  fund(sender.id, 500);
  const token = tokenFor(sender.id);
  check((await api('POST', '/api/coins/gift', { token, body: { recipient: 'gift-selfie', amount: 10 } })).status === 422, 'self by username 422');
  check((await api('POST', '/api/coins/gift', { token, body: { recipient: sender.id, amount: 10 } })).status === 422, 'self by id 422');
});

test('bad amounts rejected', async () => {
  const sender = createUserWithProfile('gift-amounts');
  const receiver = createUserWithProfile('gift-amounts-r');
  fund(sender.id, 500);
  const token = tokenFor(sender.id);
  const cases = [
    [{ recipient: receiver.username }, 'missing amount'],
    [{ recipient: receiver.username, amount: 0 }, 'zero'],
    [{ recipient: receiver.username, amount: -5 }, 'negative'],
    [{ recipient: receiver.username, amount: 2.5 }, 'decimal'],
    [{ recipient: receiver.username, amount: '100' }, 'string'],
  ];
  for (const [body, label] of cases) {
    const res = await api('POST', '/api/coins/gift', { token, body });
    check(res.status === 422, `expected 422 for ${label}, got ${res.status}`);
  }
});

test('insufficient and frozen-respecting balance rejected', async () => {
  const sender = createUserWithProfile('gift-poor');
  const receiver = createUserWithProfile('gift-poor-r');
  fund(sender.id, 50);
  const token = tokenFor(sender.id);
  check((await api('POST', '/api/coins/gift', { token, body: { recipient: receiver.username, amount: 100 } })).status === 422, 'insufficient 422');
  // Freeze 400 of 500: available 100, gift of 200 must fail on frozen funds.
  fund(sender.id, 500);
  const wd = await api('POST', '/api/coins/withdraw', {
    token, body: { coins_amount: 400, payment_method: 'gcash', account_number: '09170000000', account_name: 'Tester' },
  });
  check(wd.status === 200 || wd.status === 201, `withdrawal setup: ${wd.status}`);
  check((await api('POST', '/api/coins/gift', { token, body: { recipient: receiver.username, amount: 200 } })).status === 422, 'frozen funds 422');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Successful Gift');

test('balances move and response is authoritative', async () => {
  const sender = createUserWithProfile('gift-ok-s', 'John Doe');
  const receiver = createUserWithProfile('gift-ok-r', 'Jane Smith');
  fund(sender.id, 1250);
  fund(receiver.id, 0);
  const res = await api('POST', '/api/coins/gift', {
    token: tokenFor(sender.id),
    body: { recipient: receiver.username, amount: 100, idempotency_key: randomUUID() },
  });
  check(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
  check(res.data.gift.amount === 100, 'expected amount');
  check(res.data.gift.recipient.username === receiver.username, 'expected recipient username');
  check(res.data.gift.recipient.display_name === 'Jane Smith', 'expected recipient display name');
  check(res.data.wallet.balance === 1150, `expected sender wallet 1150, got ${res.data.wallet.balance}`);
  check(balanceOf(sender.id).balance === 1150, 'sender debited');
  check(balanceOf(receiver.id).balance === 100, 'receiver credited');
});

test('ledger has exactly one debit + one credit gift pair', async () => {
  const sender = createUserWithProfile('gift-ledger-s');
  const receiver = createUserWithProfile('gift-ledger-r');
  fund(sender.id, 500);
  const key = randomUUID();
  await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 60, idempotency_key: key } });
  const rows = giftRows(key);
  check(rows.length === 2, `expected 2 ledger rows, got ${rows.length}`);
  const debit = rows.find(r => r.direction === 'debit');
  const credit = rows.find(r => r.direction === 'credit');
  check(debit && debit.user_id === sender.id && debit.type === 'gift', 'sender gift debit');
  check(credit && credit.user_id === receiver.id && credit.type === 'gift', 'receiver gift credit');
  const sTx = database.queryOne(
    `SELECT description, balance_before, balance_after FROM coin_transactions WHERE user_id = ? AND reference_id = ? AND direction = 'debit'`,
    [sender.id, `gift:${key}:out`]
  );
  check(sTx.description.includes('Gift Sent') && sTx.description.includes(receiver.username), 'sender description');
  check(sTx.balance_before === 500 && sTx.balance_after === 440, 'sender running balances');
  const rTx = database.queryOne(
    `SELECT description, balance_before, balance_after FROM coin_transactions WHERE user_id = ? AND reference_id = ? AND direction = 'credit'`,
    [receiver.id, `gift:${key}:in`]
  );
  check(rTx.description.includes('Gift Received'), 'receiver description');
  check(rTx.balance_before === 0 && rTx.balance_after === 60, 'receiver running balances');
});

test('receiver notification created, sender gets none', async () => {
  const sender = createUserWithProfile('gift-notif-s', 'John Doe');
  const receiver = createUserWithProfile('gift-notif-r', 'Jane Smith');
  fund(sender.id, 500);
  const key = randomUUID();
  await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 100, idempotency_key: key } });
  const rNotifs = notificationsFor(receiver.id);
  check(rNotifs.length === 1, `expected 1 receiver notification, got ${rNotifs.length}`);
  const n = rNotifs[0];
  check(n.type === 'coin_gift', 'expected coin_gift type');
  check(n.body === 'You received 100 Coins from John Doe (@gift-notif-s).', `unexpected body: ${n.body}`);
  check(n.is_read === 0, 'must start unread');
  check(n.link === '#/wallet', 'must link to Coins context');
  check(n.reference_type === 'coin_gift' && n.reference_id === `gift:${key}`, 'must reference the gift');
  check(notificationsFor(sender.id).length === 0, 'sender must not receive the receiver notification');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Atomicity');

test('failed gifts leave zero partial rows', async () => {
  const sender = createUserWithProfile('gift-atom-s');
  const receiver = createUserWithProfile('gift-atom-r');
  fund(sender.id, 30);
  const beforeTx = database.queryOne('SELECT COUNT(*) as c FROM coin_transactions').c;
  const beforeNotif = database.queryOne('SELECT COUNT(*) as c FROM notifications').c;
  // Insufficient balance.
  check((await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 999, idempotency_key: randomUUID() } })).status === 422, 'insufficient 422');
  // Unknown recipient.
  check((await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body: { recipient: 'ghost-xyz', amount: 10, idempotency_key: randomUUID() } })).status === 404, 'unknown 404');
  // Self gift.
  check((await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body: { recipient: sender.id, amount: 10, idempotency_key: randomUUID() } })).status === 422, 'self 422');
  check(balanceOf(sender.id).balance === 30, 'sender balance unchanged');
  check(database.queryOne('SELECT COUNT(*) as c FROM coin_transactions').c === beforeTx, 'no partial ledger rows');
  check(database.queryOne('SELECT COUNT(*) as c FROM notifications').c === beforeNotif, 'no orphan notifications');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Idempotency');

test('replayed key settles exactly once', async () => {
  const sender = createUserWithProfile('gift-idem-s');
  const receiver = createUserWithProfile('gift-idem-r');
  fund(sender.id, 500);
  const key = randomUUID();
  const body = { recipient: receiver.username, amount: 75, idempotency_key: key };
  const first = await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body });
  check(first.status === 200 && first.data.gift.duplicate === false, 'first completes');
  const second = await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body });
  check(second.status === 200 && second.data.gift.duplicate === true, 'replay flagged duplicate');
  check(second.data.gift.amount === 75, 'replay returns original amount');
  check(balanceOf(sender.id).balance === 425, 'debited once');
  check(balanceOf(receiver.id).balance === 75, 'credited once');
  check(giftRows(key).length === 2, 'exactly one ledger pair');
  check(notificationsFor(receiver.id).length === 1, 'exactly one notification');
});

test('different keys are independent gifts', async () => {
  const sender = createUserWithProfile('gift-idem2-s');
  const receiver = createUserWithProfile('gift-idem2-r');
  fund(sender.id, 500);
  for (const k of [randomUUID(), randomUUID()]) {
    const res = await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 10, idempotency_key: k } });
    check(res.status === 200 && res.data.gift.duplicate === false, 'each key completes');
  }
  check(balanceOf(sender.id).balance === 480, 'debited twice');
  check(notificationsFor(receiver.id).length === 2, 'two notifications');
});

// ═══════════════════════════════════════════════════════════════════════════
group('Notification API');

test('list, unread count, mark read, isolation', async () => {
  const sender = createUserWithProfile('gift-napi-s', 'John Doe');
  const receiver = createUserWithProfile('gift-napi-r');
  const other = createUserWithProfile('gift-napi-o');
  fund(sender.id, 500);
  await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 42, idempotency_key: randomUUID() } });
  const rToken = tokenFor(receiver.id);
  const list = await api('GET', '/api/notifications', { token: rToken });
  check(list.status === 200 && list.data.notifications.length === 1, 'receiver lists 1');
  check(list.data.notifications[0].body.includes('42 Coins'), 'body has amount');
  const unread = await api('GET', '/api/notifications/unread-count', { token: rToken });
  check(unread.data.unread_count === 1, 'unread badge count 1');
  const nid = list.data.notifications[0].id;
  check((await api('POST', `/api/notifications/${nid}/read`, { token: tokenFor(other.id) })).status === 404, 'cross-user read 404');
  check((await api('POST', `/api/notifications/${nid}/read`, { token: rToken })).status === 200, 'mark read 200');
  check((await api('GET', '/api/notifications/unread-count', { token: rToken })).data.unread_count === 0, 'badge clears');
  check((await api('GET', '/api/notifications', { token: tokenFor(other.id) })).data.notifications.length === 0, 'isolation');
});

test('mark-all-read and auth enforcement', async () => {
  check((await api('GET', '/api/notifications')).status === 401, 'list 401');
  check((await api('GET', '/api/notifications/unread-count')).status === 401, 'count 401');
  const sender = createUserWithProfile('gift-nall-s');
  const receiver = createUserWithProfile('gift-nall-r');
  fund(sender.id, 500);
  await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 5, idempotency_key: randomUUID() } });
  await api('POST', '/api/coins/gift', { token: tokenFor(sender.id), body: { recipient: receiver.username, amount: 6, idempotency_key: randomUUID() } });
  const rToken = tokenFor(receiver.id);
  check((await api('GET', '/api/notifications/unread-count', { token: rToken })).data.unread_count === 2, 'two unread');
  check((await api('POST', '/api/notifications/read-all', { token: rToken })).status === 200, 'read-all 200');
  check((await api('GET', '/api/notifications/unread-count', { token: rToken })).data.unread_count === 0, 'all cleared');
});

// ── Teardown ─────────────────────────────────────────────────────────────
queue.push(async () => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); process.stdout.write('  [cleanup] temp dir removed\n'); } catch {}
});

for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
process.stdout.write('\n');
process.stdout.write('Coin gift tests: ' + (total - failed.length) + '/' + total + ' passed\n');
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
