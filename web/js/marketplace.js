/**
 * KomuniPH Lite - Marketplace & Coin Shop Frontend
 * Product cards, detail pages, Coin Shop Buy, Share Link
 */

import { apiRequest } from './api.js';

// ─── Escape HTML (local, no circular dep) ────────────────────

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Marketplace Listing Card ────────────────────────────────

export function renderMarketplaceListingCard(listing) {
  const images = listing.images && listing.images.length > 0
    ? `<img src="${escapeHtml(listing.images[0])}" alt="${escapeHtml(listing.title)}" class="listing-card-image">`
    : `<div class="listing-card-no-image"><span>📦</span></div>`;
  const sellerProfile = listing.seller_username ? listing.seller_username : listing.seller_user_id;
  const sellerLabel = listing.seller_display_name || listing.seller_username || 'Seller';

  return `
    <article class="listing-card" data-listing-id="${escapeHtml(listing.id)}">
      <div class="listing-card-media">
        ${images}
        <span class="listing-category-badge">${escapeHtml(listing.category)}</span>
      </div>
      <div class="listing-card-body">
        <h3 class="listing-card-title">${escapeHtml(listing.title)}</h3>
        <p class="listing-card-desc">${escapeHtml((listing.description || '').slice(0, 100))}</p>
        <div class="listing-card-meta">
          <span class="listing-price">${escapeHtml(listing.price_display)}</span>
          <span class="listing-seller">by ${escapeHtml(sellerLabel)}</span>
        </div>
        <div class="listing-card-actions">
          <a href="#/marketplace/product/${escapeHtml(listing.id)}" class="btn btn-secondary">View Product</a>
          <a href="#/messages?to=${escapeHtml(sellerProfile)}&listing=${escapeHtml(listing.id)}" class="btn btn-primary">Message Seller</a>
          <a href="#/profile/${escapeHtml(sellerProfile)}" class="btn btn-outline">Visit Profile</a>
          <button class="btn btn-outline share-btn" data-url="#/marketplace/product/${escapeHtml(listing.id)}" data-title="${escapeHtml(listing.title)}">Share</button>
        </div>
      </div>
    </article>
  `;
}

// ─── Coin Shop Product Card ──────────────────────────────────

export function renderCoinShopProductCard(asset) {
  const preview = asset.preview_data && asset.preview_data.imageUrl
    ? `<img src="${escapeHtml(asset.preview_data.imageUrl)}" alt="${escapeHtml(asset.name)}" class="coin-card-image">`
    : asset.preview_data && asset.preview_data.thumbnail
      ? `<img src="${escapeHtml(asset.preview_data.thumbnail)}" alt="${escapeHtml(asset.name)}" class="coin-card-image">`
      : `<div class="coin-card-no-image"><span>🎨</span></div>`;
  const creatorProfile = asset.creator_username ? asset.creator_username : asset.creator_user_id;
  const creatorLabel = asset.creator_display_name || asset.creator_username || 'Creator';

  return `
    <article class="coin-card" data-asset-id="${escapeHtml(asset.id)}">
      <div class="coin-card-media">
        ${preview}
        <span class="coin-category-badge">${escapeHtml(asset.asset_type)}</span>
      </div>
      <div class="coin-card-body">
        <h3 class="coin-card-title">${escapeHtml(asset.name)}</h3>
        <p class="coin-card-desc">${escapeHtml((asset.description || '').slice(0, 100))}</p>
        <div class="coin-card-meta">
          <span class="coin-price">${asset.price_coins} coins</span>
          <span class="coin-creator">by ${escapeHtml(creatorLabel)}</span>
        </div>
        <div class="coin-card-actions">
          <a href="#/coin-shop/product/${escapeHtml(asset.id)}" class="btn btn-primary">Buy</a>
          <a href="#/messages?to=${escapeHtml(creatorProfile)}&asset=${escapeHtml(asset.id)}" class="btn btn-outline">Message Creator</a>
          <a href="#/profile/${escapeHtml(creatorProfile)}" class="btn btn-outline">Visit Profile</a>
          <button class="btn btn-outline share-btn" data-url="#/coin-shop/product/${escapeHtml(asset.id)}" data-title="${escapeHtml(asset.name)}">Share</button>
        </div>
      </div>
    </article>
  `;
}

// ─── Product Detail Page ─────────────────────────────────────

