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

import { designApi, profileApi } from './api.js';
import {
  CONTENT_COMPONENT_TYPES,
  applyGeometryToElement,
  applyCommonStyleToElement,
} from './profileDesign.js';

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

const CONTROLLED_TYPES = new Set(CONTROLLED_SECTIONS.map(s => s.type));
const ALL_SECTIONS = [...CONTROLLED_SECTIONS, ...CONTENT_SECTIONS];

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

const DEFAULT_CANVAS = { width: 960, minHeight: 1200 };
const SNAP = 6;
const MIN_SIZE = 8;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// ── Module state ─────────────────────────────────────────────────────────────
let root = null;
let currentDesign = null;
let designs = [];
let selectedId = null;
let zoom = 1;
let dirty = false;
let busy = false;
let previewMode = false;
let pendingType = null;
let idCounter = 0;
let history = [];
let future = [];
let drag = null;

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
  if (workspace) workspace.hidden = !visible;
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
  return { ...design, layout: layoutObj };
}

// ── Rendering ────────────────────────────────────────────────────────────────
export function renderCreatorStudioPage() {
  return `<main id="creator-studio" class="creator-studio">
    <header class="studio-heading">
      <a href="#/profile">← Return to profile</a>
      <p class="editor-eyebrow">CREATOR STUDIO</p>
      <h1>Creator Studio</h1>
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
        <span class="studio-toolbar-sep" aria-hidden="true"></span>
        <label class="studio-zoom-label">Zoom
          <select id="studio-zoom" aria-label="Canvas zoom"></select>
        </label>
        <span class="studio-toolbar-sep" aria-hidden="true"></span>
        <span class="studio-spacer" aria-hidden="true"></span>
        <button id="studio-open-profile" class="btn btn-secondary" type="button" title="Open your published profile in a new tab">Open Profile↗</button>
        <button id="studio-save" class="btn btn-primary" type="button">Save Draft</button>
        <button id="studio-publish" class="btn btn-cta" type="button">Publish</button>
      </div>
      <div class="studio-layout">
        <aside id="studio-elements" class="studio-panel" aria-label="Elements">
          <h2>Profile Sections</h2>
          <p class="studio-panel-note">Each element maps to a real part of your profile page.</p>
          <div id="studio-sections-list" class="studio-element-list"></div>
          <h2>Content</h2>
          <p class="studio-panel-note">Add your own text, images and cards.</p>
          <div id="studio-content-list" class="studio-element-list"></div>
        </aside>
        <div id="studio-stage">
          <div id="studio-canvas-scroll">
            <div id="studio-canvas-inner"></div>
          </div>
        </div>
        <aside id="studio-properties-panel" class="studio-panel" aria-label="Properties">
          <h2>Properties</h2>
          <div id="studio-properties"></div>
        </aside>
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

function renderZoomSelect() {
  const select = root?.querySelector('#studio-zoom');
  if (!select) return;
  select.replaceChildren();
  ZOOMS.forEach(value => {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${Math.round(value * 100)}%`;
    select.appendChild(option);
  });
  select.value = String(zoom);
}

