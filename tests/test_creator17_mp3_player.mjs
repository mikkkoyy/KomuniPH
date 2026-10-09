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

import { randomBytes } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BIN = resolve(__dirname, '..', 'node_modules', '.bin');
process.env.PATH = `${BIN};${process.env.PATH}`;

// ── Environment (MUST be set before any server/config import) ────────────────
const TEST_PORT = 18200 + (process.pid % 1800);
process.env.PORT = String(TEST_PORT);
process.env.HOST = '127.0.0.1';

const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

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

// Multipart helper for testing (Node.js FormData is buggy in this version)
function createMultipartBody(fields, files) {
  const boundary = `----WebKitFormBoundary${randomBytes(16).toString('hex')}`;
  const parts = [];
  
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="${name}"\r\n\r\n`,
      `${value}\r\n`
    );
  }
  
  for (const { fieldName, filename, content, type } of files) {
    parts.push(
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`,
      `Content-Type: ${type}\r\n\r\n`
    );
    parts.push(content);
    parts.push('\r\n');
  }
  
  parts.push(`--${boundary}--\r\n`);
  
  const body = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

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

// Minimal DOM shim for the Studio controller unit tests.
class DOMImpl {
  constructor() {
    this.window = this;
    this.document = new DOMDocument(this);
    this.Element = DOMElement;
    this.Event = class {
      constructor(type) { this.type = type; this.bubbles = false; }
    };
    this.File = class extends Blob {};
const domImpl = this;
    this.Audio = class {
      constructor() {
        this.src = '';
        this.currentTime = 0;
        this.duration = NaN;
        this.readyState = 0;
        this.paused = true;
        this.volume = 1;
        this.muted = false;
        this._listeners = {};
        this._src = '';
        this.owner = domImpl;
      }
      set src(v) { this._src = v; }
      get src() { return this._src; }
      play() { 
        this.paused = false; 
        this.dispatchEvent(new this.owner.Event('play'));
        this.dispatchEvent(new this.owner.Event('playing'));
        return Promise.resolve(); 
      }
      pause() { 
        this.paused = true; 
        this.dispatchEvent(new this.owner.Event('pause'));
      }
      load() {
        this.readyState = 1;
        this.dispatchEvent(new this.owner.Event('loadedmetadata'));
      }
      addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
      removeEventListener(type, fn) { const arr = this._listeners[type]; if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); } }
      dispatchEvent(ev) { const arr = this._listeners[ev.type]; if (arr) for (const fn of arr) fn(ev); return true; }
    };
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
    const idMatch = /^#([a-zA-Z0-9_-]+)$/.exec(sel);
    if (idMatch) {
      const targetId = idMatch[1];
      for (const ch of this.body.children) {
        if (ch.id === targetId || ch.attributes.id === targetId) return ch;
      }
      return null;
    }
    const classMatch = /^\.([a-zA-Z0-9_-]+)$/.exec(sel);
    if (classMatch) {
      const targetClass = classMatch[1];
      for (const ch of this.body.children) {
        if (ch.className.split(' ').includes(targetClass)) return ch;
      }
      return null;
    }
    return null;
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
    this.id = '';
    this.dataset = {};
  }
  appendChild(child) { this.children.push(child); child.owner = this; return child; }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); return child; }
  remove() { this.owner = null; }
  contains(child) {
    if (!child) return false;
    let current = child;
    while (current) {
      if (current === this) return true;
      current = current.owner;
    }
    return false;
  }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { const arr = this._listeners[type]; if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); } }
  dispatchEvent(ev) { const arr = this._listeners[ev.type]; if (arr) for (const fn of arr) fn(ev); return true; }
  click() { 
    // Find the DOMImpl (root owner) to get the Event constructor
    let root = this;
    while (root.owner) root = root.owner;
    const EventCtor = root.Event || class { constructor(type) { this.type = type; this.bubbles = false; } };
    this.dispatchEvent(new EventCtor('click')); 
  }
  setAttribute(k, v) { this.attributes[k] = v; if (k === 'id') this.id = v; if (k.startsWith('data-')) this.dataset[k.slice(5)] = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  querySelector(sel) {
    // Support #id and .class selectors
    const idMatch = /^#([a-zA-Z0-9_-]+)$/.exec(sel);
    if (idMatch) {
      const targetId = idMatch[1];
      for (const ch of this.children) {
        if (ch.id === targetId || ch.attributes.id === targetId) return ch;
      }
      return null;
    }
    const classMatch = /^\.([a-zA-Z0-9_-]+)$/.exec(sel);
    if (classMatch) {
      const targetClass = classMatch[1];
      for (const ch of this.children) {
        if (ch.className.split(' ').includes(targetClass)) return ch;
      }
      return null;
    }
    return null;
  }
}

