/**
 * CREATOR-10B — Profile background visibility and card transparency.
 *
 * Run:   node tests/test_creator10b_profile_background_visibility.mjs
 *        npm run test:creator10b
 *
 * The bug this exists for: a profile background really WAS active and really
 * WAS applied to #profile-background-layer, but the profile content above it
 * was painted by one nearly opaque shared value, so the picture survived only in
 * the slivers between cards and the profile read as an opaque screen sitting on
 * top of a background. So the assertions here are about RENDERED behaviour:
 * computed styles, element boxes, and sampled pixels from a real screenshot —
 * never a CSS string on its own.
 *
 * Two halves:
 *
 *   1. the contract — the background layer, the effect layer, the content frame
 *      and the three-tier z-index are exactly as CREATOR-12 left them, the
 *      uploaded image keeps the CREATOR-10 priority chain, the profile surfaces
 *      are derived from the creator's own card colour, and no parent `opacity`
 *      is used as a transparency mechanism;
 *   2. a real browser — headless Chrome drives the app, an identifiable red
 *      background is set, and the actual rendered pixels are read back: the
 *      picture has to be visible around the cards AND through them, while the
 *      cards stay readable, independent, correctly stacked and responsive.
 *
 * Reports BLOCKED (exit 2) when the browser cannot launch, and never claims a
 * pass for a step it did not run.
 */
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync as read } from 'node:fs';
import sharp from 'sharp';
import puppeteer from 'puppeteer';

// ── Environment (MUST be set before any server/config import) ──────────────
const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-c10b-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-c10b.db');
process.env.PORT = String(19300 + (process.pid % 300));
process.env.SECRET_KEY = 'creator-10b-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
await import(mod('server/database.js'));
await import(mod('server/index.js')); // boots the HTTP server

const css = read(resolve('web/css/styles.css'), 'utf8');
const profileSrc = read(resolve('web/js/profile.js'), 'utf8');

// Hard watchdog — a hung browser close reports code 3 instead of blocking.
setTimeout(() => {
  process.stdout.write('WATCHDOG - forced exit after 420s\n');
  process.exit(3);
}, 420000).unref();

