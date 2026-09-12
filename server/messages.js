/**
 * KomuniPH Lite - Messages
 * Private messaging: conversations and messages.
 */

import { queryOne, queryAll, execute } from './database.js';
import { generateId, now, jsonResponse, errorResponse, parseBody, parseQuery } from './utils.js';
import { requireAuth } from './auth.js';

const MESSAGE_MAX_LENGTH = 2000;

/**
 * Shape a conversation row for the list endpoint, including the other
 * participant's public profile, the last message, and unread count.
 */
function shapeConversationRow(row, currentUserId) {
  const otherUser = row.other_username
    ? {
        username: row.other_username,
        display_name: row.other_display_name,
        alias: row.other_alias,
        alias_enabled: Boolean(row.other_alias_enabled),
        bio: row.other_bio,
        profile_photo_url: row.other_profile_photo_url,
        cover_photo_url: row.other_cover_photo_url,
      }
    : null;

  return {
    id: row.id,
    updated_at: row.updated_at,
    other_user: otherUser,
    last_message: row.last_message_body
      ? {
          id: row.last_message_id,
          body: row.last_message_body,
          created_at: row.last_message_created_at,
          sender_id: row.last_message_sender_id,
        }
      : null,
    unread_count: row.unread_count || 0,
  };
}

/**
 * POST /api/messages/conversations
 * Create a new 1:1 conversation with target_user_id, or return the
 * existing one if it already exists.
 */
