/**
 * KomuniPH Lite - Communities UI (COMMUNITY-01)
 * Location-based community directory and community detail pages.
 *
 * Reuses the existing app shell (getSidebarHtml), feed rendering
 * (renderPostCard + setFeedData) and API client, so the community feature is
 * an addition to the existing product rather than a separate design.
 */

import { communityApi, feedApi, getCurrentUserProfile, isAuthenticated } from './api.js';
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
 * COMMUNITY-04: tabs for Discover / Joined / Recommended, debounced search,
 * simple type filter, discovery cards with activity, in-place join.
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
            <p class="community-page-subtitle">Discover location-based communities near you.</p>
          </header>

          <div class="community-tabs" role="tablist" aria-label="Community views">
            <button class="community-tab is-active" data-view="discover" role="tab" type="button">Discover</button>
            <button class="community-tab" data-view="joined" role="tab" type="button">Joined</button>
            <button class="community-tab" data-view="recommended" role="tab" type="button">Recommended</button>
          </div>

          <div class="community-toolbar">
            <input id="community-search" class="community-search" type="search"
              placeholder="Search communities by name or place..." autocomplete="off" aria-label="Search communities" />
            <select id="community-type-filter" class="community-filter" aria-label="Filter by type">
              <option value="">All types</option>
              <option value="nationwide">Nationwide</option>
              <option value="city">City</option>
              <option value="barangay">Barangay</option>
            </select>
          </div>

          <div id="community-loading" class="loading">
            <div class="spinner"></div>
            <p class="loading-text">Loading communities...</p>
          </div>

          <div id="community-directory" style="display:none"></div>

          <div id="community-empty" class="empty-state" style="display:none">
            <p class="empty-text">No communities found. Try a different search or filter.</p>
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

function formatActivityDate(value) {
  if (!value) return 'No posts yet';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return 'No posts yet';
  const diff = Date.now() - t;
  if (diff < 0) return 'Active now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Active now';
  if (min < 60) return `Active ${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Active ${days}d ago`;
  return `Active ${new Date(t).toLocaleDateString()}`;
}

function renderCommunityCard(community) {
  const meta = TYPE_META[community.type] || { label: community.type, icon: '🏘' };
  const joined = community.joined === true || community.membership === 'member';
  const eligible = community.eligible !== undefined ? community.eligible : community.eligibility;
  const shortDesc = (community.description || '').slice(0, 140);
  return `
    <article class="community-card" data-community-id="${community.id}">
      <div class="community-card-head">
        <span class="community-card-icon" aria-hidden="true">${meta.icon}</span>
        <div class="community-card-titles">
          <h3 class="community-card-name">${escapeHtml(community.name)}</h3>
          <p class="community-card-scope">${meta.label}${community.country ? ' · ' + escapeHtml(scopeLabel(community)) : ''}</p>
        </div>
      </div>
      ${shortDesc ? `<p class="community-card-desc">${escapeHtml(shortDesc)}</p>` : ''}
      <div class="community-card-meta">
        <span class="community-card-members">👥 ${formatNumber(community.member_count)} members</span>
        <span class="community-card-posts">📝 ${formatNumber(community.post_count || 0)} posts</span>
        <span class="community-card-activity">🕒 ${escapeHtml(formatActivityDate(community.last_post_at))}</span>
      </div>
      <div class="community-card-foot">
        <span class="community-card-status">${joined ? '✓ Joined' : (eligible ? 'Not joined' : 'Not eligible')}</span>
        <span class="community-card-actions">
          <a class="btn btn-secondary" href="#/community/${community.id}">Open</a>
          ${membershipButton({ ...community, membership: joined ? 'member' : 'non-member', eligibility: eligible })}
        </span>
      </div>
      ${!eligible && community.join_reason ? `<p class="community-card-reason">${escapeHtml(community.join_reason)}</p>` : ''}
    </article>
  `;
}

/**
 * Load the community directory (bound to init and retry).
 * COMMUNITY-04: Discover / Joined / Recommended views share one renderer.
 */
