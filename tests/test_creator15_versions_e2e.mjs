/**
 * CREATOR-15 — Browser E2E (Puppeteer, headless).
 *
 * Run:   npm run test:creator15-e2e
 *
 * Drives the real app in headless Chrome: a project whose current
 * state is seeded at version 2 (one text component + a snow
 * background effect) is opened in the Creator Studio, then the
 * full version-history workflow is exercised end to end:
 *
 *   - the version indicator tracks the server's current version
 *   - the canvas effect layer animates the seeded effect
 *   - an explicit Save appends version 3 and reports it
 *   - Version History lists every version newest-first, metadata
 *     only, with the current version badged
 *   - previewing an older version renders its snapshot read-only
 *     (no selection handles) with its OWN animated effect layer
 *   - closing the modal stops the preview's animation loop but
 *     never the canvas's (runtime effect state is never shared)
 *   - restoring an old version appends a NEW version (v4) that
 *     copies the restored contents, and the editor reloads it
 *   - saving unchanged content is a deterministic no-op
 *   - the server holds the complete append-only chain afterwards
 *
 * Reports BLOCKED when the browser cannot launch.
 * Throwaway SQLite database under the OS temp directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

// ── Environment (MUST be set before any server/config import) ──────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-creator15-e2e-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-creator15-e2e.db');
process.env.PORT = String(19900 + (process.pid % 300));
process.env.SECRET_KEY = 'creator-15-e2e-secret-key-that-is-long-enough';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'creator15-e2e-admin';

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// Hard watchdog: never hang the runner indefinitely (a hung browser
// close or navigation reports code 3 instead of blocking forever).
setTimeout(() => {
  process.stdout.write('WATCHDOG - forced exit after 600s\n');
  process.exit(3);
}, 600000).unref();

const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
await import(mod('server/index.js')); // boots the HTTP server

// ── Tiny harness (mirrors test_studio_media_nav_e2e.mjs) ─────────────
const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push({ name, ok: true });
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    steps.push({ name, ok: false, error: err });
    process.stdout.write(`  FAIL ${name} — ${err.message}\n`);
  }
}
function check(cond, msg = 'condition failed') { if (!cond) throw new Error(msg); }
function eq(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// ── Seed data via API ──────────────────────────────────────────────────
// The project is created through the real API (its creation state IS
// version 1), then a second state is saved through the real Save
// endpoint so the browser opens a project that already has history.
const user = { username: 'c15e2e_user', email: 'c15e2e-user@test.local', password: 'password123' };
const reg = await api('POST', '/api/auth/register', { body: user });
if (reg.status !== 201) throw new Error(`seed register failed: ${reg.status}`);
const token = reg.data.access_token;

const create = await api('POST', '/api/creator/projects', {
  token,
  body: { name: 'E2E Versions', description: 'CREATOR-15 E2E seed' },
});
if (create.status !== 201) throw new Error(`seed create failed: ${create.status}`);
const projectId = create.data.project.id;
check(create.data.project.version === 1, 'the seeded project starts at version 1');

/** The v2 state: one text component, guide already initialised (so
 * opening the project in the Studio never mutates the layout), and a
 * snow background effect so animation behaviour is observable. */
const seedLayout = {
  canvas: { width: 960, minHeight: 1200 },
  components: [{
    id: 'seedtext1',
    type: 'text',
    x: 100,
    y: 200,
    width: 420,
    height: 96,
    zIndex: 3,
    visible: true,
    locked: false,
    rotation: 0,
    style: { background: '#ffffff', textColor: '#123456', opacity: 0.95 },
    config: {
      text: 'Version one headline',
      fontSize: 24,
      fontWeight: 700,
      fontFamily: 'serif',
      fontStyle: 'italic',
      textAlign: 'center',
      lineHeight: 1.4,
      textColor: '#123456',
      animation: { name: 'fade-up', duration: 1.5, delay: 0.2, iteration: 3, timing: 'ease-out' },
    },
  }],
  guideInitialized: true,
};
const seedTheme = {
  backgroundImage: '',
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

const save2 = await api('POST', `/api/creator/projects/${projectId}/save`, {
  token,
  body: { name: 'E2E Versions', layout: seedLayout, theme: seedTheme },
});
if (save2.status !== 200) throw new Error(`seed save failed: ${save2.status} ${JSON.stringify(save2.data)}`);
check(save2.data.saved === true, 'the seed save created version 2');
check(save2.data.version === 2, `the seed save is version 2, got ${save2.data.version}`);

// ── Browser ────────────────────────────────────────────────────────────
let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], timeout: 25000 });
} catch (err) {
  process.stdout.write(`BLOCKED — browser could not launch: ${err.message}\n`);
  process.exit(2);
}

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

