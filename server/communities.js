/**
 * KomuniPH Lite - Communities
 * Location-based community foundation (COMMUNITY-01).
 *
 * Community scopes:
 *   nationwide -> anchored to country only
 *   city       -> anchored to country + city
 *   barangay   -> anchored to country + city + barangay
 *
 * Eligibility is ALWAYS computed server-side from the user's stored profile
 * location (profiles.country / city / barangay). Client-supplied location
 * values are never trusted.
 */

import { queryOne, queryAll, execute } from './database.js';
import { generateId, jsonResponse, errorResponse, parseQuery } from './utils.js';
import { getCountries } from './locations.js';

/**
 * Build a URL-friendly slug from a community name.
 */
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'community';
}

/**
 * Insert a community row if an equivalent geographic community does not exist.
 * Duplicate geography is prevented by the partial unique indexes, so
 * INSERT OR IGNORE is a safe idempotent seed.
 */
function insertCommunity({ name, slug, type, description, country, city, barangay }) {
  execute(
    `INSERT OR IGNORE INTO communities
       (id, name, slug, type, description, country, city, barangay, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [generateId(), name, slug, type, description, country, city, barangay]
  );
}

/**
 * Seed the Nationwide community for every known country (currently just
 * Philippines). Idempotent: safe to call on every startup.
 */
export function seedNationwideCommunities() {
  const countries = getCountries();
  for (const country of countries) {
    insertCommunity({
      name: country,
      slug: `${slugify(country)}-nationwide`,
      type: 'nationwide',
      description: `The nationwide community for KomuniPH members in ${country}.`,
      country,
      city: null,
      barangay: null,
    });
  }
}

/**
 * Ensure the City and Barangay communities exist for a profile location.
 * This creates communities from real user/location data rather than seeding
 * hundreds of empty ones up front. Idempotent.
 *
 * @returns {string[]} the scope keys that were inserted, e.g. ['city', 'barangay']
 */
export function ensureCommunityForProfile(country, city, barangay) {
  const created = [];
  if (!country) return created;

  if (city) {
    insertCommunity({
      name: city,
      slug: `${slugify(city)}-city`,
      type: 'city',
      description: `The ${city} community in ${country}.`,
      country,
      city,
      barangay: null,
    });
    created.push('city');
  }

  if (city && barangay) {
    insertCommunity({
      name: barangay,
      slug: `${slugify(barangay)}-barangay`,
      type: 'barangay',
      description: `The ${barangay} community in ${city}, ${country}.`,
      country,
      city,
      barangay,
    });
    created.push('barangay');
  }

  return created;
}

/**
 * Seed City/Barangay communities from every existing profile with location
 * data. Safe to run on startup; idempotent.
 */
export function seedCommunitiesFromProfiles() {
  const profiles = queryAll(
    `SELECT country, city, barangay
       FROM profiles
      WHERE country IS NOT NULL OR city IS NOT NULL OR barangay IS NOT NULL`
  );
  for (const profile of profiles) {
    ensureCommunityForProfile(profile.country, profile.city, profile.barangay);
  }
}

/**
 * Nationwide communities use auto-membership: every eligible user is a member
 * with no join friction. Idempotent.
 */
export function autoJoinNationwide(userId, profile) {
  if (!profile || !profile.country) return;
  const communities = queryAll(
    `SELECT id FROM communities WHERE type = 'nationwide' AND country = ?`,
    [profile.country]
  );
  for (const community of communities) {
    execute(
      `INSERT OR IGNORE INTO community_members (id, community_id, user_id, joined_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [generateId(), community.id, userId]
    );
  }
}

/**
 * Compute whether a user (by stored profile location) is eligible for a
 * community. Comparison is done on the normalized stored values, which are
 * trimmed on profile update and sourced from the same locations data.
 */
export function isEligible(community, profile) {
  if (!community || !profile) return false;
  const country = (typeof profile.country === 'string' && profile.country.trim()) || null;
  const city = (typeof profile.city === 'string' && profile.city.trim()) || null;
  const barangay = (typeof profile.barangay === 'string' && profile.barangay.trim()) || null;

  switch (community.type) {
    case 'nationwide':
      return !!country && country === community.country;
    case 'city':
      return !!country && !!city &&
        country === community.country &&
        city === community.city;
    case 'barangay':
      return !!country && !!city && !!barangay &&
        country === community.country &&
        city === community.city &&
        barangay === community.barangay;
    default:
      return false;
  }
}

