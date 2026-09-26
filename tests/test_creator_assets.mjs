/**
 * CREATOR-02 — Creator Asset Publishing Foundation test suite.
 *
 * Run:   npm run test:assets
 *
 * Covers:
 *   - lifecycle: create (draft) -> update -> submit -> publish -> archive
 *   - ownership: owner succeeds, second user denied, admin can archive,
 *     unauthenticated requests are 401
 *   - validation: asset type, payload contract, dangerous markup, unsafe
 *     image URLs (javascript:/data:), oversized payloads, price rules,
 *     version/status spoofing
 *   - profile design integration: a personal design becomes an asset snapshot
 *     without replacing the user's active personal profile design
 *
 * Uses a throwaway SQLite database under the OS temp directory, so the live
 * data/komuniph.db is never touched.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-assets-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-assets.db');
process.env.PORT = String(19700 + (process.pid % 1200));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-02-test-webhook-secret';
process.env.SECRET_KEY = 'creator-02-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'asset-admin';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ── Imports (server modules resolve config from the env above) ──────────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const auth = await import(mod('server/auth.js'));
const creatorAssets = await import(mod('server/creatorAssets.js'));
await import(mod('server/index.js')); // boots the HTTP server

await database.seedAdminUser();

// ── Tiny test harness (mirrors test_coins.mjs / test_creator_studio.mjs) ─────
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

// ── HTTP helper ─────────────────────────────────────────────────────────────
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

// ── Fixtures ────────────────────────────────────────────────────────────────
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

function assetRow(assetId) {
  return database.queryOne('SELECT * FROM creator_assets WHERE id = ?', [assetId]);
}

/** A small, fully valid profile_design snapshot the studio produces. */
function designSnapshot() {
  return {
    layout: {
      canvas: { width: 960, minHeight: 1200 },
      components: [
        {
          id: 'c-head',
          type: 'text',
          x: 40, y: 40, width: 320, height: 96, zIndex: 1,
          visible: true, locked: false,
          rotation: 0,
          style: { background: '#0e6e6e', textColor: '#ffffff' },
          config: { text: 'Hello world', fontSize: 24, textAlign: 'left' },
        },
      ],
    },
    theme: { backgroundColor: '#0f172a', textColor: '#e6eaf2', accentColor: '#14b8a6' },
  };
}

function imageData(url = 'https://example.com/pic.png') {
  return { imageUrl: url, fit: 'cover' };
}

// ── Fixture users ───────────────────────────────────────────────────────────
const uidA = createUserWithProfile('asset-owner-a');
const uidB = createUserWithProfile('asset-owner-b');
const tokenA = tokenFor(uidA);
const tokenB = tokenFor(uidB);
const uidAdmin = createUserWithProfile('asset-admin');
database.promoteDevAdmin('asset-admin');
const adminToken = tokenFor(uidAdmin);

// ════════════════════════════════════════════════════════════════════════════
// A. Create + defaults
// ════════════════════════════════════════════════════════════════════════════
group('Asset create & defaults');

let designAssetId = null;

test('create a profile_design asset starts as a draft at version 1', async () => {
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: {
      name: 'Sunset Layout',
      description: 'A warm design snapshot',
      asset_type: 'profile_design',
      asset_data: designSnapshot(),
    },
  });
  check(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
  const asset = res.data.asset;
  designAssetId = asset.id;
  check(asset.status === 'draft', `draft expected, got ${asset.status}`);
  check(asset.version === 1, `version 1 expected, got ${asset.version}`);
  check(asset.price_coins === 0, `default price 0 expected, got ${asset.price_coins}`);
  check(asset.asset_type === 'profile_design', 'asset_type persisted');
  check(asset.name === 'Sunset Layout', 'name persisted');
  check(asset.description === 'A warm design snapshot', 'description persisted');
  check(asset.preview_data && asset.preview_data.layout, 'preview_data derived from the validated model');
});

test('create an image-type asset validates + derives preview', async () => {
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: {
      name: 'Loyalty Sticker',
      asset_type: 'sticker',
      asset_data: imageData(),
      price_coins: 120,
    },
  });
  check(res.status === 201, `expected 201, got ${res.status}`);
  check(res.data.asset.asset_data.imageUrl === 'https://example.com/pic.png', 'imageUrl persisted');
  check(res.data.asset.asset_data.fit === 'cover', 'fit persisted');
  check(res.data.asset.preview_data.imageUrl === res.data.asset.asset_data.imageUrl, 'preview derived from asset_data');
  check(res.data.asset.price_coins === 120, 'price persisted');
});

