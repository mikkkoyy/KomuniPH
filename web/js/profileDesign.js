/**
 * KomuniPH Profile Design renderer (CREATOR-01A / CREATOR-01B).
 *
 * Controlled layout application for the shared profile page. A published design
 * repositions/resizes/visibility-toggles the platform's OWN, already-escaped
 * sections — the renderer never injects HTML or executes script from a design.
 * With no design (or an unusable one) the page renders exactly as before.
 *
 * CREATOR-01B adds the four user-content component types (text / image / card /
 * sticker). Those are built with element APIs (textContent / src assignment)
 * only — never innerHTML — so a stored config can express text and an HTTP(S)
 * image URL but can never execute, inline style-inject, or emit markup.
 *
 * This module is deliberately free of imports from profile.js so the profile
 * page can consume it without a circular dependency; any design-level theme
 * overrides are folded into the existing theme pipeline by the caller.
 */

export const CONTENT_COMPONENT_TYPES = new Set(['text', 'image', 'card', 'sticker']);

/**
 * CREATOR-09: `profile_guide_card` is a Creator Studio editing aid — a labelled
 * WIREFRAME CARD marking where a real profile section belongs. Each card is its
 * own design component, so it selects, moves, resizes and deletes through the
 * ordinary Creator Studio geometry system.
 *
 * It is a STUDIO-ONLY type: it is deliberately absent from
 * `CONTENT_COMPONENT_TYPES` and from `COMPONENT_SELECTORS`, so the public
 * profile renderer skips it and a guide card can never appear on a real
 * profile, in Preview, in a published design, in Marketplace listings or in an
 * installed theme/asset.
 *
 * A guide card is NOT profile content, NOT a marketplace card and NOT a
 * purchasable asset — it carries no data, only a `section` id naming which
 * KomuniPH profile section it stands in for.
 */
export const GUIDE_CARD_COMPONENT_TYPE = 'profile_guide_card';

/**
 * CREATOR-08's original single-block guide type. It is retained ONLY so a design
 * saved before CREATOR-09 can still be loaded and migrated to guide cards; no
 * new component is ever created with this type.
 */
export const LEGACY_GUIDE_COMPONENT_TYPE = 'profile_guide';

/**
 * The real KomuniPH profile sections a guide card may stand in for. These are
 * exactly the controlled sections the public profile actually renders — no
 * invented sections, and no user data. A stored card selects one of these ids,
 * so a guide can never carry arbitrary markup, CSS, script or profile content.
 *
 * CREATOR-10: the registry now mirrors the REAL public profile structure
 * (web/js/profile.js → renderProfilePage) rather than one flat list:
 *
 *   .profile-content
 *     .profile-main          → #profile-module (photo/name/alias/bio),
 *                              #personal-info-module, #testimonials-module
 *     .profile-sidebar       → #friend-space-module, #photo-gallery-module,
 *                              #video-box-module, #music-module,
 *                              #scraps-module, #community-module
 *
 * So Photo Gallery is a SIDEBAR module (not a main-column section below
 * Testimonials), and the sidebar features each have their own section id.
 */
export const GUIDE_SECTIONS = {
  // ── Main profile column ──
  profile_photo: 'Profile Photo',
  name: 'Name',
  alias: 'Alias',
  bio: 'Bio',
  personal_info: 'Personal Information',
  testimonials: 'Testimonials',
  // ── Sidebar (each its own independent module) ──
  friend_space: 'Friend Space',
  gallery: 'Photo Gallery',
  video_box: 'Video Box',
  music: 'Music',
  scraps: 'Scraps',
  communities: 'Communities',
};

/**
 * CREATOR-10: which column each real profile section lives in. This is the
 * single source of truth the Profile Viewer, the guide patterns and the tests
 * all read, so a section can never be drawn in the main column on one surface
 * and in the sidebar on another.
 */
export const GUIDE_SECTION_COLUMN = {
  profile_photo: 'main',
  name: 'main',
  alias: 'main',
  bio: 'main',
  personal_info: 'main',
  testimonials: 'main',
  friend_space: 'sidebar',
  gallery: 'sidebar',
  video_box: 'sidebar',
  music: 'sidebar',
  scraps: 'sidebar',
  communities: 'sidebar',
};

