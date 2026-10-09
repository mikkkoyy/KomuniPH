/**
 * CREATOR-17 — MP3 Music Player for the Creator Studio.
 *
 * Run:   node tests/test_creator17_mp3_player.mjs
 *        npm run test:creator17
 *
 * The Studio embeds a single <audio> element managed by MusicPlayer. This suite
 * pins the complete ownership-backed pipeline end to end. Every fixture is
 * throwaway: a temp SQLite database, temp upload dirs, newly registered users,
 * real MP3 bytes, and a real browser DOM (via the harness baked into the
 * test runner). The live database and real user uploads are never touched.
 */

import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BIN = resolve(__dirname, '..', 'node_modules', '.bin');
process.env.PATH = `${BIN};${process.env.PATH}`;

// ── Environment + database boot ─────────────────────────────────────────────
const DB_PATH = resolve(tmpdir(), `komuniph-c17-${process.pid}-${Date.now()}.sqlite`);
process.env.KOMUNIPH_DB_PATH = DB_PATH;
process.env.UPLOAD_PROFILE_DIR = resolve(tmpdir(), `komuniph-c17-profile-${process.pid}`);
process.env.UPLOAD_BACKGROUND_DIR = resolve(tmpdir(), `komuniph-c17-background-${process.pid}`);
process.env.UPLOAD_CREATOR_DIR = resolve(tmpdir(), `komuniph-c17-creator-${process.pid}`);
process.env.UPLOAD_CREATOR_EFFECT_DIR = resolve(tmpdir(), `komuniph-c17-effect-${process.pid}`);
process.env.UPLOAD_CREATOR_AUDIO_DIR = resolve(tmpdir(), `komuniph-c17-audio-${process.pid}`);
process.env.UPLOAD_MAX_FILE_SIZE = '5242880';

const database = await import('../server/database.js');
await database.initDatabase();

const auth = await import('../server/auth.js');
await import('../server/index.js'); // boots HTTP on port 0

const BASE_URL = (await import('../server/index.js')).BASE_URL;
const { default: got } = await import('got');

function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
