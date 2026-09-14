/**
 * KomuniPH Lite - Testimonials
 * Testimonials API routes
 */

import { queryOne, queryAll, execute } from './database.js';
import { generateId, now, jsonResponse, errorResponse, parseBody } from './utils.js';

const MAX_TESTIMONIAL_LENGTH = 1000;
const VALID_STATUSES = new Set(['active', 'pending', 'hidden', 'deleted']);

/**
 * Handle GET /api/profiles/:username/testimonials
 * Returns active testimonials for a profile by username (public, no auth required).
 */
export function handleGetTestimonials(req, res, params) {
  try {
    const username = params.username ? params.username.toLowerCase() : '';

    const profile = queryOne(
      'SELECT user_id FROM profiles p JOIN users u ON p.user_id = u.id WHERE u.username = ?',
      [username]
    );

    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const limit = Math.min(parseInt(params.limit || '50', 10), 100);
    const offset = parseInt(params.offset || '0', 10);

    const testimonials = queryAll(`
      SELECT
        t.id,
        t.profile_user_id,
        t.author_user_id,
        t.message,
        t.created_at,
        t.updated_at,
        t.status,
        u.username as author_username,
        pr.display_name as author_display_name,
        pr.first_name as author_first_name,
        pr.middle_name as author_middle_name,
        pr.last_name as author_last_name,
        pr.nickname as author_nickname,
        pr.profile_photo_url as author_profile_photo_url
      FROM testimonials t
      JOIN users u ON t.author_user_id = u.id
      LEFT JOIN profiles pr ON t.author_user_id = pr.user_id
      WHERE t.profile_user_id = ? AND t.status = 'active'
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `, [profile.user_id, limit, offset]);

    const transformed = testimonials.map(t => ({
      id: t.id,
      message: t.message,
      created_at: t.created_at,
      updated_at: t.updated_at,
      author: {
        username: t.author_username,
        display_name: t.author_display_name || getProfileDisplayName({
          first_name: t.author_first_name,
          middle_name: t.author_middle_name,
          last_name: t.author_last_name,
          nickname: t.author_nickname,
        }) || t.author_username || '',
        profile_photo_url: t.author_profile_photo_url || null,
      },
    }));

    jsonResponse(res, 200, {
      testimonials: transformed,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[TESTIMONIALS] Get testimonials error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Build display name from profile name fields (same logic as frontend).
 */
function getProfileDisplayName(profile) {
  if (!profile) return '';
  const firstName = profile.first_name || '';
  const middleName = profile.middle_name || '';
  const lastName = profile.last_name || '';
  const fullNameParts = [firstName, middleName, lastName].filter(Boolean);
  return fullNameParts.join(' ') || '';
}

/**
 * Handle POST /api/testimonials
 * Creates a testimonial on behalf of the authenticated user for a target profile.
 * The author is always the authenticated user — author_user_id is never trusted
 * from the client.
 */
export async function handleCreateTestimonial(req, res, user) {
  try {
    const body = await parseBody(req);
    const { target_username, message } = body;

    if (!target_username || typeof target_username !== 'string') {
      return errorResponse(res, 422, 'Target username is required');
    }

    const trimmedUsername = target_username.trim().toLowerCase();

    if (trimmedUsername === user.username || trimmedUsername === user.sub) {
      return errorResponse(res, 400, 'Cannot submit a testimonial to yourself');
    }

    // Resolve the target profile by username.
    const targetProfile = queryOne(
      'SELECT user_id FROM profiles p JOIN users u ON p.user_id = u.id WHERE u.username = ?',
      [trimmedUsername]
    );

    if (!targetProfile) {
      return errorResponse(res, 404, 'Target profile not found');
    }

    const targetUserId = targetProfile.user_id;

    // Prevent testimonials to yourself (double-check by user_id).
    if (targetUserId === user.sub) {
      return errorResponse(res, 400, 'Cannot submit a testimonial to yourself');
    }

    // Validate message.
    if (!message || typeof message !== 'string' || !message.trim()) {
      return errorResponse(res, 422, 'Testimonial message is required');
    }

    const trimmedMessage = message.trim();

    if (trimmedMessage.length > MAX_TESTIMONIAL_LENGTH) {
      return errorResponse(res, 422, `Testimonial must be less than ${MAX_TESTIMONIAL_LENGTH} characters`);
    }

    // Check for an existing testimonial from this author to this target.
    // Each author may only have one testimonial per target (update instead of duplicate).
    const existing = queryOne(
      'SELECT id FROM testimonials WHERE profile_user_id = ? AND author_user_id = ?',
      [targetUserId, user.sub]
    );

    const timestamp = now();
    let testimonialId;

    if (existing) {
      execute(
        'UPDATE testimonials SET message = ?, status = ?, updated_at = ? WHERE id = ?',
        [trimmedMessage, 'active', timestamp, existing.id]
      );
      testimonialId = existing.id;
    } else {
      testimonialId = generateId();
      execute(
        'INSERT INTO testimonials (id, profile_user_id, author_user_id, message, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [testimonialId, targetUserId, user.sub, trimmedMessage, timestamp, timestamp, 'active']
      );
    }

    // Fetch the created/updated testimonial with author info.
    const testimonial = queryOne(`
      SELECT
        t.id,
        t.profile_user_id,
        t.author_user_id,
        t.message,
        t.created_at,
        t.updated_at,
        t.status,
        u.username as author_username,
        pr.display_name as author_display_name,
        pr.first_name as author_first_name,
        pr.middle_name as author_middle_name,
        pr.last_name as author_last_name,
        pr.nickname as author_nickname,
        pr.profile_photo_url as author_profile_photo_url
      FROM testimonials t
      JOIN users u ON t.author_user_id = u.id
      LEFT JOIN profiles pr ON t.author_user_id = pr.user_id
      WHERE t.id = ?
    `, [testimonialId]);

    jsonResponse(res, 201, {
      id: testimonial.id,
      message: testimonial.message,
      created_at: testimonial.created_at,
      updated_at: testimonial.updated_at,
      status: testimonial.status,
      author: {
        username: testimonial.author_username,
        display_name: testimonial.author_display_name || getProfileDisplayName({
          first_name: testimonial.author_first_name,
          middle_name: testimonial.author_middle_name,
          last_name: testimonial.author_last_name,
          nickname: testimonial.author_nickname,
        }) || testimonial.author_username || '',
        profile_photo_url: testimonial.author_profile_photo_url || null,
      },
      is_current_user_author: true,
    });
  } catch (err) {
    console.error('[TESTIMONIALS] Create testimonial error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle DELETE /api/testimonials/:id
 * Deletes a testimonial (owner only).
 */
export function handleDeleteTestimonial(req, res, user, params) {
  try {
    const testimonial = queryOne(
      'SELECT * FROM testimonials WHERE id = ?',
      [params.id]
    );

    if (!testimonial) {
      return errorResponse(res, 404, 'Testimonial not found');
    }

    if (testimonial.author_user_id !== user.sub) {
      return errorResponse(res, 403, 'Not authorized to delete this testimonial');
    }

    execute('DELETE FROM testimonials WHERE id = ?', [params.id]);

    jsonResponse(res, 200, { message: 'Testimonial deleted successfully' });
  } catch (err) {
    console.error('[TESTIMONIALS] Delete testimonial error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/testimonials/mine
 * Returns testimonials authored by the current user, grouped by profile.
 */
export function handleGetUserTestimonials(req, res, user) {
  try {
    const testimonials = queryAll(`
      SELECT
        t.id,
        t.profile_user_id,
        t.author_user_id,
        t.message,
        t.created_at,
        t.updated_at,
        t.status,
        u.username as profile_username,
        pr.display_name as profile_display_name,
        pr.first_name as profile_first_name,
        pr.middle_name as profile_middle_name,
        pr.last_name as profile_last_name
      FROM testimonials t
      JOIN users u ON t.profile_user_id = u.id
      LEFT JOIN profiles pr ON t.profile_user_id = pr.user_id
      WHERE t.author_user_id = ? AND t.status IN ('active', 'pending')
      ORDER BY t.created_at DESC
    `, [user.sub]);

    const transformed = testimonials.map(t => ({
      id: t.id,
      message: t.message,
      created_at: t.created_at,
      updated_at: t.updated_at,
      status: t.status,
      profile: {
        username: t.profile_username,
        display_name: t.profile_display_name || getProfileDisplayName({
          first_name: t.profile_first_name,
          middle_name: t.profile_middle_name,
          last_name: t.profile_last_name,
        }) || t.profile_username || '',
      },
      is_current_user_author: true,
    }));

    jsonResponse(res, 200, { testimonials: transformed });
  } catch (err) {
    console.error('[TESTIMONIALS] Get user testimonials error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}
