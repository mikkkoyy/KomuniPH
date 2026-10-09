/**
 * KomuniPH Creator Studio (CREATOR-01B).
 *
 * Visual drag-and-drop editor for profile designs. Works on the exact model
 * CREATOR-01A stores (layout.canvas + layout.components): everything the user
 * drags, resizes or types is edited client-side against that model, and "Save"
 * (PATCH) / "Publish" reuse the existing designApi. The server is the final
 * authority — the studio never bypasses server validation, and every geometry /
 * style / content value it produces must survive the server's checks to save.
 *
 * The editor canvas is a WYSIWYG representation of the profile content area.
 * The 8 platform sections render as labeled placeholders (they are the real,
 * server-rendered modules on the public page, so the editor shows where each
 * one lands); text / image / card / sticker render as real content previews
 * using the same visual classes as the public renderer.
 */

import { designApi, profileApi, creatorAssetsApi, getAccessToken, projectApi, versionApi, creatorLibraryApi, creatorAudioApi } from './api.js';
import {
  CONTENT_COMPONENT_TYPES,
  applyGeometryToElement,
  applyCommonStyleToElement,
  GUIDE_CARD_COMPONENT_TYPE,
  LEGACY_GUIDE_COMPONENT_TYPE,
  GUIDE_COMPONENT_TYPES,
  GUIDE_SECTIONS,
  GUIDE_SECTION_IDS,
  GUIDE_SECTION_COLUMN,
  GUIDE_PATTERN_IDS,
  DEFAULT_GUIDE_PATTERN,
  PROFILE_LAYOUT,
  PROFILE_MAIN_SECTIONS,
  PROFILE_SIDEBAR_SECTIONS,
  guidePattern,
  guideSectionLabel,
  guideLabel,
  FONT_FAMILY_IDS,
  FONT_FAMILIES,
  FONT_STYLES,
  ANIMATION_LABELS,
  ANIMATION_NAMES,
  ANIMATION_TIMINGS,
  ANIMATION_ITERATION_CHOICES,
  ANIMATION_DURATION_MIN,
  ANIMATION_DURATION_MAX,
  ANIMATION_DELAY_MIN,
  ANIMATION_DELAY_MAX,
  DEFAULT_ANIMATION,
  CARD_CHILD_TYPES,
  CARD_PARENT_TYPES,
  applyTypographyToElement,
  applyAnimationToElement,
  resolveAnimation,
  numOr,
} from './profileDesign.js';
// CREATOR-12: the Profile Background Effect registry (built-ins, engines and the
// per-effect config schema) and the SHARED renderer. The Studio preview and the
// public profile both go through this renderer, so they cannot diverge.
import {
  BUILTIN_EFFECTS,
  BUILTIN_EFFECT_IDS,
  ENGINE_SCHEMAS,
} from './backgroundEffects.js';
import {
  applyProfileBackgroundEffect,
  getEffectController,
  clearProfileBackgroundEffect,
  createMotionProbe,
  prefersReducedMotion,
} from './backgroundEffectRenderer.js';
import { creatorEffectApi } from './api.js';
import {
  stepPan,
  stepZoom,
  zoomPercent,
  clampZoom,
  clampPan,
  fitZoom,
  centeredPan,
  viewerTransform,
  designPoint,
  columnWidthsFromDrag,
  clampPanelWidth,
  clampViewerHeight,
  MIN_PANEL_WIDTH,
  MIN_CENTER_WIDTH,
  MIN_VIEWER_HEIGHT,
  DEFAULT_VIEWER_HEIGHT,
  DEFAULT_ZOOM,
} from './studioViewer.js';
// CREATOR-17: the self-contained MP3 music player. All playback logic and the
// element lifecycle live in this module; the studio only mounts it in a modal
// and tears it down on close / navigation.
import { MusicPlayer } from './musicPlayer.js';

// ── Component catalog (mirrors the server registries) ────────────────────────
const CONTROLLED_SECTIONS = [
  { type: 'profile_photo', label: 'Profile Photo', hint: 'Your header photo', w: 180, h: 180 },
  { type: 'name', label: 'Name', hint: 'Display name', w: 420, h: 96 },
  { type: 'alias', label: 'Nickname', hint: 'Nickname / alias', w: 360, h: 72 },
  { type: 'bio', label: 'Bio', hint: 'About you', w: 420, h: 140 },
  { type: 'personal_info', label: 'Personal Info', hint: 'Details module', w: 420, h: 180 },
  { type: 'gallery', label: 'Photo Gallery', hint: 'Your photos', w: 460, h: 280 },
  { type: 'testimonials', label: 'Testimonials', hint: 'Friend reviews', w: 420, h: 220 },
  { type: 'communities', label: 'Communities', hint: 'Joined communities', w: 420, h: 220 },
];

const CONTENT_SECTIONS = [
  { type: 'text', label: 'Text', hint: 'A paragraph of styled text', w: 320, h: 96, config: { text: 'Your text here' } },
  { type: 'image', label: 'Image', hint: 'An image from a URL', w: 360, h: 240, config: { imageUrl: '', fit: 'cover' } },
  { type: 'card', label: 'Card', hint: 'Heading + body', w: 340, h: 190, config: { heading: 'New card', body: '' } },
  { type: 'sticker', label: 'Sticker', hint: 'A decorative image', w: 160, h: 160, config: { imageUrl: '', fit: 'contain' } },
];

/**
 * CREATOR-09: the Profile Guide is no longer one big block. It is a set of
 * `profile_guide_card` components — one per real KomuniPH profile section — so
 * each card selects, moves, resizes and deletes through the ordinary geometry
 * system. The guide is NOT content: it is a Studio-only wireframe, so it is
 * never rendered on the public profile, in Preview, in a published design, in
 * Marketplace listings or in installed themes/assets.
 *
 * The guide is initialised ONCE, at design creation or at the load/migration
 * boundary, and never by renderCanvas() — so a guide card the creator deleted
 * stays deleted and re-opening a design never resurrects it.
 */
const ALL_SECTIONS = [...CONTROLLED_SECTIONS, ...CONTENT_SECTIONS];
const CONTROLLED_TYPES = new Set(CONTROLLED_SECTIONS.map(s => s.type));

const SECTION_ICONS = {
  profile_photo: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.2" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 19c1-3.2 3.9-5 7-5s6 1.8 7 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  name: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14M5 9.5h10" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="9" cy="15" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13.5 17.5l3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  alias: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`,
  bio: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10h8M8 13.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  personal_info: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="20.2" cy="20.2" r="1" fill="currentColor"/></svg>`,
  gallery: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="9" r="1.7" fill="currentColor"/><path d="M5.5 17.5l4-4.5 3 3 2.5-2.5 3.5 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/></svg>`,
  testimonials: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4c-4.4 0-8 2.9-8 6.5 0 2 1 3.7 2.6 4.8-.2 1.5-.9 2.8-2 3.8 1.7-.2 3.3-1 4.5-2.1.9.2 1.9.3 2.9.3 4.4 0 8-2.9 8-6.8S16.4 4 12 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  communities: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
};

/**
 * CREATOR-10: the design canvas is the real profile layout's own size, so the
 * editable area and the profile it describes can never disagree.
 */
const DEFAULT_CANVAS = { ...PROFILE_LAYOUT.canvas };
const SNAP = 6;
const MIN_SIZE = 8;
const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// ── Profile Background (CREATOR-10) ────────────────────────────────────────────
//
// The background is DESIGN-LEVEL configuration, never an ordinary `image`
// component. It lives on the design's theme, which the public profile already
// folds into its outer `#profile-background-layer` — the layer painted behind
// the whole profile, main column and sidebar alike. So the Studio writes the
// same theme fields the profile reads, and there is exactly one background.
//
// The presentation fields are the platform's own background vocabulary, already
// validated server-side by validateThemeConfig; `imageUrl` is the single
// allowlisted image value and is validated strictly as a design.
const PROFILE_BACKGROUND_SIZES = ['cover', 'contain', 'stretch'];
const PROFILE_BACKGROUND_POSITIONS = [
  'center', 'top', 'bottom', 'left', 'right',
  'top left', 'top center', 'top right',
  'center left', 'center center', 'center right',
  'bottom left', 'bottom center', 'bottom right',
];
const PROFILE_BACKGROUND_REPEATS = ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'];

/** 'stretch' has no CSS keyword; the profile maps it to 100% 100%. */
function backgroundSizeCss(size) {
  return size === 'stretch' ? '100% 100%' : (size || 'cover');
}

/** The design's theme object, created on demand so a patch never drops it. */
function designTheme() {
  if (!currentDesign) return null;
  if (!isPlainTheme(currentDesign.theme)) currentDesign.theme = {};
  return currentDesign.theme;
}

function isPlainTheme(theme) {
  return !!theme && typeof theme === 'object' && !Array.isArray(theme);
}

/** The uploaded profile-background URL, or '' when none is set. */
function backgroundImageUrl() {
  const theme = designTheme();
  return theme && typeof theme.backgroundImage === 'string' ? theme.backgroundImage : '';
}

// ── Profile Background state (CREATOR-10A) ─────────────────────────────────────
//
// "Uploaded" and "Active" are DIFFERENT states and the Properties panel has to
// say so at a glance:
//
//   none      no background, nothing waiting
//   pending   an image is uploaded and waiting; nothing is active yet
//   active    theme.backgroundImage is set; this is the live background
//   replace   something is already active AND a new image is waiting
//
// The ACTIVE state is derived from theme.backgroundImage alone, so it is always
// reconstructed from the saved design. The PENDING upload is deliberately NOT
// part of the design model — it is transient editor state that only becomes real
// when the creator applies it.
//
// It is held at module scope rather than inside the properties closure because
// that closure is rebuilt on every renderProperties(): a closure-local pending
// URL was silently discarded by any unrelated re-render, which looked to a
// creator like their upload had vanished.
let pendingBackgroundUrl = '';

/**
 * CREATOR-12: a staged `.kpeffect` import, held OUTSIDE the design.
 *
 * Importing validates and installs a package; it does not apply it. Keeping the
 * staged effect here — and discarding it on a design swap — is what stops an
 * import from silently becoming the profile's live effect, and stops it
 * following a creator to a different design.
 */
let pendingEffect = null;
let pendingInstalledEffects = null;
let pendingEffectImportError = '';

/** Effect rows the server says are installed and published for this creator. */
function installedEffects() {
  return Array.isArray(pendingInstalledEffects) ? pendingInstalledEffects : [];
}

/** The validated engine + default config for an effect id, builtin or creator. */
function effectDefinitionFor(effectId) {
  const builtin = BUILTIN_EFFECTS[effectId];
  if (builtin) return { engine: builtin.engine, config: builtin.defaultConfig };
  const row = installedEffects().find(r => r.effect_id === effectId);
  if (!row) return null;
  let definition = {};
  try { definition = JSON.parse(row.definition_json || '{}'); } catch { definition = {}; }
  return {
    engine: row.engine || definition.engine,
    config: definition.config || {},
  };
}

/** A creator effect needs its INSTALLED definition to render at all. */
function installedEffectDefinition(effectId) {
  const row = installedEffects().find(r => r.effect_id === effectId);
  if (!row) return null;
  let definition = {};
  try { definition = JSON.parse(row.definition_json || '{}'); } catch { definition = {}; }
  return { ...row, definition_json: JSON.stringify(definition) };
}

/** Load (or reload) the creator's installed effects from the server. */
async function refreshInstalledEffects() {
  try {
    const result = await creatorEffectApi.list();
    pendingInstalledEffects = (result && result.creator) || [];
  } catch {
    // A failed list must never break the Studio; it just means no creator
    // effects are selectable right now.
    pendingInstalledEffects = [];
  }
}

/** Stage an effect choice without applying it. */
function stageEffect(choice) {
  const def = effectDefinitionFor(choice.effectId);
  pendingEffect = { ...choice, engine: def ? def.engine : undefined };
  pendingEffectImportError = '';
  renderProperties();
}

/**
 * A failed upload message, shown once on the next render and then cleared, so a
 * failure is visible in the panel rather than only in the transient status text.
 */
let pendingUploadError = '';

/** Discard a staged upload. Called whenever the design is swapped or loaded. */
function resetPendingBackground() {
  pendingBackgroundUrl = '';
  pendingUploadError = '';
  // CREATOR-12: a staged .kpeffect import belongs to the design it was staged
  // in, exactly as a staged background upload does.
  pendingEffect = null;
  pendingEffectImportError = '';
}

/** The single source of truth for what the Profile Background section shows. */
function backgroundState() {
  const active = backgroundImageUrl();
  const pending = pendingBackgroundUrl;
  if (active && pending && pending !== active) {
    return { key: 'replace', active, pending, label: 'REPLACEMENT READY' };
  }
  if (active) return { key: 'active', active, pending: '', label: 'ACTIVE' };
  if (pending) return { key: 'pending', active: '', pending, label: 'UPLOADED — NOT ACTIVE' };
  return { key: 'none', active: '', pending: '', label: 'NOT SET' };
}

// ── Module state ─────────────────────────────────────────────────────────────
let root = null;
let currentDesign = null;
let designs = [];
let selectedId = null;
// CREATOR-06: `zoom` and `viewerPan` are VIEWER coordinates. They describe how
// the editor looks at the design and are never written to the design itself.
let zoom = 1;
let viewerPan = { x: 0, y: 0 };
// CREATOR-07A/07B: workspace layout is editor state only, never design data.
// `panelWidths` holds the two side-column widths (null = the responsive CSS
// defaults) and `viewerHeight` the viewer's vertical size. The viewer has no
// width of its own: it always fills the center column, so the panels own the
// horizontal space. CREATOR-07B: the height is seeded with a DELIBERATE default
// instead of `null`, so the stage always has a height of its own and can never
// inherit the side panels' height.
let panelWidths = null;
let viewerHeight = DEFAULT_VIEWER_HEIGHT;
let dirty = false;
let busy = false;
let previewMode = false;
let pendingType = null;
let idCounter = 0;
let history = [];
let future = [];
let drag = null;
// CREATOR-02: Save as Creator Asset modal session state.
let assetModal = null;
let assetModalAsset = null;

// CREATOR-15: Version History modal session state. The preview
// effect layer is tracked so closing the modal stops the
// preview's animation loop — runtime effect state is never
// persisted and never outlives the preview that plays it.
let versionHistoryModal = null;
let versionPreviewEffectLayer = null;
let versionPreviewVersion = null;

// CREATOR-16: Asset Library modal session state.
let libraryModal = null;
let libraryItems = [];
let libraryFilter = 'all';
let librarySearch = '';
let librarySearchDebounce = null;

// CREATOR-17: MP3 Music Player modal session state. The MusicPlayer instance is
// created fresh per open and destroyed on every close/navigation, so playback
// can never outlive the modal. musicPlayerTracks holds the creator's uploaded
// tracks (server-issued URLs only).
let musicPlayerModal = null;
let musicPlayer = null;
let musicPlayerTracks = [];

function keyHandler(event) { onKey(event); }
function beforeUnload(event) {
  if (dirty && !busy) { event.preventDefault(); event.returnValue = ''; }
}

// ── Small helpers ────────────────────────────────────────────────────────────
function layout() { return currentDesign.layout; }
function components() { return layout().components; }
function canvas() { return layout().canvas || DEFAULT_CANVAS; }
function findComp(id) { return components().find(c => c.id === id); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function roundInt(value) { return Math.round(value); }
function newId() { idCounter += 1; return `c${Date.now().toString(36)}${idCounter.toString(36)}`; }
function labelOf(comp) {
  const meta = ALL_SECTIONS.find(s => s.type === comp.type);
  // CREATOR-09: a guide card is named after the real section it marks, with a
  // "Guide" prefix so it is never mistaken for a real component in Layers.
  if (comp.type === GUIDE_CARD_COMPONENT_TYPE) {
    return `Guide — ${guideSectionLabel(comp.config && comp.config.section)}`;
  }
  // CREATOR-08's legacy single-block guide, still shown if an un-migrated design
  // is somehow open.
  if (comp.type === LEGACY_GUIDE_COMPONENT_TYPE) return guideLabel(comp.config && comp.config.pattern);
  if (comp.type === 'text') {
    const preview = String((comp.config && comp.config.text) || '').slice(0, 24);
    return `Text — ${preview || '…'}`;
  }
  return meta ? meta.label : comp.type;
}
function setStatus(message) {
  const status = root?.querySelector('#studio-status');
  if (status) status.textContent = message;
}
function showWorkspace(visible) {
  const workspace = root?.querySelector('#studio-workspace');
  if (!workspace) return;
  workspace.hidden = !visible;
  // CREATOR-10: un-hiding the workspace is the first moment the viewer has a
  // measurable size, so it is the first moment the canvas CAN be centred. The
  // re-centring in recentreViewer() deliberately bails out while the viewport is
  // still 0x0, so without this the design would stay pinned against the
  // top-left corner on first paint. Repaint afterwards, because the canvas
  // transform was written before the viewport existed.
  if (visible) {
    applyWorkspaceState();
    renderCanvas();
  }
}

function pushHistory() {
  history.push(clone(layout()));
  if (history.length > 120) history.shift();
  future = [];
  updateToolbar();
}

function undo() {
  if (!history.length) return;
  future.push(clone(layout()));
  currentDesign.layout = history.pop();
  dirty = true;
  renderCanvas();
  renderLayers();
  updateToolbar();
  setStatus('Undid the last change.');
}

function redo() {
  if (!future.length) return;
  history.push(clone(layout()));
  currentDesign.layout = future.pop();
  dirty = true;
  renderCanvas();
  renderLayers();
  updateToolbar();
  setStatus('Redid the last change.');
}

function updateToolbar() {
  const undoBtn = root?.querySelector('#studio-undo');
  const redoBtn = root?.querySelector('#studio-redo');
  if (undoBtn) undoBtn.disabled = history.length === 0;
  if (redoBtn) redoBtn.disabled = future.length === 0;
}

function markChanged(message) {
  dirty = true;
  renderCanvas();
  renderLayers();
  updateToolbar();
  if (message) setStatus(message);
}

function normalizeDesign(design) {
  const layoutObj = design && design.layout && typeof design.layout === 'object'
    ? design.layout
    : { canvas: { ...DEFAULT_CANVAS }, components: [] };
  if (!layoutObj.canvas || typeof layoutObj.canvas !== 'object') layoutObj.canvas = { ...DEFAULT_CANVAS };
  if (!Array.isArray(layoutObj.components)) layoutObj.components = [];
  // CREATOR-09: the guide initialisation / migration boundary. It runs when a
  // design is OPENED, not when it is drawn, and it is a no-op on any design that
  // has already been initialised — so an intentional deletion is never undone
  // and guide cards are never duplicated.
  ensureGuideInitialized(layoutObj);
  return { ...design, layout: layoutObj };
}

// ── Rendering ────────────────────────────────────────────────────────────────
export function renderCreatorStudioPage() {
  return `<main id="creator-studio" class="creator-studio">
    <header class="studio-heading">
      <a href="#/creator-studio/projects" class="studio-back-projects">← Back to Projects</a>
      <a href="#/profile" class="studio-back-profile">← Return to profile</a>
      <p class="editor-eyebrow">CREATOR STUDIO</p>
      <div class="studio-title-row">
        <h1>Creator Studio</h1>
        <p id="studio-project-name" class="studio-project-name" hidden></p>
        <p id="studio-project-version" class="studio-project-version" hidden></p>
      </div>
      <p>Design your profile layout. The canvas is a live preview of where each element lands on
      your public profile — Save a draft anytime, Publish when you are ready.</p>
    </header>
    <p id="studio-status" role="status" aria-live="polite">Loading your designs…</p>
    <section id="studio-workspace" hidden>
      <div class="studio-toolbar" role="toolbar" aria-label="Design toolbar">
        <label class="studio-design-select">Design
          <select id="studio-design-select" aria-label="Select design"></select>
        </label>
        <button id="studio-new-design" class="btn btn-secondary" type="button">New Design</button>
        <span class="studio-toolbar-sep" aria-hidden="true"></span>
        <button id="studio-undo" class="btn btn-secondary" type="button" title="Undo (Ctrl+Z)" disabled>↶ Undo</button>
        <button id="studio-redo" class="btn btn-secondary" type="button" title="Redo (Ctrl+Y)" disabled>↷ Redo</button>
        <button id="studio-preview-toggle" class="btn btn-secondary" type="button">Preview</button>
        <button id="studio-guide-reset" class="btn btn-secondary" type="button"
                title="Remove every guide card and restore the default guide set">Reset Guide</button>
        <span class="studio-toolbar-sep" aria-hidden="true"></span>
        <span class="studio-spacer" aria-hidden="true"></span>
        <button id="studio-coin-shop" class="btn btn-secondary" type="button" title="Manage the digital assets you sell for KomuniPH Coins">My Coin Shop</button>
        <button id="studio-open-profile" class="btn btn-secondary" type="button" title="Open your published profile in a new tab">Open Profile↗</button>
        <button id="studio-version-history" class="btn btn-secondary" type="button" title="Browse every saved version of this project and restore an older one">Version History</button>
        <button id="studio-save" class="btn btn-primary" type="button">Save Draft</button>
        <button id="studio-publish" class="btn btn-cta" type="button">Publish</button>
        <button id="studio-save-asset" class="btn btn-secondary" type="button" title="Create a Coin Shop asset from this design">Save as Asset</button>
        <button id="studio-asset-library" class="btn btn-secondary" type="button" title="Open your persistent asset library — browse and reuse images, backgrounds, stickers, effects, projects and creator assets across designs">Asset Library</button>
        <button id="studio-music-player" class="btn btn-secondary" type="button" title="Open the MP3 music player — upload and preview your own tracks">Music Player</button>
      </div>
      <div class="studio-layout" id="studio-layout">
        <aside id="studio-elements" class="studio-panel" aria-label="Elements">
          <h2>Profile Sections</h2>
          <p class="studio-panel-note">Each element maps to a real part of your profile page.</p>
          <div id="studio-sections-list" class="studio-element-list"></div>
          <h2>Content</h2>
          <p class="studio-panel-note">Add your own text, images and cards.</p>
          <div id="studio-content-list" class="studio-element-list"></div>
        </aside>
        <div id="studio-stage">
          <!-- CREATOR-09: ONE bar above the viewer carrying the DESIGN CANVAS size
               and the CREATOR-08 zoom controls. The canvas size is the design
               coordinate system (960 x 1200 by default), NOT the Profile Viewer:
               the viewer below is only the editing viewport that displays it.
               Keeping both on ONE row means the indicator costs the viewer no
               vertical space. The label is re-rendered from layout.canvas on
               every canvas render, so it always states the real dimensions. -->
          <div id="studio-stage-bar">
            <span id="studio-canvas-size" title="Design canvas size in design coordinates"
                  role="status" aria-live="polite">Canvas 960 × 1200 px</span>
            <!-- CREATOR-08: the compact zoom bar, kept on the same row so it never
                 covers the profile canvas and never steals pointer events from
                 editing. It controls zoom/pan only — never viewer size. -->
            <div id="studio-viewer-controls" role="group" aria-label="Profile Viewer zoom">
              <button type="button" id="studio-zoom-out" class="btn btn-secondary studio-zoom-btn" title="Zoom out (10%)" aria-label="Zoom out">−</button>
              <span id="studio-zoom-readout" class="studio-zoom-readout" role="status" aria-live="polite" title="Current zoom">100%</span>
              <button type="button" id="studio-zoom-in" class="btn btn-secondary studio-zoom-btn" title="Zoom in (10%)" aria-label="Zoom in">+</button>
              <button type="button" id="studio-zoom-fit" class="btn btn-secondary studio-zoom-btn"
                      title="Scale the Profile Viewer so the whole profile — including the sidebar — is visible"
                      aria-label="Fit profile to viewer">Fit</button>
              <button type="button" id="studio-zoom-reset" class="btn btn-secondary studio-zoom-btn studio-zoom-reset" title="Reset zoom to 100% and re-centre">Reset</button>
            </div>
          </div>
          <div id="studio-viewer">
            <div id="studio-canvas-scroll">
              <div id="studio-canvas-inner"></div>
            </div>
            <div class="studio-viewer-height-grip" id="studio-viewer-height-grip"
                 data-resize-height role="separator" aria-orientation="horizontal" aria-label="Resize Profile Viewer height"></div>
          </div>
        </div>
        <aside id="studio-properties-panel" class="studio-panel" aria-label="Properties">
          <h2>Properties</h2>
          <div id="studio-properties"></div>
        </aside>
        <div class="studio-col-resizer" id="studio-col-resizer-left"
             data-resize-col="left" role="separator" aria-orientation="vertical" aria-label="Resize Elements panel"></div>
        <div class="studio-col-resizer" id="studio-col-resizer-right"
             data-resize-col="right" role="separator" aria-orientation="vertical" aria-label="Resize Properties panel"></div>
      </div>
      <section id="studio-layers" class="studio-panel" aria-label="Layers">
        <h2>Layers <span class="studio-panel-note">bottom to top</span></h2>
        <div id="studio-layers-list"></div>
      </section>
    </section>
  </main>`;
}

function elementItemHtml(section) {
  return `<div class="studio-element-item" draggable="true" data-type="${section.type}">
    <span class="studio-element-icon">${SECTION_ICONS[section.type] || ''}</span>
    <span class="studio-element-text"><strong>${section.label}</strong><small>${section.hint}</small></span>
    <button type="button" class="studio-element-add" data-add="${section.type}" title="Add to canvas">+</button>
  </div>`;
}

function renderElementPanels() {
  const sectionsList = root?.querySelector('#studio-sections-list');
  const contentList = root?.querySelector('#studio-content-list');
  if (sectionsList) sectionsList.innerHTML = CONTROLLED_SECTIONS.map(elementItemHtml).join('');
  if (contentList) contentList.innerHTML = CONTENT_SECTIONS.map(elementItemHtml).join('');
}

function renderDesignSelect() {
  const select = root?.querySelector('#studio-design-select');
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  designs.forEach(design => {
    const option = document.createElement('option');
    option.value = design.id;
    option.textContent = `${design.name}${design.status === 'published' ? ' (published)' : ''}`;
    select.appendChild(option);
  });
  if (currentDesign && designs.some(d => d.id === currentDesign.id)) select.value = currentDesign.id;
  else if (previous && designs.some(d => d.id === previous)) select.value = previous;
}

// ── Profile Viewer (CREATOR-06) ───────────────────────────────────────────────
// Viewer-only controls. Nothing in this section may touch the design layout.

/** Current viewer viewport size in screen px (0 when the stage is not laid out). */
/**
 * The usable area the canvas is laid out in: the viewer's CONTENT box.
 *
 * clientWidth/clientHeight describe the PADDING box, but the canvas document is
 * a child of #studio-canvas-inner, which sits inside the scroll element's
 * padding — and that element has a 1.25rem padding plus a 1px border. Centring
 * against the padding box would therefore be skewed by that fixed inset: the
 * canvas would sit ~20px too far right and down, which is exactly the "stuck
 * against the edge" appearance centring is meant to remove. Subtracting the
 * padding measures the box the canvas origin actually lives in, so a centred pan
 * is centred both mathematically and on screen.
 */
function viewerViewport() {
  const scroll = root?.querySelector('#studio-canvas-scroll');
  if (!scroll) return { w: 0, h: 0 };
  const cs = window.getComputedStyle(scroll);
  const pad = (a, b) => (parseFloat(cs[a]) || 0) + (parseFloat(cs[b]) || 0);
  return {
    w: Math.max(0, scroll.clientWidth - pad('paddingLeft', 'paddingRight')),
    h: Math.max(0, scroll.clientHeight - pad('paddingTop', 'paddingBottom')),
  };
}

/** Scaled on-screen size of the design document. */
function scaledCanvasSize() {
  const c = canvas();
  return { w: c.width * zoom, h: c.minHeight * zoom };
}

/** Keep the pan inside the reachable range. Viewer-only. */
function clampViewerPan() {
  const { w, h } = viewerViewport();
  if (!(w > 0) || !(h > 0)) return;
  const scaled = scaledCanvasSize();
  viewerPan = clampPan({ panX: viewerPan.x, panY: viewerPan.y, viewportW: w, viewportH: h, contentW: scaled.w, contentH: scaled.h });
}

/**
 * CREATOR-10: put the editable canvas in the MIDDLE of the Profile Viewer.
 *
 * Called whenever the view is (re)established rather than merely kept reachable:
 *
 *   zoom − / zoom + / Fit / Reset   — the scale changed, so the canvas is
 *                                     re-centred at the new size
 *   side-panel drag                 — the centre column changed width
 *   viewer-height drag              — the viewport changed height
 *   window resize                   — both of the above may have changed
 *   opening / switching a design    — a new canvas in a known view
 *
 * When the scaled canvas is smaller than the viewport this leaves equal
 * breathing room on every side; when it is larger it shows the middle of the
 * canvas instead of pinning a corner to the top-left. Either way the result is
 * passed through clampViewerPan() to keep the design reachable — a no-op for a
 * centred offset, but it preserves the invariant rather than assuming it.
 *
 * Deliberately NOT called from renderCanvas()/clampViewerPan(): those run on
 * every re-render, so recentring there would throw away a creator's manual pan
 * during an ordinary component edit. Centring is an explicit action, and manual
 * panning stays available in between.
 */
function recentreViewer() {
  const { w, h } = viewerViewport();
  if (!(w > 0) || !(h > 0)) return;
  const scaled = scaledCanvasSize();
  viewerPan = centeredPan({ viewportW: w, viewportH: h, contentW: scaled.w, contentH: scaled.h });
  clampViewerPan();
}

/** Nudge the viewer by one step (arrow keys). Viewer-only. */
function panViewer(direction) {
  const next = stepPan(viewerPan, direction);
  const { w, h } = viewerViewport();
  const scaled = scaledCanvasSize();
  viewerPan = clampPan({ panX: next.x, panY: next.y, viewportW: w, viewportH: h, contentW: scaled.w, contentH: scaled.h });
  renderCanvas();
}

// ── Workspace resize (CREATOR-07A) ───────────────────────────────────────────
//
// Panel boundaries own the horizontal space; the viewer's bottom boundary owns
// its height. All three values are editor state applied to CSS custom
// properties / inline height only: they are never written to the design, never
// mark the design dirty, and never push an undo entry.

function viewerElement() {
  return root?.querySelector('#studio-viewer') || null;
}

function stageElement() {
  return root?.querySelector('#studio-stage') || null;
}

function layoutElement() {
  return root?.querySelector('#studio-layout') || null;
}

/**
 * Below this width the studio is a single column, where desktop-style panel
 * resizing makes no sense and must not be forced.
 */
function isSingleColumn() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 960px)').matches;
}