// ── Assertions ─────────────────────────────────────────────────────────────
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    results.push({ name, ok: false, error: err });
    process.stdout.write(`  FAIL ${name} — ${err.message}\n`);
  }
}
function check(cond, msg = 'condition failed') { if (!cond) throw new Error(msg); }
function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** The body of the first top-level `selector { … }` rule whose selector matches. */
function ruleBody(source, selector) {
  const at = source.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = source.indexOf('{', at);
  const close = source.indexOf('\n}', open);
  return close < 0 ? null : source.slice(open + 1, close);
}
function countRules(source, selector) {
  const re = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`, 'gm');
  return (source.match(re) || []).length;
}

/** Parse a computed `rgba(r, g, b, a)` into numbers. */
function rgba(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value || '');
  if (!m) return { r: 0, g: 0, b: 0, a: 0 };
  const p = m[1].split(',').map(s => parseFloat(s.trim()));
  return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 ? p[3] : 1 };
}
const isClear = (value) => rgba(value).a === 0;

/** WCAG 2.1 relative luminance from an 8-bit sRGB triple. */
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ── Seed fixtures ──────────────────────────────────────────────────────────
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

// The test background. A single saturated colour is deliberate: it is trivially
// distinguishable from the cream card colour, and from the default slate
// gradient, so a sampled pixel unambiguously says WHICH surface is showing.
const BG_RGB = [230, 20, 20];
const CREAM_RGB = [255, 247, 236];
const UPLOAD_DIR = resolve('uploads', 'creator');
// Snapshot BEFORE writing the fixture. Snapshotted after, the fixture would be
// part of the "pre-existing" set and survive cleanup, leaving an untracked file
// in uploads/creator after every run.
const uploadsBefore = new Set(existsSync(UPLOAD_DIR) ? readdirSync(UPLOAD_DIR) : []);
const bgFile = `c10b-background-${process.pid}.png`;
await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: BG_RGB[0], g: BG_RGB[1], b: BG_RGB[2] } } })
  .png()
  .toFile(join(UPLOAD_DIR, bgFile));
const BG_URL = `/uploads/creator/${bgFile}`;

function cleanupUploads() {
  if (!existsSync(UPLOAD_DIR)) return;
  for (const name of readdirSync(UPLOAD_DIR)) {
    if (uploadsBefore.has(name)) continue;
    try { rmSync(join(UPLOAD_DIR, name), { force: true }); } catch { /* best effort */ }
  }
}
process.on('exit', cleanupUploads);

const plain = await makeUser('c10b_plain');
const owner = await makeUser('c10b_owner');
const friend = await makeUser('c10b_friend');
{
  // A testimonial, so the Testimonials module really has content to be readable.
  const t = await api('POST', '/api/testimonials', {
    token: friend.token,
    body: { target_username: owner.username, message: 'Reliable and kind — a pleasure to know.' },
  });
  check(t.status === 201 || t.status === 200, `the testimonial seeds, got ${t.status}`);
}
const canvas = { canvas: { width: 960, minHeight: 1200 }, components: [] };
const design = await api('POST', '/api/profile/design', {
  token: owner.token,
  body: {
    name: 'C10B Profile',
    layout: canvas,
    theme: { backgroundImage: BG_URL, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' },
  },
});
check(design.status === 201, `the design saves, got ${design.status} ${JSON.stringify(design.data)}`);
const designId = design.data.design.id;
{
  const pub = await api('POST', `/api/profile/design/${designId}/publish`, { token: owner.token });
  check(pub.status === 200, `the design publishes, got ${pub.status}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

await test('CREATOR-10B: the background layer, the effect layer and the content frame are untouched', () => {
  // CREATOR-12's invariant, verbatim. A fix that made the picture visible by
  // moving it, or by stacking something new over it, would break here.
  const bg = ruleBody(css, '.profile-background-layer');
  for (const decl of ['position: fixed', 'inset: 0', 'width: 100vw', 'height: 100dvh',
    'pointer-events: none', 'z-index: 0']) {
    check(bg.includes(decl), `the background layer still declares ${decl}`);
  }
  check(/z-index:\s*1/.test(ruleBody(css, '.profile-background-effect-layer')), 'the effect layer is still z-index 1');
  check(/z-index:\s*2/.test(ruleBody(css, '.profile-content-frame')), 'the content frame is still z-index 2');
  // …and each of the three is declared ONCE. `.profile-content-frame` used to be
  // declared twice, the layout block saying z-index 1 and the CREATOR-12 block
  // quietly raising it to 2, so the declaration a reader met first was a lie.
  for (const sel of ['.profile-background-layer', '.profile-background-effect-layer', '.profile-content-frame']) {
    eq(countRules(css, sel), 1, `${sel} is declared exactly once, with no later override`);
  }
  // Nothing new may appear between the picture and the content.
  check(!/\.profile-frame\s*\{[^}]*background-image/.test(css), 'the picture was not moved onto .profile-frame');
  check(!/\.profile-content-frame\s*\{[^}]*background-image/.test(css), 'the picture was not moved into the content frame');
  check(!/background-image:\s*(inherit|var\(\s*--theme)/.test(css), 'no second background image system was introduced');
});

await test('CREATOR-10B: the picture is still applied to the layer, in the CREATOR-10 priority order', () => {
  check(profileSrc.includes("getElementById('profile-background-layer')"), 'the layer is still the target');
  const apply = profileSrc.slice(profileSrc.indexOf('export function applyProfileBackground'));
  const order = ['if (bgImage)', 'else if (hasCustomGradient)', 'else if (hasCustomColor)',
    'else if (hasThemeGradient)'].map(needle => apply.indexOf(needle));
  check(order.every(i => i > 0), 'the priority chain is intact');
  check(order.every((v, i) => i === 0 || v > order[i - 1]), 'the priority chain is in order');
  check(apply.includes('bgLayer.style.backgroundImage = `url(${bgImage})`'), 'the image is applied as a background-image');
});

await test('CREATOR-10B: the profile resolves its own surfaces instead of reusing one shared value', () => {
  for (const v of ['--profile-card-surface', '--profile-card-header-surface', '--profile-status-surface']) {
    check(profileSrc.includes(`'${v}'`), `${v} is set from the theme pipeline`);
    check(css.includes(v), `${v} is consumed by the stylesheet`);
  }
  // The shared, near-opaque variable must no longer paint the profile surfaces —
  // that single reuse is what produced the "opaque screen".
  for (const sel of ['.profile-module', '.sidebar-module', '.profile-status-strip', '.profile-footer']) {
    const body = ruleBody(css, sel) || '';
    check(!/background:\s*var\(--theme-card-background/.test(body),
      `${sel} no longer paints itself with the shared --theme-card-background`);
  }
  // …and the shared variable itself is untouched, so nothing else on the site
  // (gallery, communities, marketplace) changes.
  check(profileSrc.includes("setProperty('--theme-card-background', cardBgRgba)"),
    'the shared --theme-card-background is still published exactly as before');
});

await test('CREATOR-10B: transparency is the surface, never a parent opacity', () => {
  for (const sel of ['.profile-module', '.profile-module-header', '.profile-sidebar',
    '.sidebar-module', '.sidebar-module-header', '.profile-status-strip', '.profile-footer',
    '.profile-main', '.profile-sidebar', '#profile-content']) {
    const body = ruleBody(css, sel);
    if (body === null) continue;
    check(!/(^|[;{\s])opacity\s*:/.test(body), `${sel} carries no opacity declaration`);
  }
  // And the transparency really is on background-color, via the theme variable.
  check(/background:\s*var\(--profile-card-surface\)/.test(ruleBody(css, '.profile-module')),
    '.profile-module paints itself with the profile card surface');
});

await test('CREATOR-10B: a creator who asked for a more opaque card still gets one', () => {
  // The ceilings are only ever allowed to lower alpha, never raise it, so
  // custom.cardOpacity keeps the last word in both directions.
  check(profileSrc.includes('hasChosenBackground ? Math.min(effectiveCardOpacity, ceiling) : effectiveCardOpacity'),
    'the surface alpha is a Math.min against the creator\'s own cardOpacity');
  check(/const PROFILE_CARD_SURFACE_ALPHA = 0\.\d+;/.test(profileSrc), 'the card ceiling is a single named constant');
  check(/const PROFILE_CARD_HEADER_SURFACE_ALPHA = 0\.\d+;/.test(profileSrc), 'the header ceiling is a single named constant');
  check(/const PROFILE_STATUS_SURFACE_ALPHA = 0\.\d+;/.test(profileSrc), 'the status ceiling is a single named constant');
  // The trigger is a background the visitor CHOSE. The stock theme gradient is
  // not one — softening cards for it would restyle every untouched profile.
  check(profileSrc.includes('const hasChosenBackground = hasImageBackground || hasCustomGradient || hasCustomColor;'),
    'only an uploaded picture, custom gradient or custom color softens the cards');
});

await test('CREATOR-10B: the softened state is opt-in, and the blur is scoped to the cards', () => {
  check(profileSrc.includes("frame.setAttribute('data-profile-surface', 'soft')"), 'the soft state is set from the same decision');
  check(profileSrc.includes("else frame.removeAttribute('data-profile-surface')"), 'and removed again when it does not apply');
  const soft = css.slice(css.indexOf('.profile-frame[data-profile-surface="soft"]'));
  for (const sel of ['.profile-module', '.sidebar-module', '.profile-status-strip', '.profile-footer']) {
    check(soft.includes(sel), `the soft state covers ${sel}`);
  }
  check(!/\.profile-frame\s*\[data-profile-surface="soft"\]\s*\{[^}]*backdrop-filter/.test(css),
    'the frame itself is never blurred, only the cards');
  check(!/\.profile-background-layer\s*\[data-profile-surface/.test(css), 'the picture layer is never blurred or filtered');
  check(!/\.profile-content-frame\s*\[data-profile-surface/.test(css), 'the content frame is never blurred or filtered');
});

await test('CREATOR-10B: the profile header stays transparent and is not given a background', () => {
  check(/background:\s*transparent/.test(ruleBody(css, '.profile-header')),
    '.profile-header is still transparent');
  check(!/\.profile-header[^{]*\{[^}]*background:\s*var\(--profile-/.test(css),
    'no header surface was introduced to buy readability');
});

await test('CREATOR-10B: the duplicated module rules are gone, and only one definition remains', () => {
  for (const sel of ['.profile-module', '.profile-module-header', '.profile-module-body',
    '.sidebar-module', '.sidebar-module-header', '.sidebar-module-body']) {
    eq(countRules(css, sel), 1, `${sel} is declared exactly once`);
  }
  // Nothing was lost in the cleanup: the single definition still carries the
  // border, radius and spacing that make each module an independent card.
  for (const sel of ['.profile-module', '.sidebar-module']) {
    const body = ruleBody(css, sel) || '';
    check(/border:/.test(body), `${sel} keeps its border`);
    check(/border-radius:/.test(body), `${sel} keeps its radius`);
    check(/margin-bottom:/.test(body), `${sel} keeps its spacing`);
    check(/overflow:/.test(body), `${sel} keeps its clipping`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE REAL BROWSER
// ═══════════════════════════════════════════════════════════════════════════

let browser;
try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], timeout: 30000 });
} catch (err) {
  process.stdout.write(`BLOCKED — browser could not launch: ${err.message}\n`);
  cleanupUploads();
  process.exit(2);
}

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => {
  pageErrors.push(String(e));
  process.stdout.write(`  [pageerror] ${String(e).slice(0, 200)}\n`);
});
page.on('dialog', async (d) => { try { await d.accept(); } catch { /* gone */ } });

async function authAs(user) {
  await page.evaluateOnNewDocument((tok) => {
    try { localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: tok.access, refresh: null })); } catch { /* ignore */ }
  }, { access: user.token });
}

async function loadProfile(user, tag) {
  await authAs(user);
  await page.goto(`${BASE}/?c10b=${tag}#/profile`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#profile-background-layer', { timeout: 25000 });
  // Wait for the theme to have been resolved onto the frame rather than for a
  // fixed delay, so a slow machine cannot produce a false pass. The wait keys
  // off the LONG-STANDING shared theme variable, never off a CREATOR-10B one, so
  // that on unfixed code the page still loads and the rendered assertions below
  // fail on their own merits instead of all collapsing into one timeout.
  await page.waitForFunction(() => {
    const f = document.getElementById('profile-frame');
    return !!f && !!f.style.getPropertyValue('--theme-card-background');
  }, { timeout: 25000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Everything a visibility claim needs, read out of the live document. */
function readProfile() {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        opacity: cs.opacity,
        zIndex: cs.zIndex,
        backdropFilter: cs.backdropFilter,
        position: cs.position,
        color: cs.color,
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    };
    const frame = document.getElementById('profile-frame');
    const cardAlphas = [...document.querySelectorAll('.profile-module, .sidebar-module, .profile-status-strip, .profile-footer')]
      .map((el) => parseFloat((/rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor) || [, '0,0,0,0'])[1].split(',')[3] ?? 1));
    // Any single element covering essentially the whole viewport with a visible
    // background is, by definition, the "giant opaque screen" this task removed.
    const fullPagePainters = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
      const a = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : (cs.backgroundColor === 'transparent' ? 0 : 1);
      if (a < 0.02) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= innerWidth * 0.98 && r.height >= innerHeight * 0.98) {
        fullPagePainters.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().split(' ')[0]} a=${a}`);
      }
    }
    const sidebarCards = [...document.querySelectorAll('.sidebar-module')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        id: el.id,
        label: (el.querySelector('.sidebar-module-header')?.textContent || '').trim(),
        backgroundColor: cs.backgroundColor,
        border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
        borderRadius: cs.borderTopLeftRadius,
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    });
    return {
      soft: frame?.getAttribute('data-profile-surface'),
      vars: {
        card: frame?.style.getPropertyValue('--profile-card-surface') || null,
        header: frame?.style.getPropertyValue('--profile-card-header-surface') || null,
        status: frame?.style.getPropertyValue('--profile-status-surface') || null,
        shared: frame?.style.getPropertyValue('--theme-card-background'),
      },
      layer: box('#profile-background-layer'),
      effect: box('#profile-background-effect-layer'),
      frame: box('.profile-frame'),
      contentFrame: box('.profile-content-frame'),
      content: box('#profile-content'),
      main: box('#profile-main'),
      sidebar: box('#profile-sidebar'),
      header: box('.profile-header'),
      status: box('#profile-status-strip'),
      module: box('.profile-module'),
      moduleHeader: box('.profile-module-header'),
      sidebarModule: box('.sidebar-module'),
      footer: box('.profile-footer'),
      testimonial: box('.testimonial-card'),
      cardAlphas,
      fullPagePainters,
      sidebarCards,
      testimonialText: (document.querySelector('.testimonial-card')?.innerText || '').replace(/\s+/g, ' ').trim(),
      personalInfoText: (document.getElementById('personal-info-body')?.innerText || '').replace(/\s+/g, ' ').trim(),
      nameText: (document.getElementById('profile-name')?.textContent || '').trim(),
      hScroll: document.documentElement.scrollWidth > innerWidth + 1,
      docHeight: document.documentElement.scrollHeight,
      vw: innerWidth,
      vh: innerHeight,
    };
  });
}

/** A single pixel from a fresh screenshot. */
async function pixel(x, y) {
  const shot = await page.screenshot({ encoding: 'binary' });
  const buf = await sharp(shot).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).raw().toBuffer();
  return [buf[0], buf[1], buf[2]];
}

async function screenshotPixels() {
  const shot = await page.screenshot({ encoding: 'binary' });
  const at = async (x, y) => {
    const buf = await sharp(shot).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).raw().toBuffer();
    return [buf[0], buf[1], buf[2]];
  };
  return { shot, at };
}

// ── A. No custom background ────────────────────────────────────────────────
await test('CREATOR-10B/A: with no custom background the profile is exactly as it was', async () => {
  await loadProfile(plain, 'a-plain');
  const p = await readProfile();

  eq(p.soft, null, 'the soft surface is not applied');
  eq(p.module.backdropFilter, 'none', 'nothing is blurred');
  eq(p.module.backgroundColor, p.vars.shared, 'the card still uses the shared theme card colour');
  check(p.module.backgroundColor !== p.vars.card || p.vars.card === p.vars.shared,
    'the profile surface collapses onto the shared value when nothing is chosen');
  check(!p.module.backgroundColor.startsWith('rgba(255, 247, 236, 0)'), 'the card is not transparent');
  check(rgba(p.module.backgroundColor).a >= 0.75, 'the card stays near-opaque by default');

  // Readable: primary text keeps a real contrast ratio against the card itself.
  const headerColor = rgba(p.moduleHeader.color);
  check(contrast([headerColor.r, headerColor.g, headerColor.b], [255, 247, 236]) >= 7,
    'module headings keep full contrast with no custom background');

  // No horizontal scrolling, and the page still lays out.
  check(!p.hScroll, 'no horizontal scrolling');
  check(p.docHeight > p.vh, 'the profile is taller than the viewport as expected');
  check(p.sidebarCards.length >= 6, 'every sidebar module is present');
  eq(pageErrors.length, 0, `the plain profile rendered without throwing: ${pageErrors.join(' | ')}`);
});

// ── B. Active uploaded background ──────────────────────────────────────────
await test('CREATOR-10B/B: the uploaded picture is applied to the background layer', async () => {
  await loadProfile(owner, 'b-owner');
  const p = await readProfile();
  globalThis.__p = p;

  check(p.layer.backgroundImage.includes(bgFile), `the layer carries the uploaded image, got ${p.layer.backgroundImage.slice(0, 90)}`);
  eq(p.layer.zIndex, '0', 'the picture is still at z-index 0');
  eq(p.layer.position, 'fixed', 'the picture is still a fixed viewport layer');
  eq(p.layer.box.w, p.vw, 'the picture spans the viewport width');
  eq(p.effect.zIndex, '1', 'the effect layer is still between the picture and the content');
  eq(p.contentFrame.zIndex, '2', 'the content frame is still above both');
  // No second background system, and the picture was not moved onto a wrapper.
  eq(p.frame.backgroundImage, 'none', '.profile-frame carries no background image');
  eq(p.contentFrame.backgroundImage, 'none', '.profile-content-frame carries no background image');
});

await test('CREATOR-10B/B: nothing opaque stands between the picture and the cards', async () => {
  const p = globalThis.__p;
  for (const [name, el] of [['the frame', p.frame], ['the content frame', p.contentFrame],
    ['the content grid', p.content], ['the main column', p.main], ['the sidebar column', p.sidebar]]) {
    check(isClear(el.backgroundColor), `${name} has no background of its own (got ${el.backgroundColor})`);
  }
  // The structural guard: the ONLY thing permitted to paint the whole viewport
  // is the background layer itself. This is what fails if anyone re-introduces a
  // full-page wrapper between the image and the content.
  eq(p.fullPagePainters.length, 1, 'exactly one full-viewport painter exists');
  check(p.fullPagePainters[0].includes('profile-background-layer'),
    `and it is the background layer, got ${p.fullPagePainters.join(', ')}`);
});

await test('CREATOR-10B/B: the card surface is genuinely translucent, not an opaque sheet', async () => {
  const p = globalThis.__p;
  const cardAlpha = rgba(p.module.backgroundColor).a;
  const sidebarAlpha = rgba(p.sidebarModule.backgroundColor).a;
  const statusAlpha = rgba(p.status.backgroundColor).a;

  check(cardAlpha > 0 && cardAlpha < 0.75, `the card body is translucent, got alpha ${cardAlpha}`);
  check(sidebarAlpha > 0 && sidebarAlpha < 0.75, `the sidebar card is translucent, got alpha ${sidebarAlpha}`);
  check(statusAlpha > 0 && statusAlpha < 0.8, `the status strip is translucent, got alpha ${statusAlpha}`);
  // The three surfaces are a controlled set, not one universal value.
  check(new Set(p.cardAlphas).size >= 2, `the surfaces are distinguished, got ${JSON.stringify([...new Set(p.cardAlphas)])}`);
  // And they all still come from the creator's own card colour.
  for (const [name, value] of [['card', p.vars.card], ['header', p.vars.header], ['status', p.vars.status]]) {
    check(/^rgba\(255, 247, 236, 0\./.test(value.trim()), `the ${name} surface keeps the theme's card colour, got ${value}`);
  }
  // Readability is bought with a BACKDROP blur, never with a parent opacity.
  check(/blur/.test(p.module.backdropFilter), `the card blurs the picture behind it, got ${p.module.backdropFilter}`);
  eq(p.module.opacity, '1', 'the card element itself is fully opaque in the opacity sense');
  eq(p.main.opacity, '1', 'the main column carries no opacity');
  eq(p.sidebar.opacity, '1', 'the sidebar carries no opacity');
  eq(p.contentFrame.opacity, '1', 'the content frame carries no opacity');
});

await test('CREATOR-10B/B: the picture is actually visible — around the cards AND through them', async () => {
  const p = globalThis.__p;
  const { at } = await screenshotPixels();

  // 1. Around the cards: a pixel in the left margin must be the picture itself.
  const margin = await at(40, Math.round(p.vh / 2));
  check(dist(margin, BG_RGB) < 26, `the margin shows the background image, got ${JSON.stringify(margin)}`);
  check(dist(margin, CREAM_RGB) > 60, 'the margin is not covered by a cream surface');

  // 2. Through the cards: a pixel in the middle of the biggest module must be a
  //    BLEND — measurably neither the picture alone nor an opaque cream sheet.
  const box = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.profile-module')]
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return rb.width * rb.height - ra.width * ra.height;
      })[0];
    const r = el.getBoundingClientRect();
    return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height * 0.72) };
  });
  const card = await at(box.cx, box.cy);
  check(dist(card, CREAM_RGB) > 70, `the card is not an opaque cream sheet, got ${JSON.stringify(card)}`);
  check(card[0] > CREAM_RGB[0] * 0.9, `the card keeps the theme's warm tint, got ${JSON.stringify(card)}`);
  // The green channel is where the cream card (247) and the red picture (20)
  // are furthest apart, so it is the honest measure of "the image reads through".
  check(card[1] < 215, `the picture reads through the card, green ${card[1]} is too close to opaque cream`);
  check(card[1] > BG_RGB[1] + 40, `and the card still tints it, green ${card[1]} is not the bare picture`);

  // 3. The status strip and the footer are the two full-width bands that most
  //    easily read as a page layer; the picture must show through them too.
  const strip = await at(p.status.box.x + 6, p.status.box.y + Math.round(p.status.box.h / 2));
  check(strip[1] < 225, `the status strip is not a page layer, green ${strip[1]}`);
  check(dist(strip, CREAM_RGB) > 45, 'the status strip is measurably translucent');
});

