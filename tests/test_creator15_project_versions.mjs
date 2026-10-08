/**
 * CREATOR-15 — Creator Studio Project Save / Load / Version History.
 *
 * Run:   node tests/test_creator15_project_versions.mjs
 *        npm run test:creator15
 *
 * A Save is an explicit, server-validated, versioned snapshot. This
 * suite pins:
 *   - the version store: a new project starts at version 1 whose
 *     creation state IS the first snapshot; every changed Save
 *     appends an immutable version; an unchanged Save appends
 *     nothing (deterministic, canonical comparison — never
 *     timestamps); key order alone is not a change.
 *   - history: newest-first, metadata-only list; per-version full
 *     snapshot fetch; strict version argument validation.
 *   - restore: never mutates history — it appends a NEW version
 *     that copies the restored contents and records
 *     restored_from_version; every earlier version stays byte-for-byte
 *     intact.
 *   - ownership: a second user gets 404 (never 403) on every
 *     version route, and one project's versions are unreachable
 *     through another project's id.
 *   - invariants: versions are unique per design, monotonically
 *     increasing, and the current design's version always equals
 *     the highest saved version — including across publish.
 *   - migration: a design row created before version history
 *     existed is backfilled with a snapshot of its current state
 *     at its current version.
 *
 * Uses a throwaway SQLite database under the OS temp directory, so
 * the live data/komuniph.db is never touched.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-creator15-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-creator15.db');
process.env.PORT = String(19500 + (process.pid % 1200));
process.env.SECRET_KEY = 'creator-15-test-secret-key-that-is-long-enough';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'version-admin';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ── Imports (server modules resolve config from the env above) ─────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const auth = await import(mod('server/auth.js'));
await import(mod('server/index.js')); // boots the HTTP server

await database.seedAdminUser();

// ── Tiny test harness (mirrors test_creator14_project_manager.mjs) ─────
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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
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

function versionRows(designId) {
  return database.queryAll(
    'SELECT * FROM profile_design_versions WHERE design_id = ? ORDER BY version ASC',
    [designId]
  );
}

/** A text component exercising fonts, animation, geometry and style. */
function textComponent(id, text) {
  return {
    id,
    type: 'text',
    x: 100,
    y: 200,
    width: 420,
    height: 96,
    zIndex: 3,
    visible: true,
    locked: false,
    rotation: 1.5,
    style: { background: '#ffffff', textColor: '#123456', opacity: 0.95 },
    config: {
      text,
      fontSize: 24,
      fontWeight: 700,
      fontFamily: 'serif',
      fontStyle: 'italic',
      textAlign: 'center',
      lineHeight: 1.4,
      textColor: '#123456',
      animation: { name: 'fade-up', duration: 1.5, delay: 0.2, iteration: 3, timing: 'ease-out' },
    },
  };
}

/** An image component (background-image URL rules apply to it too). */
function imageComponent(id) {
  return {
    id,
    type: 'image',
    x: 20,
    y: 40,
    width: 180,
    height: 180,
    zIndex: 1,
    visible: true,
    locked: false,
    config: {
      imageUrl: 'https://example.com/photo.png',
      alt: 'A photo',
      fit: 'cover',
      backgroundColor: '',
    },
  };
}

const THEME_V2 = {
  backgroundImage: 'https://example.com/bg-two.png',
  backgroundPosition: 'center',
  backgroundSize: 'cover',
  backgroundEffect: {
    enabled: true,
    effectId: 'builtin.snow',
    source: 'builtin',
    config: {
      count: 60, speed: 1, size: 3, opacity: 0.9,
      drift: 20, spread: 10, rotation: false, rotationSpeed: 0,
    },
  },
};

const owner = createUserWithProfile('c15-owner');
const ownerToken = tokenFor(owner);
const other = createUserWithProfile('c15-other');
const otherToken = tokenFor(other);

// ── Tests ────────────────────────────────────────────────────────────

group('auth');

