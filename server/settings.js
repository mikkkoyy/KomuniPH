/**
 * KomuniPH Lite - App Settings (Admin)
 * CRUD for PayMongo configuration stored in app_settings table
 */

import { queryOne, queryAll, execute } from './database.js';
import { jsonResponse, errorResponse, parseBody } from './utils.js';

/**
 * Handle GET /api/admin/settings
 * Returns all app settings.
 */
export function handleGetSettings(req, res) {
  try {
    const rows = queryAll('SELECT key, value FROM app_settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    jsonResponse(res, 200, { settings });
  } catch (err) {
    console.error('[SETTINGS] Get settings error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle PUT /api/admin/settings
 * Upserts one or more settings. Body: { settings: { key: value, ... } }
 */
export async function handleUpdateSettings(req, res) {
  try {
    const body = await parseBody(req);
    const settings = body.settings || body;

    if (!settings || typeof settings !== 'object') {
      return errorResponse(res, 422, 'Settings object is required');
    }

    const allowedKeys = [
      'paymongo_enabled',
      'paymongo_secret_key',
      'paymongo_public_key',
      'paymongo_webhook_secret',
      'coins_per_php',
    ];

    let updated = 0;
    for (const [key, value] of Object.entries(settings)) {
      if (!allowedKeys.includes(key)) continue;
      execute(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [key, String(value)]
      );
      updated++;
    }

    jsonResponse(res, 200, { message: `${updated} setting(s) updated`, updated });
  } catch (err) {
    console.error('[SETTINGS] Update settings error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Helper: get a single setting value by key (returns string or null)
 */
export function getSetting(key) {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}
