/**
 * KomuniPH Lite - Database
 * SQLite setup, schema initialization, and query helpers
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import config from './config.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

/**
 * Get or create the database connection
 */
export function getDb() {
  if (db) return db;

  const dbPath = resolve(__dirname, '..', config.database.path);
  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  return db;
}

/**
 * Initialize the database schema
 */
export function initDatabase() {
  const database = getDb();

  // PHOTO-ALBUM-01: Add album_id column to existing profile_photos tables.
  // This MUST run before database.exec() which creates indexes on album_id.
  try {
    const tableExists = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='profile_photos'"
    ).get();
    if (tableExists) {
      database.exec('ALTER TABLE profile_photos ADD COLUMN album_id TEXT REFERENCES photo_albums(id) ON DELETE SET NULL');
    }
  } catch (err) {
    // Column already exists — safe no-op.
  }
  // COMMUNITY-05: post media. Media is attached directly to the posts row
  // (no separate media table): media_url is the public file URL and
  // media_type is 'image' | 'video'. Existing rows keep NULL for both.
  try {
    const postsExists = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='posts'"
    ).get();
    if (postsExists) {
      const cols = database.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
      if (!cols.includes('media_url')) {
        database.exec('ALTER TABLE posts ADD COLUMN media_url TEXT');
      }
      if (!cols.includes('media_type')) {
        database.exec("ALTER TABLE posts ADD COLUMN media_type TEXT CHECK (media_type IN ('image','video'))");
      }
      // COMMUNITY-05: composer extras — feeling/activity, optional location
      // (reuses the existing Country -> City -> Barangay model), and mentions
      // stored in the post_mentions table.
      if (!cols.includes('feeling_type')) {
        database.exec("ALTER TABLE posts ADD COLUMN feeling_type TEXT CHECK (feeling_type IN ('feeling','watching','listening','playing','celebrating','traveling'))");
      }
      if (!cols.includes('feeling_value')) {
        database.exec('ALTER TABLE posts ADD COLUMN feeling_value TEXT');
      }
      if (!cols.includes('location_country')) {
        database.exec('ALTER TABLE posts ADD COLUMN location_country TEXT');
      }
      if (!cols.includes('location_city')) {
        database.exec('ALTER TABLE posts ADD COLUMN location_city TEXT');
      }
      if (!cols.includes('location_barangay')) {
        database.exec('ALTER TABLE posts ADD COLUMN location_barangay TEXT');
      }
    }
  } catch (err) {
    // Columns already exist — safe no-op.
  }

  database.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      account_status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

