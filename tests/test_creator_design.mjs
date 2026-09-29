/**
 * CREATOR-01A / CREATOR-01B — Profile Design Engine test suite.
 *
 * Run:   npm run test:creator
 *
 * Covers the design foundation (CREATOR-01A) plus the CREATOR-01B content
 * component contract (text / image / card / sticker configs, rotation):
 *   - controlled component registry + strict layout validation
 *   - design CRUD (create/read/list/update) with server-derived ownership
 *   - publishing flow: one published per user, archival of the previous,
 *     minimal versioning (bumps on publish), published_at timestamps
 *   - security: owner spoofing, forced statuses, unauthenticated access,
 *     HTML/script injection rejection
 *   - profile & theme compatibility: no design -> default render (design null),
 *     published design attached to own + public profile responses,
 *     corrupt/invalid stored designs never break a profile
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
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-design-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-design.db');
process.env.PORT = String(18200 + (process.pid % 1800));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-01a-test-webhook-secret';
process.env.SECRET_KEY = 'creator-01a-test-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';

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

async function assertThrows(fn, pattern) {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    const needle = typeof pattern === 'function'
      ? pattern(err)
      : (String(err.message).includes(pattern) || err.code === pattern);
    if (pattern && !needle) {
      throw new Error(`expected error containing "${pattern}" but got: ${err.message} (code=${err.code})`);
    }
  }
  if (!threw) throw new Error('expected function to throw, but it did not');
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

/** A fully valid layout exercising every controlled component type. */
function validLayout() {
  const specs = [
    ['profile_photo', 0, 0], ['name', 0, 140], ['alias', 0, 280],
    ['bio', 0, 420], ['personal_info', 0, 560], ['gallery', 420, 0],
    ['testimonials', 420, 140], ['communities', 420, 280],
  ];
  return {
    canvas: { width: 960, minHeight: 1200 },
    components: specs.map(([type, x, y], i) => ({
      id: `comp-${type}`, type, x, y, width: 400, height: 120,
      zIndex: i, visible: true, locked: false, config: null,
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// A. Validation & controlled component registry
// ════════════════════════════════════════════════════════════════════════════
group('Validation & registry');

let uidA;
let tokenA;

// CREATOR-08: a profile_guide is a persisted, validated design component, so the
// server must hold it to exactly the same contract as every other type.
const guide = (config, overrides = {}) => ({
  id: 'g1', type: 'profile_guide', x: 0, y: 0, width: 960, height: 1200,
  rotation: 0, zIndex: 0, visible: true, locked: false, config, ...overrides,
});

/**
 * CREATOR-09: read the shared client guide-pattern registry, so the server tests
 * assert against the SAME card set the editor actually creates rather than a
 * hand-copied list that could drift.
 */
const guidePatternForTest = async (id) => {
  const registry = await import(mod('web/js/profileDesign.js'));
  return registry.guidePattern(id);
};

test('CREATOR-08: a valid profile_guide is accepted and round-trips its pattern', async () => {
  // A dedicated user, so these designs never pollute tokenA's design list that
  // the CRUD tests count.
  const guideUid = createUserWithProfile('design-guide');
  const guideToken = tokenFor(guideUid);
  const r = await api('POST', '/api/profile/design', {
    token: guideToken,
    body: { name: 'Guide', layout: { canvas: { width: 960, minHeight: 1200 }, components: [guide({ pattern: 'classic' })] } },
  });
  check(r.status === 201 || r.status === 200, `expected success, got ${r.status}: ${JSON.stringify(r.data)}`);
  const saved = r.data?.design ?? r.data;
  const comp = saved?.layout?.components?.[0];
  check(comp?.type === 'profile_guide', 'the guide is stored as its own type');
  check(comp?.config?.pattern === 'classic', `the pattern persists, got ${JSON.stringify(comp?.config)}`);
  check(comp?.width === 960 && comp?.height === 1200, 'guide geometry persists');
});

test('CREATOR-08: only known guide patterns are accepted', async () => {
  const guideToken = tokenFor(createUserWithProfile('design-guide-2'));
  for (const pattern of ['default', 'minimal', 'classic']) {
    const ok = await api('POST', '/api/profile/design', {
      token: guideToken,
      body: { name: `G-${pattern}`, layout: { canvas: { width: 960, minHeight: 1200 }, components: [guide({ pattern })] } },
    });
    check(ok.status === 201 || ok.status === 200, `pattern "${pattern}" is accepted, got ${ok.status}`);
  }
  for (const bad of ['neon', 'DEFAULT', '__proto__', 'constructor', 'toString', '', 1, null, true, { toString: 'x' }, ['default']]) {
    const r = await api('POST', '/api/profile/design', {
      token: guideToken,
      body: { name: 'BadGuide', layout: { canvas: { width: 960, minHeight: 1200 }, components: [guide({ pattern: bad })] } },
    });
    check(r.status === 400, `pattern ${JSON.stringify(bad)} is rejected, got ${r.status}`);
  }
});

test('CREATOR-08: a guide cannot smuggle extra config, markup or script', async () => {
  const guideToken = tokenFor(createUserWithProfile('design-guide-3'));
  const hostile = [
    { pattern: 'default', html: '<script>alert(1)</script>' },
    { pattern: 'default', css: 'background:url(javascript:alert(1))' },
    { pattern: 'default', onClick: 'alert(1)' },
    { pattern: '<script>alert(1)</script>' },
    { pattern: 'default', blocks: [{ label: '<img src=x onerror=alert(1)>' }] },
  ];
  for (const config of hostile) {
    const r = await api('POST', '/api/profile/design', {
      token: guideToken,
      body: { name: 'HostileGuide', layout: { canvas: { width: 960, minHeight: 1200 }, components: [guide(config)] } },
    });
    check(r.status === 400, `${JSON.stringify(config).slice(0, 60)} is rejected, got ${r.status}`);
  }
  // A guide must carry a config object rather than silently defaulting.
  for (const config of [null, undefined, 'default', 5, []]) {
    const r = await api('POST', '/api/profile/design', {
      token: guideToken,
      body: { name: 'NoCfgGuide', layout: { canvas: { width: 960, minHeight: 1200 }, components: [guide(config)] } },
    });
    check(r.status === 400, `guide config ${JSON.stringify(config)} is rejected, got ${r.status}`);
  }
});

test('CREATOR-08: guide geometry is validated like any other component', async () => {
  const guideToken = tokenFor(createUserWithProfile('design-guide-4'));
  for (const overrides of [
    { width: 4 }, { height: 0 }, { x: 99999 }, { rotation: 400 },
    { zIndex: 1.5 }, { width: '960' }, { height: null },
  ]) {
    const r = await api('POST', '/api/profile/design', {
      token: guideToken,
      body: { name: 'BadGeom', layout: { canvas: { width: 960, minHeight: 1200 }, components: [guide({ pattern: 'default' }, overrides)] } },
    });
    check(r.status === 400, `guide geometry ${JSON.stringify(overrides)} is rejected, got ${r.status}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CREATOR-09: Profile Guide cards
// ════════════════════════════════════════════════════════════════════════════

// A guide card marks where a REAL KomuniPH profile section belongs. It carries a
// single allowlisted section id and nothing else.
const guideCard = (config, overrides = {}) => ({
  id: 'gc1', type: 'profile_guide_card', x: 40, y: 20, width: 200, height: 190,
  rotation: 0, zIndex: 0, visible: true, locked: false, config, ...overrides,
});

test('CREATOR-09: a valid profile_guide_card is accepted and round-trips its section', async () => {
  const cardToken = tokenFor(createUserWithProfile('design-guide-card'));
  const r = await api('POST', '/api/profile/design', {
    token: cardToken,
    body: {
      name: 'GuideCard',
      layout: {
        canvas: { width: 960, minHeight: 1200 },
        components: [guideCard({ section: 'testimonials' })],
      },
    },
  });
  check(r.status === 201, `a valid guide card is created, got ${r.status}: ${JSON.stringify(r.data)}`);
  const comp = r.data?.design?.layout?.components?.[0];
  check(comp?.type === 'profile_guide_card', 'the guide card is stored as its own type');
  check(comp?.config?.section === 'testimonials', 'the section id round-trips');
  check(comp?.width === 200 && comp?.height === 190, 'guide card geometry persists');
});

test('CREATOR-09: every real profile section is an allowed guide-card section', async () => {
  const cardToken = tokenFor(createUserWithProfile('design-guide-card-2'));
  const real = ['profile_photo', 'name', 'alias', 'bio', 'personal_info', 'gallery', 'testimonials', 'communities'];
  for (const section of real) {
    const r = await api('POST', '/api/profile/design', {
      token: cardToken,
      body: {
        name: `G-${section}`,
        layout: { canvas: { width: 960, minHeight: 1200 }, components: [guideCard({ section })] },
      },
    });
    check(r.status === 201, `the real section "${section}" is allowed, got ${r.status}`);
  }
});

test('CREATOR-09: a guide card accepts only a known section id', async () => {
  const cardToken = tokenFor(createUserWithProfile('design-guide-card-3'));
  for (const bad of ['cover', 'Header', 'made_up_section', '', 42, null, undefined]) {
    const r = await api('POST', '/api/profile/design', {
      token: cardToken,
      body: {
        name: 'BadSection',
        layout: { canvas: { width: 960, minHeight: 1200 }, components: [guideCard({ section: bad })] },
      },
    });
    check(r.status === 400, `guide card section ${JSON.stringify(bad)} is rejected, got ${r.status}`);
  }
});

test('CREATOR-09: a guide card cannot smuggle content, markup, script or a pattern', async () => {
  const cardToken = tokenFor(createUserWithProfile('design-guide-card-4'));
  for (const config of [
    { section: 'bio', text: 'real looking profile data' },
    { section: 'bio', imageUrl: 'https://example.com/x.png' },
    { section: 'bio', pattern: 'default' },
    { section: 'bio', heading: 'Testimonials', body: 'fake review text' },
    { section: 'bio', style: 'color:red' },
    { section: '<script>alert(1)</script>' },
  ]) {
    const r = await api('POST', '/api/profile/design', {
      token: cardToken,
      body: {
        name: 'HostileCard',
        layout: { canvas: { width: 960, minHeight: 1200 }, components: [guideCard(config)] },
      },
    });
    check(r.status === 400, `guide card config ${JSON.stringify(config)} is rejected, got ${r.status}`);
  }
  // A guide card must carry a config object rather than silently defaulting.
  for (const config of [null, 'gallery', 7, []]) {
    const r = await api('POST', '/api/profile/design', {
      token: cardToken,
      body: {
        name: 'NoCfgCard',
        layout: { canvas: { width: 960, minHeight: 1200 }, components: [guideCard(config)] },
      },
    });
    check(r.status === 400, `guide card config ${JSON.stringify(config)} is rejected, got ${r.status}`);
  }
});

test('CREATOR-09: guide card geometry is validated like any other component', async () => {
  const cardToken = tokenFor(createUserWithProfile('design-guide-card-5'));
  for (const overrides of [
    { width: 4 }, { height: 0 }, { x: 99999 }, { rotation: 400 },
    { zIndex: 1.5 }, { width: '200' }, { height: null },
  ]) {
    const r = await api('POST', '/api/profile/design', {
      token: cardToken,
      body: {
        name: 'BadCardGeom',
        layout: { canvas: { width: 960, minHeight: 1200 }, components: [guideCard({ section: 'bio' }, overrides)] },
      },
    });
    check(r.status === 400, `guide card geometry ${JSON.stringify(overrides)} is rejected, got ${r.status}`);
  }
});

test('CREATOR-09: a full default guide set saves and reloads unchanged', async () => {
  const cardToken = tokenFor(createUserWithProfile('design-guide-card-6'));
  const pattern = await guidePatternForTest('default');
  const components = pattern.cards.map((c, i) => guideCard(
    { section: c.section },
    { id: `gc_${i}`, x: c.x, y: c.y, width: c.width, height: c.height, zIndex: i },
  ));
  const r = await api('POST', '/api/profile/design', {
    token: cardToken,
    body: { name: 'FullGuide', layout: { canvas: { width: 960, minHeight: 1200 }, components } },
  });
  check(r.status === 201, `the whole default guide set saves, got ${r.status}: ${JSON.stringify(r.data)}`);
  const stored = r.data?.design?.layout?.components || [];
  check(stored.length === pattern.cards.length, `all ${pattern.cards.length} guide cards are stored, got ${stored.length}`);
  check(
    stored.every((c, i) => c.config.section === pattern.cards[i].section && c.x === pattern.cards[i].x && c.width === pattern.cards[i].width),
    'every guide card keeps its section and exact geometry',
  );
});


test('unknown component type is rejected', async () => {
  if (!tokenA) { uidA = createUserWithProfile('design-a'); tokenA = tokenFor(uidA); }  const r = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Bad', layout: { components: [{ id: 'c1', type: 'banana', x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false }] } },
  });
  check(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.data)}`);
  check(String(r.data?.error?.message).includes('banana'), 'error must name the bad type');
});

test('future/unbuilt component types are rejected', async () => {
  const r = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Future', layout: { components: [{ id: 'c1', type: 'video', x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false, config: { content: 'hi' } }] } },
  });
  check(r.status === 400, `expected 400, got ${r.status}`);
  check(String(r.data?.error?.message).includes('not renderable yet'), 'must explain future type is not renderable');
});

test('missing and invalid component ids are rejected', async () => {
  const base = { x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false, config: null };
  for (const id of [undefined, null, 12, '', 'has space', 'weird#chars', 'x'.repeat(65)]) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'Id', layout: { components: [{ ...base, id, type: 'bio' }] } },
    });
    check(r.status === 400, `id ${JSON.stringify(id)} must be rejected, got ${r.status}`);
  }
});

