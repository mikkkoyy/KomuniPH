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
          <a href="#/messages" class="btn btn-primary">Message Seller</a>
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
          <a href="#/messages" class="btn btn-outline">Message Creator</a>
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
          <a href="#/marketplace/listings/new" class="btn btn-primary">Create Listing</a>
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
