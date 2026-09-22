/**
 * KomuniPH Lite - Admin Coin Economy Panel
 * Manage top-ups and withdrawals, view economy summary
 */

import { apiRequest } from './api.js';

const adminApi = {
  getSummary() { return apiRequest('/admin/coins/summary'); },
  listTopups(status = 'pending', limit = 50, offset = 0) {
    return apiRequest(`/admin/coins/topups?status=${status}&limit=${limit}&offset=${offset}`);
  },
  approveTopup(id, adminNotes = null) {
    return apiRequest(`/admin/coins/topups/${id}/approve`, {
      method: 'POST', body: { admin_notes: adminNotes },
    });
  },
  rejectTopup(id, adminNotes = null) {
    return apiRequest(`/admin/coins/topups/${id}/reject`, {
      method: 'POST', body: { admin_notes: adminNotes },
    });
  },
  listWithdrawals(status = 'pending', limit = 50, offset = 0) {
    return apiRequest(`/admin/coins/withdrawals?status=${status}&limit=${limit}&offset=${offset}`);
  },
  approveWithdrawal(id, adminNotes = null) {
    return apiRequest(`/admin/coins/withdrawals/${id}/approve`, {
      method: 'POST', body: { admin_notes: adminNotes },
    });
  },
  rejectWithdrawal(id, adminNotes = null) {
    return apiRequest(`/admin/coins/withdrawals/${id}/reject`, {
      method: 'POST', body: { admin_notes: adminNotes },
    });
  },
  completeWithdrawal(id, adminNotes = null) {
    return apiRequest(`/admin/coins/withdrawals/${id}/complete`, {
      method: 'POST', body: { admin_notes: adminNotes },
    });
  },
};

function formatCoins(n) { return Number(n).toLocaleString(); }
function formatPhp(n) { return '₱' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const STATUS_COLORS = {
  pending: '#f59e0b', approved: '#3b82f6', completed: '#10b981', rejected: '#ef4444',
};
function statusBadge(status) {
  const color = STATUS_COLORS[status] || '#6b7280';
  return `<span style="background:${color}20;color:${color};padding:2px 8px;border-radius:9999px;font-size:0.75rem;font-weight:600;text-transform:uppercase;">${status}</span>`;
}

let activeTab = 'topups';

export function renderAdminPage() {
  return `
    <div id="admin-page" style="max-width:960px;margin:0 auto;padding:1rem;">
      <h2 style="font-family:'Fredoka',sans-serif;font-size:1.5rem;margin-bottom:1rem;">Coin Economy Admin</h2>

      <div id="admin-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem;margin-bottom:1.5rem;"></div>

      <div style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;">
        <button id="admin-tab-topups" onclick="window.__adminTab('topups')" style="padding:0.5rem 1rem;border:none;border-radius:0.5rem;font-weight:600;cursor:pointer;font-size:0.9rem;">Top-Ups</button>
        <button id="admin-tab-withdrawals" onclick="window.__adminTab('withdrawals')" style="padding:0.5rem 1rem;border:none;border-radius:0.5rem;font-weight:600;cursor:pointer;font-size:0.9rem;">Withdrawals</button>
      </div>

      <div id="admin-list"></div>
    </div>
  `;
}

export async function initAdminPage() {
  window.__adminTab = switchTab;
  window.__adminAction = handleAction;

  await loadSummary();
  switchTab('topups');
}

function setActiveTab(tabId) {
  ['admin-tab-topups', 'admin-tab-withdrawals'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const isActive = id === `admin-tab-${tabId}`;
    btn.style.background = isActive ? '#0e6e6e' : '#e5e7eb';
    btn.style.color = isActive ? '#fff' : '#374151';
  });
}

async function loadSummary() {
  try {
    const data = await adminApi.getSummary();
    const s = data.summary;
    document.getElementById('admin-summary').innerHTML = `
      ${statCard('Total Coins', formatCoins(s.total_coins_in_circulation), '#0e6e6e')}
      ${statCard('Frozen', formatCoins(s.total_frozen_coins), '#f97316')}
      ${statCard('Pending Top-Ups', s.pending_topups, '#f59e0b')}
      ${statCard('Pending Withdrawals', s.pending_withdrawals, '#f59e0b')}
      ${statCard('Total Wallets', s.total_wallets, '#3b82f6')}
      ${statCard('Total Transactions', s.total_transactions, '#6366f1')}
    `;
  } catch (err) {
    document.getElementById('admin-summary').innerHTML = '<p style="color:#ef4444;">Failed to load summary.</p>';
  }
}

function statCard(label, value, color) {
  return `
    <div style="background:#fff;border-radius:0.75rem;padding:1rem;border:1px solid #e5e7eb;text-align:center;">
      <div style="font-size:1.5rem;font-weight:700;color:${color};font-family:'Fredoka',sans-serif;">${value}</div>
      <div style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;">${label}</div>
    </div>
  `;
}

