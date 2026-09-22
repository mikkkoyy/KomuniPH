/**
 * KomuniPH Lite - Coins / Wallet
 * Frontend module for the coin economy: wallet view, cash-in, cash-out
 */

import { apiRequest } from './api.js';

/**
 * Coins API client
 */
export const coinsApi = {
  async getWallet() {
    return apiRequest('/coins/wallet');
  },

  async getTransactions(limit = 50, offset = 0, type = null) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (type) params.set('type', type);
    return apiRequest(`/coins/transactions?${params.toString()}`);
  },

  async getExchangeRate() {
    return apiRequest('/coins/exchange-rate');
  },

  async createTopup(phpAmount, paymentMethod, referenceNumber) {
    return apiRequest('/coins/topup', {
      method: 'POST',
      body: {
        php_amount: phpAmount,
        payment_method: paymentMethod,
        reference_number: referenceNumber,
      },
    });
  },

  async getTopups(limit = 50, offset = 0) {
    return apiRequest(`/coins/topups?limit=${limit}&offset=${offset}`);
  },

  async createWithdrawal(coinsAmount, paymentMethod, accountNumber, accountName) {
    return apiRequest('/coins/withdraw', {
      method: 'POST',
      body: {
        coins_amount: coinsAmount,
        payment_method: paymentMethod,
        account_number: accountNumber,
        account_name: accountName,
      },
    });
  },

  async getWithdrawals(limit = 50, offset = 0) {
    return apiRequest(`/coins/withdrawals?limit=${limit}&offset=${offset}`);
  },
};

function formatCoins(n) {
  return Number(n).toLocaleString();
}

function formatPhp(n) {
  return '₱' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFraction_digits: 2 });
}

const STATUS_COLORS = {
  pending: '#f59e0b',
  approved: '#3b82f6',
  completed: '#10b981',
  rejected: '#ef4444',
};

function statusBadge(status) {
  const color = STATUS_COLORS[status] || '#6b7280';
  return `<span style="background:${color}20;color:${color};padding:2px 8px;border-radius:9999px;font-size:0.75rem;font-weight:600;text-transform:uppercase;">${status}</span>`;
}

const TX_TYPE_LABELS = {
  earn: 'Earned',
  spend: 'Spent',
  cash_in: 'Cash In',
  cash_out: 'Cash Out',
  creator_payout: 'Creator Payout',
  admin_adjust: 'Admin Adjustment',
  freeze: 'Frozen',
  unfreeze: 'Unfrozen',
};

const TX_TYPE_COLORS = {
  earn: '#10b981',
  spend: '#ef4444',
  cash_in: '#3b82f6',
  cash_out: '#f59e0b',
  creator_payout: '#8b5cf6',
  admin_adjust: '#6b7280',
  freeze: '#f97316',
  unfreeze: '#06b6d4',
};

/**
 * Render the wallet page
 */
export function renderWalletPage() {
  return `
    <div id="wallet-page" style="max-width:720px;margin:0 auto;padding:1rem;">
      <h2 style="font-family:'Fredoka',sans-serif;font-size:1.5rem;margin-bottom:1rem;">My Wallet</h2>

      <div id="wallet-balance-card" style="background:linear-gradient(135deg,#0e6e6e,#14b8a6);color:#fff;border-radius:1rem;padding:1.5rem;margin-bottom:1.5rem;">
        <div style="font-size:0.875rem;opacity:0.85;">Available Balance</div>
        <div id="wallet-balance" style="font-size:2.25rem;font-weight:700;font-family:'Fredoka',sans-serif;">...</div>
        <div id="wallet-frozen" style="font-size:0.8rem;opacity:0.7;margin-top:0.25rem;"></div>
      </div>

      <div style="display:flex;gap:0.75rem;margin-bottom:1.5rem;flex-wrap:wrap;">
        <button id="btn-cashin" style="flex:1;min-width:120px;padding:0.75rem;border:none;border-radius:0.75rem;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Cash In</button>
        <button id="btn-cashout" style="flex:1;min-width:120px;padding:0.75rem;border:none;border-radius:0.75rem;background:#f59e0b;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Cash Out</button>
        <button id="btn-history" style="flex:1;min-width:120px;padding:0.75rem;border:none;border-radius:0.75rem;background:#6366f1;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">History</button>
      </div>

      <div id="wallet-section"></div>
    </div>
  `;
}