export const GUIDE_SECTION_IDS = Object.keys(GUIDE_SECTIONS);

/** Any guide type the editor understands, current or legacy. */
export const GUIDE_COMPONENT_TYPES = new Set([
  GUIDE_CARD_COMPONENT_TYPE,
  LEGACY_GUIDE_COMPONENT_TYPE,
]);

/**
 * CREATOR-10: the REAL KomuniPH profile layout, in DESIGN coordinates on the
 * 960x1200 canvas. This is the single source of truth shared by:
 *
 *   - the Profile Viewer skeleton (the editable base structure a creator sees)
 *   - the default guide pattern (the placement markers laid over it)
 *   - the tests that assert the two agree
 *
 * It mirrors web/js/profile.js → renderProfilePage():
 *
 *   PROFILE BACKGROUND            covers the whole 960x1200 design area
 *   ├── MAIN PROFILE              the wide left column
 *   │   ├── Profile Photo / Name / Alias / Bio
 *   │   ├── Personal Information
 *   │   └── Testimonials
 *   └── SIDEBAR                   the narrow right column, one card per module
 *       ├── Friend Space
 *       ├── Photo Gallery
 *       ├── Video Box
 *       ├── Music
 *       ├── Scraps
 *       └── Communities
 *
 * Note there is deliberately NO Gallery in the main column: on the real profile
 * Photo Gallery is a sidebar module (#photo-gallery-module), so the viewer must
 * not invent a second, main-column Gallery section below Testimonials.
 */
export const PROFILE_LAYOUT = {
  canvas: { width: 960, minHeight: 1200 },
  /** The outer Profile Background layer: the whole design area. */
  background: { x: 0, y: 0, width: 960, height: 1200 },
  /** The wide MAIN PROFILE area, left of the sidebar. */
  main: { x: 40, y: 40, width: 560, height: 1060 },
  /** The separate SIDEBAR area, right of the main column. */
  sidebar: { x: 640, y: 40, width: 280, height: 1060 },
  /**
   * Each real profile module, in the column it actually lives in. Every entry
   * is an INDEPENDENT card — the sidebar modules in particular are never merged
   * into one giant sidebar block.
   */
  modules: {
    // ── Main profile column ──
    profile_photo: { x: 40, y: 40, width: 180, height: 180 },
    name: { x: 240, y: 56, width: 360, height: 60 },
    alias: { x: 240, y: 124, width: 300, height: 48 },
    bio: { x: 40, y: 240, width: 560, height: 110 },
    personal_info: { x: 40, y: 368, width: 560, height: 190 },
    testimonials: { x: 40, y: 576, width: 560, height: 200 },
    // ── Sidebar: one independent card per module ──
    friend_space: { x: 640, y: 40, width: 280, height: 210 },
    gallery: { x: 640, y: 266, width: 280, height: 190 },
    video_box: { x: 640, y: 472, width: 280, height: 140 },
    music: { x: 640, y: 628, width: 280, height: 120 },
    scraps: { x: 640, y: 764, width: 280, height: 140 },
    communities: { x: 640, y: 920, width: 280, height: 140 },
  },
};

/** The main-column module ids, in reading order. */
export const PROFILE_MAIN_SECTIONS = ['profile_photo', 'name', 'alias', 'bio', 'personal_info', 'testimonials'];
/** The sidebar module ids, in the order the real profile stacks them. */
export const PROFILE_SIDEBAR_SECTIONS = ['friend_space', 'gallery', 'video_box', 'music', 'scraps', 'communities'];

/** Build guide card placements straight from the real profile layout. */
function cardsFromProfileLayout(sectionIds) {
  return sectionIds.map(section => {
    const m = PROFILE_LAYOUT.modules[section];
    return { section, x: m.x, y: m.y, width: m.width, height: m.height };
  });
}

/**
 * CREATOR-08's guide patterns. Each is a list of card placements in DESIGN
 * coordinates on the 960x1200 canvas — a plain description of where things go,
 * never content.
 *
 * CREATOR-10: `default` is now generated from PROFILE_LAYOUT, so the guide can
 * never drift away from the profile structure the viewer draws.
 */
