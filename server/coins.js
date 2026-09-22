/**
 * KomuniPH Lite - Coins
 * Double-entry ledger coin economy with GCash/Maya cash in/out
 */

import { queryOne, queryAll, execute, transaction } from './database.js';
import { generateId, now, jsonResponse, errorResponse, parseBody } from './utils.js';

const COINS_PER_PHP = 10;
const PHP_PER_COIN = 1 / COINS_PER_PHP;

/**
 * Record a coin transaction and update the wallet balance.
 * Must be called inside an existing transaction() block.
 */
export function recordTransaction(userId, amount, type, description, referenceType, referenceId) {
  const txId = generateId();
  execute(
    'INSERT INTO coin_transactions (id, user_id, amount, type, reference_type, reference_id, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [txId, userId, amount, type, referenceType || null, referenceId || null, description || null]
  );

  if (type === 'freeze') {
    execute(
      'UPDATE user_wallets SET frozen_balance = frozen_balance + ?, updated_at = datetime(\'now\') WHERE user_id = ?',
      [amount, userId]
    );
  } else if (type === 'unfreeze') {
    execute(
      'UPDATE user_wallets SET frozen_balance = frozen_balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?',
      [amount, userId]
    );
  } else if (['earn', 'cash_in', 'creator_payout', 'admin_adjust'].includes(type)) {
    execute(
      'UPDATE user_wallets SET balance = balance + ?, updated_at = datetime(\'now\') WHERE user_id = ?',
      [amount, userId]
    );
  } else if (['spend', 'cash_out'].includes(type)) {
    execute(
      'UPDATE user_wallets SET balance = balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?',
      [amount, userId]
    );
  }

  return txId;
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
        type: tx.type,
        reference_type: tx.reference_type,
        reference_id: tx.reference_id,
        description: tx.description,
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
 * Handle POST /api/coins/topup
 * Creates a cash-in request. User submits PHP amount + proof of payment.
 */
export async function handleCreateTopup(req, res, user) {
  try {
    const body = await parseBody(req);
    const { php_amount, payment_method, reference_number } = body;

    if (!php_amount || typeof php_amount !== 'number' || php_amount <= 0) {
      return errorResponse(res, 422, 'Valid PHP amount is required');
    }

    if (php_amount < 10) {
      return errorResponse(res, 422, 'Minimum cash-in amount is ₱10');
    }

    if (!payment_method || !['gcash', 'maya'].includes(payment_method)) {
      return errorResponse(res, 422, 'Payment method must be gcash or maya');
    }

    if (!reference_number || typeof reference_number !== 'string' || !reference_number.trim()) {
      return errorResponse(res, 422, 'Reference number is required');
    }

    const coinsAmount = Math.floor(php_amount * COINS_PER_PHP);
    const topupId = generateId();
    const timestamp = now();

    ensureWallet(user.sub);

    execute(
      `INSERT INTO coin_topups (id, user_id, php_amount, coins_amount, payment_method, reference_number, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [topupId, user.sub, php_amount, coinsAmount, payment_method, reference_number.trim(), timestamp, timestamp]
    );

    jsonResponse(res, 201, {
      topup: {
        id: topupId,
        php_amount,
        coins_amount: coinsAmount,
        payment_method,
        reference_number: reference_number.trim(),
        status: 'pending',
        created_at: timestamp,
      },
      message: 'Cash-in request submitted. It will be reviewed by an admin.',
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

      recordTransaction(user.sub, coins_amount, 'freeze', `Withdrawal request: ${coins_amount} coins`, 'withdrawal_request', withdrawalId);
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

    transaction(() => {
      execute(
        'UPDATE coin_topups SET status = \'completed\', admin_notes = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [adminNotes, topup.id]
      );
      recordTransaction(topup.user_id, topup.coins_amount, 'cash_in', `Cash in ₱${topup.php_amount} via ${topup.payment_method}`, 'coin_topup', topup.id);
    });

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

    transaction(() => {
      execute(
        'UPDATE withdrawal_requests SET status = \'approved\', admin_notes = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [adminNotes, withdrawal.id]
      );
      recordTransaction(withdrawal.user_id, withdrawal.coins_amount, 'cash_out', `Withdrawal approved: ${withdrawal.coins_amount} coins to ${withdrawal.payment_method}`, 'withdrawal_request', withdrawal.id);
      execute(
        'UPDATE user_wallets SET frozen_balance = frozen_balance - ?, updated_at = datetime(\'now\') WHERE user_id = ?',
        [withdrawal.coins_amount, withdrawal.user_id]
      );
    });

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

    transaction(() => {
      execute(
        'UPDATE withdrawal_requests SET status = \'rejected\', admin_notes = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [adminNotes, withdrawal.id]
      );
      recordTransaction(withdrawal.user_id, withdrawal.coins_amount, 'unfreeze', `Withdrawal rejected: coins unfrozen`, 'withdrawal_request', withdrawal.id);
    });

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