test('duplicate component ids are rejected', async () => {
  const r = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Dup', layout: { components: [
      { id: 'same', type: 'bio', x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false },
      { id: 'same', type: 'name', x: 0, y: 0, width: 100, height: 100, zIndex: 1, visible: true, locked: false },
    ] } },
  });
  check(r.status === 400, `expected 400, got ${r.status}`);
  check(String(r.data?.error?.message).includes('Duplicate'), 'must flag the duplicate id');
});

test('non-numeric and out-of-range geometry is rejected', async () => {
  const base = { x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false, config: null };
  const bad = [
    { x: '10' }, { x: NaN }, { x: 10001 }, { y: -10001 }, { y: 'left' },
    { width: -1 }, { width: 7.9 }, { width: 5000 }, { height: 0 }, { height: 'tall' },
  ];
  for (const overrides of bad) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'Geo', layout: { components: [{ ...base, ...overrides, type: 'bio' }] } },
    });
    check(r.status === 400, `geometry ${JSON.stringify(overrides)} must be rejected, got ${r.status}`);
  }
});

test('non-integer zIndex and non-boolean flags are rejected', async () => {
  const base = { x: 0, y: 0, width: 100, height: 100, visible: true, locked: false, config: null };
  for (const overrides of [{ zIndex: 1.5 }, { zIndex: -1 }, { visible: 1 }, { locked: 'yes' }, { visible: null }]) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'Flags', layout: { components: [{ ...base, ...overrides, type: 'bio' }] } },
    });
    check(r.status === 400, `flags ${JSON.stringify(overrides)} must be rejected, got ${r.status}`);
  }
});