const DEFAULT_CARDS = cardsFromProfileLayout([...PROFILE_MAIN_SECTIONS, ...PROFILE_SIDEBAR_SECTIONS]);

export const GUIDE_PATTERNS = {
  default: {
    id: 'default',
    label: 'Default Profile',
    cards: DEFAULT_CARDS,
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal Profile',
    // Same real structure, fewer optional modules: the sidebar keeps Friend
    // Space and Photo Gallery, the main column drops Alias and Testimonials.
    cards: cardsFromProfileLayout(['profile_photo', 'name', 'bio', 'personal_info', 'friend_space', 'gallery']),
  },
  classic: {
    id: 'classic',
    label: 'Classic Profile',
    cards: cardsFromProfileLayout([...PROFILE_MAIN_SECTIONS, 'friend_space', 'gallery', 'communities']),
  },
};

export const GUIDE_PATTERN_IDS = Object.keys(GUIDE_PATTERNS);
export const DEFAULT_GUIDE_PATTERN = 'default';

/** Resolve a stored pattern id, falling back to the default. Never throws. */
export function guidePattern(id) {
  return GUIDE_PATTERNS[id] || GUIDE_PATTERNS[DEFAULT_GUIDE_PATTERN];
}

/** Human label for a guide card's section, never a raw id. */
export function guideSectionLabel(section) {
  return GUIDE_SECTIONS[section] || 'Guide';
}

/** Human label for a guide pattern, used by the Layers panel and Properties. */
export function guideLabel(id) {
  return `Guide — ${guidePattern(id).label}`;
}

/** True when a component is any kind of Creator Studio guide object. */
export function isGuideComponent(component) {
  return !!component && GUIDE_COMPONENT_TYPES.has(component.type);
}

const COMPONENT_SELECTORS = {
  profile_photo: '.profile-header-photo-column',
  name: '#profile-name',
  alias: '#profile-nickname',
  bio: '#profile-bio-box',
  personal_info: '#personal-info-module',
  gallery: '#photo-gallery-module',
  testimonials: '#testimonials-module',
  communities: '#community-module',
};

/**
 * CREATOR-09: types the PUBLIC renderer must never draw, whatever else is true of
 * them. The guide types are already absent from `CONTENT_COMPONENT_TYPES` and
 * from `COMPONENT_SELECTORS`, so they are skipped incidentally; this set makes
 * the exclusion explicit and greppable, so a future change to either registry
 * cannot accidentally make a guide card public.
 */
export const PUBLIC_RENDER_EXCLUDED_TYPES = new Set([
  GUIDE_CARD_COMPONENT_TYPE,
  LEGACY_GUIDE_COMPONENT_TYPE,
]);

/** Elements created for user-content components, keyed by component id. */
const contentElements = new Map();

function px(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `${value}px`;
}

export function numOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Inline SVG icons for content-type placeholders. Kept in JS to avoid static files. */
const TYPE_ICONS = {
  text: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16M4 8.5h9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M15.5 12.5v6M13 12.5h5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  image: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M5 17l4.5-4.5 3.5 3 3-3 3 3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  card: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10h12M6 13.5h7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  sticker: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c5.2 0 9.5 4.3 9.5 9.5s-8.6 9.5-9.5 9.5c-1.5 0-2.3-1.1-3.8-1.1-1.6 0-2.1-1-1.1-2.4.5-.6 1.1-1.4.8-2-.6-1.2-2-1-2-2.6 0-1.4 1-2 1.2-3C8.2 6.5 8.4 10.5 12 10.5s3.3-6.2 0-8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
};

function applyTransform(el, component) {
  const rotation = numOr(component.rotation, 0);
  el.style.transform = rotation ? `rotate(${rotation}deg)` : '';
}

/**
 * Apply the shared position/size/rotation fields for a component node.
 * With applyVisibility false (used by the editor canvas), hidden components are
 * left visible so the user can still select them in the layers panel.
 */
