import { profileMp3Api } from './api.js';

/**
 * MP3-DESIGNER-01: Graphical element-based MP3 player designer.
 * Coordinate model: design-space pixels relative to player canvas (0,0 = top-left of player).
 * Player has fixed design dimensions (playerWidth x playerHeight). Rendering scales visually
 * via the rendered player box; pointer events convert client coords -> design coords using
 * the live bounding rect ratio so drag/resize remain accurate at any display scale.
 */

const DESIGN_VERSION = 2;
const MAX_ELEMENTS = 40;

const ELEMENT_TYPES = {
  title: { label: 'Title', minW: 60, minH: 20, defaultW: 180, defaultH: 28 },
  subtitle: { label: 'Subtitle', minW: 60, minH: 18, defaultW: 140, defaultH: 22 },
  image: { label: 'Artwork', minW: 24, minH: 24, defaultW: 64, defaultH: 64 },
  controls: { label: 'Controls', minW: 80, minH: 24, defaultW: 150, defaultH: 34 },
  progress: { label: 'Progress', minW: 60, minH: 8, defaultW: 180, defaultH: 10 },
  timeCurrent: { label: 'Current Time', minW: 28, minH: 14, defaultW: 42, defaultH: 18 },
  timeDuration: { label: 'Duration', minW: 28, minH: 14, defaultW: 42, defaultH: 18 },
  decorative: { label: 'Shape', minW: 20, minH: 20, defaultW: 80, defaultH: 40 },
};

const REQUIRED_TYPES = new Set(['title', 'controls', 'progress']);

const TEMPLATES = [
  { id: 'modern-minimal', label: 'Modern Minimal', config: { backgroundColor: 'rgba(255,255,255,0.82)', textColor: '#1f2937', accentColor: '#42bbaa', progressColor: '#42bbaa', borderRadius: 18, backgroundOpacity: 1, overlayOpacity: 0.12, playerWidth: 320, playerHeight: 118 } },
  { id: 'dark-theme', label: 'Dark Theme', config: { backgroundColor: 'rgba(17,24,39,0.88)', textColor: '#f9fafb', accentColor: '#22d3ee', progressColor: '#22d3ee', borderRadius: 20, backgroundOpacity: 0.92, overlayOpacity: 0.45, playerWidth: 320, playerHeight: 124 } },
  { id: 'gradient-style', label: 'Gradient Style', config: { backgroundColor: 'linear-gradient(135deg, rgba(99,102,241,0.9), rgba(236,72,153,0.85))', textColor: '#ffffff', accentColor: '#fbbf24', progressColor: '#fbbf24', borderRadius: 24, backgroundOpacity: 1, overlayOpacity: 0.18, playerWidth: 330, playerHeight: 126 } },
  { id: 'compact-bar', label: 'Compact Bar', config: { backgroundColor: 'rgba(31,41,55,0.9)', textColor: '#ffffff', accentColor: '#34d399', progressColor: '#34d399', borderRadius: 12, backgroundOpacity: 0.95, overlayOpacity: 0.2, playerWidth: 280, playerHeight: 82 } },
  { id: 'card-style', label: 'Card Style', config: { backgroundColor: 'rgba(255,255,255,0.94)', textColor: '#111827', accentColor: '#ef4444', progressColor: '#ef4444', borderRadius: 28, backgroundOpacity: 1, overlayOpacity: 0.08, playerWidth: 360, playerHeight: 150 } },
  { id: 'retro-style', label: 'Retro Style', config: { backgroundColor: 'rgba(120,53,15,0.9)', textColor: '#fef3c7', accentColor: '#f59e0b', progressColor: '#f59e0b', borderRadius: 10, backgroundOpacity: 0.95, overlayOpacity: 0.25, playerWidth: 320, playerHeight: 120 } },
];

const DEFAULT_PLAYER = {
  template: 'modern-minimal',
  backgroundColor: 'rgba(255,255,255,0.82)',
  textColor: '#1f2937',
  accentColor: '#42bbaa',
  progressColor: '#42bbaa',
  borderRadius: 18,
  backgroundOpacity: 1,
  overlayOpacity: 0.12,
  overlayColor: '#000000',
  playerWidth: 320,
  playerHeight: 118,
  backgroundImage: '',
  backgroundFit: 'cover',
  backgroundPosition: 'center',
};

