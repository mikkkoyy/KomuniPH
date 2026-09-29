import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'komuniph-dbg-'));
process.env.DATABASE_PATH = join(TMP_DIR, 'test-dbg.db');
process.env.PORT = String(19700 + (process.pid % 200));
process.env.SECRET_KEY = 'creator-09-debug-secret-key-that-is-long-enough-32';
process.env.CORS_ORIGINS = 'http://127.0.0.1';
process.env.HOST = '127.0.0.1';
process.env.DEV_ADMIN_ENABLED = 'true';
process.env.DEV_ADMIN_USERNAME = 'dbg-admin';
process.env.UPLOAD_CREATOR_DIR = join(TMP_DIR, 'uploads-creator');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const mod = (rel) => pathToFileURL(resolve(rel).toString().replace(/\\/g, '/')).href;
await import(mod('server/database.js'));
await import(mod('server/index.js'));

const user = { username: 'dbg_seller01', email: 'dbg_seller01@test.local', password: 'password123' };
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user),
});
const regData = await reg.json();
const token = regData.token;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text().slice(0, 300)); });
page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));

await page.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#login-identifier', { timeout: 15000 });
await page.type('#login-identifier', user.username);
await page.type('#login-password', user.password);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
  page.click('#login-submit'),
]);
await new Promise(r => setTimeout(r, 1200));
await page.goto(`${BASE}/#/creator-studio`, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));

const dump = await page.evaluate(() => {
  const layout = document.querySelector('#studio-layout');
  const stage = document.querySelector('#studio-stage');
  const ws = document.querySelector('#studio-workspace');
  return {
    hasWorkspace: !!ws,
    workspaceHidden: ws ? ws.hasAttribute('hidden') : null,
    layoutCols: layout ? getComputedStyle(layout).gridTemplateColumns : null,
    stageHeight: stage ? stage.getBoundingClientRect().height : null,
    stageInline: stage ? stage.style.height : null,
    status: document.querySelector('#studio-status')?.textContent,
    addButtons: document.querySelectorAll('[data-add]').length,
    canvasSizeLabel: document.querySelector('#studio-canvas-size')?.textContent,
    guideCards: document.querySelectorAll('[data-comp-type="profile_guide_card"]').length,
    layerRows: document.querySelectorAll('.studio-layer-row').length,
  };
});
console.log('DUMP:', JSON.stringify(dump, null, 2));

// ── Isolated guide-card pointer probe ──────────────────────────────────────
const probe = await page.evaluate(() => {
  document.querySelector('#studio-viewer').scrollIntoView({ block: 'center', inline: 'center' });
  const el = document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide_card"]')[0];
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  return {
    cardRect: { l: r.left, t: r.top, w: r.width, h: r.height },
    point: { x, y },
    topTag: top ? top.tagName : null,
    topClass: top ? String(top.className) : null,
    insideCard: top?.closest('[data-comp-type="profile_guide_card"]') === el,
    elemAtCenter: (() => {
      const own = el.getBoundingClientRect();
      return document.elementFromPoint(own.left + own.width / 2, own.top + own.height / 2)?.tagName;
    })(),
  };
});
console.log('PROBE:', JSON.stringify(probe, null, 2));

// Real pointer: press on the card, drag, release.
await page.mouse.move(probe.point.x, probe.point.y);
await page.mouse.down();
await page.mouse.move(probe.point.x + 60, probe.point.y + 40, { steps: 12 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 400));
const after = await page.evaluate(() => {
  const el = document.querySelectorAll('#studio-canvas-inner [data-comp-type="profile_guide_card"]')[0];
  return {
    left: el.style.left, top: el.style.top,
    selected: el.classList.contains('studio-selected'),
    status: document.querySelector('#studio-status')?.textContent,
  };
});
console.log('AFTER DRAG:', JSON.stringify(after, null, 2));

await browser.close();
process.exit(0);