export function renderMarketplaceProductDetail(listing) {
  const images = listing.images && listing.images.length > 0
    ? listing.images.map(img => `<img src="${escapeHtml(img)}" alt="${escapeHtml(listing.title)}" class="product-detail-image">`).join('')
    : `<div class="product-detail-no-image"><span>📦</span></div>`;
  const sellerProfile = listing.seller_username ? listing.seller_username : listing.seller_user_id;
  const sellerLabel = listing.seller_display_name || listing.seller_username || 'Seller';

  return `
    <section class="product-detail-page">
      <div class="product-detail-gallery">
        ${images}
      </div>
      <div class="product-detail-info">
        <h1>${escapeHtml(listing.title)}</h1>
        <div class="product-detail-meta">
          <span class="product-category">${escapeHtml(listing.category)}</span>
          <span class="product-price">${escapeHtml(listing.price_display)}</span>
        </div>
        <div class="product-detail-description">
          ${escapeHtml(listing.description || 'No description provided.')}
        </div>
        <div class="product-detail-seller">
          <p>Sold by ${escapeHtml(sellerLabel)}: <a href="#/profile/${escapeHtml(sellerProfile)}" class="btn btn-outline">View Seller Profile</a></p>
        </div>
        <div class="product-detail-actions">
          <a href="#/messages?to=${escapeHtml(sellerProfile)}&listing=${escapeHtml(listing.id)}" class="btn btn-primary">Message Seller</a>
          <button class="btn btn-outline share-btn" data-url="#/marketplace/product/${escapeHtml(listing.id)}" data-title="${escapeHtml(listing.title)}">Share Link</button>
        </div>
      </div>
    </section>
  `;
}

export function renderCoinShopProductDetailPage(product) {
  const preview = product.preview_data && product.preview_data.imageUrl
    ? `<img src="${escapeHtml(product.preview_data.imageUrl)}" alt="${escapeHtml(product.name)}" class="product-detail-image">`
    : product.preview_data && product.preview_data.thumbnail
      ? `<img src="${escapeHtml(product.preview_data.thumbnail)}" alt="${escapeHtml(product.name)}" class="product-detail-image">`
      : `<div class="product-detail-no-image"><span>🎨</span></div>`;
  const creatorProfile = product.creator_username ? product.creator_username : product.creator_user_id;
  const creatorLabel = product.creator_display_name || product.creator_username || 'Creator';

  return `
    <section class="product-detail-page coin-shop-product">
      <div class="product-detail-gallery">
        ${preview}
      </div>
      <div class="product-detail-info">
        <h1>${escapeHtml(product.name)}</h1>
        <div class="product-detail-meta">
          <span class="product-category">${escapeHtml(product.asset_type)}</span>
          <span class="coin-price-large">${product.price_coins} coins</span>
        </div>
        <div class="product-detail-description">
          ${escapeHtml(product.description || 'No description provided.')}
        </div>
        <div class="product-detail-seller">
          <p>Created by ${escapeHtml(creatorLabel)}: <a href="#/profile/${escapeHtml(creatorProfile)}" class="btn btn-outline">View Creator Profile</a></p>
        </div>
        <div class="product-detail-actions">
          <button class="btn btn-primary buy-btn" data-asset-id="${escapeHtml(product.id)}" data-price="${product.price_coins}" data-name="${escapeHtml(product.name)}">Buy — ${product.price_coins} coins</button>
          <a href="#/messages?to=${escapeHtml(creatorProfile)}&asset=${escapeHtml(product.id)}" class="btn btn-outline">Message Creator</a>
          <button class="btn btn-outline share-btn" data-url="#/coin-shop/product/${escapeHtml(product.id)}" data-title="${escapeHtml(product.name)}">Share Link</button>
        </div>
        <div class="buy-status" id="buy-status"></div>
      </div>
    </section>
  `;
}

function renderNotFound() {
  return `
    <section class="not-found-page">
      <h1>Product Not Found</h1>
      <p>The product you're looking for doesn't exist or is not publicly available.</p>
      <a href="#/marketplace" class="btn btn-primary">Browse Marketplace</a>
    </section>
  `;
}

// ─── Marketplace Page ────────────────────────────────────────