/**
 * Resolve the authenticated user's stored profile.
 */
function getProfileFor(userId) {
  return queryOne(
    `SELECT id, user_id, country, city, barangay FROM profiles WHERE user_id = ?`,
    [userId]
  );
}

/**
 * Load a community row by id.
 */
function getCommunity(id) {
  return queryOne('SELECT * FROM communities WHERE id = ?', [id]);
}

/**
 * Membership flag for a user in a community.
 * @returns {'member' | 'non-member'}
 */
function getMembership(communityId, userId) {
  const row = queryOne(
    'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId]
  );
  return row ? 'member' : 'non-member';
}

/**
 * Member count for a community.
 */
function getMemberCount(communityId) {
  const row = queryOne(
    'SELECT COUNT(*) AS count FROM community_members WHERE community_id = ?',
    [communityId]
  );
  return row ? row.count : 0;
}

/**
 * Public community shape returned to clients.
 */
function communityView(community, profile, includeEligibility = true) {
  const member_count = getMemberCount(community.id);
  const view = {
    id: community.id,
    name: community.name,
    slug: community.slug,
    type: community.type,
    description: community.description || '',
    country: community.country || null,
    city: community.city || null,
    barangay: community.barangay || null,
    member_count,
    membership: getMembership(community.id, profile.user_id),
  };
  if (includeEligibility) {
    view.eligibility = isEligible(community, profile);
  }
  return view;
}

/**
 * GET /api/communities
 * Returns the communities the authenticated user can access. Only eligible
 * communities are listed, each tagged with its eligibility and membership
 * status so the client never implies every returned id is joinable.
 */