test('save requires authentication', async () => {
  const res = await api('POST', '/api/creator/projects/anything/save', {
    body: { name: 'x', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme: null },
  });
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('history requires authentication', async () => {
  const res = await api('GET', '/api/creator/projects/anything/versions');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('version fetch requires authentication', async () => {
  const res = await api('GET', '/api/creator/projects/anything/versions/1');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

test('restore requires authentication', async () => {
  const res = await api('POST', '/api/creator/projects/anything/versions/1/restore');
  check(res.status === 401, `expected 401, got ${res.status}`);
});

group('ownership');

test('a second user cannot save another user\'s project (404, not 403)', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Private Project' },
  });
  const id = create.data.project.id;
  const res = await api('POST', `/api/creator/projects/${id}/save`, {
    token: otherToken,
    body: { name: 'Hijack', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme: null },
  });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

test('a second user cannot read another user\'s version history (404)', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Private Project 2' },
  });
  const id = create.data.project.id;
  const res = await api('GET', `/api/creator/projects/${id}/versions`, { token: otherToken });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

test('a second user cannot fetch or restore another user\'s versions (404)', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Private Project 3' },
  });
  const id = create.data.project.id;
  const get = await api('GET', `/api/creator/projects/${id}/versions/1`, { token: otherToken });
  check(get.status === 404, `expected 404, got ${get.status}`);
  const restore = await api('POST', `/api/creator/projects/${id}/versions/1/restore`, { token: otherToken });
  check(restore.status === 404, `expected 404, got ${restore.status}`);
});

group('initial state');

test('a new project starts at version 1 and its creation state is the first snapshot', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Versioned Project', description: 'history test' },
  });
  check(create.status === 201, `expected 201, got ${create.status}`);
  const project = create.data.project;
  check(project.version === 1, `expected version 1, got ${project.version}`);

  const history = await api('GET', `/api/creator/projects/${project.id}/versions`, { token: ownerToken });
  check(history.status === 200, `expected 200, got ${history.status}`);
  check(history.data.versions.length === 1, `expected 1 version, got ${history.data.versions.length}`);
  check(history.data.versions[0].version === 1, 'first version is v1');
  check(history.data.versions[0].is_current === true, 'v1 is current');
  check(history.data.versions[0].name === 'Versioned Project', 'v1 carries the creation name');
  check(history.data.versions[0].restored_from_version === null, 'v1 is not a restore');
});

test('the history list carries metadata only — never a layout or theme payload', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Metadata Only' },
  });
  const id = create.data.project.id;
  await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: {
      name: 'Metadata Only',
      layout: { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', 'hello')] },
      theme: THEME_V2,
    },
  });
  const history = await api('GET', `/api/creator/projects/${id}/versions`, { token: ownerToken });
  for (const entry of history.data.versions) {
    check(!('layout' in entry), `list entry v${entry.version} must not carry a layout`);
    check(!('theme' in entry), `list entry v${entry.version} must not carry a theme`);
  }
});

group('save');

test('a changed save appends version 2, then version 3', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Save Me' },
  });
  const id = create.data.project.id;

  const layout2 = {
    canvas: { width: 960, minHeight: 1200 },
    components: [textComponent('t1', 'First save')],
  };
  const save2 = await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Save Me', layout: layout2, theme: THEME_V2 },
  });
  check(save2.status === 200, `expected 200, got ${save2.status}`);
  check(save2.data.saved === true, 'a real change must save');
  check(save2.data.version === 2, `expected version 2, got ${save2.data.version}`);
  check(save2.data.project.version === 2, 'project row moved to version 2');

  const layout3 = {
    canvas: { width: 960, minHeight: 1200 },
    components: [textComponent('t1', 'Second save')],
  };
  const save3 = await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Save Me', layout: layout3, theme: THEME_V2 },
  });
  check(save3.data.saved === true, 'a real change must save');
  check(save3.data.version === 3, `expected version 3, got ${save3.data.version}`);

  const rows = versionRows(id);
  check(rows.length === 3, `expected 3 version rows, got ${rows.length}`);
  check(rows.map(r => r.version).join(',') === '1,2,3', 'versions are 1,2,3 in order');
});

