/**
 * KomuniPH Lite - Admin Panel
 * Full admin interface: login, dashboard, cash-in/out management, settings
 */

const ADMIN_TOKEN_KEY = 'komuniph_admin_token';
const ADMIN_USER_KEY = 'komuniph_admin_user';

/* ── Admin API Client ─────────────────────────────────── */
function getAdminToken() { return localStorage.getItem(ADMIN_TOKEN_KEY); }
function setAdminToken(t) { localStorage.setItem(ADMIN_TOKEN_KEY, t); }
function clearAdminToken() { localStorage.removeItem(ADMIN_TOKEN_KEY); localStorage.removeItem(ADMIN_USER_KEY); }
function isAdminLoggedIn() { return !!getAdminToken(); }

async function adminRequest(path, options = {}) {
  const { method = 'GET', body } = options;
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  const token = getAdminToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init = { method, cache: 'no-store', headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(`/api${path}`, init);
  const ct = res.headers.get('content-type') || '';
  const parsed = ct.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const err = new Error(parsed?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return parsed;
}

/* ── Helpers ───────────────────────────────────────────── */
function formatCoins(n) { return Number(n).toLocaleString(); }
function formatPhp(n) { return '₱' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function shortDate(s) { return s ? new Date(s).toLocaleDateString() : '—'; }
function badge(status) {
  const cls = `badge badge-${status}`;
  return `<span class="${cls}">${status}</span>`;
}

/* ── Toast ─────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg, type = 'info') {
  let container = document.getElementById('admin-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'admin-toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  container.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.remove(); }, 3500);
}

/* ── Login Page ────────────────────────────────────────── */
export function renderAdminLoginPage() {
  return `
    <div class="admin-login-wrap">
      <div class="admin-login-card">
        <h2>KomuniPH Admin</h2>
        <p>Sign in to manage the coin economy</p>
        <form id="admin-login-form">
          <div class="form-group">
            <label>Username</label>
            <input type="text" id="admin-username" required autocomplete="username" placeholder="admin">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="admin-password" required autocomplete="current-password" placeholder="Password">
          </div>
          <div id="admin-login-error" style="color:#ef4444;font-size:0.85rem;margin-bottom:0.75rem;"></div>
          <button type="submit" class="btn btn-primary" style="width:100%;padding:0.7rem;">Sign In</button>
        </form>
      </div>
    </div>
  `;
}

export function initAdminLoginPage() {
  document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('admin-login-error');
    errEl.textContent = '';
    try {
      const data = await adminRequest('/admin/login', {
        method: 'POST',
        body: {
          username: document.getElementById('admin-username').value.trim(),
          password: document.getElementById('admin-password').value,
        },
      });
      setAdminToken(data.access_token);
      localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
      window.location.hash = '/admin/dashboard';
    } catch (err) {
      errEl.textContent = err.message || 'Login failed';
    }
  });
}

/* ── Sidebar Layout ────────────────────────────────────── */
function renderAdminLayout(activePage, contentHtml) {
  const user = JSON.parse(localStorage.getItem(ADMIN_USER_KEY) || '{}');
  const links = [
    { id: 'dashboard',  icon: '&#9632;', label: 'Dashboard',  hash: '#/admin/dashboard' },
    { id: 'cashin',     icon: '&#9650;', label: 'Cash-In',     hash: '#/admin/cashin' },
    { id: 'cashout',    icon: '&#9660;', label: 'Cash-Out',    hash: '#/admin/cashout' },
    { id: 'settings',   icon: '&#9881;', label: 'Settings',    hash: '#/admin/settings' },
  ];

  return `
    <div class="admin-layout">
      <aside class="admin-sidebar">
        <div class="admin-sidebar-header">
          <h3>KomuniPH</h3>
          <span>Admin Panel</span>
        </div>
        <nav class="admin-sidebar-nav">
          ${links.map(l => `
            <a href="${l.hash}" class="${l.id === activePage ? 'active' : ''}">
              <span>${l.icon}</span>
              <span>${l.label}</span>
            </a>
          `).join('')}
        </nav>
        <div class="admin-sidebar-footer">
          <button onclick="window.location.hash='/admin/login';localStorage.removeItem('${ADMIN_TOKEN_KEY}');localStorage.removeItem('${ADMIN_USER_KEY}');">
            <span>&#10140;</span> <span>Logout</span>
          </button>
        </div>
      </aside>
      <main class="admin-main">
        ${contentHtml}
      </main>
    </div>
  `;
}

/* ── Dashboard ─────────────────────────────────────────── */
function renderDashboard() {
  return renderAdminLayout('dashboard', `
    <h2>Dashboard</h2>
    <div id="admin-stats" class="stats-grid"></div>
    <div class="admin-card">
      <h3>Change Admin Password</h3>
      <form id="change-pw-form" style="max-width:400px;">
        <div class="form-group">
          <label>Current Password</label>
          <input type="password" id="pw-current" required>
        </div>
        <div class="form-group">
          <label>New Password</label>
          <input type="password" id="pw-new" required minlength="8">
        </div>
        <div class="form-group">
          <label>Confirm New Password</label>
          <input type="password" id="pw-confirm" required minlength="8">
        </div>
        <div id="pw-msg" style="font-size:0.85rem;margin-bottom:0.75rem;"></div>
        <button type="submit" class="btn btn-primary">Update Password</button>
      </form>
    </div>
  `);
}

async function initDashboard() {
  try {
    const data = await adminRequest('/admin/coins/summary');
    const s = data.summary;
    document.getElementById('admin-stats').innerHTML = `
      <div class="stat-card"><div class="stat-value" style="color:#0e6e6e;">${formatCoins(s.total_coins_in_circulation)}</div><div class="stat-label">Total Coins</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#f97316;">${formatCoins(s.total_frozen_coins)}</div><div class="stat-label">Frozen Coins</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#f59e0b;">${s.pending_topups}</div><div class="stat-label">Pending Cash-In</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#f59e0b;">${s.pending_withdrawals}</div><div class="stat-label">Pending Cash-Out</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#3b82f6;">${s.total_wallets}</div><div class="stat-label">Total Wallets</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#6366f1;">${s.total_transactions}</div><div class="stat-label">Transactions</div></div>
    `;
  } catch (err) {
    document.getElementById('admin-stats').innerHTML = `<p style="color:#ef4444;">Failed to load stats.</p>`;
  }

  document.getElementById('change-pw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('pw-msg');
    const pwNew = document.getElementById('pw-new').value;
    const pwConfirm = document.getElementById('pw-confirm').value;
    msgEl.textContent = '';
    if (pwNew !== pwConfirm) { msgEl.style.color = '#ef4444'; msgEl.textContent = 'Passwords do not match.'; return; }
    try {
      await adminRequest('/admin/change-password', {
        method: 'POST',
        body: {
          current_password: document.getElementById('pw-current').value,
          new_password: pwNew,
          confirm_password: pwConfirm,
        },
      });
      msgEl.style.color = '#10b981';
      msgEl.textContent = 'Password changed successfully.';
      document.getElementById('change-pw-form').reset();
      showToast('Password updated', 'success');
    } catch (err) {
      msgEl.style.color = '#ef4444';
      msgEl.textContent = err.message || 'Failed to change password.';
    }
  });
}

