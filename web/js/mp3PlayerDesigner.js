import { profileMp3Api } from './api.js';

const TEMPLATES = [
  { id: 'modern-minimal', label: 'Modern Minimal', config: { backgroundColor: 'rgba(255,255,255,0.82)', textColor: '#1f2937', accentColor: '#42bbaa', progressColor: '#42bbaa', borderRadius: 18, backgroundOpacity: 1, overlayOpacity: 0.12, playerWidth: 320, playerHeight: 118, artwork: { visible: true, shape: 'rounded', size: 58, radius: 14, url: '' } } },
  { id: 'dark-theme', label: 'Dark Theme', config: { backgroundColor: 'rgba(17,24,39,0.88)', textColor: '#f9fafb', accentColor: '#22d3ee', progressColor: '#22d3ee', borderRadius: 20, backgroundOpacity: 0.92, overlayOpacity: 0.45, playerWidth: 320, playerHeight: 124, artwork: { visible: true, shape: 'rounded', size: 60, radius: 16, url: '' } } },
  { id: 'gradient-style', label: 'Gradient Style', config: { backgroundColor: 'linear-gradient(135deg, rgba(99,102,241,0.9), rgba(236,72,153,0.85))', textColor: '#ffffff', accentColor: '#fbbf24', progressColor: '#fbbf24', borderRadius: 24, backgroundOpacity: 1, overlayOpacity: 0.18, playerWidth: 330, playerHeight: 126, artwork: { visible: true, shape: 'circle', size: 62, radius: 31, url: '' } } },
  { id: 'compact-bar', label: 'Compact Bar', config: { backgroundColor: 'rgba(31,41,55,0.9)', textColor: '#ffffff', accentColor: '#34d399', progressColor: '#34d399', borderRadius: 12, backgroundOpacity: 0.95, overlayOpacity: 0.2, playerWidth: 280, playerHeight: 82, artwork: { visible: true, shape: 'rounded', size: 42, radius: 10, url: '' } } },
  { id: 'card-style', label: 'Card Style', config: { backgroundColor: 'rgba(255,255,255,0.94)', textColor: '#111827', accentColor: '#ef4444', progressColor: '#ef4444', borderRadius: 28, backgroundOpacity: 1, overlayOpacity: 0.08, playerWidth: 360, playerHeight: 150, artwork: { visible: true, shape: 'rounded', size: 84, radius: 18, url: '' } } },
  { id: 'retro-style', label: 'Retro Style', config: { backgroundColor: 'rgba(120,53,15,0.9)', textColor: '#fef3c7', accentColor: '#f59e0b', progressColor: '#f59e0b', borderRadius: 10, backgroundOpacity: 0.95, overlayOpacity: 0.25, playerWidth: 320, playerHeight: 120, artwork: { visible: true, shape: 'rounded', size: 58, radius: 6, url: '' } } },
];

const DEFAULT_CONFIG = { ...TEMPLATES[0].config, template: TEMPLATES[0].id, backgroundImage: '', backgroundFit: 'cover', backgroundPosition: 'center', overlayColor: '#000000', artwork: { ...TEMPLATES[0].config.artwork } };

let designerState = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeConfig(config) {
  const base = clone(DEFAULT_CONFIG);
  const input = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const artwork = input.artwork && typeof input.artwork === 'object' ? input.artwork : {};
  return {
    ...base,
    ...input,
    template: input.template || base.template,
    artwork: { ...base.artwork, ...artwork },
  };
}

function pushHistory(config) {
  if (!designerState) return;
  designerState.history = designerState.history.slice(0, designerState.historyIndex + 1);
  designerState.history.push(clone(config));
  designerState.historyIndex = designerState.history.length - 1;
  if (designerState.history.length > 50) {
    designerState.history.shift();
    designerState.historyIndex = Math.max(0, designerState.historyIndex - 1);
  }
}

function setConfig(config, record = true) {
  if (!designerState) return;
  const next = normalizeConfig(config);
  designerState.draft = next;
  if (record) pushHistory(next);
  renderDesigner();
}

function undo() {
  if (!designerState || designerState.historyIndex <= 0) return;
  designerState.historyIndex -= 1;
  designerState.draft = clone(designerState.history[designerState.historyIndex]);
  renderDesigner();
}