// ── CREATOR-11: Fonts, animation and containers ───────────────────────────────
//
// These registries mirror the server's allowlists exactly and are the ONLY place
// a design id becomes a CSS value. The stored model never contains a CSS string;
// the renderer looks an id up here and applies the value. That is what keeps the
// Studio preview and the public profile rendering the same saved design, and it
// is why a stored design cannot carry `fontFamily: "x; color:red"` or a user
// supplied keyframes string — there is nowhere for one to be stored.

/** Font id → { label for the UI, stack for CSS }. */
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
export const DEFAULT_FONT_FAMILY = 'system-ui';
export const FONT_STYLES = ['normal', 'italic'];
export const DEFAULT_FONT_STYLE = 'normal';

/** Human labels for the Animation dropdown, keyed by animation id. */
export const ANIMATION_LABELS = {
  none: 'None',
  fade: 'Fade',
  'fade-up': 'Fade up',
  'fade-down': 'Fade down',
  'fade-left': 'Fade from left',
  'fade-right': 'Fade from right',
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  bounce: 'Bounce',
  pulse: 'Pulse',
  float: 'Float',
  shake: 'Shake',
  swing: 'Swing',
};
export const ANIMATION_NAMES = Object.keys(ANIMATION_LABELS);
export const ANIMATION_TIMINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
export const ANIMATION_ITERATION_CHOICES = ['once', '2', '3', '5', 'infinite'];
export const ANIMATION_DURATION_MIN = 0.1;
export const ANIMATION_DURATION_MAX = 20;
export const ANIMATION_DELAY_MIN = 0;
export const ANIMATION_DELAY_MAX = 60;
export const DEFAULT_ANIMATION = Object.freeze({ name: 'none', duration: 2, delay: 0, iteration: 1, timing: 'ease-in-out' });

/** Component types that may be nested inside a card, and containers. */
export const CARD_CHILD_TYPES = new Set(['image', 'sticker']);
export const CARD_PARENT_TYPES = new Set(['card']);

/**
 * Normalise a stored animation into safe, bounded values.
 * Anything unknown falls back to the default rather than being passed through.
 */
export function resolveAnimation(animation) {
  if (!animation || typeof animation !== 'object') return null;
  const name = ANIMATION_LABELS[animation.name] ? animation.name : 'none';
  if (name === 'none') return null;
  const clamp = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };
  const iteration = animation.iteration === 'infinite'
    ? 'infinite'
    : (Number.isInteger(animation.iteration)
      ? Math.min(1000, Math.max(1, animation.iteration))
      : DEFAULT_ANIMATION.iteration);
  return {
    name,
    duration: clamp(animation.duration, ANIMATION_DURATION_MIN, ANIMATION_DURATION_MAX, DEFAULT_ANIMATION.duration),
    delay: clamp(animation.delay, ANIMATION_DELAY_MIN, ANIMATION_DELAY_MAX, DEFAULT_ANIMATION.delay),
    iteration,
    timing: ANIMATION_TIMINGS.includes(animation.timing) ? animation.timing : DEFAULT_ANIMATION.timing,
  };
}

/**
 * Apply a component's animation to an element.
 *
 * The animation NAME maps to an application-owned @keyframes rule (declared in
 * the stylesheets); only the four bounded timing numbers are taken from the
 * design. Nothing user-supplied ever becomes a keyframes name or a CSS
 * shorthand, so this cannot be used to smuggle arbitrary CSS.
 *
 * `reducedMotion` disables the animation for the preview only — it never edits
 * the stored design, so turning the preference back off restores the animation.
 */
export function applyAnimationToElement(el, animation, { reducedMotion = false } = {}) {
  if (!el) return;
  const resolved = resolveAnimation(animation);
  if (!resolved || reducedMotion) {
    el.style.animationName = '';
    el.classList.remove('design-animated');
    return;
  }
  el.classList.add('design-animated');
  el.style.animationName = `komuniph-anim-${resolved.name}`;
  el.style.animationDuration = `${resolved.duration}s`;
  el.style.animationDelay = `${resolved.delay}s`;
  el.style.animationIterationCount = resolved.iteration === 'infinite' ? 'infinite' : String(resolved.iteration);
  el.style.animationTimingFunction = resolved.timing;
  // A paused animation must not transform the element, or a creator measuring
  // geometry would see the animated offset. Playback is purely visual.
  el.style.animationFillMode = 'none';
}

