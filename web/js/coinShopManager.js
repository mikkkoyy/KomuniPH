/**
 * KomuniPH Lite - Creator Studio Coin Shop Manager (CREATOR-05)
 *
 * Route: #/creator-studio/coin-shop
 *
 * Dedicated management area for Creator Coin Shop assets. Reuses the
 * existing creator_assets APIs exclusively — no duplicate product system:
 *   GET/POST /api/creator/assets, GET/PATCH /:id, POST /:id/submit,
 *   POST /:id/publish, POST /:id/archive
 * plus the public Coin Shop discovery endpoints for preview/product links
 * and GET /api/creator/assets/sales for real purchase statistics.
 *
 * Lifecycle mirrors the server contract exactly:
 *   draft -> submitted -> published -> archived
 * Published snapshots are immutable; archived assets cannot be republished.
 */

import { apiRequest } from './api.js';

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const ASSET_TYPES = [
  { value: 'profile_design', label: 'Profile Design' },
  { value: 'theme', label: 'Theme' },
  { value: 'background', label: 'Background' },
  { value: 'sticker', label: 'Sticker' },
  { value: 'decoration', label: 'Decoration' },
];

const IMAGE_TYPES = new Set(['background', 'sticker', 'decoration']);

// ─── Page shell ────────────────────────────────────────────────────

export function renderCoinShopManagerPage() {
  return `
    <section class="marketplace-page manager-page">
      <header class="marketplace-header">
        <h1>My Coin Shop</h1>
        <p>Create and manage digital assets that you sell for KomuniPH Coins.</p>
      </header>

      <div class="manage-stats" id="csm-summary">
        <div class="loading">Loading summary...</div>
      </div>

      <div class="manage-actions">
        <button id="csm-new-btn" class="btn btn-primary">+ Create Coin Shop Asset</button>
        <a href="#/coin-shop" class="btn btn-outline">View Coin Shop</a>
        <a href="#/creator-studio" class="btn btn-outline">Back to Studio</a>
      </div>

      <div class="manage-filters" id="csm-filters">
        <select id="csm-status" class="form-input" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="draft">Drafts</option>
          <option value="submitted">Submitted</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div id="csm-form-wrap"></div>
      <h2 class="manage-section-title">My Assets</h2>
      <div id="csm-list" class="manage-listings"></div>
    </section>
  `;
}

export function initCoinShopManagerPage() {
  const newBtn = document.getElementById('csm-new-btn');
  if (newBtn) newBtn.addEventListener('click', () => renderAssetForm(null));
  const statusEl = document.getElementById('csm-status');
  if (statusEl) statusEl.addEventListener('change', () => loadManager());
  loadManager();
}

let managerAssets = [];
let managerSales = {};

