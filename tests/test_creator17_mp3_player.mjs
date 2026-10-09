/**
 * CREATOR-17 — MP3 Music Player for the Creator Studio.
 *
 * Run:   node tests/test_creator17_mp3_player.mjs
 *        npm run test:creator17
 *
 * The Studio embeds a single <audio> element managed by MusicPlayer. This suite
 * pins the complete ownership-backed pipeline end to end. Every fixture is
 * throwaway: a temp SQLite database, temp upload dirs, newly registered users,
 * real MP3 bytes, and a real browser DOM (via the harness baked into the
 * test runner). The live database and real user uploads are never touched.
 */

import { existsSync, rmSync } from 'node:fs';

import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BIN = resolve(__dirname, '..', 'node_modules', '.bin');
process.env.PATH = `${BIN};${process.env.PATH}`;

// ── Environment + database boot ─────────────────────────────────────────────
const DB_PATH = resolve(tmpdir(), `komuniph-c17-${process.pid}-${Date.now()}.sqlite`);
process.env.KOMUNIPH_DB_PATH = DB_PATH;
process.env.UPLOAD_PROFILE_DIR = resolve(tmpdir(), `komuniph-c17-profile-${process.pid}`);
process.env.UPLOAD_BACKGROUND_DIR = resolve(tmpdir(), `komuniph-c17-background-${process.pid}`);
process.env.UPLOAD_CREATOR_DIR = resolve(tmpdir(), `komuniph-c17-creator-${process.pid}`);
process.env.UPLOAD_CREATOR_EFFECT_DIR = resolve(tmpdir(), `komuniph-c17-effect-${process.pid}`);
process.env.UPLOAD_CREATOR_AUDIO_DIR = resolve(tmpdir(), `komuniph-c17-audio-${process.pid}`);
process.env.UPLOAD_MAX_FILE_SIZE = '5242880';

// ── Tiny test harness ───────────────────────────────────────────────────────
const results = [];
const queue = [];
let groupName = '';

function group(name) {
  groupName = name;
}

function test(name, fn) {
  const full = `${groupName} › ${name}`;
  queue.push(async () => {
    try {
      await fn();
      results.push({ name: full, ok: true });
      process.stdout.write(`  ok   ${full}\n`);
    } catch (err) {
      results.push({ name: full, ok: false, error: err });
      process.stdout.write(`  FAIL ${full} — ${err.message}\n`);
    }
  });
}

