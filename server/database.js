/**
 * KomuniPH Lite - Database
 * SQLite setup, schema initialization, and query helpers
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import config from './config.js';

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
      country TEXT,
      city TEXT,
      barangay TEXT,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      edited_at TEXT
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
  `);

  // MESSAGE-02: Add last_read_at column to existing conversation_participants tables.
  // SQLite does not support IF NOT EXISTS on ALTER TABLE, so we attempt and
  // silently ignore the error if the column already exists.
  try {
    database.exec('ALTER TABLE conversation_participants ADD COLUMN last_read_at TEXT');
  } catch (err) {
    // Column already exists or table does not exist yet — both are safe no-ops.
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
          barangay = COALESCE(barangay, NULL)
      WHERE first_name IS NULL
    `).run();
    if (updated && updated.changes > 0) {
      console.log(`[PROFILE-04] Backfilled ${updated.changes} profile(s) with identity fields`);
    }
  } catch (err) {
    // Migration already applied or table not ready — safe no-op.
    console.log('[PROFILE-04] Identity fields backfill skipped:', err.message);
  }

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

    const updated = execute(
      `UPDATE profiles SET theme_id = ? WHERE theme_id IS NULL`,
      [defaultThemeId]
    );

    if (updated && updated.changes > 0) {
      console.log(`[PROFILE-02] Backfilled ${updated.changes} profile(s) with default theme`);
    }
  })();
}

// Run schema initialization when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initDatabase();
  console.log('[DB] Schema initialization complete');
  process.exit(0);
}
