/**
 * KomuniPH Lite - Communities UI (COMMUNITY-01)
 * Location-based community directory and community detail pages.
 *
 * Reuses the existing app shell (getSidebarHtml), feed rendering
 * (renderPostCard + setFeedData) and API client, so the community feature is
 * an addition to the existing product rather than a separate design.
 */

import { communityApi, feedApi, isAuthenticated } from './api.js';
import { navigate } from './app.js';
import { getSidebarHtml, initSidebarCommon, renderPostCard, setFeedData, initMobileNav } from './feed.js';

const TYPE_META = {
  nationwide: { label: 'Nationwide Community', icon: '🇵🇭' },
  city: { label: 'City Community', icon: '🏙' },
  barangay: { label: 'Barangay Community', icon: '📍' },
};

function scopeLabel(community) {
  switch (community.type) {
    case 'nationwide':
      return community.country || '';
    case 'city':
      return [community.country, community.city].filter(Boolean).join(', ') || '';
    case 'barangay':
      return [community.country, community.city, community.barangay].filter(Boolean).join(', ') || '';
    default:
      return '';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatNumber(n) {
  const value = Number(n) || 0;
  return value.toLocaleString('en-US', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 });
}

/**
 * Join/Leave toggle button for a community card.
 * Nationwide uses automatic membership, so it only ever shows "Joined".
 */
function membershipButton(community) {
  if (community.type === 'nationwide') {
    return `<span class="community-badge badge-joined"><span class="community-badge-dot"></span> Auto-joined</span>`;
  }
  if (community.membership === 'member') {
    return `<button class="btn btn-secondary community-leave-btn" data-action="leave" data-id="${community.id}" type="button">Leave</button>`;
  }
  if (community.eligibility) {
    return `<button class="btn btn-primary community-join-btn" data-action="join" data-id="${community.id}" type="button">Join</button>`;
  }
  return '';
}

/**
 * Render the community directory (list) page.
 */
export function renderCommunityPage() {
  if (!isAuthenticated()) {
    navigate('/login');
    return '';
  }

  return `
    <div class="app-layout">
      ${getSidebarHtml('community')}

      <main class="main-content">
        <div class="community-page">
          <header class="community-page-header">
            <h1>Communities</h1>
            <p class="community-page-subtitle">Find and join location-based communities near you.</p>
          </header>

          <div id="community-loading" class="loading">
            <div class="spinner"></div>
            <p class="loading-text">Loading communities...</p>
          </div>

          <div id="community-directory" style="display:none"></div>

          <div id="community-empty" class="empty-state" style="display:none">
            <p class="empty-text">No communities are available for your location yet. Set your Country, City, and Barangay on your profile to discover them.</p>
            <a class="btn btn-primary" href="#/profile/edit">Update Profile Location</a>
          </div>

          <div id="community-error" class="error-state" style="display:none">
            <p class="error-message"></p>
            <button class="btn btn-secondary" onclick="window.loadCommunityDirectory()">Retry</button>
          </div>
        </div>
      </main>

      <aside class="sidebar-right" aria-label="Discover">
        <div class="sidebar-right-section">
          <h3 class="sidebar-right-title">About Communities</h3>
          <p class="sidebar-right-placeholder">Communities are anchored to your profile location, from nationwide all the way down to your barangay.</p>
        </div>
        <div class="sidebar-right-section">
          <h3 class="sidebar-right-title">Hierarchy</h3>
          <p class="sidebar-right-placeholder">Nationwide → City → Barangay. You can only join communities that match where you live.</p>
        </div>
      </aside>
    </div>

    <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile navigation">
      <a href="#/home" class="mobile-nav-item" data-mobile-nav="home">
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

function renderDirectorySections(communities) {
  const sections = [
    { key: 'nationwide', title: 'Nationwide' },
    { key: 'city', title: 'My City' },
    { key: 'barangay', title: 'My Barangay' },
  ];

  return sections.map(section => {
    const list = communities.filter(c => c.type === section.key);
    if (list.length === 0) return '';

    return `
      <section class="community-section" data-scope="${section.key}">
        <h2 class="community-section-title">${section.title}</h2>
        <div class="community-grid">
          ${list.map(renderCommunityCard).join('')}
        </div>
      </section>
    `;
  }).join('');
}

function renderCommunityCard(community) {
  const meta = TYPE_META[community.type] || { label: community.type, icon: '🏘' };
  return `
    <article class="community-card" data-community-id="${community.id}">
      <div class="community-card-head">
        <span class="community-card-icon" aria-hidden="true">${meta.icon}</span>
        <div class="community-card-titles">
          <h3 class="community-card-name">${escapeHtml(community.name)}</h3>
          <p class="community-card-scope">${meta.label}${community.country ? ' · ' + escapeHtml(scopeLabel(community)) : ''}</p>
        </div>
      </div>
      ${community.description ? `<p class="community-card-desc">${escapeHtml(community.description)}</p>` : ''}
      <div class="community-card-foot">
        <span class="community-card-members">${formatNumber(community.member_count)} members</span>
        <span class="community-card-status-status">${community.membership === 'member' ? '✓ Joined' : 'Not joined'}</span>
        <span class="community-card-actions">
          <a class="btn btn-secondary" href="#/community/${community.id}">Open</a>
          ${membershipButton(community)}
        </span>
      </div>
    </article>
  `;
}

/**
 * Load the community directory (bound to init and retry).
 */
window.loadCommunityDirectory = async function () {
  const loading = document.getElementById('community-loading');
  const directory = document.getElementById('community-directory');
  const empty = document.getElementById('community-empty');
  const error = document.getElementById('community-error');

  loading.style.display = 'block';
  directory.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';

  try {
    const data = await communityApi.getCommunities();
    const communities = data.communities || [];

    loading.style.display = 'none';

    if (communities.length === 0) {
      empty.style.display = 'block';
      return;
    }

    directory.innerHTML = renderDirectorySections(communities);
    directory.style.display = 'block';
    bindDirectoryActions();
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load communities';
    error.style.display = 'block';
  }
};

function bindDirectoryActions() {
  document.querySelectorAll('#community-directory [data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, action } = btn.dataset;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = action === 'join' ? 'Joining...' : 'Leaving...';
      try {
        if (action === 'join') {
          await communityApi.join(id);
        } else {
          await communityApi.leave(id);
        }
        await window.loadCommunityDirectory();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = original;
        showPageMessage(err.message || 'Action failed', true);
      }
    });
  });
}

/**
 * Init the community directory page.
 */
export function initCommunityPage() {
  initSidebarCommon();
  initMobileNav();
  window.loadCommunityDirectory();
}

/**
 * Render the community detail page.
 */
export function renderCommunityDetailPage(communityId) {
  if (!isAuthenticated()) {
    navigate('/login');
    return '';
  }

  return `
    <div class="app-layout">
      ${getSidebarHtml('community')}

      <main class="main-content">
        <div class="community-detail" data-community-id="${communityId}">
          <div id="community-detail-loading" class="loading">
            <div class="spinner"></div>
            <p class="loading-text">Loading community...</p>
          </div>

          <div id="community-detail-content" style="display:none"></div>

          <div id="community-detail-error" class="error-state" style="display:none">
            <p class="error-message"></p>
            <a class="btn btn-secondary" href="#/community">Back to Communities</a>
          </div>
        </div>
      </main>

      <aside class="sidebar-right" aria-label="Discover">
        <div class="sidebar-right-section">
          <h3 class="sidebar-right-title">Community</h3>
          <p class="sidebar-right-placeholder">Members can post to the community feed and see who is part of their location.</p>
        </div>
      </aside>
    </div>

    <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile navigation">
      <a href="#/home" class="mobile-nav-item" data-mobile-nav="home">
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

let communityDetailState = null;

async function loadCommunityDetail(communityId) {
  const loading = document.getElementById('community-detail-loading');
  const content = document.getElementById('community-detail-content');
  const error = document.getElementById('community-detail-error');

  loading.style.display = 'block';
  content.style.display = 'none';
  error.style.display = 'none';

  try {
    const community = await communityApi.getCommunity(communityId);
    communityDetailState = { community };
    renderCommunityHeader(community);
    bindDetailJoinLeave();
    switchCommunityTab('feed');
    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent =
      err.status === 403
        ? 'You are not eligible for this community.'
        : (err.message || 'Failed to load community');
    error.style.display = 'block';
  }
}

function renderCommunityHeader(community) {
  const meta = TYPE_META[community.type] || { label: community.type, icon: '🏘' };
  const isMember = community.membership === 'member';
  const canJoin = community.eligibility && !isMember;

  const el = document.getElementById('community-detail-content');
  el.innerHTML = `
    <header class="community-header">
      <div class="community-header-top">
        <span class="community-card-icon community-header-icon" aria-hidden="true">${meta.icon}</span>
        <div class="community-header-titles">
          <h1 class="community-header-name">${escapeHtml(community.name)}</h1>
          <p class="community-header-scope">${meta.label} · ${escapeHtml(scopeLabel(community))}</p>
        </div>
      </div>
      ${community.description ? `<p class="community-header-desc">${escapeHtml(community.description)}</p>` : ''}
      <div class="community-header-stats">
        <span class="community-header-stat"><strong>${formatNumber(community.member_count)}</strong> members</span>
        <span class="community-header-stat"><strong>${isMember ? '✓' : ''}</strong> ${isMember ? 'Joined' : 'Not joined'}</span>
      </div>
      <div class="community-header-actions">
        ${community.type === 'nationwide'
          ? `<span class="community-badge badge-joined"><span class="community-badge-dot"></span> Auto-joined</span>`
          : isMember
            ? `<button class="btn btn-secondary community-header-leave" data-action="leave" type="button">Leave Community</button>`
            : canJoin
              ? `<button class="btn btn-primary community-header-join" data-action="join" type="button">Join Community</button>`
              : '<span class="community-badge"><span class="community-badge-dot"></span> Not eligible</span>'
        }
        <a class="btn btn-secondary" href="#/community">← All Communities</a>
      </div>
    </header>

    <nav class="community-tabs" aria-label="Community sections">
      <button class="community-tab active" data-tab="feed" type="button">Feed</button>
      <button class="community-tab" data-tab="members" type="button">Members</button>
      <button class="community-tab" data-tab="about" type="button">About</button>
    </nav>

    <div id="community-tab-content"></div>
  `;

  bindTabs();
  window.scrollTo(0, 0);
}

function bindTabs() {
  document.querySelectorAll('.community-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.community-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      switchCommunityTab(tab.dataset.tab);
    });
  });
}