/** Apply typography to a text element from a validated text config. */
export function applyTypographyToElement(el, config = {}) {
  if (!el) return;
  const family = FONT_FAMILIES.get(config.fontFamily) || FONT_FAMILIES.get(DEFAULT_FONT_FAMILY);
  el.style.fontFamily = family.stack;
  el.style.fontStyle = FONT_STYLES.includes(config.fontStyle) ? config.fontStyle : DEFAULT_FONT_STYLE;
  if (config.fontSize) el.style.fontSize = px(config.fontSize);
  if (config.fontWeight) el.style.fontWeight = String(config.fontWeight);
  if (config.textAlign) el.style.textAlign = config.textAlign;
  if (config.lineHeight) el.style.lineHeight = String(config.lineHeight);
  if (config.textColor) el.style.color = config.textColor;
}

export function applyGeometryToElement(el, component, { applyVisibility = true } = {}) {
  if (applyVisibility && component.visible === false) {
    el.style.display = 'none';
  } else {
    el.style.display = '';
    el.style.position = 'absolute';
    el.style.left = px(component.x);
    el.style.top = px(component.y);
    el.style.width = px(component.width);
    el.style.height = px(component.height);
    el.style.zIndex = String(numOr(component.zIndex, 0));
  }
  applyTransform(el, component);
}

/** Apply the optional style fields (background / color / border / radius / opacity / shadow). */
export function applyCommonStyleToElement(el, style) {
  if (!style) return;
  if (style.background) el.style.backgroundColor = style.background;
  if (style.textColor) el.style.color = style.textColor;
  if (style.borderColor) el.style.borderColor = style.borderColor;
  if (style.borderWidth !== undefined && style.borderWidth !== null) {
    el.style.borderStyle = style.borderWidth > 0 ? 'solid' : 'none';
    el.style.borderWidth = px(style.borderWidth);
  }
  if (style.borderRadius !== undefined && style.borderRadius !== null) el.style.borderRadius = px(style.borderRadius);
  if (style.opacity !== undefined && style.opacity !== null) el.style.opacity = String(style.opacity);
  if (style.shadowEnabled) {
    const offsetX = numOr(style.shadowOffset, 0);
    const blur = numOr(style.shadowBlur, 12);
    const color = style.shadowColor || 'rgba(0, 0, 0, 0.25)';
    el.style.boxShadow = `${px(offsetX)} ${px(offsetX)} ${px(blur)} ${color}`;
  }
}

/**
 * Apply the position/size/visibility fields shared by every component type.
 * Never called for elements already created by the caller.
 */
