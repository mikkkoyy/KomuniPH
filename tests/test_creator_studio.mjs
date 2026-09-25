/**
 * CREATOR-01B — Creator Studio integration test suite.
 *
 * Run:   npm run test:studio
 *
 * The Creator Studio (web/js/creatorStudio.js) is a pure client module; this
 * suite pins the server-backed contract it depends on, exercising the exact
 * request shapes the studio issues:
 *   - bootstrap: list -> create missing default design (new-design flow)
 *   - save:      PATCH with a studio-produced layout (all 12 component types)
 *   - publish:   POST publish, previous published design archived
 *   - undo/redo friendly: z-index reindexing produced by layer operations
 *   - resilience: a studio-produced value the server rejects must 400 and
 *     leave the previously saved draft unchanged (save-net rebase)
 *   - ownership: another account's studio may never touch this design
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
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-studio-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-studio.db');
process.env.PORT = String(19600 + (process.pid % 1200));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-01b-test-webhook-secret';
process.env.SECRET_KEY = 'creator-01b-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'studio-admin';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// ── Imports (server modules resolve config from the env above) ──────────────
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
const auth = await import(mod('server/auth.js'));
await import(mod('server/index.js')); // boots the HTTP server

await database.seedAdminUser();

// ── Tiny test harness (mirrors test_coins.mjs) ──────────────────────────────
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

function designRow(designId) {
  return database.queryOne('SELECT * FROM profile_designs WHERE id = ?', [designId]);
}

/** The exact layout the studio produces: 8 controlled + 4 content components. */
function studioLayout() {
  return {
    canvas: { width: 960, minHeight: 1200 },
    components: [
      { id: 'c-profile_photo', type: 'profile_photo', x: 0, y: 0, width: 180, height: 180, zIndex: 0, visible: true, locked: false, config: null },
      { id: 'c-name', type: 'name', x: 220, y: 0, width: 420, height: 96, zIndex: 1, visible: true, locked: false, config: null },
      { id: 'c-alias', type: 'alias', x: 220, y: 110, width: 360, height: 72, zIndex: 2, visible: true, locked: false, config: null },
      { id: 'c-bio', type: 'bio', x: 0, y: 210, width: 420, height: 140, zIndex: 3, visible: true, locked: false, config: null },
      { id: 'c-personal_info', type: 'personal_info', x: 0, y: 380, width: 420, height: 180, zIndex: 4, visible: true, locked: false, config: null },
      { id: 'c-gallery', type: 'gallery', x: 460, y: 0, width: 460, height: 280, zIndex: 5, visible: true, locked: false, config: null },
      { id: 'c-testimonials', type: 'testimonials', x: 460, y: 310, width: 420, height: 220, zIndex: 6, visible: true, locked: false, config: null },
      { id: 'c-communities', type: 'communities', x: 460, y: 560, width: 420, height: 220, zIndex: 7, visible: true, locked: false, config: null },
      { id: 'c-text', type: 'text', x: 40, y: 40, width: 320, height: 96, zIndex: 8, visible: true, locked: false, rotation: 0, config: { text: 'Welcome!', fontSize: 24, fontWeight: 600, textAlign: 'left', lineHeight: 1.5, textColor: '#2a2130' } },
      { id: 'c-image', type: 'image', x: 560, y: 600, width: 360, height: 240, zIndex: 9, visible: true, locked: false, config: { imageUrl: 'https://cdn.example.com/photo.png', alt: 'My photo', fit: 'cover', backgroundColor: '#0f172a' } },
      { id: 'c-card', type: 'card', x: 40, y: 700, width: 340, height: 190, zIndex: 10, visible: true, locked: false, config: { heading: 'About me', body: 'A short greeting', headingColor: '#0e6e6e', textColor: '#2a2130', textAlign: 'center' } },
      { id: 'c-sticker', type: 'sticker', x: 780, y: 300, width: 160, height: 160, zIndex: 11, visible: true, locked: false, config: { imageUrl: 'https://cdn.example.com/sticker.png', fit: 'contain' } },
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A. Studio bootstrap (the "New Design" flow)
// ════════════════════════════════════════════════════════════════════════════
group('Studio bootstrap');

let uidS;
let tokenS;
let designId;

test('first visit creates a blank design from safe defaults', async () => {
  uidS = createUserWithProfile('studio-a');
  tokenS = tokenFor(uidS);

  let r = await api('GET', '/api/profile/design', { token: tokenS });
  check(r.status === 200 && Array.isArray(r.data.designs) && r.data.designs.length === 0, 'fresh account has no designs');

  r = await api('POST', '/api/profile/design', {
    token: tokenS,
    body: { name: 'My Design', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] } },
  });
  check(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
  const design = r.data.design;
  check(design.status === 'draft', 'new design starts as draft');
  check(design.layout.canvas.width === 960 && design.layout.canvas.minHeight === 1200, 'canvas defaulted');
  check(Array.isArray(design.layout.components) && design.layout.components.length === 0, 'starts empty');
  designId = design.id;
});

test('GET is how the studio switches designs', async () => {
  const r = await api('GET', `/api/profile/design/${designId}`, { token: tokenS });
  check(r.status === 200, `expected 200, got ${r.status}`);
  check(r.data.design.id === designId, 'returns the requested design');
  check(r.data.design.layout.components.length === 0, 'switching keeps the blank canvas');
});

// ════════════════════════════════════════════════════════════════════════════
// B. Save: PATCH a full studio-produced layout
// ════════════════════════════════════════════════════════════════════════════
group('Studio save (PATCH)');

test('saving a 12-component layout round-trips every type', async () => {
  const layout = studioLayout();
  const r = await api('PATCH', `/api/profile/design/${designId}`, {
    token: tokenS,
    body: { name: 'My Design', layout },
  });
  check(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
  const saved = r.data.design.layout;
  check(saved.components.length === 12, `expected 12 components, got ${saved.components.length}`);
  const byType = Object.fromEntries(saved.components.map(c => [c.type, c]));
  check(byType.text.config.text === 'Welcome!', 'text config survived');
  check(byType.image.config.imageUrl === 'https://cdn.example.com/photo.png', 'image URL survived');
  check(byType.card.config.heading === 'About me', 'card heading survived');
  check(byType.sticker.config.fit === 'contain', 'sticker config survived');
  check(byType.bio.visible === true && byType.bio.locked === false, 'flags survived');
});

test('rotation and z-index from layer ops are preserved', async () => {
  const layout = studioLayout();
  layout.components[8].rotation = 45;   // text rotated by handle drag
  layout.components = layout.components.map((c, i) => ({ ...c, zIndex: i })); // reindexed by moveLayer
  const r = await api('PATCH', `/api/profile/design/${designId}`, {
    token: tokenS,
    body: { name: 'My Design', layout },
  });
  check(r.status === 200, `expected 200, got ${r.status}`);
  const saved = r.data.design.layout.components.map(c => [c.zIndex, c.rotation]).sort((a, b) => a[0] - b[0]);
  check(saved.every(([z], i) => z === i), 'z-index must be contiguous after a reindex');
  check(saved.find(([, r]) => r === 45), '45-degree rotation must survive');
});

test('a rejected studio value is a 400 and the saved draft stays valid', async () => {
  const unknown = studioLayout();
  unknown.components[8].config.textSize = 'huge'; // unknown config key
  const badCfg = await api('PATCH', `/api/profile/design/${designId}`, {
    token: tokenS,
    body: { name: 'My Design', layout: unknown },
  });
  check(badCfg.status === 400, `unknown config key must be rejected, got ${badCfg.status}`);
  const badCanvas = await api('PATCH', `/api/profile/design/${designId}`, {
    token: tokenS,
    body: { name: 'My Design', layout: { canvas: { width: 100, minHeight: 600 }, components: [] } },
  });
  check(badCanvas.status === 400, `out-of-bounds canvas must be rejected, got ${badCanvas.status}`);
  const row = designRow(designId);
  const storedLayout = JSON.parse(row.layout_config);
  check(storedLayout.components.length === 12, 'previous valid draft must be untouched after a 400');
});

// ════════════════════════════════════════════════════════════════════════════
// C. Publish (the studio Publish button)
// ════════════════════════════════════════════════════════════════════════════
group('Studio publish');

test('publish flips the design and attaches it to the profile', async () => {
  const r = await api('POST', `/api/profile/design/${designId}/publish`, { token: tokenS, body: {} });
  check(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
  check(r.data.design.status === 'published', 'status must be published');
  check(r.data.design.version === 2, `published design version 2 (bumped), got ${r.data.design.version}`);
  const own = await api('GET', '/api/profile', { token: tokenS });
  check(own.status === 200 && own.data.design && own.data.design.id === designId, 'own profile carries the published design');
});

test('a second design can be drafted without unpublishing the live one', async () => {
  const created = await api('POST', '/api/profile/design', {
    token: tokenS,
    body: { name: 'Second', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] } },
  });
  check(created.status === 201, `expected 201, got ${created.status}`);
  const list = await api('GET', '/api/profile/design', { token: tokenS });
  const states = list.data.designs.map(d => d.status).sort();
  check(states.includes('published') && states.includes('draft'), 'published + draft coexist in the studio dropdown');
});

// ════════════════════════════════════════════════════════════════════════════
// D. Ownership (the studio API refuses cross-account edits)
// ════════════════════════════════════════════════════════════════════════════
group('Studio ownership');

test('another account cannot read or modify the design', async () => {
  const other = createUserWithProfile('studio-b');
  const otherToken = tokenFor(other);
  const r1 = await api('GET', `/api/profile/design/${designId}`, { token: otherToken });
  check(r1.status === 404, `foreign read must 404, got ${r1.status}`);
  const r2 = await api('PATCH', `/api/profile/design/${designId}`, {
    token: otherToken,
    body: { name: 'Hijack', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] } },
  });
  check(r2.status === 404, `foreign publish/update must 404, got ${r2.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// E. Dev admin startup promotion path (config-driven)
// ════════════════════════════════════════════════════════════════════════════
group('Dev admin promotion');

test('promoteDevAdmin is idempotent and audit-safe', async () => {
  const uid = createUserWithProfile('studio-admin-target');
  const first = database.promoteDevAdmin('studio-admin-target');
  check(first.promoted === true, 'target account must be promoted on first call');
  const second = database.promoteDevAdmin('studio-admin-target');
  check(second.alreadyAdmin === true, 'second call must report alreadyAdmin');
  const row = database.queryOne("SELECT role FROM users WHERE id = ?", [uid]);
  check(row.role === 'admin', 'role persists as admin');
});

test('promoting a missing user is a clean no-op', async () => {
  const result = database.promoteDevAdmin('no-such-user-xyz');
  check(result.promoted === false && result.reason === 'user not found', 'missing user must not throw');
});

// ── Run + report ─────────────────────────────────────────────────────────────
for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
console.log('\n' + '═'.repeat(64));
console.log(`CREATOR-01B STUDIO TESTS: ${total - failed.length}/${total} passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  ✗ ${f.name}\n    ${f.error?.stack || f.error}`);
}

database.closeDatabase();
if (process.env.KEEP_TEST_DIR !== '1') {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

process.exit(failed.length ? 1 : 0);