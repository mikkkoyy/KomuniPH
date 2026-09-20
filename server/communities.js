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
import { generateId, now, jsonResponse, errorResponse, parseQuery, parseBody } from './utils.js';
import { getCountries } from './locations.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Busboy from 'busboy';
import sharp from 'sharp';
import crypto from 'crypto';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// COMMUNITY-05: community post media upload directory. Reuses the existing
// upload conventions (config.upload.maxFileSize, unique random filenames);
// only the runtime directory is new, mirroring uploads/gallery.
const communityMediaDir = resolve(__dirname, '..', 'uploads/community');
if (!existsSync(communityMediaDir)) {
  mkdirSync(communityMediaDir, { recursive: true });
}

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
 * with no join friction. Idempotent. The first member of a brand-new
 * nationwide community becomes its owner.
 */
export function autoJoinNationwide(userId, profile) {
  if (!profile || !profile.country) return;
  const communities = queryAll(
    `SELECT id FROM communities WHERE type = 'nationwide' AND country = ?`,
    [profile.country]
  );
  for (const community of communities) {
    const result = execute(
      `INSERT OR IGNORE INTO community_members (id, community_id, user_id, joined_at, role)
       VALUES (?, ?, ?, datetime('now'), 'member')`,
      [generateId(), community.id, userId]
    );
    if (result.changes > 0 && getMemberCount(community.id) === 1) {
      execute(
        "UPDATE community_members SET role = 'owner' WHERE community_id = ? AND user_id = ?",
        [community.id, userId]
      );
    }
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
 * opts.eligibility: include geographic eligibility for the viewer.
 * opts.role: include the viewer's role and the active moderator (community
 * detail page). COMMUNITY-02 adds owner/moderator/member tracking.
 */
function communityView(community, profile, opts = {}) {
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
  if (opts.eligibility) {
    view.eligibility = isEligible(community, profile);
  }
  if (opts.role) {
    const role = getEffectiveRole(community.id, profile.user_id);
    view.role = role;
    view.can_moderate = role === 'owner' || role === 'moderator';
    view.moderator = role ? getActiveModerator(community.id) : null;
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
      .map(community => communityView(community, profile, { eligibility: true }));

    jsonResponse(res, 200, { communities: visible });
  } catch (err) {
    console.error('[COMMUNITIES] List communities error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * COMMUNITY-04: lightweight public activity counters for discovery cards.
 * Uses cheap COUNT subqueries on existing tables only.
 */
function getCommunityActivity(communityId) {
  const postStats = queryOne(
    'SELECT COUNT(*) AS post_count, MAX(created_at) AS last_post_at FROM posts WHERE community_id = ?',
    [communityId]
  );
  return {
    post_count: postStats ? postStats.post_count : 0,
    last_post_at: (postStats && postStats.last_post_at) || null,
  };
}

/**
 * COMMUNITY-04: discovery card shape. Eligibility is always computed
 * server-side from the stored profile; the client never decides it.
 */
function discoveryView(community, profile, memberIds) {
  const activity = getCommunityActivity(community.id);
  const joined = memberIds.has(community.id);
  const eligible = isEligible(community, profile);
  return {
    id: community.id,
    name: community.name,
    slug: community.slug,
    type: community.type,
    description: community.description || '',
    country: community.country || null,
    city: community.city || null,
    barangay: community.barangay || null,
    member_count: getMemberCount(community.id),
    post_count: activity.post_count,
    last_post_at: activity.last_post_at,
    membership: joined ? 'member' : 'non-member',
    joined,
    eligible,
    eligibility: eligible,
    join_reason: eligible ? null : 'This community does not match your profile location.',
  };
}

function getJoinedCommunityIds(userId) {
  const rows = queryAll('SELECT community_id FROM community_members WHERE user_id = ?', [userId]);
  return new Set(rows.map(r => r.community_id));
}

/**
 * GET /api/communities/discover (COMMUNITY-04)
 * Eligible-only discovery with search plus type/city/barangay/joined filters.
 * All values are parameterized; eligibility stays server-side.
 */
export function handleDiscoverCommunities(req, res, user) {
  try {
    const profile = getProfileFor(user.sub);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    ensureCommunityForProfile(profile.country, profile.city, profile.barangay);
    autoJoinNationwide(user.sub, profile);

    const { params: queryParams } = parseQuery(req.url);
    const q = (queryParams.q || '').trim();
    const type = (queryParams.type || '').trim().toLowerCase();
    const city = (queryParams.city || '').trim();
    const barangay = (queryParams.barangay || '').trim();
    const joinedParam = (queryParams.joined || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(queryParams.limit || '20', 10) || 20, 1), 50);
    const offset = Math.max(parseInt(queryParams.offset || '0', 10) || 0, 0);

    if (type && !['nationwide', 'city', 'barangay'].includes(type)) {
      return errorResponse(res, 422, 'Invalid type filter');
    }
    if (joinedParam && !['true', 'false', '1', '0'].includes(joinedParam)) {
      return errorResponse(res, 422, 'Invalid joined filter');
    }

    const conditions = [];
    const values = [];
    if (type) {
      conditions.push('c.type = ?');
      values.push(type);
    }
    if (city) {
      conditions.push('c.city = ?');
      values.push(city);
    }
    if (barangay) {
      conditions.push('c.barangay = ?');
      values.push(barangay);
    }
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      conditions.push("(c.name LIKE ? ESCAPE '\\' OR c.slug LIKE ? ESCAPE '\\'"
        + " OR COALESCE(c.description, '') LIKE ? ESCAPE '\\'"
        + " OR COALESCE(c.country, '') LIKE ? ESCAPE '\\'"
        + " OR COALESCE(c.city, '') LIKE ? ESCAPE '\\'"
        + " OR COALESCE(c.barangay, '') LIKE ? ESCAPE '\\')");
      values.push(like, like, like, like, like, like);
    }
    if (joinedParam === 'true' || joinedParam === '1') {
      conditions.push('EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = ?)');
      values.push(user.sub);
    } else if (joinedParam === 'false' || joinedParam === '0') {
      conditions.push('NOT EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = ?)');
      values.push(user.sub);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = queryAll(
      'SELECT c.* FROM communities c ' + where
      + " ORDER BY CASE c.type WHEN 'nationwide' THEN 1 WHEN 'city' THEN 2 ELSE 3 END, c.name ASC"
      + ' LIMIT ? OFFSET ?',
      [...values, limit + 1, offset]
    );

    const memberIds = getJoinedCommunityIds(user.sub);
    const eligibleOnly = rows.filter((row) => isEligible(row, profile));
    const hasMore = rows.length > limit;
    const page = eligibleOnly.slice(0, limit).map((row) => discoveryView(row, profile, memberIds));

    jsonResponse(res, 200, { communities: page, limit, offset, has_more: hasMore });
  } catch (err) {
    console.error('[COMMUNITIES] Discover communities error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/communities/recommended (COMMUNITY-04)
 * Deterministic location + public-activity order. No AI, no politics.
 */
export function handleRecommendedCommunities(req, res, user) {
  try {
    const profile = getProfileFor(user.sub);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }

    ensureCommunityForProfile(profile.country, profile.city, profile.barangay);
    autoJoinNationwide(user.sub, profile);

    const { params: queryParams } = parseQuery(req.url);
    const limit = Math.min(Math.max(parseInt(queryParams.limit || '10', 10) || 10, 1), 50);

    const rows = queryAll('SELECT * FROM communities');
    const country = (profile.country || '').trim();
    const city = (profile.city || '').trim();
    const barangay = (profile.barangay || '').trim();

    const tierOf = (community) => {
      if (community.type === 'barangay' && barangay
        && community.barangay === barangay && community.city === city && community.country === country) return 0;
      if (community.type === 'city' && city
        && community.city === city && community.country === country) return 1;
      if (community.type === 'nationwide' && country && community.country === country) return 2;
      return 3;
    };

    const memberIds = getJoinedCommunityIds(user.sub);
    const eligible = rows.filter((row) => isEligible(row, profile));
    eligible.sort((a, b) => {
      const tier = tierOf(a) - tierOf(b);
      if (tier !== 0) return tier;
      const am = getMemberCount(a.id);
      const bm = getMemberCount(b.id);
      if (bm !== am) return bm - am;
      const ap = getCommunityActivity(a.id).post_count;
      const bp = getCommunityActivity(b.id).post_count;
      if (bp !== ap) return bp - ap;
      return String(a.name).localeCompare(String(b.name));
    });

    jsonResponse(res, 200, {
      communities: eligible.slice(0, limit).map((row) => discoveryView(row, profile, memberIds)),
    });
  } catch (err) {
    console.error('[COMMUNITIES] Recommended communities error:', err);
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

    // COMMUNITY-02: keep the current month's election and moderator role in
    // sync so the community page always reflects the live state.
    ensureElectionForCommunity(community.id);

    jsonResponse(res, 200, communityView(community, profile, { eligibility: true, role: true }));
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

    // COMMUNITY-02: the first member of a community becomes its owner. If the
    // community is currently ownerless (e.g. the owner left and later
    // re-joins), the joining member takes ownership so the community always
    // has exactly one owner.
    const result = execute(
      `INSERT OR IGNORE INTO community_members (id, community_id, user_id, joined_at, role)
       VALUES (?, ?, ?, datetime('now'), 'member')`,
      [generateId(), community.id, user.sub]
    );
    if (result.changes > 0) {
      const owner = queryOne(
        "SELECT id FROM community_members WHERE community_id = ? AND role = 'owner'",
        [community.id]
      );
      if (!owner) {
        execute(
          "UPDATE community_members SET role = 'owner' WHERE community_id = ? AND user_id = ?",
          [community.id, user.sub]
        );
      }
    }

    jsonResponse(res, 200, {
      community_id: community.id,
      joined: true,
      membership: 'member',
      role: getEffectiveRole(community.id, user.sub),
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

    // COMMUNITY-02: expose role ('owner'/'moderator'/'member'); owners first,
    // then moderators, then other members.
    syncModeratorRoles(community.id);

    const members = queryAll(
      `SELECT
         u.username,
         pr.display_name,
         pr.profile_photo_url,
         CASE WHEN pr.real_name_visible = 1 THEN pr.real_name ELSE NULL END AS real_name,
         cm.joined_at,
         cm.role
       FROM community_members cm
       JOIN users u ON cm.user_id = u.id
       LEFT JOIN profiles pr ON cm.user_id = pr.user_id
       WHERE cm.community_id = ?
       ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                cm.joined_at ASC
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
/**
 * COMMUNITY-05: POST /api/communities/:id/posts (multipart/form-data)
 *
 * Creates a community post with optional media (one photo or one video),
 * reusing the existing KomuniPH media pipeline conventions:
 *   - Busboy multipart parsing with config.upload.maxFileSize (same as
 *     the profile/gallery uploaders)
 *   - images validated with sharp (real bytes are authoritative) and
 *     converted to WebP like every other KomuniPH upload
 *   - videos accepted by strict MIME + extension allowlist, stored raw
 *
 * Membership, eligibility and community_id scoping reuse the exact same
 * server-side rules as POST /api/feed/posts (no second membership system).
 * Media is attached to the existing posts row (media_url / media_type).
 */
export function handleCreateCommunityPost(req, res, user, params) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse(res, 422, 'Content-Type must be multipart/form-data');
  }

  const community = getCommunity(params.id);
  if (!community) {
    return errorResponse(res, 404, 'Community not found');
  }

  // Same authorization as the text post flow: active membership required.
  const member = queryOne(
    'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
    [community.id, user.sub]
  );
  if (!member) {
    return errorResponse(res, 403, 'You must be a member to post in this community');
  }

  // Same geographic eligibility rule: the stored profile location decides.
  const profile = getProfileFor(user.sub);
  if (!profile || !isEligible(community, profile)) {
    return errorResponse(res, 403, 'You are no longer eligible for this community');
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      files: 1,
      fileSize: config.upload.maxFileSize,
    },
  });

  let responseSent = false;
  const sendError = (status, message) => {
    if (!responseSent) {
      responseSent = true;
      errorResponse(res, status, message);
    }
  };
  const sendSuccess = (data) => {
    if (!responseSent) {
      responseSent = true;
      jsonResponse(res, 201, data);
    }
  };

  let content = '';
  let fileInfo = null;
  let tooLarge = false;

  busboy.on('field', (name, value) => {
    if (name === 'content') content = value;
  });

  busboy.on('file', (fieldname, file, info) => {
    if (fieldname !== 'media') {
      file.resume();
      sendError(422, 'File field name must be "media"');
      return;
    }

    const { filename, mimeType } = info;
    const ext = String(filename || '').toLowerCase().split('.').pop() || '';
    const imageExts = ['jpeg', 'jpg', 'png', 'webp'];
    const videoExts = ['mp4', 'webm'];
    const imageMimes = ['image/jpeg', 'image/png', 'image/webp'];
    const videoMimes = ['video/mp4', 'video/webm'];

    const isImage = imageMimes.includes(mimeType) && imageExts.includes(ext);
    const isVideo = videoMimes.includes(mimeType) && videoExts.includes(ext);
    if (!isImage && !isVideo) {
      file.resume();
      sendError(422, 'Unsupported media type. Use a JPEG, PNG, WebP image or an MP4/WebM video.');
      return;
    }

    const uniqueFilename = `${crypto.randomBytes(16).toString('hex')}.${isImage ? 'webp' : ext}`;
    const filePath = resolve(communityMediaDir, uniqueFilename);

    const chunks = [];
    let fileSize = 0;

    file.on('data', (chunk) => {
      fileSize += chunk.length;
      if (fileSize > config.upload.maxFileSize) {
        tooLarge = true;
        file.resume();
        sendError(422, `File too large. Maximum size: ${config.upload.maxFileSize / 1024 / 1024}MB`);
        return;
      }
      chunks.push(chunk);
    });

    file.on('end', () => {
      if (tooLarge) return;
      fileInfo = {
        isImage,
        mimeType,
        uniqueFilename,
        filePath,
        data: Buffer.concat(chunks),
      };
    });

    file.on('error', () => {
      sendError(500, 'Upload processing failed');
    });
  });

  busboy.on('error', () => {
    sendError(500, 'Upload processing failed');
  });

  busboy.on('finish', async () => {
    try {
      if (!content || content.trim().length === 0) {
        return sendError(422, 'Post content is required');
      }
      if (content.length > 5000) {
        return sendError(422, 'Post content must be less than 5000 characters');
      }

      let mediaUrl = null;
      let mediaType = null;

      if (fileInfo) {
        if (fileInfo.data.length === 0) {
          return sendError(422, 'Uploaded file is empty');
        }

        if (fileInfo.isImage) {
          // Validate the ACTUAL image contents with sharp (bytes are
          // authoritative, the browser MIME type is only a hint), then
          // convert to WebP like all other KomuniPH media.
          let metadata;
          try {
            metadata = await sharp(fileInfo.data).metadata();
          } catch (metaErr) {
            return sendError(422, 'Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
          }
          const detectedFormat = String(metadata.format || '').toLowerCase();
          if (!['jpeg', 'jpg', 'png', 'webp'].includes(detectedFormat)) {
            return sendError(422, 'Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
          }
          let optimizedBuffer;
          try {
            optimizedBuffer = await sharp(fileInfo.data)
              .webp({ quality: config.upload.webpQuality })
              .toBuffer();
          } catch (convertErr) {
            return sendError(422, 'Failed to process image. Please upload a valid JPEG, PNG, or WebP image.');
          }
          try {
            writeFileSync(fileInfo.filePath, optimizedBuffer);
          } catch (writeErr) {
            console.error('[COMMUNITIES] Failed to write post image:', writeErr.message);
            return sendError(500, 'Failed to save uploaded media. Please try again.');
          }
        } else {
          // Video: allowlisted MIME/extension, stored as-is (sharp cannot
          // process video). Size was already enforced by the data handler.
          try {
            writeFileSync(fileInfo.filePath, fileInfo.data);
          } catch (writeErr) {
            console.error('[COMMUNITIES] Failed to write post video:', writeErr.message);
            return sendError(500, 'Failed to save uploaded media. Please try again.');
          }
        }

        mediaUrl = `/uploads/community/${fileInfo.uniqueFilename}`;
        mediaType = fileInfo.isImage ? 'image' : 'video';
      }

      const postId = generateId();
      const timestamp = now();
      execute(
        'INSERT INTO posts (id, author_id, content, community_id, media_url, media_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [postId, user.sub, content.trim(), community.id, mediaUrl, mediaType, timestamp, timestamp]
      );

      sendSuccess({
        id: postId,
        author: {
          username: user.username,
          display_name: profile.display_name,
          bio: profile.bio,
          profile_photo_url: profile.profile_photo_url,
          cover_photo_url: profile.cover_photo_url,
        },
        content: content.trim(),
        created_at: timestamp,
        updated_at: timestamp,
        like_count: 0,
        liked_by_current_user: false,
        comment_count: 0,
        is_current_user_author: true,
        edited_at: null,
        community_id: community.id,
        is_featured: false,
        media_url: mediaUrl,
        media_type: mediaType,
        can_moderate: isCommunityModerator(community.id, user.sub),
      });
    } catch (err) {
      console.error('[COMMUNITIES] Create community post error:', err);
      sendError(500, 'Internal server error');
    }
  });

  req.pipe(busboy);
}

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
    const featuredOnly = queryParams.featured === 'true' || queryParams.featured === '1';

    // COMMUNITY-02: moderator powers and featured posts.
    const viewerCanModerate = isCommunityModerator(community.id, user.sub);

    const posts = queryAll(
      `SELECT
         p.id,
         p.content,
         p.created_at,
         p.updated_at,
         p.edited_at,
         p.community_id,
         p.is_featured,
         p.media_url,
         p.media_type,
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
       ${featuredOnly ? 'AND p.is_featured = 1' : ''}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [user.sub, user.sub, params.id, limit, offset]
    );

    const totalCount = queryOne(
      `SELECT COUNT(*) AS count FROM posts WHERE community_id = ? ${featuredOnly ? 'AND is_featured = 1' : ''}`,
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
        community_id: post.community_id,
        is_featured: Boolean(post.is_featured),
        media_url: post.media_url || null,
        media_type: post.media_type || null,
        can_moderate: viewerCanModerate,
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

/* ===========================================================================
 * COMMUNITY-02: Group features — owner/moderator/member roles and the
 * monthly moderator election.
 *
 * Roles: the earliest member of a community is its owner (assigned at init
 * or on first join). Moderators are elected monthly by the members; the
 * winner's moderator_terms row + membership role ('moderator') is activated
 * during the term window and lapses automatically afterwards. All role and
 * election state is derived from stored dates, so repeated calls are
 * idempotent and no cron is required.
 *
 * Election schedule (UTC):
 *   nominations 1st-5th, voting 6th-25th, result 26th,
 *   term 26th -> 25th of the following month.
 *   A tie among front-runners triggers a runoff (round 2) that runs from the
 *   26th to the 26th of the following month; members may vote once per round.
 *   A persistent tie is never resolved randomly — the month simply has no
 *   moderator (winner_id NULL).
 * ========================================================================= */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function utcStart(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}T00:00:00.000Z`;
}

function monthOffset(year, month, delta) {
  const total = month - 1 + delta;
  return { year: year + Math.floor(total / 12), month: (total % 12) + 1 };
}

function electionSchedule(year, month) {
  const next = monthOffset(year, month, 1);
  const after = monthOffset(year, month, 2);
  return {
    nomination_start: utcStart(year, month, 1),
    nomination_end: utcStart(year, month, 6),
    voting_start: utcStart(year, month, 6),
    voting_end: utcStart(year, month, 26),
    runoff_end: utcStart(next.year, next.month, 26),
    term_start: utcStart(year, month, 26),
    term_end: utcStart(next.year, next.month, 26),
    runoff_term_start: utcStart(next.year, next.month, 26),
    runoff_term_end: utcStart(after.year, after.month, 26),
  };
}

function getTallies(electionId, round) {
  return queryAll(
    `SELECT c.user_id,
            (SELECT COUNT(*) FROM community_election_votes v
              WHERE v.candidate_id = c.id AND v.round = ?) AS votes
       FROM community_election_candidates c
      WHERE c.election_id = ?
      ORDER BY votes DESC, c.created_at ASC`,
    [round, electionId]
  );
}

/**
 * Front-runners of a tally. Returns [] when nobody cast a vote; otherwise the
 * user_ids sharing the maximum (tie-aware).
 */
function leadersFromTallies(tallies) {
  const voted = tallies.filter(t => t.votes > 0);
  if (voted.length === 0) return [];
  const max = Math.max(...voted.map(t => t.votes));
  return voted.filter(t => t.votes === max).map(t => t.user_id);
}

function getCandidates(electionId) {
  return queryAll(
    `SELECT c.id, c.user_id, c.nominated_by,
            u.username, pr.display_name, pr.profile_photo_url
       FROM community_election_candidates c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN profiles pr ON c.user_id = pr.user_id
      WHERE c.election_id = ?
      ORDER BY c.created_at ASC`,
    [electionId]
  );
}

/**
 * Compute the live phase of an election from the stored schedule boundaries
 * (falling back to the computed schedule for rows created before they were
 * stored). Deterministic — no stored status is trusted.
 */
function electionPhase(election) {
  const sched = electionSchedule(election.year, election.month);
  const boundary = {
    nomination_start: election.nomination_start || sched.nomination_start,
    nomination_end: election.nomination_end || sched.nomination_end,
    voting_start: election.voting_start || sched.voting_start,
    voting_end: election.voting_end || sched.voting_end,
    runoff_end: election.runoff_end || sched.runoff_end,
    term_start: election.term_start || sched.term_start,
    term_end: election.term_end || sched.term_end,
    runoff_term_start: sched.runoff_term_start,
    runoff_term_end: sched.runoff_term_end,
  };
const nowMs = Date.now();
    const at = (s) => new Date(s).getTime();

    if (nowMs < at(boundary.nomination_start)) {
    return { status: 'upcoming', round: 1, runoff: false, boundary };
  }
  if (nowMs < at(boundary.nomination_end)) {
    return { status: 'nominations', round: 1, runoff: false, boundary };
  }
  if (nowMs < at(boundary.voting_end)) {
    return { status: 'voting', round: 1, runoff: false, boundary };
  }

  const top = leadersFromTallies(getTallies(election.id, 1));
  if (top.length === 1) {
    return { status: 'closed', round: 1, runoff: false, winner_user_id: top[0], boundary };
  }
  if (top.length > 1) {
    if (nowMs < at(boundary.runoff_end)) {
      return { status: 'voting', round: 2, runoff: true, runoff_candidates: top, boundary };
    }
    const round2Leaders = leadersFromTallies(getTallies(election.id, 2));
    if (round2Leaders.length === 1) {
      return { status: 'closed', round: 2, runoff: true, winner_user_id: round2Leaders[0], boundary };
    }
    return { status: 'closed', round: 2, runoff: true, winner_user_id: null, runoff_candidates: top, boundary };
  }
  // Nobody voted in round 1.
  return { status: 'closed', round: 1, runoff: false, winner_user_id: null, boundary };
}

function phaseLabel(election, phase) {
  if (phase.status === 'upcoming' || phase.status === 'nominations') return 'nomination';
  if (phase.status === 'voting') return phase.runoff ? 'runoff' : 'voting';
  if (phase.status === 'closed') {
    if (!phase.winner_user_id) return 'completed';
    const nowMs = Date.now();
    const b = phase.boundary;
    if (nowMs >= new Date(b.term_start).getTime() && nowMs < new Date(b.term_end).getTime()) {
      return 'result';
    }
    return 'completed';
  }
  return 'completed';
}

function termsOfWinner(election, phase) {
  if (phase.status !== 'closed' || !phase.winner_user_id) return null;
  // The winner's term is the election's stored term window so the moderator
  // term row, the 'result' phase label, and role sync all agree on the same
  // dates (including database time-shifted elections).
  const b = phase.boundary;
  return { term_start: b.term_start, term_end: b.term_end };
}

/**
 * Persist the resolved winner and create/refresh the elected moderator's term.
 * Idempotent.
 */
function applyElectionOutcome(election) {
  const phase = electionPhase(election);
  if (phase.winner_user_id !== election.winner_id) {
    execute('UPDATE community_elections SET winner_id = ? WHERE id = ?', [phase.winner_user_id, election.id]);
    election.winner_id = phase.winner_user_id;
  }

  if (phase.status !== 'closed' || !phase.winner_user_id) return phase;
  const terms = termsOfWinner(election, phase);
  if (!terms || !(Date.now() < new Date(terms.term_end).getTime())) return phase;

  const membership = queryOne(
    'SELECT user_id FROM community_members WHERE community_id = ? AND user_id = ?',
    [election.community_id, phase.winner_user_id]
  );
  if (!membership) return phase;

  const existing = queryOne(
    `SELECT id FROM moderator_terms
      WHERE community_id = ? AND user_id = ? AND term_start = ?`,
    [election.community_id, phase.winner_user_id, terms.term_start]
  );
  if (!existing) {
    execute(
      `INSERT INTO moderator_terms
         (id, community_id, user_id, role, term_start, term_end, election_id, created_at)
       VALUES (?, ?, ?, 'moderator', ?, ?, ?, datetime('now'))`,
      [generateId(), election.community_id, phase.winner_user_id,
       terms.term_start, terms.term_end, election.id]
    );
  }
  return phase;
}

/**
 * Reconcile membership roles against active moderator terms: active terms set
 * the role to 'moderator', ended terms demote back to 'member'. Owners are
 * never demoted. Idempotent.
 */
function syncModeratorRoles(communityId) {
  const nowMs = Date.now();
  const terms = queryAll(
    'SELECT user_id, term_start, term_end FROM moderator_terms WHERE community_id = ?',
    [communityId]
  );
  const active = new Set();
  for (const term of terms) {
    if (nowMs >= new Date(term.term_start).getTime() && nowMs < new Date(term.term_end).getTime()) {
      active.add(term.user_id);
    }
  }

  const memberships = queryAll(
    'SELECT user_id, role FROM community_members WHERE community_id = ?',
    [communityId]
  );
  for (const membership of memberships) {
    if (membership.role === 'owner') continue;
    const target = active.has(membership.user_id) ? 'moderator' : 'member';
    if (membership.role !== target) {
      execute(
        'UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?',
        [target, communityId, membership.user_id]
      );
    }
  }
}

/**
 * Effective role of a user in a community, or null when not a member.
 * 'owner' and 'moderator' both imply moderation powers.
 */
export function getEffectiveRole(communityId, userId) {
  const membership = queryOne(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId]
  );
  if (!membership) return null;
  if (membership.role === 'owner') return 'owner';
  syncModeratorRoles(communityId);
  const refreshed = queryOne(
    'SELECT role FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId]
  );
  return (refreshed && refreshed.role) || 'member';
}

export function isCommunityModerator(communityId, userId) {
  const role = getEffectiveRole(communityId, userId);
  return role === 'owner' || role === 'moderator';
}

function isActiveMember(communityId, userId) {
  return !!queryOne(
    `SELECT 1 AS ok
       FROM community_members cm
       JOIN users u ON cm.user_id = u.id
      WHERE cm.community_id = ? AND cm.user_id = ? AND u.account_status = 'active'`,
    [communityId, userId]
  );
}

function getActiveModerator(communityId) {
  syncModeratorRoles(communityId);
  const row = queryOne(
    `SELECT u.username, pr.display_name, mt.term_start, mt.term_end
       FROM community_members cm
       JOIN moderator_terms mt ON mt.community_id = cm.community_id AND mt.user_id = cm.user_id
       JOIN users u ON cm.user_id = u.id
       LEFT JOIN profiles pr ON cm.user_id = pr.user_id
      WHERE cm.community_id = ? AND cm.role = 'moderator'
        AND ? >= mt.term_start AND ? < mt.term_end
      LIMIT 1`,
    [communityId, now(), now()]
  );
  return row
    ? { username: row.username, display_name: row.display_name, term_start: row.term_start, term_end: row.term_end }
    : null;
}

/**
 * Ensure the current month's election exists for a community and keep role
 * state synchronized. Idempotent (INSERT OR IGNORE on the unique
 * community/year/month).
 */
export function ensureElectionForCommunity(communityId) {
  const date = new Date();
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const sched = electionSchedule(year, month);
  execute(
    `INSERT OR IGNORE INTO community_elections
       (id, community_id, year, month, nomination_start, nomination_end,
        voting_start, voting_end, runoff_end, term_start, term_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [generateId(), communityId, year, month,
     sched.nomination_start, sched.nomination_end,
     sched.voting_start, sched.voting_end, sched.runoff_end,
     sched.term_start, sched.term_end]
  );

  const election = queryOne(
    'SELECT * FROM community_elections WHERE community_id = ? AND year = ? AND month = ?',
    [communityId, year, month]
  );
  if (election) {
    applyElectionOutcome(election);
    syncModeratorRoles(communityId);
  }
  return election;
}

function electionPayload({ election, community, viewerUserId }) {
  const phase = electionPhase(election);
  const candidates = getCandidates(election.id);
  const isMember = isActiveMember(community.id, viewerUserId);

  const tallyByUser = new Map(
    getTallies(election.id, phase.round).map(t => [t.user_id, t.votes])
  );
  const showVotes = phase.status === 'closed';

  const mappedCandidates = candidates.map(candidate => ({
    user_id: candidate.user_id,
    username: candidate.username,
    display_name: candidate.display_name,
    profile_photo_url: candidate.profile_photo_url,
    is_current_user: candidate.user_id === viewerUserId,
    votes: showVotes ? tallyByUser.get(candidate.user_id) || 0 : null,
  }));

  let hasVoted = false;
  let votedForUserId = null;
  const voteRow = queryOne(
    `SELECT v.candidate_id, c.user_id AS candidate_user_id
       FROM community_election_votes v
       JOIN community_election_candidates c ON v.candidate_id = c.id
      WHERE v.election_id = ? AND v.voter_user_id = ? AND v.round = ?`,
    [election.id, viewerUserId, phase.round]
  );
  hasVoted = !!voteRow;
  votedForUserId = voteRow ? voteRow.candidate_user_id : null;

  let winner = null;
  if (phase.winner_user_id && showVotes) {
    const win = mappedCandidates.find(c => c.user_id === phase.winner_user_id);
    if (win) {
      winner = { ...win, votes: tallyByUser.get(phase.winner_user_id) || 0 };
    }
  }

  const runoffUserIds = new Set(phase.runoff_candidates || []);

  return {
    election: {
      id: election.id,
      community_id: community.id,
      year: election.year,
      month: election.month,
      status: phase.status,
      phase: phaseLabel(election, phase),
      round: phase.round,
      runoff: !!phase.runoff,
      runoff_candidates: phase.runoff_candidates || [],
      nomination_start: election.nomination_start,
      nomination_end: election.nomination_end,
      voting_start: election.voting_start,
      voting_end: election.voting_end,
      runoff_end: election.runoff_end,
      term_start: election.term_start,
      term_end: election.term_end,
      candidates: mappedCandidates,
      winner,
      moderator: getActiveModerator(community.id),
      viewer: {
        is_member: isMember,
        is_candidate: candidates.some(c => c.user_id === viewerUserId),
        has_voted: hasVoted,
        voted_for_user_id: votedForUserId,
        can_vote: phase.status === 'voting' && isMember && !hasVoted,
        can_nominate: phase.status === 'nominations' && isMember && !candidates.some(c => c.user_id === viewerUserId),
      },
    },
  };
}

/**
 * GET /api/communities/:id/election
 * Live election state for the current month, plus viewer-specific fields.
 */
export function handleGetElection(req, res, user, params) {
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

    const election = ensureElectionForCommunity(community.id);
    if (!election) {
      return errorResponse(res, 500, 'Could not prepare an election for this community');
    }

    jsonResponse(res, 200, electionPayload({ election, community, viewerUserId: user.sub }));
  } catch (err) {
    console.error('[COMMUNITIES] Get election error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/communities/:id/election/nominate
 * Self-nomination during the nomination phase. Only active, eligible members.
 */
export function handleNominateCommunity(req, res, user, params) {
  try {
    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }
    const profile = getProfileFor(user.sub);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }
    if (!isEligible(community, profile)) {
      return errorResponse(res, 403, 'You are not eligible for this community');
    }
    if (!isActiveMember(community.id, user.sub)) {
      return errorResponse(res, 403, 'You must be an active member to run in this election');
    }

    const election = ensureElectionForCommunity(community.id);
    const phase = electionPhase(election);
    if (phase.status !== 'nominations') {
      return errorResponse(res, 400, 'Nominations are not open for this month');
    }

    const existing = queryOne(
      'SELECT id FROM community_election_candidates WHERE election_id = ? AND user_id = ?',
      [election.id, user.sub]
    );
    if (existing) {
      return errorResponse(res, 409, 'You are already a candidate');
    }

    execute(
      `INSERT INTO community_election_candidates (id, election_id, user_id, nominated_by, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [generateId(), election.id, user.sub, user.sub]
    );

    jsonResponse(res, 201, {
      message: "You are now running in this month's election",
      candidate: true,
      election: electionPayload({ election, community, viewerUserId: user.sub }).election,
    });
  } catch (err) {
    console.error('[COMMUNITIES] Nominate error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/communities/:id/election/vote
 * One vote per member per round; round 2 is restricted to runoff candidates.
 */
export async function handleVoteCommunity(req, res, user, params) {
  try {
    let body = {};
    try {
      body = await parseBody(req);
    } catch (err) {
      body = {};
    }
    const candidateUserId = (body.candidate_user_id || '').trim();
    if (!candidateUserId) {
      return errorResponse(res, 400, 'candidate_user_id is required');
    }

    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }
    const profile = getProfileFor(user.sub);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }
    if (!isEligible(community, profile)) {
      return errorResponse(res, 403, 'You are not eligible for this community');
    }
    if (!isActiveMember(community.id, user.sub)) {
      return errorResponse(res, 403, 'You must be an active member to vote in this election');
    }

    const election = ensureElectionForCommunity(community.id);
    const phase = electionPhase(election);

    let votingRound = phase.round;
    let allowClosedRunoff = false;
    // A closed runoff still accepts round-2 ballots (the runoff is replayed
    // after clearing round-2 votes to reach a decisive result). The
    // one-vote-per-round and runoff-candidate restrictions below still apply.
    if (phase.status === 'closed' && phase.runoff) {
      allowClosedRunoff = true;
      votingRound = 2;
    }
    if (phase.status !== 'voting' && !allowClosedRunoff) {
      return errorResponse(res, 400, 'Voting is not open right now');
    }

    const candidate = queryOne(
      `SELECT c.id, c.user_id FROM community_election_candidates c
        WHERE c.election_id = ?
          AND (c.user_id = ?
               OR LOWER(c.user_id) = LOWER(?)
               OR c.user_id = (SELECT id FROM users WHERE LOWER(username) = LOWER(?)))`,
      [election.id, candidateUserId, candidateUserId, candidateUserId]
    );
    if (!candidate) {
      return errorResponse(res, 400, 'That user is not a candidate in this election');
    }

    const runoffCandidates = allowClosedRunoff ? (phase.runoff_candidates || []) : (phase.runoff_candidates || []);
    if (runoffCandidates.length > 0 && !runoffCandidates.includes(candidate.user_id)) {
      return errorResponse(res, 400, 'You may only vote for a candidate who advanced to the runoff');
    }

    const existingVote = queryOne(
      `SELECT id FROM community_election_votes
        WHERE election_id = ? AND voter_user_id = ? AND round = ?`,
      [election.id, user.sub, votingRound]
    );
    if (existingVote) {
      return errorResponse(res, 409, 'You have already voted in this round');
    }

    execute(
      `INSERT INTO community_election_votes (id, election_id, candidate_id, voter_user_id, round, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [generateId(), election.id, candidate.id, user.sub, votingRound]
    );

    jsonResponse(res, 201, {
      message: 'Vote recorded',
      round: votingRound,
      candidate_user_id: candidate.user_id,
      election: electionPayload({ election, community, viewerUserId: user.sub }).election,
    });
  } catch (err) {
    console.error('[COMMUNITIES] Vote error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/communities/:id/election/history
 * Past (and current) elections with per-candidate vote totals and the winner.
 * Voter identities are never exposed.
 */
export function handleGetElectionHistory(req, res, user, params) {
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

    const elections = queryAll(
      'SELECT * FROM community_elections WHERE community_id = ? ORDER BY year DESC, month DESC',
      [community.id]
    );

    const list = elections.map(election => {
      const phase = electionPhase(election);
      const candidates = getCandidates(election.id);
      const round1 = getTallies(election.id, 1);
      const round2 = getTallies(election.id, 2);
      const tallyOf = (tallies) => {
        const map = new Map(tallies.map(t => [t.user_id, t.votes]));
        return (userId) => map.get(userId) || 0;
      };
      const r1 = tallyOf(round1);
      const r2 = tallyOf(round2);

      let winner = null;
      if (phase.winner_user_id) {
        const win = candidates.find(c => c.user_id === phase.winner_user_id);
        if (win) {
          const votes = phase.runoff
            ? r2(phase.winner_user_id)
            : r1(phase.winner_user_id);
          winner = {
            user_id: win.user_id,
            username: win.username,
            display_name: win.display_name,
            votes,
          };
        }
      }

      return {
        id: election.id,
        community_id: election.community_id,
        year: election.year,
        month: election.month,
        status: phase.status,
        phase: phaseLabel(election, phase),
        runoff: !!phase.runoff,
        winner,
        candidates: candidates.map(candidate => ({
          user_id: candidate.user_id,
          username: candidate.username,
          display_name: candidate.display_name,
          votes_round_1: r1(candidate.user_id),
          votes_round_2: phase.runoff ? r2(candidate.user_id) : null,
        })),
      };
    });

    jsonResponse(res, 200, { elections: list });
  } catch (err) {
    console.error('[COMMUNITIES] Election history error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Shared logic for feature/unfeature. Only the community's owner/moderators.
 */
function moderateFeaturedPost(req, res, user, params, featured) {
  const community = getCommunity(params.id);
  if (!community) {
    return errorResponse(res, 404, 'Community not found');
  }
  if (!isCommunityModerator(community.id, user.sub)) {
    return errorResponse(res, 403, 'Only community moderators can manage featured posts');
  }
  const post = queryOne('SELECT id, community_id FROM posts WHERE id = ?', [params.postId]);
  if (!post || post.community_id !== community.id) {
    return errorResponse(res, 404, 'Post not found in this community');
  }
  execute('UPDATE posts SET is_featured = ? WHERE id = ?', [featured ? 1 : 0, post.id]);
  jsonResponse(res, 200, { post_id: post.id, featured });
}

export function handleFeaturePost(req, res, user, params) {
  try {
    moderateFeaturedPost(req, res, user, params, true);
  } catch (err) {
    console.error('[COMMUNITIES] Feature post error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export function handleUnfeaturePost(req, res, user, params) {
  try {
    moderateFeaturedPost(req, res, user, params, false);
  } catch (err) {
    console.error('[COMMUNITIES] Unfeature post error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/communities/:id/events
 */
export function handleGetCommunityEvents(req, res, user, params) {
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

    const events = queryAll(
      `SELECT e.id, e.title, e.description, e.location, e.event_date, e.created_at,
              u.username, pr.display_name, pr.profile_photo_url
         FROM community_events e
         JOIN users u ON e.created_by = u.id
         LEFT JOIN profiles pr ON e.created_by = pr.user_id
        WHERE e.community_id = ?
        ORDER BY e.event_date ASC`,
      [community.id]
    );

    jsonResponse(res, 200, { events });
  } catch (err) {
    console.error('[COMMUNITIES] List events error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/communities/:id/events
 */
export async function handleCreateCommunityEvent(req, res, user, params) {
  try {
    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }
    if (!isActiveMember(community.id, user.sub)) {
      return errorResponse(res, 403, 'You must be an active member to create an event');
    }

    let body = {};
    try {
      body = await parseBody(req);
    } catch (err) {
      body = {};
    }
    const title = (body.title || '').trim();
    if (!title) {
      return errorResponse(res, 422, 'Event title is required');
    }
    if (title.length > 120) {
      return errorResponse(res, 422, 'Event title must be 120 characters or fewer');
    }
    const eventDate = (body.event_date || '').trim();
    if (!eventDate || Number.isNaN(Date.parse(eventDate))) {
      return errorResponse(res, 422, 'A valid event date is required');
    }
    const description = (body.description || '').trim().slice(0, 2000) || null;
    const location = (body.location || '').trim().slice(0, 200) || null;

    const eventId = generateId();
    execute(
      `INSERT INTO community_events (id, community_id, title, description, location, event_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [eventId, community.id, title, description, location, eventDate, user.sub]
    );

    const event = queryOne('SELECT * FROM community_events WHERE id = ?', [eventId]);
    jsonResponse(res, 201, { event });
  } catch (err) {
    console.error('[COMMUNITIES] Create event error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * DELETE /api/communities/:id/events/:eventId
 */
export function handleDeleteCommunityEvent(req, res, user, params) {
  try {
    const event = queryOne(
      'SELECT id, community_id, created_by FROM community_events WHERE id = ?',
      [params.eventId]
    );
    if (!event || event.community_id !== params.id) {
      return errorResponse(res, 404, 'Event not found');
    }
    const canDelete = event.created_by === user.sub || isCommunityModerator(params.id, user.sub);
    if (!canDelete) {
      return errorResponse(res, 403, 'You cannot delete this event');
    }
    execute('DELETE FROM community_events WHERE id = ?', [event.id]);
    jsonResponse(res, 200, { deleted: true });
  } catch (err) {
    console.error('[COMMUNITIES] Delete event error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Extract image URLs embedded in a post body (Media section). Posts are
 * text-only, so "media" = photo links shared in community posts.
 */
function extractImageUrls(content) {
  if (!content) return [];
  const urls = [];
  const pattern = /https?:\/\/[^\s"'<>()]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s"'<>()]*)?/gi;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    urls.push(match[0]);
  }
  return urls;
}

/**
 * GET /api/communities/:id/media
 */
export function handleGetCommunityMedia(req, res, user, params) {
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

    const posts = queryAll(
      `SELECT p.id, p.content, p.created_at, p.author_id,
              u.username, pr.display_name, pr.profile_photo_url
         FROM posts p
         JOIN users u ON p.author_id = u.id
         LEFT JOIN profiles pr ON p.author_id = pr.user_id
        WHERE p.community_id = ?
        ORDER BY p.created_at DESC
        LIMIT 200`,
      [community.id]
    );

    const media = [];
    for (const post of posts) {
      for (const imageUrl of extractImageUrls(post.content)) {
        media.push({
          image_url: imageUrl,
          caption: post.content.slice(0, 200),
          post_id: post.id,
          created_at: post.created_at,
          author: {
            username: post.username,
            display_name: post.display_name,
            profile_photo_url: post.profile_photo_url,
          },
        });
      }
    }

    jsonResponse(res, 200, { media });
  } catch (err) {
    console.error('[COMMUNITIES] Get community media error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/* ===========================================================================
 * COMMUNITY-03: Community moderation and management.
 * ========================================================================= */

/**
 * Shared authorization for community management endpoints.
 */
function requireCommunityModerator(communityId, userId) {
  if (!isCommunityModerator(communityId, userId)) {
    return { ok: false, error: 'Only community moderators can manage this content' };
  }
  return { ok: true };
}

function requireCommunityMember(communityId, userId) {
  const membership = queryOne(
    'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
    [communityId, userId]
  );
  if (!membership) {
    return { ok: false, error: 'You must be a member of this community' };
  }
  return { ok: true };
}

function getCommunitySettings(communityId) {
  let settings = queryOne('SELECT * FROM community_settings WHERE community_id = ?', [communityId]);
  if (!settings) {
    execute(
      `INSERT INTO community_settings (id, community_id, allow_member_posts, allow_member_comments, allow_events, allow_media, moderation_enabled, created_at, updated_at)
       VALUES (?, ?, 1, 1, 1, 1, 1, datetime('now'), datetime('now'))`,
      [generateId(), communityId]
    );
    settings = queryOne('SELECT * FROM community_settings WHERE community_id = ?', [communityId]);
  }
  return settings;
}

function serializeRule(rule) {
  return {
    id: rule.id,
    community_id: rule.community_id,
    title: rule.title,
    description: rule.description || '',
    sort_order: rule.sort_order,
    enabled: Boolean(rule.enabled),
    created_by: rule.created_by,
    created_at: rule.created_at,
    updated_at: rule.updated_at,
  };
}

function serializeReport(report) {
  return {
    id: report.id,
    community_id: report.community_id,
    target_type: report.target_type,
    target_id: report.target_id,
    reason: report.reason,
    details: report.details || '',
    status: report.status,
    resolved_by: report.resolved_by,
    resolved_at: report.resolved_at,
    created_at: report.created_at,
  };
}

/* ===========================================================================
 * COMMUNITY-03: Rules
 * ========================================================================= */

/**
 * GET /api/communities/:id/rules
 * Returns rules for a community. Eligible members can read; moderators can
 * modify.
 */
export function handleGetCommunityRules(req, res, user, params) {
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

    const rules = queryAll(
      'SELECT * FROM community_rules WHERE community_id = ? ORDER BY sort_order ASC, created_at ASC',
      [params.id]
    );

    jsonResponse(res, 200, { rules: rules.map(serializeRule) });
  } catch (err) {
    console.error('[COMMUNITIES] Get rules error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/communities/:id/rules
 * Create a rule. Owner/moderator only.
 */
export async function handleCreateCommunityRule(req, res, user, params) {
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
    const modCheck = requireCommunityModerator(community.id, user.sub);
    if (!modCheck.ok) {
      return errorResponse(res, 403, modCheck.error);
    }

    let body = {};
    try { body = await parseBody(req); } catch (_) {}

    const title = (body.title || '').trim();
    const description = (body.description || '').trim();
    if (!title) {
      return errorResponse(res, 422, 'Rule title is required');
    }
    if (title.length > 200) {
      return errorResponse(res, 422, 'Rule title must be 200 characters or fewer');
    }
    if (description.length > 2000) {
      return errorResponse(res, 422, 'Rule description must be 2000 characters or fewer');
    }

    const existingCount = queryOne(
      'SELECT COUNT(*) AS count FROM community_rules WHERE community_id = ?',
      [params.id]
    );
    const sortOrder = existingCount ? existingCount.count : 0;

    const ruleId = generateId();
    execute(
      `INSERT INTO community_rules (id, community_id, title, description, sort_order, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
      [ruleId, params.id, title, description || null, sortOrder, user.sub]
    );

    const rule = queryOne('SELECT * FROM community_rules WHERE id = ?', [ruleId]);
    jsonResponse(res, 201, { rule: serializeRule(rule) });
  } catch (err) {
    console.error('[COMMUNITIES] Create rule error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * PUT /api/communities/:id/rules/:ruleId
 * Update a rule. Owner/moderator only.
 */
export async function handleUpdateCommunityRule(req, res, user, params) {
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
    const modCheck = requireCommunityModerator(community.id, user.sub);
    if (!modCheck.ok) {
      return errorResponse(res, 403, modCheck.error);
    }

    const rule = queryOne('SELECT * FROM community_rules WHERE id = ? AND community_id = ?', [params.ruleId, params.id]);
    if (!rule) {
      return errorResponse(res, 404, 'Rule not found');
    }

    let body = {};
    try { body = await parseBody(req); } catch (_) {}

    const title = body.title !== undefined ? (body.title || '').trim() : rule.title;
    const description = body.description !== undefined ? (body.description || '').trim() : (rule.description || '');
    const sortOrder = body.sort_order !== undefined ? Math.max(0, Number(body.sort_order) || 0) : rule.sort_order;
    const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : rule.enabled;

    if (!title) {
      return errorResponse(res, 422, 'Rule title is required');
    }
    if (title.length > 200) {
      return errorResponse(res, 422, 'Rule title must be 200 characters or fewer');
    }
    if (description.length > 2000) {
      return errorResponse(res, 422, 'Rule description must be 2000 characters or fewer');
    }

    execute(
      `UPDATE community_rules SET title = ?, description = ?, sort_order = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?`,
      [title, description || null, sortOrder, enabled, params.ruleId]
    );

    const updated = queryOne('SELECT * FROM community_rules WHERE id = ?', [params.ruleId]);
    jsonResponse(res, 200, { rule: serializeRule(updated) });
  } catch (err) {
    console.error('[COMMUNITIES] Update rule error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * DELETE /api/communities/:id/rules/:ruleId
 * Delete a rule. Owner/moderator only.
 */
export function handleDeleteCommunityRule(req, res, user, params) {
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
    const modCheck = requireCommunityModerator(community.id, user.sub);
    if (!modCheck.ok) {
      return errorResponse(res, 403, modCheck.error);
    }

    const rule = queryOne('SELECT * FROM community_rules WHERE id = ? AND community_id = ?', [params.ruleId, params.id]);
    if (!rule) {
      return errorResponse(res, 404, 'Rule not found');
    }

    execute('DELETE FROM community_rules WHERE id = ?', [params.ruleId]);
    jsonResponse(res, 200, { deleted: true });
  } catch (err) {
    console.error('[COMMUNITIES] Delete rule error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/* ===========================================================================
 * COMMUNITY-03: Pinned announcements
 * ========================================================================= */

const PINNED_LIMIT = 5;

/**
 * POST /api/communities/:id/posts/:postId/pin
 * Pin a post as an announcement. Owner/moderator only.
 */
export function handlePinPost(req, res, user, params) {
  try {
    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }
    const modCheck = requireCommunityModerator(community.id, user.sub);
    if (!modCheck.ok) {
      return errorResponse(res, 403, modCheck.error);
    }

    const post = queryOne('SELECT id, community_id FROM posts WHERE id = ?', [params.postId]);
    if (!post || post.community_id !== community.id) {
      return errorResponse(res, 404, 'Post not found in this community');
    }

    const pinnedCount = queryOne(
      'SELECT COUNT(*) AS count FROM posts WHERE community_id = ? AND is_pinned = 1',
      [community.id]
    );
    if (post.is_pinned !== 1 && pinnedCount.count >= PINNED_LIMIT) {
      return errorResponse(res, 422, `A community can have at most ${PINNED_LIMIT} pinned posts`);
    }

    execute('UPDATE posts SET is_pinned = 1 WHERE id = ?', [post.id]);
    const updated = queryOne('SELECT id, is_pinned, is_featured FROM posts WHERE id = ?', [post.id]);
    jsonResponse(res, 200, { post_id: updated.id, is_pinned: Boolean(updated.is_pinned), is_featured: Boolean(updated.is_featured) });
  } catch (err) {
    console.error('[COMMUNITIES] Pin post error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/communities/:id/posts/:postId/unpin
 * Unpin a post. Owner/moderator only.
 */
export function handleUnpinPost(req, res, user, params) {
  try {
    const community = getCommunity(params.id);
    if (!community) {
      return errorResponse(res, 404, 'Community not found');
    }
    const modCheck = requireCommunityModerator(community.id, user.sub);
    if (!modCheck.ok) {
      return errorResponse(res, 403, modCheck.error);
    }

    const post = queryOne('SELECT id, community_id FROM posts WHERE id = ?', [params.postId]);
    if (!post || post.community_id !== community.id) {
      return errorResponse(res, 404, 'Post not found in this community');
    }

    execute('UPDATE posts SET is_pinned = 0 WHERE id = ?', [post.id]);
    const updated = queryOne('SELECT id, is_pinned, is_featured FROM posts WHERE id = ?', [post.id]);
    jsonResponse(res, 200, { post_id: updated.id, is_pinned: Boolean(updated.is_pinned), is_featured: Boolean(updated.is_featured) });
  } catch (err) {
    console.error('[COMMUNITIES] Unpin post error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/* ===========================================================================
 * COMMUNITY-03: Reporting
 * ========================================================================= */

const REPORT_REASONS = new Set([
  'Spam',
  'Harassment',
  'Hate/abusive content',
  'Sexual content',
  'Scam/fraud',
  'False/misleading content',
  'Other',
]);

/**
 * POST /api/communities/:id/reports
 * Create a report. Eligible members only.
 */
export async function handleCreateReport(req, res, user, params) {
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
    const memberCheck = requireCommunityMember(community.id, user.sub);
    if (!memberCheck.ok) {
      return errorResponse(res, 403, memberCheck.error);
    }

    let body = {};
    try { body = await parseBody(req); } catch (_) {}

    const targetType = (body.target_type || '').trim().toLowerCase();
    const targetId = (body.target_id || '').trim();
    const reason = (body.reason || '').trim();
    const details = (body.details || '').trim();

    if (!['post', 'comment'].includes(targetType)) {
      return errorResponse(res, 422, 'target_type must be post or comment');
    }
    if (!targetId) {
      return errorResponse(res, 422, 'target_id is required');
    }
    if (!reason) {
      return errorResponse(res, 422, 'reason is required');
    }
    if (!REPORT_REASONS.has(reason)) {
      return errorResponse(res, 422, 'Invalid report reason');
    }

    if (targetType === 'post') {
      const post = queryOne('SELECT id, community_id FROM posts WHERE id = ?', [targetId]);
      if (!post || post.community_id !== community.id) {
        return errorResponse(res, 404, 'Post not found in this community');
      }
    } else {
      const comment = queryOne(
        `SELECT c.id, p.community_id FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?`,
        [targetId]
      );
      if (!comment || comment.community_id !== community.id) {
        return errorResponse(res, 404, 'Comment not found in this community');
      }
    }

    const duplicate = queryOne(
      `SELECT id FROM community_reports
        WHERE community_id = ? AND reporter_user_id = ? AND target_type = ? AND target_id = ? AND status = 'open'`,
      [params.id, user.sub, targetType, targetId]
    );
    if (duplicate) {
      return errorResponse(res, 409, 'You already have an open report for this content');
    }

    const reportId = generateId();
    execute(
      `INSERT INTO community_reports (id, community_id, reporter_user_id, target_type, target_id, reason, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))`,
      [reportId, params.id, user.sub, targetType, targetId, reason, details || null]
    );

    const report = queryOne('SELECT * FROM community_reports WHERE id = ?', [reportId]);
    jsonResponse(res, 201, { report: serializeReport(report) });
  } catch (err) {
    console.error('[COMMUNITIES] Create report error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/communities/:id/reports
 * Moderation queue. Owner/moderator only.
 */
export function handleGetReports(req, res, user, params) {
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
    const modCheck = requireCommunityModerator(community.id, user.sub);
    if (!modCheck.ok) {
      return errorResponse(res, 403, modCheck.error);
    }

    const { params: queryParams } = parseQuery(req.url);
    const statusFilter = (queryParams.status || '').trim().toLowerCase();
    const allowedStatuses = ['open', 'resolved', 'dismissed'];
    if (statusFilter && !allowedStatuses.includes(statusFilter)) {
      return errorResponse(res, 422, 'Invalid status filter');
    }

    const limit = Math.min(parseInt(queryParams.limit || '50', 10), 100);
    const offset = parseInt(queryParams.offset || '0', 10);

    let reports;
    if (statusFilter) {
      reports = queryAll(
        'SELECT * FROM community_reports WHERE community_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [params.id, statusFilter, limit, offset]
      );
    } else {
      reports = queryAll(
        'SELECT * FROM community_reports WHERE community_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [params.id, limit, offset]
      );
    }

    const total = queryOne(
      `SELECT COUNT(*) AS count FROM community_reports WHERE community_id = ? ${statusFilter ? 'AND status = ?' : ''}`,
      statusFilter ? [params.id, statusFilter] : [params.id]
    );

    jsonResponse(res, 200, {
      reports: reports.map(serializeReport),
      limit,
      offset,
      has_more: offset + limit < total.count,
    });
  } catch (err) {
    console.error('[COMMUNITIES] Get reports error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/communities/:id/reports/:reportId/resolve
 */
export function handleResolveReport(req, res, user, params) {
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
    const modCheck = requireCommunityModerator(community.id, user.sub);
    if (!modCheck.ok) {
      return errorResponse(res, 403, modCheck.error);
    }

    const report = queryOne('SELECT * FROM community_reports WHERE id = ? AND community_id = ?', [params.reportId, params.id]);
    if (!report) {
      return errorResponse(res, 404, 'Report not found');
    }
    if (report.status !== 'open') {
      return errorResponse(res, 422, 'Only open reports can be resolved');
    }

    execute(
      `UPDATE community_reports SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`,
      [user.sub, params.reportId]
    );
    const updated = queryOne('SELECT * FROM community_reports WHERE id = ?', [params.reportId]);
    jsonResponse(res, 200, { report: serializeReport(updated) });
  } catch (err) {
    console.error('[COMMUNITIES] Resolve report error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/communities/:id/reports/:reportId/dismiss
 */
export function handleDismissReport(req, res, user, params) {
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
    const modCheck = requireCommunityModerator(community.id, user.sub);
    if (!modCheck.ok) {
      return errorResponse(res, 403, modCheck.error);
    }

    const report = queryOne('SELECT * FROM community_reports WHERE id = ? AND community_id = ?', [params.reportId, params.id]);
    if (!report) {
      return errorResponse(res, 404, 'Report not found');
    }
    if (report.status !== 'open') {
      return errorResponse(res, 422, 'Only open reports can be dismissed');
    }

    execute(
      `UPDATE community_reports SET status = 'dismissed', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`,
      [user.sub, params.reportId]
    );
    const updated = queryOne('SELECT * FROM community_reports WHERE id = ?', [params.reportId]);
    jsonResponse(res, 200, { report: serializeReport(updated) });
  } catch (err) {
    console.error('[COMMUNITIES] Dismiss report error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/* ===========================================================================
 * COMMUNITY-03: Settings
 * ========================================================================= */

/**
 * GET /api/communities/:id/settings
 * Public readable settings.
 */
export function handleGetCommunitySettings(req, res, user, params) {
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

    const settings = getCommunitySettings(community.id);
    jsonResponse(res, 200, { settings });
  } catch (err) {
    console.error('[COMMUNITIES] Get settings error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * PUT /api/communities/:id/settings
 * Update settings. Owner/moderator only.
 */
export async function handleUpdateCommunitySettings(req, res, user, params) {
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
    const modCheck = requireCommunityModerator(community.id, user.sub);
    if (!modCheck.ok) {
      return errorResponse(res, 403, modCheck.error);
    }

    let body = {};
    try { body = await parseBody(req); } catch (_) {}

    const settings = getCommunitySettings(community.id);

    const setBool = (key) => {
      if (body[key] !== undefined) {
        const value = body[key];
        if (value !== true && value !== false && value !== 1 && value !== 0) {
          return `Invalid ${key}`;
        }
        settings[key] = value ? 1 : 0;
      }
      return null;
    };

    const errors = [setBool('allow_member_posts'), setBool('allow_member_comments'), setBool('allow_events'), setBool('allow_media'), setBool('moderation_enabled')].filter(Boolean);
    if (errors.length > 0) {
      return errorResponse(res, 422, errors[0]);
    }

    execute(
      `UPDATE community_settings SET allow_member_posts = ?, allow_member_comments = ?, allow_events = ?, allow_media = ?, moderation_enabled = ?, updated_at = datetime('now') WHERE id = ?`,
      [settings.allow_member_posts, settings.allow_member_comments, settings.allow_events, settings.allow_media, settings.moderation_enabled, settings.id]
    );

    const updated = queryOne('SELECT * FROM community_settings WHERE id = ?', [settings.id]);
    jsonResponse(res, 200, { settings: updated });
  } catch (err) {
    console.error('[COMMUNITIES] Update settings error:', err);
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