/**
 * KomuniPH Creator Studio — MP3 Music Player (CREATOR-17).
 *
 * A compact, self-contained HTML5 <audio> player for the Creator Studio. It is
 * deliberately framework-free (like the rest of the app): pure playback logic
 * is exported so the test suite can pin it without a DOM, and a small
 * MusicPlayer class owns the real element lifecycle.
 *
 * Lifecycle guarantees (the thing a naive player gets wrong):
 *   - every listener is tracked and removed on destroy(), source change, or
 *     navigation away, so a closed player can never keep playing or leak;
 *   - loading a new source pauses + clears the old one first;
 *   - the media element is created, attached and torn down by the class only —
 *     nothing global is left behind.
 *
 * The source is always a server-issued `/uploads/creator-audio/...` URL from an
 * ownership-checked track; the player itself never trusts a client path.
 */

/** Clamp a number into [min, max]. */
export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Coerce anything to a finite non-negative number, else a fallback. */
export function toFinite(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Format seconds as m:ss (or h:mm:ss past an hour). Non-finite / negative
 * durations (a not-yet-loaded stream) render as a stable placeholder so the UI
 * never flashes "NaN:NaN".
 */
export function formatTime(seconds) {
  const total = Math.floor(toFinite(seconds, 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

/** Clamp a seek target into the media's real duration. */
export function clampSeek(target, duration) {
  const d = toFinite(duration, 0);
  return d > 0 ? clamp(target, 0, d) : 0;
}

/** Clamp a volume into the valid 0..1 range. */
export function clampVolume(value) {
  return clamp(toFinite(value, 0), 0, 1);
}

/**
 * The set of UI states a creator can see. Exactly one is active at a time so
 * the controls and the message can never disagree.
 */
export const PLAYER_STATE = {
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  PLAYING: 'playing',
  ERROR: 'error',
};

/** Human-readable status for each state, kept in one place for the tests. */
export const PLAYER_STATE_MESSAGE = {
  [PLAYER_STATE.IDLE]: 'No track loaded.',
  [PLAYER_STATE.LOADING]: 'Loading…',
  [PLAYER_STATE.READY]: 'Ready',
  [PLAYER_STATE.PLAYING]: 'Playing',
  [PLAYER_STATE.ERROR]: 'This track could not be played.',
};

/**
 * Map a media-element readiness to a player UI state. Kept pure so the suite can
 * pin it: an unresolved/NaN duration is LOADING, a resolvable one is READY.
 */
export function readinessState(readyState, hasDuration) {
  if (readyState >= 1 && hasDuration) return PLAYER_STATE.READY;
  return PLAYER_STATE.LOADING;
}

/**
 * The MP3 player for the Creator Studio.
 *
 * It owns exactly one <audio> element and one control surface. Every listener it
 * adds is recorded and removed by destroy(), so closing the modal, changing the
 * source, or navigating away can never leave a hidden element playing or leak a
 * handler. load() always tears the previous source down first.
 *
 * The class never decides where a source comes from — it is always handed a
 * server-issued URL (see creatorAudioApi). It cannot be pointed at a client
 * filesystem path or an arbitrary string with authority to play it.
 */
export class MusicPlayer {
  /**
   * @param {HTMLElement} container where the player UI is mounted
   * @param {{ audio?: () => HTMLAudioElement }} [inject] test seam for a fake element
   */
  constructor(container, inject = {}) {
    this.container = container;
    this.state = PLAYER_STATE.IDLE;
    this.destroyed = false;
    this._listeners = [];
    this._duration = 0;
    this._seeking = false;
    this._lastVolume = 1;
    this.title = '';
    this._createAudio(inject);
    this._build();
    this._applyState();
  }

  // ── element + listener bookkeeping ──────────────────────────────────────
  _createAudio(inject) {
    this.audio = typeof inject.audio === 'function'
      ? inject.audio()
      : new Audio();
    try { this.audio.preload = 'metadata'; } catch { /* older engines */ }
  }

  /** Add a listener and remember it so destroy() can remove every one. */
  _on(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this._listeners.push({ target, type, fn, options });
  }

  _build() {
    const root = document.createElement('div');
    root.className = 'studio-music-player';
    root.dataset.state = this.state;
    root.innerHTML = `
      <div class="studio-mp-head">
        <span class="studio-mp-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
        </span>
        <span class="studio-mp-title" id="studio-mp-title">No track loaded</span>
      </div>
      <div class="studio-mp-transport">
        <button type="button" class="studio-mp-btn studio-mp-play" aria-label="Play">&#9654;</button>
        <span class="studio-mp-time studio-mp-current">0:00</span>
        <input type="range" class="studio-mp-seek" min="0" max="1000" value="0" step="1"
               aria-label="Seek" disabled>
        <span class="studio-mp-time studio-mp-duration">0:00</span>
        <button type="button" class="studio-mp-btn studio-mp-mute" aria-label="Mute">&#128266;</button>
        <input type="range" class="studio-mp-volume" min="0" max="100" value="100" step="1"
               aria-label="Volume">
      </div>
      <p class="studio-mp-status" role="status" aria-live="polite"></p>`;
    this.container.appendChild(root);
    this.root = root;

    this.elTitle = root.querySelector('#studio-mp-title');
    this.elStatus = root.querySelector('.studio-mp-status');
    this.btnPlay = root.querySelector('.studio-mp-play');
    this.btnMute = root.querySelector('.studio-mp-mute');
    this.seek = root.querySelector('.studio-mp-seek');
    this.volume = root.querySelector('.studio-mp-volume');
    this.elCurrent = root.querySelector('.studio-mp-current');
    this.elDuration = root.querySelector('.studio-mp-duration');

    // Control events — all tracked.
    this._on(this.btnPlay, 'click', () => this.togglePlay());
    this._on(this.btnMute, 'click', () => this.toggleMute());
    this._on(this.seek, 'input', () => {
      this._seeking = true;
      this._renderCurrent(clampSeek(this._progressToTime(this.seek.value), this._duration));
    });
    this._on(this.seek, 'change', () => {
      this.seekTo(this._progressToTime(this.seek.value));
      this._seeking = false;
    });
    this._on(this.volume, 'input', () => {
      this.setVolume(clampVolume(Number(this.volume.value) / 100));
    });

    // Media events — the bridge from the real element to the UI state.
    this._on(this.audio, 'loadedmetadata', () => this._onMetadata());
    this._on(this.audio, 'durationchange', () => this._onMetadata());
    this._on(this.audio, 'timeupdate', () => this._onTime());
    this._on(this.audio, 'play', () => this._setState(PLAYER_STATE.PLAYING));
    this._on(this.audio, 'playing', () => this._setState(PLAYER_STATE.PLAYING));
    this._on(this.audio, 'pause', () => {
      if (this.state === PLAYER_STATE.PLAYING) this._setState(PLAYER_STATE.READY);
    });
    this._on(this.audio, 'ended', () => this._setState(PLAYER_STATE.READY));
    this._on(this.audio, 'error', () => this._fail('This track could not be played.'));
    this._on(this.audio, 'emptied', () => {
      if (this.state !== PLAYER_STATE.ERROR) this._setState(PLAYER_STATE.IDLE);
    });
  }

  // ── state machine ────────────────────────────────────────────────────────
  _setState(state) {
    if (this.destroyed) return;
    this.state = state;
    this._applyState();
  }

  _applyState() {
    if (!this.root) return;
    this.root.dataset.state = this.state;
    const message = PLAYER_STATE_MESSAGE[this.state] || '';
    if (this.elStatus) this.elStatus.textContent = message;
    const playable = this.state === PLAYER_STATE.READY || this.state === PLAYER_STATE.PLAYING;
    if (this.btnPlay) {
      this.btnPlay.disabled = !playable;
      this.btnPlay.innerHTML = this.state === PLAYER_STATE.PLAYING ? '&#10073;&#10073;' : '&#9654;';
      this.btnPlay.setAttribute('aria-label', this.state === PLAYER_STATE.PLAYING ? 'Pause' : 'Play');
    }
    if (this.seek) this.seek.disabled = !playable;
    if (this.btnMute) this.btnMute.disabled = !playable;
    if (this.volume) this.volume.disabled = !playable;
    this._renderDuration();
  }

  _fail(message) {
    this._setState(PLAYER_STATE.ERROR);
    if (this.elStatus) this.elStatus.textContent = message || PLAYER_STATE_MESSAGE[PLAYER_STATE.ERROR];
  }

  // ── source lifecycle ─────────────────────────────────────────────────────
  /**
   * Load a new source. Tears the previous one down first (pause, clear src,
   * reset UI), then arms the element. An empty/blank source is treated as a
   * missing source and reported as such, never half-loaded.
   * @param {string} src a server-issued URL
   * @param {string} [title]
   */
  load(src, title = '') {
    if (this.destroyed) return;
    // 1. Always stop and clear the previous source before arming a new one.
    try { this.audio.pause(); } catch { /* not started */ }
    try { this.audio.removeAttribute('src'); this.audio.load(); } catch { /* engine */ }
    this._duration = 0;
    this._renderDuration();
    this._renderCurrent(0);
    if (this.seek) this.seek.value = '0';
    this.title = title || '';
    if (this.elTitle) this.elTitle.textContent = this.title || 'Untitled track';

    if (!src || !String(src).trim()) {
      this._fail('No audio source available.');
      return;
    }
    this._setState(PLAYER_STATE.LOADING);
    this.audio.src = src;
    try { this.audio.load(); } catch { /* engine */ }
  }

  // ── transport ────────────────────────────────────────────────────────────
  togglePlay() {
    if (this.state === PLAYER_STATE.PLAYING) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    if (this.destroyed || this.state === PLAYER_STATE.ERROR) return;
    try { this.audio.play(); } catch { /* autoplay policy — surfaced by events */ }
  }

  pause() {
    try { this.audio.pause(); } catch { /* already stopped */ }
  }

  seekTo(seconds) {
    if (this.destroyed || this.state === PLAYER_STATE.ERROR) return;
    const target = clampSeek(seconds, this._duration);
    try { this.audio.currentTime = target; } catch { /* not seekable yet */ }
    this._renderCurrent(target);
  }

  setVolume(value) {
    const v = clampVolume(value);
    this.audio.volume = v;
    if (v > 0) { this._lastVolume = v; this.audio.muted = false; }
    this._renderVolume();
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    if (!this.audio.muted && (!this.audio.volume || this.audio.volume === 0)) {
      this.audio.volume = this._lastVolume || 1;
    }
    this._renderVolume();
  }

  // ── rendering helpers ─────────────────────────────────────────────────────
  _onMetadata() {
    const d = toFinite(this.audio.duration, 0);
    this._duration = d;
    this._renderDuration();
    if (this.state === PLAYER_STATE.LOADING || this.state === PLAYER_STATE.IDLE) {
      this._setState(PLAYER_STATE.READY);
    }
  }

  _onTime() {
    if (this._seeking) return;
    const t = toFinite(this.audio.currentTime, 0);
    this._renderCurrent(t);
  }

  _renderCurrent(seconds) {
    if (this.elCurrent) this.elCurrent.textContent = formatTime(seconds);
    if (this.seek && this._duration > 0 && !this._seeking) {
      this.seek.value = String(Math.round((seconds / this._duration) * 1000));
    }
  }

  _renderDuration() {
    if (this.elDuration) this.elDuration.textContent = this._duration > 0 ? formatTime(this._duration) : '0:00';
  }

  _renderVolume() {
    if (!this.volume) return;
    const shown = this.audio.muted ? 0 : Math.round(clampVolume(this.audio.volume) * 100);
    this.volume.value = String(shown);
    if (this.btnMute) {
      this.btnMute.innerHTML = this.audio.muted || shown === 0 ? '&#128263;' : '&#128266;';
      this.btnMute.setAttribute('aria-label', this.audio.muted ? 'Unmute' : 'Mute');
    }
  }

  _progressToTime(value) {
    const p = clamp(Number(value) || 0, 0, 1000) / 1000;
    return p * this._duration;
  }

  // ── teardown ────────────────────────────────────────────────────────────
  /**
   * Fully release the player: stop playback, detach every tracked listener,
   * clear the source and remove the UI. Safe to call more than once.
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { this.audio.pause(); } catch { /* already stopped */ }
    for (const { target, type, fn, options } of this._listeners) {
      try { target.removeEventListener(type, fn, options); } catch { /* detached */ }
    }
    this._listeners = [];
    try { this.audio.removeAttribute('src'); this.audio.load(); } catch { /* engine */ }
    if (this.root && this.root.parentNode) this.root.remove();
    this.audio = null;
    this.root = null;
  }
}

