/**
 * KomuniPH Lite - Coins
 * Double-entry ledger coin economy with GCash/Maya cash in/out
 */

import { queryOne, queryAll, execute, transaction } from './database.js';
import { generateId, now, jsonResponse, errorResponse, parseBody } from './utils.js';
import config from './config.js';
import { createSource, getSource, verifyWebhookSignature } from './paymongo.js';
import { FIRST_VERIFICATION_REWARD_COINS, getVerifiedRecordForUser } from './identity.js';

const COINS_PER_PHP = 10;
const PHP_PER_COIN = 1 / COINS_PER_PHP;

const CREDIT_TYPES = new Set(['earn', 'cash_in', 'creator_payout', 'admin_adjust', 'verification_reward']);
const DEBIT_TYPES = new Set(['spend', 'cash_out', 'freeze', 'admin_adjust']);
const LEDGER_TYPES = new Set(['earn', 'spend', 'cash_in', 'cash_out', 'creator_payout', 'admin_adjust', 'freeze', 'unfreeze', 'verification_reward']);

function markError(error, code) {
  if (error && typeof error === 'object') error.code = code;
  return error;
}

function assertValidLedgerArgs(amount, direction, type) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Invalid coin amount: ${amount}`);
  if (!['credit', 'debit'].includes(direction)) throw new Error(`Invalid ledger direction: ${direction}`);
  if (!LEDGER_TYPES.has(type)) throw new Error(`Invalid ledger type: ${type}`);
}

/**
 * Ensure the user has a wallet, creating one if needed.
 */
function ensureWallet(userId) {
  let wallet = queryOne('SELECT * FROM user_wallets WHERE user_id = ?', [userId]);
  if (!wallet) {
    execute('INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 0, 0)', [userId]);
    wallet = queryOne('SELECT * FROM user_wallets WHERE user_id = ?', [userId]);
  }
  return wallet;
}

/**
 * Read the user's current wallet position (coins are integer units only).
 * @returns {{ balance: number, frozen_balance: number, available_balance: number, updated_at: string }}
 */
export function getCoinBalance(userId) {
  const wallet = ensureWallet(userId);
  return {
    balance: wallet.balance,
    frozen_balance: wallet.frozen_balance,
    available_balance: wallet.balance - wallet.frozen_balance,
    updated_at: wallet.updated_at,
  };
}

/**
 * Record a coin transaction and update the wallet atomically.
 *
 * COINS-01 accounting model:
 *  - Every row captures the AVAILABLE balance (balance - frozen_balance) before
 *    and after the movement, making the ledger fully replayable and invariant-checked.
 *  - freeze  (debit)  moves available coins into the frozen reserve.
 *  - unfreeze(credit) releases reserved coins back to available.
 *  - cash_out(debit)  settles an approved withdrawal: it can never exceed the
 *    frozen reserve, so the available balance is unchanged by the approval.
 *  - spend   (debit)  checks available balance (no frozen coins).
 *  - All other debits check available; all credits raise available.
 *
 * The function is self-atomic: it always runs inside a transaction (nested calls
 * become SQLite savepoints), so it is safe both standalone and when composed with
 * the caller's own transaction() block. A source event can only ever produce one
 * ledger row of a given type via the partial unique index on
 * (reference_type, reference_id, type).
 *
 * @param {string} userId - The user ID
 * @param {number} amount - Positive coin amount in integer units
 * @param {string} direction - 'credit' or 'debit'
 * @param {string} type - One of LEDGER_TYPES
 * @param {string} description - Human-readable description
 * @param {string} referenceType - e.g. 'coin_topup', 'withdrawal_request'
 * @param {string} referenceId - The ID of the referencing record
 * @returns {string} The transaction ID
 */
export function recordTransaction(userId, amount, direction, type, description, referenceType, referenceId) {
  assertValidLedgerArgs(amount, direction, type);
  return transaction(() => {
    const wallet = ensureWallet(userId);
    const availableBefore = wallet.balance - wallet.frozen_balance;
    let balance = wallet.balance;
    let frozen = wallet.frozen_balance;

    if (type === 'freeze') {
      if (direction !== 'debit') throw markError(new Error('freeze must be recorded as a debit'), 'INVALID_LEDGER_DIRECTION');
      if (availableBefore < amount) {
        throw markError(new Error(`Insufficient available balance: ${availableBefore}`), 'INSUFFICIENT_BALANCE');
      }
      frozen += amount;
    } else if (type === 'unfreeze') {
      if (direction !== 'credit') throw markError(new Error('unfreeze must be recorded as a credit'), 'INVALID_LEDGER_DIRECTION');
      if (wallet.frozen_balance < amount) throw new Error('Cannot unfreeze more than the frozen balance');
      frozen -= amount;
    } else if (type === 'cash_out') {
      if (direction !== 'debit') throw markError(new Error('cash_out must be recorded as a debit'), 'INVALID_LEDGER_DIRECTION');
      if (wallet.frozen_balance < amount) throw new Error('Cannot cash out more than the frozen balance');
      balance -= amount;
      frozen -= amount;
    } else if (direction === 'debit') {
      if (availableBefore < amount) {
        throw markError(new Error(`Insufficient available balance: ${availableBefore}`), 'INSUFFICIENT_BALANCE');
      }
      balance -= amount;
    } else {
      balance += amount;
    }

    const availableAfter = balance - frozen;
    const txId = generateId();
    execute(
      `INSERT INTO coin_transactions (id, user_id, amount, direction, type, reference_type, reference_id, description, balance_before, balance_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [txId, userId, amount, direction, type, referenceType || null, referenceId || null, description || null, availableBefore, availableAfter]
    );
    execute(
      "UPDATE user_wallets SET balance = ?, frozen_balance = ?, updated_at = datetime('now') WHERE user_id = ?",
      [balance, frozen, userId]
    );
    return txId;
  });
}

