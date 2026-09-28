/**
 * KomuniPH Lite - Notifications UI (COINS-02)
 *
 * Receiver inbox for notifications (first type: coin_gift). Unread badge in
 * the sidebar reuses the existing badge pattern; clicking a notification
 * marks it read and follows its link (gift notifications open #/wallet).
 */

import { apiRequest } from './api.js';
import { navigate } from './app.js';

export const notificationsApi = {
  async list(limit = 20, offset = 0) {
    return apiRequest(`/notifications?limit=${limit}&offset=${offset}`);
  },

  async getUnreadCount() {
    return apiRequest('/notifications/unread-count');
  },

  async markRead(id) {
    return apiRequest(`/notifications/${id}/read`, { method: 'POST' });
  },

  async markAllRead() {
    return apiRequest('/notifications/read-all', { method: 'POST' });
  },
};

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
 * Refresh the sidebar unread badge. Safe to call on every render when
 * authenticated; failures are silent so navigation never breaks.
 */
export async function refreshNotificationBadge() {
  try {
    const data = await notificationsApi.getUnreadCount();
    const badge = document.getElementById('sidebar-notifications-badge');
    if (!badge) return;
    const count = data.unread_count || 0;
    badge.textContent = count > 0 ? String(count) : '';
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  } catch {
    /* badge refresh is best-effort */
  }
}

export function renderNotificationsPage() {
  return `
    <div style="max-width:720px;margin:0 auto;padding:1rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h2 style="font-family:'Fredoka',sans-serif;font-size:1.5rem;">Notifications</h2>
        <button id="btn-mark-all-read" style="padding:0.5rem 1rem;border:1px solid #d1d5db;border-radius:0.5rem;background:#fff;color:#374151;font-weight:600;cursor:pointer;font-size:0.85rem;">Mark all read</button>
      </div>
      <div id="notifications-list" style="color:#6b7280;">Loading...</div>
    </div>
  `;
}

export async function initNotificationsPage() {
  document.getElementById('btn-mark-all-read')?.addEventListener('click', async () => {
    try {
      await notificationsApi.markAllRead();
      await loadNotifications();
      await refreshNotificationBadge();
    } catch {
      /* best-effort */
    }
  });
  await loadNotifications();
}

async function loadNotifications() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  try {
    const data = await notificationsApi.list(50, 0);
    const items = data.notifications || [];
    if (!items.length) {
      list.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:2rem 0;">No notifications yet.</p>';
      return;
    }
    list.innerHTML = items.map(n => `
      <button type="button" data-id="${escapeHtml(n.id)}" data-link="${escapeHtml(n.link || '')}"
        class="notification-item"
        style="display:flex;gap:0.75rem;width:100%;text-align:left;padding:0.875rem;border-radius:0.75rem;margin-bottom:0.5rem;cursor:pointer;
               background:${n.is_read ? '#fff' : '#fdf2f8'};border:1px solid ${n.is_read ? '#e5e7eb' : '#f9a8d4'};">
        <span style="font-size:1.4rem;">${n.type === 'coin_gift' ? '&#127873;' : '&#128276;'}</span>
        <span style="flex:1;">
          <span style="display:block;font-weight:600;font-size:0.9rem;color:#1f2937;">${escapeHtml(n.title || 'Notification')}</span>
          <span style="display:block;font-size:0.85rem;color:#4b5563;">${escapeHtml(n.body)}</span>
          <span style="display:block;font-size:0.72rem;color:#9ca3af;margin-top:0.2rem;">${new Date(n.created_at).toLocaleString()}</span>
        </span>
        ${n.is_read ? '' : '<span style="width:0.6rem;height:0.6rem;border-radius:50%;background:#ec4899;flex-shrink:0;margin-top:0.35rem;"></span>'}
      </button>
    `).join('');
    list.querySelectorAll('.notification-item').forEach(el => {
      el.addEventListener('click', async () => {
        try {
          await notificationsApi.markRead(el.dataset.id);
        } catch {
          /* still follow the link */
        }
        await refreshNotificationBadge();
        if (el.dataset.link) {
          window.location.hash = el.dataset.link;
        } else {
          await loadNotifications();
        }
      });
    });
  } catch {
    list.innerHTML = '<p style="color:#ef4444;">Failed to load notifications.</p>';
  }
}