/** Push the current workspace state onto the elements. */
function applyWorkspaceState() {
  const layout = layoutElement();
  const stage = stageElement();
  if (!layout || !stage) return;

  if (isSingleColumn()) {
    // The COLUMN widths go back to the responsive stylesheet, but the viewer
    // keeps its own height: the stacked layout is not a reason to shrink the
    // editing area, only a reason to drop desktop-style handles.
    layout.style.removeProperty('--studio-col-left');
    layout.style.removeProperty('--studio-col-right');
    stage.style.height = `${clampViewerHeight(viewerHeight, {
      min: MIN_VIEWER_HEIGHT,
      fallback: DEFAULT_VIEWER_HEIGHT,
    })}px`;
    layout.querySelectorAll('.studio-col-resizer').forEach(el => { el.hidden = true; });
    const grip = layout.querySelector('#studio-viewer-height-grip');
    if (grip) grip.hidden = true;
    // CREATOR-10: the viewport changed shape, so the canvas is re-centred.
    recentreViewer();
    renderCanvas();
    return;
  }

  layout.querySelectorAll('.studio-col-resizer').forEach(el => { el.hidden = false; });
  const grip = layout.querySelector('#studio-viewer-height-grip');
  if (grip) grip.hidden = false;

  if (panelWidths) {
    layout.style.setProperty('--studio-col-left', `${panelWidths.left}px`);
    layout.style.setProperty('--studio-col-right', `${panelWidths.right}px`);
  } else {
    layout.style.removeProperty('--studio-col-left');
    layout.style.removeProperty('--studio-col-right');
  }

  // Always seat each handle on the boundary it controls by measuring the panels
  // and the stage that actually rendered, so the handle is correct at every
  // breakpoint and immediately after a drag. Each handle is centred in the gap
  // between the side panel and the stage, so the pointer target sits exactly on
  // the visible boundary.
  const leftPanel = layout.querySelector('#studio-elements');
  const rightPanel = layout.querySelector('#studio-properties-panel');
  const leftHandle = layout.querySelector('#studio-col-resizer-left');
  const rightHandle = layout.querySelector('#studio-col-resizer-right');
  const layoutBox = layout.getBoundingClientRect();
  const stageBox = stage.getBoundingClientRect();
  const midpoint = (a, b) => `${(a + b) / 2 - layoutBox.left}px`;
  if (leftHandle && leftPanel) leftHandle.style.left = midpoint(leftPanel.getBoundingClientRect().right, stageBox.left);
  if (rightHandle && rightPanel) rightHandle.style.right = `${layoutBox.right - (stageBox.right + rightPanel.getBoundingClientRect().left) / 2}px`;

  // CREATOR-07B: the stage ALWAYS gets an explicit height, and that height comes
  // from the viewer's own workspace state only. It is never derived from the
  // side panels (which are separate grid items that scroll internally) and never
  // from the window, so a taller Properties or Profile Sections panel can never
  // make the Profile Viewer half-height.
  stage.style.height = `${clampViewerHeight(viewerHeight, {
    min: MIN_VIEWER_HEIGHT,
    fallback: DEFAULT_VIEWER_HEIGHT,
  })}px`;
  // CREATOR-10: a panel-width or viewer-height change resizes the centre column
  // and/or the viewport, so the canvas is re-centred rather than left wherever
  // the previous view happened to be. Still viewer-only: no design geometry,
  // no dirty flag, no undo entry. Repaint so the new centred transform is
  // actually written — the canvas is a sibling of the stage, so resizing the
  // stage alone leaves the transform untouched.
  recentreViewer();
  renderCanvas();
}

/**
 * A window resize can invalidate a pinned COLUMN layout, so re-clamp the two
 * panels against the new width. The viewer height is deliberately NOT touched:
 * it is independent workspace state, and resizing the window is not a request to
 * change how tall the editing area is (CREATOR-07B).
 */
function clampWorkspaceToWindow() {
  const layout = layoutElement();
  if (layout && panelWidths && !isSingleColumn()) {
    const total = layout.clientWidth;
    const ceiling = Math.max(MIN_PANEL_WIDTH, total - MIN_CENTER_WIDTH);
    const left = clampPanelWidth(panelWidths.left, { min: MIN_PANEL_WIDTH, max: ceiling });
    const right = clampPanelWidth(panelWidths.right, { min: MIN_PANEL_WIDTH, max: Math.max(MIN_PANEL_WIDTH, ceiling - left) });
    panelWidths = { left, right };
  }
  applyWorkspaceState();
}

/**
 * CREATOR-10: keep the canvas centred whenever the viewer's usable size changes.
 *
 * applyWorkspaceState() already re-centres explicitly on a panel drag or a
 * viewer-height drag, but a browser window resize is not enough on its own: the
 * resize event can arrive while the CSS grid is still laid out for the previous
 * window width, so centring in the event handler measures a stale viewport and
 * leaves the canvas tens of pixels off-centre. Chasing it with an extra animation
 * frame is a race, not a guarantee — a scrollbar appearing or a media query
 * flipping can change the centre column again afterwards.
 *
 * Observing the element's real size is the authoritative answer, and it also
 * covers cases no explicit call site knows about (scrollbar changes, a sidebar
 * that re-lays out, single-column mode toggling). The callback only re-centres
 * when the size actually differs from the last observed one, so it settles after
 * a single pass.
 *
 * Re-centring writes only a transform, never a size, so this cannot loop.
 */
let viewerResizeObserver = null;
let lastObservedViewport = { w: 0, h: 0 };

function observeViewerSize() {
  const scroll = root?.querySelector('#studio-canvas-scroll');
  if (!scroll) return;
  try { viewerResizeObserver?.disconnect(); } catch { /* best-effort */ }
  if (typeof ResizeObserver !== 'function') return;
  lastObservedViewport = viewerViewport();
  viewerResizeObserver = new ResizeObserver(() => {
    const v = viewerViewport();
    if (v.w === lastObservedViewport.w && v.h === lastObservedViewport.h) return;
    lastObservedViewport = v;
    if (!(v.w > 0) || !(v.h > 0)) return;
    recentreViewer();
    renderCanvas();
  });
  viewerResizeObserver.observe(scroll);
}

function stopObservingViewerSize() {
  try { viewerResizeObserver?.disconnect(); } catch { /* best-effort */ }
  viewerResizeObserver = null;
  lastObservedViewport = { w: 0, h: 0 };
}

function startPanelResize(edge, event) {
  const layout = layoutElement();
  if (!layout || isSingleColumn()) return;
  const left = layout.querySelector('#studio-elements');
  const right = layout.querySelector('#studio-properties-panel');
  if (!left || !right) return;
  drag = {
    mode: 'panel-resize',
    id: null,
    edge,
    pointerClientX: event.clientX,
    startClientX: event.clientX,
    startLeft: left.getBoundingClientRect().width,
    startRight: right.getBoundingClientRect().width,
    totalWidth: layout.clientWidth,
  };
  root?.classList.add('studio-workspace-resizing');
  setStatus('Resizing the workspace panels — the saved design is unchanged.');
}

function startViewerHeightResize(event) {
  const stage = stageElement();
  const viewer = viewerElement();
  if (!stage || !viewer || isSingleColumn()) return;
  // Measure the STAGE, because that is the box whose height this state owns.
  // The viewer fills the stage below the zoom bar, so a delta applied to the
  // stage is exactly the delta the creator sees on the viewer's bottom edge.
  drag = {
    mode: 'viewer-height',
    id: null,
    pointerClientY: event.clientY,
    startClientY: event.clientY,
    startHeight: stage.getBoundingClientRect().height,
  };
  root?.classList.add('studio-workspace-resizing');
  setStatus('Resizing the viewer height — the saved design is unchanged.');
}


/**
 * CREATOR-09: build ONE guide card — a labelled wireframe block marking where a
 * real profile section belongs. It is built with element APIs and `textContent`
 * from the server-known section registry, never innerHTML, so a stored section
 * id can express a label and nothing else.
 *
 * The card is deliberately NOT dressed like a finished profile card: it has a
 * dashed outline, a translucent fill, an uppercase section label and a
 * "Guide Area" hint, so it always reads as a placement guide.
 */
function buildGuideCardNode(el, comp) {
  const section = comp.config && comp.config.section;
  el.classList.add('studio-guide-card');

  const label = document.createElement('span');
  label.className = 'studio-guide-card-label';
  label.textContent = guideSectionLabel(section).toUpperCase();
  el.appendChild(label);

  const area = document.createElement('span');
  area.className = 'studio-guide-card-area';
  area.textContent = 'Guide Area';
  el.appendChild(area);
}

/**
 * CREATOR-08's legacy single-block guide. Rendered only for a design that has
 * not yet been migrated, so an un-migrated design is still visible rather than
 * blank while it loads.
 */
function buildLegacyGuideNode(el, comp) {
  const pattern = guidePattern(comp.config && comp.config.pattern);
  const inner = document.createElement('div');
  inner.className = 'studio-guide-inner';

  const title = document.createElement('div');
  title.className = 'studio-guide-title';
  title.textContent = `Profile Guide — ${pattern.label}`;
  inner.appendChild(title);

  for (const card of pattern.cards) {
    const row = document.createElement('div');
    row.className = 'studio-guide-block';
    // A block is sized as a fraction of the guide box so it stays proportional
    // when the creator resizes the guide.
    row.style.height = `${(card.height / 1200) * 100}%`;
    const label = document.createElement('span');
    label.className = 'studio-guide-label';
    label.textContent = guideSectionLabel(card.section);
    row.appendChild(label);
    inner.appendChild(row);
  }
  el.appendChild(inner);
}

// ── CREATOR-11: containers (Card → Image / Sticker) ───────────────────────────

/** The card a component is nested inside, or null. */
function parentCardOf(comp) {
  if (!comp || typeof comp.parentId !== 'string' || !comp.parentId) return null;
  const parent = components().find(c => c.id === comp.parentId);
  if (!parent || !CARD_PARENT_TYPES.has(parent.type)) return null;
  return CARD_CHILD_TYPES.has(comp.type) ? parent : null;
}

/** True when the component is nested inside a card. */
function isNested(comp) {
  return !!parentCardOf(comp);
}

/** Direct children of a card id, in stable order. */
function childrenOf(cardId) {
  return components().filter(c => c.parentId === cardId);
}

/**
 * The absolute design position of a component. A child stores LOCAL coordinates
 * inside its card, so every canvas-level calculation (drag, resize, drop, arrow
 * keys) has to add the card's own origin. Keeping this in one place is what stops
 * a child from jumping when its parent moves.
 */
function absolutePosition(comp) {
  const card = parentCardOf(comp);
  if (!card) return { x: comp.x, y: comp.y };
  return { x: card.x + comp.x, y: card.y + comp.y };
}

// CREATOR-13: prefersReducedMotion() is imported from the renderer, so the Studio
// and the public profile can never disagree about the accessibility preference.