export function renderMarketplacePage() {
  const url = new URL(window.location.hash.slice(1) || '/', window.location.origin);
  const searchParam = url.searchParams.get('search') || '';
  const categoryParam = url.searchParams.get('category') || '';

  const categories = ['all', 'products', 'services', 'digital', 'local'];

  return `
    <section class="marketplace-page">
      <header class="marketplace-header">
        <h1>Marketplace</h1>
        <p>Discover products and services from the KomuniPH community</p>
      </header>

      <div class="marketplace-toolbar">
        <form id="marketplace-search-form" class="marketplace-search">
          <label for="marketplace-search-input" class="sr-only">Search listings</label>
          <input type="text" id="marketplace-search-input" placeholder="Search products..." class="marketplace-search-input" value="${escapeHtml(searchParam)}" ${!searchParam ? 'autofocus' : ''}>
          <button type="submit" class="marketplace-search-button">Search</button>
        </form>

        <div class="marketplace-categories">
          ${categories.map(cat => `
            <a href="#/marketplace?category=${cat}&page=1" class="btn btn-sm ${categoryParam === cat ? 'btn-primary' : 'btn-outline'}">${cat === 'all' ? 'All' : escapeHtml(cat)}</a>
          `).join('')}
        </div>

        <div class="marketplace-user-controls">
          <a href="#/marketplace/manage" class="btn btn-primary">Create Listing</a>
          <a href="#/marketplace/manage" class="btn btn-outline">My Listings</a>
          <a href="#/coin-shop" class="btn btn-outline">Coin Shop</a>
        </div>
      </div>

      <div class="marketplace-catalog">
        <div class="loading">Loading products...</div>
      </div>

      <div class="marketplace-pagination"></div>
    </section>
  `;
}

export function initMarketplacePage() {
  const searchForm = document.getElementById('marketplace-search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('marketplace-search-input');
      const term = input ? input.value.trim() : '';
      window.navigate(`/marketplace?search=${encodeURIComponent(term)}&page=1`);
    });
  }
  loadListings();
  initShareButtons();
}

async function loadListings() {
  const url = new URL(window.location.hash.slice(1) || '/', window.location.origin);
  const searchParam = url.searchParams.get('search') || '';
  const categoryParam = url.searchParams.get('category') || '';
  const page = url.searchParams.get('page') || '1';
  try {
    let path = `/api/marketplace/listings?page=${page}&limit=20`;
    if (searchParam) path += `&search=${encodeURIComponent(searchParam)}`;
    if (categoryParam && categoryParam !== 'all') path += `&category=${encodeURIComponent(categoryParam)}`;
    const data = await apiRequest(path);
    const catalog = document.querySelector('.marketplace-catalog');
    if (catalog) {
      const listings = data.listings || [];
      catalog.innerHTML = listings.length > 0
        ? listings.map(listing => renderMarketplaceListingCard(listing)).join('')
        : '<div class="marketplace-empty"><p>No listings found.</p></div>';
      initShareButtons();
    }
    const pagination = document.querySelector('.marketplace-pagination');
    if (pagination) {
      const total = data.total || 0;
      const hasMore = data.hasMore || false;
      const currentPage = data.page || 1;
      const totalPages = data.pages || 1;
      pagination.innerHTML = (total > 0 && (currentPage > 1 || hasMore))
        ? `${currentPage > 1 ? '<button id="marketplace-prev-page" class="btn btn-secondary">Prev</button>' : ''}<span class="page-info">Page ${currentPage} of ${totalPages}</span>${hasMore ? '<button id="marketplace-next-page" class="btn btn-secondary">Next</button>' : ''}`
        : '';
      const prevBtn = document.getElementById('marketplace-prev-page');
      const nextBtn = document.getElementById('marketplace-next-page');
      if (prevBtn) prevBtn.addEventListener('click', () => window.navigate(`/marketplace?page=${currentPage - 1}&limit=20${searchParam ? '&search=' + encodeURIComponent(searchParam) : ''}${categoryParam ? '&category=' + encodeURIComponent(categoryParam) : ''}`));
      if (nextBtn) nextBtn.addEventListener('click', () => window.navigate(`/marketplace?page=${currentPage + 1}&limit=20${searchParam ? '&search=' + encodeURIComponent(searchParam) : ''}${categoryParam ? '&category=' + encodeURIComponent(categoryParam) : ''}`));
    }
  } catch {
    const catalog = document.querySelector('.marketplace-catalog');
    if (catalog) catalog.innerHTML = '<div class="marketplace-empty"><p>Failed to load listings.</p></div>';
  }
}

// ─── Coin Shop Page ──────────────────────────────────────────

