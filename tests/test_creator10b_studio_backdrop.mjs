/**
 * CREATOR-10B (Studio half) — the Creator Studio must not bury the Profile
 * Background under its own profile preview.
 *
 * Run:   node tests/test_creator10b_studio_backdrop.mjs
 *        npm run test:creator10b-studio
 *
 * CREATOR-10B's first pass fixed the PUBLIC profile and left the Studio's own
 * preview exactly as washed out as before, because the Studio draws its own
 * parallel copy of the profile structure. This suite exists so that gap cannot
 * reopen: it measures the RENDERED pixels of the canvas, not a CSS string, and
 * compares the structure-on and structure-off renders of the same design.
 */
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

const TMP = mkdtempSync(join(tmpdir(), 'komuniph-c10bs-'));
const UPLOAD_DIR = resolve('uploads', 'creator');
// Snapshot BEFORE writing the fixture, so cleanup actually removes it and the
// git working tree is left clean.
const uploadsBefore = new Set(existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR) : []);
function cleanupUploads() {
  if (!existsSync(UPLOAD_DIR)) return;
  for (const n of readdirSync(UPLOAD_DIR)) {
    if (uploadsBefore.has(n)) continue;
    try { rmSync(join(UPLOAD_DIR, n), { force: true }); } catch { /* best effort */ }
  }
}
process.on('exit', cleanupUploads);

process.env.DATABASE_PATH = join(TMP, 'test-c10bs.db');
process.env.PORT = String(18600 + (process.pid % 200));
process.env.SECRET_KEY = 'creator-10b-studio-secret-key-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.UPLOAD_CREATOR_DIR = UPLOAD_DIR;

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
await import(mod('server/database.js'));
await import(mod('server/index.js'));
await new Promise(r => setTimeout(r, 1500));

const BG = [220, 30, 30];
let passed = 0;
let failed = 0;
const failures = [];
const check = (cond, msg = 'condition failed') => {
  if (cond) { passed += 1; process.stdout.write(`  ok   ${msg}\n`); return; }
  failed += 1;
  failures.push(msg);
  process.stdout.write(`  FAIL ${msg}\n`);
};
const eq = (a, b, msg = '') => check(a === b, `${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const bgName = `c10bs-bg-${process.pid}.png`;
await sharp({ create: { width: 960, height: 1200, channels: 3, background: { r: BG[0], g: BG[1], b: BG[2] } } })
  .png().toFile(join(UPLOAD_DIR, bgName));

const username = `c10bs${process.pid}`.slice(0, 26);
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, email: `${username}@t.local`, password: 'password123' }),
}).then(r => r.json());
const token = reg.access_token;

async function makeDesign(name, theme) {
  const r = await fetch(`${BASE}/api/profile/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme }),
  }).then(r => r.json());
  return r.design.id;
}
const withBg = await makeDesign('WithBg', { backgroundImage: `/uploads/creator/${bgName}`, backgroundSize: 'cover' });
await makeDesign('NoBg', {});

let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], timeout: 30000 });
} catch (e) {
  process.stdout.write(`BLOCKED: could not launch a browser (${e.message})\n`);
  process.exit(2);
}
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('dialog', async d => { try { await d.accept(); } catch { /* ignore */ } });
await page.setViewport({ width: 1600, height: 1000 });
await page.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#login-identifier', { timeout: 20000 });
await page.type('#login-identifier', username);
await page.type('#login-password', 'password123');
await page.click('button[type=submit]');
await new Promise(r => setTimeout(r, 2200));