function buildContentNode(el, comp) {
  const config = comp.config || {};
  if (comp.type === GUIDE_CARD_COMPONENT_TYPE) {
    buildGuideCardNode(el, comp);
  } else if (comp.type === LEGACY_GUIDE_COMPONENT_TYPE) {
    buildLegacyGuideNode(el, comp);
  } else if (comp.type === 'image' || comp.type === 'sticker') {
    const inner = document.createElement('div');
    inner.className = 'design-image-inner';
    const img = document.createElement('img');
    img.alt = config.alt || '';
    img.referrerPolicy = 'no-referrer';
    img.className = `design-image-fit-${['cover', 'contain', 'fill'].includes(config.fit) ? config.fit : 'cover'}`;
    if (config.backgroundColor) inner.style.backgroundColor = config.backgroundColor;
    img.addEventListener('error', () => inner.classList.add('design-image-broken'), { once: true });
    if (!config.imageUrl) inner.classList.add('design-image-broken');
    img.src = config.imageUrl || '';
    inner.appendChild(img);
    el.appendChild(inner);
  } else if (comp.type === 'text') {
    const span = document.createElement('div');
    span.className = 'design-text-content';
    span.textContent = config.text || '';
    // CREATOR-11: one shared typography helper, so the Studio preview and the
    // public profile resolve a font id to the same CSS stack.
    applyTypographyToElement(span, config);
    el.appendChild(span);
  } else if (comp.type === 'card') {
    // CREATOR-11: a card is a container. Children mount into `.design-card-surface`
    // rather than the card box, because a component's resize handles sit 6px
    // outside its own box and clipping the card would make them unreachable. The
    // surface carries the mask; the card box stays unclipped.
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
  // CREATOR-11: animation is presentation only — it never touches geometry, so
  // it is applied after the element is built and is safe to leave running while
  // the creator drags something else.
  applyAnimationToElement(el, config.animation, { reducedMotion: prefersReducedMotion() });
}

function appendHandles(el) {
  el.classList.add('studio-selected');
  HANDLE_DIRS.forEach(dir => {
    const handle = document.createElement('div');
    handle.className = `studio-handle studio-handle-${dir}`;
    handle.dataset.resize = dir;
    el.appendChild(handle);
  });
}

function buildComponentNode(comp, { interactive = true } = {}) {
  const el = document.createElement('div');
  el.dataset.compId = comp.id;
  // CREATOR-08: expose the type so the guide can be identified in the DOM
  // without matching on its label or class.
  el.dataset.compType = comp.type;
  if (typeof comp.parentId === 'string' && comp.parentId) el.dataset.parentId = comp.parentId;

  if (CONTROLLED_TYPES.has(comp.type)) {
    const meta = CONTROLLED_SECTIONS.find(s => s.type === comp.type);
    el.className = 'studio-comp studio-section-box';
    el.innerHTML = `<span class="studio-section-icon">${SECTION_ICONS[comp.type] || ''}</span>
      <span class="studio-section-label">${meta ? meta.label : comp.type}</span>
      <span class="studio-section-hint">${meta ? meta.hint : ''}</span>`;
  } else {
    el.className = `studio-comp design-component design-${comp.type}`;
    buildContentNode(el, comp);
  }

  if (isNested(comp)) {
    // CREATOR-11: local coordinates inside the card. The card is the positioning
    // context, so the stored x/y are used verbatim — the card's own origin is
    // applied once, by the card's own geometry.
    el.style.position = 'absolute';
    el.style.left = `${comp.x}px`;
    el.style.top = `${comp.y}px`;
    el.style.width = `${comp.width}px`;
    el.style.height = `${comp.height}px`;
    el.style.zIndex = String(numOr(comp.zIndex, 0));
    el.style.display = comp.visible === false ? 'none' : '';
  } else {
    applyGeometryToElement(el, comp, { applyVisibility: false });
  }
  applyCommonStyleToElement(el, comp.style);
  if (comp.visible === false) el.classList.add('studio-comp-hidden');
  if (comp.locked) el.classList.add('studio-comp-locked');
  // CREATOR-15: a Version History preview is read-only, so it never
  // carries selection handles even when a component of the same id is
  // selected in the editor.
  if (interactive && !previewMode && comp.id === selectedId) appendHandles(el);
  return el;
}

/**
 * CREATOR-10: the Profile Viewer's base structure — a faithful, editable
 * representation of the REAL public profile, drawn from PROFILE_LAYOUT.
 *
 * Before CREATOR-10 the canvas was a plain surface with unrelated placeholder
 * boxes floating on it, so a creator had no idea what their profile would
 * actually look like. This replaces that with the real thing:
 *
 *   PROFILE BACKGROUND  → the outer area an uploaded background sits behind
 *   MAIN PROFILE        → the wide left column
 *   SIDEBAR             → the narrow right column, its own separate area
 *   one card per module → Friend Space, Photo Gallery, Video Box, Music,
 *                         Scraps (and Communities) each INDEPENDENT
 *
 * The whole layer is Studio-only chrome. It is never saved with the design, is
 * never a component, is not selectable, and is hidden in Preview — which
 * represents the real published page. Every box is `pointer-events: none` so it
 * can never swallow a drag, a selection or a resize handle.
 */
function buildProfileSkeleton() {
  const layer = document.createElement('div');
  layer.className = 'studio-profile-skeleton';
  layer.id = 'studio-profile-skeleton';
  layer.setAttribute('aria-hidden', 'true');

  const place = (el, box) => {
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
    return el;
  };

  const tag = (text) => {
    const span = document.createElement('span');
    span.className = 'studio-skeleton-label';
    span.textContent = text;
    return span;
  };

  // The outer Profile Background area, behind absolutely everything.
  const bg = document.createElement('div');
  bg.className = 'studio-skeleton-bg';
  bg.dataset.skeleton = 'background';
  place(bg, PROFILE_LAYOUT.background);
  bg.appendChild(tag('PROFILE BACKGROUND'));
  layer.appendChild(bg);

  // The two real columns, drawn as separate areas.
  for (const [name, key] of [['main', 'main'], ['sidebar', 'sidebar']]) {
    const column = document.createElement('div');
    column.className = `studio-skeleton-column studio-skeleton-${name}`;
    column.dataset.skeleton = name;
    place(column, PROFILE_LAYOUT[key]);
    column.appendChild(tag(name === 'main' ? 'MAIN PROFILE' : 'SIDEBAR'));
    layer.appendChild(column);
  }

  // Every real profile module, each as its OWN card. Sidebar modules are never
  // merged into a single sidebar block.
  for (const section of [...PROFILE_MAIN_SECTIONS, ...PROFILE_SIDEBAR_SECTIONS]) {
    const card = document.createElement('div');
    const column = GUIDE_SECTION_COLUMN[section] || 'main';
    card.className = `studio-skeleton-card studio-skeleton-card-${column}`;
    card.dataset.skeletonModule = section;
    card.dataset.skeletonColumn = column;
    place(card, PROFILE_LAYOUT.modules[section]);
    card.appendChild(tag(guideSectionLabel(section).toUpperCase()));
    layer.appendChild(card);
  }

  return layer;
}

/**
 * CREATOR-10C: render the Profile Background IMAGE and EFFECT inside the design
 * canvas.
 *
 * The background is a layer of the 960x1200 design, not a viewer-wide backdrop:
 * a creator sees their image as the profile's own bounded background, sitting on
 * the plain canvas surface, with the module outlines drawn over it. Painting it
 * across the whole viewer instead made it read as escaping the canvas and
 * smeared the image under the studio chrome, so the profile structure became
 * much harder to read over a busy picture.
 *
 * Neither layer is a component: no geometry, no data-comp-id, pointer-events
 * none, and absent from Layers. Both always exist and carry a `none` state, so
 * "is anything active?" is a single readable value in the DOM either way.
 *
 * CREATOR-15: the theme and canvas are PARAMETERS with the live design as
 * the default, so a Version History preview renders a stored version's own
 * background and effect through this same layer builder — the same renderer
 * the canvas and the public profile use, never a second one.
 */
function renderStudioProfileLayers(doc, theme = designTheme(), c = canvas()) {
  const url = theme && typeof theme.backgroundImage === 'string' ? theme.backgroundImage : '';
  // The effect is a profile-wide layer too, so it shares the canvas and the same
  // design bounds.
  const effect = theme && typeof theme.backgroundEffect === 'object' ? theme.backgroundEffect : null;
  const effectActive = !!effect && effect.enabled !== false && !!effect.effectId;
  if (!doc) return;

  const canvasH = Math.max(c.minHeight, PROFILE_LAYOUT.background.height);

  // The canvas stops painting its own light surface when a background is really
  // behind it, so the picture is not hidden by it.
  doc.classList.toggle('studio-canvas-transparent', !!url);

  const imgLayer = document.createElement('div');
  imgLayer.className = 'studio-profile-background';
  imgLayer.id = 'studio-profile-background';
  imgLayer.dataset.profileBackground = url ? 'set' : 'none';
  if (url) {
    // Rendered through a real <img> so the ORIGINAL uploaded file is what the
    // browser scales — no rasterising, no re-encoding, no canvas round-trip.
    const img = document.createElement('img');
    img.className = 'studio-profile-background-img';
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    img.style.objectFit = backgroundSizeCss(theme.backgroundSize);
    img.style.objectPosition = theme.backgroundPosition || 'center';
    imgLayer.appendChild(img);
  }
  doc.appendChild(imgLayer);

  const effectLayer = document.createElement('div');
  effectLayer.className = 'studio-profile-effect-layer';
  effectLayer.id = 'studio-profile-effect-layer';
  effectLayer.setAttribute('aria-hidden', 'true');
  effectLayer.dataset.profileEffect = effectActive ? effect.effectId : 'none';
  doc.appendChild(effectLayer);
  if (!effectActive) return;

  // The renderer needs a live, sized node, so this runs once it is attached. The
  // bounds are the DESIGN CANVAS, so the preview matches the published geometry.
  queueMicrotask(() => {
    if (!effectLayer.isConnected) return;
    applyProfileBackgroundEffect(effect, {
      layer: effectLayer,
      creatorEffect: installedEffectDefinition(effect.effectId),
      bounds: { width: c.width, height: canvasH },
    });
  });
}

/**
 * CREATOR-15: build the design document — the DOM representation
 * of a design's layout and theme at the design's own canvas size.
 *
 * This is the ONE document builder for the design model. The live
 * Studio canvas, the Preview toggle and the Version History preview
 * all render through it, so a stored version previews exactly as the
 * canvas renders the live design: same background image and effect
 * layers, same profile skeleton, same component nodes, same nesting.
 *
 * `layout` and `theme` are explicit parameters so a caller can
 * render ANY stored design (a historical version) without touching
 * the editor's current state.
 *
 * `interactive: false` renders read-only: no selection handles and
 * no canvas-only element ids, for a document that lives outside the
 * canvas. `includeSkeleton` defaults to the live-canvas behaviour
 * (Studio chrome on, hidden in Preview); a Version History preview
 * passes true to show the same module structure the editor shows.
 */
function buildDesignDocument(layoutObj, themeObj, { interactive = true, includeSkeleton = null, emptyMessage = null } = {}) {
  const c = (layoutObj && typeof layoutObj.canvas === 'object' && layoutObj.canvas)
    ? layoutObj.canvas
    : { width: 960, minHeight: 1200 };
  const doc = document.createElement('div');
  doc.className = 'studio-canvas-document';
  doc.style.width = `${c.width}px`;
  doc.style.minHeight = `${c.minHeight}px`;

  const ordered = [...((layoutObj && Array.isArray(layoutObj.components)) ? layoutObj.components : [])]
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  if (ordered.length === 0 && emptyMessage) {
    const empty = document.createElement('div');
    empty.className = 'studio-canvas-empty';
    empty.textContent = emptyMessage;
    doc.appendChild(empty);
  }

  // CREATOR-10C: the Profile Background image and effect are layers OF the design
  // canvas, drawn first so the profile structure, guide cards and components all
  // sit on top of them.
  renderStudioProfileLayers(doc, themeObj, c);

  // CREATOR-10: the real profile structure is drawn FIRST, so every component
  // sits on top of it. It is Studio-only editing chrome, so Preview leaves it
  // out — exactly the exclusion the public profile renderer applies.
  const showSkeleton = includeSkeleton === null ? (interactive && !previewMode) : includeSkeleton;
  if (showSkeleton) doc.appendChild(buildProfileSkeleton());

  // CREATOR-09: guide cards are a Studio-only aid. Preview represents the real
  // published profile, so no guide is drawn there — exactly as the public
  // profile renderer excludes them. The components themselves are untouched and
  // still saved with the design.
  const visible = showSkeleton
    ? ordered
    : ordered.filter(comp => !GUIDE_COMPONENT_TYPES.has(comp.type));

  // CREATOR-11: mount containers before their children, then nest each child
  // INSIDE its card element so the card's box genuinely clips it. A child whose
  // card is missing (an invalid relationship the server would reject) still
  // renders, un-nested, rather than disappearing.
  const nodes = new Map();
  const nested = visible.filter(comp => isNested(comp));
  const topLevel = visible.filter(comp => !isNested(comp));
  for (const comp of topLevel) {
    const node = buildComponentNode(comp, { interactive });
    doc.appendChild(node);
    nodes.set(comp.id, node);
  }
  for (const comp of nested) {
    const parentNode = nodes.get(comp.parentId);
    // Mount into the card's masking surface, matching the public renderer exactly.
    const surface = parentNode ? (parentNode.querySelector(':scope > .design-card-surface')) : null;
    const node = buildComponentNode(comp, { interactive });
    if (surface) surface.appendChild(node);
    else if (parentNode) parentNode.appendChild(node);
    else doc.appendChild(node);
    nodes.set(comp.id, node);
  }

  if (!interactive) {
    // A preview document is not THE canvas: drop the canvas-only ids
    // so a preview never duplicates the live canvas's element ids.
    for (const layer of doc.querySelectorAll('#studio-profile-background, #studio-profile-effect-layer')) {
      layer.removeAttribute('id');
    }
  }
  return doc;
}

function renderCanvas() {
  const inner = root?.querySelector('#studio-canvas-inner');
  if (!inner || !currentDesign) return;

  const c = canvas();
  // CREATOR-09: state the real design canvas size. It tracks layout.canvas, so
  // editing the canvas width/height in Properties updates it immediately.
  const sizeLabel = root?.querySelector('#studio-canvas-size');
  if (sizeLabel) sizeLabel.textContent = `Canvas ${c.width} × ${c.minHeight} px`;

  const doc = buildDesignDocument(layout(), designTheme(), {
    emptyMessage: 'Your profile is empty. Click a section or "+" in the Elements panel to place it, or drag it onto the canvas.',
  });
  doc.id = 'studio-canvas-document';

  const zoomLayer = document.createElement('div');
  zoomLayer.id = 'studio-zoom-layer';
  zoomLayer.style.transform = viewerTransform({ zoom, panX: viewerPan.x, panY: viewerPan.y });
  zoomLayer.appendChild(doc);
  inner.replaceChildren(zoomLayer);
}

/**
 * Build one Layers row for a component. Shared by the flat and nested paths so a
 * row behaves identically wherever it appears.
 */
function buildLayerRow(comp, depth) {
  const row = document.createElement('div');
  row.className = `studio-layer-row${comp.id === selectedId ? ' studio-layer-selected' : ''}`;
  row.dataset.layerId = comp.id;
  if (depth > 0) {
    row.classList.add('studio-layer-child');
    row.style.paddingLeft = `${depth * 1.1}rem`;
  }

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'studio-layer-name';
  name.dataset.action = 'select';
  name.title = 'Select on canvas';
  // Nesting is shown structurally, not by flattening: a child is indented under
  // its card so the container relationship is visible at a glance.
  const marker = isNested(comp) ? '↳ ' : '';
  name.textContent = `${marker}${labelOf(comp)}`;
  if (!comp.visible) name.textContent = `· ${name.textContent}`;
  row.appendChild(name);

  const z = document.createElement('input');
  z.type = 'number';
  z.className = 'studio-layer-z';
  z.value = String(comp.zIndex ?? 0);
  z.min = 0;
  z.max = 10000;
  z.title = 'Z-index (higher = on top)';
  row.appendChild(z);

  const actions = document.createElement('div');
  actions.className = 'studio-layer-actions';
  [
    ['back', 'To bottom', 'Bot'],
    ['backward', 'Send backward', 'Back'],
    ['forward', 'Bring forward', 'Fwd'],
    ['front', 'To top', 'Top'],
    ['toggle-visibility', comp.visible ? 'Hide' : 'Show', 'Eye'],
    ['toggle-lock', comp.locked ? 'Unlock' : 'Lock', 'Lock'],
    ['duplicate', 'Duplicate', 'Dup'],
    ['delete', 'Delete', 'Del'],
  ].forEach(([action, title, text]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'studio-layer-action';
    button.dataset.action = action;
    button.title = title;
    button.textContent = text;
    actions.appendChild(button);
  });
  row.appendChild(actions);
  return row;
}

function renderLayers() {
  const list = root?.querySelector('#studio-layers-list');
  if (!list) return;
  const ordered = [...components()].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  if (ordered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'studio-empty-note';
    empty.textContent = 'No components yet — add one from the Elements panel.';
    list.replaceChildren(empty);
    return;
  }

  // CREATOR-11: emit containers first, each immediately followed by its own
  // children, so the panel reads as a hierarchy instead of an unrelated list.
  const emitted = new Set();
  const frag = document.createDocumentFragment();
  for (const comp of ordered) {
    if (emitted.has(comp.id)) continue;
    if (isNested(comp)) continue; // emitted with its card below
    emitted.add(comp.id);
    frag.appendChild(buildLayerRow(comp, 0));
    for (const child of childrenOf(comp.id).sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))) {
      emitted.add(child.id);
      frag.appendChild(buildLayerRow(child, 1));
    }
  }
  // Defensive: anything not reachable through a valid parent (which the server
  // would reject) still appears, rather than becoming unreachable in the UI.
  for (const comp of ordered) {
    if (!emitted.has(comp.id)) frag.appendChild(buildLayerRow(comp, 0));
  }
  list.replaceChildren(frag);
}

// ── Properties panel ─────────────────────────────────────────────────────────
function fieldRow(labelText, control) {
  const row = document.createElement('div');
  row.className = 'studio-prop-row';
  const label = document.createElement('label');
  label.className = 'studio-prop-label';
  label.textContent = labelText;
  row.appendChild(label);
  row.appendChild(control);
  return row;
}

function sectionTitle(text) {
  const heading = document.createElement('h3');
  heading.className = 'studio-prop-section';
  heading.textContent = text;
  return heading;
}

/**
 * CREATOR-09 §12: keep the Properties geometry fields showing the component's
 * real geometry while it is dragged or resized on the canvas.
 *
 * There is exactly ONE authoritative geometry — the component object — so this
 * only ever mirrors that object into the already-rendered inputs. The panel is
 * deliberately NOT rebuilt (rebuilding would blur the field the creator may be
 * typing into), and a field that currently has focus is left alone.
 */
function syncGeometryFields(comp) {
  if (!comp) return;
  const panel = root?.querySelector('#studio-properties');
  if (!panel) return;
  const title = panel.querySelector('.studio-prop-id');
  // Only mirror into the panel that is actually showing this component.
  if (!title || title.textContent !== `id: ${comp.id}`) return;
  panel.querySelectorAll('input[data-prop-path]').forEach(input => {
    if (document.activeElement === input) return;
    const value = getPath(comp, input.dataset.propPath);
    const next = value === null || value === undefined ? '' : String(value);
    if (input.value !== next) input.value = next;
  });
}

function numberField(comp, path, { min = -Infinity, max = Infinity, step = 'any', integer = false } = {}) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
  // CREATOR-12: publish the bounds the field already enforces on the value, so
  // the control is self-describing — the spinner cannot step past a validated
  // range, and a bounded schema (an effect's config) is visible as a range rather
  // than being an invisible clamp.
  if (Number.isFinite(min)) input.min = String(min);
  if (Number.isFinite(max)) input.max = String(max);
  // CREATOR-09: tag the control with the property it edits so a canvas drag can
  // keep the displayed geometry in step without rebuilding the panel (which
  // would steal focus and interrupt typing).
  input.dataset.propPath = path;
  const current = getPath(comp, path);
  input.value = current === null || current === undefined ? '' : String(current);
  input.addEventListener('input', () => {
    if (input.value === '') {
      setPath(comp, path, undefined);
      markChanged();
      return;
    }
    let value = parseFloat(input.value);
    if (!Number.isFinite(value)) return;
    value = clamp(value, min, max);
    if (integer) value = Math.round(value);
    setPath(comp, path, value);
    markChanged();
  });
  return input;
}

function textField(comp, path, { max, rows = 2, trim = false } = {}) {
  const input = document.createElement('textarea');
  input.rows = rows;
  if (max) input.maxLength = max;
  input.value = getPath(comp, path) ?? '';
  input.addEventListener('input', () => {
    let value = input.value;
    if (trim) value = value.trim();
    setPath(comp, path, value);
    markChanged();
  });
  return input;
}

function singleLineField(comp, path, { max, trim = false } = {}) {
  const input = document.createElement('input');
  input.type = 'text';
  if (max) input.maxLength = max;
  input.value = getPath(comp, path) ?? '';
  input.addEventListener('input', () => {
    let value = input.value;
    if (trim) value = value.trim();
    setPath(comp, path, value);
    markChanged();
  });
  return input;
}

function selectField(comp, path, options, { labels = [] } = {}) {
  const select = document.createElement('select');
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Default';
  select.appendChild(empty);
  options.forEach((option, index) => {
    const el = document.createElement('option');
    el.value = option;
    // CREATOR-08: a guide shows readable pattern names, not raw ids.
    el.textContent = labels[index] || option;
    select.appendChild(el);
  });
  select.value = getPath(comp, path) ?? '';
  select.addEventListener('change', () => {
    setPath(comp, path, select.value === '' ? undefined : select.value);
    markChanged();
  });
  return select;
}

function toggleField(comp, path) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!getPath(comp, path);
  input.addEventListener('change', () => {
    setPath(comp, path, input.checked);
    markChanged();
  });
  return input;
}

function colorField(comp, path) {
  const wrap = document.createElement('span');
  wrap.className = 'studio-color-field';
  const input = document.createElement('input');
  input.type = 'color';
  const current = getPath(comp, path);
  input.value = /^#[0-9a-fA-F]{6}$/.test(current || '') ? current : '#000000';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'studio-color-clear';
  clear.title = 'Reset to default';
  clear.textContent = '×';
  input.addEventListener('input', () => {
    setPath(comp, path, input.value);
    markChanged();
  });
  clear.addEventListener('click', () => {
    setPath(comp, path, '');
    input.value = '#000000';
    markChanged();
  });
  wrap.append(input, clear);
  return wrap;
}

/**
 * Image Source control (CREATOR-06) for image/sticker components: Upload
 * Image button + live preview next to the existing URL field. Uploading
 * places the returned application URL into config.imageUrl, marks the
 * design changed, and refreshes the canvas preview immediately. Alt text
 * and fit mode are preserved untouched.
 */
function imageSourceField(comp) {
  const wrap = document.createElement('div');
  wrap.className = 'studio-image-source';

  const label = document.createElement('span');
  label.className = 'studio-prop-label';
  label.textContent = 'Image Source';
  wrap.appendChild(label);

  const preview = document.createElement('img');
  preview.className = 'studio-image-preview';
  preview.alt = '';
  const currentUrl = getPath(comp, 'config.imageUrl') || '';
  if (currentUrl) {
    preview.src = currentUrl;
  } else {
    preview.hidden = true;
  }
  preview.addEventListener('error', () => { preview.hidden = true; });
  wrap.appendChild(preview);

  const row = document.createElement('div');
  row.className = 'studio-image-row';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
  fileInput.hidden = true;

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'btn btn-secondary studio-upload-btn';
  uploadBtn.textContent = 'Upload Image';
  uploadBtn.addEventListener('click', () => fileInput.click());

  const status = document.createElement('p');
  status.className = 'studio-prop-hint studio-upload-status';
  status.textContent = 'JPG, PNG or WebP, up to 5 MB.';

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    uploadBtn.disabled = true;
    status.textContent = 'Uploading…';
    try {
      const url = await uploadStudioImage(file);
      setPath(comp, 'config.imageUrl', url);
      markChanged();
      renderProperties();
      setStatus('Image uploaded and placed into the component.');
    } catch (err) {
      status.textContent = err.message || 'Upload failed. Try a JPG, PNG, or WebP image.';
    } finally {
      uploadBtn.disabled = false;
    }
  });

  row.appendChild(uploadBtn);
  wrap.appendChild(row);
  wrap.appendChild(fileInput);
  wrap.appendChild(status);
  return wrap;
}

/**
 * POST a local image file to /api/creator/media and return the application
 * URL. Client-side checks (extension/size) are UX hints only — the server
 * re-validates everything, including actual file content.
 */
