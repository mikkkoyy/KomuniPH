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

  async getPaymentAccounts() {
    return apiRequest('/coins/payment-accounts');
  },

  async createTopup(phpAmount, paymentMethod) {
    return apiRequest('/coins/topup', {
      method: 'POST',
      body: {
        php_amount: phpAmount,
        payment_method: paymentMethod,
      },
    });
  },

  async getTopupStatus(topupId) {
    return apiRequest(`/coins/topup/status/${topupId}`);
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

  async searchUsers(query) {
    return apiRequest(`/users/search?q=${encodeURIComponent(query)}`);
  },

  async sendGift(recipient, amount, idempotencyKey) {
    return apiRequest('/coins/gift', {
      method: 'POST',
      body: {
        recipient,
        amount,
        idempotency_key: idempotencyKey,
      },
    });
  },
};

function formatCoins(n) {
  return Number(n).toLocaleString();
}

function formatPhp(n) {
  return '₱' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  gift: 'Gift',
  verification_reward: 'Verification Reward',
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
  gift: '#ec4899',
  verification_reward: '#0e6e6e',
};

/**
 * Render the wallet page
 */
export function renderWalletPage() {
  return `
    <div id="wallet-page" style="max-width:720px;margin:0 auto;padding:1rem;">
      <h2 style="font-family:'Fredoka',sans-serif;font-size:1.5rem;margin-bottom:1rem;">My Wallet</h2>

      <div id="wallet-balance-card" style="background:linear-gradient(135deg,#0e6e6e,#14b8a6);color:#fff;border-radius:1rem;padding:1.5rem;margin-bottom:1.5rem;">
        <div style="font-size:0.875rem;opacity:0.85;">Total Coins</div>
        <div id="wallet-balance" style="font-size:2.25rem;font-weight:700;font-family:'Fredoka',sans-serif;">...</div>
        <div id="wallet-transferable" style="font-size:0.85rem;opacity:0.9;margin-top:0.25rem;"></div>
        <div id="wallet-locked" style="font-size:0.8rem;opacity:0.7;margin-top:0.15rem;"></div>
        <div id="wallet-frozen" style="font-size:0.8rem;opacity:0.7;margin-top:0.15rem;"></div>
      </div>

      <div style="display:flex;gap:0.75rem;margin-bottom:1.5rem;flex-wrap:wrap;">
        <button id="btn-cashin" style="flex:1;min-width:120px;padding:0.75rem;border:none;border-radius:0.75rem;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Cash In</button>
        <button id="btn-cashout" style="flex:1;min-width:120px;padding:0.75rem;border:none;border-radius:0.75rem;background:#f59e0b;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Cash Out</button>
        <button id="btn-gift" style="flex:1;min-width:120px;padding:0.75rem;border:none;border-radius:0.75rem;background:#ec4899;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Gift</button>
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

  // Check if user returned from PayMongo payment redirect
  const urlParams = new URLSearchParams(window.location.search);
  const topupResult = urlParams.get('topup');
  const topupId = urlParams.get('id');

  if (topupResult && topupId) {
    // Clean the URL params without reloading
    const cleanUrl = window.location.pathname + '#/wallet';
    window.history.replaceState({}, '', cleanUrl);
    showTopupResult(topupResult, topupId);
  } else {
    showTransactions();
  }

  document.getElementById('btn-cashin')?.addEventListener('click', showCashInForm);
  document.getElementById('btn-cashout')?.addEventListener('click', showCashOutForm);
  document.getElementById('btn-gift')?.addEventListener('click', showGiftForm);
  document.getElementById('btn-history')?.addEventListener('click', showTransactions);
}

async function loadWalletBalance() {
  try {
    const data = await coinsApi.getWallet();
    const w = data.wallet;
    const locked = w.locked_reward_balance || 0;
    const transferable = (w.transferable_available !== undefined && w.transferable_available !== null)
      ? w.transferable_available
      : (w.balance - (w.frozen_balance || 0) - locked);
    document.getElementById('wallet-balance').textContent = formatCoins(w.balance) + ' coins';
    document.getElementById('wallet-transferable').textContent =
      `${formatCoins(transferable)} transferable (giftable + withdrawable)`;
    document.getElementById('wallet-locked').textContent = locked > 0
      ? `${formatCoins(locked)} locked reward coins (spendable, not transferable)`
      : '';
    document.getElementById('wallet-frozen').textContent = w.frozen_balance > 0
      ? `${formatCoins(w.frozen_balance)} coins frozen`
      : '';
    return w;
  } catch (err) {
    console.error('[WALLET] Failed to load balance:', err);
    document.getElementById('wallet-balance').textContent = 'Error loading balance';
    return null;
  }
}

/**
 * Show payment result after returning from PayMongo redirect.
 * Polls the topup status briefly to reflect the latest state.
 */
function showTopupResult(result, topupId) {
  const section = document.getElementById('wallet-section');
  const isSuccess = result === 'success';

  section.innerHTML = `
    <div style="background:#fff;border-radius:0.75rem;padding:1.25rem;border:1px solid #e5e7eb;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:0.75rem;">${isSuccess ? '&#9989;' : '&#10060;'}</div>
      <h3 style="font-family:'Fredoka',sans-serif;font-size:1.1rem;margin-bottom:0.5rem;">
        ${isSuccess ? 'Payment Successful' : 'Payment Failed'}
      </h3>
      <p style="font-size:0.85rem;color:#6b7280;margin-bottom:1rem;">
        ${isSuccess
          ? 'Your payment is being processed. Coins will be credited shortly.'
          : 'Your payment was not completed. No coins were deducted. Please try again.'}
      </p>
      <div id="topup-status-msg" style="font-size:0.85rem;color:#6b7280;">Checking status...</div>
      <button onclick="window.location.hash='/wallet';window.location.reload()" style="margin-top:1rem;padding:0.6rem 1.5rem;border:none;border-radius:0.5rem;background:#0e6e6e;color:#fff;font-weight:600;cursor:pointer;">Back to Wallet</button>
    </div>
  `;

  // Poll topup status
  (async () => {
    try {
      const data = await coinsApi.getTopupStatus(topupId);
      const msgEl = document.getElementById('topup-status-msg');
      if (msgEl && data.topup) {
        const s = data.topup.status;
        const color = STATUS_COLORS[s] || '#6b7280';
        msgEl.innerHTML = `Status: ${statusBadge(s)} — ${formatCoins(data.topup.coins_amount)} coins (₱${data.topup.php_amount})`;
      }
      await loadWalletBalance();
    } catch (err) {
      const msgEl = document.getElementById('topup-status-msg');
      if (msgEl) msgEl.textContent = 'Status will update shortly. Refresh to check.';
    }
  })();
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
      <p style="font-size:0.85rem;color:#6b7280;margin-bottom:1rem;">Rate: 10 coins = ₱1. Choose your payment method and amount — you'll be redirected to complete payment securely.</p>
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
        <div id="cashin-error" style="color:#ef4444;font-size:0.85rem;margin-bottom:0.75rem;"></div>
        <button type="submit" id="cashin-submit" style="width:100%;padding:0.75rem;border:none;border-radius:0.5rem;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Proceed to Payment</button>
      </form>
    </div>
  `;

  document.getElementById('cashin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('cashin-error');
    const btn = document.getElementById('cashin-submit');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Preparing payment...';

    const amount = parseFloat(document.getElementById('cashin-amount').value);
    const method = document.getElementById('cashin-method').value;

    try {
      const result = await coinsApi.createTopup(amount, method);
      const redirectUrl = result.topup?.redirect_url;
      if (redirectUrl) {
        btn.textContent = 'Redirecting...';
        window.location.href = redirectUrl;
      } else {
        errEl.textContent = 'Payment redirect URL not received. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Proceed to Payment';
      }
    } catch (err) {
      errEl.style.color = '#ef4444';
      errEl.textContent = err.message || 'Failed to initiate payment.';
      btn.disabled = false;
      btn.textContent = 'Proceed to Payment';
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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Gift Coins flow (COINS-02): search → select recipient → amount →
 * confirm → send. One idempotency key per form session so retries and
 * double-clicks settle into a single transfer server-side.
 */
let giftRecipient = null;
let giftIdempotencyKey = null;
let giftSearchSeq = 0;

function showGiftForm() {
  setActiveBtn('btn-gift');
  giftRecipient = null;
  giftIdempotencyKey = (window.crypto && window.crypto.randomUUID)
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const section = document.getElementById('wallet-section');
  section.innerHTML = `
    <div style="background:#fff;border-radius:0.75rem;padding:1.25rem;border:1px solid #e5e7eb;">
      <h3 style="font-family:'Fredoka',sans-serif;font-size:1.1rem;margin-bottom:0.25rem;">Gift Coins</h3>
      <p style="font-size:0.85rem;color:#6b7280;margin-bottom:1rem;">Send Coins to another KomuniPH user.</p>
      <div style="margin-bottom:1rem;">
        <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.25rem;color:#374151;">Gift To</label>
        <div id="gift-recipient-box">
          <input type="text" id="gift-search" placeholder="Search username or name..." autocomplete="off"
            style="width:100%;padding:0.6rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.95rem;">
          <div id="gift-results" style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.375rem;"></div>
        </div>
      </div>
      <div style="margin-bottom:1rem;">
        <label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:0.25rem;color:#374151;">Amount</label>
        <input type="number" id="gift-amount" min="1" step="1" required placeholder="Enter Coins"
          style="width:100%;padding:0.6rem;border:1px solid #d1d5db;border-radius:0.5rem;font-size:0.95rem;">
      </div>
      <div id="gift-error" style="color:#ef4444;font-size:0.85rem;margin-bottom:0.75rem;"></div>
      <div style="display:flex;gap:0.5rem;">
        <button id="gift-cancel" style="flex:1;padding:0.75rem;border:1px solid #d1d5db;border-radius:0.5rem;background:#fff;color:#374151;font-weight:600;cursor:pointer;font-size:0.95rem;">Cancel</button>
        <button id="gift-continue" style="flex:1;padding:0.75rem;border:none;border-radius:0.5rem;background:#ec4899;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Continue</button>
      </div>
    </div>
  `;

  const searchInput = document.getElementById('gift-search');
  let debounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => searchGiftRecipients(searchInput.value.trim()), 300);
  });

  document.getElementById('gift-cancel').addEventListener('click', showTransactions);
  document.getElementById('gift-continue').addEventListener('click', continueGiftToConfirm);
}

