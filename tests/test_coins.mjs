/**
 * COINS-01 — Coin economy test suite.
 *
 * Run:   npm run test:coins
 *
 * Covers the hardened transactional coin ledger:
 *   - atomic credit/debit/freeze/unfreeze with before/after accounting
 *   - insufficient-balance protection (spend + freezer + cash_out)
 *   - idempotency: one ledger entry per (reference_type, reference_id, type)
 *   - PayMongo webhook credit + replay protection + signature validation
 *   - one-time 15-coin identity verification reward
 *   - full withdrawal lifecycle (freeze → approve=cash_out / reject=unfreeze)
 *   - admin adjust endpoint + authz
 *   - end-to-end ledger replay invariant
 *
 * Uses a throwaway SQLite database placed under the OS temp directory, so the
 * live data/komuniph.db is never touched.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHmac, randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-coins-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-coins.db');
process.env.PORT = String(18000 + (process.pid % 1800));
process.env.PAYMONGO_WEBHOOK_SECRET = 'coins-01-test-webhook-secret';
process.env.SECRET_KEY = 'coins-01-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ── Imports (server modules resolve config from the env above) ──────────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const coins = await import(mod('server/coins.js'));
const auth = await import(mod('server/auth.js'));
await import(mod('server/index.js')); // boots the HTTP server

await database.seedAdminUser();

// ── Tiny test harness ────────────────────────────────────────────────────────
const results = [];
const queue = [];
let groupName = '';

function group(name) {
  groupName = name;
}

// Tests are queued and executed strictly sequentially (they share wallet state).
function test(name, fn) {
  const full = `${groupName} › ${name}`;
  queue.push(async () => {
    try {
      await fn();
      results.push({ name: full, ok: true });
      process.stdout.write(`  ok   ${full}\n`);
    } catch (err) {
      results.push({ name: full, ok: false, error: err });
      process.stdout.write(`  FAIL ${full} — ${err.message}\n`);
    }
  });
}

function check(cond, msg = 'condition failed') {
  if (!cond) throw new Error(msg);
}

async function assertThrows(fn, pattern) {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    const needle = typeof pattern === 'function'
      ? pattern(err)
      : (String(err.message).includes(pattern) || err.code === pattern);
    if (pattern && !needle) {
      throw new Error(`expected error containing "${pattern}" but got: ${err.message} (code=${err.code})`);
    }
  }
  if (!threw) throw new Error('expected function to throw, but it did not');
}

// ── HTTP + mock helpers ──────────────────────────────────────────────────────
async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch { /* non-JSON body */ }
  return { status: res.status, data };
}

function makeReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const listeners = {};
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1', ...headers },
    on(evt, cb) { listeners[evt] = cb; return req; },
    flush() {
      if (body !== undefined && typeof listeners.data === 'function') {
        listeners.data(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      }
      if (typeof listeners.end === 'function') listeners.end();
    },
  };
  return req;
}

function makeRes() {
  const res = { chunks: [], headers: {}, status: 200, ended: false };
  res.writeHead = (status, headers) => {
    res.status = status;
    if (headers) Object.assign(res.headers, headers);
    return res;
  };
  res.write = (chunk) => { res.chunks.push(Buffer.from(String(chunk))); return true; };
  res.end = (chunk) => {
    if (chunk !== undefined) res.chunks.push(Buffer.from(String(chunk)));
    res.ended = true;
  };
  return res;
}

function bodyOf(res) {
  return JSON.parse(Buffer.concat(res.chunks).toString('utf8') || '{}');
}

async function callHandler(handler, req, res, ...args) {
  const promise = handler(req, res, ...args);
  req.flush();
  await promise;
  return res;
}

function paymongoSignature(rawBody) {
  const ts = String(Math.floor(Date.now() / 1000));
  const mac = createHmac('sha256', process.env.PAYMONGO_WEBHOOK_SECRET)
    .update(`${ts}.${rawBody}`)
    .digest('hex');
  return `v1=${mac},t=${ts}`;
}