let state = null;
let interaction = null;
let listenersAttached = false;

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function uid(prefix = 'el') { return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`; }
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function round(n) { return Math.round(Number(n) || 0); }
function finite(n, fallback = 0) { const v = Number(n); return Number.isFinite(v) ? v : fallback; }
function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(v) { return esc(v).replace(/'/g, '&#39;'); }
function isHexLike(v) { return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v); }

function defaultProps(type, config) {
  switch (type) {
    case 'title': return { text: 'Featured track', fontSize: 16, fontWeight: '600', color: config.textColor || '#ffffff', align: 'left', opacity: 1 };
    case 'subtitle': return { text: 'Artist', fontSize: 12, fontWeight: '400', color: config.textColor || '#ffffff', align: 'left', opacity: 0.85 };
    case 'image': return { src: '', fit: 'cover', borderRadius: 12, opacity: 1, shape: 'rounded', preserveAspect: true };
    case 'controls': return { color: config.accentColor || '#42bbaa', size: 24, opacity: 1 };
    case 'progress': return { trackColor: 'rgba(255,255,255,0.2)', progressColor: config.progressColor || config.accentColor || '#42bbaa', thickness: 6, radius: 999, opacity: 1 };
    case 'timeCurrent': return { text: '0:00', fontSize: 11, fontWeight: '500', color: config.textColor || '#ffffff', align: 'left', opacity: 0.9 };
    case 'timeDuration': return { text: '0:00', fontSize: 11, fontWeight: '500', color: config.textColor || '#ffffff', align: 'right', opacity: 0.9 };
    case 'decorative': return { fill: config.accentColor || '#42bbaa', borderRadius: 8, opacity: 0.25, borderColor: 'transparent', borderWidth: 0 };
    default: return {};
  }
}

function normalizeElement(el, config) {
  const type = ELEMENT_TYPES[el?.type] ? el.type : 'title';
  const meta = ELEMENT_TYPES[type];
  const propsIn = (el && el.props && typeof el.props === 'object' && !Array.isArray(el.props)) ? { ...el.props } : {};
  const width = clamp(round(finite(el?.width, meta.defaultW)), meta.minW, 2000);
  const height = clamp(round(finite(el?.height, meta.defaultH)), meta.minH, 2000);
  const x = clamp(round(finite(el?.x, 0)), -1000, 10000);
  const y = clamp(round(finite(el?.y, 0)), -1000, 10000);
  const out = {
    id: typeof el?.id === 'string' && el.id ? String(el.id).slice(0, 80) : uid(type),
    type,
    x, y, width, height,
    zIndex: clamp(round(finite(el?.zIndex, 0)), -1000, 10000),
    visible: el?.visible !== false,
    locked: el?.locked === true,
    props: { ...defaultProps(type, config), ...propsIn },
  };
  if (type === 'title' || type === 'subtitle' || type === 'timeCurrent' || type === 'timeDuration') {
    out.props.text = String(out.props.text ?? '').slice(0, 120);
    out.props.fontSize = clamp(round(finite(out.props.fontSize, 14)), 8, 72);
    out.props.fontWeight = ['400', '500', '600', '700'].includes(String(out.props.fontWeight)) ? String(out.props.fontWeight) : '500';
    out.props.color = String(out.props.color || config.textColor || '#ffffff').slice(0, 60);
    out.props.align = ['left', 'center', 'right'].includes(out.props.align) ? out.props.align : 'left';
    out.props.opacity = clamp(finite(out.props.opacity, 1), 0, 1);
  }
  if (type === 'image') {
    out.props.src = typeof out.props.src === 'string' ? out.props.src.slice(0, 500) : '';
    out.props.fit = ['cover', 'contain', 'fill'].includes(out.props.fit) ? out.props.fit : 'cover';
    out.props.borderRadius = clamp(round(finite(out.props.borderRadius, 12)), 0, 500);
    out.props.opacity = clamp(finite(out.props.opacity, 1), 0, 1);
    out.props.shape = out.props.shape === 'circle' ? 'circle' : 'rounded';
    out.props.preserveAspect = out.props.preserveAspect !== false;
  }
  if (type === 'controls') {
    out.props.color = String(out.props.color || config.accentColor || '#42bbaa').slice(0, 60);
    out.props.size = clamp(round(finite(out.props.size, 24)), 16, 80);
    out.props.opacity = clamp(finite(out.props.opacity, 1), 0, 1);
  }
  if (type === 'progress') {
    out.props.trackColor = String(out.props.trackColor || 'rgba(255,255,255,0.2)').slice(0, 60);
    out.props.progressColor = String(out.props.progressColor || config.progressColor || '#42bbaa').slice(0, 60);
    out.props.thickness = clamp(round(finite(out.props.thickness, 6)), 2, 40);
    out.props.radius = clamp(round(finite(out.props.radius, 999)), 0, 999);
    out.props.opacity = clamp(finite(out.props.opacity, 1), 0, 1);
  }
  if (type === 'decorative') {
    out.props.fill = String(out.props.fill || config.accentColor || '#42bbaa').slice(0, 80);
    out.props.borderRadius = clamp(round(finite(out.props.borderRadius, 8)), 0, 500);
    out.props.opacity = clamp(finite(out.props.opacity, 0.25), 0, 1);
    out.props.borderColor = String(out.props.borderColor || 'transparent').slice(0, 60);
    out.props.borderWidth = clamp(round(finite(out.props.borderWidth, 0)), 0, 20);
  }
  return out;
}

function makeElement(type, config, overrides = {}) {
  const meta = ELEMENT_TYPES[type] || ELEMENT_TYPES.title;
  const base = {
    id: uid(type),
    type,
    x: 12, y: 12,
    width: meta.defaultW,
    height: meta.defaultH,
    zIndex: 0,
    visible: true,
    locked: false,
    props: defaultProps(type, config),
  };
  return normalizeElement({ ...base, ...overrides, props: { ...base.props, ...(overrides.props || {}) } }, config);
}

function reindexZ(elements) {
  [...elements].sort((a, b) => (a.zIndex - b.zIndex) || 0).forEach((el, i) => { el.zIndex = i + 1; });
}

function defaultElements(config, legacyArtwork = null) {
  const w = config.playerWidth || 320;
  const h = config.playerHeight || 118;
  const art = legacyArtwork && typeof legacyArtwork === 'object' ? legacyArtwork : {};
  const artUrl = typeof art.url === 'string' ? art.url : '';
  const artSize = clamp(round(finite(art.size, 56)), 32, 120);
  const hasArt = !!artUrl && art.visible !== false;
  const left = hasArt ? artSize + 24 : 14;
  const elems = [];
  if (hasArt) {
    elems.push(makeElement('image', config, {
      x: 12, y: Math.max(8, Math.round((h - artSize) / 2)), width: artSize, height: artSize, zIndex: 2,
      props: { src: artUrl, shape: art.shape === 'circle' ? 'circle' : 'rounded', borderRadius: finite(art.radius, 12), fit: 'cover', opacity: 1, preserveAspect: true },
    }));
  }
  elems.push(makeElement('title', config, { x: left, y: 14, width: Math.max(80, w - left - 14), height: 24, zIndex: 3, props: { text: 'Featured track', color: config.textColor, fontSize: 15, fontWeight: '600' } }));
  elems.push(makeElement('progress', config, { x: left, y: h - 34, width: Math.max(60, w - left - 14), height: 8, zIndex: 3, props: { progressColor: config.progressColor || config.accentColor, trackColor: 'rgba(255,255,255,0.2)' } }));
  elems.push(makeElement('controls', config, { x: left, y: h - 62, width: 120, height: 26, zIndex: 3, props: { color: config.accentColor, size: 22 } }));
  elems.push(makeElement('timeCurrent', config, { x: left, y: h - 22, width: 36, height: 16, zIndex: 3, props: { color: config.textColor } }));
  elems.push(makeElement('timeDuration', config, { x: Math.max(left, w - 50), y: h - 22, width: 36, height: 16, zIndex: 3, props: { color: config.textColor, align: 'right' } }));
  reindexZ(elems);
  return elems;
}

function normalizeConfig(input) {
  const raw = (input && typeof input === 'object' && !Array.isArray(input)) ? clone(input) : {};
  const player = { ...clone(DEFAULT_PLAYER) };
  for (const k of Object.keys(DEFAULT_PLAYER)) {
    if (raw[k] !== undefined) player[k] = raw[k];
  }
  player.playerWidth = clamp(round(finite(player.playerWidth, 320)), 220, 520);
  player.playerHeight = clamp(round(finite(player.playerHeight, 118)), 72, 320);
  player.borderRadius = clamp(round(finite(player.borderRadius, 16)), 0, 60);
  player.backgroundOpacity = clamp(finite(player.backgroundOpacity, 1), 0, 1);
  player.overlayOpacity = clamp(finite(player.overlayOpacity, 0.12), 0, 1);
  player.template = typeof player.template === 'string' ? player.template.slice(0, 60) : 'modern-minimal';
  player.backgroundImage = typeof player.backgroundImage === 'string' ? player.backgroundImage.slice(0, 500) : '';
  player.backgroundFit = ['cover', 'contain', 'fill'].includes(player.backgroundFit) ? player.backgroundFit : 'cover';
  player.backgroundPosition = String(player.backgroundPosition || 'center').slice(0, 40);
  player.overlayColor = String(player.overlayColor || '#000000').slice(0, 60);
  player.backgroundColor = String(player.backgroundColor || DEFAULT_PLAYER.backgroundColor).slice(0, 140);
  player.textColor = String(player.textColor || '#ffffff').slice(0, 60);
  player.accentColor = String(player.accentColor || '#42bbaa').slice(0, 60);
  player.progressColor = String(player.progressColor || player.accentColor).slice(0, 60);

  let elements;
  if (Array.isArray(raw.elements) && raw.elements.length > 0) {
    const seen = new Set();
    elements = raw.elements.slice(0, MAX_ELEMENTS).map(el => normalizeElement(el, player)).filter(el => {
      if (!ELEMENT_TYPES[el.type]) return false;
      if (seen.has(el.id)) el.id = uid(el.type);
      seen.add(el.id);
      return true;
    });
  } else {
    elements = defaultElements(player, raw.artwork && typeof raw.artwork === 'object' ? raw.artwork : null);
  }
  if (elements.length === 0) elements = defaultElements(player, raw.artwork);
  for (const reqType of REQUIRED_TYPES) {
    if (!elements.some(e => e.type === reqType)) {
      elements.push(makeElement(reqType, player, { zIndex: elements.length + 1 }));
    }
  }
  elements.forEach(el => {
    el.width = clamp(el.width, ELEMENT_TYPES[el.type].minW, player.playerWidth);
    el.height = clamp(el.height, ELEMENT_TYPES[el.type].minH, player.playerHeight);
    el.x = clamp(el.x, 0, Math.max(0, player.playerWidth - Math.min(el.width, player.playerWidth)));
    el.y = clamp(el.y, 0, Math.max(0, player.playerHeight - Math.min(el.height, player.playerHeight)));
  });
  reindexZ(elements);

  const config = { ...player, version: DESIGN_VERSION, elements };
  const img = elements.find(e => e.type === 'image');
  config.artwork = {
    visible: img ? img.visible !== false : false,
    url: img?.props?.src || (typeof raw.artwork?.url === 'string' ? raw.artwork.url : ''),
    shape: img?.props?.shape || 'rounded',
    size: img ? Math.max(img.width, img.height) : 56,
    radius: img?.props?.borderRadius ?? 12,
  };
  return config;
}

function getElements() { return state?.draft?.elements || []; }
function getSelected() { return getElements().find(e => e.id === state?.selectedId) || null; }
function sortByZ(els) { return [...els].sort((a, b) => a.zIndex - b.zIndex); }

function pushHistorySnapshot() {
  if (!state) return;
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(clone(state.draft));
  state.historyIndex = state.history.length - 1;
  if (state.history.length > 80) { state.history.shift(); state.historyIndex = Math.max(0, state.historyIndex - 1); }
  updateUndoRedoButtons();
}
function undo() {
  if (!state || state.historyIndex <= 0) return;
  state.historyIndex -= 1;
  state.draft = clone(state.history[state.historyIndex]);
  renderAll();
}
function redo() {
  if (!state || state.historyIndex >= state.history.length - 1) return;
  state.historyIndex += 1;
  state.draft = clone(state.history[state.historyIndex]);
  renderAll();
}
function updateUndoRedoButtons() {
  const u = document.getElementById('mp3d-undo');
  const r = document.getElementById('mp3d-redo');
  if (u) u.disabled = !state || state.historyIndex <= 0;
  if (r) r.disabled = !state || state.historyIndex >= state.history.length - 1;
}
function setStatus(msg, isError = false) {
  const el = document.getElementById('mp3d-status');
  if (el) { el.textContent = msg; el.style.color = isError ? 'var(--mp3d-danger, #f87171)' : ''; }
}
function syncLegacyArtworkFromElements() {
  if (!state) return;
  const img = state.draft.elements.find(e => e.type === 'image');
  state.draft.artwork = {
    visible: img ? img.visible !== false : false,
    url: img?.props?.src || '',
    shape: img?.props?.shape || 'rounded',
    size: img ? Math.max(img.width, img.height) : 56,
    radius: img?.props?.borderRadius ?? 12,
  };
}
function selectElement(id) {
  if (!state) return;
  state.selectedId = id || null;
  renderCanvas();
  renderLayers();
  renderInspector();
}

function getCanvasMetrics() {
  const player = document.getElementById('mp3d-player');
  if (!player || !state) return null;
  const rect = player.getBoundingClientRect();
  const scaleX = rect.width / (state.draft.playerWidth || 1);
  const scaleY = rect.height / (state.draft.playerHeight || 1);
  return { rect, scaleX: scaleX || 1, scaleY: scaleY || 1 };
}
function pointerToDesign(clientX, clientY) {
  const m = getCanvasMetrics();
  if (!m) return { x: 0, y: 0 };
  return { x: (clientX - m.rect.left) / m.scaleX, y: (clientY - m.rect.top) / m.scaleY };
}

function startDrag(e, elementId, mode, handle = null) {
  if (!state) return;
  const el = state.draft.elements.find(x => x.id === elementId);
  if (!el || el.locked) return;
  e.preventDefault();
  e.stopPropagation();
  const pt = pointerToDesign(e.clientX, e.clientY);
  interaction = { mode, elementId, handle, startPointer: pt, start: { x: el.x, y: el.y, width: el.width, height: el.height }, moved: false };
  try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch {}
  selectElement(elementId);
}
function onPointerMove(e) {
  if (!interaction || !state) return;
  const el = state.draft.elements.find(x => x.id === interaction.elementId);
  if (!el) return;
  const pt = pointerToDesign(e.clientX, e.clientY);
  const dx = pt.x - interaction.startPointer.x;
  const dy = pt.y - interaction.startPointer.y;
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) interaction.moved = true;
  const pw = state.draft.playerWidth, ph = state.draft.playerHeight;
  const meta = ELEMENT_TYPES[el.type];
  if (interaction.mode === 'move') {
    let nx = clamp(round(interaction.start.x + dx), 0, Math.max(0, pw - el.width));
    let ny = clamp(round(interaction.start.y + dy), 0, Math.max(0, ph - el.height));
    el.x = nx; el.y = ny;
  } else if (interaction.mode === 'resize') {
    let { x, y, width, height } = interaction.start;
    const hnd = interaction.handle || 'se';
    const preserve = el.type === 'image' && el.props?.preserveAspect !== false && el.props?.shape !== 'circle';
    const aspect = interaction.start.width / Math.max(1, interaction.start.height);
    if (hnd.includes('e')) width = interaction.start.width + dx;
    if (hnd.includes('s')) height = interaction.start.height + dy;
    if (hnd.includes('w')) { width = interaction.start.width - dx; x = interaction.start.x + dx; }
    if (hnd.includes('n')) { height = interaction.start.height - dy; y = interaction.start.y + dy; }
    width = clamp(round(width), meta.minW, pw);
    height = clamp(round(height), meta.minH, ph);
    if (el.type === 'image' && el.props?.shape === 'circle') {
      const s = Math.max(width, height); width = s; height = s;
    } else if (preserve && ['se','nw','ne','sw'].includes(hnd)) {
      height = clamp(round(width / aspect), meta.minH, ph);
      width = clamp(round(height * aspect), meta.minW, pw);
    }
    if (hnd.includes('w')) x = interaction.start.x + (interaction.start.width - width);
    if (hnd.includes('n')) y = interaction.start.y + (interaction.start.height - height);
    x = clamp(round(x), 0, Math.max(0, pw - width));
    y = clamp(round(y), 0, Math.max(0, ph - height));
    width = clamp(width, meta.minW, pw - x);
    height = clamp(height, meta.minH, ph - y);
    el.x = x; el.y = y; el.width = width; el.height = height;
  }
  renderCanvas();
  renderInspector(false);
}
function onPointerUp() {
  if (!interaction || !state) return;
  if (interaction.moved) {
    syncLegacyArtworkFromElements();
    pushHistorySnapshot();
    setStatus('Layout updated.');
  }
  interaction = null;
  renderCanvas(); renderLayers(); renderInspector();
}
function attachGlobalListeners() {
  if (listenersAttached) return;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  listenersAttached = true;
}

function elementTypeLabel(type) { return ELEMENT_TYPES[type]?.label || type; }
function layerName(el) {
  if (el.type === 'title') return `Title: ${(el.props.text || '').slice(0, 18) || 'Untitled'}`;
  if (el.type === 'subtitle') return `Subtitle: ${(el.props.text || '').slice(0, 18) || 'Subtitle'}`;
  if (el.type === 'image') return el.props.src ? 'Artwork Image' : 'Artwork (empty)';
  if (el.type === 'decorative') return 'Shape';
  return elementTypeLabel(el.type);
}

function renderElementContent(el) {
  const p = el.props || {};
  const o = `opacity:${finite(p.opacity, 1)};`;
  switch (el.type) {
    case 'title':
    case 'subtitle':
      return `<div class="mp3d-content mp3d-text" style="${o}color:${escAttr(p.color || '#fff')};font-size:${finite(p.fontSize, 14)}px;font-weight:${escAttr(p.fontWeight || '500')};text-align:${escAttr(p.align || 'left')};">${esc(p.text || (el.type === 'title' ? 'Title' : 'Subtitle'))}</div>`;
    case 'image': {
      const radius = p.shape === 'circle' ? '50%' : `${finite(p.borderRadius, 12)}px`;
      if (p.src) return `<img class="mp3d-content mp3d-image" src="${escAttr(p.src)}" alt="" style="${o}border-radius:${radius};object-fit:${escAttr(p.fit || 'cover')};">`;
      return `<div class="mp3d-content mp3d-image mp3d-image-empty" style="${o}border-radius:${radius};">Artwork</div>`;
    }
    case 'controls':
      return `<div class="mp3d-content mp3d-controls" style="${o}color:${escAttr(p.color || '#42bbaa')};font-size:${finite(p.size, 24)}px;">&#9198; &#9654;/&#10073;&#10073; &#9197;</div>`;
    case 'progress':
      return `<div class="mp3d-content mp3d-progress" style="${o}"><div class="mp3d-progress-track" style="background:${escAttr(p.trackColor || 'rgba(255,255,255,0.2)')};height:${finite(p.thickness, 6)}px;border-radius:${finite(p.radius, 999)}px;"><div class="mp3d-progress-fill" style="width:38%;background:${escAttr(p.progressColor || '#42bbaa')};height:100%;border-radius:${finite(p.radius, 999)}px;"></div></div></div>`;
    case 'timeCurrent':
    case 'timeDuration':
      return `<div class="mp3d-content mp3d-text" style="${o}color:${escAttr(p.color || '#fff')};font-size:${finite(p.fontSize, 11)}px;font-weight:${escAttr(p.fontWeight || '500')};text-align:${escAttr(p.align || 'left')};">${esc(p.text || '0:00')}</div>`;
    case 'decorative':
      return `<div class="mp3d-content mp3d-shape" style="${o}background:${escAttr(p.fill || '#42bbaa')};border-radius:${finite(p.borderRadius, 8)}px;border:${finite(p.borderWidth, 0)}px solid ${escAttr(p.borderColor || 'transparent')};"></div>`;
    default:
      return `<div class="mp3d-content">${esc(el.type)}</div>`;
  }
}

