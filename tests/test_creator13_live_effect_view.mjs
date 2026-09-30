/**
 * CREATOR-13 — Creator Studio LIVE VIEW and real motion preview.
 *
 * Run:   node tests/test_creator13_live_effect_view.mjs
 *        npm run test:creator13
 *
 * A frame counter is not proof that a creator can see anything move, so this
 * asserts on RENDERED PIXELS throughout: the live stage is screenshotted twice
 * with a gap and the two must differ. A loop that runs while its particles sit
 * still reports ACTIVE to a frame counter and would sail through such a test.
 *
 * It also pins the things a preview must never do: touch the design model, leak
 * an animation loop across effect switches, or report ACTIVE under reduced motion.
 */
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

const TMP = mkdtempSync(join(tmpdir(), 'komuniph-c13-'));
const UPLOAD_DIR = resolve('uploads', 'creator');
// Snapshot BEFORE writing the fixture so cleanup removes it and the tree is clean.
const uploadsBefore = new Set(existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR) : []);
function cleanupUploads() {
  if (!existsSync(UPLOAD_DIR)) return;
  for (const n of readdirSync(UPLOAD_DIR)) {
    if (uploadsBefore.has(n)) continue;
    try { rmSync(join(UPLOAD_DIR, n), { force: true }); } catch { /* best effort */ }
  }
}
process.on('exit', cleanupUploads);

process.env.DATABASE_PATH = join(TMP, 'test-c13.db');
process.env.PORT = String(18300 + (process.pid % 200));
process.env.SECRET_KEY = 'creator-13-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.UPLOAD_CREATOR_DIR = UPLOAD_DIR;

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
await import(mod('server/database.js'));
await import(mod('server/index.js'));
await new Promise(r => setTimeout(r, 1500));

const BG = [90, 30, 150];
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

const bgName = `c13-bg-${process.pid}.png`;
await sharp({ create: { width: 960, height: 1200, channels: 3, background: { r: BG[0], g: BG[1], b: BG[2] } } })
  .png().toFile(join(UPLOAD_DIR, bgName));

const username = `c13${process.pid}`.slice(0, 22);
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, email: `${username}@test.local`, password: 'password123' }),
}).then(r => r.json());
const token = reg.access_token;