function switchTab(tab) {
  activeTab = tab;
  setActiveTab(tab);
  if (tab === 'topups') loadTopups();
  else loadWithdrawals();
}

async function loadTopups() {
  const el = document.getElementById('admin-list');
  el.innerHTML = '<p style="color:#6b7280;">Loading top-ups...</p>';

  try {
    const data = await adminApi.listTopups('pending');
    if (!data.topups.length) {
      el.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:2rem 0;">No pending top-ups.</p>';
      return;
    }
    el.innerHTML = data.topups.map(t => `
      <div style="background:#fff;border-radius:0.75rem;padding:1rem;border:1px solid #e5e7eb;margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
          <div>
            <span style="font-weight:600;color:#1f2937;">${t.username}</span>
            <span style="font-size:0.8rem;color:#9ca3af;margin-left:0.5rem;">${new Date(t.created_at).toLocaleString()}</span>
          </div>
          ${statusBadge(t.status)}
        </div>
        <div style="font-size:0.9rem;color:#374151;margin-bottom:0.5rem;">
          ${formatCoins(t.coins_amount)} coins (${formatPhp(t.php_amount)}) via <strong>${t.payment_method.toUpperCase()}</strong>
        </div>
        <div style="font-size:0.8rem;color:#6b7280;margin-bottom:0.75rem;">ID: ${t.id.slice(0, 12)}...</div>
        ${t.status === 'pending' ? `
          <div style="display:flex;gap:0.5rem;">
            <button onclick="window.__adminAction('topup','approve','${t.id}')" style="padding:0.4rem 1rem;border:none;border-radius:0.5rem;background:#10b981;color:#fff;font-weight:600;cursor:pointer;font-size:0.85rem;">Approve</button>
            <button onclick="window.__adminAction('topup','reject','${t.id}')" style="padding:0.4rem 1rem;border:none;border-radius:0.5rem;background:#ef4444;color:#fff;font-weight:600;cursor:pointer;font-size:0.85rem;">Reject</button>
          </div>
        ` : ''}
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = '<p style="color:#ef4444;">Failed to load top-ups.</p>';
  }
}

async function loadWithdrawals() {
  const el = document.getElementById('admin-list');
  el.innerHTML = '<p style="color:#6b7280;">Loading withdrawals...</p>';

  try {
    const data = await adminApi.listWithdrawals('pending');
    if (!data.withdrawals.length) {
      el.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:2rem 0;">No pending withdrawals.</p>';
      return;
    }
    el.innerHTML = data.withdrawals.map(w => `
      <div style="background:#fff;border-radius:0.75rem;padding:1rem;border:1px solid #e5e7eb;margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
          <div>
            <span style="font-weight:600;color:#1f2937;">${w.username}</span>
            <span style="font-size:0.8rem;color:#9ca3af;margin-left:0.5rem;">${new Date(w.created_at).toLocaleString()}</span>
          </div>
          ${statusBadge(w.status)}
        </div>
        <div style="font-size:0.9rem;color:#374151;margin-bottom:0.25rem;">
          ${formatCoins(w.coins_amount)} coins (${formatPhp(w.php_amount)}) via <strong>${w.payment_method.toUpperCase()}</strong>
        </div>
        <div style="font-size:0.8rem;color:#6b7280;margin-bottom:0.25rem;">
          ${w.account_name} &middot; ${w.account_number}
        </div>
        <div style="font-size:0.8rem;color:#9ca3af;margin-bottom:0.75rem;">ID: ${w.id.slice(0, 12)}...</div>
        ${w.status === 'pending' ? `
          <div style="display:flex;gap:0.5rem;">
            <button onclick="window.__adminAction('withdrawal','approve','${w.id}')" style="padding:0.4rem 1rem;border:none;border-radius:0.5rem;background:#10b981;color:#fff;font-weight:600;cursor:pointer;font-size:0.85rem;">Approve</button>
            <button onclick="window.__adminAction('withdrawal','reject','${w.id}')" style="padding:0.4rem 1rem;border:none;border-radius:0.5rem;background:#ef4444;color:#fff;font-weight:600;cursor:pointer;font-size:0.85rem;">Reject</button>
          </div>
        ` : ''}
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = '<p style="color:#ef4444;">Failed to load withdrawals.</p>';
  }
}

async function handleAction(type, action, id) {
  const label = type === 'topup' ? 'Top-up' : 'Withdrawal';
  if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this ${label.toLowerCase()}?`)) return;

  try {
    if (type === 'topup') {
      if (action === 'approve') await adminApi.approveTopup(id);
      else await adminApi.rejectTopup(id);
    } else {
      if (action === 'approve') await adminApi.approveWithdrawal(id);
      else if (action === 'reject') await adminApi.rejectWithdrawal(id);
      else await adminApi.completeWithdrawal(id);
    }
    await loadSummary();
    if (type === 'topup') await loadTopups();
    else await loadWithdrawals();
  } catch (err) {
    alert(err.message || 'Action failed');
  }
}