function renderElementOnCanvas(el, selected) {
  const hidden = !el.visible ? 'opacity:0.35;' : '';
  const selClass = selected ? ' mp3d-el-selected' : '';
  const lockClass = el.locked ? ' mp3d-el-locked' : '';
  const style = `left:${el.x}px;top:${el.y}px;width:${el.width}px;height:${el.height}px;z-index:${el.zIndex};${hidden}`;
  const handles = selected && !el.locked ? ['nw','n','ne','e','se','s','sw','w'].map(h => `<span class="mp3d-handle mp3d-handle-${h}" data-el-id="${escAttr(el.id)}" data-handle="${h}"></span>`).join('') : '';
  return `<div class="mp3d-el mp3d-el-${escAttr(el.type)}${selClass}${lockClass}" data-el-id="${escAttr(el.id)}" data-el-type="${escAttr(el.type)}" tabindex="0" style="${style}">${renderElementContent(el)}${selected ? `<span class="mp3d-el-label">${esc(elementTypeLabel(el.type))}</span>` : ''}${handles}</div>`;
}

function renderCanvas() {
  const wrap = document.getElementById('mp3d-canvas');
  if (!wrap || !state) return;
  const cfg = state.draft;
  const bg = cfg.backgroundImage ? `background-image:url('${escAttr(cfg.backgroundImage)}');background-size:${escAttr(cfg.backgroundFit || 'cover')};background-position:${escAttr(cfg.backgroundPosition || 'center')};` : '';
  const playerStyle = [
    bg,
    `background-color:${escAttr(cfg.backgroundColor || '')};`,
    `color:${escAttr(cfg.textColor || '#fff')};`,
    `border-radius:${cfg.borderRadius}px;`,
    `opacity:${cfg.backgroundOpacity};`,
    `width:${cfg.playerWidth}px;`,
    `height:${cfg.playerHeight}px;`,
  ].join('');
  const elementsHtml = sortByZ(getElements()).map(el => renderElementOnCanvas(el, el.id === state.selectedId)).join('');
  wrap.innerHTML = `
    <div class="mp3d-canvas-stage" id="mp3d-canvas-stage">
      <div class="mp3d-player" id="mp3d-player" style="${playerStyle}" data-testid="mp3d-player">
        ${cfg.backgroundImage ? `<div class="mp3d-player-overlay" style="opacity:${cfg.overlayOpacity};background:${escAttr(cfg.overlayColor || '#000')};"></div>` : ''}
        ${elementsHtml}
      </div>
    </div>`;
  wrap.querySelectorAll('.mp3d-el').forEach(node => {
    const id = node.getAttribute('data-el-id');
    node.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mp3d-handle')) return;
      startDrag(e, id, 'move');
    });
    node.addEventListener('click', (e) => { e.stopPropagation(); selectElement(id); });
  });
  wrap.querySelectorAll('.mp3d-handle').forEach(node => {
    const id = node.getAttribute('data-el-id');
    const handle = node.getAttribute('data-handle');
    node.addEventListener('pointerdown', (e) => startDrag(e, id, 'resize', handle));
  });
  const stage = document.getElementById('mp3d-canvas-stage');
  stage?.addEventListener('pointerdown', (e) => {
    if (e.target === stage || e.target.id === 'mp3d-player' || e.target.classList?.contains('mp3d-player-overlay')) {
      selectElement(null);
    }
  });
}