function switchCommunityTab(tab) {
  const container = document.getElementById('community-tab-content');
  const community = communityDetailState && communityDetailState.community;

  if (!container || !community) return;

  if (tab === 'feed') {
    container.innerHTML = `
      ${community.membership === 'member' ? `
        <div class="composer community-composer">
          <textarea id="community-post-content" placeholder="Share something with ${escapeHtml(community.name)}..." rows="3"></textarea>
          <div id="community-composer-error" class="error-banner" style="display:none"></div>
          <div class="community-composer-actions">
            <span class="community-composer-hint">Only members can post.</span>
            <button id="community-post-submit" class="btn btn-primary">Post</button>
          </div>
        </div>
      ` : `
        <div class="community-join-prompt empty-state">
          <p class="empty-text">Join this community to share posts in its feed.</p>
        </div>
      `}
      <section class="community-feed" aria-label="Community feed">
        <div id="community-feed-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading feed...</p>
        </div>
        <div id="community-feed-content" style="display:none"></div>
        <div id="community-feed-empty" class="empty-state" style="display:none">
          <p class="empty-text">No posts in this community yet. Be the first to share something.</p>
        </div>
        <div id="community-feed-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadCommunityFeedPosts()">Retry</button>
        </div>
        <div id="community-feed-more" style="display:none;text-align:center;margin-top:1.5rem">
          <button class="btn btn-secondary" onclick="window.loadMoreCommunityPosts()">Load More</button>
        </div>
      </section>
    `;
    bindCommunityComposer(community);
    window.loadCommunityFeedPosts();
  } else if (tab === 'members') {
    container.innerHTML = `
      <section class="community-members-section" aria-label="Community members">
        <div id="community-members-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading members...</p>
        </div>
        <div id="community-members-content" style="display:none"></div>
        <div id="community-members-empty" class="empty-state" style="display:none">
          <p class="empty-text">No members yet.</p>
        </div>
        <div id="community-members-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadCommunityMembers()">Retry</button>
        </div>
        <div id="community-members-more" style="display:none;text-align:center;margin-top:1.5rem">
          <button class="btn btn-secondary" onclick="window.loadMoreCommunityMembers()">Load More</button>
        </div>
      </section>
    `;
    window.loadCommunityMembers();
  } else if (tab === 'about') {
    container.innerHTML = `
      <section class="community-about" aria-label="About">
        <div class="community-about-card">
          <h3>About this community</h3>
          <p>${escapeHtml(community.description || '')}</p>
          <h3>Geographic scope</h3>
          <ul class="community-about-list">
            <li><strong>Type:</strong> ${TYPE_META[community.type].label}</li>
            <li><strong>Country:</strong> ${escapeHtml(community.country || '—')}</li>
            <li><strong>City:</strong> ${escapeHtml(community.city || '—')}</li>
            <li><strong>Barangay:</strong> ${escapeHtml(community.barangay || '—')}</li>
          </ul>
          <p class="community-about-note">Community access is based on the location saved on your profile.</p>
        </div>
      </section>
    `;
  }
}