/**
 * Credit coins to a user (earn, cash_in, creator_payout, admin_adjust, verification_reward).
 */
export function creditCoins({ userId, amount, type, description, referenceType, referenceId }) {
  if (!CREDIT_TYPES.has(type)) throw new Error(`Invalid credit ledger type: ${type}`);
  return recordTransaction(userId, amount, 'credit', type, description, referenceType, referenceId);
}

/**
 * Debit coins from a user (spend, cash_out). Fails with code INSUFFICIENT_BALANCE
 * when the available balance is insufficient (spend), or the frozen reserve does
 * not cover the amount (cash_out).
 */
export function debitCoins({ userId, amount, type, description, referenceType, referenceId }) {
  if (!DEBIT_TYPES.has(type)) throw new Error(`Invalid debit ledger type: ${type}`);
  return recordTransaction(userId, amount, 'debit', type, description, referenceType, referenceId);
}

/**
 * Freeze available coins for an in-flight withdrawal request.
 */
export function freezeCoins({ userId, amount, description, referenceType, referenceId }) {
  return recordTransaction(userId, amount, 'debit', 'freeze', description, referenceType, referenceId);
}

/**
 * Release previously frozen coins (rejected withdrawal).
 */
export function unfreezeCoins({ userId, amount, description, referenceType, referenceId }) {
  return recordTransaction(userId, amount, 'credit', 'unfreeze', description, referenceType, referenceId);
}

/**
 * Award the one-time identity verification reward (15 Coins).
 *
 * Server-authoritative and idempotent:
 *  - Only fires against an actual 'verified' identity_verifications record.
 *  - Never reaches the client; it is invoked by the server-side verification flow.
 *  - A conditional UPDATE claims the reward (WHERE reward_awarded = 0) which only
 *    one "winner" can win even under concurrent calls, and the ledger write is
 *    guarded by the partial unique index on the (identity_verification) reference.
 *  - The whole reward — claim + ledger entry — commits atomically or not at all.
 *
 * @param {string} userId - The user ID
 * @returns {{ awarded: boolean, newBalance: number, message: string }}
 */
