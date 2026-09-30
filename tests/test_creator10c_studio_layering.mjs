/**
 * CREATOR-10C — Studio background layering and Profile Background Effect playback.
 *
 * Run:   node tests/test_creator10c_studio_layering.mjs
 *        npm run test:creator10c
 *
 * Two defects, both proven by rendered behaviour rather than by the presence of a
 * node:
 *
 *   A. The canvas went fully `transparent` when a background was active, so the
 *      picture showed through every part of the 960x1200 document and the canvas
 *      stopped reading as a sheet at all. The canvas must be a distinct FOREGROUND
 *      surface on a viewer-wide backdrop — neither invisible, nor an opaque wall.
 *
 *   B. "The effect animates" could only be shown by comparing screenshots, and two
 *      frames of falling snow can look near-identical. The renderer now publishes a
 *      frame counter, so playback is proven by the rAF loop genuinely running — and
 *      reduced motion is proven by it NOT running while the effect stays visible.
 */
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

const TMP = mkdtempSync(join(tmpdir(), 'komuniph-c10c-'));
const UPLOAD_DIR = resolve('uploads', 'creator');
// Snapshot BEFORE writing, so cleanup removes it and the tree stays clean.
const uploadsBefore = new Set(existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR) : []);
function cleanupUploads() {
  if (!existsSync(UPLOAD_DIR)) return;
  for (const n of readdirSync(UPLOAD_DIR)) {
    if (uploadsBefore.has(n)) continue;
    try { rmSync(join(UPLOAD_DIR, n), { force: true }); } catch { /* best effort */ }
  }
}
process.on('exit', cleanupUploads);

process.env.DATABASE_PATH = join(TMP, 'test-c10c.db');
process.env.PORT = String(18400 + (process.pid % 200));
process.env.SECRET_KEY = 'creator-10c-secret-key-that-is-long-enough-32';
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

const bgName = `c10c-bg-${process.pid}.png`;
await sharp({ create: { width: 960, height: 1200, channels: 3, background: { r: BG[0], g: BG[1], b: BG[2] } } })
  .png().toFile(join(UPLOAD_DIR, bgName));

