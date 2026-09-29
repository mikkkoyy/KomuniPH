/**
 * CREATOR-10 — Profile Viewer / Profile Background / guide structure tests.
 *
 * Run:   node tests/test_creator10_profile_viewer.mjs
 *
 * Covers, at the module + API level:
 *   - the real profile structure drives the viewer and the guide alike
 *   - the outer Profile Background is design-level configuration, validated
 *     strictly server-side, and never an ordinary image component
 *   - the guide stays Studio-only and deleted guide cards stay deleted
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-c10-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-c10.db');
process.env.PORT = String(19300 + (process.pid % 300));
process.env.PAYMONGO_WEBHOOK_SECRET = 'creator-10-secret';
process.env.SECRET_KEY = 'creator-10-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.UPLOAD_CREATOR_DIR = join(TMP_DIR, 'uploads-creator');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;

await import(mod('server/database.js'));
const server = await import(mod('server/profileDesign.js'));
const client = await import(mod('web/js/profileDesign.js'));
const viewer = await import(mod('web/js/studioViewer.js'));
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
const test_ = undefined;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// ── Seed a user ─────────────────────────────────────────────────────────────
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

const guideCard = (section, overrides = {}) => ({
  id: `gc_${Math.random().toString(36).slice(2, 8)}`,
  type: 'profile_guide_card',
  x: 40, y: 40, width: 200, height: 180,
  rotation: 0, zIndex: 0, visible: true, locked: false,
  config: { section }, ...overrides,
});

const imageComp = (overrides = {}) => ({
  id: `img_${Math.random().toString(36).slice(2, 8)}`,
  type: 'image',
  x: 100, y: 200, width: 360, height: 240,
  rotation: 0, zIndex: 1, visible: true, locked: false,
  config: { imageUrl: '/uploads/creator/abc.webp', fit: 'cover' }, ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-10: the profile layout is a main column plus a separate sidebar', () => {
  const L = client.PROFILE_LAYOUT;
  eq(L.canvas.width, 960, 'canvas width');
  eq(L.canvas.minHeight, 1200, 'canvas height');

  // Main and sidebar are SEPARATE areas, side by side, and do not overlap.
  check(L.main.x < L.sidebar.x, 'the sidebar begins to the right of the main profile');
  check(L.main.x + L.main.width <= L.sidebar.x, 'the main profile and sidebar do not overlap');
  check(L.main.width > L.sidebar.width, 'the main profile is the wider column');

  // The outer background covers the WHOLE design area, both columns included.
  eq(L.background.x, 0, 'background x');
  eq(L.background.y, 0, 'background y');
  eq(L.background.width, 960, 'background width');
  eq(L.background.height, 1200, 'background height');
  check(L.background.width >= L.sidebar.x + L.sidebar.width, 'the background spans past the sidebar');
  check(L.background.height >= L.main.y + L.main.height, 'the background spans past both columns');

  // Every module sits inside the column it belongs to.
  for (const section of client.PROFILE_MAIN_SECTIONS) {
    const m = L.modules[section];
    check(!!m, `main module ${section} has a box`);
    check(m.x >= L.main.x && m.x + m.width <= L.main.x + L.main.width,
      `main module ${section} is inside the main column`);
  }
  for (const section of client.PROFILE_SIDEBAR_SECTIONS) {
    const m = L.modules[section];
    check(!!m, `sidebar module ${section} has a box`);
    check(m.x >= L.sidebar.x && m.x + m.width <= L.sidebar.x + L.sidebar.width,
      `sidebar module ${section} is inside the sidebar`);
  }
});

await test('CREATOR-10: every sidebar feature is its OWN independent card', () => {
  const L = client.PROFILE_LAYOUT;
  // The five sidebar features CREATOR-10 names, each with a distinct box.
  for (const section of ['friend_space', 'gallery', 'video_box', 'music', 'scraps']) {
    check(!!L.modules[section], `sidebar module "${section}" exists`);
    eq(client.GUIDE_SECTION_COLUMN[section], 'sidebar', `${section} is a sidebar module`);
    check(client.GUIDE_SECTIONS[section] && client.GUIDE_SECTIONS[section].length > 0,
      `${section} has a human label`);
  }
  // Independent = no two sidebar modules share a box, and none spans the sidebar
  // as one giant block.
  const seen = new Set();
  for (const section of client.PROFILE_SIDEBAR_SECTIONS) {
    const m = L.modules[section];
    const key = `${m.x},${m.y},${m.width},${m.height}`;
    check(!seen.has(key), `sidebar module "${section}" has its own distinct card`);
    seen.add(key);
    check(m.height < L.sidebar.height,
      `sidebar module "${section}" is not one giant sidebar block`);
  }
});

await test('CREATOR-10: there is NO Gallery in the main column below Testimonials', () => {
  // Photo Gallery is a real SIDEBAR module, so it must not also be a main one.
  eq(client.GUIDE_SECTION_COLUMN.gallery, 'sidebar', 'gallery is a sidebar module');
  check(!client.PROFILE_MAIN_SECTIONS.includes('gallery'),
    'the main column does not contain a Gallery section');
  // And nothing main-column sits below the Testimonials card.
  const L = client.PROFILE_LAYOUT;
  const testimonialsBottom = L.modules.testimonials.y + L.modules.testimonials.height;
  for (const section of client.PROFILE_MAIN_SECTIONS) {
    if (section === 'testimonials') continue;
    check(L.modules[section].y + L.modules[section].height <= testimonialsBottom + 1,
      `main module "${section}" is not below Testimonials`);
  }
});

await test('CREATOR-10: the default guide IS the real profile structure', () => {
  const pattern = client.guidePattern(client.DEFAULT_GUIDE_PATTERN);
  const L = client.PROFILE_LAYOUT;
  const expected = [...client.PROFILE_MAIN_SECTIONS, ...client.PROFILE_SIDEBAR_SECTIONS];
  const bySection = new Map(pattern.cards.map(c => [c.section, c]));

  for (const section of expected) {
    const card = bySection.get(section);
    check(!!card, `the default guide has a "${section}" card`);
    const m = L.modules[section];
    eq(card.x, m.x, `guide ${section} x`);
    eq(card.y, m.y, `guide ${section} y`);
    eq(card.width, m.width, `guide ${section} width`);
    eq(card.height, m.height, `guide ${section} height`);
  }
  eq(pattern.cards.length, expected.length, 'the default guide covers every real module once');
  // Nothing invented.
  for (const card of pattern.cards) {
    check(expected.includes(card.section), `no invented section in the guide: ${card.section}`);
  }
});

await test('CREATOR-10: the client and server agree on the guide sections', () => {
  const clientIds = [...client.GUIDE_SECTION_IDS].sort();
  const serverIds = [...server.GUIDE_SECTIONS].sort();
  eq(JSON.stringify(clientIds), JSON.stringify(serverIds), 'guide section registries');
  for (const section of ['friend_space', 'gallery', 'video_box', 'music', 'scraps']) {
    check(server.GUIDE_SECTIONS.has(section), `server allows the "${section}" guide section`);
  }
  for (const section of ['communities', 'profile_photo', 'name', 'alias', 'bio', 'personal_info', 'testimonials']) {
    check(server.GUIDE_SECTIONS.has(section), `server still allows the "${section}" guide section`);
  }
});

await test('CREATOR-10: a guide card for a sidebar feature is accepted and round-trips', async () => {
  const u = await makeUser('c10_guide');
  for (const section of ['friend_space', 'video_box', 'music', 'scraps']) {
    const card = guideCard(section);
    const r = await api('POST', '/api/profile/design', {
      token: u.token,
      body: { name: `Design ${section}`, layout: { canvas: { width: 960, minHeight: 1200 }, components: [card] } },
    });
    check(r.status === 201, `"${section}" guide card is accepted, got ${r.status}: ${JSON.stringify(r.data)}`);
    eq(r.data.design.layout.components[0].config.section, section, `${section} round-trips`);
  }
});

await test('CREATOR-10: an unknown sidebar guide section is still rejected', async () => {
  const u = await makeUser('c10_badsection');
  for (const section of ['sidebar_blob', 'blog', '<script>', '']) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token,
      body: { name: 'Bad', layout: { canvas: { width: 960, minHeight: 1200 }, components: [guideCard(section)] } },
    });
    check(r.status === 400, `"${section}" is rejected, got ${r.status}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Profile Background
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-10: a design-level background image is accepted and persisted', async () => {
  const u = await makeUser('c10_bg');
  const theme = {
    backgroundImage: '/uploads/creator/deadbeef.webp',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
  const created = await api('POST', '/api/profile/design', {
    token: u.token, body: { name: 'With background', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme },
  });
  check(created.status === 201, `design with a background is created, got ${created.status}: ${JSON.stringify(created.data)}`);
  eq(created.data.design.theme.backgroundImage, '/uploads/creator/deadbeef.webp', 'background round-trips');

  // Save/reload preserves it.
  const fetched = await api('GET', `/api/profile/design/${created.data.design.id}`, { token: u.token });
  check(fetched.status === 200, 'the design reloads');
  eq(fetched.data.design.theme.backgroundImage, '/uploads/creator/deadbeef.webp', 'background survives a reload');
  eq(fetched.data.design.theme.backgroundSize, 'cover', 'presentation survives a reload');
});

await test('CREATOR-10: a design background URL is validated as strictly as any image', async () => {
  const u = await makeUser('c10_bgbad');
  const bad = [
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    '//evil.example.com/x.png',
    'file:///etc/passwd',
    'vbscript:msgbox',
  ];
  for (const backgroundImage of bad) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token,
      body: { name: 'Bad bg', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme: { backgroundImage } },
    });
    check(r.status === 400, `background "${backgroundImage}" is rejected, got ${r.status}`);
  }
  // http(s) and same-origin /uploads/ remain valid.
  for (const backgroundImage of ['https://example.com/bg.png', 'http://example.com/bg.jpg', '/uploads/backgrounds/x.webp']) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token,
      body: { name: 'Good bg', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme: { backgroundImage } },
    });
    check(r.status === 201, `background "${backgroundImage}" is accepted, got ${r.status}`);
  }
});

await test('CREATOR-10: background presentation values are validated', async () => {
  const u = await makeUser('c10_bgpres');
  const bad = [
    { backgroundSize: 'squish' },
    { backgroundPosition: 'nowhere' },
    { backgroundRepeat: 'diagonal' },
  ];
  for (const theme of bad) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token,
      body: { name: 'Bad pres', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme },
    });
    check(r.status === 400, `${JSON.stringify(theme)} is rejected, got ${r.status}`);
  }
  for (const value of ['cover', 'contain', 'stretch']) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token,
      body: { name: 'Good size', layout: { canvas: { width: 960, minHeight: 1200 }, components: [] }, theme: { backgroundSize: value } },
    });
    check(r.status === 201, `backgroundSize "${value}" is accepted, got ${r.status}`);
  }
});

await test('CREATOR-10: the background is design-level, NOT an image component', async () => {
  const u = await makeUser('c10_bgkind');
  // A design with a background and NO image component at all: the background
  // must not require, and must not be stored as, a movable/resizable `image`.
  const created = await api('POST', '/api/profile/design', {
    token: u.token,
    body: {
      name: 'Background only',
      layout: { canvas: { width: 960, minHeight: 1200 }, components: [] },
      theme: { backgroundImage: '/uploads/creator/bg.webp' },
    },
  });
  check(created.status === 201, 'a background-only design is valid');
  eq(created.data.design.layout.components.length, 0, 'the background created no component');
  const types = created.data.design.layout.components.map(c => c.type);
  check(!types.includes('image'), 'the background is not stored as an image component');
  // The background lives on the theme, which is the design-level config.
  eq(created.data.design.theme.backgroundImage, '/uploads/creator/bg.webp', 'it lives on the theme');
});

await test('CREATOR-10: a published design carries the background to the public profile', async () => {
  const u = await makeUser('c10_bgpub');
  const created = await api('POST', '/api/profile/design', {
    token: u.token,
    body: {
      name: 'Published background',
      layout: { canvas: { width: 960, minHeight: 1200 }, components: [] },
      theme: { backgroundImage: '/uploads/creator/published.webp', backgroundSize: 'cover' },
    },
  });
  const id = created.data.design.id;
  const pub = await api('POST', `/api/profile/design/${id}/publish`, { token: u.token });
  check(pub.status === 200, `publish succeeds, got ${pub.status}: ${JSON.stringify(pub.data)}`);

  // The public profile must receive the design AND its background.
  const pubProfile = await api('GET', `/api/profile/${u.username}`);
  check(pubProfile.status === 200, `public profile loads, got ${pubProfile.status}`);
  eq(pubProfile.data.design.theme.backgroundImage, '/uploads/creator/published.webp',
    'the public profile receives the background');
});

await test('CREATOR-10: a background-only design leaves the public profile renderable', async () => {
  const u = await makeUser('c10_bgsafe');
  const created = await api('POST', '/api/profile/design', {
    token: u.token,
    body: {
      name: 'Bg and guide',
      layout: {
        canvas: { width: 960, minHeight: 1200 },
        components: [guideCard('friend_space'), guideCard('gallery'), guideCard('scraps')],
      },
      theme: { backgroundImage: '/uploads/creator/safe.webp' },
    },
  });
  check(created.status === 201, 'a design with a background and guide cards is valid');
  await api('POST', `/api/profile/design/${created.data.design.id}/publish`, { token: u.token });
  const pubProfile = await api('GET', `/api/profile/${u.username}`);
  check(pubProfile.status === 200, 'the public profile still loads');
  eq(pubProfile.data.design.theme.backgroundImage, '/uploads/creator/safe.webp', 'background still applied');
  // The guide cards are stored, but they are never profile content.
  const cardTypes = (pubProfile.data.design.layout.components || []).map(c => c.type);
  for (const t of cardTypes) {
    check(client.PUBLIC_RENDER_EXCLUDED_TYPES.has(t), `guide type ${t} is excluded from public rendering`);
    check(!client.CONTENT_COMPONENT_TYPES.has(t), `guide type ${t} is not content`);
    check(!client.COMPONENT_SELECTORS_SAFE?.(t), `guide type ${t} has no public selector`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Guide behaviour
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-10: the default guide survives a save/reload round trip', async () => {
  const u = await makeUser('c10_roundtrip');
  const pattern = client.guidePattern(client.DEFAULT_GUIDE_PATTERN);
  const components = pattern.cards.map(c => ({ ...guideCard(c.section), x: c.x, y: c.y, width: c.width, height: c.height }));
  const created = await api('POST', '/api/profile/design', {
    token: u.token,
    body: {
      name: 'Full guide',
      layout: { canvas: { width: 960, minHeight: 1200 }, components, guideInitialized: true },
    },
  });
  check(created.status === 201, `the full default guide saves, got ${created.status}: ${JSON.stringify(created.data)}`);
  const saved = created.data.design.layout.components;
  eq(saved.length, components.length, 'every card is stored');
  const savedSections = saved.map(c => c.config.section).sort();
  const expected = pattern.cards.map(c => c.section).sort();
  eq(JSON.stringify(savedSections), JSON.stringify(expected), 'every section round-trips');
});

await test('CREATOR-10: a deleted guide card stays deleted (guideInitialized respected)', async () => {
  const u = await makeUser('c10_deleted');
  const pattern = client.guidePattern(client.DEFAULT_GUIDE_PATTERN);
  // Save the guide with ONE card removed and guideInitialized already true —
  // exactly the state a creator produces by deleting a card and saving.
  const kept = pattern.cards.filter(c => c.section !== 'scraps');
  const components = kept.map(c => ({ ...guideCard(c.section), x: c.x, y: c.y, width: c.width, height: c.height }));
  const created = await api('POST', '/api/profile/design', {
    token: u.token,
    body: {
      name: 'Guide minus scraps',
      layout: { canvas: { width: 960, minHeight: 1200 }, components, guideInitialized: true },
    },
  });
  check(created.status === 201, 'a design with a deliberately deleted card saves');
  const sections = created.data.design.layout.components.map(c => c.config.section);
  check(!sections.includes('scraps'), 'the deleted card is not resurrected by the server');
  eq(created.data.design.layout.guideInitialized, true, 'the initialisation flag is preserved');
});

await test('CREATOR-10: guide geometry is real design geometry and is preserved', async () => {
  const u = await makeUser('c10_guidegeom');
  const card = guideCard('video_box', { x: 640, y: 472, width: 280, height: 140 });
  const created = await api('POST', '/api/profile/design', {
    token: u.token,
    body: { name: 'Sidebar card', layout: { canvas: { width: 960, minHeight: 1200 }, components: [card] } },
  });
  check(created.status === 201, 'a sidebar guide card saves');
  const saved = created.data.design.layout.components[0];
  eq(saved.x, 640, 'x'); eq(saved.y, 472, 'y');
  eq(saved.width, 280, 'width'); eq(saved.height, 140, 'height');
  // Moved and resized, then re-saved.
  const moved = await api('PATCH', `/api/profile/design/${created.data.design.id}`, {
    token: u.token,
    body: {
      layout: {
        canvas: { width: 960, minHeight: 1200 },
        components: [{ ...saved, x: 600, y: 500, width: 300, height: 200 }],
        guideInitialized: true,
      },
    },
  });
  check(moved.status === 200, `the moved card saves, got ${moved.status}: ${JSON.stringify(moved.data)}`);
  eq(moved.data.design.layout.components[0].x, 600, 'moved x is preserved');
  eq(moved.data.design.layout.components[0].width, 300, 'resized width is preserved');
});

// ═══════════════════════════════════════════════════════════════════════════
// Viewer geometry: design vs viewer coordinates
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-10: fit scales the viewer down but never up, and is clamped', () => {
  // The 960x1200 design inside a narrower centre column. Here the HEIGHT is the
  // tighter axis (900/1200), so fit must follow it, not the width.
  eq(viewer.fitZoom({ contentW: 960, contentH: 1200, viewportW: 800, viewportH: 900 }), 0.75,
    'fit follows the tighter of the two axes');
  // When the width is the tighter axis, the width wins.
  eq(viewer.fitZoom({ contentW: 960, contentH: 1200, viewportW: 480, viewportH: 2000 }), 0.5,
    'fit follows the width when the width is tighter');
  // A viewport larger than the design must NOT magnify it.
  eq(viewer.fitZoom({ contentW: 960, contentH: 1200, viewportW: 2000, viewportH: 2000 }), 1,
    'fit never scales past 100%');
  // A tiny viewport clamps to the supported minimum rather than collapsing.
  eq(viewer.fitZoom({ contentW: 960, contentH: 1200, viewportW: 30, viewportH: 30 }), viewer.MIN_ZOOM,
    'fit clamps to MIN_ZOOM');
  // An unlaid-out stage falls back to the ordinary 100% view.
  eq(viewer.fitZoom({}), 1, 'an unmeasured viewport falls back to 1');
  eq(viewer.fitZoom({ contentW: 960, contentH: 1200, viewportW: 0, viewportH: 0 }), 1,
    'a zero viewport falls back to 1');
});

await test('CREATOR-10: zoom and pan never change design coordinates', () => {
  const rect = { left: 100, top: 50, width: 960, height: 1200 };
  // The same design point, at three zoom levels, must map to the same design
  // coordinate once the client point is scaled with the view.
  const designAt = (zoom) => {
    const designX = 40;
    const clientX = rect.left + designX * zoom;
    return viewer.designPoint({ clientX, clientY: rect.top + 20 * zoom, rect, zoom }).x;
  };
  eq(designAt(1), 40, 'at 100%');
  eq(designAt(0.5), 40, 'at 50%');
  eq(designAt(2.5), 40, 'at 250%');
  // Pan is a pure translate: it is cancelled by getBoundingClientRect for free.
  const panned = viewer.viewerTransform({ zoom: 0.75, panX: -120, panY: 30 });
  check(panned.includes('translate(-120px, 30px)'), `pan is a translate, got ${panned}`);
  check(panned.includes('scale(0.75)'), `zoom is a scale, got ${panned}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Image components: fit model + no forced aspect ratio
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-10: an image component keeps its fit and takes any size', async () => {
  const u = await makeUser('c10_image');
  for (const fit of ['cover', 'contain', 'fill']) {
    const comp = imageComp({ config: { imageUrl: '/uploads/creator/pic.webp', fit } });
    const r = await api('POST', '/api/profile/design', {
      token: u.token,
      body: { name: `Image ${fit}`, layout: { canvas: { width: 960, minHeight: 1200 }, components: [comp] } },
    });
    check(r.status === 201, `an image with fit "${fit}" saves, got ${r.status}`);
    eq(r.data.design.layout.components[0].config.fit, fit, `fit "${fit}" round-trips`);
  }
  // Resizing an image does not force an aspect ratio and does not change its source.
  const created = await api('POST', '/api/profile/design', {
    token: u.token,
    body: { name: 'Image', layout: { canvas: { width: 960, minHeight: 1200 }, components: [imageComp()] } },
  });
  const id = created.data.design.id;
  const before = created.data.design.layout.components[0];
  const resized = await api('PATCH', `/api/profile/design/${id}`, {
    token: u.token,
    body: {
      layout: {
        canvas: { width: 960, minHeight: 1200 },
        components: [{ ...before, width: 700, height: 180 }],
        guideInitialized: true,
      },
    },
  });
  check(resized.status === 200, `a freely resized image saves, got ${resized.status}`);
  const after = resized.data.design.layout.components[0];
  eq(after.width, 700, 'width follows the drag');
  eq(after.height, 180, 'height follows the drag independently');
  eq(after.config.imageUrl, before.config.imageUrl, 'the SOURCE image is unchanged by a resize');
  eq(after.config.fit, before.config.fit, 'the fit choice survives a resize');
});

await test('CREATOR-10: an uploaded image URL is validated like any other image', async () => {
  const u = await makeUser('c10_imgbad');
  for (const imageUrl of ['javascript:alert(1)', 'data:image/png;base64,AAA', '//evil/x.png']) {
    const r = await api('POST', '/api/profile/design', {
      token: u.token,
      body: {
        name: 'Bad image',
        layout: { canvas: { width: 960, minHeight: 1200 }, components: [imageComp({ config: { imageUrl, fit: 'cover' } })] },
      },
    });
    check(r.status === 400, `image "${imageUrl}" is rejected, got ${r.status}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-10 PROFILE VIEWER TESTS: ${passed}/${passed + failed} passed\n`);
if (failed > 0) {
  process.stdout.write('FAILURES:\n');
  for (const f of failures) process.stdout.write(`  ✗ ${f.name}\n    ${f.error.message}\n`);
}
process.exit(failed > 0 ? 1 : 0);