const communityDiscoveryState = { view: 'discover', q: '', type: '', timer: null };

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
    let communities = [];
    if (communityDiscoveryState.view === 'recommended') {
      const data = await communityApi.getRecommendedCommunities(10);
      communities = data.communities || [];
    } else if (communityDiscoveryState.view === 'joined') {
      const data = await communityApi.discoverCommunities({
        q: communityDiscoveryState.q,
        type: communityDiscoveryState.type,
        joined: 'true',
        limit: 50,
      });
      communities = data.communities || [];
    } else {
      const data = await communityApi.discoverCommunities({
        q: communityDiscoveryState.q,
        type: communityDiscoveryState.type,
        limit: 20,
      });
      communities = data.communities || [];
    }

    loading.style.display = 'none';

    if (communities.length === 0) {
      empty.style.display = 'block';
      return;
    }

    const title = communityDiscoveryState.view === 'recommended'
      ? 'Recommended Communities'
      : communityDiscoveryState.view === 'joined' ? 'Joined' : 'Discover';
    directory.innerHTML = `
      <section class="community-section">
        <h2 class="community-section-title">${title}</h2>
        <div class="community-grid">${communities.map(renderCommunityCard).join('')}</div>
      </section>`;
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
    if (btn.dataset.bound === '1') return; // avoid duplicate listeners on rebind
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const { id, action } = btn.dataset;
      const card = btn.closest('.community-card');
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = action === 'join' ? 'Joining...' : 'Leaving...';
      try {
        let result = null;
        if (action === 'join') {
          result = await communityApi.join(id);
        } else {
          await communityApi.leave(id);
        }
        // COMMUNITY-04: update in place, no full reload.
        if (card && action === 'join') {
          const status = card.querySelector('.community-card-status');
          if (status) status.textContent = '✓ Joined';
          const count = card.querySelector('.community-card-members');
          if (count && result && result.member_count !== undefined) {
            count.textContent = `👥 ${formatNumber(result.member_count)} members`;
          }
          btn.outerHTML = `<button class="btn btn-secondary community-leave-btn" data-action="leave" data-id="${id}" type="button">Leave</button>`;
          bindDirectoryActions();
        } else {
          await window.loadCommunityDirectory();
        }
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
  document.querySelectorAll('.community-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.community-tab').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      communityDiscoveryState.view = tab.dataset.view;
      window.loadCommunityDirectory();
    });
  });
  const search = document.getElementById('community-search');
  if (search) {
    search.addEventListener('input', () => {
      if (communityDiscoveryState.timer) clearTimeout(communityDiscoveryState.timer);
      communityDiscoveryState.timer = setTimeout(() => {
        communityDiscoveryState.q = search.value.trim();
        window.loadCommunityDirectory();
      }, 300);
    });
  }
  const filter = document.getElementById('community-type-filter');
  if (filter) {
    filter.addEventListener('change', () => {
      communityDiscoveryState.type = filter.value;
      window.loadCommunityDirectory();
    });
  }
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
  const roleBadge = community.role
    ? `<span class="community-role-badge role-${community.role}">${community.role.charAt(0).toUpperCase() + community.role.slice(1)}</span>`
    : '';

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
        ${roleBadge ? `<span class="community-header-stat">${roleBadge}</span>` : ''}
        ${community.moderator && community.moderator.username ? `
          <span class="community-header-stat community-header-moderator">🛡 Moderator: @${escapeHtml(community.moderator.username)}</span>
        ` : ''}
      </div>
      <div id="community-election-chip" class="community-election-chip" style="display:none"></div>
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
      <button class="community-tab active" data-tab="discussion" type="button">Discussion</button>
      <button class="community-tab" data-tab="featured" type="button">Featured</button>
      <button class="community-tab" data-tab="members" type="button">Members</button>
      <button class="community-tab" data-tab="events" type="button">Events</button>
      <button class="community-tab" data-tab="media" type="button">Media</button>
      <button class="community-tab" data-tab="election" type="button">Election</button>
      <button class="community-tab" data-tab="about" type="button">About</button>
      ${community.can_moderate ? `<button class="community-tab" data-tab="moderation" type="button">Moderation</button><button class="community-tab" data-tab="settings" type="button">Settings</button>` : ''}
    </nav>

    <div id="community-tab-content"></div>
  `;

  bindTabs();
  loadElectionChip(community);
  window.scrollTo(0, 0);
}

async function loadElectionChip(community) {
  const chip = document.getElementById('community-election-chip');
  if (!chip) return;
  try {
    const data = await communityApi.getElection(community.id);
    const e = data && data.election;
    if (!e) return;
    chip.innerHTML = `
      <span class="election-phase-badge phase-${escapeHtml(e.status)}">🗳 ${escapeHtml(e.phase)}</span>
      <span class="election-chip-round">Round ${e.round}</span>
      ${e.winner ? `<span class="election-chip-winner">Winner: ${escapeHtml(e.winner.display_name || e.winner.username)}</span>` : ''}
    `;
    chip.style.display = 'block';
  } catch (err) {
    chip.style.display = 'none';
  }
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

  if (tab === 'discussion' || tab === 'feed') {
    container.innerHTML = `
      ${community.membership === 'member' ? `
        <div class="composer community-composer">
          <textarea id="community-post-content" placeholder="Share something with ${escapeHtml(community.name)}..." rows="3"></textarea>
          <div class="community-composer-media">
            <button id="community-media-photo" class="community-media-btn" type="button" title="Attach a photo">
              <span aria-hidden="true">📷</span> Photo
            </button>
            <button id="community-media-video" class="community-media-btn" type="button" title="Attach a video">
              <span aria-hidden="true">🎬</span> Video
            </button>
            <button id="community-tag-toggle" class="community-media-btn" type="button" title="Tag people">
              <span aria-hidden="true">👥</span> Tag People
            </button>
            <button id="community-location-toggle" class="community-media-btn" type="button" title="Add a location">
              <span aria-hidden="true">📍</span> Location
            </button>
            <button id="community-feeling-toggle" class="community-media-btn" type="button" title="Add a feeling or activity">
              <span aria-hidden="true">😊</span> Feeling
            </button>
            <input id="community-media-input" type="file" style="display:none" aria-hidden="true">
          </div>
          <div id="community-tag-panel" class="community-composer-panel" style="display:none">
            <input id="community-tag-input" class="community-composer-input" type="text" placeholder="Usernames to tag, e.g. @juan @maria" maxlength="500" autocomplete="off">
            <span class="community-composer-panel-hint">Only real KomuniPH accounts are tagged.</span>
          </div>
          <div id="community-location-panel" class="community-composer-panel" style="display:none">
            <select id="community-location-country" class="community-composer-select"><option value="">Country (optional)</option></select>
            <select id="community-location-city" class="community-composer-select" disabled><option value="">City (optional)</option></select>
            <select id="community-location-barangay" class="community-composer-select" disabled><option value="">Barangay (optional)</option></select>
          </div>
          <div id="community-feeling-panel" class="community-composer-panel" style="display:none">
            <select id="community-feeling-type" class="community-composer-select">
              <option value="">Type…</option>
              <option value="feeling">Feeling</option>
              <option value="watching">Watching</option>
              <option value="listening">Listening</option>
              <option value="playing">Playing</option>
              <option value="celebrating">Celebrating</option>
              <option value="traveling">Traveling</option>
            </select>
            <input id="community-feeling-value" class="community-composer-input" type="text" placeholder="e.g. happy (optional)" maxlength="100" autocomplete="off">
          </div>
          <div id="community-media-preview" class="community-media-preview" style="display:none"></div>
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
      <div id="community-pinned-section" style="display:none">
        <h3 class="community-section-title">Pinned Announcements</h3>
        <div id="community-pinned-content"></div>
      </div>
      <section class="community-feed" aria-label="Community discussion">
        <h3 class="community-section-title">Discussion</h3>
        <div id="community-feed-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading posts...</p>
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
    window.loadPinnedCommunityPosts();
  } else if (tab === 'rules') {
    container.innerHTML = `
      <section class="community-rules-section" aria-label="Community rules">
        <div id="community-rules-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading rules...</p>
        </div>
        <div id="community-rules-content" style="display:none"></div>
        <div id="community-rules-empty" class="empty-state" style="display:none">
          <p class="empty-text">No rules yet.</p>
        </div>
        <div id="community-rules-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadCommunityRules()">Retry</button>
        </div>
        ${community.can_moderate ? `
          <div class="community-rules-admin">
            <h3 class="community-section-title">Manage Rules</h3>
            <div class="community-rule-form">
              <input type="text" id="rule-title" placeholder="Rule title" maxlength="200">
              <textarea id="rule-description" placeholder="Rule description (optional)" rows="2" maxlength="2000"></textarea>
              <div id="rule-error" class="error-banner" style="display:none"></div>
              <button id="rule-add" class="btn btn-primary">Add Rule</button>
            </div>
          </div>
        ` : ''}
      </section>
    `;
    window.loadCommunityRules();
    bindRuleCreator();
  } else if (tab === 'moderation') {
    if (!community.can_moderate) {
      container.innerHTML = `<div class="empty-state"><p class="empty-text">Only moderators can access this area.</p></div>`;
      return;
    }
    container.innerHTML = `
      <section class="community-moderation-section" aria-label="Moderation">
        <div class="community-moderation-tabs">
          <button class="community-tab active" data-mod-tab="open" type="button">Open Reports</button>
          <button class="community-tab" data-mod-tab="resolved" type="button">Resolved</button>
          <button class="community-tab" data-mod-tab="dismissed" type="button">Dismissed</button>
        </div>
        <div id="community-reports-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading reports...</p>
        </div>
        <div id="community-reports-content" style="display:none"></div>
        <div id="community-reports-empty" class="empty-state" style="display:none">
          <p class="empty-text">No reports here.</p>
        </div>
        <div id="community-reports-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadCommunityReports()">Retry</button>
        </div>
      </section>
    `;
    bindModerationTabs();
    window.loadCommunityReports('open');
  } else if (tab === 'settings') {
    if (!community.can_moderate) {
      container.innerHTML = `<div class="empty-state"><p class="empty-text">Only moderators can access this area.</p></div>`;
      return;
    }
    container.innerHTML = `
      <section class="community-settings-section" aria-label="Settings">
        <div id="community-settings-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading settings...</p>
        </div>
        <div id="community-settings-content" style="display:none"></div>
        <div id="community-settings-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadCommunitySettings()">Retry</button>
        </div>
      </section>
    `;
    window.loadCommunitySettings();
  } else if (tab === 'about') {
    container.innerHTML = `
      <p class="community-section-note">Featured posts are community highlights selected by this community's moderators.</p>
      <section class="community-feed" aria-label="Featured posts">
        <div id="community-feed-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading featured posts...</p>
        </div>
        <div id="community-feed-content" style="display:none"></div>
        <div id="community-feed-empty" class="empty-state" style="display:none">
          <p class="empty-text">No featured posts yet. Moderators can feature posts from the Discussion tab.</p>
        </div>
        <div id="community-feed-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadFeaturedCommunityPosts()">Retry</button>
        </div>
        <div id="community-feed-more" style="display:none;text-align:center;margin-top:1.5rem">
          <button class="btn btn-secondary" onclick="window.loadMoreFeaturedCommunityPosts()">Load More</button>
        </div>
      </section>
    `;
    window.loadFeaturedCommunityPosts();
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
  } else if (tab === 'events') {
    container.innerHTML = `
      <section class="community-events-section" aria-label="Community events">
        ${community.membership === 'member' ? `
          <div class="community-event-creator">
            <h3>Create an event</h3>
            <div class="community-event-form">
              <input type="text" id="community-event-title" placeholder="Event title" maxlength="120">
              <input type="datetime-local" id="community-event-date">
              <input type="text" id="community-event-location" placeholder="Location (optional)">
              <textarea id="community-event-description" placeholder="Describe the event (optional)" rows="2"></textarea>
              <div id="community-event-error" class="error-banner" style="display:none"></div>
              <button id="community-event-submit" class="btn btn-primary">Create Event</button>
            </div>
          </div>
        ` : ''}
        <div id="community-events-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading events...</p>
        </div>
        <div id="community-events-content" style="display:none"></div>
        <div id="community-events-empty" class="empty-state" style="display:none">
          <p class="empty-text">No upcoming events scheduled for this community.</p>
        </div>
        <div id="community-events-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadCommunityEvents()">Retry</button>
        </div>
      </section>
    `;
    bindEventCreator();
    window.loadCommunityEvents();
  } else if (tab === 'media') {
    container.innerHTML = `
      <section class="community-media-section" aria-label="Community media">
        <p class="community-section-note">Photos shared in community posts appear here.</p>
        <div id="community-media-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading media...</p>
        </div>
        <div id="community-media-content" style="display:none"></div>
        <div id="community-media-empty" class="empty-state" style="display:none">
          <p class="empty-text">No media yet. Share a photo link in a post to see it here.</p>
        </div>
        <div id="community-media-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadCommunityMedia()">Retry</button>
        </div>
      </section>
    `;
    window.loadCommunityMedia();
  } else if (tab === 'election') {
    container.innerHTML = `
      <section class="community-election-section" aria-label="Moderator election">
        <div id="community-election-loading" class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Loading election...</p>
        </div>
        <div id="community-election-content" style="display:none"></div>
        <div id="community-election-empty" class="empty-state" style="display:none">
          <p class="empty-text">No election information available yet.</p>
        </div>
        <div id="community-election-error" class="error-state" style="display:none">
          <p class="error-message"></p>
          <button class="btn btn-secondary" onclick="window.loadCommunityElection()">Retry</button>
        </div>
      </section>
    `;
    window.loadCommunityElection();
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
          <h3>Community roles</h3>
          <ul class="community-about-list">
            <li><strong>Owner:</strong> The first member who founded this community.</li>
            <li><strong>Moderator:</strong> Elected monthly by active members. Features posts and keeps the feed clean.</li>
            <li><strong>Member:</strong> Anyone who has joined this community.</li>
          </ul>
          ${community.moderator && community.moderator.username ? `
            <h3>Current Moderator</h3>
            <p class="community-about-moderator">🛡 <a href="#/profile/${encodeURIComponent(community.moderator.username)}">@${escapeHtml(community.moderator.display_name || community.moderator.username)}</a> · Term ends ${prettyDate(community.moderator.term_end)}</p>
          ` : ''}
          <h3>Rules</h3>
          <div id="about-rules-list"><p class="empty-text">Loading rules...</p></div>
          <h3>Settings</h3>
          <div id="about-settings-list"><p class="empty-text">Loading settings...</p></div>
          <p class="community-about-note">Community access is based on the location saved on your profile.</p>
        </div>
      </section>
    `;
    window.loadAboutRules();
    window.loadAboutSettings();
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
  if (!content) return;
  content.innerHTML = communityFeed.posts.map(renderPostCard).join('');
  showFeedState('posts');
  const more = document.getElementById('community-feed-more');
  if (more) more.style.display = communityFeed.has_more ? 'block' : 'none';
  document.querySelectorAll('.post-card').forEach(card => {
    const postId = card.dataset.postId;
    if (!postId) return;
    const actions = card.querySelector('.post-actions');
    if (!actions) return;
    const reportBtn = document.createElement('button');
    reportBtn.className = 'btn btn-secondary community-report-btn';
    reportBtn.dataset.postId = postId;
    reportBtn.type = 'button';
    reportBtn.textContent = 'Report';
    actions.appendChild(reportBtn);
  });
  bindReportButtons();
}
window.renderCommunityFeedPosts = renderCommunityFeedPosts;

