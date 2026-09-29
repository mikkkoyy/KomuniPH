/**
 * KomuniPH Lite - Profile Design Engine (CREATOR-01A)
 *
 * Foundation for user-authored profile layouts. A design is a controlled,
 * versioned snapshot: every component must be a registered type whose data
 * passes strict validation, and the server always derives ownership from the
 * authenticated user (user.sub) — never from the client.
 *
 * CREATOR-01A stored and validated the model and served the published design
 * alongside public/own profiles. CREATOR-01B added the visual Creator Studio
 * editor plus four user-content component types (text / image / card /
 * sticker) with strict per-type config, per-component style and rotation.
 */

import { queryOne, queryAll, execute, transaction } from './database.js';
import { jsonResponse, errorResponse, parseBody, generateId, now } from './utils.js';
import { validateThemeConfig } from './profile.js';

/**
 * Controlled component types renderable on a profile. Each maps to an existing
 * KomuniPH profile section; content stays server-rendered and escaped, so the
 * design can only reposition/resize/visibility the section, never inject code.
 * CREATOR-01B added the four user-content types below; those carry a strict
 * per-type config and are rendered by the client renderer (never server HTML).
 */
export const DESIGN_COMPONENT_TYPES = new Set([
  'profile_photo',
  'name',
  'alias',
  'bio',
  'personal_info',
  'gallery',
  'testimonials',
  'communities',
  'text',
  'image',
  'card',
  'sticker',
  'profile_guide',
  'profile_guide_card',
]);

/**
 * CREATOR-08: the server-known guide patterns for a `profile_guide` component.
 *
 * A guide is a STUDIO editing aid, but once inserted it is an ordinary design
 * object that is validated, stored and editable. Its only configuration is a
 * pattern id drawn from this allowlist, so a stored design can select a
 * built-in layout and nothing more — never markup, CSS, script, or an
 * arbitrary string. The guide is never rendered on the public profile: the
 * client profile renderer has no selector for this type and skips it.
 */
export const GUIDE_PATTERNS = new Set(['default', 'minimal', 'classic']);
export const DEFAULT_GUIDE_PATTERN = 'default';

/**
 * CREATOR-09: the real profile sections a `profile_guide_card` may stand in for.
 * These are exactly the controlled sections the public profile renders, so a
 * guide card can label a placement without ever carrying profile data. A stored
 * card selects one of these ids and nothing else — no markup, CSS, script, text
 * content or user data.
 *
 * CREATOR-10: the registry now mirrors the REAL public profile structure
 * (web/js/profile.js → renderProfilePage) — a main column and a sidebar of
 * independent modules. Photo Gallery is a SIDEBAR module, and the sidebar
 * features each have their own section id.
 */
export const GUIDE_SECTIONS = new Set([
  // Main profile column
  'profile_photo',
  'name',
  'alias',
  'bio',
  'personal_info',
  'testimonials',
  // Sidebar — one independent module each
  'friend_space',
  'gallery',
  'video_box',
  'music',
  'scraps',
  'communities',
]);

/**
 * Recognized-but-unbuilt components. They are rejected today so a design can
 * never claim a layout the platform cannot render yet.
 */
export const FUTURE_COMPONENT_TYPES = new Set([
  'video', 'music', 'button',
  'visitor_counter', 'who_visited', 'decoration',
]);

// ── Validation constants ────────────────────────────────────────────────────
const MAX_COMPONENTS = 64;
const MAX_LAYOUT_BYTES = 512 * 1024;
const COMPONENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// CREATOR-02: exported for reuse by creatorAssets.js validation.
export const DANGEROUS_CONFIG_RE = /<\s*(script|iframe|object|embed|style)\b/i;

const POSITION_MIN = -10000;
const POSITION_MAX = 10000;
const SIZE_MIN = 8;
const SIZE_MAX = 4080;
const Z_INDEX_MAX = 10000;
const CANVAS_WIDTH_MIN = 320;
const CANVAS_WIDTH_MAX = 1920;
const CANVAS_MIN_HEIGHT_MIN = 480;
const CANVAS_MIN_HEIGHT_MAX = 10000;

// ── CREATOR-01B per-component style & rotation limits ────────────────────────
const ROTATION_MIN = 0;
const ROTATION_MAX = 360;

// An empty string means "inherit the platform default" for that property.
// CREATOR-02: exported for reuse by creatorAssets.js validation.
export const isCssColor = value => value === '' || /^#[0-9a-fA-F]{3,8}$/.test(value);

const STYLE_FIELDS = new Set([
  'background', 'textColor', 'borderColor', 'borderWidth', 'borderRadius',
  'opacity', 'shadowEnabled', 'shadowOffset', 'shadowBlur', 'shadowColor',
]);
const BORDER_WIDTH_MAX = 100;
const BORDER_RADIUS_MAX = 500;
const SHADOW_OFFSET_MAX = 100;
const SHADOW_BLUR_MAX = 200;

// ── CREATOR-01B per-type content config limits ───────────────────────────────
const TEXT_MAX = 2000;
const HEADING_MAX = 200;
const ALT_MAX = 200;
const TEXT_ALIGNS = new Set(['left', 'center', 'right']);
// CREATOR-02: exported for reuse by creatorAssets.js validation.
export const IMAGE_FITS = new Set(['cover', 'contain', 'fill']);
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 200;
const FONT_WEIGHT_MIN = 100;
const FONT_WEIGHT_MAX = 900;
const LINE_HEIGHT_MIN = 0.5;
const LINE_HEIGHT_MAX = 3;