export async function handleCreateConversation(req, res, user) {
  try {
    const body = await parseBody(req);
    const targetUserId = body.user_id;

    if (!targetUserId) {
      return errorResponse(res, 422, 'user_id is required');
    }

    if (targetUserId === user.sub) {
      return errorResponse(res, 422, 'Cannot start a conversation with yourself');
    }

    // Verify target user exists
    const targetUser = queryOne('SELECT id FROM users WHERE id = ?', [targetUserId]);
    if (!targetUser) {
      return errorResponse(res, 404, 'User not found');
    }

    // Look for an existing conversation where both users are participants
    const existing = queryOne(
      `
      SELECT c.id FROM conversations c
      INNER JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
      INNER JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
      LIMIT 1
      `,
      [user.sub, targetUserId]
    );

    if (existing) {
      const row = queryOne(
        `
        SELECT
          c.id,
          c.updated_at,
          u.username AS other_username,
          pr.display_name AS other_display_name,
          pr.alias AS other_alias,
          pr.alias_enabled AS other_alias_enabled,
          pr.bio AS other_bio,
          pr.profile_photo_url AS other_profile_photo_url,
          pr.cover_photo_url AS other_cover_photo_url,
          m.id AS last_message_id,
          m.body AS last_message_body,
          m.created_at AS last_message_created_at,
          m.sender_id AS last_message_sender_id
        FROM conversations c
        INNER JOIN conversation_participants cp ON cp.conversation_id = c.id
        INNER JOIN users u ON u.id = CASE WHEN cp.user_id = ? THEN ? ELSE cp.user_id END
        LEFT JOIN profiles pr ON pr.user_id = u.id
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.id = ?
        ORDER BY m.created_at DESC
        LIMIT 1
        `,
        [user.sub, targetUserId, existing.id]
      );

      return jsonResponse(res, 200, shapeConversationRow(row, user.sub));
    }

    const conversationId = generateId();
    const timestamp = now();

    execute(
      `INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)`,
      [conversationId, timestamp, timestamp]
    );

    execute(
      `INSERT INTO conversation_participants (conversation_id, user_id, joined_at)
       VALUES (?, ?, ?), (?, ?, ?)`,
      [conversationId, user.sub, timestamp, conversationId, targetUserId, timestamp]
    );

    const created = queryOne(
      `
      SELECT
        c.id,
        c.updated_at,
        u.username AS other_username,
        pr.display_name AS other_display_name,
        pr.alias AS other_alias,
        pr.alias_enabled AS other_alias_enabled,
        pr.bio AS other_bio,
        pr.profile_photo_url AS other_profile_photo_url,
        pr.cover_photo_url AS other_cover_photo_url
      FROM conversations c
      INNER JOIN conversation_participants cp ON cp.conversation_id = c.id
      INNER JOIN users u ON u.id = CASE WHEN cp.user_id = ? THEN ? ELSE cp.user_id END
      LEFT JOIN profiles pr ON pr.user_id = u.id
      WHERE c.id = ?
      `,
      [user.sub, targetUserId, conversationId]
    );

    return jsonResponse(res, 201, shapeConversationRow(created, user.sub));
  } catch (err) {
    console.error('[MESSAGES] Create conversation error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/messages/conversations
 * List conversations the authenticated user participates in, newest first.
 */
export function handleListConversations(req, res, user) {
  try {
    const { params } = parseQuery(req.url);
    const limit = Math.min(parseInt(params.limit || '20', 10), 100);
    const offset = parseInt(params.offset || '0', 10);

    const rows = queryAll(
      `
      SELECT
        c.id,
        c.updated_at,
        u.username AS other_username,
        pr.display_name AS other_display_name,
        pr.alias AS other_alias,
        pr.alias_enabled AS other_alias_enabled,
        pr.bio AS other_bio,
        pr.profile_photo_url AS other_profile_photo_url,
        pr.cover_photo_url AS other_cover_photo_url,
        m.id AS last_message_id,
        m.body AS last_message_body,
        m.created_at AS last_message_created_at,
        m.sender_id AS last_message_sender_id,
        COALESCE(
          (SELECT COUNT(*) FROM messages m2
           WHERE m2.conversation_id = c.id
             AND m2.sender_id != ?
             AND (cp.last_read_at IS NULL OR m2.created_at > cp.last_read_at)
          ),
          0
        ) AS unread_count
      FROM conversations c
      INNER JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
      INNER JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id != ?
      INNER JOIN users u ON u.id = cp2.user_id
      LEFT JOIN profiles pr ON pr.user_id = u.id
      LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
      `,
      [user.sub, user.sub, user.sub, limit, offset]
    );

    const totalCountRow = queryOne(
      `SELECT COUNT(DISTINCT c.id) as count
       FROM conversations c
       INNER JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?`,
      [user.sub]
    );

    const hasMore = offset + limit < (totalCountRow ? totalCountRow.count : 0);

    const conversations = rows.map((row) => shapeConversationRow(row, user.sub));

    jsonResponse(res, 200, {
      conversations,
      limit,
      offset,
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[MESSAGES] List conversations error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/messages/conversations/:id/messages
 * Return paginated messages for a conversation the user participates in.
 */
export function handleGetMessages(req, res, user, params) {
  try {
    const conversationId = params.id;

    // Verify participation
    const participant = queryOne(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, user.sub]
    );

    if (!participant) {
      return errorResponse(res, 403, 'You are not a participant in this conversation');
    }

    const { params: queryParams } = parseQuery(req.url);
    const limit = Math.min(parseInt(queryParams.limit || '50', 10), 100);
    const offset = parseInt(queryParams.offset || '0', 10);

    const totalCount = queryOne(
      'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
      [conversationId]
    );

    const messages = queryAll(
      `
      SELECT
        m.id,
        m.conversation_id,
        m.sender_id,
        m.body,
        m.created_at,
        u.username,
        pr.display_name,
        pr.alias,
        pr.alias_enabled,
        pr.profile_photo_url
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN profiles pr ON pr.user_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at ASC
      LIMIT ? OFFSET ?
      `,
      [conversationId, limit, offset]
    );

    const hasMore = offset + limit < (totalCount ? totalCount.count : 0);

    const transformed = messages.map((msg) => ({
      id: msg.id,
      conversation_id: msg.conversation_id,
      sender_id: msg.sender_id,
      body: msg.body,
      created_at: msg.created_at,
      is_current_user_sender: msg.sender_id === user.sub,
      author: {
        username: msg.username,
        display_name: msg.display_name || msg.username,
        alias: msg.alias,
        alias_enabled: Boolean(msg.alias_enabled),
        profile_photo_url: msg.profile_photo_url,
      },
    }));

    jsonResponse(res, 200, {
      messages: transformed,
      limit,
      offset,
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[MESSAGES] Get messages error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/messages/conversations/:id/messages
 * Send a message to a conversation the user participates in.
 */
export async function handleSendMessage(req, res, user, params) {
  try {
    const conversationId = params.id;

    // Verify participation
    const participant = queryOne(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, user.sub]
    );

    if (!participant) {
      return errorResponse(res, 403, 'You are not a participant in this conversation');
    }

    const body = await parseBody(req);
    const rawBody = body.body;

    if (rawBody === undefined || rawBody === null) {
      return errorResponse(res, 422, 'Message body is required');
    }

    const trimmed = String(rawBody).trim();
    if (!trimmed) {
      return errorResponse(res, 422, 'Message body is required');
    }
    if (trimmed.length > MESSAGE_MAX_LENGTH) {
      return errorResponse(res, 422, `Message must be less than ${MESSAGE_MAX_LENGTH} characters`);
    }

    const messageId = generateId();
    const timestamp = now();

    execute(
      `INSERT INTO messages (id, conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)`,
      [messageId, conversationId, user.sub, trimmed, timestamp]
    );

    // Update conversation updated_at
    execute(
      `UPDATE conversations SET updated_at = ? WHERE id = ?`,
      [timestamp, conversationId]
    );

    // Fetch the created message with author info
    const message = queryOne(
      `
      SELECT
        m.id,
        m.conversation_id,
        m.sender_id,
        m.body,
        m.created_at,
        u.username,
        pr.display_name,
        pr.alias,
        pr.alias_enabled,
        pr.profile_photo_url
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN profiles pr ON pr.user_id = u.id
      WHERE m.id = ?
      `,
      [messageId]
    );

    jsonResponse(res, 201, {
      id: message.id,
      conversation_id: message.conversation_id,
      sender_id: message.sender_id,
      body: message.body,
      created_at: message.created_at,
      is_current_user_sender: message.sender_id === user.sub,
      author: {
        username: message.username,
        display_name: message.display_name || message.username,
        alias: message.alias,
        alias_enabled: Boolean(message.alias_enabled),
        profile_photo_url: message.profile_photo_url,
      },
    });
  } catch (err) {
    console.error('[MESSAGES] Send message error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/messages/unread-count
 * Return the authenticated user's total unread message count.
 */
export function handleGetUnreadCount(req, res, user) {
  try {
    const row = queryOne(
      `
      SELECT COUNT(*) as count
      FROM messages m
      JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
      WHERE cp.user_id = ?
        AND m.sender_id != ?
        AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
      `,
      [user.sub, user.sub]
    );

    jsonResponse(res, 200, {
      unread_count: row ? row.count : 0,
    });
  } catch (err) {
    console.error('[MESSAGES] Unread count error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/messages/conversations/:id/read
 * Mark the authenticated user's view of a conversation as read.
 */
export function handleMarkConversationRead(req, res, user, params) {
  try {
    const conversationId = params.id;

    // Verify participation
    const participant = queryOne(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, user.sub]
    );

    if (!participant) {
      return errorResponse(res, 403, 'You are not a participant in this conversation');
    }

    const timestamp = now();

    execute(
      `UPDATE conversation_participants SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?`,
      [timestamp, conversationId, user.sub]
    );

    jsonResponse(res, 200, { success: true });
  } catch (err) {
    console.error('[MESSAGES] Mark read error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}