function bindReportButtons() {
  document.querySelectorAll('.community-report-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const community = communityDetailState && communityDetailState.community;
      const reason = prompt('Report reason:\n- Spam\n- Harassment\n- Hate/abusive content\n- Sexual content\n- Scam/fraud\n- False/misleading content\n- Other');
      if (!reason) return;
      const trimmed = reason.trim();
      if (!trimmed) return;
      btn.disabled = true;
      try {
        await communityApi.createReport(community.id, {
          target_type: 'post',
          target_id: btn.dataset.postId,
          reason: trimmed,
          details: '',
        });
        showPageMessage('Report submitted');
      } catch (err) {
        btn.disabled = false;
        showPageMessage(err.message || 'Failed to submit report', true);
      }
    });
  });
}

/**
 * Featured tab loaders (COMMUNITY-02). Reuse the shared community feed state
 * and containers so moderators can unfeature from the Featured tab too.
 */
window.loadFeaturedCommunityPosts = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;

  showFeedState('loading');

  try {
    const data = await communityApi.getPosts(community.id, 20, 0, true);
    communityFeed = data;
    setFeedData(data);
    renderCommunityFeedPosts();
  } catch (err) {
    const loading = document.getElementById('community-feed-loading');
    if (loading) loading.style.display = 'none';
    const error = document.getElementById('community-feed-error');
    if (error) {
      error.querySelector('.error-message').textContent = err.message || 'Failed to load featured posts';
      error.style.display = 'block';
    }
  }
};

window.loadMoreFeaturedCommunityPosts = async function () {
  const btn = document.querySelector('#community-feed-more button');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const community = communityDetailState && communityDetailState.community;
    const offset = communityFeed.offset + communityFeed.limit;
    const more = await communityApi.getPosts(community.id, communityFeed.limit, offset, true);
    communityFeed.posts = [...communityFeed.posts, ...more.posts];
    communityFeed.offset = offset;
    communityFeed.has_more = more.has_more;
    setFeedData(communityFeed);
    renderCommunityFeedPosts();
  } catch (err) {
    console.error('Failed to load more featured posts:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load More';
  }
};

// COMMUNITY-05: client-side media hints. The server remains authoritative
// for type/size validation — these only prevent obvious mistakes early.
const COMMUNITY_MEDIA_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const COMMUNITY_MEDIA_VIDEO_MIMES = ['video/mp4', 'video/webm'];