export function handleListCommunities(req, res, user) {
  try {
    const profile = getProfileFor(user.sub);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    ensureCommunityForProfile(profile.country, profile.city, profile.barangay);
    autoJoinNationwide(user.sub, profile);

    const communities = queryAll(
      `SELECT * FROM communities ORDER BY
         CASE type WHEN 'nationwide' THEN 1 WHEN 'city' THEN 2 ELSE 3 END,
         name ASC`
    );

    const visible = communities
      .filter(community => isEligible(community, profile))
      .map(community => communityView(community, profile));

    jsonResponse(res, 200, { communities: visible });
  } catch (err) {
    console.error('[COMMUNITIES] List communities error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/communities/:id
 * Returns community details for an eligible user.
 */
export function handleGetCommunity(req, res, user, params) {
  try {
    const profile = getProfileFor(user.sub);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }

    if (!isEligible(community, profile)) {
      return errorResponse(res, 403, 'You are not eligible for this community');
    }

    jsonResponse(res, 200, communityView(community, profile));
  } catch (err) {
    console.error('[COMMUNITIES] Get community error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/communities/:id/join
 * Joins a community. Eligibility is validated server-side from the stored
 * profile; client-supplied location fields are ignored.
 */
export function handleJoinCommunity(req, res, user, params) {
  try {
    const profile = getProfileFor(user.sub);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }

    if (!isEligible(community, profile)) {
      return errorResponse(res, 403, 'You are not eligible to join this community');
    }

    if (community.type === 'nationwide') {
      autoJoinNationwide(user.sub, profile);
      return jsonResponse(res, 200, {
        community_id: community.id,
        joined: true,
        membership: 'member',
        member_count: getMemberCount(community.id),
      });
    }

    execute(
      `INSERT OR IGNORE INTO community_members (id, community_id, user_id, joined_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [generateId(), community.id, user.sub]
    );

    jsonResponse(res, 200, {
      community_id: community.id,
      joined: true,
      membership: 'member',
      member_count: getMemberCount(community.id),
    });
  } catch (err) {
    console.error('[COMMUNITIES] Join community error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/communities/:id/leave
 * Removes membership. The nationwide community uses automatic membership and
 * cannot be left.
 */
export function handleLeaveCommunity(req, res, user, params) {
  try {
    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }

    if (community.type === 'nationwide') {
      return errorResponse(res, 400, 'The nationwide community uses automatic membership and cannot be left');
    }

    const result = execute(
      'DELETE FROM community_members WHERE community_id = ? AND user_id = ?',
      [community.id, user.sub]
    );

    jsonResponse(res, 200, {
      community_id: community.id,
      left: result.changes > 0,
      membership: result.changes > 0 ? 'non-member' : getMembership(community.id, user.sub),
      member_count: getMemberCount(community.id),
    });
  } catch (err) {
    console.error('[COMMUNITIES] Leave community error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/communities/:id/members
 * Returns community members using the safe public profile representation.
 * Real name is only returned when the member's Real Name privacy setting is
 * enabled (real_name_visible = 1); Display Name is always the public identity.
 */
export function handleGetCommunityMembers(req, res, user, params) {
  try {
    const profile = getProfileFor(user.sub);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }

    if (!isEligible(community, profile)) {
      return errorResponse(res, 403, 'You are not eligible for this community');
    }

    const { params: queryParams } = parseQuery(req.url);
    const limit = Math.min(parseInt(queryParams.limit || '50', 10), 100);
    const offset = parseInt(queryParams.offset || '0', 10);

    const members = queryAll(
      `SELECT
         u.username,
         pr.display_name,
         pr.profile_photo_url,
         CASE WHEN pr.real_name_visible = 1 THEN pr.real_name ELSE NULL END AS real_name,
         cm.joined_at
       FROM community_members cm
       JOIN users u ON cm.user_id = u.id
       LEFT JOIN profiles pr ON cm.user_id = pr.user_id
       WHERE cm.community_id = ?
       ORDER BY cm.joined_at ASC
       LIMIT ? OFFSET ?`,
      [params.id, limit, offset]
    );

    const totalCount = queryOne(
      'SELECT COUNT(*) AS count FROM community_members WHERE community_id = ?',
      [params.id]
    );
    const hasMore = offset + limit < totalCount.count;

    jsonResponse(res, 200, {
      members,
      limit,
      offset,
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[COMMUNITIES] Get community members error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/communities/:id/posts
 * Community-scoped feed. Uses the existing posts table, reactions and
 * comments; the response shape matches GET /api/feed so it can be rendered
 * with the existing feed UI. Only eligible members can view the feed.
 */
export function handleGetCommunityPosts(req, res, user, params) {
  try {
    const profile = getProfileFor(user.sub);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }

    if (!isEligible(community, profile)) {
      return errorResponse(res, 403, 'You are not eligible for this community');
    }

    const { params: queryParams } = parseQuery(req.url);
    const limit = Math.min(parseInt(queryParams.limit || '20', 10), 100);
    const offset = parseInt(queryParams.offset || '0', 10);

    const posts = queryAll(
      `SELECT
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
       WHERE p.community_id = ?
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [user.sub, user.sub, params.id, limit, offset]
    );

    const totalCount = queryOne(
      'SELECT COUNT(*) AS count FROM posts WHERE community_id = ?',
      [params.id]
    );
    const hasMore = offset + limit < totalCount.count;

    jsonResponse(res, 200, {
      posts: posts.map(post => ({
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
      })),
      limit,
      offset,
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[COMMUNITIES] Get community posts error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/profile/:username/communities
 * Lists the communities a profile owner has actually joined (active
 * community_members rows). Membership is never inferred from the owner's
 * location — only real memberships are returned.
 *
 * This endpoint is public, matching GET /api/profile/:username, and exposes
 * only the public community fields required to render the list. Eligibility,
 * moderation data and internal membership ids are never included.
 */
export function handleGetProfileCommunities(req, res, params) {
  try {
    const user = queryOne('SELECT id FROM users WHERE username = ?', [params.username]);
    if (!user) {
      return errorResponse(res, 404, 'Profile not found');
    }

    const communities = queryAll(
      `SELECT c.id, c.name, c.slug, c.type
         FROM community_members cm
         JOIN communities c ON cm.community_id = c.id
        WHERE cm.user_id = ?
        ORDER BY
          CASE c.type WHEN 'nationwide' THEN 1 WHEN 'city' THEN 2 ELSE 3 END,
          c.name ASC`,
      [user.id]
    );

    jsonResponse(res, 200, { communities });
  } catch (err) {
    console.error('[COMMUNITIES] Get profile communities error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Startup seed: Nationwide communities plus City/Barangay communities derived
 * from existing profile locations. All idempotent.
 */
export function initCommunities() {
  seedNationwideCommunities();
  seedCommunitiesFromProfiles();
}