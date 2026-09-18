/**
 * KomuniPH Lite - Feed
 * Feed routes (posts, comments, reactions)
 */

import { queryOne, queryAll, execute, transaction } from './database.js';
import { generateId, now, jsonResponse, errorResponse, parseBody, parseQuery } from './utils.js';
import { isEligible } from './communities.js';

/**
 * Handle GET /api/feed
 * Returns paginated feed
 */
export function handleGetFeed(req, res, user) {
  try {
    const { params } = parseQuery(req.url);
    const limit = Math.min(parseInt(params.limit || '20', 10), 100);
    const offset = parseInt(params.offset || '0', 10);

    const posts = queryAll(`
SELECT
          p.id,
          p.content,
          p.created_at,
          p.updated_at,
          p.edited_at,
          u.username,
          pr.display_name,
          pr.bio,
          pr.profile_photo_url,
          pr.cover_photo_url,
          (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id) as like_count,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count,
          (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.user_id = ?) as liked_by_current_user,
          CASE WHEN p.author_id = ? THEN 1 ELSE 0 END as is_current_user_author
        FROM posts p
          JOIN users u ON p.author_id = u.id
          LEFT JOIN profiles pr ON p.author_id = pr.user_id
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
    `, [user.sub, user.sub, limit, offset]);

    const totalCount = queryOne('SELECT COUNT(*) as count FROM posts');
    const hasMore = offset + limit < totalCount.count;

    // Transform posts to match frontend expectations
const transformedPosts = posts.map(post => ({
      id: post.id,
      author: {
        username: post.username,
        display_name: post.display_name,
        bio: post.bio,
        profile_photo_url: post.profile_photo_url,
        cover_photo_url: post.cover_photo_url,
      },
      content: post.content,
      created_at: post.created_at,
      updated_at: post.updated_at,
      like_count: post.like_count,
      liked_by_current_user: Boolean(post.liked_by_current_user),
      comment_count: post.comment_count,
      is_current_user_author: Boolean(post.is_current_user_author),
      edited_at: post.edited_at,
    }));

    jsonResponse(res, 200, {
      posts: transformedPosts,
      limit,
      offset,
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[FEED] Get feed error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/feed/posts
 * Creates a new post
 */
export async function handleCreatePost(req, res, user) {
  try {
    const body = await parseBody(req);
    const { content } = body;
    const communityId = body.community_id || null;

    if (!content || content.trim().length === 0) {
      return errorResponse(res, 422, 'Post content is required');
    }

    if (content.length > 5000) {
      return errorResponse(res, 422, 'Post content must be less than 5000 characters');
    }

    // COMMUNITY-01: community posts require an active membership in the target
    // community AND current geographic eligibility. community_id is validated
    // server-side; a forged id can never scope a post to another community.
    if (communityId) {
      const community = queryOne('SELECT * FROM communities WHERE id = ?', [communityId]);
      if (!community) {
        return errorResponse(res, 404, 'Community not found');
      }
      const member = queryOne(
        'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
        [communityId, user.sub]
      );
      if (!member) {
        return errorResponse(res, 403, 'You must be a member to post in this community');
      }
      const profile = queryOne(
        'SELECT country, city, barangay FROM profiles WHERE user_id = ?',
        [user.sub]
      );
      if (!isEligible(community, profile)) {
        return errorResponse(res, 403, 'You are no longer eligible for this community');
      }
    }

    const postId = generateId();
    const timestamp = now();

    execute(
      'INSERT INTO posts (id, author_id, content, community_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [postId, user.sub, content.trim(), communityId, timestamp, timestamp]
    );

    // Fetch the created post with author info
    const post = queryOne(`
      SELECT
        p.id,
        p.content,
        p.created_at,
        p.updated_at,
        p.edited_at,
        u.username,
        pr.display_name,
        pr.alias,
        pr.alias_enabled,
        pr.bio,
        pr.profile_photo_url,
        pr.cover_photo_url
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN profiles pr ON p.author_id = pr.user_id
      WHERE p.id = ?
    `, [postId]);

    jsonResponse(res, 201, {
      id: post.id,
      author: {
        username: post.username,
        display_name: post.display_name,
        alias: post.alias,
        alias_enabled: Boolean(post.alias_enabled),
        bio: post.bio,
        profile_photo_url: post.profile_photo_url,
        cover_photo_url: post.cover_photo_url,
      },
      content: post.content,
      created_at: post.created_at,
      updated_at: post.updated_at,
      like_count: 0,
      liked_by_current_user: false,
      comment_count: 0,
      is_current_user_author: true,
      edited_at: post.edited_at,
    });
  } catch (err) {
    console.error('[FEED] Create post error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle PATCH /api/feed/posts/:id
 * Updates a post (owner only)
 */
export async function handleUpdatePost(req, res, user, params) {
  try {
    const post = queryOne('SELECT * FROM posts WHERE id = ?', [params.id]);
    if (!post) {
      return errorResponse(res, 404, 'Post not found');
    }

    if (post.author_id !== user.sub) {
      return errorResponse(res, 403, 'Not authorized to edit this post');
    }

    const body = await parseBody(req);
    const { content } = body;

    if (!content || content.trim().length === 0) {
      return errorResponse(res, 422, 'Post content is required');
    }

    if (content.length > 5000) {
      return errorResponse(res, 422, 'Post content must be less than 5000 characters');
    }

    const timestamp = now();
    execute(
      'UPDATE posts SET content = ?, updated_at = ?, edited_at = ? WHERE id = ?',
      [content.trim(), timestamp, timestamp, params.id]
    );

    // Fetch updated post
    const updatedPost = queryOne(`
      SELECT
        p.id,
        p.content,
        p.created_at,
        p.updated_at,
        p.edited_at,
        u.username,
        pr.display_name,
        pr.alias,
        pr.alias_enabled,
        pr.bio,
        pr.profile_photo_url,
        pr.cover_photo_url,
        (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count,
        (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id AND r.user_id = ?) as liked_by_current_user
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN profiles pr ON p.author_id = pr.user_id
      WHERE p.id = ?
    `, [user.sub, params.id]);

    jsonResponse(res, 200, {
      id: updatedPost.id,
      author: {
        username: updatedPost.username,
        display_name: updatedPost.display_name,
        alias: updatedPost.alias,
        alias_enabled: Boolean(updatedPost.alias_enabled),
        bio: updatedPost.bio,
        profile_photo_url: updatedPost.profile_photo_url,
        cover_photo_url: updatedPost.cover_photo_url,
      },
      content: updatedPost.content,
      created_at: updatedPost.created_at,
      updated_at: updatedPost.updated_at,
      like_count: updatedPost.like_count,
      liked_by_current_user: Boolean(updatedPost.liked_by_current_user),
      comment_count: updatedPost.comment_count,
      is_current_user_author: true,
      edited_at: updatedPost.edited_at,
    });
  } catch (err) {
    console.error('[FEED] Update post error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle DELETE /api/feed/posts/:id
 * Deletes a post (owner only)
 */
export function handleDeletePost(req, res, user, params) {
  try {
    const post = queryOne('SELECT * FROM posts WHERE id = ?', [params.id]);
    if (!post) {
      return errorResponse(res, 404, 'Post not found');
    }

    if (post.author_id !== user.sub) {
      return errorResponse(res, 403, 'Not authorized to delete this post');
    }

    execute('DELETE FROM posts WHERE id = ?', [params.id]);

    jsonResponse(res, 200, { message: 'Post deleted successfully' });
  } catch (err) {
    console.error('[FEED] Delete post error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/feed/posts/:id/like
 * Likes a post
 */
export function handleLikePost(req, res, user, params) {
  try {
    const post = queryOne('SELECT id FROM posts WHERE id = ?', [params.id]);
    if (!post) {
      return errorResponse(res, 404, 'Post not found');
    }

    // Check if already liked
    const existing = queryOne(
      'SELECT id FROM reactions WHERE post_id = ? AND user_id = ?',
      [params.id, user.sub]
    );

    if (!existing) {
      const reactionId = generateId();
      execute(
        'INSERT INTO reactions (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)',
        [reactionId, params.id, user.sub, now()]
      );
    }

    // Get updated counts
    const counts = queryOne(
      'SELECT COUNT(*) as like_count FROM reactions WHERE post_id = ?',
      [params.id]
    );

    jsonResponse(res, 200, {
      liked: true,
      like_count: counts.like_count,
    });
  } catch (err) {
    console.error('[FEED] Like post error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle DELETE /api/feed/posts/:id/like
 * Removes a like from a post
 */
export function handleUnlikePost(req, res, user, params) {
  try {
    execute(
      'DELETE FROM reactions WHERE post_id = ? AND user_id = ?',
      [params.id, user.sub]
    );

    const counts = queryOne(
      'SELECT COUNT(*) as like_count FROM reactions WHERE post_id = ?',
      [params.id]
    );

    jsonResponse(res, 200, {
      liked: false,
      like_count: counts.like_count,
    });
  } catch (err) {
    console.error('[FEED] Unlike post error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/feed/posts/:id/comments
 * Returns comments for a post
 */
export function handleGetComments(req, res, user, params) {
  try {
    const { params: queryParams } = parseQuery(req.url);
    const limit = Math.min(parseInt(queryParams.limit || '20', 10), 100);
    const offset = parseInt(queryParams.offset || '0', 10);

    const comments = queryAll(`
      SELECT
        c.id,
        c.post_id,
        c.content,
        c.created_at,
        c.updated_at,
        u.username,
        pr.display_name,
        pr.alias,
        pr.alias_enabled,
        pr.bio,
        pr.profile_photo_url,
        pr.cover_photo_url,
        CASE WHEN c.author_id = ? THEN 1 ELSE 0 END as is_current_user_author
      FROM comments c
      JOIN users u ON c.author_id = u.id
      LEFT JOIN profiles pr ON c.author_id = pr.user_id
      WHERE c.post_id = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `, [user.sub, params.id, limit, offset]);

    const totalCount = queryOne(
      'SELECT COUNT(*) as count FROM comments WHERE post_id = ?',
      [params.id]
    );

    const hasMore = offset + limit < totalCount.count;

    const transformedComments = comments.map(comment => ({
      id: comment.id,
      post_id: comment.post_id,
      author: {
        username: comment.username,
        display_name: comment.display_name,
        alias: comment.alias,
        alias_enabled: Boolean(comment.alias_enabled),
        bio: comment.bio,
        profile_photo_url: comment.profile_photo_url,
        cover_photo_url: comment.cover_photo_url,
      },
      content: comment.content,
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      is_current_user_author: Boolean(comment.is_current_user_author),
    }));

    jsonResponse(res, 200, {
      comments: transformedComments,
      limit,
      offset,
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[FEED] Get comments error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/feed/posts/:id/comments
 * Creates a comment on a post
 */
export async function handleCreateComment(req, res, user, params) {
  try {
    const post = queryOne('SELECT id FROM posts WHERE id = ?', [params.id]);
    if (!post) {
      return errorResponse(res, 404, 'Post not found');
    }

    const body = await parseBody(req);
    const { content } = body;

    if (!content || content.trim().length === 0) {
      return errorResponse(res, 422, 'Comment content is required');
    }

    if (content.length > 2000) {
      return errorResponse(res, 422, 'Comment content must be less than 2000 characters');
    }

    const commentId = generateId();
    const timestamp = now();

    execute(
      'INSERT INTO comments (id, post_id, author_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [commentId, params.id, user.sub, content.trim(), timestamp, timestamp]
    );

    // Fetch the created comment
    const comment = queryOne(`
      SELECT
        c.id,
        c.post_id,
        c.content,
        c.created_at,
        c.updated_at,
        u.username,
        pr.display_name,
        pr.alias,
        pr.alias_enabled,
        pr.bio,
        pr.profile_photo_url,
        pr.cover_photo_url
      FROM comments c
      JOIN users u ON c.author_id = u.id
      LEFT JOIN profiles pr ON c.author_id = pr.user_id
      WHERE c.id = ?
    `, [commentId]);

    jsonResponse(res, 201, {
      id: comment.id,
      post_id: comment.post_id,
      author: {
        username: comment.username,
        display_name: comment.display_name,
        alias: comment.alias,
        alias_enabled: Boolean(comment.alias_enabled),
        bio: comment.bio,
        profile_photo_url: comment.profile_photo_url,
        cover_photo_url: comment.cover_photo_url,
      },
      content: comment.content,
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      is_current_user_author: true,
    });
  } catch (err) {
    console.error('[FEED] Create comment error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle DELETE /api/feed/comments/:id
 * Deletes a comment (owner only)
 */
export function handleDeleteComment(req, res, user, params) {
  try {
    const comment = queryOne('SELECT * FROM comments WHERE id = ?', [params.id]);
    if (!comment) {
      return errorResponse(res, 404, 'Comment not found');
    }

    if (comment.author_id !== user.sub) {
      return errorResponse(res, 403, 'Not authorized to delete this comment');
    }

    execute('DELETE FROM comments WHERE id = ?', [params.id]);

    jsonResponse(res, 200, { message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('[FEED] Delete comment error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}
