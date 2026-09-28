/**
 * KomuniPH Lite - Main Application
 * Router and app initialization
 */

import { isAuthenticated, clearTokens, initAuth, restoreTokens, apiRequest } from './api.js';
import { renderLoginPage, renderRegisterPage, renderVerifyEmailPage, renderForgotPasswordPage, renderResetPasswordPage, renderResetPasswordSuccessPage, initLoginForm, initRegisterForm, initForgotPasswordForm, initResetPasswordForm } from './auth.js';
import { renderHomePage, initHomePage, renderPlaceholderPage, initPlaceholderPage } from './feed.js';
import { renderProfilePage, initProfilePage } from './profile.js';
import { renderProfileEditorPage, initProfileEditorPage, destroyProfileEditorPage, canLeaveProfileEditor } from './profileEditor.js';
import { renderCreatorStudioPage, initCreatorStudioPage, destroyCreatorStudioPage, canLeaveCreatorStudio } from './creatorStudio.js';
// PHASE-3 GALLERY-SPLIT-01: gallery/album pages live in their own modules
import { renderGalleryPage, initGalleryPage } from './gallery.js';
import { renderAlbumPage, initAlbumPage } from './albums.js';
import { renderMessagesPage, initMessagesPage, destroyMessagesPage } from './messages.js';
import { renderCommunityPage, initCommunityPage, renderCommunityDetailPage, initCommunityDetailPage } from './communities.js';
import { renderWalletPage, initWalletPage } from './coins.js';
import { renderAdminPage, initAdminPage } from './admin.js';
import { renderMarketplacePage, initMarketplacePage, renderCoinShopPage, initCoinShopPage, initShareButtons, renderMarketplaceProductDetail, renderCoinShopProductDetailPage } from './marketplace.js';

const app = document.getElementById('app');

/**
 * Navigate to a route
 */
export function navigate(path) {
  window.location.hash = path;
}

/**
 * Get current route from hash
 */
function getRoute() {
  const hash = window.location.hash.slice(1) || '/login';
  return hash;
}

/**
 * Render the current route
 */
