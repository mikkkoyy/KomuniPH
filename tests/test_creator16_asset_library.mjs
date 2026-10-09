/**
 * CREATOR-16 — Persistent Asset Library.
 *
 * Run:   node tests/test_creator16_asset_library.mjs
 *        npm run test:creator16
 *
 * The Asset Library is a creator-scoped registry of REFERENCE items: an item
 * stores a source type + source id + lightweight metadata, never a copy of
 * the underlying asset. This suite pins:
 *
 *   - auth: every library route requires authentication.
 *   - registration: all seven supported source types register and list;
 *     registration is idempotent (a duplicate is a 409 and creates no
 *     second record).
 *   - listing: search (q over name/description, literal LIKE), source-type
 *     filter, sort (newest/oldest/name) and limit/offset pagination with a
 *     total count, exactly as implemented.
 *   - updates: rename and permitted metadata edits persist; omitted
 *     optional fields are preserved; source type/id are immutable;
 *     unsupported fields are rejected, never ignored.
 *   - validation: bad source types/ids/URLs/markup/metadata and nonexistent
 *     sources are rejected. Owner identity comes from the token, never the
 *     payload.
 *   - ownership: cross-user read/modify/delete is 404 (never 403) and a
 *     second creator cannot register another creator's private sources.
 *   - reference-only deletion: removing an entry (single or batch) never
 *     touches the uploaded file, the project, its version history, the
 *     effect package or the creator product.
 *   - migration: re-running initDatabase preserves valid records without
 *     duplication.
 *
 * Every fixture is throwaway: a temp SQLite database, temp upload
 * directories, freshly registered users, a 1x1 PNG, and real .kpeffect
 * packages built with tests/_zip.js. The live database and real user
 * uploads are never touched.
 */

import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { buildZip, goodManifest, goodDefinition } from './_zip.js';

// ── Environment (MUST be set before any server/config import) ──────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-creator16-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-creator16.db');
process.env.PORT = String(19700 + (process.pid % 300));
process.env.SECRET_KEY = 'creator-16-test-secret-key-that-is-long-enough';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
// Isolated upload storage — the real uploads/ tree is never written to.
process.env.UPLOAD_CREATOR_DIR = join(TMP_DIR, 'uploads-creator');
process.env.UPLOAD_CREATOR_EFFECT_DIR = join(TMP_DIR, 'uploads-creator-effects');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const CREATOR_UPLOAD_DIR = resolve(process.env.UPLOAD_CREATOR_DIR);

// ── Imports (server modules resolve config from the env above) ─────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const auth = await import(mod('server/auth.js'));
await import(mod('server/index.js')); // boots the HTTP server

// ── Tiny test harness (mirrors test_creator15_project_versions.mjs) ─────
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

function eq(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────────
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
  try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, data };
}