test('list returns only the authenticated creator assets', async () => {
  const res = await api('GET', '/api/creator/assets', { token: tokenA });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(Array.isArray(res.data.assets), 'assets is an array');
  check(res.data.assets.length === 2, `expected 2 assets, got ${res.data.assets.length}`);
  check(res.data.assets.every(a => a.creator_user_id === undefined), 'list does not leak creator ids');
});

test('name is required on create', async () => {
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { asset_type: 'theme', asset_data: { theme: { background: '#0f172a' } } },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('asset_data is required on create', async () => {
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'No data', asset_type: 'theme' },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('client-supplied version/status are ignored (server-derived)', async () => {
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: {
      name: 'Spoofed',
      asset_type: 'theme',
      asset_data: { theme: null },
      version: 999,
      status: 'published',
      creator_user_id: '00000000-0000-0000-0000-000000000000',
    },
  });
  check(res.status === 201, `expected 201, got ${res.status}`);
  check(res.data.asset.version === 1, `version must be server-derived 1, got ${res.data.asset.version}`);
  check(res.data.asset.status === 'draft', `status must be server-derived draft, got ${res.data.asset.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// B. Update (draft only)
// ════════════════════════════════════════════════════════════════════════════
group('Asset update');

test('PATCH a draft asset updates fields and keeps version', async () => {
  const res = await api('PATCH', `/api/creator/assets/${designAssetId}`, {
    token: tokenA,
    body: { name: 'Sunset Layout v2', description: 'Updated', price_coins: 250 },
  });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.asset.name === 'Sunset Layout v2', 'name updated');
  check(res.data.asset.description === 'Updated', 'description updated');
  check(res.data.asset.price_coins === 250, 'price updated');
  check(res.data.asset.version === 1, `draft edits must not bump version, got ${res.data.asset.version}`);
});

test('invalid PATCH payload returns 400 and leaves the draft unchanged', async () => {
  const before = assetRow(designAssetId);
  const res = await api('PATCH', `/api/creator/assets/${designAssetId}`, {
    token: tokenA,
    body: { name: '<script>alert(1)</script>' },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
  const after = assetRow(designAssetId);
  check(before.name === after.name, 'stored name unchanged after failed patch');
});

test('PATCH with no updatable fields returns 400', async () => {
  const res = await api('PATCH', `/api/creator/assets/${designAssetId}`, {
    token: tokenA,
    body: {},
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('PATCH cannot change the asset type', async () => {
  const res = await api('PATCH', `/api/creator/assets/${designAssetId}`, {
    token: tokenA,
    body: { asset_type: 'theme' },
  });
  check(res.status === 409, `expected 409, got ${res.status}`);
});

test('PATCH a submitted asset is rejected (409)', async () => {
  const created = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Locking', asset_type: 'theme', asset_data: { theme: null } },
  });
  const id = created.data.asset.id;
  await api('POST', `/api/creator/assets/${id}/submit`, { token: tokenA });
  const res = await api('PATCH', `/api/creator/assets/${id}`, { token: tokenA, body: { name: 'nope' } });
  check(res.status === 409, `expected 409, got ${res.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// C. Submit
// ════════════════════════════════════════════════════════════════════════════
group('Asset submit');

test('submit transitions a validated draft to submitted', async () => {
  const res = await api('POST', `/api/creator/assets/${designAssetId}/submit`, { token: tokenA });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.asset.status === 'submitted', `submitted expected, got ${res.data.asset.status}`);
  check(res.data.asset.version === 1, 'submit does not bump version');
});

test('submitting the same asset twice returns 409', async () => {
  const res = await api('POST', `/api/creator/assets/${designAssetId}/submit`, { token: tokenA });
  check(res.status === 409, `expected 409, got ${res.status}`);
});

test('an invalid stored asset can never be submitted (publish gate)', async () => {
  const id = randomUUID();
  const ts = new Date().toISOString();
  database.execute(
    `INSERT INTO creator_assets
       (id, creator_user_id, name, description, asset_type, asset_data, created_at, updated_at)
     VALUES (?, ?, ?, '', 'profile_design', ?, ?, ?)`,
    [id, uidA, 'Tampered', JSON.stringify({
      layout: {
        canvas: { width: 960, minHeight: 1200 },
        components: [{
          id: 'c-x', type: 'text', x: 0, y: 0, width: 320, height: 96,
          zIndex: 1, visible: true, locked: false,
          config: { text: '<script>alert(1)</script>' },
        }],
      },
      theme: null,
    }), ts, ts]
  );
  const res = await api('POST', `/api/creator/assets/${id}/submit`, { token: tokenA });
  check(res.status === 400, `expected 400 for tampered asset, got ${res.status}`);
});

test('a source_design_id must reference one of the creator own designs', async () => {
  const foreignDesignId = randomUUID();
  database.execute(
    `INSERT INTO profile_designs (id, user_id, name, status, version, layout_config, created_at, updated_at)
     VALUES (?, ?, 'foreign', 'draft', 1, '{}', ?, ?)`,
    [foreignDesignId, uidB, new Date().toISOString(), new Date().toISOString()]
  );
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: {
      name: 'Bad source',
      asset_type: 'profile_design',
      asset_data: designSnapshot(),
      source_design_id: foreignDesignId,
    },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// D. Publish
// ════════════════════════════════════════════════════════════════════════════
group('Asset publish');

test('publish requires submitted state first', async () => {
  const created = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Not ready', asset_type: 'sticker', asset_data: imageData() },
  });
  const res = await api('POST', `/api/creator/assets/${created.data.asset.id}/publish`, { token: tokenA });
  check(res.status === 409, `expected 409, got ${res.status}`);
});

test('publish bumps version and stamps published_at', async () => {
  const res = await api('POST', `/api/creator/assets/${designAssetId}/publish`, { token: tokenA });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.asset.status === 'published', `published expected, got ${res.data.asset.status}`);
  check(res.data.asset.version === 2, `version must bump to 2, got ${res.data.asset.version}`);
  check(res.data.asset.published_at !== null, 'published_at set');
});

test('each publish creates a new version snapshot', async () => {
  const created = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Multi', asset_type: 'theme', asset_data: { theme: null } },
  });
  const id = created.data.asset.id;
  await api('POST', `/api/creator/assets/${id}/submit`, { token: tokenA });
  const p1 = await api('POST', `/api/creator/assets/${id}/publish`, { token: tokenA });
  check(p1.data.asset.version === 2, `v2 after first publish, got ${p1.data.asset.version}`);
  const created2 = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Multi 2', asset_type: 'theme', asset_data: { theme: null } },
  });
  const id2 = created2.data.asset.id;
  await api('POST', `/api/creator/assets/${id2}/submit`, { token: tokenA });
  const p2 = await api('POST', `/api/creator/assets/${id2}/publish`, { token: tokenA });
  check(p2.data.asset.version === 2, `fresh asset publishes at v2, got ${p2.data.asset.version}`);
});

