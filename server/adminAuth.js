/**
 * KomuniPH Lite - Admin Authentication
 * Dedicated admin login and password management endpoints
 */

import bcrypt from 'bcrypt';
import config from './config.js';
import { queryOne, execute } from './database.js';
import { generateId, now, jsonResponse, errorResponse, parseBody } from './utils.js';
import { createToken } from './auth.js';

const BCRYPT_ROUNDS = 12;

/**
 * Handle POST /api/admin/login
 * Admin-only login (must have role = 'admin')
 */
export async function handleAdminLogin(req, res) {
  try {
    const body = await parseBody(req);
    const { username, password } = body;

    if (!username || !password) {
      return errorResponse(res, 422, 'Username and password are required');
    }

    const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return errorResponse(res, 401, 'Invalid credentials');
    }

    if (user.role !== 'admin') {
      return errorResponse(res, 403, 'Admin access required');
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return errorResponse(res, 401, 'Invalid credentials');
    }

    const accessToken = createToken(user.id, 'access');
    const refreshToken = createToken(user.id, 'refresh');

    jsonResponse(res, 200, {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[ADMIN-AUTH] Login error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/admin/change-password
 * Requires current password verification
 */
export async function handleAdminChangePassword(req, res, user) {
  try {
    const body = await parseBody(req);
    const { current_password, new_password, confirm_password } = body;

    if (!current_password || !new_password || !confirm_password) {
      return errorResponse(res, 422, 'Current password, new password, and confirmation are required');
    }

    if (new_password.length < 8) {
      return errorResponse(res, 422, 'New password must be at least 8 characters');
    }

    if (new_password !== confirm_password) {
      return errorResponse(res, 422, 'New password and confirmation do not match');
    }

    const dbUser = queryOne('SELECT password_hash FROM users WHERE id = ?', [user.sub]);
    if (!dbUser) {
      return errorResponse(res, 404, 'User not found');
    }

    const passwordValid = await bcrypt.compare(current_password, dbUser.password_hash);
    if (!passwordValid) {
      return errorResponse(res, 401, 'Current password is incorrect');
    }

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
    execute(
      "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
      [newHash, user.sub]
    );

    jsonResponse(res, 200, { message: 'Password changed successfully' });
  } catch (err) {
    console.error('[ADMIN-AUTH] Change password error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}