test('saving identical content creates NO new version', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'No-op Save' },
  });
  const id = create.data.project.id;
  const payload = {
    name: 'No-op Save',
    layout: { canvas: { width: 960, minHeight: 1200 }, components: [imageComponent('img1')] },
    theme: THEME_V2,
  };
  const first = await api('POST', `/api/creator/projects/${id}/save`, { token: ownerToken, body: payload });
  check(first.data.version === 2, `expected version 2, got ${first.data.version}`);

  const again = await api('POST', `/api/creator/projects/${id}/save`, { token: ownerToken, body: payload });
  check(again.status === 200, `expected 200, got ${again.status}`);
  check(again.data.saved === false, 'identical content must not save');
  check(again.data.version === 2, `version must stay 2, got ${again.data.version}`);
  check(versionRows(id).length === 2, 'no new version row may be written');
});

test('key order alone is not a change (canonical comparison)', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Key Order' },
  });
  const id = create.data.project.id;
  const layout = {
    canvas: { width: 960, minHeight: 1200 },
    components: [textComponent('t1', 'stable')],
  };
  const theme = { ...THEME_V2 };
  const first = await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Key Order', layout, theme },
  });
  check(first.data.version === 2, `expected version 2, got ${first.data.version}`);

  // Same data, every object's keys in a different order.
  const reordered = {
    theme: { backgroundEffect: theme.backgroundEffect, backgroundSize: theme.backgroundSize, backgroundPosition: theme.backgroundPosition, backgroundImage: theme.backgroundImage },
    layout: { components: [{ config: { textAlign: 'center', textColor: '#123456', text: 'stable', animation: { timing: 'ease-out', iteration: 3, delay: 0.2, duration: 1.5, name: 'fade-up' }, lineHeight: 1.4, fontStyle: 'italic', fontFamily: 'serif', fontWeight: 700, fontSize: 24 }, locked: false, visible: true, zIndex: 3, height: 96, width: 420, y: 200, x: 100, style: { opacity: 0.95, textColor: '#123456', background: '#ffffff' }, rotation: 1.5, type: 'text', id: 't1' }], canvas: { minHeight: 1200, width: 960 } },
    name: 'Key Order',
  };
  const again = await api('POST', `/api/creator/projects/${id}/save`, { token: ownerToken, body: reordered });
  check(again.data.saved === false, 'key order alone must not create a version');
  check(again.data.version === 2, `version must stay 2, got ${again.data.version}`);
});

test('a name-only change IS a new version', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Rename Me' },
  });
  const id = create.data.project.id;
  const layout = { canvas: { width: 960, minHeight: 1200 }, components: [] };
  const renamed = await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Renamed Project', layout, theme: null },
  });
  check(renamed.data.saved === true, 'a name change is a real change');
  check(renamed.data.version === 2, `expected version 2, got ${renamed.data.version}`);
});

test('an invalid save is rejected and writes nothing', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Invalid Save' },
  });
  const id = create.data.project.id;

  const badComponent = await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: {
      name: 'Invalid Save',
      layout: { canvas: { width: 960, minHeight: 1200 }, components: [{ id: 'bad', type: 'video', x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false, config: {} }] },
      theme: null,
    },
  });
  check(badComponent.status === 400, `expected 400, got ${badComponent.status}`);

  const missingLayout = await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Invalid Save', theme: null },
  });
  check(missingLayout.status === 400, `expected 400, got ${missingLayout.status}`);

  const missingTheme = await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Invalid Save', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] } },
  });
  check(missingTheme.status === 400, `expected 400, got ${missingTheme.status}`);

  check(versionRows(id).length === 1, 'a rejected save must not write a version');
});