export function renderCoinShopPage() {
  const url = new URL(window.location.hash.slice(1) || '/', window.location.origin);
  const searchParam = url.searchParams.get('search') || '';
  const categoryParam = url.searchParams.get('category') || '';

  const categories = ['all', 'theme', 'background', 'profile_design', 'sticker', 'decoration'];

  return `
    <section class="coin-shop-page">
      <header class="coin-shop-header">
        <h1>Creator Coin Shop</h1>
        <p>Buy creator assets with KomuniPH Coins</p>
      </header>

      <div class="coin-shop-toolbar">
        <form id="coin-shop-search-form" class="coin-shop-search">
          <label for="coin-shop-search-input" class="sr-only">Search assets</label>
          <input type="text" id="coin-shop-search-input" placeholder="Search assets..." class="marketplace-search-input" value="${escapeHtml(searchParam)}">
          <button type="submit" class="marketplace-search-button">Search</button>
        </form>
        <div class="coin-shop-categories">
          ${categories.map(cat => `
            <a href="#/coin-shop?category=${cat}&page=1" class="btn btn-sm ${categoryParam === cat ? 'btn-primary' : 'btn-outline'}">${cat === 'all' ? 'All' : escapeHtml(cat)}</a>
          `).join('')}
        </div>
        <div class="marketplace-user-controls">
          <a href="#/marketplace" class="btn btn-outline">Marketplace</a>
          <a href="#/coin-shop/library" class="btn btn-secondary">My Library</a>
        </div>
      </div>

      <div class="coin-shop-catalog">
        <div class="loading">Loading assets...</div>
      </div>

      <div class="marketplace-pagination"></div>
    </section>
  `;
}

export function initCoinShopPage() {
  const searchForm = document.getElementById('coin-shop-search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('coin-shop-search-input');
      const term = input ? input.value.trim() : '';
      window.navigate(`/coin-shop?search=${encodeURIComponent(term)}&page=1`);
    });
  }
  loadAssets();
}

async function loadAssets() {
  const url = new URL(window.location.hash.slice(1) || '/', window.location.origin);
  const searchParam = url.searchParams.get('search') || '';
  const categoryParam = url.searchParams.get('category') || '';
  const page = url.searchParams.get('page') || '1';
  try {
    let path = `/api/marketplace/assets?page=${page}&limit=20`;
    if (searchParam) path += `&search=${encodeURIComponent(searchParam)}`;
    if (categoryParam && categoryParam !== 'all') path += `&category=${encodeURIComponent(categoryParam)}`;
    const data = await apiRequest(path);
    const catalog = document.querySelector('.coin-shop-catalog');
    if (catalog) {
      const assets = data.assets || [];
      catalog.innerHTML = assets.length > 0
        ? assets.map(asset => renderCoinShopProductCard(asset)).join('')
        : '<div class="marketplace-empty"><p>No assets found.</p></div>';
      initShareButtons();
    }
    const pagination = document.querySelector('.marketplace-pagination');
    if (pagination) {
      const total = data.total || 0;
      const hasMore = data.hasMore || false;
      const currentPage = data.page || 1;
      const totalPages = data.pages || 1;
      pagination.innerHTML = (total > 0 && (currentPage > 1 || hasMore))
        ? `${currentPage > 1 ? '<button id="coin-shop-prev-page" class="btn btn-secondary">Prev</button>' : ''}<span class="page-info">Page ${currentPage} of ${totalPages}</span>${hasMore ? '<button id="coin-shop-next-page" class="btn btn-secondary">Next</button>' : ''}`
        : '';
      const prevBtn = document.getElementById('coin-shop-prev-page');
      const nextBtn = document.getElementById('coin-shop-next-page');
      if (prevBtn) prevBtn.addEventListener('click', () => window.navigate(`/coin-shop?page=${currentPage - 1}&limit=20${searchParam ? '&search=' + encodeURIComponent(searchParam) : ''}${categoryParam ? '&category=' + encodeURIComponent(categoryParam) : ''}`));
      if (nextBtn) nextBtn.addEventListener('click', () => window.navigate(`/coin-shop?page=${currentPage + 1}&limit=20${searchParam ? '&search=' + encodeURIComponent(searchParam) : ''}${categoryParam ? '&category=' + encodeURIComponent(categoryParam) : ''}`));
    }
  } catch {
    const catalog = document.querySelector('.coin-shop-catalog');
    if (catalog) catalog.innerHTML = '<div class="marketplace-empty"><p>Failed to load assets.</p></div>';
  }
}

