/**
 * CREATOR-14 — Creator Studio Project Manager test suite.
 *
 * Run:   node tests/test_creator14_project_manager.mjs
 *        npm run test:creator14
 *
 * A Creator Studio project IS a profile_designs row. This suite pins the
 * project lifecycle (create -> rename -> duplicate -> archive -> restore ->
 * delete), ownership isolation (a second user never sees, opens, or mutates
 * another user's project — they get 404, not 403, so ids are not leaked),
 * input validation, and that archived projects are the only deletable ones.
 *
 * Uses a throwaway SQLite database under the OS temp directory, so the live
 * data/komuniph.db is never touched.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-creator14-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-creator14.db');
process.env.PORT = String(19400 + (process.pid % 1200));
process.env.SECRET_KEY = 'creator-14-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'project-admin';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ── Imports (server modules resolve config from the env above) ─────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const auth = await import(mod('server/auth.js'));
await import(mod('server/index.js')); // boots the HTTP server

await database.seedAdminUser();

// ── Tiny test harness (mirrors test_creator_assets.mjs) ────────────────
const results = [];
const queue = [];
let groupName = '';

function group(name) {
  groupName = name;
}

function test(name, fn) {
  const full = `${groupName} › ${name}`;
  queue.push(async () => {
    try {
      await fn();
      results.push({ name: full, ok: true });
      process.stdout.write(`  ok   ${full}\n`);
    } catch (err) {
      results.push({ name: full, ok: false, error: err });
      process.stdout.write(`  FAIL ${full} — ${err.message}\n`);
    }
  });
}

function check(cond, msg = 'condition failed') {
  if (!cond) throw new Error(msg);
}

// ── HTTP helper ────────────────────────────────────────────────────────
async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch { /* non-JSON body */ }
  return { status: res.status, data };
}