function render() {
  const route = getRoute();

  // Keep editor drafts when browser Back/Forward would leave the workspace.
  if (route !== '/profile/edit' && !canLeaveProfileEditor()) {
    window.location.hash = '/profile/edit';
    return;
  }
  if (route === '/profile/edit' && isAuthenticated() && document.getElementById('profile-editor')) return;
  destroyProfileEditorPage();

  // Keep Creator Studio drafts when Back/Forward would leave the workspace.
  if (route !== '/creator-studio' && !canLeaveCreatorStudio()) {
    window.location.hash = '/creator-studio';
    return;
  }
  if (route === '/creator-studio' && isAuthenticated() && document.getElementById('creator-studio')) return;

  // Cleanup previous page
  if (destroyMessagesPage) {
    destroyMessagesPage();
  }
  destroyCreatorStudioPage();

  // Clear tokens on logout
  if (route === '/logout') {
    clearTokens();
    navigate('/login');
    return;
  }

  let html = '';
  let initFn = null;

  switch (route) {
    case '/login':
      html = renderLoginPage();
      initFn = initLoginForm;
      break;
    case '/register':
      html = renderRegisterPage();
      initFn = initRegisterForm;
      break;
    case '/verify-email':
      html = renderVerifyEmailPage();
      break;
    case '/forgot-password':
      html = renderForgotPasswordPage();
      initFn = initForgotPasswordForm;
      break;
    case '/reset-password':
      html = renderResetPasswordPage();
      initFn = initResetPasswordForm;
      break;
    case '/reset-success':
      html = renderResetPasswordSuccessPage();
      break;
    case '/home':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderHomePage();
      initFn = initHomePage;
      break;
    case '/profile/edit':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderProfileEditorPage();
      initFn = initProfileEditorPage;
      break;
    case '/profile':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderProfilePage();
      initFn = initProfilePage;
      break;
    case '/messages':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderMessagesPage();
      initFn = initMessagesPage;
      break;
    case '/creator-studio':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderCreatorStudioPage();
      initFn = initCreatorStudioPage;
      break;
    case '/marketplace':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderMarketplacePage();
      initFn = initMarketplacePage;
      break;
    case '/coin-shop':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderCoinShopPage();
      initFn = initCoinShopPage;
      break;
    case '/wallet':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderWalletPage();
      initFn = initWalletPage;
      break;
    case '/groups':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderPlaceholderPage('Community Groups', 'Find and join communities that interest you.', '👥', 'groups');
      initFn = initPlaceholderPage;
      break;
    case '/community':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderCommunityPage();
      initFn = initCommunityPage;
      break;
    default:
      // Admin routes: /admin, /admin/login, /admin/dashboard, /admin/cashin, etc.
      if (route.startsWith('/admin')) {
        html = renderAdminPage();
        initFn = initAdminPage;
        break;
      }
      // MARKETPLACE-01: stable public product URLs. Must be matched before
      // the public-profile catch-all since `([^/]+)` would otherwise swallow
      // "marketplace" as a username.
      const marketplaceProductMatch = route.match(/^\/marketplace\/product\/([^/?#]+)/);
      if (marketplaceProductMatch) {
        html = '<section class="product-detail-page"><div class="loading">Loading product...</div></section>';
        initFn = () => loadProductDetail(marketplaceProductMatch[1], 'marketplace');
        break;
      }
      const coinShopProductMatch = route.match(/^\/coin-shop\/product\/([^/?#]+)/);
      if (coinShopProductMatch) {
        html = '<section class="product-detail-page"><div class="loading">Loading product...</div></section>';
        initFn = () => loadProductDetail(coinShopProductMatch[1], 'coin-shop');
        break;
      }
      const communityDetailMatch = route.match(/^\/community\/([^/]+)$/);
      if (communityDetailMatch) {
        html = renderCommunityDetailPage(communityDetailMatch[1]);
        initFn = () => initCommunityDetailPage(communityDetailMatch[1]);
        break;
      }
      const galleryMatch = route.match(/^\/profile\/([^/]+)\/photos$/);
      if (galleryMatch) {
        html = renderGalleryPage(galleryMatch[1]);
        initFn = initGalleryPage;
        break;
      }
      const albumMatch = route.match(/^\/profile\/([^/]+)\/photos\/([^/]+)$/);
      if (albumMatch) {
        html = renderAlbumPage(albumMatch[1], albumMatch[2]);
        initFn = initAlbumPage;
        break;
      }
      const publicProfileMatch = route.match(/^\/profile\/([^/]+)$/);
      if (publicProfileMatch) {
        html = renderProfilePage(publicProfileMatch[1]);
        initFn = initProfilePage;
        break;
      }
      navigate('/login');
      return;
  }

  app.innerHTML = html;

  // Initialize page-specific logic after DOM is ready
  if (initFn) {
    requestAnimationFrame(() => {
      initFn();
    });
  }
}

// Listen for hash changes
window.addEventListener('hashchange', render);

// GALLERY-ROUTES-01: the hash router owns navigate(). Expose it globally so
// profile.js (gallery "View All Photos" / album cards) can reuse the exact
// same hash navigation instead of touching window.location directly.
window.navigate = navigate;

// Initial render — render route first, then restore auth in the background
// so the UI never becomes blank while authentication is pending.
restoreTokens();
render();

initAuth().then(() => {
  // Auth state restoration complete; the UI already rendered so it never
  // became blank while authentication was pending.
  //
  // OWNER-VIEW-AFTER-REFRESH: pages mounted before the session was known
  // cannot tell owner from visitor (isOwnUsername() has no cached profile
  // yet), so a hard refresh on #/profile, #/profile/:user/photos or
  // #/profile/:user/photos/:albumId would show the public view and hide the
  // owner-only controls. Re-render such routes once now that auth is known.
  // The auth pages themselves do not depend on the session.
  const route = getRoute();
  const sessionIndependentRoutes = [
    '/login', '/register', '/verify-email',
    '/forgot-password', '/reset-password', '/reset-success',
  ];
  if (!sessionIndependentRoutes.includes(route)) {
    render();
  }
});

/**
 * Load a product detail (Marketplace listing or Coin Shop asset) into #app.
 * Uses the stable share URLs: #/marketplace/product/:id and
 * #/coin-shop/product/:id. Product fetches are public so logged-out
 * visitors opening a shared link see the exact product.
 */
async function loadProductDetail(id, type) {
  const container = document.getElementById('app');
  try {
    if (type === 'marketplace') {
      const res = await apiRequest(`/marketplace/listings/${id}`);
      if (res && res.listing) {
        container.innerHTML = renderMarketplaceProductDetail(res.listing);
        initShareButtons();
      } else {
        container.innerHTML = '<section class="not-found-page"><h1>Product Not Found</h1><p>The product you are looking for does not exist or is not publicly available.</p><a href="#/marketplace" class="btn btn-primary">Browse Marketplace</a></section>';
      }
    } else {
      const res = await apiRequest(`/coin-shop/products/${id}`);
      if (res && res.product) {
        container.innerHTML = renderCoinShopProductDetailPage(res.product);
        initShareButtons();
        const buyBtn = container.querySelector('.buy-btn');
        if (buyBtn) {
          buyBtn.addEventListener('click', async () => {
            const assetId = buyBtn.dataset.assetId;
            const name = buyBtn.dataset.name;
            const price = parseInt(buyBtn.dataset.price, 10);
            if (!confirm(`Buy "${name}" for ${price} coins?`)) return;
            try {
              await apiRequest(`/coin-shop/buy/${assetId}`, { method: 'POST' });
              buyBtn.disabled = true;
              buyBtn.textContent = 'Purchased ✓';
              const statusEl = document.getElementById('buy-status');
              if (statusEl) statusEl.innerHTML = '<div class="buy-success">Successfully purchased!</div>';
            } catch (err) {
              const statusEl = document.getElementById('buy-status');
              if (statusEl) {
                if (err.status === 402) statusEl.innerHTML = '<div class="buy-error">Insufficient coins.</div>';
                else if (err.status === 409) statusEl.innerHTML = '<div class="buy-info">You already own this asset.</div>';
                else statusEl.innerHTML = '<div class="buy-error">Purchase failed.</div>';
              }
            }
          });
        }
      } else {
        container.innerHTML = '<section class="not-found-page"><h1>Product Not Found</h1><p>The product you are looking for does not exist or is not publicly available.</p><a href="#/coin-shop" class="btn btn-primary">Browse Coin Shop</a></section>';
      }
    }
  } catch {
    container.innerHTML = '<section class="not-found-page"><h1>Product Not Found</h1><p>The product you are looking for does not exist or is not publicly available.</p></section>';
  }
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}