// ─── Buy Handler ─────────────────────────────────────────────

async function handleBuy(e) {
  const btn = e.target;
  const assetId = btn.dataset.assetId;
  const name = btn.dataset.name;
  const price = parseInt(btn.dataset.price);
  const statusEl = document.getElementById('buy-status');

  if (!confirm(`Buy "${name}" for ${price} coins?`)) return;

  try {
    const data = await apiRequest(`/coin-shop/buy/${assetId}`, { method: 'POST' });
    if (statusEl) {
      statusEl.innerHTML = `<div class="buy-success">✅ Successfully purchased ${name} for ${price} coins!</div>`;
    }
    btn.disabled = true;
    btn.textContent = 'Purchased ✓';
  } catch (err) {
    if (statusEl) {
      if (err.status === 402) {
        statusEl.innerHTML = `<div class="buy-error">❌ Insufficient coins. You need ${price} coins.</div>`;
      } else if (err.status === 409) {
        statusEl.innerHTML = `<div class="buy-info">ℹ️ You already own this asset.</div>`;
      } else {
        statusEl.innerHTML = `<div class="buy-error">❌ Purchase failed: ${err.message || 'Unknown error'}</div>`;
      }
    }
  }
}

// ─── Seller Management Dashboard ─────────────────────────────
// Route: #/marketplace/manage

export function renderManagePage() {
  return `
    <section class="marketplace-page manage-page">
      <header class="marketplace-header">
        <h1>Seller Dashboard</h1>
        <p>Manage your Marketplace listings</p>
      </header>

      <div class="manage-stats" id="manage-stats">
        <div class="loading">Loading dashboard...</div>
      </div>

      <div class="manage-actions">
        <button id="manage-new-btn" class="btn btn-primary">+ Create Listing</button>
        <a href="#/marketplace" class="btn btn-outline">View Marketplace</a>
      </div>

      <div id="listing-form-wrap"></div>
      <div id="manage-listings" class="manage-listings"></div>
    </section>
  `;
}

export function initManagePage() {
  const newBtn = document.getElementById('manage-new-btn');
  if (newBtn) newBtn.addEventListener('click', () => renderListingForm(null));
  loadManageDashboard();
}