function renderLayers() {
  const list = document.getElementById('mp3d-layers');
  if (!list || !state) return;
  const items = sortByZ(getElements()).slice().reverse();
  list.innerHTML = items.map(el => `
    <li class="mp3d-layer-item ${el.id === state.selectedId ? 'is-selected' : ''}" data-layer-id="${escAttr(el.id)}">
      <button type="button" class="mp3d-layer-vis" data-action="toggle-vis" data-id="${escAttr(el.id)}" title="${el.visible ? 'Hide' : 'Show'}">${el.visible ? '👁' : '🚫'}</button>
      <button type="button" class="mp3d-layer-select" data-action="select" data-id="${escAttr(el.id)}">
        <span class="mp3d-layer-type">${esc(elementTypeLabel(el.type))}</span>
        <span class="mp3d-layer-name">${esc(layerName(el))}</span>
      </button>
      <span class="mp3d-layer-z">z${el.zIndex}</span>
    </li>`).join('') || '<li class="mp3d-empty">No elements</li>';
  list.querySelectorAll('[data-action="select"]').forEach(btn => btn.addEventListener('click', () => selectElement(btn.dataset.id)));
  list.querySelectorAll('[data-action="toggle-vis"]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const el = state.draft.elements.find(x => x.id === btn.dataset.id);
    if (!el) return;
    el.visible = !el.visible;
    syncLegacyArtworkFromElements();
    pushHistorySnapshot();
    setStatus(el.visible ? 'Element shown.' : 'Element hidden.');
    renderAll();
  }));
}