const username = `c10c${process.pid}`.slice(0, 24);
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
const bgOnly = await makeDesign('BgOnly', { backgroundImage: `/uploads/creator/${bgName}`, backgroundSize: 'cover' });
const bgPlusEffect = await makeDesign('BgEffect', {
  backgroundImage: `/uploads/creator/${bgName}`,
  backgroundSize: 'cover',
  backgroundEffect: { enabled: true, effectId: 'builtin.snow', source: 'builtin', version: 1, config: { count: 90 } },
});
// Leaves and petals are the effects a creator is most likely to call "it just
// looks like snow", so they get their own design.
const bgLeaves = await makeDesign('BgLeaves', {
  backgroundImage: `/uploads/creator/${bgName}`,
  backgroundSize: 'cover',
  backgroundEffect: {
    enabled: true, effectId: 'builtin.leaves', source: 'builtin', version: 1,
    config: { count: 40, speed: 2, size: 22, direction: 'down', drift: 60, rotation: true, rotationSpeed: 90 },
  },
});
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
const setMotion = (v) => page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: v }]);
await setMotion('no-preference');
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
  await new Promise(r => setTimeout(r, 1000));
  await page.select('#studio-design-select', id);
  await new Promise(r => setTimeout(r, 2200));
}
const readEffect = () => page.evaluate(() => {
  const l = document.querySelector('#studio-profile-effect-layer');
  return { motion: l?.dataset.motion ?? null, frame: l?.dataset.frame === undefined ? null : Number(l.dataset.frame) };
});
const readLayers = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const rect = (s) => { const el = q(s); return el ? el.getBoundingClientRect() : null; };
  const z = (s) => { const el = q(s); return el ? parseInt(getComputedStyle(el).zIndex || '0', 10) : null; };
  const doc = q('#studio-canvas-document');
  const kids = doc ? Array.from(doc.children) : [];
  const lr = rect('#studio-profile-background');
  const er = rect('#studio-profile-effect-layer');
  const dr = rect('#studio-canvas-document');
  const idx = (id) => kids.findIndex(el => el.id === id);
  return {
    bgState: q('#studio-profile-background')?.dataset.profileBackground ?? null,
    effectState: q('#studio-profile-effect-layer')?.dataset.profileEffect ?? null,
    // CREATOR-10C: the background and effect are layers OF the 960x1200 canvas,
    // not a viewer-wide backdrop. They must cover the CANVAS, and must not spill
    // into the viewer around it.
    bgCoversCanvas: !!lr && !!dr
      && Math.abs(lr.width - dr.width) <= 2 && Math.abs(lr.height - dr.height) <= 2,
    effectCoversCanvas: !!er && !!dr
      && Math.abs(er.width - dr.width) <= 2 && Math.abs(er.height - dr.height) <= 2,
    bgInsideDoc: idx('studio-profile-background') >= 0,
    effectInsideDoc: idx('studio-profile-effect-layer') >= 0,
    // Order inside the canvas: background, then effect, then the structure.
    bgBeforeEffect: idx('studio-profile-background') < idx('studio-profile-effect-layer'),
    bgBeforeSkeleton: idx('studio-profile-background') < kids.findIndex(el => el.id === 'studio-profile-skeleton'),
    effectBeforeSkeleton: idx('studio-profile-effect-layer') < kids.findIndex(el => el.id === 'studio-profile-skeleton'),
    bgZ: z('#studio-profile-background'), effectZ: z('#studio-profile-effect-layer'),
    canvasW: q('#studio-canvas-document')?.style.width || '',
    canvasH: q('#studio-canvas-document')?.style.minHeight || '',
    canvasTransparentClass: doc?.classList.contains('studio-canvas-transparent') || false,
    // The background must never be a component.
    bgIsComponent: document.querySelectorAll('#studio-profile-background[data-comp-id]').length,
    effectIsComponent: document.querySelectorAll('#studio-profile-effect-layer[data-comp-id]').length,
    bgPointerEvents: q('#studio-profile-background') ? getComputedStyle(q('#studio-profile-background')).pointerEvents : null,
    effectPointerEvents: q('#studio-profile-effect-layer') ? getComputedStyle(q('#studio-profile-effect-layer')).pointerEvents : null,
    effectAriaHidden: q('#studio-profile-effect-layer')?.getAttribute('aria-hidden') ?? null,
    inLayers: Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-name'))
      .some(el => /background|effect|particle|snow/i.test(el.textContent || '')),
    // Sample points: inside the canvas, and a viewer margin that must NOT be the
    // background any more.
    sample: (() => {
      const s = rect('#studio-canvas-scroll');
      const d = rect('#studio-canvas-document');
      const x0 = Math.max(d.left, s.left); const x1 = Math.min(d.right, s.right);
      const y0 = Math.max(d.top, s.top); const y1 = Math.min(d.bottom, s.bottom);
      return {
        canvas: [Math.round((x0 + x1) / 2), Math.round(y0 + Math.min(40, (y1 - y0) / 2))],
        margin: [Math.round(s.left + 5), Math.round(s.top + 5)],
      };
    })(),
  };
});
const pixelAt = async (buf, [x, y]) => {
  try {
    const p = await sharp(buf).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer();
    return [p[0], p[1], p[2]];
  } catch { return null; }
};
const isBg = (p) => !!p && Math.abs(p[0] - BG[0]) + Math.abs(p[1] - BG[1]) + Math.abs(p[2] - BG[2]) < 70;

// ── A. The background is a layer OF the 960x1200 canvas ───────────────────────
await openDesign(bgOnly);
const L = await readLayers();
const shot = await page.screenshot({ encoding: 'binary' });
const marginPx = await pixelAt(shot, L.sample.margin);
const canvasPx = await pixelAt(shot, L.sample.canvas);

eq(L.bgState, 'set', 'the background layer reports set');
check(L.bgInsideDoc, 'the background is a layer of the design canvas');
check(L.bgCoversCanvas, 'the background covers exactly the 960x1200 canvas');
check(L.bgBeforeEffect, 'the background is ordered before the effect');
check(L.bgBeforeSkeleton, 'the background is painted before the profile structure');
eq(L.canvasW, '960px', 'the design canvas is still 960 wide');
eq(L.canvasH, '1200px', 'the design canvas is still 1200 tall');
eq(L.bgIsComponent, 0, 'the background is not a design component');
eq(L.bgPointerEvents, 'none', 'the background layer never intercepts pointer events');
eq(L.inLayers, false, 'the background is not listed in Layers');
check(L.canvasTransparentClass, 'the canvas stops painting over its own background');

// The visual result, measured: the image IS the canvas background, and it does
// NOT spill into the viewer around the canvas.
check(isBg(canvasPx), `the canvas interior shows the background image, got ${JSON.stringify(canvasPx)}`);
check(!isBg(marginPx),
  `the viewer around the canvas is NOT the background any more, got ${JSON.stringify(marginPx)}`);
const dist = (a, b) => (a && b) ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) : 0;
check(dist(canvasPx, marginPx) > 40,
  `the canvas is clearly distinguishable from the viewer around it (${dist(canvasPx, marginPx)}/765 apart)`);

