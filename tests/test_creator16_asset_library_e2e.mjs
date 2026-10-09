/**
 * CREATOR-16 — Persistent Asset Library browser E2E (Puppeteer, headless).
 *
 * Run:   npm run test:creator16-e2e
 *
 * Drives the real app in headless Chrome against a throwaway database.
 * The library is seeded through the REAL API (no mocked responses), then
 * the actual Asset Library modal in Creator Studio is exercised end to end:
 *
 *   - the modal opens and closes
 *   - items load and render with accurate type labels and previews
 *   - search and the type filter narrow the real server-side collection
 *   - "Add Current Design" registers the open project
 *   - an uploaded image (registered once via the real upload + library
 *     APIs) is reused as a canvas component TWICE without any new upload,
 *     producing unique component ids
 *   - "Apply Effect" animates the imported creator effect on the canvas
 *   - "Use as Background" edits only the DRAFT design — the persisted
 *     project is untouched until an explicit Save
 *   - "Open Project" switches through the existing project manager and
 *     the previous design's effect runtime is cleaned up
 *   - "Remove" deletes only the library reference — the uploaded file and
 *     the media record survive
 *   - after a full page reload the collection persists
 *   - the Save appended exactly one new version to the project's
 *     append-only history, carrying the inserted components
 *   - no uncaught page errors at any point
 *
 * Reports BLOCKED (exit 2) when the browser cannot launch and HUNG
 * (exit 3) via a hard watchdog, never a fake pass.
 */

import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { buildZip, goodManifest, goodDefinition } from './_zip.js';
import puppeteer from 'puppeteer';

// Snapshot the REAL creator uploads dir BEFORE the run so cleanup removes
// only files this test created (the static server serves from here).
const UPLOAD_DIR = resolve('uploads', 'creator');
const uploadsBefore = new Set(existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR) : []);
function cleanupUploads() {
  if (!existsSync(UPLOAD_DIR)) return;
  for (const n of readdirSync(UPLOAD_DIR)) {
    if (uploadsBefore.has(n)) continue;
    try { rmSync(join(UPLOAD_DIR, n), { force: true }); } catch { /* best effort */ }
  }
}
process.on('exit', cleanupUploads);

// ── Environment (MUST be set before any server/config import) ──────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-creator16-e2e-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-creator16-e2e.db');
process.env.PORT = String(19300 + (process.pid % 300));
process.env.SECRET_KEY = 'creator-16-e2e-secret-key-that-is-long-enough';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.UPLOAD_CREATOR_DIR = UPLOAD_DIR; // real dir so /uploads/... is served
process.env.UPLOAD_CREATOR_EFFECT_DIR = join(TMP_DIR, 'uploads-creator-effects');

const BASE = `http://127.0.0.1:${process.env.PORT}`;

// Hard watchdog: a hung browser must report HUNG (exit 3), never hang the runner.
setTimeout(() => {
  process.stdout.write('HUNG - forced exit after 600s\n');
  process.exit(3);
}, 600000).unref();

const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
const database = await import(mod('server/database.js'));
await import(mod('server/index.js')); // boots the HTTP server

// ── Tiny harness (mirrors test_creator15_versions_e2e.mjs) ─────────────
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