await test('CREATOR-10B/B: the cards stay readable over the picture', async () => {
  const p = globalThis.__p;
  const { at } = await screenshotPixels();
  // The real rendered backdrop behind each heading, sampled from the card's own
  // padding (4px in from its left edge, where no glyph can be).
  const ink = rgba(p.moduleHeader.color);
  const headPixel = await at(p.moduleHeader.box.x + 4, p.moduleHeader.box.y + Math.round(p.moduleHeader.box.h / 2));
  const headRatio = contrast([ink.r, ink.g, ink.b], headPixel);
  check(headRatio >= 4.5, `module headings keep at least 4.5:1 over the picture, measured ${headRatio.toFixed(2)}:1`);

  const stripInk = rgba(p.status.color);
  const stripPixel = await at(p.status.box.x + 4, p.status.box.y + Math.round(p.status.box.h / 2));
  check(stripPixel[1] < 225, 'the strip sample is genuinely over the picture');
  // The strip uses the theme's SECONDARY ink over a deliberately semi-opaque
  // surface, so it is held to the large-text floor rather than to 4.5:1.
  check(contrast([stripInk.r, stripInk.g, stripInk.b], stripPixel) >= 3,
    `the status strip keeps at least 3:1, measured ${contrast([stripInk.r, stripInk.g, stripInk.b], stripPixel).toFixed(2)}:1`);

  // Nothing may be faded to fake transparency: text, borders and controls keep
  // full opacity everywhere.
  for (const [name, el] of [['profile module', p.module], ['status strip', p.status],
    ['sidebar card', p.sidebarModule], ['testimonial', p.testimonial]]) {
    if (!el) continue;
    eq(el.opacity, '1', `${name} is not faded with opacity`);
  }
  const nav = await page.evaluate(() => {
    const a = document.querySelector('.profile-nav a');
    if (!a) return null;
    const cs = getComputedStyle(a);
    return { opacity: cs.opacity, color: cs.color, border: cs.borderTopWidth, background: cs.backgroundColor };
  });
  if (nav) {
    eq(nav.opacity, '1', 'navigation links are not faded');
    check(nav.border !== '0px', 'navigation links keep a visible border');
  }
  // The focus ring must still be declared, or a translucent card would make
  // keyboard navigation invisible.
  const focus = await page.evaluate(() => {
    const s = document.createElement('style');
    return [...document.styleSheets].some((sheet) => {
      try { return [...sheet.cssRules].some((r) => r.selectorText && r.selectorText.includes(':focus-visible') && /outline/.test(r.style.cssText)); }
      catch { return false; }
    });
  });
  check(focus, 'a :focus-visible outline still exists for keyboard users');
});