test('a published asset is immutable (PATCH -> 409)', async () => {
  const res = await api('PATCH', `/api/creator/assets/${designAssetId}`, {
    token: tokenA,
    body: { name: 'Hijack published' },
  });
  check(res.status === 409, `expected 409, got ${res.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// E. Archive
// ════════════════════════════════════════════════════════════════════════════
group('Asset archive');

test('owner can archive their own asset', async () => {
  const res = await api('POST', `/api/creator/assets/${designAssetId}/archive`, { token: tokenA });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.asset.status === 'archived', `archived expected, got ${res.data.asset.status}`);
  check(res.data.asset.archived_at !== null, 'archived_at set');
});

test('admin can archive another creator asset via existing requireAdmin', async () => {
  const created = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Mixed', asset_type: 'background', asset_data: imageData() },
  });
  const res = await api('POST', `/api/creator/assets/${created.data.asset.id}/archive`, { token: adminToken });
  check(res.status === 200, `expected 200, got ${res.status}`);
  check(res.data.asset.status === 'archived', 'admin archive works');
});

test('non-owner non-admin archive is denied', async () => {
  const created = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Mine', asset_type: 'decoration', asset_data: imageData() },
  });
  const res = await api('POST', `/api/creator/assets/${created.data.asset.id}/archive`, { token: tokenB });
  check(res.status === 403, `expected 403, got ${res.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// F. Ownership
// ════════════════════════════════════════════════════════════════════════════
group('Asset ownership');

test('read a foreign asset returns 404 (no cross-user draft exposure)', async () => {
  const created = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Private', asset_type: 'profile_design', asset_data: designSnapshot() },
  });
  const res = await api('GET', `/api/creator/assets/${created.data.asset.id}`, { token: tokenB });
  check(res.status === 404, `expected 404, got ${res.status}`);
});

test('foreign update/submit/publish all return 404', async () => {
  const created = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Solo', asset_type: 'sticker', asset_data: imageData() },
  });
  const id = created.data.asset.id;
  const patch = await api('PATCH', `/api/creator/assets/${id}`, { token: tokenB, body: { name: 'Theft' } });
  const submit = await api('POST', `/api/creator/assets/${id}/submit`, { token: tokenB });
  const publish = await api('POST', `/api/creator/assets/${id}/publish`, { token: tokenB });
  check(patch.status === 404, `expected 404, got ${patch.status}`);
  check(submit.status === 404, `expected 404, got ${submit.status}`);
  check(publish.status === 404, `expected 404, got ${publish.status}`);
});