let communityFeed = { posts: [], limit: 20, offset: 0, has_more: false };

window.loadCommunityFeedPosts = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;

  showFeedState('loading');

  try {
    const data = await communityApi.getPosts(community.id, 20, 0);
    communityFeed = data;
    setFeedData(data);

    renderCommunityFeedPosts();
  } catch (err) {
    document.getElementById('community-feed-loading').style.display = 'none';
    const error = document.getElementById('community-feed-error');
    error.querySelector('.error-message').textContent = err.message || 'Failed to load feed';
    error.style.display = 'block';
  }
};

window.loadMoreCommunityPosts = async function () {
  const btn = document.querySelector('#community-feed-more button');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const community = communityDetailState && communityDetailState.community;
    const offset = communityFeed.offset + communityFeed.limit;
    const more = await communityApi.getPosts(community.id, communityFeed.limit, offset);
    communityFeed.posts = [...communityFeed.posts, ...more.posts];
    communityFeed.offset = offset;
    communityFeed.has_more = more.has_more;
    setFeedData(communityFeed);
    renderCommunityFeedPosts();
  } catch (err) {
    console.error('Failed to load more community posts:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load More';
  }
};

function showFeedState(state) {
  const loading = document.getElementById('community-feed-loading');
  const content = document.getElementById('community-feed-content');
  const empty = document.getElementById('community-feed-empty');
  const error = document.getElementById('community-feed-error');
  const more = document.getElementById('community-feed-more');
  if (!loading || !content || !empty || !error) return;
  loading.style.display = state === 'loading' ? 'block' : 'none';
  content.style.display = state === 'posts' ? 'block' : 'none';
  empty.style.display = state === 'empty' ? 'block' : 'none';
  error.style.display = 'none';
  more.style.display = 'none';
}