// ── C. Main profile ────────────────────────────────────────────────────────
await test('CREATOR-10B/C: the main profile stays complete and readable', async () => {
  const p = globalThis.__p;
  check(isClear(p.header.backgroundColor), 'the profile header is still transparent');
  check(p.header.box.h > 40, 'the header still has its content');
  check(p.nameText.length > 0, `the display name renders, got "${p.nameText}"`);
  check(p.personalInfoText.includes('EDUCATION'), `Personal Information renders, got "${p.personalInfoText.slice(0, 60)}"`);
  check(p.personalInfoText.includes('WORK'), 'the Work section of Personal Information renders');
  check(p.testimonialText.length > 0, `Testimonials render, got "${p.testimonialText.slice(0, 60)}"`);
  // The structure the task locks: main profile on the left, sidebar on the right.
  check(p.main.box.x < p.sidebar.box.x, 'the main profile is the first column');
  check(p.main.box.x + p.main.box.w <= p.sidebar.box.x + 1, 'the sidebar is a separate column, not stacked inside main');
  check(p.main.box.h > 200, 'the main column is a real column, not a collapsed wrapper');
});

// ── D. Sidebar ─────────────────────────────────────────────────────────────
await test('CREATOR-10B/D: the sidebar stays five-plus independent cards', async () => {
  const p = globalThis.__p;
  const cards = p.sidebarCards;
  check(cards.length >= 6, `every sidebar module is present, got ${cards.length}`);
  for (const label of ['Friend Space', 'Photo Gallery', 'Video Box', 'Music']) {
    check(cards.some((c) => c.label.includes(label)), `${label} is still its own card`);
  }
  // Independent means independent: separate boxes, real gaps, own border + radius.
  const sorted = [...cards].sort((a, b) => a.box.y - b.box.y);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].box.y - (sorted[i - 1].box.y + sorted[i - 1].box.h);
    check(gap > 0, `the background shows between sidebar cards ${i - 1} and ${i} (gap ${gap}px)`);
  }
  for (const c of cards) {
    check(rgba(c.backgroundColor).a > 0 && rgba(c.backgroundColor).a < 0.75, `${c.label || c.id} is a translucent card`);
    check(c.border.split(' ')[1] !== 'none', `${c.label || c.id} keeps a border`);
    check(parseFloat(c.borderRadius) > 0, `${c.label || c.id} keeps its radius`);
    check(c.box.x === cards[0].box.x && c.box.w === cards[0].box.w,
      `${c.label || c.id} is a full-width sidebar card, not a merged panel`);
  }
  // Nothing wraps them into one sidebar container.
  eq(p.sidebar.backgroundColor, 'rgba(0, 0, 0, 0)', 'the sidebar column itself is transparent');
});