async function uploadStudioImage(file) {
  if (!/\.(jpe?g|png|webp)$/i.test(file.name || '')) {
    throw new Error('Unsupported file type. Use JPG, PNG, or WebP.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('File too large. Maximum size is 5 MB.');
  }
  const form = new FormData();
  form.append('image', file);
  const token = typeof getAccessToken === 'function' ? getAccessToken() : null;
  const response = await fetch('/api/creator/media', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new Error('Upload failed. Please try again.');
  }
  if (!response.ok || !data || !data.url) {
    throw new Error((data && data.error && data.error.message) || 'Upload failed. Please try again.');
  }
  return data.url;
}

function getPath(object, path) {
  return path.split('.').reduce((o, key) => (o === null || o === undefined ? o : o[key]), object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  let o = object;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

/**
 * CREATOR-10A: Profile Background control with an EXPLICIT active state.
 *
 * The storage model is unchanged from CREATOR-10 — the background is still
 * design-level theme configuration, never a component — but the creator can now
 * tell at a glance which of the four states they are in, instead of having to
 * infer it from a preview image:
 *
 *   none      NOT SET                  no background, nothing waiting
 *   pending   UPLOADED — NOT ACTIVE    an image is staged; the profile is unchanged
 *   active    ACTIVE                   this image is the live profile background
 *   replace   REPLACEMENT READY        an active background, plus a staged swap
 *
 * The apply action only appears when it would actually do something: with an
 * already-active background and nothing staged there is no "Set as Profile
 * Background" button sitting there looking actionable, because the image it
 * would apply is the one already in use.
 *
 * It is NOT an ordinary `image` component: it writes design-level theme
 * configuration, so it is never a small content card, never selectable on the
 * canvas, and never dragged or resized. The upload goes through the existing
 * Creator Studio endpoint, so the server re-validates the real file content
 * (JPEG/PNG/WebP only) exactly as it does for any other studio image.
 */
function profileBackgroundProperties(frag) {
  const theme = designTheme();
  const state = backgroundState();
  const isActive = !!state.active;

  // ── Section header with the state chip ──
  const head = document.createElement('div');
  head.className = 'studio-bg-head';
  const heading = document.createElement('h3');
  heading.className = 'studio-prop-section';
  heading.textContent = 'Profile Background';
  const chip = document.createElement('span');
  chip.className = `studio-bg-chip studio-bg-chip-${state.key}`;
  chip.id = 'studio-background-state';
  // data-state mirrors the chip for assertions, but the visible TEXT is what a
  // creator actually reads.
  chip.dataset.state = state.key;
  chip.textContent = state.key === 'active' ? '✓ ACTIVE' : state.label;
  head.append(heading, chip);
  frag.appendChild(head);

  // ── Preview: the ACTIVE image, clearly labelled as such ──
  // The preview element describes the ACTIVE background only, deliberately not
  // the overall state: when a replacement is staged, the preview still shows the
  // background that is genuinely live.
  const preview = document.createElement('div');
  preview.className = 'studio-bg-preview';
  preview.dataset.profileBackgroundPreview = isActive ? 'active' : 'none';
  if (isActive) {
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = state.active;
    img.style.objectFit = backgroundSizeCss(theme.backgroundSize);
    preview.appendChild(img);
    const tag = document.createElement('span');
    tag.className = 'studio-bg-preview-tag studio-bg-preview-tag-active';
    tag.textContent = 'ACTIVE BACKGROUND';
    preview.appendChild(tag);
  } else {
    const none = document.createElement('span');
    none.className = 'studio-bg-preview-empty';
    none.id = 'studio-background-empty';
    none.textContent = 'No Profile Background. Your profile uses the platform theme background.';
    preview.appendChild(none);
  }
  frag.appendChild(preview);

  // ── A staged upload is shown SEPARATELY and marked as not yet active ──
  if (state.pending) {
    const pendingBox = document.createElement('div');
    pendingBox.className = 'studio-bg-pending';
    pendingBox.id = 'studio-background-pending';
    pendingBox.dataset.pending = 'true';
    const thumb = document.createElement('img');
    thumb.alt = '';
    thumb.referrerPolicy = 'no-referrer';
    thumb.src = state.pending;
    thumb.className = 'studio-bg-pending-thumb';
    const label = document.createElement('span');
    label.className = 'studio-bg-pending-label';
    label.id = 'studio-background-pending-label';
    label.textContent = isActive
      ? 'Uploaded — ready to REPLACE the active background. Not applied yet.'
      : 'Uploaded — ready to set as your Profile Background. Not active yet.';
    pendingBox.append(thumb, label);
    frag.appendChild(pendingBox);
  }

  // ── File input + actions ──
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
  fileInput.hidden = true;
  fileInput.id = 'studio-background-file';

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.id = 'studio-background-upload';
  uploadBtn.className = 'btn btn-secondary studio-upload-btn';
  uploadBtn.textContent = 'Upload Image';
  uploadBtn.title = 'Choose a JPG, JPEG, PNG or WebP image';
  uploadBtn.addEventListener('click', () => fileInput.click());

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.id = 'studio-background-apply';
  applyBtn.className = 'btn btn-primary studio-upload-btn';
  // Only offer the apply action when a staged image is genuinely waiting.
  const replacing = state.key === 'replace';
  applyBtn.textContent = replacing ? 'Replace Profile Background' : 'Set as Profile Background';
  applyBtn.hidden = !state.pending;
  applyBtn.disabled = !state.pending;
  applyBtn.title = replacing
    ? 'Make the uploaded image the profile background, replacing the current one'
    : 'Make the uploaded image the profile background';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.id = 'studio-background-clear';
  clearBtn.className = 'btn btn-secondary studio-upload-btn';
  clearBtn.textContent = 'Remove';
  clearBtn.hidden = !isActive;
  clearBtn.disabled = !isActive;
  clearBtn.title = 'Remove the active profile background';

  const row = document.createElement('div');
  row.className = 'studio-image-row';
  row.append(uploadBtn, applyBtn, clearBtn);

  // ── Status line: states the situation in words ──
  const status = document.createElement('p');
  status.className = 'studio-upload-status';
  status.id = 'studio-background-status';
  status.textContent = {
    none: 'No Profile Background is set. Upload a JPG, JPEG, PNG or WebP (up to 5 MB) to add one.',
    pending: 'Image uploaded. Ready to set as Profile Background — it is not active until you apply it.',
    active: `Profile background is active and sits behind the entire profile, including the sidebar. Use "Upload Image" to replace it.`,
    replace: 'Replacement uploaded. Choose "Replace Profile Background" to apply it; the current background stays active until then.',
  }[state.key];

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    uploadBtn.disabled = true;
    status.textContent = 'Uploading…';
    try {
      // Staged only. An upload NEVER changes the active background on its own.
      pendingBackgroundUrl = await uploadStudioImage(file);
    } catch (err) {
      pendingBackgroundUrl = '';
      pendingUploadError = err.message || 'Upload failed. Try a JPG, JPEG, PNG, or WebP image.';
    } finally {
      uploadBtn.disabled = false;
    }
    renderProperties();
  });

  applyBtn.addEventListener('click', () => {
    const next = pendingBackgroundUrl || backgroundImageUrl();
    if (!next) return;
    pushHistory();
    const t = designTheme();
    const wasActive = !!backgroundImageUrl();
    t.backgroundImage = next;
    // Sensible presentation defaults the first time a background is applied.
    if (!t.backgroundSize) t.backgroundSize = 'cover';
    if (!t.backgroundPosition) t.backgroundPosition = 'center';
    if (!t.backgroundRepeat) t.backgroundRepeat = 'no-repeat';
    pendingBackgroundUrl = '';
    markChanged(wasActive
      ? 'Profile background replaced. It sits behind the whole profile, including the sidebar.'
      : 'Profile background is active. It sits behind the whole profile, including the sidebar.');
    renderProperties();
  });

  clearBtn.addEventListener('click', () => {
    if (!backgroundImageUrl()) return;
    pushHistory();
    const t = designTheme();
    delete t.backgroundImage;
    pendingBackgroundUrl = '';
    markChanged('Profile background removed. Your profile uses the platform theme background.');
    renderProperties();
  });

  frag.appendChild(row);
  frag.appendChild(fileInput);
  frag.appendChild(status);
  if (pendingUploadError) {
    const errLine = document.createElement('p');
    errLine.className = 'studio-prop-hint studio-bg-error';
    errLine.id = 'studio-background-error';
    errLine.textContent = pendingUploadError;
    pendingUploadError = '';
    frag.appendChild(errLine);
  }

  // ── Presentation controls, scoped to the ACTIVE background ──
  // Greyed out with no background, so they never read as unrelated generic
  // theme settings that happen to sit under a Profile Background heading.
  const sizeField = selectField(theme, 'backgroundSize', PROFILE_BACKGROUND_SIZES, {
    labels: ['Cover', 'Contain', 'Stretch'],
  });
  const positionField = selectField(theme, 'backgroundPosition', PROFILE_BACKGROUND_POSITIONS);
  const repeatField = selectField(theme, 'backgroundRepeat', PROFILE_BACKGROUND_REPEATS);
  for (const [field, label] of [[sizeField, 'Size'], [positionField, 'Position'], [repeatField, 'Repeat']]) {
    field.disabled = !isActive;
    field.title = isActive
      ? `How the ACTIVE Profile Background is ${label.toLowerCase()}ed`
      : `Set a Profile Background first — this controls the active background`;
  }
  frag.appendChild(fieldRow('Size', sizeField));
  frag.appendChild(fieldRow('Position', positionField));
  frag.appendChild(fieldRow('Repeat', repeatField));

  const hint = document.createElement('p');
  hint.className = 'studio-prop-hint';
  hint.textContent = isActive
    ? 'These settings control the active Profile Background above. It covers the outer profile area, behind the main profile and every sidebar card, and is saved and published with the design — it is never a normal image card.'
    : 'Size, Position and Repeat apply once a Profile Background is active. The background covers the outer profile area, behind the main profile and every sidebar card — it is never a normal image card.';
  frag.appendChild(hint);

  // CREATOR-12: the Background EFFECT is a separate, independent control. It is
  // NOT part of the image state above: image-only, effect-only, both and
  // neither are all valid, and neither one implies the other.
  backgroundEffectProperties(frag);
}

// ── CREATOR-12: Profile Background Effect ─────────────────────────────────────

/**
 * Effect state, derived the same way the background image's state is: ACTIVE
 * comes from the saved design, a staged import is transient editor state, and an
 * import never becomes active on its own.
 */
function effectState() {
  const theme = designTheme();
  const saved = theme && typeof theme.backgroundEffect === 'object' ? theme.backgroundEffect : null;
  const active = saved && saved.enabled !== false && saved.effectId
    ? { effectId: saved.effectId, source: saved.source, config: saved.config || {}, engine: saved.engine }
    : null;
  const pending = pendingEffect;
  if (active && pending && pending.effectId !== active.effectId) {
    return { key: 'replace', active, pending, label: 'REPLACEMENT READY' };
  }
  if (active) return { key: 'active', active, pending: null, label: 'ACTIVE' };
  if (pending) return { key: 'pending', active: null, pending, label: 'IMPORTED — NOT ACTIVE' };
  return { key: 'none', active: null, pending: null, label: 'NO EFFECT' };
}

/** The label a creator reads, split into Built-in and Creator. */
function effectChoiceLabel(effectId) {
  if (BUILTIN_EFFECTS[effectId]) return `${BUILTIN_EFFECTS[effectId].name} (Built-in)`;
  const installed = installedEffects().find(e => e.effect_id === effectId);
  if (installed) return `${installed.name} (Creator${installed.author ? ` — ${installed.author}` : ''})`;
  return effectId;
}

/**
 * CREATOR-12: the Background Effect control.
 *
 * Follows the CREATOR-10A pattern deliberately: an explicit state chip, an
 * action that only appears when it would do something, and a staged import that
 * is visibly NOT the same thing as the active effect.
 */
function backgroundEffectProperties(frag) {
  const theme = designTheme();
  const state = effectState();

  const head = document.createElement('div');
  head.className = 'studio-bg-head';
  const heading = document.createElement('h3');
  heading.className = 'studio-prop-section';
  heading.textContent = 'Background Effect';
  const chip = document.createElement('span');
  chip.className = `studio-bg-chip studio-bg-chip-${state.key === 'none' ? 'none' : state.key}`;
  chip.id = 'studio-effect-state';
  chip.dataset.state = state.key;
  chip.textContent = state.key === 'active' ? '✓ ACTIVE' : state.label;
  head.append(heading, chip);
  frag.appendChild(head);

  // The active effect, described in words — the effect itself is drawn on the
  // canvas, so the panel's job is to say which one is live.
  const activeBox = document.createElement('div');
  activeBox.className = 'studio-effect-current';
  activeBox.id = 'studio-effect-current';
  activeBox.dataset.effectId = state.active ? state.active.effectId : '';
  if (state.active) {
    activeBox.textContent = `Active: ${effectChoiceLabel(state.active.effectId)}`;
  } else {
    activeBox.textContent = 'No effect is playing on your profile background.';
  }
  frag.appendChild(activeBox);

  // CREATOR-10C: say whether it is genuinely animating. An effect held still by
  // the visitor's reduced-motion preference is still shown, but the panel must not
  // claim it is playing.
  if (state.active) frag.appendChild(liveEffectView(state));

  if (state.pending) {
    const pendingBox = document.createElement('div');
    pendingBox.className = 'studio-bg-pending';
    pendingBox.id = 'studio-effect-pending';
    pendingBox.dataset.pending = 'true';
    const label = document.createElement('span');
    label.className = 'studio-bg-pending-label';
    label.id = 'studio-effect-pending-label';
    label.textContent = state.active
      ? `Imported "${state.pending.name}" — ready to REPLACE the active effect. Not applied yet.`
      : `Imported "${state.pending.name}" — ready to use as your Profile Background Effect. Not active yet.`;
    pendingBox.appendChild(label);
    frag.appendChild(pendingBox);
  }

  // ── Built-in effects ──
  const builtinIds = BUILTIN_EFFECT_IDS;
  const builtinSelect = document.createElement('select');
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'None';
  builtinSelect.appendChild(noneOption);
  for (const id of builtinIds) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${BUILTIN_EFFECTS[id].name} (Built-in)`;
    builtinSelect.appendChild(opt);
  }
  builtinSelect.value = state.pending && state.pending.source !== 'creator' ? state.pending.effectId : '';
  builtinSelect.id = 'studio-effect-builtin';
  builtinSelect.addEventListener('change', () => {
    if (!builtinSelect.value) return;
    stageEffect({ effectId: builtinSelect.value, source: 'builtin', name: BUILTIN_EFFECTS[builtinSelect.value].name });
  });
  frag.appendChild(fieldRow('Built-in Effects', builtinSelect));

  // ── Creator effects ──
  const creatorSelect = document.createElement('select');
  const cNone = document.createElement('option');
  cNone.value = '';
  cNone.textContent = 'None';
  creatorSelect.appendChild(cNone);
  for (const row of installedEffects()) {
    const opt = document.createElement('option');
    opt.value = row.effect_id;
    opt.textContent = `${row.name} (Creator${row.author ? ` — ${row.author}` : ''})`;
    creatorSelect.appendChild(opt);
  }
  creatorSelect.value = state.pending && state.pending.source === 'creator' ? state.pending.effectId : '';
  creatorSelect.id = 'studio-effect-creator';
  creatorSelect.addEventListener('change', () => {
    if (!creatorSelect.value) return;
    const row = installedEffects().find(r => r.effect_id === creatorSelect.value);
    stageEffect({
      effectId: creatorSelect.value, source: 'creator', name: row ? row.name : creatorSelect.value,
    });
  });
  frag.appendChild(fieldRow('Creator Effects', creatorSelect));

  if (installedEffects().length === 0) {
    const none = document.createElement('p');
    none.className = 'studio-prop-hint';
    none.textContent = 'You have not imported any .kpeffect packages yet. Import one below and it will appear here.';
    frag.appendChild(none);
  }

  // ── Apply / Remove ──
  const row = document.createElement('div');
  row.className = 'studio-image-row';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.id = 'studio-effect-apply';
  applyBtn.className = 'btn btn-primary studio-upload-btn';
  const replacing = state.key === 'replace';
  applyBtn.textContent = replacing ? 'Replace Background Effect' : 'Set as Background Effect';
  applyBtn.hidden = !state.pending;
  applyBtn.disabled = !state.pending;
  applyBtn.addEventListener('click', () => {
    if (!pendingEffect) return;
    pushHistory();
    const t = designTheme();
    const def = effectDefinitionFor(pendingEffect.effectId);
    // The stored effect carries NO engine field. The engine is a property of the
    // effect itself — fixed for a built-in, and taken from the validated package
    // for a creator effect — so storing one would let a design assert an engine it
    // has no right to choose. The server rejects it, and rightly so.
    t.backgroundEffect = {
      enabled: true,
      effectId: pendingEffect.effectId,
      source: pendingEffect.source,
      version: 1,
      config: { ...(def && def.config ? def.config : {}) },
    };
    pendingEffect = null;
    markChanged(replacing
      ? 'Background effect replaced. It plays behind the whole profile.'
      : 'Background effect active. It plays behind the whole profile.');
    renderCanvas();
    renderProperties();
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.id = 'studio-effect-remove';
  removeBtn.className = 'btn btn-secondary studio-upload-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.hidden = !state.active;
  removeBtn.disabled = !state.active;
  removeBtn.title = 'Remove the active background effect. The background image is not affected.';
  removeBtn.addEventListener('click', () => {
    const t = designTheme();
    if (!t.backgroundEffect) return;
    pushHistory();
    // Only the effect is removed. The background IMAGE is a separate setting and
    // must survive untouched.
    delete t.backgroundEffect;
    pendingEffect = null;
    markChanged('Background effect removed. Your background image is unchanged.');
    renderCanvas();
    renderProperties();
  });

  row.append(applyBtn, removeBtn);
  frag.appendChild(row);

  // ── Import ──
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.kpeffect,application/zip';
  fileInput.hidden = true;
  fileInput.id = 'studio-effect-file';

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.id = 'studio-effect-import';
  importBtn.className = 'btn btn-secondary studio-upload-btn';
  importBtn.textContent = 'Import .kpeffect';
  importBtn.title = 'Import a KomuniPH effect package';
  importBtn.addEventListener('click', () => fileInput.click());

  const importRow = document.createElement('div');
  importRow.className = 'studio-image-row';
  importRow.append(importBtn);
  frag.appendChild(importRow);
  frag.appendChild(fileInput);

  const importStatus = document.createElement('p');
  importStatus.className = 'studio-upload-status';
  importStatus.id = 'studio-effect-import-status';
  // A failure speaks in this line rather than only in a separate note, so the
  // reason is in the same place the creator was looking when it failed.
  importStatus.textContent = pendingEffectImportError
    || 'A .kpeffect package is validated on the server before it can be used. Creator packages are data only — they never contain code.';
  frag.appendChild(importStatus);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    importBtn.disabled = true;
    importStatus.textContent = 'Validating package…';
    try {
      const result = await creatorEffectApi.importPackage(file);
      await refreshInstalledEffects();
      // Imported is NOT active. The creator chooses when it is used.
      pendingEffect = {
        effectId: result.effectId, source: 'creator', name: result.name, engine: result.engine,
      };
      pendingEffectImportError = '';
      importStatus.textContent = `Imported "${result.name}" by ${result.author || 'unknown'}. Choose "Set as Background Effect" to use it.`;
    } catch (err) {
      pendingEffect = null;
      pendingEffectImportError = err.message || 'Effect could not be imported.';
      importStatus.textContent = pendingEffectImportError;
    } finally {
      importBtn.disabled = false;
    }
    renderProperties();
  });

  if (pendingEffectImportError) {
    const errLine = document.createElement('p');
    errLine.className = 'studio-prop-hint studio-bg-error';
    errLine.id = 'studio-effect-import-error';
    errLine.textContent = pendingEffectImportError;
    pendingEffectImportError = '';
    frag.appendChild(errLine);
  }

  // ── Per-effect settings, from the validated schema only ──
  // Which effect the settings describe: the staged one if there is one, else the
  // active one. They come from the effect's own engine schema, so there is no
  // free-form control and no way to enter a CSS value.
  const subject = state.pending || state.active;
  if (subject) {
    const engine = effectDefinitionFor(subject.effectId)?.engine
      || BUILTIN_EFFECTS[subject.effectId]?.engine;
    const schema = ENGINE_SCHEMAS[engine];
    if (schema) {
      const cfg = {
        ...(BUILTIN_EFFECTS[subject.effectId]?.defaultConfig || {}),
        ...((state.active && state.active.effectId === subject.effectId) ? (state.active.config || {}) : {}),
      };
      for (const [key, spec] of Object.entries(schema)) {
        const path = `backgroundEffect.config.${key}`;
        if (spec.type === 'number') {
          frag.appendChild(fieldRow(spec.label || key, numberField(theme, path, {
            min: spec.min, max: spec.max, step: stepFor(spec),
          })));
        } else if (spec.type === 'bool') {
          frag.appendChild(fieldRow(spec.label || key, toggleField(theme, path)));
        } else if (spec.type === 'enum') {
          frag.appendChild(fieldRow(spec.label || key, selectField(theme, path, spec.values)));
        }
      }
      const note = document.createElement('p');
      note.className = 'studio-prop-hint';
      note.textContent = `These settings apply to "${effectChoiceLabel(subject.effectId)}". They are saved with the design and play on your public profile.`;
      frag.appendChild(note);
    }
  } else {
    const hint = document.createElement('p');
    hint.className = 'studio-prop-hint';
    hint.textContent = 'An effect is a decorative layer that plays behind your profile, above the background image and below your content. Choose a built-in effect to try one — it can be removed at any time, and your background image is never affected.';
    frag.appendChild(hint);
  }
}

/** A sensible step for a bounded numeric setting. */
function stepFor(spec) {
  const range = spec.max - spec.min;
  if (range <= 2) return 0.05;
  if (range <= 20) return 0.5;
  if (range <= 200) return 1;
  return 10;
}

/**
 * CREATOR-13: the LIVE VIEW.
 *
 * A real rendering of the selected effect, in the Properties panel, so a creator
 * can see whether it renders, moves, and looks like itself — without publishing.
 *
 * It is NOT a mock and NOT a second engine: it calls the same
 * `applyProfileBackgroundEffect()` with the same validated effect definition the
 * public profile and the design canvas use. The renderer keeps playback state per
 * layer, so the Live View and the canvas preview animate independently and
 * starting one never tears the other down.
 *
 * The Motion status is a FACT about pixels, not a frame counter. A loop that runs
 * but never moves anything reports NO MOVEMENT DETECTED, which is the failure a
 * creator would otherwise see as "it just doesn't animate".
 *
 * Nothing here writes to the design. Pause, Resume and Restart are preview-only
 * operations on the layer's own controller.
 */
function liveEffectView(state) {
  const wrap = document.createElement('div');
  wrap.className = 'studio-effect-live';
  wrap.id = 'studio-effect-live';

  // ── Effect identity ──
  const head = document.createElement('div');
  head.className = 'studio-effect-live-head';
  const nameEl = document.createElement('span');
  nameEl.className = 'studio-effect-live-name';
  nameEl.id = 'studio-effect-live-name';
  nameEl.textContent = effectChoiceLabel(state.active.effectId);
  const engineEl = document.createElement('span');
  engineEl.className = 'studio-effect-live-engine';
  engineEl.id = 'studio-effect-live-engine';
  const def = effectDefinitionFor(state.active.effectId);
  engineEl.textContent = `Engine: ${(def && def.engine) || 'unknown'}`;
  head.append(nameEl, engineEl);
  wrap.appendChild(head);

  // ── The live surface ──
  const stage = document.createElement('div');
  stage.className = 'studio-effect-live-stage';
  stage.id = 'studio-effect-live-stage';
  // A neutral, dark surface so pale particles (snow, sparkles) are as visible as
  // green ones (leaves) — the preview must not flatter or hide an effect.
  const layer = document.createElement('div');
  layer.className = 'studio-effect-live-layer';
  layer.id = 'studio-effect-live-layer';
  stage.appendChild(layer);
  wrap.appendChild(stage);

  // ── Status ──
  const statusRow = document.createElement('div');
  statusRow.className = 'studio-effect-live-status';
  const badge = document.createElement('span');
  badge.className = 'studio-effect-live-badge';
  badge.id = 'studio-effect-live-badge';
  badge.textContent = 'LIVE';
  const motion = document.createElement('span');
  motion.className = 'studio-effect-live-motion';
  motion.id = 'studio-effect-live-motion';
  motion.textContent = 'Motion: detecting…';
  statusRow.append(badge, motion);
  wrap.appendChild(statusRow);

  // ── Controls ──
  const controls = document.createElement('div');
  controls.className = 'studio-effect-live-controls';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'studio-effect-live-toggle';
  toggle.className = 'btn btn-secondary studio-upload-btn';
  const restart = document.createElement('button');
  restart.type = 'button';
  restart.id = 'studio-effect-live-restart';
  restart.className = 'btn btn-secondary studio-upload-btn';
  restart.textContent = 'Restart';
  restart.title = 'Re-create the effect and start it again (preview only)';
  controls.append(toggle, restart);
  wrap.appendChild(controls);

  const hint = document.createElement('p');
  hint.className = 'studio-prop-hint';
  hint.textContent = 'A real preview, rendered by the same effect engine your public profile uses. Pausing, resuming and restarting change nothing about your design.';
  wrap.appendChild(hint);

  // ── Start the preview once the node is in the document ──
  queueMicrotask(() => {
    if (!layer.isConnected) return;
    startLiveEffect(layer, state);
  });

  return wrap;
}

/**
 * CREATOR-13: (re)start the Live View for a layer and wire its controls.
 * Always tears the previous preview down first, so switching effects can never
 * leave two animation loops competing for the same surface.
 */
function startLiveEffect(layer, state) {
  stopLiveEffect();
  liveEffectLayer = layer;
  liveEffectPaused = false;
  liveEffectMotion = 'detecting';

  const def = effectDefinitionFor(state.active.effectId);
  const engine = (def && def.engine) || 'particles';
  const bounds = { width: LIVE_VIEW_W, height: LIVE_VIEW_H };

  applyProfileBackgroundEffect(
    { enabled: true, effectId: state.active.effectId, source: state.active.source, config: state.active.config || {} },
    { layer, creatorEffect: installedEffectDefinition(state.active.effectId), bounds },
  );

  liveEffectController = getEffectController(layer);
  // The probe reads the live surface's own pixels, so "ACTIVE" means the creator
  // can see movement — not merely that a loop is running.
  liveEffectProbe = createMotionProbe(layer.querySelector('canvas'), { sampleSize: 48, intervalMs: 220 });
  liveEffectProbe.start();
  liveEffectWatchdog = setTimeout(() => {
    if (liveEffectMotion === 'detecting' && !liveEffectProbe.moved) {
      liveEffectMotion = 'no-movement';
    }
    updateLiveEffectStatus(engine);
  }, 1400);
  // A cheap ticker so the Motion label follows the probe. It only reads state and
  // writes a few text nodes — no pixel work — and the probe itself samples on its
  // own interval, so the cost is bounded and never touches the draw loop.
  liveEffectTicker = setInterval(() => updateLiveEffectStatus(engine), 250);
  updateLiveEffectStatus(engine);
  wireLiveEffectControls();
}

/** Tear the Live View down completely: loop, probe, watchdog, ticker and timers. */
function stopLiveEffect() {
  if (liveEffectWatchdog) { clearTimeout(liveEffectWatchdog); liveEffectWatchdog = null; }
  if (liveEffectTicker) { clearInterval(liveEffectTicker); liveEffectTicker = null; }
  if (liveEffectProbe) { liveEffectProbe.stop(); liveEffectProbe = null; }
  if (liveEffectLayer) {
    clearProfileBackgroundEffect(liveEffectLayer);
    liveEffectLayer = null;
  }
  liveEffectController = null;
  liveEffectPaused = false;
}

function wireLiveEffectControls() {
  const toggle = root?.querySelector('#studio-effect-live-toggle');
  const restart = root?.querySelector('#studio-effect-live-restart');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const controller = getEffectController(liveEffectLayer);
      if (!controller) return;
      if (liveEffectPaused) {
        controller.resume();
        liveEffectPaused = false;
        if (liveEffectProbe) { liveEffectProbe.reset(); liveEffectProbe.start(); }
      } else {
        controller.pause();
        liveEffectPaused = true;
      }
      // Report the pause as a fact about the preview, not the design.
      liveEffectMotion = liveEffectPaused ? 'paused' : 'detecting';
      updateLiveEffectStatus();
    });
  }
  if (restart) {
    restart.addEventListener('click', () => {
      const controller = getEffectController(liveEffectLayer);
      if (!controller) return;
      // Restart rebuilds the effect from the same definition: preview only, and
      // the design is not touched or marked dirty.
      liveEffectPaused = false;
      controller.restart();
      liveEffectController = getEffectController(liveEffectLayer);
      if (liveEffectProbe) { liveEffectProbe.reset(); liveEffectProbe.start(); }
      liveEffectMotion = 'detecting';
      updateLiveEffectStatus();
    });
  }
}

function updateLiveEffectStatus(engine) {
  const badge = root?.querySelector('#studio-effect-live-badge');
  const motionEl = root?.querySelector('#studio-effect-live-motion');
  const toggle = root?.querySelector('#studio-effect-live-toggle');
  if (!badge || !motionEl || !toggle) return;

  const reduce = prefersReducedMotion();
  if (reduce) {
    badge.textContent = 'STATIC';
    badge.dataset.state = 'static';
    motionEl.textContent = 'Motion: REDUCED MOTION';
    motionEl.dataset.motion = 'reduced';
    toggle.textContent = 'Play';
    return;
  }
  if (liveEffectPaused) {
    badge.textContent = 'PAUSED';
    badge.dataset.state = 'paused';
    motionEl.textContent = 'Motion: PAUSED';
    motionEl.dataset.motion = 'paused';
    toggle.textContent = 'Play';
    return;
  }
  badge.textContent = 'LIVE';
  badge.dataset.state = 'live';
  toggle.textContent = 'Pause';

  // A loop that runs without moving anything must not be reported as ACTIVE.
  if (liveEffectProbe && liveEffectProbe.moved) {
    liveEffectMotion = 'active';
    motionEl.textContent = 'Motion: ACTIVE';
    motionEl.dataset.motion = 'active';
  } else if (liveEffectMotion === 'detecting') {
    motionEl.textContent = 'Motion: detecting…';
    motionEl.dataset.motion = 'detecting';
  } else {
    motionEl.textContent = engine === 'particles'
      ? 'Motion: NO MOVEMENT DETECTED'
      : 'Motion: CSS-animated';
    motionEl.dataset.motion = 'no-movement';
  }
}
// ── CREATOR-13: Live View state ───────────────────────────────────────────────
// All preview-only. None of it is design state: the layer, the controller, the
// pixel probe and the watchdog describe a LIVE VIEW, and every one of them is
// torn down on teardown, on effect switch, and on panel rebuild.
const LIVE_VIEW_W = 320;
const LIVE_VIEW_H = 180;
let liveEffectLayer = null;
let liveEffectController = null;
let liveEffectProbe = null;
let liveEffectWatchdog = null;
let liveEffectTicker = null;
let liveEffectPaused = false;
let liveEffectMotion = 'detecting';

let studioMotionQuery = null;
let studioMotionHandler = null;
let effectPlaybackObserver = null;
let lastPlaybackMotion = null;

/**
 * CREATOR-10C: keep the playback badge a LIVE view of the renderer.
 *
 * The renderer is the only thing that knows whether an effect is really running —
 * it decides that after it has sized and attached its canvas, which is after the
 * Properties panel has already been built. Reading its state once at render time
 * therefore reports the wrong answer, and the panel would then sit there claiming
 * "static" for an animating effect (or the reverse) until something else happened
 * to rebuild it.
 *
 * So the panel watches the effect layer and refreshes only when the motion state
 * genuinely CHANGES. The frame counter is deliberately excluded: it ticks on
 * every animation frame, and reacting to it would re-render the whole panel sixty
 * times a second, stealing focus from whatever the creator is typing into.
 */
function observeEffectPlayback() {
  const scroll = root?.querySelector('#studio-canvas-scroll');
  if (!scroll || typeof MutationObserver === 'undefined') return;
  try { effectPlaybackObserver?.disconnect(); } catch { /* best effort */ }
  lastPlaybackMotion = scroll.querySelector('#studio-profile-effect-layer')?.dataset?.motion || 'none';
  effectPlaybackObserver = new MutationObserver(() => {
    const motion = root?.querySelector('#studio-profile-effect-layer')?.dataset?.motion || 'none';
    if (motion === lastPlaybackMotion) return;
    lastPlaybackMotion = motion;
    renderProperties();
  });
  // The effect layer is REPLACED on every canvas render, so the mutation target
  // is the scroll container, observed through its subtree.
  effectPlaybackObserver.observe(scroll, {
    childList: true,
    subtree: true,
    attributes: true,
    // The frame counter is NOT watched, so playback itself never triggers work.
    attributeFilter: ['data-motion'],
  });
}

function canvasProperties(frag) {
  const c = canvas();
  frag.appendChild(sectionTitle('Canvas'));
  frag.appendChild(fieldRow('Design name', singleLineField(currentDesign, 'name', { max: 100 })));

  const widthInput = numberField(currentDesign.layout.canvas, 'width', { min: 320, max: 1920, integer: true });
  frag.appendChild(fieldRow('Canvas width', widthInput));
  const heightInput = numberField(currentDesign.layout.canvas, 'minHeight', { min: 480, max: 10000, integer: true });
  frag.appendChild(fieldRow('Canvas height', heightInput));

  const note = document.createElement('p');
  note.className = 'studio-prop-hint';
  note.textContent = `${components().length} component${components().length === 1 ? '' : 's'} · draft saved on your account only.`;
  frag.appendChild(note);

  widthInput.addEventListener('input', () => { renderCanvas(); });
  heightInput.addEventListener('input', () => { renderCanvas(); });

  // CREATOR-10: the background is a property of the DESIGN as a whole, so it
  // lives with the canvas settings rather than with any one component.
  profileBackgroundProperties(frag);
}

/**
 * CREATOR-06: explicit Layer order buttons in the Properties panel.
 * "Move Up" brings the component one layer forward, "Move Down" sends it
 * one layer back. Reuses the same moveLayer() ordering used by the Layers
 * panel so there is exactly one z-order model (profile_designs zIndex).
 */
function layerOrderField(comp) {
  const wrap = document.createElement('div');
  wrap.className = 'studio-prop-row studio-layer-order';
  const label = document.createElement('span');
  label.className = 'studio-prop-label';
  label.textContent = 'Order';
  const buttons = document.createElement('span');
  buttons.className = 'studio-order-buttons';
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'btn btn-secondary studio-order-btn';
  up.textContent = 'Move Up';
  up.title = 'Bring one layer forward';
  up.addEventListener('click', () => { moveLayer(comp.id, 1); renderProperties(); });
  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'btn btn-secondary studio-order-btn';
  down.textContent = 'Move Down';
  down.title = 'Send one layer backward';
  down.addEventListener('click', () => { moveLayer(comp.id, -1); renderProperties(); });
  buttons.append(up, down);
  wrap.append(label, buttons);
  return wrap;
}

/**
 * CREATOR-06: alignment shortcuts. Sets X/Y against the canvas (or centers)
 * through the same geometry fields the server validates — no parallel model.
 */
function alignField(comp) {
  const wrap = document.createElement('div');
  wrap.className = 'studio-prop-row studio-align-row';
  const label = document.createElement('span');
  label.className = 'studio-prop-label';
  label.textContent = 'Canvas align';
  const buttons = document.createElement('span');
  buttons.className = 'studio-order-buttons';
  const actions = [
    ['Left', () => { comp.x = 0; }],
    ['Center', () => { comp.x = Math.max(0, Math.round((canvas().width - comp.width) / 2)); }],
    ['Right', () => { comp.x = Math.max(0, canvas().width - comp.width); }],
    ['Top', () => { comp.y = 0; }],
    ['Middle', () => { comp.y = Math.max(0, Math.round((canvas().minHeight - comp.height) / 2)); }],
    ['Bottom', () => { comp.y = Math.max(0, canvas().minHeight - comp.height); }],
  ];
  actions.forEach(([text, apply]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary studio-order-btn';
    button.textContent = text;
    button.title = `Align ${text.toLowerCase()} on canvas`;
    button.addEventListener('click', () => {
      if (comp.locked) return;
      pushHistory();
      apply();
      markChanged(`Aligned ${text.toLowerCase()}.`);
      renderProperties();
    });
    buttons.appendChild(button);
  });
  wrap.append(label, buttons);
  return wrap;
}

function componentProperties(frag, comp) {
  const title = document.createElement('div');
  title.className = 'studio-prop-title';
  title.textContent = `${labelOf(comp)} (${comp.type})`;
  frag.appendChild(title);

  const idLine = document.createElement('p');
  idLine.className = 'studio-prop-id';
  idLine.textContent = `id: ${comp.id}`;
  frag.appendChild(idLine);

  frag.appendChild(sectionTitle('Position'));
  frag.appendChild(fieldRow('X', numberField(comp, 'x', { min: -10000, max: 10000, integer: true })));
  frag.appendChild(fieldRow('Y', numberField(comp, 'y', { min: -10000, max: 10000, integer: true })));
  frag.appendChild(sectionTitle('Size'));
  frag.appendChild(fieldRow('Width', numberField(comp, 'width', { min: 8, max: 4080, integer: true })));
  frag.appendChild(fieldRow('Height', numberField(comp, 'height', { min: 8, max: 4080, integer: true })));
  frag.appendChild(sectionTitle('Layer'));
  frag.appendChild(fieldRow('Z-index', numberField(comp, 'zIndex', { min: 0, max: 10000, integer: true })));
  frag.appendChild(layerOrderField(comp));
  frag.appendChild(fieldRow('Visible', toggleField(comp, 'visible')));
  frag.appendChild(fieldRow('Locked', toggleField(comp, 'locked')));
  frag.appendChild(sectionTitle('Align'));
  frag.appendChild(alignField(comp));
  frag.appendChild(sectionTitle('Transform'));
  frag.appendChild(fieldRow('Rotation (deg)', numberField(comp, 'rotation', { min: 0, max: 360 })));

  frag.appendChild(sectionTitle('Appearance'));
  frag.appendChild(fieldRow('Background', colorField(comp, 'style.background')));
  frag.appendChild(fieldRow('Text color', colorField(comp, 'style.textColor')));
  frag.appendChild(fieldRow('Border color', colorField(comp, 'style.borderColor')));
  frag.appendChild(fieldRow('Border width', numberField(comp, 'style.borderWidth', { min: 0, max: 100 })));
  frag.appendChild(fieldRow('Border radius', numberField(comp, 'style.borderRadius', { min: 0, max: 500 })));
  frag.appendChild(fieldRow('Opacity', numberField(comp, 'style.opacity', { min: 0, max: 1, step: 0.05 })));
  frag.appendChild(fieldRow('Shadow', toggleField(comp, 'style.shadowEnabled')));
  frag.appendChild(fieldRow('Shadow offset', numberField(comp, 'style.shadowOffset', { min: -100, max: 100 })));
  frag.appendChild(fieldRow('Shadow blur', numberField(comp, 'style.shadowBlur', { min: 0, max: 200 })));
  frag.appendChild(fieldRow('Shadow color', colorField(comp, 'style.shadowColor')));

  if (comp.type === GUIDE_CARD_COMPONENT_TYPE) {
    frag.appendChild(sectionTitle('Guide Card'));
    frag.appendChild(fieldRow('Section', selectField(comp, 'config.section', GUIDE_SECTION_IDS, {
      labels: GUIDE_SECTION_IDS.map(id => GUIDE_SECTIONS[id]),
    })));
    const hint = document.createElement('p');
    hint.className = 'studio-prop-hint';
    hint.textContent = 'A placement guide for a real profile section. It is saved with your design, is editable like any component, and never appears on your public profile, in a published design or in the Marketplace.';
    frag.appendChild(hint);

    // CREATOR-09 §7: Reset restores the default guide set for the WHOLE design.
    // It removes every guide card and creates exactly one default set, leaving
    // all other components untouched.
    const actions = document.createElement('div');
    actions.className = 'studio-prop-row studio-guide-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.id = 'studio-guide-reset-in-properties';
    reset.className = 'btn btn-secondary';
    reset.textContent = 'Reset Guide';
    reset.title = 'Remove all guide cards and restore the default guide set';
    reset.addEventListener('click', () => { resetGuide(); renderProperties(); });
    const del = document.createElement('button');
    del.type = 'button';
    del.id = 'studio-guide-delete';
    del.className = 'btn btn-secondary';
    del.textContent = 'Delete Card';
    del.title = 'Remove this guide card from the design';
    del.addEventListener('click', () => { removeComponent(comp.id); });
    actions.appendChild(reset);
    actions.appendChild(del);
    frag.appendChild(actions);
  }

  if (comp.type === LEGACY_GUIDE_COMPONENT_TYPE) {
    const hint = document.createElement('p');
    hint.className = 'studio-prop-hint';
    hint.textContent = 'This is a pre-CREATOR-09 guide. It is converted to guide cards when the design is next saved.';
    frag.appendChild(hint);
  }

  if (CONTENT_COMPONENT_TYPES.has(comp.type)) {
    const section = comp.type === 'text' ? 'Text content'
      : comp.type === 'card' ? 'Card content'
        : 'Image content';
    frag.appendChild(sectionTitle(section));
    if (comp.type === 'text') {
      frag.appendChild(fieldRow('Text', textField(comp, 'config.text', { max: 2000, rows: 3, trim: true })));
      // CREATOR-11: Font Family and Style are SELECTS over the server allowlist,
      // never a free-text field — the stored value is a font id, so there is no
      // way to submit a CSS font-family string.
      frag.appendChild(fieldRow('Font', selectField(comp, 'config.fontFamily', FONT_FAMILY_IDS, {
        labels: FONT_FAMILY_IDS.map(id => FONT_FAMILIES.get(id).label),
      })));
      frag.appendChild(fieldRow('Font size', numberField(comp, 'config.fontSize', { min: 8, max: 200 })));
      frag.appendChild(fieldRow('Font weight', numberField(comp, 'config.fontWeight', { min: 100, max: 900, integer: true })));
      frag.appendChild(fieldRow('Style', selectField(comp, 'config.fontStyle', FONT_STYLES)));
      frag.appendChild(fieldRow('Align', selectField(comp, 'config.textAlign', ['left', 'center', 'right'])));
      frag.appendChild(fieldRow('Line height', numberField(comp, 'config.lineHeight', { min: 0.5, max: 3, step: 0.1 })));
      frag.appendChild(fieldRow('Text color', colorField(comp, 'config.textColor')));
    }
    if (comp.type === 'image' || comp.type === 'sticker') {
      frag.appendChild(imageSourceField(comp));
      frag.appendChild(fieldRow('Image URL', singleLineField(comp, 'config.imageUrl', { trim: true })));
      frag.appendChild(fieldRow('Alt text', singleLineField(comp, 'config.alt', { max: 200 })));
      frag.appendChild(fieldRow('Fit', selectField(comp, 'config.fit', ['cover', 'contain', 'fill'])));
      frag.appendChild(fieldRow('Background', colorField(comp, 'config.backgroundColor')));
      const hint = document.createElement('p');
      hint.className = 'studio-prop-hint';
      hint.textContent = 'Upload an image or use an http(s) image URL. A URL is required before this design can be saved.';
      frag.appendChild(hint);
    }
    if (comp.type === 'card') {
      frag.appendChild(fieldRow('Heading', singleLineField(comp, 'config.heading', { max: 200, trim: true })));
      frag.appendChild(fieldRow('Body', textField(comp, 'config.body', { max: 2000, rows: 3 })));
      frag.appendChild(fieldRow('Heading color', colorField(comp, 'config.headingColor')));
      frag.appendChild(fieldRow('Body color', colorField(comp, 'config.textColor')));
      frag.appendChild(fieldRow('Align', selectField(comp, 'config.textAlign', ['left', 'center', 'right'])));
      // CREATOR-11: Content Mask. A plain On/Off switch — the renderer owns the
      // actual clipping, so no CSS clip value is ever user-supplied.
      frag.appendChild(fieldRow('Content Mask', toggleField(comp, 'config.mask')));
      const kids = childrenOf(comp.id);
      const maskHint = document.createElement('p');
      maskHint.className = 'studio-prop-hint';
      maskHint.textContent = kids.length === 0
        ? 'Content Mask clips the Image and Sticker you place inside this card to its box and border radius. None placed yet — select an Image or Sticker and set its Container to this card.'
        : `Contains ${kids.length} component${kids.length === 1 ? '' : 's'}: ${kids.map(k => labelOf(k)).join(', ')}. Deleting this card also deletes ${kids.length === 1 ? 'it' : 'them'}.`;
      frag.appendChild(maskHint);
    }

    // CREATOR-11: Container. Only Cards can contain things, and only Image and
    // Sticker can be contained, so the options are pre-filtered from the live
    // design rather than being a free-text id field.
    if (CARD_CHILD_TYPES.has(comp.type) || CARD_PARENT_TYPES.has(comp.type)) {
      frag.appendChild(sectionTitle('Container'));
      if (CARD_CHILD_TYPES.has(comp.type)) {
        const cardIds = components().filter(c => CARD_PARENT_TYPES.has(c.type)).map(c => c.id);
        frag.appendChild(fieldRow('Inside Card', selectField(comp, 'parentId', ['', ...cardIds], {
          labels: ['None', ...cardIds.map(id => labelOf(components().find(c => c.id === id) || { type: id }))],
        })));
        const nestHint = document.createElement('p');
        nestHint.className = 'studio-prop-hint';
        nestHint.textContent = 'Inside a card, X/Y are measured from the card\'s top-left and the image is clipped to the card when its Content Mask is on. Dragging the card moves this component with it.';
        frag.appendChild(nestHint);
      } else {
        const note = document.createElement('p');
        note.className = 'studio-prop-hint';
        note.textContent = 'A Card is a container. Cards cannot be nested inside other cards.';
        frag.appendChild(note);
      }
    }

    // CREATOR-11: Animation. Exposes exactly the five validated fields and
    // nothing else — there is no raw CSS/name field a creator could abuse.
    animationProperties(frag, comp);
  }
}

/**
 * CREATOR-11: the Repeat control.
 *
 * A dedicated field rather than a generic selectField, because the UI offers
 * friendly labels ("2×", "Infinite") while the validated model stores an INTEGER
 * or the exact string "infinite". A plain select would have stored the string
 * "2", which the server correctly rejects — so the choice is translated here,
 * once, at the boundary.
 */
function animationRepeatField(comp) {
  const select = document.createElement('select');
  const REPEAT_CHOICES = [
    { value: 1, label: 'Once' },
    { value: 2, label: '2×' },
    { value: 3, label: '3×' },
    { value: 5, label: '5×' },
    { value: 'infinite', label: 'Infinite' },
  ];
  for (const choice of REPEAT_CHOICES) {
    const option = document.createElement('option');
    // The DOM value is the model's real value, so nothing is translated on save.
    option.value = String(choice.value);
    option.textContent = choice.label;
    select.appendChild(option);
  }
  const current = getPath(comp, 'config.animation.iteration');
  const matched = REPEAT_CHOICES.find(c => c.value === current);
  select.value = String(matched ? matched.value : DEFAULT_ANIMATION.iteration);
  select.addEventListener('change', () => {
    const chosen = REPEAT_CHOICES.find(c => String(c.value) === select.value);
    setPath(comp, 'config.animation.iteration', chosen ? chosen.value : DEFAULT_ANIMATION.iteration);
    markChanged();
  });
  return select;
}

/**
 * CREATOR-11: the Animation section for a selected component.
 * Only the validated model is exposed; duration/delay/iteration are bounded by
 * the same ranges the server enforces, so the Studio cannot build a payload the
 * server would reject.
 */
function animationProperties(frag, comp) {
  if (!comp || !comp.config) return;
  frag.appendChild(sectionTitle('Animation'));
  const animation = resolveAnimation(comp.config.animation) || { ...DEFAULT_ANIMATION };

  frag.appendChild(fieldRow('Effect', selectField(comp, 'config.animation.name', ANIMATION_NAMES, {
    labels: ANIMATION_NAMES.map(n => ANIMATION_LABELS[n]),
  })));
  frag.appendChild(fieldRow('Duration', numberField(comp, 'config.animation.duration', {
    min: ANIMATION_DURATION_MIN, max: ANIMATION_DURATION_MAX, step: 0.1,
  })));
  frag.appendChild(fieldRow('Delay', numberField(comp, 'config.animation.delay', {
    min: ANIMATION_DELAY_MIN, max: ANIMATION_DELAY_MAX, step: 0.1,
  })));
  frag.appendChild(fieldRow('Repeat', animationRepeatField(comp)));
  frag.appendChild(fieldRow('Timing', selectField(comp, 'config.animation.timing', ANIMATION_TIMINGS)));

  // Reflect the stored value back into the controls. The animation model is
  // flat scalars, but the UI offers friendly choices, so map once on render.
  const set = (path, value) => { setPath(comp, path, value); };
  set('config.animation.duration', Number.isFinite(animation.duration) ? animation.duration : DEFAULT_ANIMATION.duration);
  set('config.animation.delay', Number.isFinite(animation.delay) ? animation.delay : DEFAULT_ANIMATION.delay);
  set('config.animation.timing', animation.timing);
  set('config.animation.iteration', animation.iteration);

  const hint = document.createElement('p');
  hint.className = 'studio-prop-hint';
  hint.textContent = 'Animation is presentation only — it never changes this component\'s position, size, rotation or layer order, and it is stored with the design so it plays on your public profile too.';
  frag.appendChild(hint);
}

function renderProperties() {
  const panel = root?.querySelector('#studio-properties');
  if (!panel) return;
  const frag = document.createDocumentFragment();
  if (!selectedId) {
    canvasProperties(frag);
  } else {
    const comp = findComp(selectedId);
    if (!comp) {
      selectedId = null;
      canvasProperties(frag);
    } else {
      componentProperties(frag, comp);
    }
  }
  panel.replaceChildren(frag);
  if (panel.querySelector('[data-resize]')) {
    // no-op; keeps panel DOM consistent when rebuilt
  }
}

function renderAll() {
  // Keep the design reachable inside the viewer before drawing it, so a
  // resized viewer still shows the profile rather than a clipped corner.
  clampViewerPan();
  renderCanvas();
  renderLayers();
  renderProperties();
  renderZoomReadout();
  updateToolbar();
}

// ── Guide operations (CREATOR-08 / CREATOR-09) ───────────────────────────────
//
// CREATOR-09: the guide is a SET of `profile_guide_card` components, each a
// labelled wireframe for one real profile section. Cards use the ordinary
// geometry/selection system — there is no second editor here.
//
// The guide is initialised at exactly one boundary: design creation, or the
// load/migration path in ensureGuideInitialized(). It is NEVER created by a
// render, so an intentional deletion survives re-opening the design, and the
// `guideInitialized` flag on the layout is what distinguishes "never
// initialised" from "intentionally deleted".
const GUIDE_INIT_FLAG = 'guideInitialized';

/** True when a layout has ever had the guide initialised (or explicitly reset). */
function isGuideInitialized(layoutObj) {
  return !!layoutObj && layoutObj[GUIDE_INIT_FLAG] === true;
}

/** Build the card components for a guide pattern, in a fresh component list. */
function buildGuideCards(patternId, { zIndex = 0 } = {}) {
  return guidePattern(patternId).cards.map(card => ({
    id: newId(),
    type: GUIDE_CARD_COMPONENT_TYPE,
    x: card.x,
    y: card.y,
    width: card.width,
    height: card.height,
    rotation: 0,
    zIndex,
    visible: true,
    locked: false,
    config: { section: card.section },
  }));
}

/**
 * CREATOR-09: the initialisation / migration boundary, run ONCE when a design is
 * opened — never from renderCanvas().
 *
 * Three cases, distinguished by the `guideInitialized` flag:
 *
 *   flag true  → the creator has seen the guide. A design with no cards is one
 *                they deliberately deleted. Do NOTHING; never resurrect it.
 *   flag false + legacy guide present → a pre-CREATOR-09 design. Convert its
 *                single block into guide cards (a migration, not an injection).
 *   flag false + nothing → never initialised. Create the default card set.
 *
 * In both mutating cases the flag is set, so this can only ever run once per
 * design and can never produce duplicate cards.
 */
function ensureGuideInitialized(layoutObj) {
  if (!layoutObj || !Array.isArray(layoutObj.components)) return;
  if (isGuideInitialized(layoutObj)) return;

  const legacy = layoutObj.components.find(c => c.type === LEGACY_GUIDE_COMPONENT_TYPE);
  if (legacy) {
    // Migrate CREATOR-08's single block into the card set for its pattern. The
    // legacy component is replaced, not duplicated.
    const patternId = legacy.config && legacy.config.pattern;
    const cards = buildGuideCards(patternId, { zIndex: legacy.zIndex ?? 0 });
    const index = layoutObj.components.indexOf(legacy);
    layoutObj.components.splice(index, 1, ...cards);
  } else if (!layoutObj.components.some(c => c.type === GUIDE_CARD_COMPONENT_TYPE)) {
    layoutObj.components.push(...buildGuideCards(DEFAULT_GUIDE_PATTERN));
  }
  layoutObj[GUIDE_INIT_FLAG] = true;
}

/** A fresh design layout: the default canvas plus exactly one default guide set. */
function newDesignLayout() {
  return {
    canvas: { ...DEFAULT_CANVAS },
    components: buildGuideCards(DEFAULT_GUIDE_PATTERN),
    [GUIDE_INIT_FLAG]: true,
  };
}

/** Every guide card currently in the design. */
function guideCards() {
  return components().filter(c => c.type === GUIDE_CARD_COMPONENT_TYPE);
}

/**
 * CREATOR-09 §7: Reset the guide.
 *
 * Removes EVERY existing guide card and creates exactly one default set. It
 * leaves every non-guide component — and all of their geometry, style, content
 * and z-order — untouched, so a design is never damaged by restoring its guide.
 * The init flag stays true, so resetting can never produce a duplicate set and
 * re-opening the design does not add another.
 */
function resetGuide() {
  const cards = guideCards();
  const legacy = components().filter(c => c.type === LEGACY_GUIDE_COMPONENT_TYPE);
  if (cards.length === 0 && legacy.length === 0) {
    setStatus('This design already has no guide cards.');
    return;
  }
  pushHistory();
  const removed = new Set([...cards, ...legacy].map(c => c.id));
  layout().components = components().filter(c => !removed.has(c.id));
  // Guide cards sit at the bottom of the stack so they read as guides behind the
  // real profile content, exactly as a fresh design does.
  const baseZ = Math.min(0, ...components().map(c => c.zIndex ?? 0));
  layout().components.push(...buildGuideCards(DEFAULT_GUIDE_PATTERN, { zIndex: baseZ }));
  layout()[GUIDE_INIT_FLAG] = true;
  if (selectedId && removed.has(selectedId)) selectedId = null;
  markChanged(`Guide reset to the default set (${guidePattern(DEFAULT_GUIDE_PATTERN).cards.length} cards). Your other components were left alone.`);
}

// ── Zoom controls (CREATOR-08) ────────────────────────────────────────────────
// Zoom and pan are VIEWER state. Every function here touches only `zoom` /
// `viewerPan` and re-renders the canvas: none of them can reach a component,
// mark the design dirty, push history, or trigger Save/Publish.
function renderZoomReadout() {
  const readout = root?.querySelector('#studio-zoom-readout');
  if (readout) readout.textContent = zoomPercent(zoom);
}

/** Apply a new zoom and keep the pan legal for the new scale. Viewer-only. */
function setZoom(next, message) {
  zoom = clampZoom(next);
  // CREATOR-10: a zoom change re-centres. The previous pan was computed for the
  // OLD scale, so keeping it would leave the canvas off-centre (or pinned to a
  // corner) at the new size.
  recentreViewer();
  renderCanvas();
  renderZoomReadout();
  if (message) setStatus(message);
}

function zoomBy(direction) {
  setZoom(stepZoom(zoom, direction));
}

/**
 * CREATOR-10: Reset returns to 100% and re-centres the canvas.
 *
 * Only viewer state changes. The design — canvas size, component geometry, image
 * sources — is untouched, and no undo entry is created.
 */
function resetViewerView() {
  zoom = DEFAULT_ZOOM;
  recentreViewer();
  renderCanvas();
  renderZoomReadout();
  setStatus('View reset to 100% and re-centred. The saved design is unchanged.');
}

/**
 * CREATOR-10: scale the viewer so the WHOLE profile is visible, main column and
 * sidebar alike.
 *
 * The design canvas is 960 wide, but the centre column is whatever the two side
 * panels leave over — usually narrower. At 100% the right-hand edge, where the
 * profile SIDEBAR lives, is clipped off-screen, so a creator cannot see where the
 * sidebar begins. Fit scales the design down (never up) until the whole profile
 * fits, then re-centres.
 *
 * Like zoom and pan this is VIEWER state only: it cannot move, resize or
 * otherwise touch a component, cannot change the canvas size, and cannot mark
 * the design dirty.
 */
function fitViewerToProfile() {
  const c = canvas();
  const { w, h } = viewerViewport();
  zoom = fitZoom({ contentW: c.width, contentH: c.minHeight, viewportW: w, viewportH: h });
  // Re-centre for the new scale: the whole profile is centred, not just pushed
  // back to the top-left corner.
  recentreViewer();
  renderCanvas();
  renderZoomReadout();
  setStatus(`Profile fitted to the viewer at ${zoomPercent(zoom)}. The saved design is unchanged.`);
}

// ── Layer operations ─────────────────────────────────────────────────────────
function orderedComps() {
  return [...components()].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

function reindexAndReassign(order) {
  order.forEach((comp, index) => { comp.zIndex = index; });
  markChanged();
}

function moveLayer(id, direction) {
  const order = orderedComps();
  const index = order.findIndex(c => c.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= order.length) return;
  pushHistory();
  const [removed] = order.splice(index, 1);
  order.splice(target, 0, removed);
  reindexAndReassign(order);
  setStatus('Layer reordered.');
}

function bringToFront(id) {
  const order = orderedComps();
  const index = order.findIndex(c => c.id === id);
  if (index === -1 || index === order.length - 1) return;
  pushHistory();
  const [removed] = order.splice(index, 1);
  order.push(removed);
  reindexAndReassign(order);
  setStatus('Moved to the top layer.');
}

function sendToBack(id) {
  const order = orderedComps();
  const index = order.findIndex(c => c.id === id);
  if (index === -1 || index === 0) return;
  pushHistory();
  const [removed] = order.splice(index, 1);
  order.unshift(removed);
  reindexAndReassign(order);
  setStatus('Moved to the bottom layer.');
}

function duplicateComponent(id) {
  const comp = findComp(id);
  if (!comp) return;
  pushHistory();
  const copy = clone(comp);
  copy.id = newId();
  copy.x = clamp(copy.x + 16, -10000, 10000);
  copy.y = clamp(copy.y + 16, -10000, 10000);
  copy.zIndex = components().reduce((max, c) => Math.max(max, c.zIndex ?? 0), -1) + 1;
  components().push(copy);
  selectedId = copy.id;
  markChanged('Component duplicated.');
}

/**
 * Remove a component.
 *
 * CREATOR-11: deleting a Card CASCADES to the components it contains. A child
 * that outlived its card would keep a dangling `parentId`, which the server
 * rejects — so leaving them behind would turn a valid design into one that
 * cannot be saved. Because this is a single deterministic edit to the layout
 * array, undo, redo, save and publish all see the same result.
 *
 * The whole subtree is captured up front, so a deeper chain could not be left
 * half-removed.
 */
function removeComponent(id) {
  const all = components();
  const index = all.findIndex(c => c.id === id);
  if (index === -1) return;

  pushHistory();
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const comp of all) {
      if (typeof comp.parentId === 'string' && doomed.has(comp.parentId) && !doomed.has(comp.id)) {
        doomed.add(comp.id);
        grew = true;
      }
    }
  }
  const removed = all.filter(c => doomed.has(c.id));
  currentDesign.layout = { ...layout(), components: all.filter(c => !doomed.has(c.id)) };
  if (doomed.has(selectedId)) selectedId = null;
  // A selected child of a removed card must not stay selected.
  for (const comp of removed) {
    if (selectedId === comp.id) selectedId = null;
  }
  const extra = removed.length - 1;
  markChanged(extra > 0
    ? `Card and ${extra} contained component${extra === 1 ? '' : 's'} removed.`
    : 'Component removed.');
}

// ── Canvas placement / dragging ──────────────────────────────────────────────
function nextZIndex() {
  return components().reduce((max, c) => Math.max(max, c.zIndex ?? 0), -1) + 1;
}

function placePending(type, pos) {
  const meta = ALL_SECTIONS.find(s => s.type === type);
  if (!meta) return;
  if (CONTROLLED_TYPES.has(type) && components().some(c => c.type === type)) {
    setStatus(`"${meta.label}" is already on the canvas — select it in Layers instead.`);
    return;
  }
  const c = canvas();
  const comp = {
    id: newId(),
    type,
    x: clamp(roundInt(pos.x - meta.w / 2), 0, Math.max(0, c.width - meta.w)),
    y: clamp(roundInt(pos.y - meta.h / 2), 0, Math.max(0, c.minHeight - meta.h)),
    width: meta.w,
    height: meta.h,
    zIndex: nextZIndex(),
    visible: true,
    locked: false,
    rotation: 0,
    config: meta.config ? { ...meta.config } : null,
    style: null,
  };
  components().push(comp);
  selectedId = comp.id;
  pushHistory();
  markChanged(`Added "${meta.label}". Edit its properties on the right.`);
  // Show the new component's properties immediately (markChanged refreshes
  // canvas + layers only, so the panel would otherwise still show the
  // previous selection until the next canvas/layer click).
  renderProperties();
}

let unionGuides = new Map();

function clearGuides() {
  if (!root) return;
  root.querySelectorAll('.studio-guide').forEach(el => el.remove());
  unionGuides = new Map();
}

function drawGuides() {
  root?.querySelectorAll('.studio-guide').forEach(el => el.remove());
  const doc = root?.querySelector('#studio-canvas-document');
  if (!doc) return;
  unionGuides.forEach((position, axis) => {
    const guide = document.createElement('div');
    guide.className = `studio-guide studio-guide-${axis}`;
    guide.style.transform = `scale(${1 / zoom})`;
    if (axis === 'v') guide.style.left = `${position}px`;
    else guide.style.top = `${position}px`;
    doc.appendChild(guide);
  });
}

function snapCoordinate(value, candidates) {
  let best = value;
  let delta = 0;
  for (const candidate of candidates) {
    const d = value - candidate;
    if (Math.abs(d) < SNAP && (delta === 0 || Math.abs(d) < Math.abs(delta))) {
      delta = d;
      best = candidate;
    }
  }
  return { value: best, guide: delta === 0 ? null : { position: best, distance: delta } };
}

function snapMove(comp, x, y) {
  const c = canvas();
  const others = components().filter(o => o.id !== comp.id).filter(o => o.visible !== false);
  const xs = [0, c.width / 2, c.width - comp.width];
  const ys = [0, c.minHeight / 2, c.minHeight - comp.height];
  others.forEach(o => {
    xs.push(o.x, o.x + o.width / 2, o.x + o.width - comp.width);
    ys.push(o.y, o.y + o.height / 2, o.y + o.height - comp.height);
  });
  const result = { x, y, guides: new Map() };
  const sx = snapCoordinate(x, xs.filter(Number.isFinite));
  const sy = snapCoordinate(y, ys.filter(Number.isFinite));
  result.x = sx.value;
  result.y = sy.value;
  if (sx.guide) result.guides.set('v', sx.guide.position);
  if (sy.guide) result.guides.set('h', sy.guide.position);
  return result;
}

function toDesignPoint(event) {
  const doc = root?.querySelector('#studio-canvas-document');
  if (!doc) return { x: 0, y: 0 };
  return designPoint({ clientX: event.clientX, clientY: event.clientY, rect: doc.getBoundingClientRect(), zoom });
}

function startMove(comp, event) {
  const point = toDesignPoint(event);
  drag = {
    mode: 'move',
    id: comp.id,
    startX: comp.x,
    startY: comp.y,
    pointerX: point.x,
    pointerY: point.y,
  };
  pushHistory();
  setStatus('Dragging — release to place. Guide lines snap to edges and centers.');
}

function startResize(comp, dir, event) {
  const point = toDesignPoint(event);
  drag = {
    mode: 'resize',
    id: comp.id,
    dir,
    startX: comp.x,
    startY: comp.y,
    startW: comp.width,
    startH: comp.height,
    pointerX: point.x,
    pointerY: point.y,
  };
  pushHistory();
  setStatus('Resizing — release to finish.');
}

function startPan(event) {
  drag = {
    mode: 'pan',
    id: null,
    pointerClientX: event.clientX,
    pointerClientY: event.clientY,
    startPanX: viewerPan.x,
    startPanY: viewerPan.y,
  };
  setStatus('Panning the viewer — the design itself is unchanged.');
}

function onPointerMove(event) {
  if (!drag || !currentDesign) return;

  // Workspace resize (CREATOR-07A). Both branches write editor layout state
  // only: no component geometry, no `dirty`, no undo history, no save.
  if (drag.mode === 'panel-resize') {
    panelWidths = columnWidthsFromDrag({
      startLeft: drag.startLeft,
      startRight: drag.startRight,
      edge: drag.edge,
      startClientX: drag.startClientX,
      clientX: event.clientX,
      totalWidth: drag.totalWidth,
      minPanel: MIN_PANEL_WIDTH,
      minCenter: MIN_CENTER_WIDTH,
    });
    applyWorkspaceState();
    return;
  }

  if (drag.mode === 'viewer-height') {
    // Dragging DOWN (larger clientY) makes the viewer TALLER, and dragging UP
    // makes it shorter. The height is measured from the viewer's real rendered
    // box, so the grip always tracks the actual bottom boundary.
    viewerHeight = clampViewerHeight(drag.startHeight + (event.clientY - drag.startClientY), {
      min: MIN_VIEWER_HEIGHT,
      fallback: DEFAULT_VIEWER_HEIGHT,
    });
    applyWorkspaceState();
    renderCanvas();
    return;
  }

  // Viewer pan: measured in screen pixels, so it is independent of zoom.
  if (drag.mode === 'pan') {
    const scaled = scaledCanvasSize();
    const { w, h } = viewerViewport();
    viewerPan = clampPan({
      panX: drag.startPanX + (event.clientX - drag.pointerClientX),
      panY: drag.startPanY + (event.clientY - drag.pointerClientY),
      viewportW: w,
      viewportH: h,
      contentW: scaled.w,
      contentH: scaled.h,
    });
    renderCanvas();
    return;
  }

  const point = toDesignPoint(event);
  const comp = findComp(drag.id);
  if (!comp) return;
  const c = canvas();
  // The pointer delta arrives in SCREEN axes. For an unrotated component those
  // are the design axes; for a rotated one the drag must be rotated back into
  // the component's own frame, otherwise a corner drag both resizes and swings
  // the box around. designPoint() has already divided out zoom, so the delta is
  // in design units.
  const rotation = Number(comp.rotation) || 0;
  let dx = point.x - drag.pointerX;
  let dy = point.y - drag.pointerY;
  if (rotation) {
    const rad = rotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    dx = localX;
    dy = localY;
  }

  clearGuides();

  // CREATOR-11: a nested child stores LOCAL coordinates, so its drag/resize is
  // clamped against its CARD, not the whole canvas. Moving the card does not
  // touch the child at all — the child simply rides along, because the card's
  // origin is applied when the child is drawn. A standalone component keeps the
  // original canvas bounds.
  const card = parentCardOf(comp);
  const bounds = card ? { width: card.width, minHeight: card.height } : c;
  // Snapping compares against siblings, which is only meaningful at the same
  // level, so it is skipped for a child inside a card.
  const canSnap = !card;

  if (drag.mode === 'move') {
    const x = clamp(roundInt(drag.startX + dx), 0, Math.max(0, bounds.width - comp.width));
    const y = clamp(roundInt(drag.startY + dy), 0, Math.max(0, bounds.minHeight - comp.height));
    if (canSnap) {
      const result = snapMove(comp, x, y);
      comp.x = result.x;
      comp.y = result.y;
      unionGuides = result.guides;
      drawGuides();
    } else {
      comp.x = x;
      comp.y = y;
    }
  } else {
    const dirs = drag.dir;
    let { x, y, width, height } = comp;
    if (dirs.includes('e')) {
      width = clamp(roundInt(drag.startW + dx), MIN_SIZE, Math.max(MIN_SIZE, bounds.width - x));
    }
    if (dirs.includes('s')) {
      height = clamp(roundInt(drag.startH + dy), MIN_SIZE, Math.max(MIN_SIZE, bounds.minHeight - y));
    }
    if (dirs.includes('w')) {
      const newX = clamp(roundInt(drag.startX + dx), 0, Math.max(0, drag.startX + drag.startW - MIN_SIZE));
      width = clamp(drag.startW + (drag.startX - newX), MIN_SIZE, Math.max(MIN_SIZE, bounds.width - newX));
      x = newX;
    }
    if (dirs.includes('n')) {
      const newY = clamp(roundInt(drag.startY + dy), 0, Math.max(0, drag.startY + drag.startH - MIN_SIZE));
      height = clamp(drag.startH + (drag.startY - newY), MIN_SIZE, Math.max(MIN_SIZE, bounds.minHeight - newY));
      y = newY;
    }
    comp.x = x;
    comp.y = y;
    comp.width = width;
    comp.height = height;
    // CREATOR-09 §13: rotation is deliberately left untouched by move and
    // resize — the value is the design's, and the drag is applied in the
    // component's own rotated frame above, so the box does not swing either.
    // CREATOR-11: resizing a CHILD never rescales its image source. Only the
    // component box changes; the <img> keeps the same src and is refitted by
    // CSS, so nothing is ever rasterised or re-encoded.
  }
  renderCanvas();
  renderLayers();
  // CREATOR-09 §12: dragging/resizing updates the Properties fields too.
  syncGeometryFields(comp);
}

function onPointerUp() {
  if (!drag) return;
  const wasPan = drag.mode === 'pan';
  const wasWorkspaceResize = drag.mode === 'panel-resize' || drag.mode === 'viewer-height';
  drag = null;
  clearGuides();
  root?.classList.remove('studio-workspace-resizing');
  // Workspace resizing and panning are NOT edits: neither may mark the design
  // dirty, save, or add an undo entry.
  if (wasWorkspaceResize) {
    applyWorkspaceState();
    setStatus('Workspace resized. The saved design is unchanged.');
    return;
  }
  if (wasPan) {
    setStatus('Viewer moved. The saved design is unchanged.');
    return;
  }
  dirty = true;
  renderCanvas();
  renderLayers();
  // CREATOR-09 §12: a full refresh on release so every derived field (geometry,
  // align previews, the component title) settles to the final values.
  renderProperties();
  updateToolbar();
  setStatus('Placed. Press Ctrl+Z to undo.');
}

function onStagePointerDown(event) {
  if (!root || previewMode || busy) return;
  if (event.button !== 0) return;
  const doc = root.querySelector('#studio-canvas-document');
  if (!doc) return;

  const resizeHandle = event.target.closest('[data-resize]');
  const compElement = event.target.closest('[data-comp-id]');
  if (resizeHandle && compElement) {
    const comp = findComp(compElement.dataset.compId);
    if (!comp || comp.locked) return;
    event.preventDefault();
    startResize(comp, resizeHandle.dataset.resize, event);
    return;
  }

  if (compElement) {
    const comp = findComp(compElement.dataset.compId);
    if (!comp) return;
    if (selectedId !== comp.id) {
      selectedId = comp.id;
      renderAll();
    } else if (!previewMode) {
      renderCanvas();
      renderLayers();
    }
    if (comp.locked) return;
    event.preventDefault();
    startMove(comp, event);
    return;
  }

  // Empty canvas area.
  event.preventDefault();
  if (pendingType) {
    const meta = ALL_SECTIONS.find(s => s.type === pendingType);
    placePending(pendingType, toDesignPoint(event));
    pendingType = null;
    return;
  }
  if (selectedId !== null) {
    selectedId = null;
    renderAll();
  }
  // CREATOR-06: dragging empty canvas pans the viewer. Component dragging is
  // handled above, so the two gestures never compete for the same pointer.
  startPan(event);
}

// ── Events ───────────────────────────────────────────────────────────────────
function onKey(event) {
  if (!root || !currentDesign || previewMode) return;
  const target = event.target;
  const typing = target && target.closest && target.closest('input, textarea, select');
  const mod = event.ctrlKey || event.metaKey;

  if (typing) {
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    return;
  }

  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
    return;
  }

  if (selectedId) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeComponent(selectedId);
      return;
    }
    if (event.key === 'Escape') {
      selectedId = null;
      renderAll();
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[event.key]) {
      event.preventDefault();
      const comp = findComp(selectedId);
      if (!comp || comp.locked) return;
      pushHistory();
      comp.x = clamp(comp.x + arrows[event.key][0], -10000, 10000);
      comp.y = clamp(comp.y + arrows[event.key][1], -10000, 10000);
      dirty = true;
      renderCanvas();
      renderLayers();
      // CREATOR-06: the X/Y fields must reflect the nudge immediately,
      // otherwise arrow-key movement looks like it did nothing.
      renderProperties();
      updateToolbar();
    }
    return;
  }

  // CREATOR-06: nothing selected — arrows pan the viewer instead. This only
  // moves the view; it never edits the design.
  const viewerArrows = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (viewerArrows[event.key]) {
    event.preventDefault();
    panViewer(viewerArrows[event.key]);
  }
}

function onLayersClick(event) {
  const row = event.target.closest('[data-layer-id]');
  if (!row) return;
  const id = row.dataset.layerId;
  const actionElement = event.target.closest('[data-action]');
  if (actionElement) {
    const action = actionElement.dataset.action;
    const comp = findComp(id);
    if (!comp) return;
    if (action === 'select') {
      selectedId = id;
      renderAll();
      return;
    }
    if (action === 'toggle-visibility') {
      pushHistory();
      comp.visible = !comp.visible;
      markChanged(comp.visible ? 'Component is visible.' : 'Component is hidden.');
      return;
    }
    if (action === 'toggle-lock') {
      pushHistory();
      comp.locked = !comp.locked;
      markChanged(comp.locked ? 'Component is locked.' : 'Component is unlocked.');
      return;
    }
    if (action === 'duplicate') { duplicateComponent(id); return; }
    if (action === 'delete') { removeComponent(id); return; }
    if (action === 'front') { bringToFront(id); return; }
    if (action === 'back') { sendToBack(id); return; }
    if (action === 'forward') { moveLayer(id, 1); return; }
    if (action === 'backward') { moveLayer(id, -1); return; }
    return;
  }
}

function onLayersChange(event) {
  const zInput = event.target.closest('.studio-layer-z');
  if (!zInput) return;
  const row = zInput.closest('[data-layer-id]');
  if (!row) return;
  const comp = findComp(row.dataset.layerId);
  if (!comp) return;
  let value = parseInt(zInput.value, 10);
  if (!Number.isFinite(value)) { zInput.value = String(comp.zIndex ?? 0); return; }
  value = clamp(value, 0, 10000);
  pushHistory();
  comp.zIndex = value;
  zInput.value = String(value);
  markChanged();
}

function onElementListClick(event) {
  const add = event.target.closest('[data-add]');
  if (add) {
    const type = add.dataset.add;
    const meta = ALL_SECTIONS.find(s => s.type === type);
    if (CONTROLLED_TYPES.has(type) && components().some(c => c.type === type)) {
      setStatus(`"${meta ? meta.label : type}" is already on the canvas.`);
      return;
    }
    const c = canvas();
    placePending(type, { x: c.width / 2, y: c.minHeight / 2 });
    return;
  }
  const item = event.target.closest('[data-type]');
  if (item) {
    pendingType = item.dataset.type;
    setStatus('Click anywhere on the canvas to place it.');
  }
}

function onDragStart(event) {
  const item = event.target.closest('[data-type]');
  if (!item) return;
  event.dataTransfer.setData('text/plain', item.dataset.type);
  event.dataTransfer.effectAllowed = 'copy';
}

function onCanvasDrop(event) {
  event.preventDefault();
  if (previewMode) return;
  const type = event.dataTransfer.getData('text/plain') || pendingType;
  if (!type) return;
  placePending(type, toDesignPoint(event));
  pendingType = null;
}

// ── Save / publish / design switching ────────────────────────────────────────
async function runAction(action) {
  if (busy) return;
  busy = true;
  const controls = [...(root?.querySelectorAll('button, input, select, textarea') || [])];
  const states = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try {
    return await action();
  } catch (error) {
    setStatus(error.message || 'Something went wrong. Please try again.');
    return null;
  } finally {
    controls.forEach((control, index) => { control.disabled = states[index]; });
    busy = false;
  }
}

async function saveDraft() {
  if (!currentDesign) return null;
  return runAction(async () => {
    setStatus('Saving draft…');
    // CREATOR-15: Save is an explicit, versioned snapshot. The server
    // validates the full design, compares it against the persisted state
    // and appends a new immutable version only when something changed —
    // so every Save is a recoverable point in the project's history.
    const result = await versionApi.saveVersion(currentDesign.id, {
      name: currentDesign.name,
      layout: clone(layout()),
      // CREATOR-10: the Profile Background is design-level theme configuration,
      // so it is saved with the design and published with it. Sending the theme
      // is what carries the background; the server validates it strictly.
      theme: isPlainTheme(currentDesign.theme) ? clone(currentDesign.theme) : null,
    });
    currentDesign = normalizeDesign(result.project);
    // CREATOR-10A: a staged upload belongs to the design it was staged in, so
    // switching designs must never carry it over as a phantom background.
    resetPendingBackground();
    designs = designs.map(d => (d.id === currentDesign.id ? currentDesign : d));
    renderDesignSelect();
    renderProperties();
    dirty = false;
    updateToolbar();
    updateProjectNameIndicator();
    if (result.saved === false) {
      setStatus(`Already saved — no changes since version ${result.version}.`);
    } else {
      setStatus(`Saved as version ${result.version}. Publish to show it on your profile.`);
    }
    return currentDesign;
  });
}

async function publish() {
  if (!currentDesign) return;
  if (dirty || !currentDesign.id) {
    const saved = await saveDraft();
    if (!saved) return;
  }
  await runAction(async () => {
    setStatus('Publishing…');
    const result = await designApi.publishDesign(currentDesign.id);
    currentDesign = normalizeDesign(result.design);
    // CREATOR-10A: a staged upload belongs to the design it was staged in, so
    // switching designs must never carry it over as a phantom background.
    resetPendingBackground();
    designs = designs.map(d => (d.id === currentDesign.id ? currentDesign : d));
    renderDesignSelect();
    dirty = false;
    updateToolbar();
    setStatus(`Published "${currentDesign.name}". It is now live on your profile.`);
  });
}

// ── Save as Creator Asset (CREATOR-02) ───────────────────────────────────────
const ASSET_TYPE_LABELS = {
  profile_design: 'Profile Design (this layout)',
  theme: 'Theme (this design theme)',
  background: 'Background (image)',
  sticker: 'Sticker (image)',
  decoration: 'Decoration (image)',
};
const ASSET_IMAGE_TYPES = new Set(['background', 'sticker', 'decoration']);

function openSaveAssetModal() {
  if (!currentDesign) return;
  closeAssetModal();

  const overlay = document.createElement('div');
  overlay.className = 'studio-modal-overlay';
  overlay.dataset.close = '';
  overlay.innerHTML = `
    <div class="studio-modal" role="dialog" aria-modal="true" aria-labelledby="studio-asset-title">
      <button type="button" class="studio-modal-close" data-close aria-label="Close">&times;</button>
      <h2 id="studio-asset-title">Save as Coin Shop Asset</h2>
      <p class="studio-modal-note">Create a Coin Shop product from this design. Your live
      profile design and drafts are not changed — a published asset keeps its own immutable
      snapshot, so later design edits never change the Coin Shop product. Publish it to make
      it publicly discoverable and buyable with KomuniPH Coins.</p>
      <label class="studio-field"><span>Asset name</span>
        <input id="studio-asset-name" type="text" maxlength="100" required></label>
      <label class="studio-field"><span>Description</span>
        <textarea id="studio-asset-desc" rows="3" maxlength="2000"></textarea></label>
      <label class="studio-field"><span>Asset type</span>
        <select id="studio-asset-type">${Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label class="studio-field"><span>Price (Coins)</span>
        <input id="studio-asset-price" type="number" min="1" step="1" value="100">
        <small class="studio-modal-hint">Positive whole Coins. Buyers purchase with their KomuniPH Coin wallet; a 0-coin asset cannot be bought.</small></label>
      <div id="studio-asset-image-fields" class="studio-field-group" hidden>
        <label class="studio-field"><span>Image URL</span>
          <input id="studio-asset-image-url" type="text" placeholder="https://example.com/image.png"></label>
        <label class="studio-field"><span>Fit</span>
          <select id="studio-asset-fit">
            <option value="contain">Contain</option>
            <option value="cover">Cover</option>
            <option value="fill">Fill</option>
          </select></label>
      </div>
      <div class="studio-modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="studio-asset-save">Save as Draft Asset</button>
      </div>
      <div id="studio-asset-result"></div>
    </div>`;
  overlay.addEventListener('pointerdown', event => {
    if (event.target === overlay || event.target.dataset.close !== undefined) closeAssetModal();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeAssetModal();
    }
  });

  root.appendChild(overlay);
  assetModal = overlay;

  const nameInput = overlay.querySelector('#studio-asset-name');
  const base = (currentDesign.name || 'My Design').slice(0, 80);
  nameInput.value = `${base} — marketplace asset`;

  overlay.querySelector('#studio-asset-type').addEventListener('change', () => {
    const type = overlay.querySelector('#studio-asset-type').value;
    overlay.querySelector('#studio-asset-image-fields').hidden = !ASSET_IMAGE_TYPES.has(type);
  });

  overlay.querySelector('#studio-asset-save').addEventListener('click', () => saveAssetFromModal());
}

function assetDataFromModal(overlay, type) {
  if (type === 'profile_design') {
    return { layout: clone(layout()), theme: currentDesign.theme ?? null };
  }
  if (type === 'theme') {
    return { theme: currentDesign.theme ?? null };
  }
  const imageUrl = overlay.querySelector('#studio-asset-image-url').value.trim();
  const fit = overlay.querySelector('#studio-asset-fit').value;
  return { imageUrl, fit };
}

function renderAssetResult(message) {
  const overlay = assetModal;
  if (!overlay) return;
  const box = overlay.querySelector('#studio-asset-result');
  const asset = assetModalAsset;
  if (!asset) {
    box.textContent = message || '';
    return;
  }
  box.innerHTML = `
    <p class="studio-modal-status"><strong>${asset.name}</strong> — ${asset.status} (v${asset.version}). ${message || ''}</p>
    <div class="studio-modal-actions">
      ${asset.status === 'draft' ? '<button type="button" class="btn btn-primary" id="studio-asset-submit">Submit</button>' : ''}
      ${asset.status === 'submitted' ? '<button type="button" class="btn btn-cta" id="studio-asset-publish">Publish to Coin Shop</button>' : ''}
      ${asset.status === 'published' ? `<a href="#/coin-shop/product/${asset.id}" class="btn btn-secondary">View in Coin Shop</a>` : ''}
      <a href="#/creator-studio/coin-shop" class="btn btn-secondary">Manage in Coin Shop</a>
      <button type="button" class="btn btn-secondary" data-close>Done</button>
    </div>`;
  const submit = box.querySelector('#studio-asset-submit');
  if (submit) submit.addEventListener('click', () => submitAssetFromModal());
  const publish = box.querySelector('#studio-asset-publish');
  if (publish) publish.addEventListener('click', () => publishAssetFromModal());
}

async function saveAssetFromModal() {
  const overlay = assetModal;
  if (!overlay) return;
  const name = overlay.querySelector('#studio-asset-name').value.trim();
  const description = overlay.querySelector('#studio-asset-desc').value.trim();
  const type = overlay.querySelector('#studio-asset-type').value;
  const priceCoins = Number(overlay.querySelector('#studio-asset-price').value);
  if (!name) {
    setStatus('Asset name is required.');
    return;
  }
  const assetData = assetDataFromModal(overlay, type);
  if (ASSET_IMAGE_TYPES.has(type) && !assetData.imageUrl) {
    setStatus('Image URL is required for this asset type.');
    return;
  }
  await runAction(async () => {
    setStatus('Creating asset…');
    const result = await creatorAssetsApi.createAsset({
      name,
      description,
      asset_type: type,
      price_coins: priceCoins,
      asset_data: assetData,
    });
    assetModalAsset = result.asset;
    setStatus(`Asset "${result.asset.name}" created as a draft.`);
    renderAssetResult('Created as a draft. Submit it when the content is final.');
  });
}

async function submitAssetFromModal() {
  const asset = assetModalAsset;
  if (!asset) return;
  await runAction(async () => {
    setStatus('Submitting asset…');
    const result = await creatorAssetsApi.submitAsset(asset.id);
    assetModalAsset = result.asset;
    setStatus(`Asset "${result.asset.name}" submitted and validated.`);
    renderAssetResult('Submitted and validated — ready to publish.');
  });
}

async function publishAssetFromModal() {
  const asset = assetModalAsset;
  if (!asset) return;
  await runAction(async () => {
    setStatus('Publishing asset…');
    const result = await creatorAssetsApi.publishAsset(asset.id);
    assetModalAsset = result.asset;
    setStatus(`Asset "${result.asset.name}" published (v${result.asset.version}).`);
    renderAssetResult('Published. It will be available to buyers in a future Marketplace milestone.');
  });
}

function closeAssetModal() {
  if (assetModal && assetModal.parentNode) {
    assetModal.remove();
  }
  assetModal = null;
  assetModalAsset = null;
}

// ── Version History (CREATOR-15) ────────────────────────────────
//
// The history modal lists every saved version (metadata only) and
// previews a selected version's full snapshot. The preview is
// rendered by buildDesignDocument — the SAME document builder the
// canvas uses — so a version previews exactly as the canvas renders
// the live design. Runtime effect state (frames, rAF loops,
// controllers) is created for the preview and torn down with it;
// it is never part of any version.

function escapeVersionText(text) {
  if (text == null) return '';
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatVersionTime(isoString) {
  if (!isoString) return 'Unknown';
  const date = new Date(String(isoString).replace(' ', 'T'));
  if (isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Stop the preview's effect loop and drop the tracked layer.
 * The renderer keeps playback state per layer, so stopping the
 * preview's layer never touches the canvas's own effect.
 */
function stopVersionPreviewEffect() {
  if (versionPreviewEffectLayer) {
    try { clearProfileBackgroundEffect(versionPreviewEffectLayer); } catch { /* best effort */ }
    versionPreviewEffectLayer = null;
  }
}

function closeVersionHistoryModal() {
  stopVersionPreviewEffect();
  if (versionHistoryModal && versionHistoryModal.parentNode) {
    versionHistoryModal.remove();
  }
  versionHistoryModal = null;
  versionPreviewVersion = null;
}

/**
 * Render a stored version's snapshot into the preview stage,
 * read-only: no selection handles, no canvas-only element ids.
 */
function renderVersionPreview(version) {
  const stage = versionHistoryModal?.querySelector('#studio-version-preview-stage');
  if (!stage) return;
  stopVersionPreviewEffect();
  stage.replaceChildren();
  versionPreviewVersion = version;

  const doc = buildDesignDocument(version.layout, version.theme, {
    interactive: false,
    includeSkeleton: true,
  });
  stage.appendChild(doc);

  // The effect layer the preview just created (its id was stripped
  // so it cannot collide with the canvas's). Track it so closing
  // the modal stops its animation loop.
  versionPreviewEffectLayer = doc.querySelector('.studio-profile-effect-layer') || null;

  const restoreBtn = versionHistoryModal?.querySelector('#studio-version-restore');
  if (restoreBtn) {
    restoreBtn.disabled = version.is_current === true;
    restoreBtn.textContent = version.is_current ? 'Current version' : `Restore v${version.version}`;
  }
  const result = versionHistoryModal?.querySelector('#studio-version-result');
  if (result) result.replaceChildren();
}

function renderVersionList(versions) {
  const list = versionHistoryModal?.querySelector('#studio-version-list');
  if (!list) return;
  list.replaceChildren();
  if (!versions.length) {
    const empty = document.createElement('p');
    empty.className = 'studio-modal-note';
    empty.textContent = 'No versions yet. Save the project to create the first version.';
    list.appendChild(empty);
    return;
  }
  for (const version of versions) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'studio-version-row';
    if (version.is_current) row.classList.add('studio-version-current');

    const num = document.createElement('span');
    num.className = 'studio-version-num';
    num.textContent = `v${version.version}`;

    const meta = document.createElement('span');
    meta.className = 'studio-version-meta';
    const name = document.createElement('strong');
    name.textContent = version.name;
    const when = document.createElement('small');
    when.textContent = `${formatVersionTime(version.created_at)}${version.restored_from_version ? ` · restored from v${version.restored_from_version}` : ''}`;
    meta.append(name, when);

    row.append(num, meta);
    if (version.is_current) {
      const badge = document.createElement('span');
      badge.className = 'studio-version-badge';
      badge.textContent = 'current';
      row.appendChild(badge);
    }

    row.addEventListener('click', () => {
      // The list carries metadata only; the full snapshot is
      // fetched on demand, so the history stays cheap.
      loadVersionPreview(version.version);
    });
    list.appendChild(row);
  }
}

async function loadVersionPreview(versionNumber) {
  if (!currentDesign || !versionHistoryModal) return;
  const result = versionHistoryModal.querySelector('#studio-version-result');
  if (result) result.replaceChildren();
  try {
    const snapshot = await versionApi.getVersion(currentDesign.id, versionNumber);
    // The modal may have been closed while the request was in flight.
    if (!versionHistoryModal) return;
    renderVersionPreview(snapshot.version);
  } catch (error) {
    if (!versionHistoryModal) return;
    if (result) result.textContent = `Could not load version ${versionNumber}: ${error.message}`;
  }
}

async function openVersionHistoryModal() {
  if (!currentDesign) return;
  closeVersionHistoryModal();

  const overlay = document.createElement('div');
  overlay.className = 'studio-modal-overlay studio-version-overlay';
  overlay.dataset.close = '';
  overlay.innerHTML = `
    <div class="studio-modal studio-version-modal" role="dialog" aria-modal="true" aria-labelledby="studio-version-title">
      <button type="button" class="studio-modal-close" data-close aria-label="Close">&times;</button>
      <h2 id="studio-version-title">Version History</h2>
      <p class="studio-modal-note">Every Save appends an immutable version of this project.
      Restoring an older version never deletes history — it saves the restored state as a
      NEW version.</p>
      <div class="studio-version-body">
        <div class="studio-version-list" id="studio-version-list" aria-label="Saved versions"></div>
        <div class="studio-version-preview">
          <div class="studio-version-preview-stage" id="studio-version-preview-stage"></div>
        </div>
      </div>
      <div class="studio-modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Close</button>
        <button type="button" class="btn btn-primary" id="studio-version-restore" disabled>Restore</button>
      </div>
      <div id="studio-version-result" class="studio-version-result"></div>
    </div>`;
  versionHistoryModal = overlay;
  root.appendChild(overlay);

  overlay.addEventListener('pointerdown', event => {
    if (event.target === overlay || event.target.dataset.close !== undefined) closeVersionHistoryModal();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeVersionHistoryModal();
    }
  });

  overlay.querySelector('#studio-version-restore').addEventListener('click', restoreVersionFromModal);

  const list = overlay.querySelector('#studio-version-list');
  list.innerHTML = '<p class="studio-modal-note">Loading versions…</p>';
  try {
    const result = await versionApi.listVersions(currentDesign.id);
    // The modal may have been closed while the request was in flight.
    if (versionHistoryModal !== overlay) return;
    renderVersionList(result.versions || []);
  } catch (error) {
    if (versionHistoryModal !== overlay) return;
    list.replaceChildren();
    const err = document.createElement('p');
    err.className = 'studio-modal-note';
    err.textContent = `Could not load version history: ${error.message}`;
    list.appendChild(err);
  }
}

async function restoreVersionFromModal() {
  if (!currentDesign || !versionPreviewVersion) return;
  const target = versionPreviewVersion;
  if (target.is_current) return;
  if (!window.confirm(`Restore version ${target.version} ("${target.name}")? It becomes the new current version. Unsaved editor changes are discarded; the version history is kept.`)) return;

  const restoreBtn = versionHistoryModal?.querySelector('#studio-version-restore');
  if (restoreBtn) restoreBtn.disabled = true;
  const resultBox = versionHistoryModal?.querySelector('#studio-version-result');
  if (resultBox) resultBox.textContent = '';

  try {
    const result = await versionApi.restoreVersion(currentDesign.id, target.version);
    // Reload the restored state into the editor exactly like a
    // design switch: the server is the source of truth for the
    // new current version. Unsaved editor changes are
    // intentionally discarded — they were never part of any version.
    dirty = false;
    await switchDesign(currentDesign.id);
    designs = designs.map(d => (d.id === currentDesign.id ? currentDesign : d));
    renderDesignSelect();
    updateProjectNameIndicator();
    setStatus(`Restored version ${target.version} as version ${result.version}.`);
    closeVersionHistoryModal();
  } catch (error) {
    if (resultBox) resultBox.textContent = `Restore failed: ${error.message}`;
    if (restoreBtn) restoreBtn.disabled = false;
  }
}

// CREATOR-16: Asset Library modal
// A creator-scoped registry of reusable asset references across projects.
// Items reference existing assets without duplicating them.
const LIBRARY_SOURCE_LABELS = {
  image: 'Uploaded Image',
  background: 'Background',
  sticker: 'Sticker',
  decoration: 'Decoration',
  effect: 'Background Effect',
  project: 'Project',
  creator_asset: 'Creator Asset',
};

const LIBRARY_SOURCE_ICONS = {
  image: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  background: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 16l5-5 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  sticker: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" fill="none" stroke="currentColor" stroke-width="1.5"/><polyline points="15 3 15 9 21 9" stroke="currentColor" stroke-width="1.5"/></svg>`,
  decoration: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  effect: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 12l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  project: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="1.5"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.5"/></svg>`,
  creator_asset: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

function closeLibraryModal() {
  if (librarySearchDebounce) {
    clearTimeout(librarySearchDebounce);
    librarySearchDebounce = null;
  }
  if (libraryModal && libraryModal.parentNode) {
    libraryModal.remove();
  }
  libraryModal = null;
  libraryItems = [];
}

async function openLibraryModal() {
  if (libraryModal) return;

  const overlay = document.createElement('div');
  overlay.className = 'studio-modal-overlay';
  overlay.innerHTML = `
    <div class="studio-modal" role="dialog" aria-modal="true" aria-labelledby="studio-library-title">
      <h2 id="studio-library-title">Asset Library</h2>
      <button class="studio-modal-close" data-close aria-label="Close">×</button>
      <p class="studio-modal-note">Your persistent library of reusable assets. Items reference existing assets — they never duplicate files. Add from any design, use in any design.</p>

      <div class="studio-library-toolbar">
        <input type="search" id="studio-library-search" class="studio-library-search" placeholder="Search your library..." aria-label="Search library items" maxlength="100">
        <select id="studio-library-filter" aria-label="Filter by source type">
          <option value="all">All Types</option>
          <option value="image">Uploaded Images</option>
          <option value="background">Backgrounds</option>
          <option value="sticker">Stickers</option>
          <option value="decoration">Decorations</option>
          <option value="effect">Background Effects</option>
          <option value="project">Projects</option>
          <option value="creator_asset">Creator Assets</option>
        </select>
        <button type="button" class="btn btn-secondary" id="studio-library-add">Add Current Design</button>
      </div>

      <div id="studio-library-list" class="studio-library-list" aria-label="Library items"></div>

      <div id="studio-library-empty" class="studio-library-empty" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        <p>Your library is empty</p>
        <small>Add assets from your designs or upload images to start building your reusable collection.</small>
      </div>

      <div class="studio-modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Close</button>
      </div>
    </div>`;

  overlay.addEventListener('pointerdown', event => {
    if (event.target === overlay || event.target.dataset.close !== undefined) closeLibraryModal();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeLibraryModal();
    }
  });

  root.appendChild(overlay);
  libraryModal = overlay;

  // Filter handler — always reload from the server, so the collection
  // matches the selected type even when the previous load used another
  // filter (a client-side re-render can only see stale items).
  const filterSelect = overlay.querySelector('#studio-library-filter');
  filterSelect.value = libraryFilter;
  filterSelect.addEventListener('change', () => {
    libraryFilter = filterSelect.value;
    loadLibraryItems();
  });

  // Search handler (debounced) — the server matches name and description.
  const searchInput = overlay.querySelector('#studio-library-search');
  searchInput.value = librarySearch;
  searchInput.addEventListener('input', () => {
    librarySearch = searchInput.value;
    if (librarySearchDebounce) clearTimeout(librarySearchDebounce);
    librarySearchDebounce = setTimeout(() => {
      librarySearchDebounce = null;
      loadLibraryItems();
    }, 200);
  });

  // Add current design button
  overlay.querySelector('#studio-library-add').addEventListener('click', () => addCurrentDesignToLibrary());

  // Load items
  await loadLibraryItems();
}

async function loadLibraryItems() {
  if (!libraryModal) return;
  const list = libraryModal.querySelector('#studio-library-list');
  const empty = libraryModal.querySelector('#studio-library-empty');
  list.replaceChildren();
  list.innerHTML = '<p class="studio-modal-note">Loading library…</p>';

  try {
    const result = await creatorLibraryApi.listItems({
      sourceType: libraryFilter === 'all' ? undefined : libraryFilter,
      q: librarySearch.trim() || undefined,
      limit: 100,
    });
    libraryItems = result.items || [];
    renderLibraryList();
  } catch (error) {
    list.replaceChildren();
    const err = document.createElement('p');
    err.className = 'studio-modal-note';
    err.style.color = 'var(--studio-danger)';
    err.textContent = `Could not load library: ${error.message}`;
    list.appendChild(err);
  }
}

function renderLibraryList() {
  if (!libraryModal) return;
  const list = libraryModal.querySelector('#studio-library-list');
  const empty = libraryModal.querySelector('#studio-library-empty');
  list.replaceChildren();

  const filtered = libraryFilter === 'all'
    ? libraryItems
    : libraryItems.filter(item => item.source_type === libraryFilter);

  if (filtered.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const item of filtered) {
    const row = document.createElement('div');
    row.className = 'studio-library-item';
    row.dataset.id = item.id;

    const icon = document.createElement('span');
    icon.className = 'studio-library-icon';
    icon.innerHTML = LIBRARY_SOURCE_ICONS[item.source_type] || '';

    const info = document.createElement('div');
    info.className = 'studio-library-info';
    const name = document.createElement('strong');
    name.textContent = item.name;
    const meta = document.createElement('span');
    meta.className = 'studio-library-meta';
    meta.textContent = `${LIBRARY_SOURCE_LABELS[item.source_type] || item.source_type} · ${item.description || 'No description'}`;
    info.append(name, meta);

    const preview = document.createElement('div');
    preview.className = 'studio-library-preview';
    if (item.preview_url) {
      const img = document.createElement('img');
      img.src = item.preview_url;
      img.alt = '';
      img.loading = 'lazy';
      preview.appendChild(img);
    } else {
      preview.textContent = 'No preview';
    }

    const actions = document.createElement('div');
    actions.className = 'studio-library-actions';

    // Use button - behavior depends on source type
    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'btn btn-primary btn-sm';
    useBtn.textContent = getUseButtonLabel(item.source_type);
    useBtn.title = getUseButtonTitle(item.source_type);
    useBtn.addEventListener('click', () => useLibraryItem(item));
    actions.appendChild(useBtn);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-secondary btn-sm';
    removeBtn.textContent = 'Remove';
    removeBtn.title = 'Remove from library (does not delete the source asset)';
    removeBtn.addEventListener('click', () => removeLibraryItem(item.id));
    actions.appendChild(removeBtn);

    row.append(icon, info, preview, actions);
    list.appendChild(row);
  }
}

function getUseButtonLabel(sourceType) {
  switch (sourceType) {
    case 'image': return 'Use as Image';
    case 'background': return 'Use as Background';
    case 'sticker': return 'Use as Sticker';
    case 'decoration': return 'Use as Decoration';
    case 'effect': return 'Apply Effect';
    case 'project': return 'Open Project';
    case 'creator_asset': return 'View Asset';
    default: return 'Use';
  }
}

function getUseButtonTitle(sourceType) {
  switch (sourceType) {
    case 'image': return 'Add this image to the canvas as an Image component';
    case 'background': return 'Set this as the profile background image';
    case 'sticker': return 'Add this sticker to the canvas';
    case 'decoration': return 'Decorations cannot be placed on the canvas yet (future component type)';
    case 'effect': return 'Apply this background effect to the design';
    case 'project': return 'Switch to this project';
    case 'creator_asset': return 'View this asset in Coin Shop';
    default: return 'Use this asset';
  }
}

async function useLibraryItem(item) {
  if (!libraryModal) return;

  try {
    switch (item.source_type) {
      case 'decoration': {
        // 'decoration' is a FUTURE canvas component type (see
        // FUTURE_COMPONENT_TYPES in the design validator): inserting one
        // would produce a design the server refuses to save. The item
        // stays a valid library reference — say so instead of breaking
        // the design.
        setStatus('Decoration components are not yet supported by the design engine — the item stays in your library.');
        return;
      }
      case 'image':
      case 'sticker': {
        // Add as Image or Sticker component
        const type = item.source_type;
        const fit = item.metadata?.fit || 'cover';
        const imageUrl = item.preview_url;
        if (!imageUrl) {
          setStatus('This item has no preview URL');
          return;
        }
        const c = canvas();
        const meta = ALL_SECTIONS.find(s => s.type === type);
        const comp = {
          id: newId(),
          type,
          x: Math.max(0, Math.round((c.width - (meta?.w || 320)) / 2)),
          y: Math.max(0, Math.round((c.minHeight - (meta?.h || 240)) / 2)),
          width: meta?.w || 320,
          height: meta?.h || 240,
          zIndex: nextZIndex(),
          visible: true,
          locked: false,
          rotation: 0,
          config: { imageUrl, fit, alt: item.name },
          style: null,
        };
        components().push(comp);
        selectedId = comp.id;
        pushHistory();
        markChanged(`Added "${item.name}" as ${type}.`);
        closeLibraryModal();
        break;
      }
      case 'background': {
        // Set as profile background
        const imageUrl = item.preview_url;
        if (!imageUrl) {
          setStatus('This item has no preview URL');
          return;
        }
        const t = designTheme();
        if (!isPlainTheme(t)) currentDesign.theme = t = {};
        pushHistory();
        t.backgroundImage = imageUrl;
        t.backgroundSize = item.metadata?.fit || 'cover';
        t.backgroundPosition = 'center';
        t.backgroundRepeat = 'no-repeat';
        markChanged(`Background set to "${item.name}".`);
        closeLibraryModal();
        break;
      }
      case 'effect': {
        // Apply background effect
        const def = effectDefinitionFor(item.source_id);
        if (!def) {
          setStatus('Effect definition not found');
          return;
        }
        pushHistory();
        const t = designTheme();
        if (!isPlainTheme(t)) currentDesign.theme = t = {};
        t.backgroundEffect = {
          enabled: true,
          effectId: item.source_id,
          source: 'creator',
          version: 1,
          config: { ...(def.config || {}) },
        };
        markChanged(`Background effect "${item.name}" applied.`);
        closeLibraryModal();
        break;
      }
      case 'project': {
        // Switch to project
        closeLibraryModal();
        if (dirty && !window.confirm('Discard unsaved changes to switch projects?')) return;
        await switchDesign(item.source_id);
        break;
      }
      case 'creator_asset': {
        // Navigate to coin shop product
        closeLibraryModal();
        navigate(`/coin-shop/product/${item.source_id}`);
        break;
      }
    }
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

async function addCurrentDesignToLibrary() {
  if (!currentDesign || !libraryModal) return;

  // Get the design's thumbnail if available
  let previewUrl = null;
  if (currentDesign.thumbnail_url) {
    previewUrl = currentDesign.thumbnail_url;
  }

  const name = currentDesign.name || 'Untitled Design';
  const description = `Project: ${currentDesign.name}`;

  try {
    const result = await creatorLibraryApi.createItem({
      name,
      description,
      source_type: 'project',
      source_id: currentDesign.id,
      preview_url: previewUrl,
      metadata: { version: currentDesign.version, status: currentDesign.status },
    });
    setStatus(`Added "${result.item.name}" to your library.`);
    await loadLibraryItems();
  } catch (error) {
    if (error.status === 409) {
      setStatus('This project is already in your library.');
    } else {
      setStatus(`Failed to add: ${error.message}`);
    }
  }
}

async function removeLibraryItem(itemId) {
  if (!libraryModal) return;
  if (!window.confirm('Remove this item from your library? The source asset is not deleted.')) return;

  try {
    await creatorLibraryApi.deleteItem(itemId);
    setStatus('Removed from library.');
    await loadLibraryItems();
  } catch (error) {
    setStatus(`Failed to remove: ${error.message}`);
  }
}

// CREATOR-17: MP3 Music Player modal.
// A compact player over the creator's OWN uploaded tracks. The player instance
// is created fresh per open and destroyed on every close, so playback, event
// listeners and the media element can never outlive the modal or navigation.
// The track source is always a server-issued /uploads/creator-audio/ URL from
// an ownership-checked row — the studio never invents a path.

/** Readable label for an audio row: filename stem + size. */
function audioTrackLabel(track) {
  const fromUrl = String(track.url || '').split('/').pop() || '';
  const stem = fromUrl.replace(/\.mp3$/i, '');
  const short = stem.length > 8 ? `${stem.slice(0, 8)}…` : stem;
  const mb = track.bytes ? ` · ${(track.bytes / 1024 / 1024).toFixed(1)} MB` : '';
  return `Track ${short}${mb}`;
}

function closeMusicPlayerModal() {
  // Tear the player down FIRST: this stops playback and detaches every
  // listener before the modal leaves the DOM.
  if (musicPlayer) {
    musicPlayer.destroy();
    musicPlayer = null;
  }
  if (musicPlayerModal && musicPlayerModal.parentNode) {
    musicPlayerModal.remove();
  }
  musicPlayerModal = null;
  musicPlayerTracks = [];
}

async function openMusicPlayerModal() {
  if (musicPlayerModal) return;

  const overlay = document.createElement('div');
  overlay.className = 'studio-modal-overlay studio-music-overlay';
  overlay.innerHTML = `
    <div class="studio-modal studio-music-modal" role="dialog" aria-modal="true" aria-labelledby="studio-music-title">
      <button type="button" class="studio-modal-close" data-close aria-label="Close">&times;</button>
      <h2 id="studio-music-title">Music Player</h2>
      <p class="studio-modal-note">Preview your own MP3 tracks. Upload a file, then pick a track to play. Only your uploads are listed, and playback stops when you close this window.</p>

      <div class="studio-music-upload">
        <input type="file" id="studio-music-file" accept="audio/mpeg,.mp3" aria-label="Choose an MP3 file">
        <button type="button" class="btn btn-secondary" id="studio-music-upload-btn">Upload MP3</button>
      </div>
      <p id="studio-music-upload-status" class="studio-music-note" role="status" aria-live="polite"></p>

      <div id="studio-music-tracks" class="studio-music-tracks" aria-label="Your tracks"></div>

      <div class="studio-music-player-mount" id="studio-music-player-mount"></div>

      <div class="studio-modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Close</button>
      </div>
    </div>`;

  overlay.addEventListener('pointerdown', event => {
    if (event.target === overlay || event.target.dataset.close !== undefined) closeMusicPlayerModal();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMusicPlayerModal();
    }
  });

  root.appendChild(overlay);
  musicPlayerModal = overlay;

  // Mount the player inside the modal. It owns its own <audio> element and UI.
  const mount = overlay.querySelector('#studio-music-player-mount');
  musicPlayer = new MusicPlayer(mount);

  overlay.querySelector('#studio-music-upload-btn').addEventListener('click', () => {
    uploadMusicTrack(overlay.querySelector('#studio-music-file'));
  });

  await loadMusicTracks();
}

async function loadMusicTracks() {
  if (!musicPlayerModal) return;
  const list = musicPlayerModal.querySelector('#studio-music-tracks');
  list.replaceChildren();
  list.innerHTML = '<p class="studio-modal-note">Loading your tracks…</p>';
  try {
    const result = await creatorAudioApi.listTracks();
    // The modal may have closed while the request was in flight.
    if (musicPlayerModal !== null && !musicPlayerModal.isConnected) return;
    musicPlayerTracks = result.items || [];
    renderMusicTracks();
  } catch (error) {
    list.replaceChildren();
    const err = document.createElement('p');
    err.className = 'studio-modal-note';
    err.style.color = 'var(--studio-danger)';
    err.textContent = `Could not load tracks: ${error.message}`;
    list.appendChild(err);
  }
}
function renderMusicTracks() {
  if (!musicPlayerModal) return;
  const list = musicPlayerModal.querySelector('#studio-music-tracks');
  list.replaceChildren();

  if (musicPlayerTracks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'studio-modal-note';
    empty.textContent = 'No tracks yet. Upload an MP3 above to start.';
    list.appendChild(empty);
    return;
  }

  for (const track of musicPlayerTracks) {
    const row = document.createElement('div');
    row.className = 'studio-music-track';
    row.dataset.id = track.id;

    const info = document.createElement('div');
    info.className = 'studio-music-track-info';
    const name = document.createElement('strong');
    name.textContent = audioTrackLabel(track);
    const meta = document.createElement('span');
    meta.className = 'studio-music-track-meta';
    meta.textContent = track.created_at ? new Date(track.created_at).toLocaleString() : '';
    info.append(name, meta);

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn btn-primary btn-sm';
    playBtn.textContent = 'Play';
    playBtn.title = 'Load and play this track';
    playBtn.addEventListener('click', () => playMusicTrack(track));

    row.append(info, playBtn);
    list.appendChild(row);
  }
}

/**
 * Hand a server-issued track URL to the player. The player never invents a
 * path — it only ever receives the ownership-checked url from the row.
 */
function playMusicTrack(track) {
  if (!musicPlayer || !track) return;
  musicPlayer.load(track.url, audioTrackLabel(track));
  musicPlayer.play();
}

/**
 * Upload the chosen MP3 through the server pipeline (which validates the real
 * bytes and records an ownership row), then refresh the list so the new track
 * appears and is immediately playable.
 */
async function uploadMusicTrack(fileInput) {
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    setMusicUploadStatus('Choose an MP3 file first.', true);
    return;
  }
  const status = musicPlayerModal?.querySelector('#studio-music-upload-status');
  const file = fileInput.files[0];
  const btn = musicPlayerModal?.querySelector('#studio-music-upload-btn');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Uploading…';

  try {
    await creatorAudioApi.uploadTrack(file);
    if (status) status.textContent = 'Uploaded. Pick it below to play.';
    fileInput.value = '';
    await loadMusicTracks();
  } catch (error) {
    if (status) {
      status.textContent = error.message || 'Upload failed.';
      status.dataset.error = 'true';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function setMusicUploadStatus(message, isError = false) {
  const status = musicPlayerModal?.querySelector('#studio-music-upload-status');
  if (!status) return;
  status.textContent = message;
  if (isError) status.dataset.error = 'true';
}



async function switchDesign(designId) {
  if (dirty && !window.confirm('Discard unsaved changes to the current design?')) return;
  const design = designs.find(d => d.id === designId);
  if (!design) return;
  await runAction(async () => {
    const result = await designApi.getDesign(design.id);
    currentDesign = normalizeDesign(result.design);
    // CREATOR-10A: a staged upload belongs to the design it was staged in, so
    // switching designs must never carry it over as a phantom background.
    resetPendingBackground();
    // CREATOR-13/14: switching projects tears down the Live View so no
    // animation loop, probe or timer from the previous project survives.
    stopLiveEffect();
    selectedId = null;
    history = [];
    future = [];
    dirty = false;
    renderAll();
    renderDesignSelect();
    updateProjectNameIndicator();
    setStatus(`Editing "${currentDesign.name}".`);
  });
}

async function createNewDesign() {
  if (dirty && !window.confirm('Discard unsaved changes to the current design?')) return;
  const created = await runAction(async () => {
    setStatus('Creating a new design…');
    const result = await designApi.createDesign({
      name: 'Untitled Design',
      layout: newDesignLayout(),
    });
    return result.design;
  });
  if (!created) return;
  designs = [created, ...designs];
  currentDesign = normalizeDesign(created);
    // CREATOR-10A: a staged upload belongs to the design it was staged in, so
    // switching designs must never carry it over as a phantom background.
    resetPendingBackground();
  // CREATOR-13/14: a fresh project starts with no Live View running.
  stopLiveEffect();
  selectedId = null;
  history = [];
  future = [];
  dirty = false;
  renderAll();
  renderDesignSelect();
  updateProjectNameIndicator();
  showWorkspace(true);
  setStatus('New design ready.');
}

function attachEvents() {
  // CREATOR-10C: keep the effect playback badge honest. The renderer reacts to a
  // reduced-motion change on its own, but the Properties panel is not rebuilt by
  // that, so it would keep claiming the old state. Re-rendering here is viewer
  // and UI only: no design change, no undo entry.
  if (typeof window.matchMedia === 'function' && !studioMotionQuery) {
    try {
      studioMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onMotionChange = () => { renderProperties(); };
      if (typeof studioMotionQuery.addEventListener === 'function') {
        studioMotionQuery.addEventListener('change', onMotionChange);
        studioMotionHandler = onMotionChange;
      }
    } catch { /* the preference is simply not observable here */ }
  }
  root.querySelector('#studio-sections-list').addEventListener('click', onElementListClick);
  observeEffectPlayback();
  root.querySelector('#studio-content-list').addEventListener('click', onElementListClick);
  // CREATOR-08: zoom controls. Viewer state only — no design mutation.
  root.querySelector('#studio-zoom-in').addEventListener('click', () => zoomBy('in'));
  root.querySelector('#studio-zoom-out').addEventListener('click', () => zoomBy('out'));
  root.querySelector('#studio-zoom-fit').addEventListener('click', fitViewerToProfile);
  root.querySelector('#studio-zoom-reset').addEventListener('click', resetViewerView);
  root.querySelector('#studio-canvas-inner').addEventListener('pointerdown', onStagePointerDown);
  // CREATOR-09: restore the default guide set from the toolbar, so it is
  // reachable whether or not a guide card is currently selected.
  root.querySelector('#studio-guide-reset').addEventListener('click', () => {
    resetGuide();
    renderAll();
  });
  root.querySelector('#studio-canvas-inner').addEventListener('dragover', event => event.preventDefault());
  root.querySelector('#studio-canvas-inner').addEventListener('drop', onCanvasDrop);
  root.querySelector('#studio-layers-list').addEventListener('click', onLayersClick);
  root.querySelector('#studio-layers-list').addEventListener('change', onLayersChange);
  root.querySelector('#studio-sections-list').addEventListener('dragstart', onDragStart);
  root.querySelector('#studio-content-list').addEventListener('dragstart', onDragStart);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  root.querySelector('#studio-undo').addEventListener('click', undo);
  root.querySelector('#studio-redo').addEventListener('click', redo);
  root.querySelector('#studio-save').addEventListener('click', saveDraft);
  root.querySelector('#studio-publish').addEventListener('click', publish);
  root.querySelector('#studio-save-asset').addEventListener('click', openSaveAssetModal);
  root.querySelector('#studio-version-history').addEventListener('click', openVersionHistoryModal);
  root.querySelector('#studio-asset-library').addEventListener('click', openLibraryModal);
  root.querySelector('#studio-music-player').addEventListener('click', openMusicPlayerModal);
  root.querySelector('#studio-new-design').addEventListener('click', createNewDesign);
  root.querySelector('#studio-open-profile').addEventListener('click', () => navigate('/profile'));
  root.querySelector('#studio-coin-shop').addEventListener('click', () => navigate('/creator-studio/coin-shop'));

  root.querySelector('#studio-preview-toggle').addEventListener('click', () => {
    previewMode = !previewMode;
    root.classList.toggle('studio-preview-mode', previewMode);
    root.querySelector('#studio-preview-toggle').textContent = previewMode ? 'Exit Preview' : 'Preview';
    renderCanvas();
    setStatus(previewMode
      ? 'Preview mode — this is how visitors will see the published design.'
      : 'Back to editing.');
  });

  // CREATOR-07: the viewer resizes by dragging its own edges. These grips are
  // CREATOR-07A: the two column boundaries control panel widths. They live in
  // the layout (not inside the scrollable panels) and are absolutely positioned
  // on the boundary they control, so the hit area can never be swallowed by
  // panel content, the canvas, or the sticky toolbar.
  root.querySelector('#studio-layout')?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const handle = event.target.closest('[data-resize-col]');
    if (!handle || handle.hidden) return;
    event.preventDefault();
    // Capture so a fast drag that leaves the 8px handle keeps reporting moves.
    try { handle.setPointerCapture(event.pointerId); } catch { /* not critical */ }
    startPanelResize(handle.dataset.resizeCol, event);
  });

  // The viewer's bottom boundary is its only resize control: width always
  // follows the center column.
  root.querySelector('#studio-viewer')?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const grip = event.target.closest('[data-resize-height]');
    if (!grip || grip.hidden) return;
    event.preventDefault();
    try { grip.setPointerCapture(event.pointerId); } catch { /* not critical */ }
    startViewerHeightResize(event);
  });

  // Re-clamp a pinned layout when the window changes size.
  window.addEventListener('resize', clampWorkspaceToWindow);

  root.querySelector('#studio-design-select').addEventListener('change', () => {
    switchDesign(root.querySelector('#studio-design-select').value);
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
/**
 * CREATOR-14: read the optional `project` query parameter from the current
 * hash route (e.g. #/creator-studio?project=<id>). Returns the project id
 * or null when the studio was opened without one.
 */
function getRequestedProjectId() {
  const hash = window.location.hash.slice(1) || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return null;
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  const id = params.get('project');
  return id && id.trim() ? id.trim() : null;
}

/**
 * CREATOR-14: show the name of the project currently open in the studio
 * header, so the creator always knows which project they are editing.
 *
 * CREATOR-15: the same row carries the project's current version number,
 * so the creator can see which version the editor holds before saving.
 */
function updateProjectNameIndicator() {
  const el = root?.querySelector('#studio-project-name');
  if (el) {
    if (currentDesign && currentDesign.name) {
      el.textContent = `Project: ${currentDesign.name}`;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }
  const versionEl = root?.querySelector('#studio-project-version');
  if (versionEl) {
    if (currentDesign && currentDesign.id) {
      versionEl.textContent = `v${currentDesign.version || 1}`;
      versionEl.hidden = false;
    } else {
      versionEl.textContent = '';
      versionEl.hidden = true;
    }
  }
}

export async function initCreatorStudioPage() {
  root = document.getElementById('creator-studio');
  const mounted = root;
  if (!root) return;
  window.addEventListener('keydown', keyHandler);
  window.addEventListener('beforeunload', beforeUnload);
  renderElementPanels();
  // CREATOR-12: load the creator's installed .kpeffect effects before the first
  // Properties render, so a design that already references one previews instead
  // of silently showing nothing.
  await refreshInstalledEffects();
  applyWorkspaceState();
  // CREATOR-10: watch the viewer's real size so the canvas re-centres after a
  // window resize, a side-panel drag, a viewer-height drag, or any other relayout.
  observeViewerSize();
  attachEvents();

  try {
    const own = await profileApi.getOwnProfile();
    if (root !== mounted || !mounted.isConnected) return;
    const listResult = await designApi.listDesigns();
    if (root !== mounted || !mounted.isConnected) return;
    designs = listResult.designs || [];

    // CREATOR-14: a project may be requested directly via the project
    // manager (#/creator-studio?project=<id>). Load that project when
    // present; otherwise fall back to the first draft (or the first
    // design) exactly as before.
    const requestedProjectId = getRequestedProjectId();
    let pick = null;
    if (requestedProjectId) {
      pick = designs.find(d => d.id === requestedProjectId) || null;
      if (!pick) {
        // Not in the list (e.g. archived). Fetch it directly so the
        // creator can still open an archived project from the manager.
        try {
          const result = await designApi.getDesign(requestedProjectId);
          pick = result.design || null;
        } catch {
          pick = null;
        }
      }
    }
    if (!pick) {
      pick = designs.find(d => d.status === 'draft') || designs[0];
    }
    if (!pick) {
      const created = await designApi.createDesign({
        name: 'My Design',
        layout: newDesignLayout(),
      });
      designs = [created.design];
      pick = created.design;
    }
    currentDesign = normalizeDesign(pick);
    // CREATOR-10A: a staged upload belongs to the design it was staged in, so
    // switching designs must never carry it over as a phantom background.
    resetPendingBackground();
    selectedId = null;
    history = [];
    future = [];
    dirty = false;
    renderAll();
    renderDesignSelect();
    updateProjectNameIndicator();
    showWorkspace(true);
    setStatus(`Editing "${currentDesign.name}". Drag elements onto the canvas, then Save or Publish.`);
    void own;
  } catch (error) {
    if (root === mounted) setStatus(`Could not load Creator Studio: ${error.message}`);
  }
}

export function canLeaveCreatorStudio() {
  if (!currentDesign || !root) return true;
  if (busy) return false;
  return !dirty || window.confirm('Leave Creator Studio without saving your design changes?');
}

export function destroyCreatorStudioPage() {
  closeAssetModal();
  closeVersionHistoryModal();
  // CREATOR-17: a player left mounted could keep playing after navigation.
  closeMusicPlayerModal();
  window.removeEventListener('keydown', keyHandler);
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('resize', clampWorkspaceToWindow);
  if (studioMotionQuery && studioMotionHandler
    && typeof studioMotionQuery.removeEventListener === 'function') {
    studioMotionQuery.removeEventListener('change', studioMotionHandler);
  }
  studioMotionQuery = null;
  studioMotionHandler = null;
  // CREATOR-13: never leave a Live View loop, probe or timer behind.
  stopLiveEffect();
  try { effectPlaybackObserver?.disconnect(); } catch { /* best effort */ }
  effectPlaybackObserver = null;
  lastPlaybackMotion = null;
  stopObservingViewerSize();
  currentDesign = null;
  designs = [];
  selectedId = null;
  drag = null;
  pendingType = null;
  previewMode = false;
  dirty = false;
  root = null;
}