async function openDesign(id) {
  await page.goto(`${BASE}/#/creator-studio`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#studio-canvas-document'), { timeout: 20000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.select('#studio-design-select', id);
  await new Promise(r => setTimeout(r, 2200));
}

const sampleCanvas = async () => {
  const shot = await page.screenshot({ encoding: 'binary' });
  const box = await page.evaluate(() => {
    const d = document.querySelector('#studio-canvas-document');
    const r = d.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const pts = [];
  for (let fx = 0.08; fx <= 0.92; fx += 0.08) {
    for (let fy = 0.08; fy <= 0.92; fy += 0.08) {
      pts.push([Math.round(box.x + box.w * fx), Math.round(box.y + box.h * fy)]);
    }
  }
  const out = [];
  for (const [x, y] of pts) {
    try {
      const p = await sharp(shot).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer();
      out.push([p[0], p[1], p[2]]);
    } catch { out.push(null); }
  }
  return out;
};
const isBg = (p) => !!p && Math.abs(p[0] - BG[0]) + Math.abs(p[1] - BG[1]) + Math.abs(p[2] - BG[2]) < 70;

// ── 1. No background: the canvas keeps its own surface, exactly as before ──────
await openDesign(withBg);
const noBgState = await page.evaluate(() => {
  const backdrop = document.querySelector('#studio-profile-backdrop');
  const doc = document.querySelector('#studio-canvas-document');
  return {
    backdrop: backdrop ? backdrop.dataset.profileBackdrop : null,
    transparent: doc ? doc.classList.contains('studio-canvas-transparent') : null,
    docBackground: doc ? getComputedStyle(doc).backgroundImage : '',
  };
});

await openDesign(await (async () => {
  const list = await fetch(`${BASE}/api/profile/design`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  return list.designs.find(d => d.name === 'NoBg').id;
})());
const noBg = await page.evaluate(() => {
  const backdrop = document.querySelector('#studio-profile-backdrop');
  const doc = document.querySelector('#studio-canvas-document');
  return {
    backdrop: backdrop ? backdrop.dataset.profileBackdrop : null,
    transparent: doc ? doc.classList.contains('studio-canvas-transparent') : null,
    docBackground: doc ? getComputedStyle(doc).backgroundImage : '',
  };
});
eq(noBg.backdrop, 'none', 'with no background the backdrop reports none');
eq(noBg.transparent, false, 'with no background the canvas keeps its own surface');
check(/gradient|rgb/.test(noBg.docBackground), 'with no background the canvas still paints its own surface');

// ── 2. With a background: it fills the viewer, the canvas floats on top ───────
await openDesign(withBg);
const withBgState = await page.evaluate(() => {
  const backdrop = document.querySelector('#studio-profile-backdrop');
  const layer = document.querySelector('#studio-profile-background');
  const inner = document.querySelector('#studio-canvas-inner');
  const doc = document.querySelector('#studio-canvas-document');
  const lr = layer?.getBoundingClientRect();
  const sr = document.querySelector('#studio-canvas-scroll')?.getBoundingClientRect();
  const z = (el) => (el ? parseInt(getComputedStyle(el).zIndex || '0', 10) : null);
  return {
    backdrop: backdrop ? backdrop.dataset.profileBackdrop : null,
    bgState: layer ? layer.dataset.profileBackground : null,
    src: layer?.querySelector('img')?.getAttribute('src') || '',
    transparent: doc ? doc.classList.contains('studio-canvas-transparent') : null,
    fillsViewer: !!lr && !!sr && Math.abs(lr.width - sr.width) <= 2 && Math.abs(lr.height - sr.height) <= 2,
    backdropZ: z(backdrop), innerZ: z(inner),
    // The design canvas itself is unchanged: still 960x1200.
    canvasW: doc ? doc.style.width : '',
    canvasH: doc ? doc.style.minHeight : '',
    // The structure is still there, and still not a component.
    skeletonCards: document.querySelectorAll('#studio-profile-skeleton [data-skeleton-module]').length,
    guideCards: document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide_card"]').length,
    sidebarCards: document.querySelectorAll('#studio-profile-skeleton [data-skeleton-column="sidebar"]').length,
    galleryInSidebar: (() => {
      const g = document.querySelector('#studio-profile-skeleton [data-skeleton-module="gallery"]');
      return g ? g.dataset.skeletonColumn : null;
    })(),
    backdropIsComponent: document.querySelectorAll('#studio-profile-backdrop[data-comp-id]').length,
  };
});
eq(withBgState.backdrop, 'set', 'with a background the backdrop is shown');
eq(withBgState.bgState, 'set', 'the background layer reports set');
check(/\/uploads\/creator\//.test(withBgState.src), 'the background is the uploaded source');
check(withBgState.fillsViewer, 'the background fills the whole viewer, not a rectangle inside the canvas');
eq(withBgState.transparent, true, 'the canvas stops painting over the background');
check(withBgState.backdropZ < withBgState.innerZ, 'the canvas floats above the backdrop');
eq(withBgState.canvasW, '960px', 'the design canvas is still 960 wide');
eq(withBgState.canvasH, '1200px', 'the design canvas is still 1200 tall');
eq(withBgState.backdropIsComponent, 0, 'the backdrop is not a design component');

// ── 3. The measured pixels: the picture is actually visible through the canvas ─
const pixels = await sampleCanvas();
const visible = pixels.filter(isBg).length;
check(visible > pixels.length * 0.25,
  `the background is visible across the canvas (${visible}/${pixels.length} sampled pixels are the background)`);

// And compare against the SAME design with the structure hidden, so the
// structure demonstrably is not what is hiding the picture.
await page.evaluate(() => {
  document.querySelectorAll('#studio-profile-skeleton, .studio-guide-card').forEach((el) => {
    el.dataset.c10bsSaved = el.style.display;
    el.style.display = 'none';
  });
});
await new Promise(r => setTimeout(r, 400));
const bare = await sampleCanvas();
await page.evaluate(() => {
  document.querySelectorAll('[data-c10bs-saved]').forEach((el) => { el.style.display = el.dataset.c10bsSaved; });
});
const bareVisible = bare.filter(isBg).length;
const dist = (a, b) => (a && b) ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : 0;
const meanDelta = pixels.reduce((sum, p, i) => sum + dist(p, bare[i]), 0) / pixels.length;
// The structure must not paint an opaque sheet over the picture.
check(meanDelta < 90,
  `the Studio structure does not bury the background (mean per-pixel shift ${meanDelta.toFixed(1)}/765)`);
check(bareVisible >= visible,
  `the structure is what remains once it is hidden (${visible} vs ${bareVisible} visible pixels)`);

// ── 4. Structure and controls survive ────────────────────────────────────────
check(withBgState.skeletonCards >= 12, 'every real profile module is still drawn');
check(withBgState.sidebarCards >= 6, 'the sidebar modules are still independent cards');
eq(withBgState.galleryInSidebar, 'sidebar', 'Photo Gallery is still a sidebar module, not below Testimonials');
check(withBgState.guideCards > 0, 'the guide cards are still present and editable');
eq(pageErrors.length, 0, `the Studio rendered without throwing: ${pageErrors.join(' | ')}`);

await browser.close();
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
cleanupUploads();

process.stdout.write('\n════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-10B STUDIO BACKDROP: ${passed}/${passed + failed} passed\n`);
if (failed) {
  process.stdout.write('FAILURES:\n');
  for (const f of failures) process.stdout.write(`  x ${f}\n`);
}
process.exit(failed ? 1 : 0);