function moveLayer(direction) {
  const el = getSelected(); if (!el || !state) return;
  const ordered = sortByZ(getElements());
  const idx = ordered.findIndex(x => x.id === el.id);
  if (direction === 'front') { el.zIndex = ordered[ordered.length - 1].zIndex + 1; }
  else if (direction === 'back') { el.zIndex = ordered[0].zIndex - 1; }
  else if (direction === 'forward' && idx < ordered.length - 1) {
    const other = ordered[idx + 1]; const tmp = el.zIndex; el.zIndex = other.zIndex; other.zIndex = tmp;
  } else if (direction === 'backward' && idx > 0) {
    const other = ordered[idx - 1]; const tmp = el.zIndex; el.zIndex = other.zIndex; other.zIndex = tmp;
  } else { return; }
  reindexZ(getElements());
  pushHistorySnapshot();
  setStatus('Layer order updated.');
  renderAll();
}

function addElement(type) {
  if (!state || !ELEMENT_TYPES[type]) return;
  if (getElements().length >= MAX_ELEMENTS) { setStatus('Maximum element count reached.', true); return; }
  const el = makeElement(type, state.draft, { x: 20 + (getElements().length % 8) * 8, y: 20 + (getElements().length % 6) * 6, zIndex: getElements().length + 1 });
  state.draft.elements.push(el);
  reindexZ(state.draft.elements);
  state.selectedId = el.id;
  syncLegacyArtworkFromElements();
  pushHistorySnapshot();
  setStatus(`${elementTypeLabel(type)} added.`);
  renderAll();
}
function duplicateSelected() {
  const el = getSelected(); if (!state || !el) return;
  if (getElements().length >= MAX_ELEMENTS) { setStatus('Maximum element count reached.', true); return; }
  const copy = clone(el);
  copy.id = uid(copy.type);
  copy.x = clamp(el.x + 12, 0, Math.max(0, state.draft.playerWidth - el.width));
  copy.y = clamp(el.y + 12, 0, Math.max(0, state.draft.playerHeight - el.height));
  copy.zIndex = Math.max(...getElements().map(e => e.zIndex), 0) + 1;
  state.draft.elements.push(copy);
  reindexZ(state.draft.elements);
  state.selectedId = copy.id;
  syncLegacyArtworkFromElements();
  pushHistorySnapshot();
  setStatus('Element duplicated.');
  renderAll();
}
function deleteSelected() {
  const el = getSelected(); if (!state || !el) return;
  if (REQUIRED_TYPES.has(el.type) && getElements().filter(e => e.type === el.type).length <= 1) {
    setStatus(`${elementTypeLabel(el.type)} is required and cannot be deleted.`, true);
    return;
  }
  state.draft.elements = state.draft.elements.filter(e => e.id !== el.id);
  state.selectedId = null;
  reindexZ(state.draft.elements);
  syncLegacyArtworkFromElements();
  pushHistorySnapshot();
  setStatus('Element deleted.');
  renderAll();
}
function toggleSelectedVisibility() {
  const el = getSelected(); if (!el) return;
  el.visible = !el.visible;
  syncLegacyArtworkFromElements();
  pushHistorySnapshot();
  setStatus(el.visible ? 'Element shown.' : 'Element hidden.');
  renderAll();
}