// An uncaught error in the page is a REAL failure, not noise.
const pageErrors = [];
page.on('pageerror', (e) => {
  const message = String(e);
  pageErrors.push(message);
  process.stdout.write(`  [pageerror] ${message.slice(0, 200)}\n`);
});

// Safety net: the Studio guards unsaved work with window.confirm()
// (the restore flow uses one). Auto-accept so a modal can never wedge
// the run — the restore step asserts the outcome either way.
page.on('dialog', async (dialog) => { try { await dialog.accept(); } catch { /* gone */ } });

// Headless Chrome reports `prefers-reduced-motion: reduce` BY DEFAULT,
// which would make every effect static. The animation assertions below
// need the real playback path, so ask for `no-preference` explicitly.
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await new Promise(r => setTimeout(r, 150));

/** Wait until the Creator Studio workspace is actually USABLE (copied
 * from test_studio_media_nav_e2e.mjs — the workspace is rendered
 * hidden and only revealed once the profile and design list load). */
async function waitForStudioReady() {
  await page.waitForSelector('#studio-workspace:not([hidden])', { visible: true, timeout: 30000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('.studio-layout');
    if (!el) return false;
    const cols = getComputedStyle(el).gridTemplateColumns;
    return !!cols && !cols.includes('minmax') && cols.trim().split(/\s+/).length === 3;
  }, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 150));
}

/** Sample an effect layer's frame counter (the particle engine ticks
 * `data-frame` on every animation frame). */
async function sampleFrame(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? Number(el.dataset.frame || '0') : null;
  }, selector);
}

/** Assert a layer exists, reports itself animated, and its frame
 * counter genuinely advances — i.e. the loop is really running. */
async function assertAnimating(selector, label) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && el.dataset.motion === 'animated';
  }, { timeout: 15000 }, selector);
  const before = await sampleFrame(selector);
  await new Promise(r => setTimeout(r, 450));
  const after = await sampleFrame(selector);
  check(after !== null && after > before, `${label} frame counter advanced (${before} → ${after})`);
}

/** Click a version row in the history modal by its number label. */
async function selectVersionRow(numLabel) {
  await page.evaluate((label) => {
    const rows = [...document.querySelectorAll('#studio-version-list .studio-version-row')];
    const row = rows.find(r => r.querySelector('.studio-version-num')?.textContent === label);
    if (row) row.click();
  }, numLabel);
}

// ── Browser steps ──────────────────────────────────────────────────────

await step('login through the UI', async () => {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#login-identifier', { timeout: 15000 });
  await page.type('#login-identifier', user.username);
  await page.type('#login-password', user.password);
  await Promise.all([
    page.click('#login-submit'),
    page.waitForSelector('aside.sidebar-left', { timeout: 20000 }),
  ]);
});