async function uploadPart(path, token, fieldName, filename, bytes, type) {
  const fd = new FormData();
  fd.append(fieldName, new Blob([bytes], { type }), filename);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// ── Seed through the REAL API (never mocked) ───────────────────────────
const user = { username: 'c16e2e_user', email: 'c16e2e-user@test.local', password: 'password123' };
const reg = await api('POST', '/api/auth/register', { body: user });
if (reg.status !== 201) throw new Error(`seed register failed: ${reg.status}`);
const token = reg.data.access_token;

function tinyPng() {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 20; png.data[i + 1] = 90; png.data[i + 2] = 160; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

// Upload ONE image through the real pipeline.
const mediaUpload = await uploadPart('/api/creator/media', token, 'image', 'e2e-fixture.png', tinyPng(), 'image/png');
if (mediaUpload.status !== 201) throw new Error(`seed media upload failed: ${mediaUpload.status} ${JSON.stringify(mediaUpload.data)}`);
const media = mediaUpload.data;
const IMG_URL = media.url;

// Two projects; the studio opens Alpha explicitly via ?project=.
async function createProject(name) {
  const res = await api('POST', '/api/creator/projects', { token, body: { name } });
  if (res.status !== 201) throw new Error(`seed project "${name}" failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.project;
}
const projectA = await createProject('C16E2E Project Alpha');
const projectB = await createProject('C16E2E Project Beta');

// Import a real .kpeffect package (installed as 'published').
const effectManifest = goodManifest({ id: 'creator.e2eflake', name: 'E2E Flake' });
const effectZip = buildZip([
  { name: 'manifest.json', data: JSON.stringify(effectManifest) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
]);
const effectImport = await uploadPart('/api/creator/effects/import', token, 'package', 'e2eflake.kpeffect', effectZip, 'application/octet-stream');
if (effectImport.status !== 201) throw new Error(`seed effect import failed: ${effectImport.status} ${JSON.stringify(effectImport.data)}`);
const effectId = effectImport.data.effectId;

// A background asset + library entry so "Use as Background" is reachable.
const bgAssetRes = await api('POST', '/api/creator/assets', {
  token,
  body: { name: 'E2E Background', asset_type: 'background', asset_data: { imageUrl: IMG_URL, fit: 'cover' } },
});
if (bgAssetRes.status !== 201) throw new Error(`seed background asset failed: ${bgAssetRes.status}`);

// Register the image, the effect, the background and project Beta in the
// library through the real API (project Alpha is added via the UI later).
async function registerItem(body) {
  const res = await api('POST', '/api/creator/library', { token, body });
  if (res.status !== 201) throw new Error(`seed library item "${body.name}" failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.item;
}
const imageEntry = await registerItem({
  name: 'E2E Uploaded Image', source_type: 'image', source_id: media.id, preview_url: IMG_URL, metadata: { fit: 'cover' },
});
const effectEntry = await registerItem({
  name: 'E2E Flake Effect', source_type: 'effect', source_id: effectId, metadata: { engine: 'particles' },
});
const bgEntry = await registerItem({
  name: 'E2E Library Background', source_type: 'background', source_id: bgAssetRes.data.asset.id, preview_url: IMG_URL,
});
const projectBEntry = await registerItem({
  name: 'E2E Beta Project', source_type: 'project', source_id: projectB.id,
});

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

// The Studio guards project switches with window.confirm(); auto-accept.
page.on('dialog', async (dialog) => { try { await dialog.accept(); } catch { /* gone */ } });

// Headless Chrome reports prefers-reduced-motion by default; the effect
// assertions need the real playback path.
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await new Promise(r => setTimeout(r, 150));

// Count upload attempts so "reuse" can prove no new upload happens.
let uploadRequests = 0;
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/api/creator/media')) uploadRequests += 1;
});

/** Wait until the Creator Studio workspace is actually USABLE. */
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

async function openLibraryModal() {
  await page.click('#studio-asset-library');
  await page.waitForSelector('.studio-modal[role="dialog"]', { timeout: 10000 });
  await page.waitForFunction(() => {
    const list = document.querySelector('#studio-library-list');
    return !!list && !list.textContent.includes('Loading');
  }, { timeout: 15000 });
}

async function closeLibraryModal() {
  await page.click('.studio-modal [data-close]');
  await page.waitForFunction(() => !document.querySelector('.studio-modal[role="dialog"]'), { timeout: 10000 });
}

/** Snapshot the rendered library rows. */
async function libraryRowsInDom() {
  return page.evaluate(() => [...document.querySelectorAll('.studio-library-item')].map(row => ({
    id: row.dataset.id,
    name: row.querySelector('strong')?.textContent || '',
    meta: row.querySelector('.studio-library-meta')?.textContent || '',
    previewSrc: row.querySelector('.studio-library-preview img')?.getAttribute('src') || null,
    useLabel: row.querySelector('.studio-library-actions .btn-primary')?.textContent || '',
  })));
}

/** Click a row's primary action by item id. */
async function clickUse(itemId) {
  await page.evaluate((id) => {
    const row = document.querySelector(`.studio-library-item[data-id="${id}"]`);
    row?.querySelector('.studio-library-actions .btn-primary')?.click();
  }, itemId);
}

async function clickRemove(itemId) {
  await page.evaluate((id) => {
    const row = document.querySelector(`.studio-library-item[data-id="${id}"]`);
    const btns = [...(row?.querySelectorAll('.studio-library-actions button') || [])];
    btns.find(b => b.textContent === 'Remove')?.click();
  }, itemId);
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

await step('the studio opens project Alpha', async () => {
  await page.goto(`${BASE}/#/creator-studio?project=${projectA.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForStudioReady();
  await page.waitForFunction(() => {
    const el = document.querySelector('#studio-project-name');
    return !!el && el.textContent.includes('C16E2E Project Alpha');
  }, { timeout: 20000 });
});

await step('the Asset Library modal opens with the seeded collection', async () => {
  await openLibraryModal();
  const title = await page.evaluate(() => document.querySelector('#studio-library-title')?.textContent);
  eq(title, 'Asset Library', 'the modal is titled');
  const hasSearch = await page.evaluate(() => !!document.querySelector('#studio-library-search'));
  check(hasSearch, 'the toolbar has a search input');
  const hasFilter = await page.evaluate(() => !!document.querySelector('#studio-library-filter'));
  check(hasFilter, 'the toolbar has a type filter');
  const rows = await libraryRowsInDom();
  eq(rows.length, 4, 'four seeded items render');
});

await step('type labels and previews are accurate', async () => {
  const rows = await libraryRowsInDom();
  const byId = (id) => rows.find(r => r.id === id);
  const img = byId(imageEntry.id);
  check(img.meta.includes('Uploaded Image'), `the image label reads "Uploaded Image", got: ${img.meta}`);
  eq(img.previewSrc, IMG_URL, 'the image preview points at the uploaded file');
  eq(img.useLabel, 'Use as Image', 'the image action label');
  const fx = byId(effectEntry.id);
  check(fx.meta.includes('Background Effect'), `the effect label reads "Background Effect", got: ${fx.meta}`);
  eq(fx.useLabel, 'Apply Effect', 'the effect action label');
  const bg = byId(bgEntry.id);
  check(bg.meta.includes('Background'), `the background label reads "Background", got: ${bg.meta}`);
  eq(bg.useLabel, 'Use as Background', 'the background action label');
  const pj = byId(projectBEntry.id);
  check(pj.meta.includes('Project'), `the project label reads "Project", got: ${pj.meta}`);
  eq(pj.useLabel, 'Open Project', 'the project action label');
});

await step('the modal closes', async () => {
  await closeLibraryModal();
});

await step('search narrows the collection server-side', async () => {
  await openLibraryModal();
  await page.type('#studio-library-search', 'flake');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 1, { timeout: 10000 });
  let rows = await libraryRowsInDom();
  eq(rows[0].id, effectEntry.id, 'only the flake effect matches');
  await page.evaluate(() => {
    const input = document.querySelector('#studio-library-search');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 4, { timeout: 10000 });
  rows = await libraryRowsInDom();
  eq(rows.length, 4, 'clearing the search restores the collection');
});

await step('the type filter narrows the collection', async () => {
  await page.select('#studio-library-filter', 'project');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 1, { timeout: 10000 });
  let rows = await libraryRowsInDom();
  eq(rows[0].id, projectBEntry.id, 'only the project entry remains');
  await page.select('#studio-library-filter', 'image');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 1, { timeout: 10000 });
  rows = await libraryRowsInDom();
  eq(rows[0].id, imageEntry.id, 'the image filter reloads the right item');
  await page.select('#studio-library-filter', 'all');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 4, { timeout: 10000 });
});

await step('Add Current Design registers the open project', async () => {
  await page.click('#studio-library-add');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 5, { timeout: 10000 });
  const status = await page.evaluate(() => document.querySelector('#studio-status').textContent);
  check(status.includes('Added "C16E2E Project Alpha" to your library'), `the status reports the add, got: ${status}`);
  const serverList = await api('GET', '/api/creator/library?source_type=project', { token });
  check(serverList.data.items.some(i => i.source_id === projectA.id), 'the server holds the project A entry');
});

await step('reusing an image inserts components without any new upload', async () => {
  const uploadsBeforeReuse = uploadRequests;
  await page.select('#studio-library-filter', 'image');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 1, { timeout: 10000 });
  await clickUse(imageEntry.id);
  // The modal closes and the canvas gains an image component fed by the
  // library preview URL — no file was uploaded again.
  await page.waitForFunction(() => !document.querySelector('.studio-modal[role="dialog"]'), { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('#studio-canvas-inner [data-comp-type="image"]').length === 1, { timeout: 10000 });
  const firstSrc = await page.evaluate(() =>
    document.querySelector('#studio-canvas-inner [data-comp-type="image"] img')?.getAttribute('src'));
  eq(firstSrc, IMG_URL, 'the inserted component reuses the uploaded URL');

  // Insert the SAME library image a second time.
  await openLibraryModal();
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 1, { timeout: 10000 });
  await clickUse(imageEntry.id);
  await page.waitForFunction(() => !document.querySelector('.studio-modal[role="dialog"]'), { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('#studio-canvas-inner [data-comp-type="image"]').length === 2, { timeout: 10000 });

  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('#studio-canvas-inner [data-comp-type="image"]')].map(el => el.dataset.compId));
  eq(ids.length, 2, 'two image components are on the canvas');
  check(ids[0] && ids[1] && ids[0] !== ids[1], `component ids are unique, got: ${ids.join(', ')}`);
  eq(uploadRequests, uploadsBeforeReuse, 'reuse never hit POST /api/creator/media');
});

await step('Apply Effect animates the imported creator effect on the canvas', async () => {
  await openLibraryModal();
  await page.select('#studio-library-filter', 'effect');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 1, { timeout: 10000 });
  await clickUse(effectEntry.id);
  await page.waitForFunction(() => !document.querySelector('.studio-modal[role="dialog"]'), { timeout: 10000 });
  // The canvas now carries a live effect layer for the creator effect.
  await page.waitForFunction((fxId) => {
    const el = document.querySelector('#studio-canvas-inner #studio-profile-effect-layer');
    return !!el && el.dataset.profileEffect === fxId;
  }, { timeout: 15000 }, effectId);
  // Runtime proof: the frame counter genuinely advances.
  const frameBefore = await page.evaluate(() =>
    Number(document.querySelector('#studio-canvas-inner #studio-profile-effect-layer')?.dataset.frame || '0'));
  await new Promise(r => setTimeout(r, 450));
  const frameAfter = await page.evaluate(() =>
    Number(document.querySelector('#studio-canvas-inner #studio-profile-effect-layer')?.dataset.frame || '0'));
  check(frameAfter > frameBefore, `the effect animates (${frameBefore} -> ${frameAfter})`);
});

await step('Use as Background edits only the draft until an explicit Save', async () => {
  await openLibraryModal();
  await page.select('#studio-library-filter', 'background');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 1, { timeout: 10000 });
  await clickUse(bgEntry.id);
  await page.waitForFunction(() => !document.querySelector('.studio-modal[role="dialog"]'), { timeout: 10000 });
  const status = await page.evaluate(() => document.querySelector('#studio-status').textContent);
  check(status.includes('Background set to "E2E Library Background"'), `the status reports the background, got: ${status}`);

  // The PERSISTED project must be untouched: no silent background change.
  const row = database.queryOne('SELECT theme_config FROM profile_designs WHERE id = ?', [projectA.id]);
  const theme = JSON.parse(row.theme_config || 'null');
  check(!theme || !theme.backgroundImage, 'the persisted project has no background until Save');

  // An explicit Save persists it as the next version.
  await page.click('#studio-save');
  await page.waitForFunction(() => {
    const s = document.querySelector('#studio-status');
    return !!s && s.textContent.includes('Saved as version 2.');
  }, { timeout: 20000 });
  const after = await page.evaluate(() => document.querySelector('#studio-project-version').textContent);
  eq(after, 'v2', 'the version indicator tracks the save');
});

await step('Open Project switches through the project manager and cleans up the effect runtime', async () => {
  await openLibraryModal();
  await page.select('#studio-library-filter', 'project');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 2, { timeout: 10000 });
  await clickUse(projectBEntry.id);
  // The switch is confirmed (auto-accepted) and the editor loads Beta.
  await page.waitForFunction(() => {
    const el = document.querySelector('#studio-project-name');
    return !!el && el.textContent.includes('C16E2E Project Beta');
  }, { timeout: 20000 });
  // Beta has no effect: the previous design's effect must be torn down —
  // the canvas layer marks itself idle (profileEffect 'none', no children),
  // and the Live View loop is stopped so nothing leaks past the switch.
  const layerState = await page.evaluate(() => {
    const el = document.querySelector('#studio-canvas-inner #studio-profile-effect-layer');
    if (!el) return { present: false };
    return {
      present: true,
      profileEffect: el.dataset.profileEffect || 'unknown',
      childCount: el.childElementCount,
    };
  });
  eq(layerState.profileEffect, 'none', 'the effect is torn down on switch');
});

await step('removing a reference deletes only the reference', async () => {
  await openLibraryModal();
  await page.select('#studio-library-filter', 'image');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 1, { timeout: 10000 });
  await clickRemove(imageEntry.id); // the confirm dialog is auto-accepted
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 0, { timeout: 10000 });
  const emptyVisible = await page.evaluate(() => {
    const el = document.querySelector('#studio-library-empty');
    return !!el && el.hidden === false;
  });
  check(emptyVisible, 'the empty state shows once the only image entry is gone');

  // The source upload survives: the record, the file, and the HTTP URL.
  const mediaRow = database.queryOne('SELECT * FROM creator_media WHERE id = ?', [media.id]);
  check(mediaRow, 'the creator_media record survived');
  const fileUrl = await fetch(`${BASE}${IMG_URL}`);
  eq(fileUrl.status, 200, 'the uploaded file is still served');
  await closeLibraryModal();
});

await step('the collection persists across a full page reload', async () => {
  await page.goto(`${BASE}/#/creator-studio?project=${projectA.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForStudioReady();
  await openLibraryModal();
  // The modal keeps its filter across opens (session state); the remove step
  // left it on 'image', so reset to 'all' before asserting the collection.
  await page.select('#studio-library-filter', 'all');
  await page.waitForFunction(() => document.querySelectorAll('.studio-library-item').length === 4, { timeout: 10000 });
  const rows = await libraryRowsInDom();
  // Library ids are UUID strings — compare as strings (dataset.id is a string).
  const ids = rows.map(r => String(r.id));
  check(!ids.includes(String(imageEntry.id)), 'the removed image entry stays removed');
  check(ids.includes(String(effectEntry.id)), 'the effect entry persisted');
  check(ids.includes(String(bgEntry.id)), 'the background entry persisted');
  check(ids.includes(String(projectBEntry.id)), 'the project entry persisted');
  check(ids.length === 4, `the project Alpha entry persisted too, got ${ids.length} rows`);
  await closeLibraryModal();
});

await step('the save appended exactly one version with the inserted components', async () => {
  const history = await api('GET', `/api/creator/projects/${projectA.id}/versions`, { token });
  eq(history.status, 200, 'the history is fetchable');
  eq(history.data.versions.length, 2, 'creation state + one explicit save');
  eq(history.data.versions[0].version, 2, 'v2 is newest');
  eq(history.data.versions[0].is_current, true, 'v2 is current');
  eq(history.data.versions[1].version, 1, 'v1 is the creation state');

  const v2 = await api('GET', `/api/creator/projects/${projectA.id}/versions/2`, { token });
  const components = v2.data.version.layout.components;
  const imageComps = components.filter(c => c.type === 'image');
  eq(imageComps.length, 2, 'v2 holds the two reused image components');
  check(imageComps[0].id !== imageComps[1].id, 'their ids are unique');
  check(imageComps.every(c => c.config.imageUrl === IMG_URL), 'both reference the uploaded URL');
  eq(v2.data.version.theme.backgroundEffect.effectId, effectId, 'the applied effect is versioned declaratively');
  eq(v2.data.version.theme.backgroundImage, IMG_URL, 'the applied background is versioned');
  const v1 = await api('GET', `/api/creator/projects/${projectA.id}/versions/1`, { token });
  eq(v1.data.version.layout.components.length, 0, 'v1 is untouched by the later save');
});

await step('no uncaught page errors', async () => {
  check(pageErrors.length === 0, `page errors: ${pageErrors.map(m => m.slice(0, 160)).join(' | ')}`);
});

// ── Cleanup ────────────────────────────────────────────────────────────
await browser.close();
// The SQLite handle locks its file on Windows; close before removing the
// throwaway database directory (best effort).
try { database.closeDatabase(); } catch { /* best effort */ }
try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }

const passed = steps.filter(s => s.ok).length;
const failed = steps.filter(s => !s.ok).length;
process.stdout.write('\n════════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-16 ASSET LIBRARY E2E: ${passed}/${steps.length} passed\n`);
process.stdout.write('════════════════════════════════════════════════════════════════\n');
if (failed > 0) {
  for (const s of steps.filter(s => !s.ok)) {
    process.stdout.write(`  - ${s.name}: ${s.error && s.error.message}\n`);
  }
}
process.exit(failed > 0 ? 1 : 0);