function renderCommunityFeedPosts() {
  if (communityFeed.posts.length === 0) {
    showFeedState('empty');
    return;
  }
  const content = document.getElementById('community-feed-content');
  content.innerHTML = communityFeed.posts.map(renderPostCard).join('');
  showFeedState('posts');
  const more = document.getElementById('community-feed-more');
  more.style.display = communityFeed.has_more ? 'block' : 'none';
}

function bindCommunityComposer(community) {
  const submit = document.getElementById('community-post-submit');
  const textarea = document.getElementById('community-post-content');
  const errorEl = document.getElementById('community-composer-error');
  if (!submit) return;

  submit.addEventListener('click', async () => {
    const content = textarea.value.trim();
    if (!content) {
      errorEl.textContent = 'Post content is required';
      errorEl.style.display = 'block';
      return;
    }
    if (content.length > 5000) {
      errorEl.textContent = 'Post content must be less than 5000 characters';
      errorEl.style.display = 'block';
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Posting...';
    errorEl.style.display = 'none';
    try {
      const newPost = await feedApi.createPost(content, community.id);
      communityFeed.posts.unshift(newPost);
      communityFeed.has_more = false;
      setFeedData(communityFeed);
      textarea.value = '';
      renderCommunityFeedPosts();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to create post';
      errorEl.style.display = 'block';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Post';
    }
  });
}

let communityMembers = { members: [], limit: 50, offset: 0, has_more: false };

window.loadCommunityMembers = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;

  const loading = document.getElementById('community-members-loading');
  const content = document.getElementById('community-members-content');
  const empty = document.getElementById('community-members-empty');
  const error = document.getElementById('community-members-error');
  if (!loading || !content) return;

  loading.style.display = 'block';
  content.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';

  try {
    const data = await communityApi.getMembers(community.id, 50, 0);
    communityMembers = data;
    renderCommunityMemberList();
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load members';
    error.style.display = 'block';
  }
};

