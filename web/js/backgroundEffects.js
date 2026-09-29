/**
 * CREATOR-12 — Profile Background Effect registry.
 *
 * A background EFFECT is a profile-wide visual layer that sits between the
 * Profile Background image and the profile content. It is a THIRD concept and is
 * deliberately kept separate from:
 *
 *   A. theme.backgroundImage            the static background picture
 *   B. theme.backgroundEffect            THIS module
 *   C. component.config.animation        CREATOR-11 per-component animation
 *
 * Every effect is rendered from a DECLARATIVE definition. There is no field
 * anywhere in this file — or anywhere an effect definition is stored — that can
 * carry creator JavaScript, CSS, HTML or keyframes. A stored effect is a small
 * object of bounded numbers and allowlisted strings, and this module is the only
 * thing that turns one into something a browser draws.
 *
 * The server owns the authoritative copy (server/creatorEffects.js) because the
 * server is what decides whether a design or a package is valid. This client
 * copy exists so the Studio can render previews and the public profile can
 * render the same effect with the same rules; the two are asserted identical in
 * tests rather than trusted to stay in sync.
 *
 * ── Engines ────────────────────────────────────────────────────────────────────
 * A small, closed set of rendering primitives. An effect picks one; it cannot
 * supply its own renderer.
 *
 *   particles   many small instances moved by the engine (snow, rain, ...)
 *   atmosphere  a few large soft translucent fields (smoke, fog, mist, clouds)
 *   lighting    timed full-surface flashes/tints (lightning, glow, flicker)
 *   overlay     a single tinted or textured wash over the whole surface
 *
 * ── Per-property bounds ────────────────────────────────────────────────────────
 * Every tunable is declared with a min and a max HERE, and the server enforces
 * exactly these numbers. A creator therefore cannot ask for a million particles
 * or a negative speed, and a hostile package cannot either.
 */

/** Rendering primitives an effect may select. */
export const EFFECT_ENGINES = new Set(['particles', 'atmosphere', 'lighting', 'overlay']);

/** Where an effect came from. */
export const EFFECT_SOURCES = new Set(['builtin', 'creator']);

/**
 * Hard ceilings, enforced by the renderer regardless of what an effect asks for.
 * These are the last line of defence for the browser: a definition that passed
 * validation is still clamped here, so a bug in validation can never turn into a
 * frozen tab.
 */
export const EFFECT_LIMITS = {
  maxParticles: 300,
  maxAtmosphereLayers: 6,
  minFrameIntervalMs: 1000 / 60,
  // A single profile runs at most one background effect. There is no stacking.
  maxActiveEffects: 1,
};

/** Directions a particle effect may travel in. */
export const PARTICLE_DIRECTIONS = new Set(['down', 'up', 'left', 'right']);

/**
 * Per-engine config schema. Keys are the only settings an effect may carry; the
 * `min`/`max` are the numbers the server validates against and the renderer
 * clamps to. A `type` of 'bool' takes true/false; 'enum' takes one of `values`.
 */
export const ENGINE_SCHEMAS = {
  particles: {
    count: { type: 'number', min: 1, max: EFFECT_LIMITS.maxParticles, default: 60, label: 'Amount' },
    speed: { type: 'number', min: 0, max: 20, default: 1, label: 'Speed' },
    size: { type: 'number', min: 1, max: 200, default: 12, label: 'Size' },
    opacity: { type: 'number', min: 0, max: 1, default: 0.8, label: 'Opacity' },
    direction: { type: 'enum', values: [...PARTICLE_DIRECTIONS], default: 'down', label: 'Direction' },
    drift: { type: 'number', min: -100, max: 100, default: 20, label: 'Drift' },
    rotation: { type: 'bool', default: true, label: 'Rotate' },
    rotationSpeed: { type: 'number', min: 0, max: 360, default: 30, label: 'Rotation speed' },
    spread: { type: 'number', min: 0, max: 100, default: 0, label: 'Spread' },
  },
  atmosphere: {
    layers: { type: 'number', min: 1, max: EFFECT_LIMITS.maxAtmosphereLayers, default: 3, label: 'Layers' },
    speed: { type: 'number', min: 0, max: 4, default: 0.6, label: 'Speed' },
    opacity: { type: 'number', min: 0, max: 1, default: 0.4, label: 'Opacity' },
    blur: { type: 'number', min: 0, max: 120, default: 40, label: 'Blur' },
    scale: { type: 'number', min: 10, max: 200, default: 100, label: 'Scale' },
  },
  lighting: {
    frequency: { type: 'number', min: 1, max: 60, default: 12, label: 'Frequency' },
    intensity: { type: 'number', min: 0, max: 1, default: 0.7, label: 'Intensity' },
    duration: { type: 'number', min: 40, max: 1200, default: 180, label: 'Flash duration (ms)' },
    color: { type: 'color', default: '#ffffff', label: 'Colour' },
  },
  overlay: {
    opacity: { type: 'number', min: 0, max: 1, default: 0.35, label: 'Opacity' },
    color: { type: 'color', default: '#ffffff', label: 'Colour' },
  },
};

/**
 * The built-in effects. Platform-controlled, so these are trusted by definition —
 * but they still go through the same validation and the same renderer, so a
 * built-in and a valid creator effect behave identically.
 */