-- Profiles table
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      real_name TEXT,
      alias TEXT,
      alias_enabled INTEGER NOT NULL DEFAULT 0,
      bio TEXT,
      profile_photo_url TEXT,
      cover_photo_url TEXT,
      theme_id TEXT REFERENCES profile_themes(id),
      birthday TEXT,
      birthday_visible INTEGER NOT NULL DEFAULT 0,
      country TEXT,
      city TEXT,
      barangay TEXT,
      school TEXT,
      education TEXT,
      work TEXT,
      company TEXT,
      hometown TEXT,
      interests TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Profile themes table (PROFILE-02)
    CREATE TABLE IF NOT EXISTS profile_themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'system',
      is_free INTEGER NOT NULL DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Posts table
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,
      is_featured INTEGER NOT NULL DEFAULT 0,
      media_url TEXT,
      media_type TEXT CHECK (media_type IN ('image','video')),
      feeling_type TEXT CHECK (feeling_type IN ('feeling','watching','listening','playing','celebrating','traveling')),
      feeling_value TEXT,
      location_country TEXT,
      location_city TEXT,
      location_barangay TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      edited_at TEXT
    );

    -- COMMUNITY-05: post mentions. Tags reference real KomuniPH users only;
    -- resolved server-side from @username tokens in the post content.
    CREATE TABLE IF NOT EXISTS post_mentions (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Comments table
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Reactions table (likes)
    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id)
    );

    -- Password reset tokens
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Email verification tokens
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_author_id ON comments(author_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_post_id ON reactions(post_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_user_id ON reactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token_hash ON email_verification_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at ON email_verification_tokens(expires_at);

    -- TESTIMONIALS-01: Testimonials table
    CREATE TABLE IF NOT EXISTS testimonials (
      id TEXT PRIMARY KEY,
      profile_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_testimonials_profile_user_id ON testimonials(profile_user_id);
    CREATE INDEX IF NOT EXISTS idx_testimonials_author_user_id ON testimonials(author_user_id);
    CREATE INDEX IF NOT EXISTS idx_testimonials_status ON testimonials(status);
    CREATE INDEX IF NOT EXISTS idx_testimonials_created_at ON testimonials(created_at DESC);

    -- PHOTO-GALLERY-01: Profile photo gallery
    CREATE TABLE IF NOT EXISTS photo_albums (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'general',
      cover_photo_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_photo_albums_user_id ON photo_albums(user_id);
    CREATE INDEX IF NOT EXISTS idx_photo_albums_type ON photo_albums(type);

    CREATE TABLE IF NOT EXISTS profile_photos (
      id TEXT PRIMARY KEY,
      profile_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      album_id TEXT REFERENCES photo_albums(id) ON DELETE SET NULL,
      file_path TEXT NOT NULL,
      caption TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_profile_photos_profile_user_id ON profile_photos(profile_user_id);
    CREATE INDEX IF NOT EXISTS idx_profile_photos_album_id ON profile_photos(album_id);
    CREATE INDEX IF NOT EXISTS idx_profile_photos_status ON profile_photos(status);
    CREATE INDEX IF NOT EXISTS idx_profile_photos_created_at ON profile_photos(created_at DESC);

    -- MESSAGE-01: Messaging tables
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_read_at TEXT,
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON conversation_participants(user_id);

    -- MESSAGE-02: Safe schema migration for existing databases
    -- conversation_participants may already exist without last_read_at;
    -- ALTER TABLE is safe to attempt even if the column is already present
    -- on SQLite builds that already ran MESSAGE-01.

    -- COMMUNITY-01: Location-based communities
    -- A community is anchored to a geographic scope. Uniqueness is enforced
    -- with partial unique indexes so identical geographic communities cannot
    -- be created accidentally (e.g. two nationwide+Philippines, two
    -- city+Philippines+Angeles City, or two barangay+Philippines+Angeles
    -- City+Balibago communities).
    CREATE TABLE IF NOT EXISTS communities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('nationwide', 'city', 'barangay')),
      description TEXT,
      country TEXT,
      city TEXT,
      barangay TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_nationwide
      ON communities(country) WHERE type = 'nationwide';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_city
      ON communities(country, city) WHERE type = 'city';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_barangay
      ON communities(country, city, barangay) WHERE type = 'barangay';
    CREATE INDEX IF NOT EXISTS idx_communities_type ON communities(type);

    -- COMMUNITY-01: Community memberships.
    -- community_id + user_id is unique so duplicate memberships are impossible.
    -- COMMUNITY-02: role tracks owner/moderator/member for the group features
    -- and monthly moderator election. The earliest member of a community is
    -- assigned owner during init.
    CREATE TABLE IF NOT EXISTS community_members (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      role TEXT NOT NULL DEFAULT 'member',
      UNIQUE(community_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_community_members_community_id ON community_members(community_id);
    CREATE INDEX IF NOT EXISTS idx_community_members_user_id ON community_members(user_id);

    -- COMMUNITY-02: Monthly moderator elections. One election per community
    -- per month. Phase dates are generated in UTC from the schedule template:
    --   nominations 1st-5th, voting 6th-25th, result 26th, term 26th ->
    --   25th of the following month. A runoff among tied front-runners, when
    --   needed, runs from the 26th to the 26th of the following month.
    CREATE TABLE IF NOT EXISTS community_elections (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      nomination_start TEXT NOT NULL,
      nomination_end TEXT NOT NULL,
      voting_start TEXT NOT NULL,
      voting_end TEXT NOT NULL,
      runoff_end TEXT,
      term_start TEXT,
      term_end TEXT,
      winner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(community_id, year, month)
    );

    CREATE INDEX IF NOT EXISTS idx_community_elections_community ON community_elections(community_id);
    CREATE INDEX IF NOT EXISTS idx_community_elections_winner ON community_elections(winner_id);

    -- COMMUNITY-02: Election candidates. Self-nomination during the
    -- nomination phase; a user can appear at most once per election.
    CREATE TABLE IF NOT EXISTS community_election_candidates (
      id TEXT PRIMARY KEY,
      election_id TEXT NOT NULL REFERENCES community_elections(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nominated_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(election_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_community_election_candidates_election ON community_election_candidates(election_id);

    -- COMMUNITY-02: Election votes. UNIQUE(election_id, voter_user_id, round)
    -- enforces one vote per voter per round. Round 1 is the initial vote;
    -- round 2 is the runoff among tied front-runners (never resolved
    -- randomly). Voter identity is never exposed in the API.
    CREATE TABLE IF NOT EXISTS community_election_votes (
      id TEXT PRIMARY KEY,
      election_id TEXT NOT NULL REFERENCES community_elections(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES community_election_candidates(id) ON DELETE CASCADE,
      voter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      round INTEGER NOT NULL DEFAULT 1 CHECK (round IN (1, 2)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(election_id, voter_user_id, round)
    );

    CREATE INDEX IF NOT EXISTS idx_community_election_votes_election ON community_election_votes(election_id);
    CREATE INDEX IF NOT EXISTS idx_community_election_votes_candidate ON community_election_votes(candidate_id);

    -- COMMUNITY-02: Moderator terms. One row per winner-term; the winner's
    -- membership role is set to 'moderator' for the duration of the term.
    CREATE TABLE IF NOT EXISTS moderator_terms (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'moderator',
      term_start TEXT NOT NULL,
      term_end TEXT NOT NULL,
      election_id TEXT REFERENCES community_elections(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(community_id, user_id, term_start)
    );

    CREATE INDEX IF NOT EXISTS idx_moderator_terms_community ON moderator_terms(community_id);
    CREATE INDEX IF NOT EXISTS idx_moderator_terms_user ON moderator_terms(user_id);

    -- COMMUNITY-02: Community events (Events section on the community page).
    CREATE TABLE IF NOT EXISTS community_events (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      event_date TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_community_events_community ON community_events(community_id);
    CREATE INDEX IF NOT EXISTS idx_community_events_date ON community_events(community_id, event_date);
  `);

  // MESSAGE-02: Add last_read_at column to existing conversation_participants tables.
  // SQLite does not support IF NOT EXISTS on ALTER TABLE, so we attempt and
  // silently ignore the error if the column already exists.
  try {
    database.exec('ALTER TABLE conversation_participants ADD COLUMN last_read_at TEXT');
  } catch (err) {
    // Column already exists or table does not exist yet — both are safe no-ops.
  }

  // COMMUNITY-01: Add community_id to existing posts tables.
  // Existing posts keep community_id NULL; community posts are scoped to their
  // community for the community feed while remaining part of the shared feed.
  try {
    database.exec('ALTER TABLE posts ADD COLUMN community_id TEXT REFERENCES communities(id) ON DELETE SET NULL');
  } catch (err) {
    // Column already exists or table does not exist yet — both are safe no-ops.
  }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_posts_community_id ON posts(community_id)');
  } catch (err) {
    // Index already exists — safe no-op.
  }

  // COMMUNITY-02: Add role column to existing community_members tables.
  try {
    database.exec("ALTER TABLE community_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  } catch (err) {
    // Column already exists or table does not exist yet — both are safe no-ops.
  }

  // COMMUNITY-02: Add is_featured column to existing posts tables.
  try {
    const postColumns = database.prepare('PRAGMA table_info(posts)').all();
    if (!postColumns.some(column => column.name === 'is_featured')) {
      database.exec('ALTER TABLE posts ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0');
    }
  } catch (err) {
    // Column already exists or table does not exist yet — both are safe no-ops.
  }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_posts_community_id_featured ON posts(community_id, is_featured)');
  } catch (err) {
    // Index already exists — safe no-op.
  }

  // COMMUNITY-03: Add is_pinned column to posts for pinned announcements.
  try {
    const postColumns = database.prepare('PRAGMA table_info(posts)').all();
    if (!postColumns.some(column => column.name === 'is_pinned')) {
      database.exec('ALTER TABLE posts ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
    }
  } catch (err) {
    // Column already exists or table does not exist yet — both are safe no-ops.
  }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_posts_community_id_pinned ON posts(community_id, is_pinned, created_at DESC)');
  } catch (err) {
    // Index already exists — safe no-op.
  }

  // COMMUNITY-03: Community rules table.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS community_rules (
        id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } catch (err) { /* safe no-op */ }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_community_rules_community ON community_rules(community_id)');
  } catch (err) { /* safe no-op */ }

  // COMMUNITY-03: Community settings table.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS community_settings (
        id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        allow_member_posts INTEGER NOT NULL DEFAULT 1 CHECK (allow_member_posts IN (0, 1)),
        allow_member_comments INTEGER NOT NULL DEFAULT 1 CHECK (allow_member_comments IN (0, 1)),
        allow_events INTEGER NOT NULL DEFAULT 1 CHECK (allow_events IN (0, 1)),
        allow_media INTEGER NOT NULL DEFAULT 1 CHECK (allow_media IN (0, 1)),
        moderation_enabled INTEGER NOT NULL DEFAULT 1 CHECK (moderation_enabled IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } catch (err) { /* safe no-op */ }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_community_settings_community ON community_settings(community_id)');
  } catch (err) { /* safe no-op */ }

  // COMMUNITY-03: Community reports table.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS community_reports (
        id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment')),
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        details TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
        resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(community_id, reporter_user_id, target_type, target_id)
      )
    `);
  } catch (err) { /* safe no-op */ }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_community_reports_community ON community_reports(community_id, status)');
  } catch (err) { /* safe no-op */ }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_community_reports_target ON community_reports(target_type, target_id)');
  } catch (err) { /* safe no-op */ }

  // COMMUNITY-02: Assign the earliest member of each community as its owner if
  // no owner exists yet (owner = the founding member). Idempotent; safe on
  // every startup.
  try {
    const ownerless = database.prepare(
      `SELECT community_id FROM community_members cm
        WHERE NOT EXISTS (
          SELECT 1 FROM community_members o
          WHERE o.community_id = cm.community_id AND o.role = 'owner'
        )
        GROUP BY community_id`
    ).all();
    for (const row of ownerless) {
      const earliest = database.prepare(
        `SELECT user_id FROM community_members
          WHERE community_id = ? ORDER BY joined_at ASC, id ASC LIMIT 1`
      ).get(row.community_id);
      if (earliest) {
        database.prepare(
          "UPDATE community_members SET role = 'owner' WHERE community_id = ? AND user_id = ?"
        ).run(row.community_id, earliest.user_id);
      }
    }
    if (ownerless.length > 0) {
      console.log(`[COMMUNITY-02] Assigned owner to ${ownerless.length} community(ies)`);
    }
  } catch (err) {
    console.log('[COMMUNITY-02] Owner backfill skipped:', err.message);
  }

  // PROFILE-02: Add theme_id column to existing profiles tables.
  // SQLite does not support IF NOT EXISTS on ALTER TABLE, so we attempt and
  // silently ignore the error if the column already exists.
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN theme_id TEXT REFERENCES profile_themes(id)');
  } catch (err) {
    // Column already exists or table does not exist yet — both are safe no-ops.
  }

  // PROFILE-03: Add custom_theme_config column to existing profiles tables.
  // SQLite does not support IF NOT EXISTS on ALTER TABLE, so we attempt and
  // silently ignore the error if the column already exists.
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN custom_theme_config TEXT');
  } catch (err) {
    // Column already exists or table does not exist yet — both are safe no-ops.
  }

  // PROFILE-04: Add personal identity fields to existing profiles tables.
  // first_name, middle_name, last_name, nickname for Friendster-style profile.
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN first_name TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN middle_name TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN last_name TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN nickname TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }

  // Profile privacy: opt-in birthday sharing, including existing accounts.
  const profileColumns = database.prepare('PRAGMA table_info(profiles)').all();
  if (!profileColumns.some(column => column.name === 'birthday_visible')) {
    database.exec('ALTER TABLE profiles ADD COLUMN birthday_visible INTEGER NOT NULL DEFAULT 0 CHECK (birthday_visible IN (0, 1))');
  }
  if (!profileColumns.some(column => column.name === 'real_name_visible')) {
    database.exec('ALTER TABLE profiles ADD COLUMN real_name_visible INTEGER NOT NULL DEFAULT 0 CHECK (real_name_visible IN (0, 1))');
  }


  // PROFILE-06: Add location fields to profiles table.
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN birthday TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN country TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN city TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN barangay TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }

  // PROFILE-MODERN-01: Add modern personal information fields
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN school TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN education TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN work TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN company TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN hometown TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }
  try {
    database.exec('ALTER TABLE profiles ADD COLUMN interests TEXT');
  } catch (err) {
    // Column already exists — safe no-op.
  }

  // PHOTO-ALBUM-01: Add album_id column to existing profile_photos tables.
  try {
    database.exec('ALTER TABLE profile_photos ADD COLUMN album_id TEXT REFERENCES photo_albums(id) ON DELETE SET NULL');
  } catch (err) {
    // Column already exists — safe no-op.
  }

  // PHOTO-ALBUM-01: Create index for album_id if not exists
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_profile_photos_album_id ON profile_photos(album_id)');
  } catch (err) {
    // Index already exists — safe no-op.
  }

  // PHOTO-ALBUM-01: Create Profile Pictures album for existing users who don't have one
  try {
    const usersWithoutAlbum = database.prepare(`
      SELECT u.id FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM photo_albums pa WHERE pa.user_id = u.id AND pa.type = 'profile'
      )
    `).all();
    
    for (const user of usersWithoutAlbum) {
      const albumId = crypto.randomBytes(16).toString('hex');
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      database.prepare(`
        INSERT INTO photo_albums (id, user_id, name, description, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(albumId, user.id, 'Profile Pictures', 'Your profile picture history', 'profile', timestamp, timestamp);
    }
    if (usersWithoutAlbum.length > 0) {
      console.log(`[PHOTO-ALBUM-01] Created Profile Pictures album for ${usersWithoutAlbum.length} user(s)`);
    }
  } catch (err) {
    console.log('[PHOTO-ALBUM-01] Profile Pictures album creation skipped:', err.message);
  }

  // PHOTO-ALBUM-01: Migrate existing photos without album to a default "My Photos" album
  try {
    const usersWithOrphanPhotos = database.prepare(`
      SELECT DISTINCT pp.profile_user_id FROM profile_photos pp
      LEFT JOIN photo_albums pa ON pp.album_id = pa.id
      WHERE pp.album_id IS NULL
    `).all();
    
    for (const user of usersWithOrphanPhotos) {
      // Create a default "My Photos" album for this user if they don't have a general album
      let defaultAlbum = database.prepare(`
        SELECT id FROM photo_albums WHERE user_id = ? AND type = 'general' LIMIT 1
      `).get(user.profile_user_id);
      
      if (!defaultAlbum) {
        const albumId = crypto.randomBytes(16).toString('hex');
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        database.prepare(`
          INSERT INTO photo_albums (id, user_id, name, description, type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(albumId, user.profile_user_id, 'My Photos', 'Your uploaded photos', 'general', timestamp, timestamp);
        defaultAlbum = { id: albumId };
      }
      
      // Assign orphan photos to the default album
      database.prepare(`
        UPDATE profile_photos SET album_id = ? WHERE profile_user_id = ? AND album_id IS NULL
      `).run(defaultAlbum.id, user.profile_user_id);
    }
    if (usersWithOrphanPhotos.length > 0) {
      console.log(`[PHOTO-ALBUM-01] Migrated orphan photos to default albums for ${usersWithOrphanPhotos.length} user(s)`);
    }
  } catch (err) {
    console.log('[PHOTO-ALBUM-01] Orphan photo migration skipped:', err.message);
  }

  // PROFILE-04: Backfill existing profiles with identity fields from existing data.
  // Use existing display_name as first_name fallback, empty string for last_name.
  try {
    const updated = database.prepare(`
      UPDATE profiles 
      SET first_name = COALESCE(first_name, display_name, ''),
          last_name = COALESCE(last_name, ''),
          middle_name = COALESCE(middle_name, ''),
          nickname = COALESCE(nickname, ''),
          birthday = COALESCE(birthday, NULL),
          country = COALESCE(country, NULL),
          city = COALESCE(city, NULL),
          barangay = COALESCE(barangay, NULL),
          school = COALESCE(school, NULL),
          education = COALESCE(education, NULL),
          work = COALESCE(work, NULL),
          company = COALESCE(company, NULL),
          hometown = COALESCE(hometown, NULL),
          interests = COALESCE(interests, NULL)
      WHERE first_name IS NULL
    `).run();
    if (updated && updated.changes > 0) {
      console.log(`[PROFILE-04] Backfilled ${updated.changes} profile(s) with identity fields`);
    }
  } catch (err) {
    // Migration already applied or table not ready — safe no-op.
    console.log('[PROFILE-04] Identity fields backfill skipped:', err.message);
  }

  // COINS-01: Double-entry ledger coin economy with GCash/Maya cash in/out.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS user_wallets (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
        frozen_balance INTEGER NOT NULL DEFAULT 0 CHECK (frozen_balance >= 0),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (err) { /* safe no-op */ }

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS coin_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('earn','spend','cash_in','cash_out','creator_payout','admin_adjust','freeze','unfreeze')),
        reference_type TEXT,
        reference_id TEXT,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (err) { /* safe no-op */ }

  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_id ON coin_transactions(user_id)');
  } catch (err) { /* safe no-op */ }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_coin_transactions_type ON coin_transactions(type)');
  } catch (err) { /* safe no-op */ }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_coin_transactions_created_at ON coin_transactions(created_at DESC)');
  } catch (err) { /* safe no-op */ }

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        coins_amount INTEGER NOT NULL CHECK (coins_amount > 0),
        php_amount REAL NOT NULL CHECK (php_amount > 0),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('gcash','maya')),
        account_number TEXT NOT NULL,
        account_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
        admin_notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (err) { /* safe no-op */ }

  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_id ON withdrawal_requests(user_id)');
  } catch (err) { /* safe no-op */ }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status)');
  } catch (err) { /* safe no-op */ }

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS coin_topups (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        php_amount REAL NOT NULL CHECK (php_amount > 0),
        coins_amount INTEGER NOT NULL CHECK (coins_amount > 0),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('gcash','maya')),
        reference_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rejected')),
        admin_notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (err) { /* safe no-op */ }

  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_coin_topups_user_id ON coin_topups(user_id)');
  } catch (err) { /* safe no-op */ }
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_coin_topups_status ON coin_topups(status)');
  } catch (err) { /* safe no-op */ }

  // COINS-02: Add paymongo_source_id column to coin_topups for redirect-based payments.
  try {
    database.exec("ALTER TABLE coin_topups ADD COLUMN paymongo_source_id TEXT");
  } catch (err) { /* column already exists or table missing — safe no-op */ }

  // COINS-02: Make reference_number nullable for PayMongo-sourced topups.
  try {
    database.exec("ALTER TABLE coin_topups ALTER COLUMN reference_number DROP NOT NULL");
  } catch (err) { /* SQLite < 3.35 or already nullable — safe no-op */ }

  // COINS-01: Create wallets for existing users who don't have one yet.
  try {
    const usersWithoutWallet = database.prepare(`
      SELECT u.id FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM user_wallets w WHERE w.user_id = u.id
      )
    `).all();

    for (const user of usersWithoutWallet) {
      database.prepare(
        "INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 0, 0)"
      ).run(user.id);
    }
    if (usersWithoutWallet.length > 0) {
      console.log(`[COINS-01] Created wallets for ${usersWithoutWallet.length} user(s)`);
    }
  } catch (err) {
    console.log('[COINS-01] Wallet backfill skipped:', err.message);
  }

  // APP-SETTINGS: app_settings table for PayMongo config and other key-value settings.
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (err) { /* safe no-op */ }

  // ADMIN-SEED: Create default admin user (admin/admin) if no admin exists.
  // Note: actual seeding is done async via seedAdminUser() called from index.js startup.
  // Table creation here ensures the schema is ready.

  console.log('[DB] Database initialized successfully');
  return database;
}

