/**
 * KomuniPH Lite - Main Application
 * Router and app initialization
 */

import { isAuthenticated, clearTokens, initAuth } from './api.js';
import { renderLoginPage, renderRegisterPage, renderVerifyEmailPage, renderForgotPasswordPage, renderResetPasswordPage, renderResetPasswordSuccessPage, initLoginForm, initRegisterForm, initForgotPasswordForm, initResetPasswordForm } from './auth.js';
import { renderHomePage, initHomePage, renderPlaceholderPage, initPlaceholderPage } from './feed.js';
import { renderProfilePage, initProfilePage } from './profile.js';
import { renderMessagesPage, initMessagesPage, destroyMessagesPage } from './messages.js';

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

  // Cleanup previous page
  if (destroyMessagesPage) {
    destroyMessagesPage();
  }

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
      html = renderPlaceholderPage('Creator Studio', 'Create and manage your content from one place.', '🎬', 'creator-studio');
      initFn = initPlaceholderPage;
      break;
    case '/marketplace':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderPlaceholderPage('Marketplace', 'Discover products and listings from the KomuniPH community.', '🛍️', 'marketplace');
      initFn = initPlaceholderPage;
      break;
    case '/groups':
      if (!isAuthenticated()) {
        navigate('/login');
        return;
      }
      html = renderPlaceholderPage('Community Groups', 'Find and join communities that interest you.', '👥', 'groups');
      initFn = initPlaceholderPage;
      break;
    default:
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

// Initial render — restore auth first, then route
initAuth().then(() => {
  render();
});