test('unauthenticated requests return 401', async () => {
  const list = await api('GET', '/api/creator/assets');
  const create = await api('POST', '/api/creator/assets', {
    body: { name: 'x', asset_type: 'theme', asset_data: { theme: null } },
  });
  const get = await api('GET', `/api/creator/assets/${designAssetId}`);
  const patch = await api('PATCH', `/api/creator/assets/${designAssetId}`, { body: { name: 'x' } });
  const submit = await api('POST', `/api/creator/assets/${designAssetId}/submit`);
  const publish = await api('POST', `/api/creator/assets/${designAssetId}/publish`);
  const archive = await api('POST', `/api/creator/assets/${designAssetId}/archive`);
  for (const [name, r] of [['list', list], ['create', create], ['get', get], ['patch', patch], ['submit', submit], ['publish', publish], ['archive', archive]]) {
    check(r.status === 401, `${name} must 401, got ${r.status}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// G. Validation & security
// ════════════════════════════════════════════════════════════════════════════
group('Asset validation & security');

test('unknown asset types are rejected', async () => {
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Music', asset_type: 'music', asset_data: {} },
  });
  check(res.status === 400, `expected 400, got ${res.status}: ${JSON.stringify(res.data)}`);
});

test('dangerous markup in name/description is rejected', async () => {
  for (const bad of [
    { name: '<script>alert(1)</script>' },
    { name: 'ok', description: '<iframe src="x"></iframe>' },
    { name: 'ok', description: '<object data="x"></object>' },
    { name: 'ok', description: '<embed src="x">' },
    { name: 'ok', description: '<style>*{display:none}</style>' },
  ]) {
    const res = await api('POST', '/api/creator/assets', {
      token: tokenA,
      body: { ...bad, asset_type: 'theme', asset_data: { theme: null } },
    });
    check(res.status === 400, `markup payload must 400, got ${res.status}: ${JSON.stringify(bad)}`);
  }
});

test('unsafe image URLs are rejected (javascript:/data:)', async () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
  ]) {
    const res = await api('POST', '/api/creator/assets', {
      token: tokenA,
      body: { name: 'Bad url', asset_type: 'sticker', asset_data: imageData(url) },
    });
    check(res.status === 400, `unsafe URL must 400, got ${res.status}: ${url}`);
  }
});

test('invalid image fit is rejected', async () => {
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Fit', asset_type: 'background', asset_data: { imageUrl: 'https://example.com/a.png', fit: 'stretch' } },
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

test('hidden embedded payloads inside asset_data are rejected', async () => {
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: {
      name: 'Sneaky',
      asset_type: 'profile_design',
      asset_data: {
        layout: { canvas: { width: 960, minHeight: 1200 }, components: [] },
        theme: { background: '#000000', backgroundImage: 'https://x/1.png' },
        extra: '<iframe src="https://evil"></iframe>',
      },
    },
  });
  check(res.status === 400, `embedded payload must 400, got ${res.status}`);
});

test('oversized asset payloads are rejected', async () => {
  const huge = 'linear-gradient(' + 'a'.repeat(600 * 1024) + ')';
  const res = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'Huge', asset_type: 'theme', asset_data: { theme: { backgroundGradient: huge } } },
  });
  check(res.status === 400, `expected 400 for oversized payload, got ${res.status}`);
});

test('price validation: negative/decimal/string/zero', async () => {
  const negative = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'P1', asset_type: 'theme', asset_data: { theme: null }, price_coins: -1 },
  });
  check(negative.status === 400, 'negative price must 400');
  const decimal = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'P2', asset_type: 'theme', asset_data: { theme: null }, price_coins: 1.5 },
  });
  check(decimal.status === 400, 'decimal price must 400');
  const asString = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'P3', asset_type: 'theme', asset_data: { theme: null }, price_coins: '10' },
  });
  check(asString.status === 400, 'string price must 400');
  const asNull = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'P4', asset_type: 'theme', asset_data: { theme: null }, price_coins: null },
  });
  check(asNull.status === 400, 'null price must 400');
  const zero = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'P5', asset_type: 'theme', asset_data: { theme: null }, price_coins: 0 },
  });
  check(zero.status === 201, 'zero price is valid');
});

test('NaN/Infinity prices are rejected at the validation layer', () => {
  const checkPayload = (value) => {
    const { errors } = creatorAssets.validateAssetPayload({
      name: 'NaN test',
      asset_type: 'theme',
      asset_data: { theme: null },
      price_coins: value,
    });
    return errors.length > 0;
  };
  check(checkPayload(NaN), 'NaN rejected');
  check(checkPayload(Infinity), 'Infinity rejected');
  check(checkPayload(-Infinity), '-Infinity rejected');
});

test('name length and markup are bounded', async () => {
  const long = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: { name: 'x'.repeat(101), asset_type: 'theme', asset_data: { theme: null } },
  });
  check(long.status === 400, 'name > 100 must 400');
});

// ════════════════════════════════════════════════════════════════════════════
// H. Profile design integration
// ════════════════════════════════════════════════════════════════════════════
group('Profile design integration');

test('a personal published design can be snapshotted as an asset', async () => {
  // Publish a personal design for user A.
  const design = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'My Personal', layout: designSnapshot().layout, theme: designSnapshot().theme },
  });
  check(design.status === 201, `design create expected 201, got ${design.status}`);
  const published = await api('POST', `/api/profile/design/${design.data.design.id}/publish`, { token: tokenA });
  check(published.status === 200, `design publish expected 200, got ${published.status}`);

  // Snapshot it as a creator asset, linked by source_design_id.
  const assetRes = await api('POST', '/api/creator/assets', {
    token: tokenA,
    body: {
      name: 'My Personal (marketplace)',
      asset_type: 'profile_design',
      asset_data: { layout: designSnapshot().layout, theme: designSnapshot().theme },
      source_design_id: design.data.design.id,
    },
  });
  check(assetRes.status === 201, `asset create expected 201, got ${assetRes.status}`);
  check(assetRes.data.asset.source_design_id === design.data.design.id, 'source_design_id recorded');
});

test('the asset never replaces the personal profile design', async () => {
  const own = await api('GET', '/api/profile', { token: tokenA });
  check(own.status === 200, `own profile expected 200, got ${own.status}`);
  check(own.data.design && own.data.design.status === 'published', 'personal published design still live');
  const assetList = await api('GET', '/api/creator/assets', { token: tokenA });
  const linked = assetList.data.assets.filter(a => a.source_design_id);
  check(linked.length >= 1, 'marketplace assets exist alongside the personal design');
  check(own.data.design.id !== linked[0].id, 'asset snapshot id differs from personal design id');
});

test('asset edits do not mutate the personal design snapshot source', async () => {
  const list = await api('GET', '/api/creator/assets', { token: tokenA });
  const asset = list.data.assets.find(a => a.source_design_id);
  const beforeDesign = await api('GET', `/api/profile/design/${asset.source_design_id}`, { token: tokenA });
  const beforeLayout = JSON.stringify(beforeDesign.data.design.layout);

  const patched = await api('PATCH', `/api/creator/assets/${asset.id}`, {
    token: tokenA,
    body: { name: 'Renamed product' },
  });
  check(patched.status === 200, 'asset rename ok');

  const afterDesign = await api('GET', `/api/profile/design/${asset.source_design_id}`, { token: tokenA });
  check(JSON.stringify(afterDesign.data.design.layout) === beforeLayout, 'personal design layout untouched by asset edit');
});

test('publishing the asset keeps the personal profile working', async () => {
  const list = await api('GET', '/api/creator/assets', { token: tokenA });
  const asset = list.data.assets.find(a => a.source_design_id);
  const submit = await api('POST', `/api/creator/assets/${asset.id}/submit`, { token: tokenA });
  check(submit.status === 200, `submit expected 200, got ${submit.status}`);
  const publish = await api('POST', `/api/creator/assets/${asset.id}/publish`, { token: tokenA });
  check(publish.status === 200 && publish.data.asset.status === 'published', 'asset published');
  const own = await api('GET', '/api/profile', { token: tokenA });
  check(own.data.design && own.data.design.name === 'My Personal', 'personal profile design still published and intact');
});

// ── Run + report ─────────────────────────────────────────────────────────────
for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
console.log('\n' + '═'.repeat(64));
console.log(`CREATOR-02 ASSET TESTS: ${total - failed.length}/${total} passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  ✗ ${f.name}\n    ${f.error?.stack || f.error}`);
}

database.closeDatabase();
if (process.env.KEEP_TEST_DIR !== '1') {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

process.exit(failed.length ? 1 : 0);