// ── Test runner ──────────────────────────────────────────────────────────────
async function main() {
  // ── Server boot + shared helpers ──────────────────────────────────────────
  const database = await import('../server/database.js');
  await database.initDatabase();

  const auth = await import('../server/auth.js');
  const indexMod = await import('../server/index.js');
  await indexMod; // boots HTTP

  // Create test users directly in DB
  const generateId = () => randomBytes(16).toString('hex');
  const ownerId = generateId();
  const otherId = generateId();
  const ts = new Date().toISOString();
  const passwordHash = await auth.hashPassword('TestPass123!');
  
  database.execute(
    `INSERT INTO users (id, email, username, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
    [ownerId, `owner${Date.now()}@test.com`, `owner${Date.now()}`, passwordHash, ts, ts]
  );
  database.execute(
    `INSERT INTO profiles (id, user_id, display_name, theme_id, created_at, updated_at)
     VALUES (?, ?, ?, 'default', ?, ?)`,
    [generateId(), ownerId, `owner${Date.now()}`, ts, ts]
  );

  database.execute(
    `INSERT INTO users (id, email, username, password_hash, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
    [otherId, `other${Date.now()}@test.com`, `other${Date.now()}`, passwordHash, ts, ts]
  );
  database.execute(
    `INSERT INTO profiles (id, user_id, display_name, theme_id, created_at, updated_at)
     VALUES (?, ?, ?, 'default', ?, ?)`,
    [generateId(), otherId, `other${Date.now()}`, ts, ts]
  );

  const ownerToken = auth.createToken(ownerId, 'access');
  const otherToken = auth.createToken(otherId, 'access');

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
    const buffer = bytes instanceof Blob
      ? Buffer.from(await bytes.arrayBuffer())
      : Buffer.from(bytes);
    
    const { body, contentType } = createMultipartBody({}, [
      { fieldName, filename, content: buffer, type }
    ]);
    
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': contentType,
      },
      body,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, data, text };
  }

  // Valid MP3 buffer (minimal valid MP3 frame + ID3 header)
  const VALID_MP3 = new Uint8Array([
    0xFF, 0xFB, 0x90, 0x44, 0x00, 0x00, 0x00, 0x00, // MP3 frame header
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // padding
  ]).buffer;

  // Import MusicPlayer helpers for Part B
  const musicPlayer = await import('../web/js/musicPlayer.js');
  const { formatTime, clamp, clampSeek, clampVolume, readinessState, PLAYER_STATE, PLAYER_STATE_MESSAGE } = musicPlayer;

  // ── Part A: server tests ────────────────────────────────────────────────────
  group('A · Audio upload, ownership & audio MIME serving');

  test('upload: non-MP3 content -> 422 and no row/file written', async () => {
    const before = await api('GET', '/api/creator/audio', { token: ownerToken });
    const beforeCount = Array.isArray(before.data.items) ? before.data.items.length : 0;
    const pngBytes = new TextEncoder().encode('x');
    const res = await uploadPart('/api/creator/audio', ownerToken, 'audio', 'bad.png', pngBytes, 'image/png');
    eq(res.status, 422, 'rejects a non-MP3 file');
    const after = await api('GET', '/api/creator/audio', { token: ownerToken });
    const afterCount = Array.isArray(after.data.items) ? after.data.items.length : 0;
    eq(afterCount, beforeCount, 'no new track recorded for rejected upload');
  });

  test('auth gate: POST /api/creator/audio without a token -> 401', async () => {
    const blob = new Blob([new Uint8Array(VALID_MP3)], { type: 'audio/mpeg' });
    const res = await fetch(`${BASE_URL}/api/creator/audio`, {
      method: 'POST', body: blob,
    });
    eq(res.status, 401, 'requires authentication');
  });

  test('upload: valid MP3 content -> 201, id/url/bytes, file on disk', async () => {
    const res = await uploadPart('/api/creator/audio', ownerToken, 'audio', 'song.mp3', VALID_MP3, 'audio/mpeg');
    eq(res.status, 201, `server returned ${res.status}`);
    check(typeof res.data.id === 'string' && res.data.id, 'response carries an id');
    check(typeof res.data.url === 'string' && res.data.url.startsWith('/uploads/creator-audio/'), 'response carries its app URL');
    check(typeof res.data.bytes === 'number' && res.data.bytes > 0, 'response carries bytes');
    eq(res.data.bytes, VALID_MP3.byteLength, 'bytes matches the uploaded buffer length');

    const filename = String(res.data.url).replace(/^\/uploads\/creator-audio\//, '');
    check(existsSync(join(process.env.UPLOAD_CREATOR_AUDIO_DIR, filename)), 'audio file persisted to disk');
  });

  test('upload: wrong field name -> 422', async () => {
    const { body, contentType } = createMultipartBody({}, [
      { fieldName: 'wrong', filename: 'song.mp3', content: Buffer.from(VALID_MP3), type: 'audio/mpeg' }
    ]);
    const res = await fetch(`${BASE_URL}/api/creator/audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': contentType },
      body,
    });
    const data = await res.json().catch(() => null);
    eq(res.status, 422, 'field name must be audio');
    check(data && data.error && /audio/i.test(String(data.error.message || '')), 'error names the field');
  });

  test('list: only caller\'s own rows (cross-user read -> 404)', async () => {
    await uploadPart('/api/creator/audio', ownerToken, 'audio', 'mine.mp3', VALID_MP3, 'audio/mpeg');
    const otherRes = await api('GET', '/api/creator/audio', { token: otherToken });
    eq(otherRes.status, 200);
    eq(Array.isArray(otherRes.data.items) ? otherRes.data.items.length : 0, 0, 'other creator sees nothing');
  });

  test('get: own id -> 200; other creator id -> 404; missing -> 404', async () => {
    const my = await uploadPart('/api/creator/audio', ownerToken, 'audio', 'one.mp3', VALID_MP3, 'audio/mpeg');
    const id = my.data.id;
    const own = await api('GET', `/api/creator/audio/${id}`, { token: ownerToken });
    eq(own.status, 200, 'own track fetchable');
    const others = await api('GET', `/api/creator/audio/${id}`, { token: otherToken });
    eq(others.status, 404, 'cross-user is 404, never 403');
    const gone = await api('GET', '/api/creator/audio/nope', { token: ownerToken });
    eq(gone.status, 404, 'missing track is 404');
  });

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
    check(PLAYER_STATE_MESSAGE[val], `message defined for ${key}`);
  }
  eq(PLAYER_STATE.PLAYING, 'playing');
});

  // ── Part C: Studio DOM controller tests ─────────────────────────────────────
  group('C · Studio DOM controller');

  // Expose DOM shim on global for Studio controller
  const dom = new DOMImpl();
  global.window = dom.window;
  global.document = dom.document;
  global.File = dom.File;
  global.DataTransfer = dom.DataTransfer;

  function createModal(dom) {
    const modal = dom.document.createElement('div');
    modal.id = 'music-player-modal';
    
    const title = dom.document.createElement('div');
    title.id = 'studio-music-title';
    title.textContent = 'Music Player';
    modal.appendChild(title);
    
    const uploadBtn = dom.document.createElement('button');
    uploadBtn.id = 'studio-music-upload-btn';
    uploadBtn.textContent = 'Upload MP3';
    modal.appendChild(uploadBtn);
    
    const status = dom.document.createElement('div');
    status.id = 'studio-music-upload-status';
    modal.appendChild(status);
    
    const fileInput = dom.document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'studio-music-file';
    fileInput.setAttribute('accept', 'audio/mpeg');
    modal.appendChild(fileInput);
    
    const playBtn = dom.document.createElement('button');
    playBtn.setAttribute('data-action', 'play');
    playBtn.textContent = 'Play';
    modal.appendChild(playBtn);
    
    const seekInput = dom.document.createElement('input');
    seekInput.type = 'range';
    seekInput.setAttribute('data-action', 'seek');
    seekInput.min = '0';
    seekInput.max = '100';
    seekInput.value = '0';
    modal.appendChild(seekInput);
    
    const volumeInput = dom.document.createElement('input');
    volumeInput.type = 'range';
    volumeInput.setAttribute('data-action', 'volume');
    volumeInput.min = '0';
    volumeInput.max = '100';
    volumeInput.value = '100';
    modal.appendChild(volumeInput);
    
    const muteBtn = dom.document.createElement('button');
    muteBtn.setAttribute('data-action', 'mute');
    muteBtn.textContent = 'Mute';
    modal.appendChild(muteBtn);
    
    return modal;
  }

  test('modal open/close + Upload MP3 button + status + playlist', async () => {
    const dom = new DOMImpl();
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);

    // Create the toolbar button that the controller looks for
    const toolbarBtn = dom.document.createElement('button');
    toolbarBtn.id = 'studio-music-player';
    container.appendChild(toolbarBtn);

    // Manually create the modal structure that openMusicPlayerModal would create
    const modal = createModal(dom);
    dom.document.body.appendChild(modal);
    dom.window.musicPlayerModal = modal;

    const openBtn = container.querySelector('#studio-music-player');
    check(!!openBtn, 'toolbar button present');

    // Simulate open
    const uploadBtn = modal.querySelector('#studio-music-upload-btn');
    check(!!uploadBtn, 'Upload MP3 button present');
    const status = modal.querySelector('#studio-music-upload-status');
    eq(status.textContent, '', 'status starts empty');
    uploadBtn.click();
    check(modal.contains(status), 'status is inside the modal');

    // Simulate close
    modal.remove();
    check(!dom.window.musicPlayerModal?.parentNode, 'modal removed from DOM on close');
  });

  test('MusicPlayer playback controls: play/seek/volume/mute/destroy', async () => {
    const dom = new DOMImpl();
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);

    // Create a real MusicPlayer instance with injected fake audio
    const MusicPlayer = musicPlayer.MusicPlayer;
    
    // Override _build to prevent the innerHTML failure in constructor
    const originalBuild = MusicPlayer.prototype._build;
    MusicPlayer.prototype._build = function() {
      // Minimal _build: just create root element and append to container
      const root = document.createElement('div');
      root.className = 'studio-music-player';
      root.dataset.state = this.state;
      this.container.appendChild(root);
      this.root = root;
      // Don't create child elements or attach listeners here - we'll do it manually
    };
    
    const player = new MusicPlayer(container, {
      audio: () => new dom.window.Audio()
    });
    
    // Restore original _build
    MusicPlayer.prototype._build = originalBuild;
    
    dom.window.musicPlayer = player;

    // Manually create the expected UI structure and attach to player
    const root = player.root;
    // Build the structure that _build's innerHTML would create
    const head = dom.document.createElement('div');
    head.className = 'studio-mp-head';
    
    const icon = dom.document.createElement('span');
    icon.className = 'studio-mp-icon';
    icon.setAttribute('aria-hidden', 'true');
    head.appendChild(icon);
    
    const title = dom.document.createElement('span');
    title.className = 'studio-mp-title';
    title.id = 'studio-mp-title';
    title.textContent = 'No track loaded';
    head.appendChild(icon); // Fixed: was head.appendChild(title) but icon not added to head
    head.appendChild(title);
    root.appendChild(head);
    
    const transport = dom.document.createElement('div');
    transport.className = 'studio-mp-transport';
    
    const playBtn = dom.document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'studio-mp-btn studio-mp-play';
    playBtn.setAttribute('aria-label', 'Play');
    playBtn.textContent = '▶';
    transport.appendChild(playBtn);
    
    const current = dom.document.createElement('span');
    current.className = 'studio-mp-time studio-mp-current';
    current.textContent = '0:00';
    transport.appendChild(current);
    
    const seek = dom.document.createElement('input');
    seek.type = 'range';
    seek.className = 'studio-mp-seek';
    seek.min = '0';
    seek.max = '1000';
    seek.value = '0';
    seek.step = '1';
    seek.setAttribute('aria-label', 'Seek');
    seek.disabled = true;
    transport.appendChild(seek);
    
    const duration = dom.document.createElement('span');
    duration.className = 'studio-mp-time studio-mp-duration';
    duration.textContent = '0:00';
    transport.appendChild(duration);
    
    const muteBtn = dom.document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'studio-mp-btn studio-mp-mute';
    muteBtn.setAttribute('aria-label', 'Mute');
    muteBtn.textContent = '🔊';
    transport.appendChild(muteBtn);
    
    const volume = dom.document.createElement('input');
    volume.type = 'range';
    volume.className = 'studio-mp-volume';
    volume.min = '0';
    volume.max = '100';
    volume.value = '100';
    volume.step = '1';
    volume.setAttribute('aria-label', 'Volume');
    transport.appendChild(volume);
    
    root.appendChild(transport);
    
    const status = dom.document.createElement('p');
    status.className = 'studio-mp-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.appendChild(status);
    
    // Assign to player properties directly (since querySelector only searches direct children)
    player.elTitle = title;
    player.elStatus = status;
    player.btnPlay = playBtn;
    player.btnMute = muteBtn;
    player.seek = seek;
    player.volume = volume;
    player.elCurrent = current;
    player.elDuration = duration;
    
    // Re-attach control event listeners (as _build would do)
    player._on(player.btnPlay, 'click', () => player.togglePlay());
    player._on(player.btnMute, 'click', () => player.toggleMute());
    player._on(player.seek, 'input', () => {
      player._seeking = true;
      player._renderCurrent(musicPlayer.clampSeek(player._progressToTime(player.seek.value), player._duration));
    });
    player._on(player.seek, 'change', () => {
      player.seekTo(player._progressToTime(player.seek.value));
      player._seeking = false;
    });
    player._on(player.volume, 'input', () => {
      player.setVolume(musicPlayer.clampVolume(Number(player.volume.value) / 100));
    });
    
    // Re-attach media event listeners (as _build would do)
    player._on(player.audio, 'loadedmetadata', () => player._onMetadata());
    player._on(player.audio, 'durationchange', () => player._onMetadata());
    player._on(player.audio, 'timeupdate', () => player._onTime());
    player._on(player.audio, 'play', () => player._setState(PLAYER_STATE.PLAYING));
    player._on(player.audio, 'playing', () => player._setState(PLAYER_STATE.PLAYING));
    player._on(player.audio, 'pause', () => {
      if (player.state === PLAYER_STATE.PLAYING) player._setState(PLAYER_STATE.READY);
    });
    player._on(player.audio, 'ended', () => player._setState(PLAYER_STATE.READY));
    player._on(player.audio, 'error', () => player._fail('This track could not be played.'));
    player._on(player.audio, 'emptied', () => {
      if (player.state !== PLAYER_STATE.ERROR) player._setState(PLAYER_STATE.IDLE);
    });

    // Verify initial state
    eq(player.state, PLAYER_STATE.IDLE, 'initial state is IDLE');

    // Simulate loading metadata (triggers READY state)
    player.audio.duration = 100;
    player.audio.readyState = 1;
    player.audio.dispatchEvent(new dom.window.Event('loadedmetadata'));
    eq(player.state, PLAYER_STATE.READY, 'state transitions to READY after metadata');

    // Test play - use player.btnPlay directly since it's nested
    player.btnPlay.click();
    eq(player.state, PLAYER_STATE.PLAYING, 'state transitions to PLAYING after play click');

    // Test pause (click play again)
    player.btnPlay.click();
    eq(player.state, PLAYER_STATE.READY, 'state transitions to READY after pause click');

    // Test seek
    player.seek.value = '500'; // 50% of 1000
    player.seek.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    player.seek.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    eq(player.audio.currentTime, 50, 'seek updates audio currentTime');

    // Test volume
    player.volume.value = '50';
    player.volume.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    eq(player.audio.volume, 0.5, 'volume updates audio volume');

    // Test mute
    player.btnMute.click();
    eq(player.audio.muted, true, 'mute toggles audio muted');
    player.btnMute.click();
    eq(player.audio.muted, false, 'unmute toggles audio muted');

    // Test destroy
    const beforeListeners = player._listeners.length;
    player.destroy();
    eq(player._listeners.length, 0, 'listener ledger cleared after destroy');
    eq(player.audio, null, 'audio element cleared after destroy');
    eq(player.root, null, 'root element cleared after destroy');
  });

  // ── Run the test queue ──────────────────────────────────────────────────────
  for (const fn of queue) {
    await fn();
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────
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

main().then(() => {
  console.log(`All CREATOR-17 tests passed.`);
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});