function redo() {
  if (!designerState || designerState.historyIndex >= designerState.history.length - 1) return;
  designerState.historyIndex += 1;
  designerState.draft = clone(designerState.history[designerState.historyIndex]);
  renderDesigner();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function playerPreviewHtml(config) {
  const c = normalizeConfig(config);
  const art = c.artwork || {};
  const background = c.backgroundImage ? `background-image:url('${escapeHtml(c.backgroundImage)}');background-size:${escapeHtml(c.backgroundFit || 'cover')};background-position:${escapeHtml(c.backgroundPosition || 'center')};` : '';
  const style = [
    background,
    `background-color:${escapeHtml(c.backgroundColor || '')};`,
    `color:${escapeHtml(c.textColor || '#ffffff')};`,
    `border-radius:${c.borderRadius || 16}px;`,
    `opacity:${c.backgroundOpacity ?? 1};`,
    `--mp3-accent:${escapeHtml(c.accentColor || '#42bbaa')};`,
    c.playerWidth ? `width:${c.playerWidth}px;max-width:100%;` : '',
    c.playerHeight ? `min-height:${c.playerHeight}px;` : '',
  ].join('');
  return `
    <div class="mp3-designer-preview-player" style="${style}">
      ${c.backgroundImage ? `<div class="mp3-designer-preview-overlay" style="opacity:${c.overlayOpacity ?? 0.25};background:${escapeHtml(c.overlayColor || '#000000')};"></div>` : ''}
      ${art.visible !== false && art.url ? `<img class="mp3-designer-preview-art" src="${escapeHtml(art.url)}" alt="" style="width:${art.size || 56}px;height:${art.size || 56}px;border-radius:${art.shape === 'circle' ? '50%' : (art.radius || 12) + 'px'};object-fit:cover;">` : ''}
      <div class="mp3-designer-preview-title">Featured track</div>
      <div class="mp3-designer-preview-progress"><span style="width:38%;background:${escapeHtml(c.progressColor || c.accentColor || '#42bbaa')};"></span></div>
      <div class="mp3-designer-preview-controls">? ? ? ?</div>
    </div>
  `;
}

export function renderMp3PlayerDesignerPage() {
  return `
    <section class="mp3-designer" id="mp3-designer">
      <header class="mp3-designer-header">
        <div>
          <h1>MP3 Player Designer</h1>
          <p>Customize the background, artwork, colors, and layout of your public-profile MP3 player.</p>
        </div>
        <div class="mp3-designer-actions">
          <button type="button" class="btn btn-secondary" id="mp3-designer-back">Back to Creator Studio</button>
          <button type="button" class="btn btn-secondary" id="mp3-designer-undo" title="Undo">Undo</button>
          <button type="button" class="btn btn-secondary" id="mp3-designer-redo" title="Redo">Redo</button>
          <button type="button" class="btn btn-secondary" id="mp3-designer-save-draft">Save Draft</button>
          <button type="button" class="btn btn-primary" id="mp3-designer-publish">Publish</button>
        </div>
      </header>
      <p id="mp3-designer-status" role="status" aria-live="polite">Loading designer…</p>
      <div class="mp3-designer-layout">
        <aside class="mp3-designer-panel">
          <h2>Templates</h2>
          <select id="mp3-designer-template">
            ${TEMPLATES.map((template) => `<option value="${template.id}">${escapeHtml(template.label)}</option>`).join('')}
          </select>
          <h2>Player Background</h2>
          <input id="mp3-designer-bg-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          <div class="mp3-designer-button-row">
            <label class="btn btn-secondary" for="mp3-designer-bg-file">Upload Background</label>
            <button type="button" class="btn btn-secondary" id="mp3-designer-bg-remove">Remove</button>
          </div>
          <label>Fit <select id="mp3-designer-bg-fit"><option value="cover">Cover</option><option value="contain">Contain</option><option value="fill">Fill</option></select></label>
          <label>Position <input id="mp3-designer-bg-position" type="text" placeholder="center"></label>
          <label>Background opacity <input id="mp3-designer-bg-opacity" type="range" min="0" max="1" step="0.05"></label>
          <label>Overlay opacity <input id="mp3-designer-overlay-opacity" type="range" min="0" max="1" step="0.05"></label>
          <label>Overlay color <input id="mp3-designer-overlay-color" type="color"></label>
          <label>Background color <input id="mp3-designer-bg-color" type="text"></label>
          <h2>Player Size</h2>
          <label>Width <input id="mp3-designer-width" type="number" min="220" max="420"></label>
          <label>Height <input id="mp3-designer-height" type="number" min="72" max="220"></label>
          <label>Corner radius <input id="mp3-designer-radius" type="number" min="0" max="40"></label>
          <h2>Colors</h2>
          <label>Text color <input id="mp3-designer-text-color" type="color"></label>
          <label>Accent color <input id="mp3-designer-accent-color" type="color"></label>
          <label>Progress color <input id="mp3-designer-progress-color" type="color"></label>
          <h2>Artwork</h2>
          <input id="mp3-designer-art-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          <div class="mp3-designer-button-row">
            <label class="btn btn-secondary" for="mp3-designer-art-file">Upload Artwork</label>
            <button type="button" class="btn btn-secondary" id="mp3-designer-art-remove">Remove</button>
          </div>
          <label>Shape <select id="mp3-designer-art-shape"><option value="rounded">Rounded</option><option value="circle">Circle</option></select></label>
          <label>Size <input id="mp3-designer-art-size" type="number" min="32" max="120"></label>
          <label>Corner radius <input id="mp3-designer-art-radius" type="number" min="0" max="60"></label>
          <label><input id="mp3-designer-art-visible" type="checkbox"> Show artwork</label>
          <h2>Preview Mode</h2>
          <div class="mp3-designer-button-row">
            <button type="button" class="btn btn-secondary" id="mp3-designer-preview-desktop">Desktop</button>
            <button type="button" class="btn btn-secondary" id="mp3-designer-preview-mobile">Mobile</button>
          </div>
        </aside>
        <main class="mp3-designer-preview" id="mp3-designer-preview-wrap">
          <div id="mp3-designer-preview"></div>
        </main>
      </div>
    </section>
  `;
}

export async function initMp3PlayerDesignerPage() {
  const status = document.getElementById('mp3-designer-status');
  const workspace = document.getElementById('mp3-designer');
  const preview = document.getElementById('mp3-designer-preview');
  const templateSelect = document.getElementById('mp3-designer-template');

  designerState = { draft: clone(DEFAULT_CONFIG), published: null, history: [], historyIndex: -1, previewMode: 'desktop' };
  pushHistory(designerState.draft);

  try {
    const data = await profileMp3Api.getPlayerDesign();
    if (data && data.design) {
      if (data.design.draft) designerState.draft = normalizeConfig(data.design.draft);
      else if (data.design.published) designerState.draft = normalizeConfig(data.design.published);
      else designerState.draft = normalizeConfig(data.design);
      designerState.published = data.design.published ? normalizeConfig(data.design.published) : null;
      if (data.design.template) designerState.draft.template = data.design.template;
      pushHistory(designerState.draft);
    }
  } catch (error) {
    if (status) status.textContent = error.message || 'Could not load saved design.';
  }

  document.getElementById('mp3-designer-back')?.addEventListener('click', () => { window.location.hash = '/creator-studio'; });
  document.getElementById('mp3-designer-undo')?.addEventListener('click', undo);
  document.getElementById('mp3-designer-redo')?.addEventListener('click', redo);

  templateSelect?.addEventListener('change', () => {
    const template = TEMPLATES.find((item) => item.id === templateSelect.value);
    if (!template) return;
    setConfig({ ...designerState.draft, ...clone(template.config), template: template.id }, true);
  });

  async function uploadImage(input, target) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (status) status.textContent = 'Uploading image…';
    try {
      const data = await profileMp3Api.uploadPlayerImage(file);
      const next = clone(designerState.draft);
      if (target === 'background') next.backgroundImage = data.image_url;
      if (target === 'artwork') next.artwork = { ...(next.artwork || {}), url: data.image_url };
      setConfig(next, true);
      if (status) status.textContent = 'Image uploaded.';
    } catch (error) {
      if (status) status.textContent = error.message || 'Image upload failed.';
    } finally {
      input.value = '';
    }
  }

  document.getElementById('mp3-designer-bg-file')?.addEventListener('change', (event) => uploadImage(event.target, 'background'));
  document.getElementById('mp3-designer-art-file')?.addEventListener('change', (event) => uploadImage(event.target, 'artwork'));

  document.getElementById('mp3-designer-bg-remove')?.addEventListener('click', () => {
    const next = clone(designerState.draft);
    next.backgroundImage = '';
    setConfig(next, true);
  });
  document.getElementById('mp3-designer-art-remove')?.addEventListener('click', () => {
    const next = clone(designerState.draft);
    next.artwork = { ...(next.artwork || {}), url: '' };
    setConfig(next, true);
  });

  document.getElementById('mp3-designer-preview-desktop')?.addEventListener('click', () => { designerState.previewMode = 'desktop'; renderDesigner(); });
  document.getElementById('mp3-designer-preview-mobile')?.addEventListener('click', () => { designerState.previewMode = 'mobile'; renderDesigner(); });

  document.getElementById('mp3-designer-save-draft')?.addEventListener('click', async () => {
    if (status) status.textContent = 'Saving draft…';
    try {
      await profileMp3Api.savePlayerDesign(designerState.draft, false);
      if (status) status.textContent = 'Draft saved.';
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not save draft.';
    }
  });
  document.getElementById('mp3-designer-publish')?.addEventListener('click', async () => {
    if (status) status.textContent = 'Publishing…';
    try {
      const data = await profileMp3Api.savePlayerDesign(designerState.draft, true);
      designerState.published = data.design.published ? normalizeConfig(data.design.published) : clone(designerState.draft);
      if (status) status.textContent = 'Published.';
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not publish.';
    }
  });

  bindDesignerInputs();
  renderDesigner();
  if (workspace) workspace.hidden = false;
  if (status && status.textContent === 'Loading designer…') status.textContent = 'Designer ready.';
}