/**
 * Initialize wallet page: fetch balance and show default section
 */
export async function initWalletPage() {
  await loadWalletBalance();
  showTransactions();

  document.getElementById('btn-cashin')?.addEventListener('click', showCashInForm);
  document.getElementById('btn-cashout')?.addEventListener('click', showCashOutForm);
  document.getElementById('btn-history')?.addEventListener('click', showTransactions);
}

async function loadWalletBalance() {
  try {
    const data = await coinsApi.getWallet();
    const w = data.wallet;
    document.getElementById('wallet-balance').textContent = formatCoins(w.balance) + ' coins';
    document.getElementById('wallet-frozen').textContent = w.frozen_balance > 0
      ? `${formatCoins(w.frozen_balance)} coins frozen`
      : '';
  } catch (err) {
    console.error('[WALLET] Failed to load balance:', err);
    document.getElementById('wallet-balance').textContent = 'Error loading balance';
  }
}

function showTransactions() {
  setActiveBtn('btn-history');
  const section = document.getElementById('wallet-section');
  section.innerHTML = `
    <div style="background:#fff;border-radius:0.75rem;padding:1rem;border:1px solid #e5e7eb;">
      <h3 style="font-family:'Fredoka',sans-serif;font-size:1.1rem;margin-bottom:0.75rem;">Transaction History</h3>
      <div id="tx-list" style="color:#6b7280;">Loading...</div>
    </div>
  `;
  loadTransactions();
}