test('hostile HTML/script config is rejected', async () => {
  const payloads = [
    { config: { html: '<script>alert(1)</script>' } },
    { config: { style: '<style>body{display:none}</style>' } },
    { config: { src: '<iframe src="https://evil.example"></iframe>' } },
    { config: '<script>' },
  ];
  for (const extra of payloads) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'Xss', layout: { components: [{ id: randomUUID(), type: 'bio', x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false, ...extra }] } },
    });
    check(r.status === 400, `config ${JSON.stringify(extra.config)} must be rejected, got ${r.status}`);
  }
});

test('non-object layout and component config are rejected', async () => {
  const layoutTests = ['nope', 42, [1, 2]];
  for (const layout of layoutTests) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'NotObj', layout },
    });
    check(r.status === 400, `layout ${JSON.stringify(layout)} must be rejected, got ${r.status}`);
  }
  const r2 = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'NotObj2', layout: { components: [{ id: 'c1', type: 'bio', x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false, config: 'sticker' }] } },
  });
  check(r2.status === 400, 'string component config must be rejected');
});

test('component overflow (> 64) is rejected', async () => {
  const components = Array.from({ length: 65 }, (_, i) => ({
    id: `c${i}`, type: 'bio', x: i, y: 0, width: 100, height: 100, zIndex: i, visible: true, locked: false,
  }));
  const r = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'TooMany', layout: { components } },
  });
  check(r.status === 400, `expected 400, got ${r.status}`);
  check(String(r.data?.error?.message).includes('64'), 'must mention the component limit');
});

