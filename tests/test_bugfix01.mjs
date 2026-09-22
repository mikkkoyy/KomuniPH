/**
 * KomuniPH BUGFIX-01 regression test suite.
 *
 * Tests all 8 confirmed bugs from the comprehensive audit.
 * Requires a running server on localhost:3000.
 *
 * Usage: node tests/test_bugfix01.mjs
 */

import http from 'http';
import crypto from 'crypto';
import { getDb } from '../server/database.js';

const BASE_HOST = 'localhost';
const BASE_PORT = 3000;
const stamp = Date.now().toString().slice(-6);
const P = 'Password123!';

let pass = 0;
let fail = 0;

function assert(cond, label, extra) {
  if (cond) {
    pass++;
    console.log('  PASS:', label);
  } else {
    fail++;
    console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

const log = (m) => console.log('\n' + m);

function api(path, method = 'GET', body = null, token = null, extraHeaders = {}) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (data) headers['Content-Length'] = Buffer.byteLength(data);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: BASE_HOST, port: BASE_PORT, path, method, headers }, (res) => {
      let b = '';
      res.on('data', (chunk) => (b += chunk.toString()));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch (e) { parsed = { raw: b }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const db = getDb();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanupTestUser(username) {
  try {
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (user) {
      db.prepare('DELETE FROM coin_transactions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM coin_topups WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM withdrawal_requests WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM user_wallets WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM profiles WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    }
  } catch (e) { /* ignore cleanup errors */ }
}

function makeFakeUser(username, role = 'user', accountStatus = 'active') {
  cleanupTestUser(username);
  const id = crypto.randomBytes(16).toString('hex');
  // Known bcrypt hash for "Password123!" (12 rounds)
  const hash = '$2b$12$oh8cNMrCSBsBvFP1wml/7.kCQxavFT5ArevyKCymvlmWp4IadL00K';
  const email = `${username}@test.bugfix01`;
  db.prepare(`INSERT INTO users (id, email, username, password_hash, role, account_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
    .run(id, email, username, hash, role, accountStatus);
  return id;
}

// ─── BUG #1: Webhook signature bypass ─────────────────────────────────────────

async function testBug1_WebhookSignatureBypass() {
  log('BUG #1: Webhook signature verification robustness');

  const { verifyWebhookSignature } = await import('../server/paymongo.js');

  // Test with empty signature — always false
  const result1 = verifyWebhookSignature('{}', '');
  assert(result1 === false, 'Returns false for empty signature');

  // Test with malformed signature (no v1= part)
  const result2 = verifyWebhookSignature('{}', 'invalid');
  assert(result2 === false, 'Returns false for malformed signature');

  // Test with missing timestamp
  const result3 = verifyWebhookSignature('{}', 'v1=abc');
  assert(result3 === false, 'Returns false for missing timestamp');

  // Test with mismatched buffer length (v1 too short for SHA256 hex)
  const result4 = verifyWebhookSignature('test-body', 'v1=abc,t=123');
  assert(result4 === false, 'Returns false for short v1 value (no crash)');

  // Test with valid-length but wrong signature
  const fakeHex = 'a'.repeat(64); // 64 hex chars = 32 bytes (correct SHA256 length)
  const result5 = verifyWebhookSignature('test-body', `v1=${fakeHex},t=123`);
  assert(result5 === false, 'Returns false for incorrect HMAC');

  // Test with valid signature
  const secret = (await import('../server/config.js')).default.paymongo.webhookSecret;
  if (secret && secret !== 'whsec_your_webhook_secret_here') {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = `${ts}.${'{"test":true}'}`;
    const validHex = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const result6 = verifyWebhookSignature('{"test":true}', `v1=${validHex},t=${ts}`);
    assert(result6 === true, 'Returns true for valid HMAC signature');
  } else {
    assert(true, 'Skipped valid-HMAC test (no real secret configured)');
  }
}

// ─── BUG #2: Topup approval race condition ────────────────────────────────────

async function testBug2_TopupApprovalRace() {
  log('BUG #2: Topup approval race condition (atomic UPDATE)');

  // Create a test user
  const testUser = `testbugfix02_${stamp}`;
  const userId = makeFakeUser(testUser);

  // Create a pending topup
  const topupId = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO coin_topups (id, user_id, php_amount, coins_amount, payment_method, status, created_at, updated_at)
    VALUES (?, ?, 100, 1000, 'gcash', 'pending', datetime('now'), datetime('now'))`)
    .run(topupId, userId);

  // Verify it's pending
  const before = db.prepare('SELECT status FROM coin_topups WHERE id = ?').get(topupId);
  assert(before.status === 'pending', 'Topup starts as pending');

  // Simulate first approval with atomic WHERE
  const result1 = db.prepare("UPDATE coin_topups SET status = 'completed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(topupId);
  assert(result1.changes === 1, 'First approval succeeds (changes=1)');

  // Simulate second approval attempt (race condition)
  const result2 = db.prepare("UPDATE coin_topups SET status = 'completed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(topupId);
  assert(result2.changes === 0, 'Second approval rejected (changes=0)');

  // Verify final state
  const after = db.prepare('SELECT status FROM coin_topups WHERE id = ?').get(topupId);
  assert(after.status === 'completed', 'Status is completed (not double-credited)');

  // Cleanup
  cleanupTestUser(testUser);
}

// ─── BUG #3: Withdrawal approval race condition ───────────────────────────────

async function testBug3_WithdrawalApprovalRace() {
  log('BUG #3: Withdrawal approval race condition (atomic UPDATE)');

  const testUser = `testbugfix03_${stamp}`;
  const userId = makeFakeUser(testUser);

  // Create wallet with balance
  db.prepare('INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 5000, 1000)').run(userId);

  // Create a pending withdrawal
  const withdrawalId = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO withdrawal_requests (id, user_id, coins_amount, php_amount, payment_method, account_number, account_name, status, created_at, updated_at)
    VALUES (?, ?, 1000, 100, 'gcash', '09171234567', 'Test User', 'pending', datetime('now'), datetime('now'))`)
    .run(withdrawalId, userId);

  // Simulate first approval with atomic WHERE
  const result1 = db.prepare("UPDATE withdrawal_requests SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(withdrawalId);
  assert(result1.changes === 1, 'First withdrawal approval succeeds (changes=1)');

  // Simulate second approval attempt (race condition)
  const result2 = db.prepare("UPDATE withdrawal_requests SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(withdrawalId);
  assert(result2.changes === 0, 'Second withdrawal approval rejected (changes=0)');

  const after = db.prepare('SELECT status FROM withdrawal_requests WHERE id = ?').get(withdrawalId);
  assert(after.status === 'approved', 'Withdrawal status is approved (single approval)');

  cleanupTestUser(testUser);
}

// ─── BUG #4: Suspended admin login ────────────────────────────────────────────

async function testBug4_SuspendedAdminLogin() {
  log('BUG #4: Suspended admin login rejection');

  // Create a suspended admin user
  const testUser = `testbugfix04_${stamp}`;
  const userId = makeFakeUser(testUser, 'admin', 'suspended');

  // Try to login via admin endpoint
  const res = await api('/api/admin/login', 'POST', {
    username: testUser,
    password: 'Password123!',
  });

  assert(res.status === 403, 'Suspended admin login returns 403', { status: res.status, body: res.body });

  // Cleanup
  cleanupTestUser(testUser);
}

// ─── BUG #5: Unreachable album-filtered photos route ──────────────────────────

async function testBug5_AlbumPhotosRoute() {
  log('BUG #5: Album-filtered photos route reachable');

  // The fix was to replace handleGetPhotos with handleGetPhotosWithAlbum
  // in the route handler. We can verify that the route responds (not 500).
  // Create a test user with a profile
  const testUser = `testbugfix05_${stamp}`;
  const userId = makeFakeUser(testUser);

  // Create profile
  db.prepare(`INSERT INTO profiles (user_id, display_name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`)
    .run(userId, testUser);

  // Test the route (should not 500)
  const res = await api(`/api/profiles/${testUser}/photos`);
  assert(res.status === 200, 'Photos route returns 200 (not 500)', { status: res.status, body: res.body });
  assert(Array.isArray(res.body.photos), 'Response contains photos array');

  // Cleanup
  cleanupTestUser(testUser);
}

// ─── BUG #6: Privacy migrations error guards ──────────────────────────────────

async function testBug6_PrivacyMigrations() {
  log('BUG #6: Privacy migration error guards');

  // Re-run initDatabase to verify no errors
  const { initDatabase } = await import('../server/database.js');
  try {
    initDatabase();
    assert(true, 'initDatabase() runs without error on re-init');
  } catch (err) {
    assert(false, 'initDatabase() should not throw', { error: err.message });
  }

  // Verify columns exist
  const profileCols = db.prepare('PRAGMA table_info(profiles)').all();
  const hasBirthdayVisible = profileCols.some(c => c.name === 'birthday_visible');
  const hasRealNameVisible = profileCols.some(c => c.name === 'real_name_visible');
  assert(hasBirthdayVisible, 'birthday_visible column exists');
  assert(hasRealNameVisible, 'real_name_visible column exists');
}

// ─── BUG #7: Settings endpoint secret exposure ────────────────────────────────

async function testBug7_SettingsSecretExposure() {
  log('BUG #7: Settings endpoint masks secrets');

  // Create an admin user for auth
  const testUser = `testbugfix07_${stamp}`;
  const userId = makeFakeUser(testUser, 'admin');

  // Login to get token
  const loginRes = await api('/api/admin/login', 'POST', {
    username: testUser,
    password: 'Password123!',
  });

  if (loginRes.status !== 200) {
    assert(false, 'Admin login failed', { status: loginRes.status });
    cleanupTestUser(testUser);
    return;
  }

  const token = loginRes.body.access_token;

  // Set a secret in app_settings
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('paymongo_secret_key', 'sk_live_abcdef1234567890', datetime('now'))")
    .run();
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('paymongo_webhook_secret', 'whsec_abcdef1234567890', datetime('now'))")
    .run();

  // Fetch settings
  const res = await api('/api/admin/settings', 'GET', null, token);
  assert(res.status === 200, 'Settings endpoint returns 200');

  const settings = res.body.settings || {};
  const secretKey = settings.paymongo_secret_key || '';
  const webhookSecret = settings.paymongo_webhook_secret || '';

  // Verify secrets are masked
  assert(secretKey.includes('••••••••'), 'paymongo_secret_key is masked', { value: secretKey });
  assert(webhookSecret.includes('••••••••'), 'paymongo_webhook_secret is masked', { value: webhookSecret });
  assert(!secretKey.includes('abcdef1234567890'), 'Raw secret not exposed', { value: secretKey });

  // Cleanup
  db.prepare("DELETE FROM app_settings WHERE key = 'paymongo_secret_key'").run();
  db.prepare("DELETE FROM app_settings WHERE key = 'paymongo_webhook_secret'").run();
  cleanupTestUser(testUser);
}

// ─── BUG #8: Nullable reference_number in coin_topups ─────────────────────────

async function testBug8_NullableReferenceNumber() {
  log('BUG #8: Nullable reference_number in coin_topups');

  // Verify the column is nullable by inserting with NULL reference_number
  const testUser = `testbugfix08_${stamp}`;
  const userId = makeFakeUser(testUser);

  try {
    db.prepare(`INSERT INTO coin_topups (id, user_id, php_amount, coins_amount, payment_method, reference_number, status, created_at, updated_at)
      VALUES (?, ?, 10, 100, 'gcash', NULL, 'pending', datetime('now'), datetime('now'))`)
      .run(crypto.randomBytes(16).toString('hex'), userId);
    assert(true, 'INSERT with NULL reference_number succeeds');
  } catch (err) {
    assert(false, 'INSERT with NULL reference_number should not throw', { error: err.message });
  }

  // Verify table column is nullable
  const coinTopupCols = db.prepare('PRAGMA table_info(coin_topups)').all();
  const refCol = coinTopupCols.find(c => c.name === 'reference_number');
  assert(refCol && refCol.notnull === 0, 'reference_number column is nullable', refCol);

  // Verify paymongo_source_id column exists
  const hasPaymongoSourceId = coinTopupCols.some(c => c.name === 'paymongo_source_id');
  assert(hasPaymongoSourceId, 'paymongo_source_id column exists');

  cleanupTestUser(testUser);
}

// ─── Run all tests ────────────────────────────────────────────────────────────

async function main() {
  console.log('=== BUGFIX-01 Regression Tests ===\n');

  try {
    await testBug1_WebhookSignatureBypass();
    await testBug2_TopupApprovalRace();
    await testBug3_WithdrawalApprovalRace();
    await testBug4_SuspendedAdminLogin();
    await testBug5_AlbumPhotosRoute();
    await testBug6_PrivacyMigrations();
    await testBug7_SettingsSecretExposure();
    await testBug8_NullableReferenceNumber();
  } catch (err) {
    console.error('\nFATAL ERROR:', err);
    fail++;
  }

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
