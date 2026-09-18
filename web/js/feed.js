/**
 * KomuniPH Lite - Feed UI
 * Posts, comments, and reactions
 */

import { feedApi, authApi, profileApi, isAuthenticated, getCurrentUserProfile } from './api.js';
import { navigate } from './app.js';
import { refreshUnreadCount } from './messages.js';

let feedData = { posts: [], limit: 20, offset: 0, has_more: false };
let currentFeedOffset = 0;

/**
 * COMMUNITY-01: Replace the shared feed state (posts array, etc.) so the
 * global like/comment/edit helpers can operate on community feed posts too.
 * The community page loads posts through the same feed API shape and sets them
 * here before rendering.
 */
export function setFeedData(data) {
  feedData = data || { posts: [], limit: 20, offset: 0, has_more: false };
  currentFeedOffset = feedData.offset || 0;
}

/**
 * Format timestamp to relative time
 */
function formatTimestamp(iso) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 24 && diffDays === 0) {
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    if (diffMinutes < 60) return `${diffMinutes}m`;
    return `${Math.floor(diffHours)}h`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Create avatar HTML
 */
function createAvatar(username, displayName, photoUrl, size = 2.5) {
  if (photoUrl) {
    return `<img src="${photoUrl}" alt="${displayName}" class="avatar" style="width:${size}rem;height:${size}rem">`;
  }
  const initials = (displayName || username || '?').charAt(0).toUpperCase();
  return `<div class="avatar" style="width:${size}rem;height:${size}rem">${initials}</div>`;
}

/**
 * Get the left sidebar HTML with the correct active navigation item.
 */
export function getSidebarHtml(activeRoute = 'home') {
  const cachedProfile = getCurrentUserProfile();
  const displayName = cachedProfile ? (cachedProfile.display_name || cachedProfile.username) : 'Loading...';
  const alias = cachedProfile && cachedProfile.alias_enabled && cachedProfile.alias ? cachedProfile.alias : '';
  const photoUrl = cachedProfile ? cachedProfile.profile_photo_url : '';
  const avatarInitial = (displayName || '?').charAt(0).toUpperCase();

  const imgHtml = photoUrl
    ? `<img id="sidebar-avatar-img" src="${photoUrl}" alt="${displayName}" style="width:3rem;height:3rem;display:block">`
    : `<img id="sidebar-avatar-img" src="" alt="" style="display:none">`;
  const initialsHtml = photoUrl ? '<span id="sidebar-avatar-initials" style="display:none">?</span>' : `<span id="sidebar-avatar-initials">${avatarInitial}</span>`;

  const navItems = [
    { route: 'home', label: 'Home', href: '#/home', isButton: false },
    { route: 'profile', label: 'Profile', href: '#/profile', isButton: false },
    { route: 'messages', label: 'Messages', href: '#/messages', isButton: false, hasBadge: true },
    { route: 'notifications', label: 'Notifications', href: null, isButton: false, comingSoon: true },
    { route: 'saved', label: 'Saved', href: null, isButton: false, comingSoon: true },
    { route: 'divider-1', label: null, href: null, isDivider: true },
    { route: 'community', label: 'Communities', href: '#/community', isButton: false },
    { route: 'creator-studio', label: 'Creator Studio', href: '#/creator-studio', isButton: false },
    { route: 'marketplace', label: 'Marketplace', href: '#/marketplace', isButton: false },
    { route: 'divider-2', label: null, href: null, isDivider: true },
    { route: 'settings', label: 'Settings', href: null, isButton: false, comingSoon: true },
  ];

  const itemsHtml = navItems.map((item) => {
    if (item.isDivider) {
      return '<div class="sidebar-nav-divider" aria-hidden="true"></div>';
    }
    if (item.comingSoon) {
      return `<span class="sidebar-nav-item sidebar-nav-coming-soon" data-nav="${item.route}" title="Coming soon">${item.label}</span>`;
    }
    const isActive = activeRoute === item.route;
    const activeClass = isActive ? ' active' : '';
    const badge = item.hasBadge
      ? '<span id="sidebar-messages-badge" class="sidebar-nav-badge" style="display:none"></span>'
      : '';
    const tag = item.isButton ? 'button' : 'a';
    const attrs = item.isButton
      ? 'type="button" id="sidebar-logout-btn"'
      : `href="${item.href}"`;
    return `<${tag} class="sidebar-nav-item${activeClass}" data-nav="${item.route}" ${attrs}>${item.label}${badge}</${tag}>`;
  }).join('\n          ');

  return `
    <aside class="sidebar-left" aria-label="Account and navigation">
      <div class="sidebar-profile">
        <a href="#/profile" class="sidebar-profile-link" id="sidebar-profile-link">
          <div class="sidebar-avatar" id="sidebar-avatar">
            ${imgHtml}
            ${initialsHtml}
          </div>
          <div class="sidebar-profile-info">
            <p class="sidebar-display-name" id="sidebar-display-name">${escapeHtml(displayName)}</p>
            <p class="sidebar-alias" id="sidebar-alias">${alias ? `@${escapeHtml(alias)}` : ''}</p>
          </div>
        </a>
      </div>
      <nav class="sidebar-nav" aria-label="Primary">
        ${itemsHtml}
        <button class="sidebar-nav-item sidebar-nav-logout" id="sidebar-logout-btn" type="button">Logout</button>
      </nav>
    </aside>
  `;
}

/**
 * Render a placeholder page with the standard social app shell.
 */
export function renderPlaceholderPage(title, description, icon, activeRoute = 'home') {
  if (!isAuthenticated()) {
    navigate('/login');
    return '';
  }

  return `
    <div class="app-layout">
      ${getSidebarHtml(activeRoute)}
      <main class="main-content">
        <div class="placeholder-page">
          <div class="placeholder-card">
            <span class="placeholder-icon" aria-hidden="true">${icon}</span>
            <h1>${title}</h1>
            <p class="placeholder-description">${description}</p>
            <p class="placeholder-coming-soon">Coming soon.</p>
          </div>
        </div>
      </main>
      <aside class="sidebar-right" aria-label="Discover">
        <div class="sidebar-right-section">
          <h3 class="sidebar-right-title">Search</h3>
          <input type="text" class="sidebar-search-input" placeholder="Search KomuniPH..." id="sidebar-search">
        </div>
        <div class="sidebar-right-section">
          <h3 class="sidebar-right-title">People</h3>
          <p class="sidebar-right-placeholder">Discover people coming soon.</p>
        </div>
        <div class="sidebar-right-section">
          <h3 class="sidebar-right-title">Suggestions</h3>
          <p class="sidebar-right-placeholder">Suggestions coming soon.</p>
        </div>
      </aside>
    </div>
  `;
}

/**
 * Render the home page — three-column social layout on desktop.
 */
export function renderHomePage() {
  if (!isAuthenticated()) {
    navigate('/login');
    return '';
  }

  return `
    <div class="app-layout">
      ${getSidebarHtml('home')}

      <!-- Center Content -->
      <main class="main-content">
        <div class="home-layout">
          <header class="home-header">
            <div class="home-header-left">
              <h1>Home</h1>
              <nav><a href="#/profile" class="nav-link">Profile</a></nav>
            </div>
            <button id="logout-btn" class="btn btn-secondary">Sign Out</button>
          </header>

          <div class="composer-actions" id="composer-actions">
            <button class="composer-action composer-action-primary" data-action="post" type="button">
              <span class="composer-action-icon" aria-hidden="true">✏️</span>
              <span>Post</span>
            </button>
            <button class="composer-action" data-action="video" type="button">
              <span class="composer-action-icon" aria-hidden="true">🎬</span>
              <span>Video</span>
            </button>
            <button class="composer-action" data-action="story" type="button">
              <span class="composer-action-icon" aria-hidden="true">📷</span>
              <span>Photo Story</span>
            </button>
            <button class="composer-action" data-action="reels" type="button">
              <span class="composer-action-icon" aria-hidden="true">🎵</span>
              <span>Reels</span>
            </button>
          </div>

          <div id="composer" class="composer">
            <textarea id="post-content" placeholder="What's on your mind?" rows="3" autofocus></textarea>
            <div id="composer-error" class="error-banner" style="display:none"></div>
            <button id="post-submit" class="btn btn-primary">Post</button>
          </div>

          <section id="feed" style="margin-top:1.5rem" aria-label="Newsfeed">
            <div id="feed-loading" class="loading">
              <div class="spinner"></div>
              <p class="loading-text">Loading your feed...</p>
            </div>
            <div id="feed-content" style="display:none"></div>
            <div id="feed-empty" class="empty-state" style="display:none">
              <p class="empty-text">No posts yet. Be the first to share something.</p>
            </div>
            <div id="feed-error" class="error-state" style="display:none">
              <p class="error-message"></p>
              <button class="btn btn-secondary" onclick="window.loadFeed()">Retry</button>
            </div>
            <div id="load-more" style="display:none;text-align:center;margin-top:1.5rem">
              <button class="btn btn-secondary" onclick="window.loadMorePosts()">Load More</button>
            </div>
          </section>
        </div>
      </main>

      <!-- Right Sidebar -->
      <aside class="sidebar-right" aria-label="Discover">
        <div class="sidebar-right-section">
          <h3 class="sidebar-right-title">Search</h3>
          <input type="text" class="sidebar-search-input" placeholder="Search KomuniPH..." id="sidebar-search">
        </div>
        <div class="sidebar-right-section">
          <h3 class="sidebar-right-title">People</h3>
          <p class="sidebar-right-placeholder">Discover people coming soon.</p>
        </div>
        <div class="sidebar-right-section">
          <h3 class="sidebar-right-title">Suggestions</h3>
          <p class="sidebar-right-placeholder">Suggestions coming soon.</p>
        </div>
      </aside>
    </div>

    <!-- Mobile Bottom Navigation -->
    <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile navigation">
      <a href="#/home" class="mobile-nav-item active" data-mobile-nav="home">
        <span aria-hidden="true">🏠</span>
        <span>Home</span>
      </a>
      <a href="#/profile" class="mobile-nav-item" data-mobile-nav="profile">
        <span aria-hidden="true">👤</span>
        <span>Profile</span>
      </a>
      <button class="mobile-nav-item" id="mobile-menu-btn" type="button" aria-label="More options">
        <span aria-hidden="true">☰</span>
        <span>Menu</span>
      </button>
    </nav>
  `;
}

/**
 * Render a post card
 */
export function renderPostCard(post) {
  const authorName = post.author.display_name || post.author.username;
  const authorAlias = post.author.alias_enabled && post.author.alias ? post.author.alias : null;

  return `
    <article class="post-card" data-post-id="${post.id}">
      <header class="post-header">
        ${createAvatar(post.author.username, authorName, post.author.profile_photo_url)}
        <div class="post-author-info">
          <p class="post-author-name">${authorName}</p>
          ${authorAlias ? `<p class="post-author-alias">@${authorAlias}</p>` : ''}
          <p class="post-timestamp">${formatTimestamp(post.created_at)}</p>
        </div>
      </header>

      <div id="post-content-${post.id}" class="post-content">${escapeHtml(post.content)}</div>

      ${post.edited_at ? '<p class="post-edited">Edited</p>' : ''}

      <footer class="post-footer">
        <button class="btn-like ${post.liked_by_current_user ? 'liked' : ''}"
                onclick="window.toggleLike('${post.id}')"
                aria-pressed="${post.liked_by_current_user}">
          <span>${post.liked_by_current_user ? '♥' : '♡'}</span>
          <span>${post.liked_by_current_user ? 'Liked' : 'Like'}</span>
        </button>
        ${post.is_current_user_author ? `
          <button class="btn-icon" onclick="window.startEditPost('${post.id}')">Edit</button>
        ` : ''}
        <span class="post-stats" id="like-count-${post.id}">${post.like_count} ${post.like_count === 1 ? 'like' : 'likes'}</span>
        <button class="btn-icon" onclick="window.toggleComments('${post.id}')">
          💬 ${post.comment_count} ${post.comment_count === 1 ? 'comment' : 'comments'}
        </button>
      </footer>

      <div id="comments-${post.id}" style="display:none"></div>
    </article>
  `;
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Load feed
 */
window.loadFeed = async function() {
  const loading = document.getElementById('feed-loading');
  const content = document.getElementById('feed-content');
  const empty = document.getElementById('feed-empty');
  const error = document.getElementById('feed-error');

  loading.style.display = 'block';
  content.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';

  try {
    feedData = await feedApi.getFeed(20, 0);
    currentFeedOffset = 0;

    if (feedData.posts.length === 0) {
      loading.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    content.innerHTML = feedData.posts.map(renderPostCard).join('');
    loading.style.display = 'none';
    content.style.display = 'block';

    updateLoadMoreButton();
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load feed';
    error.style.display = 'block';
  }
};

/**
 * Load more posts
 */
window.loadMorePosts = async function() {
  const loadMoreBtn = document.querySelector('#load-more button');
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Loading...';

  try {
    currentFeedOffset += feedData.limit;
    const moreData = await feedApi.getFeed(20, currentFeedOffset);

    feedData.posts = [...feedData.posts, ...moreData.posts];
    feedData.has_more = moreData.has_more;

    const content = document.getElementById('feed-content');
    content.innerHTML = feedData.posts.map(renderPostCard).join('');

    updateLoadMoreButton();
  } catch (err) {
    console.error('Failed to load more posts:', err);
  } finally {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = 'Load More';
  }
};

/**
 * Update load more button visibility
 */
function updateLoadMoreButton() {
  const loadMore = document.getElementById('load-more');
  loadMore.style.display = feedData.has_more ? 'block' : 'none';
}

/**
 * Toggle like on a post
 */
window.toggleLike = async function(postId) {
  const post = feedData.posts.find(p => p.id === postId);
  if (!post) return;

  const btn = document.querySelector(`[data-post-id="${postId}"] .btn-like`);
  const countEl = document.getElementById(`like-count-${postId}`);

  try {
    let result;
    if (post.liked_by_current_user) {
      result = await feedApi.unlikePost(postId);
    } else {
      result = await feedApi.likePost(postId);
    }

    post.liked_by_current_user = result.liked;
    post.like_count = result.like_count;

    btn.className = `btn-like ${result.liked ? 'liked' : ''}`;
    btn.setAttribute('aria-pressed', result.liked);
    btn.innerHTML = `<span>${result.liked ? '♥' : '♡'}</span><span>${result.liked ? 'Liked' : 'Like'}</span>`;
    countEl.textContent = `${result.like_count} ${result.like_count === 1 ? 'like' : 'likes'}`;
  } catch (err) {
    console.error('Failed to toggle like:', err);
  }
};

/**
 * Toggle comments section
 */
window.toggleComments = async function(postId) {
  const section = document.getElementById(`comments-${postId}`);
  if (section.style.display === 'none') {
    section.style.display = 'block';
    await loadComments(postId);
  } else {
    section.style.display = 'none';
  }
};

/**
 * Load comments for a post
 */
async function loadComments(postId) {
  const section = document.getElementById(`comments-${postId}`);
  section.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const data = await feedApi.getComments(postId);
    section.innerHTML = renderCommentsSection(postId, data.comments);
  } catch (err) {
    section.innerHTML = `<p class="error-message">${err.message}</p>`;
  }
}

/**
 * Render comments section
 */
function renderCommentsSection(postId, comments) {
  return `
    <div class="comments-section">
      <div class="comments-list">
        ${comments.length === 0
          ? '<p class="empty-text">No comments yet.</p>'
          : comments.map(c => renderCommentCard(c)).join('')
        }
      </div>
      <form class="comment-form" onsubmit="window.submitComment(event, '${postId}')">
        <input type="text" id="comment-input-${postId}" placeholder="Write a comment..." required>
        <button type="submit" class="btn btn-primary">Post</button>
      </form>
    </div>
  `;
}

/**
 * Render a comment card
 */
function renderCommentCard(comment) {
  const authorName = comment.author.display_name || comment.author.username;
  return `
    <div class="comment-card" data-comment-id="${comment.id}">
      <div class="comment-header">
        ${createAvatar(comment.author.username, authorName, comment.author.profile_photo_url, 1.5)}
        <span class="comment-author">${authorName}</span>
        <span class="comment-timestamp">${formatTimestamp(comment.created_at)}</span>
        ${comment.is_current_user_author ? `
          <button class="btn-icon" onclick="window.deleteComment('${comment.id}', '${comment.post_id}')" style="margin-left:auto;font-size:0.75rem">Delete</button>
        ` : ''}
      </div>
      <p class="comment-content">${escapeHtml(comment.content)}</p>
    </div>
  `;
}

/**
 * Submit a comment
 */
window.submitComment = async function(e, postId) {
  e.preventDefault();
  const input = document.getElementById(`comment-input-${postId}`);
  const content = input.value.trim();

  if (!content) return;

  try {
    await feedApi.createComment(postId, content);
    input.value = '';
    await loadComments(postId);

    // Update comment count in post
    const post = feedData.posts.find(p => p.id === postId);
    if (post) {
      post.comment_count++;
      const countBtn = document.querySelector(`[data-post-id="${postId}"] .btn-icon:last-child`);
      if (countBtn) {
        countBtn.innerHTML = `💬 ${post.comment_count} ${post.comment_count === 1 ? 'comment' : 'comments'}`;
      }
    }
  } catch (err) {
    console.error('Failed to submit comment:', err);
  }
};

/**
 * Delete a comment
 */
window.deleteComment = async function(commentId, postId) {
  try {
    await feedApi.deleteComment(commentId);
    await loadComments(postId);

    // Update comment count
    const post = feedData.posts.find(p => p.id === postId);
    if (post && post.comment_count > 0) {
      post.comment_count--;
      const countBtn = document.querySelector(`[data-post-id="${postId}"] .btn-icon:last-child`);
      if (countBtn) {
        countBtn.innerHTML = `💬 ${post.comment_count} ${post.comment_count === 1 ? 'comment' : 'comments'}`;
      }
    }
  } catch (err) {
    console.error('Failed to delete comment:', err);
  }
};

/**
 * Start editing a post
 */
window.startEditPost = function(postId) {
  const post = feedData.posts.find(p => p.id === postId);
  if (!post) return;

  const contentEl = document.getElementById(`post-content-${postId}`);
  contentEl.innerHTML = `
    <div class="edit-form">
      <textarea id="edit-textarea-${postId}">${escapeHtml(post.content)}</textarea>
      <div class="edit-actions">
        <button class="btn btn-primary" onclick="window.saveEditPost('${postId}')">Save</button>
        <button class="btn btn-secondary" onclick="window.cancelEditPost('${postId}')">Cancel</button>
      </div>
    </div>
  `;
};

/**
 * Save edited post
 */
window.saveEditPost = async function(postId) {
  const textarea = document.getElementById(`edit-textarea-${postId}`);
  const content = textarea.value.trim();

  if (!content) return;

  try {
    const updatedPost = await feedApi.updatePost(postId, content);

    // Update local data
    const post = feedData.posts.find(p => p.id === postId);
    if (post) {
      post.content = content;
      post.edited_at = updatedPost.edited_at;
    }

    // Re-render post content
    const contentEl = document.getElementById(`post-content-${postId}`);
    contentEl.innerHTML = escapeHtml(content);

    // Add edited label if not already there
    const article = document.querySelector(`[data-post-id="${postId}"]`);
    if (!article.querySelector('.post-edited')) {
      const footer = article.querySelector('.post-footer');
      const editedP = document.createElement('p');
      editedP.className = 'post-edited';
      editedP.textContent = 'Edited';
      footer.before(editedP);
    }
  } catch (err) {
    console.error('Failed to save post:', err);
  }
};

/**
 * Cancel editing
 */
window.cancelEditPost = function(postId) {
  const post = feedData.posts.find(p => p.id === postId);
  if (!post) return;

  const contentEl = document.getElementById(`post-content-${postId}`);
  contentEl.innerHTML = escapeHtml(post.content);
};

/**
 * Load profile data into the left sidebar.
 */
async function loadSidebarProfile() {
  const avatarEl = document.getElementById('sidebar-avatar');
  const imgEl = document.getElementById('sidebar-avatar-img');
  const initialsEl = document.getElementById('sidebar-avatar-initials');
  const displayNameEl = document.getElementById('sidebar-display-name');
  const aliasEl = document.getElementById('sidebar-alias');

  if (!avatarEl) return;

  try {
    const cached = getCurrentUserProfile();
    let profile = cached;

    if (!profile) {
      profile = await profileApi.getOwnProfile();
      setCurrentUserProfile(profile);
    }

    const displayName = profile.display_name || profile.username;
    const alias = profile.alias_enabled && profile.alias ? profile.alias : '';

    if (imgEl && profile.profile_photo_url) {
      imgEl.src = profile.profile_photo_url;
      imgEl.alt = displayName;
      imgEl.style.display = 'block';
      if (initialsEl) initialsEl.style.display = 'none';
    } else if (initialsEl) {
      initialsEl.textContent = (displayName || '?').charAt(0).toUpperCase();
    }

    if (displayNameEl) displayNameEl.textContent = displayName;
    if (aliasEl) aliasEl.textContent = alias ? `@${alias}` : '';
  } catch (err) {
    if (displayNameEl) displayNameEl.textContent = 'User';
  }
}

/**
 * Show a brief toast notification.
 */
function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

/**
 * COMMUNITY-01: Mobile navigation. The bottom bar only fits a few items, so
 * the Menu button opens a slide-up sheet with the full set of destinations.
 * Shared by the home and community pages.
 */
export function openMobileMenu() {
  let sheet = document.getElementById('mobile-menu-sheet');
  if (sheet) {
    sheet.classList.add('open');
    return;
  }

  const items = [
    { href: '#/home', label: 'Home', icon: '🏠' },
    { href: '#/profile', label: 'Profile', icon: '👤' },
    { href: '#/messages', label: 'Messages', icon: '💬' },
    { href: '#/community', label: 'Communities', icon: '👥' },
    { href: '#/creator-studio', label: 'Creator Studio', icon: '🎬' },
    { href: '#/marketplace', label: 'Marketplace', icon: '🛍️' },
  ];

  sheet = document.createElement('div');
  sheet.className = 'mobile-menu-sheet';
  sheet.id = 'mobile-menu-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Menu');
  sheet.innerHTML = `
    <button class="mobile-menu-overlay" type="button" aria-label="Close menu"></button>
    <nav class="mobile-menu-panel" aria-label="Mobile menu">
      <header class="mobile-menu-header">
        <strong>KomuniPH</strong>
        <button class="mobile-menu-close" type="button" aria-label="Close menu">✕</button>
      </header>
      ${items.map(item => `<a class="mobile-menu-item" href="${item.href}"><span aria-hidden="true">${item.icon}</span> ${item.label}</a>`).join('')}
    </nav>
  `;
  document.body.appendChild(sheet);

  const close = () => sheet.classList.remove('open');
  sheet.querySelector('.mobile-menu-close').addEventListener('click', close);
  sheet.querySelector('.mobile-menu-overlay').addEventListener('click', close);
  sheet.querySelectorAll('.mobile-menu-item').forEach(item => {
    item.addEventListener('click', close);
  });

  requestAnimationFrame(() => sheet.classList.add('open'));
}

/**
 * Bind the mobile bottom-bar Menu button (if present) to open the sheet.
 */
export function initMobileNav() {
  const btn = document.getElementById('mobile-menu-btn');
  if (btn) {
    btn.addEventListener('click', openMobileMenu);
  }
}

/**
 * Initialize sidebar common functionality (logout, profile, unread).
 */
export function initSidebarCommon() {
  const sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');
  if (sidebarLogoutBtn) {
    sidebarLogoutBtn.addEventListener('click', () => {
      authApi.logout();
      navigate('/login');
    });
  }

  const comingSoonItems = document.querySelectorAll('.sidebar-nav-coming-soon');
  comingSoonItems.forEach((item) => {
    item.addEventListener('click', () => {
      const label = item.textContent.trim();
      showToast(`${label} coming soon`);
    });
  });

  loadSidebarProfile();
  refreshUnreadCount();
}

/**
 * Initialize home page
 */
export function initHomePage() {
  // Logout buttons (header + sidebar)
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      authApi.logout();
      navigate('/login');
    });
  }

  // Sidebar common init
  initSidebarCommon();

  // Composer action bar
  const actionButtons = document.querySelectorAll('.composer-action');
  actionButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'post') {
        const textarea = document.getElementById('post-content');
        if (textarea) {
          textarea.focus();
          textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else if (action === 'video') {
        showToast('Video uploads coming soon');
      } else if (action === 'story') {
        showToast('Photo Stories coming soon');
      } else if (action === 'reels') {
        showToast('Reels coming soon');
      }
    });
  });

  // Post composer
  const postContent = document.getElementById('post-content');
  const postSubmit = document.getElementById('post-submit');
  const composerError = document.getElementById('composer-error');

  if (postSubmit) {
    postSubmit.addEventListener('click', async () => {
      const content = postContent.value.trim();

      if (!content) {
        composerError.textContent = 'Post content is required';
        composerError.style.display = 'block';
        return;
      }

      if (content.length > 5000) {
        composerError.textContent = 'Post content must be less than 5000 characters';
        composerError.style.display = 'block';
        return;
      }

      postSubmit.disabled = true;
      postSubmit.textContent = 'Posting...';
      composerError.style.display = 'none';

      try {
        const newPost = await feedApi.createPost(content);
        feedData.posts.unshift(newPost);
        postContent.value = '';

        const contentEl = document.getElementById('feed-content');
        const emptyEl = document.getElementById('feed-empty');
        emptyEl.style.display = 'none';
        contentEl.innerHTML = feedData.posts.map(renderPostCard).join('');
        contentEl.style.display = 'block';
      } catch (err) {
        composerError.textContent = err.message || 'Failed to create post';
        composerError.style.display = 'block';
      } finally {
        postSubmit.disabled = false;
        postSubmit.textContent = 'Post';
      }
    });
  }

  // Right sidebar search (UI-only)
  const searchInput = document.getElementById('sidebar-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && searchInput.value.trim()) {
        showToast('Search coming soon');
      }
    });
  }

  // Coming-soon sidebar nav items
  const comingSoonItems = document.querySelectorAll('.sidebar-nav-coming-soon');
  comingSoonItems.forEach((item) => {
    item.addEventListener('click', () => {
      const label = item.textContent.trim();
      showToast(`${label} coming soon`);
    });
  });

  // Mobile menu button
  initMobileNav();

  // Load sidebar profile
  // (handled by initSidebarCommon above)

  // Load feed
  window.loadFeed();
}

/**
 * Initialize a placeholder page (Creator Studio, Marketplace, Community Groups).
 */
export function initPlaceholderPage() {
  initSidebarCommon();
}