async function makeDesign(name, effectId, config) {
  const r = await fetch(`${BASE}/api/profile/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name,
      layout: { canvas: { width: 960, minHeight: 1200 }, components: [] },
      theme: {
        backgroundImage: `/uploads/creator/${bgName}`,
        backgroundSize: 'cover',
        ...(effectId ? {
          backgroundEffect: {
            enabled: true, effectId, source: 'builtin', version: 1, ...(config ? { config } : {}),
          },
        } : {}),
      },
    }),
  }).then(r => r.json());
  return r.design.id;
}
const snowDesign = await makeDesign('Snow', 'builtin.snow', { count: 70, speed: 3, size: 12 });
const leavesDesign = await makeDesign('Leaves', 'builtin.leaves', { count: 34, speed: 3, size: 20, drift: 60, rotation: true, rotationSpeed: 90 });
const petalsDesign = await makeDesign('Petals', 'builtin.petals', { count: 40, speed: 3, size: 16, drift: 45, rotation: true, rotationSpeed: 60 });
const noEffectDesign = await makeDesign('None', null);

let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], timeout: 30000 });
} catch (e) {
  process.stdout.write(`BLOCKED: could not launch a browser (${e.message})\n`);
  process.exit(2);
}

// Hard watchdog. A browser test that never finishes must report HUNG rather than
// block the runner, and never be reported as a pass.
const watchdog = setTimeout(() => {
  process.stdout.write('HUNG: CREATOR-13 browser test exceeded 600s\n');
  try { browser.process()?.kill('SIGKILL'); } catch { /* best effort */ }
  process.exit(3);
}, 600000);
watchdog.unref();
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
  await new Promise(r => setTimeout(r, 2500));
}
/** Deselect so the canvas-level Properties (with the Live View) is shown. */
async function showCanvasProperties() {
  // Bounded retries, never recursion: the Live View only exists when an effect is
  // active, so a recursive wait here would spin forever on a design that has none.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 400));
    if (await page.$('#studio-effect-live')) return true;
  }
  return !!(await page.$('#studio-effect-live'));
}
/** Screenshot ONLY the live stage — the rendered pixels a creator actually sees. */
const liveShot = async () => {
  const el = await page.$('#studio-effect-live-stage');
  if (!el) return null;
  return Buffer.from(await el.screenshot({ encoding: 'binary' }));
};
const changedPixels = async (a, b) => {
  if (!a || !b) return 0;
  const ra = await sharp(a).raw().toBuffer();
  const rb = await sharp(b).raw().toBuffer();
  let n = 0;
  for (let i = 0; i < Math.min(ra.length, rb.length); i += 4) {
    if (Math.abs(ra[i] - rb[i]) > 6) n += 1;
  }
  return n;
};
const liveState = () => page.evaluate(() => {
  const badge = document.querySelector('#studio-effect-live-badge');
  const motion = document.querySelector('#studio-effect-live-motion');
  const toggle = document.querySelector('#studio-effect-live-toggle');
  const canvas = document.querySelector('#studio-effect-live-layer canvas');
  return {
    exists: !!document.querySelector('#studio-effect-live'),
    name: document.querySelector('#studio-effect-live-name')?.textContent || null,
    engine: document.querySelector('#studio-effect-live-engine')?.textContent || null,
    badge: badge ? badge.textContent.trim() : null,
    badgeState: badge ? badge.dataset.state : null,
    motion: motion ? motion.textContent.trim() : null,
    motionKey: motion ? motion.dataset.motion : null,
    toggle: toggle ? toggle.textContent.trim() : null,
    hasCanvas: !!canvas,
    canvasW: canvas ? canvas.width : 0,
    canvasH: canvas ? canvas.height : 0,
  };
});
const designModel = () => page.evaluate(async () => {
  const id = document.querySelector('#studio-design-select')?.value;
  const res = await fetch(`/api/profile/design/${id}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('komuniph_token') || ''}` },
  });
  return res.ok ? await res.json() : null;
});
// How many effect loops the page currently has: the renderer is per-layer, so a
// correct implementation is exactly one per layer and never more.
const liveLoops = () => page.evaluate(() => {
  const layer = document.querySelector('#studio-effect-live-layer');
  const canvasLayer = document.querySelector('#studio-profile-effect-layer');
  return {
    liveCanvases: layer ? layer.querySelectorAll('canvas').length : 0,
    canvasCanvases: canvasLayer ? canvasLayer.querySelectorAll('canvas').length : 0,
    liveMotion: layer?.dataset.motion || null,
    canvasMotion: canvasLayer?.dataset.motion || null,
  };
});

// ── A. The Live View exists ───────────────────────────────────────────────────
await openDesign(snowDesign);
await showCanvasProperties();
let st = await liveState();
check(st.exists, 'the Live View is present in the Properties panel');
check(!!st.hasCanvas && st.canvasW > 0 && st.canvasH > 0,
  `the Live View has a real rendering surface (${st.canvasW}x${st.canvasH})`);
check(/Snow/i.test(st.name || ''), `the Live View names the effect, got "${st.name}"`);
check(/particles/i.test(st.engine || ''), `the Live View shows the engine, got "${st.engine}"`);
eq(st.badge, 'LIVE', 'the Live View reports LIVE');

// ── B/C/D. Motion is real, and reported as ACTIVE ────────────────────────────
await new Promise(r => setTimeout(r, 1800));
const moveA = await liveShot();
await new Promise(r => setTimeout(r, 700));
const moveB = await liveShot();
const moved = await changedPixels(moveA, moveB);
check(moved > 40, `the live stage VISIBLY moves (${moved} pixels changed in 700ms)`);
st = await liveState();
eq(st.motionKey, 'active', `Motion is reported as ACTIVE, got "${st.motion}"`);
check(/ACTIVE/.test(st.motion || ''), `the Motion text says ACTIVE, got "${st.motion}"`);

// ── E/F. Pause stops it, Play resumes it ─────────────────────────────────────
await page.click('#studio-effect-live-toggle');
await new Promise(r => setTimeout(r, 400));
st = await liveState();
eq(st.badge, 'PAUSED', 'the badge shows PAUSED after pausing');
eq(st.motionKey, 'paused', 'the Motion status shows PAUSED');
eq(st.toggle, 'Play', 'the control offers Play after pausing');
const pausedA = await liveShot();
await new Promise(r => setTimeout(r, 900));
const pausedB = await liveShot();
const pausedMoved = await changedPixels(pausedA, pausedB);
eq(pausedMoved, 0, `a paused Live View renders nothing new (${pausedMoved} pixels changed)`);

await page.click('#studio-effect-live-toggle');
await new Promise(r => setTimeout(r, 900));
const resumedA = await liveShot();
await new Promise(r => setTimeout(r, 700));
const resumedB = await liveShot();
const resumed = await changedPixels(resumedA, resumedB);
check(resumed > 40, `motion resumes after Play (${resumed} pixels changed in 700ms)`);
st = await liveState();
eq(st.motionKey, 'active', 'the Motion status returns to ACTIVE after resuming');

// ── G. Restart reinitialises without touching the design ─────────────────────
const beforeRestart = await designModel();
await page.click('#studio-effect-live-restart');
await new Promise(r => setTimeout(r, 1200));
st = await liveState();
eq(st.badge, 'LIVE', 'the Live View is live again after Restart');
const restartA = await liveShot();
await new Promise(r => setTimeout(r, 700));
const restartB = await liveShot();
check(await changedPixels(restartA, restartB) > 40, 'the effect is animating again after Restart');
const afterRestart = await designModel();
eq(JSON.stringify(afterRestart), JSON.stringify(beforeRestart), 'Restart changes nothing in the design model');

// ── H. Reduced motion: visible, static, and honestly reported ────────────────
await setMotion('reduce');
await new Promise(r => setTimeout(r, 1400));
st = await liveState();
eq(st.badge, 'STATIC', 'the badge shows STATIC under reduced motion');
eq(st.motionKey, 'reduced', 'the Motion status identifies reduced motion');
check(/REDUCED MOTION/i.test(st.motion || ''), `the Motion text says REDUCED MOTION, got "${st.motion}"`);
check(st.hasCanvas, 'the effect is still rendered under reduced motion');
const reduceA = await liveShot();
await new Promise(r => setTimeout(r, 900));
const reduceB = await liveShot();
eq(await changedPixels(reduceA, reduceB), 0, 'no pixels change under reduced motion');
check(st.motionKey !== 'active', 'reduced motion is never reported as ACTIVE');
await setMotion('no-preference');
await new Promise(r => setTimeout(r, 1200));

// ── I/J. Effect switching changes the rendering, and leaves no stale loop ─────
/**
 * Classify the PARTICLES drawn on the live stage.
 *
 * Two corrections matter. The stage has an opaque dark background (luminance
 * ~25-40), so covered pixels are selected by being clearly brighter than that.
 * And a sprite is mostly anti-aliased edge, which blends toward the backdrop and
 * desaturates — so averaging colours, or picking a luminance-selected "core",
 * gives unstable greys that depend on how many edge pixels happen to be hit.
 *
 * Counting pixels that match an effect's own colour family is both stable and a
 * more direct expression of the requirement ("leaves are recognisably green"):
 * it asks whether green pixels EXIST, not whether one average looks green.
 */
const stageSignature = async () => {
  const shot = await liveShot();
  if (!shot) return null;
  const { data } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  let covered = 0; let green = 0; let pale = 0; let pink = 0; let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const lum = (r + g + b) / 3;
    if (data[i + 3] < 40 || lum <= 45) continue; // still the dark backdrop
    covered += 1;
    sum += lum;
    if (g > r + 20 && g > b + 20) green += 1;
    if (lum > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 30) pale += 1;
    if (r > g + 25 && r > b + 5 && lum > 90) pink += 1;
  }
  const pct = (n) => (covered ? Math.round((n / covered) * 100) : 0);
  return {
    covered,
    avgLum: covered ? Math.round(sum / covered) : 0,
    greenPct: pct(green),
    palePct: pct(pale),
    pinkPct: pct(pink),
  };
};
/** Open a design and confirm the Live View names the effect it should. */
const expectEffect = async (designId, namePattern) => {
  await openDesign(designId);
  await showCanvasProperties();
  const s = await liveState();
  check(namePattern.test(s.name || ''), `the Live View names ${namePattern}, got "${s.name}"`);
  return stageSignature();
};
await new Promise(r => setTimeout(r, 1500));
const snowSig = await expectEffect(snowDesign, /snow/i);
await new Promise(r => setTimeout(r, 1500));
const leavesSig = await expectEffect(leavesDesign, /leaves/i);
await new Promise(r => setTimeout(r, 1500));
const petalsSig = await expectEffect(petalsDesign, /petals/i);

check(snowSig.covered > 0 && leavesSig.covered > 0 && petalsSig.covered > 0,
  `each effect draws particles (${snowSig.covered}/${leavesSig.covered}/${petalsSig.covered} covered pixels)`);
check(leavesSig.greenPct >= 15,
  `leaves render recognisably GREEN, not white dots (${leavesSig.greenPct}% green pixels)`);
check(leavesSig.palePct < 40,
  `leaves are not white snow particles (${leavesSig.palePct}% pale pixels)`);
check(snowSig.palePct >= 15,
  `snow renders recognisably PALE/WHITE (${snowSig.palePct}% pale pixels)`);
check(petalsSig.pinkPct >= 10,
  `petals render recognisably PINK/FLORAL (${petalsSig.pinkPct}% pink pixels)`);
check(snowSig.greenPct < 30,
  `snow is not green (${snowSig.greenPct}% green pixels)`);
check(leavesSig.greenPct > snowSig.greenPct + 10,
  `leaves and snow are visibly different effects (${leavesSig.greenPct}% vs ${snowSig.greenPct}% green)`);

// Repeated switching must not accumulate loops.
for (const id of [petalsDesign, snowDesign, leavesDesign, snowDesign]) {
  await openDesign(id);
  await showCanvasProperties();
}
const loops = await liveLoops();
eq(loops.liveCanvases, 1, 'exactly one live surface after repeated switching');
eq(loops.canvasCanvases, 1, 'exactly one canvas-preview surface after repeated switching');

// ── L. The design model is never mutated by the preview ──────────────────────
await openDesign(leavesDesign);
await showCanvasProperties();
const modelBefore = await designModel();
const geometryBefore = await page.evaluate(() => Array.from(
  document.querySelectorAll('#studio-canvas-inner [data-comp-id]'),
).map(el => [el.dataset.compId, el.style.left, el.style.top, el.style.width, el.style.height, el.style.zIndex].join('|')));
const zoomBefore = await page.$eval('#studio-zoom-readout', el => el.textContent.trim());
const canvasLabelBefore = await page.$eval('#studio-canvas-size', el => el.textContent.trim());

await page.click('#studio-effect-live-toggle');   // pause
await new Promise(r => setTimeout(r, 300));
await page.click('#studio-effect-live-toggle');   // resume
await new Promise(r => setTimeout(r, 300));
await page.click('#studio-effect-live-restart');
await new Promise(r => setTimeout(r, 500));
// Resizing the Live View must not resize anything that matters.
await page.evaluate(() => {
  const stage = document.querySelector('#studio-effect-live-stage');
  if (stage) stage.style.height = '150px';
});
await new Promise(r => setTimeout(r, 400));

const modelAfter = await designModel();
eq(JSON.stringify(modelAfter), JSON.stringify(modelBefore),
  'play, pause, restart and resizing the Live View change no design data');
const geometryAfter = await page.evaluate(() => Array.from(
  document.querySelectorAll('#studio-canvas-inner [data-comp-id]'),
).map(el => [el.dataset.compId, el.style.left, el.style.top, el.style.width, el.style.height, el.style.zIndex].join('|')));
eq(JSON.stringify(geometryAfter), JSON.stringify(geometryBefore), 'no component geometry changed');
eq(await page.$eval('#studio-zoom-readout', el => el.textContent.trim()), zoomBefore, 'the viewer zoom is untouched');
eq(await page.$eval('#studio-canvas-size', el => el.textContent.trim()), canvasLabelBefore, 'the design canvas size is untouched');

// The effect is never a component and never in Layers.
const notComponent = await page.evaluate(() => ({
  comp: document.querySelectorAll('#studio-effect-live-layer[data-comp-id], #studio-profile-effect-layer[data-comp-id]').length,
  layers: Array.from(document.querySelectorAll('#studio-layers-list .studio-layer-name'))
    .some(el => /snow|effect|particle|live/i.test(el.textContent || '')),
  handles: document.querySelectorAll('#studio-effect-live-layer [data-resize]').length,
}));
eq(notComponent.comp, 0, 'the effect is not a design component');
eq(notComponent.layers, false, 'the effect is not listed in Layers');
eq(notComponent.handles, 0, 'the effect has no resize handles');

// A design with no effect shows no Live View.
await openDesign(noEffectDesign);
await showCanvasProperties();
eq((await liveState()).exists, false, 'no Live View when no effect is active');

check(pageErrors.length === 0, `the Studio rendered without throwing: ${pageErrors.join(' | ')}`);

clearTimeout(watchdog);
await browser.close();
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
cleanupUploads();

process.stdout.write('\n════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-13 LIVE EFFECT VIEW: ${passed}/${passed + failed} passed\n`);
if (failed) {
  process.stdout.write('FAILURES:\n');
  for (const f of failures) process.stdout.write(`  x ${f}\n`);
}
process.exit(failed ? 1 : 0);