async function loadManager() {
  const summaryEl = document.getElementById('csm-summary');
  const listEl = document.getElementById('csm-list');
  try {
    const [assetsRes, salesRes] = await Promise.all([
      apiRequest('/creator/assets'),
      apiRequest('/creator/assets/sales'),
    ]);
    managerAssets = assetsRes.assets || [];
    managerSales = {};
    for (const s of (salesRes.assets || [])) managerSales[s.asset_id] = s;
    const totals = salesRes.totals || { assets: 0, sales: 0, earned_coins: 0 };
    const counts = { draft: 0, submitted: 0, published: 0, archived: 0 };
    for (const a of managerAssets) {
      if (counts[a.status] !== undefined) counts[a.status] += 1;
    }
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="stat-card"><span class="stat-num">${managerAssets.length}</span><span class="stat-label">All Assets</span></div>
        <div class="stat-card"><span class="stat-num">${counts.draft}</span><span class="stat-label">Drafts</span></div>
        <div class="stat-card"><span class="stat-num">${counts.submitted}</span><span class="stat-label">Submitted</span></div>
        <div class="stat-card"><span class="stat-num">${counts.published}</span><span class="stat-label">Published</span></div>
        <div class="stat-card"><span class="stat-num">${counts.archived}</span><span class="stat-label">Archived</span></div>
        <div class="stat-card"><span class="stat-num">${totals.sales}</span><span class="stat-label">Sales</span></div>
        <div class="stat-card"><span class="stat-num">${totals.earned_coins}</span><span class="stat-label">Coins Earned</span></div>`;
    }
    renderManagerList();
  } catch {
    if (summaryEl) summaryEl.innerHTML = '<div class="buy-error">Failed to load Coin Shop manager.</div>';
  }
}

function renderManagerList() {
  const listEl = document.getElementById('csm-list');
  if (!listEl) return;
  const statusFilter = (document.getElementById('csm-status') || {}).value || '';
  const assets = statusFilter ? managerAssets.filter(a => a.status === statusFilter) : managerAssets;
  listEl.innerHTML = assets.length > 0
    ? assets.map(renderManagerCard).join('')
    : '<div class="marketplace-empty"><p>No assets match. Create a Coin Shop asset to get started.</p></div>';
  wireManagerCards();
}

function assetThumb(asset) {
  const url = asset.preview_data && (asset.preview_data.imageUrl || asset.preview_data.thumbnail);
  return url
    ? `<img src="${escapeHtml(url)}" alt="" class="manage-thumb">`
    : `<div class="manage-thumb manage-thumb-empty"><span>🎨</span></div>`;
}

function typeLabel(t) {
  const found = ASSET_TYPES.find(x => x.value === t);
  return found ? found.label : t;
}

function renderManagerCard(asset) {
  const sales = managerSales[asset.id] || { sales: 0, earned_coins: 0 };
  const updated = (asset.updated_at || '').slice(0, 10);
  return `
    <article class="manage-card" data-asset-id="${escapeHtml(asset.id)}">
      ${assetThumb(asset)}
      <div class="manage-card-body">
        <h3>${escapeHtml(asset.name)}</h3>
        <div class="manage-card-meta">
          <span class="coin-category-badge">${escapeHtml(typeLabel(asset.asset_type))}</span>
          <span class="coin-price">${asset.price_coins} Coins</span>
          <span class="status-badge status-${escapeHtml(asset.status)}">${escapeHtml(asset.status)}</span>
        </div>
        <p class="manage-dates">Updated ${escapeHtml(updated)} · v${asset.version} · ${sales.sales} sale${sales.sales === 1 ? '' : 's'} · ${sales.earned_coins} earned</p>
        <div class="manage-card-actions">
          ${asset.status === 'draft' ? `<button class="btn btn-sm btn-outline csm-edit" data-id="${escapeHtml(asset.id)}">Edit</button>` : ''}
          ${asset.status === 'draft' ? `<button class="btn btn-sm btn-secondary csm-preview" data-id="${escapeHtml(asset.id)}">Preview</button>` : ''}
          ${asset.status === 'draft' ? `<button class="btn btn-sm btn-primary csm-submit" data-id="${escapeHtml(asset.id)}">Submit</button>` : ''}
          ${asset.status === 'submitted' ? `<button class="btn btn-sm btn-secondary csm-preview" data-id="${escapeHtml(asset.id)}">Preview</button>` : ''}
          ${asset.status === 'submitted' ? `<button class="btn btn-sm btn-primary csm-publish" data-id="${escapeHtml(asset.id)}">Publish to Coin Shop</button>` : ''}
          ${asset.status === 'published' ? `<a href="#/coin-shop/product/${escapeHtml(asset.id)}" class="btn btn-sm btn-secondary">View in Coin Shop</a>` : ''}
          ${asset.status === 'published' ? `<button class="btn btn-sm btn-outline csm-archive" data-id="${escapeHtml(asset.id)}">Archive</button>` : ''}
          ${asset.status === 'published' ? `<button class="btn btn-sm btn-outline csm-share" data-url="#/coin-shop/product/${escapeHtml(asset.id)}" data-title="${escapeHtml(asset.name)}">Share</button>` : ''}
          ${asset.status === 'archived' ? `<span class="manage-dates">Archived — no further actions available.</span>` : ''}
        </div>
      </div>
    </article>
  `;
}

function wireManagerCards() {
  document.querySelectorAll('.csm-edit').forEach(b => b.addEventListener('click', () => renderAssetForm(b.dataset.id)));
  document.querySelectorAll('.csm-preview').forEach(b => b.addEventListener('click', () => previewAsset(b.dataset.id)));
  document.querySelectorAll('.csm-submit').forEach(b => b.addEventListener('click', async () => {
    try {
      await apiRequest(`/creator/assets/${b.dataset.id}/submit`, { method: 'POST' });
      loadManager();
    } catch (err) { alert(err.message || 'Submit failed'); }
  }));
  document.querySelectorAll('.csm-publish').forEach(b => b.addEventListener('click', () => confirmPublish(b.dataset.id)));
  document.querySelectorAll('.csm-archive').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Archive this asset? It will be hidden from the public Coin Shop.')) return;
    try {
      await apiRequest(`/creator/assets/${b.dataset.id}/archive`, { method: 'POST' });
      loadManager();
    } catch (err) { alert(err.message || 'Archive failed'); }
  }));
  document.querySelectorAll('.csm-share').forEach(btn => {
    btn.addEventListener('click', async () => {
      const shareUrl = `${window.location.origin}${btn.dataset.url}`;
      const original = btn.textContent;
      try {
        if (navigator.share) { await navigator.share({ title: btn.dataset.title, url: shareUrl }); return; }
        await navigator.clipboard.writeText(shareUrl);
        btn.textContent = 'Copied! ✓';
        setTimeout(() => { btn.textContent = original; }, 2000);
      } catch { /* user cancelled or clipboard unavailable */ }
    });
  });
}

// ─── Create / edit form ────────────────────────────────────────────

async function renderAssetForm(assetId) {
  const wrap = document.getElementById('csm-form-wrap');
  if (!wrap) return;
  let asset = null;
  if (assetId) {
    asset = managerAssets.find(a => a.id === assetId) || null;
    if (!asset) { wrap.innerHTML = '<div class="buy-error">Asset not found.</div>'; return; }
    if (asset.status !== 'draft') { wrap.innerHTML = '<div class="buy-info">Only draft assets can be edited — published snapshots are immutable.</div>'; return; }
  }
  const type = asset ? asset.asset_type : 'profile_design';
  wrap.innerHTML = `
    <form id="csm-form" class="card listing-create-form">
      <h2>${asset ? 'Edit Draft Asset' : 'Create Coin Shop Asset'}</h2>
      <div class="form-group">
        <label class="form-label" for="csm-type">Asset type</label>
        <select class="form-input" id="csm-type" ${asset ? 'disabled' : ''}>
          ${ASSET_TYPES.map(t => `<option value="${t.value}" ${type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="csm-design-field" ${type === 'profile_design' && !asset ? '' : 'hidden'}>
        <label class="form-label" for="csm-design">Source profile design (snapshot)</label>
        <select class="form-input" id="csm-design"><option value="">Loading designs...</option></select>
        <small class="studio-modal-hint">The published asset keeps its own immutable snapshot — later design edits never change it.</small>
      </div>
      <div id="csm-theme-fields" class="studio-field-group" ${type === 'theme' && !asset ? '' : 'hidden'}>
        <div class="form-group"><label class="form-label" for="csm-bg">Background color</label>
          <input class="form-input" id="csm-bg" value="#0f172a" maxlength="7"></div>
        <div class="form-group"><label class="form-label" for="csm-text">Text color</label>
          <input class="form-input" id="csm-text" value="#e6eaf2" maxlength="7"></div>
        <div class="form-group"><label class="form-label" for="csm-accent">Accent color</label>
          <input class="form-input" id="csm-accent" value="#14b8a6" maxlength="7"></div>
      </div>
      <div id="csm-image-fields" class="studio-field-group" ${IMAGE_TYPES.has(type) && !asset ? '' : 'hidden'}>
        <div class="form-group"><label class="form-label" for="csm-image-url">Image URL</label>
          <input class="form-input" id="csm-image-url" placeholder="https://example.com/image.png" value="${escapeHtml(asset && asset.preview_data && asset.preview_data.imageUrl ? asset.preview_data.imageUrl : '')}"></div>
        <div class="form-group"><label class="form-label" for="csm-fit">Fit</label>
          <select class="form-input" id="csm-fit">
            ${['cover', 'contain', 'fill'].map(f => `<option value="${f}">${f}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="csm-name">Title</label>
        <input class="form-input" id="csm-name" maxlength="100" required value="${escapeHtml(asset ? asset.name : '')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="csm-desc">Description</label>
        <textarea class="form-textarea form-input" id="csm-desc" maxlength="2000">${escapeHtml(asset ? asset.description : '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="csm-price">Coin price (positive integer)</label>
        <input class="form-input" id="csm-price" type="number" min="1" step="1" value="${asset ? asset.price_coins : 100}" required>
      </div>
      <div id="csm-status"></div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${asset ? 'Save Draft' : 'Save Draft Asset'}</button>
        <button type="button" id="csm-cancel" class="btn btn-outline">Cancel</button>
      </div>
    </form>`;
  document.getElementById('csm-cancel').addEventListener('click', () => { wrap.innerHTML = ''; });
  if (!asset) {
    document.getElementById('csm-type').addEventListener('change', (e) => {
      const t = e.target.value;
      document.getElementById('csm-design-field').hidden = t !== 'profile_design';
      const themeF = document.getElementById('csm-theme-fields');
      if (themeF) themeF.hidden = t !== 'theme';
      document.getElementById('csm-image-fields').hidden = !IMAGE_TYPES.has(t);
      if (t === 'profile_design') loadDesignOptions();
    });
    loadDesignOptions();
  }
  document.getElementById('csm-form').addEventListener('submit', (e) => submitAssetForm(e, asset));
}

async function loadDesignOptions() {
  const sel = document.getElementById('csm-design');
  if (!sel) return;
  try {
    const data = await apiRequest('/profile/design');
    const designs = (data.designs || []).filter(d => d.layout);
    sel.innerHTML = designs.length > 0
      ? designs.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} (${escapeHtml(d.status)})</option>`).join('')
      : '<option value="">No designs found — create one in Creator Studio first</option>';
  } catch {
    sel.innerHTML = '<option value="">Could not load designs</option>';
  }
}

function setCsmStatus(msg, isError) {
  const el = document.getElementById('csm-status');
  if (el) el.innerHTML = `<div class="${isError ? 'buy-error' : 'buy-info'}">${escapeHtml(msg)}</div>`;
}

async function buildAssetData(type) {
  if (type === 'profile_design') {
    const designId = document.getElementById('csm-design').value;
    if (!designId) throw new Error('Select a source profile design.');
    const design = await apiRequest(`/profile/design/${designId}`);
    if (!design || !design.design || !design.design.layout) throw new Error('Selected design has no usable snapshot.');
    return { asset_data: { layout: design.design.layout, theme: design.design.theme ?? null }, source_design_id: designId };
  }
  if (type === 'theme') {
    const bg = document.getElementById('csm-bg').value.trim();
    const text = document.getElementById('csm-text').value.trim();
    const accent = document.getElementById('csm-accent').value.trim();
    return { asset_data: { theme: { backgroundColor: bg, textColor: text, accentColor: accent } } };
  }
  const imageUrl = document.getElementById('csm-image-url').value.trim();
  const fit = document.getElementById('csm-fit').value;
  if (!imageUrl) throw new Error('Image URL is required for this asset type.');
  return { asset_data: { imageUrl, fit } };
}

async function submitAssetForm(e, asset) {
  e.preventDefault();
  const name = document.getElementById('csm-name').value.trim();
  const description = document.getElementById('csm-desc').value.trim();
  const price_coins = Number(document.getElementById('csm-price').value);
  if (!name) { setCsmStatus('Title is required.', true); return; }
  if (!Number.isInteger(price_coins) || price_coins < 1) {
    setCsmStatus('Coin price must be a positive integer (1 or more).', true);
    return;
  }
  try {
    if (asset) {
      const body = { name, description, price_coins };
      if (IMAGE_TYPES.has(asset.asset_type)) {
        const imageUrl = document.getElementById('csm-image-url').value.trim();
        const fit = document.getElementById('csm-fit').value;
        body.asset_data = { imageUrl, fit };
      }
      await apiRequest(`/creator/assets/${asset.id}`, { method: 'PATCH', body });
      setCsmStatus('Draft saved.', false);
    } else {
      const type = document.getElementById('csm-type').value;
      const { asset_data, source_design_id } = await buildAssetData(type);
      const body = { name, description, asset_type: type, asset_data, price_coins };
      if (source_design_id) body.source_design_id = source_design_id;
      await apiRequest('/creator/assets', { method: 'POST', body });
      setCsmStatus('Draft asset created.', false);
    }
    document.getElementById('csm-form-wrap').innerHTML = '';
    loadManager();
  } catch (err) {
    setCsmStatus(err.message || 'Save failed.', true);
  }
}

// ─── Preview (Buy never executes) ──────────────────────────────────

async function previewAsset(id) {
  const asset = managerAssets.find(a => a.id === id);
  if (!asset) return;
  closeCsmPreview();
  const url = asset.preview_data && (asset.preview_data.imageUrl || asset.preview_data.thumbnail);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'csm-preview-overlay';
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Asset preview">
      <button type="button" class="modal-close" aria-label="Close">×</button>
      <p class="preview-banner">PUBLIC PRODUCT PREVIEW — Buy is disabled in preview</p>
      ${url ? `<img src="${escapeHtml(url)}" alt="" class="product-detail-image">` : `<div class="product-detail-no-image"><span>🎨</span></div>`}
      <h2>${escapeHtml(asset.name)}</h2>
      <div class="product-detail-meta">
        <span class="product-category">${escapeHtml(typeLabel(asset.asset_type))}</span>
        <span class="coin-price-large">${asset.price_coins} Coins</span>
        <span class="status-badge status-${escapeHtml(asset.status)}">${escapeHtml(asset.status)}</span>
      </div>
      <div class="product-detail-description">${escapeHtml(asset.description || 'No description provided.')}</div>
      <div class="product-detail-actions">
        <button class="btn btn-primary" disabled title="Preview only">Buy — ${asset.price_coins} Coins</button>
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('modal-close')) closeCsmPreview();
  });
  document.addEventListener('keydown', closeCsmPreviewOnEscape);
  document.body.appendChild(overlay);
}

