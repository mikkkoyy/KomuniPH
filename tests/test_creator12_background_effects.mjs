/**
 * CREATOR-12 — Profile Background Effects + the `.kpeffect` extension system.
 *
 * Run:   node tests/test_creator12_background_effects.mjs
 *
 * Covers the validated model, the registry, the `.kpeffect` package security
 * surface, persistence through save/reload/publish, and the CREATOR-10A /
 * CREATOR-11 regressions that must survive.
 *
 * Rendering is verified in a real browser (test_studio_media_nav_e2e.mjs): the
 * effect renderer needs a DOM and a canvas, so asserting it here would only be
 * asserting a mock. What IS assertable here is that the stored model is sound
 * and that the server refuses everything it must refuse.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { buildZip, goodManifest, goodDefinition } from './_zip.js';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-c12-'));
const EFFECT_DIR = join(TMP_DIR, 'creator-effects');
process.env.DATABASE_PATH = join(TMP_DIR, 'test-c12.db');
process.env.PORT = String(18900 + (process.pid % 300));
process.env.SECRET_KEY = 'creator-12-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.UPLOAD_CREATOR_DIR = join(TMP_DIR, 'uploads-creator');
process.env.UPLOAD_CREATOR_EFFECT_DIR = EFFECT_DIR;

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;

await import(mod('server/database.js'));
const { queryOne, execute } = await import(mod('server/database.js'));
const server = await import(mod('server/creatorEffects.js'));
const effects = await import(mod('web/js/backgroundEffects.js'));
const design = await import(mod('server/profileDesign.js'));
await import(mod('server/index.js'));

let passed = 0;
let failed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    failed += 1;
    failures.push({ name, error: err });
    process.stdout.write(`  FAIL ${name} — ${err.message}\n`);
  }
}
function check(cond, msg = 'condition failed') { if (!cond) throw new Error(msg); }
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
async function rejects(fn, label) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error(`${label} was accepted but must be rejected`);
}

let seq = 0;
async function makeUser(tag) {
  seq += 1;
  const username = `${tag}_${seq}_${process.pid}`.slice(0, 30);
  const r = await api('POST', '/api/auth/register', {
    body: { username, email: `${username}@test.local`, password: 'password123' },
  });
  if (r.status !== 201) throw new Error(`register failed: ${r.status}`);
  return { username, token: r.data.access_token };
}
async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const BG = '/uploads/creator/bg.webp';
const canvas = { canvas: { width: 960, minHeight: 1200 }, components: [] };
const png = await sharp({
  create: { width: 20, height: 20, channels: 4, background: { r: 200, g: 230, b: 255, alpha: 1 } },
}).png().toBuffer();

const validPackage = (over = {}) => buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest({ preview: 'preview.png', ...(over.manifest || {}) })) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition(over.definition || {})) },
  { name: 'assets/flake.png', data: png },
  { name: 'preview.png', data: png },
]);

// ═══════════════════════════════════════════════════════════════════════════
// Model — the effect is INDEPENDENT of the background image
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-12: image and effect are four independent combinations', async () => {
  const u = await makeUser('c12_combo');
  const effect = { enabled: true, effectId: 'builtin.snow', source: 'builtin', version: 1, config: { count: 50 } };
  const combos = [
    ['image only', { backgroundImage: BG }, null],
    ['effect only', {}, effect],
    ['image + effect', { backgroundImage: BG }, effect],
    ['neither', {}, null],
  ];
  for (const [label, themeFields, effectField] of combos) {
    const theme = { ...themeFields };
    if (effectField) theme.backgroundEffect = effectField;
    const r = await api('POST', '/api/profile/design', { token: u.token, body: { name: label, layout: canvas, theme } });
    check(r.status === 201, `${label} is valid, got ${r.status}: ${JSON.stringify(r.data)}`);
    const stored = r.data.design.theme || {};
    eq(stored.backgroundImage || '', themeFields.backgroundImage || '', `${label}: background image`);
    eq((stored.backgroundEffect && stored.backgroundEffect.effectId) || '', (effectField && effectField.effectId) || '',
      `${label}: background effect`);
  }
});

await test('CREATOR-12: the effect is design-level, never a component', async () => {
  const u = await makeUser('c12_designlevel');
  const r = await api('POST', '/api/profile/design', {
    token: u.token,
    body: {
      name: 'Effect only',
      layout: canvas,
      theme: { backgroundEffect: { enabled: true, effectId: 'builtin.rain', source: 'builtin', version: 1 } },
    },
  });
  check(r.status === 201, 'an effect-only design saves');
  eq(r.data.design.layout.components.length, 0, 'the effect created no component');
  check(!r.data.design.layout.components.some(c => /effect|particle|snow/i.test(c.type || '')),
    'no effect-like component was invented');
  // And it survives reload and publish.
  const fetched = await api('GET', `/api/profile/design/${r.data.design.id}`, { token: u.token });
  eq(fetched.data.design.theme.backgroundEffect.effectId, 'builtin.rain', 'the effect survives a reload');
  const pub = await api('POST', `/api/profile/design/${r.data.design.id}/publish`, { token: u.token });
  check(pub.status === 200, 'an effect-only design publishes');
  const profile = await api('GET', `/api/profile/${u.username}`);
  eq(profile.data.design.theme.backgroundEffect.effectId, 'builtin.rain', 'the public profile receives the effect');
});

await test('CREATOR-12: a design with no effect renders exactly as before (no migration)', async () => {
  const u = await makeUser('c12_legacy');
  // A pre-CREATOR-12 design: background image, no backgroundEffect key at all.
  const created = await api('POST', '/api/profile/design', {
    token: u.token, body: { name: 'Pre-CREATOR-12', layout: canvas, theme: { backgroundImage: BG } },
  });
  check(created.status === 201, 'an old design still saves');
  const theme = created.data.design.theme;
  check(!theme.backgroundEffect, 'no effect was invented on load');
  eq(theme.backgroundImage, BG, 'the background image is untouched');
  // And it publishes without an effect.
  await api('POST', `/api/profile/design/${created.data.design.id}/publish`, { token: u.token });
  const profile = await api('GET', `/api/profile/${u.username}`);
  check(profile.status === 200, 'an old design still publishes and renders');
  check(!profile.data.design.theme.backgroundEffect, 'the published design has no effect');
});

await test('CREATOR-12: active effect persists, removal persists, and stays independent', async () => {
  const u = await makeUser('c12_lifecycle');
  const withBoth = await api('POST', '/api/profile/design', {
    token: u.token,
    body: {
      name: 'Both',
      layout: canvas,
      theme: {
        backgroundImage: BG,
        backgroundSize: 'contain',
        backgroundEffect: { enabled: true, effectId: 'builtin.stars', source: 'builtin', version: 1, config: { count: 20 } },
      },
    },
  });
  check(withBoth.status === 201, 'image + effect saves');
  const id = withBoth.data.design.id;

  // Remove ONLY the effect; the image must survive untouched.
  const withoutEffect = await api('PATCH', `/api/profile/design/${id}`, {
    token: u.token, body: { theme: { backgroundImage: BG, backgroundSize: 'contain', backgroundEffect: null } },
  });
  check(withoutEffect.status === 200, `removing the effect saves, got ${withoutEffect.status}`);
  const theme = withoutEffect.data.design.theme;
  eq(theme.backgroundImage, BG, 'the background image survived removing the effect');
  eq(theme.backgroundSize, 'contain', 'the background size survived removing the effect');
  check(!theme.backgroundEffect, 'the effect is gone');

  // Re-add and confirm reload.
  const reAdded = await api('PATCH', `/api/profile/design/${id}`, {
    token: u.token,
    body: { theme: { backgroundImage: BG, backgroundEffect: { enabled: true, effectId: 'builtin.stars', source: 'builtin', version: 1 } } },
  });
  check(reAdded.status === 200, 're-adding the effect saves');
  const reloaded = await api('GET', `/api/profile/design/${id}`, { token: u.token });
  eq(reloaded.data.design.theme.backgroundEffect.effectId, 'builtin.stars', 'the re-added effect survives a reload');
  eq(reloaded.data.design.theme.backgroundImage, BG, 'the image is still there after the effect round trip');
});

await test('CREATOR-12: enabled:false is the way to say "no effect"', async () => {
  const u = await makeUser('c12_disabled');
  const r = await api('POST', '/api/profile/design', {
    token: u.token,
    body: { name: 'Off', layout: canvas, theme: { backgroundEffect: { enabled: false } } },
  });
  check(r.status === 201, 'enabled:false is accepted');
  const effect = r.data.design.theme.backgroundEffect;
  eq(effect.enabled, false, 'the effect is stored as disabled');
  check(!effect.effectId, 'no effect id is needed when disabled');
  // "none" as an effectId is refused, because it has two spellings otherwise.
  const bad = await api('POST', '/api/profile/design', {
    token: u.token,
    body: { name: 'Bad', layout: canvas, theme: { backgroundEffect: { enabled: true, effectId: 'none' } } },
  });
  check(bad.status === 400, '"none" as an effectId is rejected in favour of enabled:false');
});

// ═══════════════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-12: all built-in effects are registered and mirrored on both sides', () => {
  const ids = Object.keys(effects.BUILTIN_EFFECTS);
  eq(ids.length, 9, 'there are nine built-in effects');
  for (const want of ['builtin.snow', 'builtin.rain', 'builtin.fire', 'builtin.smoke', 'builtin.lightning',
    'builtin.leaves', 'builtin.petals', 'builtin.sparkles', 'builtin.stars']) {
    check(ids.includes(want), `built-in "${want}" is registered`);
  }
  for (const [id, e] of Object.entries(effects.BUILTIN_EFFECTS)) {
    check(typeof e.name === 'string' && e.name.length > 0, `${id} has a name`);
    check(effects.EFFECT_ENGINES.has(e.engine), `${id} uses a known engine (${e.engine})`);
    eq(e.version, 1, `${id} is version 1`);
    check(e.reducedMotion === 'static' || e.reducedMotion === 'none', `${id} declares reduced-motion behaviour`);
    // A built-in's own config must satisfy its engine schema.
    const errs = [];
    server.validateEffectConfig(e.engine, e.defaultConfig, { errors: errs, prefix: 'cfg' });
    eq(errs.length, 0, `${id} default config is valid: ${errs.join('; ')}`);
  }
  // Client and server registries must not drift.
  eq(JSON.stringify([...server.BUILTIN_EFFECT_IDS].sort()), JSON.stringify(ids.slice().sort()),
    'server and client built-in sets are identical');
});

await test('CREATOR-12: the four engines are the only ones, and unknown is rejected', () => {
  eq([...effects.EFFECT_ENGINES].sort().join(','), 'atmosphere,lighting,overlay,particles',
    'the engine set is exactly the four controlled primitives');
  // validateEffectDefinition RETURNS its errors.
  const unknown = server.validateEffectDefinition({ engine: 'wasm-runner' }, new Set());
  check(unknown.length > 0, 'an unknown engine is rejected');
  check(/engine must be one of/.test(unknown[0]), `the reason names the allowed engines: ${unknown[0]}`);
  eq(server.validateEffectDefinition({ engine: 'particles', config: { count: 1 } }, new Set()).length, 0,
    'a known engine is accepted');
});

await test('CREATOR-12: unknown and hostile effect references are rejected', async () => {
  const u = await makeUser('c12_refs');
  const bad = [
    { enabled: true, effectId: 'builtin.nope', source: 'builtin' },
    { enabled: true, effectId: 'evil', source: 'builtin' },
    { enabled: true, effectId: 'builtin.snow', source: 'hacker' },
    { enabled: true, effectId: 'builtin.snow', source: 'builtin', config: { count: 100000 } },
    { enabled: true, effectId: 'builtin.snow', source: 'builtin', config: { count: -5 } },
    { enabled: true, effectId: 'builtin.snow', source: 'builtin', config: { eval: 'x' } },
    { enabled: true, effectId: 'builtin.snow', source: 'builtin', css: 'body{}' },
    { enabled: true, effectId: 'builtin.snow', source: 'builtin', engine: 'particles' },
    { enabled: true },
    'snow',
  ];
  for (const backgroundEffect of bad) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token, body: { name: 'bad', layout: canvas, theme: { backgroundEffect } },
    });
    check(r.status === 400, `${JSON.stringify(backgroundEffect)} is rejected, got ${r.status}`);
  }
});

await test('CREATOR-12: the renderer clamps anything that slips past validation', () => {
  // Last line of defence: even a hand-edited config cannot push the renderer out
  // of bounds.
  const clamped = effects.clampEffectConfig('particles', { count: 1e9, speed: -50, size: 1e6, opacity: 5, junk: 1 });
  eq(clamped.count, effects.EFFECT_LIMITS.maxParticles, 'an enormous particle count is clamped');
  eq(clamped.speed, 0, 'a negative speed is clamped up');
  eq(clamped.size, 200, 'an enormous size is clamped');
  eq(clamped.opacity, 1, 'an out-of-range opacity is clamped');
  check(!('junk' in clamped), 'an unknown key is dropped entirely');
  const unknownEngine = effects.clampEffectConfig('not-an-engine', { count: 5 });
  eq(Object.keys(unknownEngine).length, 0, 'an unknown engine clamps to nothing');
});

// ═══════════════════════════════════════════════════════════════════════════
// .kpeffect package security (the highest-priority section)
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-12: a valid .kpeffect package is accepted and installed', async () => {
  const u = await makeUser('c12_valid');
  const result = await server.installPackage(findUserId(u.username), validPackage());
  eq(result.effectId, 'creator.snowfall', 'the effect id comes from the manifest');
  eq(result.status, 'published', 'a validated package is installed as published');
  eq(result.engine, 'particles', 'the engine comes from the validated definition');
  check(!!result.previewPath, 'a preview path was generated');
  // Only sanitised, re-encoded output is on disk.
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(join(EFFECT_DIR, `${u.username === '' ? '' : findUserId(u.username)}_${result.id}`));
  for (const f of files) {
    check(f.endsWith('.webp'), `only re-encoded WebP is stored (found ${f})`);
  }
});

await test('CREATOR-12: a package must never be able to ship code', async () => {
  const uid = createProbeUser();
  for (const [label, name, body] of [
    ['JavaScript', 'assets/evil.js', 'alert(document.cookie)'],
    ['ES module', 'assets/evil.mjs', 'export default 1'],
    ['CommonJS', 'assets/evil.cjs', 'module.exports=1'],
    ['WebAssembly', 'assets/evil.wasm', Buffer.from([0x00, 0x61, 0x73, 0x6d])],
    ['HTML', 'assets/evil.html', '<script>alert(1)</script>'],
    ['TypeScript', 'assets/evil.ts', 'const x: number = 1'],
  ]) {
    const err = await rejects(() => server.installPackage(uid, buildZip([
      { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
      { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
      { name, data: body },
    ])), label);
    check(/must not contain|unexpected file type/.test(err.message), `${label} is refused for being code: ${err.message}`);
  }
});

await test('CREATOR-12: a package must never be able to ship markup or an unsafe SVG', async () => {
  const uid = createProbeUser();
  for (const [label, name, body] of [
    ['SVG with script', 'assets/x.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['SVG with onload', 'assets/y.svg', '<svg onload="alert(1)"></svg>'],
    ['XML', 'assets/x.xml', '<root><script/></root>'],
    ['XHTML', 'assets/x.xhtml', '<html/>'],
  ]) {
    const err = await rejects(() => server.installPackage(uid, buildZip([
      { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
      { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
      { name, data: body },
    ])), label);
    check(/\.svg|\.xml|\.xhtml|unexpected/.test(err.message), `${label} is refused: ${err.message}`);
  }
});

await test('CREATOR-12: path traversal and absolute paths are refused', async () => {
  const uid = createProbeUser();
  for (const [label, name] of [
    ['parent traversal', '../../evil.png'],
    ['embedded traversal', 'assets/../../evil.png'],
    ['absolute unix', '/etc/passwd'],
    ['absolute windows', 'C:/Windows/evil.png'],
    ['unc path', '//server/share/evil.png'],
    ['backslash separator', 'assets\\evil.png'],
    ['URL in manifest ref', 'https://evil.test/x.png'],
  ]) {
    const err = await rejects(() => server.inspectPackage(buildZip([
      { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
      { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
      { name, data: png },
    ])), label);
    check(err.message.length > 0, `${label} is refused with a reason: ${err.message}`);
  }
  // And the standalone guard, independent of the archive reader.
  for (const bad of ['../x', '/x', 'C:\\x', '\\\\srv\\x', 'a\\b', 'https://x/y', 'data:image/png;base64,AA']) {
    const err = server.validatePackageRelativePath(bad);
    check(err !== null, `"${bad}" is refused by the path guard`);
  }
  check(server.validatePackageRelativePath('assets/snow.png') === null, 'a normal package-relative path is allowed');
});

await test('CREATOR-12: archive limits are enforced', async () => {
  const uid = createProbeUser();
  // Too many files.
  await rejects(() => server.inspectPackage(buildZip([
    { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
    { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
    ...Array.from({ length: server.PACKAGE_LIMITS.maxEntries + 4 }, (_, i) => ({ name: `assets/f${i}.png`, data: png })),
  ])), 'too many files');
  // Oversized archive.
  await rejects(() => server.inspectPackage(Buffer.alloc(server.PACKAGE_LIMITS.maxPackageBytes + 1024)), 'oversized archive');
  // A zip bomb: a huge run of zeroes compresses to almost nothing, so the
  // compression-ratio guard is what stops it.
  const bomb = buildZip([
    { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
    { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
    { name: 'assets/bomb.bin', data: Buffer.alloc(40 * 1024 * 1024) },
  ]);
  await rejects(() => server.inspectPackage(bomb), 'zip bomb');
  // A file whose header under-reports its size cannot exceed the per-entry cap.
  await rejects(() => server.sanitiseAsset(Buffer.alloc(server.PACKAGE_LIMITS.maxAssetBytes + 4096), 'x.png'), 'oversized asset');
});

await test('CREATOR-12: an asset that is not a real image is refused', async () => {
  for (const [label, data] of [
    ['a script renamed .png', Buffer.from('alert(1)')],
    ['an empty file', Buffer.alloc(0)],
  ]) {
    const err = await rejects(() => server.sanitiseAsset(data, 'asset'), label);
    check(/not a readable image|is empty/.test(err.message), `${label} is refused: ${err.message}`);
  }
  // A real image passes and comes back re-encoded.
  const clean = await server.sanitiseAsset(png, 'flake.png');
  const meta = await sharp(clean.data).metadata();
  eq(String(meta.format), 'webp', 'a valid image is re-encoded to WebP');
});

await test('CREATOR-12: manifest and definition are strictly validated', async () => {
  const uid = createProbeUser();
  const badManifests = [
    ['missing format', { format: undefined }],
    ['wrong format', { format: 'something-else' }],
    ['wrong formatVersion', { formatVersion: 99 }],
    ['wrong type', { type: 'profile-design' }],
    ['missing id', { id: undefined }],
    ['uppercase id', { id: 'Creator.Snow' }],
    ['path-like id', { id: '../../etc/passwd' }],
    ['short id', { id: 'a' }],
    ['long name', { name: 'x'.repeat(200) }],
    ['bad version', { version: 'one' }],
    ['extra field', { script: 'alert(1)' }],
    ['absolute effect path', { effect: '/etc/effect.json' }],
  ];
  for (const [label, over] of badManifests) {
    const err = await rejects(() => server.inspectPackage(buildZip([
      { name: 'manifest.json', data: JSON.stringify(goodManifest(over)) },
      { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
    ])), label);
    check(err.message.length > 0, `${label} is refused: ${err.message}`);
  }

  const badDefinitions = [
    ['unknown engine', { engine: 'exec' }],
    ['missing engine', { engine: undefined }],
    ['unknown field', { script: 'x' }],
    ['out-of-range count', { config: { count: 100000 } }],
    ['negative speed', { config: { speed: -1 } }],
    ['unknown config key', { config: { nope: 1 } }],
    ['bad direction', { config: { direction: 'sideways' } }],
    ['non-boolean loop', { loop: 'yes' }],
    ['texture not in package', { texture: 'assets/absent.png' }],
    ['texture is a URL', { texture: 'https://evil.test/x.png' }],
  ];
  for (const [label, over] of badDefinitions) {
    const err = await rejects(() => server.inspectPackage(buildZip([
      { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
      { name: 'effect/effect.json', data: JSON.stringify(goodDefinition(over)) },
    ])), label);
    check(err.message.length > 0, `${label} is refused: ${err.message}`);
  }
});

await test('CREATOR-12: a duplicate effect id is refused for the same creator only', async () => {
  const u = await makeUser('c12_dup');
  const a = findUserId(u.username);
  const b = createProbeUser();
  await server.installPackage(a, validPackage());
  const err = await rejects(() => server.installPackage(a, validPackage()), 'duplicate for the same creator');
  eq(err.status, 409, 'a duplicate id is a conflict for its owner');
  // A different creator may install the same id; they are separate effects.
  const other = await server.installPackage(b, validPackage());
  eq(other.effectId, 'creator.snowfall', 'another creator can install the same effect id');
});

await test('CREATOR-12: a rejected package leaves nothing on disk', async () => {
  const { readdirSync } = await import('node:fs');
  const uid = createProbeUser();
  const before = readdirSync(EFFECT_DIR).length;
  await rejects(() => server.installPackage(uid, buildZip([
    { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
    { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
    { name: 'assets/evil.js', data: 'alert(1)' },
  ])), 'executable package');
  eq(readdirSync(EFFECT_DIR).length, before, 'a rejected package created no directory');
});

await test('CREATOR-12: one creator cannot touch another creator\'s effect', async () => {
  const u = await makeUser('c12_owner');
  const mine = await server.installPackage(findUserId(u.username), validPackage());
  const other = createProbeUser();
  const err = await rejects(() => server.archiveEffect(other, mine.id), 'cross-owner archive');
  eq(err.status, 404, 'archiving another creator\'s effect is not found');
  eq(server.listPublishedCreatorEffects(findUserId(u.username)).length, 1, 'the effect is still published for its owner');
  const archived = server.archiveEffect(findUserId(u.username), mine.id);
  eq(archived.status, 'archived', 'the owner can archive their own effect');
  eq(server.listPublishedCreatorEffects(findUserId(u.username)).length, 0, 'an archived effect is no longer selectable');
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATOR-10A / CREATOR-11 regressions
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-12: the CREATOR-10A background IMAGE states still work alongside an effect', async () => {
  const u = await makeUser('c12_c10a');
  // Every CREATOR-10A background theme field must still validate unchanged.
  for (const theme of [
    { backgroundImage: BG },
    { backgroundImage: BG, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' },
    { backgroundImage: 'javascript:alert(1)' },
    { backgroundSize: 'squish' },
    { backgroundEffect: { enabled: true, effectId: 'builtin.snow', source: 'builtin' }, backgroundImage: BG },
  ]) {
    const expected = theme.backgroundImage === 'javascript:alert(1)' || theme.backgroundSize === 'squish' ? 400 : 201;
    const r = await api('POST', '/api/profile/design', { token: u.token, body: { name: 't', layout: canvas, theme } });
    eq(r.status, expected, `background theme ${JSON.stringify(theme)} -> ${expected}`);
  }
  // The design-level URL validation is still the strict one.
  eq(design.validateDesignPayload({
    name: 'x', layout: canvas, theme: { backgroundImage: 'data:image/png;base64,AA' },
  }).errors.length > 0, true, 'a data: background is still rejected on a design');
});

await test('CREATOR-12: CREATOR-11 fonts, component animation and card masking are untouched', async () => {
  const u = await makeUser('c12_c11');
  const withEverything = await api('POST', '/api/profile/design', {
    token: u.token,
    body: {
      name: 'Everything',
      layout: {
        canvas: { width: 960, minHeight: 1200 },
        components: [
          { id: 't1', type: 'text', x: 0, y: 0, width: 200, height: 60, zIndex: 0, visible: true, locked: false,
            config: { text: 'Hi', fontFamily: 'georgia', fontStyle: 'italic', animation: { name: 'float', duration: 2, delay: 0, iteration: 'infinite', timing: 'ease-in-out' } } },
          { id: 'c1', type: 'card', x: 0, y: 80, width: 400, height: 300, zIndex: 1, visible: true, locked: false, config: { heading: 'H', mask: true } },
          { id: 'i1', type: 'image', parentId: 'c1', x: 10, y: 10, width: 200, height: 120, zIndex: 0, visible: true, locked: false, config: { imageUrl: '/uploads/creator/a.webp', fit: 'cover' } },
        ],
      },
      theme: { backgroundImage: BG, backgroundEffect: { enabled: true, effectId: 'builtin.fire', source: 'builtin', version: 1 } },
    },
  });
  check(withEverything.status === 201, `fonts + animation + masking + effect coexist, got ${withEverything.status}: ${JSON.stringify(withEverything.data)}`);
  const byId = new Map(withEverything.data.design.layout.components.map(c => [c.id, c]));
  eq(byId.get('t1').config.fontFamily, 'georgia', 'the font survives');
  eq(byId.get('t1').config.animation.name, 'float', 'the component animation survives');
  eq(byId.get('i1').parentId, 'c1', 'the card masking relationship survives');
  eq(withEverything.data.design.theme.backgroundEffect.effectId, 'builtin.fire', 'the background effect survives');
  // The two animation concepts stay separate: an effect is theme-level, a
  // component animation is component-level.
  check(!JSON.stringify(byId.get('t1')).includes('builtin.fire'), 'a background effect never leaks into a component');
});

// ── local helpers ────────────────────────────────────────────────────────────
/** Create a real user row (the effect tables foreign-key to users). */
function createProbeUser() {
  const id = `probe_${Math.random().toString(36).slice(2, 10)}`;
  execute(
    "INSERT OR IGNORE INTO users (id, username, email, password_hash, role, created_at) VALUES (?,?,?,?,?,datetime('now'))",
    [id, id, `${id}@test.local`, 'not-a-real-hash', 'user'],
  );
  return id;
}

function findUserId(username) {
  const row = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (!row) throw new Error(`no user row for ${username}`);
  return row.id;
}

process.stdout.write('\n════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-12 BACKGROUND EFFECTS TESTS: ${passed}/${passed + failed} passed\n`);
if (failed > 0) {
  process.stdout.write('FAILURES:\n');
  for (const f of failures) process.stdout.write(`  ✗ ${f.name}\n    ${f.error.message}\n`);
}
process.exit(failed > 0 ? 1 : 0);
