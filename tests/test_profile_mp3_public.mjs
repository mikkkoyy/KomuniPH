import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(url);
      if ([200, 401, 403, 404].includes(r.status)) return;
    } catch {}
    await wait(250);
  }
  throw new Error('Server not ready: ' + url);
}

const TMP = mkdtempSync(join(tmpdir(), 'komuniph-profile-mp3-'));
const PORT = 19900 + (process.pid % 100);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = join(TMP, 'test.db');

// Pre-seed isolated DB with schema, admin user and profile
{
  process.env.DATABASE_PATH = DB_PATH;
  process.env.UPLOAD_CREATOR_AUDIO_DIR = join(TMP, 'audio');
  const mod = (rel) => pathToFileURL(resolve(rel)).href;
  const database = await import(mod('server/database.js'));
  const bcrypt = await import('bcrypt');
  await database.initDatabase();
  const ts = new Date().toISOString();
  let admin = database.queryOne("SELECT id FROM users WHERE username = 'admin'");
  const hash = await bcrypt.hash('admin', 10);
  const adminId = admin?.id || crypto.randomUUID();
  if (!admin) {
    database.execute(
      "INSERT INTO users (id, email, username, password_hash, role, account_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)",
      [adminId, 'admin@local.test', 'admin', hash, ts, ts]
    );
  } else {
    database.execute("UPDATE users SET password_hash=?, role='admin', account_status='active' WHERE id=?", [hash, adminId]);
  }
  const prof = database.queryOne('SELECT id FROM profiles WHERE user_id = ?', [adminId]);
  if (!prof) {
    database.execute(
      "INSERT INTO profiles (id, user_id, display_name, theme_id, created_at, updated_at) VALUES (?, ?, ?, 'default', ?, ?)",
      [crypto.randomUUID(), adminId, 'Admin', ts, ts]
    );
  }
  database.closeDatabase();
}

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: resolve('.'),
  env: {
    ...process.env,
    DATABASE_PATH: DB_PATH,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    SECRET_KEY: 'test-secret-key-that-is-long-enough-32-chars',
    CORS_ORIGINS: `http://127.0.0.1:${PORT}`,
    UPLOAD_CREATOR_AUDIO_DIR: join(TMP, 'audio'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
server.stdout.on('data', () => {});
server.stderr.on('data', d => { stderr += d.toString(); });

try {
  await waitFor(`${BASE}/api/health`, 30000);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: 'admin' }),
  });
  const ld = await login.json();
  assert.equal(login.ok, true, 'login failed: ' + JSON.stringify(ld));
  const token = ld.access_token;

  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const form = new FormData();
  form.append('audio', new Blob([mp3], { type: 'audio/mpeg' }), 'admin-track.mp3');
  const up = await fetch(`${BASE}/api/profile/mp3`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const ud = await up.json();
  assert.equal(up.status, 201, 'upload failed: ' + JSON.stringify(ud));

  const pub = await fetch(`${BASE}/api/profile/admin`);
  const pubd = await pub.json();
  assert.equal(pub.status, 200);
  assert.equal(pubd.profile_mp3_url, ud.url);
  assert.equal(pubd.profile_mp3_title, 'admin-track');

  const del = await fetch(`${BASE}/api/profile/mp3`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(del.status, 200, 'delete failed: ' + await del.text());

  const pub2 = await fetch(`${BASE}/api/profile/admin`);
  const pubd2 = await pub2.json();
  assert.equal(pubd2.profile_mp3_url, null);
  assert.equal(pubd2.profile_mp3_title, null);

  console.log('PROFILE MP3 PUBLIC: PASS');
} catch (err) {
  console.error('PROFILE MP3 PUBLIC: FAIL');
  console.error(err && (err.stack || err.message || String(err)));
  if (stderr) console.error('SERVER_STDERR_TAIL\n' + stderr.slice(-2000));
  process.exitCode = 1;
} finally {
  try { server.kill('SIGTERM'); } catch {}
  await wait(1000);
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}