test('a save preserves components, fonts, animation, geometry, background and effect config', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Round Trip' },
  });
  const id = create.data.project.id;
  const layout = {
    canvas: { width: 1024, minHeight: 1400 },
    components: [textComponent('t1', 'Round trip text'), imageComponent('img1')],
  };
  const save = await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Round Trip', layout, theme: THEME_V2 },
  });
  check(save.data.version === 2, `expected version 2, got ${save.data.version}`);

  const snapshot = await api('GET', `/api/creator/projects/${id}/versions/2`, { token: ownerToken });
  check(snapshot.status === 200, `expected 200, got ${snapshot.status}`);
  const v = snapshot.data.version;
  check(deepEqual(v.layout, layout), 'the saved layout must round-trip exactly');
  check(deepEqual(v.theme, THEME_V2), 'the saved theme must round-trip exactly');
  check(v.layout.canvas.width === 1024 && v.layout.canvas.minHeight === 1400, 'canvas geometry preserved');
  const text = v.layout.components.find(c => c.id === 't1');
  check(text.config.fontFamily === 'serif', 'font id preserved');
  check(text.config.animation.name === 'fade-up' && text.config.animation.iteration === 3, 'animation preserved');
  check(text.rotation === 1.5, 'rotation preserved');
  check(deepEqual(text.style, { background: '#ffffff', textColor: '#123456', opacity: 0.95 }), 'style preserved');
  check(v.theme.backgroundImage === 'https://example.com/bg-two.png', 'background image preserved');
  check(v.theme.backgroundEffect.effectId === 'builtin.snow', 'effect config preserved');
});

group('history');

test('the history lists versions newest first with is_current on the latest', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'History Order' },
  });
  const id = create.data.project.id;
  for (let i = 1; i <= 3; i += 1) {
    await api('POST', `/api/creator/projects/${id}/save`, {
      token: ownerToken,
      body: {
        name: 'History Order',
        layout: { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', `save ${i}`)] },
        theme: null,
      },
    });
  }
  const history = await api('GET', `/api/creator/projects/${id}/versions`, { token: ownerToken });
  const versions = history.data.versions;
  check(versions.length === 4, `expected 4 versions, got ${versions.length}`);
  check(versions.map(v => v.version).join(',') === '4,3,2,1', `newest first, got ${versions.map(v => v.version).join(',')}`);
  check(versions[0].is_current === true, 'the newest version is current');
  check(versions.slice(1).every(v => v.is_current === false), 'older versions are not current');
});

test('fetching a version returns its full snapshot', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Snapshot Fetch' },
  });
  const id = create.data.project.id;
  const layout = { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', 'snapshot')] };
  await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Snapshot Fetch', layout, theme: THEME_V2 },
  });

  const v1 = await api('GET', `/api/creator/projects/${id}/versions/1`, { token: ownerToken });
  check(v1.status === 200, `expected 200, got ${v1.status}`);
  check(v1.data.version.version === 1, 'v1 fetched');
  check(v1.data.version.layout.components.length === 0, 'v1 is the empty creation state');
  check(v1.data.version.theme === null, 'v1 has no theme');
  check(v1.data.version.is_current === false, 'v1 is not current once v2 exists');

  const v2 = await api('GET', `/api/creator/projects/${id}/versions/2`, { token: ownerToken });
  check(v2.data.version.layout.components.length === 1, 'v2 carries the saved component');
  check(v2.data.version.is_current === true, 'v2 is current');
});

test('fetching a missing version returns 404', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Missing Version' },
  });
  const id = create.data.project.id;
  const res = await api('GET', `/api/creator/projects/${id}/versions/999`, { token: ownerToken });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

test('version arguments are validated strictly', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Version Args' },
  });
  const id = create.data.project.id;
  const zero = await api('GET', `/api/creator/projects/${id}/versions/0`, { token: ownerToken });
  check(zero.status === 400, `expected 400 for version 0, got ${zero.status}`);
  const negative = await api('GET', `/api/creator/projects/${id}/versions/-1`, { token: ownerToken });
  check(negative.status === 400, `expected 400 for version -1, got ${negative.status}`);
  const notNumber = await api('GET', `/api/creator/projects/${id}/versions/abc`, { token: ownerToken });
  check(notNumber.status === 400, `expected 400 for a non-integer, got ${notNumber.status}`);
  const restoreZero = await api('POST', `/api/creator/projects/${id}/versions/0/restore`, { token: ownerToken });
  check(restoreZero.status === 400, `expected 400 restoring version 0, got ${restoreZero.status}`);
});