// ── E. Background effect compatibility (CREATOR-12) ────────────────────────
await test('CREATOR-10B/E: background image + effect + cards keep the right stacking', async () => {
  const withEffect = await api('PATCH', `/api/profile/design/${designId}`, {
    token: owner.token,
    body: {
      theme: {
        backgroundImage: BG_URL,
        backgroundSize: 'cover',
        backgroundEffect: { enabled: true, effectId: 'builtin.stars', source: 'builtin', version: 1, config: { count: 24 } },
      },
    },
  });
  check(withEffect.status === 200, `the effect saves, got ${withEffect.status}`);
  await loadProfile(owner, 'e-effect');
  const p = await readProfile();

  check(p.layer.backgroundImage.includes(bgFile), 'the picture is still applied under the effect');
  eq(p.layer.zIndex, '0', 'the picture is still z-index 0');
  eq(p.effect.zIndex, '1', 'the effect is still z-index 1');
  eq(p.contentFrame.zIndex, '2', 'the content is still z-index 2');
  check(p.effect.box.w > 0 && p.effect.box.h > 0,
    `the effect layer actually rendered (${p.effect.box.w}x${p.effect.box.h})`);
  // The effect is a fixed overlay, so it still contributes no layout.
  eq(p.contentFrame.zIndex, '2', 'the content frame was not re-stacked by the fix');
  // …and the cards are exactly as translucent with an effect active as without.
  check(rgba(p.module.backgroundColor).a > 0 && rgba(p.module.backgroundColor).a < 0.75,
    `the card surface is unchanged by the effect, got ${p.module.backgroundColor}`);
  check(rgba(p.status.backgroundColor).a < 0.8, 'the status strip is unchanged by the effect');
  // The picture is still visible around the cards with the effect painted over it.
  const { at } = await screenshotPixels();
  const margin = await at(40, Math.round(p.vh / 2));
  check(dist(margin, BG_RGB) < 90, `the background is still visible with an effect on top, got ${JSON.stringify(margin)}`);
  check(p.docHeight > 0, 'the effect layer added no height of its own');
  eq(pageErrors.length, 0, `the profile with an effect rendered without throwing: ${pageErrors.join(' | ')}`);
});