function bindCommunityComposer(community) {
  const submit = document.getElementById('community-post-submit');
  const textarea = document.getElementById('community-post-content');
  const errorEl = document.getElementById('community-composer-error');
  const photoBtn = document.getElementById('community-media-photo');
  const videoBtn = document.getElementById('community-media-video');
  const fileInput = document.getElementById('community-media-input');
  const previewEl = document.getElementById('community-media-preview');
  if (!submit) return;

  let mediaFile = null;
  let mediaPreviewUrl = null;

  const clearMedia = () => {
    if (mediaPreviewUrl) {
      URL.revokeObjectURL(mediaPreviewUrl);
      mediaPreviewUrl = null;
    }
    mediaFile = null;
    if (fileInput) fileInput.value = '';
    if (previewEl) {
      previewEl.style.display = 'none';
      previewEl.innerHTML = '';
    }
  };

  const showMediaError = (message) => {
    clearMedia();
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  };

  const renderMediaPreview = () => {
    if (!previewEl || !mediaFile) return;
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    mediaPreviewUrl = URL.createObjectURL(mediaFile);
    const isVideo = COMMUNITY_MEDIA_VIDEO_MIMES.includes(mediaFile.type);
    previewEl.innerHTML = `
      <div class="community-media-thumb">
        ${isVideo
          ? `<video src="${mediaPreviewUrl}" muted></video><span class="community-media-thumb-badge">VIDEO</span>`
          : `<img src="${mediaPreviewUrl}" alt="Selected media preview">`}
        <button id="community-media-remove" class="community-media-remove" type="button" title="Remove media" aria-label="Remove selected media">✕</button>
      </div>
    `;
    previewEl.style.display = 'block';
    const removeBtn = document.getElementById('community-media-remove');
    if (removeBtn) removeBtn.addEventListener('click', clearMedia);
  };

  const pickFile = (kind) => {
    if (!fileInput) return;
    fileInput.accept = kind === 'video'
      ? 'video/mp4,video/webm'
      : 'image/jpeg,image/png,image/webp';
    fileInput.value = '';
    fileInput.click();
  };

  if (photoBtn) photoBtn.addEventListener('click', () => pickFile('image'));
  if (videoBtn) videoBtn.addEventListener('click', () => pickFile('video'));

  // COMMUNITY-05: tag / location / feeling panels.
  const tagToggle = document.getElementById('community-tag-toggle');
  const tagPanel = document.getElementById('community-tag-panel');
  const tagInput = document.getElementById('community-tag-input');
  const locationToggle = document.getElementById('community-location-toggle');
  const locationPanel = document.getElementById('community-location-panel');
  const countrySelect = document.getElementById('community-location-country');
  const citySelect = document.getElementById('community-location-city');
  const barangaySelect = document.getElementById('community-location-barangay');
  const feelingToggle = document.getElementById('community-feeling-toggle');
  const feelingPanel = document.getElementById('community-feeling-panel');
  const feelingTypeSelect = document.getElementById('community-feeling-type');
  const feelingValueInput = document.getElementById('community-feeling-value');

  let locationsCache = null;

  function togglePanel(panel, toggle) {
    if (!panel || !toggle) return;
    const willOpen = panel.style.display === 'none';
    panel.style.display = willOpen ? 'block' : 'none';
    toggle.classList.toggle('active', willOpen);
  }

  function fillSelect(select, values, placeholder) {
    if (!select) return;
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
    for (const value of values) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    }
  }

  async function populateLocations() {
    if (locationsCache || !countrySelect) return;
    try {
      const data = await profileApi.getLocations();
      locationsCache = data;
      fillSelect(countrySelect, data.countries || [], 'Country (optional)');
    } catch (err) {
      console.error('Failed to load locations:', err);
    }
  }

  if (tagToggle) tagToggle.addEventListener('click', () => togglePanel(tagPanel, tagToggle));
  if (locationToggle) locationToggle.addEventListener('click', () => {
    togglePanel(locationPanel, locationToggle);
    if (locationPanel && locationPanel.style.display !== 'none') populateLocations();
  });
  if (feelingToggle) feelingToggle.addEventListener('click', () => togglePanel(feelingPanel, feelingToggle));

  if (countrySelect) countrySelect.addEventListener('change', () => {
    const country = countrySelect.value;
    if (!locationsCache) return;
    if (citySelect) {
      fillSelect(citySelect, (locationsCache.cities && locationsCache.cities[country]) || [], 'City (optional)');
      citySelect.disabled = !country;
    }
    if (barangaySelect) {
      fillSelect(barangaySelect, [], 'Barangay (optional)');
      barangaySelect.disabled = true;
    }
  });

  if (citySelect) citySelect.addEventListener('change', () => {
    const country = countrySelect ? countrySelect.value : '';
    const city = citySelect.value;
    if (!locationsCache) return;
    const list = (locationsCache.barangays && locationsCache.barangays[country] && locationsCache.barangays[country][city]) || [];
    if (barangaySelect) {
      fillSelect(barangaySelect, list, 'Barangay (optional)');
      barangaySelect.disabled = !city;
    }
  });

  function resetComposerExtras() {
    if (tagInput) tagInput.value = '';
    if (feelingValueInput) feelingValueInput.value = '';
    if (feelingTypeSelect) feelingTypeSelect.value = '';
    if (countrySelect) countrySelect.value = '';
    if (citySelect) { fillSelect(citySelect, [], 'City (optional)'); citySelect.disabled = true; }
    if (barangaySelect) { fillSelect(barangaySelect, [], 'Barangay (optional)'); barangaySelect.disabled = true; }
    [tagPanel, locationPanel, feelingPanel].forEach(p => { if (p) p.style.display = 'none'; });
    [tagToggle, locationToggle, feelingToggle].forEach(b => { if (b) b.classList.remove('active'); });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const maxBytes = 5 * 1024 * 1024; // mirrors config.upload.maxFileSize
      if (!COMMUNITY_MEDIA_IMAGE_MIMES.includes(file.type) && !COMMUNITY_MEDIA_VIDEO_MIMES.includes(file.type)) {
        showMediaError('Unsupported media type. Use a JPEG, PNG, WebP image or an MP4/WebM video.');
        return;
      }
      if (file.size > maxBytes) {
        showMediaError('File too large. Maximum size: 5MB.');
        return;
      }
      mediaFile = file;
      errorEl.style.display = 'none';
      renderMediaPreview();
    });
  }

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
      // COMMUNITY-05: typed tag tokens are appended to the content so the
      // server-side @mention resolution sees them (only real accounts are
      // stored); feeling and location travel as structured form fields.
      let finalContent = content;
      if (tagInput && tagInput.value.trim()) {
        const tokens = tagInput.value.match(/[A-Za-z0-9_]{2,30}/g) || [];
        const tags = [...new Set(tokens)].map(t => '@' + t).join(' ');
        if (tags) finalContent = `${finalContent}\n\n${tags}`;
      }
      const extras = {};
      if (feelingTypeSelect && feelingTypeSelect.value) extras.feeling_type = feelingTypeSelect.value;
      if (feelingValueInput && feelingValueInput.value.trim()) extras.feeling_value = feelingValueInput.value.trim();
      if (countrySelect && countrySelect.value) extras.location_country = countrySelect.value;
      if (citySelect && citySelect.value) extras.location_city = citySelect.value;
      if (barangaySelect && barangaySelect.value) extras.location_barangay = barangaySelect.value;

      const newPost = await feedApi.createCommunityPost(
        community.id,
        finalContent,
        mediaFile,
        Object.keys(extras).length ? extras : null
      );
      communityFeed.posts.unshift(newPost);
      communityFeed.has_more = false;
      setFeedData(communityFeed);
      textarea.value = '';
      clearMedia();
      resetComposerExtras();
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
  const roleBadge = member.role
    ? `<span class="community-role-badge role-${member.role}">${member.role.charAt(0).toUpperCase() + member.role.slice(1)}</span>`
    : '';

  return `
    <li class="community-member-row">
      <a class="community-member-main" href="#/profile/${encodeURIComponent(member.username)}">
        ${avatar}
        <span class="community-member-info">
          <span class="community-member-name">${escapeHtml(displayName)}${roleBadge}</span>
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

/* ===========================================================================
 * COMMUNITY-02: Events, Media, and the monthly moderator election.
 */

let communityElection = null;

window.loadCommunityElection = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;

  const loading = document.getElementById('community-election-loading');
  const content = document.getElementById('community-election-content');
  const empty = document.getElementById('community-election-empty');
  const error = document.getElementById('community-election-error');
  if (!loading || !content) return;

  loading.style.display = 'block';
  content.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';

  try {
    const data = await communityApi.getElection(community.id);
    communityElection = (data && data.election) || null;

    if (!communityElection || !communityElection.candidates || communityElection.candidates.length === 0) {
      if (communityElection) {
        content.innerHTML = renderElectionCard(communityElection);
        content.style.display = 'block';
      } else {
        empty.style.display = 'block';
      }
    } else {
      content.innerHTML = renderElectionCard(communityElection);
      content.style.display = 'block';
    }

    bindElectionActions();
    loading.style.display = 'none';
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load election';
    error.style.display = 'block';
  }
};

function renderElectionCard(e) {
  const years = [];
  for (let i = -2; i <= 2; i++) {
    const d = new Date();
    const y = new Date(Date.UTC(d.getUTCFullYear() + i, 0, 1)).getUTCFullYear();
    if (!years.includes(y)) years.push(y);
  }
  const winnerName = (c) => c ? escapeHtml(c.display_name || c.username) : '';
  const votedFor = e.viewer && e.viewer.voted_for_user_id
    ? (e.candidates.find(c => c.user_id === e.viewer.voted_for_user_id) || null)
    : null;

  const scheduleRows = [
    { label: 'Nominations', value: `${prettyDate(e.nomination_start)} – ${prettyDate(e.nomination_end)}` },
    { label: 'Voting', value: `${prettyDate(e.voting_start)} – ${prettyDate(e.voting_end)}` },
    e.runoff ? { label: 'Runoff', value: `Up to ${prettyDate(e.runoff_end)}` } : null,
    { label: 'Moderator term', value: `${prettyDate(e.term_start)} – ${prettyDate(e.term_end)}` },
  ].filter(Boolean);

  return `
    <div class="community-election-card">
      <header class="community-election-head">
        <div>
          <h3>Monthly Moderator Election</h3>
          <p class="community-election-period">${e.month}/${e.year} · Round ${e.round}</p>
        </div>
        <span class="election-phase-badge phase-${escapeHtml(e.status)}">${escapeHtml(e.phase)}</span>
      </header>

      <div class="election-schedule">
        ${scheduleRows.map(row => `
          <div class="election-schedule-row">
            <span class="election-schedule-label">${row.label}</span>
            <span class="election-schedule-value">${row.value}</span>
          </div>
        `).join('')}
      </div>

      ${e.moderator && e.moderator.username ? `
        <div class="election-current-moderator">
          🛡 Current moderator: <strong>@${escapeHtml(e.moderator.username)}</strong>
          ${e.moderator.display_name ? `(${escapeHtml(e.moderator.display_name)})` : ''}
          <span class="election-term">Term ends ${prettyDate(e.moderator.term_end)}</span>
        </div>
      ` : ''}

      <h4 class="election-candidates-title">Candidates</h4>
      ${e.candidates && e.candidates.length > 0 ? `
        <ul class="election-candidate-list">
          ${e.candidates.map(c => renderCandidateRow(c, e)).join('')}
        </ul>
      ` : '<p class="empty-text">No candidates have entered this election yet.</p>'}

      <div class="election-actions">
        ${e.viewer && e.viewer.is_candidate ? `
          <span class="election-status-line">You are a candidate in this election.</span>
        ` : ''}
        ${e.viewer && e.viewer.has_voted ? `
          <span class="election-status-line">✓ You voted${votedFor ? ` for <strong>${winnerName(votedFor)}</strong>` : ''} in round ${e.round}.</span>
        ` : ''}
        ${e.viewer && e.viewer.can_vote ? `
          <span class="election-status-line">Cast your vote below (round ${e.round}).</span>
        ` : ''}
        ${e.viewer && e.viewer.can_nominate ? `
          <button class="btn btn-primary" id="election-nominate-btn" type="button">Run for Moderator</button>
        ` : ''}
      </div>

      ${e.winner ? `
        <div class="election-winner">
          <span class="election-winner-label">🏆 Winner (${e.month}/${e.year})</span>
          <strong>${winnerName(e.winner)}</strong>
          <span class="election-winner-votes">${e.winner.votes} ${e.winner.votes === 1 ? 'vote' : 'votes'}</span>
        </div>
      ` : ''}
    </div>

    ${renderElectionHistoryPlaceholder()}
  `;
}

function renderCandidateRow(c, e) {
  const displayName = c.display_name || c.username || 'Candidate';
  const avatar = c.profile_photo_url
    ? `<img src="${c.profile_photo_url}" alt="${escapeHtml(displayName)}" class="avatar" style="width:2.5rem;height:2.5rem">`
    : `<div class="avatar" style="width:2.5rem;height:2.5rem">${escapeHtml(displayName.charAt(0).toUpperCase())}</div>`;

  const isCandidateViewer = c.is_current_user;
  const canVote = !!(e.viewer && e.viewer.can_vote);

  return `
    <li class="election-candidate-row" data-candidate-user-id="${c.user_id}">
      <a class="election-candidate-main" href="#/profile/${encodeURIComponent(c.username)}">
        ${avatar}
        <span class="election-candidate-info">
          <span class="election-candidate-name">${escapeHtml(displayName)}${isCandidateViewer ? ' <span class="election-self-tag">You</span>' : ''}</span>
          <span class="election-candidate-user">@${escapeHtml(c.username)}</span>
        </span>
      </a>
      ${typeof c.votes === 'number' ? `
        <span class="election-candidate-votes">${c.votes} ${c.votes === 1 ? 'vote' : 'votes'}</span>
      ` : ''}
      ${canVote ? `
        <button class="btn btn-primary election-vote-btn" data-candidate-user-id="${c.user_id}" type="button">Vote</button>
      ` : ''}
    </li>
  `;
}

function renderElectionHistoryPlaceholder() {
  return `
    <div class="election-history">
      <h4>Election History</h4>
      <div id="community-election-history-loading" class="loading">
        <div class="spinner"></div>
        <p class="loading-text">Loading history...</p>
      </div>
      <div id="community-election-history" style="display:none"></div>
      <div id="community-election-history-empty" class="empty-text" style="display:none">No past elections to show yet.</div>
      <div id="community-election-history-error" class="error-message" style="display:none"></div>
    </div>
  `;
}

window.loadCommunityElectionHistory = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;

  const loading = document.getElementById('community-election-history-loading');
  const container = document.getElementById('community-election-history');
  const empty = document.getElementById('community-election-history-empty');
  const error = document.getElementById('community-election-history-error');
  if (!loading || !container) return;

  loading.style.display = 'block';
  container.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';

  try {
    const data = await communityApi.getElectionHistory(community.id);
    const elections = (data && data.elections) || [];

    loading.style.display = 'none';

    if (elections.length === 0) {
      empty.style.display = 'block';
      return;
    }

    container.innerHTML = `
      <ul class="election-history-list">
        ${elections.map(e => `
          <li class="election-history-row">
            <span class="election-history-period">${e.month}/${e.year}${e.runoff ? ' · runoff' : ''}</span>
            ${e.winner
              ? `<span class="election-history-winner">🏆 ${escapeHtml(e.winner.display_name || e.winner.username)} <span class="election-winner-votes">${e.winner.votes}</span></span>`
              : '<span class="election-history-winner election-history-nv">No winner</span>'}
          </li>
        `).join('')}
      </ul>
    `;
    container.style.display = 'block';
  } catch (err) {
    loading.style.display = 'none';
    error.textContent = err.message || 'Failed to load election history';
    error.style.display = 'block';
  }
};

function bindElectionActions() {
  const nominateBtn = document.getElementById('election-nominate-btn');
  if (nominateBtn) {
    nominateBtn.addEventListener('click', async () => {
      if (!window.confirm('Enter the moderator election for this month?')) return;
      nominateBtn.disabled = true;
      nominateBtn.textContent = 'Nominating...';
      try {
        await communityApi.nominate(communityDetailState.community.id);
        await window.loadCommunityElection();
      } catch (err) {
        nominateBtn.disabled = false;
        nominateBtn.textContent = 'Run for Moderator';
        showPageMessage(err.message || 'Failed to nominate', true);
      }
    });
  }

  document.querySelectorAll('.election-vote-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Confirm your vote? It cannot be changed this round.')) return;
      const candidateUserId = btn.dataset.candidateUserId;
      btn.disabled = true;
      btn.textContent = 'Voting...';
      try {
        await communityApi.vote(communityDetailState.community.id, candidateUserId);
        await window.loadCommunityElection();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Vote';
        showPageMessage(err.message || 'Failed to vote', true);
      }
    });
  });

  window.loadCommunityElectionHistory();
}

window.communityNominate = async function () {
  const btn = document.getElementById('election-nominate-btn');
  if (btn) btn.click();
};

window.communityVote = async function (candidateUserId) {
  const btn = document.querySelector(`.election-vote-btn[data-candidate-user-id="${candidateUserId}"]`);
  if (btn) btn.click();
};

/**
 * Events tab
 */
window.loadCommunityEvents = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;

  const loading = document.getElementById('community-events-loading');
  const content = document.getElementById('community-events-content');
  const empty = document.getElementById('community-events-empty');
  const error = document.getElementById('community-events-error');
  if (!loading || !content) return;

  loading.style.display = 'block';
  content.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';

  try {
    const data = await communityApi.getEvents(community.id);
    const events = (data && data.events) || [];

    loading.style.display = 'none';

    if (events.length === 0) {
      empty.style.display = 'block';
      return;
    }

    content.innerHTML = `
      <ul class="community-event-list">
        ${events.map(renderEventCard).join('')}
      </ul>
    `;
    content.style.display = 'block';
    bindEventDelete();
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load events';
    error.style.display = 'block';
  }
};

function renderEventCard(event) {
  const displayName = event.display_name || event.username || 'Member';
  const viewer = getCurrentUser();
  const isMyEvent = viewer && event.username === viewer.username;
  const canDelete = isMyEvent || !!(communityDetailState.community && communityDetailState.community.can_moderate);

  return `
    <li class="community-event-card" data-event-id="${event.id}">
      <div class="community-event-info">
        <h4 class="community-event-title">${escapeHtml(event.title)}</h4>
        <p class="community-event-meta">
          <span>📅 ${prettyDate(event.event_date)}</span>
          ${event.location ? `<span>📍 ${escapeHtml(event.location)}</span>` : ''}
          ${event.username ? `<span>by <a href="#/profile/${encodeURIComponent(event.username)}">@${escapeHtml(event.username)}</a></span>` : ''}
        </p>
        ${event.description ? `<p class="community-event-desc">${escapeHtml(event.description)}</p>` : ''}
      </div>
      ${canDelete ? `
        <button class="btn btn-secondary community-event-delete" data-event-id="${event.id}" type="button">Delete</button>
      ` : ''}
    </li>
  `;
}

function bindEventDelete() {
  document.querySelectorAll('.community-event-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Delete this event?')) return;
      const community = communityDetailState && communityDetailState.community;
      btn.disabled = true;
      try {
        await communityApi.deleteEvent(community.id, btn.dataset.eventId);
        await window.loadCommunityEvents();
      } catch (err) {
        btn.disabled = false;
        showPageMessage(err.message || 'Failed to delete event', true);
      }
    });
  });
}

function bindEventCreator() {
  const submit = document.getElementById('community-event-submit');
  if (!submit) return;

  submit.addEventListener('click', async () => {
    const community = communityDetailState && communityDetailState.community;
    const title = document.getElementById('community-event-title').value.trim();
    const dateValue = document.getElementById('community-event-date').value;
    const location = document.getElementById('community-event-location').value.trim();
    const description = document.getElementById('community-event-description').value.trim();
    const errorEl = document.getElementById('community-event-error');

    if (!title) {
      errorEl.textContent = 'Event title is required';
      errorEl.style.display = 'block';
      return;
    }
    if (!dateValue) {
      errorEl.textContent = 'A valid event date is required';
      errorEl.style.display = 'block';
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Creating...';
    errorEl.style.display = 'none';

    try {
      await communityApi.createEvent(community.id, {
        title,
        event_date: new Date(dateValue).toISOString(),
        location: location || null,
        description: description || null,
      });
      document.getElementById('community-event-title').value = '';
      document.getElementById('community-event-date').value = '';
      document.getElementById('community-event-location').value = '';
      document.getElementById('community-event-description').value = '';
      await window.loadCommunityEvents();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to create event';
      errorEl.style.display = 'block';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Create Event';
    }
  });
}

/**
 * Media tab
 */
window.loadCommunityMedia = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;

  const loading = document.getElementById('community-media-loading');
  const content = document.getElementById('community-media-content');
  const empty = document.getElementById('community-media-empty');
  const error = document.getElementById('community-media-error');
  if (!loading || !content) return;

  loading.style.display = 'block';
  content.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';

  try {
    const data = await communityApi.getMedia(community.id);
    const media = (data && data.media) || [];

    loading.style.display = 'none';

    if (media.length === 0) {
      empty.style.display = 'block';
      return;
    }

    content.innerHTML = `
      <div class="community-media-grid">
        ${media.map(item => `
          <figure class="community-media-item">
            <img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.caption || 'Community photo')}" loading="lazy">
            <figcaption class="community-media-caption">
              ${escapeHtml((item.caption || '').slice(0, 120))}
              ${item.author && item.author.username
                ? `<a class="community-media-author" href="#/profile/${encodeURIComponent(item.author.username)}">@${escapeHtml(item.author.username)}</a>`
                : ''}
            </figcaption>
          </figure>
        `).join('')}
      </div>
    `;
    content.style.display = 'block';
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load media';
    error.style.display = 'block';
  }
};

function prettyDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getCurrentUser() {
  try {
    return getCurrentUserProfile() || null;
  } catch (err) {
    return null;
  }
}

function renderReportButton(postId) {
  return `<button class="btn btn-secondary community-report-btn" data-post-id="${postId}" type="button">Report</button>`;
}

window.loadPinnedCommunityPosts = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;
  try {
    const data = await communityApi.getPosts(community.id, 5, 0, false);
    const pinned = (data && data.posts || []).filter(p => p.is_pinned);
    const section = document.getElementById('community-pinned-section');
    const content = document.getElementById('community-pinned-content');
    if (!section || !content) return;
    if (pinned.length === 0) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';
    content.innerHTML = pinned.map(post => `
      <article class="post-card community-pinned-post">
        <header class="post-head">
          <a class="post-author" href="#/profile/${encodeURIComponent(post.author.username)}">
            <span class="post-author-name">${escapeHtml(post.author.display_name || post.author.username)}</span>
            <span class="post-meta">@${escapeHtml(post.author.username)} · ${prettyDate(post.created_at)}</span>
          </a>
          <span class="post-pinned-badge">Pinned</span>
        </header>
        <p class="post-body">${escapeHtml(post.content)}</p>
        <div class="post-actions">
          <span class="post-stat">${post.like_count || 0} likes</span>
          ${community.can_moderate ? `
            <button class="btn btn-secondary community-unpin-btn" data-post-id="${post.id}" type="button">Unpin</button>
          ` : ''}
        </div>
      </article>
    `).join('');
    bindUnpinButtons();
  } catch (err) {
    const section = document.getElementById('community-pinned-section');
    if (section) section.style.display = 'none';
  }
};

function bindUnpinButtons() {
  document.querySelectorAll('.community-unpin-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const community = communityDetailState && communityDetailState.community;
      btn.disabled = true;
      try {
        await communityApi.unpinPost(community.id, btn.dataset.postId);
        await window.loadPinnedCommunityPosts();
        await window.loadCommunityFeedPosts();
        await loadCommunityDetail(community.id);
      } catch (err) {
        btn.disabled = false;
        showPageMessage(err.message || 'Failed to unpin', true);
      }
    });
  });
}

window.loadCommunityRules = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;
  const loading = document.getElementById('community-rules-loading');
  const content = document.getElementById('community-rules-content');
  const empty = document.getElementById('community-rules-empty');
  const error = document.getElementById('community-rules-error');
  if (!loading || !content) return;
  loading.style.display = 'block';
  content.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';
  try {
    const data = await communityApi.getRules(community.id);
    const rules = (data && data.rules) || [];
    if (rules.length === 0) {
      empty.style.display = 'block';
    } else {
      content.innerHTML = `
        <ol class="community-rules-list">
          ${rules.filter(r => r.enabled).map(rule => `
            <li class="community-rule-item" data-rule-id="${rule.id}">
              <div class="community-rule-main">
                <strong>${escapeHtml(rule.title)}</strong>
                ${rule.description ? `<p>${escapeHtml(rule.description)}</p>` : ''}
              </div>
              ${community.can_moderate ? `
                <div class="community-rule-actions">
                  <button class="btn btn-secondary community-rule-edit" data-rule-id="${rule.id}" type="button">Edit</button>
                  <button class="btn btn-danger community-rule-delete" data-rule-id="${rule.id}" type="button">Delete</button>
                </div>
              ` : ''}
            </li>
          `).join('')}
        </ol>
      `;
      content.style.display = 'block';
      bindRuleActions();
    }
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load rules';
    error.style.display = 'block';
  }
};

function bindRuleCreator() {
  const addBtn = document.getElementById('rule-add');
  if (!addBtn) return;
  addBtn.addEventListener('click', async () => {
    const community = communityDetailState && communityDetailState.community;
    const title = (document.getElementById('rule-title').value || '').trim();
    const description = (document.getElementById('rule-description').value || '').trim();
    const errorEl = document.getElementById('rule-error');
    if (!title) {
      errorEl.textContent = 'Rule title is required';
      errorEl.style.display = 'block';
      return;
    }
    addBtn.disabled = true;
    errorEl.style.display = 'none';
    try {
      await communityApi.createRule(community.id, { title, description });
      document.getElementById('rule-title').value = '';
      document.getElementById('rule-description').value = '';
      await window.loadCommunityRules();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to create rule';
      errorEl.style.display = 'block';
    } finally {
      addBtn.disabled = false;
    }
  });
}

function bindRuleActions() {
  document.querySelectorAll('.community-rule-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const community = communityDetailState && communityDetailState.community;
      if (!window.confirm('Delete this rule?')) return;
      btn.disabled = true;
      try {
        await communityApi.deleteRule(community.id, btn.dataset.ruleId);
        await window.loadCommunityRules();
      } catch (err) {
        btn.disabled = false;
        showPageMessage(err.message || 'Failed to delete rule', true);
      }
    });
  });
  document.querySelectorAll('.community-rule-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const community = communityDetailState && communityDetailState.community;
      const item = document.querySelector(`.community-rule-item[data-rule-id="${btn.dataset.ruleId}"]`);
      const titleEl = item.querySelector('.community-rule-main strong');
      const descEl = item.querySelector('.community-rule-main p');
      const currentTitle = titleEl.textContent || '';
      const currentDesc = descEl ? descEl.textContent || '' : '';
      const newTitle = prompt('Rule title:', currentTitle);
      if (newTitle === null) return;
      const trimmedTitle = (newTitle || '').trim();
      if (!trimmedTitle) {
        showPageMessage('Rule title is required', true);
        return;
      }
      const newDesc = prompt('Rule description:', currentDesc);
      try {
        await communityApi.updateRule(community.id, btn.dataset.ruleId, { title: trimmedTitle, description: newDesc || '' });
        await window.loadCommunityRules();
      } catch (err) {
        showPageMessage(err.message || 'Failed to update rule', true);
      }
    });
  });
}

window.loadCommunityReports = async function (statusFilter) {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;
  const loading = document.getElementById('community-reports-loading');
  const content = document.getElementById('community-reports-content');
  const empty = document.getElementById('community-reports-empty');
  const error = document.getElementById('community-reports-error');
  if (!loading || !content) return;
  loading.style.display = 'block';
  content.style.display = 'none';
  empty.style.display = 'none';
  error.style.display = 'none';
  try {
    const data = await communityApi.getReports(community.id, { status: statusFilter });
    const reports = (data && data.reports) || [];
    if (reports.length === 0) {
      empty.style.display = 'block';
    } else {
      content.innerHTML = `
        <ul class="community-reports-list">
          ${reports.map(report => `
            <li class="community-report-item" data-report-id="${report.id}">
              <div class="community-report-main">
                <strong>${escapeHtml(report.reason)}</strong>
                <span class="community-report-meta">${report.target_type} · ${escapeHtml(report.target_id)} · ${prettyDate(report.created_at)}</span>
                ${report.details ? `<p>${escapeHtml(report.details)}</p>` : ''}
              </div>
              <span class="community-report-status status-${escapeHtml(report.status)}">${report.status}</span>
              <div class="community-report-actions">
                ${report.status === 'open' ? `
                  <button class="btn btn-primary community-report-resolve" data-report-id="${report.id}" type="button">Resolve</button>
                  <button class="btn btn-secondary community-report-dismiss" data-report-id="${report.id}" type="button">Dismiss</button>
                ` : ''}
              </div>
            </li>
          `).join('')}
        </ul>
      `;
      content.style.display = 'block';
      bindModerationActions();
    }
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load reports';
    error.style.display = 'block';
  }
};

function bindModerationTabs() {
  document.querySelectorAll('.community-moderation-tabs .community-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.community-moderation-tabs .community-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      window.loadCommunityReports(tab.dataset.modTab);
    });
  });
}

function bindModerationActions() {
  document.querySelectorAll('.community-report-resolve').forEach(btn => {
    btn.addEventListener('click', async () => {
      const community = communityDetailState && communityDetailState.community;
      btn.disabled = true;
      try {
        await communityApi.resolveReport(community.id, btn.dataset.reportId);
        const item = document.querySelector(`.community-report-item[data-report-id="${btn.dataset.reportId}"]`);
        const statusEl = item.querySelector('.community-report-status');
        statusEl.textContent = 'resolved';
        statusEl.className = 'community-report-status status-resolved';
        item.querySelector('.community-report-actions').innerHTML = '';
      } catch (err) {
        btn.disabled = false;
        showPageMessage(err.message || 'Failed to resolve', true);
      }
    });
  });
  document.querySelectorAll('.community-report-dismiss').forEach(btn => {
    btn.addEventListener('click', async () => {
      const community = communityDetailState && communityDetailState.community;
      btn.disabled = true;
      try {
        await communityApi.dismissReport(community.id, btn.dataset.reportId);
        const item = document.querySelector(`.community-report-item[data-report-id="${btn.dataset.reportId}"]`);
        const statusEl = item.querySelector('.community-report-status');
        statusEl.textContent = 'dismissed';
        statusEl.className = 'community-report-status status-dismissed';
        item.querySelector('.community-report-actions').innerHTML = '';
      } catch (err) {
        btn.disabled = false;
        showPageMessage(err.message || 'Failed to dismiss', true);
      }
    });
  });
}

window.loadCommunitySettings = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;
  const loading = document.getElementById('community-settings-loading');
  const content = document.getElementById('community-settings-content');
  const error = document.getElementById('community-settings-error');
  if (!loading || !content) return;
  loading.style.display = 'block';
  content.style.display = 'none';
  error.style.display = 'none';
  try {
    const data = await communityApi.getSettings(community.id);
    const settings = (data && data.settings) || {};
    content.innerHTML = `
      <form id="community-settings-form" class="community-settings-form">
        <label class="editor-toggle" for="setting-allow-member-posts"><span>Allow member posts</span><input id="setting-allow-member-posts" type="checkbox" role="switch" ${settings.allow_member_posts ? 'checked' : ''}></label>
        <label class="editor-toggle" for="setting-allow-member-comments"><span>Allow member comments</span><input id="setting-allow-member-comments" type="checkbox" role="switch" ${settings.allow_member_comments ? 'checked' : ''}></label>
        <label class="editor-toggle" for="setting-allow-events"><span>Allow events</span><input id="setting-allow-events" type="checkbox" role="switch" ${settings.allow_events ? 'checked' : ''}></label>
        <label class="editor-toggle" for="setting-allow-media"><span>Allow media links</span><input id="setting-allow-media" type="checkbox" role="switch" ${settings.allow_media ? 'checked' : ''}></label>
        <label class="editor-toggle" for="setting-moderation-enabled"><span>Enable moderation/reporting</span><input id="setting-moderation-enabled" type="checkbox" role="switch" ${settings.moderation_enabled ? 'checked' : ''}></label>
        <div id="settings-error" class="error-banner" style="display:none"></div>
        <button id="settings-save" class="btn btn-primary">Save Settings</button>
      </form>
    `;
    content.style.display = 'block';
    document.getElementById('settings-save').addEventListener('click', async () => {
      const saveBtn = document.getElementById('settings-save');
      const errorEl = document.getElementById('settings-error');
      saveBtn.disabled = true;
      errorEl.style.display = 'none';
      try {
        await communityApi.updateSettings(community.id, {
          allow_member_posts: document.getElementById('setting-allow-member-posts').checked,
          allow_member_comments: document.getElementById('setting-allow-member-comments').checked,
          allow_events: document.getElementById('setting-allow-events').checked,
          allow_media: document.getElementById('setting-allow-media').checked,
          moderation_enabled: document.getElementById('setting-moderation-enabled').checked,
        });
        showPageMessage('Settings saved');
      } catch (err) {
        errorEl.textContent = err.message || 'Failed to save settings';
        errorEl.style.display = 'block';
      } finally {
        saveBtn.disabled = false;
      }
    });
  } catch (err) {
    loading.style.display = 'none';
    error.querySelector('.error-message').textContent = err.message || 'Failed to load settings';
    error.style.display = 'block';
  }
};

window.loadAboutRules = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;
  const container = document.getElementById('about-rules-list');
  if (!container) return;
  try {
    const data = await communityApi.getRules(community.id);
    const rules = (data && data.rules) || [];
    if (rules.length === 0) {
      container.innerHTML = '<p class="empty-text">No rules yet.</p>';
      return;
    }
    container.innerHTML = `
      <ol class="community-rules-list">
        ${rules.filter(r => r.enabled).map(rule => `
          <li class="community-rule-item">
            <div class="community-rule-main">
              <strong>${escapeHtml(rule.title)}</strong>
              ${rule.description ? `<p>${escapeHtml(rule.description)}</p>` : ''}
            </div>
          </li>
        `).join('')}
      </ol>
    `;
  } catch (err) {
    container.innerHTML = '<p class="empty-text">Failed to load rules.</p>';
  }
};

window.loadAboutSettings = async function () {
  const community = communityDetailState && communityDetailState.community;
  if (!community) return;
  const container = document.getElementById('about-settings-list');
  if (!container) return;
  try {
    const data = await communityApi.getSettings(community.id);
    const settings = (data && data.settings) || {};
    container.innerHTML = `
      <ul class="community-about-list">
        <li><strong>Member posts:</strong> ${settings.allow_member_posts ? 'Allowed' : 'Disabled'}</li>
        <li><strong>Member comments:</strong> ${settings.allow_member_comments ? 'Allowed' : 'Disabled'}</li>
        <li><strong>Events:</strong> ${settings.allow_events ? 'Allowed' : 'Disabled'}</li>
        <li><strong>Media:</strong> ${settings.allow_media ? 'Allowed' : 'Disabled'}</li>
        <li><strong>Moderation:</strong> ${settings.moderation_enabled ? 'Enabled' : 'Disabled'}</li>
      </ul>
    `;
  } catch (err) {
    container.innerHTML = '<p class="empty-text">Failed to load settings.</p>';
  }
};

/**
 * Init the community detail page.
 */
export function initCommunityDetailPage(communityId) {
  initSidebarCommon();
  initMobileNav();
  loadCommunityDetail(communityId);
}