function bindDesignerInputs() {
  const bind = (id, apply) => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = el.type === 'checkbox' ? 'change' : (el.tagName === 'SELECT' ? 'change' : 'input');
    el.addEventListener(eventName, () => {
      const next = clone(designerState.draft);
      apply(next, el);
      setConfig(next, true);
    });
  };

  bind('mp3-designer-bg-fit', (next, el) => { next.backgroundFit = el.value; });
  bind('mp3-designer-bg-position', (next, el) => { next.backgroundPosition = el.value || 'center'; });
  bind('mp3-designer-bg-opacity', (next, el) => { next.backgroundOpacity = Number(el.value); });
  bind('mp3-designer-overlay-opacity', (next, el) => { next.overlayOpacity = Number(el.value); });
  bind('mp3-designer-overlay-color', (next, el) => { next.overlayColor = el.value; });
  bind('mp3-designer-bg-color', (next, el) => { next.backgroundColor = el.value; });
  bind('mp3-designer-width', (next, el) => { next.playerWidth = Number(el.value); });
  bind('mp3-designer-height', (next, el) => { next.playerHeight = Number(el.value); });
  bind('mp3-designer-radius', (next, el) => { next.borderRadius = Number(el.value); });
  bind('mp3-designer-text-color', (next, el) => { next.textColor = el.value; });
  bind('mp3-designer-accent-color', (next, el) => { next.accentColor = el.value; });
  bind('mp3-designer-progress-color', (next, el) => { next.progressColor = el.value; });
  bind('mp3-designer-art-shape', (next, el) => { next.artwork = { ...(next.artwork || {}), shape: el.value }; });
  bind('mp3-designer-art-size', (next, el) => { next.artwork = { ...(next.artwork || {}), size: Number(el.value) }; });
  bind('mp3-designer-art-radius', (next, el) => { next.artwork = { ...(next.artwork || {}), radius: Number(el.value) }; });
  bind('mp3-designer-art-visible', (next, el) => { next.artwork = { ...(next.artwork || {}), visible: el.checked }; });
}