async function searchGiftRecipients(query) {
  const box = document.getElementById('gift-results');
  if (!box) return;
  if (query.length < 2) {
    box.innerHTML = '';
    return;
  }
  const seq = ++giftSearchSeq;
  box.innerHTML = '<p style="font-size:0.8rem;color:#9ca3af;">Searching...</p>';
  try {
    const data = await coinsApi.searchUsers(query);
    if (seq !== giftSearchSeq || !document.getElementById('gift-results')) return;
    const users = data.users || [];
    if (!users.length) {
      box.innerHTML = '<p style="font-size:0.8rem;color:#9ca3af;">No users found.</p>';
      return;
    }
    box.innerHTML = users.map(u => `
      <button type="button" data-user-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}"
        data-display="${escapeHtml(u.display_name)}" ${u.is_self ? 'disabled' : ''}
        class="gift-result-btn"
        style="display:flex;align-items:center;gap:0.625rem;padding:0.5rem;border:1px solid #e5e7eb;border-radius:0.5rem;background:#fff;cursor:${u.is_self ? 'not-allowed' : 'pointer'};opacity:${u.is_self ? '0.55' : '1'};text-align:left;width:100%;">
        ${u.profile_photo_url
          ? `<img src="${escapeHtml(u.profile_photo_url)}" alt="" style="width:2rem;height:2rem;border-radius:50%;object-fit:cover;">`
          : `<span style="width:2rem;height:2rem;border-radius:50%;background:#0e6e6e;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;">${escapeHtml((u.display_name || u.username || '?').charAt(0).toUpperCase())}</span>`}
        <span>
          <span style="display:block;font-weight:600;font-size:0.9rem;color:#1f2937;">${escapeHtml(u.display_name)}${u.is_self ? ' (you)' : ''}</span>
          <span style="display:block;font-size:0.78rem;color:#6b7280;">@${escapeHtml(u.username)}</span>
        </span>
      </button>
    `).join('');
    box.querySelectorAll('.gift-result-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => selectGiftRecipient({
        id: btn.dataset.userId,
        username: btn.dataset.username,
        display_name: btn.dataset.display,
      }));
    });
  } catch (err) {
    if (seq !== giftSearchSeq) return;
    box.innerHTML = '<p style="font-size:0.8rem;color:#ef4444;">Search failed. Try again.</p>';
  }
}