async function loadTransactions(limit = 50, offset = 0) {
  try {
    const data = await coinsApi.getTransactions(limit, offset);
    const list = document.getElementById('tx-list');
    if (!data.transactions.length) {
      list.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:2rem 0;">No transactions yet.</p>';
      return;
    }
    list.innerHTML = data.transactions.map(tx => {
      const color = TX_TYPE_COLORS[tx.type] || '#6b7280';
      const label = TX_TYPE_LABELS[tx.type] || tx.type;
      const sign = tx.amount > 0 ? '+' : '';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.625rem 0;border-bottom:1px solid #f3f4f6;">
          <div>
            <div style="font-weight:600;font-size:0.9rem;color:#1f2937;">${label}</div>
            <div style="font-size:0.75rem;color:#9ca3af;">${tx.description || ''}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700;color:${color};">${sign}${formatCoins(tx.amount)} coins</div>
            <div style="font-size:0.7rem;color:#9ca3af;">${new Date(tx.created_at).toLocaleDateString()}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    document.getElementById('tx-list').innerHTML = '<p style="color:#ef4444;">Failed to load transactions.</p>';
  }
}

function showCashInForm() {
  setActiveBtn('btn-cashin');
  const section = document.getElementById('wallet-section');
  section.innerHTML = `
    <div style="background:#fff;border-radius:0.75rem;padding:1.25rem;border:1px solid #e5e7eb;">
      <h3 style="font-family:'Fredoka',sans-serif;font-size:1.1rem;margin-bottom:1rem;">Cash In (GCash / Maya)</h3>
      <p style="font-size:0.85rem;color:#6b7280;margin-bottom:1rem;">Rate: 10 coins = ₱1. Send payment, then submit the form below.</p>
      <form id="cashin-form">
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.25rem;color:#374151;">Amount (PHP)</label>
          <input type="number" id="cashin-amount" min="10" step="1" required placeholder="e.g. 50" style="width:100%;padding:0.6rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.95rem;">
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.25rem;color:#374151;">Payment Method</label>
          <select id="cashin-method" style="width:100%;padding:0.6rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.95rem;">
            <option value="gcash">GCash</option>
            <option value="maya">Maya</option>
          </select>
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.25rem;color:#374151;">Reference Number</label>
          <input type="text" id="cashin-ref" required placeholder="GCash/Maya reference number" style="width:100%;padding:0.6rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.95rem;">
        </div>
        <div id="cashin-error" style="color:#ef4444;font-size:0.85rem;margin-bottom:0.75rem;"></div>
        <button type="submit" id="cashin-submit" style="width:100%;padding:0.75rem;border:none;border-radius:0.5rem;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Submit Cash In</button>
      </form>
    </div>
  `;

  document.getElementById('cashin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('cashin-error');
    const btn = document.getElementById('cashin-submit');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const amount = parseFloat(document.getElementById('cashin-amount').value);
    const method = document.getElementById('cashin-method').value;
    const ref = document.getElementById('cashin-ref').value.trim();

    try {
      await coinsApi.createTopup(amount, method, ref);
      errEl.style.color = '#10b981';
      errEl.textContent = 'Cash-in request submitted! Waiting for admin approval.';
      btn.textContent = 'Submitted';
      await loadWalletBalance();
    } catch (err) {
      errEl.style.color = '#ef4444';
      errEl.textContent = err.message || 'Failed to submit cash-in.';
      btn.disabled = false;
      btn.textContent = 'Submit Cash In';
    }
  });
}

function showCashOutForm() {
  setActiveBtn('btn-cashout');
  const section = document.getElementById('wallet-section');
  section.innerHTML = `
    <div style="background:#fff;border-radius:0.75rem;padding:1.25rem;border:1px solid #e5e7eb;">
      <h3 style="font-family:'Fredoka',sans-serif;font-size:1.1rem;margin-bottom:1rem;">Cash Out (Withdraw)</h3>
      <p style="font-size:0.85rem;color:#6b7280;margin-bottom:1rem;">Minimum withdrawal: 100 coins (₱10). Coins are frozen while request is pending.</p>
      <form id="cashout-form">
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.25rem;color:#374151;">Coins to Withdraw</label>
          <input type="number" id="cashout-amount" min="100" step="1" required placeholder="e.g. 500" style="width:100%;padding:0.6rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.95rem;">
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.25rem;color:#374151;">Payment Method</label>
          <select id="cashout-method" style="width:100%;padding:0.6rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.95rem;">
            <option value="gcash">GCash</option>
            <option value="maya">Maya</option>
          </select>
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.25rem;color:#374151;">Account Number</label>
          <input type="text" id="cashout-acct" required placeholder="GCash/Maya number" style="width:100%;padding:0.6rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.95rem;">
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.25rem;color:#374151;">Account Name</label>
          <input type="text" id="cashout-name" required placeholder="Account holder name" style="width:100%;padding:0.6rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.95rem;">
        </div>
        <div id="cashout-error" style="color:#ef4444;font-size:0.85rem;margin-bottom:0.75rem;"></div>
        <button type="submit" id="cashout-submit" style="width:100%;padding:0.75rem;border:none;border-radius:0.5rem;background:#f59e0b;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Submit Withdrawal</button>
      </form>
    </div>
  `;

  document.getElementById('cashout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('cashout-error');
    const btn = document.getElementById('cashout-submit');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const amount = parseInt(document.getElementById('cashout-amount').value, 10);
    const method = document.getElementById('cashout-method').value;
    const acct = document.getElementById('cashout-acct').value.trim();
    const name = document.getElementById('cashout-name').value.trim();

    try {
      await coinsApi.createWithdrawal(amount, method, acct, name);
      errEl.style.color = '#10b981';
      errEl.textContent = 'Withdrawal request submitted! Coins are frozen until reviewed.';
      btn.textContent = 'Submitted';
      await loadWalletBalance();
    } catch (err) {
      errEl.style.color = '#ef4444';
      errEl.textContent = err.message || 'Failed to submit withdrawal.';
      btn.disabled = false;
      btn.textContent = 'Submit Withdrawal';
    }
  });
}

function setActiveBtn(activeId) {
  ['btn-cashin', 'btn-cashout', 'btn-history'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (id === activeId) {
      btn.style.opacity = '1';
      btn.style.transform = 'scale(1.02)';
    } else {
      btn.style.opacity = '0.7';
      btn.style.transform = 'scale(1)';
    }
  });
}