group('restore');

test('restoring v1 at v3 appends v4 with v1\'s contents and keeps v1-v3 intact', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Restore Me' },
  });
  const id = create.data.project.id;

  const layout2 = { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', 'v2 text')] };
  await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Restore Me', layout: layout2, theme: THEME_V2 },
  });
  const layout3 = { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', 'v3 text')] };
  await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Restore Me', layout: layout3, theme: THEME_V2 },
  });

  const v1Before = await api('GET', `/api/creator/projects/${id}/versions/1`, { token: ownerToken });
  const v2Before = await api('GET', `/api/creator/projects/${id}/versions/2`, { token: ownerToken });
  const v3Before = await api('GET', `/api/creator/projects/${id}/versions/3`, { token: ownerToken });

  const restore = await api('POST', `/api/creator/projects/${id}/versions/1/restore`, { token: ownerToken });
  check(restore.status === 200, `expected 200, got ${restore.status}`);
  check(restore.data.version === 4, `expected new version 4, got ${restore.data.version}`);
  check(restore.data.restored_from_version === 1, 'the response records the restored-from version');
  check(restore.data.project.version === 4, 'the project row moved to version 4');
  check(restore.data.project.layout.components.length === 0, 'the current layout is v1\'s empty layout');

  // History now holds v1..v4, newest first, v4 current and marked as a restore.
  const history = await api('GET', `/api/creator/projects/${id}/versions`, { token: ownerToken });
  check(history.data.versions.map(v => v.version).join(',') === '4,3,2,1', 'history is v4,v3,v2,v1');
  check(history.data.versions[0].is_current === true, 'v4 is current');
  check(history.data.versions[0].restored_from_version === 1, 'v4 records restored_from_version 1');

  // Every earlier version is byte-for-byte unchanged. The
  // is_current flag legitimately flips to the restored
  // version, so it is excluded from the comparison.
  const withoutCurrentFlag = (snapshot) => {
    const { is_current, ...rest } = snapshot;
    return rest;
  };
  const v1After = await api('GET', `/api/creator/projects/${id}/versions/1`, { token: ownerToken });
  const v2After = await api('GET', `/api/creator/projects/${id}/versions/2`, { token: ownerToken });
  const v3After = await api('GET', `/api/creator/projects/${id}/versions/3`, { token: ownerToken });
  check(deepEqual(withoutCurrentFlag(v1After.data.version), withoutCurrentFlag(v1Before.data.version)), 'v1 is unchanged');
  check(deepEqual(withoutCurrentFlag(v2After.data.version), withoutCurrentFlag(v2Before.data.version)), 'v2 is unchanged');
  check(deepEqual(withoutCurrentFlag(v3After.data.version), withoutCurrentFlag(v3Before.data.version)), 'v3 is unchanged');

  // The restored state is a real, editable design: saving it appends v5.
  const layout5 = { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', 'after restore')] };
  const save5 = await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Restore Me', layout: layout5, theme: THEME_V2 },
  });
  check(save5.data.version === 5, `expected version 5 after restoring and editing, got ${save5.data.version}`);
});

test('restoring a version preserves its components, fonts, animation, background and effect', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Restore Round Trip' },
  });
  const id = create.data.project.id;
  const layout = {
    canvas: { width: 800, minHeight: 1000 },
    components: [textComponent('t1', 'restorable'), imageComponent('img1')],
  };
  await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: { name: 'Restore Round Trip', layout, theme: THEME_V2 },
  });
  // Move to v3 with different content.
  await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: {
      name: 'Restore Round Trip',
      layout: { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', 'different')] },
      theme: null,
    },
  });

  const restore = await api('POST', `/api/creator/projects/${id}/versions/2/restore`, { token: ownerToken });
  check(restore.data.version === 4, `expected version 4, got ${restore.data.version}`);

  const current = await api('GET', `/api/creator/projects/${id}`, { token: ownerToken });
  check(current.data.project.layout.canvas.width === 800, 'restored canvas width');
  check(current.data.project.layout.components.length === 2, 'restored component count');
  const text = current.data.project.layout.components.find(c => c.id === 't1');
  check(text.config.text === 'restorable', 'restored text content');
  check(text.config.fontFamily === 'serif', 'restored font');
  check(text.config.animation.name === 'fade-up', 'restored animation');
  check(current.data.project.theme.backgroundImage === 'https://example.com/bg-two.png', 'restored background image');
  check(current.data.project.theme.backgroundEffect.effectId === 'builtin.snow', 'restored effect');
});