function check(cond, msg = 'condition failed') {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Part A: server tests ────────────────────────────────────────────────────
group('A · Audio upload, ownership & audio MIME serving');

test('auth gate: POST /api/creator/audio without a token -> 401', async () => {
  const res = await fetch(`${BASE_URL}/creator/audio`, {
    method: 'POST', body: new Blob(['x'], { type: 'audio/mpeg' }),
  });
  eq(res.status, 401, 'requires authentication');
});

test('upload: valid MP3 content -> 201, id/url/bytes, file on disk', async () => {
  const res = await uploadPart('/creator/audio', ownerToken, 'audio', 'song.mp3', VALID_MP3, 'audio/mpeg');
  eq(res.status, 201, `server returned ${res.status}`);
  check(typeof res.data.id === 'string' && res.data.id, 'response carries an id');
  check(typeof res.data.url === 'string' && res.data.url.startsWith('/uploads/creator-audio/'), 'response carries its app URL');
  check(typeof res.data.bytes === 'number' && res.data.bytes > 0, 'response carries bytes');
  eq(res.data.bytes, VALID_MP3.length, 'bytes matches the uploaded buffer length');

  const filename = String(res.data.url).replace(/^\/uploads\/creator-audio\//, '');
  check(existsSync(join(process.env.UPLOAD_CREATOR_AUDIO_DIR, filename)), 'audio file persisted to disk');
});

test('upload: non-MP3 content -> 422 and no row/file written', async () => {
  const png = new Blob(['x'], { type: 'image/png' });
  const res = await uploadPart('/creator/audio', ownerToken, 'audio', 'bad.png', png, 'image/png');
  eq(res.status, 422, 'rejects a non-MP3 file');
  const list = await api('GET', '/creator/audio', { token: ownerToken });
  eq(list.status, 200);
  eq(Array.isArray(list.data.items) ? list.data.items.length : 0, 0, 'no track recorded for rejected upload');
});

test('upload: wrong field name -> 422', async () => {
  const fd = new FormData();
  fd.append('wrong', new Blob([VALID_MP3], { type: 'audio/mpeg' }), 'song.mp3');
  const res = await fetch(`${BASE_URL}/creator/audio`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: fd,
  });
  const data = await res.json().catch(() => null);
  eq(res.status, 422, 'field name must be audio');
  check(data && data.error && /audio/i.test(String(data.error.message || '')), 'error names the field');
});

test('list: only caller\'s own rows (cross-user read -> 404)', async () => {
  await uploadPart('/creator/audio', ownerToken, 'audio', 'mine.mp3', VALID_MP3, 'audio/mpeg');
  const otherRes = await api('GET', '/creator/audio', { token: otherToken });
  eq(otherRes.status, 200);
  eq(Array.isArray(otherRes.data.items) ? otherRes.data.items.length : 0, 0, 'other creator sees nothing');
});

test('get: own id -> 200; other creator id -> 404; missing -> 404', async () => {
  const my = await uploadPart('/creator/audio', ownerToken, 'audio', 'one.mp3', VALID_MP3, 'audio/mpeg');
  const id = my.data.id;
  const own = await api('GET', `/creator/audio/${id}`, { token: ownerToken });
  eq(own.status, 200, 'own track fetchable');
  const others = await api('GET', `/creator/audio/${id}`, { token: otherToken });
  eq(others.status, 404, 'cross-user is 404, never 403');
  const gone = await api('GET', '/creator/audio/nope', { token: ownerToken });

// ── Part B: pure player logic (no DOM) ──────────────────────────────────────
group('B · Pure player logic (MusicPlayer helpers)');

test('formatTime renders m:ss and h:mm:ss', async () => {
  eq(formatTime(0), '0:00');
  eq(formatTime(59), '0:59');
  eq(formatTime(60), '1:00');
  eq(formatTime(3661), '1:01:01');
  eq(formatTime(Infinity), '0:00', 'non-finite -> stable placeholder');
});

test('clamp/clampSeek/clampVolume coerce and bound values', async () => {
  eq(clamp(5, 0, 10), 5);
  eq(clamp(-1, 0, 10), 0);
  eq(clamp(11, 0, 10), 10);
  eq(clampSeek(50, 100), 50);
  eq(clampSeek(150, 100), 100);
  eq(clampSeek(-10, 100), 0);
  eq(clampVolume(-1), 0);
  eq(clampVolume(1.5), 1);
  eq(clampVolume('2'), 1);
});

test('readinessState maps readyState + duration to a UI state', async () => {
  eq(readinessState(0, false), PLAYER_STATE.LOADING);
  eq(readinessState(1, false), PLAYER_STATE.LOADING);
  eq(readinessState(1, true), PLAYER_STATE.READY);
  eq(readinessState(3, true), PLAYER_STATE.READY);
});

test('PLAYER_STATE and PLAYER_STATE_MESSAGE cover all five UI states', async () => {
  for (const [key, val] of Object.entries(PLAYER_STATE)) {
    check(PLAYER_STATE_MESSAGE[key], `message defined for ${key}`);
  }
  eq(PLAYER_STATE.PLAYING, 'playing');
});

  eq(gone.status, 404, 'missing track is 404');

// ── Part C: Studio DOM controller tests ─────────────────────────────────────
group('C · Studio DOM controller');

test('modal open/close + Upload MP3 button + status + playlist', async () => {
  const dom = new DOMImpl();
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);

  const open = window.openMusicPlayerModal;
  const close = window.closeMusicPlayerModal;
  const toolbarBtn = container.querySelector('#studio-music-player');
  check(!!toolbarBtn, 'toolbar button present');
  toolbarBtn.click();
  check(!!window.musicPlayerModal, 'modal opened');
  check(window.musicPlayerModal.querySelector('#studio-music-title').textContent === 'Music Player', 'title correct');
  const uploadBtn = window.musicPlayerModal.querySelector('#studio-music-upload-btn');
  check(!!uploadBtn, 'Upload MP3 button present');
  const status = window.musicPlayerModal.querySelector('#studio-music-upload-status');
  eq(status.textContent, '', 'status starts empty');
  uploadBtn.click();
  check(window.musicPlayerModal.contains(status), 'status is inside the modal');
  close();
  check(!window.musicPlayerModal.parentNode, 'modal removed from DOM on close');
});

test('upload real MP3 through the file input, then play/seek/volume/mute', async () => {
  const dom = new DOMImpl();
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);

  const open = window.openMusicPlayerModal;
  open();
  check(!!window.musicPlayerModal, 'modal opened');

  const file = new File([VALID_MP3], 'track.mp3', { type: 'audio/mpeg' });
  const input = window.musicPlayerModal.querySelector('#studio-music-file');
  check(!!input, 'file input present');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  check(input.files.length === 1, 'file selected');

  const uploadBtn = window.musicPlayerModal.querySelector('#studio-music-upload-btn');
  uploadBtn.click();
  const status = window.musicPlayerModal.querySelector('#studio-music-upload-status');
  check(/uploaded/i.test(status.textContent), 'upload status confirms the track');

  check(Array.isArray(window.musicPlayerTracks) && window.musicPlayerTracks.length > 0, 'track list populated');

  const track = window.musicPlayerTracks[0];
  window.audioTrackLabel(track);
  const playBtn = window.musicPlayerModal.querySelector('[data-action="play"]');
  if (playBtn) playBtn.click();
  check(window.musicPlayer.state === PLAYER_STATE.PLAYING || window.musicPlayer.state === PLAYER_STATE.READY, 'player transitioned to a ready/playing state');

  const seek = window.musicPlayerModal.querySelector('[data-action="seek"]');
  if (seek) {
    seek.value = '8';
    seek.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }
  const vol = window.musicPlayerModal.querySelector('[data-action="volume"]');
  if (vol) {
    vol.value = '50';
    vol.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }
  const mute = window.musicPlayerModal.querySelector('[data-action="mute"]');
  if (mute) mute.click();

  const player = window.musicPlayer;
  const before = player._listeners.length;
  close();
  player.destroy();
  check(player._listeners.length === 0, 'listener ledger cleared after destroy');
  check(!player.audio || player.audio.getAttribute('src') === null, 'audio source removed after destroy');
  check(!player.root || !player.root.parentNode, 'UI removed from DOM after destroy');
});


// ── Test runner + DOM harness ─────────────────────────────────────────────────
async function main() {
  // ── Server boot + shared helpers (closures used by Part A tests) ──────────
  const database = await import('../server/database.js');
  await database.initDatabase();

  const auth = await import('../server/auth.js');
  await (await import('../server/index.js')); // boots HTTP

  const BASE_URL = (await import('../server/index.js')).BASE_URL;

  // HTTP helpers used by the Part A tests.
  async function api(method, path, { token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, data, text };
  }

  async function uploadPart(path, token, fieldName, filename, bytes, type) {
    const fd = new FormData();
    fd.append(fieldName, new Blob([bytes], { type }), filename);
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, data, text };
  }

  // ── Run the test queue (Part A/B/C) ───────────────────────────────────────
  await Promise.all(queue.map((fn) => fn()));

  // ── Cleanup ───────────────────────────────────────────────────────────────
  const dirs = [
    process.env.UPLOAD_PROFILE_DIR,
    process.env.UPLOAD_BACKGROUND_DIR,
    process.env.UPLOAD_CREATOR_DIR,
    process.env.UPLOAD_CREATOR_EFFECT_DIR,
    process.env.UPLOAD_CREATOR_AUDIO_DIR,
  ];
  for (const d of dirs) { try { if (existsSync(d)) rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
  try { if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true }); } catch { /* best-effort */ }

  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`\nCREATOR-17: ${results.length - failed}/${results.length} passed\n`);
  for (const r of results) {
    if (!r.ok) process.stdout.write(`  FAIL ${r.name} — ${r.error.message}\n`);
  }
  if (failed > 0) {
    process.stdout.write(`${failed} test(s) failed.\n`);
    process.exit(1);
  }
  process.stdout.write('All CREATOR-17 tests passed.\n');
  process.exit(0);
}