/** POST multipart/form-data with one file part (real upload pipeline). */
async function uploadPart(path, token, fieldName, filename, bytes, type) {
  const fd = new FormData();
  fd.append(fieldName, new Blob([bytes], { type }), filename);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const data = await res.json().catch(() => null);
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

function libraryRows(userId) {
  return database.queryAll(
    'SELECT * FROM creator_library_items WHERE creator_user_id = ?',
    [userId]
  );
}

function libraryRow(id) {
  return database.queryOne('SELECT * FROM creator_library_items WHERE id = ?', [id]);
}

function uploadedFilePath(url) {
  const name = String(url).replace(/^\/uploads\/creator\//, '');
  return join(CREATOR_UPLOAD_DIR, name);
}

function tinyPng() {
  const png = new PNG({ width: 1, height: 1 });
  png.data = Buffer.from([200, 40, 90, 255]);
  return PNG.sync.write(png);
}

/** A minimal valid .kpeffect package for a given manifest id. */
function effectPackage(manifestId, name) {
  return buildZip([
    { name: 'manifest.json', data: JSON.stringify(goodManifest({ id: manifestId, name })) },
    { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
  ]);
}

// ── Seed fixtures (real endpoints, throwaway data) ─────────────────────
const owner = createUserWithProfile('c16-owner');
const ownerToken = tokenFor(owner);
const other = createUserWithProfile('c16-other');
const otherToken = tokenFor(other);

// Uploaded media (the real re-encoding pipeline).
const mediaUpload = await uploadPart('/api/creator/media', ownerToken, 'image', 'fixture.png', tinyPng(), 'image/png');
if (mediaUpload.status !== 201) throw new Error(`seed media upload failed: ${mediaUpload.status} ${JSON.stringify(mediaUpload.data)}`);
const media = mediaUpload.data;
check(typeof media.id === 'string' && media.id, 'the upload response carries a media id');
check(typeof media.url === 'string' && media.url.startsWith('/uploads/creator/'), 'the upload response carries its app URL');

const otherMediaUpload = await uploadPart('/api/creator/media', otherToken, 'image', 'other.png', tinyPng(), 'image/png');
if (otherMediaUpload.status !== 201) throw new Error(`seed other media upload failed: ${otherMediaUpload.status}`);
const otherMedia = otherMediaUpload.data;

/** Create a creator_assets row through the real API. */
async function createAsset(token, name, assetType, imageUrl) {
  const res = await api('POST', '/api/creator/assets', {
    token,
    body: { name, asset_type: assetType, asset_data: { imageUrl, fit: 'cover' } },
  });
  if (res.status !== 201) throw new Error(`seed asset "${name}" failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.asset;
}

const bgAsset = await createAsset(ownerToken, 'C16 Background', 'background', 'https://example.com/c16-bg.png');
const stickerAsset = await createAsset(ownerToken, 'C16 Sticker', 'sticker', 'https://example.com/c16-sticker.png');
const decoAsset = await createAsset(ownerToken, 'C16 Decoration', 'decoration', 'https://example.com/c16-deco.png');

// A published creator product (create -> submit -> publish).
const product = await createAsset(ownerToken, 'C16 Product', 'background', 'https://example.com/c16-product.png');
const submitRes = await api('POST', `/api/creator/assets/${product.id}/submit`, { token: ownerToken });
if (submitRes.status !== 200) throw new Error(`seed product submit failed: ${submitRes.status}`);
const publishRes = await api('POST', `/api/creator/assets/${product.id}/publish`, { token: ownerToken });
if (publishRes.status !== 200) throw new Error(`seed product publish failed: ${publishRes.status}`);
const publishedProduct = publishRes.data.asset;

// A draft product (never submitted) for status-rule tests.
const draftProduct = await createAsset(ownerToken, 'C16 Draft Product', 'background', 'https://example.com/c16-draft.png');

// Imported .kpeffect packages (imports install as 'published').
async function importEffect(token, manifestId, name) {
  const res = await uploadPart('/api/creator/effects/import', token, 'package', `${manifestId}.kpeffect`, effectPackage(manifestId, name), 'application/octet-stream');
  if (res.status !== 201) throw new Error(`seed effect "${manifestId}" failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

const effect = await importEffect(ownerToken, 'creator.snowfall', 'C16 Snowfall');
const archivedEffect = await importEffect(ownerToken, 'creator.rainfall', 'C16 Rainfall');
const archiveRes = await api('POST', `/api/creator/effects/${archivedEffect.id}/archive`, { token: ownerToken });
if (archiveRes.status !== 200) throw new Error(`seed effect archive failed: ${archiveRes.status}`);

// Projects (a project IS a profile_designs row).
async function createProject(token, name) {
  const res = await api('POST', '/api/creator/projects', { token, body: { name } });
  if (res.status !== 201) throw new Error(`seed project "${name}" failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.project;
}

const projectA = await createProject(ownerToken, 'C16 Project Alpha');
const projectB = await createProject(ownerToken, 'C16 Project Beta');
const otherProject = await createProject(otherToken, 'C16 Other Project');

// Save a second version of projectA so version-history integrity is observable.
const saveRes = await api('POST', `/api/creator/projects/${projectA.id}/save`, {
  token: ownerToken,
  body: {
    name: 'C16 Project Alpha',
    layout: {
      canvas: { width: 960, minHeight: 1200 },
      components: [{
        id: 'c16seedtext', type: 'text', x: 50, y: 60, width: 300, height: 80, zIndex: 1,
        visible: true, locked: false, rotation: 0, style: null,
        config: { text: 'C16 seeded version two' },
      }],
    },
    theme: { backgroundImage: '' },
  },
});
if (saveRes.status !== 200) throw new Error(`seed project save failed: ${saveRes.status} ${JSON.stringify(saveRes.data)}`);

const IMG_URL = media.url; // /uploads/creator/<generated>.webp

// ── Tests ──────────────────────────────────────────────────────────────

group('auth');

test('list requires authentication', async () => {
  const res = await api('GET', '/api/creator/library');
  eq(res.status, 401, 'unauthenticated list');
});

test('create requires authentication', async () => {
  const res = await api('POST', '/api/creator/library', { body: { name: 'x', source_type: 'image', source_id: 'y' } });
  eq(res.status, 401, 'unauthenticated create');
});

test('fetch requires authentication', async () => {
  const res = await api('GET', '/api/creator/library/anything');
  eq(res.status, 401, 'unauthenticated fetch');
});

test('update requires authentication', async () => {
  const res = await api('PATCH', '/api/creator/library/anything', { body: { name: 'x' } });
  eq(res.status, 401, 'unauthenticated update');
});

test('delete requires authentication', async () => {
  const res = await api('DELETE', '/api/creator/library/anything');
  eq(res.status, 401, 'unauthenticated delete');
});

test('batch delete requires authentication', async () => {
  const res = await api('POST', '/api/creator/library/batch-delete', { body: { ids: ['x'] } });
  eq(res.status, 401, 'unauthenticated batch delete');
});

// ── Registration (every supported source type) ─────────────────────────

group('registration');

let imageItem = null;

test('an uploaded image registers and lists', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: {
      name: 'My Uploaded Image',
      description: 'The seeded 1x1 png',
      source_type: 'image',
      source_id: media.id,
      preview_url: IMG_URL,
      metadata: { fit: 'cover' },
    },
  });
  eq(res.status, 201, 'image registration');
  imageItem = res.data.item;
  eq(imageItem.name, 'My Uploaded Image', 'name round-trips');
  eq(imageItem.description, 'The seeded 1x1 png', 'description round-trips');
  eq(imageItem.source_type, 'image', 'source type');
  eq(imageItem.source_id, media.id, 'source id is the media id');
  eq(imageItem.preview_url, IMG_URL, 'preview url round-trips');
  eq(imageItem.metadata && imageItem.metadata.fit, 'cover', 'metadata round-trips');
  check(imageItem.created_at && imageItem.updated_at, 'timestamps are present');
});

test('a background creator asset registers', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'My Background', source_type: 'background', source_id: bgAsset.id, preview_url: 'https://example.com/c16-bg.png' },
  });
  eq(res.status, 201, 'background registration');
  eq(res.data.item.source_type, 'background', 'background type');
});

test('a sticker creator asset registers', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'My Sticker', source_type: 'sticker', source_id: stickerAsset.id },
  });
  eq(res.status, 201, 'sticker registration');
  eq(res.data.item.source_type, 'sticker', 'sticker type');
});

test('a decoration creator asset registers', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'My Decoration', source_type: 'decoration', source_id: decoAsset.id },
  });
  eq(res.status, 201, 'decoration registration');
  eq(res.data.item.source_type, 'decoration', 'decoration type');
});

let effectItem = null;

test('a published effect registers by effect_id', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'My Snowfall Effect', source_type: 'effect', source_id: effect.effectId, metadata: { engine: 'particles' } },
  });
  eq(res.status, 201, 'effect registration');
  effectItem = res.data.item;
  eq(effectItem.source_id, effect.effectId, 'the effect is referenced by effect_id, not row id');
});

test('a project registers', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'My Project Entry', source_type: 'project', source_id: projectB.id },
  });
  eq(res.status, 201, 'project registration');
  eq(res.data.item.source_id, projectB.id, 'project source id');
});

test('a published creator product registers as creator_asset', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'My Product Entry', source_type: 'creator_asset', source_id: publishedProduct.id },
  });
  eq(res.status, 201, 'creator_asset registration');
  eq(res.data.item.source_id, publishedProduct.id, 'product source id');
});

test('the unfiltered list returns every registered type', async () => {
  const res = await api('GET', '/api/creator/library?limit=100', { token: ownerToken });
  eq(res.status, 200, 'list');
  const types = new Set(res.data.items.map(i => i.source_type));
  for (const t of ['image', 'background', 'sticker', 'decoration', 'effect', 'project', 'creator_asset']) {
    check(types.has(t), `the list contains a "${t}" item`);
  }
  eq(res.data.total, res.data.items.length, 'total matches the returned page');
});

// ── Idempotency ────────────────────────────────────────────────────────

group('idempotency');

test('registering the same source twice is a 409, not a second record', async () => {
  const before = libraryRows(owner).length;
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'My Uploaded Image (copy attempt)', source_type: 'image', source_id: media.id, preview_url: IMG_URL },
  });
  eq(res.status, 409, 'duplicate registration');
  eq(libraryRows(owner).length, before, 'no record was added');
});

test('a duplicate under a different name still creates no duplicate record', async () => {
  const rows = libraryRows(owner).filter(r => r.source_type === 'image' && r.source_id === media.id);
  eq(rows.length, 1, 'exactly one row exists for the (owner, image, media) triple');
  eq(rows[0].name, 'My Uploaded Image', 'the original name survived the duplicate attempt');
});

// ── Search / filter / sort / pagination ────────────────────────────────

group('search, filter, sort, pagination');

// Five dedicated page-fixture projects + entries for deterministic paging.
for (const label of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) {
  const p = await createProject(ownerToken, `C16 Page ${label}`);
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: `Page ${label}`, description: `pagination fixture ${label}`, source_type: 'project', source_id: p.id },
  });
  if (res.status !== 201) throw new Error(`seed page fixture ${label} failed: ${res.status}`);
}

test('filtering by source_type returns only that type', async () => {
  const res = await api('GET', '/api/creator/library?source_type=image', { token: ownerToken });
  eq(res.status, 200, 'filtered list');
  check(res.data.items.length >= 1, 'the image filter returns at least the seeded image');
  check(res.data.items.every(i => i.source_type === 'image'), 'every item matches the filter');
});

test('q matches the name (case-insensitive)', async () => {
  const res = await api('GET', `/api/creator/library?q=${encodeURIComponent('SNOWFALL')}`, { token: ownerToken });
  eq(res.status, 200, 'search by name');
  check(res.data.items.some(i => i.id === effectItem.id), 'the snowfall effect is found by an uppercase query');
  check(res.data.items.every(i =>
    i.name.toLowerCase().includes('snowfall') || (i.description || '').toLowerCase().includes('snowfall')
  ), 'every hit genuinely matches the query');
});

test('q matches the description', async () => {
  const res = await api('GET', '/api/creator/library?q=pagination%20fixture%20delta', { token: ownerToken });
  eq(res.status, 200, 'search by description');
  eq(res.data.items.length, 1, 'exactly the Delta fixture matches');
  eq(res.data.items[0].name, 'Page Delta', 'the Delta fixture is the hit');
});

test('q treats LIKE wildcards literally', async () => {
  const res = await api('GET', `/api/creator/library?q=${encodeURIComponent('%')}`, { token: ownerToken });
  eq(res.status, 200, 'wildcard search');
  eq(res.data.items.length, 0, 'a literal percent sign matches nothing');
});

test('q is combined with the type filter', async () => {
  const res = await api('GET', '/api/creator/library?q=Page&source_type=image', { token: ownerToken });
  eq(res.status, 200, 'combined query');
  eq(res.data.items.length, 0, 'no image is named Page');
});

test('sort=name returns items ordered by name', async () => {
  const res = await api('GET', '/api/creator/library?q=Page&sort=name&limit=100', { token: ownerToken });
  eq(res.status, 200, 'name sort');
  const names = res.data.items.map(i => i.name);
  const sorted = [...names].sort();
  eq(names.join('|'), sorted.join('|'), 'names are ascending');
});

test('sort=newest and sort=oldest are exact reverses', async () => {
  const newest = await api('GET', '/api/creator/library?q=Page&sort=newest&limit=100', { token: ownerToken });
  const oldest = await api('GET', '/api/creator/library?q=Page&sort=oldest&limit=100', { token: ownerToken });
  eq(newest.status, 200, 'newest sort');
  eq(oldest.status, 200, 'oldest sort');
  const newestIds = newest.data.items.map(i => i.id);
  const oldestIds = oldest.data.items.map(i => i.id).reverse();
  eq(newestIds.join(','), oldestIds.join(','), 'the two orderings are reverses');
});

test('an unknown sort falls back to the default', async () => {
  const res = await api('GET', '/api/creator/library?q=Page&sort=bogus&limit=100', { token: ownerToken });
  eq(res.status, 200, 'bogus sort is tolerated');
  eq(res.data.sort, 'newest', 'the response reports the effective sort');
});

test('pagination walks the collection with limit/offset and a total', async () => {
  const first = await api('GET', '/api/creator/library?q=Page&sort=name&limit=2&offset=0', { token: ownerToken });
  eq(first.status, 200, 'page 1');
  eq(first.data.items.length, 2, 'page 1 size');
  eq(first.data.total, 5, 'the total counts the whole filtered collection');
  eq(first.data.offset, 0, 'page 1 offset');

  const second = await api('GET', '/api/creator/library?q=Page&sort=name&limit=2&offset=2', { token: ownerToken });
  eq(second.data.items.length, 2, 'page 2 size');
  const third = await api('GET', '/api/creator/library?q=Page&sort=name&limit=2&offset=4', { token: ownerToken });
  eq(third.data.items.length, 1, 'page 3 size');

  const walked = [...first.data.items, ...second.data.items, ...third.data.items].map(i => i.id);
  eq(new Set(walked).size, 5, 'paging never repeats or drops an item');
});

test('garbage limit/offset values do not break the list', async () => {
  const res = await api('GET', '/api/creator/library?limit=abc&offset=-5', { token: ownerToken });
  eq(res.status, 200, 'garbage paging params');
  check(Array.isArray(res.data.items), 'items still arrive');
});

// ── Updates ────────────────────────────────────────────────────────────

group('update');

test('a rename persists', async () => {
  const res = await api('PATCH', `/api/creator/library/${imageItem.id}`, {
    token: ownerToken,
    body: { name: 'My Renamed Image' },
  });
  eq(res.status, 200, 'rename');
  eq(res.data.item.name, 'My Renamed Image', 'the new name is returned');
  eq(libraryRow(imageItem.id).name, 'My Renamed Image', 'the new name is persisted');
});

test('a rename preserves preview_url and metadata', async () => {
  const row = libraryRow(imageItem.id);
  eq(row.preview_url, IMG_URL, 'preview_url survived the rename');
  eq(JSON.parse(row.metadata_json).fit, 'cover', 'metadata survived the rename');
});

test('a metadata update persists', async () => {
  const res = await api('PATCH', `/api/creator/library/${imageItem.id}`, {
    token: ownerToken,
    body: { metadata: { fit: 'contain', note: 'reusable hero image' } },
  });
  eq(res.status, 200, 'metadata update');
  const meta = JSON.parse(libraryRow(imageItem.id).metadata_json);
  eq(meta.fit, 'contain', 'the new fit is stored');
  eq(meta.note, 'reusable hero image', 'the extra key is stored');
});

test('an explicit null metadata clears the field', async () => {
  const res = await api('PATCH', `/api/creator/library/${imageItem.id}`, {
    token: ownerToken,
    body: { metadata: null },
  });
  eq(res.status, 200, 'metadata clear');
  eq(libraryRow(imageItem.id).metadata_json, null, 'metadata is cleared');
});

test('an explicit empty preview_url clears the field; a new one persists', async () => {
  const cleared = await api('PATCH', `/api/creator/library/${imageItem.id}`, {
    token: ownerToken,
    body: { preview_url: '' },
  });
  eq(cleared.status, 200, 'preview clear');
  eq(libraryRow(imageItem.id).preview_url, null, 'preview is cleared');

  const set = await api('PATCH', `/api/creator/library/${imageItem.id}`, {
    token: ownerToken,
    body: { preview_url: '/uploads/creator/re-set.webp' },
  });
  eq(set.status, 200, 'preview set');
  eq(libraryRow(imageItem.id).preview_url, '/uploads/creator/re-set.webp', 'the new preview is stored');
});

test('source_type and source_id are immutable after creation', async () => {
  const byType = await api('PATCH', `/api/creator/library/${imageItem.id}`, {
    token: ownerToken,
    body: { source_type: 'project' },
  });
  eq(byType.status, 409, 'source type changes are refused');

  const byId = await api('PATCH', `/api/creator/library/${imageItem.id}`, {
    token: ownerToken,
    body: { source_id: projectA.id },
  });
  eq(byId.status, 409, 'source id changes are refused');
  eq(libraryRow(imageItem.id).source_type, 'image', 'the row is untouched');
  eq(libraryRow(imageItem.id).source_id, media.id, 'the source id is untouched');
});

test('unsupported update fields are rejected, not ignored', async () => {
  const res = await api('PATCH', `/api/creator/library/${imageItem.id}`, {
    token: ownerToken,
    body: { creator_user_id: other, name: 'Hijack Attempt' },
  });
  eq(res.status, 400, 'unsupported fields are a 400');
  check(String(res.data.error.message).includes('Unsupported field: creator_user_id'), 'the error names the field');
  eq(libraryRow(imageItem.id).name, 'My Renamed Image', 'the rejected patch changed nothing');
});

test('an empty update is refused', async () => {
  const res = await api('PATCH', `/api/creator/library/${imageItem.id}`, { token: ownerToken, body: {} });
  eq(res.status, 400, 'nothing to update');
});

// ── Validation ─────────────────────────────────────────────────────────

group('validation');

test('an unsupported source type is rejected', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Music Thing', source_type: 'music', source_id: 'track-1' },
  });
  eq(res.status, 400, 'music is not a supported source type');
  check(String(res.data.error.message).includes('Unsupported source type'), 'the error names the problem');
});

test('missing required fields are rejected', async () => {
  const noName = await api('POST', '/api/creator/library', { token: ownerToken, body: { source_type: 'image', source_id: media.id } });
  eq(noName.status, 400, 'name is required');
  const noType = await api('POST', '/api/creator/library', { token: ownerToken, body: { name: 'x', source_id: media.id } });
  eq(noType.status, 400, 'source type is required');
  const noId = await api('POST', '/api/creator/library', { token: ownerToken, body: { name: 'x', source_type: 'image' } });
  eq(noId.status, 400, 'source id is required');
});

test('markup in name or description is rejected', async () => {
  const byName = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: '<script>alert(1)</script>', source_type: 'image', source_id: media.id },
  });
  eq(byName.status, 400, 'markup names are rejected');
  const byDescription = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Fine name', description: '<iframe src=x>', source_type: 'image', source_id: media.id },
  });
  eq(byDescription.status, 400, 'markup descriptions are rejected');
});

test('an invalid preview_url is rejected', async () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<h1>x', 'ftp://example.com/x.png']) {
    const res = await api('POST', '/api/creator/library', {
      token: ownerToken,
      body: { name: 'Bad Preview', source_type: 'project', source_id: projectA.id, preview_url: bad },
    });
    eq(res.status, 400, `preview_url "${bad}" is rejected`);
  }
});

test('malformed metadata is rejected', async () => {
  const asArray = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Meta', source_type: 'image', source_id: media.id, metadata: ['nope'] },
  });
  eq(asArray.status, 400, 'array metadata is rejected');

  const tooBig = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Meta', source_type: 'image', source_id: media.id, metadata: { blob: 'x'.repeat(70 * 1024) } },
  });
  eq(tooBig.status, 400, 'oversized metadata is rejected');

  const badFit = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Meta', source_type: 'image', source_id: media.id, metadata: { fit: 'stretch' } },
  });
  eq(badFit.status, 400, 'an unknown metadata.fit is rejected');
});

test('a nonexistent image source is rejected', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Ghost Image', source_type: 'image', source_id: randomUUID() },
  });
  eq(res.status, 400, 'unknown media id');
});

test('a nonexistent project source is rejected', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Ghost Project', source_type: 'project', source_id: randomUUID() },
  });
  eq(res.status, 400, 'unknown project id');
});

test('an effect referenced by row id (not effect_id) is rejected', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Row Id Effect', source_type: 'effect', source_id: effect.id },
  });
  eq(res.status, 400, 'the row id is not the reference key');
});

test('an archived effect cannot be registered', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Archived Effect', source_type: 'effect', source_id: archivedEffect.effectId },
  });
  eq(res.status, 400, 'only published effects are registerable');
});

test('a draft creator product cannot be registered as creator_asset', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Draft Product Entry', source_type: 'creator_asset', source_id: draftProduct.id },
  });
  eq(res.status, 400, 'only published products are registerable');
});

// ── Ownership ──────────────────────────────────────────────────────────

group('ownership');

test('owner identity is derived from the token, not the payload', async () => {
  const res = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Spoof Attempt', source_type: 'project', source_id: projectB.id, creator_user_id: other },
  });
  eq(res.status, 400, 'a creator_user_id field in the payload is rejected');
  const spoofed = libraryRows(other).filter(r => r.name === 'Spoof Attempt');
  eq(spoofed.length, 0, 'the other user owns nothing from this request');
});

test('another creator cannot register my image, project, effect or product', async () => {
  const attempts = [
    { name: 'Steal Image', source_type: 'image', source_id: media.id },
    { name: 'Steal Project', source_type: 'project', source_id: projectA.id },
    { name: 'Steal Effect', source_type: 'effect', source_id: effect.effectId },
    { name: 'Steal Product', source_type: 'creator_asset', source_id: publishedProduct.id },
    { name: 'Steal Background', source_type: 'background', source_id: bgAsset.id },
  ];
  for (const body of attempts) {
    const res = await api('POST', '/api/creator/library', { token: otherToken, body });
    eq(res.status, 400, `"${body.name}" must not be registerable by a stranger`);
    check(String(res.data.error.message).includes('not found or not owned'), 'the error is a source-existence answer, not an id leak');
  }
});

let otherItem = null;

test("another creator can register their OWN private source", async () => {
  const res = await api('POST', '/api/creator/library', {
    token: otherToken,
    body: { name: 'Other Own Image', source_type: 'image', source_id: otherMedia.id, preview_url: otherMedia.url },
  });
  eq(res.status, 201, 'own-source registration');
  otherItem = res.data.item;
});

test('another creator cannot read my item (404, never 403)', async () => {
  const res = await api('GET', `/api/creator/library/${imageItem.id}`, { token: otherToken });
  eq(res.status, 404, 'cross-user fetch is a 404');
});

test('another creator cannot modify my item', async () => {
  const res = await api('PATCH', `/api/creator/library/${imageItem.id}`, {
    token: otherToken,
    body: { name: 'Taken Over' },
  });
  eq(res.status, 404, 'cross-user patch is a 404');
  eq(libraryRow(imageItem.id).name, 'My Renamed Image', 'my item is unchanged');
});

test('another creator cannot delete my item', async () => {
  const res = await api('DELETE', `/api/creator/library/${imageItem.id}`, { token: otherToken });
  eq(res.status, 404, 'cross-user delete is a 404');
  check(libraryRow(imageItem.id), 'my item still exists');
});

test('the list is strictly owner-scoped', async () => {
  const mine = await api('GET', '/api/creator/library?limit=100', { token: ownerToken });
  const theirs = await api('GET', '/api/creator/library?limit=100', { token: otherToken });
  const mineIds = new Set(mine.data.items.map(i => i.id));
  check(!theirs.data.items.some(i => mineIds.has(i.id)), "the other creator's list never leaks my entries");
  eq(theirs.data.items.length, 1, "the other creator sees only their own entry");
  eq(theirs.data.items[0].id, otherItem.id, 'and it is the one they registered');
});

// ── Reference-only deletion ────────────────────────────────────────────

group('reference-only deletion');

test('deleting an image entry removes only the reference', async () => {
  const itemId = imageItem.id;
  const res = await api('DELETE', `/api/creator/library/${itemId}`, { token: ownerToken });
  eq(res.status, 200, 'delete');
  eq(res.data.success, true, 'delete reports success');
  check(!libraryRow(itemId), 'the reference is gone');

  const mediaRow = database.queryOne('SELECT * FROM creator_media WHERE id = ?', [media.id]);
  check(mediaRow, 'the creator_media record survived');
  eq(mediaRow.url, IMG_URL, 'and still points at the uploaded file');
  check(existsSync(uploadedFilePath(IMG_URL)), 'the uploaded file still exists on disk');
});

test('deleting a project entry keeps the project and its version history', async () => {
  // Register projectA, then remove the entry and verify the design + history.
  const reg = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Alpha Entry', source_type: 'project', source_id: projectA.id },
  });
  eq(reg.status, 201, 'project entry registered');

  const res = await api('DELETE', `/api/creator/library/${reg.data.item.id}`, { token: ownerToken });
  eq(res.status, 200, 'project entry deleted');

  const design = database.queryOne('SELECT * FROM profile_designs WHERE id = ? AND deleted_at IS NULL', [projectA.id]);
  check(design, 'the project itself survived');
  const versions = database.queryAll(
    'SELECT * FROM profile_design_versions WHERE design_id = ? ORDER BY version ASC', [projectA.id]
  );
  eq(versions.length, 2, 'both versions are intact');
  const v2 = JSON.parse(versions[1].layout_config);
  eq(v2.components[0].config.text, 'C16 seeded version two', 'the version-2 snapshot is untouched');
});

test('deleting an effect entry keeps the effect and its package storage', async () => {
  const res = await api('DELETE', `/api/creator/library/${effectItem.id}`, { token: ownerToken });
  eq(res.status, 200, 'effect entry deleted');
  const effectRow = database.queryOne('SELECT * FROM creator_effects WHERE id = ?', [effect.id]);
  check(effectRow, 'the effect row survived');
  eq(effectRow.status, 'published', 'and is still published');
  const storageDir = join(resolve(process.env.UPLOAD_CREATOR_EFFECT_DIR), effectRow.storage_dir);
  check(existsSync(storageDir), 'the installed package directory still exists');
});

test('deleting a creator_asset entry keeps the product lifecycle untouched', async () => {
  // The registration group already registered this product — reuse that entry.
  const list = await api('GET', '/api/creator/library?source_type=creator_asset&limit=100', { token: ownerToken });
  const entry = list.data.items.find(i => i.source_id === publishedProduct.id);
  check(entry, 'the product entry exists before deletion');

  const res = await api('DELETE', `/api/creator/library/${entry.id}`, { token: ownerToken });
  eq(res.status, 200, 'product entry deleted');

  const productRow = database.queryOne('SELECT * FROM creator_assets WHERE id = ?', [publishedProduct.id]);
  check(productRow, 'the product survived');
  eq(productRow.status, 'published', 'still published');
  eq(productRow.version, publishedProduct.version, 'the version is unchanged');
});

test('deleting background/sticker/decoration entries keeps the assets', async () => {
  const list = await api('GET', '/api/creator/library?limit=100', { token: ownerToken });
  const byKey = (t, sid) => list.data.items.find(i => i.source_type === t && i.source_id === sid);
  for (const [type, asset] of [['background', bgAsset], ['sticker', stickerAsset], ['decoration', decoAsset]]) {
    const item = byKey(type, asset.id);
    check(item, `the ${type} entry exists before deletion`);
    const res = await api('DELETE', `/api/creator/library/${item.id}`, { token: ownerToken });
    eq(res.status, 200, `${type} entry deleted`);
    const row = database.queryOne('SELECT * FROM creator_assets WHERE id = ?', [asset.id]);
    check(row, `the ${type} asset survived`);
    eq(row.asset_type, type, 'and keeps its type');
  }
});

// ── Batch deletion ─────────────────────────────────────────────────────

group('batch deletion');

test('batch delete validates its input', async () => {
  const noIds = await api('POST', '/api/creator/library/batch-delete', { token: ownerToken, body: {} });
  eq(noIds.status, 400, 'missing ids');

  const notArray = await api('POST', '/api/creator/library/batch-delete', { token: ownerToken, body: { ids: 'x' } });
  eq(notArray.status, 400, 'ids must be an array');

  const empty = await api('POST', '/api/creator/library/batch-delete', { token: ownerToken, body: { ids: [] } });
  eq(empty.status, 400, 'empty ids');

  const tooMany = await api('POST', '/api/creator/library/batch-delete', {
    token: ownerToken,
    body: { ids: Array.from({ length: 101 }, () => randomUUID()) },
  });
  eq(tooMany.status, 400, 'more than 100 ids');

  const badElement = await api('POST', '/api/creator/library/batch-delete', { token: ownerToken, body: { ids: ['ok', 42] } });
  eq(badElement.status, 400, 'non-string id elements');
});

test('batch delete removes only entries I own and never the sources', async () => {
  // Fresh disposable entries: two of mine, plus the other user's single entry.
  const p1 = await createProject(ownerToken, 'C16 Batch P1');
  const p2 = await createProject(ownerToken, 'C16 Batch P2');
  const e1 = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Batch 1', source_type: 'project', source_id: p1.id },
  });
  const e2 = await api('POST', '/api/creator/library', {
    token: ownerToken,
    body: { name: 'Batch 2', source_type: 'project', source_id: p2.id },
  });
  eq(e1.status, 201, 'batch fixture 1');
  eq(e2.status, 201, 'batch fixture 2');

  const res = await api('POST', '/api/creator/library/batch-delete', {
    token: ownerToken,
    body: { ids: [e1.data.item.id, e2.data.item.id, otherItem.id, randomUUID()] },
  });
  eq(res.status, 200, 'mixed batch delete');
  check(!libraryRow(e1.data.item.id), 'owned entry 1 removed');
  check(!libraryRow(e2.data.item.id), 'owned entry 2 removed');
  check(libraryRow(otherItem.id), "the other creator's entry was NOT removed");

  check(database.queryOne('SELECT id FROM profile_designs WHERE id = ?', [p1.id]), 'source project 1 survives');
  check(database.queryOne('SELECT id FROM profile_designs WHERE id = ?', [p2.id]), 'source project 2 survives');
});

// ── Persistence / migration ────────────────────────────────────────────

group('persistence');

test('re-running initDatabase preserves records without duplication', async () => {
  const before = libraryRows(owner).map(r => r.id).sort();
  check(before.length > 0, 'there are records to preserve');

  await database.initDatabase();

  const after = libraryRows(owner).map(r => r.id).sort();
  eq(after.join(','), before.join(','), 'the same records survive, unchanged and unduplicated');
  const total = libraryRows(owner).length;
  eq(new Set(after).size, total, 'no id appears twice');
});

// ── Runner ─────────────────────────────────────────────────────────────
for (const step of queue) {
  await step();
}

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
process.stdout.write('\n════════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-16 ASSET LIBRARY: ${passed}/${results.length} passed\n`);
if (failed > 0) {
  process.stdout.write(`FAILED: ${failed}\n`);
  for (const r of results.filter(r => !r.ok)) {
    process.stdout.write(`  - ${r.name}: ${r.error && r.error.message}\n`);
  }
}
process.stdout.write('[DB] Database connection closed\n');

try { database.closeDatabase(); } catch { /* best effort */ }
try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(failed > 0 ? 1 : 0);