function applyGeometry(el, component) {
  applyGeometryToElement(el, component);
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Build (or refresh) the DOM for a user-content component, safely. */
function renderContentComponent(component, content, { parentEl = null } = {}) {
  const { type, config = {} } = component;
  const key = component.id;
  let el = contentElements.get(key);

  if (!el) {
    el = document.createElement('div');
    el.className = 'design-component';
    el.dataset.componentId = key;
    el.dataset.componentType = type;
    if (parentEl) {
      // CREATOR-11: a child is mounted INSIDE its card, so x/y are local to it.
      el.dataset.parentId = parentEl.dataset.componentId;
      parentEl.appendChild(el);
    } else {
      content.appendChild(el);
    }
    contentElements.set(key, el);
  }

  el.className = `design-component design-${type}`;
  // Never wipe a card's mounted children: clearChildren() runs below, so a card
  // re-render must re-attach its children afterwards.
  const isContainer = type === 'card' && !!parentIdsFor.has(key);
  if (!isContainer) clearChildren(el);
  if (parentEl) {
    // Local geometry: the card is the origin, so no absolute-canvas maths.
    el.style.position = 'absolute';
    el.style.left = px(component.x);
    el.style.top = px(component.y);
    el.style.width = px(component.width);
    el.style.height = px(component.height);
    el.style.zIndex = String(numOr(component.zIndex, 0));
    el.style.display = component.visible === false ? 'none' : '';
    applyTransform(el, component);
  } else {
    applyGeometry(el, component);
  }
  applyCommonStyleToElement(el, component.style);
  applyAnimationToElement(el, config.animation, { reducedMotion: prefersReducedMotion() });

  if (type === 'image' || type === 'sticker') {
    const wrapper = document.createElement('div');
    wrapper.className = 'design-image-inner';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = config.alt || '';
    img.className = `design-image-fit-${IMAGE_FIT_CLASSES(config.fit)}`;
    if (config.backgroundColor) wrapper.style.backgroundColor = config.backgroundColor;
    img.addEventListener('error', () => {
      wrapper.classList.add('design-image-broken');
    }, { once: true });
    img.src = config.imageUrl || '';
    wrapper.appendChild(img);
    if (!config.imageUrl) wrapper.classList.add('design-image-broken');
    el.appendChild(wrapper);
    return;
  }

  if (type === 'text') {
    const span = document.createElement('div');
    span.className = 'design-text-content';
    span.textContent = config.text || '';
    applyTypographyToElement(span, config);
    el.appendChild(span);
    return;
  }

  if (type === 'card') {
    // CREATOR-11: a card is a real CONTAINER.
    //
    // Children mount into a `surface` element rather than the card box itself,
    // for the same reason an image clips in `.design-image-inner`: a component's
    // resize handles sit 6px OUTSIDE its own box, so clipping the card directly
    // would make its own handles unreachable. The surface carries the mask, the
    // card box stays unclipped, and the relationship is still a real design-model
    // parent/child link rather than a CSS coincidence.
    el.classList.add('design-card-container');
    if (config.mask === true) el.classList.add('design-card-masked');
    const surface = document.createElement('div');
    surface.className = 'design-card-surface';
    const heading = document.createElement('div');
    heading.className = 'design-card-heading';
    heading.textContent = config.heading || '';
    if (config.headingColor) heading.style.color = config.headingColor;
    surface.appendChild(heading);
    if (config.body) {
      const body = document.createElement('div');
      body.className = 'design-card-body';
      body.textContent = config.body;
      if (config.textColor) body.style.color = config.textColor;
      surface.appendChild(body);
    }
    el.appendChild(surface);
    if (config.textAlign) el.style.textAlign = config.textAlign;
  }
}

/** The element a card's children mount into (its masking surface). */
export function cardSurfaceOf(cardEl) {
  return cardEl ? cardEl.querySelector(':scope > .design-card-surface') : null;
}

/**
 * True when the visitor (or the Studio) has asked for reduced motion.
 * Read live so toggling the OS/browser preference takes effect immediately.
 */
function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Ids of cards that own children, tracked for the current render pass so a card
 * knows whether to preserve its mounted children across a re-render.
 */
let parentIdsFor = new Set();

/** Index a design's components by id so children can find their card. */
function buildComponentIndex(components) {
  const byId = new Map();
  for (const component of components) {
    if (component && typeof component === 'object'
      && typeof component.id === 'string' && CONTENT_COMPONENT_TYPES.has(component.type)) {
      byId.set(component.id, component);
    }
  }
  return byId;
}

function IMAGE_FIT_CLASSES(fit) {
  return ['cover', 'contain', 'fill'].includes(fit) ? fit : 'cover';
}

function imgHasBrokenState(el) {
  const inner = el.querySelector('.design-image-inner');
  return inner ? inner.classList.contains('design-image-broken') : false;
}

/**
 * Defensive, client-side shape check. The server already validates stored
 * designs, but the renderer must be safe against any malformed data it is given.
 */
function resolveDesign(profile) {
  const design = profile && profile.design;
  if (!design || typeof design !== 'object') return null;
  const layout = design.layout;
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.components)) return null;
  return layout;
}

