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

// -- 1. No background: the canvas keeps its own surface, exactly as before --
const noBgId = await (async () => {
  const list = await fetch(`${BASE}/api/profile/design`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  return list.designs.find(d => d.name === 'NoBg').id;
})();
await openDesign(noBgId);
const noBg = await page.evaluate(() => {
  const layer = document.querySelector('#studio-profile-background');
  const doc = document.querySelector('#studio-canvas-document');
  return {
    bgState: layer ? layer.dataset.profileBackground : null,
    transparent: doc ? doc.classList.contains('studio-canvas-transparent') : null,
    docBackground: doc ? getComputedStyle(doc).backgroundImage : '',
  };
});
eq(noBg.bgState, 'none', 'with no background the layer reports none');
eq(noBg.transparent, false, 'with no background the canvas keeps its own surface');
check(/gradient|rgb/.test(noBg.docBackground), 'with no background the canvas still paints its own surface');

// -- 2. With a background it is a layer OF the 960x1200 canvas --
await openDesign(withBg);
const withBgState = await page.evaluate(() => {
  const layer = document.querySelector('#studio-profile-background');
  const doc = document.querySelector('#studio-canvas-document');
  const lr = layer?.getBoundingClientRect();
  const dr = doc?.getBoundingClientRect();
  return {
    bgState: layer ? layer.dataset.profileBackground : null,
    src: layer?.querySelector('img')?.getAttribute('src') || '',
    transparent: doc ? doc.classList.contains('studio-canvas-transparent') : null,
    coversCanvas: !!lr && !!dr && Math.abs(lr.width - dr.width) <= 2 && Math.abs(lr.height - dr.height) <= 2,
    insideDoc: !!doc?.contains(layer),
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
    bgIsComponent: document.querySelectorAll('#studio-profile-background[data-comp-id]').length,
  };
});
eq(withBgState.bgState, 'set', 'the background layer reports set');
check(/\/uploads\/creator\//.test(withBgState.src), 'the background is the uploaded source');
check(withBgState.insideDoc, 'the background is a layer of the design canvas');
check(withBgState.coversCanvas, 'the background covers exactly the 960x1200 canvas');
eq(withBgState.transparent, true, 'the canvas stops painting over its own background');
eq(withBgState.canvasW, '960px', 'the design canvas is still 960 wide');
eq(withBgState.canvasH, '1200px', 'the design canvas is still 1200 tall');
eq(withBgState.bgIsComponent, 0, 'the background is not a design component');

// ── 3. The measured pixels ───────────────────────────────────────────────────
// CREATOR-10C changed what this must assert. It used to require the background to
// be visible ACROSS the canvas, which is exactly the fully-transparent canvas
// that CREATOR-10C removed: the canvas has to be a distinct FOREGROUND sheet now.
// The background is therefore shown INSIDE the 960x1200 canvas, and the viewer
// around it stays the plain studio surface.
const sampleAt = async (shot, pt) => {
  try {
    const p = await sharp(shot).extract({ left: Math.round(pt[0]), top: Math.round(pt[1]), width: 1, height: 1 }).raw().toBuffer();
    return [p[0], p[1], p[2]];
  } catch { return null; }
};
const frame = await page.evaluate(() => {
  const s = document.querySelector('#studio-canvas-scroll').getBoundingClientRect();
  const d = document.querySelector('#studio-canvas-document').getBoundingClientRect();
  // A viewer point genuinely outside the canvas.
  const margin = d.left > s.left + 12
    ? [s.left + 5, s.top + s.height / 2]
    : [s.left + 5, s.top + 5];
  return {
    margin,
    canvas: [Math.round((Math.max(d.left, s.left) + Math.min(d.right, s.right)) / 2),
      Math.round(Math.max(d.top, s.top) + 40)],
  };
});
const shot = await page.screenshot({ encoding: 'binary' });
const marginPx = await sampleAt(shot, frame.margin);
const canvasPx = await sampleAt(shot, frame.canvas);
const isBgColour = (p) => !!p && Math.abs(p[0] - BG[0]) + Math.abs(p[1] - BG[1]) + Math.abs(p[2] - BG[2]) < 70;

check(isBgColour(canvasPx),
  `the background is visible inside the canvas (got ${JSON.stringify(canvasPx)})`);
check(!isBgColour(marginPx),
  `the viewer around the canvas is NOT the background any more (got ${JSON.stringify(marginPx)})`);
const dist = (a, b) => (a && b) ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : 0;
check(dist(canvasPx, marginPx) > 40,
  `the canvas is clearly distinguishable from the viewer around it (${dist(canvasPx, marginPx)}/765 apart)`);

// And the structure is genuinely drawn OVER the background without burying it:
// a grid across the canvas, sampled with the structure shown and hidden. Both
// directions matter — a canvas full of opaque cards would fail the first, and a
// canvas with no visible cards at all would fail the second.
const gridPoints = await page.evaluate(() => {
  const d = document.querySelector('#studio-canvas-document').getBoundingClientRect();
  const s = document.querySelector('#studio-canvas-scroll').getBoundingClientRect();
  const x0 = Math.max(d.left, s.left); const x1 = Math.min(d.right, s.right);
  const y0 = Math.max(d.top, s.top); const y1 = Math.min(d.bottom, s.bottom);
  const pts = [];
  for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
    for (let fy = 0.1; fy <= 0.9; fy += 0.1) {
      pts.push([Math.round(x0 + (x1 - x0) * fx), Math.round(y0 + (y1 - y0) * fy)]);
    }
  }
  return pts;
});
const readGrid = async (buf) => {
  const out = [];
  for (const pt of gridPoints) out.push(await sampleAt(buf, pt));
  return out;
};
const shownGrid = await readGrid(shot);

await page.evaluate(() => {
  document.querySelectorAll('#studio-profile-skeleton, .studio-guide-card').forEach((el) => {
    el.dataset.c10bsSaved = el.style.display;
    el.style.display = 'none';
  });
});
await new Promise(r => setTimeout(r, 400));
const bareGrid = await readGrid(await page.screenshot({ encoding: 'binary' }));
await page.evaluate(() => {
  document.querySelectorAll('[data-c10bs-saved]').forEach((el) => { el.style.display = el.dataset.c10bsSaved; });
});

const rawShown = shownGrid.filter(isBgColour).length;
const rawBare = bareGrid.filter(isBgColour).length;
check(rawBare > shownGrid.length * 0.6,
  `hiding the structure exposes the raw background (${rawBare}/${shownGrid.length} samples)`);
check(rawShown > 0,
  `the raw background is still visible with the structure shown (${rawShown}/${shownGrid.length})`);
check(rawShown < rawBare,
  `the structure is genuinely drawn over the background (${rawShown} visible with it, ${rawBare} without)`);

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