/* ── Cash-In Requests ──────────────────────────────────── */
function renderCashIn() {
  return renderAdminLayout('cashin', `
    <h2>Cash-In Requests</h2>
    <div class="filter-tabs" id="cashin-tabs">
      <button class="filter-tab active" data-status="pending">Pending</button>
      <button class="filter-tab" data-status="completed">Completed</button>
      <button class="filter-tab" data-status="rejected">Rejected</button>
    </div>
    <div id="cashin-table"></div>
  `);
}

let cashinFilter = 'pending';

async function loadCashInTable() {
  const el = document.getElementById('cashin-table');
  el.innerHTML = '<p style="color:#6b7280;">Loading...</p>';
  try {
    const data = await adminRequest(`/admin/coins/topups?status=${cashinFilter}`);
    if (!data.topups.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128179;</div>No requests found.</div>';
      return;
    }
    el.innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>User</th><th>PHP</th><th>Coins</th><th>Method</th><th>Ref #</th><th>Date</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${data.topups.map(t => `<tr>
              <td><strong>${t.username}</strong></td>
              <td>${formatPhp(t.php_amount)}</td>
              <td>${formatCoins(t.coins_amount)}</td>
              <td>${(t.payment_method || '').toUpperCase()}</td>
              <td>${t.reference_number || '<span style="color:#9ca3af;">—</span>'}</td>
              <td>${shortDate(t.created_at)}</td>
              <td>${badge(t.status)}</td>
              <td class="actions">
                ${t.status === 'pending' ? `
                  <button class="btn btn-success btn-sm" onclick="window.__adminAction('topup','approve','${t.id}')">Complete</button>
                  <button class="btn btn-danger btn-sm" onclick="window.__adminAction('topup','reject','${t.id}')">Reject</button>
                ` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<p style="color:#ef4444;">Failed to load: ${err.message}</p>`;
  }
}

/* ── Cash-Out Requests ─────────────────────────────────── */
function renderCashOut() {
  return renderAdminLayout('cashout', `
    <h2>Cash-Out Requests</h2>
    <div class="filter-tabs" id="cashout-tabs">
      <button class="filter-tab active" data-status="pending">Pending</button>
      <button class="filter-tab" data-status="approved">Approved</button>
      <button class="filter-tab" data-status="completed">Completed</button>
      <button class="filter-tab" data-status="rejected">Rejected</button>
    </div>
    <div id="cashout-table"></div>
  `);
}

let cashoutFilter = 'pending';

async function loadCashOutTable() {
  const el = document.getElementById('cashout-table');
  el.innerHTML = '<p style="color:#6b7280;">Loading...</p>';
  try {
    const data = await adminRequest(`/admin/coins/withdrawals?status=${cashoutFilter}`);
    if (!data.withdrawals.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128179;</div>No requests found.</div>';
      return;
    }
    el.innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>User</th><th>Coins</th><th>PHP</th><th>Method</th><th>Account #</th><th>Name</th><th>Date</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${data.withdrawals.map(w => `<tr>
              <td><strong>${w.username}</strong></td>
              <td>${formatCoins(w.coins_amount)}</td>
              <td>${formatPhp(w.php_amount)}</td>
              <td>${(w.payment_method || '').toUpperCase()}</td>
              <td>${w.account_number}</td>
              <td>${w.account_name}</td>
              <td>${shortDate(w.created_at)}</td>
              <td>${badge(w.status)}</td>
              <td class="actions">
                ${w.status === 'pending' ? `
                  <button class="btn btn-success btn-sm" onclick="window.__adminAction('withdrawal','approve','${w.id}')">Approve</button>
                  <button class="btn btn-danger btn-sm" onclick="window.__adminAction('withdrawal','reject','${w.id}')">Reject</button>
                ` : ''}
                ${w.status === 'approved' ? `
                  <button class="btn btn-primary btn-sm" onclick="window.__adminAction('withdrawal','complete','${w.id}')">Mark Complete</button>
                  <button class="btn btn-danger btn-sm" onclick="window.__adminAction('withdrawal','reject','${w.id}')">Reject</button>
                ` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<p style="color:#ef4444;">Failed to load: ${err.message}</p>`;
  }
}

/* ── PayMongo Settings ─────────────────────────────────── */
function renderSettings() {
  return renderAdminLayout('settings', `
    <h2>PayMongo Settings</h2>
    <div class="admin-card">
      <form id="settings-form" style="max-width:500px;">
        <div class="form-group">
          <label>PayMongo Enabled</label>
          <select id="set-enabled">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div class="form-group">
          <label>Secret Key</label>
          <input type="password" id="set-secret" placeholder="sk_test_...">
        </div>
        <div class="form-group">
          <label>Public Key</label>
          <input type="text" id="set-public" placeholder="pk_test_...">
        </div>
        <div class="form-group">
          <label>Webhook Secret</label>
          <input type="password" id="set-webhook" placeholder="whsec_...">
        </div>
        <div class="form-group">
          <label>Coin-to-PHP Rate (coins per 1 PHP)</label>
          <input type="number" id="set-rate" min="1" value="10">
          <div class="form-hint">Currently: 10 coins = ₱1</div>
        </div>
        <div id="settings-msg" style="font-size:0.85rem;margin-bottom:0.75rem;"></div>
        <button type="submit" class="btn btn-primary">Save Settings</button>
      </form>
    </div>
  `);
}

async function initSettings() {
  try {
    const data = await adminRequest('/admin/settings');
    const s = data.settings || {};
    if (s.paymongo_enabled !== undefined) document.getElementById('set-enabled').value = s.paymongo_enabled;
    if (s.paymongo_secret_key) document.getElementById('set-secret').value = s.paymongo_secret_key;
    if (s.paymongo_public_key) document.getElementById('set-public').value = s.paymongo_public_key;
    if (s.paymongo_webhook_secret) document.getElementById('set-webhook').value = s.paymongo_webhook_secret;
    if (s.coins_per_php) document.getElementById('set-rate').value = s.coins_per_php;
  } catch (err) {
    console.warn('[ADMIN] Failed to load settings:', err);
  }

  document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('settings-msg');
    msgEl.textContent = '';
    try {
      await adminRequest('/admin/settings', {
        method: 'PUT',
        body: {
          settings: {
            paymongo_enabled: document.getElementById('set-enabled').value,
            paymongo_secret_key: document.getElementById('set-secret').value,
            paymongo_public_key: document.getElementById('set-public').value,
            paymongo_webhook_secret: document.getElementById('set-webhook').value,
            coins_per_php: document.getElementById('set-rate').value,
          },
        },
      });
      msgEl.style.color = '#10b981';
      msgEl.textContent = 'Settings saved.';
      showToast('Settings updated', 'success');
    } catch (err) {
      msgEl.style.color = '#ef4444';
      msgEl.textContent = err.message || 'Failed to save.';
    }
  });
}

/* ── Admin Router ──────────────────────────────────────── */
function getAdminRoute() {
  return window.location.hash.slice(1) || '/admin/login';
}

export function renderAdminPage() {
  const route = getAdminRoute();

  if (route === '/admin/login' || !isAdminLoggedIn()) {
    if (route !== '/admin/login') {
      window.location.hash = '/admin/login';
    }
    return renderAdminLoginPage();
  }

  switch (route) {
    case '/admin/dashboard': return renderDashboard();
    case '/admin/cashin':    return renderCashIn();
    case '/admin/cashout':   return renderCashOut();
    case '/admin/settings':  return renderSettings();
    default:
      window.location.hash = '/admin/dashboard';
      return renderDashboard();
  }
}

export async function initAdminPage() {
  const route = getAdminRoute();

  if (route === '/admin/login' || !isAdminLoggedIn()) {
    initAdminLoginPage();
    return;
  }

  window.__adminAction = handleAdminAction;

  switch (route) {
    case '/admin/dashboard':
      await initDashboard();
      break;
    case '/admin/cashin':
      setupFilterTabs('cashin-tabs', cashinFilter, (status) => { cashinFilter = status; loadCashInTable(); });
      await loadCashInTable();
      break;
    case '/admin/cashout':
      setupFilterTabs('cashout-tabs', cashoutFilter, (status) => { cashoutFilter = status; loadCashOutTable(); });
      await loadCashOutTable();
      break;
    case '/admin/settings':
      await initSettings();
      break;
  }
}

function setupFilterTabs(containerId, current, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.filter-tab').forEach(btn => {
    if (btn.dataset.status === current) btn.classList.add('active');
    else btn.classList.remove('active');
    btn.onclick = () => {
      container.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.status);
    };
  });
}

/* ── Actions ───────────────────────────────────────────── */
async function handleAdminAction(type, action, id) {
  const label = type === 'topup' ? 'cash-in' : 'cash-out';
  const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
  if (!confirm(`${actionLabel} this ${label} request?`)) return;

  try {
    if (type === 'topup') {
      if (action === 'approve') await adminRequest(`/admin/coins/topups/${id}/approve`, { method: 'POST', body: {} });
      else await adminRequest(`/admin/coins/topups/${id}/reject`, { method: 'POST', body: {} });
    } else {
      if (action === 'approve') await adminRequest(`/admin/coins/withdrawals/${id}/approve`, { method: 'POST', body: {} });
      else if (action === 'reject') await adminRequest(`/admin/coins/withdrawals/${id}/reject`, { method: 'POST', body: {} });
      else await adminRequest(`/admin/coins/withdrawals/${id}/complete`, { method: 'POST', body: {} });
    }
    showToast(`${actionLabel} successful`, 'success');
    if (type === 'topup') await loadCashInTable();
    else await loadCashOutTable();
  } catch (err) {
    showToast(err.message || 'Action failed', 'error');
  }
}