test('canvas dimensions outside bounds are rejected', async () => {
  for (const canvas of [{ width: 100, minHeight: 600 }, { width: 960, minHeight: 100 }, { width: 9999, minHeight: 600 }]) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'Canvas', layout: { canvas, components: [] } },
    });
    check(r.status === 400, `canvas ${JSON.stringify(canvas)} must be rejected, got ${r.status}`);
  }
});

test('unknown layout_config fields are rejected', async () => {
  const r = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Extras', layout: { canvas: null, components: [], backgroundUrl: 'https://x' } },
  });
  check(r.status === 400, `expected 400, got ${r.status}`);
});

test('invalid theme_config (bad hex + unknown field) is rejected', async () => {
  for (const theme of [{ accentColor: 'teal' }, { accentColor: '#0e6e6e', madeUp: '#000000' }]) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'BadTheme', layout: { components: [] }, theme },
    });
    check(r.status === 400, `theme ${JSON.stringify(theme)} must be rejected, got ${r.status}`);
  }
});

test('missing or oversized name is rejected', async () => {
  const r1 = await api('POST', '/api/profile/design', { token: tokenA, body: { layout: { components: [] } } });
  check(r1.status === 400, 'missing name must be rejected');
  const r2 = await api('POST', '/api/profile/design', { token: tokenA, body: { name: 'x'.repeat(101), layout: { components: [] } } });
  check(r2.status === 400, 'oversized name must be rejected');
});

// ════════════════════════════════════════════════════════════════════════════
// B. CRUD
// ════════════════════════════════════════════════════════════════════════════
group('CRUD');

let designA;