window.loadMoreCommunityMembers = async function () {
  const btn = document.querySelector('#community-members-more button');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const community = communityDetailState && communityDetailState.community;
    const offset = communityMembers.offset + communityMembers.limit;
    const more = await communityApi.getMembers(community.id, communityMembers.limit, offset);
    communityMembers.members = [...communityMembers.members, ...more.members];
    communityMembers.offset = offset;
    communityMembers.has_more = more.has_more;
    renderCommunityMemberList();
  } catch (err) {
    console.error('Failed to load more members:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load More';
  }
};

function renderCommunityMemberList() {
  const loading = document.getElementById('community-members-loading');
  const content = document.getElementById('community-members-content');
  const empty = document.getElementById('community-members-empty');
  const more = document.getElementById('community-members-more');
  if (!content || !empty) return;

  loading.style.display = 'none';

  if (communityMembers.members.length === 0) {
    empty.style.display = 'block';
    content.style.display = 'none';
    return;
  }

  content.innerHTML = `
    <ul class="community-member-list">
      ${communityMembers.members.map(renderMemberRow).join('')}
    </ul>
  `;
  content.style.display = 'block';
  more.style.display = communityMembers.has_more ? 'block' : 'none';
}

function renderMemberRow(member) {
  const displayName = member.display_name || member.username || 'Member';
  const avatar = member.profile_photo_url
    ? `<img src="${member.profile_photo_url}" alt="${escapeHtml(displayName)}" class="avatar" style="width:2.5rem;height:2.5rem">`
    : `<div class="avatar" style="width:2.5rem;height:2.5rem">${escapeHtml(displayName.charAt(0).toUpperCase())}</div>`;

  return `
    <li class="community-member-row">
      <a class="community-member-main" href="#/profile/${encodeURIComponent(member.username)}">
        ${avatar}
        <span class="community-member-info">
          <span class="community-member-name">${escapeHtml(displayName)}</span>
          ${member.real_name ? `<span class="community-member-real">${escapeHtml(member.real_name)}</span>` : ''}
        </span>
      </a>
    </li>
  `;
}

function bindDetailJoinLeave() {
  const community = communityDetailState && communityDetailState.community;
  const joinBtn = document.querySelector('.community-header-join');
  const leaveBtn = document.querySelector('.community-header-leave');

  if (joinBtn) {
    joinBtn.addEventListener('click', async () => {
      joinBtn.disabled = true;
      joinBtn.textContent = 'Joining...';
      try {
        await communityApi.join(community.id);
        await loadCommunityDetail(community.id);
      } catch (err) {
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join Community';
        showPageMessage(err.message || 'Failed to join', true);
      }
    });
  }

  if (leaveBtn) {
    leaveBtn.addEventListener('click', async () => {
      if (!window.confirm('Leave this community?')) return;
      leaveBtn.disabled = true;
      leaveBtn.textContent = 'Leaving...';
      try {
        await communityApi.leave(community.id);
        await loadCommunityDetail(community.id);
      } catch (err) {
        leaveBtn.disabled = false;
        leaveBtn.textContent = 'Leave Community';
        showPageMessage(err.message || 'Failed to leave', true);
      }
    });
  }
}

function showPageMessage(message, isError = false) {
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
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

/**
 * Init the community detail page.
 */
export function initCommunityDetailPage(communityId) {
  initSidebarCommon();
  initMobileNav();
  loadCommunityDetail(communityId);
}