function paymongoEvent(sourceId, status, amountCentavos, eventType = 'source.chargeable') {
  return JSON.stringify({
    data: {
      attributes: {
        type: eventType,
        data: { attributes: { id: sourceId, status, amount: amountCentavos } },
      },
    },
  });
}

function createUser(username) {
  const id = randomUUID();
  const ts = new Date().toISOString();
  database.execute(
    `INSERT INTO users (id, email, username, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
    [id, `${username.replace(/[^a-z0-9]/gi, '')}-${id.slice(0, 8)}@test.local`, username, 'unused', ts, ts]
  );
  return id;
}

function userToken(userId) {
  return auth.createToken(userId, 'access');
}

async function adminToken() {
  for (let i = 0; i < 40; i++) {
    const r = await api('POST', '/api/admin/login', { body: { username: 'admin', password: 'admin' } });
    if (r.status === 200 && r.data?.access_token) return r.data.access_token;
    await new Promise(re => setTimeout(re, 150));
  }
  throw new Error('Could not obtain admin token (admin seed incomplete)');
}

function walletOf(userId) {
  const row = database.queryOne('SELECT balance, frozen_balance FROM user_wallets WHERE user_id = ?', [userId]);
  return { balance: row?.balance ?? 0, frozen: row?.frozen_balance ?? 0, available: (row?.balance ?? 0) - (row?.frozen_balance ?? 0) };
}

function ledgerRows(userId) {
  return database.queryAll(
    `SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at ASC, rowid ASC`,
    [userId]
  );
}

/**
 * Replays the whole ledger for a user and asserts every row's before/after
 * balances reconcile with the movement rules, ending at the live wallet.
 */
function assertLedgerInvariant(userId) {
  const wallet = walletOf(userId);
  const rows = ledgerRows(userId);
  let available = 0;
  for (const row of rows) {
    check(Number(row.balance_before) === available,
      `row ${row.id} (${row.type}): balance_before ${row.balance_before} != running available ${available}`);
    let after = available;
    if (row.type === 'freeze') after = available - row.amount;
    else if (row.type === 'unfreeze') after = available + row.amount;
    else if (row.type === 'cash_out') after = available; // settles frozen reserves only
    else if (row.direction === 'credit') after = available + row.amount;
    else after = available - row.amount;
    check(Number(row.balance_after) === after,
      `row ${row.id} (${row.type}): balance_after ${row.balance_after} != expected ${after}`);
    available = after;
  }
  check(available === wallet.available,
    `replayed available ${available} != live available ${wallet.available}`);
  return rows;
}

// ════════════════════════════════════════════════════════════════════════════
// A. Ledger core
// ════════════════════════════════════════════════════════════════════════════
group('Ledger core');

let uidA;
test('creditCoins credits and writes a balanced ledger row', async () => {
  uidA = createUser('ledger-a');
  const txId = coins.creditCoins({ userId: uidA, amount: 100, type: 'earn', description: 'test credit' });
  check(typeof txId === 'string' && txId.length > 0, 'expected a transaction id');
  const row = database.queryOne('SELECT * FROM coin_transactions WHERE id = ?', [txId]);
  check(row.direction === 'credit', `expected direction credit, got ${row.direction}`);
  check(Number(row.balance_before) === 0 && Number(row.balance_after) === 100, 'before/after must be 0 → 100');
  check(walletOf(uidA).balance === 100, 'wallet balance must be 100');
  assertLedgerInvariant(uidA);
});

test('spend debit subtracts available balance', async () => {
  coins.debitCoins({ userId: uidA, amount: 40, type: 'spend', description: 'test spend' });
  check(walletOf(uidA).balance === 60, `expected 60, got ${walletOf(uidA).balance}`);
  assertLedgerInvariant(uidA);
});

test('spend with insufficient balance is rejected atomically', async () => {
  await assertThrows(
    () => coins.debitCoins({ userId: uidA, amount: 61, type: 'spend' }),
    'INSUFFICIENT_BALANCE'
  );
  check(walletOf(uidA).balance === 60, 'wallet must be unchanged after failed debit');
  check(walletOf(uidA).available === 60, 'available must be unchanged after failed debit');
  assertLedgerInvariant(uidA);
});

test('freeze moves available coins into the frozen reserve', async () => {
  coins.freezeCoins({ userId: uidA, amount: 50, description: 'freeze test', referenceType: 'withdrawal_request', referenceId: 'frz-1' });
  const w = walletOf(uidA);
  check(w.balance === 60 && w.frozen === 50 && w.available === 10, `wrong wallet after freeze: ${JSON.stringify(w)}`);
  assertLedgerInvariant(uidA);
});

test('unfreeze restores the frozen coins', async () => {
  coins.unfreezeCoins({ userId: uidA, amount: 50, description: 'unfreeze test', referenceType: 'withdrawal_request', referenceId: 'frz-1' });
  const w = walletOf(uidA);
  check(w.balance === 60 && w.frozen === 0 && w.available === 60, `wrong wallet after unfreeze: ${JSON.stringify(w)}`);
  assertLedgerInvariant(uidA);
});

test('over-freeze beyond available is rejected', async () => {
  await assertThrows(() => coins.freezeCoins({ userId: uidA, amount: 61 }), 'INSUFFICIENT_BALANCE');
  assertLedgerInvariant(uidA);
});

test('duplicate reference event cannot create a second ledger row', async () => {
  const uid = createUser('ledger-dup');
  const txId = coins.creditCoins({ userId: uid, amount: 25, type: 'earn', referenceType: 'test_earn', referenceId: 'evt-1' });
  check(typeof txId === 'string', 'first credit should succeed');
  await assertThrows(
    () => coins.recordTransaction(uid, 25, 'credit', 'earn', 'duplicate', 'test_earn', 'evt-1'),
    'UNIQUE constraint'
  );
  const count = database.queryOne(
    "SELECT COUNT(*) as c FROM coin_transactions WHERE user_id = ? AND reference_type = 'test_earn' AND reference_id = 'evt-1'",
    [uid]
  );
  check(count.c === 1, `expected exactly 1 ledger row, got ${count.c}`);
  assertLedgerInvariant(uid);
});

test('invalid ledger type, direction, and amounts are rejected', async () => {
  const uid = createUser('ledger-invalid');
  await assertThrows(() => coins.recordTransaction(uid, 0, 'credit', 'earn'), 'Invalid coin amount');
  await assertThrows(() => coins.recordTransaction(uid, 10, 'sideways', 'earn'), 'Invalid ledger direction');
  await assertThrows(() => coins.recordTransaction(uid, 10, 'credit', 'not_a_real_type'), 'Invalid ledger type');
  await assertThrows(() => coins.recordTransaction(uid, 10, 'credit', 'freeze'), 'must be recorded as a debit');
});

test('freeze with insufficient funds and cash_out above frozen reserve', async () => {
  const uid = createUser('ledger-frz');
  coins.creditCoins({ userId: uid, amount: 30, type: 'earn' });
  coins.freezeCoins({ userId: uid, amount: 30, referenceType: 'withdrawal_request', referenceId: 'w1' });
  await assertThrows(() => coins.recordTransaction(uid, 31, 'debit', 'cash_out', '', 'withdrawal_request', 'w1'), 'Cannot cash out more than the frozen balance');
  const w = walletOf(uid);
  check(w.balance === 30 && w.frozen === 30, 'wallet unchanged after failed cash_out');
  assertLedgerInvariant(uid);
});

// ════════════════════════════════════════════════════════════════════════════
// B. Wallet + history API (auth enforced, accounting fields exposed)
// ════════════════════════════════════════════════════════════════════════════
group('Wallet & history API');

test('wallet endpoint requires authentication', async () => {
  const r = await api('GET', '/api/coins/wallet');
  check(r.status === 401, `expected 401, got ${r.status}`);
});

test('wallet endpoint returns balance + exchange rate', async () => {
  const uid = createUser('http-wallet');
  coins.creditCoins({ userId: uid, amount: 200, type: 'earn' });
  const r = await api('GET', '/api/coins/wallet', { token: userToken(uid) });
  check(r.status === 200, `expected 200, got ${r.status}`);
  check(r.data.wallet.balance === 200, `balance ${r.data.wallet?.balance}`);
  check(r.data.wallet.available_balance === 200, 'available balance mismatch');
  check(r.data.exchange_rate.coins_per_php === 10, 'exchange rate mismatch');
});

test('transaction history exposes direction/balance_before/balance_after', async () => {
  const uid = createUser('http-history');
  coins.creditCoins({ userId: uid, amount: 50, type: 'earn', description: 'seen in history' });
  const r = await api('GET', '/api/coins/transactions', { token: userToken(uid) });
  check(r.status === 200, `expected 200, got ${r.status}`);
  check(r.data.transactions.length === 1, 'expected 1 ledger row');
  const tx = r.data.transactions[0];
  check(tx.direction === 'credit', 'direction missing');
  check(tx.balance_before === 0 && tx.balance_after === 50, 'before/after missing');
  check(tx.type === 'earn' && tx.description === 'seen in history', 'row payload mismatch');
});

// ════════════════════════════════════════════════════════════════════════════
// C. PayMongo webhook
// ════════════════════════════════════════════════════════════════════════════
group('PayMongo webhook');

test('webhook credits coins once (valid signature)', async () => {
  const uid = createUser('pm-credit');
  const topupId = randomUUID();
  database.execute(
    `INSERT INTO coin_topups (id, user_id, php_amount, coins_amount, payment_method, reference_number, status, paymongo_source_id, created_at, updated_at)
     VALUES (?, ?, 50, 500, 'gcash', NULL, 'pending', 'src_credit', datetime('now'), datetime('now'))`,
    [topupId, uid]
  );
  const raw = paymongoEvent('src_credit', 'chargeable', 5000);
  const req = makeReq({ method: 'POST', url: '/api/coins/paymongo/webhook', headers: { 'x-paymongo-signature': paymongoSignature(raw) }, body: raw });
  const res = makeRes();
  await callHandler(coins.handlePaymongoWebhook, req, res);
  const body = bodyOf(res);
  check(res.status === 200 && body.credited === true, `expected credited, got ${JSON.stringify(body)}`);
  check(walletOf(uid).balance === 500, `expected 500, got ${walletOf(uid).balance}`);
  assertLedgerInvariant(uid);
});

test('webhook replay is ignored (no double credit)', async () => {
  const raw = paymongoEvent('src_credit', 'chargeable', 5000);
  const req = makeReq({ method: 'POST', url: '/api/coins/paymongo/webhook', headers: { 'x-paymongo-signature': paymongoSignature(raw) }, body: raw });
  const res = makeRes();
  await callHandler(coins.handlePaymongoWebhook, req, res);
  check(bodyOf(res).already_processed === true, 'expected already_processed');
  const uid = database.queryOne(
    "SELECT user_id FROM coin_topups WHERE paymongo_source_id = 'src_credit'"
  );
  check(walletOf(uid.user_id).balance === 500, 'balance must still be 500 after replay');
  const count = database.queryOne(
    "SELECT COUNT(*) as c FROM coin_transactions WHERE reference_type = 'coin_topup'"
  );
  check(count.c === 1, `expected 1 cash_in row, got ${count.c}`);
});

test('webhook rejects a tampered signature', async () => {
  const uid = createUser('pm-tamper');
  database.execute(
    `INSERT INTO coin_topups (id, user_id, php_amount, coins_amount, payment_method, reference_number, status, paymongo_source_id, created_at, updated_at)
     VALUES (?, ?, 10, 100, 'gcash', NULL, 'pending', 'src_tamper', datetime('now'), datetime('now'))`,
    [randomUUID(), uid]
  );
  const raw = paymongoEvent('src_tamper', 'chargeable', 1000);
  const req = makeReq({ method: 'POST', url: '/api/coins/paymongo/webhook', headers: { 'x-paymongo-signature': 'v1=deadbeef,t=1' }, body: raw });
  const res = makeRes();
  await callHandler(coins.handlePaymongoWebhook, req, res);
  check(res.status === 401, `expected 401, got ${res.status}`);
  check(walletOf(uid).balance === 0, 'no credit on invalid signature');
});

test('webhook amount mismatch does not credit', async () => {
  const uid = createUser('pm-amount');
  database.execute(
    `INSERT INTO coin_topups (id, user_id, php_amount, coins_amount, payment_method, reference_number, status, paymongo_source_id, created_at, updated_at)
     VALUES (?, ?, 50, 500, 'gcash', NULL, 'pending', 'src_amount', datetime('now'), datetime('now'))`,
    [randomUUID(), uid]
  );
  const raw = paymongoEvent('src_amount', 'chargeable', 9999);
  const req = makeReq({ method: 'POST', url: '/api/coins/paymongo/webhook', headers: { 'x-paymongo-signature': paymongoSignature(raw) }, body: raw });
  const res = makeRes();
  await callHandler(coins.handlePaymongoWebhook, req, res);
  check(bodyOf(res).amount_mismatch === true, 'expected amount_mismatch');
  check(walletOf(uid).balance === 0, 'no credit on amount mismatch');
});

test('non-chargeable events are ignored', async () => {
  const raw = paymongoEvent('src_ignored', 'pending', 5000);
  const req = makeReq({ method: 'POST', url: '/api/coins/paymongo/webhook', headers: { 'x-paymongo-signature': paymongoSignature(raw) }, body: raw });
  const res = makeRes();
  await callHandler(coins.handlePaymongoWebhook, req, res);
  check(bodyOf(res).skipped === true, 'expected skipped');
});

// ════════════════════════════════════════════════════════════════════════════
// D. Identity verification reward
// ════════════════════════════════════════════════════════════════════════════
group('Identity verification reward');

test('first verified record awards exactly 15 coins once', async () => {
  const uid = createUser('reward-a');
  database.execute(
    `INSERT INTO identity_verifications (id, user_id, legal_name, birthday, address, status, submitted_at, verified_at, reward_awarded, review_notes, created_at, updated_at)
     VALUES (?, ?, 'Test Namer', '1990-01-01', 'Manila', 'verified', datetime('now'), datetime('now'), 0, NULL, datetime('now'), datetime('now'))`,
    [randomUUID(), uid]
  );
  const first = coins.awardVerificationReward(uid);
  check(first.awarded === true, `expected awarded=true, got ${JSON.stringify(first)}`);
  check(first.newBalance === 15, `expected 15, got ${first.newBalance}`);
  const w = walletOf(uid);
  check(w.balance === 15 && w.available === 15, `wrong wallet: ${JSON.stringify(w)}`);

  const again = coins.awardVerificationReward(uid);
  check(again.awarded === false, 'second call must not award again');
  check(again.newBalance === 15, 'balance must stay 15');

  const rows = ledgerRows(uid);
  check(rows.length === 1, `expected 1 ledger row, got ${rows.length}`);
  check(rows[0].type === 'verification_reward', `type ${rows[0].type}`);
  check(rows[0].amount === 15, `amount ${rows[0].amount}`);
  check(rows[0].reference_type === 'identity_verification' && rows[0].reference_id, 'reference must point at the verification record');

  const rec = database.queryOne("SELECT reward_awarded FROM identity_verifications WHERE user_id = ?", [uid]);
  check(rec.reward_awarded === 1, 'reward_awarded flag must be set');
  assertLedgerInvariant(uid);
});

test('reward shared between a second verified record cannot double-award', async () => {
  const uid = createUser('reward-b');
  database.execute(
    `INSERT INTO identity_verifications (id, user_id, status, reward_awarded, created_at, updated_at)
     VALUES (?, ?, 'pending', 0, datetime('now'), datetime('now'))`,
    [randomUUID(), uid]
  );
  database.execute(
    `INSERT INTO identity_verifications (id, user_id, status, reward_awarded, created_at, updated_at)
     VALUES (?, ?, 'verified', 1, datetime('now'), datetime('now'))`,
    [randomUUID(), uid]
  );
  const result = coins.awardVerificationReward(uid);
  check(result.awarded === false, 'must not award when a record already claims the reward');
  check(walletOf(uid).balance === 0, 'balance must be untouched');
});

test('reward requires an actually verified record', async () => {
  const uid = createUser('reward-c');
  database.execute(
    `INSERT INTO identity_verifications (id, user_id, status, reward_awarded, created_at, updated_at)
     VALUES (?, ?, 'pending', 0, datetime('now'), datetime('now'))`,
    [randomUUID(), uid]
  );
  await assertThrows(() => coins.awardVerificationReward(uid), 'No verified identity record');
  check(walletOf(uid).balance === 0, 'no credit without verified record');
});

// ════════════════════════════════════════════════════════════════════════════
// E. Withdrawal lifecycle via HTTP
// ════════════════════════════════════════════════════════════════════════════
group('Withdrawal lifecycle');

test('create withdrawal freezes exact available coins', async () => {
  const uid = createUser('wd-basic');
  const token = userToken(uid);
  coins.creditCoins({ userId: uid, amount: 300, type: 'earn' });
  const r = await api('POST', '/api/coins/withdraw', {
    token,
    body: { coins_amount: 120, payment_method: 'gcash', account_number: '09171234567', account_name: 'Test User' },
  });
  check(r.status === 201, `expected 201, got ${r.status}`);
  const w = walletOf(uid);
  check(w.balance === 300 && w.frozen === 120 && w.available === 180, `wrong wallet: ${JSON.stringify(w)}`);
  assertLedgerInvariant(uid);
  return { uid, wdId: r.data.withdrawal.id, token };
});

test('concurrent withdrawals cannot over-freeze the wallet', async () => {
  const uid = createUser('wd-race');
  const token = userToken(uid);
  coins.creditCoins({ userId: uid, amount: 250, type: 'earn' });

  const [a, b] = await Promise.all([
    api('POST', '/api/coins/withdraw', { token, body: { coins_amount: 200, payment_method: 'gcash', account_number: '1', account_name: 'A' } }),
    api('POST', '/api/coins/withdraw', { token, body: { coins_amount: 200, payment_method: 'maya', account_number: '2', account_name: 'B' } }),
  ]);

  const statuses = [a.status, b.status].sort();
  check(statuses[0] === 201 && statuses[1] === 422, `expected one 201 + one 422, got ${statuses.join(',')}`);
  const w = walletOf(uid);
  check(w.balance === 250 && w.frozen === 200 && w.available === 50, `wrong wallet: ${JSON.stringify(w)}`);
  assertLedgerInvariant(uid);
});

test('withdrawal below minimum is rejected', async () => {
  const uid = createUser('wd-min');
  const token = userToken(uid);
  coins.creditCoins({ userId: uid, amount: 300, type: 'earn' });
  const r = await api('POST', '/api/coins/withdraw', {
    token,
    body: { coins_amount: 50, payment_method: 'gcash', account_number: '1', account_name: 'X' },
  });
  check(r.status === 422, `expected 422, got ${r.status}`);
  check(walletOf(uid).frozen === 0, 'nothing frozen for invalid request');
});

test('withdrawal approval settles the frozen coins (cash_out)', async () => {
  const token = await adminToken();
  const uid = createUser('wd-approve');
  const userTok = userToken(uid);
  coins.creditCoins({ userId: uid, amount: 300, type: 'earn' });

  const createRes = await api('POST', '/api/coins/withdraw', {
    token: userTok,
    body: { coins_amount: 120, payment_method: 'gcash', account_number: '09171234567', account_name: 'Approve Me' },
  });
  check(createRes.status === 201, 'withdrawal creation failed');
  const wdId = createRes.data.withdrawal.id;

  const approve = await api('POST', `/api/admin/coins/withdrawals/${wdId}/approve`, { token, body: { admin_notes: 'ok' } });
  check(approve.status === 200, `approve expected 200, got ${approve.status}`);

  const w = walletOf(uid);
  check(w.balance === 180 && w.frozen === 0 && w.available === 180, `wrong wallet after approve: ${JSON.stringify(w)}`);

  const rows = assertLedgerInvariant(uid);
  const types = rows.map(r => r.type);
  check(types.includes('freeze') && types.includes('cash_out'), `expected freeze+cash_out, got ${types.join(',')}`);
  const cashOut = rows.find(r => r.type === 'cash_out');
  check(Number(cashOut.balance_before) === Number(cashOut.balance_after), 'cash_out must not change the available balance');

  const complete = await api('POST', `/api/admin/coins/withdrawals/${wdId}/complete`, { token });
  check(complete.status === 200, 'complete failed');
});

test('withdrawal rejection releases the frozen coins (unfreeze)', async () => {
  const token = await adminToken();
  const uid = createUser('wd-reject');
  const userTok = userToken(uid);
  coins.creditCoins({ userId: uid, amount: 300, type: 'earn' });

  const createRes = await api('POST', '/api/coins/withdraw', {
    token: userTok,
    body: { coins_amount: 120, payment_method: 'gcash', account_number: '09171234567', account_name: 'Reject Me' },
  });
  const wdId = createRes.data.withdrawal.id;

  const reject = await api('POST', `/api/admin/coins/withdrawals/${wdId}/reject`, { token, body: { admin_notes: 'no' } });
  check(reject.status === 200, `reject expected 200, got ${reject.status}`);

  const w = walletOf(uid);
  check(w.balance === 300 && w.frozen === 0 && w.available === 300, `wrong wallet after reject: ${JSON.stringify(w)}`);
  const rows = assertLedgerInvariant(uid);
  check(rows.map(r => r.type).includes('unfreeze'), 'unfreeze ledger row expected');
});

test('non-admin cannot approve withdrawals', async () => {
  const uid = createUser('wd-authz');
  const userTok = userToken(uid);
  coins.creditCoins({ userId: uid, amount: 300, type: 'earn' });
  const createRes = await api('POST', '/api/coins/withdraw', {
    token: userTok,
    body: { coins_amount: 100, payment_method: 'maya', account_number: '1', account_name: 'X' },
  });
  const wdId = createRes.data.withdrawal.id;
  const r = await api('POST', `/api/admin/coins/withdrawals/${wdId}/approve`, { token: userTok });
  check(r.status === 403, `expected 403, got ${r.status}`);
  check(walletOf(uid).frozen === 100, 'still frozen');
});

// ════════════════════════════════════════════════════════════════════════════
// F. Admin coin management
// ════════════════════════════════════════════════════════════════════════════
group('Admin coin management');

test('admin adjust credits and debits, with ledger trail', async () => {
  const token = await adminToken();
  const uid = createUser('adjust-1');

  const credit = await api('POST', '/api/admin/coins/adjust', {
    token,
    body: { user_id: uid, amount: 250, reason: 'support bonus' },
  });
  check(credit.status === 200, `credit expected 200, got ${credit.status}`);
  check(credit.data.balance.balance === 250, 'balance must be 250 after credit');
  check(credit.data.transaction_id, 'expected transaction id');

  const debit = await api('POST', '/api/admin/coins/adjust', {
    token,
    body: { user_id: uid, amount: -60, reason: 'clawback' },
  });
  check(debit.status === 200, `debit expected 200, got ${debit.status}`);
  check(debit.data.balance.balance === 190, 'balance must be 190 after debit');

  const rows = ledgerRows(uid);
  check(rows.length === 2, 'expected 2 admin_adjust rows');
  check(rows.every(r => r.type === 'admin_adjust' && r.direction === (r.amount === 250 ? 'credit' : 'debit')), 'row type/direction mismatch');
  assertLedgerInvariant(uid);
});

test('admin adjust cannot over-deduct the wallet', async () => {
  const token = await adminToken();
  const uid = createUser('adjust-over');
  const r = await api('POST', '/api/admin/coins/adjust', {
    token,
    body: { user_id: uid, amount: -10, reason: 'overdraw attempt' },
  });
  check(r.status === 422, `expected 422, got ${r.status}`);
  check(walletOf(uid).balance === 0, 'wallet unchanged');
});

test('admin adjust validates payload and target', async () => {
  const token = await adminToken();
  const r1 = await api('POST', '/api/admin/coins/adjust', { token, body: { user_id: 'nobody', amount: 5, reason: 'x' } });
  check(r1.status === 404, `unknown user expected 404, got ${r1.status}`);
  const r2 = await api('POST', '/api/admin/coins/adjust', { token, body: { user_id: createUser('adjust-payload'), amount: 0, reason: 'x' } });
  check(r2.status === 422, 'zero amount expected 422');
  const r3 = await api('POST', '/api/admin/coins/adjust', { token, body: { user_id: createUser('adjust-payload2'), amount: 10 } });
  check(r3.status === 422, 'missing reason expected 422');
});

test('non-admin is forbidden from adjusting wallets', async () => {
  const uid = createUser('adjust-nonadmin');
  const r = await api('POST', '/api/admin/coins/adjust', {
    token: userToken(uid),
    body: { user_id: uid, amount: 500, reason: 'fraud' },
  });
  check(r.status === 403, `expected 403, got ${r.status}`);
  check(walletOf(uid).balance === 0, 'no credit for non-admin');
});

test('manual topup approval credits once and replays are rejected', async () => {
  const token = await adminToken();
  const uid = createUser('topup-admin');
  const topupId = randomUUID();
  database.execute(
    `INSERT INTO coin_topups (id, user_id, php_amount, coins_amount, payment_method, reference_number, status, paymongo_source_id, created_at, updated_at)
     VALUES (?, ?, 20, 200, 'gcash', 'REF123', 'pending', NULL, datetime('now'), datetime('now'))`,
    [topupId, uid]
  );

  const first = await api('POST', `/api/admin/coins/topups/${topupId}/approve`, { token, body: { admin_notes: 'verified ref' } });
  check(first.status === 200, `approve expected 200, got ${first.status}`);
  check(walletOf(uid).balance === 200, 'balance must be 200 after approve');

  const second = await api('POST', `/api/admin/coins/topups/${topupId}/approve`, { token });
  check(second.status === 400, `re-approve expected 400, got ${second.status}`);
  check(walletOf(uid).balance === 200, 'no double credit on re-approve');

  const count = database.queryOne("SELECT COUNT(*) as c FROM coin_transactions WHERE user_id = ? AND reference_type = 'coin_topup'", [uid]);
  check(count.c === 1, `expected 1 cash_in row, got ${count.c}`);
  assertLedgerInvariant(uid);
});

test('admin summary reports platform totals', async () => {
  const token = await adminToken();
  const r = await api('GET', '/api/admin/coins/summary', { token });
  check(r.status === 200, `summary expected 200, got ${r.status}`);
  check(typeof r.data.summary.total_coins_in_circulation === 'number', 'missing total_coins_in_circulation');
  check(typeof r.data.summary.total_frozen_coins === 'number', 'missing total_frozen_coins');
  check(typeof r.data.summary.total_transactions === 'number', 'missing total_transactions');
});

// ════════════════════════════════════════════════════════════════════════════
// G. Global ledger invariant
// ════════════════════════════════════════════════════════════════════════════
group('Ledger invariant');

test('every affected wallet reconciles end-to-end', async () => {
  const users = database.queryAll('SELECT user_id FROM coin_transactions GROUP BY user_id');
  check(users.length >= 8, 'expected at least 8 distinct ledger users from this suite');
  for (const { user_id } of users) {
    assertLedgerInvariant(user_id);
  }
  const wallets = database.queryAll('SELECT balance, frozen_balance FROM user_wallets');
  for (const w of wallets) {
    check(Number(w.balance) >= 0 && Number(w.frozen_balance) >= 0, 'no negative balances allowed');
    check(Number(w.frozen_balance) <= Number(w.balance), 'frozen can never exceed balance');
  }
});

// ── Run + report ─────────────────────────────────────────────────────────────
for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
console.log('\n' + '═'.repeat(64));
console.log(`COINS-01 TESTS: ${total - failed.length}/${total} passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  ✗ ${f.name}\n    ${f.error?.stack || f.error}`);
}

database.closeDatabase();
if (process.env.KEEP_TEST_DIR !== '1') {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

process.exit(failed.length ? 1 : 0);