// ── B. The effect really animates under no-preference ──
await openDesign(bgPlusEffect);
const LE = await readLayers();
check(LE.effectCoversCanvas, 'the effect covers exactly the design canvas, like the background');
check(LE.effectInsideDoc, 'the effect is a layer of the design canvas');
check(LE.effectBeforeSkeleton, 'the effect is painted before the profile structure');
check(LE.bgZ < LE.effectZ, `the effect is above the background (${LE.bgZ} < ${LE.effectZ})`);
eq(LE.effectIsComponent, 0, 'the effect is not a design component');
eq(LE.effectPointerEvents, 'none', 'the effect layer never intercepts pointer events');
eq(LE.effectAriaHidden, 'true', 'the effect layer is hidden from assistive technology');
eq(LE.inLayers, false, 'the effect is not listed in Layers');

const f1 = await readEffect();
await new Promise(r => setTimeout(r, 400));
const f2 = await readEffect();
eq(f1.motion, 'animated', 'the renderer reports the effect as animated');
check(f1.frame !== null && f2.frame !== null, 'the renderer publishes a frame counter');
check(f2.frame > f1.frame,
  `frames genuinely advance under no-preference (${f1.frame} -> ${f2.frame})`);
check(f2.frame - f1.frame >= 3,
  `playback is real, not a single extra frame (${f2.frame - f1.frame} frames in 400ms)`);

// The Studio panel must say ANIMATED, not claim something else.
const badge = await page.$eval('#studio-effect-playback', el => el.textContent.trim()).catch(() => null);
check(/ANIMATED/.test(badge || ''), `the Studio panel reports ANIMATED, got ${JSON.stringify(badge)}`);

// ── Reduced motion: static, no playback, still visible ──
await setMotion('reduce');
await new Promise(r => setTimeout(r, 1000));
const r1 = await readEffect();
await new Promise(r => setTimeout(r, 600));
const r2 = await readEffect();
eq(r1.motion, 'static', 'reduced motion makes the renderer report static');
check(r1.frame !== null, 'a frame counter is still published under reduced motion');
eq(r2.frame, r1.frame, `no frames advance under reduced motion (${r1.frame} -> ${r2.frame})`);
const stillVisible = await page.evaluate(() => {
  const c = document.querySelector('#studio-profile-effect-layer canvas');
  if (!c) return -1;
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let n = 0;
  for (let i = 3; i < data.length; i += 4 * 101) if (data[i] > 8) n += 1;
  return n;
});
check(stillVisible > 0, `the effect stays visible as a still frame under reduced motion (${stillVisible} samples)`);
const badgeStatic = await page.$eval('#studio-effect-playback', el => el.textContent.trim()).catch(() => null);
check(/STATIC/.test(badgeStatic || '') && /REDUCED MOTION/i.test(badgeStatic || ''),
  `the Studio panel says STATIC — REDUCED MOTION, got ${JSON.stringify(badgeStatic)}`);

// Motion returns when the preference is lifted, with no reload.
await setMotion('no-preference');
await new Promise(r => setTimeout(r, 1000));
const b1 = await readEffect();
await new Promise(r => setTimeout(r, 400));
const b2 = await readEffect();
eq(b1.motion, 'animated', 'the effect animates again once motion is allowed');
check(b2.frame > b1.frame, `frames advance again after the preference is lifted (${b1.frame} -> ${b2.frame})`);

// ── C. The motion is VISIBLE, and each effect actually looks like itself ──────
// A rising frame counter proves the rAF loop runs. It does NOT prove a creator
// can SEE anything move, and it certainly does not prove the effect is
// recognisable: an earlier build advanced frames happily while every particle
// was a white dot, so "leaves" was indistinguishable from "snow".
const shotOf = async () => Buffer.from(await page.screenshot({ encoding: 'binary' }));
const changedPixels = async (a, b) => {
  const ra = await sharp(a).raw().toBuffer();
  const rb = await sharp(b).raw().toBuffer();
  let n = 0;
  for (let i = 0; i < Math.min(ra.length, rb.length); i += 4) {
    if (Math.abs(ra[i] - rb[i]) > 6) n += 1;
  }
  return n;
};
const particleColours = () => page.evaluate(() => {
  const c = document.querySelector('#studio-profile-effect-layer canvas');
  if (!c) return null;
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const seen = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 40) {
      const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
});

await openDesign(bgPlusEffect);
const snowA = await shotOf();
await new Promise(r => setTimeout(r, 600));
const snowB = await shotOf();
const snowMoved = await changedPixels(snowA, snowB);
check(snowMoved > 300,
  `the effect is VISIBLY moving, not just counting frames (${snowMoved} pixels changed in 600ms)`);