// ── Fixtures ───────────────────────────────────────────────────────────
function createUserWithProfile(username) {
  const id = randomUUID();
  const email = `${username.replace(/[^a-z0-9]/gi, '')}-${id.slice(0, 8)}@test.local`;
  const ts = new Date().toISOString();
  database.execute(
    `INSERT INTO users (id, email, username, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
    [id, email, username, 'unused', ts, ts]
  );
  database.execute(
    `INSERT INTO profiles (id, user_id, display_name, theme_id, created_at, updated_at)
     VALUES (?, ?, ?, 'default', ?, ?)`,
    [randomUUID(), id, username, ts, ts]
  );
  return id;
}

function tokenFor(userId) {
  return auth.createToken(userId, 'access');
}

function projectRow(projectId) {
  return database.queryOne('SELECT * FROM profile_designs WHERE id = ?', [projectId]);
}

const owner = createUserWithProfile('c14-owner');
const ownerToken = tokenFor(owner);
const other = createUserWithProfile('c14-other');
const otherToken = tokenFor(other);

// ── Tests ──────────────────────────────────────────────────────────────

group('create');

test('creates a project with a valid default layout and draft status', async () => {
  const res = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'My First Project', description: 'A test project' },
  });
  check(res.status === 201, `expected 201, got ${res.status}`);
  const p = res.data.project;
  check(p && p.id, 'project has an id');
  check(p.name === 'My First Project', `name mismatch: ${p.name}`);
  check(p.description === 'A test project', `description mismatch: ${p.description}`);
  check(p.status === 'draft', `status mismatch: ${p.status}`);
  check(p.version === 1, `version mismatch: ${p.version}`);
  check(p.layout && Array.isArray(p.layout.components), 'layout has components array');
  check(p.layout.canvas && typeof p.layout.canvas.width === 'number', 'layout has canvas');
  check(!p.archived_at, 'new project is not archived');
  check(!p.deleted_at, 'new project is not deleted');
});

test('rejects a project without a name', async () => {
  const res = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: '' },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('rejects a project name over 100 characters', async () => {
  const res = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'x'.repeat(101) },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('rejects markup in the project name', async () => {
  const res = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: '<script>alert(1)</script>' },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('rejects a description over 500 characters', async () => {
  const res = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Valid', description: 'y'.repeat(501) },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('requires authentication', async () => {
  const res = await api('POST', '/api/creator/projects', { body: { name: 'No auth' } });
  check(res.status === 401, `expected 401, got ${res.status}`);
});

group('list');

test('lists the user projects ordered by most recently updated', async () => {
  await api('POST', '/api/creator/projects', { token: ownerToken, body: { name: 'List A' } });
  await api('POST', '/api/creator/projects', { token: ownerToken, body: { name: 'List B' } });
  const res = await api('GET', '/api/creator/projects', { token: ownerToken });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(Array.isArray(res.data.projects), 'projects is an array');
  check(res.data.projects.length >= 2, `expected >= 2 projects, got ${res.data.projects.length}`);
  const names = res.data.projects.map(p => p.name);
  check(names.includes('List A') && names.includes('List B'), 'both created projects listed');
  // Most recently updated first.
  const idxA = names.indexOf('List A');
  const idxB = names.indexOf('List B');
  check(idxB < idxA, 'most recently created project is listed first');
});

test('a second user does not see the first user projects', async () => {
  const res = await api('GET', '/api/creator/projects', { token: otherToken });
  check(res.status === 200, `expected 200, got ${res.status}`);
  const names = (res.data.projects || []).map(p => p.name);
  check(!names.includes('List A') && !names.includes('List B'), 'other user sees no owner projects');
});

group('get');

test('fetches a single project by id', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Fetch Me' },
  });
  const id = created.data.project.id;
  const res = await api('GET', `/api/creator/projects/${id}`, { token: ownerToken });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.project.id === id, 'returned the requested project');
  check(res.data.project.name === 'Fetch Me', 'name matches');
});

test('returns 404 for a project owned by another user', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Secret Project' },
  });
  const id = created.data.project.id;
  const res = await api('GET', `/api/creator/projects/${id}`, { token: otherToken });
  check(res.status === 404, `expected 404 (not 403), got ${res.status}`);
});

test('returns 404 for an unknown project id', async () => {
  const res = await api('GET', '/api/creator/projects/does-not-exist', { token: ownerToken });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

group('rename');

test('renames a project and updates its description', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Old Name', description: 'old desc' },
  });
  const id = created.data.project.id;
  const res = await api('PATCH', `/api/creator/projects/${id}`, {
    token: ownerToken,
    body: { name: 'New Name', description: 'new desc' },
  });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.project.name === 'New Name', `name not updated: ${res.data.project.name}`);
  check(res.data.project.description === 'new desc', `description not updated: ${res.data.project.description}`);
  // Persisted to the database.
  const row = projectRow(id);
  check(row.name === 'New Name', 'rename persisted to database');
});

test('a second user cannot rename another user project', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Protected' },
  });
  const id = created.data.project.id;
  const res = await api('PATCH', `/api/creator/projects/${id}`, {
    token: otherToken,
    body: { name: 'Hijacked' },
  });
  check(res.status === 404, `expected 404, got ${res.status}`);
  const row = projectRow(id);
  check(row.name === 'Protected', 'name unchanged after cross-user rename attempt');
});

group('duplicate');

test('duplicates a project into an independent copy', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Original', description: 'original desc' },
  });
  const originalId = created.data.project.id;
  const res = await api('POST', `/api/creator/projects/${originalId}/duplicate`, { token: ownerToken });
  check(res.status === 201, `expected 201, got ${res.status}`);
  const copy = res.data.project;
  check(copy.id !== originalId, 'copy has a different id');
  check(copy.name === 'Original Copy', `copy name: ${copy.name}`);
  check(copy.status === 'draft', 'copy is a draft');
  check(copy.version === 1, 'copy starts at version 1');
  // The copy is a deep clone: mutating it must not touch the original.
  const origAfter = await api('GET', `/api/creator/projects/${originalId}`, { token: ownerToken });
  check(origAfter.data.project.name === 'Original', 'original name unchanged');
  check(origAfter.data.project.description === 'original desc', 'original description unchanged');
});

test('a second user cannot duplicate another user project', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'No Copy For You' },
  });
  const id = created.data.project.id;
  const res = await api('POST', `/api/creator/projects/${id}/duplicate`, { token: otherToken });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

group('archive');

test('archives a project', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'To Archive' },
  });
  const id = created.data.project.id;
  const res = await api('POST', `/api/creator/projects/${id}/archive`, { token: ownerToken });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.project.status === 'archived', `status: ${res.data.project.status}`);
  check(!!res.data.project.archived_at, 'archived_at is set');
  const row = projectRow(id);
  check(row.status === 'archived', 'archive persisted to database');
  check(!!row.archived_at, 'archived_at persisted');
});

test('archiving an already archived project is rejected', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Already Archived' },
  });
  const id = created.data.project.id;
  await api('POST', `/api/creator/projects/${id}/archive`, { token: ownerToken });
  const res = await api('POST', `/api/creator/projects/${id}/archive`, { token: ownerToken });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

group('restore');

test('restores an archived project to draft', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'To Restore' },
  });
  const id = created.data.project.id;
  await api('POST', `/api/creator/projects/${id}/archive`, { token: ownerToken });
  const res = await api('POST', `/api/creator/projects/${id}/restore`, { token: ownerToken });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.project.status === 'draft', `status: ${res.data.project.status}`);
  check(res.data.project.archived_at === null, 'archived_at cleared');
  const row = projectRow(id);
  check(row.status === 'draft', 'restore persisted to database');
  check(row.archived_at === null, 'archived_at cleared in database');
});

test('restoring a non-archived project is rejected', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Not Archived' },
  });
  const id = created.data.project.id;
  const res = await api('POST', `/api/creator/projects/${id}/restore`, { token: ownerToken });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

group('delete');

test('deletes an archived project (soft delete)', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'To Delete' },
  });
  const id = created.data.project.id;
  await api('POST', `/api/creator/projects/${id}/archive`, { token: ownerToken });
  const res = await api('DELETE', `/api/creator/projects/${id}`, { token: ownerToken });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.success === true, 'success flag set');
  // Soft-deleted: row still exists but is flagged and hidden everywhere.
  const row = projectRow(id);
  check(!!row.deleted_at, 'deleted_at is set');
  const list = await api('GET', '/api/creator/projects', { token: ownerToken });
  const names = (list.data.projects || []).map(p => p.name);
  check(!names.includes('To Delete'), 'deleted project no longer listed');
  const get = await api('GET', `/api/creator/projects/${id}`, { token: ownerToken });
  check(get.status === 404, 'deleted project is not fetchable');
});

test('deleting an active (non-archived) project is rejected', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Active Project' },
  });
  const id = created.data.project.id;
  const res = await api('DELETE', `/api/creator/projects/${id}`, { token: ownerToken });
  check(res.status === 400, `expected 400, got ${res.status}`);
  const row = projectRow(id);
  check(!row.deleted_at, 'active project was not deleted');
});

test('a second user cannot delete another user project', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Do Not Delete' },
  });
  const id = created.data.project.id;
  await api('POST', `/api/creator/projects/${id}/archive`, { token: ownerToken });
  const res = await api('DELETE', `/api/creator/projects/${id}`, { token: otherToken });
  check(res.status === 404, `expected 404, got ${res.status}`);
  const row = projectRow(id);
  check(!row.deleted_at, 'project not deleted by cross-user attempt');
});

group('persistence');

test('projects persist in the database across the API', async () => {
  const created = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Persistent', description: 'stored' },
  });
  const id = created.data.project.id;
  const row = projectRow(id);
  check(!!row, 'row exists in profile_designs');
  check(row.user_id === owner, 'row is owned by the creating user');
  check(row.name === 'Persistent', 'name persisted');
  check(row.description === 'stored', 'description persisted');
  check(row.status === 'draft', 'status persisted');
  // The stored layout is valid JSON with the default canvas.
  const layout = JSON.parse(row.layout_config);
  check(layout.canvas && typeof layout.canvas.width === 'number', 'stored layout has canvas');
  check(Array.isArray(layout.components), 'stored layout has components');
});

// ── Runner ─────────────────────────────────────────────────────────────
for (const t of queue) await t();

const okCount = results.filter(r => r.ok).length;
const failCount = results.filter(r => !r.ok).length;
process.stdout.write(`\nCREATOR-14: ${okCount} passed, ${failCount} failed\n`);

database.closeDatabase();
try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }

process.exit(failCount > 0 ? 1 : 0);
