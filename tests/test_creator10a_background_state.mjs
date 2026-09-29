/**
 * CREATOR-10A — Profile Background state clarity in Creator Studio.
 *
 * Run:   node tests/test_creator10a_background_state.mjs
 *
 * Two layers are covered:
 *
 *   1. the model + source contract — the background is still design-level theme
 *      configuration (never a component), the state vocabulary is explicit, and
 *      a staged upload is editor state rather than stored design data;
 *   2. the API round trip — a background set in the Studio survives save, reload
 *      and publish, and a removed one comes back as genuinely absent.
 *
 * The visible-UI assertions live in the browser E2E (test_studio_media_nav_e2e.mjs),
 * because "the creator can tell the state at a glance" is a claim about rendered
 * text, not about a JavaScript object.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-c10a-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-c10a.db');
process.env.PORT = String(19000 + (process.pid % 300));
process.env.SECRET_KEY = 'creator-10a-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.UPLOAD_CREATOR_DIR = join(TMP_DIR, 'uploads-creator');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;

await import(mod('server/database.js'));
const server = await import(mod('server/profileDesign.js'));
const client = await import(mod('web/js/profileDesign.js'));
await import(mod('server/index.js'));

const { readFileSync: read } = await import('node:fs');
const studioSrc = read(resolve('web/js/creatorStudio.js'), 'utf8');

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

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

let seq = 0;
async function makeUser(tag) {
  seq += 1;
  const username = `${tag}_${seq}_${process.pid}`.slice(0, 30);
  const r = await api('POST', '/api/auth/register', {
    body: { username, email: `${username}@test.local`, password: 'password123' },
  });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { username, token: r.data.access_token };
}

const BG = '/uploads/creator/profile-background.webp';
const canvas = { canvas: { width: 960, minHeight: 1200 }, components: [] };

// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-10A: the background is still design-level theme, never a component', () => {
  // The whole point of CREATOR-10, which this task must not regress.
  check(studioSrc.includes('function profileBackgroundProperties'),
    'the Profile Background control still lives in the Properties panel');
  check(studioSrc.includes('t.backgroundImage = next'),
    'applying still writes design-level theme configuration');
  check(!/backgroundImage[\s\S]{0,200}type:\s*'image'/.test(studioSrc),
    'the background never becomes an image component');
  // A design with a background and no components must still be valid and
  // component-free.
  const result = server.validateDesignPayload({
    name: 'bg only',
    layout: canvas,
    theme: { backgroundImage: BG, backgroundSize: 'cover' },
  });
  eq(result.errors.length, 0, 'a background-only design validates');
  eq(result.data.layout.components.length, 0, 'the background created no component');
  eq(result.data.theme.backgroundImage, BG, 'the background is on the theme');
});

await test('CREATOR-10A: the state model has four explicit, distinct states', () => {
  // backgroundState() is the single source of truth the panel renders from.
  const body = studioSrc.slice(studioSrc.indexOf('function backgroundState'));
  const end = body.indexOf('\n}');
  const state = body.slice(0, end);
  for (const key of ["'none'", "'pending'", "'active'", "'replace'"]) {
    check(state.includes(`return { key: ${key}`), `the "${key}" state exists`);
  }
  // Each state carries a human-readable label for the chip.
  check(/label: 'NOT SET'/.test(state), 'the none state is labelled NOT SET');
  check(/label: 'ACTIVE'/.test(state), 'the active state is labelled ACTIVE');
  check(/label: 'UPLOADED — NOT ACTIVE'/.test(state), 'a staged upload is labelled as not active');
  check(/label: 'REPLACEMENT READY'/.test(state), 'a staged swap is labelled REPLACEMENT READY');
  // ACTIVE is derived from the saved theme, never from editor state: that is
  // what makes it survive a reload.
  check(state.includes('const active = backgroundImageUrl();'),
    'the active state is derived from theme.backgroundImage');
  // A staged upload is deliberately NOT part of the active decision.
  check(state.includes('if (active) return'), 'a staged upload never becomes active on its own');
});

await test('CREATOR-10A: a staged upload is editor state, never stored design data', () => {
  // CREATOR-10's core promise: an upload alone must not imply the image is
  // active. The staged URL therefore lives outside the design.
  check(studioSrc.includes('let pendingBackgroundUrl ='), 'the staged upload is a module-level editor variable');
  check(!/pendingBackgroundUrl\s*=\s*t\.backgroundImage/.test(studioSrc),
    'a staged upload is never written into the theme');
  check(studioSrc.includes('t.backgroundImage = next;'),
    'only the explicit apply writes the theme background');
  // The staged upload must be discarded whenever the design changes, or it would
  // follow the creator to a different design as a phantom background.
  const resets = (studioSrc.match(/resetPendingBackground\(\);/g) || []).length;
  const assignments = (studioSrc.match(/currentDesign = normalizeDesign\(/g) || []).length;
  check(resets >= assignments,
    `every design swap discards the staged upload (${resets} resets for ${assignments} swaps)`);
  // And it survives an unrelated re-render, which is why it is module-level and
  // not a local of the properties closure.
  const panelStart = studioSrc.indexOf('function profileBackgroundProperties');
  const panel = studioSrc.slice(panelStart, studioSrc.indexOf('\nfunction canvasProperties', panelStart));
  check(!panel.includes('let pendingUrl'), 'the staged upload is not closure-local');
});

await test('CREATOR-10A: the apply action only appears when it would do something', () => {
  const panelStart = studioSrc.indexOf('function profileBackgroundProperties');
  const panel = studioSrc.slice(panelStart, studioSrc.indexOf('\nfunction canvasProperties', panelStart));
  // With an already-active background and nothing staged, there must be no
  // "Set as Profile Background" button sitting there looking actionable.
  check(panel.includes('applyBtn.hidden = !state.pending;'),
    'the apply button is hidden unless a staged image is waiting');
  check(panel.includes('const replacing = state.key === \'replace\';'),
    'the panel distinguishes replacing from first-time activation');
  check(panel.includes("applyBtn.textContent = replacing ? 'Replace Profile Background' : 'Set as Profile Background'"),
    'the button says Replace when a background is already active');
  check(panel.includes('clearBtn.hidden = !isActive;'),
    'Remove is offered only when a background is active');
  // Presentation controls are scoped to the active background.
  check(panel.includes('field.disabled = !isActive;'),
    'Size/Position/Repeat are disabled when no background is active');
});

await test('CREATOR-10A: the active state is reconstructed from the saved design', async () => {
  const u = await makeUser('c10a_reload');
  const created = await api('POST', '/api/profile/design', {
    token: u.token,
    body: { name: 'With background', layout: canvas, theme: { backgroundImage: BG, backgroundSize: 'cover' } },
  });
  check(created.status === 201, `the design saves, got ${created.status}`);
  const id = created.data.design.id;

  const reloaded = await api('GET', `/api/profile/design/${id}`, { token: u.token });
  check(reloaded.status === 200, 'the design reloads');
  eq(reloaded.data.design.theme.backgroundImage, BG,
    'the active background is reconstructed from theme.backgroundImage');
  eq(reloaded.data.design.layout.components.length, 0,
    'reloading a background does not invent a component');

  // Publishing carries it, and the public profile receives it.
  const published = await api('POST', `/api/profile/design/${id}/publish`, { token: u.token });
  check(published.status === 200, 'the design publishes');
  const profile = await api('GET', `/api/profile/${u.username}`);
  check(profile.status === 200, 'the public profile loads');
  eq(profile.data.design.theme.backgroundImage, BG, 'the public profile receives the active background');
});

await test('CREATOR-10A: removing the background leaves no stale value', async () => {
  const u = await makeUser('c10a_remove');
  const created = await api('POST', '/api/profile/design', {
    token: u.token,
    body: { name: 'To remove', layout: canvas, theme: { backgroundImage: BG } },
  });
  const id = created.data.design.id;
  // The Studio removes it by omitting the key entirely, so re-save without it.
  const cleared = await api('PATCH', `/api/profile/design/${id}`, {
    token: u.token,
    body: { theme: { backgroundImage: '' } },
  });
  check(cleared.status === 200, `saving without a background works, got ${cleared.status}: ${JSON.stringify(cleared.data)}`);
  const stored = cleared.data.design.theme && cleared.data.design.theme.backgroundImage;
  check(!stored, `no stale background URL remains, got ${JSON.stringify(stored)}`);

  const reloaded = await api('GET', `/api/profile/design/${id}`, { token: u.token });
  const after = reloaded.data.design.theme && reloaded.data.design.theme.backgroundImage;
  check(!after, `a reload confirms the background is gone, got ${JSON.stringify(after)}`);

  // A design that never had a background is equally valid.
  const never = await api('POST', '/api/profile/design', {
    token: u.token, body: { name: 'Never had one', layout: canvas },
  });
  check(never.status === 201, 'a design with no background theme is valid');
  const neverTheme = never.data.design.theme;
  check(!neverTheme || !neverTheme.backgroundImage, 'no background is invented for a fresh design');
});

await test('CREATOR-10A: background storage semantics are unchanged from CREATOR-10', async () => {
  const u = await makeUser('c10a_unchanged');
  // The same URL validation CREATOR-10 introduced must still hold.
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AA', '//evil.example/x.png', 'file:///etc/passwd']) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token, body: { name: 'bad', layout: canvas, theme: { backgroundImage: bad } },
    });
    check(r.status === 400, `background "${bad}" is still rejected, got ${r.status}`);
  }
  for (const good of ['https://example.com/bg.png', BG]) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token, body: { name: 'good', layout: canvas, theme: { backgroundImage: good } },
    });
    check(r.status === 201, `background "${good}" is still accepted, got ${r.status}`);
  }
  // Presentation values keep their existing bounds.
  for (const theme of [{ backgroundSize: 'squish' }, { backgroundPosition: 'nowhere' }, { backgroundRepeat: 'diagonal' }]) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token, body: { name: 'bad pres', layout: canvas, theme },
    });
    check(r.status === 400, `${JSON.stringify(theme)} is still rejected, got ${r.status}`);
  }
  // And it is still not a theme on a plain profile edit that the design path
  // tightened: the design validator is the strict one.
  check(typeof server.validateDesignPayload === 'function', 'the design validator is still the entry point');
  void client;
});

await test('CREATOR-10A: the panel wires the chip, preview tag and pending row', () => {
  const panelStart = studioSrc.indexOf('function profileBackgroundProperties');
  const panel = studioSrc.slice(panelStart, studioSrc.indexOf('\nfunction canvasProperties', panelStart));
  // The state chip a creator actually reads.
  check(panel.includes("chip.id = 'studio-background-state';"), 'the state chip has a stable id');
  check(panel.includes("chip.dataset.state = state.key;"), 'the chip mirrors the state for assertions');
  check(panel.includes("state.key === 'active' ? '✓ ACTIVE' : state.label"),
    'the active chip is prefixed with a tick');
  // The preview is labelled in place, not just implied by showing a picture.
  check(panel.includes("tag.textContent = 'ACTIVE BACKGROUND';"),
    'the active preview is tagged ACTIVE BACKGROUND');
  check(panel.includes("id = 'studio-background-empty'"),
    'the no-background preview has its own state text');
  // A staged upload is shown separately and explicitly marked as not active.
  check(panel.includes("pendingBox.id = 'studio-background-pending'"), 'the pending row has a stable id');
  check(panel.includes("'Uploaded — ready to set as your Profile Background. Not active yet.'"),
    'a first-time staged upload says it is not active yet');
  check(panel.includes("'Uploaded — ready to REPLACE the active background. Not applied yet.'"),
    'a staged replacement says the current background is still active');
  // Status text names the state in words for each of the four cases.
  for (const [key, marker] of [
    ['none', 'No Profile Background is set.'],
    ['pending', 'Ready to set as Profile Background'],
    ['active', 'Profile background is active and sits behind the entire profile'],
    ['replace', 'Replacement uploaded.'],
  ]) {
    check(panel.includes(marker), `the ${key} status line states the situation`);
  }
});

await test('CREATOR-10A: applying is instant — no reload needed to see the change', () => {
  const panelStart = studioSrc.indexOf('function profileBackgroundProperties');
  const panel = studioSrc.slice(panelStart, studioSrc.indexOf('\nfunction canvasProperties', panelStart));
  // Both apply paths and the remove path re-render Properties immediately, so
  // the chip flips without the creator having to reload anything.
  const apply = panel.slice(panel.indexOf("applyBtn.addEventListener('click'"));
  check(apply.includes('renderProperties();'), 'applying re-renders Properties immediately');
  check(/wasActive[\s\S]{0,400}?renderProperties\(\)/.test(apply),
    'applying states whether it set or replaced the background');
  const clear = panel.slice(panel.indexOf("clearBtn.addEventListener('click'"));
  check(clear.includes('pendingBackgroundUrl = \'\';'), 'removing also discards any staged upload');
  check(clear.includes('renderProperties();'), 'removing re-renders Properties immediately');
  // Removing deletes the key, so nothing stale is left to render as active.
  check(clear.includes('delete t.backgroundImage;'), 'removing deletes the stored background');
});

process.stdout.write('\n════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-10A BACKGROUND STATE TESTS: ${passed}/${passed + failed} passed\n`);
if (failed > 0) {
  process.stdout.write('FAILURES:\n');
  for (const f of failures) process.stdout.write(`  ✗ ${f.name}\n    ${f.error.message}\n`);
}
process.exit(failed > 0 ? 1 : 0);