function renderDesigner() {
  if (!designerState) return;
  const config = designerState.draft;
  const templateSelect = document.getElementById('mp3-designer-template');
  if (templateSelect && config.template) templateSelect.value = config.template;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value ?? '';
  };
  set('mp3-designer-bg-fit', config.backgroundFit);
  set('mp3-designer-bg-position', config.backgroundPosition);
  set('mp3-designer-bg-opacity', config.backgroundOpacity);
  set('mp3-designer-overlay-opacity', config.overlayOpacity);
  set('mp3-designer-overlay-color', config.overlayColor);
  set('mp3-designer-bg-color', config.backgroundColor);
  set('mp3-designer-width', config.playerWidth);
  set('mp3-designer-height', config.playerHeight);
  set('mp3-designer-radius', config.borderRadius);
  set('mp3-designer-text-color', config.textColor);
  set('mp3-designer-accent-color', config.accentColor);
  set('mp3-designer-progress-color', config.progressColor);
  set('mp3-designer-art-shape', config.artwork?.shape);
  set('mp3-designer-art-size', config.artwork?.size);
  set('mp3-designer-art-radius', config.artwork?.radius);
  set('mp3-designer-art-visible', config.artwork?.visible);

  const preview = document.getElementById('mp3-designer-preview');
  if (preview) {
    preview.innerHTML = playerPreviewHtml(config);
    preview.className = designerState.previewMode === 'mobile' ? 'mp3-designer-preview mp3-designer-preview-mobile' : 'mp3-designer-preview';
  }
  const undo = document.getElementById('mp3-designer-undo');
  const redo = document.getElementById('mp3-designer-redo');
  if (undo) undo.disabled = designerState.historyIndex <= 0;
  if (redo) redo.disabled = designerState.historyIndex >= designerState.history.length - 1;
}

export function destroyMp3PlayerDesignerPage() {
  designerState = null;
}