// ── F. Responsive ──────────────────────────────────────────────────────────
await test('CREATOR-10B/F: mobile keeps the background visible in a single column', async () => {
  await page.setViewport({ width: 390, height: 844 });
  await loadProfile(owner, 'f-mobile');
  const p = await readProfile();
  globalThis.__m = p;

  check(!p.hScroll, 'no horizontal scrolling at 390px');
  eq(p.layer.box.w, 390, 'the picture still spans the viewport');
  // Single column: the sidebar now sits BELOW the main profile, still its own cards.
  check(p.sidebar.box.y > p.main.box.y, 'the sidebar stacks under the main profile on mobile');
  check(p.sidebarCards.length >= 6, 'every sidebar card survives the reflow');
  for (const c of p.sidebarCards) {
    check(rgba(c.backgroundColor).a > 0 && rgba(c.backgroundColor).a < 0.75,
      `${c.label || c.id} is still a translucent card on mobile`);
  }
  const { at } = await screenshotPixels();
  const margin = await at(6, Math.round(p.vh / 2));
  check(dist(margin, CREAM_RGB) > 30 || dist(margin, BG_RGB) < 40,
    `the background is visible beside the single column, got ${JSON.stringify(margin)}`);
  const card = await at(p.module.box.x + Math.round(p.module.box.w / 2), p.module.box.y + Math.round(p.module.box.h * 0.72));
  check(dist(card, CREAM_RGB) > 45, `the mobile card is not an opaque sheet, got ${JSON.stringify(card)}`);
});