await step('the studio opens the project at its current version 2', async () => {
  await page.goto(`${BASE}/#/creator-studio`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForStudioReady();
  await page.waitForFunction(() => {
    const el = document.querySelector('#studio-project-version');
    return !!el && !el.hidden && el.textContent === 'v2';
  }, { timeout: 20000 });
  const name = await page.evaluate(() => document.querySelector('#studio-project-name').textContent);
  eq(name, 'Project: E2E Versions', 'the project name is shown');
});

await step('the canvas animates the seeded snow effect', async () => {
  const effectId = await page.evaluate(() => document.querySelector('#studio-profile-effect-layer')?.dataset.profileEffect);
  eq(effectId, 'builtin.snow', 'the snow effect is applied to the canvas');
  await assertAnimating('#studio-canvas-inner #studio-profile-effect-layer', 'the canvas effect');
});

await step('adding a text component and saving appends version 3', async () => {
  await page.click('#studio-content-list [data-add="text"]');
  // The seeded layout already holds one text component, so a placed
  // one makes two — and the placement is visible on the canvas.
  await page.waitForFunction(() => {
    return document.querySelectorAll('#studio-canvas-inner [data-comp-type="text"]').length === 2;
  }, { timeout: 10000 });
  await page.click('#studio-save');
  await page.waitForFunction(() => {
    const s = document.querySelector('#studio-status');
    return !!s && s.textContent.includes('Saved as version 3.');
  }, { timeout: 20000 });
  const ver = await page.evaluate(() => document.querySelector('#studio-project-version').textContent);
  eq(ver, 'v3', 'the version indicator tracks the new version');
});

await step('version history lists every version newest-first, current badged', async () => {
  await page.click('#studio-version-history');
  await page.waitForSelector('.studio-version-overlay', { timeout: 10000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('#studio-version-list .studio-version-row')].map(r => ({
    num: r.querySelector('.studio-version-num')?.textContent,
    current: r.classList.contains('studio-version-current'),
    badge: r.querySelector('.studio-version-badge')?.textContent || null,
  })));
  eq(rows.length, 3, 'three versions are listed');
  eq(rows[0].num, 'v3', 'the newest version is first');
  eq(rows[0].current, true, 'v3 is marked current');
  eq(rows[0].badge, 'current', 'v3 carries the current badge');
  eq(rows[1].num, 'v2', 'v2 is second');
  eq(rows[1].current, false, 'v2 is not current');
  eq(rows[2].num, 'v1', 'v1 is last');
  eq(rows[2].current, false, 'v1 is not current');
});

await step('previewing v2 renders its snapshot read-only with its own animated effect', async () => {
  await selectVersionRow('v2');
  await page.waitForFunction(() => {
    const stage = document.querySelector('#studio-version-preview-stage');
    return !!stage && stage.textContent.includes('Version one headline');
  }, { timeout: 15000 });
  // Read-only: the preview document carries no selection handles.
  const handles = await page.evaluate(() => document.querySelectorAll('#studio-version-preview-stage .studio-handle').length);
  eq(handles, 0, 'the preview has no selection handles');
  // The preview reuses the SAME renderer, so the snapshot's effect
  // animates in its own layer — with its id stripped so it can never
  // collide with the canvas's.
  const previewHasCanvasId = await page.evaluate(() => !!document.querySelector('#studio-version-preview-stage #studio-profile-effect-layer'));
  eq(previewHasCanvasId, false, 'the preview effect layer has no canvas-only id');
  await assertAnimating('#studio-version-preview-stage .studio-profile-effect-layer', 'the preview effect');
  const restoreBtn = await page.evaluate(() => {
    const btn = document.querySelector('#studio-version-restore');
    return { disabled: btn.disabled, text: btn.textContent };
  });
  eq(restoreBtn.disabled, false, 'restoring an older version is enabled');
  eq(restoreBtn.text, 'Restore v2', 'the restore button names the previewed version');
});

await step('closing the history stops the preview effect but never the canvas effect', async () => {
  await page.click('.studio-version-overlay [data-close]');
  await page.waitForFunction(() => !document.querySelector('.studio-version-overlay'), { timeout: 10000 });
  const previewGone = await page.evaluate(() => !document.querySelector('#studio-version-preview-stage .studio-profile-effect-layer'));
  check(previewGone, 'the preview effect layer is gone with the modal');
  // The canvas loop was never touched: it is still animating.
  await assertAnimating('#studio-canvas-inner #studio-profile-effect-layer', 'the canvas effect after modal close');
});

await step('restoring v2 appends version 4 and reloads the editor with its contents', async () => {
  await page.click('#studio-version-history');
  await page.waitForSelector('.studio-version-overlay', { timeout: 10000 });
  await selectVersionRow('v2');
  await page.waitForFunction(() => {
    const stage = document.querySelector('#studio-version-preview-stage');
    return !!stage && stage.textContent.includes('Version one headline');
  }, { timeout: 15000 });
  await page.click('#studio-version-restore');
  // The confirm dialog is auto-accepted; the editor then reloads the
  // restored state exactly like a design switch.
  await page.waitForFunction(() => {
    const el = document.querySelector('#studio-project-version');
    return !!el && el.textContent === 'v4';
  }, { timeout: 20000 });
  const status = await page.evaluate(() => document.querySelector('#studio-status').textContent);
  check(status.includes('Restored version 2 as version 4.'), `the status reports the restore, got: ${status}`);
  const textCount = await page.evaluate(() => document.querySelectorAll('#studio-canvas-inner [data-comp-type="text"]').length);
  eq(textCount, 1, 'the editor shows v2\'s single text component');
  const canvasText = await page.evaluate(() => document.querySelector('#studio-canvas-inner').textContent);
  check(canvasText.includes('Version one headline'), 'the restored content is on the canvas');
});

await step('saving unchanged content writes no new version', async () => {
  await page.click('#studio-save');
  await page.waitForFunction(() => {
    const s = document.querySelector('#studio-status');
    return !!s && s.textContent.includes('Already saved — no changes since version 4.');
  }, { timeout: 20000 });
  const ver = await page.evaluate(() => document.querySelector('#studio-project-version').textContent);
  eq(ver, 'v4', 'the version indicator still reads v4');
});

await step('the server holds the full append-only chain', async () => {
  const history = await api('GET', `/api/creator/projects/${projectId}/versions`, { token });
  eq(history.status, 200, 'the history is fetchable');
  const versions = history.data.versions;
  eq(versions.length, 4, 'four versions exist');
  eq(versions.map(v => v.version).join(','), '4,3,2,1', 'newest first');
  eq(versions[0].is_current, true, 'v4 is current');
  eq(versions[0].restored_from_version, 2, 'v4 records the version it restored');
  eq(versions[1].restored_from_version, null, 'v3 is an ordinary save');
  eq(versions[2].restored_from_version, null, 'v2 is an ordinary save');
  eq(versions[3].restored_from_version, null, 'v1 is the creation state');

  // Every earlier version is intact: v2 still carries the seeded
  // component and theme, v3 the browser-added second component, and v1
  // the empty creation state.
  const v2 = await api('GET', `/api/creator/projects/${projectId}/versions/2`, { token });
  eq(v2.data.version.layout.components.length, 1, 'v2 still holds one component');
  eq(v2.data.version.layout.components[0].config.text, 'Version one headline', 'v2 content is intact');
  eq(v2.data.version.theme.backgroundEffect.effectId, 'builtin.snow', 'v2 theme is intact');
  const v3 = await api('GET', `/api/creator/projects/${projectId}/versions/3`, { token });
  eq(v3.data.version.layout.components.length, 2, 'v3 holds the component added in the browser');
  const v1 = await api('GET', `/api/creator/projects/${projectId}/versions/1`, { token });
  eq(v1.data.version.layout.components.length, 0, 'v1 is the empty creation state');
  eq(v1.data.version.theme, null, 'v1 has no theme');
});

await step('no uncaught page errors', async () => {
  check(pageErrors.length === 0, `page errors: ${pageErrors.map(m => m.slice(0, 160)).join(' | ')}`);
});

// ── Cleanup ────────────────────────────────────────────────────────────
await browser.close();
// The SQLite handle locks its file on Windows, so close the connection
// before removing the throwaway database directory (best effort).
try { database.closeDatabase(); } catch { /* best effort */ }
try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }

const passed = steps.filter(s => s.ok).length;
const failed = steps.filter(s => !s.ok).length;
process.stdout.write('\n════════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-15 VERSION HISTORY E2E: ${passed}/${steps.length} passed\n`);
process.stdout.write('════════════════════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