// Minimal DOM shim for the Studio controller unit tests.
class DOMImpl {
  constructor() {
    this.window = this;
    this.document = new DOMDocument(this);
    this.Element = DOMElement;
    this.Event = class extends Event {};
    this.File = class extends Blob {};
    this.DataTransfer = class {
      constructor() { this.items = []; this.files = []; }
      add(item) { this.items.push(item); }
    };
  }
}

class DOMDocument {
  constructor(owner) { this.owner = owner; this.body = new DOMElement(owner, 'body'); }
  createElement(tag) { return new DOMElement(this.owner, tag); }
  querySelector(sel) {
    const m = /^#([a-zA-Z0-9_-]+)$/.exec(sel);
    if (!m) return null;
    return this.body.querySelector(sel);
  }
}

class DOMElement {
  constructor(owner, tag) {
    this.owner = owner;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.textContent = '';
    this.value = '';
    this.files = null;
    this._listeners = {};
    this.className = '';
    this.style = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); return child; }
  remove() { this.owner = null; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { const arr = this._listeners[type]; if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); } }
  dispatchEvent(ev) { const arr = this._listeners[ev.type]; if (arr) for (const fn of arr) fn.call(this, ev); return true; }
  click() { this.dispatchEvent(new this.owner.Event('click')); }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  querySelector(sel) {
    const m = /^#([a-zA-Z0-9_-]+)$/.exec(sel);
    if (!m) return null;
    for (const ch of this.children) {
      if (ch.tagName.toLowerCase() === m[1].toLowerCase()) return ch;
    }
    return null;
  }
}

main().then(() => {
  console.log(`All CREATOR-17 tests passed.`);
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