function selectGiftRecipient(user) {
  giftRecipient = user;
  const box = document.getElementById('gift-recipient-box');
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.625rem;padding:0.625rem;border:1px solid #ec4899;border-radius:0.5rem;background:#fdf2f8;">
      <span style="flex:1;">
        <span style="display:block;font-weight:600;font-size:0.9rem;color:#1f2937;">${escapeHtml(user.display_name)}</span>
        <span style="display:block;font-size:0.78rem;color:#6b7280;">@${escapeHtml(user.username)}</span>
      </span>
      <button type="button" id="gift-change" style="border:none;background:none;color:#ec4899;font-weight:600;cursor:pointer;font-size:0.85rem;">Change recipient</button>
    </div>
    <div id="gift-results" style="margin-top:0.5rem;"></div>
  `;
  document.getElementById('gift-change').addEventListener('click', () => {
    const amountInput = document.getElementById('gift-amount');
    const previousAmount = amountInput ? amountInput.value : '';
    giftRecipient = null;
    showGiftForm();
    const restored = document.getElementById('gift-amount');
    if (restored) restored.value = previousAmount;
  });
}

async function continueGiftToConfirm() {
  const errEl = document.getElementById('gift-error');
  errEl.textContent = '';
  if (!giftRecipient) {
    errEl.textContent = 'Please search and select a recipient first.';
    return;
  }
  const rawAmount = document.getElementById('gift-amount').value;
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount <= 0) {
    errEl.textContent = 'Please enter a positive whole number of Coins.';
    return;
  }
  let balance = null;
  let transferable = null;
  try {
    const data = await coinsApi.getWallet();
    balance = data.wallet.balance;
    const locked = data.wallet.locked_reward_balance || 0;
    transferable = (data.wallet.transferable_available !== undefined && data.wallet.transferable_available !== null)
      ? data.wallet.transferable_available
      : (balance - (data.wallet.frozen_balance || 0) - locked);
  } catch (err) {
    errEl.textContent = 'Could not load your balance. Please try again.';
    return;
  }
  if (amount > transferable) {
    errEl.textContent = `Insufficient transferable balance. You can gift up to ${formatCoins(transferable)} Coins (locked reward Coins cannot be gifted).`;
    return;
  }

  const section = document.getElementById('wallet-section');
  section.innerHTML = `
    <div style="background:#fff;border-radius:0.75rem;padding:1.25rem;border:1px solid #e5e7eb;">
      <h3 style="font-family:'Fredoka',sans-serif;font-size:1.1rem;margin-bottom:1rem;">Confirm Gift</h3>
      <div style="font-size:0.9rem;color:#374151;display:flex;flex-direction:column;gap:0.375rem;margin-bottom:1rem;">
        <div><span style="color:#6b7280;">Recipient:</span> <strong>${escapeHtml(giftRecipient.display_name)} (@${escapeHtml(giftRecipient.username)})</strong></div>
        <div><span style="color:#6b7280;">Amount:</span> <strong>${formatCoins(amount)} Coins</strong></div>
        <div><span style="color:#6b7280;">Transferable balance:</span> <strong>${formatCoins(transferable)} Coins</strong></div>
        <div><span style="color:#6b7280;">Balance after:</span> <strong>${formatCoins(transferable - amount)} Coins transferable</strong></div>
      </div>
      <div id="gift-error" style="color:#ef4444;font-size:0.85rem;margin-bottom:0.75rem;"></div>
      <div style="display:flex;gap:0.5rem;">
        <button id="gift-back" style="flex:1;padding:0.75rem;border:1px solid #d1d5db;border-radius:0.5rem;background:#fff;color:#374151;font-weight:600;cursor:pointer;font-size:0.95rem;">Cancel</button>
        <button id="gift-confirm" style="flex:1;padding:0.75rem;border:none;border-radius:0.5rem;background:#ec4899;color:#fff;font-weight:600;cursor:pointer;font-size:0.95rem;">Confirm Gift</button>
      </div>
    </div>
  `;
  document.getElementById('gift-back').addEventListener('click', () => {
    const previousRecipient = giftRecipient;
    showGiftForm();
    if (previousRecipient) selectGiftRecipient(previousRecipient);
  });
  document.getElementById('gift-confirm').addEventListener('click', () => submitGift(amount));
}

async function submitGift(amount) {
  const errEl = document.getElementById('gift-error');
  const btn = document.getElementById('gift-confirm');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const result = await coinsApi.sendGift(giftRecipient.username, amount, giftIdempotencyKey);
    const g = result.gift;
    const section = document.getElementById('wallet-section');
    section.innerHTML = `
      <div style="background:#fff;border-radius:0.75rem;padding:1.25rem;border:1px solid #e5e7eb;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:0.75rem;">&#127873;</div>
        <h3 style="font-family:'Fredoka',sans-serif;font-size:1.1rem;margin-bottom:0.5rem;">Gift Sent Successfully</h3>
        <p style="font-size:0.9rem;color:#374151;margin-bottom:1rem;">
          ${formatCoins(g.amount)} Coins sent to ${escapeHtml(g.recipient.display_name)} (@${escapeHtml(g.recipient.username)}).
        </p>
        <p style="font-size:0.8rem;color:#6b7280;margin-bottom:1rem;">They have been notified.</p>
        <button id="gift-done" style="padding:0.6rem 1.5rem;border:none;border-radius:0.5rem;background:#0e6e6e;color:#fff;font-weight:600;cursor:pointer;">Back to Wallet</button>
      </div>
    `;
    document.getElementById('gift-done').addEventListener('click', showTransactions);
    await loadWalletBalance();
  } catch (err) {
    errEl.textContent = err.message || 'Failed to send gift.';
    btn.disabled = false;
    btn.textContent = 'Confirm Gift';
  }
}
function setActiveBtn(activeId) {
  ['btn-cashin', 'btn-cashout', 'btn-gift', 'btn-history'].forEach(id => {
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