test('restoring a missing version returns 404', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Restore Missing' },
  });
  const id = create.data.project.id;
  const res = await api('POST', `/api/creator/projects/${id}/versions/42/restore`, { token: ownerToken });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

group('isolation');

test('one project\'s versions are unreachable through another project\'s id', async () => {
  const createA = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Project A' },
  });
  const idA = createA.data.project.id;
  await api('POST', `/api/creator/projects/${idA}/save`, {
    token: ownerToken,
    body: {
      name: 'Project A',
      layout: { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', 'A only')] },
      theme: null,
    },
  });

  const createB = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Project B' },
  });
  const idB = createB.data.project.id;

  const history = await api('GET', `/api/creator/projects/${idB}/versions`, { token: ownerToken });
  check(history.data.versions.length === 1, 'project B has only its own v1');
  const cross = await api('GET', `/api/creator/projects/${idB}/versions/2`, { token: ownerToken });
  check(cross.status === 404, 'project A\'s v2 is not reachable via project B');
  const crossRestore = await api('POST', `/api/creator/projects/${idB}/versions/2/restore`, { token: ownerToken });
  check(crossRestore.status === 404, 'project A\'s v2 is not restorable via project B');
});

test('duplicating a project starts an independent history at v1', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Duplicate Source' },
  });
  const id = create.data.project.id;
  await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: {
      name: 'Duplicate Source',
      layout: { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', 'source text')] },
      theme: THEME_V2,
    },
  });

  const duplicate = await api('POST', `/api/creator/projects/${id}/duplicate`, { token: ownerToken });
  check(duplicate.status === 201, `expected 201, got ${duplicate.status}`);
  const copyId = duplicate.data.project.id;
  check(copyId !== id, 'the duplicate is a new project');
  check(duplicate.data.project.version === 1, 'the duplicate starts at v1');

  const history = await api('GET', `/api/creator/projects/${copyId}/versions`, { token: ownerToken });
  check(history.data.versions.length === 1, 'the duplicate has exactly one version');
  check(history.data.versions[0].version === 1, 'the duplicate\'s only version is v1');
  // The duplicate's v1 IS the source's current state (its creation state).
  const v1 = await api('GET', `/api/creator/projects/${copyId}/versions/1`, { token: ownerToken });
  check(v1.data.version.layout.components.length === 1, 'the duplicate\'s v1 carries the cloned layout');
  check(v1.data.version.layout.components[0].config.text === 'source text', 'the clone carries the source content');

  // The source's history is untouched by the duplicate's existence.
  const sourceHistory = await api('GET', `/api/creator/projects/${id}/versions`, { token: ownerToken });
  check(sourceHistory.data.versions.length === 2, 'the source keeps its own v1 and v2');
});

group('invariants');

test('publishing bumps the version AND writes a published save-point', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Publish Me' },
  });
  const id = create.data.project.id;
  await api('POST', `/api/creator/projects/${id}/save`, {
    token: ownerToken,
    body: {
      name: 'Publish Me',
      layout: { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', 'publish text')] },
      theme: THEME_V2,
    },
  });

  const publish = await api('POST', `/api/profile/design/${id}/publish`, { token: ownerToken, body: {} });
  check(publish.status === 200, `expected 200, got ${publish.status}`);
  check(publish.data.design.status === 'published', 'the design is published');
  check(publish.data.design.version === 3, `expected version 3, got ${publish.data.design.version}`);

  // The invariant: the current version always equals the highest saved version.
  const history = await api('GET', `/api/creator/projects/${id}/versions`, { token: ownerToken });
  const versions = history.data.versions;
  check(versions[0].version === 3, 'the highest saved version is 3');
  check(versions[0].is_current === true, 'v3 is current');
  check(versions[0].status === 'published', 'the published save-point records the published status');
  const row = projectRow(id);
  check(Number(row.version) === 3, 'the design row version equals the highest saved version');
});

