/**
 * KomuniPH Lite - Notifications (COINS-02)
 *
 * First notification system in KomuniPH: no prior notifications table, API,
 * or UI existed to reuse, so this minimal module follows the existing
 * conventions (better-sqlite3 helpers, jsonResponse/errorResponse,
 * requireAuth, matchRoute). Notification types are open-ended strings;
 * 'coin_gift' is the first type. A UNIQUE guard on
 * (user_id, reference_type, reference_id) ensures one source event notifies
 * its recipient exactly once.
 */

import { queryOne, queryAll, execute } from './database.js';
import { generateId, now, jsonResponse, errorResponse, parseBody, parseQuery } from './utils.js';

export const NOTIFICATION_TYPES = new Set(['general', 'coin_gift']);

/**
 * Insert a notification row. Uses plain execute() so it joins the caller's
 * better-sqlite3 transaction (savepoint) when composed — e.g. the gift flow
 * rolls the notification back together with the coin movement on failure.
 */
export function createNotification({ userId, type = 'general', title = '', body = '', referenceType = null, referenceId = null, link = null }) {
  if (!userId) throw new Error('Notification recipient is required');
  if (!NOTIFICATION_TYPES.has(type)) throw new Error(`Invalid notification type: ${type}`);
  const id = generateId();
  execute(
    `INSERT INTO notifications (id, user_id, type, title, body, reference_type, reference_id, link, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, userId, type, title, body, referenceType, referenceId, link, now()]
  );
  return id;
}

function serializeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title || '',
    body: row.body || '',
    reference_type: row.reference_type || null,
    reference_id: row.reference_id || null,
    link: row.link || null,
    is_read: row.is_read === 1,
    created_at: row.created_at,
    read_at: row.read_at || null,
  };
}

/** GET /api/notifications — own notifications, newest first. */
export function handleListNotifications(req, res, user) {
  try {
    const { params } = parseQuery(req.url);
    const limit = Math.min(Math.max(1, parseInt(params.limit || '20', 10) || 20), 100);
    const offset = Math.max(0, parseInt(params.offset || '0', 10) || 0);
    const rows = queryAll(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [user.sub, limit, offset]
    );
    const totalRow = queryOne('SELECT COUNT(*) as count FROM notifications WHERE user_id = ?', [user.sub]);
    jsonResponse(res, 200, {
      notifications: rows.map(serializeRow).filter(Boolean),
      total: totalRow ? totalRow.count : 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[NOTIFICATIONS] List error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** GET /api/notifications/unread-count — own unread total. */
export function handleGetUnreadNotificationCount(req, res, user) {
  try {
    const row = queryOne(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [user.sub]
    );
    jsonResponse(res, 200, { unread_count: row ? row.count : 0 });
  } catch (err) {
    console.error('[NOTIFICATIONS] Unread count error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** POST /api/notifications/:id/read — mark one own notification read. */
export function handleMarkNotificationRead(req, res, user, params) {
  try {
    const existing = queryOne(
      'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
      [params.id, user.sub]
    );
    if (!existing) return errorResponse(res, 404, 'Notification not found');
    execute(
      "UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE id = ? AND user_id = ?",
      [params.id, user.sub]
    );
    jsonResponse(res, 200, { success: true });
  } catch (err) {
    console.error('[NOTIFICATIONS] Mark read error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** POST /api/notifications/read-all — mark all own notifications read. */
export function handleMarkAllNotificationsRead(req, res, user) {
  try {
    execute(
      "UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE user_id = ? AND is_read = 0",
      [user.sub]
    );
    jsonResponse(res, 200, { success: true });
  } catch (err) {
    console.error('[NOTIFICATIONS] Mark all read error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}