function closeCsmPreview() {
  const overlay = document.getElementById('csm-preview-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', closeCsmPreviewOnEscape);
}

function closeCsmPreviewOnEscape(e) {
  if (e.key === 'Escape') closeCsmPreview();
}

// ─── Publish confirmation ──────────────────────────────────────────

function confirmPublish(id) {
  const asset = managerAssets.find(a => a.id === id);
  if (!asset) return;
  closeCsmPreview();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'csm-preview-overlay';
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Confirm publish">
      <button type="button" class="modal-close" aria-label="Close">×</button>
      <h2>Publish to Coin Shop</h2>
      <div class="publish-confirm">
        <p><strong>${escapeHtml(asset.name)}</strong></p>
        <p>Type: ${escapeHtml(typeLabel(asset.asset_type))} · Price: <strong>${asset.price_coins} Coins</strong></p>
        <p>Publishing makes this asset <strong>publicly discoverable</strong> in the Coin Shop, and buyers will be able to <strong>purchase it with KomuniPH Coins</strong>.</p>
      </div>
      <div id="csm-pub-status"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline modal-close-btn">Cancel</button>
        <button type="button" class="btn btn-primary" id="csm-confirm-publish">Publish to Coin Shop</button>
      </div>
    </div>`;
  const close = () => { overlay.remove(); };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('modal-close') || e.target.classList.contains('modal-close-btn')) close();
  });
  overlay.querySelector('#csm-confirm-publish').addEventListener('click', async () => {
    try {
      await apiRequest(`/creator/assets/${id}/publish`, { method: 'POST' });
      overlay.remove();
      const done = document.createElement('div');
      done.className = 'modal-overlay';
      done.id = 'csm-preview-overlay';
      done.innerHTML = `
        <div class="modal-box" role="dialog" aria-modal="true" aria-label="Published">
          <div class="buy-success">Published to Coin Shop ✓</div>
          <div class="form-actions" style="margin-top:1rem">
            <a href="#/coin-shop/product/${escapeHtml(id)}" class="btn btn-primary" id="csm-view-published">View in Coin Shop</a>
            <button type="button" class="btn btn-outline" id="csm-continue">Continue Managing Assets</button>
          </div>
        </div>`;
      done.querySelector('#csm-continue').addEventListener('click', () => { done.remove(); loadManager(); });
      done.querySelector('#csm-view-published').addEventListener('click', () => { done.remove(); });
      document.body.appendChild(done);
      loadManager();
    } catch (err) {
      const box = overlay.querySelector('#csm-pub-status');
      if (box) box.innerHTML = `<div class="buy-error">${escapeHtml(err.message || 'Publish failed.')}</div>`;
    }
  });
  document.body.appendChild(overlay);
}