async function loadManageDashboard() {
  const statsEl = document.getElementById('manage-stats');
  const listEl = document.getElementById('manage-listings');
  try {
    const data = await apiRequest('/marketplace/my-listings');
    const counts = data.counts || { total: 0, draft: 0, published: 0, archived: 0 };
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-card"><span class="stat-num">${counts.total}</span><span class="stat-label">Total</span></div>
        <div class="stat-card"><span class="stat-num">${counts.draft}</span><span class="stat-label">Drafts</span></div>
        <div class="stat-card"><span class="stat-num">${counts.published}</span><span class="stat-label">Published</span></div>
        <div class="stat-card"><span class="stat-num">${counts.archived}</span><span class="stat-label">Archived</span></div>`;
    }
    if (listEl) {
      const listings = data.listings || [];
      listEl.innerHTML = listings.length > 0
        ? listings.map(renderManageCard).join('')
        : '<div class="marketplace-empty"><p>No listings yet. Create your first listing to get started.</p></div>';
      wireManageCards();
      initShareButtons();
    }
  } catch {
    if (statsEl) statsEl.innerHTML = '<div class="buy-error">Failed to load dashboard.</div>';
  }
}

function renderManageCard(listing) {
  const thumb = listing.images && listing.images.length > 0
    ? `<img src="${escapeHtml(listing.images[0])}" alt="" class="manage-thumb">`
    : `<div class="manage-thumb manage-thumb-empty"><span>📦</span></div>`;
  const created = (listing.created_at || '').slice(0, 10);
  const updated = (listing.updated_at || '').slice(0, 10);
  const external = listing.external_url
    ? `<a href="${escapeHtml(listing.external_url)}" target="_blank" rel="noopener noreferrer nofollow" class="external-link">↗ External sales page</a>`
    : '';
  return `
    <article class="manage-card" data-listing-id="${escapeHtml(listing.id)}">
      ${thumb}
      <div class="manage-card-body">
        <h3>${escapeHtml(listing.title)}</h3>
        <div class="manage-card-meta">
          <span class="listing-category-badge">${escapeHtml(listing.category)}</span>
          <span class="listing-price">${escapeHtml(listing.price_display)}</span>
          <span class="status-badge status-${escapeHtml(listing.status)}">${escapeHtml(listing.status)}</span>
        </div>
        <p class="manage-dates">Created ${escapeHtml(created)} · Updated ${escapeHtml(updated)}</p>
        ${external}
        <div class="manage-card-actions">
          ${listing.status === 'published' ? `<a href="#/marketplace/product/${escapeHtml(listing.id)}" class="btn btn-sm btn-secondary">View</a>` : ''}
          ${listing.status === 'draft' ? `<button class="btn btn-sm btn-outline manage-edit" data-id="${escapeHtml(listing.id)}">Edit</button>` : ''}
          ${(listing.status === 'draft' || listing.status === 'archived') ? `<button class="btn btn-sm btn-primary manage-publish" data-id="${escapeHtml(listing.id)}">Publish</button>` : ''}
          ${listing.status !== 'archived' ? `<button class="btn btn-sm btn-outline manage-archive" data-id="${escapeHtml(listing.id)}">Archive</button>` : ''}
          ${listing.status === 'published' ? `<button class="btn btn-sm btn-outline share-btn" data-url="#/marketplace/product/${escapeHtml(listing.id)}" data-title="${escapeHtml(listing.title)}">Share</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function wireManageCards() {
  document.querySelectorAll('.manage-edit').forEach(btn => {
    btn.addEventListener('click', () => renderListingForm(btn.dataset.id));
  });
  document.querySelectorAll('.manage-publish').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await apiRequest(`/marketplace/listings/${btn.dataset.id}/publish`, { method: 'POST' });
        loadManageDashboard();
      } catch (err) {
        alert(err.message || 'Publish failed');
      }
    });
  });
  document.querySelectorAll('.manage-archive').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Archive this listing? It will no longer be publicly visible.')) return;
      try {
        await apiRequest(`/marketplace/listings/${btn.dataset.id}/archive`, { method: 'POST' });
        loadManageDashboard();
      } catch (err) {
        alert(err.message || 'Archive failed');
      }
    });
  });
}

// ─── Listing Create/Edit Form ──────────────────────────────────

let listingFormImages = [];

async function renderListingForm(listingId) {
  const wrap = document.getElementById('listing-form-wrap');
  if (!wrap) return;
  let listing = null;
  if (listingId) {
    try {
      const mine = await apiRequest('/marketplace/my-listings');
      listing = (mine.listings || []).find(l => l.id === listingId) || null;
    } catch {}
    if (!listing) { wrap.innerHTML = '<div class="buy-error">Listing not found.</div>'; return; }
    if (listing.status !== 'draft') { wrap.innerHTML = '<div class="buy-info">Only draft listings can be edited.</div>'; return; }
  }
  listingFormImages = listing && listing.images ? [...listing.images] : [];
  const categories = ['products', 'services', 'digital', 'local'];
  wrap.innerHTML = `
    <form id="listing-form" class="card listing-create-form">
      <h2>${listing ? 'Edit Draft Listing' : 'Create Listing'}</h2>
      <div class="form-group">
        <label class="form-label" for="lf-title">Title</label>
        <input class="form-input" id="lf-title" maxlength="200" required value="${escapeHtml(listing ? listing.title : '')}">
      </div>
      <div class="form-group">
        <label class="form-label" for="lf-desc">Description</label>
        <textarea class="form-textarea form-input" id="lf-desc" maxlength="5000">${escapeHtml(listing ? listing.description : '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="lf-category">Category</label>
        <select class="form-input" id="lf-category">
          ${categories.map(c => `<option value="${c}" ${listing && listing.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="lf-price">Display price</label>
        <input class="form-input" id="lf-price" maxlength="50" value="${escapeHtml(listing ? listing.price_display : '')}" placeholder="e.g. ₱500 or negotiable">
      </div>
      <div class="form-group">
        <label class="form-label" for="lf-image-url">Product images (http(s) URLs, max 10)</label>
        <div class="image-url-row">
          <input class="form-input" id="lf-image-url" placeholder="https://...">
          <button type="button" id="lf-image-add" class="btn btn-secondary">Add</button>
        </div>
        <div id="lf-images-list" class="image-list"></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="lf-external">External sales page (optional http(s) URL)</label>
        <input class="form-input" id="lf-external" maxlength="500" value="${escapeHtml(listing && listing.external_url ? listing.external_url : '')}" placeholder="https://shopee.ph/...">
      </div>
      <div class="form-group">
        <label class="form-label" for="lf-contact">Contact instructions (optional)</label>
        <input class="form-input" id="lf-contact" maxlength="500" value="${escapeHtml(listing && listing.contact_info ? listing.contact_info : '')}" placeholder="e.g. Message me on Facebook: ...">
      </div>
      <div id="lf-status"></div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${listing ? 'Save Draft' : 'Create Draft'}</button>
        <button type="button" id="lf-cancel" class="btn btn-outline">Cancel</button>
      </div>
    </form>`;
  renderFormImages();
  document.getElementById('lf-image-add').addEventListener('click', () => {
    const input = document.getElementById('lf-image-url');
    const url = input.value.trim();
    if (!url) return;
    if (listingFormImages.length >= 10) { setFormStatus('Maximum 10 images.', true); return; }
    if (!/^https?:\/\/[^\s'"<>]+$/i.test(url)) { setFormStatus('Image must be an http(s) URL.', true); return; }
    listingFormImages.push(url);
    input.value = '';
    renderFormImages();
  });
  document.getElementById('lf-cancel').addEventListener('click', () => { wrap.innerHTML = ''; });
  document.getElementById('listing-form').addEventListener('submit', (e) => submitListingForm(e, listingId));
}

function renderFormImages() {
  const list = document.getElementById('lf-images-list');
  if (!list) return;
  list.innerHTML = listingFormImages.map((url, i) => `
    <div class="image-list-item" data-idx="${i}">
      <img src="${escapeHtml(url)}" alt="" class="image-list-thumb" onerror="this.style.display='none'">
      <span class="image-list-url">${escapeHtml(url.length > 48 ? url.slice(0, 48) + '…' : url)}</span>
      <button type="button" class="btn btn-sm btn-outline img-up" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="btn btn-sm btn-outline img-down" data-idx="${i}" ${i === listingFormImages.length - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="btn btn-sm btn-outline img-remove" data-idx="${i}">Remove</button>
    </div>`).join('');
  list.querySelectorAll('.img-remove').forEach(b => b.addEventListener('click', () => {
    listingFormImages.splice(Number(b.dataset.idx), 1);
    renderFormImages();
  }));
  list.querySelectorAll('.img-up').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.idx);
    if (i > 0) { [listingFormImages[i - 1], listingFormImages[i]] = [listingFormImages[i], listingFormImages[i - 1]]; renderFormImages(); }
  }));
  list.querySelectorAll('.img-down').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.idx);
    if (i < listingFormImages.length - 1) { [listingFormImages[i + 1], listingFormImages[i]] = [listingFormImages[i], listingFormImages[i + 1]]; renderFormImages(); }
  }));
}