/** Clear any previous design styles so the default rendering is restored. */
function restoreDefault() {
  const frame = document.getElementById('profile-frame');
  if (frame) {
    frame.classList.remove('has-profile-design');
    frame.style.removeProperty('--design-canvas-minheight');
  }
  for (const selector of Object.values(COMPONENT_SELECTORS)) {
    document.querySelectorAll(selector).forEach(el => {
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
      el.style.zIndex = '';
      el.style.display = '';
      el.style.transform = '';
    });
  }
  for (const el of contentElements.values()) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  contentElements.clear();
}

/**
 * Apply a profile's published design to the currently mounted profile frame.
 * No-op (default rendering) when there is no usable design. Never throws.
 */
export function applyProfileDesign(profile) {
  try {
    const frame = document.getElementById('profile-frame');
    const content = document.getElementById('profile-content');
    if (!frame || !content) {
      // Gallery/album pages mount a different layout — leave them untouched.
      return;
    }

    const layout = resolveDesign(profile);
    if (!layout) {
      restoreDefault();
      return;
    }

    const canvas = layout.canvas || {};
    if (canvas.minHeight) frame.style.setProperty('--design-canvas-minheight', px(canvas.minHeight));
    frame.classList.add('has-profile-design');

    // Reconcile persistent content components with the design's declared ids so
    // a removed component is always cleaned up even if the render function
    // short-circuits below (e.g. selection filter).
    const contentIds = new Set(
      layout.components.filter(c => CONTENT_COMPONENT_TYPES.has(c.type)).map(c => c.id)
    );
    for (const [key, el] of contentElements) {
      if (!contentIds.has(key) && el.parentNode) el.parentNode.removeChild(el);
    }
    for (const [key] of contentElements) {
      if (!contentIds.has(key)) contentElements.delete(key);
    }

    // CREATOR-11: render containers before their children so a child can be
    // mounted into its card, and record which cards own children.
    const byId = buildComponentIndex(layout.components);
    const childrenOf = new Map();
    for (const component of layout.components) {
      if (!component || typeof component !== 'object') continue;
      const { id, type, parentId } = component;
      if (typeof id !== 'string' || typeof parentId !== 'string') continue;
      if (PUBLIC_RENDER_EXCLUDED_TYPES.has(type)) continue;
      const parent = byId.get(parentId);
      // Trust the structure, but re-check the type rules defensively: a stored
      // design could predate the rules or arrive from another writer.
      if (!parent || !CARD_PARENT_TYPES.has(parent.type) || !CARD_CHILD_TYPES.has(type)) continue;
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId).push(component);
    }
    parentIdsFor = new Set(childrenOf.keys());

    // Parents first, so every card element exists before a child mounts into it.
    const renderable = layout.components.filter(
      c => c && typeof c === 'object' && !PUBLIC_RENDER_EXCLUDED_TYPES.has(c.type),
    );
    const children = renderable.filter(c => typeof c.parentId === 'string' && childrenOf.has(c.parentId));
    const parents = renderable.filter(c => typeof c.parentId !== 'string');

    for (const component of parents) {
      if (CONTENT_COMPONENT_TYPES.has(component.type)) {
        renderContentComponent(component, content);
        continue;
      }
      applyControlledComponent(component, content);
    }

    // Children are mounted inside their card's masking surface with LOCAL
    // coordinates.
    for (const component of children) {
      const parentEl = contentElements.get(component.parentId);
      const surface = parentEl ? cardSurfaceOf(parentEl) : null;
      if (!surface) continue;
      renderContentComponent(component, content, { parentEl: surface });
    }
  } catch (err) {
    // Cosmetic only — never break the page over a design.
    console.warn('[DESIGN] Could not apply profile design:', err.message || err);
  }
}

/** Apply a controlled profile-module component to its existing public element. */
function applyControlledComponent(component, content) {
  const selector = COMPONENT_SELECTORS[component.type];
  if (!selector) return;
  const el = content.querySelector(selector);
  if (!el) return;

  if (component.visible === false) {
    el.style.display = 'none';
    return;
  }
  el.style.position = 'absolute';
  el.style.left = px(component.x);
  el.style.top = px(component.y);
  el.style.width = px(component.width);
  el.style.height = px(component.height);
  el.style.zIndex = String(numOr(component.zIndex, 0));
  applyTransform(el, component);
  applyCommonStyleToElement(el, component.style);
}