const snowCols = await particleColours();
check(!!snowCols && snowCols.length > 0, 'snow has visible particles');
const snowIsPale = snowCols.some(([c]) => {
  const [r, g, b] = c.split(',').map(Number);
  return r > 200 && g > 200 && b > 200;
});
check(snowIsPale, `snow renders as pale/white particles, got ${JSON.stringify(snowCols)}`);

// Leaves must not be snow in different clothing.
await openDesign(bgLeaves);
const leafA = await shotOf();
await new Promise(r => setTimeout(r, 600));
const leafB = await shotOf();
const leafMoved = await changedPixels(leafA, leafB);
check(leafMoved > 300, `leaves are visibly moving (${leafMoved} pixels changed in 600ms)`);

const leafCols = await particleColours();
check(!!leafCols && leafCols.length > 0, 'leaves have visible particles');
const greens = leafCols.filter(([c]) => {
  const [r, g, b] = c.split(',').map(Number);
  return g > r && g > b;
});
check(greens.length > 0, `leaves render green rather than white, got ${JSON.stringify(leafCols)}`);
check(!leafCols.some(([c]) => {
  const [r, g, b] = c.split(',').map(Number);
  return r > 220 && g > 220 && b > 220;
}), 'leaves are not drawn as white dots');
// A leaf is a real drawn shape, so the particles must cover a meaningful part of
// the canvas rather than being a handful of stray dots.
const leafCoverage = await page.evaluate(() => {
  const c = document.querySelector('#studio-profile-effect-layer canvas');
  if (!c) return 0;
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 40) n += 1;
  return n;
});
check(leafCoverage > 500, `leaves actually cover the canvas (${leafCoverage} pixels drawn)`);

// ── Structure and the public profile are untouched ──
const struct = await page.evaluate(() => ({
  modules: document.querySelectorAll('#studio-profile-skeleton [data-skeleton-module]').length,
  sidebar: document.querySelectorAll('#studio-profile-skeleton [data-skeleton-column="sidebar"]').length,
  galleryColumn: document.querySelector('#studio-profile-skeleton [data-skeleton-module="gallery"]')?.dataset.skeletonColumn ?? null,
  guides: document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide_card"]').length,
  components: document.querySelectorAll('#studio-canvas-inner [data-comp-id]').length,
  zoom: document.querySelector('#studio-zoom-readout')?.textContent.trim(),
  centred: (() => {
    const t = document.querySelector('#studio-zoom-layer')?.style.transform || '';
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(t);
    if (!m) return null;
    const s = document.querySelector('#studio-canvas-scroll').getBoundingClientRect();
    const d = document.querySelector('#studio-canvas-document').getBoundingClientRect();
    return Math.abs((d.left - s.left) - (s.right - d.right)) <= 2
      && Math.abs((d.top - s.top) - (s.bottom - d.bottom)) <= 2;
  })(),
}));
check(struct.modules >= 12, `every real profile module is still drawn (${struct.modules})`);
check(struct.sidebar >= 6, `the sidebar modules are still independent cards (${struct.sidebar})`);
eq(struct.galleryColumn, 'sidebar', 'Photo Gallery is still a sidebar module, not below Testimonials');
check(struct.guides > 0, 'the guide cards are still present');
check(struct.centred === true, 'the canvas is still centred in the viewer');
eq(struct.zoom, '100%', 'the viewer zoom is untouched by any of this');

const publicProfile = await fetch(`${BASE}/api/profile/${username}`).then(r => r.json());
await fetch(`${BASE}/api/profile/design/${bgPlusEffect}/publish`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}` },
});
const afterPublish = await fetch(`${BASE}/api/profile/${username}`).then(r => r.json());
check(/\/uploads\/creator\//.test(afterPublish.design?.theme?.backgroundImage || ''),
  'the background still reaches the public profile');
eq(afterPublish.design?.theme?.backgroundEffect?.effectId, 'builtin.snow',
  'the effect still reaches the public profile');
void publicProfile;

check(pageErrors.length === 0, `the Studio rendered without throwing: ${pageErrors.join(' | ')}`);

await browser.close();
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
cleanupUploads();

process.stdout.write('\n════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-10C STUDIO LAYERING + EFFECT PLAYBACK: ${passed}/${passed + failed} passed\n`);
if (failed) {
  process.stdout.write('FAILURES:\n');
  for (const f of failures) process.stdout.write(`  x ${f}\n`);
}
process.exit(failed ? 1 : 0);