function setFormStatus(msg, isError) {
  const el = document.getElementById('lf-status');
  if (el) el.innerHTML = `<div class="${isError ? 'buy-error' : 'buy-info'}">${escapeHtml(msg)}</div>`;
}

async function submitListingForm(e, listingId) {
  e.preventDefault();
  const body = {
    title: document.getElementById('lf-title').value.trim(),
    description: document.getElementById('lf-desc').value,
    category: document.getElementById('lf-category').value,
    price_display: document.getElementById('lf-price').value.trim(),
    images: listingFormImages,
    external_url: document.getElementById('lf-external').value.trim() || null,
    contact_info: document.getElementById('lf-contact').value.trim() || null,
  };
  try {
    if (listingId) {
      await apiRequest(`/marketplace/listings/${listingId}`, { method: 'PATCH', body });
      setFormStatus('Draft saved.', false);
    } else {
      await apiRequest('/marketplace/listings', { method: 'POST', body });
      setFormStatus('Draft created.', false);
    }
    document.getElementById('listing-form-wrap').innerHTML = '';
    loadManageDashboard();
  } catch (err) {
    setFormStatus(err.message || 'Save failed.', true);
  }
}

// ─── Buyer Library (My Purchases) ──────────────────────────────
// Route: #/coin-shop/library

const INSTALLABLE_TYPES = new Set(['profile_design']);