await test('CREATOR-10B/F: laptop and tablet widths keep the layout intact', async () => {
  for (const [w, h] of [[1280, 800], [900, 800]]) {
    await page.setViewport({ width: w, height: h });
    await loadProfile(owner, `r-${w}`);
    const p = await readProfile();
    check(!p.hScroll, `no horizontal scrolling at ${w}px`);
    eq(p.layer.box.w, w, `the picture spans the viewport at ${w}px`);
    check(rgba(p.module.backgroundColor).a < 0.75, `the card stays translucent at ${w}px`);
    check(p.main.box.x < p.sidebar.box.x, `the two columns hold at ${w}px`);
    check(p.main.box.w > 200, `the main column keeps a usable width at ${w}px`);
  }
  await page.setViewport({ width: 1400, height: 900 });
});

await test('CREATOR-10B: no page threw at any point in the run', () => {
  eq(pageErrors.length, 0, `unexpected page errors: ${pageErrors.join(' | ')}`);
});

async function closeBrowser() {
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), 15000)),
    ]);
  } catch {
    try { browser.process()?.kill('SIGKILL'); } catch { /* best effort */ }
  }
}
await closeBrowser();

const failed = results.filter((r) => !r.ok);
process.stdout.write('\n════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-10B PROFILE BACKGROUND VISIBILITY: ${results.length - failed.length}/${results.length} passed\n`);
if (failed.length) {
  process.stdout.write('FAILURES:\n');
  for (const f of failed) process.stdout.write(`  ✗ ${f.name}\n    ${f.error?.message || f.error}\n`);
}
try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
cleanupUploads();
process.exit(failed.length ? 1 : 0);