export const BUILTIN_EFFECTS = {
  'builtin.snow': {
    id: 'builtin.snow', name: 'Snow', category: 'weather', version: 1, engine: 'particles',
    defaultConfig: { count: 90, speed: 1.4, size: 10, opacity: 0.9, direction: 'down', drift: 25, rotation: false, rotationSpeed: 20, spread: 0 },
    // Reduced motion: hold a still snowfall rather than animating it. The effect
    // is still visible, so the profile does not look broken, but nothing moves.
    reducedMotion: 'static',
  },
  'builtin.rain': {
    id: 'builtin.rain', name: 'Rain', category: 'weather', version: 1, engine: 'particles',
    defaultConfig: { count: 140, speed: 8, size: 6, opacity: 0.5, direction: 'down', drift: 0, rotation: false, rotationSpeed: 0, spread: 0 },
    reducedMotion: 'static',
  },
  'builtin.leaves': {
    id: 'builtin.leaves', name: 'Leaves', category: 'nature', version: 1, engine: 'particles',
    defaultConfig: { count: 34, speed: 1.6, size: 18, opacity: 0.9, direction: 'down', drift: 60, rotation: true, rotationSpeed: 90, spread: 0 },
    reducedMotion: 'static',
  },
  'builtin.petals': {
    id: 'builtin.petals', name: 'Petals', category: 'nature', version: 1, engine: 'particles',
    defaultConfig: { count: 40, speed: 1.2, size: 14, opacity: 0.85, direction: 'down', drift: 45, rotation: true, rotationSpeed: 60, spread: 0 },
    reducedMotion: 'static',
  },
  'builtin.sparkles': {
    id: 'builtin.sparkles', name: 'Sparkles', category: 'sparkle', version: 1, engine: 'particles',
    defaultConfig: { count: 55, speed: 0.7, size: 9, opacity: 0.95, direction: 'down', drift: 30, rotation: true, rotationSpeed: 45, spread: 0 },
    reducedMotion: 'static',
  },
  'builtin.stars': {
    id: 'builtin.stars', name: 'Stars', category: 'night', version: 1, engine: 'particles',
    defaultConfig: { count: 70, speed: 0.25, size: 5, opacity: 0.85, direction: 'up', drift: 8, rotation: false, rotationSpeed: 0, spread: 0 },
    reducedMotion: 'static',
  },
  'builtin.smoke': {
    id: 'builtin.smoke', name: 'Smoke', category: 'atmosphere', version: 1, engine: 'atmosphere',
    defaultConfig: { layers: 4, speed: 0.5, opacity: 0.3, blur: 60, scale: 120 },
    reducedMotion: 'static',
  },
  'builtin.lightning': {
    id: 'builtin.lightning', name: 'Lightning', category: 'lighting', version: 1, engine: 'lighting',
    defaultConfig: { frequency: 10, intensity: 0.6, duration: 160, color: '#e8f2ff' },
    // Reduced motion: a single still tint rather than repeated flashes. Repeated
    // flashing is exactly what a motion-sensitive visitor is asking us not to do.
    reducedMotion: 'static',
  },
  'builtin.fire': {
    id: 'builtin.fire', name: 'Fire', category: 'particles', version: 1, engine: 'particles',
    defaultConfig: { count: 44, speed: 1.8, size: 16, opacity: 0.8, direction: 'up', drift: 18, rotation: false, rotationSpeed: 0, spread: 0 },
    // Warm tint is a static property of the fire engine's palette, not a config
    // value, so it cannot be turned into arbitrary CSS.
    palette: 'fire',
    reducedMotion: 'static',
  },
};

export const BUILTIN_EFFECT_IDS = Object.keys(BUILTIN_EFFECTS);

/** The placeholder an effect list shows when an effect is unavailable. */
export const NO_EFFECT = 'none';

/**
 * Clamp a stored config against its engine's schema.
 *
 * Used by the renderer as a LAST line of defence. Unknown keys are dropped, and
 * every number is clamped into range, so even a hand-edited or maliciously stored
 * definition cannot push the renderer out of bounds.
 */
export function clampEffectConfig(engine, config = {}) {
  const schema = ENGINE_SCHEMAS[engine];
  if (!schema || !config || typeof config !== 'object') return {};
  const out = {};
  for (const [key, spec] of Object.entries(schema)) {
    const raw = config[key];
    if (raw === undefined || raw === null) {
      out[key] = spec.default;
      continue;
    }
    if (spec.type === 'number') {
      const n = Number(raw);
      out[key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.default;
    } else if (spec.type === 'bool') {
      out[key] = raw === true || raw === 'true';
    } else if (spec.type === 'enum') {
      out[key] = spec.values.includes(raw) ? raw : spec.default;
    } else if (spec.type === 'color') {
      out[key] = /^#[0-9a-fA-F]{3,8}$/.test(String(raw)) ? String(raw) : spec.default;
    }
  }
  return out;
}

/** The full, safe config an effect will actually render with. */
export function resolveEffectConfig(effect, overrides) {
  const engine = effect && effect.engine;
  const base = (effect && effect.defaultConfig) || {};
  return clampEffectConfig(engine, { ...base, ...(overrides || {}) });
}