export function renderLibraryPage() {
  return `
    <section class="coin-shop-page library-page">
      <header class="coin-shop-header">
        <h1>My Library</h1>
        <p>Creator assets you own</p>
      </header>
      <div class="manage-actions">
        <a href="#/coin-shop" class="btn btn-outline">Back to Coin Shop</a>
        <a href="#/creator-studio" class="btn btn-secondary">Open Creator Studio</a>
      </div>
      <div id="library-list" class="coin-shop-catalog">
        <div class="loading">Loading purchases...</div>
      </div>
    </section>
  `;
}

export function initLibraryPage() {
  loadLibrary();
}

async function loadLibrary() {
  const list = document.getElementById('library-list');
  try {
    const data = await apiRequest('/coin-shop/purchases');
    const purchases = data.purchases || [];
    if (!list) return;
    list.innerHTML = purchases.length > 0
      ? purchases.map(renderLibraryCard).join('')
      : '<div class="marketplace-empty"><p>No purchases yet. <a href="#/coin-shop">Browse the Coin Shop</a>.</p></div>';
    list.querySelectorAll('.lib-install').forEach(btn => {
      btn.addEventListener('click', () => installAsset(btn.dataset.id, btn));
    });
    initShareButtons();
  } catch {
    if (list) list.innerHTML = '<div class="buy-error">Failed to load library.</div>';
  }
}

function renderLibraryCard(p) {
  const preview = p.preview_data && p.preview_data.imageUrl
    ? `<img src="${escapeHtml(p.preview_data.imageUrl)}" alt="" class="coin-card-image">`
    : `<div class="coin-card-no-image"><span>🎨</span></div>`;
  const installable = INSTALLABLE_TYPES.has(p.asset_type);
  const purchasedAt = (p.purchased_at || '').slice(0, 10);
  return `
    <article class="coin-card" data-asset-id="${escapeHtml(p.asset_id)}">
      <div class="coin-card-media">${preview}<span class="coin-category-badge">${escapeHtml(p.asset_type)}</span></div>
      <div class="coin-card-body">
        <h3 class="coin-card-title">${escapeHtml(p.asset_name)}</h3>
        <div class="coin-card-meta">
          <span class="coin-price">${p.price_coins} coins</span>
          <span class="lib-date">· owned since ${escapeHtml(purchasedAt)}</span>
        </div>
        <p class="lib-owned">✓ Owned</p>
        <div class="coin-card-actions">
          ${installable
            ? `<button class="btn btn-primary lib-install" data-id="${escapeHtml(p.asset_id)}">Install to My Designs</button>`
            : `<button class="btn btn-outline" disabled title="This asset type cannot be installed yet">Not installable yet</button>`}
          <a href="#/coin-shop/product/${escapeHtml(p.asset_id)}" class="btn btn-outline">View Product</a>
          <button class="btn btn-outline share-btn" data-url="#/coin-shop/product/${escapeHtml(p.asset_id)}" data-title="${escapeHtml(p.asset_name)}">Share</button>
        </div>
        <div class="lib-status" id="lib-status-${escapeHtml(p.asset_id)}"></div>
      </div>
    </article>
  `;
}

async function installAsset(assetId, btn) {
  const statusEl = document.getElementById(`lib-status-${assetId}`);
  btn.disabled = true;
  try {
    const data = await apiRequest(`/coin-shop/install/${assetId}`, { method: 'POST' });
    if (statusEl) statusEl.innerHTML = `<div class="buy-success">Installed as draft design "${escapeHtml(data.design.name)}". <a href="#/creator-studio">Open in Creator Studio</a> to publish it to your profile.</div>`;
    btn.textContent = 'Installed ✓';
  } catch (err) {
    btn.disabled = false;
    if (statusEl) statusEl.innerHTML = `<div class="buy-error">${escapeHtml(err.message || 'Install failed.')}</div>`;
  }
}

// ─── Share Link ──────────────────────────────────────────────

export function initShareButtons() {
  document.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      const title = btn.dataset.title;
      const shareUrl = `${window.location.origin}#${url.replace('#', '')}`;

      if (navigator.share) {
        try {
          await navigator.share({ title, url: shareUrl });
          return;
        } catch { /* User cancelled or share failed */ }
      }

      const originalText = btn.textContent;
      try {
        await navigator.clipboard.writeText(shareUrl);
        btn.textContent = 'Copied! ✓';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = shareUrl;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try { document.execCommand('copy'); btn.textContent = 'Copied! ✓'; } catch {}
        setTimeout(() => { btn.textContent = originalText; }, 2000);
        document.body.removeChild(textarea);
      }
    });
  });
}