test('version numbers are unique per design and never reused', async () => {
  const create = await api('POST', '/api/creator/projects', {
    token: ownerToken,
    body: { name: 'Unique Numbers' },
  });
  const id = create.data.project.id;
  for (let i = 0; i < 5; i += 1) {
    await api('POST', `/api/creator/projects/${id}/save`, {
      token: ownerToken,
      body: {
        name: 'Unique Numbers',
        layout: { canvas: { width: 960, minHeight: 1200 }, components: [textComponent('t1', `iteration ${i}`)] },
        theme: null,
      },
    });
  }
  const rows = versionRows(id);
  const numbers = rows.map(r => r.version);
  check(numbers.join(',') === '1,2,3,4,5,6', `expected 1..6, got ${numbers.join(',')}`);
  check(new Set(numbers).size === numbers.length, 'version numbers are unique');
});

group('migration');

test('a pre-CREATOR-15 design row is backfilled at its current version', async () => {
  // Simulate a design created before version history existed: a
  // profile_designs row with NO version rows and a version number
  // above 1 (e.g. it was published twice before CREATOR-15).
  const legacyId = randomUUID();
  const ts = new Date().toISOString();
  const legacyLayout = {
    canvas: { width: 960, minHeight: 1200 },
    components: [textComponent('legacy1', 'legacy content')],
  };
  const legacyTheme = { backgroundImage: 'https://example.com/legacy-bg.png' };
  database.execute(
    `INSERT INTO profile_designs
       (id, user_id, name, status, version, layout_config, theme_config, created_at, updated_at)
     VALUES (?, ?, 'Legacy Design', 'draft', 3, ?, ?, ?, ?)`,
    [legacyId, owner, JSON.stringify(legacyLayout), JSON.stringify(legacyTheme), ts, ts]
  );
  check(versionRows(legacyId).length === 0, 'the legacy row starts with no version rows');

  // Re-running init is the migration path: it must backfill exactly
  // one snapshot of the CURRENT state at the CURRENT version.
  await database.initDatabase();

  const rows = versionRows(legacyId);
  check(rows.length === 1, `expected exactly 1 backfilled version, got ${rows.length}`);
  check(rows[0].version === 3, `the backfill lands at the current version 3, got ${rows[0].version}`);
  check(deepEqual(JSON.parse(rows[0].layout_config), legacyLayout), 'the backfill snapshots the current layout');
  check(deepEqual(JSON.parse(rows[0].theme_config), legacyTheme), 'the backfill snapshots the current theme');

  // Idempotent: running the migration again must not duplicate history.
  await database.initDatabase();
  check(versionRows(legacyId).length === 1, 'the backfill is idempotent');

  // The backfilled version is fetchable through the API and is current.
  const fetched = await api('GET', `/api/creator/projects/${legacyId}/versions/3`, { token: ownerToken });
  check(fetched.status === 200, `expected 200, got ${fetched.status}`);
  check(fetched.data.version.is_current === true, 'the backfilled version is current');
  check(deepEqual(fetched.data.version.layout, legacyLayout), 'the API serves the backfilled layout');
});

// ── Runner ───────────────────────────────────────────────────────────
for (const step of queue) {
  await step();
}

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
process.stdout.write('\n════════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-15 VERSION HISTORY: ${passed}/${results.length} passed\n`);
if (failed > 0) {
  process.stdout.write(`FAILED: ${failed}\n`);
  for (const r of results.filter(r => !r.ok)) {
    process.stdout.write(`  - ${r.name}: ${r.error && r.error.message}\n`);
  }
}
process.stdout.write('[DB] Database connection closed\n');

try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(failed > 0 ? 1 : 0);