export function awardVerificationReward(userId) {
  return transaction(() => {
    const record = getVerifiedRecordForUser(userId);
    if (!record) throw new Error('No verified identity record found for user');

    const alreadyAwarded = record.reward_awarded === 1 ||
      (queryOne(
        "SELECT COUNT(*) as c FROM coin_transactions WHERE user_id = ? AND type = 'verification_reward' AND reference_id = ?",
        [userId, record.id]
      )?.c ?? 0) > 0;

    if (alreadyAwarded) {
      // Reconcile the flag if the ledger entry exists but the flag was not persisted.
      execute(
        "UPDATE identity_verifications SET reward_awarded = 1, updated_at = datetime('now') WHERE id = ? AND reward_awarded = 0",
        [record.id]
      );
      return { awarded: false, newBalance: getCoinBalance(userId).balance, message: 'Verification reward already awarded' };
    }

    const claimed = execute(
      "UPDATE identity_verifications SET reward_awarded = 1, updated_at = datetime('now') WHERE id = ? AND reward_awarded = 0",
      [record.id]
    );
    if (claimed.changes === 0) {
      return { awarded: false, newBalance: getCoinBalance(userId).balance, message: 'Verification reward already awarded' };
    }

    recordTransaction(
      userId,
      FIRST_VERIFICATION_REWARD_COINS,
      'credit',
      'verification_reward',
      'First identity verification reward',
      'identity_verification',
      record.id
    );

    const newBalance = getCoinBalance(userId).balance;
    return { awarded: true, newBalance, message: `₱${(FIRST_VERIFICATION_REWARD_COINS / COINS_PER_PHP).toFixed(2)} cash-in equivalent credited` };
  });
}

/**
 * Handle GET /api/coins/wallet
 * Returns the authenticated user's wallet balance.
 */