function buildContentNode(el, comp) {
  const config = comp.config || {};
  if (comp.type === 'image' || comp.type === 'sticker') {
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
    if (config.fontSize) span.style.fontSize = `${config.fontSize}px`;
    if (config.fontWeight) span.style.fontWeight = String(config.fontWeight);
    if (config.textAlign) span.style.textAlign = config.textAlign;
    if (config.lineHeight) span.style.lineHeight = String(config.lineHeight);
    if (config.textColor) span.style.color = config.textColor;
    el.appendChild(span);
  } else if (comp.type === 'card') {
    const heading = document.createElement('div');
    heading.className = 'design-card-heading';
    heading.textContent = config.heading || '';
    if (config.headingColor) heading.style.color = config.headingColor;
    el.appendChild(heading);
    if (config.body) {
      const body = document.createElement('div');
      body.className = 'design-card-body';
      body.textContent = config.body;
      if (config.textColor) body.style.color = config.textColor;
      el.appendChild(body);
    }
    if (config.textAlign) el.style.textAlign = config.textAlign;
  }
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

function buildComponentNode(comp) {
  const el = document.createElement('div');
  el.dataset.compId = comp.id;

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

  applyGeometryToElement(el, comp, { applyVisibility: false });
  applyCommonStyleToElement(el, comp.style);
  if (comp.visible === false) el.classList.add('studio-comp-hidden');
  if (comp.locked) el.classList.add('studio-comp-locked');
  if (!previewMode && comp.id === selectedId) appendHandles(el);
  return el;
}

function renderCanvas() {
  const inner = root?.querySelector('#studio-canvas-inner');
  if (!inner || !currentDesign) return;

  const c = canvas();
  const doc = document.createElement('div');
  doc.id = 'studio-canvas-document';
  doc.className = 'studio-canvas-document';
  doc.style.width = `${c.width}px`;
  doc.style.minHeight = `${c.minHeight}px`;

  const ordered = [...components()].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  if (ordered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'studio-canvas-empty';
    empty.textContent = 'Your profile is empty. Click a section or "+" in the Elements panel to place it, or drag it onto the canvas.';
    doc.appendChild(empty);
  }
  ordered.forEach(comp => doc.appendChild(buildComponentNode(comp)));

  const zoomLayer = document.createElement('div');
  zoomLayer.id = 'studio-zoom-layer';
  zoomLayer.style.transform = `scale(${zoom})`;
  zoomLayer.appendChild(doc);
  inner.replaceChildren(zoomLayer);
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
  const frag = document.createDocumentFragment();
  ordered.forEach((comp, index) => {
    const row = document.createElement('div');
    row.className = `studio-layer-row${comp.id === selectedId ? ' studio-layer-selected' : ''}`;
    row.dataset.layerId = comp.id;

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'studio-layer-name';
    name.dataset.action = 'select';
    name.title = 'Select on canvas';
    name.textContent = `${index + 1}. ${labelOf(comp)}`;
    name.textContent = comp.visible ? name.textContent : `· ${name.textContent}`;
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
      ['toggle-visibility', comp.visible ? 'Hide' : 'Show', comp.visible ? 'Eye' : 'Eye'],
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
    frag.appendChild(row);
  });
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

function numberField(comp, path, { min = -Infinity, max = Infinity, step = 'any', integer = false } = {}) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
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

function selectField(comp, path, options) {
  const select = document.createElement('select');
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Default';
  select.appendChild(empty);
  options.forEach(option => {
    const el = document.createElement('option');
    el.value = option;
    el.textContent = option;
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

  frag.appendChild(fieldRow('X', numberField(comp, 'x', { min: -10000, max: 10000, integer: true })));
  frag.appendChild(fieldRow('Y', numberField(comp, 'y', { min: -10000, max: 10000, integer: true })));
  frag.appendChild(fieldRow('Width', numberField(comp, 'width', { min: 8, max: 4080, integer: true })));
  frag.appendChild(fieldRow('Height', numberField(comp, 'height', { min: 8, max: 4080, integer: true })));
  frag.appendChild(fieldRow('Z-index', numberField(comp, 'zIndex', { min: 0, max: 10000, integer: true })));
  frag.appendChild(fieldRow('Rotation (deg)', numberField(comp, 'rotation', { min: 0, max: 360 })));
  frag.appendChild(fieldRow('Visible', toggleField(comp, 'visible')));
  frag.appendChild(fieldRow('Locked', toggleField(comp, 'locked')));

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

  if (CONTENT_COMPONENT_TYPES.has(comp.type)) {
    const section = comp.type === 'text' ? 'Text content'
      : comp.type === 'card' ? 'Card content'
        : 'Image content';
    frag.appendChild(sectionTitle(section));
    if (comp.type === 'text') {
      frag.appendChild(fieldRow('Text', textField(comp, 'config.text', { max: 2000, rows: 3, trim: true })));
      frag.appendChild(fieldRow('Font size', numberField(comp, 'config.fontSize', { min: 8, max: 200 })));
      frag.appendChild(fieldRow('Font weight', numberField(comp, 'config.fontWeight', { min: 100, max: 900, integer: true })));
      frag.appendChild(fieldRow('Align', selectField(comp, 'config.textAlign', ['left', 'center', 'right'])));
      frag.appendChild(fieldRow('Line height', numberField(comp, 'config.lineHeight', { min: 0.5, max: 3, step: 0.1 })));
      frag.appendChild(fieldRow('Text color', colorField(comp, 'config.textColor')));
    }
    if (comp.type === 'image' || comp.type === 'sticker') {
      frag.appendChild(fieldRow('Image URL', singleLineField(comp, 'config.imageUrl', { trim: true })));
      frag.appendChild(fieldRow('Alt text', singleLineField(comp, 'config.alt', { max: 200 })));
      frag.appendChild(fieldRow('Fit', selectField(comp, 'config.fit', ['cover', 'contain', 'fill'])));
      frag.appendChild(fieldRow('Background', colorField(comp, 'config.backgroundColor')));
      const hint = document.createElement('p');
      hint.className = 'studio-prop-hint';
      hint.textContent = 'Use an http(s) image URL. A URL is required before this design can be saved.';
      frag.appendChild(hint);
    }
    if (comp.type === 'card') {
      frag.appendChild(fieldRow('Heading', singleLineField(comp, 'config.heading', { max: 200, trim: true })));
      frag.appendChild(fieldRow('Body', textField(comp, 'config.body', { max: 2000, rows: 3 })));
      frag.appendChild(fieldRow('Heading color', colorField(comp, 'config.headingColor')));
      frag.appendChild(fieldRow('Body color', colorField(comp, 'config.textColor')));
      frag.appendChild(fieldRow('Align', selectField(comp, 'config.textAlign', ['left', 'center', 'right'])));
    }
  }
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
  renderCanvas();
  renderLayers();
  renderProperties();
  updateToolbar();
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

function removeComponent(id) {
  const index = components().findIndex(c => c.id === id);
  if (index === -1) return;
  pushHistory();
  components().splice(index, 1);
  if (selectedId === id) selectedId = components()[0]?.id || null;
  markChanged('Component removed.');
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
  const rect = doc.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
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

function onPointerMove(event) {
  if (!drag || !currentDesign) return;
  const point = toDesignPoint(event);
  const comp = findComp(drag.id);
  if (!comp) return;
  const c = canvas();
  const dx = point.x - drag.pointerX;
  const dy = point.y - drag.pointerY;

  clearGuides();

  if (drag.mode === 'move') {
    const x = clamp(roundInt(drag.startX + dx), 0, Math.max(0, c.width - comp.width));
    const y = clamp(roundInt(drag.startY + dy), 0, Math.max(0, c.minHeight - comp.height));
    const result = snapMove(comp, x, y);
    comp.x = result.x;
    comp.y = result.y;
    unionGuides = result.guides;
    drawGuides();
  } else {
    const dirs = drag.dir;
    let { x, y, width, height } = comp;
    if (dirs.includes('e')) {
      width = clamp(roundInt(drag.startW + dx), MIN_SIZE, Math.max(MIN_SIZE, c.width - x));
    }
    if (dirs.includes('s')) {
      height = clamp(roundInt(drag.startH + dy), MIN_SIZE, Math.max(MIN_SIZE, c.minHeight - y));
    }
    if (dirs.includes('w')) {
      const newX = clamp(roundInt(drag.startX + dx), 0, Math.max(0, drag.startX + drag.startW - MIN_SIZE));
      width = clamp(drag.startW + (drag.startX - newX), MIN_SIZE, Math.max(MIN_SIZE, c.width - newX));
      x = newX;
    }
    if (dirs.includes('n')) {
      const newY = clamp(roundInt(drag.startY + dy), 0, Math.max(0, drag.startY + drag.startH - MIN_SIZE));
      height = clamp(drag.startH + (drag.startY - newY), MIN_SIZE, Math.max(MIN_SIZE, c.minHeight - newY));
      y = newY;
    }
    comp.x = x;
    comp.y = y;
    comp.width = width;
    comp.height = height;
  }
  renderCanvas();
  renderLayers();
}

function onPointerUp() {
  if (!drag) return;
  drag = null;
  dirty = true;
  clearGuides();
  renderCanvas();
  renderLayers();
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
      updateToolbar();
    }
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
    const result = await designApi.updateDesign(currentDesign.id, {
      name: currentDesign.name,
      layout: clone(layout()),
    });
    currentDesign = normalizeDesign(result.design);
    designs = designs.map(d => (d.id === currentDesign.id ? currentDesign : d));
    renderDesignSelect();
    renderProperties();
    dirty = false;
    updateToolbar();
    setStatus('Draft saved. Publish to show it on your profile.');
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
    designs = designs.map(d => (d.id === currentDesign.id ? currentDesign : d));
    renderDesignSelect();
    dirty = false;
    updateToolbar();
    setStatus(`Published "${currentDesign.name}". It is now live on your profile.`);
  });
}

async function switchDesign(designId) {
  if (dirty && !window.confirm('Discard unsaved changes to the current design?')) return;
  const design = designs.find(d => d.id === designId);
  if (!design) return;
  await runAction(async () => {
    const result = await designApi.getDesign(design.id);
    currentDesign = normalizeDesign(result.design);
    selectedId = null;
    history = [];
    future = [];
    dirty = false;
    renderAll();
    renderDesignSelect();
    setStatus(`Editing "${currentDesign.name}".`);
  });
}

async function createNewDesign() {
  if (dirty && !window.confirm('Discard unsaved changes to the current design?')) return;
  const created = await runAction(async () => {
    setStatus('Creating a new design…');
    const result = await designApi.createDesign({
      name: 'Untitled Design',
      layout: { canvas: { ...DEFAULT_CANVAS }, components: [] },
    });
    return result.design;
  });
  if (!created) return;
  designs = [created, ...designs];
  currentDesign = normalizeDesign(created);
  selectedId = null;
  history = [];
  future = [];
  dirty = false;
  renderAll();
  renderDesignSelect();
  showWorkspace(true);
  setStatus('New design ready.');
}

function attachEvents() {
  root.querySelector('#studio-sections-list').addEventListener('click', onElementListClick);
  root.querySelector('#studio-content-list').addEventListener('click', onElementListClick);
  root.querySelector('#studio-canvas-inner').addEventListener('pointerdown', onStagePointerDown);
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
  root.querySelector('#studio-new-design').addEventListener('click', createNewDesign);
  root.querySelector('#studio-open-profile').addEventListener('click', () => navigate('/profile'));

  root.querySelector('#studio-preview-toggle').addEventListener('click', () => {
    previewMode = !previewMode;
    root.classList.toggle('studio-preview-mode', previewMode);
    root.querySelector('#studio-preview-toggle').textContent = previewMode ? 'Exit Preview' : 'Preview';
    renderCanvas();
    setStatus(previewMode
      ? 'Preview mode — this is how visitors will see the published design.'
      : 'Back to editing.');
  });

  root.querySelector('#studio-zoom').addEventListener('change', () => {
    zoom = parseFloat(root.querySelector('#studio-zoom').value) || 1;
    renderCanvas();
  });

  root.querySelector('#studio-design-select').addEventListener('change', () => {
    switchDesign(root.querySelector('#studio-design-select').value);
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
export async function initCreatorStudioPage() {
  root = document.getElementById('creator-studio');
  const mounted = root;
  if (!root) return;
  window.addEventListener('keydown', keyHandler);
  window.addEventListener('beforeunload', beforeUnload);
  renderElementPanels();
  renderZoomSelect();
  attachEvents();

  try {
    const own = await profileApi.getOwnProfile();
    if (root !== mounted || !mounted.isConnected) return;
    const listResult = await designApi.listDesigns();
    if (root !== mounted || !mounted.isConnected) return;
    designs = listResult.designs || [];

    let pick = designs.find(d => d.status === 'draft') || designs[0];
    if (!pick) {
      const created = await designApi.createDesign({
        name: 'My Design',
        layout: { canvas: { ...DEFAULT_CANVAS }, components: [] },
      });
      designs = [created.design];
      pick = created.design;
    }
    currentDesign = normalizeDesign(pick);
    selectedId = null;
    history = [];
    future = [];
    dirty = false;
    renderAll();
    renderDesignSelect();
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
  window.removeEventListener('keydown', keyHandler);
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  currentDesign = null;
  designs = [];
  selectedId = null;
  drag = null;
  pendingType = null;
  previewMode = false;
  dirty = false;
  root = null;
}