function playerInspectorHtml() {
  const c = state.draft;
  const colorVal = (v, fb) => isHexLike(v) ? v : fb;
  return `
    <label>Template <select id="mp3d-template">${TEMPLATES.map(t => `<option value="${t.id}" ${c.template === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
    <label>Background color <input id="mp3d-bg-color" type="text" value="${escAttr(c.backgroundColor)}"></label>
    <label>Background image URL <input id="mp3d-bg-image" type="text" value="${escAttr(c.backgroundImage)}"></label>
    <div class="mp3d-button-row"><label class="btn btn-secondary" for="mp3d-bg-file">Upload BG</label><button type="button" class="btn btn-secondary" id="mp3d-bg-clear">Clear BG</button></div>
    <input id="mp3d-bg-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
    <label>BG fit <select id="mp3d-bg-fit"><option value="cover" ${c.backgroundFit === 'cover' ? 'selected' : ''}>Cover</option><option value="contain" ${c.backgroundFit === 'contain' ? 'selected' : ''}>Contain</option><option value="fill" ${c.backgroundFit === 'fill' ? 'selected' : ''}>Fill</option></select></label>
    <label>BG opacity <input id="mp3d-bg-opacity" type="range" min="0" max="1" step="0.05" value="${c.backgroundOpacity}"></label>
    <label>Overlay opacity <input id="mp3d-overlay-opacity" type="range" min="0" max="1" step="0.05" value="${c.overlayOpacity}"></label>
    <label>Overlay color <input id="mp3d-overlay-color" type="color" value="${colorVal(c.overlayColor, '#000000')}"></label>
    <label>Text color <input id="mp3d-text-color" type="color" value="${colorVal(c.textColor, '#ffffff')}"></label>
    <label>Accent <input id="mp3d-accent-color" type="color" value="${colorVal(c.accentColor, '#42bbaa')}"></label>
    <label>Progress <input id="mp3d-progress-color" type="color" value="${colorVal(c.progressColor, '#42bbaa')}"></label>
    <label>Player width <input id="mp3d-player-w" type="number" min="220" max="520" value="${c.playerWidth}"></label>
    <label>Player height <input id="mp3d-player-h" type="number" min="72" max="320" value="${c.playerHeight}"></label>
    <label>Corner radius <input id="mp3d-radius" type="number" min="0" max="60" value="${c.borderRadius}"></label>`;
}

function typePropsHtml(el) {
  const p = el.props || {};
  const text = (id, label, val) => `<label>${label} <input id="${id}" type="text" value="${escAttr(val ?? '')}"></label>`;
  const color = (id, label, val) => `<label>${label} <input id="${id}" type="color" value="${isHexLike(val) ? val : '#ffffff'}"></label>`;
  const range = (id, label, val, min, max, step) => `<label>${label} <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
  const num = (id, label, val, min, max) => `<label>${label} <input id="${id}" type="number" min="${min}" max="${max}" value="${val}"></label>`;
  const sel = (id, label, val, opts) => `<label>${label} <select id="${id}">${opts.map(o => `<option value="${o.v}" ${val === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>`;
  if (el.type === 'title' || el.type === 'subtitle') {
    return `${text('mp3d-p-text', 'Text', p.text)}${num('mp3d-p-fontSize', 'Font size', p.fontSize, 8, 72)}${sel('mp3d-p-fontWeight', 'Weight', p.fontWeight, [{v:'400',l:'Normal'},{v:'500',l:'Medium'},{v:'600',l:'Semibold'},{v:'700',l:'Bold'}])}${color('mp3d-p-color', 'Color', p.color)}${sel('mp3d-p-align', 'Align', p.align, [{v:'left',l:'Left'},{v:'center',l:'Center'},{v:'right',l:'Right'}])}${range('mp3d-p-opacity', 'Opacity', p.opacity, 0, 1, 0.05)}`;
  }
  if (el.type === 'image') {
    return `${text('mp3d-p-src', 'Image source', p.src)}
      <div class="mp3d-button-row"><label class="btn btn-secondary" for="mp3d-image-file">Upload/Replace</label><button type="button" class="btn btn-secondary" id="mp3d-image-clear">Clear</button></div>
      <input id="mp3d-image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
      ${sel('mp3d-p-fit', 'Fit/crop', p.fit, [{v:'cover',l:'Cover'},{v:'contain',l:'Contain'},{v:'fill',l:'Fill'}])}
      ${sel('mp3d-p-shape', 'Shape', p.shape, [{v:'rounded',l:'Rounded'},{v:'circle',l:'Circle'}])}
      ${num('mp3d-p-borderRadius', 'Border radius', p.borderRadius, 0, 500)}
      ${range('mp3d-p-opacity', 'Opacity', p.opacity, 0, 1, 0.05)}
      <label class="mp3d-check"><input id="mp3d-p-preserveAspect" type="checkbox" ${p.preserveAspect !== false ? 'checked' : ''}> Preserve aspect on resize</label>`;
  }
  if (el.type === 'controls') {
    return `${color('mp3d-p-color', 'Color', p.color)}${num('mp3d-p-size', 'Icon size', p.size, 16, 80)}${range('mp3d-p-opacity', 'Opacity', p.opacity, 0, 1, 0.05)}`;
  }
  if (el.type === 'progress') {
    return `${text('mp3d-p-trackColor', 'Track color', p.trackColor)}${color('mp3d-p-progressColor', 'Progress color', p.progressColor)}${num('mp3d-p-thickness', 'Thickness', p.thickness, 2, 40)}${num('mp3d-p-radius', 'Radius', p.radius, 0, 999)}${range('mp3d-p-opacity', 'Opacity', p.opacity, 0, 1, 0.05)}`;
  }
  if (el.type === 'timeCurrent' || el.type === 'timeDuration') {
    return `${text('mp3d-p-text', 'Display text', p.text)}${num('mp3d-p-fontSize', 'Font size', p.fontSize, 8, 48)}${sel('mp3d-p-fontWeight', 'Weight', p.fontWeight, [{v:'400',l:'Normal'},{v:'500',l:'Medium'},{v:'600',l:'Semibold'},{v:'700',l:'Bold'}])}${color('mp3d-p-color', 'Color', p.color)}${sel('mp3d-p-align', 'Align', p.align, [{v:'left',l:'Left'},{v:'center',l:'Center'},{v:'right',l:'Right'}])}${range('mp3d-p-opacity', 'Opacity', p.opacity, 0, 1, 0.05)}`;
  }
  if (el.type === 'decorative') {
    return `${text('mp3d-p-fill', 'Fill', p.fill)}${num('mp3d-p-borderRadius', 'Border radius', p.borderRadius, 0, 500)}${text('mp3d-p-borderColor', 'Border color', p.borderColor)}${num('mp3d-p-borderWidth', 'Border width', p.borderWidth, 0, 20)}${range('mp3d-p-opacity', 'Opacity', p.opacity, 0, 1, 0.05)}`;
  }
  return '';
}

function renderInspector(renderStructure = true) {
  const panel = document.getElementById('mp3d-inspector');
  if (!panel || !state) return;
  if (!renderStructure && document.activeElement && panel.contains(document.activeElement)) {
    const el = getSelected();
    if (el) {
      const setVal = (id, v) => { const n = document.getElementById(id); if (n && n !== document.activeElement) n.value = v; };
      setVal('mp3d-prop-x', el.x); setVal('mp3d-prop-y', el.y); setVal('mp3d-prop-w', el.width); setVal('mp3d-prop-h', el.height);
    }
    return;
  }
  const el = getSelected();
  if (!el) {
    panel.innerHTML = `<div class="mp3d-inspector-empty"><h3>Properties</h3><p>Select an element on the canvas or in Layers to edit its properties.</p><hr><h4>Player</h4>${playerInspectorHtml()}</div>`;
    bindPlayerInspector();
    return;
  }
  const isRequired = REQUIRED_TYPES.has(el.type) && getElements().filter(e => e.type === el.type).length <= 1;
  panel.innerHTML = `
    <div class="mp3d-inspector-head">
      <h3>${esc(elementTypeLabel(el.type))}</h3>
      <p class="mp3d-inspector-id">ID: ${esc(el.id)}</p>
      ${isRequired ? '<p class="mp3d-inspector-note">Required element: cannot be deleted.</p>' : ''}
    </div>
    <div class="mp3d-field-grid">
      <label>X <input id="mp3d-prop-x" type="number" value="${el.x}"></label>
      <label>Y <input id="mp3d-prop-y" type="number" value="${el.y}"></label>
      <label>W <input id="mp3d-prop-w" type="number" min="${ELEMENT_TYPES[el.type].minW}" value="${el.width}"></label>
      <label>H <input id="mp3d-prop-h" type="number" min="${ELEMENT_TYPES[el.type].minH}" value="${el.height}"></label>
    </div>
    <label class="mp3d-check"><input id="mp3d-prop-visible" type="checkbox" ${el.visible ? 'checked' : ''}> Visible</label>
    <label class="mp3d-check"><input id="mp3d-prop-locked" type="checkbox" ${el.locked ? 'checked' : ''}> Locked</label>
    <div class="mp3d-type-props">${typePropsHtml(el)}</div>
    <hr><h4>Player</h4>${playerInspectorHtml()}`;
  bindInspector(el);
  bindPlayerInspector();
}

function bindInspector(el) {
  const onNum = (id, fn) => { const n = document.getElementById(id); if (!n) return; n.addEventListener('change', () => { fn(Number(n.value)); pushHistorySnapshot(); renderAll(); }); };
  onNum('mp3d-prop-x', v => { el.x = clamp(round(v), 0, Math.max(0, state.draft.playerWidth - el.width)); });
  onNum('mp3d-prop-y', v => { el.y = clamp(round(v), 0, Math.max(0, state.draft.playerHeight - el.height)); });
  onNum('mp3d-prop-w', v => { el.width = clamp(round(v), ELEMENT_TYPES[el.type].minW, state.draft.playerWidth - el.x); });
  onNum('mp3d-prop-h', v => { el.height = clamp(round(v), ELEMENT_TYPES[el.type].minH, state.draft.playerHeight - el.y); });
  const vis = document.getElementById('mp3d-prop-visible');
  vis?.addEventListener('change', () => { el.visible = vis.checked; syncLegacyArtworkFromElements(); pushHistorySnapshot(); renderAll(); });
  const lock = document.getElementById('mp3d-prop-locked');
  lock?.addEventListener('change', () => { el.locked = lock.checked; pushHistorySnapshot(); renderAll(); });

  const bindProp = (id, key, transform = (v) => v, event = 'change') => {
    const n = document.getElementById(id); if (!n) return;
    n.addEventListener(event, () => {
      el.props[key] = transform(n.type === 'checkbox' ? n.checked : n.value);
      if (el.type === 'image' && key === 'src') syncLegacyArtworkFromElements();
      pushHistorySnapshot(); renderAll();
    });
  };
  const bindInput = (id, key, transform = (v) => v) => bindProp(id, key, transform, 'input');

  if (el.type === 'title' || el.type === 'subtitle') {
    bindInput('mp3d-p-text', 'text', v => String(v).slice(0, 120));
    bindProp('mp3d-p-fontSize', 'fontSize', v => clamp(round(v), 8, 72));
    bindProp('mp3d-p-fontWeight', 'fontWeight');
    bindInput('mp3d-p-color', 'color', v => String(v).slice(0, 60));
    bindProp('mp3d-p-align', 'align');
    bindInput('mp3d-p-opacity', 'opacity', v => clamp(finite(v, 1), 0, 1));
  }
  if (el.type === 'image') {
    bindInput('mp3d-p-src', 'src', v => String(v).slice(0, 500));
    bindProp('mp3d-p-fit', 'fit');
    bindProp('mp3d-p-shape', 'shape');
    bindProp('mp3d-p-borderRadius', 'borderRadius', v => clamp(round(v), 0, 500));
    bindInput('mp3d-p-opacity', 'opacity', v => clamp(finite(v, 1), 0, 1));
    bindProp('mp3d-p-preserveAspect', 'preserveAspect', v => !!v);
    document.getElementById('mp3d-image-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      setStatus('Uploading artwork image...');
      try {
        const data = await profileMp3Api.uploadPlayerImage(file);
        el.props.src = data.image_url || '';
        syncLegacyArtworkFromElements();
        pushHistorySnapshot(); setStatus('Artwork image uploaded.'); renderAll();
      } catch (err) { setStatus(err.message || 'Image upload failed.', true); }
      finally { e.target.value = ''; }
    });
    document.getElementById('mp3d-image-clear')?.addEventListener('click', () => { el.props.src = ''; syncLegacyArtworkFromElements(); pushHistorySnapshot(); renderAll(); });
  }
  if (el.type === 'controls') {
    bindInput('mp3d-p-color', 'color', v => String(v).slice(0, 60));
    bindProp('mp3d-p-size', 'size', v => clamp(round(v), 16, 80));
    bindInput('mp3d-p-opacity', 'opacity', v => clamp(finite(v, 1), 0, 1));
  }
  if (el.type === 'progress') {
    bindInput('mp3d-p-trackColor', 'trackColor', v => String(v).slice(0, 60));
    bindInput('mp3d-p-progressColor', 'progressColor', v => String(v).slice(0, 60));
    bindProp('mp3d-p-thickness', 'thickness', v => clamp(round(v), 2, 40));
    bindProp('mp3d-p-radius', 'radius', v => clamp(round(v), 0, 999));
    bindInput('mp3d-p-opacity', 'opacity', v => clamp(finite(v, 1), 0, 1));
  }
  if (el.type === 'timeCurrent' || el.type === 'timeDuration') {
    bindInput('mp3d-p-text', 'text', v => String(v).slice(0, 40));
    bindProp('mp3d-p-fontSize', 'fontSize', v => clamp(round(v), 8, 48));
    bindProp('mp3d-p-fontWeight', 'fontWeight');
    bindInput('mp3d-p-color', 'color', v => String(v).slice(0, 60));
    bindProp('mp3d-p-align', 'align');
    bindInput('mp3d-p-opacity', 'opacity', v => clamp(finite(v, 1), 0, 1));
  }
  if (el.type === 'decorative') {
    bindInput('mp3d-p-fill', 'fill', v => String(v).slice(0, 80));
    bindProp('mp3d-p-borderRadius', 'borderRadius', v => clamp(round(v), 0, 500));
    bindInput('mp3d-p-borderColor', 'borderColor', v => String(v).slice(0, 60));
    bindProp('mp3d-p-borderWidth', 'borderWidth', v => clamp(round(v), 0, 20));
    bindInput('mp3d-p-opacity', 'opacity', v => clamp(finite(v, 1), 0, 1));
  }
}

function bindPlayerInspector() {
  document.getElementById('mp3d-template')?.addEventListener('change', (e) => {
    const t = TEMPLATES.find(x => x.id === e.target.value); if (!t) return;
    Object.assign(state.draft, clone(t.config));
    state.draft.template = t.id;
    state.draft = normalizeConfig(state.draft);
    pushHistorySnapshot(); setStatus(`Template "${t.label}" applied.`); renderAll();
  });
  const bind = (id, fn, event = 'change') => { const n = document.getElementById(id); if (!n) return; n.addEventListener(event, () => { fn(n.value); pushHistorySnapshot(); renderAll(); }); };
  const bindInput = (id, fn) => bind(id, fn, 'input');
  bindInput('mp3d-bg-color', v => { state.draft.backgroundColor = String(v).slice(0, 140); });
  bindInput('mp3d-bg-image', v => { state.draft.backgroundImage = String(v).slice(0, 500); });
  bind('mp3d-bg-fit', v => { state.draft.backgroundFit = v; });
  bindInput('mp3d-bg-opacity', v => { state.draft.backgroundOpacity = clamp(finite(v, 1), 0, 1); });
  bindInput('mp3d-overlay-opacity', v => { state.draft.overlayOpacity = clamp(finite(v, 0.12), 0, 1); });
  bindInput('mp3d-overlay-color', v => { state.draft.overlayColor = String(v).slice(0, 60); });
  bindInput('mp3d-text-color', v => { state.draft.textColor = String(v).slice(0, 60); });
  bindInput('mp3d-accent-color', v => { state.draft.accentColor = String(v).slice(0, 60); });
  bindInput('mp3d-progress-color', v => { state.draft.progressColor = String(v).slice(0, 60); });
  bind('mp3d-player-w', v => { state.draft.playerWidth = clamp(round(v), 220, 520); state.draft = normalizeConfig(state.draft); });
  bind('mp3d-player-h', v => { state.draft.playerHeight = clamp(round(v), 72, 320); state.draft = normalizeConfig(state.draft); });
  bindInput('mp3d-radius', v => { state.draft.borderRadius = clamp(round(v), 0, 60); });

  document.getElementById('mp3d-bg-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setStatus('Uploading background image...');
    try {
      const data = await profileMp3Api.uploadPlayerImage(file);
      state.draft.backgroundImage = data.image_url || '';
      pushHistorySnapshot(); setStatus('Background uploaded.'); renderAll();
    } catch (err) { setStatus(err.message || 'Image upload failed.', true); }
    finally { e.target.value = ''; }
  });
  document.getElementById('mp3d-bg-clear')?.addEventListener('click', () => { state.draft.backgroundImage = ''; pushHistorySnapshot(); renderAll(); });
}

function renderToolbar() {
  const t = document.getElementById('mp3d-toolbar-extra');
  if (!t) return;
  t.innerHTML = `
    <select id="mp3d-add-type" aria-label="Element type">
      ${Object.entries(ELEMENT_TYPES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}
    </select>
    <button type="button" class="btn btn-secondary" id="mp3d-add-btn">Add</button>
    <button type="button" class="btn btn-secondary" id="mp3d-dup-btn">Duplicate</button>
    <button type="button" class="btn btn-secondary" id="mp3d-del-btn">Delete</button>
    <button type="button" class="btn btn-secondary" id="mp3d-vis-btn">Show/Hide</button>
    <span class="mp3d-sep"></span>
    <button type="button" class="btn btn-secondary" id="mp3d-back-btn" title="Send backward">Backward</button>
    <button type="button" class="btn btn-secondary" id="mp3d-fwd-btn" title="Bring forward">Forward</button>
    <button type="button" class="btn btn-secondary" id="mp3d-backmost-btn" title="Send to back">To Back</button>
    <button type="button" class="btn btn-secondary" id="mp3d-frontmost-btn" title="Bring to front">To Front</button>`;
  document.getElementById('mp3d-add-btn')?.addEventListener('click', () => addElement(document.getElementById('mp3d-add-type').value));
  document.getElementById('mp3d-dup-btn')?.addEventListener('click', duplicateSelected);
  document.getElementById('mp3d-del-btn')?.addEventListener('click', deleteSelected);
  document.getElementById('mp3d-vis-btn')?.addEventListener('click', toggleSelectedVisibility);
  document.getElementById('mp3d-back-btn')?.addEventListener('click', () => moveLayer('backward'));
  document.getElementById('mp3d-fwd-btn')?.addEventListener('click', () => moveLayer('forward'));
  document.getElementById('mp3d-backmost-btn')?.addEventListener('click', () => moveLayer('back'));
  document.getElementById('mp3d-frontmost-btn')?.addEventListener('click', () => moveLayer('front'));
}

function renderAll() {
  if (!state) return;
  updateUndoRedoButtons();
  renderCanvas();
  renderLayers();
  renderInspector();
}

export function renderMp3PlayerDesignerPage() {
  return `
    <section class="mp3-designer" id="mp3-designer">
      <header class="mp3-designer-header">
        <div>
          <h1>MP3 Player Designer</h1>
          <p>Graphical element editor for your public-profile MP3 player. Drag, resize, layer, and configure elements.</p>
        </div>
        <div class="mp3-designer-actions">
          <button type="button" class="btn btn-secondary" id="mp3d-back-studio">Back to Creator Studio</button>
          <button type="button" class="btn btn-secondary" id="mp3d-undo" title="Undo">Undo</button>
          <button type="button" class="btn btn-secondary" id="mp3d-redo" title="Redo">Redo</button>
          <button type="button" class="btn btn-secondary" id="mp3d-save-draft">Save Draft</button>
          <button type="button" class="btn btn-primary" id="mp3d-publish">Publish</button>
        </div>
      </header>
      <div class="mp3d-toolbar" id="mp3d-toolbar-extra"></div>
      <p id="mp3d-status" role="status" aria-live="polite" class="mp3d-status">Loading designer…</p>
      <div class="mp3d-workspace">
        <aside class="mp3d-panel mp3d-layers-panel">
          <h2>Layers</h2>
          <ul id="mp3d-layers" class="mp3d-layers" aria-label="Element layers"></ul>
        </aside>
        <main class="mp3d-center">
          <div class="mp3d-canvas-wrap">
            <div id="mp3d-canvas" class="mp3d-canvas" data-testid="mp3d-canvas"></div>
          </div>
          <p class="mp3d-hint">Click to select. Drag to move. Use handles to resize. Save Draft keeps changes private; Publish updates the public profile.</p>
        </main>
        <aside class="mp3d-panel mp3d-inspector-panel" id="mp3d-inspector"></aside>
      </div>
    </section>`;
}

export async function initMp3PlayerDesignerPage() {
  state = { draft: normalizeConfig(DEFAULT_PLAYER), published: null, selectedId: null, history: [], historyIndex: -1 };
  pushHistorySnapshot();
  attachGlobalListeners();
  renderToolbar();
  try {
    const data = await profileMp3Api.getPlayerDesign();
    const design = data && data.design;
    if (design) {
      if (design.draft) state.draft = normalizeConfig(design.draft);
      else if (design.published) state.draft = normalizeConfig(design.published);
      else state.draft = normalizeConfig(design);
      state.published = design.published ? normalizeConfig(design.published) : null;
    }
  } catch (err) {
    setStatus(err.message || 'Could not load saved design.', true);
  }
  state.history = [clone(state.draft)];
  state.historyIndex = 0;
  document.getElementById('mp3d-back-studio')?.addEventListener('click', () => { window.location.hash = '/creator-studio'; });
  document.getElementById('mp3d-undo')?.addEventListener('click', undo);
  document.getElementById('mp3d-redo')?.addEventListener('click', redo);
  document.getElementById('mp3d-save-draft')?.addEventListener('click', async () => {
    setStatus('Saving draft…');
    try {
      syncLegacyArtworkFromElements();
      await profileMp3Api.savePlayerDesign(state.draft, false);
      setStatus('Draft saved.');
    } catch (err) { setStatus(err.message || 'Could not save draft.', true); }
  });
  document.getElementById('mp3d-publish')?.addEventListener('click', async () => {
    setStatus('Publishing…');
    try {
      syncLegacyArtworkFromElements();
      const res = await profileMp3Api.savePlayerDesign(state.draft, true);
      state.published = res.design?.published ? normalizeConfig(res.design.published) : clone(state.draft);
      setStatus('Published. Draft remains editable.');
    } catch (err) { setStatus(err.message || 'Could not publish.', true); }
  });
  renderAll();
  setStatus('Designer ready. Select or add elements to begin.');
}

export function destroyMp3PlayerDesignerPage() {
  state = null;
  interaction = null;
}

// Exported for tests and parity consumers
export const __testables = {
  DESIGN_VERSION, ELEMENT_TYPES, REQUIRED_TYPES, MAX_ELEMENTS,
  normalizeConfig, defaultElements, makeElement, normalizeElement, reindexZ, clone,
};