/**
 * Close the database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Database connection closed');
  }
}

/**
 * Execute a query and return all results
 */
export function queryAll(sql, params = []) {
  const database = getDb();
  return database.prepare(sql).all(...params);
}

/**
 * Execute a query and return the first result
 */
export function queryOne(sql, params = []) {
  const database = getDb();
  return database.prepare(sql).get(...params);
}

/**
 * Execute an INSERT/UPDATE/DELETE and return info
 */
export function execute(sql, params = []) {
  const database = getDb();
  return database.prepare(sql).run(...params);
}

/**
 * Run multiple statements in a transaction
 */
export function transaction(fn) {
  const database = getDb();
  const stmt = database.transaction(fn);
  return stmt();
}

/**
 * Seed the default profile theme and backfill existing profiles without a theme.
 * Safe to call on every startup.
 */
export function seedDefaultTheme() {
  const database = getDb();
  database.transaction(() => {
    const defaultThemeId = 'default';
    const themeName = 'KomuniPH Default';
    const themeType = 'system';
    const isFree = 1;
     const themeConfig = JSON.stringify({
      background: '#fff7ec',
      backgroundGradient: 'linear-gradient(135deg, #0f172a 0%, #334155 50%, #475569 100%)',
      cardBackground: 'rgba(255, 247, 236, 0.95)',
      accent: '#0e6e6e',
      border: '#f0dfc8',
      text: '#2a2130',
      textSecondary: '#6b6072',
      cardRadius: '1.75rem',
      cardShadow: '0 20px 60px -20px rgba(42, 33, 48, 0.35)'
    });

    execute(
      `INSERT OR IGNORE INTO profile_themes (id, name, type, is_free, config) VALUES (?, ?, ?, ?, ?)`,
      [defaultThemeId, themeName, themeType, isFree, themeConfig]
    );

    // Ensure the default theme config has backgroundGradient for existing rows
    execute(
      `UPDATE profile_themes SET config = ? WHERE id = ? AND (config IS NULL OR json_extract(config, '$.backgroundGradient') IS NULL)`,
      [themeConfig, defaultThemeId]
    );

    const updated = execute(
      `UPDATE profiles SET theme_id = ? WHERE theme_id IS NULL`,
      [defaultThemeId]
    );

    if (updated && updated.changes > 0) {
      console.log(`[PROFILE-02] Backfilled ${updated.changes} profile(s) with default theme`);
    }
  })();
}

/**
 * Seed the default admin user (admin/admin) if none exists.
 * Async because it uses bcrypt — must be called after initDatabase().
 */
export async function seedAdminUser() {
  const database = getDb();
  try {
    const adminExists = database.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    if (adminExists) return;

    const bcrypt = await import('bcrypt');
    const adminId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash('admin', 12);
    const ts = new Date().toISOString();
    database.prepare(
      "INSERT INTO users (id, email, username, password_hash, role, account_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(adminId, 'admin@komuniph.local', 'admin', passwordHash, 'admin', 'active', ts, ts);

    database.prepare(
      "INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 0, 0)"
    ).run(adminId);

    console.log('[ADMIN-SEED] Default admin user created (username: admin, password: admin)');
  } catch (err) {
    console.log('[ADMIN-SEED] Admin seed skipped:', err.message);
  }
}

// Run schema initialization when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initDatabase();
  console.log('[DB] Schema initialization complete');
  process.exit(0);
}