test('create stores a valid published-worthy design', async () => {
  const r = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'My Design', layout: validLayout() },
  });
  check(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
  const design = r.data.design;
  check(design.status === 'draft', `expected draft, got ${design.status}`);
  check(design.version === 1, `expected version 1, got ${design.version}`);
  check(design.layout.components.length === 8, 'all controlled components must round-trip');
  check(design.property === undefined, 'no client-supplied state may leak into the design');
  designA = design;
});

test('create without layout/theme uses safe defaults', async () => {
  const r = await api('POST', '/api/profile/design', { token: tokenA, body: { name: 'Blank' } });
  check(r.status === 201, `expected 201, got ${r.status}`);
  check(Array.isArray(r.data.design.layout.components) && r.data.design.layout.components.length === 0, 'blank design must have zero components');
  check(r.data.design.theme === null, 'blank design must have a null theme');
});

test('create ignores client-supplied status', async () => {
  const r = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Sneaky', status: 'published', layout: { components: [] } },
  });
  check(r.status === 201, `expected 201, got ${r.status}`);
  check(r.data.design.status === 'draft', 'created designs must always start as draft');
});

test('list returns the user designs newest-first', async () => {
  const r = await api('GET', '/api/profile/design', { token: tokenA });
  check(r.status === 200, `expected 200, got ${r.status}`);
  check(Array.isArray(r.data.designs) && r.data.designs.length === 3, `expected 3 designs, got ${r.data.designs?.length}`);
  const ids = r.data.designs.map(d => d.id);
  check(ids.includes(designA.id), 'the first design must be listed');
});

test('get returns a single owned design', async () => {
  const r = await api('GET', `/api/profile/design/${designA.id}`, { token: tokenA });
  check(r.status === 200, `expected 200, got ${r.status}`);
  check(r.data.design.id === designA.id, 'must return the requested design');
});

test('update renames and re-lays-out the design', async () => {
  const newLayout = {
    canvas: { width: 640, minHeight: 900 },
    components: [
      { id: 'comp-bio', type: 'bio', x: 40, y: 40, width: 500, height: 200, zIndex: 2, visible: true, locked: false, config: null },
    ],
  };
  const r = await api('PATCH', `/api/profile/design/${designA.id}`, {
    token: tokenA,
    body: { name: 'Renamed', layout: newLayout, theme: { accentColor: '#0e6e6e', cardOpacity: 0.9 } },
  });
  check(r.status === 200, `expected 200, got ${r.status}`);
  check(r.data.design.name === 'Renamed', 'name must update');
  check(r.data.design.layout.components.length === 1, 'layout must update');
  check(r.data.design.version === 1, 'plain edits must not bump the version');
  check(r.data.design.theme.accentColor === '#0e6e6e', 'theme must update');
});

test('update with an invalid layout is 400 and leaves the row unchanged', async () => {
  const before = designRow(designA.id);
  const r = await api('PATCH', `/api/profile/design/${designA.id}`, {
    token: tokenA,
    body: { layout: { components: [{ id: 'c', type: 'ghost', x: 0, y: 0, width: 1, height: 1, zIndex: 0, visible: true, locked: false }] } },
  });
  check(r.status === 400, `expected 400, got ${r.status}`);
  const after = designRow(designA.id);
  check(JSON.stringify(after.layout_config) === JSON.stringify(before.layout_config), 'layout_config must not change on rejection');
  check(after.name === before.name, 'name must not change on rejection');
});

test('updating a design owned by someone else is 404', async () => {
  const uidB = createUserWithProfile('design-b');
  const tokenB = tokenFor(uidB);
  const r = await api('PATCH', `/api/profile/design/${designA.id}`, { token: tokenB, body: { name: 'Hijack' } });
  check(r.status === 404, `expected 404, got ${r.status}`);
});

test('reading a design owned by someone else is 404', async () => {
  const uidB = createUserWithProfile('design-b2');
  const tokenB = tokenFor(uidB);
  const r = await api('GET', `/api/profile/design/${designA.id}`, { token: tokenB });
  check(r.status === 404, `expected 404, got ${r.status}`);
});

