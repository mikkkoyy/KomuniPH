/**
 * KomuniPH Lite - User Search (COINS-02)
 *
 * Minimal authenticated user lookup backing the Gift Coins recipient
 * picker. Returns only public profile fields — never email, password,
 * address, verification data, or wallet balances.
 */

import { queryAll } from './database.js';
import { jsonResponse, errorResponse, parseQuery } from './utils.js';

const SEARCH_LIMIT = 10;

/** GET /api/users/search?q= — username / display-name lookup. */
export function handleSearchUsers(req, res, user) {
  try {
    const { params } = parseQuery(req.url);
    const q = (params.q || '').trim();
    if (q.length < 2) {
      return jsonResponse(res, 200, { users: [] });
    }
    const like = `%${q}%`;
    const rows = queryAll(
      `SELECT u.id, u.username, p.display_name, p.profile_photo_url
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.account_status = 'active'
         AND (u.username LIKE ? OR p.display_name LIKE ?)
       ORDER BY
         CASE WHEN u.username LIKE ? THEN 0 ELSE 1 END,
         u.username ASC
       LIMIT ?`,
      [like, like, `${q}%`, SEARCH_LIMIT]
    );
    jsonResponse(res, 200, {
      users: rows.map(r => ({
        id: r.id,
        username: r.username,
        display_name: r.display_name || r.username,
        profile_photo_url: r.profile_photo_url || null,
        is_self: r.id === user.sub,
      })),
    });
  } catch (err) {
    console.error('[USERS] Search error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}
