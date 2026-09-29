/**
 * CREATOR-11 — Fonts, animation and Card/Image/Sticker masking.
 *
 * Run:   node tests/test_creator11_fonts_animation_masking.mjs
 *
 * Covers the validated design model (server), the shared renderer registries
 * (client), and the end-to-end Studio → SQLite → publish → public-profile path.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-c11-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-c11.db');
process.env.PORT = String(19100 + (process.pid % 300));
process.env.SECRET_KEY = 'creator-11-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.UPLOAD_CREATOR_DIR = join(TMP_DIR, 'uploads-creator');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;

await import(mod('server/database.js'));
const server = await import(mod('server/profileDesign.js'));
const client = await import(mod('web/js/profileDesign.js'));
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

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const geometry = (over = {}) => ({
  x: 0, y: 0, width: 200, height: 100, zIndex: 0, visible: true, locked: false, ...over,
});
const text = (over = {}) => ({
  id: 't1', type: 'text', ...geometry(), config: { text: 'Hello KomuniPH' }, ...over,
});
const card = (over = {}) => ({
  id: 'c1', type: 'card', ...geometry({ width: 400, height: 300 }), config: { heading: 'My Card' }, ...over,
});
const image = (over = {}) => ({
  id: 'i1', type: 'image', ...geometry({ width: 200, height: 150 }),
  config: { imageUrl: '/uploads/creator/pic.webp', fit: 'cover' }, ...over,
});
const sticker = (over = {}) => ({
  id: 's1', type: 'sticker', ...geometry({ width: 80, height: 80 }),
  config: { imageUrl: '/uploads/creator/stick.webp', fit: 'contain' }, ...over,
});
const design = (...components) => ({
  name: 'CREATOR-11',
  layout: { canvas: { width: 960, minHeight: 1200 }, components },
});
const save = (token, ...components) => api('POST', '/api/profile/design', {
  token, body: design(...components),
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — Fonts
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-11: a valid font family is accepted and round-trips', async () => {
  const u = await makeUser('c11_font');
  for (const fontFamily of server.FONT_FAMILY_IDS) {
    const r = await save(u.token, text({ config: { text: 'Hi', fontFamily } }));
    check(r.status === 201, `font "${fontFamily}" is accepted, got ${r.status}: ${JSON.stringify(r.data)}`);
    eq(r.data.design.layout.components[0].config.fontFamily, fontFamily, 'font round-trips');
  }
});

await test('CREATOR-11: an invalid or hostile font family is rejected', async () => {
  const u = await makeUser('c11_badfont');
  const hostile = [
    'Georgia', // display label, not the stored id
    'Comic Sans MS',
    'arial; background: url(https://evil.test/x)',
    'url(https://evil.test/x.woff)',
    'expression(alert(1))',
    'Arial}',
    '<script>alert(1)</script>',
    'javascript:alert(1)',
    '"" ; color: red ; font-family: Arial',
    'Arial/*',
    'Arial\n; font-size: 99px',
    '',
    42,
    { toString: 'x' },
    ['Arial'],
  ];
  for (const fontFamily of hostile) {
    const r = await save(u.token, text({ config: { text: 'Hi', fontFamily } }));
    check(r.status === 400, `font ${JSON.stringify(fontFamily)} is rejected, got ${r.status}`);
  }
});

await test('CREATOR-11: fontStyle is a controlled allowlist, never CSS', async () => {
  const u = await makeUser('c11_fontstyle');
  for (const fontStyle of ['normal', 'italic']) {
    const r = await save(u.token, text({ config: { text: 'Hi', fontStyle } }));
    check(r.status === 201, `style "${fontStyle}" is accepted, got ${r.status}`);
  }
  for (const fontStyle of ['underline', 'oblique 20deg', 'italic; color:red', '<script>', 700, true]) {
    const r = await save(u.token, text({ config: { text: 'Hi', fontStyle } }));
    check(r.status === 400, `style ${JSON.stringify(fontStyle)} is rejected, got ${r.status}`);
  }
  // A font field on a non-text component is not part of that type's contract.
  const r = await save(u.token, image({ config: { imageUrl: '/uploads/creator/a.webp', fontFamily: 'georgia' } }));
  check(r.status === 400, 'fontFamily is not accepted on an image component');
});

await test('CREATOR-11: a pre-CREATOR-11 text design still loads and saves', async () => {
  const u = await makeUser('c11_legacy');
  // Exactly what an existing published design looks like: no font, no style.
  const legacy = text({ config: { text: 'Legacy', fontSize: 24, textColor: '#fff' } });
  const created = await save(u.token, legacy);
  check(created.status === 201, `an old design without a font still saves, got ${created.status}`);
  const fetched = await api('GET', `/api/profile/design/${created.data.design.id}`, { token: u.token });
  check(fetched.status === 200, 'the old design still loads');
  const config = fetched.data.design.layout.components[0].config;
  eq(config.text, 'Legacy', 'the old text survived');
  eq(config.fontFamily, undefined, 'no font was invented on load');
  // And the renderer supplies a safe default rather than nothing.
  const resolved = client.FONT_FAMILIES.get(config.fontFamily || client.DEFAULT_FONT_FAMILY);
  check(!!resolved && resolved.stack.length > 0, 'a default font stack is available for a fontless design');
  const typography = { style: {} };
  client.applyTypographyToElement(typography, config);
  check(/system-ui/.test(typography.style.fontFamily),
    `a fontless design renders the platform default, got "${typography.style.fontFamily}"`);
  eq(typography.style.fontStyle, 'normal', 'a fontless design defaults to a normal style');
});

await test('CREATOR-11: the client and server font registries agree', () => {
  eq(
    JSON.stringify([...server.FONT_FAMILIES.keys()].sort()),
    JSON.stringify([...client.FONT_FAMILIES.keys()].sort()),
    'font id sets match',
  );
  for (const [id, family] of server.FONT_FAMILIES) {
    eq(client.FONT_FAMILIES.get(id).stack, family.stack, `the CSS stack for "${id}" matches on both sides`);
    check(!/[^a-zA-Z0-9\s,;"'\-()]/.test(family.stack), `"${id}" stack has no unexpected CSS syntax`);
  }
  eq(client.DEFAULT_FONT_FAMILY, server.DEFAULT_FONT_FAMILY, 'the default font matches');
  eq(JSON.stringify([...server.FONT_STYLES].sort()), JSON.stringify([...client.FONT_STYLES].sort()), 'style sets match');
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3 — Animation
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-11: every allowlisted animation is accepted and round-trips', async () => {
  const u = await makeUser('c11_anim');
  for (const name of server.ANIMATION_NAMES) {
    const r = await save(u.token, text({
      config: {
        text: 'Animate me',
        animation: { name, duration: 2, delay: 0.5, iteration: 'infinite', timing: 'ease-in-out' },
      },
    }));
    check(r.status === 201, `animation "${name}" is accepted, got ${r.status}: ${JSON.stringify(r.data)}`);
    const stored = r.data.design.layout.components[0].config.animation;
    eq(stored.name, name, 'animation name round-trips');
    eq(stored.duration, 2, 'duration round-trips');
    eq(stored.delay, 0.5, 'delay round-trips');
    eq(stored.iteration, 'infinite', 'iteration round-trips');
    eq(stored.timing, 'ease-in-out', 'timing round-trips');
  }
});

await test('CREATOR-11: Text, Image, Sticker and Card can all be animated', async () => {
  const u = await makeUser('c11_animall');
  const animation = { name: 'float', duration: 3, delay: 0, iteration: 2, timing: 'ease-in-out' };
  const comps = [
    text({ config: { text: 'T', animation } }),
    image({ config: { imageUrl: '/uploads/creator/a.webp', animation } }),
    sticker({ config: { imageUrl: '/uploads/creator/b.webp', animation } }),
    card({ config: { heading: 'C', animation } }),
  ];
  for (const comp of comps) {
    const r = await save(u.token, comp);
    check(r.status === 201, `a ${comp.type} with an animation saves, got ${r.status}: ${JSON.stringify(r.data)}`);
    eq(r.data.design.layout.components[0].config.animation.name, 'float', `${comp.type} animation persisted`);
  }
});

await test('CREATOR-11: invalid animation values are rejected', async () => {
  const u = await makeUser('c11_badanim');
  const bad = [
    { name: 'explode' },
    { name: 'shake; } body { display:none' },
    { name: 'x', css: 'x{}' },
    { name: 'x', animationName: 'evil' },
    { name: 'x', timing: 'steps(999)' },
    { name: 'x', timing: 'cubic-bezier(0;0)' },
    { name: 'x', duration: 0 },
    { name: 'x', duration: -1 },
    { name: 'x', duration: 9999 },
    { name: 'x', duration: '2s' },
    { name: 'x', delay: -1 },
    { name: 'x', delay: 9999 },
    { name: 'x', iteration: 0 },
    { name: 'x', iteration: -3 },
    { name: 'x', iteration: 2.5 },
    { name: 'x', iteration: 'forever' },
    { name: 'x', iteration: 99999 },
    'fade 2s infinite',
    42,
    ['fade'],
  ];
  for (const animation of bad) {
    const r = await save(u.token, text({ config: { text: 'x', animation } }));
    check(r.status === 400, `animation ${JSON.stringify(animation)} is rejected, got ${r.status}`);
  }
  // A controlled profile module is not animatable in this milestone.
  const r = await save(u.token, {
    id: 'bio1', type: 'bio', ...geometry(), config: { animation: { name: 'float' } },
  });
  check(r.status === 400, 'a controlled profile module cannot carry an animation');
});

await test('CREATOR-11: an animation name only ever maps to an application keyframes rule', () => {
  // The renderer must resolve a stored id to a name the stylesheet owns. There is
  // no path where the stored value itself becomes animationName.
  const fakeEl = () => ({ style: {}, classList: { add() {}, remove() {} } });
  for (const name of server.ANIMATION_NAMES) {
    const el = fakeEl();
    client.applyAnimationToElement(el, { name, duration: 2, delay: 0, iteration: 1, timing: 'linear' });
    if (name === 'none') {
      eq(el.style.animationName, '', 'none applies no animation');
      continue;
    }
    eq(el.style.animationName, `komuniph-anim-${name}`, `"${name}" maps to the owned keyframes rule`);
    check(/^komuniph-anim-[a-z-]+$/.test(el.style.animationName), 'the animation name is never a raw stored string');
    eq(el.style.animationDuration, '2s', 'duration is applied');
    eq(el.style.animationIterationCount, '1', 'a finite iteration count is applied');
  }
  // A hostile or unknown stored value can never become a keyframes name.
  for (const name of ['evil; } * { display: none }', 'url(x)', 'x', 42, null]) {
    const el = fakeEl();
    client.applyAnimationToElement(el, { name, duration: 2 });
    check(!/evil|url\(|42/.test(String(el.style.animationName || '')),
      `a hostile animation name is neutralised, got "${el.style.animationName}"`);
  }
});

await test('CREATOR-11: animation never changes geometry', () => {
  // Playback is presentation only: applyAnimationToElement touches no geometry
  // property, and the design object it is given is not mutated.
  const comp = text({ config: { text: 'x', animation: { name: 'bounce', duration: 2, iteration: 'infinite' } } });
  const before = JSON.stringify(comp);
  const el = { style: {}, classList: { add() {}, remove() {} } };
  client.applyAnimationToElement(el, comp.config.animation);
  for (const key of ['left', 'top', 'width', 'height']) {
    check(el.style[key] === undefined, `animation did not write a "${key}" style`);
  }
  eq(JSON.stringify(comp), before, 'applying an animation did not mutate the component');
});

await test('CREATOR-11: reduced motion disables playback without touching the design', () => {
  const animation = { name: 'float', duration: 2, delay: 1, iteration: 'infinite', timing: 'ease' };
  const comp = text({ config: { text: 'x', animation } });
  const before = JSON.stringify(comp);
  const el = { style: {}, classList: { add() {}, remove() {} } };
  client.applyAnimationToElement(el, animation, { reducedMotion: true });
  eq(el.style.animationName, '', 'no animation is applied under reduced motion');
  eq(JSON.stringify(comp), before, 'the stored animation is untouched by reduced motion');
  // Without the preference it plays again — the setting was never removed.
  const el2 = { style: {}, classList: { add() {}, remove() {} } };
  client.applyAnimationToElement(el2, animation, { reducedMotion: false });
  eq(el2.style.animationName, 'komuniph-anim-float', 'the animation returns when motion is allowed');
});

await test('CREATOR-11: a pre-CREATOR-11 design with no animation still loads', async () => {
  const u = await makeUser('c11_animlegacy');
  const r = await save(u.token, text({ config: { text: 'No anim' } }));
  check(r.status === 201, 'a design with no animation saves');
  eq(client.resolveAnimation(undefined), null, 'a missing animation resolves to none');
  eq(client.resolveAnimation({ name: 'none' }), null, '"none" resolves to no animation');
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4 — Card containers and masking
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-11: Card can contain an Image and a Sticker', async () => {
  const u = await makeUser('c11_nest');
  const r = await save(u.token,
    card({ config: { heading: 'My Card', mask: true } }),
    image({ parentId: 'c1', x: 20, y: 30, width: 360, height: 180 }),
    sticker({ parentId: 'c1', x: 200, y: 220, width: 60, height: 60 }),
  );
  check(r.status === 201, `a card with an image and a sticker saves, got ${r.status}: ${JSON.stringify(r.data)}`);
  const saved = r.data.design.layout.components;
  eq(saved.length, 3, 'all three components are stored');
  eq(saved[1].parentId, 'c1', 'the image references the card');
  eq(saved[2].parentId, 'c1', 'the sticker references the card');
  // Child coordinates are LOCAL and must survive untouched.
  eq(saved[1].x, 20, 'the image keeps its local x');
  eq(saved[1].y, 30, 'the image keeps its local y');
  eq(saved[1].width, 360, 'the image keeps its local width');
});

await test('CREATOR-11: invalid and circular parent relationships are rejected', async () => {
  const u = await makeUser('c11_badnest');
  const cases = [
    ['a card inside a card', card(), card({ id: 'c2', parentId: 'c1' })],
    ['a text inside a card', card(), text({ id: 't1', parentId: 'c1' })],
    ['a missing parent', card(), image({ parentId: 'nope' })],
    ['a self parent', image({ parentId: 'i1' })],
    ['two levels of nesting', card(), image({ id: 'i1', parentId: 'c1' }), image({ id: 'i2', parentId: 'i1' })],
    ['a non-string parentId', card(), image({ parentId: 42 })],
    ['a hostile parentId', card(), image({ parentId: '"><script>' })],
    ['an image containing a card', image(), card({ id: 'c2', parentId: 'i1' })],
  ];
  for (const [label, ...comps] of cases) {
    const r = await save(u.token, ...comps);
    check(r.status === 400, `${label} is rejected, got ${r.status}: ${JSON.stringify(r.data)}`);
  }
});

await test('CREATOR-11: the server explicitly detects a circular parent chain', () => {
  // With the type rules a cycle is unreachable, so the walk is exercised directly:
  // it is the defence in depth that keeps it unreachable if the types ever change.
  const errors = [];
  server.validateParentRelationships([
    { id: 'a', type: 'image', parentId: 'b' },
    { id: 'b', type: 'card', parentId: 'a' },
  ], errors);
  check(errors.some(e => /circular/.test(e)), `a cycle is reported, got ${JSON.stringify(errors)}`);

  const longer = [];
  server.validateParentRelationships([
    { id: 'a', type: 'image', parentId: 'b' },
    { id: 'b', type: 'card', parentId: 'c' },
    { id: 'c', type: 'card', parentId: 'a' },
  ], longer);
  check(longer.some(e => /circular/.test(e)), `a longer cycle is reported, got ${JSON.stringify(longer)}`);

  // A long chain is rejected on depth rather than looping.
  const deep = [];
  server.validateParentRelationships([
    { id: 'root', type: 'card' },
    { id: 'a', type: 'image', parentId: 'root' },
    { id: 'b', type: 'card', parentId: 'a' },
    { id: 'c', type: 'image', parentId: 'b' },
  ], deep);
  check(deep.length > 0, 'an over-deep chain is rejected');
});

await test('CREATOR-11: Content Mask is a boolean, not a CSS clip value', async () => {
  const u = await makeUser('c11_mask');
  for (const mask of [true, false]) {
    const r = await save(u.token, card({ config: { heading: 'H', mask } }), image({ parentId: 'c1' }));
    check(r.status === 201, `mask=${mask} is accepted, got ${r.status}`);
    eq(r.data.design.layout.components[0].config.mask, mask, 'mask round-trips');
  }
  for (const mask of ['clip', 'circle(50%)', 1, 'true', {}]) {
    const r = await save(u.token, card({ config: { heading: 'H', mask } }));
    check(r.status === 400, `mask ${JSON.stringify(mask)} is rejected, got ${r.status}`);
  }
  // Mask is a card-only field.
  const r = await save(u.token, image({ config: { imageUrl: '/uploads/creator/a.webp', mask: true } }));
  check(r.status === 400, 'mask is not accepted on an image component');
});

await test('CREATOR-11: masking never bakes or replaces the image source', async () => {
  const u = await makeUser('c11_quality');
  const original = '/uploads/creator/original-4k.webp';
  const created = await save(u.token,
    card({ config: { heading: 'H', mask: true }, style: { borderRadius: 32 } }),
    image({ parentId: 'c1', x: 0, y: 0, width: 400, height: 300, config: { imageUrl: original, fit: 'cover' } }),
  );
  check(created.status === 201, 'the masked design saves');
  const img = created.data.design.layout.components[1];
  eq(img.config.imageUrl, original, 'the ORIGINAL uploaded image source is still stored');
  check(!/data:|screenshot|render|canvas/i.test(img.config.imageUrl), 'the source was not replaced by a baked artifact');

  // Every fit mode still works inside a card and never touches the source.
  for (const fit of ['cover', 'contain', 'fill']) {
    const r = await save(u.token,
      card({ id: 'c1', config: { heading: 'H', mask: true } }),
      image({ id: 'i1', parentId: 'c1', config: { imageUrl: original, fit } }),
    );
    check(r.status === 201, `fit "${fit}" inside a masked card saves, got ${r.status}`);
    const savedImg = r.data.design.layout.components[1];
    eq(savedImg.config.fit, fit, `fit "${fit}" survives the mask`);
    eq(savedImg.config.imageUrl, original, 'the source is unchanged by the mask');
  }

  // Resizing the card and the child is a pure geometry edit.
  const resized = await api('PATCH', `/api/profile/design/${created.data.design.id}`, {
    token: u.token,
    body: {
      layout: {
        canvas: { width: 960, minHeight: 1200 },
        components: [
          { ...created.data.design.layout.components[0], width: 220, height: 180 },
          { ...img, width: 150, height: 110 },
        ],
        guideInitialized: true,
      },
    },
  });
  check(resized.status === 200, `the masked design can be resized, got ${resized.status}: ${JSON.stringify(resized.data)}`);
  eq(resized.data.design.layout.components[0].width, 220, 'the card resized');
  eq(resized.data.design.layout.components[1].width, 150, 'the child resized');
  eq(resized.data.design.layout.components[1].config.imageUrl, original,
    'resizing the card and its child never changes the image source');
});

await test('CREATOR-11: save, reload and publish all preserve the relationship', async () => {
  const u = await makeUser('c11_persist');
  const created = await save(u.token,
    card({ config: { heading: 'Gallery Card', mask: true }, style: { borderRadius: 24 } }),
    image({ parentId: 'c1', x: 12, y: 40, width: 200, height: 120, config: { imageUrl: '/uploads/creator/g.webp', fit: 'contain', animation: { name: 'zoom-in', duration: 1.5, delay: 0, iteration: 3, timing: 'ease-out' } } }),
    sticker({ parentId: 'c1', x: 240, y: 200, width: 70, height: 70, config: { imageUrl: '/uploads/creator/s.webp', fit: 'fill' } }),
    text({ id: 't1', config: { text: 'Styled', fontFamily: 'georgia', fontStyle: 'italic', fontSize: 28, animation: { name: 'float', duration: 2, delay: 0, iteration: 'infinite', timing: 'ease-in-out' } } }),
  );
  check(created.status === 201, `the combined design saves, got ${created.status}: ${JSON.stringify(created.data)}`);
  const id = created.data.design.id;

  const reloaded = await api('GET', `/api/profile/design/${id}`, { token: u.token });
  check(reloaded.status === 200, 'the design reloads');
  const byId = new Map(reloaded.data.design.layout.components.map(c => [c.id, c]));
  eq(byId.get('i1').parentId, 'c1', 'the image relationship survives a reload');
  eq(byId.get('s1').parentId, 'c1', 'the sticker relationship survives a reload');
  eq(byId.get('i1').config.animation.name, 'zoom-in', 'the image animation survives a reload');
  eq(byId.get('t1').config.fontFamily, 'georgia', 'the font survives a reload');
  eq(byId.get('t1').config.fontStyle, 'italic', 'the font style survives a reload');
  eq(byId.get('c1').config.mask, true, 'the mask setting survives a reload');
  eq(byId.get('c1').style.borderRadius, 24, 'the card radius survives a reload');

  const published = await api('POST', `/api/profile/design/${id}/publish`, { token: u.token });
  check(published.status === 200, `publish succeeds, got ${published.status}: ${JSON.stringify(published.data)}`);

  const profile = await api('GET', `/api/profile/${u.username}`);
  check(profile.status === 200, 'the public profile loads after publishing');
  const publicById = new Map((profile.data.design.layout.components || []).map(c => [c.id, c]));
  eq(publicById.get('i1').parentId, 'c1', 'the public profile keeps the image→card relationship');
  eq(publicById.get('s1').parentId, 'c1', 'the public profile keeps the sticker→card relationship');
  eq(publicById.get('t1').config.fontFamily, 'georgia', 'the public profile keeps the font');
  eq(publicById.get('i1').config.animation.name, 'zoom-in', 'the public profile keeps the animation');
  eq(publicById.get('i1').config.imageUrl, '/uploads/creator/g.webp', 'the public profile keeps the original image source');
});

// ═══════════════════════════════════════════════════════════════════════════
// Renderer registries
// ═══════════════════════════════════════════════════════════════════════════
await test('CREATOR-11: the client animation registry matches the server', () => {
  eq(
    JSON.stringify([...server.ANIMATION_NAMES].sort()),
    JSON.stringify([...client.ANIMATION_NAMES].sort()),
    'animation name sets match',
  );
  eq(
    JSON.stringify([...server.ANIMATION_TIMINGS].sort()),
    JSON.stringify([...client.ANIMATION_TIMINGS].sort()),
    'timing sets match',
  );
  eq(server.ANIMATION_DURATION_MAX, client.ANIMATION_DURATION_MAX, 'duration bounds match');
  eq(server.ANIMATION_DELAY_MAX, client.ANIMATION_DELAY_MAX, 'delay bounds match');
  for (const name of client.ANIMATION_NAMES) {
    check(typeof client.ANIMATION_LABELS[name] === 'string' && client.ANIMATION_LABELS[name].length > 0,
      `"${name}" has a UI label`);
  }
  eq(client.ANIMATION_NAMES.length, server.ANIMATION_NAMES.size, 'the sets are the same size');
});

await test('CREATOR-11: out-of-range animation values are clamped, never passed through', () => {
  const el = { style: {}, classList: { add() {}, remove() {} } };
  client.applyAnimationToElement(el, { name: 'float', duration: 1e9, delay: -50, iteration: 1e9, timing: 'evil' });
  eq(el.style.animationDuration, `${client.ANIMATION_DURATION_MAX}s`, 'an excessive duration is clamped');
  eq(el.style.animationDelay, '0s', 'a negative delay is clamped');
  eq(el.style.animationIterationCount, '1000', 'an excessive iteration count is clamped');
  eq(el.style.animationTimingFunction, client.DEFAULT_ANIMATION.timing, 'an unknown timing falls back');

  const el2 = { style: {}, classList: { add() {}, remove() {} } };
  client.applyAnimationToElement(el2, { name: 'float', duration: 0.01, delay: 1e9, iteration: 0, timing: 'linear' });
  eq(el2.style.animationDuration, `${client.ANIMATION_DURATION_MIN}s`, 'a tiny duration is clamped up');
  eq(el2.style.animationDelay, `${client.ANIMATION_DELAY_MAX}s`, 'a huge delay is clamped down');
  eq(el2.style.animationIterationCount, '1', 'a zero iteration count is clamped up to 1');
});

await test('CREATOR-11: the card child allowlist is shared by both sides', () => {
  eq(
    JSON.stringify([...server.CARD_CHILD_TYPES].sort()),
    JSON.stringify([...client.CARD_CHILD_TYPES].sort()),
    'child type sets match',
  );
  eq(
    JSON.stringify([...server.CARD_PARENT_TYPES].sort()),
    JSON.stringify([...client.CARD_PARENT_TYPES].sort()),
    'parent type sets match',
  );
  check(!client.CARD_CHILD_TYPES.has('card'), 'a card cannot be a child');
  check(!client.CARD_CHILD_TYPES.has('text'), 'text cannot be a child');
  check(client.CARD_CHILD_TYPES.has('image') && client.CARD_CHILD_TYPES.has('sticker'),
    'image and sticker can be children');
});

// ═══════════════════════════════════════════════════════════════════════════
process.stdout.write('\n════════════════════════════════════════════════════════════\n');
process.stdout.write(`CREATOR-11 FONTS / ANIMATION / MASKING TESTS: ${passed}/${passed + failed} passed\n`);
if (failed > 0) {
  process.stdout.write('FAILURES:\n');
  for (const f of failures) process.stdout.write(`  ✗ ${f.name}\n    ${f.error.message}\n`);
}
process.exit(failed > 0 ? 1 : 0);