test('a malformed JSON body is rejected with 400', async () => {
  const res = await fetch(`${BASE}/api/profile/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: '{not json',
  });
  check(res.status === 400, `expected 400, got ${res.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// C. Publishing & versioning
// ════════════════════════════════════════════════════════════════════════════
group('Publishing & versioning');

test('publish flips to published and bumps the version', async () => {
  const r = await api('POST', `/api/profile/design/${designA.id}/publish`, { token: tokenA, body: {} });
  check(r.status === 200, `expected 200, got ${r.status}`);
  check(r.data.design.status === 'published', `expected published, got ${r.data.design.status}`);
  check(r.data.design.version === 2, `expected version 2, got ${r.data.design.version}`);
  check(!!r.data.design.published_at, 'published_at must be set');
});

test('a second publish archives the first published design', async () => {
  const r = await api('POST', '/api/profile/design', { token: tokenA, body: { name: 'Replace', layout: validLayout() } });
  const second = r.data.design;
  const pr = await api('POST', `/api/profile/design/${second.id}/publish`, { token: tokenA, body: {} });
  check(pr.status === 200, `publish failed: ${pr.status}`);
  const firstNow = designRow(designA.id);
  check(firstNow.status === 'archived', `previous published design must be archived, got ${firstNow.status}`);
  const count = database.queryOne(
    "SELECT COUNT(*) AS c FROM profile_designs WHERE user_id = ? AND status = 'published'",
    [uidA]
  );
  check(count.c === 1, `exactly one published design must remain, got ${count.c}`);
});

test('publishing a design you do not own is 404', async () => {
  const uidC = createUserWithProfile('design-c');
  const tokenC = tokenFor(uidC);
  const r = await api('POST', `/api/profile/design/${designA.id}/publish`, { token: tokenC, body: {} });
  check(r.status === 404, `expected 404, got ${r.status}`);
});

test('archiving a design takes it out of rotation', async () => {
  const r = await api('POST', `/api/profile/design/${designA.id}/archive`, { token: tokenA, body: {} });
  check(r.status === 200, `expected 200, got ${r.status}`);
  check(r.data.design.status === 'archived', `expected archived, got ${r.data.design.status}`);
});

test('an archived design can be re-published', async () => {
  const r = await api('POST', `/api/profile/design/${designA.id}/publish`, { token: tokenA, body: {} });
  check(r.status === 200, `expected 200, got ${r.status}`);
  check(r.data.design.status === 'published', `expected published, got ${r.data.design.status}`);
});

test('archiving someone else\'s design is 404', async () => {
  const uidC = createUserWithProfile('design-c2');
  const tokenC = tokenFor(uidC);
  const r = await api('POST', `/api/profile/design/${designA.id}/archive`, { token: tokenC, body: {} });
  check(r.status === 404, `expected 404, got ${r.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// D. Ownership & security
// ════════════════════════════════════════════════════════════════════════════
group('Ownership & security');

test('client cannot assign an owner (user_id) to a design', async () => {
  const uidD = createUserWithProfile('design-victim');
  const r = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Spoof', user_id: uidD, layout: { components: [] } },
  });
  check(r.status === 201, `expected 201, got ${r.status}`);
  const row = designRow(r.data.design.id);
  check(row.user_id === uidA, `owner must be the authenticated user, got ${row.user_id}`);
});

test('unauthenticated access to the design endpoints is 401', async () => {
  for (const [method, path, body] of [
    ['GET', '/api/profile/design', undefined],
    ['POST', '/api/profile/design', { name: 'Nope', layout: { components: [] } }],
    ['POST', `/api/profile/design/${designA.id}/publish`, {}],
  ]) {
    const r = await api(method, path, { body });
    check(r.status === 401, `${method} ${path} must be 401, got ${r.status}`);
  }
});

test('raw script strings cannot survive validation into stored data', async () => {
  const before = database.queryAll('SELECT COUNT(*) AS c FROM profile_designs');
  // A script disguised as a component name, config key or text value is rejected.
  const attempts = [
    { name: '<script>alert(1)</script>', layout: { components: [] } },
    { name: 'Ok', layout: { components: [{ id: 'c1', type: 'bio', x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false, config: { note: '<script>alert(1)</script>' } }] } },
  ];
  for (const body of attempts) {
    const r = await api('POST', '/api/profile/design', { token: tokenA, body });
    check(r.status === 400, `script payload must be rejected, got ${r.status}`);
  }
  const after = database.queryAll('SELECT COUNT(*) AS c FROM profile_designs');
  check(after[0].c === before[0].c, 'no rows may be written for rejected payloads');
});

// ════════════════════════════════════════════════════════════════════════════
// E. Profile & theme compatibility
// ════════════════════════════════════════════════════════════════════════════
group('Profile & theme compatibility');

let liveDesignId;

test('a profile without a design still returns a working profile (design null)', async () => {
  const uidE = createUserWithProfile('design-none');
  const tokenE = tokenFor(uidE);
  const own = await api('GET', '/api/profile', { token: tokenE });
  check(own.status === 200, `own profile must load, got ${own.status}`);
  check(own.data.design === null, 'own profile must expose a null design');
  check(!!own.data.theme, 'theme must still be attached');

  const pub = await api('GET', '/api/profile/design-none');
  check(pub.status === 200, `public profile must load, got ${pub.status}`);
  check(pub.data.design === null, 'public profile must expose a null design');
});

test('published design is attached to own and public profile responses', async () => {
  // designA is currently published (group C ended by re-publishing it).
  const own = await api('GET', '/api/profile', { token: tokenA });
  check(own.status === 200, `own profile must load, got ${own.status}`);
  check(own.data.design && own.data.design.status === 'published', 'own profile must carry the published design');
  check(own.data.design.id === designA.id, 'own profile must carry the live published id');

  const pub = await api('GET', '/api/profile/design-a');
  check(pub.status === 200, `public profile must load, got ${pub.status}`);
  check(pub.data.design && pub.data.design.status === 'published', 'public profile must carry the published design');
  check(pub.data.design.layout.components.length === 1, 'public design must carry the layout');
});

test('draft designs are never exposed on profiles', async () => {
  // Create one more design and do NOT publish it.
  const r = await api('POST', '/api/profile/design', { token: tokenA, body: { name: 'Unpublished', layout: validLayout() } });
  const draft = r.data.design;
  const pub = await api('GET', '/api/profile/design-a');
  check(pub.data.design.id !== draft.id, 'the draft must not shadow the published design');
  const own = await api('GET', '/api/profile', { token: tokenA });
  check(own.data.design.id === designA.id, 'own profile must keep returning the published design only');
});

test('a published design survives across profile loads with its theme_config', async () => {
  const themed = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Themed', layout: validLayout(), theme: { accentColor: '#7c3aed', cardOpacity: 0.85, backgroundPosition: 'center', backgroundSize: 'cover', backgroundRepeat: 'no-repeat' } },
  });
  const themedPub = await api('POST', `/api/profile/design/${themed.data.design.id}/publish`, { token: tokenA, body: {} });
  check(themedPub.status === 200, `publish must succeed, got ${themedPub.status}`);
  const pub = await api('GET', '/api/profile/design-a');
  check(pub.data.design.id === themed.data.design.id, 'the latest published design must be served');
  check(pub.data.design.theme.accentColor === '#7c3aed', 'design theme_config must round-trip');
  check(pub.data.theme && pub.data.theme.custom, 'the existing theme pipeline must stay intact');
  liveDesignId = themed.data.design.id;
});

test('corrupt stored design JSON never breaks a profile', async () => {
  database.execute(
    "UPDATE profile_designs SET layout_config = '{corrupt json' WHERE id = ?",
    [liveDesignId]
  );
  const pub = await api('GET', '/api/profile/design-a');
  check(pub.status === 200, `public profile must still load, got ${pub.status}`);
  check(pub.data.design === null, 'corrupt stored design must degrade to null');
  const own = await api('GET', '/api/profile', { token: tokenA });
  check(own.status === 200 && own.data.design === null, 'own profile must still load with design null');
});

test('structurally invalid stored design (unknown type) degrades to null', async () => {
  database.execute(
    `UPDATE profile_designs SET layout_config = ? WHERE id = ?`,
    [JSON.stringify({ canvas: { width: 960, minHeight: 1200 }, components: [{ id: 'c', type: 'ghost', x: 0, y: 0, width: 100, height: 100, zIndex: 0, visible: true, locked: false }] }), liveDesignId]
  );
  const pub = await api('GET', '/api/profile/design-a');
  check(pub.status === 200, `public profile must still load, got ${pub.status}`);
  check(pub.data.design === null, 'invalid stored components must degrade to null');
  const own = await api('GET', '/api/profile', { token: tokenA });
  check(own.status === 200 && own.data.design === null, 'own profile still loads');
});

test('registries expose the controlled contract for clients', async () => {
  const profileDesign = await import(mod('server/profileDesign.js'));
  const expected = ['profile_photo', 'name', 'alias', 'bio', 'personal_info', 'gallery', 'testimonials', 'communities'];
  for (const type of expected) {
    check(profileDesign.DESIGN_COMPONENT_TYPES.has(type), `missing controlled type: ${type}`);
  }
  // CREATOR-08 added `profile_guide`; CREATOR-09 added `profile_guide_card`
  // (and keeps the legacy type accepted so a pre-CREATOR-09 design still saves).
  // So the registry is 8 controlled + 4 content + 2 guide types.
  check(profileDesign.DESIGN_COMPONENT_TYPES.size === 14, 'registry must contain the 8 controlled + 4 content types + 2 guide types');
  check(profileDesign.DESIGN_COMPONENT_TYPES.has('profile_guide_card'), 'the guide card type is registered');
  check(profileDesign.DESIGN_COMPONENT_TYPES.has('profile_guide'), 'the legacy guide type is still accepted for saved designs');
});

// ════════════════════════════════════════════════════════════════════════════
// B2. Content components (CREATOR-01B)
// ════════════════════════════════════════════════════════════════════════════
group('Content components');

test('text component with valid config round-trips', async () => {
  const config = {
    text: 'Hello from my profile design',
    fontSize: 24,
    fontWeight: 600,
    textAlign: 'center',
    lineHeight: 1.5,
    textColor: '#334155',
  };
  const r = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Text Comp', layout: { components: [
      { id: 'txt1', type: 'text', x: 10, y: 20, width: 320, height: 96, zIndex: 0, visible: true, locked: false, rotation: 0, config },
    ] } },
  });
  check(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
  const comp = r.data.design.layout.components[0];
  check(comp.config.text === config.text, 'text must round-trip');
  check(comp.config.fontSize === 24 && comp.config.fontWeight === 600, 'font settings must round-trip');
});

test('content config out-of-range values are rejected', async () => {
  const bad = [
    { text: { fontSize: 7 } },
    { text: { fontSize: 'big' } },
    { text: { fontWeight: 950 } },
    { text: { lineHeight: 3.5 } },
    { text: { textAlign: 'justify' } },
    { text: undefined },
  ];
  for (const config of bad) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'BadCfg', layout: { components: [
        { id: randomUUID(), type: 'text', x: 0, y: 0, width: 320, height: 96, zIndex: 0, visible: true, locked: false, config },
      ] } },
    });
    check(r.status === 400, `config ${JSON.stringify(config)} must be rejected, got ${r.status}`);
  }
});

test('image config requires an http(s) URL and valid fit', async () => {
  const good = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Img', layout: { components: [
      { id: 'img1', type: 'image', x: 0, y: 0, width: 360, height: 240, zIndex: 0, visible: true, locked: false, config: { imageUrl: 'https://cdn.example.com/pic.png', fit: 'cover', alt: 'A photo', backgroundColor: '#0f172a' } },
    ] } },
  });
  check(good.status === 201, `expected 201, got ${good.status}`);
  for (const imageUrl of ['javascript:alert(1)', 'ftp://cdn.example.com/a.png', 'data:text/html,hi', 'https://exa mple.com/x']) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'BadImg', layout: { components: [
        { id: randomUUID(), type: 'image', x: 0, y: 0, width: 360, height: 240, zIndex: 0, visible: true, locked: false, config: { imageUrl, fit: 'contain' } },
      ] } },
    });
    check(r.status === 400, `imageUrl ${JSON.stringify(imageUrl)} must be rejected, got ${r.status}`);
  }
  const badFit = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'BadFit', layout: { components: [
      { id: randomUUID(), type: 'sticker', x: 0, y: 0, width: 160, height: 160, zIndex: 0, visible: true, locked: false, config: { imageUrl: 'https://cdn.example.com/s.png', fit: 'stretch' } },
    ] } },
  });
  check(badFit.status === 400, `bad fit must be rejected, got ${badFit.status}`);
});

test('rotation outside 0-360 is rejected', async () => {
  for (const rotation of [-1, 361, '45deg']) {
    const r = await api('POST', '/api/profile/design', {
      token: tokenA,
      body: { name: 'Rot', layout: { components: [
        { id: randomUUID(), type: 'card', x: 0, y: 0, width: 340, height: 190, zIndex: 0, visible: true, locked: false, rotation, config: { heading: 'H', body: 'B' } },
      ] } },
    });
    check(r.status === 400, `rotation ${JSON.stringify(rotation)} must be rejected, got ${r.status}`);
  }
});

test('card component requires a heading and allows body', async () => {
  const good = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'Card', layout: { components: [
      { id: 'card1', type: 'card', x: 0, y: 0, width: 340, height: 190, zIndex: 0, visible: true, locked: false, config: { heading: 'Welcome', body: 'Thanks for visiting', headingColor: '#0e6e6e', textColor: '#2a2130', textAlign: 'center' } },
    ] } },
  });
  check(good.status === 201, `expected 201, got ${good.status}`);
  const missingHeading = await api('POST', '/api/profile/design', {
    token: tokenA,
    body: { name: 'NoHead', layout: { components: [
      { id: randomUUID(), type: 'card', x: 0, y: 0, width: 340, height: 190, zIndex: 0, visible: true, locked: false, config: { body: 'B' } },
    ] } },
  });
  check(missingHeading.status === 400, 'card without a heading must be rejected');
});

// ── Run + report ─────────────────────────────────────────────────────────────
for (const run of queue) await run();

const failed = results.filter(r => !r.ok);
const total = results.length;
console.log('\n' + '═'.repeat(64));
console.log(`CREATOR-01A TESTS: ${total - failed.length}/${total} passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  ✗ ${f.name}\n    ${f.error?.stack || f.error}`);
}

database.closeDatabase();
if (process.env.KEEP_TEST_DIR !== '1') {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

process.exit(failed.length ? 1 : 0);