export function handleGetWallet(req, res, user) {
  try {
    const wallet = ensureWallet(user.sub);

    jsonResponse(res, 200, {
      wallet: {
        balance: wallet.balance,
        frozen_balance: wallet.frozen_balance,
        available_balance: wallet.balance - wallet.frozen_balance,
        updated_at: wallet.updated_at,
      },
      exchange_rate: {
        coins_per_php: COINS_PER_PHP,
        php_per_coin: PHP_PER_COIN,
      },
    });
  } catch (err) {
    console.error('[COINS] Get wallet error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/coins/transactions
 * Returns the authenticated user's coin transaction history.
 */
export function handleGetTransactions(req, res, user) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const type = url.searchParams.get('type');

    let sql = 'SELECT * FROM coin_transactions WHERE user_id = ?';
    const params = [user.sub];

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const transactions = queryAll(sql, params);

    const totalRow = queryOne(
      'SELECT COUNT(*) as count FROM coin_transactions WHERE user_id = ?',
      [user.sub]
    );

    jsonResponse(res, 200, {
      transactions: transactions.map(tx => ({
        id: tx.id,
        amount: tx.amount,
        direction: tx.direction,
        type: tx.type,
        reference_type: tx.reference_type,
        reference_id: tx.reference_id,
        description: tx.description,
        balance_before: tx.balance_before,
        balance_after: tx.balance_after,
        created_at: tx.created_at,
      })),
      total: totalRow ? totalRow.count : 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[COINS] Get transactions error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/coins/exchange-rate
 * Returns the current PHP-to-coins exchange rate.
 */
export function handleGetExchangeRate(req, res) {
  jsonResponse(res, 200, {
    coins_per_php: COINS_PER_PHP,
    php_per_coin: PHP_PER_COIN,
    minimum_cash_in: 10,
    minimum_withdrawal: 100,
  });
}

/**
 * Handle GET /api/coins/payment-accounts
 * Returns configured payment account details for cash-in instructions.
 */
export function handleGetPaymentAccounts(req, res) {
  const accounts = config.paymentAccounts || {};
  jsonResponse(res, 200, {
    gcash: {
      number: accounts.gcash?.number || '',
      accountName: accounts.gcash?.accountName || '',
    },
    maya: {
      number: accounts.maya?.number || '',
      accountName: accounts.maya?.accountName || '',
    },
  });
}

/**
 * Handle POST /api/coins/topup
 * Creates a PayMongo Source and returns a redirect URL for GCash/Maya payment.
 * The user never sees "PayMongo" — only "GCash" / "Maya".
 */
export async function handleCreateTopup(req, res, user) {
  try {
    const body = await parseBody(req);
    const { php_amount, payment_method } = body;

    if (!php_amount || typeof php_amount !== 'number' || php_amount <= 0) {
      return errorResponse(res, 422, 'Valid PHP amount is required');
    }

    if (php_amount < 10) {
      return errorResponse(res, 422, 'Minimum cash-in amount is ₱10');
    }

    if (!payment_method || !['gcash', 'maya'].includes(payment_method)) {
      return errorResponse(res, 422, 'Payment method must be gcash or maya');
    }

    const coinsAmount = Math.floor(php_amount * COINS_PER_PHP);
    const topupId = generateId();
    const timestamp = now();
    const appUrl = config.paymongo.appUrl;

    ensureWallet(user.sub);

    // Create a PayMongo Source (redirect-based e-wallet payment)
    let source;
    try {
      source = await createSource({
        amount: php_amount,
        type: payment_method,
        successUrl: `${appUrl}/#/wallet?topup=success&id=${topupId}`,
        failedUrl: `${appUrl}/#/wallet?topup=failed&id=${topupId}`,
      });
    } catch (pmErr) {
      console.error('[COINS] PayMongo createSource failed:', pmErr.message);
      return errorResponse(res, 502, 'Payment provider error. Please try again.');
    }

    // Store the topup with the PayMongo source ID
    execute(
      `INSERT INTO coin_topups (id, user_id, php_amount, coins_amount, payment_method, reference_number, status, paymongo_source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [topupId, user.sub, php_amount, coinsAmount, payment_method, null, source.id, timestamp, timestamp]
    );

    jsonResponse(res, 201, {
      topup: {
        id: topupId,
        php_amount,
        coins_amount: coinsAmount,
        payment_method,
        status: 'pending',
        redirect_url: source.redirectUrl,
        created_at: timestamp,
      },
      message: 'Redirecting to payment page...',
    });
  } catch (err) {
    console.error('[COINS] Create topup error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/coins/topups
 * Returns the authenticated user's top-up history.
 */
export function handleGetTopups(req, res, user) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const topups = queryAll(
      `SELECT * FROM coin_topups WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [user.sub, limit, offset]
    );

    const totalRow = queryOne(
      'SELECT COUNT(*) as count FROM coin_topups WHERE user_id = ?',
      [user.sub]
    );

    jsonResponse(res, 200, {
      topups: topups.map(t => ({
        id: t.id,
        php_amount: t.php_amount,
        coins_amount: t.coins_amount,
        payment_method: t.payment_method,
        reference_number: t.reference_number,
        status: t.status,
        admin_notes: t.admin_notes,
        created_at: t.created_at,
        updated_at: t.updated_at,
      })),
      total: totalRow ? totalRow.count : 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[COINS] Get topups error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/coins/topup/status/:id
 * Returns the status of a specific topup (for frontend polling after redirect).
 */
export function handleGetTopupStatus(req, res, user, params) {
  try {
    const topup = queryOne(
      'SELECT id, status, coins_amount, php_amount, payment_method, created_at, updated_at FROM coin_topups WHERE id = ? AND user_id = ?',
      [params.id, user.sub]
    );

    if (!topup) {
      return errorResponse(res, 404, 'Top-up not found');
    }

    jsonResponse(res, 200, { topup });
  } catch (err) {
    console.error('[COINS] Get topup status error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/coins/paymongo/webhook
 * Receives PayMongo webhook events for source status changes.
 * When a source becomes "chargeable", credits coins to the user.
 *
 * CRITICAL: PayMongo is an internal implementation detail.
 * All user-facing strings reference only "GCash" / "Maya".
 */
export async function handlePaymongoWebhook(req, res) {
  try {
    // Read raw body for signature verification
    const rawBody = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk.toString(); });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    // Verify webhook signature
    const signature = req.headers['x-paymongo-signature'] || '';
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn('[PAYMONGO] Webhook signature verification failed');
      return errorResponse(res, 401, 'Invalid signature');
    }

    const event = JSON.parse(rawBody);
    const eventType = event?.data?.attributes?.type;
    const source = event?.data?.attributes?.data?.attributes;

    if (!source) {
      return jsonResponse(res, 200, { received: true });
    }

    console.log(`[PAYMONGO] Webhook received: ${eventType}, source=${source.id}, status=${source.status}`);

    // Only process chargeable sources (payment completed successfully)
    if (source.status !== 'chargeable') {
      return jsonResponse(res, 200, { received: true, skipped: true });
    }

    // Find the topup linked to this PayMongo source
    const topup = queryOne(
      'SELECT * FROM coin_topups WHERE paymongo_source_id = ?',
      [source.id]
    );

    if (!topup) {
      console.warn(`[PAYMONGO] No topup found for source ${source.id}`);
      return jsonResponse(res, 200, { received: true, unknown_source: true });
    }

    if (topup.status !== 'pending') {
      // Already processed (idempotent)
      return jsonResponse(res, 200, { received: true, already_processed: true });
    }

    // Verify amount matches (centavos from PayMongo vs PHP amount stored)
    const expectedCentavos = Math.round(topup.php_amount * 100);
    if (source.amount !== expectedCentavos) {
      console.error(`[PAYMONGO] Amount mismatch: source=${source.amount} centavos, expected=${expectedCentavos} centavos for topup ${topup.id}`);
      return jsonResponse(res, 200, { received: true, amount_mismatch: true });
    }

    // Credit coins to user. Ledger + status flip commit atomically, and the
    // guarded UPDATE makes this handler idempotent even if PayMongo replays
    // the same event: once completed, no second ledger entry can be created.
    const credited = transaction(() => {
      const result = execute(
        "UPDATE coin_topups SET status = 'completed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
        [topup.id]
      );
      if (result.changes === 0) return false;
      recordTransaction(
        topup.user_id,
        topup.coins_amount,
        'credit',
        'cash_in',
        `Cash in ₱${topup.php_amount} via ${topup.payment_method}`,
        'coin_topup',
        topup.id
      );
      return true;
    });

    if (!credited) {
      return jsonResponse(res, 200, { received: true, already_processed: true });
    }

    console.log(`[PAYMONGO] Topup ${topup.id} completed: ${topup.coins_amount} coins credited to user ${topup.user_id}`);
    jsonResponse(res, 200, { received: true, credited: true });
  } catch (err) {
    console.error('[PAYMONGO] Webhook handler error:', err);
    // Return 200 to prevent PayMongo from retrying on our bugs
    jsonResponse(res, 200, { received: true, error: true });
  }
}

/**
 * Handle POST /api/coins/withdraw
 * Creates a withdrawal request (cash out from coins to GCash/Maya).
 */
export async function handleCreateWithdrawal(req, res, user) {
  try {
    const body = await parseBody(req);
    const { coins_amount, payment_method, account_number, account_name } = body;

    if (!coins_amount || typeof coins_amount !== 'number' || !Number.isInteger(coins_amount)) {
      return errorResponse(res, 422, 'Valid coins amount (integer) is required');
    }

    if (coins_amount < 100) {
      return errorResponse(res, 422, 'Minimum withdrawal is 100 coins (₱10)');
    }

    if (!payment_method || !['gcash', 'maya'].includes(payment_method)) {
      return errorResponse(res, 422, 'Payment method must be gcash or maya');
    }

    if (!account_number || typeof account_number !== 'string' || !account_number.trim()) {
      return errorResponse(res, 422, 'Account number is required');
    }

    if (!account_name || typeof account_name !== 'string' || !account_name.trim()) {
      return errorResponse(res, 422, 'Account name is required');
    }

    const wallet = ensureWallet(user.sub);
    const available = wallet.balance - wallet.frozen_balance;

    if (coins_amount > available) {
      return errorResponse(res, 422, `Insufficient balance. Available: ${available} coins`);
    }

    const phpAmount = coins_amount * PHP_PER_COIN;
    const withdrawalId = generateId();
    const timestamp = now();

    transaction(() => {
      execute(
        `INSERT INTO withdrawal_requests (id, user_id, coins_amount, php_amount, payment_method, account_number, account_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [withdrawalId, user.sub, coins_amount, phpAmount, payment_method, account_number.trim(), account_name.trim(), timestamp, timestamp]
      );

      // The authoritative availability check happens inside the freeze, so two
      // concurrent withdrawals for the same user cannot over-freeze their coins.
      recordTransaction(user.sub, coins_amount, 'debit', 'freeze', `Withdrawal request: ${coins_amount} coins`, 'withdrawal_request', withdrawalId);
    });

    jsonResponse(res, 201, {
      withdrawal: {
        id: withdrawalId,
        coins_amount,
        php_amount: phpAmount,
        payment_method,
        account_number: account_number.trim(),
        account_name: account_name.trim(),
        status: 'pending',
        created_at: timestamp,
      },
      message: 'Withdrawal request submitted. Coins are frozen until reviewed.',
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      return errorResponse(res, 422, err.message);
    }
    console.error('[COINS] Create withdrawal error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

// ─── Admin Handlers ───────────────────────────────────────────────────────────

/**
 * Handle GET /api/admin/coins/topups
 * Lists all pending top-ups for admin review.
 */
export function handleAdminListTopups(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const status = url.searchParams.get('status') || 'pending';

    let sql = 'SELECT ct.*, u.username FROM coin_topups ct JOIN users u ON ct.user_id = u.id WHERE ct.status = ?';
    const params = [status];

    sql += ' ORDER BY ct.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const topups = queryAll(sql, params);
    const totalRow = queryOne(
      'SELECT COUNT(*) as count FROM coin_topups WHERE status = ?',
      [status]
    );

    jsonResponse(res, 200, {
      topups: topups.map(t => ({
        id: t.id,
        user_id: t.user_id,
        username: t.username,
        php_amount: t.php_amount,
        coins_amount: t.coins_amount,
        payment_method: t.payment_method,
        reference_number: t.reference_number,
        status: t.status,
        admin_notes: t.admin_notes,
        created_at: t.created_at,
        updated_at: t.updated_at,
      })),
      total: totalRow ? totalRow.count : 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[COINS] Admin list topups error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/admin/coins/topups/:id/approve
 * Approves a top-up, crediting coins to the user.
 */
export async function handleAdminApproveTopup(req, res, params) {
  try {
    const topup = queryOne('SELECT * FROM coin_topups WHERE id = ?', [params.id]);
    if (!topup) {
      return errorResponse(res, 404, 'Top-up not found');
    }

    if (topup.status !== 'pending') {
      return errorResponse(res, 400, `Top-up is already ${topup.status}`);
    }

    const body = await parseBody(req);
    const adminNotes = body.admin_notes || null;

    const completed = transaction(() => {
      const result = execute(
        "UPDATE coin_topups SET status = 'completed', admin_notes = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
        [adminNotes, topup.id]
      );
      if (result.changes === 0) return false;
      recordTransaction(
        topup.user_id,
        topup.coins_amount,
        'credit',
        'cash_in',
        `Cash in ₱${topup.php_amount} via ${topup.payment_method}`,
        'coin_topup',
        topup.id
      );
      return true;
    });

    if (!completed) {
      return errorResponse(res, 409, 'Top-up was already processed');
    }

    jsonResponse(res, 200, { message: 'Top-up approved and coins credited' });
  } catch (err) {
    console.error('[COINS] Admin approve topup error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/admin/coins/topups/:id/reject
 * Rejects a top-up.
 */
export async function handleAdminRejectTopup(req, res, params) {
  try {
    const topup = queryOne('SELECT * FROM coin_topups WHERE id = ?', [params.id]);
    if (!topup) {
      return errorResponse(res, 404, 'Top-up not found');
    }

    if (topup.status !== 'pending') {
      return errorResponse(res, 400, `Top-up is already ${topup.status}`);
    }

    const body = await parseBody(req);
    const adminNotes = body.admin_notes || null;

    execute(
      'UPDATE coin_topups SET status = \'rejected\', admin_notes = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [adminNotes, topup.id]
    );

    jsonResponse(res, 200, { message: 'Top-up rejected' });
  } catch (err) {
    console.error('[COINS] Admin reject topup error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/admin/coins/withdrawals
 * Lists all pending withdrawal requests for admin review.
 */
export function handleAdminListWithdrawals(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const status = url.searchParams.get('status') || 'pending';

    let sql = 'SELECT wr.*, u.username FROM withdrawal_requests wr JOIN users u ON wr.user_id = u.id WHERE wr.status = ?';
    const params = [status];

    sql += ' ORDER BY wr.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const withdrawals = queryAll(sql, params);
    const totalRow = queryOne(
      'SELECT COUNT(*) as count FROM withdrawal_requests WHERE status = ?',
      [status]
    );

    jsonResponse(res, 200, {
      withdrawals: withdrawals.map(w => ({
        id: w.id,
        user_id: w.user_id,
        username: w.username,
        coins_amount: w.coins_amount,
        php_amount: w.php_amount,
        payment_method: w.payment_method,
        account_number: w.account_number,
        account_name: w.account_name,
        status: w.status,
        admin_notes: w.admin_notes,
        created_at: w.created_at,
        updated_at: w.updated_at,
      })),
      total: totalRow ? totalRow.count : 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[COINS] Admin list withdrawals error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/admin/coins/withdrawals/:id/approve
 * Approves a withdrawal request.
 */
export async function handleAdminApproveWithdrawal(req, res, params) {
  try {
    const withdrawal = queryOne('SELECT * FROM withdrawal_requests WHERE id = ?', [params.id]);
    if (!withdrawal) {
      return errorResponse(res, 404, 'Withdrawal not found');
    }

    if (withdrawal.status !== 'pending') {
      return errorResponse(res, 400, `Withdrawal is already ${withdrawal.status}`);
    }

    const body = await parseBody(req);
    const adminNotes = body.admin_notes || null;

    // cash_out settles the previously frozen coins: it debits balance and the
    // frozen reserve atomically, leaving the available balance unchanged.
    const merged = transaction(() => {
      const result = execute(
        "UPDATE withdrawal_requests SET status = 'approved', admin_notes = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
        [adminNotes, withdrawal.id]
      );
      if (result.changes === 0) return false;
      recordTransaction(
        withdrawal.user_id,
        withdrawal.coins_amount,
        'debit',
        'cash_out',
        `Withdrawal approved: ${withdrawal.coins_amount} coins to ${withdrawal.payment_method}`,
        'withdrawal_request',
        withdrawal.id
      );
      return true;
    });

    if (!merged) {
      return errorResponse(res, 409, 'Withdrawal was already processed');
    }

    jsonResponse(res, 200, { message: 'Withdrawal approved' });
  } catch (err) {
    console.error('[COINS] Admin approve withdrawal error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/admin/coins/withdrawals/:id/reject
 * Rejects a withdrawal request and unfreezes the coins.
 */
export async function handleAdminRejectWithdrawal(req, res, params) {
  try {
    const withdrawal = queryOne('SELECT * FROM withdrawal_requests WHERE id = ?', [params.id]);
    if (!withdrawal) {
      return errorResponse(res, 404, 'Withdrawal not found');
    }

    if (withdrawal.status !== 'pending') {
      return errorResponse(res, 400, `Withdrawal is already ${withdrawal.status}`);
    }

    const body = await parseBody(req);
    const adminNotes = body.admin_notes || null;

    const rejected = transaction(() => {
      const result = execute(
        "UPDATE withdrawal_requests SET status = 'rejected', admin_notes = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
        [adminNotes, withdrawal.id]
      );
      if (result.changes === 0) return false;
      recordTransaction(
        withdrawal.user_id,
        withdrawal.coins_amount,
        'credit',
        'unfreeze',
        'Withdrawal rejected: coins unfrozen',
        'withdrawal_request',
        withdrawal.id
      );
      return true;
    });

    if (!rejected) {
      return errorResponse(res, 409, 'Withdrawal was already processed');
    }

    jsonResponse(res, 200, { message: 'Withdrawal rejected and coins unfrozen' });
  } catch (err) {
    console.error('[COINS] Admin reject withdrawal error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/admin/coins/withdrawals/:id/complete
 * Marks a withdrawal as completed (money sent).
 */
export async function handleAdminCompleteWithdrawal(req, res, params) {
  try {
    const withdrawal = queryOne('SELECT * FROM withdrawal_requests WHERE id = ?', [params.id]);
    if (!withdrawal) {
      return errorResponse(res, 404, 'Withdrawal not found');
    }

    if (withdrawal.status !== 'approved') {
      return errorResponse(res, 400, `Withdrawal must be approved first (current: ${withdrawal.status})`);
    }

    const body = await parseBody(req);
    const adminNotes = body.admin_notes || null;

    execute(
      'UPDATE withdrawal_requests SET status = \'completed\', admin_notes = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [adminNotes, withdrawal.id]
    );

    jsonResponse(res, 200, { message: 'Withdrawal marked as completed' });
  } catch (err) {
    console.error('[COINS] Admin complete withdrawal error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/admin/coins/summary
 * Returns platform-wide coin economy summary for admins.
 */
export function handleAdminCoinSummary(req, res) {
  try {
    const totalBalance = queryOne('SELECT COALESCE(SUM(balance), 0) as total FROM user_wallets');
    const totalFrozen = queryOne('SELECT COALESCE(SUM(frozen_balance), 0) as total FROM user_wallets');
    const pendingTopups = queryOne('SELECT COUNT(*) as count FROM coin_topups WHERE status = \'pending\'');
    const pendingWithdrawals = queryOne('SELECT COUNT(*) as count FROM withdrawal_requests WHERE status = \'pending\'');
    const totalUsers = queryOne('SELECT COUNT(*) as count FROM user_wallets');
    const totalTransactions = queryOne('SELECT COUNT(*) as count FROM coin_transactions');

    jsonResponse(res, 200, {
      summary: {
        total_coins_in_circulation: totalBalance ? totalBalance.total : 0,
        total_frozen_coins: totalFrozen ? totalFrozen.total : 0,
        pending_topups: pendingTopups ? pendingTopups.count : 0,
        pending_withdrawals: pendingWithdrawals ? pendingWithdrawals.count : 0,
        total_wallets: totalUsers ? totalUsers.count : 0,
        total_transactions: totalTransactions ? totalTransactions.count : 0,
      },
    });
  } catch (err) {
    console.error('[COINS] Admin summary error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/admin/coins/adjust
 * Credits or debits a member's wallet directly (admin only).
 * Used for corrections, bonuses, clawbacks, and support payouts. Every
 * adjustment lands in the immutable ledger as an admin_adjust entry.
 */
export async function handleAdminAdjust(req, res) {
  try {
    const body = await parseBody(req);
    const { user_id, amount, reason } = body;

    if (!user_id || typeof user_id !== 'string' || !user_id.trim()) {
      return errorResponse(res, 422, 'user_id is required');
    }
    if (!Number.isInteger(amount) || amount === 0) {
      return errorResponse(res, 422, 'amount must be a non-zero integer (in coins)');
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return errorResponse(res, 422, 'reason is required');
    }

    const target = queryOne('SELECT id FROM users WHERE id = ?', [user_id]);
    if (!target) {
      return errorResponse(res, 404, 'User not found');
    }

    const absAmount = Math.abs(amount);
    const description = `Admin adjustment: ${reason.trim()}`;
    const txId = amount > 0
      ? creditCoins({ userId: user_id, amount: absAmount, type: 'admin_adjust', description, referenceType: 'admin_adjust' })
      : debitCoins({ userId: user_id, amount: absAmount, type: 'admin_adjust', description, referenceType: 'admin_adjust' });

    jsonResponse(res, 200, {
      message: amount > 0
        ? `Added ${absAmount} coins to the wallet`
        : `Deducted ${absAmount} coins from the wallet`,
      balance: getCoinBalance(user_id),
      transaction_id: txId,
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      return errorResponse(res, 422, err.message);
    }
    console.error('[COINS] Admin adjust error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/coins/withdrawals
 * Returns the authenticated user's withdrawal history.
 */
export function handleGetWithdrawals(req, res, user) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const withdrawals = queryAll(
      `SELECT * FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [user.sub, limit, offset]
    );

    const totalRow = queryOne(
      'SELECT COUNT(*) as count FROM withdrawal_requests WHERE user_id = ?',
      [user.sub]
    );

    jsonResponse(res, 200, {
      withdrawals: withdrawals.map(w => ({
        id: w.id,
        coins_amount: w.coins_amount,
        php_amount: w.php_amount,
        payment_method: w.payment_method,
        account_number: w.account_number,
        account_name: w.account_name,
        status: w.status,
        admin_notes: w.admin_notes,
        created_at: w.created_at,
        updated_at: w.updated_at,
      })),
      total: totalRow ? totalRow.count : 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[COINS] Get withdrawals error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}