// ── CREATOR-11: Fonts ─────────────────────────────────────────────────────────
//
// A design stores a FONT ID, never a CSS font-family string. A raw string is a
// CSS-injection surface (`Georgia; background: url(...)`, or a quote-breaking
// payload), and letting one reach `style.fontFamily` would defeat every other
// validation in this file. Each id maps to an application-owned CSS stack
// declared once, in web/js/profileDesign.js, and reused by BOTH the Creator
// Studio preview and the public renderer so a saved design looks the same
// everywhere.
//
// The set is deliberately limited to fonts that are present on the overwhelming
// majority of desktop and mobile browsers with no webfont download: the classic
// web-safe faces, plus the CSS generic families. Generic families are the
// important part for correctness — they are how a design stays legible on a
// device that lacks a named face, which is the only kind of "fallback" that is
// honest rather than a silent substitution.
export const FONT_FAMILIES = new Map([
  ['system-ui', { label: 'System UI', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }],
  ['sans-serif', { label: 'Sans Serif', stack: 'Arial, Helvetica, "Liberation Sans", sans-serif' }],
  ['serif', { label: 'Serif', stack: 'Georgia, "Times New Roman", "Liberation Serif", serif' }],
  ['monospace', { label: 'Monospace', stack: '"Courier New", Courier, "Liberation Mono", monospace' }],
  ['arial', { label: 'Arial', stack: 'Arial, Helvetica, "Liberation Sans", sans-serif' }],
  ['helvetica', { label: 'Helvetica', stack: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif' }],
  ['verdana', { label: 'Verdana', stack: 'Verdana, Geneva, "DejaVu Sans", sans-serif' }],
  ['tahoma', { label: 'Tahoma', stack: 'Tahoma, Geneva, Verdana, "DejaVu Sans", sans-serif' }],
  ['trebuchet-ms', { label: 'Trebuchet MS', stack: '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", sans-serif' }],
  ['georgia', { label: 'Georgia', stack: 'Georgia, "Times New Roman", "Liberation Serif", serif' }],
  ['times-new-roman', { label: 'Times New Roman', stack: '"Times New Roman", Times, "Liberation Serif", serif' }],
  ['courier-new', { label: 'Courier New', stack: '"Courier New", Courier, "Liberation Mono", monospace' }],
  ['impact', { label: 'Impact', stack: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' }],
  ['comic-sans-ms', { label: 'Comic Sans MS', stack: '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive' }],
]);
export const FONT_FAMILY_IDS = [...FONT_FAMILIES.keys()];
/** The font used when a text component has no `fontFamily` (backward compatible). */
export const DEFAULT_FONT_FAMILY = 'system-ui';

// Underline is a BOOLEAN, never a CSS value, so there is nothing to inject.
export const FONT_STYLES = new Set(['normal', 'italic']);
export const DEFAULT_FONT_STYLE = 'normal';

// ── CREATOR-11: Animation ────────────────────────────────────────────────────
//
// Animation is a real, validated design property — not a CSS class the Studio
// invents, and never a user-supplied `animation` shorthand. The stored model is
// five explicit fields, each an allowlist entry or a bounded number, and each is
// mapped to an application-owned @keyframes rule at render time. Nothing a user
// types ever reaches `style.animation`.
export const ANIMATION_NAMES = new Set([
  'none', 'fade', 'fade-up', 'fade-down', 'fade-left', 'fade-right',
  'zoom-in', 'zoom-out', 'bounce', 'pulse', 'float', 'shake', 'swing',
]);
export const ANIMATION_TIMINGS = new Set([
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
]);
export const ANIMATION_DURATION_MIN = 0.1;
export const ANIMATION_DURATION_MAX = 20;
export const ANIMATION_DELAY_MIN = 0;
export const ANIMATION_DELAY_MAX = 60;
/** Finite repeat counts offered in the UI; a design may store any integer in [1, 1000]. */
export const ANIMATION_ITERATION_MIN = 1;
export const ANIMATION_ITERATION_MAX = 1000;
export const ANIMATION_ITERATION_CHOICES = ['once', '2', '3', '5', 'infinite'];
export const DEFAULT_ANIMATION = Object.freeze({
  name: 'none', duration: 2, delay: 0, iteration: 1, timing: 'ease-in-out',
});
const ANIMATION_FIELDS = new Set(['name', 'duration', 'delay', 'iteration', 'timing']);

/** How deep a component may be nested. Card → Image/Sticker is the only shape. */
export const MAX_NEST_DEPTH = 1;
/** Component types allowed to sit INSIDE a card. */
export const CARD_CHILD_TYPES = new Set(['image', 'sticker']);
/** Component types allowed to be a parent (a container). */
export const CARD_PARENT_TYPES = new Set(['card']);

// Content types accept only http(s) image URLs — never data:, javascript: or
// any scheme that could smuggle script or bypass the render-time img element.
// CREATOR-02: exported for reuse by creatorAssets.js validation.
export const HTTP_URL_RE = /^https?:\/\/[^\s'"<>]+$/i;
/**
 * CREATOR-06: image URL rule for component/asset/listing image fields.
 * Accepts http(s) URLs plus same-origin application uploads (/uploads/...,
 * e.g. Creator Studio uploads). Protocol-relative, javascript:, data: and
 * other schemes are still rejected.
 */
export const APP_IMAGE_URL_RE = /^(?:https?:\/\/[^\s'"<>]+|\/uploads\/[^\s'"<>]+)$/i;

// CREATOR-11: `animation` is available on every user-created content type, and
// `mask` controls whether a Card clips its children. `fontFamily`/`fontStyle`
// are text-only. There is deliberately no field that accepts a raw CSS value.
const CONTENT_TYPE_CONFIG_FIELDS = {
  text: new Set(['text', 'fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'textAlign', 'lineHeight', 'textColor', 'animation']),
  image: new Set(['imageUrl', 'alt', 'fit', 'backgroundColor', 'animation']),
  sticker: new Set(['imageUrl', 'alt', 'fit', 'backgroundColor', 'animation']),
  card: new Set(['heading', 'body', 'headingColor', 'textAlign', 'textColor', 'mask', 'animation']),
};

// CREATOR-02: exported for reuse by creatorAssets.js validation.
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function jsonSafeValue(value, depth = 0) {
  if (value === null) return true;
  if (depth > 12) return false;
  const type = typeof value;
  if (type === 'string') return !DANGEROUS_CONFIG_RE.test(value);
  if (type === 'number') return Number.isFinite(value);
  if (type === 'boolean') return true;
  if (Array.isArray(value)) {
    if (value.length > 256) return false;
    return value.every(item => jsonSafeValue(item, depth + 1));
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length > 32) return false;
    return Object.entries(value).every(([key, item]) =>
      typeof key === 'string' && key.length <= 64 && jsonSafeValue(item, depth + 1));
  }
  return false; // functions, symbols, etc.
}

/**
 * CREATOR-01B: rotation + per-component style (background / typography color /
 * border / radius / opacity / shadow), all optional with safe defaults.
 */
function validateComponentRotateStyle(component, errors) {
  const { id, rotation, style } = component;

  if (rotation !== undefined && (!isFiniteNumber(rotation) || rotation < ROTATION_MIN || rotation > ROTATION_MAX)) {
    errors.push(`Component "${id}" rotation must be a number between ${ROTATION_MIN} and ${ROTATION_MAX}`);
  }

  if (style === null || style === undefined) return;
  if (!isPlainObject(style)) {
    errors.push(`Component "${id}" style must be an object or null`);
    return;
  }

  for (const key of Object.keys(style)) {
    if (!STYLE_FIELDS.has(key)) errors.push(`Component "${id}" style has unknown field: ${key}`);
  }

  if (style.background !== undefined && !isCssColor(style.background)) errors.push(`Component "${id}" style.background must be a hex color or empty`);
  if (style.textColor !== undefined && !isCssColor(style.textColor)) errors.push(`Component "${id}" style.textColor must be a hex color or empty`);
  if (style.borderColor !== undefined && !isCssColor(style.borderColor)) errors.push(`Component "${id}" style.borderColor must be a hex color or empty`);
  if (style.shadowColor !== undefined && !isCssColor(style.shadowColor)) errors.push(`Component "${id}" style.shadowColor must be a hex color or empty`);

  if (style.borderWidth !== undefined && (!isFiniteNumber(style.borderWidth) || style.borderWidth < 0 || style.borderWidth > BORDER_WIDTH_MAX)) {
    errors.push(`Component "${id}" style.borderWidth must be a number between 0 and ${BORDER_WIDTH_MAX}`);
  }
  if (style.borderRadius !== undefined && (!isFiniteNumber(style.borderRadius) || style.borderRadius < 0 || style.borderRadius > BORDER_RADIUS_MAX)) {
    errors.push(`Component "${id}" style.borderRadius must be a number between 0 and ${BORDER_RADIUS_MAX}`);
  }
  if (style.opacity !== undefined && (!isFiniteNumber(style.opacity) || style.opacity < 0 || style.opacity > 1)) {
    errors.push(`Component "${id}" style.opacity must be a number between 0 and 1`);
  }
  if (style.shadowOffset !== undefined && (!isFiniteNumber(style.shadowOffset) || style.shadowOffset < -SHADOW_OFFSET_MAX || style.shadowOffset > SHADOW_OFFSET_MAX)) {
    errors.push(`Component "${id}" style.shadowOffset must be a number between ${-SHADOW_OFFSET_MAX} and ${SHADOW_OFFSET_MAX}`);
  }
  if (style.shadowBlur !== undefined && (!isFiniteNumber(style.shadowBlur) || style.shadowBlur < 0 || style.shadowBlur > SHADOW_BLUR_MAX)) {
    errors.push(`Component "${id}" style.shadowBlur must be a number between 0 and ${SHADOW_BLUR_MAX}`);
  }
  if (style.shadowEnabled !== undefined && typeof style.shadowEnabled !== 'boolean') {
    errors.push(`Component "${id}" style.shadowEnabled must be a boolean`);
  }
}

/**
 * CREATOR-01B: strict per-type config for text / image / card / sticker.
 * The controlled sections keep a freeish (but json-safe) config that the
 * renderer ignores; content types get an exact field contract so stored
 * payloads always map to what the renderer can display.
 */
function validateContentConfig(component, errors) {
  const { id, type, config } = component;
  // CREATOR-08: the guide gets its own strict contract (a single allowlisted
  // pattern id) and must be checked BEFORE the content-type early return below.
  if (type === 'profile_guide') {
    if (config === null || config === undefined) {
      errors.push(`Component "${id}" is a profile_guide and requires a config object`);
      return;
    }
    if (!isPlainObject(config)) return; // shape errors already reported
    for (const key of Object.keys(config)) {
      if (key !== 'pattern') errors.push(`Component "${id}" config has unknown field: ${key}`);
    }
    const pattern = config.pattern;
    if (typeof pattern !== 'string' || !GUIDE_PATTERNS.has(pattern)) {
      errors.push(`Component "${id}" config.pattern must be one of: ${[...GUIDE_PATTERNS].join(', ')}`);
    }
    return;
  }

  // CREATOR-09: a guide card carries exactly one allowlisted section id. It is a
  // wireframe, not content, so it can express no text, no URL and no markup.
  if (type === 'profile_guide_card') {
    if (config === null || config === undefined) {
      errors.push(`Component "${id}" is a profile_guide_card and requires a config object`);
      return;
    }
    if (!isPlainObject(config)) return; // shape errors already reported
    for (const key of Object.keys(config)) {
      if (key !== 'section') errors.push(`Component "${id}" config has unknown field: ${key}`);
    }
    const section = config.section;
    if (typeof section !== 'string' || !GUIDE_SECTIONS.has(section)) {
      errors.push(`Component "${id}" config.section must be one of: ${[...GUIDE_SECTIONS].join(', ')}`);
    }
    return;
  }

  // CREATOR-11: controlled profile sections keep their freeish (json-safe)
  // config, but they are NOT animatable in this milestone and the renderer never
  // reads an animation for them. Rejecting it here — BEFORE the content-type
  // contract below, which returns early for controlled types — keeps the stored
  // model honest: a design must not be able to carry an animation that would
  // silently never play.
  if (!CONTENT_TYPE_CONFIG_FIELDS[type]
    && isPlainObject(config)
    && Object.prototype.hasOwnProperty.call(config, 'animation')) {
    errors.push(`Component "${id}" is a ${type} and cannot carry an animation`);
  }

  if (type !== 'text' && type !== 'image' && type !== 'card' && type !== 'sticker') return;

  if (config === null || config === undefined) {
    errors.push(`Component "${id}" is a ${type} and requires a config object`);
    return;
  }
  if (!isPlainObject(config)) return; // shape errors already reported

  const allowed = CONTENT_TYPE_CONFIG_FIELDS[type];
  for (const key of Object.keys(config)) {
    if (!allowed.has(key)) errors.push(`Component "${id}" config has unknown field: ${key}`);
  }

  if (type === 'text') {
    const text = config.text;
    if (typeof text !== 'string' || !text.trim() || text.trim().length > TEXT_MAX) {
      errors.push(`Component "${id}" config.text must be a non-empty string of at most ${TEXT_MAX} characters`);
    } else if (config.text !== text.trim()) {
      errors.push(`Component "${id}" config.text must not have leading/trailing whitespace`);
    }
    if (config.fontSize !== undefined && (!isFiniteNumber(config.fontSize) || config.fontSize < FONT_SIZE_MIN || config.fontSize > FONT_SIZE_MAX)) {
      errors.push(`Component "${id}" config.fontSize must be a number between ${FONT_SIZE_MIN} and ${FONT_SIZE_MAX}`);
    }
    if (config.fontWeight !== undefined && (!Number.isInteger(config.fontWeight) || config.fontWeight < FONT_WEIGHT_MIN || config.fontWeight > FONT_WEIGHT_MAX)) {
      errors.push(`Component "${id}" config.fontWeight must be an integer between ${FONT_WEIGHT_MIN} and ${FONT_WEIGHT_MAX}`);
    }
    if (config.textAlign !== undefined && !TEXT_ALIGNS.has(config.textAlign)) {
      errors.push(`Component "${id}" config.textAlign must be one of: ${[...TEXT_ALIGNS].join(', ')}`);
    }
    if (config.lineHeight !== undefined && (!isFiniteNumber(config.lineHeight) || config.lineHeight < LINE_HEIGHT_MIN || config.lineHeight > LINE_HEIGHT_MAX)) {
      errors.push(`Component "${id}" config.lineHeight must be a number between ${LINE_HEIGHT_MIN} and ${LINE_HEIGHT_MAX}`);
    }
    if (config.textColor !== undefined && !isCssColor(config.textColor)) {
      errors.push(`Component "${id}" config.textColor must be a hex color or empty`);
    }
    // CREATOR-11: fonts are stored as an id from a fixed registry, so a design can
    // never carry a CSS font-family string (an injection surface) or a name the
    // renderer does not know how to map.
    if (config.fontFamily !== undefined && config.fontFamily !== null
      && !FONT_FAMILIES.has(config.fontFamily)) {
      errors.push(`Component "${id}" config.fontFamily must be one of: ${FONT_FAMILY_IDS.join(', ')}`);
    }
    if (config.fontStyle !== undefined && config.fontStyle !== null
      && !FONT_STYLES.has(config.fontStyle)) {
      errors.push(`Component "${id}" config.fontStyle must be one of: ${[...FONT_STYLES].join(', ')}`);
    }
  }

  // CREATOR-11: animation is validated identically for every content type.
  if (config.animation !== undefined) {
    if (config.animation === null) {
      // Explicit "no animation" is a valid, back-compatible value.
    } else if (!isPlainObject(config.animation)) {
      errors.push(`Component "${id}" config.animation must be an object or null`);
    } else {
      const anim = config.animation;
      for (const key of Object.keys(anim)) {
        if (!ANIMATION_FIELDS.has(key)) errors.push(`Component "${id}" config.animation has unknown field: ${key}`);
      }
      if (anim.name !== undefined && !ANIMATION_NAMES.has(anim.name)) {
        errors.push(`Component "${id}" config.animation.name must be one of: ${[...ANIMATION_NAMES].join(', ')}`);
      }
      if (anim.timing !== undefined && !ANIMATION_TIMINGS.has(anim.timing)) {
        errors.push(`Component "${id}" config.animation.timing must be one of: ${[...ANIMATION_TIMINGS].join(', ')}`);
      }
      if (anim.duration !== undefined
        && (!isFiniteNumber(anim.duration) || anim.duration < ANIMATION_DURATION_MIN || anim.duration > ANIMATION_DURATION_MAX)) {
        errors.push(`Component "${id}" config.animation.duration must be a number between ${ANIMATION_DURATION_MIN} and ${ANIMATION_DURATION_MAX}`);
      }
      if (anim.delay !== undefined
        && (!isFiniteNumber(anim.delay) || anim.delay < ANIMATION_DELAY_MIN || anim.delay > ANIMATION_DELAY_MAX)) {
        errors.push(`Component "${id}" config.animation.delay must be a number between ${ANIMATION_DELAY_MIN} and ${ANIMATION_DELAY_MAX}`);
      }
      if (anim.iteration !== undefined && anim.iteration !== 'infinite'
        && (!Number.isInteger(anim.iteration) || anim.iteration < ANIMATION_ITERATION_MIN || anim.iteration > ANIMATION_ITERATION_MAX)) {
        errors.push(`Component "${id}" config.animation.iteration must be an integer between ${ANIMATION_ITERATION_MIN} and ${ANIMATION_ITERATION_MAX}, or "infinite"`);
      }
    }
  }

  if (type === 'image' || type === 'sticker') {
    const url = config.imageUrl;
    if (typeof url !== 'string' || !APP_IMAGE_URL_RE.test(url)) {
      errors.push(`Component "${id}" config.imageUrl must be a valid http(s) or /uploads/ image URL`);
    }
    if (config.alt !== undefined && (typeof config.alt !== 'string' || config.alt.length > ALT_MAX)) {
      errors.push(`Component "${id}" config.alt must be a string of at most ${ALT_MAX} characters`);
    }
    if (config.fit !== undefined && !IMAGE_FITS.has(config.fit)) {
      errors.push(`Component "${id}" config.fit must be one of: ${[...IMAGE_FITS].join(', ')}`);
    }
    if (config.backgroundColor !== undefined && !isCssColor(config.backgroundColor)) {
      errors.push(`Component "${id}" config.backgroundColor must be a hex color or empty`);
    }
  }

  if (type === 'card') {
    const heading = config.heading;
    if (typeof heading !== 'string' || !heading.trim() || heading.trim().length > HEADING_MAX) {
      errors.push(`Component "${id}" config.heading must be a non-empty string of at most ${HEADING_MAX} characters`);
    } else if (config.heading !== heading.trim()) {
      errors.push(`Component "${id}" config.heading must not have leading/trailing whitespace`);
    }
    if (config.body !== undefined && (typeof config.body !== 'string' || config.body.length > TEXT_MAX)) {
      errors.push(`Component "${id}" config.body must be a string of at most ${TEXT_MAX} characters`);
    }
    if (config.headingColor !== undefined && !isCssColor(config.headingColor)) {
      errors.push(`Component "${id}" config.headingColor must be a hex color or empty`);
    }
    if (config.textColor !== undefined && !isCssColor(config.textColor)) {
      errors.push(`Component "${id}" config.textColor must be a hex color or empty`);
    }
    if (config.textAlign !== undefined && !TEXT_ALIGNS.has(config.textAlign)) {
      errors.push(`Component "${id}" config.textAlign must be one of: ${[...TEXT_ALIGNS].join(', ')}`);
    }
    // CREATOR-11: Content Mask is a BOOLEAN switch, never a CSS clip value.
    // A design can therefore only ask "clip my children to my box or not", and
    // the actual clipping is produced by the renderer.
    if (config.mask !== undefined && typeof config.mask !== 'boolean') {
      errors.push(`Component "${id}" config.mask must be a boolean`);
    }
  }
}

function validateComponent(component, seenIds, errors) {
  if (!isPlainObject(component)) {
    errors.push('Each component must be an object');
    return;
  }

  const { id, type, x, y, width, height, zIndex, visible, locked, config, parentId } = component;

  if (typeof id !== 'string' || !COMPONENT_ID_RE.test(id)) {
    errors.push(`Component id must match ${COMPONENT_ID_RE} (got: ${id === undefined ? 'missing' : JSON.stringify(id)})`);
  } else if (seenIds.has(id)) {
    errors.push(`Duplicate component id: ${id}`);
  } else {
    seenIds.add(id);
  }

  if (typeof type !== 'string' || !DESIGN_COMPONENT_TYPES.has(type)) {
    const hint = typeof type === 'string' && FUTURE_COMPONENT_TYPES.has(type)
      ? ' — type is not renderable yet'
      : '';
    errors.push(`Unsupported component type: ${String(type)}${hint}`);
  }

  if (!isFiniteNumber(x) || x < POSITION_MIN || x > POSITION_MAX) {
    errors.push(`Component "${id}" x must be a number between ${POSITION_MIN} and ${POSITION_MAX}`);
  }
  if (!isFiniteNumber(y) || y < POSITION_MIN || y > POSITION_MAX) {
    errors.push(`Component "${id}" y must be a number between ${POSITION_MIN} and ${POSITION_MAX}`);
  }
  if (!isFiniteNumber(width) || width < SIZE_MIN || width > SIZE_MAX) {
    errors.push(`Component "${id}" width must be a number between ${SIZE_MIN} and ${SIZE_MAX}`);
  }
  if (!isFiniteNumber(height) || height < SIZE_MIN || height > SIZE_MAX) {
    errors.push(`Component "${id}" height must be a number between ${SIZE_MIN} and ${SIZE_MAX}`);
  }
  if (!Number.isInteger(zIndex) || zIndex < 0 || zIndex > Z_INDEX_MAX) {
    errors.push(`Component "${id}" zIndex must be an integer between 0 and ${Z_INDEX_MAX}`);
  }
  if (typeof visible !== 'boolean') {
    errors.push(`Component "${id}" visible must be a boolean`);
  }
  if (typeof locked !== 'boolean') {
    errors.push(`Component "${id}" locked must be a boolean`);
  }

  // CREATOR-11: optional container relationship. Shape/typing is checked here;
  // existence, cycles and depth are checked across the whole component list in
  // validateParentRelationships() once every id is known.
  if (parentId !== undefined && parentId !== null) {
    if (typeof parentId !== 'string' || !COMPONENT_ID_RE.test(parentId)) {
      errors.push(`Component "${id}" parentId must be a component id string or null`);
    } else if (parentId === id) {
      errors.push(`Component "${id}" cannot be its own parent`);
    }
  }
  if (config !== null && config !== undefined && !isPlainObject(config)) {
    errors.push(`Component "${id}" config must be an object or null`);
  } else if (config !== null && config !== undefined && !jsonSafeValue(config)) {
    errors.push(`Component "${id}" config contains unsupported, unsafe or oversized values`);
  }

  // CREATOR-01B: rotation + style are optional; when present they must be sane.
  validateComponentRotateStyle(component, errors);
  validateContentConfig(component, errors);
}

/**
 * CREATOR-11: validate the container relationships across the whole component
 * list, where every id is finally known.
 *
 * The supported shape is exactly one level deep:
 *
 *   card            (no parent — a container is always top level)
 *     ├── image     (local coordinates relative to the card)
 *     └── sticker
 *
 * Rules enforced here, on the server, as the final authority:
 *   • the parent must exist
 *   • the parent must be a container (card)
 *   • the child type must be allowed inside a card (image / sticker)
 *   • a card may not itself be a child, so recursive nesting is impossible
 *   • no cycles, checked explicitly for defence in depth even though the type
 *     rules already make them unreachable
 *   • the chain may not exceed MAX_NEST_DEPTH
 *
 * Clients are not trusted to have enforced any of this: a hand-built request
 * body is validated on exactly the same path as a saved Studio design.
 *
 * Exported so the cycle/depth walk can be unit-tested directly. With the type
 * rules above, a cycle is structurally impossible (only a card may be a parent
 * and only image/sticker may be a child, so card→card is already rejected), which
 * makes the explicit walk defence in depth for any future type expansion rather
 * than the primary defence.
 */
export function validateParentRelationships(components, errors) {
  if (!Array.isArray(components)) return;

  const byId = new Map();
  for (const component of components) {
    if (isPlainObject(component) && typeof component.id === 'string' && !byId.has(component.id)) {
      byId.set(component.id, component);
    }
  }

  for (const component of components) {
    if (!isPlainObject(component)) continue;
    const { id, type, parentId } = component;
    if (typeof id !== 'string') continue;
    if (parentId === undefined || parentId === null) continue;

    if (typeof parentId !== 'string') continue; // already reported per-component

    const parent = byId.get(parentId);
    if (!parent) {
      errors.push(`Component "${id}" parentId "${parentId}" does not exist`);
      continue;
    }
    if (!CARD_PARENT_TYPES.has(parent.type)) {
      errors.push(`Component "${id}" cannot be nested inside a ${parent.type} — only cards are containers`);
      continue;
    }
    if (!CARD_CHILD_TYPES.has(type)) {
      errors.push(`Component "${id}" (${type}) cannot be nested inside a card — only: ${[...CARD_CHILD_TYPES].join(', ')}`);
      continue;
    }

    // Walk the chain. The cycle check comes BEFORE the depth check so a genuine
    // cycle is always reported as circular rather than as "too deep" — otherwise
    // a 3-node cycle would be misreported the moment it crossed the depth
    // limit. `seen` turns a cycle into a reported error instead of a hang.
    const seen = new Set([id]);
    let depth = 0;
    let cursor = parent;
    while (cursor) {
      const next = typeof cursor.parentId === 'string' ? cursor.parentId : null;
      if (next && seen.has(next)) {
        errors.push(`Component "${id}" creates a circular parent relationship`);
        break;
      }
      if (next) seen.add(next);
      depth += 1;
      if (depth > MAX_NEST_DEPTH) {
        errors.push(`Component "${id}" is nested ${depth} levels deep — only ${MAX_NEST_DEPTH} level of nesting is supported`);
        break;
      }
      cursor = next ? byId.get(next) : null;
    }
  }
}

function validateLayoutConfig(layout) {
  const errors = [];
  if (layout === null || layout === undefined) return errors;

  if (!isPlainObject(layout)) {
    errors.push('layout_config must be an object');
    return errors;
  }

  // CREATOR-09: `guideInitialized` is design-level metadata, not geometry. It
  // records that the Profile Guide has already been initialised for this design,
  // which is what lets the editor tell "never initialised" (give it the default
  // guide) from "intentionally deleted" (leave it alone). It is metadata only —
  // it carries no coordinates and is never rendered.
  const allowed = new Set(['canvas', 'components', 'guideInitialized']);
  for (const key of Object.keys(layout)) {
    if (!allowed.has(key)) errors.push(`Unknown layout_config field: ${key}`);
  }

  if (layout.guideInitialized !== undefined && typeof layout.guideInitialized !== 'boolean') {
    errors.push('layout.guideInitialized must be a boolean');
  }

  if (layout.canvas !== undefined && layout.canvas !== null) {
    if (!isPlainObject(layout.canvas)) {
      errors.push('layout.canvas must be an object');
    } else {
      const { width, minHeight } = layout.canvas;
      if (!isFiniteNumber(width) || width < CANVAS_WIDTH_MIN || width > CANVAS_WIDTH_MAX) {
        errors.push(`layout.canvas.width must be a number between ${CANVAS_WIDTH_MIN} and ${CANVAS_WIDTH_MAX}`);
      }
      if (!isFiniteNumber(minHeight) || minHeight < CANVAS_MIN_HEIGHT_MIN || minHeight > CANVAS_MIN_HEIGHT_MAX) {
        errors.push(`layout.canvas.minHeight must be a number between ${CANVAS_MIN_HEIGHT_MIN} and ${CANVAS_MIN_HEIGHT_MAX}`);
      }
    }
  }

  if (layout.components !== undefined && layout.components !== null) {
    if (!Array.isArray(layout.components)) {
      errors.push('layout.components must be an array');
    } else if (layout.components.length > MAX_COMPONENTS) {
      errors.push(`A design supports at most ${MAX_COMPONENTS} components`);
    } else {
      const seenIds = new Set();
      layout.components.forEach(component => validateComponent(component, seenIds, errors));
      // CREATOR-11: container relationships need every id resolved first.
      validateParentRelationships(layout.components, errors);
    }
  }

  return errors;
}

/**
 * CREATOR-10: the Profile Background is a DESIGN-LEVEL theme setting, not an
 * ordinary `image` component.
 *
 * The public profile already owns the outer background layer
 * (`#profile-background-layer`, painted behind .profile-content-frame and
 * therefore behind the main column AND every sidebar card), and
 * applyProfileDesignAndTheme() folds a published design's theme into it. So the
 * design theme's `backgroundImage` IS the profile background — reusing that
 * existing pipeline instead of inventing a second background mechanism.
 *
 * validateThemeConfig (shared with the Profile Editor) only requires
 * backgroundImage to be a string. For a DESIGN we tighten it to the same rule
 * every other image field uses — http(s) or a same-origin /uploads/ path — so a
 * stored design can never carry a javascript:/data:/protocol-relative URL, and
 * never bypasses the server-side upload validation that produced it.
 *
 * Returns the theme's own errors, exactly like validateThemeConfig, so the
 * caller can use the same "no errors of its own" rule it applies to the layout.
 */
function validateDesignTheme(theme) {
  const errors = validateThemeConfig(theme);
  if (errors.length > 0) return errors;

  const url = theme.backgroundImage;
  if (url !== undefined && url !== null && url !== '' && !APP_IMAGE_URL_RE.test(url)) {
    errors.push('theme.backgroundImage must be a valid http(s) or /uploads/ image URL');
  }
  return errors;
}

/**
 * Validate + normalize a design payload.
 * Accepts a full body ({ name?, layout?, theme? }) or a partial patch.
 * Returns { errors, data } where data (when errors is empty) holds the
 * canonical NAME/LAYOUT/THEME values to persist.
 */
export function validateDesignPayload(body, { partial = false } = {}) {
  const errors = [];
  if (!isPlainObject(body)) {
    return { errors: ['Request body must be a JSON object'], data: null };
  }

  const data = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
      errors.push('Design name must be a non-empty string of at most 100 characters');
    } else if (DANGEROUS_CONFIG_RE.test(body.name)) {
      errors.push('Design name must not contain markup tags');
    } else {
      data.name = body.name.trim();
    }
  } else if (!partial) {
    errors.push('Design name is required');
  }

  if (body.layout !== undefined) {
    if (!isPlainObject(body.layout)) {
      errors.push('layout must be an object');
    } else {
      const layoutErrors = validateLayoutConfig(body.layout);
      errors.push(...layoutErrors);
      if (layoutErrors.length === 0) data.layout = body.layout;
    }
  } else if (!partial) {
    // A blank layout is a valid "everything default" design.
    data.layout = { canvas: null, components: [] };
  }

  if (body.theme !== undefined) {
    if (body.theme === null) {
      data.theme = null;
    } else if (!isPlainObject(body.theme)) {
      errors.push('theme must be an object or null');
    } else {
      const themeErrors = validateDesignTheme(body.theme);
      errors.push(...themeErrors);
      if (themeErrors.length === 0) data.theme = body.theme;
    }
  } else if (!partial) {
    data.theme = null;
  }

  if (errors.length === 0 && data.layout) {
    const bytes = Buffer.byteLength(JSON.stringify(data.layout));
    if (bytes > MAX_LAYOUT_BYTES) {
      errors.push(`layout_config must be at most ${MAX_LAYOUT_BYTES} bytes`);
    }
  }

  return { errors, data };
}

/**
 * Serialize a persisted design row into the API shape, parsing JSON columns.
 */
function serializeDesignRow(row) {
  if (!row) return null;
  if (typeof row.created_at !== 'string') return null; // guard against non-rows
  let layout = null;
  try {
    layout = JSON.parse(row.layout_config || '{}');
  } catch (e) {
    layout = null;
  }
  let theme = null;
  if (row.theme_config) {
    try {
      theme = JSON.parse(row.theme_config);
    } catch (e) {
      theme = null;
    }
  }
  if (layout === null || !isPlainObject(layout)) return null;
  // Re-run the exact write-time validation so stored data cannot break a profile.
  const check = validateDesignPayload({ name: row.name, layout, theme }, { partial: true });
  if (check.errors.length > 0) return null;

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    version: Number(row.version) || 1,
    layout,
    theme,
    published_at: row.published_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function findOwnedDesign(id, userId) {
  return queryOne(
    `SELECT id, user_id, name, status, version, layout_config, theme_config, published_at, created_at, updated_at
     FROM profile_designs WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
}

/**
 * Published design for a user id; null when absent or invalid.
 * Used to attach the design to own-profile responses.
 */
export function getPublishedDesignForUser(userId) {
  const row = queryOne(
    `SELECT id, user_id, name, status, version, layout_config, theme_config, published_at, created_at, updated_at
     FROM profile_designs WHERE user_id = ? AND status = 'published'
     ORDER BY published_at DESC LIMIT 1`,
    [userId]
  );
  return serializeDesignRow(row);
}

/**
 * Published design for a public username; null when absent or invalid.
 * Used to attach the design to public-profile responses without exposing user ids.
 */
export function getPublishedDesignByUsername(username) {
  const row = queryOne(
    `SELECT d.id, d.user_id, d.name, d.status, d.version, d.layout_config, d.theme_config, d.published_at, d.created_at, d.updated_at
     FROM profile_designs d
     JOIN profiles p ON p.user_id = d.user_id
     JOIN users u ON u.id = p.user_id
     WHERE u.username = ? AND d.status = 'published'
     ORDER BY d.published_at DESC LIMIT 1`,
    [username]
  );
  return serializeDesignRow(row);
}

async function readJsonBody(req, res) {
  try {
    return await parseBody(req);
  } catch (err) {
    errorResponse(res, 400, 'Invalid JSON request body');
    return null;
  }
}

/** GET /api/profile/design — list the authenticated user's designs. */
export async function handleListDesigns(req, res, user) {
  try {
    const rows = queryAll(
      `SELECT id, user_id, name, status, version, layout_config, theme_config, published_at, created_at, updated_at
       FROM profile_designs WHERE user_id = ? ORDER BY created_at DESC`,
      [user.sub]
    );
    jsonResponse(res, 200, { designs: rows.map(serializeDesignRow).filter(Boolean) });
  } catch (err) {
    console.error('[DESIGN] List designs error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** POST /api/profile/design — create a draft design. Status is always forced to draft. */
export async function handleCreateDesign(req, res, user) {
  try {
    const body = await readJsonBody(req, res);
    if (body === null) return;

    const { errors, data } = validateDesignPayload(body);
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }

    const id = generateId();
    const ts = now();
    execute(
      `INSERT INTO profile_designs (id, user_id, name, status, version, layout_config, theme_config, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
      [id, user.sub, data.name, JSON.stringify(data.layout), data.theme ? JSON.stringify(data.theme) : null, ts, ts]
    );

    const created = findOwnedDesign(id, user.sub);
    jsonResponse(res, 201, { design: serializeDesignRow(created) });
  } catch (err) {
    console.error('[DESIGN] Create design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** GET /api/profile/design/:id — fetch one of the authenticated user's designs. */
export async function handleGetDesign(req, res, user, params) {
  try {
    const design = findOwnedDesign(params.id, user.sub);
    if (!design) return errorResponse(res, 404, 'Design not found');

    jsonResponse(res, 200, { design: serializeDesignRow(design) });
  } catch (err) {
    console.error('[DESIGN] Get design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** PATCH /api/profile/design/:id — update name/layout/theme of an owned design. */
export async function handleUpdateDesign(req, res, user, params) {
  try {
    const existing = findOwnedDesign(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Design not found');

    const body = await readJsonBody(req, res);
    if (body === null) return;

    const { errors, data } = validateDesignPayload(body, { partial: true });
    if (errors.length > 0) {
      return errorResponse(res, 400, errors.join('; '));
    }
    if (Object.keys(data).length === 0) {
      return errorResponse(res, 400, 'Nothing to update');
    }

    const ts = now();
    execute(
      `UPDATE profile_designs
       SET name = COALESCE(?, name),
           layout_config = COALESCE(?, layout_config),
           theme_config = COALESCE(?, theme_config),
           updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        data.name ?? null,
        data.layout !== undefined ? JSON.stringify(data.layout) : null,
        data.theme !== undefined ? (data.theme ? JSON.stringify(data.theme) : null) : null,
        ts,
        params.id,
        user.sub,
      ]
    );

    const updated = findOwnedDesign(params.id, user.sub);
    jsonResponse(res, 200, { design: serializeDesignRow(updated) });
  } catch (err) {
    console.error('[DESIGN] Update design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/profile/design/:id/publish — make this the user's live design.
 * Archives any previously published design (one published per user) and bumps
 * the version. Ownership comes from the authenticated user only.
 */
export async function handlePublishDesign(req, res, user, params) {
  try {
    const existing = findOwnedDesign(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Design not found');

    const ts = now();
    const version = Number(existing.version) + 1;
    transaction(() => {
      execute(
        `UPDATE profile_designs SET status = 'archived', updated_at = ?
         WHERE user_id = ? AND status = 'published' AND id <> ?`,
        [ts, user.sub, params.id]
      );
      execute(
        `UPDATE profile_designs SET status = 'published', published_at = ?, version = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [ts, version, ts, params.id, user.sub]
      );
    });

    const updated = findOwnedDesign(params.id, user.sub);
    jsonResponse(res, 200, { design: serializeDesignRow(updated) });
  } catch (err) {
    console.error('[DESIGN] Publish design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/** POST /api/profile/design/:id/archive — take the design out of rotation. */
export async function handleArchiveDesign(req, res, user, params) {
  try {
    const existing = findOwnedDesign(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Design not found');

    const ts = now();
    execute(
      `UPDATE profile_designs SET status = 'archived', updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [ts, params.id, user.sub]
    );

    const updated = findOwnedDesign(params.id, user.sub);
    jsonResponse(res, 200, { design: serializeDesignRow(updated) });
  } catch (err) {
    console.error('[DESIGN] Archive design error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}